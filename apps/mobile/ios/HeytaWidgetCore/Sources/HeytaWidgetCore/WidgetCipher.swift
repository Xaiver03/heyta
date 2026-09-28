import CryptoKit
import Foundation

/**
 快照的解密与封包（Swift 侧，CryptoKit）。
 ==========================================

 ## 线格式（**跨语言契约**）

 ```
 ciphertext = base64( AES-256-GCM(plaintext=UTF-8 JSON, key=32B, nonce=12B, aad=envelopeAad) || tag(16B) )
 ```

 ⚠️ **`ct || tag` 这个顺序**：WebCrypto、CryptoKit、Java 三边默认都是它，
 但 CryptoKit 的 `AES.GCM.SealedBox(combined:)` 期望的是 **`nonce || ct || tag`** ——
 直接用 `combined:` 会把 nonce 当成密文开头，得到"认证失败"。
 所以这里**显式**用 `SealedBox(nonce:ciphertext:tag:)` 三件套构造。

 ## 🔴 这里**只做一次 AES-GCM**，绝不跑 Argon2id（D1）

 Argon2id（`m=64 MiB, t=3`）在桌面组件的环境下**跑不动**：组件被系统唤醒后
 只有很短的预算（iOS 上 `TimelineProvider` 的 `getTimeline` 会被系统限时），
 而 64 MiB 的内存分配本身就足以让它被杀掉。
 所以小组件用的是**设备密钥**（Keychain 里的一把随机 AES 密钥），
 不是从用户密码派生出来的那把。见 D1 与 ADR-0025。

 ## 为什么不用 `SymmetricKey(data:)` 的便利初始化之外的东西

 没有别的东西可用 —— 这是好事。平台只有**一份** AES 实现，
  "生产路径与夹具用不同实现"这类 bug 在结构上不可能发生。
 */
public enum WidgetCipher {

    /// 解密失败的原因。
    ///
    /// ⚠️ **刻意不区分**"base64 坏了" / "长度不对" / "认证失败"：
    /// 对调用方来说三者是**同一件事** —— "这份快照现在不可信"，
    /// 处理方式完全一样（显示占位）。区分它们只会有两个后果：
    /// 一是有人忍不住"某几种情况可以降级"，二是给攻击者一个 oracle。
    public enum Failure: Error, Equatable {
        case badBase64
        case badNonceLength
        case tooShortForTag
        case authenticationFailed
    }

    /**
     解密。成功返回载荷 JSON 的**原始字节**（调用方再去解析）。

     @param nonceBase64 信封里的 `nonce`（标准 base64，12 字节）。
     @param ciphertextBase64 信封里的 `ciphertext`（标准 base64，`ct || tag`）。
     @param key 32 字节设备密钥。
     @param aad 来自 `WidgetEnvelope.aad` 的字符串（UTF-8）。
     */
    public static func open(
        nonceBase64: String,
        ciphertextBase64: String,
        key: Data,
        aad: String
    ) throws -> Data {
        guard let nonceData = decodeBase64(nonceBase64) else { throw Failure.badBase64 }
        guard let combined = decodeBase64(ciphertextBase64) else { throw Failure.badBase64 }
        guard nonceData.count == widgetNonceBytes else { throw Failure.badNonceLength }
        guard combined.count >= widgetTagBytes else { throw Failure.tooShortForTag }

        let ciphertext = combined.prefix(combined.count - widgetTagBytes)
        let tag = combined.suffix(widgetTagBytes)

        do {
            let box = try AES.GCM.SealedBox(
                nonce: AES.GCM.Nonce(data: nonceData),
                ciphertext: ciphertext,
                tag: tag
            )
            return try AES.GCM.open(
                box,
                using: SymmetricKey(data: key),
                authenticating: Data(aad.utf8)
            )
        } catch {
            // ⚠️ 把 CryptoKit 的错误**收成一个** case：见 `Failure` 的注释。
            throw Failure.authenticationFailed
        }
    }

    /**
     封包。**生产路径上不使用它** —— 应用侧只交出明文、由原生封包
     （见 Android 侧的 `WidgetModule.sealWidgetSnapshot`），
     这样 JS 永远拿不到密钥字节。这里留着是为了**测试的往返验证**：
     "自己封自己解"两边同时错也会通过，所以真正的锁是**读黄金夹具**
     （`GoldenFixtureTests`），这条只是辅助。
     */
    public static func seal(
        plaintext: Data,
        key: Data,
        nonce: Data,
        aad: String
    ) throws -> (nonce: String, ciphertext: String) {
        let box = try AES.GCM.seal(
            plaintext,
            using: SymmetricKey(data: key),
            nonce: AES.GCM.Nonce(data: nonce),
            authenticating: Data(aad.utf8)
        )
        // CryptoKit 把 tag 放在 `box.tag` 里，与 `box.combined` 的 `nonce||ct||tag` 不同 ——
        // 我们要的是 `ct||tag`，所以显式拼。
        let combined = box.ciphertext + box.tag
        return (encodeBase64(nonce), encodeBase64(combined))
    }

    // ─────────────────────────────────────────────────────────────
    // base64
    // ─────────────────────────────────────────────────────────────

    /// 标准 base64。与 TS 的 `Buffer.toString('base64')`、Android 的
    /// `Base64.NO_WRAP` 一致（都带 `=` 填充）。
    public static func encodeBase64(_ data: Data) -> String {
        data.base64EncodedString()
    }

    /**
     解码，**容忍缺失的 `=` 填充**。

     ⚠️ 这条宽容是**刻意**的，也是安全的：填充位不承载任何信息，
     补上之后解出的字节**完全相同**。所以接受"少几个 `=`"不会让任何
     本该被拒绝的快照通过 —— 它不是 fail-open。

     不宽容的后果反而是真的：某些跨语言 base64 实现（尤其是手写的）
     会省掉填充，而症状是"这一端显示占位、那一端正常"。
     */
    public static func decodeBase64(_ s: String) -> Data? {
        if let d = Data(base64Encoded: s) { return d }
        // 补足到 4 的倍数
        let remainder = s.count % 4
        guard remainder != 1 else { return nil } // 长度为 4k+1 不是合法 base64
        let padded = s + String(repeating: "=", count: (4 - remainder) % 4)
        return Data(base64Encoded: padded)
    }
}
