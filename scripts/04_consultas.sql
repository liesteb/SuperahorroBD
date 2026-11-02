-- ============================================================
-- 04_consultas.sql  |  Ejecutar en: nodo_central (salvo la C1)
-- Consultas distribuidas de ejemplo
-- ============================================================

-- C1. Consulta LOCAL (ejecutar en nodo_norte): ventas de octubre por sucursal.
--     No sale del nodo porque venta_n y sucursal_n estan juntas.
-- SELECT s.ciudad, COUNT(*) AS num_ventas, SUM(v.total) AS monto
-- FROM venta_n v JOIN sucursal_n s ON s.id_sucursal = v.id_sucursal
-- WHERE v.fecha BETWEEN '2026-10-01' AND '2026-10-31'
-- GROUP BY s.ciudad ORDER BY monto DESC;

-- C2. Ventas totales por region (toca los 3 nodos)
SELECT s.region, COUNT(*) AS num_ventas, SUM(v.total) AS monto_total
FROM venta v JOIN sucursal s ON s.id_sucursal = v.id_sucursal
GROUP BY s.region
ORDER BY monto_total DESC;

-- C3. Top 5 productos mas vendidos en toda la cadena
SELECT p.nombre, p.categoria, SUM(d.cantidad) AS unidades
FROM detalle_venta d JOIN producto p ON p.id_producto = d.id_producto
GROUP BY p.nombre, p.categoria
ORDER BY unidades DESC
LIMIT 5;

-- C4. Productos por debajo del stock minimo en cualquier sucursal
SELECT s.ciudad, p.nombre, i.existencia, i.stock_minimo
FROM inventario i
JOIN sucursal s ON s.id_sucursal = i.id_sucursal
JOIN producto p ON p.id_producto = i.id_producto
WHERE i.existencia < i.stock_minimo
ORDER BY s.ciudad, i.existencia;

-- C5. Ventas por mes y region (para una grafica del reporte)
SELECT s.region, EXTRACT(MONTH FROM v.fecha) AS mes, SUM(v.total) AS monto
FROM venta v JOIN sucursal s ON s.id_sucursal = v.id_sucursal
GROUP BY s.region, mes
ORDER BY mes, s.region;

-- C6. Localizacion: la consulta es sobre la vista global pero el plan
--     muestra que solo se manda al nodo Norte (un solo Foreign Scan).
SET constraint_exclusion = partition;
EXPLAIN (VERBOSE, COSTS OFF)
SELECT COUNT(*), SUM(total) FROM venta WHERE id_sucursal = 100;

-- C7. Sin filtro de sucursal el plan muestra un Append con los 3 nodos.
EXPLAIN (VERBOSE, COSTS OFF)
SELECT COUNT(*), SUM(total) FROM venta;
