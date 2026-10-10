# 共享清单与协作（清单级多人协作）落地计划

> 状态：**规划中**
> 立单：2026-10-08。产品负责人认可调研结论与 UX 十二条裁决（§1）后指令「制定一个完整的计划」。
> 证据层：[共享清单调研](../research/collaboration-shared-lists.md)（2026-10-08；滴答帮助中心全文一手抓取 + 仓库双路只读调研 + Ink & Switch / RFC 9420 / Etebase）。
> 决策记录：[ADR-0062](../adr/0062-shared-list-key-distribution.md)（2026-10-08 已立，实施未开始）。
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

- 2026-10-08：立单。调研见 [research/collaboration-shared-lists.md](../research/collaboration-shared-lists.md)；十二条产品决策（§1）经产品负责人认可；同日 [ADR-0062](../adr/0062-shared-list-key-distribution.md) 立掉。
