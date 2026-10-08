# 共享清单（多人协作）调研

> 调研时间：2026-10-08。方法：仓库双路只读调研（E2EE/op-log 架构现状 + 协作痕迹全仓搜）＋外部一手抓取（滴答清单官方帮助中心全文、Ink & Switch local-first 宣言、RFC 9420、Etebase 协议文档）。
> 用途：[共享清单落地计划](../plans/collaboration-shared-lists.md)的证据层。结论以计划与 [ADR-0062](../adr/0062-shared-list-key-distribution.md) 为准，本文只给证据。
> ⚠️ 调研边界见 §5 —— WebSearch 配额耗尽（2026-10-13 重置）+ 部分域名 DNS 不通，AnyType / Notesnook / Standard Notes 的共享细节未确证。

---

## 1. 滴答清单的协作功能全貌（一手来源）

来源：官方帮助中心文章全文（从 `help.dida365.com` 帮助中心首页内嵌 JSON 直接解析，非二手转述）——
[如何共享清单](https://help.dida365.com/articles/6950649257581871104)、[团队如何协作](https://help.dida365.com/articles/6950652002518958080)。

| 面 | 官方文档原文事实 |
|---|---|
| 共享粒度 | 「**只有你自己创建的普通清单支持共享**，「今天」、「明天」等智能清单以及「收集箱」不支持共享协作」；FAQ：「只有对应的共享清单中的内容会与对方共享，其他内容将不会共享」 |
| 邀请三通道 | ①联系人邀请（输入邮箱；未注册者点邮件链接激活共享）②共享链接邀请 ③微信二维码（仅 App 端）。被邀请人在**通知中心**接受邀请 |
| 成员权限 | 三档：**可编辑 / 可评论 / 只读**，按成员逐个设置（清单标题旁「成员」图标 → 成员右侧「编辑」） |
| 任务指派 | 「其中任何成员都可以对任务进行分配」；详情页单指派、批量编辑多选指派、创建时输入 `@` 指派；被指派人在通知中心收到通知 |
| 评论 | 任务详情 →「···」→「评论」；支持 `@某人`；被评论/@者在通知中心收到提醒 |
| 任务/清单动态 | 任务动态=「每一步操作的责任人」+从创建到完成的所有改动；清单动态仅电脑端 |
| 每清单通知 | 三类：「完成/取消完成了任务」「添加了任务/笔记」「删除/移走了任务/笔记」（清单编辑 →「提醒与通知」，或清单标题旁「共享」→「消息通知」） |
| 任务提醒 | 四档：所有任务 / 所有任务（指派给他人的除外）/ 指派给我的任务 / 不提醒 |
| 智能清单渗透 | 共享清单任务在「所有/今天/明天/最近7天」的显示，四档同上形状 |
| 限额 | FAQ：「只需清单所有者是高级会员，此清单即可共享给 **29 个成员**，但是非高级会员的成员不能使用高级功能」（免费档能否共享未确证） |

设置页（产品负责人 2026-10-08 提供的截图，滴答「设置 → 共享协作」）：①「自动接受来自已知合作者的共享邀请」开关；②「共享清单的默认通知」三类默认值——与上表「每清单通知」三类一一对应，即**默认值层**。

仓库自己的对标登记与此一致：[`dida365-feature-benchmark.md`](dida365-feature-benchmark.md) §2.6（6.1 清单共享 / 6.2 任务指派 / 6.3 评论 / 6.7 分享清单为链接，滴答 ✅、heyta ❌）。

**产品形状总结**：协作的最小可信单元是「清单」；人、权限、通知、动态全部围绕清单组织；任务级只挂「指派」与「评论」两个动作。

## 2. 业界 E2EE / local-first 应用的多人共享方案

### Ink & Switch《Local-first software》（[原文](https://www.inkandswitch.com/essay/local-first/)）

- E2EE 与 local-first 互补不冲突："Local-first apps can use end-to-end encryption so that any servers that store a copy of your files only hold encrypted data that they cannot read."
- URL 是最佳共享载体，但权限是开放问题："URLs are a good mechanism for sharing… Access permissions for documents beyond secret URLs remain an open research question."
- 本地优先下权限模型的本质："any user who has a copy of some data cannot be prevented from locally modifying it; however, other users may **choose whether or not to subscribe** to those changes." —— 服务端管分发门，不管内容。

### MLS，RFC 9420（[原文](https://www.rfc-editor.org/rfc/rfc9420.txt)）

群密钥协商 IETF 标准：成员状态 = epoch 线性序列，成员变更开新 epoch；树形密钥更新 O(log n)；提供前向保密 + 攻破后安全。其引言自认：小群里「sender keys + 1:1 安全信道分发」的传统做法够用，MLS 的优势在群变大、密钥泄露风险变高时才兑现。**对 ≤30 人、低成员变更的共享清单场景，信封式分发足够；MLS 不值得引入**（远期升级路径）。

### Etebase（[协议文档](https://docs.etebase.com/protocol-specs/collections)）

- collection 有不可变类型；为让服务端能按类型过滤却不知道类型，用**确定性加密**生成 type token。
- 「collection objects are internally just items with **additional data that is specific to each member (user)**」——成员关系按用户记录在 collection 上。
- 拉取响应含 **`removedMemberships`**：「用户失去访问权但集合未被删除」——客户端靠它得知被移出。（accessLevel 枚举细节本轮未确证。）

### 通用模式（各家收敛出的形状）

```
账号 root key（各自持有，服务端不可见）
   └─ 每个共享空间一把随机 list/space key
        └─ 空间内所有 op / 条目密文用这把 key（或其派生）

邀请 = owner 用成员的加密公钥把 list key 包成信封，信封经服务端转交
移除 = 服务端删成员资格（管门）+ owner 换新 list key 分发给剩余成员（rekey）
权限 = 服务端按成员名单拒写（硬门）+ 客户端 UI 约束（软门）
```

队内既有结论同向：`research/ticktick-clone-oss-research.md:288`（2026-09）——「滴答清单这类**单人为主 + 少量共享清单**的场景，服务端权威 + LWW + 操作日志往往比 CRDT 更简单可靠」。

## 3. heyta 仓库现状（双路只读调研，交叉一致）

### 3.1 四层单用户模型

| 层 | 现状 | 关键证据 |
|---|---|---|
| 密钥 | 单账号单 root key：口令 + 一次性恢复码双 Argon2id wrapper；HKDF 按 purpose（`sync`/`ai-task-planning`/`ai-feedback`）派生；`VaultKeyPackage` 主键即 userId | [ADR-0050](../adr/0050-e2ee-key-lifecycle-and-recovery.md)；`packages/sync-core/src/key-lifecycle.ts`；`server/prisma/schema.prisma` |
| op 模型 | op 只有 `clientId` 无 author/userId；向量时钟维度 = clientId，`MAX_VECTOR_CLOCK_SIZE = 100`（ADR-0008 自认「挪墙不拆墙」）；LWW = (timestamp, clientId) 确定性收敛 | `packages/sync-core/src/operation.types.ts`、`vector-clock.ts`、`conflict-resolution.ts` |
| 服务端 | `Operation.userId` 行隔离，端点全部 authenticate + 本人 userId 域；WS 只广播同账号连接；36 个 model 无任何 workspace/member/share 表 | `server/src/sync/sync.routes.ts`、`websocket-connection.service.ts` |
| 领域 | 12 个建模实体单命名空间；`Project = {name, parentId, color, archived}` 无成员概念；Task 无 assignee；无 COMMENT 实体 | `packages/domain/src/entities.ts` |

### 3.2 「E2EE 下协作不可能」的断言分布

| 出处 | 原文要点 |
|---|---|
| [ADR-0044](../adr/0044-countdown-anniversary-entity-calendar-data-and-image-tiers.md) §排除清单 | 「共享/协作倒数日：E2EE 下排行榜/联赛那类结构上不可能，同一条理由适用于『两人共管的纪念日』」 |
| `docs/plans/ui-review-fill-zh-timeline.md:2265` | 「共享日历/协作：E2EE 下结构上不可能 —— 服务端解不开密文，就没有『别人能看的那一份』」 |
| `docs/plans/countdown-anniversary.md:21` | ❌ 共享/协作倒数日（同族约束） |
| `docs/research/dida-ai-assistant-gap-analysis.md:321` | 评论/指派是「结构上不可能有」的两项 |
| `server/prisma/schema.prisma` `User.displayName` 注释 | 「今天它只有本人能读：heyta 没有共享/协作（E2EE 下服务端解不开，结构上做不了）」 |
| `docs/plans/roadmap.md:96-97`（激励红线原始论证） | 「只与自己的过去比」封死的是**需要可信的跨用户聚合**的形态（排行榜/联赛/自习室/组队） |

**关键澄清**：这些断言证明的是「服务端必须读明文做跨用户聚合」不可能；「密钥分发型协作」（把清单密钥包装给成员公钥）不在其射程内——只是现有密钥体系没有这个构造。激励红线（聚合型）**继续成立不受影响**。

### 3.3 法务对外承诺（加协同时必须按 AGENTS 规则 18 同步）

- `packages/legal/src/documents/privacy.ts:481`（中英镜像）：「它不向其他用户展示你的内容（**没有社区、没有共享清单、没有评论**）」——加共享后此句变假。
- privacy.ts 明文元数据 11 项清单：协作新增「成员关系/共享对象」类别，需逐项补登。
- `third-parties.ts`（PIPL 20/21/23 纪律）：跨用户共享是新的共享方式分类，可能触发 PIPL 23 单独同意。
- `data-rights.ts`：注销=真级联删除；共享引入「他人设备上的副本」新销毁边界。

### 3.4 现成零件 vs 缺失零件

**现成可复用**：① op-log+向量时钟+LWW 多写者就绪；② op 的 AAD 认证身份（`payload-cipher.ts`）；③ ADR-0050 的 wrapper/CAS/staging 迁移机器（per-list key 分发与 rekey 照抄形状）；④ `AutomationRecipientKey`（userId 单主键 + keyEpoch + publicKey，仓库唯一「每用户发布公钥」原语）；⑤ WS `new_ops` 只传信号的安全契约 + presence 中继（⚠️ `createRealtimeClient` 尚无宿主接线）；⑥ `tokenVersion`/设备撤销即关 WS（踢人语义骨架）；⑦ 可加性变更政策（新实体/可选字段不 bump schema；服务端白名单从同一 `ENTITY_TYPES` 派生，`validation.service.ts:25`）；⑧ `account_notifications` 站内通知中心 + `legalSetVersion()` 法务版本机器；⑨ `ASSISTANT_TURN` 一条一实体（评论实体现成模板）；⑩ `ENTITLEMENT_CAPABILITIES`（`server/src/entitlement.ts:52`）+ `evaluateCapabilityAcross` 并集判定（付费墙现成挂点）。

**缺失**：成员公钥目录与 per-list key 层；op 作者身份与签名；服务端 membership/share op-log 全套；邀请与角色 API；Task.assignee/评论实体；法务重写；旧断言修订；向量时钟墙在「成员×设备」规模下更快逼近；身份目录（昵称/头像按「只有本人能读」设计）。

## 4. 对设计的直接推论

1. **密钥分发型协作与现有 E2EE 立场相容**：服务端仍只见密文 + 成员关系（明文元数据，需登记）。
2. **share op-log 独立于个人 op-log**：绕开单账号表结构与向量时钟墙；共享实体物化进同一状态、写入路由在 `packages/app-host`（§3.5 边界）。
3. **通知路由必须本地化**：assignee 在加密 payload 里，服务端只广播「有更新」信号，成员端解密后本地判定是否提醒——「WS 只传信号」的既有安全契约正好是这个形状。
4. **任务/清单动态免费**：op-log 是事件溯源，「谁改的」从 op 流投影即可，这是相对滴答的结构性优势（滴答要专门做动态，我们本来就有账）。

## 5. 未确证清单（待补证）

| 项 | 状态 | 补证途径 |
|---|---|---|
| 滴答免费版能否共享 / 免费档成员上限 | 未确证（官方 FAQ 只写了所有者为高级会员时可共享给 29 人） | 帮助中心 FAQ / 实测 |
| 滴答「转让清单所有权」「成员退出后所见」 | 未确证 | 帮助中心 / 实测 |
| Etebase accessLevel 枚举与 rekey 细节 | 未确证（文档 invitations 章为 TBD） | GitHub 源码 `etesync/etebase` |
| AnyType space 共享的密钥分发细节 | 未确证（docs.anytype.so DNS 不通） | 配额重置后补 |
| Notesnook / Standard Notes 用户间共享 | 未确证（只找到公开链接分享） | 同上 |
| MLS 之外的信封式方案在 30 人规模的实测成本 | 未做（推断为 O(成员数)×低频，可接受） | W1 单测给数 |
