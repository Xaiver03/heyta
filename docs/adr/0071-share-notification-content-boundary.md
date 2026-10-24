# ADR-0071：共享清单的系统通知，正文只许出现「清单名 + 活动种类」

- **状态**：已接受（2026-10-24，产品判定权已交给本线，见文末「由谁拍」）
- **日期**：2026-10-24
- **相关**：[ADR-0062](0062-shared-list-key-distribution.md) 决策 7（端到端加密 + 盲推 + 本机过滤）、
  [ADR-0068](0068-share-member-identity-and-content-publication.md)（成员身份与内容发布）、
  [ADR-0070](0070-share-roster-changed-signal-replaces-polling.md)（本线最新一份，信号只说"哪一份动过"）、
  本裁决补的是 `docs/plans/collaboration-shared-lists.md` §9.10 里登记的那一格欠账

---

## 一、要解决的问题

M5 把实时信号接上之后，共享清单活动的系统通知**已经在响**了，但它说的是：
"有人在你参与的共享清单里写了新内容" —— 不带清单名，也不带任何内容。用户在通知中心里
看到三条一模一样的句子，分不出是哪一份清单（一个人可以共享好几份）。

这不是措辞问题，是**边界问题**：端到端加密下，本机当然解得开任务标题与评论正文，
所以"能不能带"完全取决于"该不该带"。而这一格当时被刻意留空，登记在计划里的那一句
（现量：`grep -n "这一格归产品负责人拍" docs/plans/collaboration-shared-lists.md`）。

立这份 ADR 之前的现状（现量，别照本节推）：

- 投递件 `apps/web/src/features/share/share-activity-notify.ts` 的 `labels` 只有
  `{ title, body(kind) }` —— 正文由 `kind` 一处决定，没有任何内容字段。
- "响不响"的判断只有一枚：`@heyta/ui` 的 `selectNotifiedActivities(prefs, kinds)`
  （现量：`grep -rn "selectNotifiedActivities" --include='*.ts' --include='*.tsx' apps packages | grep -v dist`）。
- 同意态今天只有**一条设备级记录**（`heyta.share-consent.v1`），写点在 owner 那一步确认
  （现量：`grep -rn "heyta.share-consent.v1" apps packages | grep -v dist`）。
- 活动词表是**封闭三档**：`'completed' | 'added' | 'deleted'`
  （现量：`grep -n "export type ShareActivityKind" packages/ui/src/sync/notification-model.ts`）。

## 二、三个选项与结论

| 选项 | 内容 | 判定 |
|---|---|---|
| 甲 | 正文允许「清单名 + 活动种类」，条目内容一律不进 | ✅ **采用** |
| 乙 | 保持现状：只有活动种类，连清单名都不带 | ❌ 否。多份清单的人在通知中心里无法分辨来源，而"这份清单"是他已经同意共享出去的那一个对象 —— 名字是他已经授权这台设备知道的信息，不带它不是保护，是把可用性好康成噪音 |
| 丙 | 正文带上任务标题 / 评论摘要，通知直接可读 | ❌ 否，理由见裁决二。这一条把产品的信任边界扩张到操作系统的通知链路上，而那条链路不在本产品的威胁模型里 |

## 三、裁决（五条，每条都可失败）

1. **允许出现**：① 这份共享清单的**名字**；② **活动种类**，且只能取自 `@heyta/ui`
   那个封闭词表的现量成员（今天见 §一 的现量命令；**不许自己扩**）。
2. 🔴 **禁止出现**：任务标题、评论正文、便签内容、清单里的任何条目文本。
   **理由**：把明文写进系统通知中心，等于把它交给**操作系统及其同步链路**去保管 ——
   iOS 的通知历史、Google 的通知同步、锁屏上的可见性、别人设备上的通知转发，
   这些保管者都不是本产品的信任边界。端到端加密承诺的是"服务端看不见"，
   它**不**承诺"这台设备之外的任何地方都看不见"；把条目内容推进通知中心，
   就是绕着自己立的边界挖一条通道。
   清单名与活动种类是**元数据级**的：用户既然在这台设备上建了这份共享、
   并让它出现在自己的通知里，本来就同意让这台设备知道"有这么一份清单动了"。
   条目内容是**数据级**的：没有任何一次同意覆盖过"把它交给系统通知中心"。
3. **这条允许是有条件的**：只在①这台设备对共享**同意过**（现量口径：
   `shouldShowConsent` 那一套同意态里 `consentAcceptedAt` 存在），并且②该类活动在
   本机偏好里开着的时候。🔴 偏好那道闸门**仍是 `selectNotifiedActivities` 那一枚**，
   本裁决不重写它、也不允许壳里再长出第二枚 —— 新增的 `selectShareActivitiesToNotify`
   只是把它包在同意之后：没同意过 ⇒ 空数组，一条都不响。
   内容口径只决定**响的时候说什么**，不决定响不响。
4. **名字只从现成本地状态取**：本机那条绑着这份 share 的清单行（`localRowIdForShare`
   读出的那一行）里有名字就用；拿不到（还没绑定 / 详情还没读回来 / 离线）就回落到
   **不带名字的现有措辞**。🔴 绝不许为了拼一句话发一次网络请求 —— 通知路径必须能在
   离线时如实说话，而"为了一条通知去 GET 清单详情"会让通知变成流量的来源。
5. **措辞只许住 i18n**：两句（带名字 / 不带名字）都是词条，界面与投递件里不许硬编码；
   带名字那句的插值参数**只有清单名**这一个占位符（`pnpm check:i18n-vars` 盯的就是这件事）。

## 四、后果

- 通知中心里"是哪一份清单动了"从此可分辨，而条目内容仍然只在本机应用里可见。
- 服务端**零改动**：这条口径问的是本机说什么，而服务端从设计上就看不到明文
  （ADR-0062 决策 7）。如果将来某个实现看起来需要服务端配合才能带上名字，
  那就是把这条链问错了 —— 名字本来就在本机的清单行里。
- 同意那一道的现量粒度是**设备级一条记录**，写点只有 owner 的「共享此清单」确认那一步。
  ⚠️ 由此推出的已知缺口：**通过链接加入的那台设备今天没有同意记录**，
  所以它按裁决三拿到的是"零打扰"。这不是措辞问题，是同意态缺一份落点 ——
  补法（加入流程也走一次确认，或把同意改成每份清单一行）归产品负责人拍，
  见文末；本 ADR **不**顺手放宽成"加入即视为同意"。
- 移动端与三枚桌面壳接同一条链时，用的是同一批模型件（`selectShareActivitiesToNotify` +
  `shareActivityNotificationBody`）：**口径不许在各壳里各写一遍**。
- 判据：`packages/ui/tests/notification-content-boundary.spec.ts`（闸门与组装），
  `apps/web/tests/share-notification-content.spec.tsx`（接线五形 + 源码形状那条"通知这一腿
  不许有共享 API 客户端"）。能红的证据见 `research/tools/mutation-rigs/README.md` 里登记的
  `mutate-collab-notif-content.mjs`。

## 五、由谁拍

产品负责人 2026-10-24 的授权口径是「产品判定权已经交给我这一侧，口径我定好了」，
并明确「不要放宽，也不要缩小」。本题不动不可逆层（`packages/shared-schema`、线协议、迁移一概未动），
不改 ADR-0062 决策 7 的结论，只补它留下的那一格 ⇒ 本线按产品视角定案。

**翻案条件（写死，别当措辞优化）**：如果将来通知要带**条目内容**，必须先回答
"系统通知的保管者是谁、它凭什么拿到用户的明文"，并**新写一份 ADR 推翻本文裁决二**；
在那之前，把标题或评论正文塞进正文的任何改动都按违反口径处理，不按改善处理。
另一条较小的翻案：若同意态改成**每份清单一行**（§四 那个缺口的修法之一），
裁决三的"已同意"判据要跟着换，并在勘误段登记 —— 那道闸门的形状不许悄悄改。

## 六、事实基线与现量命令

这一节写的是**立这份 ADR 那一刻**（2026-10-24）的读数，保留是为了让下一位看清当时怎么判的；
HEAD 在动，照下面几条现量，别抄本节正文：

- `grep -n "export type ShareActivityKind" packages/ui/src/sync/notification-model.ts` ⇒ 当时三档。
- `grep -rn "selectShareActivitiesToNotify\|shareActivityNotificationBody" apps packages --include='*.ts' --include='*.tsx' | grep -v dist` ⇒ 当时判断只在 `@heyta/ui`，读者只有 web 那一处接线。
- `grep -rn "heyta.share-consent.v1" apps packages | grep -v dist` ⇒ 当时键只有一份定义（`apps/web/src/features/share/share-consent-store.ts`），写点在 owner 的确认那一步。
- `cd packages/ui && npx vitest run tests/notification-content-boundary.spec.ts`、
  `cd apps/web && npx vitest run tests/share-notification-content.spec.tsx` ⇒ 条数由脚本自己打印。

落地后的实施记录与读数写回 `docs/plans/collaboration-shared-lists.md` 的 M5 那一节。
