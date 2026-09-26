# P2：多端补齐

- **状态**：进行中
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

**完成情况**：生成 Swift / ArkTS / JSON 三份产物（126 个 token + 59 个暗色 + 5 个
reduced-motion），237 个测试覆盖（含对生成结果重算 WCAG 对比度）。

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
# 1) 装 pods —— 两个 env 修正都必需，去掉任何一个都会失败
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

**加固后的实测结果**：步骤 1 从三个 ❌ 变成全 ✅
（`✅ 已填 服务器地址` / `✅ 已填 访问令牌` / `✅ 三个凭据字段同时都在`）。

> **教训**：探针报"没填进去"时，先问**输入有没有真的送到**，再问应用。
> 而"输入命令退出码 0"完全不能证明字符落地了。

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

**依赖链已实测打通，但"构建出 HAP 并运行"仍未验证。**

实测已确认（2026-09-25，本机）：

| 项 | 结果 |
|---|---|
| JS 侧（npm） | `@react-native-oh/react-native-harmony`，**MIT**，2026-09-24 发布 |
| 鸿蒙侧（ohpm） | `@rnoh/react-native-openharmony@0.84.3`，**MIT**，52 个版本 |
| `ohpm install` | ✅ **成功，28.9 秒**（309 MB / 11975 文件：2509 `.h`、2216 `.cpp`、40 `.ets`） |
| npm tarball | ✅ 103 MB / 1391 文件，含 3 个真实 `.har` |

🔴 **仍未验证**：没有跑过 `hvigorw assembleHap`，**没有编译过一行 C++，
没有生成过 HAP，没有在设备或模拟器上跑起来**。已确认的是"零件齐全且取得到"，
未确认的是"这些零件能拼成能跑的东西"。原生侧需本地编译（`.so` 只有 4 个，
非各 ABI 齐全），这是最可能出问题的地方。

> **两处已更正的错误说法**：
> 1. 初稿写"本机没有鸿蒙工具链，也没有 ArkTS 编译器"，**这是错的** ——
>    DevEco Studio 6.1.1.300 装在本机，SDK API 24（陷阱 #21）。
>    ArkTS 产物现已用真编译器验证（`pnpm check:arkts`）。
> 2. 官方《环境搭建》文档写"仅支持 RN **0.72.5**"，**该文档已过时**：
>    实测两侧都已在 `0.84.x`。**照文档选版本会选到三年前的分支**（陷阱 #22）。

因此**投入 UI 开发之前，第一个任务仍然是"让一个最小 RN 壳在鸿蒙上真跑起来"**。
若这一步失败，"跨平台"的结论需要重估（可能退化为"RN 覆盖 iOS/Android +
鸿蒙单独用 ArkUI"），那会改变 ADR-0004 的结论。

在验证完成之前，§2.1 / §2.2 / §2.3 的成果不受影响，已全部完成。

### 3.2 其他

- Android 备案（明确指示：暂不处理）
- 桌面端（macOS/Windows/Linux）由 Web 还是 Tauri 覆盖

---

## 4. 从 P1 带过来的产品问题

P1 计划 §7 留下、尚未回答的：

- 四象限自动归类规则
- 习惯连续天数算法（跨时区、补打卡怎么算）
- 番茄钟是否强制关联任务
- P1 是否含回收站
