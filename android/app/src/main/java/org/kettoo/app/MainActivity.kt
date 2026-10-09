package org.kettoo.app

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.KeyEvent
import android.view.WindowManager
import androidx.activity.compose.LocalActivity
import androidx.activity.ComponentActivity
import androidx.activity.enableEdgeToEdge
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
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
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.*

class MainActivity:ComponentActivity(){
    override fun onCreate(savedInstanceState:Bundle?){super.onCreate(savedInstanceState);enableEdgeToEdge(statusBarStyle=SystemBarStyle.light(android.graphics.Color.TRANSPARENT,android.graphics.Color.TRANSPARENT),navigationBarStyle=SystemBarStyle.light(android.graphics.Color.TRANSPARENT,android.graphics.Color.TRANSPARENT));setContent{MaterialTheme(colorScheme=lightColorScheme(primary=Color.Black,onPrimary=Color.White,secondary=Color.DarkGray,background=KettoBackground,surface=Color.White)){KettooUI(application as KettooApplication)}}}
    override fun onResume(){super.onResume();val app=application as KettooApplication;app.inForeground=true;app.media.visible(true)}
    override fun onPause(){val app=application as KettooApplication;app.inForeground=false;if(!app.hardware.held)app.media.release();app.speech.stopDictation();app.media.visible(false);super.onPause()}
    override fun onKeyDown(keyCode:Int,event:KeyEvent):Boolean=if((application as KettooApplication).hardware.key(event))true else super.onKeyDown(keyCode,event)
    override fun onKeyUp(keyCode:Int,event:KeyEvent):Boolean=if((application as KettooApplication).hardware.key(event))true else super.onKeyUp(keyCode,event)
}
@Composable private fun Tag(text:String,modifier:Modifier=Modifier){Text(text.uppercase(),modifier,fontSize=10.sp,fontFamily=FontFamily.Monospace,fontWeight=FontWeight.Bold,letterSpacing=1.sp)}
@Composable private fun Action(text:String,onClick:()->Unit,enabled:Boolean=true){Button(onClick,Modifier.fillMaxWidth(),enabled=enabled,shape=RectangleShape,contentPadding=PaddingValues(17.dp)){Tag(text)}}
@Composable fun KettooUI(app:KettooApplication){
    val s by app.state.collectAsStateWithLifecycle();var page by rememberSaveable{mutableStateOf("comms")}
    val screenStates=rememberSaveableStateHolder()
    val window=LocalActivity.current?.window
    DisposableEffect(s.pocketMode){val old=window?.attributes?.screenBrightness;if(s.pocketMode){window?.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);window?.attributes=window?.attributes?.apply{screenBrightness=0.01f}};onDispose{if(s.pocketMode){window?.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);window?.attributes=window?.attributes?.apply{screenBrightness=old ?: -1f}}}}
    if(s.pocketMode&&s.duty&&s.user!=null){Surface(Modifier.fillMaxSize(),color=Color.Black){Column(Modifier.fillMaxSize().statusBarsPadding().padding(28.dp),verticalArrangement=Arrangement.SpaceBetween){Column{Text("POCKET MODE",color=Color.Gray);Text(s.conversations.find{it.optString("id")==app.hardware.target()}?.optString("name") ?: "Team",color=Color.Gray);Text(if(s.ptt=="TRANSMITTING")"TRANSMITTING"else"Hold Volume Down to talk",color=Color.Gray)};OutlinedButton({app.patch{it.copy(pocketMode=false)}},Modifier.fillMaxWidth()){Text("Exit Pocket Mode",color=Color.White)}}};return}
    val dutyPermissions=rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()){granted->if(granted[Manifest.permission.RECORD_AUDIO]==true)app.duty(true)else app.error(Exception("Microphone permission is required for the on-duty communication service"))}
    fun enableNearby(){app.nearby.enable(true);if(!app.state.value.duty)app.duty(true)}
    val bluetoothEnable=rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()){result->if(result.resultCode==android.app.Activity.RESULT_OK)enableNearby()else app.error(Exception("Turn on Bluetooth to connect Nearby"))}
    val nearbyPermissions=rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()){granted->if(granted.filterKeys{it!=Manifest.permission.POST_NOTIFICATIONS}.values.all{it}){val adapter=app.getSystemService(BluetoothManager::class.java)?.adapter;if(adapter==null)app.error(Exception("Bluetooth is unavailable on this device"))else if(adapter.isEnabled)enableNearby()else bluetoothEnable.launch(Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE))}else app.error(Exception("Nearby and microphone permissions are required"))}
    fun changeNearby(enabled:Boolean){if(!enabled)app.nearby.enable(false)else nearbyPermissions.launch(buildList{add(Manifest.permission.RECORD_AUDIO);if(Build.VERSION.SDK_INT>=31){add(Manifest.permission.BLUETOOTH_SCAN);add(Manifest.permission.BLUETOOTH_CONNECT);add(Manifest.permission.BLUETOOTH_ADVERTISE)};if(Build.VERSION.SDK_INT>=33){add(Manifest.permission.NEARBY_WIFI_DEVICES);add(Manifest.permission.POST_NOTIFICATIONS)}else{add(Manifest.permission.ACCESS_FINE_LOCATION);add(Manifest.permission.ACCESS_COARSE_LOCATION)}}.toTypedArray())}
    var videoAccept by remember { mutableStateOf<String?>(null) }
    val cameraPermission=rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()){granted->if(granted)app.run{val pending=videoAccept;videoAccept=null;if(pending!=null)app.api.objectCall("/calls/$pending/accept",json())else app.api.objectCall("/calls",json("conversationId" to s.selected,"video" to true))}else{videoAccept=null;app.error(Exception("Camera permission denied"))}}
    fun duty(){if(s.duty)app.duty(false)else dutyPermissions.launch(buildList{add(Manifest.permission.RECORD_AUDIO);if(Build.VERSION.SDK_INT>=33)add(Manifest.permission.POST_NOTIFICATIONS)}.toTypedArray())}
    Surface(Modifier.fillMaxSize(),color=KettoBackground){Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding()){
        Row(Modifier.fillMaxWidth().padding(horizontal=20.dp,vertical=8.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.SpaceBetween){KettoBrand();if(s.user!=null)IconButton({page="settings"}){Icon(Icons.Outlined.Settings,"Settings")}}
        if(s.error.isNotEmpty()&&(s.user==null||page!="comms"))Row(Modifier.fillMaxWidth().padding(horizontal=20.dp),verticalAlignment=Alignment.CenterVertically){Text(s.error,Modifier.weight(1f),fontSize=13.sp);IconButton({app.patch{it.copy(error="")}}){Icon(Icons.Outlined.Close,"Dismiss")}}
        if(s.user==null){SignIn(app);return@Column}
        if(WindowInsets.ime.getBottom(androidx.compose.ui.platform.LocalDensity.current)==0)PhaseLocation(app)
        if(s.incoming!=null)Row(Modifier.fillMaxWidth().background(Color.Black).padding(horizontal=20.dp,vertical=10.dp),horizontalArrangement=Arrangement.spacedBy(8.dp)){Icon(Icons.Outlined.VolumeUp,null,tint=Color.White,modifier=Modifier.size(18.dp));val live=s.incoming!!;val channel=s.conversations.find{it.optString("id")==live.optString("conversation")}?.optString("name");Text("${live.optString("speakerName").ifBlank{"A teammate"}} is speaking"+(channel?.let{" · $it"} ?: "")+(if(s.call?.optString("state")=="accepted")" · missed live / in call" else ""),color=Color.White,fontSize=13.sp)}
        Box(Modifier.weight(1f)){when(page){
            "comms"->screenStates.SaveableStateProvider("comms:${s.user!!.getString("id")}"){CommsScreen(app,s,::duty,{page="people"}){video->if(video)cameraPermission.launch(Manifest.permission.CAMERA)else app.run{app.api.objectCall("/calls",json("conversationId" to s.selected,"video" to false))}}}
            "people"->PeopleScreen(app,s){page="comms"}
            "threads"->ThreadsScreen(app)
            else->screenStates.SaveableStateProvider("settings:${s.user!!.getString("id")}"){SettingsScreen(app,s,{enabled->if(enabled!=s.duty)duty()},::changeNearby)}
        }}
        NavigationBar(containerColor=Color.White){listOf("threads" to Icons.Outlined.Forum,"comms" to Icons.Outlined.Radio,"people" to Icons.Outlined.People).forEach{(key,icon)->NavigationBarItem(page==key,{page=key},icon={Icon(icon,null)},label={Text(key.uppercase(),fontSize=12.sp,fontWeight=FontWeight.SemiBold)},colors=NavigationBarItemDefaults.colors(indicatorColor=Color(0xFFE1E1E1)))}}
    }}
    val call=s.call
    if(call!=null && call.optString("state") in listOf("ringing","accepted"))AlertDialog(onDismissRequest={},title={Text("PRIVATE ${if(call.optInt("video")==1)"VIDEO" else "VOICE"} CALL")},text={Column(verticalArrangement=Arrangement.spacedBy(12.dp)){Tag(call.getString("state"));s.remoteVideo?.let{CallVideo(app,it)};s.localVideo?.let{CallVideo(app,it)};if(s.localVideo!=null)TextButton({app.media.switchCamera()}){Text("Switch camera")}}},confirmButton={if(call.optString("state")=="ringing"&&call.optString("callee_device")==app.vault.get("device"))TextButton({app.run{check(!s.recording){"Finish the voice note first"};if(call.optInt("video")==1 && ContextCompat.checkSelfPermission(app,Manifest.permission.CAMERA)!=PackageManager.PERMISSION_GRANTED){videoAccept=call.getString("id");cameraPermission.launch(Manifest.permission.CAMERA)}else app.api.objectCall("/calls/${call.getString("id")}/accept",json())}}){Text("ACCEPT")}},dismissButton={TextButton({app.run{app.api.objectCall("/calls/${call.getString("id")}/${if(call.optString("state")=="ringing"&&call.optString("callee_device")==app.vault.get("device"))"decline" else "end"}",json())}}){Text("END / DECLINE")}})
}
@Composable private fun SignIn(app:KettooApplication){var server by remember{mutableStateOf(app.vault.get("server"))};var email by remember{mutableStateOf("")};var password by remember{mutableStateOf("")};var name by remember{mutableStateOf("")};var register by remember{mutableStateOf(false)};var busy by remember{mutableStateOf(false)}
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(23.dp),verticalArrangement=Arrangement.spacedBy(18.dp)){
        Spacer(Modifier.height(8.dp));Text(if(register)"Request access"else"Sign in",fontSize=28.sp,fontWeight=FontWeight.Bold);Text("Private organisation communicator",color=Color.DarkGray)
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
@Composable internal fun MessageBubble(app:KettooApplication,m:LocalMessage){val session by app.state.collectAsStateWithLifecycle()
    Column(Modifier.fillMaxWidth().background(Color.White).padding(14.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
        Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){Tag(if(m.sender==session.user?.getString("id"))"YOU" else (session.people.find { it.optString("id")==m.sender }?.optString("name") ?: runCatching { JSONObject(m.json).optString("sender_name").ifBlank { m.sender.take(32) } }.getOrDefault(m.sender.take(32))));Tag(SimpleDateFormat("HH:mm",Locale.getDefault()).format(Date(m.createdAt)))}
        if(m.text.isNotBlank())Text(m.text,fontSize=14.sp)
        if(m.kind=="ptt")Text(if(m.state=="peer-live")"Live Nearby PTT · awaiting recording"else if(m.attachmentId.isBlank()&&m.filePath.isBlank())"Live PTT · recording unavailable"else "Push-to-talk recording",fontSize=12.sp)
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
@Composable private fun CallVideo(app:KettooApplication,track:VideoTrack){val context=androidx.compose.ui.platform.LocalContext.current;val renderer=remember(track){SurfaceViewRenderer(context).also{app.media.callRoom?.initVideoRenderer(it);track.addRenderer(it)}};DisposableEffect(track){onDispose{track.removeRenderer(renderer);renderer.release()}};AndroidView(factory={renderer},modifier=Modifier.fillMaxWidth().height(180.dp))}
