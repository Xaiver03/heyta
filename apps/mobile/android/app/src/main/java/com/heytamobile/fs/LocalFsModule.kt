package com.heytamobile.fs

import android.net.Uri
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.ByteArrayOutputStream

/**
 * 读一个本机 URI 的 UTF-8 文本。
 *
 * ## 为什么需要这个模块（不是"顺手包一层"）
 *
 * RN 0.84.1 在 Android 上**读不出本地文件**，而 JS 侧看不出原因：
 * `fetch`/`XHR` 对 `content://` 与 `file://` 一律回 `Network request failed`
 * 或 XHR onerror。真因在原生侧 —— `NetworkingModule.sendRequestInternalReal`
 * 处理"本机 URI handler"那一段时，为了造一个假的 `okhttp3.Response` 而调用
 * `Request.Builder().url(...)`，OkHttp 只接受 http/https，于是在
 * `NetworkingModule.kt:318` 抛异常（实测的失败栈顶就是这一行）。
 * 所以 `responseType: 'blob'` 也一样失败：还没走到取字节就炸了。
 *
 * 读文件是**平台 API**，不含任何产品语义（AGENTS §3.5 的分界线）：
 * 这里不解析、不校验、不判断内容，字节交给 `packages/app-host` 的解析层。
 */
class LocalFsModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = NAME

    /**
     * `ContentResolver.openInputStream` 同时覆盖两种形态：
     * SAF 的 `content://`（读权限由系统随选择结果临时授予）与
     * `keepLocalCopy` 落进缓存后的 `file://`。
     *
     * 🔴 失败**分码回抛**，不降级成空串：界面上"读不到"和"读出来是空的"
     * 是两件事，合成一条就等于把第二种情况永久藏起来。
     */
    @ReactMethod
    fun readTextUri(uri: String, promise: Promise) {
        try {
            val stream = reactApplicationContext.contentResolver.openInputStream(Uri.parse(uri))
            if (stream == null) {
                promise.reject("OPEN_NULL", "openInputStream 对 $uri 返回 null")
                return
            }
            val out = ByteArrayOutputStream()
            stream.use { input -> input.copyTo(out) }
            promise.resolve(String(out.toByteArray(), Charsets.UTF_8))
        } catch (e: SecurityException) {
            promise.reject("READ_DENIED", e.message ?: e.javaClass.simpleName)
        } catch (e: Exception) {
            promise.reject("READ_FAILED", e.message ?: e.javaClass.simpleName)
        }
    }

    companion object {
        /** 与 JS 侧 `src/lib/local-file-read.ts` 的 `MODULE_NAME` 必须一致。 */
        const val NAME = "HeytaLocalFs"
    }
}
