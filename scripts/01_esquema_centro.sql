-- ============================================================
-- 01_esquema_centro.sql  |  Ejecutar en: nodo_centro
-- Crea los fragmentos de la region Centro y la copia de producto
-- ============================================================

-- Copia replicada del catalogo (igual en los 3 nodos)
CREATE TABLE producto (
    id_producto  INT PRIMARY KEY,
    nombre       VARCHAR(80)   NOT NULL,
    categoria    VARCHAR(40)   NOT NULL,
    precio       NUMERIC(10,2) NOT NULL CHECK (precio > 0)
);

-- Fragmento horizontal primario: SUCURSAL_C = SELECCION region = 'Centro'
CREATE TABLE sucursal_c (
    id_sucursal  INT PRIMARY KEY,
    nombre       VARCHAR(60) NOT NULL,
    ciudad       VARCHAR(40) NOT NULL,
    region       VARCHAR(10) NOT NULL,
    gerente      VARCHAR(60),
    CONSTRAINT ck_sucursal_c_region CHECK (region = 'Centro'),
    CONSTRAINT ck_sucursal_c_rango  CHECK (id_sucursal BETWEEN 200 AND 299)
);

-- Fragmento derivado: INVENTARIO_C = INVENTARIO SEMIJOIN SUCURSAL_C
CREATE TABLE inventario_c (
    id_sucursal   INT NOT NULL REFERENCES sucursal_c(id_sucursal),
    id_producto   INT NOT NULL REFERENCES producto(id_producto),
    existencia    INT NOT NULL CHECK (existencia >= 0),
    stock_minimo  INT NOT NULL DEFAULT 10,
    PRIMARY KEY (id_sucursal, id_producto)
);

-- Fragmento derivado: VENTA_C = VENTA SEMIJOIN SUCURSAL_C
CREATE TABLE venta_c (
    id_venta     INT PRIMARY KEY,
    id_sucursal  INT NOT NULL REFERENCES sucursal_c(id_sucursal),
    fecha        DATE NOT NULL,
    total        NUMERIC(12,2) NOT NULL DEFAULT 0,
    metodo_pago  VARCHAR(15) NOT NULL CHECK (metodo_pago IN ('Efectivo','Tarjeta','Transferencia')),
    CONSTRAINT ck_venta_c_rango CHECK (id_venta BETWEEN 2000000 AND 2999999)
);

-- Fragmento derivado de segundo nivel: DETALLE_C = DETALLE_VENTA SEMIJOIN VENTA_C
CREATE TABLE detalle_c (
    id_venta         INT NOT NULL REFERENCES venta_c(id_venta),
    id_producto      INT NOT NULL REFERENCES producto(id_producto),
    cantidad         INT NOT NULL CHECK (cantidad > 0),
    precio_unitario  NUMERIC(10,2) NOT NULL,
    PRIMARY KEY (id_venta, id_producto)
);
