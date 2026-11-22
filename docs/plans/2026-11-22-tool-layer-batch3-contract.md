# 工具层补全 —— 批次 3 精确契约（子任务 / 备注 / 重复 / 习惯改删恢复）

> 2026-11-22 第三批。铁律同前。只做能安全落地的动作：`createSubtask` / `setNote` / `setRepeat` / 习惯 `rename/remove/restore`。

## 1. 新增 `LocalApiWriteIntent` 成员（seam3）
```ts
// 任务：子任务 / 备注 / 重复
| { action: 'create-subtask'; parentId: string; title: string }
| { action: 'set-task-note'; taskId: string; note?: string }
| { action: 'set-task-repeat'; taskId: string; rule?: string }
// 习惯：改名 / 删除 / 恢复
| { action: 'rename-habit'; habitId: string; name: string }
| { action: 'delete-habit'; habitId: string }
| { action: 'restore-habit'; habitId: string }
```

## 2. `submitIntent` 映射（seam3）
| intent.action | 实现 |
|---|---|
| `create-subtask` | 先验 parentId 存在；`const id = await actions.createSubtask(parentId, title)`（对非法父/超深**同步或异步 throw** → try/catch 翻 invalid）；回 `{ok:true,taskId:id}` |
| `set-task-note` | 先验 taskId 存在；`await actions.setNote(taskId, note)`（note 省略=清除） |
| `set-task-repeat` | 先验存在；`try { await actions.setRepeat(taskId, rule) } catch → invalid`（`isValidRecurrenceRule` 会 throw）；rule 省略=清除 |
| `rename-habit` | 先验 habitId 存在；`name` 非空；`await habitActions.renameHabit(habitId, name)` |
| `delete-habit` | 先验存在；`await habitActions.removeHabit(habitId)` |
| `restore-habit` | `try { const ok = await habitActions.restoreHabit(habitId); if(!ok) not-found } catch → not-found`（I5：不读原始 `.habits` 判活，交给动作层） |

存在性校验：任务/习惯读 `ctx.getState()`（墓碑 `deletedAt` 视为不存在）。返回形状：任务类 `{ok:true,taskId}`；习惯类 `{ok:true,entityId,entityType:'HABIT'}`。

## 3. 工具（各实体子 Agent）
### task.ts（task-tools3）
| 工具 | 参数 | intent | risk |
|---|---|---|---|
| `create_subtask` | `parentId:string, title:string` | create-subtask | write |
| `set_task_note` | `taskId:string, note?:string` | set-task-note | write |
| `set_task_repeat` | `taskId:string, rule?:string` | set-task-repeat | write |

### habit.ts（habit-tools3）
| 工具 | 参数 | intent | risk |
|---|---|---|---|
| `rename_habit` | `habitId:string, name:string` | rename-habit | write |
| `delete_habit` | `habitId:string` | delete-habit | destructive-reversible |
| `restore_habit` | `habitId:string` | restore-habit | write |

每个：`LOCAL_API_TOOLS` + `SCHEMAS`(additionalProperties:false) + `toIntent`(严格白名单、类型校验、省略可选键时不带该键)。

## 4. 判据
每工具 toIntent 正常 + 未知参数拒绝 + 缺必填/类型错拒绝；local-api/app-host 相关测试绿；tsc 0 错。
