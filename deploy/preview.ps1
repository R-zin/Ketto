param([int]$Port = 8788)
$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectDirectory
$env:PORT = $Port.ToString()
$env:HOST = '127.0.0.1'
$env:DATA_DIR = Join-Path $projectDirectory 'data/preview'
if (-not $env:ADMIN_PASSWORD) { $previewPassword = Read-Host 'Choose a preview admin password (12+ characters)'; $env:ADMIN_PASSWORD = $previewPassword }
& node server/dist/index.js
