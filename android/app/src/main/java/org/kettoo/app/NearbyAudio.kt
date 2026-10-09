package org.kettoo.app

import android.media.*
import android.util.Log
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import org.json.JSONObject
import java.io.*
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.UUID
import java.util.concurrent.atomic.AtomicLong

/** Each audible receiver reserves its floor before a sender can open the microphone. */
class NearbyAudio(private val app:KettooApplication,private val link:NearbyLink) {
    private data class Outgoing(val id:String,val cid:String,val created:Long,val credential:String,val targets:Set<String>,val quorum:NearbyQuorum=NearbyQuorum(targets),val accepted:CompletableDeferred<Unit> = CompletableDeferred(),val begun:CompletableDeferred<Unit> = CompletableDeferred(),var active:Boolean=false)
    private data class Incoming(val endpoint:String,val id:String,val cid:String,val created:Long,val started:Long=System.currentTimeMillis(),var renewed:Long=System.currentTimeMillis(),var active:Boolean=false,var stream:Long?=null)
    private data class Pipe(val input:PipedInputStream,val output:PipedOutputStream,val frames:Channel<ByteArray>,var job:Job?=null)
    private var outgoing:Outgoing?=null
    private var incoming:Incoming?=null
    private var record:AudioRecord?=null
    private var captureJob:Job?=null
    private var receiveJob:Job?=null
    private var watchdog:Job?=null
    private var route:io.livekit.android.audio.AudioHandler?=null
    private var playback:AudioTrack?=null
    private var playbackInput:InputStream?=null
    private val pipes=mutableListOf<Pipe>()
    private val streamIds=mutableSetOf<Long>()
    private val pendingStreams=mutableMapOf<Long,Pair<String,InputStream>>()
    private val streamCommands=mutableMapOf<Long,Pair<String,JSONObject>>()
    val receivedBytes=AtomicLong()
    val nonSilentSamples=AtomicLong()
    val playedSamples=AtomicLong()
    val occupied get()=outgoing!=null||incoming!=null
    val transmitting get()=outgoing?.active==true
    val transmissionConversation get()=outgoing?.cid
    val transmissionMessage get()=outgoing?.id
    fun ownsStream(id:Long)=id in streamIds
    suspend fun press(cid:String){
        check(!occupied);val targets=link.livePeers(cid);check(targets.isNotEmpty()){ "No Nearby teammates can receive this channel" }
        val o=Outgoing(UUID.randomUUID().toString(),cid,System.currentTimeMillis(),app.vault.get("credential"),targets);outgoing=o
        app.patch{it.copy(ptt="REQUESTING")};app.media.route()
        try{
            for(id in targets)link.control(id,json("type" to "ptt.request","id" to o.id,"cid" to cid,"createdAt" to o.created))
            withTimeout(3000){o.accepted.await()};check(outgoing===o)
            for(id in targets)link.control(id,json("type" to "ptt.begin","id" to o.id,"cid" to cid))
            withTimeout(2000){o.begun.await()};check(outgoing===o)
            startMicrophone(o)
        }catch(e:Exception){if(outgoing===o)release();throw e}
    }
    private suspend fun startMicrophone(o:Outgoing){
        val minimum=AudioRecord.getMinBufferSize(16000,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT);check(minimum>0)
        @Suppress("MissingPermission") val r=AudioRecord(MediaRecorder.AudioSource.VOICE_COMMUNICATION,16000,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT,maxOf(minimum*2,6400))
        record=r;check(r.state==AudioRecord.STATE_INITIALIZED){"Nearby microphone unavailable"}
        route=app.media.audioRouting.client().also{it.start()}
        for(id in o.targets){val input=PipedInputStream(65536);val output=PipedOutputStream(input);val p=Pipe(input,output,Channel(32));pipes.add(p);p.job=app.scope.launch(Dispatchers.IO){try{for(frame in p.frames){p.output.write(frame);p.output.flush()}}catch(_:IOException){}finally{runCatching{p.output.close()}}};streamIds.add(link.stream(id,o.id,o.cid,input))}
        check(outgoing===o);r.startRecording();check(r.recordingState==AudioRecord.RECORDSTATE_RECORDING);o.active=true
        app.patch{it.copy(ptt="TRANSMITTING")};Log.i("KettooNearby","TX_STARTED peers=${o.targets.size}")
        val activePipes=pipes.toList()
        captureJob=app.scope.launch(Dispatchers.IO){val bytes=ByteArrayOutputStream();val buffer=ByteArray(640);try{while(isActive&&bytes.size()<960000){val n=r.read(buffer,0,buffer.size);if(n<=0)break;val frame=buffer.copyOf(n);bytes.write(frame);if(activePipes.any{it.frames.trySend(frame).isFailure}){withContext(Dispatchers.Main){app.error(Exception("Nearby audio connection is too slow; transmission stopped"));release()};break}}}catch(e:Exception){if(isActive)Log.w("KettooNearby","Microphone read failed",e)}finally{withContext(NonCancellable){withContext(Dispatchers.Main){if(outgoing===o)release()};if(bytes.size()>0){val f=File(app.filesDir,"attachments/${o.id}.wav");writeWav(f,bytes.toByteArray());withContext(Dispatchers.Main){runCatching{link.saveLive(o.id,o.cid,o.created,o.credential,f)}.onFailure(app::error)};Log.i("KettooNearby","REPLAY_SAVED bytes=${f.length()}")}}}}
        watchdog=app.scope.launch{while(outgoing===o){delay(2000);if(System.currentTimeMillis()-o.created>=30000||o.targets.any{!link.livePermission(it,o.cid,false)}){release();break};o.targets.forEach{link.sendControl(it,json("type" to "ptt.renew","id" to o.id,"cid" to o.cid))}}}
    }
    fun release(){val o=outgoing ?: return;outgoing=null;o.accepted.completeExceptionally(CancellationException("TALK released"));o.begun.completeExceptionally(CancellationException("TALK released"));watchdog?.cancel();watchdog=null
        o.targets.forEach{link.sendControl(it,json("type" to "ptt.end","id" to o.id,"cid" to o.cid))}
        captureJob?.cancel();captureJob=null;record?.let{runCatching{it.stop()};it.release()};record=null
        pipes.forEach{it.frames.close();runCatching{it.input.close()};runCatching{it.output.close()};it.job?.cancel()};pipes.clear();route?.stop();route=null
        app.patch{it.copy(ptt="STANDBY")};app.media.route();Log.i("KettooNearby","TX_STOPPED")
    }
    suspend fun handle(id:String,b:JSONObject){val mid=b.getString("id");UUID.fromString(mid);val cid=b.getString("cid");when(b.getString("type")){
        "ptt.request"->{
            if(!app.state.value.duty||!link.livePermission(id,cid,true)){reply(id,"busy",mid,cid);return}
            val created=b.getLong("createdAt");if(kotlin.math.abs(System.currentTimeMillis()-created)>60000){reply(id,"busy",mid,cid);return}
            val o=outgoing;val r=incoming
            if(o!=null){if(NearbyFloorPolicy.preempts(app.vault.get("device"),link.remoteDevice(id),o.active,link.priority(o.cid),link.priority(cid)))app.media.release()else{reply(id,"busy",mid,cid);return}}
            if(r!=null&&!(r.endpoint==id&&r.id==mid)){if(NearbyFloorPolicy.preempts(link.remoteDevice(r.endpoint),link.remoteDevice(id),r.active,link.priority(r.cid),link.priority(cid))){reply(r.endpoint,"busy",r.id,r.cid);endIncoming()}else{reply(id,"busy",mid,cid);return}}
            if(app.media.occupied||app.media.requestingServer||app.state.value.call?.optString("state") in listOf("ringing","accepted")){reply(id,"busy",mid,cid);return}
            incoming=Incoming(id,mid,cid,created);reply(id,"grant",mid,cid);startReceiveWatchdog()
        }
        "ptt.grant"->{val o=outgoing ?: return;if(o.id==mid&&o.cid==cid&&id in o.targets){if(o.quorum.grant(id))o.accepted.complete(Unit)}}
        "ptt.busy"->{val o=outgoing;if(o?.id==mid&&id in o.targets){app.error(Exception("A Nearby teammate is busy; try TALK again"));release()}}
        "ptt.begin"->{val r=incoming;if(r?.endpoint!=id||r.id!=mid||r.cid!=cid||!link.livePermission(id,cid,true)){reply(id,"busy",mid,cid);return};r.active=true;r.renewed=System.currentTimeMillis();app.media.stopPlayback();app.speech.stopDictation();app.patch{it.copy(incoming=json("conversation" to cid,"message" to mid,"speakerName" to link.remoteName(id),"nearby" to true))};app.media.route();link.placeholder(id,mid,cid,r.created);reply(id,"ready",mid,cid);DutyService.update(app,"${link.remoteName(id)} speaking · Nearby")}
        "ptt.ready"->{val o=outgoing ?: return;if(o.id==mid&&o.cid==cid&&id in o.targets){if(o.quorum.ready(id))o.begun.complete(Unit)}}
        "ptt.renew"->{incoming?.takeIf{it.endpoint==id&&it.id==mid&&it.cid==cid}?.renewed=System.currentTimeMillis()}
        "ptt.end"->{if(incoming?.endpoint==id&&incoming?.id==mid)endIncoming()}
        "ptt.stream"->{require(streamCommands.size<8);val pid=b.getLong("payloadId");streamIds.add(pid);streamCommands[pid]=id to b;matchStream(pid);app.scope.launch{delay(3000);streamCommands.remove(pid);pendingStreams.remove(pid)?.second?.close()}}
        else->error("Unknown Nearby audio command")
    }}
    private fun reply(endpoint:String,type:String,id:String,cid:String)=link.sendControl(endpoint,json("type" to "ptt.$type","id" to id,"cid" to cid))
    private fun startReceiveWatchdog(){watchdog?.cancel();watchdog=app.scope.launch{while(incoming!=null){delay(500);val r=incoming ?: break;if(System.currentTimeMillis()-r.renewed>6000||System.currentTimeMillis()-r.started>=30000||!link.livePermission(r.endpoint,r.cid,true)){endIncoming();break}}}}
    fun streamReceived(id:String,pid:Long,input:InputStream){streamIds.add(pid);if(pendingStreams.size>=2){input.close();return};pendingStreams[pid]=id to input;matchStream(pid);app.scope.launch{delay(3000);pendingStreams.remove(pid)?.second?.close();streamCommands.remove(pid)}}
    private fun matchStream(pid:Long){val pair=pendingStreams[pid] ?: return;val command=streamCommands[pid] ?: return;pendingStreams.remove(pid);streamCommands.remove(pid);val r=incoming;val b=command.second;if(r==null||!r.active||r.endpoint!=pair.first||r.endpoint!=command.first||r.id!=b.getString("id")||r.cid!=b.getString("cid")||r.stream!=null){pair.second.close();return};r.stream=pid;playbackInput=pair.second
        receivedBytes.set(0);nonSilentSamples.set(0);playedSamples.set(0)
        route=app.media.audioRouting.client().also{it.start()}
        receiveJob=app.scope.launch(Dispatchers.IO){val minimum=AudioTrack.getMinBufferSize(16000,AudioFormat.CHANNEL_OUT_MONO,AudioFormat.ENCODING_PCM_16BIT);val track=AudioTrack.Builder().setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build()).setAudioFormat(AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(16000).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build()).setBufferSizeInBytes(maxOf(minimum,6400)).setTransferMode(AudioTrack.MODE_STREAM).build();playback=track;val input=pair.second;val buffer=ByteArray(1280);var carry=0
            try{track.play();while(isActive){val n=input.read(buffer,carry,buffer.size-carry);if(n<0)break;val total=n+carry;val even=total-total%2;receivedBytes.addAndGet(n.toLong());var peaks=0;for(i in 0 until even step 2){val sample=((buffer[i].toInt() and 255)or(buffer[i+1].toInt() shl 8)).toShort().toInt();if(kotlin.math.abs(sample)>50)peaks++};nonSilentSamples.addAndGet(peaks.toLong());var written=0;while(written<even&&isActive){val count=track.write(buffer,written,even-written);if(count<0)throw IOException("Nearby audio playback failed");written+=count;playedSamples.addAndGet(count/2L)};carry=total%2;if(carry==1)buffer[0]=buffer[even]}}catch(e:Exception){if(isActive)Log.w("KettooNearby","RX failed",e)}finally{runCatching{input.close()};runCatching{track.stop()};track.release();withContext(NonCancellable+Dispatchers.Main){if(incoming===r)endIncoming();if(playback===track)playback=null};Log.i("KettooNearby","RX_STOPPED bytes=${receivedBytes.get()} nonSilent=${nonSilentSamples.get()} played=${playedSamples.get()}")}}
    }
    private fun endIncoming(){val r=incoming ?: return;incoming=null;watchdog?.cancel();watchdog=null;runCatching{playbackInput?.close()};playbackInput=null;receiveJob?.cancel();receiveJob=null;route?.stop();route=null;app.patch{if(it.incoming?.optString("message")==r.id)it.copy(incoming=null)else it};app.media.route();DutyService.update(app,"On duty · listening")}
    fun disconnected(id:String){if(outgoing?.targets?.contains(id)==true)release();if(incoming?.endpoint==id)endIncoming();pendingStreams.filterValues{it.first==id}.keys.toList().forEach{pendingStreams.remove(it)?.second?.close();streamCommands.remove(it)}}
    fun stopAll(){release();endIncoming();pendingStreams.values.forEach{runCatching{it.second.close()}};pendingStreams.clear();streamCommands.clear();streamIds.clear()}
    private fun writeWav(file:File,pcm:ByteArray){val h=ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN).put("RIFF".toByteArray()).putInt(36+pcm.size).put("WAVEfmt ".toByteArray()).putInt(16).putShort(1).putShort(1).putInt(16000).putInt(32000).putShort(2).putShort(16).put("data".toByteArray()).putInt(pcm.size);file.parentFile?.mkdirs();file.outputStream().use{it.write(h.array());it.write(pcm)}}
}
