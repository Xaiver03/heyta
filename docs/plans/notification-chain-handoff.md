# 通知链路：交接与缺口清单

> 状态：**进行中**（交接文档，2026-11-02 只读调研产出；本文件不含实施）

**这份文档给谁**：接手"把通知链路做完"的执行者（人或 AI）。**读完能干什么**：知道仓里通知相关的每一块落在哪个文件、哪几段是真的、哪几段只是骨架、哪几件必须产品负责人先拍；并且拿到一份可以逐条派工的缺口清单（每条带能判红的验收），不必再把 `server/src`、`apps/*/src`、`docs/adr` 重新读一遍。

读法：§3 是主体，其余是它的依据。**行号是 2026-11-02 工作树读数** —— `docs/plans/README.md` §七 第 4 条明确"不引用行号作为定位手段"，本文件为了可核对仍然写了，但**每条开工前必须 `grep -n` 复跑**（先例：`docs/plans/trash-and-archive-execution-brief.md` 的"行号是工作树读数"那条）。查不到的事实本文件写"未找到"或"未核实"，不推测。

---

## §1 现状盘点

| 能力 | 落点文件 | 状态 |
|---|---|---|
| 账号级通知表 | `server/prisma/schema.prisma:1570` `model AccountNotification` | 已落地 |
| 通知写入/读取/标记已读 | `server/src/activity/notifications.ts:71` `:92` `:132` | 已落地 |
| 通知 HTTP 面（列表/已读/活动） | `server/src/activity/activity.routes.ts:69` `:98` `:131` | 已落地 |
| 通知 kind 封闭词表 | `packages/domain/src/activity.ts:235`（**只有 `'referral-activated'` 一项**） | 已落地（词表极窄） |
| 通知写入的**唯一**生产调用点 | `server/src/activity/invite.ts:320` | 已落地（仅邀请结算一处） |
| Web 铃铛 + 通知/活动面板（2 tab）+ 未读 store | `apps/web/src/features/inbox/InboxBell.tsx:63`（tab 表 `:66`）、`apps/web/src/features/inbox/store.ts` | 已落地 |
| 移动通知中心（3 tab：通知/活动/共享动态） | `apps/mobile/src/screens/NotificationsScreen.tsx:81` | 已落地 |
| 移动「我的」未读徽标 | `apps/mobile/src/screens/ProfileScreen.tsx:489`（`inboxBadge = inboxUnread + shareUnread`） | 已落地 |
| Web Push 密码学（RFC 8291 加密 / RFC 8292 VAPID） | `server/src/push/push-crypto.ts`、`server/src/push/vapid.ts` | 已落地 |
| Web Push 发送 | `server/src/push/sender.ts:107`（四档 outcome `:157`–`:172`） | 已落地 |
| Web Push 订阅登记/注销/公钥 | `server/src/push/push.routes.ts:152` `:160` `:196` | 已落地 |
| 订阅表 + 失效回收 | `schema.prisma:1327`；`server/src/push/subscriptions.ts:81`（阈值 5）、`:241` | 已落地 |
| 推送触发点 | `server/src/sync/sync.routes.ops-handler.ts:449`（同步热路径 fire-and-forget） | 已落地（**只有这一处**） |
| 推送载荷 | `server/src/push/notify.ts:43` `{type:'heyta:widget-refresh'}` | 已落地（**零用户内容**） |
| 浏览器侧订阅 | `apps/web/src/pwa/push-subscribe.ts`；SW 监听 `apps/web/src/pwa/sw.ts:400` | 已落地 |
| 推送设置开关 | `apps/web/src/features/settings/WidgetPushPanel.tsx` | 已落地 |
| **APNs / FCM / 厂商通道** | — | **缺失**（全仓 0 命中，复跑命令见 §6 末） |
| 邮件：认证生命周期 11 封 | `server/src/email.ts:131` 起，末封 `:435` | 已落地 |
| 邮件：**通知类**（被邀请/被评论/被移除） | — | **缺失**（`grep -ni -e invite -e share -e comment server/src/email.ts` ⇒ 0） |
| 提醒投递 · Web（前台） | `apps/web/src/features/reminders/notify.ts:15`–`:28` | 已落地（应用不开就不响） |
| 提醒投递 · 移动原生 | `apps/mobile/src/lib/reminder-native.ts:44`、`apps/mobile/src/lib/native-reminder-scheduler.ts:21` | 已落地（ADR-0051） |
| 提醒投递 · 三枚桌面壳 | `apps/web/src/features/reminders/shell-reminder-center.ts:21`；`apps/desktop-windows/HeytaWindows/ReminderPort.cs:1`；`apps/desktop-macos/Sources/HeytaShellCore/ReminderPort.swift` | 已落地 |
| 共享活动 → Web 系统通知 | `apps/web/src/features/share/share-activity-notify.ts:29` | 已落地 |
| 共享活动 → **移动系统横幅** | `apps/mobile/src/share/share-activity-notify.ts:12`–`:32` | **骨架**（端口留口，投不出去） |
| 通知偏好模型（活动三档） | `packages/ui/src/sync/notification-model.ts:33` `:37` | 已落地（**唯一一族**） |
| 偏好落盘 | `apps/web/src/features/share/share-notif-prefs.ts:13`（键 `heyta.share-notif-prefs.v1`） | 已落地（仅本地） |
| 成员面变更信号 | `server/src/shares/share.routes.ts:1039` → `server/src/sync/services/websocket-connection.service.ts:468` | **骨架**（只触发重取，不产生任何通知） |
| 运营公告（明文的另一条通道） | `server/src/announcements/announcement.routes.ts:31`；ADR-0075 §3 | 已落地（**不是通知**，别混） |
| **@ 提及** | — | **缺失**（0 命中，命令见 §6） |
| **评论 → 通知** | — | **缺失**（无任何路径） |

---

## §2 数据与契约

**通知的形状**（`schema.prisma:1570`–`:1594`）：`id` / `userId` / `kind`（String，无 enum 约束）/ `payload`（`Json @default("{}")`）/ `createdAt`（BigInt epoch ms）/ `readAt`（BigInt?）。索引 `[userId, createdAt]`。**没有 `pushedAt`、没有投递状态列** —— 见缺口 N-04。

**三个状态词的准确含义**：
- **未读** = `readAt IS NULL`（`notifications.ts:108` 的 `count`）。用时间戳不是布尔，理由写在 `schema.prisma:1585`。
- **已推送** —— **未找到任何字段**。`WidgetPushSubscription.lastUsedAt`（`schema.prisma:1346`）记的是"最后一次成功发送"，粒度是**订阅**不是**通知**，且与具体某条通知无关联。
- **失败** = `WidgetPushSubscription.failureCount`（`schema.prisma:1342`），阈值 `PUSH_FAILURE_THRESHOLD = 5`（`subscriptions.ts:81`）；`404/410` 直接删行（`sender.ts:157`）。

**明文/密文的边界（现行事实，不是推测）**：

| 数据 | 服务端可读？ | 依据 |
|---|---|---|
| 任务/清单/便签正文、评论正文 | **取决于账号 `payload_mode`，默认「可读」** | `schema.prisma:301` `payloadMode @default("readable")`；ADR-0081 §一；服务端 `server/src/sync/services/payload-mode.service.ts:26` |
| 用户名/邮箱 | 明文 | `schema.prisma:13` 起 `model User` |
| 昵称/头像 | **明文**（2026-11-01 起） | ADR-0079 §一 |
| 通知 `payload` | 明文 `Json` | `schema.prisma:1581` |
| 推送载荷 | **零内容**（固定串） | `push/notify.ts:23`–`:43`；法务同口径 `packages/legal/src/documents/privacy.ts:332` |
| WS 共享信号 | 只有 `shareId` + `latestSeq`，无内容 | `websocket-connection.service.ts:441`–`:455`、`:468` |

🔴 **`account_notifications.payload` 里今天已经有第三方明文**：`{ displayName, days }`，其中 `displayName` 是被邀请人**邮箱 `@` 之前的片段**（`invite.ts:323` → `packages/domain/src/activity.ts:273`）。这是"通知载荷可以带明文"的**现成先例**，法务也已披露（`privacy.ts:243` 明确写"含第三人数据：被邀请人的邮箱…取其 `@` 之前的部分作为展示名快照")。所以 §4 的 D-1 不是"能不能带明文"的首次决定，而是"**哪一类**明文可以带"。

**系统通知正文的口径已经拍过了**：ADR-0071 §三裁决二 —— 允许「清单名 + 活动种类」，**禁止**任务标题、评论正文、便签内容。理由是系统通知中心（iOS 通知历史 / 通知转发 / 锁屏）**不在本产品的信任边界内**。裁决三把"允许"绑在**本机同意 + 本机偏好**两道闸上。翻案条件写死在 §五末：必须先新写一份 ADR 推翻裁决二。

**提醒与通知是两套，边界在"数据从哪来"**：
- 提醒的**投递件**在客户端（`apps/web/src/features/reminders/notify.ts:37`），因为它手里有解密后的任务标题；推送载荷拿不到（`notify.ts:17`–`:21`）。
- 提醒的**事实**在 op-log 的 `REMINDER` 实体（`packages/shared-schema/src/entity-types.ts:31`），走 E2EE 同步；`firedAt` 回执也是 op（ADR-0051 §决定）。
- 通知的事实**在服务端**（`account_notifications`），因为它必须由服务端"本来就知道"的事产生（`notifications.ts:4`–`:8`）。
- **重复在哪**：两套各自有一份"该不该打扰用户"的判断，且**不共享模型** —— 通知中心那份是 `ShareNotificationPrefs`（`notification-model.ts:33`），提醒那份是每任务每提醒的 trigger（`REMINDER` 实体字段）+ 平台闸门（`apps/mobile/src/lib/reminder-delivery-display.ts`）。这是刻意的（事件在密文里、服务端无法过滤），但**设置页把它们摆在同一个 `settings-group-notifications` 里**（`apps/web/src/App.tsx:306`、`:3490`–`:3517`），于是"我在设置里关掉的到底是哪一种"在界面上没有被说清 —— 见缺口 N-09。

---

## §3 缺口清单

> 每条都能直接派给一个 AI。判据一律是可跑命令或可观察现象；**条数不要抄，脚本自己打印**（`docs/agents/workflow-rules.md` 同一条纪律）。

**N-01 把 `NOTIFICATION_KINDS` 从 1 项扩成真实词表，并把 kind 从裸 `String` 收成可校验**
- 做什么：`packages/domain/src/activity.ts:235` 扩词表；`server/src/activity/notifications.ts:23` 的 `AccountNotificationKind` 与之同源；给 `payload` 写逐 kind 的解析器（照 `:290` `parseReferralActivatedPayload` 的形状），调用点解析失败就**跳过整条**（`schema.prisma:1576` 已要求老客户端优雅跳过）。
- 为什么：今天通知中心只能显示一种事件，所以"通知中心"这个界面在事实上是一个"邀请奖励详情页"。这不是"更完善"，是**界面名和内容对不上**。
- 依赖：无硬依赖；但**词表内容**取决于 D-2 与 N-02/N-03 最终要落哪几种事件。
- 判据：`cd packages/domain && npx vitest run tests/activity.spec.ts`；变异臂 —— 把词表加一项但**不**加解析器 ⇒ 新写的"未知 kind 整条跳过"用例必须红；`cd server && npx vitest run tests/activity-routes.spec.ts`。

**N-02 共享协作的三件事落 `account_notifications`（服务端已知事实）**
- 做什么：在 `server/src/shares/share.routes.ts` 的 ① 邀请接受（`:450` accept 分支，写 owner 的通知）② 成员被移除（`:707`）③ 角色变更（`:604` `PUT /shares/:shareId/members/:memberId`，role 判定在 `:610`）三处，**在同一个事务里**调 `createNotification`（照 `invite.ts:311`–`:325` 的用法：发奖与通知同生共死）。新增 kind 至少三种。`payload` 只放**服务端已有**的字段：`shareId`、操作者 `displayName`（口径同 §2 那条先例）、角色名。
- 为什么：`docs/plans/collaboration-shared-lists.md:113` 早就把这条写成设计（"邀请 / 被移除 / 角色变更这些服务端已知事实落 `account_notifications`"），而代码里 `createNotification` 只有 `invite.ts:320` 一个调用点 ⇒ **设计在册、实现为零**。
- 依赖：N-01（词表）。**不需要** E2EE 密钥。
- 判据：`cd server && npx vitest run tests/activity-routes.spec.ts`；新增断言"accept 之后 owner 的 `GET /api/notifications` 多一条、`payload` 不含任何任务/评论文本"；变异臂 —— 把 `createNotification` 从 accept 分支删掉 ⇒ 该断言红。另需 `node scripts/check-reachable*`（见 §6）不退化。

**N-03 评论与 @ 提及产生通知（先回答问题：@ 到底要不要让服务端知道）**
- 做什么：**在 D-2 拍完之后**才动手。若采用"服务端知道"的方案：给 `COMMENT` 的 op 增加**明文元数据白名单**（`mentions: userId[]`），服务端在 `server/src/shares/share.routes.ts:812`（`POST /shares/:shareId/ops`）落库时读它、写 `account_notifications`。若采用"服务端不知道"：只在客户端由 `apps/web/src/features/share/use-share-activity-signal.ts:38` 那条链投**本机**通知，服务端零改动。
- 为什么：`docs/plans/collaboration-shared-lists.md:546`–`:549` 明确登记"指派/@/评论回复两档**仍然没有输入**"；`COMMENT` 只在 share op-log、正文加密（`entity-types.ts:114` 及其注释）。今天"别人评论了我的清单"在服务端**没有任何路径**（`grep -rn "createNotification" server/src` 只有 `invite.ts`）。
- 依赖：D-2 拍板；N-02 的 kind 机制。
- 判据：真浏览器全旅程 `pnpm verify:collab-journey`（在两台浏览器里 A 评论 → B 侧出现一条通知，截图有固定路径且人看过）；`pnpm check:reachability` rc=0。

**N-04 给通知加投递状态，否则"已推送"永远无法回答**
- 做什么：`account_notifications` 增**可选**列 `pushedAt BigInt?`（🔴 可选 + 运行时默认，禁 bump `CURRENT_SCHEMA_VERSION` —— `docs/agents/hard-constraints.md` §3.3）；或新增 `notification_deliveries(notificationId, subscriptionId, outcome, at)` 一张表。写入点在 §1 那个唯一推送触发点旁边。
- 为什么：今天 `deliverWidgetPushToUser` 只回"这次发了几条/删了几条"（`push/notify.ts:175`–`:179`），**与哪条通知无关**；而 `notifyWidgetSubscribers` 的载荷是固定串，本来就不对应任何一条通知。所以"这条通知推送过没有"在库里**不可回答** —— 做运维对账、做"推送失败回退邮件"都缺这一格。
- 依赖：无。可与 N-02 并行。
- 判据：迁移走 `cd server && sh scripts/migrate-deploy.sh`（**不许** `prisma migrate deploy`，`docs/agents/db-migrations.md`）；`pnpm check:migrations` + `pnpm check:schema-migration-drift` rc=0；单测断言"发一条推送后该列/该行有值，未配置 VAPID 时**仍是 null**"（对齐 `push/notify.ts:117` 的零查询纪律）。

**N-05 把"通知"从"仅小组件刷新"里拆出来（推送语义分级）**
- 做什么：`server/src/push/notify.ts:43` 现在是唯一载荷。新增一种载荷 `{type:'heyta:notify', count:N}`（**仍然零内容**），SW `apps/web/src/pwa/sw.ts:400` 收到后遍历客户端发 `heyta:push`，页面侧拉 `GET /api/notifications` 并投一条本机系统通知。
- 为什么：今天推送的唯一后果是"叫醒页面刷新小组件"（`notify.ts:18`–`:21`）；用户**不会因为收到推送而看到任何通知**。所以"手机/桌面在应用关着的时候收到'有人邀请你'"这条产品承诺今天**完全不成立**。
- 依赖：N-04（要说清投了哪条）；D-1 拍板（正文能说什么）。
- 判据：`pnpm verify:realtime-push` 扩一条：推一条 `heyta:notify` ⇒ 页面侧 `Notification` 被构造一次（注入 ctor 计数），且构造出的 `body` 里**不含**任何任务标题（用一条含特征串的 fixture 任务，断言 `body.indexOf(fixture) === -1`）。

**N-06 移动端系统横幅：给共享活动/通知一枚自己的身份**
- 做什么：iOS 第二枚 `categoryIdentifier` + 一条**不写提醒台账**的投递入口；Android 第二条 channel。落点是 `apps/mobile/src/share/share-activity-notify.ts:25`–`:32` 已经写明的那两步，实现改在 `apps/mobile/ios/Heyta/HeytaReminderModule.swift` 与 `apps/mobile/android/app/src/main/java/com/heytamobile/reminder/ReminderModule.kt`。
- 为什么：`apps/mobile/src/share/share-activity-notify.ts:16`–`:23` 写明"借道会被 `cancelStale` 当过期提醒摘掉"，所以移动端今天**做不到**系统横幅，只能进通知中心第三个 tab。而法务条款里"移动端使用系统本地通知"这句（`packages/legal/src/documents/permissions.ts:36`）已经对用户承诺了。
- 依赖：ADR-0051 的所有者（`apps/mobile/ios/Heyta` 是提醒线的资产）；D-3 拍板（要不要现在动）。
- 判据：`pnpm verify:mobile-reminder-ring` 不退化（提醒链没被弄坏）+ 新增一条：投一条共享活动 ⇒ 系统通知中心出现它，且**下一轮 reconcile 之后它还在**（这正是"借道"会红的那个现象）。⚠️ 需要重装两端（`docs/agents/multi-end-build.md`）。

**N-07 通知类邮件：至少一封"你被邀请加入共享清单"**
- 做什么：`server/src/email.ts` 新增一封，形状照 `:435` `sendAuthenticatorAddedEmail`（`deliver()` + i18n 词条 + 单跳转）。触发点在 `server/src/shares/share.routes.ts:372`（创建邀请）。收件地址**只能**来自服务端已有的行 —— 今天邀请面允许**离线分享链接**，那种情况没有收件地址，必须如实不发。
- 为什么：`email.ts` 的 11 封**全部**是认证生命周期，一封通知类都没有（`grep -niE "invite|share|comment" server/src/email.ts` ⇒ 0）。而"你被邀请"是唯一有明确收件箱语义的通知。
- 依赖：D-4（发不发邮件是产品决策，且要过 `check:legal-email-claims` 与隐私政策"十一封功能邮件"这句 —— `privacy.ts:207`，**改了邮件就得改那句**）。
- 判据：`pnpm check:legal-email-claims` rc=0；新增 `server/tests` 单测断言"离线链接邀请不发信、有地址的邀请发一封、SMTP 失败不影响邀请创建"（"一封通知发不出去不许把成功报成失败" —— `BLOCKED.md:8926` 同一条立场）。

**N-08 清理/对账任务：通知与死订阅都会无限增长**
- 做什么：在 `server/src/sync/cleanup.ts:222` `startCleanupJobs()` 的每日任务里加两条：① 删 `readAt` 早于 N 天的通知 ② 删 `failureCount` 触顶但推送服务没回 410 的订阅。
- 为什么：`account_notifications` 今天**没有任何清理**（`grep -rn "accountNotification.delete" server/src` ⇒ 0），而注销之外的用户生命周期里它只增不减。订阅侧 `subscriptions.ts:241` 只在**发送时**回收，从不发送的订阅永远留着。
- 依赖：无。
- 判据：`cd server && npx vitest run tests/`；单测直接跑那两个函数处理构造数据（照 `cleanup` 既有的"批/次节流"形状断言有界）；`pnpm check:backup-retention` 不退化。

**N-09 设置页把"通知"和"提醒"两套说清（现在它们在同一组里混着）**
- 做什么：`apps/web/src/App.tsx:3490`–`:3517` 那一节今天依次摆 `ReminderNotifyPanel`（提醒授权）+ `ShareNotificationSettings`（共享活动偏好）+ `WidgetPushPanel`（小组件后台刷新）。改成三段各带一句"这是什么、关了会怎样"，并把 `apps/mobile/src/screens/SettingsScreen.tsx` 对齐。
- 为什么：三件东西的**数据来源完全不同**（本机解密 / 本机偏好 / 服务端推送），但界面上是三个并排开关。用户无法回答"我关掉的是哪一种" —— 这是可观察的可用性缺陷，不是措辞洁癖。
- 依赖：N-05（推送具备通知语义之后，第三个开关才有意义）。
- 判据：`pnpm check:settings-prose` + `pnpm check:mobile-settings` rc=0；`check:e2e-settings-ids` 不退化；真浏览器/真模拟器截图落固定路径且**人看过**（`docs/agents/ui-acceptance.md`）。

**N-10 法务口径对账：隐私政策里"没有共享清单、没有评论"这句已经不成立**
- 做什么：`packages/legal/src/documents/privacy.ts:492`（zh）与 `:1102`（en）写着"不向其他用户展示你的内容（没有社区、**没有共享清单**、**没有评论**）"。共享清单与评论都已上线（`entity-types.ts:114`、`server/src/shares/`）。必须改写；顺带把"通知只装账号级事实"这段与 N-02/N-03 的新 kind 对齐。
- 为什么：通知链路一旦开始说"有人评论了你的清单"，这句就成了**对外承诺与产品行为的直接矛盾**，且它今天**已经是假的**。
- 依赖：无（可以在 N-02 之前做）。
- 判据：`pnpm check:legal-copy` + `pnpm check:legal-gdpr` + `pnpm check:legal-email-claims` rc=0；`node research/tools/docs-link-check.mjs` rc=0。

**N-11 `check:reachability` 盯不到"服务端产生的事件没有客户端读者"**
- 做什么：服务端新增的每个 kind，必须有客户端渲染分支。把这件事做成常驻判据：扫 `packages/domain/src/activity.ts` 的 `NOTIFICATION_KINDS` 与 `apps/web`/`apps/mobile` 的渲染 switch，缺一个就红。
- 为什么：`scripts/check-reachability.mjs:3` 只判"实体有没有 action / 调用点"，**判不到事件 kind**。而 kind 恰恰是最容易"服务端加了、客户端画白卡"的地方。
- 依赖：N-01。
- 判据：新门禁 `--self-test` 必须**会红**：把 `NOTIFICATION_KINDS` 加一项而不加渲染分支 ⇒ rc=1 且逐条点名；接进 `pnpm check` 链（`package.json` 的 `check` 那一串）并 `pnpm check:gate-wiring` rc=0。

**N-12 把本文件回登记进计划索引**
- 做什么：`docs/plans/README.md` 加一行（README 自己在 §「新增/移动文件后」要求登记）；状态行不抄进度（`:165` 那条纪律）。
- 为什么：`docs/plans/README.md` §七 第 1 条明确"新建一份计划要回本文件登记"，不登记就是孤儿文档。
- 依赖：本文件定稿。
- 判据：`node research/tools/docs-link-check.mjs` rc=0。

---

## §4 不可逆决策（要产品负责人拍）

**D-1 通知正文里放不放明文内容？**
- 甲（现状口径）：只放「清单名 + 活动种类」，条目内容一律不进（ADR-0071 §三裁决二）。**代价**：通知中心里多条同类事件长得一样，用户要点进去才知道是什么。
- 乙：`payload_mode === 'readable'` 的账号允许带任务标题/评论摘要，`e2ee` 账号不带。**代价**：同一句产品承诺分叉成两档（ADR-0081 §六已承认"服务端看不到明文"降为可选承诺）；系统通知中心这份明文会进入 OS 的通知历史与转发链路，**必须新写一份 ADR 推翻 ADR-0071 裁决二**（该 ADR §五末写死的翻案条件）。
- 丙：带清单名 + **条数**（"3 条新评论"），不带文本。**代价**：可用性只解决一半，但不动信任边界，且不需要推翻任何 ADR。

**D-2 @ 提及要不要让服务端知道谁被提到？**
- 甲：服务端知道（`COMMENT` op 带明文 `mentions: userId[]`）。**代价**：**元数据泄露** —— 服务端从此掌握"谁在什么时候提到了谁"，这与 ADR-0062 决策 7「服务端零知识 + 盲推 + 本机过滤」直接冲突，必须新写 ADR；好处是移动端/离线也能收到 @ 通知。
- 乙：服务端不知道，只由客户端在收到 `new_share_ops` 后解密、自己判断并投本机通知。**代价**：设备不在线 = 收不到（与"离线推送 v1 不做"`docs/plans/collaboration-shared-lists.md:114` 的边界一致）；实现上**不需要**服务端改动。
- 丙：折中 —— 服务端只知道"这条 op 带 mention 标记"、不知道是谁。**代价**：能触发推送但不能定位收件人，用处有限；仍需一次 ADR。

**D-3 移动端系统横幅现在做还是等**
- 甲：现在做（新增 iOS category + Android channel），照 N-06。**代价**：动提醒线的原生资产 + 重装两端；iOS 的 category 绑定点不止一处（`apps/mobile/src/share/share-activity-notify.ts:27` 给了现量命令）。
- 乙：等提醒线的设备验收收尾再做。**代价**：移动端"投了没人看"的状态继续（`NotificationsScreen.tsx:12`–`:16` 自己写了这条）。

**D-4 通知发不发邮件**
- 甲：只发"你被邀请"。**代价**：要改隐私政策"十一封功能邮件"那句（`privacy.ts:207`）与 `check:legal-email-claims`。
- 乙：完全不发。**代价**：收件箱是唯一能触达"还没装应用的人"的通道，等于放弃邀请的冷启动。
- 丙：只发"安全类"（现状），通知类一律不发。**代价**：与甲相反的一侧，`email.ts` 保持纯认证定位。

**D-5 提醒与通知要不要合并成一套偏好模型**
- 甲：不合并（现状）。**代价**：设置页要解释两套（N-09 就是在补这个解释）。
- 乙：合并成一个"通知偏好"模型，垂直到两类。**代价**：提醒的 trigger 在 op-log 里、偏好存本地会让"同一账号两台设备偏好不同"（今天已经如此，`share-notif-prefs.ts:8`）；合并等于把这个不一致放大到提醒上。

---

## §5 执行顺序

**硬顺序（有前例，违反会静默坏）**：
1. **服务端必须先于客户端上线** —— 仓里有这个前例两次：`EVENT` 实体（`packages/shared-schema/src/entity-types.ts:37`–`:38` 原文写着"🔴 但服务端必须先于客户端上线 —— 老服务端的白名单里没有它，会把该 op 判成 `INVALID_ENTITY_TYPE` 永久拒绝"）与 `ASSISTANT_TURN`/`COMMENT`（同文件 `:93`、`:114`）。判据在 `server/src/sync/services/validation.service.ts:111`。⇒ **N-03 若走"op 带明文 mentions"那条，服务端的白名单与校验必须先落地。**
2. **迁移先于读写代码**：N-04 的列必须先 `sh scripts/migrate-deploy.sh`（`docs/agents/db-migrations.md`），且列必须**可选**（`hard-constraints.md` §3.3）。
3. **N-10（法务）先于 N-03**：否则新通知会让一句已经是假的话更假。

**可并行的三组**：
- 组 A（服务端事件面）：N-01 → N-02、N-08。互不依赖迁移。
- 组 B（投递面）：N-04 → N-05 → N-09。N-04 是 05/09 的前置。
- 组 C（平台与文案）：N-10、N-06、N-07 三条互不依赖；其中 N-06 等 D-3、N-07 等 D-4，**N-10 不需要任何拍板**。

**必须等人拍才能开工**：N-03（D-2）、D-1 决定 N-05 的正文、D-3 决定 N-06、D-4 决定 N-07。
**能立刻开工且不需要任何拍板**：N-01、N-04、N-08、N-10、N-11、N-12。

---

## §6 交给执行者的开工须知

**必跑的门禁**（`check:` 开头、与通知/共享/提醒相关的那几条；从 `package.json` 现取，别抄别的文档）：
`pnpm check:reachability` · `pnpm check:ui-provider` · `pnpm check:empty-state` · `pnpm check:op-log-semantics` · `pnpm check:layering` · `pnpm check:i18n-vars` · `pnpm check:mobile-settings` · `pnpm check:settings-prose` · `pnpm check:share-entry-visible` · `pnpm check:collab-carrier` · `pnpm check:reminder-permission` · `pnpm check:legal-email-claims` · `pnpm check:legal-copy` · `pnpm check:gate-wiring` · `pnpm check:docs` · `pnpm check:md-tables` · `pnpm check:mobile-bundle`，以及面向设备的 `pnpm verify:realtime-push`、`pnpm verify:mobile-inbox`、`pnpm verify:mobile-reminder-ring`、`pnpm verify:collab-journey`。全链 `pnpm check` 的**段数是活数**，现量：`node -e 'console.log(require("./package.json").scripts.check.split(" && ").length)'` —— 不要把它抄进任何文档。

**改到哪会触发哪道闸**：
- `packages/shared-schema/`（实体清单/线协议）→ `pnpm check:claims`、`check:crosslang-contract`、`check:schema-migration-drift`，**且必须先读 ADR**。
- `server/prisma/migrations/` → `check:migrations` + `check:schema-migration-drift`；部署**只能** `cd server && sh scripts/migrate-deploy.sh`。
- `apps/mobile/ios/**`、`apps/mobile/android/**` → `check:ios-native-bridges`、`check:native-deps`、`check:native-bare`、`check:mobile-bundle`，且要重装两端。
- `apps/*/src` 里出现业务判断 → 打回（`docs/agents/hard-constraints.md` §3.5）。
- UI 新增裸 hex/px/ms → `check:design`/`check:theme`/`check:tokens`。
- 新增 i18n 词条 → `check:ui-language`、`check:i18n-vars`。
- 本文档所在目录 → `check:docs`（死链，全仓 `.md` 都扫）。**`check:md-tables` 只扫显式清单里的文件**（`scripts/check-md-table-rows.mjs:53`）⇒ 本文件目前不在清单内，**别顺手加进去**（先例：`docs/plans/README.md` 刻意不在清单里，理由在该脚本 `:70`–`:105`）。

**禁止事项**：不改已接受的 ADR 结论（要改就新写一份）；不 bump `CURRENT_SCHEMA_VERSION`；新字段一律可选 + 运行时默认；不修改已应用的迁移；`apps/*` 不写业务语义；不引入新的第三方依赖（尤其任何推送 SDK —— `packages/legal/src/documents/third-parties.ts:244` 已对外承诺"未集成第三方推送 SDK"，引入即同时违反许可证门与法务文案）。

**两条本文件用到的现量命令**（判"缺失"是全仓零命中，不是没找到）：`grep -rniE "apns|fcm|firebase" --include=*.ts --include=*.tsx --include=*.kt --include=*.swift apps/*/src server/src` ⇒ 0；`grep -rniE "\bmention\b|@提及" --include=*.ts --include=*.tsx packages/*/src apps/*/src server/src` ⇒ 0。

**登记在册但未闭合的债**（只取命中行，不整份读 `BLOCKED.md`）：`BLOCKED.md:2648`（B33 移动端提醒投递的拍板历史，已于 2026-10-03 由另一条线落地，本条线的验收读数不代它们主张）与 `BLOCKED.md:3632`（B64 `check:legal-permissions` 曾是已提交态的红 —— 现量 `packages/legal/src/documents/permissions.ts:36`/`:61`/`:89`/`:96` 已经写清通知授权与精确闹钟，**但我没有跑那道门禁**，属"未核实"，接手请自己跑一次再引用）。
