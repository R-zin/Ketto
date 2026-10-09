# Ketto Android: Comms screen review

Reviewed the current working tree on 10 October 2026. The discussion and preview history below records the agreed Comms refactor. The approved layout has now been implemented and installed on CPH2613; verification notes are at the end.

## Current frontend

Native Kotlin / Jetpack Compose with Material 3. Most UI is embedded in `android/app/src/main/java/org/kettoo/app/MainActivity.kt`. Operational UI is in `ThreadScreens.kt`; shared dictation UI is in `OfflineSpeech.kt`.

Default destination: Comms. Other destinations are Threads, People and Settings. Sign-in, calls, location selection, Pocket Mode and thread dialogs have separate states. Their detailed reviews will follow after Comms.

### What Comms currently renders

1. Shared KETTO header, global error banner, location check-in and incoming-speaker banner.
2. Team assignment and team/admin exchange shortcuts.
3. Horizontally scrolling conversation buttons.
4. A second panel showing the selected conversation's name/type.
5. Separate server and audio connection labels.
6. Live Voice / Message Log mode buttons.
7. On Live Voice: session panel, decorative bars, instructions, a 255dp TALK control, and a start-duty action when off duty.
8. Private voice/video call actions, when applicable.
9. Log / Archived controls; message cards, replay, automatic transcripts and acknowledgement/archive actions.
10. Text input, offline dictation, attachments, voice notes and Send.

All Comms content is in one LazyColumn. Bottom navigation remains outside that list.

## Findings and concrete proposed changes

| Finding | Proposed change | Purpose |
| --- | --- | --- |
| Multiple selection/context layers compete above TALK. | Use one clearly labelled conversation selector with its name and type. Retain team shortcut, duty-admin availability and private-exchange controls in a compact action area. | Make the recipient and available actions obvious. |
| TALK is inside the scrollable log. | Give the Talk tab a dedicated layout where recipient, actual speaking state and hold control stay visible. Put recent activity below; full history remains in Messages. | Make the primary field action immediately reachable. |
| The voice-level bars are generated from fixed numbers, not audio. | Replace them with honest state text: Ready, Requesting, Transmitting, or the actual blocking reason. | Avoid suggesting microphone activity that the UI has not measured. |
| Every blocked TALK control says Audio not ready; READY ignores several eligibility conditions. | Explain the actual reason and an appropriate existing action: Start duty, audio connecting/unavailable, receive-only broadcast, live PTT unavailable for this recipient, or finish a call/voice note first. | Make recovery understandable without changing PTT eligibility. |
| Server/audio state can overwhelm the normal communication task. | Show a compact connection summary while preserving meaningful distinctions: server/audio readiness, Nearby audio and direct peer count, or unavailable. Keep failure/recovery guidance visible when needed. | Clarify what currently works during an outage. |
| Log/archive controls appear under both modes and the composer is after the message list. | Use Talk / Messages as primary modes. Messages contains Inbox / My archive and a composer that remains accessible above the keyboard. Talk keeps a small recent-activity preview and a clear route to all messages. | Separate live communication from reviewing/responding to history. |
| Much of the UI uses 10–12sp uppercase labels; custom TALK uses pointer gestures without explicit control semantics. | Use readable sentence-case labels, a consistent type/spacing scale, clear selected states, accessible names and state announcements. Verify large fonts and TalkBack on a phone while preserving hold/release behavior. | Improve comprehension and accessibility. |

## Initial structure proposal (superseded by the discussion below)

```text
KETTO                                      Settings
Location / duty context

[ Selected conversation                 v ]
Team or private · connection summary
Team shortcut / Talk to admin or current exchange actions

[ Talk ]                         [ Messages ]

Talk                              Messages
Actual speaking/blocking state    [ Inbox ] [ My archive ]
Large Hold to talk control        Scrollable message history
Short speak/release instruction   Replay / transcript / delivery / acknowledgement
Private call actions if eligible Fixed composer and attachment/voice-note/dictation actions
Recent activity → all messages

Comms             Threads             People             Settings
```

This initial structure retained four navigation destinations. The subsequent user-approved navigation has three bottom destinations and Settings in the header. Selecting a conversation remains explicit. Nearby failover remains automatic once enabled; the proposal adds visibility, not a manual transport selector.

## Implementation boundaries

- Extract Comms composables and shared visual tokens from the dense activity file; retain lifecycle handling and existing callbacks.
- Preserve live PTT press/release, speaking leases and the existing 30-second ceiling. No tap-to-latch microphone behavior.
- Preserve private calls, video/data restrictions, audio routing, receive priority and incoming-speaker indicators.
- Preserve complete message history, recordings, transcripts and retries, attachment limits, offline dictation, acknowledgement and personal archive semantics.
- Preserve duty/admin exchange controls, team selection, location check-ins and automatic Nearby authentication/failover/recovery.
- Use existing state/coordinator APIs; backend, protocol, storage and transport changes are outside this first UI pass.
- Existing local edits in communication files must be preserved.

## Review sequence

1. Capture one existing screen on a connected phone and review the screenshot with the user.
2. After that discussion, create an edited image of the same screen and show it to the user.
3. Review the image together before implementing the agreed screen in Compose and building/linting Android.
4. Verify recipient selection, state/blocking messages, all message actions, call entry points, keyboard layout and font scaling.
5. Update the connected phones in place and review the layout together. Exercise live audio/failover with the user during the device review.
6. Refine the screen, then repeat this sequence for the next screen.

Device recheck: CPH2613 (ADB serial fc76dcff) is connected and authorized. Ketto 0.3.0 is installed. Opened the existing app without interacting with communication controls and captured Comms / stage / Live Voice at `artifacts/ui-review/2026-10-10/cph2613-ketto-screen-01.png` (1080 × 2412).

The capture shows a Channel is busy error banner, unknown location, stage team panel, horizontally scrolling conversation buttons, repeated stage heading, Server connected / Audio offline, and Live Voice / Message Log tabs. TALK is below the initial viewport. These are observed display states; no live-audio or server diagnosis has been attempted.

The local Android project has a configured SDK, JDK 17, offline speech model and an existing debug APK. A fresh build has not been attempted during this discussion phase. No app UI changes or installations have been made.

## Navigation preview, version 1

User-requested direction: bottom navigation is Threads (left), Comms (center), People (right). Comms remains the default selected destination. Remove Settings from the bottom bar and replace the top-right profile icon with the existing outlined Settings gear, retaining its Settings destination.

Created a screenshot edit using the built-in image_gen tool, keeping the rest of the captured screen as faithful as possible. Preview: `artifacts/ui-review/2026-10-10/cph2613-navigation-preview-v1.png`.

Image reviewed for the requested three-item order, center selection indicator and top-right gear. The image is a design preview, not an app screenshot or a claim of exact pixel preservation. The user approved this navigation preview, then continued discussing the rest of Comms. Include the approved navigation in the next full-screen preview before app implementation.

Prompt specification: edit the captured Android screenshot; replace the four bottom items with exactly three evenly spaced items, THREADS / COMMS / PEOPLE; reuse the existing outlined thread/radio/people icons; select COMMS using the existing gray indicator; remove bottom SETTINGS; replace the top-right person icon with the existing outlined gear in the same position and size; preserve all other screen content, original labels, monochrome styling and portrait proportions; add no phone frame, annotations or extra controls.

## Comms direction from the next discussion

User requests:

- Move recipient/channel selection out of Comms and use People for selection.
- Remove repeated selected-channel panels; display the active recipient once.
- Keep Live Voice / Message Log modes.
- Remove the Voice Session box and decorative level bars.
- Keep concise guidance: speak after TRANSMITTING, maximum 30 seconds.
- Put TALK in the center of the page, with a minimal monochrome circular wave/pulse while actually transmitting.
- Put voice/video calls, text messages, voice notes and other messaging actions in Message Log.

Source check: the current People branch lists approved individuals and opens a private conversation via privateChat. It does not currently list/select team or All Staff channels. Moving all recipient selection to People therefore requires a Channels section there, using existing conversation data and select callbacks. The dedicated duty-admin exchange action is distinct from opening an ordinary private conversation with an admin; preserve its reservation/end controls when relocating them.

Additional recommendations for discussion: one active-recipient label with a small Change link to People; compact real readiness/blocking status; visible incoming speaker/channel; off-duty recovery action; restrained pulse only after TRANSMITTING and respect reduced-motion preferences; compact location access; fixed Message Log composer with replay, transcripts and My archive retained. Preserve private-only call eligibility and All Staff publish restrictions.

The user agreed to the additional recommendations and Channels in People. Preserve the dedicated duty-admin exchange entry/end actions while relocating selection.

## Full Comms preview, version 2

The user supplied a new staggered black Kettoo wordmark and requested it for both the app header and launcher icon. Remove the old antenna symbol, generic KETTO wordmark and SECURE badge. The exact original upload is saved at `assets/brand/kettoo-logo-original.png`; use that artwork when implementing the header/icon rather than recreating it from the generated preview.

Generated `artifacts/ui-review/2026-10-10/cph2613-comms-preview-v2.png` using the built-in image_gen tool, with the captured app screen and supplied logo as references. It shows the proposed compact header, top-right Settings, short location row, single stage recipient with Change, connection status, Live Voice / Message Log tabs, centered TALK and subtle concentric rings, concise 30-second guidance, and Threads / Comms / People navigation.

The preview illustrates the transmitting state; no real microphone transmission was initiated. The rings represent one frame of the proposed animation. Generate/implement states from existing PTT readiness and transmission state, respecting reduced motion. Calls/composer/log/archive actions belong to Message Log and are not shown in this Live Voice preview.

Generation prompt is saved in `artifacts/ui-review/2026-10-10/comms-preview-v2-prompt.md`. The user approved the full-screen image and requested the final wording: **Speak after TRANSMITTING appears · Max 30 seconds**.

## Implemented screen and verification

- `CommsScreens.kt` contains the extracted Comms and People screens, meaningful PTT availability labels, restrained transmitting-only rings and Message Log composer.
- Header uses the original supplied artwork through `UiBrand.kt`; antenna and SECURE badge are removed. The original artwork is also the adaptive launcher icon, visually verified in Android App Info.
- Bottom navigation is Threads / Comms / People, with Settings in the header. Comms remains the initial destination.
- People includes existing channels and approved individuals. Existing private conversations can be opened from cached conversation data; new private conversations use the existing server action. Team/duty-admin exchange shortcuts and end-exchange controls remain available there.
- Live Voice has one recipient label and Change action, connection summary, tabs, centered hold/release control, honest speaking/blocking state and the final instruction. Calls, composer, attachments, notes, dictation, replay, transcripts and My archive are in Message Log.
- Drafts are kept per conversation and retained while changing tabs/destinations. External attachment selection retains the intended conversation. Attachment formats, limits, delivery queues and data-conservation restrictions are preserved.
- The voice circle still uses the original press/release media callbacks; no tap-to-latch behavior. Animation runs only when that conversation is actually transmitting and honors the system animator setting. The custom control exposes recipient/state semantics and a safe accessibility instruction action. Full TalkBack interaction and large-font acceptance are still subject to user/device review.
- The first keyboard screenshot exposed Android window panning that covered the composer actions. Enabled edge-to-edge inset handling with adjustResize and verified that Send, Attach and Voice Note remain above the keyboard. Archive filter selection uses monochrome styling. Explicit light system-bar styling keeps status/navigation icons legible even when the phone uses dark mode.

Validation: Android debug APK/test APK compile and lint passed. Seven physical-device tests passed: staff/admin broadcast eligibility, off-duty readiness, Nearby during server/media outages, Nearby permission boundaries, calls/notes blocking PTT, destination/channel/log/archive/settings navigation, and composer visibility above the keyboard. The checks initiate no transmission, recording, call, message, acknowledgement or location change. Lint retains existing/general project warnings; no lint errors.

Installed in place on CPH2613 (`fc76dcff`) using `adb install -r`, preserving app data. Only this phone is currently connected. APK remains version 0.3.0 (same debug signing/application identity); no backend, protocol, storage-schema, PTT coordinator or Nearby transport changes were made by this UI work. Pre-existing local changes in those files were preserved.

Actual screenshots are under `artifacts/ui-review/2026-10-10/`. `cph2613-launcher-icon-installed.png` verifies the logo as the installed app icon. `cph2613-comms-installed-final.png` shows the final stage Live Voice screen, left open on CPH2613 for review. `cph2613-message-log-keyboard-final.png` shows composer actions visible above the keyboard. `cph2613-comms-installed-v1.png` records the initial UI implementation before the keyboard/status-bar correction. `cph2613-message-log-keyboard-v1.png` records the keyboard problem that was fixed; it is not the final layout.

Final debug APK: `android/app/build/outputs/apk/debug/app-debug.apk`, SHA-256 `30EEFCF4E6AF3C6B5BF87E1FC41F349724EC79ED6DFE111821A76E5F607FC85B`. Final build/lint passed and the final APK was successfully installed in place. The seven-test run includes the keyboard-resize fix; the subsequent change only specifies light-theme status/navigation icon contrast, visually verified in the final screenshots. The phone is currently off duty; screenshot labels accurately reflect that state.

Next: review the final Comms screen on the phone together. Real transmitting-animation, live audio, calls, replay/transcript correctness and automatic two-phone failover remain functional acceptance checks; the tests above verify presentation/eligibility and navigation, not end-to-end media.
