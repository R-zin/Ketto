package org.kettoo.app

import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import java.io.File

val PHASE3_MIGRATION=object:Migration(2,3){override fun migrate(db:SupportSQLiteDatabase){
    db.execSQL("ALTER TABLE messages ADD COLUMN archived INTEGER NOT NULL DEFAULT 0")
    db.execSQL("ALTER TABLE messages ADD COLUMN transcript TEXT NOT NULL DEFAULT ''")
    db.execSQL("ALTER TABLE messages ADD COLUMN transcriptState TEXT NOT NULL DEFAULT ''")
    db.execSQL("ALTER TABLE messages ADD COLUMN transcriptError TEXT NOT NULL DEFAULT ''")
    db.execSQL("CREATE TABLE IF NOT EXISTS recordings (id TEXT NOT NULL,owner TEXT NOT NULL,conversation TEXT NOT NULL,filePath TEXT NOT NULL,attachmentId TEXT NOT NULL,transcriptJson TEXT NOT NULL,PRIMARY KEY(id))")
}}

class Phase3(private val app:KettooApplication){
    private val gate=Mutex()
    private val speechGate=Mutex()
    private fun owner()=app.state.value.user?.optString("id") ?: ""
    suspend fun recorded(id:String,cid:String,file:File){
        val uid=owner();if(uid.isBlank())return
        app.dao.saveRecording(PendingRecording(id,uid,cid,file.absolutePath))
        app.dao.find(id)?.let{app.dao.save(it.copy(filePath=file.absolutePath,transcriptState="pending"))}
        flush()
    }
    suspend fun prepare(message:LocalMessage):LocalMessage=speechGate.withLock{
        val current=app.dao.find(message.id)?.takeIf{it.owner==message.owner} ?: message
        if(current.kind !in listOf("voice","ptt")||current.transcriptState in listOf("ready","unavailable","failed")||current.filePath.isBlank())return@withLock current
        val result=app.speech.transcribe(File(current.filePath))
        val updated=current.copy(transcript=result.optString("text"),transcriptState=result.getString("state"),transcriptError=result.optString("error"))
        if(current.owner==owner())app.dao.save(updated)
        updated
    }
    fun metadata(m:LocalMessage)=if(m.transcriptState in listOf("ready","unavailable","failed"))json("text" to m.transcript,"state" to m.transcriptState,"error" to m.transcriptError,"language" to "en-US","engine" to "vosk-small-en-us-0.15")else null
    suspend fun flush(){
        if(app.media.occupied||app.state.value.incoming!=null||!gate.tryLock())return
        try{
            val uid=owner();if(uid.isBlank())return
            // Queued and Nearby audio can gain a transcript without any server connection.
            for(note in app.dao.outbox(uid).filter{it.kind in listOf("voice","ptt")}){
                if(app.media.occupied||app.state.value.incoming!=null||uid!=owner())break
                prepare(note)
            }
            for(initial in app.dao.recordings(uid)){
                if(app.media.occupied||app.state.value.incoming!=null||uid!=owner())break
                var job=initial
                if(job.transcriptJson.isBlank()){
                    val result=app.speech.transcribe(File(job.filePath))
                    if(uid!=owner())break
                    job=job.copy(transcriptJson=result.toString());app.dao.saveRecording(job)
                    app.dao.find(job.id)?.let{app.dao.save(it.copy(transcript=result.optString("text"),transcriptState=result.optString("state"),transcriptError=result.optString("error")))}
                }
                if(!app.state.value.connected)continue
                try{
                    if(job.attachmentId.isBlank()){
                        job=job.copy(attachmentId=app.api.upload(job.conversation,File(job.filePath),"audio/wav"));app.dao.saveRecording(job)
                    }
                    val response=app.api.objectCall("/messages/${job.id}/recording",json("attachmentId" to job.attachmentId,"transcript" to JSONObject(job.transcriptJson)))
                    if(uid!=owner())break
                    app.receive(response);app.dao.removeRecording(job.id)
                }catch(e:ApiFailure){
                    if(e.status in listOf(403,404)){app.dao.removeRecording(job.id);app.error(Exception("Recording could not sync: access changed"))}else break
                }catch(e:Exception){if(e is CancellationException)throw e;break}
            }
        }finally{gate.unlock()}
    }
    suspend fun acknowledge(m:LocalMessage){
        check(app.state.value.connected){"Reconnect to acknowledge and archive"}
        app.api.objectCall("/messages/${m.id}/receipt",json("state" to "acknowledged"))
        app.dao.find(m.id)?.let{if(it.owner==owner())app.dao.save(it.copy(archived=true))}
    }
}
