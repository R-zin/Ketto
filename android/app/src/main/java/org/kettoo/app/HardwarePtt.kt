package org.kettoo.app

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.os.*
import android.view.KeyEvent
import android.view.accessibility.AccessibilityEvent
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first

/** Shared input state for foreground keys and the optional accessibility service. */
class HardwarePtt(private val app:KettooApplication){
    var held=false;private set
    private var consumed=false
    private var serial=0L
    private var start:Job?=null
    private var watchdog:Job?=null
    fun target():String{
        val s=app.state.value
        val selected=s.conversations.find{it.optString("id")==s.selected&&it.optBoolean("pttAllowed",true)}
        return selected?.optString("id") ?: app.operations.state.value.snapshot?.optJSONObject("team")?.optString("channel_id") ?: ""
    }
    fun key(event:KeyEvent):Boolean{
        if(event.keyCode!=KeyEvent.KEYCODE_VOLUME_DOWN)return false
        if(event.action==KeyEvent.ACTION_UP&&consumed){consumed=false;val wasHeld=held;cancel();if(wasHeld)pulse(longArrayOf(0,40,40,40));return true}
        val s=app.state.value
        if(!s.hardwarePtt||!s.duty||s.user==null)return false
        if(event.action!=KeyEvent.ACTION_DOWN)return consumed
        if(consumed||event.repeatCount>0)return true
        consumed=true
        val cid=target()
        if(cid.isBlank()||!(s.connected&&cid in s.mediaRooms||app.nearby.canTalk(cid))||s.recording||s.call?.optString("state") in listOf("ringing","accepted")||app.media.transmissionConversation!=null){errorPulse();return true}
        held=true;val token=++serial;val previousError=s.error
        app.media.press(cid)
        start=app.scope.launch{
            try{
                val result=withTimeout(5000){app.state.first{it.ptt=="TRANSMITTING"&&app.media.transmissionConversation==cid||it.error!=previousError&&it.error.isNotBlank()||!it.duty}}
                if(token==serial&&held){if(result.ptt=="TRANSMITTING")pulse(longArrayOf(0,75))else{cancel();errorPulse()}}
            }catch(e:TimeoutCancellationException){if(token==serial){cancel();errorPulse()}}
        }
        watchdog=app.scope.launch{delay(30000);if(token==serial&&held){cancel();errorPulse()}}
        return true
    }
    fun cancel(){val active=held;held=false;serial++;start?.cancel();watchdog?.cancel();if(active)app.media.release()}
    private fun errorPulse()=pulse(longArrayOf(0,300))
    private fun pulse(pattern:LongArray){
        val vibrator=if(Build.VERSION.SDK_INT>=31)(app.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator else @Suppress("DEPRECATION")(app.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator)
        vibrator.vibrate(VibrationEffect.createWaveform(pattern,-1))
    }
}

class VolumePttAccessibilityService:AccessibilityService(){
    private val app get()=application as KettooApplication
    override fun onServiceConnected(){app.patch{it.copy(hardwareAvailable=true)}}
    override fun onKeyEvent(event:KeyEvent):Boolean=app.hardware.key(event)
    override fun onAccessibilityEvent(event:AccessibilityEvent?){}
    override fun onInterrupt(){app.hardware.cancel()}
    override fun onDestroy(){app.hardware.cancel();app.patch{it.copy(hardwareAvailable=false)};super.onDestroy()}
}
