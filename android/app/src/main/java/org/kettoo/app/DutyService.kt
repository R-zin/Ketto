package org.kettoo.app

import android.app.*
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

class DutyService : Service() {
    override fun onCreate() { super.onCreate(); (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(NotificationChannel("duty","On-duty communication",NotificationManager.IMPORTANCE_LOW)) }
    override fun onStartCommand(intent:Intent?,flags:Int,startId:Int):Int {
        val types=if(Build.VERSION.SDK_INT>=30) ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE else if(Build.VERSION.SDK_INT>=29) ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK else 0
        ServiceCompat.startForeground(this,1,notification(this,"On duty · preparing audio"),types)
        (application as KettooApplication).run { (application as KettooApplication).startDuty() }
        return START_NOT_STICKY
    }
    override fun onBind(intent:Intent?):IBinder?=null
    override fun onDestroy() { (application as KettooApplication).run { val app=application as KettooApplication; app.patch { it.copy(duty=false) }; app.heartbeat(); app.media.off(); app.nearby.stop() }; super.onDestroy() }
    companion object {
        fun notification(context:Context,text:String):Notification {
            val open=PendingIntent.getActivity(context,0,Intent(context,MainActivity::class.java),PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            return NotificationCompat.Builder(context,"duty").setSmallIcon(android.R.drawable.ic_btn_speak_now).setContentTitle("Kettoo · On duty").setContentText(text).setContentIntent(open).setOngoing(true).build()
        }
        fun update(context:Context,text:String) { if((context.applicationContext as KettooApplication).state.value.duty) runCatching { (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(1,notification(context,text)) } }
    }
}
