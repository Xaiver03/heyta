# 工具层补全 P0/P1 —— 审计报告

> 审计对象：提交 `68a25dfc`（`feat(tools): 工具层补全19个写工具…`），21 个文件 / +2565 −46。
> 契约：`docs/plans/2026-11-22-tool-layer-p0-p1-contract.md`。
> 规则依据：`AGENTS.md`、`docs/agents/hard-constraints.md` §3.3/3.4/3.5、`docs/adr/0083`。
> 方式：只读审计 + 实跑门禁（见文末「验证读数」）。标注 **事实** = 已读代码/已跑命令确认；**推断** = 由代码结构推出但未单测；**未核** = 未取证。

---

## 结论摘要

- **安全裁决（重点 1）：通过。** 19 条新写动作全部落软删除（`DEL`→`deletedAt`）或字段更新（`UPD`），无任何 `purge`/清空回收站工具；`submitIntent` 每条 case 都只调 `actions/projectActions/noteActions/reminderActions/eventActions` 的方法，而这些都是 `ctx.dispatch` 进 op-log 的唯一写入口，**未发现绕过 op-log 直接改状态的 case**（事实）。
- **正确性（重点 2）：19 条 case 逐条落到契约指定方法，签名/语义对齐；`move-task` 省略 projectId = `moveToProject(id, undefined)` = `projectId:null`（移出清单）成立**（事实）。但有两处语义/健壮性偏差见 P1。
- **`update_reminder`（重点 3）：换算口径与 `create_reminder` 相同（`localDateTimeToEpoch`，本地日历日 + 本地钟点，`new Date(y,m,d,h,mi,s)` 不会整差一天）；但校验口径不同——缺 `reminderRejection`（P2）。**
- **测试价值（重点 4）：高。** `ai-tool-proposal-all-writes` 用真引擎 + 真 SQLite 跑「提案不落库 / 确认+1 / 未授权 denied」三条腿，并有一条「目录里每个 `kind==='write'` 工具都必须在清单里」的覆盖面判据（事实）。实跑：local-api 230 passed、app-host 155 passed、`check-ai-tools` 通过。
- **无 P0（不可逆/数据丢失级）。** 最高为 P1。

---

## P0

无。

（说明：审计重点 1 逐一核查：`trash_task`→`actions.remove`（`OpType.Delete`，软删，`apps/.../actions.ts:724`）；`delete_project`→`removeProject`（DEL，`project-actions.ts:321`）；`delete_tag`→`removeTag`（DEL，`:361`）；`delete_note`→`removeNote`（DEL）；`delete_reminder`→`removeReminder`（DEL，`:460`）；`delete_event`→`removeEvent`（DEL，`event-actions.ts`）。目录风险档断言 + `tools-risk.spec.ts` 确认无 `destructive-irreversible` 进目录。均无 purge 路径。）

---

## P1

### P1-1 `archive_task` 实为「放弃」，与产品语义/界面用词不符
- **事实**：`archive_task` → `actions.setAbandoned(taskId, true)`（`packages/app-host/src/local-api-host.ts:1346-1351`）。`setAbandoned` 只写 `abandonedAt`，注释明确「只写这一个字段，不碰 `completedAt`」（`actions.ts:917-929`）。
- **事实**：ADR-0083 §3 把这一态定义为**第五态「放弃」（abandon）**，不是「归档」；界面词条是 `web.rowMenu.abandon='放弃'` / `unabandon='取消放弃'`（`packages/i18n/src/locales/zh-CN.ts:879-882`）。任务实体**没有** `archivedAt` 字段（`entities.ts` 中 `archivedAt` 属 `CountdownEvent`，非 `Task`）。
- **影响（推断）**：工具名/描述「归档任务（可逆…）」会让模型把用户说的「归档」翻成 `archive_task`，落地成「放弃」——不计入完成率、不属「已完成」，与用户「归档=做完收纳」的直觉不同。可逆（unabandon）故非数据损失。
- **注**：实现与**契约**一致（契约 §2 就写的 `archive-task → setAbandoned(true)`），问题在契约命名。建议工具改名为 `abandon_task/unabandon_task` 或描述改为「放弃」。

### P1-2 `restore_event` 缺 `purgedAt` 护栏，理论上可「复活」已彻底删除的倒数日
- **事实**：`restore-task` 在门口挡了墓碑与 `purgedAt`（`local-api-host.ts:1336`），`restore-note` 同样挡了 `purgedAt`（`:1468`）；但 `restore-event` 只判 `event === undefined`（`:1551-1556`），未判 `purgedAt`。而 `eventActions.restoreEvent` 自身也**不**检查 `purgedAt`（`event-actions.ts:388-399`，只判 `deletedAt`），成功即清 `deletedAt`。
- **推断**：一旦 EVENT 存在 purge 路径，`restore_event` 会把一条已彻底删除的倒数日恢复回来，违反 ADR-0048「purge 不可逆」。
- **未核/现状缓解**：全仓搜索 `purgeEvent` 无定义、EVENT 无 purge 动作（`grep -rn purgeEvent` 为空），故**当前不可达**，属潜在缺陷。仍需补 `event.purgedAt` 判断（对齐 task/note），否则未来给 EVENT 接 purge 时会静默出现「不可逆变可逆」。

### P1-3 「destructive-reversible 直接执行 + 可撤销」成立，但撤销能力有边界且依赖壳接线
- **事实**：`aiToolProposalRequiresConfirmation`：`destructive-irreversible → true`、`destructive-reversible → false`（`packages/app-host/src/ai-tool-run.ts:87-95`）——即新增删除/归档/移动工具是**直接执行、不弹确认**，符合 D1 裁决。
- **事实**：可撤销原语真实存在：op-log `buildHistoryEntry` 为 `DEL` 生成反向 `UPD{deletedAt:null}`、为 `UPD/Move` 生成逐字段反向（`packages/op-log/src/history.ts:184-203`）；`engine.undoSince(seq)` 按本地 `clientId` 批量反放（`engine.ts:621-630`）；web/mobile 壳已接 `runAiTurnWithUndo/undoSince`（`apps/web/src/features/ai/cloud-harness.ts`、`apps/mobile/src/ai/cloud-harness.ts`）。
- **边界（事实 + 推断）**：
  - `buildHistoryEntry` 对 `entityIds.length>0`（多实体/batch）与 batch marker **直接 skip**（`history.ts:154-165`）→ 单实体删除可撤销，批量写不可逐条撤销；本轮 19 条均为单实体，**不受影响**。
  - `undoSince` 只反放 `clientId === 本机` 的 op、上限 1000 条（`engine.ts:623-625`）。
  - `ai-run-ledger.ts:16` 自述「它只记录，不执行回滚……按 run 回滚是下一步」，与 web/mobile 已接 `undoSince` 存在口径张力（一个是「按 runId 精确回执」未做，一个是「按 seq 整段撤销」已做）。
  - **未核**：桌面端外壳（如有）是否同样接 `runAiTurnWithUndo`；未接的壳上「可撤销」只停留在数据可恢复、无 UI 撤销入口。

---

## P2

### P2-1 `update_reminder` 缺 `reminderRejection`，与 `create_reminder` 校验不同口径
- **事实**：`create-reminder` 换算后调 `reminderRejection(triggerAt, now())` 拒绝 `in-the-past` / `too-far`（`local-api-host.ts:1183-1196`）；`update-reminder` 只 `localDateTimeToEpoch` 后直接 `rescheduleReminder`（`:1508-1521`），`rescheduleReminder` 内 `assertTrigger` 仅校验正有限数（`reminder-actions.ts:369`）。
- **推断**：AI 可把提醒改到过去或超远未来；`create` 会拒、`update` 不拒，两处口径不一致。建议 `update-reminder` 复用 `reminderRejection`。
- **换算本身无问题（事实）**：`localDateTimeToEpoch` 用 `new Date(y,m,d,h,mi,s)` 本地构造（`packages/domain/src/date.ts:181-212`），时区不会整差一天。

### P2-2 `delete_tag` 并不「把它从所有任务上一起摘掉」——注释与实现不符
- **事实**：`tag.ts` 文件头称「删一条标签会把它从所有任务上一起摘掉」（`packages/local-api/src/tools/tag.ts`），但 `submitIntent` 只调 `projectActions.removeTag`（`local-api-host.ts:1448`），`removeTag` 仅 `DEL` 标签实体、**不动 `task.tagIds`**（`project-actions.ts:361-367`）。UI 侧亦有注释承认任务会「指向一个已经不存在的 id」（`packages/ui/src/projects/model.ts:398`）。
- **影响（推断）**：与界面现有行为一致（读时按 id 过滤，故看不出），但工具文档夸大；属注释纠偏，非数据损坏。

### P2-3 「删除能恢复」不对称：PROJECT/TAG/REMINDER 只有 delete 工具、无 restore 工具
- **事实**：新目录里 task/note/event 都有 `restore_*`，而 `delete_project`/`delete_tag`/`delete_reminder` 没有对应的 `restore_*`（`LOCAL_API_TOOLS` 全量 49 条）。`projectActions.restoreProject` 存在（`project-actions.ts:380`）但未接工具。
- **影响（推断）**：AI 可「删清单」却无法「恢复清单」，只能靠版本回溯或用户去界面点。归档/删除可逆的产品承诺在工具面不完整。建议补 `restore_project`（TAG/REMINDER 若无产品 restore 出口则可注明）。

### P2-4 目录预算被人为抬高（PROJECT 8 / NOTE 10）但当前用量远低
- **事实**：`MAX_TOOLS_PER_ENTITY_BY_TYPE` 新增 `PROJECT:8, NOTE:10`（`shared.ts:131-136`），当前 PROJECT 写读合计 5、NOTE 6。抬高不违反规则，但会削弱「按实体判上限」的约束力（多余的 3–4 席）。非阻塞。

### P2-5 小的一致性瑕疵（不影响数据）
- `move_note` 的 `projectId` 未 `trim` 后落 intent（`note.ts`），而 `move_task` 有 trim——不一致（事实）。`setNoteProject` 内部会 `assertProject` 但不清空白，可能把带空白 id 当清单（推断）。
- `archive_event` 对「已归档」不幂等：每次调用都写一条新 `archivedAt` op（`event-actions.ts:356-362` 无 `archived` 短路），产生空转 op 噪音（事实）。
- `restore-task/restore-note` 在 submitIntent 与 action 两层都做 `purgedAt` 判定，功能正确但属重复防御（事实，无害）。

---

## 遗漏（重点 5）：产品能点但 AI 没工具的缺口

| 能力 | 产品是否可点 | AI 工具 | 判据 |
|---|---|---|---|
| 任务子项/子任务嵌套（`setParent`） | 可（`apps/web/src/features/tasks/TaskDetailCard.tsx:904`、`apps/mobile/.../TaskDetailSheet.tsx:613`） | ❌ 无 | 有 `move_task`（换清单）但无「改父/建子任务」工具 |
| 清单层级移动（`projectActions.setParent`） | 可（`apps/web/src/features/projects/store.ts:141`、`apps/mobile/.../ListsSection.tsx:342` 拖拽） | ❌ 无 | 无 `move_project`/`set_project_parent` 工具 |
| 任务清单子项勾选（markdown `- [ ]` 单条勾选/取消） | 可 | ❌ 只有 `append_task_checklist`（追加），无逐条勾选 | `task.ts` 仅 append |
| 批量操作（批量完成/删除/移动） | 可（`bulkSetCompleted/bulkRemove/bulkMoveToProject` 均在 `actions.ts`） | ❌ 无 bulk 工具 | 目录无 bulk_* |
| 手动排序 / 拖动顺序（`setOrder`） | 推断可（UI 手排） | ❌ 无 reorder 工具 | `actions.ts:setOrder` 存在但无工具；**未核** UI 入口 |
| 专注计时开始/停止 | 可（界面计时器） | ❌ 设计上不做 | `focus.ts` 文件头明确「开始/中止是界面按出来的」 |
| 标签合并 | 推断无（产品似无合并） | ❌ | **未核** 产品是否有合并入口 |
| 便签钉到今天（`setNotePinnedToToday`） | 可 | ❌ | `note.ts` 文件头已登记为「不是漏写」 |

**「分配任务」（多人协作指派）**：`Task.assigneeUserId` 字段存在（`packages/domain/src/entities.ts`，ADR-0062 W3 规划），但**全仓零写点**（`packages/ui/src/sync/notification-model.ts:125-126` 如实记录：`grep ... assigneeUserId` 只剩实体声明与该注释）。**结论（事实）**：当前**没有可用的协作指派模型**——没有「指派给某成员」的动作/UI/工具；字段只是为未来共享清单预留。因此「分配任务」目前不是「产品能点但 AI 缺工具」，而是产品本身未实现，不应据此建 AI 工具。

---

## 测试价值评估（重点 4）

- **`packages/app-host/tests/ai-tool-proposal-all-writes.spec.ts`（事实，实跑通过）**：真 `OpLogEngine` + 真 `:memory:` SQLite；对 `LOCAL_API_TOOLS` 中**每个** `kind==='write'` 逐条跑三腿：①跑执行步效果读数不变（抓「提案即落库」）；②`confirmAiToolProposal` 后恰好 +1（抓「确认是空操作」）；③给另一工具授权 → `denied` 且读数不变（抓「不是整条路径放行」）。另有覆盖面判据 `covered === writeTools`——新加写工具不登记即红。**能转红，价值高。**
- **`packages/local-api/tests/tools-risk.spec.ts`（事实）**：把允许的 `destructive-reversible` 集合钉成 11 个具名清单，并断言 `destructive-irreversible` 恒为空；新增删除类工具未登记即红。
- **`local-api-host-lifecycle.spec.ts`（事实）**：用 `vi.mock` 假 action 桩精确断言「哪条 intent 调哪个方法、传什么」（如 `archive-task → setAbandoned('t1',true)`、`move-task 无 projectId → moveToProject(t1,undefined)`、`update-reminder` 换算后毫秒），43 例通过。**局限**：桩环境**未覆盖 `restore_*` 的 `purgedAt` 分支**（无 `purged` 相关用例）——正是 P1-2 未被抓到的原因；建议补一条「已 purge 的 task/note/event → not-found 且不调 restore」。
- **`check-ai-tools`（事实）**：通过，报告「能力清单与上游一致」；`capability-manifest.generated.ts` 含全部 19 个新工具名，`capability-manifest.spec.ts` 已把 EVENT 写工具断言扩到 5 个。

---

## 验证读数（本机实跑）

```
node scripts/check-ai-tools.mjs            → ✅ 通过（能力清单与上游一致）
packages/local-api  npx vitest run         → 13 files / 230 tests passed
packages/app-host  npx vitest run \
  tests/ai-tool-proposal-all-writes.spec.ts \
  tests/local-api-host-lifecycle.spec.ts   → 2 files / 155 tests passed
```

---

## 建议处理顺序

1. **P1-1**：`archive_task/unarchive_task` 改名或描述改为「放弃/取消放弃」（对齐 ADR-0083 与 i18n），或确认产品确实愿意对外叫「归档」。
2. **P1-2**：`restore-event` 补 `event.purgedAt !== undefined → not-found`，并补一条能红的用例。
3. **P2-1**：`update-reminder` 复用 `reminderRejection`（过去/超远应拒）。
4. **P2-2/P2-3**：纠 `tag.ts` 注释；视产品补齐 `restore_project` 等恢复工具。
5. **遗漏**：按价值排序补 `set_project_parent/move_project`、子任务 `set_parent`、批量、清单勾选工具；「分配任务」在协作模型落地前不建。
