package snowsig.music.data.auth

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.first
import kotlinx.serialization.json.Json
import snowsig.music.data.api.UserDto
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.inject.Inject
import javax.inject.Singleton

private val Context.sessionStore by preferencesDataStore(name = "session")

/**
 * Keeps the refresh token in DataStore, encrypted with AES-256-GCM using a key that lives in
 * the Android Keystore and never leaves it. The user profile is stored as plain JSON (it isn't
 * secret) so the app can start offline. If the key is gone (e.g. app data restored onto another
 * device), the stored token can't be decrypted and the user simply logs in again.
 */
@Singleton
class KeystoreTokenStore @Inject constructor(
    @ApplicationContext private val context: Context,
    private val json: Json,
) : TokenStore {
    private val tokenKey = stringPreferencesKey("refresh_token")
    private val userKey = stringPreferencesKey("user")

    override suspend fun read(): StoredSession? {
        val prefs = context.sessionStore.data.first()
        val encrypted = prefs[tokenKey] ?: return null
        val token = runCatching { decrypt(encrypted) }.getOrNull()
        if (token == null) {
            clear()
            return null
        }
        val user = prefs[userKey]?.let { runCatching { json.decodeFromString<UserDto>(it) }.getOrNull() }
        return StoredSession(token, user)
    }

    override suspend fun save(refreshToken: String, user: UserDto) {
        val encrypted = encrypt(refreshToken)
        context.sessionStore.edit {
            it[tokenKey] = encrypted
            it[userKey] = json.encodeToString(UserDto.serializer(), user)
        }
    }

    override suspend fun clear() {
        context.sessionStore.edit { it.clear() }
    }

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    private fun encrypt(plain: String): String {
        val cipher = Cipher.getInstance(TRANSFORMATION).apply { init(Cipher.ENCRYPT_MODE, key()) }
        val ct = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
        return b64(cipher.iv) + ":" + b64(ct)
    }

    private fun decrypt(stored: String): String {
        val (iv, ct) = stored.split(":").also { require(it.size == 2) }.map { Base64.decode(it, Base64.NO_WRAP) }
        val cipher = Cipher.getInstance(TRANSFORMATION).apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, iv)) }
        return String(cipher.doFinal(ct), Charsets.UTF_8)
    }

    private fun b64(bytes: ByteArray) = Base64.encodeToString(bytes, Base64.NO_WRAP)

    private companion object {
        const val KEYSTORE = "AndroidKeyStore"
        const val ALIAS = "music_session_key"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
    }
}
