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
- 生产同步现在由明确的会话状态选择格式：尚未建立 vault 的路径保留旧口令格式；新空历史 vault 使用 root-key 格式；已有旧历史的首包保持 legacy generation，必须显式迁移后才能进行普通 vault 同步。本地 op-log 仍保存业务事实，不能把网络密文迁移写成业务 op。移动安装产物互操作仍需单独验收。
- **包修订号与载荷世代不是同一个数字。** `keyVersion` 只表示口令/恢复 wrapper 的修订；服务端 GET 的 `payloadKeyVersion` 才是当前密文写入世代。改口令只推进前者，客户端必须先读取后者再构造新写入 cipher，否则会在已完成原子迁移的账号上被 generation gate 拒绝。已知载荷世代为 null 时必须阻止普通 vault 写入，不能用初始包版本猜测世代。
- **首次发布包也必须经过历史判定。** 服务端在同一个 `user_sync_state → users` 锁序事务中检查 retained operations：空历史才原子发布 `payloadKeyVersion = 1`；已有密码时代历史则发布 wrapper、保持 `payloadKeyVersion = null`，让客户端带旧 E2EE 口令进入第一轮 payload migration。不能凭“没有 key package”推断“没有 legacy ciphertext”。同一个锁序也用于 wrapper-only rewrap；migration commit 另外对当前 wrapper revision/fingerprint 做 CAS，避免长时间迁移覆盖并发的口令包装更新。
- Web 的用户入口嵌入既有“同步设置”面板：创建包后先展示一次恢复码，用户重新输入后才 CAS 发布；已有包支持口令解锁、恢复码解锁、锁定和更换口令。恢复码、root key 和口令都不进入浏览器持久化层。该入口的判据在 `apps/web/tests/vault-settings-panel.spec.tsx`，服务端 GET 元数据接线在 `apps/web/src/lib/vault-session.ts` 与 `packages/app-host/src/vault-session.ts`。
- 移动端用户入口嵌入既有「我的 → 设置 → 同步凭据」面板（`VaultSettingsSection`），不是孤立页面：稳定的 authenticated `accountId` 随活配置传入 host；创建包需要恢复码二次确认，已有包支持口令/恢复码解锁、锁定、更换口令和显式 opt-in 的“记住解锁”。恢复码解锁会把会话置为 `requiresRecoveryRotation`，在新口令与新恢复码发布前 `getPayloadCipher()` 返回 `undefined`，且旧 root 不会写入安全存储。登出会按当前 server/account scope 删除原生安全存储 root；普通 SQLite、sync config 和 op-log 不保存 root、口令或恢复码。
- 移动端自动恢复的唯一入口是 host 的首次 vault session 构造：它发生在首次同步客户端使用前，由 `AppHostOptions.vaultRootKeyStore` 读取 root；打开设置页不能成为恢复依赖。安全存储旁边持久化一个非秘密的 scope-bound remembered-unlock fence：缺失、损坏或读失败一律视为禁用，只有用户明确 opt-in 且 native save 成功后才写入允许值。登出/切换账号先同步写入禁用 fence，再同步调用 `AppHost.invalidateVaultSession()`（递增 epoch、锁定并丢弃会话、fence 在途加载），随后清理 token；native remove 失败仍保留 fence，并通过既有设置面板重试。这样安全存储残留不会在冷启动或同账号重新认证时自动解锁。
- `accountId` 只在同一 `serverOrigin + token` 认证绑定中继承；server 或 token 改变时 host 必须丢弃旧 vault session，不能把旧 accountId 当作新认证的身份。显式 lock/invalidate 后，后续 `getVaultSession()` 保持 locked，直到用户再次明确解锁并选择记住；恢复码解锁和普通口令解锁都不会隐式解除 fence。
- Web 的真实浏览器验收使用 `e2e/tests/vault-settings.spec.ts`：真 Chromium、真 Vite 应用、真 IndexedDB、真 Argon2/AES 与 React UI；HTTP fixture 只替代服务端/Prisma 边界，不能代替 PostgreSQL 集成测试。测试先截图再断言，固定证据在 `apps/web/evidence/vault-panel/`，并人工复查明暗主题截图。尚未创建 key package 时的一次 `GET /api/sync/key-package → 404` 是协议定义的“暂无包”响应，同 scope 的并发加载合并后，测试显式登记这一个 404，同时对其他 console/pageerror 保持严格失败。

## 移动端 OS 安全存储边界

移动端的“记住解锁”只允许由明确的用户 opt-in 调用；启动、同步失败和普通写 op 都不得隐式保存或清除 root key。RN port 只传递 base64 root key 到原生桥，并在调用方的解锁会话内存中使用；它不做缓存、不写 SQLite、不写普通文件，也不会因为同步失败调用清除。登出/切换账号必须显式调用 `remove`（TS 侧同时提供 `clearVaultRootKey` 这个语义明确的入口）。

- Android 使用独立的 `heyta_vault_root_wrap_key_v1` Android Keystore AES-256-GCM 密钥。SharedPreferences 只保存包含 scope 摘要、随机 nonce 和密文的 envelope；scope 的 canonical bytes 同时作为 GCM AAD。该别名与 Widget 的 `heyta_widget_device_key_v1` 完全分离，Widget 的缓存和清理路径不能复用。
- iOS 使用独立 Keychain service，并把 root key 保存为 `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` 的 generic-password item。Keychain account 是 `SHA-256(serverOrigin, accountId)`，不使用 Widget 的 service/access group。
- 两个平台和 TS port 都拒绝空白 `serverOrigin`、空白 `accountId` 及控制字符；保存失败只返回错误，旧 item 不先删除。平台实现不提供生物识别弹窗：WhenUnlocked/Keystore 是可用性边界，生物识别需要独立的用户体验和威胁模型决定。

移动端 port 的初始 4 条 Node 测试（后续扩充为下述 12 条），Android Kotlin 与 iOS workspace Debug 构建通过。2026-10-03 Android 已完成安装产物的 Keystore 运行时验收：[`verify-android-vault-storage.sh`](../../scripts/verify-android-vault-storage.sh) 构建并安装当前 Debug 与 instrumentation APK，执行两个 scope 的隔离、四个独立进程的 seed/verify/remove/clean，并在 verify 与 remove 之间真实重启设备。各进程核对 PID 与系统启动编号，持久文件只含 envelope，删除 A 后 B 仍可读，随后 B 的删除也能跨进程读回。五个测试阶段均通过；[证据](../../apps/mobile/evidence/android-vault-storage.txt) 包含 APK SHA-256，不包含 root key。测试 fixture 是合成密钥，且不进入产品入口。Android wrapping key 当前不要求用户认证，因此本轮不声称锁屏禁读。iOS Keychain 的模拟器跨进程读写/删除已由下文五阶段探针验证；实体设备锁屏行为仍待验证，最终交付还须重装正常 Release。

2026-10-04 Android Release 续验完成了真实认证后的 Vault 首次旅程：登录、保存并启用同步、创建 Vault、恢复码二次确认、显式选择“记住解锁”，以及解锁状态显示均在当前安装产物上通过；[截图证据](../../apps/mobile/evidence/android-vault-created.png) 已人工查看，未保存恢复码、root 或口令。随后实测了冷启动 remembered-root 恢复、真实 UI logout 的 fence 顺序，以及 logout 后重新认证仍保持锁定；逐条的脱敏结果在 [`android-vault-cold-start.txt`](../../apps/mobile/evidence/android-vault-cold-start.txt)。这条链证明“登录态恢复”不会绕过 E2EE 解锁：重新认证只恢复 session 与同步凭据，Vault 仍须显式输入 E2EE 口令或恢复码。

原生验收探针应按同一个 scope 矩阵执行：在 Android 真机上用两个账号 scope 写入两把不同的 32-byte root key，分别 load，删除 A 后确认 A 不可读且 B 仍可读；再从第二个进程/重启后的应用进程读取 B，确认 Keystore 解包和普通存储重载有效。iOS 用两个 Keychain account 做同样的交叉读取/删除检查，并在设备锁定时确认 `WhenUnlockedThisDeviceOnly` 读取失败、首次解锁后恢复。每一步都要记录 app 包身份、scope、返回码和截图/日志；不要把 root key 明文写入日志。若当前测试壳没有第二进程入口，先把“跨进程”标为未验证，不能用同进程线程测试冒充。

2026-10-04 续验把“登出时禁止自动加载”与“原生密钥实际删除”分成两条判据：同 scope 的
native save/load/remove 必须跨 wrapper 实例串行，登出同步推进 epoch、禁用持久 fence，
原生删除排在此前已开始的保存之后；在途 load 返回时再次核 epoch 与 fence。否则旧 save
在 remove 后完成，即便不会自动解锁，原生密钥仍会残留。偏好写失败也必须继续尝试 native
删除，不能短路清理。`apps/mobile/tests/vault-secure-storage.spec.ts` 当前 **12/12** 通过；
隔离副本移除 native 队列后，“登出完成不残留原生 root”断言失败（1 failed / 11 skipped），
不是测试初始化失败。生产源码未做临时变异，不干扰并行原生构建。

## 拒绝的方案

- 不在服务端保存可解密所有数据的托管恢复密钥；这会直接破坏 E2EE 的信任边界。
- 不用登录密码、邮箱找回链接或 JWT 作为数据恢复凭据；它们的生命周期、泄露面和认证语义不同。
- 本阶段不自行实现 Shamir 多方恢复或 WebAuthn PRF。两者可作为未来的额外 wrapper，但不能替代当前已经可验证的口令+恢复码包协议；WebAuthn PRF 在平台支持矩阵和备份/同步语义确定前不能成为唯一恢复路径。

## 后果与迁移门槛

恢复码丢失且 E2EE 口令也丢失时，数据仍不可恢复，这是 E2EE 的必要结果。恢复码本身是高价值秘密，必须以纸面/密码管理器方式保存，不能截图上传或放入同步数据。

已落地的服务端契约是 `GET/PUT /api/sync/key-package`、`POST /api/sync/key-migration`、`DELETE /api/sync/devices/:clientId`；key-package PUT 只保存 strict schema 校验后的 opaque package，并用 `expectedKeyVersion` 做单步 CAS，同时要求 root fingerprint 不变。首次 PUT 还在同步事务中判断历史并返回准确的 `payloadKeyVersion`；key-package GET/PUT 都必须返回完整的 `{ package, payloadKeyVersion }`，客户端不接受只有 wrapper 的旧响应，也不从 wrapper revision 猜 payload generation。migration commit 对 wrapper revision/fingerprint 再做 CAS。独立 DELETE key-package 会拒绝，以免制造“没有可恢复 wrapper”的中间态。

大历史的迁移采用持久 staging 协议，避免把全部密文塞进一个 HTTP body：`POST /api/sync/key-migration` 只创建 manifest，`POST /api/sync/key-migration/:requestId/chunks` 接收有序、可重试的 bounded chunk，`GET` 可恢复进度，`POST .../commit` 才是客户端完成解密/重加密后的原子发布边界，`DELETE` 取消并释放 staging。manifest 固定 `expectedKeyVersion`、`expectedLatestSeq`、独立的 `targetPayloadKeyVersion`、操作数和 payload 字节预算；每个 chunk 有自己的幂等指纹，服务端按 `(operation.id, operation.serverSeq)` 建唯一约束，拒绝缺失/重复/未知/旧世代/legacy 密文。staging reservation 计入配额 admission，过期清理、取消和成功发布都会在事务中释放；普通 `/ops` 上传也必须在同一配额判断中计入仍有效的 reservation，reservation 查询失败时 fail-closed，不能乐观放行。用户行锁与普通上传使用同一锁序，避免 TOCTOU 竞争；真实 PostgreSQL/HTTP 验收必须证明竞争上传返回 `STORAGE_QUOTA_EXCEEDED` 且 operation 没有落库。中断后可以用同一 requestId 查询并续传。最终事务锁定 `user_sync_state`，用一条 SQL `UPDATE ... FROM` 替换全部 operation payload、清除旧快照缓存、调整存储计量、发布 wrapper 与 payload generation，并写入持久化回执。服务端仍不能证明密文内容的密码学正确性；它证明的是完整身份覆盖和原子发布。迁移完成后，上传入口拒绝 legacy 或旧 payload generation。旧的 inline POST 仅保留为受限兼容路径，大历史必须走 staging。客户端宿主与 Web 迁移入口已接通并有下述真实链路证据；移动跨端密钥迁移和真实安装产物仍在收尾。

客户端编排已固定在 `@heyta/app-host` 的 `migrateVaultPayloads`：它只接受服务端专用 inventory 分页，不读取本地 op-log 冒充完整历史；每一页必须保持同一 `latestSeq`、严格递增的 `(serverSeq, id)`，并明确声明没有未迁移的 snapshot 边界。若服务端仍保留 snapshot cache，inventory 必须同时给出 retained causal full-state op 的 `replayBaseServerSeq`，且它必须是首条 retained operation；只有满足这个判据，commit 清除 snapshot 才安全，否则客户端必须以 `snapshot_boundary` 拒绝进入 staging。迁移 inventory 与普通 `/ops` 下载必须对 `entityIds: []` 使用同一 canonical wire identity（空数组省略），否则 AAD 会在迁移写入与新设备下载之间漂移。客户端随后在内存中逐条用旧 root 解密、用新 root 和目标 payload 世代重加密，计算服务端相同的 JSON UTF-8 字节预算，再创建 manifest、上传确定性 chunk id。root、明文和替换载荷不进入普通 storage、op-log 或日志。相同 `requestId` 可重新执行 begin/chunk，commit 响应丢失时必须查询同一 requestId；ciphertext-only durable journal 只保存 manifest 和加密 chunk，用于跨进程复用相同 nonce/fingerprint，绝不保存 root、口令或明文。**服务端返回 `PUBLISHED` 只证明云端原子提交完成，不得单独清 journal：生产宿主必须以 `clearJournalOnPublished: false` 保留 journal，待 `confirmAndMigrateRootRotation` 成功完成本地 `saveBound`（package、payload generation、pending draft 同一事务）后，再调用 `acknowledgeVaultPayloadMigration`。启动 refresh 发现远端 package 正好是 pending target 时，必须保留本地旧 package/root 上下文，让旧口令和原 requestId 恢复；不得先用远端 target 覆盖本地状态。**取消由同一个 remote port 暴露，供宿主在用户明确放弃或确认无法继续时释放 reservation。普通 upload 与 reservation 操作统一按 `user_sync_state → users` 加锁，upload 事务使用 `READ COMMITTED`，由最终条件 UPDATE 重新读取 live reservation；不能只依赖事务外的 quota preflight。窄范围判据在 `packages/app-host/tests/vault-migration.spec.ts`：分页完整性、snapshot 边界、分片、目标世代解密、commit 丢响应恢复，以及真实 SQLite 文件关闭/重开后的跨进程 journal 续传；真实 PostgreSQL/HTTP 判据在 `server/tests/integration/vault-key-migration-client.integration.spec.ts` 与 `vault-key-migration-http.integration.spec.ts`。

Web 宿主还必须把普通同步与 root migration 视为同一账号的一条进程内写队列：`syncNow()`、冲突解决、迁移确认和取消共用 `withWebSyncMutationExclusive`，保证 inventory/stage/commit 完成后才允许下一次本地上传。这个互斥只治理同一页面内的本地竞态；另一台设备的并发写入不能被吞掉，仍须由服务端以 `stale_latest_seq` 拒绝，用户取消残留 staging 后重新开始迁移。迁移失败必须保留 journal 与 pending draft，取消必须先释放服务端 staging 再删除本地 draft。若进程在本地安装成功后、journal ack 前退出，下一次 rotation 允许先以当前 root 的 fingerprint、当前 payload generation 和服务端 `status(requestId)=PUBLISHED` 三项证据清除已完成的旧 journal，再创建新 request；没有这三项证据必须保留 journal 并拒绝继续，避免把未完成迁移误当成已安装。

生产入口由 `VaultKeySession.beginRootRotation` 与 `confirmAndMigrateRootRotation` 组成：前者只生成不同 root 的新 package，后者必须先确认新恢复码，再执行完整密文迁移，成功后才安装新 package 和 payload generation；fingerprint 不变的 wrapper-only 请求会被拒绝。`AppHost.confirmVaultRootRotation` 统一接入服务端 inventory、ciphertext-only journal 和原子 commit，Web 与移动端既有 Vault 设置面板提供轮换按钮、进度、失败重试和取消入口。设备撤销后的旧 tokenVersion 不能复用旧 root；重新认证后必须由仍受信任且已解锁的设备执行完整 rotation。DELETE 响应丢失后即使同绑定重试仍是网络失败、非成功 HTTP 或响应校验失败，也只能报告状态不确定，并沿完整本地清理路径退出；不能把旧 root/凭据留在本地等待下一次重试，也不能把它写成服务端已确认成功。

## B 阶段实施矩阵（2026-10-03）

| 能力 | 状态 | 证据与边界 |
|---|---|---|
| root key、Argon2id wrapper、恢复码、HKDF 功能密钥、record AAD | 已完成 | `@heyta/sync-core` 运行时校验与生命周期测试通过 |
| versioned sync payload codec | 已完成但仅 opt-in | `@heyta/sync-client` codec 路径实测 113 tests；新写入 vault 格式，显式保留 legacy 双读 |
| key-package HTTP 契约 | 已完成当前边界 | 真实 PostgreSQL/HTTP CAS、幂等重试、tokenVersion 撤销、root 更换拒绝、独立删除拒绝、legacy-history bootstrap generation 与 migration-style wrapper race 共 5/5 条 integration 通过；wrapper race 证明持锁的 migration commit 先提交后，旧 expected revision 返回 409 |
| 全会话 tokenVersion 撤销 | 已完成当前边界 | 设备撤销后旧 JWT 全部 401；新 tokenVersion JWT 仍可读取当前 key package |
| 生产宿主默认启用 vault codec | 已完成当前边界 | Web 与通用宿主在有稳定 accountId 时走 vault session；首次加载读取服务端 `payloadKeyVersion`；Web 旧 op 经界面完整迁移和新设备重建已验，Android 与 iOS Release → Node/SQLite 双向互读已验；细节见 [iOS/Node 证据](../../apps/mobile/evidence/ios-node-vault-interop-20261004.txt) |
| 存量旧 op 的原子迁移与中断恢复 | 服务端 staging/发布边界与宿主编排、Web/移动端入口完成；Android Release 旧密文迁移与互操作已验 | manifest + chunk + commit/cancel/status、持久化 reservation/回执；`@heyta/app-host` 已具备服务端 inventory 分页、snapshot 安全边界、内存解密/重加密、分片、status/commit 丢响应恢复与 cancel port；session 只在完整迁移成功后安装新 root/package/generation；真实 PostgreSQL/HTTP 覆盖 inventory、snapshot replay base、普通 upload 竞争 reservation、迁移覆盖与原子发布（10/10）；真实 SQLite 文件关闭/重开续传通过；Android Release UI 迁移 `2/2` 并由 Node/SQLite 新设备重建任务 |
| OS 安全存储原生适配 | Android 与 iOS 模拟器运行时已验 | Android Keystore envelope 的 scope 隔离、四个独立进程、设备重启、删除持久性共五阶段通过；iOS 真实生产 Swift 路径在模拟器完成 scope 隔离、save/load、跨进程重启 load、remove 后重启为空，并直接读取 `kSecAttrAccessible`。实体设备锁屏语义仍需另验（2026-10-04 `xcrun devicectl list devices` 实查仅有 simulated 设备，尚无可用实体 iPhone；模拟器不替代此项） |
| OS 安全存储与恢复码 UI | Android Release 当前旅程已验；iOS 实体设备锁屏语义仍待验 | 移动端设置面板已接入创建、二次确认、口令/恢复码解锁、强制恢复轮换、锁定、opt-in 记住解锁和登出清除；Android Release 已通过真实认证、创建、恢复码确认、记住解锁、冷启动恢复、logout fence 与 logout 后再认证保持锁定（[证据](../../apps/mobile/evidence/android-vault-created.png)、[android-vault-cold-start.txt](../../apps/mobile/evidence/android-vault-cold-start.txt)）。host 首次同步前恢复、持久 remembered-unlock fence、同步 invalidate/epoch、server/token 绑定与 native remove 失败重试已由 `packages/app-host/tests/host.spec.ts`、`apps/mobile/tests/vault-secure-storage.spec.ts` 覆盖；iOS Keychain runtime 探针已覆盖账号隔离、跨进程重启与删除持久性。没有默认记住解锁或生物识别承诺 |
| Web 恢复码 UI 与浏览器存储边界 | 已完成当前边界 | `e2e/tests/vault-settings.spec.ts`：创建/确认发布、reload 后锁定、错误恢复码拒绝、恢复码解锁、锁定、更换口令和新恢复码确认；明暗截图已人工复查。HTTP fixture 仅覆盖 transport，不替代真实 PostgreSQL |
| Android/iOS/Web 跨端互操作 | Android/iOS/Web 已验，iOS legacy migration 仍待验 | Web/PG 三设备与 legacy 旅程已通过；Android 当前 Release 安装产物已重建并通过无 Metro 自足启动/非空截图门禁，真实认证下的 Vault 创建、冷启动恢复、logout fence、logout 后再认证保持锁定、轮换/legacy migration 和 Node/SQLite 跨端任务互读均已验；iOS 当前 Release 真包已完成 iOS → Node 与 Node → iOS 任务互读，仍未把 iOS 真包的 legacy payload migration 记成完成 |
| 设备撤销后的完整旅程 | Web 与 Android Release 的真实撤销/恢复/轮换顺序已验；iOS 已验服务端 JWT fence，本地清理与可信设备轮换仍待验 | `@heyta/app-host` 的共享 `runHostedDeviceRevocation` 负责捕获认证绑定、确认后竞态校验、固定 token、响应丢失后的同绑定重试与“不确定”结果；Web 与移动 Vault 设置只注入提示存储和完整本地 session 清理。成功撤销复用既有凭据清理并使当前设备的 vault session、记住解锁 fence 和原生 root key 失效；移动端提示按账号/服务端持久到轮换完成，列表请求固定同一认证快照，确认框期间切换账号不会误撤销。移动端原生 root 删除失败时，撤销路径把同一 scope 提交给既有设置面板的待重试状态，不能因 token 清除后的 `authStillCurrent=false` 丢掉清理错误。界面明确所有设备必须重新登录、离线设备不会被远程擦除、可信设备仍须完成 root rotation；响应丢失后同绑定重试若仍是网络失败、非成功 HTTP 或响应校验失败，一律只显示状态不确定并本地退出，不能宣称已观察到成功或留下旧 root/凭据。Web + PostgreSQL 旅程已证明真实 WebSocket 以 4003 关闭、旧 JWT 读取密钥包/上传均 401；Android Release 真实旅程已证明设备撤销后 token version 递增、重新认证、恢复码解锁以及 `keyVersion=1→2` / `payloadKeyVersion=2` 轮换（[脱敏证据](../../apps/mobile/evidence/android-vault-revocation-20261004.txt)）。本轮 iOS/Node 真实服务端旅程也证明旧 JWT 对 key package、下载、上传与 status 全部 401 且 latestSeq 不变。iOS 安装产物自身的 UI 撤销、原生清理与可信设备 root rotation 仍待同一旅程完成 |
| 功能密钥与 AI 出境边界 | HKDF 单测与 Web 真实 HTTP 出境、字段投影反向变异已验 | `e2e/vault/ai-egress.spec.ts`：真实 UI 创建 vault、两项任务、习惯与专注记录，先经 PostgreSQL inventory 证明确有对应加密记录；披露只含 title，发送前 provider 零请求，确认后真实 HTTP 只发该标题。请求体和头均无其他任务/习惯/专注、口令/恢复码/root/三个 purpose 密钥及账号凭据，Authorization 仅含 provider 自己的测试凭据。确定性回环 provider 只替代模型输出，不替代出境链；不代表托管 AI 服务已发布 |
| 移动端 legacy payload migration | Android/Web/服务端已验；iOS 待验 | Web + PostgreSQL 已覆盖旧 password ciphertext 到新 payload generation；Android Release 已完成旧口令输入、root migration（进度 `2/2`）和新 Node/SQLite 设备用新口令重建；本轮 iOS Release 已完成当前 vault generation 的双向互读，但没有把它冒充成 iOS legacy migration |

### 真实浏览器与 PostgreSQL 续验入口

`pnpm verify:vault-web`（[`verify-vault-web-journey.mjs`](../../scripts/verify-vault-web-journey.mjs)）
使用隔离库、独立服务端端口和三个 Chromium context，真实点击创建、恢复码解锁、wrapper
轮换与 root 迁移，再由新设备下载重建。只预先建立合成账号的认证，密钥/同步/迁移端点均为
生产 HTTP 路由；不以 HTTP fixture 代替。2026-10-04 三台新设备的完整旅程已通过：
A 创建并上传任务，B 恢复码解锁后强制更新 wrapper，再迁移 root，C 使用新口令下载重建同一任务；
服务端同时核对 wrapper revision 3 与 payload generation 2。
[恢复后的任务](../../apps/web/evidence/vault-panel/pg-03-restored-task.png)、
[迁移终态](../../apps/web/evidence/vault-panel/pg-04-root-rotated.png)、
[第三台设备的真实暗色主题](../../apps/web/evidence/vault-panel/pg-05-new-device-after-rotation-dark.png)
均已人工查看。第二条旅程进一步通过旧 password ciphertext 历史 → 首次发布包保持 `payloadKeyVersion=null` →
填写旧口令迁移到 generation 1 → 新 context 仅凭新口令重建同一任务；
[新设备读取旧任务](../../apps/web/evidence/vault-panel/pg-legacy-new-device.png)已人工查看。
第三条旅程通过真实网络故障验证：chunk 请求中断后刷新浏览器，使用旧口令解锁并重新输入已保存的新恢复码，续传同一 requestId；服务端 commit 已落库而响应被丢弃时查询原请求恢复；取消 STAGING 后服务端返回 CANCELLED，刷新后无残留 pending。
[重启后的恢复入口](../../apps/web/evidence/vault-panel/pg-resume-after-restart.png)已人工查看。
截至 2026-10-04，本入口六条旅程共 **6/6** 通过（18.1 秒）：前三条覆盖三设备、legacy 历史和网络中断/取消；
第四条在 inventory 请求屏障处通过界面新增任务，证明本页普通同步排在迁移发布后，且新设备能读到该任务；
第五条覆盖服务端已提交但浏览器尚未收到响应时的真实 reload 恢复，并在恢复后再次执行
root rotation，证明本地安装成功后 journal 已清理且不会阻止下一次迁移。
第六条通过真实设置页撤销设备，验证 WebSocket 关闭码 4003、旧 JWT 失效、真实密码重新认证、
可信设备 root rotation，以及旧密钥写入被服务端拒绝且 inventory 不增。共享撤销编排的
提示存储失败仍清理会话、异步账号切换保护已进入固定副本复验；六条旅程再次 **6/6** 通过
（17.1 秒）。副本基线为 `73b36a6d`，本轮同步源码逐文件 SHA-256 对账，
包含完整 packages/web 源码依赖，避免只复制导出入口造成混合版本。
原 Vault 设置浏览器用例也已复跑通过（1/1），明暗完成态截图已人工核看。
当前结论仅覆盖该固定源码与测试范围，不代替移动端和四端当前产物验收。
定向调试可用 `pnpm verify:vault-web --grep "device settings"`；完整验收必须不带筛选。
[重启恢复入口](../../apps/web/evidence/vault-panel/pg-resume-after-restart.png)已人工查看。
该结果不覆盖移动原生互操作，
后者继续单独验收。
持久证据截图必须遮住恢复码，测试关闭 trace/video，错误日志不能携带口令或 root。

迁移 stage response 的 `requestId` 是恢复凭据的一部分，不能只依赖请求 URL 或传输层的类型校验。
客户端所有 `begin`、`upload`、`status`、`commit`、`cancel` 响应都必须通过同一个带有
`expectedRequestId` 的校验器，并要求返回值逐字等于本次请求的 id。尤其是 saveBound 后的
journal 自愈：若 `status(oldRequestId)` 返回另一个已发布 migration，即使 key version 和
payload generation 相同，也必须保留旧 journal、拒绝清理并停止下一次 rotation；不能安装或
接受错配响应。该规则由 app-host 的错配响应反例测试固定。

### iOS Keychain runtime 续验（2026-10-04）

[`verify-ios-vault-keychain.sh`](../../scripts/verify-ios-vault-keychain.sh) 使用当前生产
`HeytaVaultSecureStorage.swift` 编译进 iOS 模拟器的 Keychain 专用 Release 配置（为启用
Debug-only probe 入口而带 `DEBUG` 条件，并排除当前工作树中独立的 CardExport 编译错误；这不是
正常 Release 产物，也不替代最终四端重装），通过 AppDelegate 的 probe 入口执行五次独立进程：`clean` 写入两个不同 account scope，读取并校验 32 字节值与
`kSecAttrAccessible`；`verify` 终止后重新启动再读两个 scope；`remove` 删除 A、确认 B 仍可读，
再清除 B 并确认重启后两者均为空。模拟器实际返回的 accessibility 属性逐项精确比对为 `aku`（JSON 保留原始值），
对应生产设置 `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`；两项仅仅相等不足以通过。本轮五阶段均通过，证据保留在
`/tmp/heyta-keychain-probe-{clean,verify,invalid,remove,empty}.json`；探针还以真实生产 `save` 调用
31 字节无效 root，确认该错误路径拒绝写入。探针没有复制 Keychain 实现，也没有使用
macOS Keychain。模拟器不提供真实锁屏/设备迁移语义，因此这两项仍明确待实体设备验收。
持久证据：[clean](../../apps/mobile/evidence/ios-keychain-probe-clean.json)、[verify](../../apps/mobile/evidence/ios-keychain-probe-verify.json)、
[invalid](../../apps/mobile/evidence/ios-keychain-probe-invalid.json)、[remove](../../apps/mobile/evidence/ios-keychain-probe-remove.json)、
[empty](../../apps/mobile/evidence/ios-keychain-probe-empty.json)。

### Android Release 续验（2026-10-04）

移动端的 Release 包必须在当前源码和当前 workspace 依赖构建后再验收，不能用之前安装的
debug/旧 bundle 作为 Vault 证据。此次执行了：

```bash
pnpm --filter @heyta/i18n build
pnpm --filter @heyta/app-host build
pnpm --filter @heyta/mobile build:android
bash apps/mobile/scripts/verify-release-builds.sh android
```

`verify-release-builds.sh` 的 Android 包身份固定为 manifest 的真实 `applicationId=com.heyta`；
`com.heytamobile` 只保留 Activity 的 Java namespace，不能用于卸载、启动或截图判据。API 36
模拟器上 `monkey -p` 可能返回组件 disabled override（-5），因此门禁使用显式的
`am start -W -n com.heyta/com.heytamobile.MainActivity` 并要求 `Status: ok`。本轮包大小为
66,785,976 字节，证据为 [`android-release.png`](../../apps/mobile/evidence/android-release.png)
及 [`android-release.txt`](../../apps/mobile/evidence/android-release.txt)；门禁截图先处理首启
隐私同意，再选择“只用本机”进入任务首页，截图由人工查看，确认是非空的真实任务界面且主蓝可见。

Android Vault UI 必须先通过既有 `verify-mobile-auth.sh` 建立真实认证会话；只在同步设置里
粘贴 JWT 只会配置同步，不会产生 Vault 的 authenticated `accountId`，此时「加密数据钥匙」
显示“请先登录”是正确结果。首次 UI 旅程必须在同一个 TEST_MODE 服务端生命周期内完成认证后再测，
并单独记录创建/确认/opt-in 与冷启动恢复、logout fence、轮换、跨端互读这些判据；不能用首次
会话的“记住解锁”状态代替冷启动后重新认证的自动恢复证据。不得把“服务端进程在启动脚本退出后已被清理”
或旧 UI 截图记成 Vault 失败/成功。所有恢复码截图必须先遮挡，再写入 evidence；恢复码、root、口令不能进入
dump、logcat、trace 或文档。

同一 Release 产物随后完成了 root rotation 与旧密文迁移：真实设置 UI 以旧 legacy 口令和新恢复码确认轮换，迁移进度到达 `2/2` 后回到已解锁状态；新的 Node/SQLite 宿主在同一账号下传入轮换后的 E2EE 口令，真实下载并重建了 Android 创建的任务，结果为 `synced`、1 条任务、0 pending。随后补做了同一真实服务端生命周期内的非空双向互操作：Android UI 创建的任务由 Node/SQLite 读到，Node 创建的第二条任务由 Android Release 真 AX 树读到，服务端序号从 1 推进到 2；脱敏证据见[Android 撤销与双向互操作证据](../../apps/mobile/evidence/android-vault-revocation-20261004.txt)。该证据覆盖 Android ↔ 非 UI 宿主的移动互操作边界，但不替代 iOS 安装产物验收。Node/非 UI 宿主进入 Vault codec 时必须同时提供 authenticated `accountId` 并显式 unlock key package；该解锁现在延迟到显式 `sync()`，因此离线 `list`、`add`、`pending` 和导出仍可使用本地 SQLite，不因服务端不可达而在宿主构造阶段失败。`@heyta/node-host` 的 11 个测试文件 / 186 条测试已验证构造、列举、写入、pending 与导出零网络请求，只有显式 `sync()` 才触发远端失败。只提供 JWT 或把 E2EE 口令当 legacy password cipher 会得到 `undecryptable-page`，不得把它误判成服务端密文损坏。

同一 Android Release 旅程还完成了设备撤销后的恢复顺序：设置页列出设备，撤销后服务端递增
token version 并要求所有设备重新登录；重新认证后使用恢复码解锁，再发布新的 E2EE 口令和恢复码。
服务端 package 对账为 `keyVersion=1→2`、`payloadKeyVersion=2`，脱敏证据见[设备撤销证据](../../apps/mobile/evidence/android-vault-revocation-20261004.txt)。
这条证据只覆盖 Android 安装产物；离线设备不会被远程擦除，iOS 真包的本地清理与可信设备
root rotation 仍按矩阵保持待验。

### 验证纪律

迁移测试不得因为没有 `DATABASE_URL` 而把 `skip` 当成证据。提交前必须在隔离 PostgreSQL 库上用仓库迁移脚本部署最新 schema，再运行 staging HTTP 集成；至少覆盖并发 chunk、同 chunk 重试、过期/取消释放 reservation、配额拒绝、发布前覆盖不完整时的事务回滚，以及与普通 upload、REPAIR、cleanup 的并发回归。配额竞争判据必须检查两件事：普通 upload 返回 `STORAGE_QUOTA_EXCEEDED`，并且该 operation 在数据库中不存在；同时要有 reservation aggregate 异常的 fail-closed 单测。迁移 SQL 失败后只能修复 SQL 并明确 `migrate resolve --rolled-back`，不能直接标记已应用。

本 ADR 的实施记录也遵守同一条收口规则：架构结论只改 ADR，当前完成度只改本 ADR 的实施矩阵和对应阶段计划，具体事故追加到[环境陷阱全集](../reference/environment-traps.md)；证据必须从原计划或本 ADR 链入，不能另建“记忆”或孤立验收文档。代码、类型检查和包级测试只能证明实现层，不能把真实服务端/真实安装产物/跨设备下载的缺口写成已完成。移动端设备撤销必须按以下顺序逐项回填：真实认证与 `accountId` → 设置页列出设备 → DELETE 后旧 JWT 与旧 WebSocket 均拒绝 → 本地 token、Vault session、remembered-unlock fence 和原生 root 清理 → 重新认证 → 可信设备 root rotation 与密文迁移 → 新设备真实下载重建。任一步缺证据，就保留“待验证”状态，并把失败原因写在原入口；不得用另一平台或旧产物的成功记录覆盖它。

### 帮助入口对账（2026-10-04）

真实浏览器截图发现帮助页仍把“无恢复能力”当作 E2EE 的定义。已在原中英 FAQ、口令、账号与丢失说明中修正：保存恢复码后的端上解锁、恢复后更换口令/恢复码、登录重置不能解密、旧密文须原口令迁移、记住解锁默认关闭及本地明文边界；同时重新生成四份 FAQ/口令静态 HTML 的 SEO/JSON-LD。
[中文帮助页](../../apps/landing/evidence/vault-recovery-zh.png)与[英文帮助页](../../apps/landing/evidence/vault-recovery-en.png)均已人工查看。定向副本 i18n 26 项、landing 1317 项和真实浏览器 landing 18 项通过；这只验证说明与渲染，不替代移动恢复/撤销旅程。经验写入 AGENTS §8.17 与环境陷阱 #212。

### AI 出境的真实边界续验（2026-10-04）

固定验证副本运行 `node scripts/verify-vault-web-journey.mjs ai-egress.spec.ts`，**1/1 通过（3.6 秒）**。数据准备走生产 UI、IndexedDB、真实加密 HTTP 与 PostgreSQL；模型观察器用临时端口接收真实请求，仅在内存保留 body/headers，输出为确定性清单。测试分别检查字段精确投影、未发送前零请求、发送后单请求、provider 凭据归属与密钥常见编码的缺席。截图 [发送披露](../../apps/web/evidence/vault-panel/pg-ai-egress-disclosure.png) 和 [返回结果](../../apps/web/evidence/vault-panel/pg-ai-egress-result.png) 已人工打开检查。

该判据不导入生产字段投影函数来构造期望值；排除项必须先真实存在，不能在空账号上证明“没有外发习惯/专注”。inventory 契约没有 `isPayloadEncrypted` 字段，正控直接检查协议公开头与实体类型；头长度从字节串推导，不能手写易错偏移。失败输出只报告布尔断言，不打印原始请求、恢复码或密钥，关闭 trace/video 并遮盖失败截图中的敏感输入。未完成的原生平台/四端当前产物边界仍以上表为准。

`node scripts/mutate-e2ee-key-lifecycle.mjs --egress` 隔离运行完成正控→变异→还原三轮：正控 1/1，改为序列化整个 task 的变异命中“只发送披露标题”的具名断言，还原并重建后 1/1。Playwright JSON 报告确认失败发生于字段边界而非启动/构建，未把缺日志或资源锁拒绝当作 caught；三个报告均零 skipped。该模式扩充既有 B 变异入口，不另建孤立验收文档。

### 验收诊断的秘密边界（2026-10-04）

实测 Playwright 1.63 的 `error-context.md` 会独立于 trace/video/screenshot 保存页面无障碍树。Vault 配置与敏感测试 helper 已禁止该自动快照；恢复码、口令输入失败不再携带原始 fill 调用值，恢复码格式与持久化否定断言只输出布尔结果。`pnpm check:vault-diagnostics` 已接入全仓 `check` 与 Vault 旅程前置：使用运行时合成秘密分别触发页面断言失败、缺失输入控件失败，安全分支产物不含秘密，移除保护的负向对照确实泄漏并被捕获。保护后的当前测试文件对固定 web/server 产物复验 **7/7（19.9 秒）**，涵盖恢复、并发迁移、丢响应、旧历史、设备撤销和 AI 出境；静态产物与先前固定副本相同，未外推主树后续平台改动。

同轮 HTTP fixture 用例复验 **1/1（3.5 秒）**，亮暗主题截图已打开检查。静态生产产物的 Service Worker 会绕过 `page.route`，故该 fixture 显式关闭 worker；这项控制不替代 PWA 验收。恢复码轮换后的存储否定断言同样仅输出布尔结果，避免失败时打印实际存储内容。

### iOS Release ↔ Node host 与 JWT fence（2026-10-04）

本轮在独立 iOS 模拟器安装当前源码构建的 Release 包，并使用真实 Fastify + PostgreSQL
服务端和新建的真实 SQLite Node host 完成双向互读。iOS 先创建并上传任务，Node host 在同一
authenticated `accountId`、轮换后的 E2EE 口令和当前 JWT 下 `sync` 后列出该任务；Node host
再创建第二条任务并上传，iOS Release 包再次同步后在 AX 树中读到该标题。两端均走 Vault
payload codec，服务端状态为 `keyVersion=2`、`payloadKeyVersion=2`。脱敏取证保存在
[iOS/Node 证据](../../apps/mobile/evidence/ios-node-vault-interop-20261004.txt)，不含 JWT、
恢复码、口令或 root。

随后撤销 Node 设备。撤销响应为 `requiresKeyRotation=true`；撤销前 JWT 对 key package、
ops 下载、ops 上传和 status 均收到 `401 TOKEN_REVOKED`。用新 JWT 对照旧 JWT 上传前后的
`latestSeq` 均为 2，故失败上传没有改变服务端事实。这条证据证明服务端 `tokenVersion` fence，
不等于 iOS UI 已完成“撤销 → 本地 fence/native remove → 重新认证 → 可信设备 root rotation”
的完整移动旅程；该缺口继续保留在实施矩阵。

root key 的生产边界也必须如实区分：iOS 不把 root 持久化，轮换完成后不能从安装目录取出旧
root 来制造一条假“真包旧 root”证据。现有 sync-core/app-host 确定性 fixture 已验证错误
fingerprint 抛 `root-key-mismatch`，且迁移后的新世代密文拒绝旧 root/旧世代解密；该结果已在
证据文件中标明为 fixture，不能外推为 iOS 进程外旧 root 运行时验收。真实安装产物若要补这
一条，必须在同一受控 rotation 旅程中只记录布尔结果，绝不落盘或打印 root。

设备撤销取证补强（2026-10-04）：首次 HTTP 成功响应若 JSON 损坏或 `clientId` 不匹配，低层 transport 仍拒绝将其当作成功；共享编排把它视为提交结果不确定，用原认证绑定重试一次，重试失败则保留轮换提示并清理绑定的本地会话。不能因为响应格式错误就推断服务端没撤销。两条回归在旧实现上明确失败（2 failed / 8 passed），修复后设备管理与编排测试 **15/15**；未放宽响应 schema，也不会清理期间切换到的新账号。

### iOS 当前产物构建与证据边界（2026-10-04）

为补做 iOS 安装产物旅程，曾把当前源码冻结到 `/tmp/heyta-b-ios-fixed-src`，记录源码清单哈希后单独执行
Release 构建。第一次失败发生在 Xcode 参数解析阶段（把不支持的 `-parallelizeTargets NO` 当成了 build action），没有产生编译结果；修正命令后，构建实际进入 Pods，随后被 Xcode 27.1 beta 的
`Internal inconsistency error: never received target ended message` 中断，错误 target 为
`React-oscompat`，触发点是 Hermes CocoaPods 脚本阶段。该结果是构建工具链失败，不能记作产品失败，
也不能安装过期的旧包来填补 B 的 iOS 证据。

今后的固定规则是：iOS B 的真实 UI/Keychain/迁移证据必须来自当前源码哈希对应的正常 Release 包；
构建中断时保留冻结副本、Xcode 版本、目标设备、target 和原始日志，先修复或更换可验证的构建载体，
再继续旅程。旧包、`schedule()` 返回、任务 SQLite 写入、Node/SQLite 互操作或服务端 JWT fence
都不能单独升级“iOS 安装产物的本地清理、legacy migration、实体设备锁屏”这三项状态。该规则与本 ADR
实施矩阵的“待验”状态绑定，避免将另一平台或旧产物的成功记录写成 iOS 已完成。

### iOS 主路径的认证阶段边界（2026-10-04）

当前移动端粘贴登录令牌的状态机是两段式：`verifyMagicLink` 成功只把会话保存在内存；用户
仍必须在真实 UI 按下“保存并启用同步”，该动作才调用 `saveAuthSession`、写入带
`accountId` 的同步配置并启动 `syncNow`。iOS 输入验收曾漏掉这一步，令牌兑换后直接等待
Profile 的“立即同步”，210 秒后报主路径失败；同轮旧凭据兜底路径仍能完成同步，故该红灯是
验收器漏动作，不是可用的产品成功证据。脚本现逐段回读并按下“保存并启用同步”，再检查 Profile
同步状态。今后认证 UI 任何阶段变化都必须先对照 AuthScreen 状态机与 `saveAuthSession` 接线，
不能用后续手工凭据成功覆盖中间阶段。
