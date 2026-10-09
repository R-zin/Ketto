package org.kettoo.app

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.room.*
import kotlinx.coroutines.flow.Flow
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

@Entity(tableName = "messages")
data class LocalMessage(@PrimaryKey val id: String, val owner: String, val conversation: String, val sender: String, val kind: String, val text: String, val createdAt: Long, val state: String, val filePath: String = "", val mime: String = "", val attachmentId: String = "", val envelope: String = "", val signature: String = "", val credential: String = "", val json: String = "")
@Entity(tableName = "cache") data class Cache(@PrimaryKey val key: String, val json: String)
@Dao interface MessageDao {
    @Query("SELECT * FROM messages WHERE owner=:owner AND conversation=:cid ORDER BY createdAt") fun watch(owner: String, cid: String): Flow<List<LocalMessage>>
    @Query("SELECT * FROM messages WHERE owner=:owner AND state IN ('queued','peer-received') ORDER BY createdAt") suspend fun outbox(owner: String): List<LocalMessage>
    @Query("SELECT * FROM messages WHERE id=:id") suspend fun find(id: String): LocalMessage?
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun save(message: LocalMessage)
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun cache(cache: Cache)
    @Query("SELECT json FROM cache WHERE `key`=:key") suspend fun cached(key: String): String?
}
@Database(entities = [LocalMessage::class, Cache::class], version = 1, exportSchema = false)
abstract class LocalDatabase : RoomDatabase() { abstract fun messages(): MessageDao }

/** Session ciphertext is stored privately; the encryption key never leaves Android Keystore. */
class Vault(context: Context) {
    private val preferences = context.getSharedPreferences("kettoo", Context.MODE_PRIVATE)
    private val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    private val alias = "kettoo-session"
    private fun key(): SecretKey {
        if (!store.containsAlias(alias)) KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
        return store.getKey(alias, null) as SecretKey
    }
    fun put(name: String, value: String) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        preferences.edit().putString(name, Base64.encodeToString(cipher.iv + cipher.doFinal(value.toByteArray()), Base64.NO_WRAP)).apply()
    }
    fun get(name: String): String = runCatching {
        val raw = Base64.decode(preferences.getString(name, null) ?: return "", Base64.NO_WRAP)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, raw.copyOfRange(0,12))) }
        String(cipher.doFinal(raw.copyOfRange(12,raw.size)))
    }.getOrDefault("")
    fun clearSession() { preferences.edit().remove("token").remove("user").remove("credential").apply() }
}
