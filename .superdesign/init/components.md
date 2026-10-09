# Android UI primitives and shared components
Scope: native Android app only. Kotlin, Jetpack Compose, Material 3. Browser console is a separate frontend and is outside this review.
No dedicated shared-component directory exists; primitives are embedded in MainActivity.kt. The following blocks are the exact complete implementations from the current working tree.

## Tag
Uppercase 10sp bold monospace label. Props: text, modifier.
Source: android/app/src/main/java/org/kettoo/app/MainActivity.kt

```kotlin
@Composable private fun Tag(text:String,modifier:Modifier=Modifier){Text(text.uppercase(),modifier,fontSize=10.sp,fontFamily=FontFamily.Monospace,fontWeight=FontWeight.Bold,letterSpacing=1.sp)}
```

## Brand
KETTO wordmark, outlined CellTower icon, SECURE label. No custom Android logo asset exists.
Source: android/app/src/main/java/org/kettoo/app/MainActivity.kt

```kotlin
@Composable private fun Brand(){Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(9.dp)){Icon(Icons.Outlined.CellTower,"Kettoo",Modifier.size(30.dp).border(1.dp,Color.Black).padding(4.dp));Text("KETTO",fontWeight=FontWeight.Bold,fontSize=24.sp);Text("SECURE",Modifier.background(Color.Black).padding(4.dp),color=Color.White,fontSize=10.sp,fontWeight=FontWeight.Bold)}}
```

## Action
Full-width rectangular primary action. Props: text, onClick, enabled.
Source: android/app/src/main/java/org/kettoo/app/MainActivity.kt

```kotlin
@Composable private fun Action(text:String,onClick:()->Unit,enabled:Boolean=true){Button(onClick,Modifier.fillMaxWidth(),enabled=enabled,shape=RectangleShape,contentPadding=PaddingValues(17.dp)){Tag(text)}}
```

## MessageBubble
Shared message presentation: text, attachments, audio replay, transcript, delivery state, acknowledgement and personal archive.
Source: android/app/src/main/java/org/kettoo/app/MainActivity.kt

```kotlin
@Composable private fun MessageBubble(app:KettooApplication,m:LocalMessage){val session by app.state.collectAsStateWithLifecycle()
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
```

## DictateButton
Shared offline speech input control. Props: app, target, text, onText.
Source: android/app/src/main/java/org/kettoo/app/OfflineSpeech.kt

```kotlin
@Composable fun DictateButton(app:KettooApplication,target:String,text:String,onText:(String)->Unit){
    val state by app.state.collectAsStateWithLifecycle()
    val active=state.dictating&&state.dictationTarget==target
    DisposableEffect(target){onDispose{if(app.state.value.dictationTarget==target)app.speech.stopDictation()}}
    TextButton({if(active)app.speech.stopDictation()else{val prefix=text.trim();runCatching{app.speech.startDictation(target){words->onText(listOf(prefix,words).filter{it.isNotBlank()}.joinToString(" ").take(4000))}}.onFailure(app::error)}},enabled=active||state.speechReady&&!state.dictating&&!app.media.occupied&&state.incoming==null){Text(if(active)"Stop dictation"else"Dictate offline")}
}
```

