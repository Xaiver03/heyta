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

for window in list {
    let owner = window[kCGWindowOwnerName as String] as? String ?? ""
    guard owner.contains("Heyta") else { continue }
    // 🔴 只认**主窗口**（标题 = "heyta"）：进程里还有别的窗口 ——
    // 实测还有 500x500、无标题的辅助窗口；`.optionAll` 之后它们也会被列出来，
    // `head -1` 拿到它再去 `screencapture -l` 会得到 1000x1000 的占位图
    // （2026-09-30 实测），尺寸比对必红。
    let title = window[kCGWindowName as String] as? String ?? ""
    guard title == "heyta" else { continue }
    let id = window[kCGWindowNumber as String] as? Int ?? 0
    let bounds = window[kCGWindowBounds as String] as? [String: Any] ?? [:]
    let width = bounds["Width"] ?? "?"
    let height = bounds["Height"] ?? "?"
    print("\(id)\t\(owner)\t\(title)\t\(width)x\(height)")
}
