package org.kettoo.app

import android.Manifest
import android.os.Build
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
import java.net.Socket
import java.net.InetSocketAddress
import android.content.pm.PackageManager
import android.media.*
import androidx.core.content.ContextCompat
import kotlinx.coroutines.flow.first
import java.io.File

/** Real-device acceptance runner. The transmit phase requires explicit microphone-test approval. */
@RunWith(AndroidJUnit4::class)
class DeviceAcceptanceTest {
    @Test fun acceptance() = runBlocking {
        val instrumentation=InstrumentationRegistry.getInstrumentation()
        val arguments=InstrumentationRegistry.getArguments()
        val app=instrumentation.targetContext.applicationContext as KettooApplication
        val email=arguments.getString("email") ?: error("email test argument required")
        val password=arguments.getString("password") ?: error("password test argument required")
        val server=arguments.getString("server") ?: "https://localhost:8443"
        val phase=arguments.getString("phase") ?: "enrol"
        val scenario=ActivityScenario.launch(MainActivity::class.java)
        try {
            delay(1000)
            if(phase=="network") {
                val address=arguments.getString("lan") ?: error("lan address required")
                Socket().use { it.connect(InetSocketAddress(address,7881),4000) }
                instrumentation.sendStatus(2,android.os.Bundle().apply { putString("stream","\nKETTOO_LAN_TCP_REACHABLE\n") })
                return@runBlocking
            }
            if(phase=="enrol") {
                app.login(server,email,password,"Device test ${Build.MODEL}")
                println("KETTOO_ENROLLED device=${app.vault.get("device")} model=${Build.MODEL} sdk=${Build.VERSION.SDK_INT}")
                assertTrue(app.vault.get("device").isNotBlank())
                return@runBlocking
            }
            app.login(server,email,password)
            withTimeout(20000){while(!app.state.value.connected)delay(100)}
            if(phase=="call") {
                val video=arguments.getString("video")=="true"
                if(video) {
                    scenario.onActivity { if(ContextCompat.checkSelfPermission(it,Manifest.permission.CAMERA)!=PackageManager.PERMISSION_GRANTED)it.requestPermissions(arrayOf(Manifest.permission.CAMERA),901) }
                    withTimeout(90000){while(ContextCompat.checkSelfPermission(app,Manifest.permission.CAMERA)!=PackageManager.PERMISSION_GRANTED)delay(100)}
                }
                val cid=app.api.objectCall("/private",json("userId" to arguments.getString("peer"))).getString("id")
                app.refresh();app.select(cid);instrumentation.runOnMainSync { app.duty(true) }
                withTimeout(25000){while(cid !in app.state.value.mediaRooms)delay(100)}
                withTimeout(5000){while(app.state.value.audioOutputs.isEmpty())delay(100)}
                instrumentation.runOnMainSync { app.media.audioRouting.speaker() }
                instrumentation.sendStatus(2,android.os.Bundle().apply { putString("stream","\nKETTOO_CALL_READY video=$video\n") })
                withTimeout(90000){while(app.state.value.call?.optString("state")!="ringing")delay(50)}
                if(app.state.value.call!!.optString("callee_device")==app.vault.get("device")) app.api.objectCall("/calls/${app.state.value.call!!.getString("id")}/accept",json())
                withTimeout(8000){while(app.state.value.call?.optString("state")!="accepted")delay(50)}
                withTimeout(5000){while(app.media.callRoom?.remoteParticipants?.values?.any { p -> p.trackPublications.values.any { it.track is RemoteAudioTrack } }!=true || (video && app.state.value.remoteVideo==null))delay(30)}
                assertTrue("Calls must own microphone access",app.media.occupied)
                instrumentation.sendStatus(2,android.os.Bundle().apply { putString("stream","\nKETTOO_CALL_MEDIA_SUBSCRIBED video=$video\n") })
                withTimeout(10000){while(app.state.value.call?.optString("state")=="accepted")delay(50)}
                withTimeout(5000){while(app.media.callRoom!=null || app.media.occupied)delay(50)}
                assertTrue("Channel listening must remain connected after the call",cid in app.state.value.mediaRooms)
                instrumentation.sendStatus(2,android.os.Bundle().apply { putString("stream","\nKETTOO_CALL_PASSED video=$video listeningRestored=true\n") })
                return@runBlocking
            }
            if(phase=="nearby") {
                val required=buildList { if(Build.VERSION.SDK_INT>=31){add(Manifest.permission.BLUETOOTH_SCAN);add(Manifest.permission.BLUETOOTH_CONNECT);add(Manifest.permission.BLUETOOTH_ADVERTISE)};if(Build.VERSION.SDK_INT>=33)add(Manifest.permission.NEARBY_WIFI_DEVICES)else{add(Manifest.permission.ACCESS_FINE_LOCATION);add(Manifest.permission.ACCESS_COARSE_LOCATION)} }
                scenario.onActivity { activity -> val missing=required.filter { ContextCompat.checkSelfPermission(activity,it)!=PackageManager.PERMISSION_GRANTED };if(missing.isNotEmpty())activity.requestPermissions(missing.toTypedArray(),900) }
                withTimeout(60000){while(required.any { ContextCompat.checkSelfPermission(app,it)!=PackageManager.PERMISSION_GRANTED })delay(200)}
                val cid=arguments.getString("channel") ?: error("channel required")
                app.select(cid)
                instrumentation.sendStatus(2,android.os.Bundle().apply{putString("stream","\nKETTOO_NEARBY_PREPARED\n")})
                withTimeout(90000){while(app.state.value.connected)delay(200)}
                app.nearby.start()
                val sender=arguments.getString("sender")=="true"
                if(sender){withTimeout(40000){while(app.state.value.peers.isEmpty())delay(200)};app.nearby.connect(app.state.value.peers.keys.first())}
                withTimeout(40000){while(app.state.value.authenticatedPeer==null)delay(200)}
                instrumentation.sendStatus(2,android.os.Bundle().apply{putString("stream","\nKETTOO_NEARBY_AUTHENTICATED\n")})
                val owner=app.state.value.user!!.getString("id")
                if(sender){
                    val start=System.currentTimeMillis()
                    app.queue(cid,"text","Nearby acceptance text")
                    val audio=syntheticNote(File(app.filesDir,"attachments/nearby-acceptance.m4a"))
                    app.queue(cid,"voice",file=audio,mime="audio/mp4")
                    withTimeout(40000){while(app.dao.outbox(owner).count { it.createdAt>=start && it.state=="peer-received" }<2)delay(200)}
                }else{
                    withTimeout(40000){app.dao.watch(owner,cid).first { rows -> rows.any { it.text=="Nearby acceptance text"&&it.state=="peer-received" } && rows.any { it.kind=="voice"&&it.state=="peer-received"&&File(it.filePath).exists() } }}
                    val voice=app.dao.watch(owner,cid).first().last { it.kind=="voice"&&it.state=="peer-received" }
                    MediaMetadataRetriever().use { retriever -> retriever.setDataSource(voice.filePath);assertTrue(retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)!!.toLong()>0) }
                }
                instrumentation.sendStatus(2,android.os.Bundle().apply{putString("stream","\nKETTOO_NEARBY_TEXT_AUDIO_PASSED sender=$sender\n")})
                return@runBlocking
            }
            instrumentation.runOnMainSync { app.duty(true) }
            val cid=arguments.getString("channel") ?: "all-staff"
            app.select(cid)
            try { withTimeout(25000){while(cid !in app.state.value.mediaRooms)delay(100)} } catch(e:Exception) { throw AssertionError("Native audio connection failed: ${app.state.value.error}; duty=${app.state.value.duty}; rooms=${app.media.rooms.mapValues { it.value.state }}",e) }
            withTimeout(5000) { while(app.state.value.audioOutputs.isEmpty()) delay(100) }
            instrumentation.runOnMainSync { app.media.audioRouting.speaker() }
            delay(800)
            if(phase=="transmit" || phase=="replay") {
                val previous=app.api.objectCall("/conversations/$cid/messages?after=0&limit=200").getJSONArray("messages").objects().map { it.getString("id") }.toSet()
                if(phase=="transmit") {
                    instrumentation.sendStatus(2,android.os.Bundle().apply{putString("stream","\nKETTOO_MICROPHONE_TEST_STARTING\n")})
                    app.media.press(cid)
                    withTimeout(8000){while(app.state.value.ptt!="TRANSMITTING")delay(50)}
                    delay(3000)
                    app.media.release()
                }
                val owner=app.state.value.user!!.getString("id")
                val recorded=withTimeout(15000){
                    var found:org.json.JSONObject?=null
                    while(found==null){delay(500);found=app.api.objectCall("/conversations/$cid/messages?after=0&limit=200").getJSONArray("messages").objects().lastOrNull { it.optString("kind")=="ptt"&&it.optString("sender_id")==owner&&(if(phase=="replay")it.optString("id")==arguments.getString("messageId")else it.optString("id") !in previous)&&it.optString("attachment_id").let { id->id.isNotBlank()&&id!="null" } }}
                    found
                }
                val file=File(app.filesDir,"attachments/microphone-acceptance.wav")
                app.api.download(recorded.getString("attachment_id"),file)
                val bytes=file.readBytes();assertEquals("RIFF",String(bytes,0,4));assertTrue("Replay must contain roughly three seconds of microphone PCM",bytes.size>64000)
                val pcm=java.nio.ByteBuffer.wrap(bytes,44,bytes.size-44).order(ByteOrder.LITTLE_ENDIAN);var peaks=0;while(pcm.remaining()>=2)if(kotlin.math.abs(pcm.short.toInt())>50)peaks++
                assertTrue("Speak during the capture; the replay must contain non-silent microphone samples",peaks>100)
                app.media.play(file);delay(4000)
                instrumentation.sendStatus(2,android.os.Bundle().apply{putString("stream","\nKETTOO_MICROPHONE_REPLAY_PASSED bytes=${bytes.size} nonSilentSamples=$peaks output=${app.state.value.audioOutput}\n")})
                return@runBlocking
            }
            val frames=AtomicInteger();val audible=AtomicInteger()
            val sink=AudioTrackSink { data,bits,_,_,_,_ -> if(bits==16){frames.incrementAndGet();val pcm=data.duplicate().order(ByteOrder.LITTLE_ENDIAN);var found=false;while(pcm.remaining()>=2){if(kotlin.math.abs(pcm.short.toInt())>50)found=true};if(found)audible.incrementAndGet()} }
            val decode=arguments.getString("decode")!="false"
            val receiver=launch { app.media.rooms[cid]!!.events.collect { e->if(decode && e is RoomEvent.TrackSubscribed)(e.track as? RemoteAudioTrack)?.addSink(sink) } }
            val screenOff=arguments.getString("screenOff")=="true"
            val device=UiDevice.getInstance(instrumentation)
            if(screenOff){device.sleep();delay(600);assertFalse("Screen must be off during receive test",device.isScreenOn)}
            instrumentation.sendStatus(2,android.os.Bundle().apply{putString("stream","\nKETTOO_READY model=${Build.MODEL} sdk=${Build.VERSION.SDK_INT} screenOff=$screenOff\n")})
            try {
                withTimeout(60000){while(if(decode)audible.get()<10 else app.state.value.incoming==null)delay(100)}
                // Keep the receive room alive through actual playout, rather than exiting on first decoded samples.
                delay(12000)
                assertTrue(app.state.value.duty)
                instrumentation.sendStatus(2,android.os.Bundle().apply{putString("stream","\nKETTOO_RECEIVE_PASSED frames=${frames.get()} nonSilent=${audible.get()} screenOff=$screenOff output=${app.state.value.audioOutput}\n")})
            }finally{receiver.cancelAndJoin();if(screenOff)device.wakeUp()}
        } finally { instrumentation.runOnMainSync { app.duty(false) };scenario.close() }
    }

    private fun syntheticNote(file:File):File {
        val codec=MediaCodec.createEncoderByType("audio/mp4a-latm")
        val format=MediaFormat.createAudioFormat("audio/mp4a-latm",16000,1).apply { setInteger(MediaFormat.KEY_AAC_PROFILE,MediaCodecInfo.CodecProfileLevel.AACObjectLC);setInteger(MediaFormat.KEY_BIT_RATE,32000);setInteger(MediaFormat.KEY_MAX_INPUT_SIZE,2048) }
        val muxer=MediaMuxer(file.absolutePath,MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
        codec.configure(format,null,null,MediaCodec.CONFIGURE_FLAG_ENCODE);codec.start()
        var samples=0;var ending=false;var finished=false;var track=-1
        val info=MediaCodec.BufferInfo()
        try{while(!finished){
            if(!ending){val index=codec.dequeueInputBuffer(10000);if(index>=0){val input=codec.getInputBuffer(index)!!;input.clear();input.order(ByteOrder.LITTLE_ENDIAN);val count=minOf(input.remaining()/2,16000-samples);for(i in 0 until count)input.putShort((6500*kotlin.math.sin(2*Math.PI*440*(samples+i)/16000)).toInt().toShort());val pts=samples*1000000L/16000;samples+=count;ending=samples>=16000;codec.queueInputBuffer(index,0,count*2,pts,if(ending)MediaCodec.BUFFER_FLAG_END_OF_STREAM else 0)}}
            val output=codec.dequeueOutputBuffer(info,10000)
            if(output==MediaCodec.INFO_OUTPUT_FORMAT_CHANGED){track=muxer.addTrack(codec.outputFormat);muxer.start()}
            else if(output>=0){val buffer=codec.getOutputBuffer(output)!!;if(info.size>0 && info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG==0){buffer.position(info.offset);buffer.limit(info.offset+info.size);muxer.writeSampleData(track,buffer,info)};finished=info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM!=0;codec.releaseOutputBuffer(output,false)}
        }}finally{codec.stop();codec.release();if(track>=0)muxer.stop();muxer.release()}
        return file
    }
}
