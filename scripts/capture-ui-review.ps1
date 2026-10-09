param(
    [Parameter(Mandatory=$true)][string]$Serial,
    [Parameter(Mandatory=$true)][string]$OutputPath,
    [string]$Adb='C:\Android\Sdk\platform-tools\adb.exe'
)

# Keep the PNG byte stream intact; Windows PowerShell redirection can corrupt it.
$destination = [System.IO.Path]::GetFullPath($OutputPath)
$info = [System.Diagnostics.ProcessStartInfo]::new()
$info.FileName = $Adb
$info.UseShellExecute = $false
$info.RedirectStandardOutput = $true
$info.RedirectStandardError = $true
$info.CreateNoWindow = $true
foreach ($arg in @('-s', $Serial, 'exec-out', 'screencap', '-p')) { $info.ArgumentList.Add($arg) }
$process = [System.Diagnostics.Process]::Start($info)
$stream = [System.IO.MemoryStream]::new()
try {
    $process.StandardOutput.BaseStream.CopyTo($stream)
    $errorText = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) { throw "Screenshot failed: $errorText" }
    $bytes = $stream.ToArray()
    if ($bytes.Length -lt 8 -or $bytes[0] -ne 137 -or $bytes[1] -ne 80) { throw 'Invalid PNG capture' }
    [System.IO.File]::WriteAllBytes($destination, $bytes)
    Get-Item -LiteralPath $destination | Select-Object FullName, Length
} finally { $stream.Dispose(); $process.Dispose() }
