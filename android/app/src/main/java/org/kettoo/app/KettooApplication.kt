package org.kettoo.app

import android.app.Application
import android.content.Intent
import androidx.core.content.ContextCompat
import androidx.room.Room
import io.livekit.android.room.track.VideoTrack
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import okhttp3.*
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID

data class AppState(
    val user: JSONObject? = null, val connected: Boolean = false, val duty: Boolean = false,
    val conversations: List<JSONObject> = emptyList(), val people: List<JSONObject> = emptyList(),
    val selected: String = "", val mediaRooms: Set<String> = emptySet(), val ptt: String = "STANDBY",
    val recording: Boolean = false, val incoming: JSONObject? = null, val call: JSONObject? = null,
    val localVideo: VideoTrack? = null, val remoteVideo: VideoTrack? = null,
    val error: String = "", val conserve: Boolean = false, val peers: Map<String,String> = emptyMap(),
    val nearbyStatus: String = "OFF", val authenticatedPeer: String? = null
    , val audioOutputs: List<String> = emptyList(), val audioOutput: String = "Not active"
)
class KettooApplication : Application() {
    var inForeground = false
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    val state = MutableStateFlow(AppState())
    lateinit var vault: Vault; lateinit var api: Api; lateinit var dao: MessageDao
    lateinit var media: MediaCoordinator; lateinit var nearby: NearbyLink
    private var socket: WebSocket? = null
    private var connectionJob: Job? = null
    private var lastHeartbeat = 0L
    private val flushing = Mutex()
    private val roomSync = Mutex()
    override fun onCreate() {
        super.onCreate(); vault = Vault(this); api = Api(vault)
        dao = Room.databaseBuilder(this,LocalDatabase::class.java,"kettoo.sqlite").build().messages()
        media = MediaCoordinator(this); nearby = NearbyLink(this)
        File(filesDir,"attachments").mkdirs()
        val saved = vault.get("user")
        if(saved.isNotEmpty()) { patch { it.copy(user = JSONObject(saved)) }; scope.launch { dao.cached("channels."+JSONObject(saved).getString("id"))?.let { c -> val channels = JSONArray(c).objects(); patch { it.copy(conversations = channels,selected = channels.firstOrNull()?.getString("id") ?: "") } }; connect() } }
    }
    fun patch(block: (AppState)->AppState) { state.update(block) }
    fun error(e: Throwable) { patch { it.copy(error = e.message ?: "Operation failed") } }
    fun run(block: suspend ()->Unit) { scope.launch { try { block() } catch(e:CancellationException) { throw e } catch(e:Exception) { error(e) } } }
    suspend fun login(server: String, email: String, password: String, name: String? = null) {
        require(server.startsWith("https://")) { "Use the organisation’s trusted HTTPS address" }
        val oldServer = vault.get("server")
        if(oldServer.isNotEmpty() && oldServer != server.trimEnd('/')) { vault.clearSession(); vault.put("device",""); vault.put("issuer","") }
        vault.put("server",server.trimEnd('/'))
        val deviceKey="device."+server.trimEnd('/').lowercase()+"."+email.lowercase()
        val publicKey = nearby.keys.publicKey()
        if(name != null) {
            val r = api.objectCall("/register",json("name" to name,"email" to email,"password" to password,"deviceName" to android.os.Build.MODEL,"publicKey" to publicKey))
            vault.put("device",r.getString("deviceId")); vault.put(deviceKey,r.getString("deviceId")); error(Exception("Request submitted. An admin must approve your account and device.")); return
        }
        val r = api.objectCall("/login",json("email" to email,"password" to password,"deviceName" to android.os.Build.MODEL,"deviceId" to vault.get(deviceKey).ifBlank { null },"publicKey" to publicKey))
        vault.put("device",r.getString("deviceId")); vault.put(deviceKey,r.getString("deviceId")); check(!r.optBoolean("pending")) { "This device awaits administrator approval" }
        vault.put("token",r.getString("token")); val user = r.getJSONObject("user"); vault.put("user",user.toString()); patch { it.copy(user = user,error = "") }
        refresh(); connect()
    }
    suspend fun refresh() {
        val raw = api.call("/conversations"); val channels = JSONArray(raw).objects(); dao.cache(Cache("channels."+state.value.user!!.getString("id"),raw))
        val people = JSONArray(api.call("/people")).objects()
        patch { it.copy(conversations = channels,people = people,selected = it.selected.takeIf { s -> channels.any { c -> c.getString("id")==s } } ?: channels.firstOrNull()?.getString("id") ?: "") }
        for(c in channels) history(c.getString("id"))
        runCatching { val offline = api.objectCall("/offline/credential",json()); vault.put("credential",offline.getString("credential")); vault.put("issuer",offline.getString("issuerPublicKey")) }
        if(state.value.duty) roomSync.withLock { media.connect(channels.map { it.getString("id") }) }
    }
    suspend fun history(cid: String) {
        var after = 0L
        do { val r = api.objectCall("/conversations/$cid/messages?after=$after&limit=200"); val messages = r.getJSONArray("messages").objects(); for(m in messages) receive(m); after = messages.lastOrNull()?.getLong("seq") ?: after } while(r.getBoolean("hasMore"))
    }
    suspend fun receive(m: JSONObject) {
        val owner = state.value.user?.getString("id") ?: return
        val old = dao.find(m.getString("id")); val attachment = m.optString("attachment_id").takeUnless { it == "null" } ?: ""
        val receipts = m.optJSONArray("receipts")?.objects() ?: emptyList()
        val delivery = if(receipts.any { it.optString("state")=="acknowledged" }) "acknowledged" else if(receipts.any { it.optString("user_id") != m.getString("sender_id") }) "recipient-received" else "server-received"
        dao.save(LocalMessage(m.getString("id"),owner,m.getString("conversation_id"),m.getString("sender_id"),m.getString("kind"),m.optString("text").takeUnless { it=="null" } ?: "",m.getLong("created_at"),delivery,old?.filePath ?: "",old?.mime ?: "",attachment,json = m.toString()))
        if(m.getString("sender_id")!=owner && receipts.none { it.getString("user_id")==owner }) runCatching { api.objectCall("/messages/${m.getString("id")}/receipt",json("state" to "received")) }
    }
    private fun connect() {
        connectionJob?.cancel(); socket?.close(1000,"Reconnect")
        connectionJob = scope.launch {
            while(isActive && vault.get("token").isNotBlank()) {
                try {
                    val ticket = api.objectCall("/ws-ticket",json()).getString("ticket")
                    val closed = CompletableDeferred<Unit>()
                    val request = Request.Builder().url(api.base.replaceFirst("https://","wss://")+"/api/events?ticket="+ticket).build()
                    socket = api.http.newWebSocket(request,object:WebSocketListener(){
                        override fun onOpen(webSocket:WebSocket,response:Response) { scope.launch { patch { it.copy(connected=true) }; lastHeartbeat=System.currentTimeMillis(); heartbeat(); runCatching { refresh(); flush() }.onFailure(::error) } }
                        override fun onMessage(webSocket:WebSocket,text:String) { scope.launch { runCatching { event(JSONObject(text)) }.onFailure(::error) } }
                        override fun onFailure(webSocket:WebSocket,t:Throwable,response:Response?) { closed.complete(Unit) }
                        override fun onClosed(webSocket:WebSocket,code:Int,reason:String) { closed.complete(Unit) }
                    })
                    while(!closed.isCompleted) { delay(10000); if(System.currentTimeMillis()-lastHeartbeat>30000) { socket?.cancel(); break }; heartbeat(); flush(); if(state.value.duty) roomSync.withLock { media.connect(state.value.conversations.map { it.getString("id") }) } }
                } catch(e:Exception) { if(e is CancellationException) throw e }
                patch { it.copy(connected=false) }; media.release(); delay(3000)
            }
        }
    }
    fun heartbeat() { socket?.send(json("type" to "heartbeat","onDuty" to state.value.duty,"rooms" to JSONArray(media.connectedRooms.toList())).toString()) }
    private suspend fun event(e:JSONObject) {
        val p = e.optJSONObject("payload") ?: json()
        when(e.getString("type")) {
            "heartbeat" -> lastHeartbeat=System.currentTimeMillis()
            "message" -> receive(p)
            "permissions" -> refresh()
            "ptt.started" -> { api.pauseUploads(); patch { it.copy(incoming=p) }; media.incoming(p.getString("conversation"),true); DutyService.update(this,"${p.optString("speakerName")} speaking · ${state.value.conversations.find { it.getString("id")==p.getString("conversation") }?.optString("name") ?: "Channel"}") }
            "ptt.ended" -> { if(p.optString("device")==vault.get("device"))media.release(); if(state.value.incoming?.optString("message")==p.optString("message")) patch { it.copy(incoming=null) }; media.incoming(p.getString("conversation"),false); DutyService.update(this,"On duty · listening") }
            "call" -> if(listOf(p.optString("caller_device"),p.optString("callee_device")).contains(vault.get("device"))) {
                patch { it.copy(call=p) }
                if(p.getString("state")=="accepted") runCatching { media.joinCall(p) }.onFailure { error(it); runCatching { api.objectCall("/calls/${p.getString("id")}/end",json()) } }
                else if(p.getString("state")!="ringing") media.endCall()
                else DutyService.update(this,"Incoming private call · open Kettoo")
            }
        }
    }
    fun duty(enabled:Boolean) {
        if(enabled) ContextCompat.startForegroundService(this,Intent(this,DutyService::class.java))
        else run { patch { it.copy(duty=false) }; heartbeat(); media.off(); nearby.stop(); stopService(Intent(this,DutyService::class.java)) }
    }
    suspend fun startDuty() { patch { it.copy(duty=true) }; heartbeat(); delay(150); if(state.value.connected) roomSync.withLock { media.connect(state.value.conversations.map { it.getString("id") }) } }
    fun select(cid:String) { patch { it.copy(selected=cid) }; media.route() }
    suspend fun privateChat(uid:String) { val c=api.objectCall("/private",json("userId" to uid)); refresh(); select(c.getString("id")) }
    suspend fun queue(cid:String,kind:String,text:String="",file:File?=null,mime:String="") {
        val uid=state.value.user?.getString("id") ?: return
        val mid=UUID.randomUUID().toString(); val created=System.currentTimeMillis()
        val envelope=json("id" to mid,"conversationId" to cid,"kind" to kind,"text" to text,"createdAt" to created,"sha256" to file?.let { NearbyKeys.hash(it.readBytes()) },"size" to file?.length()).toString()
        val m=LocalMessage(mid,uid,cid,uid,kind,text,created,"queued",file?.absolutePath ?: "",mime,envelope=envelope,signature=nearby.keys.sign(envelope),credential=vault.get("credential"))
        dao.save(m)
        if(state.value.connected) flush() else if(state.value.authenticatedPeer != null && kind in listOf("text","voice")) nearby.send(m)
    }
    suspend fun flush() {
        if(!state.value.connected || media.occupied || state.value.incoming!=null || !flushing.tryLock()) return
        try {
            val uid=state.value.user?.getString("id") ?: return
            for(m in dao.outbox(uid)) {
                if(media.occupied || state.value.incoming!=null) break
                try {
                    if(m.sender!=uid && m.envelope.isNotEmpty()) {
                        var uploaded=m.attachmentId
                        if(m.kind=="voice" && uploaded.isBlank()) { uploaded=api.upload(m.conversation,File(m.filePath),m.mime); dao.save(m.copy(attachmentId=uploaded)) }
                        receive(api.objectCall("/offline/sync",json("credential" to m.credential,"envelope" to m.envelope,"signature" to m.signature,"attachmentId" to uploaded.ifBlank { null })))
                        continue
                    }
                    if(state.value.conserve && m.kind=="video") continue
                    var attachment=m.attachmentId
                    if(m.filePath.isNotEmpty() && attachment.isEmpty()) { attachment=api.upload(m.conversation,File(m.filePath),m.mime); dao.save(m.copy(attachmentId=attachment)) }
                    receive(api.objectCall("/conversations/${m.conversation}/messages",json("id" to m.id,"text" to m.text,"kind" to m.kind,"attachmentId" to attachment.ifBlank { null },"createdAt" to m.createdAt,"delayed" to (System.currentTimeMillis()-m.createdAt>30000))))
                } catch(e:Exception) { error(e); break }
            }
        } finally { flushing.unlock() }
    }
    suspend fun logout() { runCatching { api.objectCall("/logout",json()) }; media.off(); nearby.stop(); connectionJob?.cancel(); socket?.close(1000,"Signed out"); vault.clearSession(); patch { AppState() }; stopService(Intent(this,DutyService::class.java)) }
}
