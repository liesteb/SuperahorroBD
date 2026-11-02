# ============================================================
# exportar.ps1  |  Regenera los diagramas y los exporta a PNG, y la propuesta a PDF
# Requiere Node.js y Microsoft Edge (viene con Windows).
# Uso:  powershell -ExecutionPolicy Bypass -File docs\fuentes\exportar.ps1
# ============================================================
$ErrorActionPreference = 'Stop'
$fuentes   = $PSScriptRoot
$docs      = Split-Path $fuentes -Parent
$diagramas = Join-Path $docs 'diagramas'

$edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
          "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") |
        Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $edge) { throw 'No se encontro Microsoft Edge' }

node (Join-Path $fuentes 'generar_diagramas.js')

# SVG -> PNG al doble de resolucion (el tamano de la ventana sale del propio SVG)
Get-ChildItem $diagramas -Filter *.svg | ForEach-Object {
    $svg = Get-Content $_.FullName -Raw
    $w = [regex]::Match($svg, 'width="(\d+)"').Groups[1].Value
    $h = [regex]::Match($svg, 'height="(\d+)"').Groups[1].Value
    $png = [IO.Path]::ChangeExtension($_.FullName, 'png')
    $url = ([Uri]$_.FullName).AbsoluteUri
    Start-Process -Wait -FilePath $edge -ArgumentList '--headless=new', '--disable-gpu', '--hide-scrollbars',
        '--force-device-scale-factor=2', "--window-size=$w,$h", "--screenshot=$png", $url
    Write-Host "exportado $png"
}

# Propuesta HTML -> PDF
$html = Join-Path $fuentes 'propuesta_fragmentacion.html'
$pdf  = Join-Path $docs 'Propuesta_Fragmentacion_Horizontal.pdf'
Start-Process -Wait -FilePath $edge -ArgumentList '--headless=new', '--disable-gpu', '--no-pdf-header-footer',
    "--print-to-pdf=$pdf", ([Uri]$html).AbsoluteUri
Write-Host "exportado $pdf"
