import Foundation
import Security

import HeytaWidgetCore

/**
 把载荷封成信封 —— **应用侧**的那一步。
 ========================================

 ## 🔴 密钥不穿桥

 `WidgetSealer` 接收的是**密钥字节**，而调用它的是原生（RN 桥接层），
 不是 JS。JS 交明文、拿回信封字符串，**全程拿不到密钥**。

 这是 D1 那个决定的落地方式，也是唯一一种能真正做到
 "密钥不进 JS 堆、不进日志、不进崩溃上报"的形状 ——
 换一种做法（比如把密钥交给 JS 去加密）在代码上更难写错，但在**泄露面**上无法挽回。

 ## 为什么 AAD 是 `"v|dayStr|validUntil"`
 
 见 `WidgetEnvelope.aad`。这里只说**这一层**的责任：
 `validUntil` 从 JS 过来是 `Double`，而 AAD 用的是**整数字符串**。
 如果这里忘了取整，AAD 会变成 `"1|2026-09-27|1790000000000.0"` ——
 与应用侧、与另外三端**全都对不上**，而唯一的症状是"组件没数据"。
 所以 `Int64(validUntil)` 是在 `WidgetEnvelope.aad` 里强制做的（只有一处），
 这个函数负责的是**先校验范围**，让越界的值在**写入点**就被拒。
 */
public enum WidgetSealer {

    public enum Failure: Error, Equatable {
        /// `dayStr` 为空。TS 与 Android 都在写入点拒绝它。
        case emptyDayStr
        /// `validUntil` 越界或不是整数。
        case badValidUntil(Double)
        /// 密钥长度不对（必须是 32 字节）。
        case badKeyLength(Int)
    }

    /// 12 字节的随机 nonce —— 与 TS / Android / 鸿蒙一致。
    ///
    /// 🔴 **每次 seal 都必须是新的 nonce。** 同一个 `(key, nonce)` 加密两份不同的明文，
    /// 会让 AES-GCM 的认证强度**彻底归零**（异或出明文、可伪造标签）。
    /// 这里用 `SecRandomCopyBytes` 而不是 `Int.random`：
    /// 后者是**可播种的伪随机**，而这是一个密码学用途 —— 两者的差别在正常情况下看不出来。
    public static func newNonce() -> Data {
        var bytes = [UInt8](repeating: 0, count: widgetNonceBytes)
        let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        if status != errSecSuccess {
            // `SecRandomCopyBytes` 只在系统 RNG 不可用时失败 —— 那时**没有任何安全的降级**，
            // 所以这里刻意不 fallback 到伪随机。返回全零会让密钥复用（见上），
            // 而崩溃至少是**响亮的**。
            fatalError("SecRandomCopyBytes 失败（status=\(status)）—— 系统随机源不可用，不能降级到伪随机")
        }
        return Data(bytes)
    }

    /**
     产出信封 JSON 字符串。

     ⚠️ 返回的是 JSON **字符串**，不是对象 —— 因为它的下一步是
     `setWidgetSnapshot`，而那一步会**重新解析并校验**它。
     先序列化一次能让"写入的东西"和"被校验的东西"是同一串字节。
     */
    public static func seal(
        payloadJson: String,
        dayStr: String,
        validUntil: Double,
        key: Data
    ) throws -> String {
        guard !dayStr.isEmpty else { throw Failure.emptyDayStr }

        // ⚠️ 必须显式判整数：`validUntil` 会进 AAD 字符串。
        //    `1.79e12` 与 `1790000000000` 拼出的 AAD 不同 → 四端全都解不开。
        guard validUntil.isFinite, validUntil >= 0, validUntil <= Double(WidgetParsing.maxEpochMs),
              validUntil == validUntil.rounded() else {
            throw Failure.badValidUntil(validUntil)
        }

        guard key.count == widgetKeyBytes else { throw Failure.badKeyLength(key.count) }

        let validUntilInt = Int64(validUntil)
        // ⚠️ 走 `WidgetEnvelope.makeAad` —— **不要**在这里重新拼一遍。
        //    解密侧与加密侧的 AAD 必须来自同一处，否则是"自己加密的自己解不开"。
        let aad = WidgetEnvelope.makeAad(
            v: widgetContractVersion,
            dayStr: dayStr,
            validUntil: validUntil
        )

        let nonce = newNonce()
        let sealed = try WidgetCipher.seal(
            plaintext: Data(payloadJson.utf8),
            key: key,
            nonce: nonce,
            aad: aad
        )

        // 键序不属于契约（`JSONSerialization` 不保证顺序），这里只是构造。
        // ⚠️ `validUntil` 用 `NSNumber(value: Int64)` 而不是 `Double`：
        //    后者可能被序列化成 `1.79e+12`，而解析端要求 `d == d.rounded()` ——
        //    虽然仍然成立，但**信封里的字面量**会与另外三端不同，
        //    而"逐字节比较信封"是排查跨端问题的第一手段。
        let envelope: [String: Any] = [
            "v": widgetContractVersion,
            "dayStr": dayStr,
            "validUntil": NSNumber(value: validUntilInt),
            "alg": widgetAlg,
            "nonce": sealed.nonce,
            "ciphertext": sealed.ciphertext,
        ]

        let data = try JSONSerialization.data(withJSONObject: envelope, options: [.sortedKeys])
        return String(decoding: data, as: UTF8.self)
    }
}
