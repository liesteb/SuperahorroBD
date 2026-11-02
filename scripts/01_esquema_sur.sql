-- ============================================================
-- 01_esquema_sur.sql  |  Ejecutar en: nodo_sur
-- Crea los fragmentos de la region Sur y la copia de producto
-- ============================================================

-- Copia replicada del catalogo (igual en los 3 nodos)
CREATE TABLE producto (
    id_producto  INT PRIMARY KEY,
    nombre       VARCHAR(80)   NOT NULL,
    categoria    VARCHAR(40)   NOT NULL,
    precio       NUMERIC(10,2) NOT NULL CHECK (precio > 0)
);

-- Fragmento horizontal primario: SUCURSAL_S = SELECCION region = 'Sur'
CREATE TABLE sucursal_s (
    id_sucursal  INT PRIMARY KEY,
    nombre       VARCHAR(60) NOT NULL,
    ciudad       VARCHAR(40) NOT NULL,
    region       VARCHAR(10) NOT NULL,
    gerente      VARCHAR(60),
    CONSTRAINT ck_sucursal_s_region CHECK (region = 'Sur'),
    CONSTRAINT ck_sucursal_s_rango  CHECK (id_sucursal BETWEEN 300 AND 399)
);

-- Fragmento derivado: INVENTARIO_S = INVENTARIO SEMIJOIN SUCURSAL_S
CREATE TABLE inventario_s (
    id_sucursal   INT NOT NULL REFERENCES sucursal_s(id_sucursal),
    id_producto   INT NOT NULL REFERENCES producto(id_producto),
    existencia    INT NOT NULL CHECK (existencia >= 0),
    stock_minimo  INT NOT NULL DEFAULT 10,
    PRIMARY KEY (id_sucursal, id_producto)
);

-- Fragmento derivado: VENTA_S = VENTA SEMIJOIN SUCURSAL_S
CREATE TABLE venta_s (
    id_venta     INT PRIMARY KEY,
    id_sucursal  INT NOT NULL REFERENCES sucursal_s(id_sucursal),
    fecha        DATE NOT NULL,
    total        NUMERIC(12,2) NOT NULL DEFAULT 0,
    metodo_pago  VARCHAR(15) NOT NULL CHECK (metodo_pago IN ('Efectivo','Tarjeta','Transferencia')),
    CONSTRAINT ck_venta_s_rango CHECK (id_venta BETWEEN 3000000 AND 3999999)
);

-- Fragmento derivado de segundo nivel: DETALLE_S = DETALLE_VENTA SEMIJOIN VENTA_S
CREATE TABLE detalle_s (
    id_venta         INT NOT NULL REFERENCES venta_s(id_venta),
    id_producto      INT NOT NULL REFERENCES producto(id_producto),
    cantidad         INT NOT NULL CHECK (cantidad > 0),
    precio_unitario  NUMERIC(10,2) NOT NULL,
    PRIMARY KEY (id_venta, id_producto)
);
