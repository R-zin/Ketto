package org.kettoo.app

import androidx.room.Room
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

/** An isolated cache migration check; never opens the microphone or signs in. */
@RunWith(AndroidJUnit4::class)
class Phase3StorageTest {
    @Test fun phase2UpgradeKeepsHistoryAndPendingWork()=runBlocking {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val name="phase3-migration-${UUID.randomUUID()}.db"
        val old=context.openOrCreateDatabase(name,0,null)
        old.execSQL("CREATE TABLE messages (id TEXT NOT NULL PRIMARY KEY,owner TEXT NOT NULL,conversation TEXT NOT NULL,sender TEXT NOT NULL,kind TEXT NOT NULL,text TEXT NOT NULL,createdAt INTEGER NOT NULL,state TEXT NOT NULL,filePath TEXT NOT NULL,mime TEXT NOT NULL,attachmentId TEXT NOT NULL,envelope TEXT NOT NULL,signature TEXT NOT NULL,credential TEXT NOT NULL,json TEXT NOT NULL)")
        old.execSQL("CREATE TABLE cache (`key` TEXT NOT NULL PRIMARY KEY,json TEXT NOT NULL)")
        old.execSQL("CREATE TABLE operations (id TEXT NOT NULL PRIMARY KEY,owner TEXT NOT NULL,path TEXT NOT NULL,body TEXT NOT NULL,photoPath TEXT NOT NULL,photoMime TEXT NOT NULL,state TEXT NOT NULL,error TEXT NOT NULL)")
        old.execSQL("INSERT INTO messages VALUES ('saved','person','team','sender','voice','',123,'server-received','/private/replay.wav','audio/wav','attachment','','','','{}')")
        old.execSQL("INSERT INTO cache VALUES ('team','{\"name\":\"Stage\"}')")
        old.execSQL("INSERT INTO operations VALUES ('issue','person','/threads','{}','','','pending','')")
        old.version=2;old.close()
        val database=Room.databaseBuilder(context,LocalDatabase::class.java,name).addMigrations(PHASE3_MIGRATION).build()
        try {
            val dao=database.messages()
            val message=dao.find("saved")!!
            assertEquals("/private/replay.wav",message.filePath)
            assertFalse(message.archived);assertEquals("",message.transcript)
            assertEquals(1,dao.operations("person").size)
            assertTrue(dao.cached("team")!!.contains("Stage"))
            dao.save(message.copy(archived=true,transcript="Gate clear",transcriptState="ready"))
            dao.saveRecording(PendingRecording("burst","person","team","/private/burst.wav"))
            assertTrue(dao.find("saved")!!.archived)
            assertEquals("Gate clear",dao.find("saved")!!.transcript)
            assertEquals("burst",dao.recordings("person").single().id)
        }finally{database.close();context.deleteDatabase(name)}
    }
}
