# 设置页 UI 治理计划

**日期**: 2026-11-04  
**来源**: 三份审计报告（ui-ux-pro-max / apple-design / design-taste-frontend）的根因分析

---

## 问题根因

三份审计的共识：

1. **门禁按字面拼写设卡，换写法即绕过** —— `check:control-semantics` 点名了 `ht-btn--outline` 却没拒绝它
2. **动效/状态表征被当可选装饰** —— 文字反馈做到了工业级诚实，但 spinner 不转、sheet 无退场
3. **行语法未收敛** —— 同屏 13 个文件各写一套行解剖容器（54 处），是 2026-10-24 重排的残留

> ~~4. 产品禁令执行过头 —— "严禁说明文字只准问号"导致整屏可见引导≈0~~
> **这一条在 G-6 复核中被现量否证**：禁令本就带三条例外，且明写"删掉解释不算违规"；
> 可见消息实测 171 处，被禁的解释性内联说明是 0 处。根因是**审计子 agent 没回禁令原文就下结论**，
> 不是产品决策问题。教训已落到记忆（skill 审计的负面结论要回真源核）。

---

## 治理项

### G-1 门禁升级：拒绝未定义的按钮色调

**判据**: TSX 里 `className="ht-btn ht-btn--X"` 的 X 必须落在 CSS 已定义的档位集合内。

**实现**:
- 在 `scripts/check-control-semantics.mjs` 里补一条扫描
- 从 `controls.css` 提取所有 `.ht-btn--*` 类名作为白名单
- 扫 `apps/web/src/**/*.tsx` 里 `ht-btn--` 后跟的标识符，不在白名单即红
- 变异验证：临时写一个 `ht-btn--foo` 必须让门禁红

**优先级**: 高（防住下一次同类缺陷）

---

### G-2 新增尺：danger 语义色校验

**判据**: 渲染 `className="ht-settings__danger"` 的元素，其计算 `color` 必须等于 `--ht-color-danger`。

**实现**:
- 在 Playwright 的 settings 面板 spec 里加一条断言
- 取任意一个 `.ht-settings__danger` 元素，读 `getComputedStyle(el).color`
- 与 `--ht-color-danger` 解析后的 rgb 值比对

**优先级**: 高（C-1 类缺陷的防回归）

---

### G-3 字号纪律：可见消息禁 2xs

**判据**: `role="status"` / `role="alert"` / `.ht-settings__danger` / `.ht-settings__notice` 的 `font-size` 必须 ≥ `--ht-font-size-xs`（12px）。

**实现**:
- CSS lint 规则：扫 `ai-panels.css` 里这些类的 `font-size` 声明
- 或 Playwright 断言：对每个可见消息元素读计算字号

**优先级**: 中（H-1 类缺陷的防回归）

---

### G-4 统一 SettingsRow 组件契约

**2026-11-04 复核否证了本节的原前提**：原文写"先抽组件（不改行为）→ 逐面板迁移"，
但 `SettingsRow` / `SettingsRowModel` **早就存在**（`packages/ui/src/settings/model.ts`），
且 web 的 `WidgetPushPanel` / `WidgetJourneyPanel` 已经在用。所以"抽组件"这一格是已完成项，不是待做项。

**现量**（复量命令随附）：

| 读数 | 值 | 复量 |
|---|---|---|
| 手写行解剖的 web 设置文件 | 13 个 / 54 处 | `node scripts/check-settings-row-anatomy.mjs` |
| 已用共享契约的 web 面板 | 2 个 | `grep -rln 'SettingsRowModel' apps/web/src/features/settings` |
| 契约现有行档 | 5 档（`value`/`toggle`/`action`/`note`/`heading`） | `model.ts` 的 `SettingsRowModel` 联合 |

#### 为什么"逐面板迁移"不能在本机这一趟做完（不是不想，是契约装不下）

计划点名要迁的四格 —— 昵称、换邮箱、通行密钥改名、密码 —— 核心行都是
**「输入框 + 按钮」复合行**。逐档核过 `model.ts`：

| 档 | 有没有可编辑插槽 |
|---|---|
| `SettingsValueRow` | ✗ `readonly value: string`，只读 |
| `SettingsToggleRow` | ✗ `checked` + `onToggle`，是开关不是输入 |
| `SettingsActionRow` | ✗ `href` / `onPress`，是跳转不是输入 |
| `SettingsNoteRow` | ✗ `text`，整句说明 |
| `SettingsHeadingRow` | ✗ `text`，小标题 |
| `SettingsRowCommon` | ✗ 只有 `testID` + `divider` |

全契约唯一的 `ReactNode` 插槽是三处 `leading`（标签**前面**的图标），
**没有任何尾部或可编辑插槽**。⇒ 迁移要先给跨端契约加第 6 档，那要同时改：
`packages/ui/src/settings/Settings.tsx`（共享渲染器）+ 移动端 4 个屏幕的穷尽 switch
（`ProfileScreen` / `SettingsScreen` / `ProfileProgressSummary` / `ReminderDeliverySection`，
联合是穷尽的，漏一档编译就失败 —— 这是安全网不是障碍），
而**移动端运行时验证在这台机上没有腿**（就绪裁判现量：AVD 0 台、emulator-5554 不可达）。

#### 本节已做完的那一半（也是计划 G-4 标题的意图："新面板强制使用"）

`scripts/check-settings-row-anatomy.mjs` —— 账本制，与 `check:settings-prose` 同一条纪律：

- 账本外**新文件**出现手写行解剖容器 ⇒ 🔴 红（第六套解剖长不出来）；
- 账内读数**涨了** ⇒ 🔴 红；
- 账内读数**掉了却没改账本** ⇒ 🔴 红。

判的是**容器类名**（`__row`/`__section`/`__credential`/`__account-gate`/`__danger-card`/
`__order-card`/`__data-card`/`__list`），**不含** `__field`（宽度约束）与 `__item`（标签排版）——
那两个不是"行解剖"，把它们算进来会让门去管布局细节而不是管"又长出一套行"。

变异臂已实测能红（往 `MemoryPanel` 注一处 `ht-settings__section` ⇒ 门拒绝）。

#### 剩下那一半（迁移）：本趟**不做**，且理由是源码级的，不是"太大所以推后"

2026-11-04 复核把共享渲染器读完后，"把这四个面板迁到 `SettingsRow`"这句话
**方向是反的** —— 现在这份共享契约画的不是产品负责人 2026-10-24 拍板的那一套。

| 迁过去会发生什么 | 一边 | 另一边 |
|---|---|---|
| **丢掉两列对齐** | `sheets.css:246-252` `.ht-settings__row` = `grid-template-columns: minmax(5rem, 8rem) minmax(0, 1fr)` | `Settings.tsx:432` `ValueLine` = `<View style={styles.row}>`（flex 行，无标签列） |
| **标签降一档** | `__item-label` = `--ht-font-weight-medium` + `foreground` | `Settings.tsx:433-435` = `text['row-meta']` + 强制 `color.foreground-muted` |
| **邮箱被截断** | `sheets.css:300-304` `.ht-settings__value` 带 `overflow-wrap: anywhere`（长地址换行） | `Settings.tsx:438` 值那格 `numberOfLines={1}` |

第一条最要命：`ProfilePanel.tsx:17-30` 的文件头记着，2026-10-24 那次重排是为了治
「头像和昵称的**左边界各不相同**」，手段就是这**一列标签 + 一列控件**的网格。
把网格换成 flex 行，等于把那条已批的决定原样退回去。

⇒ **正确的收敛顺序**（下一趟要按这个做，不是按"迁面板"做）：

1. 给 `packages/ui` 的契约加两样：
   - `SettingsFieldRow`（label + 可编辑控件 + 尾随动作 + `valueTestID`）—— 解掉上面"五档无可编辑插槽"；
   - 一个**排版档**选择（`layout: 'inline' | 'grid'`），把 `__row` 那套两列网格与
     `__item` 那套 flex 行都表达出来 —— 而不是让调用方二选一地降级。
   - 值那格不许 `numberOfLines={1}`，要能选换行（邮箱这类长值要能看全）。
2. 移动端 4 个屏幕的穷尽 switch 各补新档（`ProfileScreen` / `SettingsScreen` /
   `ProfileProgressSummary` / `ReminderDeliverySection`）—— 联合是穷尽的，漏一档编译就红，
   这条是安全网。
3. **运行时验证两条腿都得有**：Android 在 linux-dev（本机 0 台 AVD），iOS 要 booted 模拟器。
   只 typecheck 过 ≠ 移动端画得对 —— 这正是 `model.ts` 文件头那条纪律防的事。
4. 然后才逐面板迁，每迁一格跑 `check:settings-prose` + `check:settings-row-anatomy`
   （读数应掉）+ typecheck + 界面验收，并 `--update` 把账本改小。

**为什么不先把能迁的迁掉（比如 ProfilePanel 的邮箱行看着像 `value` 档）**：
它形状上像，排版上不是同一件事（上面三条同时命中），迁完是一屏**可见的退步**，
而账本读数会掉一格、看起来"治理有进展"。那是拿一个错的收敛换一个好读的数。

---

### G-5 动效表征一等公民

**目标**: 状态表征（busy/done/error）必须有视觉动效，不能只靠文字。

**规则**:
- 所有 `<Loader2>` 必须带 `className="ht-spin"`
- 所有浮层/sheet 必须有对称的进出动画
- 门禁：grep `<Loader2` 不带 `ht-spin` 即红

**优先级**: 中（F-01 类缺陷的防回归）

---

### G-6 产品禁令校准 —— 原前提被现量否证，不需要人拍板

**原写法是错的**。本节原先记着「"严禁说明文字只准问号"执行过头，整屏可见引导≈0，
需产品负责人拍板放宽」。回源码逐条量过之后，两句话都不成立：

**1. 那条禁令本来就带三条例外，而且明写"删掉解释不算违规"。**
真身在 `docs/agents/design-system.md:112-160`（不是任何一份抄件）：

| 例外 | 内容 | 现量 |
|---|---|---|
| ① 反馈 | 失败/成功/进行中/空态/读数（`role=alert`/`aria-live`/`__danger`） | 42 `__danger` + 106 `__hint` + 23 `__notice` = **171 处可见消息** |
| ② 披露 | ADR-0054 §7 要求"对话之前就看得到"的出境披露 | `data-settings-disclosure` 3 处（`AiSettings.tsx:1270/1273/1276`） |
| ③ 页面标题副句 | "我在哪一屏"的确认 | `App.tsx:3416`（`web.profile.overview.lead`） |

规则文件原文：
> ⚠️ 这三条约束的是**位置与重复**，不是"每行都要挂问号"：没有值得问的句子就不挂。
> 删掉解释**不会**违反上面的禁令（禁令管的是"不许内联"，不是"必须有 `?`"）。

**2. "可见引导≈0"是假读数。** 现量 171 处可见消息元素，全部走反馈/披露豁免。
被禁的"解释性内联说明"是 **0 处**，且 `pnpm check:settings-prose` 的账本
`scripts/settings-prose-ledger.json` 现量 `{ total: 0, files: {} }` —— 禁令已清到零，
不是"执行过头"，是"按设计执行完了"。

**⇒ 结论：没有需要产品拍板的格子。** 原节里那三条"建议"（每面板放 1 条引导句、
超过 1 条才进气泡）是在**没有读禁令原文与其例外条款**的情况下提的，若照做会直接撞
`check:settings-prose` 的"账本外新增 ⇒ 红"。

**那用户实拍"这屏难看"归到哪？** 不归文案缺失，归两件已被本轮修掉/正要做的事：

| 真因 | 落点 |
|---|---|
| 输入框无边框 + `flex:1` 铺满 ⇒ 占位文字是**唯一**"这里可输入"的线索（`EmailChangePanel.tsx:295-297` 自己记着这条实测） | 本轮已修：昵称格补 `__field` 宽度约束；`__hint` 字号 12→14 |
| 同屏 13 个文件各写各的行解剖（圆角 8/12 来回、分隔方式不一） | G-4：门已落地防新增，迁移待移动端腿 |

**优先级**: ✅ 关闭（前提否证，无待决）

---

## 执行节奏

| 周次 | 做什么 | 状态 |
|---|---|---|
| W1（本轮） | G-1 + G-2 落地为门禁 | ✅ G-1 账本清空、A4 硬拒；✅ G-2 静态 CSS 臂（`check-font-size-discipline.mjs`） |
| W1（本轮） | G-3 + G-5 落地为门禁 | ✅ G-3 `check-font-size-discipline.mjs`；✅ G-5 `check-spinner-discipline.mjs`（均带变异臂实测能红） |
| W1（本轮） | G-4「新面板强制使用」那一半 | ✅ `check-settings-row-anatomy.mjs` 账本制 + 变异臂能红 |
| 下一趟（顺序已改） | G-4 迁移那一半：**先给契约加 `field` 档 + `layout: inline/grid` 档**，再迁面板 | 共享渲染器画的不是 2026-10-24 拍板的那套两列网格（三条退步见 G-4 节）；且移动端运行时验证两条腿本机都没有 |
| — | G-6 禁令校准 | ✅ 关闭：前提被现量否证，无需产品拍板（见该节） |

---

## 验证方式

每条新门禁必须：
1. 在违规输入下真的会红（AGENTS §6 第 2 条）
2. 有变异臂（临时注入违规 → 门禁红 → 撤销 → 门禁绿）
3. 写进 `docs/agents/commands.md` 的 `verify:*` 列表
