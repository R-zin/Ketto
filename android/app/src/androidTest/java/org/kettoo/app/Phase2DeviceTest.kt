package org.kettoo.app

import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.By
import androidx.test.uiautomator.Until
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID
import android.graphics.Bitmap
import java.io.File

/** Uses an isolated test organisation. It does not activate microphone or camera capture. */
@RunWith(AndroidJUnit4::class)
class Phase2DeviceTest {
 @Test fun operationsAndRecovery()=runBlocking {
  val instrumentation=InstrumentationRegistry.getInstrumentation()
  val args=InstrumentationRegistry.getArguments()
  val app=instrumentation.targetContext.applicationContext as KettooApplication
  val device=UiDevice.getInstance(instrumentation)
  device.wakeUp()
  val scenario=ActivityScenario.launch(MainActivity::class.java)
  scenario.onActivity{it.window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)}
  fun report(text:String)=instrumentation.sendStatus(2,android.os.Bundle().apply{putString("stream","\nKETTOO_PHASE2_$text\n")})
  try {
   app.login(args.getString("server") ?: "https://localhost:8443",args.getString("email")!!,args.getString("password")!!)
   withTimeout(20000){while(!app.state.value.connected||app.operations.state.value.snapshot==null)delay(100)}
   instrumentation.runOnMainSync{app.duty(true);app.duty(false)}
   delay(6000)
   assertFalse(app.state.value.duty);assertTrue(app.state.value.mediaRooms.isEmpty())
   val data=app.operations.state.value.snapshot!!
   val team=data.getJSONObject("team")
   assertEquals("Stage",team.getString("name"))
   assertEquals(1,app.state.value.conversations.count{it.optString("kind")=="channel"&&it.optBoolean("pttAllowed")})
   val zone=data.getJSONArray("zones").objects().first{it.getString("name")=="Stage"}
   app.operations.checkin(zone.getString("id"));app.operations.refresh()
   assertEquals(zone.getString("id"),app.operations.state.value.snapshot!!.getJSONObject("checkin").getString("zone_id"))
   assertEquals(team.getString("id"),app.operations.state.value.snapshot!!.getJSONObject("team").getString("id"))
   val iid=UUID.randomUUID().toString()
   val photo=File(app.filesDir,"attachments/phase2-device-photo.png")
   val bitmap=Bitmap.createBitmap(12,12,Bitmap.Config.ARGB_8888);bitmap.eraseColor(android.graphics.Color.GREEN);photo.outputStream().use{bitmap.compress(Bitmap.CompressFormat.PNG,100,it)};bitmap.recycle()
   app.operations.queue("/threads",json("id" to iid,"title" to "Phone acceptance issue","description" to "Equipment at Stage needs moving.","priority" to "urgent","audience" to "team","teamId" to team.getString("id"),"zoneId" to zone.getString("id"),"createdAt" to System.currentTimeMillis()),photo,"image/png")
   var thread=app.operations.thread(iid)
   assertEquals("open",thread.getString("status"));assertTrue(thread.optString("photo_id").isNotBlank())
   assertTrue(app.operations.image(thread.getString("photo_id")).length()>0)
   thread=app.api.objectCall("/threads/$iid/claim",json("version" to thread.getInt("version")))
   assertEquals(app.state.value.user!!.getString("id"),thread.getString("owner_id"))
   val replyId=UUID.randomUUID().toString()
   val reply=json("id" to replyId,"text" to "Equipment moved; passage clear.","createdAt" to System.currentTimeMillis())
   app.operations.queue("/threads/$iid/replies",reply);app.api.objectCall("/threads/$iid/replies",reply)
   thread=app.operations.thread(iid);assertEquals(1,thread.getJSONArray("replies").length())
   thread=app.api.objectCall("/threads/$iid/resolve",json("version" to thread.getInt("version")))
   assertEquals("resolved",thread.getString("status"));app.operations.refresh()
   val cachedPhoto=app.operations.image(thread.getString("photo_id"))
   val stalePhoto=File(app.filesDir,"attachments/phase.${app.state.value.user!!.getString("id")}.removed-photo")
   stalePhoto.writeText("obsolete cache")
   app.operations.refresh()
   assertFalse(stalePhoto.exists());assertTrue(cachedPhoto.exists())
   assertTrue(device.wait(Until.hasObject(By.text("THREADS")),10000));device.findObject(By.text("THREADS")).click()
   assertTrue(device.wait(Until.hasObject(By.text("Follow through.")),10000))
   report("FUNCTIONAL_PASSED photo=true claim=true replyDedup=true resolve=true cacheCleanup=true dutyStartupCancellation=true")
   if(args.getString("offline")=="false")return@runBlocking
   report("OFFLINE_READY")
   withTimeout(65000){while(app.state.value.connected)delay(100)}
   val zones=app.operations.state.value.snapshot!!.getJSONArray("zones").objects()
   val other=zones.first{it.getString("id")!=zone.getString("id")}
   app.operations.checkin(other.getString("id"))
   val offlineId=UUID.randomUUID().toString()
   app.operations.queue("/threads",json("id" to offlineId,"title" to "Queued phone issue","description" to "Offline recovery verification.","priority" to "normal","audience" to "everyone","zoneId" to other.getString("id"),"createdAt" to System.currentTimeMillis()))
   app.operations.queue("/threads/$iid/replies",json("id" to UUID.randomUUID().toString(),"text" to "Offline follow-up.","createdAt" to System.currentTimeMillis()))
   assertEquals(3,app.operations.state.value.pending.count{it.state=="pending"})
   assertFalse(app.operations.state.value.live)
   report("OFFLINE_QUEUED count=3")
   withTimeout(65000){while(!app.state.value.connected||app.operations.state.value.pending.any{it.state=="pending"})delay(200)}
   assertTrue(app.operations.state.value.pending.none{it.state=="rejected"})
   app.operations.refresh()
   assertEquals(1,app.operations.state.value.snapshot!!.getJSONArray("issues").objects().count{it.getString("id")==offlineId})
   assertEquals(other.getString("id"),app.operations.state.value.snapshot!!.getJSONObject("checkin").getString("zone_id"))
   assertEquals(2,app.operations.thread(iid).getJSONArray("replies").length())
   report("RECOVERY_PASSED checkin=true createOnce=true replyOnce=true")
  }finally{instrumentation.runOnMainSync{app.duty(false)};scenario.close()}
 }
}
