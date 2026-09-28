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

 ⚠️ 注意：`keychainAccessGroup` 里的前缀是 **`$(AppIdentifierPrefix)`**，
 在真实工程里由 entitlements 展开成 `TEAMID.com.heyta.mobile.shared`。
 这里存的是**不带 TeamID** 的部分，Keychain 查询时**必须**带上完整形式
 （见 `WidgetKeychainQuery`）—— 直接拿这个常量去查会得到 `errSecMissingEntitlement`。
 这是一个很容易在真机上才发现的坑，所以把完整形式的拼法也放在这里。
 */
public enum WidgetSharedConstants {

    public static let appGroupId = "group.com.heyta.mobile"

    public static let appBundleId = "com.heyta.mobile"
    public static let widgetExtensionBundleId = "com.heyta.mobile.WidgetExtension"

    /// Keychain 条目的 service / account。
    public static let keychainService = "com.heyta.mobile.widget-key"
    public static let keychainAccount = "widget-snapshot-key"

    /// **不带 TeamID** 的访问组后缀。
    public static let keychainAccessGroupSuffix = "com.heyta.mobile.shared"

    /// 完整的访问组 = `$(AppIdentifierPrefix)` + 后缀。
    ///
    /// 🔴 `AppIdentifierPrefix` 只能在**签名后的**二进制里才被展开成真值
    /// （它是一个 entitlements 占位符，不是一个环境变量），所以运行时**读不到**它。
    /// 唯一的办法是从**自己的 entitlements** 里把 `keychain-access-groups` 的第一项
    /// 读出来 —— 那是系统已经展开好的值。
    ///
    /// 拿不到时返回 `nil`，调用方应当**不带** `kSecAttrAccessGroup` 去查
    /// （那会退化成"本 target 自己的默认访问组"，在同一个 team 里通常仍能命中
    /// 应用写的那一条 —— 因为两者共享同一个 `$(AppIdentifierPrefix)`）。
    /// 这个降级是**有意的**：宁可"可能命中"也不要"肯定查不到"。
    public static func resolvedKeychainAccessGroup() -> String? {
        guard
            let groups = Bundle.main.object(forInfoDictionaryKey: "keychain-access-groups") as? [String],
            let first = groups.first(where: { $0.hasSuffix(keychainAccessGroupSuffix) })
        else {
            return nil
        }
        return first
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
