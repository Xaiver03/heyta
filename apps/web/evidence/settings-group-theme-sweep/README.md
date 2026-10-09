# 设置分组 × 明暗 × 三档视口 取证（个人资料 / 账号与安全 / 同步与隐私 / AI 与集成 + 关于与帮助的长标题）

**产出者**：`scripts/qa/reminders-data-responsive.mjs` 里的 `captureGroup` 与 `captureHelpWrap` 两趟。

```bash
# 另起一台 vite（本线用 4379，与 e2e 套件的 4318/4319 不撞）
cd apps/web && ./node_modules/.bin/vite --host 127.0.0.1 --port 4379 --strictPort
# 再跑装置，把证据指到本目录。🔴 本目录 32 枚文件**是已跟踪的**，所以从 2026-10-09 起
# 必须显式带 HEYTA_ALLOW_TRACKED_EVIDENCE=1 —— 不带时装置会在起跑前响亮拒绝（见下）。
HEYTA_RESPONSIVE_HEADED=0 \
  HEYTA_ALLOW_TRACKED_EVIDENCE=1 \
  HEYTA_RESPONSIVE_EVIDENCE="$PWD/../../apps/web/evidence/settings-group-theme-sweep" \
  node scripts/qa/reminders-data-responsive.mjs
```

🔴 **为什么这颗 flag 是必需的（2026-10-09）**：同日复量整族 `check:ai-e2e` 时现量到"跑一趟会把已跟踪的
截图就地改写"（那棵隔离载体 152 枚、主检出 330 枚），而本装置默认落的也是已跟踪目录 —— 覆盖没有归属也没有门禁，
证据一旦变成"最近一次跑出来的图"就不再指认任何一棵树。所以装置加了落点闸门：**目标目录里有已跟踪文件 ⇒ 起跑前拒绝**，
两条出路写死在报错里（例行复跑指到未跟踪目录；确实要刷新入库证据才显式加这颗 flag，并在提交信息里写明是哪一趟、哪棵树）。
五臂读数（全部零浏览器，`HEYTA_RESPONSIVE_PLAN_ONLY=1` 只走前置不启动 Chromium）：
默认落点无 flag **rc=1**、plan-only 无 flag **rc=1**、plan-only + `ALLOW=1` **rc=0**（`trackedEvidenceFiles:47`）、
plan-only + 未跟踪落点 **rc=0**（`trackedEvidenceFiles:0`）、未知腿 **rc=1**（腿校验在落点校验之前，顺序也是判据）。

### 只想跑其中几条腿（`HEYTA_RESPONSIVE_LEGS`）

默认 `reminders,data,groups,help` 全跑。这颗旋钮存在的理由不是方便，是**这装置在只含已提交内容的树上跑不动**：
提醒那一腿等的 `reminder-notify-request-failed` 只活在未提交的 `ReminderNotifyPanel.tsx` 里
（`git grep -c reminder-notify-request-failed HEAD -- apps/web` 无输出），拿它去量一棵干净树，
第一腿就死、后面的分组腿一次也到不了。⇒ 量干净树用 `HEYTA_RESPONSIVE_LEGS=groups`。

⚠️ 选腿**不许把覆盖面一起选没**：`everySelectedLegProducedItsCells`（选了的腿必须交出应得格子数）与
`unselectedLegsReportEmpty`（没选的必须是 0）两条专门钉这件事，而报告里的 `notJudged` 会逐条点名
"这些断言这一趟值为 true 只是因为 `.every` 对空集合为真，不是判过"。

## 为什么补这一趟

覆盖表实测出来的洞，不是推测：`apps/web/evidence/account-suite/` 那 11 张里带 `dark` 命名的 **0 张**，
`apps/web/evidence/assistant/` 7 张里 1 张 —— 而本轮验收要求是「实际验收深浅主题」。
补这四组用的是本线自己的装置，没有去改别人在写的 spec：「显示」那一组由同装置的提醒五态与数据管理两趟覆盖，
「关于与帮助」由 `e2e/tests/help-entry-ux.spec.ts` 覆盖（375/1440 × 明暗）。

**视口口径跟着台账 `UX-S9-44` 那一行验收列的原文**（375/768/1440 无横向溢出），
不跟着装置另外两趟的 390 —— 差 15px 也算两套口径。

## 这 24 格（4 组 × 明暗 × 375/768/1440）证明什么

逐格记了导航文案、组标题、可交互控件枚数、`data-theme` 读数与几何。五条判据全 true
（`sweep-report.json`；那一趟 `SWEEP_RC=0`、装置打印 11 条断言 true。加上下面「长标题」那一趟之后
同一装置现在打印 18 条 —— **条数别抄，现读**：跑完看 stdout 那个 JSON 的键数，或
`node -e 'const r=require("<OUT>/report.json");console.log(Object.keys(r.assertions).length)'`）：

- `everyCaseCoversEverySweepGroup` —— 6 档主题/视口 × 4 组一个都没漏（`.every` 对空集合是真，所以覆盖要单独钉）。
- `groupSweepTitleMatchesNav` —— 导航上那一档写的名字，与进去之后那组的标题**逐字相同**。
- `groupSweepActionable` —— 每组至少一枚可交互控件（判「空壳分组」）。
- `groupSweepThemeApplied` —— 暗色那一档 `document.documentElement.dataset.theme` 真是 `dark`，
  而不是「文件名写着 dark 的亮色图」。
- `groupSweepNoHorizontalOverflow` —— 三档视口都量 `documentElement.scrollWidth ≤ clientWidth + 1`。

可交互控件数逐组不同（未登录态，**工作树那一棵**）：`profile` 1、`account` 1、`sync` 6、`ai` 4；文本量 44 / 33 / 261 / 496 字。
⇒ `groupSweepActionable` 的下界 1 是被 `profile`/`account` 那两格**顶着过的**，不是随手写的大阈值。
⚠️ 这组数是**跟着 IA 的**：同一枚装置打在只含已提交内容的那棵树（长页面 + 锚点，七个分组同时在 DOM 里）上读出
`profile` 4、`account` 2、`sync` 6、`ai` 4，文本量 149 / 363 / 393 / 483（逐格在
`carrier-b081811c-groups-report.json`）。⇒ "下界 1 是顶着过的"这句只在**工作树那一棵**成立；
载体那棵的最小值是 2，读这句话要连着它那一棵一起读。

内容列宽度读数：375 ⇒ **343px**，768 与 1440 都停在 **655px**（`--ht-layout-prose-max` 的上界）。
⇒ `UX-S9-44` 那句「桌面被拉满」是**量出来否掉的**，不是看图觉得还行。

### ⚠️ `groupSweepNoHorizontalOverflow` 答不了"有没有内容被推出可视区"

它读的是 `documentElement.scrollWidth`，而**溢出可以被中间那层滚动容器吞掉**。2026-10-09 两棵树各量一次：

| 树 | `doc.scrollWidth/clientWidth` | `.ht-rail__tabs` 宽 / 右缘 |
|---|---|---|
| 隔离载体 `b081811c`（长页面 + 锚点 IA） | **742 / 375**（红） | 475 / **535** |
| 当前工作树（两栏 IA） | 375 / 375（绿） | 489 / **549** |

⇒ **外壳左栏把导航项排出 375 可视区这件事两棵树都还在**，只有第一棵会被那条尺记成"溢出"。
所以装置另加了一把尺与两条断言：`offViewportInsideGroup`（这一组里有多少枚可交互控件右缘超出视口，
判据 `groupSweepNothingPushedOffViewport` 要求 0）与 `groupSweepOffViewportRulerHasTeeth`
（往组里种一枚必定出界的按钮，这把尺必须数得到 —— 数不到就是尺坏了，那条绿是装饰）。
整屏那一栏 `offViewportWholeScreen` **只入读数不入门禁**：它今天非零，成因是外壳 rail，
归属不在本线（可复现读数：`HEYTA_PROBE_ORIGIN=http://127.0.0.1:<端口> node e2e/_probe/who-overflows-narrow.mjs`）。

两把尺在同一次改动后各跑一趟（同一份装置、`legs=groups`、每趟 24 格、`planted` 全 true；
载体 4379 = 当前工作树，4383 = 隔离载体 `b081811c`）：

| 视口 | 工作树：整屏栏 / 组内栏 | 载体 `b081811c`：整屏栏 / 组内栏 | 载体 `doc.scrollWidth/clientWidth` |
|---|---|---|---|
| 375 | 6–10 / **0** | 5–9 / **0** | **742 / 375** |
| 768 | 2 / **0** | 1 / **0** | 768 / 768 |
| 1440 | 0 / **0** | 0 / **0** | **1444 / 1440** |

三条分工是量出来的：

1. `groupSweepNothingPushedOffViewport` **在两棵树上都过**，而 `groupSweepNoHorizontalOverflow`
   只在载体那棵红（16 格 = 375 档 8 + 1440 档 8，768 档 8 格绿）⇒ 载体那棵树的红**不是"组里的按钮点不到"**。
2. 但**不能**据此说那片红"整落在设置组之外"：组内尺数的是**可交互控件**，组内的非交互内容溢出它记不到 ——
   1440 档就是当场的一例：`sw=1444` 而整屏栏 **0**（被撑宽的是一段没有控件的东西）。
   ⇒ **一把数得出控件的尺，它的"0"不等于"什么都没有"**，这条要跟着读数一起写。
3. 375 档两棵树的整屏栏都非零（6–10 / 5–9），与上面 `.ht-rail__tabs` 右缘 535 / 549 同向 ——
   尺换了、结论没换，这是那两条读数互相独立成立的证据。

📌 上面那张表不是手抄进正文的：**48 格的逐格原始读数两份都在本目录里** ——
`worktree-groups-report.json`（`origin=127.0.0.1:4379`，当前工作树那棵）与
`carrier-b081811c-groups-report.json`（`origin=127.0.0.1:4383`，只含已提交内容那棵），
每份 24 格 × `offViewportWholeScreen` / `offViewportInsideGroup` / `planted` / `documentScrollWidth` 全量，
`carrier.headless=true`、`legs=["groups"]`。要复核表里任何一格，直接读这两份 JSON，别照本段散文。

三条新判据各种过一棵坏，**其中一发是空变异**：第一趟挑的格子本来就是 `light`，"把暗色档改成 light"
什么都没改却照样报 true —— 换成真的 dark 格子（第 2/6 格）才翻红。⇒ 种坏之前必须先确认那一格
**当前读数**与要改成的值不同，否则"能红"是假的。

## 这三格它不证明

> ⚠️ 第 3 格的状态在 2026-10-09 换过一次：那条"锚点臂没在真实提交树上跑过"**已闭合**，
> 站在它后面的是一条新边界（那一棵树是 `b081811c`，不是当日 HEAD）。留这一句是挡"读标题不读正文"。

1. **载体是无头 Chromium**（`carrier.headless=true`）：不抢前台的那一档。它不影响这四组的渲染，
   但提醒权限的 `default`/`granted` 两态只有有头才有 —— 那是同装置另一趟的事，见
   `apps/web/evidence/reminders-data-responsive/`。
2. **拍的是未登录门禁态**：`账号与安全` 整组只有「登录后管理订阅、登录方式与账号安全。」+ 登录钮
   （实测 `textLength=33`、`interactive=1`），`个人资料` 同理。**已登录的那三块（换绑邮箱 / 登录设备 / 注销）
   的暗色证据仍然欠**，它们住在 `account-email-change-and-sessions.spec.ts`，那份套件目前是亮色单档、
   且由账号面那条线在写。（`同步与隐私` 与 `AI 与集成` 两组不依赖登录：未登录态本身就有 6 枚与 4 枚可交互控件。）
3. **导航形状跟着工作树**：`openGroup` 现在两种形状都认（`button[aria-controls]` 与 `a[href="#…"]`），
   两臂各配过一发合成对照（只给 button ⇒ 1、只给锚点 ⇒ 1、两枚都给 ⇒ 2 正好触发「不为 1 就响亮失败」），
   并且**按构造对得上 HEAD**：`git show HEAD:apps/web/src/App.tsx` 里导航逐字是
   `<a className="ht-settings__nav-link" href={'#' + item.id}>`（该串命中 1 处）而 `aria-controls` 命中 **0**
   ⇒ 在只含 HEAD 那棵树上每档恰好 1 枚、不会触发响亮失败。
   ✅ **原话「锚点那一臂在真实 HEAD 那棵树上还没真跑过」已被一次真跑换掉**（2026-10-09 08:2x，读数不靠读源码）：
   载体是一棵 `git worktree` 派生的**只含已提交内容**的检出，钉 `b081811c`，`git status --porcelain` 空、
   `pnpm install --frozen-lockfile` 与 `pnpm -r build` 都 **rc=0**，用它自己的 `apps/web/dist` 起 vite，
   再用**同一份已入库装置**跑 `legs=groups` ⇒ 24 格里 `groupSweepTitleMatchesNav` 等四条全 true，
   也就是锚点臂在真实提交树上**逐档恰好命中 1 枚**。
   ⚠️ 剩下那一格换成了别的：这一趟跑的是 **`b081811c` 那棵树**，不是当日 HEAD ——
   当前 HEAD 既装不上也打不出包（台账 `product-ux-optimization.md` 里 `fee83a90` 与 `9fa53ab9` 那两格红的正是这个），
   所以这条证据支持"锚点臂在**能建的已提交树**上跑得通"，**不支持**"当日 HEAD 可用"。

## 2026-10-10 02:2x：用**当前**装置在同一棵已提交树上重跑了一遍（上面那条 08:2x 读数的装置版本已被今晚换掉）

今晚装置改了三次（载体走 `localStorage['heyta.theme']`、视口口径 4 档 → 6 档、加两层对账判据），
所以"锚点臂在已提交树上跑得通"那句的旧读数按 §7 的规矩不能盖新形状。重跑落在
`apps/web/evidence/sync-privacy-leg-1009-r21-carrier/`（`legs=groups,help,sync`，`R21_RC=1`），五条假逐条对上事实：

| 判据 | 这一趟判假的真正对象 |
|---|---|
| `groupSweepNoHorizontalOverflow` / `helpLongTitleNoHorizontalOverflow` | **这棵 IA 的文档本身横向溢出**（375 档 `scrollWidth=742`、1440 档 `1444`，768 档不溢）—— 与上面那张表同一读数，今晚是复现不是新缺陷 |
| `helpWrapFourRowsMeasured` | 这棵树上的「关于与帮助」**没有那四行外链行**（HEAD 里那两条词条命中 0） |
| `helpLongTitleBadArmsFlipTheJudgment` | 上一行的**下游**：基线已假 ⇒ 坏臂翻不出红，这条假说的是"这一趟不可判" |
| `darkTierReachesBothThemeLayers` | **尺挑错了节点**，不是界面半暗：那一组里唯一带字面 `color` 的节点是状态字「未同步」（muted 档），CSS 层量的是分组标题 |

⇒ 第 4 行那条以后在 `report.json` 里自己就能分开：每格现在带 `cssLayerTitleText` / `sharedLayerNodeText` /
`sharedLayerSameRoleAsTitle` / `sharedLayerCandidateCount`（对照读数 `-r24-rolecheck-revert` 主检出 30/30 全真、
`-r25-carrier-revert` 载体 12/24 量到）。⚠️ 同一批读数也钉住这条判据的**真实谓词比名字弱一档**：
主检出那 30 格里 `sharedLayerSameRoleAsTitle` **全是 false**（量到的是卡片小标题，与分组标题同色是因为两者都吃 `color.foreground`）。
它抓得住半暗（色值必然分开），但**不许读成"同一角色的两层一致"**。

## 「长标题自然换行」那一趟（`light-{375,768,1440}-help-long-title.png` + `help-long-title-report.json`）

补的是台账 `UX-S9-44` 验收列欠的第三条：给「关于与帮助」那四条外链行各喂一枚 **72 字**的中文标题
（`帮助与问题反馈的超长中文标题换行实测` ×4），量行盒、量列宽、量行右缘，然后拍图。
🔴 **换行的尺**是「标题盒高度 ÷ 它自己的 `line-height`（24px）」，**不是** `getClientRects().length` ——
`.ht-type-row-title` 是块级，块级元素的 client rects 只有它自己那一枚盒子，五行的标题也报 1；
第一版照后者量，读数会是"界面不换行"，那条**假缺陷**差点被登记进台账。

| 视口 | 行盒（四行） | 文字列宽 | 行右缘 | 文档横向溢出 |
|---|---|---|---|---|
| 375 | 5 / 5 / 5 / 5 | 243（第 4 行无箭头 ⇒ 275） | 359 | 无（375/375） |
| 768 | 3 / 3 / 3 / 2 | 555（587） | 679 | 无（768/768） |
| 1440 | 3 / 3 / 3 / 2 | 555（587） | 1079 | 无（1440/1440） |

**牙打在三条运行时注入的坏形状上**（元素自己的 `style`，没改共享工作树里的 `help-settings.css`）：
`nowrap` 与 `ellipsis` 各把文字列从 243 撑到 **1103**、行右缘冲到 **1219**（视口只有 375），
两条一起打翻 `wraps + copyFitsColumn + rowInsideViewport`；`fixedWidth`（文字列钉死 100px）只打翻
`rowInsideViewport`。⇒ 三条谓词各自至少被一条坏臂打翻过，而这件事由
`helpLongTitleBadArmsFlipTheJudgment` **常驻钉住**：它转红说的是"上面那几条已经变成恒真的装饰"，不是界面坏了。

⚠️ **有一格故意只记读数不记判据**：验收列那句「图标、文本和外链提示不互相覆盖」量到了 ——
文本与尾部 ↗ 的水平间隙在**五种状态（含三条坏臂）下恒为 16px**（逐行 `gapToArrow` 在册）——
但它**没有可达的坏形状**：这套 flex 布局里箭头跟着行走，`fixedWidth` 那臂就是专门为造出"压住"挑的，
造不出来（它的坏法是"把行推出视口"，那已经有判据了）。把一条永远不会假的断言写进 `assertions`
比不写更坏，所以这一句只说到"量过、当前成立"。

⚠️ 这一趟只在 **light** 拍图（换行由盒模型决定，与主题无关；暗色那两档由上面 24 格与
`e2e/tests/help-entry-ux.spec.ts` 各自覆盖），且拍的仍是**未登录门禁态**下也能进的那一组
（「关于与帮助」不依赖登录）。
