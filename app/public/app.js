// Panel SuperAhorro: todo se pide a la API, que a su vez solo consulta al nodo central.
const $ = (sel) => document.querySelector(sel);
const NS = 'http://www.w3.org/2000/svg';
const REGIONES = ['Norte', 'Centro', 'Sur'];
const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const dinero = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 });
const dinero2 = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
const num = new Intl.NumberFormat('es-MX');
const compacto = new Intl.NumberFormat('es-MX', { notation: 'compact', maximumFractionDigits: 1 });
const sinMovimiento = matchMedia('(prefers-reduced-motion: reduce)').matches;

const estado = { nodos: null, ventasMes: null, resumen: null, top: null, sucursales: [], inventario: [], productos: [], resaltar: null };

// ---------- utilidades ----------
async function api(ruta, opciones = {}) {
  const r = await fetch(ruta, { headers: { 'Content-Type': 'application/json' }, ...opciones });
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(datos.error || `Error ${r.status}`);
  return datos;
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const color = (region) => `var(--${region.toLowerCase()})`;
const etqRegion = (r) => `<span class="etq-region"><span class="punto" data-r="${esc(r)}"></span>${esc(r)}</span>`;

function vacio(el, mensaje, esError = false) {
  el.innerHTML = `<div class="estado-vacio${esError ? ' error' : ''}">${esc(mensaje)}</div>`;
}
function errorConsulta(err) {
  return /srv_(norte|centro|sur)/.test(err.message)
    ? `No disponible: ${err.message.replace(/.*server "srv_(\w+)".*/s, 'el nodo $1 no responde')}. La consulta global necesita los 3 fragmentos.`
    : `Error: ${err.message}`;
}
function svg(tag, attrs = {}, padre) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (padre) padre.appendChild(el);
  return el;
}
function techo(valor) {
  if (valor <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(valor));
  return [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => m * p).find((x) => x >= valor);
}
// Barra horizontal con el extremo de datos redondeado (4px) y la base recta
function barraH(x0, y, ancho, alto, r = 4) {
  const rr = Math.min(r, ancho, alto / 2);
  return `M${x0},${y} h${ancho - rr} a${rr},${rr} 0 0 1 ${rr},${rr} v${alto - 2 * rr} a${rr},${rr} 0 0 1 ${-rr},${rr} h${-(ancho - rr)} z`;
}

// ---------- tooltip ----------
const tip = $('#tooltip');
function mostrarTip(html, x, y) {
  tip.innerHTML = html;
  tip.hidden = false;
  const { width, height } = tip.getBoundingClientRect();
  let left = x + 14, top = y + 14;
  if (left + width > innerWidth - 8) left = x - width - 14;
  if (top + height > innerHeight - 8) top = y - height - 14;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}
const ocultarTip = () => { tip.hidden = true; };
const filaTip = (r, valor) => `<div class="t-fila"><span><span class="punto" style="background:${color(r)}"></span>${esc(r)}</span><span class="t-num">${valor}</span></div>`;

// ---------- topologia ----------
function pintarNodo(n) {
  const el = document.querySelector(`.nodo[data-nodo="${n.region}"]`);
  el.classList.toggle('caido', !n.activo);
  const pildora = n.activo
    ? '<span class="pildora pildora-ok"><i aria-hidden="true">●</i> Activo</span>'
    : '<span class="pildora pildora-caido"><i aria-hidden="true">✕</i> Caído</span>';
  const cuerpo = n.activo
    ? `<dl class="nodo-datos">
        <dt>Sucursales</dt><dd>${num.format(n.sucursales)}</dd>
        <dt>Ventas</dt><dd>${num.format(n.ventas)}</dd>
        <dt>Detalle</dt><dd>${num.format(n.detalles)}</dd>
        <dt>Inventario</dt><dd>${num.format(n.inventario)}</dd>
        <dt>Productos (réplica)</dt><dd>${num.format(n.productos)}</dd>
        <dt>Latencia</dt><dd>${n.latencia_ms} ms</dd>
      </dl>`
    : `<p class="nodo-error">${esc(n.error)}</p>`;
  el.innerHTML = `
    <div class="nodo-linea"><span class="nodo-nombre mono">nodo_${n.esquema}</span>${pildora}</div>
    <div class="region"><span class="punto"></span>Región ${esc(n.region)}</div>
    ${cuerpo}`;
  const arista = document.getElementById(`arista-${n.region}`);
  if (arista) arista.classList.toggle('caida', !n.activo);
}

function dibujarAristas() {
  const lienzo = $('#aristas');
  const caja = $('#topologia').getBoundingClientRect();
  const c = $('.nodo-central').getBoundingClientRect();
  const x1 = c.left + c.width / 2 - caja.left;
  const y1 = c.bottom - caja.top;
  lienzo.innerHTML = '';
  for (const r of REGIONES) {
    const b = document.querySelector(`.nodo[data-nodo="${r}"]`).getBoundingClientRect();
    const x2 = b.left + b.width / 2 - caja.left;
    const y2 = b.top - caja.top;
    const ym = (y1 + y2) / 2;
    const caida = estado.nodos?.find((n) => n.region === r)?.activo === false;
    const p = svg('path', { id: `arista-${r}`, class: `arista${caida ? ' caida' : ''}`, d: `M${x1},${y1} C${x1},${ym} ${x2},${ym} ${x2},${y2}` }, lienzo);
    p.style.setProperty('--color-arista', color(r));
  }
}

// Anima la peticion del central al nodo y su respuesta
function animarArista(region) {
  const arista = document.getElementById(`arista-${region}`);
  const tarjeta = document.querySelector(`.nodo[data-nodo="${region}"]`);
  if (!arista || !tarjeta) return;
  arista.classList.add('activa');
  tarjeta.classList.add('resaltado');
  if (!sinMovimiento) {
    const paquete = svg('circle', { r: 5, class: 'paquete' }, $('#aristas'));
    paquete.style.setProperty('--color-arista', color(region));
    const mov = svg('animateMotion', {
      dur: '1.1s', repeatCount: '1', fill: 'freeze', path: arista.getAttribute('d'),
      keyPoints: '0;1;0', keyTimes: '0;0.5;1', calcMode: 'linear',
    }, paquete);
    mov.beginElement();
    setTimeout(() => paquete.remove(), 1200);
  }
  clearTimeout(arista._t);
  arista._t = setTimeout(() => { arista.classList.remove('activa'); tarjeta.classList.remove('resaltado'); }, 2200);
}

async function actualizarNodos() {
  try {
    const nodos = await api('/api/nodos');
    const cambio = estado.nodos && nodos.some((n, i) => n.activo !== estado.nodos[i].activo);
    estado.nodos = nodos;
    nodos.forEach(pintarNodo);
    if (cambio) cargarTodo();
  } catch (err) {
    for (const r of REGIONES) {
      pintarNodo({ region: r, esquema: r.toLowerCase(), activo: false, error: 'Sin conexión con el panel o con el nodo central' });
    }
  }
}

// ---------- plan de consulta ----------
async function verPlan(e) {
  e?.preventDefault();
  const valor = $('#plan-sucursal').value;
  const caja = $('#plan-nodos');
  try {
    const d = await api(`/api/plan?sucursal=${encodeURIComponent(valor)}`);
    caja.innerHTML = REGIONES.map((r) => {
      const si = d.nodos.includes(r);
      return `<span class="chip ${si ? 'si' : 'no'}" style="--color:${color(r)}"><span class="punto" style="background:${si ? color(r) : 'var(--eje)'}"></span>${r}${si ? ' · consultado' : ' · descartado'}</span>`;
    }).join('');
    $('#plan-sql').textContent = d.consulta;
    $('#plan-texto').innerHTML = esc(d.plan).split('\n')
      .map((l) => (/Foreign Scan|Remote SQL/.test(l) ? `<span class="marca-remota">${l}</span>` : l)).join('\n');
    d.nodos.forEach(animarArista);
  } catch (err) {
    caja.innerHTML = '';
    $('#plan-sql').textContent = '';
    $('#plan-texto').textContent = err.message;
  }
}

// ---------- KPIs ----------
function pintarKpis(d) {
  $('#kpi-ventas').textContent = num.format(d.ventas);
  $('#kpi-monto').textContent = dinero.format(d.monto);
  $('#kpi-ticket').textContent = dinero2.format(d.ticket_promedio);
  $('#kpi-stock').textContent = num.format(d.bajo_stock);
}
function kpisNoDisponibles() {
  for (const id of ['kpi-ventas', 'kpi-monto', 'kpi-ticket', 'kpi-stock']) document.getElementById(id).textContent = '—';
}

// ---------- grafica de lineas: ventas por mes ----------
function graficaMes(filas) {
  const cont = $('#grafica-mes');
  cont.innerHTML = '';
  $('#leyenda-mes').innerHTML = REGIONES.map((r) => `<span><span class="punto" style="background:${color(r)}"></span>${r}</span>`).join('');
  const meses = [...new Set(filas.map((f) => f.mes))].sort((a, b) => a - b);
  if (meses.length === 0) return vacio(cont, 'Sin ventas');
  const serie = Object.fromEntries(REGIONES.map((r) => [r, meses.map((m) => filas.find((f) => f.region === r && f.mes === m)?.monto ?? 0)]));

  const W = cont.clientWidth, H = 270, m = { izq: 52, der: 68, arr: 12, aba: 26 };
  const ancho = W - m.izq - m.der, alto = H - m.arr - m.aba;
  const maxY = techo(Math.max(...Object.values(serie).flat()));
  const x = (i) => m.izq + (meses.length === 1 ? ancho / 2 : (i * ancho) / (meses.length - 1));
  const y = (v) => m.arr + alto - (v / maxY) * alto;
  const raiz = svg('svg', { viewBox: `0 0 ${W} ${H}`, height: H, role: 'img', 'aria-label': 'Ventas por mes y región' }, cont);

  for (let i = 0; i <= 4; i++) {
    const v = (maxY * i) / 4;
    svg('line', { class: i === 0 ? 'base' : 'reticula', x1: m.izq, x2: m.izq + ancho, y1: y(v), y2: y(v) }, raiz);
    svg('text', { x: m.izq - 8, y: y(v) + 4, 'text-anchor': 'end' }, raiz).textContent = compacto.format(v);
  }
  meses.forEach((mes, i) => {
    svg('text', { x: x(i), y: H - 6, 'text-anchor': 'middle' }, raiz).textContent = MESES[mes - 1];
  });

  // El mes en curso todavia no cierra: se marca para no leer la caida como real
  const mesActual = new Date().getMonth() + 1;
  if (meses.at(-1) === mesActual && meses.length > 1) {
    const xa = x(meses.length - 2), xb = x(meses.length - 1);
    raiz.prepend(svg('rect', { x: xa, y: m.arr, width: xb - xa, height: alto, fill: 'var(--superficie-2)' }));
    svg('text', { x: (xa + xb) / 2, y: m.arr + 12, 'text-anchor': 'middle' }, raiz).textContent = 'mes en curso';
  }

  // Etiquetas directas al final de cada linea, separadas para que no choquen
  // y sin salirse del area de la grafica
  const finales = REGIONES.map((r) => ({ r, y: y(serie[r].at(-1)) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < finales.length; i++) finales[i].y = Math.max(finales[i].y, finales[i - 1].y + 15);
  const exceso = finales.at(-1).y - (m.arr + alto - 6);
  if (exceso > 0) finales.forEach((f) => { f.y -= exceso; });

  for (const r of REGIONES) {
    const d = serie[r].map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ');
    svg('path', { class: 'linea', d, stroke: color(r) }, raiz).style.stroke = color(r);
    const f = finales.find((e) => e.r === r);
    svg('text', { class: 'etq-serie', x: x(meses.length - 1) + 10, y: f.y + 4 }, raiz).textContent = r;
  }

  // Capa de interaccion: linea guia + marcadores + tooltip
  const cruz = svg('line', { class: 'cruz', y1: m.arr, y2: m.arr + alto, visibility: 'hidden' }, raiz);
  const marcadores = REGIONES.map((r) => {
    const c = svg('circle', { class: 'marcador', r: 4.5, visibility: 'hidden' }, raiz);
    c.style.fill = color(r);
    return c;
  });
  const zona = svg('rect', { x: m.izq - 10, y: 0, width: ancho + 20, height: H, fill: 'transparent' }, raiz);
  zona.addEventListener('pointermove', (ev) => {
    const caja = raiz.getBoundingClientRect();
    const px = ((ev.clientX - caja.left) / caja.width) * W;
    const i = Math.max(0, Math.min(meses.length - 1, Math.round(((px - m.izq) / ancho) * (meses.length - 1))));
    cruz.setAttribute('x1', x(i)); cruz.setAttribute('x2', x(i)); cruz.setAttribute('visibility', 'visible');
    REGIONES.forEach((r, k) => {
      marcadores[k].setAttribute('cx', x(i)); marcadores[k].setAttribute('cy', y(serie[r][i]));
      marcadores[k].setAttribute('visibility', 'visible');
    });
    const orden = [...REGIONES].sort((a, b) => serie[b][i] - serie[a][i]);
    mostrarTip(`<b>${MESES[meses[i] - 1]} 2026</b>${orden.map((r) => filaTip(r, dinero.format(serie[r][i]))).join('')}`, ev.clientX, ev.clientY);
  });
  zona.addEventListener('pointerleave', () => {
    cruz.setAttribute('visibility', 'hidden');
    marcadores.forEach((c) => c.setAttribute('visibility', 'hidden'));
    ocultarTip();
  });

  // Vista de tabla (alternativa accesible)
  $('#tabla-mes').innerHTML = `<table><thead><tr><th>Mes</th>${REGIONES.map((r) => `<th class="num">${r}</th>`).join('')}</tr></thead><tbody>${
    meses.map((mes, i) => `<tr><td>${MESES[mes - 1]}</td>${REGIONES.map((r) => `<td class="num">${dinero.format(serie[r][i])}</td>`).join('')}</tr>`).join('')
  }</tbody></table>`;
}

// ---------- barras horizontales ----------
function barras(cont, filas, { etiqueta, valor, formato, colorDe, tooltip, ancho_etq = 74 }) {
  cont.innerHTML = '';
  if (filas.length === 0) return vacio(cont, 'Sin datos');
  const W = cont.clientWidth, alto_barra = 22, separacion = 12;
  const H = filas.length * (alto_barra + separacion) - separacion + 4;
  const m = { izq: ancho_etq, der: 74 };
  const ancho = W - m.izq - m.der;
  const max = Math.max(...filas.map(valor)) || 1;
  const raiz = svg('svg', { viewBox: `0 0 ${W} ${H}`, height: H, role: 'img' }, cont);
  svg('line', { class: 'base', x1: m.izq, x2: m.izq, y1: 0, y2: H }, raiz);
  filas.forEach((f, i) => {
    const y0 = i * (alto_barra + separacion);
    const g = svg('g', { class: 'fila-barra' }, raiz);
    const w = Math.max(2, (valor(f) / max) * ancho);
    svg('text', { x: m.izq - 8, y: y0 + alto_barra / 2 + 4, 'text-anchor': 'end', class: 'etq-serie' }, g).textContent = etiqueta(f);
    const b = svg('path', { class: 'barra', d: barraH(m.izq + 1, y0, w, alto_barra) }, g);
    b.style.fill = colorDe(f);
    svg('text', { x: m.izq + w + 8, y: y0 + alto_barra / 2 + 4, class: 'etq-valor' }, g).textContent = formato(valor(f));
    // zona de hover mas grande que la barra
    const zona = svg('rect', { x: 0, y: y0 - separacion / 2, width: W, height: alto_barra + separacion, fill: 'transparent' }, g);
    zona.addEventListener('pointermove', (ev) => mostrarTip(tooltip(f), ev.clientX, ev.clientY));
    zona.addEventListener('pointerleave', ocultarTip);
  });
}

function graficaRegion(d) {
  const total = d.regiones.reduce((s, r) => s + r.monto, 0) || 1;
  const filas = REGIONES.map((r) => d.regiones.find((x) => x.region === r) || { region: r, ventas: 0, monto: 0 });
  barras($('#grafica-region'), filas, {
    etiqueta: (f) => f.region,
    valor: (f) => f.monto,
    formato: (v) => compacto.format(v),
    colorDe: (f) => color(f.region),
    tooltip: (f) => `<b>Región ${esc(f.region)}</b>${filaTip(f.region, dinero.format(f.monto))}
      <div class="t-fila"><span>Ventas</span><span class="t-num">${num.format(f.ventas)}</span></div>
      <div class="t-fila"><span>Participación</span><span class="t-num">${((f.monto / total) * 100).toFixed(1)}%</span></div>`,
  });
  $('#tabla-region').innerHTML = `<table><thead><tr><th>Región</th><th class="num">Ventas</th><th class="num">Monto</th><th class="num">Ticket</th><th class="num">%</th></tr></thead><tbody>${
    filas.map((f) => `<tr><td>${etqRegion(f.region)}</td><td class="num">${num.format(f.ventas)}</td><td class="num">${dinero.format(f.monto)}</td>
      <td class="num">${dinero.format(f.ventas ? f.monto / f.ventas : 0)}</td><td class="num">${((f.monto / total) * 100).toFixed(1)}</td></tr>`).join('')
  }</tbody></table>`;
}

function graficaTop(filas) {
  barras($('#grafica-top'), filas, {
    etiqueta: (f) => f.nombre.replace('Producto ', 'P-'),
    valor: (f) => f.unidades,
    formato: (v) => `${num.format(v)} u`,
    colorDe: () => 'var(--neutro)',
    ancho_etq: 52,
    tooltip: (f) => `<b>${esc(f.nombre)}</b><div class="t-fila"><span>Categoría</span><span>${esc(f.categoria)}</span></div>
      <div class="t-fila"><span>Unidades</span><span class="t-num">${num.format(f.unidades)}</span></div>`,
  });
}

// ---------- tablas ----------
function tablaRecientes(filas) {
  $('#tabla-recientes').innerHTML = `<table><thead><tr><th>Venta</th><th>Fecha</th><th>Sucursal</th><th>Región</th><th>Pago</th><th class="num">Total</th></tr></thead><tbody>${
    filas.map((v) => `<tr class="${v.id_venta === estado.resaltar ? 'nuevo' : ''}">
      <td class="mono">${v.id_venta}</td><td class="mono">${v.fecha.slice(0, 10)}</td>
      <td>${esc(v.sucursal.replace('SuperAhorro ', ''))}</td><td>${etqRegion(v.region)}</td>
      <td>${esc(v.metodo_pago)}</td><td class="num">${dinero2.format(v.total)}</td></tr>`).join('')
  }</tbody></table>`;
}

function tablaStock(filas) {
  const el = $('#tabla-stock');
  if (filas.length === 0) return vacio(el, 'Todas las sucursales están por encima del stock mínimo');
  el.innerHTML = `<table><thead><tr><th>Sucursal</th><th>Región</th><th>Producto</th><th class="num">Existencia</th><th class="num">Mínimo</th></tr></thead><tbody>${
    filas.map((f) => `<tr><td>${esc(f.ciudad)} <span class="nota mono">#${f.id_sucursal}</span></td><td>${etqRegion(f.region)}</td>
      <td>${esc(f.nombre)}</td><td class="num ${f.existencia === 0 ? 'existencia-cero' : ''}">${f.existencia}</td><td class="num">${f.stock_minimo}</td></tr>`).join('')
  }</tbody></table>`;
}

function tablaCatalogo(filas, resaltar) {
  const precio = (v) => (v == null ? '<span class="estado-mal">falta</span>' : dinero2.format(v));
  $('#tabla-catalogo').innerHTML = `<table><thead><tr><th>ID</th><th>Producto</th><th>Categoría</th>
    <th class="num">Copia Norte</th><th class="num">Copia Centro</th><th class="num">Copia Sur</th><th>Réplica</th></tr></thead><tbody>${
    filas.map((p) => {
      const igual = p.precio_norte != null && p.precio_norte === p.precio_centro && p.precio_norte === p.precio_sur;
      return `<tr class="${p.id_producto === resaltar ? 'nuevo' : ''}"><td class="mono">${p.id_producto}</td><td>${esc(p.nombre)}</td><td>${esc(p.categoria)}</td>
        <td class="num">${precio(p.precio_norte)}</td><td class="num">${precio(p.precio_centro)}</td><td class="num">${precio(p.precio_sur)}</td>
        <td>${igual ? '<span class="estado-ok">✓ Consistente</span>' : '<span class="estado-mal">⚠ Diferente</span>'}</td></tr>`;
    }).join('')
  }</tbody></table>`;
  const sel = $('#precio-producto');
  const previo = sel.value;
  sel.innerHTML = filas.filter((p) => p.nombre).map((p) => `<option value="${p.id_producto}">${esc(p.nombre)} (${dinero2.format(p.precio_norte)})</option>`).join('');
  if (previo) sel.value = previo;
}

// ---------- sucursales (selects) ----------
function opcionesSucursales(sucursales) {
  return REGIONES.map((r) => `<optgroup label="Región ${r}">${
    sucursales.filter((s) => s.region === r).map((s) => `<option value="${s.id_sucursal}">${s.id_sucursal} · ${esc(s.nombre.replace('SuperAhorro ', ''))}, ${esc(s.ciudad)}</option>`).join('')
  }</optgroup>`).join('');
}
function pintarSucursales(sucursales) {
  const planSel = $('#plan-sucursal'), ventaSel = $('#venta-sucursal');
  const planPrevio = planSel.value, ventaPrevio = ventaSel.value;
  planSel.innerHTML = '<option value="todas">Toda la cadena</option>' + opcionesSucursales(sucursales);
  ventaSel.innerHTML = opcionesSucursales(sucursales);
  if (planPrevio) planSel.value = planPrevio;
  if (ventaPrevio && sucursales.some((s) => String(s.id_sucursal) === ventaPrevio)) ventaSel.value = ventaPrevio;
}

// ---------- registrar venta ----------
async function cargarInventarioVenta() {
  const id = $('#venta-sucursal').value;
  if (!id) return;
  try {
    estado.inventario = await api(`/api/inventario?sucursal=${id}`);
    $('#venta-items').innerHTML = '';
    agregarItem();
    mensaje('#venta-mensaje', '');
  } catch (err) {
    estado.inventario = [];
    $('#venta-items').innerHTML = '';
    mensaje('#venta-mensaje', errorConsulta(err), true);
  }
}

function agregarItem() {
  const fila = document.createElement('div');
  fila.className = 'item';
  const disponibles = estado.inventario.filter((p) => p.existencia > 0);
  fila.innerHTML = `
    <select aria-label="Producto">${estado.inventario.map((p) =>
      `<option value="${p.id_producto}" ${p.existencia === 0 ? 'disabled' : ''}>${esc(p.nombre)} · ${dinero2.format(p.precio)} · ${p.existencia} disp.</option>`).join('')}</select>
    <input type="number" min="1" value="1" aria-label="Cantidad">
    <button type="button" class="btn btn-fantasma quitar" aria-label="Quitar producto">×</button>`;
  const usados = [...document.querySelectorAll('#venta-items select')].map((s) => Number(s.value));
  const libre = disponibles.find((p) => !usados.includes(p.id_producto)) || disponibles[0];
  if (libre) fila.querySelector('select').value = libre.id_producto;
  fila.querySelector('.quitar').addEventListener('click', () => { fila.remove(); totalVenta(); });
  fila.addEventListener('input', totalVenta);
  $('#venta-items').appendChild(fila);
  totalVenta();
}

function itemsVenta() {
  return [...document.querySelectorAll('#venta-items .item')].map((f) => ({
    id_producto: Number(f.querySelector('select').value),
    cantidad: Number(f.querySelector('input').value),
  }));
}
function totalVenta() {
  const total = itemsVenta().reduce((s, it) => s + (estado.inventario.find((p) => p.id_producto === it.id_producto)?.precio || 0) * (it.cantidad || 0), 0);
  $('#venta-total').textContent = total ? `≈ ${dinero2.format(total)}` : '';
}

async function guardarVenta(e) {
  e.preventDefault();
  const boton = e.submitter || e.target.querySelector('[type=submit]');
  boton.disabled = true;
  try {
    const v = await api('/api/ventas', {
      method: 'POST',
      body: JSON.stringify({ id_sucursal: Number($('#venta-sucursal').value), metodo_pago: $('#venta-metodo').value, items: itemsVenta() }),
    });
    estado.resaltar = v.id_venta;
    mensaje('#venta-mensaje', `Venta ${v.id_venta} guardada en nodo_${v.region.toLowerCase()} (región ${v.region}) · total ${dinero2.format(v.total)}`);
    animarArista(v.region);
    await Promise.all([cargarTodo(), cargarInventarioVenta()]);
    mensaje('#venta-mensaje', `Venta ${v.id_venta} guardada en nodo_${v.region.toLowerCase()} (región ${v.region}) · total ${dinero2.format(v.total)}`);
  } catch (err) {
    mensaje('#venta-mensaje', /srv_/.test(err.message) ? errorConsulta(err) : err.message, true);
  } finally {
    boton.disabled = false;
  }
}

// ---------- replica de precios ----------
async function cambiarPrecio(e) {
  e.preventDefault();
  const id = Number($('#precio-producto').value);
  const boton = e.submitter || e.target.querySelector('[type=submit]');
  boton.disabled = true;
  try {
    await api(`/api/productos/${id}`, { method: 'PUT', body: JSON.stringify({ precio: Number($('#precio-valor').value) }) });
    REGIONES.forEach(animarArista);
    tablaCatalogo(await api('/api/productos'), id);
    mensaje('#precio-mensaje', `Precio del producto ${id} actualizado en las 3 copias en una sola transacción.`);
    $('#precio-valor').value = '';
  } catch (err) {
    mensaje('#precio-mensaje', `${/srv_/.test(err.message) ? errorConsulta(err) : err.message} No se modificó ninguna copia.`, true);
  } finally {
    boton.disabled = false;
  }
}

function mensaje(sel, texto, esError = false) {
  const el = $(sel);
  el.textContent = texto;
  el.className = `mensaje ${texto ? (esError ? 'error' : 'ok') : ''}`;
}

// ---------- carga general ----------
async function cargarTodo() {
  const [resumen, mes, top, stock, recientes, productos, sucursales] = await Promise.allSettled([
    api('/api/resumen'), api('/api/ventas-mes'), api('/api/top-productos'), api('/api/stock-bajo'),
    api('/api/ventas-recientes'), api('/api/productos'), api('/api/sucursales'),
  ]);

  if (resumen.status === 'fulfilled') { estado.resumen = resumen.value; pintarKpis(resumen.value); graficaRegion(resumen.value); }
  else { estado.resumen = null; kpisNoDisponibles(); vacio($('#grafica-region'), errorConsulta(resumen.reason), true); }

  if (mes.status === 'fulfilled') { estado.ventasMes = mes.value; graficaMes(mes.value); }
  else { estado.ventasMes = null; $('#leyenda-mes').innerHTML = ''; $('#tabla-mes').innerHTML = ''; vacio($('#grafica-mes'), errorConsulta(mes.reason), true); }

  if (top.status === 'fulfilled') { estado.top = top.value; graficaTop(top.value); }
  else { estado.top = null; vacio($('#grafica-top'), errorConsulta(top.reason), true); }

  if (stock.status === 'fulfilled') tablaStock(stock.value);
  else vacio($('#tabla-stock'), errorConsulta(stock.reason), true);

  if (recientes.status === 'fulfilled') tablaRecientes(recientes.value);
  else vacio($('#tabla-recientes'), errorConsulta(recientes.reason), true);

  if (productos.status === 'fulfilled') tablaCatalogo(productos.value);
  else vacio($('#tabla-catalogo'), errorConsulta(productos.reason), true);

  if (sucursales.status === 'fulfilled') {
    const primeraVez = estado.sucursales.length === 0;
    estado.sucursales = sucursales.value;
    pintarSucursales(sucursales.value);
    if (primeraVez) cargarInventarioVenta();
  }

  $('#reloj').textContent = `Actualizado ${new Date().toLocaleTimeString('es-MX')}`;
}

// ---------- arranque ----------
// Las aristas dependen de donde quedan las tarjetas: se redibujan con cualquier cambio de layout
const observador = new ResizeObserver(() => requestAnimationFrame(dibujarAristas));
observador.observe($('#topologia'));
document.querySelectorAll('.nodo').forEach((n) => observador.observe(n));

let temporizador;
addEventListener('resize', () => {
  clearTimeout(temporizador);
  temporizador = setTimeout(() => {
    if (estado.ventasMes) graficaMes(estado.ventasMes);
    if (estado.resumen) graficaRegion(estado.resumen);
    if (estado.top) graficaTop(estado.top);
  }, 150);
});

document.querySelectorAll('[data-alternar]').forEach((b) => b.addEventListener('click', () => {
  const tabla = document.getElementById(b.dataset.alternar);
  tabla.hidden = !tabla.hidden;
  b.textContent = tabla.hidden ? 'Ver tabla' : 'Ocultar tabla';
}));
$('#btn-recargar').addEventListener('click', () => { actualizarNodos(); cargarTodo(); });
$('#form-plan').addEventListener('submit', verPlan);
$('#form-venta').addEventListener('submit', guardarVenta);
$('#venta-sucursal').addEventListener('change', cargarInventarioVenta);
$('#btn-agregar-item').addEventListener('click', agregarItem);
$('#form-precio').addEventListener('submit', cambiarPrecio);

(async () => {
  await actualizarNodos();
  dibujarAristas();
  await cargarTodo();
  verPlan();
  setInterval(actualizarNodos, 5000);
})();
