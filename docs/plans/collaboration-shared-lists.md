# 共享清单与协作（清单级多人协作）落地计划

> 状态：**进行中**（2026-10-08 立；W0–W3 已落地，逐条见 §3 —— 原写「规划中」，**2026-10-16 更正**）
> 🔴 **现状与下一步以 §9 为准（2026-10-20 复账；2026-10-21 M1 落地后本行改口；2026-10-22 再按界面可达性重锚）**：§3 那张 W 表与 §7 的 DoD 是 10-08 立的工单分解，
> 逐条已落后于代码 —— 尤其 §7 的 DoD 会被"元数据面已通"读成"协作已可用"。
> **内容面在用户界面上今天仍然零可达**（§9.1 末那一句是逐条现量）：评论那一族 2026-10-21 通的是**宿主层**
> （两个无界面宿主实例互拉、游标落盘、经真服务端验过，§9.8），而成员那侧的共享清单是一条**空清单**（本地只建一行清单、评论区又只挂任务详情）⇒ 点不进去；
> **任务/清单改动连宿主层都搬不到** —— 因为 `TASK/PROJECT` 的 op 至今进个人 op-log，那是 M2 的路由那一步（要先立 ADR）。
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

## 9. 2026-10-20 复账与下一阶段计划（🔴 标题那句"内容面整段断"到 2026-10-22 仍然**在用户界面上成立**：M1 通的是评论那条腿的**宿主层**，任务那条连腿都没接 —— 逐条见 §9.8 与 §9.1 那句"产品现状"）

> 状态：**本节是这一条线当前的权威现状**（§3 那张 W 表与 §7 的 DoD 是 10-08 立的，逐条已落后于代码；
> 读现状从这里读，别按 §3 推断"接完了"）。

### 9.1 现状（每条都带复量命令；本轮全部亲自跑过，不抄任何文档或子代理的数）

| 那一面 | 代码现量 | 怎么复量 |
|---|---|---|
| 元数据面（建共享 / 邀请 / 入群 / 成员 / 角色 / 转让 / 移除 / 退出） | ✅ 服务端与 Web 宿主都在 main 上，role 硬门在上传边界 | `pnpm verify:collab-journey`；`pnpm --filter @heyta/web --silent exec vitest run tests/share-panel-transfer.spec.tsx tests/join-link.spec.ts` |
| **内容下行** | 🟡 **评论这条腿已通**（2026-10-21 M1）：`downloadOps` 有生产调用点（`share-comments.ts` 的 `pullShareOps`），游标落盘、分页收敛、解密回放都在；🔴 但它今天**搬运不到用户眼前** —— 成员那边根本看不到这条共享任务（下一行那格），所以点不进评论区。原句"零实现"已过期 | `grep -rn downloadOps packages/app-host/src apps/web/src` 有命中（定义 + 调用两处）；`pnpm verify:collab-sync` 第 10 步（宿主层闭环，步数由脚本自己打印） |
| **内容上行** | 🟡 **只有评论**：`uploadOps` 经 `createShareOpDispatcher` 接通，但调用链只从 `share-comments.ts` 进来 | `grep -rn createShareOpDispatcher --include=*.ts packages` ⇒ 生产消费者只有 `share-comments.ts` |
| **任务 / 清单的写路径** | 🔴 **仍进个人 op-log**。`project-actions.ts` 里唯一与 share 有关的方法是 `setProjectShareId`（挂个 id），没有任何"该进 share log 还是个人 log"的分流 | `grep -n -E "shareId\|share" packages/app-host/src/project-actions.ts` |
| 服务端可写白名单 vs 客户端实际 | 白名单已经认识 `TASK / PROJECT / TAG / NOTE / COMMENT`，**服务端不拦，是客户端没往那走** | 读 `server/src/shares/share.membership.ts` 的 `SHARE_WRITABLE_ENTITY_TYPES` |
| 并发判定 | 🔴 share 分区每条 op 的向量时钟被硬编成 `{ clientId: 1 }`（个人引擎那侧会自增自己那一维）⇒ 同设备两 op 恒 EQUAL、跨设备恒 CONCURRENT，判定只剩 timestamp 平局 | 读 `packages/app-host/src/share-client.ts` 里 `vectorClock:` 那一行，对照 `packages/op-log/src/engine.ts` 的自增 |
| 逐 op 签名 | 🔴 线协议里没有 `signature` 字段，写侧不签、服务端不验；原语在 `sync-core` 里躺着 | `grep -rn signature packages/shared-schema/src/supersync-http-contract.ts` ⇒ 零命中 |
| 移除即 rekey | 🟡 **owner 那一次点击这条链已通**（2026-10-21 M3，读数见 §9.9）：`rotateShareKey` / `adoptRotatedShareKey` / `removeMemberAndRekey` 有生产调用点（`apps/web/src/features/share/share-rotation.ts` 装配，`ShareFeature.tsx` 的移除按钮与 reload 收钥两处调用），`keyEpoch` 真推进、新钥只封给在册成员（自己那枚排第一）、被移除那行的信封在库里置 null；成员端换成了**多世代密钥环**，否则换钥后那一屏会整块解不开。🔴 两件没做：库里**旧密文不重加密**（追加模型；重加密等于改 op-log 回放语义，与 M2/M4 同一份 ADR 一起判）；**owner 不在线时没人能触发换钥**（移除仍然生效，只是那一代钥还留着 —— 边界写在 `share-rekey.ts` 文件头） | `grep -rn removeMemberAndRekey apps/web/src packages/app-host/src` ⇒ 编排件 + 壳调用点各有命中；`pnpm verify:collab-revoke` ⇒ `RESULT=OK steps=8` |
| 实时 | 🟡 **`new_share_ops` 那三段接线已通**（2026-10-21 M5，读数见 §9.10）：客户端认下这条消息、只把 `(shareId, latestSeq)` 交给宿主；"**这台设备认不认得这份 share、要不要拉、拉到算哪类活动**"住 `@heyta/app-host`；"响不响"住 `@heyta/ui` 那条谓词；壳只做装配与投递。评论区那枚 5 秒轮询已撤，改成信号驱动重画。🔴 三条偏好谓词里今天只有**活动那一族**有输入：`shouldNotifyTaskReminder` 要 `TASK` 的 op 进 share log（M2）、`shouldAutoAcceptInvitation` 要移动端的邀请面 ⇒ 这两条不是"接了没测"，是**没有输入** | `grep -rn new_share_ops --include=*.ts packages apps` ⇒ 服务端发 / 客户端认 / 判据三处都有命中；`pnpm verify:collab-sync` ⇒ `RESULT=OK`，步数由脚本自己打印 |
| 端覆盖 | 🟡 Web 接了；**macOS / Windows / Linux 三枚桌面壳间接有**（包里装的就是 `apps/web/dist`）；**移动端零接入**；node-host/CLI 无 share 工具 | `grep -rn -E "SharePanel\|shareId\|payloadCipher" --include=*.ts --include=*.tsx apps/mobile/src` ⇒ 0 命中；`grep -n web-dist apps/desktop-macos/Sources/HeytaMac/HeytaMacApp.swift` |
| 常驻判据 | 🔴 **M7 之前**本线没有一扇门在链上（`check` 那串里 `verify:*` 引用数为 0；`collab-journey` 被 `e2e/playwright.config.ts` 的 `testIgnore` 摘出主 e2e 载体；证据目录被 gitignore ⇒ 截图不可复核）。**今天链上有三段**（`check:share-entry-hidden` / `verify:collab-keys` / `check:collab-carrier`），形状与读数见 §9.7；要真 PostgreSQL / 真浏览器的那四腿仍靠人跑 `pnpm verify:collab-suite` | `node -e "const c=require('./package.json').scripts.check.split('&&');console.log(c.filter(x=>['collab','share-entry'].some(k=>x.includes(k))).join(', '))"`；`grep -n -A5 testIgnore e2e/playwright.config.ts` |

⇒ **一句话的产品现状**（2026-10-22 按**界面可达性**重锚，此前那句"评论已经能互相看到"是把宿主层读数抄成了产品能力）：
能邀请人、能管人、能转让；内容面今天**两侧都到不了用户眼前**。
· 评论那条腿在**宿主层**已通并经真服务端验过 —— 但 `verify:collab-sync` 那"两台"是**两个无界面的宿主实例**，不是两台开着界面的浏览器；
· 成员那侧的本地清单行只有 `addProject` + `setProjectShare` 两步，**没有任何 share 日志拉取**（现量：`apps/web/src/features/share/JoinSharedListDialog.tsx` 的 `finalize`）
  ⇒ 他看到的共享清单是**一条空清单**；
· 评论区在 web 只有一个挂载点，挂在**任务详情**上（现量：`grep -rn ShareCommentsSection apps` ⇒ 只有 `TaskDetailCard.tsx` 一处）
  ⇒ 没有任务就没有评论区可点，**成员进不去评论区**。
⇒ 所以"能看到彼此写的评论"今天只在 owner 那一侧成立（他看得见自己的任务），**成员之间互相看不到任何东西**。
任务与清单的改动照旧看不到 —— 那一半要等 M2 把 `TASK/PROJECT` 的 op 路由进 share 日志。
"共享清单"今天交付的是**一张只有外壳在动的共享**，还不是协作。

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
| **M1 🟡**（2026-10-21 宿主层已闭，读数见 §9.8） | **下行链路接通**：`downloadOps` 接进宿主（游标持久化、分页收敛、解密回放、离线补拉） | 🔴 **判据按实测改口**（原句写的是"今天走不通的那一族"）：~~A 改一条任务标题 → B 读到新标题~~ —— `TASK/PROJECT` 的 op 至今仍进**个人** op-log（那是 M2 那一步路由的事），所以下行腿今天能搬运的只有 `COMMENT`。现判据 = **两台独立宿主**：A 发一条评论 → B 拉回并物化、再拉一次零新增、游标落在盘上（`verify:collab-sync` 第 10 步，读数 `RESULT=OK steps=10`）。变异臂三臂见 §9.8，红集精确匹配 | 只需 `packages/app-host` + `apps/web`，不碰线协议 ⇒ **可以先做**；"任务标题那一半"随 M2 一起判 | 工程直接做 |
| **M2** | **任务/清单的写路径路由**：共享清单里的 `TASK/PROJECT/TAG/NOTE` op 进 share log | 路由判据住在 `packages/app-host`（`shareIdForTask` 那一族的**同源**函数，不许在壳里判）；红形：未共享清单写进 share ⇒ 红 / 共享清单写进个人 log ⇒ 红 | 🔴 碰 op-log 语义与"个人 log 不动"这条 ADR-0062 承诺 ⇒ **先立 ADR**；`Project.shareId` 已在册，不必 bump schema | 工程 + 一份新 ADR |
| **M3 🟡**（2026-10-21 落地，读数与两件刻意没做的见 §9.9） | **rekey 落地**：移除/退出/撤销 → `keyEpoch` 推进 → 重封给在册成员；撤销后旧成员解不开新内容 | 实测到的判据形状：`verify:collab-revoke` 从"手搓迁移循环"改成**吃生产函数**（`removeMemberAndRekey` + `adoptRotatedShareKey` + 真 `ShareApiClient`），8 步含 psql 现量（`shares.key_epoch = 2`、他那行 `key_envelope IS NULL`）与"第三个人 carol 换钥后仍读得到新旧两代"；变异臂四臂 `ARMS=pass (4/4)` 红集精确匹配（原句那句"摘掉 `autoSeal` 那一步 ⇒ 必红"已由 `verify:collab-journey` 那条臂覆盖，这一批补的是**换钥编排本身**能不能红） | 依赖 M1（下行要先能读，否则证不了"读不到"）—— 已满足 | 工程直接做 |
| **M4** | **逐 op 签名**：线协议加 `signature`、写侧签、服务端验、失败按"永久拒绝"处置（对齐 ADR-0019 那条读侧对偶） | 封闭词表 + 一条"改一个字节必被拒"的臂 | 🔴 `shared-schema` 线协议 = 不可逆层，与 M2 同一份 ADR 承接 | 工程 + ADR |
| **M5 ✅**（2026-10-21 落地，读数见 §9.10） | **实时与偏好接线**：客户端接 `new_share_ops`、活动谓词进通知路径 | 现量（不是"应该行"）：`verify:collab-sync` 第 11 步走真 WS + 真宿主 ⇒ 有信号就有拉取；`无订阅偏好 ⇒ 零打扰`钉在 `apps/web/tests/share-activity-notify.spec.ts`（10 枚）与 `share-activity-signal.spec.tsx`（6 枚，接线臂）。红形都真红过：谓词恒 true ⇒ 3 枚红；壳跳过闸门 ⇒ 2 枚红；拿掉客户端那条分支 ⇒ `RESULT=FAIL step=11` | M1 之后才有意义（信号语义是"有东西可拉"） | 工程直接做 |
| **M6** | **移动端接入**：入口/路由、`setProjectShareId` 调用点、share 密钥落盘端口、`payloadCipher` 接线、同意态存储、`ShareFeature` 那层的 web-only 假设重写 | 与 web 同一条旅程在 iOS 模拟器 + Android 上走一遍（AGENTS §6.2：真跑 + 真看截图） | 六段缺段的现量清单见 9.4；🔴 Android 构建一律走 windows-pc | 工程直接做（体量大，可拆） |
| **M7 ✅**（2026-10-21 落地，形状与读数见 §9.7） | **把判据变成常驻**：本线 `verify:collab-*` 与 journey 进链或有别的自动载体；`check:share-entry-hidden`（P-1 期间钉"不可达"）；变异臂从散文搬进 `research/tools/mutation-rigs/` | `check:gate-wiring` 那类"链外必须有可验消费方"的尺要能覆盖 `verify:*`（它今天只审 `check:*` ⇒ 本身要扩）—— **本线没替公共那把尺翻口径**，改立窄的 `check:collab-carrier`，理由写在 §9.7 末 | 无 | 工程直接做，**最先做也行** |

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

- ⚠️ **本线还剩一枚轮询，但它不是 M5 撤掉的那一类**：`apps/web/src/features/share/ShareFeature.tsx` 里开着面板时每 3s
  `reload` 一次（现量 `grep -n "setInterval" apps/web/src/features/share/ShareFeature.tsx`）。
  它取的是**清单详情与成员**（邀请被接受、成员信封下发都发生在另一端），而 `grep -rn "notifyShareOps" server/src`
  只回**两行**：一行是 `websocket-connection.service.ts` 里的定义，一行是 `share.routes.ts` 里 share log 追加路径上的调用 ⇒
  **发信号的只有那一条路径**，成员/信封那一份状态**不在这条信号的覆盖面上**。
  所以撤掉它会把"邀请被对面接受后面板自己更新"退化成"刷新页面才更新"——**这不是漏撤，是要另立一条**：
  服务端在成员/信封写路径上也发一条信号，或让面板从本机已知事件重取。归 M4 之后的活，不进 M5 的读数。

- **通知正文只有"有人新增/删除了一条评论"，不含清单名与内容**。端到端加密下本机当然解得开，但把明文写进系统通知中心等于交给操作系统（及其同步）去保管。要带名字得先定一条口径："通知里允许出现什么"—— 这一格归产品负责人拍，不由工程顺手放宽。
- **`shouldNotifyTaskReminder` 与 `shouldAutoAcceptInvitation` 仍没有数据面**：前者要 `TASK` 的 op 进 share log（M2 的路由），后者要移动端的邀请接受面（§9.4 那六段）。这不是"接了没测"，是**没有输入** —— 给它造一条假输入去点亮判据，量的是夹具不是产品。
- **`app-mount.spec.tsx` 里的 `act(...)` 警告是预存的**：同一枚文件在 HEAD 上跑就有 28 条（`An update to SubscriptionNotice inside a test was not wrapped in act`），本批那一臂挂上完整 `<App />` 后整文件涨到 45 条。现量：`cd apps/web && npx vitest run tests/app-mount.spec.tsx 2>&1 | grep -c "not wrapped in act"`。这条不是本批的缺陷，也没有被当成判据。
- **移动端与三枚桌面壳今天接不到这条信号**：`new_share_ops` 的解析在 `@heyta/sync-client`（共享包）里，判断在 `@heyta/app-host`，而投递面（Notification）与"注册消费者"那一行只在 web 壳里。移动端要等它自己的通知面（§9.4）。
- **上面那四处变异是一次性手工跑的，没有常驻装置**（M3 那批有 `mutate-collab-rekey.mjs`，M5 这批没有）。欠项写清楚：三枚能在秒级里跑的臂（宿主 3 枚 / ui 3 枚 / 接线 2 枚）可以进 `research/tools/mutation-rigs/`，而**第 11 步那一枚不行** —— 它每跑一臂都要起真服务端，那一臂该由 `verify:collab-suite` 的周期跑承担，不该伪装成秒级装置。
