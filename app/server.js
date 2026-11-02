// Panel web de SuperAhorro.
// Solo se conecta al nodo central: la aplicacion no sabe en que nodo esta cada
// dato (transparencia de distribucion); el central lo resuelve con postgres_fdw.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const PUERTO = Number(process.env.PORT || 3000);
const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT || 5436),
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'admin',
  database: process.env.PGDATABASE || 'nodo_central',
  max: 8,
});
// Si un cliente inactivo pierde la conexion no debe tumbar el servidor
pool.on('error', (err) => console.error('pool:', err.message));

const REGIONES = [
  { region: 'Norte', esquema: 'norte', sufijo: 'n' },
  { region: 'Centro', esquema: 'centro', sufijo: 'c' },
  { region: 'Sur', esquema: 'sur', sufijo: 's' },
];

class ErrorHttp extends Error {
  constructor(estado, mensaje) {
    super(mensaje);
    this.estado = estado;
  }
}

async function q(sql, params) {
  return (await pool.query(sql, params)).rows;
}

// ---------- Rutas de la API ----------

// Estado de cada nodo regional: se consulta solo su fragmento, asi que un nodo
// caido no impide ver a los demas.
async function nodos() {
  return Promise.all(REGIONES.map(async (r) => {
    const t0 = Date.now();
    const f = (tabla) => `${r.esquema}.${tabla}_${r.sufijo}`;
    try {
      const [fila] = await q(`SELECT
          (SELECT COUNT(*) FROM ${f('sucursal')})::int   AS sucursales,
          (SELECT COUNT(*) FROM ${f('inventario')})::int AS inventario,
          (SELECT COUNT(*) FROM ${f('venta')})::int      AS ventas,
          (SELECT COUNT(*) FROM ${f('detalle')})::int    AS detalles,
          (SELECT COUNT(*) FROM ${r.esquema}.producto)::int AS productos`);
      return { ...r, activo: true, latencia_ms: Date.now() - t0, ...fila };
    } catch (err) {
      return { ...r, activo: false, latencia_ms: Date.now() - t0, error: err.message };
    }
  }));
}

async function resumen() {
  const [kpi] = await q(`SELECT COUNT(*)::int AS ventas, COALESCE(SUM(total), 0)::float AS monto,
      COALESCE(AVG(total), 0)::float AS ticket_promedio,
      (SELECT COUNT(*) FROM inventario WHERE existencia < stock_minimo)::int AS bajo_stock
    FROM venta`);
  const regiones = await q(`SELECT s.region, COUNT(*)::int AS ventas, SUM(v.total)::float AS monto
    FROM venta v JOIN sucursal s ON s.id_sucursal = v.id_sucursal
    GROUP BY s.region`);
  return { ...kpi, regiones };
}

const ventasMes = () => q(`SELECT s.region, EXTRACT(MONTH FROM v.fecha)::int AS mes, SUM(v.total)::float AS monto
  FROM venta v JOIN sucursal s ON s.id_sucursal = v.id_sucursal
  GROUP BY s.region, mes ORDER BY mes, s.region`);

const topProductos = () => q(`SELECT p.id_producto, p.nombre, p.categoria, SUM(d.cantidad)::int AS unidades
  FROM detalle_venta d JOIN producto p ON p.id_producto = d.id_producto
  GROUP BY p.id_producto, p.nombre, p.categoria ORDER BY unidades DESC, p.id_producto LIMIT 8`);

const stockBajo = () => q(`SELECT s.id_sucursal, s.ciudad, s.region, p.nombre, i.existencia, i.stock_minimo
  FROM inventario i
  JOIN sucursal s ON s.id_sucursal = i.id_sucursal
  JOIN producto p ON p.id_producto = i.id_producto
  WHERE i.existencia < i.stock_minimo
  ORDER BY i.existencia, s.ciudad`);

const ventasRecientes = () => q(`SELECT v.id_venta, v.fecha, v.total::float AS total, v.metodo_pago,
    s.id_sucursal, s.nombre AS sucursal, s.region
  FROM venta v JOIN sucursal s ON s.id_sucursal = v.id_sucursal
  ORDER BY v.fecha DESC, v.id_venta DESC LIMIT 12`);

// Disponibilidad parcial: se lee cada fragmento por separado para que, si un nodo
// cae, se puedan seguir registrando ventas en las sucursales de los otros nodos.
async function sucursales() {
  const partes = await Promise.allSettled(REGIONES.map((r) =>
    q(`SELECT * FROM ${r.esquema}.sucursal_${r.sufijo} ORDER BY id_sucursal`)));
  const disponibles = partes.filter((p) => p.status === 'fulfilled');
  if (disponibles.length === 0) throw partes[0].reason;
  return disponibles.flatMap((p) => p.value);
}

// Catalogo con las 3 copias lado a lado para ver que la replica es consistente
const productos = () => q(`SELECT n.id_producto, n.nombre, n.categoria,
    n.precio::float AS precio_norte, c.precio::float AS precio_centro, s.precio::float AS precio_sur
  FROM norte.producto n
  FULL JOIN centro.producto c USING (id_producto)
  FULL JOIN sur.producto s USING (id_producto)
  ORDER BY 1`);

async function inventarioSucursal(url) {
  // Se lee el inventario y la copia del catalogo del mismo nodo de la sucursal
  // (catalogo de localizacion del central), sin tocar los demas nodos
  const id = entero(url.searchParams.get('sucursal'), 'sucursal');
  const [l] = await q(`SELECT esquema, sufijo FROM nodo_de_sucursal($1)`, [id]);
  return q(`SELECT p.id_producto, p.nombre, p.precio::float AS precio, i.existencia
    FROM ${l.esquema}.inventario_${l.sufijo} i JOIN ${l.esquema}.producto p ON p.id_producto = i.id_producto
    WHERE i.id_sucursal = $1 ORDER BY p.id_producto`, [id]);
}

// Plan de la consulta: muestra a que nodos manda la consulta el optimizador
async function plan(url) {
  const valor = url.searchParams.get('sucursal');
  const filtro = valor && valor !== 'todas' ? ` WHERE id_sucursal = ${entero(valor, 'sucursal')}` : '';
  const consulta = `SELECT COUNT(*), SUM(total) FROM venta${filtro}`;
  const filas = await q(`EXPLAIN (VERBOSE, COSTS OFF) ${consulta}`);
  const texto = filas.map((f) => f['QUERY PLAN']).join('\n');
  const nodosTocados = REGIONES
    .filter((r) => texto.includes(`Foreign Scan on ${r.esquema}.venta_${r.sufijo}`))
    .map((r) => r.region);
  return { consulta, plan: texto, nodos: nodosTocados };
}

async function registrarVenta(cuerpo) {
  const id = entero(cuerpo.id_sucursal, 'id_sucursal');
  if (!Array.isArray(cuerpo.items) || cuerpo.items.length === 0) {
    throw new ErrorHttp(400, 'La venta debe tener al menos un producto');
  }
  const items = cuerpo.items.map((it) => ({
    id_producto: entero(it.id_producto, 'id_producto'),
    cantidad: entero(it.cantidad, 'cantidad'),
  }));
  const [fila] = await q(`SELECT registrar_venta($1, $2, $3::jsonb) AS id_venta`,
    [id, cuerpo.metodo_pago, JSON.stringify(items)]);
  // Filtros constantes en las dos vistas: el optimizador solo consulta el nodo de la
  // sucursal, asi la respuesta llega aunque otro nodo este caido
  const [venta] = await q(`SELECT v.id_venta, v.total::float AS total, s.region, s.nombre AS sucursal
    FROM venta v, sucursal s
    WHERE v.id_venta = ${entero(fila.id_venta, 'id_venta')} AND s.id_sucursal = ${id}`);
  return venta;
}

async function cambiarPrecio(id, cuerpo) {
  const precio = Number(cuerpo.precio);
  if (!Number.isFinite(precio) || precio <= 0) throw new ErrorHttp(400, 'Precio invalido');
  const filas = await q(`UPDATE producto SET precio = $1 WHERE id_producto = $2 RETURNING id_producto`, [precio, id]);
  if (filas.length === 0) throw new ErrorHttp(404, `No existe el producto ${id}`);
  return { id_producto: id, precio };
}

// ---------- Utilidades ----------

function entero(valor, nombre) {
  const n = Number(valor);
  if (!Number.isInteger(n)) throw new ErrorHttp(400, `${nombre} debe ser un entero`);
  return n;
}

function leerCuerpo(req) {
  return new Promise((resolve, reject) => {
    let datos = '';
    req.on('data', (c) => {
      datos += c;
      if (datos.length > 1e5) reject(new ErrorHttp(413, 'Cuerpo demasiado grande'));
    });
    req.on('end', () => {
      try { resolve(datos ? JSON.parse(datos) : {}); } catch { reject(new ErrorHttp(400, 'JSON invalido')); }
    });
    req.on('error', reject);
  });
}

// Traduce los errores de PostgreSQL a codigos HTTP
function estadoDeError(err) {
  if (err.estado) return err.estado;
  const msg = err.message || '';
  if (err.code?.startsWith('08') || /could not connect to server|connection/i.test(msg)) return 503;
  if (err.code === 'P0001' || err.code?.startsWith('23') || err.code?.startsWith('22')) return 400;
  return 500;
}

function json(res, estado, datos) {
  res.writeHead(estado, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(datos));
}

const TIPOS = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
const PUBLICO = path.join(__dirname, 'public');

function estatico(res, ruta) {
  const archivo = path.normalize(path.join(PUBLICO, ruta === '/' ? 'index.html' : ruta));
  if (!archivo.startsWith(PUBLICO)) return json(res, 403, { error: 'Prohibido' });
  fs.readFile(archivo, (err, contenido) => {
    if (err) return json(res, 404, { error: 'No encontrado' });
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(archivo)] || 'application/octet-stream' });
    res.end(contenido);
  });
}

const RUTAS_GET = {
  '/api/nodos': nodos,
  '/api/resumen': resumen,
  '/api/ventas-mes': ventasMes,
  '/api/top-productos': topProductos,
  '/api/stock-bajo': stockBajo,
  '/api/ventas-recientes': ventasRecientes,
  '/api/sucursales': sucursales,
  '/api/productos': productos,
  '/api/inventario': inventarioSucursal,
  '/api/plan': plan,
};

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && RUTAS_GET[url.pathname]) {
      return json(res, 200, await RUTAS_GET[url.pathname](url));
    }
    if (req.method === 'POST' && url.pathname === '/api/ventas') {
      return json(res, 201, await registrarVenta(await leerCuerpo(req)));
    }
    const precio = url.pathname.match(/^\/api\/productos\/(\d+)$/);
    if (req.method === 'PUT' && precio) {
      return json(res, 200, await cambiarPrecio(Number(precio[1]), await leerCuerpo(req)));
    }
    if (req.method === 'GET' && !url.pathname.startsWith('/api/')) return estatico(res, url.pathname);
    json(res, 404, { error: 'Ruta no encontrada' });
  } catch (err) {
    const estado = estadoDeError(err);
    if (estado === 500) console.error(err);
    json(res, estado, { error: err.message });
  }
});

servidor.listen(PUERTO, () => console.log(`Panel SuperAhorro en http://localhost:${PUERTO}`));
