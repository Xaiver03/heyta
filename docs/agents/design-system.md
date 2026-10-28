<!-- 由 heyta/AGENTS.md 按作用域拆分而来（2026-10-12）。内容零删除。
     本文件是「设计系统（UI 代码必读）」的完整规则（原文 §5 设计系统）。返回入口：[`AGENTS.md`](../../AGENTS.md)。
     原始单体文件备份：`AGENTS.md.bak-full-2026-10-12`。 -->

## 5. 设计系统（UI 代码必读）

**唯一事实源：[`packages/design-system/src/tokens.css`](../../packages/design-system/src/tokens.css)。**
规则与理由见 [`design-system/heyta/MASTER.md`](../../design-system/heyta/MASTER.md)（**不复制取值表**）。

**色系：蓝白。** 主蓝 `#2563EB`，近白底 `#F8FAFC`，冷调石板灰中性色。

### 🔴 三条硬规则

1. **组件禁止裸值** —— 不得出现裸 hex / px / ms / z-index / rgb()。
   用 `cssVar('color.foreground')`（类型安全，拼错编译期报错）。
2. **语义名，不用外观名** —— `--ht-color-danger` 而不是 `--ht-red`。
   组件只消费语义层，原始色阶（`--ht-blue-600`）留给设计系统内部。
3. **要新变量，先加 token** —— 先改 tokens.css 与 `TOKEN_GROUPS`，再消费。
   **加 token 的成本是刻意的**，它逼你想清楚这个值是不是一次性的。

```bash
pnpm check:design     # 非零退出 = 有裸值
```

#### 🔴 文字层级（2026-09-30 增：排版审计实测"一页八个页标题"）

语义文字样式的唯一规范是 `packages/design-system/src/typography.ts` 的
`TEXT_STYLES`（字号+字重+行高+字距**整条消费**，不许只挑字号）。web 的映射：

| 角色 | 值 | 例 |
|---|---|---|
| 页标题（一屏一个） | xl + semibold（`.ht-header__title`） | 设置 / 收集箱 |
| 区块标题 | **lg + semibold**（= 共享层 `section-title`） | 设置的"功能模块/提醒通知"、任务分组头 |
| 子块/卡片标题 | base + semibold（`.ht-settings__h3`） | 面板里的小节 |
| 正文 | base + regular，行高 `--ht-line-height-normal` | |
| 辅助/说明 | xs 或 sm + muted 色 | 卡片描述、表单注释 |

反例（已修）：设置面板标题曾是 xl + bold —— 与页标题一般大，层级全塌。

> 该检查器已用**注入违规文件**验证过能失败（它扫的类别数由自己打印，现量看 `pnpm check:design` 第一行；
> 这一句原先钉着的类数早已落后于实现）。⚠️ 它只证过**注入的那几类**会红，
> **不等于每一类都有注入证据** —— 要新增一类就先补一枚能红的臂，别替它吹。
> **不能失败的检查没有价值。**

### 🔴 对比度是测试保证的，不是文档保证的

`pnpm --filter @heyta/design-system test` 会解析 tokens.css、递归展开 `var()`、
按 WCAG 公式**真实计算**每一对前景/背景对比度，不达标就失败。

> **这个测试已经抓到过真问题**：`quadrant-3` 原用 amber-600（`3.19:1`）不达正文标准，
> 已改为 amber-700（`5.02:1`）。写在文档里的"4.5:1"是拦不住的。

### 🔴 交互控件的档位只有一处定义（2026-10-28，全局 UX 线 P4）

一枚按钮"长什么样"的答案**只许住在一个地方**：`packages/ui/src/control/states.ts` 的
`CONTROL_PALETTE`（色调 `primary`/`secondary`/`ghost`/`danger` × 重量 `inline`/`commit`）。
表里写的是 **token 名**，不是色值也不是类名 —— Web 把它翻成 `var(--ht-…)`，
移动端把它翻成 `HeytaNativeTokens[name]`。**翻译可以两份，判断只许一份**（AGENTS §3.5）。

三条会踩到的：

1. **不许有不带色调的 `.ht-btn`**。立项现量 18 处（AI 面板、隐私同意层、危险确认的「取消」），
   它们没有底也没有 hover 底，图上读起来就是说明文字。今天归零，`check:control-semantics` 的 A8 守住。
2. **危险动作分两档，按位置选**：列表行/设置项里那枚是 `inline`（透明底 + 危险色字），
   确认层里唯一要按下去的那枚是 `commit`（实底 + `color.on-danger`）。
   两端原本各对一半（Web 恒为透明底、Mobile 恒为实底），缺的是"这一枚站在哪个位置"这一格判断。
   ⚠️ 实底那枚的前景**不许**用 `foreground-inverse`：暗色的 `danger` 是提亮后的浅红，
   白字压上去只有 2.77:1，`on-danger` 换深之后是 7.29:1 —— 这两个数由对比度套件现算。
3. **功能 CSS 不许重声明控件外观**（`background`/`color`/`border`/`box-shadow`/`opacity`/`outline`），
   布局（`flex`/`inline-size`/`padding`）归宿主、一律放过。

门禁：`pnpm check:control-semantics`（14 枚 self-test 臂 + 两次真树变异取证）。
它**看不到**的那一格诚实登记在脚本头部：选择器里不写控件族类名、只写宿主自己那枚 class 的
外观覆盖 —— 那一格归"真实浏览器逐态读计算样式"（`e2e/tests/control-semantics.spec.ts`）。

### 🔴 行内动作条：每一枚动作都是 `.ht-chip`，不许裸 `<summary>`

`.ht-compose-actions__items` 这一排（备注 / 子任务 / 截止 / 提醒 / AI …）里，
动作的**字号不属于组件，属于这一排**：`.ht-chip` = `font-size-2xs`（11px）。
一枚裸 `<summary>` 只写 display/gap/color 时，字号会**回落到从行的 16px** ——
于是同一排出现 11px 与 16px 两档，而所有测试都是绿的。

2026-10-21 实测（1012×632 打开「更多」）：`备注/子任务/提醒` = 11px，`截止` = **16px**，
用户一眼看出来（"截止这两个字也太大了吧"）。修法是把它收进 `.ht-chip`，
判据是 `e2e/tests/ai-panel-layout.spec.ts` 里那条**同一排 font-size 必须只有一档**。

### 🔴 把 RN 组件嵌进 web 的 flex 行：必须显式给它 `flex` / `max-inline-size`

React Native 的 `View` 默认 `flex: 0 0 auto`（与 CSS 的 `0 1 auto` **不同**），
`width: auto` 于是解析成 **max-content**。嵌进 web 的 flex 行时，它会**既不收缩也不换行**，
把容器撑破。实测：AI 提案面板（RN `View`）在 384px 的行内浮层里量到 **493px**，
左溢 121px 压住任务列表 —— 原因是 note 那一整行 469px + 内边距 24px。
判据与修法都在 `apps/web/src/styles/app/controls.css` 的
`.ht-compose-actions__items > [role='dialog']` 那一段（`flex: 1 1 100%` + `min-inline-size: 0`）。

### 容易犯的几个错

- ❌ **用 emoji 当图标** —— 跨平台渲染不一致且不受 token 控制。统一用 **Lucide**。
- ❌ **`outline: none`** —— 抹掉焦点环是最常见的可访问性回归。用 `:focus-visible`。
- ❌ **hover 用 `translateY` 位移** —— 扁平风格用**边框**表达层次，阴影只给真正的浮层。
- ❌ **不测暗色主题就交付** —— 暗色不是亮色的反相，必须**实际切换查看**。
- ❌ **数字不加 `.tabular-nums`** —— 番茄钟计时与统计数字的宽度会跳动。

---

## 🔴 设置界面里**禁止**写说明文字（2026-10-24，产品负责人下的禁令）

原话（第二次说的时候已经很生气，所以这条是**禁令**，不是建议）：

> 「严禁说明文字出现，严禁说明文字直接写进去。只允许用那种"一个圈里面一个问号"的，
>   hover 上去有。把这种东西写成严格的代码禁令……彻底禁止！」

**规则**：设置界面的每一个控件旁边，只许出现**控件本身**（标签、开关、输入框、按钮）。
任何"这个是什么 / 为什么这样 / 会怎样"的句子，一律进 `?`：

| 端 | 合法载体 |
|---|---|
| web | `SettingsInfoTip`（`apps/web/src/features/settings/SettingsInfoTip.tsx`），渲染成 `?`，悬停**或**聚焦展开，`Esc` 收起，正文常驻 DOM 由 `aria-describedby` 指向 |
| mobile | 同名组件的移动版（`InfoTip`，点击展开）—— ⚠️ 尚未建，移动端的存量在账本里 |

三条例外（**写清楚才好反驳**）：

1. **反馈**：失败 / 成功 / 进行中 / 空态 / 读数。`role="alert"`、`aria-live`、
   `ht-settings__danger`、testid 里带 failure/error/status 的那些 —— 把"这一单没下成"
   塞进气泡是另一种错：用户得先点一下才知道出了什么事。
2. **披露**：ADR-0054 §7 要求"对话之前就看得到"的出境披露（助手那一块）。
   藏进悬停气泡就不再是披露。用 `data-settings-disclosure="true"` 显式登记。
3. 页面标题的副句（`web.profile.overview.lead`）—— 它是"我在哪一屏"的确认，
   不是某个控件的解释。**只有这一处**，也记在账本里。

**判据**：`pnpm check:settings-prose`（`scripts/check-settings-no-prose.mjs`）。

它是**账本制**（与 `check:overlay` 同一条纪律）：

- 账本外新增 ⇒ 🔴 红（新写的说明文字一天都进不来）；
- 账内读数涨了 ⇒ 🔴 红；
- 账内读数掉了却没改账本 ⇒ 🔴 红（这一条是"它真的在缩"的唯一读数）。

账本：`scripts/settings-prose-ledger.json`。清理时**只许改小**：
`node scripts/check-settings-no-prose.mjs --update`。

⚠️ 为什么不是一次清完：存量横跨两端、十九个文件；一次改完会把"删说明"与
"重写控件"混成几百行，而那种改动的判据只有"跑起来了"。账本让每一屏的收缩都可读。

### 那道门有一道**已知的缝**，缝上补了两道判据

`check:settings-prose` 扫的是**调用点**（`ht-settings__*hint*` 容器、行模型里的 `hint:` 字段），
**不扫组件内部**（理由写在脚本头部）。于是有一种改法它看不见：

```diff
- {row.hint === undefined ? null : (<SettingsInfoTip text={row.hint} … />)}
+ {row.hint === undefined ? null : (<Text>{row.hint}</Text>)}
```

调用点一个字节没变 ⇒ 门禁照样绿，而屏幕上一整句说明又回来了。**2026-10-24 实测过**
（当时是为了证明设备腿会红）：`check:settings-prose` ✅、设备腿 ❌。

现在这条缝由两道互补的判据堵着：

| 判据 | 成本 | 抓的是 |
|---|---|---|
| `packages/ui/tests/settings-hint-through-tip.spec.ts` | 毫秒 | **源码形状**：`Settings.tsx` 里每处 `row.hint` 必须交给 `SettingsInfoTip` 或存在性守卫 |
| `pnpm verify:mobile-ios-subscription` | 一枚模拟器 + 一次构建 | **行为**：hint 默认不在 AX 树上、点 `?` 出现、再点收起 |

两条分工是刻意的：**同一个判断不在两个地方长牙**，但"入口"必须有一道零成本的。

### `?` 的贴合位置（2026-10-24 修）

行首那一列是 `actionHead`。它原来是 `alignItems: 'center'`，于是 `?` 展开时那一列多出一行正文、
居中对齐把**图标本身**也一起挪位（设备截图上看得见：展开后 `?` 比标题高出一截，点一下动一次）。
改成 `'flex-start'`：图标只随标题首行定位，开合都在同一处。
⚠️ 这条的证据是**两张图**，不是像素读数 —— 展开会重排列表，跨图比绝对 y 会被滚动锚点混淆
（三种探针实测不稳）⇒ 只主张看得见的那件事。
代价是与单行标题的视觉中心差约 3pt（**常量**，不动就不显眼）。
判据仍是那条设备腿的两张图（`00-tip-collapsed.png` / `01-tip-expanded.png`）。
