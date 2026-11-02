-- ============================================================
-- 03_central.sql  |  Ejecutar en: nodo_central
-- Conecta el nodo central con los 3 nodos regionales (postgres_fdw)
-- y crea las vistas que reconstruyen las tablas globales
-- ============================================================
CREATE EXTENSION IF NOT EXISTS postgres_fdw;

-- 1. Servidores remotos
--    Con Docker: host = nombre del contenedor y port = 5432
--    Con un solo servidor (sin Docker): host 'localhost' y port '5432'
--    connect_timeout: si un nodo esta caido la consulta falla en 3 s en vez de quedarse esperando
CREATE SERVER srv_norte  FOREIGN DATA WRAPPER postgres_fdw OPTIONS (host 'nodo_norte',  port '5432', dbname 'nodo_norte',  connect_timeout '3');
CREATE SERVER srv_centro FOREIGN DATA WRAPPER postgres_fdw OPTIONS (host 'nodo_centro', port '5432', dbname 'nodo_centro', connect_timeout '3');
CREATE SERVER srv_sur    FOREIGN DATA WRAPPER postgres_fdw OPTIONS (host 'nodo_sur',    port '5432', dbname 'nodo_sur',    connect_timeout '3');

-- 2. Usuario con el que el central entra a cada nodo
CREATE USER MAPPING FOR CURRENT_USER SERVER srv_norte  OPTIONS (user 'postgres', password 'admin');
CREATE USER MAPPING FOR CURRENT_USER SERVER srv_centro OPTIONS (user 'postgres', password 'admin');
CREATE USER MAPPING FOR CURRENT_USER SERVER srv_sur    OPTIONS (user 'postgres', password 'admin');

-- 3. Un esquema por nodo con las tablas remotas (fragmentos)
CREATE SCHEMA norte;
CREATE SCHEMA centro;
CREATE SCHEMA sur;

IMPORT FOREIGN SCHEMA public LIMIT TO (sucursal_n, inventario_n, venta_n, detalle_n, producto)
    FROM SERVER srv_norte INTO norte;
IMPORT FOREIGN SCHEMA public LIMIT TO (sucursal_c, inventario_c, venta_c, detalle_c, producto)
    FROM SERVER srv_centro INTO centro;
IMPORT FOREIGN SCHEMA public LIMIT TO (sucursal_s, inventario_s, venta_s, detalle_s, producto)
    FROM SERVER srv_sur INTO sur;

-- 4. Vistas de reconstruccion: tabla global = union de sus fragmentos
CREATE VIEW sucursal AS
    SELECT * FROM norte.sucursal_n
    UNION ALL SELECT * FROM centro.sucursal_c
    UNION ALL SELECT * FROM sur.sucursal_s;

CREATE VIEW inventario AS
    SELECT * FROM norte.inventario_n
    UNION ALL SELECT * FROM centro.inventario_c
    UNION ALL SELECT * FROM sur.inventario_s;

CREATE VIEW venta AS
    SELECT * FROM norte.venta_n
    UNION ALL SELECT * FROM centro.venta_c
    UNION ALL SELECT * FROM sur.venta_s;

CREATE VIEW detalle_venta AS
    SELECT * FROM norte.detalle_n
    UNION ALL SELECT * FROM centro.detalle_c
    UNION ALL SELECT * FROM sur.detalle_s;

-- producto esta replicado: basta con leer una copia
CREATE VIEW producto AS
    SELECT * FROM norte.producto;

-- 5. Localizacion de datos: se le dice al central que contiene cada fragmento.
--    Estas restricciones NO se validan en el remoto, solo sirven para que el
--    optimizador descarte los nodos que no tienen los datos pedidos.
SET constraint_exclusion = partition;

ALTER FOREIGN TABLE norte.sucursal_n  ADD CONSTRAINT loc_suc_n CHECK (region = 'Norte' AND id_sucursal BETWEEN 100 AND 199);
ALTER FOREIGN TABLE centro.sucursal_c ADD CONSTRAINT loc_suc_c CHECK (region = 'Centro' AND id_sucursal BETWEEN 200 AND 299);
ALTER FOREIGN TABLE sur.sucursal_s    ADD CONSTRAINT loc_suc_s CHECK (region = 'Sur' AND id_sucursal BETWEEN 300 AND 399);

ALTER FOREIGN TABLE norte.inventario_n  ADD CONSTRAINT loc_inv_n CHECK (id_sucursal BETWEEN 100 AND 199);
ALTER FOREIGN TABLE centro.inventario_c ADD CONSTRAINT loc_inv_c CHECK (id_sucursal BETWEEN 200 AND 299);
ALTER FOREIGN TABLE sur.inventario_s    ADD CONSTRAINT loc_inv_s CHECK (id_sucursal BETWEEN 300 AND 399);

ALTER FOREIGN TABLE norte.venta_n  ADD CONSTRAINT loc_ven_n CHECK (id_sucursal BETWEEN 100 AND 199 AND id_venta BETWEEN 1000000 AND 1999999);
ALTER FOREIGN TABLE centro.venta_c ADD CONSTRAINT loc_ven_c CHECK (id_sucursal BETWEEN 200 AND 299 AND id_venta BETWEEN 2000000 AND 2999999);
ALTER FOREIGN TABLE sur.venta_s    ADD CONSTRAINT loc_ven_s CHECK (id_sucursal BETWEEN 300 AND 399 AND id_venta BETWEEN 3000000 AND 3999999);

ALTER FOREIGN TABLE norte.detalle_n  ADD CONSTRAINT loc_det_n CHECK (id_venta BETWEEN 1000000 AND 1999999);
ALTER FOREIGN TABLE centro.detalle_c ADD CONSTRAINT loc_det_c CHECK (id_venta BETWEEN 2000000 AND 2999999);
ALTER FOREIGN TABLE sur.detalle_s    ADD CONSTRAINT loc_det_s CHECK (id_venta BETWEEN 3000000 AND 3999999);
