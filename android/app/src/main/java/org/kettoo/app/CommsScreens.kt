package org.kettoo.app

import android.database.ContentObserver
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.mapSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.snapshots.SnapshotStateMap
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.util.UUID

internal data class TalkAvailability(val allowed: Boolean, val label: String)

/** Presentation of existing eligibility; the media coordinator remains authoritative. */
internal fun talkAvailability(s: AppState, conversation: JSONObject, nearbyReady: Boolean): TalkAvailability {
    val reason = when {
        conversation.optString("kind") == "broadcast" && s.user?.optString("role") != "admin" -> "Receive only"
        !conversation.optBoolean("pttAllowed", true) -> "Live voice unavailable for this recipient"
        !s.duty -> "Off duty"
        s.recording -> "Finish your voice note first"
        s.call?.optString("state") == "accepted" -> "Finish your call first"
        !(s.connected && s.selected in s.mediaRooms || nearbyReady) ->
            if (s.connected) "Audio not connected" else "Connection unavailable"
        else -> null
    }
    return TalkAvailability(reason == null, reason ?: "Ready")
}

@Composable
fun CommsScreen(app: KettooApplication, s: AppState, duty: () -> Unit, people: () -> Unit, call: (Boolean) -> Unit) {
    var voice by rememberSaveable { mutableStateOf(true) }
    var archived by rememberSaveable(s.selected) { mutableStateOf(false) }
    val draftSaver = remember {
        mapSaver<SnapshotStateMap<String, String>>(
            save = { it.toMap() },
            restore = { saved -> mutableStateMapOf<String, String>().apply { saved.forEach { (id, text) -> put(id, text as String) } } }
        )
    }
    val drafts = rememberSaveable(saver = draftSaver) { mutableStateMapOf<String, String>() }
    val current = s.conversations.find { it.optString("id") == s.selected }
    val owner = s.user!!.getString("id")
    val history by remember(owner, s.selected) {
        if (s.selected.isBlank()) flowOf(emptyList()) else app.dao.watch(owner, s.selected)
    }.collectAsState(initial = emptyList())
    val cid = s.selected
    val keyboardOpen = WindowInsets.ime.getBottom(LocalDensity.current) > 0
    val text = drafts[cid].orEmpty()
    // Remember the destination when the external document picker opens.
    var attachmentTarget by rememberSaveable { mutableStateOf("") }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
        if (uri != null && attachmentTarget.isNotBlank()) {
            val target = attachmentTarget
            app.run {
                val mime = app.contentResolver.getType(uri) ?: error("Unknown file type")
                val kind = when {
                    mime.startsWith("image/") -> "image"
                    mime.startsWith("video/") -> "video"
                    mime.startsWith("audio/") -> "voice"
                    else -> error("Unsupported attachment")
                }
                check(!(app.state.value.conserve && kind == "video")) { "Conserve data disables video" }
                val cap = if (kind == "image") 5 * 1024 * 1024 else if (kind == "voice") 1024 * 1024 else 10 * 1024 * 1024
                val file = File(app.filesDir, "attachments/${UUID.randomUUID()}.${when (kind) { "image" -> "jpg"; "video" -> "mp4"; else -> "m4a" }}")
                withContext(Dispatchers.IO) {
                    try {
                        app.contentResolver.openInputStream(uri)!!.use { input ->
                            file.outputStream().use { output ->
                                val buffer = ByteArray(8192)
                                var total = 0
                                while (true) {
                                    val count = input.read(buffer)
                                    if (count < 0) break
                                    total += count
                                    check(total <= cap) { "Attachment is too large" }
                                    output.write(buffer, 0, count)
                                }
                            }
                        }
                    } catch (e: Exception) { file.delete(); throw e }
                }
                app.queue(target, kind, file = file, mime = mime)
            }
        }
    }
    DisposableEffect(cid) {
        onDispose { if (!app.hardware.held) app.media.release() }
    }
    Column(Modifier.fillMaxSize().padding(horizontal = 20.dp)) {
        Row(Modifier.fillMaxWidth().padding(top = 10.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(current?.optString("name") ?: "Choose a conversation", fontSize = if (keyboardOpen) 18.sp else 24.sp, fontWeight = FontWeight.Bold)
                val nearby = app.nearby.canTalk(cid)
                val connection = when {
                    nearby && (!s.connected || cid !in s.mediaRooms) -> "Nearby · ${app.nearby.livePeers(cid).size} teammates"
                    s.connected && cid in s.mediaRooms -> "Connected"
                    s.connected -> "Server connected · audio unavailable"
                    else -> "Offline"
                }
                if (!keyboardOpen) Text(connection, color = Color.DarkGray, fontSize = 13.sp)
            }
            TextButton(people) { Text("Change", fontWeight = FontWeight.SemiBold) }
        }
        if (!keyboardOpen) Row(Modifier.fillMaxWidth().padding(top = 8.dp).background(Color(0xFFE8E6E3)).selectableGroup()) {
            listOf(true to "Live Voice", false to "Message Log").forEach { (selectedVoice, title) ->
                val selected = voice == selectedVoice
                Button(
                    onClick = { voice = selectedVoice }, modifier = Modifier.weight(1f).heightIn(min = 48.dp)
                        .semantics { this.selected = selected; role = Role.Tab },
                    shape = RectangleShape, contentPadding = PaddingValues(horizontal = 8.dp, vertical = 12.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = if (selected) Color.Black else Color.Transparent,
                        contentColor = if (selected) Color.White else Color.Black)
                ) { Text(title, fontSize = 14.sp, fontWeight = FontWeight.SemiBold) }
            }
        }
        if (current == null) {
            Column(Modifier.weight(1f).fillMaxWidth(), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                Text("Choose a channel or person to start.", textAlign = TextAlign.Center)
                TextButton(people) { Text("Open People") }
            }
        } else if (voice) {
            LiveVoice(app, s, current, duty, Modifier.weight(1f))
        } else {
            if (s.error.isNotBlank()) CommsError(app, s.error)
            if (!keyboardOpen && current.optString("kind") == "private") {
                Row(Modifier.fillMaxWidth().padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    val callReady = s.duty && s.connected && !s.recording && s.call?.optString("state") !in listOf("ringing", "accepted")
                    OutlinedButton({ call(false) }, Modifier.weight(1f), enabled = callReady, shape = RectangleShape) {
                        Icon(Icons.Outlined.Call, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text("Voice call", fontSize = 13.sp)
                    }
                    OutlinedButton({ call(true) }, Modifier.weight(1f), enabled = callReady && !s.conserve, shape = RectangleShape) {
                        Icon(Icons.Outlined.Videocam, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text("Video call", fontSize = 13.sp)
                    }
                }
                if (!s.duty) TextButton(duty) { Text("Start duty to use voice notes and calls") }
            }
            if (!keyboardOpen) Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                val archiveColors = FilterChipDefaults.filterChipColors(selectedContainerColor = Color.Black,
                    selectedLabelColor = Color.White, selectedLeadingIconColor = Color.White)
                FilterChip(selected = !archived, onClick = { archived = false }, label = { Text("Inbox") }, colors = archiveColors)
                FilterChip(selected = archived, onClick = { archived = true }, label = { Text("My archive (${history.count { it.archived }})") },
                    leadingIcon = { Icon(Icons.Outlined.Folder, null, Modifier.size(18.dp)) }, colors = archiveColors)
            }
            val visible = history.filter { it.archived == archived }
            val listState = rememberLazyListState()
            // A newly opened log starts at its newest entry. Reading older entries does not jump on updates.
            LaunchedEffect(cid, archived, visible.isEmpty()) {
                if (visible.isNotEmpty()) listState.scrollToItem(visible.lastIndex)
            }
            LazyColumn(Modifier.weight(1f).fillMaxWidth(), state = listState,
                verticalArrangement = Arrangement.spacedBy(10.dp), contentPadding = PaddingValues(vertical = 8.dp)) {
                items(visible, key = { it.id }) { MessageBubble(app, it) }
                if (visible.isEmpty()) item {
                    Text(if (archived) "Acknowledged messages appear here, only for you." else "No unacknowledged messages.",
                        color = Color.DarkGray, fontSize = 14.sp, modifier = Modifier.padding(vertical = 16.dp))
                }
            }
            if (!archived && (current.optString("kind") != "broadcast" || s.user.optString("role") == "admin")) {
                MessageComposer(app, s, text, { drafts[cid] = it },
                    attach = { attachmentTarget = cid; picker.launch(arrayOf("image/*", "video/*", "audio/*")) },
                    send = {
                        val body = drafts[cid].orEmpty().trim()
                        if (body.isNotBlank()) { app.speech.stopDictation(); app.run { app.queue(cid, "text", body) }; drafts[cid] = "" }
                    })
            } else if (!archived) {
                Text("Only admins can post to All Staff.", fontSize = 13.sp, color = Color.DarkGray, modifier = Modifier.padding(vertical = 12.dp))
            }
        }
    }
}

@Composable
private fun CommsError(app: KettooApplication, message: String) {
    Row(Modifier.fillMaxWidth().padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(message, Modifier.weight(1f).semantics { liveRegion = LiveRegionMode.Polite }, fontSize = 13.sp, color = Color.DarkGray)
        IconButton({ app.patch { it.copy(error = "") } }) { Icon(Icons.Outlined.Close, "Dismiss message", Modifier.size(20.dp)) }
    }
}

@Composable
private fun LiveVoice(app: KettooApplication, s: AppState, current: JSONObject, duty: () -> Unit, modifier: Modifier) {
    val availability = talkAvailability(s, current, app.nearby.canTalk(s.selected))
    val activeHere = app.media.transmissionConversation == s.selected
    val transmitting = s.ptt == "TRANSMITTING" && activeHere
    val requesting = s.ptt == "REQUESTING"
    val status = when {
        transmitting -> "TRANSMITTING"
        s.ptt == "TRANSMITTING" -> "Transmitting to another channel"
        requesting -> "Requesting…"
        else -> availability.label
    }
    BoxWithConstraints(modifier.fillMaxWidth()) {
        val compact = maxHeight < 330.dp || LocalDensity.current.fontScale > 1.3f
        val diameter = minOf(maxWidth, 292.dp, (maxHeight - if (!s.duty) 150.dp else 100.dp).coerceAtLeast(168.dp))
        Column(Modifier.fillMaxSize().then(if (compact) Modifier.verticalScroll(rememberScrollState()) else Modifier),
            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            if (s.error.isNotBlank()) CommsError(app, s.error)
            Text(status, Modifier.semantics { liveRegion = LiveRegionMode.Polite }, fontSize = 14.sp,
                fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
            Spacer(Modifier.height(12.dp))
            TalkControl(app, s.selected, current.optString("name"), availability.allowed, transmitting, diameter, status)
            Spacer(Modifier.height(16.dp))
            Text("Speak after TRANSMITTING appears · Max 30 seconds", fontSize = 12.sp, color = Color.DarkGray,
                textAlign = TextAlign.Center)
            if (!s.duty) {
                Spacer(Modifier.height(10.dp))
                OutlinedButton(duty, shape = RectangleShape) { Text("Start duty") }
            }
        }
    }
}

@Composable
private fun motionEnabled(): Boolean {
    val resolver = LocalContext.current.contentResolver
    fun readEnabled() = Settings.Global.getFloat(resolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) > 0f
    var enabled by remember { mutableStateOf(readEnabled()) }
    DisposableEffect(resolver) {
        val observer = object : ContentObserver(Handler(Looper.getMainLooper())) {
            override fun onChange(selfChange: Boolean) { enabled = readEnabled() }
        }
        resolver.registerContentObserver(Settings.Global.getUriFor(Settings.Global.ANIMATOR_DURATION_SCALE), false, observer)
        onDispose { resolver.unregisterContentObserver(observer) }
    }
    return enabled
}

@Composable
private fun TalkControl(app: KettooApplication, cid: String, recipient: String, allowed: Boolean, transmitting: Boolean,
    diameter: Dp, status: String) {
    val animate = transmitting && motionEnabled()
    val progress = if (animate) {
        val transition = rememberInfiniteTransition(label = "PTT ripple")
        val frame by transition.animateFloat(0f, 1f, infiniteRepeatable(tween(1800, easing = LinearEasing)), label = "Ripple radius")
        frame
    } else 0f
    var instructions by remember { mutableStateOf(false) }
    Box(Modifier.size(diameter), contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            val radius = size.minDimension * 0.38f
            if (transmitting) repeat(2) { index ->
                val phase = if (animate) (progress + index * 0.5f) % 1f else (index + 1) / 3f
                drawCircle(Color.Black.copy(alpha = 0.16f * (1f - phase)), radius + size.minDimension * 0.12f * phase,
                    style = Stroke(1.dp.toPx()))
            } else {
                drawCircle(Color.Black.copy(alpha = 0.08f), size.minDimension * 0.45f, style = Stroke(1.dp.toPx()))
            }
        }
        val color = if (transmitting) Color.White else if (allowed) Color.Black else Color.DarkGray
        Column(Modifier.size(diameter * 0.76f)
            .background(if (transmitting) Color.Black else Color.White, CircleShape)
            .border(1.dp, if (allowed) Color.Black else Color(0xFFB5B2AE), CircleShape)
            .semantics(mergeDescendants = true) {
                role = Role.Button
                contentDescription = "Hold to talk to $recipient. Release to stop."
                stateDescription = status
                if (!allowed) disabled()
                // Accessibility activation explains holding; it never latches the microphone open.
                onClick("Push-to-talk instructions") { instructions = true; true }
            }
            .pointerInput(allowed, cid) {
                if (allowed) detectTapGestures(onPress = {
                    app.media.press(cid)
                    try { tryAwaitRelease() } finally { app.media.release() }
                })
            }, horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            Icon(Icons.Outlined.Mic, null, Modifier.size(if (diameter < 220.dp) 34.dp else 46.dp), tint = color)
            Spacer(Modifier.height(8.dp))
            Text("TALK", color = color, fontSize = if (diameter < 220.dp) 24.sp else 30.sp, fontWeight = FontWeight.Bold)
            Text(if (transmitting) "Release to stop" else "Hold to talk", color = color, fontSize = 12.sp, textAlign = TextAlign.Center)
        }
    }
    if (instructions) AlertDialog(onDismissRequest = { instructions = false }, title = { Text("Push to talk") },
        text = { Text("Hold TALK and speak after TRANSMITTING appears. Release to stop. You can also enable Volume Down push-to-talk in Settings. Transmission stops after at most 30 seconds.") },
        confirmButton = { TextButton({ instructions = false }) { Text("Close") } })
}

@Composable
private fun MessageComposer(app: KettooApplication, s: AppState, text: String, onText: (String) -> Unit, attach: () -> Unit, send: () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 4.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        OutlinedTextField(text, onText, Modifier.fillMaxWidth(), placeholder = { Text("Write a message…", fontSize = 14.sp) },
            shape = RectangleShape, minLines = 1, maxLines = 3)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            IconButton(attach) { Icon(Icons.Outlined.AttachFile, "Attach photo, video or audio") }
            OutlinedButton({ app.run {
                if (s.recording) app.media.stopNote() else { check(s.duty) { "Start duty before recording" }; app.media.startNote(s.selected) }
            } }, shape = RectangleShape, contentPadding = PaddingValues(horizontal = 8.dp, vertical = 8.dp)) {
                Icon(if (s.recording) Icons.Outlined.Stop else Icons.Outlined.Mic, null, Modifier.size(18.dp))
                Spacer(Modifier.width(4.dp)); Text(if (s.recording) "Stop note" else "Voice note", fontSize = 12.sp)
            }
            Button(send, enabled = text.isNotBlank(), shape = RectangleShape, contentPadding = PaddingValues(horizontal = 12.dp)) {
                Icon(Icons.Outlined.Send, "Send message", Modifier.size(20.dp))
            }
        }
        DictateButton(app, "chat:${s.selected}", text, onText)
    }
}

@Composable
fun PeopleScreen(app: KettooApplication, s: AppState, onComms: () -> Unit) {
    val channels = s.conversations.filter { it.optString("kind") != "private" }
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(10.dp),
        contentPadding = PaddingValues(vertical = 14.dp)) {
        item { Text("Channels & people", fontSize = 25.sp, fontWeight = FontWeight.Bold) }
        item { PhaseComms(app, onComms) }
        if (channels.isNotEmpty()) item { Text("Channels", fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 4.dp)) }
        items(channels, key = { "channel:${it.getString("id")}" }) { channel ->
            OutlinedButton({ app.select(channel.getString("id")); onComms() }, Modifier.fillMaxWidth(), shape = RectangleShape) {
                Icon(Icons.Outlined.Radio, null, Modifier.size(20.dp)); Spacer(Modifier.width(12.dp))
                Text(channel.getString("name"), Modifier.weight(1f), textAlign = TextAlign.Start)
                if (s.selected == channel.getString("id")) Icon(Icons.Outlined.Check, "Selected")
            }
        }
        item { Text("People", fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 10.dp)) }
        items(s.people.filter { it.getString("id") != s.user!!.getString("id") }, key = { "person:${it.getString("id")}" }) { person ->
            val cached = s.conversations.firstOrNull { conversation ->
                conversation.optString("kind") == "private" && conversation.optJSONArray("members")?.objects()?.any {
                    it.optString("id") == person.getString("id")
                } == true
            }
            OutlinedButton({
                if (cached != null) { app.select(cached.getString("id")); onComms() }
                else app.run { app.privateChat(person.getString("id")); onComms() }
            }, Modifier.fillMaxWidth(), enabled = cached != null || s.connected, shape = RectangleShape) {
                Icon(Icons.Outlined.Person, null, Modifier.size(20.dp)); Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f).padding(vertical = 6.dp)) {
                    Text(person.getString("name"), fontWeight = FontWeight.SemiBold)
                    Text(person.getString("role"), fontSize = 12.sp, color = Color.DarkGray)
                }
                Icon(Icons.Outlined.ArrowForward, null, Modifier.size(20.dp))
            }
        }
        if (!s.connected) item { Text("Existing conversations are available offline. Connect to open a new private conversation.", fontSize = 13.sp, color = Color.DarkGray) }
    }
}
