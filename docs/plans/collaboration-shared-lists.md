# 共享清单与协作（清单级多人协作）落地计划

> 状态：**进行中**（2026-10-08 立；W0–W3 已落地，逐条见 §3 —— 原写「规划中」，**2026-10-16 更正**）
> 🔴 **现状与下一步以 §9 为准（2026-10-20 复账）**：§3 那张 W 表与 §7 的 DoD 是 10-08 立的工单分解，
> 逐条已落后于代码 —— 尤其 §7 的 DoD 会被"元数据面已通"读成"协作已可用"，而**内容面今天整段是断的**（成员互相看不到任务与评论）。
> 三条产品拍板（入口先降级、转让语义保留、并发改成按字段胜出）与里程碑顺序都在 §9。
> 立单：2026-10-08。产品负责人认可调研结论与 UX 十二条裁决（§1）后指令「制定一个完整的计划」。
> 证据层：[共享清单调研](../research/collaboration-shared-lists.md)（2026-10-08；滴答帮助中心全文一手抓取 + 仓库双路只读调研 + Ink & Switch / RFC 9420 / Etebase）。
> 决策记录：[ADR-0062](../adr/0062-shared-list-key-distribution.md)（2026-10-08 已立；⚠️ **2026-10-16 更正：那句「实施未开始」已过期** —— 服务端与 Web 宿主已落地，但**客户端 share op-log 引擎与多写者写路径路由未接线**，逐条见该 ADR 的状态行）。
> 对标缺口：[`dida365-feature-benchmark.md`](../research/dida365-feature-benchmark.md) §2.6 的 6.1 / 6.2 / 6.3 / 6.7 由本计划闭合。

---

## 0. 这件事收窄了哪些在册断言（先说清，别当没人写过）

规则：**ADR 只增不改**（AGENTS §8「不要擅自做的事」）。ADR-0044 原文不动，由 **ADR-0062 收窄其适用范围**（它排除的是「服务端必须读明文做跨用户聚合」的形态；密钥分发型协作不在射程内）。plans / research 层的三处旧断言由 W0 勘误（不改历史结论、只加「适用范围已被 ADR-0062 收窄」的指针）。

| 在册说法 | 出处 | 处置 |
|---|---|---|
| 「共享/协作倒数日：E2EE 下结构上不可能」 | [ADR-0044](../adr/0044-countdown-anniversary-entity-calendar-data-and-image-tiers.md) 排除清单 | 原文不动；ADR-0062 收窄理由 |
| 「共享日历/协作：E2EE 下结构上不可能」 | `ui-review-fill-zh-timeline.md:2265` | W0 勘误加指针 |
| 「❌ 共享/协作倒数日」 | `countdown-anniversary.md:21` | W0 勘误加指针（倒数日实体本身**不在本计划范围**，见 §6） |
| 「评论/指派结构上不可能」 | `dida-ai-assistant-gap-analysis.md:321` | W0 勘误加指针 |
| 「heyta 没有共享/协作……『全员可见』是为将来预留」 | `schema.prisma` `User.displayName` / `UserAvatar` 注释 | W2 随 IdentityKey 表一起更新（仍**不做**按他人身份查资料的全局端点，见 §2.7） |
| 「没有社区、没有共享清单、没有评论」 | `packages/legal/src/documents/privacy.ts:481`（中英镜像） | W4 随 UI 一起改写 + 升版本（§5） |
| 激励红线「排行榜/联赛/组队结构上不可能」 | `roadmap.md:96-97`、AGENTS §9 | **不动、继续成立**（它封的是聚合型；本计划做的是分发型） |

## 1. 已拍板的产品决策（2026-10-08，产品负责人认可的十二条）

| # | 决策 | 一句话理由 |
|---|---|---|
| D1 | **清单级共享**，不做任务级 | 用户心智「这个清单是我们家的」；一次设定终身有效；滴答验证过 |
| D2 | **分享链接 = 入群凭证，不等于密钥**：一次性 token，可吊销、可过期；入群后密钥走公钥信封 | 链接泄露可撤；体验仍是一根链接 |
| D3 | **移除 = 立即 rekey 新数据 + 后台全量重加密历史**（进度可见） | 用户对「移除」的朴素预期就是「他再也看不见」；任务数据 KB 级，成本可控 |
| D4 | **逐 op Ed25519 签名** | 「谁改的」可信是任务动态的地基；验签失败标「无法验证作者」 |
| D5 | **通知 = 服务端盲推信号 + 客户端本地过滤**；通知偏好存本地（三档默认通知 + 四档任务提醒 + 自动接受已知合作者） | 服务端零知识；比滴答更强（它的通知设置在服务端）；默认值：指派给我/@我/评论回复开，添加/删除/完成关 |
| D6 | **并发 = 静默 LWW + 动态可追溯 + 可恢复被覆盖版本** | 不弹框打断协作；op-log 双方版本都在，滴答给不了一键恢复 |
| D7 | **付费墙照抄「只需所有者是会员」**：owner 的 hosting 有效即可共享，29 成员/清单，成员免费；自托管不限 | 共享即增长；消除「为什么比滴答少」的比价疑问 |
| D8 | 共享清单**视觉辨识**：侧栏成员头像叠层 | 一眼知道「这是共享的、都有谁」 |
| D9 | **身份按共享空间作用域**：per-share 名片（昵称+头像，list key 加密），不做全局公开资料 | 不破「displayName 只有本人能读」的现状，不需要全局端点 |
| D10 | **指派打通个人工作流**：智能清单渗透四档（默认：指派给我的进「今天」，指派给他人的不进） | 否则共享清单是孤岛，协作嵌不进个人效率流 |
| D11 | **共享前隐私预览**：明示共享后哪些内容对成员可见、服务端新增哪些元数据 | 用户冲隐私来的；也是与滴答的差异化 |
| D12 | **MVP 顺序按协作动词排**：邀请+成员管理 → 指派+通知 → 评论+@+动态 → 智能清单渗透 → 链接/清单动态 | 信任的地基先于锦上添花 |

## 2. 架构总览

### 2.1 密钥层级与分发

```
每用户身份密钥对（新增）：
  Ed25519（签名）+ X25519（封装）
  私钥由 vault root key 包裹存服务端（解锁会话内可解出）
  公钥发布到 IdentityKey 目录（成员间互相可见）

每个共享清单一把 listKey（256-bit 随机，keyEpoch 版本化）：
  share 内 op 密文 = HKDF(listKey, purpose='share-sync', keyEpoch) 派生
  （复用 vault codec 的信封 + AAD 形状，`payload-cipher.ts`）

成员信封：ShareMemberKeyEnvelope { userId, identityKeyEpoch, wrappedListKey }
  = X25519 + HKDF + AES-GCM 把 listKey 包给成员加密公钥

rekey（移除成员 / owner 主动轮换）：
  新 listKey'（keyEpoch+1）→ 为剩余成员各产新信封 →
  历史 op 全量重加密（照 ADR-0050 staging 迁移的 inventory/chunks/commit 形状，
  原子发布、失败可续传、幂等回执——规则 16 的判据全套照搬）
```

- `VAULT_KEY_PURPOSES` 增加 `'share-sync'`（`key-lifecycle.ts`）。
- **不引入 MLS**（RFC 9420）：≤29 人、低变更场景信封式足够，rekey 成本 O(成员数)×低频（调研 §2）。留作远期升级路径，写进 ADR-0062 的「拒绝的方案」。
- 依赖：Ed25519/X25519 需要**新第三方库**（Hermes 的 WebCrypto 没有 Ed25519）。候选 `@noble/curves`（MIT、零依赖）。🔴 **过两道门再动手**：`ghinfo.py` 查活跃度（2021 后持续更新）+ `license-inventory` 登记（AGENTS §3.1/§3.2）。这是 W1 的前置闸门。

### 2.2 数据分区：share op-log 与个人 op-log

- 新表 `ShareOperation`（`@@unique([shareId, serverSeq])`），独立于 `Operation`；端点族 `/api/shares/:shareId/ops/*`。**个人 op-log 一个字节不动。**
- 客户端：个人 engine 照旧；每个 share log 各自 replay，**物化进同一个 `MaterializedState` 的分区**（reducer 是纯函数按 entityType 分桶，目标零改动——W3 判据；若必须改，在 ADR-0062 里说明）。
- **写入路由在 `packages/app-host`**（§3.5 边界）：`createTaskActions` 层按「目标清单是否共享」决定 op 进个人 log 还是 share log。`apps/*` 不出现这个判断。
- 实体归属：共享清单内的 TASK / PROJECT / TAG / NOTE / COMMENT / EVENT 的 op 全进 share log；**个人偏好类实体（REMINDER、FOCUS_SESSION、PREFERENCE_CORRECTION）留个人 log**、引用共享实体 id——「提醒是每成员自己的」与滴答一致（它的任务提醒四档就是个人设置）。
- 向量时钟：share 域**独立时钟**（维度仍 clientId）；**rekey = epoch 重置计数** + checkpoint 压缩。29 成员 × 3 设备 = 87 分量，贴近 `MAX_VECTOR_CLOCK_SIZE = 100`（ADR-0008 的墙）——风险 R-1，对策与成员上限挂钩（§6）。

### 2.3 op 作者身份与签名

- 加密 payload 增加 `authorUserId` + `authorIdentityKeyEpoch` + `authorDisplayNameSnapshot`（身份靠 list key 保密）。
- 逐 op Ed25519 签名放 op 明文部分，**覆盖（op 身份 AAD ∥ 密文 tag）**：所有成员都有 list key、都能伪造别人的 op，签名是唯一身份证明（D4）。验签失败的 op：物化照常、动态面板标「无法验证作者」。
- LWW 平局保持 `(timestamp, clientId)`——收敛语义不变，多用户下天然收敛（向量时钟多写者本就支持）。
- **任务/清单动态 = op 流投影**（含 LWW 平局记录「A 与 B 同时编辑，保留了 A 的版本」+ 被覆盖方可一键恢复——op-log 双方都在，事件溯源的红利）。

### 2.4 服务端模型与权限硬门

新迁移新增 4 张表（纯 CREATE TABLE，无 CONCURRENTLY，走普通迁移 + `check:migrations`）：

```prisma
model Share            { id, ownerUserId, keyEpoch, createdAt, deletedAt? }
model ShareMember      { id, shareId, userId, role, keyEnvelope Json,
                         addedAt, removedAt?   @@unique([shareId, userId]) }
model ShareInvitation  { id, shareId, tokenHash, invitedByEmail?, createdBy,
                         expiresAt, revokedAt?, acceptedByUserId? }
model ShareOperation   { id, shareId, clientId, serverSeq, …密文列
                         @@unique([shareId, serverSeq]) }
```

- **权限硬门（服务端）**：上传时按 role 拒写——`editor`：全部共享实体；`commenter`：仅 COMMENT；`viewer`：全拒。`entityType` 是既有明文元数据（服务端本就可见），此门可行。客户端 UI 约束是软门（Ink & Switch 权限哲学，调研 §2）。
- 移除语义（复用既有形状）：`removedAt` 置位 + 断该成员 WS + 上传拒 + 下载响应带 `removedMemberships`（照 Etebase 形状）+ **服务端发起 rekey 通知**（owner 端执行 D3）。
- WS：`new_share_ops` 信号按 shareId 广播给成员连接（复用 `notifyNewOps` 去抖形状）；**信号不含 op 内容**（「WS 只传信号」安全契约延续，`realtime.ts` 文件头）。
- 🔴 **部署顺序是硬的**（ADR-0044 ② 先例）：COMMENT 新实体必须**服务端先上线**，否则 `INVALID_ENTITY_TYPE` 硬拒且永久——W3 的发布纪律。

### 2.5 通知：盲推 + 本地过滤

- **在线**：WS 信号 → 拉取 → 解密 → **本地过滤**（三档默认通知 + 四档任务提醒 + 自动接受已知合作者，全部存本地）→ 本地通知。`assignee` **不进明文元数据**。
- **站内**：邀请 / 被移除 / 角色变更这些**服务端已知事实**落 `account_notifications`（通知中心复用，2026-09-29 已有铃铛+徽标）。
- **离线 push：v1 不做**（现状基础设施为零：APNs/FCM 是新第三方依赖 + 推送 token 是新元数据）。降级路径：下次启动/打开时通知中心补报 + WS 在线实时。web push 若 `WidgetPushSubscription` 基础设施可复用，W5 评估。诚实登记为边界 B-3。

### 2.6 付费墙与限额

- `ENTITLEMENT_CAPABILITIES` 加 `'sharing'`（`server/src/entitlement.ts:52`）；owner 的 hosting 有效 ⇒ 可共享（`evaluateCapabilityAcross` 并集判定已有多来源形状，2026-09-30 那次奖励行盖掉付费时长的修复）。
- 29 成员/清单上限（对齐滴答）；自托管 sharing 恒真（ADR-0017「自建永久免费」）。
- 成员**不要求**任何会员身份（D7）。

### 2.7 与既有红线的关系

| 红线 | 关系 |
|---|---|
| 激励红线（排行榜/联赛/组队不可能） | **不动**。本计划不产生任何跨用户聚合；「共享任务状态」类玩法（Habitica 式组队 Boss）仍不做 |
| local-first | **不动**。共享实体本地照常有完整副本 + 离线可写，同步是通道 |
| op-log 纪律（一个意图一个 op；回放无副作用） | **不变**。share op 同纪律 |
| 「服务端只存密文」 | **不动**。新增明文元数据仅：成员关系、share 存在性、role、entityType（既有）、时间戳——全部登记进隐私文档元数据清单（§5） |
| displayName「只有本人能读」 | **不破**。per-share 名片用 list key 加密进 share log；**不建**按他人身份查资料的全局端点 |
| `CURRENT_SCHEMA_VERSION` | **不 bump**。新字段全部可选 + 运行时默认（AGENTS §3.3） |

## 3. 分阶段交付（W0–W6）

> 每阶段收尾跑该阶段判据 + `pnpm -r typecheck && pnpm -r test`。**测试要能失败**：每条判据至少一个变异臂（AGENTS §8.3）。

### W0 — 勘误 + 依赖门 + 设计冻结（✅ 已完成 2026-10-08，读数见 [goal](goal-collaboration-shared-lists.md)）

- ✅ [ADR-0062](../adr/0062-shared-list-key-distribution.md) 已立：密钥分发架构、share op-log 分区、签名、权限硬门、拒绝的方案（MLS / 任务级共享 / 链接即密钥 / 只改门不 rekey / 字段级合并 / 聚合型 / 联邦）、「聚合型不可做 / 分发型可做」的概念拆分全在里面。
- ✅ 三处勘误（§0 表）+ `dida-ai-assistant-gap-analysis.md:321`。
- 依赖两道门过审（`@noble/curves` 或同等）：`ghinfo.py` 活跃度 + 许可登记。
- **判据**：`check:adr-numbering` 绿（0062 唯一）；`check:docs` 无死链；勘误三处各带指向 ADR-0062 的指针。**变异臂**：夹具里故意写一枚不存在的编号（门禁自带的悬空臂已证明会红——本文初稿就在 §W0 里真踩过一次，被它当场抓到）。
- **回退点**：纯文档，无代码回退。

### W1 — 密钥协议纯函数层（`packages/sync-core`）（✅ 已完成 2026-10-08，读数见 [goal](goal-collaboration-shared-lists.md)）

- ✅ `src/share-keys.ts`：身份密钥对（HKDF 域分离）/ listKey 派生 / 成员信封（ECIES 临时 X25519 + 四重 AAD 绑定）/ rekey / 幂等历史重加密 / op 签名——全部纯函数，零服务端依赖；`@noble/curves@2.4.0` 精确 pin（与 `inbound-core` 同版）。
- 判据落点：15 条 vitest（固定 seed 快照、信封仅目标成员可解、重放 fail-closed、幂等重加密、签名防伪造、JSON 面无密钥材料）；变异三臂 2/1/1 红（goal 文档 W1-2）。
- **判据**（vitest，照规则 13/16 的形状）：固定 seed 的收敛与幂等；信封只有目标成员私钥可解；重加密**重用同一密文形状**（可重算幂等请求）；重建客户端实例后续传（journal 不含 root/口令/恢复码/明文）。**变异臂**：拿掉信封的接收者绑定 ⇒ 非成员可解 ⇒ 红；重加密用随机 nonce 两次结果不同 ⇒ 幂等断言红。
- **回退点**：新增文件，不触碰既有导出。

### W2 — 服务端（表 + 端点 + 硬门 + entitlement）+ 法务第一批

- 🔴 **状态：服务端核心 ✅（2026-10-08，读数见 [goal](goal-collaboration-shared-lists.md) W2 节）**；**法务第一批 ⏳ 未做**（下一步）；**app-host share-client ⏸ 登记推迟**（撞车面：`packages/app-host/src/` 正被并行会话整片改写）。
- ✅ 迁移：4 张新表 + 6 条手写 CHECK（`20261018120000`）。✅ 端点族 `/api/shares/*`（14 条）+ role 硬门（`share.membership.ts` 纯裁决）+ 块状发号 + WS `new_share_ops`（只传信号）。
- ⚠️ entitlement 偏差：**未加 `'sharing'` 词**（四处同源 + CHECK 迁移的成本 vs. D7 用既有 `hosting` 精确表达）——闸门挂 `createEntitlementGuard()`（默认 hosting）；偏差已登记 goal 文档、待产品负责人追认。⚠️ B-6 细化：信封在接受后下发（成员公钥随 accept 入群），预授权信封待 IdentityKey 目录。
- ✅ 判据：`check:migrations` 绿（65 迁移）；PGlite 证据 8 条（发布中的迁移 SQL + 合法对照行）；role 硬门路由级 23 条（401 遍历 14 端点）；变异臂**恰好 2 红**（拿掉 role 判定）；金丝雀 40 绿；tsc 0 错。
- 法务第一批（未做）：`third-parties.ts`（共享分类 + PIPL 23 单独同意评估）、`data-rights.ts`（注销时他人副本边界）、`personal-info-list.ts`、`schema.prisma` 两处注释、隐私元数据清单加「成员关系/共享对象」——中英同步 + `legalSetVersion`。
- **判据**：`check:migrations` 绿 + PGlite 证据（照 activity-schema 先例）；role 硬门路由级测试（遍历全部新端点的 401/403/404，照 admin-console 先例）；「未登录不发请求」短路在 `packages/app-host` 的 `share-client.ts`（判据钉对层，admin-console 的教训）。**变异臂**：拿掉 role 拒写 ⇒ viewer 可写 ⇒ 红；包名写错时 `--filter` 假绿陷阱（AGENTS §6 注）不复发。
- **回退点**：新端点族独立挂载；表可空转不影响既有同步路径。

### W3 — 领域层 + 引擎接线（🔴 服务端先上线）

- `shared-schema`：`ENTITY_TYPES` 加 `COMMENT`（服务端白名单同数组派生，`validation.service.ts:25`）；`Task.assigneeUserId?`、`Project.shareId?`（可选字段，不 bump schema）。
- `COMMENT` 实体一条一实体（照 `ASSISTANT_TURN` 模板：`entity-types.ts:83` 的论证——数组字段会被 LWW 覆盖语义吞掉）：`{ taskId, body, authorUserId, authorIdentityKeyEpoch, createdAt, editedAt? }`。
- op payload 作者字段 + Ed25519 签名/验签（W1 原语）；share log 引擎 + 物化分区 + 写入路由（`packages/app-host`）；动态投影（任务/清单动态 + LWW 平局记录 + 恢复被覆盖版本）。
- **判据**：reducer **零改动**（或 diff 里逐行说明为什么必须改）；固定 seed 双引擎乱序/重复/先于 CREATE 收敛对账（规则 13 全套：收敛、重试无新状态、时钟=逐维最大、墓碑不被旧写清掉）；签名验签失败 ⇒ 动态标「无法验证作者」；**变异臂**：伪造他人 authorUserId ⇒ 验签红；共享实体 op 误入个人 log ⇒ 路由判据红。
- **回退点**：COMMENT 未上线服务端前，客户端 feature flag 关（默认关，照 local-api 先例）。

### W4 — 客户端 UI + 法务第二批

- 邀请流（邮箱/站内；链接是 W6）+ 成员管理面板（三档权限）+ **共享前隐私预览**（D11）。
- 指派（详情页/批量/创建时 `@`）+ 成员筛选视图 + **智能清单渗透四档**（D10，默认指派给我的进「今天」）。
- 评论 + `@` 补全 + 评论区。
- 通知中心接线（邀请/指派/评论@落 `account_notifications`）+ **本地通知过滤**（D5 三档默认 + 四档任务提醒 + 自动接受已知合作者 = 滴答截图那页）。
- 共享清单视觉辨识（头像叠层，D8）+ per-share 名片（D9）+ 任务/清单动态面板（D6 的可追溯+恢复）。
- 🔴 前置：**先把 `createRealtimeClient` 的最后一米接上**（单账号实时本来就没接线——三处登记：web store / 两端 realtime-wiring 测试）。
- **法务第二批**：`privacy.ts:481` 那句改写（中英）+ 帮助中心 + 落地页 FAQ + 版本升级 + 同意指纹。
- **判据**：真浏览器 Playwright 全旅程（邀请→接受→指派→评论→通知→动态）+ **截图落固定路径 + 人看图**（AGENTS §6.2 规定一：四条全做到，console/pageerror 监听窗口一创建就挂）；i18n 中英同步（`check:ui-language`）；`check:design` 无裸值；通知默认值单测 + 变异（拿掉「指派给他人的除外」过滤 ⇒ 红）。**变异臂**：权限 UI 拿掉 viewer 只读约束 + 服务端硬门在 ⇒ 服务端红（软硬双门各自的臂）。
- **回退点**：feature flag 按模块（邀请/指派/评论可独立开关）。

### W5 — 通知完善 + web push 评估

- 设置页「共享协作」（= 截图那页：自动接受 + 三类默认通知）。
- web push 盲推评估：若 `WidgetPushSubscription` 基础设施可复用 ⇒ 做「清单有更新」盲推（零内容）；否则登记边界。移动端离线 push **不做**（B-3）。
- **判据**：设置变更只影响本地过滤（网络断言：改设置零请求）；盲推报文断言不含任何 op 内容/实体 id 之外的语义。

### W6 — 分享链接 + 清单动态 + 收尾

- 分享链接（D2：一次性 token、可吊销、可过期、`tokenHash` 落库、链接不含密钥）；清单动态桌面端；owner 转让（调研未确证滴答行为，做成「转让=换 owner + 原 owner 降 editor」）。
- **收尾固定动作**（AGENTS §6.1.1）：`pnpm reinstall:all` 四端重装。
- **写回**：`dida365-feature-benchmark.md` §2.6 的 6.1/6.2/6.3/6.7 翻 ✅（带证据链接）；`feature-matrix.md` 对应行；`roadmap.md`；AGENTS §9 进度行；本计划状态行翻「已完成」。
- **判据**：链接吊销后邀请失败且密钥从未入 URL（断言 URL/token 内容）；`check:docs` 全绿。

### 排期（2026-10-17 现量排定；本线执行：W2 尾 → W3 → W4）

> 依据：`pnpm check` 第 6 道 `check:reachability` 的现量是 **断言 B 绿 / 断言 C 红**，
> 而 C 要的是**端壳里真的调用得到**（判据的扫描面 `HOST_ROOT='apps'`、`HOST_REQUIRED_SUBDIR='src'`，
> 见 `scripts/check-reachability.mjs:360-361`；现成例子 `apps/mobile/src/screens/TasksScreen.tsx:629`
> 里的 `createTaskActions(host)`）⇒ **转绿点在 W4-0（端壳接线）**，app-host 内部接得再真也不算。
> ⚠️ 这一条先前被我写错过一遍（写成"排到 W3 末尾即可"），是读判据本体才纠正的：判据要的正是"用户碰得到"。
> 产品边界一律按 §1 十二条与 §2 架构推导（不再回问产品）：写入路由住 `packages/app-host`、
> share 域独立分区与独立时钟、逐 op Ed25519 签名是唯一身份证明、`COMMENT` 一条一实体。

| 序 | 切片 | 交付 | 判据（能红） |
|---|---|---|---|
| ~~W2-T1~~ ✅ 2026-10-17 | `packages/app-host/src/share-client.ts` | 把 `ShareApiClient.uploadOps/downloadOps` 接到 app-host：listKey/epoch → `createSharePayloadCipher` 加密 → 逐 op 签名 → 上行；**未登录短路（零请求）** | 注入 fetch 替身：未登录时 `fetch` 调用数 == 0；登录时 URL/方法/头/体形状逐字（判据钉在这一层，照 admin-console 的教训） |
| W2-T2 | 法务第一批 | `third-parties.ts` / `data-rights.ts` / `personal-info-list.ts` 三处中英同步 + 版本升级 + 同意指纹 | `check:legal-*` / `check:ui-language` / `check:i18n-vars` |
| W3-T1（纯核 ✅ / 物化 ✅ / 本地落盘 ✅ 2026-10-17；下载解密回放 ⏳） | share op-log 引擎与落盘 | per-share op-log（**独立向量时钟**、rekey = epoch 重置）、物化进同一 `MaterializedState` 的分区、下载→解密→回放 | 固定 seed 双引擎**乱序/重复/先于 CREATE** 的收敛对账（规则 13 全套）+ reducer **零改动**（或 diff 逐行说明） |
| ~~W3-T2~~ ✅ 2026-10-17 | 写入路由接线 | app-host 按「目标清单是否共享」选域；`dispatchShareOp` 有真实现 | 共享域那条链的收敛对账（乱序/重复/重试无新状态） |
| ~~W4-0~~ ✅ 2026-10-17 **断言 C 已转绿** | 端壳接线 | 某个端壳（`apps/<端>/src/**`）真的调用 `createCommentActions(host)`，像 `TasksScreen.tsx:629` 调 `createTaskActions` 那样 | **`check:reachability` 的 COMMENT 断言 C 转绿**。判据只在 `apps/<端>/src` 里数 `\b<家族>\s*\(`（`check-reachability.mjs:360-361`）⇒ app-host 内部接线**不算**，这正是它防"假绿"的地方 |
| W3-T3 | 逐 op 签名/验签 | Ed25519 签与验；验签失败**物化照常**、动态标「无法验证作者」 | 变异臂：伪造 `authorUserId` ⇒ 验签红 |
| W4 | 客户端 UI | 邀请流 / 成员面板（三档权限）/ 共享前隐私预览 / 指派 / 评论区 / 通知中心与本地过滤 / 共享辨识与动态面板 | 真浏览器全旅程 + 截图落固定路径并人看过（§6.2 规定一） |

现量（开工前核过，避免把"已做"再写一遍）：`packages/sync-core` 的三枚原语与 `packages/sync-client/src/share-api-client.ts` 的两条传输**都在**，
但**消费者为零**；`packages/shared-schema/src/entity-types.ts:114` 已有 `'COMMENT'`；`server` 侧 `/api/shares/*` 14 条 + role 硬门 ✅（§3-W2）。

## 4. 验证矩阵（verify 族，零 mock 形状照既有 verify:*）

> 🔴 进度（2026-10-08）：`verify:collab-keys` ✅（五步，`RESULT=OK`，变异臂=常量 listKey ⇒ 恰好第 3 步红）；`verify:collab-sync` ✅（九步真服务端闭环，`RESULT=OK`，变异臂=removedAt 过滤 ⇒ 恰好第 8 步红；脚本以真实原语+原始 HTTP 站位客户端引擎，接线后改走 SDK）；verify:collab-revoke ✅（七步移除全链路三面证据，变异臂=removedAt 过滤 ⇒ 恰好第 4 步红）；verify:collab-conflict ✅（六步并发收敛+恢复，双顺序重放，变异臂=LWW 反转 ⇒ 恰好第 3 步红）；journey ⏸ 等 W4 UI（范围顺序）。`verify:collab-keys` 进根 package.json 的一行接线因文件被占登记推迟，暂以 `node scripts/…` 独立运行。逐项读数见 [goal](goal-collaboration-shared-lists.md)。
>
> 🔴 进度更正（2026-10-10，会话交接）：四脚本已全部进根 package.json 且 sync/revoke/conflict 于当日复跑全绿（server 循环依赖修复后，见 goal 文档「2026-10-10 交接」节）。**W4 入口接线 + W5 挂载 + journey 三件套（config/spec/驱动脚本）代码已写完但未提交，`verify:collab-journey` 从未运行**——交接面与执行序在 [goal](goal-collaboration-shared-lists.md) 「2026-10-10 交接」节。journey 的「指派→评论→通知→动态」覆盖在 UI 未建成的部分如实登记为 W4 残余（同节第三条第 4 款）。

| 脚本 | 验什么 | 关键判据 |
|---|---|---|
| `verify:collab-keys` | 密钥协议闭环 | 信封仅成员可解；rekey 后旧 listKey 读不了新 op；历史重加密幂等可续传（重建实例） |
| `verify:collab-sync` | 两账号 × 两设备真实闭环 | A 建 share → 邀请 → B 接受 → 双方并发写 → 收敛；**服务端零明文**（搜库断言）；removedMemberships 传播 |
| `verify:collab-revoke` | 移除全链路 | 新 op 被拒；历史重加密完成（读数）；被移除端如实显示；WS 已断 |
| `verify:collab-journey` | 真浏览器全旅程 | 邀请→指派→评论→通知→动态；截图人看（§6.2 规定一） |
| `verify:collab-conflict` | LWW + 恢复 | 并发编辑平局收敛一致；动态记录双方；被覆盖版本可恢复且恢复后同步 |

每个 verify 脚本至少一个变异臂证明能红（AGENTS §8.3；先例：`verify:mobile-autosync` 拿掉写入信号 ⇒ 3 红）。

## 5. 法务与对外文档联动（AGENTS 规则 18 义务清单）

| 文档 | 改什么 | 阶段 |
|---|---|---|
| `privacy.ts:481`（中英镜像） | 「没有共享清单、没有评论」句改写为共享语义 + 指向 per-share 可见性说明 | W4 |
| privacy.ts 元数据 11 项 | 加「成员关系 / 共享对象 / role」类别，逐项用途与留存 | W2 |
| `third-parties.ts` | 跨用户共享新分类（PIPL 20/21/23）；**PIPL 23 单独同意评估**，若需 ⇒ 共享开启前同意界面 | W2（评估）/ W4（界面） |
| `data-rights.ts` | 注销边界：本人 share 的处置（owner 注销 ⇒ share 何去何从：转让 or 随账号删除 + 成员侧只读快照到期）；他人设备上的副本 | W2 |
| `personal-info-list.ts` | displayName 共享语境更新 | W2 |
| 帮助中心 / 落地页 FAQ | 共享能力说明（中英） | W4 |
| 版本机器 | `legalSetVersion()` → 同意指纹 → `UserConsent` 追加账 | W2/W4 各一次 |

## 6. 已知边界与风险登记

| # | 项 | 处置 |
|---|---|---|
| B-1 | **向量时钟墙**：29 成员 × 3 设备 = 87 分量，贴近 `MAX 100`（ADR-0008 挪墙未拆墙） | share 域独立时钟 + rekey epoch 重置 + checkpoint；W3 判据里放「N 成员模拟收敛」；不够则成员上限降档（15/9），**不调 MAX** |
| B-2 | 离线推送基础设施为零 | v1 不做；降级为通知中心补报 + WS 在线（§2.5）；web push W5 评估 |
| B-3 | PIPL 23 单独同意可能改共享开启流程 | W2 法务评估先行，界面留 W4 |
| B-4 | 历史重加密成本（超大清单） | 渐进 + 进度可见（D3）；照 ADR-0050 staging 可续传 |
| B-5 | displayName 全局可见滑坡 | per-share 名片；**禁止**按他人身份查资料的全局端点（schema 注释的纪律延续） |
| B-6 | owner 不在线时新成员拿不到密钥 | 邀请附「预授权信封」（创建邀请时已包好，接受即生效）；吊销 = token 失效 + 未接受信封作废 |
| B-7 | 撞车面：`PROJECT`/`TASK` 实体与侧栏 UI 正被多条并行线改 | W3/W4 开工前现量 `git status --porcelain` 撞车面（教训：判据是同一文件未提交 diff，不是「某条线在忙」的印象） |
| B-8 | 跨服务器联邦（自托管 A ↔ 官方 B 共享） | **不做**。成员必须在同一服务器；登记边界 |
| B-9 | 倒数日（EVENT）共享、日历订阅共享 | **不在本计划范围**；ADR-0044 的排除在 EVENT 域继续有效 |

## 7. 完成定义（DoD）

1. `pnpm check` 全绿（含新增测试与门禁；`-r test` 收尾对账：有 test 脚本的包数 == `Tests` 汇总行数）。
2. §4 五个 `verify:collab-*` 全绿，各自变异臂登记。
3. `pnpm reinstall:all` 四端装上当前产物（§6.1.1 固定收尾）。
4. §0 勘误 + §5 法务 + §3-W6 写回清单逐项闭合；`check:docs` 无死链。
5. 线上复验：共享旅程在部署镜像里真跑一次（照 server-i18n-design 先例）。
6. 未做/降级的（B-2 离线推送、B-8 联邦、B-9 EVENT 共享）在本文与 roadmap 里保持「未做」状态，**不包装成完成**。

## 8. 变更日志
- 2026-10-17：**W4 第一块落地** —— `CommentThread` 从全仓 0 处渲染变成 1 处（`apps/web` 详情栏里的评论区，`ShareCommentsSection.tsx`）。判据 `tests/task-detail-groups.spec.tsx` 当场拦下我「把评论区当第五个属性分组」的第一版：按产品定义，评论不是任务属性而是**协作线索** ⇒ 改成属性分组之下的协作区（标题视觉同款、testid 不冒充分组），四分组判据**未改**、照旧绿。读数：web 180 文件 / 2307 枚过，`check:i18n-vars` / `check:ui-language` / `check:reachability` / `check:docs` 全 rc=0。仍缺（如实登记）：实时订阅、vault 未解锁时的提示、@ 补全、编辑/删除评论的界面入口。
- 2026-10-17：**W3-T2 + W4-0 完成 ⇒ `check:reachability` 的 COMMENT 断言 C 转绿，`pnpm check:reachability` rc=0**（读数：`✅ COMMENT createCommentActions：1 处宿主调用点`）。转绿路径全部是真修：传输接线 → share 日志折叠/物化（复用同一枚 reducer，零改动）→ 评论宿主（未登录/密钥未解锁零请求、发完就地物化）→ 端壳装配（`apps/web/src/features/share/comment-actions.ts` 里真的 `createCommentActions(ctx, …)`）。**仍缺**：`packages/ui` 的 `CommentThread` 组件还没有任何端渲染它（全仓 0 处引用）⇒ 「用户点得到」是 W4 评论区那一步。
- 2026-10-17：**W2-T1 完成**（`packages/app-host/src/share-client.ts`：未登录短路零请求 + 加密与上线共用同一份 identity + 未登记 opType 抛；3 枚判据 + 变异臂恰好 1 红；整包 1835 枚过）。**W3-T1 纯核完成**（`share-op-log.ts`：去重幂等 / 重放全序 `(timestamp, clientId, id)` / 逐维最大且非法维度不折成 0；4 枚判据 + 变异臂恰好 2 红；整包 1839 枚过）。下一步：W3-T1 的落盘与「下载→解密→回放」，然后 W3-T2 写入路由接线（`check:reachability` 的 COMMENT 断言 C 在此转绿）。
- 2026-10-17（更正）：先前把 COMMENT 断言 C 的转绿点写成 W3-T2 是**错的**。读判据本体（`scripts/check-reachability.mjs:360-361`）：`HOST_ROOT='apps'`、`HOST_REQUIRED_SUBDIR='src'`，判据 C 只在 `apps/<端>/src/**` 里数 `\b<家族>\s*\(` 的调用面（现成例子 `apps/mobile/src/screens/TasksScreen.tsx:629` 的 `createTaskActions(host)`）。⇒ app-host 内部把 `createCommentActions` 接上**不会**让它转绿，必须有一个端壳真的调用它 —— 排期表新增 **W4-0（端壳接线）**，把转绿点挪到那里。
- 2026-10-17：本线按 §3 末尾的排期表开工（W2 尾 → W3 → W4）。现量：三枚原语与两条传输均在、消费者为零；`check:reachability` 的 COMMENT 断言 C 的转绿点见上一条更正（**W4-0 端壳接线**），在那之前它保持如实红。

- 2026-10-08：立单。调研见 [research/collaboration-shared-lists.md](../research/collaboration-shared-lists.md)；十二条产品决策（§1）经产品负责人认可；同日 [ADR-0062](../adr/0062-shared-list-key-distribution.md) 立掉。

## 9. 2026-10-20 复账与下一阶段计划：内容面整段断

> 状态：**本节是这一条线当前的权威现状**（§3 那张 W 表与 §7 的 DoD 是 10-08 立的，逐条已落后于代码；
> 读现状从这里读，别按 §3 推断"接完了"）。

### 9.1 现状（每条都带复量命令；本轮全部亲自跑过，不抄任何文档或子代理的数）

| 那一面 | 代码现量 | 怎么复量 |
|---|---|---|
| 元数据面（建共享 / 邀请 / 入群 / 成员 / 角色 / 转让 / 移除 / 退出） | ✅ 服务端与 Web 宿主都在 main 上，role 硬门在上传边界 | `pnpm verify:collab-journey`；`pnpm --filter @heyta/web --silent exec vitest run tests/share-panel-transfer.spec.tsx tests/join-link.spec.ts` |
| **内容下行** | 🔴 **零实现**。`downloadOps` 只有定义，全仓无生产调用点 ⇒ 客户端回放只吃本机 localStorage 那份 share log | `grep -rn downloadOps --include=*.ts --include=*.tsx apps packages` 去 spec 后只剩定义那一行 |
| **内容上行** | 🟡 **只有评论**：`uploadOps` 经 `createShareOpDispatcher` 接通，但调用链只从 `share-comments.ts` 进来 | `grep -rn createShareOpDispatcher --include=*.ts packages` ⇒ 生产消费者只有 `share-comments.ts` |
| **任务 / 清单的写路径** | 🔴 **仍进个人 op-log**。`project-actions.ts` 里唯一与 share 有关的方法是 `setProjectShareId`（挂个 id），没有任何"该进 share log 还是个人 log"的分流 | `grep -n -E "shareId\|share" packages/app-host/src/project-actions.ts` |
| 服务端可写白名单 vs 客户端实际 | 白名单已经认识 `TASK / PROJECT / TAG / NOTE / COMMENT`，**服务端不拦，是客户端没往那走** | 读 `server/src/shares/share.membership.ts` 的 `SHARE_WRITABLE_ENTITY_TYPES` |
| 并发判定 | 🔴 share 分区每条 op 的向量时钟被硬编成 `{ clientId: 1 }`（个人引擎那侧会自增自己那一维）⇒ 同设备两 op 恒 EQUAL、跨设备恒 CONCURRENT，判定只剩 timestamp 平局 | 读 `packages/app-host/src/share-client.ts` 里 `vectorClock:` 那一行，对照 `packages/op-log/src/engine.ts` 的自增 |
| 逐 op 签名 | 🔴 线协议里没有 `signature` 字段，写侧不签、服务端不验；原语在 `sync-core` 里躺着 | `grep -rn signature packages/shared-schema/src/supersync-http-contract.ts` ⇒ 零命中 |
| 移除即 rekey | 🔴 只有零件：`planShareRekey` / `reencryptShareRecord` 的调用者只有单测与 `verify-collab-*.mjs`；`autoSeal` 复封用的是**同一把 listKey**，`keyEpoch` 不推进 | `grep -rn planShareRekey --include=*.ts apps packages` ⇒ 无生产调用点 |
| 实时 | 🔴 服务端发 `new_share_ops`，客户端只处理 `connected`；`notification-model` 那三条偏好谓词生产消费者为零 | `grep -rn new_share_ops --include=*.ts packages apps` ⇒ 只有服务端那一处 |
| 端覆盖 | 🟡 Web 接了；**macOS / Windows / Linux 三枚桌面壳间接有**（包里装的就是 `apps/web/dist`）；**移动端零接入**；node-host/CLI 无 share 工具 | `grep -rn -E "SharePanel\|shareId\|payloadCipher" --include=*.ts --include=*.tsx apps/mobile/src` ⇒ 0 命中；`grep -n web-dist apps/desktop-macos/Sources/HeytaMac/HeytaMacApp.swift` |
| 常驻判据 | 🔴 本线没有一扇门在链上：`check` 那串里 `verify:*` 引用数为 0；`collab-journey` 被 `e2e/playwright.config.ts` 的 `testIgnore` 摘出主 e2e 载体；证据目录被 gitignore ⇒ 截图不可复核 | `node -e "const c=require('./package.json').scripts.check.split('&&');console.log(c.filter(x=>/verify:/.test(x)).length)"`；`grep -n -A5 testIgnore e2e/playwright.config.ts` |

⇒ **一句话的产品现状**：能邀请人、能管人、能转让，但**成员之间互相看不到任务改动、也看不到对方的评论**。
"共享清单"今天对用户交付的是**一张空的共享外壳**，不是协作。

### 9.2 三条产品拍板（负责人 2026-10-20 把判定权交下来，按产品视角定，不再回问）

**P-1 先把共享入口从"看起来可用"降级成"明确未开放"。**
现在页头上 `share-open-button` 是亮的、同意弹窗与邀请全链都在，而对面进来的成员看不到内容 —— 这不是"功能还没做完"，
**是让用户替我们发现"这功能是假的"**，而且发生在他把清单交出去**之后**（他已经邀请了同事）。
判定：主界面入口默认隐藏，只留一条带明确措辞的实验开关；配套 M7 的门禁 `check:share-entry-hidden` 钉住"默认态不可达"。
成本：一处条件渲染 + 一枚词条 + 一条会红的尺；收益：不拿真实用户的信任去测进度。
翻案条件：M1+M2 落地且两台设备真浏览器"互相看得到"验过 ⇒ 撤掉隐藏，那一枚门禁同时改成钉"可达"。

**P-2 owner 转让语义保留现形状**（两步确认 → 立即生效 → 原 owner 降 `editor`，服务端单事务原子写三处）。
理由：E2EE 下"对方接受才生效"需要一条待接受的握手状态，而转让最常见恰恰发生在**对方不在线**（离职、换设备、注销前）；
且服务端已把它写成单事务，"立即生效 + 原子"是同一件事的两面。
翻案条件：出现"转让后新 owner 拿不到 key 因而打不开清单"这类实测 —— 那说明转让与密钥轮换没做完（属 M3 的缺陷，不是语义错）。

**P-3 并发写语义定为「按字段胜出，不按整条记录胜出」。**
现状是个人清单那套 LWW：整条记录按 timestamp 比，赢者覆盖。在单人场景它够用（冲突罕见），
但共享后它会在用户眼前高频发生（两个人各自勾完成、改标题），症状是"我改的没了，而且没有任何提示"。
定案：share 分区的合并按 **字段级** last-writer-wins，其余字段保留对方那次改动；无共同祖先可判时不猜，落一条"待你定"的可见冲突提示。
🔴 这条要碰 `packages/op-log` 的 reducer（`applyOperation` / `compareMeta` 那一层）与 `shared-schema` 的线协议（`vectorClock` 必须真自增、加 `signature` 字段）——
**都在不可逆层**，所以 M2/M4 开工前必须先立一份新 ADR（不改已接受的 0062，新写一份承接它）。

### 9.3 里程碑与顺序（按"用户能感知到什么"排，不按代码难度排）

| # | 交付 | 判据（要能红） | 前置 / 不可逆点 | 归属 |
|---|---|---|---|---|
| **M1** | **下行链路接通**：`downloadOps` 接进宿主（游标持久化、分页收敛、解密回放、离线补拉） | 两台**独立**浏览器上下文：A 改一条任务标题 → B 在**不刷新**与**刷新后**两种时机都读到新标题；变异臂：把游标持久去掉 ⇒ 必红 | 只需 `packages/app-host` + `apps/web`，不碰线协议 ⇒ **可以先做** | 工程直接做 |
| **M2** | **任务/清单的写路径路由**：共享清单里的 `TASK/PROJECT/TAG/NOTE` op 进 share log | 路由判据住在 `packages/app-host`（`shareIdForTask` 那一族的**同源**函数，不许在壳里判）；红形：未共享清单写进 share ⇒ 红 / 共享清单写进个人 log ⇒ 红 | 🔴 碰 op-log 语义与"个人 log 不动"这条 ADR-0062 承诺 ⇒ **先立 ADR**；`Project.shareId` 已在册，不必 bump schema | 工程 + 一份新 ADR |
| **M3** | **rekey 落地**：移除/退出/撤销 → `keyEpoch` 推进 → 重封给在册成员；撤销后旧成员解不开新内容 | 三步链有真库证据（`verify-collab-revoke` 已有零件，缺生产路径）；红形：`autoSeal` 换 key 那一步被去掉 ⇒ 必红 | 依赖 M1（下行要先能读，否则证不了"读不到"） | 工程直接做 |
| **M4** | **逐 op 签名**：线协议加 `signature`、写侧签、服务端验、失败按"永久拒绝"处置（对齐 ADR-0019 那条读侧对偶） | 封闭词表 + 一条"改一个字节必被拒"的臂 | 🔴 `shared-schema` 线协议 = 不可逆层，与 M2 同一份 ADR 承接 | 工程 + ADR |
| **M5** | **实时与偏好接线**：客户端接 `new_share_ops`、三条谓词进通知路径 | 有信号 ⇒ 拉取；无订阅偏好 ⇒ 零打扰；红形：谓词恒 true 的那一臂 | M1 之后才有意义（信号语义是"有东西可拉"） | 工程直接做 |
| **M6** | **移动端接入**：入口/路由、`setProjectShareId` 调用点、share 密钥落盘端口、`payloadCipher` 接线、同意态存储、`ShareFeature` 那层的 web-only 假设重写 | 与 web 同一条旅程在 iOS 模拟器 + Android 上走一遍（AGENTS §6.2：真跑 + 真看截图） | 六段缺段的现量清单见 9.4；🔴 Android 构建一律走 windows-pc | 工程直接做（体量大，可拆） |
| **M7** | **把判据变成常驻**：本线 `verify:collab-*` 与 journey 进链或有别的自动载体；`check:share-entry-hidden`（P-1 期间钉"不可达"）；变异臂从散文搬进 `research/tools/mutation-rigs/` | `check:gate-wiring` 那类"链外必须有可验消费方"的尺要能覆盖 `verify:*`（它今天只审 `check:*` ⇒ 本身要扩） | 无 | 工程直接做，**最先做也行** |

**执行序**：M7 → M1 → M3 → M5 → M2（带 ADR）→ M4 → M6。
理由：先把"没人跑的判据"变成有人跑，再补下行（最快让两台设备互相看见），rekey 与实时依赖下行；
M2/M4 碰不可逆层，放同一份 ADR 一起做，避免两次线协议变更。

### 9.4 移动端那六段缺什么（逐条命令，别按本节推断"现在还没有"）

组件本身可移植（`packages/ui/src/sync/` 那四枚只用 RN 原语 + `useHeytaText/useHeytaTokens`，
mobile 已真渲染过同目录的 `ConflictResolutionView`），缺的全在宿主侧：

1. 入口与路由：`apps/mobile/src/nav/feature-entries.ts` 里没有任何共享项。
2. `setProjectShareId` 的调用点：现在只有 `apps/web/src/features/projects/store.ts` 调它。
3. share 密钥落盘：`apps/web/src/features/share/share-key-store.ts` 的签名吃 Web `Storage` 与 `btoa/atob`，移动端只有 device-prefs（sqlite）与原生安全存储两个**不同形状**的端口。
4. vault → `SyncPayloadCipher`：移动端拿得到 session，但 `payloadCipher` 在 `apps/mobile/src` 出现 0 次。
5. 传输与凭据：`ShareApiClient` 是纯 fetch、宿主无关，包依赖已具备；但移动端凭据只在内存、冷启动重填，面板的轮询/复封依赖它。
6. `apps/web/.../ShareFeature.tsx` 这一层不可移植（`window.setInterval` / `document.getElementById` / `navigator.clipboard` / `window.location`）——**它是唯一需要重写的一层**，其余是接线。

### 9.5 文档体检剩余队列（本节由 2026-10-20 那趟审计生成，逐条待做，别重做审计）

已完成的那批改口记在提交里（`bb6804bd`）。还没动的：

- `docs/plans/README.md` 详情面那一行仍钉「🟡 规划中（2026-10-03 立）」，正文已写「W0–W8a 已落地并合进 main，W9–W12 未开工」；
  同族还有 `multi-platform-adaptation` / `desktop-native-migration` 两行 —— 处置同 P：**索引不复述状态**。
- `docs/plans/ai-strategy.md`、`ai-assistant-closure.md`、`ai-event-tool-contract.md` 里的「覆盖面 9/9 / 26 工具 / `MAX_TOOLS_PER_ENTITY = 5`」：
  前两份是当日记录（历史坐标，下沉成叙述即可），契约文档那句是**活规范**（现量 `= 7` 且 `TASK` 单独抬高）。
- `docs/agents/repo-map.md` 漏 `packages/{ui,legal,widget-core,inbound-core}` 四枚真工作区包；根 `README.md` 的"现状"段若还有"web 主入口"残留要一起扫。
- `docs/agents/environment-traps-index.md` 的 80–83 号段描述的是**另一代**（正文在 `legacy-traps-80-83.md`），要显式标注；
  索引里那句「见正文 `#462`」指向的其实是 `#468`。
- `docs/adr/*` 与 `docs/README.md` 的 ADR 状态抄件三处打架：0008（已被 0046 取代但索引仍写"已接受"）、0024（本体已接受、索引写"待确认"）、0062（本节已改口）。
  ⚠️ ADR 冻结：只动索引那一行，本体不动。
- `check:doc-citations` **只扫 1 份文档**就退出（它自打印"文档 1 份"）⇒ 全仓行号锚没人核；这是"为什么这批漂移没被门禁抓到"的根因，值得单开一工单。
- `docs/plans/README.md` §二 那一列"行数"15 格里 10 格已漂 ⇒ 整列删掉或换成 `wc -l` 命令。
- 归档候选（自declared完结 + 低在途引用）：`landing-page-optimization.md`（0 处引用）、`landing-motion-audit/`、
  `countdown-w8-shell-gate.md`、`gate-blindspot-handoff.md`、`notification-and-activity.md`、`goal-landing-and-quality-audit.md`、
  `waytofuture-handoff.md`、`ai-tier-pricing-rollout.md`、`subscription-*-handoff.md`。
  🔴 其中三份被 `docs/adr/` 以链接指着（0043 / 0014 / 0020）——移动必须改 ADR 里的 href；先例是 10-16 那批"只改 href、显示文本留旧名"。
  这一批**待做**，处置规则：`grep -rn -F <文件名> --include=*.md .` 现量引用数 ⇒ 0 处才动，ADR 指向的那几份要么不动要么按先例改 href。

### 9.6 风险与不许做的事

- 🔴 **不许用"测试全绿"宣布这一条线做完**：本线的判据今天**没有一条在链上**（9.1 最后一行）。M7 不落地，后面每一格的"绿"都只说明有人手动跑过。
- 🔴 **不许把 §3 那张 W 表当现状读**（它写的是 10-08 的工单分解）；现状以本节为准。
- 不许 bump `CURRENT_SCHEMA_VERSION`：M2/M4 需要的字段按 AGENTS §3.3 一律写成可选 + 运行时默认。
- 不许改已接受的 ADR 结论；M2/M4 走新 ADR。
- 不可逆层的两处（线协议、op-log reducer）合在**一份** ADR + **一批**提交里，避免两次协议变更让服务端与客户端部署顺序互相踩。
