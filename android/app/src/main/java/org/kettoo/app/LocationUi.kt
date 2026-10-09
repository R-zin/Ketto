package org.kettoo.app

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.LocationOn
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import org.json.JSONObject
import java.text.DateFormat
import java.util.Date

internal data class LocationDisplay(val label: String, val detail: String, val floor: String)

/** Keep a locally queued location visibly distinct from a server-confirmed check-in. */
internal fun locationDisplay(ops: OperationsState): LocationDisplay {
    val data = ops.snapshot
    val check = data?.optJSONObject("checkin")
    val latest = ops.pending.lastOrNull { it.path == "/checkins" }
    val body = latest?.let { runCatching { JSONObject(it.body) }.getOrNull() }
    val queuedZone = data?.optJSONArray("zones")?.objects()?.find { it.optString("id") == body?.optString("zoneId") }
    val pending = latest?.state == "pending"
    val floor = if (pending) queuedZone?.optString("floor_id").orEmpty() else check?.optString("floor_id").orEmpty()
    val floorName = data?.optJSONArray("floors")?.objects()?.find { it.optString("id") == floor }?.optString("name").orEmpty()
    val zoneName = if (pending) queuedZone?.optString("name").orEmpty() else check?.optString("zone_name").orEmpty()
    val label = when {
        zoneName.isNotBlank() -> listOf(floorName, zoneName).filter { it.isNotBlank() }.joinToString(" / ")
        pending -> "Location update queued"
        else -> "My location · unknown"
    }
    val detail = when {
        pending -> "Pending confirmation"
        latest?.state == "rejected" -> "Update rejected"
        check != null -> if (ops.live) "Confirmed" else "Last confirmed"
        else -> ""
    }
    return LocationDisplay(label, detail, floor)
}

@Composable
fun PhaseLocation(app: KettooApplication) {
    val ops by app.operations.state.collectAsStateWithLifecycle()
    var open by remember { mutableStateOf(false) }
    var floor by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }
    val data = ops.snapshot ?: return
    val floors = data.optJSONArray("floors")?.objects().orEmpty()
    val zones = data.optJSONArray("zones")?.objects().orEmpty()
    val display = locationDisplay(ops)
    TextButton({ floor = display.floor.ifBlank { floors.singleOrNull()?.optString("id").orEmpty() }; open = true },
        Modifier.fillMaxWidth().heightIn(min = 44.dp), contentPadding = PaddingValues(horizontal = 20.dp, vertical = 4.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(Icons.Outlined.LocationOn, null, Modifier.size(20.dp))
            Text(display.label, Modifier.weight(1f), fontSize = 14.sp)
            if (display.detail.isNotEmpty()) Text(display.detail, fontSize = 11.sp, color = Color.DarkGray)
        }
    }
    if (open) AlertDialog(onDismissRequest = { if (!saving) open = false }, title = { Text("My location") },
        containerColor = Color.White,
        text = { Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Choose a floor, then a zone to check in. Your communication team stays the same.", fontSize = 13.sp)
            Text("1. Floor", fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
            if (floors.isEmpty()) Text(if (ops.live) "No floors available. Ask an admin to configure the venue." else "Reconnect to load venue floors.", fontSize = 13.sp)
            floors.forEach { f ->
                OutlinedButton({ floor = f.getString("id") }, Modifier.fillMaxWidth(), enabled = !saving, shape = RectangleShape) {
                    Text(f.getString("name") + if (floor == f.getString("id")) " ✓" else "")
                }
            }
            Text("2. Zone", fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
            val selectedFloor = floors.find { it.optString("id") == floor }
            val available = zones.filter { it.optString("floor_id") == floor }
            if (selectedFloor == null) Text("Choose a floor to see its zones.", fontSize = 13.sp)
            else if (available.isEmpty()) Text("No zones available on ${selectedFloor.optString("name")}. " +
                if (ops.live) "Ask an admin to add zones." else "Reconnect to refresh zones.", fontSize = 13.sp)
            available.forEach { zone ->
                Button({ saving = true; app.run { try { app.operations.checkin(zone.getString("id")); open = false } finally { saving = false } } },
                    Modifier.fillMaxWidth(), enabled = !saving, shape = RectangleShape) { Text(zone.getString("name")) }
            }
            if (display.detail.isNotBlank()) Text(display.detail, fontSize = 13.sp, color = Color.DarkGray,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
            data.optJSONObject("checkin")?.optLong("reported_at")?.takeIf { it > 0 }?.let { reportedAt ->
                Text("Last confirmed check-in: " + DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(Date(reportedAt)),
                    fontSize = 12.sp, color = Color.DarkGray)
            }
            ops.pending.lastOrNull { it.path == "/checkins" }?.takeIf { it.state == "rejected" }?.let { rejected ->
                Text(rejected.error.ifBlank { "The server rejected the location update." }, fontSize = 13.sp)
            }
            if (!ops.live) Text("Your zone check-in will queue until the server reconnects.", fontSize = 12.sp)
            if (saving) Text("Saving check-in…", fontSize = 13.sp)
        } }, confirmButton = { TextButton({ open = false }, enabled = !saving) { Text("Close") } })
}
