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
| `check:landing-e2e` | 15 passed / 2 failed | 未复跑（见下面负载那一段）；改成**静态复核**：判据仍在 `e2e/landing/docs-centre.spec.ts:950` 数 `img[src^="/assets/docs/"]`，而 `git ls-tree -d HEAD apps/landing/public/assets/` 仍只有 `help` | ✅ B24 那句未变（该红**没有被修**），且这不是"跑不出来所以不知道"—— 死链的成因在提交态里可读 |
| `check:ai-e2e` | 98 passed / **3 failed** | 🔴 **未复跑，且这一条的归因现在不能照抄**（见下） | ❌ **前置条件已消失** |

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
   `pnpm check` 全量绿 ❌ **未达成**：57 段链里当前有 3 段红，
   分别是 `check:l4`（M3 的 8 处内联样式，B18）、`check:landing-e2e`（B24，文档中心条线）、
   `check:ai-e2e`（B22，**归因待重验**）。三段没有一段是本条线引入的，
   而"不为了变绿去放宽基线/改别人的判据/吸收别人的债"是本 Goal 的硬约束，所以这里如实记红。
   ⇒ **因此本次不将 Goal 标记为 complete**：③ 的第一句没做到，做不到。
