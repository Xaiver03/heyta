package com.heytamobile.widget

import android.util.Base64
import org.json.JSONObject

/**
 * 快照的**解密**与**封包** —— D1 方案里"组件自己只做一次 AES-GCM"的那一次。
 *
 * ============================================================
 * 为什么这里收的是 [WidgetAead]，而不是一把密钥
 * ============================================================
 *
 * 见 `docs/adr/0025-widget-snapshot-confidentiality.md` §2.1：密钥由**应用侧的原生模块**
 * 放进共享 Keychain / Keystore，组件只负责"拿出来 → 解一次"。
 * 理由是 **Argon2id 绝不能跑在组件里** —— 组件是被系统在**别人的进程里**唤醒的，
 * 有严格的时间预算（RemoteViews 的超时是秒级），而 Argon2id 是刻意设计得慢的。
 * 把 KDF 放进组件，等于每次刷新都要么超时、要么被迫把参数降到不安全。
 *
 * 🔴 到 W1-4 时这里从 `key: ByteArray` 改成了 [WidgetAead]。原因不是风格：
 * 密钥归属定成了"**原生生成、永不离开 Keystore**"，而 `AndroidKeyStore` 的 AES 密钥
 * **不可导出**（没有任何 API 能取出原始字节）。继续收 `ByteArray` 就等于
 * 逼着生产代码把密钥倒出来 —— 那正是选 Keystore 要避免的事。
 *
 * 所以本文件**仍然不碰密钥管理**：它只做纯函数式的加解密。取密钥是
 * [WidgetDeviceKeyStore] 的事，单测用 [RawKeyAead] 喂固定密钥。
 */
object WidgetSnapshotCipher {

    /**
     * 用 [aead] 解开信封里的密文，返回**明文字节**。
     *
     * 失败一律**抛异常**（与 TS 侧的 `SnapshotDecryptor` 约定一致：
     * "失败就抛异常，不要返回 undefined"）。调用方是 [readOrNull]，它会捕获并降级。
     *
     * AAD 用 [envelopeAad] —— 与 TS 的 `envelopeAad()` **同源**。
     * 这不是洁癖：AAD 只要差一个字节，GCM 的认证就会失败，
     * 而症状是"四端全都解密失败、组件就是没数据"，非常难查。
     */
    fun decrypt(envelope: WidgetEnvelope, aead: WidgetAead): ByteArray =
        aead.decrypt(
            nonce = decodeBase64(envelope.nonce),
            aad = envelopeAadBytes(envelope),
            ciphertext = decodeBase64(envelope.ciphertext),
        )

    /**
     * **渲染组件时要用的入口**：解不出来就返回 `null`，**不假装成"今天没有任务"**。
     *
     * ## 🔴 为什么必须与 [readSafely] 分开（这是踩过的坑）
     *
     * 这个函数原先把所有失败都降级成 [emptyPayload]（`today = []`），注释里还写着
     * "宁可显示'今天没有任务'"。**那句话是错的，而且错得很危险**：
     * 设备刚重启、应用还没跑过时拿不到密钥（ADR-0025 §2.3 明确记录了这个代价），
     * 于是组件会理直气壮地告诉用户 **"今天没有任务"** ——
     * 而真相是"我读不到你的数据"。
     *
     * 用户会据此**以为今天真的没事**。这是本项目最反对的那类 bug：
     * **不报错、不崩溃，只是把错误的信息画在用户的桌面上。**
     *
     * 所以两种状态在类型上就分开：
     *   - `null`            → 占位（"打开 Heyta 以显示今天的任务"）
     *   - `emptyPayload()`  → 解密**成功**且今天确实是空的（"今天没有任务"）
     *
     * ⚠️ 注意这里降级的三种情况在用户眼里都应该是"没有数据"，不是"组件坏了"：
     *   1. 密钥还没派生好（设备**刚重启、应用还没跑过一次**）
     *   2. AAD 不匹配（信封被改过）
     *   3. 密文损坏
     *
     * 不抛异常的理由仍然成立：组件是在**别人的进程里被系统唤醒**的，
     * 在那里抛异常只会得到系统占位符或空白，而我们因此**失去了可观测性**。
     */
    fun readOrNull(raw: Any?, aead: WidgetAead?): WidgetPayload? {
        val envelope = when (val parsed = WidgetSnapshotParser.parseEnvelope(raw)) {
            is EnvelopeParseResult.Ok -> parsed.envelope
            is EnvelopeParseResult.Rejected -> return null
        }

        // 拿不到密钥 = 只能显示占位符。这是 D1 方案**已知且已接受**的代价。
        if (aead == null) return null

        val plainBytes = try {
            decrypt(envelope, aead)
        } catch (_: Throwable) {
            return null
        }

        val json = try {
            JSONObject(String(plainBytes, Charsets.UTF_8))
        } catch (_: Throwable) {
            return null
        }

        return when (val parsed = WidgetSnapshotParser.parsePayload(json)) {
            is PayloadParseResult.Ok -> parsed.payload
            is PayloadParseResult.Rejected -> null
        }
    }

    /**
     * 与 TS 的 `readSnapshotSafely` 对应：任何拒绝或异常都降级成 [emptyPayload]。
     *
     * ⚠️ **不要在渲染路径上用这个**（会把"读不到"显示成"今天没有任务"）—— 用 [readOrNull]。
     * 它保留给"只要一份能安全解引用的载荷"的场景。
     */
    fun readSafely(raw: Any?, aead: WidgetAead?): WidgetPayload =
        readOrNull(raw, aead) ?: emptyPayload()

    /**
     * 把载荷 JSON **封成信封**，返回信封的 JSON 字符串。
     *
     * 🔴 本函数是 TS 侧 `sealSnapshot()` 的**同源对应物**，两边的形状必须逐字段一致：
     * 字段名、`alg` 取值、AAD 的拼法、base64 的编码方式。四端各自"照着文档拼一个 JSON"
     * 的结果就是四份会漂移的实现，而漂移的症状是**解密失败**、
     * 且四端会**同时**失败，只在组件上表现为"没有数据"。
     *
     * ⚠️ **入参在这里就校验**（而不是等 `parseEnvelope` 才发现）：写下一份契约解不开的信封，
     * 等于把一个必然失败的产物存进共享容器，而那时离出错点已经很远。
     * 上界 [MAX_EPOCH_MS] 的理由见 `WidgetContract.kt` 的注释（JS 对 >= 1e21
     * 用科学计数法，三端格式化规则不同 → AAD 对不上 → 四端同时解不开）。
     *
     * ⚠️ `nonce` 每次重新取（见 [WidgetCrypto.newNonce]）：GCM 下 nonce 重用是灾难。
     */
    fun seal(payloadJson: String, dayStr: String, validUntil: Long, aead: WidgetAead): String {
        require(dayStr.isNotEmpty()) { "seal: dayStr 必须是非空字符串" }
        require(validUntil in 0..MAX_EPOCH_MS) {
            "seal: validUntil 必须在 [0, $MAX_EPOCH_MS] 内，实际 $validUntil"
        }

        val aad = envelopeAad(WIDGET_CONTRACT_VERSION, dayStr, validUntil)
        val nonce = WidgetCrypto.newNonce()
        val ciphertext = aead.encrypt(
            nonce = nonce,
            aad = aad.toByteArray(Charsets.UTF_8),
            plaintext = payloadJson.toByteArray(Charsets.UTF_8),
        )

        // 键序不属于契约（`org.json` 内部是 `HashMap`），这里只是构造，不要把它当契约。
        return JSONObject()
            .put("v", WIDGET_CONTRACT_VERSION)
            .put("dayStr", dayStr)
            .put("validUntil", validUntil)
            .put("alg", WIDGET_ALG)
            .put("nonce", encodeBase64(nonce))
            .put("ciphertext", encodeBase64(ciphertext))
            .toString()
    }
}

/**
 * ⚠️ `android.util.Base64` 而不是 `java.util.Base64`：
 * 后者在 Android 上**需要 API 26**（已用 SDK 的 api-versions.xml 核实），
 * 而本工程 minSdk = 24。用 `java.util.Base64` 会在 Android 7.x 上抛
 * `NoClassDefFoundError` —— 而且只在真机上、只在刷新时。
 * 用 `NO_WRAP`：标准 base64、不容忍空白，语义与解码器严格一一对应。
 */
internal fun encodeBase64(bytes: ByteArray): String = Base64.encodeToString(bytes, Base64.NO_WRAP)

internal fun decodeBase64(text: String): ByteArray = Base64.decode(text, Base64.NO_WRAP)

/** AAD 的字节形式 —— 只此一处，避免"编码用了两套"这种极难查的分叉。*/
internal fun envelopeAadBytes(envelope: WidgetEnvelope): ByteArray =
    envelopeAad(envelope.v, envelope.dayStr, envelope.validUntil).toByteArray(Charsets.UTF_8)
