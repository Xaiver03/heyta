# heyta 客户端数据流与依赖清单（法务取证 · 纯只读）

> **元信息**
> - 生成日期：**2026-10-01**
> - 工作方式：**纯只读代码考古**。本文件除本输出文件外**未修改任何文件**。
> - 范围：**各端客户端 + 打包配置**。服务端与 AI 出境由其它 agent 负责，本文件不越界。
> - 用途：直接产出隐私政策的「权限清单」与「第三方清单」两节 —— 工信部 App 检测与商店上架会**逐条对照 manifest**，故 B17/B18 逐字抄录，不许概括。
> - 证据格式：结论 + `文件:行号`。所有行号以 2026-10-01 的工作树为准。

---

## B11 `clientId`

**是什么**：一个**每设备/每安装唯一、一经生成不可更改**的不透明随机字符串。它是同步冲突 LWW（Last-Write-Wins）的**确定性决胜依据** —— 两台设备同时改同一字段时，用谁的 `clientId` 大来裁决，保证所有设备算出同一个结果。

**怎么生成**（`packages/app-host/src/ids.ts:52-59`）：优先用运行时密码学随机 `globalThis.crypto.randomUUID()`（122 位 UUID）；Hermes（iOS/鸿蒙/部分 Android）历史上没有 `crypto.randomUUID`，故回退到 `Date.now().toString(36)-计数-Math.random().toString(36)`。**回退路径不是密码学随机** —— `ids.ts:24-39` 与 `host.ts:201-202` 明确承认这是「有意识的取舍」（两害相权：撞 id 概率极低，而"直接抛异常、应用起不来"是确定发生的坏结果）。

**存哪**：本地存储的 META 表，键 `clientId`（`packages/storage/src/stores.ts:71` 与 `:189` 登记 `CLIENT_ID: 'clientId'`）。读写逻辑在 `packages/app-host/src/host.ts:204-216`（`resolveClientId`）：先 `adapter.get(STORES.META, META_KEYS.CLIENT_ID)`，命中则复用，未命中则 `randomId()` 生成并 `adapter.put(...)` 落盘。
- SQLite 系（node-host / 桌面原生壳 / 移动端 op-sqlite）：落 `META` 表。
- Web：落 IndexedDB 的 `META` store（同一 `resolveClientId` 路径，见 `host.ts`）。

**能否关联到自然人**：**不能**。它是纯随机、无结构、不含设备指纹/邮箱/手机号的字符串，`ids.ts:50` 明确写「不要解析它，只当不透明字符串用」。服务端**能看到它** —— 每条 op 都带 `clientId`（`packages/op-log/src/engine.ts:279`），且同步请求本身也带它（`sync-wiring.ts:96` `clientId: engine.getClientId()`），因此服务端数据库里存有 `clientId`（作为 op 元数据，密文 payload 之外）。但它是**假名（pseudonym）而非标识符**：单凭它无法反推到具体自然人。

**是否跨端一致**：**否 —— 每端/每安装各自一个 clientId。** 一个用户在一台设备 = 一个 clientId；手机与笔记本 = 两个不同的 clientId。这正是同步模型设计所需（向量时钟按 clientId 分维计数，`engine.ts:228`）。AGENTS §3.5 与 `sync-wiring.ts:160-161` 记录的事故「两台设备共用同一个 clientId ⇒ 双方都同步不了」，反证了它**必须**逐设备唯一、且历史上曾因为各宿主各写一份实现而漂移过（现统一到 `resolveClientId`，由 `check:layering` 钉住）。

> ⚠️ 卸载重装 / 清库会**重新生成**一个新 clientId（旧的不落盘之外处）。向量时钟里会累积历史 clientId（`op-log/tests/vector-clock-trim.spec.ts:10`「验收账号每跑一轮就多 2 个 clientId」），上限 100（ADR-0008）。

---

## B12 本地存储与「本地到底加不加密」

🔴 **结论：本地存储是明文的。端到端加密（E2EE）只覆盖同步通道（上传/下载），不覆盖磁盘静态存储（at-rest）。**

**证据链**：
1. 加密/解密只发生在同步传输边界，不在落库路径：
   - 上传时才对 payload 加密：`packages/sync-client/src/client.ts:796` `const cipher = await encrypt(JSON.stringify(op.payload ?? {}), password)`。
   - 下载时才解密：`client.ts:562` `const plain = await decrypt(op.payload, password)`。
2. 引擎写入的是**明文 payload**：`packages/op-log/src/engine.ts:279` 把 `payload` 原样写进 op，落库前无任何 encrypt 调用。全仓 `encrypt/decrypt/AESGCM/deriveKey/pbkdf2/scrypt` 的匹配**只**出现在：`sync-core`（传输加密）、`widget-core` + `apps/mobile/src/widgets/snapshot-sealer.ts`（小组件快照，见下）、`i18n` 文案 —— **`packages/storage` 的三套适配器与 `packages/op-log` 里一个都没有**。
3. 移动端 SQLite 驱动**未启用 SQLCipher**：`apps/mobile/src/db/op-sqlite-driver.ts:71-75` 调 `open({ name, location? })`，无 `key/cipher` 参数（`@op-engineering/op-sqlite` 的加密是付费 fork，本项目用的是普通 MIT 版）。DB 名 `heyta.sqlite`（`apps/mobile/src/db/open-host.ts:24`），位置平台默认（iOS 落 Documents）。
4. 桌面/node-host SQLite：`packages/storage` 的 `SqliteAdapter` 走原生 `libsqlite3`（macOS 壳零第三方依赖，AGENTS 地图），同样无 at-rest 加密。
5. Web IndexedDB：浏览器沙盒内，**无额外加密**（数据以明文记录存在 IndexedDB）。

**这套设计的自证与文案口径**（与代码一致，法务可直接引用）：
- `landing.facts.encrypted.label`：「任务加密后才上传，同步通道读不出内容」（`packages/i18n/src/locales/zh-CN.ts:118`）—— 措辞限定在「上传后/同步通道」，**没有**声称本地加密。
- `site.integrations.e2ee.body`：「Tasks are encrypted **on your device** before they ever upload; the server only ever handles ciphertext.」
- `site.docs.privacy.s2p1`：「开启同步后，改动会**加密**上传……密文只是 payload 那部分。」
- `site.docs.how.s3p2`：「**周边元数据不加密**：同步时间、用哪些设备、动了哪类东西及顺序，服务端都看得见。被保护的是内容本身 —— 任务标题、便签，不是『你用了哪些 heyta 功能』。我们不打『我们什么都看不见』的广告。」

🔴 **政策里必须写清的两条，漏一条即为虚假陈述**：
1. **本地明文**：E2EE 保护的是「云端/传输」，不是「设备上的静态数据」。设备丢失、被 root/取证、备份被读取时，本地任务/便签/习惯是明文可读的（OS 级文件加密如 FileVault/APFS Data Protection / Android FBE 属于系统能力，非本 App 提供）。
2. **元数据不加密**（同步时间、设备 clientId、改动顺序）—— 即便开了 E2EE 也如此。

> ⚠️ 例外：小组件跨进程快照**是加密的**（`snapshot-sealer.ts:64` AES-GCM），这是本地明文规则之外的一处专门保护，见 B15。

---

## B13 凭据存储

三类凭据：**服务端地址 `baseUrl`、访问令牌 `token`（JWT）、E2EE 口令 `password`**。三端处置不同。

### Web（`apps/web`）
- **`baseUrl` + `token` + `email` 落盘 `localStorage`**，键 `heyta.sync.credentials`（`credential-storage.ts:32`），JSON 明文（`credential-storage.ts:123`）。接口 `PersistedCredentials`（`:35-49`）**刻意没有 `password` 字段**。
  - 理由表在 `credential-storage.ts:11-18`：token「服务端可吊销；丢了等价于需重新登录，不泄露任何明文数据」。
  - ⚠️ **如实写出的风险**：`credential-storage.ts:19-22` —— localStorage 对 XSS 暴露，接受它的理由是「令牌只能存取服务端已有的密文，而口令仍只在内存，XSS 拿到令牌也解不开数据」。政策若提「令牌本地保存」应说明它**未额外加密、依赖浏览器同源隔离**。
- **E2EE 口令绝不落盘**：只在内存/session。与 B12、`site.docs.passphrase.s1p2` 一致。
- **登录回跳令牌是一次性的**：
  - 邮件 magic-link：服务端确认页把 JWT 写 `sessionStorage`（键 `loginToken` / `loginBaseUrl` / `loginEmail`）或用 URL **fragment** 投递（`pending-login.ts:81-106`）。fragment 通道刻意用 `#` 而非 `?` —— 不进服务端/不进 Referer/不进访问日志（`pending-login.ts:47-55`）。
  - **读到即删**：`takePendingLogin` / `takePendingSession` / `takePendingSessionFromFragment` 全部「先删再判」（`pending-login.ts:160-168, 271-277, 297-303`），无论校验成功与否都不留在存储里。

### 移动端（`apps/mobile`）
🔴 **一切凭据只在内存，刻意不落盘**（`apps/mobile/src/sync/config.ts:15-27, 37, 52-68`）：模块级变量 `current`，冷启动即 `undefined`，口令/令牌/地址重启后都要重填。这是「有意的取舍」，注释指出真要改善应接系统钥匙串（Keychain/Keystore）而非写进自家 SQLite（`:21-23`）。
- 小组件的**设备密钥**走系统安全存储：`snapshot-sealer.ts:24`「Android 走 Keystore、iOS 走共享 Keychain、桌面走 OS keychain」，`widget-bridge.ts:44`「原生生成随机密钥、永不离开 Keystore」（见 B15）。

### node-host CLI / 桌面（macOS）
- AI 密钥等敏感串走 **macOS Keychain**：`apps/node-host/src/keychain-secret-store.ts` 用 `/usr/bin/security` 的 `add-generic-password / find-generic-password / delete-generic-password`（`:58, 167, 182, 192`），仅 macOS 可用（`isKeychainAvailable` `:124`）。

### 退出登录清掉什么
- Web：`clearStoredCredentials()` 删 localStorage 里的 baseUrl/token/email（`credential-storage.ts:132-141`）。口令本就不落盘、无需清。
- 移动端：`clearSyncConfig()` 把内存 `current` 置 `undefined`（`config.ts:66-68`）；另有 `apps/mobile/src/widgets/credential-wipe.ts:44`「清掉服务器地址/token/密码」（同步执行）。
- ⚠️ **退出登录不清本地已同步下来的密文与明文物化数据**（本地库文件仍在）—— 详见 E 节。

---

## B14 通知与提醒

三条独立通路，法务口径各不相同，必须分开写：

### ① Web 本地提醒通知（Notification API，纯客户端）
- 代码：`apps/web/src/features/reminders/use-reminder-notifications.ts` + `notify.ts`。
- **权限**：浏览器 `Notification` 通知权限。`notify.ts:41-43` 定义 `NotificationCtor`（`permission` / `requestPermission`），仅标准 Web Notification，**不申请其他敏感权限**。
- **内容**：`new Notification(title, { body })`（`notify.ts:41, 50-53`）。标题 = 产品名（`use-reminder-notifications.ts:57` `title: t('common.brand')`），正文 = **任务标题本身**（`:60` `body: (taskTitle) => t('web.reminder.notify.body', { title })`）。⚠️ **这条会把解密后的任务标题写进系统通知横幅**，落在设备通知中心里（OS 级，非本 App 加密）。
- **触发范围**：只在**应用开着且发生过 op** 时到点响（`use-reminder-notifications.ts:18-21` 明写：应用没开/无 op 不会自动响）；后台唤醒需一套不泄露内容的协议，**未做**。非安全上下文（`http://` 自托管）下 `new Notification()` 直接抛，被判住（`notify.ts:50-53`）。

### ② 服务端 Web Push（小组件刷新信号）——🔴 政策重点
这是唯一「离开设备、经第三方推送服务」的一条，三个关键事实：
1. **推送载荷是固定极小信号，不含任何用户数据**：`server/src/push/notify.ts:41` `WIDGET_REFRESH_PAYLOAD = JSON.stringify({ type: 'heyta:widget-refresh' })`；文件头（`notify.ts:11-24`）解释快照是 E2EE 信封、服务端没密钥造不出来，所以「即使推送服务或任何中间人读到，也只知道『这台设备装着 heyta』」。
2. **载荷按 RFC 8291 `aes128gcm` 加密**（`server/src/push/push-crypto.ts:1-2, 51`，自研、零依赖，用 Node 内建 crypto）。即 **双层**：内层是 E2EE 快照信封（若有），外层是推送传输加密；服务端/推送服务都读不到明文。VAPID（RFC 8292，`vapid.ts:1-5`）用于让推送服务确认「来自 heyta」。
3. **服务端存的订阅三要素**：`endpoint` + `p256dh` + `auth`（`subscriptions.ts:30-35`），按 `userId` 关联。
   - 🔴 **`endpoint` 是第三方推送服务的 URL（能力 URL）** —— 拿到它就能给那台设备发推送。代码**刻意不把它写进日志**（`subscriptions.ts:20-25`，失败返回值只有计数）。
   - 政策应说明：为 Web Push，设备会把一个「推送服务端点 URL + 两个密钥」交给 heyta 服务端存储；该 endpoint 指向浏览器厂商/OS 的推送服务（如 Firefox/Mozilla push、Chrome/Firebase、Safari/Apple APNs），**内容经端到端 + 传输双层加密，推送服务商只见密文**。

### ③ 移动端通知
`apps/mobile` 未发现独立的系统级通知/推送 SDK 集成（无 FCM/APNs 客户端库，见 B18）。提醒投递依赖各端 App 内逻辑；小组件刷新走上述 Web Push（web）+ 本地写入信号（原生，见 B15）。🔴 **未穷尽**：RN 原生 `PushNotificationIOS`/`notifee` 之类需再确认，本轮在 `apps/mobile` 源码里未见调用点。

---

## B15 小组件（widget）

**读哪些数据**（快照载荷 `WidgetPayload`，`packages/widget-core/src/contract.ts:220`）：
- 任务：`{ id, title, isDone }`（`:113-116, 348`）—— 🔴 **含任务标题明文进载荷**（写盘前才加密）。
- 习惯：`{ id, title, doneToday, streak }`（`:123-127, 467`）。
- 专注（`WidgetFocus` `:132`）、清单颜色（`WidgetProjectColor` `:213`）、四象限视图（`adaptive-card.ts:73` kinds = today/quadrant/habits/focus）。

**落不落盘成快照 / 怎么共享 / 加不加密**：🔴 **落盘，但落的是 AES-256-GCM 密文信封，且密钥不离开系统安全存储。**
- 封包：`apps/mobile/src/widgets/snapshot-sealer.ts:60-71` 用 `sync-core` 那份 AES-GCM；密钥固定 32 字节（`WIDGET_KEY_BYTES`，`:33`），nonce 每次重取（`:56-58, 63`）。信封结构 `WidgetEnvelope`（`contract.ts:78`，含 nonce/ciphertext/validUntil）。
- **密钥归属**（`snapshot-sealer.ts:24`、`widget-bridge.ts:43-45`、`WidgetModule.kt:194`）：「原生生成随机密钥、**永不离开 Keystore**」；JS 交明文、拿回密文，**密钥不穿桥**（`widget-bridge.ts:47` `sealWidgetSnapshot`）。
- **iOS 共享机制**：App Group `group.com.heyta`（`WidgetSharedConstants.swift:32` `appGroupId`；entitlements 见 `HeytaMobile.entitlements:7` 与 `HeytaWidgetExtension.entitlements:7`）。容器文件（`WidgetContainerFiles.swift:34-50`）：`snapshotFileName`（信封）、`intentQueueFileName`（勾选意图队列）、`privacyFileName`（隐私开关）。`containerURL` 可能返回 `nil`（未配好时静默降级为占位，不崩）。
- **Android 共享机制**：`SharedPreferences`（`WidgetKeyValueStore.kt:44` `getSharedPreferences(PREFS_NAME, MODE_PRIVATE)`），同域即组件可读，**不需要 App Group**（`WidgetKeyValueStore.kt:21`）。解密在原生 `WidgetSnapshotCipher.kt` + `KeystoreAead`（`AndroidKeyStore`，密钥不可导出，`WidgetStoreTest.kt:166-174`）。
- **鸿蒙**：`apps/mobile/harmony/.../widget/WidgetParse.ts:205-210` 解析同一信封（`ciphertext/nonce/validUntil`）——文件式共享。⚠️ 鸿蒙工程尚未成壳（AGENTS §3.24），此项按现有 ArkTS 代码描述。

**隐私开关**：`widget-bridge.ts:49-60` `setWidgetPrivacy(alwaysHideTitles)` —— 写进**与快照分开的**文件（`privacyFileName`），锁屏「始终隐藏标题」。🔴 仅 iOS 锁屏有意义（`:58-60`：安卓/鸿蒙无锁屏组件项，`null`=平台无此项）。
**意图队列**：组件上勾选任务会产生 `{ taskId, targetIsDone, at }` 意图（`intents.ts:45, 116`），落盘排队、回主 App 时 drain（`widget-bridge.ts:36-38` `drainIntentQueue/mergeIntentQueue`）。含 taskId 不含标题。

> 政策口径：小组件为跨进程显示，会在**应用私有容器/SharedPrefs**里写一份**加密快照**（AES-256-GCM，密钥在 Keystore/Keychain，不可导出）。快照内容含任务与习惯标题（受锁屏「隐藏标题」开关约束）。这是 B12「本地明文」之外**唯一一处对本地落盘数据额外加密**的例外。

---

## B16 导出 / 导入

### 导出内容（`packages/app-host/src/export-dump.ts`）
`ExportDocument`（`:92`）含：物化实体（各 `ENTITY_TYPES`，未物化实体如 `REMINDER` 的内容仍完整在 `opLog` 里，`:105-110`）+ **完整 op-log** `opLog: Operation<string>[]`（`:110, 172`）+ 计数区 `ExportCounts`（`:78-90`，含 `total`/`deleted`，用于「导出能证明自己完整」）。
- 🔴 **含墓碑**：已删除记录（带 `deletedAt`）**必须进导出**（`:23-34`），否则重放时删除事实消失、被删数据复活。给人看的任务清单走 `aliveRecords()`（`:32`），完整备份走含墓碑路径，二者由测试钉住。
- 🔴 **是明文**：序列化 `serializeExportDocument = JSON.stringify(sortKeysDeep(doc), null, 2)`（`:219-220`），**无任何加密**（此文件不 import `sync-core` 的 encrypt）。因为 op 的 `payload` 在本地是明文（B12），导出的 dump 里 payload 也就是明文 JSON。⇒ **导出的 `.json` 文件是不设防的敏感副本**，谁拿到谁能读全部任务/便签内容。政策须明确提示用户自行保管。
- 导出格式版本 `EXPORT_FORMAT_VERSION = 1`（`:59`），刻意**不等于** `CURRENT_SCHEMA_VERSION`（`:47-58`）。

### 三端导出通道
| 端 | 出口 | 送到哪 |
|---|---|---|
| Web | `apps/web/src/features/settings/export-download.ts` + `ExportPanel.tsx` | 浏览器 `<a download>` → 用户下载目录 |
| 移动端 | `apps/mobile/src/screens/ExportScreen.tsx:139` `Share.share({ title, message: content })` | 🔴 **系统分享面板**（RN 核心能力，`:137`「不需要任何新依赖」）；用户可存到「文件」或转发给**任意第三方 App**（微信/邮件/云盘…）—— 明文随用户选择外流 |
| node-host CLI | `apps/node-host/src/cli.ts:388-392` `export --out <路径>` `writeFileSync(serializeExportDocument(doc))` | 指定路径的 JSON 文件 |

### 导入入口（哪些端有）
- **Web**：`apps/web/src/features/settings/ImportPanel.tsx`（还原 heyta 自己的导出文件）→ `restoreIntoEmptyTarget`（`apps/web/src/lib/oplog.ts:478-483`）。🔴 **只支持还原到空库**，非空目标在写之前拒绝（`oplog.ts:474`），不做「合并到已有数据」。另有 `TickTickImportPanel.tsx`（从滴答清单导入，走普通 op、可与既有数据共存，是**另一件事**）。
- **node-host CLI**：`cli.ts:420` `parseExportDocument(readFileSync(inPath))` → `restoreExport`/`restoreIntoEmptyTarget`（`apps/node-host/src/host.ts:171`）。
- **移动端**：✅ **有导入入口（2026-10-03 goal 批五落地）** —— 「我的 → 导出数据」页的「从备份还原」卡：选文件（`@react-native-documents/picker` + 本机读取通道）或粘贴 JSON 两条路 → `parseExportDocument` 预检并展示 counts → 确认 → `restoreIntoEmptyTarget`。与 Web 同一条口径：**只支持还原到空库**，非空目标在写之前拒绝。
  ⚠️ 原文写「移动端没有导入入口 / 拿到的东西导不回来」，已被批五推翻（AGENTS 第 3 项同步更正）。
  🔴 **数据流事实（政策口径要用这条，不是"导不回来"）**：还原回来的 op 带的是**备份来源设备**的 `clientId`，服务端 `validateOp` 对不匹配的署名逐条回 `INVALID_CLIENT_ID` ⇒ **这些 op 不会上行**，还原结果只存在于该设备本地。移动端的界面文案按此改写（含"只在这台设备上"），设备级判据 `scripts/verify-mobile-restore.sh` 会钉住这句文案。

---

## B17 权限清单（逐字抄，政策成品）

> 🔴 下表逐字取自各端打包配置，**政策里这条清单必须与 manifest 一字不差**（工信部 App 检测/商店上架逐条对照）。行号以 2026-10-01 工作树为准。

### Android — `apps/mobile/android/app/src/main/AndroidManifest.xml`（全仓唯一 manifest，无 debug/release 变体文件）
| 权限/声明 | 位置 | 用途 |
|---|---|---|
| `android.permission.INTERNET` | `AndroidManifest.xml:3` | 与自建同步服务端通信（唯一的 `<uses-permission>`） |
| `android:allowBackup="false"` | `:10` | 🔴 禁止系统备份导出应用数据（数据留存/安全声明项） |
| `android:usesCleartextTraffic="${usesCleartextTraffic}"` | `:12` | 明文 HTTP 开关，由 Gradle 注入：debug **与 release 均置 `true`**（`build.gradle:165-179, 250-252` `finalizeDsl` 覆盖 RN 插件默认），以支持自托管 NAS/局域网 `http://` 服务端。⚠️ 内容仍 E2EE，但令牌可走明文（见 `mobile.profile.transport.plaintext` 告警） |
| 四个 widget `<receiver>` `android:exported="false"` | `:77/:88/:99/:110`（Today/Quadrant/Habits/Focus） | 桌面小组件，**均不导出**（安全要求，防第三方伪造 `ACTION_TOGGLE` 广播，`:32-37`）；无 widget 专用权限 |
| **未声明** `POST_NOTIFICATIONS` | — | 🔴 全 manifest **无通知权限** —— 印证 B14：原生端不使用系统通知 |

### iOS — `apps/mobile/ios/HeytaMobile/Info.plist`
🔴 **没有任何 `NS*UsageDescription` 键**（不申请相机/麦克风/通讯录/位置/相册/健康等任何隐私权限；grep 全 plist 零命中）。相关的只有：
| 声明 | 位置 | 用途 |
|---|---|---|
| `NSAppTransportSecurity` → `NSAllowsArbitraryLoads=false`, `NSAllowsLocalNetworking=true` | `Info.plist:29-36` | 默认强制 HTTPS，仅**放行本地网络明文 HTTP**（自托管；`:31` 注释「不要改成 true，否则有被拒风险」） |
| `ITSAppUsesNonExemptEncryption=false` | `Info.plist:38-39` | 声明只用标准加密（TLS + AES-GCM）属**豁免类**，免出口合规逐构建问询 |
| `UIRequiredDeviceCapabilities=[arm64]` | `:42-45` | 仅架构要求，非隐私权限 |

**iOS entitlements**（`HeytaMobile.entitlements` 与 `HeytaWidgetExtension.entitlements`，两份内容相同）：
| entitlement | 位置 | 用途 |
|---|---|---|
| `com.apple.security.application-groups` = `group.com.heyta` | `HeytaMobile.entitlements:5-8`；widget `:5-8` | App Group，主 App ↔ 小组件共享容器（见 B15） |
| `keychain-access-groups` = `$(AppIdentifierPrefix)com.heyta.shared` | `:9-12` | 共享 Keychain，存小组件设备密钥（B15） |
| 🔴 **无 `aps-environment`** | — | 未声明 APNs 推送 entitlement ⇒ 原生 iOS **不接系统推送**（印证 B14：推送只走 Web Push） |

### 鸿蒙 — `apps/mobile/harmony/entry/src/main/module.json5`
🔴 **当前没有任何 `requestPermissions` 声明**（grep 零命中）。已声明的是 abilities/extensions：`EntryAbility`（`:18`）、`EntryBackupAbility`（`:40`，`ohos.extension.backup` `:46` —— 🔴 **系统备份扩展，存在**，政策应提示鸿蒙侧数据可能被云备份）、`EntryFormAbility`（`:55`，`ohos.extension.form` `:63` —— 桌面卡片/小组件）。
> ⚠️ 鸿蒙壳未成（AGENTS §3.24），联网所需的 `ohos.permission.INTERNET` 很可能**尚未声明** —— 政策里鸿蒙权限应标注「以最终上架 manifest 为准，本清单未穷尽」。

### macOS 原生壳 — `apps/desktop-macos/scripts/package-app.sh`（构建期生成 entitlements）
生成的 `entitlements.plist`（`:122-131`）**只有两项**，且 **无 `com.apple.security.app-sandbox`（未沙盒）**：
| entitlement | 位置 | 用途 |
|---|---|---|
| `com.apple.security.cs.allow-jit=true` | `package-app.sh:128` | JavaScriptCore 需 JIT，hardened runtime 默认禁、不给则启动即崩（`:127` 注释） |
| `com.apple.security.cs.allow-unsigned-executable-memory=true` | `:129` | 同上，JSC 执行内存 |
| 🔴 未声明 `network.client`/沙盒 | — | Developer ID 分发、**非沙盒**：网络与文件系统访问不受 App Sandbox 约束（`:139` 走 Developer ID 证书，缺证书降级） |

### Windows 原生壳 — `apps/desktop-windows/HeytaWindows/app.manifest`
🔴 **无权限/ capability 声明**：`app.manifest` 只声明受支持 OS 版本（`supportedOS` Windows 10/11，`:11`），是 unpackaged WinUI 3 启动所需，非权限。MSIX 打包态的 capabilities（如 `runFullTrust`）在 `Package.appxmanifest`——本轮工作树**未见该文件**（打包走 `package-msix.ps1` 生成），🔴 **未穷尽**，政策里 Windows 权限以最终 MSIX manifest 为准。

### Linux 原生壳
GTK4 C 壳（`apps/desktop-linux`），**无清单式权限声明**（Linux 无 iOS/Android 式权限模型）；⚠️ 未见 AppImage/flatpak manifest（若有 sandbox 需另查），本轮未穷尽。

---

## B18 第三方依赖清单（从实际打包配置）

> 来源：`apps/mobile/android/app/build.gradle`、`apps/mobile/ios/Podfile.lock`、`apps/mobile/harmony/oh-package.json5`、各 `packages/*/package.json` 的 `dependencies`（不含 devDependencies，那些不进产物）。🔴 **判定列**：是否可能造成数据外发。

### 移动端运行时第三方（React Native 0.84.1）
| 组件 | 声明处 | 网络外发？ |
|---|---|---|
| `react` `19.2.3` / `react-native` `0.84.1` | `apps/mobile/package.json:33-34`；`build.gradle:332` `com.facebook.react:react-android` | ❌ 网络能力只在 App 自身 `fetch`（连用户自建服务端）时被调 |
| `hermes` / `jsc-android` | `build.gradle:335-337`（hermes 或 jscFlavor `io.github.react-native-community:jsc-android`）；`Podfile.lock` `hermes-engine` | ❌ JS 引擎 |
| `@op-engineering/op-sqlite` `^18.2.5` | `package.json:30`；`Podfile.lock:6,1834`（`op-sqlite 18.2.5`） | ❌ 本地 SQLite（**未启用 SQLCipher**，见 B12） |
| `react-native-get-random-values` `^2.0.0` | `package.json:35` | ❌ CSPRNG 垫片（`ids.ts:38` 计划的可靠随机源） |
| `fast-text-encoding` `^1.0.6` | `package.json:31` | ❌ TextEncoder 垫片 |
| `lucide-react-native` `1.48.0` / `react-native-svg` `15.15.5` / `react-native-safe-area-context` `^5.5.2` | `package.json:32,36-37`；`Podfile.lock` `RNSVG` | ❌ 图标/布局，SVG 打进包，无远端字体 |
| `Yoga` / `FBLazyVector` / `RCTSwiftUI*` / `RCT*` | `Podfile.lock`（RN 内部子 pod） | ❌ RN 布局/核心 |

🔴 Podfile.lock 里 **grep 无** firebase / analytics / crashlytics / push / payment / stripe / mapbox / google / amplitude / segment / onesignal（零命中）⇒ **iOS 无任何外发 SDK**。Android `build.gradle` 的 `implementation` 只有 react/hermes/jsc（`:332-337`）+ `android-json`（testImplementation `:361`，不发布）⇒ **Android 同样无外发 SDK**。

### 鸿蒙
`apps/mobile/harmony/oh-package.json5` 及 `entry/oh-package.json5` 的 `dependencies` **均为空 `{}`**（工程未成壳，AGENTS §3.24）。⚠️ 上架前须重查。

### `packages/*` 运行时第三方（打进所有宿主 bundle）
| 包 | 依赖 | 用途 | 外发？ |
|---|---|---|---|
| `sync-core` | `@noble/ciphers` `^2.2.0`、`@noble/hashes` `^2.4.0`、`hash-wasm` `^4.12.0` | AES-GCM/Argon2 纯 JS 兜底（Hermes 无 WebCrypto 时，B12） | ❌ 全零依赖加密库 |
| `storage` | `@sqlite.org/sqlite-wasm` `3.53.4-build1` | 浏览器/Node 侧 SQLite | ❌ 本地库 |
| `domain` | `ical.js` `^2.2.1` | iCalendar(RRULE) 解析 | ❌ 纯解析，无网络（注：与 §3.1 排除的 `rrule.js` 不同，这个是 heyta 采用的实现） |
| `shared-schema` | `zod` `^4.4.3` | 线协议 schema 校验 | ❌ |
| `ui` | `lucide` `1.48.0` | 图标 | ❌ |
| `app-host`/`sync-client`/`op-log`/`widget-core` | 仅 `@heyta/*`（workspace 内部） | — | ❌ 内部包 |

### 🔴 两条「零运行时依赖」声称 —— 已验证属实
- `packages/ai/`：`package.json` `dependencies = {}`、`peerDependencies = {}` ✅ **零运行时依赖**。
- `packages/local-api/`：同样 `dependencies = {}`、`peerDependencies = {}` ✅ **零运行时依赖**。
（`i18n`、`design-system` 亦 `{}`。）

### 外发面全表（客户端能触网之处，逐一）
1. **同步 `fetch`** → 用户在设置里手填的 `baseUrl`（自建服务端），载荷 E2EE 密文，元数据明文（B12/B13）。这是唯一的应用级外发。
2. **Web Push** → 浏览器/OS 的**第三方推送服务 endpoint**（订阅三要素存 heyta 服务端；内容双层加密，B14）。
3. **系统分享面板**（移动端导出）→ 用户主动选定的任意第三方 App/目录，**明文 JSON**（B16）。
4. **桌面壳 `fetch`** → 同 #1，用户自建服务端。
5. 🔴 **无** 统计/埋点/崩溃上报/广告/支付/地图/远程字体 SDK；web/landing 源码内 **无外部 CDN/`@import url`/Google Fonts**（grep 零命中）。

> ⚠️ 未在本轮覆盖：`server/`（vendored Fastify/Prisma + 邮件 provider，属服务端 agent）；AI 出境 provider（`packages/ai` 零依赖，但实际发请求的宿主路径与 provider 域名属 AI 出境审计）。

---

## E 数据留存与删除（客户端侧）

### 本地库文件位置（明文，见 B12）
| 端 | 位置 | 证据 |
|---|---|---|
| Web 主数据 | IndexedDB 数据库 `heyta`（浏览器按 origin 管，OS/浏览器沙盒内） | `packages/storage/src/indexeddb/indexeddb-adapter.ts:201`（默认 dbName=`heyta`）、`apps/web/src/lib/oplog.ts:339` |
| Web PWA 小组件快照 | 独立 IndexedDB `heyta-widget` | `apps/web/src/pwa/sw.ts:117-129` |
| Web 凭据 | `localStorage` 键 `heyta.sync.credentials`（baseUrl/token/email，明文） | `credential-storage.ts:32`（B13） |
| 移动端主数据 | op-sqlite 文件 `heyta.sqlite`（app 私有目录；iOS 默认 Documents，Android app files 目录） | `apps/mobile/src/db/open-host.ts:24`、`op-sqlite-driver.ts:42-44` |
| 移动端设备偏好 | `heyta-device-prefs.sqlite`（是否看过欢迎页等） | `apps/mobile/src/prefs/device-prefs.ts:47` |
| 移动端小组件快照 | iOS App Group `group.com.heyta` 容器文件 / Android SharedPreferences（**加密信封**，B15） | `WidgetContainerFiles.swift` / `WidgetKeyValueStore.kt:44` |
| node-host / 桌面壳 | `--db <路径>` / `HEYTA_DB` 指定的 SQLite 文件 | `site.docs.selfhost.s11i1`、`apps/desktop-macos` libsqlite3 |

### 备份面（政策须区分两端）
- 🔴 **Android：`android:allowBackup="false"`**（`AndroidManifest.xml:10`）⇒ 应用数据**不进**系统/云备份。
- 🔴 **鸿蒙：存在 `EntryBackupAbility`（`ohos.extension.backup`，`module.json5:40-46`）**⇒ 鸿蒙侧数据**可被系统备份框架带走**，与 Android 立场相反，政策里必须分别写。
- iOS：受 App 沙盒与 iTunes/Finder 备份影响（未见 `UIFileSharingEnabled`；数据库在 Documents 会被整机备份覆盖 —— ⚠️ 未穷尽，按上架最终配置核）。

### 退出登录清掉什么 / 不清什么
- **Web** `useSyncStore.clearCredentials()`（`apps/web/src/features/sync/store.ts:350-358`）：清内存 token/email/password + `clearStoredCredentials()`（localStorage 落盘那份，`:352-354`「只清内存的话刷新一次令牌就活回来了」）+ 把桌面四款小组件置占位（`:356-358`）。**不删 IndexedDB 主数据。**
- **移动端** `wipeCredentialsAndWidgets`（`ProfileScreen.tsx:142-144`）：`clearSyncConfig`（内存凭据）+ `clearWidgetState`（小组件快照与密钥一起清）+ `forgetSignedInUser`（`auth/session.ts:93-96`）。**不删 `heyta.sqlite`。**

### 🔴 没有「抹掉本地数据 / 恢复出厂」的用户入口
- 存储层有 `drop()` / `indexedDB.deleteDatabase(this.dbName)` 能力（`indexeddb-adapter.ts:555-557`），但 **`apps/` 下零调用点**（grep 无命中，仅测试用）。⇒ **任一客户端都没有「一键清空本地全部数据」按钮**。
- 本地明文数据（含已同步下来的任务/便签/习惯）**只在下列情形消失**：① 卸载应用（OS 删沙盒文件）；② 浏览器清站点数据/IndexedDB；③ 移动端「清除凭据 + `clearWidgetState`」只动凭据与组件快照，主体库不动。

### 删除的语义：墓碑而非物理删除（影响「删除权」表述）
- 用户「删除任务」= 打 `deletedAt` 墓碑（op-log 用墓碑表达删除，`export-dump.ts:23-34`）；回收站「彻底删除」= 打 `purgedAt` **标记、不清 `deletedAt`**（AGENTS §9，会让离线对端复活）。⇒ **本地 op-log 与物化库里，被删记录以历史/墓碑形式长期保留**，磁盘上不主动物理擦除。政策里「删除你的数据」应限定为：删除后不再显示 / 不再同步明文，但**完整 op-log 作为同步与导出的一部分仍存在于本地库**，物理清除依赖卸载。
- 账号注销后的服务端数据处置属**服务端**范围（另有 agent），本文件不判定。

---

## 政策撰写提示（客户端）

### 权限清单该怎么表述
- **照抄，不概括，不补。** 工信部 App 检测与商店上架逐条对照 manifest。实际申请的运行时/隐私权限**极少**：Android 只 `INTERNET`（无通知、无存储、无位置、无剪贴板）；iOS **零 `NS*UsageDescription`**；鸿蒙当前**零 `requestPermissions`**；桌面壳无权限模型。**不要**把小组件/导出的「数据类别」误列成「权限」—— 那是功能，不是系统权限。
- **权限名 + 用途一一对应**（B17 已给文件:行号）。若上架前补了 `POST_NOTIFICATIONS`（接入原生推送/提醒）或鸿蒙 `ohos.permission.INTERNET`，必须同步改这张表并重新对照——**这两处是当前最容易在正式包与清单之间漂移的地方**（鸿蒙壳、Windows `Package.appxmanifest` 本轮未见，标了「未穷尽」）。
- **系统能力 ≠ 权限，但要单独披露**：App Group（`group.com.heyta`）、共享 Keychain、Android 明文 HTTP 白名单（`usesCleartextTraffic=true`）、iOS `NSAllowsLocalNetworking=true` —— 这些不上「权限申请」页，但属「数据出境/明文传输」事实，应在正文说明，别漏。

### 「本地优先」这句话能承诺到什么程度
✅ **能承诺**：
1. 数据**先落本地**、离线可用、云端只是同步通道（架构事实）。
2. 一旦开启同步，**载荷端到端加密后上传，服务端只有密文**（`sync-client/client.ts:796` 上传前加密、服务端拒绝明文）。
3. **导出自由**：完整 op-log + 墓碑 + 可核对计数（B16）。
4. 元数据之外**服务端读不到内容**；`clientId` 是随机假名、反推不到自然人（B11）。

🔴 **不能承诺 / 必须写明限制的三条**（漏写即虚假陈述）：
1. **「本地优先」≠「本地加密」。** E2EE 只覆盖同步通道，**磁盘上的任务/便签/习惯/笔记是明文**（B12）。设备丢失、被取证、整机备份时，本地内容是可读的；系统级文件加密（FileVault/APFS/Android FBE）是 OS 能力、非本 App 提供。政策里「端到端加密」必须限定为「**传输/云端**加密」，且加一句「本地存储不额外加密，依赖设备自身的访问控制」。
2. **「端到端加密」不覆盖元数据、也不覆盖本地通知横幅与导出文件。** 同步时间、设备 `clientId`、改动顺序服务端可见；Web 提醒通知正文含任务标题（B14①）；导出的 `.json` 是明文（B16）经系统分享可流向任意第三方 App。唯一对本地落盘额外加密的是小组件快照（AES-256-GCM，B15）。
3. **删除不是物理擦除。** 用户删除/彻底删除在本地与服务端都以**墓碑/标记 + op-log 历史**存在（E）；且**客户端没有「抹掉本地数据」入口**（E）。政策里的「删除权」应说清：应用内删除是标记，本地历史与云端密文要彻底清除需卸载应用 + 服务端账号删除（后者属服务端政策），不要写成「即刻永久删除」。
4. **AI 出境是 E2EE 的定义外例外**（ADR-0005）：托管/云端 AI 那条路内容以明文给到模型厂商，**不得被描述成端到端加密** —— 客户端代码已如此措辞（`web.ai.disclosure`），政策须一致。

> 一句话给政策撰写人：heyta 的「本地优先 + 端到端加密」保护的是**「云端/第三方看不到你的内容」**，不保护**「丢了的设备上的静态内容」**，也不保护**元数据、通知横幅、导出文件**。把这条边界如实写出来，就是既合规又兑现产品实际承诺的写法。

