package org.kettoo.app

import android.content.Context
import android.Manifest
import android.content.pm.PackageManager
import android.media.MediaRecorder
import android.media.MediaPlayer
import android.media.AudioAttributes
import androidx.core.content.ContextCompat
import io.livekit.android.LiveKit
import io.livekit.android.LiveKitOverrides
import io.livekit.android.AudioOptions
import io.livekit.android.events.RoomEvent
import io.livekit.android.room.Room
import io.livekit.android.events.collect
import io.livekit.android.room.track.*
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import livekit.org.webrtc.AudioTrackSink
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.json.JSONObject

/** Owns the single microphone for PTT, calls and recorded notes. */
class MediaCoordinator(private val app: KettooApplication) {
    private val scope = app.scope
    val audioRouting = AudioRouting(app)
    private var player: MediaPlayer? = null
    private var playbackRoute: io.livekit.android.audio.AudioHandler? = null
    private fun newRoom() = LiveKit.create(app, overrides = LiveKitOverrides(audioOptions = AudioOptions(audioHandler = audioRouting.client())))
    val rooms = mutableMapOf<String, Room>()
    var callRoom: Room? = null; private set
    private val gate = Mutex()
    private var wanted = false
    private var lease: JSONObject? = null
    private var track: LocalAudioTrack? = null
    private var capture: PcmReplay? = null
    private var leaseJob: Job? = null
    private var maximumJob: Job? = null
    private var note: MediaRecorder? = null
    private var noteFile: File? = null
    private var noteConversation = ""
    private var noteDeadline: Job? = null
    private var callTrack: LocalAudioTrack? = null
    private var camera: LocalVideoTrack? = null
    private val speakers = linkedSetOf<String>()
    private val priorities = mutableMapOf<String,Int>()
    private val epochs = mutableMapOf<String,String>()
    val connectedRooms get() = rooms.filterValues { it.state == Room.State.CONNECTED }.keys
    val occupied get() = lease != null || note != null || callRoom != null || app.state.value.dictating
    var pressGeneration=0L;private set
    val transmissionConversation get()=lease?.optString("conversation")
    val transmissionMessage get()=lease?.optString("message")

    suspend fun connect(ids: List<String>) {
        for(cid in ids){val epoch=app.state.value.conversations.find{it.optString("id")==cid}?.optString("mediaEpoch","1") ?: "1";if(epochs.containsKey(cid)&&epochs[cid]!=epoch){rooms.remove(cid)?.let{it.disconnect();it.release()};speakers.remove(cid)};epochs[cid]=epoch}
        for(cid in rooms.keys.toList().filter { it !in ids }) { rooms.remove(cid)?.let { it.disconnect(); it.release() };speakers.remove(cid);priorities.remove(cid) }
        for(cid in ids) if(cid !in rooms) runCatching {
            val grant = app.api.objectCall("/conversations/$cid/media-token", json())
            val room = newRoom()
            rooms[cid] = room
            scope.launch { room.events.collect { event ->
                when(event) {
                    is RoomEvent.Connected, is RoomEvent.Reconnected, is RoomEvent.Reconnecting -> { app.patch { it.copy(mediaRooms=connectedRooms.toSet()) }; app.heartbeat() }
                    is RoomEvent.TrackSubscribed -> route((event.track as? RemoteAudioTrack)?.let { cid to it })
                    is RoomEvent.Disconnected -> { if(rooms[cid]===room){rooms.remove(cid);speakers.remove(cid);route();app.patch { it.copy(mediaRooms = connectedRooms.toSet()) }; app.heartbeat()} }
                    else -> Unit
                }
            } }
            room.connect(grant.getString("url"), grant.getString("token"))
            app.patch { it.copy(mediaRooms = connectedRooms.toSet()) }; app.heartbeat()
        }.onFailure { rooms.remove(cid)?.release(); app.error(it) }
    }
    fun incoming(cid: String, active: Boolean,priority:Int=0) { priorities[cid]=priority;if(active) { speakers.add(cid); stopPlayback();app.speech.stopDictation() } else speakers.remove(cid); route() }
    fun reconcile(channels:List<JSONObject>){
        transmissionConversation?.let { cid ->
            val channel=channels.find{it.optString("id")==cid}
            if(channel==null||!channel.optBoolean("pttAllowed",true)||!channel.optBoolean("mediaAllowed",true)||epochs[cid]!=channel.optString("mediaEpoch","1")){
                app.hardware.cancel();release()
            }
        }
        speakers.clear()
        for(c in channels){val speaker=c.optJSONObject("speaker");if(c.optBoolean("mediaAllowed",true)&&speaker!=null&&speaker.optLong("expires")>System.currentTimeMillis()){val cid=c.getString("id");speakers.add(cid);priorities[cid]=c.optInt("priority")}}
        val incoming=channels.filter{it.getString("id") in speakers}.maxByOrNull{it.optInt("priority")}?.optJSONObject("speaker")
        if(incoming!=null){stopPlayback();app.speech.stopDictation()}
        app.patch{it.copy(incoming=incoming)};route()
    }
    fun route(subscribed: Pair<String,RemoteAudioTrack>? = null) {
        val selected=app.state.value.selected
        val broadcast=speakers.filter{(priorities[it] ?: 0)>0}.maxByOrNull{priorities[it] ?: 0}
        val target = broadcast ?: if(selected in speakers) selected else speakers.firstOrNull() ?: selected
        fun apply(cid: String, audio: RemoteAudioTrack) {
            val gain = if(callRoom != null || cid != target) 0.0 else 1.0
            if(gain > 0) audio.start()
            audio.setVolume(gain)
        }
        subscribed?.let { apply(it.first,it.second) }
        rooms.forEach { (cid,room) -> room.remoteParticipants.values.forEach { p -> p.trackPublications.values.forEach { pub -> (pub.track as? RemoteAudioTrack)?.let { apply(cid,it) } } } }
    }
    fun press(cid: String) { if(wanted||lease!=null)return;wanted = true;val generation=++pressGeneration;scope.launch { gate.withLock {
        if(!wanted||generation!=pressGeneration)return@withLock
        try {
            if(app.state.value.dictating)app.speech.finishDictation()
            if(!wanted||generation!=pressGeneration)return@withLock
            check(!occupied){"Microphone is already in use"}
            stopPlayback()
            app.patch { it.copy(ptt = "REQUESTING") }
            app.api.pauseUploads()
            val room = rooms[cid] ?: error("Audio is not connected")
            val l = app.api.objectCall("/conversations/$cid/ptt", json()); lease = l
            if(!wanted||generation!=pressGeneration) { stopLocked(); return@withLock }
            withTimeout(3000) { while(room.localParticipant.permissions?.canPublish != true) delay(30) }
            if(!wanted||generation!=pressGeneration) { stopLocked(); return@withLock }
            val t = room.localParticipant.createAudioTrack("Kettoo PTT"); track = t
            capture = PcmReplay().also { t.addSink(it.sink) }
            check(room.localParticipant.publishAudioTrack(t)) { "Microphone publication failed" }
            if(!wanted||generation!=pressGeneration) { stopLocked(); return@withLock }
            app.patch { it.copy(ptt = "TRANSMITTING") }
            leaseJob = scope.launch { while(isActive) { delay(2000); runCatching { app.api.objectCall("/conversations/$cid/ptt/renew", json("leaseId" to l.getString("leaseId"))) }.onFailure { app.error(Exception("Control lease lost; transmission stopped")); release(); return@launch } } }
            maximumJob = scope.launch { delay((l.getLong("deadline") - System.currentTimeMillis()).coerceAtLeast(1)); release() }
        } catch(e: Exception) { wanted=false;app.error(e); stopLocked() }
    } } }
    fun release() { wanted = false;val generation=++pressGeneration;scope.launch { gate.withLock { if(generation==pressGeneration)stopLocked() } } }
    private suspend fun stopLocked() {
        leaseJob?.cancel(); maximumJob?.cancel()
        val l = lease; lease = null
        val t = track; track = null
        val replay = capture; capture = null
        if(t != null) { replay?.let { t.removeSink(it.sink) }; l?.let { rooms[it.getString("conversation")]?.localParticipant?.unpublishTrack(t) }; t.stop(); t.dispose() }
        if(l != null) runCatching { app.api.objectCall("/conversations/${l.getString("conversation")}/ptt/release", json("leaseId" to l.getString("leaseId"))) }
        app.patch { it.copy(ptt = "STANDBY") }
        if(l != null && replay != null) scope.launch {
            val file = replay.finish(File(app.filesDir,"attachments/${l.getString("message")}.wav")) ?: return@launch
            app.phase3.recorded(l.getString("message"),l.getString("conversation"),file)
        }
    }
    suspend fun startNote(cid: String) = gate.withLock {
        check(!occupied) { "Microphone is already in use" }
        check(app.state.value.call?.optString("state") !in listOf("ringing","accepted")) { "Resolve the incoming call first" }
        stopPlayback()
        val file = File(app.filesDir, "attachments/${java.util.UUID.randomUUID()}.m4a").also { it.parentFile?.mkdirs() }
        @Suppress("DEPRECATION") val recorder = MediaRecorder()
        try {
            recorder.setAudioSource(MediaRecorder.AudioSource.MIC); recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4); recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            recorder.setAudioChannels(1); recorder.setAudioSamplingRate(16000); recorder.setAudioEncodingBitRate(32000); recorder.setMaxDuration(30000); recorder.setMaxFileSize(1024*1024)
            recorder.setOutputFile(file.absolutePath); recorder.prepare(); recorder.start()
            note = recorder; noteFile = file; noteConversation = cid; app.patch { it.copy(recording = true) }
            recorder.setOnInfoListener { _,_,_ -> scope.launch { stopNote() } }
            noteDeadline = scope.launch { delay(30000); stopNote() }
        } catch(e:Exception) { recorder.release(); file.delete(); throw e }
    }
    suspend fun stopNote() = gate.withLock {
        val r = note ?: return@withLock; note = null; noteDeadline?.cancel()
        val file = noteFile; noteFile = null
        val valid = runCatching { r.stop() }.isSuccess; r.release(); app.patch { it.copy(recording = false) }
        if(valid && file != null) app.queue(noteConversation,"voice",file = file,mime = "audio/mp4") else file?.delete()
    }
    suspend fun joinCall(call: JSONObject) = gate.withLock {
        app.speech.finishDictation();app.hardware.cancel()
        stopPlayback()
        app.api.pauseUploads()
        stopLocked(); check(note == null) { "Finish your voice note before accepting" }
        if(callRoom != null) return@withLock
        val grant = app.api.objectCall("/calls/${call.getString("id")}/token",json())
        val room = newRoom(); callRoom = room; route()
        try {
            scope.launch { room.events.collect { event -> if(event is RoomEvent.TrackSubscribed) { (event.track as? RemoteAudioTrack)?.let { it.start(); it.setVolume(1.0) }; if(event.track is VideoTrack) app.patch { it.copy(remoteVideo = event.track as VideoTrack) } } } }
            room.connect(grant.getString("url"),grant.getString("token"))
            callTrack = room.localParticipant.createAudioTrack("Call microphone").also { check(room.localParticipant.publishAudioTrack(it)) }
            if(call.optInt("video") == 1 && app.inForeground) enableCamera(room)
        } catch(e:Exception) { endCall(); throw e }
    }
    fun switchCamera() { camera?.switchCamera() }
    private suspend fun enableCamera(room: Room) {
        check(ContextCompat.checkSelfPermission(app,Manifest.permission.CAMERA)==PackageManager.PERMISSION_GRANTED) { "Camera permission is required for a video call" }
        if(camera==null) { camera=room.localParticipant.createVideoTrack(); camera!!.startCapture(); check(room.localParticipant.publishVideoTrack(camera!!)); app.patch { it.copy(localVideo=camera) } }
        else camera?.startCapture()
    }
    fun visible(enabled: Boolean) { if(!enabled) camera?.stopCapture() else app.run { gate.withLock { val room=callRoom; if(room!=null && app.state.value.call?.optInt("video")==1) enableCamera(room) } } }
    fun endCall() { callTrack?.stop(); callTrack?.dispose(); callTrack = null; camera?.stopCapture(); camera?.dispose(); camera = null; callRoom?.disconnect(); callRoom?.release(); callRoom = null; app.patch { it.copy(remoteVideo = null,localVideo = null) }; route() }
    fun stopPlayback() { player?.release(); player = null; playbackRoute?.stop(); playbackRoute = null }
    fun play(file: File) {
        check(!occupied && speakers.isEmpty()) { "Finish live communication before playback" }
        stopPlayback()
        val handler = audioRouting.client().also { it.start() }; playbackRoute = handler
        val p = MediaPlayer(); player = p
        try {
            p.setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
            p.setDataSource(file.absolutePath); p.prepare(); p.setOnCompletionListener { stopPlayback() }; p.setOnErrorListener { _,_,_ -> stopPlayback(); app.error(Exception("Audio playback failed")); true }; p.start()
        } catch(e: Exception) { stopPlayback(); throw e }
    }
    suspend fun off() { app.speech.finishDictation();app.hardware.cancel();stopPlayback(); wanted = false; speakers.clear(); gate.withLock { stopLocked() }; stopNote(); endCall(); rooms.values.toList().forEach { it.disconnect(); it.release() }; rooms.clear(); app.patch { it.copy(mediaRooms = emptySet()) } }
}

/** Saves the same microphone frames used by WebRTC; never opens another recorder. */
private class PcmReplay {
    private val bytes = ByteArrayOutputStream()
    private var valid = true
    val sink = AudioTrackSink { data,bits,rate,channels,frames,_ -> synchronized(bytes) {
        if(bits != 16 || rate % 16000 != 0 || channels < 1) valid = false
        else if(valid) {
            val input = data.duplicate().order(ByteOrder.LITTLE_ENDIAN)
            val step = rate / 16000
            for(frame in 0 until frames step step) {
                val index = frame * channels * 2
                if(index+1 < input.limit() && bytes.size()<960000) { val sample = input.getShort(index).toInt(); bytes.write(sample and 255); bytes.write((sample shr 8) and 255) }
            }
        }
    } }
    fun finish(file: File): File? = synchronized(bytes) {
        if(!valid || bytes.size()==0) return null
        val pcm = bytes.toByteArray(); val header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
        header.put("RIFF".toByteArray()).putInt(36+pcm.size).put("WAVEfmt ".toByteArray()).putInt(16).putShort(1).putShort(1).putInt(16000).putInt(32000).putShort(2).putShort(16).put("data".toByteArray()).putInt(pcm.size)
        file.parentFile?.mkdirs(); file.outputStream().use { it.write(header.array()); it.write(pcm) }; file
    }
}
