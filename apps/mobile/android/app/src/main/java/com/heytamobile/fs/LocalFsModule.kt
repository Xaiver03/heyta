package com.heytamobile.fs

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Base64
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

    /**
     * 读一个本机 URI 的**原始字节**，回 base64（无换行）。工单 #9 的附件上传走这条。
     *
     * ## 为什么头像那条 `prepareAvatarBase64` 不能复用
     *
     * 它按头像契约**重编码**：居中裁方、缩到边长、转成 PNG/JPEG。对附件来说是错的 ——
     * 用户传的是一张 PDF 或一张原图，附件要的是**字节本身**，改一个比特就换了文件。
     *
     * ## 为什么必须在原生侧
     *
     * 与 `readTextUri` 同一个理由（RN 0.84.1 在 Android 上读不出本机 URI），
     * 而 `readTextUri` 按 `Charsets.UTF_8` 强转字符串，对二进制是**有损**的 ——
     * 症状是"上传成功而服务端解不开"。
     *
     * 🔴 `maxBytes` 是**这个模块自己**的护栏，不是产品规则：超限就拒，
     * 不把几十 MB 读进 `ByteArrayOutputStream` 再抛（那会把 app 直接压崩，
     * 而崩掉的表现是"我一点添加附件应用就退出"，不是一句能看懂的错）。
     * 产品侧的单文件上限在 `@heyta/shared-schema` 的 `MAX_ATTACHMENT_BYTES`，
     * 由 JS 传进来 —— 这里不判断任何业务语义（AGENTS §3.5）。
     *
     * 失败**分码回抛**，与同文件另两条同一个纪律。
     */
    @ReactMethod
    fun readUriBase64(uri: String, maxBytes: Int, promise: Promise) {
        if (maxBytes <= 0) {
            promise.reject("BAD_MAX", "maxBytes 必须是正整数，收到 $maxBytes")
            return
        }
        try {
            val stream = reactApplicationContext.contentResolver.openInputStream(Uri.parse(uri))
            if (stream == null) {
                promise.reject("OPEN_NULL", "openInputStream 对 $uri 返回 null")
                return
            }
            val out = ByteArrayOutputStream()
            stream.use { input ->
                val buffer = ByteArray(64 * 1024)
                var total = 0
                while (true) {
                    val read = input.read(buffer)
                    if (read == -1) break
                    total += read
                    if (total > maxBytes) {
                        // 不保留已经读到的部分：超限的文件一块字节都不该留在内存里。
                        promise.reject("TOO_LARGE", "超过 $maxBytes 字节上限（实际至少 $total）")
                        return
                    }
                    out.write(buffer, 0, read)
                }
            }
            promise.resolve(Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP))
        } catch (e: SecurityException) {
            promise.reject("READ_DENIED", e.message ?: e.javaClass.simpleName)
        } catch (e: Exception) {
            promise.reject("READ_FAILED", e.message ?: e.javaClass.simpleName)
        }
    }

    /**
     * 把一个本机 URI 的图**压成头像契约要的那张方形图**，回 base64（无换行）。
     *
     * ## 为什么这件事必须在原生侧，而不是一行 `readBase64Uri`
     *
     * 契约要的是"短边居中裁成正方形、缩到 `ACCOUNT_AVATAR_EDGE_PX`、再按
     * `avatarOutputContentType` 选出的格式编码"（这三个数/规则都在
     * `@heyta/shared-schema`，由 JS 侧当参数传进来 —— 本模块**不判断任何产品语义**）。
     * RN 的 `ImageEditor` 在 Android 上**只能裁、不能缩放**（`displaySize`/`outputSize`
     * 是 iOS 那支的实现），所以"缩到 512"这一步没有 JS 通道可走。
     *
     * 🔴 也**不**能复用上面那条 `readTextUri`：它按 `Charsets.UTF_8` 把字节强转成字符串，
     * 对 PNG/JPEG 是**有损**的（非法 UTF-8 序列被替换字符吃掉），症状是
     * "上传成功但服务端解不开"。二进制必须走 base64，且这里直接给。
     *
     * 失败**分码回抛**，与 `readTextUri` 同一条纪律：JS 侧按码选界面那句话。
     */
    @ReactMethod
    fun prepareAvatarBase64(uri: String, edgePx: Int, format: String, promise: Promise) {
        if (edgePx <= 0) {
            promise.reject("BAD_EDGE", "edgePx 必须是正整数，收到 $edgePx")
            return
        }
        val codec = when (format) {
            "image/png" -> Bitmap.CompressFormat.PNG
            "image/jpeg" -> Bitmap.CompressFormat.JPEG
            else -> {
                promise.reject("BAD_FORMAT", "不支持的输出格式：$format")
                return
            }
        }
        var source: Bitmap? = null
        var squared: Bitmap? = null
        var scaled: Bitmap? = null
        try {
            val stream = reactApplicationContext.contentResolver.openInputStream(Uri.parse(uri))
            if (stream == null) {
                promise.reject("OPEN_NULL", "openInputStream 对 $uri 返回 null")
                return
            }
            source = stream.use { BitmapFactory.decodeStream(it) }
            if (source == null || source.width == 0 || source.height == 0) {
                promise.reject("DECODE_FAILED", "这张图解不开（不是图片或已损坏）")
                return
            }
            val side = minOf(source!!.width, source!!.height)
            val x = (source!!.width - side) / 2
            val y = (source!!.height - side) / 2
            squared = Bitmap.createBitmap(source!!, x, y, side, side)
            scaled = if (side == edgePx) {
                squared
            } else {
                Bitmap.createScaledBitmap(squared!!, edgePx, edgePx, true)
            }
            val out = ByteArrayOutputStream()
            // PNG 带透明通道，quality 参数对它无意义（传 100）；JPEG 用 0.86 那一档，
            // 与 web 的 canvas `toDataURL(type, 0.86)` 对齐 —— 两端压出来的字节数量级
            // 差一截的话，"同一张图在网页上传得了、手机上传不了"就是必然。
            val quality = if (codec == Bitmap.CompressFormat.PNG) 100 else 86
            if (!scaled!!.compress(codec, quality, out)) {
                promise.reject("ENCODE_FAILED", "Bitmap.compress 返回 false")
                return
            }
            val bytes = out.toByteArray()
            if (bytes.isEmpty()) {
                promise.reject("ENCODE_FAILED", "编码结果为 0 字节")
                return
            }
            promise.resolve(Base64.encodeToString(bytes, Base64.NO_WRAP))
        } catch (e: SecurityException) {
            promise.reject("READ_DENIED", e.message ?: e.javaClass.simpleName)
        } catch (e: Exception) {
            promise.reject("READ_FAILED", e.message ?: e.javaClass.simpleName)
        } finally {
            // 相册里的原图解开就是几十 MB，不显式回收要等 GC。
            // 三处可能是**同一个对象**（方图不缩放时 scaled === squared、
            // 整图即方图时 squared === source），所以逐个比过再回收。
            if (scaled !== squared && scaled !== source) scaled?.recycle()
            if (squared !== source) squared?.recycle()
            source?.recycle()
        }
    }

    companion object {
        /** 与 JS 侧 `src/lib/local-file-read.ts` 的 `MODULE_NAME` 必须一致。 */
        const val NAME = "HeytaLocalFs"
    }
}
