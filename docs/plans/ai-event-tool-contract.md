# EVENT（倒数日 / 纪念日）的 AI 工具契约

> 状态：**EVENT 契约已定死（实现等倒数日那条线）；覆盖面门禁 ✅ 已落地，且覆盖面已跑满**
> （现量 **8/8**，见 §5.1）。
> 立论依据：ADR-0044（倒数日实体）、ADR-0045（对话式助手与授权解耦）、AGENTS §3.4 / §3.5。
> 编号消歧：本文说的"覆盖面门禁"在 `docs/plans/ai-assistant-closure.md` 里叫 **W10**，
> 而 `docs/plans/countdown-anniversary.md` **也有一个 W10，是同一件事**（两条线各自起了名）。
> 本文把它改称 **`AI-COV`**，后续工单一律用 `AI-COV-n`，不要再复用 W 号。

---

## 1. 裁决：实体与 AI 工具同批（D-3，2026-10-03 产品负责人拍）

`docs/plans/countdown-anniversary.md:175` 写的是「⏸ 排期决定（产品负责人 2026-10-03）：
**不在本批立这条门禁，后面再说**」，`:176` 紧接着承认后果：「所以 W2 落 `EVENT` 时，
AI 侧不会有任何东西提醒我们」。**这句已被同日稍后的口头拍板推翻**：倒数日与 AI 工具同批设计。

⚠️ 本文初稿写"那份文件此刻正被一次 merge 占用（`.git/MERGE_HEAD` 在飞），所以先落本文、
合流时再改" —— **这个前提当天就消失了**：合流已完成、`countdown-anniversary.md` 已在 `main`。
🔴 **但它 `:175` 那句到今天仍然是旧的**（现量：
`git show main:docs/plans/countdown-anniversary.md | sed -n '175p'`）。
它给的理由是「这条门禁一上就会让**现有 10 个实体里那些没接 AI 的当场全红**」，
而**这批的落地方式恰好让那个理由不再成立**：`AI-COV` 门禁不是"没工具就红"，
是"**没工具又没有 `AI-COV-<n>` 缺口登记**才红"（`check-ai-coverage.mjs:531` 起的
`ENTITY_COVERAGE_DEBT`，今天的五项未覆盖实体全都挂在里面、门禁照样 exit 0）。
⇒ 合流时必须把 `:175` 就地改成指向本文并保留删除线；本批**不碰那个文件**（它属于并行那条线）。
按"改一处必 sweep 全仓"，同一句结论在 `docs/plans/ai-assistant-closure.md` 的 D-3 行
也有一处，两处已同日更正。

**这条裁决不是新立场，是把已经写了的话变成有牙齿的状态。** ADR-0044:96 原文：
「`EVENT` 不会让任何 AI 门禁变红……⇒ 加了实体却漏接工具目录是**静默通过**……
本 ADR 要求把工具目录改成由 `ENTITY_TYPES` 驱动，否则这条决策在 AI 侧等于没做」。
也就是说 ADR 早就判定"延后 = 等于没做"，而计划却排了延后 —— 两者不能同时成立，
拍板选的是 ADR 那一侧。

---

## 2. 先修一处口径：分母与"覆盖"到底怎么算

这两条改完，现状数字会变。**这不是把指标调差，是原指标在虚报。**

### 2.1 "已覆盖"必须是**读 + 写都有**

`scripts/gen-ai-capability-manifest.mjs` 已经算出了每实体的
`read-write / read-only / write-only / none`，但当时 `covered` 判的是
`coverage !== 'none'` —— 于是 `PROJECT` 靠一个只读的 `list_projects` 就被计成已覆盖。
产品立场是「界面有的功能都能**改**」，所以判据取 `coverage === 'read-write'`，
现已落成生成器导出的**唯一口径函数** `countsAsCovered()`（`:349`，被 `:516` 消费），
`check-ai-coverage.mjs` §9 只从它取口径、**不再自己算一遍**。

### 2.2 分母的准入判据（本轮定下来，之前没人写）

> **一个已物化实体进 AI 覆盖面分母，当且仅当它在产品里有"用户能填或能按"的编辑面。**

区分线必须写成句子，否则每次加实体都要重吵一次。逐条判定（10 个已物化实体）：

| 实体 | 进分母 | 依据（file:line） |
|---|---|---|
| `TASK` | ✅ | `packages/app-host/src/actions.ts:353` 一整套；界面 `apps/web/src/features/tasks/store.ts:190` |
| `PROJECT` | ✅ | `project-actions.ts:49-68`；`apps/web/src/features/projects/store.ts:57` |
| `TAG` | ✅ | `project-actions.ts:70-71`；`TaskOrganizer.tsx:208` |
| `NOTE` | ✅ | `note-actions.ts:79-95`（9 个成员）；web `notes/store.ts:51`、mobile `NotesSection.tsx:82` |
| `HABIT` | ✅ | `habit-actions.ts:77-136`；`HabitsView.tsx:177` |
| `HABIT_LOG` | ✅ | **打卡是用户按的**：`habit-actions.ts:129 checkIn` ← `HabitsView.tsx:278` |
| `REMINDER` | ✅ | `reminder-actions.ts:78-104`；web `features/reminders/store.ts:79`（⚠️ mobile 侧零界面，见 §3.5 第 2 问） |
| `FOCUS_SESSION` | ✅ **留在分母**（本行原判"移出"，2026-10-03 当天被自己的准入判据否证，见下） | 开始/中止是用户按的，两端同一个共享面板：web `apps/web/src/features/focus/FocusTimer.tsx:240` → `@heyta/ui` 的 `FocusPanel`，mobile `apps/mobile/src/screens/FocusScreen.tsx:271` 调 `startFocus`（`focus-timer.ts:237`）⇒ 命中"能按"那一半 |
| `AI_FEEDBACK` | ❌ | 用户点的是"对 AI 建议的处置"，不是撰写资料：`apps/web/src/App.tsx:854` |
| `PREFERENCE_CORRECTION` | ❌ | 同上，界面只有"忘掉这个偏好"一个开关：`App.tsx:2259` |

🔴 **原判"移出 `FOCUS_SESSION`"已经被撤回，撤回的理由值得留着**：当时写的是
"唯一写入口是计时器结束时自动 `log()`，`focus-actions.ts:45` 只有 `log/listSessions`、
没有 `update/remove`"，并把区分线放在**值由谁给**（时长由计时器产生、用户不当场填字段）。
这句和上面那条判据句子**互相矛盾**：判据写的是"用户能**填**或能**按**"，
而"开始一次专注"就是用户按的 —— 按这个判据它就该进分母。
两条里必须有一条让步，产品立场（"界面上有的功能 AI 都能操作"）要求让步的是那条排除。

⚠️ 当时还写过一句"这条判据在门禁里就是靠 `focus-actions.ts` 有没有 `create*`/`update*` 来判的" ——
**那句是假的，落地的门禁不做这件事**：`AI-COV` 门禁只读工具目录与实体清单两边，
它**从不打开任何 action 文件**。把"判据怎么落成代码"写错，比写漏一条更贵 ——
下一个人会去查一个不存在机制。当时 `FOCUS_SESSION` 是**带着缺口登记**（`AI-COV-6`）
留在分母里的，而不是被搬出去。
🔴 **同日稍后它已经有工具了**（`list_focuses` + `log_focus`），`AI-COV-6` 随覆盖面跑满被清空。
保留这两句是为了让下一批看清："带着登记留在分母里"是**过渡态**，不是结论 ——
它存在的唯一理由是那条判据不许被悄悄放宽。

改完的数（现量：`node scripts/gen-ai-capability-manifest.mjs --check`）：
**分母 8、已覆盖 8（每一格都读+写齐）**，目录 22 个工具（读 10 / 写 12）。
（🔴 这一行是**批次一落地当时**的现量，原句留着是因为它就在那一刻成立；批次二把 `EVENT` 纳进分母后，
同一条命令打印的是 **分母 9、已覆盖 9、目录 26（读 12 / 写 14）**。）
本文初稿写的「分母 7、已覆盖 1」两个数都已过期（分母因 `FOCUS_SESSION` 回到 8；
覆盖一度因补了 `create_project` + `list_habits`/`create_habit` 到 3，其余五项在同一批里补齐）。
此前对外说的 `2/8` 也是错的（`covered` 判的是"有任一工具"）——
`ai-assistant-closure.md` §7、`docs/research/dida365-feature-benchmark.md:132` 也已过期 —— 它写着 `NOTE`
"零 Action、零 UI"，而 `note-actions.ts:77-95` 有 9 个成员且两端都在用。

---

## 3. EVENT 的工具契约

`EVENT` 的代码形状目前**不存在**（全分支 `git grep` 只命中 LICENSE/billing 噪音；
`packages/shared-schema/src/entity-types.ts` 里也没有 `EVENT`），
所以下面字段名一律标注它的**来源是文档层**，实现时以那条线为准，
但**工具的边界与出境集合现在就定死**，否则同批无从谈起。

### 3.1 读（2 个）

| 工具 | 参数 | `egressFields` |
|---|---|---|
| `list_events` | `type?`（`countdown/anniversary/birthday/holiday`，plan:140）、`from?`/`to?`（**成对**，沿用 `LIST_TASKS_MAX_DUE_SPAN_DAYS` 那条"只给一端=向未来无限开放"的理由）、`limit?` | `event.id` `event.name` `event.nextDate` `event.calendarKind` `event.repeats` `event.type` `event.archived` |
| `get_event` | `eventId` | 上面全部 + `event.remark`（备注正文，目录描述里**单独说出来**，形状照 `get_task` 的 `task.body`） |

### 3.2 写（4 个提案；🔴 一律只产出提案，确认才 `host.submit`）

| 工具 | 允许的字段 | 为什么是这个集合 |
|---|---|---|
| `create_event` | `name` `date` `calendarKind` `repeats` `type` `reminderOffsets?` | 用户在界面上能填的最小充分集（plan W5:140） |
| `update_event` | 同上逐字段，**只改显式给出的** | 与 `update_task` 同一条纪律 |
| `archive_event` | `eventId` | 归档 ≠ 删除，是界面第一等动作（plan:69-71） |
| `remove_event` | `eventId` | 删除；提案文本必须把它读起来像删除（不淡化） |

**刻意不进 AI 的三项，以及理由（可辩论，写在这就是为了被辩论）**：

- `pin`（plan:69-71 / research:244）：布局意图，模型没有任何依据判断"用户想把哪一天钉在顶上"。
- 样式 / 颜色（plan:140）：审美意图。给它就等于让 AI 替用户决定"哪个纪念日重要到要特殊配色"。
- **图片 / 封面**：第一版根本不做（ADR-0044:88），所以 `event.*` 的出境字段里
  **出现任何图片字段都是错的** —— 而 §3.4 那条载荷对照会在它出现的那一刻响。

### 3.3 农历的分工（这一条最容易做错）

出境的是**用户自己选的历法与日子**（`calendarKind` + `date`），
换算由本地内核做（ADR-0044 §2.3 / §5b：构建期生成 + 查表）。
🔴 **模型永远拿不到换算引擎，也不许让它自己算农历** ——
它的输出里若出现"农历某月初几 ↔ 公历某天"的对应，那只能是回显用户刚给的字符串。
否则症状是"某些年份差一天"，而那种错没有编译错误、没有失败用例，只有用户发现纪念日不对。

### 3.4 三条验收判据（不是愿望，是能跑的）

1. `EVENT` 进 `EntityModelMap` 的那一刻，`AI-COV` 门禁**必须变红**，
   直到 `list_events` + ≥1 个写提案工具登记齐（判据是 §2.2 那句准入线，不是某个清单）。
   ✅ 这条**两端现在都有牙齿了**（本批落地）：正向半边在生成器 `:457`
   （工具归到没有领域模型的实体 ⇒ 当场红，并点名 ADR-0044/0045"同批"那条，见 `:86`），
   反向半边在 `scripts/check-ai-coverage.mjs` §9 —— 实体在分母里、既没工具又没有
   `AI-COV-n` 缺口登记 ⇒ 红。**已用注入验过**：塞一个假实体、以及把 `EVENT` 塞进两份实体清单，
   两次都响（逐字读数见 §5.3）。
2. 每个 `egressFields` 声明必须 ⊇ **真实载荷键**（形状照
   `packages/local-api/tests/tool-egress-fields.spec.ts`：实际跑执行器收键，不比代码）。
3. "模型可选得到"要单独钉：工具必须出现在 `listAuthorizedTools()` 的输出里
   （内置 AI 与 MCP 共用同一个函数，`mcp.ts:69-74`），而不是只出现在目录数组里 ——
   少这一步会得到"注册了但永远看不见"的静默死工具。

### 3.5 要给倒数日那条线的问题（不代拍）

- `reminderId = taskId:triggerAt`（`reminder-actions.ts:128`）。EVENT 的提醒若复用
  `REMINDER`（ADR-0044:98 自己列为未决），**这个 id 的主语是谁**？两条不同实体的
  提醒会不会撞同一个 id —— 撞了就是 `UPD` 打到别人的提醒上，而且不会报错。
- `mobile` 侧 `REMINDER` 零界面（唯一调用点 `apps/mobile/src/lib/reminders.ts:110` 是投递器）。
  按哪一端算"界面有"要先定：本文按**有一端有编辑面即进分母**，
  所以 `REMINDER` 进分母；将来若要改成"每端都要"，得同时改判据句子并重跑覆盖面。

---

## 4. 不重叠声明（两条线并行时的边界）

本文件所在的 `AI-COV` 这一批**不做**：不改 `packages/shared-schema`、
不建 `event-actions.ts`（全仓+全分支目前 `createEventActions` 0 命中）、
不动 `docs/plans/countdown-anniversary.md`（正被 merge 占用）、不 bump
`CURRENT_SCHEMA_VERSION`。

倒数日那一批**不必**做：不必自己写覆盖面门禁 —— `AI-COV` 提供，
它落地时应当**只做一件事**：把 `EVENT` 加进 `EntityModelMap`，然后看门禁红，
再照 §3.1/§3.2 把工具补上。如果它先落地而门禁还没写，本文 §3.4 第 1 条就是它的验收标准。

---

## 5. 覆盖面跑满后的现状、容量口径与**每实体还缺的动作**

### 5.1 现状（现量，2026-10-03 本批收尾）

`node scripts/gen-ai-capability-manifest.mjs --check` 打印的三行就是门禁读数的真源：

- 工具目录 **22 个**（读 10 / 写 12）
- 🔴 **10-04 现量更正**：目录 **26 个**（读 12 / 写 14）、覆盖面 **9/9** —— `EVENT` 进分母，
  而剔除的那两个「落库载体」不变，所以分母从 8 走到 9（上面两行是该批落地当时的读数，留着）。
- 覆盖面 **8/8**（分母口径见 ADR-0045 §2.7：10 个已物化实体里剔除 2 个"落库载体"）
- 无工具实体 **（无）**

逐 pack 的席位分布（现量：`LOCAL_API_TOOL_PACKS` 数出来的，不是抄的）：

| 实体 | 席 | 工具 |
|---|---|---|
| `TASK` | 5 | 读 `list_tasks` `get_task` / 写 `create_task` `update_task` `complete_task` |
| `NOTE` | 4 | 读 `list_notes` `get_note` / 写 `create_note` `update_note` |
| `TAG` | 3 | 读 `list_tags` / 写 `create_tag` `set_task_tags` |
| `PROJECT` | 2 | 读 `list_projects` / 写 `create_project` |
| `HABIT` | 2 | 读 `list_habits` / 写 `create_habit` |
| `HABIT_LOG` | 2 | 读 `list_checkins` / 写 `record_checkin` |
| `FOCUS_SESSION` | 2 | 读 `list_focuses` / 写 `log_focus` |
| `REMINDER` | 2 | 读 `list_reminders` / 写 `create_reminder` |

🔴 `ENTITY_COVERAGE_DEBT`（`check-ai-coverage.mjs` 里那本缺口台账）**现在是空的** ——
它是唯一一条豁免通道，所以"零条豁免在生效"本身就是门禁结论的一部分，而不是"门禁没内容"。
台账非空时每一条都必须带 `AI-COV-<n>` 工单号（§5.3 注入 C 验的就是这条牙齿）。

⚠️ 本节初稿写的是「覆盖面 **3/8**、目录 **9 个工具（读 4 / 写 5）**、无工具实体 **5 个** 带
`AI-COV-2/3/5/6/7` 登记」—— 那是**同一批早几个小时**的读数，五格已在同批补齐。
原句留着是为了让下一个人看清 §5.2 那个"只剩 1 席"的算术是从哪来的。
同样被作废的还有 `docs/research/dida-ai-assistant-gap-analysis.md`（§3.2 那张口径表两行 + §8 对照表三行）、`docs/research/dida365-feature-benchmark.md`（便签那一行 + 本机 API 那一行）、
`docs/plans/ai-assistant-closure.md` §7 与 `docs/reference/ai-architecture.md` 的 P4 行 —— 已同日 sweep。

`AI-COV` 门禁（`scripts/check-ai-coverage.mjs` §9 覆盖面 + §10 容量，挂在既有的
`check:ai-coverage` 段上 ⇒ **已经在 `pnpm check` 链里，没有新增段**）只从生成器取口径，
自己不再读一遍上游。它能失败：四次注入（§5.3）+ 本批补齐时对六个新工具各做一条
"拿掉实现 ⇒ 指定用例红"的变异（§8，含一条未变异的正向对照）。

🔴 `node scripts/check-ai-coverage.mjs` 现在打印的两行，就是把"口径"和"容量"算给人看：

```
ℹ️  实体覆盖面 8/8（口径：读和写都有工具）；已登记缺口 0 项：
ℹ️  目录 22 个工具 ≤ 每实体 5 × 分母 8 = 40 席（已用 22，剩 18）。
```
> ⚠️ 上面那段是**该批落地那一刻的输出转录** —— 它不带日期地贴在文档里，就会被下一个读者当成现状。
> 现量（10-04，`node scripts/check-ai-coverage.mjs`）打印：「目录 **26** 个工具 ≤ 每实体 5 × 分母 **9** = **45 席（已用 26，剩 19）**」。

**"剩 18 席"这一行就是 §5.2 那条容量故事现在的全部含量**：容量不再是一个要人拍的数，
而是 `每实体上限 × 分母` 的算术结果 —— 分母每加一格（比如 `EVENT`）就多 5 席预算，
所以 §5.3 的注入 D 同时也在验容量这一侧。

### 5.2 目录容量：从"总量魔法数"改成"每实体档位"，§5.2 初稿那个结构冲突**已解除**

> 初稿这一节标题里的 🔴 是"这一条要产品拍"，它登记的冲突是真实的，
> 但**解开它的方式不是拍数字**，而是那条上限本身写错了坐标系。

初稿记录的冲突（当时的数都是真的）：`packages/local-api/tests/local-api.spec.ts:87`
钉着 `expect(LOCAL_API_TOOLS.length).toBeLessThanOrEqual(10)`，理由写在 `:86`
（"这里是任务管理，超过 10 个就该先问'真的需要吗'"）；而 §2.2 的口径是
**每个实体至少要一读一写**。9 个条目 + 8 个实体 ⇒ **只剩 1 席**，剩下 5 个实体
**不可能**靠"继续加工具"覆盖完（要 10 个新席位）。两条判据各自合理、算术上互相封死、
`pnpm check` 全绿。

✅ 现在的形状（不是"把 10 抬成 20"）：总量上限被**换成按实体判**，
`shared.ts` 的 `MAX_TOOLS_PER_ENTITY = 5` 是那条按实体上限，
`local-api.spec.ts:91-105` 逐 pack 断言，`check-ai-coverage.mjs` §10 再钉一遍
"读不到这个常量就红"。**为什么是 5**（原文在 `shared.ts:85-95`，这里只搬结论）：
一个实体最多同时存在四档 —— "列出来"、"按 id 取一条"、"修改字段"、"该实体专属的那一个动作"
（`complete_task` 就是第四档），第五档是余量；要第 6 个得先回答它属于哪一档，
答不出通常意味着它属于**另一个实体**（该另开 pack）或者它只是一个"读法变体"
（该做成参数，而不是做成工具 —— 参数不进"逐工具默认关"那张清单，
而那张清单的长度就是用户要理解的负担）。
总量因此变成**派生**的：`每实体上限 × 覆盖分母`，分母扩一席，目录才多一席预算。

🔴 初稿列的两条出路里，第 2 条（"把某个既有工具腾出去"）**没有采用，也不该采用**：
删一个工具 = 让一个实体从"能读能写"退回"只读"，覆盖面会跟着掉，
而那正是 `tool-pack-coverage.spec.ts` 文件头写的判据取向要挡的"悄悄缩水"。

⚠️ 仍然不要第三种做法："把缺口从登记里删掉让它不红"。台账有三条牙齿
（必须带 `AI-COV-<n>` 工单号、必须写明**为什么**、实体已经不在分母里却还挂着 ⇒ 红），
删条目会在下一条判据上响。**今天这本台账是空的，所以这条牙齿当前没有目标 ——
但它必须在**，否则下一次加实体的人拿到的是"没有闸"而不是"闸开着"。**

### 5.3 四次注入的实际读数（历史读数：目录当时是 9 个工具、覆盖 3/8）

⚠️ 下表里的"分母读数变成 3/9""读 2 / 写 0"是**当时那份目录**的数。
注入手法仍然可复跑（见表下的前提），但复跑时打印的绝对值会跟着目录走 ——
**别把这张表当现量引用**，现量在 §5.1。

| # | 注入 | 门禁的**实际**答复（逐字摘录） |
|---|---|---|
| A | 往两份实体清单塞一个**假实体** `FAKE_THING` | exit 1：「实体 `FAKE_THING` 在分母里，AI 却**没有能读又能写**的工具（读 0 / 写 0），而 `ENTITY_COVERAGE_DEBT` 里也没有它」，分母读数同步变成 `3/9` |
| B | 把 `create_project` 的 `kind` 从 `write` 改成 `read`（等价于"写工具没了"） | exit 1：「实体 `PROJECT` 在分母里，AI 却**没有能读又能写**的工具（**读 2 / 写 0**）」—— 注意它没算成已覆盖，多一个读工具不加分 |
| C | 把 `REMINDER` 的工单号从 `AI-COV-7` 改成 `TODO-7` | exit 1：「`REMINDER` 的缺口登记没有形如 `AI-COV-<n>` 的工单号（当前：TODO-7）。**没有编号的豁免等于没有豁免**」 |
| D | 🔴 **把 `EVENT` 真的加进两份实体清单**（D-3 说的就是这一刻） | exit 1，逐字是：「实体 `EVENT` 在分母里，AI 却**没有能读又能写**的工具（读 0 / 写 0）…ADR-0044 与 ADR-0045 §2.6 要求实体和它的 AI 工具**同批**落地」 |

⚠️ **注入 D 的一半过程本身也是一条证据**：只往 `EntityModelMap` 那侧加 `EVENT`、
没同步 `ENTITY_TYPES` 时，门禁报的是**另一条**红 ——
「`EVENT` 在 `EntityModelMap` 里，却不在 `ENTITY_TYPES` 里 —— 两端实体清单已经不一致」。
也就是说"两份清单只改一份"这个常见错误**不会**被覆盖判据悄悄吸收，它自己有一道闸。
（这条是实测撞出来的，不是设计的副产品 —— 记录它是因为它会告诉下一个人：
红的**文字**不同，说明响的是**哪一道**闸。）

🔴 注入手法（写下来是因为它可复跑，也因为它有前提）：直接改
`packages/domain/dist/index.js` 与 `packages/shared-schema/dist/index.js` 里的实体数组
（`dist/` 被 gitignore，改完 `cp` 回备份、`cmp -s` 证逐字节还原），
**不改 `src/`**。理由是门禁的上游就是这两个 dist —— 绕开重建，也就不污染工作树。
⚠️ 前提：`dist` 必须比 `src` 新（本批开头刚跑过全量构建）。**若 `dist` 是旧的，
这套注入仍然会响，但它响的是"旧产物的覆盖面"而不是当前源码** —— 重跑前先确认构建新鲜。

### 5.4 🔴 "覆盖面 8/8"回答的是"每个实体都有读+写"，**不回答"界面上每个动作都能做"**

这一节是 `tools/project.ts` 与 `tools/habit.ts` 的文件头指向这里的原因：
那两处原先把缺口写成"被 `<= 10` 的容量判据挡着"，**容量换形之后那个理由没有了**，
于是缺口必须有一个**逐条登记的地方**，否则它会变成"没人说不要、也没人做"。

判据口径先说清：下面每一行都**不是**门禁红项（门禁只到实体那一格），
它是**产品缺口的台账**。把它读成"等容量放开就能补"是错的 —— 容量已经放开了。

| 实体 | 界面有、AI 没有的动作 | 依据（动作所有者） | 为什么还没做 |
|---|---|---|---|
| `TASK` | 删除 / 还原 / 彻底删除 | `actions.ts:140,172,189` | TASK 已占满 5 席。**"让 AI 删数据"要产品拍**：删除在界面上有回收站兜底，AI 提案确认后同样进回收站，但"AI 说删就删一条任务"是**信任**问题不是席位问题 |
| `TASK` | 归入清单 / 设子任务 / 设开始日期与时长 | `actions.ts:254,271,285` | 同上（满席）。前两条属于"修改"档，与 `update_task` 的 `fields` 白名单**同一条 seam** —— 加字段比加工具便宜，`local-api-host.ts:511-520` 对不认识的字段的拒绝就是给它兜底的 |
| `TASK` | 设"重要" / 四象限拖放 / 顺延到今天 / 重复规则 / 便签正文 | `actions.ts:192,209,229,269,320` | 登记为**不做**：四象限拖放是**手势**（`setQuadrantDrop` 要的是 plan，不是一个字段值），重复规则是一条 DSL 字符串（误伤面同"裸日期"待拍项），其余三个待席位 |
| `PROJECT` | 改名 / 设颜色 / 归档 / 删除 | `project-actions.ts:50,64,66,68` | 还剩 3 席 ⇒ **没有理由**，纯没做。改名与删除各占一席；颜色那条同 `HABIT` 的颜色（见下）；归档与删除**同一条产品问题**（"AI 让一条清单消失"） |
| `TAG` | 删除标签 | `project-actions.ts:71` | 还剩 2 席 ⇒ 没做。⚠️ 它比"删清单"更危险：删标签会同时改**所有挂着它的任务**，那是 §3.4「一个意图=一个 op」的边界，要先论证（与 W11 批量写入同一族）。🔴 **W11 落地之后这一行不能被读成"论证已过、可以做"**：W11 解的是"一个意图内含 N 条**用户点名的**变更"（提案上写清几条、确认一次），而"删标签顺带改所有挂着它的任务"是领域层**明确拒绝过**的形状（`project-actions.ts:192-201` 只打 `TAG` 墓碑、不清任务；`:21-23` 同一立场：级联删除会让误删从可恢复变成不可恢复）。要补的是"AI 能不能发起一次级联"，不是"能不能批量" |
| `HABIT` | 改目标 / 换颜色 / 换图标 / 归档或删除 | `habit-actions.ts:79,91,102,118` | 还剩 3 席 ⇒ 改目标**没理由不做**（纯字段）。颜色/图标另有一条产品理由：**AI 替用户选一个身份标记**要先回答"谁给它赋义"（同一立场见"调色板由我们给、含义由用户赋"），**不是**没排上 |
| `HABIT_LOG` | 撤销打卡 | `habit-actions.ts:133` | 还剩 2 席 ⇒ 没做。它和 `record_checkin` 是**同一个 entityId 的反向操作**（`habitLogId(habitId, date)`），补的时候不需要新schema 概念，只需要一档"撤销" |
| `FOCUS_SESSION` | （无缺口） | `focus-actions.ts` 只有 `log` + `listSessions` | 界面上没有"改一次已记录的专注"这件事 ⇒ 这一格**满了**，不是没做 |
| `REMINDER` | 改时刻 / 延后 / 忽略 / 取消忽略 / 删除 | `reminder-actions.ts:87,93,98,100,102,104` | 还剩 2 席 ⇒ 前三条没做。**`markReminderFired` 刻意不做**：它的调用者是投递器（`apps/mobile/src/lib/reminders.ts:110`），用户不按它 ⇒ 按 §2.2 的准入判据它压根不属于 AI 面，而不是"排不到" |

📌 这一节的一般形式：**"覆盖面"是一个下限指标，把它跑满之后它会停止暴露信息。**
所以下一个人问的应该是"哪个动作没有"，而回答它需要一张**动作所有者**表，
不是再看一次覆盖率比值。上表每一行的"依据"列就是那张表的位置。

🔴 **W11（`a0df705e`）之后，这张表要多加一条它原本没覆盖的方向：AI 有、界面没有。**
`complete_task` 现在收 `taskIds`（去重后最多 20 条），而界面上**没有任务多选** ——
`packages/i18n/src/locales/zh-CN.ts` 里"批量操作"还明写在未做清单里
（现量：`grep -n "批量操作" packages/i18n/src/locales/zh-CN.ts`）。
所以今天的真实状态是"AI 能一次完成五条任务，用户在界面上只能一条条点"。
本节的全部判据都朝一个方向问（"界面上有的动作 AI 能不能做"），因此它**结构上看不到这种反向缺口** ——
这一格就是补在那儿的：
① 它不是漏做：批量的动机是助手侧的一条硬约束（ADR-0045 §2.4 一次轮次内至多一个写提案），
没有它，"把今天这 5 条都完成"在助手里只能改 1 条；
② 它也不是"界面该马上有多选"的理由（那是 UI 那条线的排期，不在本批）；
③ 但**下一次再出现"AI 做得到而用户做不到"时必须回到这里加一行**，否则这张台账只记录了半个问题。
⚠️ 顺带一条容易误读的：W11 的论证**不外推**到 `TAG` 删除那一格 ——
那里的级联是领域层明确拒绝过的形状（`project-actions.ts:21-23`、`:192-201`），
批量解的是"一次确认内含 N 条用户点名的变更"，不是"一次变更扇出到没点名的实体"。

---

## 6. 四条本批踩到的、**可以迁移**的坑（尚未占台账编号）

⚠️ 尾号是**抄件**，合流时以现量为准（本文写时 `main` 的索引段已列到 **#176**，而这批工作在一条
落后于 `main` 的分支上 —— 在这里直接续号会在合流时撞出两个 #172。所以本批**不占号**，
把三条原文放在自己的单写者文档里，等合流时由收口那次按当时的台账末尾搬进去。

1. **委派给子 agent 的文件，它可能在 `git add` **之后**继续写。**
   本批真发生了一次：一笔提交里落进 `case 'complete_task_MUTATED'` —— 变异实验的还原动作
   发生在暂存之后，提交物因此带上了变异体（`85f13aaf` 单独修回）。
   ⇒ 提交任何委派目录前先 `git grep MUTATED <那个目录>`，把它当一次廉价闸门，
   而不是"我记得它说还原了"。

2. **门禁的 `reason` 字符串会把它抄来的那句话变成事实。**
   `ENTITY_COVERAGE_DEBT` 里最初四条理由写的是"TAG/NOTE/HABIT_LOG/REMINDER 在产品里
   **没有写动作本体**"，抄自一份未逐条核过的报告。读被调方本体之后**四条全被否证**：
   `project-actions.ts:178`、`note-actions.ts:133`、`habit-actions.ts:275`、
   `reminder-actions.ts:174` 各自真的 dispatch 一条 CRT。
   ⇒ 写进门禁的归因是**断言**，不是注释：每条都要打开被调方本体；
   改的时候保留原句 + 标 ⚠️，让下一个人看见它错在哪一层。

3. **两条各自合理的判据可以在算术上互相封死，而两边都不会报错。**
   `local-api.spec.ts:87` 的 `<= 10`（"超过 10 个就该先问真的需要吗"）和覆盖面
   "每实体一读一写"都是好东西，但 9 个条目 + 每实体 2 席 ⇒ 剩下 5 个实体**永远补不完**，
   而 `pnpm check` 全绿。⇒ 加"容量类"上限时，同时写下它约束的那个增长向量需要多少席；
   撞到就把冲突**登记成待拍项**，不要靠删工具或抬数字解决。

   ✅ **这条坑的解法最后不是"拍数字"，而是那条上限的坐标系写错了**：总量从来不是
   用户要理解的负担，**逐工具的授权清单**才是，而清单天然按实体分组。
   换成 `MAX_TOOLS_PER_ENTITY`（每实体档位上限）后冲突自动消失，且它比原判据更严 ——
   总量 10 的时候 TASK 一个人吃掉 5 席没人会响，现在会。
   📌 可迁移的部分：**冲突登记是对的，但登记时要顺手问一句"这两条判据是不是在同一层量东西"**；
   如果一条量总量、一条量"每个成员至少 N"，那它们相撞往往是**第一条例程写错了单位**，
   不是需要人来裁决的资源争端。

4. **一份"验证判据能失败"的脚本，自己坏了的时候报的正是"判据没牙"。**
   §8 那六条臂第一次跑，输出是六行"（无汇总行）"—— 读起来像**每条判据都被变异存活**，
   而真实原因是 `execFileSync('npx', ['vitest', …])` 在这棵工作树里找不到 `vitest`
   （它装在 `packages/app-host/node_modules/.bin/`，仓库根没有）。**测试根本没跑。**
   ✅ 修法不是改错误文案，是加一行**未变异的正向对照**打印在前面
   （`Tests 44 passed (44)`）：它一红就说明探针坏了，一绿才轮到六条臂的读数有意义。
   📌 一般规律：**变异脚本的"存活"和"没跑"是同一个形状**（都没有失败用例），
   所以任何"证明判据能红"的流程都必须自带一条"证明它现在能绿"的对照，
   而且对照要跑在**第一个**，不是最后。

---

## 7. `pnpm check` 链的逐段读数（2026-10-03，本批收尾）

> 📌 **本节是"本批分支"那一棵树的读数，不是现状**。同一条链在**合并态**（`main` + 本批）上重跑过，
> 那里下面 5 条红有 3 条已经不在（逐条对照在 §11.1）。两节不等价、也都不该被读成对方的更新：
> §7 回答"这个分支单独存在时链是什么状态"，§11 回答"合流时会发生什么"。

链共 **57 段**（`node -e` 把 `scripts.check` 按 `&&` 切开数出来的）。
`check:ai-coverage` 在第 **48** 段 —— 即"新门禁接进 `pnpm check`"这件事**不需要改 `package.json`**，
它是既有段（第 34/35 段是 `check:ai-quota` / `check:ai-tools`），本批往里加了一节。
**`check:ai-e2e`（第 49 段）刻意没跑**：它会 SIGKILL 端口上别人的 `vite`（§7 第 87 条同族），
它的等价证据是我单独跑的 `e2e/tests/ai-tool-run.spec.ts` + `ai-assistant.spec.ts` —— **3 passed**。

| 段（原链编号） | 结果 | 归属与取证 |
|---|---|---|
| **50 段** | **exit 0** | 含 `check:ai-coverage`(48)、`check:ai-tools`(35)、`check:ai-quota`(34)、`check:docs-voice`(19)、`check:claims`、`check:layering`、`check:design`、`check:materialized-reads`。总数对账：原链 57 段 − 跳过 `check:ai-e2e` = **56 段跑了** = 50 绿 + 下表 5 红 + `pnpm -r test`（单列） |
| 3 `typecheck` | 红（两个包）| ① `packages/ai/tests/capability-manifest.spec.ts:391/410` —— **本批自己引入**（拆两条臂时用了 `built.entities` 却没长夹具类型），已修（`c5cd0ab0`）；② `packages/app-host/tests/hosted-account-profile.spec.ts:138/156` —— 另一条线的在飞文件，**不吸收**。修后单包复跑：`@heyta/ai typecheck` exit 0 |
| 12 `check:l4` | 红 | `apps/mobile/src/screens` 内联样式 98 > 基线 90。本批**零改动 `apps/mobile`**（`git log --name-only 40244aa3..HEAD -- apps/mobile` 空），是并行那条线的已提交债；**没有把基线调到 98** |
| 32 `check:docs` | 红 | 4 条死链全指向倒数日那条线的文件；分支落后 `main` 所致，HEAD 上先存在（见 `c9b7c691` 提交信息） |
| 51 `check:landing-e2e` | 红 | `e2e/landing/docs-centre.spec.ts` 2 条（`first-run` 的 `<img>` 数期望 1 / 实量 0）。本批零改动 `apps/landing` 与 `e2e/landing`，而配图资产确实在 git 里（`apps/landing/public/assets/help/first-run/W01-tasks.png` 已被跟踪）⇒ 属落地页那条线，**没动它的判据** |
| 53 `check:web-storage` | 红（环境）| `Error: Port 4321 is already in use` —— 并行会话的 vite 占着。脚本硬编码端口 ⇒ 隔离检出里跑不了；**没有为挤进去而杀别人的进程** |
| 57 `pnpm -r test` | 见下 | 第一次编排**静默漏跑了这一段**（我的 runner bug：步骤清单末尾无换行，`while read` 丢掉最后一行，脚本照样打 `DONE`）。补跑（排除沙箱里装不上的 `@heyta/sync-server`）：**17 个包全绿**，`apps/web` **1499 passed / 1 failed / 12 skipped** |

🔴 那 1 条 `failed`：`apps/web/tests/reminders-panel.spec.tsx > B … 🔴 超过每任务上限时把错误显示出`，
报的是"等待「超上限的错误被记下」超时"，而界面文本显示面板本身渲染正常。
**单独低负载复跑：6/6 通过（exit 0）** ⇒ 读数只能是"全量并发下的一次超时"，
**不构成"已排除"**，也不能反过来写成"本批没坏东西"的证明。
排查序列留给下一轮：① 单独跑该文件 N 次取失败率；② 把 `waitFor` 的等待预算从常量改成
可调参数并在高负载下复测；③ 若仍只在全量并发下红，去读那条用例的时钟来源。

---

### 7.1 六格补齐之后**重跑**的读数（同日第二轮，本批真正的收尾）

第一轮那 5 红里有 4 红其实是我自己带进去的，只是当时的编排**没有把它们连起来看**：
`pnpm -r build` 红在 `apps/web`，于是同一条链里凡是要先 build web 的段（`check:journey-coverage`、
`check:privacy-consent-e2e`）跟着红，而 `check:web-storage` / `check:web-migration` 的红
长得像"端口被占"，读成了环境问题。重跑（逐段记 rc，`/tmp/aicov-rerun/rc.txt`）：

| 段 | 第一轮 | 第二轮 | 结论 |
|---|---|---|---|
| 1 `pnpm -r build` | rc=1 | **rc=0** | 我引入的重复声明已修（§9 第 1 条） |
| 3 `typecheck` | rc=2 | rc=2（**只剩 2 条**） | 全在 `packages/app-host/tests/hosted-account-profile.spec.ts:138/156`，属账号资料那条线（`7e299118` 引入）。**不吸收** |
| 12 `check:l4` | rc=1 | 未重跑（与本批无关） | `apps/mobile/src/screens` 内联样式基线债，本批零改动 `apps/mobile` |
| 27 `check:journey-coverage` | rc=1 | **rc=0** | 1-build 的下游 |
| 32 `check:docs` | rc=1 | rc=1（**同样 4 条**） | 4 条死链全指向倒数日那条线的文件（`countdown-anniversary.md` / ADR-0044 / 那份 research），分支落后 `main` 所致。本批新增的引用一条都没红 |
| 48 `check:ai-coverage` | rc=0 | rc=0 | 打印 `覆盖面 8/8`、`已登记缺口 0 项`、`22 ≤ 5×8=40 席（剩 18）` |
| 49 `check:privacy-consent-e2e` | rc=1 | **rc=0** | 1-build 的下游 |
| 50 `check:landing-e2e` | rc=1 | rc=1（**同样 2 条**） | `first-run` 的 `<img>` 数期望 1 / 实量 0，15 passed。本批零改动 `apps/landing` 与 `e2e/landing` |
| 52 `check:web-storage` | rc=1（Port 4321）| **rc=0**（9s） | 🔴 **不是别人占端口，是链内前一段占的** —— 见 §9 第 3 条 |
| 53 `check:web-migration` | rc=1（Port 4322）| **rc=0**（9s） | 同上 |
| 56 `pnpm -r test` | **根本没跑**（编排漏了最后一步） | **rc=0** | 全绿；`apps/web` **1500 passed / 12 skipped**、`app-host` 1066、`local-api` 133、`ai` 223 |

⚠️ 第一轮那 4 条 `failed` 里，**只有一条是"查过归属"的**，其余三条是我看见 rc=1 之后
按"大概是环境问题"归的类。重跑之后它们的真因是同一个我自己的 build 错误。
📌 一般规律：**同一轮里的多条红要先做一次"共同上游"检查**（这里就是 `pnpm -r build` 的产物），
再看逐条归属；逐条归类会把一个缺陷拆成四个"别人的债"。

`-r test` 里那条 `reminders-panel` 超时（§7 第一轮的"未定性"）**本轮没有复现**。
样本 n=1 ⇒ 这**不是**"已排除"，只是"未复现"；排查序列仍然按 §7 末尾那三步走。

## 8. 本批"能失败"的六条变异（2026-10-03，逐条现量）

§5.3 那四次注入证的是**覆盖面门禁**会响；这一节证的是**六个新工具的行为判据**会响。
两者不互相替代：门禁只到"这个实体有没有读+写"，它响不了"提前 30 分钟落成了绝对时刻"。

台架与运行方式（写下来是因为它可复跑）：`/tmp/aicov-mut.mjs`，每条臂
"锚点必须唯一命中 1 次 ⇒ 备份 ⇒ 改 ⇒ 跑那一个 spec 文件 ⇒ 还原 ⇒ 逐字节比对"。
🔴 **开头那条"对照（未变异）"是承重的**：第一次跑这份脚本时六条臂全部报
"（无汇总行）"，看上去像"六条判据都没牙"，实际是 `execFileSync('npx', …)`
在这个工作树里找不到 `vitest`（二进制在 `packages/app-host/node_modules/.bin/`，
不在仓库根）。**没有那行对照，探针坏了与判据没牙在输出上长得一模一样。**

| # | 变异（拿掉的那条保护） | 落点 | 现量读数 |
|---|---|---|---|
| — | **对照**：不改任何源码跑 `local-api-host-new-entities.spec.ts` | 44 条 | `Tests 44 passed (44)` ⇒ 探针活着 |
| N1 | `set-task-tags` 的存在性校验只判墓碑、不判 `undefined` | 同上 | `1 failed \| 43 passed` —— 就是那条"悬空 id 报 `not-found` 且 message 点名它" |
| N2 | 打卡返回的 `entityId` 不再是 `habitLogId(习惯, 日期)` | 同上 | `2 failed \| 42 passed` —— "同一天重复打卡仍是同一条"和"结果说的就是那条记录"两条腿各红一次 |
| N3 | 「提前 N 分钟」把 `offsetMs` 传成固定 `0` | 同上 | `1 failed \| 43 passed` —— 钉 `offsetMs: 30*60_000` 的那条 |
| N4 | 🔴 **提案阶段就 `host.submit`**（"AI 一选中就落库"） | `ai-tool-proposal-all-writes.spec.ts` 38 条 | `19 failed \| 19 passed` —— 12 个写工具的"效果读数不变"各红一次，加上另几条走提案路径的 |
| N5 | 🔴 执行前的授权复查被拿掉（`isToolGranted` 恒真） | 同上 | `12 failed \| 26 passed` —— 恰好 12 条"未授权 ⇒ denied 且不写"，一条不多一条不少 |
| N6 | 出境白名单多搬一个 `color`（读侧越权） | `local-api-host-project-habit.spec.ts` 11 条 | `1 failed \| 10 passed` —— 就是那条"只出四个字段" |

🔴 **N4 的 19 与 N5 的 12 都符合预期，而且这两个数本身是判据**：
提案判据按 12 个写工具各一条（12 红）+ 另外几条走提案路径的 ⇒ 19；
授权判据恰好每个写工具一条 ⇒ 12。如果哪天变成"12 红 + 26 红"以外的组合，
说明那两条腿的**分母**漂了（比如加了第 13 个写工具却没加对应的授权用例）。

---

## 9. 本批补齐那六格时新查出来的四件事

§6 那四条是**写门禁过程**里的坑；这四条是**补齐实现**过程里的，而且每一条都还会复发。

1. 🔴 **我自己往同一个文件里插了两份 `const FOCUS_KIND_KEY`**（`apps/web/src/features/ai/AiToolRun.tsx`）。
   症状是 `pnpm -r build` 报 `TS2451: Cannot redeclare block-scoped variable`，
   而**第一轮我把它的三条下游红（journey / privacy-consent / web-storage）分别归给了别人**。
   ✅ 修法不是只删一份：两份的**类型注解不同**（`satisfies Record<string, MessageKey>` vs `as const`），
   前者的约束更强（拼错词条键编译期就报），所以留前者、把后者的注释里那句独有的理由搬过去。
   📌 一般规律：**同一个 Edit 类工具连续改一个文件，重复插入是最安静的一种坏** ——
   它不会让 diff 看起来"多了什么不该多的"，只会让下一次编译炸。
   改完两处以上同一文件，收尾应当跑一次**构建**而不是只跑测试（测试走转译，某些重复不报）。

2. 🔴 **"证明判据能红"的脚本自己坏了时，报出来的正是"判据没牙"** —— 见 §6 第 4 条。

3. 🟡 **`pnpm check` 链里 `check:landing-e2e` 会把 4321/4322 占住，
   于是后面两段（`check:web-storage` / `check:web-migration`）以 `Port ... is already in use` 收尾。**
   证据是同两条命令**单独跑各 rc=0（9s）**，而在整链里跑就是红 —— 与本批改动无关
   （我对 `apps/landing`、`e2e/landing`、那两个脚本零改动）。
   ⚠️ 这条**不是"环境问题"**，是链自己的一个泄漏：读红的人会把它们归给"别人占着端口"，
   于是这一对判据在整链里**永远不会被真跑过**。修法应当是那两段自己选空闲端口
   （或 `landing-e2e` 收尾时确认预览进程已退出），**不是**把这两段从链里摘掉。
   本批没修（不在这批的地界里），登记在这儿。

4. 🔴 **`packages/local-api/tests/tool-minimal-args.ts` 是一个不带 `.spec.` 的承重整文件**，
   而提交时最顺手的写法是"点名叫 `*.spec.ts`"。它被 `tool-pack-coverage.spec.ts`
   与 `tool-egress-fields.spec.ts` **两份判据共用**（文件头写了为什么不能各抄一份）。
   漏了它 ⇒ 干净检出上那两个 spec 直接 import 失败，而**在我这台机器上什么都不会红**。
   📌 一般规律：按"扩展名模式"点名路径之前，先跑一次 `git status --porcelain`
   把**全部**未跟踪文件过一遍，问一句"这里面有没有是被 import 的"。

## 10. 五条隐私不变量在本批结束时的状态（每条带现量命令）

这条清单存在的理由：Goal 写的是"全程不放宽"。**"没放宽"必须是一条能重跑的检查**，
否则它就只是提交信息里的一句话。

| 不变量 | 现量 | 读数 |
|---|---|---|
| AI 在类型上产不出 op | 本批没给 `packages/ai` 加任何写形状 | `check:ai-tools`（段 35）rc=0，它判的是"选择阶段出现 `.submit(` 就红" |
| 写只在一处、且在确认之后 | `ai-tool-run.ts:195` 一处 + MCP 入口 `local-api/src/server.ts:545` 一处（后者是既有的第二条**入站**通道，不是本批加的） | `check:ai-tools` 数出现次数 + 位置必须在 `confirmAiToolProposal` 之后；rc=0 |
| 逐工具默认关 | 22 个工具里 `defaultEnabled === true` 的 **0 个** | `node -e` 读 `packages/local-api/dist/index.js` 数出来的；另有 `local-api.spec.ts` 的默认值判据 |
| 出境逐字段披露 | 读 10 个各有非空 `egressFields`；写 12 个**全部是 `[]`** | `tool-egress-fields.spec.ts`（真实载荷对照，不比代码）+ 本批 §8 的 N6 变异证明它有牙 |
| 回退不跨越隐私边界 | 本批零改动 `packages/ai` 的路由与闸门 | 本批零改动 `packages/ai` 的供给模式与路由；`check:ai-coverage`（段 48）现量打印 `托管云 AI 仍被挡住（describeRetention('heyta-cloud') === undefined）` ⇒ `managed` 仍开不了 |

另外两条边界条件也未被跨越：`CURRENT_SCHEMA_VERSION` 仍是 **1**
（`packages/shared-schema/src/schema-version.ts:36`），本批**没有**给任何持久化模型加必填字段
（新增的六个 pack 全部只读既有实体 + 写既有 payload 形状）。

## 11. 合流态实测（2026-10-03，把 `main` 合进本批分支后逐段跑）

登记"合流后自然消失"是一句**断言**；这一节是它的**读数**。载体是一条**临时**分支，
本批那条分支（`1b7fdb5e`）与 `main` 都没被改动，**未 push**。

| 项 | 现量 |
|---|---|
| 合并载体 | 临时分支 `tmp/ai-cov-on-main` = 合并提交 `3ad21570`（父：本批 `1b7fdb5e` + `main` `a04753b6`）。🔴 **这不是载体现状**：同日又推进到 `9a0b368a`（修 §12 那条缺陷）→ `d910cf64` → `aed16522`（再合 `main` 6 笔，见 §12.2）；载体尖端要现量：`git -C /tmp/heyta-merge-check rev-parse --short tmp/ai-cov-on-main` |
| 落后量 | 合并前 `HEAD..main` = **76 笔**（同一句在 15:2x 再量已是 **82 笔** ⇒ 这个数只在这张表那一趟里有意义，往后一律用 `git rev-list --count feat/ai-entity-coverage..main` 现量） |
| 文件交集 | 本批改动 57 枚 / `main` 改动 127 枚 / 交集 **5 枚** |
| 真冲突 | **1 个文件 2 处**（`docs/plans/ai-assistant-closure.md` 的 D-3 两行）；其余 4 枚（ADR-0045、`docs/plans/README.md`、两份词条表）自动合并 |
| 词条表合并后 | `en.ts` / `zh-CN.ts` 各 **2847 键**、重复 **0**、两边键集差 **0 / 0** —— 这是"合并会不会把双语词条并坏"的判据，不是"看起来没红" |
| 链的段数 | 本批 **57 段** → 合并态 **61 段**（`main` 新增 `check:licenses:stamp` / `check:calendar` / `check:holiday` / `check:mobile-first-run-gate`）；本批的 `check:ai-coverage` 在第 **51** 段，**一段都没丢** |

### 11.1 逐段读数：61 段第一轮实跑 54 段全绿，余下 6 段后来补齐（见 §12 / §12.1）

`pnpm build` 先跑（rc=0，且 `packages/local-api/dist/index.js` 比 `src/tools/tag.ts` 新 158 秒
⇒ 后面读 dist 的那几道门禁证的是当前源码）。其余逐段 `NO_COLOR=1 pnpm <段>`，每段单独退出码
落 `/tmp/merge-gates.log`，末行自带分母对账：

- **54 段实跑，全部 rc=0**（第一轮 `SEGMENTS_RUN=30 GREEN=30 RED=0` +
  第二轮 `SEGMENTS_RUN=24 GREEN=24 RED=0`）—— 含 `check:ai-tools`（那五条隐私不变量）
  **盖着 `main` 的倒数日实现**跑绿，也含 `check:macos-window` / `check:arkts` /
  `check:mobile-bundle` / `screenshot:verify`。
- **未跑的 6 段与原因（不是遗漏）**：`check:ai-e2e`（它的 preflight 会 SIGKILL 别人的
  dev server ⇒ 本仓硬禁止）、`check:privacy-consent-e2e` / `check:landing-e2e` /
  `check:web-storage` / `check:web-migration`（都要起 dev server 抢端口）、`-r test`。
  现量现场：并行会话 `heyta-wt-closeout` 正在跑 `verify-mobile-repeat` + 一枚
  Playwright Chromium，`uptime` = `load averages: 18.11 / 16 核`。
  在这种负载下跑全量单测只会得到**无法归因的红**，所以留到窗口空闲再补，
  并把它算作"未测"而不是"通过"。
  → **这 6 段后来的读数在 §12（发现真缺陷）与 §12.1（修后全绿）**；本节以下凡写"未测"都只到
  2026-10-03 15:1x 之前为止。

三条"本批红过、合并态绿了"的对照，正是那句"分支落后所致"从推断升成实测：

| 段 | 本批分支上 | 合并态 | 合并态打印的分母 |
|---|---|---|---|
| `check:docs` | 🔴 4 条死链（全指向倒数日那三个文件） | ✅ **0 条** | 245 个 Markdown / 1590 个相对链接 / 429 处跨文档章节引用 / 54 处页内锚点 |
| `typecheck` | 🔴 2 条（`hosted-account-profile.spec.ts:138/156`） | ✅ 全包 `Done` | `main` 上那两条已由该文件的所有者自己修掉，不是本批改的 |
| `check:l4` | 🔴 内联样式 98 > 基线 90 | ✅ **恰在基线 90** | `apps/mobile/src/screens（L4 视图）：内联样式 90 处，恰在基线 90（未新增）` |

覆盖面门禁在合并态的读数与本批分支**逐字相同**：`实体覆盖面 8/8` /
`目录 22 个工具 ≤ 每实体 5 × 分母 8 = 40 席（已用 22，剩 18）`
⇒ "合流不会引爆任何一条 AI 门禁"这句现在是量出来的。

**对照基线（不是本批量的，但合并态要跟它比）**：并行会话在 `main` tip `a04753b6` 的干净检出上
把**整条 61 段链一次跑完**并记了逐包读数（2026-10-03 14:23–14:32，见
[`goal-multi-end-coverage.md`](goal-multi-end-coverage.md) §7.23）：
`FULL_CHECK_INNER_EXIT=0`，逐包 `web 1500 passed / 12 skipped` · `app-host 1303` ·
`mobile 538` · `node-host 165` · `desktop 12` · `server 2095 / 1 skipped`，零 failed。

🔴 **那个 `app-host 1303` 是一个角色错位的抄件，本批的量把它否证了（2026-10-03 收尾时实测）**：
合并态实测 `packages/app-host test: Tests 1072 passed (1072)` / `51 files`，
而 **`apps/landing test: Tests 1303 passed (1303)`** —— 1303 是 landing 的数，
`§7.23` 那一行根本没有列 landing。独立佐证（不需要跑测试的静态量，对三个 ref 各数一遍）：

```bash
for ref in main HEAD tmp/ai-cov-on-main; do
  git ls-tree -r --name-only $ref -- packages/app-host/tests | grep -E 'spec\.tsx?$' |
    while read f; do git show "$ref:$f" | grep -cE '^[[:space:]]*(it|test)(\.each|\.skip|\.only)?\('; done |
    awk -v r=$ref '{s+=$1} END {print r, "decls=" s+0}'
done
```

读数：`main 47 文件 / 928 条声明`、本批分支 `51 / 988`、合并态 `51 / 992`。
928 条声明在运行时因为 `it.each` 展开只会涨几十条（本分支 988 → 1067），**不可能涨到 1303**
⇒ 1303 从来不是 `app-host` 的数。**这条基线我当时是直接抄进本节的、没有换算来源，
所以它作为判据是不可用的**（值对得上不等于它就是那个角色；抄件要带它是哪一趟、哪个包的读数）。

比较判据随之改写（用本批自己量到的、角色对得上的两个数）：
**合并态 `app-host` 应 `≥` 本批分支的 `1067`（51 文件）且 `≥` `main` 的用例声明数 `928`**，
`web ≥ 1500`、`server ≥ 2095`、`mobile ≥ 538`、`node-host ≥ 165`、`desktop ≥ 12`，零 failed；
低于就是合并把某条线的用例弄丢了。**实测（修完 §12 那条缺陷之后，`tmp/ai-cov-on-main` @ `9a0b368a`）：
`app-host 1072 (51 files)` / `web 1500 | 12 skipped` / `server 2095 | 1 skipped` /
`mobile 538` / `node-host 165` / `desktop 12` / `landing 1303` / `ui 442` / `domain 821`，
21 个包全部 `Done`，`TEST_RC=0`，逐包汇总里 `failed` 出现 **0** 次** ——
文件数与声明数两边都 `≥`（`51 ≥ 47`、`992 ≥ 928`）⇒ **合流没有丢 `main` 侧的 app-host 用例**，
这条现在是量出来的，不是推的。
⚠️ **`§7.23` 那一行的更正要留给它的所有者做**（那是并行会话的单写者文档，我不代改他们的正文），
本批只在自己这份文档里把继承来的错误基线标死。

⇒ 上面那 6 段未跑的红/绿在这个基线之下**没有未知风险**（它们在 `a04753b6` 上是绿的），
本批欠的只是"合并态复跑一遍"这条腿。
✅ **这条腿已经补上了（同日 §12 / §12.1）**：6 段里 5 段实跑绿（`check:privacy-consent-e2e`
`7 passed` / `check:web-storage` / `check:web-migration` / `check:landing-e2e` `17 passed` /
`-r test` 见下），`-r test` **第一次跑红**、根因是真缺陷、修后**全绿**；
`check:ai-e2e` 这一段**仍然没跑，这是规则不是遗漏**（它的 preflight 会 SIGKILL 别人的 dev server），
它的用例是用直跑方式覆盖的（`3 passed`）。
⇒ 61 段的最终口径是 **60 段实测绿 + 1 段（`check:ai-e2e`）按硬规则不跑**，
不再写"55 段实跑、6 段未测"。
记成**未跑**而不是"通过"的那条只有 `check:ai-e2e` 本身。

> ⚠️ 同一条 §7.23 里还有一条**别误接**的读数：同一时刻在**主检出**跑 `check:docs` 是 exit 1，
> 7 处死链全指向并行会话**未跟踪**的新文档（`adr/0046-*`、`plans/trash-and-archive.md` 等），
> 而引用它们的三份文档自己也还没提交 ⇒ `HEAD` 不红、干净检出 exit 0。
> 结论：**`check:docs` 只能在干净检出或隔离 worktree 里量**，在主检出量到的是别人在飞的状态。

### 11.2 🔴 合流时要改的是**两处**，不是一处

本批原先只登记了 `countdown-anniversary.md:175`（「不在本批立这条门禁，后面再说」）
要在合流时就地更正。合并态读到 :168–:171 还有第二句，而且它比 :175 更误导：

> 「🔴 **这条没有门禁兜底，所以最容易整块漏掉。**…… `scripts/check-ai-coverage.mjs`
> **由 `AiFeature` 联合类型驱动**……加一个 `EVENT` 实体不会让任何一处变红。」

**这句在本批之后不再成立**：覆盖面那一节（`check-ai-coverage.mjs` §9）已由
`EntityModelMap` / `ENTITY_TYPES` 驱动，注入 D 的现量红是「实体 `EVENT` 在分母里，
AI 却**没有能读又能写**的工具（读 0 / 写 0）…」。它该改成"当时为什么这么判"保留原句、
结论指向 `AI-COV` 已接管（W2 落 `EVENT` 而不配工具 ⇒ 当场红）。
同一段里的"根治做法……这条要单独确认"也一并被否证 —— 根治做法已经存在。

⇒ 合流检查项从"改一行"改成"**按关键字全篇 grep 那个文件的旧说法**"，现量命令：

```bash
git show main:docs/plans/countdown-anniversary.md \
  | grep -n "没有门禁兜底\|后面再说\|要单独确认"
```

这是"同一个结论落在两份文档 ⇒ 改一处必漏另一处"的又一实例：`:175` 是登记到的，
`:168`–`:171` 是靠**把合并态整篇读一遍**才发现的，不是靠推理。

✅ **这条债已经在同日还掉（载体是合流那条临时分支，不是 `main`）**：更正块以
**纯插入**方式落在 `tmp/ai-cov-on-main` 的 `b2f2bbcc`（`git diff --numstat` 删除 **0**、
插入 18 行 —— 原文一字未删，过期说法留着并标"已过期"），合流态 `check:docs` **rc=0**
（1592 个相对链接 / 429 处章节引用 / 54 处页内锚点，新增那两个指向本文的链接都解析得到）。
⇒ 谁合流都不必再补这一笔；如果只 cherry-pick 本批分支的提交而不用这个合并态
（笔数现量：`git rev-list --count main..feat/ai-entity-coverage`，不写死），
`b2f2bbcc` 单独摘过去也行（它只动 `docs/plans/countdown-anniversary.md` 一枚文件）。

### 11.3 覆盖面门禁在合并态**仍有牙**（两条臂 + 基线 + 还原取证）

"合流没把门禁合坏"不能靠 `check:ai-coverage` 绿来证明 —— 一条恒绿的判据照样"绿"。
在合并态的 `3ad21570` 上重跑一次正向对照 + 两条注入（载体是临时分支，两份脚本事后逐字节还原）：

| 臂 | 注入 | 读数 |
|---|---|---|
| 基线 | 不动任何源码 | `对照（未变异）rc=0` —— 没有这一行，"两条臂都响"和"门根本没法跑"同形（见 §6.4） |
| 1 | 从剔除表删掉一枚"落库载体"，让 `AI_FEEDBACK` **进分母而它没有任何工具**（= `EVENT| W2 那一刻的形状） | rc=1，逐字：`1. 实体 `AI_FEEDBACK` 在分母里，AI 却**没有能读又能写**的工具（读 0 / 写 0），而 `ENTITY_COVERAGE_DEBT` 里也没有它。` |
| 2 | 往唯一豁免通道塞一个不在分母里的名字 | rc=1，逐字：`1. `ENTITY_COVERAGE_DEBT` 里有 `MEETING`，但它**已经不在分母里**了。` |
| 还原 | 两份脚本 `git checkout` 后复跑 | rc=0，且 `git status --porcelain` 对这两份**输出为空** |

⚠️ **臂 2 的夹具形状要记下来，否则下一个人会把它当成门禁的缺陷**：
台账条目的形状是 `{ gap: 'AI-COV-<n>', reason: '…（≥20 字）' }`，
我第一次写成了 `{ ticket, reason }` ⇒ 门禁那行 ℹ️ 打印出 `已登记缺口 1 项：MEETING=undefined`。
这不是判据坏了：**工单号形状那条检查只遍历"在分母里且未被覆盖"的实体**，
而 `MEETING` 不在分母 ⇒ 走的是 9c 那条，照样 rc=1。**没有一条畸形登记能悄悄过去** ——
这句已升级成读数（臂 3：往**已被覆盖**的 `HABIT` 上挂一条 `{ticket}` 形状的登记）：
rc=1，逐字 \`1. \`HABIT\` 现在**读和写都有工具**了，但 \`ENTITY_COVERAGE_DEBT\` 里还挂着它（工单 undefined）。\`
三条通道（不在分母 / 在分母且已覆盖 / 在分母未覆盖）各红一次，还原后 rc=0、`git status` 为空。
看到报错信息里出现 `undefined` 时，先查自己塞的形状，别去改判据。
现量脚本在 `/tmp/merged-teeth.mjs` 与 `/tmp/merged-teeth3.mjs`（一次性，不在仓库里）。

## 12. 🔴 合并态那唯一一条红**不是 flake** —— 每任务提醒上限可被并发写入整条突破

§11.1 欠的那条腿（"未跑的 6 段留到窗口空闲再补"）在窗口里跑完了一趟：
`/tmp/merge-final.log`，`STEPS_RUN=6 GREEN=5 RED=1 FINAL_EXIT=1`（现场 `loadavg1=9.04 / 16 核`，
阻塞 0 条）：

| # | 段 | rc | 打印 |
|---|---|---|---|
| 1 | `pnpm -r test` | 🔴 1 | `apps/web: tests/reminders-panel.spec.tsx (6 tests \| 1 failed) 2576ms` ⇒ `Test Files 1 failed \| 109 passed \| 2 skipped (112)` / `Tests 1 failed \| 1499 passed \| 12 skipped (1512)` |
| 2 | `check:privacy-consent-e2e` | ✅ 0 | `7 passed (7.9s)` |
| 3 | `check:web-storage` | ✅ 0 | —— |
| 4 | `check:web-migration` | ✅ 0 | —— |
| 5 | `check:landing-e2e` | ✅ 0 | `17 passed (1.0m)` |
| 6 | AI 的 e2e 用例（直跑，**不经** `check:ai-e2e`，那条会 SIGKILL 别人的 dev server） | ✅ 0 | `3 passed (14.3s)` |

第 1 段那条红的真身是一个**产品缺陷**，和 AI 这条线没有因果关系，只是在合并态那次跑里第一次被踩到。
修复落在本批分支的 `f2886e72`。

**取证序列（三段，顺序不能反）**

1. 合并态全量 `-r test`：`apps/web/tests/reminders-panel.spec.tsx` 一条红 ——
   `Error: 等待「超上限的错误被记下」超时`，附带 DOM 里 `6提醒10/3 15:58 待触发…`，
   读数 `Tests 1 failed | 1499 passed | 12 skipped (1512)`。
2. **单文件复跑 8 次：0 次复现**（其中一次 `loadavg` 现量 14.8，比案发时更高）。
   ⚠️ 到这一步极易写成"偶发/flake"——**"不复现"只是证据不足，不是排除**；
   要下环境归因就得把环境拿掉再跑一次，跑掉了才算，跑不掉就说明归因作废。
3. 摘掉 UI 层，直接对 `createReminder` 打探针（真 `SqliteAdapter` + 真 `NodeSqliteDriver(':memory:')`
   + 真 `OpLogEngine`，零 mock）：
   `PROBE 并发 8 次：成功 8 / 拒 0 / 物化存活 8 / 上限 5`，
   串行对照 `PROBE 串行 8 次：物化存活 5 / 拒 3`。
   ⇒ 上限在并发写入下**整条失效**，且不是竞态窗口小、是没有锁。

**根因**：`reminder-actions.ts` 里 `aliveOfTask(taskId).length >= MAX_REMINDERS_PER_TASK`
读的是**当前物化快照**，而 `ctx.dispatch` 把 op 落到物化状态是**异步**的 ⇒ 同一任务的并发调用
全部在旧快照上通过检查。界面表现为"渲染出 6 条而 `error` 是空的"，
所以那条用例只能等到自己的超时 —— 它断言的是"错误被记下"，而错误**永远不会**被记下。

**修法**（一层就够，且不碰任何不可逆层）：在 **`packages/app-host` 的动作层**加一条
**按任务分键**的写链，把「读存活数 → dispatch → 状态可见」排进同一次串行化里；
链跑完即摘，不留跨任务的常驻内存。`writeNew` 是唯一的上限检查点，
两个写入口 `createReminder`（`:238`）/ `createReminderBeforeDue`（`:250`）都经它 ⇒
一处覆盖全部写者（三条调用链：`apps/web/src/features/reminders/store.ts:90`、
`apps/mobile/src/lib/reminders.ts:152`、`packages/app-host/src/local-api-host.ts:849`，
后者同时是内置 AI 与入站 MCP 的路径）。
不 bump `CURRENT_SCHEMA_VERSION`、不加持久化字段、不动线协议，§10 那五条隐私不变量零变化。

**判据与变异**（新用例：`并发连点 8 次也不能突破上限`）

| 臂 | 动作 | 读数 |
|---|---|---|
| 基线 | 修复后跑 `tests/reminder-actions.spec.ts` | `24 passed (24)` |
| 变异 | `prev.then(fn, fn)` → `fn()`（排队摘掉，别的都不动） | **恰好 1 条红**，且就是那条：`expected 8 to be 5`；其余 23 条不受影响 |
| 还原 | `cp` 回原文件 | 与被改前 `cmp -s` **逐字节相同**，复跑 `24 passed`，`VITEST_RC=0` |
| 构建 | `pnpm --filter @heyta/app-host build`（含 DTS 阶段） | rc=0 —— 同一文件多处改动后必须跑构建，vitest 绿不算（§7 #162 那族） |
| 全包 | `packages/app-host` 整包 | `51 files / 1067 passed` |
| 用例方 | `apps/web` 那条原本红的面板用例 | `6 passed (6)` |

**三条可以迁移的结论**

1. **串行用例对上限类判据是全盲的**。一条"连点 8 次撞上限"的用例在串行下永远绿，
   它测的是"检查存在"，不是"上限成立"。判上限要判**并发下的上限**——
   这条和 AGENTS §7 #165 那一族（变异要配对的断言）是同一件事的另一面。
2. **"等某个错误被记下"这种断言，在竞态下会退化成一个纯超时**：界面渲染出的东西是对的
   （只是多了 1 条），`error` 却永远是 `undefined`，于是失败信息里一个字节都不提"超限"。
   写这类判据时把**数值判据**（存活数 ≤ 上限）放在前面，错误文案放在后面。
3. **先怀疑探针**在这条上反过来用了一次：探针自己没错，但它证明了"负载归因"是假的 ——
   `loadavg` 更高时**更不复现**，说明触发条件是 `Promise.allSettled` 式的并发提交，与环境无关。

⚠️ **待入 `docs/reference/environment-traps.md` 的登记**（不直接追加进那份文件：
它此刻正被并行会话改着，编号按工作树取而不是按 HEAD，往几百行的脏文件里插一段会被别人整文件
`git add` 抹回去）。建议条目：
**"上限/配额类判据必须并发提交才测得到 —— 串行连点 8 次撞上限的用例对 TOCTOU 全盲，
而它的失败形态是一个只等错误文案的超时"**，取证行 = 上面那三行 `PROBE` 读数 +
`expected 8 to be 5`。

⚠️ **合流后还有一件小账**：在合并载体重跑那 8 张 `apps/web/evidence/{assistant,tool-run}/*.png`
时它们与提交物**字节不同**（`1-disclosure.png` 工作树 199275 B vs 提交物 170217 B），
原因是合进来的 `main` 改了共享 UI。载体里已 `git checkout` 还原（证据不该被载体污染），
但**合流之后那 8 张需要重新生成并提交** —— 提交物现在是"本批分支状态"的截图，不是合并状态。

### 12.1 修后在合并态重跑 `-r test`：21 个包全绿、零 failed ⇒ 61 段的最终口径

载体 `tmp/ai-cov-on-main` @ `9a0b368a`（= `b2f2bbcc` + 本批分支 `f2886e72`），
`pnpm -r build` 后 `NO_COLOR=1 pnpm -r test`，退出码由脚本自己写进哨兵文件
（`BUILD_RC=0` / `TEST_RC=0` / `DONE`，不是包装命令的码）：

| 包 | 合并态读数 | 与 §11.1 那条基线的关系 |
|---|---|---|
| `apps/web` | `1500 passed \| 12 skipped (1512)` | **逐字等于**基线（那 1 条红没了，`failed` 计数 0） |
| `packages/app-host` | `1072 passed (1072)`，`51 files` | 基线那句 `1303` 已被 §11.1 否证（是 landing 的数）；本批分支自己是 `1067 / 51 files` ⇒ 合并态 `≥` 分支 |
| `apps/landing` | `1303 passed (1303)` | 1303 的真实归属就在这行 |
| `server` | `2095 passed \| 1 skipped (2096)`，`111 files` | 逐字等于基线 |
| `apps/mobile` / `node-host` / `desktop` | `538` / `165` / `12` | 逐字等于基线 |
| 其余 `packages/*` | `ui 442` · `domain 821` · `storage 314` · `design-system 489` · `sync-core 282` · `widget-core 193` · `ai 223` · `local-api 133` · `legal 59` · `shared-schema 80` · `sync-client 84` · `op-log 51` · `i18n 22` | 全 `Done`，零 failed |
| 汇总 | 21 个包 `test: Done`；逐包汇总行里 `failed` 出现 **0** 次 | —— |

⇒ **61 段链的最终口径（合并态）**：第一轮实跑 54 段绿（§11.1）+ `pnpm build` 绿 +
补跑 5 段绿（§12 那张表，其中 `-r test` 先红后绿）= **60 段实测绿**，
唯一没跑的 1 段是 `check:ai-e2e` —— **那是本仓硬规则（它的 preflight 会 SIGKILL 别人的 dev server），
不是遗漏**，它的用例以直跑方式覆盖了（`3 passed`）。
这一句现在对应 Goal ⑤ 的"逐段跑绿"，并且**每条读数都有载体的 SHA 与日志可复跑**。

**这一轮真正的教训（写在这里而不是只写在 commit message 里）**：
一条从别人文档抄来的"基线"如果没带它是**哪个包、哪一趟**的读数，它就不是判据，
而是一个会反过来指控你的数字 —— 我按 `app-host ≥ 1303` 去核对合并态，量到 1072，
第一反应是"合并丢了 231 条用例"（那会是一次很贵的误判：要去查三次合并冲突的解法）。
让人停下来的是 `apps/landing` 那一行**正好 1303**。
⇒ 从现在起本批写基线一律带 `(ref, 包名, 哪一趟, 退出码来源)` 四元组，
少一项就当"没有基线"，另配一条**静态可复算**的量（上面那段 `git ls-tree` + `git show | grep -c` 的脚本）。

### 12.2 `main` 在同一天又前进了 6 笔 ⇒ 重复合流一次，并把"跑到哪一层"如实分开

15:2x 现量：`git rev-list --count feat/ai-entity-coverage..main` = **82**（写这一句时是 82，
**这个数每天都在变，别把它当现状引用**；要现量就跑上面那条命令）。
新增的 6 笔里 4 笔是文档、2 笔动 `scripts/`（`verify-mobile-repeat.sh` + 新的 `mutate-closeout-gates.sh`），
其中 4 笔文档**动了 `docs/plans/countdown-anniversary.md`** —— 那正是 §11.2 那处更正落地的文件，
所以必须重复合流一次来确认更正没被顶掉。

载体 `tmp/ai-cov-on-main` 再合 `main` ⇒ **无冲突**（`Auto-merging docs/plans/countdown-anniversary.md`），
新 tip `aed16522`，链仍是 **61 段、`check:ai-coverage` 在第 51 段**。
就地核到的两件事：

| 判据 | 读数 |
|---|---|
| §11.2 那处更正还在不在 | ✅ 还在，`:163` 那行逐字为 `> ✅ **2026-10-03 同日、AI 那条线合流时的更正**（下面两处说法已过期；原文留着是为了让下一个人看清当时为什么这么判）：` —— 3 行新增的倒数日文档没有覆盖它 |
| 三条静态门禁在新 tip | `check:docs rc=0`（245 md / 1593 链接）· `check:ai-coverage rc=0`（覆盖面 8/8、22 工具 ≤ 40 席）· `check:ai-tools rc=0`（那五条隐私不变量 + 清单 `--check`） |

🔴 **这一趟刻意没跑的两条，写清楚而不是含混过去**：`pnpm -r test` 与 `pnpm -r typecheck`
**没有在 `aed16522` 上重跑**。原因是现场 `loadavg 15.27 / 16 核`，
而 `heyta-wt-closeout` 那条会话**正在跑 `verify-mobile-repeat`**（`pgrep` 现量到它的快照脚本 + 一枚 Gradle daemon），
另一个项目同时有 Chromium e2e 在跑 —— 按本文件 §11.1 与 §12 同一条纪律，
**在别人跑设备验收时加 CPU 负载，最坏的后果不是我这趟红，是他们那趟出现无法归因的红**（tap 超时那一类）。
⇒ 合并态 `-r test` 的绿是 **`9a0b368a`** 那一趟的读数（§12.1），
`aed16522` 只证到"静态三条 + 更正还在 + 链形状没变"。
窗口空闲时要补的那条命令：

```bash
cd /tmp/heyta-merge-check && NO_COLOR=1 pnpm -r build && NO_COLOR=1 pnpm -r test; echo "rc=$?"
# 判据（角色对得上的一组，见 §11.1）：web ≥ 1500、app-host ≥ 1072、server ≥ 2095、
# mobile ≥ 538、node-host ≥ 165、desktop ≥ 12，逐包汇总里 failed 出现 0 次
```

## 13. 收尾两笔：§12.2 那两条"刻意没跑"补上了，以及载体 ref 的一条更正

### 13.1 §12.2 欠的两条已有读数（载体 `1e9e898b`，2026-10-03 15:3x）

窗口打开后（现量 `loadavg 8.33 / 16 核`）在合并态补跑，两条**全绿**：

| 段 | 读数 |
|---|---|
| `pnpm -r typecheck` | `FINAL_RC=0`（退出码由命令自己写进日志，不是包装进程的）；全日志 `error TS` 命中 **0** 次 |
| `pnpm -r test` | **21 个包** `test: Done`；`web 1500 passed \| 12 skipped (1512)` · `app-host 1072` · `landing 1303` · `server 2095 \| 1 skipped (2096)`（`111 files`）· `mobile 538` · `node-host 165` · `desktop 12` · `ui 442` · `domain 821`；逐包汇总里 `failed` 出现 **0** 次 |

⇒ §12.2 那句"合并态 `-r test` 的绿是 `9a0b368a` 那一趟的读数，`aed16522` 只证到静态三条"**到此作废**：
最新合并尖端（含 `main` 那 6 笔）已经是全量绿。按 §11.1 的口径重述一次终局：
**61 段链 = 60 段实测绿 + 1 段（`check:ai-e2e`）按硬规则不跑、其用例直跑覆盖**。

### 13.2 🔴 更正：那几笔合并**不是**跑在分支 `tmp/ai-cov-on-main` 上，是跑在游离 HEAD 上

本文（与 §11 / §12）里凡写"临时分支 `tmp/ai-cov-on-main` = 合并提交 X"的句子，**指针是错的**：
`/tmp/heyta-merge-check` 这个 worktree 是 `--detach` 建的，所以 `3ad21570` 之后的
`9a0b368a` / `aed16522` / `1e9e898b` 三笔合并只移动了 `HEAD`，
分支 `tmp/ai-cov-on-main` 一直停在 `b2f2bbcc`。发现方式是现量：
`git worktree list` 打 `/private/tmp/heyta-merge-check 1e9e898b (detached HEAD)`，
而 `git for-each-ref refs/heads` 里那枚分支还是旧值。

影响面说清楚，不含混：

- ✅ **读数是真实的** —— 每趟跑的都是当时工作树里那份合并后的源码，
  `-r test` 与静态三条的结论**不因指针错而作废**；
- 🔴 **但那些 SHA 一度只有游离 HEAD 与 reflog 找得到** —— 对下一个读文档的人等于
  "证据不可复现"，而且 `git gc` 之后就真的消失了；
- 修法与核过：`git update-ref refs/heads/tmp/ai-cov-on-main 1e9e898b`，
  再 `git merge-base --is-ancestor` 逐枚验 `9a0b368a`、`aed16522` 都在该分支祖先链上（各真一次）
  ⇒ 三趟读数重新可寻址。

**一般形式**：验证跑完，归因写的是"哪一棵树"，那棵树**必须有一个名字**（分支 / tag / 远端）。
"我当时 checkout 到 X 跑绿了"不是证据，因为下一句"`git log X` 看它"可能已经无处可看。
探测器一行：`git worktree list | grep detached`。

---

## 14. W11 进了合并态，但那一趟的读数**没有落盘**（如实分开写）

W11（`complete_task` 的批量参数）落在本批分支 `a0df705e` + 文档 `74194e56`，
随后合进载体：

| 项 | 现量 |
|---|---|
| 载体尖端 | `deccbb35`（合并提交，父：`74194e56` + `main` 当时尖端） |
| 分支可寻址 | `git -C /tmp/heyta-merge-check rev-parse --short tmp/ai-cov-on-main` ⇒ `deccbb35`，与 `HEAD` **同尖** |
| 载体形态 | `git worktree list` 打 `detached HEAD` —— 但这次分支 ref 一起动了，所以 §13.2 那个坑没有复发（探测器仍要跑，不是"上次对了就不跑"） |

🔴 **当时那趟 `pnpm -r build && pnpm -r test` 的读数（build 零 `error TS`、
`local-api 146` / `app-host 1078` / `apps/web 1504 | 12` / 逐包 `failed` 0 处）
只存在于那次运行的输出里，日志文件已不在盘上**，而我另外更正一笔：
我在会话里报过载体 SHA 为 `deccbb34`，那是**手打的错值**，现量是 `deccbb35`。
所以这一节的口径是：**W11 在合并态"跑过一次并绿"，但那一趟现在不可复核。**

要把它变成可复核的读数，复现命令是（载体是临时分支，不改任何长期线）：

```bash
cd /tmp/heyta-merge-check && pnpm -r build && pnpm -r --filter '!@heyta/sync-server' test
```

**为什么当时没有复跑**：现场 `loadavg 23.27 / 16 核`、`free 11.9 GB / 64 GB`，
而并行会话正在用同一批设备与 e2e 载体 —— 按 §7 的负载门与
"等窗口期间连允许全量跑的重活都别起"，这一笔留成**待复跑**而不是绿。

## 15. 合并落定在长期线上，复跑的载体因此换了一个（2026-10-03 17:3x 现量）

§14 那趟的载体是临时分支 `deccbb35`（`/tmp/heyta-merge-check`，detached）。
现在三条分支已经合进**长期分支**，所以复跑不必再借临时检出：

| 项 | 现量（命令自证） |
|---|---|
| 载体 | `integrate/2026-10-03-closeout`，检出在 `/private/tmp/heyta-final` |
| 合并提交 | `3d357132`（并 `feat/ai-entity-coverage`）、`3d6aadd2`（并 `feat/assistant-history-local-persistence`） |
| 与 main 的关系 | `git rev-list --left-right --count main...fd34c42a` ⇒ **`0 31`**，即 main 是祖先、可直接落地、无冲突面 |
| 内容差集 | `main...dd8f2210` 的 62 个文件、`main...f2d7ed40` 的 14 个文件，对 `main...fd34c42a`（73 个）的差集都是 **0 条** ⇒ 两条分支的东西一个都没落在外面 |
| 链段数 | `fd34c42a` 的 `package.json` ⇒ **61** 段（主检出工作树是 62，多出的那段 `check:op-log-semantics` 是并行会话**未提交**的改动 —— 读数必须写明载体，同 §14 那个坑） |

🔴 **B36.2 由本条线收掉了**（`1a6640f2`），但收它之前先量清了归属：
`scripts/mutate-closeout-gates.sh` 的这 3 处**是同一缺陷的第二次** ——
`1ac5913a` 已经为这个文件把 4 处 `$var` 紧跟全角括号改成 `${var}`，
而 `cc974fbd`（10-03 14:40）新增的 V1/V2/V3 三条**失败证据行**又写回裸形式。
后果不是"门禁红"这么轻：那三行是**变异验证失败时打印读数的地方**，
变量名被非 ASCII 吞掉 ⇒ 判据说"没牙"的同时把牙印也抹掉了（对照组实测：
`V=abc; echo "「$V」"` 打成 `「`，`${V}` 打成 `「abc」`）。
改动只有 3 行、期望值字符串逐字未动、`bash -n` 过、门禁复跑扫 67 个 `.sh` 全绿。

**复跑命令（换成长期载体，日志必须落盘 —— §14 的教训是"跑过"和"可复核"是两件事）**：

```bash
cd /private/tmp/heyta-final && pnpm -r build 2>&1 | tee /tmp/intg-build.log
cd /private/tmp/heyta-final && pnpm -r typecheck 2>&1 | tee /tmp/intg-typecheck.log
cd /private/tmp/heyta-final && pnpm -r --filter '!@heyta/sync-server' test 2>&1 | tee /tmp/intg-test.log
# 61 段全链要单独等窗口：见下面那条端口纪律
cd /private/tmp/heyta-final/e2e && pnpm install   # 该检出没有 e2e/node_modules（实测），全链前要先装
```

🔴 **为什么"全链"和"build+test"要分两趟而不是并成一条**：
`check:ai-e2e` 的前置 `scripts/check-ai-e2e-preflight.mjs` 会对 **4318 / 4319**
（另两档传参 4320 / 4322）上**正在 LISTEN 的进程直接 SIGKILL**，
判据是 `lsof -ti tcp:<port> -sTCP:LISTEN` —— 它不区分那个 vite 是谁起的。
并行会话的界面验收正挂在同批端口与同批设备上时，跑全链**会把别人的那一趟打断**，
而那在他们那边长得像"界面自己坏了"。所以顺序固定：
① 负载门（单一所有者 `scripts/lib/wait-for-quiet-host.sh`，阈值 = 核数 × 3/4 = **12**，
等满 `HEYTA_LOAD_GATE_WAIT`（默认 900s）仍超 ⇒ `exit 3` 记成"环境无效"而不是产品失败）；
② `ps` 里**没有** `verify-mobile*` / `.snap.` / playwright 残留；
③ 才允许起 build+test，最后才起全链。

本节写下这些的时候现场是 `load 22`、`verify-mobile-notes.sh`（pid 75769）在跑、
`free 69%` ⇒ **② 尚未复跑**，这一笔仍是待复跑，不是绿。

### 15.1 复核五条红线时撞出来的一句过期范围（已就地勘误，非放宽）

红线第 2 条在 ADR-0045 §2.4 里写的是"**全仓** `host.submit` 恰好一处"。现量：**两处**非测试调用点 ——

| 落点 | 属于哪条路径 | 是否设计如此 |
|---|---|---|
| `packages/app-host/src/ai-tool-run.ts:195` | 内置 AI（确认函数体内） | ✅ 本条钉的就是它 |
| `packages/local-api/src/server.ts:545` | 入站本机 API / MCP | ✅ ADR-0011：显式 token + 逐工具授权后立刻执行（同文件 `:481` 那张表写明） |

而 `check:ai-tools` 的扫描范围也**不是全仓**：`scripts/check-ai-tools.mjs:52-56` 只扫
`packages/app-host/src/ai-tool-*.ts`，文件头明写"不搞全仓 grep（那会有太多假阳性）"。
⇒ 这句是**范围词写宽**，不是不变量被破：内置 AI 这条路依然产不出未经确认的写入。
已就地勘误三处并留原句（ADR-0045 §2.4 第 2 条、本文同批的 `ai-assistant-closure.md` 开头、
`dida-ai-assistant-gap-analysis.md` 的两行；顺带把那两行里 `ai-tool-run.ts:183` 这个**已漂的行号**
改成现量 `:191` —— W11 之后加的 8 行）。

🟡 **登记一条缺口（不在本批顺手做）**：想让"整仓的写入口只有这两个"变成常驻判据，
可以按**调用形状**枚举非测试的 `.submit(` 并断言集合恰好等于上面两枚。
🔴 不能按名字匹配：`apps/mobile/src/screens/ProfileScreen.tsx:367` 那个 `form.submit()`
是 HTML 表单提交，与写入无关 —— 按名字数会把无关调用点算进来，或者更糟，让人以为判据有牙。

### 15.2 五条红线的逐条读数（载体 `3eb38395`，每条都读了本体，不是"门禁没红"）

| 红线 | 读数 | 取证落点 |
|---|---|---|
| ① AI 类型上产不出 op | `AiSuggestion` 只有 `feature / text / destination / toolCalls`，**没有** `OpType`/`entityId`/向量时钟 | `packages/ai/src/provider.ts:128-142`（先确认声明找得到，再谈"命中 0"） |
| ② 写只能出自确认函数 | 内置路径 `.submit(` 一处，且在 `confirmAiToolProposal()` 之内 | `packages/app-host/src/ai-tool-run.ts:195`（声明在 `:191`）；入站那一处见 15.1 |
| ③ 逐工具默认关 | `isToolGranted` 的实现是 `grants?.[toolName] === true` ⇒ 缺省/`undefined` 一律 **false**（fail-closed 住在被调方本体里） | `packages/local-api/src/tools.ts:337-339` |
| ④ 出境逐字段披露 | `egressFields: readonly string[]` **没有 `?`** ⇒ 类型上必填；每个工具包都带了（`task.ts` 6 处、`note.ts` 4 处、`tag.ts` 3 处…） | `packages/local-api/src/tools/shared.ts:49` |
| ⑤ 回退不跨越隐私边界 | `fallback-needs-consent` 仍是**独立的失败原因**（不计入端点健康、不自动换目的地） | `packages/ai/src/routing.ts:289/339/375`、`provider.ts:166` |
| 不开托管 AI | `describeRetention('heyta-cloud') === undefined` ⇒ `assertEnableable()` 继续抛 | 门禁原样打印这条：`pnpm check:ai-coverage`（rc=0） |
| 不 bump schema | `CURRENT_SCHEMA_VERSION = 1`；且 `origin/main...HEAD` 里**零个** `shared-schema` 或 `server/prisma/migrations` 文件 | `packages/shared-schema/src/schema-version.ts:36` + `git diff --name-only origin/main...HEAD` |

覆盖面门禁在同一条载体上的完整读数：`5 个 AI 功能全部端到端可达`、
**实体覆盖面 8/8、已登记缺口 0 项**、`目录 22 个工具 ≤ 每实体 5 × 分母 8 = 40 席（已用 22，剩 18）`。
⚠️ 这些是**这一趟**的读数，不是长期基线 —— 抄进别的文档时请带上载体号（§14 那条教训）。

### 15.3 三条待入台账的（编号按**落地那一刻工作树的现量**取，不按 HEAD）

`docs/reference/environment-traps.md` 此刻在主检出是**脏的**（并行会话正在写），
所以这里只登记正文，不往那个文件里追加 —— 往几百行未提交的台账里插段，
下一笔 `git add <该文件>` 会把整段抹回去（本仓 2026-09-30 有过先例）。

1. **zsh 里未加引号的 `--include=*.ts` 会被 glob 展开**，报
   `no matches found: --include=*.ts`，整条命令**一个字都没执行**。
   最坏的形状不是报错而是**空测量**：把它接在 `| head`/`| wc -l` 后面时，
   屏幕上只剩一个 `0`，看起来像"确实没有"。本趟同一坑在两条独立命令上各咬一次。
   修法三选一：加引号（`--include='*.ts'`）、`sh -c '…'`、或直接上 Grep 工具。
   📌 与 #45/#77 同族：**命令失败与测量为零在输出上长得一模一样**。
2. 🔴 **陷阱台账里有四个号被两条完全不同的条目共用了**（主检出工作树现量）：
   `#38`（`:708` "一个常量当两种单位" vs `:779` "软键盘吞 tap"）、
   `#93`（`:2450` vs `:2889`）、`#94`（`:2491` vs `:2908`）、`#95`（`:2519` vs `:2940`）。
   ⇒ 全仓大量引用的形状是"§7 第 93 条"，**这种引用现在是歧义的**，而 AGENTS §7
   写的纪律是"编号只增不改" —— 撞号不是排版问题，是引用失效。
   可复跑的检测命令（只读，不改任何东西）：
   ```bash
   grep -nE '^[0-9]+\. 🔴' docs/reference/environment-traps.md \
     | awk -F: '{split($2,a,"."); print a[1], $1}' | sort -n \
     | awk '{c[$1]++; l[$1]=l[$1]" "$2} END{for(k in c) if(c[k]>1) print k, c[k], l[k]}' | sort -n
   ```
   ⚠️ 顺带纠正一个**容易误判的形状**：同一条 `grep -cE '^[0-9]+\. '`（AGENTS §7 头部给的现量命令）
   在工作树里读出 **189**，而最大条目号是 **180**，其中带 `🔴` 的是 **164**。
   这三个数各回答不同的问题，**没有一个是"条数"**：
   我第一趟把差额解释成"条目外还有别的顶格编号列表"，去读 `:115-123` 才发现
   那正是陷阱 **1–4 号本体** —— 那句话差点当成结论写进台账。
   真实来源是两件事混在一起：① 上面那四组撞号（同一号被两条条目各数一次）；
   ② 条目**内部**的顶格编号列表（实测 `:1991` 与 `:2144` 各有一段 `1. 2. 3.`，它们不带 `🔴`）。
   ⇒ **该报的是最大号 + 撞号组数**，而不是任何一个行数；
   `grep -c` 类"条数"句子在别的文档里出现时，先问它数的是哪一种形状。
   ⚠️ 重编号属于改别人的台账正文（且该文件此刻正被并行会话写着），
   **不在本批顺手做** —— 登记给产品负责人拍。
3. **"范围词写宽"的结论句**（§15.1 那一处）。可迁移的复核办法只有一句：
   判一条静态门禁管多大范围，**去读它的 `WATCH_DIR`/`WATCH_PREFIX` 定义**（本例
   `scripts/check-ai-tools.mjs:52-56`），别读结论句里那个"全仓"。
   结论句比门禁宽的时候，**漂的是句子**，门禁一直是对的。

### 15.4 Phase A 三段读数已复跑（载体 `6bee6854`，现尖 `9bc58afd`，代码同一）

先回答 §15 / §14 那两笔"待复跑"。复跑由 `/tmp/heyta-intg-verify.sh` 驱动：
负载门引用单一所有者（阈值 12），**实等了 8 轮**（`24 → 24 → 19 → 14 → 33 → 35 → 23 → 16`，
到 `12` 才放行），放行后又等对端残留清了 **5 轮 150s** 才开始 —— 这一段是"环境有效"的前提，
不是形式主义：它一起跑，别人那一趟就会被抢走 CPU。

| 段 | rc | 证据 |
|---|---|---|
| `pnpm -r build` | **0** | `build.log` 里 `error TS` **0 处** |
| `pnpm -r typecheck` | **0** | **19 个包** 各自 `Done`（含 `app-host` 的两个 tsconfig、`desktop` 的 main+renderer） |
| `pnpm -r --filter '!@heyta/sync-server' test` | **0** | `failed` 字样 **0 行**；逐包：`landing 1303` / `app-host 1078` / `mobile 538` / `node-host 165` / `apps/web 1530 passed + 12 skipped` / `desktop 12`，且 `ai / local-api / domain / op-log / i18n / shared-schema` **六个关键包各自都有 `Tests` 行**（不是"没跑所以没红"） |

🔴 **这条读数的边界必须写清，否则它会被读得比实际更硬**：
① 载体是 `6bee6854`，之后的 `3eb38395`/`9bc58afd` 是**纯文档**（`git diff --name-only 6bee6854..HEAD`
里非 `docs/` 的文件 **0 个**）⇒ 三段读数对现尖的**代码**成立，对文档改动不成立（那部分另有
`check:docs` rc=0 单独覆）；
② 这个隔离检出**之前已经构建过**（`dist/` 与 `.tsbuildinfo` 在盘上），所以 typecheck 用了 8 秒、
test 用了 37 秒是**增量缓存态**，不是冷启动全量。冷启动那一趟在同一条线的别的载体上跑过（§7.23 那条），
**这一趟不能替代它**；
③ 日志在 `/tmp/heyta-intg-173542/`（临时目录，**不入库**）。这一节把关键行抄进仓库就是为了
§14 那个坑不再复发一次 —— 但下次要"可复核"，落盘点应当进仓库而不是 `/tmp`。

**Phase B（61 段全链）**：`/tmp/heyta-intg-chain.sh` 已起，同样先过负载门与对端闸，
再 `cd e2e && pnpm install`（该检出**没有** `e2e/node_modules`，实测），最后才 `pnpm check`。
判据是脚本自己写的 `/tmp/heyta-intg-chain-*/check-rc.txt`，
**不是包装层的退出码**（traps #164：通知里的 `exit code 0` 属于包装命令）。

### 15.5 Windows 那条"硬判据"其实硬不起来 —— 三处各修一半，判据搬进单一所有者

③ 要求"Windows 段带 … + 自动创建快捷方式"。去读实现才发现**这条判据没有读者**：

| 事实 | 落点 | 后果 |
|---|---|---|
| `install-and-capture.ps1` 自己 `exit 1`（回读 `.lnk` 的 target 才算 `SHORTCUT_OK`） | 该文件 `:133` `:243` | 传不上来 —— **两层**都断：ssh 侧输出串了 `grep` 再串 `awk`，管道尾的 rc 覆盖掉远端 rc（`package-msix.sh:68-70`）；PS 侧是 `schtasks /it` 异步投进交互会话，父脚本只**读它写的取证文件**（`package-msix.ps1:266-280`），从不看 `LastTaskResult` |
| `package-msix.sh` 取回取证文件后**一条判据都不查** | `:78` `scp … || true` 之后直接往下走 | 装机失败、快捷方式没建成 ⇒ **rc=0** |
| `reinstall-all.sh` 有一份**四项**清单 | 原 `:246-255` | 新加的第五项（`SHORTCUT_OK`）只进了生成它的那一侧，读它的那一侧看不见 |

这正是本仓反复记的那一族：**"判据存在"与"有人判"是两件事**，而清单抄成两处就一定会漂。
修法是搬进单一所有者 `scripts/lib/msix-install-facts.sh`（`MSIX_REQUIRED_FACTS` 五条 + `msix_check_facts`），
`reinstall-all.sh` 与 `package-msix.sh` 都调它；打包脚本那一侧从"不判"改成"判不过 exit 1"。

**判据能失败吗 —— 四条夹具实测**（`/tmp/msix-fact-test.sh`）：

| 夹具 | rc | 报的那一条 |
|---|---|---|
| 五条齐 | **0** | `判据齐了：5 条全在位`（阳性对照在前） |
| 缺 `SHORTCUT_OK=True` | **1** | `缺判据：SHORTCUT_OK=True` |
| `RESULT=INSTALL_FAILED` | **1** | `缺判据：RESULT=OK` |
| 取证文件不存在 | **1** | `取证文件不存在：…`（以前这条路被 `|| true` 吞掉） |

⚠️ 中间我自己造过一次假读数并当场撤掉：外层 zsh 把内联 `bash -c "…; echo rc=$?"` 里的
`$?` **先展开成外层的状态**，于是四条全打印 `rc=0`。改成落成脚本文件再跑才是真读数
（同 §7 那条"双引号里的 pattern 会被命令替换"是一个形状）。
相关门禁复跑：`check:script-snapshot` / `check:shell-unicode` / `check:layering` /
`check:docs` / `check:journey-coverage` **各 rc=0**（载体 `26191c2e` 之后的工作树）。

### 15.6 落地清单：哪一步做完了、哪一步卡在谁手里（每条带现量命令）

**① 段数差集别再抄** —— "载体 61 段 / 主检出 62 段"这句话以后一定会漂，所以把**怎么量**留下：

```bash
node -e '
const fs=require("fs");
const list=(p)=>JSON.parse(fs.readFileSync(p,"utf8")).scripts.check.split("&&")
  .map(s=>s.trim().replace(/^pnpm /,"").split(" ")[0]);
const a=list(process.argv[2]), b=list(process.argv[3]);
console.log("载体="+a.length, "主检出="+b.length);
console.log("只在主检出:", b.filter(x=>!a.includes(x)).join(",")||"(无)");
console.log("只在载体:", a.filter(x=>!b.includes(x)).join(",")||"(无)");
' /private/tmp/heyta-final/package.json <主检出>/package.json
```

2026-10-03 17:5x 实跑：`载体=61 主检出=62`，
差集**只有一条** `check:op-log-semantics`（并行会话**未提交**的 `package.json` 改动），
载体侧零条独有 ⇒ 两边不是两套标准，只差那一段。

**①b `pnpm -r test` 的用例数也从盘上日志重量了**（Phase A 那份 `test.log`，
命令与 AGENTS 那条"沙箱里复现"的口径一致：`--filter '!@heyta/sync-server'`）。
🔴 数之前**先剥 ANSI**：vitest 的颜色码夹在 `Tests` 与数字之间，
`grep -E "Tests +[0-9]+ passed"` 在未剥色的日志上恒 0 —— 这就是 traps #163 的形状，
我第一趟正好踩出了那个"0 包"的空测量。

逐包（19 个包全有 summary 行）：

| 包 | passed | | 包 | passed |
|---|---:|---|---|---:|
| `apps/landing` | 1303 | | `packages/storage` | 314 |
| `apps/web` | 1530 (+12 skipped) | | `packages/sync-core` | 282 |
| `packages/app-host` | 1078 | | `packages/ai` | 223 |
| `packages/domain` | 828 | | `packages/widget-core` | 193 |
| `apps/mobile` | 538 | | `apps/node-host` | 165 |
| `packages/ui` | 442 | | `packages/local-api` | 146 |
| `packages/design-system` | 489 | | `packages/sync-client` | 84 |
| `packages/op-log` | 51 | | `packages/shared-schema` | 80 |
| `packages/legal` | 59 | | `packages/i18n` | 22 |
| | | | `apps/desktop` | 12 |

**合计 7839 passed / 12 skipped / 0 failed。**
⚠️ 因此 **AGENTS §6 那句"当前 2592 个通过 + 12 个跳过"已经过期到只剩三分之一不到**
（同一命令、同一 filter 量的）。改 `AGENTS.md` 属 §8 里"要用户明确要求"那一类，
所以这里只登记读数与现量命令，**不代改**。
📌 上面这张表**逐包复核过**：用一个独立解析器把 `test.log` 里的 19 行 summary
重新抽出来，与表内 19 条**逐一相等**、合计同为 7839、failed 行 0 条。
第一版解析器按 `> <pkg> test` 找包名，**匹配 0 行**（实际形状是
`<pkg> test:      Tests  N passed`）—— 又是一次"空测量看着最干净"，
所以判"表没问题"之前先要证明解析器能抓到已知存在的行。

**② `PROGRESS.md` / `BLOCKED.md` 这一轮的"逐条打勾"没有做**，不是忘了，是不该在此刻做：
主检出里这两份**正被别人写着**（实测 `git status --porcelain` 对两者都回 `M`），
而共享工作树里整文件提交会把对方未提交的段落**抹回 HEAD**（本仓 2026-09-30 有先例，
记在项目记忆里）。所以本条线的收口全部写在这份**单写者**文档里（§15）。
留给落地那一刻的命令（先把两边都读出来，再逐段并入，不整文件覆盖）：

```bash
git status --porcelain -- PROGRESS.md BLOCKED.md   # 必须是空才动
```

**③ 落到本地 main 同样等窗口**：`integrate/2026-10-03-closeout` 是 main 的**后代**
（`git rev-list --left-right --count main...载体` ⇒ `0 31`，现尖更长），
所以落地是一次快进、没有冲突面 —— 但主检出**就是** `main` 的检出，
移动这个 ref 会让并行会话的工作树相对新 HEAD 变成"一堆未提交改动"，
他们那一趟的读数会因此变红。等他们的验收都停了再动，且用 `--only` 逐路径、不 push。

**④ push 与生产部署**：按本 Goal 的红线属共享状态动作，**没有当前明确授权不执行**。

---

### 15.7 Phase B 那条红 `check:ai-e2e`：归因到"两趟共用 4318/4319"，不是产品坏了（单窗口复验在跑）

先给读数（只认 summary 行与退出码）：

| 项 | 读数 | 出处 |
|---|---|---|
| 载体 | `5fe19343` | `/tmp/heyta-intg-chain-175109/runner.log` |
| 整链 | `rc=1`（17:59:39） | `check-rc.txt` |
| 失败段 | `check:ai-e2e`（链在这里退出码 1 就断了） | `check.log` 末 6 行：两条 `[ELIFECYCLE]` |
| e2e summary | **2 failed / 2 flaky / 2 skipped / 111 passed (5.8m)** | `check.clean.log:1589` 附近 |
| failed 两条 | `ai-duration.spec.ts:36` 与 `:92`，各带 `retry #1` | 同上 `:1206-1209` |
| 报错原文 | 「不应该发出任何模型请求，实际收到：[...]」，`Expected: 0 / Received: 1`，落在 `helpers.ts:103` | `:1352-1450` |
| flaky 两条 | `ai-capture.spec.ts:50`、`ai-prioritize.spec.ts:50`（都是"等假端点收到精确次数"的那族） | `:1590-1591` |

🔴 **"链上只有 e2e 一段红"这句话是错的，正确的说法是"链断在 e2e"**。
`pnpm check` 是一条 `&&` 串（段序见日志第 1 行的整条回显），`check:ai-e2e` 之后还排着
`check:privacy-consent-e2e`、`check:landing-e2e`、`check:shell-unicode`、`check:web-storage`、
`check:web-migration`、`check:script-snapshot`、`check:mobile-first-run-gate`、
`screenshot:verify`、`pnpm -r test` 九段。`&&` 的短路语义决定了前一枚退出 1 之后的段
**不可能执行**，日志尾部正是两条 `[ELIFECYCLE] Command failed with exit code 1`；
直接证据另有一条：`privacy-consent-zero-egress` 这个用例名在整份日志里 **0 命中**。
⚠️ 我第一版取证用的是"段名在日志里出现几次"，结果**每段都只出现 1 次**（包括确实跑过的
`check:layering`）—— 因为只有整条命令被回显一次，各段自己的输出里不一定带段名。
那个探针证明不了任何事（§7 元规则 1：先怀疑探针），所以这里的论据换成上面那三条。
⇒ 载体 `5fe19343` 上**没有**这九段的读数（`-r test` 另有 Phase A 的独立读数 7839，
但那不等价于链里那一段），要覆盖它们只能等合并态那一趟跑完。
这条更正本身就是"读数要写明跑到哪一层"（§12.2 立过的规矩）的又一次违反，
所以我把它写在读数表下面而不是注释里。

**为什么判定是两趟并发共用同一对端口，而不是产品缺陷** —— 四段代码读数 + 一条只有并发能解释的现象：

1. `e2e/tests/helpers.ts:36` 把假端点写死成 `http://127.0.0.1:4319`；
   `e2e/stub-provider.mjs:33` 虽然有 `STUB_PORT` 环境变量，但 **helpers 与
   `playwright.config.ts` 都不读它** ⇒ 并发两趟**没有端口隔离**，只能抢同一个进程。
2. `playwright.config.ts:29 / :50` 是 `fullyParallel: false` + `workers: 1`
   ⇒ **同一趟内部不存在"两个 worker 互相污染计数"** 这条路。计数被污染只能来自进程外。
3. 计数是**假端点进程里的一份全局账**（`tests/helpers.ts:68-73` 的注释自己写着
   "整个测试运行只启动一次，所以它是跨用例共享的"，靠每条用例开头 `resetStub` 清零）。
4. `scripts/check-ai-e2e-preflight.mjs:37 / :83`：起 e2e 前把**任何**监听
   4318/4319 的进程 `SIGKILL` —— 它按端口杀，**不认是谁的**。
   时间线实测：我的 e2e 窗口开在 17:52:09，对方（主检出）`pnpm check` pid 20014
   起于 17:50:49、其 `check:ai-e2e` pid 37239 起于 **17:53:25**。
   ⇒ 对方的 preflight 把我的 stub/vite 杀了并绑上自己的，我那趟之后的
   `GET /__requests` 读的就是**对方那趟的账**。

只有并发能解释的那一条：同一条用例 `ai-duration:36` 第一次看到的是
`feature:"breakdown"`，`retry #1` 看到的是 `feature:"capture"`。重试**只重跑这一条**，
而我那趟里 `ai-breakdown`/`ai-capture` 早已跑完（单 worker、顺序确定）——
"上一族的在途请求"解释不了两次不同的特征，更解释不了第二次那条是**更晚**的族；
能解释的只有"另有一趟正在按自己的顺序往前走"。

🔴 **不许套用旁边那句现成的解释**：`playwright.config.ts:39` 写着
`ai-duration:36` 是"前一族把它拖慢而偶发超时"的已知负载型 flake。
那说的是**超时**；这次的报错是**多收到一次模型请求**，形状不同。
把这条红登记成"已知 flake"就是拿标签代替读数。

**对称风险，如实披露**：我那趟 17:52:09 的 preflight 同样按端口杀过
4318/4319 上的进程 —— 也就是**我很可能打断了对方的验收**，
而不只是"对方的验收脏了我"。这是 traps #87 的第二张面孔：#87 记的是"抢别人的 dev server"，
这里被抢的是**带着计数的那份假端点**，后果从"白跑一趟"升级成"报出一条不属于任何产品的红"。

**决定性复验（这才是判据，上面只是归因）**：单窗口重跑，闸门比之前更硬 ——
不仅过负载门，还要求 `ps` 里**没有别人的** `bin/pnpm check` / `check:ai-e2e` /
`check:privacy-consent-e2e` / `check:landing-e2e` 才起跑：

```bash
bash /tmp/heyta-e2e-alone.sh    # 载体见 $OUT/runner.log；读数 $OUT/e2e.log + $OUT/rc.txt
```

- 若 `rc=0` ⇒ 记"链上那条红 = 并发共用假端点的计数污染"，本条闭环；
- 若仍红 ⇒ 它是**真缺陷**，在载体上直接修 `ai-duration.spec.ts:36/:92`，不改判据。

**结构性修法（登记，本轮不做）**：让 `STUB_ORIGIN`/`baseURL`/preflight 端口都从
`STUB_PORT`/`WEB_PORT` 取（默认值保持 4319/4318 不变），并发两趟就能各起一套、
既不互相 `SIGKILL` 也不共读一份计数。没在此刻做的理由：这三处是**三个并行会话都在跑的
共享 e2e 基础设施**，改它属于跨条线动作，而本 Goal 的四件事不含它；且改完必须
用"同时起两趟"来证明它真的有牙，否则只是把常量换了个来源。

**待入 traps（编号按落地那一刻工作树的现量取，不凭 HEAD 猜）**：上面第 1–4 条读数
是独立于 #87 的一条 —— 症状不是"白跑一趟"，而是**报出一条不属于任何产品的红**，
且同一条用例两次尝试里的外插特征不同（`breakdown` → `capture`）是它的识别指纹。
现量命令与**两份分别的读数**（同一命令在两个载体上不一样，写在一起会漂）：

```bash
grep -cE '^[0-9]+\. ' docs/reference/environment-traps.md
```

- 载体 `c3fe9cc0`（本隔离检出）：**186** 行顶格编号，最大号 **177**；
- 主检出（并行会话的工作树，正被写着）：**189** 条顶格编号（19:0x 复测仍是 189，最大号已到 **180**）。
  🔴 这两个数是**会漂的**，别当基线引用 —— 要现量就跑：
  `grep -cE '^[0-9]+\. ' docs/reference/environment-traps.md`（条数）与
  `grep -oE '^[0-9]+\. ' docs/reference/environment-traps.md | tr -d '. ' | sort -n | tail -1`（最大号）。

⇒ 新条目落地时**必须在主检出现量重取**，别拿这两个数中的任何一个直接当"下一个号"。
另外 §15.3 记的 #38/#93/#94/#95 四处重号也一并处理。

### 15.8 落地那一刻 main 又前进了，所以"落地"从快进变成一次带对账的合并（2026-10-03 18:2x 现量）

§15.6 ③ 那句"是 main 的后代 ⇒ 快进"到 18:1x 过期：并行会话又往 main 落了一笔
`192a516d`（清单/标签/习惯的改名与删除，两端界面 + `packages/app-host` 动作层 + i18n 词条）。
现量 `git rev-list --left-right --count main...载体` = **`1 40`**。
所以顺序换成：**先把 main 并进本线 → 全链复跑 → 重装 → 再快进 main**。

**并之前先做零风险预演**：`git merge-tree --write-tree HEAD main`（不动工作树）回一棵 tree、
**零冲突**；两侧改动文件集合的交集**只有** `packages/i18n/src/locales/{zh-CN,en}.ts`
（`comm -12` 于 `git diff --name-only main...HEAD` 与 `git show --name-only 192a516d`）。

**交集那份必须逐条对账 —— "没冲突"挡不住重复键静默取后者**，那是 git 看不见、只有语义层知道的失败形状：

| 参照点 | zh 键数 | en 键数 | 重复键 | 单边键 |
|---|---:|---:|---:|---:|
| 本线 `a1ef4d9a` | 2850 | 2850 | 0 | 0 |
| 对方那笔 `192a516d` | 2841 | 2841 | 0 | 0 |
| 预演那棵 tree `b08b020c` | 2860 | 2860 | 0 | 0 |

算术闭合：`2850 + 10 = 2860` 且 `2841 + 19 = 2860` ⇒ 两边新增**都在**，没有一条被顶掉。
旁证用别人写的门禁而不是我自己的解析器：`pnpm check:ui-language` 自己打印
"词条表 zh-CN 2850 条 / en 2850 条"，与本线读数逐字相等。
⚠️ 我第一版正则写成 `^(?:'[^']+')\s*:`，**漏了闭合引号** ⇒ 三个参照点**全部 0 命中**。
"三份都是 0"看着最干净，其实是探针坏（§7 元规则 1）。

**合并落地 = `b6294ef0`**（父 `a1ef4d9a` + `192a516d`），三条核对全过：
合并后的 tree **与预演那棵 `b08b020c` 逐字节相同**；合并后 `git status --porcelain` 为空；
合并态 i18n 再量一次 **2860 / 2860，重复 0、单边 0**。

**五条红线在合并态复测**（读本体，不是转述"门禁没红"）：合并 delta 的 19 个文件里
**没有一条住在隐私路径上** —— 命令与判读：

```bash
git diff --name-only a1ef4d9a b6294ef0 | grep -E "packages/(ai|local-api|app-host)/src|shared-schema|credential"
```

`CURRENT_SCHEMA_VERSION = 1` 未 bump（`packages/shared-schema/src/schema-version.ts:36`）；
`host.submit(` 的**非测试调用点恰好 2 处**（`packages/app-host/src/ai-tool-run.ts:195` 走用户确认、
`packages/local-api/src/server.ts:545` 是入站那两条中的一条，按 ADR-0011 逐工具授权）——
其余命中全在注释与表格里，按调用形状数不进去；`retention-undecided` 抛出点 4 处
（`packages/ai/src/supply.ts`，`managed` 仍被挡着）、`fallback-needs-consent` 6 处
（回退不跨越隐私边界那条仍在）、逐工具默认关的判定仍在 `packages/local-api/src/tools.ts:338`
（`grants?.[toolName] === true` —— 没写进授权表就是不给）。
载体上单跑的便宜门禁：`check:ai-coverage` / `check:ai-tools` / `check:layering` / `check:ui-language` 全 rc=0。

**顺带查出三处文档漂移（属 `AGENTS.md`，按 §8 要用户点头才改，只登记不代改）**：
`AGENTS.md:35` 把 `packages/app-host` 的 AI 工具路径列成两个文件，树上是**三个** ——
多出的 `ai-tool-call.ts` 是"**模型路径单步调用**"那一层，它的文件头钉的是顺序：
先 `resolveToolSelection()`（纯规则、本机、零出境），只有规则给 `no-match` / `ambiguous`
才把话发给模型。漏列它的代价不是排版，是那句"能在本机定下来的事不送端点"在地图上找不到落点；
`AGENTS.md:37` 的 `packages/local-api/`
那行没提工具目录**已按实体拆包**（`src/tools/` 现在 11 个文件）；
`AGENTS.md:295` 那句"当前 2592 个通过 + 12 个跳过"实际是 **7839 / 12**（§15.6 ①b 的现量命令同一条）。

全链与四端重装的读数在 §15.9（下一条提交，等那两趟跑完填数）。
### 15.9 合并态全链读数：载体那行 SHA 我自己写错了一笔，而这条红不在我线上（三条证据 + 人眼看图）

**读数（只认 summary 行与退出码；日志 `/tmp/heyta-merge-verify-181502/`）**

| 段 | 载体 | 读数 |
|---|---|---|
| 合并 main@`1694b7d0` 进集成线 | — | `merge-rc.txt` = **0** |
| `pnpm build` | `10dc0bd4` | `build-rc.txt` = **0** |
| `pnpm check`（61 段） | `10dc0bd4` | `check-rc.txt` = **1**，断在第 51 段 `check:ai-e2e`：`3 failed / 2 skipped / 112 passed (6.6m)`；第 0–50 段全绿（`check:layering` 327 文件 9 规则、`check:ui-language` zh-CN 2860 / en 2860、`check:ai-coverage` 覆盖面 8/8 + 目录 22 工具 ≤ 40 席 都在链日志里） |

🔴 **先更正我自己的一行**：runner 在 18:20:22 打印 `合并后 carrier=b6294ef0`，可链的 build 是 18:34:11、check 是 18:35:11 起跑的，中间落了 `db12dd18`(18:26:52) 与 `10dc0bd4`(18:32:38) 两笔 docs 提交 ⇒ 这条读数的载体是 **`10dc0bd4`**。两笔都是文档，`git rev-parse b6294ef0:packages/ui` 与 `10dc0bd4:packages/ui` 是同一个 tree，代码结论不变 —— 但**"打印过的 SHA"不等于"运行时的 SHA"**，而这一批的要求恰恰是读数必须写明载体。错在打印时机，不在结论。

**三条红，两种性质**

1. `sidebar-resize.spec.ts:132`（两个 attempt 都是）：`page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:4318/?lang=zh-CN`（抛出点 `e2e/tests/helpers.ts:291`），208 ms / 212 ms 就回 —— 不是超时，是**载体没了**。对端整链 18:40:24 起跑、其 e2e 18:42:53 到，而 preflight 是**按端口不按归属**SIGKILL（`scripts/check-ai-e2e-preflight.mjs:37` `DEFAULT_PORTS=[4318,4319]`、`:83` `process.kill(pid,'SIGKILL')`）。⇒ §7 #87 的第二面，环境无效。
2. `calendar-sidebar.spec.ts:111` 与 `:226`：红在 `calendar-sidebar.spec.ts:86` 的 `expect(sidebar.getByText(LIST, { exact: true })).toBeVisible()` ⇒ `Received: hidden`，两个 attempt 同一句 ⇒ **确定性**，不是抖动。

**第 2 条在 main 侧，不在集成线上（三条互相独立的证据）**

- **a 树同一性**（零成本、比复跑更硬）：`git rev-parse 10dc0bd4:packages/ui` == `git rev-parse 1694b7d0:packages/ui` == `47513f2e…`；我那 40 笔提交在 `packages/ui/` 下**零文件**。被测组件是 main 的字节，不是我改过的副本。
- **b 配对 A/B**（同一套 117 条用例）：载体 `792f9b2d`（尚未并 `192a516d`）18:00:57 单跑 `check:ai-e2e` ⇒ `rc=0 / 115 passed / 2 skipped / 0 failed`；并进来之后 ⇒ `112 + 3 = 115`。总数相等证明是同一套用例，差集恰是这两条。
- **c 所有者自己在飞**：主检出 `packages/ui/src/projects/OrganizerList.tsx` 的**未提交** diff 里有一句自证 —— "Let the action group move as one unit instead of **shrinking the name down to a zero-width flex item**"，配套 `minWidth: tokens['touch-target.min']`。机制就是 `192a516d` 给每行新加的四个动作按钮（色槽 / 重命名 / 归档 / 删除，见 `error-context.md` 的 a11y 快照第 62–68 行五个 button）把名字挤成零宽 flex item。

**人眼看图**（§6.2 规定一第 4 条，真的打开了 `e2e/test-results/calendar-sidebar-迷你月历…-chromium/test-failed-1.png`）：侧栏「清单」区那一行显示的是 placeholder **「新清单」+ ✓**，刚创建的清单名**读不出来**，它下面一行是四个动作图标。所以这不是"用例太严"，是**界面上真的看不见那行名字** —— 一条真产品缺陷，只是它不归这条线修。

**证据 c 后来升级成了实测**（同一台机器上顺手的免费对照）：主检出带着那笔**未提交**的修复（`OrganizerList.tsx` 里 `minWidth` 命中 2 处、"zero-width" 注释 1 处）跑整链时，这两条用例是 **✓ 35 / ✓ 36 全过**，其 e2e 段汇总 `124 passed / 2 skipped / 0 failed`（日志 `/tmp/heyta-aed-check-final6.log:1243-1244`，载体 = 主检出工作树 18:5x，非干净检出）。所以关闭判据不是"等一个可能管用的改法"，而是**那条改法已经被这两条用例自己验过一遍**。

**不代改的理由 + 关闭判据**：`git status --porcelain -- packages/ui` 此刻 10 个 `M`，`OrganizerList.tsx` 正脏着，而 `packages/ui` 是并行会话 W5/W6/W8 的落点。等他们提交后由我复跑：

```bash
cd /private/tmp/heyta-final && git merge --no-edit main && pnpm build && pnpm check:ai-e2e
# 期望：115 passed / 0 failed / 2 skipped（同一套 117 条）
```

**其后九段第二次从未执行** —— `&&` 链断在 51 段，52..60（`privacy-consent-e2e`、`landing-e2e`、`shell-unicode`、`web-storage`、`web-migration`、`script-snapshot`、`mobile-first-run-gate`、`screenshot:verify`、`-r test`）没有读数。这次不再等整链重跑，而是把那九段在载体 `10dc0bd4` 上**逐段**补齐：每段各过一道"对端清空 + 负载门"（单一所有者 `scripts/lib/wait-for-quiet-host.sh`，本机阈值 12），被闸门挡下的记 **rc=3 = 环境无效**，不折成 1。读数落 `/tmp/heyta-tail-segs-185511/rc-<段号>-<段名>.txt`，汇总 `tally.txt`。

**一条结论提前说清**：只要 main 带着 organizer 那条红，`pnpm check` **全链绿**在这条集成线上是结构上不可达的。按红线不吸收别人的债凑绿、不为跑绿放宽闸门 ⇒ ② 的完成态改写成「段 0–50 绿 + 段 51 挂上游关闭判据 + 段 52–60 逐段读数」，而不是"链绿"。

**顺带一条反方向的：链的第 54 段 `check:shell-unicode` 在 main 上是红的，而本线已经修好了它。**

- main 提交态 `scripts/mutate-closeout-gates.sh:223/232/242` 三处 `「$V1」` 被全角括号吞掉变量名：
  `git show main:scripts/mutate-closeout-gates.sh | LC_ALL=C grep -cE '\$V[123][」』]'` = **3**。
- 本线 `1a6640f2`（17:30，`git merge-base --is-ancestor 1a6640f2 HEAD` = YES）改成 `${V1}` 形状，
  载体上同一条命令 = **0**，`pnpm check:shell-unicode` rc=0（扫 68 个 `.sh`）。
- 这是**同一个缺陷的第二次**（`1ac5913a` 修过 4 处、`cc974fbd` 又写出 3 处），而 `check:shell-unicode`
  是**每一次 `pnpm check` 都会跑**的那一段 ⇒ 落地本线会让 main 的第 54 段从红变绿。
- 实测对照就在眼前：主检出 18:4x 那一趟整链 **e2e 段 `124 passed / 0 failed` 过了、死在第 54 段**
  （`/tmp/heyta-aed-check-final6.log` 末尾 `Command failed with exit code 1`）。

**段 52–60 的读数进度（载体 `861f4f3a`，代码树与 `10dc0bd4` 逐目录同一：`packages` `475e69b7` /
`apps` `459ac9db` / `scripts` `405152ca` / `server` `68843bda` / `e2e` `b10a7c01`，差集只有一行 docs）**

| 段 | 读数 | 跑法 |
|---|---|---|
| 54 `check:shell-unicode` | **rc=0**（扫 68 个 `.sh`） | 单跑 |
| 57 `check:script-snapshot` | **rc=0**（自快照 bootstrap 30 个脚本 + `.gitignore` 全在位） | 单跑 |
| 59 `screenshot:verify` | **rc=0**（注册表 23 个目标，已生成的尺寸正确、无 alpha、非空白） | 单跑 |
| 52 / 53 / 55 / 56 / 58 / 60 | 待补 | `/tmp/heyta-tail-segs-185511`（对端清空 + 负载门各段各过一道） |

 **为什么这三段允许在负载门外单跑**（写清楚，免得被读成放宽闸门）：它们的判据是**静态文本 / 文件属性**
（`node scripts/check-shell-unicode-vars.mjs`、`check-script-snapshot.mjs`、`screenshots/verify-artifacts.mjs`），
结论不随宿主机时序变化；而负载门的适用对象是**设备与截图时序**那一类（traps #168 的起因就是
`uiautomator dump` 在 load 62 时抓不到界面）。剩下六段里 52/53/55/56 走真浏览器、58 走设备、60 是全量测试，
**全部留在闸门后面**，一条都不提前跑。此刻 `vm.loadavg` 1 分钟 = **200.62**（并行会话多趟整链同跑），
等窗口是正常状态，不是卡住。

### 15.10 ④ 已落进载体（`a90b7627`），而 ① 的障碍量成了 13 条**逐 blob 不同**的路径

**④ 台账**：`PROGRESS.md` 新增「AI 覆盖面收口」一节（四项各带载体的读数），`BLOCKED.md` 里
`B36` 第 2 条挂了闭合指针（`1a6640f2`，带一对现量命令：修复前形态 = 3 / 载体 = 0），
并新立 **`B56`** 记那条挂上游的 organizer 零宽红。两道 markdown 门禁 `check:docs` / `check:docs-voice`
各 **rc=0**；`check:ui-language` 不管根目录台账，所以没跑它算数。

**① 落地的真实障碍，量法要改。** 先前只报"主检出 220 个脏文件、13 个与本线重叠"——那还是**间接**证据。
逐条比 blob 之后：13 条重叠路径里 **13 条**的内容是**三方互不相同**
（`git rev-parse HEAD:<f>` ≠ `git rev-parse main:<f>`，而工作树又脏）⇒ `merge --ff-only` 一定会被
"local changes would be overwritten" 拒掉，而且**即使他们提交，落地大概率也不是一次快进，
而是一次要逐段归属的真合并**（重叠面正好在本线的核心上：`packages/local-api/src/{tools,mcp}.ts`、
`packages/app-host/src/local-api-host.ts`、`packages/domain/src/capture.ts`、i18n 两份词条表、
`scripts/{mutate-closeout-gates,reinstall-all}.sh`）。现量命令（可重跑，别只报数）：

```bash
git diff --name-only main...HEAD | sort > /tmp/mine.txt
git -C <主检出> status --porcelain=v1 | sed 's/^...//;s/.* -> //' | sort > /tmp/theirs.txt
comm -12 /tmp/mine.txt /tmp/theirs.txt | while read f; do
  [ "$(git rev-parse HEAD:$f)" = "$(git rev-parse main:$f)" ] || echo "DIFF $f"; done
```

**一次探针自伤，形状和我这一批反复记的那类一模一样**：数 `BLOCKED.md` 的 B 号时用了 `^### B[0-9]+`，
它只覆盖 **4 个 `###` 子条目**（`B30.1/2/3`、`### B31 关闭`），漏掉 **40 个 `## B<NN>.` 主条目**
⇒ 得到"最大 B = 31"，并据此把 closure 指针从**正确的 B36 改成了 B31**（改反了方向）。
形状无关的口径：`grep -oE '^#{2,4} ?B[0-9]+' BLOCKED.md | grep -oE '[0-9]+' | sort -n | tail -1`
⇒ 载体 **40**、main **46** ⇒ 新条目取 **B53**（自造短编号前先查命名空间归属，这条纪律救了一次撞号）。
一般规律：**"这个字段有几种写法"要先数，一种正则只覆盖一种写法时它给出的最大值只是那一种写法的最大值。**

**两个解锁条件挂在只读轮询上**（`/tmp/heyta-unblock/poll.log`，60 分钟封顶，不并发跑重活）：
① organizer 修复进 `main`（判据 = `main:packages/ui/src/projects/OrganizerList.tsx` 里 `minWidth` 命中 > 0）；
② 上面那 13 条重叠路径清空。两个都满足才做**最后一次**合并 + 全链复跑，避免"每合并一次就把读数作废一次"。

### 15.11 Windows 取证判据的八条变异臂已备好并验过有牙，但**排在落地之后**——顺带量出一件更要紧的事

**基线**：`bash scripts/mutate-closeout-gates.sh` 在载体 `05d0d7fc` 上 **17 绿 / 0 红**，耗时 **6.8 s**
（还是在 `vm.loadavg` 200 的情况下跑的）。

🔴 **更要紧的那件事：这个变异台有 0 个自动消费者。**
`grep -rn 'mutate-closeout-gates' package.json scripts/*.mjs scripts/*.sh` ⇒ **无任何命中**
（它自己除外）。也就是说 G1–G4 / L1–L4 / P1–P2 / S1 / V1–V3 这 17 条"必须能红"的检查，
**只在有人手跑的那一次有效** —— 与 §8.3 那条立场（不能失败的检查没有价值）相邻但不同：
这是"**能失败、但没人跑**"。接进 `pnpm check` 的代价刚量出来：**7 秒**。

**新加的八条 W 臂**（覆盖 §15.5 抽出来的 `scripts/lib/msix-install-facts.sh` 五条判据）：
W1 五条齐 ⇒ rc=0 且报条数（阳性对照，不许误挡）· W2 拿掉 `SHORTCUT_OK=True` ⇒ rc=1 **且指名缺的就是它**
（用户点名那条判据有牙）· W3 值改成 `False` ⇒ rc=1（判的是键值对不是键名）· W4 取证文件不存在 ⇒ rc=1
且报"文件不存在"而不是"缺判据" · W5 清单 ↔ 产出方对账（每条键名都要在 `install-and-capture.ps1` 里有写出点）·
W6 **反向对照**：往清单里塞一条产物里没有的 ⇒ 立刻红且指名它（这条臂自己也要有牙）·
W7 两个读取方都 source 单一所有者（2/2）· W8 读取方剥掉注释后不得有内联判据字面量。

**验法**（一次性副本，不动仓库）：把台子拷进工作树里跑 ⇒ **25 绿 / 0 红**；
变异 = 从 `MSIX_REQUIRED_FACTS` 里摘掉 `"SHORTCUT_OK=True"` 一行 ⇒ **恰好 W2 + W3 红（23 绿 / 2 红）**；
`git checkout --` 复原后回到 **25 绿 / 0 红**，并核过 `grep -c` 与 `git status` 都回到原样。

**为什么不现在把它落进仓库**：要改的两个文件都在**撞车面**上 ——
`scripts/mutate-closeout-gates.sh` 在主检出正脏着（它就是 §15.10 那 13 条重叠路径之一），
`package.json` 是 `B37` 那次事故的现场文件（为了让它只带自己的 hunk 覆盖过别人两行未提交改动）。
paste-ready 内容在 `/tmp/heyta-w-arms.sh`（含 W8 那版正确的"先剥注释再数"写法），
接链那一行是 `check:closeout-mutations` ⇒ `bash scripts/mutate-closeout-gates.sh`，排在落地之后做。

📌 **两次探针自伤，都是我自己的 rig 位置错，不是判据坏**（记下来因为症状完全像"仓库坏了"）：
第一趟 V0–V3 与 W 全红，报 `//scripts/lib/…: No such file`；第二趟报 `/private/tmp/scripts/…`。
根因是台子自己按 `REPO="$(cd "$(dirname "$0")/.." && pwd)"` 算仓库根 ——
我用 `REPO=… bash …` 传进去**会被那一行覆盖**，而把副本放在工作树根目录时 `dirname $0` 是 `.` ⇒ `..` 走到 `/private/tmp`。
正确放法：副本要在**与 `scripts/` 同级语义**的目录里（`.rig/mutate-closeout-gates.sh`）。
一般规律：**把别人的脚本拷出去跑之前，先读它怎么定位自己**（`dirname $0` / `import.meta.url` / `process.argv[1]`），
否则第一趟红一定是探针。

### 15.12 词条表**值层**的三条审计：本线 19 条全过，两条臂证到有牙，第三条臂的变异脚本自己坏了

红线里那句"i18n 中英成对"此前只被 `check:ui-language` 钉住**键集对等**（zh-CN 2860 / en 2860）。
键对等挡得住漏翻译，挡不住这三件事：英文值里混进中文、中英逐字相同（等于没翻）、
以及**占位符少一个**（`{count}` 在英文句里丢了 ⇒ 界面上那句话永远缺数）。
本轮对本线新增的 **19 条键**逐条量过（`git diff main...HEAD` 两侧各 19 行，计数相等）：

```
checked=19 missing=0 zh无中文=0 en含中文=0 逐字相同=0 占位符不一致=0
```

**"能不能失败"只靠变异回答**，所以拿一次性副本喂了三处破坏（副本在 `/tmp`，载体树核过干净）：

| 臂 | 变异 | 结果 |
|---|---|---|
| 单边键 | 把 `intentCreateProject` 改名 | ✅ `missing=1` 转红 |
| 占位符 | 从 `intentCreateHabit` 的英文值里拿掉 `{name}` | ✅ `占位符不一致=1` 转红 |
| 英文值含中文 | 把 `todayLabel` 的英文值换成中文 | 🔴 **未证** —— 我的变异正则 `('…': ')([^']*?)'` 把**闭合引号一起吃掉了**，那行变成 `'web.ai.tools.todayLabel': '今天,`（语法坏行），加载器按行匹配不到就跳过 ⇒ 报不出"en 含中文" |

第三臂是**探针坏了不是判据坏了**（同一族：`§7` 那条"正则一律会静默 0 命中"）。
本轮不补 —— 补它要再写一版变异脚本，而这条臂的常驻化要改 `package.json`（`B37` 的现场文件）。
**登记为缺口**：值层这三条目前**没有任何常驻门禁**，与 §15.11 那条"变异台 0 消费者"是同一类
（能查、没人跑）。现量脚本留在 `/tmp/i18n-value-audit.mjs`（键表从 argv 取，别学我第一趟硬编码）。

### 15.13 `AGENTS §9` / `roadmap §1.1` 的候选行（备好但**不代改**），以及 `ai-strategy.md` 已就地补上

复核 §9 的结果不是"数字漂了"，而是**本线的 headline 在那两张表里根本没有落点**：
`AGENTS.md` 提交态里搜 `覆盖面` / `22 个工具` / `ai-coverage` **零命中**（只有 `:37` 那句泛指的
"工具契约 + 授权判定"），`roadmap.md §1.1` 那张表按 **AI-0…AI-5 分支**组织，
而"每实体动作覆盖面"是一条**新轴**，不属于任何一个 AI-N。
`docs/plans/ai-strategy.md §7.1`（AI 的入口文档）**已就地补四行**（工具目录拆包 + 覆盖面门禁 /
批量写入一个提案 / 裸「X 号」带守卫 / 会话历史只落本机），并在 §7.2 后加了逐条复核声明
—— 那四条"未落地"目前**仍然成立**，本线没有改判任何一条。

`AGENTS.md` 与 `roadmap.md` 那两张表**本轮不动**，两个理由：§8 写着改 `AGENTS.md` 要用户点头；
而它此刻正被并行会话编辑（这一小时内两次收到"文件已被外部修改"）。候选文本如下，落地后一次做完：

```markdown
| 阶段 | 状态 |
|---|---|
| **AI 实体覆盖面**（与 P2/P3 并行的新轴，不属于 AI-0…AI-5 任何一档） | ✅ 8/8 实体有工具组（读 10 / 写 12 = 22，上限 40 席）；`check:ai-coverage` 进 `pnpm check` 链 ⇒ 覆盖面是**会红的判据**不是主张；MCP 与内置 AI 共用同一份目录 |
```

```markdown
# roadmap.md §1.1 表末追加一行
| **AI-6 覆盖面与门禁** | 每个用户可操作实体都有一组工具 + 覆盖面本身进链（漏一个实体就红） | AI-0 / AI-5 | ✅ 已落地（`scripts/check-ai-coverage.mjs`） |
```

📌 **一条一般规律**：**落地一项能力时，"有没有人写进进度表"要和"有没有人写进门禁"一起问。**
本线两件事都做了一件 —— 门禁写死了，进度表一行都没有。
一个只在计划文档里、不在入口表里的能力，下一个会话读 `AGENTS §9` 时会认为它不存在。

**⚠️ 上面那句"`roadmap.md` 本轮不动"已在 19:3x 作废，就地更正（载体 `aa1163fd` 之后）**：
`roadmap.md §1.1` 的 AI-6 行**已落地**，因为复核脏区时发现**它是干净的**（`git diff --numstat` 零行），
而 `AGENTS.md` 正被并行会话改（同一条命令读到 **15 增 / 8 删**）——
所以"不动"这条纪律**只落在真正脏的那份上**，不是两份一起搁着。
顺带在这次编辑里修掉了 `roadmap.md` AI-5 行的一处**抄件漂移**：它抄着"6 个工具：`list_tasks` / …"，
实测已是 22 个（读 10 / 写 12），而**没有任何一层会报错** —— 三处独立取数一致：
`node scripts/check-ai-coverage.mjs` 打印 22、`require('…/dist').LOCAL_API_TOOLS.length` = 22、
`grep -c "^  name: '" packages/local-api/src/tools/*.ts` = 22。
现在那一栏改成**指针 + 现量命令**，不再抄数（AI-6 行同理：容量 5 从 `MAX_TOOLS_PER_ENTITY` 产物读，不在门禁里抄）。
三处取数里**只有两处能长期复现**，这个区别值得写下来：
`node scripts/check-ai-coverage.mjs`（打印"目录 22 个工具"）与
`node -e 'console.log(require("./packages/local-api/dist/index.js").LOCAL_API_TOOLS.length)'`（22）都读的是**同一份真源**；
我原本还想第三条腿用 `grep -c "^  name: '" …/tools/*.ts`，**实测它返回 0** ——
缩进是 4 空格不是 2，而多文件的 `grep -c` 打的是**逐文件计数**不是总和。
🔴 一条"现量命令"如果复现出 0，读它的人会得出"文档在说谎"，而说谎的是命令本身 ——
所以上面两处只保留**跑过并核对过输出**的命令（缩进那条改成 `grep -h "^    name: '" … | wc -l` = 22，已实测）。
`AGENTS §9` 那行**仍未动**，候选文本留在上面；现量命令：
`cd <主检出> && git diff --numstat -- AGENTS.md`（非空就别碰，落地后重取）。

### 15.14 编号复核的结论 + 一个比 §15.11 更大的同类缺口：**四个变异台，零个自动消费者**

**`environment-traps` 编号按工作树现量复核（19:1x）**：载体 **186** 条顶格编号 / 最大号 **177**；
主检出工作树 **189** 条 / 最大号已到 **180**（正被并行会话写着）。
本文件 §15.7 里那两个数原先是**光秃秃的数**，现已就地改成"数 + 现量命令 + 会漂声明"——
自己的文档抄自己的数也是抄件，一样会漂。

**更要紧的一条**：全仓现在有 **4 个**变异台 ——

| 变异台 | 自动消费者 |
|---|---|
| `scripts/mutate-closeout-gates.sh`（25 臂，含本轮 W1–W8） | **无** |
| `apps/web/tests/mutate-assistant-history.mjs` | **无** |
| `packages/domain/tests/mutate-capture-day-rule.mjs` | **无** |
| `packages/legal/tests/mutate-gate.mjs` | **无** |

`grep -rn 'mutate' package.json` ⇒ **零命中**。也就是说"每条判据都做过变异验证"这句话，
在本仓库目前的含义是：**在某一天有人手跑过一次**。判据会不会因为一次无关重构而失去牙齿，
没有任何一层会在它失去的那一刻报警。
这与 §8.3 那条立场不是同一件事 —— "不能失败的检查没有价值"讲的是判据的牙齿，
这里缺的是**有人咬**。修法很便宜：一个 `check:mutations` 段串行跑四个台子
（`mutate-closeout-gates.sh` 实测 6.8 s，其余三个是 node 脚本），代价量出来再决定接不接。
本轮不接（要改 `package.json` —— `B37` 事故现场文件），**登记为缺口，编号交给下一条线**：
`MUT-1 变异台无自动消费者`。

### 15.15 🔴 本线自己造的一条**对外承诺缺口**：法务文档的工具表少列了本线加的 16 条，而那张表是授权面

**怎么照出来的**：并行那条线在 `AGENTS.md` 新写的一条规律 ——
"条款里那种『未列出的即视为未授权』的句子，会把一张表变成授权面"。
拿它回头量本线：`packages/local-api/src/tools/` 目录里唯一工具名 **22** 条，
而 `packages/legal/src/documents/ai-and-transfer.ts`（中英两份）里逐条 `includes` 之后
**缺 16 条** —— 缺的正好是本线这一批加的（表里已有的 6 条是更早的 task/project 工具）：

```
create_habit
create_note
create_project
create_reminder
create_tag
get_note
list_checkins
list_focuses
list_habits
list_notes
list_reminders
list_tags
log_focus
record_checkin
set_task_tags
update_note
```

三个版本读数相同（`main` 提交态 / 本载体 / 主检出工作树 都缺 16）⇒
**那条线自己补的是 EVENT 那 4 条，没有覆盖到本线这 16 条**。

**为什么这不是文档美化**：条款把那张表当**用户同意过的授权面**，
少列 16 条 = 用户同意的是一个比实际存在**更小的面**。
而且它有自己的版本机制（`ai-and-transfer.ts:532 version: '1.0'`，版本进**同意指纹**）——
补内容要连带 bump 版本，那会改变已签发同意的指纹语义。

**为什么本线不就地改**（三条，任一条单独都够）：
1. 法务文本 + 同意版本号是**对外承诺**，改动难回退，按"谨慎动作"要先取得产品负责人确认；
2. 同一份文件另一条线正在另一个 worktree 里做 `1.0→1.1` 的同类 bump（他们那份还没进 `main`）——
   两边各自 1.1 = 两个不同内容的同版本，正是"抄件必漂"最难查的那种；
3. 他们那条 `check:legal-tools` 门禁（目录 ↔ 中文表 ↔ 英文表 三方对账 + 逐行同序）**还没提交**
   （`git show main:package.json | grep -c check:legal-tools` = 0）⇒ 现在补，改的是**没有门禁的那份真源**，
   门禁一落地还要按它的形状重写一遍。

**登记**：`BLOCKED.md` 新立 **`B57`**，写清缺哪 16 条、三个版本读数、以及"等 `check:legal-tools`
提交后由本线按它的形状补齐 + 与那条线对齐版本号"这条关闭路径。

📌 **顺带记一次差点签出去的假清白**（zsh 词分割的第三种面目）：
第一趟用 `for t in $(…| sort -u)` 逐条查 ⇒ 正确报出缺 16。
第二趟把名单先存进变量 `TOOLS=$(…)` 再 `for t in $TOOLS` ⇒ **zsh 不对未加引号的参数展开做词分割**，
循环只跑了一次，`grep -qF` 收到的是**整份名单当多行模式**（`-F` 下换行=任一命中），
于是打出"缺 0 条"——一个**方向最危险**的假读数（把洞报成没洞）。
第三趟改在 `sh -c` 里跑，但我的 `sed -E "s/name: .//"` 里的 `.` 吃掉了引号又吃掉首字母，
产出 `ist_habits` 这种残名 ⇒ 又报"全缺"。
**最终正确的那趟是 node**（`matchAll(/name:\s*['\"]([a-z0-9_.]+)['\"]/g)` + `Set` + `includes`）。
一般规律：**名单类判据优先用宿主语言写**；shell 里三趟给出 16 / 0 / 24 三个数，
而"对不上"本身就是探针坏的证据 —— 报数之前先要两个独立实现同意。

### 15.16 Windows 打包机预检（只读）照出：远端是**共享目的目录**，而对账只发生在打包**之前**

为了不让 ③ 到时候卡在环境上，先做了一次**只读**预检（照仓内现成调用式，不自己发明）：

```bash
ssh windows-pc 'powershell -NoProfile -Command "… Test-Path / Get-FileHash …"'
MACHINE=<windows-pc>   NOW=2026-10-03T19:23:22
WEBDIST=True  SHA=0191588D96407D488B9B2902F1A5208E629C34B141CC78CF63D97CD639CC2C8A
MTIME=2026-10-03T19:04:30
# 本载体 apps/web/dist/index.html = 0B00C5879AF7B7FBF40C25AF24FF0A6F7BA206FC3AF3E6E8B7E0C543555AD2BD
```

三条读数各自有用：主机可达、`apps/web/dist` **在**（不是 §7 第 82 条当年"包里根本没有 web-dist"那个形态）、
**但远端那份不是我这条线的**（哈希不同，且 mtime 是 19:04 —— 另一个会话刚同步过）。
⇒ **`C:\src\heyta` 是一条被多个会话共用的目的目录。**

🔴 **于是暴露出一个 §7 第 82 条没覆盖的形状**：`scripts/reinstall-all.sh` 的 windows 段是
`sync_windows_sources`（`:241`，内含三条对账：`index.html` 哈希 / `native-bridge.js` 哈希 / 远端 chunk 数，
任一不符 `return 1` 拒绝打包）→ `package-msix.sh`（`:243`，**远端就地构建 + 安装**）→ `msix_check_facts`（`:249`）。
**对账发生在远端构建之前**，而远端构建要跑几分钟 —— 这个区间里另一个会话同步它自己的树，
我这趟装上的产物就不是我的源码，而**五条判据一条都不会红**（它们量的都是"远端曾经等于本地"那一刻之后
由我的构建产出的东西）。仓内 `grep -rn 'flock\|HEYTA_WIN_LOCK' scripts/*.sh scripts/lib/*.sh` ⇒ **无跨会话锁**。

这不是"把 82 条再说一遍"：82 条治的是**没有对账**，这一条是**对账只做了前半程**。
修法很便宜，两条任选其一（第二条更硬，因为它不依赖"没人插队"这个假设）：
1. 远端 `C:\src\heyta\.heyta-sync-id` 写入本次运行 id，**打包完成后**再读回来比对；
2. `msix_check_facts` 之前**重跑一次 `sync_windows_sources` 的哈希对账**（不重新同步，只比哈希），
   不符就判红 —— 把"等于本地"从一次断言变成区间的两端。

本轮不改：`scripts/reinstall-all.sh` 正是 §15.10 那 13 条重叠路径之一。
登记为 **`B58`**，关闭路径 = 落地之后由本线实现第 2 条 + 用"同步后手动改远端 `index.html` 一个字节"
做一次变异验证（必须判红）。

### 15.17 ③ 的四端环境预检（只读，19:2x 现量）：环境全绿，唯一卡点是"链 rc=0"那道门

| 端 | 前置 | 读数 |
|---|---|---|
| mac | `/Applications` 可写 + 打包脚本在位 | `APPS_WRITABLE=yes`、`apps/desktop-macos/scripts/package-app.sh` 存在 |
| android | 模拟器在线（**序列号每次现取**） | `emulator-5554 device`（`adb devices -l`） |
| ios | 有 booted 模拟器 | `heyta-iphone-17pro (FE195661-…-1F2F7AE3A102) Booted` |
| windows | 主机可达 + `apps/web/dist` 在包里 | 可达；`WEBDIST=True`；但远端哈希是**别的会话**的（见 §15.16） |
| 全部 | 有没有别人的设备验收在跑 | `ps` 扫 `verify-mobile\|adb .*shell\|uiautomator\|simctl` ⇒ **空** |

**结论写死，免得下一趟会话再怀疑环境**：③ 现在**不缺设备、不缺主机、不缺权限**，
只缺 `pnpm check` 的 rc=0（挂在 `B56` 那条上游红上）。
这五个读数都是**会过期的**（设备会被占、远端会被别人同步）—— 真要跑 ③ 之前必须重取，
尤其 `adb devices` 与 `simctl list devices booted` 这两条。

### 15.18 五条隐私红线**逐条读到判定机制**（载体 `fe2fd2de`，19:3x 现量）

红线写的是"不放宽"，而"没放宽"要能回答**它靠什么不放宽**。计数不算回答 ——
所以这一节每条给的是**判定发生在哪一行、以什么形状判定**，另给两栏：
**有牙**（能不能失败）与**有人跑**（谁自动跑它）。这两栏是分开的两件事，
§15.11 / §15.14 已经量过"有牙但没人跑"的整批，所以这里不能只报前者。

| # | 红线原文 | 判定机制（不是计数） | 有牙 | 有人跑 |
|---|---|---|---|---|
| 1 | AI 类型上产不出 op | `LocalApiWriteIntent` 是**封闭联合**（`packages/local-api/src/tools/shared.ts:517-601`，13 个成员、全部 `action:` 判别、**没有 op 字段也没有 op 构造函数**）；`LocalApiWritePort.submit(intent)` 把 intent 当**不透明值**传递（`:493-494` "本包不解释它，只传递。这保证了解释 op 的地方只有一处"），于是能把它变成 op 的只剩宿主与 `packages/op-log` | 宿主侧 `packages/app-host/src/local-api-host.ts:466` 的 `switch` 实测 **13 个 case 且无 `default`** ⇒ 加了联合成员而不在宿主翻译 = **编译不过**（不是运行时才发现）；`entity-type-parity.spec.ts` 把 `LocalApiWrittenEntityType` 在编译期钉成 `ENTITY_TYPES` 的子集 | `pnpm -r typecheck` —— 类型层判据的执行者就是它，所以这条不需要额外门禁 |
| 2 | `host.submit` 恰好一处 | **见下面的更正**：非测试代码实测**两个入口各一处**，"全仓一处"是措辞错 | 助手入口：`scripts/check-ai-tools.mjs:131-150` 规则 2 —— 剥注释后 `.submit(` 在 `RUN_FILE` 里**恰好 1 次**，且必须位于 `confirmAiToolProposal` 声明之后（次数**与位置**都判；`:64-67` 说明为什么必须剥注释：不剥就会对正确代码报红） | 该门禁**在链里**：本载体 `package.json` 的 `check` 现量 **61 段**，`check:ai-tools` = **第 36 段**、`check:ai-coverage` = 第 51 段。🔴 但它 `WATCH_DIR` 只有 `packages/app-host/src` + 前缀 `ai-tool-`（`:53-56`，注释 `:52` 明写"只扫这几个文件，不搞全仓 grep"）⇒ **MCP 那处不在扫描范围** |
| 3 | 逐工具默认关 | `isToolGranted(grants, name)` = `grants?.[toolName] === true`（`packages/local-api/src/tools.ts:337-339`）—— **只有显式 `true` 算授权**，`undefined` / 缺字段 / 不存在的工具名一律 `false`；`:333-335` 明写这是有意的 fail-closed，且它**不检查工具是否存在**（MCP 侧要区分"不存在"与"未授权"得自己先 `findTool()`，为的是不泄露目录） | `mcp.spec.ts` / `local-api.spec.ts` 各有 `tool-not-granted` 断言 | `pnpm -r test`（已挂进 `pnpm check` 末尾） |
| 4 | 出境逐字段披露 | `buildDisclosure(request)`（`packages/ai/src/egress.ts:126-138`）：**结构化结论是唯一判断来源**，两句兼容文本（`destinationText` / `retentionText`）由它**投影**出来 ⇒ 两条路径对同一次出境不可能给出不同结论；`fields` 直接取 `request.fields`，而它是从目录的 `egressFields` 现算的并集（`packages/app-host/src/ai-assistant.ts:123-125`："不在这里列字段名单 —— 列了就是一份抄件"）；🔴 **拒绝分支必须带 `disclosure`**（`egress.ts:151-153`：只说"未授权"而不说"授权后会发生什么"= 逼用户盲签） | `egress.spec.ts`（含 `consent-missing`）、`routing.spec.ts`、`diagnose.spec.ts` | `pnpm -r test` |
| 5 | 回退不跨越隐私边界 | 第 3 道闸**在候选循环体内、发请求之前**（`packages/ai/src/routing.ts:714-722`，注释 `:718` "**必须在网络之前**"）：`authorizeEgress` 不放行时首选 ⇒ `return egress-not-authorized`（`:725-741`）；回退 ⇒ 记 `blockedByConsent` 后 **`break`**（`:746-750`）。`attempts` 只在真实 invoke 之后累加，所以这条腿的形状是**一次请求都不发**；收尾把"被隐私拦住"排在普通失败**之前**报（`:806-822`，理由写在 `:806`：它需要用户做一个决定） | `routing.spec.ts` / `diagnose.spec.ts` / `app-host/tests/ai-cause.spec.ts` 三处都有 `fallback-needs-consent`；用户侧话术 `packages/app-host/src/ai-failure-fallback.ts:37` | `pnpm -r test` |

**🔴 一条更正（红线原文与实测不符，且错在"措辞"而不是"边界"）**：
红线是「host.submit **全仓**恰好一处」。非测试代码实测 **2 处**：

| 入口 | 调用点 | 该文件自己的措辞 |
|---|---|---|
| 内置助手 | `packages/app-host/src/ai-tool-run.ts:195`（`confirmAiToolProposal()` 内） | `:188` "`check:ai-tools` 静态钉住 `RUN_FILE` 里 `.submit(` 恰好 1 次且在本函数内" |
| 本机 API / MCP | `packages/local-api/src/server.ts:545`（`executeTool()` 内） | `:518` "写只走 `host.submit` —— 本函数是**唯一**调 `submit` 的地方" |

两处各自**文件内**都成立；"全仓一处"是把文件级措辞读成了仓库级。🔴 **这不是放宽边界**：
MCP 那条"立刻 submit"是 ADR-0011 的设计（外部程序显式调用 + 逐工具默认关 + 只监听回环 + 显式 token），
助手那条"确认后才 submit"是 ADR-0005 §3.1 要防的那件事 —— 两个入口守的不是同一件事。
两个入口的授权也**确实是同一份判定**（`assistantGrants()` 与 MCP 的 `config.grants`
最后都汇到 `isToolGranted()`，`apps/web/src/features/settings/aiStore.ts:83-89` 把这张两入口对照表写在代码里），
且助手的档位默认 `read-only`（`aiStore.ts:120`，缺字段/旧值一律落回 `read-only` `:152`）——
所以"内置助手是档位级、不是逐工具级"这个差异**是被显式记账过的设计**，不是漏。

**真正的缺口在"有人跑"那一栏**：`check:ai-tools` 的范围不含 `packages/local-api/src/server.ts`
⇒ 今天可以在 MCP 的 `executeTool` 旁边再加第二个写点，门禁不一定红。
登记为下一批的一条（**不并进 ③**，因为它改的是门禁的**范围**，而 `scripts/` 在 §15.10 那批重叠路径里；动手前先现量）：
判据形状 = 剥注释后**按入口分别**计数（助手 1 / MCP 1）并把 `WATCH_DIR` 扩到两个入口目录；
变异验证 = 在 MCP 入口加第二个 `.submit(` ⇒ 必须红，且**只在助手入口加**也要红。

⚠️ 这一节**不下"五条都成立"的总结论**：1 / 3 / 4 / 5 读到了判定机制且自动跑；
第 2 条在助手入口成立且有门禁，在 **MCP 入口只有约定和注释在守，没有计数门禁** ——
把它写成"五条都成立"就是又一次把主张当门禁。

### 15.19 把红线第二条从**措辞**变成门禁：`check:ai-tools` 规则 8 + 规则 9（载体 `a9e032ac`，含一次反证）

§15.18 记下那条不对称，本轮直接把它补上。只改 `scripts/check-ai-tools.mjs` 一份文件，
而它在本轮动手之前与 `main` **逐字节相同**（`cmp` 比过 `git show main:` 与 `git show HEAD:` 两份）
⇒ 不碰任何并行会话在这份文件上的在飞改动。

**先量现量**（1899 个源码文件，判据 = 剥注释后的 `host.submit(`）：非注释的 `.submit(` 共 119 行，
`src` 树里恰好 **2** 枚 —— `packages/app-host/src/ai-tool-run.ts:195`（助手：确认之后）与
`packages/local-api/src/server.ts:545`（MCP：`executeTool()` 内）。其余全在 `tests/`
（一百多处**直接喂端口的夹具**，不是入口）、一枚在 `apps/desktop/renderer-dist/` 的构建产物里、
一枚是 `apps/mobile/src/screens/ProfileScreen.tsx` 的 `form.submit()`（DOM 表单，与写口无关）。

⇒ 🔴 **红线原句「`host.submit` 全仓恰好一处」按字面实现，得到的是一条永久红的判据**
（当前真值是两处，而且两处都是设计要求的）。它真正要保的是两件可以分别钉住的事：

| 规则 | 判据形状 | 拦住的是 | 变异臂 |
|---|---|---|---|
| 8 | MCP 入口剥注释后 `.submit(` 恰好 1 次，且位置在 `async function executeTool(` 之后；**文件不存在也红**（不许静默跳过） | 在 MCP 旁边再加一个写点；把写点搬到授权判定与 `toWriteIntent()` 之外 | 2、3、4、7 |
| 9 | 全仓 `packages/<pkg>/src` + `apps/<pkg>/src`（20 根 / 581 文件）里 `host.submit(` 的**文件集合 == {助手, MCP}**：多一枚红、少一枚红、**扫描根为空也红** | 第三个写入口；以及"入口文件被删 ⇒ 规则 1/2 一次都不执行" | 8、9、10 |

读数（十臂全在 `HEYTA_CHECK_ROOT` 假根里跑，不改载体、不改共享工作树）：

- 基线 `EXIT=0`：`规则 9 写入口穷举 20 个 src 根 / 581 个源码文件，命中 2 处（= 清单）`；
  同时 `规则 6 扫描范围 41 个 .ts` **未变** —— 这点要单独记一句，因为我把别人也在用的
  `listAppHostSourceFiles(dir)` 泛化成了 `listSourceFiles(dir, extensions)`（外加"跳目录软链、
  不跳文件软链"和 `SKIP_DIRS`），改的是共用遍历器，零行为变化只靠这个数没动来证。
- 十臂：`臂数=10 通过=10 不符=0`，`HARNESS_EXIT=0`。
- 🔴 **反证（本轮最有用的一条）**：只跑臂 9 把假根留在"助手入口文件被删"的状态，
  再把 **HEAD 版**那枚门禁喂进**同一份现场** ⇒ `OLD_GATE_RC=0`，输出
  `✅ AI 工具路径门禁通过：ai-tool-* 2 个文件；… 写只出现在确认函数里 …`。
  也就是说 §15.18 里"枚举型门禁会因元素消失而空转"还只是我的**推测**，现在它有存在证明，
  而且它的表现是**打印了一句反话**（那句"写只出现在确认函数里"描述的正是被删掉的那段代码）。
  已入 **traps #178**（编号按工作树现量：改前 `tail` 是 #177）。

两处顺手补的、也归这套臂管的东西：

1. **行号**。规则 8 的位置腿最初把违规报在 `server.ts` 的**注释行**上 —— 那张"三条纪律"表里
   第 3 条就写着 `host.submit`。修成跳过注释行后臂 4 报 `server.ts:524`（代码行）。
   这不是我想起要改的，是臂 4 的输出**看着不对**才去看的：判据把人指到错的位置，
   与 §15.13 那条"复现不出来的现量命令"同类 —— 都会让下一个人怀疑代码而不是怀疑探针。
2. **限界（必须写下来，别让这条门禁读起来比实际更硬）**。规则 9 认的是 `host.submit(`
   这个**字面形状**；把接收者改名（`const h = getHost(); h.submit(...)`）仍然躲得过。
   它没有比被它取代的那句措辞更弱（红线用的就是同一个词），但也不等于"任何写法都能抓到"。
   要更硬只能到类型层数 `LocalApiWritePort` 的实例化点，本轮没做，登记在这里。

### 15.20 ④ 的编号现量：`environment-traps.md` 有**四组重号**，我没有就地改号

工作树现量（该文件此刻**干净**，`git diff --numstat` 为空）：

```bash
grep -oE '^[0-9]{2,3}\. ' docs/reference/environment-traps.md | tr -d '. ' | sort -n | uniq -d
# ⇒ 38 93 94 95
grep -oE '^[0-9]{2,3}\. ' docs/reference/environment-traps.md | wc -l   # 168（含 4 组重号）
grep -oE '^[0-9]\. ' docs/reference/environment-traps.md | wc -l         # 18（条目内子表，不是条目）
```

逐行读过才敢下的结论：`#38` 在 708 与 779 行各一枚；`#93/#94/#95` 是**整块**重复
（2450–2519 与 2889–2940）—— 两个会话都从 #92 续号，这是共享工作树上的必然撞法。
所以「§7 #93」这类引用**现在是有歧义的**，而 AGENTS §7 那句"编号只增不改"没有挡住它，
因为没有任何一层检查重号。

**为什么不当场改成**：改号要挑哪一枚让号，而 32 处引用（`第 38 条`/`#93` 这类，`grep -rnoE --include='*.md'` 现量：
38→14、93→7、94→7、95→4）分散在各计划文档里，每一处都要**读它当时指的是哪一条**才敢重定向。
机械地把后一块改成 #178/#179/#180 会造出一批"号对、内容不对"的引用 —— 那比重号更坏。
⇒ 这条需要一次带判断的收口（谁的引用指谁），本轮只登记，不改别人的条目。
我自己那条用的是 #178（当前最大号 177 + 1，未与任何号冲突）。

📌 可迁移的一条：**"编号只增不改"这类纪律，只要没有一条检查重号的闸，就会在多人台账上漂** ——
台账越活跃漂得越快（这次是三分钟内两批会话各自续号）。若要补闸，代价是一行
`uniq -d`，落点应该是一个**文档类**门禁而不是本文件这条 AI 门禁（判据与领域要对得上）。

### 15.21 本轮自己写的一行，被**并行会话随后的一次提交**变成假话（已就地更正）

`6bb9716f`（本轮早些时候，就是我写那行的那笔）在 roadmap 的 AI-6 行留了
「覆盖面 8/8 实体…**已登记缺口 0 项**」。main 随后进了 `05293b7d`：
同一个脚本 `scripts/check-ai-coverage.mjs` 长出**第二条维度**（AI 功能 × 端，
`GAP_ENDS` 表把 mobile 0/5 当显式登记的缺口打印）。
⇒ 从"写下"到"失实"之间**这句话自己什么都没变**，变的是它指的那个脚本。

读他们的 diff 确认了两件我本来会写错的事，所以两条都不用撤回：

1. 那条 mobile 0/5 **不影响退出码**（登记项只打印）⇒ §15.17 的
   "③ 只缺链 rc=0，卡在 B56 那条上游红"**没有被这条改动否证**。
2. 咬人的那条是**半接即红**（某端 import 了任何一条 AI 入口而其余没接完），
   且"全接完也红，直到把登记删掉" —— 所以它不是 `check:l4` 那种永久豁免。

roadmap 那一行已改成**两条维度各带自己的读数 + 出处（B34 / `05293b7d`）**，
更正的理由写在行内而不是只留结果。
📌 可迁移的：**"我写的这行"和"我这行所指的那个东西"是两份事实**，后者被别人改时
不会来通知前者。落台账时把"它指的是哪个脚本的哪个维度"写死，比把结论写死更耐改 ——
同一件事的另一面就是 §15.13 那条"复现不出的现量命令"：给出**取读数的方法**，
下一轮的人能重取，而不是只能选择信或不信。

### 15.22 ② 的窗口：上一趟以 exit 3 自己收口，这一趟换了形态（并修掉一处我自己接出来的死锁）

**上一窗口的读数（不是我这轮判的，是它自己写的）**：`/tmp/heyta-final-chain-191600/runner.log`
末行 `203102 等满 75 分钟仍未解锁：organizer=无 overlap=14` ⇒ 按设计以 **3 = 环境无效**结束。
这条读数要留在原位，因为它就是 ③ 没跑的因果：**不是设备、不是主机、不是权限，是别人的现场**
（§15.17 那张预检表说的正是这五件事）。

🔴 **但那一趟的"等"是我接坏的**：它等两个**哨兵文件**
（`/tmp/heyta-unblock/organizer-landed` / `overlap-clear`），而写哨兵的只读轮询器
60 分钟封顶、**20:08 就退出了**，链自己 20:31 才封顶 ⇒ 最后 23 分钟它在等一个
**永远不会出现的东西**。两个进程各自到期，谁都没错，合起来是死锁。
（`ls /tmp/heyta-unblock` 现在只剩 `overlap-last`/`poll.log`，没有那两个文件 —— 这是证据不是推测。）

这一趟（`/tmp/heyta-decisive.sh`，pid 82833，日志 `/tmp/heyta-decisive/chain.log`）改了三件事：

1. **条件量在自己身上**，不再跨进程传哨兵。现量：`organizer=0 重叠=14 窗口=0 负载=27.73`。
2. **逐段跑，而不是跑整条 `&&` 链**。理由就是本台账 §15.10 那句：链在段 51 一红，
   段 52–60 一个字都取不到，而 ② 在"main 带着 organizer 那条红"这个前提下**唯一能交付的**
   恰好是「段 0–50 绿 + 段 51 挂上游关闭判据 + 段 52–60 逐段读数」。
3. 闸门的每条判据**各喂一个该命中与一个不该命中的样本**（`--selftest`，四方向全 PASS）。
   这一步当场抓出三个我自己的 bug（`cut -c` 少了尾部横线、`ps` 的 pid 前导空格、
   假进程在 `$()` 里起活不下来），也抓出**两条对照是假过的** —— 已入 **traps #179**。

**顺带把"② 到底还缺几样"量清了**：在 `main` 的独立检出里跑 `05293b7d` 那版
`check:ai-coverage.mjs`（跑完即删检出），输出

```
界面端覆盖：web 5/5（两级核对）
界面端覆盖：mobile 0/5（**显式登记的缺口**：… 见 BLOCKED B34）
ℹ️  功能 tool-calling 有多个 request* 入口（request, requestAssistantTurn），门禁只核对第一个 request。
🔴 1 处不达标：找不到 packages/ai/dist/index.js —— 先跑 pnpm build
```

⇒ **没有第二个卡点**：唯一那枚 🔴 是"新检出没 build"（`pnpm check` 第一段就是 build，
正常路径碰不到），mobile 0/5 那条登记**只打印不影响退出码**。
所以 §15.17 那句"只缺 `pnpm check` 的 rc=0，挂在 B56 那条上游红上"**仍然成立**，不撤回。

🟡 **但那行 ℹ️ 里有一条与本线直接相关的盲区，登记在此**：新维度判"这端接没接"是
**只认每个功能的第一个 `request*` 入口名**，而 `tool-calling` 的第二个入口
`requestAssistantTurn` 正是**本线（对话式助手）的入口**。
⇒ "移动端半接即红"那条咬人的规则**对我这个入口不成立**：移动端只接 `requestAssistantTurn`
也不会红。这不是他们的判据写坏了（它明说了只核对第一个），是**覆盖面那条腿还没长到这里**。
登记为缺口，与 `check:legal-tools` 那条同批处理（都要一次授权面判断，见 §15.15）。

### 15.23 ④ 逐条复核：本线那三条 B 号**一条都不能打勾**，且每一条的落点都在别人手里

"打勾收口"的前提是那条勾是真的。逐条现量（载体 `c55d6cec`，20:4x）：

| 条 | 关闭判据（本台账里写死的那条） | 现量 | 结论 |
|---|---|---|---|
| **B56** 侧栏清单名被四个动作按钮挤成零宽（不在本线的产品缺陷，挡住本线交付） | `git show main:packages/ui/src/projects/OrganizerList.tsx \| grep -c minWidth` > 0 | **0**（该文件最后一次进 main 是引入那四个按钮的 `192a516d`；修复仍在主检出未提交） | 未闭合，且**只有作者能闭** |
| **B57** 法务工具表少列本线加的 16 条（那张表是授权面） | `check:legal-tools` 进了 main 的链 | `git show main:package.json \| grep -c check:legal-tools` = **0**；`scripts/check-legal-tools.mjs` 在 main 上不存在 | 未闭合 —— 那条门禁还不在别人手里落地，补表要连着"条款版本号进同意指纹"一起拍（§15.15） |
| **B58** Windows 对账只做了前半程 | 在 `msix_check_facts` 之前重跑一次哈希对账 + 一次"远端改一个字节"变异必须判红 | `scripts/reinstall-all.sh` 在主检出 **25+/2− 未提交**（正是 §15.10 那 13 条重叠路径之一） | 未闭合，落点被占 |

AGENTS §9 的候选行同样**不能落**：`AGENTS.md` 主检出 `1+/1−` 未提交（现量见上表同一时刻）。

⇒ ④ 里"PROGRESS.md / BLOCKED.md 逐条打勾"这一项，本轮做的是**复核**而不是**打勾**：
三条的判据都取到了现量，三条都还没成立。把"还没成立"的条目打上勾，
就是这个 Goal 全程在防的那件事（§15.18 那句"文档里说覆盖了"）。

**为什么不顺手把行写进 BLOCKED.md 更新一版**：那两个文件正被别人写。
⚠️ 这里**不写快照数字**——我 20:2x 读到的是 `PROGRESS.md 28+/0− / BLOCKED.md 29+/2−`，
两分钟后重取变成 `PROGRESS.md 干净 / BLOCKED.md 57+/0−`：**两分钟里数字全变了**，
把任何一组写进台账都会在落笔那一刻起过期。要现量就跑这一条：

```bash
cd "<主检出>" && git diff --numstat -- PROGRESS.md BLOCKED.md AGENTS.md scripts/reinstall-all.sh
```

在共享工作树里对这种文件做整文件提交，会把别人的未提交行记到我的提交名下 ——
红线明确禁止（"绝不整文件 git add，不带走别人的 hunk"）。
本轮的复核结果就落在本台账这一节（单写者文件），**等上面那条命令对自己关心的文件回空时按本表逐条搬**。
📌 一条可迁移的：**"打勾"这个动作的成本不在写那一步，在于那个文件此刻归谁**；
而"它此刻归谁"是个**存活几分钟就要重取的读数**，不是一次写死的事实。
共享台账上最贵的错误不是忘了打勾，是把别人的未提交内容连勾一起提交进去。

### 15.24 🔴 合并预演照出真正的阻塞物：不是"改不动"，是**两本台账的 B 号命名空间被并发会话撞车**

一次性 worktree 里把 `main` 合进本线（`git worktree add --detach /tmp/heyta-merge-dry HEAD` 之后 merge，
跑完即删，不碰载体也不碰 main）。读数：

- **代码与文档全部自动合上**。真冲突 **2 处，都是多人台账**：
  `BLOCKED.md` 一块（我方 111 行 / main 方 241 行，且块一直延伸到文件尾）、
  `PROGRESS.md` 一块（33 / 187 行）。
- 逐行号会误判，所以按**内容**判归属（每块取 6 条 >25 字符的特征行）：
  我那三条在 `main` 与主检出工作树里 **命中 0 条** ⇒ 三条都是本线独有。
- 于是合并后的形状**不是重复，是同号两件事**：main 的 `B47` 是"回收站调研那句已被否证"、
  main 的 `B48` 是"58 段全绿 / 4 段主动不跑"，**与我这三条毫无关系**。
  机械 union 之后文件里会出现 `47x2 48x2 49x2`（另有继承来的 `30x4 31x2`，不是本轮造的）。

**为什么同号不同事比翻倍更难发现**：翻倍时人一眼看出"这两段一样"；
同号两件事时**每处引用都语法正确**，读的人拿到的是错的那一条。
而 `B47` 这类引用在本仓是跨文档的（台账、roadmap、PROGRESS 都指它）。

⇒ 已把**我自己的**三条重编到工作树最大号（`52`）之后：**`B47→B53`、`B48→B54`、`B49→B55`**。
作用域是逐文件算过的，三处都有断言挡住"顺手多换"：

| 文件 | 锚点 | 块外未触碰 | 换了几处 |
|---|---|---|---|
| `BLOCKED.md` | 第一处 `## B47. ` | 133506 字符（别人的段落一个字没动） | 4 |
| `PROGRESS.md` | 第一处 `B47` | 53797 字符 | 2 |
| 本台账 | 整文件（单写者） | — | 10（`B47`×6 / `B48`×2 / `B49`×2） |

换完全仓再查一次悬空引用：`grep -rn "B47\|B48\|B49" --include='*.md' .` ⇒ **0 处**
（唯一的 `2B49` 是 `icp-app-filing.md` 里一枚证书 MD5，与编号无关，脚本的排除表把它挡住了）。

📌 **取号纪律的错误不在"没查命名空间"，在"把一次性的查询当成持久的分配"**：
§15.10 那次我确实查了（载体 40 / main 46 ⇒ 取 47），查得没错；
错在我假设"最大号"是个稳定量 —— 它其实是**每个会话各自工作树的瞬时读数**，
两分钟后 main 已经是 51、主检出 52。⇒ 可迁移的写法：**取号只能在那一刻要用的时候取，
并且落盘时同时留下重取命令**；跨会话持久的不是号码，是"号码必须由分配器给"这条规矩。
本线现在的重取命令（合并解突前跑一次，零重号才算可解）：

```bash
grep -oE '^#{2,4} ?B[0-9]+' BLOCKED.md | grep -oE '[0-9]+' | sort -n | uniq -d   # 期望只剩继承来的 30 31
```

⚠️ 顺带确认的一件事：`PROGRESS.md` 里我那段收尾写着 Windows 快捷方式**实现与判据齐（`SHORTCUT_OK`）、未跑**
—— 也就是 ③ 的那半件不缺代码，缺的还是"链 rc=0"这道前置。

## 15.25 载体被一次重启整个清掉，以及规则 7 的"退出 0 不等于核对过"（2026-10-03 21:3x）

**事件（先记损失面，因为它决定了下面哪些读数是重建后重取的）**

`kern.boottime = Sat Oct 3 21:32:15 2026`：机器重启过一次，`/private/tmp` 随之清空。
被清掉的不只是临时文件，而是**整条集成线的载体目录**——`git worktree list` 现在把
`/private/tmp/heyta-final`、`/private/tmp/heyta-ai-cov`、`/private/tmp/heyta-day-rule`
以及六个一次性 dry-run 检出全部报成 `prunable`（目录不在了）。

| 东西 | 状态 |
|---|---|
| 五笔提交（`b728ff3c`…`b7d04e20`）与分支 `integrate/2026-10-03-closeout` | ✅ 完好（对象在 `.git` 里） |
| 规则 7 的**未提交**编辑（把"上游没构建"与"清单漂移"分开报） | ❌ 丢在目录里，本轮重写 |
| `/tmp/heyta-mutate-rule8.mjs`（10 臂）与它的日志 | ❌ 丢；读数当时已记进 §15.19，但**脚本没了 = 不可复跑** |
| `/tmp/heyta-decisive.sh`（自足等待器）与 `/tmp/heyta-decisive/chain.log` | ❌ 丢；那趟本来也在等窗口，没有已产出的段读数 |

🔴 **可迁移的一条**："跑过一次并绿"如果只把读数写进文档、把脚本留在 `/tmp`，
下一次重启后就退化成"一句没人能复查的主张"。本轮起臂脚本一律放 `~/scratch-heyta/`，
载体一律放持久路径。**新载体**：`/Users/rocalight/Desktop/All in one Data/01_PROJECTS/heyta-wt-ai-closeout`
（分支不变、tip 不变）。重建命令：`git worktree prune && git worktree add "<上述路径>" integrate/2026-10-03-closeout`。
下文所有读数都写在这棵树里；旧文档里凡是写 `/private/tmp/heyta-final` 的，指的都是同一分支的旧载体。

**规则 7：一处真缺陷，而且是"会伪装成通过的"那一类**

疑点来自上一轮留下的矛盾：注入假根跑门禁时它报"能力清单与上游一致"，而那个假根里
`packages/*/dist` **根本不存在**。本轮把它查到底，机制是两层，都不在"消息写得不够细"这一层：

1. **生成器会静默空跑。** 它的入口守卫是
   `import.meta.url === pathToFileURL(process.argv[1]).href`，而 `import.meta.url` 是**过了 realpath** 的。
   路径里任何一段软链（`/tmp → /private/tmp`、假根里指向真脚本的 symlink）都让比较失配
   ⇒ main 块整个不执行 ⇒ **零输出、退出 0、一个字节都没核对**。实测对照（同一棵树、同一份文件，只换拼法）：

   | 拼法 | 输出 | 退出码 |
   |---|---|---|
   | `node /tmp/heyta-symtest/scripts/gen-ai-capability-manifest.mjs --check` | 无 | **0** |
   | `node /private/tmp/heyta-symtest/scripts/gen-ai-capability-manifest.mjs --check` | 报「读不到 dist」 | 1 |

   入 `traps #180`。修：比较前先 `realpathSync(process.argv[1])`；修后同一拼法回 `exit 1` 并打印真结论。
2. **两边的根不是同一棵树。** 门禁的 `ROOT` 认 `HEYTA_CHECK_ROOT`，生成器的 `ROOT` 只认
   "我自己住在哪" ⇒ 注入时它核对的是**另一棵树**，还会给出一个看起来完全合法的"与上游一致"。
   修：门禁 spawn 时把根传下去，生成器同样接受 `HEYTA_CHECK_ROOT`（未注入时逐字等于原取值）。
   生效证据：`HEYTA_CHECK_ROOT=<主检出>` 跑载体里的生成器，它报的是
   **主检出的产物**里没有 `LOCAL_API_TOOL_PACKS` —— 载体自己的 dist（不存在）已不参与。
   ⚠️ 这句只用于证明"读取确实换了根"，**不**主张主检出坏了：那棵树里 `dist` 是哪一趟打的没查。

3. 上一条修的是机制，这一条修的是**判绿方式**：门禁现在要求生成器**给出结论行**
   （`与上游一致`）才算通过，并把 rc≠0 分成"上游还没构建"（`读不到 …/dist/index.js`）
   与"清单漂移"两种报法——它们的修复动作相反。原话"混起来的是上一层"只对一半：
   真凶在**被调方自己的入口守卫**里，上一层只是没察觉。

**能失败（全部在假根里，不改载体、不改共享工作树）**

- `node ~/scratch-heyta/mutate-rule7.mjs` → **5 臂 5/5**（没构建 / 真漂移 / 空跑必须红 / 两条阳性对照），整体 `EXIT=0`。
- `node ~/scratch-heyta/mutate-rule89.mjs` → **10 臂 10/10**（规则 8/9 那批原样重建，`EXIT=0`）。
- 臂 1（天然场景）：在未构建的新载体里 `node scripts/check-ai-tools.mjs` → `EXIT=1`，唯一违规就是
  `能力清单的**上游还没构建出来**`，其余九条规则零违规。

🔴 重建 10 臂时发现一件比原缺陷更贵的事：**原版把真生成器 symlink 进假根，于是规则 7 在
那些臂里一直是静默空跑的**——而"期望整体 rc=0"的两臂（基线、注释阳性对照）正是踩在这个空跑上
通过的。规则 7 修好后同形假根会真的去核对（假根没 dist ⇒ 红）。⇒ 臂必须把**无关规则显式中性化**
（桩打印结论、退出 0），不能靠它们碰巧不响；这条已写进 `traps #180` 末段。

**②/③ 的窗口现状（现量，别读成"已跑"）**

重启后整机负载 `vm.loadavg = { 74.76 46.69 32.94 }`（16 核，闸门阈值 = 12），
起 `pnpm install --frozen-lockfile`（新载体没有 `node_modules`）前的这一行读数就是归因凭据。
全链 61 段的**逐段读数仍未取**；① 的落地面也变了：`main` 现在 `96f3293d`，
`rev-list --left-right --count main…载体 = 22/64` ⇒ 落地前要先把 main 那 22 枚并进载体，
不能按"main 是祖先、可直落"处理（那是 14:4x 的读数，已过期）。

## 15.26 合并执行记录：main 并进集成线（`75acfe3f`，2026-10-03 21:5x）

① 的前半在重启后的新载体里做完了，逐项落字：

- **冲突面 = 2 枚文件、各 1 块**（`BLOCKED.md` / `PROGRESS.md`），都是"各自往尾部追加"的形状，
  按并集解，判据是**行级无损**而不是"门禁没红"：`ours 111/theirs 340`、`ours 33/theirs 251` 全部保住。
- **同号不同物一处，第二次重编**：main 上 `d6ea2dc9`（21:4x）新立的 `B53` 是别人自查
  "把并行会话的整节内容替他们提交了"，与本线的 `B53`（organizer 零宽）无关 ⇒
  本线三条 `B53→B56`、`B54→B57`、`B55→B58`。合并后 `^## B[0-9]+` **重复号 = 0**。
  🔴 重编是**区域限定**的，脚本里对"别人的那两条必须逐字未动"各写了一条反向对照；
  且两句**分配记录**（"新条目取 B53"、"B47→B53"）按原位保留 —— 把它们一并改掉就是把移动史抹掉，
  下一位无从知道自己看到的是第几号。
- **段数这条读数又被载体咬了一次**：`main` 的**提交链 = 61 段**，而主检出的**工作树 = 62 段**
  （多的那段是并行会话未提交的）。合并后集成线 = 61 段，与 main 提交链**逐段集合相等**（双向差集各 0）
  ⇒ 这次合并没有吞掉任何一段门禁。现量：`node -e` 双向差集，别只数总长。
- 🔴 **main 上有一笔平行的 `2474a888` 也叫 `check:ai-coverage`**，所以合并里
  `scripts/check-ai-coverage.mjs` 是**自动合并**的（+119/−1）。那一处删除不是丢东西：
  删的是旧的 web-only 成功文案，main 侧把它升级成"按端枚举 + `GAP_ENDS` + 半接即红"。
  ⇒ "没报冲突"不等于"语义对"，合并后必须单独读一遍这份文件的 diff（本轮读了，判据没被削弱）。
- **五条红线在合并态现量**：`CURRENT_SCHEMA_VERSION = 1`；`host.submit(` 字面 3 处，其中
  `server.ts:481` 是**注释里的表格**（门禁剥注释后 = 2 处，规则 8/9 通过），两个真实写入口
  `ai-tool-run.ts:195` / `server.ts:545` 与合并前同一对；`retention-undecided` 4 处不变；
  `fallback-needs-consent` 6 → **8** 处（main 侧新增，方向是**更严**不是放宽）。
- **`check:docs` 在合并态 rc=1，4 条死链全部继承自 main**（引用行在 `git show main:` 里就有、
  目标文件在 main 树上就不存在）：`PROGRESS.md → docs/research/aed-implementation-evidence.md`、
  `docs/plans/detail-pane-alignment.md:4 → calendar-year-time-and-mobile-profile.md`、
  `docs/research/detail-pane-alignment-and-spaced-review.md:101 → trash-and-archive-best-practice.md`
  与 `→ ../plans/trash-and-archive.md`。按红线不代改、不吸收凑绿。
- **落地形状更新**：`git rev-list --left-right --count main…HEAD = 0/66` ⇒ main 已是集成线的祖先，
  ① 的后半（本地 main 快进）在链读数取完之后做；本线五笔（`b728ff3c`…`50ddb3ce`）
  与 `dd8f2210`/`f2d7ed40`/`fd34c42a` **均不在 main 里**（逐枚 `--is-ancestor` 量过）。
- **② 仍未取全链读数**：合并后 `node scripts/check-ai-coverage.mjs` 因新载体没有构建产物而 rc=1
  （它报的是"上游读不出/建不出 ⇒ 无法判定"，与规则 7 同一族），跑全段要先 `pnpm -r build`，
  而 `vm.loadavg` 在 21:5x 是 `74 → 115`（重启后全体进程复活的风暴），闸门阈值 12 ⇒ 不起跑。

## 15.27 合并态逐段读数（载体 `heyta-wt-ai-closeout` @ `43ef4a22`，2026-10-03 22:0x）

第一次在**重启后的新载体**上取到全链逐段读数。工具：`~/scratch-heyta/heyta-chain.sh`
（负载门用单一所有者 `scripts/lib/wait-for-quiet-host.sh`，阈值不动；段名与顺序**现取** `package.json`）。
`pnpm -r build` rc=**0**。链 61 段：**56 绿 / 4 红 / 1 段按规则不跑**。四条红逐条归属，没有一条是本线的：

| 段 | 判据 | 性质 | 归属证据（都可复跑） |
|---|---|---|---|
| 33 | `check:docs` rc=1 | **继承自 main** | 4 条死链的引用行在 `git show main:` 里就有、目标文件在 main 树上就不存在（§15.26） |
| 53 | `check:privacy-consent-e2e` rc=1（5s） | **环境无效** | 失败原文是 `error: unknown command 'test'` + `Local package.json exists, but node_modules missing` ⇒ 新载体的 `e2e/node_modules` 没装。用时 5 秒也证明它没跑到浏览器 |
| 54 | `check:landing-e2e` rc=1（1s） | **环境无效** | 同上，1 秒 |
| 61 | `pnpm -r test` rc=1 | **不在本线的产品红** | `packages/ui` 的 `tests/projects-model.spec.ts:96` 失败（`toOrganizerTree` 节点多出 `archived` 键）。本线在 `packages/ui/` 下改动 **0 文件**；`src/projects/model.ts` 与该 spec 两侧**逐字节相同** ⇒ main 单跑同样红。最后一动是 `192a516d`（17:53） |

- 🔴 **第 61 段这条不是"一条用例红了"那么轻**：那句断言写的是"每一层都只有 `id / name / children`
  —— **不把整个实体漏出去**"。现在节点里多了 `archived`，也就是**界面层的投影承诺已经和代码不一致**。
  它和 `B56`（侧栏清单名被挤成零宽）出自**同一笔** `192a516d`，是同一次改动留下的第二个形状。
  ⚠️ 两种可能都成立：要么投影该剥 `archived`（代码错），要么 `archived` 是新加的必要字段（测试该更新）——
  **判这个要改的人拍，本线不代改、不为绿而改别人的测试**。待 `BLOCKED.md` 空闲时立 `B59`；
  现在先记在本节，因为共享台账正被并行会话写着（上一次往里追加的代价见 `B56` 的归属段）。
- **覆盖面门禁在合并 + 构建态 rc=0**。它现在的读数形状是 main 侧那笔带进来的**按端枚举**：
  `界面端覆盖：mobile 0/5（显式登记的缺口：产品负责人 2026-10-03 拍板"AI 上移动端这轮不做"…见 BLOCKED B34）`
  ⇒ 本线原先"覆盖面 8/8"那句仍然成立（实体维度），但**它不再是全部门禁读数**，别拿它代替端维度。
- **`check:ai-e2e` 按规则不跑**（它的前置会 SIGKILL 4318/4319 上的 vite，traps #87），
  记 `rc=SKIPPED_BY_RULE`，**不算通过**。合并态这一段的真实状态**仍未判定** —— 补跑脚本
  `~/scratch-heyta/heyta-e2e-rerun.sh` 已经写好（那一腿**去掉前置**直跑 `pnpm --dir e2e run test`），
  但 22:0x 起跑前实测 `vm.loadavg = { 270 105 62 }`（16 核），占 CPU 的是**另一个项目**
  （`…/ssos/.worktrees/inv-ship-rec/services/api` 的 vitest + postgres INSERT）加重启后的
  `mds_stores` 索引 ⇒ **环境无效**，不起跑、不降级判据。
- **落地仍未做**：`heyta-land.sh` 的前置 1 在 22:0x 正确拒绝过一次 —— main 在合并完成后
  又前进了（`96f3293d → 3a3071e1`），"可直落"是时刻性读数。现量：
  `git -C <主检出> merge-base --is-ancestor main integrate/2026-10-03-closeout`。

## 15.28 Goal 四件事逐项对账（22:1x；**未闭合项写明卡在谁手里**，不给"差不多齐了"）

本轮（重启之后）新增的六笔：`50ddb3ce`（规则 7 修复 + §15.25）/ `75acfe3f`（并 main）/
`43ef4a22`（§15.26）/ `eec1ab3b`（§15.27 逐段读数）/ `57e5380f`（`B59` 立账 + PROGRESS 续段）/
`9dbe1e44`（更正我自己写的"四个读取点"与缺目录的文件名）。

| 项 | 状态 | 证据 / 卡点（都可复跑） |
|---|---|---|
| ① 合并成一条集成线 | ✅ 做完 | 三分支 tip 都在载体里（`git merge-base --is-ancestor` 逐枚真）；`main → 集成线`已并（`75acfe3f`，2 处冲突按并集无损） |
| ① 落到本地 main | ⏸ **卡在并行会话，不绕** | 22:1x 现量：主检出 `git status --porcelain \| wc -l` = **331 项未提交**（含 `AGENTS.md`、`PROGRESS.md`、`package.json`），且 main 在 6 分钟内又前进 3 笔（`e3312dba`）。不 stash 别人的东西、不 `branch -f` 换掉他们脚下的 HEAD。入口：`~/scratch-heyta/heyta-land.sh`（三条前置任一不成立 exit 1，`--confirm` 才 `merge --ff-only`，不 force、不 push） |
| ② 干净检出 build + 全链逐段 | ✅ 取到 | 载体 `heyta-wt-ai-closeout` @ `43ef4a22`：`pnpm -r build` rc=0；61 段 = **56 绿 / 4 红 / 1 段按规则不跑**；四条红逐条归属见 §15.27（1 条继承 docs、2 条环境未装依赖、1 条 `B59` 产品红）|
| ② 三段 e2e 的真实读数 | 🔄 **等安静窗口** | 依赖已补齐（`e2e/node_modules` 装好，playwright 1.63.0）；跑批器 `~/scratch-heyta/heyta-e2e-when-quiet.sh` 挂在单一所有者负载门后（阈值 12 不动，耐心 3600s）。22:1x 负载 `12.25 / 75 / 76`，占用者是**另一个项目**（ssos 的 vitest + postgres）加重启后的 `mds_stores` |
| ③ 四端重装 | ⏸ **未跑** | 前置逐端现量：mac 签名身份 4 枚可用 ✓；android `emulator-5554 device` ✓；**ios 无 Booted 模拟器**（脚本 `:362` 会响亮报"先 boot"，且它自己会把 Pods 与 `Podfile.lock` 对账）；windows-pc `ssh` 可达 ✓。快捷方式的实现与判据在合并态核过（`apps/desktop-windows/scripts/install-and-capture.ps1:82/110/236` 产出 `SHORTCUT_OK=`，`scripts/lib/msix-install-facts.sh` 五项清单由 `reinstall-all.sh:249` **一处**读）。**不提前宣称任何一端装上** |
| ④ 台账逐条收口 | 🔄 进行中 | `PROGRESS.md` AI 节加了 22:0x 续段（载体易址、① 的"零冲突"预演不等价于 main 那次、② 读数被新的 56/4/1 取代、③ 两处我自己写错的句子就地更正）；`BLOCKED.md` 立 `B59`；`environment-traps` 现量 **189 条 / max 180 / 真实重号 38·93·94·95**（`grep -oE '^[0-9]+\. ' … \| uniq -d`，`1 2 3 4` 是内部有序列表被行首模式误抓，属计数噪声）；死链：合并态 4 条**全部继承自 main**，本轮追加文本自身新增 **0** 条 |
| ④ AGENTS §9 候选行 | ⏸ 排在落地之后 | 载体里 `AGENTS.md` 干净可改，但 §9 那句要写的是"已落到 main"这个状态 —— **落地没发生就不能先写**。登记在 `B56/B57/B58` 的关闭判据里 |

🔴 一条元结论（今天第二次撞上）：**"预演过零冲突"不等于"合并没有冲突"**。
14:4x 那次 `merge-tree` 预演对的是"三个分支之间"，22:0x 真合并对的是"main 与集成线"，
输入变了结论就作废 —— 凡是把预演结果写成"已验证"的地方，都要带上它验的是哪一次。

## 15.29 五条隐私红线在**合并且已构建**状态下的现量（载体 `heyta-wt-ai-closeout` @ `4ee6e76a`，22:2x）

§15.18 那次是对着**分支**逐条读到判定机制的；这一节是合并进 main 之后重取一遍，
并补上 §15.18 当时没量的那一列：**每条判据现在由谁自动消费**（"谁在守"和"守的是什么"是两列，
只写前者就是那句会漂的抄件）。

| 红线原句 | 判定机制住在哪 | 合并态现量 | 自动消费者 |
|---|---|---|---|
| AI 类型上产不出 op | **不是某条门禁，是包管理器的物理事实**：`packages/ai` 零依赖，`node_modules` 里只有 `tsup / typescript / vitest` ⇒ `@heyta/op-log` 在这个包里**根本解析不到** | `packages/ai/src` 对 `createOp\|OpLogRecord\|@heyta/op-log\|@heyta/sync-core\|dispatch(` 命中 **2**，两处都是 `provider.ts:14/16` 的注释（ADR-0005 §3.1 的说明原文），代码 **0** 处；`package.json` 的 `dependencies` 与 `peerDependencies` 均不存在 | `pnpm -r build`（本轮 rc=0）+ 链第 03 段 `check:typecheck` —— 有人想让它能产 op，第一步必须往 `packages/ai/package.json` 加依赖，而那一步会立刻出现在 diff 里 |
| `host.submit` 全仓恰好一处 | `check:ai-tools` 规则 2（RUN_FILE 恰好 1 次且落在 `confirmAiToolProposal()` 之后）+ 规则 8（MCP 入口恰好 1 次且落在 `executeTool()` 内）+ 规则 9（全仓写入口**可穷举**：清单外出现 `host.submit(` 即红） | 真实调用点 **2 处**：`packages/app-host/src/ai-tool-run.ts:195`、`packages/local-api/src/server.ts:545`（`server.ts:481` 与 `ai-tool-run.ts:188` 是注释表，剥注释后不计数）；端口的接法见下面"勘误"那条划线链 | 链第 36 段 `check:ai-tools`（本轮绿） |
| 逐工具默认关 | `packages/local-api/src/tools.ts:337-339`：`return grants?.[toolName] === true;` —— 缺键 / `undefined` / `false` 三种形态**一律拒**，没有"默认开"的分支 | 逐字读回原函数体，合并态未变 | `check:ai-tools` 规则 3-6 + `packages/local-api` 那 146 条测试 |
| 出境逐字段披露 | 承诺住在**工具目录**的 `LocalApiTool.egressFields`，真实载荷住在 `projectForTool` / `projectListForTool`，判据是"**实际跑一遍 `runReadTool`、收集载荷里出现的键**"而不是读代码列表 | 目录 22（读 10 / 写 12）：读工具声明条数 `list_tasks:6 get_task:7 list_projects:3 list_habits:5 list_tags:2 list_notes:4 get_note:5 list_checkins:3 list_focuses:6 list_reminders:4`（合 45），写工具 12 条**全部空表**，信封 `TOOL_ENVELOPE_EGRESS_FIELDS=["tool.error"]` 单独一份（不逐工具抄成六份） | `packages/local-api/tests/tool-egress-fields.spec.ts` **9 tests 绿**（`chain-2200/segments.log:1447`；该包 `Test Files 7 passed / Tests 146 passed`，`:1450-1451`）。其中"遍历整份目录"那条**以目录本身为取样清单** ⇒ 新加一个读工具不会被"判据没铺到它"漏掉；另有 `ownerPhone` / `streakDays` 两条阳性对照，证明这条判据真有牙齿 |
| 回退不跨越隐私边界 | `fallback-needs-consent` 这个失败形状（本机端点挂了**不许**悄悄改发云端，一次请求都不发）；`retention-undecided` 挡住 `managed` | 命中 **8** 处（上一轮 §15.18 是 6 处 —— 方向是**变严**，不是被削弱）；`retention-undecided` **4** 处，`assertEnableable()` 仍抛，托管 AI 未开 | `packages/ai/tests/routing.spec.ts` + `assistant-limits.spec.ts`（在 `pnpm -r test` 里） |

🔴 顺带把 `CURRENT_SCHEMA_VERSION` 一并现量：值 **1**，本轮未 bump；新持久化字段全部可选带运行时默认值
（助手会话历史那条按 D-4(i) 根本没进 op-log，所以连字段都没新增）。

### 勘误（23:3x，尖端 `6b6449a7` 重跑指针时查出来的）：上表那格 `host.ts:331-332` 路径写得不完整

我重跑这条指针时先按 `packages/local-api/src/host.ts` 去找 ⇒ **文件不存在**，差点就把这格判成
"指针坏了"并重写成别的。**先别改，先把歧义解掉**：`host.ts` 这个名字在仓里有三份
（`packages/app-host/src/host.ts`、`apps/node-host/src/host.ts`、`apps/desktop/src/host.ts`），
而我那一格指的是**第一份**，它现在仍然逐字成立：

```
packages/app-host/src/host.ts:331  async dispatch(intent: OpIntent): Promise<void> {
packages/app-host/src/host.ts:332    await engine.dispatch(intent);
```

所以这一格的缺陷不是"值错了"，是**路径不完整 + 把三跳压成一跳**。完整那条链是：

```
host.submit 调用点（ai-tool-run.ts:195 / server.ts:545）
  → 端口 submit: (intent) => submitIntent(…)      packages/app-host/src/local-api-host.ts:423
  → async function submitIntent(…)                 packages/app-host/src/local-api-host.ts:455
  → 各 *Actions 经 ActionContext 的 ctx.dispatch(…)  （同文件 :310 那段注释就是讲这个）
  → packages/app-host/src/host.ts:331 → engine.dispatch()
```

📌 一般规律两条：**仓名相同的文件必须带目录写**（本仓 `scripts/windows/` 与
`apps/desktop-windows/scripts/` 两处都有 ps1，是同一件事的第二次）；
以及**"指针查不到"先怀疑自己按错了目录**，不要立刻把一条成立的证据划成错的 ——
我这次如果直接改，就会把一条真证据改坏，而那正是这张表存在的目的。

⚠️ 同一趟里还撞到一个**假 0**：我用 `grep 'grants?\['` 去找第 3 条那行，返回空，
读起来像"fail-closed 那行没了"。其实是 BRE 里 `?` 是字面量、`[` 开了个未闭合的字符类
—— **模式自己坏了**。`sed -n '337,339p'` 现量那三行仍然逐字是
`export function isToolGranted(…)` / `return grants?.[toolName] === true;` / `}`，第 3 条未变。
（同族教训：正则的 0 命中一律先证明模式自己会命中。）

### 这一节自己走错的一步（值得留着）

我第一趟量第 4 条时，把正则打在了 `packages/ai/src/capability-manifest.generated.ts` 上，
得到 `egressFields: 出现=0`。**0 命中不是红线被破坏，是我找错了对象**：
那份产物是**给模型看的语料**（工具目录 + 实体清单的生成物），出境承诺的真源在 `local-api` 的工具目录里。
如果我当时把"0 命中"当成违规，就会去"修"一份本来正确的产物 —— 而那正是 `check:ai-tools` 规则 7
要防的"手改产物 = 给模型写一句谎话"。判据读不到东西时，先确认**读的是不是承载它的那份**。

另一个同类的操作陷阱：全仓 `grep` 不带路径限定时命中了 `apps/landing/dist/assets/*.js`
（压缩产物，里面 `form.submit()` 这类字样成千上万），单次输出 10 MB。
**扫源码必须显式限定 `src` 与扩展名**，否则真正要看的那 2 处会被冲掉。

### ② 的 e2e 三条腿读数（载体同上，日志 `~/scratch-heyta/e2e-rerun-2214/`，22:1x）

| 腿 | 退出码 | summary 行 |
|---|---|---|
| `privacy-consent` | 0 | `7 passed (7.7s)` |
| `landing-e2e` | 0 | `17 passed (1.0m)` |
| `ai-e2e` | `ENV-BUSY(port=4318)` | `端口 4318 被占（node,56997）⇒ 记 ENV-BUSY 跳过，不 SIGKILL、不复用别人的服务器` |

第三条**没有降级判据**：`check:ai-e2e` 的前置会把 4318/4319 上 LISTEN 的进程 SIGKILL
（traps #87），而那两个端口此刻的主人是**另一个会话的 linked worktree**
（`heyta/.worktrees/detail-pane`）。为了拿一个"绿"去杀掉别人正在跑的 dev server 不是验证，
是破坏 —— 所以这里如实记 `ENV-BUSY`，重跑入口留在 `~/scratch-heyta/heyta-e2e-rerun.sh`。

## 15.30 第二次把 main 并进集成线，与"落地卡在哪个具体文件上"的量化（载体 `d5348ceb`，22:2x）

### 合并

22:2x 现量：main 又前进 **3 笔**（`3a3071e1 / 6e90df77 / e3312dba`），动的文件**只有 3 个**
（`BLOCKED.md`、`docs/plans/countdown-batch2-handoff.md`、`docs/plans/multi-end-coverage-handoff.md`），
全部纯 docs。先用 `git merge-tree --write-tree` **只读**预演（不碰工作树）⇒ rc=0 且不打印任何冲突文件名，
再执行真合并 `d5348ceb`（`merge-base --is-ancestor main HEAD` = YES，载体领先 main **73**，工作树 0 未提交）。

合并态复核（因为①的落地判据是"这条线本身可信"）：

| 复核项 | 读数 |
|---|---|
| `pnpm check` 链段数 | 载体 HEAD **61** 段（`check:ai-coverage` 第 51、`check:ai-e2e` 第 52、末段 `pnpm -r test`）；主检出工作树 **62** 段 —— 那 1 段差是别人的未提交改动，不是这条线的属性（§15.27 那句"报段数必须带载体"仍然成立） |
| 死链 | 仍 **4 条 + 1 处失效章节引用**，逐条归属：`PROGRESS.md:1424` 属提交 `96f3293d`（并行会话的 A/E/D 那条），`detail-pane-alignment.md:4`、`detail-pane-alignment-and-spaced-review.md:101`（×2）、`countdown-anniversary.md:1280` 全在本线之外。**本轮新增文本自身新增 0** |
| 🔴 为什么 `PROGRESS.md:1424` 那条我不改 | 它虽是别人**已提交**的死链，但 `PROGRESS.md` 此刻在主检出里是**未提交脏文件**（在下面那 15 个交集里）。在别人正在写的文件里改一行，下一步就是替他暂存或与他冲突 —— 登记而不代改 |
| `environment-traps` 编号 | **189** 行 / 最大号 **180** / 重号 **38·93·94·95**（`1 2 3 4` 是内部有序列表被行首模式误抓，属计数噪声）—— 与合并前逐字相同 |
| `BLOCKED.md` 的 B 号命名空间 | 新登记 **B60**（`grep -cE '^#+ *B60'` = 1）；同一次现量照出**本文件本来就有**的重号 **B30 / B31 各 2 处** ⇒ "我取到的号唯一"只证明我没撞别人，不证明这套编号体系干净（§15.24 那次撞车的根因是同一个：没有一条门禁在管 B 号唯一性） |

### 落地三条前置的现状（这次落成**文件清单**，不落成"还是没落地"）

`~/scratch-heyta/heyta-land.sh` 的三条前置在 22:3x 逐条现量：

1. **前置 1（目标包含 main）✅ 成立** —— 就是上面那次合并换来的。
2. **前置 2（主检出工作树干净）❌ 不成立**：`git status --porcelain` = **343 项**。
   这一条原来是整句"别人没提交"，现在量出了**它到底卡在哪些文件**：
   合并要改的 83 个文件 ∩ 主检出的脏文件 = **15 个**，逐枚是
   `PROGRESS.md`、`docs/plans/README.md`、`docs/reference/environment-traps.md`、
   `packages/app-host/src/{local-api-host,reminder-actions}.ts`、
   `packages/app-host/tests/{local-api-host,reminder-actions}.spec.ts`、
   `packages/domain/src/capture.ts`、`packages/domain/tests/capture.spec.ts`、
   `packages/i18n/src/locales/{en,zh-CN}.ts`、`packages/local-api/src/{tools,mcp}.ts`、
   `scripts/mutate-closeout-gates.sh`、`scripts/reinstall-all.sh`。
   ⇒ 这 15 个不是"泛泛的脏"，而是**提醒投递线（reminder-actions/local-api/i18n）和 W 臂那条线（mutate-closeout-gates.sh）正在写的文件**，
   与我要落的内容直接重叠。快进它们脚下会覆盖未提交改动，所以这里**不是保守，是有主**：
   等这 15 个文件被各自所有者提交，`heyta-land.sh --confirm` 一条命令就落。
3. **前置 3（当天逐段读数文件）✅ 成立**（`~/scratch-heyta/chain-2200/segments-rc.txt`）。

### 一个开了又没用的窗口，和为什么不用它

22:28 现量：4318/4319 **已经空了**（`lsof -sTCP:LISTEN` 无输出）—— 也就是 ② 最后那段
`check:ai-e2e` 那一刻是能跑的。**我没有跑**，理由是量出来的而不是感觉：
同一时刻 ③ 的守门正在等它的窗口（`gate.log`：22:25 拿到干净采样 1/2，随后连续 4 次
"对端在跑"，负载 `10.47 / 22.91 / 44.01`）。`reinstall:all` 要连跑四段重构建（mac 打包 +
远端 MSIX + APK + xcodebuild），而 e2e 那一套要起 vite dev + 假端点再把 41 个 spec 文件跑完
—— **同跑两件事的结局是两边的读数都不能解释**。
③ 是 Goal 的交付项，② 的那段已经有"按规则不跑"的如实记录，所以把窗口让给 ③。

顺带量清了一件以后还会问的事：**离线主套件不能靠"换个端口"绕开别人**。
4318/4319 不是配置项而是字面量：现量 **31 处、分布在 15 个文件**里 ——
`playwright.config.ts` 7 处（`baseURL` + 两条 `webServer`）、`stub-provider.mjs` 5 处，
其余散在 `tests/helpers.ts`、`smoke.spec.ts`、`inbox.spec.ts`、`admin-console.spec.ts`、
`ai-duration.spec.ts` 等 spec 里自己写死。仓库的隔离模式是**另开一份 config 用自己的端口**
（4322 privacy / 4323 legal-reconfirm / 4328 multi-end / 4329 auth / 4330+4332 legal-links / 4401 password-web），
而离线主套件刻意不换端口 ⇒ 想跑它只有"等 4318/4319 空"这一条路；
把 31 处字面量改成变量等于**长出第二套抄件**，那正是本仓库反复付学费的形状。
（这套的规模也顺便量了：`e2e/tests/*.spec.ts` **41 个文件**，不是"跑一条很快"的量级。）

## 15.31 把 ② 的读数从"旧 tip"搬到"当前尖端"：增量是纯文档，且六条只读门禁在尖端重取（`8ef01c5e`，22:3x）

② 的 61 段逐段读数取在 `43ef4a22`（§15.27）。此后尖端又走了 **10 笔**（本线 7 笔台账/门禁修复 +
从 main 并进来的 3 笔）—— 这句是 `git rev-list --count 43ef4a22..HEAD` 现量的，不是我数提交信息数出来的。
**"因此旧读数仍然代表当前尖端"这句是要证的**，证法是增量文件集：

```bash
git diff --name-only 43ef4a22..HEAD      # BLOCKED.md / PROGRESS.md / ai-event-tool-contract.md
                                         # / countdown-batch2-handoff.md / multi-end-coverage-handoff.md
git diff --name-only 43ef4a22..HEAD | grep -vc '\.md$'    # 0
```

⇒ 增量**没有任何一个非 `.md` 文件**，所以那 61 段里凡是不读 `.md` 的段，输入字节逐字未变。
在此基础上，把**只读且便宜**的六段在尖端重取了一遍（不写盘：跑完 `git status --porcelain` = 0）：

| 段号 | 门禁 | 尖端 rc | 一句话读数 |
|---|---|---|---|
| 08 | `check:layering` | 0 | `apps/*` 没有重新长出业务/接线 |
| 19 | `check:docs` | **1** | 4 条死链 + 1 处失效章节引用，**逐条归属见 §15.30**，全部在本线之外；本轮新增文本自身新增 0 |
| 36 | `check:ai-tools` | 0 | 九条规则全过；规则 9 穷举 **20 个 src 根 / 585 个源码文件**，`host.submit(` 命中 **2 处 = 清单**；两个写入口各自恰好一处；`describeRoutedFailure()` 定义点恰好一处；**能力清单与上游一致**（规则 7 的修在尖端复验，见 §15.25） |
| 51 | `check:ai-coverage` | 0 | 目录 22/40 席；5 个 AI 功能 web 端到端可达；**缺口端 mobile 0/5** 照旧大字打印 |
| — | `check:ui-language` | 0 | 界面零硬编码文案 |
| — | `check:migrations` | 0 | 迁移形状合规 |

段号是从 `package.json` 的 `check` 串现取的（61 段，`check:ai-coverage` 第 51、`check:ai-e2e` 第 52、
`check:layering` 第 8、`check:docs` 第 19、`check:typecheck` 第 3）—— 上一节表里写的段号也是这么核对的，
不是凭记忆。**剩下的段（`-r build` / `-r typecheck` / `-r test` / 各端 shell 门禁）没有在尖端重跑**：
它们的输入未变，而此刻这台机器的窗口属于 ③ 的四端重装 —— 见 §15.30 末段那条取舍。

## 15.32 ③ 第一次真跑的实际结局：windows ✅ 五条齐、mac 🔴 卡在启动自截屏、mobile 被我主动中止（22:36–22:42，载体 `133550d7`）

守门在 22:28–22:36 之间放开（连续两次干净采样），`step3` 于 **22:36:22** 起跑，
起跑现场由脚本自己记进 `state.log`：载体 `133550d7`、工作树未提交 **0**、android `emulator-5554 device`、
windows-pc `REACHABLE`。跑出来的四段是**三种不同性质**的结果，逐段分开写：

| 段 | 结果 | 读数（只认脚本自己打的判据行） |
|---|---|---|
| 1 macOS | 🔴 **红**（未装上） | `package-app.sh` 在"④ 启动验证"处失败：`sandbox_extension_issue_file_to_process failed for /tmp/heyta-macos-dist/Heyta.app: 1 (Operation not permitted)` + ScreenCaptureKit `-3811 "音频/视频捕捉失败，无法开始流播放"` + `截图失败（多半是没给屏幕录制权限）`。签名那一段是好的：`valid on disk` / `satisfies its Designated Requirement` / `Authority=Developer ID Application: …(V5S2LT9YV8)`。**因此 §6.1.1 表里"装新"那一步从没执行** —— 现量：`/Applications/Heyta.app` 的 mtime 还是 **19:05**，而 `/tmp/heyta-macos-dist/Heyta.app` 是 **22:37** |
| 2 Windows | ✅ **五条判据全在位** | `✅ 源码包 31M（跟踪 + 未跟踪 + web-dist + bridge-bundle）` → `✅ 远端新鲜度对账通过（web-dist/index.html=217cae2a252d8948… bridge=bae7d24d7a6a5320… assets/*.js=7 枚一致）` → `✅ 远端打包 + 安装 + 启动截图完成` → `✅ 远端取证：判据齐了：5 条全在位`。**这五就是 `scripts/lib/msix-install-facts.sh` 那份清单**（`ADD_APPX=OK` / `RESULT=OK` / `PAYLOAD_WEBDIST=True` / `M2D=OK` / `SHORTCUT_OK=True`），**用户点名的"自动创建快捷方式"这项第一次随真跑绿到** |
| 3 Android | ⏹ **我主动中止**（不是失败，是环境不许并行） | 22:41:18 现量：`═══ 3. Android ═══` 刚进构建阶段（gradle `assembleRelease` + NDK 编 op-sqlite），而**并行会话的 `verify-mobile-reminder-ring.sh`（pid 50463）正跑在同一台 `emulator-5554`** 上、它的 iOS 侧 `verify-mobile-ios-reminder.sh`（57432）+ `xcodebuild`（57745，另一枚模拟器 `1EDCFA59-…`）也活着。Android 段的下一步就是 `adb uninstall` —— 那会把别人正在验的那台设备的应用与数据清掉。AGENTS §8 第 9 条明确禁止并行覆盖共享设备，所以 kill 的是**我自己这一段**（`kill 29284 28925`），取证写在 `~/scratch-heyta/reinstall-2236/ABORTED-mobile.txt` |
| 4 iOS | ⏹ **未起跑** | 同上中止，从未执行 |

中止后恢复现场：那一段 gradle 在载体里留下一个未跟踪的 `apps/mobile/android/.kotlin/`（构建缓存，
会被 `git ls-files -co` 当"未跟踪非忽略"送进 Windows 的源码包），已 `rm -rf` 掉，
现量 `git status --porcelain` 回到 **0**。**这条不是洁癖**：如果留着它再跑一轮，
Windows 段的"远端 == 本地工作树"对账就变成"远端 == 一个带脏缓存的树"。

### 为什么这不能算 ③ 完成，也不能算 ③ 失败

`reinstall-all.sh:200` 的形状是 `if bash package-app.sh …; then` —— mac 段**在打包脚本内部**红，
整个脚本按 §6.1.1 应当以 rc=1 收尾。所以：
- 四端里只有 **1 端**（windows）拿到了"装上且是当前产物"的判据；
- mac 端连"装新"都没发生 ⇒ `/Applications` 里那份是 19:05 的旧产物，**不能报"mac 已装"**；
- android/ios 是被我按规则停的，**按环境无效记录**，不降级、不拿旧包凑。

### mac 那条红的两个候选归因（都还没证，所以先都写着）

1. **启动上下文**：`sandbox_extension_issue_file_to_process … Operation not permitted` 是宿主侧给被测
   `.app` 发沙箱扩展那一步被拒 —— 同一台机器上我的 shell 跑 `screencapture -x` 是**能出图的**
   （现量 1 853 045 字节的合法 PNG），所以"整机没有录屏权限"这条**已被否证**；
   剩下的解释是**被启动的那个 `.app` 处在没有该授权的启动上下文里**（从 agent 后台任务起的进程）。
2. **僵尸实例**：`ps` 现量 `/Applications/Heyta.app/Contents/MacOS/HeytaMac` 已跑 **1:11:27**（≈21:33 起），
   而 mac 段的"卸旧"没动过它 —— 这是 traps #81.3 那个形状（同名旧实例污染窗口/截图取证）。

判这个只需要一次隔离复跑：`bash scripts/reinstall-all.sh --only mac`（`--only/--skip` 在 `:162-166`），
先把 21:33 那个旧实例处理干净再起跑。**没有在 22:4x 就做**是因为这台机器此刻还压着并行会话的
两条设备验收（负载 22:41 现量 `95.76 / 86.87 / 60.58`），再挂一段重构建会把别人的窗口挤没。

## 15.33 ③ 的第二趟：负载判据交回单一所有者，以及编号台账的一次现量复核（载体 `8a947a16`，23:0x）

### 一、负载这一半我不再自己写（两次抄件都是坏的）

`~/scratch-heyta/heyta-reinstall-gated.sh`（新）取代 `heyta-reinstall-mobile.sh`：
负载判断整段交回仓内的单一所有者 ——

```bash
. "$CARRIER/scripts/lib/wait-for-quiet-host.sh"
wait_for_quiet_host || exit 3          # HEYTA_LOAD_GATE_WAIT=1800
```

**为什么要交回**：今晚我在这台机器上手写过两版负载判据，两版都是坏的，而且坏的形态互不相同 ——

| 版本 | 写的是什么 | 真实行为 |
|---|---|---|
| `heyta-reinstall-gate.sh`（22:36 那趟用的） | `L1=$(printf '%s' "$LOAD" \| awk '{print $1}')` 只**打印** | 从未参与判定 ⇒ ③ 的第一趟是在负载 ~20–40 上起跑的（B61 里"那次 mac 段同时压着并行构建"就是这么来的） |
| `heyta-reinstall-mobile.sh`（22:48 那趟） | `tr -d '{} ' \| cut -d, -f1 \| tr -d '.'` | 去空格把 `vm.loadavg` 的三个数**粘成一个 12 位整数** ⇒ `-le 12` 恒假 ⇒ 闸门会等满上限后 exit 3，症状与"环境一直不干净"逐字相同 |

`wait_for_quiet_host` 读的是 `uptime`（traps #168 已经把那个坑踩平并写在函数注释里）。
**我两次都是绕开它自己重写，两次都重新踩了它注释里明写着的那条** —— 这就是 AGENTS §3.5
那句"抽出来不等于重复被消除"在闸门上的版本。设备占用那一半**留在**我的脚本里，
因为仓内确实没有所有者（B62 要拍的就是那把锁）。

新脚本还做了一件事：**闸门有负向对照**。23:01 投放时现量对端命中 3（并行会话的
`.verify-mobile-ios-reminder.sh.snap.4230` 及其子进程）⇒ 日志立刻打"对端在跑…⇒ 等 20s"，
23:03 三次干净采样后才放开。之前那两版的坏之所以危险，就是它们**从不产生"我在等"这一行**。

### 二、`setsid` 在 macOS 上不存在：一次"进程根本没起来"被读成"闸门在等"

第一次投放写的是 `nohup setsid bash … &`。`nohup: setsid: No such file or directory` —— 任务当场死掉，
`gate.log` 一行都没多。**这个症状和"闸门正在等窗口"在日志上几乎分不开**（都是"没有新行"），
区别只在 `ps -p $PID`。改成 `nohup bash … < /dev/null > out 2>&1 &` + pidfile 守卫后起跑正常。
⇒ 投放后台跑之前必须先 `ps -p` 证明它在，而不是看日志有没有新行。待入 traps。

### 三、B60 那个"15 个文件"的交叠，23:0x 重取**仍然是 15**

现量命令（可重跑）：

```bash
git -C <载体> diff --name-only main...integrate/2026-10-03-closeout | sort -u > /tmp/carrier-files.txt   # 83 个
git -C <主检出> status --porcelain | sed 's/^...//;s/ -> .*//' | sort -u > /tmp/main-dirty.txt            # 356 个
comm -12 /tmp/carrier-files.txt /tmp/main-dirty.txt                                                        # 15 个
```

逐条：`PROGRESS.md`、`docs/plans/README.md`、`docs/reference/environment-traps.md`、
`packages/app-host/src/{local-api-host,reminder-actions}.ts`、
`packages/app-host/tests/{local-api-host,reminder-actions}.spec.ts`、
`packages/domain/src/capture.ts`、`packages/domain/tests/capture.spec.ts`、
`packages/i18n/src/locales/{en,zh-CN}.ts`、`packages/local-api/src/{mcp,tools}.ts`、
`scripts/mutate-closeout-gates.sh`、`scripts/reinstall-all.sh`。
主检出 HEAD 仍是 `e3312dba`（23:0x 现量），所以落地这个动作**没有新前提可争取**，
只有等这 15 个文件由各自所有者提交 —— `heyta-land.sh --confirm` 已备好，不重复摸索。

### 四、④ 的编号复核：台账本身有 4 个号被两条不同条目占用（有真影响面）

对 `docs/reference/environment-traps.md`（载体提交态）现量：最大号 **180**，
`^[0-9]+\. ` 命中 **189** 行 / 去重 **176**。

🔴 **先校正探针**：这 13 行的差额**不是台账缺陷**，是嵌套有序列表的 `1. / 2. / 3. / 4.` 被同一条
正则算进去了（`^(\d+)\. ` 对顶格子列表项同样成立）。分开算法就是这一条（B63 引的也是它）：

```bash
node -e '
const fs=require("fs");
const lines=fs.readFileSync("docs/reference/environment-traps.md","utf8").split("\n");
const seen={};
lines.forEach((l,i)=>{const m=l.match(/^(\d+)\. /); if(m){const n=+m[1];(seen[n]=seen[n]||[]).push(i+1);}});
console.log("重号="+JSON.stringify(Object.entries(seen).filter(([,v])=>v.length>1)
  .map(([n,v])=>n+"@"+v.join("/"))));            // 1/2/3/4 是嵌套列表，不是条目号
const e=Object.keys(seen).map(Number).filter(n=>n>4).sort((a,b)=>a-b);
const miss=[]; for(let i=Math.min(...e);i<=Math.max(...e);i++) if(!e.includes(i)) miss.push(i);
console.log("条目号最大="+Math.max(...e)+"  缺号="+JSON.stringify(miss));
'
```

去掉 `1..4` 之后：

| 缺陷 | 现量 |
|---|---|
| **一个号两条不同条目** | `#38`（`:708` 常量当两种单位用 vs `:779` 软键盘吞 tap）、`#93`（`:2450` 手写解析器 vs `:2889` Prefab/JDK 24）、`#94`（`:2491` `base64 -d` 不认 base64url vs `:2908` 共享验收助手假设过时）、`#95`（`:2519` 新镜像+旧 `.env` vs `:2940` Expo 装不进 pnpm monorepo） |
| **缺号** | `1..180` 内缺 `#83 #84 #85 #120`（`#82` 存在，内容是 aka.ms 短链回退 Bing，与 AGENTS §7 索引行"80–83 … #83 探针污染状态"**不是同一条**） |
| **AGENTS.md 内部就有一对二** | `:961 #82` 非空白挡不住错误屏 / `:1048 #82` 重装≠当前源码；`:1008 #83` 探针改变状态 / `:1074 #83` MSIX 纯 ASCII —— 而 §7 自己写着"新的条目追加到 traps 文件末尾，不要写回本文件" |

影响面（消费者集合，不是"应该没人用"）：

```bash
grep -rnoE '(§7[^。]{0,12}第[ ]?(38|93|94|95) 条|第 ?(38|93|94|95) 条|traps #(38|93|94|95))' \
  AGENTS.md docs packages apps scripts --include='*.md' --include='*.ts' --include='*.tsx' --include='*.sh' --include='*.mjs'
```

**13 处 / 10 个文件**。⚠️ 其中 `docs/research/legal-pipl-baseline.md:239,826` 的"第 38 条"是
**PIPL 法条**、不是 traps 引用，所以真实受影响是 **11 处**，其中四处是**验收脚本的注释**
（`scripts/verify-mobile-lists.sh:44`、`scripts/verify-ios-lan-http.sh:133`、
`scripts/lib/mobile-e2e.sh:919,1029` 都写"§7 第 38 条"）—— 脚本注释里指向一个有两个含义的号，
下一位只能猜作者当时想的是"常量两种单位"还是"软键盘吞 tap"（按上下文几乎肯定是后者，但那是读出来的，不是台账给的）。

**为什么不由我改**：修它要同时动 `AGENTS.md` 与 `docs/reference/environment-traps.md`，
23:0x 现量这两个文件在主检出里**都是 `M`**（`PROGRESS.md`、`package.json` 同）。
按 AGENTS §7 的"编号只增不改"和 §8 第 9 条的共享面纪律，这是**要人拍的台账动作**，
登记成 BLOCKED `B63`（含上面那条现量命令），不在别人脏着的状态里就地重排号。
🔴 顺带一条对 §7 索引行自身的批评：AGENTS.md 明写"本文件**不写条数**（写过一次'83 条'，六天后就漂了）"，
但它自己**装着** 82/83 那几条的正文 ⇒ 索引声称"正文在 traps 文件"，而正文有两处住在索引里。
这就是 #38/#93/#94/#95 那四个重号的成因形状：**同一条判断写两处，第二处拿到的是下一个号位。**

## 15.34 ③ 段 2 被**我自己的监视器**中止：按字符串豁免对端不够，要按进程树（23:16 实测，载体 `8a947a16`→`302442fe`）

段 1 两端全绿（读数见 B61 / PROGRESS 的 ③ 表）之后，段 2 起跑 **15 秒**就被我自己的跑动中监视器杀掉：

```
231628 reinstall-all（android+ios）pid=71463
231643 🔴 跑动中发现对端设备验收（命中 1：73326 ）⇒ 中止我自己这段
RC=3 stage=aborted-stage2
```

**这条中止很可能是我自己按死的**，而这不是猜测，是从被监视脚本自己的形状推出来的：
`scripts/reinstall-all.sh` 的 android 段自己会 exec

```
adb -s "$SERIAL" uninstall "$PKG"        # :13 那一步
adb -s "$SERIAL" install "$APK"          # :14
pnpm build:android                       # :10 ⇒ 里面是 gradle
```

而我第一版的"对端"判定只按**命令行字符串**豁免（`grep -v heyta-wt-ai-closeout` 那一类）。
**子进程的命令行不一定带载体路径**（相对路径起的就带不上），于是"我自己的孩子在动设备"
与"对端在动设备"在过滤器眼里是同一个东西。这正是记忆里那条
**"判'别人占着'要排除自己 + 祖先 + 后代"** 的第三次现场。

🔴 **而且这次连事后归因都做不到**：中止行只印了 pid `73326`，没印命令行，
而我杀完就退出、pid 已回收 ⇒ 我无法证明它是真对端还是我自己的子进程。
**监视器在动手之前必须把命中的完整命令行落到日志里**，否则它留下的"证据"只是一个数字。

修了两处，都做了双向对照：

1. **判定沿祖先链豁免**（awk 两趟：先建 `pid→ppid` 表，再对每个候选往上走 ≤40 层，
   链上出现我自己的 pid 就不算对端）。
2. **命中与中止都打印完整命令行**（`pid<TAB>command`）。

| 对照腿 | 造法 | 期望 | 现量 |
|---|---|---|---|
| 豁免自己这棵树 | `bash -c 'sleep 40; : verify-mobile-fake-own' &` 由被测 shell 直接起 | 不出现 | `fake-own 命中数=0` ✅ |
| 真外部进程仍要抓到 | 同一形状但**父进程立刻退出**（被 launchd 收养，ppid=1） | 必须出现 | `80357  bash -c sleep 40; : verify-mobile-fake-external`，`外部命中数=1` ✅ |

第二腿是关键：**只验"不再误杀"的那一腿，一条永不阻塞的监视器和一条正确的监视器长得一样。**
（这与 B62 关闭判据里那句"只验能起跑那一腿不够"是同一条纪律的两个方向。）

⚠️ 顺带一条**本宿主 shell 的坑**（投放后台任务时踩到）：`nohup … & P=$!` 在这套
`eval '…'` 包装下 `$!` **原样落进了 pidfile**（`ps: Invalid process id: $!`），
而任务本身是活的 —— 症状是"pidfile 守卫坏了但进程在跑"。
⇒ 投放后**用 `pgrep -f '<脚本名> <模式>'` 取 pid**，别信 `$!`。已用 pgrep 修回（pid 81615）。

**这一段对 ③ 的读数有什么影响**：段 2 的第一趟（23:16:43 中止）**不算读数**，因为它是被
一个未证实的判定中止的；修完判定后重投 `--confirm-stage2`（23:18:53 起跑，载体 `302442fe`，
起跑时工作树 0 未提交）。`8a947a16..302442fe` 的增量是**纯文档**（`BLOCKED.md` 三节），
所以 android/ios 装出来的产物与段 1 同源 —— 这一点按 §15.31 那条可迁移性论证读，不是按"看起来一样"读。

## 15.35 ① 的第三次吸收 main，与"落地前置其实比 git 自己的守卫还严"这件事（载体 `8abaf476`→`d2cbed67`，23:2x）

### 一、main 又前进了，前置 1 当场失效

`heyta-land.sh` 的 dry-run 打出 `main = 0a61c0a6 → ❌ main 不是本分支的祖先` ——
23:03–23:21 之间并行会话落了 **5 笔 `docs(countdown)`**（只动 2 个文件：
`countdown-anniversary.md`、`countdown-batch2-handoff.md`）。
先做只读预演 `git merge-tree --write-tree --name-only HEAD main` ⇒ **rc=0、零冲突**，
再真合：`d2cbed67`（`ort` 策略，2 文件 +79/−10）。合完现量：`main ⊂ 载体 = YES`、
**待落 87 笔**、工作树 0。**这就是"快进目标随 main 前进而漂移"的第二次现场**（第一次见 §15.30）。

### 二、落地前置的第 2 条原先比 git 自己的守卫还严，而且把 ① 变成不可达

旧前置写的是"**整棵主检出工作树干净**"。23:2x 现量是 **371 项未提交** —— 这台机器上并行会话
随时有未提交项，所以这条**永远不会成立**；而台账 `B60` 写的关闭判据是"**交集为空**"。
**承诺与实现不一致**：下一位跑 `--confirm` 被 371 项挡住，会以为台账在骗人。

去测了一下 git 自己到底按什么挡（独立小仓 `/tmp/landprobe3`，两腿）：

| 腿 | 造法 | 结果 |
|---|---|---|
| A：脏文件**不在**合并更新集合里 | `main` 脏 `untouched.txt`，`feature` 只改 `keep.txt`+`overlap.txt` | `merge --ff-only` **rc=0**，快进完成，且 `untouched.txt` 里那行本地改动**原样保住** |
| B：脏文件**在**更新集合里 | `main` 脏 `overlap.txt`，`feature` 也改它 | git 自己 `Aborting`，**rc=1**，HEAD 未动，本地那行**仍在** |

⇒ **"会不会吃掉别人的改动"这件事，git 已经按路径挡住了**。用"整树干净"去近似它，
既比必要的严、又在这台机器上等于永久拒绝。所以前置 2 改成算**交集**：
`{我的合并要更新的文件} ∩ {主检出未提交的文件}`，非空就拒并**逐文件打出别人的未提交行数**，为空才走。
🔴 这不是放宽证据，是把判据改准：**git 那道按路径的守卫继续留在原地当后盾**，
`--force`／`push` 一个都没加。

改完的真读数（`d2cbed67`）：`✓ 快进成立：87 笔待落` →
`❌ 我的合并要更新 83 个文件，其中 15 个正被别人未提交地改着（主检出共 371 项，其余不重叠 ⇒ 不在挡路范围里）`。
**15 这个数与我 §15.33 第三条那条独立 `comm -12` 算法逐字相同** —— 两条不同实现给出同一个数，
这一条才算这个判据有依据，而不是"脚本自己说几个就是几个"。
（`environment-traps.md` 那一栏从 22:3x 的 `187+/0−` 涨到 **`223+/16−`** —— 别人正在写它，
这也是 B63 那条重号缺陷不由我修的直接原因。）

### 三、附带证到的一条结构性事实（它杀掉了"不动工作树只挪指针"这条路）

探针里顺手撞出来：**`git branch -f main …` 在 `main` 正被某个 worktree checkout 时会被 git 直接拒绝**
（`fatal: cannot force update the branch 'main' used by worktree at …`）。
⇒ 之前想过的那条"我在载体里把 main 挪到集成线、不碰主检出工作树"的省事路**结构上不存在**，
落地只能在主检出里做一次真的 `merge --ff-only`。这句写进 `B60`，省得下一个人再去试一遍。

### 四、① 前半（"三个分支并成一条线"）在尖端重验一遍，因为已经合过三次 main

`git merge-base --is-ancestor <分支> <载体 HEAD>` 现量（尖端 `851a67c4`）：

| 被并的分支 | 在载体里 | 在 main 里 |
|---|---|---|
| `feat/ai-entity-coverage` = `dd8f2210` | ✅ YES | ❌ NO（正是要落的东西） |
| `feat/assistant-history-local-persistence` = `f2d7ed40` | ✅ YES | ❌ NO |
| `integrate/2026-10-03-closeout` = `fd34c42a` | ✅ YES | ❌ NO |
| `main`（`0a61c0a6`） | ✅ YES | — |

待落 **88 笔**，`main..HEAD` 的文件构成：47 `.ts` / 14 `.md` / 6 `.tsx` / 6 `.mjs` / 5 `.png` / 4 `.sh` / 1 `.ps1`。
⚠️ **别用作者数当"这条线是我的"的证据**：我顺手跑了 `git log --format='%an' main..HEAD | uniq -c`，
得到 `88 邓湘雷` —— 看着像"全是本条线的提交"，其实**这台机器上所有并行会话共用同一个 git 身份**，
这个数什么也不区分。真正说明"没夹带别人分支"的是**构造性**的那一条：
载体只合过 `main` + 上面那三个分支，而 `main..HEAD` 按定义不含 main 的东西。
（`88` 而不是 87：这一节自己的提交也算进去了。）

## 15.36 ③ 的最后一端：android 那枚绿是**踩在对端设备上**拿到的，而 ios 这枚我在起跑前查出了同一件事（载体 `3a4d9175`，23:5x）

这一节全部是**现量**，每一条都带可复跑的命令。两件事合起来是同一个缺口的两面：
**这些脚本按"串口/名字"选设备，而设备的所有权既不住在串口里、也不住在那个默认名字里。**

### 1. android 的绿读数成立，但它的代价要先写清（不是环境问题，是我这一侧的动作）

读数逐字取自 `~/scratch-heyta/reinstall-gated-2327/stage2-android-ios.log`（23:35 那趟）：

```
✅ release APK 已重打（ 64M；日志 /tmp/heyta-reinstall-apk.log）
✅ 模拟器 emulator-5554 全新安装成功
✅ 前台窗口确认：  mCurrentFocus=Window{98b625 u0 com.heyta/com.heytamobile.MainActivity}
主蓝采样命中 4001（数的是 heyta-reinstall-android.png）
✅ 窗口 1080x2400、heyta-reinstall-android.png 内容占比 58.3%、主蓝命中 4001 —— 是共享 UI
```

按 §6.1.1 那张表，这一端的四条判据（清旧包 → 重打 → 卸旧装新 → "装上的是当前产物"）**都在位**。
但 23:5x 现量把它的**所有权**查出来了：

| 事实 | 取证 |
|---|---|
| `adb devices -l` 只有 `emulator-5554 device` | 现量 23:51 |
| 它的 qemu 是 pid **36840**，命令行 `-avd heyta-w3-yearly`，21:55:09 起跑（到 23:51 已 1h57m） | `ps -eo pid,command \| grep 'qemu.*-avd'` + `ps -p 36840 -o lstart=` |
| 这台 AVD 的建号时间是 **10-03 12:04**，早于我这一轮任何动作 | `stat -f '%SB' ~/.android/avd/heyta-w3-yearly.avd` |
| 它在仓内的身份是**别人新建的私有设备** | `docs/plans/countdown-anniversary.md:436`「设备 = **新建的私有 AVD `heyta-w3-yearly`**」、`:488`「只 `adb emu kill` 名为 `heyta-w3-yearly` 的设备」 |
| 另一条线**已经点名过这个风险** | `docs/plans/goal-multi-end-coverage.md:771`：`emulator-5554` 的 qemu（那时 pid 25285）= `-avd heyta-w3-yearly`，结论原文「这台 AVD 是**并行会话在用的设备**，`reinstall` 会 `pm clear`/卸装它」 |

⇒ 我那一段执行过 `adb -s emulator-5554 uninstall com.heyta`，也就是**清掉了对方设备上正在被验收的 App 与数据**。
这件事不可恢复，所以不写成"环境复杂"：是我的动作，登记在这里和 `B62`。

**病根一句话：串口相同不等于设备相同。** `scripts/reinstall-all.sh:270`
`SERIAL="${HEYTA_E2E_SERIAL:-emulator-5554}"` 用**串口**选设备，而所有权单位是 **AVD 名**；
我那把 device_gate 扫的是"有没有对端验收**进程**"，它天然看不见"这台 emulator 挂的是谁的 AVD"
（对端的验收脚本可以停在两次进程之间，设备却一直是他们的）。
这正是 traps **#169**（ios 段 `head -1` 盲选）在 android 侧的对应缺口，只是没人写过那条。

**修法本轮不能落进产品脚本**：`scripts/reinstall-all.sh` 此刻在 ① 的那 15 项对端脏清单里
= 别人正在改它。所以本轮只做我这侧的：把"跑 android 段前先把串口解析到 AVD 名、再确认是自己的"
写成前置留在 `B62`，产品脚本里那条断言等它空闲时补。现量三行就够：

```bash
adb devices -l                                        # 串口
ps -eo pid=,command= | grep -o '\-avd [^ ]*'          # 串口 → AVD 名（经 qemu 命令行）
stat -f '%SB' ~/.android/avd/<name>.avd               # 这台 AVD 是谁什么时候建的
```

### 2. iOS 端本轮**不跑**：三台 Booted 全都有主，而这次是查完归属才停的

新写的 `run_ios()`（`--confirm-ios`，理由与代码在 `~/scratch-heyta/heyta-reinstall-gated.sh`）
会把 `IOS_DEVICE_NAME` 与它解析出的 UDID **打进日志**——这条设计是这一节能成立的前提：
没有那行读数，我就只会知道"我选了项目设备"，不会知道它和对端是同一台。

| 设备 | UDID | `com.heyta` 数据最后写入 | 归属证据 | 判定 |
|---|---|---|---|---|
| `heyta-iphone-17pro` | `FE195661-B021-…A102` | 10-03 **19:32** | 对端 `verify-mobile-ios-reminder.sh` 的**盲选回退**恰好落在它（下面那段） | 不能用 |
| `heyta-ios-isolated` | `1EDCFA59-6A9C-…8648` | 10-03 **23:53**（现量前 5 分钟，活现场） | 有人正在用它验；全仓 0 引用 | 不能用 |
| `iPhone Duo heyta` | `742A8651-1A31-…153F` | 10-02 19:35（闲置 28h） | `docs/plans/ui-review-fill-zh-timeline.md:1542` 把它当**别人取证链的证据载体**登记：「iPhone 模拟器 `iPhone Duo heyta` 处于 `Booted`，ios 段要 `simctl uninstall` + 删 Derive…」 | 不动别人的证据 |

🔴 最要紧的一行是**对端脚本的选设备形状**（`scripts/verify-mobile-ios-reminder.sh:74-79`）：
先按 `IOS_DEVICE_NAME`（默认 `iPhone 17 Pro`）匹配，**匹配不到就 `grep Booted | head -1`**。
按他们自己的写法在本机复现：

```
名字匹配结果=[]                     # "iPhone 17 Pro" 在本机不存在
盲选回退结果=FE195661-B021-4A71-AAD1-1F2F7AE3A102
```

`simctl list devices | grep -E '691C20D9|iPhone 17 Pro'` 输出 **0 行** —— 连
`scripts/verify-mobile-ios.sh:82` 写死的默认 UDID `691C20D9-…` 都不在清单里。
⇒ **"我选的项目设备"和"对端的盲选目标"是同一台**不是巧合，是同一个缺口的两面：
脚本用名字选设备，名字在本机不存在，于是所有人最终都落在 `head -1`。

由此得一条 `B62` 该收的**新否证理由**（原来只按负载否证过"另起一台"）：
**给这台机器新启任何一台模拟器都可能悄悄改写别人的设备选择** —— 对端用 `head -1`，
Booted 清单的排序一变，他们的验收就换了一台设备，**而他们不会知道**。
"我这边没装上"可恢复，"别人的验收悄悄换到另一台设备上"不可恢复。

本轮实际动作：`--confirm-ios` 于 23:54:35 起跑，23:55:56 过了设备闸门
（对端 pid 93192 = 主检出里的 `.verify-mobile-ios-reminder.sh.snap.93192` 在 23:54:35/23:54:55
两次命中，23:55:15 起三次干净采样），进入负载闸门（`load 32.56` / 阈值 `12`）。
我在**负载闸门等待期间**把它停了（pid 99764，残留进程现量 0）——
继续等的结果是"负载一落就 `simctl uninstall` 对端正在用的那台"，这正是本轮不该做的事。

⇒ **③ 的现量读数**：mac ✅ · windows ✅ · android ✅（代价见第 1 条）· **ios ⏹ 环境无效（按 exit 3 记）**。
iOS 这端的关闭条件写两条，任一即可：(a) `B62` 那把带 ttl 的认领锁落地；
(b) 一个明确窗口 —— 对端 `verify-mobile-*` 全部结束，**且他们的 `head -1` 指针不落在我要用的那台上**。

### 3. ① 的同一趟现量（没变，所以要把"没变"写成读数）

`main` 仍是 `0a61c0a6`（未前进），主检出脏项 **385**，与载体线 `main..HEAD` 的**重叠文件仍 15 项**，
清单逐字未变（`PROGRESS.md`、`docs/plans/README.md`、`docs/reference/environment-traps.md`、
`packages/app-host/src/{local-api-host,reminder-actions}.ts` 及其两个 spec、
`packages/domain/{src/capture.ts,tests/capture.spec.ts}`、`packages/i18n/src/locales/{en,zh-CN}.ts`、
`packages/local-api/src/{mcp,tools}.ts`、`scripts/{mutate-closeout-gates,reinstall-all}.sh`）
⇒ 落地仍**不可执行**，`heyta-land.sh` 的前置 2 会照样挡下。命令：

```bash
comm -12 <(git -C <载体> diff --name-only main..HEAD | sort) \
         <(git -C <主检出> diff --name-only HEAD | sort)
```

## 15.37 00:0x：载体被并行会话当成**合流点**用了两次，而我在 merge 中途提交不出去（载体 `3a4d9175`→`305212ad`，00:0x）

这一节是**现场记录**，不是计划。全部读数按时间顺序，每条带命令。

### 1. 现场：三件事在 7 分钟内接连发生

| 时刻 | 发生了什么 | 取证 |
|---|---|---|
| ~00:00 | `main` 从 `0a61c0a6` 前进到 **`55bc9c05`**，中间是 `2f735392 chore(wiring): 并行批次的总接线`（14 个逻辑提交的那一批：vault / 向量时钟 / W9 / 回收站 / 日历视图 / 头像 / 法务） | `git -C <主检出> log --format='%h %ct %s' -3` |
| 00:02:20 | **有人在我的载体 worktree 里起了一次 `git merge main`**，3 个文件冲突：`packages/app-host/src/local-api-host.ts`、`packages/app-host/src/reminder-actions.ts`、`packages/app-host/tests/reminder-actions.spec.ts` | `git status` 报 `You have unmerged paths`；`$(git rev-parse --git-dir)/MERGE_HEAD` = `55bc9c05`，`MERGE_MSG` 首行写「吸收 main（2f735392）」 |
| 00:03:42 | 那一次**由他们解完并提交了** `305212ad`（我线的三个提交仍是祖先：`git merge-base --is-ancestor 3a4d9175 HEAD` = YES；`main ⊂ HEAD` = YES） | `git log --format='%h %ct %s' -4` |
| 00:04–00:10 | 同一棵载体里**又起第二次 merge**：`MERGE_MSG` 首行「merge: countdown 批次二主线（W0/W0b/W2/W5/W10 + W4b 的 web 半与后台录入）」，`MERGE_HEAD` = `c36b1d89`（= `feat/countdown-batch2`），00:10 现量 **25 个 `UU`**、工作树脏项 **123**（39 `A` / 56 `M` / 25 `UU`） | 同 `git status` + `git diff --name-only --diff-filter=U` |

🔴 也就是说：**① 的"把几条线并成一条集成线"这件事，正在被别人在我这棵 worktree 里做**，
而且这一次合的是 `countdown 批次二`——`git merge-base --is-ancestor c36b1d89 main` = **NO**，
所以这条合并是批次二**第一次**与我的 AI 线并处，合并态此前从未被任何门禁量过。

### 2. 我在 merge 中途提交不出去（一条 git 的硬规则，不是我的操作失误）

`git commit --only -- <三个台账文件>` 直接 **fatal**：

```
fatal: cannot do a partial commit during a merge.
```

这是设计如此：合并提交的是**整个索引**，`--only`（部分提交）与之冲突。
⇒ 我这轮的三处文档编辑只能留在**工作树**里（`索引命中 0 / 工作树命中 2` 是我逐文件量过的），
并先 `cp` 了一份到 `~/scratch-heyta/carrier-snapshot-0004/`（300148 / 128098 / 214865 字节）。
⚠️ 这里有一条**反向事故的形状**（我自己踩过并记过）：他们下一次 `git commit` 合并时提交的是整个索引，
所以只要我的编辑**没进索引**就不会被带走 —— 但工作树里的这份仍然可能被后续 checkout/merge 覆盖。
快照是为了那一刻准备的，不是为了抢提交。

### 3. 五条红线在合并**之前**就逐条对账过（读的是 `c36b1d89` 那棵树，零写盘）

| 红线 | 对 `c36b1d89` 的现量 | 判定 |
|---|---|---|
| AI 类型上产不出 op | `git show c36b1d89:packages/ai/package.json` 里 `dependencies` / `peerDependencies` **一段都没有** ⇒ 仍是零依赖，`@heyta/op-log` 在这个包里解析不到 | 不变 |
| `host.submit` 全仓恰好一处（可穷举） | `git grep -n 'host\.submit(' c36b1d89 -- '*.ts' '*.tsx'` 命中 11 行；**src 里的非注释**只有 `ai-tool-run.ts:195` 与 `server.ts:587`，其余是注释表（`AssistantPanel.tsx:24`、`server.ts:458`）与 `packages/app-host/tests/event-tool-host.spec.ts` 的 7 处夹具。而 `check:ai-tools` 规则 9 的扫描集是 `listPackageSrcs()`（`scripts/check-ai-tools.mjs:478-485`：只遍历 package 的 `src`），**tests 不在扫描面里** | 合并后这条**不会**因批次二而红；但合并态仍要由门禁自己说话（下一节跑） |
| 逐工具默认关 | `git show c36b1d89:packages/local-api/src/tools.ts` 里 `return grants?.[toolName] === true;` 原样在，只是行号从 **337-339 漂到 897**（他们那批把目录按实体拆开后文件变长了） | 语义不变、**行号抄件会漂** ⇒ 台账里这条以后引**代码形状**而不是引行号 |
| 不开托管 AI / 不 bump schema | `CURRENT_SCHEMA_VERSION = 1` 在 `HEAD` / `c36b1d89` / `main` 三方**取值相同** | 不变 |
| 我线的东西有没有被吞 | `git show HEAD:packages/app-host/src/local-api-host.ts` 里 `submit:`(477) → `submitIntent(`(478/509) 这条接线**仍在**（这是第一次合并 `305212ad` 后的读数；第二次合并完成后要再量一次） | 待复查 |

### 4. ② 的读数**不能在这棵树上拿**，所以我另起一条干净通道

123 项未提交改动、其中 25 项还是未解冲突 —— 在这种混合态里跑出来的红/绿**只在混合态成立**
（这条我以前写过一次，这次是它第二次把我挡住）。新脚本
`~/scratch-heyta/heyta-integration-verify.sh`：先断言 `未解冲突=0`（否则 exit 3，不硬量），
再 `git worktree add --detach` 到载体分支的当前提交、软链 `node_modules`，
然后 `pnpm -r build` → `-r typecheck` → `-r test` → `pnpm check`，逐段记 rc、日志落 `~/scratch-heyta/verify-<时分>/`。
00:10 的 dry-run 现场：`载体 HEAD=305212ad 未解冲突=25 脏项=123`，`负载 12.73 / 阈值 12`。

### 5. 这一节欠的三条（写给下一个读它的人，不是给自己的安慰）

1. `305212ad` 那次合并**是他们解的冲突**，我没读过解法 ⇒ 合并态里 `local-api-host.ts` 的
   **逐工具授权**与 **W11 批量提案**两处是否都在，必须用 `check:ai-tools` + `packages/app-host` 的测试来判，不能靠"看着没少"。
2. 我这轮的三处文档编辑**还没有提交**（受第 2 小节那条 git 硬规则挡着）。
   合流一结束就 `git commit --only` 那三个路径，并**按内存里那条反查**：
   提交后量三处命中数（HEAD / 他们暂存 / 工作树），确认我的段落不是被 `git add -A` 顺手带走的。
3. `docs/plans/ai-event-tool-contract.md` 里凡是引**行号**的地方都是一份会漂的抄件 ——
   本节已经抓到一处（`tools.ts:337-339` → `:897`）。剩下已知的一处是 §15.29 那条
   `host.ts:331-332`（它在合流后是否还指对东西，等 ② 一起量）。

## 15.38 ① 的第四次吸收 main，与"合并态的五条红线在两棵树之间各量了一遍"（载体 `e54b899b`，00:1x）

### 1. ①：线已经并到 128 笔待落，而落地仍被 9 个共享文件挡着

`git merge --no-edit main`（第四次吸收）只带进一笔 docs 提交（`d27bccde docs(handoff)`，
`+9/-7`，`merge-tree --write-tree` 预演 rc=0 零冲突），落地后：

```
main ⊂ 载体 = YES   待落 = 128 笔   载体 HEAD = e54b899b
```

`bash ~/scratch-heyta/heyta-land.sh --dry-run` 的现量（**这条判据上一轮刚被改准成"按路径的交集"，
这一轮第一次给出可用的数**）：

```
001736 main = d27bccde → 目标 = e54b899b
001736 ✓ 快进成立：128 笔待落
001736 ❌ 我的合并要更新 185 个文件，其中 9 个正被别人未提交地改着
       （主检出共 60 项未提交，其余与本次更新不重叠 ⇒ 不在挡路的范围里）
     PROGRESS.md 17+/0- · docs/plans/README.md 4+/0- · docs/reference/environment-traps.md 231+/16-
     package.json 2+/1- · packages/app-host/src/index.ts 1+/0- · packages/ui/src/index.ts 12+/0-
     packages/i18n/src/locales/en.ts 10+/0- · …/zh-CN.ts 11+/0- · packages/storage/src/stores.ts 4+/0-
```

⚠️ 这 9 项和 23:5x 那 15 项**不是同一批**：那 15 项里挡路的代码文件（`tools.ts`、`mcp.ts`、
`local-api-host.ts`…）在 00:0x 由它们的所有者提交了（`2f735392` 那一批），
现在剩下的是**三本共享台账 + 三个 barrel/词条文件** ⇒ 落地这件事的最后一段
只能等这 9 个文件被各自所有者提交，脚本不改判据、不 `stash` 别人的东西。

### 2. 五条红线：合并**之前**对着 `c36b1d89` 那棵树量过（§15.37 第 3 小节），合并**之后**对着 `e54b899b` 再量一遍

| 红线 | 合并态现量（`git grep` 打在树 `e54b899b` 上，零写盘） | 判定 |
|---|---|---|
| AI 类型上产不出 op | `packages/ai/package.json` 的 `dependencies` / `peerDependencies` 段命中 **0**；`packages/ai/src` 里对 `createOp\|OpLogRecord\|@heyta/op-log\|@heyta/sync-core\|dispatch(` 只命中 `provider.ts` 的 **2 行，且都是注释**（`:14`「**AI 是输入法，不是业务逻辑。** 它坐在 `dispatch()` **之上**」、`:16`「走 `packages/app-host` 的动作层、经 `dispatch()` 完成」= ADR-0005 §3.1 的说明原文） | 未放宽 |
| `host.submit` 全仓恰好一处（入口可穷举） | `ai-tool-run.ts` 命中 **1**；`server.ts` 命中 **2** = 注释表 `:514`「\| MCP / 本机 API \| 立刻 `host.submit(intent)` \|」+ 代码 `:578` `return writeResult(await host.submit(write.intent));` ⇒ **代码入口仍是那两个** | 未放宽 |
| 逐工具默认关 | `tools.ts:450` `return grants?.[toolName] === true;` 原样在 | 未放宽 |
| 出境逐字段披露 | 目录 `name: '` 合计 **26**（我这轮 22 → 并进批次二的 4 条 EVENT 工具）、`egressFields` 声明合计 **31**、`TOOL_ENVELOPE_EGRESS_FIELDS` **3**。🔴 这三个数是 `git grep -c` 的**行数合计**，不是工具条数的逐项对账 ⇒ 只当"披露层还在"的弱读数，**权威读数交给 ② 的 `check:ai-coverage` / `check:ai-tools` / 那 9 条出境用例** | 待门禁确认 |
| 回退不跨越隐私边界 | ~~`fallback-needs-consent` 命中 **10**（`provider.ts` 1 / `routing.ts` 5 / `supply.ts` 4）~~ 🔴 **这句是我把两条 grep 的输出拼成了一条**：`supply.ts` 那 4 处属于 `retention-undecided`，`fallback-needs-consent` 的逐文件明细只有 `provider.ts` 1 + `routing.ts` 5 = **6**（00:2x 逐行复核：`git grep -n` 在三棵树 `main` / `e54b899b` / `926398d2` 上打出**完全相同的 6 行**，`diff` 为空）。`retention-undecided` 在 `supply.ts` **4** 处，`assertEnableable()` 仍抛 ⇒ 托管 AI 仍未开。**判据本身没变**（`:812` 那条 `reason: 'fallback-needs-consent'` 仍在候选循环体内、发请求之前） | 未放宽 |
| 同一个 needle 的**作用域**才是数值的单位 | 🔴 顺带把这条量出来，免得下一个人再猜：**同一个 needle、同一棵树，换作用域就是三个数**（`main` 上的 `fallback-needs-consent`：`packages/ai/src` = **6** / `packages/ai` = **13**（多出来的是 `tests/routing.spec.ts` 6 + `tests/diagnose.spec.ts` 1）/ 全仓 = **45**）。所以 §15.x 里那种"6 → 8 处"的历史读数**没有一句写明作用域，就无法复现** —— 我不据此判它是错的，但它在今天这三棵树上都取不回来。⇒ 台账写法：**计数必须带作用域 + 带命令**，"更严/更松"的方向只有在同一作用域下才成立。 | 记录 |
| 不 bump schema | `CURRENT_SCHEMA_VERSION = 1`：`HEAD` / `c36b1d89` / `main` **三方相同**（§15.37 已量，合并后 `HEAD` 仍是 1） | 未放宽 |

🔴 **一次行号漂移的现场样本**（把 §15.37 第 5 小节第 3 条那句话坐实）：同一条
`return grants?.[toolName] === true;` 在一个小时里的三棵树上是三个行号 ——
`337-339`（我的线）→ `897`（`c36b1d89`）→ `450`（合并态 `e54b899b`）。
⇒ 台账里这条以后**只引代码形状**，行号当"当时的位置"而不是"位置的答案"。

### 3. ② 的通道：干净检出 + 逐段链，不在混合态上量

`~/scratch-heyta/heyta-integration-verify.sh`（00:17 起，pid 94084）：

- 前置断言 `未解冲突=0`（否则 exit 3，"量了也不能当集成态读数"）；
- `git worktree add --detach` 到 `e54b899b`，**镜像 node_modules**（`find -maxdepth 4 -name node_modules`
  逐个软链，不是只链 root —— 每个包自己的 `node_modules` 才是它的依赖解引用）；
- 然后 `HEYTA_CARRIER=<干净检出> bash heyta-chain.sh`：单一所有者负载门 →
  `pnpm -r build` → 逐段链（段名从 `package.json` 现取、存**原始命令**不存段名）→
  逐段 rc 落 `chain-verify-integration-<时分>/segments-rc.txt`；
- `check:ai-e2e` 那一段按规则**不跑**（它的 preflight 会对 4318/4319 上 LISTEN 的进程直接 SIGKILL，
  而那台 vite 可能是并行会话的，traps #87）⇒ 记 `SKIPPED_BY_RULE`，**不算通过**。
  这一段单独走 `heyta-e2e-when-quiet.sh`，且要求 4318/4319 现量空闲。

⚠️ 这一轮的载体读数是 **128 笔待落 / 9 个共享文件挡住落地 / 一次都没在这棵混合树上量** ——
下一节要把 ② 的逐段读数原样接上，别用"上一轮 56 绿"顶替：载体换了，段数与红集都可能不一样。

## 15.39 `.gitignore` 里带尾斜杠的 `node_modules/` 挡不住**软链**，所以我那棵"干净检出"报 21 项未跟踪（00:2x，实测两腿对照）

② 的脚本把载体里 21 个 `node_modules` 逐个软链进新检出，然后自己打印了一句
`脏项=21（应为 0）`。这 21 项**不是别人的工作**，是软链本身：

```
$ head -1 .gitignore
node_modules/
$ git -C <新检出> check-ignore -v packages/ui/node_modules        # 软链
（无输出）rc=1                                                    # 没被忽略
$ git -C <新检出> check-ignore -v packages/ui/probe-dir/node_modules
.gitignore:1:node_modules/    packages/ui/probe-dir/node_modules   # 真目录
                                                              rc=0  # 被忽略
```

机制：**gitignore 的模式带尾斜杠时只匹配目录**，而"指向目录的软链"在 git 眼里是符号链接、不是目录，
所以同一条规则对真目录生效、对软链失效。⇒ 只要一棵树用**软链**凑 `node_modules`，
所有基于 `git status` / `git ls-files -co --exclude-standard` 的流程都会**多出一批本该被忽略的条目**。

🔴 这条对本仓库不是纸面问题，它正好砸在 ③ 的 Windows 段上：
`reinstall-all.sh` 的 `sync_windows_sources()` 送的就是
`git ls-files` + **未跟踪非忽略** + `apps/web/dist`。在带软链的检出里跑那一端，
21 枚软链会进源码包，而远端解包后它们指向不存在的路径 ⇒
"远端字节 == 本地工作树"这条对账比的将是一棵**被我的测量装置污染过的树**
（§7 第 175 条"哈希命名的产物目录只增不减"是同一族的另一种面目）。
⇒ 判据写法：**测量装置自己造出来的未跟踪条目，必须在打脏项数时排除**，
否则下一轮会把"21"读成"检出脏了"，或更糟 —— 读成"门禁绿但工作树不干净所以不能落"。

我这侧的两个后续动作（都写在这里，不等下一个人重新发现）：
1. `heyta-integration-verify.sh` 那句 `脏项=…（应为 0）`要改成
   **非软链脏项=0**（`git status --porcelain | grep -v node_modules`）。本轮**不改脚本本体**——
   它正在被 bash 边跑边读，跑动中编辑会让它从错误的偏移继续读（这条也踩过）。
2. 若 ③ 的 Windows 段将来要在带软链的检出里跑，先断言
   `git ls-files -co --exclude-standard | grep -c node_modules` **= 0**，非 0 就响亮失败。

⚠️ 顺手记我自己这次的探针毛病（不是缺陷，但差一点成缺陷）：为了做上面那组两腿对照，
我在新检出里跑了一个 `ln -sfn … 2>/dev/null` 的循环，**目标是把那枚真软链也换成探针目录**。
循环里错误被我 `2>/dev/null` 吞掉了，所以"两条腿"其实只有真目录那条换了对象。
量完立刻 `readlink` 复查 21 枚软链的目标 ⇒ 异常 0 枚，链没被污染。
教训：**在正在被测量的树里做探针，探针命令自己必须留读数**（`readlink` 一遍），
不能靠"命令退出码 0"——尤其当我把 stderr 丢了的时候。

## 15.40 第三次 merge 正在我载体里跑，而它合进来的是**"半成品入库，未验证"**——所以"落哪一头"这件事我做了一次显式裁决（00:2x）

00:21 现量：`$(git rev-parse --git-dir)/MERGE_HEAD` = `e442a3bb`，`MERGE_MSG` 首行
`Merge branch 'feat/countdown-w4b' into integrate/2026-10-03-closeout`，未解冲突 **10** 项。
那笔提交自己的标题就写着：

```
e442a3bb feat(server,domain): W4b 服务端半 —— 调休/补班两张表 + 公开读面 + 后台录入（半成品入库，未验证）
```

这构成了一个我必须先说清楚、不能默默处理的事实：**① 的"集成线"在我合完 main（`e54b899b`）之后
继续被别人往里并**，而我这轮的 ② 量的是 `e54b899b` 那一头（链日志原话：
`载体 = …/heyta-wt-verify-integration  HEAD = e54b899b`）。

🔴 **裁决（不落地那条正在被并入的线，理由与 reopening 条件都写死）**：
`heyta-land.sh --confirm` 现在**不跑**，不是因为 9 个共享文件挡住（那一条它自己会挡），
而是因为我不能把一笔**作者自己标注"未验证"**的合并状态快进进本地 `main` ——
AGENTS §8 第 7 条那句"范围扩大后，旧范围的完成证据不能覆盖新增项"在这里是反向适用的：
我这轮攒下的绿读数（build/typecheck/链、四端里的三端）**证明的是 `e54b899b`**，
它对 `e54b899b + W4b 半成品` 这个新状态一个字都不说。
重开条件写得很具体：**W4b 那 10 个冲突由它的解决者提交、且合并后的尖端在干净检出里重新拿到
`build rc=0 + 逐段读数`**，那时候 `--confirm` 才有的放矢。
（顺带：这一条也正是"落地"这件事在这台机器上的真实形状 —— 目标随 main 与合流活动一起漂，
所以 `heyta-land.sh` 每次都要重新量"快进成立吗、挡路的是哪几个文件"，脚本本来就是这么写的。）

⚠️ 我这轮**第三次**被同一条 git 规则挡住提交（`fatal: cannot do a partial commit during a merge.`），
所以 §15.39 那一节的落盘位置现在是：工作树 + `~/scratch-heyta/carrier-snapshot-0004/`
（229730 字节，00:21 重新快照）。这节写完一并等合流活动停了再按路径提交。

## 15.41 红线 4「出境逐字段披露」的实质缺口补上了（条款那张表 10 条 → 26 条），外加两件**只有合并态才照得出来**的事（载体 `d718f248`，00:5x）

先结案：上面那句"等合流活动停了再按路径提交"过期了。**§15.39 与 §15.40 已经进了 HEAD**，
但不是从我的提交进去的 —— 是并行会话的整索引提交把它们带上去的
（`cdf421b3` / `4fad02b0` / `d718f248` 三笔，00:47–00:50）。现量核验：
`git show HEAD:docs/plans/ai-event-tool-contract.md` 里 `## 15.39` 与 `## 15.40` 两个标题都在，
字节数 233176 与工作树相同。所以任务 #36（"合流停止后按路径提交这两节"）**没有产物了，只剩这段记录**。
这就是这台机器上"提交"的真实形状：载体同时是别人的合流点时，**我的未提交段落会被别人的提交吸收**，
归属只能靠台账文字自己声明。

### 一、门禁的取数前提先被合并态打断，然后才轮到条款

`check:legal-tools`（`scripts/check-legal-tool-catalog.mjs`）原来从 `packages/local-api/src/tools.ts`
里扫 `export const LOCAL_API_TOOLS` 那一段的 `name:`。目录按实体拆包之后那一行只剩
`export { LOCAL_API_TOOLS } from './tools/registry.js'` ⇒ **门禁对着合并态直接抛异常**，
而它要拦的那件事（加了工具没写进条款）反而没人说了。改法是**照装配表取数**：
从 `tools/registry.ts` 的 `LOCAL_API_TOOL_PACKS` 读出被并进来的符号 → 按结构导入映射到实体文件 →
逐文件扫 `name:` 且要求同一对象字面量里有 `kind: 'read'|'write'` → 排序返回。
三条前提破了都**响亮失败**（装配表解析不到 / 某 pack 一个 `name:` 都没有 / 同名工具落在两个文件里），
不是返回空集合。刻意**没有**复刻 registry 的"读前写后"顺序规则 —— 那是 `buildToolPackRegistry` 的不变量，
已由 `packages/local-api/tests/server.spec.ts:189` 与 `apps/node-host/tests/mcp-stdio-server.spec.ts:188` 逐字钉着。

**取数口径改对了的证据**（这一步不能省，否则只是"换个姿势扫源码"）：
门禁的 26 个名字集合，与运行时目录 `packages/local-api/dist/index.js` 里 `LOCAL_API_TOOLS`
的 26 个 `name` 做 `diff` ⇒ **空**。也就是"两侧逐字相同（门禁的源码扫描 == 运行时目录）"。

改完门禁，它立刻报出**实质缺口**（原话）：
`❌ … 中文表（第 175 行）缺 16 个工具：create_habit, create_note, create_project, create_reminder,
create_tag, get_note, list_checkins, list_focuses, list_habits, list_notes, list_reminders, list_tags,
log_focus, record_checkin, set_task_tags, update_note —— 目录里有、条款里没说，而条款把这张表当成了授权面`
（英文表同一条，第 431 行）。

**这 16 条全是本线（覆盖面批次二）产出的工具**，所以这个缺口是我这条线欠的，不是继承来的。

### 二、写进去的 16 行，逐格取值来自产物而不是记忆

用 `~/scratch-heyta/probe-catalog-dist.mjs`（把 `name / kind / egressFields` 从**构建产物**里打出来 ——
产物会把 `ROW_FIELDS` 这类常量展开成真实字段名，源码正则做不到）现量取每格的字段，再照表内既有措辞写：
读格列字段并显式写"不含什么"（`list_notes` 特别写明**便签没有标题**，所以列表出境的只有"什么时候动过"；
`list_checkins` / `list_focuses` / `list_reminders` 各写明"不含习惯名 / 不含任务标题"，
并把"加上时间戳就已经是一份行为记录"这件事说出来而不是藏起来）；
写格一律"不读数据；写入必须经操作日志"，`set_task_tags` 写明**整组覆盖**、`update_note` 写明**整段替换**。
中英两张表**逐行同序**（门禁第 3 条判据，抓的是"行贴错对象"）。

配套：`version: '1.1' → '1.2'`（版本号进同意指纹 `packages/legal/src/index.ts:125`，
条款 s12 自己列的三条触发条件里第一条就是"新增出境字段"），
并把 s12 那张**修订历史表补齐** —— 现量发现它只有 `1.0` 一行，而 `version` 已经是 `1.1`：
上一次 bump（W10 那四条 EVENT 行）只改了 `version` 没加历史行。兄弟文件（`data-rights.ts` /
`privacy.ts` / `minors.ts`）都是 `version` 与历史行同时翻的，所以这里按同一口径补 `1.1` + `1.2` 两行，
并把 `updatedDate` 改成 `2026-10-04`。
顺手摘掉一处会漂的常量：`packages/local-api/src/mcp.ts:13` 那句注释里的"全部 10 个工具"
（目录早就不是 10 条了）改成"目录里的全部工具" —— 注释里写死上游当前状态，就是 §"判据别把上游当前状态写死"
那一类，只不过这次写死它的是注释而不是断言。

跑通的读数（载体 `d718f248`，工作树当时干净）：
`check:legal-tools rc=0`（`✅ … 目录 26 条 == 中文表 == 英文表，且中英逐行同序`）、
`check:legal-copy --check rc=0`、`gen-server-legal --check rc=0`（指纹里 `ai-and-transfer@1.2`）、
`check:legal-host rc=0`、`@heyta/legal typecheck rc=0`、`check:docs rc=0`。

### 三、🔴 我给一份 `.ts` 法务文档写出了**语法错误**，而我这套验证本来看不见它

英文行里我写 `'… show a person's daily rhythm'` —— 单引号字符串里一个裸撇号 ⇒ 这个文件当时**不可解析**。
它没被我发现的原因很具体，值得记下来：
**这张表的对账方全是"文本读者"** —— `check:legal-tools` 用正则扫 `rows`、`gen-site-copy --check`
比对生成物字符串、`check:legal-copy` 同理，**没有一层解析 TS**。真正能拦住它的是 `pnpm typecheck`，
而我这一轮先跑的是上面那三个文本门禁。
更不舒服的一点：我随后跑了 `pnpm --filter @heyta/legal build`，它回 **rc=0**，
但那条 rc 是在 `4fad02b0 00:48:48` 把撇号修好**落到工作树之后**才量到的
（那笔提交的标题就是"英文工具表的撇号转义"，改的正是我这一行）。
⇒ 在"载体每 20–30 秒被并行会话提交一次"的机器上，**"我跑出来 rc=0" 可能是别人修完之后的读数**，
它不构成"我的验证有牙"的证据。这条和 §15.40 的"混合工作树里跑出来的红/绿只在混合态成立"是同一族，
只是这次是**反向**的：混合态会把别人的修复算成我的通过。

落地成两条动作：① 改 `.ts` 里的**文档内容**之后，除了文本门禁必须跑该包的 `typecheck`
（`pnpm --filter @heyta/legal typecheck`，现在这条已经在我这轮的读数里）；
② 在这台机器上主张"我验过了"，得带上**载体 SHA + 那一刻工作树脏项数**，否则那句话没有主语。

### 四、合并态照出两条**不归本批**的红

1. 🔴 **`check:legal-permissions` rc=1，7 条 ❌，且是已提交态的红**（四个相关文件现量都干净）。
   根因是 W9 把**申请面**改了没翻**条款**：`b0ba4a35 23:58 feat(app-host,mobile,web): W9 提醒的原生投递（ADR-0051）`
   往 `AndroidManifest.xml` 加了 `POST_NOTIFICATIONS` + `SCHEDULE_EXACT_ALARM`、往 iOS `Info.plist` 加了
   `NSUserNotificationsUsageDescription`，而 `permissions.ts` / `third-parties.ts` 里六个位置（中英各三）
   还写着"移动端不申请通知授权" ⇒ 那句对外条款当场是假话。
   **这条门禁按设计工作了**：`017adc3e 20:16 feat(gates): 权限对账的通知臂改成六个字面位置、两侧对称 ——
   W9 原生半落地时它会精准指到该翻的那句`，提交信息里就把用途写明了。
   第 7 条是 `SCHEDULE_EXACT_ALARM` 既不在 `PRIVACY_ITEMS` 也不在 `NON_PRIVACY_ANDROID_PERMISSIONS`
   ⇒ 门禁拒绝给"通过"（这是它的设计：不认识的声明必须人来归类）。
   **我不代翻这六句**：它们要说的是"什么时候申请、申请来做什么、被拒之后怎么降级"，
   这些事实只有 W9 的所有者有；我照门禁的提示语编一段对外法务条款，比留着这条红更贵
   （AGENTS §8 第 10 条"安全判据不得为测试桩降级"是同一条纪律的另一面）。
   🔴 结构性后果写进 ②：**`pnpm check` 在它翻之前不可能全绿**，而 `e54b899b`（② 那趟干净检出的载体）
   同样以 `b0ba4a35` 为祖先（`git merge-base --is-ancestor` 现量 YES），所以那一趟的逐段读数里
   这一段**必红** —— 报"61 段绿"的时候要按这个改口，不是"链坏了"。
   现量命令：`NO_COLOR=1 node scripts/check-legal-permissions.mjs`。
   这也是 AGENTS §9 那条 L' 前置闸门（"`permissions.ts` 那句'不申请照片'要等 W7 的 manifest 才知会不会变假"）
   的**兑现**：它变假了，而且变假的是通知那一组，范围比当初登记的更大。
2. ✅ **`check:docs` 转绿，但过程里那条红是自己造的**：`docs-link-check` 的
   `SECTION_REF_RE`（`research/tools/docs-link-check.mjs:305`）按「路径 `.md` + 空格 + `§数字`」的字面形状扫，
   不看它是不是正被引用 ⇒ 我 23:23 为了记录"某处引用了不存在的章节号"而**原样抄了一遍那个引用**，
   于是记账文本自己成为全仓唯一命中，**记录那条红的句子自己就是那条红**。
   改写成不落在那个形状里的说法后 rc=0，且没有藏红：原始那条出自 `cd839ec5` 的引用已由它的所有者改对
   （改前全仓 `grep` 只剩本行自己）。可迁移的一句：**门禁扫的是文本形状，那么"引用一个坏形状"就必须避开那个形状**
   —— 与 §7 #171（Hermes 字节码里的中文是 UTF-16LE，`grep` 恒 0）是同一族的两面：
   一面是"扫不到不等于没有"，另一面是"扫到了不等于真有其事"。

### 五、改造后的门禁有没有牙：四臂变异（00:57，全在树外副本里打）

副本树 `~/scratch-heyta/mut-0049`（`scripts/` 拷脚本、`packages/legal/…` 拷文档、
`packages/local-api/src` **实拷**而不是软链 —— 软链会把变异打进真仓库）。
未变异对照 **rc=0**，四臂 **全部 rc=1**，跑完载体两个文件 `git status` 干净：

| 臂 | 打在哪 | 门禁说的话 |
|---|---|---|
| A | 表侧：删中文表 `list_habits` 一行 | `中文表（第 175 行）缺 1 个工具：list_habits` |
| B | 表侧：中文表相邻两行**只换序**（集合仍相等） | `中英两表的工具顺序不一致（集合相等也可能行贴错对象）` |
| C | 表侧：删英文表 `get_note` 一行 | `English表（第 461 行）缺 1 个工具：get_note` |
| **D** | **目录侧**：往 `tools/tag.ts` 塞一条 `kind: 'read'` 的 `zzz_probe` | 中英两表各报 `缺 1 个工具：zzz_probe` |

D 是这组里唯一有意义的一臂 —— A/B/C 只证明"表侧有牙"，而这条门禁存在的理由是
**"往目录加一项而条款没写"**，那一侧的输入是源码，必须真加一条工具才能验。
装置落在 `~/scratch-heyta/mut-legal-row.mjs`（A/B/C）与 `mut-legal-catalog.mjs`（D），可重跑。

⚠️ 这一趟我自己踩了两个探针坑，都记下来（它们各自差点产出一条假读数）：
1. 第一版三臂**全部 rc=0**，看着像"门禁没牙"，实际是**变异一行都没打进去** ——
   我把路径塞进 `process.env.MT`，而 Bash 工具没有"环境变量"这个入参，`MT` 是 `undefined`，
   于是 `node -e` 里的 `readFileSync` 抛 ENOENT，变异失败被 `||` 吞在半路，
   而门禁照原样跑、照原样绿 ⇒ **三个假绿**。改成"变异装置写成文件、路径走 argv"后才拿到真红。
   （同 §7 #176 那一族：桩/装置没走到被测判据，PASS 是假的。）
2. 我按 `check:md-tables` 这个名字去跑 `scripts/check-md-tables.mjs` ⇒ **MODULE_NOT_FOUND、rc=1**，
   看着像"表格门禁红了"，实际真名是 `scripts/check-md-table-rows.mjs`（跑它 rc=0）。
   ⇒ 报任何一段红之前，先确认那条命令**存在且是链里那一条**（`node -e` 读 `package.json` 的 `scripts` 现取）。

### 六、这节结束时还站着的四条


- ② 那趟干净检出的链（pid 94084，载体 `heyta-wt-verify-integration` @ `e54b899b`）00:52 仍在**负载门里等**
  （起跑前负载 `{38.05 26.71 29.56}`，阈值 12；00:48 现量 1 分钟 26.06）⇒ 读数还没出来，
  出来时**`check:legal-permissions` 那一段按上面第四条记为必红**。
- ③ iOS 那一端仍未闭合（B62 第三份取证 + 三台 `Booted` 全有主），重开条件写在 `BLOCKED.md` B62。
- ① 落地：`d718f248` 比 `e54b899b` 又多吸收了两轮 main 增量与 W9/W4b 的收尾，
  §15.40 那条"不落半成品"的裁决**没变**，但"挡路的是哪几个文件"这件事每次都要重量 ——
  现量命令在 `~/scratch-heyta/heyta-land.sh`（默认 dry-run）。
- 本节的**归属**：`ai-and-transfer.ts` 的两张表 + `version`、`scripts/check-legal-tool-catalog.mjs` 的取数改造、
  `mcp.ts` 的注释、`server/src/legal.generated.ts` 再生成，全部落在别人的 `cdf421b3`/`4fad02b0`/`d718f248` 里。
  下一位读 HEAD 的人只会看到"fix(legal,ai): 终态合流收口"，看不到那 16 行是谁欠的 —— 所以这段是必要记录，不是仪式。

## 15.42 ② 的第一条红是**装置红**：软链来的 `node_modules` 会让 pnpm 去清别人那棵依赖树，而把它"修绿"的两个开关都是破坏性的（10-04 01:3x，载体 `15862311`）

**原话读数**：01:24:42 起跑（pid 61964），载体 `heyta-wt-verify-integration` @ `15862311`，
未跟踪 21 枚（软链 21 / **非软链 0**）⇒ "干净检出"这条成立。负载门 01:32:42 放行，
第一段 `pnpm -r build` **rc=1**，全文 1440 B 里只有这一段有效：

```
[ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY] Aborted removal of modules directory due to no TTY
If you are running pnpm in CI, set the CI environment variable to "true", or set "confirmModulesPurge" to "false".
```

**这不是产品红**（一行源码都没编到）。机制：那棵检出的 `node_modules` 是 **21 枚软链**，
指向载体 `heyta-wt-ai-closeout` 里的真目录；pnpm 11.8.0 在跑脚本前做一次 deps 状态检查，
认定"这棵 modules 目录不是为当前 project root 装的" ⇒ 要**整目录重建**，没有 TTY 所以中止。
⚠️ **中止救了我们**：让它继续的两条开关（`CI=true` / `confirmModulesPurge=false`）等于
**授权 pnpm 去清那棵别人正在用的树**。§15.39 量过 `node_modules/` 这条 ignore 规则挡不住软链，
这次是同一枚软链的第二种代价 —— 不再只是"未跟踪项数读错"，而是"一次装机构建会顺着它删别人的东西"。
⇒ **不设那两个开关**，改装置：

1. `heyta-chain.sh` 加了起跑硬前置（`bash -n` 过）：软链数 ≠ 0 ⇒ **`exit 5`** 并写明是装置问题；
   载体未提交项 ≠ 0 ⇒ **`exit 4`**（混合态的红/绿只在混合态成立，§15.40）。
2. 🔴 **"干净检出"要的判据是"无未提交混合态"，不是"连依赖树也复制一份"**。
   载体此刻现量：`脏项=0 未跟踪=0`、root 与 `packages/local-api`、`apps/web` 的 `node_modules`
   都是**真目录**、`lsof` 对端命中 0 ⇒ **01:34 起把链搬回载体跑**，读数载体写
   `heyta-wt-ai-closeout @ 15862311`。真要另一棵树，就在里面 `pnpm install` 出真 `node_modules`，**别软链**。

**① 的现量又换了一次数**（"挡路的是哪几个文件"每次都要重量，这件事本身就是 B63 那一族的教训）：
`git merge-tree --write-tree main 15862311` ⇒ **rc=0、零冲突** —— 合并从来不是障碍。
更新集 **382** 个文件 ∩ main 检出脏项 **77** 项 = **11 个文件**挡路（上一版记的是 9 个）：
`AGENTS.md`、`PROGRESS.md`、`docs/README.md`、`docs/reference/environment-traps.md`、
`apps/web/src/features/sync/store.ts`、`apps/web/src/main.tsx`、`packages/app-host/src/index.ts`、
`packages/i18n/src/locales/zh-CN.ts`、`packages/i18n/src/locales/en.ts`、
`packages/sync-client/src/client.ts`、`packages/ui/src/sync/model.ts`。
🔴 逐行读过 ⇒ **全部是别人在飞的那条 W9/vault 并发线**（`PROGRESS.md` 那两行的原话是
"01:00 Web 并发迁移真链路已先证红…过程并入环境陷阱 #191 和 AGENTS §8.9"）。
三条不落地都试不得：不代他们提交、不 rebase 掉、**也不用 plumbing 把 `refs/heads/main` 指到合并树而不动工作树** ——
那样那 382−11=**371** 个"没脏但内容变了"的文件会全部显示成相对新 HEAD 的改动
（按 git 的 status 定义它们落在"Changes to be committed"位，index 与 worktree 都还是旧 main 的内容 ——
**这一句是按规则推的，没实测**），等于摆出一块"任何人一次整文件 `git add` 就能把合并撤掉"的现场，
正是记忆里那条反向事故的形状。

🟢 **一条把 ③ 从"等落地"里解放出来的现量**：`git diff --name-only 15862311 <合并树>` =
**1 个文件**（`docs/plans/multi-end-coverage-handoff.md`），非 `docs/` 命中 **0**
⇒ 落地给 main 的**只有文档**，四端装出来的字节与载体一致 ⇒ ③ 的装机读数在载体上取、落地后**不必重跑**。
复算命令：`git diff --name-only 15862311 $(git merge-tree --write-tree main 15862311 | head -1) | grep -vc '^docs/'`（**应为 0**）。

**④ 的复核（B63 的关闭判据在现载体上仍未满足，而且这次连"追加"都不做）**：
`15862311` 现量 —— `^[0-9]+\. ` 命中 **207** 行 / 去重 **194** / 最大号 **198**；
重号集合 `{38, 93, 94, 95}`（`grep -nE '^38\. '` ⇒ `:708` 与 `:779` 是两条不同内容的条目），
缺号集合 `{83, 84, 85, 120}`。**同一读数在 `main` 的 HEAD（最大号 190）和 main 的活树上完全一致**
⇒ 既不是本批造成的，也不是别人在飞造成的。
⚠️ 所以这次**不把新条目追加进 `environment-traps.md`**：该文件在 main 检出里正被 #191 那条线写着（`= M`），
而它此刻已经住着 4 个重号 —— 从这里再追加一枚就是亲手制造第五个重号，
那正是 B63 诊断出的机制（"无编号小节 + 局部 1..N 列表 + 全局递增号"三套制并存）。
⇒ **上面那条装置红待入 traps**（下一枚空号按那时工作树现取，别在这里写死"应为 #199"），
正文在本节，可直接抄；`~/scratch-heyta/heyta-chain.sh` 的前置代码就是它的可执行形态。










## 15.43 ① 的落地这一半做完了；顺带撤回一根我自己写的探针（它把"交集 4"读成 0）（10-04 02:0x–02:2x，落地载体 `de296b9d`）

**落地成事实**：主检出 02:06:07 的 reflog 是 `merge integrate/2026-10-03-closeout: Fast-forward`，现量三条源分支都是 main 的祖先：

```bash
for b in feat/ai-entity-coverage feat/assistant-history-local-persistence integrate/2026-10-03-closeout; do
  git merge-base --is-ancestor "$b" main && echo "IN $b"; done   # 三条都 YES
```

本批的代码在 main 里逐枚 `git show main:<路径>` 取到：`scripts/check-ai-coverage.mjs`、
`packages/app-host/src/ai-tool-selection.ts`（`list_events` / `get_event` / `create_event` 的选取规则）、
`apps/web/src/features/ai/assistant-history.ts`（D-4(i) 的本机持久化）、`packages/app-host/src/ai-tool-run.ts` 的批量提案（W11）。
`check:ai-coverage · check:ai-tools · check:legal-tools · check:ai-quota · check:privacy-consent-e2e` 五段现量都还在 `pnpm check` 的串里
（段数以 `node -e 'process.stdout.write(String(require("./package.json").scripts.check.split("&&").length))'` 现取为准；02:2x 量到 **74** —— 目标文本里那句"HEAD 上 61 段、工作树 62 段"已经过期，见 §15.42 同族的"报段数必须带载体"）。

**没有吞别人的改动**：落地那一刻挡路的交集是 **4** 枚（`PROGRESS.md`、`apps/web/tests/local-data-destruction.spec.ts`、
`apps/web/tests/sync-reason-coverage.spec.ts`、`scripts/verify-mobile-auth.sh`），其中别人那三枚由**所有者自己在 02:05:55 提交**（`258813a8`）之后交集才归零。
我没有 stash、没有 `--no-verify`、没有替谁提交一个 hunk，也没有动 main 的共享索引。

🔴 **撤回一条我自己的探针缺陷，并把它记成判据**：第一次算交集我用的是

```bash
git status --porcelain=v1 | sed 's/^\s*[MADR?]*\s*//'   # 🔴 BSD sed 不认 \s ⇒ 前缀根本没剥掉
```

于是"更新集 ∩ 脏集合"报 **0** —— 而那正是我的放行条件，我差点据此宣布"窗口开、可以落"。
改用位置确定的 `cut -c4-`（porcelain v1 的第 1–2 列是状态码、第 3 列是空格）之后，同一棵树现量是 **4**。
⇒ **"交集=0"这类空集读数在被当成放行条件之前，必须先喂一条必然命中的对照**（这里就是拿已知脏的那枚文件名走同一根管道，看它活不活）。
这与 `land.sh` 里那根 `sed 's/^...//'`（按位置剥，正确）不是同一根探针；B65 那趟"11→0"用的是按位置的写法，本节不据我这轮的失败去推翻它 —— 只提醒后来者：**空集最像干净，也最可能是探针没跑**。

**五条隐私不变量在落地载体上的源码级复核**（都是读代码本体，不依赖任何一趟跑过的读数）：

| 不变量 | 现量 | 谁钉它 |
|---|---|---|
| AI 类型上产不出 op | `grep -rE 'createOp\|toOp\(\|OpLogEntry\|appendOp' packages/ai/src` = **0 命中** | **类型层**（该包零运行时依赖、源码里没有 op 类型）；门禁侧只有 `check:layering` 的 `no-op-construction-in-apps` 管 **apps/\***，`check:ai-coverage` 里**没有**这条断言（`grep -cE 'packages/ai.*(产不出\|不得构造)' scripts/check-ai-coverage.mjs` = 0） |
| `host.submit` 恰好一处 | ⚠️ **准确说法是"非注释命中两处，而这两处就是全部入口"**：`ai-tool-run.ts:195`（内置 AI，确认后才写）与 `local-api/src/server.ts:590`（MCP／本机 API，ADR-0011 的显式调用） | `check-ai-tools.mjs:471` 的静态计数（脚本原文："`host.submit(` 的**非注释**命中恰好两处，其余全在 `tests/`"） |
| 逐工具默认关 | `isToolGranted()` 本体 = `grants?.[toolName] === true`（`tools.ts:449`）⇒ 缺省即关，无 `typeof` 绕过 | ⚠️ **只有单测钉**（`grep -rl isToolGranted scripts/` = **0**，`packages/*/tests` 里 2 个文件断言它）；`check-ai-tools.mjs:408` 提到"逐工具默认关"是**注释不是断言** |
| 出境逐字段披露 | `egress.ts:159` `buildDisclosure(request)` 产出 `EgressDisclosure`，且 :151 注释明写"拒绝时**必须**带上披露" | `check:ai-coverage` 的 9d 臂 + 词条 key `web.ai.disclosure.e2ee{Lead,Strong}`（中英成对由它管） |
| 回退不跨越隐私边界 | `provider.ts:166` 的 `'fallback-needs-consent'` 是**独立失败原因**，`routing.ts:812` 返回它 ⇒ 一次请求都不发 | ⚠️ **只有单测钉（`packages/ai/tests` 里 7 处），没有任何 `check:*` 门禁引用这个串** —— 现量：`grep -rln fallback-needs-consent scripts/` = 0 |

⚠️ 第二行是**这次才照出来的措辞问题，不是我放宽了红线**：Goal 原文写"全仓恰好一处"，仓里真正被钉住的性质是"入口能列完 ⇒ 两处"。
这两个说法在只有内置 AI 一个入口时等价，MCP／本机 API 那条入口进来之后就不等价了。留原句 + 这一行更正，
别让下一位拿"一处"去判一个本来正确的实现（判"还有一处 submit"去查的人，会查出 `tests/` 里那批合法夹具）。

🟡 **顺带照出一条缺口，登记而不在这批补**：五条不变量里**只有两条真的有 `check:*` 门禁钉**（submit 计数、出境披露话术），
另外三条靠"类型层 + 单测"：`grep -rl isToolGranted scripts/` = 0、`grep -rln fallback-needs-consent scripts/` = 0、
`check:ai-coverage` 里也没有"packages/ai 产不出 op"的断言。按仓里既有的立场（AGENTS §8 第 3 条"不能失败的检查没有价值"
与本文件 L' 那条"封闭句式必须配对账门禁"），这三条属于**承诺已经写在文档与 ADR 里、但改坏它只能靠单测发现**的那一类。
补法是三条独立的 `check:*` 臂（各配一次变异），成本不在本批的范围里 ⇒ **登记为下一批的候选，工单号本批不代开**。

**②③ 现在排在同一条等窗口的队列上**（既不与别人那趟链挤窗口，也不重跑已经跑绿的读数）：`~/scratch-heyta/heyta-deliver-on-window.sh`。
阶段：现场闸门（pattern 里**含别人那趟链的每个 argv 形状**：`heyta-window-chain · heyta-run-reinstall · heyta-run-checks · heyta-run-notes · heyta-land-parent-merge`）
→ 仓库那道负载门（阈值 = 核数×3/4，不自己定）→ 链逐段读数（载体=落地载体）→ **非 docs 漂移必须为 0 才允许起装**
→ `check:ai-e2e`（这一段用**端口**当门而不是用 pattern 猜：4318/4319 都空闲才起，因为它的 preflight 会 SIGKILL 那两个端口上 LISTEN 的进程，traps #87）
→ 四端重装（`IOS_DEVICE_NAME` 显式给，不靠 `head -1` 猜设备，traps #169）。
每条前置等满都以 **exit 3** 收尾并打印现量命令（环境无效 ≠ 产品失败），全程不 push。
02:2x 起跑前现场：负载 32→（阈值 12）、现场命中 3、`ssh windows-pc hostname` rc=0、载体五枚 `dist` 在场、`node_modules` 零软链。

### 15.43b 一笔**没落**的 §9 更正（不是偷懒，是 AGENTS.md 此刻正被别人未提交地写着）

`AGENTS.md` §9 那句 `### 2026-10-03：倒数纪念日 批次二（🔄 进行中，全在本地分支，未 push 未 merge）` **已被否证**，现量（02:3x，main `2a5c3587`）：

```bash
for b in feat/countdown-batch2 feat/countdown-w9 feat/countdown-w4b feat/countdown-w7 feat/countdown-w8; do
  printf '%s:%s ' "${b#feat/}" "$(git merge-base --is-ancestor "$b" main && echo IN || echo 不在)"; done
# countdown-batch2:IN  countdown-w9:不在  countdown-w4b:不在  countdown-w7:不在  countdown-w8:不在
```

⇒ `feat/countdown-batch2`（W0/W0b/W2/W5/W10）**已经在 main 里**，那行还写"未 merge"会让下一位把这单重做一遍。
**这一笔我没有落**：`git status --porcelain -- AGENTS.md` 现量 `M` —— 别人正未提交地改同一个文件，
而我用的 `git commit --only AGENTS.md` 提交的是**整个文件的当前内容**，会把他们那一版还没跑完判据的行一起带走
（AGENTS §8 第 1 条"不吞并行会话的改动"在这里的形态就是"不替别人提交"）。
**接手第一件事**：等 `AGENTS.md` 干净时把那行状态改成 `🔄 部分已落 main`，并在同一行带上上面那条现量命令
（分支集合每天都在变，写死"batch2 已落、w4b 未落"就是造下一份会漂的抄件）。

### 15.43c 三条与"覆盖面＝门禁"直接同名的 gate，先在落地载体上各取一次单段读数（02:3x，载体 `ce6c1c98`）

全链还在等窗口（负载 16.8 / 阈值 12，见 `BLOCKED.md` 02:3x 那段）。但**这三条本身是静态对账**，
不含任何计时断言 ⇒ 高负载只会让它们**假红**、不会让它们**假绿**，所以"此刻绿"这个读数是安全的；
链到窗口里仍会把它们再跑一遍，那时才是 §6.1.1 意义上的合并态读数。

| 段 | rc | 汇总原话（照抄，不改写） |
|---|---|---|
| `check:ai-coverage` | 0 | `ℹ️  实体覆盖面 9/9（口径：读和写都有工具）；已登记缺口 0 项` · `ℹ️  目录 26 个工具 ≤ 每实体 5 × 分母 9 = 45 席（已用 26，剩 19）` · `✅ 5 个 AI 功能在 web 端到端可达（实现 → 导出 → 路由声明 → 偏好声明 → 界面）` |
| `check:ai-tools` | 0 | `✅ AI 工具路径门禁通过：ai-tool-* 3 个文件；规则 6 扫描范围 52 个 .ts；规则 9 写入口穷举 20` |
| `check:legal-tools` | 0 | `✅ 本机接口工具表对账通过：目录 26 条 == 中文表 == 英文表，且中英逐行同序` |

两处**数字随合并更新**（Goal 原文是旧值，留旧值是为了让人看见它什么时候过期）：
覆盖面 **8/8 → 9/9**（分母多了 `EVENT`），工具目录 **22 → 26**（W10 那 4 条 EVENT 工具进表，
并且按 L' 那条纪律**同时**进了中英两张法务表 —— 这就是 `check:legal-tools` 存在的原因：
"未列出即视为未授权"那句话说的是**那张表**，加一条工具是一次对外承诺变更，而不是一行 `name:`）。

⚠️ 也照出`check:ai-coverage` 自己那句提醒别读成通过：**`界面端覆盖：mobile 0/5` 是"显式登记的缺口"**
（产品负责人 2026-10-03 拍板"AI 上移动端这轮不做"），它的意思是"这一端一条都没接，所以没有半接的谎"，
**不是** mobile 已经可达。

### 15.43d ③ 起装之前先把"现在四端装的是哪一批"取证了一遍 —— 结论是**都不是落地载体**，而且这一趟取证顺带证明闸门真的在挡事

落地时间是 **02:06:07**（`de296b9d` 那次 Fast-forward）。四端此刻的读数：

| 端 | 现量 | 判读 |
|---|---|---|
| mac | `/Applications/Heyta.app` mtime **10-03 23:05:40**；`Contents/Resources/web-dist` 26 个文件里 **1 个含 `heyta.ai.assistant.history`**、**0 个含 `list_events`** | 装的是**合并前**的载体：D-4(i)（助手历史）在里面，W10 的 EVENT 工具不在里面 ⇒ 一次"看起来装了"的旧产物 |
| android | `adb -s emulator-5554 shell dumpsys package com.heyta` ⇒ `firstInstallTime 2026-10-04 00:55:36 / lastUpdateTime **02:03:04**` | 比落地早 3 分 3 秒 ⇒ **不是落地载体**（包 id 从 `apps/mobile/android/app/build.gradle:136` 现取为 `com.heyta`，我先前猜的 `cn.waytofuture.heyta` 拿到的是**空读数**） |
| ios | `simctl get_app_container <udid> com.heyta app`（BID 从 `reinstall-all.sh:363` 的 `IOS_BID:-com.heyta` 现取）：`heyta-iphone-17pro` **10-03 19:32:56**；`heyta-ios-isolated` **10-04 02:36:46**；`iPhone Duo heyta` 10-02 19:35:12 | 主用那台是合并前的；⚠️ `heyta-ios-isolated` 的容器时间是 **02:36:46 —— 就在我取证的当口**，说明**别人此刻正往模拟器装 iOS** ⇒ 我要是照"③ 现在就跑"去做，`simctl uninstall` 清的就是别人的现场 |
| windows | `Get-AppxPackage -Name cloud.finlaw.heyta.desktop` ⇒ `Version 1.0.0.0`，`InstallDate` 为空；再去读 `InstallLocation\resources` 报 **PathNotFound**（`WindowsApps` 的 ACL 也可能伪装成"路径不存在"） | 🟡 **未取到**新鲜度。⇒ Windows 这端的"装的是不是当前源码"**只能由 `reinstall-all.sh` 自己那四条判据给**（sha256 对账 + `PAYLOAD_WEBDIST` + `ADD_APPX=OK`/`RESULT=OK` + `M2D=`），拿这台机器的空读数当证据就是造假 |

两条一般规律（都从这次的形状里出来）：
① **包 id / BID / 设备名一律从仓里或脚本里现取**，凭域名猜出来的 id 只会得到一个"看起来干净"的空读数；
② 内容探针（needle 命中/未命中）比安装时间**更能区分"装了"与"装对了"** —— mac 那枚两分钟前的 `mtime` 看不出问题，
   而 `list_events` 命中 **0** 一眼就照出"这是合并前的产物"（与 §6.1.1 引的 traps #27/#82 同族）。

🟡 所以 **③ 现在没有闭合**，也不是"再等等就好"的模糊状态：它闭合的形态是
队列里那段 `reinstall-all.sh` 在**落地载体**上跑完、四端各自那条"装上的是当前产物且能起来"的判据打出来。

🔴 上面那行"mac 里 `list_events` 命中 0"**配了同刻的阳性对照**才敢这么写（否则 0 命中可能只是"这个 needle 本来就不进 web-dist"）：
同一时刻从**落地载体**新打的 `apps/web/dist/assets` 是 7 个 js，其中 `list_events` 命中 **2** 个文件、
`heyta.ai.assistant.history` 命中 **1** 个；而已装的 `/Applications/Heyta.app/.../web-dist` 只有 26 个文件、
`assistant.history` 命中 1 个（`assets/index-Da9aaZLq.js`）而 `list_events` 命中 **0** 个
⇒ 同一对 needle 一边中一边不中，"装的是合并下载体"这句才不是猜的。

### 15.43e `environment-traps` 的编号在两个文件之间**已经串号**了 —— 这是 ④"按工作树现量复核"照出来的，本批只登记不动它

现量（10-04 02:4x，main `74cbe812` 之后）：

```bash
grep -nE '^[0-9]{2}\. ' AGENTS.md                       # AGENTS.md 自己带着 6 枚 traps 形状的条目
grep -nE '^8[0-3]\. ' docs/reference/environment-traps.md
grep -oE '^[0-9]+\. ' docs/reference/environment-traps.md | tr -d '. ' | sort -n | tail -1
grep -oE '^[0-9]+\. ' docs/reference/environment-traps.md | tr -d '. ' | sort | uniq -d   # 重复号
seq 1 202 | comm -23 - <(…sorted…)                        # 缺号
```

| 读数 | 值 |
|---|---|
| AGENTS.md 里的 traps 条目 | 第 **975 / 1000 / 1022 / 1039 / 1062 / 1088** 行，行首号依次是 **82, 80, 83, 81, 82, 83** ⇒ **82 与 83 各有两枚，内容互不相同** |
| traps 文件里的 80 / 81 / 82 | `am start -n $PKG/.MainActivity…` / `RNW 的 CLI 命令"不存在"…` / `aka.ms/<短链> 回退到 Bing 搜索页…` —— **与 AGENTS.md 那六枚没有一枚对得上** |
| traps 文件的缺号 | **83、84、85、120**（1..最大号之间） |
| traps 文件的重复号 | **38、93、94、95**（各两枚；这条 §15.42 已经登记过，此处只是复核仍存在）。⚠️ 同一根 `^[0-9]+\. ` 还会抓到 `1. 2. 3. 4.` 这种**嵌套有序列表** ⇒ 它们是假阳性，"重复号 1/2/3/4"不算数；条目行与列表行要能区分之后才配报总数 |
| traps 文件最大号 | 现取 **203**（10-04 02:41；我写这节的一分钟内那条线又追加了一枚 —— **正是本节在说的那类漂**，所以我上一版口算的"202"当场就过期了），而 AGENTS.md §7 那张号段索引最后一行只写到 **177–198** |

⇒ 索引落后的是 **199–203 这 5 枚**（不是我上一版写的"停在 165–176"—— 那句在我落笔时就已被现量否证，留在这里是为了让"印象"和"现量"的区别看得见）。

⇒ 后果要说得具体：**任何"`§7` 第 82 条"的引用现在是不可判定的** —— 它可能指"非空白挡不住错误屏"（AGENTS 第一枚 82）、
"重装≠装上当前源码"（AGENTS 第二枚 82），也可能指 traps 文件里的 `aka.ms` 短链那枚。
而 §7 的索引表停在 176，会让读者以为文件到 176 就结束了。

**为什么本批不动它**（三条都是现量，不是"代价大"的印象）：
① 引用 `8[0-3]` 号的行 **65 处**、分布在 ≥10 个文件（`docs/plans/*`、`scripts/*`、`research/tools/*`、`PROGRESS.md`…）
   ⇒ 任何整体重编号 = 一次跨 10+ 文件的引用改写，逐条核对不是全局 `sed` 能做的事；
② `AGENTS.md` 此刻是 `M`（另一条会话正在写它）⇒ 我改它就是把别人没跑完判据的行带走；
③ 本批 Goal 的 ④ 写的是"**复核**"，不是"迁移"。

**登记给下一批的修法**（按这个顺序做才不会二次串号）：
1. 把 AGENTS.md 那 6 枚**按内容**追加到 traps 文件末尾，号按当时工作树现取（别在这里写死"应为 #203"）；
2. 原引用处**逐条**改指新号，每条改完用 `git show HEAD:<file>` 复算一次；
3. 同时补两条门禁（都能失败才算存在）：traps 文件"行首编号唯一且在 1..最大号内连续"；
   AGENTS.md "不允许出现 `^[0-9]{2}\. ` 形状的行"（注入一枚就该红）。
4. 元规则一句：**"`§7` 编号只增不改"这句话本身需要一条门禁**，否则它就是一张会漂的抄件 ——
   而它漂的方式是**两个文件同号不同事**，读的人不会察觉，只会引用错。

### 15.43f ② 的 73 段读数在**落地载体**上量完了：64 绿 / 8 红 / 1 按规则不跑 —— 八条红逐段归属，没有一条落在本线文件上（载体 `ce6c1c98`，01:34–01:39）

现量命令（读数落盘，不靠回忆）：

```bash
awk -F'\t' '$3 ~ /^rc=[1-9]/ {print $1, $2, $3}' ~/scratch-heyta/chain-ai-closeout-0134/segments-rc.txt
grep -a SUMMARY ~/scratch-heyta/chain-ai-closeout-0134/segments-rc.txt
```

**本线自己的那五道 gate 全绿**（这是 ② 真正要回答的那一句）：段 11 `check:layering`、
段 25 `check:legal-tools`、段 43 `check:ai-quota`、段 44 `check:ai-tools`、段 61 `check:ai-coverage`
都是 `rc=0`。段 62 `check:ai-e2e` 是 `SKIPPED_BY_RULE`（它会 SIGKILL 4318/4319 上别人在跑的 vite，
§7 #87），**不算通过**，另在交付队列里用"两个端口都空闲"当门单独补跑一次。

八条红的归属（逐条读它**自己报出的那个文件**，不按印象、不按 `--author`）：

| 段 | gate | 报错点名的东西（原文摘要） | 归属 |
|---|---|---|---|
| 12 | `check:ui-provider` | `apps/mobile/src/screens/GrowthScreen.tsx:298` 的 `<GrowthBoard>` 落在 `HeytaUiProvider` 子树**之外**，共 3 处 | 移动端成长面（非本线） |
| 15 | `check:selection-single-source` | 选中态所有者不唯一：`packages/ui/src/calendar/CalendarDayBoard.tsx` 的 `onOpenTask` | 日历 / 三栏详情面那条线 |
| 26 | `check:legal-permissions` | `AndroidManifest.xml` 声明了 `SCHEDULE_EXACT_ALARM` 而未登记；`packages/legal/…/permissions.ts` 的中英依据仍写"移动端代码目前不产生任何系统通知" | 倒数纪念日批次二（W9 原生投递）。该权限经 `43fee3dd`（W7 移动半的合并）进树，`git log -1 -- AndroidManifest.xml` 现取 |
| 29 | `check:licenses:stamp` | 清单指纹是 lockfile `111cc2d1d04d3763` 下渲染的，当前是 `0f3c1bf6d9e21526` | 装置/载体属性：要在"装了全部 workspace"的检出里重渲染。载体 `e2e/node_modules` **有**，所以这条不是"载体缺依赖"，是**别人改了 lockfile 没重渲染** |
| 31 | `check:image-license` | `server/package.json` 变了，镜像快照 `serverPackageJsonSha256` 失真 1 处（重跑要联网） | 改 `server/package.json` 的那条线 |
| 64 | `check:landing-e2e` | `net::ERR_CONNECTION_REFUSED 127.0.0.1:4320/docs/…` | 环境：落地页 preview 服务没起（**不是**产品红） |
| 65 | `check:shell-unicode` | `scripts/mutate-closeout-gates.sh` 里 `$W1）` 这类"`$var` 紧跟非 ASCII"6 处；`blame -L262` = `58dd8ec6`（批次二吸收 main） | 倒数纪念日批次二 |
| 73 | `pnpm -r test` | `packages/domain` 一条翻译断言：`0.000 准备季度汇报 ↔ 做 Q3 review 要用的 PPT` | domain / i18n 那条线 |

🔴 **一句反着读的话，别让它溜过去**：这八条红里**没有一条**是本批（覆盖面 / 裸号 / 会话历史）造成的，
但它们**全部**是**已提交状态**的属性 —— 载体是干净检出（未提交项 0），所以这不是"混合工作树才红"。
也就是说 `main` 此刻带着这八条红，而 Goal 的 ② 只承诺"读数写明载体 + 逐段归属"，
不承诺替别的线把它们改绿（§8.7：范围扩大后旧范围的证据不覆盖新增项；本批也不吸收别人的债凑绿）。

### 15.43g ③ 起装之前先把"探针本身"校准了一遍 —— 四端**当前装的都是过期构建**，而且这一轮探出的四个读数各自都是一条 traps

02:48–02:51 现量（`bash /tmp/paxprobe/run.sh`，探针块是从 `~/scratch-heyta/heyta-deliver-on-window.sh`
的阶段 5b 用 `awk` 原样切出来的，**不是另写一份**）：

| 端 | 读数 | 含义 |
|---|---|---|
| mac | `PAX_MAC=MISMATCH`：`/Applications/Heyta.app/…/web-dist/index.html` 引用 `index-Da9aaZLq.js`（sha `dd7f8156…`），而载体 `apps/web/dist` 里那枚文件名**根本不存在**（载体当前是 `index-BGKxdnVs.js`）；标记 `list_events` 在已装包里 **0** 处、载体包里 **2** 处 | 装的是 10-03 23:05 的构建，**早于落地** |
| android | `PAX_AND=SIZE-DIFF`：已装 `66,953,324 B` vs 载体构建产物 `67,183,868 B`，`dumpsys` 的 `lastUpdateTime=2026-10-04 02:46:47` | 02:46 有人重装过，**装的不是本线载体**（另一条线的产物） |
| ios | `PAX_IOS=MISMATCH`：已装 `main.jsbundle` sha `e713c7bf…`，构建侧路径 `/tmp/heyta-ios-release/Build/Products/Release-iphonesimulator/Heyta.app/main.jsbundle` 此刻**不存在** | 探针对还没跑过 ⇒ 记 `NOT-READABLE` 才对（这条已经改：判据从 `-n` 换成 `-f`） |
| windows | `PAX_WIN=NOT-PROVEN`：本机日志里 `ADD_APPX=` / `PAYLOAD_WEBDIST=` / `M2D=` **一条都没取到** | 没证据就是没证据，**不**读成"装上了"。**⚠️ 02:59 原地更正**：这一格取错了载体 —— 判 Windows 的权威文件是 `dist/windows/install-capture.txt`，现量它 23:12 起**五条判据全在位**（含 `SHORTCUT_OK=True`）。所以真实读数是 `STALE`（旧一趟的齐码），而"一条都没取到"这句只描述了一个还不存在的日志 |

🔴 **所以 ③ 的当前状态是"未完成"，且这不是坏消息而是这一节的全部内容**：四端里三端装着过期或别人的构建、
一端连读数都没有。任何"本轮交付完成"的说法都必须先让阶段 5 真跑一遍并由这五个读数背书。

这一轮顺带把三条新陷阱钉进了权威位置（号按工作树现取：追加前 `grep -oE '^[0-9]+\. '` 最大 **203**）：

- **#204** 已装 payload 取"那枚主包"不能 `ls assets/index-*.js | head -1` —— 字典序挑中的是 215 KB 的**副产物**，
  `index.html` 引用的那枚是 1.9 MB 的主包；而且两枚 mtime 相同、目录文件数与载体都是 9，
  所以"数量对得上、时间也新"挡不住"装的是另一份构建"。
- **#205** 等窗口的后台链把日志写成 `printf … | tee -a` ⇒ 启动它的那个回合一结束，链死在下一条 `say`，
  `rc.txt` 留 0 字节。**读这类日志：最后一行没有结论句就要怀疑探针本身**，别读成"它还在等"。
- **#206** main 每几分钟前进一笔（02:46→02:52 走了 `2a5c3587 → 4a9de8b6 → 67149961`，三笔全 docs）
  ⇒ 交付门**不能**写成"载体 == main HEAD"（永不放行），要写成**打包输入集差集为 0**；
  并且起跑前重量一次、装完再量一次。

### 15.43h ④ 的两处台账我**没有**写进去，理由要留在这儿（否则下一位会以为我漏了）

| 文件 | 此刻未提交的东西 | 为什么不当场追加 |
|---|---|---|
| `AGENTS.md` | 2 个 hunk（§8.10 那条编号段 + §9 表里 W9 原生投递那一行改成"Android 主链与异常恢复已验，iOS 续验中"） | 那是批次二 / W9 那条线的正文。`git commit --only -- AGENTS.md` 提交的是**整个工作树内容**，会把他们没跑完判据的两段一起带走（红线：不带走别人的 hunk）。§7 索引表里"177–198"那一行现在应写成 **177–206**，这笔更正随他们的提交落地后由下一位一并补 |
| `PROGRESS.md` | +4 行（"B/C 全量验收补正…"与"B/C 收口续验：C# 存储契约重放…66/66"） | 同一条理由。本线那三行（段数 02:2x 现量 **74**、撤回 `host.submit` 那句、②③ 的形状）已在 `1571` 行之前落进提交 |

⇒ 本节（§15.43f/g/h）就是这两处本该写的内容的**当前唯一落点**；下一位接手时把它并进
`PROGRESS.md` 与 `AGENTS.md` 的对应小节即可，不需要重新取证（读数都带了载体与时刻）。
### 15.43i 交付队列的三处装置改错（03:32 现量）—— 都是"我造了一道自己的门，而仓里已有一道更宽的"

②③ 那条队列（`~/scratch-heyta/heyta-deliver-on-window.sh`）今晚第四次起跑前改了三点，
每一点都值得记下来，因为它们各自都"看起来更安全"：

1. **重装前该跑的闸门仓里已经有了**：`scripts/verify-mobile-window-gate.sh --target b`
   （02:29 落在 main 里，别的线写的）。它一次判 负载门 / `packages|apps|server` 里别人未提交的源码 /
   `reinstall-all.sh` 自身是否干净 / iOS 设备名现取 —— 我那两条（私有 `peers` 正则 + 单独 source
   `wait-for-quiet-host.sh`）比它**窄**。现在改成 `win_gate b`：每 90s 重问过这道**规范**门，
   等待由队列负责、判据由仓里那道门负责。**03:33 在载体上单跑一次 dry-run 的现量**：
   四条里三条 ✅，唯一 ❌ 是"负载 21 > 12"。
2. **设备独占改用共用探针** `. scripts/lib/mobile-e2e-runner-probe.sh` 的 `mobile_e2e_runner_lines`，
   而不是我的正则。理由写在它文件头：`bash [^ ]*verify-mobile-…` **跨不过仓库路径里的空格**，
   而 36 个验收脚本会把自己快照成 `.<原名>.snap.<pid>` 再 exec ⇒ 旧写法**对这一整类运行者永久隐形**。
   取 **main** 那份而非载体那份：载体的副本还停在 02:37 修复之前（自检把**夹具**当现场印，
   输出"真实读数 '11111'"），实测两份 md5 不同。**不整跑 `--target c`** —— 它额外要求凭据三件套 /
   服务端 :3100 / APK 不比源码旧，那是**设备验收**的前置，塞进重装就是拿无关条件挡路。
3. **载体要先快进**（新加阶段 1.5）：03:32 现量载体落后 main **31 笔**，而这 31 笔里就有上面那两个
   脚本 ⇒ 不快进就是**拿旧装置判新现场**，而且我的打包输入漂移门（阶段 3）必然在装前判过期。
   只允许 `merge --ff-only`；`HEAD` 不是 `main` 的祖先就停（那是另一次合并，不在交付队列里做）。
   手工补跑一次后的现量：`ff_rc=0 载体 f61c23af == main f61c23af 未提交 0`。

🟡 **一条现场事实，别读成"我的闸门太严"**：03:33 共用探针说**设备没人占**，而我的 `peers()` 仍命中 3
—— 因为那三条是 Playwright/别的线的链（`/tmp/heyta-window-chain4.sh` 已是别人那条链的**第四次**起跑尝试）。
也就是说今晚这个窗口是**三条线同时在等**，负载压到 12 以下的时间窗很短。
②③ 若最终等满 `exit 3`，那属于现场被占，不属于本批的判据被放宽或产品失败 —— 已按 `BLOCKED.md` B66 记。
### 15.43j 现场门从"对端 argv 命中数"改成"对端**进程树里有非 sleep 叶子**" —— 这是一次判据形状变更，两腿对照都记在这儿

**为什么改**（03:45 现量，`ps -Ao pid,ppid,stat,time,command` + `pgrep -P`）：

| 对端 | 它的叶子 | 旧判据 | 新判据 |
|---|---|---|---|
| `bash research/tools/r14c-window-retry.sh`（pid 78674） | `sleep` | 算"别人在跑" | **waiter，不占场** |
| `bash /tmp/heyta-window-chain4.sh`（pid 68545） | 它自己的 gate bash（也在等） | 算"别人在跑" | **waiter，不占场** |
| `qemu-system-aarch64`（pid 36840） | 36856（真在算） | 算 | 算 |

那一刻负载已经 **11.57 < 12**、共用设备探针读数为空，而我的现场门仍命中 5–8 ⇒
**三条线各守一个 waiter，谁的窗口都永远不为 0**。这与 §7 那条 02:37 修掉的互锁是同一类
（`lib/mobile-e2e-runner-probe.sh` 的文件头：把 dry-run 闸门算成运行者 ⇒ 两条互相体检的腿永久互锁），
只是这次发生在 CPU 侧。

**为什么这不算"放宽判据"**：动的不是负载阈值（仍是仓里规范实现 `hw.ncpu × 3/4 = 12`，
`wait-for-quiet-host.sh` 一字未改），也不是任何一段的通过条件；动的是"**谁算在场**"这一条定义 ——
一个只在 `sleep` 的进程不产生负载、不占设备、也不消费我要读的那些源码。
而且它**没有把风险藏起来**：① waiter 的 pid 逐个印进日志（`另有 waiter …`）；
② `heyta-chain.sh` 起跑前后各取一次对端进程快照（`peer_snapshot`），"某个 waiter 在我跑的中途醒来"
在红段归因时看得见 —— §15.43f 那八条红就是这么归的。

**两腿对照**（`bash -c` 单测 `tree_busy_leaves`，03:46）：

```
waiter pid=78672 → 忙叶子=[]（期望空）      ✅ 反向腿成立
emulator pid=36840 → 忙叶子=[36856 ]（期望非空） ✅ 正向腿成立
```

🟡 **这条改动自己的边界**：`tree_busy_leaves` 在"对端正好跑到一发 `lsof`/`ps` 这类瞬时工具"时会
把它算成忙 ⇒ 方向偏保守（白等一轮），不会反过来漏算真在跑验收的树（那种树的叶子是
`node`/`adb`/`python3`，且持续多轮）。真正漏算的形态是对端**只 sleep 但醒来就杀我现场**——
那由阶段 3/5 那两道"起跑前重量一次"的门兜，而不是由这一条兜。
### 15.43k 阶段 1 的现场门再收一次形：**只硬挡"另一趟交付链"**，别人单跑一套验收不再挡路（附一处把 bash 写进 python 补丁时的过度转义）

04:09 现量（`ps -Ao pid=,command=` + 逐棵 `pgrep -P`）：

| pid | argv | 分类 |
|---|---|---|
| 68545 | `bash /tmp/heyta-window-chain4.sh` | 链（叶子在 sleep ⇒ 那一刻是 waiter） |
| 91826 | `bash /tmp/heyta-run-checks.sh --go` | 链 ⇒ **全量 check 正在跑** |
| 93817 | `bash /tmp/heyta-reinstall/scripts/.reinstall-all.sh.snap.93817` | 链 ⇒ **四端重装正在跑** |
| 96516 | `bash heyta-deliver-on-window.sh` | 我自己 ⇒ 已按 argv 排除，不算进"另一趟链" |

⇒ 队列在此刻**应当**让位（两条重装同跑会抢同一台设备、同一个 `/Applications/Heyta.app`、
同一台 Windows 打包机），而它确实让位了 —— 这条门是有牙的，不是摆设。

**门形的变更**（相对 §15.43j 那一版）：

| 条件 | 旧（02:11 起） | 新（04:08 起） | 依据 |
|---|---|---|---|
| 别的线单跑一套 Playwright / 设备验收 | **挡**（`peers==0`） | **不挡**，只把计数印进日志 | 02:11–04:07 现量恒 5–8，而 03:33 与 03:45 两次"负载 ≤12 + 共用设备探针为空"——**私有门比仓里规范闸门更严，严到永不为 0**（traps #206 的反面：门在而从不放行） |
| 另一趟交付链 | 挡 | **仍然挡** | 02:1x 实测：两条全链同跑，双方 61/73 段读数都不可归因；04:09 现量它真在跑 |
| 负载 ≤12 | 我的 `wait_load`（source 仓里实现） | **交给规范闸门** `--target b`（同一实现，阈值一字未改） | 去重：不再自己造一遍 |
| 别人未提交的源码 / `reinstall-all.sh` 干净 / iOS 设备名现取 | 我没判 | **规范闸门判** | 同上 |
| 设备独占 | 我的正则 | 共用探针 `mobile_e2e_runner_lines`（取 main 那份） | §15.43i 第 2 条 |

兜住"不挡单发验收"这个 loosening 的，不是我的印象而是三样既有装置：链首尾各一次
`peer_snapshot`、规范闸门的负载门、§15.43f 那套"红段按它自己报出的文件逐段归因"。

🔴 **顺带一条可迁移的装置坑**（这次自己踩的）：用 python 补丁往 bash 的单引号串里写 ERE 时，
`\\\\.` 会落成文件里的 `\\.` ⇒ bash 原样传给 `grep -E` 的是"**字面反斜杠** + 任意字符"，
**整条正则静默零命中**，看起来像"没有另一趟链在跑"。两腿对照（同一台机器、同一刻）：

```
带双反斜杠那份命中=0        ← 看着像现场干净
正确那份命中  =3            ← 实际有三趟链
```

凡是"空读数当放行条件"的门，加一条**必然命中**的对照不是仪式（§7 #204/#206 同族）；
而从 python/heredoc 里往外生成 bash 正则时，**先 `echo $pattern | grep -c` 拿一个已知样本验一次**，
再决定它是不是被多包了一层转义。
### 15.43m 🔴 一次本会话自己的事故：`--only <path>` 挡不住**同一个文件里别人的未提交条目** —— 我 05:00 那笔把别人 4 条一起提交了

`a2a6541b` 的 `--only -- docs/reference/environment-traps.md` 给那个文件加了 **78 行**，
而我那一条只有 20 行。多出来的 58 行是另一条线**当时还没提交**的 #208–#211
（`simctl io screenshot` 屏幕 / AX success / `pnpm --filter` 名字 / `import` 即跑）。

- **内容零丢失**：他们那 4 条现在逐字在 HEAD 里（`git show HEAD:…| grep -c '^209\. '` = 1）。
- **错的两样**：① 归属 —— `git blame` 会把他们写的四条记到我这笔提交上；
  ② 号 —— 我那条也叫 #208，于是 HEAD 里 **#208 出现两次**（`for n in 208 209 …; grep -c` 现量）。
- **为什么按路径限定没挡住**：限定的粒度是**文件**，而他们改的是**同一个文件**。
  这条红线防的是"带走别人在**别的文件**里的 hunk"，对同文件同台账的并发写入**无效**。

**做掉的更正（forward-only，不改历史、不 amend）**：我那两条改号成 **#213 / #214**
（05:24 现量：`208..214` 各 1 条，无重号），他们的原号原样留着；B66 里的引用同步改。

**没做的一件事及其理由**：#213/#214 这一次**先不提交**。因为此刻那个文件里还有别人
**一条未提交的新条目 #212**（`git diff --numstat` 现量 63 行里含它），再提一次就是重演同一个事故 ——
而这次可能吞进去的是**半成品**。⇒ 等它被别人自己提交掉、`git diff` 只剩我这两条时再落，
判断命令就一条：`git diff -- docs/reference/environment-traps.md | grep -E '^\+[0-9]+\. '`
（**新行首编号必须全是我那两个号**，出现别号就继续等）。

📌 一般规律一句：**多人同写一个台账时，"提交前先 `git diff --numstat` 看行数对不对"是必需动作，
不是可选检查** —— 我这次连 numstat 都没看就提了，78 行 vs 20 行的差本来一眼就能看出来。

#### 15.43n 🔴 自报第二起事故：我把 383 KB 的台账提成了 18 字节（`execSync` 的 `input` 是数据，不是路径）

05:32 我按 §15.43m 说的"等 #212 落定后再提 #213/#214"去做，用的是同一套 plumbing 配方，
但建 blob 那一步写成了：

```js
execSync('git hash-object -w --stdin', { input: '/tmp/traps-blob.md' })   // ❌
```

`execSync` 的 `input` 选项是**喂给 stdin 的数据**。于是 git 收到并存储了字符串
`/tmp/traps-blob.md` 本身 —— 18 字节、1 行。`hash-object` 照样打印一枚**合法**的 sha（`19faadf3…`），
脚本照样"全闸通过"，`update-ref` 的 CAS 照样成功。提交 `bfdeea31` 把
`docs/reference/environment-traps.md` 在 HEAD 里从 383353 B 变成 **18 B**。

- **传播**：收尾那步"把真实索引刷成 HEAD"（§15.43m 记的配方）此刻刷的正是那枚坏 blob ——
  它在共享索引里停留了 33 秒，另一条会话的一笔**无 pathspec** 提交 `ee71c6e1` 从索引把它带走了
  ⇒ 坏内容在历史里有**两笔**在场。
- **唯一在提交那一刻就现形的信号**是我自己写的复核，不是 numstat：复核里那两条
  **不期望为 0** 的计数（`git show HEAD:<f> | grep -cE '^213\. '`、`… '^214\. '`）**同时返回 0**
  加上一条 `^208. ` 返回 **0** 而不是 1。⇒ 判据要写成"**期望值**"而不是"打印出来看看"，
  否则 18 字节的文件也能"看起来跑完了复核"。
- **处置（工作树一个字节没动，不改历史）**：立刻 `git update-index --cacheinfo` 把索引刷回
  `eae1ef61` 那份完整文本；想 CAS 摘掉 `bfdeea31` 时 HEAD 已被 `ee71c6e1` 推进 ⇒ CAS 前提不成立，
  **不 revert、不 rewrite**，改成在其上提一笔 `87f62b39`：内容 = 完整文本 + 我自己的两处
  （改号 208→213、追加 #214），他们的 #212 一行都没进（`git show HEAD:<f> | grep -cE '^212\. '` = 0，
  `git diff | grep -cE '^\+212\. '` = 1）。
- **新增那道闸（G5）就是把"落盘的对象 == 这份文本"钉住**：
  `git cat-file -s <blob>` 必须逐字等于文本字节数、blob 里必须读得到两条标题、
  且尺寸 > 300 KB。上一轮缺的正是这一道 —— 有了它，"18 字节的台账"根本提不出去。
- **现量复核（`87f62b39` 之后）**：HEAD 里该文件 385139 B / 5165 行；`^208. `=1、`^213. `=1、
  `^214. `=1、`^212. `=0；工作树 md5 前后 SAME；别人已暂存 8 条目一条没动
  （中间那次 9→8 是我自己那条"恢复条目"进了索引又与 HEAD 重合，不是他们的）。

📌 一般规律：**sha 对任何字节串都算得出来，所以"blob 建成功了"完全不构成"blob 是对的"**。
任何"从文本建 blob 再提进历史"的路子，收尾必须做一次**读回比对**（`cat-file -p` 的尺寸 + needle），
而不是只看 `hash-object` 的退出码和那 40 个十六进制字符。

#### 15.43o ② 的集成态全链读数（载体 `1ebcf136`，2026-10-04 05:25–05:28，74 段）

`pnpm -r build` rc=0；起跑前负载 `{ 11.39 19.71 20.83 }`（阈值 12 = 16 核 × 3/4）、对端相关进程 11。
**链 74 段 = 59 绿 / 14 红 / 1 段按规则不跑**（63 `check:ai-e2e`，理由见 §7 #87；这轮的替代读数在阶段 4 单跑）。

**本线 12 道门禁全部 rc=0**（逐段现取自 `chain-ai-closeout-0525/segments-rc.txt`）：
`01 check:gate-wiring`、`03 check:entries`、`09 check:migrations`、`11 check:layering`、
`23 check:docs-voice`、`25 check:legal-tools`、`40 check:docs`、`43 check:ai-quota`、
`44 check:ai-tools`、`46 check:design`、`48 check:server-design`、`62 check:ai-coverage`。

14 条红**逐段归属**（每条都用它自己报出的文件判，不看"某条线在忙"的印象）：

| 段 | 门禁 | 报出来的东西 | 归因 |
|---|---|---|---|
| 35 / 64 / 65 | journey-coverage / privacy-consent-e2e / landing-e2e | `内存闸门拒绝启动：已有测试在跑（pid=3248，锁 /tmp/tfa-test.lock）` | **环境无效**（外部 tfa-shield 拒并发），不是产品 |
| 08 | check:op-log-semantics | `mutate-op-log-semantics.mjs: missing assertion report` | 别人那条线的变异夹具 |
| 12 | check:ui-provider | `GrowthScreen` 里 `<GrowthBoard>` 不在 Provider 子树 | 界面线 |
| 13 | check:theme | `apps/web/tests/countdown-card-export.spec.ts:192` 直取 L0 原始表 | 倒数日线（W7 的测试） |
| 15 | check:selection-single-source | `packages/ui/src/calendar/CalendarDayBoard.tsx` 声明 `onOpenTask` 没用起来 | 日历线 |
| 18 | check:widgets | 四端解析器夹具与真源不一致 | 小部件线 |
| 22 | check:ui-language | `apps/web/src/lib/local-data-destruction.ts:264` 诊断字段里整句中文 | 法务/存储线 |
| 26 | check:legal-permissions | `packages/legal/src/documents/third-parties.ts` 中英两行仍写"移动端不申请通知权限" | W9 提醒投递线 |
| 31 | check:image-license | `server/package.json` 与镜像依赖快照差一枚 sha256 | 服务端线 |
| 32 | check:crosslang-contract | C# 驱动契约重放 2 条失败（`destroy 幂等`）+ rc=134 | Windows/mac 壳线 |
| 66 | check:shell-unicode | `research/tools/r14c-window-retry.sh:85/88` `$?（` 全角括号 | 窗口重试点（不是我这轮写的脚本） |
| 74 | `pnpm -r test` | **21 个包/应用全 passed**（`packages/local-api` 8 files、`app-host` 64、`ui` 30、`apps/mobile` 47、`packages/domain` 36），只有 `server` 1 个文件失败：`tests/holiday-adjustment-migration.pglite.spec.ts` | W4b 调休线的迁移测试 |

两处**相对上一轮（载体 `187057bb`，73 段 64 绿 / 8 红）的变化**要写清：
① `check:licenses:stamp` 这轮**转绿**（段 29 rc=0）—— 那枚 lockfile sha 由它的所有者补齐了；
② `packages/domain` 那条翻译断言这轮**转绿**（段 74 里 36 passed）。
⇒ "红变绿"在这条链上多数是**别人落地了**，不是我这轮做的事；记下来是为了不让下一个人把它当成本线的成果。

#### 15.43p ④ 的现量复核（traps 编号、死链、AGENTS/PROGRESS 为什么仍然不碰）

**traps 编号（05:40 现量，`grep -cE '^[0-9]+\. '`，含条目体内的有序列表行所以比条目数略多）**：

| 载体 | 行数 | 最大号 |
|---|---|---|
| `HEAD`（`c39bb98c` 那一刻） | 222 | **214** |
| 工作树 | 223 | **214** |

差的那 1 行就是另一条线未提交的 **#212**。`208 / 213 / 214` 在 HEAD 里各 **1** 次、`212` 为 **0**
（`for n in …; git show HEAD:… | grep -cE "^$n\. "`）⇒ §15.43m 里那个"重复 208"在 `87f62b39` 之后**已不存在**。

**AGENTS.md §7 索引行**：另一条线**已经**在工作树里加了 `| 177–209 | 判据与取证装置的第二批 |`（第 491 行，
属于它那 4 个未提交 hunk 之一）。我这两条是 **#213 / #214** ⇒ 那一行该延长成 `177–214`。
**但这一行现在住在别人的未提交 hunk 里**：按 §15.43h 同一条纪律，`AGENTS.md` 现量 4 个脏 hunk
（`-491 / -514,2 / -522 / -581`，内容是 §8.9–§8.17 新增工作流规则 + 那条索引行 + W9 那一行），
`PROGRESS.md` 现量 **+8 行 / 1 hunk** —— 两本都不是我写的 ⇒ **一个字节都不动**，
把"待改的一行"登记在这里：

> 待办（谁落 AGENTS.md 谁顺手改）：把 §7 索引表那一行 `| 177–209 |` 改成 `| 177–214 |`，
> 并在代表条目里带上 `#213 落地之后才装的顺序门只判"main 走没走"是单向的`、
> `#214 notarytool 挂几个小时⇒"进程在场"≠"在干活"`。

**死链检查**（④ 要求文档改动过这道闸）：`node research/tools/docs-link-check.mjs` 于 05:40 **退 0**
—— 扫描 282 个 Markdown 文件、1926 个相对链接、55 处页内锚点，**无死链、无"本机有仓库里没有"、
无失效章节/锚点引用**；2 条登记豁免（`icp-app-filing.values.local.md`、仓库外 skill 软链）与
8 条 `research/upstream|standalone|parts` 跳过都是既有豁免，不是本轮新增。
上一轮记的那 6 条"adr/0050 指向未跟踪文件"这轮**读数上**已不在红集里（这道闸的判据就是"本机有、仓库里没有"
的链接数，它报 0）；**成因没去复核** —— 是那批文件被它的所有者提交了，还是那几行引用被改了，本会话没测。

**本轮落在 `main` 上的本线提交**（都不 push）：`a2a6541b`（吞了别人的 #208–#211，见 §15.43m）、
`1ebcf136`（§15.43m 自报）、`bfdeea31`（18 字节事故）、`87f62b39`（恢复 + #213/#214 正确落地）、
`a06e29f8`（§15.43n/o）、`c39bb98c`（B68）。

#### 15.43q 一次"当场修红"修错了对象：`minmax(0, 1fr)` 的 A/B 否证与摘除（06:03–06:13）

阶段 4 的 e2e 全量读数：**141 passed / 14 failed / 2 skipped（13.7 分钟，载体 `1ebcf136`）**。
14 条红里本线只有 1 条（`ai-assistant.spec.ts:65` 第 121 行的「切换到暗色主题」点不动），
另外 13 条分属运营后台 4、日历 3、通知中心 2、清单文件夹 1、头像 1、任务行命中区 1、vault 1，
外加 `admin-console` 那 4 条与 `tfa-shield` 无关（它们是真跑真红）。

我看到 Playwright 报 `detail-column … intercepts pointer events`，读了提交态 CSS，
给出机制（裸 `1fr` 轨道溢出到详情轨下面）并**当场落了改动** `030f0969`。
主检出 05:52 那趟三条 spec `6 passed` 看起来"验证通过"了 —— 但那是**两棵不同的树**：
主检出有 150 条别人未提交的界面改动，载体是干净的提交态。

于是做受控 A/B（同一棵载体，两腿只差我那两行，脚本 `~/scratch-heyta/b69-ab.sh`）：

| 腿 | 状态 | 读数 | 失败集合 |
|---|---|---|---|
| A | 载体原样（改动前） | `rc=1`，4 failed / 2 passed | ai-assistant:65、calendar-cells:76、calendar-cells:257、task-row-touch-target:119 |
| B | 打上 `minmax(0, 1fr)` | `rc=1`，4 failed / 2 passed | **与 A 逐条相同**，日志里仍有 `intercepts pointer events` |

⇒ **我那两行是因果惰性的**，机制那句是错的。已用 plumbing 精确摘掉（`3636e610`，2 插入 / 5 删除，
只碰 `base.css`，别人暂存的 8 条目未动，工作树该文件回到干净）。
B69 里那句"机制"与"一行改法"就地划线更正，留下的有效部分是：**空的 `.ht-app__detail` 确实吃掉页头右侧的点击**
（图证 + 命中测试原文），以及一条比改法更有用的线索 —— **让主检出转绿的是别人未提交的那批界面代码**
（三份 spec 在两棵树里逐字相同，`1ebcf136..main` 之间没人碰过 `base.css`/`main-area.css`/`App.tsx`/`e2e/tests`），
所以这条红等他们落地会自己闭合。

**三条可迁移的**（都是这次自己踩的）：

1. **"改完在另一棵树上绿了"不是验证**。A/B 必须在**同一棵树**上做，两腿只差被检的那几行；
   跨树比较（干净载体 vs 混合主检出）量的是"谁的代码"，不是"我这几行"。
2. **两腿读数逐字相同 = 先怀疑一次都没跑**。本仓第一次跑 A/B 时两腿都是 `rc=1` 且日志都是 452 字节的
   `内存闸门拒绝启动` —— 拒绝码与用例红同为 1，差点被读成"改动无影响"。
   ⇒ 每腿跑完先 `grep -qa '内存闸门拒绝启动'` 判 NOT-RUN 并有界重试，再谈红绿。
3. **"当场修完"这条纪律要求的是修**真问题**，不是修到绿**。我这次的动作顺序（读机制 → 落改动 → 找验证）
   比正确的顺序（读机制 → **先在干净树上造出可区分的读数** → 再落改动）少走了一步，
   代价是一笔需要被自己否证的提交。留原句划线、不悄悄删。

**② 的最终读数（三条都带载体）**：build `rc=0`（载体 `1ebcf136`）；链 74 段 = 59 绿 / 14 红 / 1 按规则不跑，
本线 12 道门禁全 `rc=0`；e2e 套件 = 141 passed / 14 failed / 2 skipped，本线 1 条红已定源到别人的面上。

#### §15.43r（10-04 06:31）③ 重起之前先补了自家两件工具的洞 —— 外部门的"退 1"必须与"用例真红"可分辨

06:2x 现量：`main` 已从 `6bcb02cf` 前进 27 笔到 `dc63cbff`（命中打包输入集的只有
`scripts/verify-mobile-notes.sh` 一处），我 ② 的读数载体 `1ebcf136` 成了它的祖先 ⇒ 队列阶段 1.5
会把载体 ff 到当前 main 再跑一遍链，**那份新读数才是 ③ 的落地依据**（旧读数不删，它属于旧载体）。

重起队列前量出现场有三件别的东西在跑：`heyta-wt-hierarchy` 的 `pnpm --filter @heyta/domain exec vitest`
（pid 29093/29434）、`heyta-wt-batch2` 的第三趟全量 `/tmp/check-pass3.sh`（pid 66418，自带一个
上限 60 分钟的负载门；06:29 复测它已退出），以及**空锁** `/tmp/tfa-test.lock`。后两件让我撞见自家两个真洞：

1. **队列的阶段 1 看不见"对端有一趟全量 check 在飞"**。它的 `chains_active()` 认的是 `CHAIN_RE` 里那
   几个脚本名，而对端那趟叫 `check-pass3.sh` —— 换个名字就漏。⇒ 新加 `wait_test_channel()`，
   **归属只认运行时字段：进程的 cwd**（`lsof -a -d cwd -p`；不带 `-a` 是并集 = 假读数，这条已在
   §15.43p 记过一次），不认文件名、不预先假设"一共几条线"。候选 test runner 用形状匹配
   （`-r test` / `--filter … test` / `vitest run` / `node --test` / `playwright test` / `check-pass`），
   再把 cwd 等于我这棵载体的排掉 —— 于是我自己那趟链永不自匹配（这是结构性的，不靠方括号技巧）。
2. **`heyta-chain.sh` 会把"被内存门挡下"记成红段**。读了门的本体
   （`~/.tfa-shield/bin/tfa-shield:94-116`）才确认机制：锁是 **pid 文件**（`echo $$ > LOCK`、
   `kill -0` 判活、退出时只删自己那行），**不是 flock**（本机 `flock` 命令根本不存在 —— 我一度打算
   用 `flock -n … -c 'echo FREE'` 判通道，那在这个平台上恒为"没人在跑"），被挡下时 `exit 1`，
   **与用例真红同码**。⇒ 每段单独写 `$OUT/seg-<idx>.log`，`rc≠0` 且段日志含门自己打出的那句
   `内存闸门拒绝启动` ⇒ 记 `env=BLOCKED(holder=<pid>)`、不计红，汇总多一列 `env-blocked=N`，
   并且响亮地写"这份读数不完整，不能写成 N 段跑完"。needle 只取门的原文，我的描述语句不写这几个字
   （门的分类 needle 撞产品语句那个坑，同一族）。

两条都按"改了判据就把那一端真跑一遍"办了，各带正反对照：

| 腿 | 造法 | 读数 |
|---|---|---|
| ① 现场 | `other_tree_tests` | `29093 29434`（hierarchy 那两枚，逐字命中） |
| ② 真锁 | 此刻无人持有 | `rc=1`、`TEST_HOLDER` 必须是空 ⇒ 对（不留脏值） |
| ③ 阴性 | `exec -a 'vitest run' sleep`，cwd=载体 | **不**出现在名单 ⇒ 对（不自匹配） |
| ④ 阳性 | 同样一枚，cwd=主检出 | **出现**在名单 ⇒ 对（换名也抓得住） |
| ⑤′ | 把别树 pid 写进探针锁文件 | `rc=0 holder=[5884 …/heyta]` ⇒ 对 |
| ⑥′ | 把载体 pid 写进探针锁文件 | `rc=1` ⇒ 对（自己的门不挡自己） |
| ⑦′/⑧′ | 死 pid / `abc` | 都 `rc=1` 不炸 ⇒ 对（pid 文件语义，不是存在性判据） |
| 分类器 | 真拒绝日志 `/tmp/b100-vitest.log` | `ENV-BLOCKED`；真用例红（无该句）→ 空；绿段 → 空 |

一处自己的测试缺陷也记下来：⑤ 第一版把 **cwd=载体** 那枚 dummy 塞进锁里当"别人持有"的阳性样本，
探针判它不挡路（这是正确行为），我却把这条读成"⑤ FAIL"⇒ **阳性样本的归属也要与它要证的那条性质同向**，
否则是测试写错而不是判据坏。第二次用 `cwd=主检出` 那枚重跑，一次过。

队列已在 06:31 重起（pid 10581，读数目录 `~/scratch-heyta/deliver-0631/`），**新门第一次上场就起作用**：
`阶段1 测试通道：测试通道被占 ⇒ 等 120s；别人在跑的 test runner=10256 29093 29434` —— 若没有它，
我的链会在阶段 74 被门挡下、产出一份需要逐段解释的假红。阶段 5 的"别人的重装仍在场"也从一次性
`bail` 改成**有界等（默认 21600s、每 120s 一轮、每轮打 pid/etime/time）**：这一条**不按 CPU 放宽**
（装到一半醒来就会与本轮抢 `/Applications`、模拟器和打包机），但 05:55 那一趟是"存在就退出"，
挂死的对端进程一旦被处置也没有任何东西接着把 ③ 跑完 —— 那是把"不并发"实现成了"永不"。


#### §15.43s（10-04 06:34）④ 的复测把我自己那条待办判成过期：登记"数字"的待办一小时内就会漂，要登记**取值命令**

06:34 现量（同一趟里两次）：

```bash
grep -cE '^[0-9]+\. ' docs/reference/environment-traps.md          # 工作树 224 / HEAD 222
grep -oE '^[0-9]+\. ' … | tr -d '. ' | sort -n | tail -1            # 工作树最大号 215 / HEAD 214
grep -n '177–' AGENTS.md                                            # 第 491 行仍写着 177–209
```

§15.43p 那条待办当时写的是"把 `| 177–209 |` 改成 `| 177–214 |`" —— **它落地前就已经错了**：
另一条线在 06:3x 又追加了 **#215**（尚未提交，所以 HEAD 仍是 214、工作树 215）。
这跟 traps #82 那句"引用 N 项要带是哪一趟"是同一件事，只是这次漂的是**我自己写给后来者的待办**，
而且漂移发生在我写下它的**一小时内**。

⇒ 待办改写成命令式（下面这行取代 §15.43p 那句，原句划线留旁边）：

> ~~把 §7 索引表那一行 `| 177–209 |` 改成 `| 177–214 |`~~
> **改 `| 177–209 |` 为 `| 177–<现量最大号> |`，`<现量最大号>` 用上面第二条命令当场取，
> 并确认它是**已提交**的最大号**（工作树可能比 HEAD 大 —— 未提交那条不属于任何索引行，
> 由它的所有者在提交时自己延长）**。

`AGENTS.md` / `PROGRESS.md` 本会话仍然不碰：两者在工作树里都是别的线的未提交改动
（`M AGENTS.md` 4 个 hunk 里含那一行本身），按红线不带走别人的 hunk，也不往正脏着的共享台账追加。

#### §15.43t（10-04 06:37）五条隐私不变量在**新 main** 上的逐条现量（含我自己一次探针误判）

`main` 现在是 `6354ff7b`（比我 ② 的载体 `1ebcf136` 又多了别人的若干笔）。等窗口的回合做了这件事：
**不变量不能只看门禁 rc=0，要有一条能对上 Goal 那句原话的现量读数** —— 别人的一笔提交完全可能把
某条摘松而让 12 道门禁里的某几道照样绿。

```
check:ai-coverage rc=0   check:ai-tools rc=0   check:legal-tools rc=0
check:legal-copy rc=0    check:legal-permissions rc=0   check:legal-host rc=0
check:ai-quota rc=0
```

逐条对到源码（`grep` 现取，注释未剥 ⇒ 见下面那条自报）：

| 不变量（Goal 原话） | 现量形状 | 谁在守 |
|---|---|---|
| AI 类型上产不出 op | `packages/ai` 零运行时依赖、不 import op 构造 | `check:ai-tools` 规则 3（按行扫 `entityType: '<大写>'`，跳注释行） |
| `host.submit` 全仓恰好一处 | **两处，各自恰好一处**：`ai-tool-run.ts:195`（在 `confirmAiToolProposal()` 内）+ `local-api/src/server.ts:590`（MCP 写入口） | `check:ai-tools` 规则 2（`RUN_FILE` 剥注释后 `.submit(` 计数 ≠1 即红，且必须在确认函数之后）+ 第 407-475 行那段（§15.18 之后补的 MCP 入口计数） |
| 逐工具默认关 | `packages/local-api/src/tools.ts:449-450`：`isToolGranted()` 判的是 `grants?.[toolName] === true` —— 没登记 = `undefined` ≠ `true` ⇒ **漏配即关**（不是"默认为开"） | `check:ai-coverage` + `packages/local-api` 自己的 spec |
| 出境逐字段披露 | `fallback-needs-consent` 在 `packages/ai/src` 命中 6 处 | `check:ai-tools` / `check:legal-*` |
| 回退不跨越隐私边界；不开托管 AI | `supply.ts:290 assertEnableable()`：`mode === 'managed'` 且 `retentionDisclosure('heyta-cloud').kind === 'undecided'` ⇒ `throw`  reason `retention-undecided`（第 293-300 行）——**有意的失败还在抛** | `check:ai-quota` |

🔴 **自报一条探针误判**：我第一版把"恰好一处"量成 `4 处`（`grep 'host\.submit('` 跨 4 个包），
差的那两枚是 `server.ts:526` 与 `AssistantPanel.tsx:24` 的**注释里的字面串** ——
门禁自己 `stripComments()` 正是为这个存在的（文件头第 66 行就写着"这两个文件的注释里大量提到
`host.submit`"）。⇒ 与仓内装置同族的判据，**先读装置怎么算，再决定自己的 grep 要不要剥注释**；
拿着宽口径的计数去报"红线被破"是白花一次报警。

另一处口径要说清（不是放宽，但原话读起来会误导后来者）：Goal 里那句"`host.submit` 全仓恰好一处"
是 §15.18 之前的形状；MCP 入口那第二处是**同批发现、同批补的门禁**（任务 #34），它本身也被计数钉住，
且那条路要过 ADR-0011 的逐工具授权。**没有哪一层在"允许更多写入口"。**

#### §15.43u（10-04 06:41）③ 起之前的两项前置体检：依赖/purge  hazard 不在路上，但漂移门有一个"类"没覆盖到

**(1) 载体的依赖形状 —— 排掉了一个会毁掉主检出的假设。** 本环境有一条已入档的教训：
linked worktree 的 `node_modules` 不能软链主仓库那份（pnpm 会试图 purge 共享树）。
06:50 现量（比"根目录是不是真目录"强一档）：遍历载体里全部 `node_modules` 软链
**3198 枚，逐个 `realpath` 后落在载体树外的 = 0**
（⚠️ 我第一版用 `find -type l | grep -c node_modules` 量到 706 就当"外部软链数"——
pnpm 的 `.pnpm/node_modules/*` 本来就全是树内相对链，那个数不代表任何风险，是坏探针）。
`pnpm config get verify-deps-before-run` = `undefined`、根 `.npmrc` 与 `~/.npmrc` 都无该项；
`grep -n 'pnpm install|--frozen|prune' scripts/reinstall-all.sh` ⇒ **零命中**，它对 pnpm 的唯一调用是
第 183 行的 `pnpm -r build`（而段 02 已经在这棵载体上把它跑成 `rc=0`）。
⇒ ③ 的路上没有"隐式 install/prune"这一步，不需要为它加任何旗标。**这条不是"顺手看一眼"：**
如果它在，窗口一开队列就会在阶段 5 中间去动主检出的依赖树，那是能把别人正在跑的验收一起打掉的事故形状。

**(2) 漂移门的集合摊开后发现一类没被吃到：根级 `tsconfig*.json`。** 阶段 3 用 `PKG_INPUT_RE` 判
"载体 == 当前源码"。摊开根目录 11 个不被该式覆盖的 tracked 文件
（`.dockerignore .gitignore AGENTS.md BLOCKED.md CLAUDE.md CONTRIBUTING.md LICENSE PROGRESS.md
README.md THIRD_PARTY_LICENSES.md tsconfig.base.json`）—— 只有最后一个有构建消费者：
8 个包的 `tsconfig.json` 都 `extends` 它（grep 现量：`packages/legal|ui|widget-core|i18n|local-api`、
`apps/desktop{,.renderer}`、`apps/landing`）。改它会改**所有端**的编译产物，而旧式会把它当文档判成"零漂移"。

补一项 `^tsconfig[^/]*\.json$`，并按"能不能失败"验三条（同一趟）：

| 合成漂移 | 旧式 | 新式 | 该是什么 |
|---|---|---|---|
| `tsconfig.base.json` + `packages/ui/src/x.ts` | 1 | **2** | 新项有牙齿（不变就是装饰） |
| `README.md` + `AGENTS.md` | 0 | 0 | 没被顺手焊死（纯文档不该挡装） |
| `apps/web/evidence/a.png` + `docs/x.md` | 0 | 0 | 验收自己重写的产物目录仍排除 |

⚠️ 诚实的一条：**这个洞在本仓从未被触发过** —— `git log -- tsconfig.base.json` 只有 P0 骨架那一笔
`f679c67d`。补它是让**类别**闭合（"根级构建配置算不算打包输入"这个问题本来没有答案），
不是修一次已发生的事故；别把它读成"差点装了过期产物"。

**(3) 一条操作纪律的正面应用**：要改的是**正在跑**的队列脚本，而本环境已入档"不许原地编辑正在跑的
bash 脚本"（bash 按偏移边读边执行，长度一变会从错位处继续）。次序是：
`ps -p 10581 -o pid,ppid,lstart,command` 确认那一枚是我 06:31 自己起的、且它还停在阶段 1 的等待循环
（`grep -c '阶段 2/5'` = 0，没开始干活）⇒ `kill 10581`（只这一枚，不按名字广播杀）⇒ 改 ⇒
`bash -n` + 上表三条对照 ⇒ 重起（pid 35045，读数目录 `~/scratch-heyta/deliver-0641/`）。

#### §15.43v（10-04 06:48）③ 的现场普查用的是仓里那道现成体检装置，结论把"闭合条件"从两条改成四条

06:45 跑 `research/tools/b-reinstall-readiness.sh`（**别的线**为 B 落的装置，默认 dry-run、
只量不动设备；我先读它的文件头与 `rm` 面确认它只删自己的临时文件才跑）——
`READY_RC=3`，"窗口没开，4 项前置不成立"：

| 前置 | 现量 | 我这一侧的处理 |
|---|---|---|
| 有另一趟 reinstall 在跑 | pid 93817（3h32m，子 `package-app.sh` 95477 挂在公证 `--wait`，累计 CPU 0.04s） | 阶段 5 的有界等（120s/轮、上限 21600s）；处置权在人（B67 有 `ps`+`kill` 两条） |
| 目标树有别人未提交的打包输入 | 主检出 76 枚（我的队列另判 `--target b` + 载体自己的差集） | 队列按规范闸门挡，不在混合态上装 |
| iOS 设备名歧义 | 三台 Booted：`heyta-iphone-17pro` / `heyta-ios-isolated` / `iPhone Duo heyta` | **早就显式传**（`IOS_DEVICE_NAME=${IOS_DEVICE_NAME:-heyta-iphone-17pro}`，traps #169 那条我先前一轮就做了）；约定不是我自己发明的：`b-reinstall-readiness.sh:28` 与另一条线的台账 00:49:10 都是这个名 |
| android 段无可达设备 | `adb devices` 里**一台都没有**；本仓 AVD = `heyta-w3-yearly` | 🔴 本轮补：见下 |

**补的那一条**：`reinstall-all.sh:297` 会自己把 android 段如实判红（§6.1.1"不硬装"），
但那时 mac / windows / ios 三端**已经被这一轮重装过** ⇒ 现场变成"三端新、一端旧"，
下一轮读任何一端的判据都要先问代次。半轮不如不起，于是阶段 5 在 `INST_START` **之前**加两条：
`adb` 不在 PATH ⇒ 退 3（"读不到设备"≠"没有设备"，探针坏不许伪装成现场空）；
`adb devices` 无 `device` 状态条目 ⇒ 退 3 并把准备动作交回人。
**我不代起 qemu**：那道体检装置自己写明"环境准备不在本脚本里代跑：起 qemu 会把负载顶上去，
别人的 adb 因此超时"——我照它的判断，而不是自己另发明一条（06:44 我凭记忆写的
`~/Library/Android/sdk/emulator/emulator` 在本机**根本不存在**，真路径是它现探测后打印的）。

新探针的六种形状各跑一次（`awk 'NR>1 && $2=="device"'`）：
真空→空；`emulator-5554 device`→命中；`offline`→不计；`unauthorized`→不计；
两台混合（一在线一离线）→只报在线那台；真实现场→空（与 06:45 那道体检的读数一致，两条独立通道对上）。

其余 ③ 前置里唯一**没有**卡住的一项是打包机：`ssh -o BatchMode=yes windows-pc 'echo WIN_HOST_OK'` ⇒ 通
（附带一条 openssh 关于 `pq.html` 的升级提示，不影响这次连接；没据此推任何结论）。
队列重起为 pid 51640 / `~/scratch-heyta/deliver-0648/`（改的是正在跑的脚本 ⇒ 先 `ps` 认 pid、
确认它还停在阶段 1 没开工，才 kill 单枚、改、`bash -n` + 六形状对照、再起）。

#### §15.43w（10-04 07:00）测试通道门从"存在"改成"在算"，顺带照出一条潜伏了一整晚的自家探针缺陷

改的形状（`~/scratch-heyta/heyta-deliver-on-window.sh`）：`wait_test_channel()` 原来用
"别人树里存在 test runner"挡，改成两条信号 ——
① 内存门锁被**别的树活着持有**（保持严格，因为被挡下时退 1、与用例真红同码）；
② 别的树的 test runner **整棵进程树**在 5 秒窗口内 CPU 增量 ≥20 百分秒才算"在算"
（复用本脚本既有的 `tree_pids` / `tree_cpu_hsec`，不另发明一套；阈值取"僵尸恒 0、真 fork 池是秒级/秒"中间的位置，
并由 `HEYTA_TEST_LIVE_HSEC` 可调）。同时删掉脚本里**第二份 `win_gate()` 定义**
（与第一份只差 `if…fi` 写成 `&&` 的形状 —— 语义相同，但"同一个判断写两遍"就是本仓漂移的起手式）。

三条腿的真跑（`exec -a 'vitest run' bash -c 'while :; do :; done'` 造两枚 argv 相同、cwd 不同的样本）：

| 腿 | 期望 | 实测 |
|---|---|---|
| 别树烧 CPU 的 83549 | 进"在算" | 对（名单 `29093 29434 83549`） |
| 我载体烧 CPU 的 83550 | 两名册都不进（`$CARRIER` 排除） | 对 |
| 真实现场那枚 spinner 的祖先 29434 | 进"在算" | 对，僵尸名册为空 |

🔴 **同一趟照出我自己两处错**：

1. **潜伏缺陷**：`chains_active` / 新的 `live_other_tests` 都是 `n=$(func)` 形式调用的，
   **命令替换跑在子 shell 里**，函数里赋的全局（`CHAIN_WAITERS` / `CHAIN_HUNG` / 最初的 `TEST_ZOMBIES`）
   在父 shell 永远看不见 —— 表现为 `TEST_ZOMBIES: unbound variable`（`set -u` 帮了忙），
   而 `chains_active` 那两个**已经错了整晚**：日志里每一行"纯 waiter 无 / 挂死 无"都是
   **没传出来**，不是现场真的没有（§15.43r 我还把其中一行当成读数引用过）。改成走文件（`SIDE_FILE` +
   `say_side` / `read_side`），并让打印带 `=` 号，这样"空"与"没传出来"在日志里长得都不一样。
2. **一次被否证的因果判断**：06:52 我量 `ps -o time= -p 29093,29434` 得 8 秒零增量，判"对端两枚僵尸、
   我的门在僵尸上死等"。06:59 用整棵树重量：真正在烧的是它们的**子进程 29644**（vitest fork worker，
   `R` 态、100% CPU、累计 **486 分钟** / 存在 8 小时 10 分），两个父进程本来就该是睡的。
   ⇒ 门判它"在算"是对的，**我的探针漏了子树**。现场登记与后果写在 **B70**（③ 的窗口因此不会自己开，
   队列会等到 7200s 上限按环境无效 exit 3）。
   教训形状与本仓 10-03 那条"归属只认运行时打印的字段"同族：**判一棵树忙不忙要按整棵树求和**，
   只看 `ps -p` 点名的那几枚 = 只看调用栈最上面一层。

#### §15.43x（10-04 07:12）§15.43w 那条"改成走文件"**只修了一半**：读侧停在第一条匹配 ⇒ 三栏辅助读数仍然恒空

按 §15.43w 自己写的自查动作（"改完把已知非空的那一类喂进去"）拿阳性样本喂了一次，结果照出来第二层缺陷：
`read_side` 写成 `awk '…{print; exit}'`，而两个写函数都是**累加式**（先 `say_side zombies ""` 写一行空键，
再把"已有值 + 新值"追加成下一行）⇒ `exit` 永远停在那行空键上。
所以 `chains_active` 的 `纯 waiter` / `挂死` 和测试通道的 `僵尸` **三栏在 07:11 之前没有一栏给过真读数**，
包括 §15.43w 里我当成读数引用过的那一行 —— 那几行"无"全部作废，不许再当"现场确实没有"的证据。

改法（`heyta-deliver-on-window.sh:139`）：读**最后一条**匹配而不是第一条。
喂阳性样本重验（一次性 harness：`sed` 抽函数 + `bash -n` + 逐个 `type -t` 断言在位，再跑）：

| 腿 | 期望 | 现量 |
|---|---|---|
| 阳性样本进僵尸通道 | 我那枚空转的 `node -e … vitest run`（pid 18224）出现在 `zombies` | ✅ `僵尸侧信道= 18224` |
| 阳性样本不被判成在算 | 不出现在 `live` | ✅ 不在 |
| 真活体仍在 | `live` 含 07:02 闸门那两枚 | ✅ `29093 29434` |

重启后（pid **18678**，输出目录 `~/scratch-heyta/deliver-0712/`）的第一行就是证据：
`阶段1 另一趟链：没有另一趟交付链在跑（等 0s；纯 waiter= 6992）` ——
6992 = `bash /tmp/heyta-window-chain8.sh`，**另一条也在等窗口的队列**（只读确认，没动它）。
⇒ 这一栏从今天起才第一次给出真读数；顺带把"③ 的窗口被几条队列在争"这个问题从"看不见"变成"看得见"。
main 已推进到 `598264ab`，我那笔台账 `3d14767d` 仍在祖先链里（`merge-base --is-ancestor` = YES）。

#### §15.43y（10-04 07:18）④ 的"traps 编号按工作树现量复核"重跑一遍：缺号仍是那四个，另外补一种**没被登记过的假阳性形状**

这趟不是新缺陷登记，是**复核**：把"引用号 ↔ traps 里是否存在该条目"整条链重跑，
用 `#N` 与「§7 第 N 条 / 第 N 项」两种引用形状扫全仓 `.md`（不含 traps 自身），**共 1325 条引用**。

| 项 | 07:18 现量 | 与既有登记的关系 |
|---|---|---|
| traps 最大号 | 218（HEAD 214 ⇒ `#215–#218` 是别人未提交的） | 与 §15.43p 那条"取号要用当场量的最大号"一致 |
| 悬空引用号 | `#83`（被 26 处引用，含 `AGENTS.md:486` 那行 §7 索引"80–83 … #83"）· `#84` 8 处 · `#85` 10 处 · `#120` 5 处 | **仍是这四个**，一条没闭合；`BLOCKED.md:3561` 在号到 180 时就登记过 —— 之后又并进来 38 条，洞没填 |
| traps 本体重号 | `38 / 93 / 94 / 95` 各有**两条条目形状**行（例：`:708 38. 一个常量当两种单位用` 与 `:779 38. 软键盘会把 tap 吞掉`） | `BLOCKED.md:3602` 已记机制，本表补的是"截至 07:18 仍未修" |

**可复跑命令**（别凭我这串数字）：

```bash
F=docs/reference/environment-traps.md
for n in 83 84 85 120; do printf '#%s -> %s 行\n' "$n" "$(grep -cE "^$n\. " "$F")"; done   # 应全是 0
grep -nE '^38\. ' "$F" | cut -c1-80                                                        # 应打出两条
```

🔴 **把这三种形状豁免掉，否则下一条门禁会把不是引用的东西判成悬空**：
① 页内锚点（`docs/runbooks/finlaw-cleanup-candidates.md:309` 的 `(#221-heytapnpm-store…)` —— 那 221 不是条目号）；
② **外部仓库的 issue 号**（`research/vector-db-verification-2026-09.md:146` 的 `Issue #230`、
`research/universal-rn-monorepo-ui-2026-09.md:493` 的 `RSD #270`）—— 这一种**此前没在任何台账登记过**，
我这趟是被它绊了一次才看出来的（朴素 `#N` 一扫就当悬空引用报出来了）；
③ 条目内的 `1. / 2. / 3.` 子列表 —— 它让朴素 `^[0-9]+\. ` 计数比"条目形状"计数多 **12**（现量 227 vs 215），
所以"traps 有多少条"这句话必须写明用的是哪个行首模式。

`AGENTS.md` / `environment-traps.md` 本会话仍不改：两者都在别的线手里未提交（`M`），
`git commit --only -- <文件>` 会把别人的 hunk 一起带走；缺号与重号怎么处置（补条目还是改引用）
是那个文件所有者的决定，本线只把现量和命令交出去。

#### §15.43z（10-04 07:34）③ 的 Windows 判据查出两件事：那条快捷方式腿**从未落进任何在盘产物**，而五事实对账原来能被一句散文满足

先把结论的形状说清，免得下一个人把这两件事读成一件：

1. **`SHORTCUT_OK=True` 这条腿的证据面是空的**（07:22 现量）。`windows-pc:C:/src/heyta-msix/install-capture.txt`
   只有四条（`ADD_APPX=OK / PAYLOAD_WEBDIST=True / M2D=OK / RESULT=OK`，408 B，**行尾是 \r**），
   本机与载体里也搜不到任何含 `SHORTCUT_OK` 的产物（只有生产侧脚本自己）。
   ⚠️ 这**不**推翻"快捷方式当时创建成功了"那次交付 —— 那条腿读回的是 `.lnk` 本体
   （`install-and-capture.ps1:129-133`：`CreateShortcut` 回读 + `-like '*shell:AppsFolder*'` + `Test-Path`），
   那趟的读数在会话 stdout 里，**没有落成产物文件**。
   ⇒ 对 ③ 的实际含义：**这一轮是这条腿第一次被真机写进取证文件**，红了就是真红，不是"判据坏了吗"。
2. **五事实对账原来是子串匹配**：喂一行散文 `注：期望 SHORTCUT_OK=True 未满足` 进去，它报"5 条全在位"并退 0。
   ⇒ 改成整行匹配 `tr -d '\r' | grep -qxF`（提交 `214b5fd3`）。两个方向都不能松：
   **不剥 \r 就把真绿判成假红**（取证文件确实在 Windows 侧写、实测每行以 \r 结尾），
   **不整行比就挡不住散文**。

六腿现量（收紧前 → 收紧后，夹具在 `/tmp/facts*.txt`）：

| 输入 | 收紧前 | 收紧后 | 这条腿判的是 |
|---|---|---|---|
| 四条事实（缺 SHORTCUT） | rc=1 | rc=1 | 有牙 |
| 五条事实 LF | rc=0 | rc=0 | 正常放行 |
| `SHORTCUT_CREATED=False` + 失败 message | rc=1 | rc=1 | 创建失败挡得住 |
| **散文里出现 `SHORTCUT_OK=True`** | **rc=0** | **rc=1** | 洞关上（唯一行为变化） |
| 五条事实 **CRLF** 版 | rc=0 | rc=0 | 不因 \r 假红 |
| windows-pc 上那份真产物 | rc=1 缺 SHORTCUT_OK=True | **逐字相同** | 真数据零行为变化 |

顺带核了一处"抄件会不会漂"：`scripts/check-shell-surfaces.mjs:84` 提到 `PAYLOAD_WEBDIST=` 只是注释转述，
**不是第二份清单**；判据的唯一定义仍在 `scripts/lib/msix-install-facts.sh`，两个消费者
（`reinstall-all.sh:272` 与 `package-msix.sh:85`）都调它，且都把"缺一条"变成失败
（前者不置 `RESULT_windows=OK`，后者 `exit 1`）。

#### §15.43aa（10-04 07:38）D-3 收口 Goal 的四件套逐项对账（AGENTS 工作流第 7 条：按范围逐项，不按感觉宣布完成）

| 项 | 判它做完的那条读数 | 载体 | 状态 |
|---|---|---|---|
| ① 合并 | `git merge-base --is-ancestor integrate/2026-10-03-closeout HEAD` ⇒ YES（`dd8f2210`/`f2d7ed40`/`fd34c42a` 三条已在一条线上） | `main=d30ae468`（每次重印；本线那几笔是 `3d14767d 60c6fd71 8d17e99f 214b5fd3 e8508736`） | ✅ |
| ② 集成态验证 | `pnpm -r build` rc=0（段 02）、`-r typecheck` rc=0（段 04）、链 74 段 = 59 绿 / 14 红 / 1 按规则不跑、`check:ai-e2e` 141 passed / 14 skipped / 2 failed、W11 那腿 `tests/tool-batch-complete.spec.ts (13 tests)` | ⚠️ **载体 `1ebcf136`**（队列阶段 1.5 会 `merge --ff-only main` 后重跑刷成落地载体） | ✅ 带载体标签 |
| ③ 交付 | `bash scripts/verify-mobile-window-gate.sh --target b` rc=**0** **且** `scripts/reinstall-all.sh` 四段各自打出该端判据（mac/android 主蓝命中、windows 五事实齐、ios 新鲜度） | 队列 pid 18678 / `~/scratch-heyta/deliver-0712/`（07:38 累计等 1440s / 7200s） | 🔴 **未闭合**，见下面两组数 |
| ④ 台账 | 四节台账 + 一处判据修复全部按路径提交；死链检查 `node research/tools/docs-link-check.mjs` rc=0；traps 编号复核带可复跑命令（§15.43y） | 同上 main | ✅ 授权范围内 |

🔴 **③ 为什么还不能宣布做完 —— 两组数分开看**：

1. **窗口关着**（07:04 现量，`--target b` rc=3，五条前置不成立）：负载 39 > 12 · 主检出 128 枚别人未提交的源码 ·
   另一趟 `reinstall-all` 挂着（93817，墙钟 3h51m 而 CPU 累计 `0:00.01`）· 移动端验收在跑（91783）· 3 台模拟器 booted。
2. **载体侧我能在自己权限内做的都做完了**（07:37 现量，这组是"窗口一开就不会中途炸"的前置）：
   载体 `1ebcf136` 未提交项 = 0；63 枚 `@heyta/*` 软链**全部**解析在载体本树（0 枚指向外面）；
   `ios/Pods` 与 `*.xcworkspace` 确实缺（都被 gitignore），而 `reinstall-all.sh:390-425` 那步
   `pod install` 兜底**在载体这份脚本里在位**；`IOS_DEVICE_NAME=heyta-iphone-17pro` 那台在 booted 清单里。

⇒ 结论只能是"**③ 等的是别人的现场，不是本线的活没干**"。等满按环境无效 `exit 3` 如实记录，
不降级判据、不为跑绿放宽闸门（红线原文）。要人拍板的三件：93817 由谁处置、128 枚源码由各自所有者落定、
hierarchy 那条线那枚转圈 486 分钟的 vitest worker（B70）何时停。

#### §15.43ab（10-04 07:42）③ 在无人值守下几乎必然装不成：漂移那道门判得对，但它**一次就退出**

不是判据太松，是判据的**下一步动作**错了。现量的两条事实合起来看：
07:12→07:42 这半小时里 `main` 并进来 5 笔（其中含 `scripts/`）；而一趟链 + 一趟 e2e 是几十分钟量级。
队列原来在阶段 3（链跑完后）与阶段 5（起装前）都拿"打包输入差集非零"判过期，
**判完之后是 `bail 4` 直接结束整趟** —— 那个 bail 的信息自己就写着"要装就得在新载体重跑链"，可它没有重跑，
它退出了。⇒ 只要这几十分钟里有人并码（现在是常态），③ 就永远停在"读数过期、不起装"，
而且每一趟都从零开始等窗口。这与 05:55 那次"对端重装一存在就 bail"是**同一个决定**：
门不该放宽，但该重试的地方不能一次就放弃。

改成**有界重起**（`retry_round`，`HEYTA_DELIVER_ROUNDS` 默认 3）：漂移 ⇒ 记一行 `RE-ARM`、
`nohup` 起下一轮（回到阶段 1 重新要全部五道门），本轮退出码 **64 —— 故意不是 0**，
免得"父进程 0"被读成"装完了"；重起到第 3 轮仍在并码才 `bail 4`，并写明"这一步需要人挑一个并码停歇的时段"。
判据一条没动：打包输入差集、`--target b`、设备独占、重装存在数有界等待、android 起跑前预检，全都原样。

控制流三条腿离线验过（`SELF` 做成旋钮，测试时指向 `/bin/true`，确认没有误起真队列）：

| 腿 | 期望 | 现量 |
|---|---|---|
| `ROUND=1 MAX=3` | 重起、`rc.txt` 有 `RE-ARM`、退出 64 | ✅ `rc=64 RE-ARM行=1 bail行=0` |
| `ROUND=3 MAX=3` | 不再重起、走 `bail 4` | ✅ `rc=4 RE-ARM行=0 bail行=1` |
| `ROUND=1 MAX=1` | 边界同样落 `bail 4` | ✅ `rc=4` |

重启后的第一行就带上轮次：`0742 pid=93704 轮=1/3`；同一行还给出别的线也在等窗口
（`纯 waiter= 35872 81345`）。⚠️ 诚实记一条没验到的：**重起链本身只在离线夹具里走过**，
真漂移发生时会不会正好卡在两个阶段之间（比如 e2e 跑到一半）要看第一轮的现场。

#### §15.43ac（10-04 07:52）落地那一刻的过期从"只在文字里说一句"变成判定，两个 fail-open 是喂空值样本抓出来的

阶段 5b 原来只把 `POST_DRIFT` 打印一句"≠0 就说明这装已过期"，**动作仍是一路走到末尾写 DONE** ⇒
同一份 rc.txt 里既有"已过期"那句话又有 `DONE` 那一行，后面读的人会挑对他有利的那一行。现在：

- `decide_landing` / `decide_win_facts` 做成函数（能离线喂样本，不必为验一条分支去重跑几十分钟真装机）；
- **`DONE` 只在 `LANDING-CURRENT` 那一支写**，其余两支写 `NOT-DONE <原因>`；重装自己判红则 `exit 1` 且**不**重起（那是产品/装置红，不是窗口问题）；
- Windows 那半边加一条"这份取证文件**属不属于本轮**"（`mtime ≥ INST_START`）；只有属本轮才由本线
  **自己再读一次**五事实，不只转述 `reinstall-all` 的结论（它的红可能被 tail 过滤掉）。

🔴 两条 fail-open 都不是推理出来的，是喂**空值**喂出来的：

| 现象 | 根因 | 修法 |
|---|---|---|
| `decide_landing 0 ''` 回 `LANDING-CURRENT` | `local d="${2:-0}"` 在进门之前就把"没量到"洗成 0 ⇒ 我新加的 UNKNOWN 态永远走不到；调用点 `"${POST_DRIFT:-0}"` 是同一个洞的第二半 | 参数写 `${2-}` 不给默认值、调用点传 `"${POST_DRIFT-}"`；空/非数字 ⇒ `LANDING-UNKNOWN` ⇒ 写 NOT-DONE 并走有界重起 |
| `mtime` 或起跑为空时判成"新鲜" | 空值进 `[ "$m" -lt "$start" ]` 语法错之后**掉到最后那支 return WIN-FRESH** | 两个数各自先过 `''\|*[!0-9]*` ⇒ `WIN-NO-BASELINE`：没有比较基线就不认证据 |

11 条腿全按预期：`decide_landing` 五条（`0→CURRENT / 3→STALE / 空→UNKNOWN / abc→UNKNOWN / rc=1→REINSTALL-RED`），
`decide_win_facts` 六条（`m=s→FRESH / m<s→STALE-EVIDENCE / m>s→FRESH / 起跑空→NO-BASELINE / mtime空→NO-BASELINE / 文件缺→NO-EVIDENCE`），
边界那两条（恰好相等、空值）都在样本里。队列按新机制重启：pid **20138** / `deliver-0752/`、`轮=1/3`，
起跑现量 `main=37dfcc80`、载体未提交项 0、`纯 waiter= 35872 81345`。

⚠️ 这轮只到"判定与动作接上"：**这些分支还没在真实落地事件上跑过**（要等窗口开、四端真装上才有现场），
台账里不预告它们的读数。

#### §15.43ad（10-04 08:0x）§15.43ab 那个形状还有第二处：等满窗口也是**一次就退**，九处一起改；改完顺手发现队列没有"只许一趟"的闸

§15.43ab 把"漂移判过期"从一次性 `bail 4` 改成有界重起。同一轮里我把相邻的九处**环境等待**也数了一遍，
发现它们是同一个错：门的拒绝条件在这几天长期为真（负载 / 测试通道 / 设备 / 别人的重装在场），
而每处 `bail … 3` 都是**等满 7200s 就整趟放弃** —— 于是 ③ 在无人值守下要靠我手工重跑，
而"手工重跑"正是把双跑引进来的那条路。

改法是加 `env_retry()`，九处调用点原样换成它（**四道门、等待上限、设备独占判据一条没动**，
放宽的只有"总共肯等几轮"）：

| 阶段 | 行号 | 那道门在等什么 |
|---|---|---|
| 1 | 318 | 另一趟交付链（`/tmp/heyta-window-chain*.sh` + `纯 waiter`） |
| 1 | 320 | 测试通道（内存锁 `/tmp/tfa-test.lock` + 整棵进程树 CPU 增量） |
| 1 | 322 | 规范闸门 `verify-mobile-window-gate.sh --target b` |
| 1 | 324 | 设备独占（别人正用 emulator 跑验收 ⇒ 不许 `adb uninstall`/`pm clear` 它） |
| 5 | 428 | 同一道闸门在起跑重装前再要一次 |
| 5 | 435 | 设备独占（同上） |
| 5 | 450 | 别人的重装进程在场 |
| 5 | 474 | `adb` 不在 PATH（"读不到设备"≠"没有设备"） |
| 5 | 479 | android 段无可达设备（起了会留下"三端已装、android 仍旧"的半轮现场） |

`MAX_ROUNDS` 默认 3→5，两种重起共用这一个计数器；**等满轮数仍然退 3**，
所以"环境无效 ≠ 产品失败"那条口径没被稀释。中间轮的退出码用 **64**，既不是 0（会让人以为装完了）
也不是 3（会被读成"这轮已尽力"）—— 台账里落 `RE-ARM` / `RE-ARM-ENV` 两类行，各带 round 与子 pid。

**喂样本抓出的一处**：重起子进程时只传了 `HEYTA_DELIVER_ROUND`，没传 `HEYTA_DELIVER_ROUNDS` ⇒
调用方给 `=10` 会在第二跳被默认值 5 悄悄截掉。探针（`SELF` 换成打印收到的环境的脚本）现量
`CHILD round=2 rounds=7 prev=/tmp/env_retry_fixture_dir2` 之后补上传播。三条离线腿：
`1/7 ⇒ RE-ARM-ENV+64`、`7/7 ⇒ bail+3`、`6/5 ⇒ bail+3`（越界也走终局分支，不是死循环）。

🔴 **这次改动本身把"双跑"变成了结构上可能的形状**：接力是"父 spawn 子后立刻 exit"，
父子同时在世那一瞬是正常路径；而我刚就手工重跑了一趟（07:52→07:59 那次）。
所以补了一条只许一趟的闸：pidfile 里那枚 pid **活着 + 命令行确实含 `heyta-deliver-on-window` + 不是我爹** ⇒ 退 **6**；
三条豁免各对应一种真实形状（空/损坏 pidfile、接力交接、pid 被系统复用给别人 —— 最后这条不做就是
"每次 PID 回收都把交付卡死"）。判据不能是"数有几个同名进程"，那会把别人的尾巴和别人的僵尸算进来。

| 腿 | 输入 | 期望 | 现量 |
|---|---|---|---|
| 空 pidfile | `""` | TAKE | TAKE |
| 接力交接 | pid == `$PPID` | TAKE | TAKE |
| 活的另一趟 | 真起一枚命令行含 needle 的进程 | **BLOCK** | BLOCK |
| 死 pid | 999999 | TAKE | TAKE |
| pid 复用 | pid 1（launchd，命令行不含 needle） | TAKE | TAKE |
| **真调用点** | pidfile 写入现役 66947 后跑一次新脚本 | 退 6 | `第二趟 rc=6`，rc.txt 里那行带"起跑 Sun Oct 4 07:59:32" |

📌 改的是**正在跑的脚本**，所以走的是"副本编辑 → `bash -n` → 喂腿 → `mv` 原子换体"：
现役 66947 握着旧 inode，换体对它零影响（日志 08:01:54 仍在正常等待），下一跳接力的子进程才读到新码。
用 Edit 原地改运行中的脚本会把它的字节偏移挪掉 —— 那才是真正会产出乱码重启的形状。

08:0x 现量（不预告读数，只登记起跑现场）：`vm.loadavg 21.73 / 83.27 / 105.31`（较 07:55 的 66 回落但仍超 12 那道门）、
别人未提交打包输入 **95** 枚（07:55 是 177）、重装/打包进程在场 4 枚、测试通道持有 `29093 29434 80532 80538`。
③ 仍然没闭合，缺的还是那四件人才能做的事（处置挂死的重装、各自提交源码、起一台 android 设备、停下空转的 vitest）。

#### §15.43af（10-04 08:0x）上面那句"四件人才能做的事"里有一件**自己好了**、有一件查清了**不是挂死**；队列剩下的那个 TOCTOU 说清并**不擅自补锁**

逐条现场复核（AGENTS 工作流第 7 条：范围以现量为准，不以上一轮的印象为准）：

| 上一轮登记的人为前置 | 08:0x 现量 | 结论 |
|---|---|---|
| "起一台 android 设备" | `adb devices` ⇒ `emulator-5554  device` | ✅ **这条没了** —— 07:55 我量的"无可达设备"这句已过期，原地标注不删 |
| "处置那个挂死 5 小时的重装"（B67） | 链 `93772 → 93817(.snap) → 95477(package-app.sh) → 98934`，最里层是 `notarytool submit Heyta-1.0.0.dmg … --wait`，etime **04:51:36**、CPU 累计 `0:00.03` | 🔴 **不是挂死，是在等 Apple 公证回执**（零 CPU = 阻塞在网络等待）。正确动作是等它回来或让所有者改 `--no-wait`，**不是 kill**。<br>⚠️ 这条口径 **B67 在 06:32 那段早就改正过**（"它挂着 AND 它是设备面的登记持有者，两件事都在"）—— 所以本轮残留的不是文档，是**我自己队列脚本里那句"处置那个挂死的进程"**；它会被下一轮日志重新印成错误归因，已随本轮改掉（抄件漂移的第三个面目：同一结论在脚本字符串里又活了一遍） |
| "各自提交那 177 枚源码" | 现量 **94** 枚；`scripts/reinstall-all.sh` 干净、**`scripts/verify-mobile-window-gate.sh` 是 `M`** | 🟡 减半但仍未清；而且**我自己依赖的那道闸门正被另一个所有者改** ⇒ 它的输出契约随时会变（并行那条线已记："改闸门输出契约要把本线几把 rig 全跑一遍"） |
| "停下空转的 vitest"（B70） | 持有者从 `29093 29434 58839 58842 58855` 收敛到 `29093 29434`（etime 09:15） | 🟡 在退场；负载 `12.85 / 30.64 / 69.61` 已贴着 ≤12 那道门 |

**没补的那把锁，以及为什么不补**（写清比默默留着重要）：阶段 5 那道"别人的重装在场"是**轮询**
（`reinstall_alive == 0` ⇒ 起跑），不是声明 ⇒ 残留 TOCTOU：两条队列可以同时观察到 0。
§15.43ad 的 `decide_single_run` 只封得住**我自己这条队列**的双跑（含接力父子那一瞬），封不住别人的趟。
真闭合要让**共享工具**有一条声明式约定 —— 即 `scripts/reinstall-all.sh` 自己原子地 claim
（`( set -C; echo $$ > /tmp/… )`）、拿不到就响亮退出，这样所有趟（含跑旧快照的）都被同一条拦。
我没单方面这么改，两个理由：

1. 它给共享工具新增一个**拒绝条件**，而"闸门的退出码"与"产品失败"同形是本文件反复登记的那个坑
   （B69：内存闸门退 1 与用例红退 1 分不开，两腿 A/B 差点被我写成"改动无效"）—— 那个码该不该被读成红，要拍板；
2. 那条规范闸门此刻正被另一个所有者改（上表 `M` 那行），此刻在它下游加锁 = 把两个人同时改的东西合进我一个提交。

⚠️ 顺带登记一条我自己的手法失误（同 §15.43y 那族）：我给上一节追加内容时 `old_string` 是**凭记忆复述**的
（把顿号写成 ` / `），命中 0 次。规则还是那条 —— **改文件前先 Read/Grep 看字面形状**，
尤其台账这种"我自己几轮前写的"地方，记忆里的版本与磁盘上的版本差一个标点就是零命中。

#### §15.43ag（10-04 08:1x）五条隐私红线在**新 main** 上重验一遍：两条静态门禁 rc=0，读数与 07:2x 那次逐字相同

`main` 从 `35b7207e` 推进到 `f166d23a`（其间别人并进了 `af4e4b32` 等笔），红线不能靠"上次绿过"。
跑之前先确认**门禁输入本身没混进别人的未提交改动**（否则读数属活树，不属 HEAD —— 这是本仓门禁红的第三种形态）：

```bash
git status --porcelain -- packages/app-host/src/ai-tool-run.ts packages/app-host/src/ai-tool-selection.ts \
  packages/local-api/src/server.ts packages/ai/src scripts/check-ai-tools.mjs scripts/check-ai-coverage.mjs
# 现量：空 ⇒ 7 个输入路径全干净 ⇒ 下面两条读数与 HEAD f166d23a 等价
```

| 门禁 | rc | 关键读数（逐字） | 与 §15.43 早前那次 |
|---|---|---|---|
| `check:ai-tools` | 0 | `规则 9 写入口穷举 20 个 src 根 / 650 个源码文件，命中 2 处（= 清单）`；`两个写入口各自恰好一处且都在指定函数内（助手 confirmAiToolProposal() / MCP executeTool()）` | 相同 |
| `check:ai-coverage` | 0 | `实体覆盖面 9/9（口径：读和写都有工具）；已登记缺口 0 项` · `目录 26 个工具 ≤ 每实体 5 × 分母 9 = 45 席（已用 26，剩 19）` · `界面端覆盖：web 5/5（两级核对）` · `mobile 0/5（显式登记的缺口）` · `托管云 AI 仍被挡住（describeRetention('heyta-cloud') === undefined）` | 相同（零漂移） |

📌 顺带把红线那句"host.submit **全仓恰好一处**"的口径钉清楚，因为字面上它会被读成只有一个调用点：
现量是 **2 处**（`ai-tool-run.ts:195` 助手确认路径、`local-api/src/server.ts:590` MCP 路径），
而 `check:ai-tools` 403-413 行自己就写着：红线「恰好一处」在**仓库级**从来就不成立，
成立的是"**每个入口各自恰好一处**"，并把取证与措辞更正指回本文件 §15.18（那条更正已经落过，
不是本轮新写的）。规则拦的是"在 MCP 入口旁边再加一个写点"，且**判据为 0 也红**（写路径断了 = 工具全写不了，不是更安全）。
⇒ 引用这条红线时该用的措辞是"每个写入口恰好一处"，不是"全仓只有一个 `submit`"；
两处都在确认/授权之后，且 `packages/ai` 那边类型上产不出 op。写成这样是为了下一个数到 2 的人
不必以为红线破了，也不必反过来把这条更正当成新缺陷再报一遍。

#### §15.43ah（10-04 08:1x）§15.43ac 我自己犯了它警告的那件事：新的判定抽出来了，**旧的那份从没删掉**

翻队列脚本的 Windows 段（用户点名的 `SHORTCUT_OK` 就在这一支）时发现：`decide_win_facts` + 四路 `case`
之后还留着**改造前的整段 `if/elif`**，它会再算一遍 `PAX_WIN` 并覆盖前面的裁决。
这正是 AGENTS §3.5 那条教训的形状（"`ids.ts` 抽出来了、文件头还列着漂移对照表，旧的那份却一直活在代码里"），
而我上一节刚写完"落地过期做成判定"，没去查它的下游还站着一个旧判定。

按可达性如实分档（不把最吓人的那支写成主因）：

| 后果 | 现量 | 可达性 |
|---|---|---|
| `rc.txt` 里每轮有**两条** `PAX_WIN`，且最后一行由弱判决定；同一个物理状态两个词表（旧块叫 `STALE`、新裁决叫 `STALE-EVIDENCE`） | 两条都写（`grep -c "printf 'PAX_WIN"` 改前 = 2） | 🔴 **每轮必发** —— 谁按 `PAX_WIN STALE` 去读，读到的就不是那条日志声称的判定 |
| lib 没 source 到时旧块报 `MISSING-FACTS`（"条码不齐"），把"本线没有判据可读"盖成"装了但不齐" | 腿 `nolib` 改前落错档 | 🟡 载体在阶段 1.5 会 FF 到 main，正常路径 lib 在；但载体一旦落后就是它 |
| 基线没量到时算术测试报错、`[ -lt ]` 那一支不成立 ⇒ 直落 `msix_check_facts` 判 **`PROVEN`** | 变异臂现量：`臂 old INST_START=empty ⇒ PAX_WIN=PROVEN`，`臂 new … ⇒ NO-BASELINE` | ⚪ **正常路径不可达**（`INST_START=$(date +%s)` 在第 526 行无条件赋值）⇒ 这是"改前会怎样"的对照，不是当前会发生的红 |

修法三处：删掉旧块、清单条数为 0 时升成独立裁决 `LIB-MISSING`（不冒充"条码不齐"）、读数行合一条。
现量（`grep -o 'PAX_WIN=[A-Z-]*' | sort | uniq -c`）：**六个裁决标签** `FACTS-OK / FACTS-INCOMPLETE /
LIB-MISSING / NO-BASELINE / NO-EVIDENCE / STALE-EVIDENCE`（前两个各出现 2 次是因为赋值行与 `say` 文案里都写着它，
所以字面出现 8 次而标签只有 6 个 —— 计数单位要说清，否则又是一次"行 ≠ 条"）；
`printf 'PAX_WIN` 只剩 **1 行**，带 `facts=/mtime=/msg=` 三列。

七腿离线夹具（`SELF` 不碰真装机，只喂临时载体目录 + 两份取证文件）：

| 腿 | 输入形状 | 现量 |
|---|---|---|
| ok | lib 5 条 + CRLF 五事实齐 + 起跑早于 mtime | `FACTS-OK facts=5` |
| stale | 同上但 mtime=`2020-01-01` | `STALE-EVIDENCE facts=5` |
| nobase | 取证文件在但基线为空 | `NO-BASELINE facts=5` |
| nofx | 没有取证文件 | `NO-EVIDENCE facts=5` |
| nolib | lib 文件不在（载体落后形状） | `LIB-MISSING facts=0` |
| **prose** | 四条齐 + 一行散文写着 `注：期望 SHORTCUT_OK=True 未满足` | `FACTS-INCOMPLETE facts=5`，msg 精确点到 `缺判据：SHORTCUT_OK=True` |
| future | 取证文件与起跑同刻 | `FACTS-OK facts=5`（`-lt` 等号判"属本轮"，同秒不误杀） |

`prose` 那条是 §15.43z  tightened matcher（`tr -d '\r'` + `grep -qxF`）在这里的**第二次受控暴露**：
它同时在"生产侧 reinstall-all"和"我这条链自己再读一次"两处都挡住散文满足，而 `future` 那条
是配套的正向对照（不剥 `\r` 或整行比太严就会把它误杀成 `FACTS-INCOMPLETE`）。

⚠️ 一处**我自己夹具的探针坏**，按 §7 元规则"先怀疑探针"记下：第七腿本想喂"mtime 远晚于起跑"，
但 `leg()` 里 `INST_START` 的取法是 `[ "$stmode" = "empty" ] && printf '' || date +%s` ——
非 `empty` 一律现取 `date`，所以我传的那个未来 epoch 被静默丢弃，那条腿量的其实是"同刻"。
读数以表格里的 `FACTS-OK（同秒不误杀）` 为准，"未来 mtime"这一档**未被测到**。

换体仍走"副本编辑 → `bash -n` → 喂腿 → `mv`"，现役 66947（已跑 17 分钟）不受影响；
队列现在停在阶段 1 测试通道（累计 960s / 7200s，持有者 `29093 29434`）。

#### §15.43ai（10-04 08:2x）把 §15.43ah 那条教训反过来当探针用：数"被调用却不存在的东西"，照出设备独占门是一处**看不见的放行**

§15.43ah 收口后我把同一个动作推广到整条队列：枚举"脚本里出现的函数名"与"脚本自己定义的函数 + 那份 lib 提供的函数"，
取差集逐个读原文。现量 **28 个定义、差集 37 个候选**（写这一句时把探针重跑了一遍，第一趟数出的是 40 ——
差 3 个是因为我把 `elif`/`tee` 这类词纳不纳入白名单动过一次；**计数改动要连命令一起交，别只交数字**。
这 37 个里绝大多数是注释/路径/字符串里的词，**必须逐个读那一行**才能定档），真命中一处：

`dev_wait()`（阶段 5"设备独占到手"那道门）第 308 行是
`. "$MAIN/scripts/lib/mobile-e2e-runner-probe.sh"`，第 310 行紧接着 `busy=$(mobile_e2e_runner_lines | awk …)`。
**source 失败没人接**：函数没定义 ⇒ 命令替换里 `command not found` 走 stderr ⇒ 而队列是
`nohup … >/dev/null 2>&1` 起的，stderr 哪儿都不去 ⇒ `busy` 空 ⇒ 日志写下
`阶段5 设备独占：到手（等 0s）` 并 `return 0`。
⇒ 一处**读起来完全像放行**的放行：这道门挡的是 `adb uninstall` / `pm clear` / `simctl uninstall` 会不会清掉别人的现场，
误"到手"的代价落在别人身上，而我这条链只会留下一行绿灯。

变异臂（同一份 `dev_wait` 体、`MAIN` 指向没有那份 lib 的临时树）：

| 臂 | 现量 |
|---|---|
| 改造前 | `bash: line 10: mobile_e2e_runner_lines: command not found` → `SAY …：到手（等 0s）` → `RC=0` |
| 改造后 | `SAY …：探针函数没拿到（…没能 source 上）⇒ 判**不到手**，不许空跑成到手` → `RC=1`（调用点转成 `env_retry`，退 64 有界重起） |

正向腿也跑了：`MAIN` 指向真仓、此刻没有移动端验收在跑 ⇒ `到手（等 0s） RC=0` —— 改判据不能只证会红，
还要证它该放的时候照样放（§7 元规则 2）。

**同一轮把三处 source 全数了一遍**，另两处本来就接得住，差别很有用：

| 位置 | 形状 | source 失败时 |
|---|---|---|
| `win_gate` | `bash scripts/verify-mobile-window-gate.sh`（子进程 + 显式读 `rc`） | `rc=127` ≠ 0 ⇒ 继续等 ⇒ 等满 `return 1` ⇒ **本来就 fail-closed** |
| `wait_load` | `if ! ( cd "$CARRIER" && . ./scripts/lib/wait-for-quiet-host.sh && wait_for_quiet_host )` | `&&` 短路 ⇒ 子 shell 非 0 ⇒ `if !` 走"等满"那支 ⇒ **fail-closed**（且相对路径前有 `cd`，不是悬空 CWD） |
| `dev_wait` | `. lib` 后在**命令替换**里调用 | 无人消费退出码 ⇒ **fail-open**（本轮修） |

⇒ 可迁移的形状规律：**`source` 之后要用的东西如果出现在 `$(…)` 里，失败就不可能被发现**；
要么像另两处那样把它放进带退出码的位置，要么在 source 之后立刻 `declare -F <函数> >/dev/null || 判不到`。
现量 `grep -c 'declare -F'` = 1（这条队列第一次有这种断言）。
探针自身的账也记一句：那 37 个差集候选里没有一个是我脚本的函数名拼错，三个是**lib 提供的真函数**
（`msix_check_facts` / `mobile_e2e_runner_lines` / `wait_for_quiet_host`）—— 也就是说这套办法的产出是
"37 个待读 + 1 个真洞"，**别把"命中一处"读成"脚本刚好只有这一个洞"，也别把"绝大多数是噪声"读成"办法没用"**；
它能命中是因为形状对得上（`source` 之后在命令替换里调用），不是因为运气。

#### §15.43aj（10-04 08:2x）② 的逐段归属日志**上一趟就少了一条名字**，少的正是 `-r test`：`head -14` 撞在恰好 14 的假象上

顺着"② 的读数要能逐段归因"去查队列怎么记链的读数，那一行是
`awk … '$3 ~ /^rc=/ && $3 != "rc=0" {print "非绿: " $0}' | head -14 | tee -a "$LOG"`。
05:25 那趟（载体 `1ebcf136`，`chain-ai-closeout-0525/segments-rc.txt`）现量：

```
SUMMARY  pass=59  fail=14  skip=1  total=74        ← 我一直在引用的这组数字来自这里，是对的
真实非绿行（含 SKIPPED_BY_RULE 那条不跑的）        = 15
head -14 实际打进日志的                            = 14
diff 出来被丢掉的那一条                            = 74  -r test  rc=1  42s
```

⇒ **14 这个数字是巧合，不是上界**：`fail=14`（真红）+ `skip=1`（按规则不跑）= 15 条"非绿"，
而列表帽写死 14 ⇒ 第 15 条从日志里静默消失，丢的恰好是**全量单元测试那一段** ——
对 ② 最吃重的一条红。日志里其余 14 条按序号排到 `66 check:shell-unicode`，
`74` 那条排在它后面，所以谁看日志都会以为"非绿就到 66 为止"。

改法一行都不涉及判据松紧：**先把分母数出来，再让截断自己说话**。

```bash
NG_N=$(printf '%s\n' "$NON_GREEN" | grep -c '非绿:')
say "逐段非绿共 ${NG_N} 条（含 rc=SKIPPED_BY_RULE=按规则不跑，不是红）；下面只列前 14 条，全量在 ${CHAIN_DIR}/segments-rc.txt"
```

三腿夹具（真产物一份 + 造两份）与逐条自己数的真实分母对照：

| 腿 | 真实非绿 | 新写法报的分母 | 日志列出的行数 |
|---|---|---|---|
| 全绿样本（1 条 rc=0 + SUMMARY） | 0 | `逐段非绿共 0 条` | 0 |
| **真产物 0525** | **15** | `逐段非绿共 15 条` | 14（并写明只列前 14） |
| 造的 20 条 + SUMMARY | 20 | `逐段非绿共 20 条` | 14 |

📌 两条一般规律：① **凡是 `| head -N`，N 要么从被截集合现取，要么就打印"共 M 条、只列前 N"** ——
否则截断在数学上等价于"这条判据没跑完"，而输出长得和跑完一样；
② 引用 SUMMARY 的计数时不要顺手把它当成"我列出的那些名字就是全部"，两个数是两条来源。

⚠️ 也记一笔我这趟差点误报的探针坏：我**重打**了一遍那条 awk 去复现，zsh 把 `!=` 里的 `!` 转义成 `\!`
⇒ `awk: syntax error` ⇒ 读数成"0 条非绿"，看起来像"这条日志一直是空的"。
改成**从脚本里 `sed -n '404p'` 原样取那一行再 eval** 才拿到真读数（15/14）。
规则还是那条：复现脚本里的判断要抄它的字节，不要凭记忆重敲。

被丢掉的那条不是别家的事，它正好是 ② 唯一那条"全量 test"红，所以顺藤追到了归属，记在
**[`BLOCKED.md` B71](../../BLOCKED.md)**：HEAD 的 `server/tests/holiday-adjustment-migration.pglite.spec.ts:35`
硬编码 `20261009000000_add_holiday_adjustments`，而 `git ls-tree HEAD` 里只有 `20261013000000…`（13 号来自
`57ff8c55 merge: W4b 服务端半`），HEAD 里还有 3 处指着 09 号（那份 spec + `docs/adr/0052` + `docs/plans/countdown-batch2-handoff`）。
⇒ **② 的读数里那条 `pnpm -r test` 红属 W4b 线，不属本线**；本线不代拍改哪个号、也不吸收别人的债凑绿，
只把归属与可复跑命令交出去（细节只在 B71 一处，这里不留副本，免得又长出第二套号）。

#### §15.43ak（10-04 08:3x）`DONE` 以前只问"装的是不是当前源码"，不问"本线的门绿不绿" —— 而链的 rc **不编码段的红**

现量的原因不是猜的：05:25 那趟 `链 rc=0` 与 `SUMMARY pass=59 fail=14` **同在一趟里并存**
（`heyta-chain.sh` 只在 build/前置失败时非 0，段红只进 `segments-rc.txt`）。
⇒ 队列原来的收尾 `LANDING-CURRENT ⇒ echo DONE` 在本线的门全红的情况下也会照样写 DONE，
而 rc.txt 里没有任何一行能把这件事区分出来。

补上的判定（`decide_final`，与 `decide_landing`/`decide_win_facts` 同一套做法：纯函数 + 离线喂腿）：

```
DONE 需要两件事同时成立：装的是当前源码（LANDING-CURRENT） + Goal 点名的两条门（check:ai-coverage / check:ai-tools）没有红
"本线有哪些门"从载体现推：git ls-files scripts/check-(ai|legal|journey)*.mjs ∩ package.json 里引用它的脚本名
量不到就判 UNKNOWN（FINAL-OWNRED-UNKNOWN ⇒ exit 7，绝不写 DONE）
```

| 腿 | 输入 | 现量 |
|---|---|---|
| 真产物 0525 的 15 条非绿 × 载体现推的门 | own_gates=10 | **own_red=5**：`check:legal-permissions check:journey-coverage check:ai-e2e check:privacy-consent-e2e check:landing-e2e`；strict=0 ⇒ `DONE-CURRENT-AND-OWN-GREEN` |
| 只把 `check:ai-coverage` 造红 | 同上 | own_red=1 / strict=1 ⇒ `DONE-BUT-OWN-RED`（rc.txt 写 `NOT-DONE …` + `exit 7`） |
| `check:ai-tools` 红 + 一条别人的门红 | 同上 | own_red=2 / strict=1 ⇒ `DONE-BUT-OWN-RED`（拦的是自己那条，别人的只记录） |
| 全绿 | 同上 | own_red=0 / strict=0 ⇒ `DONE-CURRENT-AND-OWN-GREEN` |
| 边界 | `(CURRENT,'',10)` `(CURRENT,0,'')` `(CURRENT,0,0)` `(CURRENT,x,10)` | 全部 `FINAL-OWNRED-UNKNOWN` |
| 落地本身过期 | `(LANDING-STALE,1,10)` | 原样透传 `LANDING-STALE`（有界重起那台机器不受影响） |

🔴 **为什么只拦 Goal 点名的两条而不是全部 own_gates**：第一版我写成"本线的门有红就 exit 7"，
拿真产物一量立刻发现那是 §15.43ab/af 同一个错的**反向版本** —— 05:25 那趟 own_gates 里有 5 条红，
全部红因是别人的源码与环境，照它拦就等于把别人的债变成一道**永不放行**的门。
红线那句"不吸收别人的债凑绿"的另一半在这里同样成立：**不许拿别人的债当永不放行**。
⇒ 口径改成：`own_red` 全量记进 rc.txt（DONE 行也带条数，谁都不会把 DONE 读成"own 全绿"），
只有"覆盖面到底有没有成为门禁"这一件本 Goal 自己的交付物（coverage / tools 两条门）红时才 exit 7。

两处顺带的账：
- 现推依赖 `~/scratch-heyta/heyta-own-gates.mjs`（放家目录持久 scratch，不放 `/tmp` —— 那条规则已入档）。
  它丢了会怎样也测了：`node` 失败 ⇒ `OG_N=0` ⇒ `FINAL-OWNRED-UNKNOWN` ⇒ 不写 DONE（缺依赖只会变严，不会变松）。
- 差点误登记一条：`scripts/check-legal-{closure-truth,gdpr}.mjs` 在推导里显示成"没有 pnpm 脚本消费者的门"，
  看着像孤儿门禁。现量是 **`??` 未跟踪**（`git ls-files --error-unmatch` 报 did not match、`git cat-file -e HEAD:` 说不存在），
  属回收站那条线在飞的东西 ⇒ 不是 main 的缺陷。也正因此，推导只认 `git ls-files`（干净检出里跑的载体自然没有它们）。

#### §15.43al（10-04 08:5x）证据目录名只到分钟 ⇒ 两趟共用一本账；我按同前缀 glob 删"废弃目录"时删掉的是**活着那趟**的证据

先记 08:41 那次重启本身（理由与两条真闸腿），再记它顺带暴露的事故 —— 事故的严重性高于重启。

**重启的理由**：07:59 那趟是在 §15.43a(e/f/i/j/k) 那批修法**之前**起的，bash 持旧 inode，
真跑到阶段 5 会用旧的 `PAX_WIN` 覆盖块和旧的单条件 `DONE`。停它之前先取证归属：
`4574  1  Sun Oct 4 08:41:16 2026  bash heyta-deliver-on-window.sh`，cwd=`~/scratch-heyta`，
日志目录是我的 —— 只可能杀我自己这一枚。重启后两闸腿都在真实现场走过（不是夹具）：

| 腿 | 现量 |
|---|---|
| pid 已死 ⇒ 让路（防 PID 复用把交付永久卡死） | `rc.txt: TAKEOVER old=66947 mine=4574` |
| 真第二趟 ⇒ 响亮拒绝 | `第二趟 rc=6（期望 6）`，拒绝行打印 pid 与起跑时刻 |

**事故链（三步，每步都有读数）**：

1. `OUT="$HOME/scratch-heyta/deliver-$(date +%H%M)"` **只到分钟** ⇒ 08:41 起跑的两趟拿到同一个目录名。
2. 单实例闸在 `: > "$RC"` **之后**（表头顺序：`OUT`(21) → `mkdir`(22) → `: > "$RC"`(25) → 闸(47)），
   所以被拒的第二趟先把活那趟的 rc **截空**再退出。
3. 我随后清理"第二趟留下的废弃目录"，用的是同前缀 glob（`deliver-08*`）⇒ 删掉的正是活那趟（4574）的证据目录。
   于是 4574 成了一条**每条 `say` 都写进不存在的路径**的瞎队列：83 处 `say` + 9 处 `bail` 全失败，
   `set -uo pipefail` 没有 `-e`，它继续跑了 4 分钟，直到我这次查 `ls -dt` 才发现目录不在。

**否证一条我自己写的诊断**（臂6 实测）：我原话说"白屏在自动化里最阴的地方是它什么都不报"，把它套到了这里，
好像 bash 对不存在的重定向默不作声。**错**：
6a 前台形态 = `rc=0` 而 stderr 明明白白有 `No such file or directory`；
6b 真实起跑形态（`nohup … </dev/null >/dev/null 2>&1`）= `rc=0`、零输出、目录不存在。
**静默的成因是起跑形态吞 stderr，不是不报错** —— 差别有实际后果：光看退出码会把瞎跑判成成功（6a/6b 都是 0）。

**四处修法**（都在 `~/scratch-heyta/heyta-deliver-on-window.sh`，仓库外）：

| # | 修法 | 抓住的那一步 |
|---|---|---|
| 1 | 名字带秒与 pid：`deliver-$(date +%H%M%S)-$$`（可 `HEYTA_DELIVER_OUT` 覆盖） | 撞名在结构上不可能 |
| 2 | `[ -e "$OUT" ]` ⇒ 打 stderr 并 **退 8**，不静默共用别人的目录 | 万一撞名也不共账 |
| 3 | `say` 前挂 `out_alive`：目录没了就地重建 + 把断点写成账的一行（`EVIDENCE-LOST`）；**丢第二次直接退 8** | 静默瞎跑 |
| 4 | 响亮死亡同时落 **OUT 之外**两条通道：`/tmp/heyta-deliver-ORPHAN.log` 为主、scratch 为副（副通道先 `mkdir -p`） | 吞 stderr 时死亡仍留得住 |

**夹具读数**（`~/scratch-heyta/test-hdr-guard.sh`，只取表头到"写 pidfile"那行，切点按字面 `grep -n '> "$PIDFILE"$'` 现取，
不写死行号 —— 上一版写 `1,86`，表头一加行就会从中间切断）：**8 臂全绿 `pass=8 fail=0`**，
臂1 现量 `deliver-085143-31171`，臂3 是阴性对照（没丢目录 ⇒ 账里**不许**出现 `EVIDENCE-LOST`），
臂5/6c 用**本臂独有的 `out=` 键**断言而不是光查 `ORPHAN-DIE` —— 臂5 已往同一份文件写过，只查 needle 会在 6c 自己没写时判绿。

**三条变异臂，各打中该打的腿**：

| 变异 | 期望 | 现量 |
|---|---|---|
| M1 摘掉 `say` 里的 `out_alive` | 4/5/6c 红 | `SUMMARY pass=5 fail=3`，红的正是这三条 |
| M2 把撞名检查的条件改成恒假 | 2 红 | `pass=7 fail=1`，臂2 `rc=0（期望 8）` |
| M3 删掉两条 `ORPHAN-DIE` append | 5/6c 红 | `pass=6 fail=2`，`rc` 仍是 8 但死亡记录 0 命中 |

M3 那条形状值得单独记：**摘掉记录后退出码照样对**，只有"死亡是否留痕"转红 ——
如果验收只看退出码，这条腿就没有牙。

**顺带一条现场登记（不是我的缺陷，也不代别人改）**：08:5x 现量别的泳道正在跑四端重装
（`sh /tmp/queue-reinstall-all.sh` ×2 / `bash /tmp/heyta-reinstall/scripts/.reinstall-all.sh.snap.93817` /
`bash apps/desktop-macos/scripts/package-app.sh /tmp/heyta-macos-dist`）。
权威窗口闸 `scripts/verify-mobile-window-gate.sh` 的单所有者探针是 `pgrep -f 'scripts/[.]?reinstall-all[.]sh'`，
**认得出那枚 `.snap.`**（`[.]?` 正是为它加的），我的队列阶段 5 委托给它 ⇒ 不会双重装。
但 `/tmp/queue-reinstall-all.sh` 这一形**不匹配**该正则（没有 `scripts/` 前缀）——
它只在真的派生出 reinstall-all 时才被抓到，纯"排队等窗口"的那一段在探针眼里不存在。
登记为闸的边界；改它属于那条线，不在本批动。

**新实例读数**：pid **33337**（08:52:26），`OUT=deliver-085226-33337`，`rc.txt: TAKEOVER old=4574 mine=33337`，
`载体 HEAD=1ebcf136 未提交项=0 main=3771edb2`，`集成线是否已在 main：YES`，此刻在阶段 1 等现场。
③ 仍未完成（前置仍是那三条人为条件），本条不宣布任何交付结论。

#### §15.43am（10-04 08:5x）第三个洞：`DONE` 只**打印**四端取证，不**要求**它们合格

修完 §15.43al 那三处后，我按"还有没有别的静默放过"这条路系统扫了一遍收尾块，扫出来的是本条 ——
它比前两处（`dev_wait` 的假到手、`PAX_WIN` 的 `LIB-MISSING`）更靠中心，因为
**"rc.txt 里有没有 DONE 行"就是本脚本给 ③ 定的唯一成功标志**（§15.43ae 是我自己写下的这句）。

旧代码那行长这样：

```
echo "DONE chain=… ai_e2e=$(grep -c 'AI_E2E rc=0' "$RC") … win=$PAX_WIN mac=$PAX_MAC ios=$PAX_IOS and=$PAX_AND"
```

四个变量**进了字符串，没进判据** ⇒ `DONE … win=NO-EVIDENCE mac=NO-PAYLOAD ios=NOT-READABLE and=NOT-INSTALLED`
是能写出来的。而 AGENTS §6.1.1 对四端重装的话是"**任一端失败 ⇒ 整体退出 1，没有静默跳过**"。
`ai_e2e=` 那一格同病：它是个计数，`0`（没跑或红）和 `NOT-RUN` 都照样 DONE。

**标签集合是现量枚举的，不是凭记忆**（`grep -oE 'PAX_[A-Z]+=[A-Za-z0-9_-]+' | sort -u`）：

| 变量 | 好 | 坏 |
|---|---|---|
| `PAX_WIN` | `FACTS-OK` | `FACTS-INCOMPLETE` `LIB-MISSING` `NO-BASELINE` `NO-EVIDENCE` `STALE-EVIDENCE` |
| `PAX_MAC` | `MATCH`、`CONTENT-OK-BYTES-DIFF` | `MISMATCH` `NO-PAYLOAD` |
| `PAX_IOS` | `MATCH` | `MISMATCH` `NOT-READABLE` |
| `PAX_AND` | `MATCH` | `NOT-INSTALLED` `SIZE-DIFF` |

`CONTENT-OK-BYTES-DIFF` 算好是有理由的，不是松：mac 那条判据本身是"安装副本启动自截屏**非空白且主蓝命中**"（§7 #82），
签名让字节必然不同；把它判坏会把"确实装上了"读成"没装上"。**未列出的标签一律落坏那支**（`FACTS-OKy` 这种手滑不会蒙过去），
空值按"未赋值"判坏 —— 和 `decide_final` 一样先怀疑没量到。

**夹具**（`~/scratch-heyta/test-decide-pax.sh`，函数从真脚本按行号区间抽出来，**不在夹具里重抄一份** —— 重抄的那份不是被测对象）：
`pass=9 fail=0`。腿1 全好；腿2 专测 `CONTENT-OK-BYTES-DIFF` 仍算好（防止我把判据收得过窄，这是一条**反向腿**）；
腿3 逐个坏标签必须**点出属于哪一端**（11 个标签）；腿4 空标签；腿5 三档 ai_e2e（`1`/`0`/空）；
腿6 陌生标签；腿7 五端同时坏 ⇒ 五个键都得列出（分母）。

**三条变异臂**：

| 变异 | 现量 |
|---|---|
| M1 摘掉 `ai_e2e=0` 那一支 | `pass=7 fail=2`：腿5a 得 `PAX-OK`、腿7 分母从 5 掉到 4 |
| M2 把 `PAX_MAC` 的好集放宽成 `*` | `pass=8 fail=3`：两条 mac 腿不再被点出、腿7 分母 4 |
| M3 把 `DONE` 行挪到 PAX 闸**之前** | `pass=8 fail=1`：结构腿红（`闸=766 DONE=765`） |

M3 那条值得单独入档：**"判定顺序"这类断言函数级夹具测不到**（`decide_pax` 本身一字未改照样正确）。
所以我给它加了一条按行号比较的结构腿（两个 `grep -n` 取行号，比较大小），它一被挪就红。
形状可迁移：**判据的对象是"谁先谁后"时，就断言那个先后，别只断言各自存在。**

**队列第三次重启**（同一台机器上换 inode，理由与 §15.43al 相同：真跑到收尾的必须是带 PAX 闸的那份）：
33337 → **72523**（08:58:47，`TAKEOVER old=33337 mine=72523`，`载体 HEAD=41cf6217 未提交项=0 main=41cf6217`，
`集成线是否已在 main：YES`）。启动那一瞬 `pgrep -fl` 报出两枚 pid（72523/72582），查 `ps -o pid,ppid,etime` 后确认
72582 是父壳 fork 的瞬时子壳、已消失，pidfile 单值 = 72523 ⇒ **不是双跑**（单实例闸这次没被触发，也就没被绕过）。
08:5x 现场仍是 `闸门 rc=3 · 负载 16 > 12`，别的泳道那四枚重装进程还在。③ 未完成，本条不宣布交付结论。

#### §15.43an（10-04 09:2x）链的读数我用 glob 猜目录、孤儿链探针里藏了一处**恒不相等**的比较 —— 两条都被同一把夹具照出来

§15.43am 把四端取证接进 `DONE` 之后，我把同一个问题（"还有没有只打印不判定的地方"）推到**链**那一侧，
扫出来三个洞，都在 `heyta-deliver-on-window.sh`：

| 洞 | 症状（修之前） | 修法 |
|---|---|---|
| 归属靠猜 | `CHAIN_DIR=$(ls -td …/chain-ai-closeout-* \| head -1)` —— 目录不存在时**空串传给 `grep`**，`NON_GREEN` 为空 ⇒ 判成"全绿"；两趟链并存时读的是**别人那趟** | 路径只从**生产方自己打印**的那一行取：`sed -n 's/.*读数文件：//p'`；取不到 ⇒ `CHAIN-NO-ARTIFACT-PATH`（无静默回退） |
| 一个来源自证 | 载体 sha 与段数都从同一行取 ⇒ 那行若被改动，判据跟着一起改 | **两个来源互相对账**：计数取 kv 行 `SUMMARY\tpass=…`，载体与段数取散文行 `=== 汇总（载体 <sha>）… 共 N 段 ===`；`kv.total != prose.共N段` ⇒ `CHAIN-TOTAL-DRIFT` |
| `CHAINV` 没人问 | 链的判决算出来了，`DONE` 只看 `PAX` ⇒ 与 §15.43am 同一个形状 | `DONE` 的条件改成 `PAX-OK && CHAIN-OK`，否则 `NOT-DONE …` 并**退出 7** |

**孤儿链探针里那处恒假比较是夹具撞出来的，不是我想到的**。上一轮我 kill 掉母体后活下来的那趟链
（08:55 起、08:58 还在跑）被旧探针报成"没有另一趟交付链在跑"，于是加了 `orphan_chain_pid()`：
归属只认 `lsof -a -d cwd`（不带 `-a` 是所有 fd 的**并集**，那是假读数），读不到 cwd 按**占位**处理。
第一版写成 `[ "$c" = "$CARRIER" ]` —— macOS 的 `lsof -Fn` 打的是 **realpath**
（`/tmp/…` 打成 `/private/tmp/…`），这个比较**永远不成立** ⇒ 这道闸一次都响不了。
夹具的腿 10 第一次跑就红在这里（两枚桩都在、却都报 `none`）。改成
`cc=$(cd "$CARRIER" && pwd -P)` 后同一条腿变绿。**真载体在 `/Users` 下不触发这条**，
所以它是那种"跑很多次都不会暴露"的静默失效 —— 只有把载体换成含软链的路径才现形，
而我为了排除母体干扰恰好把测试载体做成了 `/tmp` 下的一次性目录（`carrA`/`carrB`）。

**夹具 16 腿 `pass=16 fail=0`**（`scratch-heyta/test-chain-attr.sh`）。阳性对照喂**真产物**：
`deliver-085226-33337/chain.out` + `chain-ai-closeout-0855/segments-rc.txt` ⇒
`CHAIN-OK total=74 pass=64 fail=9 skip=1 env=0`。腿 0 先断言两个来源**确实是不同的行**
（kv 行里不许出现"载体"字样）—— 这条是我上一轮把两个来源抄成同一行、
拿到 `CHAIN-CARRIER-MISMATCH` 之后补的：**"两个来源"必须能被证明是两个，否则交叉对账只是装饰**。

四条变异臂（台架 `run-chain-mutations.sh`，读数 `mut-chain-readings.txt`）：

| 臂 | 摘掉什么 | 读数 |
|---|---|---|
| 对照 | 未变异 | `rc=0`、`pass=16 fail=0` |
| M2 | 两来源的 total 交叉对账 | `pass=14 fail=2`：腿 6、腿 9 红（kv 被改成 164 仍报 `CHAIN-OK total=164`） |
| M3 | 逐键判数字，回退成 `"$p$f$s$t$k"` 拼接判 | `pass=15 fail=1`：腿 7 红（**摘掉 `skip=` 这个键却仍算自洽** —— 拼接判挡不住漏键） |
| M4 | 载体路径的 `pwd -P` 归一 | `pass=15 fail=1`：腿 10 红（A/B 都 `[none]`） |
| M5 | `orphan_chain_pid` 的命中分支 | 第一趟 **ABORT**（臂作废），第二趟 `pass=15 fail=1`：腿 10 红 |

🔴 **台架自己坏了两次，两次都是"看起来像判据没牙"**：
1. 第一版 `run()` 用 `[ "$#" = "3" ]` 决定要不要设 `MUT_SRC`，而所有调用点只传 2 个参数
   ⇒ 变异文件从没被跑过，M2 打出的 `16/0` 其实是**未变异那份**的读数。我差点写成"这条腿没有牙齿"。
2. M5 用 `sed` 把整行换成 `… then : # HIT-OFF`，`fi` 被注释吃掉 ⇒ `for` 没闭合。
   这次是台架里那条 `bash -n` 自证把它拦下来的，输出明写 `作废的臂=1`。
⇒ **变异臂必须自证四件事**：变异确实落在**将被跑的那份文件**里（`grep -qF marker`）、
活文件里**没有**这个标记（防台架污染）、文件语法合法、跑完把 `FAIL` 行原样贴出来；
并且**作废臂数与转红臂数一起打**。"臂没跑起来"和"判据没牙"是两个结论，混起来就会去改判据。

**现场读数（09:2x，载体 `4e24ce15`）**：队列 pid **72523** 存活 27 分；
`CHAIN rc=0 carrier=d544d73c`、`STRICT_RED n=0`、`OWN_GATES n=10`、
`OWN_RED n=2 names=check:legal-permissions check:ai-e2e`；阶段 4 `check:ai-e2e` 自 09:16:41 起在跑，
负载从 `16` 降到 `{ 9.12 11.40 16.57 }`。
新代码已在磁盘上（859 行 / md5 `ac6f8ea5…`），但**在跑的实例仍持旧 inode** ⇒ 这三条闸从
**下一趟实例**起生效。这是刻意的：中途 kill 会浪费真跑完的链，并且正好造出我这轮刚防住的孤儿链形状。

③ 仍未完成，前置是外部的两条现量：**别人未提交的打包输入 = 109**（上一轮记 108，逐轮在动），
以及 W4b 那条 09↔13 迁移号未拍板 ⇒ `pnpm -r test` 仍红（B71）。
④ 的三个台账文件（`PROGRESS.md` / `AGENTS.md` / `docs/reference/environment-traps.md`）**现量都还是 ` M`**，
所以本轮四条规则继续走 B72 登记而不插行；traps 取号按工作树现量：条目 236、最大号 **227** ⇒ 下一号 228。
① 的三枝 + 集成线 + `1ebcf136` 对当前 `HEAD` 逐条 `merge-base --is-ancestor` = **全部 YES**（本轮重取，不引用上一轮）。


#### §15.43ao（10-04 09:4x）③ 的死锁查清了，而且它不在别人身上：闸门 #2 把我**本轮 e2e 自己重写的取证图**当成未提交源码

阶段 5 等窗口时我读了一次 `gate-b.txt`，`❌ 52 枚未提交的源码改动` 那节逐条现量的结果是：
**52 枚全是 `apps/web/evidence/**/*.png`，非取证/文档的源码 0 枚**（`git -C 载体 status --porcelain -- packages apps server
| grep -v 'apps/[a-z0-9-]*/evidence/'` 输出 `No matches found`）。这些图是**已跟踪**的，而链里的 e2e 段与
`check:ai-e2e` 每跑一遍就把它们重写一遍 ⇒ **跑过链的载体必然脏、阶段 5 的窗口必然不开**，
而队列唯一的自救是 `env_retry`（`MAX_ROUNDS=5` 用尽后按环境无效退 3）。
这条不是"别人的现场挡我"，是我自己造的条件被自己的门判死 —— 归属与修法都写进 `BLOCKED.md` **B73**。

修法只走窄的那条（闸门那侧一个字没改，它是三条线共用的权威探针）：
新增 `carrier_evidence_settle()`（队列第 661–688 行，调用在第 693 行 = 阶段 5 那次 `win_gate` 之前）。
它与闸门**同一条口径**取集合（`status --porcelain -- packages apps server | grep -E '^ ?M'`），
只有当脏项**全部**落在 `apps/*/docs|evidence/` 才动手：先归档进 `$OUT/carrier-evidence/`（本轮证据不丢），
再 `git checkout --` 回提交态，然后**现量复核为 0** 才留 `EVIDENCE-SETTLE … after=0`；
混进任何一枚源码就**一枚都不动**、逐条点名、让闸门照原样挡。

夹具 `test-evidence-settle.sh` **6 腿 `pass=6 fail=0`**（真 `git init`、真脏项、真归位）。
承重的那条是腿 2（"该挡的时候挡"）：混进一枚 `packages/x/src/index.ts` ⇒
`rc=1`、两枚脏项**原样都还在**、日志点名到那一枚、归档目录**根本没建**。
变异臂 `NEVER-REFUSE`（把拒绝分支的条件写成假）⇒ **腿 2 精确转红**
（`rc=0 仍脏=0(期望 2) 点名=0 归档目录存在=yes`）：这条臂证明的不是"能红"，是**不越权**这件事有牙。
同批回归：`test-chain-attr.sh 16/0`、`test-decide-pax.sh 9/0`、`test-hdr-guard.sh 8/0`、`test-retro.sh 5/0`
（对**换上后的活文件**跑，md5 `f79f7818…`，900 行）。

另有一处**读数纸**必须先证明它接上了判定函数：新写的 `eval-gates-retro.sh` 把当前脚本里的
`decide_pax`/`decide_chain` 按 grep 现取的行号区间抽出来，喂给**已经跑完的那趟**的证据目录 ——
因为 bash 持旧 inode，在跑的实例即使写出 `DONE`，那份 `DONE` 只代表它起跑时的判定集合。
它自己的 5 腿夹具（腿 5 断言打印出来的抽取起点 = 独立现取的 `grep -n` 第 181 行，不是我抄的数）全绿后，
对 72523 那趟的离线补量结果：

```
链：读数文件行=/Users/…/chain-ai-closeout-0909/segments-rc.txt 存在=yes
   kv=SUMMARY pass=64 fail=9 skip=1 total=74 env-blocked=0
   散文=091310 === 汇总（载体 d544d73c）：64 绿 / 9 红 / 0 段被内存门挡下 / 1 按规则不跑 / 共 74 段 ===
   ⇒ CHAIN-OK total=74 pass=64 fail=9 skip=1 env=0
   PAX：还没走到收尾块（DONE/NOT-DONE/PAX 三行都缺）⇒ 这一侧尚未量到，不是"没判定"
```

🔴 这里我第一次写出了一句**错因果**：看到没有 PAX 行就写"它是 §15.43am 之前起跑的 inode"。
现量否证 —— PAX 行本来就只在收尾块才写，而三行（含 `DONE`）全缺，唯一诚实的读数是"还没走到"。
所以判据改成三分支：**有 PAX 行**才判、**有 DONE 无 PAX** 才判那份 `DONE` 出自没有闸的 inode 因而无效、
**三行都缺**只报"尚未量到"。（与 §15.43am 那条"打印 ≠ 判定"是同一条纪律的另一半：
**缺行也不等于判过**，得先问这行是谁、在哪一步该写的。）

`AI_E2E rc=1` 的那 14 条红本轮**没有一条需要我改判据**：逐条枚举后 9 个 spec 文件各 1–4 条，
`ai-assistant:65` 的命中测试原文仍是 `detail-column … intercepts pointer events`，
与 `BLOCKED.md` **B69** 逐字同形（那条已把"裸 `1fr`"这个猜测用 A/B 否证过并摘掉改动），
缺陷所有者是详情面那条线、且它自己那批未提交界面代码就是让它转绿的那批。

③ 仍未完成。此刻（09:4x）队列 72523 在阶段 5 等窗口，负载门那侧现量 26 > 12；
新代码从**下一趟实例**起生效。④ 的三个台账文件仍 ` M`（别人在写），traps 取号按工作树现量 = 下一号 228。
#### §15.43ap（10-04 09:5x）B73 那处修法我自己踩了两个坑，第二个是本轮最贵的一条判据教训：**抽取式夹具看不见"函数定义在调用之后"**

上一节记的三处修法接上之后，我把 ③ 卡住的原因查到了（详见 `BLOCKED.md` **B73** 的现量与补记）：
阶段 5 的规范闸门把**本轮 e2e 自己重写的 52 枚已跟踪取证图**判成"别人未提交的源码"，
于是跑过链的载体永远等不到重装窗口。修法走窄的那条（闸门一字未改）：
`carrier_evidence_settle()` 与闸门同口径取集合，脏项**全部**落在 `apps/*/docs|evidence/` 才动手，
先归档进 `$OUT/carrier-evidence/` 再回提交态、并现量复核为 0；混进任何一枚源码就一枚都不动、逐条点名。

两个坑都是我的，且都靠"再量一次"才现形：

1. **一个门有多个调用点时，只补最显眼那处 = 没补。** 第一版只在阶段 5 前接了一次，
   而 `win_gate b` 在这个脚本里有两处（阶段 1 也要它）⇒ 新实例 46533 实测**卡在阶段 1**。
   夹具腿 5 因此从"比较头尾两个行号"改成**逐处遍历**：每一处 `win_gate` 行号之前必须有一处归位。
   变异臂：把阶段 1 那处删掉 ⇒ 腿 5 精确报 `第513行的闸门前没有归位（win_gate 2 处 / 归位 1 处）`。
2. 🔴 **函数定义插在第 664 行，而阶段 1 的调用在第 512 行。bash 自上而下执行，跑到那一行时函数不存在。**
   `command not found` 进 stderr，而整趟是 `nohup … >/dev/null 2>&1` 起的 ⇒ 日志里只剩我自己那句兜底措辞
   `（载体没归位 ⇒ 闸门还会 rc=3，这是对的，不兜底）` —— 与"它判过并且拒绝"**在文本上不可分辨**。
   更糟的是**抽取式夹具结构上看不见它**：夹具自己 `source` 那段函数体，顺序永远是对的，所以 7 腿全绿。
   ⇒ 新增腿 6：按行号断言**定义行早于每一处调用行**；它的阳性对照就是当时那份坏文件本身
   （`第512行调用早于定义(第664行)`）。可迁移的形状：**夹具能验证的只有它抽出来的那部分，
   凡判据的对象是"整份文件里的先后/存在性"，就必须有一条直接读原文行号的腿**
   （与 §15.43am 的 M3 结构腿同一族，但这一条抓的是**语言运行时**的坑，不是判定顺序）。
   顺带一条通用纪律：**`|| say` 这类兜底措辞不许写成"这是对的"** —— 它会把"探针根本没接上"
   伪装成"探针判过并拒绝"。兜底句要写成可区分的形状（这次改成明写"没归位"并带原因分支）。

**在体读数**（09:54，实例 81000，载体 `heyta-wt-ai-closeout`，OUT `deliver-095424-81000`）：

```
095431 取证脏项 52 枚的来历（按 mtime 与本趟起跑 1791078871 比）：上一趟留下的 52 枚 / 本趟写的 0 枚
095433 载体取证归位：52 枚…归档到 …/carrier-evidence/ 并回到提交态 ⇒ 同口径脏项现量 0
EVIDENCE-SETTLE n=52 prev_run=52 archived_to=…/carrier-evidence after=0
闸门输出里那一节 ❌ 52 枚未提交的源码改动 ⇒ 消失；只剩 负载 29 > 12 与 4 台模拟器 booted
```

`prev_run` 这一维是我加的第二处修法：归档时按 mtime 与**本趟起跑时刻**（取 `$LOG` 的 mtime，
它在表头就 `: >` 出来了）比，把"上一趟留下的"和"本趟写的"分开报 ——
否则那句"本轮自己写出的"就是没测过的断言。夹具腿 1/1b 用 `touch -t` 把 mtime 钉死，
分别断言 `prev_run=0` 与 `prev_run=1`（同秒粒度会让这条变成掷硬币，所以必须显式设时间戳）。

夹具现状：`test-evidence-settle.sh` **8 腿 8/0**（含 1b 与两条结构腿 5/6）、
`test-chain-attr.sh 16/0`、`test-decide-pax.sh 9/0`、`test-hdr-guard.sh 8/0`、`test-retro.sh 5/0`；
活文件 914 行 / md5 `8f363297…`。队列这一轮第三次换 inode（81000 起于 09:54:24），
每次都是 `pidfile 单值 + 独子只有 sleep` 取证后才 kill 旧的那趟，不留孤儿。

③ 的自造死锁闭合，**剩下的前置全是外部的**：负载（现量 29 > 12）、4 台模拟器 booted、
详情面那 13 枚未提交界面代码（B69 的关闭靠它）。④ 的 `PROGRESS.md` / `AGENTS.md` / `environment-traps.md`
仍 ` M`（别人在写）⇒ 本轮四条规则继续只走 B72/B73 登记；traps 取号现量：条目 236、最大号 227 ⇒ 下一号 228。
#### §15.43aq（10-04 09:5x）等窗口的回合换成零写盘的红线复量：五条隐私不变量在 `main = c1f7daca` 上逐条重取，其中一条的**措辞与口径**要对齐

队列 81000 卡在负载门（09:57 现量 `{ 27.61 31.90 32.38 }`，阈值 12）——这种回合不该起新负载，
所以把 Goal 红线段那句"五条隐私不变量不放宽"换成可重跑的读数（全部 `git grep`/`git show` 打在 **提交态**上，
不碰任何工作树）：

| 红线（用户原话） | 现量口径 | 读数 |
|---|---|---|
| AI 类型上产不出 op | `check:ai-tools` **规则 5**：扫描到的文件里任何非注释行出现 `from '@heyta/op-log'` 即 `violate()`（`:186-197`），理由原话"一旦能 import op 构造器，'本层在类型上产生不了 op'这条约束就失效了" | 规则在提交态里逐条存在；本线 12 道门此前在落地载体上 rc=0（§15.43n/o 的逐段读数），本轮没有重跑门禁本体（负载 27，不起新负载） |
| `host.submit` 全仓恰好一处 | 🔴 **真实口径是"每个写入口各恰好一处"，而入口有两个** | 非注释调用点现量 2 枚：`packages/app-host/src/ai-tool-run.ts:195`（`confirmAiToolProposal()` 内）与 `packages/local-api/src/server.ts:590`（`executeTool()` 的写分支）。门禁逐文件钉：`RUN_FILE` 那条 `occurrences !== 1` 直接红、且断言 `.submit(` 必须在 `CONFIRM_MARKER` **之后**；`MCP_ENTRY`（`check-ai-tools.mjs:417-421`）用 `async function executeTool(` 作标记同样钉住。另有 `SELECTION_FILE` 出现任何 `.submit(` 即红（选择阶段必须纯） |
| 逐工具默认关 | `isToolGranted` 本体 | `packages/local-api/src/tools.ts:450` 是 `export function isToolGranted(…)`、`:451` 是它的唯一一行实现 `return grants?.[toolName] === true;` —— **只有显式 `true` 才算授权**，缺键 / 不存在的工具一律 `false`（fail-closed，函数头注释明写"它不检查工具是否存在"是刻意的，MCP 侧靠它不泄露目录） |
| 出境逐字段披露 | ADR-0010 三道闸 + 披露表 | 由 `check:ai-coverage` / 会话侧披露断言守（本线 12 道门 rc=0 的那批） |
| 回退不跨越隐私边界 | `fallback-needs-consent` | 本机端点失败**不发任何请求**，该形状由 `packages/ai` 的既有测试钉住 |

🔴 **第二条这行值得单独入档**：红线原话"全仓恰好一处"如果照字面读，本轮的现量会像是**违规**（实际 2 处）。
真相是 §15.18 那次已经查清并补了门禁的形状 —— 内置 AI 与本机 API/MCP **共用同一份工具目录与执行器**
（ADR-0035），所以写入口本来就有两个，而"恰好一处"的正确断言强度是**逐入口一处 + 每个入口都被数**。
⇒ **红线句式里"全仓"这类范围词，落笔前要先问它按什么单位数**（文件／入口／调用点），
并按那个单位给出测量命令；否则下一次复量的人会因为读到 2 而误判"有人放宽了"。

① 逐条 `merge-base --is-ancestor` 此刻仍全 YES，但 `main` 已被并行线推到 `dcd37d36`（我这条读到的是 `c1f7daca`）
⇒ 引用红线读数必须带 sha，跨 sha 重跑是另一条读数的权利，不是同一条的延续。
#### §15.43ar（10-04 10:0x）两件"登记而不做"的事，理由都要写在账上（否则下一位会以为是漏了）

**(1) `check:legal-permissions` 与 `check:ai-e2e` 留在"本线命名门禁"里，是刻意的宽。**
`scratch-heyta/heyta-own-gates.mjs` 的 `OWNER` 正则匹配 `check-(ai|legal|journey)…`，
现量推出 10 条（`check:ai-coverage / ai-e2e / ai-quota / ai-tools / journey-coverage / landing-e2e /
legal-host / legal-permissions / legal-tools / privacy-consent-e2e`）。其中 B64、B69 两条红的**缺陷所有者不是本线**。
后果写清楚：**③ 在它们关闭之前会如实退出 7**（四端装上了、取证合格，但本线命名的门有红）。
本轮把这段推理写进那个脚本的文件头注释，并证明**零行为变化** —— 改注释前后
`node heyta-own-gates.mjs <载体>` 的名单输出**逐字节相同**（`cmp -s`，10 条）。
收窄那条正则技术上 5 秒就能做，但"窄掉的那一条以后红了也不会挡住 DONE"正是红线那句
"不降级判据、不为跑绿放宽门禁"要防的事 ⇒ **不做**，把代价写在账上（§15.43m 那条"闭合代价那栏也是断言"的同族）。

**(2) 这五把夹具 + 队列本体现在住在 `~/scratch-heyta/`，仓里没有 —— 这是已知的持久化缺口，本轮不搬，因为"搬"的正确顺序还没到。**
仓里已有的同类先例是 `research/tools/mutation-rigs/`（AGENTS §2 把 `research/` 定为"一次性脚本 / 归档性质"），
所以目的地是明确的。但现在**不能复制进去**：那样同一份脚本会有两个所有者，而本条线已经犯过两次"抄件一定漂"
（§15.43ah 抽了新的没删旧的、§15.43aq 的 sha 措辞）。正确顺序是：
① 等一趟实例**自然退出**（`pgrep -f 'heyta-deliver-on-window.sh'` 为空，且 `rc.txt` 末行是 `DONE`/`NOT-DONE`/`BAIL` 之一）；
② `mv` 而不是 `cp` 到 `research/tools/ai-closeout-rigs/`，原路径留**软链**（`env_retry` 用 `bash "$SELF"` 接力，路径不能断）；
③ 搬完立刻重跑那五把夹具（`8/16/9/8/5` 腿）并确认 `check:script-snapshot` 的覆盖集合不含这些新文件
（现量它是**显式白名单**：`scripts/reinstall-all.sh`、`scripts/verify-*.sh` 等逐条列出，不是目录扫描 ⇒ 不冲突）；
④ `pnpm check:docs` + `check:md-tables` 各跑一次。
在 ① 之前动它 = 造一次"跑着的实例持旧 inode、接力找不到新 inode"的现场，与本轮已吃过三次的坑同形。

**现场（10:05，供下一位对账）**：队列 81000 阶段 1 等窗口累计 540s / 上限 5400s；
`vm.loadavg = { 104.38 62.83 45.41 }`。挡路的重装**逐条取过 cmdline 与 lstart**（不靠探针计数下结论）：
`81007 sh /tmp/queue-reinstall-all.sh` 起于 **03:09:04**、`93771` 同形起于 03:12:10、
`93817 bash /tmp/heyta-reinstall/scripts/.reinstall-all.sh.snap.93817` 起于 03:12:11
⇒ 别的泳道这一趟已经占了 **6 小时 53 分**且还活着（与另一条线记的 `notarytool --wait` 同形）。
③ 的**输入侧**则已全部就绪：载体 `git status --porcelain`（任何状态、任何路径）= **0 条**，
打包输入与提交态逐字节一致，`IOS_DEVICE_NAME` 显式带默认值（`heyta-iphone-17pro`，不靠 `head -1`）。

🔴 **一个要说出口的期限风险（不是抱怨，是让下一位不必重新推）**：队列的等待预算是
`MAX_ROUNDS=5 × 5400s ≈ 7.5 小时`，而对端已占 6h53m 且**看不到结束点**。
预算用尽时它按红线那句"环境无效 ≠ 产品失败"**退出 3 并如实留痕**，不会硬装、也不会降级判据 ——
也就是说 ③ 有可能需要**外部再起一次**而不是自愈。重启命令就是 **B67** 记的那一条（第 3915 行），无需新参数：

```bash
nohup bash ~/scratch-heyta/heyta-deliver-on-window.sh </dev/null >/dev/null 2>&1 &
```

判"要不要再起"的可复现读法：`tail -2 <最新 OUT>/rc.txt`（有 `RE-ARM-ENV` 就是它自己接上了，不用管；
只有 `BAIL … rc=3` 才需要人起）。本轮**不**为了让窗口开而调低负载阈值、也不代别人停那三枚进程 ——
它们的 owner 不是我，取证只到 cmdline 与 lstart 为止。

### 15.43as 载体落后 40 笔 ⇒ 窗口由**旧闸门**判定：缺的是一段会拦我的判定，不是文案（10-04 10:2x，细节见 BLOCKED B74）

形状可迁移的一句：**"调用规范实现"要连实现所在的字节一起调用**。`cd "$CARRIER" && bash scripts/<规范闸门>.sh` 只保证了文件名相同；
载体落后 40 笔时那份副本里 `3b 设备面独占` 整段不存在，于是"窗口开了"这件事的含义变成"我用一个更弱的判据过了"——
而它弱的那一点恰好是**唯一会拦住我拆别人现场**的一点。同族的前两次是"分母必须与规范闸门同一条命令"（腿4）和"每一处调用点都要接上"（腿5），
这次是第三种面目：**同一条命令，不同一个字节**。

立起来的判据（夹具 11 腿，未打补丁的活文件上必红）：定义行早于每一处调用行、每处 `win_gate` 前都有对齐、
三处"脏项口径"与闸门字字一致、以及五条行为腿（已对齐 / 可纯 FF / 脏在 `packages/` 不快进 / 分叉退 1 / 副本被删退 1）。
现量正证：载体快进后**同一次**判断打出 `❌ 有另一趟 reinstall-all 在跑（pid：93817）` + `REDS=load,dev`。

### 15.43at sweep 的第二批：第一批只扫了字面族，漏的是**带「现量」字样**和**门禁输出转录**那两种形状（10-04 10:3x）

复扫的 needle 换成"把旧数字本身（`22` / `40 席` / `8/8`）当串再扫一遍"才抓到 4 处，它们不在第一批的字面族里：

| 形状 | 位置 | 为什么第一批的 pattern 抓不到 / 为什么它是现状主张 |
|---|---|---|
| 「现量：…」但**不带日期** | 本文 §…（分母 8、已覆盖 8、目录 22） | "现量"这个词只说明**当时量过**，不说明是哪一趟 —— 下一批实体一进分母它就假 |
| 交付清单里的裸数 | 本文 工具目录 22 个 / 覆盖面 8/8 | 清单天然被读成"当前交付物"，比叙述句更容易被照抄 |
| **门禁输出的转录**（贴在 ``` 里） | 本文那段 `ℹ️ 目录 22 个工具 ≤ …40 席` | 转录看起来"有据"，但没有"哪一趟"标签时**它就是现状**——转录本体一字不能改，改的是它外面那行说明 |
| headline 引用句 | `ai-strategy.md:242` | 一处改完就以为收口，正是第一批自己踩的 |

边界也现量过：`AGENTS.md` / `PROGRESS.md` 对这一族**零命中**（会话开头我以为的那条出自 `ai-strategy.md`），所以不需要动规则文件；
`docs/research/` 那两处**不动** —— 它们逐行带「⚠️ 2026-10-03 现量」的日期标签，符合"引用 N 项要带哪一趟"。

🔴 顺带两条自己的不准，写在账上而不是抹掉：
1. 第二批那笔提交的**标题**抄了第一批那句「同一结论句还落在 5 份文档里」——"5 份"只适用于第一批，
   第二批是 2 份文档 4 处。不改写提交（禁 `--amend`），在此写明。
2. 我一直用「`host.submit` 全仓恰好一处」复述那条不变量，而判据本体是
   **两个写入口各自恰好一处**（助手 `confirmAiToolProposal()` / MCP `executeTool()`）。
   `check:ai-tools` 现量 rc=0 并原样打印这句；我 grep 到 2 处不是不变量被放宽，是我的措辞会误导。
