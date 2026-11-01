// 页侧 → 壳的**钥匙串腿**（`webkit.messageHandlers.heytaVaultKeychain`）。
//
// 🔴 这个文件存在的全部理由：macOS 壳是 `WKWebView` 载 `web-dist`，而 VAT 那套
//    "钥匙放在设备里"（ADR-0080 §5.4）在 Web 上只有 `sessionStorage` —— 它活到**标签页关闭**。
//    壳里那个"标签页"就是进程本身，所以**关掉 App 再打开就要重新输口令**。
//    OS 钥匙串只从原生侧够得着 ⇒ 这一米必须由页侧**问壳要一次**。
//
// 🔴 边界（AGENTS §3.5）：本文件没有一行在判"什么时候该记住钥匙"。
//    `device` / `ask` 那个偏好、轮换未满足时不记、登出即清 —— 全在页侧
//    （`apps/web/src/lib/vault-root-keychain.ts` 与 `vault-session.ts`），与移动端同一契约。
//    这里只做三件事：按 (serverOrigin, accountId) 存取一枚 **32 字节**的值、删掉它、如实回答成没成。
//
// 🔴 **绝不落日志**：这一枚能解开全部历史。`save` 的入参连长度都不记，
//    只记 `SAVED` / `FAILED(<status>)`。
//
// ⚠️ 可访问性用 `kSecAttrAccessibleWhenUnlocked`（不是 `AfterFirstUnlock`）：
//    锁屏期间读不到 ⇒ 页侧退回"请解锁"，**不是崩**，这正是计划里那条降级判据。
//    显式 `kSecAttrSynchronizable = false`：这把钥匙**不进 iCloud Keychain**，
//    否则"服务器看不到明文"会变成"苹果也能拿到一份"。

import Foundation
import HeytaShellCore
import WebKit

@MainActor
final class ShellVaultKeychainBridge: NSObject, WKScriptMessageHandlerWithReply {
    /// 取证用的单向回调：每次动作落一行（**不含任何密钥材料**）。
    var onFact: ((String) -> Void)?

    /// 真正干活的那一层在 `HeytaShellCore/VaultKeychainStore.swift` ——
    /// 本文件只做收发与取证，**不写第二份 SecItem 调用**（冒烟测试验的就是那一份）。
    private let store = VaultKeychainStore()

    /// 注入到页面的那座桥。**只在壳里存在** —— 普通浏览器里 `window.heytaVaultKeychain` 是 `undefined`，
    /// 页侧据此退回 `sessionStorage`（ADR-0080 §5.4 的 Web 行为不变）。
    static let shim = """
    (() => {
      const call = (method, args = []) => window.webkit.messageHandlers.heytaVaultKeychain.postMessage({method, args});
      window.heytaVaultKeychain = Object.freeze({
        load: (serverOrigin, accountId) => call('load', [serverOrigin, accountId]),
        save: (serverOrigin, accountId, value) => call('save', [serverOrigin, accountId, value]),
        clear: (serverOrigin, accountId) => call('clear', [serverOrigin, accountId]),
      });
    })();
    """

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping @MainActor @Sendable (Any?, String?) -> Void
    ) {
        guard message.frameInfo.isMainFrame,
              message.frameInfo.securityOrigin.protocol == "heyta-local",
              message.frameInfo.securityOrigin.host == "app",
              let body = message.body as? [String: Any],
              let method = body["method"] as? String,
              let args = body["args"] as? [Any] else {
            replyHandler(nil, "Vault keychain bridge rejected origin or malformed message")
            return
        }

        switch method {
        case "load":
            guard args.count == 2, let origin = args[0] as? String, let accountId = args[1] as? String else {
                replyHandler(nil, "load needs [serverOrigin, accountId]")
                return
            }
            let result = store.load(serverOrigin: origin, accountId: accountId)
            onFact?("VAULT_ROOT_LOAD=\(result.outcome == .ok ? "present" : "absent")")
            replyHandler(result.value, nil)

        case "save":
            guard args.count == 3, let origin = args[0] as? String, let accountId = args[1] as? String,
                  let value = args[2] as? String else {
                replyHandler(false, "save needs [serverOrigin, accountId, value]")
                return
            }
            let result = store.save(serverOrigin: origin, accountId: accountId, value: value)
            // ⚠️ 只记成败，**不记值、不记长度**。
            onFact?("VAULT_ROOT_SAVE=\(result == .ok ? "ok" : "failed")")
            replyHandler(result == .ok, nil)

        case "clear":
            guard args.count == 2, let origin = args[0] as? String, let accountId = args[1] as? String else {
                replyHandler(nil, "clear needs [serverOrigin, accountId]")
                return
            }
            let result = store.clear(serverOrigin: origin, accountId: accountId)
            onFact?("VAULT_ROOT_CLEAR=\(result == .ok ? "ok" : "failed")")
            replyHandler(result == .ok, nil)

        default:
            replyHandler(nil, "Vault keychain bridge: unknown method '\(method)'")
        }
    }
}
