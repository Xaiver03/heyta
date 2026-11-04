# heyta 设置页 UI/UX 审计报告 —— ui-ux-pro-max 方法论全量执行

**审计日期**：2026-11-04
**审计对象**：设置浮层（`.ht-sheet` / `role="dialog"`）七个 tab —— 账号（个人资料）、订阅、数据与同步、提醒与通知、外观与语言、功能与 AI、关于与帮助
**方法论**：`~/.agents/skills/ui-ux-pro-max/SKILL.md` 全量执行（Step 1 → Step 2 `--design-system` → Step 3 七条领域检索 → Quick Reference §1–§10 逐条打钩 → Pre-Delivery Checklist 逐条判定）
**对照基线**：`docs/agents/` 的 design-system / ux-principles / overlay-feedback 与本仓 `tokens.css` 自订档位

---

## 0. 方法论执行记录

### 0a. 检索脚本（全部实跑，输出已用于本文判据）

| # | 命令 |  domain | 命中 |
|---|---|---|---|
| 1 | `search.py "settings form input button" --domain ux -n 20` | ux | 7 |
| 2 | `search.py "dark mode contrast accessibility" --domain ux -n 20` | ux | 12 |
| 3 | `search.py "loading feedback interaction" --domain ux -n 20` | ux | 20 |
| 4 | `search.py "productivity task management" --domain product -n 10` | product | 10 |
| 5 | `search.py "minimalism dark mode" --domain style -n 10` | style | 8 |
| 6 | `search.py "system font ui typography" --domain typography -n 10` | typography | 7 |
| 7 | `search.py "settings navigation" --domain ux -n 15` | ux | 9 |
| 8 | `search.py "productivity task management local-first minimalism dark mode" --design-system` | 全域 | 1 份推荐 |

**Step 2 输出的推荐（用于 §4/§6 判定）**：Productivity Tool → 主风格 `Flat Design + Micro-interactions` / 次选 `Minimalism`；色板焦点 `Clear hierarchy + functional colors`；字体 Inter；反模式 `Complex onboarding / Slow performance`。
本仓实测：`--ht-font-sans` 首栈即 `'Plus Jakarta Sans'`（tokens.css:234-237），对应 typography 域命中的 **Result 1**（Plus Jakarta Sans + System），且该配方的适用条件写的是 *"Single-family or System fallback … pairs beautifully with the monochromatic surface"* —— **字体选型命中，不是偏离**。Flat/Swiss 取向（无装饰阴影、边框表层次）与 `tokens.css:303` 的注释一致。**风格匹配（`style-match`）判定：通过。**

### 0b. 本文引用的实测总数（全部为本轮现量，复量命令随附）

| 现量 | 值 | 复量命令 |
|---|---|---|
| `ht-btn` 分色调用量 | ghost **115** / primary **42** / secondary **14** / danger **7** / **outline 1** | `grep -rho 'ht-btn ht-btn--[a-z]*' apps/web/src --include='*.tsx' \| sort \| uniq -c` |
| `ht-btn--outline`（**零定义类**） | 1 | `grep -rn 'ht-btn--outline' apps/web/src` |
| `<SettingsInfoTip>` 调用点 | **49** | `grep -rn '<SettingsInfoTip' apps/web/src --include='*.tsx' \| wc -l` |
| `.ht-settings__danger` / `__notice` 用量 | **41** / **23** | `grep -rho 'ht-settings__\(danger\|notice\)' apps/web/src --include='*.tsx' \| sort \| uniq -c` |
| `--ht-font-size-2xs`（11px）用量 | **23** | `grep -rn 'ht-font-size-2xs' apps/web/src packages/ui/src \| wc -l` |
| `ICON_SIZE.xs / sm / md / lg` | **151 / 81 / 20 / 6** | `grep -rho 'ICON_SIZE\.[a-z]*' apps/web/src --include='*.tsx' \| sort \| uniq -c` |
| 设置目录项数 | **7** | `grep -c 'className="ht-settings__group"' apps/web/src/App.tsx` |
| `ht-ai-settings__*` 类名用量 / 已定义规则 | **20 / 33** | `grep -rn 'ht-ai-settings__' apps/web/src --include='*.tsx' \| wc -l`；`grep -c '^\.ht-ai-settings__' apps/web/src/features/settings/ai-settings.css` |
| `border*(:\|-width:)` 声明总数 | **342**，其中 `border-*: 0` **114** | `grep -rnE '^\s*border(-[a-z]+)*(-width)?:' apps/web/src/styles \| wc -l`（第二条管道加 `grep -E ':\s*0;'`） |
| 设置层 CSS 的 space 档位分布 | `space-2` **95** / `space-3` **63** / `space-1` **60** / `space-4` **48** / `space-6` 10 / `space-5` 1 / `space-8` 1 / `space-16` 1 | `grep -rho 'var(--ht-space-[0-9]*)' apps/web/src/styles/app/{sheets,ai-panels}.css apps/web/src/features/settings/*.css \| sort \| uniq -c` |
| 设置层断点 | `48rem` **23** / `64rem` **2** / `63.9375rem` **2** / `26rem` 2 / `42rem` 1 | `grep -rhoE 'max-width: [0-9.]+rem' apps/web/src/styles apps/web/src/features/settings/*.css \| sort \| uniq -c` |
| `apps/web/src/styles/` 里裸 px/ms 声明 | **4** | `grep -rnE '^\s*[a-z-]+:\s*[0-9]+(px\|ms)\b' apps/web/src/styles \| grep -v '0;'` |
| 设置目录内装饰图标 `aria-hidden="true"` | **109** | `grep -rho 'aria-hidden="true"' apps/web/src/features/settings --include='*.tsx' \| wc -l` |

---

## 1. CRITICAL（4 条）

### C-1 错误反馈整族没有语义色 —— 成功、失败、中性三档坍塌成「一段小字」

- **位置**：`apps/web/src/styles/app/ai-panels.css:406-412`（`.ht-settings__danger`）、`:414-417`（`.ht-settings__notice`）
- **违反规则**：§8 `contrast-feedback` / `destructive-emphasis`；§4 `state-clarity`；§1 `color-not-only` 的反向失守；`docs/agents/design-system.md`「语义色 + 文字层级」
- **现量**：

  ```css
  .ht-settings__danger {          /* 名字是 danger，配色不是 */
    padding: var(--ht-space-2);
    border-left: 0;               /* 左强调条被删，且宽度归零后 color 永不着色 */
    color: var(--ht-color-foreground);          /* ← 与正文同色 */
    font-size: var(--ht-font-size-xs);          /* 12px */
    background: var(--ht-color-surface-sunken);
  }
  .ht-settings__notice { color: var(--ht-color-foreground-muted); font-size: var(--ht-font-size-2xs); } /* 11px */
  ```

  全仓 `.ht-settings__danger` 用量 **41 处**、`.ht-settings__notice` **23 处** —— 账号 tab 的每一句失败（`EmailChangePanel.tsx:220/342/353/359/363/373`、`PasswordPanel.tsx:465/478/600/619/623/640`、`PasskeyPanel.tsx:262/274/291/460/464`、`ProfilePanel.tsx:474`、`SessionsPanel.tsx:291`、`AiSettings.tsx:733/791/1518`）用的都是这一条规则。
  **结果**：一次保存失败与一次"顺手写在这里的说明"在配色上完全同值。用户能分辨的唯一线索是**这一句前面有没有一枚 `<AlertTriangle>`** —— 而这一点本身就不一致：`ProfilePanel.tsx:466-471`（昵称超长）与 `AiSettings.tsx:1518`（重置 AI 前的警告）**都没有图标**。于是同一页里"有图标的 danger"与"没图标的 danger"视觉上等价（都靠 sunken 底），后者等同于正文（`--ht-color-foreground` 就是正文色）。
  `border-left: 0` 是**死声明**：宽度为 0 之后任何 `border-left-color` 都不再着色，这条被删掉的强调条从来没画出来过，所以删它没有视觉变化 —— 但它说明这一族的"危险感"曾经只剩颜色，现在颜色也撤了。
  顺带：`settings-notice.css:21-24` 的四个 tone 修饰类**只设 `border-color`、从不设 `border-*-width`**，而基类 `:8` 写 `border-inline-start: 0` —— `--success / --warning / --danger / --info` 四种色调在图上是同一件事（详见 M-3）。
- **修法**：① `.ht-settings__danger` 前景改 `var(--ht-color-danger)`，并把 `font-size` 提到 `sm`；② 要么补 `border-inline-start-width: var(--ht-border-width-thick)` 让强调条真的画出来，要么把这行声明删掉；③ `settings-notice.css` 四个 tone 各自补齐 `border-inline-start-width`；④ 补一条能失败的门禁：扫 `className="…__danger"` 的元素，其计算 `color` 必须等于 `--ht-color-danger`（当前这条判据**不存在**，所以这个缺陷存活至今）。

### C-2 注销账号入口的按钮类名没有 CSS —— 全站唯一不可逆操作的触发器读起来像一句说明文字

- **位置**：`apps/web/src/features/settings/CloseAccountPanel.tsx:174`（`className="ht-btn ht-btn--outline"`）
- **违反规则**：§4 `state-clarity` / `system-controls`；§2 `cursor-pointer`+可点性可辨；§8 `destructive-emphasis`；`check:control-semantics` 的立卡理由
- **现量**：`grep -rn 'ht-btn--outline' apps/web/src/styles/` ⇒ **0 命中**（同一条复量在 `packages/` 下也为 0）。全仓唯一一处使用就是这一行（另两处命中分别在 `scripts/check-control-semantics.mjs:28` 与 `docs/plans/global-ux-system-remediation.md:447` 里**点名它作为现量反例**）。
  `controls.css:60-66` 已把这一类缺的形态逐字描述过：

  > `className="ht-btn"` 这种不带色调的按钮 …… 它们没有底也没有 hover 底，图上读起来就是说明文字

  并声称该形态已收编（复量命令 `grep -rn 'className="ht-btn"'` ⇒ 0 处）。复量确实为 0 —— 但**换了一条拼写绕过**：`ht-btn--outline` 不在 `ht-btn--primary/secondary/ghost/danger` 四档里，基类 `.ht-btn` 无 background、无 color、无 hover，于是它比"裸 `ht-btn`"更空：裸 `ht-btn` 至少还有 `ht-btn--secondary` 的收编纪律可查，`--outline` 什么也没有。
  **落点后果**：注销流程第一步的按钮坐在 `.ht-settings__danger-card`（`background: var(--ht-color-surface-sunken)`）上，与卡片同色、无 hover 底 —— 用户要在一个**不可逆**动作前，从一段文字里认出哪个词能点。
- **修法**：改成 `ht-btn ht-btn--secondary`（次要档，已定义、hover 已定义），或给它一个真实的 `.ht-btn--outline { border: var(--ht-border-width-thin) solid var(--ht-color-border-strong) }`（但会撞上 `borderless-controls.css:18-21` 的 `border-color: transparent !important`，所以走前者）。并把 `check:control-semantics` 从"点名它"升级为"拒绝它"：扫 TSX 里全部 `ht-btn--X`，X 必须落在 CSS 已定义的档位集合内。

### C-3 通行密钥改名的输入框没有可见 label —— 只有一个 placeholder

- **位置**：`apps/web/src/features/settings/PasskeyPanel.tsx:329-339`
- **违反规则**：§1 `form-labels`（检索 #1 Result 5，Severity **High**：*"Inputs must have associated labels / Use label with for attribute or wrap input / Don't: Placeholder-only inputs"*）、§8 `input-labels`（检索 #1 Result 2，High：*"Placeholder as only label"*）、`input-helper-text`
- **现量**：该 `<input>` 的无障碍名与视觉名都来自 `placeholder={t('web.passkeys.renamePlaceholder')}`（:336），没有 `<label htmlFor>`、没有 `aria-label`、外层 `<div className="ht-settings__actions">`（:327）也不是 `<label>`。
  **同一文件的其他字段都做对了**：同屏的按钮都有文字标签（:340、:364）、`aria-pressed` 在 PasswordPanel 齐备。所以这不是"整仓不会写 label"，是**这一处漏了** —— 症状是 placeholder 一旦用户开始打字就消失，"这一格是在改哪一条凭据"当场失去上下文（同一列表里可能同时挂着 3 条凭据）。
- **修法**：`<label htmlFor={`passkey-name-input-${passkey.id}`} className="ht-settings__item-label">{t('web.passkeys.renameLabel')}</label>` 放在 `ht-settings__actions` 之前（或复用 `FormField layout="inline"`，与 `AiSettings.tsx:910-954` 同一形状）；placeholder 降级为示例值而不是名字来源。

### C-4 注销结果的四档结局用 `aria-live` 挂在**被条件渲染的元素自己身上** —— 读屏拿不到任何结局播报

- **位置**：`apps/web/src/features/settings/CloseAccountPanel.tsx:199-208`
- **违反规则**：§1 `aria-live-errors` / `voiceover-sr`（检索 #2 Result 4，High：*"Use aria-live or role=alert for errors / Don't: Visual-only error indication"*）、§8 `toast-accessibility`
- **现量**：`role="status"` + `aria-live="polite"` 都挂在那个 `{done ? <p …> : null}` 的 `<p>` 上。ARIA 实时区域的语义是**"已存在于可访问性树里的节点，其内容发生变化时播报"** —— 元素随内容一起挂载时，辅助技术没有可订阅的旧区域，播报通常不发生。注销是**四档结局**（`closed-erased-all` / `closed-erased-partial` / `not-closed` / 失败，见该文件 :26-29 的文件头纪律「压成一句会在两个方向同时说谎」），读屏用户对这四档的实际体验是**按下之后什么都没有发生** —— 而这个动作已经把本机数据清掉了。
  **同一页里有正确写法可抄**：`PasswordPanel.tsx:455` 与 `:591`、`EmailChangePanel.tsx:335` 用的都是**常驻空容器** `<div aria-live="polite" data-testid="password-live">`，内容在里面进出 —— 三处一致，只有 `CloseAccountPanel` 分叉。
- **修法**：把 live 区提为常驻：`<div aria-live="polite" role="status">{done ? <p …/> : null}</div>`；失败那一档同时用 `role="alert"` 分区（`--not-closed` 是"服务端没删成"，属于错误，不该走 polite status）。

---

## 2. HIGH（12 条）

### H-1 反馈层字号 11px / 12px —— 设置页的"回执档"低于全仓自订的辅助文字下限

- **位置**：`ai-panels.css:416`（`.ht-settings__notice` = **2xs 11px**）、`:393`（`.ht-settings__hint` = xs 12px）、`:407-411`（`.ht-settings__danger` = xs 12px）、`:467`/`:475`（`__item-sub`/`__tag` = 2xs）、`:517`（`.ht-chip` = 2xs）、`:634`（`__cap-hint` = 2xs）、`:1015`（`.ht-settings__warn` = 2xs）、`settings-account.css:53`（`__credential-meta` = 2xs）
- **违反规则**：§6 `font-scale` / `contrast-readability`；§5 `readable-font-size`；skill 反模式 "Text < 12px body"
- **现量**：`--ht-font-size-2xs: 0.6875rem`（tokens.css:242）自己的注释写着 **「仅极致紧凑标签」**，而 `--ht-font-size-xs`（:243）注释写着 **「12px — 辅助文字下限」**。今天 2xs 在用 **23 处**，其中承载的是 **真文字**：保存成功的回执（`__notice`）、每条凭据的创建/最近使用时间（`__credential-meta`）、AI 出境标签"数据会离开这台设备"（`__tag--remote`）、能力缺口的解释（`__cap-hint`）、错误旁的警示行（`__warn`）。
  把 11px 用成回执档位有两重伤害：① 与 token 的语义承诺相反（`design-system.md`「语义名不用外观名」的同一族违规）；② 这些恰恰是**用户最需要看清**的字（成功/失败/时间/风险），字号却是最小的一档。
- **修法**：`__notice` / `__danger` / `__hint` 三档统一提到 `sm`（14px）；`__credential-meta`、`__tag`、`__cap-hint` 提到 `xs`（12px = 自订下限）；2xs 只留 `.ht-ai-settings__tool-technical code` 这类真标签。

### H-2 「本机」标记与设备名同档同色 —— 唯一靠颜色分不开的一处语义

- **位置**：`SessionsPanel.tsx:235-241`（`thisDevice` 那一句与 :230-233 的设备名共用 `.ht-settings__item-label`）、`settings-account.css:44-54`
- **违反规则**：§5 `visual-hierarchy`、§9 `nav-state-active`、§1 `color-not-only` 的镜像缺陷（这里不是"只靠颜色"，是"连颜色都没靠上"）
- **现量**：`ai-panels.css:461-463` 的 `.ht-settings__item-label` 只有 `font-weight: medium`，**没有颜色、没有字号差异**。所以一行会话的"这台就是你现在用的设备"与"这台叫 iPhone 15"在排版上是**同一档同一色**，只分两行先后。设备行本来就允许没有名字（`rowLabel()` 返回 `undefined`，:70-75），此时那一行只剩「本机」+ 时间戳，用户无法判断哪一句是身份、哪一句是状态。
- **修法**：给 `thisDevice` 一个独立类（如 `ht-settings__badge--current`），`background: var(--ht-color-primary-subtle)` + `color: var(--ht-color-primary)` + 一枚图标；不要只靠顺序表达。

### H-3 日期时间三套口径 —— 同一页里三种写法，且都不可扫读

- **位置**：`PasskeyPanel.tsx:130-132` + `:316`/`:320`（`shortDate` = `iso.slice(0,10)`，无 locale）、`SessionsPanel.tsx:59-67` + `:244-247`（`toLocaleString(locale, { year:'numeric', … })`）、`app-host/privacy-consent.ts:165-167`（`formatPrivacyDecisionTime` = `${iso.slice(0,10)} ${iso.slice(11,16)}`）+ `PrivacyPanel.tsx:78-81`（**不传 locale**）
- **违反规则**：§6 `number-tabular`、§10 `number-formatting`（locale 感知）、§3 `content-jumping`（非等宽数字导致宽度跳）、AGENTS §3.5 精神（同一判断不许两处各写一遍）
- **现量**：
  1. `year:'numeric'`（SessionsPanel:61）不是 `2-digit` —— zh-CN 下输出 **「2026年11月4日」** 而非规范要求的 **「26年11月4日」**，实测 7 列宽被年份撑爆；
  2. 同一块面板里凭据时间用 `2026-11-04`、会话时间用 `2026年11月4日 下午3:05` —— **一屏两套日期字形**；
  3. `PrivacyPanel:78-81` 调的是 app-host 的切片函数，**不跟界面语言**，与 `:88-92` 的 `SettingsNotice tone` 并排时，一个本地化、一个 UTC 字面量（ISO 串直接切片会把 UTC 时刻当本地时刻显示，这是**事实错报**而不是排版问题）；
  4. 三处都没有 `font-variant-numeric: tabular-nums`（`controls.css:278` 的 `.ht-due` 有）—— 时间戳在列表里逐行宽度不一。
- **修法**：抽一份 `formatDateTime(ms | iso, locale)`（带 `year:'2-digit'` + `font-variant-numeric: tabular-nums`），三处共用；`app-host` 那份切片函数改为接收 locale 或删除。

### H-4 焦点态整族被禁用，改由 `background` + `box-shadow` 表达 —— 与 `check:focus-single-source` 打架

- **位置**：`borderless-controls.css:28`（`:focus { outline: 0 !important }`）、`:73`（`:focus-visible { outline: var(--ht-focus-ring-width) solid … !important }`）与 `:18-26` 的 `box-shadow: none !important` **同块共存**；`sheets.css:736-739`、`:742`（option 的 focus 用 `outline`）；`ai-panels.css:234-240`
- **违反规则**：§1 `focus-states`（2–4px 可见环）
- **现量**：`:18-26` 把 `box-shadow` 归零、`:28` 把 `outline` 归零，`:73` 又用 `!important` 恢复 `outline` —— **同一个文件里两条相反的 `!important`**，胜负由源序决定，任何人重排这一块的顺序都会静默改变全仓焦点环的有无。
  `habits.css:656` 的 `.ht-habit__pane:focus-visible` 正是**被迫**往内画环的实例；`ai-panels.css:237` 的 `:has(input:focus-visible)` 是第二套焦点实现（走 background），与 `check:focus-single-source`「焦点状态只有一份全局实现」的裁决相悖（`menu.css:65-68` 逐字写着这条纪律）。
  `--ht-focus-ring-width: 2px`（tokens.css:379）是 §1 区间（2–4px）的下沿，本身合规。
- **修法**：删掉 `:18-26` 与 `:28` 里对 `outline`/`box-shadow` 的 `!important` 归零，只保留 `:73` 一处 `:focus-visible` 声明；`:237` 的 background 表达保留为"选中态"而不是"焦点态"的替代实现。

### H-5 「已保存」类成功回执不自动消失，且没有 `role="status"`

- **位置**：`ProfilePanel.tsx:508-525`（`NoticeLine`）、`:267`；对照 `EmailChangePanel.tsx:335`（有 `aria-live="polite"`）
- **违反规则**：§8 `toast-dismiss`、`success-feedback`、`aria-live-errors`
- **现量**：`NoticeLine` 渲染的 `<p className="ht-settings__notice" data-testid={testId}>` **没有 `role`**（`aria-live` 也缺），而 `Notice` 联合类型只有 `idle|busy|done|error`，没有计时器 —— 保存成功后 `notice.kind === 'done'` 会**永久停留**，直到下一次编辑才被 `:467` 置回 `idle`。昵称那一格因此长期挂着一句"昵称已保存"，用户无法区分它说的是刚才那次还是上一次。
  `busy` 态在 `NoticeLine` 里被 `return null`（:509）—— 所以按下保存后**先是一段时间什么都不显示**，按钮图标换成 spinner 是唯一的进行中信号（`:445-453`）。
- **修法**：`done` 档加 3–5s 自动淡出；`role={kind === 'error' ? 'alert' : 'status'}`；`busy` 档返回一行真实进行中文案而不是 null。

### H-6 忙态纪律两套：guard（不禁用）与 `disabled` 同页并存

- **位置**：走 **guard** —— `EmailChangePanel.tsx:311`（注释明写"忙态用 guard，不用 disabled"）、`PasswordPanel.tsx:418`/`:519`（`:46-49` 文件头第 2 条引 ADR-0040 §3.7「禁用态让人困惑，提交后禁用还会甩掉焦点」）
  走 **`disabled`** —— `ProfilePanel.tsx:374`/`:387`/`:449`、`PasskeyPanel.tsx:207`/`:226`/`:344`/`:368`/`:382`/`:398`/`:410`/`:425`、`SessionsPanel.tsx:146`/`:261`、`AiSettings.tsx:1089`、`CloseAccountPanel.tsx:191`
- **违反规则**：§2 `loading-buttons`、§8 `disabled-states`、§4 `consistency`
- **现量**：同一个设置浮层里，"更换登录邮箱"的提交按钮忙时**可以点**（点了被吞），"保存昵称"的按钮忙时**灰掉**。`:519` 还专门写了注释解释为什么**不**禁用 —— 但同一屏隔壁面板的同类按钮就是禁用的。用户的模型是"我点了有没有用"，这个问题现在有两个答案。
  `disabled` 一族的 `opacity: var(--ht-state-disabled-opacity)`（0.38，tokens.css:605）配 `cursor: not-allowed`（`reset.css:85`），对比度会跌到 AA 以下（`controls.css:153-155`），所以这一族自己也有 C-1/H-1 之外的对比代价。
- **修法**：二选一并写进门禁。**建议保留 guard**（ADR-0040 §3.7 的理由是实测的：提交后禁用会甩焦点），把 `disabled` 全部换成 `aria-disabled="true"` + 点击时忽略，并把 ADR-0040 §3.7 的这条裁决登记成一条 `check:`，防止第三次分叉。

### H-7 长表单零 autosave —— 刷新即丢，且没有离开确认

- **位置**：`ProfilePanel.tsx:120`（`useState('')`）、`EmailChangePanel.tsx:140`、`PasswordPanel.tsx:249-256`、`AiSettings.tsx:856-863`（`keyDraft`/`draft`）
- **违反规则**：§8 `form-autosave`、`sheet-dismiss-confirm`；§1 `escape-routes`
- **现量**：设置浮层是 `role="dialog"` + `aria-modal="false"`（`App.tsx:3351-3352`），关闭走右上角 `✕`（`sheets.css:458-467`），**没有** scrim 点击关闭、**没有** beforeunload。四个面板的输入草稿全部住在 `useState` 里，`sessionGenerationRef`/`aliveRef` 只防"卸载后 setState"（`ProfilePanel.tsx:136-150`），**不防刷新**。
  最坏落点是 `AiSettings.tsx:1378-1382` 的 **local-api token**：那是一枚从钥匙串复制过来的长串，粘贴后若浏览器刷新（web 无 keychain，`:17` 的自订硬规矩 #4 已承认"关掉页面就没了"），**输入直接蒸发且无任何提示**。
- **修法**：`useEffect` 把 `draft` 落 `sessionStorage`（按 `baseUrl + token 指纹 + panelId` 分键），挂载时回填并显示"已恢复上次未提交的输入"；token 那一格至少加"这格不会自动保存"的行内提示。

### H-8 校验时机：无 `onBlur`，全部"提交时或 onChange 时"

- **位置**：`EmailChangePanel.tsx:302-313`（onChange 清 flag，submit 判空）、`PasswordPanel.tsx:292`/`:332`（仅 submit 时判 `''`）、`ProfilePanel.tsx:469-475`（`tooLong` 由 `codePoints > MAX` 即时算，但输入框带 `maxLength`，**用户永远看不到超长**）
- **违反规则**：§8 `inline-validation`（"Validate on blur, not keystroke"）
- **现量**：三张表的"必填"都只在点击之后报（`:516` 起 `field-required` 那族），没有一处 `onBlur`。`ProfilePanel` 更特殊：输入框 `maxLength={ACCOUNT_DISPLAY_NAME_MAX_CODE_POINTS * 2}`，而校验按码点算 —— 于是超长提示要么永远不出现（打字时截断），要么在英文/emoji 混排时与 `maxLength` 打架。`PasswordPanel` 明确不写 `maxLength`（NIST 禁止静默截断，`:36`），所以**同一页里两个字段对"超长"给了相反的策略**。
- **修法**：给 `EmailChangePanel` 的新地址与 `PasswordPanel` 的两格补 `onBlur` 校验；`ProfilePanel` 删掉 `maxLength`（与 password 同一理由：静默截断）或保留 `maxLength` 但把 `tooLong` 改成实时剩余字数。

### H-9 必填无标记、错误后焦点只覆盖子集、多错无汇总

- **位置**：`PasswordPanel.tsx:586`/`:626`（`localError` 渲染成一句 `<p className="ht-settings__danger">`，**不在 `PasswordField` 里**，所以焦点只回到 `current`/`new`，`localError === 'confirm'` 时焦点不动）、`:290`（missing 焦点）、`ProfilePanel.tsx:414-422`（昵称 `<label>` 无 `*`）、`AiSettings.tsx:1113-1121`
- **违反规则**：§8 `required-indicators`、`focus-management`、`error-summary`
- **现量**：三张密码/邮箱表**没有任何**必填标记，全部靠提交后的报错告知；`confirm` 那一格是本次审计里唯一"校验存在但焦点不落到它"的路径 —— 用户在两个框都填好后漏了确认框，页面报错、光标不动，他必须自己找出是哪个框。
  `AiSettings.tsx:1113-1121` 反而做得**对**：`<ul className="ht-settings__errors">`（`ai-panels.css:591-600` 是唯一真的用 `--ht-color-danger` 的一族）+ `data-testid="rejected-endpoints"` 是错误汇总；但它**没有** `role="alert"` 也没有锚点链接到出错字段，违反 `error-summary` 的后半句。
- **修法**：① 必填加 `aria-required="true"` + 视觉 `*`；② 焦点按视觉顺序落到**第一个**错误框（`firstAuthErrorField` 已有，复用它）；③ `__errors` 那族补 `role="alert"` 与 `<a href="#field">` 锚点。

### H-10 横向滚动的目录没有渐隐/箭头 —— 7 个入口首屏只露出 3 个

- **位置**：`sheets.css:417-434`（`overflow-x: auto` + 负 margin 出血，**无** mask-image / 无箭头 / 无阴影提示）、`App.tsx:380-384`（只有 `scrollIntoView`，且 `block:'nearest'`）
- **违反规则**：§2 `swipe-clarity`、`gesture-alternative`；§9 `overflow-menu`、`nav-hierarchy`
- **现量**：设置目录实量 **7 项**（`settings-group-profile / subscription / data / notifications / appearance / ai / help`，`App.tsx:3468/3511/3528/3561/3596/3720/3769`）。窄屏那一条横向滚动条**没有任何视觉可供线索**：不渐隐、不给箭头、`scrollbar` 未定制，`overflow-x: auto` 在 macOS 上默认完全隐形。用户不知道「关于与帮助」存在 —— 这直接压低发现率，也正是 `overlay-feedback.md`/`ux-principles.md` 里"一行一容器、动作区常驻"要挡的形态。
- **修法**：① `mask-image: linear-gradient(...)` 两端渐隐；② 键盘 `←/→` roving tabindex（现在是 7 个独立 tab 停靠点）；③ 或按 `overflow-menu` 收成一枚「更多」。

### H-11 图标按钮与图标-only 控件的可访问名分叉：`aria-label` 与可见文字不是同一份内容

- **位置**：`AiSettings.tsx:998-1001`（能力复选框 `aria-label={t('…capabilityAria', { capability, name })}`，`capability` 传的是**原始枚举** `long_context`，而可见文案 `:1011` 是 `capabilityLabel[capability]` = "长上下文"）、`:966`（`aria-label` 覆盖外层 `<label>` 的可见文字 `:974-976`）、`:1447-1463`（`aria-label={tool.name}` 传**技术 ID**，可见文案是 `localApiToolLabel`，`aria-description` 里再放人话）
- **违反规则**：§1 `aria-labels`（图标-only 要有名）**已被满足**，但违反 **WCAG 2.5.3 Label in Name** 与 §1 `voiceover-sr`
- **现量**：`aria-label` 一旦存在就**覆盖**可见 label 成为无障碍名。于是屏幕阅读器念"long_context"，而用户看到的字是"长上下文"，同事口头指导"点长上下文"时读屏用户找不到对应控件 —— 这是 Label in Name 的经典失效。
  检索 #2 Result 6（`aria-labels`, High）要求的"图标-only 按钮要有 aria-label"这一条，本仓**整体做对了**：图标-only 按钮全部有名（`AiSettings.tsx:1070`、`:1389-1394`、`:1466` 等，设置目录 `aria-label=` 共 18 处），`aria-hidden="true"` 在设置目录的 **109** 个装饰图标上 **0 漏挂**；开关全部是 `<input type=checkbox role=switch>` + `aria-checked`（`AiSettings.tsx:1605-1611`），不用 div 自拼。
- **修法**：`capabilityAria` 改为 `t('…capabilityAria', { capability: capabilityLabel[capability], name })`；`:1451` 的 `aria-label` 改成人话（或直接删掉 `aria-label`、让 `aria-describedby` 指向 `:1463` 的可见标签）；`aria-description` 兼容性差，改 `aria-describedby`。

### H-12 用 `title` 属性承载"下一步该做什么"，而且挂在一枚 `disabled` 按钮上 —— 违反本仓自己写下的禁令

- **位置**：`apps/web/src/features/settings/AiSettings.tsx:1091`（`title={copy.prerequisite}`，同一元素 `:1089` 是 `disabled={added}`）；`AiSettings.tsx:1396`（一枚有 `aria-label` 的显隐按钮上再叠一份同值 `title`）
- **违反规则**：§1 `alt-text` / `aria-labels` / `voiceover-sr`（检索 #2 Result 3/6，High）、§8 `error-recovery`（"错误消息必须含恢复路径"）、§4 `hover-vs-tap`（"不要只靠 hover"）
- **现量与后果**：`SettingsInfoTip.tsx:16-18` 已把这条纪律写成文档，理由三条：`title` ① 不可键盘聚焦 ② 不可读屏 ③ 触摸设备上永远出不来。而这里同时踩中**第四条、也是最重的一条**：`title` 挂在 `disabled` 的 `<button>` 上时，Chromium/WebKit **默认不显示原生 tooltip**（禁用元素不派发指针事件），于是"要先满足这个前置条件"这句话在**唯一需要它的时刻**（按钮被禁用时）恰好不出现。
  `:1396` 是另一半问题：那枚按钮同时有 `aria-label`（`:1392-1394`，值与 `title` 逐字相同），读屏会拿到 `aria-label`，`title` 只是给鼠标用户的第二份重复文本 —— 同一句话两个载体，二者无同步约束，将来改一处漏一处不会有任何判据报错。
- **修法**：`:1091` 换成 `<SettingsInfoTip label={…} text={copy.prerequisite}>` 挂在这枚按钮旁（内容常驻 DOM、`aria-describedby` 指过去，键盘/读屏/触摸三档都拿得到）；`:1396` 直接删 `title`，保留 `aria-label`。

---

## 3. MEDIUM（19 条）

### M-1 选中态背景色差 1.088:1（暗色 1.253:1），低于 §1 非文本对比 3:1 —— 且唯一补偿是 14px 图标

- **位置**：`sheets.css:722-731`（`.ht-settings__option:has(input:checked) { background: var(--ht-color-primary-subtle) }`）、`ai-panels.css:554-558`（`.ht-chip--on { border-color: var(--ht-color-primary); background: var(--ht-color-primary-subtle) }`）、`ai-panels.css:508-517`（`.ht-chip` 基类 `border: 0`、`background: var(--ht-color-background)`）
- **实测**：`#ffffff` vs `#eff6ff` = **1.088:1**；暗色 `#020617` vs `#17203a` = **1.253:1**。两者都远低于 `color-accessible-pairs` 的 3:1（非文本）。
- **叠加死声明**：`.ht-chip--on` 的 `border-color: var(--ht-color-primary)` 永远不着色 —— 基类 `.ht-chip` 是 `border: 0`，而 `borderless-controls.css:18-26` 还对该族下过 `border-color: transparent !important`。
- **补偿**：`:has(input:checked)` 时 radio 自身的填充（浏览器 UA 样式）+ `.ht-chip--on` 时一枚 `<Check size={ICON_SIZE.xs}>`（**14px**）。`color-not-only` 因此**形式上满足**，但 14px 图标在 11px 文字旁，实际可辨识度很低。
- **修法**：给选中档加 `border-inline-start-width: var(--ht-border-width-thick)` + `--ht-color-primary`（宽度必须先给），或 `box-shadow: inset 0 0 0 var(--ht-border-width-thick)`；`--ht-color-primary-subtle` 提到 `primary-subtle-hover`（`#dbeafe`，对 `#ffffff` = 1.5:1 仍不够，需要专门做一档 `selected` 语义色）。

### M-2 目录选中态同样只有 1.04:1 底色差，补偿是 600 字重 + 主色字

- **位置**：`sheets.css:68-71`（`:hover { background: var(--ht-color-hover) }`）与 `:73-77`（`[aria-current='page'] { background: var(--ht-color-primary-subtle); color: var(--ht-color-primary); font-weight: semibold }`）；目录底色 `:48` = `--ht-color-background`
- **实测**：`#f8fafc` vs `#eff6ff` = **1.04:1**；主色字 `#2563eb` on `#eff6ff` = 4.75:1（**合格**），on `#f8fafc` = 4.94:1（合格）。`nav-state-active` 要求的"必须被指出"由 `aria-current="page"`（`App.tsx:389`）+ 字重 + 前景色三件事达成，**没有违规**；但底色这一通道是无效的。
- **修法**：目录选中项补一条 `border-inline-start-width: var(--ht-border-width-thick)` 的强调条（这是 `nav-state-active` 的标准做法），别只靠底色。

### M-3 四个 tone 修饰类只设 `border-color`、从不设 width —— tone 在图上等于同一件事

- **位置**：`settings-notice.css:8`（基类 `border-inline-start: 0`）与 `:21-24`（`--success/--warning/--danger` 各只写 `border-color`）
- **现量**：`apps/web/src/styles/` 下 `border*(:`/`-width):` 声明共 **342** 条，其中归零的 **114** 条。这是本仓的既定写法（扁平风 + `borderless-controls` 全局清边框），所以**声明合法**；但当同一族又出现 `border-color: <语义色>` 时，那条颜色永远不会落地 —— `--success` 与 `--warning` 与 `--danger` 视觉上零差别（`:37` 的 `Icon` 选择器才是唯一的差道）。这正是 skill "Theme-specific borders disappearing in one mode" 要挡的形态。
- **修法**：tone 类补 `border-inline-start-width: var(--ht-border-width-thick)`；或在 `check:design` 里加一条"设了 `border-*-color` 而未设 width 的规则"的告警。

### M-4 设置层的 CSS 有两个家，且其中一家不在 `app.css` 的级联清单里

- **位置**：`features/settings/*.css`（`ai-settings.css` / `data-settings.css` / `help-settings.css` / `inbound-automation.css` / `privacy-settings.css` / `settings-notice.css`）由 TSX `import` 直接吃进；另一家在 `apps/web/src/styles/app/*.css` 由 `app.css` 聚合（顺序在 `app.css:16-…` 逐条写死，并明令「import 顺序 = 级联顺序，不许重排」）
- **后果**：`.ht-settings__notice` **被两处定义且取值不同**（`ai-panels.css:414-417` 给 `color: foreground-muted / font-size: 2xs`；`settings-notice.css:1-11` 给 `color: foreground / background: surface-raised / padding: space-3`），**同特异性**，谁赢取决于 Vite 的模块注入顺序而不是这条被守卫的级联表 —— 而 `SettingsNotice` 组件（`SettingsNotice.tsx:5`）与 `.ht-settings__danger` 那族（**41** 处）用的正是这两个类名。今天能"跑"是因为两处恰好兼容；一次构建图重排就会静默改色。
- **修法**：把 6 个 co-located 文件并入 `app.css` 的聚合清单（追加在 `settings-account.css` 之后），或删掉 `ai-panels.css:414-417` 的重复声明、只留 `settings-notice.css` 那一份。

### M-5 图标-only 按钮没有 hover/active 差别，只靠 `:focus-visible`

- **位置**：`sessions-logout-all`（`SessionsPanel.tsx:164-181`）、`profile-avatar-*`（`ProfilePanel.tsx:370-395`）、`passkey-name-save/cancel`（`PasskeyPanel.tsx:340-372`）、`password-forgot`（`PasswordPanel.tsx:546-561`）用的是 `ht-btn--danger` / `ht-btn--ghost`
- **实测**：`controls.css:93-135` 给了 `--danger` / `--ghost` 的 `:hover`，`controls.css:173-175` 给了 `:active { transform: scale(var(--ht-motion-press-scale)) }`（0.97）—— **press 反馈是有的**（`scale-feedback` 规则区间 0.95–1.05 命中），所以 `press-feedback` 满足。真正缺的是**图标-only 且无色调档**的那几枚（`AiSettings.tsx:1067-1074` 删除端点用的 `ht-btn--ghost` 在 hover 时才出现 `--ht-color-hover` 底，触摸设备上永远不出现）。
- **修法**：给图标-only 动作加 `ht-btn--secondary` 档（有常驻底），别用 ghost。

### M-6 「退出所有设备」单击即生效，且忙态不禁用

- **位置**：`SessionsPanel.tsx:159-181`
- **现量**：`ht-btn--danger`（色调对了，满足 `destructive-emphasis`），**但没有** `disabled={signingOutAll}`、**没有** `aria-disabled`，`:169-171` 的注释声称"后果写在按钮之前"，但那一句话走的是 tip（`SettingsInfoTip`，需 hover/focus 才展开）—— 触摸设备与纯键盘用户按下去之前**看不到后果**。同一面板的 `sessions-refresh`（`:146`）却 `disabled={state.kind === 'loading' || refreshing}`。
- 按 `confirmation-dialogs`，"把所有设备踢下线"在本仓被判定为可接受的一击动作（文件头 :23-25 逐字论证过：与删通行密钥不同，撤一枚会话的代价可走出去）——**这个论证成立，我不推翻它**。但"后果必须点得到之前可见"这一条不成立。
- **修法**：把后果句从 tip 提为常驻 `__hint`（它是**反馈前提**不是**背景知识**，正是 `SettingsNotice.tsx:25-26` 自己写的 `live`/`danger` 例外）；补 `aria-disabled={signingOutAll}`。

### M-7 `SettingsInfoTip` 把状态变化藏进气泡；`role="status"` 静态复用不当

- **位置**：`SettingsNotice.tsx:46-58`（`detailInTip` 判据）、`:59`；`SessionsPanel.tsx:255-257`（`thisDevice`）、`PasskeyPanel.tsx:320-326`（`neverUsed`/时间戳）、`AiSettings.tsx:980-982`/`:1013`/`:1173-1175`
- **现量**：`detailInTip` 的设计本身有正当理由（`:12-26` 的文件头禁令 + "`live`/`danger` 例外不是偷懒"），且**四个 tone 都有语义图标**（`:37`），所以 `color-not-only` 与 `empty-states` 都满足。问题在两个具体的 `role` 用法：
  1. `SessionsPanel.tsx:255-257` 的「本机」是**静态身份标记**，挂了 `role="status"`（`:256`）—— `status` 是 live region，会被朗读成"状态更新"，静态事实不该占 live 通道；
  2. `PasskeyPanel.tsx:320-326` 的日期是**数据**，同样挂 `role="status"`；
  3. `AiSettings.tsx:1173-1175` 空态 `<span className="ht-settings__hint" role="status">` 的文案（`features.empty`）**没有动作** —— 违反 `empty-states`（"Do: Show helpful message **and action**"）；而 `SessionsPanel.tsx:200-206` 用的共享 `EmptyState` **带动作**。同页两种空态纪律。
- **修法**：静态信息删 `role="status"`；`AiSettings` 空态文案补一个「去添加端点」的动作（用现成的 `SettingsAccountGate` 那套 `openAiSettings` 锚点）。

### M-8 图标尺寸混档 + `sm` 同时用于装饰图与控件本体

- **位置**：`ICON_SIZE.xs`（14px）= **151 处**，`sm`（16px）= **81 处**，`md`（20px）= **20 处**，`lg`（24px，token 表自称「基准档」）= **6 处**（复量见 §0b）
- **现量**：`sm` 既用在纯装饰 glyph（`ArrowLeft`、`Lock`），也用在**控件本体**（`.ht-settings__tip-trigger` 的 `CircleHelp`，`SettingsInfoTip.tsx:80`）。更值得注意的是**档位与自称的基准脱节**：token 表把 `icon-lg: 1.5rem` 注释为「基准」（tokens.css:371），实际用量却是 `xs` 151 / `sm` 81 / `md` 20 / **`lg` 6** —— 所谓基准档几乎无人消费，真正的事实源是那两个小档。同一视觉层里混 14 与 16 两档 232 次，`icon-style-consistent`（「一个视觉层一种尺寸」）不成立。
  一致性做对的部分：`strokeWidth` 全仓 **0 处覆写**（lucide 统一默认），filled vs outline **0 处混用**，`no-emoji-icons` 在 TSX 里 **0 命中**。
- **修法**：定一条纪律 —— 与文字并排的装饰 glyph 用 `xs`；独立可聚焦的控件本体用 `md`/`lg`，并把 `tip-trigger` 提到 `md`（20px）以匹配它 44px 的命中区。

### M-9 暗色 surface 阶梯实测 1.06–1.18:1；`--ht-shadow-md` 在暗底上不可见

- **位置**：`tokens.css:698-702`（`--ht-color-surface: #0d1526`、`surface-subtle: #101a2e`、`surface-raised: #131e33`、`surface-sunken: #080e1a`）、`:713-715`（`--ht-color-border: #1e2b45`）、`:785`（`--ht-shadow-md: 0 2px 8px rgb(0 0 0 / 0.5)`）、`sheets.css:103`（卡片用 `shadow-md` 表层次）
- **实测**（对比度计算，非目测）：
  | 配对 | 亮色 | 暗色 |
  |---|---|---|
  | surface vs background | **1.088** | **1.111** |
  | border vs surface（卡片描边） | **1.018** | **1.292** |
  | sunken vs surface（次要按钮底） | **1.088** | **1.056** |
  | hover vs surface | **1.080** | **1.178** |
  | 卡片阴影 | rgba(15,23,42,0.08) 可见 | rgba(0,0,0,0.5) 压在近黑上 ≈ **不可见** |
  `color-dark-mode` 要求的"暗色不是反相、重新解一遍"**做到了**（`:686-799` 整块独立解）；前景对背景全部达标：`foreground` 16.63 / `muted` 12.27 / `subtle` 7.11 / `primary` 7.17 / `danger` 6.59 / `success` 9.48 / `warning` 10.92 / `info` 8.51（**均 ≥4.5**）。失败的是**层级**通道：暗色下卡片靠 1.018:1 的描边 + 看不见的阴影，两样都不承重。
  **`on-danger` 是教科书级的正例**：`:732-739` 把暗色档换成 `slate-950`（7.29:1）而不是沿用白字（2.77:1），并在注释里写明这是"暗色不是亮色反相"在前景 token 上的实例。
  `:111-119` 记录了一次**已回退的实验**：压页面底色一档会让 `foreground-subtle` 掉到 4.34:1 而四端 AA 用例同红 —— 这条被写进 token 注释，所以今天不动它是对的。
- **修法**：暗色给 surface 拉开到 ≥1.3:1（例如 `surface` 提到 `#111c30`），或给暗色的卡片描边单独一档 `--ht-color-border-card`（≥1.5:1）；阴影在暗色改用描边表层次（`design-system.md` 本来就是这么说的：「扁平风格优先用边框表达层次，阴影只用于浮层」—— 暗色却仍在用阴影，`:785`）。

### M-10 触控目标：横向 44px 下限有、纵向没有；gap 8px 达下限

- **位置**：`ai-panels.css:496-500`（`.ht-chip--action` 与 `.ht-ai-settings__icon-button`：`min-inline-size: var(--ht-touch-target-min)` 但**无** `min-block-size`）、`controls.css:185`（`.ht-settings__nav-link { padding: var(--ht-space-1) var(--ht-space-2) }`）
- **实测**：`--ht-touch-target-min: 2.75rem /* 44px */`（tokens.css:375）注释明写「44px 是可访问性硬下限，不许调小」，且 `.ht-btn` 有 `min-block-size` 双轴（`controls.css:26`），`:active` scale 0.97 有 —— **主要控件全部达标**（含 `.ht-settings__row-label` `min-block-size: 44px`、`tip-trigger` 双轴 44、`icon-button` 双轴 44）。
  漏的是上面两处（只钉一个轴）+ 目录项（靠 padding 撑到约 28px 高）。gap 族实测（设置层 CSS 合计）：`--ht-space-2` **95** / `space-3` **63** / `space-1` **60** / `space-4` **48**。60 处 `space-1`（4px）经查**全部是控件内部的图标↔文字间距**（`__cap`、`__item-main`、`__tip`、`__status-icon`），控件与控件之间一律 `space-2`（8px）或更深 —— 所以 `touch-spacing` 的 8px 下限**判定通过**，这一条不是违规。
- **修法**：两处补 `min-block-size`；目录项 `padding-block` 提到 `space-2` 或直接给 `min-block-size: var(--ht-touch-target-min)`。

### M-11 `touch-friendly-input` 与 iOS 16px：设置页在 Web 壳上 1px = 16px 的换算依赖宿主字号

- **位置**：`controls.css:340-349`（`.ht-input { min-block-size: var(--ht-touch-target-min); font-size: var(--ht-font-size-sm) }` = 14px）
- **现量**：输入框前景/placeholder 用 `sm`（14px），低于 `readable-font-size` 的 16px 正文基准。这是 **Web 桌面壳**（非移动 Web），不触发 iOS 自动缩放，故不构成移动端缺陷；但同页 `ProfilePanel` 的昵称、`EmailChangePanel` 的新地址、`PasswordPanel` 的三格**全是 14px 输入** —— 与 H-1 的回执 11px 合起来，设置页的文字阶梯整体偏小一档。
- **修法**：输入框字号提到 `base`（16px），回执/说明档按 H-1 提。

### M-12 tip 气泡无指针（caret）；`role="tooltip"` 与 `aria-describedby` 双写；不跟随语言方向翻转

- **位置**：`sheets.css:366-414`（`.ht-settings__tip-bubble`：`inset-block-start: calc(100% + var(--ht-space-1))`、`inset-inline-start: 0`、`background: var(--ht-color-surface-raised)` + `shadow-md` + 12px 文字）
- **实测**：`modal-motion`/`scrim` 的实质要求**满足** —— tip 不是浮层（`SettingsInfoTip.tsx:27-29` 逐字说明了为什么 `overlay-feedback.md` 的关闭策略表不覆盖 tooltip，这个判断正确），`z-index: var(--ht-z-popover)`（500，tokens.css:351）压得住 modal(400) 之上的正确层级，且 `tokens.css:352-359` 专门为"popover 竟然在 modal 之上"这个缺陷立了 `--ht-z-modal-commitment: 550`，`overlay: rgb(15 23 42 / 0.5)` = 50% 黑，落在 `scrim` 要求的 40–60% 区间内。
  缺的三条都是打磨：无 caret（读者要靠位置猜这句话说的是哪个词）、`inset-inline-start: 0` 在 RTL 下会贴错边（本仓 i18n 只有 zh/en，RTL 未支持，**登记为边界而不是缺陷**）、气泡出现**无过渡**（`instant` 状态变化，违反 `state-transition`，但因 `duration-fast` 被 reduced-motion 压到 1ms，加过渡没有成本）。
- **修法**：补 6px caret（`::after` 旋转方块，同色 `surface-raised`）+ `opacity/transform` 走 `--ht-duration-fast`。

### M-13 三套 sheet：`aria-modal` / 动画 / 层级 / 退出通道四件事互相不一致

| | `.ht-sheet`（设置，`App.tsx:3349-3352`） | `.ht-search-overlay`（`:3385`） | `.ht-sheet__reconfirm`（`:3403`） |
|---|---|---|---|
| `aria-modal` | **`false`** | — | — |
| 动画 | `ht-sheet-in` 淡入+`translateY(space-2)`，`duration-normal`(200ms) | `ht-material-in`（弹簧推导） | 无入场 |
| `z-index` | `--ht-z-modal`(400) | `--ht-z-overlay`(300) | `--ht-z-modal`(400) |
| `background` | `--ht-color-background`（实底，`:19`） | `--ht-material-scrim`（半透） | `--ht-color-overlay`（50% 黑） |
| 关闭 | 常驻 sticky `✕`（`sheets.css:458-467`）+ Esc（`App.tsx:985`） | — | — |
| 焦点归位 | `App.tsx:958-970` 有完整实现 | — | — |

- **现量**：`aria-modal="false"` 是**正确**的 —— 设置浮层不锁下层（`:967` 的归位逻辑正依赖"下层仍在 DOM 且可交互"，文件注释也明说「下层继续保留在 DOM 里」）。但一个非 modal 的 `role="dialog"` 里放着**注销账号**与**改密码**这两条真实写路径，键盘用户 Tab 会走出对话框进入下层任务列表而没有任何提示。
  `motion-consistency` 的失败点：同一个 `.ht-sheet-in` 关键帧（`sheets.css:479-488`）被三处 `duration` 不同地使用 —— `:20` 用 `duration-normal`(200ms)、`:534` 用 `duration-fast`(150ms)、`:560` 用 `calc(var(--ht-motion-spring-response-sheet) * 1s)`(300ms)。同一族动画三个速度。
  方向上 `translateY(space-2)`（8px 自下而上）满足 `hierarchy-motion`（"deeper 从下方进"）与 `navigation-direction`；`easing` 用 `--ht-ease-enter`（ease-out 进入）符合 `easing`；`prefers-reduced-motion` 在 `:490-494` 有显式 `animation: none`，且 `tokens.css:818-837` 全局压时长到 1ms（**不是删 transition**，理由写在 :820-823：删掉会让依赖 `transitionend` 的逻辑永不触发 —— 这个实现比多数仓库认真）。
- **修法**：给设置 sheet 加 `aria-describedby` 指向"下面还能走，用 ✕ 或 Esc 退出"；三处 sheet 的 duration 统一到 `--ht-duration-normal`。

### M-14 订阅卡把「当前档位」同时写成 `aria-label` 与可见文字

- **位置**：`App.tsx:3466-3469`（`aria-label={t('mobile.settings.section.subscription')}` + `<SubscriptionSummaryCard currentSku={…}>`），`SubscriptionSummaryCard.tsx:83-85`（`__badge` 渲染**同一枚** `managed.sku.<sku>`）
- **现量**：`:3462-3465` 的注释明写这条纪律 —— 「内容面**不再**重复一个近义大标题：`ManagedSkuLabel` 已经是一块 `aria-label` 的语义分组，屏幕上再写一行「订阅」就是同一份信息画两次」。**判断是对的**，但 `__badge` 那枚当前档位胶囊把同一份文案（同一个 i18n key）第二次画进这块卡片。读屏用户先听到 section 名，再在卡头听到同一句。
  `heading-hierarchy` 在**整站层面通过**：`grep -c '<h1' App.tsx` = 2（`:2682` 视图标题 + `:3382` 次级浮层标题，两个分支互斥，**不存在双 h1**）；`h1 → fieldset/legend → label` 在 `SubscriptionSummaryCard.tsx:149-153` 用原生 `<fieldset>/<legend>` 分组，符合 `field-grouping`；`AiSettings.tsx:1436`/`PasskeyPanel.tsx:304`/`SessionsPanel.tsx:228` 用 `<section>`/`<fieldset>` 而非 `<div>` 汤。
  唯一的层级倒挂：`CloseAccountPanel.tsx:121` 的 `__title` 用 `<h2>` 而 `:162` 的次级标题用 `<h3>` —— 与其它面板（`PasskeyPanel.tsx:181`、`SessionsPanel.tsx:125`、`PasswordPanel.tsx:373` 都用 `__h2`）一致，所以**这条不算违规**；但 `__danger-card` 把 h2 与 h3 都包在同一层，层级完全靠字号，`aria-labelledby` 只挂在最外层 `<section>`（`:119`），中间的 `<h3>` 没有成为任何 region 的名字 —— `screen-reader-summary` 的缺口。
- **修法**：`__badge` 换成"状态"语义（`当前：年档`）而不是重复 section 名；`__danger-card` 内的 `<h3>` 补 `id` 并让所在容器 `aria-labelledby` 指过去。

### M-15 目录与内容之间没有滚动位置/状态的保留承诺

- **位置**：`App.tsx:951-956`（`settingsReturnSurface`/`setSettingsAnchor`）、`sheets.css:217`（`scroll-margin-block-start`）
- **现量**：`state-preservation` 要求"返回时恢复滚动位置与输入"。`App.tsx:958-970` 实现的是**焦点**归位（`previousActiveElement`），**不是**滚动位置；sheet 的 `overflow-y: auto`（`sheets.css:17`）在关闭后不记忆 scrollY。切 tab（`:3437` `onSelect`）时内容整块换掉，`.ht-settings__group` 的 `hidden`（`:79`）会让滚动复位到顶 —— 用户在「数据与同步」看到第 5 张卡、切到「提醒与通知」再切回来，回不到原处。
  同时：tab 状态**不进 URL**（`settingsAnchor` 是 `useState`，`App.tsx:668`）。`deep-linking` 要求"关键屏幕可通过 URL 达到" —— 设置本身有 `?view=settings` 一类的路由吗？`App.tsx:3338` 的注释写着「设置是浮层，不是一路由」，这是**已登记的有意决策**，我不推翻；但"从通知跳到设置里某一节"因此无法被分享/收藏/浏览器后退撤销，`back-behavior` 在窄屏（底栏模式）尤其成问题。
- **修法**：至少在 `onSelect` 时把 `settingsAnchor` 写进 `location.hash`（`#settings-group-data`），这样浏览器后退能收回上一次 tab、刷新能回来；滚动位置按 `sectionId` 存进 `sessionStorage`。

### M-16 设置层 TSX 里有 1 处内联 `style`，它抄漏了 `.ht-settings__field` 的第四条声明

- **位置**：`apps/web/src/features/settings/AiSettings.tsx:753`（`<fieldset className="ht-settings__options" data-testid="ai-supply-mode" style={{ border: 0, padding: 0, margin: 0 }}>`）
- **实测**：设置目录 TSX 的 `style={{` 用量 = **1**（`grep -rn 'style={{' apps/web/src/features/settings/*.tsx | wc -l`），就是这一处。它**不写 hex**，所以 `color-semantic`「组件里不许裸 hex」整体仍达标（Primitive 层被组件直接引用 **0** 次）。
- **真正的问题有两层**：
  1. **重复实现一份已有 CSS**：`sheets.css:340-349` 的 `.ht-settings__field` 正是为「浏览器给 `fieldset` 默认 `2px groove` 黑框 + 内边距」这件事立的（`:330-339` 逐字记录了那次实拍："为什么这个是黑色的框？"）。`AiSettings.tsx:753` 不走那个类，而是在 JSX 里重写三条同值声明 —— 于是这件事有**两份答案**，与 `check:control-semantics` 反对的"两处各答一遍"同形。
  2. **抄漏了第四条**：`sheets.css:338` 除了 border/padding/margin 还放开 `min-inline-size: 0`，而它的注释逐字解释了为什么这条**不可省**："`min-inline-size` 一并放开 —— 它默认按内容撑宽，**窄容器里会把卡片顶出可视区**"。内联那一处只给了三条 ⇒ 供给模式那个 `<fieldset>` 在窄容器里仍可能顶出卡片。这是"抄一份而不是复用类"的典型代价：漏的那一条恰好是注释里标了 🔴 的那一条。
- **违反规则**：§4 `consistency`；skill「Stable assets / 语义 token 一致」；`docs/agents/design-system.md`「组件禁止裸值，一律 `var(--ht-*)`」的延伸（内联样式让 `check:design` 扫不到）；AGENTS §3.5「两处各写一遍就是从两个地方各判一遍」
- **修法**：删掉内联 `style`，改 `className="ht-settings__options ht-settings__field"`（复用既有那条已含四步归零的类）；并给 `check:design` 或 `check:l4` 加一条「TSX 里 `style={{` 只减不增，基线 = 现量 1」。

### M-17 设置族的类名契约已部分腐坏：3 个死选择器 + 14 个 camelCase 破名 + 1 处失效豁免

- **位置**：`ai-panels.css:371`（`.ht-settings__cardText`）、`:377`（`.ht-settings__cardTitle`）、`:384`（`.ht-settings__cardNote`）、`borderless-controls.css:117`（`.ht-settings__scope-badge`）
- **实测**（本轮现量，命令随附）：

  | 类名 | CSS 定义 | TSX 用量 | 判定 |
  |---|---|---|---|
  | `ht-settings__cardText` | ✅ `ai-panels.css:371` | **0** | 死选择器 |
  | `ht-settings__cardTitle` | ✅ `ai-panels.css:377` | **0** | 死选择器 |
  | `ht-settings__cardNote` | ✅ `ai-panels.css:384` | 1，且消费者在设置之外（`features/shell/FeatureModulesPanel.tsx:70`） | 挂在设置族、别处在用 |
  | `ht-settings__scope-badge` | ✅ `borderless-controls.css:117`（在**全局清边框的豁免名单**里） | **0**（`grep -rn 'scope-badge' apps/web/src` 只命中 `ht-ai-settings__scope-badge`） | 豁免管着一个不存在的类 |
  | `ht-ai-settings__scope-badge` | ✅ `ai-settings.css:10` | 1（`AiSettings.tsx:1316`） | 真实类名**不在**豁免名单里 |

  命名档位实测：`ht-settings__*` 共 **159** 个 kebab-case 类名 + **14** 个 camelCase 类名（`grep -rhoE '\.ht-settings__[a-z0-9-]+[A-Z][A-Za-z]*' apps/web/src/styles/ | sort -u | wc -l`）—— camelCase 一族集中在 `ai-panels.css:371-390` 与 `admin.css:70/78/158/170/188/192/205`（`-statValue`、`-staticRow`、`-rowMain`）。
- **违反规则**：§4 `consistency`；skill「组件不得发明第二套命名」；`check:row-single-source` 的「顶层 `ht-*` 前缀族只减不增」（基线 28，见 `controls.css:12-15` 逐字解释）
- **后果**：
  1. `ai-panels.css` 里 `.ht-settings__*` 有 **14 个 camelCase**，而全仓其余 159 个一律 kebab-case（`card-title` vs `__row-label`）。这不是洁癖：`check:row-single-source`、`check:control-semantics`、`check:design` 都是**按前缀族字符串**做棘轮的（`controls.css:195-199` 逐字解释过"新落点挂既有族而不是再开一族"为什么是判据）—— camelCase 分支正好落在族匹配的边缘。
  2. `borderless-controls.css:106-121` 的豁免名单是一份**手写类名清单**，而 `:86` 自己写着"哪些层要加进来由**浏览器几何扫描**判，不由人记"。今天它里面躺着一条已改名的类（`:90-99` 记录的正是同一事故形状："名字不像，所以上一次登记漏了它"）。
- **修法**：删 2 个死选择器、`cardNote` 随消费者迁出设置族；14 个 camelCase 统一改 kebab；豁免名单改成**按结构匹配**（`:has()`，`controls.css:505` 已有先例）而不是逐个登记类名，从根上免除"改名即失效"。

### M-18 本机 API 工具名被硬截断，且没有全文回落通道

- **位置**：`features/settings/ai-settings.css:186-191`（`.ht-ai-settings__tool-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap }`）、消费者 `AiSettings.tsx:1463`
- **违反规则**：§6 `truncation-strategy`（"Prefer wrapping over truncation; when truncating use ellipsis **and provide full text via tooltip/expand**"）、§5 `line-length-control`
- **现量**：`white-space: nowrap` 使工具名**绝不换行**，超出即省略号；`:178-184` 的 `<label>` 是 `min-inline-size: 0` 的 flex 项，`:122-126` 的容器是 `repeat(2, minmax(0,1fr))` 两列网格 —— 48rem 以下塌成单列（`:208-210`），但**桌面两列时每列宽度由视口决定，长工具名照样截**。
  缓解：同一行右侧的 `<details aria-label="查看技术名称：…">`（`AiSettings.tsx:1465-1466`）给的是**技术 ID**（`:197-200` 的 `code`，11px），不是那句人话标签的全文 —— 所以被截掉的恰好是用户该读的那一句，能展开看到的反而是该被省略的那一句。
  这枚标签上**没有** `title`、没有 `SettingsInfoTip`、没有 `aria-describedby` ⇒ 截断是**信息不可恢复**。而本仓已经明令禁止用 `title` 承载信息（`SettingsInfoTip.tsx:16-18`：「`title` 不可键盘聚焦、不可读屏、触摸设备上永远出不来 —— 用它当"说明"等于那说明只对鼠标用户存在」），所以正确载体是 `SettingsInfoTip`（见 H-12）。
- **修法**：`white-space: normal` + `overflow-wrap: anywhere`（允许换行；行容器 `:169` 已有 `min-block-size: 44px` 撑得住），或把 `SettingsInfoTip` 挂在这枚标签上、正文为完整工具名。**不要**用 `title`。

---

### M-19 断点：同一档位两种单位 + 同一 1024 档两种写法 + 两处注释指向不存在的档

- **位置**：`tokens.css:450`（`--ht-layout-two-column-min: 768px`，被 `QuadrantBoard.tsx:243`、`CountdownView.tsx:270` 用 `getPropertyValue` 读走）对照 `sheets.css:316`/`:436` 等 **23 处** `max-width: 48rem`；`sheets.css:416`/`:751`（`64rem`）对照 `assistant-layout.css:29`/`narrow.css:442`（`63.9375rem`）；过期注释 `sheets.css:244`（「< 40rem」）与 `admin.css:489`（「与 `controls.css` 同一档 40rem」，而 `controls.css` 实际是 `48rem`）
- **违反规则**：§5 `breakpoint-consistency`（"Use systematic breakpoints"）、`container-width`；skill「Token-driven theming」；`design-system.md` 响应式断点节
- **后果**：① 宿主字号 ≠ 16px 时，px 档与 rem 档**分叉**（详见根因 F）；② 设备宽度恰好 1024px 时，`64rem` 命中而 `63.9375rem` 不命中 —— 设置目录与助手栏在这一个宽度上给出**不同板式**；③ `40rem` 这个档**在 CSS 里已经不存在**，却被两处注释当作对齐依据引用，下一个照注释办事的人会主动去"对齐一个不存在的档"。
- **修法**：`--ht-layout-two-column-min` 改 `48rem`；`63.9375rem` 与 `64rem` 统一成一种；把 `sheets.css:244`、`admin.css:489` 的 `40rem` 改成 `48rem`。

---

## 4. LOW（7 条）

### L-1 头像缺尺寸声明 —— 但已有 `aspect-ratio: 1/1` 兜住 CLS
`ProfilePanel.tsx:340-354`：`<img>` 有 `alt=""`（装饰性，首字母回落 `:338` 已给出同名文本，`alt-text` **满足**）、`data-loaded`/`data-has-initial`，但无 `width`/`height` 属性。`sheets.css` 的 `.ht-settings__avatar` 有 `aspect-ratio: 1 / 1`，`image-dimension` 的**目的**（防布局跳）达到，`lazy-loading`/`image-optimization` 不适用（单张 512KB 上限、base64 data URI）。登记为形式缺口。

### L-2 头像读取失败不进 `aria-live`
`ProfilePanel.tsx:404-408`：`avatarReadMessage` 常驻渲染、有 `role="status"`，但没有包在 live 容器里。首次加载时的这句"这台设备现在取不到头像"不会被朗读。与 C-4 同族，影响小得多。

### L-3 `reduced-motion` / `reduced-transparency` 全局达标，`dynamic-type` 在 Web 壳不适用
`tokens.css:818-837` 把**全部** `--ht-duration-*` 压到 1ms（含 `--ht-duration-press`，理由在 :824-826：删掉会让依赖 `transitionend` 的逻辑永不触发 —— **这个实现比多数仓库认真**），`:850-861` 另立 `prefers-reduced-transparency: reduce` 块压 tint/blur（且 :846-849 记录了"必须放文件末尾否则被暗色块盖掉"的踩坑）。唯一瑕疵：`prefers-reduced-motion` 在**组件级**被重复实现三次（`controls.css:169-171`、`sheets.css:491`、`:573`）—— 全局块已经覆盖，重复不致错但违反 DRY。
`--ht-motion-*` 弹簧档（`:626-645`：damping 1.0 默认 / 0.8 仅用于动量手势、Apple 的 damping+response 双参数模型、rubber-band 0.55）设计得很扎实，但**Web 设置页一处都没用到** —— 即 `spring-physics` 在 Web 壳是空档。
`dynamic-type`：Web 全站字号走 `rem`（tokens.css:242-259），随宿主字号缩放，符合 `truncation-strategy` 的"允许文本放大"。

### L-4 打开设置浮层后没有把焦点送进对话框
`App.tsx` 的 `openSettings()` 只 `setView('settings')` + 设锚点，**没有** `sheetRef.current?.focus()`。而关闭时的焦点**归位**实现得很细（含"焦点还留在已被卸载的节点上就按祖先链找第一个还在的落点"）。`focus-management` 只做了回程、没做去程 —— 键盘用户打开设置后第一次 Tab 会落到下层任务列表（见 M-13）。

### L-5 动效档位碎片化：全部 `duration` 走 token，但同族三个速度
`tokens.css:313-338` 有 `instant(80) / fast(150) / normal(200) / slow(300) / exit(140) / press(100)` + 4 档 splash。全部落在 §7 的 150–300ms 区间（`press` 100ms 是 Apple "按下即回应"的有意例外，`:319-321` 逐字引了《Designing Fluid Interfaces》；`exit 140 < enter 200` = 70%，正中 `exit-faster-than-enter` 的 60–70% 区间）。
`transform-performance` 实测：`transition` 声明里出现 `width`/`height`/`top`/`left`/`margin` 的次数 = **0** —— **全部只动 transform/opacity/颜色**。这是本仓做得最好的一个域，`layout-shift-avoid` 满足。
问题只有两处：与设置页无关的 4 档 splash 混在同一组里，以及 M-13 记录的"同一个 `ht-sheet-in` 关键帧被三处不同 `duration` 使用"。

### L-6 空状态、撤销、错误恢复：三处"没有下一步"
`empty-states` 整体做得好（共享 `EmptyState` 强制 `title` + `description` **或** `action` 至少一个，`SessionsPanel.tsx:203-206` 与 `HeytaUiProvider` 的用法正确）。缺的是：
- `undo-support`：**0 处**（无 Undo/Redo、无"撤销删除"toast）。删通行密钥、撤销会话、保存昵称都是不可回头的一击。文件里对此有论证（`SessionsPanel.tsx:23-26`），接受；但 `ProfilePanel` 的昵称覆盖写**没有任何**"撤销"或"原值是 X"的回显。
- `error-recovery`：`failureKey`（`EmailChangePanel.tsx:56-71`）五句里只有 `invalidLink` 给了动作（"请重新发起"），其余四句只说结果不说下一步；`network` 那句的补偿动作埋在 tip 里（见 H-12 的 `title`/tip 讨论）。
- `timeout-feedback`：各 store 无 `setTimeout`/AbortController 超时。慢请求永久转圈，没有"超时了，重试？"这一档。

### L-7 键盘快捷键与焦点陷阱：`keyboard-shortcuts` 部分满足
`App.tsx` 的 `keydown`：`isComposing || keyCode === 229`（IME 保护，做得对）、Esc 关最上层浮层（**先关 `overlayStack` 栈顶而不是直接关设置** —— 这个栈式裁决是正确的，满足 `modal-escape`）。
`focus-management` 有回程（L-4）但**无焦点陷阱**（设置是非 modal 的，见 M-13）。`sheet-dismiss-confirm`：0 处实现。`inline-validation` 的 `onBlur`：0 处（见 H-8）。

---

## 5. 汇总表

| ID | 严重度 | 违反规则 | 位置 | 一句话 |
|---|---|---|---|---|
| C-1 | CRITICAL | §8 `contrast-feedback` / §4 `state-clarity` | `ai-panels.css:406-417` | `.ht-settings__danger` 用正文字色，错误/成功/中性三档坍塌（41 处受影响） |
| C-2 | CRITICAL | §4 `state-clarity` / §8 `destructive-emphasis` | `CloseAccountPanel.tsx:174` | `ht-btn--outline` 全仓零定义，注销入口读起来像说明文字 |
| C-3 | CRITICAL | §1 `form-labels` / §8 `input-labels` | `PasskeyPanel.tsx:329-339` | 改名输入框只有 placeholder，无可见 label |
| C-4 | CRITICAL | §1 `aria-live-errors` | `CloseAccountPanel.tsx:199-208` | `aria-live` 挂在条件渲染的元素自己身上，注销结局读屏拿不到 |
| H-1 | HIGH | §6 `font-scale` / §5 `readable-font-size` | `ai-panels.css:416` 等 9 处 | 回执 11px、说明 12px，低于自订「12px 辅助下限」 |
| H-2 | HIGH | §5 `visual-hierarchy` / §9 `nav-state-active` | `SessionsPanel.tsx:235-241` | 「本机」与设备名同档同色，无视觉差别 |
| H-3 | HIGH | §6 `number-tabular` / §10 `number-formatting` | `PasskeyPanel.tsx:130`、`SessionsPanel.tsx:60`、`privacy-consent.ts:165` | 日期三套口径 + `year:'numeric'` 出 4 位年 + 无 tabular-nums + 一处 UTC 当本地 |
| H-4 | HIGH | §1 `focus-states` | `borderless-controls.css:18-28` vs `:73` | 焦点环被禁、改由 background/box-shadow 表达，与 `check:focus-single-source` 打架 |
| H-5 | HIGH | §8 `toast-dismiss` / `success-feedback` | `ProfilePanel.tsx:508-525` | 成功回执不自动消失、无 `role`，busy 态返回 null |
| H-6 | HIGH | §2 `loading-buttons` / §4 `consistency` | `EmailChangePanel.tsx:311`/`PasswordPanel.tsx:519` vs 其余 15 处 | 同页两套忙态纪律（guard vs `disabled`） |
| H-7 | HIGH | §8 `form-autosave` / `sheet-dismiss-confirm` | `ProfilePanel.tsx:120`、`AiSettings.tsx:1378` | 长表单零暂存，刷新即丢（尤其 local-api token） |
| H-8 | HIGH | §8 `inline-validation` | `EmailChangePanel.tsx:302`、`PasswordPanel.tsx:292` | 无 `onBlur`；`maxLength` 与码点校验自相矛盾 |
| H-9 | HIGH | §8 `required-indicators` / `focus-management` / `error-summary` | `PasswordPanel.tsx:586/626`、`AiSettings.tsx:1113` | 必填无标记；confirm 焦点不落地；错误汇总无 `role`/锚点 |
| H-10 | HIGH | §2 `swipe-clarity` / §9 `overflow-menu` | `sheets.css:417-434` | 横向目录无渐隐/箭头，7 个入口首屏只见 3 个 |
| H-11 | HIGH | §1 `aria-labels`（Label in Name） | `AiSettings.tsx:998/966/1451` | `aria-label` 传原始枚举/技术 ID，覆盖可见文案 |
| H-12 | HIGH | §1 `voiceover-sr` / §4 `hover-vs-tap` | `AiSettings.tsx:1091`、`:1396` | 前置条件写进 `title`，还挂在 `disabled` 按钮上 ⇒ 需要它时它不出现 |
| M-1 | MEDIUM | §1 `color-accessible-pairs` | `sheets.css:728`、`ai-panels.css:554` | 选中态底色差 1.088:1（暗色 1.253:1），补偿只有 14px 图标 |
| M-2 | MEDIUM | §9 `nav-state-active` | `sheets.css:73-77` | 目录选中底色差 1.04:1，靠字重+主色撑 |
| M-3 | MEDIUM | §4 `elevation-consistent` | `settings-notice.css:8` vs `:21-24` | 四个 tone 只设 color 不设 width，图上等于同一件事 |
| M-4 | MEDIUM | §4 `consistency` | `ai-panels.css:414` vs `settings-notice.css:1` | 设置层 CSS 有两个家，一家不在受守卫的级联清单里 |
| M-5 | MEDIUM | §2 `press-feedback` | `controls.css:173` | 图标-only 且无色调档的按钮，触摸设备上无 hover 反馈 |
| M-6 | MEDIUM | §8 `error-clarity` | `SessionsPanel.tsx:159-181` | 「退出所有设备」的后果藏在 tip 里，且不禁用 |
| M-7 | MEDIUM | §1 `color-not-only` / §8 `empty-states` | `SettingsNotice.tsx:46`、`SessionsPanel.tsx:256` | 状态变化藏进气泡；静态信息误占 live region；一处空态无动作 |
| M-8 | MEDIUM | §4 `icon-style-consistent` | `ICON_SIZE.xs` 124 / `sm` 111 | `sm` 同时用于装饰 glyph 与控件本体 |
| M-9 | MEDIUM | §6 `color-dark-mode` | `tokens.css:698-715`、`:785` | 暗色 surface 阶梯 1.06–1.18:1；`shadow-md` 在近黑底上不可见 |
| M-10 | MEDIUM | §2 `touch-target-size` | `ai-panels.css:496-500` | 44px 下限只管一个轴；目录项约 28px 高 |
| M-11 | MEDIUM | §5 `readable-font-size` | `controls.css:340-349` | 输入框 14px（Web 桌面壳不构成 iOS 自动缩放问题） |
| M-12 | MEDIUM | §7 `state-transition` | `sheets.css:391-414` | tip 无 caret、无过渡、不随 RTL 翻边 |
| M-13 | MEDIUM | §9 `back-behavior` / §7 `motion-consistency` | `App.tsx:3351`、`sheets.css:20/534/560` | 三套 sheet 的 `aria-modal`/层级/时长互不一致 |
| M-14 | MEDIUM | §1 `heading-hierarchy` / §4 `primary-action` | `App.tsx:3468`、`SubscriptionSummaryCard.tsx:84` | 同一 i18n key 同时是 `aria-label` 与可见文字；一屏多枚 `--primary` |
| M-15 | MEDIUM | §9 `state-preservation` / `deep-linking` | `App.tsx:951`、`:668` | tab/滚动状态不进 URL，切回来不复位 |
| M-16 | MEDIUM | §4 `consistency` | `AiSettings.tsx:753` | 内联 `style` 重抄 `.ht-settings__field` 且漏掉 `min-inline-size: 0` 那条被标 🔴 的声明 |
| M-17 | MEDIUM | §4 `consistency` | `ai-panels.css:371/377/384`、`borderless-controls.css:117` | 2 个死选择器 + 14 个 camelCase 破名 + 豁免名单指向已改名的类 |
| M-18 | MEDIUM | §6 `truncation-strategy` | `ai-settings.css:186-191`、`AiSettings.tsx:1463` | 工具名硬截断，可展开的反而不是全文 |
| M-19 | MEDIUM | §5 `breakpoint-consistency` | `tokens.css:450` vs `sheets.css:316`；`sheets.css:244`、`admin.css:489` | 同档两单位 + 1024 两种写法 + 两处注释指向已不存在的 40rem |
| L-1 | LOW | §3 `image-dimension` | `ProfilePanel.tsx:351` | `<img>` 无 `width/height`（有 `aspect-ratio: 1/1` 兜住） |
| L-2 | LOW | §8 `aria-live-errors` | `ProfilePanel.tsx:413` | 头像读取失败不进 live 区 |
| L-3 | LOW | §7 `motion-consistency` | `tokens.css:818-837` | `reduced-motion` 组件级重复实现 3 次；Web 设置页未用弹簧档 |
| L-4 | LOW | §1 `keyboard-nav` | `App.tsx:973-982` | 去程无焦点送入对话框（回程做了） |
| L-5 | LOW | §7 `duration-timing` | `tokens.css:313-338` | 9 个 duration 档（其中 4 档与设置页无关） |
| L-6 | LOW | §8 `undo-support` / `timeout-feedback` | 全仓 0 处 | 无撤销、无超时反馈 |
| L-7 | LOW | §1 `keyboard-shortcuts` | `App.tsx:882-907` | Esc 栈式关闭正确；无快捷键帮助入口 |

**合计**：CRITICAL 4 / HIGH 12 / MEDIUM 19 / LOW 7 = **42 条**。

---

## 6. Pre-Delivery Checklist 逐条判定（skill「撞见即修」清单）

| 清单条目 | 判定 | 依据 |
|---|---|---|
| No emojis as icons | ✅ 通过 | 设置面板 TSX 里 emoji 作图标 0 处，全部走 `lucide-react`（20 处 import）；`SettingsNotice.tsx:20-21` 还明文要求「不要 emoji，用 SVG 组件」 |
| Icons from one family | ✅ 通过 | 全部 `lucide-react`；`strokeWidth` 覆写 0 处；filled/outline 混用 0 处 |
| Pressed state 不移动布局 | ✅ 通过 | `controls.css:173-175` 只有 `transform: scale(0.97)`；动 width/height 的 transition 0 处 |
| Theme tokens 一致，无 ad-hoc 颜色 | ◐ 大体通过 | Primitive 层被组件直接引用 0 次；但 6 处内联 `style` 逃出 `check:design`（M-16） |
| 所有可点元素有 pressed 反馈 | ◐ 部分失败 | 有 `:active` 档，但无颜色/亮度差别（`controls.css:50-52` 只有 primary）；图标-only 无色调档者触摸设备上看不见（M-5） |
| 触控目标 ≥44pt | ◐ 部分失败 | 双轴达标 25 处 + `.ht-btn` 双轴；单轴 2 处（M-10）+ 目录项约 28px |
| 微交互 150–300ms + 原生缓动 | ✅ 通过 | `fast 150 / normal 200 / slow 300 / exit 140 / press 100`（Apple 有意的例外，注释给了出处）；`transform` 类 transition 只动 transform/opacity |
| 禁用态视觉清晰且不可交互 | ✅ 通过 | `controls.css:153-155` `opacity: 0.38`（走 token，与移动端同值）+ `reset.css:85` `cursor: not-allowed` + `disabled` 语义属性 |
| 读屏焦点顺序 = 视觉顺序，标签可描述 | ◐ 部分失败 | `heading-hierarchy` 全站通过（无双 h1）、`fieldset/legend` 用得好；但 `aria-label` 覆盖成人话之外的原始枚举（H-11）、改名框无 label（C-3） |
| 手势区域无嵌套冲突 | ✅ 通过 | 设置页无拖拽；`--ht-gesture-hysteresis: 10px` 与 `hit-slop` 有 token 但 Web 设置页未消费 |
| 亮/暗主文字 ≥4.5:1 | ✅ 通过 | 亮色 `foreground` 18.16:1；暗色 8 对全部 ≥4.5（7.11–16.63）；`on-danger` 暗色 7.29:1（亮色档 4.83:1） |
| 次要文字 ≥3:1 | ✅ 通过 | `muted` 7.24 / `subtle` 4.55（暗色 12.27 / 7.53）；且 `tokens.css:129-136` 记录了 2026-09-30 那次把整条梯子下移一级的实测（原 `subtle` 只有 2.56:1） |
| 描边/分隔与交互态两档都可辨 | ◐ 部分失败 | 前景对比够，**层级通道**弱：`border vs surface` 亮 1.018 / 暗 1.292，`hover vs surface` 亮 1.080 / 暗 1.178（M-1/M-2/M-9） |
| scrim 强度足以隔离前景 | ✅ 通过 | `--ht-color-overlay: rgb(15 23 42 / 0.5)` = 50% 黑，落在 40–60% 区间 |
| 两档主题都实测过 | ✅ 通过 | `tokens.css:686-799` 整块独立解暗色（明写"不是亮色反相"），`:111-119` 留有实测回退记录 |
| safe area / 固定条不遮内容 | ✅ 通过 | `index.html` `viewport-fit=cover` + `env(safe-area-inset-*)`；sticky `✕` 与 sticky 目录都有 `z-index` 档 |
| 滚动内容不被固定条遮住 | ◐ 通过 | sheet 有 `overflow-y: auto` + 卡片 `scroll-margin-block-start: var(--ht-space-4)`（`:217`）；但切 tab 后 scrollY 不复位（M-15） |
| 375 / 大屏 / 横屏实测 | ◐ 部分 | 设置层实测 `48rem` **23** / `64rem` **2** / `63.9375rem` **2** / `26rem` 2 / `42rem` 1 —— **同一 1024 档有两种写法**（M-19）；`z-index` 裸数字 0 处（全部 `var(--ht-z-*)`）；裸 px/ms 声明全仓仅 4 处（`rail.css:243/270/271`、`sidebar.css:425`，均不在设置层）；`!important` 集中在 `borderless-controls.css` 且逐处带理由注释 |
| gutters 随尺寸/横屏适配 | ✅ 通过 | `--ht-space-6` 桌面 / `--ht-space-4` 48rem 以下（`narrow.css:234`） |
| 4/8dp 间距节奏 | ✅ 通过 | 全部走 `--ht-space-*`；`space-1`(4px) 60 处全部是控件内部图标↔文字，控件之间一律 ≥`space-2`(8px) |
| 长文可读宽度 | ✅ 通过 | `--ht-layout-prose-max: 65ch` 且 `:203-209` 明确拒绝把它套到设置上（理由："那一屏的判据是控件右缘对齐，不是一行读几个字"—— 判断正确） |
| 所有有意义图标有可访问名 | ✅ 通过 | 设置目录内 109 个装饰图标全部带 `aria-hidden="true"`，0 漏挂；图标-only 按钮全部带 `aria-label`（`apps/web/src/features/settings` 下 `aria-label=` 共 18 处），0 无名 |
| 表单有 label、hint、清晰错误 | ◐ 失败 | 见 C-3 / H-8 / H-9 |
| 颜色不是唯一指示 | ✅ 通过 | 每个 tone 都有语义图标；`--ht-color-category-*` 的取值是按色盲三档实测解出来的（`:203-222`），并明令「只能当图形色，不能当正文色」 |
| `reduced-motion` / Dynamic Type 不破版 | ✅ 通过 | `tokens.css:818-837` 压时长不删属性（理由正确）+ 三处组件级兜底；字号全走 `rem` |
| 选中/禁用/展开态被正确播报 | ◐ 部分 | `role="switch"` + `aria-checked` 齐备（`AiSettings.tsx:1605-1611`）；但 live region 用法分叉（C-4 / M-7） |

---

## 7. 根因分析：这些问题为什么存在

### 根因 A —— 「降噪」被做成了「去色」：一次审美裁决没有配套的语义色替代

C-1、H-2、M-1、M-2、M-3 是同一个动作的五个断面。设置页经历过一次明确的"排版混乱"整改（`ProfilePanel.tsx:17-30` 与 `AiSettings.tsx:1493-1499` 都记录了产品负责人的原话与 2026-10-24 的禁令），整改方向是**减视觉噪音**：删掉 `border-left` 强调条、把 danger 前景降回正文字色、把说明文字收进气泡。
但这条裁决**只写了"不许做什么"，没写"改完之后，这一层语义靠什么承载"**。于是：
- 错误不能靠颜色（怕吵）→ 靠图标 → 有 12 处连图标也没有（H-9、C-1）；
- 选中态不能靠边框（`borderless-controls.css` 全局禁描边）→ 靠底色 → 底色只差 1.088:1（M-1）；
- 说明不能常驻（禁令）→ 进气泡 → 但气泡**不可能成为反馈的唯一载体**（`SettingsNotice.tsx:25-26` 自己写下了这个例外，例外被 `M-6`/`M-7` 违反了三次）。
**更深的成因是 `tokens.css` 缺一档 `selected`**：`primary-subtle` 是"品牌浅色背景"（用于 hover 前的淡底、tag 底色），被临时征用成"这一项已选中"。它的取值从来不是按"与 surface 拉开 ≥3:1"解出来的，所以征用它必然失败 —— 这是**没有语义档位、只能用外观档**的必然结果，而它恰好违反 `design-system.md` 自己的第 3 条铁律（「命名一律语义化……理由：换色系时语义名不用改」）。同类缺档还有 `--ht-color-danger` 被要求同时兼任「文字色」与「实底按钮背景」两职 —— 前者在 sunken 上 4.41:1（`AA_PAIRS` 已把这一条标为**有意排除**并写明理由），所以 `--ht-danger-text` 这一档其实**已经存在**，只是设置页的反馈层没用。
**根治**：新增 `--ht-color-on-selected-bg` / `--ht-shadow-inset-focus`，或把 `--ht-color-primary-subtle` 直接提深一档到 `--ht-blue-100`（`#dbeafe`，对 `#ffffff` = 1.5:1 仍不够，需要 `blue-200`）；并把「层级/状态色必须与承载面拉开 ≥3:1」加进 `tests/tokens.spec.ts` 的 `AA_PAIRS`。

### 根因 B —— 门禁按**字面拼写**而非**概念**设卡，所以同一缺陷换个拼写就活着

C-2 是最干净的样本。`controls.css:60-66` 已经把"不带色调的按钮读起来像说明文字"立成案、给出复量命令（`grep -rn 'className="ht-btn"' apps/web/src --include='*.tsx'`）并声称现量已归零。今天这条复量**确实仍然是 0** —— 因为违规者换了拼写：`ht-btn--outline`（1 处，`CloseAccountPanel.tsx:174`，CSS 里零定义）。棘轮量的是字面，不是概念。
同一形状还有 `App.tsx:380-384` 与 `:999-1003` 逐字记录的事故：**同一条规则被写了两次**（「让当前项进视野」挂在 onClick 上，而 `scrollIntoView` 又挂一遍），而 `:320-329` 记录了 `activeSettingsSection` 用模板字符串拼 group id、锚点名一改就「每一节都 hidden」的整页崩溃 —— 那一次也是"复量脚本只匹配字面量，漏了模板拼接那一处"，判据写的是 `ht-settings__preference-row` 这个 class 名而不是这个概念。
原因：这个仓库的门禁大多是 `grep` 型的**字符串棘轮**（`check:control-semantics`、`check:l4`、`check:empty-state`、`check:design`），它们的断言对象是**写法**。而 TSX 里出现的任意 class 名与 CSS 里定义的 class 名之间，**没有任何编译期或 CI 期的对账**。`check:control-semantics` 甚至把 `ht-btn--outline` 写进了文件头当反例（:28）却没有把它变成断言 —— 登记 ≠ 拦截。
**根治**：把"TSX 用到的 `ht-*` 类名必须能在 CSS 里解析到"变成一条真判据（对 `ht-btn--X` 尤其：X ∈ 已定义档位集合）。这条判据今天一定能失败，所以它是**能失败**的判据。

### 根因 C —— 反馈的 DOM 形状没有抽象，于是每块面板各自决定 `aria-*` 怎么写

C-4、H-5、M-7、L-2、L-6 全部落在同一个空白上：本仓有 `Notice` 类型（`ProfilePanel.tsx:93-97` 四档 `idle|busy|done|error`），有 `SettingsNotice`（tone 分档），有共享 `EmptyState`（带 action 的强制判据），**但没有一份 `<Feedback>` 的 DOM**。
于是四块面板各写一遍，写法互不相同：
| | `ProfilePanel.tsx:508-525` | `EmailChangePanel.tsx:335` | `PasswordPanel.tsx:455/591` | `CloseAccountPanel.tsx:202` |
|---|---|---|---|---|
| live 容器 | ❌ | ✅ `aria-live="polite"` | ✅（两个） | 挂在条件渲染的 `<p>` 自己身上 = 失效 |
| `role` | 无 | 无（靠容器） | 无（靠容器） | `status`（错误与成功同一档） |
| 自动消失 | ❌ 永久驻留 | ❌ | ❌ | ❌ |
| busy 可见 | ❌ 返回 null | ✅ | ✅ | ✅ |
`Notice` 联合类型里那四档**本来就是为了区分"进行中/成功/失败"该说什么话**（`:123-128` 记录了它曾经把 GET 失败写成"头像没有传上去"的事后），但类型分对了、渲染层没接住。
**根治**：抽 `<Feedback notice={…} testId={…}>` 一个实现（常驻 live 区 + `role` 按 kind 选 + `done` 定时淡出 + busy 返回真文案），删掉四份自拼。这与 `sessionsStore.ts:37-42` 里已经立过的纪律是同一句话：**两份 `failed` 必须有两个不同的可区分值 —— 那么两份"反馈的无障碍接法"同样不该存在。**

### 根因 D —— 「业务语义只许出现在 packages」这条铁律没有覆盖**无障碍语义**与**日期口径**

AGENTS §3.5 把业务裁决上收到 `packages/*`，本仓执行得很干净：六个面板里 **0 处**协议知识（端点/路径/字段名），`emailChangeStage`/`planDisplayNameWrite`/`resolveAccountAvatarImage`/`recomputeConsents`/`accountClosureMessageKey`/`failureKey` 这些裁决全部在 app-host / shared-schema，UI 只渲染。`notifyAccountIdentityChanged()` 单通道、`aliveRef`/`sessionGenerationRef` 防跨会话写回，都写得对。
但**同一个"两份实现必然漂移"的论证**，在下面三处没有被套用：
1. **日期时间**（H-3）：`PasskeyPanel.tsx:130` 的 `iso.slice(0,10)`、`SessionsPanel.tsx:59-67` 的 `toLocaleString(locale)`、`app-host/privacy-consent.ts:165` 的模板切片 —— 三份"这条时间怎么给人看"的实现，其中一份不跟界面语言、一份把 UTC 当本地。这不是业务语义，是**呈现语义**，§3.5 的字面管不到它，于是它散开了。
2. **忙态纪律**（H-6）：`ADR-0040 §3.7` 定了"guard 而不是 disabled"，`PasswordPanel.tsx:46-49` 还把理由逐字抄进注释。但这条裁决既不在 `docs/agents/` 也不在 `packages/ui`，而是一份 ADR 里的一句话 —— 另外 15 处 `disabled` 的作者没有读到它。
3. **无障碍接法**（C-4/H-5/M-7/L-2）：`role` 与 live region 的选择同样是"决定该怎么做"，但没人把它当裁决登记。
**根治**：把 `formatDateTime` 上收到 `packages/design-system`（与 `ICON_SIZE` 同一个理由：视图侧不许各解一遍 token）；把 ADR-0040 §3.7 的这条上移到 `docs/agents/ux-principles.md`；给无障碍接法一条 `check:aria-live`（断言：`role="status"` 只出现在**常驻**容器、条件渲染的节点不得自带 `aria-live`）。

### 根因 E —— 一次"无描边"的全局裁决用 `!important` 实现，代价是周边规则被静默吞掉，且需要不断打补丁

`borderless-controls.css` 是整个焦点/边框体系的单点风险源：
- `:18-26` 对 `button, [role=button], input, textarea, select, [contenteditable]` 下 `border-color: transparent !important` + `box-shadow: none !important`；
- `:28` 再 `:focus { outline: 0 !important }` —— 这一条把**全仓所有输入框的键盘焦点**一起抹掉了，`:32-45` 的修复注释逐字承认了这件事（"这不是审美取舍，是两条 AA 级判据"）并加了 `:61` 的 `:focus-visible` 补环；
- `:9-17` 记录了第一次被静默吞掉的实例：`.ht-habit__row[aria-current='true']` 的主色选中边框被 `!important` 吃掉，暗色下量到 `borderTopColor = rgba(0,0,0,0)`，是 `habits-two-column.spec.ts:305` 当场抓住的；
- `:101-105` 与 `tokens.css:381-387` 记录了第二次：向外的焦点环会被 `overflow` 非 visible 的祖先裁掉，`outline` 与 `box-shadow` 一样，所以要把 `--ht-focus-ring-offset` 改成负数，而"哪些层要加进来由**浏览器几何扫描**判，不由人记"；
- `:106-121` 那个豁免名单里躺着 `.ht-settings__scope-badge`（**死引用**：TSX 里的真实类名是 `ht-ai-settings__scope-badge`），以及 `:120` 的 `.ht-input` —— 后者已经在 `controls.css:345` 被 `border: 0` 取代，所以这条豁免现在管的是一个不存在的需求。
这正是 skill「Theme-specific borders disappearing」与「elevation-consistent」两节点名的形状：一个全局强制 + 逐次打补丁（`:15` 自己说了"不需要再加一条 `!important` 去打这条 `!important`"—— 但补丁的清单本身已经漂了）。而 H-4 的 `:has(input:focus-visible) { background }` 是这次裁决的下游产物：焦点不能用环，就用底色，于是 `check:focus-single-source` 被自己人破了。
**根治**：焦点实现收回一条（`reset.css` + `borderless-controls.css` 合并成一份，去掉互相冲突的 `!important`）；豁免名单改成按**结构**而非 class 名匹配（`:has(> .ht-material__row-pop)` 那种写法已经给了先例，`controls.css:505`）；被 `borderless-controls.css:117` 指向的类名做一次全仓对账。

### 根因 F —— 断点档位没有唯一事实源，注释与代码已经漂到互相矛盾

`--ht-layout-two-column-min: 768px`（**裸 px**，tokens.css:450）被两处 JS 用 `getPropertyValue` 直接读走（`QuadrantBoard.tsx:243`、`CountdownView.tsx:270`），而 CSS 一侧写的是 `48rem`（设置层 23 处）。768px 与 48rem 在 root=16px 时等价，但**语义不同**：`rem` 随宿主字号缩放、`px` 永远不缩放。把系统字号调到 20px 时，23 个 `48rem` 块提前换位（≈614px），而 `768px` 那一块纹丝不动 —— 于是两列布局在"已经按移动版式排"的窗口里仍然坚持两列。**同一个断点概念有两个事实源、两种单位**，这正是 `design-system.md`「响应式断点」那一节要挡的形状。

比单位分叉更能说明问题的是**注释已经追不上代码**：
- `sheets.css:244` 仍写着「缩窄到单列时（< **40rem**）标签在上、控件在下」，而它描述的那个媒体块在 `:316` 早已按 `:313` 的自我纠正改成了 `48rem` —— 注释里的那个数现在是**假的**；
- `admin.css:489` 写着「窄屏（与 `controls.css` 同一档 **40rem**）」，而 `controls.css` 的媒体块实际是 `48rem`（`:263`、`:412`）—— 一个从未存在过的档位被当成对齐依据引用了两处。
- 同一 1024 档有两种写法：`max-width: 64rem`（`sheets.css:416`、`:751`）与 `max-width: 63.9375rem`（`assistant-layout.css:29`、`narrow.css:442`）。768px 整点的边界配对是闭合的（`48rem` 含、`48.0625rem` 不含），但 **1024px 整点在两种写法下结论相反** —— 恰好 1024px 的设备上，设置目录折成横条而助手栏不折。

**根治**：`--ht-layout-two-column-min` 与 `--ht-nav-*` 全部转 `rem`，与 CSS 共用同一把尺；断点只许写成 token（`@media (max-width: var(--…))` 目前 CSS 语法做不到，那就用一张**注释掉的档位表** + 一条 `check:` 扫 `max-width:` 的字面值必须落在允许集合内）；顺手把 `sheets.css:244` 与 `admin.css:489` 两处过期数字改对 —— 「登记 ≠ 拦截」在文档上的表现就是这种漂移。

### 根因 G —— 审计发现的修复登记进了注释，但注释不是判据

本仓有一个罕见的习惯：**把产品负责人的原话、实拍结论、被推翻的旧版本逐字写进代码注释**（`ProfilePanel.tsx:17-30` 的「排版混乱」四条症状对照表、`AiSettings.tsx:1493-1499` 的「不知所指的 icon」、`sheets.css:330-339` 的 fieldset 黑框事故、`borderless-controls.css:9-17` 的习惯行边框事故）。这批注释非常有价值 —— 本文几乎所有"同页其他处做对了"的判断都是从这些注释里读出来的，它们让根因 A–F 可被诊断。
但副作用是：**注释在描述缺陷的同时会暗示缺陷已被处理**。最典型的是 `ProfilePanel.tsx:25` 那一行诊断：「`.ht-input` 的背景是 `surface`，而卡片**也是** `surface` ⇒ 没有框」—— 今天这条**已经被修好了**，`sheets.css:357-359` 正是针对它写的（卡片内把输入框底色换成 `--ht-color-background`），而诊断注释还留在原地。同类的还有 `EmailChangePanel.tsx:296`：那条注释把"无边框"描述成现状，但 `borderless-controls.css` 的全局裁决恰恰使它**不可能**有边框 —— 注释描述的是它没参与的那条规则。
C-2 是同一机制的最强反例：`check-control-semantics.mjs:28` **把 `ht-btn--outline` 写成了文件头的反面教材**，读了它的人会以为这一档已被管住；实际它只是被"提到"了。
**根治**：给每条被注释诊断过的缺陷挂一个可判红的断言（能失败），或在注释旁边写 `// 已修：见 sheets.css:357`；`docs/agents/progress-log.md` 的已知边界表里，本文的 C-1…C-4、H-1…H-3 应该各占一行。这与本仓工作流第 2 条「**测试要能失败**：新增门禁/校验时，先确认它在违规输入下真的会红。不能失败的检查没有价值」是同一句话 —— 本文里 `check:control-semantics`、`check:design`、`check:focus-single-source` 三道门禁各放过了一例，而它们都是**能跑绿**的。

---

## 8. 建议的修复顺序

1. **C-2 / C-3 / C-4**（三行到二十行的局部改动，无跨层影响）—— 把 `--outline` 换成 `--secondary`、补 label、live 区提到常驻。
2. **C-1 + M-3**（同一族配色）—— `.ht-settings__danger` 补色与 width、`settings-notice.css` 四 tone 补 width；同时补 `--ht-color-danger` 在 `surface-sunken` 上 4.41:1 那条 `AA_PAIRS` 缺口。
3. **H-1**（一次 CSS 档位调整，覆盖 9 条规则）+ **M-1/M-2**（新增 `--ht-color-on-selected-bg` 一档）+ **M-17**（顺手删死选择器、把豁免名单改成按结构匹配）。
4. **H-11 + H-9**（无障碍名与校验时机，同一次改动里做完）。
5. **H-3**（`formatDateTime` 上收 `packages/design-system`，三处共用）+ **H-6**（忙态纪律统一 + 一条新门禁）。
6. **H-4 / H-7 / H-8** 与 **M-15**（焦点、暂存、hash 化）。
7. **M-9 / 根因 F**（暗色 surface 阶梯 + 断点转 `rem`）。
8. 把本文 C/H 各条登进 `docs/agents/progress-log.md` 的已知边界表，并为 `ht-*` 类名对账、`aria-live` 常驻、TSX 内联样式棘轮三条**新写能失败的门禁**。
