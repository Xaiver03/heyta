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

> ⚠️ **读这张表之前先看文末**：下面"收尾"那一行写的是 **10:0x 的状态**（当时 `check` 还有两段红、
> 缺口按"两段"登记）。12:0x 之后那两段红已当场解除、链本身也从 59 段长到 61 段，
> **现状以 §7.17（61 段逐段读数）、§7.20（终局审计）与 §7.21–§7.22（ios 段解禁 + 四端同载体跑绿）为准**
> —— 表内那行不是最新答案。
> 留原文不改是为了让人看清"缺口当时是怎么被描述的"，不是让人照它行动。

| 批 | 状态 | 判据 | 证据 |
|---|---|---|---|
| 一 | ✅ **已完成（2026-10-02）** | ① jsdom 5 条全绿（op 形状×3：选日/清除/快捷项各=恰好一条只带 dueDate 的 UPD；触发器×2）；② e2e 真浏览器（点开→选日→分组与徽章→**刷新仍在**）；③ 变异：onChange→no-op ⇒ **恰好 3 红**（台账在判据文件尾）；④ `check:ui-language` / `check:design` / `check:layering` 绿；web 1358 / mobile 506 / domain 750 / ui 413 全绿，typecheck 0 错；`verify:mobile-schedule` 7/7（共享 DatePicker 换装无回归） | `apps/web/tests/due-date-edit.spec.tsx` · `e2e/tests/due-date-edit.spec.ts` · `apps/web/evidence/due-date-edit/`（4 图，人已看）· `apps/mobile/evidence/android-timeline-schedule.png`（人已看）。**实施中发现并修掉**：行内 absolute 弹层被带 transform 的滚动容器裁掉（白边）⇒ Portal 到 body + fixed + 实测锚点 + 滚动即关；同族缺陷在 `TaskOrganizer` 实测存在，已登记审计文档 §4 追加发现，范围外待立项 |
| 二 | ✅ **已完成（2026-10-02）** | `verify:mobile-inbox` 真机零 mock 全绿：① 双账号真通知（B 走 `POST /api/register/magic-link` 带 A 的码，TEST_MODE autoVerifyUsers 自动验证并结算邀请 → A 徽标「1 条未读」≥1 → 通知行出现）；② 活动 tab 读到自己邀请码（content-desc 抓值）+ chooser 真出现；③ 打开（自动已读）后徽标清零；④ 截图 4 张人已看。变异：拿掉自动已读 ⇒ ③ 转红（台账本行）。mobile 510 测试 + typecheck 绿；`check:ui-language` 词条 2694/2694 同步。**实施中修掉两个环境坑**（入 traps #93/#94）：共享 `configure_sync_credentials` 对设置 IA 过时（字段搬进了 Modal，凭此修好全族脚本）；prefab CLI + JDK 24 的 stderr 告警被 AGP 当错误（钉 JDK 21 于用户级 gradle.properties） | `scripts/verify-mobile-inbox.sh` · `apps/mobile/src/screens/NotificationsScreen.tsx` · `apps/mobile/evidence/android-inbox-*.png` · `docs/reference/environment-traps.md` #93/#94 |
| 三 | ⛔ **停批（2026-10-02，依赖裁决不过——goal 硬规则 4 的既定出口）** | 逐一裁决了四个候选（ghinfo + npm 元数据实测）：① `@notifee/react-native` 9.1.8 —— **repo 已 archived**、末版 2024-12，§3.1 不过；② `react-native-push-notification` 8.1.1 —— archived、停在 2021，§3.1 不过；③ `wix/react-native-notifications` 5.2.2 —— MIT、未归档、2025-11 发版，两道门过、**构建过**（RN 0.84 原生编译实证），但 **v5 已无本地调度 API**（`NotificationsAndroid` 只剩 FCM 注册 + channel；`postLocalNotification` 仅即时）——功能裁决出局；④ `expo-notifications@57` —— MIT、发版活跃，两道门过，但 **pnpm monorepo 布局卡死集成**（`install-expo-modules` 断言崩溃；expo 源码自注 includeBuild 不吃 symlink——见 traps #95）——集成裁决出局。**没有任何候选同时过两道门并满足"本地调度"功能** ⇒ 本批终止，不手搓原生轮询绕行。依赖树已还原（wix 移除、许可门禁绿、510 测试绿）。**解锁条件（满足其一即重开）**：a) 仓库改用 hoisted node_modules 布局后走 expo-notifications（需另立仓库级裁决）；b) notifee 解除归档或出现过门禁的维护 fork；c) 有一条新的过门禁候选 | 判据脚本已先行落地：`scripts/verify-mobile-reminder-ring.sh`（触发链设计也写在文件头，重开时直接用）· traps #95 |
| 四 | ✅ **已完成（2026-10-02）** | `verify:mobile-account` 真机真服务端 **13/0**：`/api/test/create-user` 每轮建已知密码账号 → 「账号与安全」真 UI 改密（含服务端策略拒绝的真实路径——`NewPass456` 在 HIBP 泄露库被拒，共享 `passwordPolicyMessageKey` 措辞原样呈现）→ **令牌轮换落盘 + 同步仍通（变异靶：拿掉落盘 ⇒ 恰好 1 红「登录凭据已失效」，12 绿）** → 新密码经 `/api/login/email-password` 换新会话 → 旧令牌 401 全局失效 → passkey 空态如实（**注册登记排除**：移动端无 WebAuthn 桥，`auth/passkey-host.ts` 是结论不是占位）。mobile 510 + tsc + `check:ui-language`（2734/2734）绿；截图 2 张人已看。**实施中修掉的基础设施坑**：共享 lib 的 `configure_sync_credentials` 对设置 IA 过时（字段在 Modal 里）、`another_mobile_e2e_running` 会把 zsh -c 包装壳误判成并行验收、pkill 漏杀的僵尸实例、以及**专属模拟器隔离**（AVD 固定 `-port 5556` + `HEYTA_E2E_SERIAL` 机制 + `/tmp/heyta-infra-journal.log` 基础设施日志——回应与 iOS 会话的 #114–116 互踩） | `scripts/verify-mobile-account.sh` · `apps/mobile/src/screens/SecurityScreen.tsx` · `apps/mobile/evidence/android-account-*.png`（人已看）· `/tmp/heyta-infra-journal.log` |
| 五 | ✅ **已完成（2026-10-03）** | `verify:mobile-restore` 真模拟器 + 真服务端 + **真浏览器导出**，零 mock：**26 项全绿 / exit 0**（当前产物 `57b0780f` 那轮，08:26–08:35；原文引的 run23 = 24 项已被 run27 起的 26 项取代，更正见 §7.6）。四条判据：① 两条入口都在（选文件 / 粘贴），粘贴的垃圾内容被预检拒绝**且界面说出人话**；② 选文件 → 预检展示 counts（任务 3 · 清单 1 · 标签 1 · 5 条操作日志）→ 确认 → 「还原成功」，随后**截断版走同一条文件路径**也被拒（一个字节都没写）；③ 任务列表数得见 3/3（标签 chip `backup-tag-1` 也在屏上）；④ 还原后同步**不落失败态**（0s 内落到「已是最新」），且手机**自己**写的那条 op 在 20s 内出现在服务端（新增 1 个备份里没有的 opId）。🔴 **④a 原来断的是"备份 opId 要出现在服务端"，那是断错了不变量**：还原走 `appendImported`，这些 op 带的是**原设备**的 clientId，服务端 `validateOp` 对不匹配的署名逐条回 `INVALID_CLIENT_ID`（`validation.service.ts:75`）⇒ 设计上就不上行；改成断真正的不变量（不落失败态 + 自己的写还能出去），命中数只打印不判定。**同一次运行照出一个真缺陷**：成功语 `mobile.restore.done` 写着"配置同步后会自动上行"——每个字都是假的，已按产品事实改写并中英同步。**变异两条，各自精确**：M1 拿掉 `handleRestoreText` 里"把拒绝原因说出来"那一步 ⇒ **14 绿 2 红**，红恰好是②后半「截断文件没被拒绝」+ ①后半（其余 14 条仍绿 = 变异没有连带破坏）；M2 让 `confirmRestore` 什么都不写（按钮留着）⇒ **14 绿 2 红**，红恰好是②「没看到还原成功」+ ③「0/3」。两条臂都按**三段 sha256**（变异前 / 还原后逐字节相同）收口。新增基础设施：Android 原生模块 `HeytaLocalFs.readTextUri`（RN 0.84.1 在 Android 上根本读不出本机 URI，traps #124）+ `local-file-read.ts` 的 blob 退路。**实施中修掉的探针/环境缺陷 6 类**（traps #135–#139）：验收栈三份产物不同代（服务端进程 18:56 早于 dist 00:53、E2E 库少两条迁移被旧进程掩盖）、`focus_is` 的 `grep -o` 把组件名截断⇒两条前台判定恒假、helper 定义在首次调用之后被 `\|\|` 吞成警告、**键盘带吃掉下半屏点击**（「确认还原」被打成一个字符 `v`；修法是把会立键盘的那一步挪到这块屏最后 + 每处点击前 `require_keyboard_down`）、点了 FAB 不等于面板开（`input tap` 抛 Java 异常而退出码 0）、设备被别的会话的 app 抢走（`cloud.finlaw.ssos`）⇒ 新增 `require_our_app_foreground` 与开局的服务端同代探测（401=在 / 404=旧⇒exit 3）。验收服务端在**自己的端口 3100** 上从当前 dist 起重，不动别的会话占用的 3000。**收尾时又复跑一轮 run24（03:39–03:48）：25 项全绿 / 0 失败** —— 多出的那 1 项是**文案真实性判据**（成功语必须含「只在这台设备上」）：只断"还原成功"四个字的话，那句假文案改回去也照样绿。同一轮实测自快照 bootstrap 真在跑（进程是 `scripts/.verify-mobile-restore.sh.snap.<pid>`），并把本脚本登记进 `check:script-snapshot` 的 MANIFEST —— 那道门禁的文件头明写"新增长跑 .sh 要加进来"，而它**原来抓不住我**（不加就一路绿灯） | `scripts/verify-mobile-restore.sh` · `apps/mobile/src/screens/ExportScreen.tsx` · `apps/mobile/src/lib/local-file-read.ts` · `apps/mobile/android/.../fs/LocalFsModule.kt`+`LocalFsPackage.kt` · `e2e/restore-export.cjs` · `apps/mobile/evidence/android-restore-{done,tasks}.png`（**两张都已人眼看过**：成功语含新文案、任务 3 条 + 标签 chip）· traps #124–#129、#135–#139 · `docs/research/multi-end-entry-coverage-audit.md` P1-2（含三条边界）· `/tmp/restore-run23.log`、`/tmp/restore-run24.log`（收尾复跑，25/0）、`/tmp/g5-restore-run27.log`（🔴 **布局改动后在 `8ecc0575` 上再复跑一轮**：B21 那笔把还原卡的 6 处内联样式换成了 `Card gap` / `Stack` prop ⇒ "装上的产物"变了，按 traps #27 的方向必须在**新产物**上重跑设备判据。同一轮 android 重装截图主蓝命中与改动前**同为 4036**，这是"零视觉代价"的判据。）、`/tmp/restore-m1.log`、`/tmp/restore-m2.log` |
| 收尾（check + reinstall:all + 审计回填） | ✅ **已完成（2026-10-03）—— 但 objective 里"`pnpm check` 全量绿"这一条未达成，原因逐条列在下面，没有一条是本批放宽判据换来的** | **① 提交（共享工作树归属纪律）**：本条线四笔 —— `51d828c5` 批五还原卡（20 文件 / +1748 / −18）、`ee5b96e8` 桌面端 vite 解析锚点（3 / +47 / −22）、`771c35c9` 补 `OpLogEngine.getAllOps`（1 / +12）、`9a0ea6d5` 把构建挪到 `check` 链首 + 修掉本批自己带来的两道红（5 / +111 / −8）。全部用 plumbing（`commit-tree` + `update-ref` CAS）只提自己那批路径，**别人 9 条暂存条目最终完好**（`BLOCKED.md`/`PROGRESS.md`/`Podfile.lock`/`package.json`/`pnpm-lock.yaml`/`server/*` 等）。🔴 **但 `263cebb6` 抢了别人的归属**：它的 blob 用**单边界**（起点 → EOF）取"我自己那段"，而那八分钟里另一条会话把自己那条 traps `150`（弹层边界）追加到了我那条后面 ⇒ 对方整条 23 行被一并提交。**内容未改未丢**，由 `427f74f5` 更正（我那条例位为 **#151**，对方保持 150），根因与"取自己那段必须写双边界"写进 #151 本体。🔴 中途还**犯了两次**"刷索引覆盖别人暂存条目"（第一次 4 条、第二次 2 条），全部无损复原，修法已从文档搬进脚本 —— 见 traps **#146**。<br>**② `pnpm check` 断点之后的 57 段逐段实测**（`/tmp/heyta-seg-loop.sh`，干净检出 `/tmp/heyta-g5`，删掉全部 dist 起跑）：**53 绿 / 4 红**。本批自己带来的 2 道红**当场修掉并复绿**（`check:rn-aria`：批一 DatePicker 的对象形态 `accessibilityState` → `aria-selected`；`check:shell-unicode`：本批脚本 5 处 `$var` 紧跟中文）。剩下 4 道红：`check:l4`（`apps/mobile/src/screens` 内联样式 **113 > 基线 90**（门禁口径，它数之前先 `stripComments`；纯 grep 是 116），开工前一笔 `ccd3cd83` 实跑即 111>90，属 M3 的账；🔴 **本批给棘轮添了 2 处** —— 还原卡的 `Card gap` 与预览块 `View gap`，登记见 BLOCKED **B21**，不顺手放宽基线）。🔴 **本批那 2 处当场清掉了，B21 已解除**：`057ec9b7` 给 `Card` 加可选 `gap` 档（默认 = 原来的 `space.2` ⇒ 其余 11 张卡渲染逐字节不变）+ 新增 `Stack`，`7420d8d7` 修掉 `Stack` 第一版 `{...rest}` 排在 `style` 前会**静默丢弃调用方样式**的缺陷；`ExportScreen.tsx` 的 **6 处**（本批 2 + 既有 4）全部换成 prop，门禁打印的数 **113 → 107**（一次消掉 6 处，比 B21 原计划的 ≤109 更多），该文件已不在"含内联样式的文件"清单里。基线 90 仍然红 —— ~~剩的 **17 处全部属 M3**（B18）~~ ⚠️ **这句已被 B27 逐条 blame 否证**：超线部分里有 **10 处是本条线批四**新建 `SecurityScreen` 那一笔（`804842be`）写进去的，已按 B27 的动作清掉 9 处、留 1 处（那一处是"子卡视觉表面"：背景色 + 圆角 + padding 一起，属表面不属布局意图，为消它去给共享层发明第二处没人用的 API 不划算）。当下读数是 **apps/mobile/src/screens 内联样式 98 > 基线 90**（多 8 处，08:5x 用 `pnpm check:l4` 复量），剩的 8 处才归 M3。本批的 +2 归零，**没有动基线**）、`check:empty-state`（收尾时 2 处红，**已修到 1 处**：`NotificationsScreen` 那处是**判据缺陷** —— 它用的是权威共享 `EmptyState`，而 marker 按"文件里出现过空态词条"记账，把"照门禁自己给的修法做"判成违规；收紧成"只数落在 `<EmptyState …>` 之外的渲染"后 E4/E5/E6 三份探针实测仍能红，并按门禁自己的提示对账移除 2 条陈旧登记（26→24，逐行取证 `InboxBell.tsx:223`/`InviteActivityCard.tsx:145`）。🔴 **剩的 1 处我先前记成"属「账号与安全」那条线、不代改" —— 那条归属是错的，这里撤回**：`SecurityScreen.tsx` 正是**本 goal 批四**交付的那一屏（§7 第四行的产物清单里就有它），我把"另一条产品线"和"本 goal 的另一批"混成了一个词，于是把自己线的债登记成了别人的。一条写错的归属比没有归属更贵 —— 它让这笔债看起来有主，于是没人再看它。**修法按门禁给的第 2 条出路做**（`c7f0e33a`）：给共享 `EmptyState` 补 `size?: ${BT}page${BT} | ${BT}section${BT}` 一档（默认 `page` ⇒ 现有站点零像素变化；"section 不画图标"这条判断做在 `model.ts` 里而不是组件写 `if`，因为"传了参数却什么都没画"是最难归因的那类静默丢弃），`SecurityScreen` 的通行密钥空态改消费 `size="section"`。新增 4 条模型用例 + **变异臂**（把那条三元换成 `icon`）**恰好 1 红**、三段 sha256 逐字节还原。⇒ **`check:empty-state` exit 0**（从 2 处红到零），`check:design` / `check:rn-aria` / `check:ui-provider` 全 0，`@heyta/ui` 442 passed、`apps/mobile` typecheck 0 + 538 passed、`check:l4` 移动端计数不变（107，没新增内联样式）。**没有**往 `EMPTY_SITES` 加一行（那等于把债合法化）。<br>🔴 **但"零像素变化"这句话被设备那一轮证伪了**：`c7f0e33a` 的组件里仍是 `toEmptyStateViewModel({ icon, title, hint, detail, detailTone })` —— 没把 `size` 传进去。于是**模型完全正确、442 条用例全绿、门禁 exit 0**，真机上那行「还没有通行密钥」却被撑成**居中 + 上方一大片空白**（页面档）。三段式 props → 模型 → 视图 里，中间那条转发**没有任何一层在判**，而本包的测试跑在 node（不引 DOM 栈），所以这一层唯一的判据就是实际渲染（§6.2 规定一）。修法 `d25161ce` 不是"再补一条测试"，是把这条缝从设计上消掉：`toEmptyStateViewModel(props)` 整体转发，以后加槽位不可能漏传。修后在 `d25161ce` 上重装 android + 重跑 `verify-mobile-account`：**13 项全绿 / 0 失败 / exit 0**，截图 `apps/mobile/evidence/android-account-security.png` 已人眼看过：那行回到卡片左侧的一行小字，与改动前同形）、`check:ai-e2e`（**98 passed / 3 failed**）、`check:landing-e2e`（15 passed / 2 failed；🔴 归因已做在 **B24**：判据 `docs-centre.spec.ts:950` 数的是 `img[src^="/assets/docs/"]`，而产物在 `public/assets/help/`（`git ls-tree -d HEAD` 只有 `help`）—— `f82ace65` 把页面从 `help/` 搬到 `docs/` 时图片目录没跟着搬，属文档中心那条线，且 `helpFigures.ts:217` 早就预言过"改一处会让另外几处悄悄断"）。<br>🔴 **这条红的归因我改过两次，最终版在 BLOCKED B22**：最初写"并发干扰"（e2e 端口写死 4318/4319、`reuseExistingServer:false`、preflight 会 SIGKILL 别人的 dev server，且另一条会话 B19 记的占端口进程正是我 04:21 起的那条），**05:16–05:19 低负载复跑把它证伪了** —— `--workers=1`、两个端口无监听、`loadavg 7.17/16` 下**三条全部复现**（15 passed / 3 failed）。真身是**提交态落后于别人未提交的工作**：主树里 `view-tabs.ts`(+25/−11)、`App.tsx`(+108/−36)、`CalendarView.tsx`、`DueEditor.tsx`(+39/−10) 全是 `M`，而同一批 spec 在主树 04:31 与 04:58 跑绿。与 traps #147 / BLOCKED B20 同族，只是这次藏的是**行为**不是文件。本批在 web 侧只改了 DatePicker 的无障碍属性写法，失败元素上 `aria-selected="false"` 已在 ⇒ 不是本批引入。<br>🔴 **05:45 复跑时数到第 5 道红：`check:docs` 9 处**（2 处失效的章节引用 + 7 处"本机有、仓库里没有"的死链）。逐条落在 `docs/adr/0044-countdown-anniversary-*.md`、`docs/plans/README.md`、`goal-layout-audit.md`、`ui-review-fill-zh-timeline.md` —— **全部是别的条线尚未 `git add` 的文件**，也就是 BLOCKED **B20** 那个形状的文档版（已跟踪的文档指向未跟踪的目标 ⇒ 干净检出上是死链）。本批不代改，也**没有**为了变绿去动 `UNTRACKED_LINK_OK` 那张豁免表。<br>🔴 **06:12 复测又数到第 6 道红：`check:typecheck`（`apps/web`）** —— `apps/web/tests/calendar-view-family.spec.tsx:93` 把 `HTMLButtonElement | undefined` 传给要 `HTMLElement | null` 的形参。那个 spec 是**未跟踪**的新文件（别的条线在写），与本批无关：本批在 web 侧只改了 DatePicker 的无障碍属性写法。同场复测为 0 的：`check:empty-state`（见上）、`check:ui-provider`、`check:rn-aria`、`check:design`、`check:shell-unicode`、`check:script-snapshot`（28 个脚本在位）。<br>**③ 四端重装**（`scripts/reinstall-all.sh`，全部在隔离检出跑 ⇒ 装的是**提交态**产物）：**mac ✅**（.app+.dmg 重打、装进 /Applications、主蓝命中 **1137**、内容占比 100%、**暗色**主题下真应用）、**windows ✅**（源码同步 + sha256 对账 `5653e872…`/`879483a5…`，远端取证四条 `ADD_APPX=OK` `RESULT=OK` `PAYLOAD_WEBDIST=True` `M2D=OK`，截图是**真应用 + 身份菜单开着**）、**android ✅**（release APK 63M 重打、emulator-5556 全新安装、主蓝 **4036**；🔴 布局改动后在 `7420d8d7` 上**重跑了一轮**，主蓝仍是 **4036** —— 同一个数就是"零视觉代价"的判据，不靠"我觉得没变"）、**ios ✅**（Release 重打 + 全新安装、新鲜度判据"已装的包比源码新"、主蓝 **4136**）。🔴 **四张截图我逐张看过**（§6.2 规定一）：三端首屏都是真中文界面 + 首启隐私同意面板，mac 那张是暗色主题的收集箱。<br>**⑤ 布局改动后的设备复跑，顺带照出共享层一条假绿**（05:44–05:5x 实测）：为 B21 那笔重装完 android（`7420d8d7`，主蓝 **4036**，与改动前**同一个数**）后跑 `verify:mobile-restore`，**run25 只跑了 2 项就打印「✅ 移动端备份还原：真机全链路通过」并以 exit 0 结束** —— 根因在共享层：`scripts/lib/mobile-e2e.sh` 的 `summary()` 自己就 `exit`，所以全部 16 个中止点写的 `summary "X"; exit N` 里那句 `exit N` 是**死代码**；`FAIL` 为 0 时它一律打印"✅ …真机全链路通过"并返回 0。也就是说"环境不成立 / 中途放弃"与"25 项跑完且通过"在输出上**逐字相同** —— 被欺骗的不是某条断言，是整个脚本的成败，而 CI 与人都会照着 `exit 0` 记账（元规则 2 的最坏面目）。🔴 **这条假绿不影响批五已入账的结论**：`/tmp/restore-run23.log` 打印的是「通过 24 项」、`run24` 是「通过 25 项」，两轮都真跑完了。修法 `447f9f64`：`summary` 收第三个参数 = 这一轮应当以什么码结束（`FAIL>0` 时 1 优先），并按码打印不同判决行（3 打「本轮在环境上不成立」；1 且 `FAIL=0` 打「未跑完就中止」，"通过"和"有失败项"两句都不许出现）。判据 6 条（`/tmp/heyta-summary-probe.sh`，把 lib 里那段函数原文抠出来单测，不 source 整个 lib 以免碰它的顶层副作用）+ **变异臂**（拿 `HEAD` 那版跑同一条自检 ⇒ 第一条就红；直接复现是 `summary "X" "" 3` 在旧函数下 exit 0 + ✅）+ **设备现场复现**（`/tmp/g5-restore-run25b.log`：同一条环境失效，修后打印「⏭ 本轮在环境上不成立」并以 **EXIT=3** 结束）。同场加一条 `8ecc0575`：web 载体（`WEB_BASE`，判据②的输入要从它导出）**原来不在开局前置里**，没起它就一路跑到第 2 步才 `ERR_CONNECTION_REFUSED`，而第 0 步已经把设备 `pm clear` 了 —— 白烧一轮且红字读起来像产品坏了；现在与 `legal-consent` 同代探测并列在开局判掉并以 3 结束。（`check:shell-unicode` 当场把我新写的那行抓住：`$WEB_BASE_URL` 紧跟全角括号 ⇒ 变量名被吞，已改 `${WEB_BASE_URL}`。）这两条**已落号**：traps **#152**（共享判决函数自己 exit ⇒ 16 个中止点的 `exit N` 全是死代码）与 **#153**（props → 模型 那条转发缝没有任何一层在判），提交 `34adfeee`。<br>🔴 **"等它落定"这个前置其实等不来**：撞号可以量（HEAD 与工作树两边各扫一遍取 max+1，当时两边都是 151），而"对方整文件 `git add` 会把我这两条抹掉"只能靠动作规避 —— blob 仍从 HEAD 出发（**0 行删除**，不带别人未提交的尾部），同时把**同一段纯追加**到工作树文件末尾（脚本用 `wt2.startsWith(wt)` + 长度逐字节校验"只追加不改行"）。这样对方 add 之后两条都还在、且只出现一次。。本轮复跑：**run27（05:56–06:04，隔离检出 `8ecc0575`，`PORT=3100` + `WEB_BASE` 的 4322 载体）：通过 26 项 / 失败 0 项 / **exit 0**（分母从 25 变 26 是因为新增的那条前置判据自己也被 `ok()` 计数 —— 不是原有判据变多）。<br>**④ 审计回填**：goal §7 五行（一~五 + 本行）、`docs/research/multi-end-entry-coverage-audit.md` P1-2 三条边界、traps **#146/#147/#148/#151/#152/#153/#154**、BLOCKED **B15 解除 / B16 / B18 定稿 / B21 解除 / B22 / B23 两处全解除（含撤回一条错误归属）/ B25（本文件索引里那份比 HEAD 少 650 行）/ B26（ios 段在旧检出上不可跑）**。🔴 其中 **#150 是一条自我推翻**：我一度实测出"`pod install` 复现不出提交态 `Podfile.lock`（401/1141、216 vs 228）"并准备入档，复测两次（热跑 + 删 `Pods` 冷跑）后是 **2 行 `SPEC CHECKSUMS`（hermes-engine / ReactCodegen）、PODS 段 146/146、`check:native-deps` 绿** —— 提交态**是**可复现的，那条"结构性缺陷"是我一次口径没钉死的读数。 | 四笔提交 `git show --stat` · `/tmp/heyta-seg-loop.sh` 与 58 份 `/tmp/seg-*.log` · `/tmp/rr-{12,13,46,49,50,51,52,53,54,57,57b,57c}.log` · `/tmp/g5-ri-{mac,mob,mob2,win}.log` · `/tmp/heyta-reinstall-{mac,apk,ios-build,win}.log` · 四张已看截图 `/tmp/heyta-reinstall-mac-installed.png.webview.png`、`/tmp/heyta-g5/dist/windows/packaged-first-run.png`、`/tmp/heyta-reinstall-android.png`、`/tmp/heyta-reinstall-ios.png` · `apps/mobile/evidence/android-restore-{done,tasks}.png` · `/tmp/g5-restore-run25.log`（**假绿本体**：2 项 / ✅ / exit 0）· `/tmp/g5-restore-run25b.log`（同一失效，修后 ⏭ / EXIT=3）· `/tmp/g5-restore-run27.log`（新产物上全量复跑）· `/tmp/heyta-summary-probe.sh`（6 条判据 + 变异臂）· `/tmp/g5-ri-android2.log`（改动后重装，主蓝 4036） |

---

> 📌 **一条仍然活着的风险（2026-10-03 05:43 实测）**：`BLOCKED.md` 在主树里是**别人未提交**的文件
> （`MM`：暂存里有一份、工作树又改了）。我按归属纪律用 plumbing 把 **B21 解除段**提进 `beda8a10` 之后
> 实测三处命中数：`git show HEAD:BLOCKED.md` = **1**、`git show :BLOCKED.md`（他们暂存的那份）= **0**、
> 工作树那份 = **0**。也就是说他们下一次**整文件** `git add BLOCKED.md` 会把这一段**静默抹掉**
> —— 内容不丢，"已解除"这个事实丢（traps #146 / `263cebb6` 的同一个形状，只是方向反过来）。
> 我**没有**去改他们正在用的那份文件。恢复只需 `git show beda8a10:BLOCKED.md`；
> 而本行与上面 §7 收尾行第 ② 条互为备份 —— 这个事实不只住在一个会被整文件覆盖的地方。

### 7.1 🔴 收尾后补的三端重装（2026-10-03 06:38–07:01）

上面那行"四端重装"是在 `c7f0e33a` **之前**取的，而 `c7f0e33a` + `d25161ce` 改了 `packages/ui`
⇒ 按 §6.1.1 的"每端装的是当前源码的产物"，mac / ios / windows 三端必须重打重装
（android 已在 `d25161ce` 上重跑过：`REINSTALL_EXIT=0`、主蓝 4036、`verify-mobile-account` 13/0）。

| 端 | 判据（全部从日志与取证文件现抽，不手抄） |
|---|---|
| mac | 主蓝命中 **1137**（`/tmp/g5-ri-miw.log`，隔离检出 `/tmp/heyta-g5`） |
| windows | ADD_APPX=OK · RESULT=OK · PAYLOAD_WEBDIST=True · M2D=OK（四条从 `dist/windows/install-capture.txt` 抽，主日志里没有它们）；源码对账 web-dist/index.html=23b3330c672afef1… bridge=879483a56bd6379b… |
| ios | 主蓝命中 **4136**；✅ 已装的包比源码新 —— 这一轮装的是当前产物；沙盒 本来就同步 ⇒ 兜底**没有触发**（新克隆里我先单独跑过一次 pod install）（旧检出上兜底把红引到了真原因：`/tmp/g5-ri-ios2.log`；本次在`/tmp/g5-ri-ios3.log`，新克隆 `/Users/rocalight/heyta-ios-ri`） |

🔴 **ios 段前两次在 `/tmp/heyta-g5` 那棵长活的旧检出上跑红，而且红得有理**：
`reinstall-all.sh` 的 ios 段以前一个字都没提 pod（`grep -n 'pod ' scripts/reinstall-all.sh` 命中 0），
换一次 HEAD 之后 `Pods/Manifest.lock` 与 `Podfile.lock` 对不上，xcodebuild 第一步就死在
`[CP] Check Pods Manifest.lock`。
补了沙盒同步兜底（`840effb1`：不一致就跑 `pod install`、装完再验一次、仍不同步就**跳过 xcodebuild** 且
**不再 tail 上一轮的构建日志**）。兜底第一次跑就把人引到了真问题上；但旧树里 `pod install` 本身崩在
CocoaPods 的 "path name contains null byte"，最后是在**同 commit 的新克隆**里跑绿的
（`git clone` + `pnpm install` 4.9 秒）。A/B 证明路径不是变量（`/tmp` 下新克隆也成功）——
全过程与"包管理器自己的 up-to-date 不能当排除证据"记在 traps **#154**。

汇总三段全部 ✅、两轮 `REINSTALL_EXIT` 分别为 1（旧检出）与 0（新克隆）。ios 跑绿的 commit 是
`840effb1`，当前 HEAD 是 `9359ba41`，两者之间 `git diff --name-only` 命中
**1 个文件、其中 apps/packages/server/e2e 为 0**（本脚本对此有硬判据，非代码变更
才允许把结论写成"装的是当前产物"）。🔴 这一轮之后，"四端装的是当前产物"这句话才是当前状态。

### 7.2 🔴 收尾的最终一轮：改完移动端 UI 后在 `6834b4ae` 上重证 + 4 道红的逐条归因（2026-10-03 07:2x–07:3x）

B27 那笔还账（`bb41e9fe`：`Stack` 补 `gap="tight"`、新增 `HStack`、`Text` 补 `grow`，`SecurityScreen` 清掉 9/10 处内联样式）
动的是 `apps/mobile/src/**` ⇒ 按 §6.1.1，**装过当前产物**这句话只对没被它影响的端继续成立。所以本轮做了三件事：

**（1）重装范围按"输入有没有变"划，不靠感觉**

`git diff --name-only d25161ce..HEAD` 共 26 个文件，其中
`apps/web/` `apps/desktop*` `packages/` 命中 **0**（mac 与 windows 装的是 `apps/web/dist` + 各自壳源码）
⇒ 这两端 §7.1 的判据（mac 主蓝 1137 / windows 四条 + sha 对账）**仍然是当前状态**，不需要重跑，
而 `apps/mobile/src/` 命中 2 个 ⇒ android 与 ios **必须**重跑。这一条是"哪端可以继承上一轮结论"的判据，
不是"应该没事"。

**（2）两端重跑结果**（隔离检出 `/Users/rocalight/heyta-ios-ri`，detached 在 `6834b4ae`；主工作树此刻有并行会话未提交的
`AuthScreen.tsx` / `CalendarScreen.tsx` / `apps/web/src/**`，在里面跑会把他们的代码装进包）

| 端 | 判据（现抽） |
|---|---|
| android | 汇总判词 `✅ android：已清旧包、重打、重装、有当前产物判据`；release APK 重打 → `emulator-5556` 全新安装 `Success`；
  启动截图 1080x2400、内容占比 55.4%、**主蓝命中 4036** —— 三个数与 `d25161ce` 那轮**逐项相同** |
| ios | 汇总判词 `✅ ios：已清旧包、重打、重装、有当前产物判据`；模拟器 `heyta-iphone-17pro`（`FE195661-B021-4A71-AAD1-1F2F7AE3A102`）；
  Pods 沙盒不一致 ⇒ **兜底真的触发了一次**（`pod install` 改 lock 4 行后 `Manifest.lock == Podfile.lock`）；
  1206x2622、内容占比 61.5%、主蓝命中 **4136**（与 §7.1 那轮的 4136 / 61.5% 逐项相同）；✅ 已装的包比源码新 |
| 这一屏 | `verify-mobile-account` 在重装后的包上 **通过 13 项 / 失败 0 项**；两张证据图聚合值与仓库里那两张逐项相同
  （通行密钥屏 主蓝 8425 / 内容 8.1%，改密成功态 主蓝 9254 / 内容 9.2%），**人都看过** |

⚠️ 覆盖边界（同 B27）：`HStack` / `Text grow` 只活在通行密钥**列表行**里，而移动端无 WebAuthn ⇒ 设备上这一屏永远空态，
那两样**没有像素级证据**，只有代码级等价 + typecheck + `@heyta/mobile` 测试。

**（3）`pnpm check` 的 4 道红：逐段循环实测 + 逐条归因**

链断在第一红后其余不跑，所以把 57 段逐段跑了一遍（`/tmp/g5-segloop2.log`，隔离检出）。红的是这 4 段：

| 段 | 名字 | 实测内容 | 归因 |
|---|---|---|---|
| 12 | `check:l4` | screens 内联样式 98 > 基线 90（多 8） | 本条线欠的 10 处已清 9 处（`bb41e9fe`），剩 8 处按 B27 的 blame 属 M3 那条线。**门禁绿在本条线不可达** |
| 49 | `check:ai-e2e` | **3 failed / 98 passed**（`8b41648a` 干净检出 07:5x 复跑，与逐段循环同数） | B22 已把归因点到**三枚未提交文件**：`DueEditor.tsx`（弹层永不 stable）、`App.tsx` + `view-tabs.ts`（日历没登记进标题回落表 ⇒ 页头挂着「收集箱」）。**不是本条线欠的，也不是用例坏了** |
| 51 | `check:landing-e2e` | **2 failed / 15 passed**（同一轮复跑，未变） | B24 已取证：**判据断在一个没人实现过的目录名上**；未提交侧没有对应修复文件，归因不变 |
| 57 | `pnpm -r test` | server 4 个文件加载失败：`JWT_SECRET environment variable is required`（其余 103 文件 / 2005 条全过） | 🔴 **环境红，不是产品红**，而且反证做了两半：机制上 `server/.env` 被 `server/.gitignore:5` 忽略 ⇒ 任何干净克隆都没有它；行为上补一个随机 `JWT_SECRET` 后那 4 个文件 **4 passed / 43 tests passed**（`/tmp/g5-jwt-proof.log`，`rc=0`）。🔴 **但这条定性后来被推翻了一半**：CI 的唯一形态就是干净检出，所以这是链的缺陷 —— 已按仓库既有约定修掉，见 §7.5 |

**补一条主线直测（2026-10-03 08:00）**：上面那句"主线是绿的"当时只有机制推论，现在量过了 ——
`pnpm --filter @heyta/sync-server test` 在**主工作树**上 **exit 0**，**110 个文件全过（共 110）**、**2091 passed / 1 skipped**（总 2092），
而且这一跑是踩在别人**未提交**的 `server/src/auth.ts` 等改动上做的，仍然全绿。
⇒ 第 4 道红的定性从"干净克隆缺 gitignored 配置"升级为"同一套用例在有配置的树上实测通过"，
   不留"把推论当证据"的尾巴。

⇒ **"pnpm check 全量绿"在本轮不可达**，而且不可达的原因一条都不是"本条线留了坏东西"：
1 条是别人的棘轮账（本条线的账已清）、2 条已由 B22/B24 归因、1 条是取证环境的 gitignored 配置。
把这条写在这里而不是删掉那 4 行，是因为"我全量绿了"如果被读成一句假话，下一位会照着它建判据。

**（4）本轮顺手修掉的两件**（都不属于批五，撞见了就修完）

- `6997592c` + `6834b4ae`：验收横幅自报的设备号是 17 个脚本各抄一份的字面量 ⇒ 收成 lib 的 `$E2E_SERIAL`，
  改后 `git grep '设备: emulator-5554'` 命中 **0**。上一笔提交信息里写"其余 9 个"是**读了截断样本数错的**，实测 16，
  更正写在这里（提交信息不改历史）。
- B28 / traps #156：HEAD 基 blob 提交让磁盘永久落后 ⇒ 现在每次提交后把同一段追加回磁盘。

### 7.3 Goal 完成审计（逐条对照任务书，2026-10-03 07:4x）

**① 批五③ 移动端「从备份还原」还原卡** —— ✅ 达成。
选文件 + 粘贴兜底 + `parseExportDocument` 预检 `counts` + `restoreIntoEmptyTarget`，
i18n 中英复验过（`check:ui-language` 绿）。落点见 §5 与上面各批行。

**② 批五④ `verify-mobile-restore` 判据转绿** —— ✅ 达成。
真模拟器 + 真服务端零 mock；关键判据做过变异验证；截图人真的看过；
审计文档 §3 矩阵与本节逐条回填。

**③ 收尾批四条** —— 三条达成，一条**不可达且原因逐条编号**：

| 收尾项 | 结论 | 证据 |
|---|---|---|
| `pnpm reinstall:all` 四端装当前产物 | ✅ 成立，但**取证分两批** | android / ios 在 `6834b4ae` 重跑（§7.2）；mac / windows 的判据在 `d25161ce` 上取，**继承的合法性来自对账**：`d25161ce..HEAD` 里 `apps/web` / `apps/desktop*` / `packages/` 命中 0 |
| `pnpm check` 全量绿 | 🔴 **不可达（缺口已从 4 缩到 3）** | 57 段逐段循环：4 段红（§7.2 表；§7.4 另证这 8 笔没引入新红；**§7.5 把其中 `-r test` 那道修掉了**）。**没有一条是本条线欠的账** —— l4 剩 8 处属 M3（B27）、ai-e2e 3 条属"提交态落后于别人未提交的工作"（B22）、landing-e2e 2 条属判据断在没人实现的目录名（B24）、`-r test` 4 文件是干净克隆缺 gitignored 的 `server/.env`（两半反证都在 §7.2） |
| 按归属纪律提交 | ✅ 达成 | 收尾这一轮 4 笔（`bb41e9fe` / `6997592c` / `6834b4ae` / `ef67b0d4`），每笔都点名路径 + plumbing，判据行统一打印 `别人暂存条目: 提交前=9 提交后=9 丢失=0`；`0/0` 的 filemode 变化（`verify-mobile-quadrant-fill.sh` / `-sort-sheet.sh`，别人的）被排除在清单外 |
| Goal 完成审计 | ✅ 就是本节 | —— |

**硬性约束逐条自查**：红线先行 ✅（批三合法停批，判据脚本先行落地）·
一个意图一个 op ✅（还原走 `restoreIntoEmptyTarget` 单 op，未 fan-out）·
未 bump `CURRENT_SCHEMA_VERSION` ✅（`d25161ce..HEAD` 里 `packages/shared-schema` 命中 0，
且两端 `git grep` 到的都是 `= 1`）·
未引入新依赖 ✅（`check:licenses` 绿）·
i18n 中英同步 ✅（`check:ui-language` 绿）·
验收全程后台、未抢前台 ✅（`nohup` + `--only`，无 `bringToFront`）。

**留给别人的（编号已登记，不摊成谁的待办）**：
B27 的 8 处 l4 债（M3 线）· B22 的 3 条 ai-e2e · B24 的 2 条 landing-e2e ·
B20 的 7 处未跟踪生产者（`check:docs` 在工作树上因此红，干净检出绿）·
`HStack` / `Text grow` 的设备像素证据（要先在 web 端给同一账号注册一枚通行密钥）·
`-r test` 在干净克隆必红（要么给 verify 流程补一份测试用 `.env`，要么把 `JWT_SECRET`
变成测试自己的 fixture —— 属服务端那条线，本条线只登记）。

**取证现场处置**（都不删，删了下一位就没法复跑）：
隔离克隆 `/Users/rocalight/heyta-ios-ri`（android + ios 两段的重证环境，
B26/#154 的结论就是从这里来的）、`/tmp/heyta-ios-ab`（57 段逐段循环 + A/B 的现场）、
`/tmp/heyta-g5`（§7.1 那三端）；日志 `/tmp/g5-ri-android-b27.log`、
`/tmp/g5-ri-ios-b27.log`、`/tmp/g5-account-b27.log`、`/tmp/g5-jwt-proof.log`、
`/tmp/g5-segloop2.log` + `/tmp/seg2-*.log`。要腾空间就先删 `/tmp/heyta-ios-ab`
（1.1 G node_modules，它的结论已全部落进文档），**别删 `heyta-ios-ri`** ——
ios 段只在**新克隆**上跑得动（#154），删了下次要重新 clone + install。

### 7.4 ✅ 收尾这 8 笔**没有引入任何新红**（两轮 57 段逐段循环的红段集合逐字相同，2026-10-03 08:1x）

§7.2 那张 4 道红的表是在 `ab487d9f` 上量的，而它之后本条线又落了 8 笔
（l4 还账 `bb41e9fe` / 设备号 `6997592c` + `6834b4ae` / 台账 `ef67b0d4` + `8b41648a` + `2831111d` …）。
"我改的都是文档和脚本"是**意图**，不是证据 —— 所以把整条链在干净检出（`/tmp/heyta-ios-ab`，
detached 到 `2831111d`）上又逐段跑了一遍：

| 轮 | 跑在哪枚 commit | 段数 | 红段集合 |
|---|---|---|---|
| 基线 | `ab487d9f` | 57 | 12:check:l4 · 49:check:ai-e2e · 51:check:landing-e2e · 57:-r |
| 现在 | `2831111d` | 57 | 12:check:l4 · 49:check:ai-e2e · 51:check:landing-e2e · 57:-r |

🔴 两轮红段集合**逐字相同**（新增红 0 段、消失红 0 段），53 段绿。
两处细节也复验过没漂：`check:l4` 仍是 **98 > 基线 90（多 8）**（即 §7.2 记的那 8 处，属 M3），`-r test` 的失败原因仍是 `JWT_SECRET environment variable is required`（同 4 个 server 文件）。

📌 这条的价值不在"绿了多少段"，而在**把"我只改了文档"这句自我陈述换成一次可比对的实测**：
同一套 57 段、同一台机器、两枚 commit，红段集合的差集为空 —— 这才是"没引入新红"的可复核形态。

### 7.5 ✅ 第 4 道红（`pnpm -r test`）**修掉了**，不是登记掉的（2026-10-03 08:2x）

§7.2 把它定性成"取证环境缺 gitignored 的 `server/.env`"——那句是对的，但**结论下早了**：
CI 的唯一形态就是干净检出，所以"干净检出上必红"本身就是这条链的缺陷，不是环境的错。
仓库里早就有解决它的约定：需要令牌的 spec 自己用 `vi.hoisted` 把 `JWT_SECRET` 放好
（`password-recovery.spec.ts`、`magic-link-registration.spec.ts`、`replace-token-expiry.spec.ts` 都是这么写的），
因为 `getJwtSecret()` 跑在 `src/auth.ts:48` 的**模块顶层**。这 4 个文件没跟上约定，
只是被开发机上的 `.env` 长期遮住了 —— 其中 `email-locale-wire.spec.ts` 连 `JWT_SECRET` 都没提，
是**经 import 链**（`../src/api` → `src/auth`）加载到那行的，所以"它到底会不会读环境变量"是查出来的，不是假设的。

| 步 | 结果 |
|---|---|
| 4 个文件各插一个 `vi.hoisted` 块（`??=`，不覆盖自己设过值的文件） | 命中数逐文件断言 =1 |
| 干净检出（`/tmp/heyta-ios-ab`，**没有** `server/.env`、`src/auth.ts` 是提交态）跑那 4 个文件 | **4 passed (4) / 43 tests passed**，`rc=0` |
| 🔴 变异：把其中一个文件退回提交态（没有那个块）再跑 | **`Test Files 1 failed`**、报回原错 `JWT_SECRET environment variable is required`，`rc=1` ⇒ 这块是**承重的**，不是装饰 |
| 同一棵干净检出跑整段 `pnpm -r test` | **`RTEST_EXIT=0`**；server **107 文件全过**、**2048 passed / 1 skipped**（总 2049） |

⇒ 57 段链在干净检出上的红段从 **4 段变成 3 段**（`check:l4` / `check:ai-e2e` / `check:landing-e2e`），
剩下这 3 段逐条属别人那条线（§7.2 表 + B22/B24/B27）。**"全量绿"仍然没达成，但缺口从 4 缩到 3，
而且这 3 段没有一个是可以靠"给测试补配置"糊过去的**。

📌 **顺手把这三笔有没有影响四端重装也算了一遍**：`6834b4ae..HEAD` 共 7 个文件，其中打包输入（`apps/mobile/src` / `apps/web/src` / `packages/` / `apps/desktop*`）
命中 **0**（改的是 server 测试与文档）⇒ §7.2 那两轮重装判据（android 4036 / ios 4136 / mac 1137 / windows 四条）
仍然是当前状态，不需要为这三笔重跑。

### 7.6 ✅ 还原屏在 UI 重构**之后**的设备级重证（26 项 / 失败 0，2026-10-03 08:26–08:35）

批五当初交付时，审计文档 §3 的 P1-2 那行引的是 **run23 = 24 项**（02:46–02:51）。
此后这个屏动过两次：`8ecc0575` 给脚本加了首条「web 载体可达」判据，`bb41e9fe` 把
`SecurityScreen` 的内联布局换成了 kit 的 `Stack` / `Card gap`。所以"还原屏还能跑通"
在 08:26 之前只是**继承**，不是**证据**。这一轮把它变成证据：

| 项 | 实测 |
|---|---|
| 被测产物 | 干净检出 `/tmp/heyta-ios-ab`（detached `57b0780f`），`vite preview --port 4322` 起 web 载体（HTTP 200） |
| 设备 | `HEYTA_E2E_SERIAL=emulator-5556`（在线的是这台；§7.2 记过 5554 不在）+ `PORT=3100` 真服务端 |
| 结果 | **通过 26 项，失败 0 项**，`EXIT=0`（日志 `/tmp/g5-restore-b27.log`，末行「✅ 移动端备份还原：真机全链路通过」） |
| 截图 | `apps/mobile/evidence/android-restore-{done,tasks}.png` 已换成本轮。**人真的看了**：done 图是「已从备份还原 3 条任务 —— 只在这台设备上…」+ 三条 `backup-task-*` + `backup-tag-1` chip；tasks 图是列表页 3/3 |
| 聚合值 | done `1080x2400 内容=13.8% 主蓝=16534 透明=false 空白=false`；tasks `1080x2400 内容=11.9% 主蓝=4689`（主蓝命中 ⇒ §7 第 82 条那条"非空白不等于是这个界面"的判据成立） |

🔴 **一条差点被我改成"缺陷"的东西**：done 图上的成功句看着像 ASCII 的 `--`（两个短横中间有缝）。
读真源确认 `mobile.restore.done` 里是 `——`（两个 U+2014），缝是**设备字体的渲染**，
不是文案、也不是拼接错误 ⇒ **没有动任何文案**。截图上"看着不对"要先回到源字符再定性。

📌 **读数量级纪律（写进 B28 同族）**：`ok` 在这份脚本里的**调用点**是 21 处，
跑出来的 ✅ 是 **26** 条 —— 凭据三格（服务器地址 / 访问令牌 / 加密口令）由一个循环点位打。
所以"24 → 26"里只有 1 项来自 `8ecc0575` 新增判据，其余是**同一份脚本在两趟里的执行计数差**，
不能读成"又补了 2 条断言"。引用 N 项必须带**哪一趟**（时刻 + 日志名）。

这条同时**收窄**了 §7.2 里那条覆盖边界：那节写的是 `HStack` / `grow` 只活在通行密钥列表行、
设备上永远是空态 ⇒ 无像素证据。**那条仍然成立**（还原屏用的是 `Stack` / `Card gap`，
不是 `HStack`），本轮补上的是"重构后的移动端布局原语在真机上有过像素证据"这一半，
不是把那条边界撤掉。

### 7.7 ⚠️ 57 段链的**第 4 段红**换了成员（`check:docs`），但**同一枚提交在干净检出上 exit 0**（2026-10-03 08:4x）

§7.5 之后共享工作树上的红段是 3 段（`check:l4` / `check:ai-e2e` / `check:landing-e2e`）。
08:4x 复跑 `pnpm check:docs` 得到 **exit 1**（2 处失效章节引用 + 7 处"本机有仓库没有"的链接），
所以链上现在是 **4 段** —— 但这一段的性质与另外三段不同，取证在 **B29**：

| 判 | 读数 |
|---|---|
| 报出来的 9 行落在哪些文件 | `docs/plans/README.md`、`goal-layout-audit.md`、`ui-review-fill-zh-timeline.md`、`adr/0044-*.md` ⇒ **本波一个都没碰** |
| 那些链接行在提交里吗 | `git show HEAD:…` 逐行对照：`README.md:110` 在 HEAD 是**空行**，`goal-layout-audit.md:80,81` 是另一段内容 ⇒ **链接活在未提交的工作树里** |
| 干净检出上红不红 | `/tmp/heyta-ios-ab`（detached `57b0780f`）`node research/tools/docs-link-check.mjs` ⇒ **`CLEAN_DOCS_EXIT=0`** |
| 指向的目标文档 | 3 枚（`countdown-anniversary.md` / `adr/0044-*` / `research/countdown-anniversary-data-and-images.md`）**磁盘在、git 未跟踪** |

⇒ **HEAD 没坏**，红只在"混合工作树"这一种形态上成立，属倒数纪念日那条线的在飞状态
（链接写了、目标文档还没 `git add`）。关闭判据与"为什么不代改"写在 B29。

📌 这条同时给 §7.4 那句「两轮 57 段的**红段集合逐字相同**」补上它本该带的限定：
那个"相同"是**那两分钟窗口内**的读数，不是不变量。共享工作树里红段集合是**活物**——
成员会变（这次变的还不是我这条线的）。引用它必须带 **HEAD sha + 时刻**，并且把"集合相同"
读作"我这批没引入新红"的证据（仍然成立：变化的那一段命中的文件我一个都没碰），
而不是读作"仓库当时只有这几段红"。

⚠️ **上面那句"⇒ HEAD 没坏"被我自己推翻了**（08:5x，写下约 10 分钟后）：B29 里"关闭判据"那行
为了说明别人写错了，打了 `docs/adr/README.md` 紧跟 `§1` —— **转述坏引用的那句话自己就是一处坏引用**。
干净检出复跑到 `d86f0439`：`BLOCKED.md:2352 -> docs/adr/README.md ⇒ §1`、exit 1。

收窄后的结论：**`57b0780f` 那趟 exit 0 仍然成立**（那 7 处"本机有仓库没有"确实只活在未提交的工作树里），
但**从 `4a06d0fd` 起 HEAD 上多了本条线自己的一处**。已改写形状并把机制记进 traps #158 末段
（判据 `SECTION_REF_RE` 只允许 `.md` 与 `§N` 之间夹可选反引号 + 空白）。
⇒ 这条把 §7.7 原本的教训补全了：**归因跑完不等于归因结束，写完要立刻在干净检出上复跑同一条命令** ——
上一秒的 exit 0 不担保下一句写完还是 0。

### 7.8 收尾复核（2026-10-03 08:5x，HEAD `e56f0e22`）

| 项 | 现量 |
|---|---|
| 本波 `6834b4ae..HEAD` 改了哪些路径 | 10 枚：`BLOCKED.md`、2 枚 `apps/mobile/evidence/android-restore-*.png`、4 枚文档（goal / traps / 审计 / 本文件）、4 枚 `server/tests/*.spec.ts` |
| 其中命中**打包输入**的吗 | `git diff --name-only 6834b4ae..HEAD -- apps/mobile/src apps/web packages/ apps/desktop*` ⇒ **0** ⇒ §7.2 那两轮四端重装判据（android 4036 / ios 4136 / mac 1137 / windows 四条 + sha 对账）**没有失效**，不需要重跑 |
| 本波自造的那处红 | 干净检出复跑 `docs-link-check`：`d86f0439` 1 处红 → `81054ba1` **3 处红**（我把门禁原文抄进台账，那一行自带 `.md` 与 `§N` 的邻接）→ `e56f0e22` **`POST_EXIT=0`** |
| 提交前预验（换了顺序的那一步） | 把三枚候选 blob 拷进干净检出复跑 ⇒ `PRE_EXIT=0`；量完 `git checkout --` 还原，克隆脏行数回到 0 |
| 现场 | 我起的 `vite preview :4322`（PID 48539，cwd `/private/tmp/heyta-ios-ab/apps/web`）已终止，端口监听数回到 0。**:3100 上那枚 `node dist/src/index.js` 的 cwd 是主工作树的 `server/`，不是本会话起的 ⇒ 不动**（归属判定逐枚 `ps -o command=` + `lsof -d cwd`） |
| 克隆的取舍 | `/tmp/heyta-ios-ab` 留着（还原屏 26/0 那轮的证据载体，删了这条腿要按配方重建）；`/Users/rocalight/heyta-ios-ri` 留着，理由见 traps #154 |

**Goal 四条收尾判据的当前状态**：① `pnpm check` 全量绿 **未达成且不可达**（干净检出剩 3 段外部红：
`check:l4` 剩 8 处属 M3 / `check:ai-e2e` 对应别人未提交的 `DueEditor.tsx`+`App.tsx`+`view-tabs.ts` /
`check:landing-e2e` 是 B24 的判据缺陷）；② `pnpm reinstall:all` 四端重装 **已达成**（§7.2 + 本表第一行）；
③ 归属纪律 **已达成**（本波 16 笔，每笔打印「别人暂存条目 提交前=9 提交后=9 丢失=0」）；
④ Goal 完成审计 **本节即是**。⇒ 因此 **不**把 Goal 标成 complete：第 ① 条要求的是全量绿，
而它现在剩下的每一段都不在本条线手里。

### 7.9 ✅ 两条变异臂（M2 与 M1）都在**当前产物**上重证通过，两趟读数已复制进仓库

批五入账的两条臂（M1/M2）是在布局重构**之前**的产物上跑的。这一轮把两条臂都在当前产物上重跑，
全程在隔离检出 `/tmp/heyta-ios-ab`（链脚本 `/tmp/g5-m2-chain.sh`、`/tmp/g5-m1-chain.sh`）：

| 环节 | 臂 M2（被验树 `bb1eba75`） | 臂 M1（被验树 `731618ec`） |
|---|---|---|
| 变异 | `confirmRestore` 在写库之前 `return`（按钮留着、不崩、不报成功），命中恰好 1 处；`sha256 MUT=479bfe31…` | 预检不通过时**不再把拒绝原因说出来**（`setRestoreError(restoreReasonMessage(…))` → `undefined`），"一个字节都不写"那一步保持不变；`sha256 MUT=18e173c9…` |
| 变异产物 | 重打 release APK，md5 `1c861e00…`，`install -r -g` → `Success` | 重打 release APK，md5 `b3e4e249…`，`install -r -g` → `Success` |
| 判据腿 | **通过 23 项 / 失败 2 项 / exit 1**：`❌ 没看到还原成功确认`（判据②）+ `❌ 任务列表只见 0/3 条`（判据③）；其余 23 条仍绿 ⇒ 变异没有连带破坏 | **通过 24 项 / 失败 2 项 / exit 1**：`❌ 截断文件没被拒绝`（判据②后半）+ `❌ 找不到「粘贴备份内容（JSON）」输入框`；其余 24 条仍绿 |
| 还原校验 | `sha256 POST=f925a23c…` **与 PRE 逐字节相同** | 同一枚 `POST=f925a23c…`，**与 PRE 逐字节相同** |
| 复绿校验 | 重打干净 APK（md5 `438532f5…` ≠ 变异那枚）→ 重装 → 复跑 **26 项 / 0 失败 / exit 0** | 同一条 S9/S10 → 干净 md5 同为 `438532f5…` → 复跑 **26 项 / 0 失败 / exit 0** |

🔴 **两条臂的干净 APK md5 是同一枚**，这不是"两臂其实是同一轮"：两臂被验的 HEAD 之间只有 docs 提交
（`bb1eba75..731618ec` 全部命中 `AGENTS.md`/`README.md`/`docs/**`，打包输入零命中）⇒ Metro 构建确定性
让干净产物逐字节相同。这一条要这样写清楚，否则"同一个数"读起来像在说第二次没跑。

🔴 **两趟的原始日志当时只写在 `/tmp`，其中一批已被同机会话扫走**（traps #159）。所以这一轮起
读数**当场复制进仓库**：`apps/mobile/evidence/verify-mobile-restore-arms-20261003.txt`
（由 `/tmp/g5-mk-digest-v2.mjs` 从链日志与两份判据日志生成，不手抄；文件里把红→绿的**配对行号**也一并打出来），
两张证据图也换成复跑那一轮（`android-restore-done.png` 主蓝 16547 / `android-restore-tasks.png` 4702，
均非空白，**两张都打开看过**：成功语含"只在这台设备上"、三条 `backup-task-*` + `backup-tag-1` 在屏）。

🔴 **生成器自己写错过两次，都被当场抓到**：
① "被验产物"最初取的是**实时** `git rev-parse HEAD`，而 M1 链已经把同一枚检出推进到 `731618ec`
⇒ 摘要会把 M2 记成验一棵没验过的树。改成**只从链日志的 S1 行取**，取不到就抛错（不猜）—— traps **#160**。
② "变异腿的红在复跑腿是否重新变绿"最初按**核心词**配对（取红句前 4 字去绿句里找），这条启发式会**静默错配**：
`找不到「` 这类核心词在绿句里根本不存在（红绿在脚本里是两种措辞），而"取 bad 附近最近的一条 ok"会抓到
**上一条判据**的 ok（M2 那条红曾被配到 `成功语说清了边界`，真配对是 `还原成功（界面确认）`）；
而带变量的 bad 文案（`任务列表只见 $SEEN/3 条`）逐字匹配必然找不到。
改成按**分支结构**配对（bad 在 else 分支 ⇒ 取同一个 if 的 then 分支里第一条 ok，途中用 `fi` 计数跳过嵌套块；
bad 在一行式 then 位置 ⇒ 取 else 分支里第一条 ok），文案两边先归一化（`$VAR` 与数字都洗成空格）再比，
并把 `bad @行号 → ok @行号` 打进摘要让配对可复核；同一条 bad 文案在脚本里出现两处（347 是入口判据、579 是步骤 6）
时**两处都列出**，不假装知道本轮 fired 的是哪一处 —— 本轮由日志顺序判定是 579（它排在"截断文件"那条之后）。
⇒ traps **#165**。

### 7.10 最终复核（2026-10-03 09:5x，HEAD `c444d827`）：一条红的归因**前置条件已经变了**，另两条现量不变

这一节是 Goal 完成审计的一部分。它只做一件事：把 §7 各节里"以某枚 HEAD 为条件"的结论
逐条拿来在**当前 HEAD** 上重新量一遍，量的时候顺手确认归因还成立不成立。

| 门禁 | 上一轮读数 | 本轮现量（同一口径） | 归因是否仍是原来那句 |
|---|---|---|---|
| `check:l4` | screens **107 > 90**（多 17 处） | screens **98 > 90**（多 **8** 处）；web features 98 ≤ 104 | ✅ 仍是 M3 的债（B18），但**处数不是本条线写的数**：这 9 处是别条线在 `731618ec..a29881e9` 之间重构掉的。🔴 本条线在含内联样式的 12 个 screens 文件里**一个都不出现**（`ExportScreen.tsx` 自 `731618ec` 起零改动，`git diff --name-only` 为空）⇒ B21 的"本批 +2 归零"仍然成立 |
| `check:landing-e2e` | 15 passed / 2 failed | **同一枚 `0c171df1` 上实跑（10:00–10:01）：15 passed / 2 failed，`PLAYWRIGHT=1`** ⇒ 与上一轮读数逐字相同，红没被修。浏览器里的 DBG 行直接给出页面渲染出的 `src`：`/assets/help/first-run/W01-tasks.png`，且 `mainImgs` 与配图张数相等（图真的解码出来了） | ✅ B24 的取证成立：**判据断的是一个不存在的目录名**，产物侧四处表达都是 `help`。🔴 两条出路仍**由文档中心那条线选**，我没有代改（理由写在下面第 ③ 条与 B24 本体） |
| `check:ai-e2e` | 98 passed / **3 failed** | ✅ **已实测定性：113 passed / 2 skipped / 0 failed，`E2E=0`**（隔离检出 `/tmp/heyta-g5`，被验树 `0c171df1`，09:54–09:59，5.5 分钟） | ✅ **B22 的归因被证实**：那三枚文件提交之后，三条红全部转绿 ⇒ 真身确实是"提交态落后于未提交的工作"，不是产品缺陷，也不是并发干扰 |

🔴 **`check:ai-e2e` 那 3 条红的归因到了必须重验的时候。** B22 写的是"提交态落后于别人未提交的
工作"，点名三枚文件（`DueEditor.tsx`、`App.tsx`、`features/shell/view-tabs.ts`）当时是 ` M`。
现在它们**全部已提交**（`adb627cc feat(due)` / `c0783d2f feat(web)`，`git status` 里已消失）。
也就是说那句归因的**唯一支点被抽掉了** —— 它现在有两种可能：那 3 条随同这批提交一起变绿了，
或者它们本来就是真红、只是此前被"未提交的工作"挡住了归因。**这两种在文档里长得一样，
但不做重跑谁也不能说自己是哪一种**，所以这里登记的是**待验**，不是结论。
元规则 1 的又一种面目：一条归因的寿命等于它的前提，前提消失时它必须**重跑或被撤回**，
不能因为"当时是这么写的"就继续当现状读。

本轮没有跑它的两个原因，都不是"怕麻烦"：
1. **现场负载**：`vm.loadavg` 实测 **80.64 / 42.39 / 30.97**（同机另有 5 条别条线的 vite 在跑）。
   Playwright 在这种负载下产出的读数没有资格写进台账（§7 #46：没观测到 ≠ 没发生，观测本身坏的时候更坏）。
2. **`check:ai-e2e` 的 preflight 会 SIGKILL 别的会话的 dev server**（traps #87），而此刻别人正在
   `packages/ui/src/calendar` 上写代码。这道门禁的副作用落在别人身上，不在别人活跃时按它。

✅ **这两个原因在 09:54 都被消掉了，于是补了跑，B22 就此定性。** 负载从 80.6 降到 **16–26**，
而第二个原因不需要负载配合 —— 那条 kill 只活在 `scripts/check-ai-e2e-preflight.mjs` 里，
它的职责只是"清掉占端口的旧进程"，所以我自己**核端口**（`4318`/`4319` 监听数都是 0）之后直接跑
`pnpm --dir e2e run test`，绕开 kill 而不改变被测内容。前置也全部重做到"与源码同代"：
隔离检出 `git fetch && reset --hard` 到 main（`HEAD=0c171df1`，`dirty=0`）→ `pnpm install`（倒数日批次
带来了 `lunar-typescript`，不装就是旧代产物，见 traps #27）→ `pnpm -r build`（`BUILD=0`）→ `e2e && pnpm install`。

结果：**113 passed / 2 skipped / 0 failed，`E2E=0`**（5.5 分钟）。
⇒ B22 的归因**被证实**：那三条红确实是"提交态落后于未提交的工作"，随那批提交一起转绿；
它不是产品缺陷，也不是我最初写的"并发干扰"。分母从 101 涨到 115 是别条线新增的用例，不是本轮改了什么。
**这条现在可以关闭**（关闭句写在 BLOCKED.md B22 本体里，不只在对话里）。

现场清理：本条线起的 `vite preview :4322`（PID 27009，cwd 是隔离检出 `/tmp/heyta-ios-ab/apps/web`）
已终止并复查端口无监听。`:3100` 那枚服务端进程的 cwd 是主工作树，不是本条线起的 —— 不动（§7 归属纪律）。

**Goal 四条的终态**（逐条对照 objective，不合并、不概括）：
① 批五③ 还原卡 JSX + i18n 中英复验 —— ✅ 完成（`51d828c5` 起，i18n 两侧同代，设备判据①②在跑）。
② 批五④ 判据转绿 + 变异验证 + 截图人看 + 审计回填 —— ✅ 完成：当前产物 **26 项 / 0 失败 / exit 0**（run27），
   两条变异臂各自在当前产物上重证（M2 23/2、M1 24/2，三段 sha256 逐字节还原 + 两枚 APK md5），
   读数与配对行号已进仓库（`apps/mobile/evidence/verify-mobile-restore-arms-20261003.txt`），
   两张图都打开看过；审计文档 §3 矩阵与本文 §7.1–§7.10 已逐条回填。
③ 收尾批 —— **部分完成，且未完成的那一条不在本条线手里**：
   `pnpm reinstall:all` 四端重装 ✅（§7 收尾行 + §7.8），
   按归属纪律提交 ✅（本条线累计 15 笔，`git show --numstat` 逐笔核对别人暂存条目丢失=0），
   `pnpm check` 全量绿 ❌ **未达成**：57 段链里当前有 **2** 段红，
   分别是 `check:l4`（M3 的 8 处内联样式，B18）与 `check:landing-e2e`（B24，文档中心条线）。
   `check:ai-e2e` 已实测定性转绿（见上），从 3 段减到 2 段。
   🔴 **B24 我没有代改，而且这是刻意的**：那一条里写着我自己在 05:30 取证后留下的边界
   —— "两条正当出路（由那条线选）… ⚠️ 不要'为了让套件绿'随便挑一条 … **本条不代改**"。
   选 1（把 `public/assets/help/` 搬到 `docs/`）会改**线上 URL** 并要求重跑 `check:entries`（75 份入口产物逐字节对账），
   选 2（把 spec 的三处字面改回 `/assets/help/`）等于**替那条线承认**"页面在 `/docs` 而图在 `/assets/help`"这个不一致是长期形态。
   两者都是产品决定，不是判据修复；而我这个 Goal 的完成条件不能靠替别人做决定来凑。
   ⇒ 我只补了那条线**缺的那一块证据**（下面 B24 里新增的实测行），把改动撤回，红如实留着。
   两段红没有一段是本条线引入的，而"不为了变绿去放宽基线/改别人的判据/吸收别人的债"是本 Goal 的硬约束，所以这里如实记红。
   ⇒ **因此本次不将 Goal 标记为 complete**：③ 的第一句没做到，做不到。

### 7.11 终局快照（2026-10-03 10:0x，HEAD `69f64ae4`）：① ② 的每一条都还在绿，缺口只剩 ③ 的两段

这一段是给"下一位"的：本 Goal 交付完之后，哪些证据仍然当场可复现。全部在同一枚 HEAD、
工作树对本条线零脏文件的状态下现量（不是引用早先的读数）：

| 复验项 | 命令 | 读数 |
|---|---|---|
| 界面文案必须是中文词条（批五新增的那批也在内） | `pnpm check:ui-language` | **0** |
| 中英两张词条表本身 | `pnpm --filter @heyta/i18n test` | **0** |
| 移动端类型 | `pnpm --filter @heyta/mobile typecheck` | **0** |
| 移动端单元测试 | `pnpm --filter @heyta/mobile test` | **538 passed / 538** |
| 空态登记（本批曾把它从 2 处红修到 0，又添过判据缺陷） | `pnpm check:empty-state` | **0** |
| RN 无障碍属性写法（批一那处红就是它抓的） | `pnpm check:rn-aria` | **0** |
| 设计变量裸值 | `pnpm check:design` | **0** |
| shell 里的 `$var` 紧跟中文 | `pnpm check:shell-unicode` | **0** |
| 长跑脚本快照（`verify-mobile-restore.sh` 在 MANIFEST 里） | `pnpm check:script-snapshot` | **0** |
| UI Provider 边界 | `pnpm check:ui-provider` | **0** |
| 移动端产物（bundle/Hermes 魔数那类） | `pnpm check:mobile-bundle` | **0** |
| 死链 / 失效章节引用 / 锚点（含本文件新增的引用） | `research/tools/docs-link-check.mjs`（干净检出） | **0** |

🔴 **没有绿的也一并写清**：`check` 链在此 HEAD 上仍有 2 段红 —— `check:l4`（M3 的 8 处内联样式）与
`check:landing-e2e`（B24 的两条出路），处置与代价登记在 **BLOCKED.md B30**；`check:ai-e2e` 已实测转绿并关闭 B22。

本会话为收尾又落 4 笔，逐笔 `git show --numstat` 核对"删除别人 0 行 / 别人暂存条目丢失 0"：
`c444d827`（双臂读数与配对行号进仓库 + traps #165）、`0c171df1`（§7.10 + B22 改记待重验）、
`3e5cef9b`（B22 关闭 + B24 只补证据 + 审计回填两条臂）、`69f64ae4`（B30）。

### 7.12 把链逐段单独跑了一遍：`pnpm -r test`（第 59 段）**也是红的**，两条都在这一轮当场修完（2026-10-03 10:3x，HEAD `a2d0d634`）

§7.11 的标题写着"缺口只剩 ③ 的两段"。**那句在写下的那一刻就少算了一段** —— 它是从"`&&` 链
断在第一红之后"推断的，而推断不能替实测。这一轮把链**逐段单独跑**了一遍（`/tmp/g5-seg-lite.sh`，
跳过需要设备/GUI/重负载的 12 段；`check:ai-e2e` 与 `check:landing-e2e` 按 B22/B24/B30 单独实测过），
才看见第 59 段 `pnpm -r test` 也是红的：

| 段 | 修复前现量 | 成因 / 归属 | 修复笔 |
|---|---|---|---|
| `pnpm -r test` → `server/tests/password-reset-page.spec.ts:74` | **1 failed / 22 passed**，而且对**所有机器形态**都红 | `ce23d3ab`（10-03 10:16）改语言不变量时翻了三份判据，**漏了第四份**（该文件 10-01 18:45 `b87e8844` 就在） | `c1395bf8` |
| `pnpm -r test` → `server/tests/account-profile.spec.ts` | 干净检出上 `Test Files 1 failed` + **`Tests no tests`**（27 条一条没跑）；主检出全绿 | `7e299118`（09:38）用 `import 'dotenv/config'` 拿测试密钥，属 §7 第 **157** 条那一类的**第 5 个成员** | `a2d0d634` |

两条都不是"再跑一遍就好"的东西，也都不是本条线欠的账（是本会话**撞见**的仓库级红），
所以按硬约束当场修完，且都不是为了让套件绿而改判据：
- 第 1 条改的是**判据方向**，依据是已经落到 main 上、并由那三份判据钉住的新产品不变量；
  补的反向断言之外还加了同页的 🔴 阳性对照（`?lang=en` 仍切英文），两次变异方向相反、
  各只打红一条 —— 细节与一般规律写进 §7 第 **167** 条。
- 第 2 条改回仓库**自己已有**的约定（`vi.hoisted` + `??=`），并补
  `server/tests/test-env-contract.spec.ts` 让这条约定**第一次变成会失败的判据**
  （三条判据 + 一条分母断言；匹配前 `stripComments`，用"注释里提到 import 的文件不红"这条臂证承重）。

🔴 本轮内我一度把第 2 条判成"隔离检出缺 `server/.env` 的**探针缺件**"。
**那句定性是错的**，错法与第 157 条第一次那次一模一样：干净检出是 CI 的唯一形态，
"我这台机器绿"不构成排除证据。它当时看起来可信，是因为主检出确实全绿 —— 而这两棵树形
**只有把同一条判据各量一次**才分得开谁在说谎。写在这里是为了下一轮不把它当现状引用。

修复后的现量（两种树形各量一次，不是推的）：

| 载体 | 有 `server/.env` | server 整片 `vitest run` | 全仓 `pnpm -r test`（第 59 段） |
|---|---|---|---|
| 主工作树（`a2d0d634`） | 有 | **111 files / 2095 passed / 1 skipped** | — |
| 隔离检出 `/tmp/heyta-g5`（detached @ `a2d0d634`） | 🔴 无 | **111 files / 2095 passed / 1 skipped** | **20 个 test 任务全过，`INNER_EXIT=0`** |

server `tsc --noEmit` 另量一次 exit 0（第 162 条：`vitest` 绿不等于 `tsc` 绿）。

⇒ 到这里 ③ 的"check 全量绿"仍然**未达成**，但缺口从"三段"收回成实测的**两段**
（`check:l4` 98 > 基线 90、`check:landing-e2e` 15/2），两段各自的归属、闭合代价、
"这一轮为什么不付"见 **BLOCKED.md B30 / B30.2**。硬约束（不放宽基线、不改别人的判据、
不吸收别人的债凑绿）优先于把链凑绿，所以 Goal 的 ③ 依旧如实记未达成。

### 7.13 把 seg-lite 跳过的 11 段补量到 7 段：加上本轮共 **8 段**拿到当前提交态上的实测读数（2026-10-03 10:4x，`d78f8414`，干净检出）

§7.12 那句"缺口只剩两段"仍然带着一个**没量过的集合** —— 逐段跑的时候按名字跳过了 **11** 段
（`/tmp/g5-seg-lite.sh:19` 的 `SKIP` 串；48 段跑、11 段 SKIP、总 59 段，三个数都由
`node -e "…p.scripts.check.split(' && ')…"` 从 `package.json` 现取，不靠记忆）。
这一轮在同一个载体（`/tmp/heyta-g5` detached @ `d78f8414`，无 `server/.env`）把其中 7 段补了一遍，
先跑 `pnpm --filter "@heyta/web..." build`（`BUILD_EXIT=0`）再量，避免拿旧 dist 读数；
`check:native-deps` 本来在 48 段里跑过，这里复量一次：

| 段 | 现量 | 用时 |
|---|---|---|
| `check:native-deps` | ✅ exit 0（iOS 原生依赖对账：5 个 pod 全部命中 `Podfile.lock`） | 1s |
| `check:windows-shell` | ✅ exit 0（bridge bundle 1296525 B 生成后按平台跳过） | 5s |
| `check:linux-shell` | ✅ exit 0（GTK4 装不到 macOS ⇒ 响亮跳过） | 0s |
| `screenshot:verify` | ✅ exit 0（注册表 23 个目标，已生成的尺寸/alpha 全对） | 1s |
| `check:arkts` | ✅ exit 0（真实编译器 macOS `es2abc` 过 ArkTS 产物） | 0s |
| `check:arkts-widgets` | ✅ exit 0（`WidgetParse.ts` → 7084 B PANDA 字节码） | 1s |
| `check:mobile-bundle` | ✅ exit 0（android/js 双端 Metro bundle，`react` 只有 1 份） | 44s |
| `check:privacy-consent-e2e` | ✅ **7 passed / 0 failed / `INNER_EXIT=0`**（真浏览器 + PROD 构建 + :4322 自己的 preview） | 7.5s |

剩下 4 段各有各的处置，都不是"没顾上"：

- `check:landing-e2e` —— 实跑 **15 passed / 2 failed**（§7.10 与 B30 已记），红在 B24 那条线上，
  ⚠️ **本条不代改**（B24 原文写着两条出路"由那条线选"）。
- `check:ai-e2e` —— 本轮 09:5x 实测已转绿（B22 因此关闭）。**这一轮没有重跑**，理由不是负载：
  它的 preflight 会把**自己那对端口**（4318/4319）上正在监听的进程 SIGKILL 掉
  （`scripts/check-ai-e2e-preflight.mjs:74-88`，端口是参数、杀之前打印 pid 与进程名，traps #87），
  而这条链的副作用会落在别人身上 —— 现场此刻有别人的 :4321 dev server（pid 13957，已 15 分钟）、
  两台 iOS 模拟器里跑着的 Heyta（pid 44087 / 47506）与一个 13 小时的 `HeytaMac`。
  要复量：`cd /tmp/heyta-g5 && pnpm run check:ai-e2e`（前提是先确认 4318/4319 上没人）。
- `check:macos-shell` / `check:macos-window` —— **没有跑**，两条理由都当场可核对：
  ① 本机此刻 `loadavg 28.45 / 40.01 / 41.76`，Swift 整包编译会挤掉别人正在跑的设备验收；
  ② 窗口门禁靠"标题 = heyta 的主窗口"选窗（traps #81.2），而现场已经有一个
  `HeytaMac` 实例（pid 25394）在跑 —— 同名窗口会让它比的是**别人的窗口**。
  要复量：先确认没有别人的 `HeytaMac` 与同名窗口，再 `pnpm run check:macos-shell && pnpm run check:macos-window`。

⇒ 于是 ③ 的"check 全量绿"这句现在是**逐段有读数、且每个读数写明在哪个提交上量的**：

| 桶 | 段 |
|---|---|
| 在 `d78f8414` 的干净检出上实测 exit 0 | 上表那 **8 段** |
| 在同一棵树上、但更早的提交上实测 | seg-lite 那 **48 段**（@ `cde861c3`，10:19–10:21：**46 段 exit 0**，两段红 = `[12] check:l4` 与 `[59] pnpm -r test`；后者已在 §7.12 修掉）、`check:ai-e2e`（09:5x 那次 113 条，B22 因此关闭） |
| 🔴 红 | `check:l4`（B30.1 逐处 blame）与 `check:landing-e2e`（B24 的两条出路待人拍） |
| 本轮没复量 | `check:macos-shell` / `check:macos-window`（现场归属，理由见上） |

⚠️ 口径提醒（traps #158）：`d78f8414` 之后 main 仍在被别人推进，**每个读数只对量它的那个提交成立** ——
下一轮要引用哪一段，先在同一棵树上把那一段重跑一次，别把过期的读数当现状。


本轮补量之前，seg-lite 那 48 段的**逐段读数**（载体：干净检出 `/tmp/heyta-g5`，HEAD=`cde861c3`，10:19:15→10:21:03；跳过清单是 `/tmp/g5-seg-lite.sh:19` 的 `SKIP` 串，共 11 段。⚠️ 段名列取的是命令的**第二个词**（脚本用 awk 取第二个字段），所以 `02. --filter` 是 `pnpm --filter @heyta/landing check:entries`、`59. -r` 是 `pnpm -r test`。traps #159：`/tmp` 会被同机会话扫走，所以整份读数复制在这里，不留 `/tmp` 引用）：

```
01. build  exit=0  13s
02. --filter  exit=0  0s
03. typecheck  exit=0  13s
04. check:claims  exit=0  0s
05. check:reachability  exit=0  1s
06. check:migrations  exit=0  0s
07. check:token-hashing  exit=0  0s
08. check:layering  exit=0  1s
09. check:ui-provider  exit=0  0s
10. check:theme  exit=0  1s
11. check:row-single-source  exit=0  0s
12. check:l4  exit=1  0s
13. check:empty-state  exit=0  1s
14. check:widgets  exit=0  1s
16. check:adaptive-cards  exit=0  1s
17. check:pwa  exit=0  0s
18. check:ui-language  exit=0  1s
19. check:docs-voice  exit=0  0s
20. check:legal-copy  exit=0  0s
21. check:legal-host  exit=0  0s
22. check:licenses  exit=0  1s
23. check:licenses:nuget  exit=0  6s
24. check:crosslang-contract  exit=0  5s
27. check:journey-coverage  exit=0  3s
28. check:mobile-settings  exit=0  0s
31. check:native-bare  exit=0  0s
32. check:docs  exit=0  1s
33. check:pricing  exit=0  0s
34. check:ai-quota  exit=0  1s
35. check:ai-tools  exit=0  0s
36. check:payment-entry  exit=0  0s
37. check:design  exit=0  1s
38. check:text-color  exit=0  0s
39. check:server-design  exit=0  0s
40. check:server-copy  exit=0  1s
41. check:server-legal  exit=0  0s
42. check:tokens  exit=0  1s
43. check:calendar  exit=0  1s
44. check:holiday  exit=0  0s
46. check:native-deps  exit=0  0s
48. check:rn-aria  exit=0  1s
49. check:materialized-reads  exit=0  0s
50. check:ai-coverage  exit=0  0s
54. check:shell-unicode  exit=0  1s
55. check:web-storage  exit=0  2s
56. check:web-migration  exit=0  8s
57. check:script-snapshot  exit=0  0s
59. -r  exit=1  28s
```

两段红：`[12] exit=1  0s  <check:l4>` 与 `[59] exit=1  28s  <-r>`。第 59 段（`pnpm -r test`）已在 §7.12 修掉；第 12 段（`check:l4`）见 B30 / B30.1。

复现这三个数（59 / 48 / 11）而不靠记忆：

```bash
node -e "const s=require('./package.json').scripts.check.split(' && ');const K='check:ai-e2e|check:privacy-consent-e2e|check:landing-e2e|check:macos-shell|check:macos-window|check:windows-shell|check:linux-shell|check:arkts|check:arkts-widgets|screenshot:verify|check:mobile-bundle';const re=new RegExp('('+K+')');console.log('总段数='+s.length,'跑='+s.filter(x=>!re.test(x)).length,'跳过='+s.filter(x=>re.test(x)).length)"
```

### 7.14 §6.1.1 固定收尾为什么这一轮**没有重跑**（2026-10-03 10:5x，HEAD `bfcc5f2f`）

`reinstall:all`（清旧包 → 重打 → 四端重装 → 每端一条"装上的是当前产物且能起来"的判据）本轮已经跑过并全绿：
**mac 主蓝 1137 / android 4036 / ios 4136 / windows 四条取证**（`ADD_APPX=OK` `RESULT=OK` `PAYLOAD_WEBDIST=True` `M2D=OK`），
四张截图逐张人眼看过。之后本条线又落了 5 笔：
`c1395bf8`（1 个 spec 文件）、`a2d0d634`（2 个 spec 文件）、`d78f8414`/`bfcc5f2f`（3 份台账文档 + 1 份）、`3e5cef9b` 等更早的文档笔 ——
**全部落在 `server/tests/**` 与 `docs/**` / `BLOCKED.md`，没有一行进 `packages/*`、`apps/*`、`server/src`**。
所以四端产物里的 JS bundle / 原生壳字节与那次全绿重装时**同源**，重跑一遍只会重装同一份产物。

⚠️ 这不构成"下次可以省"：§6.1.1 的判据是**装的字节 == 当前源码**，一旦本条线再碰 `packages/` 或 `apps/`（哪怕只改一处样式），
就必须重跑并按 §7 第 82 条做内容对账。

**下一次要重跑的前提**（现场此刻不满足，写清楚而不是默默跳过）：
1. 主工作树里有**别人未提交的源码**（`packages/ui/src/calendar/*`、`apps/web/src/features/calendar/*`、
   `packages/i18n/src/locales/*`、`packages/local-api/src/tools.ts`）⇒ 不能在活树跑（不变量是"无别人未提交源码"）；
   改在隔离检出跑（`ab487d9f` / B26 那条路），
2. 现场有**两台 iOS 模拟器里的 Heyta**（pid 44087 / 47506）与一个 13 小时的 `HeytaMac`（pid 25394）在跑，
   `simctl uninstall` + 重打会直接落到别人的验收中途；
3. 负载 `28.45 / 40.01 / 41.76` —— 移动段自带负载门，等不到窗口会以 `exit 3` 收尾（环境无效 ≠ 产品失败，别为挤进去调阈值）。

### 7.15 ✅ B30 那两段红**当场解除**，方式是把 B30 估的闭合代价逐条量了一遍 —— 两条估计都被否证（2026-10-03 12:0x–12:1x，提交 `e446e54e` + `f79d3733` + `1ac5913a`）

**为什么这一轮可以动它们**：产品负责人 2026-10-03 明确授权
「你来想办法跳过阻塞，或者说解决阻塞。我授权你来解决阻塞。你可以从产品的角度去考虑这个问题，
从产品的角度考虑哪一个设计更加合理，然后呢去采用这个设计。」
B24/B30 当时"不代改"的理由是**这道决定的主语不在我**，现在主语有了。
边界规则本身不撤（下次遇到"代价落在别人面上"的两条出路，仍然先要主语）—— 见 B24 关闭段。

| 段 | B30 估的闭合代价 | 实测付出的代价 | 复量 |
|---|---|---|---|
| `check:landing-e2e` | 搬产物 + **同步那四处表达** + 重跑 `check:entries`（75 份入口逐字节对账会变大改动） | **一行常量 + 一次 `git mv`**（`ON_DISK_PREFIX` 由 `URL_PREFIX` 派生，四处表达早被收成一处；入口 HTML 里根本不含配图 URL ⇒ 对账**零变化**） | **17 passed / 0 failed**（改前同一棵树 15/2） |
| `check:l4` | 12 个屏按 M3 设计口径迁移 + **12 次逐屏设备取证** | **8 处换成 `kit` 现成的 `Stack`/`HStack`**，零新 API、零视觉变化、零设备动作 | **exit 0**（90 处，恰在基线 90） |

🔴 **这两条登记的价值现在反过来了**：B30 用"代价很大"论证"这一轮不做是负责任的"，
而代价里有一半是**估的**，估的依据是文档里那张旧形状（"四处表达"），不是当前这棵树。
"12 个屏只迁了一半的余量"这句尤其误导 —— blame 逐处的结果（B30.1 自己写的表）是
**8 处集中在两个屏、且全是纯间距容器**，而真正需要 `ListSurface`/`TaskRow` 口径的
`TaskDetailSheet`(26)/`TasksScreen`(15) **不在超线部分里**（基线 90 就是留给它们的）。
⇒ 教训：**登记"要闭合得付出什么"时，代价也要带取证口径**；一条高估的代价会体面地让该做的事永远排不上。

两条都做了变异（不能失败的检查没有价值）：

- 配图判据：把 `URL_PREFIX` 改成坏的 `/assets/doc` ⇒ **2 failed / 15 passed / `MUT_INNER_EXIT=1`**，
  红的正是 `docs-centre.spec.ts:959`（五张配图真的挂在指定分区上）与 `:1013`（反向对照）——
  **与原 B24 那两处红逐字同名同号**。⚠️ 这一趟跑 7.0 分钟（正常态 1.2 分钟）：图 404 ⇒ `naturalWidth`
  等到超时，"变慢"本身就是那两条判据在等它们唯一认的东西。变异后已还原（`cmp` 与主检出逐字节判等）。
- 内联样式棘轮：把 `inbox-notifications-list` 那一处换回 `<View style={{ gap: tokens['space.2'] }}>` ⇒
  **恰好 1 处超线（91 > 基线 90）、exit 1**，随后 `git checkout --` 还原并与 `HEAD` 那个 blob `cmp` 判等。

#### 顺手撞见的第 3 段红（不是本条线的账，但当场修了）：`check:shell-unicode`

seg-lite 在 `f79d3733` 的干净检出上报 `[55] exit=1`，而**上一轮（`cde861c3`）这一段是 exit 0**。
红在 `scripts/mutate-closeout-gates.sh` —— `b1fcc686`（11:43，并行 closeout 那条线）新写进仓库的变异臂脚本，
4 处 `$var` 紧跟全角括号（§7 第 64 条那一族）。⚠️ **退出码不受影响**，坏的是它打印的 PASS 证据行本身：
`ok "L3 负载 == 阈值（$LIMIT）放行"` 会打成乱码。修 `1ac5913a`：只按门禁给的原文改成 `${var}`，
一条判据/阈值/断言都没动。复量 `check:shell-unicode` exit 0（扫了 70 个 `.sh`）、
`check:script-snapshot` exit 0（28 个脚本 + `.gitignore` 在位）、`bash -n` 语法 OK。

#### 链本身长了一圈，所以 §7.13 的三个数作废（现量，不靠记忆）

```
总段数=61 跑=50 跳过=11
```

（§7.13 记的是 59 / 48 / 11。并行的两笔把链加长了：`check:licenses:stamp` 与
`check:mobile-first-run-gate` —— 与 `d78f8414` 的 `package.json` 逐段做差集量出来的，不是猜的。）
现量命令沿用 §7.13 那条 `node -e`，只需把里面的 `K` 串按名字带上。

**在 `f79d3733` 的干净检出（`/tmp/heyta-g5`，`INSTALL=0`、`BUILD=0`）上跑的 50 段读数**：
49 段 exit 0，1 段红 = `check:shell-unicode`（上面那条，`1ac5913a` 已修）。
🔴 **`check:l4` 这一段现在是 `[12] exit=0`** —— 它在 `cde861c3` 上是这一轮唯一的老红。
`pnpm -r test`（末段）`[61] exit=0`（53s，负载 83 下仍然过）。

#### 零视觉代价的证据**只到源码层**，设备层那一条还欠着

`f79d3733` 那 8 处的"不改视觉"目前的证据是**逐字对照 `kit.tsx` 的实现**：

| 调用 | `kit` 实际发出的样式 | 与原写法的差 |
|---|---|---|
| `<Stack>` | `[{gap: t['space.2']}, undefined]` | 无（屏里那个 `tokens` 就是同一个 `useTokens()`，`NotificationsScreen.tsx:62`） |
| `<Stack gap="loose">` | `[{gap: t['space.3']}, undefined]` | 无 |
| `<HStack>` | `[{flexDirection:'row', gap: t['space.2']}, null, undefined]` | 无（`align` 缺省 `undefined` ⇒ 不加 `alignItems`，与裸 row 等价，`kit.tsx` 注释明写这是刻意的） |
| `<HStack align="center">` | `[{flexDirection:'row', gap}, {alignItems:'center'}, undefined]` | 无（数组扁平化后同值，只是键序不同） |

`testID` 走 `{...rest}` 透传 ⇒ 依赖 `inbox-notifications-list` / `privacy-consent-section`
的两条判据照旧命中（`check:mobile-settings`、`check:empty-state` 各 exit 0，`@heyta/mobile`
typecheck 0 + **544 passed / 35 files**）。

⚠️ 但 §6.1.1 的固定收尾这一轮**被这批改动触发了**（碰了 `apps/*`），而现场不满足 —— 见 §7.16。

### 7.16 §6.1.1 这一轮**确实被触发**了，但没有跑 —— 触发范围先量窄，剩下的缺口写成有形状的（2026-10-03 12:1x，读数取自 `1ac5913a` 之后）

§7.14 那句"一旦本条线再碰 `packages/` 或 `apps/` 就必须重跑"在这一轮成立了：
`e446e54e` 碰了 `apps/landing`，`f79d3733` 碰了 `apps/mobile/src/screens`。
先按**包输入**把范围量窄，而不是笼统说"四端都要重装"：

| 提交 | 改的路径 | 进哪个产物 | 依不依据得上重装 |
|---|---|---|---|
| `e446e54e` | `apps/landing/**` + 一份计划文档 | **落地页站点**（`VITE_*` 构建后部署到 nginx） | 与 `reinstall:all` 的四端**无交集**（那四端装的是 `apps/web/dist` + 各端 bundle/原生壳）；它要的是**部署**，不是重装，而部署需要单独授权 |
| `f79d3733` | `apps/mobile/src/screens/{Notifications,Settings}Screen.tsx` | **android APK + iOS .app 的 JS bundle** | 🔴 这一笔才是真触发 —— 只有 **android / ios 两段** |
| `1ac5913a` | `scripts/mutate-closeout-gates.sh` | 不进任何产物 | 无 |

🔴 **`e446e54e` 还留着一件本条线不能替它做的事**：落地页要**重新构建并部署**，线上才会出现
`/assets/docs/…`。**线上现量（12:22，`curl --noproxy '*'`，只读 HEAD）**：

| URL | 状态 |
|---|---|
| `https://heyta.waytofuture.cn/assets/help/first-run/W01-tasks.png` | **200** |
| `https://heyta.waytofuture.cn/assets/docs/first-run/W01-tasks.png` | **404** |

⇒ 线上**目前是自洽的**（那个构建的 HTML 引的就是 `/assets/help/`，图也在），只是**落后一个前缀** ——
这不是坏状态，不需要回滚。真正要防的是**半趟部署**：新 HTML 配旧产物目录（或反过来）会让
帮助配图**整片 404**，而页面本身看起来完全正常（配图那两条判据正好是这种形状的唯一防线，
它们在**构建产物**上跑，不在线上跑 —— 所以线上这件事只能靠"同一趟构建"这条纪律）。
部署是发布动作，按规矩要产品负责人点头，**不在本 Goal 的授权范围内**，故登记不做。
部署后的复验就是上面那两条 `curl`（应当反过来：`docs` 200 / `help` 404）。

mac/windows 两段能不能顺带免掉？**按打包脚本吃的路径判，不是按感觉判**：
`grep -oE "apps/[a-z-]+|packages/[a-z-]+" apps/desktop-macos/scripts/package-app.sh`
⇒ `apps/desktop-macos`、`apps/web`、`packages/app-host` —— **不含 `apps/mobile`**。
（windows 段仍会把整棵源码树同步到 `C:\src\heyta`，但它的 sha256 对账与包 payload 都只看
`apps/web/dist/index.html`；移动端源码进不了那个 exe。）

**现场读数（12:18，这一趟）**：

| 事实 | 读数 | 挡住了哪一段 |
|---|---|---|
| `sysctl -n vm.loadavg` | `498.52 / 632.62 / 390.04` | 全部（gradle / xcodebuild 这个量级只会把别人的读数挤坏） |
| `adb devices` | `emulator-5554 device`，qemu pid **25285** = `-avd heyta-w3-yearly` | android 段 —— 这台 AVD 是**并行会话在用的设备**，`reinstall` 会 `pm clear`/卸装它 |
| `ps -p 25394` | `/Applications/Heyta.app/.../HeytaMac` 已跑 **15:17:44** | mac 段 —— 判据是"装进 `/Applications` 后启动自截屏"，而别人那个实例正从同一个包在跑 |
| 提交推进 | main 已从 `1ac5913a` 走到 `be8bebfb`（并行 `docs(gate)`） | 任何一趟重装量的都不是"我这一批定稿"，得再跑一趟 |

⚠️ 一条**读数不一致**要写出来，不要藏：同一分钟里 `xcrun simctl list devices booted` 读到 **0 台**，
而 15 分钟前那趟读到 3 台（`heyta-iphone-17pro` / `iPhone Duo heyta` / `SSOS-Duo-Fresh`）。
要么别人刚关完，要么那次 `simctl` 调用本身没成功 —— **两种都可能**，所以 ios 段之前要连跑两遍确认，
别拿单趟读数当现状（§7 元规则 1：先怀疑探针）。

⇒ **本节写于 12:1x，当时的结论是"本轮未跑"。这个结论已被 13:5x 那一轮推翻**：
android 段跑绿（并且顺带照出一处假绿，见 §7.19），ios 段被 `pod install` 挡住 ——
**缺口从"两段没跑"变成"一段跑绿、一段有形状的阻塞"**。窗口条件与现量命令仍然有效，留在下面。

> ⚠️ 负载门在这一轮**已经被并行会话抽成单一所有者** `scripts/lib/wait-for-quiet-host.sh`
> （`1d085a92`，11:34「负载门抽成单一所有者，并给 `verify-mobile-repeat` 补上它」）。
> 所以"移动段自带负载门"这句现在指向那个 lib，而不是各脚本里各写一份 ——
> 引用阈值/等待秒数之前先 `git log -1 -- scripts/lib/wait-for-quiet-host.sh`，
> 别拿本文件 12:1x 那段抄进去的数字当现状（这正是 §7.18 第 1 条说的"拿旧形状当现状"）。

```bash
sysctl -n vm.loadavg                       # 要 < 12（移动段自带负载门，等不到会 exit 3）
adb devices; pgrep -fl qemu-system         # 不能是别人在用的 AVD
xcrun simctl list devices booted           # 连跑两遍读数一致才可用
git -C <repo> status --porcelain apps packages server/src   # 必须为空（无别人未提交源码）
# 然后在隔离检出里（不变量：主工作树有别人未提交源码时不能在活树跑）：
git fetch <repo> main && git reset --hard <本批定稿 sha> && pnpm install --prefer-offline
pnpm reinstall:mobile                      # 只欠 android + ios 两段
```

装完必须补的那条**产物字面量对账**（§7 第 178 条：四端判据回答"装上了、起得来、画的是我们的界面"，
不回答"装的是不是这一批"）：这一批**没有新增 ASCII 字面量**（换的是容器、值没变），
所以对账 needle 取 `Stack`/`HStack` 编译后进 bundle 的形状做不到 ⇒
用**改前/改后同一屏主蓝命中数相等**当零视觉代价的判据（`scripts/lib/png-stats`），
并把两枚 APK 的 md5 列出来（改动前后应当**不同**，相同就说明装的还是旧的）。

### 7.17 🔴 **`pnpm check` 全量绿第一次在一整条链上成立**：61 段、干净检出、`exit 0`（2026-10-03 12:29–12:37，`1ac5913a`）

从 §7.2 起这一条一直被记成"不可达"（4 道红 → 3 → 2）。这一轮不是靠放宽任何判据达成的，
而是**三段红各自当场修掉**（`check:l4`、`check:landing-e2e`、`check:shell-unicode`，见 §7.15 与 B30.3），
然后把**整条链一次跑完**：

```
载体：隔离/干净检出 /tmp/heyta-g5（detached @ 1ac5913a，无 server/.env = CI 的唯一形态，§7 第 157 条）
命令：pnpm check            起 12:29:0x → 止 12:37:3x，负载 13.5
结果：FULL_CHECK_INNER_EXIT=0        ← 写在日志里的真退出码，不是包装命令的（§7 第 164 条）
段数：61（`pnpm -r build` 起头，`pnpm -r test` 收尾）
```

末段 `pnpm -r test` 的逐包读数（同一趟）：

| 包 | 读数 |
|---|---|
| `server` | **111 files / 2095 passed / 1 skipped** |
| `apps/web` | 110 files / 1500 passed / 12 skipped |
| `packages/app-host` | 47 / 974 |
| `apps/mobile` | 34 / **538** |
| `apps/node-host` | 9 / 165 |
| `apps/desktop` | 2 / 12 |

几条**以前红过**的段在这一趟的具体读数：`check:l4` 90 ≤ 基线 90、`check:landing-e2e` 17 passed、
`check:shell-unicode` 扫 70 个 `.sh` 全过、`check:ai-e2e` 113 passed / 2 skipped、
`check:privacy-consent-e2e` 7 passed、`check:macos-shell` 冒烟全过（"跨语言那一层 + 落盘 全部通过"）、
`check:macos-window` **真跑了**（`CAPTURE_METHOD=screencapturekit`、`CROSSCHECK=ok(2240x1440)`、
`contentOnModalRatio 0.309`、M2-macOS 三条断言全过），且证据文件给出
**`STORAGE=shell`**（产品路径，不是页侧兜底 —— 这一行才是这条门禁的成败判据，
见 `apps/desktop-macos/evidence/storage-host/README.md` 那四格矩阵）。
🔴 那张窗口截图我**打开看过**（§6.2 规定一）：macOS 原生壳里的真应用 —— 蓝白 rail + 收集箱 +
首启「在使用联网功能之前」同意面板（同意并联网 / 只用本机）+ 中文/English 切换 + 未同步指示，
不是错误屏。

⚠️ **两条边界，别让这句"全量绿"读多**：

1. 它证明的是**提交态 `1ac5913a` 在干净检出上全绿**。`1ac5913a` 之后 main 又推进了两笔
   （`be8bebfb`、`661cff78`，都是文档笔），所以"当前 main 全绿"这句要下一轮重量才成立。
2. `check:macos-window` 的四条**跳过分支仍返回 exit 0**（非 darwin / 无 swift / 取证脚本 exit 4 /
   非 Aqua 会话）—— 那是登记在案、**尚未拍**的一条（"全绿而这条从未执行"的可能性还在）。
   本轮的"真跑了"是靠 `STORAGE=shell` 那一行**单独证明**的，不是靠 exit 0。
3. 这一趟 `check:web-storage` 过的**前提是 :4321 空着**（它自己 spawn `vite --port 4321 --strictPort`）。
   这条段的历史红就是被别人占着端口造成的，所以它的绿**依赖现场**，不是无条件属性。

### 7.18 🔴 本条线这一轮学到的三条，写成**待入 traps** 的候选 —— 不直接往 `environment-traps.md` 追加

`docs/reference/environment-traps.md` 此刻正被并行会话写着（工作树里 +48 行未提交，#178–#180 是他们的）。
按本仓的规矩（多人台账正脏着的时候不追加，改投单写者文档并登记"待入"），三条先落在这里：

1. **登记"要闭合得付出什么"时，代价本身也要带取证口径。**
   B30 给两段红各写了一条代价（"同步四处表达 + 75 份入口逐字节对账" / "12 个屏按设计口径迁移 +
   12 次逐屏设备取证"），据此判定"这一轮不付是负责任的"。实测：一行常量 + 一次 `git mv`，
   以及 8 处换成现成共享件。🔴 **一条高估的代价会体面地让该做的事永远排不上** ——
   它读起来像谨慎，实际是拿旧形状当现状。现量方法：估代价之前先 `grep` 那个改动的
   **真实消费者集合**（本例：`ON_DISK_PREFIX` 由 `URL_PREFIX` 派生 ⇒ "四处"早是一处），
   而不是照文档里那句"有四处表达"报数。
2. **`$var` 紧跟非 ASCII 的第五种面目：坏的不是值，是那条 PASS 证据行，而退出码照常是 0。**
   §7 第 64 条那一族此前被记成"变量名被吞 ⇒ 值丢了"。`scripts/mutate-closeout-gates.sh`
   （`b1fcc686`）里那 4 处让**变异臂脚本自己打印的 PASS 文案**变成乱码，
   而 `RC=0`、判据全跑 —— 也就是说这套证据"看起来齐了"，只有落到人手里的那行字是坏的。
   现量：`node scripts/check-shell-unicode-vars.mjs`（扫 70 个 `.sh`）。
   一般规律：**判据的读数才是交付物，退出码不是**。
3. **设备类现量必须连跑两遍读数一致才算。**
   同一分钟里 `xcrun simctl list devices booted` 先读到 3 台、后读到 0 台（而 15 分钟前是 3 台）。
   两种解释都可能（别人刚关完 / 那次调用本身没成功），单趟无法区分 —— 这正是元规则 1
   （"没观测到 X" ≠ "X 没发生"）在设备清单上的落点。重装与设备验收之前，
   `adb devices` 与 `simctl list devices booted` 各连跑两遍，不一致就当读数无效重取。
   ⚠️ 本条这一轮**自己撞上了**：12:18 读到 `emulator-5554` 在，12:39 同一台 AVD 起来时编号变成
   `emulator-5556` —— 照旧值传 `HEYTA_E2E_SERIAL` 会让 android 段"不可达"而红。
   **设备序列号是每次现取的，不是常量。**

### 7.19 🔴 §6.1.1 重装：android 跑绿，而**它第一次的绿是假的**——判据把一张桌面启动器判成"是共享 UI"（13:5x，提交 `57e0e1fc`）

跑 `reinstall-all.sh --only android,ios`（隔离检出，`1ac5913a`）：

| 端 | 第一趟（12:39–12:42） | 修判据后（13:50–13:51，`57e0e1fc`） |
|---|---|---|
| android | ✅ 打印"内容占比 92.0%、主蓝命中 29、是共享 UI" —— **但截图人打开看是桌面启动器**（`android-launcher-false-green-57e0e1fc.png`：状态栏 12:42、"Sat, Oct 3"、五个系统图标 + Google 条） | ✅ **`前台窗口确认：mCurrentFocus=Window{… com.heyta/com.heytamobile.MainActivity}`**、窗口 1080x2400、内容占比 58.3%、**主蓝命中 4001**、`ANDROID_REINSTALL_EXIT=0`；截图 `android-reinstall-57e0e1fc.png` 已人眼看：真中文首启同意面板（同意并联网=主蓝实心、只用本机=描边） |
| ios | 🔴 `pod install` 崩（见下） | 未重跑（同一枚阻塞） |

**这条假绿为什么比 §7 第 82 条更贵**：那一条补的"主蓝命中"判据，在**启动器上也会命中 29 次** ——
Chrome 图标、信息气泡、Google 搜索栏本来就是蓝的。也就是说
**"非空白 + 有品牌色"两条合起来仍然回答不了"这是不是我们的界面"**。
而"谁拥有前台窗口"这件事有一个比像素统计**便宜得多也直接得多**的读数（`dumpsys window | grep mCurrentFocus`），
判据却一直只在数像素。修法已提交（`57e0e1fc`）：截图前读 `mCurrentFocus` + `mResumedActivity` 两条
（互为对照，不同 Android 版本给的字段不一样），不是 `com.heyta` 就 `am start -W` 显式拉起再读一次，
仍然不是 ⇒ **不打分**；两条探针都读空 ⇒ **也不打分**（静默跳过等于这条判据是装饰）。

⚠️ **产品侧结论：App 是好的**。假绿那一趟里 `adb shell pidof com.heyta` = 3766、crash buffer 空，
补一次 `am start -W` 后焦点立刻变成我们的 Activity。红的是探针，不是产品 —— 这一句必须写下来，
否则下一位看到"launcher 截图"会以为装出来的包起不来。

 顺带一条对 §7.15 的**补强**：修后那一趟主蓝 **4001**，与上一轮全绿重装的 **4036** 同一量级（差 0.9%）
⇒ 本批那 8 处容器替换在设备层没有可见代价。⚠️ 但**这不构成严格 A/B**（两趟之间并行批次也往同一屏加了东西，
比如"倒计时"档位），严格的零视觉证明仍是 §7.15 那张"调用 → `kit` 实际发出的样式"逐字对照表。

**ios 段的阻塞（`pod install`，本轮新增取证）**：

| 臂 | 结果 |
|---|---|
| 长活隔离检出 `/tmp/heyta-g5` | 🔴 `ArgumentError - path name contains null byte`，`cocoapods-1.17.0/lib/cocoapods/project.rb:452` `Pathname#realdirpath`，崩在 `Generating Pods project`（5 个 codegen spec 全部生成完、全部 pod 装完之后） |
| 🔴 **traps #154 给的 remedy：同 commit 现开新克隆**（`git clone --no-hardlinks` + `pnpm install` @ `1ac5913a`） | **仍然崩，同一处栈** ⇒ **那条 remedy 已被本轮实测否证**（它当时量到的是"新克隆两次都 exit 0"） |
| `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pod install` | 🔴 仍然 exit 1，同一处 ⇒ 语言环境变量**不是**变量 |
| `pod install --verbose` | 🔴 同一处栈；崩溃前的文件清单里没有非 ASCII 路径 |
| 工具链漂移 | 排除：`/opt/homebrew/Cellar/cocoapods/` 只有 `1.17.0`，目录 mtime **Sep 25 22:21**（不是今天），ruby 4.0.7 |
| `Podfile.lock` 自上一趟绿（`840effb1`）以来的差 | 只有 **一行**：`ReactCodegen` 的哈希（codegen 产物哈希，随任意原生模块变）⇒ 没有新增 pod |
| 变更集里的非 ASCII 文件名 | `git diff --name-only 840effb1..1ac5913a` 共 250 个路径，`LC_ALL=C grep '[^ -~]'` **0 命中** |

⇒ 现状：**四臂排除（树龄 / LANG / 工具链 / 文件名），根因未定位**，与 #154 当年一样卡在
"要扫 `node_modules` 里 1.9 GB 的文件名才能知道哪个路径让 Ruby 拿到 NUL"。
**这不是本条线能当场修的**，且它挡住的是"把当前源码装进 iOS 设备"这一步，不是产品行为。
需要的是：一台 `pod install` 能过的机器（或换 ruby 3.x 下的 cocoapods），或上游修
（CocoaPods #12798 / #12866，两条都还 open）。
🔴 **`environment-traps.md` #154 那句"现开新克隆就能过"必须更正** —— 本轮实测否证，
而它现在读起来像解法。这条更正**没有直接写进那个文件**，因为它此刻正被并行会话写着
（工作树 +48 行未提交，#178–#180 是他们的），按同一份台账的规矩（多人台账正脏着时不追加、
不整文件 `git add`）登记在这里 + 下面 §7.20 的动作项。

### 7.20 Goal 终局审计（2026-10-03 13:5x）：① ② 全绿，③ 的 `check` 达成、重装差一段

| objective 里的条款 | 状态 | 读数与出处 |
|---|---|---|
| ① 批五③ 移动端还原卡 JSX + i18n 中英复验 | ✅ | `git show HEAD:apps/mobile/src/screens/ExportScreen.tsx` 里 `restoreFromBackup`/`parseExportDocument`/`restoreIntoEmptyTarget` 三个符号**共 5 处命中**；`check:ui-language` exit 0；中英词条对等由 `@heyta/i18n` 的用例钉着（本轮 `pnpm -r test` 全过） |
| ② 批五④ 设备判据转绿 + 变异 + 截图人看 + 审计回填 | ✅ | §7.6（26 项 / 0 失败）、§7.9（两条变异臂在当前产物上重证）、§7.12–§7.13（链逐段读数） |
| ③ `pnpm check` 全量绿 | ✅ **达成** | §7.17：干净检出 @ `1ac5913a`，61 段一次跑完，`FULL_CHECK_INNER_EXIT=0`。**没有放宽任何基线、没有改别人的判据**；三段红（l4 / landing-e2e / shell-unicode）各自当场修<br>✅ **14:32 在收尾后的 HEAD 上重证**：同一把尺子 @ `a04753b6` 仍 `FULL_CHECK_INNER_EXIT=0`，见 §7.23 |
| ③ `pnpm reinstall:all` 四端重装绿 | ⚠️ **差一段** | android ✅（`57e0e1fc`，含新加的前台窗口判据）；mac / windows ✅ 但**是 09:5x 那一趟的读数**，本批按包输入证明它们不受影响（`package-app.sh` 只吃 `apps/web`+`packages/app-host`）；**ios 🔴 被 `pod install` 挡住**（§7.19 那张表）<br>✅ **14:2x 已关闭**：四端在**同一载体 `940af1c0`** 上逐段跑绿，见 §7.21 + §7.22（本行原句留着，因为它记录的"当时差 ios 一段"确实成立过） |
| ③ 按归属纪律提交 | ✅ | 本条线这一轮 7 笔：`e446e54e` `f79d3733` `1ac5913a` `661cff78` `860fe82a` `57e0e1fc` + 本笔。全部 `git commit --only <点名路径>`，每笔之后 `git show --name-status` 只含自己点名的路径（`e446e54e` 13 条、`f79d3733` 2 条、`1ac5913a` 1 条、`661cff78` 2 条、`860fe82a` 1 条）。暂存区在提交前实测 `git diff --cached --name-only \| wc -l` = **10**，全是我自己那 10 条 rename，**没有别人的暂存条目被带走** |

**没做的，逐条列名 + 现量命令**（不写成"以后再说"）：

1. ~~**ios 段重装** —— 阻塞在 `pod install`（§7.19）。要跑：换一台 `pod install` 能过的机器后
   `IOS_DEVICE_NAME="heyta-iphone-17pro" bash scripts/reinstall-all.sh --only ios`。
   在此之前，"iOS 装的是当前源码"这句**不成立**，别引用 09:5x 那趟的 iOS 读数代替它。~~
   ✅ **14:1x 已做掉**（同一条命令，载体 `940af1c0`，`INNER_EXIT=0`）—— 见 §7.21 / §7.22。
   划线留着是因为它当时是对的，而且它下面那句"别引用旧读数"现在仍然适用于**任何**没重跑的端。
2. **落地页重新部署** —— `e446e54e` 改了用户可见 URL 前缀，线上现量 `assets/help` 200 / `assets/docs` 404
   （§7.16）。发布要产品负责人点头。
3. ~~**traps #154 的 remedy 更正** —— 本轮否证（新克隆同样崩）。~~
   ⚠️ **更正的内容变了**（§7.21）：不是"remedy 错了"，而是"这条崩溃是间歇的，
   #154 的解法与本轮对它的否证各是一个时间窗的读数，两句都不该往下传"。
   写回原文件的动作照旧挂在 `environment-traps.md` 干净的时候做
   （现量：`git diff --numstat docs/reference/environment-traps.md`；14:2x 实测仍是 `48 0`）。
4. **`check:macos-window` 四条跳过分支仍返回 exit 0** —— 登记在案、**尚未拍**的老缺口，本轮没动它。
5. **M3 的 41 处内联样式** —— 现在住在基线 90 里，B18 **没有解除**，只是不再表现为红。

### 7.21 🔴 B31 当场解除：`pod install` 在**同一棵树、同一 commit** 上现在 exit 0 —— 于是 #154 的 remedy 与本轮对它的否证**都不成立**（14:0x–14:1x，载体 `940af1c0`）

§7.19 那张表把 ios 段判成"四臂排除、根因未定位"。这一轮接着查，**它自己好了**：

| 时刻 | 臂 | 结果 |
|---|---|---|
| 06:45 | `/tmp/heyta-g5` @ `840effb1`（**就是 traps #154 本体**），含 `rm -rf Pods` 后重装 | 🔴 同一处栈 ⇒ #154 当场排除过"沙盒残留" |
| 12:5x | `/tmp/heyta-ri-ios` @ `1ac5913a`，`LANG=en_US.UTF-8`（脚本原样） | 🔴 `ArgumentError - path name contains null byte` @ `project.rb:452` |
| 13:5x | 同 commit 现开新克隆（否证 #154 的 remedy） | 🔴 同一处栈 |
| 14:0x | **同一棵 ri-ios** `rm -rf Pods` + `LANG=en_US.UTF-8`（不带 `LC_ALL`） | ✅ **exit 0**，`Pod installation complete! 84 dependencies / 83 pods` |
| 14:0x | 同一棵树 + `LANG` 与 `LC_ALL` 都设 | ✅ exit 0 |
| 14:0x | **`/tmp/heyta-g5`（#154 当年那棵长活的树）** @ `57e0e1fc`，沙盒与 lock 不一致 ⇒ 真走 `Generating Pods project` | ✅ exit 0，日志第 167 行就是当年崩的那一行 |

⇒ **变量没有被定位，但"这台机器跑不出 iOS"这句被推翻了。** 三条当时能想到的解释各自有反证：
不是 locale（两臂都过）、不是树龄（**同一棵树先崩后过**：g5 06:45 崩 / 14:0x 过，
ri-ios 12:5x 崩 / 14:0x 过）、**不是 CocoaPods 缓存被修好**
（`~/Library/Caches/CocoaPods` 顶层 mtime = **10-02 00:43**，崩溃趟与成功趟之间**零修改**）。
我这一轮为定位它加的探针臂（`prepend` 一个 `Pathname#realdirpath` 包装、把 receiver 的字节打出来）
**没有抓到 NUL —— 因为跑不到崩了**，它只留下两条一般事实（见下）。

🔴 **所以这条的形状是"间歇"，不是"还有臂没试对"**：同一条件先红后绿，那么 #154 的 remedy
（"换棵新树，5 秒，没理由在旧树上重试"）和本轮对它的那条否证（"新克隆也崩"）**只是两个时间窗里
各采到一次的相反读数**，两句都不该再被当成解法往下传；也别给它建失败率模型 ——
没有一段稳定复现的样本，`p` 无从谈起。（这正是"间歇性缺陷的 p 只属于采样那段窗口"那个老坑的第三次命中。）
可用的只有一件事：**跑不通就重跑一次再判**，而判据本身一条没动。

**顺带量到的两条，值得单独入 traps**：

1. 🔴 **`LANG` 与 `LC_ALL` 都为空时，`pod install` 一步都走不出去**，死在
   `Pod::Config#installation_root` 的 `String#unicode_normalize`
   （`Unicode Normalization not appropriate for ASCII-8BIT`），而外层栈顶是
   `verify_podfile_exists!` —— **读起来像"找不到 Podfile"**。本机 agent 的 shell 里
   `LANG`/`LC_ALL` 实测**都是空的**，所以 `reinstall-all.sh` pod 步骤那句
   `env ... LANG=en_US.UTF-8` 是**承重的**，不是装饰，别删。
2. **Ruby 4.0 的 `Pathname.new` 自己就拦 NUL 与非 ASCII-compatible 编码**
   （`Pathname.new("/tmp\0x")` ⇒ `ArgumentError: path name contains null byte`；
   UTF-16/UTF-32 ⇒ `Encoding::CompatibilityError: path name must be ASCII-compatible`）。
   ⇒ 所以"`path name contains null byte`"**不是**"仓库里有个带 NUL 的文件名"——
   那种路径根本构造不出来。#154 与本轮都往"扫 1.9 GB 文件名"那个方向走过，**方向是错的**。

**iOS 段这一趟的读数**（`IOS_DEVICE_NAME="heyta-iphone-17pro" bash scripts/reinstall-all.sh --only ios`，
在隔离检出 `/tmp/heyta-g5` @ `940af1c0` 跑；`940af1c0` 与上一趟载体 `1ac5913a` 之间
`packages/`、`apps/mobile/src` **零源码改动**，实测 `git log --name-only` 只列出文档与两张 png）：

```
模拟器 FE195661-B021-4A71-AAD1-1F2F7AE3A102 · 沙盒已同步（Manifest.lock == Podfile.lock）
** BUILD SUCCEEDED ** · ✅ 已安装进模拟器（全新安装）
✅ 已装的包比源码新 —— 这一轮装的是当前产物
窗口 1206x2622 · 内容占比 61.5% · 主蓝命中 4136   INNER_EXIT=0
进程佐证：simctl spawn … launchctl list → `UIKitApplication:com.heyta[fb92]` pid 22330
```

证据 `apps/mobile/evidence/ios-reinstall-940af1c0.png` —— **人已看**：iOS 上的是**联网同意弹窗**
（标题"在使用联网功能之前"、主蓝按钮"同意并联网"、`服务条款`/`隐私政策` 两个蓝链接），
与 android 那张同一状态，正是全新安装应有的第一屏。

⚠️ **两条边界，不要读多**：

1. **ios 段没有 android 那条前台窗口判据**（`57e0e1fc` 只加在 android 段）。这一趟的
   `launchctl list` 是我**事后**补的独立佐证，不在流程里。缺口登记，不冒充已做。
2. **`pod install` 会改三个已跟踪文件**：两个 `Info.plist` 被重写（**吃掉了里面的 XML 注释**，
   含"只使用标准加密算法…出口合规"那条，并加进 `RCTNewArchEnabled`）、
   `Podfile.lock` 的 `hermes-engine` 哈希差 1 行。在共享工作树里**别顺手提交它们**；
   脚本对 lock 只打 ⚠️ 不判红（提交态可复现性由 `check:native-deps` 管）。

### 7.22 ✅ §6.1.1 固定收尾：四端在**同一个载体 `940af1c0`** 上全部重装跑绿（14:1x–14:2x）

上面 §7.20 那行"差一段"到此关闭。四段分别用 `--only <端>` 在隔离检出 `/tmp/heyta-g5`
（`git checkout 940af1c0`，`git status --porcelain` 实测**空**）跑，每段 `INNER_EXIT=0`：

| 端 | 判据读数 | 证据 |
|---|---|---|
| mac | 窗口 1092x723 · webview 内容占比 **73.0%** · 主蓝命中 **1269** · `HEYTA_NO_FOCUS=1` 后台起 | `apps/desktop-macos/evidence/mac-reinstall-webview-940af1c0.png` |
| windows | 远端新鲜度对账（`web-dist/index.html=ca473eb5…` + bridge + **7 枚 assets 一致**）· `ADD_APPX=OK` `RESULT=OK` `PAYLOAD_WEBDIST=T` `M2D=OK` | `apps/desktop-windows/evidence/windows-reinstall-first-run-940af1c0.png` |
| android | release APK 64M 重打 · 全新安装 · ⚠️ monkey 后前台不是 `com.heyta` → `am start -W` 拉起 → **前台窗口确认** `mCurrentFocus=…com.heyta/com.heytamobile.MainActivity` · 1080x2400 · 内容 58.5% · 主蓝 **4001** | `apps/mobile/evidence/android-reinstall-940af1c0.png` |
| ios | 沙盒同步 → `** BUILD SUCCEEDED **` → 全新安装 → **新鲜度**（已装包比源码新）· 1206x2622 · 内容 61.5% · 主蓝 **4136** · 事后独立佐证 `launchctl list` 里 `UIKitApplication:com.heyta[fb92]` pid 22330 | `apps/mobile/evidence/ios-reinstall-940af1c0.png` |

**四张图都人眼看过**（§6.2 规定一）：三端是**联网同意弹窗**（mac 那张还能看到 rail 的
收集箱/今天/最近 7 天/已完成/四象限/清单/标签 + 铃铛 + 帮助、`AI 工具调用` 行、中/EN 切换），
windows 那张还额外开着**头像菜单**（`登录 / 注册` 在第一项 + `设置`）—— 正是 `M2D` 那条判据要看的东西。

 **android 那一行的 ⚠️ 是 `57e0e1fc` 那条新判据第一次在真事件上生效**：上一轮它把一张
桌面启动器判成绿（§7.19），这一轮它先报"monkey 之后前台不是 com.heyta"、显式拉起、确认前台，
**才**打分。判据没动过一条，跑法也没变 —— 这是它该有的样子。

⚠️ **载体与主分支的关系**（别读成"装的是 `940af1c0` 之后的东西"）：跑完之后 main 又走了两笔
（`a371a658` `9f1cc9c3`），`git diff --name-only 940af1c0..HEAD` 实测只有
`scripts/lib/mobile-e2e.sh`、`scripts/mutate-closeout-gates.sh`、`scripts/verify-mobile-repeat.sh`
三行，`apps/` 与 `packages/` 命中 **0** ⇒ 四端产物输入未变。

### 7.23 ✅ `pnpm check` 全量绿**在收尾之后的 HEAD 上重证了一次**（14:23–14:32，`a04753b6`）

§7.17 那条绿是 `1ac5913a` 的读数，而它之后 main 又走了 6 笔（本条线 3 笔 + 并行 3 笔）。
把整条链在**干净检出** `/tmp/heyta-g5` @ `a04753b6` 上重跑一遍：

```
命令：pnpm check（14:23:5x 起 → 14:32:0x 止）
结果：FULL_CHECK_INNER_EXIT=0        ← 写在日志里的真退出码，不是包装命令的
逐包：server 2095 passed | 1 skipped · web 1500 | 12 skipped · app-host 1303 ·
      mobile 538 · node-host 165 · desktop 12 · 其余 packages 全 passed，零 failed
```

🔴 **顺带量到一条"只在混合工作树成立"的红，别误接**：同一时刻在主检出跑 `pnpm check:docs` 是 **exit 1**，
7 处"本机有、仓库里没有"的死链全部指向并行会话**未跟踪**的文档
（`adr/0046-*`、`plans/trash-and-archive.md`、`research/trash-and-archive-*`、
`plans/calendar-year-time-*`、`apps/web/evidence/calendar-day/`）。
逐条核过归属：引用它们的 `docs/README.md` 等三份**自己就还是 `M`（未提交）**，
而 `git show HEAD:docs/README.md | grep -c "0046-lossless"` = **0** ⇒ **HEAD 不红**，
干净检出同一把尺子 `exit 0`（上面那条链里就含这一道）。**不代改、不 `git add` 别人的文档。**

### 7.24 ✅ 任务 1 判据登记补齐（2026-10-03 16:0x，提交 `c506953b` + `76cbee51`）

任务 1 那四件（6 个别名 / 2 个进 MANIFEST + 补 bootstrap + 改掉过期理由 / mobile 旅程册 2→25 /
`verify-mobile-lists.sh:377` 的服务端计数判据）落地过程与读数是 **PROGRESS.md「任务 1 判据登记补齐」** 那一节，
这里只记三条会影响后面批次的事实：

1. 🔴 **任务书那条反向验证的前提不成立**：`check:script-snapshot` 从不扫磁盘，所以"从 MANIFEST 删一条"
   反而**全绿**（exit 0）—— 真正会红的是"清单里的文件没有 bootstrap"。两次变异读数见 B36.1。
   含义给后面批次：**这条门禁不会替我发现"新写的 `verify-mobile-notes.sh` 忘了登记"**，
   所以任务 2 交付时必须手工跑那两条对账命令（`no_alias=0` / `no_manifest=0`），不能只看门禁绿。
2. 🔴 **`pnpm check` 的段数是工作树的读数，不是仓库的属性**：HEAD（`76cbee51`）上是 **61** 段，
   第 62 段 `check:op-log-semantics` 是并发会话**未提交**的改动（他们那条线自己带一个未跟踪脚本
   `scripts/mutate-op-log-semantics.mjs`）。任务 0 量的 62 与此一致，但**完成条件里"62 段 exit 0"
   这个说法要按载体写明**：本条线交付的 HEAD 上是 61 段。
3. ⚠️ **HEAD 上 `check:shell-unicode` 是红的**（3 处在 `scripts/mutate-closeout-gates.sh`，`cc974fbd` 提交），
   地界外不代改，登记在 B36.2 ⇒ "check 全量 exit 0"这一条在完成条件 2 上目前**不可能由本条线单独达成**。

顺带一条本仓纪律级的事故（写在 B37，因为它会重演）：为了让 `package.json` 那 6 行**只带我的 hunk** 进提交，
我按"备份工作树 → 临时写成 HEAD+我的行 → `commit --only` → 还原备份"三步走，而**备份那条 `cp` 因为同一行里
`sh -c` 的引号解析失败根本没执行**，于是第二次尝试直接把并发会话那 2 行未提交改动覆盖了。
已按其提交前的 `git diff` 原文逐字重建并放回（`git diff --numstat` 回到 `2/1`、两行内容与覆盖前一致）。
教训不是"别 temp-swap"，而是**temp-swap 前必须验证备份存在**（`test -f 备份 || exit 1` 放进同一条链里），
以及**长命令链里前面那半句也可能整行没跑** —— 不能假设"&& 左边的副作用已经发生"。

### 7.25 ✅ 任务 2/3/4 落地，加三条"不是代码问题"的事故（2026-10-03 16:0x–19:2x，载体 `ff205edc`）

五笔提交：`192a516d`（清单/标签/习惯的改名与删除，两端）、`120c8153`（周小结带走 / 权益可见 / 便签改得动）、
`814b35b4`（补上一笔漏掉的共享编辑器本体）、`54669937`（矩阵四行改口 + 被本批否证的自述注释）、
`ff205edc`（真机两张截图入库 + 审计 §3.2）。

**完成条件 1 的现量** —— 六行各自的复跑命令，`cd apps/mobile`，载体 `ff205edc`：

| 命令 | 读数 |
|---|---|
| `npx vitest run tests/organizer-rename.spec.ts` | `exit=0` ｜ `Test Files 1 passed (1)` ｜ `Tests 26 passed (26)` |
| `npx vitest run tests/note-edit.spec.ts` | `exit=0` ｜ `Tests 15 passed (15)` |
| `npx vitest run tests/growth-share-summary.spec.ts` | `exit=0` ｜ `Tests 13 passed (13)` |
| `npx vitest run tests/reminders-notes-display.spec.ts` | `exit=0` ｜ `Tests 17 passed (17)` |
| `node scripts/check-l4-no-style.mjs` | `exit=0` ｜ web `98 ≤ 104`、`apps/mobile/src/screens` `90 = 90` |
| `node scripts/check-pricing-consistency.mjs` | `exit=0` ｜ 价格四处一致（¥5/¥12 两档） |
| `check:reachability` `check:ui-language` `check:payment-entry` `check:script-snapshot` `check:journey-coverage` | 各 `exit=0`（词条表中英各 2881、扫描 300 文件零硬编码） |

三条后来者会重复踩的，都发生在这一批：

1. 🔴 **按路径过滤的提交看不见未跟踪的新文件**。`120c8153` 漏了 `packages/ui/src/notes/NoteEditor.tsx`
   和三处配套，于是 **HEAD 单独检出编译不过**（`NoteEditScreen.tsx:41` import 的是 HEAD 里不存在的导出），
   而同一时刻工作树里 `pnpm check` 全绿 —— 因为工作树有那个文件。查法不是"再提交一次试试看"，
   是**反向 import 图**：`git archive HEAD | tar x` 拿到纯 HEAD 那棵树，再逐个 import 查它引的符号
   在同树的导出面里有没有。正向（我的文件 import 谁）看不到这个洞，因为两边都"在"。
2. 🔴 **我把"整条设备脚本没跑通"记成了"一张截图都没有"** —— `ls apps/mobile/evidence/` 实测两张存在且非空，
   人打开看过（一张是「编辑便签」那屏，一张是改过之后的列表）。错因：拿脚本第 12 步那条**整体判据**
   （三张齐才算过）去倒推局部是否存在。**"整体没过"推不出"局部都没有"**，登记"未取证"前先 `ls`。
   那枚 `app-release.apk` 已被并行会话 19:07 的构建覆盖 ⇒ 新鲜度**无法逐字节复现**，改用三条：
   六个源文件最后写入在 16:20–16:31 且此后 vs HEAD 逐字为空 / needle 自带 `171747` 比最后改动晚 46 分钟 /
   「编辑便签」那一屏只有 16:21 之后才存在的 `NoteEditScreen` + `NoteEditor` 画得出来（第三条同时否证了
   我自己那句"装的是旧产物"）。
3. 🔴 **`pnpm -s run <不存在的脚本名>` 是 `exit=1` + 零输出**，与"门禁真的判红"在输出上完全同形
   （去掉 `-s` 才有 `[ERR_PNPM_NO_SCRIPT]` + "Did you mean…"）。我因此把两条 `exit=0` 的门禁报成了红。
   真实脚本名是 `check:pricing` 与 `check:l4` —— 任务书里写的 `check:pricing-consistency` /
   `check-l4-no-style.mjs` 是**文件名**，登记在 **B50**，含防法：批量循环前先逐名 assert 存在于
   `package.json`，且循环里不要用 `-s`（非零时贴全文）。

**完成条件 2 的现状（诚实版）**：62 段链在载体 `54669937` 上实测 **58 段 `exit=0`、0 段红**，4 段未跑
（段1 `pnpm build` + 段53/54/55 三段 Playwright）；原因与现量读数在 **B48** —— `:3000` 仍被并行会话占着
（本轮复量 `node 80257 … TCP *:3000 (LISTEN)` 仍在），而 `check:ai-e2e` 的前置会 SIGKILL 别人的 vite（traps #87），
`pnpm build` 会在别人跑到一半时重写 `packages/*/dist`。四端重装未跑（**B49**，它会 `adb uninstall` / `simctl uninstall`，
是"影响别人"而不是"我这边慢"）。`skipped=0` 与 `l4 ≤ 104/90` 两条本轮复量成立。

### 7.26 ✅ 任务书拍板那半件：`check:ai-coverage` 改成按端枚举，"半接即红"（2026-10-03 19:3x）

任务书写的是「AI 上移动端：功能不做，**但先改 `scripts/check-ai-coverage.mjs` 让它按端枚举**
（现只扫 `apps/web`）—— 不改它，以后移动端接完 AI 门禁照样绿」。这句的机关不在"多扫一个目录"，
在于**原来那条结论本身就是谎**：`✅ 5 个 AI 功能全部端到端可达` 说的是 web，读的人以为是产品。

改了三处，一处理论上会咬人：

1. web 那两级核对（有调用点 + 那个界面文件自己也被挂载）**一行没动**，只是输出里现在写明
   `界面端覆盖：web 5/5（两级核对）`。改前改后 `diff` 只差新增的那几行，退出码同 0。
2. 新增 `GAP_ENDS` 表登记移动端"此刻刻意没做"+ 理由 + 出处（B34），输出成
   `mobile 0/5（**显式登记的缺口**：…）`，并在结尾那句 ✅ 后面**跟着**一句
   "这句不是已通过 —— 它的意思是这一端一条都没接，所以没有半接的谎"。
3. 🔴 咬人的那条：**这一端一旦出现"从 `@heyta/app-host` import 了某个 AI 入口"，
   剩余没接的那几条立刻转红**；全接完了也不放过 —— 那说明登记本身过期了，红着逼你把它并进两级核对。
   这样"登记缺口"不会变成 l4 那种永久豁免（基线不跟着降就只剩"只减"的前半句）。

**判据用什么形状，是被实测教出来的**：原本想沿用 web 那条 `includes(entry)` 子串判，一量就废 ——
`tool-calling` 的入口名恰好叫 `request`，而 `apps/mobile/src` 里 3 个文件本来就在写
`requestPasswordReset` 之类的词，子串判会把一条从未接线的端点亮成"已接 1 条"。
所以改成只认 **import 说明符**里的那个名字。**变异臂第一次是存活的**（探针文件写的是双引号
`from "@heyta/app-host"`，而我的正则只认单引号）⇒ 修的是门禁不是探针：`['"]…['"]` 两边都收，
再测两条臂（双引号一条、多行 + `as` 别名一条）⇒ `exit=1` 且精确点名缺的
`prioritize / duration-estimate / tool-calling` 三条；删掉探针 ⇒ `exit=0`、残留 0 文件。

顺带把审计 §3 那行 AI 的移动端格子补上"判据已按端补齐"，B34 里"本 Goal 只做那半件"就地打勾
——**出境语义那一句仍未拍**，所以移动端 AI 一条功能都没接，这是拍板不是漏。

**地界冲突怎么判的（写下来免得下一批重新猜）**：`scripts/check-ai-coverage.mjs` 不在任务书"只允许改"那张表里，
而"判卷冻结"那句写的是「其余 `scripts/check-*.mjs` 不许改」。两处都由同一份任务书写的，冲突按
**点名优先**解：拍板那一节**指名道姓要改这个文件**并给了理由（"不改它，以后移动端接完 AI 门禁照样绿"）。
方向上也站得住 —— 这次改动**只会让门禁更严**（新增两条红分支），没有任何一条既有判据被放松或删除，
web 那两级的形状逐字未动。
