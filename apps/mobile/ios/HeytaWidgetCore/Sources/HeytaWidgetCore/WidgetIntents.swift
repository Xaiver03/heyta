import Foundation

/**
 点击意图队列（Swift 侧）。
 ============================

 与 `packages/widget-core/src/intents.ts` 的 `WidgetIntentQueue` 和
 Android 的 `WidgetIntentQueue.kt` 一一对应。

 ## 这个类型解决的问题

 用户在组件上点一下，**组件产生不了 op**（那是刻意的红线）。它只把
 "我希望这个任务变成 X" 写进共享容器，等应用下次醒来时 drain。

 🔴 **是"目标状态"而不是"切换"**：动作在过期视图上会算错
 （用户看到未完成、实际已完成，点一下变成"标记完成" = 没有变化），
 而目标状态是**幂等**的 —— 无论当前是什么，结果都是它。

 ## 解析纪律：坏数据**整体拒绝**，不截断、不跳过

 | 情况 | 处理 |
|---|---|
| JSON 坏 / 不是对象 / `v` 不认识 | 空队列 |
| 条数 > [widgetIntentMax] | **整体拒绝**（不是截断后接受） |
| 任一条目坏 | **整体拒绝**（不是跳过坏的） |

 **为什么不是"跳过坏的那条"**：跳过之后队列看起来是好的，而写入方的 bug
 被**永久掩盖**了。整体拒绝至少会让"组件上的点击全部没反应"这件事暴露出来 ——
 那是一个用户会来报的现象，而"偶尔少一条"不会。
 */
public let widgetIntentVersion = 1

/// 队列长度上限。超过时丢**最旧**的（合并之后才截断）。
public let widgetIntentMax = 50

/// 一条点击意图。字段与 TS 的 `WidgetIntent` 一一对应。
public struct WidgetIntent: Equatable, Sendable {
    public let taskId: String
    /// 用户希望这个任务变成的完成状态。
    public let targetIsDone: Bool
    /// 点击时刻（epoch ms）。用于"同一任务多次点击时后者胜"的判定。
    public let at: Double

    public init(taskId: String, targetIsDone: Bool, at: Double) {
        self.taskId = taskId
        self.targetIsDone = targetIsDone
        self.at = at
    }
}

/// 意图队列。`v` 不进数据结构（当前版本恒为 [widgetIntentVersion]），只体现在序列化上。
public struct WidgetIntentQueue: Sendable, Equatable {
    public let intents: [WidgetIntent]

    public init(_ intents: [WidgetIntent] = []) {
        self.intents = intents
    }

    public static let empty = WidgetIntentQueue()
}

public enum WidgetIntentQueues {

    /// 解析。**永不抛** —— 坏数据给空队列。
    ///
    /// 与 Android 的 `parse` **签名不同**（那边收 `String`，这边收 `Data?`），
    /// 这正是 TS 侧存在的那个"字符串 vs 对象"跨端不对称在 Swift 上的再现。
    /// 这里统一收原始字节，内部完成 JSON 解析 —— 少一个让调用方选错的机会。
    /// `String` 重载 —— RN 桥接层从容器里读出来的是**原始 JSON 字符串**
    /// （`drainIntentQueue` 刻意不解析），所以这条路必须能收字符串。
    /// 转成 `Data` 再走同一个实现：**判定只有一处**。
    public static func parse(_ raw: String?) -> WidgetIntentQueue {
        guard let raw else { return .empty }
        return parse(Data(raw.utf8))
    }

    public static func parse(_ raw: Data?) -> WidgetIntentQueue {
        guard let raw,
              let root = try? JSONSerialization.jsonObject(with: raw, options: [.fragmentsAllowed]),
              let obj = J.object(root)
        else { return .empty }

        guard J.integer(obj["v"]) == widgetIntentVersion else { return .empty }
        guard let rawIntents = J.array(obj["intents"]) else { return .empty }

        // 超限本身就是坏数据（本对象自己不会写出超限的队列）→ 整体拒绝。
        guard rawIntents.count <= widgetIntentMax else { return .empty }

        var out: [WidgetIntent] = []
        out.reserveCapacity(rawIntents.count)
        for entry in rawIntents {
            guard let e = J.object(entry),
                  let taskId = J.nonEmptyString(e["taskId"]),
                  let targetIsDone = J.bool(e["targetIsDone"]),
                  let at = J.number(e["at"])
            else {
                // 任一条目坏 → **整体拒绝**，见文件头。
                return .empty
            }
            out.append(WidgetIntent(taskId: taskId, targetIsDone: targetIsDone, at: at))
        }
        return WidgetIntentQueue(out)
    }

    /**
     合并一条意图：**后写者胜**（同一 `taskId` 只留最新的那条）。

     ## 顺序：先折叠，再截断

 先 `take` 再折叠会把"同一条任务的旧意图"挤掉更值得保留的别的任务。
     所以：删掉同 `taskId` 的旧条目 → 追加到末尾 → **然后**才按上限丢最旧的。
     */
    public static func merge(_ queue: WidgetIntentQueue, _ intent: WidgetIntent) -> WidgetIntentQueue {
        mergeAll(queue, [intent])
    }

    /// 批量合并。**第二个参数胜**（见 [mergeOlderIntoNewer] 的注释，那里踩过一次）。
    public static func mergeAll(_ queue: WidgetIntentQueue, _ incoming: [WidgetIntent]) -> WidgetIntentQueue {
        guard !incoming.isEmpty else { return queue }

        let incomingIds = Set(incoming.map(\.taskId))
        // 先删同 taskId 的旧条目（"折叠"），再把新条目追加到末尾。
        var merged = queue.intents.filter { !incomingIds.contains($0.taskId) }
        merged.append(contentsOf: incoming)

        // 折叠**之后**才截断，且丢最旧的（也就是数组头部）。
        if merged.count > widgetIntentMax {
            merged = Array(merged.suffix(widgetIntentMax))
        }
        return WidgetIntentQueue(merged)
    }

    /**
     把**更旧的一批**意图写回一个**更新的**队列。

     🔴 这个方法的存在本身就是一条 bug 的修复记录。
     `mergeAll(queue, incoming)` 的约定是"第二个参数更新"。而 drain 的场景是：
     "drain 读走了队列 → 落 op → 有几条失败了 → 写回"。写回的那批是**更旧的**，
     但中间用户完全可能又点了一下（那个点击在容器里，是**更新的**）。

     写反的后果：
     ```
     T0 drain（失败意图 t1:true）
     T1 用户取消勾选      → 容器里 t1:false
     T2 写回（写反）      → 覆盖成 t1:true
     T3 下次 drain        → 把 t1 设成已完成
     ```
     **用户的"取消"被回滚了**，他看到的是"我明明取消了，它自己又勾上了"。

     只在「drain 期间又点了 + 那条 op 失败」这个窄窗口出现 —— 所以它
     **不可能靠手工测试发现**。修法不是加注释提醒顺序，而是**让顺序写不反**。
     */
    public static func mergeOlderIntoNewer(_ current: WidgetIntentQueue, _ older: [WidgetIntent]) -> WidgetIntentQueue {
        // 🔴 注意参数位置：把 **older 当队列**、把 **current 当新来的**。
        //
        // 第一版我照着"自然语序"写成了 `mergeAll(current, older)` ——
        // 那正好让**更旧的**胜出，也就是把 Kotlin 侧那个 bug **原样搬了过来**。
        // 测试 `test_意图_写回更旧的意图不能盖掉期间的新点击` 立刻红了。
        // 这就是那条测试存在的意义：**它盯的是一个真实发生过的错误，而我在另一边又犯了一次。**
        mergeAll(WidgetIntentQueue(older), current.intents)
    }
}
