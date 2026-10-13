import Foundation

/**
 应用进程与扩展进程**必须逐字符一致**的那几个字符串。
 ======================================================

 ## 🔴 为什么这些常量必须在 Core 里，而不是各写一份

 这些字符串跨**两个 target、两个进程、两份 entitlements**：

 | 字符串 | 写在哪几处 |
 |---|---|
 | App Group id | 两份 `.entitlements`（应用 + 扩展）、读容器的代码 |
 | Keychain service / access group | 两份 entitlements 的 `keychain-access-groups`、读密钥的代码 |
 | 文件名 | 应用写、扩展读 |

 **不一致的表现全部是"静默降级"**：`containerURL(forSecurityApplicationGroupIdentifier:)`
 返回 `nil` → 组件显示"打开 Heyta"（不是崩溃）；Keychain 查询返回
 `errSecMissingEntitlement` → 密钥读不到 → 同一个占位符。

 也就是说，**配错了和"应用还没发布过快照"看起来一模一样**。
 所以这些字符串只能有**一处声明** —— 这就是这一处。

 ⚠️ Keychain 访问组必须由构建期展开并写入专用的 Info.plist 键
 `HeytaWidgetKeychainAccessGroup`。运行时绝不能把未展开的
 `$(AppIdentifierPrefix)` 当成真实访问组，也不能在缺失时退回默认组：那会把
 配置错误伪装成组件没有数据，并且在不同 target 上得到不同结果。
 */
public enum WidgetSharedConstants {

    public static var appGroupId: String {
        // Developer ID macOS groups use the signing team prefix. iOS keeps its registered group.
        Bundle.main.object(forInfoDictionaryKey: "HeytaWidgetAppGroupIdentifier") as? String
            ?? "group.com.heyta"
    }

    public static let appBundleId = "com.heyta"
    public static let widgetExtensionBundleId = "com.heyta.WidgetExtension"

    /// Keychain 条目的 service / account。
    public static let keychainService = "com.heyta.widget-key"
    public static let keychainAccount = "widget-snapshot-key"

    public static let keychainAccessGroupInfoKey = "HeytaWidgetKeychainAccessGroup"

    public enum ConfigurationError: Error, Equatable {
        case missingKeychainAccessGroup
        case unresolvedKeychainAccessGroup(String)
        case invalidKeychainAccessGroup(String)
    }

    /// 返回构建期已经展开的完整访问组。缺失、占位符残留、或格式非法都必须失败。
    public static func resolvedKeychainAccessGroup() throws -> String {
        guard let raw = Bundle.main.object(forInfoDictionaryKey: keychainAccessGroupInfoKey) as? String,
              !raw.isEmpty else {
            throw ConfigurationError.missingKeychainAccessGroup
        }
        guard !raw.contains("$(") && !raw.contains(")") else {
            throw ConfigurationError.unresolvedKeychainAccessGroup(raw)
        }
        guard raw.range(of: #"^[A-Za-z0-9.-]+\.[A-Za-z0-9.-]+$"#, options: .regularExpression) != nil else {
            throw ConfigurationError.invalidKeychainAccessGroup(raw)
        }
        return raw
    }

    public static let snapshotFileName = "widget-snapshot.json"
    public static let intentQueueFileName = "widget-intents.json"

    /// W5-2 · 锁屏隐私偏好。见 `WidgetPrivacyPreference`。
    ///
    /// ⚠️ 单独一个文件，而不是塞进快照：快照会被**频繁覆盖**（每次发布新的一天），
    /// 而偏好是用户设置。混在一起的话，"发布快照"会顺手把用户的隐私开关重置回默认 ——
    /// 而这**没有任何症状**，直到某天用户的锁屏上出现了不该出现的标题。
    public static let privacyFileName = "widget-privacy.json"
}
