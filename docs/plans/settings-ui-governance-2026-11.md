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
| 手写行解剖的 web 设置文件 | 13 个（处数只由复量命令给） | `node scripts/check-settings-row-anatomy.mjs` |
| 已用共享契约的 web 面板 | 4 个 | `grep -rln 'SettingsSection' apps/web/src/features/settings` |
| 契约现有行档 | 6 档（`value`/`toggle`/`action`/`trailing`/`note`/`heading`） | `model.ts` 的 `SettingsRowModel` 联合 |

#### 迁移那一半：方向已找对，五格已迁（2026-11-04 二次复核推翻本节上一稿）

上一稿写"迁面板不可行，因为契约装不下"—— 那是**只扫了 `SettingsRowModel` 一份契约**
就下的结论。仓里另有一套**并列**的表单解剖，字段本来就该走它而不是走 rows：

| 层 | 位置 |
|---|---|
| 唯一那份判断 | `packages/ui/src/form/anatomy.ts`（`resolveFieldChrome` / `fieldDescribedById`），两端共用 |
| web 渲染器 | `apps/web/src/lib/form/FormField.tsx` + `apps/web/src/styles/app/form.css` |
| 门 | `pnpm check:form-anatomy`（R1 手写字段标签只减不增；R2 `.ht-input-field*` 只在 `form.css` 定义） |
| 两档解剖 | `stacked`（表单页）/ `inline`（设置·属性面板），`docs/agents/ux-principles.md` §1：**两档之外不许有第三档** |

`FormField` 的 props 注释自己写着「缺省 stacked。**设置/属性面板显式写 inline**」和
「`htmlFor` / `id` 都从它来，**全仓不许再手拼字符串 id**」—— 后者正是这几格原本的形状。
所以"要不要迁"不是取向题，口径早就成文，不该回抛给产品。

**已迁（每格都跑 `check:ui-language` + typecheck + 相关 spec）**：

| 格 | 之前 | 之后 | 验证 |
|---|---|---|---|
| ProfilePanel 昵称 | 手写 `<label htmlFor>` + 手拼 `id="profile-nickname"` | `FormField layout="inline"`，`?` 走新增的 `labelTip` | `profile-panel.spec.tsx` 18/18；行解剖账本 **54 → 53** |
| EmailChangePanel 新地址 | 手写 label + 手拼 id | `FormField layout="inline"` | `account-security.spec.tsx` 42/42 |
| PasskeyPanel 改名 | 上一轮我手加的 label + 手拼 id | `FormField layout="inline"` | `passkey-panel.spec.tsx` 全绿 |
| PasswordPanel 口令格 | 手写 `__field` + `<label htmlFor>`，**且 `?` 套在 label 里面** | `FormField layout="inline"` + `labelTip` | `account-security.spec.tsx` 42/42 |
| SessionsPanel 会话行 | 手写 `__section __credential` + `__credential-main` | `SettingsRowModel` 的**新增 `trailing` 档**（`SettingsSection` + `HeytaUiProvider`） | `account-security.spec.tsx` 42/42；行解剖账本 **53 → 50** |
| PasskeyPanel 凭证行 | 同上那一套手搓容器（改名时整行换成输入框） | 同一 `trailing` 档：`label` 走 `passkey.name ?? undefined`（没名字**不画那一格**），`actions` 是"编辑中 = `FormField` / 否则 = 改名·删除按钮"的三元 | `passkey-panel.spec.tsx` 23/23（含 `passkey-row-*` 的 textContent 断言）；账本 **50 → 47** |

最后一格顺带修掉一个真隐患：`SettingsInfoTip` 渲染的是 `<button>`，原来它落在
`<label htmlFor={id}>` **内部** —— 点问号会顺带把焦点甩进口令框。`labelTip` 把它画成
标签的兄弟（读 `FormField.tsx:145-160` 可核：`labelCell` 与 `labelTip` 并列在 `__labelcell` 下）。

`labelTip` 是这次给原语补的能力：解剖规则要求「一枚 `?` 紧跟它所解释的标签」，
而 `FormField.label` 只吃 `string`。它是标签的**兄弟**而不是 `<label>` 后代 ——
`SettingsInfoTip` 渲染 `<button>`，套进 label 会让点问号顺带把焦点甩进输入框。
只在给了 tip 时才多包一层 `__labelcell`，既有调用点（AI 端点那三行）DOM 逐字不变。
该断言的牙也实测过：把 `?` 挪回值那一列 ⇒ `profile-panel.spec.tsx` 精确报红。

**`trailing` 档是这次给契约补的行档**（`packages/ui/src/settings/model.ts` + `Settings.tsx` 的 `TrailingLine`）：
"一个对象（一台设备）带几行事实 + 一个只对得起它的尾随动作"这一族，原来五档都装不下 ——
`action` 档让**整行**可点，会把"选中这行"与"撤销这台设备"混成同一个手势，而那两者代价完全不同。
所以它是**新增的一档**，不是把 SessionsPanel 硬塞进 `action`。

它是**纯追加**：`pnpm --filter @heyta/ui typecheck` 与 `pnpm --filter @heyta/mobile typecheck`
（后者跑的是**未改动**的 mobile 消费者）均 rc=0；`SettingsRow` 里的 `never` 穷尽自检保证
新档没被渲染时是**编译期报错**，不是静默少画一行。

**这五格迁移有一处看得见的影响，先记下来，不等看图来发现**：`trailing` 档把行交给共享列表渲染，
所以原来那一层 `.ht-settings__section`（`padding: space-3` = 16，且相邻两块之间有 `border-block-start` 细线，
见 `ai-panels.css:261` 与 `sheets.css:183`）在**行**这一级没有了 ⇒ 设备/凭据两屏从"每张卡 16 内边距 + 卡间一条线"
变成"一行接一行、行间距 `space.2`(8)"。方向与 `docs/agents/ux-principles.md` §1 那条
「inline 档行距可压到 44+8」是同向的（原来那 16+16 让两行块距 ≈ 72，反而超出该档），
但**这是一次外观变更，不是纯结构收敛** —— 结论要等一次真看图（1440 亮/暗）才算验收，
在那之前不许写"外观未变"。

**还剩（这一格没做，理由不是"来不及"）**：
`apps/mobile/src/screens/SessionsSection.tsx` 仍自己手搓同一形状（`Pressable` + 尾随按钮）。
迁移它需要**设备腿取证**，而这一趟没有跑：Android 载体不在本机（见 `docs/agents/multi-end-build.md`），
iOS 那枚 booted 模拟器现在可能被别线占着（`xcrun simctl list devices booted | grep -c Booted` 现量 1），
按 `ui-acceptance` 的口径**不抢别人的设备、也不许没真看图就宣布"两端一致"**。
契约已经就位，那一格现在只欠一次设备验证，不欠设计。

**顺带现量到一个门禁的边界**（不是本次引入的，但这次撞上了）：`check-ui-provider` 按**文件**近似
（脚本自己写着"不覆盖①"）。变异实测：拆掉 `SessionsPanel.tsx` 里包 `<SettingsSection>` 的那层
`HeytaUiProvider` 后 `node scripts/check-ui-provider.mjs` **仍 rc=0**，红的是
`tests/account-security.spec.tsx`（8 条抛 `useHeytaUiTheme 必须在 <HeytaUiProvider> 内使用`）。
⇒ 这一处守住 Provider 的是**测试**，不是那把尺；`packages/ui` 里"放在 Provider 之外会红"那句
（`grep -c '会红.*指名文件与行号' packages/ui/src/index.ts` 现量）在**同文件另有 Provider 子树**时不成立，
已在 settings 那一块改成带边界的写法；其余几块同句未逐枚复测，**没顺手改**（改一句判据口径要一枚一测）。

#### 本节两处误判与一处我自己引入的缺陷（都已更正，原论证保留在 git 历史里）

| 项 | 复核结论 |
|---|---|
| 「五档装不下输入框+按钮 ⇒ 迁移不可行」 | ✗ 问错了问题。字段走 `FormField`，不走 `SettingsRow`。 |
| 「圆角 8/12 来回是漂移」 | ✗ 逐类现量：`__section`/`__field`/`__danger-card`/`__account-gate` 全是 `radius-md`(8)，只有 `__notice` 是 `radius-sm`(4)（行内提示条不是卡片）；外层面板卡 `lg`(12) 是 MASTER 成文分档。**不是漂移，不立项**。 |
| HIGH-9「日期三套口径统一」 | ✗ **我引入的缺陷，已回退**。`PasskeyPanel` 的 ISO 与 `PrivacyPanel` 的 UTC 都是**有记录、有源码级门保护**的刻意决策（`privacy-consent.spec.ts` 明令不许改成 `Intl`/`toLocaleString`，理由含 Hermes 的 `Intl` 可选编译会直接抛 ⇒ 设置页整页打不开）；真实分母是 `apps/web` 里 **13 处**不是 3 处。改完 `passkey-panel.spec.tsx` 两条当场红，正是那条"测试会对时区/ICU 敏感"的理由被实测兑现。详见 `audit-ui-ux-pro-max-2026-11-04.md` H-3 的复核更正。 |

**那"行解剖不统一"这个真问题归谁？** 归已经落地的门 + 上面那张迁移表，不归"把 rows 硬塞字段"：

| 真问题 | 处置 |
|---|---|
| 13 个文件各写一套容器，可能长出第 6 套 | ✅ `check-settings-row-anatomy.mjs` 账本制冻结，新增即红，变异臂实测能红；账本逐格只减（`--update` 只许改小） |
| 字段格手写 label + 手拼 id | ✅ 四格已迁 `FormField`（ProfilePanel / EmailChangePanel / PasskeyPanel / PasswordPanel） |
| 对象行（设备 / 凭证）各写一套尾随动作骨架 | ✅ `SettingsRowModel` 加 `trailing` 档，web 的 SessionsPanel 已迁；mobile 的 `SessionsSection.tsx` 欠一次设备腿 |

**优先级**: 门 ✅；迁移 ✅ 五格已落地（四格字段 + 一格行）。剩 mobile 那一格，欠的是设备验证而不是设计。

---

### G-5 动效表征一等公民

**目标**: 状态表征（busy/done/error）必须有视觉动效，不能只靠文字。

**规则**:
- 所有 `<Loader2>` 必须带 `className="ht-settings__busy"`（挂在 `.ht-settings` 这一族里，**不自成一族** —— 原先那枚 `.ht-spin` 被 `check:row-single-source` 的"前缀族只减不增"棘轮抓红，2026-11-04 收编）
- 所有浮层/sheet 必须有对称的进出动画
- 门禁：grep `<Loader2` 不带 `ht-settings__busy` 即红

**优先级**: 中（F-01 类缺陷的防回归）

---

### G-6 产品禁令校准 —— 原前提被现量否证，不需要人拍板

**原写法是错的**。本节原先记着「"严禁说明文字只准问号"执行过头，整屏可见引导≈0，
需产品负责人拍板放宽」。回源码逐条量过之后，两句话都不成立：

**1. 那条禁令本来就带三条例外，而且明写"删掉解释不算违规"。**
真身在 `docs/agents/design-system.md` 那一节「🔴 设置界面里**禁止**写说明文字」（定位：
`grep -n "禁止.*写说明文字" docs/agents/design-system.md`；不复述行号 —— 那一句被引用时行号已经漂了）：

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
| 同屏 13 个文件各写一套行解剖容器（处数只由 `node scripts/check-settings-row-anatomy.mjs` 给） | G-4：门已落地冻结新增（圆角那条经复核**不是**漂移，见 G-4 节表格） |

**优先级**: ✅ 关闭（前提否证，无待决）

**关闭之后又抓到一条同类缺陷（已改，2026-11-04）**：规则文件里"合法载体"那张表的 mobile 那一行
写着「`InfoTip` ⚠️ 尚未建」。共享层那份 `SettingsInfoTip` 一直在被移动端调用
（现量：`grep -rn "SettingsInfoTip" apps/mobile/src`）。禁令的**豁免与载体**是同一份口径的两半，
载体那半写错会让人以为移动端可以内联说明 —— 已按现量改写，并在下面留了一句"别读这句话，读调用点"。

---

## 执行节奏

| 周次 | 做什么 | 状态 |
|---|---|---|
| W1（本轮） | G-1 + G-2 落地为门禁 | ✅ G-1 账本清空、A4 硬拒；✅ G-2 静态 CSS 臂（`check-font-size-discipline.mjs`） |
| W1（本轮） | G-3 + G-5 落地为门禁 | ✅ G-3 `check-font-size-discipline.mjs`；✅ G-5 `check-spinner-discipline.mjs`（均带变异臂实测能红） |
| W1（本轮） | G-4「新面板强制使用」那一半 | ✅ `check-settings-row-anatomy.mjs` 账本制 + 变异臂能红 |
| W1（本轮） | G-4 迁移那一半 | ✅ 四格字段迁 `FormField`（ProfilePanel 昵称 / EmailChangePanel / PasskeyPanel 改名 / PasswordPanel 口令）+ 一格行迁 `trailing` 档（SessionsPanel）；账本两次收缩（54→53→50） |
| W2 | G-4 的 mobile 那一格 | ⏸ `apps/mobile/src/screens/SessionsSection.tsx` 改吃 `trailing` 档：契约已就位，欠一次设备腿（Android 载体在 linux-dev，iOS 那枚可能被别线占） |
| — | G-6 禁令校准 | ✅ 关闭：前提被现量否证，无需产品拍板（见该节） |

---

## 验证方式

每条新门禁必须：
1. 在违规输入下真的会红（AGENTS §6 第 2 条）
2. 有变异臂（临时注入违规 → 门禁红 → 撤销 → 门禁绿）
3. 写进 `docs/agents/commands.md` 的 `verify:*` 列表
4. **接进 `pnpm check` 链** —— 这一条本轮补上，而且它是被仓里现成的尺抓出来的：
   `pnpm check:gate-wiring` 在接链前 **rc=1**，逐条点名三枚门禁实现（覆盖 G-2/G-3/G-4/G-5 四项，
   G-2 与 G-3 同住在 `check-font-size-discipline.mjs` 里）
   「没有任何 package.json 定义引用它 ⇒ 0 次执行，而链照样绿」。
   ⇒ 前 3 条只保证"这把尺能量"，第 4 条才保证"有人踩上去"。三枚现已各有
   `pnpm check:{spinner-discipline,font-size-discipline,settings-row-anatomy}` 定义并进链
   （G-1 那枚本来就接在 `check:control-semantics` 里），`check:gate-wiring` 现量 rc=0。
