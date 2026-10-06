// B：把**页侧真应用**的存储托管到**壳自己的 SQLite**（macOS 侧）。
//
// 与 Windows 的 `MainWindow.xaml.cs` 是同一形状。壳只做三件事：
//
//   1. 在应用加载**之前**注入端口 shim（`window.__heytaHostStoragePort`）；
//   2. 把页侧发来的消息转给 TS（`AppApi.handleHostMessage`），并把返回的**每一串**回推；
//   3. 把库打开给页侧用（`AppApi.openOpLog`，**不建引擎** —— 引擎归页侧）。
//
// 🔴 壳**不解析任何协议字段**：不认 `hello`、不认 `ready`、不认任何请求形状。
//    "收一条回几条"由 TS 决定（`native-bridge.ts` 的 `handleHostMessage`），
//    在 Swift 这边认字段就等于分叉出第二份实现。

import Foundation
import HeytaShellCore

/// 存储宿主的解析结果。**"没开"必须带原因** —— 否则下一个人只看到"没生效"。
enum ShellStorageHostDecision {
    case hosting(ShellStorageHost)
    case off(reason: String)

    var host: ShellStorageHost? {
        if case let .hosting(host) = self { return host }
        return nil
    }

    /// 写进证据的一行（与 Windows 的 `STORAGE_HOST=` 同义）。
    var evidenceLine: String {
        switch self {
        case .hosting: return "STORAGE_HOST=on"
        case let .off(reason): return "STORAGE_HOST=off（\(reason)）"
        }
    }
}

struct ShellStorageHost {
    let bundlePath: String
    let dbPath: String

    /// 页侧看到的就是这个对象。**形状必须与 Windows 那份逐字同构**：
    /// `postMessage` + `addEventListener`，因为页侧的线码端口只认这两样
    /// （见 `packages/storage/src/sqlite/oplog-wire-codec.ts` 的 `createOpLogWirePort`）。
    ///
    /// ⚠️ 它**不解析**消息：原样交给 `WKNavigationDelegate` 那侧的
    /// `userContentController(_:didReceive:)`。
    static let portShim = """
    window.__heytaHostStoragePort = {
      postMessage: function (message) {
        window.webkit.messageHandlers.heytaStorage.postMessage(message);
      },
      addEventListener: function (type, listener) {
        window.addEventListener(type, listener);
      },
    };
    """

    /// 解析"这一轮要不要当存储宿主、以及拿什么当"。
    ///
    /// 返回 `.off` 的三种情况，每一种都**必须如此**：
    ///
    ///  1. 显式关掉（`HEYTA_SHELL_STORAGE=0`）—— 逃生门，与 Windows 同语义。
    ///  2. 🔴 **找不到桥的 bundle**。这一条最要紧：**shim 是一句承诺**
    ///     （"这个宿主能提供 SQLite"），而页侧一旦看见端口就**必然**走 `shell` 后端。
    ///     承诺了却兑现不了 ⇒ 应用**永久卡在启动**，而且那不是报错、是"什么都不发生"。
    ///     所以"能兑现"是注入的前提 —— 宁可退回页侧自己的库，也不要卡住。
    ///  3. 库目录建不出来（磁盘 / 权限）。同理：不能承诺。
    ///
    /// ⚠️ 顺序也是刻意的：**先确认有能力，再决定开**。
    static func decide() -> ShellStorageHostDecision {
        let env = ProcessInfo.processInfo.environment

        if env["HEYTA_SHELL_STORAGE"] == "0" {
            return .off(reason: "HEYTA_SHELL_STORAGE=0")
        }

        guard let bundlePath = resolveBundlePath(env) else {
            return .off(reason: "找不到 native-bridge.js（先跑 packages/app-host/scripts/build-native-bridge.mjs，或设 HEYTA_BRIDGE_BUNDLE）")
        }

        // 库放 Application Support：这是 macOS 上"应用自己拥有的数据"的既定位置。
        // ⚠️ 与 Windows 的 `%LOCALAPPDATA%\heyta\heyta.sqlite` 是**同一个角色**、
        //    不同平台的位置 —— 两边的真机判据都是"从壳外读这个文件"。
        //
        // 🔴 `HEYTA_SHELL_DB_DIR=<绝对路径>`：把库目录整体挪走。**它存在的理由不是方便，是安全**：
        //    界面级的注销判据要**真的删掉这个文件**，而默认路径是用户本机那一份真库
        //    （计划 §10.70 ① 现量：81,920 B）。没有这个旋钮，那条判据只能拿用户的真数据做实验 ——
        //    所以这一格的阻塞从来不是"要不要注销"，是"缺一个隔离面"（§10.70 ④）。
        //    默认分支的表达式**逐字不变**；只接受绝对路径，因为"相对谁的 cwd"在 .app 里
        //    没有确定参照，静默猜会把验收写进用户目录。
        let dir: URL
        if let override = env["HEYTA_SHELL_DB_DIR"], !override.isEmpty {
            guard override.hasPrefix("/") else {
                return .off(reason: "HEYTA_SHELL_DB_DIR 必须是绝对路径（实测值：\(override)）—— 不猜参照目录")
            }
            dir = URL(fileURLWithPath: override, isDirectory: true)
        } else {
            let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)
            guard let base = support.first else {
                return .off(reason: "拿不到 Application Support 目录")
            }
            dir = base.appendingPathComponent("heyta", isDirectory: true)
        }
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        } catch {
            return .off(reason: "建库目录失败：\(error.localizedDescription)")
        }

        return .hosting(
            ShellStorageHost(
                bundlePath: bundlePath,
                dbPath: dir.appendingPathComponent("heyta.sqlite").path
            )
        )
    }

    /// 桥的 bundle：先看环境变量（`swift run` / 验收脚本用），否则找 app 包里的。
    ///
    /// 与 `ShellView` 找 `web-dist` 的规则**同构**（环境变量 → `Contents/Resources`），
    /// 因为这两样在打包时都被放进 `Contents/Resources`（见 `scripts/package-app.sh`）。
    private static func resolveBundlePath(_ env: [String: String]) -> String? {
        if let path = env["HEYTA_BRIDGE_BUNDLE"], !path.isEmpty,
           FileManager.default.fileExists(atPath: path) {
            return path
        }
        let inResources = Bundle.main.resourceURL?.appendingPathComponent("native-bridge.js")
        if let path = inResources?.path, FileManager.default.fileExists(atPath: path) {
            return path
        }
        return nil
    }
}
