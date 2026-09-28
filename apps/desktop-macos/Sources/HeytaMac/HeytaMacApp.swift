// macOS 原生壳的**窗口**（SwiftUI）。
//
// ⚠️ 这个文件不负责 UI 的适配与统一 —— 那是另一条线在做。
//    它只做三件事：把窗口搭起来、把事件转成 AppApi 调用、把错误显示出来。
//    **一行业务规则都不许写在这里**（排序/完成态/派生视图都在 TS 那一侧）。

import AppKit
import HeytaShellCore
import ScreenCaptureKit
import SwiftUI

@main
struct HeytaMacApp: App {
    @NSApplicationDelegateAdaptor(ActivationDelegate.self) private var delegate

    var body: some Scene {
        Window("heyta", id: "main") {
            ShellView()
        }
        .defaultSize(width: 900, height: 560)
    }
}

/// 从命令行（`swift run HeytaMac`）启动时，进程默认不是"常规 App"：
/// 没有 Dock 图标、窗口也不会到前台 —— 于是看起来像"没起来"。
/// 显式设成 `.regular` 并激活，这样它才是一个正常的 macOS 窗口。
final class ActivationDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
        SelfCapture.scheduleIfRequested()
    }
}

/// 自截屏：`HEYTA_SELF_CAPTURE=<png 路径>` 时，窗口起来几秒后把**自己那个窗口**
/// 渲染成 PNG 再退出。
///
/// ── 取图方式：**ScreenCaptureKit**（macOS 14+）────────────────────────────
///
/// 先说清楚**试错过什么**，免得下一个人重走：
///
/// | 方式 | 实测结果 |
/// |---|---|
/// | `view.cacheDisplay(in:to:)` | 走 AppKit `draw(_:)`；现代 SwiftUI 的文字走 **`CGDisplayList`** 私有路径，**拿不到** ⇒ 文字糊成横向色带（三次运行字节完全相同 = 确定性） |
/// | `CALayer.render(in:)` | 走图层树也拿不到 `CGDisplayList`，且是**左下原点** ⇒ 既糊又上下翻转 |
/// | `ImageRenderer` | SwiftUI 官方快照，但**渲染不了 `List` / `TextField` / `Toggle`** ⇒ 整片变成"禁止"占位符 |
/// | `CGWindowListCreateImage` | ✅ 能用，与 `screencapture -l` 同源；但 **macOS 14 起已废弃** |
/// | **`SCScreenshotManager`**（本文件用的） | ✅ 官方现在的路，同样拿窗口服务器合成结果 |
///
/// 🔴 前两种最坏的地方是**看起来很可信**：尺寸对、内容比例 ~96%、色阶 255，
/// 空白检测完全通过 —— 只有人眼能发现字全是坏的。
///
/// ⚠️ 需要屏幕录制权限。拿不到权限时 `SCScreenshotManager` 会抛错，
/// 这里**显式失败**（退出码 4），绝不写一张"看起来成功但其实是空的"图。
///
/// 它在 Windows 侧的对应物是 `heyta-win-capture.ps1`（那边只能从外面截）。
enum SelfCapture {
    /// 取图方式。写进 `.txt` 供取证时核对 —— 证据必须自述它是怎么来的。
    enum Method: String {
        /// ScreenCaptureKit 的 `SCScreenshotManager`：窗口服务器合成结果
        case screenCaptureKit = "screencapturekit"
    }

    static func scheduleIfRequested() {
        guard let path = ProcessInfo.processInfo.environment["HEYTA_SELF_CAPTURE"] else { return }
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(3))
            guard let window = NSApp.windows.first(where: { $0.isVisible }),
                  let view = window.contentView else {
                FileHandle.standardError.write(Data("没有可见窗口\n".utf8))
                exit(2)
            }

            // 先把待渲染的内容推进图层，否则可能截到尚未提交的一帧
            view.layoutSubtreeIfNeeded()
            view.displayIfNeeded()

            let bounds = view.bounds
            guard let (method, data) = await capture(window: window, bounds: bounds) else {
                FileHandle.standardError.write(Data("截图失败（多半是没给屏幕录制权限）\n".utf8))
                exit(4)
            }
            try? data.write(to: URL(fileURLWithPath: path))
            let info = """
            WINDOW_SIZE=\(Int(bounds.width))x\(Int(bounds.height))
            WINDOW_TITLE=\(window.title)
            PNG_BYTES=\(data.count)
            CAPTURE_METHOD=\(method.rawValue)
            """
            try? info.write(toFile: path + ".txt", atomically: true, encoding: .utf8)
            print(info)
            exit(0)
        }
    }

    @MainActor
    private static func capture(window: NSWindow, bounds: CGRect) async -> (Method, Data)? {
        do {
            let image = try await screenshot(window: window, bounds: bounds)
            // 窗口截图**必然带 alpha**（圆角与投影）。留着会让 PNG 在别的查看器里
            // 出现黑边，也不便于逐字节比对。按窗口自身外观合成到不透明底上。
            let isDark = window.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            let background = (isDark ? NSColor.black : NSColor.white).usingColorSpace(.deviceRGB) ?? .black
            guard let opaque = flatten(image, background: background) else { return nil }
            let rep = NSBitmapImageRep(cgImage: opaque)
            guard let data = rep.representation(using: .png, properties: [:]) else { return nil }
            return (.screenCaptureKit, data)
        } catch {
            FileHandle.standardError.write(Data("ScreenCaptureKit 报错：\(error)\n".utf8))
            return nil
        }
    }

    /// 用 `SCScreenshotManager` 取这个窗口的合成结果。
    @MainActor
    private static func screenshot(window: NSWindow, bounds: CGRect) async throws -> CGImage {
        let windowID = CGWindowID(window.windowNumber)

        // 🔴 必须**轮询**：`onScreenWindowsOnly: true` 只列"已经在屏上"的窗口，
        //    而刚 launch 的进程里窗口可能还没登记进窗口服务器 ——
        //    实测直接在 3 秒后查一次会报 "SCShareableContent 里没有窗口"，
        //    同一个二进制手动跑却偶尔能过（竞态）。
        //    先按"仅屏上"轮询 8 秒，再退回"含离屏"。
        var target: SCWindow?
        for attempt in 0..<16 {
            let onScreenOnly = attempt < 12
            if let content = try? await SCShareableContent.excludingDesktopWindows(
                false,
                onScreenWindowsOnly: onScreenOnly
            ), let found = content.windows.first(where: { $0.windowID == windowID }) {
                target = found
                break
            }
            try? await Task.sleep(for: .milliseconds(500))
        }
        guard let target else {
            throw NSError(
                domain: "heyta.capture", code: 1,
                userInfo: [NSLocalizedDescriptionKey: "等了 8 秒，SCShareableContent 里始终没有窗口 \(windowID)"]
            )
        }

        let filter = SCContentFilter(desktopIndependentWindow: target)
        let config = SCStreamConfiguration()
        let scale = window.backingScaleFactor
        config.width = Int((bounds.width * scale).rounded())
        config.height = Int((bounds.height * scale).rounded())
        config.showsCursor = false
        // 不含投影：我们要的是"窗口本身长什么样"，不是它在桌面上投下的影子
        config.ignoreShadowsSingleWindow = true
        config.captureResolution = .best

        return try await SCScreenshotManager.captureImage(
            contentFilter: filter,
            configuration: config
        )
    }

    /// 把带 alpha 的窗口图合成到不透明底上。
    @MainActor
    private static func flatten(_ image: CGImage, background: NSColor) -> CGImage? {
        guard let context = CGContext(
            data: nil,
            width: image.width,
            height: image.height,
            bitsPerComponent: 8,
            bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue
        ) else { return nil }
        let full = CGRect(x: 0, y: 0, width: image.width, height: image.height)
        context.setFillColor(background.cgColor)
        context.fill(full)
        context.draw(image, in: full)
        return context.makeImage()
    }
}

struct ShellView: View {
    @State private var tasks: [TaskView] = []
    @State private var newTitle = ""
    @State private var status = ""
    @State private var footer = ""
    @State private var api: AppApi?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text("heyta").font(.system(size: 28, weight: .semibold))
                Text("macOS 原生壳 · 界面是 SwiftUI，逻辑与存储是与 web / mobile 同一份 TS")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }

            HStack(spacing: 8) {
                TextField("写点什么，回车添加", text: $newTitle)
                    .textFieldStyle(.roundedBorder)
                    .frame(width: 360)
                    .onSubmit(addTask)
                Button("添加", action: addTask)
                    .buttonStyle(.borderedProminent)
                    .disabled(api == nil)
            }

            if !status.isEmpty {
                Text(status).font(.callout).foregroundStyle(.secondary)
            }

            List(tasks) { task in
                HStack(spacing: 10) {
                    Toggle("", isOn: Binding(
                        get: { task.done },
                        set: { setDone(task, $0) }
                    ))
                    .labelsHidden()
                    .toggleStyle(.checkbox)

                    Text(task.title)
                    Spacer()
                    Button("删除") { remove(task) }.buttonStyle(.borderless)
                }
            }

            if !footer.isEmpty {
                Text(footer).font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(24)
        .frame(minWidth: 720, minHeight: 480, alignment: .topLeading)
        .task { initialize() }
    }

    /// 初始化。**失败必须显示出来** —— 一个空白窗口是这类壳最难排查的失败形态。
    private func initialize() {
        do {
            let bundle = try Self.bundlePath()
            let dbPath = try Self.databasePath()
            let opened = try AppApi(bundlePath: bundle, dbPath: dbPath)
            let clientId = try opened.open(dbPath)
            api = opened
            footer = "库：\(dbPath)　设备：\(clientId)"
            refresh()
            } catch {
            status = "初始化失败：\(error)"
        }
    }

    private func refresh() {
        guard let api else { return }
        do {
            tasks = try api.listTasks()
            status = tasks.isEmpty ? "还没有任务。上面写一条试试。" : ""
        } catch {
            status = "读取失败：\(error)"
        }
    }

    private func addTask() {
        guard let api, !newTitle.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        do {
            _ = try api.addTask(newTitle)
            newTitle = ""
            refresh()
        } catch {
            status = "添加失败：\(error)"
        }
    }

    private func setDone(_ task: TaskView, _ done: Bool) {
        guard let api else { return }
        do {
            try api.setTaskDone(task.id, done)
            refresh()
        } catch {
            status = "更新失败：\(error)"
            refresh()
        }
    }

    private func remove(_ task: TaskView) {
        guard let api else { return }
        do {
            try api.removeTask(task.id)
            refresh()
        } catch {
            status = "删除失败：\(error)"
        }
    }

    // ── 路径：从**源文件路径**反推仓库根，不依赖当前工作目录 ──────────────

    private static func repoRoot() -> URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()   // HeytaMac/
            .deletingLastPathComponent()   // Sources/
            .deletingLastPathComponent()   // apps/desktop-macos/
            .deletingLastPathComponent()   // apps/
            .deletingLastPathComponent()   // <repo>/
    }

    private static func bundlePath() throws -> String {
        if let override = ProcessInfo.processInfo.environment["HEYTA_BRIDGE_BUNDLE"] {
            return override
        }
        return repoRoot()
            .appendingPathComponent("packages/app-host/bridge-bundle/native-bridge.js").path
    }

    private static func databasePath() throws -> String {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let directory = base.appendingPathComponent("heyta", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory.appendingPathComponent("heyta.sqlite").path
    }
}
