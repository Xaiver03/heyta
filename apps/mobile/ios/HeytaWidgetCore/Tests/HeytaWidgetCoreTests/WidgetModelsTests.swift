import Foundation
import XCTest

@testable import HeytaWidgetCore

/**
 四款组件的渲染模型（Swift 侧）。
 ================================

 这一层是**唯一能在本机跑的四款组件的逻辑** —— SwiftUI 的 `body` 没有返回值可断言，
 WidgetKit 的时间线要设备才能驱动。所以判断全在这里，视图层只做"照着抄"。
 */
final class WidgetModelsTests: XCTestCase {

    private func envelope(validUntil: Double = 1_000, dayStr: String = "2026-09-27") -> WidgetEnvelope {
        WidgetEnvelope(v: 1, dayStr: dayStr, validUntil: validUntil, alg: widgetAlg, nonce: "a", ciphertext: "b")
    }

    private func ready(
        _ payload: WidgetPayload,
        targets: [String: Bool] = [:],
        dayStr: String = "2026-09-27"
    ) -> WidgetContent {
        WidgetContent(state: .ready, dayStr: dayStr, payload: payload, targets: targets)
    }

    private func task(_ id: String, _ done: Bool = false) -> WidgetTask {
        WidgetTask(id: id, title: "任务-\(id)", isDone: done)
    }

    // ─────────────────────────────────────────────────────────────
    // 🔴 全文件最要紧的一条：过期时**任何**模型都不给内容
    // ─────────────────────────────────────────────────────────────

    /**
     四款组件在 `.stale` / `.placeholder` 下**都必须**是空的。

     这条测试是"第四款组件忘了判过期"的**最后一道防线** ——
     类型系统已经拦了一层（`payload` 只在 `.ready` 时非 nil），
     但万一有人写成 `content.payload ?? WidgetPayload(today: [])`，
     类型系统就拦不住了，而那样会让组件显示 **"今天没有任务"** ——
     真相是"快照过期了"。**那是在骗用户说今天没事。**

     所以这里对四款逐一断言，**不是四份重复**：将来加第五款时，
     照着这张表加一行是最省力的做法，而漏掉的那一款会因为
     "它的模型在 stale 下居然有内容"而红。
     */
    func test_占位与过期时四款组件都不给内容() {
        for state in [WidgetState.placeholder, .stale] {
            let content = WidgetContent(state: state, dayStr: "2026-09-27", payload: nil, targets: [:])

            let today = TodayWidgetModelBuilder.build(content)
            XCTAssertEqual(today.state, state)
            XCTAssertTrue(today.rows.isEmpty, "今日任务在 \(state) 下不该有行")
            XCTAssertEqual(today.totalCount, 0, "\(state) 下的计数必须是 0，不能是「0/0 空列表」之外的任何东西")

            let quadrant = QuadrantWidgetModelBuilder.build(content)
            XCTAssertEqual(quadrant.state, state)
            XCTAssertTrue(quadrant.groups.isEmpty, "四象限在 \(state) 下不该有象限")

            let habits = HabitsWidgetModelBuilder.build(content)
            XCTAssertEqual(habits.state, state)
            XCTAssertTrue(habits.rows.isEmpty, "习惯在 \(state) 下不该有行")

            let focus = FocusWidgetModelBuilder.build(content)
            XCTAssertNil(focus.sessionTitle, "专注在 \(state) 下不该有会话标题")
            XCTAssertNil(focus.targetSeconds, "专注在 \(state) 下不该有目标时长")
        }
    }

    func test_专注区分占位与过期() {
        // 这两者对用户的含义不同：一个是"打开 Heyta"，一个是"数据已过期"。
        let placeholder = FocusWidgetModelBuilder.build(
            WidgetContent(state: .placeholder, dayStr: nil, payload: nil, targets: [:])
        )
        let stale = FocusWidgetModelBuilder.build(
            WidgetContent(state: .stale, dayStr: "2026-09-27", payload: nil, targets: [:])
        )
        XCTAssertEqual(placeholder.state, .placeholder)
        XCTAssertEqual(stale.state, .stale)
        XCTAssertEqual(stale.dayStr, "2026-09-27")
    }

    // ─────────────────────────────────────────────────────────────
    // 今日任务
    // ─────────────────────────────────────────────────────────────

    func test_今日任务_乐观叠加改变显示与目标状态() {
        let model = TodayWidgetModelBuilder.build(
            ready(WidgetPayload(today: [task("a")]), targets: ["a": true])
        )
        let row = model.rows.single!
        XCTAssertTrue(row.isDone, "用户点过 → 显示成已完成")
        XCTAssertFalse(row.targetIsDone, "再点一下应当翻回未完成")
    }

    func test_今日任务_计数反映叠加后的状态() {
        let model = TodayWidgetModelBuilder.build(
            ready(WidgetPayload(today: [task("a"), task("b")]), targets: ["a": true])
        )
        XCTAssertEqual(model.totalCount, 2)
        XCTAssertEqual(model.doneCount, 1)
    }

    func test_今日任务_空列表是ready而不是占位() {
        // 🔴 "今天确实没有任务"与"数据不可信"是**两种状态**，
        //    对用户的话术完全不同（"今天没有任务" vs "打开 Heyta"）。
        let model = TodayWidgetModelBuilder.build(ready(WidgetPayload(today: [])))
        XCTAssertEqual(model.state, .ready)
        XCTAssertTrue(model.rows.isEmpty)
        XCTAssertEqual(model.totalCount, 0)
    }

    func test_今日任务_不截断() {
        // 条数上限是**解析器**的判据（超 20 条整体拒绝）。
        // 模型层再截一刀会把一次契约违例掩盖成"正常显示 20 条"。
        let many = (0..<widgetMaxTasks).map { task("t\($0)") }
        let model = TodayWidgetModelBuilder.build(ready(WidgetPayload(today: many)))
        XCTAssertEqual(model.rows.count, widgetMaxTasks)
    }

    // ─────────────────────────────────────────────────────────────
    // 四象限
    // ─────────────────────────────────────────────────────────────

    func test_四象限_恒为四组且顺序固定() {
        let model = QuadrantWidgetModelBuilder.build(ready(WidgetPayload(today: [])))
        XCTAssertEqual(model.groups.map(\.slot), ["1", "2", "3", "4"])
    }

    func test_四象限_缺席的象限是0而不是消失() {
        // 只有槽 1 有任务 —— 另外三个必须仍然存在，否则 2×2 的格局就塌了。
        let model = QuadrantWidgetModelBuilder.build(
            ready(WidgetPayload(today: [], quadrant: ["1": [task("a")]]))
        )
        XCTAssertEqual(model.groups.count, 4)
        XCTAssertEqual(model.groups[1].total, 0)
        XCTAssertTrue(model.groups[1].rows.isEmpty)
    }

    func test_四象限_每格最多两行但计数是全部() {
        let tasks = (0..<5).map { task("q\($0)") }
        let model = QuadrantWidgetModelBuilder.build(
            ready(WidgetPayload(today: [], quadrant: ["2": tasks]))
        )
        XCTAssertEqual(model.groups[1].rows.count, QuadrantWidgetModelBuilder.rowsPerGroup)
        // ⚠️ 计数必须是 5 —— 只数画出来的会让 "0/2" 看着像真的只有两条。
        XCTAssertEqual(model.groups[1].total, 5)
    }

    func test_四象限_未完成优先() {
        let model = QuadrantWidgetModelBuilder.build(
            ready(WidgetPayload(today: [], quadrant: ["1": [task("done", true), task("todo")]]))
        )
        XCTAssertEqual(model.groups[0].rows.map(\.taskId), ["todo", "done"])
    }

    /**
     🔴 同分时**必须**按原始下标排 —— Swift 的 `sorted` 文档明确写了
     "not guaranteed to be stable"，而 Kotlin 的 `sortedBy` 是稳定的。

     不钉死下标的话会出现"iOS 与 Android 显示的象限内容顺序不一样"，
     而**两边各自都没错** —— 那种 bug 没人会去查，因为没有人"做错了事"。
     */
    func test_四象限_同分时保持载荷顺序() {
        // 三条都已完成 → 排序键相同 → 必须保持 a, b, c（只取前两条 = a, b）。
        let model = QuadrantWidgetModelBuilder.build(
            ready(WidgetPayload(today: [], quadrant: ["1": [task("a", true), task("b", true), task("c", true)]]))
        )
        XCTAssertEqual(model.groups[0].rows.map(\.taskId), ["a", "b"])
    }

    func test_四象限_只有已完成时也照画() {
        let model = QuadrantWidgetModelBuilder.build(
            ready(WidgetPayload(today: [], quadrant: ["1": [task("a", true), task("b", true)]]))
        )
        XCTAssertEqual(model.groups[0].rows.map(\.taskId), ["a", "b"])
        XCTAssertEqual(model.groups[0].done, 2)
    }

    func test_四象限_乐观叠加参与排序() {
        // 不叠加：a 已完成 → 排后面 → [b, a]
        // 叠加"a 回到未完成"：两条都未完成 → 保持载荷顺序 → [a, b]
        let tasks = [task("a", true), task("b")]
        let without = QuadrantWidgetModelBuilder.build(
            ready(WidgetPayload(today: [], quadrant: ["1": tasks]))
        )
        let with = QuadrantWidgetModelBuilder.build(
            ready(WidgetPayload(today: [], quadrant: ["1": tasks]), targets: ["a": false])
        )
        XCTAssertEqual(without.groups[0].rows.map(\.taskId), ["b", "a"])
        XCTAssertEqual(with.groups[0].rows.map(\.taskId), ["a", "b"],
                       "排序必须把乐观叠加算进去，否则用户点完行序不变、看起来像没点上")
    }

    func test_四象限_整个键缺席与四个空象限等价() {
        let noKey = QuadrantWidgetModelBuilder.build(ready(WidgetPayload(today: [])))
        let allEmpty = QuadrantWidgetModelBuilder.build(
            ready(WidgetPayload(today: [], quadrant: ["1": [], "2": [], "3": [], "4": []]))
        )
        XCTAssertEqual(noKey.groups.map(\.total), allEmpty.groups.map(\.total))
    }

    // ─────────────────────────────────────────────────────────────
    // 今日习惯
    // ─────────────────────────────────────────────────────────────

    private func habit(_ id: String, done: Bool = false, streak: Double = 0) -> WidgetHabit {
        WidgetHabit(id: id, title: "习惯-\(id)", doneToday: done, streak: streak)
    }

    func test_习惯_计数用全部而行只画五条() {
        let many = (0..<7).map { habit("h\($0)", done: $0 < 3) }
        let model = HabitsWidgetModelBuilder.build(ready(WidgetPayload(today: [], habits: many)))

        XCTAssertEqual(model.rows.count, HabitsWidgetModelBuilder.maxRows)
        // 🔴 计数必须是 7 与 3，不能是 5 与 3 —— 否则显示 "3/5" 而用户知道自己有 7 个。
        XCTAssertEqual(model.totalCount, 7)
        XCTAssertEqual(model.doneCount, 3)
    }

    func test_习惯_连续天数取整与负数夹零() {
        let model = HabitsWidgetModelBuilder.build(
            ready(WidgetPayload(today: [], habits: [habit("a", streak: 12.7), habit("b", streak: -3)]))
        )
        XCTAssertEqual(model.rows[0].streak, 12)
        XCTAssertEqual(model.rows[1].streak, 0, "显示「连续 -3 天」比不显示更糟")
    }

    func test_习惯_缺席等于没有习惯且状态仍是ready() {
        let model = HabitsWidgetModelBuilder.build(ready(WidgetPayload(today: [])))
        XCTAssertEqual(model.state, .ready, "没有习惯不是「数据不可信」，话术完全不同")
        XCTAssertEqual(model.totalCount, 0)
    }

    /**
     🔴 结构性锁定：习惯行**不许**长出可回写的字段。

     意图队列的元素是 `{taskId, targetIsDone}`，只能表达"任务"。
     把习惯伪装成任务会被 drain 归类为 `skippedMissing` 并**静默丢弃** ——
     用户以为打卡成功，应用什么都没做，且没有任何日志。

     这条测试盯的不是"算得对不对"，而是**"有没有人把它加进来"**。
     将来要支持组件内打卡，必须先改意图队列契约（见账本 U9）——
     那时这条测试会红，而那次改动会被 reviewer 看见。
     */
    func test_习惯行没有可回写的目标状态() {
        let forbidden = Mirror(reflecting: HabitsWidgetRow(
            habitId: "h", title: "t", doneToday: false, streak: 0
        )).children.compactMap(\.label).filter {
            $0.lowercased().contains("target") || $0.lowercased().contains("task")
        }
        XCTAssertEqual(
            forbidden, [],
            "HabitsWidgetRow 出现了可回写字段 \(forbidden) —— 习惯打卡回写不了，"
                + "见 HabitsWidgetRow 的注释。要支持它必须先改意图队列契约。"
        )
    }

    func test_习惯不被任务意图影响() {
        // 意图队列里的 taskId 可能**碰巧**与某个习惯 id 相同（都是字符串）。
        // 不隔离的话，用户在任务组件上点一下，习惯组件上某个习惯会莫名其妙变成已完成。
        let model = HabitsWidgetModelBuilder.build(
            ready(WidgetPayload(today: [], habits: [habit("a")]), targets: ["a": true])
        )
        XCTAssertFalse(model.rows[0].doneToday, "任务意图绝不能影响习惯行")
    }

    // ─────────────────────────────────────────────────────────────
    // 今日专注
    // ─────────────────────────────────────────────────────────────

    func test_专注_focus键缺席就是idle() {
        let model = FocusWidgetModelBuilder.build(ready(WidgetPayload(today: [])))
        XCTAssertEqual(model.state, .idle)
    }

    func test_专注_active为false就是idle() {
        let model = FocusWidgetModelBuilder.build(
            ready(WidgetPayload(today: [], focus: WidgetFocus(active: false)))
        )
        XCTAssertEqual(model.state, .idle)
    }

    func test_专注_active带出标题与目标时长() {
        let model = FocusWidgetModelBuilder.build(
            ready(WidgetPayload(today: [], focus: WidgetFocus(active: true, targetSeconds: 1500, sessionTitle: "写方案")))
        )
        XCTAssertEqual(model.state, .active)
        XCTAssertEqual(model.sessionTitle, "写方案")
        XCTAssertEqual(model.targetSeconds, 1500)
    }

    func test_专注_目标时长只收正数() {
        func target(_ s: Double?) -> Int? {
            FocusWidgetModelBuilder.build(
                ready(WidgetPayload(today: [], focus: WidgetFocus(active: true, targetSeconds: s)))
            ).targetSeconds
        }
        XCTAssertNil(target(0))
        XCTAssertNil(target(-60))
        XCTAssertEqual(target(60), 60)
        XCTAssertNil(target(nil))
    }

    func test_专注_空标题原样带出由视图层决定换文案() {
        // 在模型层把空标题换成"专注中"会让"用户没填标题"与"用户填了'专注中'"
        // 变得无法区分 —— 那是视图层的事。
        let model = FocusWidgetModelBuilder.build(
            ready(WidgetPayload(today: [], focus: WidgetFocus(active: true, sessionTitle: "")))
        )
        XCTAssertEqual(model.sessionTitle, "")
    }

    func test_专注_没有标题也没有目标时长时仍是active() {
        let model = FocusWidgetModelBuilder.build(
            ready(WidgetPayload(today: [], focus: WidgetFocus(active: true)))
        )
        XCTAssertEqual(model.state, .active)
        XCTAssertNil(model.sessionTitle)
        XCTAssertNil(model.targetSeconds)
    }

    /**
     🔴🔴 **本轮 iOS 侧最重要的一条测试。**

     契约里的 `WidgetFocus.remainingSeconds` 是**发布那一刻**的快照值，**没有绝对锚点**。
     把它画到组件上就是"看起来对、其实是错的"：应用 09:00 发布"剩余 25:00"，
     用户 09:10 看到的还是"剩余 25:00"；而且 `active` 也是冻结的 ——
     一场 09:25 就结束的专注，10:00 时组件还会说**"专注中"**。

     这条测试盯的**不是"算得对不对"**，而是**"有没有人把倒计时加进来"**。
     将来要加，正确的做法是给契约加绝对锚点 `endsAt`，
     然后**同时**把这条测试改掉 —— 那次改动会被 reviewer 看见。
     */
    func test_🔴_专注模型里绝对不能有倒计时字段() {
        let model = FocusWidgetModelBuilder.build(
            ready(WidgetPayload(today: [], focus: WidgetFocus(
                active: true, remainingSeconds: 1500, targetSeconds: 1500, sessionTitle: "写方案"
            )))
        )

        // ① 类型上没有倒计时字段
        let fields = Mirror(reflecting: model).children.compactMap(\.label).map { $0.lowercased() }
        let forbidden = fields.filter {
            $0.contains("remaining") || $0.contains("countdown")
                || $0.contains("elapsed") || $0.contains("left")
        }
        XCTAssertEqual(
            forbidden, [],
            "FocusWidgetModel 出现了倒计时字段 \(forbidden) —— 契约里的 remainingSeconds 没有绝对锚点，"
                + "画出来必然是错的。要加必须先给契约加 endsAt（见账本 U8）。"
        )

        // ② 就算载荷里**带着** remainingSeconds，模型也不把它带出来
        XCTAssertEqual(model.targetSeconds, 1500, "目标时长是静态事实，可以画")
        XCTAssertNil(
            Mirror(reflecting: model).children.compactMap(\.value).compactMap { $0 as? Int }
                .first { $0 == 1500 && model.targetSeconds != 1500 },
            "不该有第二个 1500"
        )
    }
}

private extension Array {
    /// 单元素便利取值（测试里读起来更短）。
    var single: Element? { count == 1 ? self[0] : nil }
}
