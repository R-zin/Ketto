# Automatic Nearby failover

Added 10 October 2026 to the Phase 3 Android implementation.

## Use

1. Sign in online once using an approved device to cache organisation permissions and channels.
2. Enable **Nearby** in Settings on every participating phone. Accept the Android permissions and Bluetooth prompt. This also starts duty; discovery does not capture microphone audio.
3. During an API or permitted media-room outage, the phones advertise and discover automatically using Nearby Connections `P2P_CLUSTER`. No peer picker is required. Settings shows authenticated teammates; COMMS shows Nearby audio when the selected channel has a permitted recipient.
4. Hold TALK or the enabled Volume Down PTT key. Speak after **TRANSMITTING** appears. Release to stop; capture is bounded to 30 seconds. Connected recipients must reserve their audio floor and confirm readiness before capture begins.
5. After recovery, Nearby disconnects when all permitted server media rooms are available. Completed messages and recordings upload with their original IDs. Retry delivery and per-device receipts are automatic.

Only directly connected devices receive a burst. This is not multi-hop forwarding or a venue-wide mesh. Multiple senders in separate disconnected groups can speak concurrently. Overlapping connected audiences reserve one incoming floor; simultaneous requests use deterministic device ordering, and a higher-priority admin broadcast can interrupt an ordinary burst. A busy recipient prevents a new burst rather than silently missing that recipient. A lost target, missing renewal, permission expiry or a slow audio pipe stops capture.

## Content and permissions

- Live audio streams PCM16 mono at 16 kHz, approximately 32 KB/s per recipient. Each recipient has a separate bounded writer; a stalled recipient cannot indefinitely block capture. Output uses the same speaker/headset routing as server audio.
- Finished PTT bursts enter the existing log as signed `ptt` recordings. Sender and receiver retain WAV replay and use the existing offline transcript worker. Stable message IDs prevent duplicate entries when either side uploads later.
- Text, audio notes (1 MB), photos (5 MB), and videos (10 MB) use signed envelopes, bounded file copies, SHA-256 checks, deduplication and per-device delivery receipts.
- Signed credentials distinguish live audio access from private text/call access, carry media epochs and bound temporary broadcast/admin-exchange sessions. Peers prove possession of their enrolled device key. Organisation IDs and keys must match before content is accepted.
- Offline credentials last eight hours. Permission changes and revocations cannot propagate across a total outage; reconnect to renew them. The server rechecks current sender approval, membership, live permission, epoch, attachment hash and size during sync.
- Acknowledge/archive and private voice/video calls require the server. Issue/check-in operations retain their existing server outbox; cached maps remain available. Those operations are not transmitted as peer messages.
- Existing V1 single-peer installations do not interoperate with V2. Upgrade each participating Android phone. The browser does not implement Nearby.

## Verification

- 31 backend tests pass, including signed live grants versus private text rights, denied/expired/changed grants, PTT transcript retention, duplicate uploads from sender and recipient, and signed image/video synchronization.
- Android debug app and instrumentation app build successfully; lint reports zero errors (23 existing/dependency/style warnings). The updated debug app is installed on both attached phones without clearing application data.
- Both `NearbyFloorTest` cases pass on the Samsung: three-recipient quorum, duplicate/unknown responses, readiness ordering, deterministic request collision resolution and broadcast priority.
- `NearbyDeviceTest` uses existing approved sessions, a deliberate local API outage, automatic authentication, the real microphone/TALK path, receiver PCM playback counters, signed text/replay delivery, and recovery sync. The Windows orchestrator `scripts/test-nearby-devices.ps1` identifies the API process before stopping it and restores it in `finally`. It requires explicit authorization for live microphone capture.
- Full physical outage/recovery tests pass in both directions on Samsung SM-A356E (Android 16) and OnePlus CPH2613 (Android 14). No manual peer selection was used. The local API was stopped while the phones' radios and Wi-Fi access point remained available; the API was restored automatically after direct delivery.

| Direction | Receiver live PCM checkpoint | Non-silent samples at checkpoint | Completed WAV replay | Result |
| --- | ---: | ---: | ---: | --- |
| OnePlus → Samsung | 64,000 bytes / 32,000 samples played | 2,103 | 116,524 bytes | Automatic authentication, live playout, text/replay receipt and recovery sync passed |
| Samsung → OnePlus | 65,280 bytes / 32,000 samples played | 1,848 | 112,044 bytes | Automatic authentication, live playout, text/replay receipt and recovery sync passed |

The forward recording is confirmed on the server as one `ptt` message with its original ID and matching attachment size. Ambient test audio produced an explicit `unavailable` transcript rather than invented words. Playback counters prove PCM reached Android's audio output; subjective audibility and intelligibility still need a human check.

Logs are retained under ignored `data/nearby-acceptance/20261010-021817` and `20261010-021942`. The first run exposed a release/coroutine-cancellation bug that interrupted replay saving. Finalization now runs in a non-cancellable block; both subsequent complete tests pass.

Three or more physical peers, loss of the Wi-Fi access point, background reception, range and manufacturer power settings need separate acceptance runs. The quorum tests cover three recipient identities; they are not a three-phone radio throughput test.

Google references: [connection strategies](https://developers.google.com/android/reference/com/google/android/gms/nearby/connection/Strategy), [stream/file payloads](https://developers.google.com/nearby/connections/android/exchange-data).
