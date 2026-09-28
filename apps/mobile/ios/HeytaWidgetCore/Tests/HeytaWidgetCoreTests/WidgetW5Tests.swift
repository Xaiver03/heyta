import Foundation
import XCTest

@testable import HeytaWidgetCore

/**
 W5 · 锁屏隐私 + 灵动岛的承重测试。
 ====================================

 这两块都是**错了没有可见症状**的功能：

 | | 错了会怎样 |
|---|---|
| 锁屏隐私 | 标题被旁人看到。**用户不会知道是我们的错** —— 他会以为锁屏组件本来就这样 |
| 灵动岛倒计时 | 系统按时间轴平滑地数**错的那段时间**。它看起来完全正常，只是数字不对 |

 所以这里的每一条都不是"顺手加的断言"，而是对应一个具体的错误形态。
 */
final class WidgetW5Tests: XCTestCase {

    // ─────────────────────────────────────────────────────────────
    // 工具
    // ─────────────────────────────────────────────────────────────

    private func task(_ id: String, _ title: String, _ done: Bool = false) -> WidgetTask {
        WidgetTask(id: id, title: title, isDone: done)
    }

    private func ready(
        _ payload: WidgetPayload,
        targets: [String: Bool] = [:]
    ) -> WidgetContent {
        WidgetContent(state: .ready, dayStr: "2026-09-27", payload: payload, targets: targets)
    }

    /// 一个正在跑的专注：`endsAt` 是**绝对**时刻。
    private func runningFocus(endsAt: Double, target: Double? = 1_500) -> WidgetPayload {
        WidgetPayload(
            today: [],
            focus: WidgetFocus(
                active: true,
                remainingSeconds: 720,
                targetSeconds: target,
                sessionTitle: "写周报",
                endsAt: endsAt
            )
        )
    }

    private let NOW: Double = 1_790_000_000_000

    // ═════════════════════════════════════════════════════════════
    // W5-2 · 隐私偏好
    // ═════════════════════════════════════════════════════════════

    /**
     🔴 **坏数据必须回落到"默认"，而不是"全都藏起来"。**

     这是这个类型里最要紧的一条。理由：
     "藏起来"会让锁屏组件显示成 `•••`，而这条路径上的坏数据
     （文件没写、App Group 没配好）**恰恰是最常见的那种**。
     这样会让一个**配置问题**表现成**产品问题** —— 用户以为组件坏了，删掉它。

     而回落到默认值仍然有保护：系统的 `.privacySensitive()` 那一层还在。
     */
    func test_隐私偏好_坏数据回落到默认而不是藏起来() {
        for garbage: Any? in [
            nil,
            "这个不是对象",
            [1, 2, 3],
            ["alwaysHideTitles": "true"],   // 🔴 字符串 "true" 不是 Bool
            ["alwaysHideTitles": 1],        // 🔴 数字 1 不是 Bool
            ["别的字段": true],              // 字段名不对
            [:],
        ] {
            let parsed = WidgetPrivacyPreference.parse(garbage)
            XCTAssertEqual(
                parsed, .default,
                "坏数据应回落到默认（不额外隐藏），实际：\(parsed)"
            )
            XCTAssertFalse(
                parsed.shouldMaskTitles,
                "🔴 坏数据**不允许** fail closed 到「藏起来」—— 那会让配置问题看起来像产品问题"
            )
        }
    }

    func test_隐私偏好_真值被认出来且能往返() {
        let on = WidgetPrivacyPreference.parse(["alwaysHideTitles": true])
        XCTAssertTrue(on.shouldMaskTitles)
        XCTAssertEqual(WidgetPrivacyPreference.parse(on.serialized()), on)

        let off = WidgetPrivacyPreference.parse(["alwaysHideTitles": false])
        XCTAssertFalse(off.shouldMaskTitles)
        XCTAssertEqual(WidgetPrivacyPreference.parse(off.serialized()), off)
    }

    // ═════════════════════════════════════════════════════════════
    // W5-2 · 锁屏模型
    // ═════════════════════════════════════════════════════════════

    func test_锁屏_不可信时不给任何数字() {
        for state: WidgetState in [.placeholder, .stale] {
            let model = WidgetLockScreenModelBuilder.build(
                WidgetContent(state: state, dayStr: "2026-09-27", payload: nil, targets: [:])
            )
            XCTAssertEqual(model.state, state == .stale ? .stale : .placeholder)
            XCTAssertFalse(model.showsNumbers, "🔴 \(state) 下不给数字 —— 0 会被读成「今天没事」")
            XCTAssertFalse(model.isAllDone, "🔴 \(state) 不是「全部完成」—— 前者是不知道，后者是真做完了")
            XCTAssertNil(model.firstTitle)
        }
    }

    /**
     🔴 「今天真的没事」与「不知道」必须是**两种状态**。

     这两者在界面上都是"没有内容"，混起来之后组件就再也无法
     诚实地表达"我读不到数据"了 —— 而用户看到的是一个**假的"全部完成"**。
     */
    func test_锁屏_今天为空与不知道是两回事() {
        let empty = WidgetLockScreenModelBuilder.build(ready(WidgetPayload(today: [])))
        XCTAssertEqual(empty.state, .ready, "🔴 空列表是 ready —— 我们**知道**今天没事")
        XCTAssertTrue(empty.isAllDone)
        XCTAssertTrue(empty.showsNumbers)

        let unknown = WidgetLockScreenModelBuilder.build(
            WidgetContent(state: .placeholder, dayStr: nil, payload: nil, targets: [:])
        )
        XCTAssertFalse(unknown.isAllDone, "🔴 不知道 ≠ 全部完成")
        XCTAssertFalse(unknown.showsNumbers)
    }

    func test_锁屏_计数与第一件未完成任务() {
        let model = WidgetLockScreenModelBuilder.build(
            ready(WidgetPayload(today: [
                task("t1", "交房租"),
                task("t2", "写周报", true),
                task("t3", "买胶带"),
            ]))
        )
        XCTAssertEqual(model.totalCount, 3)
        XCTAssertEqual(model.doneCount, 1)
        XCTAssertEqual(model.openCount, 2)
        XCTAssertEqual(model.firstTitle, "交房租", "第一件**未完成**的，不是第一条")
    }

    /**
     🔴 **乐观叠加必须生效** —— 否则会出现"同一次点击，两块屏幕两个结果"。

     用户在锁屏上点掉了最后一件任务，锁屏组件（应用重新推送后）显示"还有 1 件"，
     而主屏组件显示"全部完成"。两边读的是同一份快照，差的就是这一层叠加。
     */
    func test_锁屏_意图的乐观叠加被算进去() {
        let content = ready(
            WidgetPayload(today: [task("t1", "交房租"), task("t2", "写周报")]),
            targets: ["t1": true, "t2": true]
        )
        let model = WidgetLockScreenModelBuilder.build(content)
        XCTAssertEqual(model.openCount, 0, "🔴 乐观叠加没算进去 → 与主屏不一致")
        XCTAssertTrue(model.isAllDone)
        XCTAssertNil(model.firstTitle)
    }

    func test_锁屏_乐观叠加可以反向取消完成() {
        let content = ready(
            WidgetPayload(today: [task("t1", "交房租", true)]),
            targets: ["t1": false]
        )
        let model = WidgetLockScreenModelBuilder.build(content)
        XCTAssertEqual(model.openCount, 1, "点回未完成也要立刻反映")
        XCTAssertEqual(model.firstTitle, "交房租")
    }

    func test_锁屏_隐藏标题与全部完成必须能区分() {
        let content = ready(WidgetPayload(today: [task("t1", "离婚协议书")]))

        let hidden = WidgetLockScreenModelBuilder.build(
            content, privacy: WidgetPrivacyPreference(alwaysHideTitles: true)
        )
        XCTAssertNil(hidden.firstTitle, "🔴 第 3 层生效：不读出标题")
        XCTAssertEqual(hidden.openCount, 1, "但计数还在 —— 计数不泄露内容")
        XCTAssertEqual(
            WidgetLockScreenModelBuilder.hiddenTitlePlaceholder(
                privacy: WidgetPrivacyPreference(alwaysHideTitles: true)
            ),
            "•••"
        )

        let shown = WidgetLockScreenModelBuilder.build(content)
        XCTAssertEqual(shown.firstTitle, "离婚协议书")
        XCTAssertNil(
            WidgetLockScreenModelBuilder.hiddenTitlePlaceholder(privacy: .default),
            "🔴 没开隐藏时占位符必须是 nil，否则视图会把「•••」画在真标题旁边"
        )
    }

    // ═════════════════════════════════════════════════════════════
    // W5-3 · 灵动岛的门槛
    // ═════════════════════════════════════════════════════════════

    func test_灵动岛_暂停时不启动() {
        // 🔴 暂停的 focus **没有** `endsAt`（暂停会把它往后推，留着就是过期时刻）。
        //    没有绝对锚点就**不能**起倒计时 —— 用 `remainingSeconds` 伪造一个
        //    就会得到"每次推送都往后跳"的倒计时。
        let paused = WidgetPayload(
            today: [],
            focus: WidgetFocus(
                active: true, remainingSeconds: 720, targetSeconds: 1_500,
                sessionTitle: "写周报", endsAt: nil
            )
        )
        XCTAssertNil(
            FocusActivityGate.content(from: ready(paused), now: NOW),
            "🔴 暂停中不能起灵动岛 —— 没有 endsAt 就没有正确的倒计时"
        )
    }

    func test_灵动岛_不活跃不启动() {
        let inactive = WidgetPayload(
            today: [],
            focus: WidgetFocus(
                active: false, remainingSeconds: 720, targetSeconds: 1_500,
                sessionTitle: "写周报", endsAt: NOW + 720_000
            )
        )
        XCTAssertNil(FocusActivityGate.content(from: ready(inactive), now: NOW))
    }

    /**
     🔴 **过期快照绝不允许启动** —— 用的是**昨天的** `endsAt`。
     用户会看到一段永远不会结束的倒计时。
     */
    func test_灵动岛_过期与不可信快照都不启动() {
        let payload = runningFocus(endsAt: NOW + 720_000)
        for state: WidgetState in [.stale, .placeholder] {
            let content = WidgetContent(
                state: state, dayStr: "2026-09-27",
                payload: state == .stale ? payload : nil, targets: [:]
            )
            XCTAssertNil(
                FocusActivityGate.content(from: content, now: NOW),
                "🔴 \(state) 下不启动 —— 按一个不可信的时刻倒计时比没有倒计时糟得多"
            )
        }
    }

    func test_灵动岛_已经结束不启动() {
        // 起一个"剩余 0"的倒计时：系统要么拒绝，要么显示成卡住的 0:00。两者都比不显示糟。
        XCTAssertNil(FocusActivityGate.content(from: ready(runningFocus(endsAt: NOW)), now: NOW))
        XCTAssertNil(FocusActivityGate.content(from: ready(runningFocus(endsAt: NOW - 1)), now: NOW))
    }

    func test_灵动岛_正在跑时内容与锚点正确() {
        let endsAt = NOW + 720_000
        let content = FocusActivityGate.content(from: ready(runningFocus(endsAt: endsAt)), now: NOW)
        XCTAssertEqual(content?.endsAt, endsAt)
        XCTAssertEqual(content?.targetSeconds, 1_500)
        XCTAssertEqual(content?.sessionTitle, "写周报")

        // 进度条起点由 `endsAt - targetSeconds` 反推。
        XCTAssertEqual(
            content.flatMap(FocusActivityGate.progressStart),
            endsAt - 1_500 * 1000
        )
    }

    func test_灵动岛_没有目标时长就不画进度条() {
        let c = FocusActivityGate.content(
            from: ready(runningFocus(endsAt: NOW + 720_000, target: nil)), now: NOW
        )
        XCTAssertNotNil(c, "没有目标时长仍然要起倒计时")
        XCTAssertNil(c.flatMap(FocusActivityGate.progressStart), "但没有进度条")

        // ⚠️ 非正的目标时长同样不画 —— `ProgressView(timerInterval:)` 拿到
        //    一个"起点在终点之后"的区间会画出反向的进度条。
        for bad: Double in [0, -1] {
            let z = FocusActivityGate.content(
                from: ready(runningFocus(endsAt: NOW + 720_000, target: bad)), now: NOW
            )
            XCTAssertNil(z.flatMap(FocusActivityGate.progressStart), "target=\(bad) 不该有进度条")
        }
    }

    func test_灵动岛_标题为空时也要能起() {
        // 用户常常不起标题。空串合法，不能因此不起灵动岛。
        let payload = WidgetPayload(
            today: [],
            focus: WidgetFocus(
                active: true, remainingSeconds: 60, targetSeconds: 1_500,
                sessionTitle: "", endsAt: NOW + 60_000
            )
        )
        let c = FocusActivityGate.content(from: ready(payload), now: NOW)
        XCTAssertEqual(c?.sessionTitle, "", "空标题合法 —— 视图层负责回落")
    }

    func test_灵动岛_倒计时永远由系统驱动() {
        // 🔴 这条断言看着像废话，但它钉住的是一个**架构决定**：
        //    一旦有人加了一个 `.appTimer` 之类的选项，"自己算"就会变成一个可选值，
        //    而它一旦被选中，扩展被挂起时倒计时就会停住不动。
        XCTAssertEqual(FocusActivityGate.countdownDriver, .systemTimer)
    }
}
