# Kettoo — Project Summary, Implemented Features and Strengths

**Updated:** 10 October 2026 (India time)  
**Current project version:** 0.3.0  
**Scope:** Phases 1–3, subsequent Nearby and Android improvements, the latest browser dashboard, and current local venue-management changes.

This document consolidates the repository source, Git history and existing verification records. It describes what we have built, why it is useful, what evidence supports it, and what remains. Some earlier overviews contain historical setup paths and superseded product decisions; the current source takes precedence. Historical phone tests are identified separately from checks run for this summary.

## 1. What we are building

Kettoo is a private communication and coordination platform for event organisers, volunteers and operational teams. It brings together walkie-talkie style voice, messages, calls, venue maps, staff check-ins and issue tracking.

The project has three main parts:

- A native Android app for staff working around the venue.
- A browser console for communication and operational administration.
- An organisation-hosted backend with durable storage and self-hosted audio/video.

The intended workflow is straightforward: approve staff and their phones, organise channels, configure floors and zones, start duty, communicate with the relevant people, and track reported problems through ownership and resolution. When connectivity fails, supported actions queue locally and approved Android phones can communicate directly through Nearby.

## 2. What we have done so far

| Stage | Main work completed |
| --- | --- |
| Phase 1: communication foundation | Android app, browser console, private server, account/device approval, channels, private messaging, All Staff, PTT, replay, attachments, receipts, voice/video calls, duty/presence, local queues and initial direct Nearby messaging. |
| Phase 2: event operations | Operational teams, duty-admin exchanges, audience-specific broadcasts, floors and zones, check-ins, staffing visibility, issue threads, assignment and resolution, permission-aware caches and recovery. |
| Phase 3: speech and field controls | Local English transcription, editable offline dictation, personal acknowledgement/archive, Volume Down PTT, feedback, background-key service, Pocket Mode and durable speech/replay recovery. |
| Subsequent Nearby work | Automatic discovery and authentication, multiple direct peers, live Nearby TALK, recipient readiness/floor reservations, signed media transfers and recovery synchronisation. |
| Android presentation work | Original Kettoo logo and launcher icon, redesigned Comms and People, three-item navigation, grouped Settings, keyboard-safe message composer and clearer location feedback. |
| Browser/dashboard work | Updated dashboard styling and layout, dedicated Organisation management, multiple operational channel memberships, audience reuse for broadcasts and current venue example/removal controls. |

The Git history includes the complete implementation snapshot and later Android Settings and browser dashboard commits. The working directory also contains uncommitted venue-management changes. This summary includes those changes as current local implementation, without implying they have been committed or deployed.

## 3. Implemented feature inventory

### 3.1 Accounts, organisation access and administration

- Staff account enrolment and device registration.
- Separate administrator approval for the account and each device.
- Account/device revocation and server-side rejection of unauthorised access.
- Persistent organisation signing identity and organisation-owned data directory.
- Team/channel creation and membership management.
- Designation of a specific approved device as duty admin.
- Presence showing connected, on duty, media ready, busy and last seen states.
- Administrative audit records for supported management actions.
- Browser Organisation sections for People, Channels and Approvals, with member/device controls and pending approvals.

**Latest membership change:** the current backend and browser support a volunteer belonging to multiple operational channels. Adding or removing one membership preserves other memberships. An additive database migration retains previous assignments. Earlier Phase 2 documentation and the README still describe the original single operational team model; that description is superseded for the current backend/browser. Full Android acceptance of every multi-channel workflow remains a separate check.

### 3.2 Messages, conversation history and attachments

- Permitted channel conversations and private conversations with approved people.
- All Staff communication with administrator-only publishing.
- Text messages, photos, videos, voice notes, saved PTT bursts and broadcast history.
- Durable message IDs so retries and later synchronisation do not create duplicate entries.
- Separate server-received, recipient-received and acknowledged states.
- Conversation membership checks for messages, history, attachments and media access.
- Upload validation for supported content, size and file signatures.
- Image limit: 5 MB; video limit: 10 MB; audio limit: 1 MB.
- Uploads pause during live communication and retry afterward.
- Conserve Data disables video.
- Android Room and browser IndexedDB storage for messages and pending work.

### 3.3 Live push-to-talk and replay

- Hold-to-talk controls for eligible channels and private live exchanges.
- Explicit ready, requesting, transmitting, busy and blocked states.
- Server-controlled speaking leases to serialize competing speakers and stop stale publishers.
- A 30-second transmission ceiling and release/cancellation handling.
- Duty and receive-readiness checks before ordinary server-mediated transmission.
- PTT recordings taken from the same microphone capture track and saved into the message log.
- Replay after a burst, including visible unavailable/failure states when saving cannot complete.
- Shared audio coordination and speaker/headset routing.

This gives a spoken instruction a durable history entry that can later be replayed, transcribed and acknowledged.

### 3.4 Duty-admin exchanges and broadcasts

- A volunteer can reserve a private Talk to admin exchange with the designated duty-admin device.
- Report, admin reply, explicit end and busy/unavailable feedback.
- One reserved exchange at a time, with renewal and timeout/duty-loss cleanup.
- Administrator broadcasts to one team, selected teams or everyone.
- Deduplicated recipient audiences and restricted media/history access.
- Broadcast preparation and explicit ending.
- Broadcast priority over ordinary PTT where recipients overlap; unrelated team traffic can continue.
- Accepted private calls retain exclusive audio priority.
- Recent backend work reuses canonical broadcast audiences and refreshes membership after an ended session, helping avoid repeated equivalent broadcast conversations.

### 3.5 Private voice and video calls

- Ring, accept, reject, end and busy handling.
- Device-specific call eligibility and permission checks.
- Exclusive microphone/audio coordination while an accepted call is active.
- Listening recovery after calls.
- Camera permission for video and foreground camera lifecycle handling.
- Video disabled under Conserve Data.

Private calls need server access. Nearby does not implement offline private voice/video calls.

### 3.6 Offline queues, caching and reconnect recovery

- Queued messages, check-ins, issue reports and replies.
- Stable operation IDs and ordered dependencies, including issue-photo uploads.
- Pending and rejected states distinct from confirmed server results.
- Cached permitted conversation history, maps and issue details where available.
- Delayed check-ins cannot overwrite a newer confirmed location.
- Permission refresh removes obsolete restricted records/images when connectivity returns.
- Claims and issue lifecycle changes require server confirmation.
- Durable replay/transcript jobs and retry recovery.

Cached content can become stale during an outage. A disconnected device cannot immediately learn about new revocations.

### 3.7 Automatic Nearby failover on Android

- Automatic discovery and authentication of approved devices during API or permitted media outages when Nearby is enabled and permissions are granted.
- Multiple directly connected peers through Nearby Connections P2P_CLUSTER.
- Live TALK with recipient floor reservations and readiness confirmation before capture.
- Deterministic handling of competing requests and supported broadcast priority.
- Capture stops on target loss, expired permissions, missing renewal or stalled audio transfer.
- Signed text, voice notes, images, videos and completed PTT replay transfers.
- Organisation identity, enrolled device-key proof, hashes and size checks.
- Per-device receipts and stable IDs for deduplicated synchronisation after recovery.
- Eight-hour offline credentials, with current permissions rechecked by the server during sync.

This is direct peer-to-peer communication within reachable groups. It is not multi-hop mesh forwarding or guaranteed venue-wide coverage. The browser has no Nearby transport. Maps, check-ins and issue ownership use their server queues rather than peer replication. Old V1 Nearby clients must be upgraded to participate in the V2 protocol.

### 3.8 Venue maps, zones and staff locations

- Multiple floors with authenticated PNG/JPEG/WebP floor-plan images up to 5 MB.
- Named zone markers using normalised image coordinates.
- Administrator zone placement, naming and editing.
- Staff check-ins to a configured zone, separate from communication membership.
- Last-reported location timestamps and explicit unknown/disconnected states.
- Connected on-duty staffing counts that deduplicate volunteers.
- Unresolved issue counts and numbered map markers that open issue details.
- Zone details linking staff, issues and communication actions.
- Android Floor → Zone feedback explaining why choosing only a floor does not confirm a check-in.

**Current local venue additions:** three illustrative college-hackathon maps (Floor 2, Floor 4 and a ground-floor canteen), example zones/descriptions, controls to hide/restore examples, and administrator floor removal. Example maps are labelled illustrative and have no real staffing data. Removing a real floor clears its zones/check-ins and detaches affected issues from those zones while retaining issue threads and replies. These changes are currently uncommitted; floor removal needs a dedicated regression check before operational use.

### 3.9 Issue reporting and resolution

- Issue title, description, Normal/High/Urgent priority and permitted audience.
- Optional location and photo.
- Team-restricted or everyone visibility; administrator team targeting.
- Chronological replies with stable retry IDs.
- Priority/activity ordering and filters including Open, My team and Assigned to me.
- Atomic “I'll handle this” ownership, moving an open issue into progress.
- Resolution by eligible owner/reporter/admin, administrator reassignment and reopening.
- Version checks rejecting stale competing lifecycle updates.
- Resolved history retained; unresolved map counts update after resolution.
- Audience checks on threads, replies, photos and map counts.

Priority is displayed and used for ordering. It does not automatically dispatch staff or interrupt audio.

### 3.10 Local speech, dictation and personal archive

- Automatic English transcription of saved PTT and audio notes using Vosk.
- On-device Android recognition and an organisation-hosted Vosk/FFmpeg worker for uploaded recordings.
- No cloud speech API required for these features.
- Transcripts remain attached to their original audio entries alongside replay.
- Pending, processing, unavailable and failed states, with retry support.
- Editable offline dictation in Android chat, issue descriptions and replies.
- Pauses retain draft words; dictation is bounded to 60 seconds and sending remains explicit.
- Acknowledge & archive for every message type in Android and browser.
- Personal archive preserves original message IDs, recordings, transcripts and attachments.
- One person's acknowledgement does not archive another person's copy.
- Acknowledgement requires server confirmation and is independent of recognition success.

Speech currently supports English recorded-message recognition, not live captions or private-call transcription. Accuracy in event noise and on local accents needs further acceptance testing.

### 3.11 Android field controls and UI improvements

- Optional Volume Down hold-to-talk using the same permission/media controls as on-screen TALK.
- Volume Up remains available for listening volume.
- Vibration feedback follows actual transmission state.
- Watchdog and duty/call/service cancellation stop stale input/capture.
- Optional accessibility service for background hardware-key delivery.
- Pocket Mode with a dim black keep-awake display and explicit exit.
- Original Kettoo brand artwork in the app header and launcher icon.
- Threads / Comms / People bottom navigation, with Comms as the initial destination and Settings in the header.
- People lists channels and approved people for recipient selection.
- Comms separates Live Voice and Message Log, shows one selected recipient and centres the TALK control.
- Transmission-only visual rings respect the system animation setting.
- Per-conversation drafts and attachment target preservation.
- Message actions remain visible above the keyboard after the inset/resize correction.
- Settings groups Account & duty, Audio, Push to talk, Connection and App, with expandable details and separate sign-out.
- Location feedback distinguishes queued, rejected, confirmed and cached state and explains floors without zones.

Guaranteed locked-screen hardware PTT depends on device behaviour and is not established by Pocket Mode.

## 4. Our main strengths

| Strength | Why it matters | Concrete implementation |
| --- | --- | --- |
| Communication and operations together | A team can discuss a problem, locate it, assign responsibility and retain its history in one system. | PTT, chat, calls, maps, check-ins and issue lifecycle. |
| Organisation control | Organisations can operate the communication stack and retain their own data and identity. | Local backend/storage, self-hosted LiveKit and local speech. |
| Resilience during outages | Supported work can continue and reconnect without creating duplicate records. | Room/IndexedDB queues, signed Nearby, stable IDs and recovery checks. |
| Voice with a durable record | Spoken reports are easier to revisit and acknowledge. | Saved bursts, replay, transcript and personal archive. |
| Explicit permissions | Access is enforced beyond what the interface displays. | Account/device approval, conversation/issue/file/media checks and room epochs. |
| Clear responsibility | Exclusive ownership comes from an authoritative result. | Atomic claims, confirmed status changes and version conflict rejection. |
| Practical field interaction | Staff can use quick controls while moving around a venue. | Hold TALK, optional hardware PTT, duty service, audio routing and Pocket Mode. |
| Flexible team organisation | Staff can participate in more than one operational channel. | Current backend/browser membership controls and preserved-assignment migration. |
| Evidence from real devices | Several behaviours have been exercised beyond mock-only tests. | Two-phone media/outage tests, native UI checks and actual local speech processing. |
| Improving usability | The current design reduces repeated information and clarifies important states. | Comms/People separation, grouped Settings, keyboard fixes and zone-check-in guidance. |

These strengths are supported by architecture and implementation evidence. They are not market-comparison results or claims of proven large-event reliability.

## 5. Technical architecture

| Component | Technology and role |
| --- | --- |
| Android | Kotlin, Jetpack Compose, Room, foreground duty service, media coordination and Nearby Connections. |
| Browser | React, TypeScript, Vite, IndexedDB and LiveKit client. |
| API | Fastify/TypeScript, authenticated HTTP and WebSocket events, permissions and operational state. |
| Persistence | SQLite, private attachment storage, schema migrations and durable queues/jobs. |
| Online media | Self-hosted LiveKit; backend-derived room access and speaking permissions. |
| Speech | Vosk English; Android on-device recognition and server Python/FFmpeg processing. |
| Deployment | Node application service, LiveKit, Caddy HTTPS proxy and deployment helpers. |

The project uses the MIT License; speech/runtime licensing is documented separately. Deployment still needs appropriate organisation DNS, HTTPS trust, secrets, backups and release distribution.

## 6. Verification evidence and its limits

### Checks run while preparing this summary

- Server TypeScript and browser production build: **passed** on 10 October 2026.
- Backend suite: **34/34 passed**, with zero failures or skipped tests. The first attempt encountered Windows sandbox temporary-directory rename errors; rerunning with TEMP/TMP inside the workspace passed without application-code changes.
- Android was not rebuilt, installed or physically retested for this documentation request.

### Existing verification records

| Record | Evidence |
| --- | --- |
| Phase 1 | 12 backend tests; real three-client media checks; two physical phones; user-confirmed audible screen-off reception and PTT replay; private voice/video and initial Nearby recovery checks. |
| Phase 2 | 22 backend tests; builds/lint; preserved messages on in-place phone upgrades; native issue/check-in workflows; actual queued-outage recovery; five-client broadcast isolation; physical receive/exclusion and PTT replay checks. |
| Phase 3 | 28 backend tests; server/browser/Android builds; real local Vosk recognition of synthetic WAV, WebM/Opus and AAC/M4A recordings; browser transcript/archive persistence checks. |
| Later Nearby work | 31 backend tests at that stage; two-way physical API-outage tests on OnePlus CPH2613 and Samsung SM-A356E; automatic authentication, live PCM playout, completed replay/text delivery and recovery sync; quorum/collision unit coverage. |
| Android Comms review | Build/lint and seven physical presentation/navigation checks; original logo/icon verified; keyboard obstruction fixed. |
| Android Settings/location review | Build/lint with no errors and 11 final regression checks on the installed build; manual review of grouped Settings, expanded help and no-zone location feedback. |

These counts describe different snapshots and must not be added together as one current test total. Decoded audio samples, delivery receipts and connected-room indicators do not establish that a person heard or understood a report. The Nearby outage tests stopped the local API while the Wi-Fi access point remained available; they do not prove behaviour after loss of the access point.

## 7. Current status and remaining work

**Status:** a substantial development/demo implementation through Phase 3, with real-device evidence for selected workflows. A production venue deployment still needs broader acceptance and operational preparation.

### Highest-value remaining checks

1. Test all intended workflows together on the latest Android, browser and backend, especially the newer multiple-channel model.
2. Exercise overlapping PTT, broadcasts, duty-admin exchanges and calls on physical devices.
3. Test Nearby with three or more phones, realistic distances, power settings, background reception and Wi-Fi access-point loss.
4. Measure intelligibility and transcription accuracy with actual speakers, accents and venue noise.
5. Verify hardware keys and audio routing on the phones/headsets intended for the event, including lock/display-off behaviour.
6. Check long sessions, repeated reconnects, permission changes, attachment recovery and service/server restarts.
7. Run realistic staff-count/load/storage tests and establish retention, backup and restore procedures.
8. Validate current local floor-removal behaviour, including retained issues and cleared locations.
9. Complete release signing/distribution, organisation configuration, HTTPS trust and managed certificate renewal. Historical demo leaf certificates were documented to expire on 10 October 2026; their current renewal status was not checked here.
10. Finish broader accessibility review, including TalkBack and large-font layouts.

### Features outside the current implementation

- Multi-hop mesh or venue-wide peer forwarding.
- GPS/automatic indoor positioning and automatic staff dispatch/allocation.
- Automatic issue escalation or priority-driven voice interruption.
- Cloud AI assistance, multilingual transcription or guaranteed recognition accuracy.
- Real-time live captions or private-call transcription.
- Offline private voice/video calls, group video and always-open microphones.
- Guaranteed locked-screen hardware PTT across Android devices.

## 8. How to describe the project

**One-sentence description:** Kettoo is an organisation-hosted event communication and coordination platform combining walkie-talkie voice, durable messaging, venue maps and issue workflows, with direct Android Nearby fallback and local English speech tools.

**Presentation-ready description:** We have built a native Android app, a browser operations console and a private backend that help event teams communicate and coordinate work. Staff can talk over permitted channels, contact a duty admin, exchange messages and attachments, report their zone and manage issues through assignment and resolution. Voice bursts can be replayed, transcribed locally and personally acknowledged. Supported actions queue through outages, and approved Android phones can use direct Nearby communication before synchronising back to the server. We have automated and physical-device verification for selected workflows, with venue-scale and deployment acceptance still to complete.

## 9. Source references

- [README](README.md): broad feature and setup reference; its single-team wording predates the latest backend/browser membership update.
- [Phase 1 verification](VERIFICATION.md): original media and physical-device evidence.
- [Overview through Phase 2](overview_till_phase2.md): operational design, historical checks and deferred acceptance.
- [Phase 3 overview](overview_phase3.md): speech, archive and hardware controls.
- [Nearby failover](docs/nearby-failover.md): current direct-peer behaviour, permissions and outage evidence.
- [Comms UI review](docs/ui-ux-review-comms.md): approved Android navigation, branding, composer and device review.
- [Settings UI review](docs/ui-ux-review-settings.md): grouped Settings and location-feedback fixes.
- `server/src/phase2.ts`, `server/src/db.ts`, `server/test/phase2.test.ts`: current operational memberships, migration, broadcast and venue behaviour.
- `web/src/App.tsx`, `web/src/Organisation.tsx`, `web/src/Operations.tsx`, `web/src/exampleVenue.ts`: current browser dashboard and local venue additions.

This summary intentionally excludes private credentials, signing keys, databases and personal account details.
