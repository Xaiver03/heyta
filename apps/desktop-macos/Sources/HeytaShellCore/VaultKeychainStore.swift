// "钥匙放在设备里"的 **macOS 实现**（ADR-0080 §5.4 / §5.5）。
//
// 这里是**唯一**一份 SecItem 调用。`ShellVaultKeychainBridge.swift` 只做收发，
// `heyta-smoke` 只做取证 —— 谁都不许再写第二份（与 `tools/` 那条"没有第二次实现"同一条纪律）。
//
// 🔴 它与 `apps/node-host/src/keychain-secret-store.ts`（`security -i`）是**两套东西**：
//    那是 Windows/Linux/macOS 的 **Node 壳**在用的通用秘密存储；
//    这一份是 macOS **Swift 壳**给页侧 vault root 用的，走 Keychain Services API，
//    因为 WKWebView 里够不着命令行。两者语义相同（按作用域存取、删得掉），实现不同。
//
// 🔴 三条写死的属性，每一条都有理由，改之前先看：
//   · **不用 `WhenUnlockedThisDeviceOnly`**（2026-11-02 实测后放弃，理由在这里）：
//     iOS 那份用的是 `whenUnlockedThisDeviceOnly`（`verify-ios-vault-keychain.sh` 报
//     `accessible: ["aku","aku"]`）。照抄到 macOS **不会生效**：
//     ① 传统（文件）钥匙串**忽略** `kSecAttrAccessible` —— 写的时候传 `…ThisDeviceOnly`、
//        读写照样通，但用 `kSecReturnAttributes` 读回来的字典里**根本没有这一枚**；
//     ② 想让它生效必须用**数据保护钥匙串**（`kSecUseDataProtectionKeychain: true`），
//        而那需要 `keychain-access-groups` 授权 —— 实测无授权的进程拿到
//        `errSecMissingEntitlement (-34018)`，连存都存不进去。
//     ⇒ macOS 现在给的是"**锁屏读不到** + **不进 iCloud 钥匙串**"（`WhenUnlocked` +
//       `kSecAttrSynchronizable=false`，后者传统钥匙串**是**认的），
//       但给不了 iOS 那条"不随备份恢复到另一台机器"。这条差异写进计划 §15.6，
//       **不假装两端一致**。
//   · `kSecAttrAccessibleWhenUnlocked` —— 锁屏期间读不到，页侧退"请解锁"（降级不崩）。
//     换成 `AfterFirstUnlock` 会让关机重启后后台也能解开，那不是这里要的东西。
//   · 长度必须 32 字节 —— vault root 恒为 32。长度不对就是坏数据，**不猜**（与页侧同一条）。

import Foundation
import Security

public struct VaultKeychainStore {
    public init() {}

    /// 一个 keychain 条目服务名。改它等于让所有人"重新输一次口令"，不要随手改。
    public static let service = "cloud.finlaw.heyta.vault-root"

    public enum Outcome: Equatable {
        case ok
        case absent
        case failed(OSStatus)
    }

    /// 作用域：同一台机器上两个账号 / 两个服务端互不可见（与页侧 `vault-root-keychain.ts` 同构）。
    private static func account(_ serverOrigin: String, _ accountId: String) -> String {
        "\(serverOrigin)\u{0}\(accountId)"
    }

    private static func query(_ serverOrigin: String, _ accountId: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account(serverOrigin, accountId),
            kSecAttrSynchronizable as String: false,
        ]
    }

    /// 读一枚 root。`nil` 覆盖了"没存过"与"形状不对"两种情况 ——
    /// 页侧对两者是**同一处理**（都要口令），但 `outcome` 让取证能分开记。
    public func load(serverOrigin: String, accountId: String) -> (value: String?, outcome: Outcome) {
        var request = Self.query(serverOrigin, accountId)
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &item)
        if status == errSecItemNotFound { return (nil, .absent) }
        guard status == errSecSuccess else { return (nil, .failed(status)) }
        guard let data = item as? Data, data.count == 32 else { return (nil, .absent) }
        return (data.base64EncodedString(), .ok)
    }

    /// 写一枚 root（有则更新、无则新增）。
    @discardableResult
    public func save(serverOrigin: String, accountId: String, value: String) -> Outcome {
        guard let data = Data(base64Encoded: value), data.count == 32 else { return .absent }
        let query = Self.query(serverOrigin, accountId)
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlocked,
        ]
        let updateStatus = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if updateStatus == errSecSuccess { return .ok }
        guard updateStatus == errSecItemNotFound else { return .failed(updateStatus) }
        var insert = query
        insert.merge(attributes) { _, new in new }
        let addStatus = SecItemAdd(insert as CFDictionary, nil)
        return addStatus == errSecSuccess ? .ok : .failed(addStatus)
    }

    /// 读条目上**实际生效**的属性，一次给三个事实：查询状态、同步位、可访问性位。
    ///
    /// 存在的理由：这两条**不会**在存取失败时暴露 ——
    /// 写的时候传错一档，读写照样通，只有属性不同：
    /// - `synchronizable`：**是不是会跟着 iCloud 钥匙串走**（传统钥匙串认这一位）；
    /// - `accessible`：可访问性等级（**传统钥匙串忽略且不回报**，所以它多半是 `nil`，
    ///   那不代表写错了，代表这一档在这个钥匙串里不存在 —— 见文件头的说明）。
    public func readableAttributes(
        serverOrigin: String, accountId: String,
    ) -> (status: OSStatus, synchronizable: Bool?, accessible: String?) {
        var request = Self.query(serverOrigin, accountId)
        request[kSecReturnAttributes as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &item)
        guard status == errSecSuccess, let attributes = item as? NSDictionary else {
            return (status, nil, nil)
        }
        return (status,
                attributes[kSecAttrSynchronizable] as? Bool,
                attributes[kSecAttrAccessible] as? String)
    }

    /// 删。`errSecItemNotFound` 算成功：要的是"之后读不到"，本来就没有也算。
    @discardableResult
    public func clear(serverOrigin: String, accountId: String) -> Outcome {
        let status = SecItemDelete(Self.query(serverOrigin, accountId) as CFDictionary)
        if status == errSecSuccess || status == errSecItemNotFound { return .ok }
        return .failed(status)
    }
}
