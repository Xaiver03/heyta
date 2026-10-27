# ADR-0062：共享清单走密钥分发型协作（per-list key + 成员公钥信封）

> 状态：**已接受（产品决策 2026-10-08）；实施进行中（2026-10-16 更正原来的「实施未开始」）**。
> 已落地：服务端 shares 表与端点族 + role 硬门、listKey 与成员公钥信封、Web 宿主的创建共享 / 邀请 / 成员角色 / 所有权转让 / 入群链接落点。
> 🔴 **这一格曾长期是"未落地"**（2026-10-16 与 2026-10-22 两次现量分别写下：客户端 share op-log 引擎与多写者路由从未接线、
> `uploadOps`/`downloadOps` 零生产消费者、`listKey` 解出后不喂给任何解密引擎 ⇒ **成员眼里仍是一条空清单**）。
> ✅ **2026-10-26 起这句不再是现状，只作为历史保留**：那枚"这一行属于哪份共享"的接线点在两壳都在（现量
> `git grep -n "setProjectShareId(" -- apps/mobile/src apps/web/src`），多写者路由已按族通到界面
> （**下行**三族在手机上都有真机读数：任务 L2 / 评论 L3·L5 / 便签 L9，最后一枚 2026-10-26 第 39 跑取到，
> 并配了变异臂 —— 注回「物化时丢掉便签那一族」后整链只有 L9 红，第 40 跑）；
> ✅ **上行也不再只有评论那一族**（2026-10-27 第十批）：新建时的落点控件接在任务面板与便签板上
> （`CaptureComposer` 的 `projectPicker` + 共享层 `CaptureSubmitPlan.projectId`），设备腿 **L10**（任务）
> 与 **L11**（便签）各判到 owner 侧从共享日志读回并验签，两族各配一枚变异臂（任务那一族把共享层
> `withCaptureProject` 退化成"丢掉落点"⇒ 整链只有 L10 红，第 43 跑；便签那一族把宿主
> `createNote(content, { projectId })` 那行退化成永远交 `{}` ⇒ 整链只有 L11 红，第 47 跑）
> ⇒ 逐格读数与形状在本线计划 §9.16。
> 🔴 **仍缺的那半是"事后改归属"**：`setNoteProject`（把一条**已有**便签挪进别的清单）在两壳仍零调用点，
> `listKey` 解出后确实喂进解密引擎（现量 `git grep -c "listKey" -- apps/mobile/src apps/web/src`），
> 成员在**真机**上看得见别的设备写的内容（`pnpm verify:mobile-collab:ios` 的 L2/L5 两格，逐格读数在本线计划
> [§9.14 与 §9.15](../plans/collaboration-shared-lists.md)）。逐条证据仍在[进度](../agents/progress-log.md)的「协作与共享清单」一节。
> ⚠️ 那段历史里的两个细节留下来了，因为它们各自解释过"为什么当时不能算落地"：评论族的 `uploadOps`/`downloadOps`
> 在 2026-10-22 各有一个生产消费者（`packages/app-host/src/share-comments.ts`）而多写者路由仍零；
> 而"评论区在 web 只挂在任务详情上"那枚读数当时用的命令是 `grep -rn ShareCommentsSection apps` ——
> **这条命令今天不要照抄**：整个 `apps` 的分母里混着 `apps/*/dist` 的打包产物，扫出来的命中与源码命中不是一回事，
> 要看源码命中请用 `git grep -n <名字> -- apps/<壳>/src`。本 ADR 的裁决一个字没动。
> 证据见[共享清单调研](../research/collaboration-shared-lists.md)，落地计划（W0–W6）见 [collaboration-shared-lists.md](../plans/collaboration-shared-lists.md)。本 ADR 只记裁决。

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

---

## 实施记录（2026-10-24 追加；只登记与本文措辞的差，不改上面任何一条裁决）

**「验证」那一节那句「尚无实现」已经不成立** —— 从 M1 到 M6 六批落地，逐批读数在
[计划 §9.7–§9.15](../plans/collaboration-shared-lists.md)。这里只登记**下面这几处**会被本文措辞误导人的差：

1. **决策 4 里那句「与滴答的任务提醒四档（个人设置）一致」** —— 四档**没有实现，也不会实现**：
   它判的是 `Task.assigneeUserId`，那个字段全仓零写点（现量
   `grep -rn "assigneeUserId" packages apps server --include='*.ts*' | grep -v tests`）。
   2026-10-24 连同谓词与界面档位一起撤下（`bc20e679a`）。
   🔴 这一条动的是**决策 7 那句括号里的偏好清单**：三档今天只剩**活动那一族**一档。
   裁决本身（"偏好存本地、服务端零知识"）一个字没改 —— 改的是"哪几档有输入"这个事实。
   钉子：`packages/ui/tests/notification-model.spec.ts` 那句「默认偏好里只有 activities 一个键」；
   反向臂（界面上不许再摆那两档）在 `scripts/verify-mobile-collab-ios.sh` 第 10 步。
2. **决策 7 那句「服务端只按 shareId 广播『有新 op』信号」** —— 今天有两类信号，
   另一类是成员名册变化（`share_roster_changed`，[ADR-0070](0070-share-roster-changed-signal-replaces-polling.md)），
   它替代的是面板那两枚 3s 轮询。"服务端零知识"这条边界没动：两类信号都不带内容。
3. **「成员眼里仍是一条空清单」这个结论（头部那段 ⚠️）已经不成立** ——
   多写者路由（`TASK`/`NOTE`）在 M2 接上（决策 4 要求它住在 `packages/app-host`，实测就住在
   `share-routing.ts`，壳里没有第二份判断），移动端在 M6 接上。
   判"成员眼里到底看得见什么"的那把尺现在有两枚：web 那台真浏览器
   （`pnpm verify:collab-journey`）与 iOS 那台真模拟器（`pnpm verify:mobile-collab:ios`）。
4. **决策 3 那句「listKey 用 vault 的载荷信封加密后落盘」在移动端的落点，比本文写的更窄** ——
   本文没规定"落哪一格"，M6 第一版把它接到了 `VaultSecureStorage` 的 root-key 那对接口上，
   真机一按就拒：那对接口**两端都校验"恰好 32 字节"**（截断的 root key 必须失败，不许解出垃圾），
   而 `heyta.share-keys.v1` 是变长 JSON。所以原生模块（iOS Keychain / Android Keystore 同一形状）
   开了一对**变长通道** `loadBlob`/`saveBlob`，root-key 那对一字未动 ——
   `apps/mobile/evidence/ios-keychain-probe-invalid.json` 那枚探针依赖的正是"非法长度必拒"。
   裁决（vault 包裹、不发明第二条密钥生命周期、锁定向）没动；动的是"移动端的格子长什么样"。
   钉子与实测读数：环境陷阱 #559、计划 §9.13、`apps/mobile/tests/vault-secure-storage.spec.ts`
   那组 blob 用例（形状纪律）+ 移动旅程装置（契约本身只有真机量得到）。

5. **决策 7 只写了"有新 op ⇒ 信号 ⇒ 拉取"，那句话不足以让新成员看见存量** ——
   2026-10-25 iOS 设备腿 L2 实测：成员已经加入、名册与清单密钥都到位了，界面上仍是一条空清单，
   因为 `new_share_ops` 只在**有人新写**时响，而"加入之前就在清单里的那些 op"没有任何一条携带路径。
   这不是决策 7 写错，是它**没覆盖**那一格：信号是"变化通知"，不是"收敛保证"。
   ⇒ 补一条口径：**打开一份共享 ⇒ 拉一次既有下行**（判据本体 `pullSharedListOnOpen` 住
   `packages/app-host`，两壳各自只做投递；移动端 `ShareSpaceScreen` 只按选中的那份触发，
   web 由"当前停在哪个清单行"触发）。拉不成不许抛穿、但要留 `error` 读数 ——
   锁着的保险库不是一次错误，是一次"这一刻问不到"。
   裁决（本地优先、服务端不是事实源、游标每份 share 一份）没动；动的是"什么时候去问"。
   钉子与实测读数：计划 §9.14「本批修掉的四处产品缺陷」第 4 条、
   `research/tools/mutation-rigs/mutate-collab-open-pull.mjs`（五臂，含两臂专摘调用点）、
   环境陷阱 #575（设备腿锚点形状）/#576（构建新鲜度尺与变异还原的相互作用）。

6. **决策 1/2 那套"所有者建 share ⇒ 自己封钥 ⇒ 给成员发信封"此前只在 node 那侧走过** ——
   移动端 M6 接上的是**成员**那一侧（接受邀请时解信封），而**所有者**那一侧（在手机上把自己
   的一条清单设为共享）此前从未在任何真设备上走过一次：界面、生产装配、`sealListKeyForRecipient`
   + `putMemberEnvelope` + `putMemberSigningKey` + `bindProjectShare` 都在，欠的只是有人真按一次。
   ⇒ 2026-10-26 第 35 跑补上这一格（`pnpm verify:mobile-collab:ios` 第 10b 步 L7）：手机自己建清单
   → 同意闸 → 建 share → 签发一张邀请 → 服务端读回 `role=owner` 且**所有者行带签名公钥**、活邀请 1 张
   → 撤销回到无邀请态。裁决没动，动的是"这一侧有没有真被验过"。
   ⚠️ 撞出来的两枚相邻缺陷：装置替 owner 写 op 时把作者字段兜成了 memberId（#577，产品没写错），
   以及"这台账号名下一条自己的清单都没有"这件事此前被装置写成 `exit 3` —— 而产品定义里
   「手机用户能建清单」那一格正因如此从没被验过（#579）。钉子与逐格读数：计划 §9.14
   「第 35 跑新增的两格」。

7. **决策 7 那句「按本机偏好决定要不要吵」此前在手机上只有生产者、没有消费者** ——
   投递把活动写进内存动态，而全仓没有任何界面读它（`mobile.inbox.tab.share` 等三枚词条在册零消费者）。
   2026-10-26 第九批补的是消费那一头：通知中心第三档「共享动态」+「我的」入口徽标
   （inbox 未读 **+** 共享动态未读）。**判断仍只有一份**（`@heyta/ui` 的 `selectNotifiedActivities`），
   壳里新增的只有"画哪一句"与"从本机那一行取清单名"（`apps/mobile/src/lib/share-activity-copy.ts`）。
   ⚠️ 系统横幅那一档**仍然做不到**：本机唯一那条原生通道被提醒链按 `categoryIdentifier` 全量回收，
   新开 category 要重装两端 = 别线在飞资产 ⇒ 今天"打扰用户"在手机上就是那一档 + 那枚徽标，
   `systemBanner` 端口留着可注入。设备腿 L8（两半相反）的读数在计划 §9.15。

7. **决策 8 那道同意闸在界面上的落点，此前只有模型层的牙** —— 判断只在 `@heyta/ui` 一处，而调用点有四处（web 入群对话框、手机入群屏、手机「开启共享」那一侧、模型本体）；
   "模型那 6 枚全绿"**不排斥**某一壳的那一行被整行摘掉 —— 摘掉之后那一壳直接进表单 / 直接建共享，纯逻辑判据一条都不会红。
   ⇒ 补一条口径：**这一格要有牙，钉的是"调用点在不在"，不是"判断对不对"**（后者一直钉着）。
   现在三层各有常驻判据（`packages/ui/tests/share-consent-model.spec.ts`、`apps/web/tests/share-join-consent-gate.spec.tsx`、
   `apps/mobile/tests/share-ui-assembly.spec.ts` 的 ⑨ 组），并由 `research/tools/mutation-rigs/mutate-collab-consent-gate.mjs`
   逐层证明能红（2026-10-27 首跑 `ARMS=pass (4/4)`，四臂红集精确匹配，读数在计划 §9.19）。
   裁决没动（PIPL 单独同意、fail-closed 方向、「没勾不再提示 ⇒ 每次还弹」的勾选语义）；动的是"这一格的牙现在量得到"。

8. **任务书里那两枚谓词（`shouldNotifyTaskReminder` / `shouldAutoAcceptInvitation`）按"撤下"结案，不是漏做** ——
   这条写在这里是为了让下一位不必再翻计划 §9.10 才能知道代码里为什么没有它们：
   `git grep -n "shouldNotifyTaskReminder\|shouldAutoAcceptInvitation" -- apps packages server scripts` 现量 = **零命中**。
   两枚各自的原因不同：
   ① 提醒那一枚**没有输入**——共享日志里没有"到期时间"这一族语义，替它编一个默认值就是让通知在吵；
   现在偏好模型只有一个键 `activities`（三类种类：新增／删除／完成），数据面接的就是这一族（`packages/ui/src/sync/notification-model.ts`）。
   ② 自动接受邀请那一枚**不该有**——加入一份共享在两个壳上都是用户按下"加入"那一下
   （移动端调用点 `apps/mobile/src/screens/JoinShareScreen.tsx`），把它自动化等于替用户同意，
   与决策 8 那道单独同意闸方向相反。
   ⇒ 所以这一格的正确交付形状是"没有这两枚谓词 + 各自的替代口径在册"，而不是"接上它们"。
   翻案条件：哪天共享条目带上真正的到期时间并决定要据此吵人，第 ① 条重新开；哪天产品决定接受邀请可以预先授权，第 ② 条重新开 —— 两条都要新写一份 ADR，不改本文这一条。

**仍然没有做到的（别把上面读成"全做完了"）**：库里存量 op 不追签（ADR-0069 裁决二/三）；
旧密文在 rekey 后不重加密（追加模型的代价，边界写在 `share-rekey.ts` 文件头）；
Android 那一侧的界面腿读数本批没开（出包与设备腿按负责人的长期令一律走 `ssh windows-pc`）。
