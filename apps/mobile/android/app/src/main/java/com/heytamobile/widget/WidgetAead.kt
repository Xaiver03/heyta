package com.heytamobile.widget

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * 一次 AES-256-GCM 的**能力**，而不是一把密钥。
 *
 * ============================================================
 * 为什么要抽这一层（2026-09-27 定的密钥归属的直接后果）
 * ============================================================
 *
 * 密钥归属决定了 **"生产路径上密钥能不能被倒成字节"**，而 `AndroidKeyStore`
 * 生成的 AES 密钥**不可导出**：它没有任何 API 能取出原始字节，只能用 [Cipher] 使用它。
 *
 * 原来的写法是 `decrypt(envelope, key: ByteArray)` —— 单测和夹具都这么喂。
 * 到了 W1-4 就撞墙了：要么把 Keystore 密钥"想办法"倒出来（等于放弃不可导出，
 * 而那正是选它的理由），要么让解密只依赖"能解密"这件事本身。
 *
 * 选后者。于是：
 *
 * | 实现 | 用途 | 密钥形态 |
 * |---|---|---|
 * | [RawKeyAead] | 单测 / golden fixture | 裸 32 字节（夹具就是这么生成的） |
 * | [KeystoreAead] | **生产** | `AndroidKeyStore` 里不可导出的 [SecretKey] |
 *
 * ⚠️ **两条路径的密文必须互通**：夹具测试证明的是"Kotlin 的实现符合契约"，
 * 而生产走的是 [KeystoreAead]。两者都调同一个 [Cipher.getInstance] 与同一套 AAD 拼法，
 * 所以"互通"是靠**共用这一份代码**保证的，不是靠两张测试各自绿。
 */
interface WidgetAead {
    /** 解开一段密文，失败**抛异常**。*/
    fun decrypt(nonce: ByteArray, aad: ByteArray, ciphertext: ByteArray): ByteArray

    /** 封一段明文。`nonce` 由调用方提供 —— 见 [WidgetCrypto.newNonce] 关于"每次都换"的说明。*/
    fun encrypt(nonce: ByteArray, aad: ByteArray, plaintext: ByteArray): ByteArray
}

/** GCM 的 tag 长度。与 TS 侧 `@noble/ciphers` / WebCrypto 的默认值一致（16 字节）。*/
internal const val GCM_TAG_BITS = 128

/** GCM 的标准 nonce 长度。四端必须一致。*/
internal const val GCM_NONCE_BYTES = 12

private const val TRANSFORMATION = "AES/GCM/NoPadding"

/**
 * 用**裸密钥**做 AES-GCM —— 单测与夹具走这条。
 *
 * ⚠️ 生产**不该**用它：裸密钥只能来自"把密钥倒成字节"，而 D1 的密钥归属决定
 * 生产密钥永不离开 Keystore。它存在是为了让夹具（用固定密钥生成的密文）可测。
 */
class RawKeyAead(key: ByteArray) : WidgetAead {

    private val keySpec: SecretKeySpec = run {
        require(key.size == 32) {
            "设备密钥必须是 32 字节（AES-256），实际 ${key.size} —— 这通常意味着派生步骤写错了"
        }
        SecretKeySpec(key, "AES")
    }

    override fun decrypt(nonce: ByteArray, aad: ByteArray, ciphertext: ByteArray): ByteArray =
        runCipher(Cipher.DECRYPT_MODE, keySpec, nonce, aad, ciphertext)

    override fun encrypt(nonce: ByteArray, aad: ByteArray, plaintext: ByteArray): ByteArray =
        runCipher(Cipher.ENCRYPT_MODE, keySpec, nonce, aad, plaintext)
}

/**
 * 用 `AndroidKeyStore` 里**不可导出**的密钥做 AES-GCM —— 生产走这条。
 *
 * 🔴 **本类在 JVM 单测里无法验证**：`AndroidKeyStore` 在 JVM 上是桩（`Stub!`）。
 * 所以它是**纯 🧪** 的，必须真机验收。这一点不能含糊 —— 它恰恰是唯一
 * 真正保护用户数据的那条路径。**"代码已完成 / 真机验收未做"**，两者都要写清楚。
 */
class KeystoreAead(private val secretKey: SecretKey) : WidgetAead {

    override fun decrypt(nonce: ByteArray, aad: ByteArray, ciphertext: ByteArray): ByteArray =
        runCipher(Cipher.DECRYPT_MODE, secretKey, nonce, aad, ciphertext)

    override fun encrypt(nonce: ByteArray, aad: ByteArray, plaintext: ByteArray): ByteArray =
        runCipher(Cipher.ENCRYPT_MODE, secretKey, nonce, aad, plaintext)
}

/**
 * 两个实现**共用**的那一次 `Cipher` 调用。
 *
 * 抽出来不是为了少写两行，是为了让"生产与夹具用的是同一套参数"成为**结构上的事实**：
 * 如果 [KeystoreAead] 自己抄一遍 `Cipher.getInstance`，那么 tag 长度、AAD 顺序、
 * `NO_WRAP` 解码这三处任何一处抄错，夹具测试都照样绿 —— 而生产全线解不开，
 * 症状只是"组件没数据"。
 */
private fun runCipher(
    mode: Int,
    key: SecretKey,
    nonce: ByteArray,
    aad: ByteArray,
    input: ByteArray,
): ByteArray {
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(mode, key, GCMParameterSpec(GCM_TAG_BITS, nonce))
    // ⚠️ AAD 必须在 `doFinal` **之前**喂进去，且顺序与 TS 侧的 `envelopeAad()` 同源。
    //    AAD 差一个字节 → GCM 认证失败 → 症状是"四端全都没数据"，极难归因。
    cipher.updateAAD(aad)
    return cipher.doFinal(input)
}

/**
 * 设备密钥的**生命周期**（生成 / 读取 / 删除），全部落在 `AndroidKeyStore`。
 *
 * ## 🔴 三个刻意的选择
 *
 * 1. **`setUserAuthenticationRequired(false)`**：组件是在用户**没有解锁手势**的情况下
 *    被系统唤醒的。要求每次使用都认证，等于让组件永远显示占位符。
 *    密钥的保护由"Keystore + 设备解锁后的凭证加密存储"提供，不是由生物识别提供。
 * 2. **不设 `setUnlockedDeviceRequired(true)`**：这个开关的语义是"设备锁屏时不可用"，
 *    但组件在**锁屏上**也可能被绘制（桌面组件在解锁前就已布局）。
 *    设了它会让"锁屏时组件变空"，而我们首版**不做锁屏组件**（D6），
 *    所以这个代价白付。真正的"重启后拿不到"由**存储位置**提供：见第 3 条。
 * 3. 🔴 **不做 `directBootAware`**（ADR-0025 §2.1.4）。这意味着本密钥存在
 *    **凭证加密存储**（credential-encrypted）里，**设备重启后、用户首次解锁前读不到**。
 *    这是 D1 方案**已知且已接受**的代价：设备刚重启时组件只能显示
 *    **"打开 Heyta 以显示今天的任务"** —— 而**绝不能**显示"今天没有任务"
 *    （后者会骗用户，见 [WidgetSnapshotCipher.readOrNull] 的注释）。
 *
 * ⚠️ 因此 `WidgetModule` / provider **都不得**声明 `directBootAware="true"` ——
 * 声明了也拿不到密钥（存储没解锁），却会让"重启后组件空白"变成"组件崩"。
 *
 * ⚠️ 本类**纯 🧪**：`AndroidKeyStore` 在 JVM 单测里是桩。
 */
object WidgetDeviceKeyStore {

    private const val KEYSTORE = "AndroidKeyStore"

    /**
     * 别名带版本后缀。**换算法或换参数时必须换别名** ——
     * Keystore 里的别名叫什么就是什么，同名改参数不会生效（会抛 `InvalidAlgorithmParameterException`），
     * 于是"升级参数"这件事只能靠换名字重生成密钥来表达。
     */
    const val ALIAS = "heyta_widget_device_key_v1"

    /**
     * 取密钥；不存在就**生成**一把随机的。
     *
     * 🔴 **密钥本身不经过 JS**。这是 W1-4 定的密钥归属：
     * 密钥不穿桥 → 不进 JS 堆、不进日志、不进崩溃上报。
     *
     * ⚠️ 但 **IV（nonce）是调用方传进来的**，不是 Keystore 产生的 ——
     * 见下面 `setRandomizedEncryptionRequired(false)` 处那段注释：
     * 卡片的 nonce 必须写进信封，所以必须由我们指定。
     */
    fun getOrCreate(): SecretKey {
        existing()?.let { return it }

        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(
                ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                /*
                 * 🔴 **必须显式关掉"随机加密"，否则调用方自带 IV 会被 Keystore 拒绝。**
                 *
                 * 这一条是真机上才发现的（`logcat`）：
                 *
                 *     E_WIDGET_WRITE_FAILED: Caller-provided IV not permitted
                 *
                 * `KeyGenParameterSpec` 的**默认值**是 `setRandomizedEncryptionRequired(true)`，
                 * 它的语义是"用这把密钥加密时，**IV 由 Keystore 自己随机产生**，
                 * 调用方不许自带 IV"。而我们**必须**自带 IV：
                 * 卡片的 nonce 要写进信封里（`runCipher` 第 107 行传的就是它），
                 * 卡片侧读信封才能解 —— 这正是"单一写入者"那条不变量的要求。
                 *
                 * 所以默认值与我们的契约**直接冲突**，必须显式关掉。
                 *
                 * ⚠️ **这里原本的注释写反了**：它说"随机由 Keystore 产生，
                 * 不传 `setRandomizedEncryptionRequired` 之外的任何 IV 设定"，
                 * 而同一份文件第 107 行一直在传调用方的 nonce。
                 * 注释描述的是**意图**，代码做的是**另一件事**，两者矛盾且都没报错 ——
                 * 直到真机第一次执行才暴露。**注释不能当作行为的证据。**
                 *
                 * ⚠️ 改这里**不会**影响已经生成的密钥：老的 alias 仍然拒绝自带 IV，
                 * 必须 `delete()` 之后再 `getOrCreate()`（或 `pm clear`）才会生效。
                 */
                .setRandomizedEncryptionRequired(false)
                // 见类注释第 1、2 条：不要求用户认证、不要求解锁设备。
                .setUserAuthenticationRequired(false)
                .build(),
        )
        return generator.generateKey()
    }

    /** 只读地看一眼有没有 —— **不要**用它来做"没有就生成"的判断（那是 [getOrCreate] 的事）。*/
    fun existing(): SecretKey? {
        val store = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        if (!store.containsAlias(ALIAS)) return null
        return (store.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.secretKey
    }

    /**
     * 删除密钥。**登出时必须调它**（D6）—— 与 [WidgetStore.clearAll] 一起，
     * 否则"登出"只清了快照、密钥还在，下一份快照仍能被旧密钥解开。
     *
     * ⚠️ 删掉之后再 [getOrCreate] 会得到一把**全新的**密钥，
     * 于是此前写下的快照**永久解不开**（这是对的：登出就该如此）。
     */
    fun delete() {
        val store = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        if (store.containsAlias(ALIAS)) store.deleteEntry(ALIAS)
    }
}

/**
 * nonce 的生成 —— 只此一处。
 *
 * 🔴 **每次封包必须重新取**。GCM 下 nonce 重用不是"安全性下降"，是**灾难**：
 * 两段用同一 nonce 的密文异或会泄露明文，且认证密钥可被恢复。
 * 所以生成放在离 `SecureRandom` 最近的这一层，而不是让调用方传进来。
 */
object WidgetCrypto {
    fun newNonce(): ByteArray = ByteArray(GCM_NONCE_BYTES).also {
        java.security.SecureRandom().nextBytes(it)
    }
}
