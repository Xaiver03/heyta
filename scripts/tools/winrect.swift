// winrect —— 取某个应用窗口在**全局屏幕坐标**里的矩形。
//
// 用法：  winrect <ownerName> [titlePrefix]
// 输出：  "x y w h"（恰好一个匹配时）；退出码 0
//         退出码 1 = 没匹配到；退出码 2 = 匹配到多个（歧义，全部打到 stderr）
//
// ── 为什么不用 `System Events`
//
// 原来的写法是 `osascript -e 'tell application "System Events" ... get position of every window'`。
// 它依赖**辅助功能（Accessibility）权限**。实测（2026-09-26）那个权限在会话中途丢失后，
// System Events 对**每一个**应用都返回 `count of windows = 0` —— 包括明明开着的 Chrome。
// 于是 `find_window` 报"期望恰好 1 个窗口，实际 0 个"，
// 看起来像"模拟器窗口没了"，实际是**探针的权限没了**（AGENTS §7 开头的"先怀疑探针"）。
//
// CGWindowListCopyWindowInfo 只要**屏幕录制**权限（截图已经在用，本来就有），
// 不需要辅助功能权限 —— 这条路更稳，而且报错更诚实。
//
// ⚠️ 顺序不可依赖：CGWindowList 的前后顺序**不是** z-order 的稳定表达，
//    所以这里要求"恰好一个匹配"，多个就报错退出，让人去把标题写具体。

import Cocoa

let args = CommandLine.arguments
guard args.count >= 2 else {
    FileHandle.standardError.write("用法: winrect <ownerName> [titlePrefix]\n".data(using: .utf8)!)
    exit(64)
}
let ownerWanted = args[1]
let titlePrefix = args.count >= 3 ? args[2] : nil

// 🔴 必须用 `.optionAll`，不能用 `.optionOnScreenOnly` ——
//    实测模拟器窗口在**另一个 Space** 上时，`.optionOnScreenOnly` 一个都不返回，
//    于是"窗口不存在"，而它明明在（`mac windows` 用 `.optionAll` 看得到）。
let raw = (CGWindowListCopyWindowInfo([.optionAll, .excludeDesktopElements], kCGNullWindowID)
        as? [[String: Any]]) ?? []
guard !raw.isEmpty else {
    FileHandle.standardError.write("拿不到窗口列表（CGWindowListCopyWindowInfo 返回空）\n".data(using: .utf8)!)
    exit(3)
}

struct Hit { let owner: String; let title: String; let x: Int; let y: Int; let w: Int; let h: Int
             let onscreen: Bool; let layer: Int }

var hits: [Hit] = []
for win in raw {
    let owner = (win[kCGWindowOwnerName as String] as? String) ?? ""
    let title = (win[kCGWindowName as String] as? String) ?? ""
    guard owner == ownerWanted else { continue }
    if let p = titlePrefix, !title.hasPrefix(p) { continue }
    guard let b = win[kCGWindowBounds as String] as? [String: Any],
          let x = (b["X"] as? NSNumber)?.intValue,
          let y = (b["Y"] as? NSNumber)?.intValue,
          let w = (b["Width"] as? NSNumber)?.intValue,
          let h = (b["Height"] as? NSNumber)?.intValue else { continue }
    // 跳过没有面积的占位窗口
    if w <= 0 || h <= 0 { continue }
    hits.append(Hit(owner: owner, title: title, x: x, y: y, w: w, h: h,
                    onscreen: (win[kCGWindowIsOnscreen as String] as? Bool) ?? false,
                    layer: (win[kCGWindowLayer as String] as? NSNumber)?.intValue ?? 0))
}

// 同一个逻辑窗口可能以多个 CGWindow 出现（有 on-screen 的也有 off-screen 的）。
// 优先取"当前 Space 上可见 + layer 0"的那个；都不满足再退回第一个。
if let preferred = hits.first(where: { $0.onscreen && $0.layer == 0 }) {
    hits = [preferred]
} else if let onscreen = hits.first(where: { $0.onscreen }) {
    hits = [onscreen]
}

if hits.isEmpty {
    FileHandle.standardError.write("没有 owner=\(ownerWanted) titlePrefix=\(titlePrefix ?? "(任意)") 的窗口\n".data(using: .utf8)!)
    exit(1)
}
if hits.count > 1 {
    var msg = "owner=\(ownerWanted) 匹配到 \(hits.count) 个窗口，标题请写具体：\n"
    for h in hits { msg += "  title=「\(h.title)」 \(h.x),\(h.y) \(h.w)x\(h.h)\n" }
    FileHandle.standardError.write(msg.data(using: .utf8)!)
    exit(2)
}
let h = hits[0]
print("\(h.x) \(h.y) \(h.w) \(h.h)")
