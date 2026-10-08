# ADR-0062：共享清单走密钥分发型协作（per-list key + 成员公钥信封）

> 状态：**已接受（产品决策 2026-10-08；实施未开始）**。证据见[共享清单调研](../research/collaboration-shared-lists.md)，落地计划（W0–W6）见 [collaboration-shared-lists.md](../plans/collaboration-shared-lists.md)。本 ADR 只记裁决，不代表任何代码已存在。

## 背景：两类「协作」必须拆开

仓库至少 4 处在册断言写着「E2EE 下（共享/）协作结构上不可能」（[ADR-0044](0044-countdown-anniversary-entity-calendar-data-and-image-tiers.md) 排除清单、`plans/ui-review-fill-zh-timeline.md:2265`、`plans/countdown-anniversary.md:21`、`research/dida-ai-assistant-gap-analysis.md:321`，另有 `schema.prisma` `User.displayName` 注释与 `packages/legal` 的对外承诺）。这些断言实际证明的是另一件事：

- **聚合型协作不可做**：排行榜 / 联赛 / 组队 / 防作弊需要**可信的跨用户聚合**，E2EE 下服务端看不到明文、local-first 下没有可信汇总方。这条**继续成立**，激励红线（AGENTS §9）一字不动。
- **分发型协作未做但可做**：把一个清单的密钥包装给成员的公钥、密文照旧只存服务端——它不需要服务端读明文。旧断言的隐含前提是「单账号单 root key」架构（ADR-0050），不是 E2EE 本身。业界同形态：Etebase 的 collection key + memberships、信封式群密钥（RFC 9420 自己承认小群够用）。

本 ADR 把这两个概念正式拆开：前者仍然禁止，后者按下列裁决实施。ADR-0044 原文不动（ADR 只增不改），其排除清单的适用范围由本 ADR 收窄；对 `EVENT`（倒数日）实体的共享排除**继续有效**（不在本轮范围）。

## 决策

1. **共享粒度 = 清单**。产品负责人 2026-10-08 拍板（十二条裁决见计划 §1）。任务级共享不做。
2. **密钥层级**：每用户新增身份密钥对（Ed25519 签名 + X25519 封装；私钥由 vault root key 包裹存服务端、解锁会话内可用，公钥入 `IdentityKey` 目录——形状照 `AutomationRecipientKey` 的 userId 单主键 + keyEpoch 轮换）。每个共享清单一把随机 256-bit `listKey`，share 内 op 密文用 `HKDF(listKey, purpose='share-sync', keyEpoch)` 派生（`VAULT_KEY_PURPOSES` 增项）；`ShareMemberKeyEnvelope` 用成员加密公钥把 listKey 包成信封分发。**vault root key 体系（ADR-0050）不动**，share 密钥是它旁边的新层。
3. **移除即 rekey**：移除成员 = 服务端删成员资格（管门）+ owner 换新 listKey（keyEpoch+1）分发剩余成员 + 历史 op 全量重加密（照 ADR-0050 staging 迁移的 inventory/chunks/commit 形状：原子发布、可续传、幂等回执）。只改门不 rekey 被拒绝——旧成员留着的副本仍可解旧密文，等于把架构成本转嫁给用户信任。
4. **share op-log 独立分区**：新 `ShareOperation` 表与 `/api/shares/*` 端点族；个人 op-log 与 `Operation` 表一个字节不动。共享清单内的业务实体（TASK/PROJECT/TAG/NOTE/COMMENT）op 全进 share log，物化进同一 `MaterializedState` 的分区，reducer 目标零改动；**个人偏好实体（REMINDER/FOCUS_SESSION/PREFERENCE_CORRECTION）留个人 log**、引用共享实体 id——「提醒是每成员自己的」，与滴答的任务提醒四档（个人设置）一致。写入路由住在 `packages/app-host`（AGENTS §3.5），`apps/*` 不出现这个判断。向量时钟在 share 域独立、rekey 时 epoch 重置（`MAX_VECTOR_CLOCK_SIZE=100` 的墙见计划 B-1，不调 MAX）。
5. **op 作者身份与逐 op 签名**：加密 payload 增 `authorUserId + authorIdentityKeyEpoch + authorDisplayNameSnapshot`；每条 op 附 Ed25519 签名（覆盖 op 身份 AAD ∥ 密文 tag）。理由：所有成员都持有 listKey、都能伪造别人的 op，签名是「谁改的」唯一可信来源；任务/清单动态从 op 流投影（事件溯源红利），验签失败标「无法验证作者」。LWW 平局保持 `(timestamp, clientId)`，收敛语义不变；被覆盖方可从 op 历史恢复（静默 LWW + 可追溯 + 可恢复，不弹冲突框）。
6. **权限双层**：服务端按 role 硬拒写（editor 全部共享实体 / commenter 仅 COMMENT / viewer 全拒——`entityType` 是既有明文元数据，此门可行）；客户端 UI 是软约束（「有副本者无法被阻止本地修改，他人可选择是否订阅」——Ink & Switch 权限哲学）。成员上限 29（对齐滴答）。
7. **通知 = 盲推信号 + 本地过滤**：服务端只按 shareId 广播「有新 op」信号（延续「WS 只传信号」安全契约），成员端拉取解密后按**本地**偏好决定是否提醒；`assignee` 不进明文元数据。通知偏好（三档默认通知 / 四档任务提醒 / 自动接受已知合作者）存本地，服务端零知识。离线推送 v1 不做（基础设施为零，登记边界）。
8. **付费墙**：`ENTITLEMENT_CAPABILITIES` 增 `'sharing'`；owner 的 hosting 有效即可共享，成员免费（照滴答「只需所有者是高级会员」）；自托管 sharing 恒真（ADR-0017「自建永久免费」）。
9. **身份按共享空间作用域**：成员昵称/头像做成 per-share 名片（list key 加密、只对成员可见）。**不建**按他人身份查资料的全局端点——`User.displayName`「今天只有本人能读」的纪律延续，只是行为从「只有本人」扩为「本人 + 各共享空间的成员」。

## 拒绝的方案

- **MLS（RFC 9420）**：≤29 人、低成员变更场景信封式足够，rekey 成本 O(成员数)×低频；TreeKEM 复杂度不值。留作远期升级路径。
- **任务级共享**：认知负载与通知归属爆炸；滴答形态已验证清单级。
- **链接即密钥**：密钥进 URL = 泄露即永久、无法撤回「知识」。链接只做一次性、可吊销、可过期的入群凭证，密钥走公钥信封。
- **只改门不 rekey**：见决策 3。
- **字段级合并 / CRDT**：保持 LWW 整字段覆盖（与单人语义一致、滴答同款）；可恢复性由 op 历史提供，不引入 CRDT。
- **服务端聚合型协作**（排行榜/组队/防作弊）：红线不动。
- **跨服务器联邦**（自托管 A ↔ 官方 B 共享）：不做，成员必须在同一服务器。

## 后果

- 服务端新增明文元数据类别：成员关系、share 存在性、role（`entityType`/时间戳为既有类）。按 AGENTS 规则 18，隐私文档（`privacy.ts:481` 的「没有共享清单、没有评论」承诺句、11 项元数据清单）、`third-parties.ts`（PIPL 23 单独同意评估）、`data-rights.ts`（注销时他人副本边界）须**中英同步**改写并升版本（计划 §5）。
- `COMMENT` 新实体上线必须**服务端先于客户端**（同 ADR-0044 ② 的部署顺序：老服务端遇未知 entityType 硬拒 `INVALID_ENTITY_TYPE`）。
- 新第三方依赖（Ed25519/X25519，候选 `@noble/curves`）必须先过可维护性（2021 后持续更新）+ 许可证两道门并登记（AGENTS §3.1/§3.2）。
- 边界与风险（向量时钟墙、离线推送、PIPL 23、撞车面等 B-1–B-9）登记在计划 §6，不在本 ADR 重复。

## 验证

尚无实现（本 ADR 立于实施前）。判据与变异臂按计划 §4 的 `verify:collab-*` 矩阵执行；密文类判据沿用 ADR-0050 的形状（重建实例续传、journal 不含密钥材料、幂等重加密）。
