import Foundation
import Security

import HeytaWidgetCore

/**
 设备密钥的**生成**侧（Keychain）。**只在应用进程里。**
 ======================================================

 ## 🔴 为什么 `getOrCreate` 在桥接 target，而不在扩展 target

 扩展侧那个 `WidgetDeviceKey` **只有 `read()`**，这是刻意的（见它的注释）：
 如果扩展也能"没有就创建"，就会出现**两把不同的密钥**，
 而症状是"解密永远失败、且永远修不好"。

 所以"创建"这件事只允许在**应用进程**里发生 —— 而它被放进这个 target
 而不是 Core，是为了让**类型系统**帮忙：扩展 target 依赖 Core + UI，
 **不**依赖 Bridge，所以扩展里根本写不出 `getOrCreate()` 这个调用。
 这比"注释里说不要用"强得多。

 ## 可访问性等级：`kSecAttrAccessibleAfterFirstUnlock`

 | 等级 | 重启后未首次解锁 | 组件能读吗 |
 |---|---|---|
 | `WhenUnlocked` | 读不到 | 锁屏时读不到 → 组件显示占位 |
 | **`AfterFirstUnlock`** | 读不到（同上） | ✅ 锁屏也能读（首次解锁之后） |
 | `Always` | 可读 | ❌ 被 App Review 质疑，且确实过宽 |

 选中间那个。理由与文件保护等级那次**完全一样**（见 `WidgetSharedStore`）：
 三者在"重启后、首次解锁前"的表现**都一样**（读不到），
 所以选 `AfterFirstUnlock` **没有**牺牲那个窗口，
 而它让"用户锁屏时组件仍能显示"成为可能 —— 那是组件的**主要使用场景**。

 用 `WhenUnlocked` 的话组件只在解锁瞬间有内容，实际上等于没有组件。

 ## 🔴 同一把密钥的"两个 target 都能读到"靠的是访问组，不是共享 Keychain

 iOS 没有"共享 Keychain"这种东西 —— 共享靠的是
 `kSecAttrAccessGroup` 指向一个**两个 target 的 entitlements 里都声明过**的访问组。
 配错了的表现是 `errSecMissingEntitlement`（-34018），
 而它**不会崩溃**，只会让密钥读不到 → 组件显示"打开 Heyta"。
 */
public struct WidgetDeviceKeyStore: WidgetBridgeService.KeyStore {

    public init() {}

    /// 读；没有就生成一把并写进去。
    public func getOrCreate() throws -> Data {
        if let existing = try readThrowing() { return existing }

        // 32 字节 —— 与 `widgetKeyBytes` 一致。
        var bytes = [UInt8](repeating: 0, count: widgetKeyBytes)
        let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        guard status == errSecSuccess else {
            throw Failure.randomUnavailable(status)
        }
        let key = Data(bytes)

        // 🔴 `kSecAttrAccessibleAfterFirstUnlock`（理由见文件头）。
        // 🔴 `kSecAttrAccessGroup` 用**运行时解析出来的完整形式**
        //    （`AppIdentifierPrefix` 是 entitlements 占位符，代码里读不到）。
        var add: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: WidgetSharedConstants.keychainService,
            kSecAttrAccount as String: WidgetSharedConstants.keychainAccount,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
            kSecValueData as String: key,
        ]
        #if os(macOS)
        add[kSecUseDataProtectionKeychain as String] = true
        #endif
        add[kSecAttrAccessGroup as String] = try accessGroup()

        let addStatus = SecItemAdd(add as CFDictionary, nil)
        if addStatus == errSecDuplicateItem {
            // 竞态：另一个线程/进程刚好也创建了。
            // ⚠️ **不要**在这里覆写 —— 覆写会让对方刚加密的快照变成解不开。
            //    读回已经存在的那一把。
            guard let raced = try readThrowing() else { throw Failure.keychain(addStatus) }
            return raced
        }
        guard addStatus == errSecSuccess else { throw Failure.keychain(addStatus) }

        // 读回来验证一次：写进去的必须真的能读出来。
        // ⚠️ 这一步不是多余的 —— 访问组配错时 `SecItemAdd` 可能成功而
        //    `SecItemCopyMatching` 失败（或者反过来，取决于 entitlement 的形状）。
        //    在**写入点**发现比在"组件没数据"时发现便宜得多。
        guard let written = try readThrowing() else { throw Failure.keychain(addStatus) }
        return written
    }

    /// 读。配置错误、设备没解锁或密钥不存在都按扩展侧的空结果处理；不会退回默认组。
    public func read() -> Data? {
        try? readThrowing()
    }

    private func readThrowing() throws -> Data? {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: WidgetSharedConstants.keychainService,
            kSecAttrAccount as String: WidgetSharedConstants.keychainAccount,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
            kSecAttrAccessGroup as String: try accessGroup(),
        ]
        #if os(macOS)
        query[kSecUseDataProtectionKeychain as String] = true
        #endif

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess, let data = item as? Data, data.count == widgetKeyBytes else {
            return nil
        }
        return data
    }

    /// 删除。**不存在的条目也算成功** —— 登出流程要幂等；配置或 Keychain 错误必须抛出。
    public func delete() throws {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: WidgetSharedConstants.keychainService,
            kSecAttrAccount as String: WidgetSharedConstants.keychainAccount,
            kSecAttrAccessGroup as String: try accessGroup(),
        ]
        #if os(macOS)
        query[kSecUseDataProtectionKeychain as String] = true
        #endif
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw Failure.keychain(status)
        }
    }

    private func accessGroup() throws -> String {
        try WidgetSharedConstants.resolvedKeychainAccessGroup()
    }

    public enum Failure: Error, Equatable {
        case randomUnavailable(OSStatus)
        case keychain(OSStatus)
    }
}
