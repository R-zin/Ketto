package org.kettoo.app

import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** Uses existing approved sessions. Requires two devices and a deliberate API outage. */
@RunWith(AndroidJUnit4::class)
class NearbyDeviceTest {
    @Test fun automaticLiveFailover()=runBlocking {
        val i=InstrumentationRegistry.getInstrumentation();val args=InstrumentationRegistry.getArguments()
        val app=i.targetContext.applicationContext as KettooApplication
        val sender=args.getString("sender")=="true";val marker=args.getString("marker") ?: "Nearby acceptance"
        val original=app.nearby.enabled;val originalDuty=app.state.value.duty
        val scenario=ActivityScenario.launch(MainActivity::class.java)
        fun status(message:String){i.sendStatus(2,android.os.Bundle().apply{putString("stream","\nKETTOO_NEARBY_$message\n")})}
        try{
            withTimeout(20000){while(!app.state.value.connected)delay(100)}
            withContext(Dispatchers.Main){app.refresh();app.duty(true);app.nearby.enable(true)}
            val cid=args.getString("channel") ?: app.state.value.conversations.first{it.optBoolean("pttAllowed",true)&&it.optBoolean("mediaAllowed",true)&&it.optString("kind")=="channel"}.getString("id")
            withContext(Dispatchers.Main){app.select(cid)}
            withTimeout(20000){while(!app.state.value.duty)delay(100)}
            status("PREPARED sender=$sender channel=$cid")
            withTimeout(90000){while(app.state.value.connected)delay(100)}
            withTimeout(60000){while(!withContext(Dispatchers.Main){app.nearby.canTalk(cid)}){if(app.state.value.error.isNotBlank())println("Waiting: ${app.state.value.nearbyStatus}");delay(200)}}
            status("AUTO_CONNECTED peers=${app.state.value.peers.size}")
            val uid=app.state.value.user!!.getString("id")
            if(sender){
                // Allow the receiver to finish its test setup, then exercise the real shared TALK path.
                delay(1500)
                withContext(Dispatchers.Main){app.media.press(cid)}
                withTimeout(8000){while(app.state.value.ptt!="TRANSMITTING"){if(app.state.value.error.isNotBlank())println("TALK: ${app.state.value.error}");delay(50)}}
                val mid=withContext(Dispatchers.Main){app.media.transmissionMessage!!}
                status("MICROPHONE_ACTIVE message=$mid")
                delay(3500)
                withContext(Dispatchers.Main){app.media.release()}
                val recording=withTimeout(15000){var m=app.dao.find(mid);while(m?.filePath.isNullOrBlank()){delay(100);m=app.dao.find(mid)};m!!}
                assertTrue(File(recording.filePath).length()>64000)
                withContext(Dispatchers.Main){app.queue(cid,"text",marker)}
                withTimeout(40000){while(app.dao.find(mid)?.state!="peer-received")delay(100)}
                status("TX_REPLAY_DELIVERED bytes=${File(recording.filePath).length()}")
            }else{
                withTimeout(30000){while(app.nearby.audio.receivedBytes.get()<64000)delay(100)}
                assertTrue("PCM must reach AudioTrack",app.nearby.audio.playedSamples.get()>16000)
                status("LIVE_RECEIVED bytes=${app.nearby.audio.receivedBytes.get()} nonSilent=${app.nearby.audio.nonSilentSamples.get()} played=${app.nearby.audio.playedSamples.get()}")
                val rows=withTimeout(40000){app.dao.watch(uid,cid).first{rows->rows.any{it.text==marker&&it.state=="peer-received"}&&rows.any{it.kind=="ptt"&&it.createdAt>System.currentTimeMillis()-90000&&it.state=="peer-received"&&it.filePath.isNotBlank()}}}
                val replay=rows.last{it.kind=="ptt"&&it.state=="peer-received"&&it.filePath.isNotBlank()};val bytes=File(replay.filePath).readBytes()
                assertEquals("RIFF",String(bytes,0,4));assertTrue(bytes.size>64000)
                status("RX_TEXT_REPLAY_PASSED bytes=${bytes.size}")
            }
            status("OUTAGE_PASSED sender=$sender")
            withTimeout(90000){while(!app.state.value.connected)delay(200)}
            withTimeout(30000){while(app.state.value.peers.isNotEmpty())delay(200)}
            withTimeout(60000){while(app.dao.outbox(uid).any{it.text==marker||it.kind=="ptt"&&it.createdAt>System.currentTimeMillis()-180000}){withContext(Dispatchers.Main){app.flush()};delay(1000)}}
            status("RECOVERY_SYNC_PASSED")
        }finally{withContext(Dispatchers.Main){app.nearby.enable(original);if(!originalDuty)app.duty(false)};scenario.close()}
    }
}
