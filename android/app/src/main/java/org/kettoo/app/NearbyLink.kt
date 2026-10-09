package org.kettoo.app

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.google.android.gms.nearby.Nearby
import com.google.android.gms.nearby.connection.*
import kotlinx.coroutines.*
import kotlinx.coroutines.tasks.await
import org.json.JSONObject
import java.io.File
import java.security.*
import java.security.spec.ECGenParameterSpec
import java.security.spec.X509EncodedKeySpec
import java.util.UUID
import java.io.InputStream

/** Direct, authenticated M-to-N fallback. Enabling arms discovery; TALK owns capture. */
class NearbyLink(private val app:KettooApplication) {
    val keys=NearbyKeys()
    val audio=NearbyAudio(app,this)
    private val client=Nearby.getConnectionsClient(app)
    private val service="org.kettoo.app.private.v2"
    private data class Peer(val device:String,val nonce:String=UUID.randomUUID().toString(),var claims:JSONObject?=null,var credential:String="",var remoteNonce:String="",var ready:Boolean=false,val started:Long=System.currentTimeMillis(),val metadata:MutableMap<Long,JSONObject> = mutableMapOf(),val files:MutableMap<Long,Payload> = mutableMapOf(),val completed:MutableSet<Long> = mutableSetOf(),val sent:MutableMap<String,Pair<LocalMessage,Long>> = mutableMapOf())
    private val peers=mutableMapOf<String,Peer>()
    private val discovered=mutableMapOf<String,String>()
    private val attempts=mutableMapOf<String,Long>()
    private var running=false
    private var starting=false
    private var owner=""
    private var retryAfter=0L
    private var pump:Job?=null
    var enabled=false;private set
    fun initialize(){enabled=app.vault.get("nearbyEnabled")=="true";app.patch{it.copy(nearbyEnabled=enabled)};pump=app.scope.launch{while(isActive){delay(1500);runCatching{update()}.onFailure{stopRadios();retryAfter=System.currentTimeMillis()+10000;app.patch{s->s.copy(nearbyStatus=it.message ?: "Nearby unavailable")}}}}}
    fun enable(value:Boolean){enabled=value;app.vault.put("nearbyEnabled",value.toString());app.patch{it.copy(nearbyEnabled=value)};if(!value)stopRadios()else app.run{update()}}
    fun start()=enable(true)
    fun stop(){stopRadios()}
    private fun now()=System.currentTimeMillis()
    fun credential(raw:String):JSONObject {
        val parts=raw.split('.');require(parts.size==2){"Reconnect to refresh Nearby permissions"}
        require(NearbyKeys.verify(app.vault.get("issuer"),parts[0],parts[1],"RSA")){"Peer is not signed by this organisation"}
        val claims=JSONObject(String(Base64.decode(parts[0],Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)))
        require(claims.getLong("expiresAt")>now()){ "Nearby permissions expired; reconnect to the server" }
        require(claims.getString("org")==NearbyKeys.hash(app.vault.get("issuer").toByteArray()))
        return claims
    }
    private fun own()=credential(app.vault.get("credential")).also{require(it.getString("device")==app.vault.get("device"))}
    private fun endpointName()="k2|${own().getString("org").take(16)}|${app.vault.get("device") }"
    private fun device(name:String):String? {val parts=name.split('|');return if(parts.size==3&&parts[0]=="k2"&&parts[1]==own().getString("org").take(16)&&runCatching{UUID.fromString(parts[2])}.isSuccess&&parts[2]!=app.vault.get("device"))parts[2]else null}
    private fun fallback():Boolean {val s=app.state.value;return enabled&&s.user!=null&&s.duty&&(!s.connected||s.conversations.any{it.optBoolean("mediaAllowed",true)&&it.getString("id") !in s.mediaRooms})}
    private suspend fun update(){
        if(!fallback()){stopRadios();app.patch{it.copy(nearbyStatus=if(enabled)"ARMED · ${if(it.duty)"SERVER AVAILABLE"else"START DUTY TO CONNECT"}"else"OFF")};return}
        if(now()<retryAfter)return
        own()
        if(!running&&!starting){starting=true;try{owner=app.vault.get("device");client.startAdvertising(endpointName(),service,lifecycle,AdvertisingOptions.Builder().setStrategy(Strategy.P2P_CLUSTER).build()).await();client.startDiscovery(service,discovery,DiscoveryOptions.Builder().setStrategy(Strategy.P2P_CLUSTER).build()).await();running=true}finally{starting=false}}
        if(owner!=app.vault.get("device")){stopRadios();return}
        peers.toMap().forEach{(id,p)->if(!p.ready&&now()-p.started>10000||p.ready&&runCatching{credential(p.credential)}.isFailure)drop(id)}
        discovered.toMap().forEach{(id,d)->if(id !in peers&&app.vault.get("device")<d&&now()-(attempts[id] ?: 0)>7000)connect(id)}
        if(!audio.occupied){val uid=app.state.value.user!!.getString("id");for(m in app.dao.outbox(uid))if(m.sender==uid&&m.kind in listOf("text","voice","ptt","image","video"))send(m)}
        publish()
    }
    fun connect(id:String){if(!running||id in peers)return;val d=discovered[id] ?: return;attempts[id]=now();peers[id]=Peer(d);client.requestConnection(endpointName(),id,lifecycle).addOnFailureListener{drop(id)}}
    private fun stopRadios(){if(!running&&!starting&&peers.isEmpty())return;running=false;audio.stopAll();client.stopAdvertising();client.stopDiscovery();client.stopAllEndpoints();peers.clear();discovered.clear();attempts.clear();publish()}
    private fun drop(id:String){audio.disconnected(id);peers.remove(id);attempts[id]=now();client.disconnectFromEndpoint(id);publish()}
    private fun publish(){val ready=peers.filterValues{it.ready}.mapValues{(_,p)->p.claims!!.optString("name","Teammate")};app.patch{it.copy(peers=ready,authenticatedPeer=ready.keys.firstOrNull(),nearbyStatus=if(!running)if(enabled)"ARMED"else"OFF"else if(ready.isEmpty())"SEARCHING FOR TEAMMATES"else"${ready.size} TEAMMATE${if(ready.size==1)""else"S"} CONNECTED · NEARBY")}}
    private val discovery=object:EndpointDiscoveryCallback(){override fun onEndpointFound(id:String,info:DiscoveredEndpointInfo){runCatching{device(info.endpointName)?.let{discovered[id]=it;if(app.vault.get("device")<it)connect(id)}}};override fun onEndpointLost(id:String){discovered.remove(id)}}
    private val lifecycle=object:ConnectionLifecycleCallback(){
        override fun onConnectionInitiated(id:String,info:ConnectionInfo){val d=runCatching{device(info.endpointName)}.getOrNull();if(!running||d==null||peers.any{it.key!=id&&it.value.device==d}){client.rejectConnection(id);return};peers.getOrPut(id){Peer(d)};client.acceptConnection(id,payloads).addOnFailureListener{drop(id)}}
        override fun onConnectionResult(id:String,result:ConnectionResolution){if(!result.status.isSuccess){drop(id);return};app.run{val p=peers[id] ?: return@run;control(id,json("type" to "hello","credential" to app.vault.get("credential"),"nonce" to p.nonce))}}
        override fun onDisconnected(id:String){drop(id)}
    }
    private fun challenge(sender:String,receiver:String,a:String,b:String)="kettoo-v2|$sender|$receiver|$a|$b"
    suspend fun control(id:String,body:JSONObject){require(id in peers);val bytes=body.toString().toByteArray();require(bytes.size<32000);client.sendPayload(id,Payload.fromBytes(bytes)).await()}
    fun sendControl(id:String,body:JSONObject){app.run{runCatching{control(id,body)}.onFailure{drop(id)}}}
    fun remoteDevice(id:String)=peers[id]?.device ?: ""
    fun remoteName(id:String)=peers[id]?.claims?.optString("name","Teammate") ?: "Teammate"
    private fun contains(c:JSONObject,key:String,cid:String)=c.optJSONArray(key)?.let{a->(0 until a.length()).any{a.getString(it)==cid}}==true
    private fun grant(c:JSONObject,cid:String)=c.optJSONArray("liveConversations")?.objects()?.find{it.optString("id")==cid}
    fun livePermission(id:String,cid:String,remotePublishes:Boolean):Boolean=runCatching{
        val p=peers[id] ?: return false;require(p.ready);val local=own();val remote=credential(p.credential);val a=grant(local,cid) ?: return false;val b=grant(remote,cid) ?: return false
        a.getLong("expiresAt")>now()&&b.getLong("expiresAt")>now()&&a.getString("epoch")==b.getString("epoch")&&(if(remotePublishes)b else a).getBoolean("canPublish")&&app.state.value.conversations.any{it.optString("id")==cid&&it.optBoolean("mediaAllowed",true)}
    }.getOrDefault(false)
    fun livePeers(cid:String)=peers.keys.filter{livePermission(it,cid,false)}.toSet()
    fun canTalk(cid:String)=fallback()&&livePeers(cid).isNotEmpty()
    fun priority(cid:String)=runCatching{grant(own(),cid)?.optInt("priority") ?: 0}.getOrDefault(0)
    suspend fun stream(id:String,mid:String,cid:String,input:InputStream):Long {val payload=Payload.fromStream(input);control(id,json("type" to "ptt.stream","id" to mid,"cid" to cid,"payloadId" to payload.id));client.sendPayload(id,payload).await();return payload.id}
    private val payloads=object:PayloadCallback(){
        override fun onPayloadReceived(id:String,payload:Payload){app.run{try{val p=peers[id] ?: error("Unknown peer");when(payload.type){
            Payload.Type.BYTES->{val bytes=payload.asBytes()!!;require(bytes.size<32000);handle(id,p,JSONObject(String(bytes)))}
            Payload.Type.STREAM->{require(p.ready);audio.streamReceived(id,payload.id,payload.asStream()!!.asInputStream())}
            Payload.Type.FILE->{require(p.ready);require(p.files.size<8);p.files[payload.id]=payload;complete(id,p,payload.id);app.scope.launch{delay(30000);if(p.files.remove(payload.id)!=null){client.cancelPayload(payload.id);p.metadata.remove(payload.id);p.completed.remove(payload.id)}}}
            else->client.cancelPayload(payload.id)
        }}catch(e:Exception){drop(id);app.error(e)}}}
        override fun onPayloadTransferUpdate(id:String,update:PayloadTransferUpdate){app.run{val p=peers[id] ?: return@run;if(audio.ownsStream(update.payloadId))return@run;if(update.totalBytes>10*1024*1024||update.bytesTransferred>10*1024*1024){client.cancelPayload(update.payloadId);p.files.remove(update.payloadId);p.metadata.remove(update.payloadId);return@run};if(update.status==PayloadTransferUpdate.Status.SUCCESS&&(update.payloadId in p.files||update.payloadId in p.metadata)){p.completed.add(update.payloadId);runCatching{complete(id,p,update.payloadId)}.onFailure{drop(id);app.error(it)}}else if(update.status in listOf(PayloadTransferUpdate.Status.FAILURE,PayloadTransferUpdate.Status.CANCELED)){p.files.remove(update.payloadId);p.metadata.remove(update.payloadId);p.completed.remove(update.payloadId)}}}
    }
    private suspend fun handle(id:String,p:Peer,b:JSONObject){when(val type=b.getString("type")){
        "hello"->{require(p.claims==null);p.credential=b.getString("credential");p.claims=credential(p.credential);require(p.claims!!.getString("device")==p.device);p.remoteNonce=b.getString("nonce");require(p.remoteNonce.length in 20..80);control(id,json("type" to "proof","signature" to keys.sign(challenge(app.vault.get("device"),p.device,p.remoteNonce,p.nonce))))}
        "proof"->{val c=p.claims ?: error("No peer credential");require(NearbyKeys.verify(c.getString("publicKey"),challenge(p.device,app.vault.get("device"),p.nonce,p.remoteNonce),b.getString("signature")));p.ready=true;publish()}
        "message"->{val m=validate(p,b);if(m.getString("kind")=="text")receive(id,p,b,null)else{require(p.metadata.size<8);val pid=b.getLong("payloadId");p.metadata[pid]=b;complete(id,p,pid)}}
        "receipt"->{require(p.ready);val mid=b.getString("id");val message=p.sent[mid]?.first ?: return;require(b.getString("envelopeHash")==NearbyKeys.hash(message.envelope.toByteArray()));p.sent.remove(mid);app.dao.cache(Cache(receiptKey(message,p),NearbyKeys.hash(message.envelope.toByteArray())));app.dao.find(mid)?.let{if(it.owner==message.owner&&it.state=="queued")app.dao.save(it.copy(state="peer-received"))}}
        else->{require(p.ready);credential(p.credential);require(type.startsWith("ptt."));audio.handle(id,b)}
    }}
    private fun validate(p:Peer,b:JSONObject):JSONObject{
        require(p.ready);val c=credential(p.credential);val own=own();val envelope=b.getString("envelope");require(NearbyKeys.verify(c.getString("publicKey"),envelope,b.getString("signature"))){"Invalid peer message signature"};val m=JSONObject(envelope);UUID.fromString(m.getString("id"));val cid=m.getString("conversationId");require(contains(c,"publishConversations",cid)&&contains(c,"conversations",cid)&&contains(own,"conversations",cid)&&app.state.value.conversations.any{it.optString("id")==cid});require(m.getLong("createdAt")<=now()+60000&&m.getLong("createdAt")<=c.getLong("expiresAt"));require(m.optString("text").length<=4000);val kind=m.getString("kind");require(kind in listOf("text","voice","ptt","image","video"));if(kind!="text"){require(m.getLong("size") in 1..limit(kind));require(m.optString("mime",if(kind=="voice")"audio/mp4"else"").startsWith(when(kind){"image"->"image/";"video"->"video/";else->"audio/"}))};if(kind=="ptt"){val g=grant(c,cid) ?: error("Missing live permission");require(g.getBoolean("canPublish")&&m.getLong("createdAt")<=g.getLong("expiresAt")&&g.getString("epoch")==grant(own,cid)?.getString("epoch"))};return m
    }
    private fun limit(kind:String):Long=when(kind){"image"->5L*1024*1024;"video"->10L*1024*1024;else->1024L*1024}
    private suspend fun complete(id:String,p:Peer,pid:Long){val b=p.metadata[pid] ?: return;val payload=p.files[pid] ?: return;if(pid !in p.completed)return;val m=validate(p,b);val uri=payload.asFile()?.asUri() ?: error("Missing received file");val extension=when(m.optString("mime")){"audio/wav"->"wav";"audio/mp4"->"m4a";"image/png"->"png";"image/jpeg"->"jpg";"video/mp4"->"mp4";else->"nearby"};val file=File(app.filesDir,"attachments/${m.getString("id")}.$extension");val temp=File(file.path+".partial");try{withContext(Dispatchers.IO){app.contentResolver.openInputStream(uri)!!.use{input->temp.outputStream().use{out->val buffer=ByteArray(8192);var total=0L;while(true){val n=input.read(buffer);if(n<0)break;total+=n;require(total<=limit(m.getString("kind")));out.write(buffer,0,n)}}};require(temp.length()==m.getLong("size"));require(NearbyKeys.hash(temp.readBytes())==m.getString("sha256"));check(temp.renameTo(file))};receive(id,p,b,file)}finally{temp.delete();p.metadata.remove(pid);p.files.remove(pid);p.completed.remove(pid)}}
    private suspend fun receive(id:String,p:Peer,b:JSONObject,file:File?){val m=validate(p,b);val uid=app.state.value.user!!.getString("id");val mid=m.getString("id");val old=app.dao.find(mid);if(old==null||old.state=="peer-live"&&old.owner==uid&&old.sender==p.claims!!.getString("user")&&old.conversation==m.getString("conversationId")){app.dao.save(LocalMessage(mid,uid,m.getString("conversationId"),p.claims!!.getString("user"),m.getString("kind"),m.optString("text"),m.getLong("createdAt"),"peer-received",file?.absolutePath ?: "",m.optString("mime",if(file!=null)"audio/mp4"else""),envelope=b.getString("envelope"),signature=b.getString("signature"),credential=p.credential,json=json("sender_name" to remoteName(id),"status" to "received").toString(),transcriptState=if(m.getString("kind") in listOf("voice","ptt"))"pending"else""))}else require(old.envelope==b.getString("envelope")||old.state in listOf("server-received","recipient-received","acknowledged")){"Conflicting message ID"};control(id,json("type" to "receipt","id" to mid,"envelopeHash" to NearbyKeys.hash(b.getString("envelope").toByteArray())))}
    private fun receiptKey(m:LocalMessage,p:Peer)="nearby.receipt.${m.owner}.${m.id}.${p.device}"
    suspend fun send(m:LocalMessage){for((id,p) in peers.toMap())if(p.ready&&contains(p.claims!!,"conversations",m.conversation)){runCatching{credential(p.credential);credential(m.credential);val hash=NearbyKeys.hash(m.envelope.toByteArray());if(app.dao.cached(receiptKey(m,p))==hash)return@runCatching;val last=p.sent[m.id];if(last!=null&&now()-last.second<30000)return@runCatching;p.sent[m.id]=m to now();val b=json("type" to "message","envelope" to m.envelope,"signature" to m.signature);if(m.kind=="text")control(id,b)else{val f=File(m.filePath);require(f.length() in 1..limit(m.kind));val payload=Payload.fromFile(f);b.put("payloadId",payload.id);control(id,b);client.sendPayload(id,payload).await()}}.onFailure{p.sent.remove(m.id)}}}
    fun retry(){app.run{update()}}
    suspend fun placeholder(id:String,mid:String,cid:String,created:Long){val uid=app.state.value.user?.getString("id") ?: return;val p=peers[id] ?: return;if(app.dao.find(mid)==null)app.dao.save(LocalMessage(mid,uid,cid,p.claims!!.getString("user"),"ptt","",created,"peer-live",json=json("sender_name" to remoteName(id),"status" to "live").toString()))}
    suspend fun saveLive(mid:String,cid:String,created:Long,rawCredential:String,file:File){val claims=credential(rawCredential);if(claims.getString("device")!=app.vault.get("device"))return;val uid=claims.getString("user");val envelope=json("id" to mid,"conversationId" to cid,"kind" to "ptt","text" to "","createdAt" to created,"mime" to "audio/wav","size" to file.length(),"sha256" to NearbyKeys.hash(file.readBytes())).toString();val m=LocalMessage(mid,uid,cid,uid,"ptt","",created,"queued",file.absolutePath,"audio/wav",envelope=envelope,signature=keys.sign(envelope),credential=rawCredential,json=json("status" to "received").toString(),transcriptState="pending");app.dao.save(m);send(m);app.flush()}
}

class NearbyKeys {
    private val store=KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    private val alias="kettoo-device-identity"
    init { if(!store.containsAlias(alias)) KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC,"AndroidKeyStore").apply { initialize(KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY).setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1")).setDigests(KeyProperties.DIGEST_SHA256).build()) }.generateKeyPair() }
    fun publicKey()=Base64.encodeToString(store.getCertificate(alias).publicKey.encoded,Base64.NO_WRAP)
    fun sign(text:String):String=Signature.getInstance("SHA256withECDSA").run { initSign(store.getKey(alias,null) as PrivateKey); update(text.toByteArray()); Base64.encodeToString(sign(),Base64.NO_WRAP) }
    companion object {
        fun hash(bytes:ByteArray)=MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
        fun verify(key:String,text:String,signature:String,algorithm:String="EC"):Boolean=runCatching {
            val publicKey=KeyFactory.getInstance(algorithm).generatePublic(X509EncodedKeySpec(Base64.decode(key.replace(Regex("-----[^-]+-----"),"").replace(Regex("\\s"),""),Base64.DEFAULT)))
            Signature.getInstance(if(algorithm=="RSA")"SHA256withRSA" else "SHA256withECDSA").run { initVerify(publicKey); update(text.toByteArray()); verify(Base64.decode(signature,if(algorithm=="RSA") Base64.URL_SAFE or Base64.NO_WRAP else Base64.DEFAULT)) }
        }.getOrDefault(false)
    }
}
