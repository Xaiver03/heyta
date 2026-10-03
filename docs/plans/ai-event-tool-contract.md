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
| `TAG` | 删除标签 | `project-actions.ts:71` | 还剩 2 席 ⇒ 没做。⚠️ 它比"删清单"更危险：删标签会同时改**所有挂着它的任务**，那是 §3.4「一个意图=一个 op」的边界，要先论证（与 W11 批量写入同一族） |
| `HABIT` | 改目标 / 换颜色 / 换图标 / 归档或删除 | `habit-actions.ts:79,91,102,118` | 还剩 3 席 ⇒ 改目标**没理由不做**（纯字段）。颜色/图标另有一条产品理由：**AI 替用户选一个身份标记**要先回答"谁给它赋义"（同一立场见"调色板由我们给、含义由用户赋"），**不是**没排上 |
| `HABIT_LOG` | 撤销打卡 | `habit-actions.ts:133` | 还剩 2 席 ⇒ 没做。它和 `record_checkin` 是**同一个 entityId 的反向操作**（`habitLogId(habitId, date)`），补的时候不需要新schema 概念，只需要一档"撤销" |
| `FOCUS_SESSION` | （无缺口） | `focus-actions.ts` 只有 `log` + `listSessions` | 界面上没有"改一次已记录的专注"这件事 ⇒ 这一格**满了**，不是没做 |
| `REMINDER` | 改时刻 / 延后 / 忽略 / 取消忽略 / 删除 | `reminder-actions.ts:87,93,98,100,102,104` | 还剩 2 席 ⇒ 前三条没做。**`markReminderFired` 刻意不做**：它的调用者是投递器（`apps/mobile/src/lib/reminders.ts:110`），用户不按它 ⇒ 按 §2.2 的准入判据它压根不属于 AI 面，而不是"排不到" |

📌 这一节的一般形式：**"覆盖面"是一个下限指标，把它跑满之后它会停止暴露信息。**
所以下一个人问的应该是"哪个动作没有"，而回答它需要一张**动作所有者**表，
不是再看一次覆盖率比值。上表每一行的"依据"列就是那张表的位置。

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
| 合并载体 | 临时分支 `tmp/ai-cov-on-main` = 合并提交 `3ad21570`（父：本批 `1b7fdb5e` + `main` `a04753b6`） |
| 落后量 | 合并前 `HEAD..main` = **76 笔** |
| 文件交集 | 本批改动 57 枚 / `main` 改动 127 枚 / 交集 **5 枚** |
| 真冲突 | **1 个文件 2 处**（`docs/plans/ai-assistant-closure.md` 的 D-3 两行）；其余 4 枚（ADR-0045、`docs/plans/README.md`、两份词条表）自动合并 |
| 词条表合并后 | `en.ts` / `zh-CN.ts` 各 **2847 键**、重复 **0**、两边键集差 **0 / 0** —— 这是"合并会不会把双语词条并坏"的判据，不是"看起来没红" |
| 链的段数 | 本批 **57 段** → 合并态 **61 段**（`main` 新增 `check:licenses:stamp` / `check:calendar` / `check:holiday` / `check:mobile-first-run-gate`）；本批的 `check:ai-coverage` 在第 **51** 段，**一段都没丢** |

### 11.1 逐段读数：61 段里实跑 55 段全绿，6 段是**按规则不跑**

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
⇒ 上面那 6 段未跑的红/绿在这个基线之下**没有未知风险**（它们在 `a04753b6` 上是绿的），
本批欠的只是"合并态复跑一遍"这条腿 —— 记成**未测**，不记成"继承基线所以通过"。
比较判据也随之下好：合并态的 `-r test` 应当 `web ≥ 1500`、`app-host ≥ 1303` 且零 failed；
低于这两个数就说明合并把某条线的用例弄丢了，而不是"少跑了几条"。

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
⇒ 谁合流都不必再补这一笔；如果只 cherry-pick 本批那 14 笔而不用这个合并态，
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
