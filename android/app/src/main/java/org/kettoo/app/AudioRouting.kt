package org.kettoo.app

import com.twilio.audioswitch.AudioDevice
import io.livekit.android.audio.AudioHandler
import io.livekit.android.audio.AudioSwitchHandler

/** All rooms share audio focus; disconnecting one room must not tear down another's route. */
class AudioRouting(private val app: KettooApplication) {
    private val switch = AudioSwitchHandler(app)
    private var users = 0
    init {
        switch.registerAudioDeviceChangeListener { available, selected ->
            app.patch { it.copy(audioOutputs = available.map { d -> d.name }, audioOutput = selected?.name ?: "Preparing") }
        }
    }
    fun client(): AudioHandler = object : AudioHandler {
        private var started = false
        override fun start() = synchronized(this@AudioRouting) {
            if (!started) { started = true; if (users++ == 0) switch.start() }
        }
        override fun stop() = synchronized(this@AudioRouting) {
            if (started) { started = false; if (--users == 0) switch.stop() }
        }
    }
    fun select(name: String?) { switch.selectDevice(switch.availableAudioDevices.find { it.name == name }) }
    fun speaker() { switch.selectDevice(switch.availableAudioDevices.firstOrNull { it is AudioDevice.Speakerphone }) }
}
