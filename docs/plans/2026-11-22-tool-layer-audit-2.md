# 工具层补全 批次 2 / 批次 3 审计报告

> 审计对象：`0bd23bb7`（批次2，6 工具）、`a81ed7b6`（批次3，6 工具）
> 依据契约：`docs/plans/2026-11-22-tool-layer-batch2-contract.md`、`-batch3-contract.md`、`-p0-p1-contract.md`
> 依据规则：`AGENTS.md`、`docs/agents/hard-constraints.md` §3.4/§3.5、`ADR-0083`、`ADR-0048` §2/I5
> 审计方式：只读（未改任何代码）；证据标「事实 / 推断 / 未核」
> 时间：2026-11-22

## 0. 结论摘要

- **P0 = 0 条。** 12 个工具全部经 action 层 → op-log 落地，`submitIntent` 里**没有**任何一处绕过 op-log 直接改状态（事实：仅做 `ctx.getState()` 只读校验 + `actions.*` / `projectActions.*` / `habitActions.*` 调用）。
- **删除类全部软删除可逆、无 purge（事实）**：`trash_tasks`→`bulkRemove`→`OpType.Delete`（`actions.ts:734`）；`delete_habit`→`removeHabit`→`OpType.Delete`（`habit-actions.ts:440`）；均无 purge 路径，且 `tools-risk.spec.ts:46` 钉死 destructive 白名单、断言 `destructive-irreversible` 为空。
- **I5 绿（事实）**：`local-api-host.ts` 剥注释后**不含 `.projects`**；`restore_project`/`restore_habit` 把判活交给 `projectActions.restoreProject` / `habitActions.restoreHabit`，本层不读原始表。`tests/local-api-host.spec.ts` 57 条全绿（I5 用例在 `:497`）。
- **throw 全部翻 invalid（事实）**：`set_task_parent`/`move_project`/`create_subtask`/`set_task_repeat` 均 `try/catch → reason:'invalid'`；`restore_project`/`restore_habit` `catch → not-found`。
- **能力清单 = 61 工具 / 14 实体（事实，`node scripts/gen-ai-capability-manifest.mjs` 输出）**，`set_task_note`/`create_subtask`/`set_task_repeat` 归 TASK，`move_project`/`restore_project` 归 PROJECT，`rename_habit`/`delete_habit`/`restore_habit` 归 HABIT；`node scripts/check-ai-tools.mjs` 通过。
- **测试真能转红（事实）**：`ai-tool-proposal-all-writes.spec.ts` 148 条，每个写工具三腿（提案不落库 / 确认效果 +1 / 未授权 denied）+ 覆盖面判据；实跑全绿。
- 唯一实质小瑕疵：`restore-tasks` 只滤 `purgedAt`、未滤 `deletedAt`（P2，见 §3.5）。

## 1. 安全 / 裁决

| 检查项 | 结论 | 证据 |
|---|---|---|
| `trash_tasks` 软删除可逆、无 purge | ✅ 事实 | `local-api-host.ts:1593` 先整批 `findTask` 预检 → `actions.bulkRemove` → `OpType.Delete`（`actions.ts:734-751`） |
| `delete_habit` 软删除可逆、无 purge | ✅ 事实 | `local-api-host.ts:1756` → `habitActions.removeHabit` → `OpType.Delete`（`habit-actions.ts:440`）；注释明示打卡记录不级联 |
| `submitIntent` 是否绕过 op-log 直接改状态 | ✅ 无 | 新增 12 分支只读 `ctx.getState()` 做存在性校验，写入全走 `actions.*`/`projectActions.*`/`habitActions.*`；`bulkRestore` 仅读桶后仍 `ctx.dispatch(Batch)`（`actions.ts:751`） |
| `set_task_parent` throw 翻 invalid | ✅ 事实 | `local-api-host.ts:1576-1591`，`setParent` 同步 throw → `reason:'invalid'` |
| `create_subtask` throw 翻 invalid | ✅ 事实 | `local-api-host.ts:1698-1717`，`createSubtask` 异步 reject → `invalid`；返回 `{ok:true,taskId:id}` |
| `set_task_repeat` throw 翻 invalid | ✅ 事实 | `local-api-host.ts:1728-1740`，`isValidRecurrenceRule` throw → `invalid` |
| `move_project` throw 翻 invalid | ✅ 事实 | `local-api-host.ts:1660-1673`，`projectActions.setParent` throw → `invalid` |
| `restore_project`/`restore_habit` 判活不吞成 500 | ✅ 事实 | `local-api-host.ts:1675-1696` / `1766-1786`，`ok===false→not-found`，`throw→not-found`（带人话） |

> 备注：删除类工具**不进** irreversible，符合 D1「purge 不给 AI」；`tools-risk.spec.ts:50-73` 白名单含 `trash_tasks`、`delete_habit`，且 `irreversible` 断言为空。

## 2. I5 纪律（隐藏由层负责）

- **事实**：`local-api-host.ts` 剥注释后无 `.projects`（`grep -n "\.projects"` 仅命中第 556、1677 行**注释**；I5 用例 `local-api-host.spec.ts:497-508` 先剥注释再断言 `not.toContain('.projects')`）。实跑 `npx vitest run tests/local-api-host.spec.ts` → **57 条全绿**。
- **事实**：`move-project` 用 `projectActions.listAllProjects()`（`local-api-host.ts:1661`）、`restore-project` 用 `projectActions.restoreProject`（`:1681`）、`restore-habit` 用 `habitActions.restoreHabit`（`:1771`）；三者均不自建可见性判据。
- **事实（可接受的偏离）**：`restore-tasks`（`local-api-host.ts:1617-1640`）仍读原始 `ctx.getState().tasks[id]` —— 但这与单条 `restore` 同一条既有理由（`findTask` 滤墓碑、恢复必须看墓碑），且 I5 门禁的判定对象是 `.projects`，故**不算 I5 违反**。

## 3. 正确性

### 3.1 意图 ↔ 动作方法对齐（12/12）
- 签名逐一核对：`setParent(entityId, parentId?)`、`bulkRemove/bulkRestore(readonly string[])`、`setOrder(entityId, order)`、`createSubtask(parentId, title):Promise<string>`、`setNote(entityId, note|undefined)`、`setRepeat(entityId, rule|undefined)`（`actions.ts:194/207/209/278/365/387/422`）；`projectActions.setParent(entityId, parentId?)`、`restoreProject(entityId):Promise<boolean>`、`listAllProjects()`（`project-actions.ts:109/167/182`）；`habitActions.renameHabit/removeHabit/restoreHabit/listHabits`（`habit-actions.ts:165/167/274/264`）。**全部匹配（事实）。**

### 3.2 `set_task_note` 省略 note = 清除
- ✅ 事实：`setNote(entityId, note)` → `update(entityId, { note: note ?? null })`（`actions.ts:1026-1029`），省略（undefined）→ 写 `null` 清除。
- ⚠️ 边缘（P2）：若模型显式传 `note:""`，`"" ?? null` = `""`，写空串而非清除；契约「省略=清除」仍成立，空串属"给了值"，不判缺陷。

### 3.3 `set_task_repeat` rule 省略 = 清除
- ✅ 事实：`setRepeat(undefined)` 同时清 `repeatRule` 与 `repeatDtstart`（`actions.ts:1161-1171`），避免"有锚点没规则"半截态。

### 3.4 `create_subtask` 返回 id 形状
- ✅ 事实：`createSubtask` 单条 op（非 create+setParent 两条），返回 `Promise<string>`；宿主回 `{ok:true, taskId:id}`（`local-api-host.ts:1714`）。

### 3.5 批量 trash/restore 整批预检
- ✅ 事实：`trash-tasks`（`:1593`）先 `findTask` 过滤全部缺失 → 有缺失则整批 not-found、一条都不删；`restore-tasks`（`:1617`）先逐条查桶 → 有缺失整批 not-found。
- ⚠️ **P2 瑕疵（事实）**：`restore-tasks` 的预检只判 `task === undefined || task.purgedAt !== undefined`，**未判 `deletedAt`**。后果：对一条**未删除的活任务**调 `restore_tasks` 会通过预检、`bulkRestore` 派发 `deletedAt:null` 的 Batch（无害空写）并返回 `ok:true`——即"其实没恢复任何东西却报成功"。不影响数据安全（不 purge、不误删），但语义不准确。建议预检补 `|| task.deletedAt === undefined ⇒ 视为不在回收站`。

### 3.6 其他
- `create_subtask` 的 `title` 未 trim（`task.ts` intent 原样传），`parentId` 已 trim —— 推断：标题前后空格会保留，非缺陷但与其他工具「trim 输入」风格略不一致（P2/未核是否有意）。

## 4. 测试价值

| 项 | 结论 | 证据 |
|---|---|---|
| `ai-tool-proposal-all-writes` 新增 6+6 能转红 | ✅ 事实 | 文件三腿结构（`:15-20` 定义）：提案阶段效果读数不变 / 确认后 +1 / 未授权 `denied` 且不变；且有覆盖面判据钉住"新增写工具不在清单就红"。实跑 **148 条全绿** |
| `tools-risk` destructive 白名单含 `trash_tasks`/`delete_habit` | ✅ 事实 | `tools-risk.spec.ts:50-73` |
| 能力清单工具数=61、`set_task_note` 归 TASK | ✅ 事实 | `gen-ai-capability-manifest.mjs` 输出「工具 61 / 实体 14 / 覆盖面 9/11」；TASK 组含 `create_subtask/set_task_note/set_task_repeat`（manifest `:182-188`），HABIT 组含 `rename/delete/restore_habit`（`:248-251`） |
| `scripts/check-ai-tools.mjs` | ✅ 绿 | 规则 6/9 通过，写入口恰好两处 |
| local-api 相关系列 | ✅ 事实 | `task-tools-batch2`(16)/`batch3`(17)/`project-tools-batch2`(10)/`habit-tools-batch3`(11)/`tools-risk`(4) → **58 全绿** |
| app-host 相关系列 | ✅ 事实 | `local-api-host`(57)/`batch2`(22)/`batch3`(19) → **98 全绿** |
| tsc | ⚠️ | `local-api` 0 错（事实）；`app-host` 报 1 处 `payload-mode-migration.ts(62,46) Cannot find name 'Buffer'` —— **本次两提交均未改动该文件**，属既有/环境（缺 `@types/node` types）问题，**非本次引入**（推断） |

## 5. 遗漏（产品可点、AI 无工具）

> 均以 actions/UI 现有能力为准；「无工具」= 61 工具清单里查无（事实）。按频次分档。

**P1（高频、对标滴答清单刚需）**
1. **子项逐条勾选/编辑**：`append_task_checklist` 只能整体追加（`ai-tool-…` 用例），**无**单项 toggle/改文字/删单项工具。
2. **专注开始/停止**：仅有 `log_focus`（事后记一次会话），**无**"开始计时/停止计时"工具（未在 actions 找到 `startFocus/stopFocus`，推断 UI 有计时器，未核具体入口）。
3. **习惯打卡撤销**：有 `record_checkin`，**无**撤销/删除某日打卡的工具。
4. **任务四象限 / 重要 / 置顶**：`actions.setPinned`（`actions.ts:882`，写 `pinnedAt`）、`setQuadrantDrop`（`:932`，写 `important`）均存在，但**无**对应 AI 工具（现有 `set_task_priorities` 只管 priority）。
5. **批量移动清单**：`move_task` 仅单条；**无**批量移动任务到清单的工具。

**P2（中低频）**
6. **清单颜色/图标**：习惯侧 `setHabitColor/setHabitIcon/setHabitGoal` 存在但无工具（`habit.ts` 文件头已登记为"还没做"，附产品理由）；清单（project）颜色/图标是否可点 —— **未核**。
7. **分配任务 / 多人指派**：actions 中**无 `assignee`/指派字段**（`grep assignee` 无命中，事实）⇒ 产品尚无协作模型，工具层无从补起；属**模型缺口**，非本批工具遗漏。

> 说明：以上多数在 `docs/plans/ai-event-tool-contract.md §5.4` 或各实体文件头已有"还没做"登记，属**已知待办**而非本批回归；此处按"产品可点 vs AI 无工具"重新点一遍，供排期。

## 6. 复核（p0-p1 遗留两项）

- **`update_reminder` 用 date+time 正确**：✅ 事实。模型只给 `date(YYYY-MM-DD)+time(HH:MM)`，宿主 `localDateTimeToEpoch(`${date}T${time}`)` 换算毫秒、失败回 `invalid`，再 `rescheduleReminder`（`local-api-host.ts:1501-1521`）。把 epoch 计算关在宿主、不让模型算——方向正确。
- **`abandon_task` 语义=放弃（abandonedAt）准确**：✅ 事实。`setAbandoned` **只写** `abandonedAt`，**不碰** `completedAt`（`actions.ts:917-929`，注释引 ADR-0083 §3.1），避免"放弃即完成"污染完成率、避免重复任务被顺延。与 ADR-0083 第五态一致。

## 7. P0 / P1 / P2 清单

**P0（阻塞 / 安全 / 裁决 / I5 违规）**：无。

**P1（产品高频能力缺口，建议下一批补）**
- 子项逐条勾选/编辑（现仅整体追加）
- 专注开始/停止（现仅事后 log）
- 习惯打卡撤销
- 任务置顶 / 重要（四象限）
- 批量移动任务到清单

**P2（语义/边缘/模型缺口）**
- `restore-tasks` 预检未判 `deletedAt`：对活任务调 restore 报 `ok:true` 实则空写（`local-api-host.ts:1623-1626`）
- `set_task_note` 传 `note:""` 写空串而非清除（`actions.ts:1028`，`"" ?? null` 不落 null）
- `create_subtask` 的 `title` 未 trim（`task.ts` create_subtask intent）
- 清单颜色/图标是否有工具 —— 未核
- 分配任务/多人指派：无 assignee 模型，工具层无从补（模型缺口）

**未核**
- 专注计时、清单颜色/图标 的 UI 实际入口（本次只读代码，未跑 GUI）
- `app-host` tsc 的 `Buffer` 报错是否为纯环境（缺 types）问题，未在本机换环境复跑
