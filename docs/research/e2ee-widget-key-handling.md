# E2EE 产品怎么把数据放进系统组件：逐产品证据 + 平台机制

> **调研日期**：2026-09-27
> **调研范围**：已上线 E2EE 产品的 iOS WidgetKit / Android AppWidget / 锁屏组件实际做法；iOS App Group 的 Data Protection 默认值；Android Direct Boot 对组件的影响；组件相关的泄露与 CVE
> **状态**：**调研结论，未拍板。** 本文只给证据；要固化的决策须新开 ADR。
> **关系**：本文是 [native-widgets.md](native-widgets.md) 的**证据补充**，专门回答那份文档 §5.1（明文快照 vs 设备密钥加密快照）与 §5.2（锁屏可见性）背后"别人是怎么做的"。按 [`docs/README.md`](../README.md) 的冻结纪律，**不改原文**，只新增本文档。
> **证据分级**：本文严格区分「**源码里看到的**」（可直接复现的 `git`/`grep` 命令）/「**官方文档说的**」/「**第三方推测的**」。产品"有没有组件"这件事，优先用**源码仓库树 + AndroidManifest 是否声明 `appwidget`** 判定，不采信搜索结果。

---

## 0. 先看结论

**1. 没有一种"E2EE 小组件"的通用解法，实际落地的是四种模式 —— 而且做内容组件的是少数派。**

| 模式 | 组件里显示什么 | 密钥在哪 | 真实先例（源码/官方文档已验证） |
|---|---|---|---|
| **A. 纯入口型** | 什么都不显示，只有按钮 / 深链 / 一个图标 | 组件不碰密钥 | **Bitwarden**（只有 watchOS 复杂功能，画静态 logo）、**Obsidian** 1.11+、**Notesnook iOS**、Signal、Element、Standard Notes |
| **B. 明文快照型** | 真数据（标题 / 首行） | 组件不碰密钥 —— 应用在前台把**解密后的明文**写进共享存储 | **Notesnook Android**（`SharedPreferences`，明文 JSON） |
| **C. 组件内解密型** | 真数据（事件标题 / 任务标题） | **共享 Keychain**（iOS）存**已派生好的密钥**；组件自己做一次对称解密 | **Proton Calendar iOS**（Keychain main key + AES）、**Tuta Calendar Android**（AES + `databaseKey`） |
| **D. 不具备 / 明确不做** | —— | —— | 1Password（只有 feature request）、Joplin、Anytype、Aegis、Proton Drive |

**2. `Argon2id` 从来没有被放进组件里。** 四个做内容组件的实现（Notesnook / Proton Calendar / Tuta Calendar / Day One）无一在组件进程里跑 KDF：要么应用侧预先解密好（B），要么共享容器里预置一把**现成的**密钥（C）。这和 [native-widgets.md](native-widgets.md) §5.1 的判断一致 —— **KDF 在组件里不可行，不是"难"，是所有人都不这么做**。

**3. 锁屏可见性 ≠ 静态泄露，这是两件正交的事 —— 而加密快照只解决后者。** 这是本次调研最重要的一条。模式 C 的 Proton Calendar 密钥是 `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`（**设备锁着也能读**）；模式 B 的 Notesnook 快照是明文。**但两者都没有把内容放到锁屏上** —— 平台侧另有开关在做这件事（结论 4/5）。**选 (b) 加密快照并不会自动让锁屏安全。**

**4. iOS 有一条官方"锁屏即隐藏"的硬开关，而且它比应用自己脱敏更可靠：给 widget extension 加 Data Protection capability。** Apple 官方原文：设成 `NSFileProtectionComplete` / `NSFileProtectionCompleteUnlessOpen` 后，*"WidgetKit hides these widgets' content when the device is passcode locked and displays a placeholder until a user authenticates after they restart their device."* ⚠️ **代价**：这类组件**不能**再作为"Mac 上的 iPhone 组件"使用 —— 这直接和 [native-widgets.md](native-widgets.md) §0 勘误里 macOS 那条"不用写 Mac App"的捷径冲突。**两件事不能同时要。**

**5. 设备"锁定"和"重启后未首次解锁"是两种状态，而两家平台都默认"锁定后仍可读"。**
- **iOS**：Class C（`NSFileProtectionCompleteUntilFirstUserAuthentication`）是 *"the default class for all third-party app data not otherwise assigned"*，且*"the decrypted class key isn't removed from memory when the device is locked"*。App Group 容器属于第三方应用数据，**默认就是 Class C** → 设备锁着时组件照样读得到。
- **Android**：credential encrypted storage（默认）*"only available after the user has unlocked the device"*，但*"**If the user enables the lock screen after unlocking the device, credential encrypted storage remains available.**"* → 重启后解锁一次，之后随便锁屏都不影响组件读数据。

**6. 有内容组件的 E2EE 产品，都把"锁屏"和"内容"切开了。** 最干净的样本是 **Day One**（默认 E2EE 的日记）：内容型组件是 Daily Prompt / On This Day / Streak / Today（放桌面 / Today View），而**锁屏组件只有两个，且都不是内容**（Streak、Suggestions）。**"桌面放内容、锁屏只放入口"是已经在生产环境验证过的产品形态**，不是理论。

---

## 1. 逐产品表

> 「源码」列的命令均在 `research/upstream/` 或临时克隆的仓库上执行；`HEAD` 为 2026-09-27 当日值。

| 产品 | 组件里显示什么 | 数据怎么进组件 | 密钥放哪 | 锁屏处理 | 证据 |
|---|---|---|---|---|---|
| **Bitwarden** | ❌ **什么都不显示**。iOS 唯一匹配 `widget` 的 13 个文件**全部**在 `BitwardenWatchWidgetExtension/`，那是一个 **watchOS 复杂功能**：只渲染 `ComplicationIcon` 静态图片，`SimpleEntry` 只有 `date`，timeline `policy: .never`，`supportedFamilies([.accessoryCircular, .accessoryCorner, .accessoryInline])` | —— 组件不含任何数据 | —— | 不适用 | **源码**：`bitwarden/android` HEAD `065207f7`（2026-09-25）`git ls-tree -r --name-only HEAD \| grep -ci widget` = **0**；10 个 `AndroidManifest.xml` 里 `grep -ic appwidget` **全部为 0**（AppWidget 必须在 manifest 声明 `APPWIDGET_UPDATE` receiver，所以这是决定性判据）。`bitwarden/ios`：见左。**社区**：OTP 桌面组件需求帖 [community.bitwarden.com/t/…/55120](https://community.bitwarden.com/t/ios-14-widget-for-otp-codes-on-the-home-screen/55120)（2023-06-05） |
| **1Password** | ❌ 未找到任何组件 | —— | —— | —— | **官方**：iOS 发布说明 [releases.1password.com/ios/stable](https://releases.1password.com/ios/stable/) 无组件条目；**社区**：桌面搜索组件 feature request [1password.community/…-3974](https://www.1password.community/1password-at-home-31/feature-request-search-widget-for-home-3974)（2022-11-04）仍未实现。⚠️ 属"未找到证据"，非官方否认 |
| **Proton Calendar（iOS）** | ✅ **真数据：事件标题**（`WidgetAgendaView.swift:241` `case .accepted(let title)… Text(title)`） | ✅ **组件内解密**。`UpNextTimelineProvider.makeLoggedInTimeline()`：先 `ensureMainKeyWillBeReloadedFromKeychain()`（= `wipeMainKeyFromMemory()`），再 `setUpInMemoryCache.execute()`，然后观察并渲染解密后的事件 | ✅ **共享 Keychain**。extension entitlements 同时含 App Group `group.ch.protonmail.calendar` **和** keychain-access-group `$(AppIdentifierPrefix)ch.protonmail.calendar`；`MainKeyCrypto.decrypt` 走 `keyMaker.mainKey(by: nil)` → Keymaker `Keychain`：**`accessibility = .afterFirstUnlockThisDeviceOnly`（唯一枚举值）、`authenticationPolicy = .none`** → `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`，**无生物识别闸门** | ✅ **不上锁屏**：`UpNextWidget.swift:32` `.supportedFamilies([.systemSmall, .systemMedium, .systemLarge])` —— **没有任何 `.accessory*` 锁屏族**。未登录时走 `makeLoggedOutTimeline()` 优雅降级 | **源码**：`ProtonMail/ios-calendar`（`Modules/PCWidget/Sources/UpNext/*`、`Modules/PCData/Sources/Managers/KeyMaker/MainKeyCrypto.swift`、`Modules/PCWidgetExtension/PCWidgetExtension.entitlements`；`ProtonMail/protoncore_ios` `libraries/Keymaker/Sources/Keychain.swift`、`Keymaker.swift:131`）。**官方**：[winter roadmap](https://proton.me/blog/mail-calendar-product-roadmap-winter)（2024-11-25）、[Proton 公告](https://x.com/ProtonMail/status/1881426054109110660) |
| **Proton Calendar（Android）** | ✅ 有组件（官方博客） | ⚠️ **未核实**（未查 Android 源码） | ⚠️ 未核实 | ⚠️ 未核实 | [Tuta/Proton 对比不可用] 见 [tuta.com/blog/calendar-widget…](https://tuta.com/blog/calendar-widget-conversation-view-improvement) 仅佐证 Tuta 侧 |
| **Tuta Calendar（Android）** | ✅ 真数据：日程 | ✅ **组件内解密一份加密快照**。`WidgetDataRepository.storeCache()`：`cryptoFacade.aesEncryptData(key.data, json) → base64 →` 存进 **DataStore preferences**（键 `WIDGET_EVENTS_CACHE_<widgetId>`）；`loadCache()` 再 `aesDecryptData` | ✅ **应用自己的 `credentials.databaseKey`**（`UnencryptedCredentials.databaseKey`），**不是** 在组件里跑 KDF | ✅ **不参与 Direct Boot**：`AndroidManifest.xml` 中 `grep -c directBootAware` = **0** → 重启后未首次解锁时组件根本不在 Direct Boot 里跑；也没用 `not_keyguard` | **源码**：`tutao/tutanota` `app-android/calendar/src/main/java/de/tutao/calendar/widget/`（`data/WidgetDataRepository.kt`、`WidgetReceiver.kt`、`data/WidgetWorkerRepository.kt`）。**官方**：[Tuta Calendar widget 发布博客](https://tuta.com/blog/calendar-widget-conversation-view-improvement)（2025-04-24） |
| **Notesnook（Android）** | ✅ 真数据：**标题 + 首行**（`NotePreviewWidget.java`：`setTextViewText(R.id.widget_title, note.getTitle())`、`…R.id.widget_body, note.getHeadline())`）。另有 Reminders 组件列出提醒（上限 50 条） | 🔴 **明文快照**。JS 侧 `note-preview-widget.ts` 把**整个解密后的 note 对象** `JSON.stringify(newNote)` 过 RN bridge 交给原生；`WidgetUtils.java` 存进 **`SharedPreferences("appPreview", MODE_PRIVATE)`**，`parseNote()` 用 Gson 反序列化 —— **不加密** | ❌ 不存在（组件不需要密钥，因为存的就是明文） | ⚠️ **未发现任何脱敏或锁屏开关**；manifest `directBootAware` = 0 | **源码**：`streetwriters/notesnook`（`apps/mobile/android/app/src/main/java/com/streetwriters/notesnook/{WidgetUtils,NotePreviewWidget,ReminderWidgetProvider}.java`、`apps/mobile/app/services/note-preview-widget.ts`、`apps/mobile/android/app/src/main/AndroidManifest.xml`）。**官方**：[home-screen-widgets 帮助页](https://notesnook.com/help/mobile-integration/home-screen-widgets) |
| **Notesnook（iOS）** | ❌ **只有入口**：`NotesWidget.swift` 只有 `Image(systemName:"plus")` + `Text("Add a quick note")` + `widgetURL(…QuickNoteWidget)` | ❌ 无数据。虽然 `NotesWidgetExtensionDebug.entitlements` 声明了 App Group `group.org.streetwriters.notesnook`，**该组件不从里面读任何东西** | —— | 不适用（无内容） | **源码**：`streetwriters/notesnook`（`apps/mobile/ios/NotesWidget/NotesWidget.swift`、`NotesWidgetExtensionDebug.entitlements`） |
| **Day One**（默认 E2EE 日记） | ✅ 内容组件：Daily Prompt / **On This Day**（"shows entries from the current date in the past"）/ Streak / Today | ⚠️ **未核实**（闭源；形态上最可能是 App Group 明文快照，**未验证**） | ⚠️ 未核实 | ✅ **内容与锁屏严格二分**：官方指南「Lock Screen Widgets」一节明确*"There are two available lock screen widgets: **Streak and Suggestions**"* —— 都是**非内容**；内容组件放 Today View / Home Screen | **官方**：[Day One widgets for iOS](https://dayoneapp.com/guides/day-one-ios/day-one-widgets-for-ios/)；E2EE 默认开启：[dayoneapp.com/features/end-to-end-encryption](https://dayoneapp.com/features/end-to-end-encryption/) |
| **Obsidian** | ❌ **只有动作**（1.11.0 Mobile，2025-12-10）。iOS 锁屏/控制中心："Create a new note、Open a specific note、Open daily note、Open search、Open Obsidian"；iOS 桌面："Create a note、View a note、Open your daily note"；Android："Open Note / New Note / Search / Daily Note / Open Obsidian" | ❌ 无内容数据 | —— | ✅ 锁屏组件**只放入口**，天然无泄露面 | **官方**：[Obsidian 1.11.0 Mobile changelog](https://obsidian.md/changelog/2025-12-10-mobile-v1.11.0/) |
| **2FAS**（TOTP，最激进的一类） | ⚠️ **部分脱敏 + 交互揭示**：官方原文 Android *"if you can see the names of services in the widget but can't see the codes, it's alright, that's how it's supposed to work – tap on the name of the service, and you will see the code"* | ✅ 组件内生成（形态未核实） | ⚠️ 未核实。但 iOS 需**用户在 Settings 里手动打开 widget 开关**才显示 | ✅ **默认只显示服务名，点一下才出码**；iOS 需显式 opt-in | **官方**：[2FAS 支持页](https://2fas.com/support/2fas-auth-mobile-app/i-cant-see-any-tokens-on-my-widget/)。⚠️ 另有一条极有价值的一手观察见 §4.3 |
| **Signal** | ❌ **无桌面组件**。`signalapp/Signal-Android` 全仓 `widget` 命中的只有 `androidx.recyclerview.widget.*`（`ConversationLayoutManager.kt`）和应用内部 UI 类（`NotificationPrivacyPreference.java`、`StorageGraphView.java`、`UpgradeLocalBackupCard.kt`），**无任何 `AppWidgetProvider`** | —— | —— | ✅ 走**通知脱敏**而不是组件：Settings → Notifications → Show（Name and content / Name only / No name or content） | **源码**：`signalapp/Signal-Android`。**官方**：[In-App Notification Options](https://support.signal.org/hc/en-us/articles/360043273491-In-App-Notification-Options)；[Signal-Android#12432](https://github.com/signalapp/Signal-Android/issues/12432) |
| **Element / Matrix** | ❌ **无桌面组件**。⚠️ **语义陷阱**：搜索 "Element widget" 会命中 **Matrix Widgets** —— 那是"把 web app 钉进房间"的**完全不同的概念**（`CallWidgetProvider.kt`、`WidgetMessageInterceptor.kt`、`WidgetMessageSerializer.kt`），与 Android 桌面组件无关 | —— | —— | —— | **源码**：`element-hq/element-x-android`（命中全在 `features/call/impl/…/utils/`）。**对照**：[Introducing Matrix Widgets](https://matrix.org/blog/2017/08/23/introducing-matrix-widgets/)（2017，另一回事） |
| **Standard Notes** | ❌ 无组件。`standardnotes/app` 全仓 `grep -ci widget` = **0** | —— | —— | —— | **源码**：`standardnotes/app`。**社区**：[r/StandardNotes Android Widget](https://www.reddit.com/r/StandardNotes/comments/1c6qvx5/android_widget/)（2024-04，仅需求） |
| **Joplin** | ❌ 无组件 | —— | —— | —— | **官方论坛**：[Android widget for main screen?](https://discourse.joplinapp.org/t/android-widget-for-main-screen/126)（2018 起，仍为需求） |
| **Anytype** | ❌ 无组件（仍是 feature request） | —— | —— | —— | **官方社区**：[community.anytype.io/tag/widgets](https://community.anytype.io/tag/widgets/57) |
| **Aegis** | ❌ 无组件。`beemdevelopment/aegis` 全仓 `grep -ci widget` = **0** | —— | —— | —— | **源码**：`beemdevelopment/aegis` |
| **Proton Drive** | ❌ 无组件（仅需求） | —— | —— | —— | **官方 uservoice**：[iOS Proton Drive widget](https://protonmail.uservoice.com/forums/932839-proton-drive/suggestions/50770025-ios-proton-drive-widget)（2025-12-03） |

**表外说明**：`Proton Mail`、`Proton Pass` 是否已有组件，本次**未找到可靠证据**，列入 §5 未核实 —— 不写成结论。

---

## 2. iOS：App Group 的数据受什么保护（Apple 官方）

### 2.1 默认等级是 Class C，而 Class C 在锁屏时仍可读

Apple《Apple Platform Security · Data Protection classes》原文（[链接](https://support.apple.com/guide/security/data-protection-classes-secb010e978a/web)）：

- **Class C = `NSFileProtectionCompleteUntilFirstUserAuthentication`**：*"This class behaves in the same way as Complete Protection, except that **the decrypted class key isn't removed from memory when the device is locked** or the user logged out. … **This is the default class for all third-party app data not otherwise assigned to a Data Protection class.**"*
- **Class A = `NSFileProtectionComplete`**：*"Shortly after the user locks a device (10 seconds, if the Require Password setting is Immediately), the decrypted class key is discarded, rendering all data in this class inaccessible until the user enters the passcode again."*
- 另有 Class B（`CompleteUnlessOpen`，为"锁屏时仍需写入"的场景设计）与 Class D（`None`）。

**→ App Group 容器属于第三方应用数据，默认继承 Class C。** ⚠️ 我**没有**找到 Apple 把 App Group 单独列为例外的表述；Apple 的措辞是 "all third-party app data not otherwise assigned"。这是一条**基于官方措辞的推断**，不是官方逐字结论（§5 未核实第 6 条）。

**→ 结论：设备锁定时，WidgetKit 扩展读 App Group 数据在 Class C 下是允许的。** 锁屏保护必须靠别的手段（§2.2）。

### 2.2 官方给的"锁屏即隐藏"机制（这是关键）

Apple《Apple Platform Security · WidgetKit security》（[链接](https://support.apple.com/guide/security/widgetkit-security-secbb0a1f9b4/web)，发布 2024-05-07）逐条：

1. **风险被官方点名**：*"Both may show sensitive information and can be highly visible, especially on devices with an Always On display."*
2. **用户侧开关**：*"On an iPhone, users can configure whether to show sensitive data on the Lock Screen and while in Always On. In Settings, they can deactivate data access for Lock Screen widgets in the **'Allow Access When Locked'** section of Settings > Face ID & Passcode."*
3. **开发者侧 API**：实现 `redacted(reason:)` 回调 → 读取 `privacy` 属性 → 提供自定义 placeholder 视图；也可用 `unredacted()` 反向豁免。
4. **🔴 全组件级硬开关（推荐主机制）**：*"As an alternative to marking individual views as privacy sensitive, for example, if an entire widget content is privacy sensitive, the developer can add the **Data Protection capability to a widget extension**. Until a user unlocks their device to match the privacy level selected, **WidgetKit displays placeholders instead of the widget content.** … set the Data Protection entitlement to the value that fits the level of privacy they want to offer: `NSFileProtectionComplete` / `NSFileProtectionCompleteUnlessOpen`. **WidgetKit hides these widgets' content when the device is passcode locked and displays a placeholder until a user authenticates after they restart their device.**"*
5. **⚠️ 代价（必须记一笔）**：*"Additionally, these iOS widgets **aren't available as iPhone widgets on Mac**."*
6. **Apple Watch**：Settings > Display & Brightness > Always On > **Hide Sensitive Complications**，可对全部或单个复杂功能选择红色脱敏。

**对 heyta 的直接后果**：`NSFileProtectionComplete` 是**平台级强制**的锁屏保护，不依赖应用自己写对脱敏逻辑；但它会**关掉 [native-widgets.md](native-widgets.md) §0 勘误里 macOS 那条"不用写 Mac App、直接把 iPhone 组件放 Mac 桌面"的捷径**。**这两条路互斥，必须选一个。**

### 2.3 Keychain 的 accessibility 决定"组件在锁屏时拿不拿得到密钥"

iOS Keychain 的 `kSecAttrAccessible*` 是与文件 Data Protection 独立的一套：
- `kSecAttrAccessibleWhenUnlocked` / `…WhenUnlockedThisDeviceOnly` → **锁屏即不可读**（组件 = 读不到密钥 = 天然 fail-closed）
- `kSecAttrAccessibleAfterFirstUnlock` / `…AfterFirstUnlockThisDeviceOnly` → **重启后首次解锁起，之后锁屏仍可读**（Proton 的选择）

**已验证的实例**：`ProtonMail/protoncore_ios` 的 `libraries/Keymaker/Sources/Keychain.swift` 里 `internal enum Accessibility` **只有一个 case**：`afterFirstUnlockThisDeviceOnly`，且 `init` 默认 `authenticationPolicy = .none`：

```swift
internal enum Accessibility {
    case afterFirstUnlockThisDeviceOnly
    var cfString: CFString {
        switch self { case .afterFirstUnlockThisDeviceOnly: return kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly }
    }
}
public init(service: String, accessGroup: String, …) {
    self.accessibility = .afterFirstUnlockThisDeviceOnly
    self.authenticationPolicy = .none
}
```

**→ Proton Calendar 的组件在设备锁屏时是能拿到主密钥并解密的**；它之所以没造成锁屏泄露，**不是因为密钥拿不到，而是因为它根本没提供锁屏组件**（§1，`supportedFamilies` 只有 `.system*`）。**这个因果关系正是 heyta 需要复制的**。

---

## 3. Android：Direct Boot 对组件的确切影响（Google 官方）

Google《Support Direct Boot mode》（[链接](https://developer.android.com/privacy-and-security/direct-boot)）逐条：

- 存储分两类：
  - **Credential encrypted storage**：*"the **default** storage location and **only available after the user has unlocked the device**."*
  - **Device encrypted storage**：*"available both during Direct Boot mode and after the user has unlocked the device."*
- *"**By default, apps don't run during Direct Boot mode.**"*
- 要参与：把组件标记为 encryption aware —— manifest 里 `android:directBootAware="true"`，并可监听 `ACTION_LOCKED_BOOT_COMPLETED`（此时 device encrypted storage 可用）。
- 🔴 **最关键的一句**：*"Once the user has unlocked the device, all components can access both the device encrypted storage as well as credential encrypted storage. **If the user enables the lock screen after unlocking the device, credential encrypted storage remains available.**"*
  → **重启后解锁一次，之后再怎么锁屏，credential encrypted storage 都一直可读。** 这与 iOS Class C 的行为同构。
- 🔴 **官方明确劝阻的反模式**：*"**Use device encrypted storage only for information that must be accessible during Direct Boot mode. Don't use device encrypted storage as a general-purpose encrypted store.** For private user information, or encrypted data that isn't needed during Direct Boot mode, use credential encrypted storage."*
- 访问方式：`Context.createDeviceProtectedStorageContext()`；迁移用 `moveSharedPreferencesFrom()` / `moveDatabaseFrom()`。
- 自测：`adb shell getprop ro.crypto.type` → 输出 `file` 表示已启用 file-based encryption（绝大多数设了锁屏凭据的现代设备）。

**对 heyta 的直接结论**：
1. **组件默认不参与 Direct Boot** —— 无需任何操作，重启后未首次解锁时组件不运行（这正是我们想要的默认）。
2. **一旦为了让组件在开机后立刻可用而加 `directBootAware="true"`，就必须把数据搬进 device encrypted storage** —— 而 Google 明确说不要拿它当通用加密存储。**对 E2EE 产品这是净损失，不建议做。**
3. 组件读的是 credential encrypted storage（`SharedPreferences` / DataStore / SQLite 默认位置），**解锁一次后长期可读** —— 所以 Android 侧的锁屏保护**不能靠存储**，要靠 **Android 16 的锁屏组件退出机制 `"not_keyguard"`**（已记录于 [native-widgets.md](native-widgets.md) §4，来源 [Widgets on lock screen FAQ](https://android-developers.googleblog.com/2025/03/widgets-on-lock-screen-faq.html)）。

### 3.1 已核实：两个做内容组件的 Android 产品都**没有** `directBootAware`

```
git -C notesnook show HEAD:apps/mobile/android/app/src/main/AndroidManifest.xml | grep -c directBootAware   # → 0
git -C tutanota  show HEAD:app-android/calendar/src/main/AndroidManifest.xml          | grep -c directBootAware   # → 0
```

两个产品都选了"组件不参与 Direct Boot"这条路。这是行业默认做法，不是巧合。

---

## 4. 反面案例 / 泄露与安全发现

### 4.1 没有找到"E2EE 产品锁屏组件泄露"的 CVE — 这本身是结论

本次**未找到**任何针对 E2EE 产品**组件内容**的锁屏泄露 CVE / 安全审计发现。原因很可能是结构性的：**做内容组件的 E2EE 产品只有少数几个，而它们都主动避开了锁屏**（Proton 不做锁屏族、Day One 锁屏组件非内容、Obsidian 只放入口）。**不做锁屏组件 = 没有这类 CVE 的暴露面。** 这条不写成"绝对不存在"，列入 §5。

### 4.2 CVE-2026-28950（Apple，已修复）—— 同类问题的真实发生形态

不是组件，是**通知**，但属于同一类"操作系统在 App 之外渲染 E2EE 内容"的问题，且已有真实执法取证后果：

- **事实**：iOS 的一个通知数据留存缺陷，使**标记为删除的通知内容仍留在设备上**，可被恢复 —— 报道中包括 **Signal** 消息；Apple 以 iOS 26.4.2 / 18.7.8 / 16.7.16 / 15.8.8 修复，描述为 *"A logging issue was addressed with improved data redaction."*
- **来源（第三方报道 + 官方条目）**：[Tenable CVE-2026-28950](https://www.tenable.com/cve/CVE-2026-28950)、[Help Net Security（2026-04-23）](https://www.helpnetsecurity.com/2026/04/23/cve-2026-28950-iphone-vulnerability-notifications-signal/)、[Security Affairs](https://securityaffairs.com/191183/mobile-2/ios-flaw-let-deleted-notifications-linger-apple-issues-fix.html)
- **教训**：*"删掉"不等于"设备上不存在"*。组件/通知的快照与缓存都会被系统留存；E2EE 的边界画在"服务端看不到"，画不到"本机 OS 表面不残留"。

### 4.3 2FAS 的一手观察：重启后组件拿不到密钥

官方支持页原文：*"Widgets, on both operating systems, are independent extensions of the application, and **sometimes the codes may not load immediately after turning on the phone. If that happens, wait a moment, run 2FAS Auth, and the codes should appear.**"*

**这是"组件进程拿不到密钥"这个矛盾在生产环境的直接暴露**：设备刚重启、主应用未运行过 → 组件产不出码 → 用户被要求"打开一次 App"。（对照 §3：Android 侧就是 credential encrypted storage 尚未解锁；iOS 侧就是对应用私有容器的 Data Protection 尚未打开。）

⚠️ 注意：2FAS 官方把它写成"正常现象"，**没有**说明其密钥存储机制；具体的存储与是否在组件内解密属 §5 未核实。

### 4.4 CVE-2026-44965 / GHSA-p6pw-xx6v-j4hh（Datadog Android）—— 组件自身就是攻击面

虽然不是 E2EE、也不是锁屏问题，但它是本次唯一找到的**组件相关 CVE**，且机制对 heyta 有直接借鉴价值：

- **问题**：Datadog Android 应用有 6 个组件**配置 Activity** 声明 `android:exported="true"` 且无权限守卫（`IncidentWidgetActivity`、`MonitorSavedViewWidgetActivity` 等）。它们从一个共享基类 `WidgetActivity` 读取调用方可控的 `EXTRA_APPWIDGET_ID`，在无深链目的地时**用这个 ID 去查已存的组件定义、取出对应用户会话、并以 `UserSessionSourceLogin.Automatic` 自动登录**。
- **利用**：Android app widget ID 是**由 `AppWidgetManager` 分配的小整数**，所以一个**零权限的同装应用**可以暴力枚举 `EXTRA_APPWIDGET_ID = 1..N`，命中的那次会让 Activity 带着受害者会话前台化并渲染实时数据。泄露形式是**屏幕可见侧信道**（辅助功能服务 / 录屏 / 截图）。
- **来源**：[GitHub Advisory GHSA-p6pw-xx6v-j4hh](https://github.com/advisories/GHSA-p6pw-xx6v-j4hh)（2026-08-07）、[NVD CVE-2026-44965](https://nvd.nist.gov/vuln/detail/CVE-2026-44965)
- **对 heyta 的含义**：`android:exported` 与"组件 ID 可猜"是两个独立的坑，**与加密无关**。即使快照是加密的，一个 exported 的组件配置 Activity 照样能成为入口。这条要进组件的安全清单。

### 4.5 无内容的对照组

为完整性记一笔：`Notesnook Android` 的明文快照（§1）**目前没有已知 CVE**，但它满足"任务标题以明文落在应用私有容器之外"，属于 [native-widgets.md](native-widgets.md) §5.1 所说的**威胁模型变更**，只是尚未被利用/披露。**"没有 CVE" ≠ "没有风险"**。

---

## 5. 未核实项（不要当结论用）

1. **Proton Calendar 的 Android 组件实现** —— 只确认了产品存在（官方博客/App Store 文案），**未读源码**，其密钥与快照机制未知。
2. **Proton Pass / Proton Mail 是否已有组件** —— 本次未找到可靠证据（既没找到官方宣布，也没排除）。**不写成"没有"。**
3. **Day One 的数据路径** —— 官方只说了有哪些组件；闭源，**是否 App Group 明文快照完全未验证**。上表"形态上最可能"是**推测**。
4. **2FAS 的密钥存储 / 是否在组件内解密** —— 官方支持页只说现象（§4.3），未说明机制。
5. **1Password 是否真的完全没有组件** —— 属"未找到证据"，非官方否认。
6. **Apple 是否对 App Group 容器有单独的 Data Protection 默认值** —— Apple 只写 "all third-party app data not otherwise assigned"；"App Group 因此默认 Class C"是**基于官方措辞的推断**，未找到逐字表述。
7. **iOS 桌面组件（`.system*`）在锁屏 Today View 的可见性边界** —— Apple 文档提到 Today view 与 Always On；Settings 里"Lock Screen Widgets"与"Today View and Search"是**两个独立开关**，确切组合行为**需真机验证**。第三方文章 [swiftsenpai](https://swiftsenpai.com/development/hide-sensitive-widget-data/)（2023-03-28）称 `.privacySensitive()` 要在 iOS 16 上生效**必须先关掉"Lock Screen Widgets"开关** —— 该说法与直觉相反，**我未在 Apple 官方文档中找到对应表述**，按第三方说法记录，勿直接采信。
8. **是否存在针对 E2EE 产品锁屏组件泄露的审计发现** —— 本次未找到；按"未找到"记录，而非"不存在"。
9. **第三方最佳实践文章的可信度**：[PTKD Journal "Widget data privacy in mobile apps"](https://ptkd.com/journal/widget-data-privacy-mobile-apps)（2026-05-24）给出的原则（组件内容视为公开可见、共享容器只放渲染所需的最小非敏感数据、登出时清理快照）**与 Apple 官方文档方向一致**，但该站权威性未经审查，**仅作旁证**。

---

## 6. 对 heyta 的推荐做法

### 6.1 倾向 **(b) 设备密钥加密快照 + 组件内对称解密**，不倾向明文快照

**证据支持**：
- **两个做内容组件的真实产品都走了 (b)**：Tuta Calendar（AES + `databaseKey`，快照密文入库）、Proton Calendar iOS（共享 Keychain 主密钥 + AES）。**没有一个做内容组件的 E2EE 产品把明文写进共享容器并因此成为可抄的范本** —— 唯一走明文路线的 Notesnook **不是 E2EE 产品的正面参照**（它把自己定位为加密笔记，但组件路径放弃了静态加密）。
- **(b) 完全避开 KDF**：两家的组件里都只有一次 AES 对称操作；这印证了 [native-widgets.md](native-widgets.md) §5.1 的判断 —— Argon2id 不进组件，密钥必须**预先派生好**再交出去。
- **(b) 把"应用私有容器之外"的明文暴露面收敛到一个密文文件 + 一把密钥**，符合 E2EE 产品"尽量少的地方有明文"的直觉；且这把密钥的 accessibility 是一个**显式、可审计**的开关（§2.3）。

### 6.2 (b) 的代价（要诚实记账）

| 代价 | 说明 |
|---|---|
| **两端都要写第一个原生模块** | 这与 [native-widgets.md](native-widgets.md) §2.1 第 2 条（两端都没有任何自定义原生模块）叠加 —— 组件这块本来就躲不掉原生代码，(b) 在此之上**多要**一条"生成/存取设备密钥"的桥。 |
| **要定"设备密钥"的生命周期** | 密钥由谁生成、如何被主密钥包裹、登出/改密码/多账号时如何轮换与销毁、Keychain/Keystore 的 accessibility 选择 —— 这是一个**需要 ADR 的独立设计**，不是实现细节。 |
| **iOS 的 accessibility 选择有取舍** | `WhenUnlockedThisDeviceOnly` = 锁屏时组件读不到密钥 → 组件在锁屏期间**刷新失败**，需要像 Proton 的 `makeLoggedOutTimeline()` 那样优雅降级到占位符；`AfterFirstUnlockThisDeviceOnly` = 锁屏可读（Proton 的选择），组件刷新更稳但静态暴露窗口更大。**建议默认前者**。 |
| **Android 不要碰 device encrypted storage** | 一旦为了 Direct Boot 把密钥搬进 device encrypted storage，就撞上 Google 官方明确劝阻的做法（§3）。**建议不做 directBootAware。** |
| **组件首次可用时间变晚** | 与 2FAS 的观察同构（§4.3）：设备重启后、主应用未运行前，组件最多只能显示占位符。**这是 (b) 的固有代价，也是 (a) 唯一真正赢的地方** —— (a) 在重启后立刻能显示（因为读的是明文）。这个差异要在验收里明确预期。 |

### 6.3 🔴 加密快照**不能**替代锁屏保护 —— 两者必须分别做

这是本文最想让决策者记住的一条。**(b) 解决的是静态泄露**（设备备份、越狱/root 后翻容器、取证镜像、误把 App Group 当私有容器），**不解决锁屏可见性**：

- Proton 的密钥在锁屏时**恰恰是可读的**（`AfterFirstUnlockThisDeviceOnly`），它没泄露是因为**不做锁屏组件**；
- Day One 的锁屏组件**不含内容**；
- Apple 官方的"锁屏即隐藏"是 **Data Protection capability 这个独立机制**，与快照是否加密无关。

**因此建议把锁屏做成一组正交的默认值，首版全部选"不暴露"：**

1. **首版不做锁屏组件** —— 与 [native-widgets.md](native-widgets.md) §7 第 2 条"是否做锁屏组件"的开放决策一致；本调研的外部证据（Proton / Day One / Obsidian 三家全部回避锁屏内容）支持**默认不做**。
2. **Android 显式声明 `"not_keyguard"`** 主动退出锁屏组件（现成机制，见 [native-widgets.md](native-widgets.md) §4）。
3. **iOS 给 widget extension 加 Data Protection capability = `NSFileProtectionComplete`**，让系统在锁屏时强制显示 placeholder（§2.2）。**⚠️ 必须在 ADR 里同时记录：这会放弃"iPhone 组件上 Mac 桌面"的 Continuity 捷径**（[native-widgets.md](native-widgets.md) §0 勘误），两条路互斥。
4. **默认脱敏**（只显示"今天 N 条"），内容展示作为**显式 opt-in**（对标 2FAS iOS 需要在 Settings 里手动打开、Android 默认只显示服务名）。
5. **登出 / 换账号时清空快照与密钥**，避免上一个用户的内容残留（third-party 一致性建议 + [native-widgets.md](native-widgets.md) 的 fail-closed 纪律）。
6. **组件安全清单里加上 CVE-2026-44965 那一类**：配置 Activity 不 `exported`（或加权限守卫）、组件 ID 不当会话凭据、不因组件 ID 命中就自动登录（§4.4）。

### 6.4 一句话给决策

> **走 (b)：共享容器里放设备密钥加密的快照，组件内只做一次 AES；密钥预派生好放共享 Keychain/Keystore，组件里永不跑 Argon2id。同时把"不做锁屏组件 + iOS Data Protection capability + Android `not_keyguard` + 默认脱敏"作为一组默认值一起定 —— 因为加密快照解决不了锁屏，锁屏要靠平台开关。代价是两端各多一个原生模块、密钥生命周期要单独设计、且组件在重启后首次解锁前只能显示占位符。**

---

## 附：本文证据的复现方式

```bash
# 组件是否存在（决定性判据：manifest 是否声明 appwidget / 是否有 AppWidgetProvider）
git -C <repo> ls-tree -r --name-only HEAD | grep -ci widget
git -C <repo> show HEAD:<path>/AndroidManifest.xml | grep -ic appwidget
git -C <repo> show HEAD:<path>/AndroidManifest.xml | grep -c directBootAware

# 关键文件
#   Notesnook 明文快照 : apps/mobile/android/app/src/main/java/com/streetwriters/notesnook/WidgetUtils.java
#   Notesnook 桥接     : apps/mobile/app/services/note-preview-widget.ts
#   Tuta 加密快照      : app-android/calendar/src/main/java/de/tutao/calendar/widget/data/WidgetDataRepository.kt
#   Proton 组件        : Modules/PCWidget/Sources/UpNext/UpNextTimelineProvider.swift
#   Proton 密钥        : Modules/PCData/Sources/Managers/KeyMaker/MainKeyCrypto.swift
#   Proton Keychain    : libraries/Keymaker/Sources/Keychain.swift (protoncore_ios)
#   Bitwarden watch 组件: BitwardenWatchWidgetExtension/BitwardenWatchWidgetExtension.swift
```

**检索工具**：本次 `web_search` 不可用（Tavily HTTP 432），改用 anysearch CLI + 直接 `curl` / `git` 一手来源。所有 URL 均于 **2026-09-27** 访问。
