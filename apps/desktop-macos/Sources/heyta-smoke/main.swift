// macOS 原生壳的**无头冒烟**：不开窗，只验"跨语言那一层 + 真的落盘"。
//
// 与 `apps/desktop-windows/smoke/Program.cs` 是**同一组断言**（同一份契约的两个宿主）。
// 断言是真的断言（失败即非零退出），不是打印给人看 —— 只打印的冒烟会在没人读输出时
// 悄悄变成"一直绿"。
//
// 用法：
//   swift run heyta-smoke
//   HEYTA_BRIDGE_BUNDLE=<path> swift run heyta-smoke
//
// 前置：先在仓库根跑 `node packages/app-host/scripts/build-native-bridge.mjs`。

import Foundation
import HeytaShellCore

var failures: [String] = []

/// ⚠️ Swift 6 的严格并发：`main.swift` 的顶层代码是 `@MainActor` 的，
/// 而顶层 `var` 也归 MainActor —— 所以这个函数必须一起标上，
/// 否则报「main actor-isolated var 'failures' can not be mutated from a nonisolated context」。
/// 冒烟本身就是单线程跑完的，标 MainActor 是它真实的语义。
@MainActor
func check(_ ok: Bool, _ what: String) {
    print("  \(ok ? "✅" : "❌") \(what)")
    if !ok { failures.append(what) }
}

/// bundle 默认位置：从**源文件路径**反推仓库根，而不是依赖当前工作目录。
let sourceURL = URL(fileURLWithPath: #filePath)
let packageRoot = sourceURL
    .deletingLastPathComponent()   // heyta-smoke/
    .deletingLastPathComponent()   // Sources/
    .deletingLastPathComponent()   // apps/desktop-macos/
let repoRoot = packageRoot
    .deletingLastPathComponent()   // apps/
    .deletingLastPathComponent()   // <repo>/
let defaultBundle = repoRoot.appendingPathComponent("packages/app-host/bridge-bundle/native-bridge.js")

let bundlePath = ProcessInfo.processInfo.environment["HEYTA_BRIDGE_BUNDLE"] ?? defaultBundle.path

guard FileManager.default.fileExists(atPath: bundlePath) else {
    FileHandle.standardError.write(Data("""
    ❌ 找不到 bundle：\(bundlePath)
       先跑：node packages/app-host/scripts/build-native-bridge.mjs

    """.utf8))
    exit(1)
}

let bundleAttributes = try? FileManager.default.attributesOfItem(atPath: bundlePath)
let bundleBytes = (bundleAttributes?[.size] as? Int) ?? 0
print("bundle：\(bundlePath)（\(bundleBytes) 字节）")

let workDir = FileManager.default.temporaryDirectory
    .appendingPathComponent("heyta-macos-smoke-\(UUID().uuidString)")
try? FileManager.default.createDirectory(at: workDir, withIntermediateDirectories: true)
let dbPath = workDir.appendingPathComponent("smoke.sqlite").path
print("db：\(dbPath)")
print("")

do {
    // ── 1. 打开：真的建库、真的拿到 clientId ──────────────────────────
    let api = try AppApi(bundlePath: bundlePath, dbPath: dbPath)
    let clientId = try api.open(dbPath)
    check(!clientId.isEmpty, "打开宿主并拿到 clientId（\(clientId.prefix(8))…）")

    // ── 2. 空库 ─────────────────────────────────────────────────────
    check(try api.listTasks().isEmpty, "新库列出来是空的")

    // ── 3. 新建 + 排序（排序在 TS 侧，这里只验结果）──────────────────
    let first = try api.addTask("第一条")
    let second = try api.addTask("第二条")
    check(first != second, "两条任务拿到不同的 id")

    var tasks = try api.listTasks()
    check(tasks.count == 2, "新建后列出 2 条")
    check(tasks.count == 2 && tasks[0].title == "第一条" && tasks[1].title == "第二条",
          "展示序：都未完成、都无截止 ⇒ 保持稳定序（与共享 sortTasksForDisplay 一致）")

    // ── 4. 完成态 ───────────────────────────────────────────────────
    try api.setTaskDone(first, true)
    tasks = try api.listTasks()
    check(tasks.filter(\.done).count == 1, "只有一条被标成完成")
    check(tasks.first(where: { $0.id == first })?.done == true, "被标完成的是第一条")
    check(tasks.first(where: { $0.id == first })?.completedAt != nil, "完成时间真的写进去了")

    // 🔴 G5：完成之后顺序**必须变** —— 已完成沉到最后。
    // 这一条是**能失败**的：把门面改回按 (createdAt, id) 排，
    // `first` 会重新排到最前，于是这里立刻红。
    // ⚠️ 上面第 3 步那条**抓不到**这个回归 —— 那时两条都未完成，
    // 两种规则给出同一个顺序（这正是它当时看不出问题的原因）。
    check(tasks.count == 2 && tasks[0].title == "第二条" && tasks[1].title == "第一条",
          "已完成沉到最后 —— 与共享 sortTasksForDisplay 一致")

    // ── 5. 错误必须能过边界（而不是静默）───────────────────────────
    var emptyTitleRejected = false
    do { _ = try api.addTask("") } catch { emptyTitleRejected = true }
    check(emptyTitleRejected, "空标题被拒（TaskActions 的既定语义，跨语言之后仍然成立）")

    api.shutdown()
}

// ── 6. 重开：真的落盘了（换一个宿主读同一个文件）────────────────────
do {
    let reopened = try AppApi(bundlePath: bundlePath, dbPath: dbPath)
    _ = try reopened.open(dbPath)
    var tasks = try reopened.listTasks()
    check(tasks.count == 2, "重开后仍然是 2 条（数据真的落盘）")
    check(tasks.filter(\.done).count == 1, "重开后完成态还在")

    // ── 7. 软删除 ───────────────────────────────────────────────────
    try reopened.removeTask(tasks[0].id)
    tasks = try reopened.listTasks()
    check(tasks.count == 1, "软删除后只剩 1 条")

    reopened.shutdown()
}

// ── 8. 驱动错误必须能过边界（信封那条路）────────────────────────────
//    JSC 不能把 native 异常交给 JS，所以 macOS 侧用**信封**（见 SqliteBridge.swift）。
//    这里直接问驱动要一次错误，确认它**返回信封**而不是抛异常/静默成功。
do {
    let driver = try SqliteBridge(path: ":memory:")
    let envelope = driver.exec("THIS IS NOT VALID SQL")
    check(envelope.contains("__heytaDriverError"),
          "驱动出错时返回信封（而不是抛异常或静默成功）")
    check(driver.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)").isEmpty,
          "正常 SQL 返回空字符串（信封只在出错时出现）")
    driver.close()
}

// ── 9. 页侧存储宿主（B）：op-log 经宿主边界落到**壳自己的 SQLite** ──
//
// 与 Windows 的 smoke（Program.cs 第 8 节）**逐条同构**。这一段验的是
// B 的 macOS 壳侧：页侧把 op-log 请求发过来，壳用**同一份** `DbOpLogStore`
// （`packages/storage`）跑在 **libsqlite3** 上，并把响应发回去。
//
// 🔴 判据刻意选"**从 Swift 独立读那个 .sqlite 文件**"：界面说"已保存"不算证据。
// ⚠️ 用**另一个库文件**：`openOpLog` 只建 store、**不建引擎**（引擎归页侧）。

/// 发一条请求，返回 `(ok, value)`。请求串由 Swift 侧序列化，避免手写 JSON 转义出错。
func opRequest(_ api: AppApi, _ id: Int, _ method: String, _ argsJson: String) throws -> (Bool, Any?, String) {
    let envelope: [String: Any] = ["id": id, "method": method, "args": try JSONSerialization.jsonObject(with: Data(argsJson.utf8))]
    let message = String(data: try JSONSerialization.data(withJSONObject: envelope), encoding: .utf8)!
    guard let first = try api.handleHostMessage(message).first,
          let data = first.data(using: .utf8),
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        return (false, nil, "<不是合法 JSON 响应>")
    }
    return (obj["ok"] as? Bool ?? false, obj["value"], first)
}

do {
    let opLogDb = workDir.appendingPathComponent("oplog.sqlite").path
    let opApi = try AppApi(bundlePath: bundlePath, dbPath: opLogDb)
    let opClientId = try opApi.openOpLog()
    check(!opClientId.isEmpty, "openOpLog 拿到库里给出的 clientId（\(opClientId.prefix(8))…）")

    // 交握：页侧发 `oplog-hello` 催 ready，壳回一条 ready（clientId 必须与库里那个逐字相同）。
    let helloOut = try opApi.handleHostMessage("{\"type\":\"oplog-hello\"}")
    check(helloOut.count == 1, "oplog-hello ⇒ 壳回且只回一条消息")
    if let first = helloOut.first,
       let data = first.data(using: .utf8),
       let ready = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
        check(ready["type"] as? String == "ready", "那条消息是 ready 交握")
        check(ready["clientId"] as? String == opClientId, "ready 里的 clientId 与库里那个**逐字相同**")
    } else {
        check(false, "ready 消息不是合法 JSON")
    }

    let (emptyOk, emptyValue, _) = try opRequest(opApi, 1, "getAllOps", "[]")
    check(emptyOk && (emptyValue as? [Any])?.isEmpty == true, "空库经宿主边界 getAllOps ⇒ ok 且 0 条")

    // ⚠️ 中文 + 需要转义的字符都放进去：宿主边界是**字符串**，
    //    编码错一层的症状是"某些标题变成乱码"，而不是报错。
    let op: [String: Any] = [
        "id": "op-from-page-1",
        "entityType": "TASK",
        "entityId": "task-1",
        "opType": "CRT",
        "payload": ["title": "穿过宿主边界 \"quoted\" ✓"],
        "clientId": opClientId,
        "timestamp": 1,
        "vectorClock": [opClientId: 1],
        "schemaVersion": 1,
    ]
    // 🔴 `args` 是**位置参数表** —— `appendLocal(ops:)` 收的是 ops 数组，
    //    所以这里要套两层：外层是"第 0 个参数"，内层才是那个数组。
    //    少一层就会把**单个 op 对象**当数组用，症状是 `is not iterable`
    //    （第一版就是这么错的，而这个断言当场把它抓出来了）。
    let args = String(data: try JSONSerialization.data(withJSONObject: [[op]]), encoding: .utf8)!
    let (appendOk, appendValue, appendRaw) = try opRequest(opApi, 2, "appendLocal", args)
    check(appendOk && (appendValue as? [Any])?.count == 1 && (appendValue as? [Any])?.first as? Int == 1,
          "appendLocal 经宿主边界 ⇒ 返回 seq [1]（实测响应：\(appendRaw.prefix(300))）")

    let (readOk, readValue, _) = try opRequest(opApi, 3, "getAllOps", "[]")
    let readRows = readValue as? [[String: Any]]
    let readId = ((readRows?.first?["op"]) as? [String: Any])?["id"] as? String
    check(readOk && readRows?.count == 1 && readId == "op-from-page-1",
          "再经宿主边界 getAllOps ⇒ 正是刚写的那条（读回来的形状没被边界改坏）")

    // 🔴 独立读库：**不经过 TS 栈**，直接问那个 SQLite 文件。
    let raw = try SqliteBridge(path: opLogDb)
    let rowsJson = raw.all("select count(*) as n from ops", "[]")
    if let data = rowsJson.data(using: .utf8),
       let rows = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]],
       let n = rows.first?["n"] as? Int {
        check(n >= 1, "Swift 独立读壳的 .sqlite ⇒ ops 表里有 \(n) 行（数据真的在壳的库里）")
    } else {
        check(false, "独立读库拿不到行数：\(rowsJson)")
    }
    raw.close()
    opApi.shutdown()

    // ⚠️ 如实记边界：`markUploaded` 的 `ReadonlyMap` 过不了**裸 JSON**，必须有线码。
    //    那一格由 `packages/storage/tests/contract.spec.ts` 的「宿主边界」契约项担保。
}

// ── 10. 桌面壳反向授权：回调解析 + state 校验（ADR-0039 §2.3）────────
//
// 这一段验的是**纯函数**：把回调 URL 变成"接受还是拒绝"。它是安全边界 ——
// 壳靠 `state` 判断"这个回调是不是我这次发起的那一个"，不校验就等于
// 允许任意网页把令牌塞进壳。
do {
    let expected = "state-from-shell"
    let good = URL(string: "heyta://auth#token=jwt-abc&state=\(expected)")!
    switch ShellAuth.parseCallback(good, expectedState: expected) {
    case let .ok(token, state, _):
        check(token == "jwt-abc" && state == expected, "合法回调 ⇒ 接受，并带回令牌与 state")
    case let .rejected(reason):
        check(false, "合法回调被拒了：\(reason)")
    }

    // 🔴 **state 不一致必须拒**（这就是那一格安全边界）。
    let wrongState = URL(string: "heyta://auth#token=jwt-abc&state=someone-else")!
    if case let .rejected(reason) = ShellAuth.parseCallback(wrongState, expectedState: expected) {
        check(reason.contains("state"), "state 不一致 ⇒ 拒绝（\(reason.prefix(24))…）")
    } else {
        check(false, "state 不一致竟然被接受了 —— 安全边界失效")
    }

    // 🔴 **令牌出现在 query 里必须拒**：那条通道会进 Referer 与访问日志。
    let inQuery = URL(string: "heyta://auth?token=jwt-abc&state=\(expected)")!
    if case .rejected = ShellAuth.parseCallback(inQuery, expectedState: expected) {
        check(true, "令牌在 query 里 ⇒ 拒绝（只认 fragment）")
    } else {
        check(false, "query 里的令牌竟然被接受了 —— 那个通道会漏")
    }

    let otherScheme = URL(string: "https://evil.example/#token=jwt-abc&state=\(expected)")!
    if case .rejected = ShellAuth.parseCallback(otherScheme, expectedState: expected) {
        check(true, "别的 scheme ⇒ 拒绝")
    } else {
        check(false, "别的 scheme 竟然被接受了")
    }

    check(ShellAuth.makeState().count == 64, "state 是 32 字节随机数的十六进制（64 字符）")
    let url = ShellAuth.authorizationURL(site: "https://heyta.example", state: "s1")
    check(
        url?.absoluteString == "https://heyta.example?auth=desktop&state=s1",
        "授权起点 URL 形状正确（\(url?.absoluteString ?? "nil")）",
    )
}

// ── 11. 移除库文件本体（`packages/storage` 契约里原生桥缺的那一格）──────
//
// 契约 = `packages/storage/src/sqlite/sqlite-driver.ts` 的 `removeDatabase?()`
// 与它的消费方 `sqlite-adapter.ts:278-287`。三条各答一个**只有它能答**的问题：
//
//   a) 直接打桥：旁挂文件真的被带走。⚠️ `close()` 之后 SQLite 通常已自己收走
//      `-wal`/`-shm`，所以这里**手动留下两个孤儿旁挂**（进程崩溃后的真实形状）——
//      不留的话这一条只验到主文件，而"只删主文件会留下一份能重放回明文的日志"
//      正是契约点名的那件事。
//   b) 经**整条 JS 栈**（页侧那一发 `oplog-destroy`）：只有 JSExport 真把
//      `removeDatabase` 暴露成了函数，`native-bridge.ts:172` 才会挂上那个键，
//      `SqliteAdapter.destroy()` 才不会回"这个驱动没有 removeDatabase"。
//      直接打桥证明不了这一格 —— Swift 里对象一直在、方法也一直在，
//      "键有没有跨边界暴露出去"只有 JS 侧知道。
//   c) 负臂：删不掉时必须是 `containerRemoved:false` + ASCII 原因，
//      而**不是**错误信封 —— 信封会被 `throwIfDriverError` 拆成 `throw`，
//      整个销毁随之失败、其余几类明文一类都不清。
//      ⚠️ 负臂**只能**直接打桥，走不了 `oplog-destroy`：`destroy()` 在移除之前要跑
//      `DROP TABLE` + `VACUUM`，而 `VACUUM` 必须在库文件旁边建临时库 ⇒
//      **不可写的目录里那些 SQL 本身就失败**，根本走不到 `removeDatabase`。

/// 解一条移除凭据；解不开就当场判红（而不是返回一个假的 `false` 蒙过去）。
/// ⚠️ 必须标 `@MainActor`：它调 `check`，而顶层 `var failures` 归 MainActor（见文件头）。
@MainActor
func removalOf(_ text: String, _ site: String) -> (target: String, removed: Bool, reason: String?)? {
    // 🔴 先问这一条：普通"删不掉"绝不能长成信封 —— 那个键在 JS 侧被拆成 `throw`，
    // 整个 destroy() 会失败、其余几类明文一类都不清。它必须在**任何**返回值上都成立。
    check(!text.contains("__heytaDriverError"),
          "\(site)：回的是凭据而不是驱动错误信封（\(text.prefix(160))）")
    guard let data = text.data(using: .utf8),
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let target = obj["target"] as? String,
          let removed = obj["containerRemoved"] as? Bool else {
        check(false, "\(site)：移除凭据解不开（实测返回 \(text.prefix(220))）")
        return nil
    }
    return (target, removed, obj["reason"] as? String)
}

let orphanSidecar = Data("orphaned WAL bytes that must not survive erase".utf8)

// ── a. 直接打桥：主文件 + 两个旁挂 + 幂等 ────────────────────────────
do {
    let dir = workDir.appendingPathComponent("removal")
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let db = dir.appendingPathComponent("gone.sqlite").path

    let bridge = try SqliteBridge(path: db)
    _ = bridge.exec("CREATE TABLE ops (id TEXT PRIMARY KEY)")
    _ = bridge.run("INSERT INTO ops (id) VALUES (?)", "[\"op-1\"]")
    bridge.close()

    _ = FileManager.default.createFile(atPath: db + "-wal", contents: orphanSidecar)
    _ = FileManager.default.createFile(atPath: db + "-shm", contents: orphanSidecar)
    check(FileManager.default.fileExists(atPath: db + "-wal")
          && FileManager.default.fileExists(atPath: db + "-shm"),
          "a 的前提成立：close() 之后**确实**还留着孤儿旁挂（否则这一条只验到主文件）")

    if let removal = removalOf(bridge.removeDatabase(), "a 直接打桥") {
        check(removal.removed, "a containerRemoved 为 true")
        check(removal.target == db, "a target 逐字等于真实库路径（判据读的就是这个字段）")
    }
    check(!FileManager.default.fileExists(atPath: db)
          && !FileManager.default.fileExists(atPath: db + "-wal")
          && !FileManager.default.fileExists(atPath: db + "-shm"),
          "a 主文件与两个旁挂**都**从磁盘上没了")

    // 契约明写"文件本来就不存在 = 成功（幂等），不是错误"。
    if let again = removalOf(bridge.removeDatabase(), "a 幂等那一趟") {
        check(again.removed, "a 再删一次仍是成功（幂等，不是\"没找到文件\"的失败）")
    }
}

// ── a2. 没 close 就调用：实现**不假设**调用方记得契约里那条"必须在 close() 之后" ──
//
// 🔴 这一条抓的是"目录项没了但数据还活着"：句柄没关时 SQLite 仍握着那个 inode，
// POSIX 上 unlink 照样成功 ⇒ 只查"文件在不在"**永远查不出来**。
// 所以判据必须是"同一句柄之后再也写不进东西"—— 那才等于"真的先关了再删"。
do {
    let dir = workDir.appendingPathComponent("removal-open")
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let db = dir.appendingPathComponent("still-open.sqlite").path

    let bridge = try SqliteBridge(path: db)
    _ = bridge.exec("CREATE TABLE t (v TEXT)")
    check(FileManager.default.fileExists(atPath: db + "-wal"),
          "a2 的前提成立：WAL 旁挂此刻**就在磁盘上**（句柄还开着）")

    if let removal = removalOf(bridge.removeDatabase(), "a2 未 close 就移除") {
        check(removal.removed, "a2 containerRemoved 为 true")
    }
    check(!FileManager.default.fileExists(atPath: db)
          && !FileManager.default.fileExists(atPath: db + "-wal")
          && !FileManager.default.fileExists(atPath: db + "-shm"),
          "a2 主文件与旁挂都不在磁盘上了（句柄还开着也照样删）")

    // 🔴 关键那一问：移除之后同一句柄**必须已经关闭**。
    // 没关 → 这条 INSERT 会打到"已经没有目录项、但 inode 还被握着"的文件上，
    // SQLite 报的是 `disk I/O error` —— 那是**另一种**失败，不能拿来冒充"已关闭"
    // （变异实测：拿掉 `removeDatabase()` 里那句 `close()`，两种说法都会让
    //  "返回信封"这一条过 ⇒ 判据必须钉**哪一个**信封）。
    let after = bridge.exec("INSERT INTO t (v) VALUES ('x')")
    check(after.contains("database is closed"),
          "a2 移除后同一句柄已关：回的是 closedHandleMessage 而不是静默成功/别的错误（实测：\(after.prefix(120))）")
}

// ── b. 经页侧那一发 oplog-destroy：跨 JSContext 边界可见 ──────────────
do {
    let dir = workDir.appendingPathComponent("js-destroy")
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let db = dir.appendingPathComponent("oplog.sqlite").path

    let api = try AppApi(bundlePath: bundlePath, dbPath: db)
    let clientId = try api.openOpLog()
    let op: [String: Any] = [
        "id": "op-erase-1", "entityType": "TASK", "entityId": "task-1", "opType": "CRT",
        "payload": ["title": "要被销毁的一条"], "clientId": clientId,
        "timestamp": 1, "vectorClock": [clientId: 1], "schemaVersion": 1,
    ]
    // ⚠️ `args` 是位置参数表，套两层（同第 9 节那条踩过的坑）。
    let args = String(data: try JSONSerialization.data(withJSONObject: [[op]]), encoding: .utf8)!
    let (appended, _, _) = try opRequest(api, 1, "appendLocal", args)
    check(appended, "b 的前提成立：库里先有一条真的 op（销毁之后才谈\"没了\"）")
    check(FileManager.default.fileExists(atPath: db), "b 的前提成立：壳的库文件此刻还在磁盘上")

    let outbound = try api.handleHostMessage("{\"type\":\"oplog-destroy\"}")
    let raw = outbound.first
    let envelope: [String: Any]? = raw
        .flatMap { $0.data(using: .utf8) }
        .flatMap { ((try? JSONSerialization.jsonObject(with: $0)) as? [String: Any]) }
    check(envelope?["type"] as? String == "oplog-destroyed",
          "b 那一发回的是 oplog-destroyed（实测：\((raw ?? "<无回包>").prefix(220))）")
    let report = envelope?["report"] as? [String: Any]
    // 🔴 `containerRemoved` 为 true **且** `target` 是真实路径，才同时说明三件事：
    // JSExport 把方法暴露成了函数、`wrapDriver` 挂上了键、适配器真的调了它。
    // 少任何一件，适配器回的是 `{target:"sqlite", containerRemoved:false, reason:"…没有 removeDatabase"}`。
    check(report?["containerRemoved"] as? Bool == true,
          "b 适配器报告 containerRemoved:true（实测：\((raw ?? "nil").prefix(240))）")
    check(report?["target"] as? String == db, "b 报告里的 target 就是壳的那个库文件")
    check(report?["storesCleared"] as? Int != nil, "b 报告带数字 storesCleared（页侧 isDestroyReport 要的第三项）")
    check(!FileManager.default.fileExists(atPath: db)
          && !FileManager.default.fileExists(atPath: db + "-wal")
          && !FileManager.default.fileExists(atPath: db + "-shm"),
          "b 销毁之后从**壳外**看：库文件与旁挂都不在磁盘上了")
    api.shutdown()
}

// ── c. 负臂：删不掉时要回凭据，不是异常、不是信封 ─────────────────────
do {
    let dir = workDir.appendingPathComponent("locked")
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let db = dir.appendingPathComponent("stuck.sqlite").path

    let bridge = try SqliteBridge(path: db)
    _ = bridge.exec("CREATE TABLE t (v TEXT)")
    _ = bridge.run("INSERT INTO t (v) VALUES (?)", "[\"plaintext-left-on-disk\"]")
    bridge.close()

    if geteuid() == 0 {
        // 如实报**未验**，不降级成"这档也算过了"：root 下权限位根本不挡 unlink。
        print("  ⚠️ c 负臂**未验**：以 root 运行时不可写目录挡不住 unlink，这一档构造不出失败")
    } else {
        check(chmod(dir.path, mode_t(0o500)) == 0, "c 的前提成立：库所在目录改成不可写（0500）")
        let text = bridge.removeDatabase()
        if let removal = removalOf(text, "c 负臂") {
            check(!removal.removed, "c 删不掉时如实回 containerRemoved:false")
            check(removal.target == db, "c 失败时 target 仍是真实路径（账面要指得到那个文件）")
            let reason = removal.reason ?? ""
            check(!reason.isEmpty, "c 带着原因：\(reason)")
            check(reason.unicodeScalars.allSatisfy { $0.value < 0x80 },
                  "c 原因是 ASCII（它会进证据文件）：\(reason)")
        }
        check(FileManager.default.fileExists(atPath: db), "c 文件**确实还在**磁盘上（判据不是自证的）")
        check(chmod(dir.path, mode_t(0o700)) == 0, "c 恢复目录权限位")
        if let freed = removalOf(bridge.removeDatabase(), "c 恢复之后那一趟") {
            check(freed.removed, "c 目录恢复后同一个实例再删就成功了（一次失败没被永久锁住）")
        }
    }
}

try? FileManager.default.removeItem(at: workDir)

print("")
if failures.isEmpty {
    print("✅ 跨语言那一层 + 落盘 全部通过。")
    exit(0)
}
FileHandle.standardError.write(Data("❌ 冒烟失败 \(failures.count) 条：\n".utf8))
for failure in failures {
    FileHandle.standardError.write(Data("   · \(failure)\n".utf8))
}
exit(1)
