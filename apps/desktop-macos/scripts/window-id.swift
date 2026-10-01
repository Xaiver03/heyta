// 列出属于本进程之外、名字含 "Heyta" 的可见窗口，每行 `id<TAB>owner<TAB>title<TAB>WxH`。
//
//   swift apps/desktop-macos/scripts/window-id.swift
//
// 用途：`screencapture -l<windowID>` 需要窗口号，而 macOS 没给命令行工具去查它。
// `CGWindowListCopyWindowInfo` 是唯一的路，但它只有 C/Swift API，没有 shell 命令，
// 所以这里用一个十几行的 Swift 脚本补上。
//
// ⚠️ 这是**独立取证**用的：它拿到的图和原生壳自截屏不是同一条代码路径，
// 两者尺寸/内容对得上，才能说"自产证据可信"。

// 🔴 必须用 `.optionAll`，不能用 `.optionOnScreenOnly`（2026-09-30 实测）：
// 交叉验证的实例带 `HEYTA_NO_FOCUS=1` 后台启动，其窗口**不在"当前屏幕可见"集合**里，
// `.optionOnScreenOnly` 对它一个都不返回 ⇒ 本脚本输出空 ⇒ capture-window.sh 的
// 交叉验证被跳过（CROSSCHECK=skipped）⇒ 门禁红。这与
// `scripts/lib/mobile-e2e.sh` 的 `find_window`（winrect.swift）踩过并修过的是
// **同一个坑**（AGENTS §7 第 37 条）：AX / OnScreenOnly 都只看得见"当前 Space"，
// 而 `screencapture -l<id>` 本身对别的 Space 上的窗口照样能截。

import CoreGraphics
import Foundation

let options: CGWindowListOption = [.optionAll, .excludeDesktopElements]
guard let list = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else {
    exit(1)
}

// 🔴 **不要按属主名筛**（2026-09-30 实测）：裸 SwiftPM 可执行文件
//    （`.build/out/Products/Debug/HeytaMac`）被**别的进程树**启动时，
//    窗口服务器把 `kCGWindowOwnerName` 报成**启动它的那个应用**，而不是 "Heyta"。
//    本机实测（由 DSH 启动）：
//
//        owner=DSH Desktop  title=heyta  bounds=1120x720  onscreen=true
//
//    于是 `owner.contains("Heyta")` 会在**标题那道筛之前**把这个窗口丢掉 ⇒
//    脚本零输出 ⇒ `capture-window.sh` 的交叉验证被跳过（`CROSSCHECK=skipped`）
//    ⇒ `check:macos-window` **假红**。而标题**是可用的**（上面那行就是证据），
//    所以判据改成**只认标题**。
//
// ⚠️ 顺带纠正一条曾经的推断：过去把零输出归因于"没给屏幕录制权限"。
//    实测不是 —— 权限受限时 `kCGWindowName` 会是 nil，而这里拿得到 "heyta"。
//
// 🔴 可选参数 `--pid <pid>`（2026-10-01）：只列**属于该进程**的窗口。
//    动机是 §7 第 81.3 条的现场：机器上常驻一个**用户自己装的** Heyta.app
//    （标题同样是 "heyta"），只按标题筛时 `head -1` 会撞上它 ——
//    capture-window.sh 拿用户的窗口去跟取证实例的自截图比尺寸 ⇒ 必红，
//    而这台机器恰恰是产品负责人日常开着 heyta 的机器。调用方传入自己
//    起的那个实例的 PID，交叉验证就只认**自己的**窗口；不带参数时行为
//    与过去完全一致（其它调用方不受影响）。
var pidFilter: Int? = nil
if let idx = CommandLine.arguments.firstIndex(of: "--pid"), idx + 1 < CommandLine.arguments.count,
   let parsed = Int(CommandLine.arguments[idx + 1]) {
    pidFilter = parsed
}
for window in list {
    // 🔴 只认**主窗口**（标题 = "heyta"）：进程里还有别的窗口 ——
    // 实测还有 500x500、无标题的辅助窗口；`.optionAll` 之后它们也会被列出来，
    // `head -1` 拿到它再去 `screencapture -l` 会得到 1000x1000 的占位图
    // （2026-09-30 实测），尺寸比对必红。
    let title = window[kCGWindowName as String] as? String ?? ""
    guard title == "heyta" else { continue }
    if let pidFilter = pidFilter {
        let ownerPid = window[kCGWindowOwnerPID as String] as? Int ?? -1
        guard ownerPid == pidFilter else { continue }
    }
    let owner = window[kCGWindowOwnerName as String] as? String ?? ""
    let id = window[kCGWindowNumber as String] as? Int ?? 0
    let bounds = window[kCGWindowBounds as String] as? [String: Any] ?? [:]
    let width = bounds["Width"] ?? "?"
    let height = bounds["Height"] ?? "?"
    print("\(id)\t\(owner)\t\(title)\t\(width)x\(height)")
}
