package android.util

import java.util.Base64 as JdkBase64

/**
 * 🔴 **仅测试作用域**的 `android.util.Base64` 替身。
 *
 * ============================================================
 * 为什么需要它
 * ============================================================
 *
 * Android 单测跑在**普通 JVM** 上，`android.jar` 里的 `android.util.Base64`
 * 全是**桩**：调用会抛 `RuntimeException("Stub!")`，或者（开了 `returnDefaultValues`）
 * 返回 null —— 后者会让解密"成功"地拿到空字节，测试照样绿。
 *
 * 而生产代码**必须**用 `android.util.Base64`：`java.util.Base64` 在 Android 上
 * **需要 API 26**（已用 SDK 的 `api-versions.xml` 核实：`<class name="java/util/Base64" since="26">`），
 * 本工程 `minSdk = 24`，直接用会在 Android 7.x 上 `NoClassDefFoundError`。
 *
 * 于是：把**生产代码一行不改**地放进单测，靠的就是这个同名替身。
 * AGP 的测试 classpath 里，`src/test` 编译出的类排在 `android.jar` **之前**，
 * 所以这个类会**遮蔽**框架桩 —— 这正是能在 JVM 上测 `android.util.*` 的常规做法。
 *
 * ============================================================
 * ⚠️ 这个替身本身的风险，必须说清楚
 * ============================================================
 *
 * 它意味着"生产代码在真机上调用 `android.util.Base64`"这一事实**没有被测试覆盖** ——
 * 测的是这个替身的语义。风险被压到最小的方法是让它与 JDK 实现**逐位一致**，
 * 并且**只用 `NO_WRAP`**（标准 base64、不容忍空白），因为那是语义最没有歧义的一档。
 * `WidgetSnapshotCipherTest` 里有一条测试专门钉住这个替身与 JDK 实现的一致性。
 *
 * ⚠️ 真机验证仍然是**必需**的，它属于 W1-2（`AppWidgetProvider` 落地）的验收项。
 */
object Base64 {

    /** 与 `android.util.Base64` 的常量值保持一致。 */
    const val DEFAULT = 0
    const val NO_PADDING = 1
    const val NO_WRAP = 2
    const val CRLF = 4
    const val URL_SAFE = 8

    @JvmStatic
    fun decode(str: String, flags: Int): ByteArray {
        if (flags and URL_SAFE != 0) {
            val decoder = JdkBase64.getUrlDecoder()
            return decoder.decode(str)
        }
        if (flags and NO_WRAP != 0) {
            // NO_WRAP = 标准 base64、**不容忍空白与换行**。
            return JdkBase64.getDecoder().decode(str)
        }
        // DEFAULT = 宽松解码（忽略换行/空白），与 Android 的行为一致。
        return JdkBase64.getMimeDecoder().decode(str)
    }

    @JvmStatic
    fun encodeToString(input: ByteArray, flags: Int): String {
        val encoder = when {
            flags and URL_SAFE != 0 -> JdkBase64.getUrlEncoder()
            flags and NO_WRAP != 0 -> JdkBase64.getEncoder()
            flags and CRLF != 0 -> JdkBase64.getMimeEncoder(76, "\r\n".toByteArray())
            else -> JdkBase64.getMimeEncoder(76, "\n".toByteArray())
        }
        return encoder.encodeToString(input)
    }
}
