package org.kettoo.app

import android.Manifest
import android.content.pm.PackageManager
import android.media.*
import androidx.core.content.ContextCompat
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import org.vosk.Model
import org.vosk.Recognizer
import java.io.*
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.zip.ZipInputStream

/** Uses bundled English model and samples from a recording, never a cloud service. */
class OfflineSpeech(private val app:KettooApplication){
    private val modelGate=Mutex()
    private var model:Model?=null
    @Volatile private var listening=false
    private var generation=0L
    private var recorder:AudioRecord?=null
    private suspend fun model():Model=modelGate.withLock{
        model ?: withContext(Dispatchers.IO){
            val root=File(app.filesDir,"speech");val directory=File(root,"vosk-model-small-en-us-0.15")
            if(!File(directory,".ready").exists()){
                root.mkdirs()
                ZipInputStream(app.assets.open("speech-model.zip")).use{zip->
                    while(true){val entry=zip.nextEntry ?: break;val target=File(root,entry.name)
                        check(target.canonicalPath.startsWith(root.canonicalPath+File.separator)){"Invalid model archive"}
                        if(entry.isDirectory)target.mkdirs()else{target.parentFile?.mkdirs();target.outputStream().use{zip.copyTo(it)}}
                        zip.closeEntry()
                    }
                }
                File(directory,".ready").writeText("0.15")
            }
            Model(directory.absolutePath).also{model=it;app.patch{s->s.copy(speechReady=true)}}
        }
    }
    init{app.scope.launch{runCatching{model()}.onFailure{app.patch{s->s.copy(speechError="Offline model could not load. Restart the app to retry.")}}}}
    suspend fun transcribe(file:File):JSONObject=withContext(Dispatchers.Default){
        try{
            val audio=decode(file)
            val words=mutableListOf<String>()
            Recognizer(model(),16000f).use{recognizer->
                for(offset in audio.indices step 8000){
                    while(app.media.occupied||app.state.value.incoming!=null){delay(200);ensureActive()}
                    ensureActive()
                    val chunk=audio.copyOfRange(offset,(offset+8000).coerceAtMost(audio.size))
                    if(recognizer.acceptWaveForm(chunk,chunk.size))words.add(JSONObject(recognizer.result).optString("text"))
                }
                words.add(JSONObject(recognizer.finalResult).optString("text"))
            }
            val text=words.filter{it.isNotBlank()}.joinToString(" ").take(4000)
            json("text" to text,"state" to if(text.isBlank())"unavailable"else"ready","error" to if(text.isBlank())"No clear speech recognised. Listen to the recording."else"","language" to "en-US","engine" to "vosk-small-en-us-0.15")
        }catch(e:CancellationException){throw e}catch(e:Exception){json("text" to "","state" to "failed","error" to "Transcription failed. Listen to the recording.","language" to "en-US","engine" to "vosk-small-en-us-0.15")}
    }
    fun startDictation(target:String,onText:(String)->Unit){
        check(app.inForeground){"Open Kettoo before dictating"}
        check(ContextCompat.checkSelfPermission(app,Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED){"Start duty once to grant microphone access"}
        check(!app.media.occupied&&app.state.value.incoming==null){"Finish live communication before dictating"}
        check(app.state.value.call?.optString("state") !in listOf("ringing","accepted")){"Resolve the call first"}
        app.media.stopPlayback()
        listening=true;val token=++generation
        app.patch{it.copy(dictating=true,dictationTarget=target,speechError="")}
        app.scope.launch{
            try{
                val loaded=model()
                withContext(Dispatchers.IO){
                    if(!listening||token!=generation)return@withContext
                    val minimum=AudioRecord.getMinBufferSize(16000,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT)
                    check(minimum>0){"Microphone format unavailable"}
                    val audio=AudioRecord(MediaRecorder.AudioSource.MIC,16000,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT,minimum.coerceAtLeast(8192))
                    try{
                        check(audio.state==AudioRecord.STATE_INITIALIZED){"Microphone unavailable"}
                        recorder=audio;audio.startRecording();check(audio.recordingState==AudioRecord.RECORDSTATE_RECORDING)
                        val committed=mutableListOf<String>();val buffer=ByteArray(4096);val deadline=System.currentTimeMillis()+60000
                        Recognizer(loaded,16000f).use{recognizer->
                            while(listening&&token==generation&&System.currentTimeMillis()<deadline){
                                val n=audio.read(buffer,0,buffer.size);if(n<=0)break
                                val partial=if(recognizer.acceptWaveForm(buffer,n)){committed.add(JSONObject(recognizer.result).optString("text"));""}else JSONObject(recognizer.partialResult).optString("partial")
                                val text=(committed+partial).filter{it.isNotBlank()}.joinToString(" ").take(4000)
                                withContext(Dispatchers.Main){if(token==generation)onText(text)}
                            }
                            committed.add(JSONObject(recognizer.finalResult).optString("text"))
                            withContext(Dispatchers.Main){if(token==generation)onText(committed.filter{it.isNotBlank()}.joinToString(" ").take(4000))}
                        }
                    }finally{runCatching{audio.stop()};audio.release();if(recorder===audio)recorder=null}
                }
            }catch(e:Exception){if(e is CancellationException)throw e;app.error(e)}finally{
                if(token==generation){listening=false;app.patch{it.copy(dictating=false,dictationTarget="")}}
            }
        }
    }
    fun stopDictation(){listening=false;runCatching{recorder?.stop()}}
    suspend fun finishDictation(){stopDictation();withTimeout(2000){while(app.state.value.dictating)delay(20)}}

    private fun decode(file:File):ByteArray{
        require(file.isFile){"Audio file unavailable"}
        // Our PTT WAV is exactly PCM16 mono 16 kHz with the standard 44-byte header.
        if(file.extension=="wav")file.inputStream().use{input->
            val header=ByteArray(44);if(input.read(header)==44){val h=ByteBuffer.wrap(header).order(ByteOrder.LITTLE_ENDIAN)
                if(String(header,0,4)=="RIFF"&&String(header,36,4)=="data"&&h.getInt(24)==16000&&h.getShort(22).toInt()==1&&h.getShort(34).toInt()==16){val pcm=ByteArray(1120000);var size=0;while(size<pcm.size){val n=input.read(pcm,size,pcm.size-size);if(n<0)break;size+=n};return pcm.copyOf(size)}
            }
        }
        val extractor=MediaExtractor();var codec:MediaCodec?=null
        try{
            extractor.setDataSource(file.absolutePath)
            val track=(0 until extractor.trackCount).firstOrNull{extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/")==true} ?: error("No audio track")
            extractor.selectTrack(track);val format=extractor.getTrackFormat(track);val mime=format.getString(MediaFormat.KEY_MIME)!!
            var rate=format.getInteger(MediaFormat.KEY_SAMPLE_RATE);var channels=format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
            var phase=0.0;val output=ByteArrayOutputStream()
            fun pcm(data:ByteBuffer){data.order(ByteOrder.LITTLE_ENDIAN);while(data.remaining()>=channels*2&&output.size()<1120000){var sample=0;repeat(channels){sample+=data.short.toInt()};sample/=channels;phase+=16000.0/rate;while(phase>=1&&output.size()<1120000){phase-=1;output.write(sample and 255);output.write((sample shr 8) and 255)}}}
            if(mime=="audio/raw"){
                val data=ByteBuffer.allocate(65536);while(output.size()<1120000){data.clear();val n=extractor.readSampleData(data,0);if(n<0)break;data.position(0);data.limit(n);pcm(data);extractor.advance()}
            }else{
                codec=MediaCodec.createDecoderByType(mime);val decoder=codec
                format.setInteger(MediaFormat.KEY_PCM_ENCODING,AudioFormat.ENCODING_PCM_16BIT)
                decoder.configure(format,null,null,0);decoder.start()
                var ended=false;var finished=false;val info=MediaCodec.BufferInfo();val deadline=System.currentTimeMillis()+15000
                while(!finished&&output.size()<1120000&&System.currentTimeMillis()<deadline){
                    if(!ended){val index=decoder.dequeueInputBuffer(10000);if(index>=0){val data=decoder.getInputBuffer(index)!!;val n=extractor.readSampleData(data,0);if(n<0){decoder.queueInputBuffer(index,0,0,0,MediaCodec.BUFFER_FLAG_END_OF_STREAM);ended=true}else{decoder.queueInputBuffer(index,0,n,extractor.sampleTime,0);extractor.advance()}}}
                    val index=decoder.dequeueOutputBuffer(info,10000)
                    if(index==MediaCodec.INFO_OUTPUT_FORMAT_CHANGED){rate=decoder.outputFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE);channels=decoder.outputFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT)}
                    else if(index>=0){val data=decoder.getOutputBuffer(index)!!;data.position(info.offset);data.limit(info.offset+info.size);pcm(data);finished=info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM!=0;decoder.releaseOutputBuffer(index,false)}
                }
            }
            return output.toByteArray()
        }finally{runCatching{codec?.stop()};codec?.release();extractor.release()}
    }
}

@Composable fun DictateButton(app:KettooApplication,target:String,text:String,onText:(String)->Unit){
    val state by app.state.collectAsStateWithLifecycle()
    val active=state.dictating&&state.dictationTarget==target
    DisposableEffect(target){onDispose{if(app.state.value.dictationTarget==target)app.speech.stopDictation()}}
    TextButton({if(active)app.speech.stopDictation()else{val prefix=text.trim();runCatching{app.speech.startDictation(target){words->onText(listOf(prefix,words).filter{it.isNotBlank()}.joinToString(" ").take(4000))}}.onFailure(app::error)}},enabled=active||state.speechReady&&!state.dictating&&!app.media.occupied&&state.incoming==null){Text(if(active)"Stop dictation"else"Dictate offline")}
}
