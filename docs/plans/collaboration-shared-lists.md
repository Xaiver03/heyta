# 共享清单与协作（清单级多人协作）落地计划

> 状态：**进行中**（2026-10-08 立；W0–W3 已落地，逐条见 §3 —— 原写「规划中」，**2026-10-16 更正**）
> 🔴 **现状与下一步以 §9 为准（2026-10-20 复账；2026-10-21 M1；2026-10-22 按界面可达性重锚；2026-10-23 M2 收尾后再改口）**：§3 那张 W 表与 §7 的 DoD 是 10-08 立的工单分解，
> 逐条已落后于代码 —— 尤其 §7 的 DoD 会被"元数据面已通"读成"协作已可用"。
> **内容面已经到得了用户眼前**（§9.1 末那一句是逐条现量，§9.11 是那一步的读数）：任务/便签/评论三族的写意图
> 都先过 `packages/app-host` 那**一处**路由判据，读侧是合并视图，而**两台真浏览器互见**由 `verify:collab-journey` 常驻钉着。
> 上一版那两句"零可达 / 连宿主层都搬不到"是 2026-10-22 的读数，已被 M2 与那条界面腿否证 —— 留在这里只作为
> "为什么会需要一把量得到界面的尺"的记录。
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
| B-10 | 🔴 **转让所有权不校验接收方手里有没有钥**（2026-10-22 01:2x 复核停止点 ② 时发现）：`POST /shares/:id/transfer` 只判"存在 / 不是自己 / 不是 owner"，而 `ShareMember.keyEnvelope` **可为空**（落后世代的成员是常态 —— 面板的 `autoSeal` 就是为它写的）。转给一个信封缺失或世代落后的成员 ⇒ 新 owner 解不开清单钥，**而补发信封是 owner 专属写路径**（`requireShareOwner`）⇒ 刚被降成 editor 的旧 owner 也发不了 ⇒ 客户端没有任何一格能修，服务端还不报错，症状只是"那一台打不开内容"。三处现量：`sed -n '582,620p' server/src/shares/share.routes.ts`（无信封判据）、同文件 `PUT .../envelope` 的 `requireShareOwner`、`grep -n "keyEnvelope" server/prisma/schema.prisma` | **✅ 已修（2026-10-22 04:1x，见本行末尾读数）**，原修法：路由加一道资格门 —— 接收方 `keyEnvelope` 非空**且**其世代 `== Share.keyEpoch`，否则打一枚具名错误（别复用 `ROLE_FORBIDDEN`，那是另一种原因）；面板那颗按钮对不合格成员标灰并给一句理由。🔴 **这两半缺一条就留下正是要堵的那一格**（01:3x 追加的现量）：`memberKeyEpoch` 的默认是 **1 而不是 0**（`grep -n memberKeyEpoch server/prisma/schema.prisma`），所以一个**从没被封过信封**的新成员在没换过钥的清单上（`Share.keyEpoch` 也是 1）算出来的 `keyEpochLag = 0` —— 面板那枚「等待所有者授权」正是只在 `keyEpochLag > 0` 时才画（`packages/ui/src/sync/SharePanel.tsx` 里那一行），于是这一格**界面上连警告都没有**，转让按钮照给，而信封是 `null`。⇒ 只比世代的那把门会直接放过它；验收臂要**两头各造一次**：世代对但信封为 null ⇒ 必须被拒；世代落后 ⇒ 必须被拒；补齐 ⇒ 必须过。🔴 **01:3x 又追到一层机制：「世代对齐但信封为空」是新成员的默认态，不是边角情况** —— 接受邀请那条写路径建成员时带的是 `memberKeyEpoch: share.keyEpoch`、**不带 `keyEnvelope`**（现量：`sed -n '420,432p' server/src/shares/share.routes.ts`；全文件只有 owner 后来那次 PUT 与两处移除会写这枚字段），所以刚接受邀请、还没被补封信封的那个人 `keyEpochLag = 0`，**界面上连「等待所有者授权」都不会画，转让按钮照给** ⇒ 前面那句"默认是 1 而不是 0"只是它的一种写法，真正的默认态是**建成员那一刻就是空信封 + 当前世代**。**为什么不当晚顺手改**：它动的是"谁能被转让"这条对外资格语义，且会牵动 `verify:collab-*` 与四端产物 —— 重装那一趟正排在前面，混进同一晚会让下一位不知道装的是哪一代。**（2026-10-22 04:1x 改口：这条排序撤了，当天做完。）** 撤的理由：四端重装那一格已被停止点 ③ 卡住三天以上，把一条**已经能走到**的生产路径上的正确性洞押在"等一次授权"后面不划算；而重装还没跑过，这一改本来就会进下一批产物 ⇒ 顺序提前没有代价。现量读数（都是本轮在同一棵树上跑的）：服务端 `cd server && npx vitest run tests/share-routes.spec.ts` ⇒ `Tests 35 passed`，转让那一组从 5 条到 7 条（新增两头失法臂，"补齐 ⇒ 必须过"那一条的夹具改成 `keyEnvelope` 非空且 `memberKeyEpoch` 等于 `activeShare.keyEpoch`）。变异台架按两半各拆一次、每次只红对应的那一条：拆掉信封那半（只留世代比较）⇒ 只红「世代对齐但手里没有信封」；拆掉世代那半（只留信封非空）⇒ 只红「有信封但世代落后」—— 两半各自的牙都在，还原后 `shasum -a 256` 与变异前逐字节相同。这四臂已抽成**常驻装置** `research/tools/mutation-rigs/mutate-collab-transfer-gate.mjs`（首跑 `ARMS=pass (4/4)`，基线 35/17/10 passed，RECHECK 三趟全 byte-identical），已登记进 `research/tools/mutation-rigs/README.md`。界面层 `cd apps/web && npx vitest run tests/share-panel-transfer.spec.tsx` ⇒ `Tests 10 passed`（原 7 条 + 新 3 条：无信封 / 世代落后 / owner 行不多话）；把 `canTransfer` 钉成恒真并重打 `pnpm --filter @heyta/ui build` 后 ⇒ 新 3 条一起红、原 7 条照绿，还原后复绿。**🔴 落地前必须先量的一格（决定这道门是修好还是变成永久挡路）**：`apps/web/src/features/share/ShareFeature.tsx` 里那枚 `autoSeal`（现量 `grep -n "autoSeal" apps/web/src/features/share/ShareFeature.tsx`）在 owner 面板挂载期间随 3s 轮询给不合格成员补封信封，它的跳过条件与这道门同形（`m.keyEnvelope !== null && m.memberKeyEpoch >= entry.keyEpoch` 才跳；现量 `grep -n "const autoSeal" apps/web/src/features/share/ShareFeature.tsx`），而 `PUT /shares/:id/members/:memberId/envelope` 把 `memberKeyEpoch` 写成与 `Share.keyEpoch` 同一个号（现量 `grep -n -A12 "members/:memberId/envelope'" server/src/shares/share.routes.ts` 里那两段 update）⇒ **owner 开过面板之后接手人必然合格**，转让不是被钉死的路径。剩下的真窗口照实登记：owner 从没打开过面板 / 不在线 / 保险库锁着 ⇒ 那一格按钮不给、给一句「等待所有者授权」，这是设计而不是缺陷。错误码 `SHARE_TRANSFER_TARGET_UNSEALED` 目前**没有任何宿主文案映射**（全仓 `grep -rn "SHARE_ERROR_CODES" apps packages` ⇒ 只有 `packages/sync-client/src/share-api-client.ts` 那枚镜像表），走 409 时用户看到的是通用失败；因为面板已提前挡掉，只有"面板数据过期"那一瞬会碰到，尾巴挂到 M4。**真浏览器那一档也拍到了**（2026-10-22 10:3x 那张 `07-owner-sees-bob.png`：成员行「成员 619 · 可编辑」下面跟着「等待所有者授权」，那一行没有转让按钮）——⚠️ 它只证"未封档那一档给提示不给按钮"，"封了档就有按钮"仍由 `verify:collab-sync` 的 STEP 4 与单元臂撑，别把这张图读成两半都验过 |

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

## 9. 2026-10-20 复账与下一阶段计划（🔴 "内容面整段断"那句到 2026-10-22 还成立，2026-10-23 起**不再成立**：M2 把任务族接进共享日志，而 `verify:collab-journey` 的界面腿第一次真跑通"两台浏览器互相看得见" —— 现状逐条见 §9.1，那一步的读数见 §9.11）

> 状态：**本节是这一条线当前的权威现状**（§3 那张 W 表与 §7 的 DoD 是 10-08 立的，逐条已落后于代码；
> 读现状从这里读，别按 §3 推断"接完了"）。

### 9.1 现状（每条都带复量命令；本轮全部亲自跑过，不抄任何文档或子代理的数）

| 那一面 | 代码现量 | 怎么复量 |
|---|---|---|
| 元数据面（建共享 / 邀请 / 入群 / 成员 / 角色 / 转让 / 移除 / 退出） | ✅ 服务端与 Web 宿主都在 main 上，role 硬门在上传边界 | `pnpm verify:collab-journey`；`pnpm --filter @heyta/web --silent exec vitest run tests/share-panel-transfer.spec.tsx tests/join-link.spec.ts` |
| **内容下行** | ✅ **到得了用户眼前**（2026-10-23 M2 收尾）：`downloadOps` 的生产调用点在 `share-comments.ts` 的 `pullShareOps`，游标落盘、分页收敛、解密回放都在；而**两台真浏览器互见**那一格由 `verify:collab-journey` 常驻钉着（owner 写的任务出现在 bob 那台、反向同一件事）。🔴 这一格第一次跑就是红的，抓出的是 M5 那道信号闸门只认"这份日志在本机落过盘"——刚入群那台设备一次都没拉过 ⇒ 索引空 ⇒ 第一份内容被判"本机不认得"丢掉，而判据自锁（不拉就不进索引）。修法：闸门补上第二条本地途径（本机清单行绑定 `shareIdsOnDevice`），端口改必填 | `pnpm verify:collab-journey` ⇒ `RESULT=OK steps=3`；`pnpm verify:collab-sync` 第 10/12 步；两臂 `node research/tools/mutation-rigs/mutate-collab-signal-known-share.mjs` 与 `…mutate-collab-journey-visible.mjs` |
| **内容上行** | ✅ **任务 / 便签 / 评论三族都进 share log**（2026-10-23 M2）：`uploadOps` 的生产入口不再只有评论那一族，写意图先过 `createShareRoutingDispatcher` 判"进哪本 log" | `pnpm verify:collab-sync` 第 12 步（任务族走**生产路由**：新建 + 改名跨账号搬运、两台个人 log 零写入）；`grep -rn createShareRoutingDispatcher apps/web/src` ⇒ 装配点在 `lib/oplog.ts` |
| **任务 / 清单的写路径** | ✅ **分流已落地**（ADR-0067 裁决一 + 补一/补二/补三，2026-10-22/23 分批）：判据"所属清单的 `shareId` 是否在册"唯一一份在 `packages/app-host/src/share-routing.ts`，端壳只装配（`apps/web/src/lib/oplog.ts` 把引擎写入口与 share 通道递进去）。清单这条记录本身按 ADR-0068 裁决一**仍走个人 log** | `cd packages/app-host && npx vitest run tests/share-routing.spec.ts` ⇒ 41 passed；`node research/tools/mutation-rigs/mutate-collab-share-routing.mjs` ⇒ `ARMS=pass (6/6)` |
| 服务端可写白名单 vs 客户端实际 | 白名单已经认识 `TASK / PROJECT / TAG / NOTE / COMMENT`，**服务端不拦，是客户端没往那走** | 读 `server/src/shares/share.membership.ts` 的 `SHARE_WRITABLE_ENTITY_TYPES` |
| 并发判定 | ✅ **share 分区有真实因果时钟**（2026-10-22 M2-b，ADR-0067 裁决二）：本设备一维真自增 + 远端回流合并，同设备先后两条不再判成 EQUAL；并发改同一格 ⇒ **恰好一枚具名冲突**且**在界面上看得见**（裁决三，复用既有 `ConflictResolutionView` 与 `keep-local\|keep-remote` 词表，没新建视图也没新建词表） | `node research/tools/mutation-rigs/mutate-collab-causal-clock.mjs` ⇒ `ARMS=pass (5/5)`；`pnpm verify:collab-sync` 第 12 步含"两台各见 1 枚冲突 + 裁一次归零"；`apps/web/tests/share-conflict-wiring.spec.tsx`（6 枚，含反向臂） |
| 逐 op 签名 | ✅ **写侧签、服务端在上传边界验、读侧三态**（2026-10-23 M4 落地，读数见 §9.12，口径在 [ADR-0069](../adr/0069-share-op-per-op-signing-keys-and-disposition.md)）。⚠️ 这一行原先那句「线协议里没有 `signature` 字段」**字面到今天仍然成立** —— 签名走的是声明式 schema 之外的那个字段，服务端从 `raw` 里读（`server/src/shares/share.routes.ts` 里那句「`signature` 必须从 `raw` 读」就是为这件事写的）⇒ **右边那把尺已经判不了这件事**：它量的是「契约文件里有没有声明」，不是「签不签」 | `grep -rn signature packages/shared-schema/src/supersync-http-contract.ts` ⇒ 仍零命中（🔴 别把它读成「没签名」）；判它要换 `grep -rn 'raw as { signature' server/src/shares/share.routes.ts` 与 `pnpm verify:collab-sync` 第 13 步 |
| 移除即 rekey | 🟡 **owner 那一次点击这条链已通**（2026-10-21 M3，读数见 §9.9）：`rotateShareKey` / `adoptRotatedShareKey` / `removeMemberAndRekey` 有生产调用点（`apps/web/src/features/share/share-rotation.ts` 装配，`ShareFeature.tsx` 的移除按钮与 reload 收钥两处调用），`keyEpoch` 真推进、新钥只封给在册成员（自己那枚排第一）、被移除那行的信封在库里置 null；成员端换成了**多世代密钥环**，否则换钥后那一屏会整块解不开。🔴 两件没做：库里**旧密文不重加密**（追加模型；重加密等于改 op-log 回放语义，与 M2/M4 同一份 ADR 一起判）；**owner 不在线时没人能触发换钥**（移除仍然生效，只是那一代钥还留着 —— 边界写在 `share-rekey.ts` 文件头） | `grep -rn removeMemberAndRekey apps/web/src packages/app-host/src` ⇒ 编排件 + 壳调用点各有命中；`pnpm verify:collab-revoke` ⇒ `RESULT=OK steps=8` |
| 实时 | ✅ **三段接线已通并经界面腿验过**（2026-10-21 M5 立，2026-10-23 M2 收尾补上那条自锁的闸门）：客户端认下 `new_share_ops`、只把 `(shareId, latestSeq)` 交给宿主；"这台设备认不认得这份 share、要不要拉、拉到算哪类活动"住 `@heyta/app-host`；"响不响"住 `@heyta/ui` 那条谓词；壳只做装配与投递。评论区那枚 5 秒轮询已撤，改成信号驱动重画。✅ 偏好面今天**只有活动那一族一档**（2026-10-24 M5-3）：另两档（任务提醒范围四档 / 自动接受已知合作者的邀请）连同它们的谓词一起撤下 —— 不是"接了没测"，是**没有输入**（`Task.assigneeUserId` 全仓零写点、"已知合作者名单"那一档产品面还不存在），而摆一枚点得动、行为却恒等于"不响"的开关等于对用户谎称有能力。理由、现量命令与重新开工的条件写在 `packages/ui/src/sync/notification-model.ts` 文件头；钉子是 `packages/ui/tests/notification-model.spec.ts` 那句「默认偏好里只有 activities 一个键」，界面腿的反向断言在 `scripts/verify-mobile-collab-ios.sh` 第 10 步 | `pnpm verify:collab-sync` 第 11 步（真 WS + 真宿主）；两臂见上一行 |
| 端覆盖 | 🟡 Web 接了；**macOS / Windows / Linux 三枚桌面壳间接有**（包里装的就是 `apps/web/dist`）；**移动端已接上**（2026-10-24 M6：源码级在 `7ee207dda`；装置 `pnpm verify:mobile-collab:ios` 在册，界面腿读数落在 §9.13 —— 🔴 **那一节没有绿行之前，这一格只到"源码级"，不许读成"设备上验过"**）；node-host/CLI 无 share 工具 | `grep -rln -E "SharePanel\|shareId\|payloadCipher" --include=*.ts --include=*.tsx apps/mobile/src \| wc -l` ⇒ 10（2026-10-24 现量；这一行写「0 命中」时是 M6 之前）；`grep -n web-dist apps/desktop-macos/Sources/HeytaMac/HeytaMacApp.swift` |
| 常驻判据 | 🔴 **M7 之前**本线没有一扇门在链上（`check` 那串里 `verify:*` 引用数为 0；`collab-journey` 被 `e2e/playwright.config.ts` 的 `testIgnore` 摘出主 e2e 载体；证据目录被 gitignore ⇒ 截图不可复核）。**今天链上有三段**（`check:share-entry-visible` / `verify:collab-keys` / `check:collab-carrier`），形状与读数见 §9.7；P-1 翻案后那枚入口门从钉"默认不可达"翻成钉"默认态可达"（五判 + 阳性对照 + 5 臂自检，2026-10-23）；要真 PostgreSQL / 真浏览器的那四腿仍靠人跑 `pnpm verify:collab-suite` | `node -e "const c=require('./package.json').scripts.check.split('&&');console.log(c.filter(x=>['collab','share-entry'].some(k=>x.includes(k))).join(', '))"`；`grep -n -A5 testIgnore e2e/playwright.config.ts` |

⇒ **一句话的产品现状**（2026-10-23 按**界面可达性**重锚；上一版那句"两侧都到不了用户眼前"是当天上午的读数，
被下午那台真浏览器否证了 —— 它抓到的那一格见 §9.11）：
**能邀请人、能管人、能转让，而且两台真浏览器里互相看得见对方写的任务与评论。**
· 写侧：共享清单里的任务/便签/评论的意图先过 `packages/app-host/src/share-routing.ts` 那**一处**判据，
  进 share log 的不再只有评论那一族；清单这条记录本身按 ADR-0068 裁决一仍走个人 log。
· 读侧：`currentState()` 交的是**合并视图**，共享条目挂到**本机**那条清单行上（不是作者本机那个 id），
  所以对面那台筛得出来、点得进去，评论区也就不再是"没有任务就没有入口"。
· 并发：同设备先后两条不再判成 EQUAL；同字段并发 ⇒ 恰好一枚具名冲突，并进**现有**那枚冲突界面与 rail。
· 实时：`new_share_ops` → 闸门 → 拉一次 → 重画，全程无轮询。

🔴 仍然到不了的，别写成"做完了"：
· **移动端**：share 通道那六段已接上（逐段落点与复量命令在 §9.4 那张表），设备腿那一趟的读数在 §9.13；
· **逐 op 签名**已落地（M4，2026-10-23，读数见 §9.12）：写侧签、服务端验、验不过就不落库也不物化。
  但它今天只覆盖**新写入**的 op（存量不追签，ADR-0069 裁决二/三）。移动端签的是**同一枚** `signShareOpWire`（没有第二份签名件），
  那一跳在真机上的读数在 §9.13；
· **跨清单搬迁**仍按补二具名拒绝 —— 界面上那三处"换清单"目的地现在**灰掉并说一句为什么**
  （2026-10-23 补：以前是把注定失败的动作摆出来，报错文案还是"你的改动还在本地，可以重试"，那句是假的）；
· **库里旧密文不重加密**（追加模型，M3 就登记过）；
· 共享任务被勾完成时**没有通知档位**（偏好表里那两句措辞还没有，`ShareSignalActivity` 因此不含 `completed`）。

### 9.2 三条产品拍板（负责人 2026-10-20 把判定权交下来，按产品视角定，不再回问）

**P-1 先把共享入口从"看起来可用"降级成"明确未开放"。**
现在页头上 `share-open-button` 是亮的、同意弹窗与邀请全链都在，而对面进来的成员看不到内容 —— 这不是"功能还没做完"，
**是让用户替我们发现"这功能是假的"**，而且发生在他把清单交出去**之后**（他已经邀请了同事）。
判定：主界面入口默认隐藏，只留一条带明确措辞的实验开关；配套 M7 的门禁 `check:share-entry-hidden` 钉住"默认态不可达"。
成本：一处条件渲染 + 一枚词条 + 一条会红的尺；收益：不拿真实用户的信任去测进度。
翻案条件：M1+M2 落地且两台设备真浏览器"互相看得到"验过 ⇒ 撤掉隐藏，那一枚门禁同时改成钉"可达"。

✅ **翻案已于 2026-10-23 执行**（条件三格都真验过：M1 §9.8、M2 §9.11、两台真浏览器互见 §9.11 那一格）。
按上面那句写好的动作做，而不是"顺手改亮"：实验开关、那枚设备本地偏好模块、设置里那格措辞与两条词条
一起退场（留着开关而入口不再读它 = 一枚勾了什么都不放的复选框），门禁从 `check:share-entry-hidden`
**翻成** `check:share-entry-visible` —— 五判反向钉（入口在 / 条件里不许再有开关 / 条件里必须仍有
`syncConfigured` / 设置里不许有残留开关 / 词条里不许再出现"看不到彼此改动"），阳性对照 + 5 臂自检。
🔴 那句"成员之间还看不到彼此改动"的披露被门禁明确禁止回来：它当时是**缺陷披露**，今天留着就是
**对外谎报"这功能不能用"**。裁决的**理由**留在上面那几行，不删 —— 那是下一次按住的判据。

**P-2 owner 转让语义保留现形状**（两步确认 → 立即生效 → 原 owner 降 `editor`，服务端单事务原子写三处）。
理由：E2EE 下"对方接受才生效"需要一条待接受的握手状态，而转让最常见恰恰发生在**对方不在线**（离职、换设备、注销前）；
且服务端已把它写成单事务，"立即生效 + 原子"是同一件事的两面。
翻案条件：出现"转让后新 owner 拿不到 key 因而打不开清单"这类实测 —— 那说明转让与密钥轮换没做完（属 M3 的缺陷，不是语义错）。

**P-3 并发写语义定为「按字段胜出，不按整条记录胜出」。**
~~现状是个人清单那套 LWW：整条记录按 timestamp 比，赢者覆盖。~~ 🔴 **这句前提于 2026-10-22 被源码否证**（改口不改结论）：
个人 reducer 早就是**字段级**版本化 —— `packages/op-log/src/state.ts:577-596` 对 payload 的每个键各调一次 `addFieldVersion`，
`:242-253 selectVersion` 先剔掉被因果压着的候选再按 `compareMeta`（`:228-240`：因果 → timestamp → clientId → opId）决胜。
所以缺的不是"把合并改成字段级"，而是 **share 分区拿不到真实的因果时钟**（`share-client.ts` 里 `vectorClock` 恒为 `{clientId:1}`），
字段级前沿今天只能靠 timestamp 平局猜。单人场景它够用（冲突罕见），但共享后它会在用户眼前高频发生
（两个人各自勾完成、改标题），症状是"我改的没了，而且没有任何提示"。
定案（不变）：share 分区的合并按 **字段级** last-writer-wins，其余字段保留对方那次改动；无共同祖先可判时不猜，落一条"待你定"的可见冲突提示。
🔴 这条要碰 `packages/op-log` 的 reducer（`applyOperation` / `compareMeta` 那一层）与 `shared-schema` 的线协议（`vectorClock` 必须真自增、加 `signature` 字段）——
**都在不可逆层**，所以 M2/M4 开工前必须先立一份新 ADR（不改已接受的 0062，新写一份承接它）。
✅ **已立：[ADR-0067](../adr/0067-shared-list-write-routing-and-merge.md)**（路由判据、因果时钟回流、并发可见性、`signature` 的形状与分期、旧密文不重加密）。

### 9.3 里程碑与顺序（按"用户能感知到什么"排，不按代码难度排）

| # | 交付 | 判据（要能红） | 前置 / 不可逆点 | 归属 |
|---|---|---|---|---|
| **M1 🟡**（2026-10-21 宿主层已闭，读数见 §9.8） | **下行链路接通**：`downloadOps` 接进宿主（游标持久化、分页收敛、解密回放、离线补拉） | 🔴 **判据按实测改口**（原句写的是"今天走不通的那一族"）：~~A 改一条任务标题 → B 读到新标题~~ —— `TASK/PROJECT` 的 op 至今仍进**个人** op-log（那是 M2 那一步路由的事），所以下行腿今天能搬运的只有 `COMMENT`。现判据 = **两台独立宿主**：A 发一条评论 → B 拉回并物化、再拉一次零新增、游标落在盘上（`verify:collab-sync` 第 10 步，读数 `RESULT=OK steps=10`）。变异臂三臂见 §9.8，红集精确匹配 | 只需 `packages/app-host` + `apps/web`，不碰线协议 ⇒ **可以先做**；"任务标题那一半"随 M2 一起判 | 工程直接做 |
| **M2 ✅**（2026-10-22 立 ADR-0067，2026-10-23 收尾，读数见 §9.11） | **任务/清单的写路径路由**：共享清单里的 `TASK/TAG/NOTE/COMMENT` op 进 share log（**清单这条记录本身按 ADR-0068 裁决一仍走个人 log** —— 原句把 PROJECT 也列进来了，那一句在实施时被推翻并写进 0068） | 判据按实测**加硬**成三层：① 路由判据唯一一份在 `packages/app-host/src/share-routing.ts`，端壳只装配（`check:layering` 拦壳里的业务判断）② 跨账号搬运 + 并发同字段必须可见由 `verify:collab-sync` 第 12 步在**真服务端 + 生产路由**上证 ③ 用户可见那一格由 `verify:collab-journey` 的「两台真浏览器互见」钉。红形都真红过：未共享写进 share / 共享写进个人 log ⇒ 红；新建那一形不回退问载荷 ⇒ 4 枚红；通道没装上退回个人 log ⇒ 普通与 CAS 两条派发器各红一组 | 前置已满足：[ADR-0067](../adr/0067-shared-list-write-routing-and-merge.md) 已立（含一·补三格），`Project.shareId` 已在册，**零 schema bump** | 工程 + 一份新 ADR ✅ |
| **M3 🟡**（2026-10-21 落地，读数与两件刻意没做的见 §9.9） | **rekey 落地**：移除/退出/撤销 → `keyEpoch` 推进 → 重封给在册成员；撤销后旧成员解不开新内容 | 实测到的判据形状：`verify:collab-revoke` 从"手搓迁移循环"改成**吃生产函数**（`removeMemberAndRekey` + `adoptRotatedShareKey` + 真 `ShareApiClient`），8 步含 psql 现量（`shares.key_epoch = 2`、他那行 `key_envelope IS NULL`）与"第三个人 carol 换钥后仍读得到新旧两代"；变异臂四臂 `ARMS=pass (4/4)` 红集精确匹配（原句那句"摘掉 `autoSeal` 那一步 ⇒ 必红"已由 `verify:collab-journey` 那条臂覆盖，这一批补的是**换钥编排本身**能不能红） | 依赖 M1（下行要先能读，否则证不了"读不到"）—— 已满足 | 工程直接做 |
| **M4 ✅**（2026-10-23 落地，读数见 §9.12） | **逐 op 签名**：线协议加 `signature`、写侧签、服务端验、失败按"永久拒绝"处置（对齐 ADR-0019 那条读侧对偶） | 三层各真红过：① 纯函数层封闭词表 + 逐字节翻转臂（`packages/sync-core/tests/share-keys.spec.ts`）② 服务端层三枚具名码 + 不落库（`verify:collab-sync` 第 13 步的 13.1–13.6）③ 宿主层盘上改一枚签名 ⇒ 另一台读到具名失败且**游标停在那条之前**（同一步，读数"游标停在 7、再拉仍报同一条"）。四臂变异装置 `mutate-collab-upload-gate.mjs` ⇒ `ARMS=pass (4/4)` | 🔴 `shared-schema` 线协议 = 不可逆层：**零 schema bump**（新字段全可选 + 运行时默认），服务端新列走 `migrate-deploy.sh`；口径由 [ADR-0069](../adr/0069-share-op-per-op-signing-keys-and-disposition.md) 承接 0067 裁决四 | 工程 + ADR ✅ |
| **M5 ✅**（2026-10-21 落地，读数见 §9.10） | **实时与偏好接线**：客户端接 `new_share_ops`、活动谓词进通知路径 | 现量（不是"应该行"）：`verify:collab-sync` 第 11 步走真 WS + 真宿主 ⇒ 有信号就有拉取；`无订阅偏好 ⇒ 零打扰`钉在 `apps/web/tests/share-activity-notify.spec.ts`（10 枚）与 `share-activity-signal.spec.tsx`（6 枚，接线臂）。红形都真红过：谓词恒 true ⇒ 3 枚红；壳跳过闸门 ⇒ 2 枚红；拿掉客户端那条分支 ⇒ `RESULT=FAIL step=11` | M1 之后才有意义（信号语义是"有东西可拉"） | 工程直接做 |
| **M6** | **移动端接入**：入口/路由、`setProjectShareId` 调用点、share 密钥落盘端口、`payloadCipher` 接线、同意态存储、`ShareFeature` 那层的 web-only 假设重写 | 与 web 同一条旅程在 iOS 模拟器 + Android 上走一遍（AGENTS §6.2：真跑 + 真看截图） | 六段缺段的现量清单见 9.4；🔴 Android 构建一律走 windows-pc | 工程直接做（体量大，可拆） |
| **M7 ✅**（2026-10-21 落地，形状与读数见 §9.7） | **把判据变成常驻**：本线 `verify:collab-*` 与 journey 进链或有别的自动载体；`check:share-entry-hidden`（P-1 期间钉"不可达"）；变异臂从散文搬进 `research/tools/mutation-rigs/` | `check:gate-wiring` 那类"链外必须有可验消费方"的尺要能覆盖 `verify:*`（它今天只审 `check:*` ⇒ 本身要扩）—— **本线没替公共那把尺翻口径**，改立窄的 `check:collab-carrier`，理由写在 §9.7 末 | 无 | 工程直接做，**最先做也行** |

**执行序**：M7 → M1 → M3 → M5 → M2（带 ADR）→ M4 → M6。
理由：先把"没人跑的判据"变成有人跑，再补下行（最快让两台设备互相看见），rekey 与实时依赖下行；
M2/M4 碰不可逆层，放同一份 ADR 一起做，避免两次线协议变更。

### 9.4 移动端那六段缺什么（逐条命令，别按本节推断"现在还没有"）

> 🔴 **这六段在 2026-10-25 是"源码级接上"** —— 逐格落点与复量命令就在下面那张表里。
> ⚠️ 但**设备腿那一趟当时是红的**：走到 L1（手机自己入群）时报
> 「vault root key 必须是 32 字节 Base64」，成因与修法见[环境陷阱 #559](../reference/environment-traps.md)，
> 修好之后设备腿的逐格读数在 §9.13。本节保留"当时缺什么"那一列，是因为 M6 的顺序就是照它排的。

组件本身可移植（`packages/ui/src/sync/` 那四枚只用 RN 原语 + `useHeytaText/useHeytaTokens`，
mobile 已真渲染过同目录的 `ConflictResolutionView`），缺的全在宿主侧：

| 当时缺的那一格（2026-10-21 的读数） | 现在接在哪 | 现量命令 |
|---|---|---|
| ① 入口与路由：`feature-entries.ts` 里没有任何共享项 | 同文件的 `key: 'share'` 那一项 | `grep -n "key: 'share'" apps/mobile/src/nav/feature-entries.ts` |
| ② `setProjectShareId` 只有 web 那一处在调 | `apps/mobile/src/share/project-share.ts`（文件头写明它是移动端**唯一**调用点，出现第二处即红） | `grep -rn setProjectShareId apps/mobile/src` |
| ③ 密钥落盘端口形状不合（web 那枚吃 `Storage` + `btoa/atob`，移动端只有 device-prefs 与原生安全存储） | 宿主无关的那组 `*Portable` 住在 `packages/app-host/src/share-key-store.ts`；移动端注入的端口是 `apps/mobile/src/lib/share-key-store.ts`，它把 KV 接到原生模块的**变长通道** `getVaultSecureBlobStorage`（`loadBlob`/`saveBlob`，见陷阱 #559）。非秘密那三样（日志/同意/偏好）才住 `lib/share-local-store.ts` | `grep -rln wrapAndStoreShareKeyPortable apps/mobile/src packages/app-host/src`；走的是哪一对接口：`grep -c getVaultSecureBlobStorage apps/mobile/src/lib/share-key-store.ts` |
| ④ `payloadCipher` 在 `apps/mobile/src` 出现 0 次 | 装配点在 `apps/mobile/src/share/share-admin.ts`（条数不写在这里，用右边那条命令现量） | `grep -rn PayloadCipher apps/mobile/src \| wc -l` |
| ⑤ 传输与凭据：`ShareApiClient` 宿主无关，但移动端凭据只在内存、冷启动重填 | 传输件原样复用（`apps/mobile/src/share/{share-admin,comment-actions}.ts`）。凭据那条**没变也不需变**：共享这条腿读的是保险库 session 的 `payloadCipher`（`packages/app-host/src/host.ts` 的 `getPayloadCipher`），不读口令框那个值 | `grep -rln ShareApiClient apps/mobile/src` |
| ⑥ `ShareFeature.tsx` 那一层不可移植，是唯一需要重写的一层 | 重写成两屏：`ShareSpaceScreen.tsx`（面板 / 成员 / 邀请 / 评论 / 偏好）+ `JoinShareScreen.tsx`（入群） | `ls apps/mobile/src/screens/*Share*.tsx` |

### 9.5 文档体检队列 —— 2026-10-21 这一批把七格做完了，剩下两格是**门禁作用域**问题，不是文案问题

已改完的（更早那批记在 `bb6804bd`，本批逐条落在下面，读数都是这一趟现量）：

| 那一格 | 做完的形状 |
|---|---|
| `plans/README` 复述状态 | §一 里 **4 格**改成"状态只在正文"指针（详情面、日历 R13–R16、账号标准套件、本线协作那一格 —— 比我上次估的两格多，因为探针扫了整节）；§二 的「状态」列整列换成**体裁**（计划／交接书／复盘／进度日志／历史），体裁不会漂，状态会 |
| `plans/README` §二 的「行数」列 | 15 格里 **11 格已漂**（逐格读数写在该节表下的注里）⇒ 整列删掉，只把"这一列反复漂，别引用数字、引用命令"那句留成注。⚠️ 顺带查出该表 `calendar-profile-handoff` 那一行**被自己正文里的裸竖线劈成 5 列**（讲的正是"多写一根竖线会劈表"这件事，句子被自己举的例子劈开）；`check:md-tables` **不扫这份文件**，所以坏了没人报 |
| AI 的 9/9 / 26 工具 / `= 5` | 活规范四处改口 + 历史读数按该层自己的惯例**加戳不删旧**：`reference/ai-architecture.md`（追加 10-21 现量行、两处 `= 5` 换成指针）、`plans/ai-event-tool-contract.md`（头部状态行那句「覆盖面已跑满」现量已不成立 ⇒ 写明只到 10-04；§5.2 容量段改指针，行号锚 `spec.ts:91-105` 换成符号），`plans/ai-assistant-closure.md`（W10 行、§6 第 3 条、链段号「48/57」→ 现量 83/116 并写明段号是链长的函数），`plans/ai-strategy.md`（两处）与 `plans/roadmap.md`（AI-6 那行的覆盖面、容量、段号）|
| `repo-map` 漏包 | 补 `ui`／`widget-core`／`legal`／`inbound-core` 四行（描述取自各自 `package.json` 的 description，不自己编）；根 `README.md` 的目录树另补 **5 枚**（那棵树连 `sync-client` 都没有），"现状"段没有"web 主入口"残留（ADR-0036/0037 那两版已改过），但顺手把 `pnpm -r test` 那句「16 个工作区项目 4652 passed」标成当日读数并给现量命令（工作区项目数已 21）|
| traps 索引 80–83 与 `#462` | 80–83 那一格写明**这一代正文在 `legacy-traps-80-83.md`**，且主台账里 80/81/82 是**同号的另一代**、83–85 在主台账根本不存在（它从 82 跳到 86）、legacy 那本内部 `82`/`83` 各出现两次 ⇒ 引用纪律改成"这一代必须写 legacy 或带文件名"。`#462` 那句指错已改成 `#468` 并解释为什么没人抓到（裸号引用既不是链接也不是 `check:doc-citations` 的默认作用域）。⚠️ 同格还查出**该索引自己的 311–460 那一行被一句带竖线的取数命令劈成 4 列**，已转义修复 |
| ADR 状态抄件 | **四格**（不是三格）：0008（本体已被 0046 取代、索引写"已接受"）、0024（本体 09-27 就"已接受"、索引写"待确认"）、0050 与 0051（本体"已接受"、索引写"🔄 实施中"——那是**计划层的词**，读起来像决策没拍）。ADR 本体一个字没动。`docs/README.md` §三 新增一条纪律：**两层状态词表不许混，索引那一格只给指针**，并写明为什么只有索引会漂（本体冻结 ⇒ 它是稳定事实，抄件没人比对） |
| 归档候选那九份 | 上一批（`7dedc97fb`）已归档 8 份；本批复核剩下的 `ai-tier-pricing-rollout` / 两份 `subscription-*-handoff` / `desktop-packaging-handoff` **仍不动** —— 它们各自还有活引用或被 ADR 指着。⚠️ 这批查出归档动作自己的涟漪：**5 份已归档文件的相对链接深度没跟着改**（`archive/` 里 `../` 少一级），它们此刻以修正态在工作树里、由本批一并入库；`docs-link-check` 现量 rc=0 |

🔴 **剩下两格不在文案层，在门禁层，都归 §9.2 的 M7，本线不单方翻口子**：

1. **`check:doc-citations` 的分母是 1 份文档**，而它**在 `pnpm check` 链里** ⇒ 链绿不代表全仓引用被核过。这一趟把作用域放开到全部 `docs/**/*.md` 现量跑了一遍：`文档 266 份 · 反引号 span 163,181 · 「git show HEAD:」行 343 · 锚 104 枚`，报 **878 条**引用问题（其中"路径不存在"846 条）。逐条读后发现**绝大多数不是文档坏了**：远端机器上的路径（`sites-enabled/heyta.finlaw.cloud`、`apps/mobile/node_modules`、`ubuntu-jcli:~/heyta/server/.env`）、示例与占位路径（`docs/plans/a.md`、`mine.md`）、第三方仓的路径（`services/api/src/routes/admin/ai-config.ts`）、URL、以及**历史坐标**（ADR/调研里"当时那个路径"，其中若干已被 10-16 那批"只改 href、显示文本留旧名"的先例正当化）。⇒ 直接把默认作用域改成全仓 = 把链做红 + 逼出一张巨大的豁免表，而豁免表逐条要写理由（那个文件自己就这么要求的）。**要的是作用域规则**（哪一层文档、哪种形状算"当前存在的声称"），这是判据口径，归产品负责人拍。现量复跑：`node scripts/check-doc-citations.mjs $(find docs -name '*.md' -not -path 'docs/plans/archive/landing-motion-audit/*' | sed 's/^/--doc /' | tr '\n' ' ')`。
2. **全仓 markdown 表格形状**：同一把探针（跳代码围栏）分别跑 `git archive HEAD docs` 那棵树与工作树 —— **HEAD 现量 100 行坏、本批改后 80 行**，即修掉 **20** 行：`plans/README` 12 ／ `ai-event-tool-contract` 3 ／ `docs/README` 2 ／ `repo-map` 1 ／ `ai-assistant-closure` 1 ／ traps 索引 1。余下 80 行散在 21 份**别条线**的台账里，大头逐份现量：`product-ux-optimization` 19、`multi-platform-widgets-progress` 8、`self-host-distribution-audit` 6、`legal-dataflow-ai-rights` 5、`goal-multi-end-coverage` 5、`legal-pipl-baseline` 4、`linux-adaptation` 4、`inbound-automation-handoff` 3（其余各 1–2）。成因两类，都写过在 §7：单元格里放了带竖线的命令，或行尾少一根 `|`。`check:md-tables` 的 `FILES` 只有 **12 份**、`docs/agents/` 下一份都不扫（现量：解析 `scripts/check-md-table-rows.mjs` 里那个数组），所以这些坏行**没有任何常驻判据会报**。✅ **这一格 2026-10-21 已收**（形状就是上面那句：12 → 29 份，只加自己那片，别线那枚登记在门禁注释里）。读数与当场照出的 3 枚坏行见 §9.8。

3. 🔴 **「文档里那条命令跑不跑得通」这一维本批逐条查完，结论是干净的**（写下来是防止下一位把这当"还没查"再查一遍）。探针：取全部 md 里 `pnpm <带冒号的脚本名>` 逐枚与**所有工作区**（root + `packages/*` + `apps/*` + `server`，共 278 个脚本名）比对，报 9 种"哪一档都没有"的名字；**逐条读原文后 9 条全是假阳性**，三种形状各占其数：
   · **写着"新增／提案"** —— `check:windows-dotnet`（`desktop-native-migration.md:161` 那格标着「（新增）」）、`verify:mobile-widget`（`research/native-widgets.md:244` 是方案句）。
   · **它自己就在讲"这条命令不存在"** —— `check:l4-no-style`（`multi-end-coverage-handoff.md:681` 明说真键是 `check:l4`，并给了"跑任何门禁前先列一遍键"的判据）、`check:evidence-md5`（`calendar-profile-handoff.md:1668` 讲的是**按唯一针脚把它从链里删掉**那段改写，同句现量 `grep -c evidence package.json` = 0）。
   · **划掉的历史坐标／禁碰件** —— `check:macos-removal`（`trash-and-archive.md:1652` 那格的证据文件名已被删除线否掉，原句留着）、`check:pricing-consistency` 与 `check:inbound-lane`（都在 `BLOCKED.md`，本线禁碰，上下文是提案与追记，不是"跑过"）。
   ⇒ 别为这一维去"修"那 9 条，它们不需要修。值得建的是**把这条探针常驻**：形状 = 解析工作区脚本名 → 扫 md → 只把"陈述为已执行"的判红，提案／删除线／自曝不存在的句子逐条进豁免表并写理由（这跟 `check:doc-citations` 那张豁免表是同一个纪律）。✅ **已建**：2026-10-21 的 `check:doc-command-claims` 进链，形状与读数见 §9.8。
4. ⚠️ 一条**结构层**的、本线不代改的不一致：仓库根 `PROGRESS.md` 的标题还是那一轮的（「AI 审计 + 域名迁移到 waytofuture.cn + 管理后台」），而这枚文件**2026-10-20 还在被追加**（现量 `git log -1 --format='%ad %h' -- PROGRESS.md`）⇒ 标题与用途已不符。它是并行会话共用的台账，**改标题会让按名字引用它的文档读到第二份"当前进度"**（现量 `grep -rl --include='*.md' -F 'PROGRESS.md' docs README.md AGENTS.md CONTRIBUTING.md \| wc -l` = 26 份），所以归属是"谁持有那本台账谁决定"。当前进度入口照旧只有 [`docs/agents/progress-log.md`](../agents/progress-log.md)（AGENTS §4 规则地图里登记着它）；根 `PROGRESS.md` **不在 `docs/README.md` §一 那张分层表里，也不该加进去** —— 它是会话台账，不是产品文档。

### 9.6 风险与不许做的事

- 🔴 **不许用"测试全绿"宣布这一条线做完**。M7 之后这句话仍然成立，只是**空格换了地方**：
  链上那三段（§9.7）钉的是"入口默认不可达"和"验收有载具"，而**内容面通不通**仍然只有
  人跑 `pnpm verify:collab-suite` 那一趟才算数 —— M1–M6 每一格的"绿"都按这个口径读。
- 🔴 **不许把 §3 那张 W 表当现状读**（它写的是 10-08 的工单分解）；现状以本节为准。
- 不许 bump `CURRENT_SCHEMA_VERSION`：M2/M4 需要的字段按 AGENTS §3.3 一律写成可选 + 运行时默认。
- 不许改已接受的 ADR 结论；M2/M4 走新 ADR。
- 不可逆层的两处（线协议、op-log reducer）合在**一份** ADR + **一批**提交里，避免两次协议变更让服务端与客户端部署顺序互相踩。

### 9.7 M7 落地（2026-10-21）—— 判据从"有人手动跑过"变成常驻

| 件 | 形状 | 这一趟的读数 |
|---|---|---|
| **P-1 入口降级** | 新增 `apps/web/src/lib/share-experimental.ts`（设备本地偏好；`const DEFAULT_ENABLED = false;` 那一行**就是**裁决在代码里的形状，翻案条件写在同一枚文件头）；设置 → 同步 里一枚措辞明确的开关 `share-experimental-toggle`；页头入口的渲染条件加第三道 `&& shareExperimental` | 真浏览器两张对照图：`01-owner-list-ready.png`（停在清单上、同步已配好，头部**没有**「共享」）与 `03-owner-panel-created.png`（打开开关之后**有**）；`e2e/tests/collab-journey.spec.ts` 在建好清单之后先断 `toHaveCount(0)` 再往下走 |
| 行为层 | `apps/web/tests/share-entry-experimental.spec.tsx` 10 条，含**阳性对照**（开关打开 ⇒ 入口在）—— 少了那条对照，"入口不在"会因为 jsdom 里根本没停在清单上而**永远通过** | 10/10 绿。变异读数：摘掉第三道条件 ⇒ 恰好红在 P-1 那一格；把默认值翻成 `true` ⇒ 红 5 条 |
| 源码层常驻 | `check:share-entry-hidden`（四格判据 + 自带 5 臂 + 阳性对照；臂改的是临时副本，工作树零改动） | `臂数 5，失败 0`。两道坑记在文件头：注释里也写着开关名 ⇒ **必须先剥注释**；词条文案里的 `https://*` 会被当成"开了个块注释"⇒ 整段文件被吞、判据假红 |
| 载具 | `verify:collab-keys` 进链（零服务端，实测 0.3s）；其余四腿进 `verify-collab-suite.mjs` 的名册、串行跑；`check:collab-carrier` 钉"每套验收必须有载具（进链 或 进名册）"，且套件本身必须在 `docs/agents/commands.md` 有一行 | `SUITE=OK legs=4 failed=0`。⚠️ 每腿步数**不在这里抄**（那是会漂的值：这一趟读到 sync 9 / revoke 7 / conflict 6 / journey 3，而 revoke 在 M3 之后已经是 8 —— 现量看各腿自己那行 `RESULT=OK steps=N`）；carrier `臂数 5，失败 0` |
| 散文臂 → 装置 | `research/tools/mutation-rigs/mutate-collab-journey-autoseal.mjs`：① 原样对照 ② 摘掉 owner 的 `autoSeal` ⇒ 必须**同时**出现 `RESULT=FAIL` 与 `share-join-done`（只"红了"不算，编译错也会红）③ 还原 + md5 逐字节比对 | `ARMS=pass (2/2)`、`byte-identical`。它原地改工作树（目标文件归本线），所以先验该文件相对 HEAD 干净，脏就 `ARMS=ENV dirty-worktree` 退 3 |
| 链长 | 现量 `node -e "console.log(require('./package.json').scripts.check.split('&&').length)"` | 本批 +3 段 ⇒ 121 |

**顺手修掉的一个真缺陷**（在同一张截图里量到的）：设置里「共享通知」那一节外层套的 `ht-settings__subsection`
**全仓 CSS 没有定义**，而它自己那枚 `<h3>` 与共享面板自带的 `section-title` 是同一句文案的两份显示
⇒ 换成同浮层兄弟节用的 `.ht-settings`、删掉多余 h3。证据：`01b-owner-experimental-switch.png`（修复后那一节进了卡片）。

🔴 **本批刻意没做的几件**（都在"别的口径"那一侧，不是忘了）：

1. `NotificationPrefsPanel`（`packages/ui`，W5 那节的内容体）**三行活动开关没有任何可见状态** ——
   只有 `aria-checked`，读屏拿得到、眼睛拿不到；同文件里的四档范围却用 `'◉ '/'○ '` 文本假装有控件。
   修法要动共享组件的文字层级与 `check:design` / `check:text-color` 两道口径，不在 M7 里顺手做。
2. `check:doc-citations` 的**作用域**（§9.5 第 1 条）—— 放开会把别线的台账一次做红。
   ⚠️ 原句里 `check:md-tables` 那一半**已经在 §9.8 做完了**（12 份 → 29 份），别再按原句读。
3. `check:gate-wiring` 仍只审 `check:*`（现量 `grep -c verify scripts/check-gate-wiring.mjs` = 0）。
   本线用窄的 `check:collab-carrier` 先把"verify 必须有可验消费方"落地；把公共那把尺扩到全部 `verify:*`
   要给别的线那几十套验收逐条定载具 —— 那是别的线的判据口径，不替他们拍。
4. 新查出的一类形状缺陷登记不代改：**22 枚 `ht-settings__*` 类名在 CSS 里没有定义**
   （现量：把 `apps/web/src/**/*.tsx` 用到的 `ht-settings__*` 与 `apps/web/src/styles/**/*.css` 定义的比对）。
   它们分属数据管理 / 帮助等**别的面**，本批只修了本线那一枚。

### 9.8 M1 落地 + M7 那两格遗留（2026-10-21 第二批）—— 读数

**M1「下行链路接通」**（三笔：宿主层 / web 接线 / 验收与装置）

| 件 | 形状 | 这一趟的读数 |
|---|---|---|
| 宿主层 | `ShareOpDownloadPort` + `SharePayloadCodecPort` 两枚可注入端口；游标进 `ShareLogStorage`（`cursor/setCursor`）；分页撞上界**抛错**不返回半截；解不开 / 载荷不是字符串密文 / 线上没有作者时刻 ⇒ **抛错且不推进游标**（跳过 = 那条评论永远不出现，而界面会说"已同步"）；下行解密的 AAD 身份**整份复用线上那份** | `pnpm -r typecheck` rc=0；app-host `1871 passed`，其中新增 `tests/share-comments-pull.spec.ts` 9 条（含阳性对照"服务端头超前 ⇒ 游标只推到已消费那条"与"先落日志再推游标"） |
| 🔴 真缺陷一枚（被自己的测试照出来） | 第一版把**已消费位置**和**服务端报的头**写成同一个变量 ⇒ "页里给 1、2 而头在 3"时游标被推到 3，第 3 条**永远不会再被拉**（静默丢 op）。拆成 `consumed` / `after` / `head` 三个量，判据与装置都留下来了 | 变异臂 B 红在那一条判据上（`红 2/2 红集精确匹配`） |
| web 接线 | 游标存 `localStorage`（坏值当 0）；进评论区拉一次、之后每 5s 一轮；只有 `added > 0` 才重渲染；拉失败**不响**（文件头写明代价） | web `2344 passed`；外壳里零业务判断（路由/发不发/落盘都在 `@heyta/app-host`，AGENTS §3.5） |
| 经真宿主 | `verify-collab-sync.mjs` 加**第 10 步**：真 `ShareApiClient` + 真密码学 + `createShareCommentsHost`，owner 发一条评论 ⇒ 另一台设备的新宿主拉回并物化，再拉一次零新增、游标落在盘上 | `RESULT=OK steps=10`（拉到 4 条是**对的**：那台新设备从游标 0 起，前面 3 条是第 5 步留下的信封与 op） |
| 装置 | `research/tools/mutation-rigs/mutate-collab-pull-cursor.mjs` 三臂（游标不落盘 / 头当已消费 / 游标先于折叠） | `ARMS=pass (3/3)`、`byte-identical`；红集 4/2/1 条**精确匹配**，多红一条也算漂移 |

🔴 **M1 没做到的那一半，写清楚是谁的**：两台真浏览器"互相看得到任务标题改动"仍然**走不通** ——
不是下行腿坏了，是 `TASK/PROJECT` 的 op 至今进**个人** op-log，压根没进 share 日志。那是 M2
（要新立一份 ADR）的路由那一步。所以下一行已按实测改口（§9.3），M1 的"界面那一半"随 M2 一起判。
本片也没有实时订阅（`new_share_ops` 的接线是 M5），文件头边界里写着。

**M7 那两格遗留**（§9.5 第 2、3 条明写"归 M7"、M7 主体那批漏下的）

| 件 | 形状 | 读数 |
|---|---|---|
| `check:md-tables` 扩面 | 作用域 **12 → 29 份**（`docs/agents/` 13 份 + 本线 4 份）。加进来的前提还是"现量干净"，唯一没加的是 `docs/agents/environment-traps-index.md`（今天被并行线追加的那一行有 1 处坏，按"谁写谁收"登记在门禁注释里） | 扩面**当场照出 3 枚真坏行**：本线计划 §9.2 那一格把带竖线的正则写进了表格（列数 4 vs 3）、变异台架 README 里协作线那两枚行前面有一枚空行（在 GFM 里根本不是表格 —— M7-d 自己留下的）、别线那一枚。修完后门禁绿 |
| `check:doc-command-claims`（新增，进链） | 只判"被陈述为现行可跑"的声称；提案 / 自曝不存在 / 删除线 / 历史戳 / **例子句**五种形状不算。豁免表 7 条逐条带理由 | `扫 250 份 md · 抓到脚本名 1036 处 · 现行声称 773 处 · 越界 0 处`；`SELF=OK arms=11 failed=0`；链 **121 → 122 段** |

⚠️ 这一批两台台架各自的第一版都是坏的，都留成了臂：竖线转义成 `\|` 之后**在 JS 正则里是字面竖线**，
那条取数命令静默打印空行；`check:doc-command-claims` 第一版的字符类漏了连字符 ⇒ 名字从第一个 `-`
被截断、全仓假红 **486 处**。**假红比漏红好**：它响得让人去读原文，而"绿得没声音"没人会查。

### 9.9 M3 落地（2026-10-21 第三批）—— 换钥的读数

| 件 | 形状 | 这一趟的读数 |
|---|---|---|
| 宿主层 | 新文件 `packages/app-host/src/share-rekey.ts`（305 行）：`rotateShareKey` / `adoptRotatedShareKey` / `removeMemberAndRekey` / `forgetShareLocally`，四枚可注入端口（api、keys、`decodeMemberPublicKey`、`isSignedIn`）。五条纪律各钉一条：信封上的世代=实际封的那把、非 owner 不能轮、顺序=移除→本地落环→给自己封→给别人封、旧世代留在环里、没登录或没解锁 ⇒ 零请求 | `pnpm -r typecheck` rc=0；`cd packages/app-host && npx vitest run tests/share-rekey.spec.ts` ⇒ 19 passed（真 `sync-core` 密码学，没有 mock 加解密对） |
| web 密钥环 | `share-key-store.ts` 加 `priorKeys` 与 `unwrapShareKeyRing`；`wrapAndStoreShareKey` 换钥时**带回**身份种子与 `ownMemberId`（旧写法不回传 ⇒ 换一次钥就把身份丢了） | `cd apps/web && npx vitest run tests/share-key-store.spec.ts` ⇒ 15 passed。判据里留了一枚**对照臂**：只喂 `current` 那一把必须红 `/epoch/i` —— 少了它，"混合世代"这件事只是注释 |
| 服务端 | DELETE member 与 POST leave 两处 `data: { removedAt, keyEnvelope: Prisma.DbNull }`；`memberKeyEpoch` **不动**（库上有 CHECK `share_members_key_epoch_positive >= 1`，写 0 是 500 而不是"没钥"） | `pnpm --filter @heyta/sync-server typecheck` rc=0；psql 现量 `key_envelope IS NULL` 为 `t` 在 `verify:collab-revoke` 第 5 步里 |
| 验收改吃生产路径 | revoke 那套的第 4/5/6 步不再手搓迁移循环，直接调 `removeMemberAndRekey` + `adoptRotatedShareKey`（读 `packages/app-host/dist`）+ 真 `ShareApiClient`；加第三个账号 carol，证"移除不是把所有人锁在门外" | `RESULT=OK steps=8`（这批跑过两趟，读数同） |
| 装置 | `research/tools/mutation-rigs/mutate-collab-rekey.mjs` 四臂（复封同一把 / 收件人漏自己 / 收钥不验世代 / 新钥只发不落环） | `ARMS=pass (4/4)`、`RECHECK RC=0 Tests=19 passed`、`md5=byte-identical`；红集 3/5/1/5 条**精确匹配** |

🔴 **这一趟顺手照出的三枚潜在缺陷**（不修就会随 M3 变成用户可见的坏，都已修）：

1. 重新邀请复用同一行 ⇒ 上一代的旧信封留着、`memberKeyEpoch` 却写成当前代 ⇒ `autoSeal` 看到"已有信封"就跳过他，**他永远拿不到新钥**（界面表现为"进来了但评论区解不开"，且没有一条日志说得清）。M3-a 那笔治的就是它。
2. `autoSeal` 原来拿**服务端报的号**当自己那把钥的世代 ⇒ 换钥后会把新钥标成旧世代，对方按信封号取钥就解不开。改成先收钥、再按本地条目的 `keyEpoch` 封。
3. 成员端只存一把钥 ⇒ 换钥后那个 share 的**整个评论区**卡死：下行解不开就抛、游标不前进（M1 那条"不推进"的纪律在这里第一次咬到自己）。所以密钥环必须是多世代。

**M3 没做到的，写清楚是谁的**：

- **owner 不在线（或 vault 未解锁）时没人能触发换钥**。移除仍然生效（传输面已经关：他的上传/下载一律 404，库里他那行信封已作废），但那一名成员手里的旧 listKey 对他自己那台设备继续有效，要等下一次 owner 在场点移除。边界写在 `share-rekey.ts` 文件头；要做"无 owner 也能轮换"得先立一套成员侧协议 —— 不在 M3 的口径里，也不该顺手做。
- **库里旧密文不重加密**（`reencryptShareRecord` 仍只有单测与验收脚本调用）。追加模型 + AAD 绑 `shareId`/世代 ⇒ 重写历史等于改 op-log 回放语义，与 M2/M4 同一份 ADR 一起判（§9.6 那条"不许悄悄改历史"仍在）。
- **吊销未接受的邀请不触发换钥** —— 这条不是漏：`shareInvitations` 与成员行是两张表，接受（`/shares/invitations/accept`）之前没有任何一把 listKey 离开过 owner 的设备，没有要收回的东西。现量：`grep -n keyEnvelope server/src/shares/share.routes.ts` 里**装**信封的只有一处（PUT 那一处），另两处是本批加的**置 null**；吊销邀请那处只动 `shareInvitation`。

**下一步**：M2（`TASK/PROJECT/TAG/NOTE` 的写路径路由）—— 它排在一份新 ADR 之后（§9.2 P-3、§9.6）。

### 9.10 M5 落地（2026-10-21 第四批）—— 实时的读数

| 件 | 形状 | 这一趟的读数 |
|---|---|---|
| 客户端 | `realtime.ts` 认下 `new_share_ops`，只把 `(shareId, latestSeq)` 交给宿主；回调抛错不许掀连接；老宿主不传回调就等于没接，`new_ops` 不受影响 | `pnpm --filter @heyta/sync-client build` rc=0；`cd packages/sync-client && npx vitest run tests/realtime.spec.ts` ⇒ 20 passed（四臂：参数送达且不泄漏进 `onNewOps` / 坏消息零调用 / 老宿主静默 / 回调抛错不断线） |
| 宿主判断 | 新文件 `packages/app-host/src/share-signals.ts`：三条纪律 —— 本机不认得这份 share ⇒ 零请求；一次信号只吵一次（按**日志差集**而非 `added` 数猜）；自己不吵自己。拉取失败不抛穿，只留在读数里 | `pnpm --filter @heyta/app-host build` rc=0；`cd packages/app-host && npx vitest run tests/share-signals.spec.ts` ⇒ 9 passed |
| 偏好谓词 | `@heyta/ui` 新增 `selectNotifiedActivities(prefs, kinds)`（去重 + 逐类过闸门 + 按来序）—— ADR-0062 决策 7 那句"响不响由本机偏好决定"的判断本体 | `cd packages/ui && npx vitest run tests/notification-prefs-gate.spec.ts` ⇒ 5 passed |
| 壳 | `use-share-activity-signal.ts` 挂在 `App.tsx`（信号是账号级的，用户可能停在任何一屏）；垫片 `lib/share-signal-sink.ts` 避开 store↔share 的循环；投递件 `share-activity-notify.ts` 的 ctor 可注入 | `pnpm --filter @heyta/web typecheck` rc=0；`share-activity-notify.spec.ts` ⇒ 10 passed、`share-activity-signal.spec.tsx` ⇒ 6 passed、`app-mount.spec.tsx` ⇒ 26 passed（含新加的"根组件必须是消费者"那一臂） |
| 常驻载体 | `verify-collab-sync.mjs` 加**第 11 步**：真 `createRealtimeClient` 挂在 WS 上 ⇒ 有人写评论 ⇒ 服务端扇出 ⇒ 宿主拉一次 ⇒ 旁观设备报 `["added"]`、而写它的那一台同样拉到内容却**零活动** | `RESULT=OK steps=11`，那一格打的是「1 条评论换来 1 个信号（latestSeq=5）；旁观设备拉到 1 条并报 `["added"]`，作者设备同样拉到 1 条却零活动」 |
| 能红的证据 | ① 拿掉客户端那条分支 ⇒ `RESULT=FAIL step=11`，理由可读（"写了 6 条评论…0 个 new_share_ops 都没收到"）② `readFreshOps` 退化成只留基类字段 ⇒ 宿主 9 枚里 3 枚红 ③ `selectNotifiedActivities` 的谓词恒 true ⇒ ui 5 枚里 3 枚红 ④ 壳里跳过闸门直接投 ⇒ 接线 6 枚里 2 枚红。四处都从 `.mut-bak` 还原并核过 md5 | 变异只碰自己线的文件；每一步还原后复跑绿 |

🔴 **撤掉那枚 5 秒轮询之前先量到的一个真事实**：下行游标是**这份 share 全局一份**（`localStorage` 的 `heyta.share-log.cursor.<shareId>`），而宿主的重放结果按**实例**缓存（`share-comments.ts` 的 `entryFor` 命中就不再看盘）。所以正在显示评论区的那一侧**再拉一次只会拿到 `fetched = 0`** —— 症状会是"信号收了、日志落盘了、界面却不动"。因此这一片加了一条内部通道 `subscribeShareRepaint`：根上那个唯一的信号消费者拉到新内容后发一次"重画"，那一节**换代并从盘上重放**，而不是第二次下载。

**M5 没做到的，写清楚是谁的**：

- ✅ **这一格 2026-10-25 结案：那枚 3s 轮询已撤，改由名册信号驱动**（M5-1，[ADR-0070](../adr/0070-share-roster-changed-signal-replaces-polling.md)）。
  现量：`grep -n "setInterval" apps/web/src/features/share/ShareFeature.tsx` ⇒ **零命中**；
  替代它的是服务端 `notifyShareRosterChanged`（`server/src/sync/services/websocket-connection.service.ts`，
  与 `notifyShareOps` 同一条安全契约：只说"成员面动过"，不带名单/内容/序号），
  写路径上的覆盖面现量：`grep -c "await notifyShareRoster(" server/src/shares/share.routes.ts`。
  ⚠️ **下面这段是当时为什么"不许撤"的理由，留着才有判断依据**（2026-10-21 写的）：那会儿
  `grep -rn "notifyShareOps" server/src` 只回两行 —— 定义 + share log 追加路径上唯一一发调用 ⇒
  成员/信封那一份状态**确实不在信号覆盖面上**，撤掉轮询会把"邀请被对面接受后面板自己更新"退化成"刷新才更新"。
  所以当时的结论是"这不是漏撤，是要另立一条" —— 那条另立的信号就是 ADR-0070，它现在在册。
  🔴 它同时解释了为什么名册信号**故意不排除发起方**（`notifyShareOps` 那条 `excludeClientId` 在这里没有对应物）：
  服务端只有 userId 维度的连接表，按 clientId 排除会把同账号的另一台一起排掉。

- ✅ **通知正文的口径已经拍了并落进 web（2026-10-24，`docs/adr/0071-share-notification-content-boundary.md`）**：
  正文允许「这份共享清单的名字 + 活动种类」，条目内容（任务标题、评论正文、便签内容）一律不进 ——
  理由是"把明文写进系统通知中心等于交给操作系统及其同步链路去保管，而那些保管者不是本产品的信任边界"。
  两个条件：这台设备**同意过**（裁决三，闸门仍是 `selectNotifiedActivities` 那一枚，外面多包一道同意）
  **且**该类活动在偏好里开着。名字只从现成本地状态那条清单行取，取不到就回落到不带名字的现有措辞，
  🔴 不为此发一次请求。判据：`cd packages/ui && npx vitest run tests/notification-content-boundary.spec.ts`、
  `cd apps/web && npx vitest run tests/share-notification-content.spec.tsx`（条数由脚本自己打印），
  能红的证据 `node research/tools/mutation-rigs/mutate-collab-notif-content.mjs` ⇒ `ARMS=pass (4/4)`。
  ⚠️ **这一格还留着一个要拍的口子**：同意态今天只有设备级一条记录，写点在 owner 的「共享此清单」确认，
  **通过链接加入的那台设备没有同意记录** ⇒ 按裁决三它拿到的是零打扰。补法（加入流程也走一次确认 /
  同意改成每份清单一行）归产品负责人，见 ADR-0071 §四与文末；本批**没有**顺手放宽成"加入即视为同意"。
- ✅ **这一格 2026-10-24 已按「撤下」结案，不是按"接上数据面"结案**：`shouldNotifyTaskReminder` 与 `shouldAutoAcceptInvitation`
  连同它们那两档偏好（任务提醒范围四档 / 自动接受已知合作者的邀请）**整条删掉**（`bc20e679a`）。判它的理由当时就写在下面那句里 ——
  **没有输入**；后来 M2 把 `TASK` 的 op 送进了 share log、M6 有了移动端邀请面，两档**仍然**没有输入：
  前者判的是 `Task.assigneeUserId`，那个字段全仓零写点（现量 `grep -rn "assigneeUserId" packages apps server --include='*.ts*' | grep -v tests`），
  后者要一份"谁算已知合作者"的名单，那一档产品面还不存在。⇒ 摆着开关而行为恒等于"不响"，是界面在谎称有能力。
  钉子与重新开工的条件在 `packages/ui/src/sync/notification-model.ts` 文件头与 `packages/ui/tests/notification-model.spec.ts`；
  🔴 别给它们造假输入点亮判据（那是量夹具不是量产品）。
- **`app-mount.spec.tsx` 里的 `act(...)` 警告是预存的**：同一枚文件在 HEAD 上跑就有 28 条（`An update to SubscriptionNotice inside a test was not wrapped in act`），本批那一臂挂上完整 `<App />` 后整文件涨到 45 条。现量：`cd apps/web && npx vitest run tests/app-mount.spec.tsx 2>&1 | grep -c "not wrapped in act"`。这条不是本批的缺陷，也没有被当成判据。
- **这条信号的读者今天有两枚壳**（2026-10-25 改口；原句"移动端要等它自己的通知面"已不成立）：
  web 那侧是 `apps/web/src/features/share/use-share-activity-signal.ts`，移动端那侧是
  `apps/mobile/src/share/share-signals.ts`（信号→拉取）+ `share-activity-notify.ts`（系统投递），
  M6-3 接上，设备腿读数在 §9.13。**桌面那几枚壳仍没接** —— 解析在 `@heyta/sync-client`、判断在
  `@heyta/app-host`（都是共享包，壳只差投递面与注册那一行），但这一格不在 M6 的授权范围内。
  现量：`grep -rln new_share_ops apps/*/src`（列出来的壳才是接到过的）。
- **上面那四处变异当时是一次性手工跑的**（M3 那批有 `mutate-collab-rekey.mjs`，M5 这批没有）。✅ **2026-10-23 那笔欠项已按它自己写的分法还掉**：秒级那两枚进了常驻装置 —— 宿主侧闸门两臂 `research/tools/mutation-rigs/mutate-collab-signal-known-share.mjs`（`ARMS=pass (2/2)`）、接线/界面侧两臂 `mutate-collab-journey-visible.mjs`（`ARMS=pass (2/2)`，它每跑一臂要重打一次 `@heyta/app-host`）；而**真 WS 那一枚（第 11 步）仍按当时的判断不做成秒级装置** —— 它由 `verify:collab-suite` 的周期跑承担。登记在册，不留"下次再说"。

### 9.11 M2 收尾（2026-10-23 第五批）—— 任务族进共享日志、两台真浏览器互见、P-1 翻案的读数

> 本节是 §9.3 那行 M2 从 🟡 变 ✅ 的凭据，也是 §9.2 P-1 那次翻案的凭据。
> 🔴 每一格右边都是**这一趟亲自跑出来的读数**，不是"应该能跑"。

| 那一格 | 落到哪儿 | 现量读数 |
|---|---|---|
| 任务族走**生产路由** | `scripts/verify-collab-sync.mjs` 新增第 12 步：另起一份共享（第 8/9 步已把 bob 移出并换过钥），两台设备各装一份 `createShareCommentDispatch` + `createShareRoutingDispatcher` + `createShareViewMerger`（三件都是生产件，个人那本 log 用计数替身专证"一条都不许多"） | `pnpm verify:collab-sync` ⇒ `RESULT=OK steps=12`；读数含"bob 两次各拉到 1/1 条、两台个人 log 零写入；并发改同一格 ⇒ 两台各见 1 枚具名冲突、两侧内容都在；裁一次 ⇒ 冲突归零且对面读到那一句；第二份 share 全表仍是信封" |
| 新建那一形的归属解析（ADR-0067 一·补三） | `packages/app-host/src/share-routing.ts` 的 `declaredProjectId` + `routeShareIdForIntent`（回退**只**发生在 `entity-not-found` 那一形） | 修前先写失败用例：`4 failed \| 29 passed` → 修后 `33 passed`（现量 `41 passed` 含后续两批新增）；六臂 `node research/tools/mutation-rigs/mutate-collab-share-routing.mjs` ⇒ `ARMS=pass (6/6)` |
| 🔴 两台真浏览器互见（这一批真正的新尺子） | `e2e/tests/collab-journey.spec.ts` 第 9 段：owner 在共享清单里写一条 → **bob 那台不刷新**看得见；反向同一件事。判据取的是**界面上真落成的那一行文字**（快速添加会解析日期/标签，拿敲进去的串当期望值会误判） | `pnpm verify:collab-journey` ⇒ `RESULT=OK steps=3`、证据 11 张逐张肉眼看过（`10-bob-sees-owner-task.png` 里 bob 那台确实画出 owner 写的那一行、且只有一行）；一臂 `…mutate-collab-journey-visible.mjs` ⇒ `ARMS=pass (2/2)` |
| 那一格抓到的真缺陷 | M5 信号闸门只认"这份日志在本机落过盘"，而刚入群那台设备一次都没拉过 ⇒ 索引空 ⇒ 第一份内容被判"本机不认得"丢掉，且判据**自锁**（不拉就不进索引）。修法：闸门补第二条本地途径（本机清单行绑定），端口改**必填** | 界面腿第一趟就是红的（`B 那台看不见 A 写的「…」`）；修后绿；两臂 `…mutate-collab-signal-known-share.mjs` ⇒ `ARMS=pass (2/2)` |
| 补二的界面那一半 | 三处"换清单"目的地（行尾整理 / 详情栏整理 / 批量工具栏）现在把跨共享边界的目的地**灰掉并说一句为什么**；判据仍只有一处（`isCrossListMoveBlocked` 内部就是派发器那句 `crossesShareBoundary`） | `cd apps/web && npx vitest run tests/share-move-affordance.spec.tsx` ⇒ 3 passed；app-host 侧 7 枚；对拉两臂 `…mutate-collab-move-affordance.mjs` ⇒ `ARMS=pass (2/2)`（"什么都不挡"红 3 / "什么都挡"红 2 —— 只钉一侧会被另一侧混过去） |
| P-1 翻案（§9.2 那三格条件被上面满足） | 实验开关 + 设备本地偏好模块 + 那格措辞 + 两条词条一起退场；门禁 `check:share-entry-hidden` → **`check:share-entry-visible`**（五判反向钉，含"词条里不许再出现『看不到彼此改动』"） | `pnpm check:share-entry-visible` ⇒ 阳性对照过 + `臂数 5，失败 0`；`apps/web/tests/share-entry-visible.spec.tsx` ⇒ 5 passed（含两条反向臂：未配同步 / 停在收集箱 ⇒ 入口不出现）；旅程里 `toHaveCount(0)` 换成 `toBeVisible()` |
| 四层门禁与常驻载体 | 新尺子都在**已有**载体上：`verify:collab-sync` / `verify:collab-journey` 属 `verify:collab-suite` 名册（步数不写死，`check:collab-carrier` 只要求有载具）；单测层进 `pnpm -r test`（已在 `check` 链） | `pnpm check:collab-carrier` ⇒ `✅ 协作线 5 套验收全有载具：链内 1 套 / 名册内 4 腿`；`pnpm check:gate-wiring` rc=0（重命名后的门在链上，没有留下"写了没人引用"的实现） |

**这一批还剩什么**（不包装成"协作做完了"）：M4 逐 op 签名（不可逆层）、M6 移动端六段、跨清单搬迁的
真正语义（密钥世代 + 删除语义那一族）、共享任务完成档的通知措辞。P-1 的**理由**留在 §9.2 ——
下一次内容面再断，那三格条件就是重新按住它的判据。

⚠️ **逐张看图时抓到的一格读数，登记成"未判定"而不是"缺陷"**：`07-owner-sees-bob.png` 里 bob 那行成员
仍标「等待所有者授权」（`common.share.member.waitingForEnvelope`，由 `memberCanHoldOwnership` 为假驱动），
而 `10-bob-sees-owner-task.png` 证明他**手里有钥并且用上了**（他解得开 owner 写的那条）。
最坏的那种成因已按代码排除：入群那条腿 `acceptInvitation({ token, identityPublicKey })`
（`packages/sync-client/src/share-api-client.ts:190`）确实把加入者的身份公钥交给了服务端，
而 `GET /shares/:id/members` 把它回给 owner（`server/src/shares/share.routes.ts:464`）⇒
`ShareFeature.tsx:328` 那行 `identityPublicKey === null ⇒ continue` 不会挡住 bob。
剩下的两种都可能，且**现有任何尺子都量不到**：① 截图那一刻 `autoSeal` 的补封往返还没落地
（当时面板每 3s 轮询一次，旅程在那之后立刻拍图）⇒ 瞬态；② 补封真的没跑成 ⇒ owner 那台**永远**看不到
"转让给 bob"（B-10 那道门按 `hasEnvelope` 判）。
判它只要一条：在旅程第 7 段之后 `await expect(ownerPage.getByText('等待所有者授权')).toHaveCount(0)`，
要么它现在就绿（证明是瞬态、把这句留在册当回归钉），要么它红得有意义。
⚠️ **等多久这一句 2026-10-25 要按现量改口径**：面板那枚 3s 轮询已经撤了（§9.10 那条 ✅ 结案，ADR-0070），
所以"等 ≥ 一个轮询周期"不再是一个可执行的等待 —— 现在等的是**名册信号那一趟落回**
（服务端 `notifyShareRosterChanged` → 宿主重取；现量 `grep -n "setInterval" apps/web/src/features/share/ShareFeature.tsx` 零命中）。
写断言时别拿固定秒数当量，要等那一格自己变（`toHaveCount(0)` 带 timeout 就是这一形状）。
🔴 这一格**不在本批判据内**，也没被用它改过任何代码 —— 写下它是为了别把它弄丢。

### 9.12 M4 落地（2026-10-23 第六批）—— 逐 op 签名的读数

> 本节是 §9.3 那行 M4 从"没做"变 ✅ 的凭据。**为什么这么定**（签名域取哪些字节、钥从哪来、
> 失败怎么处置、存量追不追签）在 [ADR-0069](../adr/0069-share-op-per-op-signing-keys-and-disposition.md)
> 的六条裁决与文末实施记录里；这里只放**这一趟亲自跑出来的读数**，一句结论都不复述那份 ADR。
> 📌 开工前那三格现量（签名原语零消费者 / 在册那枚是 X25519 封装钥 / 线协议里没有 `signature` 也没有作者列）
> 记在同一份 ADR 的「事实基线」一节，每条带复量命令 —— 那是**当时的基线**，本节就是它的改口。

| 哪一层 | 落到哪儿 | 现量读数 |
|---|---|---|
| ① 纯函数层：签名域 + 封闭词表 + "改一个字节必被拒" | `packages/sync-core/src/share-keys.ts` 的 `buildShareOpSignatureMessage` / `signShareOpWire` / `classifyShareOpSignature`；词表就四枚 `verified` / `unsigned` / `invalid` / `signer-unregistered`，函数回别的值本身算红 | `pnpm --filter @heyta/sync-core test` ⇒ 364 passed。域内那几只数组的**形状**由一枚用例单独钉住（"顺序即协议"），失法臂各一枚：改载荷一个字节 / `signerMemberId` 被改写 / 跨清单重放同一枚签名 / 四态不许互相顶包 / 先判钥再判签 / 畸形输入只回 false 不抛 |
| ② 服务端层：上传边界验签 ⇒ **具名错误** + **永久拒绝**（不落库） | `server/src/shares/share.routes.ts` 里 `classifyShareOpSignature` 那一支，三枚码 `SHARE_OP_UNSIGNED` / `SHARE_OP_SIGNATURE_INVALID` / `SHARE_OP_SIGNING_KEY_UNREGISTERED`；判序是**先钥后人**（没在册就是 `signer-unregistered`，不去猜他是谁） | `pnpm --filter server test` ⇒ 2998 passed；常驻腿在 `verify:collab-sync` 第 13 步：13.1 伪造作者 / 13.2 无签 / 13.3 改一个字节 / 13.4 未在册 / 13.5 已移除成员的名册 / 13.6 拒了之后游标仍停在那条之前（读数逐条见下） |
| ③ 宿主与界面层：跨账号写 ⇒ 落库带可验签名；盘上那枚签名被改 ⇒ 另一台读到**具名失败**而不是静默的错数据 | 写侧 `packages/app-host/src/share-client.ts` 的 `signShareOpWire`（私钥只在装配点用一次，不上线不进日志）；读侧 `packages/app-host/src/share-verify.ts` 的三态 + **不物化**；web 只注入两个端口（`signerFor` / `verifiersFor`） | `pnpm verify:collab-sync` ⇒ `RESULT=OK steps=13`，其中第 13 步打印"游标停在 7（被拒那条 8 之前）、再拉仍报同一条"；`pnpm --filter @heyta/app-host test` ⇒ 2018 passed |
| 签名公钥在册（发布那条腿） | 接受邀请时带 `signingPublicKey` + 补发端点 `PUT /shares/:shareId/members/:memberId/signing-key`（**只本人**、**只允许「没有→有」**、值不同 ⇒ 409 `SHARE_SIGNING_KEY_CONFLICT`）；服务端新列走 `cd server && sh scripts/migrate-deploy.sh` | `verify:collab-sync` 第 2/3 步（owner 补发 + bob 接受即在册，回读 `signingPublicKey` 非空）；`server/tests/share-routes.spec.ts` 用**生产签名件**当夹具 |
| 🔴 名册 ≠ 成员面板（这一批抓到的真缺陷） | 新端点 `GET /shares/:shareId/signing-keys`（**含已移除成员**）+ `ShareApiClient.listSigningKeys`；面板那侧仍走 `GET /members` | 缺陷形状：名册若复用 `/members`（只回在册成员），**把人移出清单的那一刻起，他写过的每一条与其后所有人的改动一起读不出来**。判据 = `verify:collab-sync` 第 13.5 臂；反证 = 变异臂 `roster-active-only` |
| 关掉无签通道（裁决六） | 服务端对 `outcome !== 'verified'` 一律拒 ⇒ 三套手搓上传的载体当场变红，本批把它们改成"发布公钥 + 走生产签名件" | 改前实测红：`SHARE_OP_SIGNING_KEY_UNREGISTERED`（第 5 步）；改后 `verify:collab-sync` `RESULT=OK steps=13` / `verify:collab-revoke` `RESULT=OK steps=8` / `verify:collab-conflict` `RESULT=OK steps=6` |
| 变异臂（能不能红，由装置回答） | `research/tools/mutation-rigs/mutate-collab-upload-gate.mjs` 四臂：放过无签 / 放过被改 / 作者列不落 / 名册只看在册 | `node research/tools/mutation-rigs/mutate-collab-upload-gate.mjs` ⇒ `ARMS=pass (4/4)`（BASELINE 与 RECHECK 均绿、`.mut-bak` 无残留）；两处预测漂移的如实对账写在该件与 `README.md` 那一行里 |

**四把尺（2026-10-23 18:4x 现量，按当前 HEAD 串行一次一条）**

| 尺 | 读数 |
|---|---|
| `pnpm -r typecheck` | rc=0 |
| `pnpm -r test` | rc=0；分子分母同一条构造式（先去 ANSI 色再摘 `Tests ` 汇总行求和）⇒ **21 个测试包 / 14522 passed / 14 skipped / 14536 总计**，失败行数零命中 |
| `pnpm -r build` | rc=0（18 段 `build: Done`，error 与 ELIFECYCLE 两类关键字零命中） |
| `pnpm verify:collab-journey` | `RESULT=OK steps=3` + rc=0；`e2e/collab-journey-results/` 那 11 张**逐张肉眼看过**：09/10/11 三张证明两台真浏览器互见仍然成立（owner 那台写「换窗纱谁来约师傅」⇒ bob 那台只画出这一行；bob 写「量窗台周末去建材城」⇒ owner 那台两行），08 证明面板错误可见（红字「这一步没有完成：409 SHARE_MEMBER_LIMIT」），01–07 是入口/同意面/名册/凭证/入群链接/加入成功那一族 |

⚠️ **一趟假红登记在这里，免得下一位当成回归**：`apps/web/tests/task-sort.spec.tsx` 的「批量完成」那一枚
在并发的那趟 `pnpm -r test` 里红了一次（`expected undefined to be defined`，该文件耗时 8109ms），
单独跑 ⇒ `8 passed`（1231ms）。判据没动、被测文件与它依赖的源文件对 HEAD 干净 ⇒ 记为**负载抖动**。
教训（为什么"整趟绿"要单独一趟重跑而不是拿首趟读数凑）追加进环境陷阱，编号见文末。

**这一批还剩什么**（不包装成"签名做完了"）：
- **移动端**（这一批当时的第一号欠项）：2026-10-25 那条腿接上了，签名件**没有被复制第二份**（还是 `packages/app-host/src/share-client.ts` 的 `signShareOpWire`），
  手机写出的 op 在 owner 侧重验的读数见 §9.13 那一行 L3/L4。
- 名册取不到时只有宿主层那个异常名（`ShareSignatureRosterUnavailableError`），**没有界面措辞** ⇒ 用户看到的是"没更新"，不是一句为什么。
- 服务端可以把 `signature` 与 `signer_member_id` **一起**抹掉 ⇒ 读侧回落到"存量未签"那一形。这一格 ADR-0069 实施记录里如实写着没做到，翻案条件也在那一节。
- 库里存量 op **不追签**（裁决二/三定的），所以"每一条都可验"只对**新写入**成立；判它的断言在 ADR 里，别在本节推断。


### 9.13 M6 移动端设备腿（2026-10-25 第七批）—— 设备腿抓到的是**产品缺陷**，不是装置问题

**起因**：§9.4 那句"六段已接上"是**源码级**读数。把同一条旅程搬到 iOS 真机（第 21 跑）时，
前半程一路绿（同意闸 → 填凭证 → 提交），界面随后出现一行红字：

> `vault root key 必须是 32 字节 Base64`

肉眼看过的那一帧：`apps/mobile/evidence/collab-ios-10251033/06f-加入没走到成功态.png`。

**根因链**（逐层读出来的，不是猜的）：那句来自原生模块，不是 JS 层的密钥环逻辑 ——
`grep -n "32 字节" apps/mobile/ios/Heyta/HeytaVaultSecureStorage.swift` 直接命中写入那一步的校验。
移动端 `apps/mobile/src/lib/share-key-store.ts` 把 app-host 那份 `ShareKeyStoragePort`（异步 KV）
接到了原生 `VaultSecureStorage` 的 **root-key 那对接口**（`load`/`save`）上，而那对接口
**在 Swift 与 Kotlin 两端都校验"恰好 32 字节"**，读写双向都校。
这不是那条接口的缺陷，是它的契约：一把被截断的 vault root key 必须**失败**，
而不是解出一堆垃圾 —— 所以不能靠放宽它来解决问题。
而 `heyta.share-keys.v1` 是一份**变长** JSON（`serializeShareKeyStore` 的产物）。
结论：移动端共享通道从一开始就**存不进密钥**，因此 L1 不可能过，L2–L6 全部无从谈起。

**修法（为什么是这个形状）**：原生模块另开一对**变长通道** `loadBlob`/`saveBlob`
（Swift + ObjC 桥声明 + Kotlin 对偶 + TS 桥面 `VaultSecureBlobStorage`），share 密钥端口改走这一对；
**root-key 那对一字未动** —— `apps/mobile/evidence/ios-keychain-probe-invalid.json`
那枚探针依赖的正是"非法长度必拒"。上限 64 KiB（JS/两端各挡一道，原生数的是 UTF-8 字节，是最终判决）；
解出一段坏 UTF-8 时两端都**响亮地失败**（Kotlin 用 `CodingErrorAction.REPORT`，
因为 `String(bytes, UTF_8)` 会把坏字节变成 U+FFFD ⇒ 坏 JSON ⇒ 本层把槽当空 ⇒ 下一次 `set` 覆盖 = **无声丢钥**）。
"密钥料不落 sqlite"这条既有理由留住：落的是 Keychain/Keystore，判据是
`apps/mobile/tests/share-key-store.spec.ts` 里"不落 device-prefs"那一条（去注释的源码文本尺）。

**为什么单元侧全绿却拦不住这件事**：那一层的夹具是一枚假 vault（Map），
它证明的是"我这层映射的形状"，不是"原生那一格吃不吃得下" —— 量的是夹具，不是产品。
JS 这半边现在能钉的只有**走的是哪一对接口**：
`grep -c getVaultSecureBlobStorage apps/mobile/src/lib/share-key-store.ts`（非 0 才算走对），
钉它的用例是 `share-key-store.spec.ts` 的「密钥料走 blob 通道，不走 root key 那对恰好 32 字节的接口」。
🔴 **这条判据能红，实测过**：把那三个符号临时换回 `getVaultSecureStorage` ⇒ 该用例红（1 failed），
还原只从 `share-key-store.ts.mut-bak` 取并核 md5。契约本身**只有真机能量**，那台机器就是第 21/22 跑。

**连带改口的文档**（同一结论的几种句子形状，逐格现量而非抄旧句）：
本节 §9.4 行③ 原来把密钥端口指到 `share-local-store.ts`（那是非秘密三样那格）⇒ 已改；
「六段已全部接上」降到「源码级接上，设备腿当时红」；
ADR-0062 实施记录加了第 4 条（原生格子的形状，裁决未动）；
ADR-0050 那句「RN port 只传递 base64 root key」加了**限定范围**的追加段（它今天只适用于 root-key 那对）；
`feature-matrix.md` 6.1 那句"仍欠 M4 与 M6 移动端"改口；
`docs/agents/progress-log.md` 那句"M6 移动端零接入"改口；
环境陷阱新条目见现量：`grep -cE '^[0-9]+\. ' docs/reference/environment-traps.md`（本批写的是 #559）。
`share-key-store.ts` 文件头原来那句"注销/撤销路径按同样后缀**即可**一并清掉"**过强** ⇒ 已改成如实口径
（能清，但今天 `clearMobileVaultSession` 只删 root key；这一格转成下面的待拍板项，见 §9.14 末节「这一批还剩什么」）。

**但本节标题不能覆盖第 22 跑那一步**：那一跑红在 `走不到「同步与隐私 → 使用自托管服务器」那张表单`，
取证之后定性是**装置缺陷**（截图 `apps/mobile/evidence/collab-ios-10251233/02-自托管表单没开.png`
画的是「AI 与集成」那一屏，而第 2 步的 bundle 逐字节对账是过的 ⇒ 本批 Swift 改动确实编进装了机的产物）。
根因链三条，都在装置这一侧：① RN 的行把标签合成成 `设置, 设置`，shim 的 `--exact` 是整串相等 ⇒ 精确按压
**恒取空**；② 装置于是退到"按预检那发子串命中节点的 frame 中心"，而那一发量到的中心实际是 `y=-403`
（列表带着滚动残留，行在屏外），**屏外坐标按下去是空操作且不报错** ⇒ 落到当时占着 `y=365` 的另一行；
③ 到达判据本身在两屏都成立（「我的」页那一行的标签逐字含「设置」）⇒ "没跳页"被读成"跳好了"。
修法与判据（环境陷阱 #560）：本线新增一枚锚点解析器 `scripts/tools/ios-collab-anchor.py` ——
命中条件只认**逐字相等**或**按 `,` 切分后的整段相等**，同名多枚回 `ambig`（不取第一枚），
屏外回 `offscreen`（先滚进可见区、重取快照、重解析，还不行就报出来，不按）；
按压通道的四处同类探针（`ax_press` / `ax_press_until` / `wait_enabled` / `wait_state` 的忙态采样 /
`back_to_tabs` 的"到底部标签层"）全部改走这一把尺，跳页的到达判据改用**只在目标屏存在**的
`AXUniqueId`（`profile-entry-settings` / `settings-section-sync` / `profile-entry-share`，
三枚都是设备上现量的，见 §9.13 这一段的第 22/23 跑）。判据自己能不能红：
`python3 scripts/tools/ios-collab-anchor.py --selftest`（条数由它自己打印，现量：其中一条是对照臂 ——
把命中规则换成子串，自检必须红）。装置侧还补了一条步骤 0 的门禁：自检不绿就不开设备，
免得下一读的人再花一趟 Release 构建去猜"是不是产品没入口"。

**Android 那一侧本批欠的两格，2026-10-25 补了一格、如实留了一格**：
编译腿已过 —— 在册通道 `node scripts/run-gradle.mjs :app:assembleDebug`（打包机 `windows-pc`，
四条判据：工作树 tar sha256 对账 / 远端旧产物已清除 / 产物 mtime ≥ 构建起点 / 拉回后逐字节相同）。
这一趟顺带抓到一处**已经推到 origin 的缺陷**：上一批写的 blob 严格解码那行用的是
`onUnmappableInput`，而 `javap java.nio.charset.CharsetDecoder` 现量只有 `onUnmappableCharacter`
⇒ Kotlin 未解析引用，Android 一编译就断（Swift 那侧编过，所以 iOS 腿看不出来）。
改判名的那笔用现量命令取：`git log -1 --format=%h -- apps/mobile/android/app/src/main/java/com/heytamobile/vault/VaultSecureStorageModule.kt`。
🔴 **设备腿仍然没跑**：共享密钥走 blob 这条路在 Android 真机/模拟器上没有读数
（`scripts/verify-android-vault-storage.sh` 要独占一枚 emulator，而本机规则禁止在 Mac 起模拟器）。
所以"Android 的 M6 已验"这句话现在不成立，成立的只有"编译过 + JS 侧形状钉住"。
另记一条装置事实：远端源码包名 `C:\src\heyta-src-android.tar.gz` 是**跨会话共享**的，
两条会话同时送包会互相覆盖 —— 第一趟就是这么红的（对账门按设计拒了混合树，重试即过，不是构建坏了）。

---

### 9.14 M6 移动端设备腿·第八批（2026-10-25 第 24–31 跑）—— L1 第一次真过、L2–L6 全绿，以及三处"两把尺都绿"的洞

**这一段判的是哪句话**：§9.13 末尾那句"设备腿当时红"到本批为止的形状。
逐格读数在下面这张表里，**每次现量**（`pnpm verify:mobile-collab:ios`），别抄本节文字。

**跑次归因**（同一台模拟器 `heyta-collab-m6-oct24` / `60D29F47-…CBF3281`，每轮 `simctl uninstall` 起全新态）：

| 跑 | 退 | 红在哪一格 | 归因（装置 / 产品 / 环境） |
|---|---|---|---|
| 24 | 3 | 第 6 步「凭证没进输入框」 | **装置** —— `tree_has` 解析的是上一次快照，而 `fill_field` 的回读走 shim 的定向快照 ⇒ 两句话量的不是同一棵树（#564）。手工 `describe-all` 证明 `AXValue` 逐字就是那一串 |
| 25 | 1 | 第 6 步「没走到加入成功」 | **产品** —— `JoinShareScreen` 在成功那一拍同一帧调 `onJoined`，宿主立刻换屏 ⇒ 回执**一帧都没画过**，装置等满 240s |
| 26 | 1 | 第 7 步「按不进共享清单入口」 | **装置** —— 底部标签此刻**在树上但按了不动**（人已经在「我的」这一档的第二层里，五块面板是 `display:none` 常驻），出路只有顶栏「返回」（#571） |
| 27 | 3 | 第 2 步 `simctl install` | **环境** —— 那台模拟器在上一趟之后被关机；显式给了 `IOS_UDID` 的那条路不验 `Booted`，于是白烧一次构建（#573）。现在第 0 步就量状态并退出 |
| 28 | 1 | 第 6 步 App 崩到桌面 | 见下面「第 28 跑那一发崩溃」；同一趟还第一次照出**移动端 bundle 吃的是各包的 `dist`**（#574） |
| 29 | 1 | 第 6 步「没走到加入成功」 | **装置** —— 到达判据按 #574 的建议换成了 `testID`，但那枚挂在 `<Text>` 上：截图（`06f-加入没走到成功态.png`）里「加入成功，这份清单已经在「已共享的清单」里了。」**画着**，而 `describe-all` 那一屏 11 枚节点只有 1 枚带 `AXUniqueId`（那枚「关闭」按钮），文字节点是 `AXStaticText` + `AXUniqueId=None` ⇒ 判据恒不命中（#575）。**产品这一发是走通的**，且同一发按压**没有**复现第 28 跑的崩溃 |
| 30 | 1 | 第 7 步 L2：手机界面里没有 owner 写的那条任务（29 通过 / 1 失败） | **产品** —— 到达判据换锚后 L1 第一次真过，随即照出**下一格**：名册下来了、清单行也绑好了，而"加入之前就在清单里的东西"没有任何一条路径会带来（`new_share_ops` 只在**有人新写**时响）。取证 `apps/mobile/evidence/collab-ios-10252154/07-看不到owner的任务.png`；修的那一格见下面「本批修掉的四处产品缺陷」第 4 条。**两壳同形** —— web 侧同一条洞另起一格 |
| 31 | 0 | — | **39 通过 / 0 失败**（`run-rc=0`，逐格读数见下面那张表）。L2 那一格由本批第 4 条修法转绿。⚠️ 归因：这一趟的 bundle 里**含别线未提交的改动** —— `@heyta/ai` / `@heyta/i18n` 的 `src` 当时脏着，装置那道按 mtime 的新鲜度尺连挡两次（#576），照它打出的命令补构建后才放行 ⇒ 这轮截图的逐字节对账锚在 `apps/mobile/evidence/collab-ios-10260001/bundle-sha256.txt`（现量 `cut -c1-16`），**不锚在本节文字** |
| 32 | 1 | 第 10b 步 L7「按不动共享入口」 | **装置** —— 第 10 步结束时人停在**共享空间那一屏**（比共享首页深一层），而 L7 起手去按底部标签：共享面挂在「我的」这一档的第二层里，再按同一档不改 `tab`（#571 那一族的第二次实测）。日志那句"当前屏顶部文字=共享清单"读的是装置走错了路，不是产品没有入口 ⇒ 改成 `back_to_anchor` 逐层爬。同一趟把 #577 那枚**装置自造的署名形状**修了（`init` 从服务端读回 owner 行的 `userId`、`add-comment` 不许 `??` 兜成 memberId），并新增第 9 步的署名形状尺 |
| 33 | 3 | 第 10b 步 L7「没有可共享的清单」 | **装置前提**（`run-rc=3`，不判产品）—— 这台账号是旅程里新注册的、此前只**加入**过别人那一份，名下一条自己的清单都没有，而"可共享的清单"那一节读的就是本机没挂 shareId 的清单行。L1–L6 这一趟**全绿**（含新的署名形状尺：两行兜底署名同一种形状）。⚠️ 但这一发把产品定义里「**手机用户能建清单**」那一格照出来了：它此前从未在设备上走过 ⇒ 不绕过它，L7 改成**先从界面上建一条清单**（`profile-entry-lists` → `mobile-list-name` → `mobile-list-add`），建不出来就是产品红，建得出来才继续往下走。第 34 跑带这枚改动 |
| 34 | 3 | 第 2 步 新鲜度尺 | **环境**（#576 那一族的第二次实测，不判产品）—— 别线的脏 `src`（`@heyta/i18n` / `@heyta/legal`）比 `dist` 新，装置在装包之前就拦下 ⇒ 烧掉的这一趟没碰到设备。照它打出的那条命令补构建后重发。🔴 归因从这里开始要写清：**第 35 跑起的 bundle 里含着别人未提交的改动**，逐字节对账只锚当轮 `apps/mobile/evidence/<趟>/bundle-sha256.txt`，不锚本节文字 |
| 35 | 0 | — | **50 通过 / 0 失败**（`run-rc=0`，取证目录 `apps/mobile/evidence/collab-ios-10260246/`，截图张数现量 `ls -1 <该目录> \| grep -c 'png$'`）。**L7 第一次全绿**：手机自己建出清单 `手机自建清单10260246` ⇒ 设为共享（owner 一侧的同意闸在设备上按过）⇒ 签发一张邀请 ⇒ 服务端认它 `role=owner` 且所有者行带签名公钥、活邀请 1 张 ⇒ 撤销回到无邀请态 ⇒ 共享首页上两份并排（自己建的 + 加入的）。逐格读数见下面那张 L1–L7 表 |

#### 第 31 跑逐格读数（同一台模拟器、`simctl uninstall` 起全新态、每格都配一张肉眼复核过的截图）

| 格 | 判据（装置里那一句话） | 读数 | 截图（都在 `apps/mobile/evidence/collab-ios-10260001/`） |
|---|---|---|---|
| L1 到达 | 手机自己说出「加入成功」，且该相位独占的**可交互**节点 `share-join-close-final` 在树上 | ✅ | `06g-加入成功.png` —— 副标题写的是手机上真实的落点「已共享的清单」（不是 web 的「侧栏」），「关闭」在位 |
| L2 下行 | owner 在成员加入**之前**写的那条任务出现在手机上，全程没点过一次同步 | ✅（第 30 跑红的正是这一格） | `08-下行任务可见.png` —— 评论区那一列里是「owner取证任务10260001」，成员两行（所有者 / 可编辑（我））也在 |
| L3 上行 | 手机发出的评论回到自己的界面上 | ✅ | `10-评论已输入.png` → `11-手机评论可见.png` |
| L4 签名 | 手机写出的那条 op 在 owner 侧重验 = `verified` | ✅ —— ADR-0069 那句承诺在移动端成立（读数在服务端侧，无设备截图） | — |
| L5 信号 | owner 写第二条评论 ⇒ 手机靠 `new_share_ops` 自己出现，**不许碰同步按钮** | ✅ | `14-信号驱动到的评论.png` |
| L6 偏好面 | 只有活动那三档；两枚没有输入的档位不在界面上 | ✅ 三格都在（活动三档在、`任务提醒` 不在、`自动接受…` 不在） | `16-通知偏好面.png` —— 三行各带一枚**方框标记** ⇒ 「开关要看得出来是开关」两半都齐：图证是这一张，判据在 `apps/web/tests/share-notif-prefs-affordance.spec.tsx`（钉描边空框 / 实心主色 + 对钩 / 状态不只靠颜色，变异臂"把标记整块删回去"＝截图里那一版，正是它红的那一档）。⚠️ 这一句以前写成"判据那一半待补"—— **那半句是旧的**，用例早就在册（2026-10-26 现量：`grep -n marker apps/web/tests/share-notif-prefs-affordance.spec.tsx`） |
| 崩溃那一形 | 第 28 跑那发（点一颗立刻卸载的 `Pressable` ⇒ `SIGABRT`） | 第 29/30/31/32/33/35 六趟同一发按压**都没复现** ⇒ 仍按**未判定**登记（一次不崩不构成"修好了"，见末节那一格） | — |

#### 第 35 跑新增的两格（L7 那一侧，取证 `apps/mobile/evidence/collab-ios-10260246/`）

| 格 | 判据（装置里那一句话） | 读数 | 截图（肉眼逐张看过） |
|---|---|---|---|
| **手机自己建清单**（产品定义里那句「手机用户能建清单」第一次在设备上走） | 「我的」→ 清单管理面 → 名字框填进去（`set-value` 回读逐字相同）→ 按「新建清单」⇒ 那一行出现在**本机清单名册**里 | ✅ | `17b5-手机建出的清单.png` —— 两行（`共享清单` / `手机自建清单10…`，行名被界面自己截断），每行四枚动作图标都在；名字框与「新建清单」在空值下是**禁用态**（不是"点了没反应"） |
| **L7 开共享**（owner 一侧，反向那一半） | 共享首页上按那条新清单 ⇒ 同意闸 ⇒ 面板上有**所有者才有**的『生成邀请』⇒ 填邮箱 ⇒ 签发 ⇒ 服务端认 `role=owner` + 所有者行带签名公钥 + 活邀请 1 张 ⇒ 撤销回到无邀请态 ⇒ 首页上两份并排 | ✅ 五段全过 | `17f-开共享同意面.png`（三行范围句 + `不再提示` + `取消`/`确认共享`，与入群那一侧**同一道闸**）→ `17h-手机建好的共享面板.png`（顶栏是手机自己那条清单名、`成员 98 · 所有者（我）`、`还可邀请 29 人`）→ `17l-撤销后无邀请态.png`（凭证那一格已摘掉）→ `17p-手机自己建的共享在列表里.png`（`已共享的清单` 两行并排、`可共享的清单` 回到空态） |
| 署名形状尺（第 32 跑那枚装置缺陷的常驻臂） | 评论区两行兜底署名**同一种形状**（都是账号 id 前缀），且至少有一行 | ✅ `n=4 digits=4 offenders=`（空 = 无一枚是别的形状） | 同一张 `14-信号驱动到的评论.png`（这一趟的值与第 31 跑不同：owner 那行不再长成 memberId） |

⚠️ **两枚看图时的"看着不对"经源码核对后确认不是缺陷**，记下来免得下一趟又当新案：
① `17h` 上「还可邀请 29 人」在建 share 之后、签发**之前**就已经是 29 —— 算法是
`MAX_SHARE_MEMBERS - activeCount`（`packages/ui/src/sync/share-model.ts` 的 `slotsLeft`），
所有者自己占一格，所以 30 上限新建就是 29，撤销邀请也不动它（它数的是成员不是邀请）；
② `17b5` 那行清单名带省略号是**界面截断**，不是数据被截（`17f`/`17p` 上是全名）。

🔴 **看图抓到的两枚候选已各自回源码定性**（按本仓口径：截图只证外观，定性要回源码。结论是**一枚装置自造、一枚两壳真实产品缺陷** —— 两枚都不是"看图看错"）：

1. **「评论内容不能为空」在评论已发出之后仍挂在界面上** ⇒ **两壳真实产品缺陷**（不是手机独有）。
   病灶在**共用**那一份 `packages/ui/src/sync/CommentThread.tsx`：报错条件写的是
   `draftError !== undefined`，而 `validateCommentDraft('')` 恒返回"不能为空" ⇒ 只要草稿是空的
   这句话就在，**发成功之后清空草稿也把它留在屏上**。修法按"报错时机"而不是"报错文案"：
   新增一枚 `emptyComplained` 状态 —— 空草稿**按过发送**才说话，写过字就闭嘴；超限那条实时说
   （它判的是"正在输入的这条已经不能发"，与"你什么都没写"是两件事）。
   判据：`cd apps/web && npx vitest run tests/share-comment-draft-error.spec.tsx` ⇒ 6 passed
   （含"发成功后不许谎称失败""按过空发送才说话""超限实时说"的**对照臂**、以及"两壳真渲染同一份组件"
   那枚读源码的装配钉 —— 后者防的是"只在手机上修了"这一族）。
   变异臂：把渲染条件改回 `draftError !== undefined` ⇒ **恰好 2 枚目标红**（其余 4 枚不红，
   说明这枚臂指的是这一件事，不是把组件改崩）。
2. **两条评论的署名形状不一**（`成员 87` vs `成员 85432a8c`）⇒ **装置自造**，产品没写错字段。
   `scripts/lib/collab-owner-step.mjs` 替 owner 那台设备写 `authorUserId` 时用的是
   `state.ownerUserId ?? state.ownerMemberId`，而 `init` 从来没把 `userId` 取回来过 ⇒
   `??` 左边恒 `undefined`，每一条装置代写的评论都落成 memberId。手机自己写的那条用的是真账号
   `userId`，于是同一屏两形。修法两条：`init` 从**成员视图那一行**读回 `userId` 并硬要求
   （读不到就按判据退出，不许兜），`add-comment` 缺 `ownerUserId` 直接 `die`。
   常驻尺：装置第 9 步新增署名形状判据（`AUTH_SHAPE`，只比形状不比值：几行、前缀各几位、
   有没有非同类的一行），读数**逐趟落在取证目录**：`apps/mobile/evidence/<趟>/auth-shape.txt`
   （现量：`cat apps/mobile/evidence/$(ls -1 apps/mobile/evidence | tail -1)/auth-shape.txt`）。
   ⚠️ 这枚落盘是从第 35 跑**之后**那版装置开始有的，所以 33/35 两趟的读数只在这节的台账文字里：
   第 35 跑 `n=4 digits=4 offenders=`（空 = 无一枚是别的形状）。把读数只留在一次性控制台日志上
   这件事本身也一并修了 —— 那是 #529 那一族（锚点指向会被清掉的载体）。
   完整教训（"装置替别的设备写业务字段时不许 `??` 兜一个替代品"）记在环境陷阱 #577。

**本批修掉的四处产品缺陷**（前三处全部只在真机上看得见，源码级读数一条都抓不到；第四处是**两壳同形**，源码级读数同样抓不到 —— 它抓的是"有没有这一条路径"，而那条路径本来就不存在）：

1. **入群成功回执永不出现**（第 25 跑）。`JoinShareScreen` 删掉 `onJoined` 回调，成功相位留在原地，由用户按「关闭」回共享主屏 ——
   与 web 同形（`apps/web/src/features/projects/ProjectsPanel.tsx:477` 那句注释"只导航、不关对话框：成功屏要留到用户自己关"
   说的就是同一件事，两壳此前各做一半）。装置侧配套补了一发按「关闭」与一条"回执退不出去"的判红。
2. **通知偏好那三行看不出是开关**（第 26 跑的 `07b` 那张图）。行是 `Pressable`、`aria-checked` 也在、点了确实翻转，
   屏幕上却没有方框也没有对钩 ⇒ 既看不出那是开关、也看不出当前开还是关。修在
   `packages/ui/src/sync/NotificationPrefsPanel.tsx`（与 `Settings.ToggleLine` 同形状的标记，全部走 token）。
   理由与两枚钉子记在 [ADR-0071 补记二](../adr/0071-share-notification-content-boundary.md)。
3. **入群那一屏的两句话在手机上谎称 web 的格子**（第 26 跑的 `06g`：「加入成功，清单已出现在侧栏。」—— 手机上没有侧栏）。
   新增 `mobile.share.join.{subtitle,done}`（zh-CN + en），两壳各说各的真落点；**不把 web 那条改成平台中立的模糊说法**，
   那等于让 web 用户为手机的形状失去精度。类级尺：`apps/mobile/tests/share-ui-assembly.spec.ts` 的 ⑥ 组 ——
   扫 `mobileSources()` 用到的每一枚词条，中/英两档值里出现"只在另一壳存在的格子"就红，
   配一枚"探针必须读得到 `web.share.join.done` 里那枚「侧栏」"的对照臂（否则那个 0 会被读成探针坏了）。
   ⚠️ 同一族错还有**三枚存量**（`common.organizer.confirm.impactChildren` / `.impactChildrenArchive` /
   `common.trash.confirm.strandChildren`，手机上同样说「侧栏」）—— 那两句被回收站/归档那条线自己的用例钉着，
   **本线不代改、也不代判"这样也可以"**，只把它们登记进那张"只许变短"的债表（`OTHER_LINE_DEBT`）。
4. **打开一份共享清单时，"加入之前就在清单里的东西"没有任何一条路径会带来**（第 30 跑 L2）—— 两壳同形。
   此前下行只有**两枚**触发点：实时信号 `new_share_ops`（只在**有人新写**时响）与评论区挂载时按任务拉那一条。
   成员刚加入一份早就写了任务/便签/评论的清单时，名册下来了、清单行绑好了，界面上却是一条空清单 ——
   而源码级读数抓不到这件事，因为它问的是"有没有这条路径"，**那条路径本来就不存在**。
   🔴 判据本体写成共享层的一件事（AGENTS §3.5）：`packages/app-host/src/share-signals.ts` 的
   `pullSharedListOnOpen`（三条口径：每次打开都拉 / 拉不成不许抛穿、但要留 `error` 读数 / 语义只住这里），
   两壳各自只做投递：移动端 `apps/mobile/src/share/share-signals.ts` 的 `pullSharedContentsOnOpen`
   （拉过之后按 `added > 0` **或** 有验签拒敲一次重画 —— 移动端的那层没有别的通知通道）由
   `ShareSpaceScreen.tsx` 里**只按 `selected` 触发**的一枚 effect 调用；web 侧新增
   `apps/web/src/features/share/use-share-open-pull.ts`，调用点是 `App.tsx` 的
   `useShareOpenPull(currentProject?.shareId)`（"当前停在哪个清单行"就是设备上 `selected` 的对位），
   它**不再补敲重画** —— web 那个唯一出口 `comment-actions.ts` 的 `pullShareOps` 自己就敲
   （`added > 0` 敲引擎通知、有验签拒敲重画），这里再敲一遍等于同一次拉取重渲染两轮。
   判据与本批现量读数（每条都能红，命令附在下面，别按本节文字推断）：
   · 本体：`cd packages/app-host && npx vitest run tests/share-signals.spec.ts` ⇒ 14 passed；
   · 移动端装配：`cd apps/mobile && npx vitest run tests/share-signals.spec.ts` ⇒ 16 passed
   （新增那 7 枚钉的是：会话缺席零请求、shareId 交给**那一份**会话、`added > 0` 敲重画、
   🔴 有验签拒也敲重画、对照臂不敲、拉不成不抛穿、调用点唯一 + 依赖数组恰为 `selected`）；
   · web 装配：`cd apps/web && npx vitest run tests/share-open-pull.spec.tsx` ⇒ 7 passed
   （同一组形状，另加"停在同一份反复重渲染只拉一次"与"非共享清单行零请求"）；
   · 🔴 变异臂已收成**一副可复跑的装置**：`node research/tools/mutation-rigs/mutate-collab-open-pull.mjs`
   ⇒ `ARMS=pass (5/5)`、三载具基线与复跑全绿（2026-10-25 现量）。五臂各注一枚真实会犯的病灶：
   `no-pull` 红 3 / `throw-through` 只红「抛穿」那一枚 / `added-only-repaint` 只红「有验签拒」那一枚 /
   `mobile-call-site-gone` 与 `web-call-site-gone` 各只红"调用点唯一"那一枚 ——
   最后这两臂是这副装置最值钱的：**装配在、没人调，纯逻辑那 14 枚照样全绿**，而设备上前空清单。
   ⚠️ 本批早先那两发**手工**变异（一发红 2、一发红 1）已被这副装置取代 —— 手工那发的编辑只活在本轮的一次性
   scratch 目录里（会随清场消失，所以**不写进台账当锚点**）；`no-pull` 那一臂实测红 3，多出来那枚是**对照臂**
   （它断言的就是 `pulled === true` 本身），逐条读后确认它该红 ⇒ 收紧的是预测，不是判据。账登记在 `research/tools/mutation-rigs/README.md`。
   ⚠️ **没有放宽 L2 的判据**：它判的是"这台设备能不能看见别人写在这份清单里的东西"，
   把判据改成"等一条新写入再来"就等于把缺陷读成通过。

**第 28 跑那一发崩溃（未判定，如实记）**：按「加入共享清单」之后 App 直接回到 SpringBoard（取证帧
`apps/mobile/evidence/collab-ios-10252123/06b2-加入面板没开.png` 画的是桌面 + Spotlight 键盘，不是应用内某一屏），
崩溃报告 `Heyta-2026-10-25-213336.ips` 的签名是 `com.meta.react.turbomodulemanager.queue` +
`ObjCTurboModule::performVoidMethodInvocation`（`RCTTurboModule.mm:467`）⇒ **与环境陷阱 #549 同一签名族**
（void 型 TurboModule 抛异常 → `std::terminate` → `SIGABRT`），而 #549 记的那条"报告里没有 `asi`／
`exceptionReason`／`lastExceptionBacktrace`"在这份上逐字成立（三格现量都是空）⇒ **拿不到是哪一次调用**。
#549 的修法只堵了 `autoFocus` 那一族触发点；这一发的形状是**点一颗会随导航立刻卸载的 `Pressable`**
（`setPressed` / `hotspotUpdate` 也是同一批 void 方法）。⚠️ 第 26 跑同一发按压没崩 ⇒ 这是**竞态**，
一次绿不许读成"修好了"。本批不据此宣布缺陷已定位，登记为待判定项（判它的断言见末节）。

**本批另外收掉的三格**：

1. **web 侧同一枚「打开才拉」洞**（与上面第 4 条同一个病灶、同一个判据本体）。
   接缝取"当前停在哪个清单行"（`apps/web/src/App.tsx` 的 `currentProject?.shareId`，它就是设备上 `selected` 的对位），
   新增 `apps/web/src/features/share/use-share-open-pull.ts`；**没有**并进 `ShareFeature` 那个含 `reload` 的 effect
   （`reload` 的身份随 token/baseUrl 变，那会把"换一次凭据"变成"多拉一次"）。
   判据：`cd apps/web && npx vitest run tests/share-open-pull.spec.tsx` ⇒ 7 passed；
   变异臂 `web-call-site-gone`（摘掉调用点）⇒ 只红"调用点全壳唯一"那一枚（见上面那副装置）。
   真浏览器那条腿带着这枚改动复跑：`pnpm verify:collab-journey` ⇒ `RESULT=OK steps=3`。
2. **`verify:collab-journey` 这条腿从入群同意闸落地那天起就是必红的**，而红的原因不是产品坏：
   那一闸自己拍了一张 `05a-bob-join-consent.png`，收口清单却没跟着长 ⇒ 第 3 步报
   「拍了 12 张，在册 11 张（多出来的没人名 = 没人看过的图）」。
   ⇒ 本批**逐张看过**那张图（看到的内容见下面第 3 条）再把名字补进在册清单，随后 `RESULT=OK`。
   这条记在这里是因为它是"判据要有人跑"那一族的反面：**一道一直红、没人回头看读数的腿，等于没有腿**。
3. **看图照出的两枚候选已各自定性并收掉**（一枚两壳真实产品缺陷、一枚装置自造，判据与变异臂见上面
   「看图抓到的两枚候选已各自回源码定性」那一节）；同一张 `05a` 还照出 **#64 那一格在 web 也有实例**：入群面（`JoinSharedListDialog.tsx`）的
   title/body/accept 三行取的是 `common.share.consent.*` —— 与 owner 那一屏同一组键，
   所以刚加入的人看到的句子是「把清单设为共享前，请确认以下事项」、按钮是「确认共享」，
   而他并没有把任何清单设为共享。**这一格仍归产品负责人拍**（改文案属对外法律表征），本批只把它量清楚。

---

#### 四把尺现量（2026-10-26，串行一条链，逐枚带 rc）

| 尺 | 命令 | rc | 读数与归因 |
|---|---|---|---|
| 1 typecheck | `pnpm -r typecheck` | **0** | 🔴 **第一次跑是 rc=2，红在本线自己那枚新用例**：`apps/web/tests/share-comment-draft-error.spec.tsx` 的 fixture 多写了 `CommentView` 上并不存在的 `updatedAt` —— vitest 不做类型检查，所以"6 passed"照样绿，是 typecheck 抓出来的。**改的是 fixture，不是类型也不是断言**（这条记进台账，因为它是"测试全绿 ≠ 类型对"那一族的实测样本） |
| 2 test | `pnpm -r test` | **0** | 全绿（含本线新增的 `share-comment-draft-error` 6 枚、`share-open-pull` 7 枚、移动端 `share-signals` 16 枚、`share-ui-assembly`） |
| 3 本线 verify | `pnpm verify:collab-suite` | **0** | 全绿（含 `verify:collab-journey` 那条真浏览器腿） |
| 4 check | `pnpm check` | **1** | 链跑到**整套件 e2e**（`pnpm -r test` 那一环）才停，唯一红是 `e2e/tests/rail-roving.spec.ts:300`（dnd-kit Space 传感器与 roving tabindex 共存：`.ht-rail__item--dragging` 没清掉）。🔴 **不是本线的**：`git status --porcelain -- e2e` 空（那一侧此刻干净），spec 由 `7dea2de8b` 入库，且**已在 `BLOCKED.md` 在册两行**（现量 `grep -n "rail-roving" BLOCKED.md`）。⚠️ 归因做了一发单跑（`cd e2e && node ./node_modules/@playwright/test/cli.js test tests/rail-roving.spec.ts --grep "方向键不再挪焦点" --workers=1 --retries=0` ⇒ 同样 rc=1）⇒ **不是套件负载/并发**，是那一格本身；但这枚读数**没经过本机内存闸门**（环境陷阱 #567 那一族），所以它只支持"不是负载"这一句，不支持别的 |

**这一格不代改**：判据口径与 rail 那条线自己的用例绑在一起（本线只登记，不动它，也不把它读成"本线 check 绿"）。

---

#### 这一批还剩什么（逐格：谁做 / 判它的断言 / 为什么不在本批做完）

| 格 | 状态 | 判它的断言（能红的那把尺） | 归属 |
|---|---|---|---|
| **点立刻卸载的 `Pressable` 会把 App 崩掉**（第 28 跑那一发，#549 同签名） | 🔴 **未判定** —— 只有一发实测，同一发在第 26 跑没崩 | 断言必须是**可重复的**：同一台模拟器上连开/关共享面 N 轮（#549 用的是 6 轮 pid 不变 + `-newermt` 新增 `.ips` 数 0，含 `Retired/`）。拿不到调用名这件事本身已由 #549 证死 ⇒ 只能从形状消除（`Pressable` 的 `setPressed` 在 unmount 之后不许再派发）。**本批没做完是因为它需要先有一个稳定复现**，而一次崩溃不构成复现 | 本线（移动装置腿撞上的） |
| **Android 的 M6 设备腿** | 🔴 **载体半装，界面腿仍跑不了** —— 2026-10-27 现量把上一版那句"载体不存在"改准：`windows-pc` 上 `adb.exe` **在**（platform-tools 已装、daemon 起得来）、AVD **有一枚**（`%USERPROFILE%\.android\avd` 里 `opp-smoke.avd`），**缺的是 `Sdk\emulator` 那枚主程序** ⇒ 那枚 AVD 起不动，且 `adb devices` 空（没插真机）。三条取法都在 `ssh windows-pc` 上跑：`if exist "%LOCALAPPDATA%\Android\Sdk\emulator\emulator.exe"`（NO）、`dir /b "%USERPROFILE%\.android\avd"`（有）、`adb devices`（空表）。⚠️ 远端默认 shell 是 **cmd**，用 bash 语法探它会打出"系统找不到指定的路径"，那条不是否证（本轮先撞了一次）。⇒ 解锁差的是一段**装机动作**（补 Google 的 emulator 组件，或插一台真机），不是排期 | 两格分开看：①**出包腿已过** —— `scripts/run-gradle.mjs` 在 `windows-pc` 上打，四条身份判据（工作树 tar 对账 / 旧产物清除 / mtime ≥ 构建起点 / 拉回后 sha256 逐字相同）当轮全过，读数见 §9.13；②**界面腿没有装置** —— 与协作旅程对应的那枚装置只有 iOS 一份（现量：`ls scripts/verify*collab*`），而现存的 Android 设备装置 `verify-android-vault-storage.sh` 用的是**本机** adb（`ANDROID_HOME` 默认 `/opt/homebrew/…`）+ `emulator-5554`（现量：`grep -n ADB_BIN scripts/verify-android-vault-storage.sh` 与同一文件里的 `SERIAL=` 两格各看一次）⇒ 它的形状与"Android 一律走 `ssh windows-pc`、不在 Mac 起模拟器"那条长期令**直接冲突** | 要么新写一枚驱动远端设备的 Android 旅程装置（含"服务端在另一台机器上、设备要够得着"那一格），要么按出包 + JS 侧形状读数结案 —— **归产品负责人拍**，本线不自行把"编译过"读成"Android 已验" |
| **手机自己「开启共享」那一格**（含「手机用户能建清单」） | ✅ **本批闭合**（2026-10-26 第 35 跑，`run-rc=0`） | 装置第 10b 步 L7：手机自己建清单 → 设为共享（owner 一侧同意闸）→ 签发邀请 → 服务端读形状（`node scripts/lib/collab-owner-step.mjs phone-owner`：`role=owner` + 所有者行带 `signingPublicKey` + 活邀请数）→ 撤销回到无邀请态 → 首页两份并排。逐格读数与四张截图在上面「第 35 跑新增的两格」那张表。⚠️ 第 33 跑那发 `exit 3` 的教训登记为环境陷阱 **#579**（装置的"前提不成立"可能就是产品定义里没走过的那一格） | 本线 |
| **同意面文案的视角**（owner 语 vs 入群语） | 待拍板 | 判据在 `packages/i18n/src/locales/zh-CN.ts` 的 `common.share.consent.body` / `.accept` 两行；理由与截图指针在 ADR-0071 补记末段 | **归产品负责人** —— 属于对外法律表征，本线不代改 |
| **登出 / 撤销要不要连带清 share 那几格** | 待拍板 | 现量：`clearMobileVaultSession` 今天只删 root key（`grep -n "clearMobileVaultSession" apps/mobile/src/**/*.ts`） | **归产品负责人** —— 是"清掉用户资产"这种不可逆取向的取舍 |
| **`04e-保险库已解锁.png` 里那枚圆圈** | 未判定 | 截图只证外观；要判的是"那一枚在该屏该不该在场"，得回账号安全线的那块界面自己说清 | 归账号安全线（本线不代定性） |
| **别线存量三枚「侧栏」文案**（`common.organizer.confirm.impactChildren` / `.impactChildrenArchive` / `common.trash.confirm.strandChildren`） | 已登记在册，**不代改** | `apps/mobile/tests/share-ui-assembly.spec.ts` ⑥ 的债表 `OTHER_LINE_DEBT`：只许变短，修好了不删名目也判红 | 归回收站/归档那条线 |

### 9.15 M6 移动端「按本机偏好打扰用户」那一半 + 便签那一族的设备腿（2026-10-26 第九批，第 36–40 跑）

**这一段判的是哪句话**：产品定义里那句「收得到实时信号并**按本机偏好打扰用户**」——
上一批把投递那一半做完了（闸门→活动差集→内存动态），这一格量的是**有没有人消费它**。
现量起点（钉在本批那笔实现之前一个提交上，工作树在动不许拿它当锚）：
`git grep -n subscribeShareActivityFeed 173f5110f^ -- apps/mobile/src | grep -v share/share-activity-notify.ts`
⇒ **无输出**（零消费者；`mobile.inbox.tab.share` 等三枚词条在册无消费者）。
同一枚查询换成 `HEAD` 再跑一遍读得到消费者（形状：两屏各一处 import + 一处订阅调用）——
这条查询两头都可复跑，别把某一轮的条数抄进下一段散文里。

#### 本批改的四件事（每件都带一枚能红的判据）

1. **投递那一刻就把正文拼好**：`ShareActivityFeedEntry` 多一枚 `body`，
   `labels.body` 的签名从 `(kind)` 改成 `(shareId, kind)` —— 不带 `shareId` 就查不到那一行清单，
   动态只能永远说匿名那句。口径仍只在 `@heyta/ui` 的 `shareActivityNotificationBody`（ADR-0071）。
2. **"挑哪句 / 插什么变量"从装配闭包里搬出来**：新增 `apps/mobile/src/lib/share-activity-copy.ts`。
   留在 `App.tsx` 的闭包里就只能用源码文本判 —— 本批变异臂实测：把传名字那行换成 `undefined`，
   **零条行为断言红**（只红一条文本断言）。教训记在环境陷阱 #581。
3. **通知中心补第三档「共享动态」**（`NotificationsScreen.tsx`）：订阅动态、**打开这一档才清未读**、
   逐条画 `entry.body` + 时间，底下那句「只存本机、重启后清空」如实说。
4. **「我的」入口徽标 = inbox 未读 + 共享动态未读**（`ProfileScreen.tsx` 的 `inboxBadge`）。
   系统横幅今天做不到（本机唯一那条原生通道被提醒链按 `categoryIdentifier` 全量回收，
   新开 category 要重装两端 = 别线在飞资产），所以**这一枚徽标是当下唯一的打扰面** ——
   它只数 inbox 就等于那一档没人会去点。本批真犯过"三处引用只改了两处"，判据当场抓住，
   记在 #582；装置臂 `badge-not-summed` 现在钉着它。

顺带修掉一处**注释与代码不一致**：`installMobileShareActivityDelivery` 原先"装过就直接 return"，
注释却写"换的是标签与端口" ⇒ 语言切换后每一条新动态仍在说切换前的语言。现在先摘旧订阅再订新的。

#### 判据与变异臂

判据本体：`cd apps/mobile && npx vitest run tests/share-ui-assembly.spec.ts`（⑦ 组四枚 + ⑧ 组四枚，
条数现量看它自己打印的 `Tests N passed`）。

🔴 变异臂已从**手工那五发**收成一副可复跑装置：
`node research/tools/mutation-rigs/mutate-collab-mobile-activity.mjs` ⇒ 读数 `ARMS=pass (4/4)`
（本批 2026-10-26 现量：基线 24 passed、四臂红集精确匹配、复跑 RC=0、无 `.mut-bak` 残留）。
四臂与各自红几枚：`name-never-read` 4 / `stale-labels` 1 / `body-empty` 4 / `badge-not-summed` 1。
⚠️ 首跑两臂**红集漂移**（预测 2/3、实测 4/4）：多出来的那三枚逐条读过源码后确认**该红**
（它们断言的就是"带名字的正文"与"插值变量只有 `name`"这两件事本身）⇒ 收紧的是预测，不是判据。
⚠️ 本批早先那五枚**手工**变异（A 5 红 / B 2 红 / C 1 红 / D 1 红 / E 1 红）的编辑只活在一次性
scratch 目录里，随清场消失 ⇒ **不写进台账当锚点**，锚只有上面那条命令（§9.14 那一族的老账，第二次犯）。

#### 设备腿 L8 / L9（装置第 10a / 10c 步）跑次归因

| 跑 | 退 | 红在哪一格 | 归因 |
|---|---|---|---|
| 36 | 3 | 第 10a 步「翻开关前那一步」 | **装置** —— L8 第一半结束时人停在「共享动态」那一档，而开关在共享首页的偏好面板里 ⇒ 补一段回偏好面的导航（`back_to_anchor` + `ax_press_until` 到 `share-notif-activity-added`）。不判产品。（那趟取证 `apps/mobile/evidence/collab-ios-10260907/` **只在本地、不入库**：它是退 3 的一趟，没有产品读数，台账要的是这一格归因而不是那批截图） |
| 37 | 0 | — | **53 通过 / 0 失败**（取证 `apps/mobile/evidence/collab-ios-10260922/`）。L8 两半第一次都绿，但**读数不唯一**：那句正文里的名字是「共享清单」，而手机上那一行的名字也是「共享清单」（入群时名字框空着 ⇒ 走 `web.share.join.defaultName`）⇒ "名字是从本机行上来的"与"句子写死了一份"两半同形，这一格等于没判 |
| 38 | 0 | — | **55 通过 / 0 失败**（取证 `apps/mobile/evidence/collab-ios-10260954/`）。入群时把名字框填成带当趟戳的 `本机清单<STAMP>` ⇒ 两半不再同形，正文读出来是「有人在你参与的共享清单「本机清单10260954」里写了新内容」；新增那枚对照（那一行的名字必须等于入群时填的）也在场。⚠️ 通过数 53→55 那两枚增量是"名字框那次 `fill_field` 的成功读数 + 这枚对照"，不是多出两条腿 —— 腿仍是 L1–L8 |
| 39 | 0 | — | **56 通过 / 0 失败**（取证 `apps/mobile/evidence/collab-ios-10261842/`，20 张截图）。+1 那枚就是本批新加的 **L9（装置第 10c 步）第一次真机读数**：owner 侧用生产装配件写进那份共享清单的便签，出现在手机「我的 → 便签」那块板上，全程没点同步 ⇒ 走的仍是 `new_share_ops` 那条信号。⚠️ 这一趟**第一发在装包之前被新鲜度尺拦下**（`run-rc=3`：别线把 `@heyta/op-log` / `@heyta/sync-core` 的 `src` 提交了、`dist` 落后 ⇒ #576 那一族的第三次实测，照它打出的命令补 `pnpm --filter @heyta/op-log --filter @heyta/sync-core build` 后重发，没烧设备）。L8 两半、L7（手机自建清单→开共享→签发→撤销）、L2/L3/L4/L5/L6 在同一条链上一起复绿 |
| 40 | 1 | 第 10c 步 L9 | 🔬 **变异臂那一趟，红是预期**（不是回归）：把「物化时丢掉便签那一族」注回 `share-replay.ts` ⇒ 整链 `55 通过 / 1 失败`，红集**只有 L9**（L1–L8 全绿）⇒ L9 的绿有信息量。逐字节还原凭据与"取证目录不入库"的理由写在上面 L9 那一节 |

**L8 两半为什么必须相反**（判据本体，别只读一遍就放行）：

| 半 | 前置 | 判据 | 控制读数 |
|---|---|---|---|
| 一 | 偏好全关（本装置每趟 `simctl uninstall` ⇒ 磁盘上必是默认全关） | owner 写一条评论 ⇒「共享动态」那一档**是空的** | 同一条评论**本身**在手机上出现（`wait_tree`）⇒ 静默只可能是闸门，不是"信号根本没到" |
| 二 | 翻开『新增内容』那一档 | 同一种信号**再发一次** ⇒ 那一档里出现那句带清单名的话 | 第二条评论同样先在评论区等到 ⇒ 与第一半只差偏好那一格 |

⚠️ 这一格判的**不是**「owner 改的清单名会不会同步过来」—— 入群时那个名字框写的是「仅本机显示」，
本机行名只在本机生效；名字取不到时落匿名那句由 ⑧ 那两枚用例钉着，不归设备腿。

#### M5 那三格本批没有重开（逐格现量，别照上一批的文字推断）

| M5 那一格 | 本批现量 | 结论 |
|---|---|---|
| 面板 3s 轮询 ⇒ 信号驱动 | `grep -rn setInterval packages/ui/src/sync/` ⇒ 零命中（整族面板都没有兜底定时器，不只 SharePanel 那一枚）；名册信号在册（ADR-0070） | ✅ 上一批已结案，本批未动 |
| 通知内容口径 | 口径唯一出口 `shareActivityNotificationBody`，本批把**移动端那一半接上消费者** | ✅ 由 ADR-0071 立着，本批是补消费面不是改口径 |
| 两枚谓词的数据面 | 全仓 `grep shouldNotifyTaskReminder` 与 `shouldAutoAcceptInvitation` 只在**文档**里命中（三份计划/交接书），代码零命中；钉子 `packages/ui/tests/notification-model.spec.ts:14` 断言默认偏好只有 `activities` 一个键 | ✅ 按「撤下」结案（它们没有输入），本批按现量重核过那句理由仍成立 |

#### 本批审计时补的一格：便签那一族（L9，装置第 10c 步）

写完 L8 之后按产品定义那句逐族对账：「任务/便签/评论**三族**与另一台设备双向同步」——
设备上被看见过的只有**任务**（L2）与**评论**（L3/L5），便签那一族从没在手机上量过。
它在宿主层是通的（`verify:collab-sync` 把三族都收进共享日志），漏的是设备腿自己 ——
与 §9.14 那一族"两把尺都绿、设备上那一格没量"同一个形状，只是这次漏的是装置。

- **L9 判什么（下行）**：owner 用生产装配件往那份共享清单写一条便签 ⇒ 手机上「我的 → 便签」
  那块板上必须出现这一条，全程不点同步（走的仍是 `new_share_ops` 那条信号 +
  `NotesSection` 订阅的 `dataRevision`）。载荷三格逐字照 `packages/app-host/src/note-actions.ts`
  那行真客户端写的（`content` / `projectId` / `isPinnedToToday`），装置不自创形状（#577 那一族）。
- **到达锚为什么是 `notes-submit`**：`mobile-notes-board` 与 `note-row-*` 都是裸 `View`，
  按 #575 那一族不进 AX 树 —— 拿它们当到达判据会恒不命中且不区分原因。
- **失法分档**：判红之前先数板上读得到的静态文字条数并打进日志（`-1` = 树读不出 ⇒ `env_bail`，
  不拿"没读到"当"没回流"），这样"那块面没渲染"与"有别行独缺这一条"不用重跑就能分。
- **L9 的变异臂（第 40 跑，2026-10-26）**：拿真缺陷类注回去 —— 在 `packages/app-host/src/share-replay.ts`
  那条物化循环里加一行 `if (op.entityType === 'NOTE') continue;`（＝手机收得到共享日志里的便签 op，
  但物化时丢掉那一族）。整条链重跑 ⇒ **`55 通过 / 1 失败`、退 1**，红的那一枚**只有 L9**，
  L1–L8 照旧全绿 ⇒ 这一格量的确实是便签那一族，不是"整条链一起塌"。
  失法分档也按设计工作了：日志读出「板上静态文字 4 条，独缺这一条」（不是 `-1`）⇒
  "那块面没渲染"与"有别行独缺这一条"当场分得开。还原走 `.mut-bak`，
  还原后 md5 与 `git show HEAD:packages/app-host/src/share-replay.ts | md5 -q` 逐字节相同、
  `MUT-ARM` 零命中、`.mut-bak` 已删，并复跑 `pnpm --filter @heyta/app-host test` ⇒ `121 passed`。
  ⚠️ 这一趟的取证目录 `apps/mobile/evidence/collab-ios-10262112/` **只在本地、不入库**：
  它是故意红的一趟，没有产品绿读数，台账要的是上面那三句（红集 / 特异性 / 还原凭据）而不是 4 MB 截图。
- **第 39 跑读数（2026-10-26，`run-rc=0`）**：owner 侧那条便签在手机上**肉眼复核过**——
  `20-owner的共享便签到手机.png` 里那块板画出一行「owner写的共享便签10261842」，
  带「钉到今天」「删除便签」两个动作（⇒ 不是只进了 AX 树的空节点，是走完整条渲染）。
  同一趟 L8 两半也各自有图：`18-偏好全关时共享动态为空.png` 是那句空态「还没有共享动态」，
  `19-共享动态里那句带清单名的话.png` 是「有人在你参与的共享清单「本机清单10261842」里写了新内容」
  —— 两半只差偏好那一格，控制读数（评论本身先到手机）在同一条链上。
- ⚠️ **这一格证到哪、没证到哪**：那块板画的是 `listNotes()` 的**未筛选全集**
  （`apps/mobile/src/screens/NotesSection.tsx` 的 `read()`，切分组时递给回落的也是全集），
  所以 L9 绿说的是「便签那一族的 op 在手机上解得开、物化得了、画得出来，而且没点同步」，
  **不是**「这条便签归在那份共享清单名下」。归属那一格到 2026-10-27 才有界面（第十批那枚落点选择器，见 §9.16），
  而 L9 这一格量的是"解得开、物化得了、画得出来"——两件事各自有各自的判据，别互相顶。
  别把 L9 的绿读成"便签按清单归好了"。

🔴 **那一格到 2026-10-27 已经补上**（第十批）：新建时的归属控件落地 —— 共享层 `CaptureSubmitPlan.projectId` + `CaptureComposer` 的 `projectPicker` + 便签板复用同一份形状，设备腿 **L10**（任务）/**L11**（便签）各有真机读数与一条到达判据 ⇒ 逐格见 §9.16。
**边界挪了一格、没有全清**：把一条**已有**便签改归属（`setNoteProject`）在两壳依旧零调用点（现量 `git grep -n setNoteProject -- 'apps/**/src/**' 'packages/**/src/**'` ⇒ 只剩接口声明与实现这两处。⚠️ 别拿整个 `apps` 当分母：那里混着 `apps/web/dist` 的 bundle，读出来不是零）—— 本批改的是"新建时落进哪一份"，不是"事后改归属"。
`setNoteProject` 这个宿主动作在 `apps/mobile/src` 与 `apps/web/src` 都是**零调用点**
（现量 `git grep -n setNoteProject -- 'apps/**/src/**' 'packages/**/src/**'` ⇒ 只剩接口声明与实现这两处、零调用点。⚠️ 别拿整个 `apps` 当分母：那里混着 `apps/web/dist` 的 bundle，读出来不是零）⇒ 两壳同缺一个界面入口。登记在下面那张"还剩什么"表里，
归**要新界面**那一档，不当成本批能顺手补的判据。

#### 四把尺现量（2026-10-26，串行一条链，逐枚带 rc）

| 尺 | 命令 | rc | 读数与归因 |
|---|---|---|---|
| 1 typecheck | `pnpm -r typecheck` | 0 | 当趟（2026-10-26 11:19 那串链）全包过。要现量就重跑这条 —— 它不带状态，别的线提交了什么只影响它自己那几枚 |
| 2 test | `pnpm -r test` | 0 | 当趟 21 枚 workspace 包的 `Test Files` 全是 `passed`、那一段里 `N failed` 零命中（⚠️ 逐包条数只在一次性日志里，台账不把它当现量锚 —— 按 #577 那条教训，指得动的只有上面这条命令） |
| 3 本线 verify | `pnpm verify:collab-suite` | 0 | 当趟 `SUITE=OK legs=4 failed=0`（sync 14 步 / revoke 8 步 / conflict 6 步 / journey 3 步）。这条命令本身就是可复跑的载体，不依赖那次日志 |
| 4 check | `pnpm check` | 1 | 红在 e2e 那一段：`8 failed / 412 passed / 2 skipped (42.5m)` —— `assistant-navigation-acceptance` 3 枚、`category-dialog-ux` 1 枚、`inbound-automation` 4 枚，**没有一枚是本线的**（本线那几套 `verify:collab-*` 与 `share-*` spec 全在这段里绿着）。**当场做了归因实验**：链停后单独复跑这三份 spec（`pnpm --dir e2e exec playwright test tests/category-dialog-ux.spec.ts tests/inbound-automation.spec.ts tests/assistant-navigation-acceptance.spec.ts --workers=1 --retries=0`）⇒ **`24 passed (1.4m)` 全绿**，而跑大链时工作树里带着别线**未提交**的 `apps/web/src/features/admin/*`、`packages/i18n/src/locales/*`、`packages/app-host/src/admin-client.ts`、`e2e/tests/admin-console.spec.ts` ⇒ 读成 #567/#576 那一族（负载 + 一台机器一份 `dist` 里混着别人的件），**不读成本线回归，也不替那三条线定性**（要它们自己在干净树上跑一遍才有判决）。⚠️ 顺手抓到一条**结构性的**：`pnpm check` 是 `&&` 链，而 `check:shell-unicode` 这些门**排在 e2e 之后** ⇒ e2e 一红它们整批没跑过。本批因此单跑了 14 把静态门补上（`gate-wiring / evidence-hygiene / script-snapshot / journey-coverage / collab-carrier / ios-ax-shim / locator-labels / verify-script-copy / shell-unicode / shell-exit-chain / docs / doc-citations / md-tables / doc-command-claims`）⇒ 13 绿，唯一那枚红是 `check:shell-unicode` 指本线装置脚本两处 `$VAR` 紧跟全角标点（2026-10-25 那批留下的，因为排在 e2e 之后从没被跑到过）——**本批已按它给的修法补成 `${UDID}` / `${STALE_PKGS}` 并复跑**；同一把门剩下的红在 `server/scripts/caddy-sync.sh`（别线资产，登记不代改） |

#### 这一批还剩什么（逐格：判它的断言 / 为什么不并进本批）

| 格 | 状态 | 判它的断言 | 归属 |
|---|---|---|---|
| **手机上的系统横幅（通知中心之外那一档）** | 🔴 **今天做不到，且不打算在本批做** —— 本机唯一那条原生通道被提醒链按 `categoryIdentifier == "heyta.reminder"` 全量回收；新开一枚 category 要改原生壳 + 重装两端，那是别线在飞的资产。（2026-10-26 按现量重核过这句还成立，分母是移动壳那几枚原生件：`git grep -n "categoryIdentifier\|heyta.reminder" -- apps/mobile` ⇒ iOS `AppDelegate.swift` 两处按 category 过滤 + `HeytaReminderModule.swift` 那枚 `static let category`，Android `ReminderModule.kt` 的 `CHANNEL`/`PREFS` 单通道；全壳只有这一族原生通知代码） | 没有断言 ⇒ 所以**不写成缺陷**，写成边界：`systemBanner` 端口留着可注入（`ShareActivityDeliveryPorts`），装配点不传它 | 归"通知通道归属"那一格（提醒线）；本批只把界面上能做的两档做完 |
| **Android 的界面腿** | 🔴 仍跑不了 —— 载体的准确形状（`adb` 与一枚 AVD 在、缺 `Sdk\emulator` 主程序、无真机接入）与三条取法在 §9.14 那一格；2026-10-27 按现量把原先那句「载体不存在」改准了 | 出包腿在册（`ssh windows-pc`），界面腿没有 | 负责人长期令：一律 `ssh windows-pc` |
| **手机把一条便签写进那份共享清单**（三族里的便签·上行） | ✅ **2026-10-27 第十批做完**：便签板挂了 `CaptureProjectPickerRow`，`createNote(content, { projectId })` 交得出选中的那一行；设备腿 **L11**（装置第 10e 步）判到 owner 侧读回并验签 ⇒ 读数在 §9.16 | 装置第 10e 步那四格（入口在场 ⇒ 按得动 ⇒ 标题改口 ⇒ owner 侧 verified） | —（**事后改归属**那一格仍缺，见上面那段） |
| **手机把一条任务写进那份共享清单**（三族里的任务·上行） | ✅ **2026-10-27 第十批做完**：形状就是本行原本拍定的那一枚（在移动端添加面板里加「清单」选择行，默认收集箱，选中才交 `projectId`；便签板同形）。落地细节、为什么不靠颜色说话、以及装配判据在 **§9.16**；设备腿 **L10** 判到 owner 侧读回并验签 | 装置第 10d 步那四格 + `capture-project-assembly.spec.ts` 四组 + `capture-model.spec.ts` G/H 两组（条数各自现量，别在正文抄数） | — |
| **桌面三枚壳接不接这条信号** | 不在 M6 授权范围（§9.14 已改口为"读者有两枚壳"） | 反查 `grep -rn "createHostRealtimeClient(" apps packages` | 归桌面那条线 |

⚠️ **为什么不并进 `docs/plans/launch-blockers.md`**：那一格卡的是"打扰强度"，不卡发布 ——
应用可以带着"只有应用内那一档"上线（ADR-0062 实施记录第 7 条就是这么写的）。
把它登进收款/备案那本账会把一条产品边界读成一条发布阻塞，那本账的读者要的是后者。

### 9.16 M6 移动端「这条新建落进哪一份清单」那枚控件 + 任务/便签两族的上行设备腿（2026-10-27 第十批，第 41–51 跑）

#### 这一批补的是产品定义里最后那半句

产品定义写的是「任务/便签/评论**三族**与另一台设备**双向**同步」。第九批结束时：三族的**下行**在设备上都有读数（任务 L2 / 评论 L3·L5 / 便签 L9），**上行**只有评论那一族真走过。缺的不是判据，是界面上那枚控件 —— 手机上建任务与建便签的两处调用点都不交 `projectId`，新条目一律落收集箱，于是"手机把一条东西写进那份共享清单"这件事在任务与便签两族上**根本做不到**（§9.15 末那张表登记的就是这一格）。

#### 落地的形状（为什么是这个形状）

- **共享层**（`packages/ui/src/capture/model.ts`）：`CaptureSubmitPlan` 多一个可选 `projectId`（省略 = 收集箱）；`withCaptureProject` 把 `null` / `undefined` / 空串一律写成**不带这个键**，与 `toCaptureSubmitPlan` 对 `dueDate` 的约定同一条；`captureSelectedProject(picker)` 是**唯一**那枚"此刻生效的落点"查询 —— 提交与那一行的标题共用它，所以选中那一枚已不在册（面板开着时另一台设备把清单删了）时两处一起回退成收集箱，不会出现"界面念着落进 X、东西却建进收集箱"。
- **组件**（`CaptureComposer`）：新增**可选** prop `projectPicker`（受控：状态住宿主，组件只画与回传）。🔴 两条提交路（规则解析的 `submit` 与 AI 的 `apply`）**都**过 `withCaptureProject` —— 只接一条会得到"手打的能选清单、AI 建的不能"。宿主没给 picker 就一行都不画（web 因此零变化）。
- **选中态不只靠颜色**：那一行的标题念此刻的落点（未选「新建落进收集箱」/ 选后「新建落进「X」」），芯片的实心底色只是冗余的一层。无障碍名是**整句**词条（`落点选为「{name}」`），不拿前缀拼裸名。
- **两壳接线**：`TasksScreen` 的新建面板（关掉即重置落点）、`NotesSection` 的便签板（清单列表订阅 `dataRevision`，共享内容回流不重挂也看得见）。🔴 宿主**不许**拿"当前选中的那一行"替用户补落点 —— 手机上没有侧栏选中态，那等于悄悄改变一条任务的归属。
- **web 为什么没接**：不是漏 —— `apps/web/src/features/capture/CaptureComposer.tsx` 里那句「**打开某个清单时新建的任务必须留在清单里**」（现量 `grep -n "必须留在清单里" apps/web/src/features/capture/CaptureComposer.tsx`）写明 web 的落点由侧栏选中那一行给；手机上没有那一行，才需要一枚显式选择器。两壳是两种形状，不是两端一有一缺。
- 词条 6 枚 × 两份 locale（`mobile.capture.project.*`）。

#### 判据（每格都先证明能红）

| 判据 | 钉的是哪一格 | 位置 |
|---|---|---|
| `capture-model.spec.ts` G 组 3 条 | 带值 / 三种空值都不带这个键 / 不改入参 | `packages/ui/tests/` |
| `capture-model.spec.ts` H 组 3 条 | 没选 / 选了在册 / 选中的已不在册 ⇒ 都回退成收集箱；宿主没给 picker 不炸 | 同上 |
| `capture-project-assembly.spec.ts` 四组装配判据（条数现量：`cd apps/mobile && npx vitest run tests/capture-project-assembly.spec.ts`） | 两条提交路都过、任务面板交得出 `projectId`、便签板交得出、两屏都真渲染那一行且标题念的是此刻落点 | `apps/mobile/tests/` |
| 设备腿 **L10**（装置第 10d 步） | 真机上：入口芯片在场且默认念收集箱 ⇒ 按得动、标题改口成那份共享 ⇒ 提交后 **owner 侧从共享日志读回并验签 = verified** | `scripts/verify-mobile-collab-ios.sh` |
| 设备腿 **L11**（装置第 10e 步） | 便签那一族的同一串（与 L10 逐格对称） | 同上 |

#### 这一批改的是一行源码，红的是别人钉住这行的判据（涟漪，已按"各管各的不变量"收）

`NotesSection.tsx` 里那句 `return runAdd(actions.createNote(content));` 被**两枚**判据按字面钉住：提醒线的接线判据（`reminders-notes-display.spec.ts`，它要钉的不变量是"onAdd 的失败必须走 `runAdd` 交回共享层，不许 `run` 吞 reject、不许静默 return"）与本线的装配判据（`capture-project-assembly.spec.ts` ③，它要钉的是"落点交得出去 / 没选时交 `{}`"）。给 `createNote` 加第二枚实参（+ prettier 换行）⇒ `pnpm -r test` 当场红在**别人**那一枚上，红字把"实参表变了"解释成"回调没接上"。修法**不是**把两处都换成新字面（下一次改实参表还要再踩一次，而那个不变量根本没动），而是把提醒线那枚的针脚收窄到它自己那格：`/return runAdd\(\s*actions\.createNote\(/`（不吃实参表），落点那一格只由本线那枚钉。⚠️ 这不是放宽 —— 三枚坏形（`run(...)`／静默 return／不 return）在新针脚下逐条实测为 `false`，改完该文件 19 passed。教训入仓内环境陷阱 **#588**（含动手前的"一行几主"现量命令）。

⚠️ 同一趟还量到一件**要如实记下来的事**：那两行少收尾 `|` 的红是在 `pnpm -r test` 里露出来的（消费者是自动收集线的 `research/tools/verify-inbound-doc-tables.py`，它打印"登记表 29 份 + 本线追加 4 份 = 33 份"，本计划在登记表里）。但**本线自己那枚 `check:md-tables` 同样抓得到这一枚失法** —— 现量对照（本批当场做的：临时去掉第 48 行的收尾 `|` ⇒ `pnpm check:md-tables` rc=1、报 `docs/plans/collaboration-shared-lists.md:<行> 列数 3（本表表头是 4）`；还原后 rc=0，改前改后 md5 逐字相同）。⇒ 上一会话那句"第 46 行写完后 `check:md-tables` rc=0"是**取数早于落笔**的读数（那一行当时就漏了收尾竖线）。教训：台账里"我跑过 X 且绿"这类句子只对取数那一刻的文件状态成立，改过文件要重取（与 #529 同族 —— 那条讲的是句子变旧，这条讲的是**读数比句子更早**）。

#### 装置那一腿先红了一次（不是产品红）

第 41 跑 L10 报「界面上有那枚芯片却按不动」，五发全报"没有逐字叫…的可点节点"。**截图现场相反**：任务已经建进收集箱、面板已关 —— `ax_press_until` 每一发之前先 `dismiss_keyboard`，而 shim 的收法是按键盘的 **return 键**，RN 输入框把 return 当 `onSubmitEditing` ⇒ 第一发就把这条任务提交了。同一条禁令本来就写在同一份装置文件头，却被 `ax_press_until` 里那一发绕过（**注释不是守卫**）。修法：有表单的屏只许用新增的 `press_in_form`（不碰键盘，直接按解析出的坐标）。⚠️ 那一步还有第二条独立失法：它的到达判据用的是输入框里那串标题，而那串字在按之前就在场 ⇒ 恒真。本批把到达判据换成**只有按下之后才出现**的那句（那一行的落点标题）。两条都进仓内环境陷阱 **#586**。

#### 一枚共享层字段的名字撞进别线的词表（改名，不动他们的表）

并行会话跑全量 `pnpm check` 时把这枚红登记在 `BLOCKED.md` 的 B233（2026-10-27 那一枚，不是 10-18 同号那枚）：`check:selection-single-source` **断言 F** 点名 `packages/ui/src/capture/model.ts`——"接了选中 id 却没在 F 的任何一张表里"。现量成因是那枚门**按名字**认声明者（`SELECTION_ID_PROPS = ['activeTaskId','activeNoteId','selectedId']`，凡文件里出现 `readonly <那一枚>:` 就算），而我这格的语义是**新建表单的落点**，不是"列表里当前选中的那一行"。

三条出路里选了改名：① 进 `FACES` 不成立——`model.ts` 不渲染，那条要求文件里出现 `aria-…={谓词}`；② 进 `RELAYS` 也不成立——那张表要求文件真的用 JSX 把某个选中 id `p={…}` 往下递，而 `model.ts` 是一枚**契约类型**，既不"算"也不"递"；③ ✅ 字段改名 `destinationId`（7 处、5 枚文件），并把"为什么不叫 `selectedId`"写进 `model.ts` 的注释，防下一位顺手统一命名。🔴 全程没动他们的 `FACES`/`RELAYS` 与判据口径（那是别线资产）。"不许只靠颜色说选中"这一格改由**本线自己钉**：装配判据多一条 `it`，钉 `const on = picker.destinationId === id` 与 `aria-selected={on}`（摘掉那条属性、或把值换成常量，都红）。

**断言 G** 随后红在我自己新加的两枚状态（`TasksScreen` 的 `projectId`、`NotesSection` 的 `newNoteProjectId`）——那一格**自带登记扩展点**（"是 5 类瞬态之一 ⇒ 在 `ROW_ID_EXEMPT` 里登记一行并写明是哪一类"），收款线那两枚 `tierId` 就是这么登记的 ⇒ 按它规定的类 `form-draft` 登记自己那两枚，是用它的扩展点，不是改它的判据。

读数：`pnpm check:selection-single-source` rc=0；改名后重打 `@heyta/ui` 的 dist、`pnpm --filter @heyta/ui --filter @heyta/mobile typecheck` rc=0、装配判据 13 条全过（12→13 就是多出的那一条）。

#### 设备腿跑次归因（第 41–51 跑）

| 跑 | 退 | 红在哪一格 | 归因 |
|---|---|---|---|
| 41 | 1 | 第 10d 步 L10 | **装置自造红**（上面那一节：`dismiss_keyboard` 的 return 把表单提交了）⇒ 修 `press_in_form` + 换到达判据，不判产品 |
| 42 | 0 | — | **60 通过 / 0 失败**（取证 `apps/mobile/evidence/collab-ios-10270106/`，21 张截图）。L10 第一次真绿：`l10-task-signature.json` 里手机名下两行 = COMMENT + **TASK**，两行 `classify` 都是 `verified`，`matched=true` ⇒ 任务那一族在设备上真双向 |
| 43 | 1 | 第 10d 步 L10 | 🔬 **变异臂那一趟，红是预期**（不是回归）：把 `withCaptureProject` 退化成"原样返回、丢掉落点" ⇒ 设备上**只有 L10 红**（59 通过 / 1 失败），报的是「手机那一行名下解不出期望正文（名下行数 1；实体类型 COMMENT）」—— 任务落回个人日志，正是这一格要拦的失法。同一枚臂在单测层也**只有 2 枚**红（G 组那两条带值的）。还原：`cp` 回 `.mut-bak`，md5 `829a1fd5…` 与臂前逐字相同、`grep -c 'MUT:'` = 0、备份已删、`capture-model.spec.ts` 复跑 42 passed |
| 44 | 3 | 第 10e 步 L11 第一发 | **装置来路写错**（不是产品红，也不是环境缺前提）：L11 照抄 L9 用 `back_to_anchor`，可 L10 结束时人停在**任务那一档的根**上，那里根本没有顶栏「返回」⇒ 连报四次"本屏没有逐字叫「返回」的可点节点"后按 `env_bail` 退 3。同趟 L10 复绿，而落点那一行的排版改动（标题独占一行、芯片成组换行）在 `21-选好落点待提交.png` 里肉眼确认：选中那枚是蓝描边 + 蓝字、未选是灰描边，标题在它上面一行。修法：这一格改按底部「我的」标签过去（`id:tab-profile`），与 L9 的来路各自写清 ⇒ 第 45 跑 |
| 45 | 3 | 第 10e 步 L11 第二发 | **又是装置，但成因不同一枚**（仓内 #587）：`ax_press_until "id:tab-profile" "id:profile-entry-notes"` 五发都"按下了但树上没有落点"，而日志打出的当前屏顶部文字逐字就是「便签」—— L9 把「我的」那一档停在它自己的**内层屏**上，切回那一档**不等于**回到那一档的根（#571 的对偶形）。⇒ 改成"先量到达判据 `notes-submit`，不在才按那一行"，第 46 跑 |
| 46 | 0 | — | **63 通过 / 0 失败**（取证 `apps/mobile/evidence/collab-ios-10270202/`）。L11 第一次真绿：便签板上按同一枚落点芯片 ⇒ 那一行改口 ⇒ 提交 ⇒ `l11-note-signature.json` 里手机名下三行 （COMMENT + TASK + NOTE）`classify` 全是 `verified`、`matched=true` ⇒ **产品定义那句"三族双向"在设备上第一次逐族成立** |
| 47 | 1 | 第 10e 步 L11 | 🔬 **变异臂那一趟，红是预期**（不是回归）：把 `apps/mobile/src/screens/NotesSection.tsx:208` 那一行退化成永远交 `{}`（丢掉便签的落点）⇒ 设备上**只有 L11 红**（62 通过 / 1 失败），报的是「手机那一行名下解不出期望正文（名下行数 2；实体类型 COMMENT,TASK）」—— 便签落回个人日志，正是这一格要拦的失法；同趟 L1–L10 全绿 ⇒ 这一枚臂只切便签那一族，没有连带。同一枚臂在装配判据层恰好红 1 条（12 条里 11 通过）。还原：`cp` 回 `.mut-bak`，md5 `d3a3231c…` 与臂前逐字相同、`grep -c 'MUT:'` = 0、备份已删、`capture-project-assembly.spec.ts` 复跑 12 passed |
| 48 | 0 | — | **63 通过 / 0 失败**（取证 `apps/mobile/evidence/collab-ios-10270243/`，22 张截图）：**还原后的树**在设备腿上复跑，L10+L11 双绿 ⇒ 上一趟的还原是真的回到原物，不是"看起来对"。同一趟补上便签那一族的**绿路径图证** `22-便签选好落点待提交.png`（AGENTS §6.2 要真看截图）：标题独占一行念「新建落进「本机清单10270243」」、选中那枚是蓝描边蓝字、下面才是输入框与「添加便签」，owner 那条共享便签同屏在场（L9 的下行读数） |
| 49 | 3 | 第 2 步（构建前） | **环境档，不是产品红**：装置那枚新鲜度自闸拦下这一趟 —— `@heyta/op-log`／`@heyta/sync-core` 的 `src` 比 `dist` 新（两枚包对 HEAD 干净 ⇒ 是别会话提交了 src 而本机 `dist`（不入库）没跟着重打），装进 bundle 的会是旧产物。按它自己打印的命令 `pnpm --filter @heyta/op-log --filter @heyta/sync-core build` 补打后重跑 ⇒ 第 50 跑。⚠️ 这一形是本线改名（`selectedId`→`destinationId`）之后引出来的第一趟，所以那一趟**没有**读到改名后的界面 |
| 50 | — | **无判决**（不是红也不是绿） | 日志停在第 4 步、没有收尾那行 `RC=` ⇒ 这一趟被外力掐掉（当时同一台机器上有另两个仓的 vitest 套件在跑）。**不读成产品红，也不读成装置坏**；它留下一个空的取证目录（已删）与一枚相隔 1 秒的重复目录。判"跑完没"的尺是**收尾那行**，不是文件 mtime。重起的姿势与一个静默失手（macOS 没有 `setsid` ⇒ `nohup setsid … & disown` 整条空枪、脚本一次都没跑）入仓内 **#589** |
| 51 | 0 | — | **改名后的树第一次完整判决**：**63 通过 / 0 失败**（取证 `apps/mobile/evidence/collab-ios-10270817/`，22 张截图）。L10 与 L11 双绿 ⇒ `selectedId`→`destinationId` 那枚改名没把落点改坏（第 49 跑被新鲜度自闸拦、第 50 跑无判决，所以改名后的界面到这一趟才有设备读数）。肉眼复核 `22-便签选好落点待提交.png`：标题独占一行念「新建落进「本机清单10270817」」、选中那枚是蓝描边蓝字、未选那两枚是灰描边、owner 那条共享便签同屏在场（L9 的下行读数）。⚠️ 归因要写清：这一趟的 bundle 编译于本批最后那处**纯注释位移**之前 —— 那处只把样式表里"选中与否不能只靠颜色"那段 JSDoc 从 `projectWrap` 挪到它真正描述的 `projectChipOn` 头上，不动任何样式值、不动 JSX |

⚠️ **上面那张表里点名的取证目录只在本地、不入库**（同 §9.15 那条 ⚠️ 的口径）：每趟 20 余张 PNG、约 4.4 MB，而仓库另一侧的推送配额已经吃紧（[`progress-log.md`](../agents/progress-log.md) 那条「`gitee` 拒绝一切推送」）。⇒ 表格里的**逐格读数与结论**是入库的，截图与 `l10/l11-*.json` 是**本机产物**；下一位要复现就重跑 `pnpm verify:mobile-collab:ios`（它自己会新建一个带当趟戳的目录），别去仓库里找这些路径。

#### 改名后这棵树的四把尺现量（串行，逐枚归因）

| 尺 | 读数 | 归因 |
|---|---|---|
| `pnpm -r typecheck` | **rc=0** | 全仓过 |
| `pnpm test`（= `-r build` + `-r test`） | **rc=1**，红在 `apps/web`：`Test Files 4 failed / 205 passed / 2 skipped`、`Tests 8 failed / 2582 passed` | 🔴 **不是本线**。那 8 条全在同一枚成因上：`Error: Test timed out in 5000ms`（`calendar-sidebar` 4 条、`nav-next7-days` 2 条、`reminder-wake` 1 条、`task-sort` 1 条），而当时这台机器上有一趟别会话的浏览器重活持着内存闸门的独占锁（`uptime` 五分钟负载 48.05）。本线名下的包逐枚有读数：`packages/ui 51/51`、`apps/mobile 90/90`、`packages/i18n 4/4`、`packages/app-host 121/121`。`server` 那几行 `❯ … 23 failed` 是**进度行不是判决** —— pnpm 在 `@heyta/web` 处中止（`ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL`），那一趟没跑完 ⇒ server 侧本批**未判定**，不归本线也不替别线定性。✅ **补判（同日 `cd server` 单跑 `pnpm test`）：rc=0、`Test Files 177 passed (177)`、`Tests 3113 passed / 1 skipped`** ⇒ "未判定"只对首趟成立，server 现在有判决（那条超时归因不动） |
| `pnpm verify:collab-suite` | 首趟 **rc=1**（`legs=4 failed=1（journey）`）⇒ 单跑那一腿 **rc=0 / `RESULT=OK steps=3`**；另三腿首趟即 `sync 14 / revoke 8 / conflict 6` 全 `RESULT=OK` | 🔴 那一枚红是**闸门空等**，不是产品判据：三条现量在仓内 **#590**（它说"上方是失败用例与断言"而上方什么都没有、证据图 mtime 还是上一趟的、`decisions.log` 里最后一条是 `refuse-heavy … waited=900`）。⇒ 本线那四腿合起来是绿的 |
| `pnpm check` | **两趟都 rc=1，两枚红都在别线名下；整枚 check 的绿读数仍未取到。** 第一趟红在 `check:shell-unicode`，点名 `server/scripts/caddy-sync.sh` 里 `$name（` 与 `$CADDY_BIN）` 那两行（全角括号紧跟变量名 ⇒ 变量名被吞）。取数那一刻（10:5x）单跑那枚门已是 **rc=0**，而那两行正握在别人手里：`git diff` 的 `+` 侧已是 `${name}` / `${CADDY_BIN}`，`git show HEAD:` 那侧还是旧写法 ⇒ 链在那里断，其后各段没跑。⚠️ 上面那句只对取数那一刻成立：那一线 **10:59 把修法入库**（`c565b90cb`），当前 HEAD 上单跑该门 **rc=0**（现量 `pnpm -s check:shell-unicode`，它自己打印"扫了 git 看得见的 210 个 .sh"）。第二趟过了那一枚，红在 `screenshot:verify`：`6 failed / 2 skipped / 422 passed (43.3m)`，六条**全在同一份 spec**（`e2e/tests/auth-form-spacing.spec.ts` 的「登录档相邻控件 12px」两格 + 「验证码屏」四格，实测高 29px 撞 `≥ 44×44px` 那条），而那枚 spec 此刻在别人手里（现量 `git status --porcelain -- e2e/tests/auth-form-spacing.spec.ts` ⇒ ` M`）且它最近三笔都是 `界面/间距` 前缀。⇒ **补测（同机串行，逐枚）**：断链之后那 10 枚静态门各自单跑**全部 rc=0**（`check:downloads`、`check:release-version-guard`、`check:app-version`、`check:version-declarations`、`check:checkpoint-cadence`、`check:retention-window-parity`、`check:windows-signing-posture`、`check:i18n-vars`、`check:e2e-carrier`、`check:mobile-ai-anchors`）⇒ 整枚 check 那个 rc=1 **只由 `screenshot:verify` 那一格贡献**，链上其余各枚都有 rc=0 读数；`pnpm -r test` 那一腿由上一行单独量 | 🔴 **不是本线，也没有一条红落在本线的文件上**：本线名下那几枚（`check:ui-provider`、`check:selection-single-source`、`check:verify-script-copy`、`check:mobile-bundle`、`check:rn-aria`、`check:design`、`check:md-tables`、`check:docs`、`check:i18n-vars`）两趟都逐条过。两枚红按"各管各的不变量"**只登记、不代改**（改法归那条线的判据口径；同一枚根因的一般规律在 `BLOCKED.md` 里那条「共享工作树里 check 的退出码是 HEAD + 别人在飞的编辑」）。⚠️ 链尾那 11 段在两趟里都没跑到（`screenshot:verify` 把链断了），其中 10 枚静态门已按上一列逐枚补跑出 rc=0、`pnpm -r test` 那一腿另有读数 —— 但**整枚 check 的 rc 仍是 1**（那一格真浏览器用例没绿），**别把本行读成"check 绿"，也别读成"本线让 check 红"**；链的段数与位置每次自己量：`node -e "const p=require('./package.json').scripts.check.split('&&');console.log(p.length)"` |

#### 这一批的边界（挪了一格，没有全清）
| 格 | 现状 | 现量命令 | 归属 |
|---|---|---|---|
| 把一条**已有**条目挪进别的清单 | 🔴 仍零调用点。便签侧 `setNoteProject` 在两壳都没人调；任务侧手机上唯一能改的归属是象限 | `git grep -n setNoteProject -- 'apps/**/src/**' 'packages/**/src/**'`（⇒ 只剩接口声明与实现两处）＋ `git grep -n "setTaskProject\|moveTaskTo" -- 'apps/mobile/src/**'`（⇒ 只有 `moveTaskToQuadrant`）。⚠️ 别拿整个 `apps` 当分母，那里混着 `apps/*/dist` 的 bundle | 归"改归属"那一档新界面，**不是**本批那枚"新建时选落点"——别拿 §9.16 的绿读成它做完 |
| web 侧要不要也画这枚选择器 | 不画。web 的落点由侧栏选中那一行给（上面那条「必须留在清单里」的注释），手机上没有那一行 | `grep -n "projectPicker" apps/web/src/features/capture/CaptureComposer.tsx` ⇒ 无输出（宿主没给 ⇒ 组件一行都不画，这是装配判据 ① 第三格钉住的） | 两壳两种形状，刻意如此 |
| L11 的变异臂 | ✅ **两族上行各有各的臂**：任务那一族走共享层 `withCaptureProject`（第 43 跑那枚臂），便签那一族走宿主 `createNote(content, { projectId })` ⇒ 臂打在那一句上（现量 `grep -n 'actions.createNote(' apps/mobile/src/screens/NotesSection.tsx`） | 第 47 跑：那一行退化成永远交 `{}` ⇒ 整链**只有 L11 红**（62 通过 / 1 失败）、装配判据恰好红 1 条；第 48 跑还原后复绿（63 通过 / 0 失败） | 已闭合 —— 便签那一族不再是"看着接上了" |

#### §9.17 任务书逐格 ↔ 当前树上的真落点（收口对账，2026-10-27）

写这一节的用处不是再报一遍绿：**任务书里的名字与代码里的符号名不同名**，我按任务书的名字下探针时**四枚打空**（`ShareKeyStore`、`payloadCipher`、`installMobileShareActivityDelivery`、`createHostRealtimeClient` 在移动壳源码里都不是那一处的写法），而设备腿同一趟是绿的 —— 打空是探针猜错名字，不是那一段没接。⇒ 下一位复账**按这张表的真落点**取，别按任务书的措辞猜。

| 任务书那一格 | 真落点（文件） | 现量命令（2026-10-27 读数） | 判决 |
|---|---|---|---|
| 手机用户能建清单（并设为共享） | 装置第 10 段那一步在 `scripts/verify-mobile-collab-ios.sh` | `grep -c consent scripts/verify-mobile-collab-ios.sh` ⇒ 3 | ✅ 设备腿 L7（§9.14 那张表逐格有截图指针） |
| 能收邀请并加入 | `apps/mobile/src/screens/JoinShareScreen.tsx` | `grep -c acceptInvitation apps/mobile/src/screens/JoinShareScreen.tsx` ⇒ 1 | ✅ L1：手机上自己说出「加入成功」 |
| 三族路由（写侧该进哪本日志） | `apps/mobile/src/share/wiring.ts` 用 `packages/app-host` 的 `share-routing` | `grep -c share-routing apps/mobile/src/share/wiring.ts` ⇒ 1 | ✅ 判据本体只在共享层一处（AGENTS §3.5 宿主边界） |
| 归属写侧 `setProjectShareId` 调用点 | `apps/mobile/src/share/project-share.ts` | `grep -c setProjectShareId apps/mobile/src/share/project-share.ts` ⇒ 3 | ✅ 移动端唯一调用点，注释里就写着"唯一" |
| share 密钥落盘端口 | `apps/mobile/src/lib/share-key-store.ts`（实现 `ShareKeyStoragePort`，槽位是账号 scope 加 `#share-keys` 后缀） | `grep -c ShareKeyStoragePort apps/mobile/src/lib/share-key-store.ts` ⇒ 6 | ✅ L4 的私钥与密钥环都从这格落盘 |
| `payloadCipher` 接线 | `apps/mobile/src/share/share-session.ts` 里 `session.getPayloadCipher()` 交出去 | `grep -c getPayloadCipher apps/mobile/src/share/share-session.ts` ⇒ 1 | ✅ 没解锁时交 undefined、不抛（判据 `apps/mobile/tests/share-session.spec.ts`） |
| 同意态存储 | `apps/mobile/src/lib/share-local-store.ts` | `grep -c ShareConsentStore apps/mobile/src/lib/share-local-store.ts` ⇒ 5 | ✅ 与 web 同一道闸（§9.14） |
| 通知投递面接上界面消费者 | 装机调用点在 `apps/mobile/src/App.tsx`（`installMobileShareActivityDelivery(`） | `git grep -n installMobileShareActivityDelivery -- apps/mobile` ⇒ 定义 + App 调用 + uninstall 各在位 | ✅ L8 两半相反（默认全关⇒那一档空；翻开⇒那句带本机清单名的话落地） |
| 面板 3s 轮询换成信号驱动 | 宿主侧 `packages/app-host/src/share-signals.ts`；服务端 `server/src/sync/services/websocket-connection.service.ts` 发 `new_share_ops`；web 消费侧 `apps/web/src/features/share/use-share-roster-signal.ts` 与 `use-share-activity-signal.ts` | `grep -c new_share_ops packages/app-host/src/share-signals.ts` ⇒ 2；`grep -c new_share_ops server/src/sync/services/websocket-connection.service.ts` ⇒ 1；`grep -rl setInterval apps/web/src/features/share` ⇒ 空 | ✅ 共享面板那一片已经没有定时器；刷新由信号推 |
| 通知内容口径（清单名 + 活动种类，条目内容不进正文） | 词条在 `packages/i18n/src/locales/zh-CN.ts` 的 `common.share.activity*` 与 `common.share.activityNamed.*` | `grep -c common.share.activity packages/i18n/src/locales/zh-CN.ts` ⇒ 5（不带清单名的两条：新增／删除；带 `{name}` 的三条：新增／删除／完成） | ✅ ADR-0071 那句在代码里；措辞不含条目内容 |
| 两枚谓词的数据面 | 整条已按「撤下」结案（`packages/ui/src/sync/notification-model.ts` 的 `DEFAULT_NOTIFICATION_PREFS` 只有 `activities` 一个键） | `git grep -n shouldNotifyTaskReminder -- apps packages` ⇒ 零命中；`grep -c acceptInvitation apps/mobile/src/screens/JoinShareScreen.tsx` ⇒ 1（手机上接受邀请是**用户按下按钮**，不是自动） | ✅ 撤下的理由在 M6 之后仍成立：`shouldAutoAcceptInvitation` 到现在也没有输入 |

**四把尺里最后一格未判定的也补上了**：`server` 侧单测在同一天晚些单独跑，**rc=0**（判决与那趟的分母在 §9.16 那张四把尺表的 `pnpm test` 那一行，别在这里抄第二份）。⇒ 本批收口时，四把尺**每一枚都有判决**，两枚红（`check` 与首趟 `test`）逐条归到别线名下并带现量命令。

#### §9.18 M6 那两段的变异臂补上了（2026-10-27 现量，首跑）

上面那张表里「密钥落盘端口」与「载荷密钥接线」两格，此前只有**设备腿 L4 那一次结果**与两枚行为用例，**没有常驻变异臂**（本线臂册里没有覆盖它们的（**副数别抄**：现量 `ls research/tools/mutation-rigs/` 数 `mutate-collab-` 前缀那几枚）：`mutate-collab-share-routing` 管路由、`mutate-collab-open-pull` 管"打开才拉"、`mutate-collab-mobile-activity` 管投递）。⇒ 补一副 `research/tools/mutation-rigs/mutate-collab-mobile-keywiring.mjs`，四臂与首跑读数：

| 臂 | 病灶 | 红集 | 读数 |
|---|---|---|---|
| `slot-suffix-gone` | accountId 不拼 `#share-keys` 后缀 ⇒ 密钥料与 vault root key 抢同一格 | 1（兄弟槽那一枚） | 精确匹配 |
| `remove-noop` | `remove()` 里 `delete` 打空 ⇒ 摘掉的键还在盘上 | 2（往返 + 最后一枚整槽删） | 精确匹配 |
| `null-as-empty` | 键不存在时回空串 | 4 | 精确匹配（首跑我预测 2，逐条读后确认四条都是同一口径的另一条入路 ⇒ **改预测不改判据**） |
| `cipher-not-taken` | 不再调 `getPayloadCipher()`，恒交 `undefined` | 4（单例／换账号／登出摘掉／reset 重问） | 精确匹配（首跑我指望那枚**静态装配**断言红，它不红 —— 它数的是调用点存在性，本来就不该负责"取到没取到"；行为那一侧由这四枚咬住 ⇒ 判据原样留着） |

`ARMS=pass (4/4)`；基线两载具各 10 与 14 枚全过；跑完 `git status --porcelain -- apps/mobile/src` 为空，两枚目标文件与 `git show HEAD:` 逐字同 md5。⚠️ 读数经 `npx vitest` 直跑，**没经过内存闸门**（那枚 shim 只挂在 `pnpm` 上）。⚠️ 这副臂原地注病灶，跑前必须确认同一棵共享检出里没有别人的 `pnpm check` 正读到移动壳（本次是在邻会话那条链的真浏览器阶段跑的，链上读移动源码的是链尾 `-r test`）。

**六段现在的臂覆盖图**（如实登记，不是"都有臂"）：入口路由 `mutate-collab-share-routing`；打开才拉 `mutate-collab-open-pull`（两壳各一臂）；实时投递与偏好 `mutate-collab-mobile-activity`、内容口径 `mutate-collab-notif-content`；密钥落盘端口与载荷接线 = 本副；**同意态存储那一格在写这一句时只有行为用例、没单开一副臂** —— 它的牙当时在 `packages/ui/tests/share-consent-model.spec.ts` 与两壳入群闸用例（`apps/web/tests/share-join-consent-gate.spec.tsx`）加上设备腿 L7 的同意面那一步。⚠️ **这一句在它自己落笔那一刻成立，同一趟晚些已补上**：`mutate-collab-consent-gate.mjs` 四臂 + 移动端两壳调用点的常驻判据（`share-ui-assembly.spec.ts` ⑨ 组）⇒ **别按这一句施工**，看 §9.19。

**这一批之后仍开着的格**（逐格带现量与归属，别把上面任何一枚绿读成这四格做完）：

- **登出/撤销后本机那份共享密钥料**：`clearMobileVaultSession` 删的是 root key，`#share-keys` 那一格**没跟着删**。现量：`grep -c removeVaultRootKey apps/mobile/src/lib/vault-session-cleanup.ts` ⇒ 2、`grep -c share-keys apps/mobile/src/lib/share-key-store.ts` ⇒ 2（那段 ⚠️ 就写在实现端口的同一份文件里，不是本轮新发现）。⇒ 这一格**不是明文泄露** —— 密钥料是 vault 信封包裹的，root key 一删就解不开；留下的形状是"离场的设备上还有一份解不开的密钥料"。要清它得动 vault 会话那一层的清理时序，**归产品负责人拍板**，本线不代改别人那枚函数的次序。
- **同意面那句措辞用谁的口吻**（清单所有者语 vs 加入者语）：这句会被用户当成承诺读，属对外表征 ⇒ 归权利人；两屏各自现的那份文案在 §9.14、§9.15 的截图指针里能看到。
- **Android 那一侧**只有出包读数、**没有界面腿**。载体不是「什么都没有」：`adb` 与一枚 AVD 在，缺 `Sdk\emulator` 那枚主程序，且没插真机 —— 三条取法与解锁所需那段装机动作都在 §9.14 那一格（2026-10-27 现量更正；原先写的是「载体不存在」）。⚠️ 同日 14:5x 又重测了一次，形状更重：**`system-images` 整目录也不在**，所以解锁至少是两枚组件 + 硬件加速确认 + 一枚还不存在的远端旅程装置 —— 逐条取法见 §9.19 那一节。
- **「事后把一条已有条目挪进别的清单」**在两壳仍零调用点 —— 见上面那张边界表，它和本批那枚"新建时选落点"是两格。

### 9.19 同意闸那一格的调用点判据 + 四臂首跑（2026-10-27 第十一批）+ 整条 `pnpm check` 的第三趟读数


§9.18 末尾登记的那一格欠账（"同意态存储那一格当时没有单开一副臂"）在这一批补上了。**顺序是这一节唯一值得学的地方**：
先去量"臂打在哪儿"，才发现移动端那两枚调用点**当时没有任何常驻判据指着它** ——
现量 `grep -rn shouldShowConsent apps/mobile/tests/` 在补之前是**零命中**。
⇒ 先补判据（`apps/mobile/tests/share-ui-assembly.spec.ts` 新增 ⑨ 组两枚，提交 `b514b0f10`），再让臂打上去。
反过来先跑臂，C/D 两臂只会以"存活（判据没牙）"收 —— 那是**装置的红**，而它特别容易被下一位抄成"这一格没牙"。

#### 四臂首跑（`node research/tools/mutation-rigs/mutate-collab-consent-gate.mjs`，退出 0，`ARMS=pass (4/4)`）

| 臂 | 病灶 | 载具与基线分母 | 红集 | 读数 |
|---|---|---|---|---|
| `fail-open` | 模型里没记录也返回"不弹" | `packages/ui` 那份 `share-consent-model` 6 枚 | 4 | 精确匹配 |
| `web-call-site-gone` | web 入群对话框那一行摘掉 | `apps/web` 那份入群闸 5 枚 | 4 | 精确匹配 |
| `mobile-call-site-gone` | 手机入群屏那一行摘掉 | `apps/mobile` 装配那份 26 枚 | 1 | 精确匹配 |
| `mobile-owner-call-site-gone` | 手机「开启共享」那一侧摘掉 | 同上 26 枚 | 1 | 精确匹配 |

两处预期是**跑之前对着源码改掉**的（不是跑完漂移再改）：模型那一臂原写 3，读 spec 见「取消不是同意」在同一个 `it` 里
复查 `shouldShowConsent(result.store)` ⇒ 必然一起红；web 那一臂原写 3，见 `press()` 在 DOM 里找不到同意面的按钮**就抛**
⇒「勾了不再提示 ⇒ 直接到表单」那一枚走不到自己的断言。⇒ 四臂首跑**零漂移**。
基线三载具各 6 / 5 / 26 全过，跑完 `git status --porcelain -- packages/ui/src apps/web/src apps/mobile/src` 空读数、
无 `.mut-bak` 残留、逐载具 RECHECK RC=0。⚠️ 读数经 `npx vitest` 直跑，**没经过内存闸门**（那枚 shim 只挂在 `pnpm` 上）。
⚠️ 这副臂**碰 `apps/web/src`** ⇒ 点火前等同一棵共享检出里那趟 `pnpm check` 打出收尾行（它的真浏览器阶段与链尾 `-r test` 都会读那份源码）；
这一趟是在 `CHAIN_RC=1` 落进日志之后才跑的。

**六段的臂覆盖图到这一批为止是齐的**（副数与名单现量：`ls research/tools/mutation-rigs/`）：入口路由 / 打开才拉 /
实时投递与偏好 / 内容口径 / 密钥落盘端口与载荷接线 / **同意闸三层 = 本副**。

#### 顺带：整条 `pnpm check` 的第三趟读数（同日 14:3x，串行一条链，取证 `/tmp/full-check-final.log`）

前两趟（§9.16 那一行）都断在 `screenshot:verify` 的「登录档相邻控件 12px / 验证码屏」那六枚上。这一趟**那一格过了**
（`auth-form-spacing.spec.ts` 的真浏览器用例这次打勾，修法由 `界面/间距` 那条线自己入库），链一直走到链尾倒数第二档，
**唯一一枚红落在 `pnpm -r test` 的 `apps/web`**：`tests/task-sort.spec.tsx` 的「批量选择入口只在任务列表里出现，完成后退出」
⇒ `AssertionError: expected undefined to be defined`（该行读的是 `entities.tasks[task.id]?.completedAt`），
判决 `Test Files 1 failed | 208 passed | 2 skipped`、`Tests 1 failed | 2589 passed | 13 skipped`。

🔴 **仍不是本线**，且这次的形状与"别人在飞的编辑"无关 —— 那枚 spec 相对 HEAD 干净（现量
`git status --porcelain -- apps/web/tests/task-sort.spec.tsx` ⇒ 空），它最近一笔改动是 2026-10-10 的 `feat(web)`。
⚠️ **但本线不替它定性**：这一枚红只在整链里出现过这一趟，而同日 `apps/web` 那条线在自己的台账里补了单跑对照
（`2590 passed / 0 failed`）并把它归成**时序**（现量：`git show --stat 0f136105b`）。两种读数不冲突 ——
一枚"链里红、单跑不红"的用例，说它"稳定复现"是没有证据的，说它"是环境的"同样没有证据。
⇒ 本线只登记到这一格：**`main` 到"整条 check 绿"之间现在只剩这一枚红，落在 `apps/web` 的 `task-sort` 批量选择那一档**；
改法与定性都归那条线（本线不代改别人的判据口径）。

⚠️ 归因要写清这棵树：那一趟链 13:5x 起跑，`apps/web test` 那一刻（14:37）工作树里已经有本节的 ⑨ 组判据（14:2x 落盘、14:38 才提交），
所以它是"HEAD + 我在飞的编辑"的合成态 —— 对本线而言有用的两枚读数是三个载具的基线（6 / 5 / 26 全绿，那是臂跑完后的现量），
而不是链的 rc。链本体环节数每次现量：`node -e "console.log(require('./package.json').scripts.check.split('&&').length)"`。

#### Android 那一格同日再量一次（2026-10-27 14:5x，同一台 `windows-pc`；"载体半装"这句是瞬时读数，重跑才算）

远端默认 shell 是 **cmd**，所以下面三条都按 cmd 语法跑（bash 语法探它打出的"系统找不到指定的路径"不是否证）：

- `dir /b "%LOCALAPPDATA%\Android\Sdk"` ⇒ `build-tools`、`cmake`、`cmdline-tools`（下有 `latest`，`sdkmanager.bat` 在）、`ndk`、`platform-tools`（还有一枚 `platform-tools-2`）、`platforms`、`licenses`、`.knownPackages`、`.sdk`、`.temp`
- `if exist "%LOCALAPPDATA%\Android\Sdk\emulator\emulator.exe" (echo YES) else (echo NO)` ⇒ **NO**（`C:\Android\Sdk\...` 同一条也 NO）
- `adb devices` ⇒ `List of devices attached` 下面**空**（daemon 起得来，没插真机）；`where adb` ⇒ 那份 platform-tools 里的 `adb.exe`

⇒ 形状比 §9.14/§9.16 那几处写的"缺 `Sdk\emulator` 一枚"要**更具体也更重**：`system-images` 那枚目录**整目录不在**，
而册里那枚 AVD（`%USERPROFILE%\.android\avd\opp-smoke.avd`）的 `config.ini` 写着 `abi.type = x86_64`
——镜像按这个 ABI 就该落在 `system-images` 里。所以"补一枚 Google 组件"这条改判：**至少两枚（`emulator` + 一枚匹配的系统镜像）**，
再加两格装置侧的前提：**那台机的硬件加速要确认**，以及**协作旅程装置今天只有 iOS 一份**
（现量 `ls scripts/verify*collab*`），要跑 Android 界面腿得新写一枚驱动远端设备的装置，还要让那台模拟器够得着服务端。
⇒ 这一格今天仍按"出包腿有读数、界面腿没有装置"结案，**不把"编译过"读成"Android 已验"**；解锁它的代价已经量到这一层，
排不排归产品负责人。

#### 本批的四把尺（串行，逐枚带 rc）

| 尺 | 读数 | 归因 |
|---|---|---|
| `pnpm -r typecheck` | **rc=0** | 本批新增的 TS 代码只有 ⑨ 组那两枚断言（在 `apps/mobile/tests/`） |
| 本线全量单测（`cd apps/mobile && npx vitest run`） | **rc=0、`Test Files 90 passed (90)`、`Tests 1158 passed (1158)`** | ⑨ 组并入后移动壳套件零红；⚠️ 经 `npx` 直跑，**没过内存闸门**（那枚 shim 只挂在 `pnpm` 上） |
| `pnpm verify:collab-suite` | **rc=0、`SUITE=OK legs=4 failed=0`**（journey／sync／revoke／conflict 四腿各 `RESULT=OK`，步数由脚本自己打印） | 🔴 本批**零产品源码改动**（现量：`git diff --name-only b0ac12042..HEAD -- packages apps server` 只回一枚 `apps/mobile/tests/share-ui-assembly.spec.ts`）⇒ 上一批第 51 跑那趟设备腿读数（63 通过 / 0 失败）**仍对应当前产物**，本批不重开 iOS 那一趟 |
| `pnpm check` | 整链第三趟 **rc=1**，唯一那枚红见上面那段；本批那四枚文档门（`check:docs`、`check:doc-citations`、`check:md-tables`、`check:doc-command-claims`）在提交前各跑一次，**全 rc=0**；`check:gate-wiring` 同日 rc=0 | 链的 rc 归 `apps/web` 那条线，本线的文件上一枚红都没有；本批没动 `package.json` 的脚本面，所以 `gate-wiring` 无需重开 |
### 9.20 验收那句「与 web 同一条旅程」的逐步对照（2026-10-27 收口审计）

为什么还要补这一节：任务书第 4 步要的是"**与 web 同一条**旅程"在 iOS 上真跑，而"两条腿各自都绿"**并不证**这句话
—— 两枚脚本完全可能各跑各的。这一节把两侧的步骤名逐一钉起来，取代之前那句凭印象的"同一条旅程"。

现量取两侧步骤名（两枚脚本都还在动，别按本节文字推断"现在还没有"）：
web 那侧 `grep -nE 'STEP [0-9] OK' scripts/verify-collab-journey.mjs` ⇒ 三段，收尾 `RESULT=OK steps=3`；
手机那侧 `grep -nE '^step ' scripts/verify-mobile-collab-ios.sh` ⇒ 十七段。

| web 那一趟断言的那一句 | 移动装置里对应的那一段 | 判定 |
|---|---|---|
| 环境就绪（服务端 + 前端 + 迁移过的库） | 第 1 段（每趟专属服务端栈，TEST_MODE 零 mock）＋ 第 2 段（当前源码 Release 构建 + 安装，带构建新鲜度自闸） | ✅ 同形，且移动侧更严（多一枚新鲜度闸） |
| owner 邀请 | 第 5 段（owner 侧建共享、发邀请、写一条任务） | ✅ |
| bob 入群 | 第 6 段 = **L1**（手机走自己的界面加入，界面上自己说出"加入成功"） | ✅ |
| 双方成员对账 | 第 8 段 = **L3/L4**（owner 侧用名册公钥对手机写的那条重验签 = `verified`）＋ 第 10b 段 = **L7** 的名册行 | ✅ 比 web 那句多要求"签名" |
| 两台互见对方写的任务 | 下行 = 第 7 段 **L2**；上行 = 第 10d 段 **L10**（新建时指进那份共享） | ✅ 拆成两半各判，web 那句只判一次互见 |
| 证据齐（N 张截图） | 第 11 段证据目录 + 逐格一张肉眼复核过的截图 | ✅ |

**web 那一趟没量、移动侧多出来的四族**（不是"移动侧补齐"，是这句本来只在移动端存在）：
评论双向（上行第 8 段、下行第 9 段 = **L5** 靠 `new_share_ops` 自己出现）、便签双向（下行第 10c 段 = **L9**、上行第 10e 段 = **L11**）、
手机自己把一条清单设为共享（第 10b 段 = **L7**）、按本机偏好打扰（第 10 段 = **L6** 偏好面 + 第 10a 段 = **L8** 两半相反）。

⇒ 逐格对完的结论：**没有任何一句是 web 量了而手机没量的**，反过来移动侧多出四族 ⇒ "与 web 一样真的能用"这句有对照表撑着，不再是一句断言。
⚠️ 两枚脚本**不同一套工具**：web 吃 Playwright + 真浏览器，手机吃 AX 驱动 + Release 构建装进模拟器。
"同一条旅程"判的是**用户动作序列同一串**，不判实现工具相同 —— 这句写死，免得下一位拿工具差异当"没对齐"的证据。
⚠️ 反过来也别把这行读成"移动侧的读数覆盖 web 侧的判据"：`verify:collab-journey` 那三腿仍是 web 唯一的常驻界面腿（四腿套件 `SUITE=OK legs=4` 里的第一腿），两枚各管各的壳。
