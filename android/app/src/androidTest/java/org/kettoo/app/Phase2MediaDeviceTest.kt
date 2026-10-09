package org.kettoo.app

import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import io.livekit.android.events.RoomEvent
import io.livekit.android.events.collect
import io.livekit.android.room.track.RemoteAudioTrack
import kotlinx.coroutines.*
import livekit.org.webrtc.AudioTrackSink
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.nio.ByteOrder
import java.util.concurrent.atomic.AtomicInteger

/** Receives generated test audio; never starts microphone or camera capture. */
@RunWith(AndroidJUnit4::class)
class Phase2MediaDeviceTest {
 @Test fun audienceAndReceive()=runBlocking {
  val instrumentation=InstrumentationRegistry.getInstrumentation()
  val args=InstrumentationRegistry.getArguments()
  val app=instrumentation.targetContext.applicationContext as KettooApplication
  val device=UiDevice.getInstance(instrumentation)
  device.wakeUp()
  val scenario=ActivityScenario.launch(MainActivity::class.java)
  scenario.onActivity{it.window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)}
  val frames=AtomicInteger();val nonSilent=AtomicInteger()
  val sink=AudioTrackSink{data,bits,_,_,_,_->if(bits==16){frames.incrementAndGet();val pcm=data.duplicate().order(ByteOrder.LITTLE_ENDIAN);var heard=false;while(pcm.remaining()>=2)if(kotlin.math.abs(pcm.short.toInt())>50)heard=true;if(heard)nonSilent.incrementAndGet()}}
  val tracks=mutableListOf<RemoteAudioTrack>()
  val watchers=mutableListOf<Job>()
  fun report(text:String)=instrumentation.sendStatus(2,android.os.Bundle().apply{putString("stream","\nKETTOO_PHASE2_MEDIA_$text\n")})
  try {
   withTimeout(30000){while(true){try{app.login(args.getString("server")!!,args.getString("email")!!,args.getString("password")!!);break}catch(e:IllegalStateException){if(e.message?.contains("awaits administrator approval")!=true)throw e;report("AWAITING_APPROVAL");delay(500)}}}
   withTimeout(20000){while(!app.state.value.connected)delay(100)}
   instrumentation.runOnMainSync{app.duty(true);app.media.audioRouting.speaker()}
   app.operations.refresh()
   val team=app.operations.state.value.snapshot!!.getJSONObject("team")
   withTimeout(30000){while(team.getString("channel_id") !in app.state.value.mediaRooms)delay(100)}
   if(args.getString("exchange")=="true")app.operations.talkAdmin()
   val cid=if(args.getString("exchange")=="true")app.operations.state.value.snapshot!!.getJSONObject("exchange").getString("conversation_id") else args.getString("channel")!!
   val allowed=args.getString("allowed")!="false"
   if(allowed){withTimeout(30000){while(cid !in app.state.value.mediaRooms)delay(100)}}else{
    try{app.api.objectCall("/conversations/$cid/media-token",json());fail("Excluded device received a media grant")}catch(e:ApiFailure){assertTrue(e.status==403||e.status==404)}
    assertFalse(cid in app.state.value.mediaRooms)
   }
   val rooms=withContext(Dispatchers.Main){app.media.rooms.toMap()}
   for((_,room) in rooms){
    watchers+=launch{room.events.collect{e->if(e is RoomEvent.TrackSubscribed)(e.track as? RemoteAudioTrack)?.let{tracks.add(it);it.addSink(sink)}}}
    room.remoteParticipants.values.forEach{p->p.trackPublications.values.forEach{pub->(pub.track as? RemoteAudioTrack)?.let{tracks.add(it);it.addSink(sink)}}}
   }
   delay(250)
   if(args.getString("screenOff")=="true"){device.sleep();assertFalse(device.isScreenOn)}
   report("READY channel=$cid allowed=$allowed team=${team.getString("name")}")
   delay(30000)
   if(allowed)assertTrue("Selected phone did not decode generated audio: ${app.state.value.error}",nonSilent.get()>100)
   else{assertEquals("Excluded phone decoded audio",0,nonSilent.get());assertFalse(cid in app.state.value.mediaRooms)}
   report("PASSED frames=${frames.get()} nonSilent=${nonSilent.get()} allowed=$allowed")
  }finally{
   watchers.forEach{it.cancelAndJoin()};tracks.forEach{runCatching{it.removeSink(sink)}}
   device.wakeUp();instrumentation.runOnMainSync{app.duty(false)};scenario.close()
  }
 }
}
