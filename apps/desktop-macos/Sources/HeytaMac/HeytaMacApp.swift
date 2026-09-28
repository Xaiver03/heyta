// macOS 原生壳的**窗口**（SwiftUI）。
//
// ⚠️ 这个文件不负责 UI 的适配与统一 —— 那是另一条线在做。
//    它只做三件事：把窗口搭起来、把事件转成 AppApi 调用、把错误显示出来。
//    **一行业务规则都不许写在这里**（排序/完成态/派生视图都在 TS 那一侧）。

import AppKit
import HeytaShellCore
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
/// 🔴 为什么不让外面用 `screencapture` 截：
///   ① 整屏截图里别人的窗口会盖在上面（实测就是被浏览器窗口盖住了）；
///   ② `screencapture` 还要屏幕录制权限，CI / 无人值守下未必有。
///   自渲染拿到的恰好是**这个窗口**的内容，而且是可重复的。
///
/// 它在 Windows 侧的对应物是 `heyta-win-capture.ps1`（那边只能从外面截，
/// 因为没有"应用自己渲染成图"这么方便的路）。
enum SelfCapture {
    static func scheduleIfRequested() {
        guard let path = ProcessInfo.processInfo.environment["HEYTA_SELF_CAPTURE"] else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 3.0) {
            guard let window = NSApp.windows.first(where: { $0.isVisible }),
                  let view = window.contentView else {
                FileHandle.standardError.write(Data("没有可见窗口\n".utf8))
                exit(2)
            }
            let bounds = view.bounds
            guard let rep = view.bitmapImageRepForCachingDisplay(in: bounds) else { exit(3) }
            view.cacheDisplay(in: bounds, to: rep)
            guard let data = rep.representation(using: .png, properties: [:]) else { exit(4) }
            try? data.write(to: URL(fileURLWithPath: path))
            let info = """
            WINDOW_SIZE=\(Int(bounds.width))x\(Int(bounds.height))
            WINDOW_TITLE=\(window.title)
            PNG_BYTES=\(data.count)
            """
            try? info.write(toFile: path + ".txt", atomically: true, encoding: .utf8)
            print(info)
            exit(0)
        }
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
