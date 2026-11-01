# E2EE 可选 + 钥匙由设备持有：实施计划（ADR-0080）

> 状态：**规划中**（待产品负责人确认后转「进行中」）
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
| 2 | 客户端只有两种写法，**都是加密**：`'password'`（legacy）与 `'vault'` | `packages/sync-client/src/payload-cipher.ts:24-27` |
| 3 | 无钥即停：`getPayloadCipher()` 拿不到 ⇒ `no-encryption-password`，**绝不降级明文** | `packages/sync-client/src/client.ts:794-810` |
| 4 | 账号级世代在 `vault_key_packages.active_payload_key_version`；`null` = 还没做过首次迁移 | `server/prisma/schema.prisma:701-715` |
| 5 | 迁移 staging 已有：`VaultKeyMigration` + chunk + staged operation，commit 是原子发布边界 | 同文件 `:717-750` |
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
| `user_sync_state` 加 `payload_mode`（`TEXT NOT NULL DEFAULT 'e2ee'`，CHECK 只允许两值） | `server/prisma/schema.prisma` + 新迁移 |
| `VaultKeyMigration` 加 `target_mode`，并把两个 key 版本列改**可空** + CHECK 配对（`e2ee` 必须有世代、`readable` 必须没有） | 同上 + 新迁移 |
| 读模式的**唯一**入口：`sync/services/` 里一个 `readPayloadMode(tx, userId)`，失败一律返回 `'e2ee'`（fail-closed） | `server/src/sync/services/` |
| 契约：`GET /api/sync/key-package` 响应**只增可选** `payloadMode`（缺省按 `e2ee`） | `server/src/sync/sync.routes.ts` + `packages/shared-schema` 的线协议类型 |

**判据**

- `readPayloadMode` 三态单测：有行/无行/读失败 ⇒ `'e2ee' | 'e2ee' | 'e2ee'`（fail-closed 那条必须红过）。
- 契约测试：老响应（无 `payloadMode`）必须被客户端读成 `e2ee`；新增字段不得让既有快照/契约断言红。
- 迁移：`pnpm check:migrations` 绿；`payload_mode` 对既有行回填 `e2ee`（开发阶段本就全 e2ee）。

**可回滚**：是（列可留，代码不读）。

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

---

### S6 · 界面：两个轴 + 危险确认

- 设置 →「同步与隐私」两行：**端到端加密**（开/关）、**钥匙放在哪**（仅加密=开时出现）。
- 关闭走确认浮层，按 [overlay-feedback](../agents/overlay-feedback.md) 的"危险四档"定档，逐条列后果：
  ① 服务端能看到任务内容；② 忘记口令不再等于丢数据；③ 已进快照的明文收不回来。
- 关闭按钮文案**不许**写"更安全/更私密"式比较，只写"谁能读"。

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
