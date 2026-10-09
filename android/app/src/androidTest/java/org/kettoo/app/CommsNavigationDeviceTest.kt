package org.kettoo.app

import android.content.Intent
import android.app.Activity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry
import androidx.test.runner.lifecycle.Stage
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** UI navigation only. Never presses TALK, records, calls, sends or changes duty. */
@RunWith(AndroidJUnit4::class)
class CommsNavigationDeviceTest {
    @Test fun reviewedNavigationKeepsChannelsLogsAndSettingsReachable() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val device = UiDevice.getInstance(instrumentation)
        val app = context.applicationContext as KettooApplication
        val originalRecipient = app.state.value.selected
        try {
        context.startActivity(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        assertTrue("An existing signed-in phone is required for this review", device.wait(Until.hasObject(By.text("COMMS")), 10000))
        val threads = device.findObject(By.text("THREADS"))
        val comms = device.findObject(By.text("COMMS"))
        val people = device.findObject(By.text("PEOPLE"))
        assertTrue(threads.visibleBounds.centerX() < comms.visibleBounds.centerX())
        assertTrue(comms.visibleBounds.centerX() < people.visibleBounds.centerX())
        assertTrue("Comms is centered", kotlin.math.abs(comms.visibleBounds.centerX() - device.displayWidth / 2) < 24)
        assertFalse(device.hasObject(By.text("SECURE")))
        assertNotNull(device.findObject(By.desc("Kettoo")))

        comms.click()
        assertTrue(device.wait(Until.hasObject(By.text("Live Voice")), 5000))
        device.findObject(By.text("Live Voice")).click()
        assertTrue(device.wait(Until.hasObject(By.text("Speak after TRANSMITTING appears · Max 30 seconds")), 5000))
        assertTrue(device.hasObject(By.descContains("Hold to talk to")))
        assertFalse(device.hasObject(By.text("VOICE SESSION")))
        assertFalse(device.hasObject(By.text("Team PTT")))

        device.findObject(By.text("Change")).click()
        assertTrue(device.wait(Until.hasObject(By.text("Channels & people")), 5000))
        val channel = app.state.value.conversations.firstOrNull { it.optString("kind") != "private" }
        if (channel != null) {
            assertTrue(device.wait(Until.hasObject(By.text(channel.getString("name"))), 5000))
            device.findObject(By.text(channel.getString("name"))).click()
            assertTrue(device.wait(Until.hasObject(By.text("Live Voice")), 5000))
            assertTrue(device.hasObject(By.text(channel.getString("name"))))
        } else device.findObject(By.text("COMMS")).click()

        device.findObject(By.text("Message Log")).click()
        assertTrue(device.wait(Until.hasObject(By.text("Inbox")), 5000))
        assertTrue(device.hasObject(By.textStartsWith("My archive")))
        if (channel != null && channel.optString("kind") != "private") {
            assertFalse(device.hasObject(By.text("Voice call")))
            assertFalse(device.hasObject(By.text("Video call")))
        }
        device.findObject(By.desc("Settings")).click()
        assertTrue(device.wait(Until.hasObject(By.text("OPERATOR / SESSION")), 5000))
        device.findObject(By.text("THREADS")).click()
        assertTrue(device.wait(Until.hasObject(By.text("Follow through.")), 5000))
        device.findObject(By.text("COMMS")).click()
        assertTrue(device.wait(Until.hasObject(By.text("Live Voice")), 5000))
        device.findObject(By.text("Live Voice")).click()
        } finally {
            instrumentation.runOnMainSync { app.select(originalRecipient) }
        }
    }

    @Test fun keyboardKeepsComposerActionsAboveItsTopEdge() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val app = context.applicationContext as KettooApplication
        val device = UiDevice.getInstance(instrumentation)
        val originalRecipient = app.state.value.selected
        val writable = app.state.value.conversations.firstOrNull { it.optString("kind") != "broadcast" }
        assertNotNull("An existing writable conversation is required", writable)
        try {
            context.startActivity(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            assertTrue(device.wait(Until.hasObject(By.text("COMMS")), 10000))
            instrumentation.runOnMainSync { app.select(writable!!.getString("id")) }
            device.findObject(By.text("COMMS")).click()
            assertTrue(device.wait(Until.hasObject(By.text("Message Log")), 5000))
            device.findObject(By.text("Message Log")).click()
            assertTrue(device.wait(Until.hasObject(By.clazz("android.widget.EditText")), 5000))
            device.findObject(By.clazz("android.widget.EditText")).click()
            assertTrue("The screen must react to keyboard insets", device.wait(Until.gone(By.text("Message Log")), 5000))
            var imeHeight = 0
            instrumentation.runOnMainSync {
                val activity = ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED).first() as Activity
                imeHeight = ViewCompat.getRootWindowInsets(activity.window.decorView)?.getInsets(WindowInsetsCompat.Type.ime())?.bottom ?: 0
            }
            assertTrue("Keyboard must be visible", imeHeight > 0)
            val keyboardTop = device.displayHeight - imeHeight
            listOf("Send message", "Attach photo, video or audio").forEach { name ->
                val bounds = device.findObject(By.desc(name)).visibleBounds
                assertTrue("$name must remain visible", bounds.height() > 0)
                assertTrue("$name must be above the keyboard", bounds.bottom <= keyboardTop)
            }
            val note = device.findObject(By.text("Voice note"))
            assertNotNull(note)
            assertTrue(note.visibleBounds.bottom <= keyboardTop)
        } finally {
            device.pressBack()
            instrumentation.runOnMainSync { app.select(originalRecipient) }
            if (device.hasObject(By.text("Live Voice"))) device.findObject(By.text("Live Voice")).click()
        }
    }
}
