# P2：多端补齐

> 🔴 **2026-09-28 收敛：本文件已被 [`multi-platform-adaptation.md`](multi-platform-adaptation.md) 与
> [`desktop-native-migration.md`](desktop-native-migration.md) 取代，二者又由
> [`multi-end-unified-strategy.md`](multi-end-unified-strategy.md) 收敛。本文件只作历史，不要照它开工。**
> 🔴 **2026-09-29 追加口径收敛：「下一步」只在
> [`multi-end-unified-strategy.md`](multi-end-unified-strategy.md) §11 维护** ——
> 本文件（及 roadmap §5）都不再作为待办入口，也不复述下一步。
> ⚠️ 本文件的状态行是解不开的口令噪音（不是计划状态）—— 这也是它该被归档的信号。
> 索引见 [`README.md`](README.md)。

- **状态**：🔴 **已被取代**（原文误写为"进行中"）
- **上游决策**：[ADR-0003 多端策略](../adr/0003-multi-platform-strategy.md)
- **前置**：P1 单端闭环 ✅

---

## 1. 这一阶段的真实目标

P1 结束时的状态是：**Web 端能跑通完整闭环，但"多端"一个字都还没被验证过。**

ADR-0003 立了两条硬要求，P1 只满足了其中一半：

| ADR-0003 的要求 | P1 结束时 |
|---|---|
| 业务逻辑全在 `packages/`，`apps/*` 只放壳 | ✅ 已满足（`packages/domain` 无框架依赖） |
| **`DbAdapter` 有多个实现，且同一套契约测试跑遍所有实现** | ❌ **未满足**：只有 IndexedDB 一个实现，测试还是实现专属的 |
| 跨语言加密互操作可验证 | ✅ P0 已有 |

🔴 **所以 P2 的第一件事不是写原生界面，而是把"存储可替换"从声明变成事实。**

原因很直接：只有一个实现时，接口上一切被 IndexedDB 的具体行为悄悄决定的东西
（键的比较顺序、唯一索引冲突时整条记录不入库、布尔不能当键、访问未在事务范围内的
store 要报错……）都不会有人发现 —— 直到移植到 SQLite 时才集中爆炸，
而那时已经有真实用户数据在上面了。

---

## 2. 工作项

### 2.1 存储契约（✅ 已完成）

- `packages/storage/tests/contract/adapter.contract.ts`：24 条共享契约
- `MemoryDbAdapter`：参考实现
- `IndexedDbAdapter`：Web 生产实现
- `StoreSchema` 提到 `db.types.ts` —— 各实现不得自定义自己的 schema 类型

**加入一个新实现 = 在 `tests/contract.spec.ts` 加一行。**
不允许为某个实现另写一套断言，那样测的是实现者的假设而不是接口。

> 这一层的价值已经兑现：契约第一次跑就在参考实现里抓出两个真 bug
> （multiEntry 索引恒不命中；并发事务被误判为嵌套）。见提交 `dc203df`。

### 2.2 SQLite 适配器（✅ 已完成）

iOS 与鸿蒙**必须**用 SQLite（ADR-0003 §2.2：WebView 的 IndexedDB 会被系统清理，
本地优先应用丢本地数据不可接受）。

要求：

- **驱动注入**，不写死具体绑定：Node 测试用内置 `node:sqlite`，
  iOS / 鸿蒙各自注入平台绑定。适配器逻辑只存在**一份**。
- 通过**与 IndexedDB 完全相同的**契约套件。
- 复合主键的排序必须与 IndexedDB 的键序一致（number < string < array）。
  不能简单按 JSON 字符串排 —— 那会把 `10` 排在 `2` 前面。
- 事务必须真回滚，包括对**已有记录**的修改。
- 新测试：数据能跨 `close()` / 重开持久化。

**完成情况**：与 IndexedDB、内存实现跑**同一份** 24 条 `DbAdapter` 契约 + 21 条
`OpLogStore` 契约（三个引擎共 135 条）。加它只需要在 `contract.spec.ts` 加一行。

复合主键拆成 `pk0..pkN` 列按列排序；所有键列**不声明 SQL 类型**（BLOB 亲和性），
否则 INTEGER/TEXT 亲和性会把 meta 的键 `'123'` 静默变成整数 `123` 而与别的键合并。

### 2.3 非 Web 宿主验证（✅ 已完成）

要求里说"至少一个非 Web 端壳，有真实读写 + 同步验证"。

⚠️ **这里有一个我不打算擅自决定的选型**，见 §3。但**有一个不依赖它的做法**：

**用 Node 做一个最小宿主**（CLI 或后台进程），跑真实的
op-log 引擎 + SQLite 适配器 + 同步客户端，对着真实服务端做读写与同步。

它验证的是 ADR-0003 最核心的那条主张 —— "业务逻辑全在 `packages/`，换宿主只是换壳" ——
而**完全不需要先决定 UI 技术栈**。如果 Node 宿主能跑通，说明分层是真的；
如果跑不通，说明还有逻辑漏在 `apps/web` 里，那正是现在就该发现的事。

**完成情况**：`apps/node-host/`（`@heyta/node-host`）把
`NodeSqliteDriver → SqliteAdapter → DbOpLogStore → OpLogEngine → SyncClient`
接起来，只注入平台差异（**真实 SQLite 文件**、`fetch`、令牌、口令）。
CLI 提供 `add` / `list` / `rename` / `complete` / `reopen` / `sync` / `pending`；
**所有写入都过 `OpLogEngine.dispatch()`**，CLI 里没有一处直接改状态。
设备 id 与同步游标存在与 Web 端**同一个 `META_KEYS`** 下，所以两端的本地库
结构完全一致 —— 这是"换存储实现上层一行不用改"的直接结果。

零 mock 验收：`pnpm verify:p2`（`scripts/verify-p2-node-host.mjs`）自带真实
Fastify + PostgreSQL，两台独立宿主各用一个 SQLite 文件，**每条命令都是新进程**：

1. A `add` → **另一个进程** `list` 仍能读到（重启不丢 = 真落盘）
2. 绕过适配器，用 `node:sqlite` 直接读 `ops` 表原始行（数据真的在表里，
   且同步前 `uploadStatus === 'pending'`）
3. A `sync` → 待上传队列清空 → B `sync` 看到 A 的任务（两端 `clientId` 不同）
4. B 改名并 `sync` → A `sync` 后看到 B 的编辑（双向）
5. 服务端只存密文（`isPayloadEncrypted: true`，明文标题不出现）

**关键发现（好消息）**：宿主**没有改动 `packages/` 或 `apps/web` 一行**。
分层是真的 —— 换宿主确实只是换存储实现与网络注入。

**但曾有一处诚实的接缝**：`SyncClientOptions` 的那十来个回调
（`getLocalOps` / `markUploaded` / `applyRemote` / `redispatch` …）在
`apps/web` 与 `apps/node-host` 里各接了一遍。

**✅ 已解决（移动端落地时触发）。** 计划里原本写着"若将来第三个宿主出现，
值得把这段接线提到 `packages/` 里" —— 移动端就是第三个宿主，条件已满足。
新增 `packages/app-host`，`apps/node-host` 从 **270 行降到 129 行**，
只剩一处平台差异（`driverFactory`）。

抽取时发现了比"样板重复"更严重的事：**两份任务 op 构造已经漂移了**。
`apps/node-host` 用 `crypto.randomUUID()` 生成 entityId **且没有回退**，
而 `apps/web` 用 `Date.now()+counter` 且有回退。移动端（Hermes 没有
`randomUUID`）会在**用户点"新建任务"的那一刻**抛异常。
现在 id 生成与 op 构造都只有一份（`packages/app-host/src/ids.ts` / `actions.ts`）。

**重构没有改变行为**：`pnpm verify:p2` 仍然 8/8 全过（真实 SQLite 文件、
两个独立宿主经真实服务端双向同步、服务端只存密文，全程零 mock）。

**验收确实能失败**：把 Host B 指向死掉的端口（`http://127.0.0.1:9`）后，
`pnpm verify:p2` 退出码 1，输出
`❌ P2 验收失败：宿主命令失败（B sync：sync），exit=1`，
并打印宿主返回的 `{"kind":"offline"}` 与保留的现场目录；恢复后重新通过。

### 2.4 设计变量生成器（✅ 已完成）

`packages/design-system` 是 CSS 变量，SwiftUI / ArkUI 不能直接用。

要求：值只在 `tokens.css` 定义一次，其余平台由它**生成**。
**不许各端各写一份色值** —— 那就是漂移的开始。

**完成情况**：生成 Swift / ArkTS / JSON / React Native TypeScript 四份产物
（`generated/HeytaTokens.swift` / `HeytaTokens.ets` / `tokens.json` +
`src/generated/tokens.native.ts`）；**191 个 token + 73 个暗色 + 6 个
reduced-motion**，**402 个测试**覆盖（含对生成结果重算 WCAG 对比度）。
（数字实测：`pnpm --filter @heyta/design-system run generate` 打印
`4 个文件（191 个 token；暗色覆盖 73；减少动效 6）`；
`pnpm --filter @heyta/design-system run test` → `Tests 402 passed`。）

已独立验证过它是**解析**而不是**复制**：改 `tokens.css` 里的 `blue-600`，
生成物真的跟着变；不重新生成时 `generate:check` 退出码非 0；
`swiftc` 编译产物并运行，明暗与 reduced-motion 取值都正确。
漂移检查已接进根 `pnpm check`（`check:tokens`）。

⚠️ 以下 token **没有**干净的原生对应物，按字符串原样导出并在产物头部列出：
`font.sans/mono`、`ease.*`、`shadow.*`、`layout.prose-max`（`65ch` 依赖字号）。
没有 token 被静默丢弃或硬凑成数字。

---

### 2.5 移动端冲突解决闭环（✅ 已完成）

P1 把"冲突能被识别并结构化上报"做到了 Web 端，但**移动端此前只有一句
"解决界面尚未实现"** —— 诚实，可用户**无处可选**：数据两边都没丢，
却会一直卡在待上传队列里，同步事实上停摆。

现在补完：`apps/mobile/src/screens/ConflictSheet.tsx` 把双方内容并排摆出来，
每一处给出「保留这一版」，两个方向都重新派发 op-log。

**验收：`pnpm verify:mobile-conflict`（真模拟器 + 真服务端，零 mock，24 条断言）。**
它不是构造一个 `ConflictInfo` 喂给界面，而是**真的把冲突造出来**：

1. 手机建任务并同步 → 服务端 `{phone:1}`
2. 「笔记本」（`apps/node-host`，真 SQLite 文件）同步下载它、改标题、同步
   → 服务端 `{phone:1, laptop:1}`
3. 手机**在没下载到笔记本那条的前提下**勾完成 → 本地 `{phone:2}`（与上一步并发）
4. 手机同步 → 上传被 `CONFLICT_CONCURRENT` 拒绝 → 界面出现「有 1 处冲突待你选择」
5. 点「逐条处理」→ 点「保留这一版」→ **两端收敛到同一个值**（脚本逐条断言）

**这个脚本抓出了两个真缺陷，都不是测试问题：**

- 🔴 **凭据会在首次同步之前丢失。** 用户填完令牌/口令后切到别的标签再回来，
  两个字段就空了 —— 因为写入活配置只发生在点「立即同步」那一刻，
  而这一屏在切换标签时**会被卸载重建**。服务器地址因为有默认值而"看起来还在"，
  所以症状像是"只有令牌没保存"。修法：输入即写入活配置。
- 🔴 **服务端的英文诊断漏进了全中文界面。** 冲突行显示的是
  `Concurrent modification detected for TASK:task-...`。根因是一条**断了的数据通路**：
  机器可读的 `errorCode`（`CONFLICT_CONCURRENT`）早就拿到了，
  但 `ConflictInfo` 没把它带出来，界面于是回落到 `reason`（服务端那句英文）。
  而中文文案**一直躺在 `REASON_LABELS` 里从没被用过**。
  修法：`ConflictInfo` 增加 `errorCode?`，界面取文案的顺序改为 `errorCode ?? reason`；
  查表查不到时给**通用但仍然准确**的中文，**绝不回落成原始字符串**。

> 单元测试没能挡住第二个缺陷，原因值得记住：测试 fixture 把
> `reason` 写成了 `'CONFLICT_CONCURRENT'` —— 也就是**把编码填在了诊断字段里**。
> mock 是按实现者的理解写的，理解错了 mock 跟着错（同 AGENTS.md §7 第 4、7 条）。
> 现在 fixture 用真实形状（英文 `reason` + `errorCode`），并有两条注入验证过会变红。

⚠️ 仍然没做的：iOS ATS 的明文策略（需要产品决策）、鸿蒙壳、
原生 Argon2 模块（首次同步在 Hermes 上仍需约 30–40 秒，见 §7 第 26 条）。

### 2.6 移动端任务可编辑（✅ 已完成）

在这之前，移动端能做的只有三件事：建一个**只有标题**的任务、勾完成、删除。也就是说：

- 截止日期设不了 → 所有任务都落在「收集箱」，**「今天」永远是空的**；
- 优先级设不了 → `TaskActions.setPriority` 写好了却没有入口；
- 标题改不了 → 打错一个字只能删掉重建。

而「今天」是这个产品的核心视图。**数据层早就齐了**
（`rename` / `setDueDate` / `setPriority` / `setCompleted` / `remove`），
缺的一直是界面 —— 缺一个字段，等于缺一整个视图。

现在补完：点任务行打开 `apps/mobile/src/screens/TaskDetailSheet.tsx`，
可改标题、设截止日期（`apps/mobile/src/ui/DatePicker.tsx`：今天/明天/本周末/下周一
快捷项 + 6×7 月历）、设优先级、标记完成/未完成、删除；
任务行右侧可在 **日期 / 倒计时** 两种说法之间切换。

**验收：`pnpm verify:mobile-edit`（真模拟器 + 真服务端，零 mock，28 条断言全通过）。**
它不只断言文案，还断言**数据落到了另一台设备**：
`apps/node-host` 的 `list` 现在输出 `dueDate` / `priority`，脚本读它来确认
`priority == 3` 且 `dueDate` 非空（实测 `dueDate=1790352000000 priority=3`）。

**两处分工判断：**

- 「日期 / 倒计时」的文案与紧迫度在 `apps/mobile/src/lib/due-display.ts`；
  月份算术（`monthGrid` / `addMonths` / `formatCompactDate`）在 `packages/domain`。
  `formatCompactDate` 原本是 `apps/web` 里的一份私有实现 —— 移动端要用就得复制第二份，
  所以**上移并删掉旧的那份**（AGENTS.md §3.5：抽取的收尾动作是删掉旧实现，不是写个更好的新版本）。
- 优先级是**数值枚举**（`Priority.High = 3`），最容易写出"永远为假"的条件，
  于是"数值 → 文案 / 语义色"的映射只写在 `apps/mobile/src/lib/priority.ts` 一处，并配可失败的测试。

**这个脚本抓出了两个真缺陷，都不是测试问题：**

- 🔴 **遮罩和关闭按钮共用同一个可访问名，于是面板关不掉。**
  遮罩是一条覆盖全屏的 `Pressable`（点它关闭），它和右上角的关闭按钮都叫
  「关闭任务详情」。按名字定位取到的是**遮罩**，而遮罩的"中心点"正好落在面板底下 ——
  点下去打在面板上，面板不关（脚本连点 5 步都没关掉，之后每一步都在"面板还开着"的
  状态下找列表行）。这不是测试的毛病：两个做同一件事的控件本来就不该共用一个名字。
  修法：遮罩 `accessible={false}` + `importantForAccessibility="no"` +
  `accessibilityElementsHidden`，移出无障碍树。
- 🔴 **新建的任务出现在列表最底部。** `listTasks()` 里有一条刻意写下的排序：
  `createdAt` **升序**，注释写着"顺序必须在所有端一致 —— 否则同一份数据在两台设备上
  显示不同顺序"。**规范顺序是对的，不该动。** 但列表是**视图**，
  升序展示的实测后果是：任务一多，刚建的那条落在屏幕外，
  用户唯一的反馈是角标从 9 变成 10 —— 会怀疑"我到底加上了吗"。
  修法：规范顺序不动，`TasksScreen` 在**分组内倒序展示**。

**四条实测教训：**

- 🔴 **「在 dump 里」不等于「可点」—— 这是第三次复现，每次都换一个地方。**
  面板的 `ScrollView` 会把下半部分裁掉，被裁的节点**照样在无障碍树里**，
  但 `bounds` 的 top 大于 bottom（实测优先级芯片是 `[426,2141][531,2100]`，高度 **-41**）。
  按名字取到的"中心点" `(478,2120)` 落在裁剪区，点下去什么都没发生，
  而日志会写"已点「高」"。共享库因此加了 `desc-sane`
  （只认高度为正、且中心在标签栏之上的节点）与 `scroll_to_desc`。
- 🔴 **RN 的 `Modal` 打开时，底下的屏幕不在无障碍树里。**
  实测：面板开着时 `dump` 里只有面板内容，**查不到任务行**。
  所以"行上的状态对不对"这类断言**必须先关掉面板再做** ——
  否则一条本来成立的断言会因为查不到节点而报红，而**假红会掩盖真问题**
  （本轮就把"点行没勾完成"错报成了失败）。
- 🔴 **首次同步的耗时完全取决于宿主机负载，而"慢"会被报成"失败"。**
  同一份代码、同一个窗口：load 3 时约 40 秒通过；load 43–151 时实测**超过 300 秒**
  （任务建于 03:12:57，300 秒窗口 03:18 到期，**实际 03:24 才成功**）。
  失败现场（状态停在"正在上传…"、待上传 4 项、上次成功同步"从未"）
  **看起来就像同步协议坏了**，而数据其实早已到达服务端 —— 这一点是"笔记本能拉到
  完整字段"这条断言反证出来的。修法两条：`wait_synced` **回显耗时**
  （让日志能区分"慢"与"卡死"；不回显时两者长得一模一样），
  以及编辑验收改用**结果判据** `wait_laptop_has` —— 不看本机的状态标签，
  而是轮询**另一台设备能不能拉到这条任务**。
  轮询笔记本在 V8 上派生一次密钥约 0.6 秒（有 JIT），比轮询手机界面便宜得多；
  改完之后实测 50 秒通过。

- 🔴 **断言必须知道"做完这一步，那个东西会到哪儿去"。**
  勾上完成后，那条任务会**移进「已完成」分组**（列表最底部）。
  我在原地用 `has_desc "取消完成：…"` 找翻转后的标签，连续两轮报
  "勾选框点了但完成状态没变" —— 而把手机上的 op-log 拉下来一看，
  记着 `completedAt` 的那条 UPD（`ts=1790365139579`）**早就写进去了**。
  同一个根因还让第 8 步误报"手机没显示笔记本那一版"。
  两处都改成 `scroll_to_desc` / `scroll_to_text` 滚过去找之后即通过。
  **假红比假绿更贵**：它会让人去改本来正确的代码 —— 这一轮我差点就去动完成逻辑了。

> 🔴 **共享库 `scripts/lib/mobile-e2e.sh` 曾被一条写文件的方式截成 0 字节。**
> `open(p,'w').write(open(p).read()...)` 里外层 `open(p,'w')` **先把文件截断了**，
> 内层读到空字符串。改脚本文件时**先把内容读进变量再写**，别在同一个表达式里既开写又开读。

⚠️ 仍然没做的：**暗色主题从未在真机上看过**；长按与新建面板的完整流程没跑过；
`TASK_REPEAT_CFG` / `REMINDER` 仍未物化；
iOS ATS 的明文策略与鸿蒙壳同 §2.5。

### 2.7 移动端日历（✅ 已完成）

`日历` 是这个产品的第二个核心视图：「任务」页回答"现在该干什么"，它回答"哪天有什么事"。
在此之前它是 `NotYetImplemented.tsx` 里的一个占位 —— 一个**看得出来的**未完成，
而不是画一屏假数据（假数据会让"日历还没做"这件事只存在于某个人的记忆里，不在产品里）。

现在四个标签**全部是真实屏幕**，`screens/NotYetImplemented.tsx` 已按它自己文件头写好的
方式删除（"实现一个就移走一个，最后删掉它"）。

**日历数学一行都不在界面里。** `monthGrid`（固定 6×7、周一开头、补白格带真实日期）、
`startOfMonth` / `addMonths` / `isoWeekday` / `daysInMonth` 早就在 `packages/domain`，
而且 Web 端用的是**同一份**。本轮真正新增的是**展示约定**，同样放进领域层：

- `formatDayTitle(date)` —— 「9月26日 星期五」。它是从 `apps/mobile/src/lib/date.ts` 的
  `formatToday(now)` **上移而来**的：那个收时间戳、用全称星期；日历需要同一件事时
  会写出第二份（收 `LocalDate`、用简称），于是同一个日子在「任务」页显示「星期五」、
  在日历里显示「周五」—— 这种差异不会有人报 bug，它只会让应用显得不整齐。
  按 §3.5 的收尾方式处理：**先搬用例、再删旧实现**（原用例已迁到
  `packages/domain/tests/calendar.spec.ts`，先搬是为了让"删掉的那份还有人依赖"立刻变红）。
- `WEEKDAY_LABELS` —— 列头 `一 二 三 四 五 六 日`。放领域层的理由不是"少写一行"：
  它必须与 `monthGrid` 的周一开头**对齐**，任一端写错就整体错一格，
  而错位后的界面看上去仍然是个正常日历。

**验收：`pnpm verify:mobile-calendar`（真模拟器 + 真服务端 + 真笔记本设备，零 mock，23 条断言全通过）。**

判据的**独立来源**是这个脚本的关键：期望值全部由**宿主机上的 Python** 现算，
日期取自**设备时钟**（`adb shell date`，不是宿主机时钟）。
拿 `monthGrid` 去核对 `monthGrid` 永远自洽 —— 整体偏一天也一样自洽。

它证明的是**接线**，不是数学：

| 断言 | 单元测试为什么覆盖不到 |
|---|---|
| 月份标题 / 星期列头 / 今天那一格 = Python 算出的值 | 算对了的网格有没有真的画到屏幕上 |
| **笔记本**建的任务落在「9月15日 星期二」那格，且那天只显示 1 个任务 | 截止时间同步过来了，且分到了对的日子 |
| 点那天 → 列表出现该标题；点「回到今天」→ 它**消失** | `onPress` 真的带上了那一格自己的日期 |
| 日历页勾选 → 手机本地落一条该实体的 `UPD` op | 勾选走的是 op-log，不是本地 state |
| 手机同步后，**笔记本**读到的 `completedAt` 不再是 null | 手机上的一个日历操作真的跨了设备 |

> 最后一条是"能多端"的最终判据。为此给 `node-host` 的 `add` 加了 `--due <本地日期>`
> （它只把参数转交给 `createTaskActions().create`，壳不解释任何字段）——
> 在手机上自己建一个的话，"放对了没有"就退化成"我刚填的日期有没有被读回来"。

**这个脚本抓出的两个真缺陷：**

- 🔴 **`parseLocalDate` 只校验格式、不校验范围。**
  `new Date(2026, 12, 40)` **不报错** —— 它自动进位成 `2027-02-09`。
  实测：`add --due 2026-13-40` **建出了一条截止到 2027-02-09 的任务**，退出码 0，
  输出里还回显着用户写的那串字符。这类"输入非法 → 结果合法但错误"比直接崩掉危险得多：
  崩掉会有人来修，错一天只会让用户在某天发现事情没提醒。
  修法是构造后**回读一遍**（年 / 月 / 日三项逐项相等），任何进位都抛错。
- 🔴 **下游因此长出了第二份校验，而且形状是错的。**
  `capture.ts` 的 `makeLocalDate` 一直在自己做"`parse → toLocalDate` 往返比对"，
  因为那时上游不做。上游补上之后，它假定 `parseLocalDate` 会**返回**一个滚过的 Date，
  于是新抛出的异常直接穿出去：`parseCapture('2月30日交')` 从"解析不出来"变成了"抛错"，
  而用户输入里带一个不存在的日期是很常见的。
  这是 AGENTS.md §3.5 的同一种形状（**上游缺校验 → 下游长出第二份**），
  而它被**已有的用例**当场逮住 —— 不是测试问题，是模型问题。
  修法：下游改成"尝试构造，失败返回 `undefined`"，把"这个日期不存在"交给唯一那处判定；
  原用例保留，另加一条"必须**安静拒绝**、不能抛错"。

**四条台架教训：**

- 🔴 **`tap_label` 原本只写在 `verify-mobile-focus.sh` 里**，于是日历验收直接
  `tap_label: command not found` —— 第 3 步（首次同步）静默失败，后面每一步都在
  错的前提下继续跑。已移进 `scripts/lib/mobile-e2e.sh` 并**删掉旧的那份**。
  `mobile-e2e.sh` 的文件头早就写过这个教训（复制一份 = 迟早漂移），这是第二次。
- 🔴 **我自己写了一条假的断言，是"注入"把它抓出来的。**
  最初第 7 步写的是 `has_desc_sub "$TODAY_TITLE"` —— 看着像在断言"今天那一格"，
  实际只证明了"网格里**存在**这一天的格子"，而月视图里**任何一天都存在**。
  验证的办法不是重读它，而是**把期望值整体 +1 天再跑一遍**：
  它照样报 ✅「今天那格是「9月27日 星期日 …」」，**23/0 全绿** ——
  而它描述的正是"整体偏一天的日历"。
  改成读 `selected`（"**唯一**处于选中态的那一格，且它就是今天"）之后，
  同一条注入真的红了：**7 项失败**（第 6/7/8/10/11/12 步）。
  **这就是 §8.3 的用法：先造一个必须失败的输入，再看它会不会失败。**
  一条不会红的断言和一个恒真的表达式没有区别。
- 🔴 **看退出码时不要接管道 —— 否则会给自己造一个假缺陷。**
  上面那次注入我写的是 `bash 脚本 | sed -n ...`，于是日志末尾显示 `exit code: 0`
  而它明明报了 7 项失败。管道的退出码取自**最后一个命令**（`sed`），
  脚本自己的 `exit 1` 被吃掉了。我差点据此去"修"那个退出码 ——
  直接调 `summary` 才确认它一直是好的（`FAIL=2` → 退出码 1）。
  ⚠️ 顺带一个同形状的坑：**`PASS=0; FAIL=0` 在共享库的第 38 行**，
  所以复现实验必须**先 source、再设 `FAIL`** —— 反过来设会被初始化无声覆盖，
  于是"有失败项也退出 0"。我第一版复现实验就是这么写的，两次错误叠在一起，
  很容易得出"门禁是坏的"这个结论。
- ⚠️ **`list` 的空结果是"（没有任务）"这一行，不是零行。** 我用 `wc -l` 判断
  "非法日期有没有建出任务"，得到 1，差点据此认为修复没生效 —— 实际那 1 行是
  那条提示。断言结构化输出必须解析 JSON 里的 `tasks` 长度。

### 2.8 移动端重复任务（✅ 已完成）

**做到了什么**：任务可以设「每天 / 每周 / 工作日 / 每月」，规则**同步到其它设备**，
勾选完成后**到期日顺延到下一次**，并且这个顺延语义**设备无关**（在笔记本上勾也一样）。
验证：`pnpm verify:mobile-repeat`（真模拟器 + 真服务端 + 真笔记本，15 步零 mock）。

#### 2.8.1 🔴 规则为什么放在 `Task` 上，而不是 `TASK_REPEAT_CFG` 实体

上游的形状是"任务持有 `repeatCfgId`，规则放另一个实体"，heyta 的 schema 里也一直留着
`TASK_REPEAT_CFG` 这个实体名（`Task.repeatCfgId` 从第一天就在，**从未被任何代码写入过**）。

**但本引擎做不到一个 op 写两个实体类型。** 证据（不是推断）：

| 位置 | 事实 |
|---|---|
| `sync-core` 的线类型 `MultiEntityPayload.entityChanges` | **带 `entityType`** —— 看着就是为跨实体准备的 |
| `packages/op-log` 的 reducer | **一处 `isMultiEntityPayload` 都没有** —— 那条 op 会被当成普通字段合并，**静默不生效** |
| `OpIntent` | 只有单一 `entityType` + 同类型的 `entityIds` |

于是"设一次重复"走两实体就必须发**两个 op**，而第二个落地的瞬间状态是
"任务指着一个还不存在的规则"——§3.4 的"一个用户意图 = 一个 op"正是拦这个。

**决定**：规则放在 `Task.repeatRule` / `Task.repeatDtstart` 两个**可选**字段上 ——
一个 op、原子生效、不需要动 reducer，也符合 §3.3（可选字段，旧数据优雅降级）。
`Task.repeatCfgId` **删掉**：留着一个从未被写入、却看起来是"重复功能入口"的字段，
等于给下一任留一套并行机制。

`TASK_REPEAT_CFG` 实体名**保留**在 `ENTITY_TYPES`（vendored 线协议词表，不能删），
继续登记在 `UNMODELED_ENTITY_TYPES`，但原因改写成**"决定不用"**而不是"还没做" ——
否则下一个人会以为这是个待办事项，照着它实现一遍第二套机制。

#### 2.8.2 产品语义：完成后**顺延**，不是标记完成

🔴 完成一个重复任务 = **把到期日推进到下一次，且不写 `completedAt`**。

写 `completedAt` 会让它掉进「已完成」分组并且**再也不出来** —— 而"每周一交周报"
恰恰是下周还要做的。`nextAfterCompletion` 的注释说得很清楚：重复的是一条**实例**。

⚠️ **推进的基准是"当前到期日"，不是"完成时刻"。** 用完成时刻的话：一条 9/14(周一)
的任务在 9/13(周日) 被提前勾掉，"下一个 9/14 之后的周一"仍然是 9/14 ——
到期日纹丝不动，用户以为勾选没生效。所以固定排期一律从当前到期日往后推。

规则走到尽头（`UNTIL`/`COUNT` 用尽 → `nextOccurrence` 返回 `undefined`）时
**退回普通完成**：这次是最后一件。

这些判断全部在 `packages/app-host/src/actions.ts` 的 `completeTask` 里 ——
**不在界面里**（§3.5）。界面上只有一个「重复」区块和五个选项；"每周等于哪一天"
在 `packages/app-host/src/repeat-presets.ts`，因为那是产品语义，不是展示。

#### 2.8.3 顺带查出的三个真实缺陷

1. 🔴 **`NewTaskFields.notes` 写进了一个没人读的字段。**
   `payload: { title, priority, ...over }` 把 `notes` 原样写进载荷，
   而 `Task` 上的字段叫 `note`。**实测**：`create(t, {notes:'x'})` 之后
   `task.note === undefined`、`task.notes === 'x'` —— 备注同步到每一台设备，
   **没有任何视图读得到**。数据没丢，但和丢了没区别。已改名为 `note`
   并补了一条测试。
   ⚠️ **拦住改名的是 `typecheck`（`TS2561`），不是那条测试** —— 我最初写成
   "改名会让测试红"，实测把接口字段改回去，测试**照样全绿**（它传的是字面量）。
   两句话各管一半，别把功劳记错。

2. 🔴 **`describeRecurrence` 把「每」吞了。** 原来是
   `interval === 1 ? '' : \`每 ${interval} \``，而分支拼的是 `` `${every}天` `` ——
   于是**最常见**的默认间隔下，用户看到的是「天」「周六」。
   只有 `interval > 1` 才对（那条路径的 `every` 自带「每」），所以它躲过了所有间隔>1 的用例。

   🔴 **更值得记的是：测试当时把错的那两个字符串钉住了** ——
   `expect(describeRecurrence('FREQ=DAILY')).toBe('天')`。
   实现是错的、测试是绿的，而绿的原因是**断言写成了实现的复述**，不是意图。
   这不是 §8.4 说的"为了让测试变绿而改测试"，而是**测试本身坏掉了**（它把 bug 固化成契约）。
   判据：新断言能不能在实现退回旧行为时变红 —— 能（注入验证：**5 条红**）。
   顺带补上了原实现丢掉的时间信息（`FREQ=MONTHLY;BYMONTHDAY=14` → 「每月 14 日」，
   以及不再把「每月第 2 个周三」退化成「每个周三」）。

3. 🔴 **`check:ui-language` 有一整类写法从它下面穿过去。**
   `TEXT_PROPS` 要求 `=` 后面**紧跟**引号，所以 `label={a ? \`A\` : \`B\`}` 这种形状
   **一个字符串都看不到**。实测：同一句 `Open task now please` 放在 `label="…"` 上会被抓，
   放进三元表达式里则**完全不被扫描**。

   **发现它的信号是一个反向的差值**：我把一处无障碍名从单条字面量改成了两种状态的
   三元表达式（重复任务要念出"重复：每周"），统计数从 **106 掉到 105** ——
   **加了一句文案，被扫描的文案反而少了一句。**

   修的过程本身也有一个教训：第一版"把跨度里每个字面量都当文案"**立刻产生假红** ——
   `aria-label={theme === 'light' ? … : …}` 里的 `'light'` 是**比较操作数**，
   用户永远看不到。规则改成"字面量前面那个非空白字符是 `=` 就跳过"，
   一条覆盖赋值与全部比较运算符。现在覆盖率 **105 → 125 条**，
   且仍能用"三元里塞纯英文"验证它会红。

#### 2.8.4 验收（`pnpm verify:mobile-repeat`，15 步 / 全部零 mock）

期望值全部来自**宿主机 Python + 设备时钟**（星期几与后续日期不由本仓库代码算）。

| 它证明的事 | 为什么单元测试证不了 |
|---|---|
| 界面那个「每周」真的走到了 `setRepeat`，锚点是**同步过来的那个截止日** | 单测可以直接调 `setRepeat`，绕开界面与同步 |
| 手机本地**恰好一条** op 带 `repeatRule`（§3.4） | 单测数的是"我调了几次 dispatch"，不数"落库几条 op" |
| 详情面板显示「当前：每周六」，任务行出现重复标记 | 纯接线 |
| 规则同步到笔记本（`repeatRule`/`repeatDtstart`） | 跨进程、跨 HTTP |
| 手机上勾选 → 到期日 +7 天、**且 `completedAt` 一次都没写过** | 这条是本功能的核心，写错就"任务下周消失" |
| 反向：**在笔记本上**勾选，同步回手机也是 +7 天 | 证明顺延是设备无关的产品语义，不是手机壳里的特殊逻辑 |

🔴 **反向基线**：第 6 步先断言"设重复**之前**行上没有重复标记"。
没有这条的话，"行上有标记"分不清"设成功了"与"本来就一直显示"。

---

### 2.9 移动端"今天"跨零点后不再更新（✅ 已修）

**缺陷**：`TasksScreen` / `CalendarScreen` 里写的是
`const now = useMemo(() => Date.now(), [])` —— 注释给的理由是
"每次渲染重取会让今天/过期与渲染不同步"。前半句对，但它把**跨零点**这件真事一起冻住了。

界面上的症状全部是安静的，而且都不报错：

- 昨晚到期的任务今天仍然显示"今天到期"（`overdue` 是拿冻结的 `now` 算的）；
- 重复任务勾选后顺延到的那一天，第二天打开时**不会**被标成"今天"；
- 顶栏的「9月26日 星期六」第二天还是 26 号。

它还有个很坏的自我掩盖：**重进应用或刷新一下就"好了"**（重新 mount 会重取），
所以"我这儿看着是好的"这句话在这里没有信息量。

**修法**（`apps/mobile/src/lib/use-today.ts`）：两个互补的刷新时机。

| 时机 | 为什么必须有 |
|---|---|
| `AppState` 变成 `active` | 应用可能被挂起几小时，定时器不保证准时 —— 这条是主要保障 |
| 定时到**下一个本地零点** | 应用一直开着时，跨零点要自己醒过来 |

用"算到下一个零点"而不是"每 60 秒轮询"，是为了避免每分钟一次的无谓重渲染
（重渲染会连带列表的排序、分组、`useMemo` 全部重算）。

🔴 **不能用"当前时刻 + 24 小时"算下一个零点。** 夏令时切换的那两天一个本地日
不是 86400000 毫秒，直接加常数会落在零点**错误的一侧**。所以实现用
`addDays(toLocalDate(now), 1)` + `parseLocalDate(...)` 跟着本地日界线走。

日历还多一条规则：跨零点后，若选中框仍停在**上一个"今天"**（说明用户没手动挑过
别的日子），就把它带到新的今天 —— 否则第二天打开时选中框框着昨天、列表是昨天那一列，
而「回到今天」按钮看起来毫无反应。

#### 验证

- 5 条单测钉住纯函数 `msUntilNextMidnight`（唯一会算错的那半段；另外半段是两行
  `addEventListener` / `setTimeout`）。**这个文件刻意不 import react-native** ——
  `apps/mobile` 的全部测试都跑在 node 里。
- 🔴 **注入证明**：把实现换成常数 `24 * 3600_000` 之后
  —— `Asia/Shanghai`（无夏令时）**红 2 条**，说明断言不靠本地时区；
  —— `TZ=America/New_York` **红 3 条**，其中夏令时那条报
  `expected [ 1, +0 ] to deeply equal [ +0, +0 ]`（01:00 而不是零点）。
- ⚠️ 接线时被 `pnpm typecheck` 抓到一个真实顺序错误：新加的 effect 引用了
  尚未声明的 `selected`（`TS2448` / `TS2454`）。effect 必须放在
  `cursor` / `selected` 的 `useState` **之后**。
- 🔴 接线后 `typecheck` ✅、移动端 `test` 73 通过 ✅、`pnpm check` 全绿 ✅，
  但 **Release 打包红**：`Unable to resolve module ../lib/use-today.js`。
  原因是我把相对导入写成了带 `.js` 扩展名 —— `vitest` 会映射 `.js` → `.ts`，
  **Metro 不会**。已全部改成不带扩展名。
  也就是说 `useToday` 的接线**直到 APK 真的打出来才算验证过**。

---

### 2.10 🔴 根因：向量时钟被 20 条的裁剪上限削掉一项（✅ 已修，见 ADR-0008）

现象是冲突验收第 5 步报"**手机没有报冲突**"——极具误导性，看起来像手机的锅。
实际手机没错、笔记本也没错，**错的是这个测试账号的历史**。证据链（全部实测）：

| 位置 | 观察到的事实 |
|---|---|
| 服务端 | 该实体只有手机的 `CRT`(seq 41) 与 `UPD`(seq 42)；**笔记本那个 client 一条 op 都没有** |
| 服务端（该账号） | 有记录的 client 里**没有一个是笔记本的** —— 笔记本的写入一次都没上过云 |
| 笔记本本地 | 改名 op 在，但 `uploadStatus=pending`、`serverSeq=None` |
| 笔记本 CLI | `sync` → `{ok:false, kind:'conflict', errorCode:'CONFLICT_CONCURRENT'}`，并附 `existingClock` |
| 逐键对比 | 本地时钟与服务端 `existingClock` 各 20 键，**只差一个键**：`muh8hc5b-1-buuvk168: 1`（服务端 seq 1）；本地多出的是它自己 |
| 本地完整性 | 那条 op **在**本地库里（`seq=1`，本地 seq 1..43 **无缺口**） |

所以**不是下载漏了，是并入时钟时被裁掉了**。

🔴 根因：`packages/sync-core/src/vector-clock.ts:48` 的 **`MAX_VECTOR_CLOCK_SIZE = 20`**。
`limitVectorClockSize` 超出就丢弃条目，保留自己的 `clientId` 与计数最高的那些。
本账号历史上累积到 **21 个 clientId**，于是每个时钟都被裁到 20 ——
**恰好削掉计数最低的一项**（这里是 `muh8hc5b:1`）。

时钟少一项 → 不再支配服务端 head（head 有那一项）→
服务端把该设备写的**每一条** op 判成 `CONFLICT_CONCURRENT` 并拒绝。
冲突因此**根本造不出来**，第 5 步只能报"手机没有报冲突"。

**为什么"以前 24/24 全绿、现在必红"**：不是代码退步，是这个账号每跑一轮就
多 **2 个 clientId**（手机装一次包、笔记本建一次库），第 11 轮越过 20。
**一个会随运行次数漂移的验收台架本身就是缺陷。**

**这一轮做的（都在台架上，不碰同步逻辑）：**

1. `scripts/lib/mobile-e2e-fresh-account.sh`：**每轮调 `/api/test/create-user` 开新号**
   （该路由只在 TEST_MODE 下挂载），并在 source 共享库**之前**写好凭据文件 ——
   顺序反了就还在用上一个号。
2. 第 0 步加**前置条件断言** `heyta_e2e_assert_client_budget`：
   账号 client 数必须 `< 20`，否则直接报"后续断言不可信"。
   让它在这里自己说出来，而不是伪装成第 5 步的产品故障。
3. 第 3 步的判据从"客户端自称成功"改成**问服务端**
   （`psql ... count(*) FROM operations WHERE entity_id=... AND op_type='UPD'`）。

**结果（实测）：`pnpm verify:mobile-conflict` → 25 项通过 / 0 项失败。**
第 3 步那条服务端断言也绿了（"该实体有 1 条 UPD"），说明笔记本的编辑真的上了云。

顺带解决了一个一直在报"同步慢"的问题：新账号的历史只有 2 条 op，
**手机首次同步从 385 秒降到 20 秒** —— 之前那 6 分钟里有一大截是在下载
一个被反复复用的账号攒下来的几百条历史 op。**慢的从来不是密钥派生。**

并补了一条**钉子用例**：`packages/op-log/tests/vector-clock-trim.spec.ts`（4 条）。
它断言的是**当前行为**（21 个 client 时裁剪会削掉一项、同一份输入不削就支配 head
而削了判并发）。之所以不写成"断言期望行为"，是因为期望行为今天做不到，
**一条长期为红的用例会被无视**；写成钉子之后，谁改了裁剪策略谁就会红，
红的时候必须读那段注释和本节。op-log 测试 39 → 43。

✅ **已决策并已实施：ADR-0008。** 这里原本写着"三种方向待拍板"。拍板时发现根因
比"上限太小"更深一层，而这一点决定了修法：

🔴 **服务端的 head 自己也被裁到同一个上限，而两边保留条目的规则不同** ——
服务端保护 `op.clientId + protectedIds`（head 已知的那些），**客户端只保护自己的 clientId**。
所以"客户端与服务端各自裁剪"这个形状本身就是错的：
**只要真实时钟超过上限，永久拒绝是必然后果，不是偶发。**

**做了什么**（`MAX_VECTOR_CLOCK_SIZE` 20 → 100）：

| 改动 | 内容 |
|---|---|
| 上限 | `20` → `100`。墙从"21 个 clientId"挪到"101 个"；服务端 DoS 上限 `ceil(MAX×2.5)` 随之到 250 |
| 可见性 | `limitVectorClockSize` 在**真的裁剪**时 `console.warn`，带上实际条数与上限 —— 上次这个故障是**完全静默**的 |
| 钉子 | `packages/op-log/tests/vector-clock-trim.spec.ts` 同时钉住：① 旧故障场景（21 个 client）**不再触发裁剪**（回归守卫）；② 到 101 个时**照样**判并发（不假装已解决） |
| 登记 | `packages/sync-core/PROVENANCE.md` 加了第 5 条改动说明（vendored 代码，AGENTS.md §2） |

⚠️ **这是把墙挪远，不是把墙拆掉。** 因果安全的压缩（ADR-0008 选项 B）**没有做**，
ADR-0008 §5 记了未核实项（存量受害账号能否自愈、100↔101 的真实链路行为、warning 在 Hermes 上是否可见）。

🔴 **顺带修掉一类更普遍的问题：写死数字的边界测试。**
上限一提，`sync-core` 的 6 条 + 服务端的 5 条测试**就不再超限**，
裁剪不再发生 —— 而它们**仍然"通过"**。也就是说它们变成了**静默空转、什么都没测的测试**。
已全部改成跟着常量走，并补了"输入确实超限"的前提断言。
**这比这个常量本身更值得记：写死数字的边界测试会在常量变动时悄悄停止测试任何东西。**

⚠️ **另有一处未解释、单独记账：** 改动前那一轮，笔记本的改名 op 被标成
`uploadStatus=uploaded` 且 `sync` 返回 `{ok:true, kind:'synced'}`，
而服务端从未收到它。这一条与裁剪**不是同一件事**（后一次同形状的操作
正确地报了冲突）。**不要把它当成已解释**；现象符合 AGENTS.md §7 第 5 条
（"HTTP 200 也可能是拒绝"）的形状，需要单独定位。



### 2.11 iOS 壳：构建 → 安装 → 启动 → 截图取证（✅ 已完成）

**这一项之前的措辞是"iOS 构建通过"。那个说法是错的** —— 它对应的是
`xcodebuild` 退出码 0，而**产物里每个图标都渲染成了一个粉红方块**（RN 对未注册原生组件的
`Unsupported` 占位）。构建绿、能启动、12 秒后进程还在、`screencapture` 有图 ——
**每一步都像成功**。是"真的看一眼截图"才发现界面是废的。

所以这一项的验收标准改成了：**产物必须被看见。**

#### 达成的证据链（全部实测）

| 环节 | 证据 |
|---|---|
| 构建 | `xcodebuild ... -configuration Release -sdk iphonesimulator` → 退出码 **0**，`** BUILD SUCCEEDED **` |
| 产物是新的 | 二进制 sha256 从 `18e6ad56…` 变为 `3ab2637b…`；`main.jsbundle` 5,137,682 字节 |
| 安装 + 启动 | `xcrun simctl install` / `launch` → pid **27155**，14 秒后仍在运行 |
| 界面 | 截图：全中文、蓝白色系、四个标签（任务/日历/专注/我的）、"9月26日 星期六"、日期↔倒计时 Chip、FAB |
| **图标** | 顶栏同步、空状态收件箱、FAB 加号、四个标签图标 —— **全部为 Lucide 真实图形**（与 Android 截图一致） |
| 真数据库 | `op-sqlite` 建出 `Library/heyta.sqlite`，**73,728 字节**，表为 `__heyta_seq` / `archive` / `meta` / `ops` / `ops__mt3` / `state` —— 与 Android **同源同构** |
| clientId | `meta` 中实测持久化 `muhmhxil-1-n6fnf68i`（LWW 的决胜依据，iOS 上工作正常） |
| 无 JS 异常 | 3 分钟系统日志里 `redbox|fatal|invariant violation|unhandled` 匹配数 **0** |

#### 功能级验证：跨设备 op 的物化（这一条比"界面能看"重要）

界面好看不等于能用。iOS 上做不了点击（见下），所以我改用**不需要点击**的办法，
验证它的**读写链路**而不是外观：

1. 用 `apps/node-host` 以**另一台设备的身份**（`--client-id other-device-x`）往
   iOS 应用的**真实数据库** `Library/heyta.sqlite` 写一条任务 op。
   （写之前 `ops` 行数 **0**，写之后 **1**；实测该 op 的 `$.op.clientId` 为 `other-device-x`。）
2. 重新启动 iOS 应用。

结果（截图取证）：标题栏变为「**1 项待办，0 项已完成**」，「收集箱」分组出现且计数为 **1**，
任务「买牛奶和鸡蛋」带着复选框与删除按钮渲染出来，标签栏「任务」上出现角标 **1**。

**这条证据的意义**：它证明的是一个**来自别人的 clientId 的 op** 被正确读取并物化 ——
这正是同步下载之后要走的路径。也就是说 iOS 侧的
`SQLite → op-log 回放 → 物化 → 分组 → 渲染` 整条链在真实数据上是通的，
而不只是"壳画出来了"。**换成点击级的验证也未必能覆盖这一点**（本机点击只会写出
自己的 clientId）。

#### 为了走到这一步，连续排掉了 4 个障碍

前 3 个都让 **`pod install` 本身失败**，且**一个都不指向真正的原因**；
第 4 个是装上了 pod 也不显示。四条已分别记入 `AGENTS.md` §7 的第 29–32 条：

1. **`NODE_USE_ENV_PROXY=1`**（第 29 条）→ node 每次启动打一行警告，被 CocoaPods
   并进 stdout，污染 `Podfile` 解析出的 `react_native_pods.rb` 路径 →
   `cannot load such file -- <一个明明存在的文件>`。
2. **仓库路径含空格**（第 30 条）→ RN 0.84 的 prebuilt-core 用
   `URI::File.build(path:)` 构造 podspec `source`，遇空格抛
   `URI::InvalidComponentError` → 最终报成 `Missing required attribute 'source'`。
3. **`RNSVG-RNSVGFilters` 的部署目标是 12.4**（第 31 条）→ 低于 Xcode 27.1 的
   15.0 下限，报在编译开始之前。
4. **`react-native-svg` 从未进过 `Podfile.lock`**（第 32 条）→ 依赖在最后一次
   `pod install` **之后**才加（时间戳 18:39 vs 21:54），于是构建成功但图标全废。

#### 可用命令（照抄即可）

```bash
cd apps/mobile/ios
# 1) 装 pods —— 这一串由 `check:native-deps` 与 scripts/reinstall-all.sh 对账钉住，
#    改这里不改那里会红。2026-10-04 四臂实测：`LANG` 承重（两个 locale 都不给 ⇒
#    崩在 `config.rb:167` 的 ASCII-8BIT），`LC_ALL` **不**承重（只给 `LANG` 也成功）。
env -u NODE_USE_ENV_PROXY LANG=en_US.UTF-8 \
    RCT_USE_PREBUILT_RNCORE=0 RCT_USE_RN_DEP=0 pod install

# 2) 构建 Release 模拟器包
export LANG=en_US.UTF-8
xcodebuild -workspace HeytaMobile.xcworkspace -scheme HeytaMobile \
  -configuration Release -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,id=<UDID>' \
  -derivedDataPath build/DerivedDataRelease build

# 3) 装 + 启动 + 取证（截图必须人眼/视觉复核，不能只看退出码）
xcrun simctl install <UDID> <...>/HeytaMobile.app
xcrun simctl launch  <UDID> org.reactjs.native.example.HeytaMobile
xcrun simctl io <UDID> screenshot /tmp/ios.png
```

`Podfile` 的 `post_install` 现在会**只抬高不降低**地把所有 pod target 的
`IPHONEOS_DEPLOYMENT_TARGET` 对齐到 RN 自己的 `min_ios_version_supported`
（实测修后全部为 15.1，小于 15 的残留 **0** 条）。**不要在 `Podfile` 里写死版本号** ——
RN 抬高最低版本后会静默漂移。

#### ✅ 已把第 32 条那个盲区变成机器门禁：`pnpm check:native-deps`

第 32 条是本仓库**第一个靠"真的看一眼截图"才发现的缺陷**：`react-native-svg` 在
`package.json` 里、不在 `Podfile.lock` 里，于是**每个图标都渲染成粉红方块里的 `Uni`**。
当时 `xcodebuild`、`simctl launch`、`screencapture`、界面文案、SQLite 建库**每一步都是绿的**，
而**所有既有断言都测不出它** —— 无障碍断言查 `content-desc` 与文案，
测不出"这个 View 到底画成了什么"。

"排查手法：拿 `Podfile.lock` 与 `package.json` 逐项对账"这句话本身**是人读的**，
而人读过一次就不会再读第二遍。所以 `scripts/check-native-deps.mjs` 把它变成两条机器规则：

| 规则 | 内容 | 为什么这样定 |
|---|---|---|
| **收录** | 每个第三方原生依赖的 **pod 名**（读 podspec 的 `s.name`）必须出现在 `Podfile.lock` 的 PODS 段 | 不能靠猜包名 —— 实测映射是 `react-native-svg → RNSVG`、`@op-engineering/op-sqlite → op-sqlite` |
| **版本一致** | lock 记的版本 == 该包 `package.json` 的 `version` | 实测四个 podspec 全都 `s.version = package['version']`，所以这条**完全确定性** |

**为什么不用 mtime 判过期**（我最初的想法）：mtime 在**全新 clone** 上会让 podspec 比 lock 新而**假红**；
而 pnpm 每次 install 都会重写 `node_modules/<pkg>` **符号链接**的 mtime
（实测 21:54:40，与 podspec 自身的 21:54:38 只差 2 秒）。两个都会假红，所以改用版本号。

**为什么必须排除 `react-native` 自己的 podspec**：它由 Podfile 的 `use_react_native!` 声明，
且含条件性变体 —— 实测从源码构建时 `React-Core-prebuilt` 与 `ReactNativeDependencies`
**故意不在** lock 里（命中的是 `React-Core`，不是 `React-Core-prebuilt`）。
不排除就**立刻假红**，一个会假红的门禁比没有门禁更糟。

**它会红的证据**（5 种注入，全部在 `/tmp` 的隔离拷贝上做，真仓库 `Podfile.lock` mtime 与内容核验未变）：

| 注入 | 结果 |
|---|---|
| 把 `RNSVG` 从 lock 里删掉（**= 第 32 条原形状**） | 退出码 1，指认 `react-native-svg → RNSVG`，并说明会渲染成 "Unsupported" 占位 |
| lock 里 `op-sqlite` 版本改成 `1.0.0` | 退出码 1，报"已安装 18.2.5，lock 记的是 1.0.0" |
| 整个 lock 删掉 | 退出码 1，报"无法证明任何原生模块被链接" |
| `package.json` 新增一个 lock 里没有的原生库 `react-native-fake-native` | 退出码 1，指认 `FakeNative` |
| 传一个拼错的 `--flag` | 退出码 2（防止参数被静默忽略） |
| 基线原样 | 退出码 0，列出 4 个 pod 及版本 |

⚠️ **它看不见 Android** —— 但 Android 的 autolinking 在构建期**从 `node_modules` 现场解析**
并生成清单，不存在这个"已装依赖与已链接产物脱节"的窗口，所以那边没有对应的东西可对账。
⚠️ **它只证明"声明与链接一致"，不证明"链接上去以后画得对"** —— 那仍然要靠看图。

#### 已知未做（不要声称已完成）

- ✅ **原"iOS 没有交互级（点击）E2E"这个缺口已补上** —— 见 §2.12
  （`pnpm verify:mobile-ios`，30 项通过 / 0 项失败，含跨设备 L5）。
  当时**放弃点击是对的**（坐标不可信），但"因此就没有别的办法"这个推论下早了：
  走得通的路不是"标定坐标"，而是**绕开坐标**（走 AX 树）。
- 🔴 **一个新发现的 P0：一条硬被拒的 op 会让设备的同步永久卡死**（见 §2.12.4）。
  **本轮只取证、未修** —— 它动的是同步协议语义，需要独立的复现用例与 ADR。
- ✅ 原"原生依赖是否真的被链接"这个盲区**已自动化**（见上一节 `pnpm check:native-deps`），
  不再是只靠人眼的"排查手法"。但**它不替代看图** —— 它只证明声明与链接一致。
- ⚠️ iOS 的 ATS 仍未处理（ADR-0007 §6）。
- ⚠️ 首次同步的 30–40 秒（Hermes 无 JIT + 纯 JS Argon2id）在 iOS 上**同样存在**，
  原生 Argon2 模块仍未做。

### 2.12 iOS 输入侧验收 + 一个被它逼出来的 P0（✅ 脚本已完成；✅ P0 已修，见 §2.13）

#### 2.12.1 为什么以前做不到

不是"没写脚本"，是**三个工具层的问题叠在一起**，而且每一个的表现都像成功：

1. **全局事件流点击会被上层窗口吃掉。** 目标窗口 `iPhone 17 Pro – iOS 26.5`
   （456×972 @ (636,43)）被另一个无关项目的 `Litopia-Gate-Duo-Final`
   （1696×992 @ (14,47)）整块盖住；屏幕上还叠着七八个同样盖满屏幕的 Simulator 窗口，
   **没有一块空地能把窗口挪过去**。遮挡闸直接拒绝。
2. **`AXRaise` 掀不动它。** `perform action "AXRaise"`（含完整标题）返回成功；
   把 Simulator 激活成前台 app 之后再 raise 也返回成功 —— 遮挡关系**不变**
   （Xcode 27 的 Simulator 用 window set，菜单里就有 `Arrange in Front`）。
   **"工具返回成功"在这里是假的。**
3. **`mac type` 的 postToPid 投递不到模拟设备的输入框。** 它返回 `typed 9 chars`，
   但截图回读里 placeholder 还在、提交按钮仍是禁用色。

#### 2.12.2 走得通的路：走 AX 树，绕开坐标

iOS 模拟器把「模拟设备里那个 App」的无障碍节点**桥接进了宿主的 AX 树**，
所以那些按钮/输入框在宿主这边是**真实的 AX 元素**，可以 `AXPress` / `AXSetValue`。
这条路**不需要坐标、不需要 z-order、不需要焦点**
（实测在 Simulator 不是前台 app 时也能点开 Composer）。

工具落在 `scripts/tools/axpress.swift`，验收落在 `scripts/verify-mobile-ios.sh`
（`pnpm verify:mobile-ios`）。**证据分五级，断言就按这五级走：**

| 级别 | 内容 | 本仓库怎么取 |
|---|---|---|
| L1 | 控件被激活 | `AXPress` 返回 success |
| L2 | 界面真的变了 | AX 树里多出 Composer 的文本控件 |
| L3 | **状态指示器** | 「添加」按钮的 `AXEnabled` 由 false → true |
| L4 | 副作用 | 真 SQLite 的 `ops` 表**恰好**多一条 op，标题逐字相符 |
| L5 | 跨设备 | 按下「立即同步」后，**另一台设备**（node-host 真 SQLite）读到它 |

**L3 是最容易被省掉、但最不该省的一步。** L1/L2 都可能被"控件激活了但应用没理会"骗过；
而「添加」按钮的启用态是 RN 根据输入内容算出来的 —— 它变亮，
等于**应用亲口说"我收到了这段文字"**。实测：空输入 `enabled=false`，写入后 `enabled=true`。

⚠️ **任务页头部那个「同步」按钮不是网络同步**。实测 `TasksScreen.tsx:483` 它的 `onPress`
是 `refresh`，即 `listTasks()` —— 本地重读物化状态。真正的网络同步在「我的」页的
「立即同步」（`ProfileScreen.tsx` → `onSync` → `writeSyncConfig` + `syncNow`）。
我按标签猜行为，先点了任务页那个，结果 300 秒里一条 op 都没上去，**而按钮写着「同步」**。

实测结果：**30 项通过 / 0 项失败**，含 L5 全链路（iOS 点击 → 真 SQLite → 服务端 → 笔记本）。

**它真的能红（4 次注入，全部实测）：**

| 注入 | 结果 | 红的层级 |
|---|---|---|
| `IOS_UDID` 指向不存在的模拟器 | 退出码 1（0/1） | 前置条件 |
| `IOS_DEVICE_NAME` 指向不存在的设备 | 退出码 1（2/1） | 前置条件（拿不到窗口矩形） |
| 访问令牌换成 `not-a-valid-jwt` | 退出码 1（29/1） | **L5（笔记本 300 秒内没读到）** |
| 端到端口令换成另一个错的口令 | ❌ **无效注入** | —— 见下 |

🔴 **第 4 次注入是"无效注入"，而这个失败本身有价值。** 我以为把 `/tmp/heyta_mobile_e2ee.txt`
换成错口令就能断掉 L5，结果**全绿** —— 因为这个脚本把**同一个口令同时喂给两端**，
所以两边用同一个错密钥，照样能互相解密。**一个"没红的注入"必须先被证明它真的注入了，
否则它会伪装成"这段逻辑很健壮"。** 这里正确的做法是只改一端（例如只改 app 的、不改笔记本的），
本轮没做；因此**"L5 能发现端到端密钥不一致"这一条尚未被注入证明**，
但 L5 确实覆盖了"跨设备派生必须兼容"（否则笔记本读不出标题）。

#### 2.12.3 验收脚本自己被纠正的三处（都值得记住）

- 🔴 **不要按 AX role 筛可点元素。** 同一个「添加」按钮的角色会在 `AXButton` 与
  `AXGenericElement` 之间变（同一台设备、同一个 Composer，只是输入框内容不同）。
  按 role 过滤会**时灵时不灵**，症状是"找不到按钮"，看起来像界面没渲染出来。
  改用 `--pressable`（该元素支持 `AXPress` 动作）才对。
- 🔴 **"窗口里有没有文本控件"不能当"Composer 是否开着"的判据** ——
  「我的」页常驻三个输入框（服务器地址 / 令牌 / 口令）。该判据只在任务页成立。
  Composer 的**唯一**可靠标记是它里面才有的「添加」按钮。
- 🔴 **`secure` 输入框的 AX 回读是掩码**（一串 `•`），永远不等于原文；
  而且**不要用 `grep '^••*$'` 去认它** —— 脚本没有 UTF-8 locale 时 `•` 按 3 字节处理，
  `*` 只绑定到最后一个字节，20 个掩码匹配不上，症状和"写不进去"一模一样。
- 🔴 **`ops` 表里 op 的 id 在 `ix0_0`，不是 `pk0`**（`pk0` 是数字主键，实测形如 `2`、`1.0`）；
  而 `uploadStatus` 是 **`$.uploadStatus`**，是 `op` 对象的**同级**，不在 `$.op` 里面。
  查错的后果是 4 条断言**同时**报空，看起来像 op 写坏了。

#### 2.12.4 🔴 P0：一条坏 op 会**永久**废掉一台设备的同步

这是本轮的意外收获，也是本轮最重要的产出 —— 它不是我"设计"出来的，
而是验收脚本里一条**写错的断言**逼出来的。

**现象**：应用自己的「状态」区写着**「同步失败」**，任务页角标是 5；
而**跨设备那一路是通的**。应用吐出的原始报错（从 AX 树里读出来的）：

```
服务端拒绝了 5/5 条 op：
  other-device-x-…-1       INVALID_CLIENT_ID（这条 op 的 clientId 不是本机的）
  muhmhxil-…-1/-2/-3/-4    DUPLICATE_OPERATION（服务端早已有这 4 条）
```

**机制**（`packages/sync-client/src/client.ts` 的上传路径）：

```
上传 → 检查 accepted → 有硬拒绝就 throw
                          ↑ 这个 throw 在 markUploaded / setLastServerSeq **之前**
```

于是一条自持的链：同批里**已被服务端接受**的 op 永远不落"已上传"
→ 下次同步重传整批 → 变成 `DUPLICATE_OPERATION` → 继续 throw
→ **这台设备的同步被永久卡死**（数据在云上没丢，但它再也同步不动了）。

**`DUPLICATE_OPERATION` 被当成了致命错误，而它的真实含义是"服务端已经有了"
—— 那正是上传想要的结果。** 与被拒 op 同类的东西本仓库已经处理过两次（§7 第 8、12 条），
但只覆盖了 `CONFLICT*`，没有覆盖重复。

**为什么值得单独记一条**：这是**测试写错反而救了产品**的一例。
我原来断言"上传后 `uploadStatus` 应从 pending 变成 uploaded"，
它红了，而我第一反应是"断言写错了"。**去查真因才发现断言没错、产品错了。**
如果当时直接把它删掉，这条缺陷会继续躺着，而且用户那边的症状是
"同步一直失败 + 待上传数永远不减"，**极难归因**。

**已完成的取证**（诚实边界）：

- ✅ 用宿主 Node 驱动对**手机真库的副本**直接调 `markUploaded`：**完全正常**
  （`pendingUploadCount` 5 → 4，op 变成 `uploaded|900`）。
  → **存储层没问题，是 iOS 那条调用根本执行不到。**
- ✅ 排除了"装的是旧 bundle"：已装 app 构建于 07:59，而 `sync-wiring.ts`（09-25 22:42）、
  `client.ts`（09-26 01:42）都更早，且 Hermes 字节码里 `markUploaded` / `lastServerSeq` 都在。
- ✅ **未修是刻意的，不是漏了**：它是对同步协议语义的改动，需要独立的复现用例与 ADR，
  **不在长轮的末尾顺手改核心同步逻辑**。取证与修复分成两轮，修复见 §2.13。
- ⚠️ 触发前提是**队列里存在一条硬被拒的 op**。那条 `other-device-x` op 是早前手工探针
  写进 iOS 库的测试数据（全仓库搜不到这个名字），**不是产品自己产生的**。
  但缺陷本身与它怎么来的无关：任何一条硬拒绝都会把设备卡死在这个形状里。

### 2.13 修 P0：精确重复的 op 回幂等成功（✅ 已完成并四层验收）

**决策**：[ADR-0009](../adr/0009-duplicate-op-idempotent-success.md)（已接受）。

#### 改了什么（服务端 + 客户端各一半）

| 位置 | 改动 |
|---|---|
| `server/src/sync/services/operation-upload.service.ts` | 两处"磁盘上已有同 id op"分支（可预测的 `existingOp`、竞态失败后的 `duplicateOp`），在 `isSameDuplicateOperation(...)` 为真时回 `{ opId, accepted: true, serverSeq: existingOp.serverSeq }`，`storageBytes: 0` |
| `packages/sync-client/src/client.ts` | `markUploaded(seqsByOpId)` 提到硬拒绝 `throw` **之前**；**游标不提前推进**（那条路径下面还有 piggyback 的 `newOps`，先推进会跳过它们） |
| `server/PROVENANCE.md` | 记这是 vendored 服务端**唯一一处语义改动**，并注明这不是新发明（上游 snapshot 路径早就这么做） |

🔴 **`INVALID_OP_ID` 那几条硬拒绝一个字没动**：内容 / 向量时钟 / 持久化元数据不同、
跨用户 id 碰撞、竞态里的 id 碰撞 —— 仍然全部拒绝。这是本决策的**核心边界**。

#### 验收：四层，每一层都能真的失败

| 层 | 怎么验 | 结果 |
|---|---|---|
| ① 线级（正） | 笔记本 `node-host`：把一条**已上传**的 op 重置回 `pending`，再 `sync` | `已同步（…）`、退出码 **0**、`待上传 0 条`、`uploadStatus=uploaded` |
| ② 线级（反证） | 把**已构建的**服务端那一行换回旧行为、重启 → 同一场景 | `同步未成功：服务端拒绝了 1/1 条 op：(DUPLICATE_OPERATION)`、退出码 **1**、`待上传 1 条`（**这就是单变量对照**） |
| ③ 服务端日志 | 真机同步时看 `UPLOAD_BATCH_SUMMARY` | `{ opsInBatch: 10, accepted: 9, rejected: 1 }`，唯一被拒的是 `other-device-x` 的 `INVALID_CLIENT_ID` |
| ④ 真机界面 | iPhone 模拟器「我的」页 AX 树读原文 | `服务端拒绝了 1/10 条 op：(INVALID_CLIENT_ID…)（同批另有 9 条已被接受，已标记为已上传，不会再重传）`，队列 **10 → 1**；删掉我自造的毒数据后 → **0** |

🔴 **反差本身就是证据**：修复前同一状态是「**拒绝了 5/5 条**」且队列**永不减少**；
修复后是「**拒绝了 1/10 条**」且**队列排空**。

#### 测试

| 文件 | 改动 |
|---|---|
| `server/tests/duplicate-operation-precheck.spec.ts` | 10 条断言按新语义改写 + 文件头写明语义变更与**边界未放松**；5 条碰撞边界测试**一字未动、仍绿** |
| `server/tests/sync.service.spec.ts` | 2 条：幂等重试断言 `accepted===true` 且 `serverSeq` 相同；裁剪那条捕获 `oversizedResult` 后比较 `serverSeq` |
| `packages/sync-client/tests/sync.spec.ts` | 新增 2 条：同批有硬拒绝时**已被接受的 op 仍必须落盘**（否则永久重传）；错误文案要点明"同批有几条已被接受" |

#### ⚠️ iOS 侧第一次同步的真实耗时（本轮新测，比之前记录的更慢）

真机实测（iPhone 17 Pro 模拟器，Hermes 无 JIT）：**首次同步的 Argon2id 派生耗时约 2 分 40 秒**
（CPU 全程 100%，三次取样 `2:30 / 2:32 / 2:34`），远超之前 Android 模拟器记录的 30–40 秒。
**这不是卡死** —— 期间服务端一条请求都没收到是正常的，派生完才会发请求。

- 判据：`ps -o %cpu=,time=` 持续 100% + 服务端零请求 = 正在算密钥，不是网络问题。
- 影响：`isArgon2SlowBackend()` 的提示文案（「约 30–40 秒」）**对 iOS 模拟器是低估的**。
  待原生 Argon2 模块落地后统一处理；**现在不要改文案为一个更小的数**。
- ⚠️ **本轮踩到的一个坑**：在应用**运行中**从外部 SQLite 删 op，会让应用停在「正在上传…」
  且内存里的待上传计数与磁盘不一致。**要改应用自己的库，先 `simctl terminate`。**

#### ⚠️ 未核实项（照实记）

- **生产环境有没有真实账号正卡在这个状态**，没查过 —— 只有本地一个验收账号。
  推断"服务端升级后旧客户端自愈"，**但没在真实用户数据上验证**。
- **Web 壳是否也会卡在这个形状**，未实测（`packages/sync-client` 是共享的，理论上已修）。
- **同批次内重复回硬拒绝**是否会在某种真实时序下被触发，未穷举（结论是读代码得来的）。

### 2.14 修验收台架：`$NODE` 解析成私有垫片 → 探针静默失败（✅ 已完成）

**这不是产品缺陷，是验收脚本自己的缺陷 —— 但它把结论指向了产品。**

#### 现象

`pnpm verify:mobile-ios` 连续两轮报
`❌ 笔记本 300 秒内没读到「iOS输入验收…」`，而同一份输出里
`uploadStatus pending → uploaded` 是绿的（说明手机确实上传成功了）。

#### 取证（关键：不信脚本的输出，去看服务端）

| 看哪里 | 看到什么 |
|---|---|
| 服务端日志 | 窗口内**只有手机那一条上传**，笔记本**零请求** |
| 笔记本库那条 pending op | 一直是 `pending` —— 证明 `sync` **从没执行过** |
| 在 shell 里手跑同一命令 | `{"ok":true,"command":"sync",…}` —— **正常** |
| 在 `pnpm exec` 下解析 `$NODE` | `…/DSH Desktop/runtime-commands/…/private/node-bin/node` |

根因：`scripts/lib/mobile-e2e.sh` 写的是 `NODE=$(command -v node)`，
而 pnpm 环境下 PATH 最前是**DSH 运行时的私有垫片**，它执行
`node apps/node-host/dist/cli.js sync` **没有任何输出**。
`laptop()` 的 `2>/dev/null` 与 `wait_laptop_has` 的 `>/dev/null 2>&1`
把失败**连吞两层**，于是"探针没跑起来"和"对端没收到数据"长得一模一样。

> 这个坑仓库里**已经写过一次**（`.mjs` 侧的 `resolveNode()`，见 AGENTS.md §7
> 「`spawn` 的 ENOENT」），只是 bash 侧没跟上 —— **同一条教训写在一种语言里，不等于另一种语言里被遵守了。**

#### 修复

1. `resolve_real_node()`：`HEYTA_NODE` → nvm → homebrew → PATH（跳过 `DSH Desktop` / `runtime-commands`）。
2. `wait_laptop_has` **分别返回** `0` 读到 / `1` 探针正常但对端没有 / `2` **探针自己坏了**；
   调用方三种情况分别报，并把 `$NODE` 与最后一条原始输出带进消息。

#### 验收

| 项 | 证据 |
|---|---|
| 修复后真实跑通 | `pnpm verify:mobile-ios` → **31 通过 / 0 失败**，笔记本**第 1 轮**就读到 |
| 注入反证 A | `HEYTA_NODE=/usr/bin/false` → 退出码 **2**，回显 `NODE=…；laptop sync 一次都没成功，最后一条输出：（空）` |
| 注入反证 B | 正常 node + 不存在的标题 → 退出码 **1** |

⚠️ **A 与 B 必须可区分，否则这条修复等于没修** —— 这正是本条的全部价值。

### 2.15 iOS 连私有 IP 字面量：结论成立，但**归因错了**（✅ 已纠正 + 已固化成交付验收）

#### 要回答的问题

heyta 定位是**自建/自托管**。iOS 端的底线能力是：能不能连 `http://192.168.1.5:3000`
这类**局域网自建服务端**的**明文 HTTP**。原以为答案取决于 ATS 的
`NSAllowsLocalNetworking` 键。

#### 🔴 第一版结论是错的

第一版写的是「**ATS 覆盖私有 IP 字面量**，功劳在 `NSAllowsLocalNetworking`」。
**两句都不成立。**

反证分两步，缺一不可：

| 步骤 | 做法 | 结果 |
|---|---|---|
| ① 关掉那个键 | 把 `NSAllowsLocalNetworking` 改 `false`（`NSAllowsArbitraryLoads` 仍 `false`），**重装** bundle | 同一个验收**依然全绿** —— 那个键不是承重的 |
| ② 独立主机证明 | 起一个**只绑 `192.168.1.5:3100`** 的监听器（`127.0.0.1:3100` 拒绝连接），把应用指过去 | 抓到 `client=192.168.1.5:65102 host_header=192.168.1.5:3100` |

第 ② 步是必需的：当时的对照组只有"错端口"，而**错端口只能证明应用用了配置的端口，
不能证明它用了配置的主机** —— "偷偷回落 `127.0.0.1:3000`"能伪造出一模一样的绿。

> **结论**：**私有 IP 字面量的明文 HTTP 本来就不受 ATS 拦，与 `NSAllowsLocalNetworking` 无关。**
> 该键保留（无代价，对 `.local` / 链路本地 / 无限定主机名**可能**有用），但**它不是开关**。
> → `docs/adr/0007-transport-security.md` §6 已按此重写。

#### 交付物

`scripts/verify-ios-lan-http.sh` + `pnpm verify:ios-lan-http`，**三个地址的单变量对照**：

| | 服务器地址 | 期望 | 它排除的假绿 |
|---|---|---|---|
| 2a | 对的**主机**、错的端口 | 失败 | 「应用忽略端口」 |
| 2b | 错的**主机**（同 /24 的 `.99`，先断言不可达）、对的端口 | 失败 | 「应用忽略主机、回落 localhost」 |
| 3 | 都对 | 成功，「上次成功同步」**前进** | —— |

**2a 与 2b 缺一不可** —— 第一版只有 2a，那正是归因错误的另一半原因。

#### 这一轮踩到的环境陷阱（都已进 `AGENTS.md` §7）

| # | 陷阱 | 后果 |
|---|---|---|
| 36 | `cmd \| python3 - <<'PY'` 的 heredoc **顶掉管道**，解析器读到 0 字节 | 报「界面上读不到那个值」，而手工 dump 字字俱在 |
| 37 | **macOS 的 AX 只能看见「当前 Space」的窗口** | dump 里只剩菜单栏；而截图里 App 渲染得好好的 |

第 37 条还包含一次**被用户叫停的错误做法**：我曾用
`osascript -e 'tell application "Simulator" to activate'` 去把窗口拽回当前 Space ——
它有效，但那等于**跟用户抢前台**。现在仓库里**一处 `activate` 都没有**，
读不到就由 `require_ax_visible` 报明原因并停。

顺带修掉一个真缺陷：窗口矩形原来走 `System Events`（依赖**辅助功能权限**，
该权限丢失后它对**每一个**应用都返回 `count of windows = 0`），
现改为 `scripts/tools/winrect.swift`（`CGWindowListCopyWindowInfo`，只需**屏幕录制**权限，
且必须用 `.optionAll` —— `.optionOnScreenOnly` 对别的 Space 上的窗口一个都不返回）。
两份重复的 `find_window` 已删除，**共享库里有且只有一份**。

#### ⚠️ 还没做到的（不要外推）

- 🔴 **`pnpm verify:ios-lan-http` 这一轮没跑到全绿**：前置条件、凭据写入、2a 之前的步骤都过了，
  但**当前 Space** 这个环境前提在运行中反复失效（用户正在用这台机器、频繁切 Space），
  而 AX **在设计上就够不着别的 Space**。**不抢前台**是硬约束，所以没有绕过去。
  → 需要一次"Simulator 窗口停在当前桌面且没人抢"的窗口才能跑完；**结论本身不受影响**
  （反证那两步是手工取证做实的），但**这条验收目前的自动化绿是欠的**。
- **公网 IP 字面量 / 普通域名 + 明文 HTTP** 未测（产品口径：公网自建走 HTTPS）。
  → **2026-09-26 已补测，见 §2.16。**
- **`.local` / 链路本地 / 无限定主机名**未测 —— 那才是 `NSAllowsLocalNetworking` 真正管的范围。
- **真机**未测，只有模拟器。

---

### 2.16 ✅ 第一次真实公网自建部署：**局域网明文放行、公网明文被 ATS 拦死**

产品负责人 2026-09-26 明确：**"自托管只是一种选择、完全免费；项目开源；同时我们也会提供一个公网服务。"**
于是把 heyta 服务端真的部署到了一台公网服务器上，用来补 §2.15 里那个空着的格子。

#### 做了什么

| 步骤 | 结果 |
|---|---|
| 选机器 | 用户排除 OPP 与 wunoos；**sanjiaozhou 的 dockerd 代理是坏的**（见下），改用 **ubuntu-jcli `124.223.13.226`**（4核/7.6G，腾讯云） |
| 同步源码 | `rsync` 到 `~/heyta`（排除 `apps/` `docs/` `node_modules`） |
| 构建镜像 | `docker compose -f docker-compose.yml -f docker-compose.build.yml build`，**成功** |
| 起服务 | 只起 `postgres` + `supersync`，**不起 compose 自带的 caddy**（宿主机已有 nginx） |
| 暴露公网 | 宿主机 nginx 加一个**只匹配 `server_name 124.223.13.226`** 的片段，转发到 `127.0.0.1:1900` |
| 外部验证 | 从 wunoos / sanjiaozhou 两台不同云的机器 `curl` → `{"status":"ok","db":"connected"}` 200 |

**服务端本身完全正常**，带 Bearer 的 `/api/sync/ops?sinceSeq=0` 也返回 200。

#### 🔴 结果：App 连不上，且**请求根本没发出去**

- 界面：**「当前离线」**
- 服务端 nginx 访问日志：**来自 App 的请求数为 0**（只有那三台 `curl` 的来源 IP）
- 模拟器 CFNetwork 日志给出确切原因：

```
Cannot start load of Task <…> since it does not conform to ATS policy
NSURLErrorDomain Code=-1022
"The resource could not be loaded because the App Transport Security policy requires the use of a secure connection."
```

**这是单变量对照的教科书形状**：同一份 App、同一套凭据、同一份服务端代码，
**只有目标网段从私有换成公网**，结果从"通"变成"被拦"。

→ **推翻了 §2.15 里"与 ATS 无关"那个归因**。正确表述是：
**ATS 的判据是"本地网络 vs 公网"，不是"是不是 IP 字面量"。** ADR-0007 §6 已改写。

#### 🔴 顺带发现的两件事

1. **服务端也有一道门**：`NODE_ENV=production` 且 `PUBLIC_URL` 非 `https://` → **拒绝启动**
   （`server/src/config.ts`），**没有开关**。所以明文自建是**两端都堵**。
   → 已按 **ADR-0012** 收窄为"公网才要求 HTTPS"：局域网明文在生产模式下放行，
   并配了**会真的失败**的负例测试（`192.168.1.5.evil.com` 必须仍被拒）。
   反证过：把它写成天真的 `startsWith('192.168.')` 会让 8 条测试挂掉。
2. **`sanjiaozhou` 的 Docker 守护进程配了一个不存在的代理**
   （`/etc/systemd/system/docker.service.d/http-proxy.conf` → `127.0.0.1:7890`，而那里没有监听）
   → **那台机器上所有镜像拉取都是坏的**。修它要重启 dockerd，而 `live-restore` 未启用
   且上面跑着 23 个生产容器，**没有动**。留作待办。

#### ✅ 但换个传输方式就通了：HTTPS + 域名 = 生产形态首次实测成功

> ⚠️ **本节是历史记录（2026-09-26 那次实测），其中的域名部分已被取代。**
> 测试阶段的域名自 **2026-09-27** 起固定为 `https://heyta.finlaw.cloud/`
> （落地页 + 应用 + 同步 API + 三张凭据页），旧的 `heyta-tmp.litopia.space` 已弃用。
> 迁移动机、代价与验收见 [`deployment.md` §3.7.1](../runbooks/deployment.md)。
> 下面正文里的域名、`PUBLIC_URL`、证书名都按**当时**写，不要照着配。

用 `tccli` 建了 `heyta-tmp.litopia.space` → `124.223.13.226`，`certbot --nginx` 签了
Let's Encrypt 证书，服务端切到**真正的生产配置**（`NODE_ENV=production` +
`PUBLIC_URL=https://heyta-tmp.litopia.space`，**去掉 TEST_MODE** —— 生产模式本来就禁止它）。

| 检查 | 结果 |
|---|---|
| 外部 `https://…/health` | 200，`ssl_verify_result=0` |
| `http://…` | 301 → https |
| 带 Bearer 的 `/api/sync/ops` | 200 |
| **iOS App 同步** | **「已是最新」**、待上传「已全部上传」、「上次成功同步」从「从未」前进到 `9-26 12:39` |
| 服务端 nginx 日志 | `GET /api/sync/ops?sinceSeq=0… HTTP/2.0` 200，**UA = `HeytaMobile/1 CFNetwork/3860.600.12`** |

**同一条链路，只有传输方式变了**：明文 → ATS 拦、0 请求；HTTPS → 200、同步成功。

#### ✅ 多端同步也通了（公网上）

用 `apps/node-host` 当"笔记本设备"，指向同一个公网服务端：

```
add "从笔记本同步过来的任务"   → task-f5ad082f-8a2b-4c4f-9e98-5f27a962ce46
sync                          → 已同步
服务端 GET /api/sync/ops?sinceSeq=0 → op 数 1, latestSeq 1, seq=1 type=CRT entity=TASK
```

#### ✅ 那条"iOS 没显示出来"已解决 —— **同步一直是好的，是界面不刷新**

上一版这里写的是"未解决，不要当成已完成"。现在定位并修掉了，过程如下。

**第一步：查 App 的数据库，而不是猜。** op **在**，而且**自称已应用**：

```
ops 表: ix1_0=uploaded  ix2_0=TASK  ix2_1=task-f5ad082f-…  ix4_0=applied
data:   {… "source":"remote", "applyStatus":"applied", "seq":1}
meta:   lastServerSeq = 1
```

**第二步：重启 App，任务出现了。**

```
1 项待办，0 项已完成
收集箱
打开任务：从笔记本同步过来的任务
```

> 到这一步结论就定了：**op 下载了、应用了、物化了。**
> `state` 那张 SQLite 表是空的，但那是**红鲱鱼** ——
> `STORES.STATE` 在非测试代码里**从来没被写过**，物化状态在**内存**里（`engine.getState()`）。

**第三步：真正的根因 —— 屏不会因同步而重读。**

`TasksScreen` / `CalendarScreen` / `FocusScreen` 的读数据 effect 依赖是 `[host, refresh]`，
这两个值在**整个应用生命周期里都不会变**。于是：

1. 冷启动落在「任务」页 —— 本地空的，屏**已挂载**
2. 去「我的」同步 —— op 下载、应用、物化
3. 切回「任务」—— **屏一直挂着，effect 不会重跑** → 仍显示「还没有任务」

**功能是对的，界面在说谎。** 用户据此会认为"多端同步没成功"。

**修法**：给 `apps/mobile/src/sync/store.ts` 加 `dataRevision`（每完成一次同步 +1，
**在 `finally` 里加** —— 同步是先下载后上传两段，下载段可能已经应用了远端 op 而上传段才失败），
三个屏把它加进依赖数组。

**验收（可 falsify，全程不回退不重启）**：

| 步骤 | 实测 |
|---|---|
| 重装 App（干净数据容器），冷启动落在任务页 | **「还没有任务」** |
| 切到「我的」填凭据 → 同步 | 状态 **已是最新**，`上次成功同步 9-26 13:10` |
| 切回「任务」（**没重启、没回退**） | **「2 项待办」**，两条任务名都在 |

**新增回归门禁 `pnpm check:materialized-reads`**：任何屏只要调用了读物化状态的 API，
就必须引用 `dataRevision`。

> 🔴 **这条门禁第一版是坏的，记在这里**：反证时我把 `dataRevision` 从**代码**里删掉，
> 门禁**照样报绿** —— 因为文件里的**注释**还写着这个词，正则匹配到了注释。
> **一条不会失败的检查等于没有检查。** 修法是匹配前先 `stripComments()`
> （字符串内容保留）。修完后反证：移除代码、保留注释 → **退出码 1**，这才算数。

#### ⚠️ 仍未解释的一点（不要当成已解释）

在修好之前的那次同步里，「上次成功同步」**没有前进**（停在 `12:39`），
而 op 确实下载并应用了 —— 说明**那一次的最终状态不是 `synced`**。
修好后重新验收时状态是 `synced`、时间戳正常前进，**所以这是一次性现象，根因未定位**。
记在这里，因为它可能意味着"下载成功但收尾失败"的某条路径。

#### ⚠️ 还没做到的
- **普通域名 + 明文 HTTP** 仍未直接观测（由 §2.16 推断同拦）—— 而且现在这个域名
  已经被 certbot 配成 **301 跳 HTTPS**，所以那条路径在这个环境里已经不复存在了。
- **真机**仍未测。
- 这次实测用的域名（`heyta-tmp.litopia.space`）与证书都是**临时资产**，
  用完应当删记录 + 撤容器；**不能当成正式环境**。
  → **2026-09-27 更新**：域名已换成 `heyta.finlaw.cloud`（[deployment.md §3.7.1](../runbooks/deployment.md)），
  但**后半句仍然成立** —— 服务端至今还是 `TEST_MODE=true` 的本地镜像，没变正式环境。换域名不等于转生产。
- **`litopia.space` 自身几乎全部记录都指向 `121.4.24.238`（= OPP/12km，09-27 00:00 停服）** ——
  这次顺带发现的，与 heyta 无关但会一起下线。

---

### 2.17 ✅ 移动端"同步完了界面不刷新"（已完成并验收）

**症状**：另一端（node-host「笔记本」）建的任务同步到了手机上，`ops` 表里 `applyStatus=applied`，
但「任务」页一直显示「还没有任务」；**重启 App 就出现了**。

**根因**：三个屏读的是**内存里的物化状态**，而 `useEffect` 依赖是 `[host, refresh]` ——
这两个值**整个应用生命周期都不会变**。冷启动落在「任务」页（挂载时是空的）→
去「我的」同步 → 切回来 → **屏一直挂着，effect 不会重跑**。

> `state` 那张 SQLite 表是空的，但那是**红鲱鱼**：`STORES.STATE` 在非测试代码里
> **从来没被写过**，物化状态只在内存（`engine.getState()`）。

**修法**：`apps/mobile/src/sync/store.ts` 加 `dataRevision`（每完成一次同步 +1，
**在 `finally` 里加** —— 同步是先下载后上传两段，下载段可能已经应用了远端 op 而上传段才失败），
`TasksScreen` / `CalendarScreen` / `FocusScreen` 加进依赖数组。

**验收（可 falsify，全程不回退不重启）**：重装 App（干净数据容器）冷启动 →「还没有任务」→
切「我的」填凭据同步 →「已是最新 / 上次成功同步 13:10」→ 切回「任务」→ **「2 项待办」**。

**回归门禁 `pnpm check:materialized-reads`**：读物化状态的屏必须引用 `dataRevision`。

> 🔴 **这条门禁第一版是坏的**：反证时把 `dataRevision` 从**代码**删掉，门禁**照样报绿** ——
> 因为文件里的**注释**还写着这个词。**一条不会失败的检查等于没有检查。**
> 改成匹配前先 `stripComments()`；修完后反证 → 退出码 1，这才算数。

**仍未解释**：修好之前那次同步，「上次成功同步」没前进（说明那一次最终状态不是 `synced`），
但 op 确实下载并应用了。修好后重新验收正常。**记在这里，不要当成已解释。**

---

### 2.18 🔴 移动端验收台架：宿主机过载会让 `input text` **静默丢字符**（✅ 已加固）

**这是本轮最费时间的一个坑，而且它伪装成了应用 bug。**

现象：Android 冲突闭环验收在「1. 配置同步凭据」报
`❌ 服务器地址 没填进去` / `❌ 访问令牌 没填进去`，
而同一个 dump 里 `✅ 界面认为已配置` —— **两个信号自相矛盾**。

**查证过程**（每一步都是实测，不是推断）：

| 步骤 | 结果 |
|---|---|
| 看模拟器实况 | `EditText` 内容 = `http://10.0.2`（应 20 字符）、`eyJhbGciOiJIUzI1NiIsInR5cCI6`（应 225 字符）|
| 手动 `input text "http://10.0.2.2:3000"` | ✅ **完整落地** —— 所以不是 `input text` 的固有限制 |
| 手动发 225 字符令牌 | ❌ 只落地 **28~33 字符**，而 `input text` **退出码是 0** |
| 查宿主机 | **load average 66 / 129 / 158（16 核）**，iOS 模拟器 91.8% + PerfPowerServices 81% + Chrome + DSH 同时在跑 |
| 看模拟器 | `System UI isn't responding` —— System UI **ANR** |

**结论：不是应用缺陷，是宿主机过载导致输入字符被丢、以及系统 ANR 弹窗盖住界面。**

**三处加固**（都在 `scripts/lib/mobile-e2e.sh`，所有验收脚本共享）：

1. **分块发送**：长字符串按 40 字符一段发，段间 `sleep 0.7`。一次甩 225 字符会丢一大半。
2. **读回补齐**：新增 `edit_value()`（复用 `_xy.py editval`），发完读回实际内容；
   是目标值的**前缀**就只补缺的尾巴，不是前缀就全选重来。
   > 后缀用 **python** 算，**不用 `${want:${#cur}}`** —— `${#中文}` 在非 UTF-8 locale 下
   > 数的是**字节**，偏移会错位、补上去是乱码且看不出原因。
3. **ANR 弹窗自动关掉**：放进 `dump()` 里。`dump` 抓到的 XML 里含
   `isn't responding` 时，点掉 `Wait`/`等待` 再重抓。
   > 这类"探针成功、但内容被别的东西盖住"最费时间：`<hierarchy` 在、dump 不报错，
   > 只是**里面一个输入框都没有**，于是报「找不到输入框：服务器地址」，
   > 把人引去怀疑界面改版。
4. **关掉 ANR 之后必须把应用拉回前台**（`ensure_app_foreground`）。
   > 🔴 第二版仍然失败，日志给出了新线索：
   > ```
   > • mobile-e2e-e2ee-passmobile-e2e-e2ee-passmobile-e2e-e2ee-pass…（7 次）
   > • Search Google
   > ```
   > ANR 弹窗关掉后，前台落到了 **Google 搜索**上，后续 `input text`
   > **全部打进了那个搜索框**。脚本报"口令没填进去"，
   > 而真相是**它在给另一个应用打字** —— 这类错误还会**污染后面的步骤**
   > （应用状态没变，屏幕上却全是垃圾输入）。
   > 用 `am start -n $PKG/.MainActivity` 纠正前台（不用 `monkey`：那是随机事件流，会顺带乱点）。
5. **补齐循环重试前必须重新聚焦字段**。
   > 焦点不在该字段时，`CTRL+A` 选不中、`DEL` 删不掉，而 `input text` 会**追加到别处**。
   > 上面那 7 次重复就是这么来的：断言只看"最终对不对"，中间 6 次重试把界面搞得更脏。

**加固后的实测结果**：步骤 1 从三个 ❌ 变成全 ✅
（`✅ 已填 服务器地址` / `✅ 已填 访问令牌` / `✅ 三个凭据字段同时都在`），
整轮验收 **通过 25 项，失败 0 项**。

> **教训**：探针报"没填进去"时，先问**输入有没有真的送到**，再问应用。
> 而"输入命令退出码 0"完全不能证明字符落地了。

---

### 2.19 🔴 冲突闭环验收原先**只覆盖了一半**（✅ 已补上「保留本机」）

§2.16 之前那版脚本只测了「保留**远端**」这一侧。而目标要求的是**两个动作都要走 op-log**：

| 动作 | 语义 | 当时覆盖 |
|---|---|---|
| 保留远端 | 丢弃本地待上传项（**但不删 op**） | ✅ 有 |
| 保留本机 | **重新派发一个新 op** | ❌ **没有** |

两个动作走的是**完全不同的代码路径**，而"重新派发"那一侧更容易写错
（opId 要不要换？基线要不要更新？）。只验一个就说"闭环通了"，等于把另一半留成未测代码。

**补上的步骤 7b–9b**，核心断言是这条：

> 选了「保留本机」之后，**服务端 op 数必须增加**。
> 如果实现成了"只清掉冲突标记、不重发"，界面看起来完全正常（冲突没了），
> 但**另一台设备永远收不到这一版** —— 这正是要拦住的。

**写这段测试时自己踩的两个坑（都记下来）**：

1. **用错了标题变量**：手机此刻**还没下载**笔记本刚做的那次改名，
   所以它界面上的勾选框是 `完成：$LAPTOP_TITLE`（旧标题），不是 `完成：$SECOND_TITLE`。
   第一版写成后者，日志里"找不到勾选框"旁边正好打印着旧标题，一眼能看出来。
   > 而这恰恰是**造真并发**的前提：手机在旧基线上改，笔记本在新基线上改。
2. **不要硬编码收敛方向**：第 3 步是"翻转勾选"，翻完是开还是关取决于之前的状态。
   断言写成 `= completed` 是在赌一个没验证过的前提。
   真正的要求是**两端一致** —— 改成先读手机当前状态，再和笔记本比对。
3. 🔴 **又一次踩了"点了就算成功"**（而这个坑原脚本第 4 步已经写明过）。
   第 3 步第一版只断言"找到勾选框 → 点 → ok"，于是它**通过了**；
   但紧接着两条证据互相印证地说明**那一下根本没产生本地 op**：

   | 证据 | 说明 |
   |---|---|
   | `❌ 第二次没报冲突` | 没有本地改动就没有并发 |
   | `解决前服务端 op 数 = 4` | 笔记本刚加过一条 op，本该 ≥5 |

   **修法**：点完必须断言**标签翻转成了另一个**（`完成：X` ↔ `取消完成：X`），
   而且要滚动去找 —— 翻转后这条会移进/移出「已完成」分组。

   > 教训：**"点了"不是"改成了"**。原脚本里写着这条注释，我在新写的代码里又忘了一次 ——
   > 说明这类纪律光写在注释里不够，得让断言本身无法通过才行。

4. 🔴 **"永远不会失败的断言"** —— 这轮抓到的更根本的一类问题。

   7b 步骤 1 第一版写的是：

   ```bash
   for i in $(seq 1 12); do sleep 4; dump; [ … ] && break; done
   ok "手机已同步到最新（起点干净）"      # ← 循环结束就打 ✅，超时也打 ✅
   ```

   **超时和成功打出同一句话。** 于是它一路 ✅，而紧接着就是
   `❌ 第二次没报冲突` + 手机上「正在上传… / 待上传 1 项」——
   说明所谓的"干净起点"**根本不存在**。

   这和 §2.17 那个被注释骗过的门禁是**同一个病**：
   **判据必须能区分"成功"和"没成功"，否则它只是在装饰日志。**

   **修法**：判据改成三态，把"环境没跑完"和"产品真的错了"分开 ——

   | 观测 | 含义 |
   |---|---|
   | 出现冲突 | ✅ 成功 |
   | 仍在「正在上传…」 | ⏳ 环境没跑完，**继续等**（这台模拟器一次同步要 160 秒，48 秒完全不够） |
   | 结算了但无冲突 | ❌ **这才是真的失败** |

   不区分后两者，就会把"宿主机太慢"误判成"并发冲突有 bug"，
   然后去改一段本来正确的代码。

   **同时补了一条 probe**：笔记本 `sync` 报成功之后，回查服务端 op 数是否真的 +1
   —— "sync 返回成功"不等于"op 到了服务端"（§2.10 那个悬案就是这种形态）。

   > 顺带纠正一处**我自己的误判**：我一度推断"笔记本的改名没到服务端，
   > 因为 op 数只有 4、本该 ≥5"。逐条数下来 4 是**正确的**
   > （CRT + rename-1 + 保留远端派发的新 op + rename-2），
   > 笔记本那条**到了**。**"数字不符合预期"不等于"链路断了" —— 先把预期本身算对。**

### 2.20 ✅ 「保留本机」已用零 mock E2E 证实（阶段一第 3 条闭合）

决定性证据（真模拟器 + 真服务端 + 真 Postgres）：

```
✅ 第二次检测到真冲突
✅ 服务端 op 数增加（3 → 4）—— 确实重新派发了新 op
```

**为什么这条断言才是关键**：如果「保留本机」被实现成"只清掉冲突标记、不重发"，
界面看起来**完全正常**（冲突没了、本机值还在），但**另一台设备永远收不到这一版**。
op 数从 3 增到 4 是唯一能证明"重新派发"的观测。

至此两个解决动作都有真实证据：

| 动作 | 语义 | 证据 |
|---|---|---|
| 保留远端 | 把远端载荷表达成本地新 op | 步骤 5–9 全绿 + 双端收敛到同一值 |
| **保留本机** | 重新派发本地 op（**新 opId**） | **op 数 3 → 4** |

**仍然脆的地方（诚实记录）**：宿主机负载高时（load 30–230、同步实测 160–220 秒），
"干净起点"这一步会在 360 秒内跑不完，于是后续步骤的基线不干净。

> 这一轮抓到的**四个探针错误**，全部是同一个病根 —— **把"我没看到"当成"它不存在"**：
>
> | 探针报的 | 真相 |
> |---|---|
> | `❌ 第二次没报冲突` | 手机上**还在上传**，同步根本没跑完 |
> | `❌ 脚本无输出、没回收` | 脚本第 38 行有 `exec >>"$LOG"`，输出在日志里 |
> | `❌ 修复无效（仍 BUSY）` | `is_busy` 是"**任一**进程命中即为真"，旁边有 xiaoli 的真实构建 |
> | `❌ 修复前也是"被忽略"` | 我在两个版本上硬编码了**同一份新规则**，等于自己跟自己比 |
>
> **修法不是"再试一次"，而是让探针能区分**：三态判据、`pgrep` 覆盖成只测目标 PID、
> 从文件里**提取**真实逻辑而不是手抄一份。

### 2.21 ⚠️ 门禁报的错可能是"编译到一半文件被改了"

`pnpm check` 报 `apps/landing` 构建失败：

```
src/components/SelfHost.tsx(139,16): error TS2552: Cannot find name 'STEPS'.
```

但**当前文件是对的**（第 138 行 `{steps.map((step, index) => (`）。看时间戳：

| 事件 | 时刻 |
|---|---|
| 门禁开始写日志 | `16:27:12` |
| `SelfHost.tsx` 最后修改 | `16:27:30` |

**文件是在门禁跑的过程中被改的** —— 构建编译的是修改前的版本。
单独重跑那个包立刻 `✓ built in 1.59s`，整套门禁重跑退出码 0。

> **教训**：`pnpm check` 失败时，先确认**它编译的是不是当前这份文件**。
> 在有并发编辑（或多 agent 协作）的工作区里，"门禁失败"可能只是**时序**，
> 而照着那个错误去改代码，会把**已经正确的代码改坏**。
> 判据很简单：**报错行的内容和你现在读到的不一致 → 先怀疑时序，别改代码。**

### 2.22 🔴「在错误的屏幕上找『没有』」—— 一个假阳性，四个位置

这一轮最贵的一类失败，不是"没测出来"，而是**测出来一个错的结论**。

冲突验收的步骤 8 报 `✅ 冲突已解决`，同一步的下一句却是
`❌ 手机没显示笔记本那一版`，而 7b 的屏幕又明确写着 `• 有 1 处冲突待你选择`。
**三条证据互相矛盾。** 真相是步骤 7 的那一下点击没生效，冲突从未消失 ——
`✅` 是假阳性。判据原文：

```bash
[ "$(has_sub "处冲突待你选择")" = "0" ] && ok "冲突已解决"
```

冲突提示挂在**「我的」页**上。调用时屏幕停在「任务」页 —— 那段文字当然不存在。
**在没有承载该提示的屏幕上判"没有"，等于没判。**

更贵的是它会**级联**：7b 的基线建立在一个不存在的前提上，于是连爆 5 个失败
（干净起点没结算 / 找不到勾选框 / 第二次没报冲突 / 点不到逐条处理 / op 数没增加），
**每一个看起来都像「保留本机」坏了**，而真正坏的只是前面那一下点击。
排查方向被彻底带偏。

修法两步，缺一不可：

1. **判据先导航**。新增 `conflict_pending()`：先 tap「我的」tab，再 `dump`，再判存在性。
2. **级联闸门**。前置不成立时明确**停机**，并说明"这不是「保留本机」失败，
   是环境导致的前置步骤未完成"，而不是继续推出一串看似指向产品的失败。

同一个 bug 在**四个位置**都有，我修步骤 8 时**漏了 8b**：

| 位置 | 症状 |
|---|---|
| 步骤 8 的"冲突消失" | 假阳性 `✅` |
| 步骤 8b 的"冲突消失" | 同一个写法，漏改 |
| 步骤 9b 读勾选状态 | 8b 的 `conflict_pending()` 把屏幕留在「我的」页，9b 没切回来 |
| 步骤 9b 找任务标题 | 只见 `$LAPTOP_TITLE`，而收敛后可能是另一个标题 |

第 3 条尤其值得记：**修一处引入的导航副作用，成了下一处的根因。**
`conflict_pending()` 为了看到提示必须跳到「我的」页，而 9b 紧接着在那一页上找任务行 ——
屏幕 dump 里是 `• 状态`（「我的」页的字段）。**改一个 helper 的行为时，
要把所有调用点之后的假设重新过一遍。**

> **判据**：一个"找不到"的断言，只有在**承载该东西的屏幕确实在前台**时才有意义。
> 这和 §2.20 的"三态判据"是同一条原则的两个面：
> 三态解决的是**"分不清 A 和 B"**，导航解决的是**"根本没在看"**。

#### 修完之后：全绿

```
通过 35 项，失败 0 项
✅ 移动端冲突解决闭环：真机全链路通过
```

两个解决动作都有了完整证据，且都是**双向收敛**（不只是"手机变了"）：

| | 保留远端 | 保留本机 |
|---|---|---|
| 冲突消失 | ✅ | ✅ |
| 决定性断言 | 手机显示笔记本那一版 | **服务端 op 数 4 → 5（确实重新派发）** |
| 另一侧收敛 | ✅ 笔记本侧值一致 | ✅ 双端勾选状态都是 `open` |

> ⚠️ **这条全绿的代价是四轮失败。** 值得记的是：那四轮里**产品一次都没错**，
> 错的分别是 ① 测试等太短 ② 断言的屏幕不对 ③ 前置失败后继续推 ④ 只查了一个标题。
> **测试失败不等于产品有 bug** —— 但反过来说，一个会假阳性的测试
> 曾让 `✅ 冲突已解决` 和 `❌ 值没收敛` 同时出现。**那种测试比没有测试更危险**，
> 因为它给出的错误结论会被当成事实写进文档。

---

### 2.23 🔴 `@heyta/i18n` 自带的 React 在 APK 里打成了**第二份**，应用启动即崩

**症状。** 给移动端加了四象限视图后重建 release APK、装进模拟器，应用**一启动就崩**：

```
TypeError: Cannot read property 'useContext' of null
  at TasksScreen
```

`useContext` 是 `null` 的属性 —— 即 `react` 这个模块被解析成了 `null`。
可默认视图是 `'list'`，我新写的象限分支**在启动时根本不渲染**，
所以它不可能是渲染逻辑的问题，只可能是**模块级**的问题。

#### 真因：`@heyta/i18n` 自己带了一份**另一个版本**的 React

`apps/mobile` 与 `packages/i18n` 各自解析到了**不同的 React**：

| 位置 | 版本 | 来源 |
|---|---|---|
| `apps/mobile/node_modules/react` | **19.2.3** | app 的依赖 |
| `packages/i18n/node_modules/react` | **19.3.0** | i18n 的 `devDependencies: react ^19.2.0` |

`packages/i18n/dist/index.js` 位于**仓库根**下，Metro 从它出发**逐级向上查找**时
命中的是 `packages/i18n/node_modules/react`，而**不是** `nodeModulesPaths` 里的那两份 ——
`nodeModulesPaths` 是"**找不到时**才去的地方"，本包自己有就不去。

于是 `@heyta/i18n` 的 `useContext` 来自 19.3.0，`TasksScreen` 自己的 hook 来自 19.2.3。
两个 React 各有各的 dispatcher，i18n 那一侧就是 `null`。

**判据（可复现、不需要跑真机）。** 打一份**可读的** bundle（不要 Hermes 字节码）数一数：

```bash
npx react-native bundle --platform android --dev false --minify false \
  --entry-file index.js --bundle-output /tmp/b.js
grep -c 'react.production.js' /tmp/b.js        # 修复前 2，修复后 1
```

**修复**在 `apps/mobile/metro.config.js`：用 `resolveRequest` 把
`react` / `react/jsx-runtime` / `react/jsx-dev-runtime` 三个说明符的解析起点
**硬改写**成 app 根，钉成单实例。

⚠️ **`extraNodeModules` 修不了这个** —— 它只是解析失败时的兜底，
而 i18n 本地那份 React **存在**，正常解析会成功，兜底根本不会触发。
必须改 `originModulePath`。

### 🛡️ 已加门禁：`pnpm check:mobile-bundle`（第 12 步，**android + ios 两端**）

这个缺陷最刺眼的地方不是它本身，而是**门禁全绿、应用却根本打不开**：
`pnpm check` 退出码 0、十二道门禁全过、58 项领域测试全过 —— 装进模拟器一启动就崩。
所以这里补一道**看产物、不看声明**的门禁：打一份 bundle，数 `react.production.js` 出现几次。

**为什么必须看产物。** 静态地查"某个包有没有自己的 `node_modules/react`"是**查不出问题**的 ——
那是 pnpm 的**正常**布局，每个 RN monorepo 都长这样。
真正决定行为的是**打包器最后装进去几份**。

**为什么两端都要查。** 修法在 `metro.config.js`，那是**共享**配置 ——
但这**不等于**"改一处两端都对"：Metro 的解析图是**按平台**构建的
（platform-specific 文件、`.ios.js`/`.android.js`、各自的 haste 名），
两端走进的模块集合并不相同。只查 android 的话，一个只在 ios 解析路径上出现的重复实例
会**整个溜过去** —— 而"只在 iOS 上崩"是移动端最难查的一类缺陷。

**判据来自实测**：修复前 **2** 份，修复后 **1** 份。

⚠️ 刻意**不用 Hermes 字节码**：字节码里搜不到这些字符串，门禁会变成"永远通过"。
所以用 `--dev false --minify false` 拿可读 JS。

**证伪记录**（门禁的价值全在这）：把 `metro.config.js` 的单实例改写临时改成直通，
门禁**退出码 1**，两个平台**都**报了出来，并直接指名来源与版本：

```
❌ [android] react 出现了 **2** 份（必须是 1 份）
   候选来源：
     apps/mobile/node_modules/react -> 19.2.3
     packages/i18n/node_modules/react -> 19.3.0
❌ [ios] react 出现了 **2** 份（必须是 1 份）
```

**一个只能通过的检查没有价值。** 这道门禁被证明**能失败**（两端都能），
而且报的是根因不是症状。

> ⚠️ 写这道门禁时我又踩了同一条老坑：第一版跑完我用 `... | sed 's/^/  /'` 看输出，
> 于是 `$?` 取到的是 **`sed` 的退出码**（0），看起来"通过" ——
> 而它其实因为 `readFileSync` 重复声明直接崩了。
> **永远不要把门禁管道进 `tail` / `sed`**（§2.22 已记过，这是第二次）。


⚠️ 范围**刻意收窄**到 `react` 那三个入口，不要顺手把 `react-native` 也拦进来：
它内部有大量嵌套解析，改写起点会连带弄坏它们。

### 🔴 我在这一轮先得到的**错**结论，以及它为什么值得留下

我最初把锅判给了"**并发构建**"：`pnpm check`（会重建 `packages/*/dist`）和
`./gradlew assembleRelease` 我让它们并排跑了，时间线看起来恰好咬合
（gradle 18:42 出包、`dist` 18:43 还在写）。理论很漂亮，我把它当"真因"写了下来。

**然后我做了串行重建再验证 —— 还是崩。理论被自己的实验证伪了。**

真实原因是上面那个**双 React 实例**，它跟并发毫无关系。
两处细节当时都指向真相，而我都没往下追：

1. 崩在 `useContext` 的**属性访问**上（`_react.useContext`），
   而"dist 被写坏"更可能表现为 `undefined is not a function` 或解析报错；
2. 崩的模块是 `react`，一个**我完全没碰过**的依赖 ——
   这种情况更该先查**依赖图**，而不是查**命令时序**。

**教训不止"别并发构建"（那仍然是个好习惯），更是：**
> 一个漂亮的解释会**主动**说服你停止排查。写下结论之前，
> 先问"**我做了什么实验能把它证伪**"。我这次做了，所以只错了一轮；
> 如果不做，这条错因会被当成事实写进文档 —— 而这正是 §2.22 警告过的同一件事。


**排查走错的路（值得记下来）。** 我花了好几轮去怀疑自己的改动：
内联 `type MessageKey` 导入、`bucketByQuadrant` 的导出形态、循环依赖。
都错了 —— 错在**假设"代码变了所以崩了"**，而没有先问
"**依赖图里有两份 React 吗**"。

**那一轮我是怎么浪费掉的。** 我甚至一度从时间线里编出了一个漂亮的解释：
`pnpm check`（会重建 `packages/*/dist`）和 gradle 打包并排跑了，
gradle 18:42 出包、`dist` 18:43 还在写 —— 于是断定 APK 里打进了"半写的 dist"。
**串行重建后照崩**，理论被自己的实验证伪。

那条推测虽然错了，**"打包不要和 `pnpm check` 并行"仍然是该守的习惯**
（构建的输入在构建期间被改写，"成功"描述的就是一个从未同时存在过的状态，
与 §2.21 是同一件事的两面）。只是它**不是**这次的病因。

---


---

### 2.24 ✅ 移动端四象限已上线并**在真机上跑通闭环**

**背景。** 落地页一直在宣传四象限，而**手机上没有** —— 宣传了一个不存在的功能。
Web 端有，但带着三个缺陷（详见 ADR-0015 §7）。

**做了什么。**

| 层 | 内容 |
|---|---|
| 领域层 | `planQuadrantDrop`（`packages/domain/src/quadrant.ts`）+ 6 个测试，含"4 象限 × 3 种截止时间状态必须真的落在目标格"的穷举 |
| 写入口 | `TaskActions.setQuadrantDrop` —— **一次拖放 = 一条 op**（原来 Web 是两次 `await`，中间态可见） |
| Web | `QuadrantBoard` 改用领域层纯函数，修掉"拖进 Q1 落在 Q2"与"隐式两条 op" |
| 移动端 | 「任务」页新增**视图切换**（列表 ↔ 四象限）；详情页补上「重要」开关 |
| i18n | `mobile.tasks.view.*`、`mobile.quadrant.q1..q4`、`mobile.detail.field.important` 等（zh/en 同步） |

**为什么移动端不做 2×2 网格。** 手机宽 402px，四格每格只剩 ~190px，
勾选框 + 标题 + 日期塞不下。**"矩阵"图形是桌面端的形态**；
手机上的等效表达是**按象限分组的四段**，信息一模一样，
且沿用本页已有的 SectionHeader + 行。落地页卖的是"不用自己想先做哪个"，
那个价值在分组里完整保留。**这是形态差异，不是功能缺失。**

**🔴 真机闭环证据（不是"代码写完了"）。** emulator-5554，`com.heytamobile`：

| 步骤 | 观测 |
|---|---|
| 打开「任务」页 | 「列表」/「四象限」两个 Chip 都在（(115,628) / (300,628)） |
| 点「四象限」 | 四个象限标题 + 计数全部渲染：`重要且紧急 0` / `重要不紧急 0` / `紧急不重要 0` / **`不重要不紧急 1`** |
| 真实任务归属 | `laptop-edited-conflict-e2e-175056`（无截止时间、无重要标记）**正确地落在「不重要不紧急」** —— 证明 `bucketByQuadrant` 在真实数据上工作 |
| 点开该任务 → 滚到「优先级」下方 | 「重要」分区 + 「标记为重要」Chip + 提示语**都在** |
| 点「标记为重要」 | Chip 变为「取消重要」 |
| 返回四象限 | **`重要不紧急 1` → 同一条任务；`不重要不紧急 0`** |

**任务从 Q4 移到了 Q2。** 写入 → `bucketByQuadrant` 重新推导 → 视图重渲染，
整条链在真设备上闭合，用的是真 SQLite + 真 op-log。

**移动端仍然是"点选"而不是"拖拽"。** `apps/mobile` 没有
`react-native-gesture-handler` / `reanimated`（要加就得动原生依赖 + pods + 重建）。
当前入口是"打开任务 → 切「重要」"，**能满足日常使用**；
真正的拖拽手势留给后续单独决策 —— 不要为了追上落地页的措辞而仓促引入原生依赖。

---

## 3. 未决事项（需要产品决策）

### 3.1 跨平台 UI 技术栈 —— ✅ **已决定：React Native**

产品负责人指示"用跨平台 UI 技术栈"。结论与完整论证见
**[ADR-0004](../adr/0004-ui-stack.md)**（本表仅作摘要）。

| 选项 | 逻辑复用 | UI 复用 | 结论 |
|---|---|---|---|
| **React Native** | ✅ 全部 | 部分 | ✅ **选中** |
| Flutter | ❌ Dart，不在 JS 生态 | ✅ | 违反"留在 JS 生态" |
| 各端原生（SwiftUI / ArkUI） | ⚠️ 需跨语言桥接或重写 | ❌ 各自写 | 与"跨平台"指示相悖 |
| Capacitor / WebView | ✅ 全部 | ✅ 全部 | 🔴 **ADR-0003 §3.2 已否决** |

**选 RN 没有新增设计系统债务**：`generated/tokens.json` 一直在产出，
生成器注释里本就写着它是给"React Native 等 JS 运行时"的。
ADR-0003 §2.4 表里那条"P2 要做 tokens → JS 对象导出"**其实已经完成了**。

#### 🟡 下一步是验证，不是开发

> 🔴 **这一小节已被后面两轮推翻一半，先看结论再往下读**：
> **出包已实测通过** —— §3.24 用官方模板编出最小 ArkTS HAP（126 KB）与
> RNOH 原生侧 HAP（37 MB），§3.25 又拆掉桩、跑到 **release HAP**（零桩全链路）。
> **仍然成立的只有"跑起来"这一半**：缺模拟器系统镜像与签名（产物是 `*-unsigned.hap`）。
> 也就是说：**"构建链通"已从"未验证"变成"已验证"，"能在鸿蒙上跑"仍未验证。**
> 下面是当时（2026-09-25）的记录，保留对照。

**依赖链已实测打通，但"构建出 HAP 并运行"仍未验证。**（← 当时的状态；见上面的更新）

实测已确认（2026-09-25，本机）：

| 项 | 结果 |
|---|---|
| JS 侧（npm） | `@react-native-oh/react-native-harmony`，**MIT**，2026-09-24 发布 |
| 鸿蒙侧（ohpm） | `@rnoh/react-native-openharmony@0.84.3`，**MIT**，52 个版本 |
| `ohpm install` | ✅ **成功，28.9 秒**（309 MB / 11975 文件：2509 `.h`、2216 `.cpp`、40 `.ets`） |
| npm tarball | ✅ 103 MB / 1391 文件，含 3 个真实 `.har` |

🔴 **仍未验证**（← 当时的状态，**前半句已被 §3.24/§3.25 证伪**）：没有跑过 `hvigorw assembleHap`，**没有编译过一行 C++，
没有生成过 HAP，没有在设备或模拟器上跑起来**。已确认的是"零件齐全且取得到"，
未确认的是"这些零件能拼成能跑的东西"。原生侧需本地编译（`.so` 只有 4 个，
非各 ABI 齐全），这是最可能出问题的地方。

> **两处已更正的错误说法**：
> 1. 初稿写"本机没有鸿蒙工具链，也没有 ArkTS 编译器"，**这是错的** ——
>    DevEco Studio 6.1.1.300 装在本机，SDK API 24（陷阱 #21）。
>    ArkTS 产物现已用真编译器验证（`pnpm check:arkts`）。
> 2. 官方《环境搭建》文档写"仅支持 RN **0.72.5**"，**该文档已过时**：
>    实测两侧都已在 `0.84.x`。**照文档选版本会选到三年前的分支**（陷阱 #22）。

因此**投入 UI 开发之前，第一个任务仍然是"让一个最小 RN 壳在鸿蒙上真跑起来"**
（⚠️ 出包这一步已在 §3.24/§3.25 完成；**剩下的只是"跑起来"**，而它缺的是
模拟器系统镜像与签名，不是代码）。
若这一步失败，"跨平台"的结论需要重估（可能退化为"RN 覆盖 iOS/Android +
鸿蒙单独用 ArkUI"），那会改变 ADR-0004 的结论。

在验证完成之前，§2.1 / §2.2 / §2.3 的成果不受影响，已全部完成。

### 3.2 其他

- Android 备案（明确指示：暂不处理）
- 桌面端（macOS/Windows/Linux）由 Web 还是 Tauri 覆盖

---

## 4. 从 P1 带过来的产品问题

> ⚠️ **编号提醒**：§3.10–§3.27 这些后续轮次的记录**排在本节之后**（它们按时间追加，
> 没有插回 §3 里）。读到 §4 不要以为 §3 已经结束 —— 按标题跳转即可。

P1 计划 §7 留下、尚未回答的：

- ~~四象限自动归类规则~~ → **已回答**：[ADR-0015](../adr/0015-four-quadrant-as-derived-view.md)。
  结论：**不做"自动"归类**。紧急由 `dueDate` 推导（客观），重要必须由用户回答（主观，
  任何算法都猜不对）；象限是**派生视图**，不建实体。派生层 `packages/domain/src/quadrant.ts` 已完成。
- 习惯连续天数算法（跨时区、补打卡怎么算）
- 番茄钟是否强制关联任务
- P1 是否含回收站

### 3.10 ✅ 移动端冲突 E2E 已在**新 APK** 上重跑通过（附起栈配方）

**上一轮我把它记成"跑不了"，这一轮跑通了。** 记录保留在这里，因为"当时为什么跑不了"
比"现在跑通了"更有用 —— 缺的从来不是环境，是**没人知道要起哪几样东西**。

**结论（本轮实测）**：`scripts/verify-mobile-conflict.sh` →
**通过 35 项、失败 0 项**，退出码 0，跑在 **19:16 那个修复了双 React 的 release APK** 上
（`lastUpdateTime=2026-09-26 19:16:52`，与 APK 文件时间一致 —— **校验过装的就是验的**）。

关键断言：

| 步骤 | 断言 | 结果 |
|---|---|---|
| 8b | 「保留本机」后服务端 op 数 **4 → 5** | ✅ 证明是**重新派发新 op**，不是改旧 op |
| 9b | 笔记本与手机勾选状态 | ✅ 双端收敛到同一个值（`open`） |
| 10 | 直接查 Postgres 复核 | ✅ `ops=137 devices=87` |

#### 起栈配方（**下次照抄，别再摸索**）

上一轮记录的四项"缺失"，本轮查明**只有一项是真的**：

| 上一轮的判断 | 本轮实测 |
|---|---|
| postgres 客户端没有 | ❌ **误判** —— 装了 14/15/17 三个版本，只是 `/opt/homebrew/bin` 不在当时的 PATH |
| `DATABASE_URL` 没有 | ⚠️ 真的没有，但**不需要写进 `.env`** —— 用环境变量传即可 |
| `/tmp` 凭据文件没了 | ✅ 真的没了，但**本来就该每轮重建**（见下） |
| 服务端没运行 | ✅ 真的没运行 —— **这才是唯一要动手的** |

```bash
# 1) 起服务端（TEST_MODE 必须开，否则 /api/test/create-user 不挂载）
cd server && NODE_ENV=development PORT=3000 \
  DATABASE_URL="postgresql://<user>@127.0.0.1:5432/heyta_mobile_smoke" \
  TEST_MODE=true TEST_MODE_CONFIRM=yes-i-understand-the-risks \
  node dist/src/index.js &
curl -s --noproxy '*' http://127.0.0.1:3000/health   # {"status":"ok","db":"connected",...}

# 2) 建新号（`/opt/homebrew/bin` 必须在 PATH 上，否则 client 预算断言会红 ——
#    那是**故意的**：查不到 ≠ 通过）
export PATH="/opt/homebrew/bin:$PATH"; export SERVER=http://127.0.0.1:3000
. scripts/lib/mobile-e2e-fresh-account.sh && heyta_e2e_fresh_account

# 3) 跑
bash scripts/verify-mobile-conflict.sh
```

⚠️ **为什么必须每轮换号**：`MAX_VECTOR_CLOCK_SIZE = 20`，而每跑一轮会新增两个 clientId。
同一个号跑到第 11 轮就越过 20，向量时钟被裁剪 → 服务端把该设备的**每一条**写入判成
`CONFLICT_CONCURRENT` → 表现是"手机没有报冲突"（**极具误导性**）。
`heyta_e2e_assert_client_budget` 就是让这类前提在**第 0 步**自己说出来。

#### ✅ 已脚本化：`scripts/mobile-e2e-up.sh` / `down.sh`

三步已合成两条命令，**不再需要照抄上面的配方**：

```bash
bash scripts/mobile-e2e-up.sh      # 起服务端（幂等）→ 建新号 → 断言 client 预算
bash scripts/verify-mobile-conflict.sh
bash scripts/mobile-e2e-down.sh    # 停服务端（HEYTA_E2E_PURGE=1 连凭据一起清）
```

本轮实测：**从零起栈 → 跑 E2E → 通过 35 项、失败 0 项**，全程两条命令。

**幂等**是刻意做的：服务端已在跑就复用，不再起第二个。
理由是"起了第二个"有个很坏的失败模式 —— 第二个进程因端口占用退出，
而脚本若把"进程起来了"当成"服务端可用"，真正的问题要到跑 E2E 时才炸。

**`down.sh` 只停自己起的那个**（认 pidfile），不按端口或进程名乱杀：
本机同时跑着别的 3000 服务，误杀会让下一轮 E2E 莫名其妙地红。
停完还会**再探一次 `/health`** —— 验证的是"真的停了"，不是"发了 kill"。

##### 🔴 写这个脚本时撞到的真陷阱：两个 postgres 身份

`server/.env` 里写着 `POSTGRES_USER=supersync`，于是脚本第一版照抄了它，
结果报"连不上 `heyta_mobile_smoke`（用户 `supersync`）"。

**根因**：`.env` 那套是**容器化部署**（compose 里那个 postgres 容器）的凭据；
本机 homebrew postgres 是**另一套**，owner 是 OS 用户（`rocalight`），
`supersync` 这个角色**根本不存在**。

这个陷阱的隐蔽之处在于：报"连不上库"很容易让人去怀疑"库没建/没迁移"，
而真相只是**拿错了身份**。所以脚本现在**默认用 OS 用户**，
要改走 `HEYTA_E2E_DB_USER`，并且**刻意不从 `.env` 读**。

**证伪记录**（脚本的失败必须是响亮且具体的，而不是含糊超时）：

```
$ HEYTA_E2E_DB=definitely_not_a_real_db bash scripts/mobile-e2e-up.sh
❌ 连不上 Postgres 库 definitely_not_a_real_db（用户 rocalight）。库要先存在且已迁移。
   退出码=1
```

> **"重跑要重新摸索"就是它长期不再被重跑的原因。** 现在它是两条命令了。

### 3.11 🔴 iOS 构建当前是**坏的**，以及路上挖出的两个环境陷阱

**先说结论：本轮没能验证 iOS 应用能否启动**，因为 **iOS 根本构建不出来**。
这不是"少测一个用例"—— 它意味着**改过共享 `metro.config.js` 之后，iOS 侧没有任何产物可验**。
Android 已全绿（35/35 冲突闭环 + 四象限真机闭环），**iOS 仍然未验证**。

顺带说明起点：`apps/mobile/ios` 下**没有任何现成 `.app` 产物**，所以必须完整构建。
而 `scripts/verify-mobile-ios.sh` 的注释写得很清楚 —— 它**假定 Release 包已装好**，自己不构建。
于是"iOS 能不能构建"这个问题，**在脚本层面从来没有被问过**。

#### 陷阱 ①：本机 locale 不是 UTF-8，CocoaPods 直接崩

`pod install` 第一次跑就挂，报的是 Ruby 的
`Unicode Normalization not appropriate for ASCII-8BIT`。

**这个报错是假的** —— 它来自 `ErrorReport.markdown_podfile`，也就是
**CocoaPods 在生成错误报告时自己又崩了**，把真错误盖住了。

真因就是 CocoaPods 自己打印的那行警告：

```
WARNING: CocoaPods requires your terminal to be using UTF-8 encoding.
Consider adding the following to ~/.profile:
export LANG=en_US.UTF-8
```

实测 `LANG=[未设] LC_ALL=[未设]`。`Pod::Config#installation_root` 会对路径做
`String#unicode_normalize`，字符串却是 `ASCII-8BIT` → 抛异常。

> **教训**：报错栈里的那层"错误处理代码"本身崩了时，**先找它上面被盖住的真错误**，
> 不要顺着栈往下追。这里追下去会一路追进 Ruby 的 `unicode_normalize`，
> 而真因只是**一行 locale 警告**。

#### 陷阱 ②：代理环境变量污染 `node -p` 的 stdout，CocoaPods 拿到假路径

设好 locale 后换了个错：

```
[!] Invalid `Podfile` file: cannot load such file -- /Users/.../react-native@0.84.1_@babel+co
(node:73451) [UNDICI-EHPA] Warning: EnvHttpProxyAgent is experimental, ...
(Use `node --trace-warnings` to show where the warning was created).
```

**注意那条警告出现在"文件路径"里** —— 这就是全部线索。

`Podfile` 第 2 行是：

```ruby
require Pod::Executable.execute_command('node', ['-p', 'require.resolve("react-native/scripts/react_native_pods.rb", ...)']).strip
```

它把 `node -p` 的**捕获输出**当成文件路径去 `require`。
而本机 `HTTP_PROXY=HTTPS_PROXY=http://127.0.0.1:7890`，Node 22 会为
`EnvHttpProxyAgent` 打一条实验性警告 —— 这条警告混进了捕获输出，
于是 Ruby 拿到的"路径"是**警告文本 + 真路径的拼接**，`require` 必然失败。

**修法是压掉警告，而不是关掉代理。** 这一点很关键：先把代理 `env -u` 掉能修好这个错，
但会让 `React-Core-prebuilt` 因**下载不了预编译核心**而失败（见下）——
两个修法**互相打架**，所以必须选"保留代理 + 压警告"这条：

```bash
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
NODE_NO_WARNINGS=1 pod install     # 代理保持开启
```

实测 `NODE_NO_WARNINGS=1 node -p ...` 输出**干净**，`require.resolve` 返回的路径**真实存在**。

> 连带教训：这个仓库里 `node` 的输出**不是纯粹的数据** ——
> 环境里任何一条 warning 都可能混进去。凡是**把命令输出当数据用**的地方都该显式压警告。

#### 陷阱 ③（未解决）：`React-Core-prebuilt` 缺 `source`

压掉警告、保住代理之后，`pod install` 仍在同一个地方失败：

```
[!] The `React-Core-prebuilt` pod failed to validate due to 1 error:
    - ERROR | attributes: Missing required attribute `source`.
```

`React-Core-prebuilt.podspec` 第 10 行是 `source = ReactNativeCoreUtils.resolve_podspec_source()`，
即该函数返回了 `nil`。**本轮未查明它为什么返回 nil** ——
当时的记录写着"`resolve_podspec_source` 的定义不在 `react-native` 包内"，
**这句已被证伪**：定义就在包内 `react-native/scripts/cocoapods/rncore.rb:85`
（同名函数另见 `rndependencies.rb:69`）。真因与解法见下节（§3.12 陷阱 ③）。

**下一轮从这里接**：

1. 定位 `ReactNativeCoreUtils`（`grep -rn "ReactNativeCoreUtils" node_modules/.pnpm/react-native@0.84.1*/`）。
2. 看 `resolve_podspec_source` 依赖什么：本地缓存目录？某个 `download` 脚本要先跑？环境变量？
3. RN 0.84 的 prebuilt 机制有官方的准备步骤，**先查它的文档，不要自己猜**。

> ⚠️ **不要**为了让 `pod install` 过去而手写 `s.source` ——
> 那是在改第三方 podspec，下次 `pnpm install` 就没了，而且掩盖真因。

#### 本轮**没有**声称的事

- iOS 应用**没有**被验证能启动。
- `verify-mobile-ios.sh` **没有**被跑过（它需要已安装的 Release 包）。
- 目标里"能多端"的 iOS 一侧，**仍然是未验证状态**。

> ⚠️ 以上三条是**上一轮**（第 34 轮）的状态记录，保留是为了对照。
> **本轮（第 35 轮）已把 iOS 打通**，见下节 §3.12。

### 3.12 ✅ iOS 已打通：构建成功 + 启动 + 真实渲染（含三个环境陷阱的完整解法）

**结论**：iOS **构建成功、安装成功、启动成功、界面完整渲染**。
「能多端」的 iOS 一侧**现在是验证过的**，不再是"应该能跑"。

证据（全部实测）：

| 环节 | 结果 |
|---|---|
| `pod install` | ✅ 退出码 0，83 依赖 / 82 pods，`Podfile.lock` 20:05 |
| `xcodebuild`（Release / iphonesimulator） | ✅ 退出码 0 |
| `simctl install` + `launch` | ✅ pid 87231，**12 秒后进程仍在**，无崩溃报告 |
| 截图（1206×2622） | ✅ 非空白；**「任务」页完整渲染** |

**截图里能看到什么**（这是"能日常用"的直接证据）：标题「任务」、
日期「9月26日 星期六」、「2 项待办，0 项已完成」、
**「列表」/「四象限」视图切换**、收集箱、任务行、蓝色 FAB、底部四 tab。
中文全对、蓝白色系全对。
任务里有一条「**从笔记本同步过来的任务**」—— 说明 iOS 端**真的与服务端同步过**，
不只是界面上画了两个字。

#### 🔴 三个环境陷阱（每一个都会让后续每一轮白白烧掉）

**① 本机 locale 不是 UTF-8 → CocoaPods 崩**

`LANG=[未设] LC_ALL=[未设]`，于是 `Pod::Config#installation_root` 里
`String#unicode_normalize` 在 `ASCII-8BIT` 上抛异常。
**报出来的栈是假的** —— 它来自 `ErrorReport.markdown_podfile`，
即 CocoaPods **生成错误报告时自己又崩了**，把真错误盖住。

> 教训：错误处理代码自己崩了时，**先找它盖住的真错误**，别顺着栈往下追。

**② `HTTP_PROXY` 让 Node 的警告混进 `node -p` 的 stdout → CocoaPods 拿到假路径**

`Podfile` 第 2 行把 `node -p` 的**捕获输出当文件路径去 `require`**。
本机 `HTTP_PROXY=HTTPS_PROXY=http://127.0.0.1:7890`，Node 22 会为
`EnvHttpProxyAgent` 打一条实验性警告 —— 它混进输出，Ruby 于是拿到
「警告文本 + 真路径」的拼接，报 `cannot load such file`。

**修法是压警告，不是关代理**：关掉代理能修这个错，却会让预编译 tarball
下载不了。两个修法**互相打架**，正解是保留代理 + `NODE_NO_WARNINGS=1`。

**③ 仓库路径里有空格 → RN 预编译下载崩在 Ruby URI 上**

这是最深的一个。日志里那句极具迷惑性：

```
Failed to download release tarball: bad component(expected absolute path component):
```

看起来像**网络失败**，其实是 **Ruby 的 `URI` 错误**。
真凶在 `react-native/scripts/cocoapods/rncore.rb:146`（即 `node_modules/` 里的
RN 包，**不是本仓库的 `scripts/`**）：

```ruby
return {:http => URI::File.build(path: destinationDebug).to_s }
```

`destinationDebug` 是**含空格的绝对路径**（`.../All in one Data/...`），
而 `URI::File.build` 对空格**直接抛错**。所以下载其实与网络无关。

**解法：让 RN 核心与依赖都从源码构建，整条 URI 路径就不会被走到。**
`react-native/scripts/react_native_pods.rb:135` 是决定性的：

```ruby
if !ReactNativeCoreUtils.build_rncore_from_source()
  pod 'React-Core-prebuilt', :podspec => ...   # ← 只有「不从源码构建」时才加
end
```

两个开关（名字不对称，别记混）：

| 开关 | 管什么 | 关掉它 |
|---|---|---|
| `RCT_USE_PREBUILT_RNCORE` | React Core 预编译 | `=0` |
| `RCT_USE_RN_DEP` | React Native Dependencies 预编译 | `=0` |

#### ✅ 一条命令（下次照抄）

```bash
cd apps/mobile/ios
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
NODE_NO_WARNINGS=1 RCT_USE_PREBUILT_RNCORE=0 RCT_USE_RN_DEP=0 pod install
```

三个变量**缺一不可**，且顺序无关。之后正常 `xcodebuild` 即可。

> ⚠️ **不要**为了让 `pod install` 过去而手写 podspec 的 `s.source` ——
> 那是改第三方文件，下次 `pnpm install` 就没了，而且掩盖真因。
>
> ⚠️ 代价是**从源码编译 RN**（慢很多），但这是路径带空格的**唯一可靠解法**。
> 若哪天把仓库挪到无空格路径下，可以去掉这两个开关换回预编译。
> **那是个结构决策，不该由 agent 悄悄做。**

#### 🟡 仍然待做

- `scripts/verify-mobile-ios.sh` **本轮仍未跑**（现在前置齐了：包已装好，**下一轮可以直接跑它**）。
- 上面这三个变量应该固化进一个 `scripts/mobile-ios-pod-install.sh`，
  理由和 §3.10 一样 —— **"重跑要重新摸索"就是它长期不再被重跑的原因**。

### 3.13 🔴 `verify-mobile-ios.sh` 走的是**被明令禁止**的那条 I/O 路线（附已验证的替代路线）

> ⚠️ **本节的结论随后被自己推翻**：脚本已改用下面这条 idb 路线，
> §3.14 验通 shim、§3.15 推进到 28/30、§3.18 收口到 **31/31**。
> 本节保留，是因为"路线选错了"这个诊断本身仍然成立。

本轮试着跑 `verify-mobile-ios.sh`，**第 0 步就挂了**：

```
✅ 模拟器 1B785D80-... 已启动
❌ 找不到 Simulator 进程
通过 1 项，失败 1 项
```

#### 这不是"忘了开模拟器"，是**路线选错了**

- 脚本第 83 行：`SIM_PID=$(pgrep -x Simulator | head -1)` —— 它要的是 **Simulator.app 这个 GUI**，
  而我（以及任何 CI）用 `xcrun simctl boot` 起的是**设备**，GUI 根本没开。
  （⚠️ **这条判据随后已被删除**：现在的 `verify-mobile-ios.sh` 只要求设备 Booted，
  不再查 Simulator 进程 —— 见 §3.14。）
- **但就算把 GUI 打开也没用**：脚本第 172 行自己写着
  「本脚本**不会**用 `activate` 去把窗口拽到前台（那等于跟用户抢前台，**已被明确叫停**）」；
  第 30 行还记着目标窗口被另一个项目的 Simulator 窗口**整块盖住**（`遮挡=BLOCK`）。

也就是说：**这条脚本依赖"窗口可见 + 可点"，而用户已经明确禁止为了它去抢前台。**
所以它**在当前环境下不可能通过**，而且**不该**通过改脚本去激活窗口来"修"。

> ⚠️ 还要注意一个更隐蔽的问题：**陈旧默认值**。脚本第 74 行写死
> `UDID=${IOS_UDID:-691C20D9-FB85-4B81-A3CC-0F5623AEF082}`，
> 而这个 UDID 在本机**根本不存在**。不覆盖它就会指向一个不存在的设备。
>
> ⚠️ **随后已修**：现在脚本自己从 `xcrun simctl list` 里挑 Booted 设备，
> 写死的默认值已删除（`xcrun simctl list devices | grep 691C20D9` 在本机确实无结果）。

#### ✅ 正确的路线**早就写好了**，只是这个脚本没用

`scripts/lib/mobile-e2e.sh` 里（`resolve_idb()` 起于第 665 行，`idb_dump()` / `idb_center()` /
`idb_type_into()` 在其后），仓库里**已经有一套 idb 版的 iOS I/O**，
注释还写得非常清楚：

> `idb`（facebook/idb，MIT）通过 companion 直接和模拟器通信，
> **从设备内部驱动** —— 宿主 AX 只能看见当前 Space 的窗口，**不抢前台就用不了**。
> `idb ui describe-all` 返回完整可访问性树；`idb ui tap 351 808` + `idb ui text "..."` 真的生效。

配套还有 `scripts/tools/idb-find.py` 和 `resolve_idb()` / `idb_dump()` / `idb_center()` /
`idb_type_into()` 这些函数。**工具链是完整的，`verify-mobile-ios.sh` 只是没接上去。**

#### 本轮**实测**了这条替代路线（全部后台，未碰前台）

```
idb ui describe-all --udid 1B785D80-...   → 退出码 0，8423 字节无障碍树
idb ui tap 113 252 --udid 1B785D80-...    → 退出码 0
```

点击**真的生效**，用无障碍树对比可以证明：

| | 点「四象限」之前 | 之后 |
|---|---|---|
| 有标签节点 | 22 | **31** |
| 四象限相关标签 | 无 | **重要且紧急 / 重要不紧急 / 紧急不重要 / 不重要不紧急** |

顺带这也**在 iOS 上验证了四象限这个功能**：点一下 chip，视图真的切换、四个象限真的渲染出来了
（空态文案「这里还没有任务」也在）。

树里能直接读到的元素（**坐标是设备坐标，不是窗口坐标**，所以不受遮挡影响）：

```
[Button] '列表'     中心=44,252
[Button] '四象限'   中心=113,252
[Button] '新建任务' 中心=358,667
```

#### 下一轮该做的（**别去改脚本去抢前台**）

把 `verify-mobile-ios.sh` 的输入层从 `mac clickin` **换成 `scripts/lib/mobile-e2e.sh` 的 idb 函数**：

1. 第 0 步的前置条件改成 `resolve_idb` 成功，**删掉 `pgrep -x Simulator`** ——
   它检查的是一个**根本不需要存在**的东西。
2. 所有 `mac clickin <窗口坐标>` 换成 `idb_center` + `idb_ui tap`（**设备坐标**，不再受窗口遮挡影响）。
3. 文本输入换成 `idb_type_into`。
4. 第 74 行的陈旧 UDID 默认值改成**从 `xcrun simctl list` 里挑一个 Booted 的**，
   挑不到就明确报错 —— 而不是指向一个不存在的设备。

> 这条改动会**顺便修掉**脚本开头那一整段关于"窗口被盖住"的苦衷：
> **一旦改用设备坐标，窗口遮挡就再也不是问题了。**


### 3.14 🟡 iOS 输入侧移植到 idb：**shim 已验通，脚本还没彻底跑通**

#### 做了什么

按 §3.13 定的方向，把 `verify-mobile-ios.sh` 的 I/O 层从**宿主 AX（AXPRESS + Simulator 窗口）**
换成 **idb（设备内部）**。做法是**保住命令行契约、只换底层**：

- 新增 `scripts/tools/ios-ax-shim.py`：把 `ax <标签|-> [--pressable] [--field] [--role R]
  [--wait N] (--list|--press|--set V) --json` 这套原 AXPRESS 的契约，
  用 `idb ui describe-all` / `tap` / `set-value` 重新实现。
  **目的是让那 15 个调用点一行都不用改** —— 风险被限制在一个文件里。
- 脚本里删掉了 `pgrep -x Simulator`、`require_window`、`require_ax_visible`、
  AXPRESS 编译步骤 —— 这些**都是宿主 AX 路线才需要的**，idb 下毫无意义。

#### ✅ 已独立验通的部分（这部分有实测证据）

shim 单独跑，全部通过：

| 用例 | 结果 |
|---|---|
| `--list "四象限"` | `found=True` @79,230 67x44 |
| `--list` 不存在的控件 | `found=False`，**不崩** |
| `--list "新建任务"`（FAB） | `found=True` @330,639 **56x56**（满足 ≥44 且方形） |
| `--press "四象限"` | `result=success`，**点击后「重要且紧急」真的出现** |

#### 🔴 路上修掉的三个**误诊**（每个都会把排查方向带反）

1. **`is_pressable` 只认 `Button`** → RN 的**底部 tab** 是 `GenericElement`，
   于是 `ax "任务" --pressable --press` 直接 `found=False`，
   而报出来的是"读不到 App 内容"。
   → 修：加入 `GenericElement` 等；另**刻意不要求 `enabled=True`**，
   因为脚本第 3 步要断言「添加」的**禁用态**，过滤掉就变成 `found=False`。
2. **`companion_ok` grep `"AXLabel"`** → 这段跑在 `xcrun simctl launch` **之前**，
   树里是**主屏**、没有 `AXLabel`，于是 companion 明明好的却被判"连不上"。
   → 修：判据改为"**companion 有没有响应**"（输出是不是 JSON 数组）。
3. **陈旧 UDID 默认值** `691C20D9-…` 在本机**不存在**。
   → 修：从当前 `Booted` 的设备里挑，优先名字匹配，挑不到就**明确报错**。

另：把"树里能不能读到 App 内容"那条检查加上 `--wait 45`
（脚本自己的注释写着**冷启动要 30–40 秒**）。**"还没到"不该报成"不存在"。**

#### 🔴 仍然没解决的

脚本**还是红的**，卡在同一处：

```
Failed to connect to companion at address
  DomainSocketAddress(path='/Users/rocalight/.heyta-tools/idb/idb_companion'):
  [Errno 38] Socket operation on non-socket
```

**注意这条错误的形状**：`idb` 把一个**二进制路径**当成了 **socket** 去连。
而**同一个命令在终端里手工跑是好的**（11774 字节、rc=0）——
说明本机有能用的 companion，只是脚本这条路径连不上。

**我把它从"终止"降级为"警告"**，理由是：
**一个判据本身还没验干净的检查，不该有权终止整轮验收**（它已经误诊过一次）。
真正的判据仍是后面那条树检查。

**下一轮从这里接**：

1. 先搞清楚 `--companion-path` 的语义 —— 它到底期望**二进制**还是**socket**？
   本机已经跑着三个 `/Users/rocalight/.local/bin/idb_companion`（属于**别的**模拟器），
   它们和"给这个 UDID 起一个"之间是什么关系？
2. 试 `idb connect <udid>` 或先 `idb_companion --udid <UDID> &` **手工起好**再跑脚本。
3. **不要再在"App 状态"上找原因** —— 已经排除了：手动同样参数是绿的。

#### 本轮**没有**声称的事

- `verify-mobile-ios.sh` **没有**跑通。
- 输入侧那 4 级断言（L1–L4）**没有**在 iOS 上被验证。
- 仍然成立的是 §3.13 已验的：**iOS 能构建、能启动、能完整渲染**，
  以及 **idb 能在后台真的点击并改变界面**。

> ⚠️ **不要**为了让脚本变绿就把 companion 自检删掉 —— 那会把一个真实的工具链问题
> 变成假绿。它现在是**警告**，已经足够不挡路。

### 3.15 ✅ idb 移植基本打通：**28/30**，并揪出四个"静默失败"级误诊

上轮 §3.14 卡住的 companion 问题**已定位并修好**，脚本从 **13 通过** 推进到
**28 通过 / 2 失败**，一路跑到了第 5 步（跨设备同步）。

#### 🔴 头号根因：`export IDB_COMPANION` —— 我们自己把参数喂串了

上轮那条错误：

```
Failed to connect to companion at address
  DomainSocketAddress(path='.../idb_companion'): [Errno 38] Socket operation on non-socket
```

**跟 companion 本身毫无关系。** 对照实验：

| 环境 | 结果 |
|---|---|
| 不 export | **11774 字节** ✅ |
| `export IDB_BIN` | 11774 字节 ✅ |
| `export IDB_UDID` | 11774 字节 ✅ |
| **`export IDB_COMPANION`** | **0 字节** ❌ ← 就是它 |

源码里写得明明白白（`idb/cli/command_tree.py:190`）：

```python
--companion       default=os.environ.get("IDB_COMPANION")   # "HOSTNAME:PORT 形式的连接地址"
--companion-path  ...                                       # ← 二进制路径，是**另一个** flag
```

**`IDB_COMPANION` 是 `--companion`（socket 地址）的环境变量形式，不是 `--companion-path`。**
把**二进制路径**塞进去，idb 就会拿它当地址去连 → Errno 38。

> 这个坑的形状特别坏：报错说"连不上 companion"，排查方向会全跑到
> "companion 坏了 / 没起来 / 换路径"上 —— 而真相是**我们自己喂错了参数**。
> 它也正是"同一命令手工绿、脚本红"的**全部**原因。
>
> **结论：`IDB_BIN` / `IDB_UDID` 可以 export；`IDB_COMPANION` 不行。**

#### 另外三个"静默失败"

1. **`set-value` 用了不存在的 flag**。第一版写的是
   `set-value --marker-type accessibility --marker <标签>` —— 那两个 flag **根本不存在**
   （真实的是 `--match-key`），而我把 stderr 吞了，于是它**一次都没真正执行过**，
   却被当成"设值成功"。正确形式是**坐标做 target**：
   `idb ui set-value <x> <y> --value <文本>`。
2. **`idb ui text` 在本机抛异常**（`Exception thrown in main`），字符一个都没进去。
   所以"点中再打字"那条路走不通，**必须**用 `set-value`。
3. **回读读错了框**。填空后我重新拉树取"第一个非空字段"，而「服务器地址」本来就有内容，
   于是填「访问令牌」之后回读拿到的是**服务器地址的值**，
   脚本报"填写访问令牌失败" —— 真因是**我读错了框**。改成按 **frame 锚定同一字段**。

#### ✅ 已经真实验证到的（L1–L4 + op-log）

- **L1** 点 FAB → `AXPress「新建任务」→ success`
- **L2** Composer 出现：文本控件 (17,407) 368x42
- **L3** 清空后「添加」`enabled=false`；写入后**由 false → true**
  —— 这个 enabled 是 RN 根据输入内容算出来的，**只有应用真收到文字才会变**
- **L4** 提交后手机真 SQLite 的 `ops` 行数 **2 → 3（恰好 +1）**，
  `opType=CRT` / `actionType=CRT_TASK` / `entityType=TASK`，
  向量时钟含自身递增，且界面列出了这条标题

`set-value` 到底进没进应用，也单独验过：设完文字后「添加」`enabled=True` ✅。

#### 🔴 仍然没解决的两条

1. **⚠️ 我自己那条"树能看到 App 内容"的检查是假绿**：
   它查「任务」，而 **tab bar 在任何页面都有「任务」** ——
   所以它**证明不了页面切到了任务页**。要改成查**只存在于任务页**的东西（如 FAB「新建任务」）。
2. **底部 tab 点不动**：脚本第 1 步要切回「任务」页，但实测
   `idb ui tap 50 808`（tab 中心，frame 确认过 0,776 100x64）**页面不切换**。
   上一轮点「四象限」（一个 `Button`）是好的，所以怀疑与
   **「我的」页上键盘仍在、遮住了 tab bar** 有关 —— 但**本轮没验**。

**下一轮从这里接**：① 把假绿那条改成查 FAB；② 查「我的」页切走前要不要先收键盘
（`idb ui key` 送一个 return，或点空白处）。

> ⚠️ 本轮**没有**声称输入侧已跑通 —— 28/30 不是 30/30。

### 3.16 ✅ 输入侧移植完成（28/30 → 29/30）；🔴 并查出 iOS 同步**真的没上传**

#### 本轮修掉的两处

1. **删掉我自己那条假绿**：`ax "任务" --list` 查的是「任务」，而
   **tab bar 在任何页面都有「任务」** —— 它**证明不了页面在任务页**，会骗人。
   真判据是下面的 FAB 检查（「新建任务」只存在于任务页）。
2. **切不回任务页 → 重启 App 兜底**。实测在「我的」页上**底部 tab 根本点不动**：
   idb 报 tap 成功、树里也确实有 `GenericElement '任务' frame=(0,776,100,64)`，
   但点下去页面**不切换**（点「日历」同样无效），且**不是键盘遮挡**（树里没有键盘）。
   那一页内容延伸到 y=1156 而设备只有 874 高 —— 疑似内容层盖住 tab bar。
   ~~**这是产品的真实缺陷**。~~ 测试不因此卡死：重启 App 可可靠回到任务页
   （代价是再付一次 ~30–40 秒的 Argon2id 派生）。**宁可慢，也不要假红。**

> ## 🔴 上面那句"这是产品的真实缺陷"是**错的**（§3.18g 已证伪）
>
> 正确的结论是：**底部 tab 一直是好的**，挡住它的就是软键盘。
> 而"不是键盘遮挡"那句判断用的是 `desc='q'/'shift'` 这类**标签**去猜 ——
> 那条检查无论真假都推不出这个结论。
>
> 注意 §3.15 当时**写对了**：「怀疑与「我的」页上键盘仍在、遮住了 tab bar 有关 ——
> 但**本轮没验**」。下一轮把一个**没验过的怀疑**直接写成了结论，
> 还顺手删掉了"没验"两个字。**没验的怀疑不许升格成结论**，
> 这正是"写进文档的根因必须先经受一次证伪"要防的事。
>
> A/B 实测（同一台设备、同一个 tab，只差键盘）：
> 键盘立着 → `tap-blocked-by-keyboard` (keyboardTop=539, cy=808)，停在「我的」；
> 键盘收起 → `success`，切到任务页。

回读锚定修好之后，「访问令牌」也**填对了**（上轮它读到了服务器地址的值），
于是验收从 28 升到 **29 通过 / 1 失败**。

#### 🔴 剩下那 1 条**不是测试的问题，是真缺陷**

脚本报「笔记本 300 秒内没读到」。我去服务端直接查了：

```
服务端 operations 总数        142
含本轮标题的 operations 命中   0
```

**0 命中。** 所以那句 `⚠️ uploadStatus 仍是「pending」` **不是"显示不准"，
是数据真的没上去** —— iOS 点了「立即同步」，但那个 op **从未送达服务端**。

这**推翻**了先前把它们当成"已知显示缺陷"的记录。

> ⚠️ 顺带一个会咬人的细节：服务端列名是 **`op_type`（下划线）**，
> 而客户端文件里是 `opType`。写查询时别搞混（本轮就踩了一次）。

**下一轮从这里接**：查 iOS 的同步路径为什么静默失败 ——
按「立即同步」后它到底有没有发请求？发了什么？服务端为什么没收？
**先看服务端的访问日志**，再看客户端有没有把请求发出去。
不要从"界面显示"入手 —— 界面显示是对的，**是网络路径没通**。

### 3.17 🔴 iOS「立即同步」只拉不推 —— ~~根因已定位到服务端日志~~ **（本节结论已被证伪，见 §3.18）**

> ## 🔴 本节结论是**错的**，保留在这里是因为它错得有价值
>
> 下面这套推理**每一句证据都是真的**：日志里确实没有一行 Upload 属于 `user:37`，
> `operations` 表确实 0 命中。错的不是数据，是**从数据到"客户端从来没发起过 Upload"这一跳**。
>
> 真正的根因是**验收脚本自己**：它在软键盘还弹着的时候去点「立即同步」，
> 那一下落在了键盘上 —— 同步**一次都没跑**。点一次真正到达按钮之后，
> 2 条 op 在 **50 秒内**就被服务端接受了（§3.18）。
>
> 教训（与 §7 那些坑同形，但更贵）：**"没有观测到 X" ≠ "X 没有发生"。**
> 这里缺失的观测是"客户端到底有没有尝试上传" —— 而我把这个**没有独立证据**的空白
> 直接填成了一个看起来很顺的因果链（"pending 挡住了推送"）。
> **一个漂亮的解释会主动劝你停止调查**，这一轮就是它的标本。
>
> 所以下面第 2 点那三个"重点怀疑"**全是错的**，第 3 点的复验方式仍然成立
> （服务端日志 + `operations` 表确实是权威判据）——只是当时没人去按那次按钮。

接 §3.16 查下去。**服务端日志（`/tmp/heyta-e2e-server.log`）直接给出了答案**：

```
Download 行数: 135
Upload   行数: 14          ← 且没有一行属于 user:37

[user:37] Download: 0 ops (sinceSeq=5, latestSeq=5, hasMore=false, gap=false)
[user:37] Download: 0 ops (...)    ← 每 ~5 秒一次，连续 6+ 次
[user:37] Download: 0 ops (...)
```

**结论：iOS 客户端在"只拉不推"的循环里。**

- **认证是通的** —— 它拿到了 `user:37`，Download 也在正常应答。
  （所以前几轮怀疑的"凭据填错"**不是**原因，回读修好之后凭据确实填对了。）
- **但它从来没有发起过一次 Upload。** 那个 `pending` 的 op 永远不推送。
- 这也解释了为什么服务端 **0 命中**：不是传丢了，是**根本没传**。

> 这**不是**显示问题、**不是**凭据问题、**不是**网络问题（同一条连接上 Download 是好的）。

**下一轮从这里接 —— 去看客户端代码，不要再看界面：**

1. iOS 点「立即同步」后走的入口（`packages/app-host` / `packages/sync-core` 里的 sync 触发函数）；
2. 找回**决定"要不要 push"的那个条件** —— 它一定恒为假。重点看：
   - 是不是被 `uploadStatus=pending` / 未解决冲突挡住了（`pending` 本该是**触发**推送的原因，不是拦它的理由）；
   - 是不是 push 只在某个别的入口（如 Web 的按钮）里调，而 iOS 的按钮只调了 pull；
   - 是不是 push 的 promise 被吞了（**又一次"静默失败"**）。
3. 修完必须**用服务端日志复验**：`user:<新号>` 下要出现 **Upload 行**，
   且 `operations` 表按标题能查到。**光看界面变绿不算数** —— 这一条已经骗过我们两轮了。

---

### 3.18 ✅ 收口：iOS 全链路 **31/31**（§3.17 被证伪；修掉两个真缺陷 + 两处工具的假判据）

本节是 §3.16 / §3.17 的收口。结论先说：

| 项 | 结果 |
|---|---|
| §3.17 那个"只拉不推"的根因 | ❌ **证伪** —— 是验收脚本的**点击落在了软键盘上** |
| 真缺陷 1：legacy 密文在 Hermes 上无兜底 | ✅ 已修（纯 JS PBKDF2），已知答案向量钉住 |
| 真缺陷 2：一条解不开的 op **永久卡死整台设备** | ✅ 已修（**ADR-0016**），变异验证 + 真服务端复验 |
| 工具假判据 1：`$VAR）` 在 UTF-8 locale 下炸 | ✅ 本轮改的 `verify-mobile-ios.sh` 里 22 处改 `${VAR}`（⚠️ **只改了这一个脚本**：`scripts/` 下仍剩 47 处 `$VAR）`，分布在后来新增的 14 个脚本里） |
| 工具假判据 2：键盘遮挡判据多减一次 | ✅ 改成结构性判定（`KeyboardTop` 只在真有候选条时抬高）|
| `verify-mobile-ios.sh` | ✅ **31 项通过 / 0 失败**（`EXIT=0`）|

#### (a) 点击被软键盘吞掉，而工具报 `success`

「立即同步」按钮的 frame 是 `(16,567,370,44)`，中心 **(201,589)**。
那一刻软键盘立着，AutoFill「Passwords」条占 `y=539..583`，按键行从 `y=590` 起 ——
**589 落在键盘窗口里**。`idb ui tap` 那个系统调用确实成功了，所以工具报 `success`，
但应用**一次都没收到**这次点击。

判据修复后的直接对照（同一台设备、同一个按钮）：

```
键盘立着：{"result":"tap-blocked-by-keyboard","keyboardTop":"539","cy":"589"}
收掉键盘：{"result":"success"}   → 50 秒内服务端出现
                                [user:37] Upload: 2 ops from client muhxicqi...
                                [user:37] Upload result: 2 accepted, 0 rejected
```

**教训**：这一轮缺失的观测是"客户端到底有没有**尝试**上传"，
而这个空白被一个很顺的因果链填掉了。**"没有观测到 X" ≠ "X 没有发生"。**
详见 `AGENTS.md` §7 第 38 条。

#### (b) 真缺陷 1：legacy 密文的纯 JS 兜底

Argon2id 路径早就有 wasm/js 双后端（§7 第 26 条），**legacy PBKDF2 路径没有**：
Hermes 上没有 `crypto.subtle` 时 `decryptLegacy` 直接抛
`Cannot decrypt legacy data on this device…`。而失败形状很坏 ——
**不是那一条解不开，是整次下载中断**，用户看到的是"多端同步不工作"。

修法：`@noble/hashes` 的 `pbkdf2` + `@noble/ciphers`（**已经是本包依赖**）
补上纯 JS 那条腿。生产参数（password-as-salt、1000 轮、SHA-256、dkLen 32）
下两种实现**逐字节相同**，由固定已知答案向量钉死。
把 `dkLen` 改成 16 → 恰好 2 条用例红，改回来全绿（变异验证）。

#### (c) 真缺陷 2：一条解不开的 op 让**别的设备**永久卡死

修完 (b) 之后跨设备**仍然**失败。逐条解密服务端上 `user:37` 的 9 条 op，
边界非常干净：**seq 6、7 报 `OperationError`（AES-GCM 认证失败），1–5、8、9 都 OK**。
6/7 是同一台手机更早一次会话里用**另一个口令**传的。

原实现 `await Promise.all(ops.map(decodeServerOp))` 于是：

1. 整页作废（同页那 7 条是好的）；
2. 抛错在 `setLastServerSeq` **之前** → **游标永不推进** → 永久卡死；
3. 而且**只毒害别的设备**：下载带 `excludeClient=<自己>`，手机自己永远看不到，
   界面显示「已是最新」—— **出问题的那台机器看起来最健康。**

修法见 **ADR-0016**：逐条解密、能读的应用、读不了的跳过并**结构化上报**、
游标推进；但**整页一条都解不开时抛错且不推进游标**（那是口令打错，
一次手滑静默跳过整段历史比卡死更糟）。

真服务端复验：笔记本从**永久** `unexpected` 变成一轮内读到手机那两个任务，
并如实报出 `6:muhxicqi-…(OperationError), 7:muhxicqi-…(OperationError)`。

#### (d) 两处工具的假判据（都不该有权终止验收）

- **`$VAR` 紧跟非 ASCII 字符**：没 UTF-8 locale 时一直正常，
  一旦 `export LANG=en_US.UTF-8`（中文项目里很自然），bash 3.2 把 `）` 的高位字节
  并进变量名 → 第 0 步 `IDB_COMPANION<乱码>: unbound variable` 直接退出。
  22 处已改 `${VAR}`（§7 第 40 条）。
- **键盘遮挡判据多减一次**：第一版一律 `min(KeyboardKey) - 60`。
  但候选/自动填充条**带不带 `KeyboardKey` 是不稳定的** ——
  中文候选栏带，英文的「Passwords」条不带。于是在带的那种情形下多减 60，
  把明明够得着的「添加」（中心 `y=484`）判成"被挡住"，第 4 步整段红。
  现在改成：取 `min(KeyboardKey)`，**只在真有一条紧贴其上、接近全宽的横条时**才抬高。
  两种情形都实测过（`top=538` 放行 / `top=539` 拦截）。

#### (e) 这一轮的方法论收获

1. **先把"探针可能坏了"当作第一假设。** 两次假红（键盘、locale）都出在工具上，
   而两次的第一反应都是"产品坏了"。
2. **一个没验干净的判据不许有权终止整轮验收。** `companion_ok` 早就是警告而非退出；
   这一轮把同一个纪律用到了"点击回执"和"探针成功"上。
3. **判据要结构性，不要标签式。** `role` 会变、`AXLabel` 随语言/输入法变；
   `KeyboardKey` trait、`min(KeyboardKey)` 这类结构特征才稳。
4. **补一个被记录的缺口时，必须同时改掉把缺口固化成"预期行为"的那条断言**
   （legacy 那条用例原本断言"应该抛错"，而且断言是对的）。
   改完**必须做一次变异**证明它真的会红。

#### (f) 仍未做（留给后续，不许当成已解决）

- 读不回来的 op **没有找回路径**：换过口令之后，那些历史 op 目前只能跳过。
  真要做需要一份 ADR 讨论"口令世代 + 历史重放"，涉及持久化字段。
- ~~「我的」页上的底部 tab **点不动**（脚本靠重启 App 兜底）—— 真产品缺陷，未修。~~
  **已证伪（§3.18g）**：tab 栏一直是好的，挡住它的是软键盘；脚本已改为"先收键盘再重试"，
  不再重启 App（省掉一次 ~50 秒 Argon2id 派生）。
- 探针仍复用同一账号，服务端会**累积**上一次运行的历史 op；这一轮正是它暴露出 (c)。
  长期应改为每轮 `heyta_e2e_fresh_account`。

#### (g) ✅ 收口 2：**"「我的」页 tab 点不动"是误诊**（不是产品缺陷）

§3.16 把它记成"产品的真实缺陷"，§3.15 当时只写了"怀疑与键盘遮挡有关，但**本轮没验**"。
本轮把它验了，结论是 **§3.16 错了**：同一台设备、同一个 tab、同一份状态，**只差键盘**：

| 键盘 | shim 判据 | 结果 |
|---|---|---|
| 立着 | `tap-blocked-by-keyboard`（keyboardTop=539, cy=808） | 仍停在「我的」 |
| 收起 | `success` | 切到任务页 |

键盘占 `y=539..874`，tab 中心 `y=808` —— 那一下点在了键盘上，与 §3.18(a) **同形**。
而当时"树里没有键盘"是用 `desc='q'/'shift'` 这类**标签**猜的：
键盘按键标签随语言/输入法变，且这一步跑在**上次运行的收尾之后**，键盘那时可能已经收起。
→ 那条检查**无论真假都推不出"不是键盘遮挡"**。

已落地：`verify-mobile-ios.sh` 第 1 步改为**先收键盘再重试**（并打一条正面 `ok` 作为反证），
重启 App 只留作最后的兜底。**顺带省掉一次 ~50 秒的 Argon2id 派生**。

教训：**没验过的怀疑不许升格成结论。** §3.15 写了"本轮没验"，§3.16 把"没验"删掉
并换成了一句确定的断言 —— 一个词的删除，就把待验证的怀疑变成了"已知的产品缺陷"，
而后面每一轮都照着它绕路。

#### (h) 本轮顺带修掉的用户可见错误陈述

「我的」页脚注原文是"**日历、专注**、清单与标签管理尚未实现"，而 `CalendarScreen`（439 行）
与 `FocusScreen`（427 行）**都已经是真屏幕**。这是**应用在对用户说假话** ——
迁移阶段可以"只搬不改"，但产品事实变了就必须改。现在改成：

> 凭据只保留在内存中，应用完全退出后需要重新输入。**清单与标签管理**尚未实现。

（清单 / 标签**确实**还没有管理界面：`packages/app-host` 的 `createProjectActions()`
已经提供 `createProject` / `createTag`，但移动端没有任何入口，所以这两个词保留。）

> ⚠️ **这句话本身后来也被删掉了**：§3.19 做完清单、§3.20 做完标签之后，
> `mobile.profile.footnote` 已经不含"清单与标签管理尚未实现"——
> 现在的值是 `'凭据只保留在内存中，应用完全退出后需要重新输入。'`（`packages/i18n/src/locales/zh-CN.ts`）。
> 下面那段"产物级核对"是**当时**的证据，不要拿它当现在的状态。

**产物级核对**（不是只看词条表）：转义后同时数新旧值，
`packages/i18n/dist/index.js` 与 Metro 打的 app bundle 都是 **新值 1 / 旧值 0**。
⚠️ 直接 `grep` 中文会命中的是**注释**而不是字符串值（值是 `\uXXXX`）——
已记为 `AGENTS.md` §7 第 42 条。

#### (i) 下一步（"能日常用"的最大缺口）

**清单 / 标签管理界面**。业务逻辑已经在 `packages/app-host` 里（`createProject` / `createTag`），
缺的是移动端入口与任务归属。这是 TickTick 类产品的核心组织方式，
没有它"能日常用"就不成立。做法（下一轮从这里接，不许另起一套）：

1. 先读 `packages/app-host/src/project-actions.ts` 与 `packages/domain` 里 project/tag 的模型；
2. 在移动端加"清单"入口 + 任务归属选择，**全部经 op-log**（`CRT`/`UPD` 既有词表，不新增）；
3. 复用 `verify:mobile-edit` 那套零 mock E2E 写法，覆盖"建清单 → 任务归入 → 另一端读到"；
4. 完成后再改本页脚注（它与代码一起动，不许提前改）。

### 3.19 ✅ 清单闭环落地；🔴 并查出**手机只能推、不能拉**（ADR-0016 §6）

#### (a) 本轮做成的：清单（PROJECT）真的跨设备了

`pnpm verify:mobile-lists`（新脚本，零 mock）：手机建清单 → 任务归入 → 手机同步 →
笔记本（真 `node-host` + 真 SQLite）读到**同一条清单、同一个 `projectId`**。
关键几步都是结构性判据，不是"界面上有这几个字"：

- 本地库里真的多了一条 `PROJECT/CRT` op，并能按清单名查到 `entityId`；
- 任务的 op 里真的写了 `projectId`，且与清单 id **相等**；
- 笔记本侧的清单 id 与任务 `projectId` 与之**逐字段相等**。

业务逻辑一行没重写 —— 全部复用 `packages/app-host/src/project-actions.ts`，
线协议用既有的 `CRT`/`UPD` 词表，未 bump schema。

#### (b) 查出的真缺陷：**上传成功，下载整批作废**

第 7 步（手机同步）在修复前**永远过不去**，而且症状具有极强的误导性：

| 观测 | 真相 |
|---|---|
| 手机界面「同步失败 / `aes-gcm: invalid tag`」 | 不是口令错，也不是密码学问题 |
| 服务端**确实**有手机的 3 条 op | 上传这一半是好的 |
| 手机本地库里**远端 op 数 = 0** | 下载这一半**一次都没跑过** |
| 同一份代码在 Node 上完全正常 | 它不是密码学问题，是**控制流**问题 |

根因在 `packages/sync-client/src/client.ts` 的**上传响应搭车路径**：

```ts
// 修之前
const decoded = await Promise.all(body.newOps.map((o) => decodeServerOp(o, password)));
```

服务端会在上传响应里搭车返回新 op（piggyback）。历史里有 2 条是**换口令之前**
写的，解不开 → `Promise.all` 一条抛错 → 整次同步死在 **upload 阶段** →
`download()` 根本没执行 → 游标不推进 → 界面只显示"同步失败"，
而且被归成 `unexpected` + `retryable: true`（重试永远不会好）。

🔴 **它为什么一直没被发现**：`upload()` 开头是 `if (pending.length === 0) return;`。
**没有待上传的 op 就永远走不到那一行。** 我先是拿干净数据库的探针复现 →
路径没执行 → 得出"解密没问题"；再在 Node 里模拟 Hermes（摘掉 `WebAssembly`
与 `crypto.subtle`，完整跑生产的两条兜底分支）→ **依然是绿的**。
两次都是**假绿**，因为都缺同一个前置条件：**设备手上得有东西要传**。
（教训记为 `AGENTS.md` §7 第 46 条。）

#### (c) 修法：与 ADR-0016 完全一致（判断只留一份策略）

- 逐条解密：能读的 `applyRemote`，读不了的跳过并记入 `unreadableOps`；
- **不在这里另写一套"全失败"判断**：整批解不开时只做一件事 —— **不推进游标**，
  把区分（口令错 / 历史混着别的口令）交给紧随其后的 `download()`，它已有那套策略；
- 因此游标推进的位置也变了："上传成功就推进" → "上传成功 **且** 搭车 op
  没有整批解不开时才推进"。

#### (d) 验收

**单元层**（`packages/sync-client/tests/sync.spec.ts`，新增 2 条）：
`pnpm --filter @heyta/sync-client test` → **61/61**（当时；**现在同一命令是 62/62** ——
后续又加了用例，见 §3.23）。

**变异验证**：把搭车段改回无保护的 `Promise.all` → **恰好新增的 2 条红**
（30 通过 / 2 失败）；恢复后全绿。**这证明新用例真的能失败。**

**真机层**（Android 模拟器 + 真服务端）。修复后手机「我的」页显示的是：

> 状态：有部分历史数据用当前口令解不开（可能是在另一个口令下写入的），
> 已跳过 —— 其余数据已同步
> `6:muhxicqi-…(Error), 7:muhxicqi-…(Error)`

—— 这正是 ADR-0016 规定的**如实上报**，而不是修复前那句硬梆梆的
「同步失败 / `aes-gcm: invalid tag`」。

`bash scripts/verify-mobile-lists.sh` → **24 项通过 / 0 失败**（修复前是 22 通过 / 1 失败），
其中两步是关键，且都是**结构性**判据：

```
✅ 手机同步完成                      （耗时 290 秒 —— load 47 的情况下）
✅ 手机本地库里有 21 条远端 op —— 下载这一侧真的跑通了
✅ 两端清单 id 一致（project-muitvzkj-3-95cklrlr）—— 清单真的跨设备同步了
✅ 任务归属跨设备一致 —— 「建清单 → 归入 → 另一台设备读到」全链路无 mock
```

🔴 **修复前那个数是 0。**"手机同步完成"这句话在没有第二条判据时**毫无价值** ——
它当时也是"完成"的（界面确实动过），只是下载一条都没落地。

**判据也一并修掉**（否则会判**假红**）：

1. `scripts/verify-mobile-lists.sh` 第 7 步原来只判「界面说同步完成了」——
   而"上传成了、下载整批作废"**同样**会被判成通过。现在**必须数出本地库里
   远端 op 条数 ≥ 1**。这是本缺陷的判据，因为它只在**半瘫**状态下才为假。
2. `scripts/lib/mobile-e2e.sh` 的 `wait_synced` 原来只认「已是最新」，
   于是**已经修好、行为完全正确**的设备（降级成功态）会被判红。
   现在两种终态都认，且刻意**不**匹配宽泛的「同步」二字 ——
   那会把「同步失败」也放进来，让一条不能失败的判据把半瘫判成通过。

   ⚠️ 这里还连着踩了第二个坑：第一版判据写成了 `has_text "其余数据已同步"`，
   而 `has_text` 是**整节点精确匹配**，状态行却是一整句
   （`有部分历史数据…，已跳过 —— 其余数据已同步`）→ 判据**永远为假** →
   `wait_synced` 空转满 180 轮 × 5 秒，日志一个字都不长，
   看起来像"同步卡死"，其实是**探针坏了**。改用同文件里现成的 `has_sub`
   后立刻通过。已验证：拿一份真实 dump 直接跑两个判据，
   `has_sub` 为真、`has_text` 为假。（`AGENTS.md` §7 第 47 条）
   **同一个坑 `has_sub` 上面早就写着注释** —— 规则在同文件里，还是踩了。

#### (e) 顺带修掉的一处"应用在对用户说假话"

「我的」页对慢速设备写的是「首次同步需等待约 **30–40 秒**」。
那是**空账号**的数字。实测同一台模拟器上一个 **20 余条 op、来自 8 个客户端**
的账号，手机上首次同步 **290 秒**（宿主 load 47）。

🔴 先把代价算**准**，再决定文案能不能给一个具体秒数（本轮我先写错过一次）：

- **加密**侧 `encrypt()` 走 `getOrDeriveEncryptKey()` —— 一个会话共用**一个** salt，
  所以一台设备上传 100 条 op 也只派生一次；
- **解密**侧 `decryptArgonFromBuffer()` 按**每条 op 载荷里的 salt** 查缓存
  （缓存键 `passwordHash:saltBase64`）—— 代价 ≈ **历史上不同"
  加密会话/口令世代"的个数**，**不是** op 条数。

所以"每多一条 op 就多一秒"是错的；"每个新出现的 salt 多一次派生"是对的。
客户端在**下载之前无从知道**服务端有多少个不同 salt，因此文案只能给区间
+ 说明增长原因，不能承诺秒数。

已改成给区间 + 说明它随历史数据量增长（中/英同步改），
并**在产物里核对**：`index.android.bundle`（Hermes 字节码，非 ASCII 存 UTF-16LE）
新文案 1 次 / 旧文案 0 次 —— 不是只看词条表。

#### (f) 仍然没解决的（诚实记账）

- 🔴 **首次同步在手机上很慢**：Hermes 没有 WASM，Argon2id 只能走纯 JS，
  页面里**每个不同的 salt** 都要派生一次。手机上新装 + 全量历史 =
  **十几分钟量级**（本轮实测 > 10 分钟，且当时宿主 load 40+）。
  ~~界面已经写了"首次同步需等待约 30–40 秒"，在**累积了历史**的账号上
  这句话是**低估**的。要么改文案，要么给 KDF 结果做**持久化缓存**
  （涉及持久化字段 → 需要 ADR）。~~
  → **文案这一半当时就改掉了**（见本节 (e)：已改成"数十秒到数分钟"区间 +
  说明它随历史数据量增长；现在的词条是 `mobile.profile.sync.slowKdf`）。
  **仍然没做的是另一半**：给 KDF 结果做持久化缓存（涉及持久化字段 → 需要 ADR）。
- 🔴 **标签（TAG）仍然没有入口**：`createTag`/`removeTag` 在 `packages/app-host`
  里已有，`TaskActions` 没有 `tagIds`，移动端也没有界面。页脚注保留"标签管理尚未实现"。
  → **下一节（§3.20）就把这条补完了**：`TaskActions.setTags` 已存在
  （`packages/app-host/src/actions.ts`），移动端也有标签段。**这一条现在不成立。**
- **解不开的 op 没有找回路径**（ADR-0016 §4 已记）。

### 3.20 ✅ 标签闭环落地：从"数据模型里有"到"产品里有"

#### (a) 这一轮补的不是功能，是**一个存在了很久的空洞**

标签在**数据模型里已经存在很久**：

- `packages/domain/src/entities.ts` 的 `Task.tagIds?: string[]` 早就有；
- `shared-schema` 里 `TAG` 一直是合法的 `entityType`；
- `packages/app-host/src/project-actions.ts` 的 `createTag` / `removeTag` /
  `listTags` 全都实现了（文件头还专门解释了"为什么标签和清单放在同一个动作集"）。

🔴 **但全仓库没有一处读写过 `tagIds`。**（`grep` 的结论：`apps/web` 的
projects store 只**列出**标签，同样没有把标签打到任务上的路径。）

也就是说：**每个零件都"通过"了，而产品里没有这个功能。** 这类空洞没有任何
一条测试会报红 —— 单元测试测的是"零件是否按规格工作"，而"这个零件有没有被
接上"它管不着。这正是"能日常用"和"能跑"的区别。

#### (b) 写入侧：`TaskActions.setTags`（唯一的业务语义落点）

按 AGENTS.md §3.4（op-log 是唯一写入口、一个用户意图 = 一条 op）新增：

```ts
setTags(entityId: string, tagIds: string[]): Promise<void>
```

三个刻意的决定：

1. **整组覆盖，不做 `addTag` / `removeTag`。**
   `tagIds` 对 reducer 而言是**普通字段**，合并语义是字段级 LWW
   （`op-log/src/state.ts` 只覆盖 payload 里出现的字段，数组整体替换）。
   要支持增删就得给 reducer 加"数组求并集/差集"这种**新的合并语义**——
   那是线协议级别的改动。而"界面点亮一个标签 → 写一条 op"用整组覆盖就能满足。

2. **⚠️ 代价如实写进注释，不粉饰**：两台设备**同时**给同一任务加**不同**标签时，
   字段级 LWW 会丢掉一边。这与 `projectId` / `note` 的冲突行为同类，
   **不是本轮引入的**；真正做集合合并需要另一份 ADR。**不假装它能合并。**

3. **每个标签 id 必须真的存在且没被删，否则抛错。**
   写进悬空 id 的后果是"任务挂着一个任何视图都查不到的标签"——
   界面上表现为"标签数对不上"，而 op-log 里只有一条看起来完全正常的 `UPD`。
   这类"数据里有引用、视图里找不到目标"最难查，所以在**写入侧**拦住。

   另外：空数组写 `null`（与 `setDueDate` / `setNote` 同一条约定 ——
   `[]` 和"没有这个字段"是同一件事的两种表示，只留一种）。

#### (c) 界面：清单和标签**共用同一个段落组件**

「清单」和「标签」在**数据模型**上毫无关系，在**界面**上是同一件事
（一个名字列表 + 删除按钮 + 新建输入框）。照抄一份 `TagsSection` 会得到两份
结构完全一样的 JSX —— 而"同一段逻辑写两遍、改一处忘一处"本仓库已经吃过三次亏
（AGENTS.md §3.5）。

所以抽了 `apps/mobile/src/screens/OrganizerSection.tsx`：**只抽结构，不抽语义**。
- 抽走的：卡片 / 空态 / 行 / 删除按钮 / 输入框 / 按钮 / 触控目标下限；
- 留在调用方的：叫什么名字、空态说什么、`onAdd` / `onRemove` 调哪个动作。

⚠️ 文案**全部由调用方传入**，不在组件里按 `type` 拼 —— 写成
`type==='tag' ? t('...') : t('...')` 会把两套产品语义塞进一个组件。

🔴 抽取过程中**我犯了一次"重复造轮子"**：给删除按钮手写了一个
`IconButtonForRemove`，而 `ui/kit.tsx` 里早有 `IconButton`（可点 +
自带无障碍名 + 按下反馈）。当场删掉改用现成的。**"抽公共组件"这个动作本身
最容易让人以为自己在消除重复，其实是在制造新的重复。**

任务详情页新增「标签」段：多选 Chip，点一下即写（与截止日/重复/优先级
"即点即写"一致，而不是"要点保存"）。清单是单选、标签是多选 ——
所以是开关式 Chip，不是互斥组。

#### (d) 验收

**单元层**（`packages/app-host/tests/project-actions.spec.ts`，新增 6 条）：
`pnpm --filter @heyta/app-host test` → **399/399**（原 393；⚠️ **现在的同一命令是 435/435** ——
标签之后的几轮又加了用例）。

**变异验证**（证明新用例真的能失败）：
- 拿掉"标签必须存在"的校验 → **恰好 2 条红**（两条悬空 id 用例）；
- 清空时写 `[]` 而不是 `null` → **恰好 1 条红**（清空用例）；
- 恢复 → 全绿。

🔴 **测试当场抓到一个真缺陷**：`setTags` 第一版不是 `async`，
校验失败时**同步抛出**，而接口签名承诺的是 `Promise<void>` ——
`void actions.setTags(...)` 和 `.catch(...)` **都接不住**。
这正是本仓库反复出现的"接口说的是 Promise、实际同步抛"。已改成 `async`。

**真机层**：`pnpm verify:mobile-tags`（新脚本，真模拟器 + 真服务端，零 mock）——
建标签 → 打到任务上 → 另一台设备（node-host 真 SQLite）读到。
判据刻意做成**四层**，因为只核其中一层会漏掉一半的坏法：

| 层 | 判据 | 漏掉它会看不见什么 |
|---|---|---|
| 手机本地库 | 有一条 `TAG`/`CRT` op，且**按名字**能查到 id | 界面上的标签没走 op-log |
| 手机本地库 | 任务的 op 里 `tagIds` **包含那个 id** | 点选没有真的写进去 |
| 笔记本（真 SQLite） | `tags` 命令列出的 id **与手机相等** | 标签实体没同步过去（任务指着一串悬空 id） |
| 笔记本（真 SQLite） | 该任务的 `tagIds` 里**也有那个 id** | 引用没同步过去（标签建好了但没人用） |

另外保留了清单脚本那条关键判据：**手机侧必须数出远端 op ≥ 1** ——
"界面说同步完成了"在"上传成了、下载整批作废"时**同样为真**。

**为验收补的工具面**（否则"没法断言"的字段正是最可能在半路丢掉的）：
- `node-host` 新增 `tags` 命令（与 `projects` 对称）；
- `list` 输出新增 `tagIds`（与 `projectId` 对称）；
- 🔴 **`--help` 补上了 `projects` 和 `tags`** —— 它一度只列到 `pending`，
  而 `projects` 早就实现了。**少写一行帮助文本的代价，是让别人选错判据**
  （验收作者会以为"没有列清单的命令"，转而拿界面上的名字去猜跨设备同步）。

**顺带清掉一处重复**：`phone_sync`（按「立即同步」再等结果）原本只写在
`verify-mobile-lists.sh` 里，标签验收要的是同一件事。已移进共用库
`scripts/lib/mobile-e2e.sh` —— 它纯粹是"驱动这台设备"，与 `wait_synced` /
`dump` / `require_screen` 同类，不是清单的业务语义。各写一份的话，
"按钮改了位置"这种改动会只修一处。

#### (e) 仍然没解决的（诚实记账）

- 🔴 **标签不能改名**（与清单一致，本轮刻意不接：改名要一个内联编辑态）；
- 🔴 **同时加不同标签会丢一边**（见 (b) 第 2 条，需要给 reducer 加集合语义的 ADR）；
- **首次同步慢**、**解不开的 op 没有找回路径**（见 §3.19f）。

### 3.21 ✅ Web 端也接上了「清单 + 标签」：同一个空洞的**第二半**

#### (a) 上一轮只补了一半

§3.20 修的是**移动端**拿不到标签。这一轮去看 Web，发现同一个空洞的**另一半**：

| 能力 | 移动端（§3.20 前） | Web（§3.21 前） |
|---|---|---|
| 建清单 / 建标签 | ✅ | ✅（侧栏 `ProjectsPanel`）|
| 把任务归入清单 | ❌ | ❌ |
| 把标签打到任务上 | ❌ | ❌ |

Web 端 `TaskStore.moveToProject` **一直存在**、`ProjectActions` 也**一直在** ——
但 `grep` 出来的事实是：`moveToProject` 在 `apps/web` 里**没有任何调用点**，
`tagIds` 全仓库零读写。

于是 Web 上的表现是：**侧栏里建出来的清单和标签，一个都用不上。**
这比"没有这个功能"更难发现 —— 面板上东西都在，看起来只是"我还没用上"。

#### (b) 实现：`TaskOrganizer`（Web）

新增 `apps/web/src/features/tasks/TaskOrganizer.tsx`，挂在任务行的标题后面。

1. **归属结果常驻可见（chip），编辑控件收进 `<details>`。**
   只放进展开面板的话，用户扫一眼列表**看不出**哪些任务已经归了类 ——
   而"看清现状"正是整理的前提。反过来，把 `<select>` 和一堆复选框直接铺在
   每一行上，列表就没法看了。
2. **用原生 `<select>` / `<input type="checkbox">`，不自造下拉。**
   原生控件自带键盘操作、读屏语义、移动端适配。自造一个"看起来更漂亮"的下拉，
   等于把这些全部重做一遍，而且必然做得更差。
   副作用：验收能直接 `selectOption` / `click` —— **真交互**，不是模拟坐标。
3. **一次交互 = 一条 op。** 标签**整组**交给 `setTags`（契约见 `packages/app-host/src/actions.ts`），
   不在这里"攒一批再提交" —— 同屏其它字段全是即点即写，多一种节奏只会让人不确定"到底存没存"。

`TaskStore` 只多了一个 `setTags(id, tagIds)` 转发到 `taskActions.setTags`
（与既有的 `moveToProject` 同形状）。**业务语义一行都没有落在壳里。**

🔴 **`check:design` 当场拦下一处**：浮层我写了 `zIndex: 1`（裸数字）。
设计系统的 z 刻度里本来就有 `--ht-z-popover`。已改用它 ——
裸 z-index 的问题是它**只在当前这个组件里看着对**，旁边任何一处层级更高的东西
都会盖住它，而那种 bug 只在特定滚动位置才出现。

#### (c) 验收：真浏览器 + 零 mock（`e2e/tests/task-organize.spec.ts`）

用的是仓库里**已有的 Playwright 套件**（真 Chromium、真 vite、真 IndexedDB/op-log；
只有"模型回应"是假的）。它刻意是**离线**的（`playwright.config.ts` 只要假端点 + vite），
所以本轮**没有**往里塞"依赖本机 3000 端口那个服务端"的用例 —— 那会毁掉这套件的确定性。

核心判据是 **「刷新之后还在」**：它同时否掉两种最像"做完了"的假绿 ——
① 只改了 React 状态（没派发 op）；② 写进某个内存 Map。
两者在第一次渲染时**看着都对**，只有刷新能揭穿。

顺序是刻意的：**先断言 chip 出现 → 再刷新 → 再断言 chip 还在。**

全量套件 **13/13**（原有 11 条 AI 旅程全部保持绿 —— 这条是"没碰坏别人"的证据）。
（⚠️ 这是**当时**的数字；`e2e/tests/` 现在共 **24 条** `test()`、9 个 spec 文件。）

#### (d) 🔴 两个假红，以及一个"看着能失败、其实不能"的断言

**(1) `check()` 断言错了对象。** 第一版用 `await checkbox.check()`，Playwright 报
`Clicking the checkbox did not change its state`，**两条用例全红**。

但这是**假红**：`check()` 除了点击，还**立刻**断言控件自身已勾选。而这里的复选框是
**受控**的，`dispatchIntent` 又是 `async`（`await engine.dispatch(intent)` 之后才 `notify()`）——
点击那一帧 React 手里还是旧的 `tagIds`，重渲染把勾按回去。

op **已经派出去了**。换成 `click()` + 断言**结果**（chip 出现）后两条都绿。
**产品的契约是结果，不是控件在某一帧长什么样。** 已记为 AGENTS.md 陷阱 49。

**(2) 变异测试暴露出第二条用例当时没有鉴别力。** 我把指派改成
"只写本地 React 状态、不派发 op"（最像做完的一种假绿），结果是：

| | 变异前 |
|---|---|
| 用例 1（打上 → 刷新仍在） | ✘ 红，报「刷新后标签丢了」 |
| 用例 2（打上 → 摘掉 → 刷新后没有） | ✅ **绿** |

原因很直白：**"从来没存过"同样满足"刷新后没有"**。
它的「刷新后依然是取消态」当时**什么都证明不了**。

已改成 **打上 → 刷新（还在）→ 摘掉 → 刷新（没了）**：先把"曾经真的在过"钉住，
"没了"才有意义。同一个变异现在让**两条都红**。

> 这是本仓库第 N 次遇到同一形状：**一条断言是否"能失败"，只能靠变异测试回答，
> 不能靠读它。** 已记为 AGENTS.md 陷阱 50。

#### (e) 诚实记账

- 🔴 **Web ↔ 服务端的跨端同步，这套离线套件验不到。** 也就是说
  "Web 上打的标签会同步到手机"这一步**目前没有零 mock 证据**：
  移动端脚本证的是"手机 ↔ 服务端 ↔ node-host"，Web 只证到"本地 op-log 落库"。
  要补得单写一个脚本（自己起服务端 + 配 Web 的同步设置），
  而**不能**塞进这套离线套件。
  → **下一节（§3.22）就补上了**：新增 `pnpm verify:multi-end`（三端、两相、两个方向）。**这一条现在不成立。**
- 🔴 **两端都不能改清单/标签的名字。**
- **同时给同一任务加不同标签会丢一边**（§3.20b 第 2 条，需要给 reducer 加集合语义的 ADR）。

### 3.22 ✅ 三端同步验收（Web ↔ 服务端 ↔ 笔记本）：把"没有证据"那句话补掉

#### (a) 上一轮说的洞，这一轮堵上

§3.21e 记的是：「**Web ↔ 服务端的跨端同步，这套离线套件验不到** ——
"Web 上打的标签会同步到手机"目前没有零 mock 证据」。

这不是记一笔就完了 —— 本仓库已经有一份 ADR 专门记"上传成功 + 下载整批作废"
（ADR-0016）：那是一种**界面看着完全健康**的半瘫状态。**只测一端等于没测。**

洞的成因是仓库里有两个验收面，而**恰好中间的接缝没人管**：

| 验收面 | 覆盖 | 什么时候跑 |
|---|---|---|
| `scripts/verify-mobile-*.sh` | 手机 ↔ 服务端 ↔ 笔记本 | 手动（要模拟器 + 服务端） |
| `e2e/tests/`（Playwright） | 只有**本地** op-log，**刻意离线** | `pnpm check`（CI 门禁） |

Web 的同步**两边都不在**：手机脚本里没有浏览器，浏览器套件里没有服务端。

#### (b) 新增 `pnpm verify:multi-end`：三端、两相、两个方向

- **第 1 相（真浏览器）**：建清单 + 标签 + 任务，挂好，上传。
- **第 2 相（shell + node-host）**：另一台设备（真 SQLite、**另一个 clientId**）同步
  → 必须读到上面那些；然后**反向**再建一条任务并上传。
- **第 3 相（真浏览器，全新 context）**：同步 → 必须把**两台设备**的数据全拉回来。

🔴 第 3 相那个 **全新 context = 空 IndexedDB** 是关键：它不是"同一个页面再看一眼"，
而是**一台刚装好的新设备**。所以它拉回来的每一样都必须来自服务端。

判据的顺序也是判据的一部分：**打开应用（还没有凭据）→ 断言这三样都不在
→ 配置同步 → 断言这三样都在。** 前半句不能省 —— 少了它，"出现了"有可能只是
"本来就在"（所以在 `configureSync` **之前**断言空：那个按钮会当场触发同步，配完再断言就晚了）。

刻意**不注册进 `pnpm check`**：那个聚合门禁必须能在没有服务端的机器上跑。
所以 `e2e/playwright.multi-end.config.ts` 用 `testDir: './multi-end'` 与离线套件
**物理隔开**，离线那份永远不会扫到它。

实测：**18/18**。

#### (c) 🔴 三个真发现

**(1) 自建 Web 前端的跨域同步，默认是被拒的。**

`server/src/config.ts`：

```ts
const DEFAULT_CORS_ORIGINS: CorsOrigin[] = ['https://app.super-productivity.com'];
```

这是随上游 `super-sync-server` **继承**来的域名（不是我们的，`README` / `compose` /
`helm` / `env.example` / 两个测试文件里都写着它）。于是本地自建栈上 Web 端同步的表现是：

> 状态条变成「**离线** · 改动已排队，联网后自动重试」，而服务端日志里**一条请求都没有**。

看起来像网络问题，**其实预检就没通过，请求根本没发出去**。这个症状极具误导性 ——
本轮的两次失败尝试都先往"服务端没起来"和"令牌不对"上查过。

处理方式是**两个**动作，都不是改那个默认值（它被 6 处文档/测试固化，是同源部署下的
无关项，动它得连带改一圈，而那不属于本轮）：

- `scripts/mobile-e2e-up.sh` 起验收栈时显式带上
  `CORS_ORIGINS=http://127.0.0.1:4328`（设了它就会**替换**那条默认值，
  顺手也把那个上游域名从本地栈上摘掉）；
- `verify-multi-end-sync.sh` 第 0 步**单独验一次预检**，不通过就 `exit 3`
  （= 环境失败，不是产品失败），并把"症状会诱导你往错的方向查"写进输出。

生产上的等价答案其实是**同源部署**：服务端自己用 `@fastify/static` 托管 Web 产物
（`server.ts` 里本来就有），那样根本不经过 CORS。

**(2) 🔴 服务端**读不了**内容 —— 所以"按标题查 op"在原理上就是错的。**

第一版的服务端判据是：

```sql
SELECT count(*) FROM operations WHERE payload->>'title' = '...';
```

它报「服务端没收到」，而**同一轮的第 5 步却从服务端把笔记本建的那条任务拉了回来**。

矛盾的双方里，**探针是首要嫌疑**。去查表结构：

```
 payload                | jsonb  | not null
 is_payload_encrypted   | boolean| not null | false
```

payload 是**密文**（E2EE：服务端在原理上就读不了内容）。所以尊重 E2EE 的服务端判据
**只有两类**：

1. 某类 op 的**条数增量**（收到没收到）；
2. **distinct `client_id` 数**（是不是真的有两台设备在写）。

"收到的是不是我想的那一条"**只能**由另一台设备解密后读出来回答 —— 那正是第 3 步。
已按这个重写。

**(3) 两台设备共用 `clientId` 会让第二台**什么都拉不到**。**

这是在变异测试里**顺带撞出来的**（见 (d)）：把笔记本的 `HEYTA_CLIENT_ID` 强行设成
Web 那个之后，笔记本不但认不出新 client，连第 3 步的"读到标签/清单/任务"**全部失败**。
`clientId` 不只是 LWW 的决胜依据，它还是设备身份（游标与"自己的 op"过滤都依赖它）。

#### (d) 🔴 判据收紧：从 `2 > 0` 到 `1 → 2`

第一版的"这是另一台设备"判据是拿"第 1 相之前"（0）当基线的，于是实际语义是
**"只要最后有两台设备写过就通过"**。如果笔记本复用了 Web 的 clientId，
distinct 会停在 1 —— 而 `1 > 0` **照样绿**，它想验的那件事当场就不成立。

改成"以 **Web 刚上传完那一刻**为基线，必须 `≥ 基线 + 1`"之后，变异测试（强制沿用
Web 的 clientId）给出了**正好那一条**红：

```
❌ client 数没有多出新的（1 → 1）—— 无法证明那条是**另一台设备**写的
```

⚠️ 第一版的"变异"其实是**假结果**：我把变异脚本拷到 `/tmp` 跑，而它的
`$(dirname "$0")/lib/...` 于是解析到 `/tmp/lib/...` —— **第 53 行就死了**，
`rc=1` 红得毫无意义。挪回 `scripts/` 旁边才真正跑到断言处。
**"变异红了"也要看它红在哪儿。** 已记为 AGENTS.md 陷阱 51。

#### (e) 诚实记账

- 🔴 **这套验收不在 `pnpm check` 里**（它需要活着的服务端）。也就是说
  **Web ↔ 服务端的同步，只在有人主动跑 `pnpm verify:multi-end` 时才被验证。**
  这是有意的取舍（门禁必须能在没有服务端的机器上跑），但代价要说清楚：
  它不像离线套件那样每轮都被执行。
- 那个上游 `CORS_ORIGINS` 默认值**没改**（原因见 (c)(1)）；对自建自托管的
  正确做法是设 `CORS_ORIGINS` 或同源部署，这一点**尚未写进自助部署文档**。
- 三端里没有手机：手机那一侧由 `verify-mobile-*.sh` 各自覆盖。

### 3.23 ✅ 上传被拒不再废掉一台设备（ADR-0019）

#### (a) 断点原话与它的复检

上一轮留的断点是「**iOS「立即同步」只拉不推**」，并附了两条证据：服务端日志里
`user:37` 只有 Download、没有 Upload；`operations` 表按标题查 0 命中。

**这两条证据都得作废，而结论也确实不成立：**

1. 「按标题查 0 命中」在 E2EE 下**恒为真** —— `payload` 是密文
   （见 §3.22 与 AGENTS.md 陷阱 52）。这个探针**永远不会有输出**，
   拿它当证据等于什么都没查。
2. iOS 的 push **本来就是通的，而且早就验过**：`scripts/verify-mobile-ios.sh`
   的 L5 就是「按下「同步」后，**另一台设备**（node-host 笔记本）读到了它」。
   也就是说"iOS → 服务端 → 另一台设备"这条链路一直在验收范围里。

> 教训：**断点里的"根因"必须先复检一遍再用。** 一条自己都不会失败的证据
> （按密文查标题）配上一条早已被证实的链路，能让整轮工作朝错方向走。

#### (b) 把"只拉不推"翻过来看，真正的缺陷是它的反面

顺着那条日志往下查，发现的不是"不推"，而是**一台设备会永久失去下载能力**：

```
sync() → upload() → ❌ throw
                ↘ download()   ← 永远走不到
```

`upload()` 在服务端拒绝**任何**一条 op 时直接 throw，而抛出点在下载**之前**。
于是"上传里有一条过不去的 op"这个**局部问题**，升级成
"**这台设备再也拉不到任何远端数据**"这个**全局故障** —— 它是**单向**聋的。

零 mock 复现（真服务端 + 真 SQLite，往队列里注入一条 `clientId` 属于别机的 op）：

| 第几次同步 | 结果 | 待上传 |
|---|---|---|
| 1 | `accepts 1, rejects 1` → **抛错** | 1 |
| 2 | `rejects 1/1` → **又抛错** | 1（永远） |

这正是 `verify-mobile-ios.sh` 里那段注释记的残留缺陷（那条 `other-device-x-…` +
4 条 `DUPLICATE_OPERATION`），当时写着"**本轮没有修**，需要独立的复现用例与 ADR"。

#### (c) 修法（详见 ADR-0019）

1. **上传的失败永不阻断下载** —— 一个阶段的失败只该影响它自己；
2. 永久拒绝（显式白名单：校验类 / `INVALID_CLIENT_ID` / `INVALID_OP_ID` /
   `DUPLICATE_OPERATION` / 加密配置不匹配）→ `markRejected` **移出队列**，
   暂时被挡（限流 / 配额）→ **留在队列里**下次重传；
   **拿不准的一律算"暂时"**（判成永久会丢掉一条本来能上去的改动）；
3. 新增第三种上传状态 `rejected` —— **不并进** `uploaded`
   （并进去等于说"这条在云上"，而服务端刚拒绝了它，待上传数会归零而数据哪都没去）；
4. 新原因 `upload-rejected`，`retryable` 按有无永久拒绝决定，报错**点名是哪几条**。

判据优先级也定了一条规则：**一次性信息排在持久状态之前**。
被永久拒绝的 op 已移出队列，**下次同步不会再提**；而"有历史数据解不开"是持久状态，
下次照样会报。先报后者的话，用户**再也没有机会知道**有改动没上去。

#### (d) 验证

| 层 | 手段 | 结果 |
|---|---|---|
| 存储契约 | `packages/storage/tests/contract/op-log-store.contract.ts` | `markRejected` 移出队列 / 不标成 uploaded / op 仍在日志；IndexedDB、SQLite、内存**同一套**；storage **203/203** |
| 客户端单元 | `packages/sync-client/tests/sync.spec.ts` | 永久拒绝 → 移出队列 + `retryable:false` + **下载仍执行**；暂时被挡 → 留在队列；未知码按暂时；sync-client **62/62** |
| 零 mock 端到端 | `pnpm verify:sync-recovery` | 被拒的**同一次**同步里仍拉到另一台设备刚写的任务；`pending=0`、`rejected=1`、数据仍在；下次 `synced`；**15/15** |

**变异测试**（判据有没有鉴别力，只能靠变异回答）：

1. 把 `upload()` 改回"硬拒绝直接抛错" → 脚本在
   **`❌ 没拉到对端那条 —— 这台设备变聋了`** 上变红（4 项红，rc=1）；
2. 把 `RATE_LIMITED` 塞进永久名单 → 单元测试在
   **「暂时被挡时 op 留在队列里」** 上变红（1 项红）。

同时按纪律**改了那条冻结缺口的断言**：`verify-mobile-ios.sh` 原先写着
「在它修好之前，本脚本不对 uploadStatus 断言成功」，现在恢复成真断言
（好 op 必须变成 `uploaded`）。

#### (e) 诚实记账

- 🔴 **`verify-mobile-ios.sh` 的这条恢复后的断言本轮没有重跑**（要重新构建 iOS 包），
  所以它是"应该成立但尚未在模拟器上见证"。**下一次 iOS 轮次的第一件事就是跑它。**
- 被拒的改动**不会自动重试**（它重试也不会成功），但界面目前只有一句词条 +
  诊断细节，**没有"我该怎么处理它"的引导**（例如"这条 op 属于别的设备，可从本机移除"）。
- 永久/暂时的划分靠**白名单**：服务端将来新增一个真正永久的错误码时，它会被当成"暂时"
  而被无限重试。这**不会再卡死设备**（下载已独立），但待上传数会长期不归零。
  兜底方案（同一 op 连续被拒 N 次后自动隔离）**未实现**，需要额外的持久化计数。

### 3.24 ✅ 鸿蒙：工具链与 RNOH 原生侧**实测出 HAP**（ADR-0004 的关键输入）

#### (a) 被推翻的旧说法

计划文档里悬了很多轮的一句是：

> 🔴 **仍未验证**：没有跑过 `hvigorw assembleHap`，**没有编译过一行 C++，
> 没有生成过 HAP**，没有在设备或模拟器上跑起来。

前半句现在是**错的**。后半句（跑起来）仍然成立 —— 但原因和原来说的不一样。

#### (b) 实测结论（本机，2026-09-27）

| 项 | 结果 |
|---|---|
| DevEco Studio | `/Applications/DevEco-Studio.app`，**6.1.1.300** |
| SDK | `sdk-pkg.json`：**HarmonyOS 6.1.1 / API 24**（写死版本号会漂 —— 脚本现在**读**它） |
| NDK | `native/` 带 **llvm + sysroot + build-tools/cmake**（`cmake`、`ninja` 都在里面，**不在 PATH 上**） |
| ohpm / hvigorw | 随 IDE 发行（`tools/ohpm`、`tools/hvigor`），**不在 PATH 上** |
| 最小 ArkTS 工程 | `hvigorw assembleHap` ✅ → **126 KB HAP**，含 `ets/modules.abc`（12 KB 真字节码） |
| **RNOH 工程** | `hvigorw assembleHap` ✅ → **37 MB HAP**，`BuildNativeWithNinja` 跑了 **1 分 2 秒** |
| 包里的原生库 | `librnoh_core.so` 5.1 MB、`librnoh_app.so` 3.1 MB、`libreactnative.so` 13.4 MB、`libhermesvm.so`、`libjsi.so`、`libc++_shared.so`（arm64-v8a + x86_64 双 ABI） |
| ArkTS 侧 | `ets/modules.abc` **942 KB**（空工程只有 12 KB —— RNOH 的 ets 确实编进去了） |

**所以 ADR-0004 最担心的那一环（"原生侧要本地编译 `.so`，这是最可能出问题的地方"）通了。**

#### (c) 判据落成脚本（两条，各自能失败）

```bash
pnpm verify:harmony-toolchain   # 工具链 → 最小 HAP          （17/17）
pnpm verify:harmony-rnoh        # RNOH 原生侧 → 37MB HAP     （17/17）
```

两条都**验证产物**而不是退出码：HAP 必须存在、是真 zip、且**真的含**
`ets/modules.abc`；RNOH 那条还必须含 `librnoh_core.so` / `librnoh_app.so` /
`libreactnative.so`，并且构建日志里**真的跑过** `BuildNativeWithNinja`
（防止"只是把现成的拷进去"）。

**变异测试**：把 `add_subdirectory("${RNOH_CPP_DIR}" ./rn)` 与
`target_link_libraries(rnoh_app PUBLIC rnoh)` 从 CMakeLists 摘掉
→ 构建**直接失败**（rc=255，`ninja: build stopped`），**没有 HAP 产出**。
判据有鉴别力。

#### (d) 顺带查实的三件事（都是"文档错了"而不是"我们做错了"）

1. **`cmake` / `ninja` / `ohpm` / `hvigorw` 都不在 PATH 上** —— 它们随 IDE 发行，
   在 `Contents/tools/` 与 `Contents/sdk/.../native/build-tools/` 下。
   `command -v cmake` 说"没有"，不代表编不了（**陷阱 58 的同族**：
   "探针没找到" ≠ "东西不存在"）。
2. **官方 CLI 里有现成工程模板**：
   `@react-native-oh/react-native-harmony-cli`（**MIT**，0.84.4）的
   `src/init/templates/harmony/` 就是完整脚手架（32 个文件，含
   `PackageProvider.cpp`、`EntryAbility.ets`、`CMakeLists.txt`）。
   **不该手写鸿蒙脚手架** —— 手写的会和真实工程漂移。
3. 模板有**两处必须按实际环境改写**，否则第一步就挂：
   - `compatibleSdkVersion` 还是旧的（模板里写着 `5.0.0(12)`）；
   - **`AppScope/app.json5` 的 `bundleName` 是 `com.example`（两段）**，
     过不了 hvigor 的 schema 校验（要求三段以上）。真货由 CLI 填，模板是半成品。

#### (e) 仍然没做的（诚实边界，别把上面读成"RN 在鸿蒙上能跑"）

1. **没跑起来**。缺三样，且都不是写代码能补的：
   - **模拟器系统镜像**：本机**没有任何已创建的实例**（`~/.Huawei` 不存在），
     `tools/emulator/` 只有可执行文件；下镜像要在 Device Manager 里走 GUI。
   - **签名**：产物是 `entry-default-unsigned.hap`（`signingConfigs: []`）
     → **装不进任何设备**。签名要 Huawei 开发者账号在 IDE 里配。
   - **JS bundle**：还没有。
2. **JS 侧的 codegen / autolinking 没接**。RNOH 的
   `@rnoh/hvigor-plugin` 按 JS 侧 `package.json` 生成原生模块注册代码；
   本轮的探针用**桩**顶替了它（`autolink_libraries` no-op +
   空的 `PackageProvider`）。这不是绕过难点，是把"原生侧能不能编"与
   "codegen 对不对"**拆开各自验证**；后者还没验。
   → 已在 **§3.25 补完**：`scripts/verify-harmony-rnoh-js.sh` 拆掉了这里的桩，
   真 codegen + 真 autolinking + Metro/Hermes bundle + release HAP 全部实测通过。

### 3.25 ✅ 鸿蒙 JS 侧全链路：codegen + autolinking + Hermes bundle + release HAP（零桩）

#### (a) 这一轮补的是**上一轮自己留下的桩**

§3.24 结尾写着：「JS 侧 codegen/autolinking 本轮用**桩**顶替……下一个任务：
`scripts/verify-harmony-rnoh-js.sh`」。本轮把那两处桩**全部拆掉**：

| 上一轮的桩 | 这一轮的真货 |
|---|---|
| `autolinking.cmake` 里 `autolink_libraries` 是 no-op | 官方 `@rnoh/hvigor-plugin` 生成，带 `# generated by RNOH autolinking` 头 |
| `PackageProvider.cpp` 空实现（缺两个 codegen 头） | 真 codegen 产出 `generated/RNOHGeneratedPackage.h`，真 autolinking 产出 `RNOHPackagesFactory.{h,ets}` |
| `pages/Index.ets` 是自写的 `Text` 占位 | 由官方 `EntryIndexTemplate` **渲染**（RNOH 的 `RNApp` 根视图 + `createRNPackages`） |

**这个桩是有代价的 —— 拆掉之后立刻暴露了四个真问题**（下面 (c)）。
如果把上一轮的"原生侧能编"当成结论收工，这四个问题会在写业务 UI 时才炸，
而且每一个的报错信息都指向错误的方向。

#### (b) 全链路实测（本机，2026-09-27）

| 环节 | 结果 |
|---|---|
| JS 侧 | `react-native@0.84.1`、`@react-native-oh/react-native-harmony@0.84.3`、CLI `0.84.4`、`react@19.3.0`、`@react-native-community/cli@20.2.0`；`npm install` 681 包 |
| codegen | `react-native codegen-harmony` → **5 个文件**（`RNOHGeneratedPackage.h` + ets 侧 `components/ts.ts`、`index.ets`、`ts.ts`、`turboModules/ts.ts`） |
| autolinking | `RNOHPackagesFactory.h`、`RNOHPackagesFactory.ets`、`autolinking.cmake`（均带 `generated by RNOH autolinking` 头） |
| ArkTS 编译 | `CompileArkTS` ✅（`RNApp` 根视图 + `RNOHCoreContext` 全编过） |
| 原生编译 | `BuildNativeWithNinja` **49 s**（release）/ **62 s**（debug） |
| JS bundle（JS） | `bundle.harmony.js` **1,147,554 B** |
| JS bundle（Hermes） | `hermes_bundle.hbc` **1,586,917 B**，魔数 **`0x1F1903C103BC1FC6`** ✅ |
| release HAP | **20 MB**，含 `resources/rawfile/hermes_bundle.hbc` + `bundle.harmony.js` + `rnoh.profdata` + 三个关键 `.so` |
| debug HAP | 37 MB（不含 bundle，走 Metro） |

**"自包含"这件事现在是可查的**：release HAP 里真的躺着 Hermes 字节码，
装到设备上不需要 Metro —— 这正是之前那个桩挡住的结论。

#### (c) 拆掉桩之后暴露的四个真问题（报错信息全都指错方向）

1. 🔴 **RN 0.84 的 CLI 需要 Node ≥ 20.12，而 DevEco 自带 Node 18.20.1。**
   报错是 `TypeError: styleText is not a function`（`util.styleText` 是 Node 20.12+
   才有的）—— **从这条信息完全看不出跟 Node 有关**。
   更绕的是：第一次失败时先弹出来的是
   「`react-native` depends on `@react-native-community/cli`」（RN 0.84 不再捆绑它），
   装完那个包**才**露出真正的 `styleText`。修法：把 hvigor 的 `NODE_HOME`
   指到 Node ≥ 20.12。
2. 🔴 **`bundle-harmony` 找不到 `hermesc`**：它默认去
   `react-native/sdks/hermesc/osx-bin/hermesc` 找，而真身在
   `node_modules/hermes-compiler/hermesc/osx-bin/hermesc` → 必须 `--hermesc-dir`。
3. 🔴 **官方模板是半成品**：`entry/src/main/ets/pages/Index.ets` **不在模板里**
   （真货由 CLI 的 `EntryIndexTemplate` 生成，模板的 `pages/` 是空的）
   → 不补就报 `Page '.../pages/Index.ets' does not exist`。
4. 🔴 **模板的 `AppScope/app.json5` 是 `"bundleName": "com.example"`（两段）**，
   过不了 hvigor 的 schema（要求三段以上，`com.example` 缺第三段）；
   模板的 `compatibleSdkVersion` 也还停在 `5.0.0(12)`。

**教训**：用官方模板 ≠ 官方模板能直接跑。模板里被 CLI 在 init 阶段填掉的那些字段，
在模板文件里就是**半成品**，而且它们的失败信息都不指向真正原因。

#### (d) 判据与变异

```bash
pnpm verify:harmony-rnoh-js
```

13 项断言，每一条都能失败，其中三条是这一轮的核心：

- **Node 版本**：< 20.12 直接红，并给出 `HEYTA_NODE_BIN=` 的解法
  （这条如果写成"警告"，整个脚本就会以 `styleText` 崩掉，而没人知道为什么）。
- **autolinking 产物是真货**：文件头必须含 `generated by RNOH autolinking`
  —— 桩不可能有这句，所以这条判据正好卡住上一轮那种"用桩糊过去"。
- **Hermes 魔数**：必须是 `0x1F1903C103BC1FC6`。
  **验魔数，不验扩展名** —— 把 JS 改名成 `.hbc` 能骗过所有只看文件名的检查。

**变异测试（两处，都精确命中）**：

| 变异 | 结果 |
|---|---|
| **A**：把三个 autolinking 真产物换回上一轮那种**桩**（`// stub`） | 三条「缺真 autolinking 产物或被桩顶替」**全红** |
| **B**：把 `hermes_bundle.hbc` 的**内容**换成普通 JS 文本（**文件名不改**） | 魔数断言红：`不是 Hermes 字节码（魔数 0x55425F5F20726176）`—— 那串魔数正是 `"var __B"` 的 ASCII |

变异 A 卡住的正是上一轮那个桩，所以上一轮"原生侧通了"的结论**不能再被误读成"全链路通了"**：
一旦有人把桩放回来，这条判据立刻红。

#### (e) 仍然没做的：**跑起来**

缺的三样一样没变，且都不是写代码能补的：模拟器系统镜像（本机 `~/.Huawei`
不存在，下镜像要走 GUI）、签名（产物是 `*-unsigned.hap`）、以及真机/模拟器。
**所以到这一轮为止，"RN 应用在鸿蒙上能跑"依然没有被验证。**
能说的只是：**从 JS 源码到自包含 release HAP 的整条构建链，是真的通的。**

---

### 3.26 ✅ iOS 验收的**工具链自愈**：把"AX 桥不通"这句误诊拆开（并补跑第 8 轮那条断言）

这一轮的目标本来是**补一笔旧账**：第 8 轮改了 `verify-mobile-ios.sh` 里
`uploadStatus → uploaded` 那条断言（ADR-0019 的收尾判据），**改完一直没重跑过**。
账本上记着"需要一次 iOS 重建"，所以它一直悬着。

#### (a) 一跑就红，而且红在一个**误导性**的位置

    ❌ 在目标窗口里找不到「新建任务」按钮 —— AX 桥不通，或 App 不在任务页

而 `idb screenshot` 里 **App 好好地停在任务页、FAB 就在那儿**。
也就是说：这句提示把 **工具坏了** 和 **产品坏了** 混成了一句话。

#### (b) 逐条排除：**四个候选全不是原因**

| 候选 | 证据 |
|---|---|
| companion 没起来 | `describe-all` 返回合法 JSON，连得上 |
| companion 馊了 | 换新 companion 一样；而**主屏能读出 11 个 label** |
| App 崩了 | 无崩溃报告，`launchctl` 里在，界面对点击有响应 |
| 无障碍被整树隐藏 | 源码里没有 `accessibilityElementsHidden` 那类写法 |

期间还**先错怪了 companion**：我一度把 stale companion 当成根因，还做了个"对照组"
——去 describe 系统"设置"App，结果同样是空树，于是得出"桥全局坏了"的结论。
**那个对照是无效的**：`simctl launch com.apple.Preferences` 根本没把它带到前台，
describe 到的其实还是 heyta。换用 `com.apple.springboard` 才拿到真实对照（11 个 label）。

> 教训：**对照必须证明"对照组真的切过去了"**，否则它不是对照，只是第二次采样同一个东西。

#### (c) 真因：模拟器跑久了，**App 的无障碍注册会卡死**

App 在渲染、在响应，但对 AX 只暴露一个**零尺寸的 `Application` 节点**
（`AXFrame: "{{0, 0}, {0, 0}}"`、label 数 0）。**重启模拟器立刻恢复**：
同一台设备、同一个 App、同一个 companion，label 数 **0 → 42**（后续几次 45/48/51/54/57）。

#### (d) 修的是**判据**，不是现象

1. **`ensure_idb_companion`**（`scripts/lib/mobile-e2e.sh`）：idb **不会**自己拉 companion，
   它只连 `/tmp/idb/<UDID>_companion.sock`。脚本现在用官方参数（`--grpc-domain-sock … --only simulator`）自己拉。
2. **§1.0「无障碍树就绪」**：App 起来之后先查 label 数；为 0 就**重启模拟器 + 重拉 companion +
   重启 App**，恢复不了才报错，且文案明确写"**先怀疑工具链，别先怀疑产品**"。
3. **判据必须是"轮询"，不是"看一眼"**：冷启动后 AX 树要几十秒才交出来。实测**同一次重启**
   第 15 秒采样到 0（报"仍是空的"——**假红**），再等约 45 秒就是 48。
   我第一版就是采样一次，于是**自己造了一个假红** —— 被下面的变异测试抓住。
4. **脚本目录无关**：`CLI` / `APK` 原本是仓库根相对路径，从 `scripts/` 跑会让 node
   `Cannot find module` 崩掉，探针只回报 `Node.js v22.22.3`，看起来像"探针坏了"。
   现在用 `HEYTA_REPO_ROOT` 拼绝对路径（详见 §7 第 64 条）。

#### (e) 让这条自愈路径**可复现**（否则它永远没被验证过）

"模拟器无障碍卡死"平时只有碰巧才走得到 —— 也就是**永远没被验证过**。
所以脚本里留了**变异缝**：

```bash
cd scripts && HEYTA_IOS_FORCE_AX_EMPTY=1 bash verify-mobile-ios.sh
```

它让 `idb_ax_label_count` 在头 N 秒（默认 30，`HEYTA_IOS_FORCE_AX_EMPTY_SECS` 可调）返回 0。

🔴 **两个踩过的坑**（都在写这个缝的时候）：

- 用 `eval "$(declare -f …)"` 把原函数包一层 —— **把函数体里的引号/续行打散**，
  包出来的函数**永远返回 0**。症状和"变异把工具弄坏了"一模一样（§7 陷阱 58 的形状）。
  改成在 lib 里把查询体单独命名为 `_idb_ax_count_raw`，缝直接包它。
- 用**变量**当"只变异一次"的开关 —— `n=$(idb_ax_label_count)` 是**命令替换**，
  赋值落在子 shell 里，于是"只第一次为 0"变成"**永远是 0**"。改用**时间戳**，
  不依赖任何跨进程状态。
- 一开始把变异写成"**只变异一次**" —— 结果被 `ax_ready 20` 的**轮询**直接吸收
  （第 2 次就是真值），**根本没走到自愈分支**：日志里那一行是
  `✅ 无障碍树就绪（label 数 48）`，自愈那几行**一行都没出现**。
  如果只看"跑绿了"就收工，就会得出"自愈已验证"的假结论。
  改成"**头 N 秒恒为 0**"（比 20 秒闸门更久）才真的把自愈逼出来。
  （这就是为什么变异必须**确认它真的生效**，见 §7 陷阱 58。）

#### (f) 结果

| 路径 | 结果 |
|---|---|
| 健康（`pnpm verify:mobile-ios`） | **32/32 绿**（新增 §1.0 那条后从 31 变 32） |
| 变异（`HEYTA_IOS_FORCE_AX_EMPTY=1`，且**从 `scripts/` 跑**） | 自愈**真的触发**并恢复（`✅ 模拟器重启后无障碍树恢复（label 数 57）`）→ 仍然 **32/32 绿** |

**欠了两个月的账还上了**：`uploadStatus pending → uploaded` 这条断言在真机链路上
**真的执行并通过**（`✅ uploadStatus pending → uploaded（本地队列已确认上传）`），
而且是在 `iOS → 服务端 → 笔记本（node-host 真 SQLite）` 全链路无 mock 的同一次运行里。

一次运行同时验证了三件事：**变异缝生效 → 自愈恢复 → 目录无关后笔记本探针第 9 轮读到**。

---

### 3.27 ✅ 自动同步：把"本地优先"最核心的那句承诺兑现

#### (a) 一个不报错、界面也看不出异常的功能缺口

全应用**只有一个**地方会调 `syncNow()`：`ProfileScreen` 里那个「立即同步」按钮。
也就是说：

> **用户建完一条任务，它不会自己出去。**

要让它到另一台设备，用户得自己想到"去我的页点一下同步"。而这件事：

- **不报错** —— 本地写入一切正常，任务就在列表里；
- **界面看不出异常** —— 没有转圈、没有告警；
- **单元测试证明不了** —— `sync/store.ts` 的逻辑本身是对的，缺的是**没人调它**。
  "没人调"是**接线**问题，不是逻辑问题，而接线正是单测照不到的那一层。

这不是"少个功能"。本地优先应用对用户的核心承诺就是"**我记下来了，它就同步了**"，
而不是"我记下来了，我还得去某个页面点一下"。

#### (b) 三个触发点，和**为什么故意只要两个**

| 触发 | 取/舍 | 理由 |
|---|---|---|
| **回到前台** | 取 | 手机上最自然的同步时机；用户切回来就是要看最新的。**拉取主要靠它。** |
| **本地写入之后**（2 秒防抖） | 取 | 这才是"我记下来了，它就同步了"。 |
| 刚填完凭据立刻同步 | **舍** | 见下 —— 它会让一条**已有断言变成永远为真**。 |

🔴 **第三个触发点被砍掉，是一个判据保护决定。**
`verify-mobile-conflict.sh` 的"首次同步"是这么写的：点「立即同步」→ `wait_synced`。
如果应用在"凭据刚一填齐"就自动同步一次，那么等测试去点按钮时，
`wait_synced` **立刻**就能看到一个已结算的状态 —— 那条断言会**恒真**，
哪怕按钮彻底坏了。为了不制造一条**不能再失败**的检查，这个触发点不做，
"刚配置完"这一下仍然交给用户点那个按钮（它就摆在表单旁边）。

#### (c) 决策逻辑与平台接线的切分

沿用仓库既有的做法（`lib/use-today.ts` 的 `msUntilNextMidnight`）：
**会把"什么时候排、排几次、清不清脏位"的逻辑拆成纯状态机，单测覆盖；
平台那一半只负责接时钟和真正的 `syncNow`。**

| 文件 | 职责 |
|---|---|
| `sync/auto-sync-core.ts` | **纯**调度状态机（注入时钟/定时器/`sync()`/`ready()`）。16 条单测。 |
| `sync/auto-sync.ts` | 平台接线：真定时器、`AppState`、把 `SyncStatus` 翻成"算不算结算"。 |
| `sync/write-signal.ts` | 15 行的**依赖倒置**层（见下）。 |
| `db/open-host.ts` | 在**唯一写入口** `dispatch` 上喊一声"写了"。 |
| `App.tsx` | 启动时 `startAutoSync()`（幂等，返回停止函数）。 |

🔴 **为什么需要一个 `write-signal.ts`。** 直接让 `open-host` 引 `auto-sync` 会形成
`open-host → auto-sync → store → open-host` 的循环依赖。ESM 活绑定下**能跑**
（只要不在模块求值期调用），但它是脆的：换打包器、换求值顺序，
或者哪天有人在模块顶层调用一次，就变成"拿到 `undefined` 然后**静默什么都不做**"
—— 而症状又是"同步不触发"，和自动同步根本没接线**长得一模一样**。
拆成零依赖的一层：数据库层只管喊，不知道同步存在；同步只管订阅，不知道数据库存在。

🔴 **为什么挂在 `dispatch` 上，而不是在各个界面里逐处调。**
"以后有人加一个新动作、忘了通知同步"这件事一定会发生，而它的表现是
"这个功能创建的数据从来不同步"，且**没有任何一处会报错**。
挂在写入口上，新增动作自动被覆盖，不需要任何人记得 —— 这和 op-log
"唯一写入口"是同一条纪律的延伸。

#### (d) 真正难写的不是时机，是**并发**

容易写错的三处，都写进了单测：

1. 🔴 **同步进行中又来了本地写入。** 那次写入**必须**在本次结束后再推一次。
   写成"结束时统一把脏位清掉"，那次写入就**永久丢了**（要等下次前台才出去），
   而且和"同步成功"长得一模一样。
   所以用**代际计数**而不是一个布尔：记下"这一趟推的是第几代写入"，
   结束时只有**代数没变**才清脏位。
2. **失败后不能退化成热循环。** 离线时自动重排就是每 15 秒打一次服务端，
   而那并不能让网络恢复。**不自动重排**，等下一次前台/写入再试。
3. **不在前台不跑**，且**没配好不跑**（判据是地址 + 令牌都齐，
   与「我的」页那个 `configured` 同一口径 —— 用户在表单里是**一个字段一个字段**填的，
   只填了地址的那一刻配置对象就已经不是 `undefined` 了，拿它当"已配置"
   会让每次回到前台都报一次 `not-signed-in`）。

#### (e) 变异测试：这些断言真的会失败吗

| 变异 | 结果 |
|---|---|
| 结束时写 `syncedGen = writeGen`（经典丢数据写法） | **2 红** —— 正是两条"同步期间又写入"的用例 |
| `dispatch` 之后不再 `emitLocalWrite()`（整条写入触发路径断掉） | 见 (f) |

第一条把"代际计数"这件事钉住了；第二条走真机：
重新出 APK → 跑同一条验收 → **判据 (a) 在第 120 秒超时变红**。

#### (f) 验收：`pnpm verify:mobile-autosync`（零 mock）

🔴 脚本里**不存在**任何对「立即同步」按钮的点击 —— 加了那一下，
整个验收就退化成"按钮还能用"，而那一件事早就有人测了。判据故意用**两条独立机制**：

| 判据 | 机制 | 速度 | 能证伪什么 |
|---|---|---|---|
| **(a)** | **服务端日志**出现同步请求行 | ~30 秒 | 自动同步**有没有触发** |
| **(b)** | 另一台设备（node-host 真 SQLite）**读到那条任务** | 秒–分钟级 | 数据**有没有走完全程** |

只有 (b)：失败要等 900 秒，而"没触发"和"派生太慢"在日志里长得一样。
只有 (a)：证明不了数据真的到岸。**两条都要。**

⚠️ 判据 (a) **只数真正的同步请求行**（`[user:N] Upload/Download`），
不数 `wc -l`：日志里混着大量 `prisma:query ...`，按行数读到查询日志
就会以为"同步触发了"。

**实测结果（健康版，11/11）**：

```
第 6 轮（约 30 秒）看到 3 条同步请求行
2026-09-27T03:12:39Z [INFO] [user:55] Upload: 1 ops from client muj8qkt1...
2026-09-27T03:12:39Z [INFO] [user:55] Upload result: 1 accepted, 0 rejected
✅ 服务端在**没有点任何同步按钮**的情况下收到了请求（自动同步确实触发了）
✅ 另一台设备（node-host 真 SQLite）在第 1 轮读到了「autosync-e2e-111012」
✅ 待上传队列已排空（不是「拉下来了但没推上去」）
```

#### (g) 顺带查出的环境陷阱

Android release 构建失败，报的是

```
Class org.gradle.jvm.toolchain.JvmVendorSpec does not have member field
'org.gradle.jvm.toolchain.JvmVendorSpec IBM_SEMERU'
```

**看起来**像 Gradle 插件版本不兼容，**真因是 JDK**：`java_home -V` 只登记了
temurin-24，`java_home -v 17` 返回空 → 兜底到 24 → Gradle 9 起不来。
唯一可用的 17 在 Homebrew 里（`/opt/homebrew/opt/openjdk@17/...`）。
换上去后 `rc=0`。已记入 AGENTS.md §7 第 65 条。

⚠️ 附带一条：**失败时旧 APK 仍在原地**，`ls` 一样看得到文件 ——
判定"真的重编了"要看 **mtime**，不要看 rc。

#### (h) 自动同步**当场**暴露出的旧判据缺陷：三处"点了，其实什么都没点"

🔴 这一条不是设计出来的，是自动同步上线后**跑回归时才浮出来的** ——
而它恰好是本项目最忌讳的那一类缺陷。

**症状**：`verify-mobile-conflict.sh` 改动前跑 0 次异常，改动后**3 次**：

```
java.lang.IllegalArgumentException: Argument expected after "tap"
```

而**最终结论仍然是 `通过 35 项，失败 0 项`**。

**机制**：那个脚本里有 4 处手写的

```bash
dump; XY=$(xy_text "立即同步"); $ADB shell input tap $XY; sleep 8
```

自动同步上线后，建完任务 / 改完本地状态时，**同步已经在跑了** ——
`Button` 在 `loading` 时渲染的是

```tsx
{loading ? <ActivityIndicator/> : <><Icon/><RNText>{label}</RNText></>}
```

**只有菊花，没有文字节点**。于是 `text="立即同步"` 查不到（busy 文案只挂在
`accessibilityLabel` → `content-desc` 上，`text` 里**根本没有**），
`XY` 为空，`input tap` 拿空参数去执行 → adb 抛异常，
而**脚本一行都不报**：`XY` 为空这件事从没被检查过。

> **"点了一下同步"和"什么都没点"在报告里长得一模一样。**

而那条冲突断言照样绿 —— 因为冲突是**自动同步**造成的，不是那一下点出来的。
**结论没错，但它已经不再是被测的那件事产生的了。**

**同类变体**（一起全修了，不只是修被撞到的那一处）：

| 脚本 | 旧写法 | 失败形态 |
|---|---|---|
| `verify-mobile-conflict.sh` × 4 | `input tap $XY` | **静默空操作**，还照样绿 |
| `verify-mobile-focus.sh` | `[ -n "$XY" ] && { tap; }` | **静默空操作** |
| `verify-mobile-task-edit.sh` / `verify-mobile-focus.sh` | `[ -z "$XY" ] → bad` | **假红**（同步正在正常跑，却报"找不到按钮"） |

**修法**：共享库里加 `ensure_phone_sync()`，三态且**没有一种是静默的** ——
有「立即同步」就真点（先确认坐标非空）；是「正在同步…」就不重复点（`syncNow()`
在 `busy` 时本来就不排队）并**打印一行说明**；两者都没有才 `bad`。

**🔴 而我第一版修错了，错法本身又是一条教训。** 第一版用 `has_text "正在同步"` 判断 ——
于是又误报 3 条 `bad`（"既没有「立即同步」也没有「正在同步…」"），
而那一刻同步**正在正常进行**。
真因是上一条：busy 文案**只存在于 `content-desc`**。
（更难看的是：本库 `has_desc` 上面那条注释**早就写明了这条规矩** ——
"按钮这类节点的可辨识名在 `content-desc` 上，用 `has_text` 查它们**永远是 0**"。
我写那个函数时没看它。）所以补了 `has_desc_sub()`，`ensure_phone_sync` 改查 desc。

**教训收拢成一句**：**"查不到"不是"不存在"** —— 它先要排除"我查错了地方"。
这和 §3.26 里"AX 桥不通"的误诊、§7 第 64 条"探针坏了"的误诊是**同一个形状**，
只是这次发生在 adb/UI dump 这一层。

**修完之后的直接证据**（同一条冲突验收，35/35 全绿）：

```
（自动同步已经在跑：按钮处于 loading，只渲染菊花 —— 所以这里查的是 content-desc）
（自动同步已经在跑：按钮处于 loading，只渲染菊花 —— 所以这里查的是 content-desc）
已点「立即同步」@ 540 1542
（自动同步已经在跑：按钮处于 loading，只渲染菊花 —— 所以这里查的是 content-desc）
通过 35 项，失败 0 项
✅ 移动端冲突解决闭环：真机全链路通过
```

四处里**三处**在脚本去看时自动同步已经开跑 —— 这既证实了机制，
也说明一件事必须说清楚：**这个脚本的「点同步 → 出冲突」现在实际上是
「自动同步 → 出冲突」**。它现在**自己在日志里说出来了**，而不是默默换了个触发源。
脚本真正的目的（**冲突解决闭环**：两侧并排、两个方向都走 op-log、双端收敛）不受影响，
这次的 35 项里那部分断言一条没少。

#### (i) 自动同步让一条**旧判据**变成了假红：delta 基线取晚了

`verify:mobile-focus.sh` 第 10 步原来这样断言"专注记录到服务端了"：

```bash
SRV_BEFORE=$(psql … "SELECT count(*) FROM operations WHERE entity_type='FOCUS_SESSION';")
… 点同步、等结算 …
SRV_AFTER=$(psql … 同一条查询)
[ "$SRV_AFTER" -gt "$SRV_BEFORE" ]   # 增量 = 本次运行送上去了
```

**增量**这个写法在"op 只有点按钮才出去"的年代是对的。自动同步上线后前提没了：
第 8 步「放弃这一轮」一派发 op，自动同步两三秒内就把它传上去；
等第 10 步再去取基线，取到的是**已经含本次那条 op**的数。

**A/B 实测**（同一条脚本、同一个 APK，只切自动同步）：

| 自动同步 | 判据输出 | 结果 |
|---|---|---|
| **关**（基线版） | `✅ 服务端收到了专注记录（3 → 4）` | **26/26** |
| **开** | `❌ 服务端没收到专注记录（3 → 3）` | 25/26 |

而**同一次运行的下一行**是：

```
✅ 笔记本（真 SQLite）同步后有了 1 条 FOCUS_SESSION op —— 数据真的跨了设备
```

—— 服务端要是没收到，笔记本**不可能**拉到。所以这是**假红**：
产品比脚本假设的更快，而脚本把"快"读成了"没发生"。

**修法**：基线前移到**第 0 步之后、任何本地写入之前**，断言改成
"相对本次运行之前的基线有增长"。这样它对"谁在什么时候上传"完全不敏感，
但"这次运行确实新增了一条"这件事仍然是真的。

> 这条和 (h) 是同一课的另一面：
> (h) 是**元素查不到**被当成"不存在"，这里是**基线取晚了**被当成"没发生"。
> 两个都不是产品坏了，两个都被读成了产品坏了。

#### (j) 顺手证伪：`verify:mobile-edit` 的失败**不是**自动同步引起的

回归时 `pnpm verify:mobile-edit` 报了一串失败（第 3/6/7/8 步），
看起来很像"自动同步把编辑面板搞坏了"。**实测否掉了这个假设**：
把自动同步关掉重建 APK，**失败点一模一样**（第 3 步 `面板标题框里是 ''`、
第 6 步 `详情面板里找不到标题输入框`、第 7/8 步连锁）。

真因是 **i18n 迁移留下的陈旧定位符**：

| | 值 |
|---|---|
| 脚本里找的 | `xy_edit "任务标题"` / `editval "任务标题"` |
| 界面上真实的 | `mobile.detail.field.title` = **「标题」** |

`ccf3e50 feat(i18n): 自研零依赖词条表` 改了文案，脚本没跟着改 ——
于是 `editval` 恒读到空串、`xy_edit` 恒找不到节点。
（而 `AGENTS.md` §9 一直写着这条验收是绿的。**进度表里的 ✅ 也需要被验证。**）

已修：三处 `任务标题` → `标题`。

> 做这件事的价值不在于"多绿一条"，而在于：
> **我原本会把自己的改动当成病因**。如果不去建那个基线，
> 我很可能去改一段本来正确的同步代码 —— 这正是本轮反复出现的那个形状。

**结局**：改完之后 `pnpm verify:mobile-edit` 从 **6 红**走到 **28/28 全绿**
（`✅ 移动端任务编辑闭环：真机全链路通过`）。

中间还修掉**第二条同类陈旧断言**：第 3 步的

```bash
[ "$(has_text "优先级")" = "1" ] && ok … || bad "面板缺「优先级」区块"
```

「优先级」区块在面板里位于「截止日期」**下方**，而 UI dump **只看得到屏幕内的节点**——
不滚动就断言"缺区块"，等于把"我没滚到"当成"它没渲染"。
**证据是它自己跟自己对不上**：同一次运行的第 5 步成功点到了「高」、
行上出现了「高优先级」——**区块明明在，只是不在第一屏**。
改成 `scroll_to_text`（最多滚 5 次）再断言。

> 这是本轮第三次撞上同一个形状：
> **"查不到"不是"不存在"** —— 先是 `content-desc` vs `text`（(h)），
> 然后是"没滚到"（这里），再往前是"AX 桥不通"（§3.26）。
> 三次的现场报告长得一模一样：**一条断言失败，而东西其实好好地在**。

#### (k) iOS 侧也补上"零点击"验收 —— 并顺手证伪了一条 bash/locale 陷阱

Android 那条零点击验收（`verify-mobile-autosync.sh`）证明的是 Android。
**iOS 上"不点按钮会不会自己出去"同样从来没被问过** ——
`verify-mobile-ios.sh` 的跨设备断言一直是"点「立即同步」→ 笔记本读到"，
于是和 Android 犯的是**同一个错**：**验收点的是按钮，结论下的却是整条链路。**

**新增第 6 步**（`verify-mobile-ios.sh`），复用第 2/3/4 步**完全相同**的
FAB → 输入 → 添加 路径（不复制一套新交互），然后：

1. 判据 (a)：服务端日志按**行偏移**取基线，之后只数 `[user:N] Upload` 行。
   🔴 **绝不数 `wc -l`** —— 日志里全是 `prisma:query` 噪音，
   任何一次数据库活动都会像"同步发生了"。
2. 判据 (b)：`wait_laptop_has "$TITLE2"`，把"上传了"补成"全链路走完"。

⚠️ 一个必须写下来的设计约束：**第 4 步那条任务不能用来验自动同步** ——
凭据是到第 5 步才填的，而写入信号在第 4 步就发出去了（那时 `ready()` 还不成立）。
而**也不能**为此加一个"凭据刚配好就同步"的触发点：那会让
`verify-mobile-conflict.sh` 的首次同步断言（点按钮 → 等结算）变成**恒真**。
所以第 6 步是**在凭据配好之后再写一条**。

**结果**：`pnpm verify:mobile-ios` **36/36**（原 32 + 新 4），
关键三行：

```
✅ 第二条任务已提交：ios-autosync-144843
✅ 服务端在第 1 轮（约 5 秒）收到 Upload —— **全程没点过任何同步按钮**
✅ 笔记本（node-host 真 SQLite）在第 1 轮读到了「ios-autosync-144843」—— 没点按钮也走完了全链路
```

**变异验证（这条新断言能不能红）**：把 `startAutoSync()` 关掉重建 iOS → **恰好 2 红**：

```
❌ 120 秒内服务端一条 Upload 都没有 —— 写入没有自动同步出去
❌ 笔记本 150 秒内没读到第二条「ios-autosync-150523」
通过 34 项，失败 2 项
```

🔴 **而且这是一个很干净的对照**：同一次变异运行里，
第 5 步（**点按钮**那条）**仍然是绿的** ——
说明变异是外科式的（只关自动同步，手点仍然有效），
也再次说明第 5 步**根本抓不到**"自动同步没了"这件事。
**这正是加第 6 步的全部理由。**

**附带发现（不是计划内的）**：第一次变异跑挂在
`line 763: TITLE2\xef: unbound variable`，现场看起来像"新加的步骤有 bug"。
真因与同步毫无关系 —— 我在同一个 shell 里为了 iOS 构建 `export LANG=en_US.UTF-8`，
而 **bash 3.2.57 在 UTF-8 locale 下会把全角 `（` 的首字节并进变量名**：

| 环境 | `$TITLE2（…` | `${TITLE2}（…` |
|---|---|---|
| 无 `LANG` | ✅ | ✅ |
| `LANG=en_US.UTF-8` | ❌ `unbound variable` | ✅ |

本仓库 `scripts/` 里这种写法有 **178 处**，平时全部正常 ——
**这是一个潜伏的坑**：任何一次"顺手 export LANG"都会让一条与业务无关的 `echo`
把整轮验收打红。已记入 **AGENTS §7 第 69 条**，并把那一行改成花括号。
