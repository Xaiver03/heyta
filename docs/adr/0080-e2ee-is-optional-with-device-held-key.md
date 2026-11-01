# ADR-0080：端到端加密是**默认**而不是**强制** —— 用户可显式关掉；口令从"每次都要"降级为"加设备/恢复时才要"

- **状态**：已接受（2026-11-01，产品负责人拍板）
- **日期**：2026-11-01
- **取代**：无（**不改** [ADR-0050](0050-e2ee-key-lifecycle-and-recovery.md) 的密钥协议、
  **不改** [ADR-0006](0006-supply-modes.md) 的出境授权、**不改** [ADR-0079](0079-profile-fields-are-plaintext.md)
  的基础资料明文结论）
- **相关**：[ADR-0040](0040-email-password-auth-decoupled-from-e2ee.md)（登录口令与 E2EE 解耦）、
  [ADR-0013](0013-cloud-ai-and-maas.md) / [ADR-0054](0054-managed-ai-retention-and-selling-preconditions.md)（托管 AI 不是 E2EE）、
  [ADR-0016](0016-undecryptable-ops-do-not-block-sync.md)（解不开的 op 的读侧处置）
- **落地计划**：[`../plans/e2ee-optional-and-device-held-key.md`](../plans/e2ee-optional-and-device-held-key.md)（S0–S7 纵切与逐条判据）

---

## 一、决策（三句话）

1. **端到端加密仍是默认，也是卖点** —— 但它必须能被用户**显式关掉**；关掉之后云上是明文，
   我们如实说"服务端能读"，不再含糊。
2. **口令不再是日常门槛**：root key 默认由设备持有（移动已实现 Keychain/Keystore、macOS 走 `security`），
   口令只在三件事上出现 —— **加新设备、用恢复码救、主动轮换**。
3. **"关掉"不是开关，是一次整库迁移**：历史也要解密重传，不能留"一半密文一半明文"。

产品负责人 2026-11-01 的原话，逐字记在这里：

> 「我觉得这是可选的，是卖点没错，但用户应该有自主关掉的权利。我觉得我肯定会选C」

> 「现在基本没用户，老师，我现在还没开始推广。」

第二句是本次**放开可逆性**的依据：AGENTS §0 的开发阶段前提成立，所以"关掉之后再打开"
不需要为存量备份做迁移设计，两个方向都开。

## 二、背景：三条实测事实决定这不是一个 UI 开关

| # | 事实 | 出处 |
|---|---|---|
| 1 | **本地库是明文**。op 的 payload 原样落库，`packages/storage` 三套适配器与 `packages/op-log` 里零加密调用 | [legal-dataflow-client.md:38](../research/legal-dataflow-client.md) |
| 2 | **服务端今天主动拒收明文**：`violatesE2eeGate` 要求 `isPayloadEncrypted === true` 且载荷是密文形状，ops 与 snapshot 两条入口都过闸 | `server/src/sync/sync.routes.payload.ts:47-52`、`sync.routes.ops-handler.ts:139`、`sync.routes.snapshot-handler.ts:124` |
| 3 | **口令只在密钥那一步用**：拿不到 cipher 就明确拒绝上传（`no-encryption-password`），宁可不同步也不明文上传 | `packages/sync-client/src/client.ts:794-810` |

由此推出两件必须一起做、但不能混成一个开关的事（§三）。

## 三、两个轴必须分开

今天的实现把两件事绑在了一个"口令"上。拆开之后语义才干净：

| 轴 | 取值 | 谁决定 | 云上是什么 |
|---|---|---|---|
| **A. 同步加密** | **开**（默认）／ 关 | 用户显式切换 | 开 = 密文；关 = 明文 |
| **B. 钥匙放哪**（仅 A=开 时存在） | **设备持有**（默认）／ 每次输入 | 用户偏好 | 不影响"服务端能否读" |

判据一句话：**A 决定隐私边界，B 决定麻烦程度。** 过去 B 被写死成"每次输入"，
于是用户把"麻烦"错记成"加密"，这次要拆开。

🔴 **不许做**：把"记住解锁"实现成"不加密"。那会让用户以为自己在加密保护下，
而云上已经是明文 —— 这是本 ADR 要消灭的那类事故。

## 四、选项

| 选项 | 优点 | 否决理由 |
|---|---|---|
| **A. 维持强制 E2EE**（现状） | 承诺最硬，营销最简单 | 用户"没得选"；且与托管 AI 冲突 —— 会把用户逼进"要么背口令、要么不用 AI"的二选一，而他两条都想要 |
| **B. 加一档"服务端持钥"** | 我们替他保管，可帮恢复 | 这是"我信你"，不是"我不需要这层"；与 E2EE 同时存在会变成两套信任语义，客服和条款都说不清。**将来要加是另一份 ADR**，本篇不含 |
| **C. 默认 E2EE + 设备持钥 + 可显式关掉**（选定） | 想要隐私的人什么都不用做；不想要的人有一次明确的选择 | 关掉之后有一条不可撤回的窗口（见 §七 第 4 条） |
| **D. 默认不加密** | 最省事 | 卖点消失，等于放弃这个产品的身份 |

**为什么不选看起来更省事的 B**：B 把"我们能读"变成默认的另一种形态，而 C 把"我们能读"
变成**用户说过的话**。后者在合规上（PIPL 第 14 条的告知同意）、在工程上（一种模式一个代码路径）、
在叙事上（"零知识是默认，不是唯一"）都更站得住。

## 五、落地形状

### 5.1 账号级模式（唯一的真相源在服务端）

- `user_sync_state` 增加**可空**列 `payload_mode`（`'e2ee' | 'readable'`，默认 `'e2ee'`）。
  按 AGENTS §3.3：新字段可选 + 运行时默认值；**不动** `CURRENT_SCHEMA_VERSION`（那是实体 schema，不是库表）。
  迁移脚本按 [db-migrations.md](../agents/db-migrations.md)，单语句。
- 线协议**只增可选字段**：`GET /api/sync/key-package` 的响应加 `payloadMode`。
  老客户端读不到该字段时按 `'e2ee'` 处理 —— 这是**唯一**允许的默认推断。
- **入口闸门改成按模式判定**（`violatesE2eeGate` 旁边加 `violatesPlaintextGate`，两者互斥）：

  | 账号模式 | 上传 `isPayloadEncrypted` | 结果 |
  |---|---|---|
  | `e2ee` | `true` + 密文形状 | 放行 |
  | `e2ee` | 其它任何值 | 拒绝（沿用今天的 `E2EE_REQUIRED`） |
  | `readable` | `false` + 明文形状 | 放行 |
  | `readable` | 其它任何值 | 拒绝（新码 `PLAINTEXT_REQUIRED`） |

  🔴 **两个方向都拒错配**。只放行"该来的那种"，是为了让"半开半关"在服务端就不可能存在，
  而不是指望客户端自觉。

### 5.2 关闭 = 一次整库迁移（复用既有 staging，不新造协议）

复用 [ADR-0050](0050-e2ee-key-lifecycle-and-recovery.md) §后果 那套
`manifest → chunk → commit` 的 staging，只把 `targetMode` 带进 manifest：

1. 客户端（已解锁）建 manifest：`targetMode='readable'`、`expectedLatestSeq`、操作数与字节预算；
2. 本地逐条解密 → 以明文形状分片上传；服务端按上面的表校验**明文形状**，并继续做配额/幂等；
3. `commit` 在同一个事务里：替换全部 payload、置 `payload_mode='readable'`、
   清 `payloadKeyVersion`、**删除 key package**（今天是"独立 DELETE 拒绝"，此路要在 commit 内放行）；
4. 其它设备下次同步读到 `payloadMode='readable'`：丢弃 root、清掉 Keychain/Keystore 条目、
   走无钥路径继续 —— **不从"取不到密文"推断"应该降级"**，只从服务端声明推断。

### 5.3 打开 = 一次全量加密迁移（生成**新** root）

不要在 readable 模式里保留旧 key package 等着复用 —— 用户已经关过一次，旧恢复码的语义早就坏了。
所以：新建 root + 新恢复码 + 新 package，再走同一套 staging 反向迁移（`targetMode='e2ee'`、
 `targetPayloadKeyVersion` 递增）。其它设备在模式切回 `e2ee` 后**必须**重新解锁，
否则就是 `no-encryption-password` 停下 —— 这是**正确且可观测**的终止态，不许被写成"同步失败"。

### 5.4 钥匙默认由设备持有

| 平台 | 现状 | 本 ADR 要求 |
|---|---|---|
| Android | Keystore 信封已实现，"记住解锁"是**显式 opt-in** | 创建 vault 时**默认勾选**；logout fence 语义不变（登出即禁用） |
| iOS | Keychain `WhenUnlockedThisDeviceOnly` 已实现，同为 opt-in | 同上 |
| macOS 桌面 | `apps/node-host/src/keychain-secret-store.ts` 已有 `security -i`（**仅 darwin**） | 复用到宿主；Windows/Linux 未实现，那两平台继续要求口令，**不许假装可用** |
| Web | 无 OS 钥匙串；今天 reload 即锁 | root 放 **`sessionStorage`**（活到标签页关闭），**不放 `localStorage`**；文案必须说清它挡的是服务器、不是本机浏览器 |

⚠️ Web 那条要如实写：`sessionStorage` 对 XSS 是暴露的，增量是"能解开**全部历史**"而不是
"本机能读的那一份"（本地明文库本来就在 XSS 射程内）。这是本 ADR 唯一接受的新增风险面。

### 5.5 界面与文案

设置 → 同步与隐私，两行：

- **端到端加密**：开（默认）／关。关闭要过一次确认浮层（按
  [overlay-feedback.md](../agents/overlay-feedback.md) 的"危险四档"定档），列三条后果：
  ① 服务端能看到任务内容；② 忘记口令不再等于丢数据，我们可协助找回；
  ③ 已进入备份/快照的明文无法撤回。
- **钥匙放在哪**：设备／每次输入（仅加密=开时出现）。

🔴 文案禁句：任何"更安全/更私密"这类不指向具体能力的比较。只写**谁能读**。
全仓对外表述从"服务端看不到明文"改成"**默认**服务端看不到明文"——
逐处清单见 §六。

## 六、被这条决策改到的对外表述（必须同步，不许只改一处）

| 位置 | 改法 |
|---|---|
| `packages/legal` 的隐私政策 / 个人信息清单 | 分模式写：关闭后任务正文属我们持有的个人信息，义务按明文档走 |
| `packages/i18n` 的 `site.integrations.e2ee.*`、`site.docs.passphrase.*` | 加"这是默认值，可以关"；删掉"这不是设置项，是写死的"这类绝对句 |
| `apps/landing` 托管同步条款 §3 | "我们没有能力读取" → "默认没有；关闭加密后可以" |
| `README.md` | 同上 |
| 托管 AI 文案 | 仍是"不受端到端加密"，**不因本 ADR 放宽**；但 readable 模式下它与同步同档，用户的困惑消失 |

⚠️ [ADR-0052](0052-public-facts-are-deployer-supplied.md) 的约束不变：这些是**部署者可交付**的事实，
自建部署的说法不能与官方实例混写。

## 七、后果

1. **卖点从"我们看不到"变成"我们默认看不到，而且你可以选"**。这更强，不是更弱 —— 但要求每一句
   宣传都带默认二字，否则就是虚假陈述。
2. `packages/sync-client` 从"两种加密模式"变成"加密 / 明文"两种写入路径，**读侧必须能同时读两种**
   （迁移期与另一台设备未跟进时都会遇到）。ADR-0016 的读侧处置照旧适用。
3. **服务端开始有能力读明文**。这是本 ADR 明确接受的代价；它把 PIPL 的"个人信息处理者"义务
   从"密文保管"扩到"内容保管"，泄露通知、内部权限、日志脱敏都要按明文档复核。
4. **关掉有一次不可撤回的窗口**：明文一旦上云并进入每日快照，就算再打开加密，那批副本也收不回来。
   开发阶段（无用户）不构成问题；**上线推广前必须重新审这一条**，届时可能要加冷却期或"关闭前导出"。
5. 配额/计量按字节算，明文比 base64 密文小约 1/4 —— 不需要改口径，但别把"省下的额度"当卖点写进文案。

## 八、判据（每条都要能红）

| 层 | 判据 |
|---|---|
| 服务端闸门 | 四种组合表逐格断言；`readable` 账号上传密文必须 4xx 且**不落任何行**（与 `E2EE_REQUIRED` 同等：拒绝发生在配额与指纹之前） |
| 关闭迁移 | 真实 PostgreSQL staging：关闭后 `payload_mode='readable'`、`payloadKeyVersion` 为空、key package 已删；新设备**不带任何秘密**能读全部历史 |
| 打开迁移 | 打开后必须用**新**口令解锁；旧口令/旧恢复码解不开（且报的是"解不开"而不是"同步失败"） |
| 客户端拒绝降级 | 模式切回 `e2ee` 且本机无钥 ⇒ 必为 `no-encryption-password`，**不得**出现任何一条明文上传 |
| 文案 | `pnpm check:legal-*` 与 landing 套件断言"默认"二字存在；逐条扫"写死的/不存在一份可读的库"这类绝对句 |
| 真实浏览器 | 关掉 → 刷新 → 不输口令读到历史；再打开 → 不输口令时同步停在可观测的终止态 |

🔴 反向变异（强烈建议做一条）：把闸门改成"两种都放行"，关闭迁移那条断言必须红。

## 九、未核实项

1. **Windows / Linux 的设备持钥没实现**（DPAPI / libsecret）。在那之前，这两个平台的 B 轴仍是
   "每次输入"，不能对外说"一次都不用再输"。
2. **Web `sessionStorage` 的 XSS 增量**只有定性判断，没有实测对比。
3. **readable 模式下托管 AI 的披露是否可与同步合并**：法务未定。工程上两者仍是独立授权
   （ADR-0006），本 ADR 不动它。
4. **每日快照/备份里的明文**与 [ADR-0048](0048-deletion-four-states-and-the-no-physical-erase-boundary.md)
   的删除边界如何交互，未逐条推导。
5. **明文形状校验**只能验形状（和今天密文一样），不能证明"这真是明文"—— 一个说谎的客户端仍可上传
   base64。服务端不承诺能识破，只承诺"按声明拒错配"。

## 十、不可做的事

- 不许把"记住解锁"实现成"不加密"（§三）。
- 不许在 readable 模式下上传密文，也不许在 e2ee 模式下上传明文 —— 哪怕"只有一次"。
- 不许在 readable 模式下保留旧 key package 或旧恢复码，制造"也许还能救"的暗示。
- 不许把托管 AI 描述成端到端加密（ADR-0013 那条没被本 ADR 取代）。

## 十一、落地后事实（2026-11-01，只追加，不改上面任何结论）

- §5.4 的表格里"macOS 桌面"那一格在当时写的是"复用到宿主"。实施时现量发现**桌面壳里根本没有这个端口**：
  `grep -c vaultRootKeyStore apps/desktop/src/host.ts` = 0、`apps/desktop-macos/Sources/HeytaMac/HeytaMacApp.swift` = 0 ——
  macOS 壳是 WKWebView 载 `web-dist`，钥匙串要接就得上 Swift↔JS 桥。
  ⇒ 三端的**原生**钥匙串都还没有；Web（含 macOS 壳里的共享 UI）走 `sessionStorage`。
- Web 的 `sessionStorage` 实测在**刷新**后仍可用、**关标签页**即失效（6 条单测钉住，含"一个字都不进 localStorage"）。
- **§十一 追加（2026-11-02）**：上面那条"macOS 壳没有这个端口"已经补上了 ——
  `HeytaShellCore/VaultKeychainStore`（Keychain Services，`WhenUnlocked`、不进 iCloud Keychain）
  + `ShellVaultKeychainBridge`（`heytaVaultKeychain` 消息通道）+ 页侧 `vault-root-keychain.ts`
  （**优先于** `sessionStorage`，桥不在时行为不变）。实测：`check:macos-shell` 新增的
  4 条 Keychain 往返判据全绿（存/读/更新/删后读不到/16 字节被拒），页侧 10+4 条单测绿。
  ⚠️ **端到端"冷启动免输"仍未验**（要签名的 `.app` 真启动两次，而本会话拿不到屏幕取证）；
  Windows/Linux 的 DPAPI/libsecret 仍按上文推迟。

## 十二、被取代的那一半（2026-11-01）

本文 §一 第 1 条「端到端加密仍是**默认**，也是卖点」已由
[ADR-0081](0081-encryption-is-opt-in-not-default.md) 取代：**默认改为明文，加密由用户显式开启**。
本文其余结论（两个轴分开、关闭=整库迁移、钥匙可由设备持有、两个方向都拒错配、
fail-closed 到 e2ee）**一条不动**。
