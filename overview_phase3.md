# Kettoo Phase 3 demo implementation

Updated 9 October 2026. Version **0.3.0** includes the complete implementation through Phase 3 in the private repository [SteveSonyJacob/ketto_pvt](https://github.com/SteveSonyJacob/ketto_pvt). Its local checkout is `work/ketto-pvt`. Existing Phase 2 messages and queues are retained through additive migrations.

This repository starts with a complete source snapshot. Phase 2 and Phase 3 were implemented and verified in `work/ketto-github` before this publication. The original checkout and its `R-zin/Ketto` remote were left unchanged during the move to this private repository. The Phase 2 overview remains a historical record of that earlier local-only state.

## Agreed demo behavior

- Keep individual entries in the existing communication log, including PTT, broadcasts, audio notes and chat. There is no combined voice/history screen.
- Audio entries show **Transcript / Automatic** beneath their player and above acknowledgement. Live bursts show a placeholder until the saved recording is available. Pending, unavailable and failed states are explicit; replay remains available for checking the words.
- **Acknowledge & archive** moves every message type into **Archived**, for that person only. Other members retain their active copy until they acknowledge it. This applies to the sender's own entries too. Archive is a view of durable personal receipts, not a second recording copy. It retains the audio, transcript, attachments and original message ID.
- Acknowledgement requires server confirmation. Offline and Nearby receipts do not claim acknowledgement. Recognition does not block manual acknowledgement when speech is unclear or unavailable.
- Choose the simplest reliable offline engine for the demo: bundled Vosk English (`vosk-model-small-en-us-0.15`), rather than relying on the phone's Google recognition installation.

## Implemented features

| Feature | Behavior |
| --- | --- |
| Android Volume Down PTT | Opt-in in Settings, active on duty. Hold requests the existing PTT lease; release stops it. The chosen permitted conversation is the target, with assigned-team fallback. Touch and hardware use the same media coordinator. |
| Input feedback and safety | Success vibration follows actual TRANSMITTING; release has two pulses; error has a longer pulse. Repeat events are consumed. A 30-second input watchdog, server lease, per-press identity, duty/call/service cancellation and permission-change reconciliation prevent stale transmission. |
| Listening volume | Volume Up remains available. The listening slider adjusts call/communication volume for the current output. Off duty or with hardware PTT disabled, Volume Down behaves normally. |
| Optional background keys | A narrowly configured accessibility service filters key events without requesting screen content. Enable it manually for background key delivery. Genuine lock/display-off behavior depends on the phone. |
| Pocket Mode | A black foreground screen with reduced brightness, keep-screen-on and an obvious exit. It restores previous brightness on exit. This is the practical demo fallback for phones that stop delivering locked-screen keys. |
| Android offline transcripts | Uses saved PTT PCM, recorded/imported audio notes and received Nearby notes. The model is packaged in the APK. Queued notes can be recognised without a server connection. No second microphone is opened for a transcript. |
| Browser-origin audio transcripts | An organisation-hosted Vosk/FFmpeg worker processes uploaded recordings without a cloud API. It starts one job at a time and defers new work during live leases/accepted calls. Results update the original audio message for authorised recipients. |
| Foreground dictation | Chat composer, issue description and reply fields have Dictate offline / Stop dictation. Text remains editable and requires explicit sending. Pauses retain earlier words; a session is bounded to 60 seconds. PTT cleanly finishes dictation before taking capture; incoming audio stops it. |
| Durable recovery | Android Room 3 records unfinished PTT replay uploads and transcripts. Browser recordings use the IndexedDB outbox. Server transcript jobs survive restart. Stable IDs prevent a transcript or upload retry creating a second chat entry. Late recognition results cannot replace a newer attachment. |
| Personal archive | Android and browser have Log / Archived folders. The server supports `folder=active|archived|all` history filtering by the authenticated user's receipt. The default `all` preserves existing client synchronization. |

## One-time setup

From the repository root, with Python available:

```powershell
.\scripts\setup-speech.ps1
npm run build
```

The setup downloads the model from the official Vosk site and installs the local speech runtime under ignored `data/speech`. The existing application data directory normally uses this same folder. For a different organisation data path, point `STT_MODEL_PATH` at the model directory and `STT_PYTHON` at the speech runtime's Python executable before starting the server. On another host, preserve the model and install `server/speech/requirements.txt` into its Python environment. Restart after first setup, or use Retry transcript to enable recognition after a model becomes available.

Build Android after model setup:

```powershell
cd android
.\gradlew.bat :app:assembleDebug :app:assembleDebugAndroidTest :app:lintDebug
```

The model expands once into app-private storage at first launch. Wait for **Offline English transcription ready** in Settings before demonstrating dictation. No speech model download is needed on the phone.

The local deliverable is `outputs/phase3/Kettoo-0.3.0-debug.apk` in the workspace. Upgrade the existing debug app without uninstalling or clearing storage to retain its session/history. This APK has not been installed on the disconnected test phones.

## Demo sequence

1. Open Kettoo, verify English model readiness, start duty and select the intended team/private-admin/prepared broadcast conversation. Live PTT still needs the organisation LAN, API and LiveKit; internet is unnecessary.
2. Enable **Volume Down: hold to talk** in Settings. Return to the log or Threads, hold the button, wait for the ready vibration, speak and release. Verify the receiver hears it and the log later shows replay plus transcript.
3. Open an audio entry in the log. Read its transcript, then click **Acknowledge & archive**. Open Archived to replay it. Verify another member still sees the entry in Log.
4. Repeat acknowledgement for a text/photo/video entry. Archive is personal for all message types.
5. For background keys, enable Kettoo's accessibility service manually. Sideloaded apps may require Android App info → Allow restricted settings. Use Pocket Mode for the main demonstration; test genuine locked-screen keys separately.
6. Disable Wi-Fi/mobile data for the offline dictation check. Dictate an issue description or chat draft, pause, continue, stop and edit it. Restore the LAN to send queued work or demonstrate live PTT. Nearby uses its existing direct-peer path.

Do not claim locked-screen operation or noisy-room/Indian-accent accuracy until checked on the actual demo phones. This build supports English only, recorded audio recognition up to 35 seconds and existing 30-second PTT/note limits. It does not produce real-time live captions or transcribe private voice/video calls. Those are separate features from communication-log audio.

The Phase 2 debug HTTPS leaf certificates expire **10 October 2026**. Refresh those leaves while preserving the trusted demo CA before the next phone session after that date, as already recorded in the Phase 2 overview.

## Verification completed

- Backend: **28/28 tests pass**. Includes personal archive isolation, monotonic acknowledgement, voice transcript identity/deduplication, invalid metadata rejection, deferred recognition, failure/retry and stale-result protection, alongside the existing Phase 1/2 tests.
- Server and browser production builds pass.
- Android debug APK, instrumentation APK and lint pass. The isolated Phase3StorageTest is compiled for later phone execution; it has not run because ADB lists no connected devices.
- Actual local Vosk + bundled FFmpeg recognised synthetic saved **WAV, WebM/Opus and AAC/M4A** files: “security needed at gate number two please send a team to the main entrance”. Each took about four seconds on this computer. Results are in `outputs/phase3/speech-runtime-verification.json`; no live microphone capture was used.
- Browser preview confirmed transcript placement above acknowledgement, audio/text archiving, retained transcript/replay and persistence after reload. Screenshots are in `outputs/phase3`.
- Hardware keys, vibration patterns, native decoding/dictation, Room upgrade on installed phones, calls/broadcast conflicts and genuine display-off operation remain physical-device acceptance checks. Earlier Phase 2 device results are historical, not repeated Phase 3 results.

## Disposable browser preview

`http://127.0.0.1:8793` uses isolated, ignored preview data. Login: `receiver@phase3.preview`, password `phase3-demo-password`. It contains one synthetic audio note and one labelled text entry, both acknowledged during verification and now in Archived. LiveKit is deliberately unconfigured for this UI preview; use the normal organisation server/media stack for live audio.

To create another disposable preview from the repository root:

```powershell
.\scripts\make-speech-fixture.ps1 -Output ..\..\outputs\phase3\speech-fixture.wav
node --import tsx server/test/phase3-preview.ts
```

Approve the new browser device through the preview administrator. The optional `approve-phase3-preview.ts` test helper approves only this fixture's named accounts and refuses ambiguous preview directories. The original phone organisation and Phase 2 preview data were not used for these checks.

Vosk engine/model sources and licensing are documented in [server/speech/README.md](server/speech/README.md).
