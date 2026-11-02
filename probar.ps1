# ============================================================
# probar.ps1  |  Corre todas las pruebas de la base distribuida SuperAhorro
# Uso (PowerShell, con los contenedores levantados):
#     .\probar.ps1              -> pruebas de lectura, escritura y nodo caido
#     .\probar.ps1 -SinFallo    -> sin la demostracion de nodo caido
# Si Windows bloquea el script:  powershell -ExecutionPolicy Bypass -File .\probar.ps1
# ============================================================
param([switch]$SinFallo)

$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot

function Titulo($texto) {
    Write-Host ""
    Write-Host ("=" * 70) -ForegroundColor Cyan
    Write-Host " $texto" -ForegroundColor Cyan
    Write-Host ("=" * 70) -ForegroundColor Cyan
}

# Ejecuta SQL en un nodo y regresa la salida como texto (incluye los errores)
function Sql($nodo, $sql) {
    $salida = $sql | docker exec -i $nodo psql -U postgres -d $nodo -v ON_ERROR_STOP=1 2>&1
    $salida | ForEach-Object { "$_" }
}

function Esperar-Sano($nodo) {
    for ($i = 0; $i -lt 40; $i++) {
        $estado = docker inspect -f "{{.State.Health.Status}}" $nodo 2>$null
        if ($estado -eq 'healthy') { return }
        Start-Sleep -Seconds 1
    }
    Write-Host "  $nodo no quedo sano" -ForegroundColor Red
}

$nodos = 'nodo_norte', 'nodo_centro', 'nodo_sur', 'nodo_central'
foreach ($n in $nodos) {
    $estado = docker inspect -f "{{.State.Health.Status}}" $n 2>$null
    if ($estado -ne 'healthy') {
        Write-Host "El contenedor $n no esta corriendo. Primero: docker compose up -d --wait" -ForegroundColor Red
        exit 1
    }
}

Titulo "1. Consultas distribuidas (04_consultas.sql)"
Sql nodo_central (Get-Content scripts\04_consultas.sql -Raw)

Titulo "2. Pruebas de fragmentacion (05_pruebas.sql)"
Sql nodo_central (Get-Content scripts\05_pruebas.sql -Raw)

Titulo "2b. P7: el nodo Norte rechaza una sucursal del Sur (debe dar ERROR)"
Sql nodo_norte "INSERT INTO sucursal_n VALUES (150, 'Prueba', 'Merida', 'Sur', 'X');"

Titulo "3. Pruebas de escritura y replicacion (07_pruebas_escritura.sql)"
Sql nodo_central (Get-Content scripts\07_pruebas_escritura.sql -Raw) |
    Where-Object { $_ -notmatch '^(BEGIN|CREATE TABLE|INSERT 0 1|DO|UPDATE 1|DELETE 1|SELECT \d+|ROLLBACK)$' }

if (-not $SinFallo) {
    Titulo "4. Tolerancia a fallos: se apaga nodo_sur"
    docker stop nodo_sur | Out-Null
    Write-Host "nodo_sur detenido." -ForegroundColor Yellow

    Write-Host "`n[F1] Consulta de una sucursal del Norte (esperado: funciona, no toca el Sur)" -ForegroundColor Green
    Sql nodo_central "SELECT COUNT(*) AS ventas, SUM(total) AS monto FROM venta WHERE id_sucursal = 100;"

    Write-Host "[F2] Consulta global de ventas (esperado: ERROR, falta el fragmento Sur)" -ForegroundColor Green
    Sql nodo_central "SELECT COUNT(*) FROM venta;"

    Write-Host "`n[F3] Registrar una venta en el Norte (esperado: funciona; se deshace con ROLLBACK)" -ForegroundColor Green
    Sql nodo_central "BEGIN; SELECT registrar_venta(100, 'Efectivo', (SELECT jsonb_agg(jsonb_build_object('id_producto', id_producto, 'cantidad', 1)) FROM (SELECT id_producto FROM norte.inventario_n WHERE id_sucursal = 100 AND existencia > 0 LIMIT 1) x)) AS venta_nueva; ROLLBACK;"

    Write-Host "[F4] Cambiar un precio (esperado: ERROR, la replica exige escribir en los 3 nodos)" -ForegroundColor Green
    Sql nodo_central "UPDATE producto SET precio = precio + 1 WHERE id_producto = 1;"
    Write-Host "`n[F5] Precio del producto 1 en Norte y Centro (esperado: sin cambio, la transaccion se deshizo)" -ForegroundColor Green
    Sql nodo_central "SELECT 'norte' AS nodo, precio FROM norte.producto WHERE id_producto = 1 UNION ALL SELECT 'centro', precio FROM centro.producto WHERE id_producto = 1;"

    Write-Host "Encendiendo nodo_sur..." -ForegroundColor Yellow
    docker start nodo_sur | Out-Null
    Esperar-Sano nodo_sur

    Write-Host "[F6] Consulta global con el Sur de vuelta (esperado: 3 regiones)" -ForegroundColor Green
    Sql nodo_central "SELECT s.region, COUNT(*) AS ventas FROM venta v JOIN sucursal s USING (id_sucursal) GROUP BY s.region ORDER BY s.region;"
}

Titulo "Fin de las pruebas"
