-- ============================================================
-- 02_datos_norte.sql  |  Ejecutar en: nodo_norte (despues del 01)
-- Datos de prueba de la region Norte
-- ============================================================
SELECT setseed(0.1);

-- Catalogo replicado: 30 productos (identico en los 3 nodos)
INSERT INTO producto (id_producto, nombre, categoria, precio)
SELECT g,
       'Producto ' || g,
       (ARRAY['Abarrotes','Bebidas','Limpieza','Lacteos','Botanas'])[1 + (g % 5)],
       ROUND((15 + (g * 7) % 120)::numeric, 2)
FROM generate_series(1, 30) AS g;

-- 3 sucursales de la region
INSERT INTO sucursal_n (id_sucursal, nombre, ciudad, region, gerente) VALUES
(100,'SuperAhorro Centro Civico','Mexicali','Norte','Laura Ruiz'),
(101,'SuperAhorro Zona Rio','Tijuana','Norte','Jorge Pena'),
(102,'SuperAhorro Cumbres','Monterrey','Norte','Ana Salas');

-- Inventario: cada sucursal tiene los 30 productos
INSERT INTO inventario_n (id_sucursal, id_producto, existencia, stock_minimo)
SELECT s.id_sucursal, p.id_producto, (random() * 200)::int, 10
FROM sucursal_n s CROSS JOIN producto p;

-- 600 ventas (200 por sucursal) durante 2026
INSERT INTO venta_n (id_venta, id_sucursal, fecha, metodo_pago)
SELECT 1000000 + g - 1,
       100 + (g % 3),
       DATE '2026-01-01' + (random() * 300)::int,
       (ARRAY['Efectivo','Tarjeta','Transferencia'])[1 + (random() * 2)::int]
FROM generate_series(1, 600) AS g;

-- Detalle: de 1 a 4 productos distintos por venta
INSERT INTO detalle_n (id_venta, id_producto, cantidad, precio_unitario)
SELECT v.id_venta, p.id_producto, 1 + (random() * 4)::int, p.precio
FROM venta_n v
CROSS JOIN LATERAL (
    SELECT id_producto, precio FROM producto
    WHERE v.id_venta > 0
    ORDER BY random()
    LIMIT 1 + (random() * 3)::int
) p;

-- Calcular el total de cada venta a partir de su detalle
UPDATE venta_n v
SET total = d.suma
FROM (SELECT id_venta, SUM(cantidad * precio_unitario) AS suma
      FROM detalle_n GROUP BY id_venta) d
WHERE d.id_venta = v.id_venta;
