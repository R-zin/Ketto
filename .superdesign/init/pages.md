# Android page dependency trees
All native files use package org.kettoo.app; local symbols resolve by same-package references rather than relative imports. External Android/Compose/LiveKit imports are libraries, not context files.
UI dependencies are separated from behavioral adapters. Behavioral adapters form a shared cyclic graph through KettooApplication; preserve them rather than sending them as design payload.
Paths below are relative to android/app/src/main/java/org/kettoo/app/.

## Comms (first review target)
Entry: MainActivity.kt:136-173, Conversation; shell: MainActivity.kt:66-119.
- MainActivity.kt: Tag, Brand, Action, Conversation, MessageBubble, CallVideo, KettooUI
  - ThreadScreens.kt:31-37, PhaseLocation and PhaseComms
  - OfflineSpeech.kt:138-143, DictateButton
  - KettooApplication.kt: AppState and coordinator references
    - Storage.kt: LocalMessage, MessageDao, LocalDatabase, Vault
    - Api.kt: Api, json, objects helpers
    - MediaCoordinator.kt: PTT, voice notes, replay, calls, media room readiness
      - AudioRouting.kt: active audio output selection
      - NearbyLink.kt: automatic alternate transport
        - NearbyFloor.kt: direct-channel speaking reservation
        - NearbyAudio.kt: direct live PCM transport
      - OfflineSpeech.kt: local transcription/dictation
    - Phase2.kt: operations, duty-admin exchanges, check-ins, issue queues
      - Api.kt, Storage.kt, KettooApplication.kt (shared/cycle)
    - Phase3.kt: acknowledgement and personal archive
      - Storage.kt, Api.kt, KettooApplication.kt (shared/cycle)
    - HardwarePtt.kt: volume keys, target and haptics
      - MediaCoordinator.kt, KettooApplication.kt (shared/cycle)
    - DutyService.kt: duty lifecycle and receiving
      - MediaCoordinator.kt, KettooApplication.kt (shared/cycle)
- AndroidManifest.xml: permissions, activity/service configuration and theme
- res/values/strings.xml: Android resource strings (UI currently primarily inline literals)

## People
Entry: MainActivity.kt:87, inline people branch.
- Shared shell/primitives: MainActivity.kt, ThreadScreens.kt:PhaseLocation
- KettooApplication.kt: people state and privateChat
  - Api.kt, Storage.kt and shared communication adapters above

## Settings
Entry: MainActivity.kt:89-112, inline settings branch.
- Shared shell/primitives: MainActivity.kt, ThreadScreens.kt:PhaseLocation
- MainActivity.kt: ListeningVolume
- KettooApplication.kt/AppState -> AudioRouting.kt, MediaCoordinator.kt, HardwarePtt.kt, NearbyLink.kt, OfflineSpeech.kt, DutyService.kt, Vault (Storage.kt)
- AndroidManifest.xml, res/xml/ptt_accessibility_service.xml

## Threads, create and detail
Entry: ThreadScreens.kt:39-67; shared shell: MainActivity.kt.
- ThreadScreens.kt: ThreadsScreen, Priority, CreateThread, ThreadDetail, PhaseImage, age
  - OfflineSpeech.kt: DictateButton
  - Phase2.kt: operational snapshot, queues, updates, image download
  - KettooApplication.kt: session and Api operations
  - Api.kt, Storage.kt and shared adapters above (shared/cycle)

## Sign-in
Entry: MainActivity.kt:120-135.
- MainActivity.kt: shell, Brand, Action, Tag
- KettooApplication.kt: login
  - Api.kt, Vault (Storage.kt)

## Pocket Mode
Entry: MainActivity.kt:70.
- MainActivity.kt: early-return UI and window effect
- AppState (KettooApplication.kt), HardwarePtt.kt, MediaCoordinator.kt

## Call overlay
Entry: MainActivity.kt:118; CallVideo:191.
- MainActivity.kt: permissions, call dialog, video surface
- AppState (KettooApplication.kt), Api.kt, MediaCoordinator.kt, AudioRouting.kt

Generation context must be narrowed to the selected target's actual UI branch, with theme.md tokens. This review has not created a remote project/draft or durable resume target.
