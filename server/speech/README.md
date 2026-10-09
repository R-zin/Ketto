# Offline demo speech runtime

The Android app bundles `vosk-model-small-en-us-0.15`. The organisation server uses that same local model with Python Vosk 0.3.45 and imageio-ffmpeg 0.6.0. Neither recording recognition nor Android dictation calls a cloud speech service.

Run `scripts/setup-speech.ps1` from the repository root once. Downloads/installations require internet; recognition afterwards uses the installed files. The server invokes `transcribe.py` with an authorised attachment file path, without a shell. FFmpeg converts it to 16 kHz mono PCM; processing is bounded to 35 seconds. The model/runtime are ignored local dependencies, and the Android build copies the downloaded model archive into the APK.

The [official Vosk model catalogue](https://alphacephei.com/vosk/models) lists this 40 MB English model as Apache 2.0. The [Vosk engine license](https://github.com/alphacep/vosk-api/blob/master/COPYING) is Apache 2.0. Upstream engine and model are unmodified. Their notice and full license are included in the APK's `assets/licenses` directory. JNA remains under its upstream licensing. FFmpeg is used through imageio's bundled binary in the server runtime; keep its bundled license material with that environment.

Recognised words are automatic, may be wrong and remain alongside the source audio. English is the only model packaged for this demo. A different language/model is a future configuration change, not an automatic cloud fallback.
