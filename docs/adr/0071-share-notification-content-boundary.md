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

---

## 补记（2026-10-24，移动端接上投递面之后）

上面「事实基线」里那句「读者只有 web 那一处接线」是**立文当时**的读数。今天有了第二个读者：
`apps/mobile/src/share/share-activity-notify.ts`（系统投递）+ `apps/mobile/src/share/share-signals.ts`（信号→拉取），
而**判断本体仍然只有一份**，住在 `@heyta/ui`（`selectShareActivitiesToNotify` 与正文构造件）——
壳只投递，不重算口径，这正是裁决二"内容口径不许各壳自己写一遍"要的形状。

界面腿上量得到的一件事：偏好面**只剩活动那一族**（另两档 2026-10-24 撤下，理由见
[ADR-0062 的实施记录](0062-shared-list-key-distribution.md)）。反向臂（界面上不许再摆那两档）在
`scripts/verify-mobile-collab-ios.sh` 第 10 步，复量 `pnpm verify:mobile-collab:ios`。

⚠️ **2026-10-25 逐壳复量后更正本补记末句** —— 原句「手机加入流程今天不写同意态 ⇒ 它拿到的是零打扰」
到 M6-1 落地为止是真的，现在**方向反了**：写同意态的是手机，不写的成了 web。
- **手机写**：`apps/mobile/src/screens/JoinShareScreen.tsx:67-70` 的初始 phase 走
  `shouldShowConsent(loadMobileShareConsent())`（没确认过 ⇒ 先弹，fail-closed），确认之后
  `:232-235` 的 `onConsent` 把它 `saveMobileShareConsent` 落盘。
- **web 不写**：`apps/web/src/features/share/ShareFeature.tsx:199` 写的是
  `initialShareId === undefined ? { kind: 'consent' } : { kind: 'panel', shareId: initialShareId }`
  ⇒ **带着 shareId 从入群链接进来时，整段同意面被跳过**。

⇒ §四 那格缺口曾经只剩 web 这一侧，而且是一处**壳间不一致**：同一个人点同一条链接，手机上被问一次，
web 上不被问。反查一条：
`grep -n "kind: 'consent'" apps/web/src/features/share/*.tsx`（两枚入群入口都在：web 的
`JoinSharedListDialog.tsx` 与手机的 `JoinShareScreen.tsx`）。
**2026-10-25 本批把 web 那一侧补上了**：`JoinSharedListDialog` 的初始 phase 同样走
`shouldShowConsent(loadShareConsent(localStorage))`，用的是同一枚 `ShareConsentModal` 与同一批
`common.share.consent.*` 词条（壳只落盘，不重算口径）。常驻判据在
`e2e/tests/collab-journey.spec.ts` 入群那一段——它不止断言"同意面在场"，还回读
`localStorage` 里那枚键，钉的是**它真落了盘**（通知路径读的就是这条）。裁决三本身一个字不改。

⚠️ 一处**留给产品负责人的文案不一致**（本批按边界不擅自改，因为它属于对外法律表征）：同意面的正文与
按钮是 owner 视角写的——「把清单设为共享前，请确认以下事项：」与按钮「确认共享」——而**入群**那一侧
（手机与 web 都是）现在也把这一句画给一个"没有把任何清单设为共享"的人。判据在
`packages/i18n/src/locales/zh-CN.ts` 的 `common.share.consent.body` / `.accept` 那两行；
截图见移动装置证据目录的 `06b3-入群同意面.png`。改不改、怎么改归权利人拍。

---

## 补记二（2026-10-25 第八批，移动设备腿）—— 两格都在"界面不许谎称能力"这一侧

1. **偏好面那三档活动开关在手机上画成了三段裸文字。** 行是 `Pressable`、`aria-checked` 也在、点了确实翻转，
   屏幕上却没有方框也没有对钩 ⇒ 用户看不出那是开关、更看不出当前是开还是关。**既有判据一条都不红**：
   设备侧那一条判的是"这三行文字在不在"，减法那一条（见上面补记末段）判的是"没有输入的开关不许摆着"——
   两枚都不看"看得看得出来吗"。修在 `packages/ui/src/sync/NotificationPrefsPanel.tsx`：补一枚与
   `Settings.ToggleLine` 同形状的标记（未选中=描边空框，选中=实心主蓝），两壳共用同一份判断与同一份 token。
   钉子两枚：`apps/web/tests/share-notif-prefs-affordance.spec.tsx`（亮/暗两档各判"未选中不许有实心底"与
   "选中必须是**这一档表里**那枚主蓝"，并断言两档主蓝确实不同 ⇒ 不是随便一枚蓝）+ 移动装置第 10 步的
   三枚 `share-notif-activity-*` `testID` 存在性判据。分工要写清：设备上只能证"是有 testID 的交互元素"
   （裸 `<Text>` 不进 AX 树），**颜色两态由 web 那枚用例判，像素由 `16-通知偏好面.png` 肉眼复核**。
2. **web 那侧的同意闸只有"弹 + 落盘"两格有常驻判据**（上面补记指的那条 e2e）。三档失法——按取消、
   不勾「不再提示」、键名漂了——没人守。补 `apps/web/tests/share-join-consent-gate.spec.tsx`，
   含一条"apps/web 里出现该键字面量的文件只有 `features/share/share-consent-store.ts`"的尺。
   裁决三与"单一存储键"那句都没动，动的是**它有没有人守着**。

