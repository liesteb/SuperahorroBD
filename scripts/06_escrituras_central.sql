-- ============================================================
-- 06_escrituras_central.sql  |  Ejecutar en: nodo_central (despues del 03)
-- Transparencia de escritura: las vistas globales aceptan INSERT, UPDATE
-- y DELETE, y cada renglon se manda al nodo que le corresponde.
-- La tabla replicada producto se escribe en las 3 copias (ROWA).
-- ============================================================

-- 1. Catalogo de localizacion: que nodo guarda cada rango de ids
CREATE TABLE localizacion (
    region     VARCHAR(10) PRIMARY KEY,
    esquema    VARCHAR(10) NOT NULL,   -- esquema del central con las tablas remotas
    sufijo     CHAR(1)     NOT NULL,   -- sufijo de los fragmentos (venta_n, venta_c...)
    suc_min    INT NOT NULL,
    suc_max    INT NOT NULL,
    venta_min  INT NOT NULL,
    venta_max  INT NOT NULL
);

INSERT INTO localizacion VALUES
('Norte',  'norte',  'n', 100, 199, 1000000, 1999999),
('Centro', 'centro', 'c', 200, 299, 2000000, 2999999),
('Sur',    'sur',    's', 300, 399, 3000000, 3999999);

-- Nodo que guarda una sucursal (y su inventario y sus ventas)
CREATE FUNCTION nodo_de_sucursal(p_id_sucursal INT) RETURNS localizacion
LANGUAGE plpgsql STABLE AS $$
DECLARE l localizacion;
BEGIN
    SELECT * INTO l FROM localizacion WHERE p_id_sucursal BETWEEN suc_min AND suc_max;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'La sucursal % no pertenece a ninguna region', p_id_sucursal;
    END IF;
    RETURN l;
END $$;

-- Nodo que guarda una venta (y su detalle)
CREATE FUNCTION nodo_de_venta(p_id_venta INT) RETURNS localizacion
LANGUAGE plpgsql STABLE AS $$
DECLARE l localizacion;
BEGIN
    SELECT * INTO l FROM localizacion WHERE p_id_venta BETWEEN venta_min AND venta_max;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'La venta % no pertenece a ninguna region', p_id_venta;
    END IF;
    RETURN l;
END $$;

-- Nombre calificado del fragmento, p. ej. fragmento('venta', l) = norte.venta_n
CREATE FUNCTION fragmento(p_tabla TEXT, l localizacion) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
    SELECT format('%I.%I', l.esquema, p_tabla || '_' || l.sufijo)
$$;

-- 2. SUCURSAL: el fragmento se elige por la region
CREATE FUNCTION tg_sucursal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE l localizacion;
BEGIN
    IF TG_OP = 'INSERT' THEN
        SELECT * INTO l FROM localizacion WHERE region = NEW.region;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Region invalida: %', NEW.region;
        END IF;
        IF NEW.id_sucursal NOT BETWEEN l.suc_min AND l.suc_max THEN
            RAISE EXCEPTION 'La sucursal % no esta en el rango de la region % (% a %)',
                NEW.id_sucursal, NEW.region, l.suc_min, l.suc_max;
        END IF;
        EXECUTE format('INSERT INTO %s SELECT ($1).*', fragmento('sucursal', l)) USING NEW;
        RETURN NEW;
    END IF;

    l := nodo_de_sucursal(OLD.id_sucursal);
    IF TG_OP = 'UPDATE' THEN
        -- Cambiar de region obligaria a migrar sus ventas e inventario a otro nodo
        IF NEW.id_sucursal <> OLD.id_sucursal OR NEW.region <> OLD.region THEN
            RAISE EXCEPTION 'No se permite cambiar el id ni la region de una sucursal (migracion entre nodos)';
        END IF;
        EXECUTE format('UPDATE %s SET nombre = $1, ciudad = $2, gerente = $3 WHERE id_sucursal = $4',
                       fragmento('sucursal', l))
            USING NEW.nombre, NEW.ciudad, NEW.gerente, OLD.id_sucursal;
        RETURN NEW;
    END IF;

    EXECUTE format('DELETE FROM %s WHERE id_sucursal = $1', fragmento('sucursal', l)) USING OLD.id_sucursal;
    RETURN OLD;
END $$;

CREATE TRIGGER tg_sucursal INSTEAD OF INSERT OR UPDATE OR DELETE ON sucursal
    FOR EACH ROW EXECUTE FUNCTION tg_sucursal();

-- 3. INVENTARIO: fragmento derivado, se elige por la sucursal
CREATE FUNCTION tg_inventario() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE l localizacion;
BEGIN
    IF TG_OP = 'INSERT' THEN
        l := nodo_de_sucursal(NEW.id_sucursal);
        EXECUTE format('INSERT INTO %s SELECT ($1).*', fragmento('inventario', l)) USING NEW;
        RETURN NEW;
    END IF;

    l := nodo_de_sucursal(OLD.id_sucursal);
    IF TG_OP = 'UPDATE' THEN
        IF NEW.id_sucursal <> OLD.id_sucursal OR NEW.id_producto <> OLD.id_producto THEN
            RAISE EXCEPTION 'No se permite cambiar la llave del inventario';
        END IF;
        EXECUTE format('UPDATE %s SET existencia = $1, stock_minimo = $2 WHERE id_sucursal = $3 AND id_producto = $4',
                       fragmento('inventario', l))
            USING NEW.existencia, NEW.stock_minimo, OLD.id_sucursal, OLD.id_producto;
        RETURN NEW;
    END IF;

    EXECUTE format('DELETE FROM %s WHERE id_sucursal = $1 AND id_producto = $2', fragmento('inventario', l))
        USING OLD.id_sucursal, OLD.id_producto;
    RETURN OLD;
END $$;

CREATE TRIGGER tg_inventario INSTEAD OF INSERT OR UPDATE OR DELETE ON inventario
    FOR EACH ROW EXECUTE FUNCTION tg_inventario();

-- 4. VENTA: fragmento derivado, se elige por la sucursal.
--    Si el id_venta viene nulo se genera el siguiente del rango de la region.
CREATE FUNCTION siguiente_id_venta(l localizacion) RETURNS INT
LANGUAGE plpgsql AS $$
DECLARE v_id INT;
BEGIN
    -- Serializa la generacion de ids por region (cerrojo hasta el fin de la transaccion)
    PERFORM pg_advisory_xact_lock(hashtext('venta_' || l.region));
    EXECUTE format('SELECT COALESCE(MAX(id_venta), $1 - 1) + 1 FROM %s', fragmento('venta', l))
        INTO v_id USING l.venta_min;
    IF v_id > l.venta_max THEN
        RAISE EXCEPTION 'Se agoto el rango de ventas de la region %', l.region;
    END IF;
    RETURN v_id;
END $$;

CREATE FUNCTION tg_venta() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE l localizacion;
BEGIN
    IF TG_OP = 'INSERT' THEN
        l := nodo_de_sucursal(NEW.id_sucursal);
        NEW.id_venta := COALESCE(NEW.id_venta, siguiente_id_venta(l));
        NEW.total    := COALESCE(NEW.total, 0);
        IF NEW.id_venta NOT BETWEEN l.venta_min AND l.venta_max THEN
            RAISE EXCEPTION 'La venta % no esta en el rango de la region %', NEW.id_venta, l.region;
        END IF;
        EXECUTE format('INSERT INTO %s SELECT ($1).*', fragmento('venta', l)) USING NEW;
        RETURN NEW;
    END IF;

    l := nodo_de_venta(OLD.id_venta);
    IF TG_OP = 'UPDATE' THEN
        IF NEW.id_venta <> OLD.id_venta OR NEW.id_sucursal <> OLD.id_sucursal THEN
            RAISE EXCEPTION 'No se permite cambiar el id ni la sucursal de una venta';
        END IF;
        EXECUTE format('UPDATE %s SET fecha = $1, total = $2, metodo_pago = $3 WHERE id_venta = $4',
                       fragmento('venta', l))
            USING NEW.fecha, NEW.total, NEW.metodo_pago, OLD.id_venta;
        RETURN NEW;
    END IF;

    -- Borrar una venta borra su detalle (estan en el mismo nodo)
    EXECUTE format('DELETE FROM %s WHERE id_venta = $1', fragmento('detalle', l)) USING OLD.id_venta;
    EXECUTE format('DELETE FROM %s WHERE id_venta = $1', fragmento('venta', l))   USING OLD.id_venta;
    RETURN OLD;
END $$;

CREATE TRIGGER tg_venta INSTEAD OF INSERT OR UPDATE OR DELETE ON venta
    FOR EACH ROW EXECUTE FUNCTION tg_venta();

-- 5. DETALLE_VENTA: fragmento derivado de segundo nivel, se elige por la venta
CREATE FUNCTION tg_detalle() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE l localizacion;
BEGIN
    IF TG_OP = 'INSERT' THEN
        l := nodo_de_venta(NEW.id_venta);
        EXECUTE format('INSERT INTO %s SELECT ($1).*', fragmento('detalle', l)) USING NEW;
        RETURN NEW;
    END IF;

    l := nodo_de_venta(OLD.id_venta);
    IF TG_OP = 'UPDATE' THEN
        IF NEW.id_venta <> OLD.id_venta OR NEW.id_producto <> OLD.id_producto THEN
            RAISE EXCEPTION 'No se permite cambiar la llave del detalle';
        END IF;
        EXECUTE format('UPDATE %s SET cantidad = $1, precio_unitario = $2 WHERE id_venta = $3 AND id_producto = $4',
                       fragmento('detalle', l))
            USING NEW.cantidad, NEW.precio_unitario, OLD.id_venta, OLD.id_producto;
        RETURN NEW;
    END IF;

    EXECUTE format('DELETE FROM %s WHERE id_venta = $1 AND id_producto = $2', fragmento('detalle', l))
        USING OLD.id_venta, OLD.id_producto;
    RETURN OLD;
END $$;

CREATE TRIGGER tg_detalle INSTEAD OF INSERT OR UPDATE OR DELETE ON detalle_venta
    FOR EACH ROW EXECUTE FUNCTION tg_detalle();

-- 6. PRODUCTO replicado: se lee una copia y se escribe en todas (Read One, Write All).
--    Las 3 escrituras van en la misma transaccion del central: si un nodo falla
--    o rechaza el cambio, no se aplica en ninguno.
CREATE FUNCTION tg_producto() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE l localizacion;
BEGIN
    FOR l IN SELECT * FROM localizacion ORDER BY suc_min LOOP
        IF TG_OP = 'INSERT' THEN
            EXECUTE format('INSERT INTO %I.producto SELECT ($1).*', l.esquema) USING NEW;
        ELSIF TG_OP = 'UPDATE' THEN
            EXECUTE format('UPDATE %I.producto SET id_producto = $1, nombre = $2, categoria = $3, precio = $4 WHERE id_producto = $5',
                           l.esquema)
                USING NEW.id_producto, NEW.nombre, NEW.categoria, NEW.precio, OLD.id_producto;
        ELSE
            EXECUTE format('DELETE FROM %I.producto WHERE id_producto = $1', l.esquema) USING OLD.id_producto;
        END IF;
    END LOOP;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER tg_producto INSTEAD OF INSERT OR UPDATE OR DELETE ON producto
    FOR EACH ROW EXECUTE FUNCTION tg_producto();

-- 7. Transaccion distribuida de negocio: registrar una venta completa.
--    p_items = '[{"id_producto": 1, "cantidad": 2}, ...]'
--    Crea la venta y su detalle, descuenta el inventario y calcula el total,
--    todo en el nodo de la sucursal. Si falta existencia no se guarda nada.
CREATE FUNCTION registrar_venta(p_id_sucursal INT, p_metodo_pago TEXT, p_items JSONB,
                                p_fecha DATE DEFAULT CURRENT_DATE)
RETURNS INT LANGUAGE plpgsql AS $$
DECLARE
    l        localizacion := nodo_de_sucursal(p_id_sucursal);
    v_id     INT;
    v_item   RECORD;
    v_precio NUMERIC(10,2);
    v_queda  INT;
BEGIN
    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'La venta debe tener al menos un producto';
    END IF;

    INSERT INTO venta (id_venta, id_sucursal, fecha, total, metodo_pago)
    VALUES (NULL, p_id_sucursal, p_fecha, 0, p_metodo_pago)
    RETURNING id_venta INTO v_id;

    -- Un renglon por producto (si se repite se suman las cantidades)
    FOR v_item IN
        SELECT (e->>'id_producto')::int AS id_producto, SUM((e->>'cantidad')::int)::int AS cantidad
        FROM jsonb_array_elements(p_items) e
        GROUP BY 1 ORDER BY 1
    LOOP
        IF v_item.cantidad IS NULL OR v_item.cantidad <= 0 THEN
            RAISE EXCEPTION 'Cantidad invalida para el producto %', v_item.id_producto;
        END IF;

        -- El precio se lee de la copia local del nodo de la sucursal
        EXECUTE format('SELECT precio FROM %I.producto WHERE id_producto = $1', l.esquema)
            INTO v_precio USING v_item.id_producto;
        IF v_precio IS NULL THEN
            RAISE EXCEPTION 'El producto % no existe', v_item.id_producto;
        END IF;

        -- Descuento atomico en el nodo remoto: dos ventas simultaneas no pueden
        -- leer la misma existencia y dejarla negativa
        EXECUTE format('UPDATE %s SET existencia = existencia - $1
                        WHERE id_sucursal = $2 AND id_producto = $3 AND existencia >= $1
                        RETURNING existencia', fragmento('inventario', l))
            INTO v_queda USING v_item.cantidad, p_id_sucursal, v_item.id_producto;
        IF v_queda IS NULL THEN
            RAISE EXCEPTION 'Existencia insuficiente del producto % en la sucursal %',
                v_item.id_producto, p_id_sucursal;
        END IF;

        INSERT INTO detalle_venta (id_venta, id_producto, cantidad, precio_unitario)
        VALUES (v_id, v_item.id_producto, v_item.cantidad, v_precio);
    END LOOP;

    EXECUTE format('UPDATE %s SET total = (SELECT SUM(cantidad * precio_unitario) FROM %s WHERE id_venta = $1)
                    WHERE id_venta = $1', fragmento('venta', l), fragmento('detalle', l))
        USING v_id;

    RETURN v_id;
END $$;
