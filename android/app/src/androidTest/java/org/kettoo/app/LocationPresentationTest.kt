package org.kettoo.app

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** Pure presentation checks; these tests do not submit a check-in or change venue data. */
@RunWith(AndroidJUnit4::class)
class LocationPresentationTest {
    private fun venue() = JSONObject("""{"floors":[{"id":"floor1","name":"Floor 1"}],"zones":[{"id":"stage","floor_id":"floor1","name":"Stage"}],"checkin":null}""")
    private fun pending(state: String = "pending") = PendingOperation("test", "staff", "/checkins", """{"zoneId":"stage","reportedAt":1}""", state = state)

    @Test fun havingAFloorDoesNotImplyAConfirmedLocation() {
        val display = locationDisplay(OperationsState(snapshot = venue(), live = true))
        assertEquals("My location · unknown", display.label)
        assertEquals("", display.detail)
    }

    @Test fun queuedLocationIsNeverLabelledConfirmedEvenWhenConnected() {
        val display = locationDisplay(OperationsState(snapshot = venue(), live = true, pending = listOf(pending())))
        assertEquals("Floor 1 / Stage", display.label)
        assertEquals("Pending confirmation", display.detail)
    }

    @Test fun rejectionKeepsTheLastConfirmedLocation() {
        val snapshot = venue().put("checkin", JSONObject("""{"floor_id":"floor1","zone_name":"Entrance","reported_at":1}"""))
        val display = locationDisplay(OperationsState(snapshot = snapshot, live = true, pending = listOf(pending("rejected"))))
        assertEquals("Floor 1 / Entrance", display.label)
        assertEquals("Update rejected", display.detail)
    }

    @Test fun cachedLocationIsShownAsLastConfirmed() {
        val snapshot = venue().put("checkin", JSONObject("""{"floor_id":"floor1","zone_name":"Stage","reported_at":1}"""))
        assertEquals("Last confirmed", locationDisplay(OperationsState(snapshot = snapshot, live = false)).detail)
        assertEquals("Confirmed", locationDisplay(OperationsState(snapshot = snapshot, live = true)).detail)
    }
}
