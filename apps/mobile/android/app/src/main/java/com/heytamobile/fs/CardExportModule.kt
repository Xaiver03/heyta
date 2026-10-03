package com.heytamobile.fs

import android.net.Uri
import android.util.Base64
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File

/**
 * 把一段 base64 PNG 写进**应用自己的缓存目录**，回一个可以分享的 `content://` URI。
 *
 * ## 为什么需要这个模块（不是"顺手包一层"）
 *
 * 成品图这条路上原生侧已经能栅格化（`react-native-svg` 的 `SvgView.toDataURL`，
 * 两端都有实现），但它交回来的是 **base64 字符串**，而 `Share` 的 `url` 分支要的是
 * **真实文件 URI**（`message` 分支只能传纯文本）。RN 0.84 的核心里也没有 `FileSystem`
 * （`CameraRoll` 早在 0.60 就拆出核心）。也就是说"图已经画出来了，但字节无处可去"——
 * 缺的恰好就是这一个写文件的动作。取证见 `docs/plans/countdown-w7-device-export.md` §2.3。
 *
 * ## 🔴 为什么不写进系统相册
 *
 * 写相册要么申请 `ACCESS_MEDIA_LOCATION` / 走 `MediaStore` 插入，要么引第三方库，
 * 而 `packages/legal/src/documents/permissions.ts` 里写着
 * "heyta **不申请** … **照片** … 权限"。落到**自己的缓存目录 + 分享面板**这条路
 * 一个权限都不需要新增，那句条款继续逐字为真（AGENTS §8.10：安全判据不许为测试降级，
 * 这条反过来也成立：不为省事去改动对外承诺）。
 *
 * 缓存目录是系统可随时回收的位置，这对"分享一次"的语义是合适的 ——
 * 它**不是**用户的照片库，界面上也不承诺它能长期留着。
 *
 * ## 单位与字节
 *
 * 这里**不做任何图像处理**，也不判断尺寸：字节进、字节出，
 * 尺寸对不对由验收脚本去数那张图的 IHDR（`scripts/verify-mobile-card-export.mjs`）。
 * 图像尺寸是产品语义，产品语义不进外壳（AGENTS §3.5）。
 */
class CardExportModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = NAME

    /**
     * @param fileName 分享出去的文件名（JS 侧已经按码点截断并剥掉非法字符）。
     * @param base64   PNG 的 base64（**不带** `data:` 前缀）。
     *
     * 失败分码回抛，不返回空串：界面上"这台设备写不了文件"和"写出来是空的"是两件事。
     */
    @ReactMethod
    fun writePngBase64(fileName: String, base64: String, promise: Promise) {
        try {
            // 🔴 路径穿越：文件名来自 JS，而 JS 那串是**用户起的标题**。
            // 只取最后一段并拒绝 `..`，宁可失败也不拼出目录外的路径。
            val leaf = fileName.substringAfterLast('/').substringAfterLast('\\')
            if (leaf.isEmpty() || leaf == "." || leaf == ".." || leaf.contains("..")) {
                promise.reject("BAD_NAME", "非法文件名：$fileName")
                return
            }
            val bytes = try {
                // `android.util.Base64` 而不是 `java.util.Base64`：后者要 API 26，
                // 而本工程 minSdk = 24（`android/build.gradle:4`），在低版本上是运行时就炸。
                Base64.decode(base64, Base64.DEFAULT)
            } catch (e: IllegalArgumentException) {
                promise.reject("BAD_BASE64", e.message ?: e.javaClass.simpleName)
                return
            }
            if (bytes.isEmpty()) {
                promise.reject("EMPTY_BYTES", "栅格化返回了零字节")
                return
            }
            val dir = File(reactApplicationContext.cacheDir, DIR_NAME)
            if (!dir.exists() && !dir.mkdirs()) {
                promise.reject("MKDIR_FAILED", "建不出 ${dir.absolutePath}")
                return
            }
            val file = File(dir, leaf)
            file.writeBytes(bytes)
            val authority = "${reactApplicationContext.packageName}.$PROVIDER_AUTHORITY_SUFFIX"
            val uri: Uri = FileProvider.getUriForFile(reactApplicationContext, authority, file)
            promise.resolve(uri.toString())
        } catch (e: SecurityException) {
            promise.reject("WRITE_DENIED", e.message ?: e.javaClass.simpleName)
        } catch (e: Exception) {
            promise.reject("WRITE_FAILED", e.message ?: e.javaClass.simpleName)
        }
    }

    companion object {
        /** 与 JS 侧 `src/lib/card-export-native.ts` 的 `MODULE_NAME` 必须一致。 */
        const val NAME = "HeytaCardExport"

        /** 缓存目录里的那个子目录（与 `card_export_paths.xml` 的 `path` 逐字相同）。 */
        private const val DIR_NAME = "card-export"

        /** 与 `AndroidManifest.xml` 里那个 `<provider>` 的 authority 后缀逐字相同。 */
        private const val PROVIDER_AUTHORITY_SUFFIX = "fileprovider"
    }
}
