# Kettoo

Kettoo is a private communications and coordination app for event teams. It combines a native Android app, a browser console, an organisation-run server, and self-hosted live audio/video. Version **0.3.0** includes the features below.

## Features

### Accounts, devices, and organisation

- Staff can request an account and register a device. An administrator must approve the account and device before they can use the organisation.
- Admins sign in with their existing credentials and automatically enrol new browsers/devices. Explicitly revoked accounts and devices remain blocked.
- Administrators can review and approve or revoke accounts and devices. Revocation blocks new authenticated API access and removes active media access when the media service is reachable.
- Every installation keeps a persistent organisation identity. Private data, credentials, and signing keys belong to the organisation's local server and data directory.
- Admins manage channels, volunteer memberships, and the designated duty-admin device. Volunteers can belong to multiple channels and switch channels when talking; communication access and physical location are managed separately.
- Presence distinguishes connected devices, on-duty sessions, audio readiness, busy devices, and last seen.

### Conversations, messages, and attachments

- Staff can read and send messages in permitted channels, open private conversations with approved people, and use All Staff. Only admins can post to All Staff.
- Messages include text, photos, videos, voice notes, recorded push-to-talk bursts, and admin broadcasts. Stable IDs make retries safe and prevent duplicate entries.
- Delivery states distinguish server receipt, recipient receipt, and acknowledgement. A connection or audio-room status does not imply that a person heard a message.
- Message history and attachments are restricted to the conversation's authorized members. Uploads are checked for type, size, and content; transfers pause during live communication and retry afterward.
- Image attachments are limited to 5 MB, video to 10 MB, and audio to 1 MB. Conserve Data disables video.
- Each person has an Inbox and personal Archive. Acknowledging a message requires server confirmation and archives only that person's copy; it keeps its original ID, recording, transcript, and attachments. Other recipients keep their own active copies until they acknowledge them.

### Live voice, broadcasts, and calls

- On-duty staff hold TALK to request permission to transmit on an eligible team or private-admin channel. The interface reports whether it is ready, requesting, transmitting, busy, or blocked; release stops transmission. Bursts are capped at 30 seconds.
- Server-managed speaking leases serialize competing talkers and stop stale transmitters. The server decides who may publish to each LiveKit room.
- A volunteer can reserve a private Talk to admin exchange with the designated duty-admin device, send a report, receive a reply, and end the exchange. Competing requests see busy/unavailable state.
- Admins can prepare and end broadcasts to one team, selected teams, or everyone. Audience membership is fixed for each broadcast, and only its intended recipients receive its media and history access.
- A broadcast takes priority over overlapping team PTT; unrelated team traffic can continue. Accepted private calls have exclusive audio priority. Audio reception is coordinated across screens, with speaker/headset routing available.
- Private voice and video calls support ringing, accepting, rejecting, ending, and busy handling. Video calls require camera access; video is disabled by Conserve Data. Camera capture pauses when the app is no longer in the foreground.
- PTT replay uses the same microphone capture track. The recording is saved to the message log and can be replayed after the burst.

### Offline and nearby communication

- Android stores messages and pending operations locally with Room; the browser uses IndexedDB. Queued sends, check-ins, issue reports, and replies retry after a connection returns, preserving IDs and showing pending or rejected status.
- Android can cache conversation history and permitted issue details. Cached information may be stale while offline; new permission changes and revocations require reconnecting to the server.
- With Nearby enabled and Android permissions granted, approved phones automatically discover and authenticate each other during an API or permitted media outage. No manual peer picker is required.
- Directly connected, permitted phones can exchange live PTT audio, text, voice notes, photos, and videos. Recipients reserve an audio floor before a burst starts; capture stops if a recipient becomes unavailable, permission expires, or the transfer stalls.
- Completed messages and recordings sync to the organisation server after recovery. Signed content, device identity checks, hashes, and stable IDs protect transfers and deduplicate retries.
- Offline credentials last up to eight hours. Permission changes, acknowledgement, private calls, and issue/check-in server operations need server access. Nearby is direct peer-to-peer communication, not multi-hop venue mesh, and the browser does not implement Nearby.

### Venue operations and issue threads

- Admins can upload multiple floor plans and place, rename, and edit named zones. Supported floor-plan image formats are PNG, JPEG, and WebP, up to 5 MB.
- Volunteers can check in to a floor and zone independently of team assignment. The app shows when a location was last reported; delayed offline check-ins cannot overwrite a newer confirmed location.
- Operations shows connected on-duty staffing by location, unresolved issue counts, and issue markers. Location counts deduplicate volunteers and identify unknown, disconnected, or last-reported positions.
- Staff can create issue threads with a title, description, normal/high/urgent priority, permitted audience, optional location, and photo. Admins can target a team; staff can report to their team or everyone according to access rules.
- Threads support chronological replies, filters, assignment claims, admin reassignment, resolution, and reopening. A claim or status change takes effect only after server confirmation; concurrent stale changes are rejected. Resolved issues remain available in history and leave the unresolved map counts.
- Thread and image access is restricted by the issue audience and current operational assignment. Offline queues support new reports and replies, while ownership and lifecycle changes require the server.

### Speech, dictation, and Android controls

- Saved push-to-talk recordings, audio notes, and received Nearby notes can receive automatic English transcripts using Vosk. Android recognition runs on-device; the server can process uploaded recordings locally with Vosk and FFmpeg. No cloud speech service is required.
- Transcripts remain attached to their original audio entry alongside replay. Pending, processing, unavailable, and failed states are visible, and failed recognition can be retried. Recognition does not block acknowledgement.
- Offline dictation creates an editable draft in chat, issue descriptions, and replies. Dictation pauses without discarding earlier words, is bounded to 60 seconds, and never sends text until the user chooses to send.
- Optional Volume Down push-to-talk uses the same permission and media controls as the on-screen TALK button; Volume Up remains available for listening volume. Input feedback follows actual transmission state, and cancellation, duty loss, calls, and a 30-second watchdog stop capture.
- An optional accessibility service can deliver hardware key events in the background. Pocket Mode provides a dim, black, keep-awake screen for demonstrations. True locked-screen key behavior depends on the phone and its power settings.
- The app has Comms, Threads, and People navigation, with Settings in the header. People lists channels and approved staff for conversation selection. Comms separates Live Voice from Message Log; it shows the selected recipient and connection state, and offers context-aware PTT status. The log includes replay, transcripts, archive controls, calls, dictation, and attachments.

### Browser console

The React console provides Operations, Threads, Communications, People, Organisation, and Settings views. Admins manage organisation access, devices, teams, assignments, duty admin, broadcasts, floors, and zones. Staff use permitted conversations, issue workflows, check-ins, and media. The console supports live media through LiveKit but does not provide Android Nearby transport.

### Not included

Multi-hop mesh forwarding, cloud AI, automatic staff allocation or escalation, GPS dispatch, offline private calls, group video calls, always-open microphone, and guaranteed locked-screen hardware PTT are outside the current implementation. Device-specific behavior such as background keys, audio routing, recognition accuracy, and power management should be acceptance-tested on the phones used by an organisation.

## Project layout

```text
android/   Native Android app and device acceptance tests
server/    TypeScript API, SQLite storage, media access and speech worker
web/       React staff and administration console
deploy/    LiveKit, HTTPS proxy and local launch configuration
scripts/   Speech setup and device test helpers
docs/      Nearby behaviour and UI review notes
```

## Run the server and web app

Requires **Node.js 24 or newer**. From the repository root:

On Windows, double-click **`start.bat`**. It installs missing dependencies, builds the API and web dashboard, starts the local LiveKit audio service, prepares three volunteer test accounts, and opens the dashboard. The API serves the built web app; a separate Vite process is not needed. Existing `.env`, accounts, maps, messages, and passwords are preserved. Services run in the background; logs and the generated LiveKit configuration are under `DATA_DIR/runtime`.

The launcher uses `tools/livekit-server.exe` or LiveKit on PATH and the credentials/address in `.env`. For a fresh checkout without `.env`, it creates local settings and saves the initial admin sign-in to `data/local-admin-sign-in.txt`. The default media address for a fresh checkout is localhost; set `LIVEKIT_URL` to the server's LAN address when testing with phones.

Useful launcher options:

```bat
start.bat -NoBrowser
start.bat -SkipBuild
start.bat -NoMedia -NoTestUsers
stop.bat
setup-test-users.bat --count 3
setup-test-users.bat --approve-devices
```

The test-account helper creates `vol1@kettoo.local`, `vol2@kettoo.local`, and `vol3@kettoo.local` with individually generated passwords, displays their credentials, and keeps them in the ignored `DATA_DIR/test-users.json`. Use the full email as the sign-in username. Re-running preserves passwords and existing accounts; `--count 5` adds accounts through Vol 5. Volunteer accounts created by the helper are approved, but their new devices still require approval. After their first sign-in, `--approve-devices` approves only these helper-owned test accounts' pending devices. Assign them to the desired channels under Organisation > Channels & memberships. Normal registrations still require approval.

For manual startup:

```powershell
npm ci
npm run build
$env:ADMIN_PASSWORD = 'use-a-unique-password-of-at-least-12-characters'
$env:DATA_DIR = './data'
npm start
```

Open `http://127.0.0.1:8787`. The first administrator email defaults to `admin@kettoo.local`; set `ADMIN_EMAIL` before first start to change it. Keep `.env`, the data directory, database, signing key, and credentials private. Existing installations should keep their data directory and signing key when upgrading.

For development, run `npm run dev -w server` and `npm run dev -w web` in separate terminals. The Vite server proxies `/api` to port 8787. The browser console works without LiveKit; configure LiveKit to enable live audio and video.

## Build Android

Requires JDK 17, Android SDK platform 35, and the included Gradle 8.11.1 wrapper. Offline speech model setup requires internet the first time; the runtime and model are kept under ignored `data/speech`.

```powershell
.\scripts\setup-speech.ps1
cd android
.\gradlew.bat assembleDebug lintDebug
```

The debug APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`. Sign in and approve the device through the organisation administrator. Grant microphone, notification, and Nearby permissions as requested; camera permission is used for video calls. Start duty before transmitting. Hold TALK and wait for **TRANSMITTING** before speaking.

## Organisation deployment

Copy `.env.example` to `.env` and set unique administrator and LiveKit secrets. Set the media host address in `deploy/livekit.yaml`, matching LiveKit credentials in both configurations, and configure `kettoo.local` / `media.kettoo.local` DNS and trusted HTTPS certificates. `deploy/compose.yaml` runs LiveKit and Caddy; `deploy/start.ps1` starts the API. Restrict network access to the intended organisation. See the deployment and trust details in [Nearby failover](docs/nearby-failover.md) and the [Phase 3 overview](overview_phase3.md).

## Verification and project notes

Run the backend suite with `npm test` and build both browser and server with `npm run build`. Android lint and debug builds use the Gradle command above. Real-media, speech, and physical-device checks require their respective services, model, or connected test phones; consult [Phase 3](overview_phase3.md), [Phase 2](overview_till_phase2.md), and [the Phase 1 verification record](VERIFICATION.md) for what was checked and what still needs device acceptance. These records span different builds, so historical checks do not imply every feature was re-tested in the current build.

Main components: Kotlin/Jetpack Compose, Room, React/TypeScript, Fastify, SQLite, LiveKit, Nearby Connections, and Vosk. Speech recognition runs locally without a cloud speech service. See [speech runtime and licensing](server/speech/README.md). The project is distributed under the [MIT License](LICENSE).
