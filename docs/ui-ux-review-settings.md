# Ketto Android: Settings review

Review date: 10 October 2026. This is the second screen review after the installed Comms refactor. The user approved the grouped preview, and the Settings refactor and location feedback are now implemented and installed on CPH2613.

## Location question

Observed on CPH2613: My location says unknown; the location dialog shows Floor 1 selected, but no selectable zone below it.

Source behavior in ThreadScreens.kt: tapping a floor changes a local filtering value only. Only tapping a zone calls operations.checkin(zoneId). Phase2.kt queues a zone-specific check-in, and the server requires zoneId and stores a zone-linked check-in. A floor choice alone does not submit one.

Thus the currently available Floor 1 selection cannot confirm a location until a zone is available and selected. The UI currently provides no empty-state explanation. Proposed fix: explicit Floor / Zone steps, a message when a selected floor has no zones, and distinct queued / confirmed / rejected feedback for zone selection. Keep the existing zone-based operational data model and endpoints. Do not silently report a floor-only choice as a confirmed check-in or create arbitrary zones.

Location screenshot: artifacts/ui-review/2026-10-10/cph2613-location-floor1-current.png.

## Current Settings

Settings is an inline branch of KettooUI in MainActivity.kt, presented as a vertically scrolling column with 20dp spacing between individual elements.

- Shared header logo, Settings gear, location check-in and global incoming/error indicators.
- Operator/session label, name, server connection, audio-room count and Start/End duty.
- Active audio output, available-route buttons and call-stream listening volume.
- Volume Down PTT checkbox, instruction, hardware target, optional background accessibility service action and sideload/screen-off tips.
- Pocket Mode action, offline English transcription readiness and Conserve data checkbox.
- Nearby status, enable switch, connected peers and detailed requirements/limitations.
- Retry server queue and Sign out.

Captured screenshots: artifacts/ui-review/2026-10-10/cph2613-settings-current-top.png, cph2613-settings-current-middle.png and cph2613-settings-current-bottom.png.

## Proposed organization for discussion

1. Settings title; compact name and duty status/action. Consolidate server and audio readiness into a concise summary while retaining access to detailed room information.
2. Audio section: selected output with a clear selector and listening volume directly together. Explain inactive audio when off duty.
3. Push to talk section: Volume Down switch, actual target, Pocket Mode. Keep background-key setup as an advanced row with enabled/disabled status; move long manufacturer/setup explanations into expandable help.
4. Connection section: Nearby switch, honest automatic failover status and connected peers. Default explanation: automatically connects to approved nearby teammates during outages. Keep permission, range, offline-credential and private-call limitations discoverable in details. Preserve automatic failover and existing permission requests.
5. App section: conserve-data option and transcription readiness. Label conserve-data behavior clearly as disabling video rather than claiming bandwidth reduction elsewhere.
6. Sign out as a visually separate final action. Put queue retry with connection/queued-work information so it is a recovery action, not a large everyday button.

Use the approved monochrome palette, square panels and readable sentence-case typography. Use consistent switch rows and spacing within sections. Keep useful statuses visible; secondary explanations can expand. Do not remove functionality, change backend/protocols, add unsupported settings or activate microphone/camera/services during design review.

## Next step

The user chose one grouped page with concise explanations and requested its image preview. Generated `artifacts/ui-review/2026-10-10/cph2613-settings-preview-v1.png` with the built-in image_gen tool, using the current Settings screenshots and original logo. Prompt is saved in `artifacts/ui-review/2026-10-10/settings-preview-v1-prompt.md`.

Preview shows Account & duty, Audio, Push to talk, Connection, App and separate Sign out, with short descriptions and expandable background-key/Nearby detail entry points. This full-page image represents one vertically scrollable Settings screen; it does not require cramming all rows into a single physical viewport. Example status is off duty, audio inactive, hardware PTT enabled, Nearby off, video enabled and English transcripts ready. No actual settings were toggled and no app UI changes were installed during preview generation.

Inspected image for group order, primary controls, concise readable explanations, preserved wordmark and three-item navigation without a falsely selected bottom destination while in Settings.

The user approved the Settings image and instructed implementation. Advanced details and all existing hardware/permission/audio/Nearby behavior remain available even though the main page hides the long explanations.

## Implementation

- Extracted `SettingsScreen.kt` from the activity's inline branch. Five groups contain Account & duty, Audio, Push to talk, Connection and App. Sign out remains a separate final action.
- Duty switch uses the existing permission/service flow. Nearby uses the existing Bluetooth/microphone/Wi-Fi permission and enable flow, including automatic duty start and failover. Hardware PTT still cancels active hardware input and persists its preference through the vault. Video-conservation behavior is unchanged.
- Audio output choices, background-key setup, Nearby requirements and transcript explanation expand inline. Listening volume still controls STREAM_VOICE_CALL. Monochrome switch/slider colors and readable section/row labels match the reviewed direction.
- Pocket Mode remains an action enabled only when on duty with hardware PTT. Existing system-accessibility setup, manufacturer/restricted-settings guidance, direct-range limits, automatic retry, eight-hour offline credential expiry and server-only private calls/acknowledgements remain discoverable.
- `LocationUi.kt` explains the Floor → Zone check-in flow and shows an explicit no-zones message. Floor selection never reports a confirmed location. Queued/rejected check-ins remain distinct from confirmed or cached last-confirmed locations; the last confirmed timestamp is available in the dialog.
- Settings scroll/expanded-state restoration is scoped to the signed-in account. No backend, transport, protocol, storage-schema or media-coordinator changes were made.

Build: `assembleDebug assembleDebugAndroidTest lintDebug` passed. Lint has 23 general/existing warnings and no errors. App installed in place on CPH2613 with `adb install -r`; the original signing/application identity and version 0.3.0 are retained.

Final APK SHA-256: `8DD512D5748BCF658034F8F5C2B85F2AE16FD44655236AE9546F36BD9BCE0AE3`.

Regression checks cover existing Comms eligibility/navigation/keyboard behavior and queued/rejected/cached location presentation. A new Settings scroll automation test proved unreliable on this phone due to Compose virtual nodes and clipped targets, so it was removed rather than retained as a failing/flaky test. Settings sections, inline background/Nearby expansion, preserved explanations, Sign out reachability and the Floor 1 empty state were reviewed manually using ADB UI inspection and screenshots. No setting toggle, duty start, transmission, call, message, queue retry, logout or check-in was initiated during this manual review.

Final screenshots under `artifacts/ui-review/2026-10-10/`: `cph2613-settings-installed-final-top.png`, `cph2613-settings-installed-final-middle.png`, `cph2613-settings-installed-final-bottom.png`, and `cph2613-location-floor1-fixed.png`. The location dialog now explicitly says: No zones available on Floor 1. Ask an admin to add zones. A real check-in still requires a configured zone, as the existing backend requires.

The final accessibility adjustment merges each switch/expandable row's label and state with its control semantics. Full TalkBack, hardware key, live audio, calls and two-phone failover acceptance remain user/device checks, distinct from this layout/navigation review. Only CPH2613 is currently connected.

Final regression run on the installed build: **OK (11 tests)**. Settings is left open at the top for the user's review. Actual app controls still use the existing permission/coordinator callbacks; this UI verification does not claim end-to-end microphone/media acceptance.
