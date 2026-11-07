# R13a 设置树测绘（只读事实表，2026-11）

> **这张单子只测绘，不改一行代码。** 除本文件外没有第二个文件被写过；没有跑 e2e；没有跑 vitest。
> 基线：`HEAD = abf535b18`（`merge: 标签合并的三个读点接上唯一解析入口`）。
> 上游：[ADR-0085](../adr/0085-appearance-is-device-local-and-never-an-op.md) §三/§五 ·
> [C-②/D-② 工单](c2-d2-work-orders-2026-11.md) §1②。
> 取证方式：**读源码**（行号即证据）。凡是"要跑起来才知道"的判断，一律进 §末「我知道但没确认的」，
> 不在正文里写成结论。

---

## 0. 三个口径（先定，否则表会被读歪）

**① 「几级可达」= 从「设置」这一节数起，到看见该项为止的**点击次数**。**

| 级 | 含义 |
|---|---|
| **1 级** | 左栏点这一组（那一下就是第 1 次），该项在**该组内容里直接渲染** |
| **2 级** | 组内**还要再点一次**才出现：`<details>` 折叠区、就地展开的改名/换档表单、子面板 |
| **3+ 级** | 设置树里根本没有它 —— 必须先离开设置、进别的功能，再从那个功能的界面拐进去 |

**不含**：打开设置浮层本身的那一下、滚动。滚动另记在备注（"需滚动"），因为它不是点击层级，
但确实是"首屏可见"这条判据的另一半（该判据我**没跑起来量视口**，见 §末第 2 条）。

**② 「项」= 一个用户可以单独改变的值。** 一行里塞了两个控件就记两行 —— 本表有 4 处这种行，
都在备注里标了 `⧉ 一行两控件`。反过来，一个 `SettingsSection` 里有 3 个按钮但同属一个值（如
「已登录设备」的撤销），记一行。移动端与 Web 的同构对照用 `mobile.settings.section.*` 词条对表。

**③ ADR-0085 归类**只有三种取值：
- **表达** —— 改的是"同一份数据的表达"，本机、**零 op**（ADR-0085 §三 1）；
- **初值** —— 改的是"新建/触发时的初值"，账号、走 op（同上）；
- **两者都不是** —— 账号/数据/安全/功能开关/视图状态。**这一档今天占绝大多数**，是本表最反直觉的读数，
  详见 §D 的分区统计。

---

## 表 A：设置项逐条

判据：`SETTINGS_NAV_ITEMS`（`apps/web/src/App.tsx:310-332`）**7 组** × 每组真实渲染的条目。
7 组的内容面在 `App.tsx` 的 7 个 `<section className="ht-settings__group">`：
`:3668`（G1）`:3711`（G2）`:3728`（G3）`:3761`（G4）`:3796`（G5）`:3920`（G6）`:3969`（G7）。

> **深链口径（全表通用，写一次省 71 行重复）**：
> `?settings=<id>` 只认**组 id**，不认项（`apps/web/src/lib/settings-deep-link.ts:34`、
> `App.tsx:361-364`）。所以**没有任何一个设置项能靠 URL 直落**；深链一律落在"组"这一级。
> 7 个可用 id 就是 `SETTINGS_NAV_ITEMS` 的 7 个（`settings-group-{profile,subscription,data,
> notifications,appearance,ai,help}`）。
> 旧 id 折叠表 `LEGACY_SETTINGS_SECTIONS` 有 **6 条**
> （`settings-deep-link.ts:72-85`）：`-account`→`-profile`、`-security`→`-profile`、`-sync`→`-data`、
> `-general`→`-notifications`、`-features`→`-ai`、`-about`→`-help`。
> 另有 **3 个 DOM 锚点**（不是 URL）：`settings-profile` / `settings-sync` / `settings-help`
> （`apps/web/src/features/shell/settings-anchors.ts:52-64`），分别被 头像菜单「个人信息」、
> rail 帮助、`SyncBar`/订阅提示 使用 —— 它们落在组 + 滚动 + 焦点，仍然不到项级。

### G1 账号（`settings-group-profile`，显示名「账号」，词条 `mobile.settings.section.account`）

| # | 设置项（用户看到的名字） | 当前挂在哪个组 | 代码落点（file:line） | 几级 | ADR-0085 | 分区 | 备注 |
|---|---|---|---|---|---|---|---|
| 1 | 头像（换一张 / 删除） | G1 账号 | `features/settings/ProfilePanel.tsx:341`（行）、`:402`（换一张）、`:418`（删除） | 1 | 两者都不是（账号） | 账号 | ⧉ 一行三控件（图 + 两个按钮）；未登录时 `aria-disabled` 但**仍在** |
| 2 | 昵称（保存） | G1 账号 | `ProfilePanel.tsx:451`（`FormField` id `profile-nickname`） | 1 | 两者都不是（账号） | 账号 | 空值是合法值 = 清除（文件头 §三条 3） |
| 3 | 登录邮箱（只读值） | G1 账号 | `ProfilePanel.tsx:518-524`（`kind:'value'`） | 1 | 两者都不是（账号） | 账号 | 拿不到邮箱时**整行不渲染**（不是显示空） |
| 4 | 更换登录邮箱 | G1 账号 | `features/settings/EmailChangePanel.tsx:187`（标题）、`:294-296`（新邮箱字段） | 1 | 两者都不是（账号） | 账号 | 挂在邮箱行正下方，不是另起一节 |
| 5 | 登录密码（改 / 设） | G1 账号 | `features/settings/PasswordPanel.tsx:390`（标题）、`:502`/`:517`（当前/新）、`:414`（设置这一档） | 1 | 两者都不是（账号） | 账号 | **同一项两档**：主档是"改密码"，「还没有密码？」切到"设置密码"要再点一次 ⇒ 另一档 2 级（`:457` / `:604`） |
| 6 | 通行密钥（添加 / 重命名 / 删除） | G1 账号 | `features/settings/PasskeyPanel.tsx:190`（标题）、`:228`（添加）、`:314`（列表） | 1 | 两者都不是（账号） | 账号 | 重命名表单就地展开 ⇒ 该动作 2 级（`:345`） |
| 7 | 已登录设备（列表 / 撤销 / 全部退出） | G1 账号 | `features/settings/SessionsPanel.tsx:126`（标题）、`:179`（全部退出）、`:236`（列表） | 1 | 两者都不是（账号·安全） | 账号 | 撤销单台是行内按钮，1 级 |
| 8 | 注销账号 | G1 账号 | `features/settings/CloseAccountPanel.tsx:122`（块头）、`:189`（动作） | 1 | 两者都不是（危险） | 账号 | 组内**最后一块**（`App.tsx:3694-3700` 的注释钉着） |

> ⚠️ **第 5-8 项有一道登录墙**：`App.tsx:3677-3702` —— `accountNeedsSignIn` 为真时，
> 这一整段（通行密钥 / 密码 / 会话 / 注销）**被一张 `SettingsAccountGate` 卡替换**，
> 四个面板**根本不渲染**。不是 3 级，是"项不存在"。见表 C2。

### G2 订阅（`settings-group-subscription`）

| # | 设置项 | 组 | 代码落点 | 几级 | ADR-0085 | 分区 | 备注 |
|---|---|---|---|---|---|---|---|
| 9 | 订阅状态 + 刷新 | G2 订阅 | `features/subscription/SubscriptionPanel.tsx:80`（状态块）、`:102`（刷新） | 1 | 两者都不是（商业） | 账号 | 状态只读，`isEntitled` 只换主按钮那一个词（`:117`） |
| 10 | 选一档 + 下单 | G2 订阅 | `features/subscription/RenewPanel.tsx:214`（根）、`:238`（两档 fieldset）、`:247`（radio） | 1 | 两者都不是（商业） | 账号 | ⧉ 一行里是"档位 radio + 计费说明 `?`"两个控件 |
| 11 | 促销码 | G2 订阅 | `RenewPanel.tsx:282`（`<details>`） | **2** | 两者都不是（商业） | 账号 | 折叠：默认收起（渐进披露，注释明说） |
| 12 | 价格与订阅（站外链接） | G2 订阅 | `SubscriptionPanel.tsx:138`（`/pricing`） | 1 | 两者都不是 | 账号 | 出站，不是设置 |

> ⚠️ 第 10-11 项有一道**登录墙**：`RenewPanel.tsx:216-219` —— 未登录时整块被
> `SettingsAccountGate` 替换（`testId: renew-needs-sign-in`）。

### G3 数据与同步（`settings-group-data`）

| # | 设置项 | 组 | 代码落点 | 几级 | ADR-0085 | 分区 | 备注 |
|---|---|---|---|---|---|---|---|
| 13 | 同步状态（待上传 / 上次同步 / 本机优先） | G3 数据与同步 | `features/sync/SyncSettingsPanel.tsx:128`（fieldset）、`:144`/`:151`/`:156`（三行读数） | 1 | 两者都不是（数据） | 数据 | 3 行都是**只读**读数；未登录整块不渲染（`:128` 外层 `signedIn`） |
| 14 | 托管账号（邮箱 / 未登录卡） | G3 | `SyncSettingsPanel.tsx:177-184` | 1 | 两者都不是（账号） | 账号 | 未登录时是 gate 卡 |
| 15 | 端到端加密口令 | G3 | `SyncSettingsPanel.tsx:187`（fieldset）、`:198`（`sync-password`） | 1 | 两者都不是（安全） | 数据 | 仅 `signedIn && !vaultMode` |
| 16 | 保存并同步 | G3 | `SyncSettingsPanel.tsx:222`（`sync-unlock-and-sync`） | 1 | 两者都不是 | 数据 | ⧉ 与口令同一 fieldset，是两个控件 |
| 17 | 加密模式（启用 / 停用） | G3 | `features/sync/VaultSettingsPanel.tsx:468` → `EncryptionModeSection.tsx:81`、`:102`（停用）、`:114`（启用） | 1 | 两者都不是（安全） | 数据 | 开/停要走危险确认（`:266-282`） |
| 18 | 密钥存放位置（本机记住 / 每次输入） | G3 | `EncryptionModeSection.tsx:128`（legend）、`:143`、`:152` | 1 | **表达**（本机布局/便利，`heyta.vault.keyPlacement.v1` 在 C 档登记） | 数据 | ⧉ 与第 17 项同一块，两个控件 |
| 19 | 保险库（创建口令 / 解锁 / 恢复码） | G3 | `VaultSettingsPanel.tsx:485`（标题）、`:589`/`:623`/`:648`（三个入口） | 1 | 两者都不是（安全） | 数据 | 三入口按 vault 状态互斥渲染，同属一项 |
| 20 | 已登录设备（保险库侧：列出 / 撤销） | G3 | `VaultSettingsPanel.tsx:539-565` | 1 | 两者都不是（安全） | 数据 | 与第 7 项**不是**同一个列表（这是 clientId/撤销同步权，那是登录会话） |
| 21 | 服务器地址 | G3 | `SyncSettingsPanel.tsx:231`（`<details>` 高级）、`:242`（`sync-server-url`） | **2** | 两者都不是（基础设施） | 数据 | 折叠：`common.sync.advanced` |
| 22 | 访问令牌 | G3 | `SyncSettingsPanel.tsx:254`（`sync-token`） | **2** | 两者都不是（凭据） | 数据 | 同一折叠区 |
| 23 | 打开登录页 | G3 | `SyncSettingsPanel.tsx:270`（`web.auth.open`） | **2** | 两者都不是 | 账号 | 同一折叠区 |
| 24 | 隐私同意（状态 / 撤回 / 重新选择） | G3 | `features/settings/PrivacyPanel.tsx:67`（根）、`:76`（状态）、`:94`（重新选择）、`:103`（撤回） | 1 | 两者都不是（合规） | 数据 | PIPL 第 15 条的撤回入口（文件头） |
| 25 | 导出 JSON | G3 | `features/settings/ExportPanel.tsx:99` | 1 | 两者都不是（数据） | 数据 | 嵌在「备份」卡里（`DataSettingsPanel.tsx:26`/`:42`） |
| 26 | 导出 Markdown | G3 | `ExportPanel.tsx:121` | 1 | 两者都不是（数据） | 数据 | ⧉ 与第 25 项同一卡、两行两控件 |
| 27 | 从备份导入 | G3 | `features/settings/ImportPanel.tsx:97` | 1 | 两者都不是（数据） | 数据 | 只在空库时可用的说明在 `:137-140` |
| 28 | 从滴答清单导入 | G3 | `features/settings/TickTickImportPanel.tsx:152` | 1 | 两者都不是（数据·迁移） | 数据 | 迁移卡（`DataSettingsPanel.tsx:46`/`:61`），预览在 `:215` |
| 29 | 管理后台（仅管理员） | G3 | `features/admin/AdminPanel.tsx:247`（`access !== 'admin'` ⇒ `return null`）；挂载点 `DataSettingsPanel.tsx:67` | 1 | 两者都不是（运营） | 功能 | 内部 4 个 `role="tab"` 子页（`:267`/`:272`）⇒ 子页 2 级 |

### G4 提醒与通知（`settings-group-notifications`）

| # | 设置项 | 组 | 代码落点 | 几级 | ADR-0085 | 分区 | 备注 |
|---|---|---|---|---|---|---|---|
| 30 | 提醒授权（请求授权 / 被拒后再授权） | G4 提醒与通知 | `features/reminders/ReminderNotifyPanel.tsx:66`（标题）、`:92`（拒绝后）、`:106`（默认） | 1 | 两者都不是（系统授权） | 提醒 | 能力不支持时整块不出按钮（`:83`） |
| 31 | 共享通知 · 任务完成 | G4 | `features/share/ShareNotificationSettings.tsx:44` → `packages/ui/src/sync/NotificationPrefsPanel.tsx:99`（`ACTIVITIES.map`） | 1 | 两者都不是（本机数据 C 档） | 提醒 | **仅 `syncConfigured` 时渲染**（`App.tsx:3772`）；三个开关共用一个节标题 |
| 32 | 共享通知 · 任务新增 | G4 | 同上（`ACTIVITIES` 第二项） | 1 | 同上 | 提醒 | 同上 |
| 33 | 共享通知 · 任务删除 | G4 | 同上（`ACTIVITIES` 第三项） | 1 | 同上 | 提醒 | 同上 |
| 34 | 桌面小组件 · 如何添加 | G4 | `features/settings/WidgetJourneyPanel.tsx:135` | 1 | 两者都不是（引导） | 提醒 | 平台/桥不可用时自己不画（`WidgetPushPanel` 文件头） |
| 35 | 桌面小组件 · 后台刷新（推送总开关） | G4 | `features/settings/WidgetPushPanel.tsx:274`（面板）、`:218`（行标签） | 1 | 两者都不是（本机数据） | 提醒 | 能力不可用时整段不渲染（`probeWidgetPush`） |

### G5 外观与语言（`settings-group-appearance`）—— 本组 4 项全在 `App.tsx` 内联，不走子组件

| # | 设置项 | 组 | 代码落点 | 几级 | ADR-0085 | 分区 | 备注 |
|---|---|---|---|---|---|---|---|
| 36 | 截止时间显示（日期 / 倒计时） | G5 外观与语言 | `App.tsx:3812`（行）、`:3820-3835`（radio）、`features/tasks/due-display-pref.ts:18`（键） | 1 | **表达** | 个性化 | 键 `heyta.dueDisplay`，A 档，零 op |
| 37 | 详情栏默认（展开 / 收起） | G5 | `App.tsx:3839`（行）、`:3856-3874`（radio）、`features/shell/detail-pane-pref.ts:24` | 1 | **表达** | 个性化 | 键 `heyta.detailPane`，A 档 |
| 38 | 界面语言 | G5 | `App.tsx:3877-3880` → `features/shell/LanguageSwitcher.tsx:104-129` | 1 | **表达** | 个性化 | 键 `heyta.locale`，A 档；按钮组不是下拉 ⇒ 1 级 |
| 39 | 主题（明 / 暗） | G5 | `App.tsx:3881-3902`（`theme-toggle`）、`lib/theme.ts:15` | 1 | **表达** | 个性化 | 键 `heyta.theme`，A 档；**只有开/关两态**，没有预设/自定义/自动深浅（R13b 才加） |

> 🔴 **G5 就是今天"个性化"的全部家当：4 项。** ADR-0085 §三 1 列的 8 个外观维度里，
> 落地了的只有"主题（两态）""语言""日期显示格式""详情栏默认"这 4 个；
> 字号 / 字体族 / 密度 / 行着色 / 应用图标 / 便签与倒数日样式 / 自动深浅**一个都没有**。

### G6 功能与 AI（`settings-group-ai`）

| # | 设置项 | 组 | 代码落点 | 几级 | ADR-0085 | 分区 | 备注 |
|---|---|---|---|---|---|---|---|
| 40 | 功能模块 · 日历 | G6 功能与 AI | `features/shell/FeatureModulesPanel.tsx:66`（`SHELL_MODULES.map`）、`features/shell/modules.ts:78` | 1 | 两者都不是（本机功能开关） | 功能 | 键 `heyta.shell.modules`，C 档；**即时生效、无保存按钮** |
| 41 | 功能模块 · 四象限 | G6 | `modules.ts:84` | 1 | 同上 | 功能 | 同上 |
| 42 | 功能模块 · 习惯 | G6 | `modules.ts:90` | 1 | 同上 | 功能 | 同上 |
| 43 | 功能模块 · 时间线 | G6 | `modules.ts:96` | 1 | 同上 | 功能 | 同上 |
| 44 | 功能模块 · 番茄专注 | G6 | `modules.ts:102` | 1 | 同上 | 功能 | 默认关 |
| 45 | 功能模块 · 成长 | G6 | `modules.ts:108` | 1 | 同上 | 功能 | 默认关；**它同时是「我的」页成就块的开关**（见表 B） |
| 46 | 功能模块 · 便签 | G6 | `modules.ts:114` | 1 | 同上 | 功能 | 默认关 |
| 47 | 功能模块 · 倒数纪念日 | G6 | `modules.ts:124` | 1 | 同上 | 功能 | 默认关 |
| 48 | AI 总开关 | G6 | `features/settings/AiSettings.tsx:690`（`ai-enabled`） | 1 | 两者都不是（本机数据 C 档） | 功能 | 键 `heyta.ai.settings`；**它是 49 之外所有 AI 项的渲染前提**（`:715`） |
| 49 | AI 记忆开关 | G6 | `AiSettings.tsx:704`（`ai-memory-enabled`） | 1 | 两者都不是 | 功能 | 刻意**不受**总开关管辖（`:698-703`） |
| 50 | AI 记忆内容（已知 / 未采用 / 缺口 / 已忘） | G6 | `features/settings/MemoryPanel.tsx:141`（`memoryEnabled` 为假只出一句）、`:201`/`:252`/`:333`（四个小节） | 1 | 两者都不是（用户数据） | 功能 | 记忆关时**只剩一句**"关着"（`:149-157`） |
| 51 | 允许远程端点 | G6 | `AiSettings.tsx:723`（`ai-allow-remote`） | 1 | 两者都不是（安全闸） | 功能 | **只在总开关开时渲染**（`:715`） |
| 52 | AI 供给模式（heyta 托管 / 我自己的端点） | G6 | `AiSettings.tsx:750`（fieldset）、`:772-787`（radio） | 1 | 两者都不是 | 功能 | 依赖第 51 项；托管档的地址来自同步服务器（`:741-748`） |
| 53 | 托管用量读数（本周期已用 X / 300） | G6 | `AiSettings.tsx:806-825` | 1 | 两者都不是（只读） | 功能 | 三态分开说（`entitled`/`not-entitled`/`unavailable`），**这是唯一读订阅态的地方** |
| 54 | 端点列表（改名 / 改址 / 改模型 / 停用 / 能力 / 密钥） | G6 | `AiSettings.tsx:829`（section）、`:899`（每项）、`:962`（停用）、`:989`（能力） | 1 | 两者都不是（配置） | 功能 | ⧉ 单个端点内部有 9 个控件；能力 4 个 checkbox（`CAPABILITY_ORDER` `:60-65`） |
| 55 | 添加自定义端点 | G6 | `AiSettings.tsx:1104`（`add-custom-endpoint`） | 1 | 两者都不是 | 功能 | 预设一键加在 `:1085-1103` |
| 56 | 功能授权 · 任务拆解 | G6 | `AiSettings.tsx:1128`（section）、`:1151`（`FEATURE_ORDER.map`）、`:175-182` | 1 | 两者都不是（出境授权） | 功能 | 每个功能一行 chips（选端点）+ 授权/撤回 |
| 57 | 功能授权 · 优先级建议 | G6 | 同上（`FEATURE_ORDER` 第二项） | 1 | 同上 | 功能 | 同上 |
| 58 | 功能授权 · 时长估算 | G6 | 同上（第三项） | 1 | 同上 | 功能 | 同上 |
| 59 | 功能授权 · 工具调用 | G6 | 同上（第四项） | 1 | 同上 | 功能 | 同上 |
| 60 | 功能授权 · 入站自动化 | G6 | 同上（第五项） | 1 | 同上 | 功能 | 与第 65 项**不是一个东西**：这行是"准不准 AI 用它"，65 是规则本身 |
| 61 | 助手出境披露（字段 / 工具 / 上限） | G6 | `AiSettings.tsx:1246`（section）、`:1270`（`<details>`） | **2** | 两者都不是（披露） | 功能 | **默认收起**（注释 `:1257` 明说），披露正文一个字没删 |
| 62 | 本机 API 开关 | G6 | `AiSettings.tsx:1351`（`local-api-enabled`） | 1 | 两者都不是（本机数据） | 功能 | **不受** AI 总开关管辖（在 `:1299` 那张卡之外） |
| 63 | 本机 API 令牌 | G6 | `AiSettings.tsx:1364`（label）、`:1381`（input） | 1 | 两者都不是（凭据） | 功能 | 仅开关开时渲染（`:1359`） |
| 64 | 本机 API 逐工具授权（读 / 写两组） | G6 | `AiSettings.tsx:1434`（`local-api-tool-groups`）、`:1446`（`tools.map`） | 1 | 两者都不是（授权） | 功能 | ⧉ 每个工具一行 1 个 checkbox + 1 个 `<details>` 技术名（技术名 ⇒ 2 级） |
| 65 | 入站自动化（收件密钥 / 字段 / 目标清单 / 时区 / 上限 / 规则） | G6 | `features/settings/InboundAutomationSettings.tsx:387`（标题）、`:427`（字段 checkbox）、`:440`（目标）、`:473`（上限） | 1 | 两者都不是（配置+凭据） | 功能 | **仅登录时渲染**（`:406` 的 `signedIn` 分支）；规则增删改全在行内 |
| 66 | 恢复 AI 默认（危险） | G6 | `AiSettings.tsx:1519`（`reset-ai-zone`）、`:1531`（危险确认） | 1 | 两者都不是（危险） | 功能 | 第二下确认弹模态（`resetAiDanger.ts`），仍是 1 层 |

### G7 关于与帮助（`settings-group-help`）

| # | 设置项 | 组 | 代码落点 | 几级 | ADR-0085 | 分区 | 备注 |
|---|---|---|---|---|---|---|---|
| 67 | 帮助中心 | G7 关于与帮助 | `features/settings/HelpPanel.tsx:13`（`/docs`） | 1 | 两者都不是 | 关于 | 出站 |
| 68 | 更新动态 | G7 | `HelpPanel.tsx:14`（`/changelog`） | 1 | 两者都不是 | 关于 | 出站；**不是**"检查更新"（见第 72 行） |
| 69 | 价格与订阅 | G7 | `HelpPanel.tsx:15`（`/pricing`） | 1 | 两者都不是 | 关于 | 出站；与 G2 是两个入口同一个目的地 |
| 70 | 反馈（发邮件） | G7 | `HelpPanel.tsx:55`（`about-link-feedback`，`mailto:`） | 1 | 两者都不是 | 关于 | 收件人取 `OPERATOR.contactEmail`，界面不写 |
| 71 | 运营者 / 备案号（只读） | G7 | `HelpPanel.tsx:119`（`about-operator`） | 1 | 两者都不是 | 关于 | **仅官方托管实例**渲染（`isOfficialHostedInstance`） |

### 表 A 计数

| 组 | 项数 | 1 级 | 2 级 | 3+ 级 |
|---|---|---|---|---|
| G1 账号 | 8 | 8 | 0（两处"另一档"注在备注） | 0 |
| G2 订阅 | 4 | 3 | 1（#11 促销码） | 0 |
| G3 数据与同步 | 17 | 14 | 3（#21/#22/#23 同步高级折叠） | 0 |
| G4 提醒与通知 | 6 | 6 | 0 | 0 |
| G5 外观与语言 | 4 | 4 | 0 | 0 |
| G6 功能与 AI | 27 | 26 | 1（#61 助手出境披露） | 0 |
| G7 关于与帮助 | 5 | 5 | 0 | 0 |
| **合计** | **71** | **66** | **5** | **0** |

---

## 表 B：「我的」页现状

「我的」页 = `features/settings/ProfileOverview.tsx`，挂在 `secondaryAccountSurface === 'profile'`
（`App.tsx:3615-3633`）。**它不是设置树的一节**，与设置是同一个浮层的两个面。
入**口**只有一个：rail 底部头像 → 菜单「个人中心」（`features/shell/AccountMenu.tsx:351-358`）。

| 区块 | 现在的顺序 | 代码落点 | 是否与会员耦合 | 在哪个入口能到 |
|---|---|---|---|---|
| **身份** | **1** | `ProfileOverview.tsx:48-103`（`profile-center-identity-title`） | **否**：只读 `useAccountIdentity()`（`:34`）与 `useSyncStore(state => state.token)`（`:35`，仅用来判"登录了没"，`:44`） | 头像菜单 →「个人中心」 |
| **统计**（近期状态三格） | **2** | `ProfileOverview.tsx:105-125`；selectors：`:38` `selectWeeklyReview(entities, now)`、`:36` `useTaskStore(state => state.entities)`、`:37` `useTaskStore(state => state.now)` | **否。** 全文件**零** `isPro` / 订阅 store / `access` 读取（我 grep 过 `apps/web/src/features/subscription/**` 与 `motivation/GrowthView.tsx`，`ProfileOverview` 没有引用它们）；三格（任务数 / 专注分钟 / 打卡）无任何档位门 | 同上 |
| **引导 / 成就** | **3** | `ProfileOverview.tsx:127-172`（`growthEnabled ? ... : null`）；`:39` `selectMilestones`；`:152` 读数、`:140-148` 跳成长视图 | **否，但被功能模块门住**：`growthEnabled={enabledModules.has('growth')}`（`App.tsx:3617`），而 `growth` 模块**默认关**（`features/shell/modules.ts:108` 的 `defaultOn: false`） | 同上；关着模块时这块**整段不渲染**，也不给深链（`:30-31` 注释） |
| **会员** | *不在这一页* | 会员只在设置 →「订阅」组（`App.tsx:3711` → `SubscriptionPanel`） | —— | 设置 → 订阅；或 `?settings=settings-group-subscription` |
| **版本** | *不在这一页，也不在设置树* | **全仓无版本读数**：`HelpPanel.tsx` 只有 4 条出站链接 + 运营者行；`packages/i18n` 的 `web.about.updateNote`（`zh-CN.ts:5172`）明写"这里没有「检查更新」按钮"；`apps/web` 里 grep 不到 `__APP_VERSION__` / `import.meta.env.VITE*` | —— | **没有入口**（这正是 R13a 要补的两个锚点之一） |
| **退出** | *不在这一页* | 退出登录在 rail 底部头像菜单：`AccountMenu.tsx:362-364`（`item(..., 'danger')`，注释钉着"永远在最底"）。**与设置树无关** | —— | 头像 →「退出登录」（仅已登录时存在） |
| **其它** | **4** | `ProfileOverview.tsx:174-184`：「打开设置」按钮（`profile-center-settings`） | 否 | 同上 |

**表 B 三条判据读出来的事实：**

1. **统计没有档位门** —— 它连订阅 store 都没 import。R13a 那条"统计与会员解耦"的反向判据，
   现在**天然成立**；要小心的是"别在重排时顺手给它加一档"。
2. **但"身份第一、版本/退出最后"的骨架现在是断的**：页里只有 身份 → 统计 →（成就）→ 一个按钮。
   **版本行不存在，退出不在这页**（它在头像菜单）。所以"最后两位是版本 / 退出"这条要求
   今天**无处可落**，需要新做两行（且退出要与头像菜单那一条决定谁是唯一入口，否则就是两个入口同一动作 ——
   `SyncSettingsPanel.tsx:277-281` 有一段先例：那里的「清除凭据」就是因为与"退出登录"是同一动作而被撤掉）。
3. **成就块是"引导"不是"会员"**，但它被 `growth` 模块门住且默认关 ⇒ 默认形态下这一页只有
   身份 → 统计 → 打开设置 三块。

---

## 表 C：两级可达的缺口

### C1 树外：这些"设置项"根本不在设置树里（3+ 级）

| 项 | 现在要几级 | 卡在哪 | 需要搬到哪个组才两级可达 |
|---|---|---|---|
| **任务排序档位**（默认 / 添加时间 / 优先级 / 手动） | **3+**（离开设置 → 任务视图 → 页头 `⋯` → 单选） | 页头 `⋯` 菜单里：`App.tsx:3049-3059`（`MenuSection` + `TASK_SORT_KEYS.map`）；键 `heyta.taskSort`（`features/tasks/sort-pref.ts:19`）、`heyta.projectTaskSort`（`features/projects/project-sort-pref.ts:9`） | 若要把视图状态也收进来 ⇒ 需要一个「视图与排序」组（现在没有）；ADR-0085 判它是**两者都不是**（视图状态 B 档），所以进「个性化」还是留在页头，是产品裁决，不是测绘结论 |
| **rail 编排**（上移 / 下移 / 固定到侧栏 / 移至更多 / 恢复默认） | **3+**（rail「更多」→ 自定义侧栏 → 逐项动作） | `features/shell/RailNavigation.tsx:488-493`（进入自定义）、`:125-132`/`:171-178`（动作）、`:502-506`（恢复默认）；键 `heyta.shell.rail`（`features/shell/rail-pref.ts:16`，**A 档表达**） | 「个性化」—— 它在持久化表里本来就登记为 A 档表达，却只有 rail 一个入口 |
| **日历显示范围**（看见哪些清单 / 标签） | **3+**（日历视图 → 侧栏勾选） | `features/calendar/CalendarSidebar.tsx:230`/`:248`（两个 `type="checkbox"` 分组）、`:477`（全选）；状态在 `features/calendar/store.ts:48` 的 `scope`，**内存态** | 判据上它连持久化键都没有（未登记），**先决定它算不算设置项** —— 本表不替它归类 |

### C2 依赖前置条件：不是"级数不够"，是"项不存在"

| 项 | 条件不成立时的形态 | 卡在哪 |
|---|---|---|
| 通行密钥 / 登录密码 / 已登录设备 / 注销账号（#5-#8） | **四个面板整段不渲染**，被一张「登录」卡替换 | `App.tsx:3677-3702`（`accountNeedsSignIn ? <SettingsAccountGate/> : <>…</>`） |
| 端到端加密口令 / 保存并同步 / 保险库 #15-#20 | **不渲染**（未登录时） | `SyncSettingsPanel.tsx:186-230`（外层 `signedIn ?`），`:128` 状态块同理 |
| 订阅选档 + 促销码 #10-#11 | gate 卡替换 | `RenewPanel.tsx:216-219` |
| 入站自动化 #65 | 只出一句"请登录" | `InboundAutomationSettings.tsx:406-408` |
| 共享通知 #31-#33 | **整节不渲染** | `App.tsx:3772`（`syncConfigured ? <ShareNotificationSettings/> : null`）；理由在 `ShareNotificationSettings.tsx:20-22` |
| AI #51-#61（除 #48/#49/#50/#62-#66） | **总开关关时整段不渲染** | `AiSettings.tsx:715`（`routing.enabled && (…)`，闭合在 `:1298`） |

> 这六组**登录后 / 打开后都是 1 级**，所以不计入"做不到两级内"的数字；
> 但它们是"任意设置项两级内可达"这条判据的**另一半**：判据若只数点击，
> 就会漏掉"项压根不在树上"的那一半。

### C3 深链：只到组，不到项

| 事实 | 证据 |
|---|---|
| `?settings=<id>` 只接受 7 个**组** id，认不出就**不打开设置** | `settings-deep-link.ts:34`、`App.tsx:345-347`、`:361-364` |
| 旧 id 6 条折叠到新组（Web 3 条 + 移动端 key 3 条） | `settings-deep-link.ts:72-85` |
| 锚点表 3 条：`profile` / `sync` / `help`（落组 + 滚动 + 焦点，不到项） | `settings-anchors.ts:52-64` |
| AI 面板的 4 个"下一步"落点（`endpoints`/`remote`/`consent`/`capability`） | `features/ai/route-explanation.ts:67`、`App.tsx:1074-1081`、`AiSettings.tsx:353`/`:408` |
| 移动端是**另一张表**（key→key，不是 id→id），两边不能互相推导 | `apps/mobile/src/screens/SettingsScreen.tsx:165-173` |

⇒ 结论：**今天没有任何一个设置项有深链**。R13a 若要"任意设置项两级内可达"在深链这一侧也成立，
需要项级 id（现在连命名空间都没有）。

---

## 表 D：两分区搬家清单

分区判据只用 ADR-0085 §三 1 那一句：**改的是"同一份数据的表达"，还是"新建/触发时的初值"？**

### D1 现有 7 组 → 按项拆

| 现有组（项数） | → 个性化（表达） | → 行为默认值（初值） | 留在本组（既不是表达也不是初值） |
|---|---|---|---|
| **G1 账号**（8） | — | — | 全部 8 项原地（账号/安全/危险） |
| **G2 订阅**（4） | — | — | 全部 4 项原地（其中"价格与订阅"与 G7 那一条是同一目的地，两入口） |
| **G3 数据与同步**（17） | — | — | 16 项原地；**#18 密钥存放位置**是唯一勉强够得上"表达"的（本机便利档），但它与 #17 加密模式同块，拆开会让"停用加密"与"记不记这枚钥匙"分居两屏 ⇒ **建议不搬** |
| **G4 提醒与通知**（6） | — | — | 全部 6 项原地（授权 / 本机偏好 / 小组件引导） |
| **G5 外观与语言**（4） | **全部 4 项**（#36 截止显示、#37 详情栏默认、#38 语言、#39 主题） | — | — （组名与词条可留用，但要改"这一组是什么"的语义） |
| **G6 功能与 AI**（27） | **0 项**：8 个功能模块开关是"本机功能开关"，持久化表把它登记在 **C 档**并明确注明"**别放进 A 档**"（`client-persistence-keys.md` C 档 `heyta.shell.modules` 行）；AI 那一族的键 `heyta.ai.settings` 同样在 C 档 | — | 全部 27 项（含 8 个模块开关）、AI 全部、入站、重置 |
| **G7 关于与帮助**（5） | — | — | 全部 5 项原地 |
| **「我的」页**（表 B） | — | — | 身份 / 统计 / 成就 / 打开设置 —— 不属两个分区任一个 |

### D2 分区统计（这是本表最硬的读数）

| 读数 | 数字 | 说明 |
|---|---|---|
| **能搬进「个性化」的现有项** | **4** | #36 #37 #38 #39，全部来自 G5，全部已登记为 A 档表达、零 op |
| **能搬进「行为默认值」的现有项** | **0** | ADR-0085 与工单 §1③ 点名的五个初值项 —— 周起始 / 默认提醒 / 默认清单 / 默认时长 / 智能识别 —— **在全仓一个都不存在**（`grep -rn "weekStartsOn\|defaultReminder\|defaultProjectId\|defaultDuration\|smartParse" apps packages` 只有 `packages/domain/src/timeline.ts:231` 的**函数入参**与 `packages/ui/src/habits/model.ts:314` 的**热力图内部参数**，都不是用户设置） |
| **搬家项数** | **4** | 全部是"从 G5 搬到新分区"，没有跨组搬迁 |
| **需要新开的组数** | **2**（下限）/ **6**（按初值五项各成一组则更多） | 见 D3 |
| **树内 3+ 级项** | **0** | 表 A 的 71 项没有一项需要 3 次点击 |
| **树外 3+ 级项** | **3** | 表 C1：排序档位 / rail 编排 / 日历显示范围 |

### D3 组名建议 + 词条对账

现在**可用的词条**（`packages/i18n/src/locales/zh-CN.ts`，`mobile.settings.section.*`）：

| key | 中文（zh-CN 行号） | 现在谁在用 |
|---|---|---|
| `.account` | 账号（:3829） | G1 |
| `.subscription` | 订阅（:2830） | G2 |
| `.data` | 数据与同步（:3838） | G3 |
| `.notifications` | 提醒与通知（:3830） | G4 |
| `.appearance` | 外观与语言（:3831） | G5 |
| `.features` | 功能与 AI（:3832） | G6 |
| `.about` | 关于与帮助（:3833） | G7 |
| `.profile` / `.security` / `.sync` / `.general` / `.ai` | 个人资料 / 账号安全 / 同步与隐私 / 常规 / AI 与集成（:3834-3839） | **只剩旧 id 折叠在用**（`settings-deep-link.ts:72-85`） |

**缺的词条（一条都没有）：**

| 需要的词 | 现状 | 备注 |
|---|---|---|
| 「个性化」分区名 | **不存在** | grep `个性化` 在 i18n 里零命中 |
| 「行为默认值」分区名 | **不存在** | 同上；`默认` 在设置语境里只出现在 `web.habits.backfill.default` 这类单点文案里 |
| 初值的五个组/项：周起始 / 默认提醒 / 默认清单 / 默认时长 / 智能识别 | **全部不存在** | 连键都没有，不是"有键没文案" |
| 版本号 | **不存在** | 全仓无版本词汇条（`web.about.updateNote` 只是解释"为什么没有检查更新"） |

⇒ **组名建议（按现有词条能覆盖的写法）**：

1. 「个性化」分区 = **复用 `.appearance`（外观与语言）作为分区的第一组**，分区名新开一条
   （建议 `mobile.settings.partition.personalization`）。理由：现有 4 个表达项全在这一组，
   搬动量为 0，且 `R13b` 要加的 5 个外观键本来就该进这一组。
2. 「行为默认值」分区 = **必须新开组 + 新开项**，一个现有词条都用不上。
   最小的两条建议键名：`mobile.settings.section.defaults`（分区/组名）、
   以及五个项各自的 `...defaults.weekStart` / `.reminder` / `.project` / `.duration` / `.smartParse`。
   ⚠️ 这五条**不是文案缺口，是功能缺口** —— 先把项做出来，词条才有宿主。

> 🔴 **搬运的真实规模不是"4 项搬家 + 2 组"，而是"4 项搬家 + 1 个空分区"**。
> 「行为默认值」今天是个**空壳分区**：ADR 判据要求它存在（那里要有周起始等初值），
> 而 web 侧一个初值项都没做。R13a 若只做"分成两个分区"，会得到
> **一个 4 项的个性化分区 + 一个 0 项的行为默认值分区** —— 这个落法在界面上是"一个空组"，
> 需要明确：要么先做 1-2 个初值项，要么给空分区一个诚实的空态。

---

## 1. 分母（这张表最硬的产出）

| 读数 | 数 | 怎么数的 |
|---|---|---|
| **扫过的设置相关文件** | **45 + 26 = 71** | `apps/web/src/features/settings/**` 全部 **45** 个（其中 `.tsx` **23** 个是逐条读/逐条 grep 的，22 个 `.ts`/`.css` 只 grep 键与门，**没有逐行读**）；外部 **26** 个：`App.tsx`、`lib/settings-deep-link.ts`、`features/shell/{settings-anchors,FeatureModulesPanel,LanguageSwitcher,AccountMenu,modules,RailNavigation}.ts(x)`、`features/sync/{SyncSettingsPanel,VaultSettingsPanel,EncryptionModeSection}.tsx`、`features/subscription/{SubscriptionPanel,RenewPanel}.tsx`、`features/reminders/ReminderNotifyPanel.tsx`、`features/share/ShareNotificationSettings.tsx`、`features/admin/AdminPanel.tsx`、`features/calendar/{CalendarSidebar,store}.ts(x)`、`features/ai/route-explanation.ts`、`packages/ui/src/settings/{Settings,model}`、`packages/ui/src/sync/NotificationPrefsPanel.tsx`、`apps/mobile/src/screens/{SettingsScreen,ProfileScreen}.tsx`、`docs/reference/client-persistence-keys.md`、`packages/i18n/src/locales/zh-CN.ts`（只取键） |
| **`SETTINGS_NAV_ITEMS` 组数** | **7** | `App.tsx:310-332` |
| **表 A 行数** | **71** | 8 + 4 + 17 + 6 + 4 + 27 + 5 |
| 其中 **1 级** | **66** | 93.0% |
| 其中 **2 级** | **5** | #11 促销码 / #21 服务器地址 / #22 访问令牌 / #23 打开登录页 / #61 助手出境披露 |
| 其中 **3+ 级** | **0** | —— |
| 树外 3+ 级项 | **3** | 排序档位 / rail 编排 / 日历显示范围（表 C1） |
| 「个性化」可搬项 | **4** | 全在 G5 |
| 「行为默认值」可搬项 | **0** | 五个初值项全仓不存在 |
| 深链可达层级 | **组级** | 项级 0 条 |

---

## 2. 我知道但没确认的

| # | 判断 | 为什么没确认 | 它会怎么改变结论 |
|---|---|---|---|
| 1 | 「首屏可见」 | 我按 **DOM 顺序**判"在组内容里直接渲染"，**没有跑起来量视口**。G3（17 项）和 G6（27 项）内容远超一屏，其中靠后的项（如 #29 管理后台、#65 入站自动化、#66 重置）**必须滚动**才能看见 | 若判据把滚动算成一级，1 级会掉一大截；这时要给出的不是"级数"而是"屏数"。**这是本表最可能被推翻的一个数** |
| 2 | 「折叠区默认展开与否」 | #21/#22/#23 在原生 `<details>` 里，`<details>` **默认收起**（无 `open` 属性，`SyncSettingsPanel.tsx:231` 我确认没写 `open`）；#11 促销码同理（`RenewPanel.tsx:282`）；#61 助手披露同理（`AiSettings.tsx:1270`）。**这四个"默认收起"是读代码得出的，不是看界面** | 与我的结论一致的可能性高，但如果某处 CSS/JS 强制展开了，2 级会变 1 级 |
| 3 | AI「总开关关 → 后面整段不渲染」 | `AiSettings.tsx:715` 的 `routing.enabled && (…)` 我读了，闭合位置（`:1298`）也读了；但**没有跑起来点开关验证 DOM 变化** | 若实际是 CSS 隐藏而非不渲染，第 51-61 项就从"不存在"变"存在但不可见"，C2 那六行的性质要改 |
| 4 | 「未登录时账号四项被替换」 | `App.tsx:3677-3702` 的三元我读了；`SettingsAccountGate` 全文读了。**没有以未登录态跑一遍** | 若 `accountNeedsSignIn` 的判定还有别的分支（`App.tsx:493`），受影响项数可能不是 4 |
| 5 | 「统计与会员无耦合」 | 我 grep 的是 `ProfileOverview.tsx` 全文 + `features/subscription/**` + `motivation/GrowthView.tsx`，**没有追 `selectWeeklyReview` / `selectMilestones` 的实现体**（它们可能间接读某个 store，但凡是订阅态都会经过 `features/subscription/store.ts`，而那个文件没出现在 `ProfileOverview` 的 import 里） | 结论强度是"import 层面无耦合"，不是"数据流层面无耦合" |
| 6 | 「版本号在全仓不存在」 | 我 grep 了 `apps/web/src`、`index.html`、`vite.config.ts`、`packages/i18n`、`apps/mobile/src`；**没有 grep 桌面三壳**（`apps/desktop*`）—— 版本号完全可能在 Tauri/Electron 的窗口标题或安装器里 | 若桌面壳有版本显示，表 B 的"版本没有入口"要改成"web 没有、桌面有（不同构）" |
| 7 | 「日历显示范围不持久」 | 我读的是 `features/calendar/store.ts:48` 的初始态 `FULL_SCOPE`（`:148`），**没有确认它有没有写 `localStorage`**。持久化键登记表里**没有它**，但这只说明"没登记"，不说明"没存" | 若它其实持久化了，它就是一个**漏登记的键**（`check:persistence-keys` 的射程只到字面量），表 C1 第三行要升级成"未登记的表达类键" |
| 8 | 「#29 管理后台内部 4 个 tab」 | `AdminPanel.tsx` 1344+ 行，我只读了权限门（`:247`）与 tablist（`:267`/`:272`），**没有逐个数 tab 项** | 表 A 第 29 行的"内部子页 2 级"是形状判断，不是逐项清单 |
| 9 | 「#18 密钥存放位置属表达」 | 我把它写成"勉强够得上表达"，同时在上面注明**建议不搬**。它的持久化键 `heyta.vault.keyPlacement.v1` 登记在 **C 档（本机数据）**，不是 A 档 | 严格按登记表，它应是"两者都不是"；那句"表达"是 ADR 判据的直觉，与登记表不一致 —— **以登记表为准** |
| 10 | 移动端对表 | 我只读了 `SettingsScreen.tsx` 的 7 个 section key、`LEGACY_SECTION`、`sectionLabels`/`sectionIcons`/`sectionRows`，**没有逐个读移动端每组里的项** | 表 D 的"组名建议"只依赖两边共用的那 7 条词条，不依赖移动端的项清单；但"两端同构"这条判据要移动端逐项清单才能判 |
