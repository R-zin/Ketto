param([Parameter(Mandatory=$true)][string]$Output)
$ErrorActionPreference='Stop'
$Output=$ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Output)
New-Item -ItemType Directory -Path (Split-Path -Parent $Output) -Force | Out-Null
Add-Type -AssemblyName System.Speech
$synth=New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $format=New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000,[System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,[System.Speech.AudioFormat.AudioChannel]::Mono)
    $synth.SetOutputToWaveFile($Output,$format)
    $synth.Speak('Security needed at gate number two. Please send the team to the main entrance.')
} finally { $synth.Dispose() }
