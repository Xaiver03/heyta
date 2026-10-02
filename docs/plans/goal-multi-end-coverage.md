# Goal · 多端入口覆盖 · P0+P1 补齐（2026-10-02 审计立项）

> 立项依据：[`docs/research/multi-end-entry-coverage-audit.md`](../research/multi-end-entry-coverage-audit.md)（2026-10-02）。
> 该审计清出 3 条 P0、3 条 P1、7 条 P2。本 goal 实施 **P0 全部 + P1 中可零产品裁决落地的两条**；
> P1-3（AI 上移动端）与全部 P2 **不在本 goal**（见 §6 排除项）。

## 0. 一句话目标

把审计的 3 条 P0 与 2 条 P1 补到**每一端都有真实入口 + 逐端判据绿**：web 侧 due 事后编辑（批一）、移动端通知中心与邀请活动（批二）、移动端提醒投递（批三）、移动端账号安全包（批四）、移动端自家备份还原（批五）。

**完成定义**：五批判据全绿 + `pnpm check` 绿 + `pnpm reinstall:all` 绿 + 审计文档 §3 矩阵相应五行翻 ✅ 并逐条回填证据。

## 1. 硬性规则（违反即打回）

1. **红线先行**：每批先落判据（本文件 §2–§6），判据先红后绿；关键判据（op 形状、还原一致性、令牌轮换）做**变异验证**（拿掉实现 ⇒ 恰好那几条红）。
2. **op 纪律**：一个用户意图 = 一个 op；全部写路径走**既有** app-host 动作（`setDueDate` / `changePassword` / inbox 三函数 / `restoreIntoEmptyTarget` 语义都已就绪），壳层只做 UI 接线；`apps/` 不出现业务语义（`check:layering` 钉）。
3. **不 bump `CURRENT_SCHEMA_VERSION`**；不动已接受 ADR 的结论。
4. **新依赖先裁决后动工**：过 §3.1（2021 后持续更新）+ §3.2（许可白名单）两道门并在 `license-inventory.mjs` 登记。**裁决不通过 ⇒ 该批停下响亮上报，不许手搓替代实现绕行。**
5. **i18n 中英同步**（`check:ui-language`）；设计 token 无裸值（`check:design`）；文案零硬编码。
6. **验收零 mock**：真模拟器（emulator-5554）+ 真服务端（TEST_MODE :3000）；截图固定路径、**人真的看**；会开窗口的验收一律后台跑、不抢前台（§6.2 规定二）。
7. **每批完成即回填**：审计文档相应行 + 本文件 §7 执行记录，不许最后一起补。
8. 已知环境陷阱不重踩：#64（`$VAR` 后跟全角要加花括号）、#45（Android text/content-desc 双面）、#87（`check:ai-e2e` 只清 4318/4319，别动并行会话的 vite）。

## 2. 批一 · web 侧 due 事后编辑（P0-3，最小先行）

**现状**：`setDueDate` 语义完整（`tasks/store.ts:98,289`）但全 web **零 UI 调用点**；唯一相关动作是推到今天（`App.tsx:285`）。桌面三壳继承同一载荷 ⇒ 主战场的 macOS/Windows 同样改不了 due。

**做法**：
- 把 `apps/mobile/src/ui/DatePicker.tsx`（RN 原语自绘月历，移动端详情已在用）**上提为 `packages/ui` 共享组件**，移动端改为消费共享份（删本地份，防两份漂移 —— §3.5 教训：抽取的收尾是删旧份 + 门禁）。
- web 任务行内展开区（DueBadge 旁）接该 DatePicker → `setDueDate`。设过 due 的显示并可直接改；清除 = 清 due（一个 op）。

**判据**：
1. op 形状：jsdom 用真 oplog 断言"选日期 ⇒ 恰好一条 UPD op 且只带 `dueDate` 字段"；基线用前后 opCount 夹（防把 create 的 CRT 算进去）。
2. 真浏览器 e2e（`e2e/tests/`，先截图再断言、失败也要有图）：点开 DatePicker → 选日 → 行上 DueBadge 变化 → **刷新后仍在**；控制台与 pageerror 监听窗口一创建就挂。
3. 变异：把 web 的接线调用拿掉 ⇒ 判据 1/2 恰好转红。
4. `check:ui-language` / `check:design` / `check:layering` 绿。

## 3. 批二 · 移动端通知中心 + 邀请活动（P0-2）

**现状**：app-host `inbox.ts` 三函数（`fetchAccountNotifications` / `fetchActivityFeed` / `markNotificationsRead`）在 `apps/mobile/src` **零 import**；邀请得会员是已上线运营功能，移动端登录用户不可见。

**做法**：
- 「我的」页入口行加**「通知」**（带未读徽标，样式对齐既有入口行）→ 新 `NotificationsScreen`：两 tab（通知 / 活动），形态对齐 web InboxBell 的信息结构但按移动壳习惯实现。
- 打开通知面板即 `markNotificationsRead`；活动 tab 渲染邀请卡，复制邀请链接走 `Share.share()`。
- 通知 kind 是**封闭词表**（服务端只存语义+参数，文案归 i18n）——移动端只消费 i18n 词条，不许解析 payload 拼句子。

**判据**（新增 `scripts/verify-mobile-inbox.sh`，真模拟器 + 真服务端零 mock）：
1. 双账号触发**真通知**：账号 B 用账号 A 的邀请码注册（复用现有 verify 脚本的注册段）→ 触发邀请奖励后，A 的移动端出现通知、徽标数 ≥1。若测试环境的邮箱验证钩子走不通，此条**响亮降级**并在脚本头登记"该判据本环境不可验"，不许 mock 一条假通知冒充。
2. 活动 tab 能读到自己账号的邀请码并复制（剪贴板断言或分享面板出现）。
3. 点开面板后徽标清零（`markNotificationsRead` 真调用了）。
4. 截图人看；`adb` 文本判据遵守 #45（text/content-desc 双面）。

## 4. 批三 · 移动端提醒投递（P0-1，依赖裁决先行）

**现状**：提醒两端都能建（数据层同步），web 有到点投递（Notification API）；移动端是纯数据 op，**永不响**。

**Step 0 · 依赖裁决（本批第一件事，产出登记后才许动工）**：
调研 RN 本地通知库（候选：`@notifee/react-native` 等），逐项过 §3.1 最后提交/发版时间 + §3.2 许可证，登记进 `license-inventory.mjs`。**没有库过两道门 ⇒ 本批终止并上报**，禁止手搓原生模块或轮询兜底。

**做法**（裁决通过后）：
- 提醒的建/改/删 → 调度/取消对应 OS 本地通知（`createReminderActions` 既有动作旁挂调度器，op 本身不动 —— 数据层已在同步，本批只加投递）。
- 点通知 → 回到应用（能到任务详情更好，做不到先到应用，登记）。

**判据**（`scripts/verify-mobile-reminder-ring.sh`）：
1. 建一条"1 分钟后"提醒 ⇒ 到点 **adb dumpsys notification / 通知栏截图** 观测到真通知（应用在后台时）。
2. 删掉提醒 ⇒ 已调度通知被取消（dumpsys 里消失）。
3. 应用被杀后通知仍响（本地调度不依赖进程存活 —— 这是与 web 最大的差别，必须验）。
4. 点通知回到应用。
5. 变异：拿掉调度器调用 ⇒ 判据 1 恰好转红。
6. iOS：同代码登记；模拟器能验则一并验，不能则登记边界。

## 5. 批四 · 移动端账号安全包（P1-1）／批五 · 自家备份还原（P1-2）

**批四做法**：「我的」页加**「账号与安全」**入口 → 面板含：
- **改密码**（`changePassword`，hosted-auth.ts:1330）。🔴 hosted-auth.ts:1363 明说**改密码必须换令牌**，否则下一次同步 401 —— 移动端改完必须把新凭据落盘并**立即重验同步仍通**，这一条是本批的变异靶。
- **通行密钥管理**：列表 / 改名 / 删除（`listPasskeys` / `renamePasskey` / `deletePasskey`）+ **发找回链接**（`requestPasskeyRecovery`）。通行密钥**注册**是否纳入：第一步先核实移动端现有通行密钥**登录**走的平台桥，能复用就纳入，不能就登记排除，不硬造。

**批四判据**：真服务端闭环 —— 改密码 → 用新密码重登 → 同步仍通（变异：把"落盘新凭据"拿掉 ⇒ 同步 401 被判据抓到）；passkey 列表/改名/删除走 app-host 契约测试 + 移动端入口可达（空态正确）。

**批五做法**：「导出」页加**「从备份还原」**：警示"仅还原到空库" → 选文件 → `parseExportDocument` 预检（展示 counts 让人确认）→ `restoreIntoEmptyTarget` → 界面出现数据。
- 文件选择的依赖裁决同批三 Step 0（候选 `react-native-document-picker`，MIT）；**粘贴路径必须同时保留**（小文件兜底，与滴答导入同形，零依赖）。

**批五判据**（`scripts/verify-mobile-restore.sh`）：建任务/清单/标签 → 导出 → 清数据重装 → 还原 ⇒ ① `stateMatchesDocument` 为真（现成函数，别自己另写比对）② 界面数得见数据 ③ 还原后同步上行正常。变异：把 counts 校验拿掉 ⇒ 坏文档（截断 JSON）被预检抓住的判据转红。

## 6. 排除项（不在本 goal，逐条有理由）

- **P1-3 AI 上移动端**：出境闸门的移动语义（蜂窝 = 远程？）是 ADR-0010 的延伸裁决，另立 goal/ADR。
- **全部 P2**（便签编辑、清单/标签改名、习惯删除、回收站扩实体、日历创建/拖拽、清单父子、订阅可见性）：产品洞，各自立项；审计 §4 已备好证据。
- **OS 远程推送**：本批三只做本地通知投递；push 涉及推送服务与另一档依赖，另议。
- **管理后台、鸿蒙**：合法单端 / 既有登记（§3.24），不动。

## 7. 执行记录（随批回填，不许最后一起补）

| 批 | 状态 | 判据 | 证据 |
|---|---|---|---|
| 一 | ✅ **已完成（2026-10-02）** | ① jsdom 5 条全绿（op 形状×3：选日/清除/快捷项各=恰好一条只带 dueDate 的 UPD；触发器×2）；② e2e 真浏览器（点开→选日→分组与徽章→**刷新仍在**）；③ 变异：onChange→no-op ⇒ **恰好 3 红**（台账在判据文件尾）；④ `check:ui-language` / `check:design` / `check:layering` 绿；web 1358 / mobile 506 / domain 750 / ui 413 全绿，typecheck 0 错；`verify:mobile-schedule` 7/7（共享 DatePicker 换装无回归） | `apps/web/tests/due-date-edit.spec.tsx` · `e2e/tests/due-date-edit.spec.ts` · `apps/web/evidence/due-date-edit/`（4 图，人已看）· `apps/mobile/evidence/android-timeline-schedule.png`（人已看）。**实施中发现并修掉**：行内 absolute 弹层被带 transform 的滚动容器裁掉（白边）⇒ Portal 到 body + fixed + 实测锚点 + 滚动即关；同族缺陷在 `TaskOrganizer` 实测存在，已登记审计文档 §4 追加发现，范围外待立项 |
| 二 | ✅ **已完成（2026-10-02）** | `verify:mobile-inbox` 真机零 mock 全绿：① 双账号真通知（B 走 `POST /api/register/magic-link` 带 A 的码，TEST_MODE autoVerifyUsers 自动验证并结算邀请 → A 徽标「1 条未读」≥1 → 通知行出现）；② 活动 tab 读到自己邀请码（content-desc 抓值）+ chooser 真出现；③ 打开（自动已读）后徽标清零；④ 截图 4 张人已看。变异：拿掉自动已读 ⇒ ③ 转红（台账本行）。mobile 510 测试 + typecheck 绿；`check:ui-language` 词条 2694/2694 同步。**实施中修掉两个环境坑**（入 traps #93/#94）：共享 `configure_sync_credentials` 对设置 IA 过时（字段搬进了 Modal，凭此修好全族脚本）；prefab CLI + JDK 24 的 stderr 告警被 AGP 当错误（钉 JDK 21 于用户级 gradle.properties） | `scripts/verify-mobile-inbox.sh` · `apps/mobile/src/screens/NotificationsScreen.tsx` · `apps/mobile/evidence/android-inbox-*.png` · `docs/reference/environment-traps.md` #93/#94 |
| 三 | ⛔ **停批（2026-10-02，依赖裁决不过——goal 硬规则 4 的既定出口）** | 逐一裁决了四个候选（ghinfo + npm 元数据实测）：① `@notifee/react-native` 9.1.8 —— **repo 已 archived**、末版 2024-12，§3.1 不过；② `react-native-push-notification` 8.1.1 —— archived、停在 2021，§3.1 不过；③ `wix/react-native-notifications` 5.2.2 —— MIT、未归档、2025-11 发版，两道门过、**构建过**（RN 0.84 原生编译实证），但 **v5 已无本地调度 API**（`NotificationsAndroid` 只剩 FCM 注册 + channel；`postLocalNotification` 仅即时）——功能裁决出局；④ `expo-notifications@57` —— MIT、发版活跃，两道门过，但 **pnpm monorepo 布局卡死集成**（`install-expo-modules` 断言崩溃；expo 源码自注 includeBuild 不吃 symlink——见 traps #95）——集成裁决出局。**没有任何候选同时过两道门并满足"本地调度"功能** ⇒ 本批终止，不手搓原生轮询绕行。依赖树已还原（wix 移除、许可门禁绿、510 测试绿）。**解锁条件（满足其一即重开）**：a) 仓库改用 hoisted node_modules 布局后走 expo-notifications（需另立仓库级裁决）；b) notifee 解除归档或出现过门禁的维护 fork；c) 有一条新的过门禁候选 | 判据脚本已先行落地：`scripts/verify-mobile-reminder-ring.sh`（触发链设计也写在文件头，重开时直接用）· traps #95 |
| 四 | ✅ **已完成（2026-10-02）** | `verify:mobile-account` 真机真服务端 **13/0**：`/api/test/create-user` 每轮建已知密码账号 → 「账号与安全」真 UI 改密（含服务端策略拒绝的真实路径——`NewPass456` 在 HIBP 泄露库被拒，共享 `passwordPolicyMessageKey` 措辞原样呈现）→ **令牌轮换落盘 + 同步仍通（变异靶：拿掉落盘 ⇒ 恰好 1 红「登录凭据已失效」，12 绿）** → 新密码经 `/api/login/email-password` 换新会话 → 旧令牌 401 全局失效 → passkey 空态如实（**注册登记排除**：移动端无 WebAuthn 桥，`auth/passkey-host.ts` 是结论不是占位）。mobile 510 + tsc + `check:ui-language`（2734/2734）绿；截图 2 张人已看。**实施中修掉的基础设施坑**：共享 lib 的 `configure_sync_credentials` 对设置 IA 过时（字段在 Modal 里）、`another_mobile_e2e_running` 会把 zsh -c 包装壳误判成并行验收、pkill 漏杀的僵尸实例、以及**专属模拟器隔离**（AVD 固定 `-port 5556` + `HEYTA_E2E_SERIAL` 机制 + `/tmp/heyta-infra-journal.log` 基础设施日志——回应与 iOS 会话的 #114–116 互踩） | `scripts/verify-mobile-account.sh` · `apps/mobile/src/screens/SecurityScreen.tsx` · `apps/mobile/evidence/android-account-*.png`（人已看）· `/tmp/heyta-infra-journal.log` |
| 五 | ⏳ | | |
| 收尾（check + reinstall:all + 审计回填） | ⏳ | | |
