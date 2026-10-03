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
