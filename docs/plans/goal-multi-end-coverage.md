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
| 五 | ✅ **已完成（2026-10-03）** | `verify:mobile-restore` 真模拟器 + 真服务端 + **真浏览器导出**，零 mock：**24 项全绿 / exit 0**（run23，02:46–02:51）。四条判据：① 两条入口都在（选文件 / 粘贴），粘贴的垃圾内容被预检拒绝**且界面说出人话**；② 选文件 → 预检展示 counts（任务 3 · 清单 1 · 标签 1 · 5 条操作日志）→ 确认 → 「还原成功」，随后**截断版走同一条文件路径**也被拒（一个字节都没写）；③ 任务列表数得见 3/3（标签 chip `backup-tag-1` 也在屏上）；④ 还原后同步**不落失败态**（0s 内落到「已是最新」），且手机**自己**写的那条 op 在 20s 内出现在服务端（新增 1 个备份里没有的 opId）。🔴 **④a 原来断的是"备份 opId 要出现在服务端"，那是断错了不变量**：还原走 `appendImported`，这些 op 带的是**原设备**的 clientId，服务端 `validateOp` 对不匹配的署名逐条回 `INVALID_CLIENT_ID`（`validation.service.ts:75`）⇒ 设计上就不上行；改成断真正的不变量（不落失败态 + 自己的写还能出去），命中数只打印不判定。**同一次运行照出一个真缺陷**：成功语 `mobile.restore.done` 写着"配置同步后会自动上行"——每个字都是假的，已按产品事实改写并中英同步。**变异两条，各自精确**：M1 拿掉 `handleRestoreText` 里"把拒绝原因说出来"那一步 ⇒ **14 绿 2 红**，红恰好是②后半「截断文件没被拒绝」+ ①后半（其余 14 条仍绿 = 变异没有连带破坏）；M2 让 `confirmRestore` 什么都不写（按钮留着）⇒ **14 绿 2 红**，红恰好是②「没看到还原成功」+ ③「0/3」。两条臂都按**三段 sha256**（变异前 / 还原后逐字节相同）收口。新增基础设施：Android 原生模块 `HeytaLocalFs.readTextUri`（RN 0.84.1 在 Android 上根本读不出本机 URI，traps #124）+ `local-file-read.ts` 的 blob 退路。**实施中修掉的探针/环境缺陷 6 类**（traps #135–#139）：验收栈三份产物不同代（服务端进程 18:56 早于 dist 00:53、E2E 库少两条迁移被旧进程掩盖）、`focus_is` 的 `grep -o` 把组件名截断⇒两条前台判定恒假、helper 定义在首次调用之后被 `\|\|` 吞成警告、**键盘带吃掉下半屏点击**（「确认还原」被打成一个字符 `v`；修法是把会立键盘的那一步挪到这块屏最后 + 每处点击前 `require_keyboard_down`）、点了 FAB 不等于面板开（`input tap` 抛 Java 异常而退出码 0）、设备被别的会话的 app 抢走（`cloud.finlaw.ssos`）⇒ 新增 `require_our_app_foreground` 与开局的服务端同代探测（401=在 / 404=旧⇒exit 3）。验收服务端在**自己的端口 3100** 上从当前 dist 起重，不动别的会话占用的 3000。**收尾时又复跑一轮 run24（03:39–03:48）：25 项全绿 / 0 失败** —— 多出的那 1 项是**文案真实性判据**（成功语必须含「只在这台设备上」）：只断"还原成功"四个字的话，那句假文案改回去也照样绿。同一轮实测自快照 bootstrap 真在跑（进程是 `scripts/.verify-mobile-restore.sh.snap.<pid>`），并把本脚本登记进 `check:script-snapshot` 的 MANIFEST —— 那道门禁的文件头明写"新增长跑 .sh 要加进来"，而它**原来抓不住我**（不加就一路绿灯） | `scripts/verify-mobile-restore.sh` · `apps/mobile/src/screens/ExportScreen.tsx` · `apps/mobile/src/lib/local-file-read.ts` · `apps/mobile/android/.../fs/LocalFsModule.kt`+`LocalFsPackage.kt` · `e2e/restore-export.cjs` · `apps/mobile/evidence/android-restore-{done,tasks}.png`（**两张都已人眼看过**：成功语含新文案、任务 3 条 + 标签 chip）· traps #124–#129、#135–#139 · `docs/research/multi-end-entry-coverage-audit.md` P1-2（含三条边界）· `/tmp/restore-run23.log`、`/tmp/restore-run24.log`（收尾复跑，25/0）、`/tmp/restore-m1.log`、`/tmp/restore-m2.log` |
| 收尾（check + reinstall:all + 审计回填） | ✅ **已完成（2026-10-03）—— 但 objective 里"`pnpm check` 全量绿"这一条未达成，原因逐条列在下面，没有一条是本批放宽判据换来的** | **① 提交（共享工作树归属纪律）**：本条线四笔 —— `51d828c5` 批五还原卡（20 文件 / +1748 / −18）、`ee5b96e8` 桌面端 vite 解析锚点（3 / +47 / −22）、`771c35c9` 补 `OpLogEngine.getAllOps`（1 / +12）、`9a0ea6d5` 把构建挪到 `check` 链首 + 修掉本批自己带来的两道红（5 / +111 / −8）。全部用 plumbing（`commit-tree` + `update-ref` CAS）只提自己那批路径，**别人 9 条暂存条目最终完好**（`BLOCKED.md`/`PROGRESS.md`/`Podfile.lock`/`package.json`/`pnpm-lock.yaml`/`server/*` 等）。🔴 中途**犯了两次**"刷索引覆盖别人暂存条目"（第一次 4 条、第二次 2 条），全部无损复原，修法已从文档搬进脚本 —— 见 traps **#146**。<br>**② `pnpm check` 断点之后的 57 段逐段实测**（`/tmp/heyta-seg-loop.sh`，干净检出 `/tmp/heyta-g5`，删掉全部 dist 起跑）：**53 绿 / 4 红**。本批自己带来的 2 道红**当场修掉并复绿**（`check:rn-aria`：批一 DatePicker 的对象形态 `accessibilityState` → `aria-selected`；`check:shell-unicode`：本批脚本 5 处 `$var` 紧跟中文）。剩下 4 道红：`check:l4`（`apps/mobile/src/screens` 内联样式 **113 > 基线 90**（门禁口径，它数之前先 `stripComments`；纯 grep 是 116），开工前一笔 `ccd3cd83` 实跑即 111>90，属 M3 的账；🔴 **本批给棘轮添了 2 处** —— 还原卡的 `Card gap` 与预览块 `View gap`，登记见 BLOCKED **B21**，不顺手放宽基线）、`check:empty-state`（2 处新手写空态，属批二/批四/M3 那条线）、`check:ai-e2e`（**98 passed / 3 failed**）、`check:landing-e2e`（15 passed / 2 failed）。<br>🔴 **那 3 条 e2e 红不算到提交态头上，但也没有证伪**：失败形态是 `element is outside of the viewport` 重试 60s 超时，而同三条 spec 在别的时刻的跑次里全绿（`/tmp/e2e-full-r11b.log` 04:58、`/tmp/g6-e2e.log` 01:00）；e2e 的 `webServer` 端口写死 4318/4319 且 `reuseExistingServer:false`，`check:ai-e2e` 的 preflight 还会 **SIGKILL** 别人的 dev server —— 我量 rr-49 那一刻（04:29）与之后（04:57 实测 `lsof :4319` 被 pid 95629 占着）这台机器上都有**别的会话在跑同一套 e2e**。仓库里已有两条同族陷阱（"e2e 套件不能与自己并发"、"同树任何会话写文件都会打断在飞的 e2e"）与**另一条会话的 B19**（它记的现场里，占着 4318/4319 的正是我 04:21 起在 g5 跑的那条 playwright），所以**不另开新号**；🔴 而它同时给了我这条红的反证 —— 对方 04:31 释放端口后复跑 `narrow-sweep` + `motivation` **17/17 全绿**，恰好是我 04:29 那三条红里的两条。低负载复跑那一端登记在 BLOCKED **B22**。<br>**③ 四端重装**（`scripts/reinstall-all.sh`，全部在隔离检出跑 ⇒ 装的是**提交态**产物）：**mac ✅**（.app+.dmg 重打、装进 /Applications、主蓝命中 **1137**、内容占比 100%、**暗色**主题下真应用）、**windows ✅**（源码同步 + sha256 对账 `5653e872…`/`879483a5…`，远端取证四条 `ADD_APPX=OK` `RESULT=OK` `PAYLOAD_WEBDIST=True` `M2D=OK`，截图是**真应用 + 身份菜单开着**）、**android ✅**（release APK 63M 重打、emulator-5556 全新安装、主蓝 **4036**）、**ios ✅**（Release 重打 + 全新安装、新鲜度判据"已装的包比源码新"、主蓝 **4136**）。🔴 **四张截图我逐张看过**（§6.2 规定一）：三端首屏都是真中文界面 + 首启隐私同意面板，mac 那张是暗色主题的收集箱。<br>**④ 审计回填**：goal §7 五行（一~五 + 本行）、`docs/research/multi-end-entry-coverage-audit.md` P1-2 三条边界、traps **#146/#147/#148/#151**、BLOCKED **B15 解除 / B16 / B18 定稿 / B21 / B22**。🔴 其中 **#150 是一条自我推翻**：我一度实测出"`pod install` 复现不出提交态 `Podfile.lock`（401/1141、216 vs 228）"并准备入档，复测两次（热跑 + 删 `Pods` 冷跑）后是 **2 行 `SPEC CHECKSUMS`（hermes-engine / ReactCodegen）、PODS 段 146/146、`check:native-deps` 绿** —— 提交态**是**可复现的，那条"结构性缺陷"是我一次口径没钉死的读数。 | 四笔提交 `git show --stat` · `/tmp/heyta-seg-loop.sh` 与 58 份 `/tmp/seg-*.log` · `/tmp/rr-{12,13,46,49,50,51,52,53,54,57,57b,57c}.log` · `/tmp/g5-ri-{mac,mob,mob2,win}.log` · `/tmp/heyta-reinstall-{mac,apk,ios-build,win}.log` · 四张已看截图 `/tmp/heyta-reinstall-mac-installed.png.webview.png`、`/tmp/heyta-g5/dist/windows/packaged-first-run.png`、`/tmp/heyta-reinstall-android.png`、`/tmp/heyta-reinstall-ios.png` · `apps/mobile/evidence/android-restore-{done,tasks}.png` |
