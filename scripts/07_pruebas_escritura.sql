-- ============================================================
-- 07_pruebas_escritura.sql  |  Ejecutar en: nodo_central (despues del 06)
-- Pruebas de transparencia de escritura, replicacion y transacciones.
-- Todo corre dentro de una transaccion que al final se deshace (ROLLBACK),
-- asi que se puede ejecutar las veces que se quiera sin alterar los datos.
-- Resultado esperado: la columna ok = true en todos los renglones.
-- ============================================================
BEGIN;

CREATE TEMP TABLE resultado (
    prueba    TEXT,
    esperado  TEXT,
    obtenido  TEXT
) ON COMMIT DROP;

-- E1. Insertar una sucursal del Sur en la vista global: debe quedar solo en nodo_sur
INSERT INTO sucursal VALUES (390, 'SuperAhorro Prueba', 'Puebla', 'Sur', 'Gerente Prueba');
INSERT INTO resultado SELECT 'E1 insert sucursal va al nodo Sur', 'sur=1 norte=0 centro=0',
    format('sur=%s norte=%s centro=%s',
        (SELECT COUNT(*) FROM sur.sucursal_s    WHERE id_sucursal = 390),
        (SELECT COUNT(*) FROM norte.sucursal_n  WHERE id_sucursal = 390),
        (SELECT COUNT(*) FROM centro.sucursal_c WHERE id_sucursal = 390));

-- E2. Region y rango no coinciden: debe rechazarse
DO $$ BEGIN
    INSERT INTO sucursal VALUES (350, 'Mal', 'Tijuana', 'Norte', 'X');
    INSERT INTO resultado VALUES ('E2 sucursal Norte con id del Sur', 'error', 'se inserto');
EXCEPTION WHEN OTHERS THEN
    INSERT INTO resultado VALUES ('E2 sucursal Norte con id del Sur', 'error', 'error');
END $$;

-- E3. Actualizar una sucursal desde el central: el cambio llega al nodo Centro
UPDATE sucursal SET gerente = 'Nuevo Gerente' WHERE id_sucursal = 201;
INSERT INTO resultado SELECT 'E3 update sucursal llega al nodo Centro', 'Nuevo Gerente',
    (SELECT gerente FROM centro.sucursal_c WHERE id_sucursal = 201);

-- E4. Cambiar la region de una sucursal: debe rechazarse (migracion entre nodos)
DO $$ BEGIN
    UPDATE sucursal SET region = 'Sur' WHERE id_sucursal = 100;
    INSERT INTO resultado VALUES ('E4 cambiar region de sucursal', 'error', 'se actualizo');
EXCEPTION WHEN OTHERS THEN
    INSERT INTO resultado VALUES ('E4 cambiar region de sucursal', 'error', 'error');
END $$;

-- E5. registrar_venta: crea venta + detalle en el nodo Norte, descuenta inventario
--     y calcula el total. Se usan 2 productos con existencia suficiente.
CREATE TEMP TABLE e5_antes ON COMMIT DROP AS
    SELECT id_producto, existencia FROM inventario
    WHERE id_sucursal = 100 AND existencia >= 3
    ORDER BY id_producto LIMIT 2;

CREATE TEMP TABLE e5_venta ON COMMIT DROP AS
    SELECT registrar_venta(100, 'Efectivo',
        (SELECT jsonb_agg(jsonb_build_object('id_producto', id_producto, 'cantidad', 3)) FROM e5_antes)
    ) AS id_venta;

INSERT INTO resultado SELECT 'E5a id de la venta en el rango Norte', 'true',
    ((SELECT id_venta FROM e5_venta) BETWEEN 1000000 AND 1999999)::text;
INSERT INTO resultado SELECT 'E5b la venta esta en el nodo Norte', '1',
    (SELECT COUNT(*) FROM norte.venta_n WHERE id_venta = (SELECT id_venta FROM e5_venta))::text;
INSERT INTO resultado SELECT 'E5c detalle con 2 productos', '2',
    (SELECT COUNT(*) FROM norte.detalle_n WHERE id_venta = (SELECT id_venta FROM e5_venta))::text;
INSERT INTO resultado SELECT 'E5d total = suma del detalle', 'true',
    ((SELECT total FROM venta WHERE id_venta = (SELECT id_venta FROM e5_venta)) =
     (SELECT SUM(cantidad * precio_unitario) FROM detalle_venta WHERE id_venta = (SELECT id_venta FROM e5_venta)))::text;
INSERT INTO resultado SELECT 'E5e inventario descontado 3 unidades', 'true',
    bool_and(i.existencia = a.existencia - 3)::text
    FROM e5_antes a JOIN norte.inventario_n i ON i.id_sucursal = 100 AND i.id_producto = a.id_producto;

-- E6. Venta con existencia insuficiente: falla completa, no deja nada a medias (atomicidad)
CREATE TEMP TABLE e6_antes ON COMMIT DROP AS
    SELECT (SELECT COUNT(*) FROM norte.venta_n) AS ventas,
           (SELECT existencia FROM norte.inventario_n WHERE id_sucursal = 101 AND id_producto = 1) AS exist_1;
DO $$ BEGIN
    -- el producto 1 si alcanza, el 2 no: el descuento del producto 1 tambien debe deshacerse
    PERFORM registrar_venta(101, 'Tarjeta', '[{"id_producto":1,"cantidad":1},{"id_producto":2,"cantidad":100000}]');
    INSERT INTO resultado VALUES ('E6a venta sin existencia', 'error', 'se registro');
EXCEPTION WHEN OTHERS THEN
    INSERT INTO resultado VALUES ('E6a venta sin existencia', 'error', 'error');
END $$;
INSERT INTO resultado SELECT 'E6b no quedo venta ni descuento a medias', 'true',
    ((SELECT COUNT(*) FROM norte.venta_n) = ventas AND
     (SELECT existencia FROM norte.inventario_n WHERE id_sucursal = 101 AND id_producto = 1) = exist_1)::text
    FROM e6_antes;

-- E7. Sucursal inexistente: debe rechazarse
DO $$ BEGIN
    PERFORM registrar_venta(999, 'Efectivo', '[{"id_producto":1,"cantidad":1}]');
    INSERT INTO resultado VALUES ('E7 venta en sucursal inexistente', 'error', 'se registro');
EXCEPTION WHEN OTHERS THEN
    INSERT INTO resultado VALUES ('E7 venta en sucursal inexistente', 'error', 'error');
END $$;

-- E8. Replicacion: cambiar un precio en la vista global actualiza las 3 copias
UPDATE producto SET precio = 99.50 WHERE id_producto = 5;
INSERT INTO resultado SELECT 'E8 precio replicado en los 3 nodos', '99.50 99.50 99.50',
    format('%s %s %s',
        (SELECT precio FROM norte.producto  WHERE id_producto = 5),
        (SELECT precio FROM centro.producto WHERE id_producto = 5),
        (SELECT precio FROM sur.producto    WHERE id_producto = 5));

-- E9. Replicacion: un producto nuevo aparece en los 3 nodos
INSERT INTO producto VALUES (31, 'Producto Nuevo', 'Bebidas', 18.00);
INSERT INTO resultado SELECT 'E9 producto nuevo en los 3 nodos', '1 1 1',
    format('%s %s %s',
        (SELECT COUNT(*) FROM norte.producto  WHERE id_producto = 31),
        (SELECT COUNT(*) FROM centro.producto WHERE id_producto = 31),
        (SELECT COUNT(*) FROM sur.producto    WHERE id_producto = 31));

-- E10. Replicacion atomica: si un nodo rechaza el cambio, ningun nodo lo aplica.
--      Se mete el producto 32 directo en el Sur; al darlo de alta en la vista global
--      Norte y Centro lo aceptan, pero el Sur lo rechaza (llave duplicada).
INSERT INTO sur.producto VALUES (32, 'Solo en el Sur', 'Botanas', 20.00);
DO $$ BEGIN
    INSERT INTO producto VALUES (32, 'Producto 32', 'Botanas', 25.00);
    INSERT INTO resultado VALUES ('E10a el Sur rechaza la replica', 'error', 'se inserto');
EXCEPTION WHEN OTHERS THEN
    INSERT INTO resultado VALUES ('E10a el Sur rechaza la replica', 'error', 'error');
END $$;
INSERT INTO resultado SELECT 'E10b Norte y Centro no quedaron con el alta', '0 0',
    format('%s %s',
        (SELECT COUNT(*) FROM norte.producto  WHERE id_producto = 32),
        (SELECT COUNT(*) FROM centro.producto WHERE id_producto = 32));

-- E11. Borrar una venta desde el central borra tambien su detalle
DELETE FROM venta WHERE id_venta = (SELECT id_venta FROM e5_venta);
INSERT INTO resultado SELECT 'E11 venta y detalle borrados', '0 0',
    format('%s %s',
        (SELECT COUNT(*) FROM norte.venta_n   WHERE id_venta = (SELECT id_venta FROM e5_venta)),
        (SELECT COUNT(*) FROM norte.detalle_n WHERE id_venta = (SELECT id_venta FROM e5_venta)));

-- E12. Despues de todas las escrituras se siguen cumpliendo completitud y disyuncion
INSERT INTO resultado SELECT 'E12 completitud y disyuncion de venta', 'true',
    ((SELECT COUNT(*) FROM venta) = (SELECT COUNT(DISTINCT id_venta) FROM venta))::text;

SELECT prueba, esperado, obtenido, esperado = obtenido AS ok FROM resultado;
SELECT COUNT(*) FILTER (WHERE esperado = obtenido) AS aprobadas, COUNT(*) AS total FROM resultado;

ROLLBACK;
