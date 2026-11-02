-- ============================================================
-- 05_pruebas.sql  |  Ejecutar en: nodo_central
-- Pruebas de completitud, reconstruccion y disyuncion
-- Cada prueba indica el resultado esperado
-- ============================================================

-- P1. COMPLETITUD: la suma de los fragmentos es igual al total global
--     Esperado: las dos columnas iguales en cada renglon
SELECT 'sucursal' AS tabla,
       (SELECT COUNT(*) FROM norte.sucursal_n) + (SELECT COUNT(*) FROM centro.sucursal_c) + (SELECT COUNT(*) FROM sur.sucursal_s) AS suma_fragmentos,
       (SELECT COUNT(*) FROM sucursal) AS total_global
UNION ALL
SELECT 'venta',
       (SELECT COUNT(*) FROM norte.venta_n) + (SELECT COUNT(*) FROM centro.venta_c) + (SELECT COUNT(*) FROM sur.venta_s),
       (SELECT COUNT(*) FROM venta)
UNION ALL
SELECT 'detalle_venta',
       (SELECT COUNT(*) FROM norte.detalle_n) + (SELECT COUNT(*) FROM centro.detalle_c) + (SELECT COUNT(*) FROM sur.detalle_s),
       (SELECT COUNT(*) FROM detalle_venta)
UNION ALL
SELECT 'inventario',
       (SELECT COUNT(*) FROM norte.inventario_n) + (SELECT COUNT(*) FROM centro.inventario_c) + (SELECT COUNT(*) FROM sur.inventario_s),
       (SELECT COUNT(*) FROM inventario);

-- P2. COMPLETITUD de la derivada: ninguna venta sin sucursal ni detalle sin venta
--     Esperado: 0 y 0
SELECT
  (SELECT COUNT(*) FROM venta v LEFT JOIN sucursal s ON s.id_sucursal = v.id_sucursal WHERE s.id_sucursal IS NULL) AS ventas_huerfanas,
  (SELECT COUNT(*) FROM detalle_venta d LEFT JOIN venta v ON v.id_venta = d.id_venta WHERE v.id_venta IS NULL) AS detalles_huerfanos;

-- P3. RECONSTRUCCION: UNION (sin duplicados) da lo mismo que UNION ALL
--     Esperado: las dos columnas iguales
SELECT
  (SELECT COUNT(*) FROM (SELECT * FROM norte.venta_n UNION SELECT * FROM centro.venta_c UNION SELECT * FROM sur.venta_s) u) AS con_union,
  (SELECT COUNT(*) FROM venta) AS con_union_all;

-- P4. DISYUNCION: ningun id aparece en dos fragmentos
--     Esperado: 0 renglones en cada consulta
SELECT id_sucursal, COUNT(*) FROM sucursal GROUP BY id_sucursal HAVING COUNT(*) > 1;
SELECT id_venta, COUNT(*) FROM venta GROUP BY id_venta HAVING COUNT(*) > 1;

-- P5. CORRECCION de la derivada: cada venta esta en el nodo de la region de su sucursal
--     Esperado: 0 en las tres columnas
SELECT
  (SELECT COUNT(*) FROM norte.venta_n v  JOIN sucursal s ON s.id_sucursal = v.id_sucursal WHERE s.region <> 'Norte')  AS mal_norte,
  (SELECT COUNT(*) FROM centro.venta_c v JOIN sucursal s ON s.id_sucursal = v.id_sucursal WHERE s.region <> 'Centro') AS mal_centro,
  (SELECT COUNT(*) FROM sur.venta_s v    JOIN sucursal s ON s.id_sucursal = v.id_sucursal WHERE s.region <> 'Sur')    AS mal_sur;

-- P6. REPLICACION: las 3 copias de producto son identicas
--     Esperado: 0 y 0
SELECT
  (SELECT COUNT(*) FROM (SELECT * FROM norte.producto EXCEPT SELECT * FROM centro.producto) x) AS dif_norte_centro,
  (SELECT COUNT(*) FROM (SELECT * FROM norte.producto EXCEPT SELECT * FROM sur.producto) x)    AS dif_norte_sur;

-- P7. RESTRICCION del fragmento (ejecutar en nodo_norte, debe FALLAR):
--     una sucursal del Sur no puede guardarse en el nodo Norte
-- INSERT INTO sucursal_n VALUES (150, 'Prueba', 'Merida', 'Sur', 'X');
--     Error esperado: viola la restriccion ck_sucursal_n_region
