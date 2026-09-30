// macOS 原生壳的**窗口**（SwiftUI）。
//
// ⚠️ 这个文件不负责 UI 的适配与统一 —— 那是另一条线在做。
//    **一行业务规则都不许写在这里**（排序/完成态/派生视图都在 TS 那一侧）。
//
// 🔴 **2026-09-29：这里曾经写着"把事件转成 `AppApi` 调用"，而那已经不再成立。**
//    手写的那份 SwiftUI 任务界面（含 `AppApi` 初始化）已按 ADR-0037 / M2 删除：
//    现在壳的内容**只有 `SharedWebView`**，界面全部来自 `apps/web` 的构建产物，
//    数据由那份 UI 自己拥有（与 web 同一条路径）。
//
//    这行注释留着不改的代价是具体的：下一个人会照着它去找 `AppApi`，
//    而在 UI 路径上它已经不存在了 —— G4（"门面缺口接 RN 后是否消失"）
//    要的正是这个事实：**共享 UI 不再经 `native-bridge` 的窄门面**。
//    `HeytaShellCore` 里那份 bridge 仍在（它是被 `heyta-smoke` 与
//    各端壳的桥接测试用的），但它**不在**渲染路径上。

import AppKit
import HeytaShellCore
import ScreenCaptureKit
import SwiftUI
import WebKit

@main
struct HeytaMacApp: App {
    @NSApplicationDelegateAdaptor(ActivationDelegate.self) private var delegate

    var body: some Scene {
        Window("heyta", id: "main") {
            ShellView()
        }
        // 🔴 标题条**融入应用壳**（2026-09-29 产品负责人：滴答的关闭/缩小条
        //    "完全融入应用壳，而不是很突兀的一个东西"）。hiddenTitleBar 让
        //    红绿灯浮在应用自己的底色上；拖动由 `isMovableByWindowBackground`
        //    接管（ActivationDelegate），rail 顶部让位由 `.heyta-shell` 注入。
        .windowStyle(.hiddenTitleBar)
        // 🔴 900×560 是**手写界面**时代的尺寸（那时内容只有标题+输入框+三行列表）。
        //    现在窗口里装的是**完整应用**（侧栏 + 主区 + 顶栏）——
        //    900 宽下侧栏与主区会互相挤，症状是"什么都看得见、什么都看不清"。
        //
        //    1280×820 又被产品负责人 2026-09-29 实测指出**太大**：
        //    "默认的窗口大小太大了"。默认值不是审计画布 —— 审计在 1280 宽下做
        //    是"布局要在那个宽度下不出错"，不等于"首次打开就该占那么大"。
        //    现取 **1120×720**：在 1440×900 的笔记本屏上留出菜单栏与 Dock 后
        //    仍有余量，内容区（竖排 rail + 主区）在这个宽度下不挤。
        .defaultSize(width: 1120, height: 720)
    }
}

/// 从命令行（`swift run HeytaMac`）启动时，进程默认不是"常规 App"：
/// 没有 Dock 图标、窗口也不会到前台 —— 于是看起来像"没起来"。
/// 显式设成 `.regular` 并激活，这样它才是一个正常的 macOS 窗口。
///
/// 🔴 **激活是有条件的**（2026-09-29，产品负责人：验收反复把他从前台拽走，
/// `AGENTS.md §6.2` 规定二本来就写着"不得抢走用户的输入焦点"）：
/// 设 `HEYTA_NO_FOCUS=1`（与 Electron 壳的 `HEYTA_DESKTOP_NO_FOCUS` 同名同义）
/// 就**只建窗口、不激活** —— 取证/冒烟的脚本启动一律带上它。
final class ActivationDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        if ProcessInfo.processInfo.environment["HEYTA_NO_FOCUS"] == "1" {
            // 窗口照常创建、照常能被 ScreenCaptureKit 截到，但不落焦点。
        } else {
            NSApp.activate(ignoringOtherApps: true)
        }
        // 🔴 hiddenTitleBar 没有可拖的标题条 —— 背景可拖补上这一能力
        //    （拖 rail / 内容区的空白处即可移动窗口，与滴答一致）。
        if let window = NSApp.windows.first(where: { $0.isVisible }) {
            window.isMovableByWindowBackground = true
        } else {
            DispatchQueue.main.async {
                NSApp.windows.first(where: { $0.isVisible })?.isMovableByWindowBackground = true
            }
        }
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

    /// 已经安排过（只安排一次）。
    @MainActor private static var scheduled = false
    /// 兜底计时器：**首屏一直没起来时**也必须留下证据并退出。
    @MainActor private static var fallback: Task<Void, Never>?

    /**
     `HEYTA_SELF_CAPTURE=<png>` ⇒ 截图并退出。

     🔴 **由"首屏真的起来了"触发，而不是固定延迟**（2026-09-30 改）。

     起因是一次实测：换用**一次性浏览器存储**（冷缓存）之后，应用要到 8 秒开外
     才挂载，而固定 6 秒的截屏**拍在它画出来之前** —— 抓到一张"内容比例 100%、但主蓝 0、
     身份入口 0"的图，随后进程退出、探针再也跑不完。
     固定延迟的错在于：它把"应用要多久起来"当成了常数，而那是**环境相关**的。

     现在：探针链跑完（应用确实起来了、且已回到首屏）时**主动**截；
     另外保留一个有界兜底（`fallbackSeconds`），保证失败路径也留得下证据。
     */
    static func scheduleIfRequested() {
        guard ProcessInfo.processInfo.environment["HEYTA_SELF_CAPTURE"] != nil else { return }
        Task { @MainActor in
            guard !scheduled else { return }
            scheduled = true
            fallback = Task { @MainActor in
                try? await Task.sleep(for: .seconds(fallbackSeconds))
                guard !Task.isCancelled else { return }
                FileHandle.standardError.write(Data("首屏始终没起来，按兜底截一张\n".utf8))
                await captureAndExit()
            }
        }
    }

    /// 首屏确认可用时调用。**幂等**：只截一次。
    static func triggerIfRequested() {
        Task { @MainActor in
            fallback?.cancel()
            await captureAndExit()
        }
    }

    /// 兜底时长：够慢机器冷启动 + 探针链跑完，又不至于让门禁干等。
    private static let fallbackSeconds = 45

    @MainActor
    private static func captureAndExit() async {
            guard !captured else { return }
            captured = true
            guard let path = ProcessInfo.processInfo.environment["HEYTA_SELF_CAPTURE"] else { return }
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

            /**
             🔴 **另取一份 WKWebView 自己的快照**（`takeSnapshot`）。

             为什么需要它：窗口截图走**窗口服务器合成**，而实测（2026-09-30）
             "WebView 的内容没合成进窗口"是这台机器上的**常态** —— 抓到的是
             暗窗口 + 一行诊断文字，内容比例 100%、**主蓝 0**，四条窗口断言**全过**。
             ⇒ "应用到底画出来没有"这个问题，**不能**压在窗口合成上。

             `takeSnapshot` 直接问 WebKit 要渲染结果：**不走窗口服务器、不需要录屏权限**，
             所以它稳定。两份产物各证一件事：

             · 窗口截图 `OUT`            → 一个真的 macOS 窗口（标题/尺寸/非空/取图方式）
             · WebView 快照 `OUT.webview.png` → **壳里那份共享 UI 真的渲染出来了**（数主蓝）
             */
            if let webView = webView {
                let snapshot = await snapshotPNG(webView)
                if let snapshot {
                    try? snapshot.write(to: URL(fileURLWithPath: path + ".webview.png"))
                    print("WEBVIEW_SNAPSHOT_BYTES=\(snapshot.count)")
                } else {
                    print("WEBVIEW_SNAPSHOT_BYTES=0")
                }
            } else {
                print("WEBVIEW_SNAPSHOT_BYTES=0")
            }
            exit(0)
    }

    /// 问 WebKit 要一份内容快照（PNG）。失败返回 nil —— **不阻断**窗口截图那条路。
    @MainActor
    private static func snapshotPNG(_ webView: WKWebView) async -> Data? {
        await withCheckedContinuation { continuation in
            let config = WKSnapshotConfiguration()
            config.rect = webView.bounds
            webView.takeSnapshot(with: config) { image, _ in
                guard let image,
                      let tiff = image.tiffRepresentation,
                      let rep = NSBitmapImageRep(data: tiff),
                      let png = rep.representation(using: .png, properties: [:]) else {
                    continuation.resume(returning: nil)
                    return
                }
                continuation.resume(returning: png)
            }
        }
    }

    /// 只截一次。
    @MainActor private static var captured = false

    /// 壳里那个 WKWebView。`makeNSView` 建好时登记进来 —— 截图时要问它要一份快照。
    /// ⚠️ **weak**：它是被视图树持有的，这里只是"能拿到"，不是"持有"。
    @MainActor static weak var webView: WKWebView?

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
        // 🔴 scale 不能读 `window.backingScaleFactor`：窗口**还没落到任何显示器上**
        //    （离屏 / 在别的 Space）时它恒为 1 —— 证据会变成 1x 低清图，
        //    且与 `screencapture -l`（原生像素，2x）的交叉验证必然不一致
        //    （2026-09-29 实测：自截图 1485×1014 vs screencapture 2970×2028）。
        //    改从窗口所属显示器取 scale，离屏时退回主显示器。
        let scale = window.screen?.backingScaleFactor
            ?? NSScreen.main?.backingScaleFactor
            ?? 1
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


// ─────────────────────────────────────────────────────────────────────────
// M2（macOS）：原生壳 + 内嵌共享 Web UI
//
// 与 Windows 壳（`apps/desktop-windows`，M2-D）**同一个架构**：
// 原生壳保留"只有原生才拿得到的东西"（窗口/菜单/托盘/钥匙串），
// **UI 用一份共享实现** —— 就是 `apps/web` 经 react-native-web 的那份产物。
//
// 🔴 **用自定义 scheme，不用 `file://`** —— 这条理由与 Windows 侧逐字相同：
//    `file://` 下没有正常 origin，service worker / fetch / module 的行为都与真浏览器
//    不同，那样测出来的"能渲染"不能代表真实形态。
//    Windows 用 `SetVirtualHostNameToFolderMapping`，macOS 的对应物是
//    `WKURLSchemeHandler`（都提供**正常 origin**）。
// ─────────────────────────────────────────────────────────────────────────

/// 把 `heyta-local://app/<path>` 映射到本地的共享 UI 产物目录。
final class HeytaSchemeHandler: NSObject, WKURLSchemeHandler {
    private let root: URL

    init(root: URL) { self.root = root }

    /// 按扩展名给 MIME —— 给错的话 `type="module"` 的脚本会被拒（实测症状是白屏，且控制台才有原因）。
    private func mimeType(for path: String) -> String {
        switch (path as NSString).pathExtension.lowercased() {
        case "html": return "text/html"
        case "js", "mjs": return "text/javascript"
        case "css": return "text/css"
        case "json", "webmanifest": return "application/json"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "woff2": return "font/woff2"
        case "ico": return "image/x-icon"
        default: return "application/octet-stream"
        }
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        // `heyta-local://app/index.html` ⇒ host="app"，path="/index.html"
        var rel = url.path
        if rel.isEmpty || rel == "/" { rel = "/index.html" }
        let fileURL = root.appendingPathComponent(String(rel.dropFirst()))

        guard let data = try? Data(contentsOf: fileURL) else {
            task.didFailWithError(NSError(domain: "heyta", code: 404))
            return
        }
        let response = HTTPURLResponse(
            url: url, statusCode: 200, httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": mimeType(for: rel), "Access-Control-Allow-Origin": "*"]
        )!
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

/// SwiftUI 里的共享 UI 宿主。
struct SharedWebView: NSViewRepresentable {
    let root: URL
    /// 存储宿主；`nil` = 这一轮不当宿主（页侧用自己那份存储）。见 `ShellStorageHost.decide()`。
    let storageHost: ShellStorageHost?
    /// 加载并探测完成后的结论（回传给 SwiftUI 显示 + 写证据）。
    let onProbe: (String) -> Void
    /// 宿主相关的**事实**（`STORAGE=` / `STORAGE_ERROR=`）。单独走一条：
    /// 它是给证据和排查用的，不该混进给用户看的那句说明里。
    let onStorageFact: (String) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onProbe: onProbe, onStorageFact: onStorageFact)
    }

    func makeNSView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(HeytaSchemeHandler(root: root), forURLScheme: "heyta-local")

        /**
         🔴 **一次性浏览器存储**（`HEYTA_WEBKIT_EPHEMERAL=1`，默认关）。

         为什么需要：门禁要判的是**冷启动第一屏**（"注册/登录是否前置"），
         而那要求壳处于**未登录**态。默认的数据存储是持久的 —— 同一台机器上
         只要有人真的登录过一次，门禁就会因为"看到的是已登录 IA"而失败，
         而那是**正常状态**，不是故障（2026-09-30 实测就踩在这上面）。

         比"跑之前删掉用户数据"好的地方：**不碰用户的东西**，而且确定性强。

         ⚠️ 默认**不开**：它是取证用的开关，不是产品行为。
         */
        if ProcessInfo.processInfo.environment["HEYTA_WEBKIT_EPHEMERAL"] == "1" {
            config.websiteDataStore = .nonPersistent()
        }

        /**
         🔴 **启动期错误探针**（`HEYTA_BOOT_DIAG=1` 才注入）。

         存在的理由：WKWebView 里页面"没挂载"时，**壳这边看不到任何错误** ——
         应用日志是空的、证据里只有 `identity:0`。实测 2026-09-30 就卡在这里：
         应用不挂载，而没有任何线索说为什么。这几行把 `error` 与
         `unhandledrejection` 记进 `window.__heytaBootErrors`，
         再由首屏探针带进证据。

         ⚠️ 默认**不注入**：它是取证用的，不是产品行为。
         */
        if ProcessInfo.processInfo.environment["HEYTA_BOOT_DIAG"] == "1" {
            config.userContentController.addUserScript(
                WKUserScript(
                    source: Coordinator.bootDiagShim,
                    injectionTime: .atDocumentStart,
                    forMainFrameOnly: true
                )
            )
        }

        if let host = storageHost {
            /**
             * 🔴 **必须在"文档创建时"注入**（`atDocumentStart`）。
             *
             * 晚一步就来不及：应用在启动那一刻就定了用哪份存储
             * （`resolveStorageBackend()` 只看这个端口在不在），
             * 而它会就此把自己的库打开、把首屏画出来。
             *
             * ⚠️ 这里注入的 shim 是一句**承诺**（"这个宿主能提供 SQLite"）——
             *    所以 `decide()` 已经先确认过桥的 bundle 真的在（见 `ShellStorageHost`）。
             */
            config.userContentController.addUserScript(
                WKUserScript(
                    source: ShellStorageHost.portShim,
                    injectionTime: .atDocumentStart,
                    forMainFrameOnly: true
                )
            )
            config.userContentController.add(context.coordinator, name: "heytaStorage")
            context.coordinator.storageHost = host
        }

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        // 回推消息要 `evaluateJavaScript` ⇒ Coordinator 得握着这个 WebView。
        // ⚠️ **weak**：`WKUserContentController` 强引用着 handler（Coordinator），
        //    而 WebView 强引用着它的 configuration ⇒ 强引用 WebView 就是环。
        context.coordinator.webView = webView
        SelfCapture.webView = webView

        // 🔴 探测取**组件自己打的 testID**，不取"界面上有字"。
        //    与 Windows 侧逐字相同的那条判据：登录入口（前置）+ 采集框（应用壳画出来了）。
        webView.load(URLRequest(url: URL(string: "heyta-local://app/index.html")!))
        return webView
    }

    func updateNSView(_ nsView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        let onProbe: (String) -> Void
        let onStorageFact: (String) -> Void
        /// 存储宿主（`nil` = 不当宿主）。见 `ShellStorageHost.decide()`。
        var storageHost: ShellStorageHost?
        /// 🔴 **weak**：见 `makeNSView` 里的说明（强引用会成环）。
        weak var webView: WKWebView?
        /// 懒开：`AppApi` 一建就会加载整个 bundle（含 SQLite 的 wasm/JS），
        /// 而"页侧到底会不会用宿主"要等它真的发消息过来才知道。
        private var storageApi: AppApi?
        /// 取证旅程只跑一次（它会在库里造一条真数据）。
        private var ranStorageJourney = false
        /// 通行密钥探针只跑一次。
        private var ranWebauthnProbe = false
        /// C 的鉴权旅程探针只跑一次。
        private var ranAuthJourney = false

        /// 桌面壳反向授权（ADR-0039 §2.3）。
        private var shellAuth: ShellAuthSession?
        /// 本次发出去的 `state` —— 回调必须把它**原样带回来**。
        private var pendingAuthState = ""

        /**
         起一次反向授权：把鉴权交给**系统浏览器**（壳里做不了通行密钥，见 `ShellAuth` 文件头）。

         ⚠️ 浏览器那一步**由人完成** —— `ASWebAuthenticationSession` 是系统弹的，自动化不了。
          */
        func beginShellAuth(site: String) {
            pendingAuthState = ShellAuth.makeState()
            onStorageFact("AUTH_STARTED=site=\(site) state=\(pendingAuthState.prefix(8))…")
            let session = ShellAuthSession { [weak self] callback in
                Task { @MainActor in
                    self?.handleAuthCallback(callback, baseUrl: site)
                }
            }
            shellAuth = session
            if !session.start(site: site, state: pendingAuthState) {
                onStorageFact("AUTH_START_FAILED=系统浏览器没能启动")
            }
        }

        /**
         回调到达：**先校验 state**，再把令牌交给**页侧既有**登录路径。

         🔴 「页侧既有登录路径」= `apps/web/src/features/auth/pending-login.ts` 消费的那条：
            往**页面自己 origin** 的 `sessionStorage` 写 `loginToken` + `loginBaseUrl`，然后重载。
            壳不新写一份"登录后该做什么"。
         */
        func handleAuthCallback(_ url: URL, baseUrl: String) {
            switch ShellAuth.parseCallback(url, expectedState: pendingAuthState) {
            case let .rejected(reason):
                // 拒绝必须**说出来**：静默会让"被人塞了个回调"看起来像"什么都没发生"。
                onStorageFact("AUTH_CALLBACK=rejected: \(reason)")
            case let .ok(token, _):
                onStorageFact("AUTH_CALLBACK=ok")
                /**
                 ⚠️ **只写存储，不在这里重载**。
                 实测（2026-09-30）：脚本里 `location.reload()` 之后，新文档的**模块脚本不执行**
                 ——症状是 `identity:0`、`backend:""`，而 `bootErrors` 为空
                 （模块加载失败**不**触发 `window.onerror`，所以查不到线索）。
                 改为**由壳发一次正常的 `load()`**：那是与应用首次加载**同一条**路，
                 而那条路是好的。
                 */
                let js =
                    "sessionStorage.setItem('loginToken', \(jsStringLiteral(token)));" +
                    "sessionStorage.setItem('loginBaseUrl', \(jsStringLiteral(baseUrl)));"
                // ⚠️ **等一拍再写 + 重载**：交付发生在"首屏刚通过探针"那一刻，
                //    此时 WebView 的资源往往还在飞 —— 立刻 reload 会让新文档的
                //    模块脚本取不到（实测症状：`identity:0` 且 `bootErrors` 为空，
                //    因为模块加载失败**不**触发 `window.onerror`）。
                DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { [weak self] in
                self?.webView?.evaluateJavaScript(js) { [weak self] _, error in
                    guard let self else { return }
                    if let error {
                        self.onStorageFact("AUTH_HANDOFF_FAILED=\(error.localizedDescription)")
                    }
                    /**
                     🔴 **交付之后要把那条 IA 断言链叫回来**。
                     交付是"写 sessionStorage + 重载"，页面会**重新加载** ——
                     所以要等它起来，再让 M2-D 那条链重新点数菜单 IA，
                     于是 `AUTH_STATE=signed-in` 这一格才会出现。
                     没有它，"令牌交出去了"就只是一个动作，不是一个**被断言过的结果**。
                     */
                    self.ranSettings = false
                    // 写完存储后**由壳重新加载**（见上）。用应用入口那个 URL，
                    // 与首次加载逐字相同。
                    self.webView?.load(
                        URLRequest(url: URL(string: "heyta-local://app/index.html")!)
                    )
                    DispatchQueue.main.asyncAfter(deadline: .now() + 6.0) {
                        guard let webView = self.webView else { return }
                        self.probe(webView)
                    }
                }
                }
            }
        }
        /// 🔴 三段探针**放在 Coordinator 上**（不是 `makeNSView` 的局部变量）——
        /// SwiftUI 的 `makeNSView` 与 `Coordinator` 是两个作用域，
        /// 局部 `let` 在委托回调里根本看不到（第一版就是这么编译不过的）。
        ///
        /// 第一段：冷启动第一屏（身份入口 + 应用壳）。
        ///
        /// 🔴 **2026-09-30 判据改锚点**：产品负责人拍板"应该是点击头像出来注册、
        /// 登录"之后，`sync-signin-entry` **不再常驻首屏**（它在头像菜单里，
        /// 菜单是点开才渲染的）。所以第一屏的锚点是**身份入口本身**
        /// （`account-menu-avatar`），登录入口搬到第二段（打开菜单后）再验 ——
        /// 判据没有放松：未登录时"菜单第一项必须是登录/注册、且不得有退出登录"
        /// 是**更严**的一条，见 `menuProbe`。
        ///
        /// ⚠️ 与 Windows 侧（`MainWindow.xaml.cs` 的 app 模式）**逐字相同**。
        static let firstScreenProbe = """
        JSON.stringify({
          identity: document.querySelectorAll('[data-testid="account-menu-avatar"]').length,
          capture: document.querySelectorAll('input[placeholder^="添加任务"]').length,
          backend: (globalThis.__heytaStorage || {}).backend || '',
          // 🔴 消息处理器**在不在**是这条管道最要紧的一格：shim 的 `postMessage`
          //    一旦打到一个不存在的手册上就会抛，而页侧催 ready 的那个循环
          //    把抛错**吞掉了**（"端口还没接上，下一拍再催"）—— 症状是
          //    "后端选了 shell、却永远收不到响应"，一个字都不报。
          handler: typeof (window.webkit && window.webkit.messageHandlers
            && window.webkit.messageHandlers.heytaStorage),
          // 🔴 通行密钥能不能用，取决于**页面 origin 是不是安全上下文**。
          //    Windows 壳把产物挂在 `https://heyta.local`（安全上下文），
          //    macOS 壳用的是自定义 scheme `heyta-local://` —— 这两者**不一样**，
          //    而"能不能注册/登录"这件事就压在这一格上。所以先量，不猜。
          origin: location.origin,
          secure: window.isSecureContext === true,
          webauthn: typeof window.PublicKeyCredential,
          title: document.title,
          bootErrors: (window.__heytaBootErrors || []).slice(0, 4).join(' | '),
          scripts: document.querySelectorAll('script[src]').length
        })
        """

        /// 第二段：进「设置」页。
        ///
        /// 🔴 **2026-09-29 起「设置」不再是 rail 上的 tab** —— 按滴答的 IA
        /// 收进了左侧导航**顶部的头像菜单**（rail 只放"去哪看"）。
        /// 所以这里走"点头像 → 点菜单里的设置"，而不是找 `role=tab`。
        ///
        /// ⚠️ 仍然**用 testid/文案找，不写死索引** —— 索引会随条目增减而漂移。
        /// ⚠️ 头像菜单是**点开才渲染**的，所以必须分两次 `evaluateJavaScript`
        ///（点开头像 → 等 React 渲染 → 点设置）。一次脚本里连点两下是**无效**的：
        /// 第二下执行时菜单还不在 DOM 里。
        static let openAccountMenuProbe = """
        (function(){
          var a = document.querySelector('[data-testid="account-menu-avatar"]');
          if (!a) return 'NO_AVATAR';
          a.click();
          return 'CLICKED';
        })()
        """

        /// 头像菜单打开之后：**身份菜单的 IA 判据**（未登录态）。
        ///
        /// 一次求值同时取回四件事，任何一件不对都判红：
        ///   `first`    —— 菜单**第一项**的 testID（必须是 `sync-signin-entry`）；
        ///   `signin`   —— 登录/注册入口个数（必须 > 0）；
        ///   `settings` —— 设置入口个数（登出人也要能进设置：同步地址/AI/导入都在那）；
        ///   `signout`  —— **必须为 0**：未登录时「退出登录」在语义上不存在，
        ///                 渲染它等于给一个按不出效果的危险按钮。
        ///
        /// ⚠️ `querySelector('[role="menuitem"]')` 取的是**第一个**，正好就是
        ///    产品负责人要求"登录/注册前置"的落点；用 testID 比对而不是索引。
        static let menuProbe = """
        (function(){
          var items = document.querySelectorAll('[role="menuitem"]');
          var first = items.length > 0 ? (items[0].getAttribute('data-testid') || '') : '';
          return JSON.stringify({
            first: first,
            signin: document.querySelectorAll('[data-testid="sync-signin-entry"]').length,
            settings: document.querySelectorAll('[data-testid="account-menu-settings"]').length,
            signout: document.querySelectorAll('[data-testid="account-menu-signout"]').length
          });
        })()
        """

        /// 点头像之后：菜单里的「设置」。
        static let settingsClickProbe = """
        (function(){
          var st = document.querySelector('[data-testid="account-menu-settings"]');
          if (!st) return 'NO_SETTINGS_ITEM';
          st.click();
          return 'CLICKED';
        })()
        """

        /// 🔴 收尾段：**回到「任务」首屏**。设置探针把应用留在了设置页 ——
        ///    自截屏在启动 +3s 才跑，不回去的话安装包的“第一屏”证据永远是
        ///    设置 sheet（2026-09-30 实测：四轮截图全是对着设置页打分）。
        static let backToTasksProbe = """
        (function(){
          var tabs = document.querySelectorAll('[role="tab"]');
          for (var i = 0; i < tabs.length; i++) {
            if (tabs[i].textContent && tabs[i].textContent.trim() === '任务') {
              tabs[i].click();
              return 'CLICKED';
            }
          }
          return 'NO_TASKS_TAB';
        })()
        """

        /// 第三段：设置里的滴答导入面板在不在。
        static let importPanelProbe = """
        JSON.stringify({
          panel: document.querySelectorAll('[data-testid="ticktick-import-panel"]').length,
          fileInput: document.querySelectorAll('[data-testid="ticktick-file"]').length
        })
        """

        var js = SharedWebView.Coordinator.firstScreenProbe
        private var attempts = 0
        /// 第二段（设置里的导入面板）只跑一次 —— 否则每次轮询都会点一次设置。
        private var ranSettings = false

        init(onProbe: @escaping (String) -> Void, onStorageFact: @escaping (String) -> Void) {
            self.onProbe = onProbe
            self.onStorageFact = onStorageFact
        }

        /**
         页侧发来的消息 → TS → 回推给页侧。

         🔴 两个方向各有一个**实测**出来的要点，任一处搞错都**不会报错**、只会"什么都不发生"：

         · **入方向**：`message.body` 是 WebKit 桥过来的对象（`[String: Any]`），
           而 `handleHostMessage` 要的是 JSON 字符串 ⇒ 必须再序列化一次。
           （页侧出站已被线码装箱成普通 JSON，所以这里不会遇到 Map / undefined ——
           那正是线码存在的理由。）

         · **出方向**：页侧监听器读的是 `event.data`，而它必须是**已解析的对象**
           （`decodeOpLogWire(event.data)`）。`window.postMessage(<字符串>)` 交出去的是
           **字符串** ⇒ 必须 `JSON.parse` 一下。这一格错了的症状是"发得出去、收不回来"，
           请求永远悬着。

         ⚠️ 除此之外这一层**不解析任何协议字段**：收一条回几条由 TS 决定。
         */
        func userContentController(
            _ controller: WKUserContentController,
            didReceive message: WKScriptMessage
        ) {
            guard message.name == "heytaStorage", let host = storageHost else { return }

            guard let body = message.body as? [String: Any],
                  let data = try? JSONSerialization.data(withJSONObject: body),
                  let json = String(data: data, encoding: .utf8) else {
                onStorageFact("STORAGE_ERROR=页侧消息不是对象，转不成 JSON")
                return
            }

            do {
                if storageApi == nil {
                    let api = try AppApi(bundlePath: host.bundlePath, dbPath: host.dbPath)
                    // 只开 store、**不建引擎**（引擎归页侧）—— 两个引擎同库会各自为政。
                    _ = try api.openOpLog()
                    storageApi = api
                }
                guard let api = storageApi else { return }
                for outbound in try api.handleHostMessage(json) {
                    let script = "window.postMessage(JSON.parse(\(jsStringLiteral(outbound))), '*');"
                    webView?.evaluateJavaScript(script) { [weak self] _, error in
                        if let error {
                            self?.onStorageFact("STORAGE_ERROR=回推失败：\(error.localizedDescription)")
                        }
                    }
                }
            } catch {
                // 失败**必须说出来**：静默会让页侧永远等一个不来的响应。
                onStorageFact("STORAGE_ERROR=\(error)")
            }
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            // 🔴 壳标记：hiddenTitleBar 之后红绿灯浮在应用自己的底色上，
            //    rail 顶部必须给它们让位（`app.css` 的 `.heyta-shell .ht-rail__top`）。
            //    类是幂等的，重复注入无害；浏览器 / PWA 没有它，布局不变。
            webView.evaluateJavaScript(
                "document.documentElement.classList.add('heyta-shell')"
            )
            probe(webView)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            onProbe("M2-macOS 🔴 加载失败：\(error.localizedDescription)")
        }

        /// 🔴 **必须两个都实现。**
        ///
        /// `didFail` 管的是**已经提交**的导航；而**主框架根本没加载成**（404 / 协议不支持 /
        /// 目录不存在）走的是 `didFailProvisionalNavigation` ——
        /// 只实现前者的话，这一整条失败路径**没有回调**，于是探测不启动、证据一个字不写，
        /// 看起来像"证据丢了"而不是"断言转红了"（实测踩过）。
        func webView(
            _ webView: WKWebView,
            didFailProvisionalNavigation navigation: WKNavigation!,
            withError error: Error
        ) {
            onProbe("M2-macOS 🔴 主框架没加载成（provisional）：\(error.localizedDescription)")
        }

        /// 轮询而不是固定 sleep：固定 sleep 在慢机器上假失败、在快机器上白等。
        private func probe(_ webView: WKWebView) {
            attempts += 1
            webView.evaluateJavaScript(js) { [weak self] result, _ in
                guard let self else { return }
                // `evaluateJavaScript` 给回来的是**已经解析过的值**（这里是 String），
                // ⚠️ 与 WebView2 的 `ExecuteScriptAsync`（回 JSON 编码过的字符串）不同 ——
                //    跨语言取"求值结果"时，**先把编码层数搞清楚**（Windows 侧为此翻过一次车）。
                let text = (result as? String) ?? ""
                let identity = Self.field(text, "identity")
                let capture = Self.field(text, "capture")
                if identity > 0 && capture > 0 {
                    /**
                     * 🔴 **页侧实际用上的存储后端**（`shell` = 数据落在**壳的 SQLite**）。
                     * 两条路在界面上看起来一模一样 —— 所以这一格是唯一说真话的地方
                     * （字段名与 Windows 的 `STORAGE=` 一致）。
                     */
                    self.onStorageFact("STORAGE=\(Self.text(text, "backend"))")
                    // 把 origin/安全上下文/通行密钥能力写进证据 —— C 的形态由它们决定。
                    self.onStorageFact("PAGE_ORIGIN=\(Self.text(text, "origin"))")
                    self.onStorageFact("SECURE_CONTEXT=\(Self.field(text, "secure") == 1 ? "yes" : "no")")
                    self.onStorageFact("WEBAUTHN=\(Self.text(text, "webauthn"))")

                    /**
                     桌面壳反向授权（ADR-0039 §2.3）——两个口子，都按环境变量启用：

                     · `HEYTA_AUTH_START=1` + `HEYTA_AUTH_SITE=<站点>`：起一次真的授权
                       （系统浏览器那一步**由人完成**）；
                     · `HEYTA_AUTH_CALLBACK=<完整回调 URL>` + `HEYTA_AUTH_STATE=<本次 state>`：
                       把一个回调**直接喂进同一条处理函数** —— 于是解析、state 校验、
                       交付这三步**不需要人**也能验；它跳过的只是"系统浏览器弹没弹出来"。
                     */
                    /**
                     🔬 **诊断口子**（`HEYTA_RELOAD_TEST=1`）：只**重新加载**应用、不写任何存储。
                     它用来把"第二次加载能不能挂载"与鉴权交付**分开** ——
                     2026-09-30 实测：交付之后 `identity:0`，而这条能告诉我们
                     那到底是"交付写坏了"还是"壳本来就加载不了第二次"。
                     */
                    if ProcessInfo.processInfo.environment["HEYTA_RELOAD_TEST"] == "1" {
                        self.onStorageFact("RELOAD_TEST=reloading")
                        self.ranSettings = false
                        self.webView?.load(
                            URLRequest(url: URL(string: "heyta-local://app/index.html")!)
                        )
                        DispatchQueue.main.asyncAfter(deadline: .now() + 6.0) {
                            guard let webView = self.webView else { return }
                            self.probe(webView)
                        }
                        return
                    }

                    let authEnv = ProcessInfo.processInfo.environment
                    if let raw = authEnv["HEYTA_AUTH_CALLBACK"], let url = URL(string: raw) {
                        self.pendingAuthState = authEnv["HEYTA_AUTH_STATE"] ?? ""
                        self.handleAuthCallback(url, baseUrl: authEnv["HEYTA_AUTH_SITE"] ?? "")
                        return
                    }
                    if authEnv["HEYTA_AUTH_START"] == "1" {
                        self.beginShellAuth(site: authEnv["HEYTA_AUTH_SITE"] ?? "")
                        return
                    }

                    // 通行密钥失败原因的实测（只按环境变量启用，且只跑一次）。
                    if ProcessInfo.processInfo.environment["HEYTA_WEBAUTHN_PROBE"] == "1",
                       !self.ranWebauthnProbe {
                        self.ranWebauthnProbe = true
                        let full = ProcessInfo.processInfo.environment["HEYTA_WEBAUTHN_PROBE"] == "create"
                        webView.callAsyncJavaScript(
                            Self.webauthnProbe,
                            arguments: ["full": full],
                            in: nil,
                            in: .page
                        ) { result in
                            switch result {
                            case let .success(value):
                                self.onStorageFact("WEBAUTHN_PROBE=\(String(describing: value))")
                            case let .failure(error):
                                self.onStorageFact("WEBAUTHN_PROBE=调用失败：\(error.localizedDescription)")
                            }
                        }
                    }

                    // C：邮件登录链接那条路（两半，各自按环境变量启用）。
                    if let action = ProcessInfo.processInfo.environment["HEYTA_AUTH_JOURNEY"],
                       !action.isEmpty, !self.ranAuthJourney {
                        self.ranAuthJourney = true
                        let env = ProcessInfo.processInfo.environment
                        let js = Self.authJourneyProbe(
                            action: action,
                            email: env["HEYTA_AUTH_EMAIL"] ?? "",
                            token: env["HEYTA_AUTH_TOKEN"] ?? "",
                            server: env["HEYTA_AUTH_SERVER"] ?? ""
                        )
                        webView.callAsyncJavaScript(js, arguments: [:], in: nil, in: .page) { result in
                            switch result {
                            case let .success(value):
                                self.onStorageFact("AUTH_JOURNEY=\(String(describing: value))")
                                /**
                                 🔴 **登录做完之后，让 M2-D 那条链再跑一遍** ——
                                 它负责断言菜单 IA（`AUTH_STATE=`），而登录**之后**的那一态
                                 才是 C 要的判据。`ranSettings` 复位是为了让链重新执行；
                                 `ranAuthJourney` 保持 true，所以鉴权那段不会被再放一次。
                                 */
                                self.ranSettings = false
                                DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                                    self.probe(webView)
                                }
                            case let .failure(error):
                                self.onStorageFact("AUTH_JOURNEY=调用失败：\(error.localizedDescription)")
                            }
                        }
                        /**
                         🔴 **这一轮先不往下跑 M2-D 那条链。**
                         它开头也会点头像（`openAccountMenuProbe`），而本条也会点 ——
                         两条并发会把同一个菜单**开一下又关掉**，症状是
                         `NO_SIGNIN_ENTRY`（实测 2026-09-30）。一次只让一条链动界面；
                         本条做完之后会**主动**把链叫回来（见上面的 asyncAfter）。
                         */
                        return
                    }

                    // 取证用的那一步真旅程：只按环境变量启用，且只跑一次。
                    if let journey = ProcessInfo.processInfo.environment["HEYTA_STORAGE_JOURNEY"],
                       !journey.isEmpty, !self.ranStorageJourney {
                        self.ranStorageJourney = true
                        webView.evaluateJavaScript(Self.storageJourneyProbe(journey)) { res, _ in
                            self.onStorageFact("JOURNEY_TYPED=\(String(describing: res))")
                        }
                    }

                    // 第二段只跑一次。
                    if !self.ranSettings {
                        self.ranSettings = true
                        // ① 点头像（菜单是**点开才渲染**的，所以必须分两步）。
                        webView.evaluateJavaScript(Self.openAccountMenuProbe) { res, _ in
                            guard (res as? String) == "CLICKED" else {
                                self.onProbe(
                                    "M2-macOS ⚠️ 身份入口成立，但**找不到账号头像**：\(String(describing: res))"
                                )
                                return
                            }
                            // ② 等 React 把菜单渲染出来，验**身份菜单 IA**，再点「设置」。
                            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                                webView.evaluateJavaScript(Self.menuProbe) { r0, _ in
                                    let menu = (r0 as? String) ?? ""
                                    let first = Self.text(menu, "first")
                                    let menuSignin = Self.field(menu, "signin")
                                    let menuSettings = Self.field(menu, "settings")
                                    let menuSignout = Self.field(menu, "signout")
                                    /**
                                     🔴 **C：登录前后**各有**恰好一种**合法 IA，这就是"注册/登录之后"的判据。

                                     未登录：第一项 = 登录/注册、有设置项、**没有**退出登录
                                     已登录：**有**退出登录、且**没有**登录入口

                                     ⚠️ 第三种情况（两者都在 / 都不在）是**真缺陷**，必须红 ——
                                     判据没有放松：它只是把"登录之后"也纳入了可判定的状态。
                                     ⚠️ 通行密钥那一步**必须有人**（Touch ID）：壳能做的到此为止；
                                     这一格的作用是让"人做完之后"的那一态**可被断言**，
                                     而不是把人的那一步伪装成自动通过。
                                     */
                                    let signedOut = menuSignin > 0 && menuSignout == 0
                                        && first == "sync-signin-entry"
                                    let signedIn = menuSignout > 0 && menuSignin == 0

                                    if signedIn {
                                        self.onStorageFact("AUTH_STATE=signed-in")
                                        self.onProbe(
                                            "M2-macOS ✅ **已登录**（退出登录 \(menuSignout) 个、" +
                                            "登录入口 \(menuSignin) 个；设置项 \(menuSettings) 个）"
                                        )
                                        return
                                    }

                                    guard signedOut, menuSettings > 0 else {
                                        self.onProbe(
                                            "M2-macOS 🔴 **身份菜单不合规**：未登录时菜单第一项必须是 " +
                                            "sync-signin-entry、必须有设置项、且**不得**有退出登录；" +
                                            "已登录时必须有退出登录且**没有**登录入口 —— " +
                                            "实测 \(menu)"
                                        )
                                        return
                                    }
                                    self.onStorageFact("AUTH_STATE=signed-out")
                                    webView.evaluateJavaScript(Self.settingsClickProbe) { res2, _ in
                                        guard (res2 as? String) == "CLICKED" else {
                                            self.onProbe(
                                                "M2-macOS ⚠️ 身份菜单成立，但**菜单里找不到「设置」**：" +
                                                "\(String(describing: res2))"
                                            )
                                            return
                                        }
                                        // ③ 点完要等 React 重渲染 —— 固定 1.2s
                                        //（切视图是本地状态更新，不是网络等待）。
                                        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
                                            webView.evaluateJavaScript(Self.importPanelProbe) { r2, _ in
                                                let t2 = (r2 as? String) ?? ""
                                                let panel = Self.field(t2, "panel")
                                                let file = Self.field(t2, "fileInput")
                                                if panel > 0 && file > 0 {
                                                    // 🔴 验完**先回「任务」首屏**再写证据 ——
                                                    //    自截屏（+3s）截的必须是冷启动第一屏。
                                                    webView.evaluateJavaScript(Self.backToTasksProbe) { _, _ in }
                                                    self.onProbe(
                                                        "M2-macOS ✅ 身份入口成立（头像 \(identity) 个、" +
                                                        "采集框 \(capture) 个）；**身份菜单合规**" +
                                                        "（第一项 \(first)、登录入口 \(menuSignin) 个、" +
                                                        "退出登录 \(menuSignout) 个）；" +
                                                        "**设置里的滴答导入面板可达**（panel=\(panel) file=\(file)）"
                                                    )
                                                    // 🔴 应用确实起来了、且刚点回首屏 ⇒ **此刻**才是截图时机。
                                                    //    留 0.6s 让"回到任务"那一帧真正提交。
                                                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
                                                        SelfCapture.triggerIfRequested()
                                                    }
                                                } else {
                                                    self.onProbe(
                                                        "M2-macOS 🔴 身份菜单成立，但**设置里没有滴答导入面板**：\(t2)"
                                                    )
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        return
                    }
                    return
                }
                if self.attempts >= 40 {
                    self.onProbe("M2-macOS 🔴 真应用没画出来（或没有身份入口/采集框）：\(text)")
                    return
                }
                // 🔴 **每次探测都把当前状态写进证据**，而不是只在最后写一次。
                //    实测踩过：失败路径要等满 40 次（20 秒），而自截屏模式会**先退出**
                //    ⇒ 只在最后写的话，注入故障时**一个字都不会留下**，
                //    看起来就像"证据丢了"，而不是"断言转红了"。
                self.writeAttempt("\(text)")
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { self.probe(webView) }
            }
        }

        /// 把"还没成功时的最后一次探测"落到证据文件里。
        private func writeAttempt(_ text: String) {
            guard let path = ProcessInfo.processInfo.environment["HEYTA_M2_EVIDENCE"], !path.isEmpty else { return }
            let body = "WINDOW=heyta\nM2_MACOS_NOTE=M2-macOS 🟡 第 \(attempts) 次探测还没成功：\(text)\n"
            try? body.write(toFile: path + ".txt", atomically: true, encoding: .utf8)
        }

        /**
         🔴 **"页侧真的把数据写进壳的库"这一步，在 macOS 上没有 CDP 可用。**

         WKWebView 不暴露 CDP，Playwright 也没有 WebKit 的附着 API ⇒ Windows 那套
         `connectOverCDP` + Playwright 点界面的办法在这里**走不通**。

         可用的机制是这个壳**本来就在用的**那一种：`evaluateJavaScript`。
         它已经在点头像（`openAccountMenuProbe`）—— 这里只是把它用来**走一步真旅程**：
         往采集框里打字并回车，即"用户新建一条任务"。

         ⚠️ 三条实测要点：
          · React 受控输入必须走**原型上的 value setter** + 派发 `input`，
            直接 `input.value = x` 不会更新 React 的 state（症状是"看起来填了、提交为空"）；
          · 回车派发 `keydown`（React 的 `onKeyDown` 读 `key`）；
          · 它**只按环境变量启用**（`HEYTA_STORAGE_JOURNEY=<任务标题>`）—— 与
            `HEYTA_SELF_CAPTURE` 同类，是取证用的诊断通道，不是产品路径。

         判据不在这里下结论：**真正的判据是"从壳外读那个 `.sqlite`"**
         （见 `apps/desktop-macos/evidence/storage-host/`）。这里只负责**造出那条数据**。
         */
        static func storageJourneyProbe(_ title: String) -> String {
            """
            (() => {
              const input = document.querySelector('input[placeholder^="添加任务"]');
              if (!input) return 'NO_INPUT';
              const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
              setter.call(input, \(jsStringLiteral(title)));
              input.dispatchEvent(new Event('input', { bubbles: true }));
              input.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true
              }));
              return 'TYPED';
            })()
            """
        }

        /**
         🔴 **量"通行密钥为什么失败"** —— 不靠推断，直接问平台要错误原文。

         `HEYTA_WEBAUTHN_PROBE=1` 时跑一次 `navigator.credentials.create`，
         把平台的异常名/消息原样带回证据。它**可能弹出 Touch ID**（如果平台接受），
         失败时则是这条链上最直接的一份证据。

         ⚠️ 必须用 `callAsyncJavaScript`（它支持 `await`）：`evaluateJavaScript`
         不等待 Promise，拿到的是 `{}` 而不是结果 —— 那会让人误判成"没有错误"。
         */
        static let bootDiagShim = """
        window.__heytaBootErrors = [];
        window.addEventListener('error', function (e) {
          window.__heytaBootErrors.push(String((e && (e.message || e.error)) || e));
        });
        window.addEventListener('unhandledrejection', function (e) {
          window.__heytaBootErrors.push('rejection: ' + String(e && e.reason));
        });
        """

        static let webauthnProbe = """
        globalThis.__heytaProbeFull = full;
        const challenge = new Uint8Array(32);
        crypto.getRandomValues(challenge);
        const userId = new Uint8Array(16);
        crypto.getRandomValues(userId);
        let uvpaa = 'unknown';
        try {
          uvpaa = String(await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
        } catch (e) { uvpaa = 'ERR:' + e.name; }
        // ⚠️ 默认**不建凭据**：`create` 会在用户的钥匙串里留一条真东西。
        //    要看完整路径才设 HEYTA_WEBAUTHN_PROBE=create。
        if (globalThis.__heytaProbeFull !== true) {
          return 'SKIPPED_CREATE uvpaa=' + uvpaa;
        }
        try {
          const cred = await navigator.credentials.create({ publicKey: {
            challenge: challenge,
            rp: { id: location.host, name: 'heyta' },
            user: { id: userId, name: 'probe', displayName: 'probe' },
            pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
            timeout: 8000,
          }});
          return 'CREATED=' + (cred ? 'yes' : 'no') + ' uvpaa=' + uvpaa;
        } catch (e) {
          return 'ERROR name=' + (e && e.name) + ' message=' + (e && e.message) + ' uvpaa=' + uvpaa;
        }
        """

        /**
         🔴 **C：macOS 上"注册/登录之后"那条旅程的机制**（没有 CDP，壳内探针就是唯一的路）。

         两条实测出来的硬约束决定了用**邮件登录链接**这条产品已有的路：
           · 通行密钥在壳里不可用（`uvpaa=false`，见 evidence）；
           · magic-link 的回跳腿要深链（`heyta://auth#token=…`），而 macOS 壳**没有**深链处理。
         而鉴权面板自带一条**为"拿不到深链"准备的**入口：「或者粘贴登录链接 / 令牌」。

         两半，各自按环境变量启用、只跑一次：
           · `HEYTA_AUTH_JOURNEY=send-link` + `HEYTA_AUTH_EMAIL=<邮箱>`：走界面请求登录链接
           · `HEYTA_AUTH_JOURNEY=paste-token` + `HEYTA_AUTH_TOKEN=<令牌>`：把令牌粘进面板

         ⚠️ 令牌由**测试侧从库里读**（TEST_MODE 的"打开邮件"）—— 不是产品后门：
            服务端本来就明文存 `users.login_token`，而管理接口刻意不吐它。

         ⚠️ React 受控输入必须走**原型上的 value setter** + 派发 `input`（同旅程探针）。
         */
        static func authJourneyProbe(
            action: String,
            email: String,
            token: String,
            server: String
        ) -> String {
            """
            // ⚠️ `callAsyncJavaScript` 把源当**函数体**（本身已在 async 上下文里）：
            //    所以要**直接写语句 + return**，不能再套一层 IIFE ——
            //    套了的话末尾是个表达式，返回值是 `undefined`（实测：证据里只剩 `nil`）。
            const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
              const setValue = (el, v) => {
                const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
                setter.call(el, v);
                el.dispatchEvent(new Event('input', { bubbles: true }));
              };
              const byTest = (id) => document.querySelector('[data-testid="' + id + '"]');
              // ⚠️ **中英都要认**：壳里界面语言跟随系统/浏览器，不一定是中文。
              //    （实测：顶栏有语言选择器，凭中文文案找按钮会在英文界面下全落空。）
              const byText = (cands) =>
                [...document.querySelectorAll('button')].find((b) => {
                  const t = b.textContent || '';
                  return cands.some((c) => t.includes(c));
                });

              const avatar = byTest('account-menu-avatar');
              if (!avatar) return 'NO_AVATAR';
              // 菜单可能已经开着（别把切换点成"关"）。
              let entry = byTest('sync-signin-entry');
              // 🔴 **轮询 + 重试点击**，不要只 sleep 一次：菜单是 React 点开才渲染的，
              //    而单击落在错误的时刻时它会**什么都不开**（实测：偶发 `NO_SIGNIN_ENTRY`）。
              for (let attempt = 0; attempt < 3 && !entry; attempt += 1) {
                avatar.click();
                for (let i = 0; i < 20 && !entry; i += 1) {
                  await sleep(150);
                  entry = byTest('sync-signin-entry');
                }
              }
              if (!entry) return 'NO_SIGNIN_ENTRY';
              entry.click();
              await sleep(700);

              const urlInput = document.querySelector('input[type="url"]');
              if (!urlInput) return 'NO_SERVER_INPUT';
              setValue(urlInput, \(jsStringLiteral(server)));
              const emailInput = document.querySelector('input[type="email"]');
              if (!emailInput) return 'NO_EMAIL_INPUT';
              setValue(emailInput, \(jsStringLiteral(email)));

              const act = \(jsStringLiteral(action));
              if (act === 'send-link' || act === 'register-link') {
                // ⚠️ 对**不存在的邮箱**，登录链接是**故意静默**的（防枚举：文案说"如果这个邮箱
                //    有账号…"）⇒ 那个邮箱不会有账号、也不会有令牌。所以要验注册那条路。
                const cands =
                  act === 'register-link'
                    ? ['注册新账号', 'Create account']
                    : ['发送登录链接', 'Send login link'];
                const btn = byText(cands);
                if (!btn) return 'NO_BUTTON:' + cands.join('/');
                btn.click();
                await sleep(2000);
                const panel = document.querySelector('[role="dialog"]') || document.body;
                return 'CLICKED(' + act + '): ' + (panel.textContent || '').slice(0, 160);
              }

              const paste = [...document.querySelectorAll('input')].find(
                (i) => { const p = i.placeholder || ''; return p.includes('粘贴') || p.includes('Paste'); }
              );
              if (!paste) return 'NO_PASTE_INPUT';
              setValue(paste, \(jsStringLiteral(token)));
              await sleep(200);
              // ⚠️ 候选必须**精确**：早先放了 '登录' 当兜底，而「发送登录链接」也含这两个字 ⇒
                //    点错按钮、面板关掉、探针误判成登录成功（实测 2026-09-30）。
                const confirm = byText(['完成登录', 'Finish signing in']);
              if (!confirm) return 'NO_CONFIRM_BUTTON';
              confirm.click();
              await sleep(2500);
            // ⚠️ 把**面板自己说的话**一起带回来：
            //    "没登上"与"登上"的区分不能只看面板关没关 ——
            //    令牌无效时界面会给出**可见的失败文案**，那才是注入该验的东西。
            const panel = document.querySelector('[role="dialog"]') || document.body;
            /**
             ⚠️ **不要把这个当成"登录成功"**：面板在**成功与失败**两种情况下都可能关掉，
             所以"`sync-signin-entry` 不见了"是个**假阳性**（实测 2026-09-30，
             注入那次它与权威判据相反）。权威判据只有一个：**`AUTH_STATE`**
             （它由 M2-D 那条链在登录之后重新点数菜单 IA 得出）。
             这里只报告"面板关没关"与**面板自己说的话**。
             */
            return (
              'PASTED panelClosed=' + !byTest('sync-signin-entry') + ' panel=' +
              (panel.textContent || '').split(/\\s+/).join(' ').slice(0, 140)
            );
            """
        }

        private static func field(_ json: String, _ name: String) -> Int {
            guard let data = json.data(using: .utf8),
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let n = obj[name] as? Int else { return 0 }
            return n
        }

        /// 取一个**字符串**字段（`field` 只管数值；身份菜单要读第一项的 testID）。
        private static func text(_ json: String, _ name: String) -> String {
            guard let data = json.data(using: .utf8),
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let s = obj[name] as? String else { return "" }
            return s
        }
    }
}

/// M2 的证据写入。**与 Windows 侧同一形状**：证据必须自述它是怎么来的。
func writeWebEvidence(_ note: String, storageFacts: [String]) {
    guard let path = ProcessInfo.processInfo.environment["HEYTA_M2_EVIDENCE"], !path.isEmpty else { return }
    let storage = storageFacts.joined(separator: "\n")
    let body = """
    WINDOW=heyta
    WEB_ROOT=\(ProcessInfo.processInfo.environment["HEYTA_WEB_ROOT"] ?? "")
    \(storage)
    M2_MACOS_NOTE=\(note)
    """
    try? body.write(toFile: path + ".txt", atomically: true, encoding: .utf8)
}

/// 壳的界面 —— 🔴 **它只有共享 UI，没有手写界面**。
///
/// ## 这里删掉了什么，以及为什么（2026-09-29）
///
/// 之前这个壳里有一份**手写的 SwiftUI 任务界面**（标题 / 输入框 / 添加按钮 /
/// 原生 `List` / 状态栏 / 页脚），而 M2 又在下半屏加了一个承载共享 UI 的 WebView ——
/// 于是窗口是**上下两半：上面是原生实现、下面是 web 实现**。
///
/// 那是 **spike 形态，不是产品形态**：当时留着手写那份，是为了在同一张截图里
/// 证明"原生控件与共享 UI 能并排"。但它带来两个真实代价：
///
/// 1. 🔴 **同一个窗口里有两份任务列表**，各自读各自的库 —— 用户看到的"我的任务"
///    取决于他看的是上半屏还是下半屏。产品负责人当场指出这是"离谱的设计"，是对的。
/// 2. 那份手写界面是 **ADR-0037 明确要淘汰的东西**（桌面 UI 走共享层），
///    留着它等于同时维护两份 UI，而其中一份注定要被删。
///
/// ⇒ 现在：**壳 = 窗口 + WebView**。界面全部来自 `apps/web` 的构建产物
///（与 web、以及 Windows 壳加载的是同一份），数据由那份 UI 自己拥有。
///
/// ## 壳还剩下什么职责
///
/// 只有**原生才拿得到的东西**：窗口、菜单、托盘、通知、URL scheme、钥匙串、
/// 文件关联。这个文件里现在体现为 `WKURLSchemeHandler`（把本地产物用**正常 origin**
/// 提供给 WebView）—— 见它的注释里那条"为什么不用 `file://`"。
struct ShellView: View {
    /// M2：共享 UI 的加载结论（前置登录入口是否可达、设置里的导入入口在不在）。
    @State private var webNote = ""

    /// 存储宿主（B）。**解析一次**，之后不再变 —— 它决定"注入不注入那个端口 shim"。
    @State private var storage: ShellStorageHostDecision = ShellStorageHost.decide()

    /// 宿主相关事实（`STORAGE_HOST=` / `STORAGE=` / 出错）。与 `webNote` 分开：
    /// 前者是给证据和排查的，后者是给人看的一句话。
    @State private var storageFacts: [String] = []

    /// 共享 UI 的产物目录。优先环境变量，否则找 app 包 `Contents/Resources/web-dist`。
    ///
    /// 🔴 必须在 **Contents/Resources**（`Bundle.main.resourceURL`），
    ///    不能放 bundle 根（`Heyta.app/web-dist`）：code signing 只封 `Contents/`，
    ///    根下的散目录让 `codesign` 直接报 "unsealed contents present in the
    ///    bundle root"，打不出有效签名（2026-09-30 实测）。
    @State private var webRoot: URL? = {
        if let env = ProcessInfo.processInfo.environment["HEYTA_WEB_ROOT"], !env.isEmpty {
            return URL(fileURLWithPath: env)
        }
        let inResources = Bundle.main.resourceURL?.appendingPathComponent("web-dist")
        if let dir = inResources, FileManager.default.fileExists(atPath: dir.path) {
            return dir
        }
        return nil
    }()

    /// 把"这一轮当不当宿主"拼在最前面 —— 证据里必须能看出**为什么**没走宿主那条路。
    private func factsWithHostLine() -> [String] {
        [storage.evidenceLine] + storageFacts
    }

    var body: some View {
        Group {
            if let root = webRoot {
                SharedWebView(
                    root: root,
                    storageHost: storage.host,
                    onProbe: { note in
                        webNote = note
                        writeWebEvidence(note, storageFacts: factsWithHostLine())
                    },
                    onStorageFact: { fact in
                        // 同一个键只留最后一条（`STORAGE=` 每次探测都会来一条）。
                        let key = fact.split(separator: "=", maxSplits: 1).first.map(String.init) ?? fact
                        storageFacts.removeAll { $0.hasPrefix(key + "=") }
                        storageFacts.append(fact)
                        writeWebEvidence(webNote, storageFacts: factsWithHostLine())
                    }
                )
                // 撑满窗口：这是壳里**唯一**的内容。
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                // 🔴 找不到产物时**必须说出来**，不能给一个空白窗口 ——
                // "窗口打开了但什么都没有"是这类壳最难排查的失败形态。
                VStack(spacing: HeytaTokens.Light.space3) {
                    Text("找不到共享 UI 产物")
                        .font(.system(size: HeytaTokens.Light.fontSizeLg, weight: .semibold))
                    Text("设置 HEYTA_WEB_ROOT 指向 apps/web/dist，或把 web-dist 放进 app 包的 Contents/Resources。")
                        .font(.system(size: HeytaTokens.Light.fontSizeSm))
                        .foregroundStyle(.secondary)
                }
                .padding(HeytaTokens.Light.space6)
            }
        }
        // 诊断用的一句话；`webNote` 为空时什么都不占位。
        .safeAreaInset(edge: .bottom) {
            if !webNote.isEmpty, ProcessInfo.processInfo.environment["HEYTA_M2_EVIDENCE"] != nil {
                Text(webNote)
                    .font(.system(size: HeytaTokens.Light.fontSizeXs))
                    .foregroundStyle(.secondary)
                    .padding(HeytaTokens.Light.space2)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }
}
