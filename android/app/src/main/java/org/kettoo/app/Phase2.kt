package org.kettoo.app

import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.sync.Mutex
import org.json.JSONObject
import java.io.File
import java.util.UUID

val PHASE2_MIGRATION=object:Migration(1,2){override fun migrate(db:SupportSQLiteDatabase){db.execSQL("CREATE TABLE IF NOT EXISTS operations (id TEXT NOT NULL,owner TEXT NOT NULL,path TEXT NOT NULL,body TEXT NOT NULL,photoPath TEXT NOT NULL,photoMime TEXT NOT NULL,state TEXT NOT NULL,error TEXT NOT NULL,PRIMARY KEY(id))")}}
data class OperationsState(val snapshot:JSONObject?=null,val live:Boolean=false,val pending:List<PendingOperation> = emptyList())
class Phase2(private val app:KettooApplication){
 val state=MutableStateFlow(OperationsState())
 private val gate=Mutex()
 private var exchangeJob:Job?=null
 private fun owner()=app.state.value.user?.optString("id") ?: ""
 suspend fun load(){val uid=owner();state.value=OperationsState(app.dao.cached("operations.$uid")?.let{JSONObject(it)},false,app.dao.operations(uid))}
 suspend fun refresh(){val uid=owner();if(uid.isBlank())return;try{val snapshot=app.api.objectCall("/operations");if(uid!=owner())return;val old=state.value.snapshot;val ids=snapshot.getJSONArray("issues").objects().map{it.getString("id")}.toSet();old?.optJSONArray("issues")?.objects()?.filter{it.getString("id") !in ids}?.forEach{x->app.dao.removeCache("thread.$uid.${x.getString("id")}");x.optString("photo_id").takeIf{it.isNotBlank()&&it!="null"}?.let{File(app.filesDir,"attachments/phase.$uid.$it").delete()}};app.dao.cache(Cache("operations.$uid",snapshot.toString()));state.value=state.value.copy(snapshot=snapshot,live=true,pending=app.dao.operations(uid));cacheFloorImages(snapshot,uid);val e=snapshot.optJSONObject("exchange");if(e!=null&&exchangeJob?.isActive!=true)exchangeJob=app.scope.launch{while(isActive){delay(30000);if(state.value.snapshot?.optJSONObject("exchange")==null)break;runCatching{app.api.objectCall("/admin-exchange/renew",json())}}};if(e==null){exchangeJob?.cancel();exchangeJob=null}}catch(e:Exception){if(e is CancellationException)throw e;state.value=state.value.copy(live=false)}}
 private suspend fun cacheFloorImages(snapshot:JSONObject,uid:String){val allowed=(snapshot.getJSONArray("floors").objects().map{it.optString("image_id")}+snapshot.getJSONArray("issues").objects().map{it.optString("photo_id")}).toSet();val prefix="phase.$uid.";File(app.filesDir,"attachments").listFiles()?.filter{it.name.startsWith(prefix)&&it.name.removePrefix(prefix) !in allowed}?.forEach{it.delete()};for(f in snapshot.getJSONArray("floors").objects()){val fid=f.optString("image_id");if(fid.isBlank()||fid=="null")continue;val target=File(app.filesDir,"attachments/phase.$uid.$fid");if(!target.exists())runCatching{app.api.downloadPath("/phase2/files/$fid",target)}}}
 suspend fun image(fid:String):File{val target=File(app.filesDir,"attachments/phase.${owner()}.$fid");if(!target.exists()){check(state.value.live){"Image unavailable in cache"};app.api.downloadPath("/phase2/files/$fid",target)};return target}
 suspend fun thread(iid:String):JSONObject{val k="thread.${owner()}.$iid";if(!state.value.live)return app.dao.cached(k)?.let{JSONObject(it)} ?: error("Thread detail is not cached. Reconnect to load it.");val t=app.api.objectCall("/threads/$iid");app.dao.cache(Cache(k,t.toString()));return t}
 suspend fun queue(path:String,body:JSONObject,photo:File?=null,mime:String=""){val uid=owner();check(uid.isNotBlank());app.dao.saveOperation(PendingOperation(body.getString("id"),uid,path,body.toString(),photo?.absolutePath ?: "",mime));state.value=state.value.copy(pending=app.dao.operations(uid));flush()}
 suspend fun checkin(zone:String)=queue("/checkins",json("id" to UUID.randomUUID().toString(),"zoneId" to zone,"reportedAt" to System.currentTimeMillis()))
 suspend fun flush(){if(!app.state.value.connected||app.media.occupied||app.state.value.incoming!=null||!gate.tryLock())return;try{val uid=owner();for(o in app.dao.operations(uid).filter{it.state=="pending"}){if(app.media.occupied||app.state.value.incoming!=null)break;try{app.api.objectCall(o.path,JSONObject(o.body));if(o.photoPath.isNotBlank())app.api.uploadPath("/phase2/issues/${o.id}/files",File(o.photoPath),o.photoMime);app.dao.removeOperation(o.id)}catch(e:ApiFailure){if(e.status in listOf(400,403,404,409))app.dao.saveOperation(o.copy(state="rejected",error=e.message ?: "Update rejected"))else break}catch(e:Exception){if(e is CancellationException)throw e;break}};state.value=state.value.copy(pending=app.dao.operations(uid));refresh()}finally{gate.unlock()}}
 suspend fun dismiss(id:String){app.dao.removeOperation(id);state.value=state.value.copy(pending=app.dao.operations(owner()))}
 suspend fun talkAdmin(){check(app.state.value.duty){"Start duty first"};val e=app.api.objectCall("/admin-exchange",json());app.refresh();app.select(e.getString("conversation_id"))}
 suspend fun endExchange(){app.api.objectCall("/admin-exchange/end",json());app.refresh()}
 fun offline(){state.value=state.value.copy(live=false)}
 fun clear(){exchangeJob?.cancel();state.value=OperationsState()}
}
