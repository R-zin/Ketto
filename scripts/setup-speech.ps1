param([string]$Python = 'python')
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$speech = Join-Path $repo 'data\speech'
New-Item -ItemType Directory -Path $speech -Force | Out-Null
$archive = Join-Path $speech 'model.zip'
$model = Join-Path $speech 'vosk-model-small-en-us-0.15'
if (!(Test-Path -LiteralPath $archive)) {
    Invoke-WebRequest -Uri 'https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip' -OutFile ($archive + '.partial')
    Move-Item -LiteralPath ($archive + '.partial') -Destination $archive
}
if (!(Test-Path -LiteralPath (Join-Path $model 'am\final.mdl'))) { Expand-Archive -LiteralPath $archive -DestinationPath $speech -Force }
$runtime = Join-Path $speech 'runtime'
if (!(Test-Path -LiteralPath (Join-Path $runtime 'Scripts\python.exe'))) {
    & $Python -m venv $runtime
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the local speech runtime' }
}
& (Join-Path $runtime 'Scripts\python.exe') -m pip install -r (Join-Path $repo 'server\speech\requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'Could not install offline speech dependencies' }
Write-Output 'Offline English model ready for server transcription and Android APK packaging.'
