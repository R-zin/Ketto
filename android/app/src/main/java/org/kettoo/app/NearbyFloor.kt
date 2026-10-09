package org.kettoo.app

/** An unknown or duplicate response cannot stand in for a missing teammate. */
class NearbyQuorum(private val targets:Set<String>){
    init{require(targets.isNotEmpty())}
    private val grants=mutableSetOf<String>()
    private val ready=mutableSetOf<String>()
    fun grant(peer:String):Boolean{if(peer in targets)grants.add(peer);return grants==targets}
    fun ready(peer:String):Boolean{if(peer in grants)ready.add(peer);return grants==targets&&ready==targets}
}

object NearbyFloorPolicy {
    fun preempts(currentDevice:String,incomingDevice:String,active:Boolean,currentPriority:Int,incomingPriority:Int)=
        if(active)incomingPriority>currentPriority else incomingDevice<currentDevice
}
