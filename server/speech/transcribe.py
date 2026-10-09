"""Local files only; output one JSON result. No microphone or network access."""
import json
import subprocess
import sys
from pathlib import Path

import imageio_ffmpeg
from vosk import KaldiRecognizer, Model, SetLogLevel

SetLogLevel(-1)
model_path, audio_path = (Path(p).resolve(strict=True) for p in sys.argv[1:3])
if not model_path.is_dir() or not audio_path.is_file():
    raise ValueError('Local model directory and audio file required')
decoded = subprocess.run(
    [imageio_ffmpeg.get_ffmpeg_exe(), '-nostdin', '-v', 'error', '-i', str(audio_path),
     '-t', '35', '-ac', '1', '-ar', '16000', '-f', 's16le', 'pipe:1'],
    check=True, capture_output=True, timeout=20,
    creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0,
).stdout
recognizer = KaldiRecognizer(Model(str(model_path)), 16000)
parts = []
for start in range(0, len(decoded), 8000):
    if recognizer.AcceptWaveform(decoded[start:start + 8000]):
        parts.append(json.loads(recognizer.Result()).get('text', ''))
parts.append(json.loads(recognizer.FinalResult()).get('text', ''))
print(json.dumps({'text': ' '.join(p for p in parts if p).strip()[:4000],
                  'language': 'en-US', 'engine': 'vosk-small-en-us-0.15'}))
