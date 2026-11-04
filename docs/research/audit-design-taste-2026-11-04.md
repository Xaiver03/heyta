# heyta 设置页设计品味审计（design-taste-frontend 方法论）

- 审计日期：2026-11-04
- 审计对象：设置浮层（`设置` → 账号 / 订阅 / 数据与同步 / 提醒与通知 / 外观与语言 / 功能与 AI / 关于与帮助）
- 审计方法：`/Users/rocalight/.agents/skills/design-taste-frontend/SKILL.md`（taste-skill v2）全量走查
- 判据基准：仓库自身的设计系统规范 `design-system/heyta/MASTER.md` + `packages/design-system/src/tokens.css` 是**权威**；taste-skill 是**外部参照**。二者冲突时以仓库规范为准，但冲突点如实登记。

---

## 0. 先说结论（Design Read + 一句话裁决）

**Reading this as:** 本地优先生产力应用的**设置浮层（dense product UI / 二级工作区）**，受众是"自己架服务器 / 在意隐私"的技术型个人用户与小团队，语言是克制的功能型（Linear / macOS Settings 家族），落在**自有的 token 化设计系统**上。

一句话裁决：**这一屏不是"AI 味/模板味"的烂，而是"治理过度 + 行语法没统一"的另一种不整齐。** 它在 taste-skill 最担心的那些点上（裸色、AI 紫、Inter、占位符当 label、没有加载/空/错误态、亮暗反相、hover 抖动、假数字、假截图、em-dash 泛滥的英文营销腔）**几乎全部通过**，甚至超出；它真正的"手感差"来自三件事：

1. **产品负责人那条"严禁说明文字，只准用问号"的禁令被执行过头了** —— 整屏可见引导≈0，一切靠 hover 一枚 11px 的 `CircleHelp` 才读得懂，页面显得空洞、需要"逐格点开"，反而像说明书的**反面**（什么都不敢说）。
2. **同一屏存在至少五套"设置行解剖"**：ProfilePanel 的两列 `__row`、Passkey/Sessions/Password 的堆叠 `__section`、AiSettings 的 `--cards`、DataSettings 的 `__data-card`、Privacy 的 `fieldset`。它们字号/圆角/分隔方式各不相同 —— 这是 2026-10-24「排版混乱」的**残留**，CSS 里大量 `border:0` 覆盖 + 长注释自证，说明设计语言仍在摆动。
3. **字号梯子被压到了自己定的地板以下**：`--ht-font-size-2xs`(11px) 在设置类 CSS 里出现 **18 次**，且用在**真消息**上（`__notice`/`__warn`/`__item-sub`/`__tag`/`__credential-meta`），颜色还走 `foreground-muted/subtle`。MASTER.md §4 明写「11px 是极限下限，仅极致紧凑标签」。

**根因判断（先给答案，详见 §12）：不是 taste-skill 方法论缺失，而是 (a) 该 skill 自认对设置页 out of scope（§13），它的判据大半不适用；(b) 真正让界面"差一点"的是产品治理决策与行语法统一度，属于执行/裁决层，不是 skill 能补的层。**

---

## 1. §0 Brief Inference（技能要求：先读房间，别跳到默认审美）

| 技能要求 | 代码实际 | 判定 |
|---|---|---|
| 判断页面类型 | 设置浮层（`.ht-sheet`，`App.tsx:3345`，从右侧覆盖下层视图，`aria-modal=false`）—— 不是 landing/portfolio | ✅ 正确识别 |
| 判断受众 | 本地优先 / 可自托管 / 端到端加密的用户，隐私与技术敏感 | ✅ |
| 避免默认套路 | 无 AI 紫渐变、无居中 hero over mesh、无三张等大功能卡、无满屏玻璃、非 Inter | ✅ 全部避开 |
| 已有的品牌资产优先 | 蓝白单色系 + Plus Jakarta Sans + Lucide，全部 token 化 | ✅ 尊重既有品牌 |

**这一屏是 product UI，不是营销页。** taste-skill §13 白纸黑字把它列为「Out of scope：dashboards / dense product UI / admin panels」，并明确要求「先说破，只把营销页/关于页那部分用在适用的表面上」。所以本报告**只套用适用于设置页的子集**（排版、配色校准、交互态、表单模式、可达性、暗色、形状锁、部分 AI-tell），对 hero / eyebrow / bento / logo wall / 引言 / marquee / 真实图片那一大类**判 N/A 而非判红**——若强行套这些规则去"改好"设置页，反而是误用。

---

## 2. §1 Three Dials（VARIANCE / MOTION / DENSITY）

taste-skill 的默认基线 `8/6/4` 是给 landing 的。设置页的正确档，按 §1.A「trust-first / accessibility-critical」行与 §7 定义反推：

| Dial | Landing 默认 | 设置页应取 | heyta 实际落在 | 评价 |
|---|---|---|---|---|
| `DESIGN_VARIANCE` | 8 | **2–3（Predictable）** | ~2 | ✅ 对齐 macOS/Linear 设置：规整、可预测、不追求"艺术性"。设置页 variance 高就是 bug。 |
| `MOTION_INTENSITY` | 6 | **2–3（Static，仅 hover/active）** | ~2 | ✅ 只有 sheet 入场 `ht-sheet-in` + 按钮 `scale(0.97)` 按压反馈；无滚动动画、无循环微交互。恰当。 |
| `VISUAL_DENSITY` | 4 | **5–6（Daily App→偏 Cockpit）** | ~5 | ✅ 设置本就信息密。但见 §11：密度靠"行"承载是对的，**不该**再靠小字号承载。 |

**结论：三个 dial 的实际取值都恰当，甚至偏保守——这正是设置页该有的样子。** 问题不在 dial，在 dial 之下的行语法与文案承载。

---

## 3. §2 Design System Map（该不该用现成系统）

taste-skill §2 要「brief 读作某个系统就用官方包，不要手搓 CSS 复刻」。

- heyta **没有**用 Fluent/Carbon/Material 官方包，而是**自有一套 token 化设计系统**（`packages/design-system` + `@heyta/ui` + `.ht-*` 类族）。
- §2.A 的诚实性规则担心的是"假装借鉴某系统却手搓其 CSS"。heyta 不是这种情况：它是**真正自建并 own 组件**（对应 §2.A 里 shadcn「you own the code」那一档的精神，虽然没用 shadcn），且**默认态全部改过**（radius 分档、无描边裁决、发丝线、凹陷底），不存在"shadcn 默认状态直接上线"这条红线。
- **一致性**：`--ht-*` 语义 token 是唯一事实源，`check:design`/`check-hardcoded.mjs` 拦裸值，`tokens.spec.ts` **实算 WCAG 对比度**。这套治理**强于** taste-skill 的最低要求。

判定：✅ 设计系统选型诚实且自洽。唯一提醒——§2.B「glassmorphism 要给 reduced-transparency 回退」，heyta 在 `tokens.css:850-861` 已做（`prefers-reduced-transparency` 把 tint 压成实色 surface、blur 压 0），且注明"必须放文件末尾"的层叠陷阱。**超出 skill。**

---

## 4. §3 Default Architecture

| 子项 | skill 要求 | heyta | 判定 |
|---|---|---|---|
| §3.A 栈 | React + Tailwind v4 默认 | React + **原生 CSS token 体系**（非 Tailwind）。设置页是既有工程，非新建，合理偏离。 | ✅（既有约束优先） |
| §3.B 状态 | 局部 UI 用 useState；连续值别用 useState | 面板用 `useState`/`useRef` + 各 store（Zustand 风格 `useXStore`）。EmailChangePanel 倒计时用 `setNow` 每秒 tick —— 是离散时间戳不是连续输入，可接受。 | ✅ |
| §3.C 图标 | Phosphor/HugeIcons/Radix/Tabler 优先；**Lucide discouraged**，"仅当项目已依赖才可" | 全仓 20 处 `lucide-react`，**0 处**其它图标库 → 单一图标族 ✓；且 **MASTER.md §7 明文标准化 Lucide**（"stroke 风格一致、MIT、持续维护"）。 | ✅ 触发覆盖路径（项目已依赖 + 明文选定），非违规 |
| §3.C strokeWidth | 全局统一 | Lucide 默认 2，未见混用 | ✅ |
| §3.D Emoji | 代码/标记/可见文本里禁用 | 渲染层 **0 emoji**（全部走 Lucide 图标）；🔴⚠️ 等只出现在**代码注释**里。MASTER §7「禁止用 emoji 当图标」。 | ✅ |
| §3.E 响应式 | 断点标准化、viewport 稳定、grid over flex-math | 断点 48rem/64rem 一致使用；塌缩**逐节显式声明**（如 `__row` < 48rem 单列、sub-plans < 48rem 单列）。行布局走 `display:grid`（`__row` 是 `grid-template-columns`）。 | ✅ |
| §3.F 依赖核验 | 引入前查 package.json | lucide/i18n/design-system/app-host 均在依赖内 | ✅ |

一处**低**提醒：`AiSettings.tsx:753` 给 `<fieldset>` 写了内联 `style={{ border:0, padding:0, margin:0 }}`。这与本仓 `check:l4`「内联样式只减不增」的精神相冲（sheets.css:581 自己论证过）；同一段 fieldset reset 在 `sheets.css:340` 已有类化版本 `.ht-settings__field`。应改用既有类而非内联。严重度：**低**（单点，功能无害，属规范洁癖）。

---

## 5. §4 Design Engineering Directives（逐条走查）

### §4.1 Typography
- **sans 选择**：`--ht-font-sans` = Plus Jakarta Sans（`tokens.css:234`），**不是 Inter**（skill discourages Inter）；且**显式给了 CJK 回退**（PingFang SC / 微软雅黑 / Noto Sans SC）——skill 完全不覆盖中文排版，这一步是**项目自加的、正确的高分动作**。✅
- **display vs body 层级**：层级用**字重+色**而非裸字号（`ai-panels.css:250` 注释记录：曾经 section-title 与页标题一般大导致"层级全塌"，已收档）。`.ht-settings__title` 挂语义档 `ht-type-section-title`。✅
- **serif discipline / italic descender / Fraunces 等**：无衬线、无斜体强调、无 Fraunces/Instrument Serif。N/A（且合规）。
- **⚠️ 字号地板问题（本审计最主要负面发现之一）**：11px（2xs）在设置 CSS 里 **18 次**，用于真消息：
  - `.ht-settings__notice` = `2xs` + `foreground-muted`（`ai-panels.css:414`）——**保存成功/已删除**这类回执用 11px 灰字；
  - `.ht-settings__warn` = `2xs` + `--ht-color-danger`（`ai-panels.css:1005-1016`）——**能力缺口警告**用 11px 红字；
  - `.ht-settings__credential-meta` = `2xs`（`settings-account.css:51`）——通行密钥/会话行的日期；
  - `.ht-settings__tag`/`__item-sub`/`__cap-hint`/`__inline-label` 全 `2xs`。
  
  MASTER §4：「12px 仅用于辅助标签，11px 是极限下限」。skill §4.5 FORM CONTRAST + §9 排版精神：把**要读的消息**压到下限字号、还是 muted/subtle 色，可读性与"刻意感"都打折。
  另一条：`__warn` 用 `danger` 普通档做 11px 文字，MASTER §3.1 要求小字号状态文字上 `*-strong` 档。**中**：字号档 + 状态档双重偏低。

### §4.2 Color Calibration
- **单强调色锁定**：全页唯一 accent = 蓝（`--ht-color-primary`），light blue-600 / dark blue-400。**Color Consistency Lock（§4.2）✅**：没有"第七节突然变蓝/玫瑰变青"这种漂移。
- **THE LILA RULE / AI 紫**：无紫无蓝glow。✅
- **premium-consumer palette ban（beige+brass+espresso）**：不适用（非 premium-consumer brief），且 heyta 用冷调 slate 中性 + 单蓝，**恰好是该规则推荐的"cold / monochrome+single pop"路线**。✅
- **中性一致性**：统一冷灰 slate，不混暖冷灰。✅
- **饱和度**：blue-600 `#2563eb`（≈83% sat）是品牌色（MASTER 明文），不是随手高饱和；暗色档**刻意降饱和并提亮前景**（`tokens.css:684-800`），这是 skill §8.B「别把品牌淡掉 / 暗色不是反相」的**教科书级实现**。✅✅
- **提醒**：`category-1..8`、`quadrant-*`、`priority-*`、`heat-*` 是**数据语义色**不是装饰，MASTER §3.1 严格限定其含义，且 `category-*` 只允许当"图形色"（3:1）不当正文色——这是**比 skill 更严**的治理。

### §4.3 Layout Diversification（反居中偏置）
- 落地页规则，对设置页基本 N/A。设置内容面是**左对齐标签 / 右对齐控件**（`__row`、`__toggle-hit` 的 `row-reverse + space-between`），天然非居中。✅（精神满足）

### §4.4 Materiality / Shadows / Cards / Shape Lock
- **卡片只用于"分隔确实承载层级"处**：外层面板是一张卡（`sheets.css:89` `--ht-radius-lg`），卡片内部的 `__section` 被**主动降级成无边框子块 + 发丝线**（`sheets.css:989`、AiSettings 注释①②③④）。这正是 skill §4.4「otherwise group with border-t/divide-y/negative space」的做法。✅
- **阴影着色**：亮色 shadow 全部 tint 到 `rgb(15 23 42 / α)`（slate 色相）而非纯黑（`tokens.css:305-308`）；暗色 shadow 用纯黑是对的（深底上）。skill §4.4「no pure-black drop shadows on light bg」✅。
- **层次靠边框、阴影只给浮层**：`.ht-settings` 卡用 `border`+`shadow-md`，popover/tooltip 用 `shadow-md`，sheet 用实色底——分层规则成文（`design-system.md`「扁平风格用边框表达层次」）。✅
- **SHAPE CONSISTENCY LOCK（§4.4）**：radius 是一套**有据可依的分档规则**：input=md(8) / button=18 / card=lg(12) / dialog=24 / chip&tag&sub行=sm(4) / avatar=full。skill 允许"有文档规则并处处遵循"。
  - **中**发现：**"卡片"这一层没有唯一半径**。外层面板卡 `lg`(12)（sheets.css:92），而 `__section` 子块 `md`(8)（ai-panels.css:272）、`__data-card` 与 `__danger-card` `md`(8)（settings-account.css:67）、`__account-gate` `md`(8)、`--cards` 里的 `__section`/`__subsection`/`__ai-card` 又是 `lg`(12)（sheets.css:966）。同样是"一个话题的容器"，半径在 8/12 间来回。**这正是行语法未收敛在圆角上的表现**（skill §4.4「mixed systems allowed only with a documented rule followed everywhere」——这里规则有，但**没有处处一致**）。

### §4.5 Interactive UI States
- **Loading / Empty / Error 全周期**（skill 最看重的一条，专治"LLM 只画成功态"）：
  - Loading：每个异步面板都有 `role="status"` + `Loader2`（Profile/EmailChange/Passkey/Sessions）。
  - Empty：SessionsPanel **走共享 `EmptyState` 组件**（`packages/ui`），不是手搓（`SessionsPanel.tsx:203`）。✅ 强。
  - Error：全部 `role="alert"` + `AlertTriangle`，且"读侧失败 ≠ 空列表"这类语义细分到位（PasskeyPanel/SessionsPanel 文件头）。✅✅
- **Tactile `:active`**：`scale(var(--ht-motion-press-scale))` = 0.97（`controls.css:173`），只动 transform，且 reduced-motion 下时长→1ms 自动失效。✅
- **BUTTON CONTRAST CHECK**：`on-primary`/`on-danger` 配对由 `tokens.spec.ts` 实算（亮白字/暗深字，暗色 danger 从 `#f87171`+白=2.77:1 纠正为 slate-950 字=7.29:1）。**超出 skill**。✅✅
- **CTA WRAP BAN**：`.ht-btn { white-space: nowrap }`（`controls.css:32`），且窄屏整组换行而非文字竖折（`ai-panels.css:801`）。✅
- **NO DUPLICATE CTA INTENT**：设置不是转化漏斗；各面板动作名互不重复（保存/换一张/添加/撤销/退出所有）。N/A 且合规。
- **FORM CONTRAST CHECK**：`.ht-input` 无描边 + `flex:1`，在 `surface` 卡上原本"看起来是几行灰字/一片白"（EmailChangePanel 注释实拍）。已用 `sheets.css:357`（卡内 input 换 `background` 凹陷底）+ 占位符补线索修掉。✅（缺陷已被发现并修，过程记录清楚）
- **每屏一个 primary CTA**：ProfilePanel 注释（`ProfilePanel.tsx:360`）明确头像行用 ghost、昵称保存用 primary，避免整屏太重——符合 §4.5「each screen only one primary」的精神（MASTER §7 也写「Primary 每屏只有 1 个」）。✅

### §4.6 Data & Form Patterns
- **Label 在上 / helper 可选 / error 在下 / gap-2**：`PasswordField`（`PasswordPanel.tsx:183`）label → input → aria-live 报错在下，`__field { gap: space-1 }`。✅
- **No placeholder-as-label**：昵称、换邮箱、设密各框**都有真 `<label htmlFor>`**，placeholder 只是辅助。✅
  - **低**：PasskeyPanel 行内改名输入框（`PasskeyPanel.tsx:328`）只有 `placeholder` 无可见 label（有隐式上下文）；AiSettings 密钥框（`AiSettings.tsx:1044`）靠 `aria-label`+placeholder。都是行内编辑场景，可接受，但严格看接近 skill §4.6 边界。

### §4.7 Layout Discipline（硬规则）
- hero fit / hero font-scale / hero top padding / hero stack / logo wall under hero / bento cell count / zigzag cap / eyebrow restraint / split-header ban —— **全部是 landing 规则，对设置页 N/A**。逐条在 §14 里标 N/A，不假通过。
- 适用项：**导航单行**——设置左栏 `__nav` 是竖排目录，窄屏转横向滚动（`sheets.css:416`），非两行断栏。✅
- **Section-Layout-Repetition（§4.7）**——本可用来抓"同一屏同一布局家族反复"。这里反过来：**不是重复过度，而是家族过多**（见 §11），是另一种不一致。

### §4.8 Image & Visual Asset
- landing/portfolio 规则，N/A。设置页**正确地没有装饰图**。
- §9.D「no generic avatars / SVG egg」：头像回落是**邮箱首字母**（`avatarInitialFromEmail`，`ProfilePanel.tsx:288`），不是画一个彩蛋/用户图标；且"拿不到邮箱时不编一个字母"。✅（比 skill 要求更克制）

### §4.9 Content Density
- **数据 dump / 长 spec 表 + 每行 border-b**：skill 判这是最懒布局。设置页**确实用发丝线隔开每一行**（`__row + __row`、`__preference-row + __preference-row`、`__section + __section`）。—— **但这是 macOS 设置的正典做法，且 §13 把 product UI 排除在外**，所以**不判红**；若按 marketing 规则去删分隔线反而更糟。登记为"skill 在此不适用"的示例。
- **Copy Self-Audit**：可见中文是**功能型、地道、无 AI 假深沉/假俏皮**（`check:ui-language` 门禁）。✅
- **Fake-precise numbers**：所有数字来自契约常量（`ACCOUNT_DISPLAY_NAME_MAX_CODE_POINTS`、`AUTH_PASSWORD_MIN_CODE_POINTS`、托管额度 `X/300` 是真实法务承诺）——**无 AI 编造的"5.8mm 式精度"**。✅✅

### §4.10 Quotes & Testimonials
- N/A（设置页无引言/证言）。

### §4.11 Page Theme Lock
- **单一主题**：整页由 `data-theme='dark'|light` 一处切换（`App.tsx:3688` theme-toggle），所有面板消费同一套语义变量；**没有任何 section 中途反相**。✅✅ 且亮/暗是两套独立调过的值（非反相），是本项**标杆实现**。

---

## 6. §5 Context-Aware Proactivity（是否滥用模式）
- **Glassmorphism/Magnetic/Mesh/无限循环动画**：设置页**一个都没用**——正确，这类模式对 dense product UI 是"materiality 用错场景"。skill §2 的"玻璃只给悬浮层"精神在 ADR-0042/MASTER §2 落成"内容面扁平、悬浮层才材质"，设置内容面走扁平。✅
- **"Motion claimed = motion shown" / marquee / GSAP sticky**：N/A，设置不该有滚动叙事，也没有。✅
- **唯一动效**：sheet 入场 200ms + 按钮按压 100ms，都**有动机**（state transition / feedback）。符合 §5「MOTION MUST BE MOTIVATED」。✅

---

## 7. §6 Performance & Accessibility Guardrails
- **§6.A 硬件加速**：过渡只碰 `transform`/`background-color`/`color`/`border-color`，不碰 width/height/top/left。✅
- **§6.B Reduced motion（强制）**：`tokens.css:818-837` 把所有 `--ht-duration-*`→1ms（**压时长不删属性**，避免 `transitionend` 逻辑失效——细节正确）；`sheets.css:490/572` 再关 sheet/搜索入场；`ai-settings.css:213` 关 tool-row 过渡。✅✅
- **§6.C Dark mode（强制）**：见 §4.11，双模式 token 化 + 对比度实算 + 暗色非反相。✅✅
- **§6.E DOM cost**：无 grain/noise，无 fixed 伪元素滤镜层。✅
- **§6.F z-index restraint**：`--ht-z-base..splash` 成系统阶梯（`tokens.css:345-365`），禁裸数字，且**记录了 popover>modal 这一真实缺陷**并补 `modal-commitment:550`。✅（超出 skill）
- **触控目标**：`--ht-touch-target-min` 44px 全线（chip 分型后只读徽标不长高、可点动作到 44），有测试守。✅
- **一处可达性隐患**：`__warn`(danger 11px)、`__notice`(muted 11px) 把**要读的信息**放在字号/颜色下限附近；虽靠 token 保证对比度下限，但 11px muted 仍偏吃力。见 §11。**中。**

---

## 8. §9 AI TELLS（禁用模式全扫）

### §9.A Visual & CSS
- 无 neon/outer glow、无纯黑 `#000`（off-black slate-950/#0d1526）、无过饱和、无渐变大字、无自定义光标。✅

### §9.B Typography
- 非 Inter；无超大 H1 硬撑（层级靠字重+色）；无 dashboard 上塞衬线。✅

### §9.C Layout & Spacing
- 数学规整（4px 阶梯，有测试断言"全是 4 的倍数"）；无"三张等大功能卡"。✅

### §9.D Content & Data（"Jane Doe" 效应）
- 无泛用名、无泛用头像（邮箱首字母）、无假精确数、无"Acme/SmartFlow"、无"Elevate/Seamless"填充动词。✅

### §9.E External Resources & Components
- 图标全部来自单一库（Lucide，项目已选定 → skill §3.C 覆盖路径成立）；无手搓 SVG 图标；无 div 假截图；未用 shadcn 默认态。✅

### §9.F Production-Test Tells
- 版本标签 hero / `No.01` 副 eyebrow / section-number eyebrow / 图片上 `01/4` 分页 / `Scroll·001` 提示 —— **全 N/A 且未出现**。✅
- **middle-dot（`·`）**：PasskeyPanel（`:317`）、SessionsPanel（`:245`）元信息行各用**一枚** `{' · '}` 分隔"创建于/上次使用"——符合"每行元数据 ≤1 枚"。✅
- **装饰性状态彩点**：`.ht-settings__sub-dot`（订阅状态）确有彩点，但它**承载真实语义**（ok/warn/unknown）且**同屏有文字**（`sheets.css:768` 注释引 WCAG），skill §9.F 明说"承载真实语义状态时可接受"。✅
- 假版本 footer / 假产品预览 / "Quietly trusted by" / "Field notes" / 天气时区条 / eyebrow 下的 micro-meta 句 —— 均未出现。✅

### §9.G EM-DASH BAN（唯一实质红项，但需语境打折）
- **字面判：FAIL。** 可见文案里 em-dash 大量存在：
  - 英文消息串：`en.ts:80`（`...not in the cloud — retrying...`）、`:86`、`:97`、`:629`、`:634`、`:678`、`:245`、`:251`、`:273`、`:320` 等，以及 `landing.*` 若干。
  - 中文消息串：`zh-CN.ts:90`（`...同步已停止 —— heyta 不会...`）、`:96`、`:107`、`:92`、`:93`、`:94`、`:95` 等（全角 `——`）。
- **语境打折（重要，不能盲从 skill）**：
  1. taste-skill 的 §9.G 是**英文排版风格律**（治的是 LLM 英文营销腔里"用 em-dash 装深沉"）。**在中文里 `——` 是标准破折号**，是正确标点，不是 AI tell。按字面去删中文破折号会**损害中文可读性**。
  2. 真正的 skill 违规在**英文可见串**：`en.ts:80/86/97/629/634/678` 这些**用户会看到**的错误/提示句用了 `—`。若要 honor §9.G，应改这几处英文（改句号/分号/逗号），**不是**改中文。
- 判定：**中文——不判红（语境）；英文可见串的 em-dash 判"低"**（数量不大，属打磨项）。

---

## 9. §14 Final Pre-Flight Check（逐格诚实打勾）

图例：✅ 通过 / ⛔ 违规 / ➖ 本页 N/A / 🟡 通过但有打磨项

| # | 检查项 | 结果 | 依据 |
|---|---|---|---|
| 1 | Brief inference 一句话声明（§0.B） | ✅ | 本报告 §0 |
| 2 | Dial 值明确且由 brief 推导 | ✅ | §2：2/2/5（设置专用档，非默认 8/6/4） |
| 3 | 设计系统选型/诚实标注 | ✅ | §3：自建 token 系统，own 组件，非复刻官方包 |
| 4 | Redesign 模式与审计（§11） | ✅ | 本轮即"先审计后动"，preserve 既有品牌 |
| 5 | 页面零 em-dash（§9.G） | ⛔/🟡 | 英文可见串有 `—`（低）；中文 `——` 属正确标点，不判红 |
| 6 | Page Theme Lock | ✅✅ | §4.11，全局单主题，双模式独立调值 |
| 7 | Color Consistency Lock | ✅ | §4.2，全页单蓝 |
| 8 | Shape Consistency Lock | 🟡 | §4.4，radius 有分档规则，但"卡片层"半径 8/12 未统一 |
| 9 | Button Contrast Check（AA） | ✅✅ | `tokens.spec.ts` 实算 `AA_PAIRS` |
| 10 | CTA Button Wrap | ✅ | `.ht-btn white-space:nowrap` |
| 11 | Form Contrast Check | ✅ | 卡内 input 凹陷底 + 占位符（已修） |
| 12 | Serif discipline | ➖/✅ | 无衬线 |
| 13 | Premium-consumer palette check | ➖ | 非该 brief；且用冷灰+单蓝正是推荐路线 |
| 14 | Italic descender clearance | ➖ | 无斜体大字 |
| 15 | Hero fits viewport | ➖ | N/A（设置页无 hero） |
| 16 | Hero top padding cap | ➖ | N/A |
| 17 | Hero stack discipline | ➖ | N/A |
| 18 | Eyebrow count（机械计数） | ➖/✅ | 无 uppercase-tracking eyebrow |
| 19 | Split-Header ban | ➖ | N/A（landing 规则） |
| 20 | Zigzag alternation cap | ➖ | N/A |
| 21 | No duplicate CTA intent | ✅ | 动作名不重复 |
| 22 | Logo wall = logo only | ➖ | N/A |
| 23 | Bento background diversity | ➖ | N/A |
| 24 | "Used by" 在 hero 下、真 SVG logo | ➖ | N/A |
| 25 | Copy self-audit（无语法断裂/幻觉） | ✅ | 中文功能型、地道、有门禁 |
| 26 | Motion motivated | ✅ | 仅入场+按压，皆有因 |
| 27 | Marquee max-one-per-page | ➖ | N/A |
| 28 | Nav 单行 & 高 ≤80px | ✅ | 左栏目录，窄屏横向滚动 |
| 29 | Section-layout-repetition | 🟡 | 反向问题：布局家族**过多**（见 §11） |
| 30 | Bento 有节奏且格数=内容数 | ➖ | N/A |
| 31 | 长列表用对 UI 组件 | 🟡 | 分隔行在 product UI 正当；但见 §11 字号承载 |
| 32 | 真图片（无 div 假截图） | ➖/✅ | N/A；且无假截图 |
| 33 | 无图片上叠 pill/label | ➖ | N/A |
| 34 | 无摄影署名当装饰 | ➖ | N/A |
| 35 | 无版本 footer（营销页） | ✅ | 关于页印的是真实备案号（合法非装饰） |
| 36 | 无 eyebrow 下 micro-meta 句 | ✅ | 说明一律进 `?` |
| 37 | 无 hero 底部装饰字条 | ➖ | N/A |
| 38 | 无 section 右上浮小字 | ✅ | 说明走 `?`，不浮角落 |
| 39 | 无进度条带填充底轨当对比 | ✅ | 未见 |
| 40 | 无 locale/城市/时间/天气条 | ✅ | 未见 |
| 41 | 无 scroll cue | ✅ | 未见 |
| 42 | 无 hero 版本标签（非发布 brief） | ✅ | 未见 |
| 43 | 无 section-number eyebrow | ✅ | 未见 |
| 44 | 无装饰性彩点 | ✅ | 仅订阅状态点，承载真实语义+有文字 |
| 45 | 长表每行 border-t+border-b | 🟡 | 行式分隔在 product UI 正当（§13 排除），非 marketing 判红 |
| 46 | 内容密度合理（≤25 词子段） | ✅ | 本地优先设置，密度可控；无 20 行 dump |
| 47 | Quotes ≤3 行/无 em-dash | ➖ | N/A |
| 48 | Motion claimed=shown（>4 才需动） | ➖ | Dial=2，静态即正确 |
| 49 | GSAP sticky/pan 正典写法 | ➖ | N/A |
| 50 | 无 `addEventListener('scroll')` | ✅ | 未见；用 CSS 动画/定时器 |
| 51 | >3 动效包 reduced-motion | ✅✅ | 全局时长压 1ms |
| 52 | 暗色 token 定义并双模测试 | ✅✅ | `tokens.spec.ts` 实算双模对比 |
| 53 | 高变化布局显式塌缩 | ✅ | 各节 < 48/64rem 显式单列 |
| 54 | Viewport 稳定（`min-h:100dvh` 非 h-screen） | ✅ | sheet 用 `inset:0`+`overflow-y`，非 h-screen |
| 55 | `useEffect` 动效有 cleanup | ✅ | 定时器 `clearInterval`/`clearTimeout` 齐全 |
| 56 | 空/加载/错误态齐备 | ✅✅ | 全面板实现，且空态走共享 `EmptyState` |
| 57 | 能用间距就不用卡片 | 🟡 | 已大量降级为发丝线子块；仍见半径不统一 |
| 58 | 图标只用允许库、无手搓 SVG | ✅ | Lucide 单族（项目选定=覆盖） |
| 59 | 动效隔离在 client leaf + memo | ✅ | 纯 CSS 动效，无 JS 动效泄漏 |
| 60 | 无 §9 AI tells | 🟡 | 仅英文 em-dash 一处族 |
| 61 | Core Web Vitals 可达 | ✅ | SPA 浮层，token 化 CSS，无重资源 |
| 62 | 单一设计系统（不混 Material+shadcn） | ✅ | 仅 `@heyta/*` |

**通过 33 项 / N/A 18 项 / 打磨项(🟡) 7 项 / 字面红(⛔) 1 项（英文 em-dash，判低）**。

---

## 10. 整体设计品味裁决：它让用户觉得"烂"的是什么？

**先破一个误解：这屏不"烂"在廉价/AI 味。** 从代码看它比绝大多数 LLM 生成的界面更自律：token 唯一事实源、对比度实算、暗色非反相、z 轴成阶、reduced-motion 全局、空/错/加载齐态、说明进 `?` 且 `aria-describedby` 常驻 DOM（键盘+读屏都拿得到）。这些都是"专业"的硬证据。

用户仍会觉得"差一口气"的，是**三处非 slop 的不整齐**：

### (1) 过度治理：可见引导≈0（高）
产品负责人 2026-10-24 的禁令「严禁说明文字，只准问号 hover」被**逐面板执行到极致**——ProfilePanel、PasskeyPanel、PasswordPanel、EmailChangePanel、AiSettings、DataSettings、HelpPanel、App.tsx 显示组，全都把 lead/hint 塞进 `SettingsInfoTip`。
后果：一屏"看起来什么都没解释"。第一次配置 AI 出境、密码后果、注销代价的用户，必须**逐格 hover 一枚 11px 的 `CircleHelp`** 才敢动手。把"说明书病"治成了"空心病"。
> taste-skill §4.6 是「helper text 可选但要在 markup 里」——heyta 做到了 markup 里有，但**视觉呈现上收了过头**。真正该有的是：一屏**至多一句**"当下必须知道"的可见提示（如 ProfilePanel 文件头自己写的"只留一眼要用那一句"），其余才进 `?`。现在很多面板一句都不留。

### (2) 行语法不统一（中）
同一屏并存 ≥5 套"设置行"解剖：
- ProfilePanel：两列 `__row`（标签左/控件右，grid）
- Passkey/Sessions/Password：堆叠 `__section`（标题 + 动作区，flex column）
- AiSettings：`--cards`（面板透明 + 一列卡）
- DataSettings：`__data-card`（带 header 的卡）
- Privacy：`fieldset`/`legend`
它们**标题层级不同**（`__title` vs `__h3` vs `__data-card-title`）、**圆角不同**（8/12）、**分隔不同**（发丝线/卡间距/无）。这正是 2026-10-24「排版混乱」还没收干净的部分——AI 面板里那句"每一行都是 `☐ 标签`，而显示那一屏是 `标签 …… 控件`，一屏两套语法"（`ai-panels.css:1368`）的批评**同样适用于跨面板**。

### (3) 字号/颜色压到自己地板以下（中）
11px（2xs）出现 18 次且承载真消息（回执、警告、日期、标签），配 muted/subtle；`__warn` 还用了 `danger` 普通档而非 `danger-strong`。设置页信息密不等于要把**要读的字**做小做灰。skill §4.5 FORM CONTRAST 精神 + MASTER §4 地板条款在这里是**自相冲突**的（项目自己定的下限被自己项目里的用量突破）。

**专业感 vs 业余感**：配色/阴影/可达性/暗色/状态覆盖 = **专业**；治理与一致性（说明收过头、行语法五套、小字号滥用）= **像"各自为政、还没开过一次统一的设置页评审"**。这两者并存，恰恰说明它不是 AI 一把梭生成，而是**多批次、多负责人指令、逐条实拍纠偏**长出来的——每块单看都对，合看没统一。

---

## 11. 具体改进建议（按性价比排序）

1. **统一"设置行语法"到一套**（对应 (2)，收益最大）：定义一个 `<SettingsRow>` 骨架（label 列 + control 列 + 可选 `?` + 状态槽），让 Profile/Password/EmailChange/Data/Privacy 全部走它；Passkey/Sessions 的"列表项卡"定义为另一**唯一**的 `<SettingsListRow>` 家族。**同屏最多两套行解剖**（日常项 = 行；集合项 = 列表卡）。把 `__section`/`__data-card`/`__danger-card`/fieldset 的圆角**并到同一档**（建议统一 `lg`=12 或统一 `md`=8，二选一并处处遵循，满足 §4.4 Shape Lock）。

2. **解禁"一句可见提示"**（对应 (1)）：给每个面板**至多一句**、放在标题下的 `xs`(12px) 可见 helper，专门承载"此刻必须知道才能动手"的事实（例：AI 出境=内容会离开本机；改密=其它设备需重登；注销=连本机未同步数据一起删且不可撤销）。背景知识/次要解释**才**进 `?`。判据可仿 `check:settings-prose`，改成"每面板允许 ≤1 条内联短 helper，长句仍禁"。

3. **把承载消息的字号从 2xs 提到 xs(12px)**（对应 (3)）：`__notice`/`__warn`/`__item-sub`/`__credential-meta` 用 `xs`；`2xs` 只留给真正的极紧标签（chip 计数、`(可选)` 这种）。`__warn`/小字号危险文字改 `danger-strong`（MASTER §3.1 本就要求）。

4. **英文可见串消 em-dash**（唯一字面 §9.G 红项，低）：把 `en.ts` 里 `... — ...` 的用户可见句改句号/分号/逗号。中文 `——` **保留**（正确标点，别被 skill 带偏）。

5. **内联样式收编**（低）：`AiSettings.tsx:753` 的 fieldset 内联 reset 改用既有 `.ht-settings__field` 类，呼应 `check:l4`。

6. **（可选）列表加载用形状骨架**：Passkey/Sessions 目前用纯文本"正在加载…"。skill §4.5 倾向"骨架匹配最终形状"。这里文本态其实够用、且不误导（不像假骨架），**优先级最低**，若要打磨可上 3 行 `__credential` 形状的 skeleton。

---

## 12. 根因：是 skill 方法论缺失，还是执行？

**主要是执行/治理层，不是 skill 缺失。** 拆开看：

- **taste-skill 对本页的相关性 ≈ 40%**：它 §13 亲自宣布 dense product UI out of scope。适用子集里，heyta 在**可达性、暗色、对比度、token 纪律、状态覆盖、AI-tell 规避**上不是"缺失"而是**超出** skill 的最低要求（对比度实算、暗色非反相、说明 aria 常驻 DOM——skill 都没要求到这么细）。
- **真正让界面"差一口气"的三条（说明收过头 / 行语法五套 / 小字号滥用）taste-skill 一条都救不了**：
  - 行语法不统一是**架构/组件契约**问题（没有单一 `SettingsRow`），要靠仓库自己的 design-system 治理 + 一次跨面板评审解决；
  - 说明收过头是**产品负责人指令**的直接后果——是治理决策，不是 agent 缺审美；
  - 小字号滥用是**token 用量纪律**问题（地板条款被突破），要靠加一条"可见消息不得用 2xs"的门禁（类似 `check:settings-prose`）来兜，而 skill 不含这种细粒度门禁。
- **skill 唯一真能贡献的一条**：把 §9.G em-dash 律**正确地限定到英文串**（并明确豁免中文破折号），以及把 §4.4 Shape Lock/§4.5 状态态/§4.6 表单三律作为**跨面板一致性 checklist**——但这需要先把 skill 改写成"product UI 版"，否则它对设置页基本是"多数判 N/A"。

**一句话根因**：这不是"没人用审美 skill"导致的 slop，而是"审美 skill 本就管不到设置页，而设置页缺的是**一套被逐面板强制执行的行语法 + 一句可见提示的解禁 + 小字号用量纪律**"。解药在仓库的 design-system 治理层（新增 `SettingsRow` 契约、`check:settings-prose` 的"每屏 ≤1 条可见 helper"档、"可见消息禁 2xs"门禁），不在 taste-skill。

---

## 13. 附：证据索引（绝对路径）

- 面板：`/Users/rocalight/Desktop/All in one Data/01_PROJECTS/heyta/apps/web/src/features/settings/{ProfilePanel,EmailChangePanel,PasskeyPanel,PasswordPanel,SessionsPanel,CloseAccountPanel,AiSettings,DataSettingsPanel,PrivacyPanel,HelpPanel,SettingsInfoTip}.tsx`
- 样式：`/Users/rocalight/Desktop/All in one Data/01_PROJECTS/heyta/apps/web/src/styles/app/{controls.css,sheets.css,settings-account.css,ai-panels.css}.css`；`/Users/rocalight/Desktop/All in one Data/01_PROJECTS/heyta/apps/web/src/features/settings/ai-settings.css`
- 事实源：`/Users/rocalight/Desktop/All in one Data/01_PROJECTS/heyta/packages/design-system/src/tokens.css`；`/Users/rocalight/Desktop/All in one Data/01_PROJECTS/heyta/design-system/heyta/MASTER.md`
- 渲染装配：`/Users/rocalight/Desktop/All in one Data/01_PROJECTS/heyta/apps/web/src/App.tsx`（设置浮层 §3345–3750）
- 文案：`/Users/rocalight/Desktop/All in one Data/01_PROJECTS/heyta/packages/i18n/src/locales/{en.ts,zh-CN.ts}`（em-dash 证据）
- 方法论：`/Users/rocalight/.agents/skills/design-taste-frontend/SKILL.md`
