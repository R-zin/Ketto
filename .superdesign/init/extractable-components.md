# Potential shared Android components
These are native Compose candidates. Canvas extraction later requires intentional HTML conversion; native source remains authoritative. No remote components have been created.

## AppHeader
- Source: MainActivity.kt:64,79
- Category: layout
- Description: KETTO brand and settings shortcut.
- Extractable props: signedIn (boolean)
- Hardcoded: CellTower and Person icons, KETTO/SECURE labels, current styles.

## BottomNavigation
- Source: MainActivity.kt:115
- Category: layout
- Description: Four persistent destinations.
- Extractable props: activeItem (string, default comms)
- Hardcoded: Comms/Threads/People/Settings labels and outlined icons.

## LocationRow
- Source: ThreadScreens.kt:31-34
- Category: layout
- Description: Current zone and check-in age, opens floor/zone dialog.
- Extractable props: zoneName (string), reportedAge (string), visible (boolean)
- Hardcoded: LocationOn icon and My location label.

## CommunicationContext
- Source: ThreadScreens.kt:35-37
- Category: layout
- Description: Team shortcut and duty-admin exchange controls.
- Extractable props: teamName (string), adminName (string), adminReachable (boolean), hasExchange (boolean), adminBusy (boolean)
- Hardcoded: Team PTT/Talk to admin/Private admin PTT/End private exchange labels.

## MessageBubble
- Source: MainActivity.kt:174-189
- Category: basic
- Description: Message content, audio replay, transcript and acknowledgement/archive.
- Extractable props: isMine (boolean), archived (boolean), hasAttachment (boolean), showTranscript (boolean), deliveryState (string)
- Hardcoded: PlayArrow/Check icons and content styles.

## Tag
- Source: MainActivity.kt:63
- Category: basic
- Description: Uppercase monospace small label.
- Extractable props: none (content is text).
- Hardcoded: typography and letter spacing.

## Action
- Source: MainActivity.kt:65
- Category: basic
- Description: Full-width primary button.
- Extractable props: enabled (boolean)
- Hardcoded: rectangular shape and padding.

## DictateButton
- Source: OfflineSpeech.kt:138-143
- Category: basic
- Description: Offline dictation input control.
- Extractable props: active (boolean), enabled (boolean)
- Hardcoded: Dictate offline / Stop dictation labels.
