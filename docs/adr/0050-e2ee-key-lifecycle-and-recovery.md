# ADR-0050：E2EE 密钥生命周期、恢复码与按功能派生

> 状态：已接受（2026-10-03）
> 
> 本 ADR 解决 B 的密钥生命周期问题。它不把登录口令、JWT、设备活动记录或服务端备份密钥当作 E2EE 恢复手段。

## 决定

heyta 的数据密钥采用三层模型：

1. 客户端生成随机 256-bit vault root key。服务端永远只接收密文，root key 只存在于解锁会话或操作系统安全存储中。
2. root key 分别由 E2EE 口令和一次性恢复码通过 Argon2id 派生的 KEK 包裹。两份包使用不同的随机盐、随机 IV 和 AAD；恢复码只在创建/轮换时显示一次，不回传、不进 op-log、不进服务端数据库。
3. 所有新密文通过 HKDF-SHA256 从 root key 派生功能密钥，并把 `purpose` 与 `keyVersion` 放入 HKDF info 和 AES-GCM AAD。同步、AI 任务拆解和 AI 反馈因此拥有不可混用的密钥域。

密钥包是版本化 JSON（`version: 1`），包含 root key 的 SHA-256 指纹、口令包和恢复码包。指纹只用于发现错误的包/密钥组合，不可反推出 root key。新包不改变当前 Argon2/AES 口令密文格式，避免隐式地把存量 op 当成新协议。

## 口令、恢复与设备语义

- 登录密码只用于服务端认证；它不能解锁 vault。修改登录密码不改变 E2EE root key。
- 恢复码拥有与 E2EE 口令相同的解锁能力。恢复成功后客户端必须立即生成新口令、新恢复码。当前 key-package API 要求 `expectedKeyVersion` 且只允许严格递增一版，并要求新包与现有包的 root fingerprint 相同；因此在完整密文迁移 API 就绪前，服务端拒绝用 wrapper-only 请求替换 root key。旧恢复码只能在新 wrapper 发布后从服务端当前包中失效，离线复制的旧包无法被服务端撤销。
- 新设备加入必须通过已解锁设备或恢复码获得 root key，再在设备安全存储中建立本地副本。服务端的 `clientId` 是客户端自报字段，不是密钥，也不能单独授权加入；当前加入动作是认证会话上传/读取 opaque key package。
- 设备撤销使用现有 `tokenVersion` 作为认证边界：撤销请求记录 clientId、删除活动设备行、递增 tokenVersion 并关闭该账号全部 WebSocket。仅删除 `sync_devices` 行不安全，因为旧设备可离线持有密文并可换 clientId；因此撤销后仍必须由受信任设备轮换 root key 并重加密数据。
- 轮换在客户端读取全部待迁移记录、逐条验证旧密钥并全部生成新密文后才能发布新 key package；任何一条失败都不得发布部分结果。`reencryptVaultRecords` 只提供内存中“全部成功才返回”的边界，不等同于服务端数据库事务、断点恢复或已发布密文的原子切换。
- 当前生产 op-log 仍是“每条密文由 E2EE 口令派生”的旧格式。ADR-0050 的 key package 是新格式的实现基础；在迁移批次明确、双读/单写和移动端互操作验收前，不宣称存量 op 已完成 root-key 迁移。
- **包修订号与载荷世代不是同一个数字。** `keyVersion` 只表示口令/恢复 wrapper 的修订；服务端 GET 的 `payloadKeyVersion` 才是当前密文写入世代。改口令只推进前者，客户端必须先读取后者再构造新写入 cipher，否则会在已完成原子迁移的账号上被 generation gate 拒绝。未发布载荷世代时才使用初始包版本作为新格式的暂定世代。
- Web 的用户入口嵌入既有“同步设置”面板：创建包后先展示一次恢复码，用户重新输入后才 CAS 发布；已有包支持口令解锁、恢复码解锁、锁定和更换口令。恢复码、root key 和口令都不进入浏览器持久化层。该入口的判据在 `apps/web/tests/vault-settings-panel.spec.tsx`，服务端 GET 元数据接线在 `apps/web/src/lib/vault-session.ts` 与 `packages/app-host/src/vault-session.ts`。
- 移动端用户入口嵌入既有「我的 → 设置 → 同步凭据」面板（`VaultSettingsSection`），不是孤立页面：稳定的 authenticated `accountId` 随活配置传入 host；创建包需要恢复码二次确认，已有包支持口令/恢复码解锁、锁定、更换口令和显式 opt-in 的“记住解锁”。恢复码解锁会把会话置为 `requiresRecoveryRotation`，在新口令与新恢复码发布前 `getPayloadCipher()` 返回 `undefined`，且旧 root 不会写入安全存储。登出会按当前 server/account scope 删除原生安全存储 root；普通 SQLite、sync config 和 op-log 不保存 root、口令或恢复码。
- 移动端自动恢复的唯一入口是 host 的首次 vault session 构造：它发生在首次同步客户端使用前，由 `AppHostOptions.vaultRootKeyStore` 读取 root；打开设置页不能成为恢复依赖。安全存储旁边持久化一个非秘密的 scope-bound remembered-unlock fence：缺失、损坏或读失败一律视为禁用，只有用户明确 opt-in 且 native save 成功后才写入允许值。登出/切换账号先同步写入禁用 fence，再同步调用 `AppHost.invalidateVaultSession()`（递增 epoch、锁定并丢弃会话、fence 在途加载），随后清理 token；native remove 失败仍保留 fence，并通过既有设置面板重试。这样安全存储残留不会在冷启动或同账号重新认证时自动解锁。
- `accountId` 只在同一 `serverOrigin + token` 认证绑定中继承；server 或 token 改变时 host 必须丢弃旧 vault session，不能把旧 accountId 当作新认证的身份。显式 lock/invalidate 后，后续 `getVaultSession()` 保持 locked，直到用户再次明确解锁并选择记住；恢复码解锁和普通口令解锁都不会隐式解除 fence。
- Web 的真实浏览器验收使用 `e2e/tests/vault-settings.spec.ts`：真 Chromium、真 Vite 应用、真 IndexedDB、真 Argon2/AES 与 React UI；HTTP fixture 只替代服务端/Prisma 边界，不能代替 PostgreSQL 集成测试。测试先截图再断言，固定证据在 `apps/web/evidence/vault-panel/`，并人工复查明暗主题截图。尚未创建 key package 时的两次 `GET /api/sync/key-package → 404` 是协议定义的“暂无包”响应，测试显式登记这两个 404，同时对其他 console/pageerror 保持严格失败。

## 移动端 OS 安全存储边界

移动端的“记住解锁”只允许由明确的用户 opt-in 调用；启动、同步失败和普通写 op 都不得隐式保存或清除 root key。RN port 只传递 base64 root key 到原生桥，并在调用方的解锁会话内存中使用；它不做缓存、不写 SQLite、不写普通文件，也不会因为同步失败调用清除。登出/切换账号必须显式调用 `remove`（TS 侧同时提供 `clearVaultRootKey` 这个语义明确的入口）。

- Android 使用独立的 `heyta_vault_root_wrap_key_v1` Android Keystore AES-256-GCM 密钥。SharedPreferences 只保存包含 scope 摘要、随机 nonce 和密文的 envelope；scope 的 canonical bytes 同时作为 GCM AAD。该别名与 Widget 的 `heyta_widget_device_key_v1` 完全分离，Widget 的缓存和清理路径不能复用。
- iOS 使用独立 Keychain service，并把 root key 保存为 `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` 的 generic-password item。Keychain account 是 `SHA-256(serverOrigin, accountId)`，不使用 Widget 的 service/access group。
- 两个平台和 TS port 都拒绝空白 `serverOrigin`、空白 `accountId` 及控制字符；保存失败只返回错误，旧 item 不先删除。平台实现不提供生物识别弹窗：WhenUnlocked/Keystore 是可用性边界，生物识别需要独立的用户体验和威胁模型决定。

移动端 port 有 4 条 Node 测试，Android Kotlin 与 iOS workspace Debug 构建通过。2026-10-03 Android 已完成安装产物的 Keystore 运行时验收：[`verify-android-vault-storage.sh`](../../scripts/verify-android-vault-storage.sh) 构建并安装当前 Debug 与 instrumentation APK，执行两个 scope 的隔离、四个独立进程的 seed/verify/remove/clean，并在 verify 与 remove 之间真实重启设备。各进程核对 PID 与系统启动编号，持久文件只含 envelope，删除 A 后 B 仍可读，随后 B 的删除也能跨进程读回。五个测试阶段均通过；[证据](../../apps/mobile/evidence/android-vault-storage.txt) 包含 APK SHA-256，不包含 root key。测试 fixture 是合成密钥，且不进入产品入口。Android wrapping key 当前不要求用户认证，因此本轮不声称锁屏禁读。iOS Keychain 的跨进程/锁屏运行时证据仍待验证，最终交付还须重装 Release。

原生验收探针应按同一个 scope 矩阵执行：在 Android 真机上用两个账号 scope 写入两把不同的 32-byte root key，分别 load，删除 A 后确认 A 不可读且 B 仍可读；再从第二个进程/重启后的应用进程读取 B，确认 Keystore 解包和普通存储重载有效。iOS 用两个 Keychain account 做同样的交叉读取/删除检查，并在设备锁定时确认 `WhenUnlockedThisDeviceOnly` 读取失败、首次解锁后恢复。每一步都要记录 app 包身份、scope、返回码和截图/日志；不要把 root key 明文写入日志。若当前测试壳没有第二进程入口，先把“跨进程”标为未验证，不能用同进程线程测试冒充。

## 拒绝的方案

- 不在服务端保存可解密所有数据的托管恢复密钥；这会直接破坏 E2EE 的信任边界。
- 不用登录密码、邮箱找回链接或 JWT 作为数据恢复凭据；它们的生命周期、泄露面和认证语义不同。
- 本阶段不自行实现 Shamir 多方恢复或 WebAuthn PRF。两者可作为未来的额外 wrapper，但不能替代当前已经可验证的口令+恢复码包协议；WebAuthn PRF 在平台支持矩阵和备份/同步语义确定前不能成为唯一恢复路径。

## 后果与迁移门槛

恢复码丢失且 E2EE 口令也丢失时，数据仍不可恢复，这是 E2EE 的必要结果。恢复码本身是高价值秘密，必须以纸面/密码管理器方式保存，不能截图上传或放入同步数据。

已落地的服务端契约是 `GET/PUT /api/sync/key-package`、`POST /api/sync/key-migration`、`DELETE /api/sync/devices/:clientId`；key-package PUT 只保存 strict schema 校验后的 opaque package，并用 `expectedKeyVersion` 做单步 CAS，同时要求 root fingerprint 不变。独立 DELETE key-package 会拒绝，以免制造“没有可恢复 wrapper”的中间态。

大历史的迁移采用持久 staging 协议，避免把全部密文塞进一个 HTTP body：`POST /api/sync/key-migration` 只创建 manifest，`POST /api/sync/key-migration/:requestId/chunks` 接收有序、可重试的 bounded chunk，`GET` 可恢复进度，`POST .../commit` 才是客户端完成解密/重加密后的原子发布边界，`DELETE` 取消并释放 staging。manifest 固定 `expectedKeyVersion`、`expectedLatestSeq`、独立的 `targetPayloadKeyVersion`、操作数和 payload 字节预算；每个 chunk 有自己的幂等指纹，服务端按 `(operation.id, operation.serverSeq)` 建唯一约束，拒绝缺失/重复/未知/旧世代/legacy 密文。staging reservation 计入配额 admission，过期清理、取消和成功发布都会在事务中释放；普通 `/ops` 上传也必须在同一配额判断中计入仍有效的 reservation，reservation 查询失败时 fail-closed，不能乐观放行。用户行锁与普通上传使用同一锁序，避免 TOCTOU 竞争；真实 PostgreSQL/HTTP 验收必须证明竞争上传返回 `STORAGE_QUOTA_EXCEEDED` 且 operation 没有落库。中断后可以用同一 requestId 查询并续传。最终事务锁定 `user_sync_state`，用一条 SQL `UPDATE ... FROM` 替换全部 operation payload、清除旧快照缓存、调整存储计量、发布 wrapper 与 payload generation，并写入持久化回执。服务端仍不能证明密文内容的密码学正确性；它证明的是完整身份覆盖和原子发布。迁移完成后，上传入口拒绝 legacy 或旧 payload generation。旧的 inline POST 仅保留为受限兼容路径，大历史必须走 staging。客户端宿主接线、跨端密钥迁移和真实安装产物验收仍属于后续收尾。

客户端编排已固定在 `@heyta/app-host` 的 `migrateVaultPayloads`：它只接受服务端专用 inventory 分页，不读取本地 op-log 冒充完整历史；每一页必须保持同一 `latestSeq`、严格递增的 `(serverSeq, id)`，并明确声明没有未迁移的 snapshot 边界。若服务端仍保留 snapshot cache，inventory 必须同时给出 retained causal full-state op 的 `replayBaseServerSeq`，且它必须是首条 retained operation；只有满足这个判据，commit 清除 snapshot 才安全，否则客户端必须以 `snapshot_boundary` 拒绝进入 staging。客户端随后在内存中逐条用旧 root 解密、用新 root 和目标 payload 世代重加密，计算服务端相同的 JSON UTF-8 字节预算，再创建 manifest、上传确定性 chunk id。root、明文和替换载荷不进入普通 storage、op-log 或日志。相同 `requestId` 可重新执行 begin/chunk，commit 响应丢失时必须查询同一 requestId；ciphertext-only durable journal 只保存 manifest 和加密 chunk，用于跨进程复用相同 nonce/fingerprint，绝不保存 root、口令或明文。取消由同一个 remote port 暴露，供宿主在用户明确放弃或确认无法继续时释放 reservation。窄范围判据在 `packages/app-host/tests/vault-migration.spec.ts`：分页完整性、snapshot 边界、分片、目标世代解密和 commit 丢响应恢复；真实 PostgreSQL/HTTP 判据在 `server/tests/integration/vault-key-migration-client.integration.spec.ts` 与 `vault-key-migration-http.integration.spec.ts`。

生产入口由 `VaultKeySession.beginRootRotation` 与 `confirmAndMigrateRootRotation` 组成：前者只生成不同 root 的新 package，后者必须先确认新恢复码，再执行完整密文迁移，成功后才安装新 package 和 payload generation；fingerprint 不变的 wrapper-only 请求会被拒绝。`AppHost.confirmVaultRootRotation` 统一接入服务端 inventory、ciphertext-only journal 和原子 commit，Web 与移动端既有 Vault 设置面板提供轮换按钮、进度、失败重试和取消入口。设备撤销后的旧 tokenVersion 不能复用旧 root；重新认证后必须由仍受信任且已解锁的设备执行完整 rotation。

## B 阶段实施矩阵（2026-10-03）

| 能力 | 状态 | 证据与边界 |
|---|---|---|
| root key、Argon2id wrapper、恢复码、HKDF 功能密钥、record AAD | 已完成 | `@heyta/sync-core` 运行时校验与生命周期测试通过 |
| versioned sync payload codec | 已完成但仅 opt-in | `@heyta/sync-client` codec 路径实测 113 tests；新写入 vault 格式，显式保留 legacy 双读 |
| key-package HTTP 契约 | 已完成当前边界 | 真实 PostgreSQL/HTTP CAS、幂等重试、tokenVersion 撤销、root 更换拒绝、独立删除拒绝共 3/3 条 integration 通过 |
| 全会话 tokenVersion 撤销 | 已完成当前边界 | 设备撤销后旧 JWT 全部 401；新 tokenVersion JWT 仍可读取当前 key package |
| 生产宿主默认启用 vault codec | 部分完成 | Web 与通用宿主在有稳定 accountId 时走 vault session；首次加载会读取服务端 `payloadKeyVersion`。存量旧 op 的完整客户端迁移仍未完成 |
| 存量旧 op 的原子迁移与中断恢复 | 服务端 staging/发布边界与宿主编排、Web/移动端入口完成；真实安装产物互操作待验收 | manifest + chunk + commit/cancel/status、持久化 reservation/回执；`@heyta/app-host` 已具备服务端 inventory 分页、snapshot 安全边界、内存解密/重加密、分片、status/commit 丢响应恢复与 cancel port；session 只在完整迁移成功后安装新 root/package/generation；真实 PostgreSQL/HTTP 覆盖 inventory、snapshot replay base、普通 upload 竞争 reservation、迁移覆盖与原子发布 |
| OS 安全存储原生适配 | Android 运行时已验，iOS 运行时待验 | Android Keystore envelope 的 scope 隔离、四个独立进程、设备重启、删除持久性共五阶段通过；iOS `WhenUnlockedThisDeviceOnly` Keychain 当前仅代码/编译证据，TS port 4 tests |
| OS 安全存储与恢复码 UI | 代码/编译完成，实机待验收 | 移动端设置面板已接入创建、二次确认、口令/恢复码解锁、强制恢复轮换、锁定、opt-in 记住解锁和登出清除；host 首次同步前恢复、持久 remembered-unlock fence、同步 invalidate/epoch、server/token 绑定与 native remove 失败重试已由 `packages/app-host/tests/host.spec.ts`、`apps/mobile/tests/vault-secure-storage.spec.ts` 覆盖；`apps/mobile` typecheck 通过。账号隔离、重启/锁屏可用性、第二进程探针仍需在当前安装产物上执行；没有默认记住解锁或生物识别承诺 |
| Web 恢复码 UI 与浏览器存储边界 | 已完成当前边界 | `e2e/tests/vault-settings.spec.ts`：创建/确认发布、reload 后锁定、错误恢复码拒绝、恢复码解锁、锁定、更换口令和新恢复码确认；明暗截图已人工复查。HTTP fixture 仅覆盖 transport，不替代真实 PostgreSQL |
| Android/iOS/Web 跨端互操作 | 未完成 | 尚未完成新格式安装产物、设备加入/轮换和恢复全链路验收 |

### 真实浏览器与 PostgreSQL 续验入口

`pnpm verify:vault-web`（[`verify-vault-web-journey.mjs`](../../scripts/verify-vault-web-journey.mjs)）
使用隔离库、独立服务端端口和三个 Chromium context，真实点击创建、恢复码解锁、wrapper
轮换与 root 迁移，再由新设备下载重建。只预先建立合成账号的认证，密钥/同步/迁移端点均为
生产 HTTP 路由；不以 HTTP fixture 代替。当前仍在续验，新增入口不等于整条旅程通过。
持久证据截图必须遮住恢复码，测试关闭 trace/video，错误日志不能携带口令或 root。

### 验证纪律

迁移测试不得因为没有 `DATABASE_URL` 而把 `skip` 当成证据。提交前必须在隔离 PostgreSQL 库上用仓库迁移脚本部署最新 schema，再运行 staging HTTP 集成；至少覆盖并发 chunk、同 chunk 重试、过期/取消释放 reservation、配额拒绝、发布前覆盖不完整时的事务回滚，以及与普通 upload、REPAIR、cleanup 的并发回归。配额竞争判据必须检查两件事：普通 upload 返回 `STORAGE_QUOTA_EXCEEDED`，并且该 operation 在数据库中不存在；同时要有 reservation aggregate 异常的 fail-closed 单测。迁移 SQL 失败后只能修复 SQL 并明确 `migrate resolve --rolled-back`，不能直接标记已应用。
