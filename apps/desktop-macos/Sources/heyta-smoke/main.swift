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
          "按 (createdAt, id) 升序 —— 与 TaskActions 文档一致")

    // ── 4. 完成态 ───────────────────────────────────────────────────
    try api.setTaskDone(first, true)
    tasks = try api.listTasks()
    check(tasks.filter(\.done).count == 1, "只有一条被标成完成")
    check(tasks.first(where: { $0.id == first })?.done == true, "被标完成的是第一条")
    check(tasks.first(where: { $0.id == first })?.completedAt != nil, "完成时间真的写进去了")

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
