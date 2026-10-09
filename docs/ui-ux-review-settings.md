# Ketto Android: Settings review

Review date: 10 October 2026. This is the second screen review after the installed Comms refactor. No Settings refactor or location behavior change has been implemented in this review round.

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

Next: user's visual review of the Settings image, then implement and install, following the same workflow used for Comms. Include the location empty-state explanation in an agreed UI follow-up. Maintain expanded advanced details and all existing hardware/permission/audio/Nearby behavior, even though the preview hides their long explanations.
