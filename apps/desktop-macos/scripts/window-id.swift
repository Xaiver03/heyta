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

import CoreGraphics
import Foundation

let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
guard let list = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else {
    exit(1)
}

for window in list {
    let owner = window[kCGWindowOwnerName as String] as? String ?? ""
    guard owner.contains("Heyta") else { continue }
    let id = window[kCGWindowNumber as String] as? Int ?? 0
    let title = window[kCGWindowName as String] as? String ?? ""
    let bounds = window[kCGWindowBounds as String] as? [String: Any] ?? [:]
    let width = bounds["Width"] ?? "?"
    let height = bounds["Height"] ?? "?"
    print("\(id)\t\(owner)\t\(title)\t\(width)x\(height)")
}
