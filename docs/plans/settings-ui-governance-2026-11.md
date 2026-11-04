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
| 契约现有行档 | 7 档（`value`/`toggle`/`action`/`trailing`/`host`/`note`/`heading`） | `grep -c "^  | Settings" packages/ui/src/settings/model.ts` |

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
| **mobile** `SessionsSection` 会话行（2026-11-05，授权改锚后） | 手搓 `Stack` + `Divider` + `HStack` 标签行 / 时间戳行 / 按钮行 | 同一 `trailing` 档；读失败那一句走 `host`（要保住 `selectable` 与"在列表上面"的位置） | `@heyta/mobile` 101 个测试文件全过、`account-security-wiring` 20/20、18 枚静态门 rc=0；⚠️ **真机像素那一枪仍欠**，现量与谁能补写在 BLOCKED B260 追记二 |

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

**这五格迁移有一处看得见的影响**：`trailing` 档把行交给共享列表渲染，
所以原来那一层 `.ht-settings__section`（`padding: space-3` = 16，且相邻两块之间有 `border-block-start` 细线，
见 `ai-panels.css:261` 与 `sheets.css:183`）在**行**这一级没有了 ⇒ 设备/凭据两屏从"每张卡 16 内边距 + 卡间一条线"
变成"一行接一行、行间距 `space.2`(8)"。方向与 `docs/agents/ux-principles.md` §1 那条
「inline 档行距可压到 44+8」同向（原来那 16+16 让两行块距 ≈ 72，反而超出该档）。

**看图腿已补（2026-11-04，真浏览器，不是断言级）**：
`HEYTA_E2E_APP_PORT=4418 HEYTA_E2E_STUB_PORT=4419 pnpm --dir e2e exec playwright test tests/account-email-change-and-sessions.spec.ts`
⇒ 7 passed，图落在受版本控制的 `apps/web/evidence/account-suite/`，逐张看过。
**它抓到三处，全修了**（前两处是本线迁移带出来的，第三处是 `b503a62ac` 留下的）：

| 截图里看到的 | 成因 | 处置 |
|---|---|---|
| 昵称那一格：输入框占满整格，「保存昵称」掉到**第二行** | 原语 `.ht-input-field__control :is(input) { inline-size: 100% }` 把控件撑满，而调用点用的是宿主的 `__actions`（还带 `flex-wrap: wrap`） | form.css 新增 `.ht-input-field__fieldrow`（控件吃剩余宽、动作按内容宽）。**不复用 `__pair`**：那一档的两个成员都是控件（4fr/6fr），这里第二个是动作 |
| 会话/凭据行：右侧那枚按钮贴着**第一行**，而左边文字块有四行 | 共享行容器 `alignItems: flex-start`（那是给"标签 + `?` 气泡"那一族定的，改 center 会连带动到移动端两屏，而本机没有移动端看图腿） | web 侧加 `.ht-settings__actions--centered`（`align-self: center`），共享层不动 |
| 「修改密码 / 忘记密码?」落在**标签列**左缘（x≈440），而它上面的输入框在 x≈590；后果说明那枚 `?` 单独占一行、没有归属 | 动作块不在字段网格里；而那句 `?` 的注释自己写着"按钮旁"，代码却把它排在段落之后（`b503a62ac` 起就在，本批只是被截图抓到） | form.css 新增 `.ht-input-field__actions`（起点由原语自己的两列算出：label 列 + 列间距），并把两枚后果 `?` 移进动作块 |

修后读数：4 枚设置 spec **118/118**、`form-anatomy`/`design`/`settings-prose`/`ui-language`/`overlay`/`settings-row-anatomy` 全 rc=0、
上面那支 e2e 7/7，两张关键图（`01-before-request` / `08-password-before-submit`）逐张重看确认。
⚠️ **四象限的现量分布（别把这行读成"都看过了"）**：
**四格现在由同一条用例各量一遍**（`account-email-change-and-sessions.spec.ts` 的「四象限看图腿」，
亮/暗 × 1440/375，八张图 12–19 全部受版本控制）。此前这一行是**三个不同批次、三个不同场景**
拼出来的读数（1440 亮 = 上一批账号套图；375 亮 = `narrow-settings.png` 那个别的场景；暗色 = 没做），
那种拼法的问题不是"漏了一格"，而是**四格量的不是同一件事** —— 现在四格用同一套尺子。

**这一行原来还写着两句错的判断，都被现量否证**（留着是因为它们是同族教训，不是结论）：

1. ~~"暗色这一格本线的现量是没有新增颜色字面量"~~ —— 那是**间接**证据。它否证不了"暗色下画不出来"，
   而暗色真正会出的事故（文字与底同色）恰恰不动任何字面量。现在这一条改由 e2e 直接判亮度差。
2. ~~"`settings-row-grammar` 这类 e2e 一枚都不在 `pnpm check` 链里，新建的暗色 spec 同样会 0 次执行"~~ ——
   这句是**按别名名字去 grep** 读出来的，而链里那枚 `check:ai-e2e` 跑的是 `pnpm --dir e2e run test`
   （默认 `playwright.config.ts`，`testDir: ./tests`）。现量：`pnpm --dir e2e exec playwright test --list`
   ⇒ 总数 **510 条 / 134 个文件**（本线那条四象限进去之后同一趟读到 512 —— **这个数每批都会动，要现量别抄这里**：
   `pnpm --dir e2e exec playwright test --list | tail -1`），其中 `settings-row-grammar` 7 条、
   `settings-form-alignment` 2 条、`narrow-sweep` 10 条、`theme-switch-contrast` 1 条、
   `account-email-change-and-sessions` 7 条（本线那条进去后是 8 条）。
   逐枚复量：`pnpm --dir e2e exec playwright test --list | grep -c "› <文件名>"`。
   **所以这一族不需要新的接线，也不需要谁裁决"哪条 check 跑 e2e"** —— 写新 spec 就自动有人跑。
   教训与 `docs/agents/` 那条"一把尺在某处读 0，只说明它扫的那套写法里没有"是同一件事：
   这次扫的是**别名名字**，而消费方是**整条 e2e 套**。

**常驻四象限看图腿（2026-11-04 补，`account-email-change-and-sessions.spec.ts` 第 8 条）**：
一条用例跑**亮/暗 × 1440/375 四格**，每格把迁进共享契约的三格（`profile-avatar-row` /
`profile-nickname-row` / `profile-email-row`）与会话面板各拍一张，八张图（编号 12–19）落在受版本控制的
`apps/web/evidence/account-suite/`。判据不是只有图：

| 判据 | 为什么这条必须能红 | 现量 |
|---|---|---|
| 三格行容器**左缘唯一、宽度唯一** | 本批把三格交给同一个列表渲染；两列网格与 `FormField` 网格混用时左缘会散（1440 亮档那三处缺陷就是这么抓到的） | 两档都过 |
| 行不许越过浮层右缘 | 窄档溢出只会出现在 375，亮色 1440 那趟看不见 | 两档都过 |
| 文字与底的**亮度差方向**要对（暗色文字更亮、亮色文字更暗，WCAG 相对亮度差 >0.1） | 这一条抓的是"文字与底同色"那一类事故，而它**不动任何颜色字面量** ⇒ 上面那条"没有新增字面量"的间接证据抓不到；两个方向都会出，所以两档都判 | 四格都过 |
| 确认复选框**盒子不被拉伸**（≤24px）**且**与正文相邻（≤16px） | 看图时抓到：注销账号那句确认话被画在两列网格的第二列，复选框在 8rem 的标签列里 | 修后过；变异臂（把 label 挂回 `__row`）报 **121px** |
| 那一格用 Playwright 的 `.check()` 打得动、打勾后放出危险动作 | 按 id 消费它的有两处外部读者：`e2e/selfhost-stack/selfhost-web.spec.ts:540`（真入口注销，用的就是 `.check()`）与 macOS 壳里的 JS 探针（`HeytaMacApp.swift:1994`，`getElementById` + `click()`）。单测那句 `click()` 证不了 `.check()` 带的**可点击性判定** | 过（放在两张图之后，打勾放出的按钮不进受版本控制的截图） |

⚠️ **只量"复选框到文字的距离"会读成绿**：盒子被撑满整列时右缘恰好贴着下一列，变异臂实测距离只有
**19px**（看着像挨着），而屏幕上那个小方块离正文一百多像素。所以这一格是**两把尺子**，缺一把漏一半。

🔴 **这一族的一个探针坑（本线踩过两次）**：`HEYTA_E2E_APP_PORT` / `HEYTA_E2E_STUB_PORT` **复用上一趟的号码**
会得到一次假红 —— 症状是应用停在启动闪屏（page snapshot 只有 `img "heyta"`），
`openApp` 等 `input[placeholder^="添加任务"]` 15s 超时，**看起来像负载问题**。
同一趟里换一对没用过的端口 ⇒ 立刻 8/8 绿；同一对端口再跑 ⇒ 又红。
复量：`lsof -nP -iTCP:<port> -sTCP:LISTEN`（跑完应当为空；不为空就是上一趟的服务没退）。

**看图时顺带撞到的两处，登记但本线不修**：

| 现量 | 为什么不是本线的 | 谁能收 |
|---|---|---|
| `settings-row-grammar` 的 `settings-group-ai` 格**红**：`medianPitch 58`（判据 44–56），`rows=11`、`heights=[44]` 单档、右缘唯一；相邻行距是 53,58,58,58,58 ⇒ 超的是 `toggle` 那一族 | 控制臂：把 `ai-panels.css` 逐字退回本线上批之前（`git checkout 2a4bc0e20^ -- …`）重跑同一格，**读数一字不变的 58** ⇒ 与本线那批字号改动无因果（文件已按 blob `01e2ada6b…` 还原）。`primitives` 打印成 `["preference-row","toggle"]`，AI 旧行归 AI 那一屏 | AI 设置那一屏的负责人（判据阈值 44–56 不许动，要动的是行本身） |
| 同一枚尺**量不到本线迁的两屏**：这一趟 profile / subscription / data / notifications / help 全 `rows=0`，`skeleton` 里是 `ht-settings__account-gate` ⇒ e2e 没登录，而那些屏的行都在登录之后才画 | spec 自己会打 `SETTINGS_SHAPE_SKIP`（出声但不补前置）。补登录腿要动 `settings-row-grammar.spec.ts` 的进入路径（`account-email-change-and-sessions.spec.ts` 那支已经有真登录的 stub 走法，可抄） | 谁下一次跑这枚尺，谁把登录前置补上；本线先用 `account-*` 那支完成了自己的看图 |

**G-4 的最后一米：已收（2026-11-04，靠补契约而不是靠绕）**
原先记着"迁不动是因为 `SettingsSection` 只支持先 rows 后 children，三格要么重排界面、
要么多一块容器"。这个判断本身是对的，但结论下早了 —— 出路不是那三条，而是**第四种**：
给行模型补一档 **`host`**（顺序与分组归契约，内容自己的解剖归它那一族）。
于是 `ProfilePanel` 的三格按用户读到的顺序收进同一个列表：
头像 = `trailing`（`actions` 里整体保留"头像 + 换一张 + 删除 + 两句回执"那一列）、
昵称 = `host` 里的一格 `FormField`、邮箱 = `value`。

| 现量（真浏览器 1440，探针跑完即删，不作为常驻判据） | 迁前 | 迁后 |
|---|---|---|
| 本屏手写 `.ht-settings__row` | 4 处 | **1 处**（那一处归本行说错了：它不在换邮箱那块里，而是注销账号的确认复选框被套进两列网格 —— 当天晚些时候看图腿量到并收掉，现量设置面那几屏为 **0**：`grep -c ht-settings__row apps/web/src/features/settings/*.tsx`） |
| 三格行距 | ≈85 / 69px | 与字段行同一档（44 控件 + 契约的 8 间距） |
| 行解剖账本 | 47 | **39**（`ProfilePanel` 9 → 1） |
| 截图 | 头像那格浮在中间、三格起点不一 | 三格标签同起点、控件同右缘 |

⚠️ `host` 不是逃生口：它只回答"一屏里两族能不能按读到的顺序排在一起"，
"这一格属于哪族"的口径没变（`docs/agents/ux-principles.md` §1 / §1b）。
`shouldRenderSettingsRow` 对 `node` 为空的 host 行**整条不占位**（否则会留出一段空间距）。
验证：`profile-panel` + `account-profile-entry` 23/23，`account-*` e2e 7/7（第一趟有一条红、第二趟干净，
当时记成"负载 flaky"—— ⚠️ 这个归因**没被证过**，而下面暗色腿那一节实测到同一症状的真因是**端口复用**，
下一次撞到先换端口再谈负载），`ui-language` / `form-anatomy` / `settings-prose` /
`control-semantics` / `tip-adjacency` / `design` / `overlay` 全 rc=0，
`@heyta/ui` 与 `apps/web` typecheck rc=0。

**mobile 那一格：已迁（2026-11-05，产品负责人授权改锚）**：
`apps/mobile/src/screens/SessionsSection.tsx` 现在吃同一份契约 —— 每台设备 = `trailing`，
读失败那一句 = `host`（保住 `selectable` 与"在列表上面"这个位置：`note` 档的文字由共享层画，没有这一层）。
真机脚本的锚点一枚没动（`sessions-list` 走 `listTestID` 透传，`sessions-revoke` / `sessions-logout-all` /
`sessions-sign-out` / `sessions-refresh` / `sessions-failure` 逐枚保留）。
别线那枚判据从**切 JSX 三元**改锚到**切行模型字段**，判的还是同一件事（撤销出口只许出现在"不是这台"那一支）；
变异臂：改成 web 那种"禁用按钮"形状 ⇒ 精确红，还原 ⇒ `account-security-wiring` 20/20、
`@heyta/mobile` 101 个测试文件全过、18 枚相关静态门 rc=0。
⚠️ **仍然欠的是本机真机那一枪**（模拟器被别线占、Android 载体不在本机、swap 9.9G/11.2G、负载在涨），
现量与"谁能一步补上"写在 BLOCKED B260 追记二；同处还更正了本线自己写错的一句
（"mobile 已有 11 枚渲染 spec"是读错了 —— 那 11 处命中全是散文，`render(` 计数为 0）。

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
| 对象行（设备 / 凭证）各写一套尾随动作骨架 | ✅ `SettingsRowModel` 加 `trailing` 档，web 的 SessionsPanel 已迁；mobile 的 `SessionsSection.tsx` 卡在别线一枚源码文本判据上（BLOCKED B260） |

**优先级**: 门 ✅；迁移 ✅ 六格已落地（四格字段 + web 一格行 + mobile 一格行，2026-11-05）。
这一格剩下的**不是设计也不是判据**，只有本机真机那一枪（模拟器被别线占、Android 载体不在本机）——
现量、可迁移的参照与"谁能一步补上"都在 BLOCKED B260 追记二。

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

### G-6 的第三半：口径的「位置」那一半原来没有尺（2026-11-04 补）

禁令原文有两半：**不许内联**（`check:settings-prose` 早就管着）+ **一枚 `?` 必须紧跟它所解释的标签/小标题**
（原来只有 `profile-panel.spec.tsx` 一枚断言，只管一屏）。后一半被违反时不会有任何测试变红，
症状是屏幕上出现一枚**没有归属的孤零零问号** —— 看图腿在 `PasswordPanel` 抓到两枚（代码注释自己写着
"按钮旁的 `?`"，代码却把它排在段落之后），已修。

同族查全之后补了 `pnpm check:tip-adjacency`（账本制 + 变异臂）：

| 读数 | 值 | 复量 |
|---|---|---|
| 调用点总数 | 33 | `node scripts/check-tip-adjacency.mjs --report` |
| 存量违规（已进账本，只减不增） | 现量看账本，别抄这里 | `cat scripts/settings-tip-ledger.json` |
| 三条臂都验过 | 新增即红（变异臂）、缩了不改账本也红（`WidgetPushPanel` / `CloseAccountPanel` / `ProfileOverview` 三枚改完各抓到一次）、`--update` 不许改大 | 见 `--self-test` |

**为什么其中一枚值得改代码而不是登记**：`SettingsSection` 没有能把 `?` 挂到**分组标题**旁的口子
（`title` 只收 string），宿主唯一的选择是把它当 children 排在整组之后 —— 那枚问号"孤零零"不是有人写错，
是**契约缺格**。补了 `titleTip`（与上一批给 `FormField` 补的 `labelTip` 对应，纯追加：
`@heyta/ui` / `@heyta/mobile` typecheck 均 rc=0，未传该 prop 的消费端一字不变）。
另外两枚（`CloseAccountPanel` / `ProfileOverview`）本来就是"同屏三块面板都写在 `<h2>` 里、
只有这两块例外"，照同族写法移进各自的节标题即可 —— 两个 testId 在三处测试面**零引用**，
没有断言被顺带改动。账本收到现在这个样子。
剩下的都在 `InboundAutomationSettings.tsx`（自动收集那一屏），本线只登记不代改。

**这把尺的"进链"那一半已落地（2026-11-04 收尾）**，卡点与解法记在这里，因为它不是"顺手改一下 JSON"：
`package.json` 里另一条线写进了 `check:capture-shape`，而它指向的 `scripts/check-capture-shape.mjs`
**当时仍未跟踪**（现量 `git status --short -- scripts/check-capture-shape.mjs`）。`check` 链是**一整行字符串**，
两家的改动落在同一行里，直接入库等于替别线发布一枚指向不存在文件的命令。
做法：把那两节（定义行 + 链上 `pnpm check:capture-shape &&`）**从待提交内容里摘掉 → 只入本线那几行 →
立刻按锚点写回工作树**，别线那一节仍留在它自己的未提交状态里。
摘掉时 `pnpm check:gate-wiring` 会红一枚 Ⓐ 阳性对照（未跟踪的实现文件没有定义引用它），
那是工作树读数，不是 HEAD 读数 —— HEAD 里那两样都不存在，链自洽。
⚠️ 同一趟里别线把 `verify:mobile-pin-order` 连同脚本一起入了库（`git log -1 -- package.json` 现量），
所以摘的行要在提交前重新对一次 HEAD，否则会顺手 revert 别人刚入的行。
本线不替别线提交未跟踪的实现文件，也不把别人**已入库**的那一节摘掉。

---

## 执行节奏

| 周次 | 做什么 | 状态 |
|---|---|---|
| W1（本轮） | G-1 + G-2 落地为门禁 | ✅ G-1 账本清空、A4 硬拒；✅ G-2 静态 CSS 臂（`check-font-size-discipline.mjs`） |
| W1（本轮） | G-3 + G-5 落地为门禁 | ✅ G-3 `check-font-size-discipline.mjs`；✅ G-5 `check-spinner-discipline.mjs`（均带变异臂实测能红） |
| W1（本轮） | G-4「新面板强制使用」那一半 | ✅ `check-settings-row-anatomy.mjs` 账本制 + 变异臂能红 |
| W1（本轮） | G-4 迁移那一半 | ✅ 四格字段迁 `FormField`（ProfilePanel 昵称 / EmailChangePanel / PasskeyPanel 改名 / PasswordPanel 口令）+ 一格行迁 `trailing` 档（SessionsPanel）；账本逐次收缩，现量 `cat scripts/settings-row-anatomy-ledger.json` |
| W2 | G-6 位置尺进链 | ✅ `check:tip-adjacency` 的定义与链上那一节已入库，同批把本线四枚同族尺的定义都带上 `--self-test` 臂（做法与卡点见 G-6 第三半）|
| W2 | G-4 的 mobile 那一格 | ✅ **已迁（2026-11-05，产品负责人授权改锚）**：`SessionsSection` 每台设备走 `trailing`、失败句走 `host`；别线那枚判据从**切 JSX 三元**改锚到**切行模型字段**，判的还是同一件事（变异臂：改成"禁用按钮"形状 ⇒ 精确红）。真机锚点 `sessions-list` / `sessions-revoke` / `sessions-logout-all` 一枚没动。⏳ **只剩本机真机那一枪**（现量与谁能补：BLOCKED B260 追记二）。原先那一行写的"三种写法都排过、归注册登录线改"仍成立，但其中"改成渲染后按 testID 判"那条出路是本线读错的（那 11 处 `@testing-library/react-native` 命中全是散文，`render(` 计数 0）—— 见追记二 ① |
| W2 | 暗色两档的常驻看图腿 | ✅ 做成了**四象限一条用例**（亮/暗 × 1440/375，八张图 12–19，四把尺每格各量一遍；`account-email-change-and-sessions.spec.ts` 第 8 条）。原先那一行是三个批次三个场景拼出来的读数，四格量的不是同一件事。抓到并修掉确认复选框被画进标签列那一格。**这一行原来那句"设置面那几枚 e2e 一枚都不在链里"是假的** —— 链里 `check:ai-e2e` 跑整条默认套（现量 `pnpm --dir e2e exec playwright test --list` 的总数），新 spec 自动有人跑，不需要额外裁决 |
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

5. **变异臂要跟着别名跑**，不能只在脚本里躺着。本轮把设置面这五枚的别名统一成
   `… --self-test && …`（与仓里 `check:dirty-form-policy` / `check:danger-confirm` 同一形状）：
   `settings-prose` / `spinner-discipline` / `font-size-discipline` / `settings-row-anatomy` / `tip-adjacency`。
   现量：`grep -nE '"check:(settings-prose|spinner-discipline|font-size-discipline|settings-row-anatomy|tip-adjacency)"' package.json`
   ⇒ 五行都带 `--self-test`；五条别名各跑一遍全 rc=0；跑完 `grep -r "__MUT_ANATOMY\|mut-tip-standalone\|MUT{" apps/web/src` ⇒ 0 残留。
   ⚠️ 顺带修掉两处**会把变异留在工作树**的写法：`check-settings-row-anatomy` 与
   `check-spinner-discipline` 的臂在失败分支上直接 `process.exit(1)`，而 `process.exit` 会**跳过 `finally`**
   ⇒ 注入的那一行留在源码里。两处都改成"只记状态，退出放在还原之后"。
   `check-settings-no-prose` 原来**根本没有臂**（"它能红"只是文件里的一句话，2026-10-24 立尺到本轮没人失败过它）——
   补了一枚：注入一句 68 字的内联说明 ⇒ 红并点名文件；**并且先要求未变异时门是绿的**，
   免得"环境本来就红"被读成"臂成功了"。探针第一版选了 39 字的文案，注入后仍绿 ——
   那不是尺没牙，是探针没够到 40 字阈值，这条也写在脚本注释里。

6. **改共享契约要过两端消费者，不是只过 `packages/ui` 自己**。这一条是本轮补进计划的（原来没写）：
   `trailing` / `host` 两档都是"web 用起来、mobile 同一份渲染器"，所以判据是三枚，缺一枚就是
   只证了一端：
   `pnpm --filter @heyta/ui typecheck` + `pnpm --filter @heyta/mobile typecheck`（后者跑的是**未改动**的
   mobile 消费者，穷尽 switch 少一档就编译期红）+ `pnpm --filter @heyta/mobile test`
   （现量 2026-11-04：`@heyta/ui` 57 个测试文件、`@heyta/mobile` 101 个测试文件、三枚 typecheck 全 rc=0）。
   ⚠️ 移动端**像素级**那一半不在这里 —— 它只能由设备腿签（`scripts/verify-mobile-{account-email-sessions,ios-account-email-sessions}.sh`），
   而这两枚要真模拟器；静态与单测过 ≠ 手机上好看，这一格不许被上面三枚冒充。
