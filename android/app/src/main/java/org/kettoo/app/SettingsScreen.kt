package org.kettoo.app

import android.content.Intent
import android.media.AudioManager
import android.provider.Settings
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun SettingsScreen(app: KettooApplication, s: AppState, onDutyChange: (Boolean) -> Unit, onNearbyChange: (Boolean) -> Unit) {
    var outputOpen by rememberSaveable { mutableStateOf(false) }
    var backgroundOpen by rememberSaveable { mutableStateOf(false) }
    var nearbyOpen by rememberSaveable { mutableStateOf(false) }
    var speechOpen by rememberSaveable { mutableStateOf(false) }
    var retrying by remember { mutableStateOf(false) }
    val scroll = rememberScrollState()
    val target = s.conversations.find { it.optString("id") == app.hardware.target() }?.optString("name") ?: "Assigned team"
    Column(Modifier.fillMaxSize().verticalScroll(scroll).padding(horizontal = 20.dp, vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text("Settings", fontSize = 27.sp, fontWeight = FontWeight.Bold, modifier = Modifier.semantics { heading() })
        SettingsSection("Account & duty") {
            Row(Modifier.fillMaxWidth().heightIn(min = 56.dp), verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text(s.user?.optString("name").orEmpty(), fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
                    Hint("${if (s.connected) "Server connected" else "Server unavailable"} · ${if (s.duty) "On duty" else "Off duty"}")
                }
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("On duty", fontSize = 12.sp)
                    Switch(s.duty, onDutyChange, modifier = Modifier.semantics { contentDescription = "On duty" }, colors = monochromeSwitchColors())
                }
            }
            Hint(if (s.duty) "Receiving live audio while on duty." else "Start duty to receive live audio.")
        }
        SettingsSection("Audio") {
            SettingsRow("Audio output", s.audioOutput, outputOpen, { outputOpen = !outputOpen })
            if (outputOpen) {
                if (s.audioOutputs.isEmpty()) Hint(if (s.duty) "No audio output is available yet." else "Start duty to activate audio outputs.")
                s.audioOutputs.forEach { name ->
                    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable { app.media.audioRouting.select(name) },
                        verticalAlignment = Alignment.CenterVertically) {
                        RadioButton(name == s.audioOutput, { app.media.audioRouting.select(name) },
                            colors = RadioButtonDefaults.colors(selectedColor = Color.Black))
                        Text(name, fontSize = 14.sp)
                    }
                }
            } else if (s.audioOutputs.isEmpty()) Hint(if (s.duty) "Audio output is preparing." else "Available while on duty.")
            SectionDivider()
            ListeningVolume()
        }
        SettingsSection("Push to talk") {
            SettingsSwitchRow("Volume Down PTT", "Hold to talk · Target: $target", s.hardwarePtt) { enabled ->
                app.hardware.cancel()
                app.vault.put("hardwarePtt", enabled.toString())
                app.patch { it.copy(hardwarePtt = enabled) }
            }
            SectionDivider()
            SettingsRow("Background keys", if (s.hardwareAvailable) "Enabled" else "Not enabled", backgroundOpen,
                { backgroundOpen = !backgroundOpen })
            if (backgroundOpen) {
                Hint("The optional accessibility service enables background Volume Down PTT. Foreground keys work without it.")
                OutlinedButton({ app.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) },
                    shape = RectangleShape) { Text("Open accessibility settings", fontSize = 13.sp) }
                Hint("Sideloaded apps may need App info → Allow restricted settings. Screen-off keys depend on the phone; Pocket Mode keeps Kettoo awake.")
            }
            SectionDivider()
            Row(Modifier.fillMaxWidth().heightIn(min = 56.dp), verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text("Pocket Mode", fontSize = 16.sp)
                    Hint(when { !s.duty -> "Start duty to use."; !s.hardwarePtt -> "Enable Volume Down PTT to use."; else -> "Dim the screen for hardware PTT." })
                }
                OutlinedButton({ app.patch { it.copy(pocketMode = true) } }, enabled = s.duty && s.hardwarePtt,
                    shape = RectangleShape, modifier = Modifier.semantics { contentDescription = "Open Pocket Mode" }) { Text("Open", fontSize = 13.sp) }
            }
        }
        SettingsSection("Connection") {
            SettingsSwitchRow("Nearby failover", "Connects to nearby teammates during outages.", s.nearbyEnabled, onNearbyChange)
            SectionDivider()
            SettingsRow(if (s.nearbyEnabled) s.nearbyStatus.lowercase().replaceFirstChar { it.titlecase() } else "Nearby off",
                "Requirements & details", nearbyOpen, { nearbyOpen = !nearbyOpen }, accessibilityName = "Nearby requirements & details")
            if (s.peers.isNotEmpty()) {
                s.peers.values.forEach { name -> Hint("$name · connected") }
            }
            if (nearbyOpen) {
                Hint("Keep Nearby enabled on each teammate’s phone and stay on duty. Bluetooth and Wi-Fi must be on.")
                Hint("Approved devices connect and retry queued delivery automatically. Live audio reaches devices in direct range; private calls and acknowledgements need the server.")
                Hint("Offline permissions expire after eight hours. New permissions and revocations require server contact.")
                Hint("Server: ${if (s.connected) "connected" else "unavailable"} · ${s.mediaRooms.size} audio rooms connected")
            }
            SectionDivider()
            Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Retry queued messages", Modifier.weight(1f), fontSize = 14.sp)
                OutlinedButton({ retrying = true; app.run { try { app.flush() } finally { retrying = false } } },
                    enabled = !retrying, shape = RectangleShape) { Text(if (retrying) "Retrying…" else "Retry", fontSize = 13.sp) }
            }
            if (!s.connected) Hint("Queued delivery retries automatically when the server reconnects.")
        }
        SettingsSection("App") {
            SettingsSwitchRow("Disable video", "Conserve data during calls and uploads.", s.conserve) { enabled -> app.patch { it.copy(conserve = enabled) } }
            SectionDivider()
            SettingsRow("Offline transcripts", if (s.speechReady) "English ready" else s.speechError.ifBlank { "Preparing English model…" },
                speechOpen, { speechOpen = !speechOpen })
            if (speechOpen) Hint("English audio transcripts and dictation run on this phone. Review automatic transcripts against the recording when needed.")
        }
        OutlinedButton({ app.run { app.logout() } }, Modifier.fillMaxWidth().heightIn(min = 48.dp), shape = RectangleShape) {
            Text("Sign out", fontSize = 15.sp)
        }
    }
}

@Composable
private fun SettingsSection(title: String, content: @Composable ColumnScope.() -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
        Text(title.uppercase(), modifier = Modifier.padding(start = 8.dp).semantics { heading() },
            fontSize = 12.sp, letterSpacing = 1.sp, color = Color.DarkGray, fontWeight = FontWeight.SemiBold)
        Surface(color = Color.White, shape = RoundedCornerShape(6.dp), modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(horizontal = 12.dp, vertical = 6.dp), verticalArrangement = Arrangement.spacedBy(4.dp), content = content)
        }
    }
}

@Composable
private fun SettingsSwitchRow(title: String, description: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 64.dp).semantics(mergeDescendants = true) { contentDescription = title }
        .toggleable(checked, role = Role.Switch, onValueChange = onChange),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(title, fontSize = 16.sp)
            Hint(description)
        }
        Switch(checked, onCheckedChange = null, colors = monochromeSwitchColors())
    }
}

@Composable
private fun monochromeSwitchColors() = SwitchDefaults.colors(
    checkedThumbColor = Color.White, checkedTrackColor = Color.Black, checkedBorderColor = Color.Black,
    uncheckedThumbColor = Color.DarkGray, uncheckedTrackColor = Color(0xFFE4E2DF), uncheckedBorderColor = Color(0xFF777571)
)

@Composable
private fun SettingsRow(title: String, description: String, expanded: Boolean, onClick: () -> Unit, accessibilityName: String = title) {
    Row(Modifier.fillMaxWidth().heightIn(min = 60.dp)
        .semantics(mergeDescendants = true) { contentDescription = accessibilityName; stateDescription = if (expanded) "Expanded" else "Collapsed" }
        .clickable(onClick = onClick),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(title, fontSize = 16.sp)
            Hint(description)
        }
        Icon(if (expanded) Icons.Outlined.ExpandLess else Icons.Outlined.ChevronRight, null, Modifier.size(22.dp))
    }
}

@Composable private fun Hint(text: String) { Text(text, fontSize = 12.sp, color = Color.DarkGray) }
@Composable private fun SectionDivider() { HorizontalDivider(color = Color(0xFFE2E0DD), modifier = Modifier.padding(vertical = 2.dp)) }

@Composable
private fun ListeningVolume() {
    val context = LocalContext.current
    val audio = remember { context.getSystemService(android.content.Context.AUDIO_SERVICE) as AudioManager }
    val maximum = audio.getStreamMaxVolume(AudioManager.STREAM_VOICE_CALL).coerceAtLeast(1)
    var volume by remember { mutableFloatStateOf(audio.getStreamVolume(AudioManager.STREAM_VOICE_CALL).toFloat()) }
    Text("Listening volume", fontSize = 15.sp)
    Slider(volume, { volume = it; audio.setStreamVolume(AudioManager.STREAM_VOICE_CALL, it.toInt(), 0) },
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = "Listening volume" },
        valueRange = 0f..maximum.toFloat(), steps = (maximum - 1).coerceAtLeast(0),
        colors = SliderDefaults.colors(thumbColor = Color.Black, activeTrackColor = Color.Black,
            inactiveTrackColor = Color(0xFFD6D3D0), activeTickColor = Color.White, inactiveTickColor = Color.DarkGray))
}
