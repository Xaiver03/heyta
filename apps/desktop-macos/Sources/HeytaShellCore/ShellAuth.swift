// 桌面壳的**反向授权**（ADR-0039 §2.3）—— macOS 侧。
//
// ## 为什么壳不自己做通行密钥
//
// 实测（`apps/desktop-macos/evidence/storage-host/webauthn-*.txt`）：
// 壳里带焦点时 `isUserVerifyingPlatformAuthenticatorAvailable() == false`，
// 不带焦点则是 `NotAllowedError: The document is not focused`（而取证脚本
// 按 AGENTS §6.2 恰恰**不该**抢焦点）。硬件已排除（`bioutil -r` 正常）。
// ⇒ 通行密钥交给**系统浏览器**：我们的站点跑在正常 https origin 上，那里好用。
//
// ## 链路
//
// ```
// 壳：生成一次性 state → ASWebAuthenticationSession 打开 <站点>/?auth=desktop&state=<state>
// 浏览器：用户用应用自己的 UI 登录（通行密钥 / 邮箱链接都行）
// 应用：回跳 heyta://auth#token=<JWT>&state=<state>
// 壳：**校验 state** → 把令牌交给页侧既有登录路径（sessionStorage + reload）
// ```
//
// 🔴 **令牌在 fragment 里**（`#` 之后）：它不会发给服务器、不进 Referer、不进访问日志。
//    所以壳**只认 fragment** —— 出现在 query 里的令牌一律拒绝（那是会漏的那条道）。
//
// 🔴 **`state` 是安全边界**：不校验就等于允许任意网页把令牌塞进壳。

import Foundation

/// 回调解析的结果。**判别式** —— 拒绝时必须带原因，否则排查只能靠猜。
public enum ShellAuthCallback {
    case ok(token: String, state: String)
    case rejected(reason: String)
}

public enum ShellAuth {
    /// 回跳 scheme。⚠️ 与 `apps/web/src/features/auth/desktop-handoff.ts` 里的
    /// `DESKTOP_CALLBACK_SCHEME` **必须一致**（那边也有测试盯着它）。
    public static let callbackScheme = "heyta"
    /// 桌面授权模式的 query 参数（与 web 侧一致）。
    public static let authParam = "auth"
    public static let stateParam = "state"
    public static let authMode = "desktop"

    /// 生成一次性 `state`。用系统随机数，不用时间戳 —— 时间戳是可猜的。
    public static func makeState() -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return bytes.map { String(format: "%02x", $0) }.joined()
    }

    /// 拼授权起点：`<站点>/?auth=desktop&state=<state>`。
    public static func authorizationURL(site: String, state: String) -> URL? {
        var comps = URLComponents(string: site)
        comps?.queryItems = [
            URLQueryItem(name: authParam, value: authMode),
            URLQueryItem(name: stateParam, value: state),
        ]
        return comps?.url
    }

    /**
     **解析并校验回调 URL —— 纯函数**（不碰 UI、不碰网络，所以它能在冒烟里被单测）。

     拒绝的四种情形，每一种都必须拒绝：
      1. scheme 不是 `heyta`（别的应用/网页想喂我们一个回调）；
      2. **令牌出现在 query 里**（见文件头：fragment 之外的通道会漏）；
      3. 没有令牌；
      4. **`state` 与壳发出去的那个不一致**（这是唯一挡住"任意网页把令牌塞进壳"的一格）。
     */
    public static func parseCallback(_ url: URL, expectedState: String) -> ShellAuthCallback {
        guard url.scheme?.lowercased() == callbackScheme else {
            return .rejected(reason: "scheme 不是 \(callbackScheme)（读到 \(url.scheme ?? "空")）")
        }
        if url.query != nil {
            return .rejected(reason: "令牌出现在 query 里 —— 只接受 fragment（query 会进 Referer 与日志）")
        }
        let fragment = url.fragment ?? ""
        guard !fragment.isEmpty else {
            return .rejected(reason: "没有 fragment（令牌应当在 '#' 之后）")
        }

        var items: [String: String] = [:]
        for pair in fragment.split(separator: "&") {
            let kv = pair.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
            guard kv.count == 2 else { continue }
            items[String(kv[0])] = String(kv[1]).removingPercentEncoding ?? String(kv[1])
        }

        let state = items[stateParam] ?? ""
        if state == "" {
            return .rejected(reason: "回调里没有 state")
        }
        if state != expectedState {
            return .rejected(reason: "state 与本次发起的不一致 —— 拒绝（可能是别人构造的回调）")
        }
        let token = items["token"] ?? ""
        if token == "" {
            return .rejected(reason: "回调里没有令牌")
        }
        return .ok(token: token, state: state)
    }
}

