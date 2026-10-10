import Foundation
import Security

// ⚠️ 这个文件（`WidgetSharedStore` + `WidgetDeviceKey`）**原本在 `HeytaWidgetKit`**。
//    那是错的：它是**三端共用**的基础设施 —— iOS 主屏扩展、macOS 扩展、
//    **以及 watchOS 扩展**都要读同一份快照。放在 iOS 专用的 Kit target 里，
//    手表端根本 import 不到它（`HeytaWidgetWatch` 不依赖 `HeytaWidgetKit`，
//    也不该依赖 —— 它只需要读容器，不需要 iOS 的配置）。
//
//    搬到 `HeytaWidgetCore` 之后，"谁能读容器"这件事只有一个答案。

/**
 扩展侧对共享容器的访问 —— **一层薄包装**。
 ================================================

 ## 🔴 真正干活的是 `WidgetContainerFiles`

 文件路径、文件保护等级、`NSFileCoordinator` 的读-改-写，全都在 Core 里。
 这里只负责"扩展侧需要哪几个操作"。

 第一版我把这些都写在扩展侧，然后又需要在应用侧再写一遍（写快照、drain、清空）——
 而两份实现里必然漂移的那一份是**扩展侧**（更难调试的那一侧）。
 所以现在文件访问只有一处（`WidgetContainerFiles`），两边都走它。

 ## 🔴 取名字这件事本身也收敛了

 路由、Keychain service、文件名这些字符串跨**两个 target、两个进程、两份 entitlements**，
 不一致的表现全部是**静默降级**（显示"打开 Heyta"，不崩溃、不报错）。
 它们现在只在 `WidgetSharedConstants` 里声明一次。
 */
public enum WidgetSharedStore {

    public static func readSnapshot() -> Data? {
        WidgetContainerFiles.readSnapshot()
    }

    /// 读意图队列。读不到 / 坏数据 → 空队列（与四端解析器同一策略）。
    public static func readIntentQueue() -> WidgetIntentQueue {
        guard let raw = WidgetContainerFiles.readIntentQueueRaw() else { return .empty }
        return WidgetIntentQueues.parse(Data(raw.utf8))
    }

    /**
     把一条点击意图合并进队列并写回。**这是扩展唯一会写的东西。**

     读-改-写由 `WidgetContainerFiles.updateIntents` 在 `NSFileCoordinator`
     的临界区里完成 —— 应用进程可能正在同时 drain。
     不协调的话，"我明明点了两下，只有一下生效"，而日志里什么都没有。
     */
    /**
     W5-2 · 读锁屏隐私偏好。

     ⚠️ 读不到 / 坏数据 → **默认值**（交给系统的 `.privacySensitive()`），
     而不是 fail closed 到"全都藏起来"。理由见 `WidgetPrivacyPreference.parse`：
     这条路径上的坏数据（文件没写、App Group 没配好）**恰恰是最常见的**，
     而"藏起来"会让一个**配置问题**表现成**产品问题**。
     */
    public static func readPrivacyPreference() -> WidgetPrivacyPreference {
        WidgetPrivacyPreference.parse(WidgetContainerFiles.readPrivacyRaw())
    }

    public static func mergeIntent(_ intent: WidgetIntent) {
        WidgetContainerFiles.updateIntents { current in
            WidgetIntentQueues.merge(current, intent)
        }
    }
}

/**
 设备密钥的**读取**（Keychain）。**这一侧只读，绝不创建。**
 =============================================================

 密钥由**应用侧**在第一次发布快照时生成（随机 32 字节）并写进 Keychain。

 ## 🔴 为什么扩展侧没有 `getOrCreate`

 如果扩展也能"没有就创建"，就会出现**两把不同的密钥**，
 而症状是**解密永远失败、且永远修不好**：

 ```
 1. 组件先醒来，发现没有密钥 → 创建 K1
 2. 应用后醒来，也发现"没有"（时序 / 读到了不同的访问组）→ 创建 K2、覆写
 3. 应用用 K2 加密快照；组件缓存的是 K1 → **永远显示"打开 Heyta"**
 ```

 最常见的失败形状是反过来的：组件读到了 K1、应用轮换到 K2 ——
 用户打开了应用、应用一切正常，只有组件永远没数据。那种 bug 极难定位。

 所以"创建"被放进 `HeytaWidgetBridge` 那个 target，而**扩展 target 不依赖它** ——
 于是扩展里根本写不出这个调用。**用依赖关系而不是注释来禁止一件事。**
 */
public enum WidgetDeviceKey {

    /// 读密钥。拿不到返回 `nil`（设备没解锁、没登录、Keychain 没配好）。
    public static func read() -> Data? {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: WidgetSharedConstants.keychainService,
            kSecAttrAccount as String: WidgetSharedConstants.keychainAccount,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        // 🔴 访问组必须是构建期展开的完整值；配置缺失时返回空结果，
        //    绝不能退回 target 的默认 Keychain 组。
        guard let group = try? WidgetSharedConstants.resolvedKeychainAccessGroup() else { return nil }
        query[kSecAttrAccessGroup as String] = group
        #if os(macOS)
        query[kSecUseDataProtectionKeychain as String] = true
        #endif

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)

        // ⚠️ `errSecInteractionNotAllowed`（设备锁着）是**正常状态**，
        //    不是错误 —— 与其他失败一样落到 nil，由上层显示占位。
        guard status == errSecSuccess, let data = item as? Data, data.count == widgetKeyBytes else {
            return nil
        }
        return data
    }
}
