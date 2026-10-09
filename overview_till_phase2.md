# Kettoo — overview through Phase 2

Historical Phase 2 record. The complete source now lives in [SteveSonyJacob/ketto_pvt](https://github.com/SteveSonyJacob/ketto_pvt); see [overview_phase3.md](overview_phase3.md) for the current implementation and demo guide. The local-only status and original checkout references below describe the state before publication to the new private repository.

Updated: **9 October 2026**. This is the current implementation reference for planning the next phase. It describes working code, product decisions, verification evidence and unfinished acceptance checks separately.

## Current state

- Version **0.2.0**: native Android app, browser staff/admin console and organisation-hosted backend.
- Active source: `work/ketto-github` in this workspace. Changes are local and uncommitted; nothing from Phase 2 has been committed or pushed. The starting Git commit was `97dc83a`.
- The updated debug APK is installed on both test phones and available at `outputs/phase2/Kettoo-0.2.0-debug.apk`. Their original sign-ins were restored after temporary fixture accounts were used. Existing messages were preserved.
- The Phase 2 browser preview uses **http://127.0.0.1:8792** and separate disposable data. Its example floor plan and issue records are labelled preview data. It is not the original phone organisation.
- `outputs/kettoo`, the root-level 0.1 APK/source archive and the older source-package staging directory are historical Phase 1 copies. Continue implementation in `work/ketto-github`.
- Further device/audio/load checks are deferred at the user's request until after the next phase. **There is no known urgent code blocker for continuing local development.**

## Product decisions to retain

1. Keep the existing KETTO monochrome appearance, square panels and circular TALK control. Improve layout and use a small set of labelled status/priority colours.
2. Each volunteer has one operational team. Physical zone/check-in and communication membership are independent.
3. Private **live PTT** is restricted to teammates or the designated duty admin. Existing approved-member private text and voice/video call access remains available.
4. One duty-admin device handles one reserved private volunteer/report/reply exchange at a time. End that exchange before the participating admin starts a broadcast or competing audio session.
5. Accepted private calls retain exclusive audio. Broadcasts interrupt ordinary PTT only where their audiences overlap.
6. Current assignment controls access to team-restricted issues. Reassignment removes previous restricted access and revalidates queued operations.
7. Ownership and final status require server confirmation. Priority affects ordering/badges; it does not automatically interrupt audio.

## Architecture

| Part | Implementation and responsibilities |
| --- | --- |
| Android | Kotlin/Compose, Room messages/cache/queues, encrypted session vault, foreground duty service, LiveKit receive/PTT/calls, shared microphone and output routing, direct Nearby transport. |
| Browser | React/TypeScript, staff/admin pages, LiveKit coordinator, IndexedDB messages/operations/cache, authenticated attachments and reconnect recovery. |
| Backend | Fastify/TypeScript, authentication and account/device approval, WebSocket events/presence, permissions, speaking leases, call lifecycle, operational state and upload validation. |
| Persistence | SQLite with additive server schema changes; app-private/organisation-hosted files; Android Room version 2 with a non-destructive version 1 migration. |
| Media | Self-hosted LiveKit. The backend derives room grants/audiences; clients coordinate capture, listening, broadcast priority and exclusive calls. |
| Deployment | Local Node application service, LiveKit and HTTPS proxy. Runtime communication does not require a cloud chat, media or AI provider. |

Authentication, signalling and shared state pass through the organisation API. Live audio/video use LiveKit. Nearby supports a separate signed direct-peer path for permitted text and finished audio notes; it does not distribute Phase 2 map or ownership state.

## Phase 1 foundation implemented

| Area | Available behaviour |
| --- | --- |
| Organisation access | Staff enrolment; separate account/device approval; administrator controls; persistent organisation signing identity. |
| Conversations | Explicit channels, private pair conversations and admin-only All Staff publishing; server checks history, messages, attachments and media access. |
| Live PTT | One speaker per channel, server-serialized speaking leases, renewable six-second lease and thirty-second ceiling, explicit ready/transmitting/busy states. |
| PTT replay | Recording from the same microphone track, upload after the burst, playback and visible failure/unavailable state. |
| Chat and receipts | Durable stable message IDs, retries without duplicate messages, server-received/recipient-received/acknowledged states. |
| Media sharing | Private authenticated photos, videos and audio notes; signature/size checks; uploads pause for live communication; Conserve data disables video. Limits: images 5 MB, videos 10 MB, audio 1 MB. |
| Calls | Private voice/video call lifecycle, ringing/accept/reject/end, busy checks, exclusive microphone ownership, listening restored after calls; camera pauses outside the foreground. |
| Duty and routing | Receive-room preparation, foreground notification, speaker/headset choice and screen-off receive path. |
| Offline fallback | Room/IndexedDB outboxes; signed eight-hour offline credentials; direct one-peer Nearby text/audio-note transfer with authentication, hash checking, deduplication and later server synchronisation. |
| Administration | Accounts, devices, legacy teams/channel membership, connected/on-duty/media-ready/busy state and last-seen information. |

Phase 1's earlier physical-phone record is retained in [VERIFICATION.md](VERIFICATION.md). Those results remain historical evidence, rather than claims that every older feature was retested after Phase 2.

## Phase 2 implemented

### Operational teams and permissions

- One authoritative assignment per approved volunteer and a communication channel per operational team.
- Admin creation/assignment controls in Operations; existing legacy team names can be reused when adding an operational channel.
- Older team/channel memberships do not imply operational assignment or parent-to-child access. Creating the first operational team applies the tighter live-media model while preserving old chat/history.
- Distinct `pttAllowed`, `mediaAllowed`, room epoch and priority capabilities keep private text/calls independent of live PTT.
- Assignment/handover changes retire affected rooms and rotate their identities. Current clients join the new rooms; prior cached grants cannot join the new identity.

### Duty-admin communication and broadcasts

- Team PTT and a separate Talk to admin control.
- One designated approved admin device; private reservation, busy/unavailable handling, private reply and explicit end.
- Private exchanges renew while active and end on timeout, duty loss or handover.
- Admin broadcasts to one team, selected teams or everyone, using one dedicated room and a frozen, deduplicated audience for each session.
- Broadcast preparation, receive readiness and explicit end; permitted history/replay survives the end of live media.
- Selected recipients alone can obtain media/history access. Targeted broadcast membership is removed on volunteer reassignment; future broadcasts use the new assignment.
- Overlapping team PTT is interrupted; unrelated teams continue. Accepted calls remain exclusive, with their recipients reported busy.
- Periodic/event-driven recovery reconciles active speakers and room epochs after missed events/reconnection.

### Venue and check-ins

- Multiple floors with authenticated PNG/JPEG/WebP plan images, up to 5 MB each.
- Named zone markers use normalised image coordinates; admins place/rename them, and coordinates can be edited through the API.
- Floor switching and volunteer My location floor/zone selection, with last reported time.
- Check-ins never change the assigned team. Delayed retries cannot replace a newer confirmed location.
- Map staffing counts deduplicate volunteers and require a connected on-duty device.
- Off-duty/disconnected last-reported locations and unknown locations have explicit labels.
- Authorised unresolved counts and numbered issue markers; a numbered marker opens its issue. Zone details show volunteers, relevant threads and team-contact actions.

### Issue threads

- Required title, description, Normal/High/Urgent priority and My team/Everyone audience; optional zone and photo. Admins can choose a specific team audience.
- Team-scoped thread/reply/photo/map-count permissions on the server.
- Priority followed by recent activity ordering, with Open, My team and Assigned to me filters. Open includes In progress.
- One level of chronological replies with stable IDs.
- Atomic “I'll handle this” claim: exactly one confirmed owner, changing Open to In progress.
- Owner, reporter or admin can resolve. Admin can reassign or reopen; reopening clears ownership and returns to Open.
- Resolved threads/replies remain available. Version checks reject stale competing lifecycle changes.
- Resolution removes the thread from unresolved map markers/counts.

### Screens, caching and recovery

- Browser pages: Operations, Threads, Communications, People, Organisation and Settings; persistent communication controls while viewing maps or threads.
- Android: Threads navigation, issue creation/detail/replies/actions, location selector, team/admin controls and incoming communication state across screens.
- KETTO appearance retained, with labelled urgency, synchronisation, availability and status colours.
- Separate durable ordered queues for check-ins, new threads and replies, including issue-photo upload dependencies.
- Pending/rejected states remain visible. Claims/reassignment/reopen/resolve require the server and never become pretend offline ownership.
- Loaded map images and thread detail are cached and labelled with last synchronisation state. Unloaded detail/photos may require reconnecting.
- Permission refresh removes hidden thread records and obsolete/restricted cached images. A complete outage cannot teach a cache about new revocations.
- Uploads pause during live communication and retry afterward. Phase 2 shared state is not added to Nearby.

## Migration and setup for a real organisation

1. Back up its data directory, SQLite, attachments and signing keys. Run the updated server/browser together and update Android in place with the same signing identity.
2. Approve accounts/devices, create operational teams and explicitly assign volunteers. Legacy memberships are preserved without guessing assignments.
3. Add floors/images and zones. Replacing a floor image keeps markers; review their placement against the new image.
4. Start duty in an approved browser, then designate that browser as duty admin. Volunteers select their location separately.
5. Use Team PTT or reserve Talk to admin. For a broadcast, choose the audience, prepare it and wait for audio connection before transmitting.
6. Use Threads for reporting, claiming, replies and resolution; use zone details to connect issues with staff and team communication.

The isolated preview does not migrate/configure the original organisation automatically. Its API is at port 8792; phone checks used trusted localhost HTTPS on port 18443 through USB forwarding, with trusted LAN media WSS on port 8444. The original phone profile uses port 8443. Use the README deployment instructions to run the latest source against the intended organisation data.

The temporary demo leaf certificates used on 9 October expire **10 October 2026**. Refresh the demo HTTPS service/certificates before the next phone tests, preserving the trusted CA. This is a test-profile maintenance item; release/custom organisation trust and distribution are still deployment work.

## Verification completed through Phase 2

| Check | Evidence/result |
| --- | --- |
| Backend suite | **22/22 passed**: original regressions plus operational permissions, private-vs-call access, image authentication/persistence, legacy-team conversion, additive migration, atomic claims/lifecycle, retry/stale check-ins, broadcasts and audio-conflict/busy policies. |
| Server/browser build | TypeScript and production builds passed. |
| Android build | Debug app/instrumentation builds and lint passed; remaining lint/SDK metadata warnings are non-blocking. |
| Android upgrade | Both phones upgraded in place to Room schema 2. All **43/43 CPH2613** and **59/59 Samsung** original message IDs remain. Original sign-ins restored; no uninstall or data clear. |
| Native issue workflow | Both phones passed check-in/team independence, photo issue, claim, reply deduplication, resolution, Threads navigation and stale-image cache cleanup. |
| Duty startup | A start/stop race surfaced during private-test preparation. The fix is installed; immediate duty startup cancellation and the functional workflow passed on both phones afterward. |
| Actual outage | CPH2613 queued three operations while the isolated HTTPS endpoint was stopped: check-in, issue creation and reply. After reconnect each appeared once, with no rejected operation or false confirmed ownership. |
| Five native SDK clients | Real LiveKit generated-audio one-team/selected/everyone audience isolation, private volunteer report and admin reply passed; excluded clients received zero non-silent frames. |
| Two physical receivers, screens off | Stage-only: CPH2613 **408** non-silent frames, excluded Security Samsung **0**. Selected Stage/Security: **394 / 415**. Everyone: **402 / 408**. Private admin reply: CPH2613 **406**, excluded Samsung **0**, with media-grant denial. |
| Audible receive | The user confirmed the repeated CPH2613 screen-off receive sound. Frame counts establish decoding, not human hearing on every later trial. |
| Actual native team PTT | One explicitly approved three-second CPH2613 microphone burst reached the admin SDK receiver: **265** non-silent frames. Replay: **87,724 bytes**, **36,832** non-silent samples; native playback check passed. Security decoded **0**. |
| Browser checks | Real receive-room readiness, prepared broadcast/end, floor switching, direct issue-marker opening, issue management and desktop/390-pixel layouts checked; no horizontal page overflow in the mobile check. |

The physical receivers were CPH2613 / Android 14 and Samsung SM-A356E / Android 16, on the tested LAN. The example floor plan is synthetic; map counts came from actual fixture device presence and were not inflated to simulate venue scale.

Result files/screenshots/APK are in `outputs/phase2`. Private databases, session backups, keys and fixture helper context remain in ignored local data; they are not delivery artifacts.

## Remaining checks — deferred until after the next phase

1. **Actual private microphone report and replay retry.** The first preparation crashed before capture. The startup fix passed on both phones, but this private capture was not retried before testing was deferred. Private report/reply media has SDK coverage and the private reply has two-phone receive/exclusion coverage.
2. **Physical overlapping-audio combinations:** broadcast during team PTT, unrelated team continuing, an active admin exchange, and an accepted private call retaining exclusive audio. Server policies are tested; the full physical interaction matrix remains open.
3. **Third physical participant:** spoken team/private scenarios with an uninvolved listener and multiple competing Talk to admin requests.
4. **Longer/repeated device recovery:** membership/admin handover during media, output/headset switching, power-management behaviour, sustained screen-off duty, photo-picker/video/voice-note playback, permission-change caches and real restarts/outages.
5. **Venue conditions:** internet uplink removed and cellular fallback disabled, realistic network contention/congestion, expected staff/team counts, longer sessions and storage/load/retention checks.
6. **Deployment readiness:** intended DNS/HTTPS trust, managed certificate renewal, server backups/retention, release signing/distribution and organisation configuration.

A connected room, decoded samples or a receipt never proves a person understood a report. Previously issued self-hosted media tokens and offline credentials have bounded lifetimes; rotation isolates current conversation media, while strict global admission/token invalidation remains a deployment concern. This build is a local debug implementation, not a venue-scale acceptance result.

## Next-phase implementation guidance

- Extend the active repository; do not continue from an older APK/source archive or the historical runnable copy.
- Reuse authentication and explicit current-assignment checks for every new read/write/file/media surface. UI filtering alone is insufficient.
- Preserve organisation identity, private text/call access, separate team/location concepts and the reserved admin exchange.
- Add non-destructive migrations to SQLite/Room and test upgrade paths with existing records/outboxes.
- Use stable IDs for retryable operations, retain dependency ordering, and require server confirmation for exclusive ownership/state transitions.
- Reconcile snapshots, events, room epochs, caches and queued actions when permissions change. Keep microphone/audio ownership in the existing coordinators.
- Preserve the distinction between connected, on duty, media ready, busy, disconnected, cached, pending and confirmed.
- Keep expensive uploads away from live communications. Plan retention and pagination/load work if the next phase increases map/thread volume.
- Describe the next phase's scope first; implementation of automatic dispatch, positioning, escalation or AI is not implied by the current issue workflow.

## Features not implemented

Transcription/AI, automatic issue or role allocation/dispatch, escalation, QR/GPS/automatic indoor positioning, measured/drawn map geometry, automatic live forwarding, nested replies, priority-triggered audio interruption, distributed Nearby maps/ownership/broadcasts, multi-hop mesh, live Nearby voice, group video, lock-open microphone and emergency/DND interruption remain outside Phases 1–2.

## Code and document entry points

| Work | Start here |
| --- | --- |
| Backend Phase 2 domain/API | `server/src/phase2.ts`, `server/src/app.ts`, `server/src/db.ts` |
| Browser UI/state/media | `web/src/Operations.tsx`, `operations.css`, `App.tsx`, `api.ts`, `media.ts` |
| Android Phase 2/state/UI | `Phase2.kt`, `ThreadScreens.kt`, `Storage.kt`, `KettooApplication.kt`, `MainActivity.kt` |
| Android duty/audio lifecycle | `DutyService.kt`, `MediaCoordinator.kt`, `AudioRouting.kt` |
| API and real-media checks | `server/test/api.test.ts`, `phase2.test.ts`, `phase2-media.ts`; `npm test`, `npm run build`, `npm run test:phase2-media -w server` |
| Native acceptance | `DeviceAcceptanceTest.kt`, `Phase2DeviceTest.kt`, `Phase2MediaDeviceTest.kt`. Microphone/camera phases require explicit test consent. |
| Setup/build | [README.md](README.md) |
| Original requirements | Workspace `references/KETTOO_SYSTEM_PLAN.md` and `KETTOO_PHASE2_PLAN.md` |
| Historical Phase 1 results | [VERIFICATION.md](VERIFICATION.md) |

The obsolete feasibility review and duplicate Phase 2/demo guides were removed after their useful material was consolidated here. Original requirement plans, current setup instructions and historical verification evidence are retained.
