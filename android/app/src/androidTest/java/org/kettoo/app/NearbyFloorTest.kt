package org.kettoo.app

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NearbyFloorTest {
    @Test fun allThreeReceiversMustGrantAndConfirmBeforeCapture(){
        val floor=NearbyQuorum(setOf("a","b","c"))
        assertFalse(floor.ready("a"))
        assertFalse(floor.grant("a"));assertFalse(floor.grant("a"))
        assertFalse(floor.grant("outsider"));assertFalse(floor.grant("b"))
        assertFalse(floor.ready("a"));assertFalse(floor.ready("b"))
        assertTrue(floor.grant("c"));assertFalse(floor.ready("outsider"))
        assertTrue(floor.ready("c"))
    }
    @Test fun competingRequestsHaveTheSameWinnerAtEverySharedReceiver(){
        for(receiver in listOf("a","b","c")){
            assertTrue("$receiver must prefer device a",NearbyFloorPolicy.preempts("b","a",false,0,0))
            assertFalse("$receiver must retain device a",NearbyFloorPolicy.preempts("a","b",false,0,0))
        }
        assertFalse(NearbyFloorPolicy.preempts("b","a",true,0,0))
        assertTrue(NearbyFloorPolicy.preempts("b","a",true,0,10))
        assertFalse(NearbyFloorPolicy.preempts("b","a",true,10,0))
    }
}
