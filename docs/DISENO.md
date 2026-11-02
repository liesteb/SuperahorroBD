# SuperAhorro — Diseño de la base de datos distribuida

> Diagramas: [MER](diagramas/MER_SuperAhorro.png) · [Modelo relacional](diagramas/Modelo_Relacional.png) · [Fragmentación y asignación](diagramas/Fragmentacion_Asignacion.png)
> Propuesta formal (predicados, minitérminos, alternativas): [Propuesta_Fragmentacion_Horizontal.pdf](Propuesta_Fragmentacion_Horizontal.pdf)

## 1. Caso de estudio

SuperAhorro es una cadena de supermercados con sucursales en tres regiones del país (Norte, Centro y Sur). Cada región opera casi siempre con sus propios datos: sus sucursales, su inventario y sus ventas. El corporativo necesita además una visión global: ventas totales por región, productos más vendidos y alertas de inventario de toda la cadena.

El diseño distribuye los datos de forma que:

- cada región guarda **solo sus datos** en su propio nodo, así sus operaciones diarias son locales y rápidas;
- el **catálogo de productos**, que todas las regiones leen constantemente, está **replicado** en los tres nodos;
- un **nodo central** reconstruye las tablas globales sin copiar datos, para las consultas corporativas.

## 2. Arquitectura

```
                         ┌──────────────────────────────┐
     Panel web  ───────▶ │        nodo_central          │
   (solo habla con       │  postgres_fdw + vistas       │
    el central)          │  sucursal, venta, inventario,│
                         │  detalle_venta, producto     │
                         └───────┬─────────┬─────────┬──┘
                                 │         │         │
                 ┌───────────────┘         │         └───────────────┐
                 ▼                         ▼                         ▼
      ┌────────────────────┐   ┌────────────────────┐   ┌────────────────────┐
      │    nodo_norte      │   │    nodo_centro     │   │     nodo_sur       │
      │ sucursal_n         │   │ sucursal_c         │   │ sucursal_s         │
      │ inventario_n       │   │ inventario_c       │   │ inventario_s       │
      │ venta_n            │   │ venta_c            │   │ venta_s            │
      │ detalle_n          │   │ detalle_c          │   │ detalle_s          │
      │ producto (copia)   │   │ producto (copia)   │   │ producto (copia)   │
      └────────────────────┘   └────────────────────┘   └────────────────────┘
```

| Componente | Tecnología | Puerto (host) |
|---|---|---|
| nodo_norte, nodo_centro, nodo_sur | PostgreSQL 16 | 5433, 5434, 5435 |
| nodo_central | PostgreSQL 16 + `postgres_fdw` | 5436 |
| Panel web | Node.js 22 + `pg` | 8080 |

Los cinco servicios se levantan con Docker Compose. Cada nodo corre en su propio contenedor y los nodos se comunican por la red interna de Docker usando el nombre del contenedor.

## 3. Esquema global

```
SUCURSAL      (id_sucursal PK, nombre, ciudad, region, gerente)
PRODUCTO      (id_producto PK, nombre, categoria, precio)
INVENTARIO    (id_sucursal FK→SUCURSAL, id_producto FK→PRODUCTO, existencia, stock_minimo)
VENTA         (id_venta PK, id_sucursal FK→SUCURSAL, fecha, total, metodo_pago)
DETALLE_VENTA (id_venta FK→VENTA, id_producto FK→PRODUCTO, cantidad, precio_unitario)
```

Los vínculos de propietario a miembro que guían la fragmentación derivada son:

```
SUCURSAL ──▶ INVENTARIO
SUCURSAL ──▶ VENTA ──▶ DETALLE_VENTA
```

## 4. Fragmentación

### 4.1 Fragmentación horizontal primaria de SUCURSAL

Predicados simples sobre el atributo `region`, que es el que usan las aplicaciones regionales:

- p₁: `region = 'Norte'`
- p₂: `region = 'Centro'`
- p₃: `region = 'Sur'`

Como una sucursal pertenece exactamente a una región, los predicados minitérmino que no son contradictorios son justamente p₁, p₂ y p₃:

```
SUCURSAL_N = σ region='Norte'  (SUCURSAL)
SUCURSAL_C = σ region='Centro' (SUCURSAL)
SUCURSAL_S = σ region='Sur'    (SUCURSAL)
```

**Codificación de la localización en la llave.** Cada región tiene un rango de identificadores. Así, el nodo de un dato se deduce solo de su llave, sin leer ninguna tabla:

| Región | id_sucursal | id_venta |
|---|---|---|
| Norte | 100 – 199 | 1 000 000 – 1 999 999 |
| Centro | 200 – 299 | 2 000 000 – 2 999 999 |
| Sur | 300 – 399 | 3 000 000 – 3 999 999 |

En cada nodo los rangos están garantizados con restricciones `CHECK` (por ejemplo `ck_sucursal_n_region` y `ck_sucursal_n_rango`).

### 4.2 Fragmentación horizontal derivada

INVENTARIO y VENTA siguen a su sucursal, y DETALLE_VENTA sigue a su venta (derivada de segundo nivel):

```
INVENTARIO_i = INVENTARIO    ⋉ SUCURSAL_i       i ∈ {N, C, S}
VENTA_i      = VENTA         ⋉ SUCURSAL_i
DETALLE_i    = DETALLE_VENTA ⋉ VENTA_i
```

Gracias a esto, los joins `venta ⋈ sucursal`, `inventario ⋈ sucursal` y `detalle ⋈ venta` siempre se resuelven **dentro de un mismo nodo**. Las llaves foráneas locales de cada nodo (`REFERENCES sucursal_n`, `REFERENCES venta_n`) lo garantizan: no se puede guardar una venta en un nodo distinto al de su sucursal.

### 4.3 Replicación de PRODUCTO

PRODUCTO **no se fragmenta**: se replica completo en los tres nodos. Se justifica porque:

- todas las regiones venden todo el catálogo, así que la fragmentación no tiene un criterio útil;
- se lee en cada venta y en cada consulta de inventario, y con una copia local esos joins no salen del nodo;
- se modifica poco (altas de productos y cambios de precio).

## 5. Asignación

| Fragmento | nodo_norte | nodo_centro | nodo_sur |
|---|:---:|:---:|:---:|
| SUCURSAL_N, INVENTARIO_N, VENTA_N, DETALLE_N | ✔ | | |
| SUCURSAL_C, INVENTARIO_C, VENTA_C, DETALLE_C | | ✔ | |
| SUCURSAL_S, INVENTARIO_S, VENTA_S, DETALLE_S | | | ✔ |
| PRODUCTO (réplica completa) | ✔ | ✔ | ✔ |

El nodo central **no guarda datos de negocio**. Solo guarda el catálogo de localización (`localizacion`) y las definiciones: servidores remotos, tablas foráneas, vistas, triggers y funciones.

## 6. Reglas de corrección

| Regla | Qué significa aquí | Cómo se garantiza | Prueba |
|---|---|---|---|
| **Completitud** | Toda tupla global está en algún fragmento | Los predicados p₁, p₂ y p₃ cubren todas las regiones. Las FK locales impiden ventas o detalles sin su propietario | P1, P2 |
| **Reconstrucción** | La relación global se obtiene de sus fragmentos | `R = R_N ∪ R_C ∪ R_S`, implementada con vistas `UNION ALL` | P1, P3 |
| **Disyunción** | Ninguna tupla está en dos fragmentos | Predicados mutuamente excluyentes y rangos de llaves disjuntos (`CHECK`) | P4, P5, P7 |
| **Consistencia de réplicas** | Las 3 copias de PRODUCTO son iguales | Escritura en las 3 copias dentro de una sola transacción | P6, E8 – E10 |

Como los fragmentos son disjuntos, `UNION ALL` (que no elimina duplicados y es más barato) da el mismo resultado que `UNION`. La prueba P3 lo verifica.

## 7. Transparencia de distribución

### 7.1 Lectura

En el nodo central, `IMPORT FOREIGN SCHEMA` crea una tabla foránea por cada fragmento (`norte.venta_n`, `centro.venta_c`, …) y sobre ellas se definen las vistas de reconstrucción:

```sql
CREATE VIEW venta AS
    SELECT * FROM norte.venta_n
    UNION ALL SELECT * FROM centro.venta_c
    UNION ALL SELECT * FROM sur.venta_s;
```

La aplicación consulta `venta`, `sucursal`, `inventario`, `detalle_venta` y `producto` como si fueran tablas locales. Así hay **transparencia de fragmentación y de localización**: el usuario no sabe cuántos fragmentos hay ni en qué nodo está cada uno.

### 7.2 Escritura (`06_escrituras_central.sql`)

Cada vista global tiene un trigger `INSTEAD OF INSERT OR UPDATE OR DELETE` que manda el renglón al fragmento correcto:

| Vista | Criterio de localización |
|---|---|
| `sucursal` | `region` (y valida que el id esté en el rango de la región) |
| `inventario`, `venta` | `id_sucursal` → `nodo_de_sucursal()` |
| `detalle_venta` | `id_venta` → `nodo_de_venta()` |
| `producto` | se escribe en las **3 copias** (Read One, Write All) |

Funciones de apoyo:

- `localizacion`: catálogo con la región, el esquema y los rangos de cada nodo.
- `nodo_de_sucursal(id)`, `nodo_de_venta(id)`: devuelven el nodo dueño de una llave.
- `siguiente_id_venta(l)`: genera el siguiente id dentro del rango de la región. Usa un cerrojo `pg_advisory_xact_lock` por región para que dos ventas simultáneas no reciban el mismo id.

Se rechaza cambiar la región o el id de una sucursal, porque eso obligaría a migrar sus ventas e inventario a otro nodo. La prueba E4 lo verifica.

### 7.3 Transacción de negocio: `registrar_venta`

```sql
SELECT registrar_venta(100, 'Tarjeta',
       '[{"id_producto": 1, "cantidad": 2}, {"id_producto": 5, "cantidad": 1}]');
```

En una sola transacción:

1. crea la venta con el siguiente id de la región;
2. lee el precio de la **copia local** del catálogo en el nodo de la sucursal;
3. descuenta la existencia con un `UPDATE … WHERE existencia >= cantidad` atómico en el nodo remoto, así no puede quedar negativa aunque haya ventas simultáneas;
4. inserta el detalle y calcula el total.

Si falta existencia de cualquier producto, se deshace todo, incluidos los descuentos ya hechos. Las pruebas E6a y E6b lo verifican.

## 8. Procesamiento de consultas distribuidas

### 8.1 Localización y reducción de fragmentos

En el central, cada tabla foránea declara qué datos contiene con un `CHECK`. PostgreSQL **no valida** esos `CHECK` en el remoto, pero el optimizador los usa (`constraint_exclusion = partition`) para descartar fragmentos que no pueden tener datos para la consulta:

```sql
ALTER FOREIGN TABLE norte.venta_n ADD CONSTRAINT loc_ven_n
    CHECK (id_sucursal BETWEEN 100 AND 199 AND id_venta BETWEEN 1000000 AND 1999999);
```

**C6, con filtro.** `SELECT COUNT(*), SUM(total) FROM venta WHERE id_sucursal = 100` solo toca un nodo:

```
Aggregate
  ->  Foreign Scan on norte.venta_n
        Remote SQL: SELECT total FROM public.venta_n WHERE ((id_sucursal = 100))
```

**C7, sin filtro.** La consulta va a los 3 nodos (`Append` de tres `Foreign Scan`).

Además, `postgres_fdw` **empuja el filtro al nodo remoto** (`Remote SQL … WHERE`), así por la red solo viajan las tuplas que cumplen la condición.

### 8.2 Consultas locales

Una consulta regional que se ejecuta en su propio nodo (C1 en `04_consultas.sql`) no usa la red. Esa es la ventaja principal de la fragmentación derivada.

## 9. Transacciones, concurrencia y sus límites

- `postgres_fdw` abre una transacción remota en cada nodo que participa y la confirma cuando el central hace `COMMIT`. Si cualquier sentencia falla antes del `COMMIT`, todos los nodos hacen `ROLLBACK`. Así se garantiza la atomicidad en los casos probados: E6 (venta sin existencia) y E10 (el nodo Sur rechaza una alta de producto; Norte y Centro tampoco la guardan).
- Las transacciones remotas de `postgres_fdw` usan nivel `REPEATABLE READ`, así que dos escrituras simultáneas sobre la misma fila remota terminan en un error de serialización en lugar de una actualización perdida.
- **Limitación: no hay commit en dos fases (2PC).** El central confirma los nodos uno tras otro. Si un nodo falla justo *durante* la fase de `COMMIT` (después de que otro ya confirmó), una actualización de PRODUCTO podría quedar aplicada en unas copias y en otras no. La ventana es muy pequeña y la prueba P6 detecta la inconsistencia. Para eliminarla se usaría `PREPARE TRANSACTION` / `COMMIT PREPARED` coordinado (con `max_prepared_transactions > 0` en cada nodo) o un gestor de transacciones distribuidas.

## 10. Tolerancia a fallos

`probar.ps1` apaga `nodo_sur` y comprueba que:

| Prueba | Operación con el Sur caído | Resultado | Por qué |
|---|---|---|---|
| F1 | Ventas de una sucursal del Norte | ✔ funciona | La localización descarta el fragmento Sur, así que no hay conexión con él |
| F2 | Ventas globales | ✘ error | La reconstrucción necesita los 3 fragmentos |
| F3 | Registrar venta en el Norte | ✔ funciona | La venta solo toca el nodo de su sucursal |
| F4 | Cambiar un precio | ✘ error | ROWA exige escribir en todas las copias |
| F5 | Precio en Norte y Centro tras F4 | sin cambio | La transacción se deshizo completa |
| F6 | Ventas globales con el Sur de vuelta | ✔ 3 regiones | El central se reconecta solo |

`connect_timeout '3'` en cada servidor remoto hace que un nodo caído produzca un error en segundos en vez de bloquear la consulta.

El panel web aplica **disponibilidad parcial**: la lista de sucursales y el inventario se leen fragmento por fragmento, así se puede seguir vendiendo en las regiones activas. Los paneles globales muestran claramente qué nodo falta.

## 11. Panel web

`app/server.js` es un servidor Node.js que **solo se conecta al nodo central**. Expone:

| Método y ruta | Uso |
|---|---|
| `GET /api/nodos` | Estado, latencia y conteo de cada fragmento |
| `GET /api/resumen` | KPI y monto por región |
| `GET /api/ventas-mes`, `/api/top-productos`, `/api/stock-bajo`, `/api/ventas-recientes` | Consultas globales C2 – C5 |
| `GET /api/plan?sucursal=N` | `EXPLAIN` de la consulta y nodos que toca |
| `GET /api/productos` | Las 3 copias del catálogo lado a lado (consistencia de la réplica) |
| `POST /api/ventas` | Llama a `registrar_venta()` |
| `PUT /api/productos/:id` | Cambia un precio, replicado en los 3 nodos |

La interfaz (`app/public`) muestra la topología en vivo: cada consulta o venta ilumina las aristas de los nodos que realmente usó.

## 12. Archivos del proyecto

| Archivo | Se ejecuta en | Contenido |
|---|---|---|
| `scripts/01_esquema_{norte,centro,sur}.sql` | cada nodo | Fragmentos con sus restricciones y la copia de PRODUCTO |
| `scripts/02_datos_{norte,centro,sur}.sql` | cada nodo | 3 sucursales, 30 productos, 90 inventarios y 600 ventas por región |
| `scripts/03_central.sql` | central | `postgres_fdw`, tablas foráneas, vistas de reconstrucción, restricciones de localización |
| `scripts/04_consultas.sql` | central | Consultas distribuidas C1 – C7 |
| `scripts/05_pruebas.sql` | central | Pruebas de corrección P1 – P7 |
| `scripts/06_escrituras_central.sql` | central | Transparencia de escritura, réplica ROWA y `registrar_venta` |
| `scripts/07_pruebas_escritura.sql` | central | Pruebas E1 – E12 (se deshacen con `ROLLBACK`) |
| `probar.ps1` | host | Corre todas las pruebas y la demostración de nodo caído |
| `app/` | contenedor | Panel web |
| `docker-compose.yml` | host | Levanta los 5 servicios y carga los scripts automáticamente |

## 13. Limitaciones y trabajo futuro

- **Sin 2PC.** Ver la sección 9.
- **ROWA reduce la disponibilidad de escritura del catálogo.** Con un nodo caído no se pueden cambiar precios. Una alternativa es un protocolo de quórum o una réplica primaria con propagación asíncrona.
- **Lectura del catálogo desde el central.** La vista `producto` lee la copia del Norte: si ese nodo cae, las consultas globales que usan PRODUCTO fallan aunque haya otras dos copias. Se podría elegir dinámicamente una copia disponible.
- **El central es un punto único de entrada** para las consultas globales. Los nodos regionales siguen operando sin él, pero la vista corporativa no. Se podría replicar el central, que no tiene estado propio más allá de definiciones.
- **Migrar una sucursal de región** no está soportado: requeriría mover en una transacción sus ventas, detalle e inventario al nuevo nodo.
