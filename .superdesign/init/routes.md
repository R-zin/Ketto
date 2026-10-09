# Android destinations
Navigation is local Compose state in KettooUI, not URL routing. page defaults to comms. There is no Navigation Compose graph. All destinations share MainActivity/KettooUI.

| State / destination | Source | Render |
| --- | --- | --- |
| Signed out | MainActivity.kt:120, SignIn | Server address, email, password, request-access form |
| comms (default) | MainActivity.kt:136, Conversation | Operations shortcuts, conversation selector, live PTT, log, personal archive, composer, private-call actions |
| threads | ThreadScreens.kt:39, ThreadsScreen | Issue filters/list; report and detail dialogs |
| people | MainActivity.kt:87, inline branch | Approved directory; open private conversation then navigate to comms |
| settings | MainActivity.kt:89, inline branch | Duty, audio routing/volume, hardware PTT, Pocket Mode, speech readiness, conserve data, Nearby, retry, sign out |
| Pocket Mode | MainActivity.kt:70, early return | Dim/black view, hardware target, PTT state, exit |
| Call overlay | MainActivity.kt:118 | Incoming/outgoing ringing or accepted private voice/video call |
| Location dialog | ThreadScreens.kt:31, PhaseLocation | Floor and zone check-in; does not change communication team |
| Issue report dialog | ThreadScreens.kt:56, CreateThread | Title, description, priority, audience, zone, photo, dictation |
| Issue detail dialog | ThreadScreens.kt:60, ThreadDetail | Claim, resolve, reopen/reassign, replies, photo |

Full routing implementation is in layouts.md (MainActivity.kt). Source is densely formatted; line ranges identify exact branches, not separate files. Current review target is comms only.
