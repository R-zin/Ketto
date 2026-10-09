param([Nullable[int]]$Port = $null)
$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectDirectory
if (-not (Test-Path -LiteralPath '.env')) { throw 'Copy .env.example to .env and configure the organisation first.' }
if ($null -ne $Port) { if ($Port -lt 1 -or $Port -gt 65535) { throw 'Port must be between 1 and 65535.' }; $env:PORT = [string]$Port }
& node --env-file=.env server/dist/index.js
