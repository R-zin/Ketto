package org.kettoo.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.media.MediaPlayer
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.media.AudioManager
import android.provider.Settings
import android.view.KeyEvent
import android.view.WindowManager
import androidx.compose.ui.platform.LocalContext
import androidx.activity.compose.LocalActivity
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.FileProvider
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.livekit.android.room.track.VideoTrack
import livekit.org.webrtc.SurfaceViewRenderer
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.*

class MainActivity:ComponentActivity(){
    override fun onCreate(savedInstanceState:Bundle?){super.onCreate(savedInstanceState);setContent{MaterialTheme(colorScheme=lightColorScheme(primary=Color.Black,onPrimary=Color.White,secondary=Color.DarkGray,background=Color(0xFFF8F8F7),surface=Color.White)){KettooUI(application as KettooApplication)}}}
    override fun onResume(){super.onResume();val app=application as KettooApplication;app.inForeground=true;app.media.visible(true)}
    override fun onPause(){val app=application as KettooApplication;app.inForeground=false;if(!app.hardware.held)app.media.release();app.speech.stopDictation();app.media.visible(false);super.onPause()}
    override fun onKeyDown(keyCode:Int,event:KeyEvent):Boolean=if((application as KettooApplication).hardware.key(event))true else super.onKeyDown(keyCode,event)
    override fun onKeyUp(keyCode:Int,event:KeyEvent):Boolean=if((application as KettooApplication).hardware.key(event))true else super.onKeyUp(keyCode,event)
}
@Composable private fun Tag(text:String,modifier:Modifier=Modifier){Text(text.uppercase(),modifier,fontSize=10.sp,fontFamily=FontFamily.Monospace,fontWeight=FontWeight.Bold,letterSpacing=1.sp)}
@Composable private fun Brand(){Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(9.dp)){Icon(Icons.Outlined.CellTower,"Kettoo",Modifier.size(30.dp).border(1.dp,Color.Black).padding(4.dp));Text("KETTO",fontWeight=FontWeight.Bold,fontSize=24.sp);Text("SECURE",Modifier.background(Color.Black).padding(4.dp),color=Color.White,fontSize=10.sp,fontWeight=FontWeight.Bold)}}
@Composable private fun Action(text:String,onClick:()->Unit,enabled:Boolean=true){Button(onClick,Modifier.fillMaxWidth(),enabled=enabled,shape=RectangleShape,contentPadding=PaddingValues(17.dp)){Tag(text)}}
@Composable fun KettooUI(app:KettooApplication){
    val s by app.state.collectAsStateWithLifecycle();var page by remember{mutableStateOf("comms")}
    val window=LocalActivity.current?.window
    DisposableEffect(s.pocketMode){val old=window?.attributes?.screenBrightness;if(s.pocketMode){window?.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);window?.attributes=window?.attributes?.apply{screenBrightness=0.01f}};onDispose{if(s.pocketMode){window?.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);window?.attributes=window?.attributes?.apply{screenBrightness=old ?: -1f}}}}
    if(s.pocketMode&&s.duty&&s.user!=null){Surface(Modifier.fillMaxSize(),color=Color.Black){Column(Modifier.fillMaxSize().statusBarsPadding().padding(28.dp),verticalArrangement=Arrangement.SpaceBetween){Column{Text("POCKET MODE",color=Color.Gray);Text(s.conversations.find{it.optString("id")==app.hardware.target()}?.optString("name") ?: "Team",color=Color.Gray);Text(if(s.ptt=="TRANSMITTING")"TRANSMITTING"else"Hold Volume Down to talk",color=Color.Gray)};OutlinedButton({app.patch{it.copy(pocketMode=false)}},Modifier.fillMaxWidth()){Text("Exit Pocket Mode",color=Color.White)}}};return}
    val dutyPermissions=rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()){granted->if(granted[Manifest.permission.RECORD_AUDIO]==true)app.duty(true)else app.error(Exception("Microphone permission is required for the on-duty communication service"))}
    val nearbyPermissions=rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()){granted->if(granted.values.all{it})app.nearby.start()else app.error(Exception("Nearby permissions are required for direct connections"))}
    var videoAccept by remember { mutableStateOf<String?>(null) }
    val cameraPermission=rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()){granted->if(granted)app.run{val pending=videoAccept;videoAccept=null;if(pending!=null)app.api.objectCall("/calls/$pending/accept",json())else app.api.objectCall("/calls",json("conversationId" to s.selected,"video" to true))}else{videoAccept=null;app.error(Exception("Camera permission denied"))}}
    fun duty(){if(s.duty)app.duty(false)else dutyPermissions.launch(buildList{add(Manifest.permission.RECORD_AUDIO);if(Build.VERSION.SDK_INT>=33)add(Manifest.permission.POST_NOTIFICATIONS)}.toTypedArray())}
    Surface(Modifier.fillMaxSize(),color=Color(0xFFF8F8F7)){Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()){
        Row(Modifier.fillMaxWidth().padding(20.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.SpaceBetween){Brand();if(s.user!=null)IconButton({page="settings"}){Icon(Icons.Outlined.Person,"Settings")}}
        HorizontalDivider()
        if(s.error.isNotEmpty())Row(Modifier.fillMaxWidth().background(Color(0xFFE8E8E8)).padding(12.dp),verticalAlignment=Alignment.CenterVertically){Text(s.error,Modifier.weight(1f),fontSize=12.sp);IconButton({app.patch{it.copy(error="")}}){Icon(Icons.Outlined.Close,"Dismiss")}}
        if(s.user==null){SignIn(app);return@Column}
        PhaseLocation(app)
        if(s.incoming!=null)Row(Modifier.fillMaxWidth().background(Color.Black).padding(12.dp),horizontalArrangement=Arrangement.spacedBy(10.dp)){Icon(Icons.Outlined.VolumeUp,null,tint=Color.White);Text("${s.incoming!!.optString("speakerName")} IS LIVE"+(if(s.call?.optString("state")=="accepted")" · MISSED LIVE / IN CALL" else ""),color=Color.White,fontSize=11.sp)}
        Box(Modifier.weight(1f)){when(page){
            "comms"->Conversation(app,s,::duty){video->if(video)cameraPermission.launch(Manifest.permission.CAMERA)else app.run{app.api.objectCall("/calls",json("conversationId" to s.selected,"video" to false))}}
            "people"->LazyColumn(Modifier.padding(20.dp),verticalArrangement=Arrangement.spacedBy(12.dp)){item{Tag("DIRECTORY / APPROVED MEMBERS");Text("Your people.",fontSize=28.sp,fontWeight=FontWeight.Bold)};items(s.people.filter{it.getString("id")!=s.user!!.getString("id")}){p->OutlinedButton({app.run{app.privateChat(p.getString("id"));page="comms"}},Modifier.fillMaxWidth(),shape=RectangleShape){Column(Modifier.weight(1f).padding(12.dp)){Text(p.getString("name"),fontWeight=FontWeight.Bold);Tag(p.getString("role"))};Icon(Icons.Outlined.ArrowForward,null)}}}
            "threads"->ThreadsScreen(app)
            else->Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(22.dp),verticalArrangement=Arrangement.spacedBy(20.dp)){
                Tag("OPERATOR / SESSION");Text(s.user!!.getString("name"),fontSize=27.sp,fontWeight=FontWeight.Bold)
                Tag(if(s.connected)"SERVER CONNECTED" else "SERVER UNREACHABLE");Tag("${s.mediaRooms.size} AUDIO ROOMS")
                Action(if(s.duty)"END DUTY" else "START DUTY",::duty)
                Tag("AUDIO OUTPUT / ${s.audioOutput}")
                s.audioOutputs.forEach { name -> OutlinedButton({app.media.audioRouting.select(name)},shape=RectangleShape){Text(name)} }
                ListeningVolume()
                Row(verticalAlignment=Alignment.CenterVertically){Checkbox(s.hardwarePtt,{v->app.hardware.cancel();app.vault.put("hardwarePtt",v.toString());app.patch{it.copy(hardwarePtt=v)}});Text("Volume Down: hold to talk",fontSize=13.sp)}
                Text(if(s.hardwarePtt)"Volume Down is PTT while on duty. Volume Up and the listening slider adjust volume."else"Use volume buttons normally, or enable hardware PTT.",fontSize=12.sp,color=Color.Gray)
                Text("Hardware target: "+(s.conversations.find{it.optString("id")==app.hardware.target()}?.optString("name") ?: "Assigned team"),fontSize=12.sp)
                Text(if(s.hardwareAvailable)"Background key service enabled"else"Foreground keys work. Enable the optional accessibility service for background keys.",fontSize=11.sp)
                OutlinedButton({app.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))},shape=RectangleShape){Text("Enable background PTT keys")}
                Text("Sideloaded apps may need App info → Allow restricted settings. Screen-off keys depend on the phone; Pocket Mode keeps Kettoo awake.",fontSize=11.sp,color=Color.Gray)
                Action("POCKET MODE",{app.patch{it.copy(pocketMode=true)}},s.duty&&s.hardwarePtt)
                Text(if(s.speechReady)"Offline English transcription ready"else s.speechError.ifBlank{"Preparing offline English model…"},fontSize=12.sp)
                Row(verticalAlignment=Alignment.CenterVertically){Checkbox(s.conserve,{v->app.patch{it.copy(conserve=v)}});Text("Conserve data: disable video",fontSize=13.sp)}
                HorizontalDivider();Tag("NEARBY / DIRECT DEVICE FALLBACK");Text("One authenticated peer. Text and recorded audio notes. Not a venue-wide broadcast.",fontSize=13.sp)
                Tag(s.nearbyStatus)
                Action("FIND NEARBY PEER",{nearbyPermissions.launch(buildList{if(Build.VERSION.SDK_INT>=31){add(Manifest.permission.BLUETOOTH_SCAN);add(Manifest.permission.BLUETOOTH_CONNECT);add(Manifest.permission.BLUETOOTH_ADVERTISE)};if(Build.VERSION.SDK_INT>=33)add(Manifest.permission.NEARBY_WIFI_DEVICES)else {add(Manifest.permission.ACCESS_FINE_LOCATION);add(Manifest.permission.ACCESS_COARSE_LOCATION)}}.toTypedArray())},!s.connected)
                s.peers.forEach{(id,name)->OutlinedButton({app.nearby.connect(id)},Modifier.fillMaxWidth(),shape=RectangleShape){Text("$name · ${id.takeLast(4)}")}}
                if(s.authenticatedPeer!=null)Action("RETRY QUEUED NOTES & TEXT",{app.nearby.retry()})
                OutlinedButton({app.nearby.stop()},shape=RectangleShape){Text("Stop nearby")}
                Text("Offline credentials expire after eight hours. New permissions and revocations require server contact.",fontSize=12.sp,color=Color.Gray)
                Action("RETRY SERVER QUEUE",{app.run{app.flush()}})
                Action("SIGN OUT",{app.run{app.logout()}})
            }
        }}
        NavigationBar(containerColor=Color.White){listOf("comms" to Icons.Outlined.Radio,"threads" to Icons.Outlined.Forum,"people" to Icons.Outlined.People,"settings" to Icons.Outlined.Settings).forEach{(key,icon)->NavigationBarItem(page==key,{page=key},icon={Icon(icon,key)},label={Tag(if(key=="comms")"COMMS" else key)},colors=NavigationBarItemDefaults.colors(indicatorColor=Color(0xFFE1E1E1)))}}
    }}
    val call=s.call
    if(call!=null && call.optString("state") in listOf("ringing","accepted"))AlertDialog(onDismissRequest={},title={Text("PRIVATE ${if(call.optInt("video")==1)"VIDEO" else "VOICE"} CALL")},text={Column(verticalArrangement=Arrangement.spacedBy(12.dp)){Tag(call.getString("state"));s.remoteVideo?.let{CallVideo(app,it)};s.localVideo?.let{CallVideo(app,it)};if(s.localVideo!=null)TextButton({app.media.switchCamera()}){Text("Switch camera")}}},confirmButton={if(call.optString("state")=="ringing"&&call.optString("callee_device")==app.vault.get("device"))TextButton({app.run{check(!s.recording){"Finish the voice note first"};if(call.optInt("video")==1 && ContextCompat.checkSelfPermission(app,Manifest.permission.CAMERA)!=PackageManager.PERMISSION_GRANTED){videoAccept=call.getString("id");cameraPermission.launch(Manifest.permission.CAMERA)}else app.api.objectCall("/calls/${call.getString("id")}/accept",json())}}){Text("ACCEPT")}},dismissButton={TextButton({app.run{app.api.objectCall("/calls/${call.getString("id")}/${if(call.optString("state")=="ringing"&&call.optString("callee_device")==app.vault.get("device"))"decline" else "end"}",json())}}){Text("END / DECLINE")}})
}
@Composable private fun SignIn(app:KettooApplication){var server by remember{mutableStateOf(app.vault.get("server"))};var email by remember{mutableStateOf("")};var password by remember{mutableStateOf("")};var name by remember{mutableStateOf("")};var register by remember{mutableStateOf(false)};var busy by remember{mutableStateOf(false)}
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(23.dp),verticalArrangement=Arrangement.spacedBy(18.dp)){
        Spacer(Modifier.height(8.dp));Text("KETTO",fontSize=32.sp,fontWeight=FontWeight.Bold);Text("Private organisation communicator",color=Color.DarkGray)
        Column(Modifier.border(1.dp,Color.Black).padding(23.dp),verticalArrangement=Arrangement.spacedBy(19.dp)){
            Tag(if(register)"REQUEST MEMBERSHIP" else "NODE SIGN-IN");HorizontalDivider()
            OutlinedTextField(server,{server=it},label={Tag("ORGANISATION HTTPS SERVER")},placeholder={Text("https://kettoo.local")},singleLine=true,shape=RectangleShape,modifier=Modifier.fillMaxWidth())
            if(register)OutlinedTextField(name,{name=it},label={Tag("OPERATOR NAME")},shape=RectangleShape,modifier=Modifier.fillMaxWidth())
            OutlinedTextField(email,{email=it},label={Tag("OPERATOR EMAIL")},singleLine=true,shape=RectangleShape,modifier=Modifier.fillMaxWidth())
            OutlinedTextField(password,{password=it},label={Tag("ACCESS PASSWORD")},visualTransformation=PasswordVisualTransformation(),singleLine=true,shape=RectangleShape,modifier=Modifier.fillMaxWidth())
            Text("Account and device approval are required. Passwords have at least 12 characters.",fontSize=12.sp,color=Color.Gray)
            Action(if(busy)"CONNECTING…" else if(register)"REQUEST ACCESS" else "CONNECT TO DISPATCH",{busy=true;app.run{try{app.login(server,email,password,if(register)name else null)}finally{busy=false}}},!busy)
            TextButton({register=!register}){Text(if(register)"Back to sign-in" else "New operator? Request access",fontSize=12.sp)}
        }
        Column(Modifier.border(1.dp,Color.LightGray).padding(18.dp),verticalArrangement=Arrangement.spacedBy(10.dp)){Tag("ORGANISATION CONTROLLED");Text("Receive live audio while on duty. Nearby fallback requires prior device enrolment and a valid organisation credential.",fontSize=13.sp)}
    }
}
@Composable private fun Conversation(app:KettooApplication,s:AppState,duty:()->Unit,call:(Boolean)->Unit){
    var text by remember{mutableStateOf("")};var voice by remember{mutableStateOf(true)}
    var archived by remember(s.selected){mutableStateOf(false)}
    val current=s.conversations.find{it.getString("id")==s.selected}
    val uid=s.user!!.getString("id")
    val history by remember(uid,s.selected){if(s.selected.isBlank())flowOf(emptyList())else app.dao.watch(uid,s.selected)}.collectAsState(initial=emptyList())
    val picker=rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()){uri:Uri?->if(uri!=null)app.run{
        val mime=app.contentResolver.getType(uri) ?: error("Unknown file type")
        val kind=when{mime.startsWith("image/")->"image";mime.startsWith("video/")->"video";mime.startsWith("audio/")->"voice";else->error("Unsupported attachment")}
        check(!(s.conserve&&kind=="video")){"Conserve data disables video"}
        val cap=if(kind=="image")5*1024*1024 else if(kind=="voice")1024*1024 else 10*1024*1024
        val file=File(app.filesDir,"attachments/${UUID.randomUUID()}.${when(kind){"image"->"jpg";"video"->"mp4";else->"m4a"}}")
        withContext(Dispatchers.IO){try{app.contentResolver.openInputStream(uri)!!.use{input->file.outputStream().use{output->val b=ByteArray(8192);var total=0;while(true){val n=input.read(b);if(n<0)break;total+=n;check(total<=cap){"Attachment is too large"};output.write(b,0,n)}}}}catch(e:Exception){file.delete();throw e}}
        app.queue(s.selected,kind,file=file,mime=mime)
    }}
    LazyColumn(Modifier.fillMaxSize().padding(horizontal=20.dp),verticalArrangement=Arrangement.spacedBy(16.dp),contentPadding=PaddingValues(vertical=20.dp)){
        item{PhaseComms(app)}
        item{Row(Modifier.horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)){s.conversations.forEach{c->OutlinedButton({app.select(c.getString("id"))},shape=RectangleShape,colors=ButtonDefaults.outlinedButtonColors(containerColor=if(s.selected==c.getString("id"))Color.Black else Color.White,contentColor=if(s.selected==c.getString("id"))Color.White else Color.Black)){Text(c.getString("name"),fontSize=12.sp)}}}}
        if(current==null){item{Text("Your administrator will assign conversations here.")};return@LazyColumn}
        item{Row(Modifier.fillMaxWidth().background(Color(0xFFF0F0F0)).padding(16.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)){Box(Modifier.size(49.dp).background(Color.Black,CircleShape),contentAlignment=Alignment.Center){Icon(if(current.getString("kind")=="private")Icons.Outlined.Lock else Icons.Outlined.Radio,null,tint=Color.White)};Column(Modifier.weight(1f)){Text(current.getString("name"),fontSize=21.sp,fontWeight=FontWeight.Bold);Tag(if(current.getString("kind")=="private")"DIRECT / PRIVATE COMMS" else "CHANNEL / TEAM COMMS")}}}
        item{Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){Tag(if(s.connected)"SERVER CONNECTED" else "SERVER UNREACHABLE");Tag(if(s.selected in s.mediaRooms)"AUDIO CONNECTED" else "AUDIO OFFLINE")}}
        item{Row(Modifier.fillMaxWidth().background(Color(0xFFE5E5E5)).padding(4.dp)){Button({voice=true},Modifier.weight(1f),shape=RectangleShape,colors=ButtonDefaults.buttonColors(containerColor=if(voice)Color.Black else Color.Transparent,contentColor=if(voice)Color.White else Color.Black)){Tag("LIVE VOICE")};Button({voice=false},Modifier.weight(1f),shape=RectangleShape,colors=ButtonDefaults.buttonColors(containerColor=if(!voice)Color.Black else Color.Transparent,contentColor=if(!voice)Color.White else Color.Black)){Tag("MESSAGE LOG")}}}
        if(voice){
            item{Column(Modifier.fillMaxWidth().background(Color(0xFFF0F0F0)).padding(16.dp),verticalArrangement=Arrangement.spacedBy(14.dp)){Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){Tag("VOICE SESSION");Tag(if(current.getString("kind")=="private")"ISOLATED 1-ON-1" else "ONE SPEAKER")};Column(Modifier.fillMaxWidth().background(Color.White).padding(13.dp)){Tag("${s.ptt} // ${if(s.selected in s.mediaRooms)"READY" else "NOT READY"}");Row(Modifier.fillMaxWidth().height(32.dp),horizontalArrangement=Arrangement.SpaceBetween,verticalAlignment=Alignment.Bottom){repeat(28){Box(Modifier.width(4.dp).height((4+it*17%23).dp).background(if(s.ptt=="TRANSMITTING")Color.Black else Color.LightGray))}}};Text("Hold to request a speaking slot. Speak after TRANSMITTING appears. Maximum 30 seconds.",fontSize=12.sp,color=Color.DarkGray)}}
            item{val allowed=s.connected&&s.duty&&s.selected in s.mediaRooms&&current.optBoolean("pttAllowed",true)&&!s.recording&&s.call?.optString("state")!="accepted"&&(current.getString("kind")!="broadcast"||s.user.optString("role")=="admin")
                Box(Modifier.fillMaxWidth().padding(vertical=20.dp),contentAlignment=Alignment.Center){Column(Modifier.size(255.dp).border(13.dp,Color(0xFFE8E8E8),CircleShape).padding(13.dp).background(if(s.ptt=="TRANSMITTING")Color.Black else Color.White,CircleShape).pointerInput(allowed,s.selected){if(allowed)detectTapGestures(onPress={app.media.press(s.selected);try{tryAwaitRelease()}finally{app.media.release()}})},horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.Center){val color=if(s.ptt=="TRANSMITTING")Color.White else if(allowed)Color.Black else Color.Gray;Icon(Icons.Outlined.Mic,"Hold to transmit",Modifier.size(49.dp),tint=color);Text(if(s.ptt=="TRANSMITTING")"LIVE" else "TALK",fontSize=26.sp,fontWeight=FontWeight.Bold,color=color);Text(if(allowed)"HOLD TO TRANSMIT" else "AUDIO NOT READY",fontFamily=FontFamily.Monospace,fontSize=10.sp,color=color)}}}
            if(!s.duty)item{Action("START ON-DUTY SESSION",duty)}
        }
        if(current.getString("kind")=="private")item{Row(horizontalArrangement=Arrangement.spacedBy(10.dp)){OutlinedButton({call(false)},Modifier.weight(1f),enabled=s.duty&&s.connected&&!s.recording,shape=RectangleShape){Icon(Icons.Outlined.Call,null);Text("Voice")};OutlinedButton({call(true)},Modifier.weight(1f),enabled=s.duty&&s.connected&&!s.conserve&&!s.recording,shape=RectangleShape){Icon(Icons.Outlined.Videocam,null);Text("Video")}}}
        if(!current.optBoolean("pttAllowed",true))item{Text("Private text and calls are available. Live PTT is limited to teammates or the duty admin.",fontSize=11.sp,color=Color(0xFF936319))}
        item{Row(horizontalArrangement=Arrangement.spacedBy(10.dp)){OutlinedButton({archived=false},shape=RectangleShape){Text("Log"+(if(!archived)" ✓"else""))};OutlinedButton({archived=true},shape=RectangleShape){Icon(Icons.Outlined.Folder,null);Text("Archived (${history.count{it.archived}})"+(if(archived)" ✓"else""))}}}
        item{Tag(if(archived)"ARCHIVED / ONLY FOR YOU"else"COMMUNICATION LOG")}
        val visible=history.filter{it.archived==archived}
        items(if(voice&&!archived)visible.takeLast(5)else visible,key={it.id}){m->MessageBubble(app,m)}
        if(visible.isEmpty())item{Text(if(archived)"Acknowledged messages appear here."else"No unacknowledged messages.",color=Color.Gray,fontSize=13.sp)}
        if(!archived&&(current.getString("kind")!="broadcast"||s.user.optString("role")=="admin"))item{Column(verticalArrangement=Arrangement.spacedBy(8.dp)){OutlinedTextField(text,{text=it},Modifier.fillMaxWidth(),placeholder={Text("Write to your team…")},shape=RectangleShape);DictateButton(app,"chat:${s.selected}",text){text=it};Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){IconButton({picker.launch(arrayOf("image/*","video/*","audio/*"))}){Icon(Icons.Outlined.AttachFile,"Attach")};OutlinedButton({app.run{if(s.recording)app.media.stopNote()else{check(s.duty){"Start duty before recording"};app.media.startNote(s.selected)}}},shape=RectangleShape){Icon(if(s.recording)Icons.Outlined.Stop else Icons.Outlined.Mic,null);Text(if(s.recording)"Stop note" else "Voice note",fontSize=11.sp)};Button({val body=text.trim();if(body.isNotEmpty()){app.speech.stopDictation();app.run{app.queue(s.selected,"text",body)};text=""}},shape=RectangleShape){Icon(Icons.Outlined.Send,"Send")}}}}
    }
}
@Composable private fun MessageBubble(app:KettooApplication,m:LocalMessage){val session by app.state.collectAsStateWithLifecycle()
    Column(Modifier.fillMaxWidth().background(Color.White).padding(14.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
        Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){Tag(if(m.sender==session.user?.getString("id"))"YOU" else (session.people.find { it.optString("id")==m.sender }?.optString("name") ?: runCatching { JSONObject(m.json).optString("sender_name").ifBlank { m.sender.take(32) } }.getOrDefault(m.sender.take(32))));Tag(SimpleDateFormat("HH:mm",Locale.getDefault()).format(Date(m.createdAt)))}
        if(m.text.isNotBlank())Text(m.text,fontSize=14.sp)
        if(m.kind=="ptt")Text(if(m.attachmentId.isBlank())"Live PTT · recording unavailable" else "Push-to-talk recording",fontSize=12.sp)
        if(m.filePath.isNotBlank()||m.attachmentId.isNotBlank())TextButton({app.run{
            check(!app.media.occupied){"Finish live communication before playback"}
            val file=if(m.filePath.isNotBlank()&&File(m.filePath).exists())File(m.filePath)else File(app.filesDir,"attachments/${m.id}.${if(m.kind=="image")"jpg" else if(m.kind=="video")"mp4" else "audio"}").also{app.api.download(m.attachmentId,it);app.dao.save(m.copy(filePath=it.absolutePath))}
            if(m.kind in listOf("voice","ptt")){app.media.play(file)}
            else {val uri=FileProvider.getUriForFile(app,"org.kettoo.app.files",file);val mime=if(m.mime.isNotBlank())m.mime else if(m.kind=="image")"image/*" else "video/*";app.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri,mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK))}
        }}){Icon(Icons.Outlined.PlayArrow,null);Text(if(m.kind in listOf("voice","ptt"))"Play audio" else "View attachment")}
        if(m.kind in listOf("voice","ptt")){Column(Modifier.fillMaxWidth().background(Color(0xFFF3F3F1)).padding(10.dp),verticalArrangement=Arrangement.spacedBy(5.dp)){Tag("TRANSCRIPT / AUTOMATIC");Text(m.transcript.ifBlank{when(m.transcriptState){"pending","processing"->"Transcribing…";"failed","unavailable"->m.transcriptError.ifBlank{"Transcript unavailable. Listen to the audio."};else->if(m.kind=="ptt"&&JSONObject(m.json.ifBlank{"{}"}).optString("status")=="live")"Transcript appears after the live burst."else"Transcript unavailable. Listen to the audio."}},fontSize=13.sp);if(session.connected&&m.attachmentId.isNotBlank()&&m.transcriptState in listOf("failed","unavailable",""))TextButton({app.run{app.receive(app.api.objectCall("/messages/${m.id}/transcript/retry",json()))}}){Text("Retry transcript",fontSize=11.sp)}}}
        Tag(m.state.replace('-',' ') + if(m.state=="queued")" · NOT DELIVERED" else "")
        if(m.archived)Tag("ARCHIVED FOR YOU")else if(m.state !in listOf("queued","peer-received"))TextButton({app.run{app.phase3.acknowledge(m)}},enabled=session.connected){Icon(Icons.Outlined.Check,null);Text("Acknowledge & archive",fontSize=11.sp)}
    }
}
@Composable private fun ListeningVolume(){val context=LocalContext.current;val audio=remember{context.getSystemService(android.content.Context.AUDIO_SERVICE) as AudioManager};val maximum=audio.getStreamMaxVolume(AudioManager.STREAM_VOICE_CALL).coerceAtLeast(1);var volume by remember{mutableFloatStateOf(audio.getStreamVolume(AudioManager.STREAM_VOICE_CALL).toFloat())};Column{Text("Listening volume",fontSize=12.sp);Slider(volume,{volume=it;audio.setStreamVolume(AudioManager.STREAM_VOICE_CALL,it.toInt(),0)},valueRange=0f..maximum.toFloat(),steps=(maximum-1).coerceAtLeast(0))}}
@Composable private fun CallVideo(app:KettooApplication,track:VideoTrack){val context=androidx.compose.ui.platform.LocalContext.current;val renderer=remember(track){SurfaceViewRenderer(context).also{app.media.callRoom?.initVideoRenderer(it);track.addRenderer(it)}};DisposableEffect(track){onDispose{track.removeRenderer(renderer);renderer.release()}};AndroidView(factory={renderer},modifier=Modifier.fillMaxWidth().height(180.dp))}
