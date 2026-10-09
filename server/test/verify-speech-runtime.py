"""Exercise saved synthetic audio in the PTT, browser and note formats; no mic."""
import json
import subprocess
import sys
import time
from pathlib import Path

import imageio_ffmpeg

model, fixture, output = (Path(p).resolve() for p in sys.argv[1:4])
output.mkdir(parents=True, exist_ok=True)
worker = Path(__file__).resolve().parents[1] / 'speech' / 'transcribe.py'
flags = subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0
files = [fixture]
for extension, codec in [('webm', 'libopus'), ('m4a', 'aac')]:
    target = output / ('synthetic-speech.' + extension)
    subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-nostdin', '-v', 'error',
                    '-y', '-i', str(fixture), '-c:a', codec, str(target)],
                   check=True, timeout=30, creationflags=flags)
    files.append(target)
results = []
for audio in files:
    start = time.monotonic()
    process = subprocess.run([sys.executable, str(worker), str(model), str(audio)],
                             check=True, capture_output=True, text=True,
                             timeout=45, creationflags=flags)
    result = json.loads(process.stdout)
    assert all(word in result['text'] for word in ['security', 'gate', 'entrance']), result
    results.append({'format': audio.suffix, 'seconds': round(time.monotonic()-start, 2), **result})
report = {'fixture': 'Windows synthetic speech, no microphone', 'results': results, 'passed': True}
(output / 'speech-runtime-verification.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report))
