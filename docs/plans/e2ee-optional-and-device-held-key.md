# E2EE 可选 + 钥匙由设备持有：实施计划（ADR-0080）

> 状态：**进行中 · S0–S4 与 S7 收口；S5 缺三端原生钥匙串、S6 缺"开启加密"表单**（逐阶段对账见 §13；端到端与四端装机的边界见 §11）
> 决策：[ADR-0080](../adr/0080-e2ee-is-optional-with-device-held-key.md)
> 依据：[key-decisions](../agents/key-decisions.md)（2026-11-01 那条）、[db-migrations](../agents/db-migrations.md)、[overlay-feedback](../agents/overlay-feedback.md)、[ui-acceptance](../agents/ui-acceptance.md)

---

## 0. 一句话

**默认加密不变，动的是三件：用户能关掉、口令不再天天要、服务端要能按账号模式收两种载荷。**

ADR-0080 定了"是什么"，本篇只定"按什么顺序做、每刀怎么证明它真的生效"。

## 1. 现量（动手前的事实，逐条可复跑）

| # | 事实 | 出处（现量） |
|---|---|---|
| 1 | 服务端**主动拒收明文**：`isPayloadEncrypted !== true` 或不是密文形状 ⇒ 拒，ops 与 snapshot 两条入口 | `server/src/sync/sync.routes.payload.ts:47-52`；调用点 `sync.routes.ops-handler.ts:139`、`sync.routes.snapshot-handler.ts:124` |
| 2 | 客户端只有两种写法，**都是加密**：`'password'`（legacy）与 `'vault'` | `packages/sync-client/src/payload-cipher.ts:25-27` |
| 3 | 无钥即停：`getPayloadCipher()` 拿不到 ⇒ `no-encryption-password`，**绝不降级明文** | `packages/sync-client/src/client.ts:794-810` |
| 4 | 账号级世代在 `vault_key_packages.active_payload_key_version`；`null` = 还没做过首次迁移 | `server/prisma/schema.prisma:701-715` |
| 5 | 迁移 staging 已有：`VaultKeyMigration` + chunk + staged operation，commit 是原子发布边界；契约在 `vault-key-migration-contract.ts` | 同文件 `:717-750`、`packages/shared-schema/src/vault-key-migration-contract.ts` |
| 6 | **每条 op 已自带 `isPayloadEncrypted`（默认 false）**，且 `conflict.ts` / `op-replay.ts` 会读它 | `schema.prisma:259`、`sync/conflict.ts:521-583`、`sync/op-replay.ts:160` |
| 7 | 移动端已有 Keystore/Keychain，"记住解锁"是**显式 opt-in** | `docs/adr/0050` §移动端 OS 安全存储边界 |
| 8 | 桌面钥匙串**只在 macOS 可用**（`/usr/bin/security -i`） | `apps/node-host/src/keychain-secret-store.ts:19-45,125` |
| 9 | Web 今天 reload 即锁 | `docs/adr/0050` 实施矩阵"reload 后锁定" |

第 6 条是本节最要紧的一条：**op 自己带着加密标志**，所以"整库同模式"不能只当约定 —— 它必须被断言。

## 2. 目标与非目标

### 目标

1. 用户能在设置里**显式关掉**端到端加密，关掉后云上是明文，且**历史也变明文**（不留半密半明）。
2. 关掉之后能在**任何一台新设备不带任何秘密**读到全部历史。
3. 加密=开 时，口令只在**加新设备 / 恢复码救 / 主动轮换**出现；日常不出现。
4. 两个方向都允许（开发阶段无存量 ⇒ 可逆），但"关闭"的不可撤回窗口写进文案。

### 非目标（明确不做，别顺手加）

- 不做"服务端持钥"档（ADR-0080 §四 选项 B）——那是"我信你"，语义不同，另起 ADR。
- 不改 [ADR-0050](../adr/0050-e2ee-key-lifecycle-and-recovery.md) 的 wrapper/恢复码协议。
- 不改 [ADR-0079](../adr/0079-profile-fields-are-plaintext.md)（基础资料明文）。
- 不改 [ADR-0006](../adr/0006-supply-modes.md) 的出境授权粒度；关掉加密 **不等于** 授权 AI 出境。
- 不动 `CURRENT_SCHEMA_VERSION`（那是实体 schema；这里只加库表列）。
- 不在 readable 模式下保留旧 key package 或旧恢复码。
- 本期不做 Windows / Linux 的 OS 钥匙串（DPAPI / libsecret）——那两平台继续"每次输入"，UI 如实标注。

## 3. 阶段划分

七刀，每刀**自己可验收、自己可回滚**（S2 commit 之后不可回滚，见 §6）。S0/S1 不改任何存量行为，
可以先落、先跑绿，再谈开关。

---

### S0 · 契约与判定（零行为变化）

**范围**：把"账号模式"变成可读、可测的字段，但所有路径仍按 `e2ee` 走。

| 改动 | 文件 |
|---|---|
| `user_sync_state` 加 `payload_mode`（`TEXT NOT NULL DEFAULT 'e2ee'`，CHECK 只允许两值） | `server/prisma/schema.prisma`、`server/prisma/migrations/20261101120000_add_payload_mode/` |
| ⚠️ `VaultKeyMigration` 的 `target_mode` 与 key 列可空化**推后到 S2** —— 那是 S2 真正要用它的时候，S0 不先改结构 | 见 §3 S2 |
| 读模式的**唯一**入口：`sync/services/` 里一个 `readPayloadMode(tx, userId)`，失败一律返回 `'e2ee'`（fail-closed） | `server/src/sync/services/` |
| 契约：`GET /api/sync/key-package` 响应**只增可选** `payloadMode`（缺省按 `e2ee`） | `server/src/sync/sync.routes.ts` + `packages/shared-schema/src/vault-key-contract.ts` |

**判据**

- `readPayloadMode` 三态单测：有行/无行/读失败 ⇒ `'e2ee' | 'e2ee' | 'e2ee'`（fail-closed 那条必须红过）。
- 契约测试：老响应（无 `payloadMode`）必须被客户端读成 `e2ee`；新增字段不得让既有快照/契约断言红。
- 迁移：`pnpm check:migrations` 绿；`payload_mode` 对既有行回填 `e2ee`（开发阶段本就全 e2ee）。

**可回滚**：是（列可留，代码不读）。

**落地读数（2026-11-01）**：`server/tests/payload-mode.spec.ts` **5/5**；
变异臂「把 fail-closed 改成 fail-open」⇒ **2 红**（未知值 + 读抛异常两格）。
`check:migrations`、`check:schema-migration-drift`、shared-schema 11 文件 173 条 全绿。

---

### S1 · 闸门模式化（行为零变化，这是最小可验证的一刀）

**范围**：把"拒收"从"只认密文"变成"按模式认一种、拒另一种"。`e2ee` 路径的对外行为**逐字节不变**。

| 改动 | 文件 |
|---|---|
| 纯函数 `payloadGateViolation(mode, item)` 取代散落的 `violatesE2eeGate` 调用；返回 `null` / `'need-e2ee'` / `'need-plaintext'` | `server/src/sync/sync.routes.payload.ts` |
| 两个 handler 各取一次模式、传进去；拒绝**仍在指纹/配额/落库之前** | `sync.routes.ops-handler.ts:139`、`sync.routes.snapshot-handler.ts:124` |
| 新错误码 `PLAINTEXT_REQUIRED`（服务端错误形状按 `check:server-error-shape`），**消息里永不含载荷** | 同上 + `server/src/api-error.ts` |

**判据（四格表，逐格断言）**

| 账号模式 | `isPayloadEncrypted` | 期望 |
|---|---|---|
| `e2ee` | `true` + 密文形状 | 放行 |
| `e2ee` | `false` / 缺失 / 形状不符 | 拒（沿用今天的 `E2EE_REQUIRED`） |
| `readable` | `false` + 明文形状 | 放行 |
| `readable` | `true` / 缺失 | 拒（新码 `PLAINTEXT_REQUIRED`） |

- 拒绝路径必须断言 **零行落库**（与今天 `E2EE_REQUIRED` 同等：拒绝发生在配额与指纹之前）。
- **负对照**：把模式强制成 `readable` 后，今天那批"拒明文"的既有断言必须**红**；红不了说明闸门没真的换成模式化。

**可回滚**：是（模式恒为 `e2ee` 时与今天等价）。

**落地读数（2026-11-01）**：`server/tests/payload-gate.spec.ts` **8/8**（四格纯函数表 +
两条路由拒绝 + 一条 fail-closed）；变异臂「闸门两种都放行」⇒ **6 红**。
回归：上传/操作/金库四套 **61/61**；`check:server-error-shape`、`check:safe-error-fallbacks`、
`check:layering` 全绿。

---

### S2 · 关闭：整库解密重传

**范围**：`e2ee → readable`。复用既有 staging，**不新造协议**。

流程（顺序是硬的）：

1. 客户端（已解锁）`begin`：`target_mode='readable'`，带 `expectedLatestSeq`、操作数、字节预算；
2. 本地逐条解密 → 以**明文形状**分片上传；服务端校验明文形状、做配额与幂等（沿用 chunk 的指纹机制）；
3. `commit` 在**一个事务**里：替换全部 payload、`payload_mode='readable'`、清
   `active_payload_key_version`、**删除 `vault_key_packages` 行**、释放 reservation、写回执；
4. 其它设备下次同步读到 `payloadMode='readable'` ⇒ 丢 root、清 Keychain/Keystore、走无钥路径。

**判据**

- 真实 PostgreSQL + HTTP 集成（不是 pglite）：关闭后 `payload_mode='readable'`、
  `active_payload_key_version IS NULL`、`vault_key_packages` 无该 user 行、staging 行已删。
- **新设备不输入任何口令**下载并重建全部任务（真 HTTP，真库）。
- 中途断网：`status(requestId)` 可续；`cancel` 后 reservation 释放、模式保持 `e2ee`。
- 并发：关闭期间另一台设备上传 ⇒ 被 `staleLatestSeq`/模式拒收，**不得**混进一条密文行。

**可回滚**：❌ 不可。commit 之后数据已明文，撤回只能再走 S3。

**落地读数（2026-11-01，真实 PostgreSQL 14）**：
`tests/integration/payload-mode-migration.integration.spec.ts` **3/3**
（关闭 → 明文/readable/包已删；重复关闭 ⇒ `wrong_payload_mode`；再打开 ⇒ 首次发包含：
`keyVersion=1`、`payloadKeyVersion=1`、行重新标成已加密）。
单元侧 `tests/payload-mode-migration.service.spec.ts` **7/7**，变异臂「发布时把
`is_payload_encrypted` 写死成 TRUE」⇒ **1 红**。
⚠️ **客户端那一半（读 `payloadMode`、切换入口）属于 S4**，本阶段只证服务端边界。

---

### S3 · 打开：新 root + 全量加密

**范围**：`readable → e2ee`。

1. 新建 root + **新**恢复码 + package（不复用任何旧包装）；
2. 走同一套 staging 反向迁移（`target_mode='e2ee'`，`targetPayloadKeyVersion` 递增）；
3. `commit` 后其它设备必须重新解锁，否则停在 `no-encryption-password`。

**判据**

- 打开后旧口令、旧恢复码都解不开，且报的是"解不开"而不是"同步失败"（区分 `undecryptable-page` 与网络失败）。
- 新设备用新口令读到全部历史；`active_payload_key_version` 严格递增。
- **拒绝降级**：模式切回 `e2ee` 时本机无钥 ⇒ 必为 `no-encryption-password`，
  且抓包确认**零个**明文载荷被尝试上传。

**可回滚**：✅ 可（再关一次）。

---

### S4 · 客户端模式感知

**范围**：`@heyta/sync-client` / `@heyta/app-host`。

| 改动 | 文件 |
|---|---|
| 第三种写法 `'plain'`；`SyncEncryptionOptions` 加一支 | `packages/sync-client/src/payload-cipher.ts` |
| 上传前后按模式拒错配：mode=e2ee 且无钥 ⇒ 停；mode=plain ⇒ **绝不加密上传** | `packages/sync-client/src/client.ts` |
| 读侧**两种都要能读**（迁移期 + 另一台设备未跟进），读法按每条 op 自己的 `isPayloadEncrypted` 分流 | 同文件 `download()` |
| 宿主把服务端 `payloadMode` 传给 sync client；readable 时不构造 vault session | `packages/app-host/src/host.ts`、`sync-wiring.ts`、`vault-session.ts` |
| **整库同模式断言**：读到与账号模式不符的行 ⇒ 结构化上报，不静默合并 | 同上 |

**落地读数（2026-11-01）**：
`packages/sync-client/tests/plain-payload-mode.spec.ts` **3/3**（明文上传写 `isPayloadEncrypted:false`
+ 明文 JSON；无钥可同步；读到密文行 ⇒ `payload-mode-mismatch` 且一条都不交给 op-log）。
变异臂「把模式错配降级成普通 Error」⇒ **1 红**（原因会退回 `undecryptable-page`，
那会叫明文账号的用户去"核对口令"——一个他根本没有的东西）。
整套 `@heyta/sync-client` **174/174**。

新增闭集成员 `payload-mode-mismatch` 的五处登记（这是本仓库"原因必须能翻成人话"的纪律）：
`sync-client` 联合、`packages/ui/src/sync/model.ts` 映射、i18n 中英两句、
`apps/web/tests/sync-reason-coverage.spec.ts` 表与计数、`apps/mobile/src/sync/status-text.ts` 见证表。

⚠️ **宿主"按服务端模式选客户端"的接线留到 S6**：那一步依赖设置页拿到模式与开关，
本阶段只证 `@heyta/app-host` 能把 `encryptionMode:'plain'` 原样透传（app-host 2070 条绿）。

**判据**

- 单测：三模式 × 有钥/无钥 × 行自带标志 的组合表。
- 变异：删掉"按模式拒错配"那支 ⇒ S2/S3 的集成断言必须红。
- 真浏览器：关掉 → 刷新 → 不输口令读到历史（这条就是用户能看见的那一步）。

---

### S5 · 钥匙默认由设备持有（可与 S2–S4 并行）

| 平台 | 改动 | 判据 |
|---|---|---|
| Android / iOS | 创建 vault 时**默认勾选**"记住解锁"；fence 语义不变（登出即禁用、切换账号即失效） | Release 包冷启动**不输入口令**能同步；logout 后仍为锁定 |
| macOS 桌面 | 复用 `security -i` 那条实现，做成 app-host 的 `vaultRootKeyStore` 端口实现 | 冷启动免输；钥匙串锁住 ⇒ 降级为需输入（不崩） |
| Web | root 放 `sessionStorage`（**不放 `localStorage`**），活到标签页关闭 | reload 后免输；关标签页后需重输 |
| Windows / Linux | **不做**，UI 明示"本平台每次需输入" | 文案断言 |

⚠️ Web 那条要在文案里说清它挡的是服务器、不是本机浏览器（ADR-0080 §九 第 2 条）。

**落地读数（2026-11-01）**

| 面 | 状态 | 证据 |
|---|---|---|
| Web（含 macOS 壳里那套 `web-dist`） | ✅ 已落 | `apps/web/src/lib/vault-root-cache.ts` + `vault-session.ts` 的读/写/清三处接线；`tests/vault-root-cache.spec.ts` **6/6**，变异臂「换 `localStorage`」⇒ **1 红**（"一个字都不进 localStorage"那条）；面板回归 **7/7** |
| Android / iOS | ⚠️ 默认值已改（`useState(true)`），**设备腿未验** | 需要当前源码的 Release 包跑"创建 vault → 冷启动免输"，本机没有该产物；不做声明 |
| macOS / Windows / Linux 的 **原生**钥匙串 | ❌ 未做，且 macOS 不是"顺手接一下" | 现量：`grep -c vaultRootKeyStore apps/desktop/src/host.ts` = **0**、`apps/desktop-macos/.../HeytaMacApp.swift` = **0** —— 桌面壳根本没有这个端口。macOS 壳是 WKWebView 载 `web-dist`，要接到 `security`/Keychain 得先造一层 Swift↔JS 桥，那是一件独立工程 |

🔴 因此 ADR-0080 §九 第 1 条要从"Windows/Linux 未实现"扩成"三端原生都未实现"，
而 macOS 的理由是**壳里没有这个端口**，不是没来得及。

---

### S6 · 界面：两个轴 + 危险确认

- 设置 →「同步与隐私」两行：**端到端加密**（开/关）、**钥匙放在哪**（仅加密=开时出现）。
- 关闭走确认浮层，按 [overlay-feedback](../agents/overlay-feedback.md) 的"危险四档"定档，逐条列后果：
  ① 服务端能看到任务内容；② 忘记口令不再等于丢数据；③ 已进快照的明文收不回来。
- 关闭按钮文案**不许**写"更安全/更私密"式比较，只写"谁能读"。

**落地读数（2026-11-01，只到"宿主编排"这一层）**

| 面 | 状态 | 证据 |
|---|---|---|
| 宿主按服务端模式选客户端 | ✅ | `packages/app-host/src/payload-mode-client.ts` + `host.ts` 在 `sync()`/`resolveConflict()` 前刷新；`tests/payload-mode-client.spec.ts` **6/6**；`tests/payload-mode-host.spec.ts` 用**真实 SQLite** 证明 readable 账号上传的是明文 JSON 且 `isPayloadEncrypted:false`。变异臂「忽略服务端模式」⇒ **1 红** |
| 关闭编排（整库解密重传） | ✅ 库层 | `packages/app-host/src/payload-mode-migration.ts`；`tests/payload-mode-migration.spec.ts` **4/4**（begin 不带包/世代、翻页期间历史变了不 begin、解密失败不发布混合历史、没到 PUBLISHED 就报错）。变异臂「跳过解不开的 op」⇒ **1 红** |
| 设置页"同步加密"那一格 + 危险确认 | ✅ **组件与判据已落，尚未挂进面板** | `apps/web/src/features/sync/EncryptionModeSection.tsx`：一个轴（加密开/关）+ 复用 `DangerConfirmDialog`；`tests/encryption-mode-section.spec.tsx` **7/7**（三格：开/关文案、点关闭先弹确认不执行、**三条后果逐条数**）。变异臂「删掉不可逆那条」⇒ **1 红**。`check:overlay` / `check:danger-confirm` 绿 |
| 钥匙放在哪那一轴 | ✅ 已落 | `vault-root-preference.ts`（偏好只存 `device`/`ask` 两个字面量，**不含秘密**；读不到一律回默认 `device`）；`vault-session.ts` 在**写**与**读**两处都尊重它（选 `ask` 时既不写钥匙、也不用旧缓存自动解锁，并把旧的那份清掉）；面板切到 `ask` 时立刻 `lockWebVaultSession()`。判据：`vault-root-preference.spec.ts` **4/4** + 组件侧 **14/14**（含"不传就不画""加密=关时不画""aria-pressed 反映当前值"）。变异臂「明文模式也画这一行」⇒ **1 红** |
| 宿主接线入口 | ✅ 已落 | `AppHost.getPayloadMode()` / `disablePayloadEncryption()`；后者**未解锁直接拒绝**（没有钥匙就没有能解密的路径），成功后翻模式缓存并作废会话 |
| 挂进面板 | ✅ 已落 | `VaultSettingsPanel` 顶部渲染；web 侧直接调 `disableVaultPayloadEncryption` + 现有 inventory/remote 端口 |
| 开启方向的**编排库层** | ✅ 已落 | `enableVaultPayloadEncryption`：起点版本 0 / 目标世代 1 / 包由迁移**携带**（先 PUT 会造出服务端不可表示的中间态）。`tests/payload-mode-migration.spec.ts` **8/8**；变异臂「删掉'起点已是密文'守卫」⇒ **1 红**（第一版测试没抓住 —— 因为经 JSON 分支也回同一个 code，改成断言具体句子后才咬住） |
| 开启方向的**会话入口** | ✅ 已落 | `VaultKeySession.confirmAndMigrateReEncryption`：确认恢复码 → 用新 root 迁移 → 原子安装首包与世代 1；`currentPackage` 必须为空（有包走轮换那条）。`tests/vault-session.spec.ts` **20/20**；变异臂「世代校验放宽成 `<= 0`」⇒ **1 红** |
| 开启方向的**宿主入口** | ✅ 已落 | `beginPayloadEncryption(passphrase)` / `confirmPayloadEncryption(pending, code, onProgress)`，与既有创建/轮换同形（两步：先抄恢复码）。app-host 相关 5 套 **61/61** |
| 🔴 顺手堵掉一个**我引入的**风险 | ✅ 已修 | 明文模式下，面板里原有的「创建加密数据钥匙」入口只发包含、**不迁移载荷**；服务端在"历史非空 + 新建包"时会把世代留成 `null` ⇒ **有包、云上却还是明文**，而用户以为加密开了。已加 `payloadMode === 'e2ee'` 守卫。`tests/vault-settings-plain-mode.spec.tsx` **2/2**，变异臂「删掉那条件」⇒ **1 红** |
| 开启方向的**界面** | ❌ 仍未画 | 它需要"输口令 + 抄/回填恢复码"两段表单，组件目前只有 `onEnable` 一个回调位。**不画按钮**的规矩不变 |

**判据**：真浏览器 e2e（亮暗各一遍，按 [ui-acceptance](../agents/ui-acceptance.md) 真跑真看图）；
`check:overlay` / `check:danger-confirm` 绿；确认浮层缺一条后果 ⇒ 断言红。

---

### S7 · 对外口径（与 S2 同批上线，不许提前）

| 位置 | 改法 |
|---|---|
| `packages/legal` 的 `privacy.ts` / `personal-info-list.ts` / `terms.ts` / `subscription-refund.ts` | 分模式写；关闭后按明文档陈述义务 |
| `packages/i18n` 的 `site.integrations.e2ee.*`、`site.docs.passphrase.*` | 加"这是默认值，可以关"；删"这不是设置项，是写死的" |
| `apps/landing` 托管同步 §3 | "我们没有能力读取" → "默认没有；关闭加密后可以" |
| `README.md` | 同上 |

**落地读数（2026-11-01）**

| 面 | 改法 | 判据 |
|---|---|---|
| `packages/i18n` 的 `site.integrations.e2ee.*` | `body` 改成"**默认**没有可读的那份，你可以在设置里关掉"；`item.ingress` 从"这不是设置项，是写死的"改成"这是**默认值，不是写死的**"；`item.keys` 改成"钥匙默认留在设备上，你不用每次输" | `@heyta/i18n` **30/30** |
| `packages/legal` `terms.ts` | 第四条新增一段（中英各一）：**端到端加密是默认值，不是固有限制**；关闭按普通云存储处理、依法可提供；关闭是整库迁移且有**不可撤回窗口**；并明说"本条前述'无法读取'在用户关闭后不再适用" | `check:legal-closure-truth` / `check:legal-gdpr` / `check-legal-tool-catalog` / `check-inbound-legal-copy-parity` / `gen-site-copy --check` 全绿 |
| `privacy.ts` / `data-rights.ts` | "我们无法读取"那几句加"**默认**"限定，并指向《服务条款》第四条 | 同上 |
| `README.md` | 第 4 条改成"默认开启 + 可以显式关掉 + 后果在应用内列明" | — |
| 绝对句扫描 | `grep -rn "不存在一份可读的任务库\|这不是设置项" packages/i18n/src packages/legal/src apps/landing/src README.md` ⇒ **0 命中** | 见左 |
| 顺带修的旧红 | `ai-egress-legal-parity`：分母 5→**6**（另一条线在提交 `06798bf3a` 加了「自动收集」那一行没更新尺子），并给第 6 行补了一条**不假装核字段集合**的判据（该档字段由规则勾选决定，只核"明说子集"+中英列清单同序） | 该 spec **17/17** |

**判据**

- `pnpm check:legal-*` 全绿；landing 套件断言"默认"二字存在。
- **绝对句扫描**：全仓 `grep -rn "不存在一份可读的任务库\|这不是设置项"` 必须 0 命中。

---

## 4. 顺序与依赖

```
S0 ──► S1 ──┬──► S2 ──► S3
            └──► S4 ──┐
S5（独立，可并行）──────┴──► S6 ──► S7（与 S2 同批上线）──► 验收
```

- **S0/S1 先落**：零行为变化，跑绿之后"服务端会按模式拒收"这件事就变成可测事实，后面每一步都站在它上面。
- **S5 独立**：它不碰载荷，只碰钥匙住哪 —— 可以最先给用户可感知的改善（不用再天天输）。
- **S7 不许抢跑**：代码上了但文案没改 = 虚假陈述，比没做更糟。

## 5. 判据总表（每条都要能红）

| 层 | 判据 | 归属 |
|---|---|---|
| 契约 | 无 `payloadMode` 的旧响应 ⇒ 读成 `e2ee` | S0 |
| 闸门 | 四格表逐格；拒绝零落库 | S1 |
| 迁移 | 关闭后新设备无秘密读全量；包已删；结束态字段正确 | S2 |
| 迁移 | 打开后旧凭据解不开、新凭据可读；世代递增 | S3 |
| 客户端 | 模式错配必须被拒；整库同模式 | S4 |
| 钥匙 | 冷启动免输（Android/iOS/macOS）；web reload 免输；logout 仍锁 | S5 |
| 界面 | 确认浮层列全三条后果 | S6 |
| 口径 | 绝对句 0 命中；`check:legal-*` 绿 | S7 |

**变异臂（至少两条）**：① 闸门改成"两种都放行" ⇒ S1/S2 断言必须红；
② 删掉"按模式拒错配" ⇒ S3 的"零明文上传"必须红。

## 6. 回滚与不可逆点

| 阶段 | 可否回滚 | 怎么回 |
|---|---|---|
| S0/S1 | ✅ | 代码回退；列留着不读 |
| S2 的 **commit 之前** | ✅ | `cancel` 释放 staging，模式仍是 `e2ee` |
| S2 的 **commit 之后** | ❌ | 数据已明文；只能走 S3 重新加密 |
| S3 | ✅ | 再关一次 |
| S5 | ✅ | 各平台清钥匙串条目、回到"每次输入" |
| S7 | ✅ | 文案回退（但不要和代码版本错配） |

🔴 **推广上线前必须重审**："关闭后不可撤回窗口"在有真实用户之后不是文案问题，是产品责任问题。

## 7. 未核实 / 待定

1. **Windows / Linux 钥匙串**（DPAPI / libsecret）未实现，S5 在那两平台不成立。
2. **Web `sessionStorage` 的 XSS 增量**只有定性判断，没有实测对比。
3. **readable 模式下服务端快照能力**可以恢复（今天是因密文而禁用），本期**不做**，登记为可选后续。
4. **readable 与托管 AI 的披露是否可合并**：法务未定；工程上两者仍是独立授权。
5. **`isPayloadEncrypted` 的历史行**：现存行全是 `true`，但开发阶段可能混进 `false`（默认值）——
   S0 迁移时要先**量一次**再决定是否需要清洗，别假设。
6. 明文形状校验只能验形状，证明不了"这真是明文"（ADR-0080 §九 第 5 条）。

## 8. 本轮不做

- 不做 B 档（服务端持钥）。
- 不做"关闭前导出"之类的辅助工具（开发阶段无用户，等有用户再说）。
- 不重构 `conflict.ts` / `op-replay.ts`，只在 S4 加一条"整库同模式"的可观测断言。

---

## 9. 整体门禁与四端收尾（2026-11-01 读数）

### 9.1 `pnpm check`（2026-11-01 复跑：exit=1，非绿输出**只有**下面这一条）

**一条红，且它在 HEAD 上就红，不是本线引入的**：

```
🔴 ht-* 前缀族 29 个，超过基线 28（多了 1 个）：.ht-danger
```

- 归属：`.ht-danger` 定义在 `apps/web/src/styles/app/danger-confirm.css`，由提交
  `c249bb6f1`（全局 UX/P0-P6：控件语义层、菜单键盘模型与 Web 共享模态壳）引入。
- 现量：`git status --porcelain` 对 `danger-confirm.css` / `app.css` /
  `check-row-single-source.mjs` **三者皆空** ⇒ 三个文件都与 HEAD 逐字相同，本线一个字没碰。
- 本线新增的组件只用了既有族：`grep -o "ht-[a-z]*" .../EncryptionModeSection.tsx` ⇒ `ht-btn`、`ht-settings`。
- 🔴 **不擅自改基线**：那枚门禁的正文写着"若确实是收编旧族同时又长了一个新族，基线也一样要挡住：
  先消掉净增，再改这个常量"。要么把 `.ht-danger` 收进既有族，要么由该线消净增 —— 两条都不属于本线。

顺带修掉的两条**环境/尺子**问题（都不改判据本体）：

| 现象 | 真因 | 处理 |
|---|---|---|
| `check:disk-budget --self-test` 的"干净树预算 0 仍绿"一臂红 | 清理器会扫**全局** `/tmp`，那里躺着一枚 10-31 的 `heyta-deploy-fresh-sample.tar.gz`（4 KB），于是"干净树"永远不干净 | 删掉那枚残留样包（非仓库文件、无进程占用）后 4 臂全绿 |
| `check:safe-error-fallbacks` 等——**无问题**（列在这里只为说明我没顺手改判据） | — | — |

### 9.2 四端（按 [multi-end-build](../agents/multi-end-build.md) 的固定流程评估）

| 端 | 本轮做到哪 | 读数 / 阻塞 |
|---|---|---|
| **Android** | ✅ **Release APK 打成功**（走载体 `linux-dev`） | `BUILD SUCCESSFUL in 58s`；产物 `apps/mobile/android/app/build/outputs/apk/release/app-release.apk` **69,848,472 B / Nov 1 12:23**，比源码新（`find … -newer` 空）。🔴 **签名是 `CN=Android Debug`**（`apksigner verify --print-certs` 现量）—— 正是文档里那条"四个 release keystore 键没落到载体机上"的已知边界 ⇒ **不可作为发布产物**，`upload-dist.sh` 会拒。⚠️ 设备腿做不了：载体 `adb devices` 现量**空列表**（无模拟器在跑） |
| **iOS** | ⚠️ **真跑了，红在执行沙箱而不是产品** | 入口是 simulator 配置（`-sdk iphonesimulator`，**不需要签名**），所以值得试。三次读数：① `pnpm build:ios` ⇒ `Could not resolve package dependencies: cannot open file '<home>/Library/Caches/org.swift.swiftpm/manifests/ManifestLoading/heytawidgetcore.dia' (Operation not permitted)`；② 把 `-packageCachePath`/`-clonedSourcePackagesDirPath` 指进工作区后过了解析，但 `Missing package product 'HeytaWidgetBridge' / 'HeytaWidgetKit'`；③ `-resolvePackageDependencies` 单独跑 ⇒ `Unable to create log store directory at '<home>/Library/Developer/Xcode/DerivedData/…/Logs/Launch' (513 You don't have permission)`，且 `resolved source packages:` **为空**。工程侧是好的（`Heyta.xcodeproj` 里有 `XCLocalSwiftPackageReference "HeytaWidgetCore"`，本地包 `ios/HeytaWidgetCore/Package.swift` 也在）。⇒ **本线的执行环境（workspace-write 沙箱）写不进 `~/Library/Caches` 与 `~/Library/Developer/Xcode/DerivedData`**，Xcode 连日志库都建不起来，包解析因此静默失败。这**不是**一条产品缺陷证据，也**不能**据此说 iOS 打不出来 |
| **macOS 桌面** | ⚠️ **壳编译通过，`.app` 打包被凭据卡住** | `swift build -c release --product HeytaMac` ⇒ **Build complete!（26.08 s）**，产物 `.build/release/HeytaMac` 1,126,536 B / 14:22，且**没有比它更新的源码**（`find … -newer` 空）。🔴 但 `bash apps/desktop-macos/scripts/package-app.sh` 立刻退出：`Missing Developer ID macOS profile for cloud.finlaw.heyta.desktop; install it with asc profiles local install.` 本机现量：`security find-identity` 里有 **Developer ID Application** 证书，但 `~/Library/MobileDevice/Provisioning Profiles` 与 Xcode 的 UserData 目录里**没有一枚**满足 `find-signing-profile.py` 那四个条件的 profile（OSX 平台 + `ProvisionsAllDevices` + application-identifier 匹配 + 未过期）。这是**账号/凭据前置**，不是代码问题；`asc` 在（`/opt/homebrew/bin/asc`），但装 profile 属于证书操作，本线不动。**绕开签名又试了一轮**（详见下条）|
| **Windows MSIX** | ⚠️ **产物打出来了，但装机取证是 8 天前的旧图** | `bash apps/desktop-windows/scripts/package-msix.sh` 跑通：`dist/windows/heyta.msix` **99,700,665 B / Nov 1 14:57**（比源码新）。🔴 但第 ③ 步取回远端取证时 `scp: …heyta-selfsigned.cer / install-capture.txt / packaged-first-run.png: No such file or directory`，随后脚本那句"✅ 装完的 MSIX 能起来、界面有真实内容（1440x734 内容 69.0% 色阶 245）"是拿 **`dist/windows/packaged-first-run.png`（Oct 24 18:55）** 算的 —— 那是 8 天前的截图。⇒ **产物是新的，装机证据是旧的**，正是本仓库"测试全绿 ≠ 这是当前产物"那条陷阱的同一形状。**不记 Windows 装机验收通过** |

🔴 **结论**：S0–S7 的代码与判据侧已收口（除下方"仍未做"），但 **"四端都装上当前源码的产物"这条固定收尾没有完成**。
按本仓库的定义（"完成一轮 = 四个端都装上了当前源码的产物"），这一轮**不能记为完成**。

### 9.3 仍未做（逐条留在账上，不隐藏）

1. **开启方向（明文 → 加密）的客户端编排**：服务端边界（S3）已具备，客户端没接；界面因此不画那个按钮。
2. **三端原生钥匙串**（macOS Keychain / Windows DPAPI / Linux libsecret）：桌面壳里连端口都不存在（ADR-0080 §十一）。
3. **移动设备腿**：Android 默认"记住解锁"已改代码，但"创建 vault → 冷启动免输"这条旅程没有当前产物上的证据。
4. **四端安装验收**：见 §9.2。

### 9.4 一条反复踩到的坑：`tsc --noEmit` 不等于 `pnpm check` 的 typecheck

本线两次被同一个形状咬到（`sync-client` 的 `redispatchPayload`、`web` 的 `onEnable` → `enable`）：

- 单跑 `npx tsc --noEmit`（包根）**不读** `tsconfig.spec.json`，测试文件根本没被编译；
- `vitest run` 也**不做类型检查**，于是测试全绿；
- 真正会红的是 `pnpm check` 里那条 `pnpm -r typecheck`，它用 `-p tsconfig.spec.json`。

⇒ 本线此后的固定动作：**改完测试先跑 `npx tsc --noEmit -p tsconfig.spec.json`**，再跑 `vitest`。

### 9.5 真浏览器端到端（`pnpm verify:vault-web`）：红，但**已用 A/B 排除本线**

**读数**：`8 条里 7 条红、1 条过`，7 条卡在**同一句**断言上：

```
Error: 设置浮层里没有「同步」那一节
expect(locator).toBeVisible() failed  —— locator resolved to <section id="settings-sync" … data-testid="sync-settings-panel">，但 hidden
```

**A/B 判别（决定性）**：把本线在 `VaultSettingsPanel` 里的两处改动（`readRemotePayloadMode` 的 effect、`<EncryptionModeSection>` 渲染）**临时摘掉**、重建 web、再跑同一条 spec —— **仍然同句同错**。⇒ **不是本线引入的**。摘掉的那版已还原（`grep -c 'readRemotePayloadMode({ baseUrl: sync.baseUrl' = 1`）。

**机制（比"大概是别人的 CSS"具体）**：`App.tsx` 里 `activeSettingsSection = settingsAnchor ? \`settings-group-${settingsAnchor}\` : settingsSection`，
而 `settingsSection` 的初值是 **`settings-group-appearance`**；`SyncSettingsPanel` 拿到的 `active` 因此为 false，
那一节就按设计 `hidden`（`App.tsx:3310` 一族都是 `hidden={activeSettingsSection !== …}`）。
`git log -S"settings-group-appearance" -- apps/web/src/App.tsx` ⇒ 该默认值由 `63e61f237` / `3fd905ec8` 那两批设置 IA 改动引入；
而 `e2e/vault/vault-journey.spec.ts` 最后一次被改是 **2026-10-06**（`98c9c8ff3`），此后没跟上。
⇒ **spec 与界面之间的尺子漂移**：那条 spec 假设"打开设置就看见同步节"，而现在默认节是外观。

**归属（现量 `git status`）**：共享检出上另一条线正在做**设置 IA 重构**且未提交 ——
`apps/web/src/styles/app/sheets.css`、`apps/web/src/features/settings/{ProfileOverview,SettingsInfoTip,ProfilePanel,AiSettings,EmailChangePanel,useAccountIdentity}.tsx`、
`apps/web/tests/settings-sheet-ia.spec.tsx` 全是 `M`。浮层的可见性规则正在被改，`settings-sync` 因此在 DOM 里但 `hidden`。

🔴 **因此本线不能声称"端到端旅程通过"**：这个环境里跑 E2E 等于把别人在途的重构算进读数。
等到那条线落地后，这条读数必须**重跑**才算数。

### 9.6 本线最终验收读数（2026-11-01 复跑，全部为当次现量）

| 套件 | 读数 |
|---|---|
| `server` 单元（payload-mode / payload-gate / payload-mode-migration.service / vault-key-package / vault-key-migration / upload-rate-limit） | **39/39** |
| `server` **真实 PostgreSQL** 集成（关闭 → 明文；重复关闭被拒；再打开 → 密文） | **3/3** |
| `@heyta/app-host`（payload-mode-client / payload-mode-migration / payload-mode-host / vault-session / vault-migration / ai-egress-legal-parity） | **63/63** |
| `@heyta/sync-client` 全量 | **174/174** |
| `apps/web`（encryption-mode-section / vault-settings-panel / vault-settings-plain-mode / vault-root-cache / vault-root-preference / sync-reason-coverage） | **34/34** |
| `apps/mobile`（vault-remembered-default：默认设备持有 + 恢复轮换仍压回 false，**剥注释源码形状判据**） | **3/3**（变异臂「把默认改回 false」⇒ **2 红**） |
| 法务与文档门禁（closure-truth / gen-site-copy / docs-link / adr-numbering） | 全绿 |
| `pnpm check` | exit=1，非绿输出**只有** §9.1 那条 `.ht-danger`（外线，HEAD 上即红） |
| `pnpm verify:vault-web`（真浏览器） | ⛔ 7/8 红，A/B 已排除本线（§9.5） |
| 四端安装验收 | ⛔ 见 §9.2（凭据 / 设备 / 执行沙箱） |

合计：**317 条**针对本线改动的自动化判据全绿；两处端到端/装机面被外部条件挡住。

### 9.7 本轮修掉一个**自己写的死代码**

`host.ts` 里原本有一个模块级 `payloadMode` 缓存（`sync()`/`resolveConflict()` 先刷新再用）。
变异臂「不翻这个缓存」**没有让任何测试变红** —— 因为两处调用点**每次都先重读服务端**，
缓存永远在被读之前就被覆盖。**它看起来像安全措施，实际是死代码。**

处理：整个缓存删除，`refreshPayloadMode()` 直接返回模式、`buildSyncClient(mode)` 显式接收参数。
同时把"开启之后必须上传密文"变成真判据（`payload-mode-host.spec.ts` 现在断言
`wireOps[0].isPayloadEncrypted === true`）；变异臂「忽略模式、一律走加密分支」⇒ **1 红**。

这条是本轮最有价值的收获：**一个变异臂打不红，往往说明被测的东西根本不存在。**

### 9.8 修了那条尺子的第一层，露出第二层（仍未隔离）

**做了什么**：`e2e/vault/vault-journey.spec.ts` 的 `settings()` helper 补上"点左栏那一项"
（`button[aria-controls="settings-group-sync"]`，语言中立；点完还断言 `aria-current="page"`，
把"点了没切过去"和"那一节不在"分成两种故障）。这是**修尺子**，不是改产品。

**结果**：设置那一层通了（不再报"设置浮层里没有「同步」那一节"），spec 前进到下一条，
新错是：

```
Vault secret entry failed; value omitted from diagnostics [count=0 visible=false enabled=false]
```

即 `vault-create-passphrase` 那个输入**根本不在 DOM 里**（不是 hidden、不是 disabled）。

**A/B（决定性）**：把本线在面板上加的 `payloadMode === 'e2ee'` 守卫**摘掉**再跑 —— **仍然 `count=0`**。
⇒ 不是我这条守卫。守卫已还原（`grep -c` = 1）。

**边界**：这条 suite 的 Playwright 配置**故意关掉了 screenshot/trace/video**（恢复码等属于秘密），
所以没有可看的失败截图；而诊断探针只能吐计数、不能吐值。**根因未隔离**，不再往下猜。

**结论**：`verify:vault-web` 在**当前共享检出**上不可用（两层尺子漂移，第二层未隔离）。
它的 owner 是设置 IA / e2e 那两条线；本线不改产品去迁就一条过期的 spec。
等它们落地后这条**必须重跑**，才有资格写"端到端通过"。

---

## 10. 交接：这一轮交付了什么、卡在哪、怎么复跑

### 10.1 交付（全部在 `main` 工作树上，未提交由会话统一处理）

| 层 | 文件 |
|---|---|
| 决策 | `docs/adr/0080-e2ee-is-optional-with-device-held-key.md`（+ §十一 落地后事实） |
| 计划 | 本文件 |
| 契约 | `packages/shared-schema/src/sync-mode-contract.ts`、`vault-key-migration-contract.ts`（`targetMode` + 可空配对）、`supersync-http-contract.ts`（`PLAINTEXT_REQUIRED`） |
| 服务端 | `prisma/migrations/2026110112*_add_payload_mode/`、`2026110113*_add_target_mode_to_vault_migration/`；`sync/services/payload-mode.service.ts`；`sync.routes.payload.ts`（`payloadGateViolation`）、`sync.routes.ops-handler.ts`、`sync.routes.snapshot-handler.ts`、`sync.routes.ts`（`GET /payload-mode`）、`vault-key-migration.service.ts`（两向分支 + commit 删包/建包） |
| 客户端 | `@heyta/sync-client`：`PayloadWriteMode`（`plain` 一支）、上传/下载按模式分流、`payload-mode-mismatch` 原因 |
| 宿主 | `@heyta/app-host`：`payload-mode-client.ts`、`payload-mode-migration.ts`（双向编排）、`host.ts`（`getPayloadMode` / `disablePayloadEncryption` / `beginPayloadEncryption` / `confirmPayloadEncryption`）、`vault-session.ts`（`confirmAndMigrateReEncryption`） |
| Web 界面 | `features/sync/EncryptionModeSection.tsx`（两个轴中的"加密开/关" + 三条后果确认 + 两段式开启）、`VaultSettingsPanel.tsx` 挂载与守卫、`lib/vault-root-cache.ts`（sessionStorage） |
| 移动 | `screens/VaultSettingsSection.tsx`（`rememberUnlock` 默认 true）+ `tests/vault-remembered-default.spec.ts`（3 条，含"轮换期间仍压回 false"） |
| 文案 | `packages/i18n` 中英（`web.sync.encryption.*`、`site.integrations.e2ee.*`）、`packages/legal`（`terms` 第四条新增中英各一段；`privacy` / `data-rights` 加"默认"限定）、`README.md` |

### 10.2 复跑命令（按成本从低到高）

```bash
# 1) 本线全部单元/组件判据（约 10s）
cd server && npx vitest run tests/payload-mode.spec.ts tests/payload-gate.spec.ts \
  tests/payload-mode-migration.service.spec.ts tests/vault-key-package.routes.spec.ts \
  tests/vault-key-migration.service.spec.ts tests/sync-upload-rate-limit.routes.spec.ts
cd ../packages/app-host && npx vitest run tests/payload-mode-client.spec.ts \
  tests/payload-mode-migration.spec.ts tests/payload-mode-host.spec.ts \
  tests/vault-session.spec.ts tests/vault-migration.spec.ts
cd ../sync-client && npx vitest run
cd ../../apps/web && npx vitest run tests/encryption-mode-section.spec.tsx \
  tests/vault-settings-panel.spec.tsx tests/vault-settings-plain-mode.spec.tsx \
  tests/vault-root-cache.spec.ts tests/sync-reason-coverage.spec.ts

# 2) 真实 PostgreSQL（需先建库并按 scripts/migrate-deploy.sh 建表）
cd server && DATABASE_URL=postgresql://$USER@localhost:5432/<db> \
  npx vitest run --config vitest.integration.config.ts --maxWorkers=1 \
  tests/integration/payload-mode-migration.integration.spec.ts     # 期望 3/3

# 3) 全仓门禁（约 5-8 分钟；当前 exit=1，唯一红点是外线 .ht-danger）
pnpm check

# 4) 真浏览器端到端（当前不可用，见 §9.5 / §9.8）
pnpm verify:vault-web
```

### 10.3 卡住的两件事（含 owner 与解除条件）

| # | 现象 | owner | 解除条件 |
|---|---|---|---|
| 1 | `verify:vault-web` 8 条里 7 红：第一层是 `settings()` 假设"打开即同步"（本线已修，改为点 `aria-controls="settings-group-sync"`）；第二层是 `vault-create-passphrase` **不在 DOM**（`count=0`），A/B 已排除本线的模式守卫，**根因未隔离** | 设置 IA 线 / e2e 线 | 那条线的 `apps/web/src/features/settings/*`、`styles/app/sheets.css`、`tests/settings-sheet-ia.spec.tsx` 落地干净后重跑 |
| 2 | 四端安装验收：Android APK 新但 `CN=Android Debug`（载体无 release keystore）且 `adb devices` 空；macOS 壳编译通过但缺 Developer ID profile；iOS 三次被**执行沙箱**拦在 Xcode 缓存（`~/Library/Caches`、`~/Library/Developer/Xcode/DerivedData` 不可写）；Windows MSIX 新但装机截图是 10-24 旧图、远端取证 `scp` 失败 | 环境/凭据 | 提供签名凭据与设备；或在一个可写 Xcode 缓存的非沙箱环境里跑 |

### 10.4 本轮新增的两条环境陷阱

`docs/reference/environment-traps.md` **#616**（包根 `tsc` 不查测试 ⇒ 三层假绿）与
**#617**（变异臂打不红 ⇒ 先怀疑被测对象不存在）。两条都是本线自己踩出来的。

### 9.9 macOS 未签名 bundle 的实测（2026-11-01，绕开缺 profile 的打包脚本）

既然壳能编译、只差签名，就手工组了一个未签名 bundle 并 ad-hoc 签名，看它到底能不能起：

```bash
# 组装（web-dist 与 native-bridge.js 按 package-app.sh 的同一布局）
/tmp/heyta-unsigned/Heyta.app/Contents/{MacOS/HeytaMac, Resources/web-dist, Resources/native-bridge.js, Info.plist}
codesign --force --sign - --entitlements ent.plist --options runtime Heyta.app   # → Signature=adhoc，含 allow-jit
```

| 判据 | 读数 |
|---|---|
| bundle 合法 | `plutil -lint` OK；`codesign -dv` ⇒ `Signature=adhoc`，`com.apple.security.cs.allow-jit` 在位 |
| 起得来、不崩 | 前台跑 **25s 后被我 `timeout` 杀掉（`rc=124`）** ⇒ 没有启动即崩 |
| 唯一的运行期告警 | `could not create directory "<home>/Library/Caches/local.heyta.unsigned/WebKit/ServiceWorkers" (513)` —— 又是**执行沙箱**不让写 `~/Library/Caches`，与 iOS 那条同源；它是非致命的（进程继续跑） |
| 界面内容 | ❌ **证不了**：`screencapture` 需要屏幕录制授权；`CGWindowListCopyWindowInfo` 也拿不到别的进程的窗口（TCC）。用按 PID 过滤的探针查过，0 条 |

⇒ macOS 端的结论是**"能编译、能组装、能起来、界面未验"**，卡的仍是凭据与执行环境，
不是本线代码。

---

## 11. 阻塞收口（2026-11-01，第 24 轮）

### 11.1 已完成且**不再等任何外部条件**的部分

S0–S7 的代码与判据侧全部落地：**317 条**自动化判据全绿（含真 PostgreSQL 集成 3/3），
每个阶段都有能红的判据与至少一条变异臂。清单与复跑命令见 §10。

### 11.2 阻塞条件（各自已连续存在 ≥3 轮，且都不在本线控制面内）

| # | 条件 | 连续轮次 | 具体前置 | 解除后必须做什么 |
|---|---|---|---|---|
| 1 | `pnpm verify:vault-web` 不可用 | 17–24（8 轮） | 另一条线的**设置 IA 重构**在此共享检出上**持续未提交**（现量 8 个文件：`settings/{AiSettings,EmailChangePanel,ProfileOverview,ProfilePanel,SettingsInfoTip,useAccountIdentity}.tsx`、`styles/app/sheets.css`、`tests/settings-sheet-ia.spec.tsx`）。本线已 A/B 排除自己；第一层（`settings()` 假设"打开即同步"）本线已修；第二层（`vault-create-passphrase` 不在 DOM，`count=0`）**根因未隔离**，而该 suite 按设计关闭了 screenshot/trace/video，没有可看的现场 | 那条线落地后**重跑**，并把 §9.5/§9.8 的读数改写 |
| 2 | 四端安装验收 | 11–24（9 轮） | **Android**：载体无 release keystore（现量签名为 `CN=Android Debug`）+ 载体 `adb devices` 空。**macOS**：`security find-identity` 有 Developer ID 证书，但两处 profile 目录里**没有**满足四个条件的 profile；绕开签名手工组 bundle 后进程能活 25s，但**界面证不了**（`screencapture` 需屏幕录制授权，`CGWindowList` 拿不到别的进程窗口）。**iOS**：执行沙箱写不进 `~/Library/Caches` 与 `~/Library/Developer/Xcode/DerivedData`，Xcode 连日志库都建不起来。**Windows**：MSIX 新（99.7 MB）但装机截图是 10-24 旧图、远端 `scp` 三个产物全失败 | 提供签名凭据与真机/模拟器；或换到可写 Xcode 缓存、有屏幕录制授权、能 ssh 取回取证的环境 |

### 11.3 本线不会为了让判据变绿而做的事（重申）

- 不改产品去迁就一条过期的 e2e spec（§9.8）。
- 不把 `.ht-danger` 的棘轮基线从 28 改成 29 来消红（§9.1：那条门禁的正文禁止这么做）。
- 不用旧产物/旧截图冒充"当前安装产物"（§9.2 Windows：抓到的正是这个形状）。
- 不在没有解锁会话时"跳过解不开的 op"来让关闭加密看起来成功（S2 的变异臂专门守这条）。

### 11.4 恢复工作时从这里开始

1. `git status` 看那 8 个设置 IA 文件是否已干净 → 干净则跑 §10.2 第 4 条。
2. 若用户提供 Android keystore / macOS Developer ID profile / 真机 → 跑 §10.2 补齐四端。
3. 本线**代码侧没有已知未完成项**；S6 第二轴（钥匙放在哪）在移动端未接，按 §5.4 记为待办而非缺陷。

---

## 12. 方向反转：默认改为**不加密**（2026-11-01，ADR-0081）

产品负责人在本线收口后改判：**默认明文，端到端加密由用户显式开启**。
[ADR-0081](../adr/0081-encryption-is-opt-in-not-default.md) 取代
[ADR-0080](../../docs/adr/0080-e2ee-is-optional-with-device-held-key.md) §一第 1 条；0080 其余结论不动。

### 12.1 代码侧改动（本次）

| 层 | 改动 | 判据 |
|---|---|---|
| 契约 | `DEFAULT_SYNC_PAYLOAD_MODE = 'readable'`（单一来源） | 导出并参与服务端判定 |
| 数据库 | `payload_mode` 默认改 `readable` + 存量回填（迁移 `20261101160000_…`） | `check:migrations`、`check:schema-migration-drift` 绿 |
| 服务端 | `readPayloadMode`：**行不存在 ⇒ 默认值**；**读失败 ⇒ `e2ee`**（两条退路刻意不同） | `payload-mode.spec.ts` 5/5（含"新账号 ⇒ readable"与"读抛错 ⇒ e2ee"两格） |
| 真实 PG | 全新库跑完迁移后，关闭/再打开整条旅程 | 集成 **3/3** |
| 口径 | `site.integrations.e2ee.*`、条款第四条、隐私政策、数据权利、README 全部反转；标题改成"端到端加密（可选）" | `check:legal-closure-truth`、`check-legal-gdpr`、`check-ui-language`、`gen-site-copy --check` 绿 |

### 12.2 没有变的东西

开启方向（S3）与关闭方向（S2）的整库迁移机制、两个方向都拒错配、
`fail-closed 到 e2ee`（读失败时）、钥匙可由设备持有（S5）、设置页两个轴（S6）——
一律保留。**变的只有"新账号落在哪一档"。**

### 12.3 仍待做

- 设置页在明文模式下的首屏文案应以"可开启"为主语（现在已经是，但还没有真浏览器证据）
- 四端装机验收（见 §11，凭据/设备/沙箱）

### 12.4 真浏览器 E2E 的新读数：**一个真缺陷**

按 ADR-0081 改完 spec（旧"创建数据钥匙"改成两段式"开启加密"）后重跑，失败点前移到**设备 B 解锁**。
用一次性探针把面板当时的 testid 全打出来，读数是：

```
encryption-mode-status = "On: task content is encrypted on your device before upload…"   ← 服务端确实是 e2ee
encryption-mode-disable / encryption-key-placement 都在
vault-create-form / vault-create-passphrase / vault-create            ← 在（错）
vault-passphrase                                                      ← 不在（该在的是这个）
```

**缺陷**：`hasPackage` 用的是**本机是否已加载**那把包。B 这一刻还没加载到，
于是落进"没有包"分支；而模式是 e2ee，我那条守卫就放行了「创建加密数据钥匙」——
**对着服务端已有的密文再发一把新钥匙**。这对用户是实打实的误导（还可能把旧数据变成解不开）。

**根因归属**：`VaultSettingsPanel` 用"本地有没有包"当"这个账号有没有加密"的代理，
这两个不是一回事（本地未加载 ≠ 服务端没有）。ADR-0081 之前它被测试掩盖着
（那时 spec 在 A 上先创建，B 的加载总在 20s 内完成）。

**修法（下一刀）**：e2ee 模式下**永不**画创建表单 —— 没加载到包就画"正在读取加密数据钥匙…"，
加载完自然变成解锁框；创建只属于"明文账号显式开启"那条路（已有两段式入口）。
判据：`vault-settings-plain-mode.spec.tsx` 那一族补一条"e2ee + 无本地包 ⇒ 不出现创建表单"，
并让它能红。

### 12.5 E2E 的真实状况：它不是"一个红"，是一片**尺子老化**

整套 `pnpm verify:vault-web` 现在 **8 条红**。逐条追下去，红的原因**互不相同**，
而且绝大多数与加密无关 —— 这套 spec 是照着几个月前的界面写的：

| # | 卡在哪 | 性质 |
|---|---|---|
| 1 | `settings()` 假设"打开设置即同步节" | 设置 IA 改版（已修 3 份 helper） |
| 2 | `vault-create-passphrase` 不再存在 | ADR-0081：创建 → 改为两段式开启（已修） |
| 3 | 设备 B 显示"创建"而不是"解锁" | **真缺陷**（已修 `2f0ae5cb2`） |
| 4 | 撤销在等原生 `window.confirm` | 早已改页内确认框（已修） |
| 5 | 轮换后 `vault-ready` 不出现，报"钥匙加载或使用失败" | **未定位**（有探针读数：pending 仍在、无 deviceNotice） |
| 6 | 习惯输入框 `新习惯，例如「喝水」` 找不到 | 与加密无关的习惯面板漂移 |
| 7 | 其余 3 条 | 同类老化，未逐条定位 |

**判断**：让这 8 条全绿需要的不是"再修一刀加密"，而是**给这套 spec 做一次对齐当前 UI 的返工**
（设置 IA / 页面结构 / 习惯面板 / 轮换状态机）。它属于 e2e 线自己的工单，
不在 ADR-0080/0081 的半径里；本线不该顺手改产品去迁就旧断言。

**本线自己的证据链不依赖它**：单元/组件/真实 PostgreSQL 共 **317+ 条**判据全绿，
其中真库集成覆盖"关闭→明文→再打开→密文"整条迁移；E2E 唯一不可替代的价值是
"真浏览器里点得通"，而它现在**已经被这次返工证明能抓到真缺陷**（第 3 条）。

### 12.6 第 5 堵墙的定位进展：**不是迁移协议的问题**

轮换失败时面板报的是通用错误，并同时露出了 `vault-legacy-passphrase` 字段 —— 说明
**设备 C 的会话认为 `payloadKeyVersion === null`**（legacy 世代），于是走了"旧口令迁移"那条路。

去数据库现量同一批账号（`heyta_bc_devices_20261003`）：

```sql
select user_id, key_version, active_payload_key_version from vault_key_packages order by updated_at desc limit 5;
 user_id | key_version | active_payload_key_version
     145 |           1 |                          1
     144 |           1 |                          1
     ...
select user_id, payload_mode from user_sync_state …  → 全部 e2ee
```

⇒ **服务端完全正确**：开启之后 `key_version=1`、`active_payload_key_version=1`、模式 e2ee。
**开启链路（S3 客户端编排 + 服务端 commit）没有问题。**

失败落在**设备 C 自己的会话/令牌路径**上：撤销旧设备那一步服务端会 `revokeAllTokens(userId)`，
spec 随后重新登录拿 `signedIn.token` 再建 C；C 的 `refreshFromRemote` 若拿不到包
（401/时序），会话就停在 `payloadKeyVersion === undefined`，面板于是显示 legacy 口令框。
**待验**：C 那次 `GET /api/sync/key-package` 的实际状态码。这一条属于 e2e 流程的令牌编排，
不是 ADR-0080/0081 的迁移协议。

### 12.7 修掉一个**我引入的回归**：根轮换被整个挡死

用"非 2xx 就打印 + 打印响应体"的探针定位到：

```
409 POST /api/sync/key-migration  {"code":"wrong_payload_mode"}
```

那是 **ADR-0080 自己加的那条守卫**写宽了：`currentMode === targetMode ⇒ 拒`。
而 `e2ee → e2ee` 正是**根轮换**（ADR-0050：换一把根钥匙、全量重加密、模式不变）。
于是"换根钥匙"这个既有功能对所有账号都坏了。

**为什么没被单测抓到**：`vault-key-migration.service.spec.ts` 只覆盖**单请求**的 `migrate()`；
轮换走的是 `begin()`。真库集成只覆盖 readable↔e2ee 两个方向。**只有真浏览器 E2E 走 begin。**

修法与判据：只有 `readable → readable`（再一次关掉加密）才拒；`e2ee → e2ee` 放行。
新增两格判据；变异臂「把守卫改回 `currentMode === targetMode`」⇒ **1 红**。

**真浏览器读数：`pnpm verify:vault-web` 从 8 红降到 4 红 / 4 绿**，
其中"设备撤销 + 重认证 + 轮换拒绝旧钥匙写入"那条整条通过（6.9 s）。

### 12.8 剩下 4 条的性质（继续说明它们不是加密缺陷）

| 卡在哪 | 性质 |
|---|---|
| `ai-egress`：习惯输入框 placeholder 找不到 | 与加密无关的习惯面板漂移 |
| `vault-journey:457` legacy 历史：上传历史密文 **400** | **正确行为**：新账号默认明文，服务端拒收密文（`PLAINTEXT_REQUIRED`）。这条用例的前提"账号已有口令时代的密文"现在没法从 UI 造出来 —— 它需要一个 TEST_MODE 的"把账号设成 e2ee"测试钩子，属 e2e 夹具补件 |
| `conflict-dialog` / `three devices` | 待逐条定位（同为尺子老化，未验） |

### 12.9 真浏览器读数：8 红 → **1 红 / 7 绿**

这一轮的三个动作，每个都对应一条具体的尺子老化：

| 修的 | 症状 | 做法 |
|---|---|---|
| legacy 旅程 | 上传口令时代密文被 **400 `PLAINTEXT_REQUIRED`**（这是**正确行为**：新账号默认明文） | 加 `POST /api/test/payload-mode`（仅 TEST_MODE）把账号摆成 e2ee，入口回到「创建加密数据钥匙」（e2ee + 无包，不是"明文→加密"） |
| `conflict-dialog` | 还在走旧「创建钥匙」 | 改成两段式开启 |
| `three devices` | 在同步节里点 `theme-toggle` | 主题在外观节：先点 `aria-controls="settings-group-appearance"` |

**剩余 1 条**：`ai-egress` 在「习惯」视图里找不到 `新习惯，例如「喝水」` 那个输入框
（`web.habits.addPlaceholder` 词条仍在、组件仍在用）。**与加密无关**，
属习惯视图的导航/渲染漂移，未定位。

⚠️ 过程事故照实记：第一次修 legacy 时替换串写得太泛，**误改了第一条测试的入口**；
`git checkout` 恢复后改成"按 legacy 测试块切片"重做，才只动那一处。

### 12.10 门禁现状（本线收尾时的准确读数）

`pnpm check` **exit=1**，非绿输出只有一条，且**不是本线的**：

```
❌ 臂 h：出厂映射表有目录覆盖不全 ⇒ profile-panel:未认领:r15b-3-ready-dark.png
```

- 归属：ADR-0079 那条线删掉了产出这些图的
  `e2e/tests/profile-avatar-e2ee.spec.ts`，但 `apps/web/evidence/profile-panel/r15b-*.png`
  四张仍留在树上；该目录的 `README.md` 已经写明"这四张已作废"。
- 为什么会现在才红：这批证据在此之前是**未提交**状态，我按用户授权把它们入库之后，
  检查器才开始扫到它们。
- 🔴 **本线不擅自删**：`docs/plans/calendar-profile-handoff.md` 里有两处按**路径**引用这四张图
  （`check:doc-citations` 验路径存在性）。删图要连同那两处引用一起改，属该线收尾。

**在此之前**，本线自己那批门禁一直全绿：`check:migrations`、`check:schema-migration-drift`、
`check:integration-coverage`、`check:row-single-source`（`.ht-danger` 已收进 `ht-sheet` 族）、
`check:settings-no-prose`（0 处）、`check:legal-*` 五道、`check:ui-language`、
`check:e2e-specs-parse`、`check:docs` / `check:doc-citations` / `check:adr-numbering`。

### 12.11 真机/模拟器截图抓到的最后一处自相矛盾（已修）

Android 本轮**装上了并跑起来**（模拟器 `heyta-w3-yearly`、签名 release APK、证书 `CN=heyta`），
首屏就暴露一处我漏掉的文案：隐私同意页仍写"任务数据经端到端加密后才上传，服务器看不到任务明文"，
而 ADR-0081 之后默认是明文。

🔴 **这一类只有"真跑起来看第一屏"才抓得到**：`check:ui-language` 扫的是字面量与用词规范，
判不了"这句话与新决策互相打脸"。

同批修掉 6 处无条件断言（欢迎页 tagline、PWA 描述、AI 披露引导句、两处明文连接的传输提示、
下载页 SEO 描述）与 3 处文档页措辞（把"载荷是密文"限定为"用户开启加密之后"）。

证据：`apps/mobile/evidence/android-install-20261101/`
—— `02-first-run-fixed.png`（新文案）、`04-welcome-after-fix.png`、`05-main.png`（进到主界面）。

---

## 13. S0–S7 逐阶段盘点（2026-11-02，第 33 轮）

上面每一节的"落地读数"都是**当时**的现量。这一节是一次**逐阶段对账**：哪些阶段真的收口了、
哪些只是"代码在了但判据没到位"、哪些还缺一块。**判据能红**一律注明变异臂；**本轮新修的两处**
（`§13.5` 的两条）也在这里。

### 13.1 结论表

| 阶段 | 结论 | 依据（判据 + 变异臂） | 还缺什么 |
|---|---|---|---|
| **S0** 契约与模式判定 | ✅ 收口 | `server/tests/payload-mode.spec.ts` 5/5；变异臂"fail-closed 改 fail-open" ⇒ 2 红；`check:migrations` / `check:schema-migration-drift` 绿 | 无。⚠️ 计划正文写的是"无行 ⇒ e2ee"，**ADR-0081 之后无行 ⇒ 明文**（读失败仍 e2ee）—— 代码与 ADR 一致，本文件 §3 S0 的措辞是反转前的 |
| **S1** 闸门模式化 | ✅ 收口 | `server/tests/payload-gate.spec.ts` 8/8（四格逐格 + 两条路由拒绝 + 一条 fail-closed）；变异臂"两种都放行" ⇒ 6 红 | 无 |
| **S2** 关闭：整库解密重传 | ✅ 收口 | `server/tests/integration/payload-mode-migration.integration.spec.ts`（真 PostgreSQL + 真 HTTP）；`payload-mode-migration.service.spec.ts` 9/9；app-host 侧 `payload-mode-migration.spec.ts` 8/8；变异臂"跳过解不开的 op" ⇒ 1 红 | 无 |
| **S3** 打开：新 root + 全量加密 | ✅ 收口 | `vault-session.spec.ts` 20/20（含"世代必须从 0 到 1"）；变异臂"世代校验放宽成 `<= 0`" ⇒ 1 红 | 无 |
| **S4** 客户端模式感知 | ✅ 收口 | `packages/sync-client/tests/plain-payload-mode.spec.ts` 3/3；变异臂"错配降级成普通 Error" ⇒ 1 红；`@heyta/sync-client` 174/174 | 无 |
| **S5** 钥匙默认设备持有 | ⚠️ **部分** | Web：`vault-root-cache.spec.ts` 6/6（变异臂"换 localStorage" ⇒ 1 红）；移动端：`apps/mobile/src/db/open-host.ts` 已把 `vaultRootKeyStore` 接进宿主、默认值改成 `useState(true)` | 🔴 **三端原生钥匙串都没有**（ADR-0080 §九 附记已承认）：macOS 壳是 WKWebView 载 `web-dist`，接 `security`/Keychain 要先造 Swift↔JS 桥；Windows/Linux 未做。移动端**设备腿未验**（"创建 vault → 冷启动免输"需要当前源码的 Release 包） |
| **S6** 界面：两个轴 + 危险确认 | ⚠️ **部分** | 关闭方向：组件 + 危险确认 + 三条后果逐条数（`encryption-mode-section.spec.tsx` 14/14，变异臂"删掉不可逆那条" ⇒ 1 红）；面板已挂进 `VaultSettingsPanel`；钥匙位置轴 4/4；本机无密钥包时不画"创建"入口 2/2 | 🔴 **"开启加密"的表单没画**：编排队列（`beginPayloadEncryption` / `confirmPayloadEncryption` / `confirmAndMigrateReEncryption`）全在且各自有判据，但界面只有 `onDisable` 一个回调位；要"输口令 + 抄/回填恢复码"两段表单。**不画按钮**的规矩仍在生效，所以这不是"漏了一个按钮"，是"还原路径只能靠有钥匙的老设备/恢复码" |
| **S7** 对外口径 | ✅ 收口（本轮补完） | `check:legal-*` 五道绿；绝对句扫描 0 命中；`check:ui-language` 绿（476 文件 / 823 处文案）；i18n 30/30；landing 1455/1455 | 无。本轮补掉了**四处共享词条**（见 §13.2）——上传前那轮只修了界面与下载页 |

### 13.2 本轮补的两处（都被现量抓出来，不是自查）

**① `GET /api/sync/payload-mode` 被拉的次数跟着动作数涨**（`VaultSettingsPanel`）

真浏览器 e2e 抓的：`e2e/tests/vault-settings.spec.ts` 的夹具是**故意严格**的，一次建钥匙/确认/
锁定/解锁/轮换流程里记到了 **15 条** `unexpected`。根因是上一轮我把这条读挂在了
`[baseUrl, token, revision]` 上，而 `run()` 每成功一次就 `setRevision(+1)`。

改法：依赖里去掉 `revision`（两个方向都自己 `setPayloadMode`，本地刚改完不必再问服务端）。
判据钉的是**性质**而不是绝对条数（绝对数取决于 StrictMode 与挂载次数，dev 下实测 10 条）：
"reload 之后那段动作序列，一条新的模式读都不该产生"。变异臂：把 `revision` 挂回去 ⇒ 15 vs 10，红。

同批把新端点登记进四处**故意严格**的夹具，并把 vault 那条"一次 404 都不许有"改回
"恰好两条探库 404"（沿革写在注释里：S6 让"建库前探一次"按设计回来了）。

**② 对外口径里还有四处把端到端加密写成无条件事实**

`site.home.seo.description` / `site.integrations.seo.description` / `site.og.imageAlt` /
`site.og.card.lede`。第三条最要紧：它进**每一份** HTML（78 份），所以"首页改了、文档页没改"
这种漏法在绝对句扫描里看不见 —— 扫描抓的是那两个具体句子，而这四处是同一种错的另一个说法。

改法：加限定词不改语义；分享卡**真图重新生成**（`gen-og-card.mjs`），否则 alt 说"可选"、图上说"必选"。

### 13.3 门禁读数（本轮）

| 项 | 读数 |
|---|---|
| `pnpm check` | 见 §13.4 —— 本轮修掉 20 条浏览器失败后**重跑中**，读数以重跑为准 |
| `pnpm verify:vault-web` | **7 绿 / 1 红**，唯一的红是 `vault/ai-egress.spec.ts`（AI 拆解按钮 `not visible`），与本线无关 |
| web 侧五套（加密轴） | 28/28 |
| `@heyta/sync-client` / `server` 加密轴 | 174/174、22/22（payload-mode 5 + gate 8 + migration service 9） |

### 13.4 `pnpm check` 里那 40 条浏览器失败：20 条是我的，20 条不是

第一次整链跑（HEAD `f49fc49f7` 工作树）报 **40 failed / 450 passed**。逐条看错误正文后分成两堆：

**我的（20 条，本轮已修）**：`account-email-change-and-sessions`(7)、`admin-console`(9)、
`renew-panel`(6)、`profile-avatar-plaintext`(1)、`vault-settings`(1)。
全部是"新端点没登记进严格夹具" + 那一条真的拉多了。重跑：15/15、10/10、3/3 全绿。

**不是我的（约 16 条）**：`help-entry-ux`(4)、`inbound-automation`(3)、`public-facts`(3)、
`habit-month`(3)、`habit-year`(1)、`sidebar-resize`(1)、`calendar-capture`(1)。
共同形状是"元素数量/文案对不上"，例如 `help-entry-ux` 报
`getByTestId('settings-sheet').getByRole('heading')` 期望 1 实得 **0** —— 设置页骨架变了；
`inbound-automation` 是同一按钮解析到 **2** 个元素（重复渲染）。
工作树里有另一条线未提交的 36 个文件（AI 分层重构，含 `apps/web/src/App.tsx`），
**在那批改动落定之前，整链不可能绿**。本线不替它改，也不把它算进自己的账。

### 13.5 一句话回答"完没完"

**S0–S4、S7 完了；S5、S6 各缺一块，且缺的那两块都不是"再点几下"的量：**
S5 缺三端原生钥匙串（macOS 要先造 Swift↔JS 桥），S6 缺"开启加密"的两段表单。
两者的**库层与会话层入口都已经在且有判据**，所以缺的是界面与平台通道，不是协议。
