# 工具层补全 批次 4 + 总体收口 —— 审计报告

> 审计对象：提交 `877efc31`（批次4：`set_task_important` / `set_task_pinned` / `move_tasks` / `undo_checkin`，17 文件 / +1088 −10）
> 契约：`docs/plans/2026-11-22-tool-layer-batch4-contract.md`
> 规则依据：`AGENTS.md`、`docs/agents/hard-constraints.md` §3.4/§3.5、`ADR-0083`、`ADR-0048` §2/I5
> 方式：只读（未改任何代码）+ 实跑门禁（读数见 §8）
> 标注：**事实**＝已读代码/已跑命令确认；**推断**＝由结构推出但未单测；**未核**＝未取证
> 总体口径：工具目录现 **65（读 13 / 写 52）**，覆盖实体 **9/11**

---

## 0. 结论摘要

- **P0 = 0 条（事实）。** 4 工具全部经 action 层 → `ctx.dispatch` 进 op-log；`submitIntent` 未见任何绕过 op-log 直接改状态的分支；无 purge。
- **批次 4 质量：通过。** 4 case 分别落到 `setImportant` / `setPinned` / `bulkMoveToProject` / `undoCheckIn`（事实，`local-api-host-batch4.spec.ts` 16 条覆盖接线 + 三种出口 + 整批预检）。`undo-checkin` 的宿主 `now()` 与 `logId` 用**同一个 `day` 变量**，无跨天错位（事实）。
- **I5 绿（事实）。** 新代码不读原始 `.projects` / `habits` 表：`move-tasks` 用 `projectActions.listAllProjects()`，`undo-checkin` 判活全交 `habitActions.undoCheckIn`；`local-api-host.spec.ts` 57 条全绿，I5 形状用例在 `:497`。
- **能力清单 = 65 / 14 实体（事实）**，4 工具归 TASK×3 / HABIT_LOG×1 正确；`node scripts/check-ai-tools.mjs` 通过。
- **测试真能转红（事实）。** `ai-tool-proposal-all-writes` 由 148→**160** 条（+4 case × 3 腿 = +12），三腿结构（提案不落库 / 确认 +1 / 未授权 denied）+ 覆盖面判据均在。
- **唯一实质瑕疵（P2，非本批引入）**：`unabandon_task` 被标 `destructive-reversible`（`task.ts:164`），与语义等价的 `restore_task`/`restore_tasks`/`uncomplete_task`（均 `write`）不一致 —— 恢复性动作被按破坏性对待，**无安全影响**，属语义/一致性。
- **总体收口判断：主体已完成。** 批次 1–4 已把「有 action、非实时交互、无需新模型」的写动作基本补齐；**剩余只有三档**：(a) 需产品定义/新模型（多人指派、子项结构化、评论/附件范围、四象限整格），(b) 实时交互不宜给 AI（专注计时开始停止），(c) 一小撮低频可选写工具（清单/习惯颜色图标目标、推迟到今天、跳过本次、完成后重复、批量打卡）。**高风险/高频的可做项已清零**；(c) 可作收官小批次，但不构成「能做的没做」的硬缺口。

---

## 1. 安全 / 裁决（重点 1）

### 1.1 四个工具无 purge（事实）
| 工具 | intent | 落点 | op 类型 | 可逆性 |
|---|---|---|---|---|
| `set_task_important` | `set-task-important` | `actions.setImportant` → `update({important})`（`actions.ts:878-880`；`update:510-519`） | `OpType.Update` | 字段翻转，可逆 |
| `set_task_pinned` | `set-task-pinned` | `actions.setPinned` → `update({pinnedAt: now()/null})`（`actions.ts:882-889`） | `OpType.Update` | 幂等置顶/取消，可逆 |
| `move_tasks` | `move-tasks` | `actions.bulkMoveToProject` → `ctx.dispatch(Batch)`（`actions.ts:1113-1126`） | `OpType.Batch` | 换归属，可再移回，可逆 |
| `undo_checkin` | `undo-checkin` | `habitActions.undoCheckIn` → `dispatch(Delete)` on `HABIT_LOG`（`habit-actions.ts:527-540`） | `OpType.Delete` | 软删（tombstone）；再打卡可复原 |

四者均**无** `purge` / 清空回收站路径（事实）。`purge` 系（`purgeTask/purgeProject/purgeHabit`）不进目录，`tools-risk.spec.ts` 断言 `destructive-irreversible` 为空。

### 1.2 `submitIntent` 无绕过 op-log（事实）
`grep -n "dispatch" packages/app-host/src/local-api-host.ts` → **0 命中**（该层不构造 op）。批次 4 的 4 个新 case（`local-api-host.ts:1786-1862`）只做两件事：`ctx.getState()` 只读校验 / `actions.*`·`habitActions.*`·`projectActions.*` 调用。写入口唯一，op 构造只在 `actions.ts`（`check-ai-tools` 规则 9：写入口恰好 2 处、各自一处、无 op 构造）。

### 1.3 try/catch 与批量预检（事实）
- **`undo-checkin`**：`try { ok = await habitActions.undoCheckIn(...) } catch { reason:'not-found' }`（`local-api-host.ts:1848-1858`），三种出口 `true→ok / false→not-found / throw→not-found` 均翻成语义化拒绝（`local-api-host-batch4.spec.ts` 三条用例逐一钉住）。
- **`move-tasks`**：**先整批预检、再一条都不写**（`local-api-host.ts:1808-1833`）：`taskIds` 去重为空 → `invalid`；给了 `projectId` 先验清单存在（`listAllProjects()` + `deletedAt` 判，`:1812-1821`）→ 不存在 `not-found`；`findTask` 全量缺失 → 整批 `not-found`、**不调** `bulkMoveToProject`（用例 `:238-256`）。
  - ⚠️ **P2（轻微）**：`move-tasks` 未对 `bulkMoveToProject` 加 `try/catch`。因预检已保证全部 id 存在，其内部 `throw('批量移动包含不存在的任务')` 不可达；但若将来动作层新增抛错路径，会以未捕获异常冒出。与既有 `trash-tasks`/`restore-tasks` 同形，非本批回归。

### 1.4 I5（代码无 `.projects` 遍历）（事实）
`grep "\.projects" local-api-host.ts` 仅命中 **556、1677 两行注释**；批次 4 新代码用 `projectActions.listAllProjects()`（`:1812`）与 `habitActions.undoCheckIn`（`:1849`，不读 `habits`/打卡表）。`npx vitest run tests/local-api-host.spec.ts` → **57 passed**，I5 形状用例 `:497`（剥注释后断言 `not.toContain('.projects')`）绿。
> 注：既有 `record-checkin`（`:1063`）仍读 `ctx.getState().habits`，属历史写法、不在本批范围，I5 门禁判定对象是 `.projects`，不构成 I5 违反。

---

## 2. 正确性（重点 2）

### 2.1 四 case 落到真实 action（事实）
| intent | 命中方法 | 证据 |
|---|---|---|
| `set-task-important` | `actions.setImportant(taskId, important)` | `local-api-host.ts:1790-1795` |
| `set-task-pinned` | `actions.setPinned(taskId, pinned)` | `:1797-1802` |
| `move-tasks` | `actions.bulkMoveToProject(taskIds, projectId)` | `:1834` |
| `undo-checkin` | `habitActions.undoCheckIn(habitId, day)` | `:1849` |

`local-api-host-batch4.spec.ts`（16 条）逐条断言「先验存在→调用参数正确→返回值形状」，且 `important=false`/`pinned=false` 原样透传（不是「只认 true」）。

### 2.2 `undo-checkin` 的 day / now / logId 同日一致（事实）
`const day = intent.date ?? today(now())`（`:1847`）；`await habitActions.undoCheckIn(habitId, day)`（`:1849`）；`const logId = habitLogId(habitId, day)`（`:1860`）。**同一个 `day` 变量**贯穿三次使用 —— 不会出现「动作层用真实时钟、宿主用另一天、回的 entityId 指向另一条记录」。这与 `record-checkin`（`:1067/1082`）完全同口径。
> **测试盲点（P2）**：`undo-checkin（省略 date）`用例只断言传给动作层的日期匹配 `^\d{4}-\d{2}-\d{2}$`，**未**断言返回的 `entityId` 里的日期 == 传给动作层的日期。代码正确，但「同日一致」这条没有直接的单测钉子，建议补一条 `expect(entityId).toBe('h1:'+传给动作层的date)`。

### 2.3 `move-tasks` 返回 `{taskId, taskIds}`（合理，事实）
`:1835` 返回 `{ok:true, taskId: first, taskIds}`。与 `complete-tasks`（`:842` 返回 `taskId:first, taskIds:changed`）同一「批量结果带 id 列表」形状；对外部 MCP 程序有用。差异：move 返回全部去重 id（批量 op 一次性写全），complete 返回「实际变更」的 id（幂等跳过已完成）——语义各自自洽，**合理**。

### 2.4 toIntent 严格白名单 / 类型校验（事实）
- `task.ts`：`set_task_important`/`set_task_pinned`/`move_tasks`（`:1075-1146`）均先过滤 schema 外键 → 拒绝并点名；`taskId.trim()`；`important/pinned` 必须 boolean；`taskIds` 必须非空数组、元素非空字符串、内部 `new Set` 去重；`projectId` 若给必须非空串、省略则**不带该键**（= 移出清单）。
- `habit-log.ts`：`undo_checkin`（`:171-196`）过滤 schema 外键；`date` 若给用 `parseCalendarDay` 校验「真实存在的一天」（`shared.ts:236-252` 回读校验，2 月 30 日会被拒），省略则 intent 不带 `date` 键 = 今天。
均有用例覆盖（`task-tools-batch4` 18 条 / `habit-tools-batch4` 6 条）。

---

## 3. 测试（重点 3）

| 项 | 结论 | 证据 |
|---|---|---|
| `ai-tool-proposal-all-writes` 4 新 case 三腿可转红 | ✅ 事实 | 总数 148→**160**（+4×3）；4 条新 CASES `:495-529` 各带 `effect()` 计数；文件三腿结构（提案不落库 / 确认后 effect 变化 / 未授权 `denied` 且不变）+ 覆盖面判据（新增写工具不在清单即红）。实跑 160 passed |
| `tools-risk` 白名单含 `move_tasks` | ✅ 事实 | `tools-risk.spec.ts:55` 加入 `move_tasks`；`destructive` 集合断言 `toEqual(14 项)`，`irreversible` 断言 `[]` |
| 能力清单 65 且 4 工具归 TASK/HABIT_LOG 正确 | ✅ 事实 | §4 |
| `node scripts/check-ai-tools.mjs` | ✅ 通过 | EXIT 0；规则 6/9 通过，写入口恰好 2 处 |
| local-api 批次4 系列 | ✅ 事实 | `task-tools-batch4`(18) / `habit-tools-batch4`(6) / `tools-risk`(4) / `local-api`(35) → **63 全绿** |
| app-host 批次4 系列 | ✅ 事实 | `local-api-host-batch4`(16) / `ai-assistant`(41) / `ai-tool-proposal-all-writes`(160) → **217 全绿** |
| `local-api-host.spec.ts`（I5） | ✅ 事实 | **57 全绿** |

`task-tools-batch4` 覆盖：目录登记（3 工具 risk/egress/defaultEnabled 与契约一致）、intent 形状、严格白名单、缺必填/类型错拒绝；`habit-tools-batch4` 覆盖：省略/给定 date、未知参数拒绝、非法日期拒绝、目录进全局。

---

## 4. 能力清单 65 核对（事实）

按 `packages/ai/src/capability-manifest.generated.ts` 的 `entities[].readToolNames/writeToolNames` 逐实体计数：

| 实体 | 读 | 写 | 小计 |
|---|---|---|---|
| TASK | 3 | 22 | 25 |
| PROJECT | 1 | 6 | 7 |
| TAG | 1 | 4 | 5 |
| NOTE | 2 | 5 | 7 |
| HABIT | 1 | 4 | 5 |
| HABIT_LOG | 1 | 2 | 3 |
| FOCUS_SESSION | 1 | 1 | 2 |
| REMINDER | 1 | 3 | 4 |
| EVENT | 2 | 5 | 7 |
| **合计** | **13** | **52** | **65** |

- 4 新工具实体归属：`set_task_important`/`set_task_pinned`/`move_tasks` → TASK（manifest `:188-190`）；`undo_checkin` → HABIT_LOG（`:267`）。**正确**。
- `MAX_TOOLS_PER_ENTITY_BY_TYPE.TASK` 22→**25**（`shared.ts:135`），当前 TASK 实际恰好 25，**正好顶格**；再有 TASK 写工具必须再加限（记 P2 提醒，非缺陷）。
- 覆盖面 `coverage = 9/11`，未覆盖实体 = **COMMENT、ATTACHMENT**（`entityTypesWithoutTools`，见 §5）。

---

## 5. 总体收口清单：产品可点但 AI 仍无工具（重点 4）

> 判据：动作层（`actions.ts`/`project-actions`/`habit-actions`/`focus-actions`/`comment-actions`/`attachment-actions`）+ 65 工具清单比对。凡「有 action 无工具」或「有实体无工具」即列为剩余项。

### (a) 需产品定义 / 新模型（工具层无法单方解决）
1. **多人指派 / assignee**：动作层无 `assignee` 字段（`grep assignee` 无命中，事实）；产品尚无协作指派模型 ⇒ 工具层无从补（模型缺口）。
2. **子项逐条勾选 / 编辑**：checklist 是**备注正文里的 markdown 复选框**（`- [ ]`，`domain/ticktick-format.ts`、`preferences.ts` 的 `renderChecklist`），**无结构化「done」字段、无单项动作**；`appendChecklist` 只整体追加（`actions.ts:369`）。「逐条勾选」要先定「是否结构化」——属产品定义。
3. **评论 COMMENT**：`comment-actions.ts`、`ShareCommentsSection.tsx` 存在（事实），但**范围未定**：是本地任务评论还是分享态评论？给 AI 读写评论须先定义作用域与权限 —— 需产品定义（未核边界）。
4. **附件 ATTACHMENT**：`attachment-actions.ts` 存在（事实），但涉及文件上传/存储通道，纯文本工具范式不适合 ⇒ 需文件通道定义（未核）。

### (b) 实时交互不宜给 AI（有 action 也不该做「开始/停止」）
1. **专注计时 开始/停止**：`focus-actions` 只有 `log(session)` / `listSessions()`（事实，`:45/52`），**无 start/stop**；计时器是 UI 运行态。「开始计时」给了模型也会与其无法感知时钟冲突 ⇒ 保持事后 `log_focus` 才是对的。
2. **（未核）** 提醒弹窗的即时 snooze/dismiss 是否单独成动作 —— 未在 action 层定位。

### (c) 仍可做的小批次（有现成 action、无工具；语义单一、低风险、低频）
1. **清单颜色**：`setProjectColor(entityId, slot?)` 存在（`project-actions.ts:86/279`），**无工具**；且 `create_project` schema 只有 name/parentId（无 color）—— 建时也不能给色。可补 `set_project_color`。
2. **习惯颜色 / 图标 / 目标 / 频率**：`setHabitColor`/`setHabitIcon`/`setHabitGoal`/`setHabitFrequency` 均存在（`habit-actions.ts:179/190/227/206`），**全无工具**。可补一小组 `set_habit_color/icon/goal/frequency`。
3. **任务四象限整格**：`setQuadrantDrop(entityId, plan)` 存在（`actions.ts:930`，写 `important` + 可选 `dueDate`）**无工具**。「重要」已由本批 `set_task_important` 覆盖，「紧急=dueDate」由 `update_task` 覆盖，但无**单次整格**工具；如需一键入象限可补 `set_task_quadrant`（否则靠组合近似）。
4. **推迟到今天 `postponeToToday`**、**跳过本次重复 `skipOccurrence`**、**完成后重复开关 `setRepeatAfterCompletion`**：均有 action（`actions.ts:325/463/433`）**无工具**（UI 入口未核，推断为任务右键菜单项）。
5. **习惯打卡批量**：`checkIn`/`undoCheckIn` 仅单条（`habit-actions.ts:450/527`），**无批量动作**；批量要么新增动作、要么循环多 intent（未核产品是否有批量 UI）。
6. ~~备注正文 `setNote`~~：**已覆盖** —— `set_task_note` → `setNote(entityId, note??null)`（`actions.ts:1026`）。注意 `update_task` 的 fields **不含 note**（只 title/completed/dueDate/priority，`local-api-host.ts:729`），所以「改备注」只能走 `set_task_note`；**无需再补**（事实）。
7. **批量完成**：**已覆盖** —— `complete_task` 单一工具内部支持 `taskIds`（`task.ts:748/776` → `complete-task` / `complete-tasks`），**无需新增 `complete_tasks`**（事实，避免误判为缺口）。

### 5.1 「是否已达到能做的都做了」的判断
- **能安全落地（有 action、非实时交互、无需新模型）的写动作：批次 1–4 后已基本做完。** 剩余 (c) 是低频「锦上添花」写工具（颜色/图标/目标、推迟今天、跳过本次、完成后重复、批量打卡），价值低、频次低，且相互独立，可开**一个收官小批次**一次补完。
- **高频刚需已清零**：审计-2 列的 5 个 P1（子项逐条勾选、专注开始停止、打卡撤销、置顶/重要、批量移动）中，**打卡撤销 / 置顶 / 重要 / 批量移动已在批次 4 补齐**；剩「子项逐条勾选」「专注开始停止」分别属 (a)、(b)，**不是工具层能单方解决的缺口**。
- **结论**：**判定「主体收口完成」。** 不建议再用「AI 没工具」为由推迟任何可做项；剩余 (c) 建议列入收官小批次，(a)/(b) 转入产品定义/交互设计侧。

---

## 6. 复核：重名 / 语义重叠 / 误标 risk（重点 5）

### 6.1 无重名（事实）
`registry.ts` 拒绝两个 pack 认领同一工具名；`check-ai-tools` 通过；65 名单去重后数量一致。

### 6.2 语义重叠：均为「单/批」或「不同维度」的正当配对（事实）
- `move_task`/`move_tasks`、`trash_task`/`trash_tasks`、`restore_task`/`restore_tasks` = 单条/批量配对，命名一致。
- `complete_task` 单工具承载单条与批量（`:748/776`），无 `complete_tasks` 同名旁支，形状干净。
- `set_task_important`（重要标记）vs `set_task_priorities`（priority 档位）vs `abandon_task`（放弃）vs `trash_task`（回收站）= 四个不同维度，无重叠。

### 6.3 误标 risk（P2，非本批引入）
- **`unabandon_task` 标 `destructive-reversible`**（`task.ts:164`），而语义等价的恢复性动作 `restore_task`(`:148`)、`restore_tasks`(`:209`)、`uncomplete_task`(`:181`) 均为 `write`。「取消放弃」是**恢复**而非破坏，按 destructive 处理会让确认/语气按破坏性走。**无安全影响**（destructive-reversible 仍可逆、非 purge），建议改回 `write`，或把 `abandon_task`/`unabandon_task` 一并重新归类后统一。
- 其余 destructive 标注复核无误：`abandon_task`/`trash_task`/`move_task`/`move_tasks`/`trash_tasks`/`archive_project`/`delete_*`/`archive_event` 均「直接执行、靠 op-log 回溯兜底」的破坏性可逆动作。

### 6.4 destructive 集合核对（`tools-risk.spec.ts:52-70`，事实）
实际 14 项：`trash_task, trash_tasks, delete_habit, move_tasks, abandon_task, unabandon_task, move_task, archive_project, delete_project, delete_tag, delete_note, delete_reminder, delete_event, archive_event`。
- **全部 `destructive-reversible`；`destructive-irreversible` 断言为空** ⇒ 符合「全部可逆、无不可逆」（事实）。
- 与任务书预期集合比对：`abandon?` 已确认在列（`abandon_task`，另含 `unabandon_task` 待复核如 §6.3）；`archive_event`、`delete_habit`、`delete_event` 均在列；**无遗漏、无 purge**。

---

## 7. P0 / P1 / P2 清单

**P0（阻塞 / 安全 / 裁决 / I5 违规）：无。**

**P1（本批无；剩余高频缺口均为 (a)/(b)，非本批可修）**
- 子项逐条勾选/编辑 —— 需产品定义 checklist 是否结构化（(a)）
- 专注计时开始/停止 —— 实时交互不宜给 AI（(b)）

**P2（语义 / 边缘 / 测试盲点 / 模型缺口）**
- `unabandon_task` 误标 `destructive-reversible`（`task.ts:164`）—— 建议改 `write`（§6.3）
- `move-tasks` 未对 `bulkMoveToProject` 加 try/catch（`local-api-host.ts:1834`）—— 预检后不可达，与既有批量同形（§1.3）
- `undo-checkin（省略 date）`用例未断言 `entityId` 日期 == 传入日期 —— 「同日一致」缺直接钉子（§2.2）
- TASK 工具数 25 已顶格（`MAX_TOOLS_PER_ENTITY_BY_TYPE.TASK=25`）—— 再加需提限（§4）
- (c) 收官小批次候选：清单颜色、习惯颜色/图标/目标/频率、任务四象限整格、推迟到今天、跳过本次、完成后重复、习惯打卡批量（§5）

**未核**
- 清单颜色/习惯颜色图标/推迟到今天/跳过本次/完成后重复 的 UI 实际入口（本次只读代码，未跑 GUI）
- COMMENT / ATTACHMENT 的产品作用域与权限边界
- 提醒 snooze/dismiss 是否独立成动作

---

## 8. 验证读数（本机实跑）

```
npx vitest run tests/local-api-host.spec.ts                       → 57 passed
npx vitest run tests/local-api-host-batch4 tests/ai-tool-proposal-all-writes tests/ai-assistant
                                                                 → 16 + 160 + 41 = 217 passed
npx vitest run tests/task-tools-batch4 tests/habit-tools-batch4 tests/tools-risk tests/local-api
                                                                 → 18 + 6 + 4 + 35 = 63 passed
node scripts/check-ai-tools.mjs                                   → EXIT 0（通过）
cd packages/local-api && npx tsc --noEmit                         → EXIT 0（0 错）
cd packages/app-host && npx tsc --noEmit                          → EXIT 0（0 错）
```

> 说明：audit-2 记录的 `app-host tsc` `Buffer` 报错本轮**未复现**（EXIT 0），推测该环境已装 `@types/node`（未核具体差异，仅记读数）。

---

## 9. 交付判据小结

- 批次 4 四工具：安全（无 purge / 无 op-log 绕过 / 整批预检 / try-catch 翻语义拒绝）✅；正确性（action 落点 / 同日一致 / 返回形状 / 严格白名单）✅；测试（三腿可转红 / 白名单 / 65 清单 / check-ai-tools / 全绿）✅。
- 总体收口：**主体完成**；剩余 (c) 收官小批次可选，(a)/(b) 转产品侧。**无 P0、本批无 P1。**
