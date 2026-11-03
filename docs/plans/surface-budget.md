# 界面控件预算（surface budget）：页头只留「图标按钮 + 一枚 ⋯」

> 立项：2026-11-02。产品负责人拿滴答清单的桌面对照图逐屏对比之后的裁决：
> 「我们目前很多东西明明可以用各种 UX 把它收进去……把所有这种铺开式组件全都删掉，全都收拢进来。」
> 前置一轮的结论在本文 §1（那份读数把"设计系统不够全面"这个猜想否证掉了）。

---

## 1. 立之前的读数（为什么不是"设计系统不够全"）

先说清楚**不是**什么。2026-11-02 实测（`grep` 命令在 §6）：

| 维度 | 实测 | 结论 |
|---|---|---|
| 字号 token | 9 档（11/12/14/16/18/20/24/30/36） | 够用 |
| `apps/web` 字号声明 | **132 处，全部 `var(--ht-font-size-*)`，裸 px 0 处** | 完全统一 |
| 颜色 token | 66 个（明暗各一份，共 132 条定义） | 不缺 |
| `apps/web` 裸 hex | **CSS 0 处，TSX 内联样式 0 处** | 严格 |
| 间距 token | 11 档 | 够用 |
| `apps/web` 实际用到的颜色 token | 40 / 66 | 有 26 个没被使用 |

所以「我们的设计系统不够全面」是**错的**，而且错得有点危险 —— 它把责任推给词表，
而词表已经是满分：门禁把"取值必须是 token"守得死死的（0 个裸值就是证据）。

真正的两条病灶：

### 1.1 字号：不是不统一，是**太统一**

132 处声明里 **116 处（87.9%）** 挤在最低三档（`2xs` 22 / `xs` 49 / `sm` 45）。
11/12/14 这 2px 一档的音量，同时承担正文、控件标签、组头、元信息、空态提示五种角色 ——
**一屏没有前景**。而 `row-title` = 16 / `row-meta` = 14 ⇒ 比值 **1.14**，读不出层级。

处理（本轮已落）：`row-title` 字重 400 → **500**、`row-meta` 字号 14 → **12**（比值 1.14 → **1.33**）。
判据从"某个像素值"改成**关系**：`packages/design-system/tests/typography.spec.ts`
的「row-title : row-meta ≥ 1.33」——谁都能调一个数，但"标题与元信息必须一眼分得开"与界面无关。

### 1.2 控件：一个功能一个控件，而**没有一条门禁在量件数**

任务视图页头当时的 9 件：

```
分享按钮（带文字） / 选择任务（ghost 文字按钮） / 批量完成 / 重复警告 / 撤销
排序文字标签（12px）+ 排序原生 select（44px 带框） / 助手图标 / 详情开关图标
```

三种控制语法并列，而排序那一条还 gate 在 `visible.length > 0` —— **空的收集箱里排序整个消失**
（排序是视图属性，不该随数据条数变形）。

列表体里另有一枚「AI 排优先级」：`ht-btn--ghost` 铺满整列 + 一个图标，夹在组头与任务行之间 ——
长得和任务行一样，而它是一次批量写入的入口。

🔴 **共同点不是"难看"，是"增加"**：每加一个功能，页头长一寸、列表体多一行，
而既有门禁**一条都不会红**（字是 token、色是 token、行高对、对比度够、行距 44–56 也在）。
原来的尺量的都是"这一件做得对不对"，没有一条在量"这里该有几件"。

---

## 2. 三条规则（这是本轮真正产出的东西）

| # | 规则 | 一句话理由 |
|---|---|---|
| R1 | **页头 = 标题 + ≤1 图标按钮 + 一枚 `⋯`**。不许出现带文字标签的常驻控件、不许原生 `<select>` | 页头形状不能随功能数量变化。加功能 = 加一项菜单项，不是加一格控件 |

> **这一条走了三刀，第二刀曾经把自己写软过**（值得留着）：
> 第一刀把页头从 9 件收到 3 件（`⋯` / 详情开关 / 助手回退）。当时我把 R1 写成「≤3」，
> 理由是"收起的栏仍然需要开启者、助手入口不能被会卸载的菜单吞掉焦点"。
> **第二条理由当场就是错的**：`assistantTriggerRef` 从来没被读过 —— 焦点归还是浮层
> 自己捕获 `document.activeElement` 做的。第三条刀把助手入口搬进 `⋯` 之后，
> 只要在选中时先把焦点交回 `⋯`，归还原样成立（`e2e/assistant-hosted-ux` 的
> `Escape → task-menu-open 聚焦` 就是这一格的判据）。
> 第一刀留下的另一半问题（宽档收起详情列时"助手 / ⋯ / 详情开关"三枚同屏）也随之消失：
> 展开详情列的入口同样进了 `⋯`（`detail-pane-open`）。
> ⇒ 现在**每一档**都是「一枚图标 + 一枚 `⋯`」，`HEADER_CONTROL_CEILING = 2` 已收紧。
| R2 | **动作不许住进列表体**。列表体里只有任务行 | 否则每一行"点下去会发生什么"都要先分辨身份，而动作行和任务行长得一样 |
| R3 | **模式 ≠ 控件**。批量选择、危险确认这类"进入某种状态"的东西，非模式态下页面上不该有它 | 常驻的"进入模式"按钮，在 95% 的时间里只是噪音 |

排序、分享、「选择任务」现在都在 `⋯` 里；批量栏只在 `bulkSelecting` 时存在；
「AI 排优先级」搬进对话助手的正文顶端（`orgActions` 槽，常驻，不是空态的一部分）。

---

## 3. 落了什么

| 件 | 位置 | 判据 |
|---|---|---|
| 共享锚定菜单（门户 + 定位 + 点外面关）—— **全仓唯一一份** | `apps/web/src/lib/menu/AnchoredMenu.tsx` + `styles/app/menu.css` | `check:menu-keyboard`（5 枚 `role="menu"` 全走同一份判断）；`task-sort.spec.tsx` 的菜单分支 |
| 键盘交给既有判断，不新写 | `packages/ui/src/control/menu.ts` + `lib/menu/useMenuKeyboard.ts` | 同上；这是仓里第 3→1 次去重（原本三枚菜单三种键盘答案） |
| 页头收拢成「助手图标 + `⋯` + 详情开关」 | `apps/web/src/App.tsx` 的 `.ht-header__actions` | `check:surface-budget` 格 1–4 + 7 |
| 批量栏改成模式态，入口进 `⋯` | 同上（`bulkSelecting` 才渲染） | `task-sort.spec.tsx`「空列表：`⋯` 仍在、排序三档仍可选、选择任务是禁用而不是消失」 |
| 「AI 排优先级」搬进对话助手 | `AssistantPanel` 新增 `orgActions` 槽；`App.tsx` 的 `aiPrioritizeAction` | `check:surface-budget` 格 5–6 |
| 助手入口 + 展开详情列搬进 `⋯`（第三刀） | `App.tsx` 的 `.ht-header__actions` | `check:surface-budget` 格 10（上限收到 **2**）+ `e2e/assistant-hosted-ux` 的焦点归还 |
| 字号层级修好 | `packages/design-system/src/typography.ts` | `typography.spec.ts` 的 1.33 关系判据 |
| JPEG 铺底色搬进 L0 | `packages/design-system/src/format-matte.ts`（`JPEG_MATTE_COLOR`） | `check:design` / `check:l4`（canvas 不解析 `var()`，字面量必须住 L0） |

---

## 4. 门禁 `check:surface-budget`（7 臂 + 阳性对照）

判**源码形状**，因为渲染层已经有两道判据（`task-sort.spec.tsx` / `share-entry-visible.spec.tsx`），
而它们能被"删测试"绕过；两道一起，改坏要付两次代价。

| 格 | 判据 | 红形 |
|---|---|---|
| 1 | 页头段里有且只有一枚 `task-menu-open` | 删掉 `⋯`，或给它开第二个入口 |
| 2 | 非模式段没有 `<select` | 页头再加一枚原生下拉 |
| 3 | 非模式段没有 `<label` | 把"文字标签 + 控件"塞回页头 |
| 4 | 非模式段没有 `task-sort` / `task-sort-select` | 排序以常驻控件形状搬回页头 |
| 5 | `<AiPrioritize` 只在 `const aiPanels` 之前、且只出现一次 | 动作行搬回列表体 |
| 6 | `orgActions={aiPrioritizeAction}` 仍接着 | 从助手面板上摘掉（源码里看着还在，界面上没了） |
| 7 | `.ht-header__actions` 只有一处 | 另开一个动作区绕开整道门禁 |

⚠️ 格 2/3/4 只量**非模式段**（`bulk-toolbar` 到 `bulk-exit` 之间整段切掉）：
批量栏里那枚"移动到哪个清单"的下拉是**模式内**控件。不切的话这道尺会在
"产品已经做对"的那一天红 —— 而一条指着对的产品的判据，结局一定是被人把规则删掉。
这一格是自检臂 C 抓出来的（第一次跑，合规现状就被报红）。

---

## 5. 读数（2026-11-02）

| 件 | 读数 |
|---|---|
| `apps/web` 全量单测 | **225 文件 / 2729 通过 / 13 skip，exit 0**（`testTimeout` 与 **`hookTimeout`** 都是 60s；后者是那条决定漏掉的一半，见陷阱 #634） |
| `apps/landing` 全量 | 24 文件 / **1455 通过**（含 #7 页头登记处 ⇔ 产品段双向等集） |
| `packages/design-system` | 546 通过（含新增的 1.33 关系判据） |
| `packages/ui` | 825 通过 |
| 与本次改动直接相关的 web spec | `task-sort` 8/8、`share-entry-visible` 5/5、`bulk-repeat-guard` 1/1、`ai-prioritize` 28/28、`ai-panel-chrome` 12/12 |
| `check:surface-budget` | 7 臂 + 阳性对照全绿 |
| 页头件数 | 9 件 → **3 件**（助手图标 / `⋯` / 详情开关），空列表下也仍是 3 件 |
| 真浏览器（chromium，1440×900） | `inbox-dida` 4/4 + `data-transfer-ux` 2/2 = **6/6 通过**；截图 `e2e/test-results/inbox-dida-sort-{default,menu-open,addedAt,priority,dark}.png` |

### 5.0 真浏览器截图抓出来的两处（判据抓不到的那一类）

| 症状 | 根因 | 修法 |
|---|---|---|
| 菜单开着时看不出是"一块面板"：文字像直接盖在任务行上 | 第一版照抄了 `.ht-rail__more-menu` 的 `border: 0`。那份贴在**深色 rail** 旁边，色差本身就说明边界；页头菜单浮在**白底主区**上，`surface-raised` 在亮色下与 `background` 几乎同色 | 加 `--ht-color-border` 描边 + `--ht-shadow-lg` 投影。**几何门禁全部看不见这一格** —— 边界是否符合对比度判据它都绿 |
| 菜单项里三档文案的左缘没有对齐 | 无图标的项少一列 | 无 |

> 这一格是"必须真跑真看"（`ui-acceptance.md`）的直接证据：那道菜单在**所有**单测与
> 门禁里都是绿的（`role`、`aria-checked`、条目数、关闭策略全对），而它看起来不像一块面板。

### 5.0b `pnpm check` 这一轮的真实状态（150 段，跑到底了两次）

| 断在哪 | 读数 | 是不是我的改动 |
|---|---|---|
| 第 66 段 `check:macos-window` | 首跑 `ScreenCaptureKit 起不来 / 未授权`（exit 4） | **不是**。同一条命令随后再跑就绿了（窗口 1120×720、`contentOnModalRatio 0.041`、M2-macOS 探针全过）—— 那一次是取图会话被占，不是权限没给 |
| 第 118 段 `check:ai-e2e` | `载体判定：这一轮 e2e 作废`（`ECONNRESET`，first: `detail-column-resize.spec.ts` D3） | **不是**。载体（vite/stub）在请求途中退出 —— 同机多个检出/多路 e2e 共用端口时会这样 |
| 前 65 段 | 全绿，含本轮的 `check:share-entry-visible` / `check:surface-budget` / `check:design` / `check:l4` / `check:focus-single-source` / `check:row-single-source` / `check:menu-keyboard` / `check:z-ladder` / `check:control-semantics` / `check:ux-coverage` | — |

⚠️ 中途还有三次红**全部来自同机并行轨道正在改同一棵树**（不是本轮的改动）：
`packages/app-host/src/ai-assistant.ts` 少类型导入、`apps/web/src/features/ai/MentionPicker.tsx`
引用了尚未加进词条表的 `web.ai.mention.*`、`docs/adr/0083` 未入库导致文档死链。
逐条现量后都已恢复；这一类红的特点是**下一次跑换一个位置** —— 看见"每次红的地方都不一样"
先怀疑是不是别人正在写，别逐条改自己的代码。

### 5.1 这一轮发现的两处"判据锚在排版上"

| 现象 | 根因 | 修法 |
|---|---|---|
| `apps/landing` 的 #7 页头对账三条一起抛「锚点已失效」 | 判据锚的是整串 `<div className="ht-content">`，而那段 JSX 后来多了两个属性、被格式化成多行 | 只锚 `className="ht-content"`，再退一个 `<` 找回标签起点（排版无关） |
| `packages/ui` 的 `priorityColorToken` 唯一性判据在有 CocoaPods 的机器上红 | 目录遍历对**每个**条目调 `statSync`（连 `.h` 都不放过）⇒ 撞上 `apps/mobile/ios/Pods` 里的**断链符号链接**，`ENOENT` | 改用 `readdirSync(withFileTypes)`：`Dirent` 直接给目录与否、不跟符号链接。**注入第二份定义仍红**（验过） |

### 5.2 行内动作行删掉之后，判据跟着搬（10 条 e2e 的落点重钉）

行尾那排**行内字段编辑器整行删掉**之后，`TaskDetailCard` 成了字段编辑器的**唯一**所有者，
两个落点：宽档 = 详情列里的 `task-pane`；窄档（宽 < 1024，或栏被收起）= **点行弹出的对话框**
（`task-detail-dialog`，里面同样有 `task-pane`）。行尾只剩**只读徽标**。

于是旧判据里"窄档 ⇒ 行尾那颗 chip 把编辑权接回去"**整个前提消失了** —— 那一族 10 条 e2e
（`detail-pane-task` T1/T4/T7/T9/T11/T13/T15、`calendar-sidebar` ×2、`due-date-edit` ×1）
全部红在"找不到入口"。**重钉的规则**：换落点不换判据 —— 仍然问
「这个字段改得了吗、落成 op 了吗、刷新后还在吗」，只是入口从"行尾 `<summary>` 展开的 Portal 面板"
换成"点行 ⇒ 面单里的编辑器"。

| 件 | 读数 |
|---|---|
| 新入口 helper | `e2e/tests/task-detail-entry.ts`：`openTaskPane` / `openNarrowTaskPane`（顺带钉住"面单真的在对话框里"）/ `closeTaskDetailIfOpen` |
| 重钉后 | `18 passed (3.8m)`，0 failed，0 flaky（`detail-pane-task` 15 + `calendar-sidebar` 2 + `due-date-edit` 1） |
| 同一模型在单测里早已成立 | `apps/web/tests/task-repeat.spec.tsx` 反向断言「重复的编辑器又回到行尾了 —— 行上只许留只读徽标」，`task-row-menu.spec.tsx` 断言 `App.tsx` 源码里 `ht-compose-actions` 计数 0 |
| 窄档"改得了"的现量 | 900×600 对话框 640×568、面单 590 宽、备注框 558×79、提醒按钮 111×44 —— 每个字段都实测过"点行 → 写 → 刷新后行上读得到" |

### 5.3 同一轮里撞到的三处"看起来像产品坏了"

| 现象 | 根因 | 判据 |
|---|---|---|
| `HEAD` 构建不起来 | `apps/web/src/features/ai/image-encode.ts` 已入库并 `import { JPEG_MATTE_COLOR }`，而 `packages/design-system/src/format-matte.ts` **未跟踪** ⇒ 只有工作树能构建 | 本轮把它补进同一个提交。**教训**：`pnpm build` 在工作树上绿 ≠ `HEAD` 可构建；入库前先问"这个 import 的 producer 也入库了吗" |
| `check:ai-tools` 红：AI 能力清单与上游不一致 | `ATTACHMENT` 进了 `entity-types.ts` 的实体清单，而 `packages/ai/src/capability-manifest.generated.ts` 是**生成物**，没重生成 | 跑 `node scripts/gen-ai-capability-manifest.mjs`（现量：工具 30 / 实体 14 / 覆盖面 9/11）。手改产物等于给模型写一句谎话 |
| `capture-ai` 在 e2e 里恒为 0 枚 | 2026-11 起这个入口收窄成「规则读不懂时才问模型」（用户原话「没有任何作用」），而 e2e 填的 `明天交周报` 恰好被 `parseCaptureDraft` 读懂 | 填充文本换成规则一个字段都认不出的句子；断言（零配置时入口会说明还没配端点）不动 |

> ⚠️ 顺带记一条会**伪造 flake** 的载体坑：并行构建把 `packages/*/dist` 清空的瞬间，
> vite 预转换会报 `Failed to load url …/packages/i18n/dist/index.js`，接着 stub/vite 连接被重置
> ⇒ 整轮 e2e 被自己的载体判定判成"作废"（`ECONNRESET`），而那一轮的红**一条都不回答界面对不对**。
> 跑 e2e 前先确认 `packages/*/dist` 存在且比源码新；能隔离产物目录就隔离。

### 5.4 e2e 与 `pnpm check`：从 57 条红到 0（这一节记的是**怎么修的**）

起点：`check:ai-e2e` **435 passed / 57 failed / 2 skipped**，57 条全部用 `--last-failed`
孤立重跑复现（0 条转绿）⇒ 都是真红。收尾读数：**492 passed / 0 failed / 2 skipped（46.6 min）**，
`pnpm check` 全链 rc=0。

三族根因与处置：

| 族 | 条数 | 根因 | 处置 |
|---|---|---|---|
| **A** 行尾动作区没了 | 27 | `helpers.ts` 的 `openRowTail()` 还在找 `.ht-compose-actions__trigger` | helper 保留"行不在列表里"的守卫，并**反向钉住**"行尾不许再长出折叠动作区"；8 个 spec 按"要看什么"三分：改字段 → 走面单入口，删任务 → 走右键菜单，量几何 → 主体搬到面单或改问只读徽标 |
| **B** 焦点环量的是已替换的机制 | 7 + 1 | 输入类控件的环从 `outline` 换成 `box-shadow`（WebKit 的 outline 不跟随 `border-radius`），5 个 spec 仍在断言 `outlineStyle !== 'none'` | 新建共用判据 `e2e/tests/focus-ring.ts`（接受两种形态，但要求那一层 `偏移 0 / 模糊 0 / spread > 0 / 颜色 === --ht-color-ring`；做过"去掉全局环就变红"的反证）+ **修掉一条真缺陷** |
| **C** 设置 IA / 已删功能 / 其它 | 22 | 七组同构（`sync`→`data` 等）、页头收拢（展开详情列进了 `⋯`）、`capture` 功能整体删除 | 按新落点重钉；`capture` 那一段整段删掉并按**现量**改"四个入口"的个数 |

B 族那条真缺陷值得单记：原报的「任务」那 1 枚并不是裁剪（它量到的是"没有环"，环以
`box-shadow` 画着；几何实测 1440 余量 22px / 375 余量 14px）。把扫描从 22 站加到 80 站
（5 视图 × 2 尺寸）逐站量环带之后，找到同族真实的一格 ——
`button[data-testid="calendar-scope-all"]`（日历侧栏「所有」）被
`div.ht-sidebar__calendar-body`（`overflow-y: auto`）裁掉了左/右/下三条边，
失败截图上是只剩一个「⌐」形的环。修法是把那个**兄弟**滚动容器加进既有的
`--ht-focus-ring-offset` 名单，并补一条先红后绿的见证用例。

顺带修掉的**真缺陷**（不是测试问题）：

- **整页白屏**：管理员概览接口回 `200 {}` 时 `probe()` 把 `access` 记成 `'admin'`、
  `overview` 记成 `{}`，面板读 `overview.users.total` 直接崩。修在唯一收口点
  （`fetchAdminOverview` 先过形状），并补三条会红的单测。这条是 `inbound-automation`
  那两条红的真因。
- **两处日期炸弹**（`admin-revenue` 5 条 / `admin-entitlements` 1 条）：夹具把时刻写死在
  过去某天，而窗口是"从今天往回 N 天" ⇒ 时间走过那几天之后整体落到窗口外。
  症状分别是"聚合坏了"和"并集回退成了最新那一行说了算"，都不是真因。
- **ADR-0081 的载荷模式没进夹具**（`sync-fixes` 10 条）：那一批送的是密文，而
  `readPayloadMode` 读的是 `userSyncState` 那一行；夹具没写 `payloadMode` ⇒ 按新账号
  默认值走明文 ⇒ 全被 `PLAINTEXT_REQUIRED` 拒成 400。夹具里有**三个**同名 mock
  （事务客户端 / 主 prisma / `user` 表），只有主 prisma 那份算数。
- **两本账随功能删除对齐**（`check:overlay` 的 R2 账本、`check:dirty-form-policy` 的
  欠判定账本）；后者更隐蔽：自证臂①读到 2 而不是 1，门禁自判"这条检查没有价值"。
- **一把会静默失明的尺**：`check:inbound-rule-fixture-parity` 的 `stripComments` 不认识
  字符串，e2e 的路由通配 `${server}/**` 被当成块注释开头、吞掉 9409 字符。
  修好后分母从 **6 枚变 10 枚** —— 此前有 4 枚 fixture 从来没被这把尺看过（见陷阱 #638）。

⚠️ 还有一条**没修、但已登记**的债：`check:locator-labels` 的「死标签」26 条
（7 枚移动端旅程脚本按旧文案点，那一面改版后两种语态下都打不中）。按该门禁文件头
对"单语标签"写下的同一条口径（归脚本负责人、不该让共享 `pnpm check` 变红），
改成**账本 + 只减不增**：每条都写明为什么打不中，新写的死标签照旧判红，
账上每一条都必须真的命中（否则红）。现量 26/26 命中。

## 6. 复量命令

```bash
# 1.1 的读数
grep -rhoE "font-size: *var\(--ht-font-size-[a-z0-9]+\)" apps/web/src --include=*.css \
  | grep -oE "size-[a-z0-9]+" | sort | uniq -c | sort -rn
grep -rhoE "#[0-9a-fA-F]{3,8}\b" apps/web/src --include=*.css | sort -u | wc -l   # 0

# 页头件数（现在应当是 3 枚图标/入口）
node scripts/check-surface-budget.mjs --self-test

# 三套单测
cd apps/web && npx vitest run --testTimeout=60000      # 2714 passed
pnpm --filter @heyta/landing test                       # 1455 passed
pnpm --filter @heyta/design-system test                 # 546 passed
```

---

## 7. 刻意没做的

| 件 | 为什么 | 现在是什么 |
|---|---|---|
| 把 rail / 账号菜单 / 习惯菜单三份 `role="menu"` 的 **CSS** 也并进 `AnchoredMenu` | 三处各有自己的定位语义（rail 的 More 跟着 nav 朝向翻、账号菜单贴在 rail 底部）与各自的账本读数；DOM 并了但 CSS 没并，贸然并会同时动三处真浏览器腿 | 键盘已经是同一份（`useMenuKeyboard`），**样式仍是三份**。素材在 `ht-rail__more-menu` / `ht-accountmenu__panel` / `ht-habits__menu` |
| 页头那枚 `⋯` 的族名用 `.ht-header__menu` 而不是中性的 `.ht-menu` | `check:row-single-source` 的 `ht-*` 族棘轮**只减不增**（基线 28）。新开一族会被判红，而"先消掉净增再改常量"是那条规则写明的路径。并进 `.ht-header` 族 ⇒ 净增 0 | 将来三份菜单的 CSS 真并进来时，应当删掉 `ht-accountmenu` 族并把族名改成中性的 —— 那次净增是负的 |
| 移动端同步这套规则 | 本轮范围是 `apps/web`；移动端页头已有自己的模式（FAB + 溢出） | 未动 |
| 日历 / 习惯 / 成长各视图的页头 | 它们各自的动作区不在 `.ht-header__actions` 里（`CalendarHeaderToolbar` 是共享组件、靠插槽挂进来） | 未动；R1 要不要扩到它们，得先量一遍各自的件数 |
