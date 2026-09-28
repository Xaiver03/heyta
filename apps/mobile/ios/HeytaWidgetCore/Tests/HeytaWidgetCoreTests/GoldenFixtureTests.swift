import CryptoKit
import Foundation
import XCTest

@testable import HeytaWidgetCore

/**
 黄金夹具测试 —— iOS 侧**最重要**的一组测试。
 ================================================

 这里读的是 `packages/widget-core/fixtures/v1.golden.json` —— **与 TypeScript、
 Kotlin 完全同一份文件**，不是复制品。这正是 W2 计划里
 "Swift 解析器 + 读**同一份** golden fixture 的单测" 那一条。

 ## 它到底证明了什么（说清楚边界）

 | 证明了 | 没证明 |
|---|---|
| CryptoKit 的 AES-GCM 能解开 TS（Node `createCipheriv`）产出的密文 | 组件在真机上能显示 |
| AAD 字符串在 TS 与 Swift 之间**逐字符相同** | WidgetKit 的时间线会按预期刷新 |
| 信封/载荷的解析判据与 TS 一致 | App Group 授权配置正确 |
| 判别用例（`v=99`）给出的是 `unknownVersion` 而不是 `malformedEnvelope` | 设备密钥真的在 Keychain 里 |

 下面那张界线很重要：本仓库 §7「构建成功 ≠ 产物是新的」是同一种谨慎 ——
 **把"证明了什么"说清楚，比多证明一点更重要。**

 ## 🔴 AAD 是这里最容易错、也最难发现的一处

 `envelopeAad()` 在 TS 侧是 `` `${v}|${dayStr}|${validUntil}` ``。
 Swift 里如果写成 `"\(v)|\(dayStr)|\(validUntil)"`，而 `validUntil` 是 `Double`，
 那么 `1790000000000` 会格式化成 **`"1790000000000.0"`** —— AAD 就不同了。

 后果：**解密失败**，而症状只是"组件没有数据"。用户不会报，测试不会红
（除非有下面这条对照）。所以 `WidgetEnvelope.aad` 里显式用了 `Int64(validUntil)`，
而这里有一条测试**直接断言那个字符串**。
 */
final class GoldenFixtureTests: XCTestCase {

    // ─────────────────────────────────────────────────────────────
    // 定位夹具：从 `#filePath` 往上找到仓库根
    // ─────────────────────────────────────────────────────────────

    /// 仓库根。用 `#filePath` 而不是"当前工作目录" ——
    /// 后者取决于 `swift test` 从哪里被调用，在 CI 上会变。
    static let repoRoot: URL = {
        var url = URL(fileURLWithPath: #filePath)
        // GoldenFixtureTests.swift → HeytaWidgetCoreTests → Tests → HeytaWidgetCore
        //   → ios → mobile → apps → heyta
        for _ in 0..<7 { url.deleteLastPathComponent() }
        return url
    }()

    static let fixtureDir = repoRoot.appendingPathComponent("packages/widget-core/fixtures")

    /// 与 TS 侧 `fixture-source.ts` 的 `TEST_KEY` **同一条推导**。
    ///
    /// ⚠️ 这里刻意**重新推导一遍**（而不是读一个常量文件）：
    /// 如果 TS 那边改了 key 的推导方式而 Swift 没跟着改，解密会失败 ——
    /// 那正是我们想让它红的方式。
    static let testKey: Data = {
        Data(SHA256.hash(data: Data("heyta-widget-golden-key-v1".utf8)))
    }()

    static let testNonce: Data = {
        Data(SHA256.hash(data: Data("heyta-widget-golden-nonce-v1".utf8)).prefix(widgetNonceBytes))
    }()

    /// 夹具的"今天"。
    static let testDay = "2026-09-27"
    /// 夹具的失效时刻。见 `fixture-source.ts` 的 `TEST_VALID_UNTIL`。
    static let testValidUntil: Double = 1_790_000_000_000
    /// 夹具的"现在"：当天本地 15:00。**从日期派生 → 时区无关**。
    static func testNow() -> Double {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = .current
        f.locale = Locale(identifier: "en_US_POSIX")
        let noon = f.date(from: testDay)!.timeIntervalSince1970 * 1000 + 12 * 3_600_000
        return noon + 15 * 3_600_000
    }

    /**
     ⚠️ **`validUntil` 与 `dayStr` 在夹具里是刻意无关的。**

     `validUntil = 1_790_000_000_000`（≈2026-09-17），而 `dayStr = "2026-09-27"` ——
     **`validUntil` 比 `dayStr` 还早 10 天**。夹具的注释写得很清楚：
     `validUntil`"只参与 AAD 与 `validUntil`，**不**做本地日期解释"。

     所以 `testNow()`（2026-09-27 15:00）对这个夹具来说**是过期之后**的时间。
     第一版我拿它当"失效前"，于是 `ready` 用例拿到了 `stale` —— **是我错了，不是代码错了**。
     要测"失效前 / 失效后"，必须**相对 `validUntil`** 取值。
     */
    static func justBeforeExpiry() -> Double { testValidUntil - 1 }
    static func atExpiry() -> Double { testValidUntil }

    private func loadFixture(_ name: String) throws -> Data {
        try Data(contentsOf: Self.fixtureDir.appendingPathComponent(name))
    }

    // ─────────────────────────────────────────────────────────────
    // ① 信封
    // ─────────────────────────────────────────────────────────────

    func test_信封能解析且字段与TS一致() throws {
        let json = try JSONSerialization.jsonObject(with: try loadFixture("v1.golden.json"))

        guard case .ok(let envelope) = WidgetParsing.parseEnvelope(json) else {
            return XCTFail("黄金夹具的信封应当能解析")
        }

        XCTAssertEqual(envelope.v, widgetContractVersion)
        XCTAssertEqual(envelope.alg, widgetAlg)
        XCTAssertEqual(envelope.dayStr, Self.testDay)
        XCTAssertEqual(envelope.validUntil, Self.testValidUntil)
        XCTAssertFalse(envelope.nonce.isEmpty)
        XCTAssertFalse(envelope.ciphertext.isEmpty)
    }

    /**
     🔴 AAD 的字符串**逐字符**断言。

     这是防 `Double` 格式化那类 bug 的唯一手段。写成
     `XCTAssertEqual(envelope.aad, "1|2026-09-27|1790000000000.0")` 也会通过 ——
     所以断言的是**正确的那个字面量**，而上面 `validUntil` 的相等断言
     保证我们没在自欺欺人。
     */
    func test_AAD字符串逐字符正确() throws {
        let json = try JSONSerialization.jsonObject(with: try loadFixture("v1.golden.json"))
        guard case .ok(let envelope) = WidgetParsing.parseEnvelope(json) else {
            return XCTFail("应当能解析")
        }

        XCTAssertEqual(envelope.aad, "1|2026-09-27|1790000000000")

        // 反证：如果 AAD 用 Double 默认格式化，会多出 ".0" —— 那条路径必须不可能出现。
        XCTAssertFalse(
            envelope.aad.contains(".0"),
            "AAD 里出现了 \"\(envelope.aad)\" —— Double 被格式化成了小数形式。"
                + "TS 侧拼的是整数字面量，两边不一致 → 四端全部解密失败，而症状只是组件没有数据。"
        )
    }

    // ─────────────────────────────────────────────────────────────
    // ② 解密 + 与 TS 明文**结构性**比对
    // ─────────────────────────────────────────────────────────────

    /// 解密出来必须与 `v1.golden.plaintext.json` **结构等价**。
    ///
    /// ⚠️ 用"结构等价"而不是"逐字节相同"：密文是 compact JSON、明文文件是
    /// pretty-printed，而且**对象键序不属于契约**（TS / Swift / Kotlin 的
    /// 序列化器键序都不同）。**数组顺序属于契约** —— 所以这里用
    /// `NSDictionary` / `NSArray` 的深比较：前者忽略键序，后者比较顺序。
     func test_解密结果与TS产出的明文结构等价() throws {
        let json = try JSONSerialization.jsonObject(with: try loadFixture("v1.golden.json"))
        guard case .ok(let envelope) = WidgetParsing.parseEnvelope(json) else {
            return XCTFail("应当能解析")
        }

        let plaintext = try WidgetCipher.open(
            nonceBase64: envelope.nonce,
            ciphertextBase64: envelope.ciphertext,
            key: Self.testKey,
            aad: envelope.aad
        )

        let decrypted = try JSONSerialization.jsonObject(with: plaintext, options: [.fragmentsAllowed])
        let expected = try JSONSerialization.jsonObject(with: try loadFixture("v1.golden.plaintext.json"))

        assertDeepEqual(decrypted, expected, path: "$")
    }

    /// 深比较。对象忽略键序，**数组比较顺序**。
    private func assertDeepEqual(_ actual: Any, _ expected: Any, path: String) {
        if let a = actual as? [String: Any], let e = expected as? [String: Any] {
            // 键集合必须一样（少一个键 = 契约缺字段；多一个 = 契约多字段）
            XCTAssertEqual(
                Set(a.keys), Set(e.keys),
                "\(path) 的键集合不同：实际 \(Set(a.keys).sorted())，期望 \(Set(e.keys).sorted())"
            )
            for key in Set(a.keys).intersection(e.keys).sorted() {
                assertDeepEqual(a[key]!, e[key]!, path: "\(path).\(key)")
            }
            return
        }
        if let a = actual as? [Any], let e = expected as? [Any] {
            XCTAssertEqual(a.count, e.count, "\(path) 的长度不同")
            for (i, (av, ev)) in zip(a, e).enumerated() {
                assertDeepEqual(av, ev, path: "\(path)[\(i)]")
            }
            return
        }
        XCTAssertEqual(
            String(describing: actual), String(describing: expected),
            "\(path) 的值不同"
        )
    }

    // ─────────────────────────────────────────────────────────────
    // ③ 类型化解析：确认解析器真的读懂了，而不只是"没报错"
    // ─────────────────────────────────────────────────────────────

    func test_类型化解析读懂了载荷() throws {
        let payload = try decryptGoldenV1Payload()

        // `today` 是必需字段，夹具里非空。
        XCTAssertFalse(payload.today.isEmpty, "夹具的 today 不应当为空")
        for task in payload.today {
            XCTAssertFalse(task.id.isEmpty)
            XCTAssertFalse(task.title.isEmpty)
        }

        // 四段可选字段夹具里都有（`buildWidgetPayload` 保证"五个字段永远都在"）。
        XCTAssertNotNil(payload.quadrant, "夹具应当带 quadrant")
        XCTAssertNotNil(payload.habits, "夹具应当带 habits")
        XCTAssertNotNil(payload.focus, "夹具应当带 focus")
        XCTAssertNotNil(payload.projectColors, "夹具应当带 projectColors")

        // 象限键恰好是 "1".."4"
        XCTAssertEqual(Set(payload.quadrant!.keys), Set(["1", "2", "3", "4"]))
    }

    /// 解密并解析夹具载荷。多处复用。
    private func decryptGoldenV1Payload() throws -> WidgetPayload {
        let json = try JSONSerialization.jsonObject(with: try loadFixture("v1.golden.json"))
        guard case .ok(let envelope) = WidgetParsing.parseEnvelope(json) else {
            throw XCTSkip("夹具信封解析失败")
        }
        let plaintext = try WidgetCipher.open(
            nonceBase64: envelope.nonce,
            ciphertextBase64: envelope.ciphertext,
            key: Self.testKey,
            aad: envelope.aad
        )
        let raw = try JSONSerialization.jsonObject(with: plaintext, options: [.fragmentsAllowed])
        guard case .ok(let payload) = WidgetParsing.parsePayload(raw) else {
            throw XCTSkip("载荷解析失败")
        }
        return payload
    }

    // ─────────────────────────────────────────────────────────────
    // ④ 密码学的负面用例 —— "解不开"必须真的是"解不开"
    // ─────────────────────────────────────────────────────────────

    func test_换一把密钥就解不开() throws {
        let json = try JSONSerialization.jsonObject(with: try loadFixture("v1.golden.json"))
        guard case .ok(let envelope) = WidgetParsing.parseEnvelope(json) else {
            return XCTFail("应当能解析")
        }

        let wrongKey = Data(SHA256.hash(data: Data("another-key".utf8)))
        XCTAssertThrowsError(
            try WidgetCipher.open(
                nonceBase64: envelope.nonce,
                ciphertextBase64: envelope.ciphertext,
                key: wrongKey,
                aad: envelope.aad
            ),
            "换一把密钥必须失败 —— 否则 AES-GCM 的认证根本没生效"
        ) { error in
            XCTAssertEqual(error as? WidgetCipher.Failure, .authenticationFailed)
        }
    }

    func test_AAD改一个字符就解不开() throws {
        let json = try JSONSerialization.jsonObject(with: try loadFixture("v1.golden.json"))
        guard case .ok(let envelope) = WidgetParsing.parseEnvelope(json) else {
            return XCTFail("应当能解析")
        }

        // 这正是"伪造 dayStr / validUntil"的攻击面：攻击者想让组件
        // 永远显示过期数据，就得改 dayStr —— AAD 会拦住他。
        XCTAssertThrowsError(
            try WidgetCipher.open(
                nonceBase64: envelope.nonce,
                ciphertextBase64: envelope.ciphertext,
                key: Self.testKey,
                aad: "1|2026-09-28|1790000000000"
            ),
            "改了 dayStr 的 AAD 必须失败 —— 这是「过期数据装作今天」的攻击面"
        )

        XCTAssertThrowsError(
            try WidgetCipher.open(
                nonceBase64: envelope.nonce,
                ciphertextBase64: envelope.ciphertext,
                key: Self.testKey,
                aad: "1|2026-09-27|1790000000001"
            ),
            "改了 validUntil 的 AAD 必须失败 —— 这是「让过期数据永不过期」的攻击面"
        )
    }

    func test_篡改密文就解不开() throws {
        let json = try JSONSerialization.jsonObject(with: try loadFixture("v1.golden.json"))
        guard case .ok(let envelope) = WidgetParsing.parseEnvelope(json) else {
            return XCTFail("应当能解析")
        }

        var bytes = WidgetCipher.decodeBase64(envelope.ciphertext)!
        bytes[0] ^= 0x01 // 翻一个 bit

        XCTAssertThrowsError(
            try WidgetCipher.open(
                nonceBase64: envelope.nonce,
                ciphertextBase64: WidgetCipher.encodeBase64(bytes),
                key: Self.testKey,
                aad: envelope.aad
            ),
            "翻一个 bit 必须失败"
        )
    }

    func test_篡改认证标签就解不开() throws {
        let json = try JSONSerialization.jsonObject(with: try loadFixture("v1.golden.json"))
        guard case .ok(let envelope) = WidgetParsing.parseEnvelope(json) else {
            return XCTFail("应当能解析")
        }

        var bytes = WidgetCipher.decodeBase64(envelope.ciphertext)!
        // 最后 16 字节是 tag。
        bytes[bytes.count - 1] ^= 0x01

        XCTAssertThrowsError(
            try WidgetCipher.open(
                nonceBase64: envelope.nonce,
                ciphertextBase64: WidgetCipher.encodeBase64(bytes),
                key: Self.testKey,
                aad: envelope.aad
            ),
            "改 tag 必须失败"
        )
    }

    // ─────────────────────────────────────────────────────────────
    // ⑤ 判别用例：v=99
    // ─────────────────────────────────────────────────────────────

    /**
     🔴 这条测试盯的是**状态的区分**，不是"能不能解"。

     `v99.unknown.golden.json` 是**预期内的正常情况** ——
     用户把应用降级了、组件还是新版本。它必须是 `unknownVersion`，
     **不是** `malformedEnvelope`：两者的日志与降级行为不同，
     混在一起会让"真坏了"淹没在"版本不匹配"里。
     */
    func test_未来版本给出unknownVersion而不是malformed() throws {
        let json = try JSONSerialization.jsonObject(with: try loadFixture("v99.unknown.golden.json"))

        guard case .rejected(let reason, _) = WidgetParsing.parseEnvelope(json) else {
            return XCTFail("v=99 必须被拒绝")
        }
        XCTAssertEqual(
            reason, .unknownVersion,
            "v=99 必须是 unknownVersion —— 它是预期内的版本不匹配，不是坏数据"
        )
    }

    // ─────────────────────────────────────────────────────────────
    // ⑥ 读取器端到端：字节 → WidgetContent
    // ─────────────────────────────────────────────────────────────

    func test_读取器在失效前给出ready() throws {
        let reader = WidgetSnapshotReader(keyProvider: { Self.testKey })
        let content = reader.read(
            rawSnapshot: try loadFixture("v1.golden.json"),
            queue: .empty,
            now: Self.justBeforeExpiry()
        )

        XCTAssertEqual(content.state, .ready)
        XCTAssertEqual(content.dayStr, Self.testDay)
        XCTAssertNotNil(content.payload, "READY 时 payload 必须存在")
        XCTAssertTrue(content.isShowable)
    }

    func test_读取器在失效后给出stale且不给载荷() throws {
        let reader = WidgetSnapshotReader(keyProvider: { Self.testKey })
        let content = reader.read(
            rawSnapshot: try loadFixture("v1.golden.json"),
            queue: .empty,
            now: Self.atExpiry() // 恰好等于失效时刻
        )

        XCTAssertEqual(content.state, .stale)
        // 🔴 这两条是本文件里最要紧的断言：过期时**必须没有载荷**。
        XCTAssertNil(content.payload, "过期时绝不能给出载荷 —— 那会让组件画出昨天的任务")
        XCTAssertFalse(content.isShowable)
        // 但日期仍然带出来（组件要说"数据已过期"，说得出是哪天的）。
        XCTAssertEqual(content.dayStr, Self.testDay)
    }

    func test_读取器在拿不到密钥时给出占位() throws {
        // 设备刚重启、用户还没解锁 —— **正常状态**，不是错误。
        let reader = WidgetSnapshotReader(keyProvider: { nil })
        let content = reader.read(
            rawSnapshot: try loadFixture("v1.golden.json"),
            queue: .empty,
            now: Self.justBeforeExpiry()
        )

        XCTAssertEqual(content.state, .placeholder)
        XCTAssertNil(content.payload)
    }

    func test_读取器在没有快照时给出占位且没有日期() {
        let reader = WidgetSnapshotReader(keyProvider: { Self.testKey })
        let content = reader.read(rawSnapshot: nil, queue: .empty, now: Self.justBeforeExpiry())

        XCTAssertEqual(content.state, .placeholder)
        XCTAssertNil(content.payload)
        XCTAssertNil(content.dayStr, "连信封都没有，就没有「哪一天」可说")
    }

    func test_读取器在字节坏掉时给出占位() {
        let reader = WidgetSnapshotReader(keyProvider: { Self.testKey })
        let content = reader.read(rawSnapshot: Data("not json at all".utf8), queue: .empty, now: Self.justBeforeExpiry())

        XCTAssertEqual(content.state, .placeholder)
        XCTAssertNil(content.payload, "坏字节绝不能降级成「今天没有任务」")
    }
}
