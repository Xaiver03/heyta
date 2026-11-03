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

### 5.4 🔴 全量 e2e 的现状：56 条红，三个根因族（**尚未修完**）

`pnpm check` 的 `check:ai-e2e` 段：**435 passed / 57 failed / 2 skipped（墙钟 1.6 h）**。
57 条全部用 `--last-failed` **孤立重跑复现**（`57 failed`，0 条转绿）⇒ 都是真红，
不是"整串高负载多报红"那一族。

> ⚠️ 之后删掉独立的「一句话捕获」功能（产品负责人：「已经集成到收集框里面了，
> 不需要单独有一个产品入口」），`ai-capture.spec.ts` 整条随之删除 ⇒ 现在是 **56 条**。
> 下面的分类与条数按 57 那条读数记着，减掉的正是 `C 族` 里的 `ai-capture` 那一条。

三类根因：

| 族 | 条数 | 形状 | 收口点 |
|---|---|---|---|
| **A. 行尾动作区没了** | **27** | `helpers.ts` 的 `openRowTail()` 抛「这一行没有行尾动作区触发器（`.ht-compose-actions__trigger`）」 | 一枚共用 helper；调用点还要连带把"点行尾编辑器"换成"点行 ⇒ 面单" |
| **B. 焦点环量的是已替换的机制** | **7**（+1 真缺陷） | `outline-style === 'none'` 被判成"环被抹掉了" | 判据该量"画面上有一圈可见的环"，不量它画在 `outline` 还是 `box-shadow` |
| **C. 设置 IA / 捕获入口 / 其它** | **23** | `settings-group-sync` 那枚按钮 0 枚、`settings-sheet` 里 0 个 `heading`、`capture-ai` 不可见 | 未逐条定性，见下表 |

**A 族逐 spec**：`danger-confirm-trash` 13、`button-tier-matrix` 4、`control-semantics` 3、
`chip-typing` 2、`task-organize` 2、`checkbox-group-spacing` 1、
`shell-no-document-scroll` 1、`shell-sidebar-height` 1。

**B 族逐 spec**：`focus-visible-matrix` 3、`assistant-resize-ux` 1、`borderless-ux` 1、
`habit-create-shape` 1、`search-overlay` 1。
⚠️ **其中一条是真缺陷，不是测量口径**：`focus-visible-matrix` 报
「「任务」有 1 枚控件的焦点环在画面上不完整（环带被视口或裁剪容器切掉）」——
`box-shadow` 画在盒子外面，滚动容器一样会裁它。修法与 `outline` 时代同一条：
那一层把 `--ht-focus-ring-offset` 指成负数（那张表在
`apps/web/src/styles/app/borderless-controls.css`）。
🔴 **已看图确认产品是对的**：正对照臂那张失败截图里，输入框那一圈蓝色环清楚可见，
而且**跟着圆角走** —— 这正是把 `outline` 换成 `box-shadow` 的理由。所以 B 族是
"判据量了机制"，不是"环没了"。

**C 族逐 spec**：`inbound-automation` 5（`toHaveAttribute`）、`help-entry-ux` 4
（`settings-sheet` 里 `heading` 0 枚）、`public-facts` 3（`toHaveText`）、
`detail-pane-collapse` 3（超时）、`glass-materials` 2（超时）、`global-responsive-ux` 1
（`button[aria-controls="settings-group-sync"]` 0 枚）、`profile-avatar-plaintext` 1
（假服务端收到未登记的 `GET /api/auth/sessions`）、`sidebar-resize` 1、
`ai-capture` 1（`capture-ai` 不可见）、`calendar-capture` 1、`ai-unavailable` 1（超时）。

> 这一族**没有再往下定性**，也就没有猜着改。两条已知线索：
> ① `settings-group-sync` 与 `settings-sheet` 的 `heading` 都指向**设置 IA 七组迁移**，
> 而 `check:e2e-settings-ids` 明禁点旧 id —— 那批 spec 得按新 id 重钉；
> ② `capture-ai` 不可见与「规则读不懂才问模型」那条收窄同源，但
> `ai-capture` 用的 `把登录页在 Safari 上的错位修掉` 看起来不该被规则读懂，
> 所以**先查 `routing === undefined`**（配置了 `features: ['capture']` 之后
> 那条路由是否还成立），别直接照着改文本。

---

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
