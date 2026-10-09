package org.kettoo.app

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** State regression checks only: no microphone, server writes or cached message changes. */
@RunWith(AndroidJUnit4::class)
class CommsPresentationTest {
    private fun user(role: String = "staff") = JSONObject().put("role", role)
    private fun channel(kind: String = "team", permitted: Boolean = true) =
        JSONObject().put("kind", kind).put("pttAllowed", permitted)
    private fun ready() = AppState(user = user(), connected = true, duty = true, selected = "team", mediaRooms = setOf("team"))

    @Test fun connectedAudioDoesNotMeanReadyWhenOffDuty() {
        val result = talkAvailability(ready().copy(duty = false), channel(), false)
        assertFalse(result.allowed)
        assertEquals("Off duty", result.label)
    }

    @Test fun nearbyKeepsEligibleTeamTalkAvailableDuringEitherOutage() {
        assertTrue(talkAvailability(ready().copy(connected = false, mediaRooms = emptySet()), channel(), true).allowed)
        assertTrue(talkAvailability(ready().copy(mediaRooms = emptySet()), channel(), true).allowed)
        assertFalse(talkAvailability(ready().copy(connected = false), channel(), false).allowed)
    }

    @Test fun nearbyDoesNotBypassDutyOrRecipientPermissions() {
        assertFalse(talkAvailability(ready().copy(duty = false), channel(), true).allowed)
        assertFalse(talkAvailability(ready(), channel("private", false), true).allowed)
    }

    @Test fun staffBroadcastIsReceiveOnlyButAdminCanTalk() {
        val result = talkAvailability(ready(), channel("broadcast"), false)
        assertFalse(result.allowed)
        assertEquals("Receive only", result.label)
        assertTrue(talkAvailability(ready().copy(user = user("admin")), channel("broadcast"), false).allowed)
    }

    @Test fun notesAndAcceptedCallsBlockTheMicrophoneWithUsefulReasons() {
        val note = talkAvailability(ready().copy(recording = true), channel(), false)
        assertFalse(note.allowed)
        assertEquals("Finish your voice note first", note.label)
        val call = talkAvailability(ready().copy(call = JSONObject().put("state", "accepted")), channel(), false)
        assertFalse(call.allowed)
        assertEquals("Finish your call first", call.label)
    }
}
