import Foundation

/**
 小组件快照的**线格式契约**（Swift 侧）。
 ==========================================

 这一份是 `packages/widget-core/src/contract.ts` 的 Swift 对应物。
 **两边必须描述同一个东西** —— 所以下面每处都标了它在 TS 侧的名字。

 ## 🔴 与 Kotlin 侧的一个关键差别：这里**不用 `Codable` 自动解码**

 Kotlin 侧用的是 `org.json` 的手写读取（`opt`/`has`），因为要**区分**
 "键不存在" / "键存在但是 null" / "类型不对"，而 `Codable` 会把它们抹平成
 "解码失败"。Swift 侧同理：`JSONDecoder` 遇到 `projectId: null` 会走
 `decodeIfPresent` 返回 `nil` —— 但契约里 `projectId: null` 是**必须拒绝**的
 （`null-project-id`），而"键不存在"是合法的。

 两者混在一起 = **一个本该被拒绝的快照被接受**，而且没有任何日志。
 所以这里也走手写读取（`JSONSerialization` + 显式类型判断），
 与 TS / Kotlin 三方保持**同一套判断顺序**。

 ## 键序不属于契约

与 TS 侧同一条：对象键序不参与比较，**数组顺序参与**。
 */

// ─────────────────────────────────────────────────────────────
// 常量（对应 TS 的 `WIDGET_*`）
// ─────────────────────────────────────────────────────────────

/// 契约版本。对应 `WIDGET_CONTRACT_VERSION`。
public let widgetContractVersion = 1

/// 算法标识。对应 `WIDGET_ALG`。
public let widgetAlg = "AES-GCM-256"

/// 今日任务的条数上限。对应 `WIDGET_MAX_TASKS`。
///
/// ⚠️ 超限是**整体拒绝**，不是截断。截断会把一次契约违例
/// （应用侧该截没截）**掩盖**成"正常显示 20 条"。
public let widgetMaxTasks = 20

/// AES-GCM 的 nonce 长度（字节）。对应 `IV_LENGTH` / `GCM_NONCE_BYTES`。
public let widgetNonceBytes = 12

/// AES-GCM 的认证标签长度（字节）。
public let widgetTagBytes = 16

/// AES-256 的密钥长度。
///
/// ⚠️ 这个常量本来**只存在于 Kotlin 侧**（`WidgetContract.kt`），Swift 侧是写死的
/// `data.count == 32`。加进来是因为桥接层的 `getOrCreate` 也要用它 ——
/// 而"生成 32 字节"与"校验 32 字节"分处两地时，改了一处忘了另一处
/// 会让**新生成的密钥读不出来**（`read()` 的长度检查直接返回 nil），
/// 症状还是那个"组件显示打开 Heyta"。
public let widgetKeyBytes = 32

// ─────────────────────────────────────────────────────────────
// 拒绝原因
// ─────────────────────────────────────────────────────────────

/// 信封被拒绝的原因。对应 TS 的 `EnvelopeRejection`。
///
/// ⚠️ `unknownVersion` 与其余几项**必须能区分**：前者是**预期内的正常情况**
/// （旧版本的组件遇到新契约，用户升级了应用但组件还是旧的），
/// 后者是**真的坏了**。两者的日志与降级行为不同，所以不能都归成"解析失败"。
public enum EnvelopeRejection: String, Sendable {
    case notAnObject = "not-an-object"
    case unknownVersion = "unknown-version"
    case unsupportedAlg = "unsupported-alg"
    case malformedEnvelope = "malformed-envelope"
}

/// 载荷被拒绝的原因。对应 TS 的 `PayloadRejection`。
public enum PayloadRejection: String, Sendable {
    case notAnObject = "not-an-object"
    case missingToday = "missing-today"
    case todayNotArray = "today-not-array"
    case tooManyTasks = "too-many-tasks"
    case malformedTask = "malformed-task"
    case malformedSection = "malformed-section"
    case nullProjectId = "null-project-id"
}

// ─────────────────────────────────────────────────────────────
// 数据模型
// ─────────────────────────────────────────────────────────────

/// 快照信封的**明文**部分（`ciphertext` 之外的一切）。
///
/// 对应 TS 的 `WidgetEnvelope`。
public struct WidgetEnvelope: Equatable, Sendable {
    public let v: Int
    /// 应用算出的"今天"（`YYYY-MM-DD`）。
    ///
    /// 🔴 原生**绝不自己推导今天** —— 它只判 `now >= validUntil`。
    /// 理由见 `WidgetGate`。
    public let dayStr: String
    /// 快照失效时刻（epoch ms）。
    public let validUntil: Double
    public let alg: String
    /// AES-GCM 的 12 字节 nonce，**标准 base64**。
    public let nonce: String
    /// 密文（`ct || tag`），**标准 base64**。
    public let ciphertext: String

    public init(v: Int, dayStr: String, validUntil: Double, alg: String, nonce: String, ciphertext: String) {
        self.v = v
        self.dayStr = dayStr
        self.validUntil = validUntil
        self.alg = alg
        self.nonce = nonce
        self.ciphertext = ciphertext
    }

    /**
     用于 AEAD 的 associated data。对应 TS 的 `envelopeAad()`。

     🔴 **必须是这个精确的字符串**：三个字段用 `|` 连接。
     生成侧（TS）与解密侧（Swift / Kotlin / ArkTS）用的是**同一个函数**，
     所以一旦有人改了格式，解密会**立刻失败**而不是安静地用"另一套 AAD"。

     ⚠️ `validUntil` 是 **Double**，但拼进 AAD 时必须是**整数字面量**。
     `1_790_000_000_000` 的 Double 在 Swift 里 `String(…)` 会给
     `"1790000000000.0"` —— **与 TS 的 `1790000000000` 不同**，解密会失败。
     所以这里显式转成整数再拼。这是**跨语言最容易错的一处**：
     它不报错，只表现为"解不开密"。
     */
    public var aad: String {
        Self.makeAad(v: v, dayStr: dayStr, validUntil: validUntil)
    }

    /// AAD 的**唯一**拼法。
    ///
    /// ⚠️ 拆成静态函数是因为**加密侧**（`WidgetSealer`）在构造出信封之前
    /// 就要拿到 AAD —— 那时还没有 nonce / ciphertext，构造不出完整的 `WidgetEnvelope`。
    /// 第一版我在 `WidgetSealer` 里又拼了一遍 `"\(v)|\(dayStr)|\(validUntil)"`，
    /// 于是**解密侧用 `Int64`、加密侧用 `Double`** —— 自己加密的东西自己解不开。
    /// （而且是编译期发现不了的：两边都是合法的字符串拼接。）
    ///
    /// 所以拼法只有这一处，两条路径都走它。
    public static func makeAad(v: Int, dayStr: String, validUntil: Double) -> String {
        "\(v)|\(dayStr)|\(Int64(validUntil))"
    }
}

/// 今日任务。对应 TS 的 `WidgetTask`。
public struct WidgetTask: Equatable, Sendable {
    public let id: String
    public let title: String
    public let isDone: Bool
    /// ⚠️ 缺失时**省略键**，绝不写 `null`（见 `nullProjectId` 拒绝）。
    public let projectId: String?
    /// 四象限槽位。`1...4`；缺省表示未分类。
    public let quadrant: Int?

    public init(id: String, title: String, isDone: Bool, projectId: String? = nil, quadrant: Int? = nil) {
        self.id = id
        self.title = title
        self.isDone = isDone
        self.projectId = projectId
        self.quadrant = quadrant
    }
}

/// 今日习惯。对应 TS 的 `WidgetHabit`。
public struct WidgetHabit: Equatable, Sendable {
    public let id: String
    public let title: String
    public let doneToday: Bool
    /// ⚠️ **Double**：TS 只要求 `typeof === 'number'`，不做整数检查。
    public let streak: Double

    public init(id: String, title: String, doneToday: Bool, streak: Double) {
        self.id = id
        self.title = title
        self.doneToday = doneToday
        self.streak = streak
    }

    /// 收成整数。对应 Kotlin 的 `WidgetHabit.streakCount`。
    public var streakCount: Int { Int(streak) }
}

/// 专注状态。对应 TS 的 `WidgetFocus`。
///
/// 🔴 `remainingSeconds` **刻意不被渲染层使用** —— 它是发布那一刻的快照值，
/// 没有绝对时间锚点，画出来必然是错的。见 `WidgetModels.swift` 的 `FocusWidgetModel`。
public struct WidgetFocus: Equatable, Sendable {
    public let active: Bool
    public let remainingSeconds: Double?
    public let targetSeconds: Double?
    /// ⚠️ TS 只要求 `typeof === 'string'` —— **空字符串是合法的**。
    public let sessionTitle: String?
    /// 🔴 **本轮专注的绝对结束时刻**（Unix 毫秒）。灵动岛 / Live Activity 的前提。
    ///
    /// 对应 TS 的 `WidgetFocus.endsAt`。可选 = 向前兼容：缺省时 `active` 仍为真，
    /// 只是**不启动灵动岛**（它需要一个绝对时刻，见 `WidgetFocus.endsAt` 的长注释）。
    public let endsAt: Double?

    public init(
        active: Bool,
        remainingSeconds: Double? = nil,
        targetSeconds: Double? = nil,
        sessionTitle: String? = nil,
        endsAt: Double? = nil
    ) {
        self.active = active
        self.remainingSeconds = remainingSeconds
        self.targetSeconds = targetSeconds
        self.sessionTitle = sessionTitle
        self.endsAt = endsAt
    }
}

/// 已解析好的清单颜色（明暗各一个十六进制）。对应 `WidgetProjectColor` + D7。
public struct WidgetProjectColor: Equatable, Sendable {
    public let light: String
    public let dark: String

    public init(light: String, dark: String) {
        self.light = light
        self.dark = dark
    }
}

/// 载荷 —— 解密之后的内容。对应 TS 的 `WidgetPayload`。
public struct WidgetPayload: Equatable, Sendable {
    public let today: [WidgetTask]
    /// 键为槽位号字符串（`"1"..."4"`）。
    public let quadrant: [String: [WidgetTask]]?
    public let habits: [WidgetHabit]?
    public let focus: WidgetFocus?
    public let projectColors: [String: WidgetProjectColor]?

    public init(
        today: [WidgetTask],
        quadrant: [String: [WidgetTask]]? = nil,
        habits: [WidgetHabit]? = nil,
        focus: WidgetFocus? = nil,
        projectColors: [String: WidgetProjectColor]? = nil
    ) {
        self.today = today
        self.quadrant = quadrant
        self.habits = habits
        self.focus = focus
        self.projectColors = projectColors
    }
}

// ─────────────────────────────────────────────────────────────
// JSON 读取小工具 —— 显式判断"键不存在"与"是 null"
// ─────────────────────────────────────────────────────────────

/// 手写读取用的类型判断。**刻意不用 `Codable`**，理由见文件头。
enum J {

    /// 是不是"对象"（JSON 的 object）。数组**不算** —— 这一点与 TS 的
    /// `isPlainObject` 一致，而 Swift 里如果不排除 `NSArray` 就会把数组当对象。
    static func isObject(_ v: Any?) -> Bool {
        guard let v else { return false }
        // `NSNull` 是 JSON 的 null；`[Any]` 是数组。
        return !(v is NSNull) && (v is [String: Any])
    }

    static func object(_ v: Any?) -> [String: Any]? {
        guard isObject(v) else { return nil }
        return v as? [String: Any]
    }

    static func array(_ v: Any?) -> [Any]? {
        guard let v, !(v is NSNull) else { return nil }
        return v as? [Any]
    }

    /// 非空字符串。
    static func nonEmptyString(_ v: Any?) -> String? {
        guard let s = v as? String, !s.isEmpty else { return nil }
        return s
    }

    /// 任意字符串（**空字符串也算**）—— 对应 TS 的 `typeof === 'string'`。
    static func anyString(_ v: Any?) -> String? {
        guard let s = v as? String, !(v is NSNull) else { return nil }
        return s
    }

    /// 是不是 JSON 的布尔。
    ///
    /// ## 🔴 这是 Swift 侧的**头号** JSON 陷阱，而且方向和直觉相反
    ///
    /// `JSONSerialization` 把 JSON 的 `true` / `false` 和数字**都**解成 `NSNumber`。
    /// 于是：
    ///
    /// | 写法 | 后果 |
    /// |---|---|
    /// | `v as? Bool` | `NSNumber(1)` 会**桥接成 `true`** —— 于是 `isDone: 1` 被当成合法布尔通过，而 TS 会拒绝 |
    /// | `!(v is Bool)` 用来"排除布尔" | `NSNumber(1790000000000) is Bool` 也是 **true** —— 于是**所有数字都被当成布尔拒掉** |
    ///
    /// 第二种正是我第一版踩的坑：`validUntil` 永远解析失败、整个信封被拒，
    /// 表现是**四款组件全部显示"打开 Heyta"** —— 而看起来像"密钥没配好"。
    ///
    /// 唯一可靠的办法是比较 CoreFoundation 的**类型 id**：
    /// JSON 的布尔是 `CFBoolean`，数字是 `CFNumber`，两者是**不同的** CF 类型。
    /// 桥接到 Swift 的 `Any` 之后类型信息丢了，所以必须回到 CF 层问。
    static func isBoolean(_ v: Any?) -> Bool {
        guard let v, !(v is NSNull) else { return false }
        return CFGetTypeID(v as CFTypeRef) == CFBooleanGetTypeID()
    }

    static func bool(_ v: Any?) -> Bool? {
        guard isBoolean(v) else { return nil }
        return (v as? NSNumber)?.boolValue
    }

    /// 数字 → Double。对应 TS 的 `typeof === 'number' && Number.isFinite`。
    ///
    /// 见 [isBoolean]：**不能**用 `is Bool` / `as? Bool` 来区分，
    /// 必须走 CF 类型 id。TS 与 Kotlin 都没有这个坑（它们的 JSON number 与 bool
    /// 是两种不同的类型），所以这一层是 Swift 独有的、也是最容易写错的。
    static func number(_ v: Any?) -> Double? {
        guard let v, !(v is NSNull), !isBoolean(v) else { return nil }
        guard let num = v as? NSNumber else { return nil }
        // 布尔已经在上面排除了，所以这里 `boolValue` 不会再被误当成 0/1。
        let d = num.doubleValue
        return d.isFinite ? d : nil
    }

    /// 整数 → Int。对应 TS 的 `Number.isInteger`。
    static func integer(_ v: Any?) -> Int? {
        guard let d = number(v) else { return nil }
        guard d == d.rounded(), abs(d) < 9_007_199_254_740_992 else { return nil }
        return Int(d)
    }
}
