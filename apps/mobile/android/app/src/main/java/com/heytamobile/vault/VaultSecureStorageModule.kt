package com.heytamobile.vault

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import org.json.JSONObject
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * The mobile vault root-key store.
 *
 * The value in SharedPreferences is an AES-GCM envelope. The AES key is a
 * non-exportable key in AndroidKeyStore and is deliberately unrelated to the
 * widget key. The plaintext root key exists only for the duration of this
 * bridge call (and, on the JS side, the caller's unlocked session).
 *
 * This module has no implicit write path. Saving is an explicit user choice;
 * sync failures never call [remove].
 */
class VaultSecureStorageModule(
    private val context: ReactApplicationContext,
) : ReactContextBaseJavaModule(context) {

    private val preferences by lazy {
        context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
    }

    override fun getName(): String = NAME

    @ReactMethod
    fun load(serverOrigin: String, accountId: String, promise: Promise) {
        try {
            promise.resolve(VaultSecureStorage.load(preferences, serverOrigin, accountId))
        } catch (error: Throwable) {
            promise.reject(ERR_LOAD, error.message ?: "读取安全存储失败", error)
        }
    }

    @ReactMethod
    fun save(serverOrigin: String, accountId: String, rootKeyBase64: String, promise: Promise) {
        try {
            VaultSecureStorage.save(preferences, serverOrigin, accountId, rootKeyBase64)
            promise.resolve(true)
        } catch (error: Throwable) {
            // Do not remove or overwrite the previous envelope on failure.
            promise.reject(ERR_SAVE, error.message ?: "写入安全存储失败", error)
        }
    }

    @ReactMethod
    fun remove(serverOrigin: String, accountId: String, promise: Promise) {
        try {
            VaultSecureStorage.remove(preferences, serverOrigin, accountId)
            promise.resolve(true)
        } catch (error: Throwable) {
            promise.reject(ERR_REMOVE, error.message ?: "清除安全存储失败", error)
        }
    }

    companion object {
        const val NAME = "HeytaVaultSecureStorage"
        const val PREFERENCES = "heyta_vault_secure_storage_v1"
        private const val ERR_LOAD = "E_VAULT_SECURE_LOAD"
        private const val ERR_SAVE = "E_VAULT_SECURE_SAVE"
        private const val ERR_REMOVE = "E_VAULT_SECURE_REMOVE"
    }
}

/** Android implementation kept separate from the RN module so its invariants are testable. */
internal object VaultSecureStorage {
    private const val KEYSTORE = "AndroidKeyStore"
    /** Never reuse the widget alias: this key wraps vault root keys only. */
    private const val WRAP_KEY_ALIAS = "heyta_vault_root_wrap_key_v1"
    private const val KEY_PREFIX = "scope_"
    private const val ENVELOPE_VERSION = 1
    private const val GCM_TAG_BITS = 128
    private const val GCM_NONCE_BYTES = 12
    private const val ROOT_KEY_BYTES = 32
    private const val TRANSFORMATION = "AES/GCM/NoPadding"

    fun load(preferences: android.content.SharedPreferences, serverOrigin: String, accountId: String): String? {
        val scope = Scope.of(serverOrigin, accountId)
        val raw = preferences.getString(preferenceKey(scope), null) ?: return null
        val envelope = parseEnvelope(raw, scope)
        val plain = cipher(Cipher.DECRYPT_MODE, wrappingKey(), envelope.nonce, scope.aad)
            .doFinal(envelope.ciphertext)
        require(plain.size == ROOT_KEY_BYTES) { "存储的 vault root key 长度无效" }
        return Base64.encodeToString(plain, Base64.NO_WRAP)
    }

    fun save(
        preferences: android.content.SharedPreferences,
        serverOrigin: String,
        accountId: String,
        rootKeyBase64: String,
    ) {
        val scope = Scope.of(serverOrigin, accountId)
        val root = decodeRootKey(rootKeyBase64)
        val nonce = ByteArray(GCM_NONCE_BYTES).also { SecureRandom().nextBytes(it) }
        val encrypted = cipher(Cipher.ENCRYPT_MODE, wrappingKey(), nonce, scope.aad).doFinal(root)
        val envelope = JSONObject()
            .put("v", ENVELOPE_VERSION)
            .put("scope", scope.digestHex)
            .put("iv", Base64.encodeToString(nonce, Base64.NO_WRAP))
            .put("ciphertext", Base64.encodeToString(encrypted, Base64.NO_WRAP))
            .toString()

        // commit() is intentional: the caller may be killed immediately after
        // a user explicitly opts in. putString happens before the commit, so a
        // failed commit cannot turn a sync error into deletion of the old value.
        check(preferences.edit().putString(preferenceKey(scope), envelope).commit()) {
            "安全存储未能同步落盘"
        }
    }

    fun remove(preferences: android.content.SharedPreferences, serverOrigin: String, accountId: String) {
        val scope = Scope.of(serverOrigin, accountId)
        check(preferences.edit().remove(preferenceKey(scope)).commit()) {
            "安全存储清除未能同步落盘"
        }
    }

    private fun wrappingKey(): SecretKey {
        val store = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (store.getEntry(WRAP_KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)?.secretKey?.let { return it }

        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(
                WRAP_KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                // The nonce is stored with the envelope, so it must be caller supplied.
                .setRandomizedEncryptionRequired(false)
                .setUserAuthenticationRequired(false)
                .build(),
        )
        return generator.generateKey()
    }

    private fun cipher(mode: Int, key: SecretKey, nonce: ByteArray, aad: ByteArray): Cipher =
        Cipher.getInstance(TRANSFORMATION).also {
            it.init(mode, key, GCMParameterSpec(GCM_TAG_BITS, nonce))
            it.updateAAD(aad)
        }

    private fun decodeRootKey(value: String): ByteArray {
        require(value.isNotBlank()) { "vault root key 不能为空" }
        val decoded = try {
            Base64.decode(value, Base64.DEFAULT)
        } catch (error: IllegalArgumentException) {
            throw IllegalArgumentException("vault root key 不是合法 Base64", error)
        }
        require(decoded.size == ROOT_KEY_BYTES) { "vault root key 必须是 32 字节" }
        return decoded
    }

    private data class Envelope(val nonce: ByteArray, val ciphertext: ByteArray)

    private fun parseEnvelope(raw: String, scope: Scope): Envelope {
        val json = try { JSONObject(raw) } catch (error: Throwable) {
            throw IllegalArgumentException("安全存储信封不是合法 JSON", error)
        }
        require(json.optInt("v", -1) == ENVELOPE_VERSION) { "不支持的安全存储信封版本" }
        require(json.optString("scope") == scope.digestHex) { "安全存储信封作用域不匹配" }
        val nonce = decodeField(json, "iv")
        val ciphertext = decodeField(json, "ciphertext")
        require(nonce.size == GCM_NONCE_BYTES) { "安全存储信封 nonce 长度无效" }
        require(ciphertext.size > 16) { "安全存储信封密文长度无效" }
        return Envelope(nonce, ciphertext)
    }

    private fun decodeField(json: JSONObject, name: String): ByteArray {
        val encoded = json.optString(name, "")
        require(encoded.isNotEmpty()) { "安全存储信封缺少 $name" }
        return try { Base64.decode(encoded, Base64.DEFAULT) }
        catch (error: IllegalArgumentException) { throw IllegalArgumentException("安全存储信封 $name 无效", error) }
    }

    private fun preferenceKey(scope: Scope): String = KEY_PREFIX + scope.digestHex

    private data class Scope(val aad: ByteArray, val digestHex: String) {
        companion object {
            fun of(serverOrigin: String, accountId: String): Scope {
                val origin = serverOrigin.trim()
                val account = accountId.trim()
                require(origin.isNotEmpty()) { "serverOrigin 不能为空" }
                require(account.isNotEmpty()) { "accountId 不能为空" }
                require(origin.none { it.code < 0x20 } && account.none { it.code < 0x20 }) {
                    "安全存储作用域不能包含控制字符"
                }
                // Length prefixes make the two fields unambiguous without accepting
                // delimiter-based collisions. The exact bytes are also the GCM AAD.
                val originBytes = origin.toByteArray(StandardCharsets.UTF_8)
                val accountBytes = account.toByteArray(StandardCharsets.UTF_8)
                val canonical = "${originBytes.size}:$origin${accountBytes.size}:$account"
                    .toByteArray(StandardCharsets.UTF_8)
                val digest = MessageDigest.getInstance("SHA-256").digest(canonical)
                return Scope(canonical, digest.joinToString("") { "%02x".format(it) })
            }
        }
    }
}
