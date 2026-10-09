package org.kettoo.app

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.RequestBody.Companion.asRequestBody
import org.json.JSONObject
import org.json.JSONArray
import java.io.File
import java.util.concurrent.TimeUnit

fun json(vararg pairs: Pair<String, Any?>) = JSONObject().apply { pairs.forEach { (k,v) -> if(v != null) put(k,v) } }
fun JSONArray.objects() = (0 until length()).map { getJSONObject(it) }
class ApiFailure(val status:Int,message:String):Exception(message)
class Api(private val vault: Vault) {
    private val uploading=java.util.concurrent.ConcurrentHashMap.newKeySet<Call>()
    fun pauseUploads() { uploading.forEach { it.cancel() } }
    val http = OkHttpClient.Builder().connectTimeout(8, TimeUnit.SECONDS).readTimeout(20, TimeUnit.SECONDS).build()
    val base get() = vault.get("server").trimEnd('/')
    fun request(path: String) = Request.Builder().url(base + "/api" + path).header("Authorization", "Bearer " + vault.get("token"))
    suspend fun call(path: String, body: JSONObject? = null, method: String = if(body == null) "GET" else "POST"): String = withContext(Dispatchers.IO) {
        val r = request(path).method(method, body?.toString()?.toRequestBody("application/json".toMediaType())).build()
        http.newCall(r).execute().use { response -> val text = response.body?.string() ?: "{}"; if(!response.isSuccessful)throw ApiFailure(response.code,runCatching { JSONObject(text).optString("error", "Request failed") }.getOrDefault("Request failed")); text }
    }
    suspend fun objectCall(path: String, body: JSONObject? = null) = JSONObject(call(path, body))
    suspend fun upload(cid: String, file: File, mime: String): String = uploadPath("/conversations/$cid/files",file,mime)
    suspend fun uploadPath(path:String,file: File,mime:String):String = withContext(Dispatchers.IO) {
        val form = MultipartBody.Builder().setType(MultipartBody.FORM).addFormDataPart("file", file.name, file.asRequestBody(mime.toMediaType())).build()
        val call=http.newCall(request(path).post(form).build());uploading.add(call)
        try { call.execute().use { r -> val text = r.body?.string() ?: "{}"; if(!r.isSuccessful)throw ApiFailure(r.code,JSONObject(text).optString("error", "Upload failed")); JSONObject(text).getString("id") } } finally { uploading.remove(call) }
    }
    suspend fun download(id: String, target: File) = withContext(Dispatchers.IO) {
        downloadPath("/files/$id",target)
    }
    suspend fun downloadPath(path:String,target:File) = withContext(Dispatchers.IO) {http.newCall(request(path).build()).execute().use { r -> if(!r.isSuccessful)throw ApiFailure(r.code,"Attachment unavailable");val partial=File(target.absolutePath+".partial");try{partial.outputStream().use { output -> r.body!!.byteStream().use { it.copyTo(output) } };check(partial.renameTo(target)){"Could not save image"}}finally{partial.delete()} }}
}
