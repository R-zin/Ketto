[CmdletBinding(SupportsShouldProcess = $true)]
param()
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
if (-not (Test-Path -LiteralPath '.env')) { throw 'Local configuration is missing.' }
$dataDirectory = & node --env-file=.env -p "process.env.DATA_DIR || './data'"
if ($LASTEXITCODE -ne 0) { throw 'Could not read the local configuration.' }
$dataDirectory = if ([IO.Path]::IsPathRooted($dataDirectory)) { [IO.Path]::GetFullPath($dataDirectory) } else { [IO.Path]::GetFullPath((Join-Path $projectRoot $dataDirectory)) }
$serverFile = Join-Path $projectRoot 'server\dist\index.js'
$mediaConfig = Join-Path $dataDirectory 'runtime\livekit.yaml'
$stopped = 0
foreach ($process in Get-CimInstance Win32_Process) {
    if (-not $process.CommandLine) { continue }
    $isServer = $process.Name -eq 'node.exe' -and $process.CommandLine.Contains('"' + $serverFile + '"')
    $isMedia = $process.Name -eq 'livekit-server.exe' -and $process.CommandLine.Contains('"' + $mediaConfig + '"')
    if (($isServer -or $isMedia) -and $PSCmdlet.ShouldProcess("$($process.Name) (PID $($process.ProcessId))", 'Stop this project service')) {
        Stop-Process -Id $process.ProcessId
        $stopped++
    }
}
Write-Host "Stopped $stopped service(s) launched for this project."
