// Genera los diagramas del proyecto en docs/diagramas (SVG).
// Uso:  node docs/fuentes/generar_diagramas.js
// Los PNG y el PDF se exportan despues con docs/fuentes/exportar.ps1
const fs = require('fs');
const path = require('path');

const SALIDA = path.join(__dirname, '..', 'diagramas');
fs.mkdirSync(SALIDA, { recursive: true });

const C = {
  tinta: '#0b0b0b', tinta2: '#52514e', tenue: '#898781', reticula: '#e1e0d9',
  papel: '#fcfcfb', claro: '#f4f3ef',
  norte: '#2a78d6', centro: '#eb6834', sur: '#1baf7a', acento: '#2a78d6',
};
const FUENTE = 'Segoe UI, Segoe UI Symbol, Cambria Math, Helvetica, Arial, sans-serif';
const MONO = 'Cascadia Mono, Consolas, Menlo, monospace';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const documento = (w, h, cuerpo) => `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="${FUENTE}" fill="${C.tinta}">
<rect width="${w}" height="${h}" fill="#ffffff"/>
${cuerpo}
</svg>
`;
const texto = (x, y, t, a = {}) => {
  const attrs = Object.entries({ 'text-anchor': 'middle', 'font-size': 14, ...a }).map(([k, v]) => `${k}="${v}"`).join(' ');
  return `<text x="${x}" y="${y}" ${attrs}>${esc(t)}</text>`;
};
const titulo = (w, t, sub) => texto(40, 48, t, { 'text-anchor': 'start', 'font-size': 24, 'font-weight': 700 })
  + texto(40, 74, sub, { 'text-anchor': 'start', 'font-size': 14, fill: C.tinta2 })
  + `<line x1="40" y1="92" x2="${w - 40}" y2="92" stroke="${C.reticula}" stroke-width="1.5"/>`;

// =====================================================================
// 1. MER (notacion de Chen)
// =====================================================================
function mer() {
  const W = 1500, H = 860, SUBIR = 130;
  const E = { S: [260, 440], P: [1240, 440], V: [750, 790] };
  const R = { A: [750, 440], R: [450, 650], C: [1050, 650] };
  const lineas = [], figuras = [];

  const linea = (a, b, doble = false) => {
    if (doble) {
      lineas.push(`<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${C.tinta}" stroke-width="7"/>`);
      lineas.push(`<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="#fff" stroke-width="2.6"/>`);
    } else {
      lineas.push(`<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${C.tinta}" stroke-width="1.6"/>`);
    }
  };
  const entidad = ([x, y], t) => figuras.push(
    `<rect x="${x - 95}" y="${y - 32}" width="190" height="64" fill="#fff" stroke="${C.tinta}" stroke-width="2.2"/>`
    + texto(x, y + 6, t, { 'font-size': 19, 'font-weight': 700 }));
  const relacion = ([x, y], t, sub) => figuras.push(
    `<polygon points="${x},${y - 52} ${x + 108},${y} ${x},${y + 52} ${x - 108},${y}" fill="#fff" stroke="${C.tinta}" stroke-width="2"/>`
    + texto(x, y + (sub ? 0 : 5), t, { 'font-size': 15, 'font-weight': 700 })
    + (sub ? texto(x, y + 17, sub, { 'font-size': 11, fill: C.tenue }) : ''));
  const atributo = ([x, y], t, destino, op = {}) => {
    const rx = op.rx || Math.max(60, t.length * 5 + 24);
    linea([x, y], destino);
    const trazo = op.destacado
      ? `stroke="${C.acento}" stroke-width="3" fill="#eaf2fc"`
      : `stroke="${C.tinta}" stroke-width="1.5" fill="#fff"${op.derivado ? ' stroke-dasharray="6 4"' : ''}`;
    let s = `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="22" ${trazo}/>` + texto(x, y + 5, t, { 'font-size': 14 });
    if (op.pk) {
      const a = t.length * 7.6;
      s += `<line x1="${x - a / 2}" y1="${y + 9}" x2="${x + a / 2}" y2="${y + 9}" stroke="${C.tinta}" stroke-width="1.3"/>`;
    }
    if (op.nota) s += texto(x, y + 42, op.nota, { 'font-size': 12, fill: C.acento, 'font-weight': 600 });
    figuras.push(s);
  };
  const card = (x, y, t) => figuras.push(texto(x, y, t, { 'font-size': 17, 'font-weight': 700 }));

  // Relaciones (las lineas van debajo de las figuras)
  linea(E.S, R.A); linea(R.A, E.P);
  linea(E.S, R.R); linea(R.R, E.V, true);   // toda venta pertenece a una sucursal
  linea(E.V, R.C, true); linea(R.C, E.P);   // toda venta tiene al menos un producto

  // Atributos
  atributo([110, 305], 'id_sucursal', E.S, { pk: true });
  atributo([265, 290], 'nombre', E.S);
  atributo([415, 318], 'ciudad', E.S);
  atributo([95, 580], 'region', E.S, { destacado: true, nota: 'atributo de fragmentación' });
  atributo([255, 660], 'gerente', E.S);

  atributo([1390, 305], 'id_producto', E.P, { pk: true });
  atributo([1235, 290], 'nombre', E.P);
  atributo([1085, 318], 'categoria', E.P);
  atributo([1405, 580], 'precio', E.P);

  atributo([665, 318], 'existencia', R.A);
  atributo([835, 318], 'stock_minimo', R.A);

  atributo([985, 785], 'cantidad', R.C);
  atributo([1165, 785], 'precio_unitario', R.C, { rx: 88 });

  atributo([565, 890], 'id_venta', E.V, { pk: true });
  atributo([705, 925], 'fecha', E.V);
  atributo([850, 925], 'total', E.V, { derivado: true });
  atributo([995, 890], 'metodo_pago', E.V);

  entidad(E.S, 'SUCURSAL');
  entidad(E.P, 'PRODUCTO');
  entidad(E.V, 'VENTA');
  relacion(R.A, 'ALMACENA', '(inventario)');
  relacion(R.R, 'REALIZA');
  relacion(R.C, 'CONTIENE', '(detalle_venta)');

  // Cardinalidades
  card(372, 428, 'M'); card(1128, 428, 'N');
  card(330, 512, '1'); card(628, 724, 'N');
  card(872, 722, 'N'); card(1210, 512, 'M');

  // Leyenda
  const lx = 1160, ly = 860;
  const leyenda = `<g font-size="12">
    <rect x="${lx}" y="${ly - 20}" width="300" height="130" rx="6" fill="${C.papel}" stroke="${C.reticula}"/>
    ${texto(lx + 14, ly, 'Notación (Chen)', { 'text-anchor': 'start', 'font-size': 13, 'font-weight': 700 })}
    <rect x="${lx + 14}" y="${ly + 12}" width="26" height="14" fill="#fff" stroke="${C.tinta}" stroke-width="1.5"/>
    ${texto(lx + 50, ly + 24, 'Entidad', { 'text-anchor': 'start', 'font-size': 12 })}
    <polygon points="${lx + 27},${ly + 34} ${lx + 41},${ly + 42} ${lx + 27},${ly + 50} ${lx + 13},${ly + 42}" fill="#fff" stroke="${C.tinta}" stroke-width="1.5"/>
    ${texto(lx + 50, ly + 46, 'Relación', { 'text-anchor': 'start', 'font-size': 12 })}
    <ellipse cx="${lx + 27}" cy="${ly + 64}" rx="13" ry="8" fill="#fff" stroke="${C.tinta}" stroke-width="1.5"/>
    ${texto(lx + 50, ly + 68, 'Atributo (subrayado = llave)', { 'text-anchor': 'start', 'font-size': 12 })}
    <ellipse cx="${lx + 27}" cy="${ly + 86}" rx="13" ry="8" fill="#fff" stroke="${C.tinta}" stroke-width="1.5" stroke-dasharray="4 3"/>
    ${texto(lx + 50, ly + 90, 'Atributo derivado', { 'text-anchor': 'start', 'font-size': 12 })}
    <line x1="${lx + 160}" y1="${ly + 20}" x2="${lx + 190}" y2="${ly + 20}" stroke="${C.tinta}" stroke-width="6"/>
    <line x1="${lx + 160}" y1="${ly + 20}" x2="${lx + 190}" y2="${ly + 20}" stroke="#fff" stroke-width="2.2"/>
    ${texto(lx + 198, ly + 24, 'Participación', { 'text-anchor': 'start', 'font-size': 12 })}
    ${texto(lx + 198, ly + 38, 'total', { 'text-anchor': 'start', 'font-size': 12 })}
  </g>`;

  return documento(W, H,
    titulo(W, 'Diagrama Entidad-Relación (MER) — SuperAhorro',
      'Modelo conceptual del esquema global. Las relaciones M:N se implementan como las tablas inventario y detalle_venta.')
    + `<g transform="translate(0,${-SUBIR})">` + lineas.join('\n') + '\n' + figuras.join('\n') + leyenda + '</g>');
}

// =====================================================================
// 2. Modelo relacional (tablas, PK/FK, cardinalidad pata de gallo)
// =====================================================================
function relacional() {
  const W = 1300, H = 730, ANCHO = 330, CAB = 38, FILA = 28;
  const T = {
    sucursal: { x: 60, y: 130, cols: [['PK', 'id_sucursal', 'INT'], ['', 'nombre', 'VARCHAR(60)'], ['', 'ciudad', 'VARCHAR(40)'], ['', 'region', 'VARCHAR(10)'], ['', 'gerente', 'VARCHAR(60)']] },
    inventario: { x: 485, y: 130, cols: [['PK FK', 'id_sucursal', 'INT'], ['PK FK', 'id_producto', 'INT'], ['', 'existencia', 'INT ≥ 0'], ['', 'stock_minimo', 'INT'], ] },
    producto: { x: 910, y: 130, cols: [['PK', 'id_producto', 'INT'], ['', 'nombre', 'VARCHAR(80)'], ['', 'categoria', 'VARCHAR(40)'], ['', 'precio', 'NUMERIC(10,2) > 0']] },
    venta: { x: 60, y: 450, cols: [['PK', 'id_venta', 'INT'], ['FK', 'id_sucursal', 'INT'], ['', 'fecha', 'DATE'], ['', 'total', 'NUMERIC(12,2)'], ['', 'metodo_pago', 'VARCHAR(15)']] },
    detalle_venta: { x: 485, y: 450, cols: [['PK FK', 'id_venta', 'INT'], ['PK FK', 'id_producto', 'INT'], ['', 'cantidad', 'INT > 0'], ['', 'precio_unitario', 'NUMERIC(10,2)']] },
  };
  const filaY = (t, i) => T[t].y + CAB + FILA * i + FILA / 2;
  const fondo = (t) => T[t].y + CAB + FILA * T[t].cols.length;

  const tabla = (nombre) => {
    const t = T[nombre];
    let s = `<rect x="${t.x}" y="${t.y}" width="${ANCHO}" height="${CAB + FILA * t.cols.length}" rx="6" fill="#fff" stroke="${C.tinta}" stroke-width="1.8"/>`;
    s += `<path d="M${t.x},${t.y + CAB} v${-CAB + 6} a6,6 0 0 1 6,-6 h${ANCHO - 12} a6,6 0 0 1 6,6 v${CAB - 6} z" fill="${C.tinta}"/>`;
    s += texto(t.x + 14, t.y + 25, nombre, { 'text-anchor': 'start', 'font-size': 16, 'font-weight': 700, fill: '#fff', 'font-family': MONO });
    t.cols.forEach(([llave, col, tipo], i) => {
      const y = t.y + CAB + FILA * i;
      if (i > 0) s += `<line x1="${t.x}" y1="${y}" x2="${t.x + ANCHO}" y2="${y}" stroke="${C.reticula}"/>`;
      if (llave) s += texto(t.x + 12, y + 19, llave, { 'text-anchor': 'start', 'font-size': 11, 'font-weight': 700, fill: llave.startsWith('PK') ? C.tinta : C.tinta2 });
      s += texto(t.x + 66, y + 19, col, { 'text-anchor': 'start', 'font-size': 14, 'font-family': MONO, 'font-weight': llave.startsWith('PK') ? 700 : 400 });
      s += texto(t.x + ANCHO - 12, y + 19, tipo, { 'text-anchor': 'end', 'font-size': 12, fill: C.tenue, 'font-family': MONO });
    });
    return s;
  };

  // Conector con "uno" en el origen y "uno o muchos" (pata de gallo) en el destino
  const conector = (pts) => {
    let s = `<polyline points="${pts.map((p) => p.join(',')).join(' ')}" fill="none" stroke="${C.tinta}" stroke-width="1.6"/>`;
    const unit = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy); return [dx / l, dy / l]; };
    const [a0, a1] = [pts[0], pts[1]];
    const d0 = unit(a0, a1), p0 = [-d0[1], d0[0]];
    for (const k of [10, 16]) {
      s += `<line x1="${a0[0] + d0[0] * k + p0[0] * 8}" y1="${a0[1] + d0[1] * k + p0[1] * 8}" x2="${a0[0] + d0[0] * k - p0[0] * 8}" y2="${a0[1] + d0[1] * k - p0[1] * 8}" stroke="${C.tinta}" stroke-width="1.6"/>`;
    }
    const [b1, b0] = [pts[pts.length - 2], pts[pts.length - 1]];
    const d = unit(b1, b0), p = [-d[1], d[0]];
    const cx = b0[0] - d[0] * 16, cy = b0[1] - d[1] * 16;
    for (const sgn of [-1, 0, 1]) {
      s += `<line x1="${cx}" y1="${cy}" x2="${b0[0] + p[0] * 9 * sgn}" y2="${b0[1] + p[1] * 9 * sgn}" stroke="${C.tinta}" stroke-width="1.6"/>`;
    }
    s += `<line x1="${b0[0] - d[0] * 22 + p[0] * 8}" y1="${b0[1] - d[1] * 22 + p[1] * 8}" x2="${b0[0] - d[0] * 22 - p[0] * 8}" y2="${b0[1] - d[1] * 22 - p[1] * 8}" stroke="${C.tinta}" stroke-width="1.6"/>`;
    return s;
  };
  const etq = (x, y, t) => texto(x, y, t, { 'font-size': 12, fill: C.tinta2, 'font-style': 'italic' });

  const S = T.sucursal, I = T.inventario, P = T.producto, V = T.venta, D = T.detalle_venta;
  const conectores = [
    conector([[S.x + ANCHO, filaY('sucursal', 0)], [I.x, filaY('inventario', 0)]]),
    conector([[P.x, filaY('producto', 0)], [P.x - 40, filaY('producto', 0)], [P.x - 40, filaY('inventario', 1)], [I.x + ANCHO, filaY('inventario', 1)]]),
    conector([[S.x + 160, fondo('sucursal')], [V.x + 160, V.y]]),
    conector([[V.x + ANCHO, filaY('venta', 0)], [D.x, filaY('detalle_venta', 0)]]),
    conector([[P.x + 165, fondo('producto')], [P.x + 165, filaY('detalle_venta', 1)], [D.x + ANCHO, filaY('detalle_venta', 1)]]),
  ].join('\n');
  const etiquetas = etq(S.x + ANCHO + 47, filaY('sucursal', 0) - 10, 'almacena')
    + etq(P.x - 40, filaY('producto', 0) - 12, 'en')
    + etq(S.x + 205, (fondo('sucursal') + V.y) / 2 + 4, 'realiza')
    + etq(V.x + ANCHO + 47, filaY('venta', 0) - 10, 'contiene')
    + etq(P.x + 205, (fondo('producto') + filaY('detalle_venta', 1)) / 2, 'vendido en');

  // debajo del conector producto -> detalle_venta para no cruzarlo
  const nota = `<g transform="translate(0,105)">
    <rect x="910" y="450" width="330" height="150" rx="6" fill="${C.papel}" stroke="${C.reticula}"/>
    ${texto(926, 474, 'Notación', { 'text-anchor': 'start', 'font-size': 13, 'font-weight': 700 })}
    ${texto(926, 498, 'PK  llave primaria   ·   FK  llave foránea', { 'text-anchor': 'start', 'font-size': 12, fill: C.tinta2 })}
    <line x1="926" y1="522" x2="976" y2="522" stroke="${C.tinta}" stroke-width="1.6"/>
    <line x1="936" y1="514" x2="936" y2="530" stroke="${C.tinta}" stroke-width="1.6"/><line x1="942" y1="514" x2="942" y2="530" stroke="${C.tinta}" stroke-width="1.6"/>
    ${texto(986, 526, 'exactamente uno', { 'text-anchor': 'start', 'font-size': 12, fill: C.tinta2 })}
    <line x1="926" y1="552" x2="976" y2="552" stroke="${C.tinta}" stroke-width="1.6"/>
    <line x1="960" y1="552" x2="976" y2="543" stroke="${C.tinta}" stroke-width="1.6"/><line x1="960" y1="552" x2="976" y2="561" stroke="${C.tinta}" stroke-width="1.6"/>
    <line x1="954" y1="544" x2="954" y2="560" stroke="${C.tinta}" stroke-width="1.6"/>
    ${texto(986, 556, 'uno o muchos', { 'text-anchor': 'start', 'font-size': 12, fill: C.tinta2 })}
    ${texto(926, 584, 'total = Σ cantidad × precio_unitario', { 'text-anchor': 'start', 'font-size': 12, fill: C.tinta2 })}
  </g>`;

  return documento(W, H,
    titulo(W, 'Modelo relacional — esquema global', 'Tablas, llaves y cardinalidades antes de fragmentar. Cada nodo implementa este esquema sobre sus fragmentos.')
    + conectores + etiquetas + Object.keys(T).map(tabla).join('\n') + nota);
}

// =====================================================================
// 3. Fragmentacion y asignacion
// =====================================================================
function fragmentacion() {
  const W = 1420, H = 900;
  const X0 = 40, ANCHO_IZQ = 290, COL = 330, SEP = 20;
  const colX = (i) => X0 + ANCHO_IZQ + SEP + i * (COL + SEP);
  const nodos = [
    { r: 'Norte', s: 'n', color: C.norte, puerto: 5433, suc: '100–199', ven: '1 000 000–1 999 999', det: 1488 },
    { r: 'Centro', s: 'c', color: C.centro, puerto: 5434, suc: '200–299', ven: '2 000 000–2 999 999', det: 1484 },
    { r: 'Sur', s: 's', color: C.sur, puerto: 5435, suc: '300–399', ven: '3 000 000–3 999 999', det: 1527 },
  ];
  const filas = [
    { rel: 'SUCURSAL', tipo: 'Horizontal primaria', crit: 'predicado sobre region', frag: (n) => [`sucursal_${n.s}`, `σ region='${n.r}' (SUCURSAL)`, '3 tuplas'] },
    { rel: 'INVENTARIO', tipo: 'Horizontal derivada', crit: 'propietario: SUCURSAL', frag: (n) => [`inventario_${n.s}`, `INVENTARIO ⋉ SUCURSAL_${n.s.toUpperCase()}`, '90 tuplas'] },
    { rel: 'VENTA', tipo: 'Horizontal derivada', crit: 'propietario: SUCURSAL', frag: (n) => [`venta_${n.s}`, `VENTA ⋉ SUCURSAL_${n.s.toUpperCase()}`, '600 tuplas'] },
    { rel: 'DETALLE_VENTA', tipo: 'Derivada de 2º nivel', crit: 'propietario: VENTA', frag: (n) => [`detalle_${n.s}`, `DETALLE_VENTA ⋉ VENTA_${n.s.toUpperCase()}`, `${n.det.toLocaleString('es-MX')} tuplas`] },
    { rel: 'PRODUCTO', tipo: 'Replicada (sin fragmentar)', crit: 'copia completa en cada nodo', frag: () => ['producto', 'copia completa de PRODUCTO', '30 tuplas'], replica: true },
  ];
  const Y_CENTRAL = 112, Y_CAB = 212, ALTO_CAB = 92, Y_FILAS = Y_CAB + ALTO_CAB + 16, ALTO = 94;
  let s = titulo(W, 'Fragmentación horizontal y asignación a nodos', 'Cada celda es un fragmento: nombre de la tabla en el nodo, su definición en álgebra relacional y el número de tuplas cargadas.');

  // Nodo central
  const xc0 = colX(0), xc1 = colX(2) + COL;
  s += `<rect x="${xc0}" y="${Y_CENTRAL}" width="${xc1 - xc0}" height="64" rx="8" fill="${C.tinta}"/>`;
  s += texto((xc0 + xc1) / 2, Y_CENTRAL + 27, 'nodo_central (puerto 5436) · postgres_fdw', { 'font-size': 16, 'font-weight': 700, fill: '#fff' });
  s += texto((xc0 + xc1) / 2, Y_CENTRAL + 49, 'Vistas de reconstrucción:  R = R_N ∪ R_C ∪ R_S   (UNION ALL)  ·  no guarda datos de negocio', { 'font-size': 13, fill: '#e1e0d9' });
  s += `<rect x="${X0}" y="${Y_CENTRAL}" width="${ANCHO_IZQ}" height="64" rx="8" fill="${C.claro}"/>`;
  s += texto(X0 + 16, Y_CENTRAL + 28, 'Relación global', { 'text-anchor': 'start', 'font-size': 14, 'font-weight': 700 });
  s += texto(X0 + 16, Y_CENTRAL + 48, 'tipo de fragmentación', { 'text-anchor': 'start', 'font-size': 12, fill: C.tinta2 });

  nodos.forEach((n, i) => {
    const x = colX(i), xm = x + COL / 2;
    s += `<line x1="${xm}" y1="${Y_CENTRAL + 64}" x2="${xm}" y2="${Y_CAB}" stroke="${C.eje || '#c3c2b7'}" stroke-width="2" stroke-dasharray="5 4"/>`;
    s += `<rect x="${x}" y="${Y_CAB}" width="${COL}" height="${ALTO_CAB}" rx="8" fill="#fff" stroke="${n.color}" stroke-width="2"/>`;
    s += `<path d="M${x},${Y_CAB + 8} a8,8 0 0 1 8,-8 h${COL - 16} a8,8 0 0 1 8,8 v2 h${-COL} z" fill="${n.color}"/>`;
    s += texto(xm, Y_CAB + 34, `nodo_${n.r.toLowerCase()}`, { 'font-size': 17, 'font-weight': 700, 'font-family': MONO });
    s += texto(xm, Y_CAB + 55, `Región ${n.r} · puerto ${n.puerto}`, { 'font-size': 13, fill: C.tinta2 });
    s += texto(xm, Y_CAB + 76, `id_sucursal ${n.suc} · id_venta ${n.ven}`, { 'font-size': 11.5, fill: C.tenue });
  });

  filas.forEach((f, k) => {
    const y = Y_FILAS + k * (ALTO + 12);
    s += `<rect x="${X0}" y="${y}" width="${ANCHO_IZQ}" height="${ALTO}" rx="8" fill="${C.claro}"/>`;
    s += texto(X0 + 16, y + 32, f.rel, { 'text-anchor': 'start', 'font-size': 16, 'font-weight': 700, 'font-family': MONO });
    s += texto(X0 + 16, y + 55, f.tipo, { 'text-anchor': 'start', 'font-size': 13, 'font-weight': 600 });
    s += texto(X0 + 16, y + 75, f.crit, { 'text-anchor': 'start', 'font-size': 12, fill: C.tinta2 });
    nodos.forEach((n, i) => {
      const x = colX(i), [nombre, def, tuplas] = f.frag(n);
      s += `<rect x="${x}" y="${y}" width="${COL}" height="${ALTO}" rx="8" fill="#fff" stroke="${C.reticula}" stroke-width="1.5"${f.replica ? ' stroke-dasharray="6 4"' : ''}/>`;
      s += `<rect x="${x}" y="${y + 10}" width="4" height="${ALTO - 20}" rx="2" fill="${n.color}"/>`;
      s += texto(x + 20, y + 30, nombre, { 'text-anchor': 'start', 'font-size': 15, 'font-weight': 700, 'font-family': MONO });
      s += texto(x + COL - 16, y + 30, tuplas, { 'text-anchor': 'end', 'font-size': 12, fill: C.tenue });
      s += texto(x + 20, y + 58, def, { 'text-anchor': 'start', 'font-size': 14 });
      if (f.replica) s += texto(x + 20, y + 80, 'Read One, Write All', { 'text-anchor': 'start', 'font-size': 11.5, fill: C.tinta2 });
    });
    // flechas de derivacion en la columna izquierda
    if (k > 0 && k < 4) {
      const yy = y - 12;
      s += `<path d="M${X0 + ANCHO_IZQ - 26},${yy - 4} l0,12 m-5,-5 l5,5 l5,-5" fill="none" stroke="${C.tenue}" stroke-width="1.6"/>`;
    }
  });

  const yl = Y_FILAS + 5 * (ALTO + 12) + 10;
  s += texto(X0, yl, 'σ selección  ·  ⋉ semi-join  ·  ∪ unión.  Los fragmentos derivados quedan en el mismo nodo que su propietario, así los joins venta ⋈ sucursal, inventario ⋈ sucursal y detalle ⋈ venta son locales.',
    { 'text-anchor': 'start', 'font-size': 13, fill: C.tinta2 });

  return documento(W, H, s);
}

const archivos = {
  'MER_SuperAhorro.svg': mer(),
  'Modelo_Relacional.svg': relacional(),
  'Fragmentacion_Asignacion.svg': fragmentacion(),
};
for (const [nombre, contenido] of Object.entries(archivos)) {
  fs.writeFileSync(path.join(SALIDA, nombre), contenido, 'utf8');
  console.log('generado', path.join('docs', 'diagramas', nombre));
}
