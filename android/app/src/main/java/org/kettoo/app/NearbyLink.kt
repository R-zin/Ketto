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

/** One authenticated two-device link. It is not a relay, mesh or live voice transport. */
class NearbyLink(private val app:KettooApplication) {
    val keys=NearbyKeys()
    private val client=Nearby.getConnectionsClient(app)
    private val service="org.kettoo.app.private.v1"
    private var endpoint:String?=null
    private var nonce=""
    private var remoteNonce=""
    private var remote:JSONObject?=null
    private var remoteCredential=""
    private var authenticated=false
    private var authDeadline:Job?=null
    private val metadata=mutableMapOf<Long,JSONObject>()
    private val files=mutableMapOf<Long,Payload>()
    private val completed=mutableSetOf<Long>()
    private val sent=mutableMapOf<String,LocalMessage>()
    private fun credential(raw:String):JSONObject {
        val parts=raw.split('.'); require(parts.size==2)
        require(NearbyKeys.verify(app.vault.get("issuer"),parts[0],parts[1],"RSA")) { "Peer is not signed by this organisation" }
        val body=JSONObject(String(Base64.decode(parts[0],Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)))
        require(body.getLong("expiresAt")>System.currentTimeMillis()) { "Peer credential expired; reconnect to the server" }
        require(body.getString("org")==NearbyKeys.hash(app.vault.get("issuer").toByteArray()))
        return body
    }
    fun start() { app.run {
        require(!app.state.value.connected) { "Nearby fallback is for an unreachable organisation server" }
        credential(app.vault.get("credential"))
        client.startAdvertising("Kettoo approved device",service,lifecycle,AdvertisingOptions.Builder().setStrategy(Strategy.P2P_POINT_TO_POINT).build()).await()
        client.startDiscovery(service,discovery,DiscoveryOptions.Builder().setStrategy(Strategy.P2P_POINT_TO_POINT).build()).await()
        app.patch { it.copy(nearbyStatus="SEARCHING · DIRECT NOTES & TEXT") }
    } }
    fun connect(id:String) { app.run { require(endpoint==null); client.requestConnection("Kettoo approved device",id,lifecycle).await() } }
    fun stop() { client.stopAdvertising();client.stopDiscovery();client.stopAllEndpoints();reset();app.patch { it.copy(peers=emptyMap(),nearbyStatus="OFF") } }
    private fun reset() { authDeadline?.cancel(); endpoint=null;authenticated=false;remote=null;remoteCredential="";metadata.clear();files.clear();completed.clear();sent.clear();app.patch { it.copy(authenticatedPeer=null) } }
    private val discovery=object:EndpointDiscoveryCallback(){
        override fun onEndpointFound(id:String,info:DiscoveredEndpointInfo){app.patch { it.copy(peers=it.peers+(id to info.endpointName)) }}
        override fun onEndpointLost(id:String){app.patch { it.copy(peers=it.peers-id) }}
    }
    private val lifecycle=object:ConnectionLifecycleCallback(){
        override fun onConnectionInitiated(id:String,info:ConnectionInfo){
            if(endpoint!=null && endpoint!=id){client.rejectConnection(id);return}
            endpoint=id;nonce=UUID.randomUUID().toString();authenticated=false
            // Nearby transport acceptance precedes application authentication. No content is sent yet.
            client.acceptConnection(id,payloads).addOnFailureListener { app.error(it);client.disconnectFromEndpoint(id) }
        }
        override fun onConnectionResult(id:String,result:ConnectionResolution){if(!result.status.isSuccess){reset();app.patch { it.copy(nearbyStatus="CONNECTION FAILED") };return};app.run {
            sendBytes(json("type" to "hello","credential" to app.vault.get("credential"),"nonce" to nonce))
            authDeadline=app.scope.launch { delay(10000);if(!authenticated){client.disconnectFromEndpoint(id);reset();app.error(Exception("Nearby authentication timed out"))} }
        }}
        override fun onDisconnected(id:String){if(id==endpoint){reset();app.patch { it.copy(nearbyStatus="DISCONNECTED · CONTENT QUEUED") }}}
    }
    private fun challenge(sender:String,receiver:String,receiverNonce:String,senderNonce:String)="kettoo-v1|$sender|$receiver|$receiverNonce|$senderNonce"
    private suspend fun sendBytes(body:JSONObject){val id=endpoint ?: error("No peer connected");val bytes=body.toString().toByteArray();require(bytes.size<32000);client.sendPayload(id,Payload.fromBytes(bytes)).await()}
    private val payloads=object:PayloadCallback(){
        override fun onPayloadReceived(id:String,payload:Payload){app.run {
            try {
                require(id==endpoint)
                if(payload.type==Payload.Type.BYTES){val bytes=payload.asBytes()!!;require(bytes.size<32000);handle(JSONObject(String(bytes)))}
                else if(payload.type==Payload.Type.FILE){require(authenticated);files[payload.id]=payload;complete(payload.id);app.scope.launch { delay(15000);if(payload.id in files){client.cancelPayload(payload.id);files.remove(payload.id);metadata.remove(payload.id)} }}
                else client.cancelPayload(payload.id)
            } catch(e:Exception){client.disconnectFromEndpoint(id);reset();app.error(e)}
        }}
        override fun onPayloadTransferUpdate(id:String,update:PayloadTransferUpdate){app.run {
            if(update.bytesTransferred>1024*1024){client.cancelPayload(update.payloadId);files.remove(update.payloadId);metadata.remove(update.payloadId);return@run}
            if(update.status==PayloadTransferUpdate.Status.SUCCESS){completed.add(update.payloadId);runCatching { complete(update.payloadId) }.onFailure { app.error(it);client.disconnectFromEndpoint(id) }}
            else if(update.status==PayloadTransferUpdate.Status.FAILURE || update.status==PayloadTransferUpdate.Status.CANCELED){files.remove(update.payloadId);metadata.remove(update.payloadId);app.error(Exception("Nearby transfer failed; message remains queued"))}
        }}
    }
    private suspend fun handle(body:JSONObject){when(body.getString("type")){
        "hello"->{require(remote==null);remoteCredential=body.getString("credential");remote=credential(remoteCredential);remoteNonce=body.getString("nonce");require(remoteNonce.length in 20..80);require(remote!!.getString("device")!=app.vault.get("device"));sendBytes(json("type" to "proof","signature" to keys.sign(challenge(app.vault.get("device"),remote!!.getString("device"),remoteNonce,nonce))))}
        "proof"->{val peer=remote ?: error("No peer credential");require(NearbyKeys.verify(peer.getString("publicKey"),challenge(peer.getString("device"),app.vault.get("device"),nonce,remoteNonce),body.getString("signature"))) { "Peer did not prove device-key ownership" };authenticated=true;authDeadline?.cancel();app.patch { it.copy(authenticatedPeer=endpoint,nearbyStatus="AUTHENTICATED · DIRECT NOTES & TEXT") }}
        "message"->{val envelope=validate(body);if(envelope.getString("kind")=="text")receive(body,null) else {require(envelope.getString("kind")=="voice");require(envelope.getLong("size") in 1..1024*1024);metadata[body.getLong("payloadId")]=body;complete(body.getLong("payloadId"))}}
        "receipt"->{require(authenticated);val mid=body.getString("id");val message=sent.remove(mid) ?: return;require(body.getString("envelopeHash")==NearbyKeys.hash(message.envelope.toByteArray()));app.dao.find(mid)?.let{if(it.owner==message.owner)app.dao.save(it.copy(state="peer-received"))};app.patch { it.copy(nearbyStatus="RECIPIENT RECEIVED · ONE PEER") }}
        else->error("Unknown peer command")
    }}
    private fun validate(body:JSONObject):JSONObject {
        require(authenticated);val peer=remote ?: error("Peer unavailable");credential(remoteCredential)
        val envelope=body.getString("envelope");require(NearbyKeys.verify(peer.getString("publicKey"),envelope,body.getString("signature"))) { "Invalid message signature" }
        val m=JSONObject(envelope);UUID.fromString(m.getString("id"));val cid=m.getString("conversationId")
        require((0 until peer.getJSONArray("publishConversations").length()).any { peer.getJSONArray("publishConversations").getString(it)==cid }) { "Peer cannot publish in this conversation" }
        val own=credential(app.vault.get("credential"));require((0 until peer.getJSONArray("conversations").length()).any { peer.getJSONArray("conversations").getString(it)==cid });require((0 until own.getJSONArray("conversations").length()).any { own.getJSONArray("conversations").getString(it)==cid });require(app.state.value.conversations.any { it.getString("id")==cid });require(own.getLong("expiresAt")>System.currentTimeMillis());require(m.optString("text").length<=4000)
        require(m.getLong("createdAt")<=System.currentTimeMillis()+60000)
        return m
    }
    private suspend fun complete(pid:Long){val body=metadata[pid] ?: return;val payload=files[pid] ?: return;if(pid !in completed)return;val m=validate(body);val received=payload.asFile() ?: error("Missing file");val uri=received.asUri() ?: error("Missing received file URI");val file=File(app.filesDir,"attachments/${m.getString("id")}.m4a")
        withContext(Dispatchers.IO){app.contentResolver.openInputStream(uri)!!.use { input -> file.outputStream().use { output -> val buffer=ByteArray(8192);var total=0;while(true){val n=input.read(buffer);if(n<0)break;total+=n;require(total<=1024*1024);output.write(buffer,0,n)} } };require(file.length()==m.getLong("size"));require(NearbyKeys.hash(file.readBytes())==m.getString("sha256"));require(file.inputStream().use { val header=ByteArray(8);require(it.read(header)==8);header.copyOfRange(4,8).decodeToString() }=="ftyp") }
        receive(body,file);metadata.remove(pid);files.remove(pid);completed.remove(pid)
    }
    private suspend fun receive(body:JSONObject,file:File?){val m=validate(body);val uid=app.state.value.user!!.getString("id");val mid=m.getString("id");val existing=app.dao.find(mid)
        if(existing==null) app.dao.save(LocalMessage(mid,uid,m.getString("conversationId"),remote!!.getString("user"),m.getString("kind"),m.optString("text"),m.getLong("createdAt"),"peer-received",file?.absolutePath ?: "",if(file!=null)"audio/mp4" else "",envelope=body.getString("envelope"),signature=body.getString("signature"),credential=remoteCredential,transcriptState=if(file!=null)"pending"else""))
        else require(existing.envelope==body.getString("envelope") || existing.state=="server-received") { "Conflicting message ID" }
        sendBytes(json("type" to "receipt","id" to mid,"envelopeHash" to NearbyKeys.hash(body.getString("envelope").toByteArray())))
    }
    suspend fun send(m:LocalMessage){require(authenticated);val peer=remote ?: error("Peer unavailable");credential(remoteCredential);credential(m.credential);val cid=m.conversation;require((0 until peer.getJSONArray("conversations").length()).any { peer.getJSONArray("conversations").getString(it)==cid }) { "Peer cannot access this conversation" }
        val own=credential(app.vault.get("credential"));require((0 until own.getJSONArray("publishConversations").length()).any { own.getJSONArray("publishConversations").getString(it)==cid }) { "You cannot publish in this conversation" }
        sent[m.id]=m;val body=json("type" to "message","envelope" to m.envelope,"signature" to m.signature)
        if(m.kind=="text")sendBytes(body)
        else {require(m.kind=="voice");val file=File(m.filePath);require(file.length() in 1..1024*1024);val payload=Payload.fromFile(file);body.put("payloadId",payload.id);sendBytes(body);client.sendPayload(endpoint!!,payload).await()}
    }
    fun retry(){app.run { val uid=app.state.value.user!!.getString("id");for(m in app.dao.outbox(uid))if(m.sender==uid && m.kind in listOf("text","voice"))send(m) }}
}
