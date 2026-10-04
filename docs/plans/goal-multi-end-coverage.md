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

**原始缺口**：提醒两端都能建（数据层同步），web 有到点投递（Notification API），移动端只有数据 op。2026-10-03 已实现原生投递，完整验收状态以本节与 [ADR-0051](../adr/0051-mobile-reminder-delivery.md) 为准。

**Step 0 · 依赖裁决（本批第一件事，产出登记后才许动工）**：
调研 RN 本地通知库（候选：`@notifee/react-native` 等），逐项过 §3.1 最后提交/发版时间 + §3.2 许可证，登记进 `license-inventory.mjs`。**没有库过两道门 ⇒ 本批终止并上报**，禁止手搓原生模块或轮询兜底。

**2026-10-03 范围更新**：用户将完整 C 架构与实施纳入本会话 Goal，原批次“没有库则终止”的执行边界由 ADR-0051 的原生适配方案接替：Android 使用系统 AlarmManager，iOS 使用 UNUserNotificationCenter，均无第三方通知依赖。维护成本由仓库承担，必须提供原生回执、权限、进程终止和当前安装产物证据；这一选择不表示任何被排除的第三方依赖获得豁免。共享排程只消费物化状态，原生桥不得直接写业务库。

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
| 三 | 🔄 **Android 主链与异常恢复已验，iOS 续验中（2026-10-03）** | 当前 Release 在无窗口模拟器完成真实 UI → 后台投递 → 删除撤回 → 贪睡十分钟/SIGKILL 后投递 → 点击返回，共 11 项通过；权限恢复、force-stop/整机重启后再次启动补发、未来 alarm 删除各 5 项通过。禁用调度器的 Release 变异被 OS 通知判据抓到。通知及前后对照截图已人工查看；iOS、最终门禁与四端当前产物仍待验，详见 [ADR-0051](../adr/0051-mobile-reminder-delivery.md)，不能据此宣布整批完成。 |
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

### 7.27 ✅ 任务 4 最后一条子项定论：字形**本来就只有一种**，所以这条不需要改代码（2026-10-03 19:4x）

任务 4 写着「词条 `{{count}}` 与 `{count}` 两种字形统一」。量完的结论是：**会被渲染出去的值里
一条双括号都没有**，双括号只活在解释来历的注释里。所以这一条的交付是**一条可复跑的测量 + 一条
会红的常驻判据**，不是一次改动。

三条命令与读数（19:3x–19:4x，载体 `05293b7d` 之后）：

```
# 一次性测量（脚本在 /tmp，不复跑；它只回答"值里有没有双括号"这一个瞬时问题）
$ node /tmp/glyph-check2.mjs
zh-CN: 单引号键解析 2869 条｜双引号/反引号键 0 条｜行首像词条的行 2905 行｜值里含 {{ 或 }}: 0 条｜含 count 占位符 101 条（双括号 0 条）
   对照：注入 1 条 {{count}} 后 双括号值 = 1 条（新增 1），注入项被抓到 1 条 => 检测器有效
en: 单引号键解析 2869 条｜双引号/反引号键 0 条｜行首像词条的行 2905 行｜值里含 {{ 或 }}: 0 条｜含 count 占位符 99 条（双括号 0 条）
   对照：注入 1 条 {{count}} 后 双括号值 = 1 条（新增 1），注入项被抓到 1 条 => 检测器有效

# 下面两条才是复跑载体
$ grep -n -e '{{' -e '}}' packages/i18n/src/locales/zh-CN.ts packages/i18n/src/locales/en.ts
zh-CN.ts:1123,1125 / en.ts:1038,1040   # 四处全是注释（讲 react-activity-calendar 那个库形状的来历）

$ cd apps/mobile && NO_COLOR=1 npx vitest run tests/growth-share-summary.spec.ts
 ✓ tests/growth-share-summary.spec.ts (13 tests) 5ms      # 13 passed
```

两个"0"都单独配了对照，因为**零命中不加对照不算证据**（记忆里这条是被教过的）：解析器那条在内存里
注入一条 `{{count}}` 再量（不落盘），看它从 0 变 1；常驻判据自己带了同款阳性对照
（`growth-share-summary.spec.ts:197` 断言"原始文件里确实有 `{{`"，否则"值里 0 处"可能只是过滤器坏了）。

**变异读数（这条子项真正的证据）**：把 `en.ts:1131` 的 `'{count} records…'` 改成 `'{{count}} records…'`，
跑 `-t '占位符字形'` ⇒ `1 failed | 3 passed | 9 skipped`，红在 `:195`（"两张表的值里都没有双花括号"）。
还原后 `cmp` 报 `RESTORE_CMP=IDENTICAL`、sha256 回到改前的 `59d53419…`，复跑 13 passed。

⚠️ 那一次里**另一条臂存活了** —— `web.growth.year.heatmap 是真插值`。原因查实了，不是它没牙：
它走 `translate()`，而 `require.resolve('@heyta/i18n')` 指向 **`packages/i18n/dist/index.js`**（19:29 构建），
只改 src 不重 build 就打不到它。我没有为了这条臂去重建 `dist`：那是共享产物，别的会话正在跑打包与设备验收
（同一份 `dist` 会被他们读走）。**记下来给后来者**：验这类"只改词条"的变异，要么连 build 一起，
要么只认读 src 的那条臂 —— 别把"存活"读成"没牙"，也别把"红"读成"两条臂都在守同一件事"。

📌 顺带一条踩过的坑：第一次量用 `grep -c "{{count}}" packages/i18n/src/*.ts` → **0/0**，看着像"已经干净"，
其实是 glob 根本没进 `src/locales/` 子目录 —— 假空。词条表在 `packages/i18n/src/locales/{zh-CN,en}.ts`。

📌 **载体两个都量**（这两个文件正被并行会话改着，工作树 ≠ HEAD）：`git show HEAD:… | grep -c -e '{{' -e '}}'`
与同一条 grep 跑工作树，**都是每份 2 行、且都是注释** ⇒ 这条结论不依赖谁此刻有没有提交。

### 7.28 完成条件逐条的现量与"差什么"（2026-10-03 20:1x，载体 `a633183c` 之后）

**条件 1 ——「缺代码那 6 行全部翻 ✅」：3 行 ✅、1 行的本批子项 ✅ 但整行留 🟡、2 行 🟡，三条 🟡 的解锁动作都在禁区内。**

| 矩阵行 | 现在 | 复跑命令（`cd apps/mobile`）| 没翻成 ✅ 的那一半是什么 |
|---|---|---|---|
| 习惯 改名与删除 | ✅ | `npx vitest run tests/organizer-rename.spec.ts` → 26 passed | — |
| 便签 编辑 | ✅ | `npx vitest run tests/note-edit.spec.ts` → 15 passed | 接线已完；真机只走到第 5 步（§3.2） |
| 搜索 | ✅ | `npx vitest run tests/reminders-notes-display.spec.ts` → 17 passed | — |
| 清单/标签 改名、归档 | 🟡 | 同上 `organizer-rename` | 本批两项都 ✅；留 🟡 的是**父子层级选择器**。🔴 22:0x 查到底：`ProjectActions` 接口面上没有改父方法，**但 `project-actions.ts:165` 那个私有的 `updateProject(entityId, payload)` 是开放 payload 的现成派发器**（rename/setColor/archive 全是它的一行包装）⇒ **写侧只差一个同形状的接口包装 + 守卫**（任务侧 `actions.ts:613-625` 的 `setParent` 守卫可对照），真缺的是**两端的选择器界面 + 词条**，且 web 同样没有 ⇒ 跨端形态是产品裁决，不在本 goal 的四项里。取证与那条 `moveProject` 撞 `removeProject` 子串的假命中记在 **B52** |
| 成长统计 | 🟡 | `npx vitest run tests/growth-share-summary.spec.ts` → 13 passed | 分享块 ✅；**热力图 / 补打卡 被冻结判据钉住**（B41/B42，机制见下） |
| 订阅/权益可见 | 🟡 | `node scripts/check-pricing-consistency.mjs` → exit 0 | 权益卡 ✅；**"到 X 日到期"拿不到**（B45，实测见下） |

🔴 **本轮把 B41/B42 的机制查到底，两处原话都被实测否证/加严**（细节在 BLOCKED 那两条就地更正）：
① `growth-display.spec.ts:364` 那句"一旦有人传了 activityDays，这条会先红"**不成立** ——
`:365` 只调适配层、从不读屏幕（`apps/mobile` 下 `activityDays` 9 处命中无一断言屏幕）。
真正拦住的不是"传 prop"，是"给网格一个诚实的无障碍名"，而那个名字的判卷被钉成空串。
② 补打卡不是"判据拦我"，是**接了也不出现**：`HabitStreakList.tsx:269` 是
`onRepair === undefined || labels.repairAction === undefined ? null : <Pressable>` ——
**或**条件，而 `:302` 钉 `repairAction` 必须是 `undefined`。 ⇒ 两条都要翻冻结判据，本条线没这个权限。
③ 权益那条也实测了：`entitlement.ts` 那次 GET **一个响应字段都不消费**（文件头自述 + `parse…` 只看
status/reason），而 web 侧的"到期条"同样只有 `expired`/`refused` 两个布尔（`SubscriptionNotice.tsx:78`）
⇒ "到 X 日"确实要动服务端面，不是我没接。

**条件 2 —— 逐条：**

| 约束 | 状态 | 现量 |
|---|---|---|
| `pnpm check` 62 段 exit 0 | 🔴 **未达成（57/62 段可过）** | 差的 5 段是 3 个 Playwright 段（要 `:3000` 空闲且无别人 vite；`check:ai-e2e` 会 SIGKILL 别人的 dev server，traps #87）+ `check:shell-unicode`（HEAD 上就红，在别人提交的 `scripts/mutate-closeout-gates.sh`，B36.2 地界外不代改）+ **`check:docs`（第 34 段，21:0x 现量 exit=1；死链**处数是活的**，同一小时内 27→32，本条线造成的是 0 处，逐条归属见下一段）**。20:0x 现量：`vm.loadavg 1min=72`、`:3000` 被 PID 80257 占 ⇒ **窗口不在**，不是产品红 |
| 四端重装 `INNER_EXIT=0` | 🔴 **本轮没跑** | 同一条环境判断；上一次四端跑绿的载体不是本轮交付，不拿来顶替 |
| `skipped=0` | ✅（本批口径） | 本批四个判据文件各自 skipped 0；全量 `pnpm -r test` 的 12 条 skipped 是既有浏览器 E2E 默认跳过（AGENTS §6 的口径），不是本批新增 |
| l4 ≤ 104/90 | ✅ | 98 / 90（`node scripts/check-l4-no-style.mjs`） |
| 判卷文件除点名那处外 diff 为空 | ✅ | 复跑：`for s in 76cbee51 c506953b 192a516d 120c8153 ff205edc 05293b7d a633183c; do git show --name-only --format= $s \| grep -E '^(e2e/|apps/mobile/tests|scripts/check-.*\.mjs$)'; done` ⇒ `e2e/` **零行**；`apps/mobile/tests` 只有 **A 三个新 spec + M `reminders-notes-display.spec.ts`**（就是点名那处，现内容 `toContain('onEdit=')` 带翻向注释）；`scripts/check-*.mjs` 只动点名的三个（`check-script-snapshot` / `check-journey-coverage` / `check-ai-coverage`） |

⚠️ **顺带一条会重演的坑（本轮自己踩的）**：我在 B33 与审计矩阵里把那份新契约写成 `docs/adr/0050-…`，
读的是并行会话刚改过的 AGENTS.md，**几分钟内它自己把号让给了 0051**（`0050` 现在是 E2EE 密钥生命周期）。
两处编号已就地改对。**引用别处的编号必须落盘前 `ls` 一次，抄 AGENTS 里那句"本文件不写条数"的同一条纪律。**

⚠️⚠️ **上面那句"复跑 `check:docs`"我曾经写成 exit=0，那是假的**（写进 `PROGRESS.md` 后复跑当场变红，
已在 `PROGRESS.md` 与 B50 就地更正；这一条已编号 **B51**）。21:0x 现量与逐条归属（三条命令，都在仓库根跑）：

```bash
NO_COLOR=1 pnpm check:docs > /tmp/chk-docs.log 2>&1; echo "exit=$?"   # → exit=1，打印「发现 N 处本机有、仓库里没有的链接」；N 是活的（本小时三趟：27 / 32 / 33）
grep -E '^   [a-zA-Z0-9_./-]+\.md:[0-9]+' /tmp/chk-docs.log \
  | sed 's/^   //; s/:[0-9]*$//' | sort | uniq -c | sort -rn
#   → 27 那一趟：9 ui-review-fill-zh-timeline · 9 docs/README.md · 2 detail-pane-alignment-and-spaced-review
#     · 2 docs/adr/0008-vector-clock-limit · 1 × 5 份
#   → 33 那一趟：9 / 8(docs/README) / 8(performance-hotpaths-audit.md，HEAD 里根本没这个文件) / 2 / 2 / 1 × 5
grep -c 'multi-end-entry-coverage-audit\|goal-multi-end-coverage\|0051-mobile-reminder' /tmp/chk-docs.log   # → 0（本条线 0 处，三趟都是 0）
```

逐条问「HEAD 上那份源文件里还有没有这个引用」+「目标被 HEAD 跟踪吗」。
目标路径**不用自己解析** —— `check:docs` 的输出每行都印了「（解析到 <仓库内路径>，…）」，直接取它。
第二问用 `git ls-tree HEAD -- <那个路径>`（空 = 没跟踪）；第一问要用**链接整串**当 needle，
不能用文件名（原因见下面 🔴 那条，我自己踩了）。**第一问要用链接整串、不能用文件名**
——原因见下面 🔴 那段②，我用文件名量出过一次假红。分出来是两类：

🔴 **这个总数是活的，不是提交属性**。同一小时内我复跑三趟：**27 → 32 → 33**，每趟分布都不一样
（`docs/README.md` 9→8、`performance-hotpaths-audit.md` 无→7→8、`ui-review-fill` 恒 9），而中间那一趟里
`performance-hotpaths-audit.md` **在 HEAD 里根本不存在**
（`git show HEAD:docs/research/performance-hotpaths-audit.md` → `fatal: … exists on disk, but not in 'HEAD'`）
⇒ 是并行会话正在写的文件里新长出来的引用。**所以这张表按分类读**：只有两栏是稳的——
**"HEAD 上就红"三趟都是 3 条**、**"本条线造成"三趟都是 0 条**。

| 分类 | 处数（三趟 27 / 32 / 33） | 是什么 |
|---|---|---|
| 只在**本混合工作树**成立 | **24 / 29 / 30** | 别人的**未提交引用**（源文件全是 `M`）指向别人的**未 `git add` 文件**（`docs/adr/0046/0047/0048`、`docs/plans/trash-and-archive*.md`、`docs/research/performance-hotpaths-audit.md` …）。HEAD 版 `ui-review-fill-zh-timeline.md` 只有 2709 行、工作树 2996 行 ⇒ 它那 9 处引用全在未提交的 +287 行里 |
| **HEAD 上就红** | **3（三趟相同）** | `docs/plans/detail-pane-alignment.md:4` → `calendar-year-time-and-mobile-profile.md`（未跟踪）；`docs/research/detail-pane-alignment-and-spaced-review.md:101` → `trash-and-archive-best-practice.md` 与 `../plans/trash-and-archive.md`（均未跟踪）。两份源文件工作树**干净**、HEAD **已跟踪** ⇒ 这三条是"引用提交了、目标没 add"，在 CI 上一样红（编号 **B51**，不代改的理由在那条里） |
| 本条线造成的 | **0（三趟相同）** | 代码块最后一条命令的读数。按归属纪律不代别人改文档（B47 同一条） |

⚠️ 上面这套问法**自己差点给出第 4 条"HEAD 上就红"**——原因在下面 🔴 那条的②，不是我事后补的教训，是当趟就错了一次。

🔴 **归属探针自己差点错两处，都记下来**：① 我头一趟按**解析后的绝对路径**去 HEAD 里 grep，
`ui-review-fill` 那条得到 0 命中，我差点把它归成"HEAD 没引用"——**文档里写的是相对串**
`[.](../../apps/web/evidence/calendar-day/README.md)`，绝对路径永远匹配不上；
② 反过来按**文件名**grep 时，目标叫 `README.md` 的那条在 HEAD 里命中 **6 行**，探针把它误报成"HEAD 上就红"
——通用文件名当 needle 就是假命中。**判死链归属要用链接整串，不能用 basename。**

🔴 **我加的那两处 `docs/adr/0051-mobile-reminder-delivery.md` 不在死链账里，但不是因为它是好的**：
两处都是**行内代码**（反引号）而不是 `[文字](路径)` 链接 ⇒ `docs-link-check` 从形状上就看不见它；
而 `0051` 这个文件此刻 **`git ls-tree HEAD` 查不到**（`git ls-files docs/adr/ | tail -4` 到 0045 为止）
⇒ **干净检出上那个路径指不到**。这是"不可点"而不是"死链"，判据只管前者。
我没有把它改成可点链接——把它登记进 `UNTRACKED_LINK_OK` 要为一条不是本条线产物的契约写一句理由，
那是替并行那条线代管，留给 owner。

✅ **这一条我当场做了阳性对照，而且是撞上去的**：上一段为了说明探针怎么错的，我在正文里抄了一个
行内代码形状的 `[.](../../apps/web/evidence/calendar-day/README.md)`——**那个目标同样是未跟踪的**
（`git ls-files apps/web/evidence/calendar-day` → 0 个文件）。改完这份文档后复跑 `check:docs`，
日志里 `goal-multi-end-coverage` **0 命中** ⇒ 同一个仓库里、同一次扫描下，**行内代码形状确实不进判据，
`[]( )` 形状进**（那一趟它自己就把 `ui-review-fill-zh-timeline.md:2737` 的同路径 `[]( )` 形态报了出来）。
不是推测，是这一轮顺手做出来的 A/B。
### 7.29 交接落盘（2026-10-03 21:2x，载体 96f3293d 之后）

本条线的交接文档已按 `docs/` 分层规则落在 [`docs/plans/multi-end-coverage-handoff.md`](multi-end-coverage-handoff.md)
（同目录已有 10 份 `*-handoff.md`，形态一致），并挂进 `docs/README.md` 的 plans 索引。
**它只写"现在在哪 + 下一步按什么顺序做 + 别再走一遍的死胡同"**，决策与归因仍在本文件 §7 与 `BLOCKED.md`。

⚠️ 上一条那个"`goal-multi-end-coverage` 0 命中"的读数是**按趟成立**的：本文件是共享台账，
21:1x 之后它已出现 **1 处**命中 —— 出处不是我写的句子，是并行会话把 104 行那句 W9 状态里的
`docs/adr/0051-…` 从行内代码改成了真链接 `../adr/0051-mobile-reminder-delivery.md`（目标仍未被 git 跟踪）。
**同一份文件、同一个目标、形状一变就从"看不见"变成"报出来"** ⇒ 上面那个 A/B 由双向证据闭合了。
那一行不进本条线的提交（提交方式见交接文档"死胡同警告"第一条）。

### 7.30 §5 四段的记账槽（02:1x 建槽；04:1x 现量：**② 与 ④ 已闭合**（② 三段 + 74 段逐段总账、④ 五张图逐张看过且 spec 已提交）；①③ 仍是槽；05:1x 复量把"卡在正在跑的那条"改成了 **"卡在那条已经永久挂住"**，见 ① 的第三小条）

⚠️ 下面那句"一条都没有起跑"**只对建槽那一刻成立**：02:35:26 窗口开过一次（闸门 `--target b` 退 0、
负载现量 12 = 阈值 12），② 因此有了真读数（已填进那一条），而 ① 与 ③ 在同一次窗口里被
**设备占用**挡住（`emulator-5554` 上 `com.heyta` 正在跑，是另一条会话的 `verify:handoff:prod --mobile-only`），
启动器按设计 `exit 3` 没去卸别人的 App。

Goal 原话点名的记账落点就是本节。**先建槽、后填读数** —— 建槽这一刻（02:1x 现量）§5 那四段
**一条都没有起跑**：窗口闸门在载体里连退 `3`（02:14:01 读数：1 分钟负载 32，阈值 12 = 16 核 × 3/4），
两台 booted 模拟器里 `com.heyta` 都在跑 ⇒ 这里**没有读数可记**，也不写"预计能过"。
每个槽位写死"待填 + 现量命令"，填的时候只替换那一条。

- ① 四端重装：`INNER_EXIT=` **待填** —— 现量命令 `bash /tmp/heyta-run-reinstall.sh --go`（载体 `heyta-wt-reinstall`）；截图逐张写明钉到哪一步、人看到什么，跟在这条后面。 —— 🔴 **截图↔步骤对照已按实现读好（见 §7.31.7）**，窗口里只填每张的 mtime/字节/md5 与是否「本轮新生」，另外两条「当前产物」的问题由 mac 的 web-dist 带分母对账与 ios 的新鲜度门各自回答，不外包给截图。
  - 🔴 **04:02 现量"为什么还没成交"**（三条同时成立才算窗口开，它们不会在同一刻成立）：
    ① **另一条会话正在跑 `reinstall:all`** —— `pid 81007`/`93771  sh /tmp/queue-reinstall-all.sh`，
    实际那一跑是 `pid 93817 bash /tmp/heyta-reinstall/scripts/.reinstall-all.sh.snap.93817`
    （**它用的是自己那枚载体 `/tmp/heyta-reinstall`，与我的 `heyta-wt-reinstall` 不是同一棵** ⇒ 不互踩工作树，
    但**照样互踩设备与安装包**，所以那道门该有）
    （就是 §6 里"它的前置不查有没有别人在重装"的那条队列，03:09 起排、04:02 开跑，
    **05:1x 现量它已经不会再自己结束** —— 见下面第三小条）。
    我的启动器那道 `pgrep -f 'queue-reinstall-all\.sh|scripts/reinstall-all\.sh'` 门因此退 3 —— **对称的互斥由我这一侧守**。
    ② **android 设备在用**：`emulator-5554` 上 `com.heyta` pid 20246、`mCurrentFocus` 指向它（① 要 `adb uninstall`、③ 要 `pm clear`）。
    ③ **负载 13.20 > 阈值 12**（`ncpu×3/4`）。
    ✅ **05:4x 审过 `scripts/reinstall-all.sh` 的失败汇总，`INNER_EXIT=0` 是硬门不是软门**
    （免得下一位重审）：`:486-504` 那个 `case "$r"` 有第三支 `*)` —— 某端**没走到判据**（既不是 OK
    也不是 FAIL）时打「🔴 没有结论（段内未走到判据）—— 按失败处理」并 `FAIL=1`；
    截图读不出来在 `:130` 直接 `exit 1`（不是"跳过这条判据"）；
    `--skip` / 不在 `--only` 范围的端各占一条**大字**分支，明写"这端**没有**验证当前产物"。
    ⚠️ 顺带一条**对 ① 有用的反向现量**：iOS 那三台 booted 里 **`heyta-iphone-17pro` 与 `iPhone Duo heyta` 的
    `launchctl` 读空**（没跑 com.heyta），只有 `heyta-ios-isolated` 在跑 ⇒ **ios 段有可用的空闲目标**，
    窗口开时不必把 ① 整体判死在 iOS 上。设备占用表每次现取，别抄这一行。
  - 🔴 **05:1x 现量：那条 `reinstall:all` 不是"慢"，是死等** ——
    `pid 95477 bash apps/desktop-macos/scripts/package-app.sh` 已 **1h57m**，累计 CPU **0:00.03**，
    `lsof -nP -p 95477 -i` **零条 TCP 连接**；它自己的日志停在 `═══ 1. macOS ═══`，
    后面 windows/android/ios 三段永远不会开始。根因是 `notarytool submit --wait` **没有上限**。
    ⇒ 这一条把 ① 与 ③ 一起钉死（互斥门要求"没有别人在重装"），而**它不会自己让开**：
    要么它的所有者杀掉，要么等到有别的窗口。我没有代它杀 —— 那是别人的一条验收，
    杀掉会让它的日志与载体停在半路（AGENTS §8.9 的共享资源独占）。
    ✅ 修法**已落 `694c05e3`**（`HEYTA_NOTARY_TIMEOUT` 默认 900s + 无 coreutils 时的纯 bash 看门狗，
    五臂夹具逐臂量过：`hang`→"N s 内没有返回"且 staple 0 次、`reject`→rc=1 分支、
    无 `timeout` 二进制的 `hang`→看门狗仍返回 124）。**但它救不了已经挂住的这一跑** ——
    上限只对下一趟生效；这一趟的 mac 段读的是它自己载体 `/tmp/heyta-reinstall/…` 那份旧代码。
  - ✅ **05:4x ① 的"起跑前就绪表"**（每条都是只读探，为的是窗口一开就没有**可预备的**失败原因）：
    | 端 | 前置现量 |
    |---|---|
    | mac | 公证 key 在 `~/Library/Private/AppStoreConnect/AuthKey_P68MYZ66HR.p8`；`/Applications/Heyta.app` 已装（段里会先卸） |
    | windows | `ssh windows-pc` 可达；远端默认 shell 是 **cmd 不是 PowerShell**（我第一发 `if (Test-Path …)` 被原样 echo、`whoami` 没执行）；`C:\src\heyta` = YES、`apps\web\dist\index.html` = YES、**没有 dotnet 在跑**（不抢 `C:\src\heyta`） |
    | android | `emulator-5554` 在线；此刻 `com.heyta` pid 20246 **在跑** ⇒ 这一条是唯一还没空的设备门 |
    | ios | 三台 booted 的 `launchctl` 全读空（05:3x 现量 0/0/0），启动器那条"逐台挑没跑着 com.heyta 的那台"三台都合格 |
    ⚠️ 顺带一条**会被误读成缺陷**的形态：远端 cmd 的中文输出是 GBK，`tasklist` 那句"没有运行的任务…"在
    本地看就是乱码 ⇒ **判"远端没在跑"要认结构化的 `echo YES/NO`，别拿乱码句子做 needle**
    （三层引号套 PowerShell 在这台机器上还会静默空输出，是同一族的另一面）。
    📌 所以 ① 的解除条件不是"负载降下来"，而是**那条 pid 95477 消失**。
    ~~现量命令 `lsof -nP -t -- apps/desktop-macos/scripts/package-app.sh` 为空 **且** `pgrep -f 'reinstall-all\.sh'` 为空~~
    🔴 **05:5x 现量把上面那条探针命令本身否证了**（它绿过一次，所以读起来像"已核实的事实"）：
    那条是**相对路径**，`lsof` 按调用方的 cwd 解析 ⇒ 量到的是主检出那枚 inode
    `242438055`（19444 字节 = 我已修好的那份），而 95477 打开的是**它自己载体**那份
    `248625874`（17066 字节，`/tmp/heyta-reinstall/…`）⇒ 那一刻 `lsof` 返回空、进程却活着。
    **探针假绿，而且它绿的方式就是"对象不在我这一棵树里"。**
    ✅ 正确的现量（两条并用，任一命中即算未解除）：
    `pgrep -f 'package-app\.sh'` 为空；**并且**对每个候选 pid 先
    `lsof -a -p <pid> -d cwd -Fn` 解析出它**真正那棵载体的绝对路径**，再拿那个绝对路径去比 inode。
    ⚠️ 这条是 §6 那条"名字匹配 vs 对象本体"教训的**镜像面**：那边是"按名字会把别人判成自己"，
    这边是"按路径（且路径解析错树）会把自己的人判成没来"。两面的共同修法都是
    **先确定对象在哪棵树，再选探针**，而不是换一种 needle。
    同场更正 `:1346`：那句 `lsof -nP -p 95477 -i` 要写成 `lsof -a -p 95477 -i` ——
    不带 `-a` 时 `-p` 与 `-i` 是**并集**（打印全系统的网络文件），加上才是交集。
    05:5x 用 `-a` 复测：95477 与其子进程 `notarytool`（pid 98934）**各 0 条 TCP**、
    累计 CPU 0:00.04 / 0:00.03、已 **2h40m**，且它的下游管道还挂着 `tail -8` + `awk`
    ⇒ 说法要收得更紧：它不是"在慢等 Apple 返回"，是**一条网络都没建立的彻底挂住**。
    ✅ **22:5x 复量：形状没变，只是更久**（这一条的结论是"仍在"，别把时长当瞬时值抄走）——
    `93817`→`95477`→`98934` 三代都还在，`notarytool submit` 已 **3h37m**、累计 CPU **0:00.03**、
    `lsof -a -p 98934 -i -sTCP:ESTABLISHED` **0 条**，管道里 `tail -8` + `awk`（98935/98936）仍挂着；
    它的载体 `/tmp/heyta-reinstall` 停在 **`d0a81927`**，启动器 `/tmp/queue-reinstall-all.sh`（pid 81007，ppid=1）。
    ⇒ **① 的解除条件仍未满足**，且这一趟不会自己结束：看门狗 `HEYTA_NOTARY_TIMEOUT` 在 main 的
    `package-app.sh:283`，而那枚载体的同名文件里 grep 这个变量 **0 处**（它早于修复）——
    上限只对下一趟生效这件事，04:02 就写过，这次是拿到"它连自己的载体都没带上修复"的字节级对照。
    ✅ **08:2x 第三次复量：形状仍未变，且把"看门狗杀不到孙进程"这条怀疑否证掉** ——
    `93817`→`95477`→`98934` 三代都在，`notarytool submit` 已 **5h09m**，
    `93817` 的累计 CPU 在 20 秒内 **0:00.01 → 0:00.01**（零推进），`lsof -a -p 93817 -i -sTCP:ESTABLISHED` **0 条**。
    两处字节级对照：正在执行的快照 `/tmp/heyta-reinstall/scripts/.reinstall-all.sh.snap.93817` 里
    `run_bounded` **0 处**，载体的 `apps/desktop-macos/scripts/package-app.sh` 里也 **0 处**（而 main 那份 `:291` 有定义）。
    ⚠️ 我一度怀疑 main 那把看门狗是**装饰**（"只杀 `xcrun` 那一层，`notarytool` 孙进程会成孤儿"），
    现量否证：`ps -o ppid -p 98934` = **95477**，即 `notarytool` 是脚本的**直接子进程**（`xcrun` 是 exec 不是 fork），
    所以 `kill -TERM/-KILL` 那个 pid 就够 —— 这条怀疑不成立，别照它去"修"看门狗。
    ⇒ **① 的处置不变**：由那一趟的持有者重启即可（重启后的那趟带看门狗，默认 900s 上限、到点 return 124 并往下走），
    本线**不代杀** `93817/95477/98934`（AGENTS §8.9：那是别人起的、且它占着 mac 段的产物目录）。
  - ⚠️ **05:3x 两条与 ① 直接相关的现场**（都要带时刻读，它们会反过来）：
    ① **iOS 侧此刻是空的**：三台 booted 逐台 `simctl spawn <udid> launchctl list` 读
    `UIKitApplication:com.heyta`，命中数 **0 / 0 / 0**（01:4x 那次 `heyta-ios-isolated` 还在跑）
    ⇒ 窗口开时 ios 段不必整体判死，启动器那条"逐台读设备自己的 launchctl、只挑没跑着 com.heyta 的那台"
    此刻三台都合格。
    ② 🔴 **链在载体里跑的闸门 ≠ 主检出正在写的那版闸门**：`scripts/verify-mobile-window-gate.sh`
    在主检出是 **`M`（+74 / -5 未提交）**，而我的链 `cd` 进载体 ⇒ 读到的是**已提交那版**。
    那位正在补的"iOS 目标取不到就停 / 别人在用这台设备就 FAIL"这类**更严的分支，我这侧一个都没生效**
    （正是记忆里那条"载体 checkout 只同步提交、不同步主检出工作树里的判据"）。
    ⇒ ① 成交后的读数必须写明"闸门 = 提交态版本"，别把它当成最新判据的绿灯；
    那道更严的门归它的所有者落，我不代改（撞车判据 = 该文件有别人的未提交 diff）。
- ② Playwright 三段 + 全量 `pnpm check`：**02:35–02:41 已在载体 `f08b26e7` 上跑过一趟**（窗口 02:35:26 开：
  闸门 `--target b` 退 0，负载现量 12 = 阈值 12）。两个读数**分开报**（这是 §5-2 定的取法）：
  - **整条 `pnpm check`：`CHECK_EXIT=1`**，断在第 8 段 `check:op-log-semantics`，而拒绝它的是**本机内存闸门**
    （`/tmp/tfa-test.lock` 持有者 pid 34659，它在跑另一条会话的 `verify:handoff:prod -- --mobile-only`）
    ⇒ 这条 1 **不是产品红**，也不能读成"链断在产品的第 8 段"。
  - **逐段表（"可过段数"唯一诚实的取法）**：段数现取 **74**（不是 62，也不是本槽建槽时写的 63 ——
    这一小时里 main 并进了三条长期分支），**`rc=0` 64 段 / `rc=1` 9 段 / `rc=134` 1 段**。
    表在 `/tmp/check-seg-by-seg.log`，逐段原文在 `/tmp/seg-<N>.log`。十条非绿**逐条读过原文**再归因：
    `check:ui-provider`（宿主没有真的挂 Provider）、`check:theme`（直接引用 L0 原始 token 表
    `lightTokens['color.primary']`）、`check:selection-single-source`（两个可选 prop 没传 ⇒
    typecheck 绿而界面不跟随选中）、`check:ui-language`（诊断字段里写了一整句中文
    `sessionStorage 不可访问（隐私模式？）`）、`check:legal-permissions`（条款仍写"移动 App 不申请通知权限"，
    而 `POST_NOTIFICATIONS` 与 `NSUserNotificationsUsageDescription` 都已声明 ⇒ 这句对外是假话，六个位置要一起翻）、
    `check:image-license`（镜像快照里 `server/package.json` 的 sha 与当下不一致）、
    `check:crosslang-contract` **rc=134**（C# 探针自己抛 `契约重放失败 2 条`）、`check:shell-unicode`
    （`$var` 紧跟全角字符）、`pnpm -r test` 两枚失败文件（`apps/web due-date-edit.spec.tsx`
    的「点月历日子格 ⇒ +1 条 UPD、payload 只有 dueDate」与 `server holiday-adjustment-migration.pglite.spec.ts`）
    ⇒ **这九条都不在本条线的落点上**（倒数日线 / W4b 调休线 / 法务线 / 部署线 / 跨语言契约线各管各的），
    本条线**不吸收别人的债凑绿**，只登记。
  - 🔴 第十是**我自己的**：`check:ai-e2e` 的红来自那份还没提交的 `list-folder.spec.ts` ——
    一个**反引号写成了单引号**（`getByTestId(\`…-menu')`），babel 报 `Unexpected token (112:43)`，
    真实位置在 103 行。⚠️ 教训不是"typo"，是**肉眼看引号形态不构成证据**：同一段代码用
    `JSON.stringify` 打出来两处都像反引号，是 `split(String.fromCharCode(96))` 数出来的奇数行与码点表才定位到。
    已修，并用 `ts.transpileModule` 复验到 **诊断数 0**（此前 24 条级联错全在那一处之后）。
  - ⚠️ 三段 e2e 在**第 3 步（先跑）**与**第 5 步（逐段）**读数不同，且差得有道理：先跑时三条全 `rc=1`，
    那时载体刚 checkout 到新 HEAD、`packages/*/dist` 还没构建，vite 直接报
    `Failed to resolve entry for package "@heyta/ui"` ⇒ 那是**载体没构建**，不是界面坏。
    补构建后逐段：`privacy-consent-e2e rc=0`、`landing-e2e rc=0`、`ai-e2e rc=1`（只剩我那一条 spec 的语法错）。
    ⇒ 启动器补了两道门：**2a** dist 门（缺则先 `pnpm -r build`，补不上 exit 3）与
    **1b** 内存锁门（别人的测试持锁就整段不起跑，并打印持有者 pid 与它的命令行）。
    这两道门各自做过**阳性对照**：2a 的谓词先被夹具抓出两次"永远不触发"（`require` 相对路径当模块名、
    判据测的是脚本文本而不是**键是否存在**），1b 用当前真实持锁的 pid 跑出 `exit 3`。
  - ✅ **第二趟（03:42–03:56，载体 `391e4c27`）：`check:ai-e2e` 拿到了"没有本条线债"的读数** ——
    `142 passed / 13 failed / 2 skipped`（13.5 分钟，`rc=1`）、`privacy-consent-e2e rc=0`（7 passed）。
    上一趟那条**属于我自己的**红（spec 语法错）已经不在，而本条线新加的 `tests/list-folder.spec.ts`
    **在这趟全套件里是过的**（它被套件收走跑，不是只在我单独点它时过 —— 这是"进 `e2e/tests/`"的真实代价与真实收益）。
    13 条失败**逐条读过错误行**再分组，三组：
    ① **8 条同一根因**：`GET /api/holiday-adjustments` 落进**四份各自维护**的"不该有未登记请求"白名单
    （`admin-console.spec.ts:559` ×4、`inbox.spec.ts:228`/`:307`、`profile-avatar-e2ee.spec.ts:321`、
    `vault-settings.spec.ts:218`）。服务端路由**在 HEAD 里**（`server/src/holidays/holiday-adjustment.routes.ts`）
    ⇒ 不是产品坏，是**应用启动期新增了一次公共事实拉取，而 e2e 那个假服务端只实现 `/v1/chat/completions`**。
    这与 `e2e/tests/helpers.ts:244` 注释里记的 2026-10-02 legal-consent"一次红六条"是**同一件事的第二次**，
    只是这次打穿的是四份白名单而不是一份 —— 归 W4b/公共事实那条线，本条线不代改
    （`helpers.ts` 在主检出里正 `M`，改它就是造三方冲突）。
    📌 可迁移：**"启动期多发一个请求"是一次全局变更**，它的爆炸半径等于"有几份白名单各自记着它"，
    而不是等于 1。
    ② **3 条超时**（`ai-assistant.spec.ts:65`、`calendar-cells.spec.ts:257`、`task-row-touch-target.spec.ts:119`）
    错误行都卡在 `locator.click` 于 `<button aria-label="切换到暗色主题">` 上 60s。
    ⚠️ **只写观察，不写结论**：同趟 `calendar-cells.spec.ts:76` 独立报「页头横向溢出：
    scrollWidth 925 > clientWidth 624」，两者相容（溢出 ⇒ 那颗按钮被挤出可点区），
    但**起跑时 1min 负载 21**，超时类读数要先做一次低负载复跑才有资格归因。定点动作：
    负载 ≤12 时单跑这三个文件。
    ③ **1 条行为红**：`calendar-day.spec.ts:186`「往左拖之后标题不是下一天（实测「10月4日 星期日」）」
    —— 今天 10-04、期望 10-05，拖拽没换日。与 traps **#172**（宿主挂 `pointermove` 的轻拖/重拖分叉）同族，归日历线。
    🔴 三组**都不由本条线吸收凑绿**：② 这一格要的是"可过段数 + 载体 sha + 逐条归因"，不是"我把它修到绿"。
  - ✅ **第二趟的全量逐段也跑完了（03:42–04:15，载体 `391e4c27`）**：段数现取 **74**，
    **`rc=0` 64 段 / 非绿 10 段**，表在 `/tmp/check-seg-by-seg.log`。非绿的 10 段是
    `12 ui-provider`、`13 theme`、`15 selection-single-source`、`22 ui-language`、`26 legal-permissions`、
    `31 image-license`、`32 crosslang-contract`(rc=134)、`63 ai-e2e`、`66 shell-unicode`、`74 pnpm -r test`
    —— **与上一趟载体 `f08b26e7` 的十条逐字同一组**（一条没多、一条没少）。
    两趟换了载体、换了 main（一小时里 main 又前进几十笔）、换了我新加的那条 spec，**红的集合却完全不动**
    ⇒ 这十条是**提交态的债**而不是"这棵树脏"的产物，逐条归属见上面那份表。
    🔴 **本条线新加的那条 spec 没有给这十条添任何一条**：`63` 就是 `check:ai-e2e`，
    它的 13 条失败在上面已逐条分组（8 条公共事实白名单 / 3 条超时待低负载复跑 / 1 条页头横向溢出 /
    1 条日历拖拽没换日 = 13，逐条对得上），
    `list-folder.spec.ts` 自己在套件里是过的。
    三段 e2e 的整段读数：`SEG ai-e2e rc=1（142 passed / 13 failed / 2 skipped）`、
    `SEG privacy-consent-e2e rc=0（7 passed）`、`SEG landing-e2e rc=0（18 passed）`。
    ⚠️ 全量 `pnpm check` 本身在第 12 段就断（`&&` 串），所以"整条链 exit 0"这一条**只能由逐段表回答**，
    而逐段表没有短路 —— 两种读数的语义差别启动器自己印在输出里，不许拿后者冒充前者。
  - **这张表的保质期属于载体 `f08b26e7`**：main 在这一小时动了 276 笔，下一趟大概率是另一串数。
    复跑命令：`bash /tmp/heyta-run-checks.sh --go`（体检先跑不带 `--go`）。
  - ⚠️ **22:5x 现量：段数已经不再是 74，而是 75**（`node -e` 把 `package.json` 的 `scripts.check` 按 `&&`
    切开数出来的，不是抄上面任何一个数）——多出来那一段是别人这一小时加进链里的。
    ⇒ **② 不重跑**（Goal 明写"别重做已完成项"，而那三段的 rc 与逐段表都已落在 `f08b26e7` 名下），
    但引用 ② 时必须带"74 段属于 `f08b26e7` 那一趟"，**不能拿它当今天的段数**。
    现量命令（谁都可以重跑，只读 `package.json`）：
    `node -e 'const c=require("./package.json").scripts.check;console.log(c.split("&&").length)'`。
- ③ 便签移动端验收：`NOTES_EXIT=` **待填**（第 6/7 步的 op 判据、第 8 步第三张截图、第 9–11 步跨设备三条腿各写一条读数）—— 现量命令 `bash /tmp/heyta-run-notes.sh`。
  - 🔴 **06:18–06:24 第一趟真读数（载体 `030f0969`、`PORT=3100`、`emulator-5554`、零 mock）：
    通过 27 项 / 失败 5 项 / `NOTES_EXIT=1`**（日志 `/tmp/notes-run1.log`，截图副本 `/tmp/heyta-notes-ev-run1/`）。
    这是 ③ **第一次有读数**（此前 23 轮全被那枚自拒绝的粗筛挡在门外，见上面 ① 那条根因）。逐条分开报：
    - **第 6 步 ✅✅**：`恰好 1 条 NOTE/UPD —— 一次意图一条 op`；`UPD 载荷的键集合 = [content]，值 = 界面上那次改动`。
    - **第 7 步 ✅✅（`022edfcf` 那三道数字门第一次拿到真数据）**：
      `没改动 → 一条 op 都没写（NOTE/UPD 仍为 **1**）` + `点「取消」同样一条 op 都没写`。
      ⚠️ 括号里那个 **1** 就是修复的意义：旧版这里打印的是"仍为 "（空），
      也就是"手机库拉不到"与"确实一条没多写"在输出上逐字相同（六腿夹具 06:00 已复现旧版 BAD 0 / OK 2）。
    - **第 10 步 ✅**：服务端 `NOTE/UPD op 数 = 2` —— 那次编辑真的出去了（服务端只存密文，只数条数）。
    - **第 11 步 ✅×4**：笔记本 sync 成功 / 解密后收到一条 remote `NOTE/UPD` /
      `entityId=note-musyhmo7-2-ewqhmo30` 两端一致（不是"恰好同正文"）/ 正文 = 界面上那次改动
      ⇒ **goal ③ 要的"手机改 → 另一台设备读到"这条腿已经拿到**。
    - **第 12 步 ✅×2 + ❌×1**：两张截图本轮新生（`1-editor-open` 50 587 B、`2-list-after-edit` 183 342 B），
      **两张都人眼看过**：第一张是「编辑便签」页、正文 `note-e2e-061841-read-once`、主蓝「保存」；
      第二张是「我的」页便签段、摘要已是 `note-e2e-061841-edited`、底部五标签停在「我的」
      （⚠️ 按实际所见写，不照脚本里那句"列表摘要"的措辞抄——它落的是「我的」页那个区块）。
      第三张 `android-notes-3-from-search.png` 缺失 = 第 8 步没走到编辑屏的**下游**，不是独立失败。
    - 🔴 **第 8 步 ❌ 与第 9 步 ❌×3 是同一次探针失效的连带，不是四条独立读数**：
      那四行红之前，脚本自己连打 6 次
      `⚠️ uiautomator 连续 10 次抓不到界面 … /tmp/ui.xml 已被截成空文件 —— 接下来任何断言都会报「找不到 X」，那是假红`
      （它当时的负载读数 9.36–10.68，**都在阈值 12 内** ⇒ "宿主机过载"那个候选解释被自己的数字削弱）。
      ⇒ 归因**未定**，两个候选都还活着：① 搜索浮层让窗口永不空闲 ⇒ `uiautomator dump` 前提不成立（系统性）；
      ② 设备侧瞬时。第二趟就是为判这个开的，但被下面的现场打断，没判成。
    - 🔴 **另有一条与探针无关的判据缺陷（本线自己的，写下来不掩盖）**：第 9 步断
      `手机本地库里有 ≥1 条远端 op`，而**笔记本是在第 11 步才同步的** —— 第 9 步那一刻账号里
      没有任何别的设备写入的 op，手机**正确地**拉到 0 条。
      ⇒ 这条不是"下载坏了"，是**断错了不变量**：它要成立，必须在第 9 步之前先让第二个宿主写一条并同步
      （做法就是第 11 步那套 `node-host` 写入 + sync，挪到前面当 setup）。
      本轮**没有**为了让它变绿去放宽那条判据，也**没有**改脚本 ——
      ⚠️ 因为 `scripts/verify-mobile-notes.sh` 此刻有**别人 1 行未提交**（第 12 步那行 `$f（`→`${f}（`），
      撞车判据成立 ⇒ 补丁形状写在 `/tmp/heyta-notes-step9-setup.patch.txt`（未应用），等那行落定再动这个文件。
  - ⚠️ **第二趟 06:24:36 起跑，停在第 0 步，06:27 被现场打断**：`adb devices` **空**、
    机器上**没有任何 qemu/emulator 进程**（安卓模拟器被关掉），同时 1 分钟负载从 11 冲到 **88.25**
    （另有 `node` pid 29644 已占 98.8% CPU 跑了 7h40m）。我这趟 1500s 超时会白等 ⇒ 主动 `TaskStop`（是我自己的任务）。
    🔴 **没有擅自替别人重启模拟器**：那台设备不是我这棵载体的私有资源，
    而且同一时刻 `iPhone Duo heyta` 也不在 booted 列表里 ⇒ 这更像一次**别人主导的设备清理/换型**，
    我先让路。观察换成链 v7（`/tmp/heyta-window-chain7.sh`，日志 `/tmp/heyta-chain7.log`）：
    设备回来 + 负载 ≤12 + **用带豁免的那版探针**核过"没有真 runner" ⇒ 自动补跑 ③，成交后再接 ①。
    链 v7 明确**不再用 `verify-mobile-window-gate.sh` 当门**（就是上面那条自拒绝根因）。
  - 🔴 **22:5x 现量：③ 的服务端那一侧，此前没有任何一条判据证明"它是谁、跑的是哪一版"**
    （这条直接决定上面第 10 步"服务端 `NOTE/UPD` op 数 = 2"的保质期）：
    `scripts/mobile-e2e-up.sh:82` 那个复用分支只看 `curl /health` 有没有响应。③ 第一趟复用到的那台是
    **pid 26407**（cwd `/…/heyta/server` = **主检出而不是载体**，06:02:44 起，`/tmp/heyta-e2e-server.pid` 至今仍指它），
    它跑的 `server/dist/src/index.js` mtime **02:59:16**，而同一棵树里有 **3 个 `.ts` 比它自己新**
    （`legal.generated.ts` 04:29、`admin/admin.routes.ts` 03:38、`sync/services/snapshot-generation.service.ts` 04:40）
    ⇒ 那一趟服务端侧数出来的条数证明的是**那台机器 02:59 那版代码**的行为。数条数这类判据受不受影响，
    本线判不了（要逐条读那三个文件的语义），所以**读数保留、归属降级**：第 10 步那条要读成
    "在那台服务端上成立"，重跑时由下面那道认证门负责把它钉回当前源码。
    ✅ **当场修掉（`14f8bbcd`）**：新增 `certify_server_occupant()`，复用前认证四件事 ——
    监听 pid 唯一 / 它的 cwd 是某棵检出的 `server/` / 那棵检出的 dist 不比自己的源码旧 /
    它的 ROOT HEAD == 本 ROOT HEAD。任一不成立就响亮失败并**写出是哪一件**；
    确要跨 ROOT 连一台已经起好的栈要显式 `HEYTA_E2E_ALLOW_FOREIGN_SERVER=1`，
    放行时大字印出"本轮服务端侧判据只能证明那台机器现在的行为"——这个口子是给人看的，不是用来让红变绿的。
    三臂验过它**能失败**：真函数 **8/8**（一条绿臂 + 六个失败出口各带正确原因）；
    把守卫改成恒成立的变异体 ⇒ 绿臂转红；把守卫摘掉的变异体 ⇒ 恰好抓"dist 比源码旧"与"双因"两臂。
    **在实现场**：`PORT=3100 bash scripts/mobile-e2e-up.sh` 退 **1**，原因逐字是
    「pid 26407（ROOT …/heyta）：它的 dist 比自己的源码旧（3 个 .ts 更新）」——
    也就是这一跑真的抓到了上面那个现场，不是只在夹具里成立。
    🔴 **同时否证 §4 那条"打 `/account/legal-consent` 得 404 ⇒ 那是旧构建"**（它曾被当成
    "③ 必须自己起 `:3100`"的**证据**）：真实路由挂在 `/api` 前缀下（`server/src/api.ts:632` 的
    `fastify.get('/account/legal-consent', { preHandler: authenticate …`），所以
    **不带 `/api` 时 `:3000` 与 `:3100` 都是 404、带 `/api` 时两台都是 401**（22:5x 现量四条）
    ⇒ 那条探针对两台机器**没有分辨力**，它区分的是"路径写法"而不是"构建新旧"。
    判"旧服务端"要用**进程启动时刻 vs dist mtime vs 源码 mtime**，即上面那套，也即新门里那三件事。
    ⚠️ 这条修法与那条否证都先是**被自己的夹具挡住**的：桩没放进 `PATH`、以及 `FAKE_*` 忘了 `export`
    （桩是子进程，只认导出的变量），两次症状都是"七个臂全在第一关失败"，看起来完全像产品坏了
    ⇒ 待入 traps（"探针坏与产品坏长得一样"同族，且这是**夹具的两处自检盲区**而不是判据的）。
  - 🔴 **23:1x 现量：把"③ 要拿到当前源码的服务端"这件事的三条路和各自代价写清**
    （留给下一位的应该是代价表，不是一句"再等等"）：

    | 路 | 要动什么 | 现量代价 | 为什么不由本线拍 |
    |---|---|---|---|
    | 等 `:3100` 那枚占用者自己让开 | 什么都不动 | 它不会自己走：`/tmp/heyta-e2e-server.pid` 指 pid **26407**，06:02:44 起，跑的是 02:59 的 dist | 起它的调用是本线写的（`/tmp/heyta-run-notes.sh:80`），但同一分钟正是 closeout 线做"③ 起前前置体检"的时段 ⇒ **归属不能只凭脚本名判**，按 §8.9 先协调 |
    | 重建主检出 dist 并重启那台 | `pnpm --filter @heyta/server build` + `mobile-e2e-down/up` | 重启会**覆写共享凭据** `/tmp/heyta_mobile_{token,email,e2ee}.txt`（现量 mtime **06:02:46**，正是那次建号写的），且主检出 `server/` 下有 **2 枚别人未提交源码** ⇒ 新 dist 会烘进别人的在飞改动 | 覆写别人在用的凭据 = 改共享状态；§8.9 要求先协调所有者与运行窗口 |
    | 在载体里起完全私有的一支 | 载体 `server/.env` + 私有库名 + 私有凭据路径贯穿 ③ 与 node-host 两条腿 | **实测贵**：`server/src/auth.ts:31` 要求 `JWT_SECRET` 必填且 ≥32 字符 ⇒ 载体没有 `.env` 根本起不来；`mobile-e2e-up.sh:41` 的库默认 `heyta_mobile_smoke`，私有库要先建且已迁移 | 可做，但那是**新搭一套验收拓扑**，不在本轮 Goal 点名的四段里 |

    ⇒ 本轮的选择：链 v8 把端口做成**显式旋钮**（默认仍是 Goal 写的 `3100`），继续等真正窗口；
    **不改共享状态，也不用我自己刚建的那道逃生门去换一条读数** ——
    `HEYTA_E2E_ALLOW_FOREIGN_SERVER=1` 能让 ③ 立刻跑完，但那条读数的归属就永远要说清"服务端是那台 02:59 的机器"，
    把它当成 ③ 的完成证据是拿逃生门当绿灯。
  - ✅ **23:1x ⑤ 复核**：`B41/B42/B45` 三行仍在册（`BLOCKED.md:2885`/`:2918`/`:2955`，§7.28 表在 `:1220`/`:1221` 状态 🟡），
    本轮**没有翻任何冻结判据、没有动服务端面**。本轮唯一的代码改动是 `scripts/mobile-e2e-up.sh`
    的认证门（`14f8bbcd` + `f495e040` + `598264ab`），它是**验收工具的判据**，不改变任何产品行为。
  - ⚠️ **待入 traps**（`docs/reference/environment-traps.md` 此刻被别人 **+133/0 未提交**占着，
    编号按工作树取 ⇒ 现在追加必撞，登记在这里而不是硬写进去）：
    ① 「`/health` 有响应 ≠ 那是我们的服务端」—— 复用分支缺归属判据，会把旧构建读成当前产物；
    ② 「只比产物不比进程」漏一整档 —— 进程可以早于它自己的 dist（本机 `:3000` 就是 01:26 的进程 / 02:59 的 dist）；
    ③ 夹具的两处自检盲区：**桩没进 `PATH`**、**桩变量没 `export`**（两者症状都是"每臂在第一关失败"，
       看起来完全像产品坏了）⇒ 与"探针坏与产品坏长得一样"同族，但这次坏在**验判据的夹具**上。
  - 🔴 **23:2x 两条"窗口开没开"的更正**，都出在我自己那条链的门上，不是产品问题：
    ① **「设备在线」≠「设备空闲」**。23:1x 现场：`emulator-5554` 在线、负载 **11.24 ≤ 12**、
       4318/4319/4322 全空、内存闸门空闲 —— 四条都过，而 `com.heyta`（pid **4839**）正前台跑着、
       `mCurrentFocus` 指向它，而 ③ 的第 0 步要 `pm clear` 那台库。
       链现在把只读探针 `android_heyta_busy` 接成门（它把"读不到"判成**忙**，
       不把 adb 挂了当成 App 没跑 —— 那正是 §7 元规则 1 的形状）。
    ② **判"别人那棵重装够不够得着设备"不能靠日志**。第一版取
       `ls -t /tmp/heyta-reinstall*.log | head -1` 再找段标记 —— 实际挑到的是 `-build.log`
       （谁最近重打包谁最新，与"那棵重装跑到哪一段"毫无关系），里面没有段标记
       ⇒ 永远走"读不到 ⇒ 保守拦"：**我为了"别把 ③ 钉死"加的这道细化从来没生效过**，
       而它打印出来的理由听起来完全合理。改成按**进程树 argv** 分三档
       （树里有 adb ⇒ 算设备冲突；只有 `notarytool`/`codesign`/`.dmg` 类 ⇒ 够不着设备，不钉 ③；
       两档都读不到 ⇒ 保守算冲突）。`adb` 是按**每个词的 basename** 认的 ——
       真实现场那种 `/opt/…/platform-tools/adb install` 是路径形式，只匹配 `" adb "` 会漏，
       而漏的时候症状最危险：明明在装 APK 的重装被判成"够不着"⇒ 撞别人的验收。
       五臂夹具 `FIXTURE_PASS=1`：真现场那棵判"够不着"、路径形式的假 adb 判"冲突"、
       假 notarytool 判"够不着"、纯 `sleep` 树与空 pids 都**保守判冲突**。
       ⚠️ 这个夹具自己先**假过**一轮：假进程写成 `PA=$(spawn_tree …)`，命令替换的 subshell 一退出，
       它 background 的作业就没了 ⇒ B/C 两臂拿到的 `seen` 列表是空的，"红得恰好"其实什么都没测到。
       现在每臂先断言前置（`adb_alive=1`、`kids` 非空）再取判决，**前置不成立的臂不作数** ——
       这条比结论本身重要。
  - ⚠️ **04:00 读脚本本体后更正本槽的形状**：那些断言与截图**早就在 `scripts/verify-mobile-notes.sh` 里**
    （step 6 在 `:331`、step 7 在 `:363`、step 8 在 `:388` 且 `:426` 就写 `android-notes-3-from-search.png`、
    step 9/10/11 在 `:435`/`:456`/`:477`、step 12 在 `:515` 逐张落库）。
    ⇒ **③ 缺的不是代码，是一趟跑完的读数**，本槽不需要"先改脚本"这一步（建槽时按"要补判据"写，
    会把下一位引去改一个不该改的脚本 —— 这是"槽里的措辞也是断言"的又一次现形）。
    ⚠️ 但**这句只对"判据是否存在"成立，不对"判据有没有牙"成立**：05:2x–05:4x 静态审同一份脚本，
    连着照出两处**永远通过**的形状（见下面两条 ✅ 修）。"断言都在"和"断言能失败"是两件事。
    ⚠️ **05:2x 这条更正要再修一次：断言都在，但落库判据本身是软的**。第 12 步原来只判 `[ -s 文件 ]`，
    而第 8 步那张写在很深的成功分支里 —— 那一支没走到时**上一趟留下的同名旧图照样非空**，
    输出会印"证据在库"。这不是"要不要改脚本"的问题，是那句更正把"断言存在"读成了"判据有牙"。
    ✅ 已改判"非空**且** mtime ≥ 本轮起跑"并落 `99ea54c1`（起跑戳取在 pm clear/install 之前）；
    三腿夹具跑的是落盘后那份真代码：三张都新生→`FAIL=0 OK=3`；第三张改成旧但非空→恰好 1 红
    （同一条老判据在这里报"在库"）；再拿掉一张→2 红（缺失与陈旧分别抓到）。`check:script-snapshot` 仍绿。
  - 🔴 **04:00 现量"此刻为什么跑不了"**（写下来免得下一位以为链坏了）：另一条会话正在跑设备验收 ——
    `pid 53013 / 64014  bash heyta/scripts/.verify-mobile-ios-reminder.sh.snap.53013`（从**主检出**跑），
    设备侧 `com.heyta` 的 pid 20246 已活 `1:03`、`mCurrentFocus` 指向它。
    ① 的 android 段要 `adb uninstall`、③ 第 0 步要 `pm clear` ⇒ 这两道门**都必须继续退 3**，
    不去动别人的进程。摘出条件：那两条 `.snap.` 进程消失 **且** 设备上没有别人在用的 `com.heyta`。
  - 🔴 **05:1x 现量：③ 还缺一条我方能自己补的前置** —— 载体里**没有 release APK**
    （`apps/mobile/android/app/build/outputs/apk/release/app-release.apk` 不存在；主检出那枚是 02:46 的，
    不在被测树上 ⇒ 不能拿来装）。v5 因此每轮都拿"缺产物"去撞窗口门，把**要做的活**当成**要等的条件**。
    ✅ 链 v6 加了一段 **PREP**：先把载体推到 main 当前 HEAD（否则验的是上次那棵，§7 第 27 条那一族），
    再 `pnpm --filter @heyta/ui build` + `pnpm build:android`，且只在
    **负载 ≤ 12 且没有进程的 cwd 落在这棵载体里**时才动它。
    📌 那条并发判据本身也是现学现用：原先写 `pgrep -f 'package-app\.sh|reinstall-all\.sh'`，
    于是别人的 `/tmp/heyta-reinstall` 会被算成"我这棵被占"，前置永远补不掉 —— 逐个 pid 取 cwd 才对。
    ⚠️ 夹具顺手抓到一处 `find` 优先级坑：`-name a -o -name b -newer F` 里 `-newer` **只作用于最后一档**，
    "跳过重建"那条腿永远不会成立（同一棵树无括号 755 枚 / 带括号 56 枚）。已加括号。
  - ✅ **05:36:40 PREP 成交（`rc=0`）—— ③ 那条"缺产物"的前置已经补掉了**，读数带产物指纹：
    载体 `app-release.apk` = **66 941 540 字节**、md5 `b59ff082fcb892b6677c3de51d902b37`、
    mtime `10-04 05:36:40`；
    构建 `BUILD SUCCESSFUL in 2m 46s`（日志 `/tmp/heyta-prep-apk.log`）；
    构建那一刻载体 = 当时 main HEAD `04fa70f6`。
    ⚠️ **06:0x 更正两处**（这一条原来带着没填的 `%s` 占位符就提交了 —— 那是文档缺陷，
    下一位照抄会拿到三个空值；真值在上面，取值时刻 06:00 现量）：
    ① main 已从 `04fa70f6` 走到 **`030f0969`**，载体此刻也已是 `030f0969`（PREP 每轮先 `checkout --detach <main HEAD>`）；
    ② 🔴 **"APK 不比源码旧"这条判据的扫描面比"构建输入全集"窄**：
    `find apps/mobile packages … -newer "$APK"` 只覆盖这两棵树，
    而 `04fa70f6..030f0969` 之间实际动过两枚源码 ——
    `scripts/verify-mobile-notes.sh`（我自己的 `022edfcf`）与 `apps/web/src/styles/app/base.css`（`030f0969`）。
    两枚都**不是** Android bundle 的输入（前者是判据、后者是 web 样式），且载体里那份脚本
    与 `030f0969` 版**逐字相同**（`cmp` 实测）、七处数字守卫都在 ⇒ ③ 这次跑的**判据是当前的**、
    **APK 对移动端也是当前的**。但这句话不能简写成"APK == 当前源码"，
    下一位要把这条判据当"构建输入全集"用之前，先按真正的 bundle 输入清单补扫描面。
    ⚠️ 一条要说清的代价：**这趟 gradle 把 1 分钟负载从 13.68 顶到 104**（16 核），
    所以 05:33–05:36 这段时间里**别人也进不了窗口** —— PREP 是在自己那道 ≤12 的门前排队排出来的，
    但它跑起来之后制造的负载对全局是外部的。下一位把 PREP 类"构建"和"验收"排在一起时，
    要把这段峰值写进汇报，别只写"我这边门绿了"。
    ⇒ ③ 现在剩下的只有**窗口本身**：设备被别人的 `com.heyta`（pid 20246）占着、
    还有别人一条移动端验收在跑、负载要落回 ≤12。链 v6 每轮重查这三条。
    ⚠️ **06:0x 现量把上面这句的三个原因换成了实测的三个状态**（那句是 05:4x 写的，
    两个已经变了、第三个从来没进过 target c 的判据）：
    ① **"别人一条移动端验收在跑"是瞬时的**：闸门 05:53 报 pid 4949，05:54 `ps -p 4949` 已空。
    为判它是不是**周期性**的（周期性就永远挤不进去），跑了一枚只读采样器
    （`/tmp/heyta-runner-sample.sh`，48 次 × 5s source 同一个 `lib/mobile-e2e-runner-probe.sh`）
    ⇒ ~~48 次 / 命中 0 ⇒ 一次性~~
    🔴 **06:05 被现量否证，那句撤回**：闸门又报出一枚**新的** runner（pid 33905），
    06:06:41 `ps -p 33905` 又已空。两枚（4949 / 33905）都在约 1–2 分钟内消失，间隔约 12 分钟。
    ⇒ 正确的读法是**"短命且反复出现"**：4 分钟采样 0 命中只证明它的**占空比低**，
    不证明"不会再来"——我原来那句把"没采到"写成了"没有"，正是 AGENTS §7 元规则 1
    （"没观测到 X" ≠ "X 没发生"）在我自己探针上的复发。
    对本线的实际影响是可接受的而不是好消息：闸门这道是**粗筛**，权威判据在验收脚本第 0步
    `another_mobile_e2e_running`（就在 `pm clear` 之前那一刻再问一次）
    ⇒ 撞上了就是本轮 exit 3、白等一轮，不会清掉对方的现场；链每 ~90s 重查，
    低占空比意味着它**能**在两次之间成交。采样器已换成"命中就把整行 argv 落盘"的长窗版
    （`/tmp/heyta-runner-sample2.sh`），要报给那条线的是**哪个脚本、每次活多久**，不是"有没有"。
    ② **":3100 没有服务端"是我这一侧能补的**，已补：`PORT=3100 bash scripts/mobile-e2e-up.sh`
    于 06:02:44 成交（服务端 pid **26407**、`/health` 返回 `db:connected`、全新账号
    `mobile-e2e-1791064966@example.com`、`heyta_e2e_assert_client_budget` 报 **0 < 20**）。
    ⚠️ 一条必须随读数带走的边界：这台服务端跑的是 `server/dist`（构建于 **02:59**），
    而 `server/src` 里有 **3 枚文件比它新**（含 `M` 未提交的 `legal.generated.ts`、
    `snapshot-generation.service.ts`）⇒ 它既不是提交态也不是当前工作树。
    ③ 的判据是"手机写 op → 服务端收下 → 笔记本读到"，服务端只看密文，所以这不影响结论本身，
    但**不许把它写成"服务端 = 当前源码"**（AGENTS §7 第 27 条那一族）。
    ③ **负载此刻 10.2–10.7 ≤ 12** ✅；而 `com.heyta` 20246 在 `emulator-5554` 上前台
    （`etime 02:57:51`、累计 CPU 00:02:52、**没有任何 adb 客户端**、采样窗口内没有 runner）
    ⇒ 按**提交态**闸门（链用的那版）target c 的设备判据是"设备在线 + 没有别的运行者"，
    这条此刻成立；真正把设备判死的是 target b（重装要 `adb uninstall`），那一侧我继续不动别人的安装包。
    🔴🔴 **06:1x 现量：那条"有移动端验收在跑（pid：每次不同）"从头到尾是闸门在自拒绝**
    （③ 从 05:53 起连退 23 轮，每一轮的"别人"都是闸门自己的进程）：
    取证方式 = 让闸门命中后把它**自己那趟的 ps 快照**留下（`/tmp/heyta-gate-ps-hit.txt`），
    快照里含 `verify-mobile` 的一共 5 行，逐行都是这棵树：
    `65048 timeout 200 bash …window-gate.sh` → `65049 bash …window-gate.sh`（= 闸门本体 `$$`）
    → `65066`（它的子壳）→ **`65067`（子壳里的管道再 fork 的一代，`$2=65066 ≠ $$`）**。
    探针只排 `$$` 与它的**直接**子进程，所以第二代起就把自己当成别人 ——
    把那份快照直接喂给两份探针是对照实验：**载体（提交态）那份命中 `65049`（闸门本体）**，
    主检出工作树那份命中为空。差的就是工作树里那行 `rest !~ /verify-mobile-window-gate\.sh/`
    （`grep -c window-gate`：载体 1 = 只在注释里、工作树 4 = 已进代码），
    而 `M scripts/lib/mobile-e2e-runner-probe.sh` **尚未提交** ⇒
    🔴 **③ 被一枚"已经写好但还没落地"的豁免钉住**，这与 §7 里那条
    "载体 checkout 只同步提交、不同步主检出工作树里的判据"是同一族，只是方向反过来：
    这次工作树更对，而我的载体只能读提交态。
    ⇒ 本线的处置（06:18 起，写在现场而不是等人）：**绕开粗筛、走权威判据**——
    `scripts/verify-mobile-notes.sh` 第 0 步自带的 `another_mobile_e2e_running`
    没有这个管道代际问题，实测**放行**：负载门 11 ≤ 12 → `Success` 装包 →
    隐私同意面板与欢迎页都真点到 → `✅ 应用已启动并停在主界面` → 第 1 步起配凭据。
    ⚠️ 停链是有意的：整条链 v6 已 `TaskStop`（`bdibsi96x`），避免我的链与这趟直跑**并行抢同一台设备**
    （AGENTS §8.9）；③ 跑完再重启链专跑 ①/target b。
    ⚠️ 归别人的两件事，本线一律不代改：探针的代际豁免（工作树已写、等它落）、
    `window-gate.sh` 那版新增的"另一趟 reinstall-all 在跑"（会把 ③ 钉在那枚不朽进程上，见 audit §9）。
    🔴 **同一次 06:03 的对照跑照出一条跨线后果**（这是本轮最该交出去的一条）：
    我顺手在**主检出**里跑了同一道闸门，那边是别人**未提交的 +74 / −5** 那版，读数完全不同 ——
    新版**取消**了"服务端必须在 :3100"这条前置（改成"链自己在空闲端口起栈"），
    却**新增**了一条 `❌ 有另一趟 reinstall-all 在跑（pid 93817）`。
    而 93817 正是上面那条**永远不会结束**的死等（它的 mac 段挂在 `package-app.sh` 95477）。
    ⇒ 那版闸门一旦提交，③ 也会被一枚**不朽的进程**钉住，而不只是 ①。
    我不代改那个文件（撞车判据成立：它有别人的未提交 diff），把这条后果写进交还记录
    （`docs/research/self-host-distribution-audit.md` §9）与本文件，请它的所有者在加那条门时
    **把"持有者已经死等"与"持有者真在跑"分开**（现量：`lsof -a -p <pid> -i` 零连接 + 累计 CPU 不涨 ⇒ 死等），
    否则新门的净效果是"把一条已经挂死的跑变成永久封路"。
  - ✅ **05:4x 第二处假绿（第 7 步，`022edfcf`）**：第 7 步是这轮**唯一的行为判据**
    （挡变异 M2：拿掉 `note-actions.ts` 里 `if (next === current.content) return`），
    而它原来只比 `"$AFTER" != "$BEFORE"`。`note_op_count` 读不到库时返回**空串**
    —— 函数注释自己就写了"由调用方判'不是数字'并 `bad()`"，**第 6 步判了、第 7 步没判**。
    ⇒ 手机库一拉不到就退化成 `"" != ""`（恒假），打印两条：
    「✅ 没改动 → 一条 op 都没写（NOTE/UPD 仍为 ）」+「✅ 点「取消」同样一条 op 都没写」。
    🔴 这是**一条不能失败的判据伪装成产品结论**（AGENTS §7 元规则 2）。
    六腿夹具（把第 7 步那段真代码按行区间从**当前文件**抽出 `eval`，只桩掉 `require_screen` /
    `open_editor_for` / `close_editor_with` / `phone_db_pull` 四个设备 helper；
    🔴 它原来带着三个**空 needle** 提交进本文件 —— 06:00 重跑一遍把读数换成现量，脚本
    `/tmp/heyta-note7-legs2.sh`，输入是 `BEFORE|AFTER|CANCEL` 三档）：
    `""|""|""` → **BAD 1 / OK 0**，红话是「第 7 步起跑前就读不到手机库的 NOTE/UPD 计数（实际「空」）—— 探针没跑成，这一档不作数」，
    且 `CALLED=1`（第一档红 ⇒ 后两档根本没走，不会把"没走"记成"过了"）；
    🔴 **同一输入喂旧版（`git show 022edfcf^:…`，守卫数现量 0）= BAD 0 / OK 2**，
    两句绿话逐字是「没改动 → 一条 op 都没写（NOTE/UPD 仍为 ）」+「点「取消」同样一条 op 都没写」
    —— 那句结尾的空格就是假绿的本体，**复现的是结论不是推断**；
    `1|1|1` → OK 2 / BAD 0；`1|2|1` → BAD 1「没改动却多写了 op（1 → 2）」；
    `1||1` → BAD 1「保存后读不到计数（改前=1、改后=「空」）—— 不能把'读不到'读成'没多写'」；
    `1|1|` → BAD 1「点取消后读不到计数（基线=1、取消后=「空」）—— 同上，不作数」；
    `1|1|2` → BAD 1「点「取消」却写了 op（1 → 2）」。
    六腿每腿都打印 `CALLED=n`（第 7 步真被调用几次）—— 上一轮那个"子壳里自增不回传 ⇒ 三档全取第 1 档、
    腿 C/D 压根没测到而结果是绿的"坑就是被这一列照出来的，计数器落文件后各腿才各归各位。
    ⚠️ 夹具自己也被坑过一次：`note_op_count` 在 `$(…)` **子壳**里自增计数器不回传 ⇒ 三档全取第 1 档，
    腿 C/D 那种"只让中段读不到"的形状压根没测到而**结果是绿的**（`被调用 0 次`那一列把它照出来了）。
    计数改落文件后六腿才各归各位。**"判据要能失败"这件事，连验它的夹具也要被验一次。**
  - ✅ **05:40 预检：载体的 12 步依赖全部到位**（这一步是为了别在第 11 步才发现缺东西 ——
    那条链跑到第 0 步已经 `pm clear` 过手机了）：
    四枚 dist 齐（`app-host 3` / `ui 16` / `sync-core 6` / `node-host 24` 文件）+
    第 11 步直接要的 `apps/node-host/dist/cli.js`（35 268 B）+ 凭据三件套（227/33/20 B）+
    `app-release.apk`（66 941 540 B，05:36:40）。
  - 🔴 **同一条预检差点把我骗去白烧一次构建**：逐包比 mtime 时 `sync-core`（src 03:58:42 vs dist 03:58:11）
    和 `op-log`（src 03:58:49 vs dist 03:58:13）报"dist 早于本包源码"，而**全仓那版比较更早就假红过一次**
    （拿全仓最新源码 03:58:49 比单包 dist 03:58:16，差 33 秒毫无意义）。
    ✅ 权威口径不是 mtime 而是**内容有没有变过**：
    `git log --since="2026-10-04 03:58" --name-only -- packages` **零条提交**，
    且 `git diff --name-only <那次构建时的载体 HEAD> <现在的载体 HEAD> -- packages` 为空
    ⇒ 那两次 checkout 只是把**同样内容**的文件重写成新 mtime（同一分钟内先后 30 秒）。
    📌 一般规律：**mtime 只能证"变过"，不能证"没变"** —— 判"产物是否内容陈旧"要落到
    那段时间窗里**提交集合的交集**，mtime 差几秒的读数一律先当探针可疑。
- ④ 父子层级选择器：**这条不是"等合流"，是"等界面取证"**（02:2x 现量推翻了本槽建好时的写法）：
  `776fc23c`（写侧 + 守卫）**已是 HEAD 的祖先**、`origin/main` 也含它、本地分支 `feat/list-parent` 已被
  那条 closeout 线合掉并删除 ⇒ `heyta-land-parent-merge.sh` 里那个分支名解析不出来，**不是冲突**。
  剩下要填的是 `FOLDER_SPEC_RC=` + 那**五**张 `list-folder-{1..5}-*.png`（03:2x 数正：一条用例截五张，
  本槽原来写"四张"是我抄自己草稿时数错的）—— 每张写明人看到什么。
  ✅ **它跑过了**（03:18:06–03:18:12，载体 `62576fa3`：`Running 1 test using 1 worker` →
  `✓ 清单移入文件夹：入口常驻、跨刷新还在、非法目标不给点 (3.0s)` → `1 passed (4.5s)`，
  `FOLDER_SPEC_RC=0`，五张图当时逐张打印为"本轮新生"）。
  🔴 **但这一条不能算闭合**：那五张图在 03:19 已经不在了 —— `e2e/test-results/` 是 Playwright
  每次运行开头清空的目录，而同一棵树上别人那趟（`admin-console.spec.ts`）随后就跑过。
  ⇒ **`rc=0` + "1 passed" + 打印过"本轮新生"三条都成立，证据却没了**；
  取证腿的启动器因此补了两件事：跑完**立刻** `cp -p` 到 `test-results` 之外（`/tmp/list-folder-evidence/`），
  并且**退出码落在证据文件上**（本轮新生 != 5 ⇒ `exit 3`，交给轮转器下一轮再试）。
  所以本槽现在填的是 `FOLDER_SPEC_RC=0（03:18，载体 62576fa3）` + **五张图待第二次跑到并能被人看过**。
  ✅ **03:42 第二次跑到，五张这次逐张看过 ⇒ 本槽 ④ 闭合**（载体 `391e4c27`：`Running 1 test using 1 worker`
  → `✓ 清单移入文件夹：入口常驻、跨刷新还在、非法目标不给点 (3.1s)` → `1 passed (4.0s)`，`FOLDER_SPEC_RC=0`，
  五张全部打印"本轮新生"并当场抄进 `/tmp/list-folder-evidence/`，随后点名提交为 **`80af76f0`**
  —— `e2e/tests/list-folder.spec.ts` + `apps/web/evidence/list-folder/*.png` 五枚，所以证据不再住在 /tmp）。
  逐张看到的内容（§6.2 规定一要的是这段，不是"截了五张"）：
  1. `list-folder-1-two-lists.png` —— 侧栏「清单」区里 `新清单` / `文件夹判据-stvzt父` / `文件夹判据-stvzt子`
     三行，父与子**各自常驻**一个"移入文件夹"图标（在取色圆点与铅笔之间），不必进编辑浮层。
  2. `…-2-menu-open.png` —— 子行的菜单展开：标题「移入文件夹」，第一项「不放进文件夹（顶级）（当前位置）」带勾，
     第二项「文件夹判据-stvzt父」⇒ 候选集含兄弟清单、当前位在顶级。**这张是修过才拍到的**：03:33 那一趟它只
     拍到菜单边框的一小条（行内展开把菜单推到折线以下），修法与理由见交接 §6。
  3. `…-3-after-move.png` —— 菜单整块收起（判据 `toHaveCount(0)`）、两行仍在。⚠️ **这张不证层级外观**：
     它拍在点击之后、列表重绘之前，子行**仍带文件夹图标、仍未缩进**（顶级形态）。
  4. `…-4-current-after-reload.png` —— **刷新后**：子行已经**缩进在父行下面且不带头部文件夹图标**
     （`ProjectsPanel.tsx:301-303` 的 `renderLeading` 对 `context.isChild` 返回 `null`，所以"有没有那颗图标"
     就是"它是否已进 `styles.children` 那个 16px 容器"的形态开关）；再开子行的菜单，勾与「（当前位置）」
     已落在「文件夹判据-stvzt父」那一行、且该行 `aria-disabled=true`，「不放进文件夹（顶级）」不再带勾
     ⇒ 关系进了 op-log 而不是本地态。**这张是整条链最硬的一张。**
  5. `…-5-parent-menu.png` —— 父行的菜单里**没有**"移进自己的子清单"这一项（只有「不放进文件夹（顶级）
     （当前位置）」），阳性对照是同一张菜单里那一项确实在（否则 0 只是整块没渲染）⇒ 非法目标不给点。
  🔴 **看图时我先把第 3 张读成了产品缺口，随即被第 4 张否证，这里留撤回**：我一度写下"web 侧栏不画缩进、
  层级唯一可见处是选择器"，据此几乎要登记一条"归外壳 IA 那条线"的缺口。真相是**两件事叠在一起**：
  ① 第 3 张拍在重绘之前（时序，不是缺陷）；② 我为了"精确"去量像素，而带的 y 区间在两张图里各抓住了
  不同的元素（图标行 / 文字行 / 分隔线），量出来的"父 93 子 108"之类的数**互相矛盾却每对都像结论**。
  ⇒ 可迁移的两条：**判"界面少画了什么"要先找该形态自己的开关**（这里是那颗图标，代码里就写着分叉），
  它比像素带可靠得多；**而"登记一条缺口"的门槛不是我看了一眼，是能指出证它的那一张**。

  ⚠️ 03:18 那一趟之前它还一次都没跑过（02:2x 想 `--list` 收集一下，被本机内存闸门以"已有测试在跑"
  拒绝 —— `--list` 也被拒，所以开窗前只剩"对着 HEAD 源码逐条核断言"这一种自检）。那次静态核对
  抓出两条**会各烧一次开窗的假红**：「新建清单」那颗按钮是**开关**（建完不收起 ⇒ 第二次无脑点它会把
  表单关掉），以及 `getByText('（当前位置）')` 在 RN-web 嵌套 span 下会撞 strict-mode。
  HEAD 侧的接线现量（03:18 复量，与 02:2x 逐项相同）：`setParent` 声明 6 处、领域层枚举行 8 行、
  `FolderPicker` web/mobile 各 2 处、`common.organizer.folder.*` 词条 zh/en 各 11 条命中。

🔴 **建槽而不是"等有读数再写整节"的理由**：一段文档在这本台账上的存活期取决于**还有谁持有它的旧副本**，
不取决于它是否进了 HEAD —— 上一轮我 plumbing 进台账的段落，被并行会话的下一次整文件 `git add` 抹回去过一次。
槽位先落地 ⇒ 后续更新是在**我自己的那一节**里替换行，不再和别人抢文件末尾的追加区，也不再新增编号。
建槽时的守卫（全为现量）：本文件 `git status --porcelain` 为空、`git diff --cached` 为空，
提交只点这一个路径，且 `git show --stat` 的删除数必须为 **0**。

⚠️ **槽里那个"待填字段名"本身也是断言 —— 建槽当场就红了一次**：④ 写的是 `MERGED_REF=`，
而四条启动器里**没有一条打印过这个串**（真实打印是 `MERGE_RC=` / `main 现在=<sha>` / `AUDIT_RC=` /
`IMPORT_CHECK_RC=`）。02:2x 逐条 `grep -l` 对过：`INNER_EXIT`、`CHECK_EXIT`、`NOTES_EXIT`、`CARRIER_SHA`
四个串都在对应脚本里，**只有那一个是我编的** ⇒ 已改成真实串。"照自己写的字段名去等一个不存在的打印"
是 §7 元规则第一条（先怀疑探针）在文档侧的版本，而它只有在**填槽那一刻**才会现形 —— 建槽时看起来完全正常。

- ✅ **05:3x 对 HEAD 复核 ④（这是"核验"，不是重做）**，四件都在：
    ① **领域层守卫是七条封闭原因**（`packages/domain/src/project-hierarchy.ts`）：
    `project_not_found / parent_not_found / self / cycle / parent_not_top_level / has_children`，
    其中**环检测沿父链上走且带访问集** —— 理由是磁盘上可能已经躺着一条别的宿主写进去的环，
    没有访问集这里会**死循环**；`parent_not_top_level` 与 `has_children` **刻意不合成**一个
    `depth_exceeded`，因为界面要能说出"为什么不能移"，而那是两句不同的话。
    ② **动作层不吞**（`packages/app-host/src/project-actions.ts:280` 起）：`!verdict.ok` 直接 `throw`，
    注释写明"静默的后果是用户以为移好了、层级没变"；`undefined → null` 才穿得过 JSON 表达"清除"。
    ③ **两端共用同一个拒绝映射** `folderRejectionMessageKey`（`packages/ui/src/projects/FolderPicker.tsx:43` 起），
    且明确**不许**用 `error.message.includes('cycle')`（错误串里带原始 id 与标题，包含关系会把"原因"
    和"任何提到这个词的文案"混在一起）；认不出来落 `unknown`、**不编一句**。
    ④ **词条中英对等**：`common.organizer.folder.*` 共 **11 枚**（4 枚界面 + 7 枚拒绝句含 `unknown`），
    zh-CN 与 en 两侧键集 `diff` 为**空**。
  - ⚠️ 这一趟顺手抓到**我自己的探针错了两回**，都值得留给下一位：
    第一趟 `grep -c "'folder.button'"` 量出中英**都 0**，差点报成"词条缺失"—— 那张表的键是**扁平全路径**
    （`'common.organizer.folder.button'`），拿尾段当 needle 恒不命中；第二趟字符类写成 `[A-Za-z]+`，
    又把 `folder.reject.*` 这 7 枚整段滤掉（少算 7 枚，且两侧都少 ⇒ 差集"看起来为空"是**假对等**）。
    ⇒ **0 命中先查 needle 的格式与字符类，再谈结论；对账类判据要带"总数"这一列**，
    只报差集为空挡不住"两边同时漏掉同一批"。
  - ✅ **07:5x 第 8 步"抓不到界面"的归因落到根上了（`ae6ec473`，只改 `scripts/lib/mobile-e2e.sh`）**：
    run-1 的取证只能推到"进入搜索浮层后连排 10 次失败、跨到第 9 步"，因为
    `dump()` 里那行 `$ADB shell uiautomator dump … >/dev/null 2>&1` **把设备自己说的原因丢了**，
    失败分支就只能在「设备不空闲 / 宿主机过载」之间挑一句 —— 而那两句在这趟里一句都证不了。
    现在每次尝试的 stderr 落 `${UI_XML}.dump-err`（宿主机侧，**不往设备写**），10 次按次数去重打印，
    并**按设备实际说的话**分四支：全是 `could not get idle state` ⇒ 预期内（界面在重绘，等）；
    混进别的 ⇒ 明说"不能整轮按界面在动处置"；干脆一个字没说 ⇒ "命令没跑起来"；其余 ⇒ "等待解决不了它"。
    实测输出形状（夹具 `arm_idle` 真打出来的，不是我手写的）：
    `10 次全是「取不到空闲状态」⇒ …预期内：等它安静再跑。` + `10 ERROR: could not get idle state.`
  - ⚠️ **这条改动自己带出的两处"探针弄坏被探针"，都写进代码注释而不是只写在这里**：
    ① errfile 写不进去时必须**退回 /dev/null 并明说** —— bash 的重定向失败会中止整条命令，
      少了这道守卫，一个临时文件就能让 `adb` 根本不被调用、`$UI_XML` 恒空、每条断言报"找不到 X"；
    ② 三条设备调用与那条计数读数（`grep -vc` 在计数为 0 时**退出 1**）都带 `|| true`，
      否则 `dump` 的"软失败 + 打出归因"契约取决于调用方开没开 errexit。
    🔴 **我在这条上先写错了一次归因，现量否证后原地改了措辞**：注释原本写
    "`verify-mobile-aed.sh` 是 `set -euo pipefail` ⇒ 少了它会把一趟真实验收当场打死"，
    现量是 aed **根本不 source 这个库**（`grep -c 'lib/mobile-e2e.sh' = 0`），28 个 `verify-mobile-*.sh`
    里没有任何一个同时满足"source 本库"与"开 errexit" ⇒ 今天**没有活着的触发路径**，
    那句"会打死一趟真实验收"不成立。注释与这里都改成"把契约钉住，不是修当前的红"。
  - ✅ **夹具能失败（`/tmp/heyta-dump-fixture.sh`，只抽 `dump()` 函数本体来测）**：
    基线 **9 臂全绿**（ok / idle / silent / killed / mixed / ANR 关窗重抓 / errfile 被目录占住 ×2 /
    `set -euo pipefail` 一趟），**5 枚变异各自定点照红、范围外零打坏**：
    M1 把 stderr 丢回 `/dev/null`（= 本次修的缺陷本身）→ 4 臂红，而 `arm_silent`/`arm_ok` 仍绿
    （它们本来就没有 stderr 可读，这条正是"定点"的证据）；M2 把"全是 idle"放宽成"出现过 idle" →
    只有 `arm_mixed` 红；M3 摘掉可写性守卫 → 两臂 blocked 红；M4/M5 各摘一枚 `|| true` →
    只有 strict 臂红（表现都是"日志只剩半句"）。
    🔴 **夹具自己坏了两次才被照出来**：先是 `mut()` 生成变异体后 `run_arm` 仍读**未变异**那份函数
    （九臂全绿、五枚变异齐报"应变红却仍然绿"—— 这是"探针齐刷刷报错先怀疑探针"的第五次现形），
    再是 `XY_PY` 桩写成 bash 而真代码用 `python3` 跑它 ⇒ ANR 臂拿到空坐标、以为在测关弹窗其实在测没关。
  - ⚠️ **本条只有夹具读数，没有真机读数**：此刻（07:5x）设备仍被别人的 `com.heyta`（pid 5928）占着、
    负载 36.55，而 `uiautomator dump` 会往 `/sdcard/ui.xml` 写 ⇒ 那是对共享设备的写操作，**不在窗口里就不做**。
    下一趟 ③（链 v9）的失败分支日志会直接带上设备原话，那才是这条的真机读数。
  - ✅ **08:0x ③ 的第 9 步 setup 从"形状说明"升级成可应用的 diff**（`/tmp/heyta-step9-setup.patch`，
    43 行、`step "` 计数 14 → 15；说明书 `/tmp/heyta-notes-step9-setup.patch.txt` 同步重写）：
    `bash -n` 过、新增行里 `$var` 紧跟全角 **0 命中**（同一条尺子喂已知该红的写法命中 1，阳性对照）、
    `git apply --check` **对着当前这个脏工作树**通过（落点在第 8/9 步，与别人那行第 12 步上下文不相交）。
    🔴 **仍然不应用**：等的不是技术，是别把一个文件变成"我的 + 他的"混合态。
  - 🔴 **这次升级把我自己写在说明里的两处未取证断言撤掉了**（原文 06:31 版，划线留在 `/tmp` 那两份里）：
    ① 写过法时称"把**第 11 步那套 `node-host` 写入**挪到前面当 setup" —— 现量 HEAD `:493` 起的第 11 步
    **根本没有写入**，只有一次 `laptop sync` 加两条 `sqlite3` 读，笔记本在这条脚本里从头到尾没写过东西；
    ② 那里还手搓了 `node apps/node-host/dist/cli.js task add … --sync`，那个**动词与旗标都没取证过**。
    ⇒ 真实形状改成从两处真源取：`apps/node-host/src/cli.ts` 的 `case 'add'`（HEAD `:292`，
    `--json` 返回 `{ok,command,id,due}` ⇒ id 直接可得，不必像 `verify-mobile-conflict.sh:163` 那样
    再 `laptop list` 反查）与 `scripts/lib/mobile-e2e.sh` 的 `laptop()` / `laptop_ok()`（`:969` / `:979`）。
    业务语义仍全在 `packages/app-host`（`host.addTask`），脚本只按下这个动词（AGENTS §3.5）。
  - 🔴 **08:0x 现量：`pnpm check:shell-unicode` 在**当前混合工作树**里 exit 1，但提交态是绿的** ——
    红的三枚逐枚量过：`research/tools/b-reinstall-readiness.sh`、`tmp/w07-probe-run.sh`（mtime 都 08:00，
    即**正在被别的会话写**）、`tmp/w07-recapture.sh`（06:32），三枚 `git ls-files` 全是 **N**、
    `HEAD:` 里**都不存在**。在 HEAD 的临时 detached worktree 里跑同一个门禁 **exit 0**，
    而那三枚文件在那份检出里根本不存在。
    ⇒ ② 那条"75 段可过"的读数不用改；但**任何"`pnpm check` 全绿"的说法必须带上工作树状态**，
    而未跟踪的并行产物会让它红 —— 这不是产品红，也不由本线代改（AGENTS §8.9）。
  - ✅ **08:1x ③ 的"第三张截图"补成一条有牙的判据（第二个补丁 `/tmp/heyta-notes-evidence-focus.patch`，
    43 行新增）**：三处 `screencap` 收进一个 `shot_evidence`，**拍之前**先读一次 `mCurrentFocus`
    并按文件名记账；第 12 步对每张图各判一条"拍的那一刻前台是本应用"。
    🔴 **像素统计这次不当判据用，是有现量理由的**（同一目录 67 张人看过的真图）：
    · `countBrandBlue` 有 **14 张 = 0**（`android-search-1..6`、`android-reminder-*` 全是真界面）
      ⇒ 把 `reinstall-all.sh` 的 `blue ≥ 20` 抄到手机侧会把这些整片判红 —— 那个阈值是从
      **mac 共享 UI** 推出来的，不是从手机界面推出来的（§7 第 82 条第二轮那个坑的手机版）；
    · `android-notes-1-editor-open.png` 人眼看是完整编辑屏（标题「编辑便签」+ 正文 + 蓝色「保存」），
      而 `contentRatio` 只有 **1.8%**，离 `png-stats` 的 `BLANK_CONTENT_RATIO = 1%` 只剩 **0.8pp**
      ⇒ `looksBlank` 在这族图上没有余量。两个读数**照打不判红**。
  - ✅ **这条判据的夹具是 `/tmp/heyta-ev-fixture.sh`：4 臂 11 条断言 + 1 枚变异全绿**
    （前台是我们 / 读不到 / 是 launcher / 记录串了文件名；变异=删掉"读不到"那一支）。
    🔴 **它照出一个真缺陷**：`dumpsys window` 读不到时我原来把空串记进账，第 12 步的 `case`
    会让它落到 `*)`，于是**"探针没读到"被报成"前台是别的 App"** —— 正是我自己注释里说要分开的两种成因。
    修法是记一个 ASCII 哨兵 `FOCUS-UNKNOWN` 并给 `""|*FOCUS-UNKNOWN*` 单开一支；
    夹具里那两条"不许塌成对方"的断言（臂 2 不含「不是本应用」、臂 3 不含「没读到」）就是它的牙齿。
  - ✅ **08:1x 两个补丁能共存、顺序无关**（显式两遍测）：`setup` 与 `evidence` 无论谁先落，
    合起来都是 `550 → 634` 行、`step "8b` 命中 1、`FOCUS-UNKNOWN` 命中 3、`bash -n` OK。
    ⚠️ **第一版测试是个假 ✓**：写成 `for n in $order` 的循环报"两条都落 + bash -n OK"却 `8b=0`、
    只多 40 行 —— 因为这条命令跑在 **zsh** 下，`for n in $order`（order="P1 P2"）**不做词分割**，
    整个 `"P1 P2"` 当成一个词 ⇒ `[ "$n" = P1 ]` 恒假 ⇒ 只落了第二个补丁。
    这是 §7 那条"zsh 不词分割"的第 N 次现形，而且这次咬的是**验证补丁的测试**，不是产品代码 ——
    现量：`ps -p $$ -o comm=` = `/bin/zsh`，`for x in "a b"; do echo "[$x]"; done | wc -l` = **1**。
    ⇒ 编排类测试宁可写两遍显式代码，也不要用 `$var` 展开的循环；报 ✓ 之前先断言"标记在不在"。
  - ⚠️ **本轮 prepared 产物的持久副本在 `~/.heyta-pending/notes-e2e-20261004/`**（7 枚，逐枚 `cmp` 过）：
    两个补丁 + 两份夹具 + 两份说明书 + 链 v9 与设备占用库。
    **不要只住 `/tmp`** —— 一次重启会把它们整个清走，而那时下一位只能重新推导（本条就是那条一般规律的又一次现形）。
    复跑：`bash ~/.heyta-pending/notes-e2e-20261004/heyta-dump-fixture.sh`、
    `bash ~/.heyta-pending/notes-e2e-20261004/heyta-ev-fixture.sh`（后者读 `/tmp/heyta-step9/ev.sh`，
    那份没了就照说明书第 1 步重新 `git show HEAD:… > base.sh` 再 `git apply` 两个补丁）。
  - 🔴 **08:3x 按 §6.2 规定一逐张打开看这几张图，看到的东西推翻了我自己上一条口头结论，也给出了 ③ 最硬的一条判据证据**：
    · **人眼读数**：载体 `heyta-wt-reinstall` 的 `android-notes-2-list-after-edit.png`（mtime 07:05:10）是
      **桌面启动器**（状态栏 7:05、"Sun, Oct 4"、Gmail/Photos/YouTube/Phone/Messages/Chrome/heyta 图标）；
      同目录 `android-notes-1-editor-open.png` 是**真编辑屏**，正文正是那一趟的标记 `note-e2e-070220-read-once`；
      `android-notes-3-from-search.png` 载体与主检出**都没有**。主检出那两张是 **10-03 17:20** 的旧图，
      且尺寸与 HEAD blob 逐一对上（`git cat-file -s HEAD:` = 48768 / 181177，工作树同值）⇒ 它们是**上一趟的**，
      这一轮的图只落在载体里（别拿主检出的那张当本轮证据）。
    · ⛔ **我上一条"第 12 步把这张启动器判成绿了"的说法作废**（它当时只是口头，没进过任何文档，现在按规矩写回这里）：
      `/tmp/notes-run7.log`（mtime 07:06:06、marker 070220）**没有走到第 12 步** —— 日志里 `════ 9.` 起
      一行都没有，它在第 8 步就停了。所以这枚启动器图**没有被任何判据放过**，它只是被两条**无条件执行**的
      `screencap` 写进盘里的（HEAD `:309` 与 `:333` 都在 `if/else` **之外**，红路照样拍）。
    · ✅ **但"第 12 步会放过它"这件事现在是量出来的、不是推论**：拿这枚真实启动器图喂第 12 步的两条腿 ——
      `-s` 通过（1,382,225 B）、mtime 07:05:10 ≥ 本轮起跑 07:02:20 通过 ⇒ 它会打印
      「✅ 证据在库且本轮新生」。这就是 `57e0e1fc`（§7.19）修过的**同一个形状在第三个调用点**的再现：
      那一次是重装段的 android 截图，这一次是产品验收脚本自己的证据图。
  - 🔴 **同一轮把"像素腿在手机侧双向不可用"钉死了**（这是上一条补丁"像素只打印不判红"的反向数字，之前只有单向）：
    归档那枚启动器 `android-launcher-false-green-57e0e1fc.png`（320x640）`countBrandBlue` = **5995**，
    **比人看过的真编辑屏（1592）还高**；而 run7 那枚全分辨率启动器（1080x2400）只有 **8**。
    分母可比是查过的：`countColor` 的 `sampleStep = Math.max(1, floor(total/200_000))`，
    320x640 时 step=1（全 204,800 点）、1080x2400 时 step=12（≈216,000 点）⇒ 两者都是 ~20 万点。
    ⇒ **同一类"不是本应用的图"，一枚在阈值 20 之上、一枚在它之下** —— 主蓝阈值在手机上既会假绿也会假红，
    这正是 `57e0e1fc` 当年改用 `mCurrentFocus` 而不是再加一条像素阈值的原因；现在有了双向数字，
    后来者别再往手机截图判据里塞像素阈值。
  - ⚠️ **run7 那 5 条 ❌ 不进 ③ 的读数账**（有效读数仍是 06:24 那趟：27 通过 / 5 失败，
    `/tmp/notes-run.log` 与 `/tmp/notes-run1.log` 实测逐字节相同）：归因**两种都没排除** ——
    ① 另一会话在同一台 `emulator-5554` 上跑它自己的设备验收（第 5 步读到启动器、第 6 步起的诊断文字是
    **首启同意面板**「在使用联网功能之前 / 同意并联网 / 只用本机」，那正是"别人 `pm clear` + 重装之后"的界面，
    而本趟第 0 步已经点过一次「同意并联网」）；② 本应用在保存正文时自己掉回桌面并重启。
    🔴 **判别办法是现量出来的一个缺口**：第 4/5 步的红路**没有调 `blame_crash`**（HEAD 全文件只有 `:173`、
    `:278` 两处调用），所以那一刻崩没崩**没有任何一层记得** —— 下一趟窗口内要做的不是猜，是把
    `blame_crash` 挂到第 4/5 步的 `bad` 之后（现成 helper，零新逻辑），再配第 12 步那条 `mCurrentFocus`
    腿给出的"前台到底是谁"。这两条一起才分得开"崩了 / 被别人切走 / 产品没保存"。
  - ⚠️ **落点又被别人贴住了（现量）**：`scripts/verify-mobile-notes.sh` 工作树相对 HEAD 的那 **1/1** 就在
    第 12 步循环里的 `:545`（`$f` → `${f}`，§7 第 64 条那条全角坑的修法），**距我要插入的判据只隔 8 行**。
    `git apply --check` 对着这个脏树仍 exit 0（`545` 不在我的 hunk 上下文里，两边不会互相回退，实测过），
    但**继续不应用**：同一个文件不要落成"我的 + 他的"混合态，等那一行落地再说（AGENTS §8.9）。
    ⚠️ 顺带一条**抄件预警**（本仓现量两处不同解析）：`verify-mobile-restore.sh:245` 用
    `grep "mCurrentFocus=" | tail -1`，而 `lib/mobile-e2e.sh:1535` 与 `reinstall-all.sh:317` 用
    `grep -m1 mCurrentFocus`；我的补丁跟后者。落地时应当把这条腿收进 `lib/mobile-e2e.sh` 成**单一所有者**，
    不要再留第三份解析（`restore.sh` 那段注释里记录的"截断取行让两条判据永远为假"就是三份解析的代价）。
  - ✅ **08:4x ③ 的归因缺口补成第三个补丁 `/tmp/heyta-step9/heyta-blame-crash.patch`**（4 行改写、2 hunk、`550 → 550` 行纯替换）：
    第 4/5 步的四条红路各挂一层现成的 `blame_crash`（`blame_crash "<在哪一步之后>" || bad "<原话>"`），
    崩了报崩、没崩**原话逐字不变**。`bash -n` 过、`git apply --check` 对着当前脏树 exit 0。
  - ✅ **它的夹具 `/tmp/heyta-blame-fixture.sh`：4 臂 × 4 条 + 变异腿 3 条 = 19 条全绿**。
    被测语句是**从文件里按行取回**的（不手写第二份），`blame_crash` 函数体也从 `lib/mobile-e2e.sh` 用 awk 取；
    假 adb 只做一件事（回答 `logcat -d -b crash`）并带**阳性对照**（CRASH=1 时读数非空才继续）。
    🔴 **夹具第一跑就红给自己看**：假 adb 报"没崩"，而真因是我在子 shell 里 `CRASH=1` **没 export** ——
    桩的开关变量不导出，被测函数起的那个 `$ADB` 子进程读不到（同 §7.30 前面那条"桩变量没 export"）。
    🔴 **还有一处是我写在报告里的错数字**：变异那步我原本打印"应只剩 `:173`/`:278` 两处原有调用"，
    实际那条 `sed` 是**全局**的，它连原有两处一起摘掉了 ⇒ 正确的读数不是"剩 2"而是"归因层调用形状剩 0"
    （`grep -c` 数的还是**行数**，文件里另有一行注释提到这个名字）。改成三条派生断言后现量为
    **基线 2 处 → 被测 6 处 → 变异后 0 处**，并把"被测 = 基线 + 4"钉成断言，否则报告本身就会骗下一位。
  - ✅ **三个补丁共存、顺序无关**（`/tmp/heyta-combo3-test.sh`，两个显式顺序各跑一遍，不写 `for` 循环）：
    `setup → evidence → blame` 与 `blame → evidence → setup` 出来的文件 **`cmp` 逐字节相同**，
    都是 `550 → 634` 行、`step "` 标记 15、`step "8b` 命中 1、`shot_evidence` 6、归因层 6、`FOCUS-UNKNOWN` 3、`bash -n` OK。
    ⚠️ 这条测试**第一版也是我读错的**：`BL` 变量按记忆写成 `/tmp/heyta-blame-crash.patch`（真身在
    `/tmp/heyta-step9/` 下），于是两个"顺序"都因 `No such file` 而失败、`COMBO3_SAME=0` 看起来像"补丁互相冲突"——
    修路径后立刻 `COMBO3_SAME=1`。⇒ 报"互相冲突"之前先确认两份都**真的应用过**（同 §7 元规则一：先怀疑探针）。
  - 🔴 **08:4x 现量：① 与 ③ 的窗口此刻被四条条件同时关着**，不是"等一台设备空出来"那么小的一件事 ——
    负载 **18.74**（阈值 12）、`:3000`/`:3100`/`:4318`/`:4319` **四个端口都有监听者**（70256 / 26407 / 99252 / 67695）、
    `emulator-5554` 上 `com.heyta` 是 **pid 5928、已活 1h18m39s**，而它**不是我的遗留**——本线最后一趟设备验收
    （run7）07:06:06 就结束了，5928 起于 **07:22** ⇒ 归属在别人那一侧，按 AGENTS §8.9 不 force-stop、不动它；
    `scripts/verify-mobile-notes.sh` 仍带别人那行未提交的 `${f}`。链 v9 已轮到第 85 轮（约 63 分钟）。
    ⚠️ 这条读数的用处是**给"窗口会不会自己开"一个数字**：一枚 1h18m 不动的前台应用不会自己让开，
    所以 ①/③ 要么由设备的所有者收工，要么由产品负责人明确授权我代拍（那条授权要写成一句可执行的话，我不猜）。
  - 📌 **prepared 产物的持久副本现在是 16 枚**（`~/.heyta-pending/notes-e2e-20261004/`，逐枚 `cmp` 过）：
    三个补丁 + 三份夹具 + 两份组合测试 + 两份说明书 + 链 v9 + 设备占用库 + **run7 的两张原始截图**
    （`run7-android-notes-{1,2}*.png`，54014 / 1382225 B）—— 那两张图是上面"第 12 步两条腿全过"这件事实的
    **载体**，只留在 `heyta-wt-reinstall` 的未跟踪改动里会被下一次 `git checkout` 抹掉。
  - 🔴 **08:5x 顺着第 9 步那两条 ❌ 挖到一个真缺陷并当场修掉（提交 `53c0ab3a`，只动 `scripts/lib/mobile-e2e.sh`）**：
    06:24 那趟的「找不到「立即同步」」+「手机同步没成功」**不是产品没同步**，是探针形状 ——
    `phone_sync()` 还在用 `xy_text "立即同步"`，而自动同步抢跑时按钮处于 `loading`，
    只渲染菊花，`text` 里既没有「立即同步」也没有 busy 文案（busy 只在 `content-desc`）。
    **这正是 traps 第 67 条第 ③ 变体（假红）**，而同一份库里的 `ensure_phone_sync` 早已把三种情形分开处理：
    🔴 **六个脚本用上了新实现，三个脚本还走旧入口**（`verify-mobile-notes/list/tags.sh`，现量命令
    `grep -rnE '^[[:space:]]*(if )?phone_sync\b' scripts/verify-mobile-*.sh`）——
    AGENTS §3.5 那条"抽出了共享实现不等于重复被消除"在这里第二次现形。
    ⇒ 修法是把"发起"交还单一所有者，`phone_sync` 只等结算；注释里给的是**现量命令而不是数字**（调用点会漂）。
  - ✅ **这条修的夹具 `/tmp/heyta-phonesync-fixture.sh`：4 臂 + 1 枚变异，18 条断言全绿**
    （被测函数体用 awk 从 lib 本体取，桩只提供三种前台状态）：
    空闲 ⇒ 恰好一次 tap（这条同时是**阳性对照**，防"桩没接上"的假绿）；
    忙 ⇒ 一次都不点、不红、打印"自动同步已经在跑"、仍然等结算；
    真不在屏 ⇒ 报「既不空闲也不在忙」+ `rc=1` + **不许等结算**；
    desc 在而坐标取不到 ⇒ 报"取不到坐标"、不许点空参数；
    变异=退回旧实现 ⇒ 忙态重新报「找不到「立即同步」」（证明这套臂咬的就是那个形状）。
    ⚠️ 第一版写法里有三处坏探针，是**复查时**发现的、不是跑出来的（所以没有"夹具自己照出"这份功劳）：
    `W=` 赋值写在用它的桩**之后**、假 adb 的写盘路径靠父 shell 变量（没 export 就写进空路径）、
    以及"不许点空参数"那条原本去 grep **stdout**，而 tap 记录其实落在 `taps.txt`
    —— 那是一条**恒过**的断言，长得像证据。三处都在跑之前改掉了，跑出来的 18 条是改后的数。
  - ⚠️ **同族的第四处按归属登记、不代改**：`scripts/verify-mobile-restore.sh:620` 仍是
    `XY=$(xy_text "立即同步")` → 回退 `xy_desc` → 非空才 tap，紧接着又 `ensure_phone_sync` 一次
    （即"可能点两下 + 最后一次静默空操作"）。它现在**不产出假红**（后面那层新实现兜住了结果判定），
    所以我不在别人的面里顺手清 —— 现量：`grep -rn 'xy_text "立即同步"' scripts/*.sh | grep -v snap` 只剩这一枚。
  - 📌 **这两笔的"经验去处"按分层规则登记在这里，等 traps 腾出手收号**（现量：`docs/reference/environment-traps.md`
    此刻 `M`、相对 HEAD **+289/0** 由别人在写 ⇒ 现在插进去就是一次没人能干净解的混改；
    落地时**取号按工作树、不按 HEAD**，且这两笔都**不新开号**）：
    ① `phone_sync` 那笔是 traps **第 67 条的第四种变体**（"共享实现抽出来了，旧入口还在三个脚本里活着"），
      按该文件"同类事故扩充原条"的规矩应并进 #67；
    ② 第 8 步那笔属于"警告已经打印、结论照样记成产品失败"那一族（#46/#50 的近亲），
      正解是**要在真实界面上断言的地方先过 `require_screen`**，而不是把断言放宽。
  - ✅ **08:5x 门禁现量（带载体状态）**：`check:script-snapshot` exit 0（38 个脚本自快照在位）、
    `check:shell-unicode` exit **1** 但 5 枚报的全是别人未跟踪的 `tmp/w07-*.sh`，
    `grep -c mobile-e2e` 在那份日志里 = **0** ⇒ 我这一笔没有新增违规（同 §7.30 前面那条"混合工作树红"的口径）。
    载体 `heyta-wt-reinstall` 已从 `37052fd5` 推到 `3771edb2`（= 提交前的 main）、工作树 0 条脏；
    run7 那两张原始截图已另存 `~/.heyta-pending/.../run7-*.png`（逐枚 `cmp`），检出里的两张还原成 HEAD 态。
  - ✅ **08:57 三个补丁落在载体、不落在主检出** —— 边界与交付同时成立：`scripts/verify-mobile-notes.sh`
    在主检出仍然只有别人那一行（`${f}`），而 ③ 要跑的判据在载体里已经补齐：
    载体 = `49e9a2fd` + 该文件 blob **`5f37d72984e4de1a1a17388e39b54ce6ae2f71a3`**（main 同路径是 `3a9f6890…`）。
    现量：`bash -n` OK、634 行、`step "` 15、`step "8b` 1、`shot_evidence` 6、归因层 6、`FOCUS-UNKNOWN` 3，
    且与 `/tmp/heyta-combo3/C/scripts/verify-mobile-notes.sh` **逐字节相同**（`cmp`）⇒
    08:4x 那次"顺序无关"的组合测试不是纸面结论，它预测的文件内容和实际落盘的一致。
    ⚠️ **上面这一笔（08:57）的三行读数是「三补丁」那一版的**（634 行 / `5f37d729`），四补丁后已被本节末
    `09:0x 载体身份随之更新` 那行取代 ⇒ 现在生效的是 **642 行 / `757f1bd6…`**。留着原句是为了让
    「一个 blob sha 在同一个文件里被换过两次」这件事看得见，而不是只留一处新读数。
  - 🔴 **落补丁的先后是一次真会咬人的顺序**：必须先 `git checkout` 到 main、**再**打三个补丁。
    因为假红的根修 `53c0ab3a` 落在 `3771edb2` 之后 —— 我先打完补丁才推到 3771edb2，那会儿 lib 里还是旧的
    `xy_text` 版 `phone_sync`，③ 会带着它跑，第 9 步照样报"找不到「立即同步」"，
    而补丁里新加的归因腿会把这条红印成"崩了/没在前台"两种猜测之一。
    现量已核：载体里 `awk '/^phone_sync\(\)/{f=1} f{print} f&&/^\}/{exit}' scripts/lib/mobile-e2e.sh`
    打出的是 `ensure_phone_sync || return 1` + `sleep 5` + `wait_synced 180`。
  - ⚠️ **载体现在是脏的，而且是刻意的**：链 v9 那条"载体不干净 ⇒ 不动它"会生效，所以它**不会**再自动把载体
    推到更新的 main —— ③ 与紧随的 ① 都钉在 `49e9a2fd + 5f37d729` 这一版读数上。
    下一位要么先把这三个 diff 落到 main 再谈对齐，要么对账时按这个 blob 读；**别把"载体没跟上 main"当成链坏了**。
  - ✅ **step 8b 取 id 的解析按真源核过**（免得窗口开时白烧一趟 `exit 3`）：
    `apps/node-host/src/cli.ts:44` 的 `BOOL_FLAGS` 含 `json`，`:322` 在 `--json` 下输出
    `{ok:true, command:'add', id, due}` ⇒ 补丁里那条"从 JSON 取 `id`"对得上当前源码。
  - ⚠️ **08:5x 又现形一次"混合工作树红"（口径同上面 08:0x 那条）**：`check:md-tables` 这轮 exit 1，
    8 处全在 `docs/plans/trash-and-archive.md`（`:734`/`:735`/`:738`/`:1501`…），而 `git status` 那一枚是
    **`M`（别人正在写的未提交改动）**，本文件 0 处被点名 ⇒ 不由本线代改、也不拿来算本线的门禁账。
  - 🔴 **09:0x 把 run-1 那两条 ❌ 归到位了，并且据此加了第四个补丁**：
    `/tmp/notes-run1.log` 的第 8 步现场是**连着两行** ——
    先由 `dump()` 自己打印「⚠️ uiautomator 连续 10 次抓不到界面 … `/tmp/ui.xml` 已被截成空文件 …
    **那是假红，不是产品缺陷**。需要在真实界面上断言的地方请用 `require_screen`」（本机负载当时 10.07），
    紧接着下一行就是 `❌ 搜索结果里没有「便签」这一段`；第 9 步开头又是同一条警告。
    ⇒ 这条红**不是产品缺口**：`SearchScreen` 有 `searchNotes` 消费点、zh 词条 `web.search.notesSection`
    逐字就是「便签」、面板在 `noteRows.length > 0` 时把它渲染成一个 `<Text>` 节点，
    而 `has_text` 是**整节点精确匹配** —— 树是空的时候它必然回 0。
    🔴 **脚本里那个警告的存在，本身就说明这条判据走的是被警告的那条路**（"请在真实界面上断言的地方用
    `require_screen`"），而第 8 步只在进浮层之前调过一次，打字之后没有再调。
    另外被否证的一条猜测：我一度以为是"打进了任务页那个内联筛选框"（`SearchScreen` 文件头登记的
    同屏两个输入框那条边界）—— 现量是脚本在打字**之前**已经用 `has_sub "输入关键词"` 断言过浮层在场
    并打印了 ✅，那一臂不成立。
  - ✅ **第四个补丁 `/tmp/heyta-step9/heyta-search-gate.patch`（8 行、1 hunk、只动第 8 步打字之后）**：
    `dump` 之后先 `require_screen`（空树 ⇒ 判成本轮无效、`exit 3`，不记成产品结论），
    再 `settle_for "便签" 8 2`（抓到 hierarchy **不等于这一屏画完**，负载高时结果段可能还没渲染；
    它不改判据颜色，轮询到为止、报不出来照样红）。夹具 `/tmp/heyta-searchgate-fixture.sh`
    **3 臂 + 1 枚变异 = 10 条断言全绿**：空树判 `rc=3` 且不出现产品原话；树里有「便签」走命中那支
    （阳性对照）；树非空但真没有那一段**仍然红**（判据没被放宽）；变异=摘掉 `require_screen` 那行，
    空树立刻回退成 `❌ 搜索结果里没有…` —— 这条夹具咬的就是"环境失效被记成产品失败"那个形状。
    ⚠️ 夹具的两条自我守卫是后加的（`被测块里不含那条 bad ⇒ 测的是空气`、以及臂 1 原本重复跑了一次）——
    加它们之前那三条臂也全绿，所以**这类"绿但不确定咬到哪"的缺口只能靠断言块内容本身来堵**。
  - ✅ **四个补丁共存、顺序无关**（`/tmp/heyta-combo4-test.sh`，两个显式顺序各一遍）：
    `setup → evidence → blame → searchgate` 与反序出来的文件 **`cmp` 逐字节相同**，
    都是 `550 → 642` 行、`step "` 15、`step "8b` 1、`shot_evidence` 6、归因层 6、`FOCUS-UNKNOWN` 3、
    `require_screen` 1、`settle_for "便签"` 1、`bash -n` OK。
    新增行里 `$` 出现 **0 次**（所以 §7 第 64 条那条全角坑在这一笔上结构上不可能触发——这是查过的，不是推的）。
  - 🔴 **载体身份随之更新（读数要钉的是这一版）**：`heyta-wt-reinstall` @ `49e9a2fd`
    + `scripts/verify-mobile-notes.sh` blob **`757f1bd6011c8286c67f146d0cddf637d6d84cb7`**（642 行，
    上一版三补丁时是 `5f37d729`）。合并态整份另存 `~/.heyta-pending/notes-e2e-20261004/carrier-notes-49e9a2fd-4patches.sh`，
    目录里现在 **25 枚**产物（逐枚 `cmp`）。
    ⚠️ **这行又是「四补丁」时的身份**：09:45 之后生效的是 **五补丁 / 673 行 / `fbe0ee72…`**，
    见本节末 09:45 那笔。同一个 blob sha 在这一份文档里已经被换过三次，每次都在这里就地标明。
  - ✅ **09:0x 等窗口的编排改到链 v10**（`/tmp/heyta-window-chain10.sh`，v9 已停 —— 那是我自己的进程，
    停时它在等窗口的轮询里、没有任何验收在跑；现量：`第 114 轮 设备在线但不空闲`）：
    ① **不再挂在 ③ 的退出码上**（v9 那版只有 `NOTES_EXIT=0` 才跑 ①，而 Goal 的顺序本来就是 ① 在前 ⇒
    ③ 只要有一条腿红，窗口每开一次就白烧一次，① 永远饿死），② **跑 ① 之前先把载体那枚脏文件还原**
    （启动器在载体落后 main 时要 `git checkout --detach`，同一路径若被别人先提交，checkout 会**拒绝覆盖本地改动**
    ⇒ ① 红在"对齐"这一步，而那是我留脏造成的），③ 加了一次性旗标 `/tmp/heyta-chain8.reinstall-done`
    免得①被重复触发。v10 现在第 8 轮；09:01:32 现量负载 **38.84**（那是**别人的两趟重装**在跑：
    `81007`/`93771 queue-reinstall-all.sh`、`93817` 从 `/tmp/heyta-reinstall` 跑 `.reinstall-all.sh.snap.93817`），
    而链每轮自己重取负载 —— 上面那个数字属于取数那一刻，不是瞬时值。
  - 🔴 **09:2x 等窗口这一轮读自己的链，读出 v10 一枚真缺陷**：`:162` 直接
    `bash scripts/verify-mobile-notes.sh`，而 `:180` 在 ③ 之后把这枚文件 `git checkout` 回
    未打补丁的样子 ⇒ 走到「重装旗标已存在」那条循环路径的第二趟时，③ 会**静默跑成没有四补丁的
    旧脚本**，而日志与读数一模一样 —— §7 第 27/82 那一族的第三种面目（缺一步 与 一切正常 不可区分）。
    现量：v10 跑了 16 轮全停在设备门（09:04→09:15，`pidof_com.heyta` 从 `5928` 换到 `11056`、
    `mCurrentFocus` 现在停在 `com.android.intentresolver/ChooserActivityLauncher`），所以**它没有
    产出过一条错读数 —— 那是运气，不是判据**。
  - ✅ **v11 补了一条「③ 输入核身」**（判据本体 `/tmp/heyta-identify-fn.sh`，链与夹具共用同一份实现，
    不抄第二份）：用 `git hash-object` 比**字节**（不用 mtime，理由同上面那条「mtime 只能证变过」）；
    不符就先响亮报「核身未过」，再用持久合并态覆盖**并重新核一次**，仍不符 ⇒ `return 1` 让链 `continue` ——
    绝不拿身份不明的脚本产读数。现量：载体 sha=`757f1bd6…`、642 行，跑完核身 sha 未变、脏文件仍 1 枚
    （相符那一支不许动那枚文件，这条本身就是臂 1 的断言）。
  - ✅ **夹具 `/tmp/heyta-identify-fixture.sh`：6 臂 18 条断言 + 3 枚变异全被抓**（🔴 **这组读数已被下面 09:2x 那笔取代**：核身加了基线门之后是 7 臂 23 条 / 5 枚）
    （M1 删掉 cp 之后的第二次哈希 → 臂2 rc 红；M2 `return 1`→`return 0` → 臂3 红；
    M3 把判等退化成「读得到就放行」→ 臂2 POST 红）。臂1 故意把持久副本喂成**过期内容**，
    它咬的是「明明相符却仍被副本过载」这一支；臂6 是正向对照（载体字节恰等于目标 sha、且没有副本可退
    ⇒ 仍放行），它证明判据认的是字节而不是「有没有一份副本」。
  - ⚠️ **夹具第一版 7 条日志断言全红、rc/哈希断言全绿 —— 红的是探针，不是判据**：
    `say()` 往变量里追加，而判据本体跑在**子 shell** 里，出了子 shell 那一份就没了。
    改成 `say()` 写文件、跑完回读。这是 §7 元规则第 1 条「先怀疑探针」在我自己夹具上的现形，
    而且它给出的**错误结论方向是「判据本体坏了」** —— 基线红那一刻如果没先看「哪些断言红」，
    下一步就会去改 `/tmp/heyta-identify-fn.sh`（它是好的）。
  - ⚠️ **v10→v11 换进程这件事按边界只做在自己身上**：`kill 2439` 之前先 `ps` 确认那是我自己起的
    那条链（它当时在轮询里，没有任何验收在跑），停后 `pgrep -f heyta-window-chain1` = **0**；
    v11 的日志另起 `/tmp/heyta-chain11.log`，从第 1 轮重新计数（旧日志留在原处不覆盖）。
    三枚新产物（fn / 夹具 / 链 v11）已 cp 进 `~/.heyta-pending/notes-e2e-20261004/`，现在 **28 枚**。
  - 🔴 **同一轮里我自己又引入一枚，然后被自己的夹具门挡住** —— v11 的自愈是**破坏性**的：
    「sha 不符 ⇒ 拿持久合并态覆盖」这句，只要上游那枚文件被别人推进过一次，覆盖就是一次
    **静默回退**，而且回退完照样报「核身通过」。现量：`git rev-parse HEAD:scripts/verify-mobile-notes.sh`
    在 `49e9a2fd` 与当前 main 上都是 `3a9f6890…`（**今天还没有**别人的改动 ⇒ v11 不产错读数），
    但「今天不产错」不是判据 —— 这正是我这一路在写的同一件事：**缺一步的表现与一切正常完全一样**。
  - ✅ **v12：自愈只允许两种身份**（`/tmp/heyta-identify-fn.sh` 加第 4 参 `BASE_SHA`）——
    合并态本身（幂等）、或**这枚提交的未打补丁基线 blob**；第三种内容 ⇒ 响亮报「静默回退」+「把四个补丁
    重新推导到新底」再 `return 1`。基线**现取自载体 HEAD，不写死**：写死的基线在链把载体推到新 main 后
    永远对不上 ⇒ 这条门只有两种结局（③ 饿死、或被谁顺手删掉）。空文件（`have` 读不到）**不算第三种身份**，
    因为那一刻没有字节的载体文件可被回退，cp 是纯增益（臂 4 钉的就是这一支）。
  - ✅ **夹具升到 7 臂 23 条 + 5 枚变异全被抓、0 枚无效**（`/tmp/heyta-identify-fixture.sh`）：
    臂7 是「上游推进 + 副本在手 ⇒ 一个字都不许改」，臂7b 是「没给基线 ⇒ 保守」；
    M4 摘掉基线门 ⇒ 臂7 rc 红，M5 取消空文件例外 ⇒ 臂4 rc 红。
  - 🔴 **夹具第二枚自身缺陷，形状和上一条一样**：`mutate()` 只数「变异存活」，不数「变异根本没跑成」——
    于是 M4（awk 删出一行孤儿 `fi` ⇒ `bash -n` 不合法）、M5（awk 语法错）**两枚从未执行**，
    汇总却印「变异存活 0 枚 ⇒ FIXTURE=GREEN」，读起来像「5 枚全被抓」，实际测了 3 枚。
    修法是 `INVALID` 与 `SURV` 一起进失败判据。**报「N 枚变异全被抓」之前必须先看有没有「无效」这一列** ——
    这一条与 §7 第 86–90 号段（验证装置自身的自检盲区）同族，也和 traps 台账**同一条待并入**（见上面 09:1x 那条 📌）。
  - ⚠️ **v11→v12 换进程仍只做在自己身上**：`pkill -f heyta-window-chain11` 前 `pgrep` 现量到两枚 pid
    （`74350`/`74352`，一条命令 + 一条 `bash`），停后 `pgrep` = **0**；停时它在第 9 轮等窗口、没有任何验收在跑。
    09:28 现量：负载 **9.21**（≤12，闸门这一项已过）但设备仍被 `com.heyta` pid `12027` 前台占着
    （`mCurrentFocus` 指向 `com.heytamobile.MainActivity`）⇒ **窗口不在，③ 继续等**。
    日志另起 `/tmp/heyta-chain12.log`；产物副本现在 **29 枚**。
  - 🔴 **① 多了一条外部阻塞，而它的形状恰好是「看起来像死了」：别人那棵重装的公证等待已挂 6h18m**。
    09:31 现量（一条命令可复跑）：`bash /tmp/heyta-real-runner-pids.sh 'reinstall-all\.sh'` 打出三枚 ——
    `81007`/`93771 queue-reinstall-all.sh`、`93817 /tmp/heyta-reinstall/scripts/.reinstall-all.sh.snap.93817`；
    往上走祖先链**没断**（`95477 package-app.sh → 93817 → 93772 node → 93771 → 81007 → ppid 1`），
    所以我的「无重装」门**认得出**这个对手 ⇒ ① 会在它活着期间一直被拦，这是设计而不是故障。
    ⚠️ **但我不据此判它死**：`/tmp/heyta-macos-dist` 里 `Heyta-1.0.0.dmg`、`packaged-first-run.png`
    的 mtime 全是 03:13（= 6h18m 前），25 秒两次采样零变化 —— 而 `notarytool submit --wait` 等的是**苹果侧**，
    本地静默是它的正常形态（§7 元规则第 1 条：本地零变化 ≠ 它没在工作）。
    可复跑：`ps -o pid,etime,command -p 95477,98934`、`find /tmp/heyta-macos-dist -maxdepth 1 -type f -exec stat -f '%N %m' {} \;`。
    ✅ **这一棵不钉 ③**：它的进程树里没有 `adb`（`ri_on_device_path` 判「够不着设备」），
    ③ 现在唯一的阻塞项是**设备被 `com.heyta` 前台占着**（那一头是别人正在做的移动端验收）。
    ⇒ Goal 的两项未完成因此是**两个不同的持有者**：③ 等设备，① 等那枚公证等待结束；
    两者都不许由我动手摘除（AGENTS §8.9「不杀别人正在跑的验收」+ 只对自己创建的对象动手）。
  - ✅ **09:33 ③ 的前置逐条现量：只剩设备这一条**。`:3100/health` 回的是
    `{"status":"ok","db":"connected","wsConnections":0}`（:3000 也 ok，但 ③ 用的是 3100）、
    凭据 `/tmp/heyta_mobile_token.txt` **227 字节**（≥100 那条过）、e2e 三个端口 4318/4319/4322 全空、
    负载 9.21 ≤ 12、上面那棵 `real-runner` 够不着设备 ⇒ 不钉 ③。
    ⚠️ **顺带核对了一条并行线记的相反判断**（「verify-mobile-* 不自己起栈 ⇒ 等端口空是死胡同」）：
    现量在 `scripts/verify-mobile-notes.sh:69` 的前置注释与本链 `:104-106` —— **这条链早已改对**
    （门的第 3 项就是 `curl /health` 命中 `"status":"ok"`，`free_port` 只用在 4318/4319/4322 上）。
    写在这里是为了让下一次读到那条判断的人知道：它说的是链的**上一版**，不是当前这一版。
  - ✅ **09:35 现量：③ 的读数钉在 `49e9a2fd` 这一版，而它对当前 main 零代码差异** —— 载体因我那一枚
    脏文件跳过对齐（链 `:126`），所以 `CARRIER_HEAD=49e9a2fd` 而 `main=176dd02a`。差在哪是量出来的：
    `git diff --name-only 49e9a2fd main | grep -v '^docs/'` **只剩 1 枚 `BLOCKED.md`**，
    `packages/`、`apps/`、`scripts/` 一枚都没有 ⇒ ③ 的判据与 ① 的打包输入在两版之间**逐字节相同**。
    ⚠️ 这句只登记"今天无害"，不是"这条设计没问题"：如果设备释放前落了**代码**提交，③ 就会跑在旧提交上。
    那时链会自己打印 `载体 49e9a2fd ≠ main <新> ⇒ 本轮读数只能钉在载体那一版`（`:133`）——
    **不要**看到这条就去把脏文件 `checkout` 掉来"让它对齐"：那正是 v11 那枚破坏性覆盖的反面，
    对齐要连着把四个补丁重推到新 base（`identify_notes_input` 的臂 7 会拦住 cp，那是对的）。
  - 🔴 **09:45 第五个补丁：第 10 步那条"服务端数得出吗"是一条不能失败的判据**。
    原句 `SELECT count(*) FROM operations WHERE op_type='UPD' AND entity_type='NOTE'` 判 `>= 1` ——
    而这台库是**共享**的：现量 `SELECT ... WHERE entity_type='NOTE'` 得到 4 行，属于**两个账号**
    （user `187` 与 `203`，各自一条 CRT+UPD），且 `server_seq` 是**按用户各自从 1 起**的。
    ⇒ 只要任何一趟留下过一条 NOTE/UPD，**这一趟一条都没发出去也照样绿**。
    旁证：run-1 那一趟它打印的是「服务端 NOTE/UPD op 数 = 2」，而它自己最多贡献 1 条。
    改法：按本轮的 `entity_id='${NOTE_ID}'`（第 3 步已经拿到）收范围，并拆成三条各有归属的读数 ——
    `CRT` 那条做**阳性对照**（连建的那条都不在 ⇒ 判"整条路没走通"，不是"编辑没生效"）、
    `UPD` 恰 1 条才算过、`>1` 判"重复上传"；`psql` 回的不是数字 ⇒ 判"读不到"，不记成"没发出去"；
    `NOTE_ID` 形状不合法 ⇒ **一条查询都不发**（空串拼进 WHERE 得到的 0 会把探针故障伪装成产品失败）。
    全库总数保留成一行 `INFO`，**只打印不判定**，用途是让"这台库还住着别人"可见。
  - ✅ **夹具 `/tmp/heyta-step10-fixture.sh`：7 臂 24 条 + 4 枚变异全被抓（0 存活 / 0 无效）**。
    它抽的是**发布文本本身**（`# >>> step10-scoped begin/end` 两个标记之间，41 行），不是第二份实现；
    抽取自检要求 4 枚 needle 齐、不许带标记残片、块少于 15 行就红。
    🔴 **臂 7 是新旧对照**：同一份读数（本轮 scoped UPD=0 / CRT=1 / 全库=2）喂**改之前那 12 行**
    （从 `git show HEAD:` 现抽）⇒ 旧版**绿**、新版**红**。这条臂量的不是"新写法对不对"，
    而是"少了收范围就没有分辨力"这件事本身 —— 否则我完全可以给新写法量身定做一组只赢的读数。
  - ⚠️ **夹具自己交出来的两枚假读数，都在报 ✓ 的路上**（同 §7 第 86–90 号段那一族）：
    ① 变异体原先写在 `$FX/` 里，而子进程开头 `rm -rf "$FX"` 把它删了 ⇒ 子进程报"找不到被测文件"退出 1，
      外层只认"基线 RED" ⇒ **记成"变异存活"**（M1 第一次就是这么"活"的）；
      修法：变异体放 `$FX` 之外，且"抽取自检拦住"也算一种合法捕获（判据本体被删时夹具拒绝测空气）。
    ② M2/M4 的 needle 被多余的 `\\$` 转义弄成 0 命中 ⇒ 报"替换失败"。
      现在的 `mutate()` 三件齐：needle 命中数必须等于期望、`cmp` 证明确实改了、`bash -n` 证明还是合法脚本。
  - ✅ **载体身份第三次更新**：`heyta-wt-reinstall` @ `49e9a2fd` + blob **`fbe0ee7257d963e0fd4c65da1f7f06bb39357953`**
    （**673** 行，五补丁合并态）。正序与**反序**各打五枚补丁出来的文件**逐字节相同**
    （`COMBO5_CMP` / `REVERSE_CMP` 都是"相同"，5/5 应用零失败）；
    `~/.heyta-pending/notes-e2e-20261004/` 现在 **33 枚**产物；链升到 v13（`WANT` 指向 `…-5patches.sh`、
    目标 sha 换成 `fbe0ee72…`），v12 是我自己的进程、停在第 22 轮等窗口时停的。
    ⚠️ **主检出那份一个字都没动**（别人那一行 `${f}` 的未提交 diff 仍在，`git diff HEAD` 现量 1/1）。
  - 📌 **同族形状在别处还有一枚，登记不代改**（不在 ③ 的地界里，且现在改完也无法验证——要真机跑）：
    `scripts/verify-mobile-lists.sh:391/396` 与刚修掉的那条**逐字同形**
    （`count(*) ... op_type='CRT' AND entity_type='PROJECT'` 判 `-ge 1`，无 user/entity 收范围）。
    ⚠️ 但我**没有**把它写成"现在就是空判据"：09:47 现量这台库 `heyta_mobile_smoke` 里
    PROJECT/TAG 的行数是 **0**（NOTE 才是 2 用户×2 操作）⇒ 它今天在这台库上仍然会红，
    **同库第二趟之后**才会变成不能失败。它跑的是不是这台库我没测（`:386` 读 `HEYTA_E2E_DB`，默认值相同）。
    ⇒ 待办写清两件事：先量它实际落在哪个库，再照 ③ 这条同样的改法（按 entity_id 收范围 +
    CRT 阳性对照 + 形状守卫）提一次；改完必须自己那一趟真机跑，不能凭结构相同就宣布闭合。
    `verify-mobile-tags.sh:443` **不算**这一族——它只 `sed` 成一行打印，没有 `ok()` 结论（打印≠判定）。
  - ✅ **09:50 按 Goal 点名的顺序把第 6/7 步也逐条读过：这两步不需要补丁**（写下来是为了让下一个人不必重做这次审计）。
    第 6 步 `note_op_count`（`:153-158`）数的是**本机手机库**的 `entityType='NOTE'` + `opType`，而第 0 步刚
    `pm clear` 过 ⇒ "恰好 1 条"这一档**由构造保证有范围**，和第 10 步那枚"共享库 + 绝对阈值"不是同一件事；
    探针失败那一支也在（`2>/dev/null` 之后 `grep -qE '^[0-9]+$'` 对空串为假 ⇒ 判"读不到"，不会塌成"0 条"）。
    第 6 步的载荷腿把键集合判成 `['content']` 且比对正文，`raw` 为空时 `raise SystemExit(3)` 并写明
    "不能当没问题" —— 三个失败方向各有码（2=内容不合格、3=读不到），这正是要的形状。
    第 7 步是行为反证（不改字保存 / 点取消都不许多写 op），不依赖服务端计数 ⇒ 不受这次修的影响。
  - ⚠️ **① 的两条只读预检，一条有结论、一条没拿到干净读数**：① 磁盘 153 GiB 可用（926 GiB 用了 83%）
    ⇒ 四端产物体量够；② 远端 Windows 那枚 `web-dist` 在不在，两次 ssh 探针**都没回可读 ASCII**
    （默认 shell 是 cmd，`if (Test-Path …)` 被当 cmd 语法读，回显是 GBK 乱码；第二次的 `$p` 又被引号层吃掉）。
    **不拿"我推测它在"当读数**，也不去修远端 shell 配置（不在本条线地界）。承重的是
    `reinstall-all.sh` 自己那条 `sha256` 对账（本地 vs 远端不一致就**拒绝打包**，§7 第 82 条），
    我这枚预检只是提前看一眼，不是判据。09:50 负载 **34.03**（>12）、设备仍被 `com.heyta` pid `12027` 占着 ⇒ 链 v13 继续等。
    🔴 **10:11 这条"没拿到干净读数"已被第三次探针否证，原句留着是为了让后来者别再走同两条弯路**：
    前两次失败的原因只是**默认 shell 是 cmd**，显式走 `powershell -NoProfile -Command` 一次就出可读 ASCII ⇒
    `Test-Path C:\src\heyta\apps\web\dist\index.html` = **True**，`Get-FileHash` = **`517C6BA7…`**（远端 mtime `10-04 07:11`）。
    ⚠️ **别把这条读数读成"漂移缺陷"**：我拿来比的本地那枚是**主检出**的 `apps/web/dist/index.html`
    （`75B6D4E6…`，mtime `02:59`），而 ① 真正会推过去的是**载体**当场重打的那份 —— 两边本来就不同源。
    这条预检证明的只有两件事：**远端可达 + 那个路径有东西**。"远端字节 == 本次工作树"仍然只由
    `reinstall-all.sh` 那条对账判（不一致拒绝打包），我不在它之前替它下结论。
  - ✅ **09:53 ③ 这五枚补丁的合流面已经量过：零文本冲突，且合并态可以用一枚 sha 钉死**。
    把五枚按顺序 `git apply` 到**别人那份带未提交 `${f}` 行的工作树版本**（起点 `a7f6579b` / 550 行）上：
    五枚全部 `--check` 通过并干净落下 ⇒ 673 行、`bash -n` OK、合并态 sha **`df46f473…`**
    （载体那份是 `fbe0ee72…`，两者只差别人那一行，这正是应得的差别），**那一行仍然在**（`grep -c` = 1）。
    合并态整份另存 `~/.heyta-pending/notes-e2e-20261004/merged-with-others-f5line.sh`。
    🔴 **为什么这不只是"能打上"**：`step10` 那把夹具对着**合并态**复跑仍是 24 条全绿（不是只对着我那棵载体绿），
    ⇒ 第 10 步的收范围判据不依赖别人那一行，也不会被那一行弄坏。合流之后要验的三条读数是：
    行数 673、`grep -c 'evidence/${f}'` = 1、`git hash-object` = `df46f473fae55b7763c3f26165d2e9b181e703a8`。
    同轮另一条轻量现量：`pnpm check:script-snapshot` 在**当前混合工作树**里 rc=0（38 枚脚本自快照在位）
    ⇒ 这五枚落进 main 不会撞上那把被别人改过的快照门禁。
  - ✅ **09:57 载体已对齐到 main 现量 `20b9a078`，五枚补丁在上面存活 ⇒ 窗口一到，读数钉的就是当前版**。
    此前载体停在 `49e9a2fd`，而 `git diff --name-only 49e9a2fd..20b9a078` 只有 `BLOCKED.md` 与两份文档
    （`scripts/verify-mobile-notes.sh` 在两版的 blob 逐字相同 `3a9f6890…`）⇒ checkout 不会碰我那枚未提交补丁，
    实测 `RC=0`、`status` 只剩 `M scripts/verify-mobile-notes.sh`、sha 仍 `fbe0ee72…` / 673 行。
    这一步买到的东西很具体：链里的 `CARRIER_HEAD == MH` 成立 ⇒ **③ 与 ① 的读数不必再钉在旧版上**，
    而 `git diff --quiet … -- packages apps shared pnpm-lock.yaml package.json` 仍为空 ⇒ **不触发重建**（没有为此多烧一趟）。
  - ✅ **09:57 Goal ③ 点名的四条，逐条现量到行号（对象是载体那枚 673 行、sha `fbe0ee72…` 的文件）**：
    第 6 步 `:358`「恰好一条 NOTE/UPD，且载荷只有 content」＋第 7 步 `:390` 反证腿；
    第 8 步第三张截图 `:473` `shot_evidence "android-notes-3-from-search.png"`（另两张在 `:332`、`:356`）；
    第 9 步三条腿 `:520` 手机同步 / `:527`+`:530` 远端 op 计数（读不到与 0 条分开报错）/ `:539` 按 entityId 核；
    第 10 步 `:547` 服务端 scoped 计数（本轮新写的收范围判据）；第 11 步 `:602` 起笔记本解密收到同一条 UPD、
    两端 entityId 一致。**这四条不需要新写，缺的一直只是窗口**：09:56 负载 **24.08**（阈 12）、
    设备仍被 `com.heyta` pid `12027` 占着 ⇒ 链 v13 继续等；① 比 ③ 还多等一枚**别人树里**的
    `notarytool submit --wait`（它不在我的地界，不摘除、不绕开）。
  - 🔴 **10:06 读 v13 自己的对齐段读出一条真缺陷，已修成 v14 并给这条门配了夹具（8/0）**：
    v13 写的是"载体脏 ⇒ 不动它"，而**我那五枚补丁就是未提交地住在这枚文件里**（载体按设计就是脏的），
    于是这条分支永远命中 ⇒ 载体一路停在旧提交，**① 的 `reinstall:all` 会拿旧源码打四端产物**，
    直接违反 Goal ① 的"装上 HEAD 产物"；而日志只会印一句"读数钉在载体那一版"，**看起来完全像诚实**。
    v14 的判据按 blob 比：每个脏的**被跟踪**路径在 `CARRIER_HEAD` 与 `MH` 两版逐字相同 ⇒ checkout 不会
    覆盖本地改动（git 自己的规则，我只是不绕过它）⇒ 照对齐；任一脏路径两版不同 ⇒ 不硬来，
    留在当前版并把**挡住它的那条路径点名**印出来。实测两臂：正臂 `b0a6cc3b→b0a6cc3b`、
    `notes_sha fbe0ee72` 改前后逐字相同、脏仍恰 1 枚；反臂（MH=仓库根提交）**拒绝切换**且印出
    「脏路径 [ scripts/verify-mobile-notes.sh ] 在 …↔… 之间有差异」。夹具 `/tmp/heyta-align-fixture.sh`
    抽的是 shipped 那 22 行（`awk` 按注释标记取，不抄第二份实现）。
  - 🔴 **10:15 ②：环境里现量到一枚别人的 reinstall 已经跑到第 7 小时 ⇒ 顺带把链的一条"把门拒绝印成跑过"修掉了（v15）**。
    `bash /tmp/heyta-real-runner-pids.sh 'reinstall-all\.sh'` 回三行，最深那枚是 pid `93817`
    （`bash /tmp/heyta-reinstall/scripts/.reinstall-all.sh.snap.93817`，`ELAPSED=07:02:15`），
    它的直接子进程是 `package-app.sh` ⇒ **卡在 mac 段的公证那一腿**；同轮 `ri_on_device_path` 判它
    **够不着 adb**，所以设备那枚 `com.heyta` pid `12027` 不是它占的（这条别读成"它在使设备"）。
    启动器 `/tmp/heyta-run-reinstall.sh` 自己有一条对称的补门（`:110-118`：只要有任何别人在重装就
    `exit 3`，注释里写清了为什么"能证的那半条由我守"）——**这道门是对的，我没再抄第二份**。
  - 🔴 **但 v13/v14 在它的下游犯了错**：起跑 ① 之后 `say "...（rc=$?）"` 然后**无条件**写完成旗标并 `break`。
    照上面那个现量，窗口一旦开成，链会跑完 ③、撞上启动器 `exit 3`、把旗标写上、退出 ——
    **① 一次都没起跑，而日志最后一行读起来像跑过了**（§7 第 164 那一族：退出码属于包装命令）。
    更糟的是启动器在"窗口已开、只等你加 `--go` 复跑"那条路上是 **rc=0**（`:73-75`），
    所以"看 rc"这件事在这里两个方向都会骗人。
    ✅ v15 改成只认启动器真跑起来才会打的那一行 `INNER_EXIT=`：有 ⇒ 写旗标并收工；
    没有 ⇒ 打印"没有起跑 + 启动器原话"、`sleep 90` 后**下一轮重试**，并且**不写旗标**。
    夹具 `/tmp/heyta-v15-flag-fixture.sh` 三臂 + 一发变异，读数 **`pass=7 fail=0 invalid=0`**：
    A（rc=3 无 INNER_EXIT）与 B（**rc=0 也无 INNER_EXIT**）都不许写旗标；C（有 INNER_EXIT）必须写；
    变异 M（换回"只看 rc 就写旗标"）在 A 那一臂**确实写出旗标** ⇒ 新判据有牙。
    ⚠️ 这个夹具自己第一版也是坏的，而且形状值得单独记：`awk` 抽段时注入了一行 `; exit 0`
    ⇒ 每臂在**解析阶段**就死，一条断言都没跑，而末尾用 `grep -c '❌'` 数结论、日志又被每臂开头
    `: > "$LOG"` 洗过 ⇒ 只报出"3 条红"，完全看不出"其实零条执行"。
    ⇒ 现在三件必配：**每臂先 `bash -n`**、**桩必须落一枚自证 stamp**（没 stamp 记 `INVALID`，
    与红分开计且照样退 1）、**结论从计数器打印而不是从会被截断的日志里 grep**。
  - ⚠️ **上一条夹具事故的成因（"v14 夹具第一版"就是它）**：那一版用
    `bash arm.sh` 起**子进程**跑抽取段，而 `R`/`MAIN`/`MH` 只是普通变量没导出 ⇒ 段里 `cd "$R"` 展开成
    `cd ""`，而 **bash 的 `cd ""` 是 no-op（实测 PWD 不变）** ⇒ 那 22 行整段跑在**主检出**上，
    四条读数量的都不是载体。所幸 `CH0 == MH`（都是当时 main tip）使 BLOCK 为空、那次
    `git checkout -q <当前 HEAD>` 是无操作：主检出 reflog 只有 commit 没有 checkout、分支仍是 `main`、
    脏 242 / 暂存 9（10:04:44 现量）逐字未动 —— **这次没伤到别人，是运气不是设计**。
    ✅ 改法两处：抽取段一律 `source`（同 shell ⇒ 变量可见，`set -u` 还能拦住漏名），
    并且每臂挂一条**"装置到底跑在哪棵树上"的正向对照**（臂前记载体 HEAD、臂后要求段自己的输出里出现它），
    外加一条跨臂的"主检出 HEAD|分支|脏数改前后逐字相同"守卫 —— 这三条都在本版夹具里，8/0 是带着它们量出来的。
  - 🔴 **10:26 记账的"提交方式"本身换掉了，因为发现我这一侧一直在吞别人的行**：
    `heyta-plumb-0835.sh` 用的是**整枚工作树文件的 blob**，而这一枚台账是多人共写的 —— 工作树第 106 行
    正躺着别人把 iOS 状态从"续验中"改成"模拟器投递闭环已验…"的**未提交**改动。那一次 `numstat` 读成 `25/3`，
    三条删除里有一条是他的 ⇒ 照旧提上去会把他的改动算进我这一笔、还把它从"未提交"里抹掉。
    ⇒ 新程序 `/tmp/heyta-plumb-blob.sh`（已归档）：**基线取 `git show HEAD:<file>`**，只把我的那段换进去，
    逐条核"删除行的归属"（不是我写的就 GUARD_FAIL），提交后要求"他那行仍在 HEAD 里 + 工作树相对新 HEAD 只剩 1/1"。
    ⚠️ 形状守卫 `N/0` 单独不够：它挡得住"别人改了行"，挡不住"别人整块插入、行数被算进我这一笔"。
    本夜我那 12 笔提交按 hunk 形状逐笔回查过（单文件、1–2 个 hunk、行数与我自己写的那几段一一对上），
    **没有量出被吞的别人段落**；旧脚本已改成对多写者台账直接 `REFUSE`（实测 `REFUSE_RC=1`）。
  - ✅ **10:27 装置落盘位置补齐**：`~/.heyta-pending/notes-e2e-20261004/` 现在 41 枚，新增归档 10 枚
    （链 v15 `29a2524d`、核身函数 `2afb2898`、三把夹具 `86b5522a`/`391c2bc1`/`6cfff75f`/`7c66474c`、
    重装启动器 `42f0c64c`、真运行者解析器 `46967a01`、新提交器 `cd5af719`、APK 预备 `f04fcad7`）。
    理由不是整洁：**这些定义只住在 `/tmp` 的话，一次重启就把"这条读数是怎么量出来的"整条抹掉**，
    下一个人只能从我写的读数倒推装置（那就是主张而不是证据）。运行中的链仍在 `/tmp`（重启即停是预期行为）。
  - 🔴 **10:33 ③ 的输入基线自己动了 —— 那条"合流之后要验的三条读数"在 40 分钟内就被用上并量到了**：
    别人那一行 `${f}` 的改动随 `35dbffe9` 落进 main，`scripts/verify-mobile-notes.sh` 的 blob 从
    `3a9f6890` 变成 **`a7f6579b`**（仍是 550 行，HEAD 里 `step10-scoped` 命中 0 处 —— 那五枚是我的，不是他们的）。
    于是"当前 main + 我那五枚"的合并态**不再是载体那份 `fbe0ee72`，而是 09:53 合流实验早就算出来的
    `df46f473`**（673 行）。三条读数逐条复量：行数 673 ✅、`grep -c 'evidence/${f}'` = 1 ✅、
    `git hash-object` = `df46f473fae55b7763c3f26165d2e9b181e703a8` ✅（正是那句"合流之后要验的三条"预测的那枚 sha）。
    载体已按这条路重对齐：`git checkout -- scripts/verify-mobile-notes.sh`（备份 `/tmp/backup-notes-fbe0ee72.sh`）
    → `git checkout fc324e12`（此时工作树干净，切换成功、基线回到 `a7f6579b`）→ 从持久合并态覆盖回来
    → `bash -n` OK、收范围腿 `step10-scoped begin` 命中 1 处 → **`heyta-step10-fixture.sh` 对着这份活载体文件复跑：
    `FIXTURE=GREEN`，变异存活 0 / 无效 0**。第 10 步那条判据不随基线漂移。
  - ✅ **10:35 链升到 v16，两处改动**：
    ① 核身门的"目标身份"换成 `df46f473` + 持久件 `merged-with-others-f5line.sh`（不换就会在每一轮
    拿旧身份 `fbe0ee72` 去比新基线而**永久拒绝起跑 ③** —— 拒绝是安全的，但读不出来就等于白等）；
    ② ① 起跑前**现取并显式指定 iOS 模拟器**（`heyta-iphone-17pro`）。这一条是代拍，理由写进链里：
    启动器自己挑的是"占用表里第一台空闲的"，10:33 现量四台 booted **全部** `running_heyta=0`，
    列表第一台是 `heyta-batch2-closeout` —— 倒数纪念日那条线的现场，而重装 ios 段会 `uninstall` 目标。
    依据＝本条线历史上 ① 用的就是 `heyta-iphone-17pro`（台账两处 `IOS_DEVICE_NAME` 读数）；
    回退＝去掉那一个环境变量即可回到启动器默认行为。占用判据复用仓内那把 `ios_occupancy_table`
    （`/tmp/heyta-device-occupancy.sh`，与启动器同一份实现，不另写第二把）。
  - ⚠️ **10:31 按 §5 的指示改用仓内闸门判窗口**（"判据 = `verify-mobile-window-gate.sh --target b` 退 0，别再自己数负载"）：
    载体里两把都跑了，`--target b` 与 `--target c` 各 **rc=3**，唯一不成立的那条是负载
    （现量 1 分钟 22–26 / 阈值 12）；`packages/ apps/ server/ 无未提交修改` ✅、`reinstall-all.sh 干净` ✅、
    设备名现取 ✅。⚠️ 一处探针教训：闸门报"负载 26"而我 `uptime` 读到 17–20，同刻并读
    `sysctl vm.loadavg` 与 `uptime` 得到 **22.79 / 26.26 / 40.52** —— 差在采样时刻而不是读法，
    两边都是 1 分钟值且都 >12，所以不构成"哪个探针坏了"，但**别把两个时刻的数当同刻比**。
    🔴 这条闸门对我那枚未提交的 `scripts/verify-mobile-notes.sh` **不算阻塞**（它只扫 `packages/ apps/ server/`），
    所以五枚补丁住在载体里不影响窗口判定。
  - 🔴 **10:39 ③ 服务端那一侧的归属要写成"进程"而不是"文件"，这条已经现量完并把结论落到 ③ 的读法上**：
    `:3100` 的监听者是 **pid `26407`**（`node dist/src/index.js`，cwd = 主检出的 `server/`，父进程 `launchd`），
    起跑时刻 **06:02:44**；而 `server/src` 在那之后有两笔提交（`31031b23`、`fcff5bbb`），
    `server/dist/src/index.js` 的 mtime 是 **10:34:49**。⇒ **文件是新的，进程不是**：
    我链上那条"比自身源码旧的 .ts = 0"量的是**磁盘新鲜度**，它看不见"重建过但没重启"，
    于是会把"跑着旧代码的进程"印成"当前构建"（与 §7 第 164 那族同形：读数与结论隔了一层）。
    复核办法（下次直接跑，别抄我这句）：
    `lsof -nP -ti tcp:3100 -sTCP:LISTEN` 取 pid → `ps -o lstart= -p <pid>` 与 `stat -f %Sm server/dist/src/index.js` 比先后。
    ✅ **这两笔对 ③ 是否构成失效：逐笔 diff 量过，不构成**——
    `31031b23` 在 `snapshot-generation.service.ts` 上只把 `REPLAY_OPERATION_SELECT` 从 `const` 改成
    `export const` 并加注释（该文件 +12/-1，运行期形状未变），改的是 `server/scripts/recover-user.ts` 那条运维路径；
    `fcff5bbb` 在 `server/` 下只动了 `src/legal.generated.ts`（生成物，法务文案），也不在 sync 路上。
    所以 ③ 用到的那三段（上传响应搭车、下载 delta、operations 落库）由这个进程做的仍然成立，
    但**台账里要按"服务端进程=06:02 那份构建"来写**，不写"服务端=main 当前构建"。
    ⚠️ 顺带一条否证：我原想"让 ③ 打到自己那棵载体的服务端上"以躲开这个归属问题 ——
    现量 `heyta-wt-reinstall/server/.env` **不存在**（主检出那份有 15 个键），载体起不来自己的服务端；
    而把 `:3100` 那个进程重启掉会打断此刻正在跑的并行走查（设备 `com.heyta` pid 刚 12027→14944），
    按 §8.9 与"只对自己创建的对象动手"，两者都不做，改为把归属写准。
  - ⚠️ **10:41 `check:docs` 此刻是红的，而且这条红不在我这一笔、也不在 `HEAD` 里 —— 记下来免得下一个人把它读进 §7.30**：
    三条死链都在 `docs/adr/0051-mobile-reminder-delivery.md:202/203/205`，指向
    `apps/mobile/evidence/ios-reminder-pending{ -before,-after-delete,-after}.png` 三枚**未跟踪**截图。
    两条现量把它定性：① `git show HEAD:<那份 ADR> | sed -n '202,205p' | grep -c ios-reminder-pending` = **0**
    （那三行是他们**未提交**的编辑，`git status` 里这枚文件是 `M`）；② 临时 `git worktree add --detach …  HEAD`
    里跑同一个 `docs-link-check.mjs` ⇒ **exit 0**（干净检出没有这条死链）。
    ⇒ 这是"只在混合工作树成立"那一类红：等 W9/iOS 提醒那条线把三枚截图与 ADR 一起提交就自己闭合，
    关闭判据是 `pnpm check:docs` 退 0；**我不代改他们的 ADR，也不把未跟踪的截图替他们 `git add`**（§8.9 + 只对自己创建的对象动手）。
- ✅ **05:3x ⑤ 复核**：`B41/B42/B45` 三行仍在 §7.28 那张「完成条件逐条的现量与差什么」表里（`:1220`/`:1221`，状态 🟡，
    各带自己的现量命令），本夜落笔的六笔只改了 `scripts/verify-mobile-notes.sh` 的第 12 步与
    `apps/desktop-macos/scripts/package-app.sh` 的公证段，加上四份文档，
    **没有翻任何冻结判据、没有动服务端面** —— 这三项按边界继续保持登记。
- 🔧 **10:4x 装置归档：把"重建 HEAD+只含我的行"这一步从纪律改成一条脚本** ——
    `~/.heyta-pending/notes-e2e-20261004/heyta-rebuild-blob.sh`（`shasum -a 256` 前 8 位 **`594ee0c4`**，同目录有副本，不在 `/tmp`）。
    动机不是整洁，是本会话里我**两次**拿工作树整份重建 blob，把别人那行 iOS 状态算进了我这一笔
    （numstat 当场报 `25/3`、`9/1` —— 多出的那 1 增 1 删就是他的），两次都靠"逐条核删除行归属"才没提上去。
    纪律会累、脚本不会：四条判据是 基线只取 `git show HEAD:<file>` · 锚点在基线里**必须恰好出现一次**
    （0 次与多次都停下，不猜位置、也不落到"最后一行"）· 重建后逐行回验"基线没有一行丢失" · 差集删除数必须为 **0**。
  - 三条臂现量（10:42）：臂 A（正）`BASE=2352 NEW=2354 BLOCK=2 基线丢行=0` + `BLOB_DELTA=2/0`；
    臂 B（锚点不在 HEAD 基线里）`FAIL=锚点那一行不在 HEAD 基线里（不猜位置、不落到"最后一行"）`，退 **1**；
    臂 C（对照：把工作树整份重建那个形状喂进去）报 `工作树 vs HEAD = 1/1` ——
    那 1 删就是别人那行，所以臂 C 证明的是**这台机器的工作树此刻确实带着别人的行**，不是证明脚本能跑。
- ⚠️ **10:4x ①③ 的窗口现量（等待回合只做零 CPU/零写盘的读数）**：链 v16（pid **72099**，已跑 8 分半）第 12 轮仍停在
    "设备在线但不空闲"，每轮读数 `android [emulator-5554] pidof_com.heyta=[14944]` +
    `mCurrentFocus=Window{… u0 com.heyta/com.heytamobile.MainActivity}` ⇒ 并行那条线还占着设备做界面走查。
    按 §8.9 我不杀、不绕、不降级判据，③ 与 ① 继续等窗口；① 另比 ③ 多等一枚**在别人树里**的
    `notarytool submit --wait`（不在我的地界，不摘除）。
- 🔧 **10:5x 读自己那份核身函数读出一个洞，修完并把夹具从 8 臂/5 枚升到 10 臂/7 枚**（这条是探针缺陷，不是产品缺陷，但它会让 ③ 的读数说谎）：
    v12 的自愈门是「载体那份 `have` == **现取**的底 `BASE_BLOB` ⇒ 允许 cp 覆盖」，而链自己会把载体 checkout 到更新的 main ⇒
    main 一推进，载体里那枚文件**就等于那枚新底**，`have == 现取底` 恒成立 ——
    **门在最该拦的那个情形下恰好放行**：cp 把 09:53 从旧底推出来的合并态盖上去（= 把补丁回退到新底之前），
    然后打印「覆盖后核身通过」。后果是读数记在"当前 main"名下、跑的却是旧脚本，日志与前者逐字同形（§7 #27/#82 那一族，这次是探针自己造的）。
  - 修法：`identify_notes_input` 加**第 5 参 = 这份合并态当初推导自哪一枚底**（写死 `a7f6579b…`，**不现取**）。
    自愈只允许在 `现取的底 == 推导时的底` 时发生；不相等 ⇒ 响亮拒绝并给出下一步（把四个补丁重推到新底）。
    第 5 参为空同样拒绝 —— 没有可核对的身份时去覆盖，那就是 v11 已被否证的形状。
    🔴 原臂 7b 把这种退化行为**记成了期望**（`rc=0`），已翻成 `rc=1`；这类"把当前行为当期望"的臂是最贵的，因为它把洞钉成规格。
  - 现量：未变异 **10 臂 30 条全绿**；七枚变异**各自转红**、无效 0 枚 ——
    M6 摘掉门 A ⇒ 臂7b 红，**M7 摘掉门 B（就是那个洞）⇒ 臂9 立刻放行并把新底覆盖掉**，这条变异抓的正是我要防的动作本身。
  - 顺带一条会复现的夹具坑（它第一趟就是红的）：`derived="${4:-$BASE_SHA}"` 里的 `:-` 把**显式传空**也回退成默认值，
    于是"没声明推导底"那条臂根本没走到被分支，看着在测、其实测的是默认路径 ⇒ 改成 `${4-$BASE_SHA}` 之后它才真的红过、修完才绿。
  - 归档（都在 `~/.heyta-pending/notes-e2e-20261004/`，不在 `/tmp`）：判据本体 `da35620e` · 夹具 `e7364ddc` · 链 v17 `bcec3c79` · 重建器 `594ee0c4`。
    链 **v17 pid 98085** 已接管等待（v16 已停；停前现量它只有一个 `sleep 45` 子进程，不持有设备与端口）；
    单次实调对当前载体判 `③ 输入已核身 sha=df46f473… 行数=673 / RC=0`。
  - ⚠️ **待入 traps 的一条**（取号按工作树最大号，不按 HEAD；并发追加不抢号）：
    **自愈/覆盖类前置如果与被它保护的动作同源**（都取"当前 HEAD"），它在被保护对象刚发生变化的那一刻**恰好放行** ——
    前置必须引用一个**不随被保护对象移动**的锚（这里是"推导时的底"），否则它只在"什么都没发生"时成立。
- ⚠️ **10:54 窗口现量（等待回合仍只做零影响读数）**：`loadavg 23.29` / 阈值 12；`:3000 :3100 :4318 :4319` 全被占（4322 空闲）；
    03:12 起跑的那条重装仍在 `notarytool submit --wait`（pid 98934，已 7h41m）；
    设备 `pidof com.heyta` 从 14944 变成 **17339** ⇒ 并行那条线的走查**正在动**，不是遗留进程。
    ⇒ ①③ 继续等窗口；不杀、不绕、不降级判据（§8.9）。
- 🔧 **11:0x ③ 的"换底"从手工重推补丁改成一条命令**（`~/.heyta-pending/notes-e2e-20261004/rederive-notes-onto-new-base.sh`）：
    上一条那道门修好之后，链在 main 推进时会**正确地**拒绝起跑 ③ —— 可"正确拒绝"不等于"能继续"，
    下一件事一定是"把我的五处改动合到新的底上"。原来的做法是按 `.patch` 文件手工重放，而
    **补丁的顺序与落点是我用记忆维护的**，记错就产出一份"看起来对"的脚本；改成 `git merge-file` 做三方合
    （共同底 = 合并态推导时那枚 blob / ours = 我的合并态 / theirs = 新底），它只在**真的交叠**时才带标记失败，
    不会静默合错。三条臂的现量（全部在临时 git 仓上跑，没动主检出与载体）：
  - **臂1（重放对照，最硬的一条）**：新底 == 共同底 ⇒ 输出必须**逐字节等于** `df46f473`。实测
    `共同底=a7f6579b（550 行）/ 我的=df46f473（673 行）/ MERGE_FILE_RC=0 冲突块=0 / RESULT_SHA=df46f473… 行数=673 / 重放一致=是`
    —— 这一条同时否证了"三方合会不会吃掉我的改动"这个担心。
  - **臂2（上游在不相干处推进）**：theirs 末尾加一行不相干注释 ⇒ `MERGE_FILE_RC=0 冲突块=0`，
    产物与我合并态的差集 `DIFF_ROWS=1`，且那一行正是上游那句（`673a674`）；并打印出**可直接粘进链的两行**（新 RESULT_SHA + 新底）。
  - **臂3（上游改在我删过的那行上）**：把 `ok "服务端 NOTE/UPD op 数 = …"` 改掉 ⇒
    `MERGE_FILE_RC=1 冲突块=1 / CONFLICT_RC=4`，脚本报"交叠了、不产输入"并把带标记的整份文件**落进归档**
    （实测 `conflict-on-714c6ab5.sh`：684 行 / 标记 1 / 含 theirs 措辞 1 处），验完即删。
  - 🔴 这条臂3 第一次实现时**印的是一个指向不存在文件的路径**：`CONFLICT_KEEP=$P/ours.sh`，而脚本自己的
    `trap 'rm -rf "$P"' EXIT` 在退出时就把那枚目录删了 —— 下一位照着打开只会得到"文件没了"，
    而那句看起来像"我留了东西给你读"。已改成落盘到归档目录再报路径（臂3 复跑即证它存在）。
  - ⚠️ 我这趟量具自己先坏两次，两条都已经在台账里过、但仍重犯：
    ① **`node -e '…'` 载荷里的 `!` 被宿主 shell 转义成 `\!`** ⇒ `SyntaxError: Expected unicode escape`，
    文件一个字没改，于是臂3 读成"冲突臂 rc=0 / 冲突块=0"——**假的是量具，不是被测物**；
    ② ESM 脚本里我把路径读成 `process.argv[2]` 却多传了一个占位实参 ⇒ `ENOENT: open 'x'`，
    同一条臂又空跑一次。两次都是**"期望红的那一条读成了绿"**方向，靠 `APPLIED=1 命中数已断言` 这类
    落笔自检才分得开 —— 改文件的探针必须打印"我确实改了 1 处"，否则"没有冲突"与"没造出冲突"同形。
- 📌 **11:0x 窗口读数（等待回合）**：链 v17（pid 98085）继续按 90s 一轮判窗口；
    设备仍被并行那条线持有（`pidof com.heyta` 14944 → 17339，值在变说明它活着且在操作），
    `:3000/:3100/:4318/:4319` 依旧被占，03:12 起跑那条重装的 `notarytool submit --wait` 已 7h45m。
    ⇒ ①③ 未起跑，本轮全部产出都是**不碰设备与端口**的装置工作。
- 🔴 **11:0x 现量到共享台账一处真的完整性缺陷，但它已经有主 —— 记归属而不是另起一套**：
    `docs/reference/environment-traps.md` 里 **`#38 / #93 / #94 / #95` 四个号各被两条不同条目占用**
    （工作树行号 `:716` vs `:787`、`:2455` vs `:2894`、`:2496` vs `:2913`、`:2524` vs `:2945`），
    **HEAD 里就已如此**（`条目行总数 HEAD=237 / 工作树=241`，重号集合两边相同 ⇒ 不是别人在飞的编辑造成的）。
    后果是 AGENTS §7 那种「§7 #93」的引用**现在是有歧义的**（一条指手写解析器自误、一条指 Prefab/JDK 24），
    而文件自己的规则写的是"编号只增不改"。
  - **归属现量**：`docs/plans/ai-event-tool-contract.md` 那条线**已经量过并写过不当场改的理由**
    （`:1708` 逐行对照两处、`:1710` 承认引用有歧义、`:1713` 指出"改号要挑哪一枚让号，而 32 处引用…"、
    `:1218` 把它列进自己的收尾项）。⇒ **我不再写第二个改号方案**：两处各自重排编号 = 在同一枚正被
    别人整片编辑的台账上造一次没人能干净解的三方冲突（与 §8.9 同一条理由）。
    关闭判据挂在那条线：`grep -oE '^[0-9]+\. ' docs/reference/environment-traps.md | tr -d '. ' | awk '$1>=20' | sort -n | uniq -d`
    输出为空 **且** 有一条常驻门禁做同一件事（目前全仓没有检查重号的门禁，这句本身就是待办）。
  - ⚠️ **对我自己那条"取号"命令的直接影响**：`sort -n | tail -1` 只保证不撞**最大号**，挡不住
    像 38/93/94/95 这种**中段**重号 —— 所以我那两条待入条目取号时，除了取 max+1，
    必须同时把上面那条 `uniq -d` 的输出抄进读数里（现在它是 `38 93 94 95`）。
    台账"编号只增不改"的不变量，靠取号命令的一半是守不住的。
- ⚠️ **11:05 一条我这一侧挡不住的残余风险（写下来，不假装解决了）**：
    共享资源独占的门是**不对称**的。我的重装启动器起跑前会查"有没有别人正在重装"（按 argv 形状判，
    正反对照都验过），所以**他们先跑 ⇒ 我让**；反过来**我先跑 ⇒ 他们的队列不会让** ——
    11:06 逐行读 `/tmp/queue-reinstall-all.sh`（只读）确认它的前置只有三件：
    `:15/:19` 等**它自己那三条链**（`publish-landing-from-carrier|carrier-full-check|queue-verify-selfhost-stack`）、
    `:30` `adb devices` 列一眼在线设备、`:34` `ssh windows-pc` 可达性 ——
    **没有"别人正在重装"这一道**（而它自己 `:22` 的注释正写着"重装会 uninstall/reinstall，抢不得"，
    说明这个面它承认，只是没做门）。它跑在 `/tmp/heyta-reinstall` 这枚载体里，与我的 `heyta-wt-reinstall`
    不是同一棵检出 ⇒ **不共享安装目录，但共享模拟器与 windows 打包机**。
    两台装包动作并发时互相卸载的正是对方刚装好的产物，而四张截图会各自拍到"另一台包"的界面。
  - 我**不改他们的脚本**（§8.9 + 只对自己创建的对象动手），也**不去掉自己这道门**去抢跑。
    这一条能做的只是把事实交给读得到它的人：另一条线在 `BLOCKED.md` **B76**（10:57 笔）里已经在等
    同一个窗口，且它引用的提交里有我这一夜的 `240c1051` ⇒ 这本台账是它读的通道。
  - 现量（11:06，全部自己取，不抄 B76）：他们的 mac 腿 `pid 93772` `etime 07:54:02 / 累计 CPU 0:00.32`、
    `98934 notarytool submit --wait` 同一枚 DMG（`/tmp/heyta-macos-dist/Heyta-1.0.0.dmg`，mtime **03:13** 后再没写过）；
    `loadavg 21.94`（阈值 12）；`:3000/:3100/:4318/:4319` 仍被占；设备 `pidof com.heyta=17339`。
  - 🟢 顺带一条**已确认不必担心**的（免得下一个人去补）：`scripts/reinstall-all.sh:182-183` 的第 0 步就是
    `pnpm -r build` ⇒ 载体里那批 03:58–05:33 的 `packages/*/dist` **不会因为链把载体推进而变成旧 bundle**
    （traps #27 那一族在这条流程里被上游步骤挡住，不需要我在对齐后再补一次构建）。
- 🔧 **11:1x 把 ③ 的"服务端归属"重新量一遍（我 10:4x 写的那组时刻已经漂了），并且顺手拆掉一枚我自己的一次性坏探针**：
    `:3100` 的进程还是 **06:02:44** 那台（`cwd=主检出/server`、`ppid=1` 孤儿 ⇒ 祖先链判不出归属，
    按"只对自己创建的对象动手"**不重启它**），但 `server/dist/src/index.js` 的 mtime 现在是 **11:06:39**
    —— 别的线在这一分钟里重建过服务端产物。我 10:4x 记的"dist 10:34"因此是**过期读数**，以本条为准。
  - 🔴 **先纠一个我自己的探针错**：刚才一次性量"比自身源码旧的 .ts 数"时我拿的是 **`server/dist` 目录**的 mtime
    （`09-25 14:45`）⇒ 报出 **77 个 .ts 比产物旧**，那是假的：目录 mtime 不随内部文件重写而变。
    换成真实产物 `dist/src/index.js` 作锚 ⇒ **0**。链里那两行（`:125`、`:171`）**本来就用的是产物文件**，
    坏的是我这次手敲的复测 ⇒ 结论没被它污染，但这条要留着：**"产物新不新"只能用被消费的那枚文件比**。
  - 06:02 之后动过 `server/src` 的只有三笔（`0d019a06` 10:53 / `31031b23` 10:11 / `fcff5bbb` 10:11），
    落到**两枚文件**，逐条判它够不够得着 ③：
    · `snapshot-generation.service.ts` —— 它生成的**唯一调用点**是 `GET /api/sync/restore/:serverSeq`
      （`sync.routes.ts:704-729` 现量），而 ③ 的脚本**自己一个字 HTTP 都不发**（`curl` 命中 **0**）；
      客户端侧的 op 上行是 `POST /api/sync/ops`（`packages/sync-client/src/client.ts:1550`），
      另外全仓（排除产物、测试、服务端自己的路由）对 `restore/` 的命中只剩两句无关注释
      ⇒ **没有任何客户端会打这枚路由**，不只是 ③ 离路。
      和 `recover-user`（`31031b23`）共享的那份是 `REPLAY_OPERATION_SELECT` 常量，不是生成路径。
    · `legal.generated.ts` —— 10:53 那次确实把 `LEGAL_SET_VERSION` 的 `personal-info-list@1.1 → 1.2` 推进了，
      但服务端把版本钉成 `isOfficialHostedInstance(publicUrl) ? LEGAL_SET_VERSION : null`
      （`legal-consent.ts:69`，谓词本体 `:45-52` 要求 hostname **等于**官方托管域），
      而这台验收栈 `PUBLIC_URL=http://localhost:1900` ⇒ 取 **null**；
      客户端侧在非产物目录里对 `LEGAL_SET_VERSION` 是**零消费者**（首启隐私同意面板不比较这个值）⇒ 同样**离路**。
  - ⇒ **可用的结论**（也是 ③ 读数的边界声明）：在 `:3100` 这台上跑出来的 ③ 不会因为"进程早于当前源码"走错分支；
    读数仍要带三元组（进程时刻 / 产物时刻 / 载体 HEAD），**不能写成"服务端 = 当前源码"**。
- 🔴 **11:13 规范闸门的判词（①③ 卡点的权威读数，也是"下一步不是等"的出处）**：
    `bash scripts/verify-mobile-window-gate.sh --target b` 现量输出 ——
    `REDS=load,src,dev`，逐条是：
  - `✅ 没有别的移动端验收在跑` —— 设备面**不是**被别人占着。我这侧看到的 `pidof com.heyta=17339` 是
    **10:5x 那趟 `verify-mobile-card-export.sh`（pid 30573，跑在 `heyta-wt-batch2` 载体里）结束后遗留的前台进程**，
    驱动方 11:12 现量已消失。我的链把"app 在跑"当占用，比规范闸门**更严**（`pm clear` 会把这个前台清掉，
    而如果此刻是人在模拟器上自己看着它，那就是砸别人的现场）⇒ **这条保守我不松**，
    但要把"闸门说设备空闲、我的链说不空闲"这处分歧写明：两边都对，取的是不同的安全边际，
    后来者读到"③ 一直没起跑"时不要以为闸门放行了。
  - `❌ 有另一趟 reinstall-all 在跑（pid 93817）` + 🔴 **装置自己判它楔住了**：
    `叶子 pid=98934 已活 28810s 而累计 CPU=0s`，卡在 `notarytool submit … --wait`；
    原话是 **"下一步不是继续等窗口：等它是零产出，而它随时可能醒过来动设备"** 与
    **"本装置不杀、不接管（那不是本线的进程）；要人拍板"**，复跑命令也给了
    （`ps -p 98934 -o pid=,etime=,time=,command=; pgrep -P 93817`）。
    我 11:06 的另一条现量与它一致：`93772 etime 07:55:01 / CPU 0:00.32`、
    DMG `mtime 03:13` 之后再没被写过 ⇒ 这不是"快好了"，是没有进展。
  - `src` 那条红是别人未提交的源码（闸门扫 `packages/ apps/ server/`），`load` 那条是 `13.68 > 12`。
  - ⇒ **对 Goal ①③ 的诚实结论**：这两项在"不杀别人的进程、不接管别人的重装"这组边界内**不可由等待达成** ——
    挡它的那一趟已经不消耗 CPU、只等 Apple 侧回话，而它一醒就会动设备与打包机。
    需要拍的是**一件具体的事**：那枚 `notarytool submit --wait`（pid 98934，父 93817，属另一条线）要不要中止。
    我不替别人决定，也不绕过它去抢窗口（§8.9 + 只对自己创建的对象动手）。
- ✅ **11:15 ③ 那四条点名的判据，其装置当场全部离线复验过**（不等窗口就能证的部分先证掉，窗口里只剩那一趟完整读数）：
    · `heyta-step10-fixture.sh` —— 第 10 步服务端计数按本轮 `entityId` 收范围：`FIXTURE=GREEN`，
      变异 M1 精确抓到"抽出的块里没有 `entity_id=…${NOTE_ID}` 那一段"。
    · `heyta-phonesync-fixture.sh` —— 第 9–11 步跨设备那三条腿：`PHONESYNC_FIXTURE_PASS=1`
      （4 臂 + 1 枚变异、**18 条断言**全绿，被测函数体取自 lib 本体）。
    · `heyta-searchgate-fixture.sh` —— 第 8 步那条"搜索命中的是便签而不是任务"的已知会红的腿：
      `SEARCHGATE_FIXTURE_PASS=1`（3 臂 + 1 枚变异、10 条断言；变异照出"空树被报成产品缺陷"）。
    · `heyta-ev-fixture.sh` —— 第 8 步第三张截图的前置（焦点/空态那条 case）：`EV_FIXTURE_PASS=1`
      （4 臂 + 1 枚变异：把 case 顺序改坏 ⇒ "读不到"塌成"别的 App"）。
    · `heyta-dump-fixture.sh` —— 第 6/7 步 op 判据的读取装置（`uiautomator dump`）：`FIXTURE_PASS=1`
      （基线 9 臂全绿 + **5 枚变异各自定点照红、范围外零打坏**）。
    五份都在 `~/.heyta-pending/notes-e2e-20261004/`，跑法就是 `bash <夹具>`，**纯 shell、不碰设备与端口**。
  - ⚠️ 顺带一条我自己刚踩的：第一趟我用 `grep -E 'pass=|fail=|GREEN'` 去收判决，四条夹具那一栏**全空**，
    差点读成"这四个没跑 / 跑了没结论"—— 它们印的是大写 `PASS=1`，**是我的 needle 没匹配，不是被测物没输出**。
    ⇒ 收读数前先 `tail` 一眼产物；needle 要抄被打印那一句的字面形状（§7 那条"0 命中先怀疑探针"的又一次现形）。
  - ⇒ ③ 的缺口现在**只剩"窗口内那一趟完整读数"**（第 6/7 步 op、第 8 步第三张图、第 9–11 步三条腿），
    "判据本身有没有牙齿"已经不由那一趟来回答了。
- 🔴 **11:2x 查出一条"没人认领的缺口"，写好判据却因主机的内存闸门没能落**（这条是给 Goal ① 的四张截图兜底的那半）：
    · 现量：`grep -cE 'countColor|countBrandBlue|HEYTA_BLUE' scripts/screenshots/png-stats.test.mjs` = **0**，
      而 `grep -rln 'countBrandBlue|countColor' scripts apps/*/scripts` 显示它的消费者正是
      **`scripts/reinstall-all.sh`（① 那四端的判据本体）** 与 `apps/desktop-macos/scripts/package-app.sh`。
      也就是说：**"装上来的是不是 heyta 的界面"这条判据（§7 第 82 条换来的那半）自己没有任何常驻用例** ——
      采样密度退回去（20 万点 → 2 万点）、容差被改、暗色那一支被摘掉，产出的都是一个像样的小整数，
      没有任何一层会失败。元规则 2 的形状。
    · 我按现有文件的两层结构补了 **4 条判别对**（候选件：`~/.heyta-pending/notes-e2e-20261004/png-stats.test.with-brandblue-cases.mjs`，
      sha8 **`4030f106`**，相对 HEAD 是 `66/1`，那 1 删就是被我替换的 import 行）：
      ① 1200x800 白底上放一块 **24x24** 主蓝 ⇒ 命中数不只 `>0`，还要 **≥20**（判据真实用的阈值，从被约束常量推，不写死"看起来像"）；
      ② 暗色那张：浅色支必须 **0**、暗色支必须 **>0**（证明两支不互相顶替，"只验一套主题"是 §7 第 83 条那种错）；
      ③ 🔴 **错误屏判别对**：复刻"找不到共享 UI 产物"那张（浅底 + 深灰标题/正文块），
        断言 `looksBlank === false` **且** `contentRatio > 0.01`（前提："非空白"这条确实放过它）
        而 `countBrandBlue === 0`（结论：拦住它的只能是品牌蓝）；
      ④ 容差边界：`r0 + HEYTA_BLUE_TOLERANCE` 算命中、`+TOLERANCE+1` 必须不算（阈值要有边，且从常量推）。
    · **为什么没落**：`node --test` 被本机 `~/.tfa-shield` 的**内存闸门**挡回 —— 锁 `/tmp/tfa-test.lock`
      的持有者是 `pid 72717`（`/bin/sh ~/.tfa-shield/bin/node --test /Users/rocalight/scratch-owner-transfer/rbac-…`，
      11:19 起，不是我这条线）。它给的 `TFA_ALLOW_CONCURRENT_TEST=1` 我**不用**：那道门是防整机 OOM 的
      （并发 `node --test` 能把单进程推到 1.8–26GB），为了一趟离线复跑去摘机器级保护，代价不落在我身上、落在别人的现场上。
      ⇒ 未验证的判据不进仓库（AGENTS §8.3「不能失败的检查没有价值」的反面是"没验过会不会失败的检查也没价值"），
      所以我把工作树那枚文件**还原到 HEAD**（`cmp` 证工作树==HEAD、脏计数 0），候选件留在归档，
      等测试通道空了就落 + 跑两枚变异（把 `sampleStep` 改粗、把容差改成精确相等）证它有牙。
    · ⚠️ 顺手又踩一次自己记过的坑：第一趟我用 `grep -E '^# (tests|pass|fail)'` 收判决拿到**空输出**，
      差点读成"套件没跑"——实际是主机闸门在**跑之前**就退了 1，真消息在 stderr 里。
      ⇒ `> log 2>&1; echo EXIT=$?; tail` 这一套要无条件走，不能只在"看起来该有输出"时才走。
- ⚠️ **11:2x 撤回我 11:13 写的一句归因（它当时是我论证"我的链比闸门严"的前提，现在前提没了）**：
    原句是「我这侧看到的 `pidof com.heyta=17339` 是 10:5x 那趟 `verify-mobile-card-export.sh` 结束后**遗留的前台进程**，
    驱动方 11:12 现量已消失」。**11:20:49 被否证**：app 的 pid 仍是 17339，但
    `mCurrentFocus` 的窗口令牌从 `Window{830af6e …}` 换成 `Window{9f869c7 …}` ⇒ **界面上新开了一个表面**，
    也就是说那台设备此刻**正在被使用**，不是一个静态残留。
  - 两条要分开说清，别一起撤回：
    ① 闸门那句 `✅ 没有别的移动端验收在跑` **仍然成立** —— 它查的是宿主机侧的验收进程，那一刻确实没有；
       所以"占用"这件事的真身是**人/agent 在直接操作模拟器**，这类使用天然不留下闸门认得的进程。
    ② 我那条保守判据（`app 在跑 ⇒ 设备不空闲`）**因此被证实是站得住的那一侧**：
       如果我 11:13 按"反正闸门说空闲"去放宽它，`pm clear` 就会砸掉一个正在被人看的现场。
       ⇒ **闸门绿不等于设备可动**；这条分歧的正确读法是"两边测的是不同的东西"，不是"我这条太严"。
       （11:13 那条里"我的链比规范闸门严，后来者不要以为闸门放行就该起跑"这句仍然可用，只是我给的**理由**错了。）
  - 🔴 一般规律（进我这条线的固定动作）：**"进程在不在"只回答"有没有人开车"，不回答"车是不是在动"**；
    判设备可动要再叠一条"界面状态在变"的证据（焦点窗口令牌 / `mCurrentFocus` 逐轮对照），
    我 11:05→11:20 三轮读数正好是同一枚 pid 上两个不同令牌 —— 只看 pid 就会把"有人在用"读成"遗留"。
- ✅ **11:2x 那四条待落断言的"前提"已经用一次轻量探针量过了**（不是跑套件 —— 通道锁还在别人手上，我没摘那道机器级门；
    走的是 `magick` 造图 + 直接 import `png-stats.mjs` 读数，一次约一秒、几百 MB 都不到，不是它防的那类并发套件）：
    · `small`（1200x800 白底 + 一块 24x24 主蓝）⇒ `brand=144 / light=144 / dark=0` ⇒ 断言①的 `≥20` 有 7 倍余量，
      而它同时 `looksBlank=true` —— 这正好把"采样密度是承重"这句话量化了：**小元素在 20 万点采样下还剩 144 个命中，
      退回 2 万点就只剩个位数**（§7 第 82 条当年写的是"2 万点只命中 4 个"）。
    · `dark`（整张 `rgb(96,165,250)`）⇒ `light=0 / dark=120000` ⇒ 两支确实不互相顶替（断言②成立）。
    · `err`（复刻错误屏：浅底 + 四段深灰条）⇒ `brand=0`、`looksBlank=false`、`contentRatio=0.1657`
      ⇒ **判别对成立**：同一张图"非空白"放过去、"品牌蓝"拦住（断言③成立，这条是 §7 第 82 条的本体）。
    · 容差 ⇒ `HEYTA_BLUE_TOLERANCE=12`，`rgb(49,99,235)` 命中 3600（整张 60x60 全算上），
      `rgb(50,99,235)` 命中 **0** ⇒ 阈值真的有边，且是从常量推的（断言④成立）。
  - ⇒ 等 `/tmp/tfa-test.lock` 空下来，落进去的套件应当**一次全绿**；那五个数字（144 / 120000 / 0 / 3600 / 0）
    就是它的基线读数，将来 magick 版本或解析器改动若把任何一个挪了，都能当场归因（而不是"测试又红了"）。
    任务已挂 **#9**。
- 🔴 **11:39 这一轮把"窗口不在"从印象换成了带名字的读数，并纠正两处我自己的探针错法。**
  - 现量三条同时不成立：**负载 28.01**（阈值 12）；**测试通道锁 `/tmp/tfa-test.lock` 11:36 刚被写过**（活跃）；
    设备被别人的现场占着（见下）。⇒ ①③②（#9）三条全部继续等待，不是我不肯跑。
  - 活的占用者逐个有名（`ps -Ao pid,ppid,etime,command` 于 11:39:11）：`sup-reinstall.sh`（pid 16137，父 1，
    **已 59:39**，cwd `~/scratch-heyta`，子进程在换 = 它正在往前跑）；`heyta-wt-batch2/scripts/.verify-mobile-card-export-ios.sh.snap…`
    （pid 56364，6:31）；`/tmp/queue-reinstall-all.sh` 那一整条（pid 81007 / 93771 / 93772 / 93817，**8:27:0x**，
    叶子仍是 `notarytool submit --wait` pid 98934，CPU 0:00.03）。
    ⚠️ 这张表**不能**用来主张"没有别的占用者"：我用的交替词是 `emulator-5554|verify-mobile|window-gate|appium|reinstall`，
    而我自己那条链叫 `heyta-window-chain17.sh`，**不在表里** —— 模式连自己的东西都没抓到，就不能当"穷举"用（正向可用、反向不可用）。
  - 设备上 `com.heyta` 的年龄量出来了：pid 17339 的 `starttime=1369594` jiffies，同一时刻设备 `uptime=16716.71s`
    ⇒ 约 **51 分钟前**（≈10:47）启动。HZ 不是假设：拿一个**刚刚启动的** `cat` 做阳性对照，`1676071/16760.7 = 100.00` ⇒ 设备侧 100 Hz。
  - 🔴 **我先把这枚 pid 拿去宿主 `ps -p 17339` 查，得到空读数，读起来像"占用者退了、设备空了"** —— 它是
    `adb shell pidof` 返回的**设备内** pid。与「用 `ps | grep 'ssh -N -L'` 判隧道断了」是同一条坑的新面目：
    **判"进程还在不在"之前要先问这个 pid 属于哪个内核**。这次靠"设备侧 `cat /proc/17339/stat` 有内容"把它拉回来了。
  - 🔴 **焦点令牌不是身份证**：本链日志里 `830af6e` 在 `e9fc21f / 9f869c7 / 8c95b08 / ab0b505 / b0171b6` 之后
    **又反复出现**（序列：8/3/24/3/1/2/1/4/10/1 次）。⇒ "令牌变了"仍是活动的**正**信号（窗口被重建过），
    但"令牌没变/又变回来"**不能**读成"没人动过"。11:20 那条更正的根据（令牌变化 ⇒ 有人在用）依然成立，
    反过来用它当空闲证明是新的错法，写在这里挡下一次自己。
- ✅ **提交器 helper 升到 v2，并给它配了独立夹具（7 臂 + 4 条变异全抓到，`FIXTURE=GREEN`）**：
  归档 `~/.heyta-pending/notes-e2e-20261004/` —— `plumb-blob.v2.sh`（sha8 `8038a30b`）、`plumb-blob-fixture.sh`（`db19e248`）、
  `plumb-blob-mkmut.mjs`（`191b5463`）、`plumb-fixture.log`（`a65efd89`）。三处改动：
  1. 🔴 **第 2 参是消息文件、不是消息原文**：这一轮我把原文直接传进去 ⇒ `cat` 报错但**整条命令仍 rc=0、`update-ref` 照常成功**，
     于是落出一枚**空消息提交**（`f95f4a7d`），`git log --oneline` 只显示哈希、完全看不出缺了什么；靠 `git log -1 --format=%B`
     现量才发现。已用**同树同父**换新消息那笔（`7ecceb6b`，树 `582e35e2` 未变、与 `f95f4a7d` 的内容差为空、`--is-ancestor` 已在 main 上）。
     ⇒ helper 现在对消息参数断言"文件存在 + 非空 + 非纯空白"，三道各配一条变异臂（M1/M2 实测：拆掉后臂 A 会落出一枚空消息提交）。
  2. **删行门默认拒绝**：原先那份"哪些删除算我自己的"是靠**写死上一笔提交的字面量**判断的（换文件/换批就失真），
     第一版改法又把守卫挂在 `EXP_DEL=0` 上 —— 而 numstat 删除数为 0 时 `diff '^<'` 必然也是空，**那条分支永远不会响**。
     现在按事实判：blob 里只要让 HEAD 已有行消失就红，要放行必须显式 `PLUMB_ALLOW_DELETIONS=1`（它会先把待删行打出来）。
     夹具里 M3（门常开）与 M4（条件恒假）两条都把臂 D 变绿 ⇒ 原条件不是恒真。
  3. **仓库/分支名可注入**（`PLUMB_REPO` / `PLUMB_BR`，默认值逐字是原来硬编码的路径 ⇒ 既有调用方零变化），
     这样守卫能在 `mktemp -d` 的临时小库里做夹具，**不碰共享工作树** —— 因为这套守卫的失效模式恰恰是"抹掉别人的行"，
     拿真库做夹具的话夹具本身就成了事故源。
  - ⚠️ **如实登记一条没覆盖的**：树差守卫（`TREE_DELTA`）在本夹具里构造不出来（隔离索引只会写那一条路径），
    它防的是索引被污染，不是这条链的失效模式 —— 记在这里，不让"7 臂全过"被读成"每条守卫都有夹具"。
- ✅ **11:4x 等待回合做的三件实事**（全部零设备、零重跑，不改别人的东西）：
  1. **载体对齐了，而且对齐不需要重推导**：`heyta-wt-reinstall` 从 `fc324e12` `git checkout --detach` 到 `d75823ad`
     （现量 `HEAD..main = 0` 笔）。这 30 笔只碰 **14 枚文件**（`BLOCKED.md`、五张证据 png、四份计划文档、
     `scripts/check-empty-state.mjs` / `check-shell-unicode-vars.mjs`、`server/src/legal.generated.ts`），
     **`scripts/verify-mobile-notes.sh` 的 blob 一字未动**（新旧都是 `a7f6579b`）⇒ ③ 那份合并态 `df46f473`
     仍然钉得住，不用跑重推导器。依赖清单（`package.json` / `pnpm-lock.yaml` / 各包 `package.json`）**零变更**
     ⇒ 载体的 `node_modules` 不需要重装（重装会自己加负载，这里省掉了）。
     核身门在**真载体**上现场回 `0`（`BASE_BLOB` 现取 = `a7f6579b` = 那个不移动的锚）。
     ⚠️ 顺带一条读数形状：那条 pass 分支的打印依赖调用方的 `say()`（函数注释就写了"只写日志，不参与判决"），
     所以我这次手敲得到的是**只有回码、没有那行"输入已核身"** —— 回码才是判决，打印是附加的。
  2. 🔴 **`pgrep -f` 给出过一次 0 行，而它结构上不可能为 0**：11:41 我跑 `pgrep -f 'verify-mobile-restore|verify-mobile-notes|verify-mobile'`
     得空，据此差点写"没有别人的 verify 在跑"。被匹配的那枚 `56364`（`.verify-mobile-card-export-ios.sh.snap`）**全程活着**
     （`etime` 从 06:31 连续涨到 10:25，没重启过），而我自己的命令行里就含这个 needle ⇒ **至少该回我一枚**（`-f` 会自匹配探针 shell）。
     随后同一表达式连跑三次都是 2 行。⇒ 机制未定性（不把它写成"pgrep 坏了"），但**规矩可以定**：
     **pgrep -f 的 0 行不构成"没人跑"的证据**，要么同趟用 `ps -Ao pid,etime,args | grep -E '[v]erify-mobile'` 复量，
     要么先确认"我自己的 argv 里含 needle、所以 0 行=探针坏"。共享闸门 `scripts/verify-mobile-window-gate.sh` 的占用腿用的就是 `pgrep -f`
     （:89 那条），它另有设备侧读数兜底，所以这次没有造成开窗误判 —— 但那条腿单独不可信，记在这里。
  3. **我自己的哨兵有两处瞎，换成 v2 了**：v1 的 needle 写死 `链 v17 退出`，而链退出行印的是 `链 v16 退出`
     （版本号是我从上一版抄下来的文案 ⇒ **永远不响**）；v1 也不管"链消失了"这一种，会一路等满 6h 把"没人跑了"读成"还在排队"。
     v2（`/tmp/heyta-sentinel-v18.sh`，已归档）：不认版本号（`链 v[0-9]+ 退出`）、加 `① 真的跑过了` 这条命中、
     加"链不在了"分支并**现场验过两条腿**（真链 pgrep 回 `98083 98085`、假名 `heyta-window-chain99` 回空）。
     - 🔴 写 v2 时我又踩了一次自己记过的坑：`echo "…不是"窗口开了"也…"` 在双引号里嵌双引号 ⇒ 字符串被截断、后半截变裸命令。
       这次是 `bash -n` 在启动前抓住的，不是我想到避免的 —— 记这一笔是为了让"记性不可靠、判据可靠"这句话继续有实例。
       中文文案里要引用一律用「」。
- 🔴 **把"别人那趟重装不会自己醒"从印象换成了机制**（11:5x 现量，两条都是只读）：
  - `apps/desktop-macos/scripts/package-app.sh:283` 现在是 `NOTARY_TIMEOUT="${HEYTA_NOTARY_TIMEOUT:-900}"`，
    上限由 `run_bounded` 实施（`:311`），超时打 `124` 并明说"包已签名但没通过公证"。这道门是 **`694c05e3`（10-04 05:15）** 才进 `main` 的。
  - 对手那趟用的载体是 `/tmp/heyta-reinstall @ d0a81927`，里面 `grep -c run_bounded` = **0**，而它的起跑时刻（母 `pnpm` 93772 的 `etime 08:38` ⇒ 约 **03:12**）
    早于那道门三个多小时 ⇒ **它那一发的 `notarytool submit --wait`（pid 98934）没有任何会自己结束的路径**：不是"慢"，是脚本版本里根本没有上限。
  - ⇒ 两条后果分开写清：
    ① **对我的 ①**：载体已对齐到含 `694c05e3` 的 `main`，所以我这一趟的公证步最多 900s 就会自己出结论（`124` 也算结论，包不装票据）。
       也就是说 ① 不会再产出第二枚八小时的挂死进程 —— 这一点现在是有行号的依据，不是我的良好意愿。
    ② **对那条线**：能不能中止那枚 `notarytool` 仍然是**要人拍板**的事，我没有动它，也没有绕开它。
       但我把"它不会自己醒"写在这里，是因为台账早先只写了"已挂 7h44m 且零 CPU"，那是**症状**；
       症状读起来还留着"再等等也许会完"的余地，而机制把那点余地消掉了 —— 等待的代价从"未知"变成"直到有人动手为止"。
  - ⚠️ 顺带一条我自己的旧错法被这次现量照出来：我先用 `grep -rn 'notarytool' … --include=*.sh` 去扫，
    zsh 把 `--include=*.sh` 当 glob 吃了 ⇒ `no matches found`，那一趟**什么都没扫到**。换成 Grep 工具才拿到上面那三行。
    这是同一条坑的第四次（`--include` 在这台机器的 zsh 里不可用），教训不是"下次记得加引号"，是**按文件类型过滤一律走 Grep 工具**。
- ✅ **#9 落地（12:03，提交 `87ce1efe`，只点这一枚路径）**：品牌蓝判据现在有用例钉着了 ——
  `scripts/screenshots/png-stats.test.mjs` +4 条（基线 9 条 ⇒ 候选 13 条，`node --test` 实测 `13 pass / 0 fail / exit 0`）：
  ① 大图上的小块主蓝仍数得出（命中 144，阈值 20）；② 浅色支与暗色支各认自己的颜色（同一张暗图浅色 0、暗色 >0）；
  ③ 错误屏判别对（内容占比 `0.1657` ⇒ "非空白"放行，而品牌蓝命中 `0` ⇒ 这半才拦得住它 —— §7 第 82 条的本体）；
  ④ 容差边界由 `HEYTA_BLUE_TOLERANCE` 推（差 12 命中 3600、多 1 命中 0）。
  **两条变异都让"它对应的那条断言"转红**（采样密度退回 2 万点 ⇒ ①；容差边界少 1 ⇒ ④），
  夹具在 `/tmp/png-mut` 的**隔离副本**里跑，生产 `png-stats.mjs` 一个字节没动（就地改共享源文件的话，
  那个时间窗里任何人跑门禁读到的都是变异体）。脚本归档 `~/.heyta-pending/notes-e2e-20261004/`。
  ⇒ 对 ① 的意义：`reinstall:all` 的 mac / android / ios 三端都走同一枚 `shot_ok`（`scripts/reinstall-all.sh:241/342/464`，
  现量核过），所以 "INNER_EXIT=0" 之后"装上的确实是 heyta 界面"这半从此有常驻回归，不再只靠人眼 ——
  人眼那条规定照旧执行（§6.2 规定一），但假绿不再只由我发现。
- 🔴 **这一轮最值钱的一条不是那四行用例，是我把自己的夹具读反了方向**：
  12:00:56 第一跑时 `/tmp/tfa-test.lock` 被别人（pid 86645，`npx playwright test tests/admin-con…`）持有，
  四条腿**一条都没执行**，而夹具把"道闸拒绝"（`rc=1` 且输出里没有 `not ok`）判成"变异存活 ⇒ 断言没有牙"，
  整份报告长得像 **`bad=4` 的红灯**。⇒ 这是**把环境无效读成产品失败**，而且方向和 §7 那条元规则相反：
  假红比假绿更容易被发现，因为它让我去修一个没坏的东西（这次差点写成"品牌蓝判据没有牙"并进台账）。
  修法是把道闸的原文单独认出来 ⇒ 那一腿记 `INVALID`、整支夹具以 **`exit 3`** 结束（与设备闸门同一套语义：
  环境无效 ≠ 产品失败），12:02:48 通道空出来的那 40 秒里同一份夹具跑出的才是 `MUT_FIXTURE=GREEN`。
  ⇒ 可迁移：**任何"跑判据"的装置，都必须把"没跑到"与"跑到了但红/绿"分成三种出口**；
  两值出口（红/绿）在共享机上必然把拒绝吸进其中一个，而吸进哪一个纯看运气。
- ✅ **③ 的起跑判据从"我自己抄的那几条腿"换成规范闸门（链 v18，`say` 里带 `${CHAIN_TAG}`；归档 sha8 `7ca29032`）**：
  - 动因是一条**现量的不对称**，不是"想整洁"：① 的启动器 `heyta-run-reinstall.sh:68` 一直是
    "在载体里跑 `verify-mobile-window-gate.sh --target b` 且要求退 0"，而 ③ 这条从 v1 起就是链自己
    数负载 / 看 runner / 看端口 / 看设备 —— **同一个不变量两份实现**，且闸门会随别的线补严
    （04:1x 就补过 3b 设备独占那条），抄件不跟着长 ⇒ 链可以在"规范判据拒绝"的条件下起跑 ③。
  - 12:05 在载体里各跑了一次两路闸门，把差异量出来了：`--target b` `REDS=load,dev`；
    `--target c` **`REDS=load,dev,apk`** ⇒ 链原来**少一条 apk 腿的口径**（"APK 比源码旧 ⇒ 验的是旧 bundle"，§7 第 27 条），
    而链那份是 `heyta-prep-apk.sh`（`:179`）另一套判法。v18 的接法是把闸门插在**起跑之前**：
    顺序 `prep-apk(:179)` → 核身门(`:199`) → `--target c` 退 0 才起跑 ⇒ 加了这条门不会把 ③ 永久钉死在 apk 红上
    （需要重建时前一条已经先重建了），这一条是插进去之后按行号现读确认的，不是推理。
  - ⚠️ **这条门覆盖到哪，是按实现读的，不是按分支名读的**（闸门 `:201-293` 现量）：C 分支的第 1/2/3/4 条腿通用
    （负载、别人未提交的源码、设备独占、凭据三件套、APK 新鲜度），而**第 5 条整条是截止时刻那条脚本自己的** ——
    它 `grep "verify-mobile-due-time.sh" scripts/check-script-snapshot.mjs`，且**只认名字在册、不比内容**、用的是 `warn`。
    ⇒ 两个后果：① 12:05 那次打印的 `✅ …MANIFEST 里有本线那条脚本` 里的"本线那条"**指的不是 ③ 那份**，
      把它读成"闸门认识我的脚本"就错了（这正是"判据的范围要按实现读"的又一次应验）；
    ② 🔴 **而我原先在这一栏写的"因为那条是 `warn` 不是 `FAIL`，它不进 `REDS`、不影响退码 ⇒ 拿 `--target c`
      当 ③ 的门是安全的"是错的**，且错得当场就能查出来：
      闸门 `:72` 现量 `warn() { echo "   ❌ $1"; FAIL=$((FAIL + 1)); }` —— `warn` 就是 FAIL++。
      更难看的是**否证我的那句话就写在同一段注释里**（`:306-308`）："REDS 的**条数可以小于 FAIL**：
      FAIL 还数着没有 WHY_ 旗标的提示行（"服务端没在 :PORT"、"**MANIFEST 里没有它**"）"。
      也就是说属主早就把"这条腿能否决退码、但不进 REDS"当成契约登记在那里了，我是**没读完被调方注释
      就按符号名推断**（§7 元规则"先读被调函数本体"这次落在我自己头上）——
      一个只 grep 了 `warn(` 而没打开那一行看的人，会像我一样得出"它不算"的结论。）
      ⇒ 真实后果不是"这条门白加"，而是**接法必须换**：v18 起跑判据改按闸门自己写的机器契约读
      （缺 `REDS=` 行 = 闸门版本不对或装置坏 ⇒ 不起跑；`REDS` 非空 ⇒ 不起跑；
      退 0 **且** `REDS` 为空 ⇒ 起跑；**退非 0 而 `REDS` 为空 ⇒ 单独打成"被无关腿否决"**，
      因为这一支的含义是"设备面/新鲜度/凭据五面旗标全清，挡住的是 due-time 那条与 ③ 无关的腿"）。
      12:1x 现量：第 5 条腿**此刻是过的**（`grep -c "verify-mobile-due-time.sh" scripts/check-script-snapshot.mjs` = 1），
      所以它现在并不否决 ③ —— 但那是别人 10:12 那次提交带来的**瞬时读数**，判据不能建在它上面；
      建在契约上才是稳的。链不使用闸门打印的 `CMD`（③ 的命令由链自己拼），这一点按实现读也确认了。
    ③ 这条门的真实作用仍是"设备面 + 产物新鲜度 + 凭据这三件事由规范实现裁决"，**不是**"闸门验证了 ③ 的输入"
      （输入那一侧归我自己的核身门管 —— 那才是比内容的那道）。
    已把这段覆盖范围写进链的注释里，并给闸门属主登记一条**不代改**的缺口：C 分支若还要服务别的设备验收，
    第 5 条与 `CMD` 得按 target 参数化（现在整支硬编码 due-time；该文件此刻在工作树里干净，上次提交 `35dbffe9`）。
- 🔴 **轮换链的那一刻，我把自己的哨兵弄瞎了一次（第三次踩"探针把被监视对象的版本写死"）**：
  哨兵 v2 的存活腿写的是 `pgrep -f heyta-window-chain17`，而 v17 → v18 的换代是我自己做的 ⇒
  链活得好好的（pid 31325、日志照常追加），哨兵却因为 needle 里的版本号已经过期而走向 `exit 4`
  报"链不在了"。它这次报得"对"（那个名字确实没了），但**结论是错的**（对象还在）——
  这正是同一族里最难发现的一种：**探针忠实地回答了一个已经不再被问的问题**。
  已改成 `pgrep -f heyta-window-chain`（不带版本，归档 sha8 `403d6cee`），并当场两条腿各喂样本：
  真链非空 `[31325]`、假名 `heyta-window-chain99` 空。
  ⇒ 固化成规矩而不是"下次注意"：**监视器里一律不写被监视对象的版本号/一次性名字**；
  版本要出现在**日志内容**里（`CHAIN_TAG` 就是为这个加的），而不是出现在**判据的匹配串**里。
  同一条规律今天第二次出现是哨兵 needle 写死「链 v17 退出」而链印 v16（那条我已登记）——两次同族 ⇒ 这说明 needle
  里带版本这件事本身就该禁掉，而不是逐个 needle 去修。
- 🔴 **链 v19：夹具第一次 eval 就照出一枚能让 ③ 永久饿死的 shipped 缺陷（BSD `mktemp` 模板），而它同时照出自己两根探针是坏的**
  - 缺陷本体（v18 `:223`，已提交的那版）：`GC_LOG=$(mktemp /tmp/heyta-gate-c.XXXXXX.log)`。
    **macOS/BSD 的 mktemp 只在 `XXXXXX` 位于模板末尾时才替换**；带 `.log` 后缀时它把整串当**字面文件名**：
    这台机器上第一次创建成功，此后每次都 `File exists` 且 stdout 为空 ⇒ `GC_LOG` 是空串 ⇒
    `>"$GC_LOG"` 重定向直接失败 ⇒ **闸门一个字都没跑**，而链打印的却是「闸门输出里没有 `REDS=` 这一行」。
    两个后果：① **③ 永久起跑不了**（每 60s 重演，日志看起来像在"等闸门"）；
    ② 归因错 —— 把我的探针故障说成闸门的问题（那一行明明写着"版本不对或装置坏"）。
  - 铁证（机制闭环，不是症状推断）：`/tmp/heyta-gate-c.XXXXXX.log` 字面名文件 mtime=**12:21**、
    内容就是假闸门那两行输出（`════ 结论 ════` / `REDS=`）⇒ 它是夹具第一趟 T1 造出来的；
    `stat -f` 现量 size=39。同一模板连试 6 次全报 `mktemp: mkstemp failed …: File exists`、rc=1；
    换成 `/tmp/heyta-gate-c-XXXXXX` 连试 3 次各得一枚新路径 ⇒ 修法按手册形状而非按运气。
  - 修（`CHAIN_TAG=v18→v19`，归档 sha8 `c8f5b4ae`）：模板 X 移到末尾 + **拿到路径先断言非空且可写**，
    失败时打「取证文件没拿到（mktemp rc=…、路径=[…]）⇒ 这是探针坏了，不是闸门说了什么」，
    两种失败各有自己的名字，不再共用一条消息。
  - sweep（同族结论句只改一处是不够的）：现量范围是 `scripts/` + `research/tools/` 的 `*.sh`/`*.mjs`，
    里面 **65 处 `mktemp`，坏形状 0 处**（`scripts/verify-mobile-reminder-ring.sh:256` 这类模板 X 都在末尾，
    `verify-selfhost-stack.sh:93` 早就写着 BSD mktemp `-t` 的同类警告 —— 这一族在本仓有先例，只是我没查到）；
    我这套 /tmp 装置里**只有链这一处**是坏的。poison 文件已删（我自己 12:21 造的）。
- 🔴 **同一趟里，夹具自己的三处探针缺陷**（都是"齐刷刷同一个读数"这个形状引出来的，逐条修）：
  1. **均匀失败 + 一枚异类** = 探针坏，不是判据坏：T1 绿、T2–T6/变异/对照**全部** NOREDSLINE。
     异类那一枚正是线索 —— 它排第一，说明"第一次成功、之后失败"，指向有状态的取文件那一手。
  2. **变异写进了 `mut.sh` 却没传给 `run`**（`run "$name" "$@"` 用的是默认未变异那段）⇒
     三条变异跑的是原代码，"变异存活/被抓到"这个结论当时**根本没被测到**。
     现在 `mut()` 显式传第 5 参，并加了一条 `cmp -s` 前提：变异后与原文逐字节相同就报"变异无效"。
  3. **静态前提那把尺子有回溯假阳性**：`X{3,}[^ )]` 会让 `{3,}` 少吞一个 X、拿剩下的 X 充当"后缀字符"，
     于是**正确的** `…-XXXXXX)` 也被判成坏（夹具以 exit 2 拦住自己，没往下跑）⇒
     尾字符类必须排除 X（`X{3,}[^ )X]`）。改完给它补了两臂自量：已知坏形状必须命中、正确形状必须放行，
     两臂都过才承认这把尺子有牙（否则它可能恒不响，也可能恒响而把 ③ 永久拦住）。
  - 夹具最终读数（`bash -n` 后直跑，12:27）：**七种闸门输出分类 7/7 符合期望、四条变异四条各自抓到、
    未变异对照仍 START ⇒ 臂通过=12 臂失败=0 / GATELEG_FIXTURE=GREEN**（归档 sha8 `a62ce89d`）。
    四变异分别对应四条承诺：退码这条、`REDS` 非空这条、缺行=装置坏这条、取证文件前提这条。
  - ⚠️ 登记**待入 traps**（暂不进 `docs/reference/environment-traps.md` 本体：该台账此刻正背着
    别人 **+156/−7** 的未提交行，往里插段会把别人的在飞改动卷进我这一笔；最大号现量 **235**）：
    「BSD `mktemp` 的 `XXXXXX` 必须在模板末尾，否则整串当字面名 ⇒ 首成功后永久 EEXIST；
    凡是"取临时文件"的判据都必须断言拿到的是非空且可写的路径，否则探针故障会伪装成被检对象没说话」。
- 现场（12:27 现量，链停→改→重启期间无在途验收：被停那枚 pid 4494 的唯一子是 `sleep 45`）：
  负载 `52.64/53.83/38.91`（阈值 12）、`:3000`=70256、`:3100`=26407 均在别人手里、
  `emulator-5554` 上 `com.heyta` pid=22880 在前台、另一条线 `.verify-mobile-card-export-ios.sh.snap.9178` 在跑，
  那枚 `notarytool submit --wait`（pid 98934）已挂 **9h10m**（父 93817，属另一条线）⇒ 窗口仍关，①③ 继续等。
  链 v19 pid **92734**、哨兵已重启；日志路径**故意不换**（哨兵里 `LOG=/tmp/heyta-chain17.log` 是写死的，
  换名等于再把"探针写死被监视对象名字"犯第三次 —— 版本区分靠行内的 `${CHAIN_TAG}`，不靠文件名）。
- 🔴 **等窗口的回合用来先静态核两件事：③ 那份输入是不是真的齐、以及"链那把 apk 尺子"和"闸门那把"会不会互相把对方钉死**（都不碰设备、不起 gradle）
  - **③ 输入核身**（`$HOME/.heyta-pending/notes-e2e-20261004/merged-with-others-f5line.sh`）：
    `git hash-object` = **`df46f473fae5`**（与链里钉的那枚一致）、**673 行**、`bash -n` OK；
    `step` 标题现取 **13 段**（负载门 + 0…12 + 8b）。Goal ③ 点名的四段要求**逐段在位**，带行号：
    第 6 步"恰好一条 NOTE/UPD，且载荷只有 content"(`:358`)、第 7 步反证"不改直接保存 / 点取消都必须一条 op 都不写"(`:390`)、
    第 8 步第三张截图 `android-notes-3-from-search.png`(`:473`，并已进第 12 步的证据清单 `:642`)、
    第 9/10/11 步跨设备三条腿（手机上传+下载 `:512`、服务端 Postgres 数那条 UPD `:547`、笔记本 node-host 解得开 `:599`）。
    第 12 步的截图判据是**三条**而不是"非空白"：`-s` + **mtime ≥ 本轮起跑** + **拍的那一刻前台是本应用**
    （焦点读不到判 bad 并写明"这不是产品缺陷"），像素/主蓝只打印不设阈值（理由写在 `shot_evidence` 注释里）。
    ⇒ 这条 attest 的价值：窗口是稀缺资源，不该被一份缺腿的补丁浪费掉；而"齐不齐"这件事**不需要跑起来就能查**。
  - **两把 apk 尺子会对撞（修在我自己那份 prep 里，没动闸门）**：
    规范闸门判旧是按 **mtime**（`gate:271-277`，路径集是 `apps/mobile/src packages/{ui,i18n,domain}/src` 的 `.ts/.tsx`），
    而 `/tmp/heyta-prep-apk.sh` 原来有一支**按提交比内容**的提前 `exit 0`（"零差异就跳过，mtime 不参与判定"）。
    两者口径不一致 ⇒ 存在可达状态：**内容零差异、但某个源码文件的 mtime 新过 APK**（touch / checkout /
    别人写过又改回来都能造成）—— 那时 prep 说"不用打"、闸门说"apk 旧"，**两边永远互相等，③ 静默饿死**。
    v2 改法：内容判定**不再提前豁免**，`SKIP` 必须同时过 mtime 那一腿（prep 的跳过条件严格不松于闸门），
    两臂都过才打 `VERDICT=SKIP-已有且不比源码旧（且按提交比内容零差异）`。
    现量对照（载体 `heyta-wt-reinstall`，APK 05:36:40 / 66.9 MB，BUILT_AT `04fa70f6`，载体 HEAD 32391847）：
    `SAME_CONTENT=0`、闸门那把 = **比源码旧（warn，WHY_APK=1）**、prep 那把的 `NEWER` 命中的是
    **`apps/mobile/tests/op-sqlite-container-removal.spec.ts`**（闸门那 4 个目录不含 `apps/mobile/tests` ⇒ prep 更严，不会反向饿死）。
    ⇒ 后果要写明：**下一个合格轮次里 prep 会真打一次 gradle（约 10 分钟、把负载顶上去）**，
    这是闸门要求的，不绕过；只发生一次，下一轮如果没人改源码就 SKIP。
  - 🔴 **给闸门属主登记一条缺口，不代改**（该文件此刻在工作树里干净，上次提交 `35dbffe9`，属另一条线）：
    闸门 apk 腿的 `find` 路径是一份**封闭清单**（4 个目录、只看 `.ts/.tsx`），里面**没有 `packages/app-host/src`**，
    而 app-host **是**打进 bundle 的（现量 `apps/mobile/src` 里 **54 个文件** import `@heyta/app-host`，
    含 `App.tsx`；app-host 最新源码 mtime 10:33:43，比那枚 APK 新）。
    ⇒ 只改 app-host（或 `op-log/storage/shared-schema/sync-client/sync-core/design-system`）时
    闸门会报"APK 不比源码旧"**而产物确实是旧的** —— 这正是 §7 第 27 条的原形状，只是路径集漏了。
    我这路不受它影响（prep 看的是整个 `packages`），但**别人单独跑 `--target c` 时受**。
- 现场（12:33 现量）：负载 `52.64/53.83/38.91`（阈值 12）、`:3000`=70256、`:3100`=26407、
  `emulator-5554` 上前台仍是 `com.heyta`（pid 22880）、另一条线 `.verify-mobile-card-export-ios.sh.snap.9178` 在跑、
  那枚 `notarytool submit --wait`（pid 98934，父 93817，属另一条线）已挂 **9h16m** ⇒ 窗口仍关，①③ 继续等。
  链 v19 pid **92734**（哨兵已重启，日志名不换的理由见上一段）。
- ✅ **上一段那条修复补了夹具，读数：臂通过=9 臂失败=0 / PREPSKIP_FIXTURE=GREEN**
  （`/tmp/heyta-prepskip-fixture.sh` 归档 sha8 `20a31cfa`；被验的 `prep-apk.sh` v2 归档 sha8 `6a3490c0`；
  本轮另外两份可复现物：链 v19 `c8f5b4ae`、闸门段夹具 `a62ce89d` —— 四枚都在
  `$HOME/.heyta-pending/notes-e2e-20261004/`，不只住 `/tmp`）
  - 切的是 prep 里 `prep-skip-decision begin/end` 两枚标记之间的 **21 行**（约定沿用仓里 `step10-scoped` 那一族：
    夹具按标记抽同一段文本跑，改 shipped 那段时夹具才会跟着改，不另建第二份实现）。
  - 五臂基线：`内容同+APK新 ⇒ SKIP（带"零差异"标注）`、**`内容同+源码 mtime 新 ⇒ BUILD`（这条就是修之前的饿死态）**、
    `无状态文件+APK新 ⇒ SKIP`、`内容变+APK新 ⇒ SKIP（mtime 说话，标注不带"零差异"）`、`APK 不在 ⇒ BUILD`。
  - **变异一条**：把"内容判定提前豁免"装回去（原形状）⇒ A2 那一态从 `BUILD` 翻成 `SKIP` ⇒ 抓到，
    且未变异对照同态仍 `BUILD`。另外两条**信息差**断言（A1 带标注 / A4 不带）钉住 `SAME_CONTENT` 不是写死的
    —— 只看 SKIP/BUILD 的话，这条腿恒为 0 或恒为 1 都能通过基线。
  - 状态文件路径做成旋钮 `HEYTA_PREP_COMMIT`（**默认值逐字不变**，读 :66 写 :112 两处必须同一个对象，
    否则旋钮只接了一半、夹具写到别处而判据仍读真文件 = 静默测了个空的）。
    夹具跑完后现量真文件仍是 `04fa70f6`（**没被碰过**）——这条是"夹具不污染共享状态"的凭据，不是假设。
  - 🔴 这一趟我自己的探针又坏了一次，形状与上一段完全同族：**均匀失败（五臂齐刷刷 NO-OUTPUT）**。
    根因是 `mk_repo` 用空格拼 `"$dir $STAMP"`，而 `run_arm` 用 `${info% *}` 反切 ——
    **目录名是中文标签、里面带空格** ⇒ `cd` 到半截路径。改成 `|` 分隔 + 独立 ASCII slug 参数 + 一条
    `[ -d "$dir" ] || 探针坏` 的前提断言。⇒ 固化成规矩：**夹具里凡是要回传路径，分隔符不能是空格，
    且切完必须断言目录真存在**；"所有臂同一个读数"永远先查探针，这次是第三次、同一族。
- 现场（12:39 现量）：链 v19 pid 92734 仍在第 16 轮，挡的那一条没变 —— `emulator-5554` 上 `com.heyta`
  pid=22880 在前台（`mCurrentFocus` 三个时刻读数 `1deff6`→`a1f20ec`→`b2e9cbc`，说明那台设备**正在被人反复操作**，
  不是残留窗口）；窗口仍关，①③ 继续等。
- 🔴 **① 还差一道门我才敢让它起跑：mac 段起跑第一步会 `rm -rf` 别人正在公证的那个目录**（已在**我自己的启动器**里补齐，`/tmp/heyta-run-reinstall.sh` 归档 sha8 `42e10fd7`，夹具 sha8 `d982933c`：**7 臂全绿 / MACDIST_FIXTURE=GREEN**）
  - 机制（不是猜测，是逐行读的）：`scripts/reinstall-all.sh:196` `MAC_OUT="/tmp/heyta-macos-dist"`，
    `:199` 紧跟一句 **`rm -rf "$MAC_OUT"`**（注释写的是"清掉旧安装包"），而 `apps/desktop-macos/scripts/package-app.sh:28`
    的默认输出目录**就是这同一枚** `/tmp/heyta-macos-dist`。
    12:4x 现量：另一条线那枚挂了的 `notarytool submit --wait` 读的正是
    `/private/tmp/heyta-macos-dist/Heyta-1.0.0.dmg`（`lsof` 现量：`diskimage/98171 … 5u REG … 2296476` 打开着它）。
    ⇒ 我若此刻起跑 ①，第一个动作就是把别人那枚在途公证的 dmg 从 underneath 删掉。
    **这不是"抢窗口"，是毁掉别人已经付出的等待** —— 按 AGENTS §8.9 与"只对自己创建的对象动手"，这种动作必须在起跑前拦掉。
  - 已有的那道人不够用（说清是哪一半）：启动器原本有 `RIVAL` 那道门（按 argv 形状认"别人的重装在跑"，
    06:35 那次"别人的 grep 命中自己"的教训修过），**它能拦住今天这个现场**（93817 还活着）。
    但它认的是"重装在跑"，**认不出父进程已退出、只剩 notarytool/dmg 句柄的孤儿态** —— 而那正是最贵的一种
    （九小时的等待还挂在服务端）。所以补的是**对象级**的第二道腿，不是再抄一遍名字匹配。
  - 两条腿都有现量正/负对照（12:4x）：
    · 进程腿 `pgrep -x notarytool` → `98934`；`pgrep -x notarytool_not_here` → 空。
    · 句柄腿 `lsof +D /tmp/heyta-macos-dist` → `diskimage/98171`；对不存在的目录同一条命令 → 空。
    ⚠️ **一度想用 `pgrep -f 'notarytool submit'` 那类 pattern 口径，现量它读不出这枚**（真-runner helper 的
    argv 形状判定是给 `*.sh` 那种形态设计的，对 notarytool 返回空）—— 拿它当门就是**假绿**。
  - 夹具四臂 + 两变异 + 对照：`两条腿都空 ⇒ 放行`、`只有进程腿 ⇒ 拦`、**`只有句柄腿（孤儿态）⇒ 拦`**、`两条都命中 ⇒ 拦`；
    M1 摘句柄腿 ⇒ 孤儿态从 REFUSE 翻成 PASS-THROUGH（这条变异就是"没有这次修复的世界"），
    M2 摘进程腿 ⇒ F2 翻成 PASS-THROUGH；未变异对照同态仍 REFUSE。
    切片按 `mac-dist-guard begin/end` 标记抽 shipped 那 6 行，`pgrep`/`lsof` 在假 env 里 shadow，判据本体一个字没动
    （不 shadow 就得真去起一枚 notarytool 才能测 —— 那是要动别人领域的动作）。
  - ⚠️ **不代改的部分**：`reinstall-all.sh` 里那枚共享输出目录本身仍是硬编码的（该文件此刻在工作树里干净，
    属主不是我这条线）。登记给它的属主：`MAC_OUT` 应按载体分开（或起跑前做同样的对象级占用检查），
    否则**任何两条线各自跑 ① 都会互相删包**，而两边的判据都只看自己的截图 —— 谁都不会报红。
- 现场（12:44 现量）：链 v19 第 23 轮仍被 `emulator-5554` 上前台的 `com.heyta`（pid 22880）挡着；负载、端口、
  别人的 iOS 卡片导出验收照旧 ⇒ ①③ 继续等窗口。本轮没有起跑任何设备/Playwright/重装类验收。
### 7.31 ③ 的输入多了一道「能不能重放」的门，另一枚探针先被自己作废（2026-10-04 12:4x–13:0x，载体 `458249f6`，窗口仍不在）

- 窗口现量（12:56:10）：`vm.loadavg` 1-min **15.78**（阈值 = ncpu 16 × 3/4 = 12）、`:3000` = node/70256、`:3100` = node/26407、4318/4319/4322 空闲、
  `emulator-5554` 上 `com.heyta` pid 22880 且 `mCurrentFocus=Window{95140e2 … MainActivity}` ⇒ 设备不空闲。
  ⇒ **本轮没有起跑任何设备 / Playwright / 重装类验收**（照「窗口不在就不要跑」）。链 v19（pid 92734）第 33–38 轮每轮都停在同一枚读数上。
- 🔴 **③ 的产物取证换了一枚更新的对象，并且顺手作废了我自己的探针**：12:57:28 现量主检出的 release APK `md5=308e828616cf…`、66,991,392 B、
  mtime 10-04 **12:00** —— 晚于我 06:38 写下的 `heyta-prep-apk.commit`（`04fa70f6`）⇒ 这枚不是我那趟打的；
  相对那枚标记，`apps/mobile packages pnpm-lock.yaml` 差 **62 文件 / +3494 / −172** ⇒ 我的 prep 在 `SAME_CONTENT=0` 那一档，**不构成豁免**（v2 的设计就是宁可重打）。
  包内 `assets/index.android.bundle` = **5,969,148 B**、Hermes 魔数 `c61fbc03c103191f`；**UTF-16LE** 口径计数：`打开搜索` **1**、`输入关键词` **1**、`便签` **35**；
  负向对照 `打开搜索ZZz` **0**、`移动端没有这个串ZZz` **0**；ASCII 口径 `mobile-note-editor` **1**。
  ⇒ 第 8 步要用的两条界面文案**在当前这枚产物里就在**，那一步若红，原因是行为而不是"bundle 里没这句话"。
  🔴 而这组数第一次是**假数**：我用 `grep -a -c -F -f` 喂 UTF-16LE 的 needle，`-f` 在第一个 NUL 截断 pattern ⇒ 真串与我现编的假串**都回 75**。
  改成 node 的 `Buffer.indexOf` 逐字节数才有分辨力（`heyta-u16count.mjs`）。这是「0 命中/同命中先怀疑探针」那族里新的一种面目：**探针不是读不到，而是读到了同一条被截断的短串**。
- **③ 输入的重放装置（新，夹具 9/9 GREEN）**：动机不是整洁 —— 链里 `identify_notes_input` 的第 5 参写死了 `a7f6579b`（合并态当初推导自哪枚底），
  main 一旦再推进这枚文件，v13 的门 B 就**响亮拒绝**（这是对的），但"重新推导四个补丁"当时是纯手工动作，而窗口是稀缺资源。
  现在它是一条命令：`bash ~/.heyta-window-rigs/heyta-remerge-notes.sh <新底> [--write 输出]`，读 `VERDICT=OK/CONFLICT/REJECT` 与"下一步把第 3、5 参换成什么"。
  三方合并用 `git merge-file`（祖先 = 归档的旧底 `notes-base-a7f6579b.sh`、我方 = 合并态、他方 = 新底），**不用 `patch --fuzz`** —— 那件工具实测过"删掉看起来像的另一块、rc 仍是 0"。
  四条判据：`bash -n`、五处补丁落点的命中数、他人那枚 `evidence/${f}` 是否活到最后、**相对新底删掉的每一行都必须在那 17 条已知替换白名单里**。
  夹具九臂（`heyta-remerge-fixture.sh`，逐臂带期望）：C1 新底==旧底 ⇒ OK 且结果**逐字节等于** `df46f473`；A2 他人纯追加两行 ⇒ OK 且两行各 1 次活在结果里；
  A3 他人改到我替换过的那一行 ⇒ **CONFLICT**（不许静默放行）；A4 他人删掉我落补丁的整段 ⇒ **CONFLICT**；
  M1 把截图 helper 摘掉 ⇒ **REJECT**；M2 白名单砍空 ⇒ 装置自曝「夹具坏了」而不是判绿；
  **M3 白名单仍是 17 行但最后一行被换成不相干的串 ⇒ REJECT** —— 这一臂是补的：M2 只证明"行数"那扇门锁得住，M3 才证明**判据 4 读的是内容**，
  否则"删除 ⊆ 白名单"完全可能是一条只数行数的装饰判据。
- **闸门 apk 腿的三层局限，本线的增量只剩第 3 层**（第 1、2 层已由别人的装置管着，不据为己有）：
  (1) mtime 不证 bundle 内容 —— 别人有 `research/tools/r14c-bundle-testid-preflight.sh`；(2) 比较是树内的，载体落后就失明 —— 别人的 `r14c-window-retry.sh` v2 先对齐；
  (3) **扫面清单偏窄**：12:55 现量 `scripts/lib/apk-freshness.sh:36` 的 `HEYTA_APK_SOURCE_DIRS="apps/mobile/src packages/ui/src packages/i18n/src packages/domain/src"`
  **不含 `packages/app-host/src`**，而 `grep -rl @heyta/app-host apps/mobile/src` 现量 **54 枚**文件引用它 ⇒ app-host 改了，闸门这条腿可能仍报 apk 新鲜。
  ⚠️ 那文件 `:33-35` 的注释写着"清单本身偏窄这件事已登记在计划里"，但我按 `偏窄` 与 `HEYTA_APK_SOURCE_DIRS` 两个 needle 扫 `docs/` **各 0 命中**
  ⇒ **那句"已登记"我没找到落点**（同族规律：注释里对别处状态的断言也是断言）。这条量的出来的东西就是它现在的落点。
  **不代改**：清单归 `apk-freshness.sh` 的属主，且扩大它会改闸门 `REDS=` 的读数，而那一句是另几把夹具的输入 —— 要动得连夹具一起过。
  本线为何暂不受它影响：**顺序**。链是 `prep-apk` → 核身门 → `--target c` 才起跑，而我的 prep 扫的是 `find apps/mobile packages`（整个 `packages/`，含 app-host），
  也就是 **prep 的口径严格不松于闸门** ⇒ app-host 变了会先重打，闸门那条腿随后看到的是新 APK。这条只在"prep 仍在这条链里跑"时成立，写下来是为了让它被拆掉时能被发现。
- **② 那句"62 段"是任务书的口径，我的读数是另一把尺**（防下一轮误读）：`§7.30` 里我记的是**实际那趟 74 段**（带载体 `f08b26e7` —— 🔴 **10-04 14:2x 自查更正**：原句在这里贴的是 `940af1c0`，而那枚其实是 **① 四端重装的载体**（10-03 13:53，§7.21/§7.22）⇒ 两个 SHA 都真、角色贴错了，是「值对得上不等于它就是那个角色」在自家账里的复发；74 段那一趟的载体按 ② 槽原句是 `f08b26e7`（10-04 02:35）），
  现量 HEAD 的 `package.json` 里 `check` 按 `&&` 切是 **76 段**、`check:*` 脚本 **73** 枚；工作树里还有别人**未提交**的 `check:apk-freshness`
  （`git show HEAD:package.json | grep -c` = **0**，`M package.json`）⇒ 段数是活数。引用任何"N 段"必须带**哪一趟 + 哪个载体 + 哪个口径**，否则就是两份不可比的数。
- 装置归档：不再只住 `/tmp` —— `~/.heyta-window-rigs/` 现量 **15 枚**（链 v19 本体与它 source 的两份判据库 `heyta-identify-fn.sh`、`heyta-device-occupancy.sh` 都在内，
  之前漏了这两枚 —— 链只有 `set -u`（`:22`），所以缺文件时 `. …` 失败**不会**打死链：`identify_notes_input` 变成 `command not found`（rc=127）走 `|| continue`，
  ③ 于是**每 60 秒静默饿死一次**，而日志看起来像在正常等窗口）；逐枚 sha256-12 打在那目录里，夹具跑的是同一份 shipped 内容而不是抄件。
- 🔴 **现场那句"13:0x 现量 `ps` 里已无别人的 verify-mobile / 打包 / notarytool"是错的，撤回并留在这里**：成因是命令口径 —— `ps -o pid,etime,command | grep …` 不带 `ax`/`-e` 只看得见与当前终端有关的那几十枚进程，于是"空输出"被我读成"环境干净"；而同一条命令里负载与端口两半是对的，所以它不像"全线 0 行"那样自我暴露。换成 `ps ax -o pid,ppid,etime,command` 现量（13:25:41）**三条全在**：`heyta-wt-batch2/scripts/.verify-mobile-card-export-*.snap`（pid 84803，那时刚起 6 分钟、正在驱动 emulator ⇒ 这就是设备上前台 `com.heyta` 的 pid 从 31628 变成 31765 的原因，不是"残留"）、`/tmp/heyta-reinstall/scripts/.reinstall-all.sh.snap.93817`（pid 93817，已跑 10 小时）、`notarytool submit /tmp/heyta-macos-dist/Heyta-*.dmg`（pid 98934，同一枚挂 10 小时，12:5x 那回它就在那儿 ⇒ §7.31 里"12:44 那枚不在了"也随之作废）。规矩落成动作：**判"没有 X 在跑"只认 `ps ax` 或 `pgrep -f`，并且先拿一枚我确定在跑的 pid（自己的链）做一次阳性对照**；这枚口径同族的是"批门禁在 zsh 下必须 `sh -c`"与"pattern 结构上匹配不到 ⇒ 0 行不代表东西没了"。
  但设备前台仍是别人的 `com.heyta`、`:3000`/`:3100` 仍被占 ⇒ **①③ 继续等窗口**。本轮起跑的设备/Playwright/重装类验收：**0 条**。
#### 7.31.1 上面那条自己也有两处要先作废（13:1x 现量，载体 `32391847`，主检出 HEAD `ba063aab`）

- 🔴 **我 13:13 那条"iOS 模拟器只有 1 台 booted"是假读数**，成因是探针形状而不是环境：我用 `simctl list devices booted | grep -E 'iPhone|iPad'` 去数，
  而本机四台叫 `heyta-*` 的设备名里**没有** iPhone/iPad 字样 ⇒ 结构上匹配不到。现量（`simctl list devices booted` 不带名字过滤）= **5 台 booted**：
  `heyta-batch2-closeout`、`heyta-bc-reminders`、**`heyta-iphone-17pro`**、`heyta-ios-isolated`、`iPhone Duo heyta`。
  ⇒ 后果不是小事：如果我相信那枚"1 台"，就会去判定"① 的 iOS 目标没启动"、然后**去启动一台不该我启动的模拟器**（在共享机上多加一份负载）。
  链里 ① 要的那台 `heyta-iphone-17pro` 其实一直在 booted 表里，`grep -c '① 不起' /tmp/heyta-chain17.log = 0`（自量：那一支从没触发过）。
  同族第 N 次：这就是"0 行不代表东西没了"，只不过这次的 pattern 是我为了"顺手筛一下"现编的。
- **① 会不会拆别人的 iOS 现场 —— 这条不归我补，闸门已经管了**（按实现读，不按分支名读）：`--target b` 分支第 **3b** 段（`:171-199` 现读）
  用单所有者探针 `lib/mobile-e2e-runner-probe.sh` 数"有别的移动端验收在跑"并 `WHY_DEV=1 + FAIL++`，注释写明 B 会 `simctl uninstall` + `adb uninstall` + 覆盖 `/Applications/Heyta.app`
  这三条都是拆别人正在量的现场，且 04:1x 之前就因"闸门按 target 分岔漏了一半"补过。⇒ **我不给启动器再加 iOS 卸载门**（那会是第二份实现，一定漂）。
  我那条 `mac-dist-guard` 仍站得住，因为它挡的是**闸门看不见的那一类**：正在跑的 `notarytool` / `hdiutil` 句柄（不是 reinstall-all、也不是 verify-mobile-*）。
- **13:13 现量：那道物体级门此刻确实有用** —— `pgrep -x notarytool` 有（**注意措辞**：它当时不是"又起来了"，而是一直在，见本节末尾那条撤回 —— 我 12:5x 那趟用的是不带 `ax` 的 `ps` 才读成"没有"），
  且 `lsof +D /tmp/heyta-macos-dist` = `diskimage/98171` 握着 `Heyta-1.0.0.dmg`；`pgrep` 扫全表所以这一半是对的。
  ⇒ 此刻起跑 ① 会被我的启动器判 `VERDICT=NOT-RUNNING`，而那正是设计意图：`reinstall-all.sh:196,199` 的起跑第一步是 `rm -rf /tmp/heyta-macos-dist`。
- **③ 第 10 步的库前置已可读（13:11:25 现量，纯只读）**：`psql` 在 `/opt/homebrew/opt/postgresql@14/bin/psql`，`:5432` 由 `postgres/1334` 监听，
  `heyta_mobile_smoke` 连得上 ⇒ `SELECT count(*) FROM operations` = **90**，同趟阳性对照 `pg_tables` = **93**（两条都出数，说明探针与连接都活着，而不是"0 行"那种空读数）。
  这条只降低"第 10 步因为连不上而红"的概率，**不替代起跑前现量**（库里行数是活的）。
- 载体的工作树此刻有 **1 枚**未提交：`scripts/verify-mobile-notes.sh`，blob = `df46f473`（= 我的合并态，链在 ③ 之前把 shipped 的 `a7f6579b` 覆盖上去留下的），
  载体 HEAD `32391847` 落后主检出 `ba063aab` —— 这是**设计**（链在起跑那一轮才对齐），不是故障；
  同时确认链里 `identify_notes_input` 第 5 参写死的 `a7f6579b` 与 main 当前的这枚**仍逐字相同**（`git show HEAD:scripts/verify-mobile-notes.sh | git hash-object --stdin` 现量），
  ⇒ 门 B 现在不会拒绝，③ 不会因为我方依据过期而饿死。若它哪天拒绝，正解是 §7.31 那条 `heyta-remerge-notes.sh`，不是改链。
#### 7.31.2 换班指针（13:2x 现量；链换成 v20，看守只认两枚自己打的标记）

- **等窗口的载体换成了 `bash /tmp/heyta-window-chain20.sh`（pid 90182，PPID=1 ⇒ 我这个会话结束它也继续等）**，
  日志仍续用 `/tmp/heyta-chain17.log`（版本靠行内 `CHAIN_TAG=v20` 区分，文件名与标签同源了）。
  与 v19 的唯一代码差别是 `CAP` 从写死 400 变成 `CAP="${HEYTA_CHAIN_CAP:-1200}"`（现量每轮约 45 秒 ⇒ ≈15 小时，到 10-05 04:2x），
  换这一枚的动因不是参数洁癖 —— **这本日志（首行 10:54:24）里 190 轮有 187 轮卡在"设备在线但不空闲"、3 轮卡在负载（40.28/26.83/14.09 都 >12），
  `判据成立` 命中 0 次**，也就是说 10:54–13:23 这段时间里规范闸门一次都没让 ③ 起跑；
  而 v19 会在 ~17:3x 自己走完 400 轮退出，链一退就没人等窗口了，下一次窗口开我未必在场。轮换前做了两件事：`pgrep` 确认 92734/92736 的子进程只有脚本自己（没有半跑的验收），
  新文件 `bash -n` 过、两处替换各断言命中数 = 1（用 python 的 heredoc，不在 `node -e` 里塞带引号的中文）。
- 看守（`~/.heyta-window-rigs/heyta-watch-v20.sh`，后台 pid 96836）的 needle 是 **`NOTES_EXIT=`**（链打的）与 **`INNER_EXIT=`**（启动器 `:149` 打的），
  两枚都**先对构造样本喂过一次**确认真的会命中；真实日志里现在各 0 命中，那是"还没跑过"而不是"needle 坏了"（同一条坑的两面）。
  它不写链的版本号 —— 上一版把 `heyta-window-chain17` 写死，v18→v19 换代时把我自己的哨兵弄瞎过第三次。
- **`③` 有一个必须写下来的破坏性面（这次不是缺陷，是给后来者的前提）**：它读手机库的 `phone_db_pull()` 走
  `$ADB root; sleep 2; adb pull …heyta.sqlite; $ADB unroot`（合并态 `:143-148` 现读，注释指向 `verify-mobile-lists.sh` 的同名函数 —— 35 个 `verify-mobile-*` 里都是这一套），
  因为 **release 包不可调试、`run-as` 拿不到**。⇒ ③ 那几秒会重启 adbd，**这本身就是打扰设备面的动作**，
  所以闸门 `--target c` 的 `dev` 腿（设备独占 + runner 探针）不是仪式；谁将来把它放宽成"只在装包时才看设备"，③ 就会在别人的趟中间 root/unroot 一次。
- 其余前置已现量过、**但都是瞬时读数，起跑前仍需再量**（别把这几条当门用）：
  ① 要的 `heyta-iphone-17pro` 13:15:58 在 booted 表里（表里共 5 台）；载体的 `apps/mobile/evidence` 存在（脚本 `:118` 自己 `mkdir -p`，证据落在**载体那份**、不会覆写主检出那 96 枚）；
  ③ 第 10 步连得上库（13:11 现量 `operations=90`、同趟 `pg_tables=93` 阳性对照）；`mac-dist-guard` 此刻确实在挡（13:13 `diskimage/98171` 握着 `Heyta-1.0.0.dmg`）。
- 装置全在 `~/.heyta-window-rigs/`（现量 16 枚，含链 v20 与看守）；跑完 ③/① 之后要做的事没变：
  **四张截图逐张人看**（§6.2 规定一）＋ 把 `NOTES_EXIT` 那趟的第 6/7 步 op 判据、第 8 步第三张图、第 9–11 步三条跨设备腿的读数记进 §7.30 的槽里。
#### 7.31.3 ①③ 现在被什么挡着：一条**不自愈**的挂死，加一枚正在用设备的趟（13:28–13:29 现量）

- 规范闸门在载体里现跑（13:28:41，`HEYTA_LOAD_GATE_WAIT=0 … --target c`）：`GATE_RC=3`、**`REDS=dev,apk`**，两条 ❌ 分别是
  「有另一趟 reinstall-all 在跑（pid：93817）—— 它的 android 段会对同一台设备 `adb uninstall`」与「APK 比源码旧 ⇒ 跑它验的是旧 bundle」。
  `apk` 那一条**我方自备**（链的顺序是 `prep-apk` → 核身门 → 闸门，需要时前一条就先重打），所以它不是墙。
- 🔴 **`dev` 那一条是墙，而且它不会自己倒**：`ps ax` 现量这枚 `bash /tmp/heyta-reinstall/scripts/.reinstall-all.sh.snap.93817` 已经挂了 **10 小时 17 分**（13:29:23），
  它的直接下游是 `notarytool submit /tmp/heyta-macos-dist/Heyta-1.0.0.dmg …`（pid 98934，**10 小时 16 分**，`state=SN`、自己**没有子进程**），
  而 `Heyta-1.0.0.dmg` 的 mtime 停在 **03:13** —— 也就是那趟 03:12 起的重装在 mac 段的"等公证回执"这一步再没往下走过一步。
  外层还有 `sh /tmp/queue-reinstall-all.sh` 两枚（81007 / 93771）在把它当作"还在排队执行"守着。
  ⇒ 只要这枚挂着，闸门 `--target b` 与 `--target c` 的 `dev` 腿**恒红**，本条线的 ① 与 ③ 就都不可能起跑；
  这不是"等窗口"，是**等一条需要它的属主（或人）处置的挂死**。**我不动它**：它不是我创建的对象，里面还有别人的构建与产物目录（AGENTS §8.9）。
- 与它无关但同样真实的一档：设备面**此刻确实在被别人用**，不是残留 ——
  `com.heyta` 的前台 pid 在 13:25→13:29 这两分钟里从 **31765** 变成 **3383**（`mCurrentFocus=Window{fe4faf8 … MainActivity}`），
  期间 `heyta-wt-batch2/scripts/.verify-mobile-card-export-*`（pid 84803，13:19 起）跑完退出。**这一趟是正常的使用**，等它后面不再有即可。
- ⚠️ 顺手记一次我自己差点犯的错（因为它决定了"要不要去动别人的设备"）：
  判"84803 会不会是探针漏认的 runner"时，我先跑的是**不带 `-ax` 的 `ps`**（见本节末尾那条撤回）与一次 `pgrep -P 98934`（它没有子进程是真的，
  但那不代表它没在等），两枚都读成了空 ⇒ 若我就此宣布"闸门漏了那条 argv 形状"，就会**把一条本来正确的探针判成缺陷**、并据此要求改闸门。
  实际现量是：那枚趟在 13:29 前已经不在（`ps -p 84803` 只剩表头），**它是正常收尾还是中途退出我没取证**，也不需要据此改闸门 ——
  `mobile_e2e_runner_lines` 回 0 行在这里是**对的**（确实没有 runner 活着）。⇒ "探针回空"要配上"我先证明它能在活着的东西上回非空"这一发，才算量对了。
#### 7.31.4 闸门 HEAD 版仍缺「目标那台 iOS 设备里 App 正在跑」这一条 FAIL（13:32 现量），以及我据此差点误判别人的一次探针失误

- 现量：`grep -n launchctl scripts/verify-mobile-window-gate.sh`（HEAD blob `ce388c56`）= **0 命中**；
  同一刻工作树那枚是 `M` 且 blob 变成 `5561a56a` ⇒ **属主正在改它**。按交接文档 `:293-297` 的原话，他们在加的是
  "iOS 目标取不到就停"，而**「目标那台模拟器里 `com.heyta` 正在跑」这一条 FAIL 在 HEAD 里仍然没有** ——
  B 分支只在 `>1 台 booted` 时打一句 ⚠️（不 FAIL）。这不是抽象风险：`reinstall-all.sh` 的 ios 段拿到设备名之后第一件事就是 `simctl uninstall`，
  而 13:15 现量这台机器上有 **5 台 booted**，其中 `heyta-batch2-closeout` / `heyta-ios-isolated` / `heyta-bc-reminders` 是别条线的现场。
  ⇒ 缺口照旧**登记给闸门属主，我不代改**（改它会动 `REDS=` 的读数，那几句是别人几把夹具的输入）。
- 本线为什么暂时不受它影响（按实现读，不按分支名读）：占用判断**不在闸门里、也不在启动器里，而在被 source 的单所有者探针里** ——
  `heyta-device-occupancy.sh:28-38` 逐台 `simctl spawn <udid> launchctl list | grep UIKitApplication:com.heyta`，
  启动器 `:82` source 它、`:92` 逐台打 `ios [<名字>] running_heyta=<0|1>`，链 v20 那侧在起跑 ① 之前还要求
  `IOS_TARGET_NAME`（现量 `heyta-iphone-17pro`）那一台 `running_heyta=0`，读不到表就 `① 不起`。
  也就是说 **① 的门比闸门严**，这是顺序与实现都读过之后才敢这么说，不是"分支名叫 b 所以它管 iOS"。
- 🔴 记一次我自己差点制造的**误判别人**：我为了核对上面那句，只 `grep launchctl` 了启动器那枚文件，命中 0，
  于是脑子里已经成句"启动器没有那一腿、文档 :285 写的是假的"。差一点就写进台账。
  实际它是 `:82` source 进来的探针提供的 ⇒ **判"没有 X"之前要先问 X 该住在哪个文件、有没有被 source**
  （同族：只 grep 符号名不读被调方本体、以及上一节那枚不带 `-ax` 的 `ps`）。
  修法落成动作：核对"某个能力有没有实现"时，先 `grep -n -E '^\. |^source ' <入口文件>` 把被引入的文件列出来，再对这些文件各打一次 needle。
#### 7.31.5 ⑤ 的复核结果：三条登记里两条的**取证行号/指针是错的**，B46 已由属主带修落地（13:38–13:46 现量）

- 逐条把 `BLOCKED.md` 里点名要"保持登记不越权"的三条对当前代码核过：
  - **B41 成立** —— `apps/mobile/tests/growth-display.spec.ts:365` 仍是 `expect(labels.heatmap.grid({ total: 42, days: 365 })).toBe('')`；
    那句"9 处 `activityDays`"是**源码级**计数（上一轮把它数成 15 的那次把 `packages/*/dist` 混进去了，更正仍有效）。
  - **B42 结论成立、取证行号错**：原句「`HabitsScreen.tsx:372` 已经这么用了」里 `:372` 是 `common.habits.rename.label`；
    现量 `:401` 才是 `runFor(habitId, actions.checkIn(habitId, date))`，`git blame` 指到 `b756dc85`（10-01 15:42）⇒ 它一直在 401，
    是当时没打开那一行就抄了。**登记里被引用的行号必须能重跑对上** —— 否则下一个人按 `:372` 去找"已经有人这么用"会一无所获。
  - **B45 裁断成立、指针错位**：`HostedEntitlementReading` 的类型真身在 `packages/domain/src/subscription.ts:146-158`
    （`entitled` 分支就是 `{ readonly kind: 'entitled' }`，没有日期字段；`currentPeriodEnd?: number` 只挂在 `denied` 且可选），
    而原句写的 `packages/app-host/src/entitlement.ts:71` 是**产出它的函数**、不是定义处；界面位置补成 `apps/mobile/src/screens/EntitlementSection.tsx`。
- **B46 被现量否证，而否证的方向是"债已清"**：`structure.spec.ts` 的 HEAD 版与工作树**都是 616 行且逐字节相同**，
  FK 表名推导连同 `if (name === undefined || column === undefined) throw` 那枚守卫**已进 `main`**，
  `pnpm --filter @heyta/legal typecheck` EXIT=0 ⇒ 那笔红**不再挡全量 typecheck**（只跑了 legal 这一格，没重取 `-r` 的聚合读数）。
  ⇒ 可迁移的读法：**"这笔红只在混合工作树成立"是瞬时读数**，保质期取决于属主什么时候提交；
  每次要拿它当理由时必须重新 `diff <(git show HEAD:<f>) <f>`，不能引用上一节留下的结论。
- 落地：`BLOCKED.md` 两笔 plumbing（`77a88f3f` = 20/8、`5e315252` = 1/1）。第二笔单独存在是因为第一笔里我写了"读数 `/tmp/legal-tc-1342.log`" ——
  **账本里挂一条只在这台机器、只在这一趟之前存在的 `/tmp` 路径，等于把可复现物只放在 `/tmp`**，已换成命令本身（10 秒级可复跑）。
  四道文档门禁 13:46 现量 EXIT=0：`check:doc-citations` / `check:docs` / `check:md-tables` / `check:docs-voice`。
- 🔴 生成 patched blob 时我自己犯的两条，都靠"提交前逐行读 `git diff --no-index -U1`"抓住：
  ① 锚替换写成"插入新行但没删旧行"，于是 `所以 entitled 只说…` 与 `grep -c "推不出表名" …` **各出现两遍**
  ⇒ 生成脚本里补了 `assert out.count(needle) == 1` 这类**重复行断言**（比目检可靠，且它便宜）；
  ② python 载荷里嵌套 ASCII 双引号又炸一次（`SyntaxError` —— 第三次栽在同一类上）⇒ 改「」。
- ⑤ 的越权边界：三条**都没有翻判据** —— 没动 `server/` 与计费、没动 `growth-display.spec.ts` 里那条冻结断言、没动 `EntitlementSection.tsx`。
  B42 即便"比 B41 便宜"也仍需真机确认"点了以后连续天数真的回来"，那要窗口，不属于现在的动作。
#### 7.31.6 更正一条结论句必须 sweep 全仓 —— 这句在**代码注释**里还有第三住处（13:54 现量）

- 提交 BLOCKED.md 的 B42/B45/B46 更正之后，按仓库那条「同一个结论句落在两份文档 ⇒ 改一处必 sweep 全仓」把
  两条被推翻的句子在全仓（不限 `*.md`）扫了一遍。命中两处**第二住处**，都已改掉：
  - `PROGRESS.md:1305`：「（`pnpm -r typecheck` 现在会红在 `packages/legal`，那是别人在飞的 +117 行，见 B46）」
    ⇒ 改成"曾在…13:42 复量那一格 exit 0，那笔已由属主带修落地"（`f79fbfb0`，plumbing 1/1，
    提完工作树残留回到 **41/1，全是别人的行**，我那一行相对 HEAD 零差异）。
  - 🔴 **`apps/mobile/src/screens/GrowthScreen.tsx:89` 的注释**：把"补打卡动作层已现成"钉在
    `HabitsScreen.tsx:372` —— 与 BLOCKED.md B42 同一枚错行号，**它是代码里的第三住处**。
    改成 `:401`（`9b9afaf9`，`git commit --only` 点名一枚文件，`git show --stat` 只有 1 文件 1/1，
    别人暂存的两枚 evidence PNG **没被吸进去**）。纯注释、零行为变化。
- 同注释里另外两条引用**复量确认仍然命中，所以没动**：`HabitStreakList.tsx:269` =
  `{onRepair === undefined || labels.repairAction === undefined ? null : (` 那一行（真路径
  `packages/ui/src/motivation/`，注释里只写裸文件名，不构成错路径）；`growth-display.spec.ts:302` =
  `expect(labels.streaks.repairAction).toBeUndefined();`。⇒ **sweep 的产出不是"全改"，是逐枚判定"这条对不对"**，
  否则会顺手改坏本来正确的引用。
- 可迁移的形状：一句被推翻的结论通常**不止住在原来那份文档里** —— 这次三处分别是
  台账（BLOCKED.md）、进度页（PROGRESS.md）、**源码注释**。注释这一处最贵，因为 `check:doc-citations` 那类
  门禁只扫 `docs/`，代码注释里的行号引用**没有任何一层在守**；它坏了也不会红。
  ⇒ 扫的时候不要带 `--include=*.md`（zsh 还会把没引号的 glob 变成 `no matches found` 直接吃掉整条命令）。
- 四道文档门禁在改完 BLOCKED.md 之后现量 EXIT=0：`check:doc-citations` / `check:docs` / `check:md-tables` / `check:docs-voice`（13:46 与 13:48 两趟，后者是加了 §7.31.5 之后复跑）。
#### 7.31.7 ① 那"四张截图逐张写明钉到哪一步"的对照表**先按实现读出来**，窗口里只填读数（13:57 现量）

等窗口的回合不做设备动作，但可以把 ① 收尾最贵的那一步（逐张写明"这张证的是哪一步"）先做完，
免得窗口开时凭印象写。路径与判据全部现读 `scripts/reinstall-all.sh` 与启动器 `:171-175`：

| 截图（启动器期望的 5 张） | 出自哪一段 | 它钉住的那一步（现读实现，不是推测） |
|---|---|---|
| `/tmp/heyta-reinstall-mac-installed.png` | mac | `package-app.sh` 打完 → 拷进 `/Applications/Heyta.app` → **安装副本**自己启动并 `HEYTA_SELF_CAPTURE` 自截屏 ⇒ 证"装上的是这轮产物且能起一个真窗口" |
| `…mac-installed.png.webview.png` | mac（同段副证） | 主蓝 `countBrandBlue ≥ 20` **数的是这张**（`:235` 写明壳的规定）⇒ 证"那份共享 UI 真渲染了"；窗口那张只证"有个窗口"（10-03 实测：窗口图 48KB / 主蓝 0 是空暗窗口） |
| `/tmp/heyta-reinstall-android.png` | android | `pnpm build:android` → `adb uninstall` → 模拟器**全新安装** → `exec-out screencap` ⇒ 证"装的是当前 Release APK、首屏是共享 UI" |
| `/tmp/heyta-reinstall-ios.png` | ios | 🔴 **只有过了新鲜度门才存在**：`FRESH=1`（已装 `main.jsbundle` 比源码新）→ `simctl launch` → sleep 10 → `simctl io screenshot` ⇒ 这张图**出现本身**就证到"装上的包比源码新" |
| `dist/windows/packaged-first-run.png`（**载体相对路径**） | windows | 远端 `windows-pc` 打包 + `Remove/Add-AppxPackage` + 交互会话启动截图；四条判据 `ADD_APPX=OK`/`RESULT=OK`/`PAYLOAD_WEBDIST=True`/`M2D=OK`（🔴 **出处是 `scripts/lib/msix-install-facts.sh:18-21`，由 `reinstall-all.sh:158` source** —— 不是 `reinstall-all.sh` 自己写的，去那儿 grep 会命中 0） ⇒ 证"MSIX 里带 web-dist 的当前产物，且壳认出自己的界面" |

- 🔴 **这些截图都不回答「装的是不是这一批的产物」**（traps #178 那条分界），这轮现读到有两个专门的替身：
  mac 段是一条**带分母的对账**（`reinstall-all.sh:207-222`：装出来的 `.app/Contents/Resources/web-dist/assets`
  的 chunk 集合 vs 本机 `apps/web/dist`，对不上、或**没有分母**（`.app` 里根本没有 web-dist/assets）就直接 🔴）；
  ios 段是新鲜度门 `BUNDLE_MTIME ≥ SRC_MTIME`，且**两个 mtime 任何一个算不出来就直接判红**（`:450-455`），
  判红之后连截图都不拍 ⇒ 所以"ios 那张图存在"本身就证到新鲜度门过了。① 记账时这两条要各占一行，
  不要让截图去回答它回答不了的问题。
- 窗口里要填的只有两列：**每张的 mtime/字节/md5** 与 **是否 `本轮新生`**。启动器已经把这条做成了硬门：
  `FRESH != EXPECTED` ⇒ `VERDICT=NOT-RUNNING` 且 **exit 3**（不是 0），所以"拿旧图交差"在启动器这一层就会被拒。
- 🔴 **`/tmp` 那四条路径是共享的**（另一条会话的 reinstall 写同名文件），而启动器 `:180` 那段已经把每张
  `cp -p` 进私有证据目录 `$EVID`（载体相对那张另存 `$EVID/carrier/`）⇒ 我这次**没有再造一个采集器**，
  先读了实现（记忆里"手写探针前先 grep 仓内现成装置"那条正向命中一次）。
- ⚠️ 一张图都没跑过之前，这张表证的是"**判据规定它钉哪一步**"，不证"它这轮真钉到了"。
  真钉到 = ① 那趟 `INNER_EXIT=0` + `FRESH=5/5` + 我逐张打开看过。
#### 7.31.8 ① 的证据目录原来只住在 `/tmp`（我自己写的启动器里），改掉它的是**我这条线的一处自相矛盾**（14:02–14:03 现量）

- 现读启动器 `:145`：`EVID=/tmp/heyta-reinstall-evidence-<载体 SHA>`。它已经防住了"另一条会话往同一批
  `/tmp/heyta-reinstall-*.png` 写、把我看过的那张换掉"，**但没防住 `/tmp` 本身被清理/重启冲掉** ——
  而 ① 的交付物恰恰是"四张图我逐张看过"，图没了这句就不能复核。这与本条线自己写进 §7.31.7 与记忆里那条
  「可复现物不要只住 `/tmp`」直接冲突，所以是**我自己的缺陷**，不是别人的。
- 改法（只动我自己的启动器，不碰仓内脚本）：`EVID="$HOME/.heyta-evidence/reinstall-<载体 SHA>-<秒级时刻>"`，
  并把内层整条日志 `cp -p` 成 `$EVID/inner.log` —— 理由是 `INNER_EXIT=` 这条读数原来只住在
  `/tmp/reinstall-inner.log`，而**下一趟 reinstall 会用 `tee` 把它覆盖掉**，等于"① 的退出码证据活不过下一趟"。
- 三道夹具臂（持久副本 `~/.heyta-window-rigs/evid-dir-fixture.sh`，md5 前 12 `8f621961e860`，
  14:04 从持久路径复跑 `FIXTURE_EXIT=0` / `臂通过=3`）：有源⇒抄成且目录在 `$HOME` 下、
  无源⇒打 ⚠️ 不静默、以及**字面路径各命中 1**（形状由前两臂证，字面串由第三臂 grep 钉住）。
  ⚠️ 第三臂自己也漂了一次：它原来 grep 的是 `heyta-run-reinstall.new.sh`，而那个文件被 `mv` 换名之后**就不在了**
  ⇒ `grep -c` 报错、计数读成**空串**，而比较仍然只表现为"这臂失败"，不是"探针坏了"。
  现在路径可由参数注入（默认=链真正调用的 `bash /tmp/heyta-run-reinstall.sh` 那枚）、
  文件不在就**响亮报"探针坏，不是判据红"**、且计数先验它是个数字。
  生效方式确认过：链 `:305` 是 `bash /tmp/heyta-run-reinstall.sh --go` —— 每次调用重读文件 ⇒
  **不重启链**就吃到这次改动（替换用 `mv` 原子落，旧版留 `/tmp/heyta-run-reinstall.sh.bak-0414-1403`，
  持久副本 `~/.heyta-window-rigs/run-reinstall.v4.sh`，md5 前 12 = `2f04f687858f`）。
- 🔴 **夹具自己犯的一次写副作用，记在这里而不是抹掉**：夹具 v1 为了"忠实复刻"直接写共享路径
  `/tmp/reinstall-inner.log`，把上一趟的旧日志冲成了自己那行 `INNER_EXIT=0`；而且它的负向臂**没先删源**，
  于是"无源"那一臂读到的是上一臂留下的文件 ⇒ 假失败（第一次跑报臂2 失败）。
  两件事同根：**夹具对被测对象的外部状态有写权限时，它测的就不是那个状态**。
  v2 改成夹具私有 `$BOX` + 第三臂用 grep 钉字面串；那枚被写脏的 `/tmp/reinstall-inner.log` 已删
  （留一行假的 `INNER_EXIT=0` 比没有更危险，下一趟 `tee` 会自己重建）。
  ⇒ 与记忆里"探针污染状态 / 变异臂要重装并比 md5"同族，但这条是**夹具**而不是探针的污染，
  且污染的是**别人也会读的共享路径**。
#### 7.31.9 ③ 那条「第 8 步已知会红」的旧预期被现量否证 —— 等窗口期用四条离线臂把它顶掉了（14:07–14:09）

- 链 v20 的文件头注释写着：③ 里有一条**已知会红**的腿 —— 第 8 步从搜索结果进来的那张图，
  要等界面那条「搜索命中的是便签而不是任务」的产品行为补完。这句如果成立，
  ③ 这一趟就必然带着一条红收尾，而 Goal 明确要「第 8 步第三张截图」。所以先把它证掉，再花窗口。
- 现量四臂（全部离线、零设备、不占测试通道）：
  1. **接线的行号**：`apps/mobile/src/screens/SearchScreen.tsx:136` = `{ tasks: searchTasks(...), notes: searchNotes(notes, q) }`，
     `:190` = `notes={results.notes}`，`:194` = `onOpenNote={onOpenNote}`；该文件 `:19` 自己写着
     「~~不给 `onOpenNote`~~（2026-10-03 多端第二批已补上）」⇒ 行为**已在 `main`**。
  2. **搜索面**：`packages/ui/src/search/SearchPanel.tsx:254` 有 `noteRows.length > 0` 那一段，
     `:124` 有 `onOpenNote?`，`:85` 有 `notesSection` 文案位 ⇒ 结果里会出现「便签」那一节。
  3. **匹配语义**（`require('@heyta/domain')` 直调，四臂）：`noteSearchText(note)` 返回 `{ title: note.content }`
     ⇒ **便签是按正文搜的**；查询=整串 `note-e2e-142033-edited` 命中 1、子串 `142033` 命中 1、
     两词 AND 命中 1、不存在的词命中 **0**（负向臂在，说明前三条不是恒真）。
  4. **行名装不装得下 needle**（这一步才是真风险）：行名来自 `toNoteRows` → `noteExcerpt(note, NOTE_EXCERPT_LENGTH)`，
     `NOTE_EXCERPT_LENGTH=60` 而 NOTE_B 只有 22 字符 ⇒ `excerpt="note-e2e-142033-edited"`，
     `xy_desc "$NOTE_B"` 那条点击找得到。⚠️ **另一臂量到的是边界**：正文首行 80 字符 + 结尾才放 needle 时
     `needle_in_excerpt=false`（截断到 60）⇒ 这条腿**要求 NOTE_B 是正文的首行**，
     而脚本第 5 步正是把整条正文改成 NOTE_B（首行=它自己）。这是这趟读数真正的成立条件，不是运气。
- 🔴 **我自己在这四臂里踩到一次 arity 假读数**：第一次调 `noteExcerpt({content:B})` **少传了 `maxLength`**，
  得到 `excerpt="…"`，看起来像"摘要把 needle 截没了 ⇒ 第 8 步必红"。差一点把它当成产品缺陷写进台账。
  实际是被调方签名是 `noteExcerpt(note: Note, maxLength: number)`（`packages/domain/src/notes.ts:154`，两参），
  少传让 `firstLine.length <= undefined` 恒假、`slice(0, NaN)` 成空串 ⇒ **那是探针坏**。
  ⇒ 与记忆里「零参自锚函数传实参会被静默丢弃」是同一族的**反向形**：多参函数少传实参不会报错，
    只会把一个**看起来像结论**的值交给我。补一臂的代价是零，误判的代价是一整个窗口。
- ⚠️ **我没有去改那枚正在跑的链文件**：bash 是边读边执行的，`sed -i` 换长度会让它下一次读到的偏移错位
  （症状是"跑到一半开始执行错行"，最难归因）。链 `:264-270` 那段注释只是**我读它时的一条预期**，
  它不参与判据（① 早就不挂 ③ 的退出码了）。所以更正落在本台账，不改活体脚本；下次换新链版本时带上。
- ⇒ 对 ③ 那趟的读法因此改变：**第 8 步那张图若红，按真缺陷处理**（不再当作"已知会红"跳过），
  而 `xy_desc` 找不到行时先查 NOTE_B 是否还落在首行（第 4 臂那条边界），再查产品。
#### 7.31.10 ③ 的第 11 条腿（node-host）四项前置离线核完；链的构建门是**按提交内容**比的，我按 mtime 数出来的那个数不算数（14:12–14:13 现量）

- 为什么要单独核：③ 的三条跨设备腿里，第 9/10 条早就有读数（手机库远端 op、PG `operations=90/pg_tables=93`），
  而第 11 条要**在载体里跑 node-host 的真 CLI**。设备窗口只有一次，腿断在"CLI 跑不起来"上等于白烧一个窗口。
- 四项前置现量（全部零设备、零写库）：
  1. 载体 `apps/node-host/dist/cli.js` **存在且真跑得起来**：用仓内 helper 同一条 node 解析顺序取到的
     `~/.nvm/versions/node/v22.22.0/bin/node` 执行 `--help` ⇒ 打出「heyta node-host —— 非 Web 宿主（真实 SQLite + 真实同步）」，`rc=0`。
  2. `@heyta/node-host` 的 `package.json:17` 有 `"build": "tsup"` ⇒ 链里那句 `pnpm -r build` **覆盖得到它**
     （这条如果不成立，第 11 条腿会拿旧 CLI 验新代码，正是 §7 第 27 条那一族在另一端的翻版）。
  3. `sqlite3` 在 PATH（本机解析到 `/Users/rocalight/miniconda3/bin/sqlite3`）—— 脚本第 11 步直接用它数 `ops` 表。
  4. helper 的形状对得上：`scripts/lib/mobile-e2e.sh:89` `CLI=<repo>/apps/node-host/dist/cli.js`、`:979 laptop()` 用
     `$NODE "$CLI" … --json 2>/dev/null | tail -1`，而 `:983` 另有一条**不吞 stderr** 的 `laptop_ok` 变体 ——
     那条才是"探针有没有跑起来"的判据来源（文件头 `:101-107` 写的就是"跑不起来"和"对端没收到"长得一模一样这件事）。
- 🔴 **我按 mtime 数出来的"45 个 .ts 比 dist 新"不构成判据**：链的构建门比的是**提交内容**
  （链 v20 `:163` = `git diff --quiet "$BUILT" "$CARRIER_HEAD" -- packages apps shared pnpm-lock.yaml package.json`；
  时刻戳文件本身在 `:28 STAMP=/tmp/heyta-chain8.built`），
  而 `checkout` 会给恢复出来的文件盖新 mtime —— 用 mtime 判新鲜度会把"内容没变"读成"dist 落后"。
  那 45 个里面还包括 `packages/ui/dist/*.d.ts`（**产物**，不是源码），我当时没滤 `-path '*/dist/*'`。
  ⇒ 结论：**③ 的 CLI 会不会重建由链那道提交级门决定，不由我数的 mtime 决定**；这一条我原本打算写成"载体 dist 落后 ⇒ 第 11 步验的是旧 CLI"，
  那是**错的**，写在这儿是为了让下一位不重复我这个推法。
- ⚠️ 一条对窗口读数的预期管理（不是优化，是别误判）：`/tmp/heyta-chain8.built` 现在**不存在** ⇒
  下一次窗口成立时，链会**先跑一整趟 `pnpm -r build` 再起跑 ③**。那几分钟里日志不会有设备动作，
  **不要读成卡死**，也不要为了省这几分钟去预置那枚 stamp —— 预置成别的提交就是让构建门闭着眼睛放行，
  而它挡的正是"拿旧产物验新代码"。stamp 住 `/tmp` 这件事本身是同一条 `/tmp` 毛病（和 §7.31.8 那个 `EVID` 同族），
  留到下一版链再做（**不改正在运行的链文件**：bash 边读边执行，`sed` 改长度会让它读到错偏移）。
- 🔴 顺带记一次自己的命令形状错：我为了预测重建与否写了 `git diff --name-only "$S" …`，而 `$S` 当时是中文占位串「（无）」
  ⇒ stderr 出 `fatal: bad revision`，可我的 `wc -l` 仍然打出 **`diff 数=0`** —— 一个空测量长得像"零差异、不用重建"的干净结论。
  这是记忆里"空测量看着最干净"的又一次命中：**负向分支的读数必须先看 stderr，或者先断言输入是合法 rev**。
#### 7.31.11 ① 的 mac 段会不会被公证拖住：会跑、有上限、而且**上限与 `INNER_EXIT` 无关**（14:16–14:17 现量）

- 为什么先算这笔：① 的四条腿是**串行**的（mac → windows → android → ios），而设备窗口是稀缺资源。
  mac 段里 `package-app.sh` 会调 `xcrun notarytool submit … --wait`，另一条会话同一枚脚本已经挂了 **11 小时**
  （pid 98934）。如果不先量清楚，① 有可能"窗口开着、但整趟卡在 mac 的公证上，android/ios 永远轮不到"。
- 三项现量：
  1. **我们的运行会走公证那支**：脚本用 `security find-identity -v -p codesigning | grep -o 'Developer ID Application: .*'`
     选身份（`:185`），本机现量 `Developer ID Application` 数 = **1** ⇒ `SIGN_KIND=developer-id`；
     ASC key 三个候选路径里两个存在（`~/Library/Private/AppStoreConnect/`、`~/Desktop/`，**内容不打印**）
     ⇒ 三条跳过分支（非 developer-id / 没 key）都不成立。
  2. **有上限，且不是永久挂**：main 那份 `:283 NOTARY_TIMEOUT=${HEYTA_NOTARY_TIMEOUT:-900}` + `:291 run_bounded()`，
     先看 GNU `timeout` 在不在（`:286`），裸 macOS 上**没有**它，于是退化成纯 bash 看门狗（`:298-299` `local pid=$! waited=0` / `while kill -0 "$pid"`）
     —— 这一条正是"没有 timeout 就等于没修"的守卫。
     对照那台挂死的载体：`/tmp/heyta-reinstall/apps/desktop-macos/scripts/package-app.sh` 里 `run_bounded` 命中 **0**、
     `HEYTA_NOTARY_TIMEOUT` 旋钮**不存在** ⇒ **它就是 §7 那一族"载体落后于修复"的现场**，也解释了 11 小时。
     我们的载体每次窗口前会 `checkout` 到 main ⇒ 带修复。
  3. 🔴 **公证结果不影响 `INNER_EXIT`**：脚本 `:23` 有 `set -euo pipefail`（我第一版只看了头 8 行，
     据此写了"没有 `set -e`"，差点又写错一条判据 —— 现量纠正），但那条会失败的命令写成
     `run_bounded … || notary_rc=$?`（`:311`，不设限那支同形在 `:314`），**被 `\|\| notary_rc=$?` 吸收掉**；
     而公证超时/失败那两支（`:325`、`:327`）**只 `echo`，不 `exit`**，脚本最后一句是
     `echo "  签名档位：$SIGN_KIND"`（`:335`）⇒ `package-app.sh` 的退出码与公证结果无关，
     而 `reinstall-all.sh:200` 判的正是这个退出码。
     推论两条，都要在 ① 记账里写清：**`INNER_EXIT=0` 不证明公证通过**（mac 的 ① 判据是"安装副本自截屏非空白+主蓝命中"
     与 `:207-222` 那条带分母的 web-dist 对账），**公证 🔴 也不是 ① 失败**，它是一条**独立事实**（分发用，本机装不用），
     照实报，不并进 ① 的判决，也不拿它当"① 红了"的理由。
- ⚠️ 一个我**决定不做**的优化，理由写下来免得下一位替我重做：把 `HEYTA_NOTARY_TIMEOUT` 调小（比如 120）能让 mac 段少占几分钟窗口。
  但那等于为了省窗口去**取消一次本来会成功的票据装订**，而它换来的几分钟相对于我们已经等的小时并不值钱；
  况且第 3 条已经证明公证不参与判决。⇒ 用默认 900，不改旋钮。
- 🔴 顺带再踩一次自家探针的形状：我写的是 `grep -c 'run_bounded' <文件> || echo 读不到`，
  而 `grep -c` **零命中时也返回 1** ⇒ 输出里同时出现 `=0` 和 `读不到` 两行。
  正确读法是那个 **0**（命中数），不是后面那句。同一条陷阱记忆里已经写过（"`grep -c` 零命中 rc=1 但打印的 0 才是要读的东西"），
  这次是它**在 echo 拼接里**的新面目：**判"读不到"和判"零命中"不能用同一个退出码**。
#### 7.31.12 ① 只剩"窗口"这一类前置：四条结构前置全部现量成立（14:20–14:21）

把 ① 会被"非窗口原因"判红的每一条都单独量过一遍，免得窗口开了却红在一个本来现在就能发现的外部缺口上：

| 前置 | 现量（14:20–14:21） | 结论 |
|---|---|---|
| mac 段要往 `/Applications` 卸旧装新 | `[ -w /Applications ]` = **yes** | 不需要 sudo，也不会红在权限上 |
| windows 段要连远端打包机 | `ssh -o ConnectTimeout=10 -o BatchMode=yes windows-pc "echo SSH_OK"` ⇒ **SSH_RC=0**、回包里 `SSH_OK` 命中 1 | 主机在；`WIN_HOST` 的默认别名就是它（`reinstall-all.sh:261` 有 `HEYTA_WIN_HOST` 旋钮） |
| android 段要有一台连着的模拟器/设备 | `adb devices` ⇒ `emulator-5554  device` | 在线；**但此刻 `com.heyta` 是别人在用**（pid 3383）⇒ 这是窗口条件，不是结构缺口 |
| ios 段要目标模拟器是 Booted 的 | `simctl list devices booted` ⇒ 5 台，含本线要用的 `heyta-iphone-17pro`（其余 4 台是别条线现场，链不会碰） | 目标在位；启动器的 iOS 段不会再因"找不到设备名"红 |
| 公证那一步不会永久挂 | §7.31.11：main 那份有 `run_bounded`，挂死那台载体的没有 | mac 段最多多花 900s，且**不进 `INNER_EXIT`** |

⇒ **① 目前的阻塞是纯窗口条件**（设备被占 + 负载 26.7 > 12 + 端口 3000/3100 被占），不是任何一条结构缺失。
这条区分对收尾很重要：如果 ① 红在结构上，多等窗口也没用；现在不是那种情况。

⚠️ 本机探远端 Windows 时踩到的两条命令形状（写给下一位，别当成主机坏了）：
- 在 Windows 侧**没有 `tr`/POSIX 管道** —— 我拼了 `cmd /c ver | tr -d '\r'`，回来的是 GBK 的
  "不是内部或外部命令"乱码；那**是宿主上没有那个工具**，不是打包机坏了。要洗 `\r` 就在本机侧洗（`ssh … | tr -d "\r"`）。
- 外层再套一层 `bash -c '…'` 时，**内层的 `"…$?"` 会把我自己的引号吃掉**（实测 `unexpected EOF while looking for matching "'`）
  ⇒ 需要读退出码就先把远端输出重定向到本机文件，再单独 `echo` 那个码。

#### 7.31.13 ④ 在 HEAD 里的现状量核（代码级确已并入），外加 `pnpm check` 段数漂到 **81** —— 以及我第一次把它量成"0 次"的那个探针形状（14:24–14:25 现量）

**① ④ 的代码级现状量：不需要再动一行。** HEAD 是 `0a0b63f6`，四条独立读数：

| 问的 | 命令 | 读数 |
|---|---|---|
| 那一支在不在 HEAD 的祖先里 | `git merge-base --is-ancestor c983a7cf HEAD` | `ANCESTOR=YES` |
| 领域层文件在不在提交里 | `git ls-tree -r HEAD --name-only \| grep -c project-hierarchy` | **2** |
| 写侧声明处数 | `git grep -c setParent HEAD -- packages/app-host/src` | `actions.ts:3`、`project-actions.ts:6` |
| 三处落点有没有未提交差异 | `git status --porcelain packages/domain/src/project-hierarchy.ts apps/web/src/features/projects/ apps/mobile/src/screens/ListsSection.tsx` | 空 |

顺带一条对收尾有用的接线事实：`e2e/tests/list-folder.spec.ts` 落在 `e2e/playwright.config.ts:22` 的
`testDir: './tests'` 里 ⇒ **窗口内那一趟 `pnpm check` 会顺带把 ④ 的界面取证再跑一次**，
本线不必为它单开一趟 Playwright。

**② 段数：`pnpm check` 现在是 81 段，任务书那句"62 段"是口径不是尺。**
现量命令（可重跑）：

```
node -e 'const p=require("./package.json");process.stdout.write(String(p.scripts.check.split(" && ").length))'
```

上一趟**真实跑过**的读数是 74 段（载体 `940af1c0`，记在 §7.30）。74→81 这 7 段是别条线这两天往
`scripts.check` 串里加的门禁，不是本线的事 —— 但下一位报"可过段数"时**必须同时报载体和现量段数**，
只报"57/62"这种分数会被读成"漏做了 5 段"。

**③ 🔴 我在这次量段数时踩到的探针形状，值得单独留一行**：第一次问"三段 e2e 在不在 `pnpm check` 链里"，
我写的是 `x.includes('check:ai-e2e ')`（**带尾空格**）。`split(" && ")` 出来的元素是
`pnpm check:ai-e2e` 这种**没有尾空格**的形状 ⇒ 三段全报 **0 次**，读起来正好是"这三个 Playwright 段
不在全量链里"—— 而真相是**各 1 次**（`check:ai-e2e` / `check:privacy-consent-e2e` / `check:landing-e2e`
都在链里，链末段是 `pnpm -r test`）。改成 `x.trim() === 'pnpm ' + s` 才拿到正确读数。
这是"空测量看着最干净"的又一副面目：**凡在 `split` 结果上做 `includes`，pattern 里的尾空格会让整条判据恒假，
而恒假的判据报出来的 0 比报错更难被怀疑。**

**④ 窗口现量（14:23:56）**：链第 84 轮仍是「设备在线但**不空闲**」——
android `pidof_com.heyta=[3383]`（第 84 轮焦点已切到 nexuslauncher，但那个进程还在），
`uptime` 的 1min load **28.34** / 阈值 **12**（ncpu 16 × 3/4），本趟日志里 `判据成立` 计数 **0**。
⇒ **①③ 仍未起**，这一节只记读数，没有改动任何判据、任何断言。

#### 7.31.14 交接文件里"段数"那三家抄件收成一把现量，外加我自己这次造出来的**表格行粘双份**（14:33–14:35 现量）

**① 干了什么**：`docs/plans/multi-end-coverage-handoff.md` 有三处独立抄着同一个数（状态行、§任务 0 那一行、§收尾条件那一行），
三处分别写着 62 / 63 / 57。现在三处都改成**先给现量命令、再给两趟真读数**：

| 位置 | 改后主张 |
|---|---|
| 状态行 | 段数是活数 ⇒ 现量命令 + 「10-04 14:2x 在 HEAD `0a0b63f6` 上是 **81**」 |
| 任务 0 那一行 | 「别抄任何一版这个数」（00:5x 现量 63 → 14:2x 现量 81），并留原来那两条新增段名的定源 |
| 收尾条件那一行 | 「可过段数」与「总数」是两把尺：本线真实跑过的是 **74 段 @ 载体 `f08b26e7`**，整条 `CHECK_EXIT=1` 断在第 8 段的本机内存闸门（**环境门不是产品红**），逐段总账指向 §7.30 的 ② 槽 |

🔴 **结论一个字没动**：条件 2 那句"`pnpm check` 全量 exit 0"**仍未达成**，九条非绿也**不在本条线落点上**（不吸收别人的债凑绿）。
这一笔是 `1930f2b5`（`git commit --only` 点名单文件，别人暂存的两枚 evidence PNG 原样还在暂存里）。

**② 第三家没动，并且有主**：`docs/README.md:157` 那行也抄着「条件 2 未闭合（`pnpm check` 57/62、四端重装未跑）」。
现量它此刻带着**别人未提交**的一行（`git diff --numstat` = 1/1，内容正是 ADR-0050 那行的措辞改写）⇒ **不插进去改**，
登记在这里等那一行落地后再收。

**③ 🔴 这次是我自己造的边界事故，指纹留全**：两处 Edit 的 `old_string` **只写到那一行的中段**（我截到了「`goal §7.`」），
于是新内容替换上去之后，**原句的尾巴留在原地**，两行表格各被粘成双份：

```
…别沿用 62 |段是 `check:md-tables` 与 …别沿用 62 |
…当同一把尺** |28 与 **B51**；下一次现量起点应写 **≤56/63**（§3.1） |
```

这是记忆里「Edit 别吃掉相邻块的边界行」的**反面那一面**：`old_string` 不吃到行尾时，既不会删掉边界行、也不会报错，
而是把旧尾巴接在新句子后面 —— 两种坏形都是**静默**的。修法没用手改，落成一把带三条断言的脚本
`~/.heyta-window-rigs/heyta-fix-handoff-lines.py`（前缀命中必须 **1 行** + 那一行必须**含指纹** + 替换后**整行唯一落位**），
它同时兼任"如果已经修好就拒绝再跑"的守卫。修后 `check:md-tables` / `check:docs` / `check:doc-citations` / `check:docs-voice` **四条 exit 0**。

⚠️ **待入 environment-traps**（traps 现在是多人台账且正脏着几百行 ⇒ 按既有纪律不插行，取号要按工作树）：
*在长句或表格行中段做替换时，`old_string` 必须以行尾结束；否则原句尾巴拼在新内容后面，得到一条双份的行。
判据：被改文件 `git diff --numstat` 的**行数**应当等于我打算改的行数，多了就是粘上了尾巴。*

**④ 窗口现量（14:35:22）**：链第 **99** 轮仍「设备在线但**不空闲**」——`emulator-5554` 上
`pidof_com.heyta=[11631]`（**pid 换过一枚**，进程还在 ⇒ 那条线还在用它）。1min load 14:29 现量 43.48 / 阈值 12。
⇒ **①③ 仍未起**。④ 的代码级核在 §7.31.13，补一句：那三处落点在工作树里干净 ⇒ 窗口内那一趟 `pnpm check`
会顺带把 `e2e/tests/list-folder.spec.ts` 再跑一次，本线不必为它单开一趟。

#### 7.31.15 ③ 的验证装置整批落进 main，顺带查出第 10 步那条判据**永远不会失败**（14:44–14:51 现量）

**① 真缺陷（不是文档漂移）**：main 那版第 10 步数的是**整张表**的 `NOTE/UPD` 再判 `>= 1`，
而这台库本趟运行之前就已经住着历史行（现量 `count(*) = 2`）⇒ **它在任何东西发出去之前就是绿的**。
按 §7 元规则二，一条永远通过的判据比没有判据更糟。三步收掉：
`9479882e` 改成按本轮 `NOTE_ID` 收范围 → `d0d6c2fd` 采纳更强的那份（同一实体 **CRT 阳性对照**、
UPD **恰 1 条**的上界、`note-` 形状门、全库总数降级为只打印不判定）→ `23bbf2f1` 把 ③ 余下四处装置一起落进 main。
七臂夹具 `~/.heyta-window-rigs/heyta-step10-teeth-fixture.sh` **GREEN**：非法 id 不发查询 / UPD 缺 / UPD 多于一次 /
恰 1 条 / CRT 也缺 / 读数不是数字 / **真库那条**（`note-mus6la5w-2-ojz3mte7`：UPD 恰 1、CRT 1 ⇒ 顺带证明列名不是我编的）。

**② 这批里最值钱的是新加的第 8b 步**：第 9 步断"手机库里有 ≥1 条 `source ≠ local` 的 op"，
而笔记本原来第一次出现在**第 11 步** ⇒ 那一刻账号里根本没有别的设备写进去的 op，手机**正确地**拉到 0 条。
红的是编排，读起来却像"下载坏了"。这条正是 Goal ③ 点名的"第 9–11 步跨设备三条腿"缺的那块输入。

**③ 为什么必须落 main（结构理由，不是整洁偏好）**：链对齐载体是按 **blob** 比对的，
载体那枚文件只要挂着未提交补丁，main 每推进一次这枚文件，链就不敢对齐（怕覆盖我的补丁）——
14:48 现量：载体落后 main **41 笔**，脏的就只有那枚 `scripts/verify-mobile-notes.sh`。
不落的后果就是 ① 在落后 41 笔的载体上打四端产物，直接违反 Goal ① 的"装上 HEAD 产物"。
落完之后：`git checkout --detach 23bbf2f1` ⇒ `DIRTY=0`、`NOTES_HASH=df46f473`、`bash -n` 过。

**④ 链升 v21**：③ 的"输入核身"原来是拿两枚写死的 sha（合并态 `df46f473` / 推导底 `a7f6579b`）比对的；
补丁既然已进 main，那种比法只会随每次 main 推进而**无理由地拒跑**、把窗口浪费掉。
新腿改成自更新的：**工作树那份必须等于当前提交那份** + 四条 needle + `bash -n`。
四臂夹具 `heyta-v21-input-fixture.sh` **GREEN**，而且**断的是理由不是只断放行**——
G3 必须先 `commit` 才测得到 needle 那条腿，否则身份门抢先拦、臂"通过"得毫无意义。
真载体演练：sha 两边相等、needle 命中 1/6/1/7、`bash -n` 0 ⇒ 窗口一开这段不会再是新拦点。
v21 由 pid **15881** 起跑（第 1 轮 14:51:30），看守 96836 没动，日志沿用 `/tmp/heyta-chain17.log`（旧 120 轮不丢）。

**⑤ 本轮我又踩到的两副探针面目**（都进了记忆）：
`PSQ_COUNT=$((...+1))` 写在 `$(psql …)` 里 ⇒ 计数随命令替换的子 shell 一起消失，三臂全报 0，
读起来正是"形状门拦住了"；`list.count("一段字符串")` 是**成员判断不是子串包含**，恒 0，
我的守卫脚本因此把自己拦下一次。

**⑥ 窗口现量（14:51:30）**：v21 第 1 轮仍「设备在线但**不空闲**」（`pidof_com.heyta=[11631]`），
14:29 现量 1min load 43.48 / 阈值 12 ⇒ **①③ 仍未起**；③ 的输入侧现在没有已知拦点了。
