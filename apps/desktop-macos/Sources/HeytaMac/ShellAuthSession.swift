// `ASWebAuthenticationSession` 的封装 —— 只有它需要 AppKit/系统浏览器。
//
// 纯逻辑（回调解析 + state 校验）在 `HeytaShellCore/ShellAuth.swift`：
// 那一层才能在 `heyta-smoke` 里被单测，而这一层不行（可执行目标 + 需要图形会话）。

import AppKit
import AuthenticationServices
import Foundation
import HeytaShellCore

/// 起一次系统浏览器的授权，并把回调交回调用方。
///
/// ⚠️ `ASWebAuthenticationSession` 由系统**弹出**浏览器 —— 那一步无法自动化，
///    所以它由人完成；而回调之后的**解析 / 校验 / 交付**全部可自动验
///    （见 `HEYTA_AUTH_CALLBACK`：把一个回调 URL 直接喂进同一条处理函数）。
@MainActor
final class ShellAuthSession: NSObject, ASWebAuthenticationPresentationContextProviding {
    private var session: ASWebAuthenticationSession?
    private let onCallback: (URL) -> Void

    init(onCallback: @escaping (URL) -> Void) {
        self.onCallback = onCallback
    }

    func start(site: String, state: String) -> Bool {
        guard let url = ShellAuth.authorizationURL(site: site, state: state) else { return false }
        let session = ASWebAuthenticationSession(
            url: url,
            callbackURLScheme: ShellAuth.callbackScheme
        ) { [weak self] callback, _ in
            guard let callback else { return }
            self?.onCallback(callback)
        }
        session.presentationContextProvider = self
        // 不用共享的浏览器会话：这是**我们自己的**站点登录，不是第三方 OAuth。
        session.prefersEphemeralWebBrowserSession = false
        self.session = session
        return session.start()
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        ASWebAuthenticationSession.presentationAnchor(for: session)
    }
}

private extension ASWebAuthenticationSession {
    /// 系统给的锚点：拿不到就退回 key window，再退回首个可见窗口。
    static func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        let windows = NSApplication.shared.windows
        return windows.first(where: { $0.isKeyWindow })
            ?? windows.first(where: { $0.isVisible })
            ?? ASPresentationAnchor()
    }
}
