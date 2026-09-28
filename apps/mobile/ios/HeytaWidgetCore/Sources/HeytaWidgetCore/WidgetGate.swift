import Foundation

/**
 四款组件共用的"这份快照现在能不能显示"的判定（Swift 侧）。
 ============================================================

 与 Android 侧的 `WidgetGate.kt` **一一对应** —— 连字段名与状态数都一样。
 这不是"抄一遍"，是**故意的同构**：两端对同一份快照必须给出同样的判断，
 而"两端各写各的"最容易出现的分歧是**过期时刻的边界**
（`>` 还是 `>=`）与**空列表算不算占位**。

 ## 🔴 关键设计：`payload` **只在可显示时才存在**

 `WidgetContent.payload` 是 `nil`，除非状态是 `.ready`。

 这不是"顺手加个约束"，它把一整类 bug 变成**写不出来**：

 | 写法 | 第四款组件忘了判过期会怎样 |
 |---|---|
 | 结构是 `(state, payload)`，payload 总是有值 | 它会高高兴兴画出**昨天的任务**。类型系统不拦，测试不拦，只有用户看得见 |
 | 结构是 `payload: WidgetPayload?`，仅 `.ready` 时非 nil | 它**必须**先 `guard let` 或 `!`（后者是显式的"我知道我在冒险"）。忘了判就编译不过 |

 一句话：**别让"忘了判"是一件能编译通过的事。**

 ## 三条规则，各自都有出处

 1. **过期就显示占位，绝不显示过期内容。** ADR-0025 §2.1.3：
    "显示正确的占位状态**而不是过期数据**"。过期数据最危险的地方在于
    **它看起来是对的** —— 用户会照着昨天的清单做事。
 2. **原生绝不自己推导"今天"。** 只用信封里的 `dayStr`，只比较 `now >= validUntil`。
    时区、跨日切点、"今天从几点开始"都是产品规则，让四个平台各实现一遍，
    必然出现"iOS 认为还是今天、Android 认为已经是明天"。
 3. **拿不到密钥 / 解不开密 → 占位。** 设备刚重启、用户还没解锁时就是这种情况。
 */
public enum WidgetState: Sendable, Equatable {
    /// 没快照 / 密钥拿不到 / 解密失败 / 契约不合格。
    case placeholder
    /// 有快照但 `now >= validUntil`。
    case stale
    /// 可以显示。**注意条数可能是 0**（今天确实没有任务），那与 `.placeholder` 是两种状态。
    case ready
}

/// 一次渲染要用的全部可信内容。
public struct WidgetContent: Sendable, Equatable {
    public let state: WidgetState
    /// 快照对应的"今天"。连信封都没有时是 `nil`。
    public let dayStr: String?
    /// **仅 `.ready` 时非 `nil`。**
    public let payload: WidgetPayload?
    /// 待处理意图的**乐观叠加**：`taskId` → 用户点出来的目标状态。
    public let targets: [String: Bool]

    public init(state: WidgetState, dayStr: String?, payload: WidgetPayload?, targets: [String: Bool]) {
        self.state = state
        self.dayStr = dayStr
        self.payload = payload
        self.targets = targets
    }

    /// 只有 `.ready` 才谈得上"有内容可画"。
    public var isShowable: Bool { state == .ready && payload != nil }

    static func blank(_ state: WidgetState, dayStr: String?) -> WidgetContent {
        WidgetContent(state: state, dayStr: dayStr, payload: nil, targets: [:])
    }
}

public enum WidgetGate {

    /// 判定这一份快照现在是什么状态。
    ///
    /// @param envelope 已解析的信封。`nil` = 存储里没有快照，**或**信封没通过契约校验。
    /// @param payload 已解密的载荷。`nil` = 密钥拿不到、解密失败、或载荷没通过契约校验。
    /// @param queue 当前待处理的意图队列。
    /// @param now 当前时刻（epoch ms）。**由调用方传入**，这样测试能控制时间。
    public static func resolve(
        envelope: WidgetEnvelope?,
        payload: WidgetPayload?,
        queue: WidgetIntentQueue,
        now: Double
    ) -> WidgetContent {
        guard let envelope, let payload else {
            return .blank(.placeholder, dayStr: envelope?.dayStr)
        }

        // 规则 2：原生绝不自己推导"今天"，只判 `now >= validUntil`。
        //
        // `>=` 而不是 `>`：`validUntil` 是**失效时刻**，到了那一刻就已经不算数了。
        // ⚠️ 这里写成 `>` 的话，跨日那一毫秒内会显示昨天的任务 —— 而那一毫秒
        //    恰好是系统定时器最容易唤醒的时刻。两端必须是同一个比较符。
        if now >= envelope.validUntil {
            // 刻意**不给 payload**：见类注释规则 1。
            return .blank(.stale, dayStr: envelope.dayStr)
        }

        var targets: [String: Bool] = [:]
        targets.reserveCapacity(queue.intents.count)
        for intent in queue.intents {
            targets[intent.taskId] = intent.targetIsDone
        }

        return WidgetContent(state: .ready, dayStr: envelope.dayStr, payload: payload, targets: targets)
    }

    /// 把乐观叠加应用到一条任务上：**用户点过就用目标状态，否则用快照里的**。
    ///
    /// 抽出来是因为四款组件全都要做这一步，而"忘了叠加"的表现是
    /// **点击之后界面纹丝不动** —— 用户会以为坏了。
    public static func shownAsDone(_ task: WidgetTask, _ targets: [String: Bool]) -> Bool {
        targets[task.id] ?? task.isDone
    }
}

/**
 从"存储里的原始字节"到 [WidgetContent] 的**唯一**一条路径。
 ===============================================================

 与 Android 的 `WidgetRefresh.contentFor` 对应。

 ## 🔴 失败一律返回占位，**绝不返回空载荷**

 一个诱人的写法是：解密失败时给一个 `today: []` 的"空载荷"，
 这样调用方不用处理可选值。**那是错的**：组件会显示 **"今天没有任务"** ——
 而真相是"解不开密"。**那是在骗用户说今天没事。**

 所以这里返回的 `WidgetContent` 在失败时 `payload == nil`，
 渲染层**只能**走占位文案。

 ## 为什么入参是原始字节而不是已解析的对象

 因为"哪个环节失败"在这里必须被**抹平**：字节坏了、JSON 坏了、信封不合格、
 解密失败、载荷不合格 —— 对用户都是同一件事。让调用方拿到一个已经判完的
 [WidgetContent]，就不会有人在某一层"顺手降级一下"。
 */
public struct WidgetSnapshotReader: Sendable {

    /// 设备密钥的来源。生产上从 Keychain 读；测试里注入固定密钥。
    public typealias KeyProvider = @Sendable () -> Data?

    private let keyProvider: KeyProvider

    public init(keyProvider: @escaping KeyProvider) {
        self.keyProvider = keyProvider
    }

    /**
     读并判定。

     @param rawSnapshot App Group 容器里的原始快照字节（JSON 文本）。`nil` = 没写过。
     @param queue 待处理意图队列（来自共享容器）。
     @param now 当前时刻（epoch ms）。
     */
    public func read(rawSnapshot: Data?, queue: WidgetIntentQueue, now: Double) -> WidgetContent {
        guard let rawSnapshot else {
            // 没有快照 —— 应用还没跑过，或用户还没登录。**不是**"今天没有任务"。
            return .blank(.placeholder, dayStr: nil)
        }

        let json: Any?
        do {
            json = try JSONSerialization.jsonObject(with: rawSnapshot, options: [.fragmentsAllowed])
        } catch {
            json = nil
        }

        let envelope: WidgetEnvelope?
        switch WidgetParsing.parseEnvelope(json) {
        case .ok(let e): envelope = e
        case .rejected: envelope = nil
        }

        var payload: WidgetPayload?
        if let envelope, let key = keyProvider() {
            // ⚠️ 密钥拿不到是**正常状态**（设备刚重启、还没解锁）——
            //    不是错误，所以不打日志、不抛，直接落到 payload = nil。
            if let plaintext = try? WidgetCipher.open(
                nonceBase64: envelope.nonce,
                ciphertextBase64: envelope.ciphertext,
                key: key,
                aad: envelope.aad
            ), let parsed = try? JSONSerialization.jsonObject(with: plaintext, options: [.fragmentsAllowed]) {
                if case .ok(let p) = WidgetParsing.parsePayload(parsed) { payload = p }
            }
        }

        return WidgetGate.resolve(envelope: envelope, payload: payload, queue: queue, now: now)
    }
}
