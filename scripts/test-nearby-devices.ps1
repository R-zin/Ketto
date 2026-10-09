param(
    [string]$Transmitter='fc76dcff',
    [string]$Receiver='RZCX60GQZEB',
    [string]$Adb='C:\Android\Sdk\platform-tools\adb.exe'
)
$ErrorActionPreference='Stop'
$repo=Split-Path $PSScriptRoot -Parent
$demoPath=Join-Path $repo 'data/local-demo/processes.json'
$demo=Get-Content -LiteralPath $demoPath | ConvertFrom-Json
$directory=Join-Path $repo ('data/nearby-acceptance/'+(Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $directory -Force | Out-Null
$marker='Nearby-acceptance-'+(Get-Date -Format 'HHmmss')
$apiStopped=$false
$runs=@()
function Start-Test([string]$serial,[string]$sender){
    $out=Join-Path $directory ($serial+'.txt')
    $err=Join-Path $directory ($serial+'.stderr.txt')
    $testArguments=@('-s',$serial,'shell','am','instrument','--user','0','-w','-e','class','org.kettoo.app.NearbyDeviceTest','-e','sender',$sender,'-e','marker',$marker,'org.kettoo.app.test/androidx.test.runner.AndroidJUnitRunner')
    $process=Start-Process -FilePath $Adb -ArgumentList $testArguments -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err -PassThru
    return @{Process=$process;Log=$out;Serial=$serial}
}
function Read-TestLog([string]$path){
    if(!(Test-Path -LiteralPath $path)){return ''}
    $stream=[System.IO.File]::Open($path,[System.IO.FileMode]::Open,[System.IO.FileAccess]::Read,[System.IO.FileShare]::ReadWrite)
    $reader=[System.IO.StreamReader]::new($stream)
    try{return $reader.ReadToEnd()}finally{$reader.Dispose()}
}
function Wait-Marker([string]$pattern,[int]$seconds){
    if($runs.Count -ne 2){throw 'Both device runners must be present'}
    $until=(Get-Date).AddSeconds($seconds)
    do{
        $all=$true
        foreach($run in $runs){$testLogText=Read-TestLog $run.Log;if(-not [regex]::IsMatch($testLogText,$pattern)){$all=$false;if($run.Process.HasExited){throw ('Device test ended early: '+$run.Serial+"`n"+$testLogText)}}}
        if($all){return}
        Start-Sleep -Milliseconds 500
    }while((Get-Date) -lt $until)
    throw ('Timed out waiting for '+$pattern+'; logs: '+$directory)
}
function Restart-Api {
    $node=(Get-Command node).Source
    $p=Start-Process -FilePath $node -ArgumentList '--env-file=.env','server/dist/index.js' -WorkingDirectory $repo -WindowStyle Hidden -RedirectStandardOutput (Join-Path $repo 'data/local-demo/api.stdout.log') -RedirectStandardError (Join-Path $repo 'data/local-demo/api.stderr.log') -PassThru
    @{api=$p.Id;media=$demo.media} | ConvertTo-Json -Compress | Set-Content -LiteralPath $demoPath
    Write-Output ('Organisation API restored: '+$p.Id)
}
try{
    $runs+=Start-Test $Receiver 'false'
    $runs+=Start-Test $Transmitter 'true'
    Write-Output ('Preparing two devices; logs: '+$directory)
    Wait-Marker 'KETTOO_NEARBY_PREPARED' 120
    $apiProcess=Get-CimInstance Win32_Process -Filter ('ProcessId='+$demo.api)
    if($apiProcess.Name -ne 'node.exe' -or $apiProcess.CommandLine -notmatch 'server.dist.index.js'){throw 'API process identity mismatch'}
    Stop-Process -Id $demo.api
    $apiStopped=$true
    Write-Output 'API outage started; waiting for automatic discovery, live microphone audio and replay.'
    Wait-Marker 'KETTOO_NEARBY_OUTAGE_PASSED' 130
    Restart-Api
    $apiStopped=$false
    Wait-Marker 'KETTOO_NEARBY_RECOVERY_SYNC_PASSED' 120
    foreach($run in $runs){if(!$run.Process.WaitForExit(10000)){throw 'Device runner did not finish'};$content=Get-Content -LiteralPath $run.Log -Raw;if($content -notmatch 'OK \(1 test\)'){throw $content};Write-Output $content}
}finally{
    if($apiStopped){Restart-Api}
}
