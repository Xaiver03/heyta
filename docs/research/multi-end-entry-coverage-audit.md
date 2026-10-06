# 多端入口覆盖审计：哪些功能该多端适配而没适配

**日期**：2026-10-02 · **方法**：两端全量清点（web 载荷 / 移动 RN）+ app-host 导出对照 + 抽查复核，全部结论带 `文件:行号` 证据
**判据沿用** [滴答对标审计](dida365-feature-benchmark.md) 的核心判据：**"做完了" = 有 action + 有调用点 + 有从用户动作出发的验收**。那份对标的是市场，这份对标的是**我们自己的端与端**。

---

## 0. 一句话结论

**桌面三壳结构上继承 web 载荷（零缺口）；真实的裂缝在 web 载荷 ↔ 移动 RN 之间**：清出 **3 条 P0**（移动端提醒永不响、通知中心/邀请活动移动端零入口、web 侧 due 事后无编辑入口）、**3 条 P1**（账号安全包、自家备份还原、AI 入口未上移动端）、**7 条 P2**（两端都缺的产品洞），另有 8 条**文件内明示的刻意取舍**（合法，登记不动）。

## 1. 审计方法与覆盖面

- **端的结构性事实**：macOS / Windows / Linux 三个桌面壳都加载 `apps/web/dist` ⇒ **web 有什么桌面就有什么**，web 的缺口即三桌面共同的缺口。独立对比只有两列：**web 载荷 vs 移动 RN**。鸿蒙无壳是已登记的既有立场（AGENTS §3.24），不算本轮发现。
- **web 侧**：rail 定义唯一来源 `apps/web/src/features/shell/view-tabs.ts`，22 个 `features/` 目录逐个盘。
- **mobile 侧**：5 tab（`apps/mobile/src/nav/TabBar.tsx:51-59`）+ 二级屏逐个盘；并与 `packages/app-host/src/index.ts` 全量导出对照，列出"共享层有、移动端从未 import"的能力。
- 抽查复核了三条承重结论：web `setDueDate` 在 store 外零 UI 调用（仅 `App.tsx:285` 的 postponeToToday）；移动端 `inbox`/AI/`changePassword`/`listPasskeys` 确实零 import；移动端子任务/优先级**有**入口（`TaskDetailSheet.tsx:605,871`）。

## 2. 什么算"应该多端"

1. **实体已同步 ⇒ 每端都该能建能改**：数据走 op-log 跨端同步，一端没有写入口，用户在那端就"看得见改不了"。
2. **核心闭环（捕获 → 排期 → 完成 → 复盘）每端完整**，允许**形态**不同（拖拽 vs 表单），不允许**缺能力**。
3. **平台专属能力**（通知、分享、小组件、通行密钥桥）按端适配，不强求对齐，但"该端没有"必须是有记录的立场，不是遗漏。
4. **合法单端**：运营管理后台（ADR-0038，单一运营者）、平台桥接层。不硬拉平。

## 3. 总矩阵（主要功能面）

| 功能 | web（=三桌面） | 移动 |
|---|---|---|
| 任务 建/改/删/完成 | ✅ | ✅ |
| **due 事后编辑** | ✅ 行尾「截止」+ 共享 DatePicker（**批一已修** 2026-10-02） | ✅ DatePicker（`TaskDetailSheet.tsx:677`） |
| 排期 startDate/时长 | ✅ 拖拽 + 点空白 | ✅ 详情表单（`TaskDetailSheet.tsx:688`） |
| 子任务 / 优先级 / 重复规则 / 提醒数据 | ✅ | ✅ |
| **提醒投递** | ✅ Notification API + 权限面板 | ~~⛔ **永不响**~~ ⛔→🟡 **2026-10-03 20:0x 现量更正：并行那条线已落地**（`com/heytamobile/reminder/ReminderModule.kt` + `ReminderPackage.kt` 在位、`AndroidManifest.xml` 里 `POST_NOTIFICATIONS` 1 处、契约 `docs/adr/0051-mobile-reminder-delivery.md`）—— **不是本条线做的，本行不代其主张验收读数**。（原批三停批记录如下，留着是为了让后来者认出这个形状：**批三停批** 2026-10-02：四个候选依赖无一过 §3.1/§3.2，逐条裁决见本文 P0-1；判据脚本 `scripts/verify-mobile-reminder-ring.sh` 已先行落地。要拍的"禁令前提"见 BLOCKED **B33**） |
| 清单/标签 建/删/取色 | ✅ | ✅ |
| 清单/标签 **改名**、父子、归档 | 🟡 **改名与归档两端已接**（2026-10-03 第三批，判据见 §4 P2-2 / P2-6）；**父子（层级）选择器仍未做** —— 🔴 2026-10-03 22:0x 实测：`ProjectActions` 接口面上**没有**改父的方法，但同文件 `:165` 那个模块内私有的 `updateProject(entityId, payload)` 是**开放 payload 的现成派发器**（rename/setColor/archive 都是它的一行包装）⇒ 写侧只差一个同样形状的接口包装 + 守卫；**真缺的是两端的选择器界面**，且 web 同样没有嵌套界面 ⇒ 跨端形态待裁决（取证命令与自我更正见 BLOCKED **B52**） | 🟡 同左（同一批、同一份判据） |
| 四象限 | ✅ 含拖拽换象限 | ✅ 无拖拽（刻意） |
| 日历 | ✅ 只读 + 勾完成 | ✅ 只读 + 勾完成 |
| 时间线 | ✅ 三手势 | ✅ 排期表单 + 点行进详情 |
| 习惯 建/打卡/目标/颜色 | ✅ | ✅ |
| 习惯 **改名与删除** | ✅ 详情窗格头部：内联改名框 + 删除（**墓碑** —— `listHabits` 滤掉、库里仍在，打卡历史一条都不动） | ✅ 详情层两个图标 + 内联改名框（判据 `apps/mobile/tests/organizer-rename.spec.ts` 里那条习惯 describe 4 条，见 §4 P2-3） |
| 便签 建/钉/删 | ✅ | ✅ |
| 便签 **编辑** | ✅ 便签视图里的编辑面板（共享 `NoteEditor`） | ✅ 二级全屏编辑屏（2026-10-03 第四批；判据 `apps/mobile/tests/note-edit.spec.ts` + `reminders-notes-display.spec.ts` 那条翻向断言；真机两张截图已入库并逐张写明各自钉到脚本第几步。🔴 **2026-10-05 03:19 更正**：原写"第 8 步之后三腿仍缺"已被 `verify-mobile-notes` 那趟 37 项全绿否证 —— 第三张截图、第 6/7 步 op 判据、第 9–11 步跨设备三条腿**都有读数**，见 `docs/plans/goal-multi-end-coverage.md` §7.30 的 ③ 收口那节） |
| 专注 / 分类报告 / 冲突解决 / 实时同步 | ✅ | ✅ |
| 搜索 | ✅ 可打开便签 | ✅ 可打开便签（2026-10-03 第四批：`SearchScreen` 传 `onOpenNote` → 同一个 `NoteEditScreen`。原文写的是「不可打开便签（刻意）」） |
| 回收站 | ✅ 仅任务 | ✅ 仅任务 |
| 成长统计 | ✅ 全量 | 🟡 **分享块已接**（2026-10-03，任务 4：`share` 走 RN 核心 `Clipboard`，小结文本来自 `@heyta/app-host#buildShareSummary`，判据 `apps/mobile/tests/growth-share-summary.spec.ts` 13 条 + 变异两臂）；**年度热力图 / 补打卡仍未接** —— 不是漏，是被冻结判据 `growth-display.spec.ts:365`/`:302` 钉着，见 BLOCKED **B41 / B42** |
| **通知中心 / 邀请活动** | ✅ 铃铛 + 活动 tab | ✅ 「我的」页「通知」入口行（未读徽标）+ 通知中心两 tab（**批二已修** 2026-10-02） |
| **AI 全家**（拆解/估时/优先级/捕获/工具/设置） | ✅ 6 入口 | ❌ **零入口**（**刻意不在本 goal**：出境闸门的移动语义要先裁决，见 goal §6 排除项与本文 P1-3）—— 但**判据已按端补齐**：`check:ai-coverage` 现在逐端枚举并打印 `mobile 0/5`，**一旦这一端 import 了任何一条 AI 入口而其余没接完就转红**（变异实测：塞两条探针 import ⇒ 精确点名缺的 3 条；还原 ⇒ 绿） |
| 导出 | ✅ 下载 | ✅ 系统分享 |
| **导入（自家 JSON 还原）** | ✅ ImportPanel | ✅ 「导出数据」页「从备份还原」卡：选文件 + 粘贴两条路 → 预检 counts → 确认（**批五已修** 2026-10-03；本机文件读取为什么必须走原生模块见 traps #124） |
| 滴答导入 | ✅ 面板 | ✅ 粘贴（刻意形态） |
| **改密码 / 通行密钥管理** | ✅ PasswordPanel + PasskeyPanel | ✅ 「账号与安全」入口行 → SecurityScreen（**批四已修** 2026-10-02） |
| 登出 | ✅ 清凭据 | ✅ 清凭据（等价） |
| 模块开关 | ✅ 7 模块 | ❌ 固定 5 tab（立场差异） |
| 订阅/权益可见 | ✅ 到期条 | 🟡 **「我的」页有一条权益卡**（2026-10-03，任务 4：`EntitlementSection` 消费 `app-host#fetchHostedEntitlementReading`，四态只渲两态）；**拿不到"到 X 日到期"**，因为 `entitled` 分支没有日期字段 ⇒ 要改服务端面，本批不许碰（BLOCKED **B45**）。设备级截图未取证 |
| 同步设置 / 隐私同意 / 小组件 / 语言 | ✅ | ✅ |

### 3.1 上面这几行的复跑命令与现量读数（2026-10-03 19:1x，载体 = `main` 上的本条线提交）

四条命令、四个退出码，每条对应矩阵里的一行或几行：

```bash
cd apps/mobile
npx vitest run tests/organizer-rename.spec.ts        # → exit=0  Tests 26 passed (26)
npx vitest run tests/note-edit.spec.ts               # → exit=0  Tests 15 passed (15)
npx vitest run tests/growth-share-summary.spec.ts    # → exit=0  Tests 13 passed (13)
npx vitest run tests/reminders-notes-display.spec.ts # → exit=0  Tests 17 passed (17)
```

| 矩阵行 | 命令 | 读数 |
|---|---|---|
| 清单/标签 **改名**、归档 | `organizer-rename.spec.ts` | 26 passed；`check:reachability` exit=0（PROJECT/TAG 各有 6 处宿主调用点） |
| 习惯 **改名与删除** | 同上文件的习惯 describe | 含在那 26 条里；钉的是"删除是墓碑、打卡历史一条不动、撤销后连续天数还在" |
| 便签 **编辑** | `note-edit.spec.ts` | 15 passed（含"改标题 ⇒ 恰好一条 UPD、载荷只有 content"） |
| 搜索 **可打开便签** | `reminders-notes-display.spec.ts` | 17 passed（含那条由 not.toContain 翻向 toContain 的 `onEdit=`，同时钉真 op 落点） |
| 成长统计 · **周小结带走** | `growth-share-summary.spec.ts` | 13 passed + 两次变异各自转红（摘掉 `share={share}` ⇒ 1 红；把共享层第二行改硬编码 ⇒ 3 红） |
| 订阅/权益可见 | 同上文件的权益段 | 含在 13 条里；`check:payment-entry` / `check:pricing` 各 exit=0 |

**没被这四条命令覆盖的两件事，别读成"已做完"**：年度热力图与补打卡仍被冻结判据
`growth-display.spec.ts:365`/`:302` 钉着（**B41 / B42**），真机设备级截图只跑到第 5 步（见 §3.2），
第 8 步之后的三腿仍缺（**B48 / B49**）。

### 3.2 便签编辑链的真机截图（2026-10-03 17:20，`apps/mobile/evidence/`）

两张图，**人都打开看过**（AGENTS §6.2 规定一），逐张写清看到什么：

| 文件 | 看到什么 | 证明到哪一步 |
|---|---|---|
| `android-notes-1-editor-open.png` | 顶部标题「编辑便签」+ 返回箭头，中间一个多行输入框，初值就是这条便签的当前正文 `note-e2e-171747-read-once`，底部「× 取消」与主蓝「✓ 保存」 | 脚本第 4 步：列表里那段摘要**点得开**，且打开的是共享 `NoteEditor` 那屏、**输入框初值 = 当前正文** |
| `android-notes-2-list-after-edit.png` | 「我的」页的便签卡片，正文已是**改过之后**的 `note-e2e-171747-edited`，卡尾带着「钉到今天 / 删除便签」，底部仍是 5 个标签（没多出第 6 个） | 脚本第 5 步：保存之后回到列表，**摘要真的变了** —— 不是只有输入框里变 |

**这两张凭什么算"当前产物"（traps #27 要求回答的就是这个）**：便签链上六个文件最后一笔写入都在
16:20–16:31（`notes/model.ts` 16:20:39、`NoteEditor.tsx` 16:21:28、`NotesBoard.tsx` 16:21:44、
`SearchScreen.tsx` 16:26:55、`NoteEditScreen.tsx` 16:30:50、`NotesSection.tsx` 16:31:23），
此后到现在 `git diff HEAD -- <六个>` 逐字为空；而这一趟的 needle 是 `note-e2e-171747`
（17:17:47 起跑），截图 17:20:20 / 17:20:36 —— **比源文件最后一次改动晚 46 分钟以上**。
另一条独立的时序证据：「编辑便签」这一屏由 `NoteEditScreen` + `NoteEditor` 渲染，
**这两个文件 16:21 之前不存在**，所以任何早于它们的构建根本画不出图 1 的样子 —— 旧产物这条假设在图面前不成立。
⚠️ 但**做不到逐字节复现**：磁盘上那枚 `app-release.apk` 已被 19:07 并行会话的另一次构建覆盖，
能对账的只有"文件字节没变 + 时序"这两条，这一条要写清而不是含糊过去。

**这两张没证明的（别读成"整条脚本过了"）**：
① `android-notes-3-from-search.png`（第 8 步：任务页搜索里点开便签）**不存在** —— 两张已有图的落点
分别在 `verify-mobile-notes.sh:394`（第 4 步）与 `:418`（第 5 步），第三张在 `:515`（第 8 步），
所以这一趟**至少走到第 5 步、确定没走到第 8 步**（中间第 6/7 步有没有过，日志没留、不猜），
"搜索 → 编辑屏"这条腿因此**只有单元测试证据**（`reminders-notes-display.spec.ts` 17 条），没有真机证据；
② 第 6 步「恰好一条 `UPD`、载荷只有 `content`」、第 7 步「没改动就一条都不写」、第 9–11 步
「服务端数得到 + 笔记本解密读到同一份新正文」三腿同样未取证。
整条脚本至今**没有一次跑通** —— 三次被环境挡的现量读数在 `BLOCKED.md` **B48 / B49**，
`verify-mobile-notes.sh:604` 那一步（截图落库对账）本身就是会因第三张缺失而转红的判据。

## 4. 真缺口清单

### P0 —— 核心闭环的洞，建议下一轮就做

**P0-1 移动端提醒永远不会响。** ⛔ **批三停批（2026-10-02，依赖裁决不过）**：四个候选逐一裁决无一可用——notifee 归档（§3.1 不过）、push-notification 停在 2021（§3.1 不过）、wix 过门禁但 v5 已无本地调度 API、expo-notifications 过门禁但被 pnpm monorepo 布局卡死集成。按 goal 硬规则终止本批并上报，未手搓绕行；判据脚本与触发链设计已先行落地（`scripts/verify-mobile-reminder-ring.sh`），解锁条件见 goal §7。原文：~~提醒在两端都能建（数据层完整），web 有到点投递（Notification API + 权限面板）；移动端是纯数据 op，package.json 无任何通知调度库 —— 用户在手机上设了提醒，**什么都不会发生**。~~

**P0-2 通知中心 + 邀请活动，移动端零入口。** ✅ **已修（2026-10-02，goal 批二）**：「我的」页「通知」入口行（未读徽标）→ 通知中心两 tab（通知/活动），消费 inbox 三函数（打开即自动已读；活动 tab 惰性拉取，与 web 同守"不瞎建邀请码"）；邀请卡经 `Share.share` 分享码。判据 = `verify:mobile-inbox` 真机零 mock（双账号真通知：B 走产品注册端点带码、TEST_MODE 自动结算 → A 徽标 ≥1 → 打开后清零；活动 tab 读到自己码 + chooser 出现）+ 截图人看 + 变异（拿掉自动已读 ⇒ 徽标清零判据转红）。原文：~~app-host 的 `inbox.ts` 三函数（index.ts:169-185）在 `apps/mobile/src` **零 import**：没有铃铛、没有活动页。~~

**P0-3 due 的事后编辑，web 侧（即三桌面）没有入口。** ✅ **已修（2026-10-02，goal 批一）**：行尾「截止」控件 + 共享 `DatePicker`（自 mobile 上提，两端同一只），判据 = jsdom op 形状 5 条 + 变异（恰好 3 红）+ 真浏览器 e2e（选日 → 徽章 → 刷新仍在）+ `verify:mobile-schedule` 7/7 回归。原文：~~移动端详情有 DatePicker；web 的 `setDueDate`（tasks/store.ts:98,289）**零 UI 调用点**，唯一相关动作是推到今天（App.tsx:285）。~~

### P1 —— 安全与数据对称

**P1-1 账号安全包未上移动端。** ✅ **已修（2026-10-02，goal 批四）**：「我的」页「账号与安全」入口 → SecurityScreen：改密码（`changePassword`，成功返回新会话 ⇒ **落盘轮换令牌并立即重验同步**——变异验证：拿掉落盘 ⇒ 判据以「登录凭据已失效」精确转红，12 绿 1 红）+ 通行密钥列表/改名/删除（409 最后一条如实报错）+ 空态如实说明"这台手机暂不支持注册，去电脑上注册"。判据 = `verify:mobile-account` 真机真服务端 13/0（`/api/test/create-user` 每轮建已知密码账号 → UI 改密 → 同步仍通 → `/api/login/email-password` 新密码换新会话 → 旧令牌 401）。**passkey 注册登记排除**：移动端无 WebAuthn 平台桥（`auth/passkey-host.ts` 是结论不是占位），接原生模块时只改那一个文件。原文：~~改密码（PasswordPanel，App.tsx:2163）、通行密钥增删改名（PasskeyPanel.tsx:150-200）web 全有；移动端只有魔法链接登录做兜底，`changePassword` / `listPasskeys` 等 hosted-auth 十余个函数零 import。~~

**P1-2 自家备份还原未上移动端。** ✅ **已修（2026-10-03，goal 批五）**：「导出数据」页新增**「从备份还原」**卡 —— 警示"只支持还原到空库" → 选文件（系统选择器）**或**粘贴 JSON 两条路 → `parseExportDocument` 预检并展示 counts → `restoreIntoEmptyTarget` → 界面数得见还原出的任务。判据 = `verify:mobile-restore` 真模拟器 + 真服务端零 mock，**当前产物（`57b0780f`）26 项全绿 / exit 0**（2026-10-03 08:26–08:35，emulator-5556）：真浏览器导出 → 截断版与垃圾内容**都被预检拒绝且说出人话**（一个字节都不写）→ 选文件读出「任务 3 · 清单 1 · 标签 1，5 条操作日志」→ 确认后任务列表 3/3（截图两张人已看）→ 还原后同步**不落失败态**，且手机自己写的那条 op 20s 内出现在服务端。

> 🔴 **这一行原先写的是「24 项全绿（run23，02:46–02:51）」，那是引用落后**：run27（06:02）就已经是 26 项（其间 `8ecc0575` 给脚本加了首条「web 载体可达」判据，把"等 pm clear 之后才发现连不上"变成开局就判）。2026-10-03 08:26 这一轮是在移动端 UI 换成 `Stack` / `Card gap` 重构**之后**重跑的，`apps/mobile/evidence/android-restore-{done,tasks}.png` 两张证据图也已换成这一轮的产物。
> 另记一条读数纪律：**判据点数 ≠ 执行数** —— 脚本里 `ok` 的**调用点** 21 处，跑出来的 ✅ 是 26 条，因为凭据那三格（服务器地址 / 访问令牌 / 加密口令）由一个循环点位打。引用"N 项"时要说清是哪一趟，而不是哪一份脚本。
> 🔴 两条**变异臂**也已在新产物上各自重证一趟（批五入账时它们跑在布局重构**之前**的产物上）：
> M2（`confirmRestore` 在写库前 `return`）**23 通过 / 2 失败**，M1（预检拒绝后不把原因说出来）**24 通过 / 2 失败**，
> 各自的红恰好是设计要抓的那两条；两臂都做了三段 sha256（变异前 = 还原后，逐字节相同）与两枚 APK md5（变异包 ≠ 干净包），
> 复跑腿重装干净包后回到 **26 / 0 / exit 0**。全部读数与"红→绿配对行号"在仓库内的
> `apps/mobile/evidence/verify-mobile-restore-arms-20261003.txt`（明细见 [`../plans/goal-multi-end-coverage.md`](../plans/goal-multi-end-coverage.md) §7.9）。
⚠️ **三条边界，都不算已验或不算已修**：
① **还原回来的数据只在这台设备上** —— `appendImported` 把这些 op 标成"不进上传队列"，因为备份里的 op 带的是**原设备**的 `clientId`，而服务端 `validateOp` 对不匹配的署名逐条回 `INVALID_CLIENT_ID`（`server/src/sync/services/validation.service.ts:75`）。这是既有设计（`packages/storage/src/db-op-log-store.ts:100`/`:161` 明写"不要为了让它也能上传把 source 改成 'local'"），**本轮只把界面文案改对**（原来那句"配置同步后会自动上行"是假的，见 traps #138）；"还原后多端可见"要成立需要一条新裁决（还原时按本机 clientId 重签），**未做**。
② **iOS 的"选文件"没有原生读取模块**（RN 0.84.1 在 Android 上根本读不出本机 URI，只能自带模块，见 traps #124；iOS 侧退到 RN 的 blob 通道，未在模拟器验证）。
③ 变异验证的两条臂（M1/M2）记在 goal §7 执行记录里。原文：~~手机能导出（系统分享），但 heyta 导出的 JSON **在手机上永远导不回**（`ExportScreen.tsx:24-28` 文件头明说）。导入/还原的对称性是数据安全承诺的一部分；`import-dump.ts` 的 `restoreIntoEmptyTarget` 现成。此缺口 AGENTS §5.1.1 已登记过，本审计重申其仍在。~~

**P1-3 AI 全家未上移动端。** web 有六个入口（拆解/估时/优先级/AI 捕获/工具调用/AI 设置）；移动端零。**前置裁决**：移动端要不要允许配 provider、出境闸门的"允许远程"在移动语义下是什么 —— 这是 ADR-0010 的延伸问题，不是纯 UI 活。

### P2 —— 两端都缺的产品洞（立项时按两端一起设计）

| # | 缺口 | 证据 |
|---|---|---|
| P2-1 | ✅ **已修（2026-10-03，多端第四批）**：便签**两端都能改正文**了。编辑器抽进共享层 `packages/ui/src/notes/NoteEditor.tsx` —— 两端各写一份「多行输入 + 保存 + 取消」最容易漂出来的差异是**一端点保存会落一条什么都没改的 `UPD`**：它推进 `updatedAt`，而列表按它排第二段，用户读到的是「我只是点开看了一眼，这条便签跳到最前了」。那条闸门本身在 `@heyta/app-host#updateNoteContent`（写不写 op 是产品语义，AGENTS §3.5），这一层保证的是**两端用的是同一个入口**，所以闸门只有一处、也只会被踩到一处。移动端是「我的 → 便签」的二级全屏 Modal，搜索结果里点便签进的是同一屏（`onOpenNote`）。判据 = `apps/mobile/tests/note-edit.spec.ts`（含「改标题 ⇒ 恰好一条 UPD、载荷只有 content」）+ `reminders-notes-display.spec.ts` 那条由 not.toContain(「onEdit=」) **翻向** toContain 的断言（同时钉住真 op 的落点）+ 摘掉 `onEdit` 的变异臂转红；`check:ui-language` / `check:reachability` 各 exit 0。**仍未闭合的是真机那半条**：17:17 那一趟**至少走到第 5 步、确定没走到第 8 步**就被环境挤掉了 ——第 4/5 步的两张截图已入库并逐张写明各自钉到哪一步（§3.2），但第 8 步「搜索里点开便签」的第三张、第 6/7 步的 op 判据、第 9–11 步的跨设备三腿**都还没有真机证据**。🔴 **这句于 2026-10-05 03:19 作废**：`verify-mobile-notes` 跑到 `NOTES_EXIT=0`（37 项全绿），三样各自都有读数（第三张 03:20 人真的看过；op 判据 = 恰好 1 条 `NOTE/UPD` 且载荷键集合 `[content]`；三条腿 = 手机库 1 条远端 op / 服务端恰 1 条 UPD / 笔记本解密后同一 entityId），见 `docs/plans/goal-multi-end-coverage.md` §7.30 的 ③ 收口那节 —— 原句留着是为了让后来者看清"当时是真的，缺的是窗口不是判据"。三次尝试的现量读数（负载 23.5 → 236、`:3100` 无服务、`:3000` 是并行会话的 e2e 栈）登记在 **B48 / B49**，按「环境无效 ≠ 产品失败」处理，不硬挤、不起第二个 postgres。**另有两条债本轮暴露并已补**：`NoteEditor.tsx` 与它的三处配套（`notes/model.ts` 的 `isNoteDraftBlank`、`NotesBoard.tsx` 改用同一条判据、`index.ts` 导出块）在第一笔提交里**漏了**（未跟踪的新文件不在按路径过滤的提交范围内），HEAD 单独检出编译不过；成因与反向查法记在 `PROGRESS.md`。原文：~~能建能删不能改，任何一端都改不了~~ | `NoteEditor.tsx`、`NoteEditScreen.tsx`、`NotesView.tsx`、`SearchScreen.tsx` |
| P2-2 | ✅ **已修（2026-10-03，多端第三批）**：清单/标签**两端都能改名**，标签补上原本根本不存在的动作 `renameTag`（一条 UPD、载荷只有 `name`，引用它的任务一个都不碰）。行内编辑器在共享 `OrganizerList` 里，两端各只多传 `onRename` + 两句无障碍名。判据 = `apps/mobile/tests/organizer-rename.spec.ts` 26 条（含"全局 op 数恰好 +1"这条防 fan-out、"重放后名字仍在"= 刷新还在）+ 变异两臂各自转红（摘掉移动端 `onRename` ⇒ 接线那条红；给 `renameTag` 载荷多塞一个 `color` ⇒ `expected ['name','color'] to equal ['name']`）；`check:reachability` exit 0。原文：~~web store 有 `renameProject` 零调用；移动端明示不做；标签连动作都没有~~ | `ListsSection.tsx`、`TagsSection.tsx`、`features/projects/{store,ProjectsPanel}`、`features/habits/{store,HabitsView}` |
| P2-3 | ✅ **已修（2026-10-03，多端第三批）**：习惯**改名 + 删除**两端都有入口（移动端详情层两个图标 + 内联改名框，web 窗格头部同款）。删除是**墓碑**（`DEL` + `deletedAt`，`listHabits` 滤掉、库里仍在），且**打卡历史一条都不动** —— 撤销后连续天数还在。习惯改名刻意**不许"删了重建"**：`HABIT_LOG` 按 (habitId, date) 寻址，换 id 会让历史静默失联（用例钉住 `Object.keys(fresh.habits)` 仍是同一条）。判据 = 同上文件那条 describe 的 4 条 + `check:reachability` 0。原文：~~建了删不掉，`HabitBoard.tsx:64` 明示未接~~ | `HabitsScreen.tsx`、`features/habits/HabitsView.tsx` |
| P2-4 | **回收站只覆盖任务**：清单/标签/习惯/便签软删后任何端都看不见、还原不了 | `tasks/store.ts:387` |
| P2-5 | **日历创建/拖拽**：两端日历都只读（只勾完成）；时间线 P2 的排期手势没有搬到日历 | `CalendarBoard.tsx:71` 唯一动作 prop |
| P2-6 | 🟡 **归档已修 / 层级选择器仍未做（2026-10-03，多端第三批）**：归档与**取消归档**两端可达，`archiveProject(id, archived)` 收的是**目标状态**；"显示已归档"开关只在 `archivedCount > 0` 时出现，口径由共享层 `archivedProjects()` / `toOrganizerTree(…, { includeArchived })` 唯一提供（两端各写一遍 filter 就是两份口径）。**只给 `onArchive` 不给回程 = 单向门**，所以三条必须同批落地，用例逐条钉住。**仍未做**：新建时的父级选择器 —— `createProject(name, parentId?)` 第二参在移动端没有调用点（web store 有），移动端建出来的清单恒为顶层。判据 = 同上文件的归档 2 条 + 接线那 1 条（`includeArchived: showArchived` 与开关必须同时在场）。原文：~~`createProject(name)` 单参，无层级选择器~~ | `ListsSection.tsx`、`features/projects/ProjectsPanel.tsx`、`packages/ui/src/projects/{model,OrganizerList}.ts(x)` |
| P2-7 | 🟡 **权益可见性有一条卡了，但"到期日"这一半仍缺（2026-10-03，多端第四批）**：移动端「我的」页新增 `EntitlementSection`，**唯一入口**是 `app-host#fetchHostedEntitlementReading`（此前它零消费这句已过期）。四态只渲两态：`entitled` 一句"官方托管同步已开启"、`denied` 按 `PERIOD_ENDED` 与其余原因分"到期"／"暂不可用"两句（不混成一句"请订阅"）；`unconfigured`/`unavailable` **整块不渲染** —— 探测失败不等于没权益，把"我不知道"画成"你被降级了"是界面在说谎。**仍缺**：`entitled` 分支的响应里**没有日期字段**（`entitlement.ts:71` 的 `HostedEntitlementReading` 只在 `denied` 带 `currentPeriodEnd`），所以拿不到"到 X 日到期"，要补必须动服务端面 ⇒ 本批白名单外（BLOCKED **B45**）。判据 = `apps/mobile/tests/growth-share-summary.spec.ts` 里挂载 2 条 + 判断串 7 条 + "本屏零 `t('web.` 调用、但复用一条 web 现成句子"1 条；`check:payment-entry` / `check:pricing` 各 exit 0。**设备级截图未取证**（同一台模拟器被并发验收占过，见 B39）。**触发条件不变**：计费上线前必须补到期日那一半（ADR-0023 红线的配套可见性）。原文：~~无任何权益 UI；app-host `entitlement.ts` 零消费~~ | `EntitlementSection.tsx`、`packages/app-host/src/entitlement.ts` |

小项杂记：移动端成长屏的**分享块已接**（2026-10-03 任务 4，`buildShareSummary` 从 web 搬进 `app-host` 供两端共用）；**年度热力图 / 补打卡按钮仍未接**，且这不是漏 —— 是被冻结判据 `apps/mobile/tests/growth-display.spec.ts:365`（热力图的无障碍名）与 `:302`（两个 Action 按钮）钉住的，翻它需要一次真机验收，逐条见 BLOCKED **B41 / B42 / B43**；移动端设置无帮助面板；`updateAccountLocale`（账号级语言）两端都没接（web 语言切换写设备层）。

### 审计追加发现（2026-10-02，批一实施中实测）

**行内 absolute 弹层会被任务列表的滚动容器裁掉**（同族于头像菜单当年被 rail 裁掉那一条）。批一给 web 补 due 编辑时实测：行容器是滚动容器（`overflow: hidden auto`）**且带 transform**（transform 祖先会成为 `fixed` 的包含块）——`position: absolute` 的面板几何正常（boundingBox 正确、点击可中），**但画不出来**，只剩一条白边；`fixed` 不 Portal 也一样被裁。DueEditor 的修法：**Portal 到 body + fixed + 实测锚点 + 滚动即关**（`apps/web/src/features/tasks/DueEditor.tsx`，取证探针 `e2e/due-editor-probe.cjs`）。同构的 **`TaskOrganizer` 弹层经探针实测同病**（中心点 `elementFromPoint` 命中的不是面板）——既有缺陷，本 goal 范围外，待独立立项修（修法同款，需它自己的判据与验收）。

## 5. 刻意取舍登记（合法，不动）

- **四象限拖拽换象限**：移动端不做，改两步走详情（`QuadrantScreen.tsx:51-56`）。
- **搜索结果不可打开便签**（移动端）：`SearchScreen.tsx:22-33`。
- **时间线拖拽手势不上移动端**：排期走详情表单 —— 本次 goal §9 记录的立场。
- **模块开关不上移动端**：web 用开关收窄 rail，移动端固定 5 tab；两种 IA 各自成立，但**值得一句跨端立场说明**（哪个是原则、哪个是权宜）。
- **导出形态**：web 下载 vs 移动系统分享。**滴答导入形态**：web 面板 vs 移动粘贴。
- ~~**成长屏移动端裁剪**：无热力图/分享。~~ 🟡 **这句到 2026-10-03 只剩一半，且剩的那半不是立场**：分享块已接（复制走 RN 核心 `Clipboard`，见 §4 小项杂记）；**热力图仍没有**，但拦它的是冻结判据 `growth-display.spec.ts:365`，不是"小屏放不下"这条设计判断 —— 所以它已从"合法单端形态差异"移进"有主的小一步"（BLOCKED **B41**）。
- 番茄钟/成长/便签 web 默认关模块，移动端 focus 常驻 tab —— 同"模块开关"条。

## 6. 合法单端

管理后台（ADR-0038）；通行密钥的浏览器平台桥（`passkey-browser.ts`）；各端壳级能力（托盘、自截屏、小组件实现）；鸿蒙整端（已登记 §3.24）。

## 7. 与既有文档的关系

- [滴答对标审计](dida365-feature-benchmark.md)（2026-09-28）的 13 项"看起来有、其实没有"，本审计实测其**此后变化**：时间线已重做（goal §9）、移动端子任务有入口、便签可建、web 提醒投递已接；**仍未修**：移动提醒投递、日历只读、便签编辑、回收站范围。
- [ADR-0036](../adr/0036-main-battlefield-and-rn-single-source-ui.md) 定主战场 = 移动 + macOS + Windows。桌面吃 web 载荷 ⇒ **P0-3（due）直接命中主战场两端**，权重由此上调。
- 本次排期多端适配的执行记录：[goal-timeline-rework.md](../plans/goal-timeline-rework.md) §9 —— 它验证了"共享层现成 + 壳层挂载 + 逐端判据"这套补缺口的做法，P0-2 / P1-1 可直接复用。
