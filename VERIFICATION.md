# Kettoo verification record

This is the Phase 1 record. See [overview_till_phase2.md](overview_till_phase2.md#verification-completed-through-phase-2) for the current version 0.2 implementation, checks and deferred work.

Tested on 9 October 2026. This is a working development build using the supplied monochrome KETTO visual template and the communicator scope in the system plan.

## Delivered implementation

Native Android staff application; responsive staff/admin browser console; organisation-hosted API, SQLite and private attachments; self-hosted LiveKit audio/video; Room/IndexedDB queues; signed direct Nearby text/audio-note exchange; account/device approval, teams, channels, private conversations, All Staff broadcasts, presence and delivery receipts.

## Build and automated checks

| Check                                                    | Result                                                                                                                                   |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Backend permission, persistence and recovery suite       | 12 tests passed                                                                                                                          |
| TypeScript server and browser production builds          | Passed                                                                                                                                   |
| Android debug APK and instrumentation APK builds         | Passed                                                                                                                                   |
| Android `lintDebug`                                      | Passed; non-blocking SDK metadata/deprecated icon warnings                                                                               |
| Three native media clients, generated live channel audio | Both listeners received non-silent audio before release; first decoded frames at 406 / 388 ms; 71 frames per listener in the final trial |
| Actual media permission revocation                       | Release removed publishing permission and unpublished the microphone track                                                               |

The API suite checks unapproved account/device rejection, channel membership, admin-only broadcasts, private pair isolation, durable retry IDs, non-regressing receipts, upload/download boundaries, revocation, origin checks, forged offline credentials, signed peer synchronization, recipient-uploaded audio hash matching, serialized PTT leases, and call recipient/busy rules. Its mock media adapter verifies commands; the separate three-client test verifies actual media-server enforcement.

Organisation display names do not identify media rooms. Room names include the persistent organisation signing-key identity, for channel broadcasts and private calls. The regression check creates two organisations sharing one media adapter, verifies distinct All Staff room names, and checks the actual room arguments passed to token creation. Each organisation must use separate data and keys.

## Physical phone results

| Device           | Android version     | Results                                                                                                                               |
| ---------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Samsung SM-A356E | Android 16 / API 36 | Screen-off live receive, microphone-derived PTT replay, Nearby sender, private voice/video call, listening restored after calls       |
| CPH2613          | Android 14 / API 34 | Screen-off live receive, Nearby recipient with verified playable audio file, private voice/video call, listening restored after calls |

Both phones were pre-enrolled and approved in an isolated test organisation. The laptop and phones shared a local network: laptop `10.80.0.25`, phones `10.80.0.100` and `10.80.0.101`. Initial trials used trusted localhost HTTPS/WSS through USB forwarding and LAN media. The final trial used `https://10.80.0.25:8443` and `wss://10.80.0.25:8444`, with all three test USB network forwards removed on both phones. Both phones established direct Wi-Fi API/signalling connections, and the user confirmed audible screen-off receive on both. USB remained connected for test-runner control, not application networking. The APK's demo certificate trust is scoped to the localhost and specified Wi-Fi endpoints; system trust was not changed.

### Live audio and replay

- Initial decoded-frame checks were positive, but the user reported no audible sound. They were not counted as audible successes.
- Replaced separate per-room audio-output controllers with one shared controller; added output selection; explicitly enabled and routed newly subscribed audio. Extended the playback test and ran the audible check without a decoded-frame sink.
- In the final screen-off trial, the user confirmed **both phones were audible**. Earlier instrumented eight-second trials recorded over 830 non-silent frames on each phone. The final audible trial intentionally did not attach a frame-counting sink.
- After the organisation-room isolation change, a native CPH2613 Wi-Fi regression check received 853 frames, including 667 non-silent frames, with its screen off. The separate real-media integration test also passed with the new room identities.
- A user-approved three-second Samsung microphone burst saved an 87,084-byte mono WAV replay, with 19,246 non-silent samples. The user confirmed replay was audible. Capture and replay used the same microphone track, without a second recorder.
- The first replay assertion incorrectly compared independent phone/server clocks. It was corrected to identify messages by stable IDs; the existing recording was reused for verification.

### Direct transfer and recovery

- With the application server stopped, the phones completed credential and device-key proof authentication.
- Samsung sent one text message and one generated mono AAC/M4A note directly through Nearby. Both received recipient receipts; the recipient verified the audio container and duration. This was finished-file transfer, not live voice.
- The successful sender/recipient runners completed in 37.2/51.7 seconds including preparation and coordinated outage time. A transport-only latency was not measured.
- After restoring the server and reopening the apps, each message appeared **once**, preserving the Samsung sender. Both were labelled delayed; the audio had a server attachment.
- The first coordinated trial expired on one phone while waiting for permission preparation on the other. Both permissions were granted before the successful retry.

### Private calls

- One five-second voice call and one five-second video call completed between the phones with explicit user approval. Calls were not recorded.
- Both phones subscribed to remote microphone audio; the video trial also subscribed to remote video. Both runners verified exclusive microphone ownership and connected channel listening after the call ended.
- The user confirmed **voice and video worked**.

## Browser visual/function checks

The console connected to a real receive room and displayed actual audio readiness. Desktop and 390-pixel phone layouts were inspected in the browser. Assets are bundled locally; no remote font or design CDN is required at runtime. Screenshots show the template's square panels, monochrome status strips, circular TALK control and mobile navigation.

## Remaining venue/deployment acceptance gates

These are not claimed as completed by the build or the two-phone trial:

- A third physical phone and a complete spoken group/private PTT demonstration with an uninvolved third listener.
- Repeated end-to-end photo/video sharing and playback through the phone pickers, and longer voice-note trials. Upload permissions, signatures and limits are covered by the API tests.
- Organisation DNS/custom certificate deployment and release-build trust configuration. The literal-IP debug Wi-Fi profile passed; it is tied to the tested host address and demo CA.
- Removing the internet uplink and disabling cellular fallback while repeating local PTT/chat/calls. No cloud chat/media service is used, but this network condition was not physically rehearsed.
- Real competing network traffic, congestion, long-duration screen-off sessions, manufacturer power settings, headset switching and overlapping channel/broadcast reception.
- Larger listener counts, storage retention/backups, and release signing/distribution.

Cached media tokens have a short lifetime; strict immediate invalidation requires additional admission controls. Offline credentials expire after eight hours and cannot learn new revocations without server contact. A connected room or recipient receipt is not proof that a person understood a message.

## Repeatable test entry points

- `npm test`, `npm run build`, and Android `assembleDebug assembleDebugAndroidTest lintDebug`.
- `server/test/live-media.ts`: isolated three-client generated-audio media check.
- `server/test/device-tone.ts`: generated eight-second phone tone after readiness.
- `server/test/device-call.ts`: explicitly approved five-second call; set `KETTOO_TEST_VIDEO=true` for video.
- `DeviceAcceptanceTest.kt`: enrol, network, receive, transmit, replay, nearby and call phases. Run transmit/call phases only with explicit microphone/camera-test authorization. `receive` with `decode=false` complements a human audible check and does not assert decoded frames.

Device helpers use a local test context supplied via `KETTOO_DEVICE_CONTEXT`; session tokens and server private keys are excluded from the source package. See `README.md` for setup and product limits.
