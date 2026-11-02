-- ============================================================
-- 01_esquema_norte.sql  |  Ejecutar en: nodo_norte
-- Crea los fragmentos de la region Norte y la copia de producto
-- ============================================================

-- Copia replicada del catalogo (igual en los 3 nodos)
CREATE TABLE producto (
    id_producto  INT PRIMARY KEY,
    nombre       VARCHAR(80)   NOT NULL,
    categoria    VARCHAR(40)   NOT NULL,
    precio       NUMERIC(10,2) NOT NULL CHECK (precio > 0)
);

-- Fragmento horizontal primario: SUCURSAL_N = SELECCION region = 'Norte'
CREATE TABLE sucursal_n (
    id_sucursal  INT PRIMARY KEY,
    nombre       VARCHAR(60) NOT NULL,
    ciudad       VARCHAR(40) NOT NULL,
    region       VARCHAR(10) NOT NULL,
    gerente      VARCHAR(60),
    CONSTRAINT ck_sucursal_n_region CHECK (region = 'Norte'),
    CONSTRAINT ck_sucursal_n_rango  CHECK (id_sucursal BETWEEN 100 AND 199)
);

-- Fragmento derivado: INVENTARIO_N = INVENTARIO SEMIJOIN SUCURSAL_N
CREATE TABLE inventario_n (
    id_sucursal   INT NOT NULL REFERENCES sucursal_n(id_sucursal),
    id_producto   INT NOT NULL REFERENCES producto(id_producto),
    existencia    INT NOT NULL CHECK (existencia >= 0),
    stock_minimo  INT NOT NULL DEFAULT 10,
    PRIMARY KEY (id_sucursal, id_producto)
);

-- Fragmento derivado: VENTA_N = VENTA SEMIJOIN SUCURSAL_N
CREATE TABLE venta_n (
    id_venta     INT PRIMARY KEY,
    id_sucursal  INT NOT NULL REFERENCES sucursal_n(id_sucursal),
    fecha        DATE NOT NULL,
    total        NUMERIC(12,2) NOT NULL DEFAULT 0,
    metodo_pago  VARCHAR(15) NOT NULL CHECK (metodo_pago IN ('Efectivo','Tarjeta','Transferencia')),
    CONSTRAINT ck_venta_n_rango CHECK (id_venta BETWEEN 1000000 AND 1999999)
);

-- Fragmento derivado de segundo nivel: DETALLE_N = DETALLE_VENTA SEMIJOIN VENTA_N
CREATE TABLE detalle_n (
    id_venta         INT NOT NULL REFERENCES venta_n(id_venta),
    id_producto      INT NOT NULL REFERENCES producto(id_producto),
    cantidad         INT NOT NULL CHECK (cantidad > 0),
    precio_unitario  NUMERIC(10,2) NOT NULL,
    PRIMARY KEY (id_venta, id_producto)
);
