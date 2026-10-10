param(
    [switch]$NoBrowser,
    [switch]$SkipBuild,
    [switch]$NoMedia,
    [switch]$NoTestUsers
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

function Invoke-NodeTask([string[]]$TaskArguments) {
    & node @TaskArguments
    if ($LASTEXITCODE -ne 0) { throw 'A Node.js task failed. See the message above.' }
}
function Test-Listening([string]$Address, [int]$Port) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $task = $client.ConnectAsync($Address, $Port)
        return ($task.Wait(400) -and $client.Connected)
    } catch { return $false } finally { $client.Dispose() }
}
function Wait-Dashboard([string]$Url) {
    $deadline = (Get-Date).AddSeconds(25)
    do {
        try {
            $health = Invoke-RestMethod -Uri "$Url/api/health" -TimeoutSec 2
            if ($health.ok -eq $true -and $health.version) { return }
        } catch { }
        Start-Sleep -Milliseconds 300
    } while ((Get-Date) -lt $deadline)
    throw "Dashboard did not start. Check $runtimeDirectory\server-error.log"
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js 24 or newer, then run start.bat again.' }
$nodeMajor = [int](& node -p 'parseInt(process.versions.node)')
if ($nodeMajor -lt 24) { throw 'Node.js 24 or newer is required.' }
if (-not (Test-Path -LiteralPath 'node_modules\fastify\package.json')) {
    Write-Host 'Installing project dependencies...'
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
}
if (-not (Test-Path -LiteralPath '.env')) {
    $initialise = @'
const fs=require('node:fs'),crypto=require('node:crypto');
const password=crypto.randomBytes(18).toString('base64url');
const secret=crypto.randomBytes(32).toString('hex');
fs.mkdirSync('data',{recursive:true});
fs.writeFileSync('.env',`ADMIN_EMAIL=admin@kettoo.local\nADMIN_PASSWORD=${password}\nHOST=0.0.0.0\nPORT=8787\nDATA_DIR=./data\nLIVEKIT_URL=ws://127.0.0.1:7880\nLIVEKIT_INTERNAL_URL=http://127.0.0.1:7880\nLIVEKIT_API_KEY=kettoo\nLIVEKIT_API_SECRET=${secret}\n`,{flag:'wx',mode:0o600});
fs.writeFileSync('data/local-admin-sign-in.txt',`Email: admin@kettoo.local\nPassword: ${password}\n`,{flag:'wx',mode:0o600});
console.log('Local configuration created. Admin credentials: data/local-admin-sign-in.txt');
'@
    Invoke-NodeTask -TaskArguments @('-e', $initialise)
}
$readSettings = @'
const keys=['PORT','DATA_DIR','LIVEKIT_URL','LIVEKIT_INTERNAL_URL','LIVEKIT_API_KEY','LIVEKIT_API_SECRET'];
console.log(JSON.stringify(Object.fromEntries(keys.map(k=>[k,process.env[k]||'']))));
'@
$settingsText = & node --env-file=.env -e $readSettings
if ($LASTEXITCODE -ne 0) { throw 'Could not read .env.' }
$settings = $settingsText | ConvertFrom-Json
$serverPort = if ($settings.PORT) { [int]$settings.PORT } else { 8787 }
if ($serverPort -lt 1 -or $serverPort -gt 65535) { throw 'PORT must be between 1 and 65535.' }
$dataDirectory = if ($settings.DATA_DIR) { $settings.DATA_DIR } else { './data' }
$dataDirectory = if ([IO.Path]::IsPathRooted($dataDirectory)) { [IO.Path]::GetFullPath($dataDirectory) } else { [IO.Path]::GetFullPath((Join-Path $projectRoot $dataDirectory)) }
$runtimeDirectory = Join-Path $dataDirectory 'runtime'
New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
if (-not $SkipBuild) {
    Write-Host 'Building the server and dashboard...'
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Build failed. The existing server was left running.' }
}
$serverFile = Join-Path $projectRoot 'server\dist\index.js'
if (-not (Test-Path -LiteralPath $serverFile) -or -not (Test-Path -LiteralPath 'web\dist\index.html')) { throw 'Build files are missing. Run start.bat without -SkipBuild.' }

if (-not $NoMedia -and $settings.LIVEKIT_URL -and $settings.LIVEKIT_API_KEY -and $settings.LIVEKIT_API_SECRET) {
    $mediaAddress = if ($settings.LIVEKIT_INTERNAL_URL) { [Uri]$settings.LIVEKIT_INTERNAL_URL } else { [Uri]($settings.LIVEKIT_URL -replace '^ws', 'http') }
    if (-not (Test-Listening $mediaAddress.Host $mediaAddress.Port)) {
        if ($mediaAddress.Host -notin @('127.0.0.1', 'localhost', '::1')) { throw 'The configured remote audio service is unavailable. Start it on its host or use -NoMedia.' }
        $mediaBinary = Join-Path $projectRoot 'tools\livekit-server.exe'
        if (-not (Test-Path -LiteralPath $mediaBinary)) {
            $mediaCommand = Get-Command livekit-server.exe -ErrorAction SilentlyContinue
            if ($mediaCommand) { $mediaBinary = $mediaCommand.Source } else { throw 'LiveKit is missing. Put the official livekit-server.exe in tools, or use -NoMedia to start only the dashboard.' }
        }
        $publicAddress = [Uri]$settings.LIVEKIT_URL
        $parsedAddress = $null
        $nodeAddress = if ([Net.IPAddress]::TryParse($publicAddress.Host, [ref]$parsedAddress) -and $parsedAddress.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork) { $publicAddress.Host } else { '127.0.0.1' }
        $keyJson = ConvertTo-Json -InputObject ([string]$settings.LIVEKIT_API_KEY) -Compress
        $secretJson = ConvertTo-Json -InputObject ([string]$settings.LIVEKIT_API_SECRET) -Compress
        $nodeJson = ConvertTo-Json -InputObject $nodeAddress -Compress
        $mediaConfig = Join-Path $runtimeDirectory 'livekit.yaml'
        $configText = "port: $($mediaAddress.Port)`nbind_addresses:`n  - '0.0.0.0'`nrtc:`n  tcp_port: 7881`n  port_range_start: 50000`n  port_range_end: 50100`n  use_external_ip: false`n  node_ip: $nodeJson`nkeys:`n  ${keyJson}: $secretJson`nlogging:`n  level: warn`n"
        [IO.File]::WriteAllText($mediaConfig, $configText, (New-Object Text.UTF8Encoding $false))
        $mediaProcess = Start-Process -FilePath $mediaBinary -ArgumentList @('--config', "`"$mediaConfig`"") -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeDirectory 'media.log') -RedirectStandardError (Join-Path $runtimeDirectory 'media-error.log')
        $deadline = (Get-Date).AddSeconds(20)
        while (-not (Test-Listening $mediaAddress.Host $mediaAddress.Port)) {
            $mediaProcess.Refresh()
            if ($mediaProcess.HasExited -or (Get-Date) -gt $deadline) { throw "Audio service did not start. Check $runtimeDirectory\media-error.log" }
            Start-Sleep -Milliseconds 300
        }
        Write-Host 'Local audio service started.'
    } else { Write-Host 'Audio service already running; reusing it.' }
    Invoke-NodeTask -TaskArguments @('--env-file=.env', 'scripts/check-media.mjs')
} elseif (-not $NoMedia) { Write-Host 'Audio is not configured; starting the dashboard only.' }

if (-not $NoTestUsers) { Invoke-NodeTask -TaskArguments @('--env-file=.env', 'scripts/setup-test-users.mjs') }
$dashboardUrl = "http://127.0.0.1:$serverPort"
$connection = Get-NetTCPConnection -LocalPort $serverPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($connection) {
    $running = Get-CimInstance Win32_Process -Filter "ProcessId = $($connection.OwningProcess)"
    if ($running.CommandLine -and $running.CommandLine.Contains($serverFile) -and -not $SkipBuild) {
        Stop-Process -Id $running.ProcessId
        $connection = $null
    } else {
        $health = Invoke-RestMethod -Uri "$dashboardUrl/api/health" -TimeoutSec 2
        if ($health.ok -ne $true -or -not $health.version) { throw "Port $serverPort is being used by another application." }
        Write-Host 'Dashboard already running; reusing it.'
    }
}
if (-not $connection) {
    $envFile = Join-Path $projectRoot '.env'
    $nodePath = (Get-Command node).Source
    $serverProcess = Start-Process -FilePath $nodePath -ArgumentList @("--env-file=`"$envFile`"", "`"$serverFile`"") -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeDirectory 'server.log') -RedirectStandardError (Join-Path $runtimeDirectory 'server-error.log')
    Write-Host "Dashboard server started (PID $($serverProcess.Id))."
}
Wait-Dashboard $dashboardUrl
Write-Host "`nReady: $dashboardUrl"
Write-Host "Logs: $runtimeDirectory"
if (-not $NoBrowser) { Start-Process -FilePath $dashboardUrl }
