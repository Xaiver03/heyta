# 工具层补全 —— 批次 4 精确契约（任务标记 / 批量移动 / 习惯打卡撤销）

> 最后一批"能安全落地"的动作。铁律同前。**本批后仅剩需产品定义或实时交互的项**（子项逐条勾选、专注计时开始停止、多人指派）。

## 1. 新增 `LocalApiWriteIntent` 成员（seam4）
```ts
| { action: 'set-task-important'; taskId: string; important: boolean }
| { action: 'set-task-pinned'; taskId: string; pinned: boolean }
| { action: 'move-tasks'; taskIds: readonly string[]; projectId?: string }
| { action: 'undo-checkin'; habitId: string; date?: string }
```

## 2. `submitIntent` 映射（seam4）
| intent | 实现 |
|---|---|
| `set-task-important` | 先验 taskId 存在；`await actions.setImportant(taskId, important)` |
| `set-task-pinned` | 先验存在；`await actions.setPinned(taskId, pinned)` |
| `move-tasks` | `taskIds` 非空；若给 projectId 先验清单存在；`await actions.bulkMoveToProject(taskIds, projectId)` |
| `undo-checkin` | `try { const ok = await habitActions.undoCheckIn(habitId, date) ; if(!ok) not-found }`（`date` 省略=今天；格式 YYYY-MM-DD，交由动作层 `toLocalDate`） |

存在性校验读动作层（findTask / listAllProjects / listHabits），不在本层遍历原始表（I5）。返回：任务类 `{ok:true,taskId}`；习惯类 `{ok:true,entityId,entityType:'HABIT_LOG'}`。

## 3. 工具
### task.ts（task-tools4）
| 工具 | 参数 | intent | risk |
|---|---|---|---|
| `set_task_important` | `taskId:string, important:boolean` | set-task-important | write |
| `set_task_pinned` | `taskId:string, pinned:boolean` | set-task-pinned | write |
| `move_tasks` | `taskIds:string[]（≥1）, projectId?:string` | move-tasks | destructive-reversible |

### habit.ts（habit-tools4）
| 工具 | 参数 | intent | risk |
|---|---|---|---|
| `undo_checkin` | `habitId:string, date?:string` | undo-checkin | write |

每个：目录条目 + SCHEMAS(additionalProperties:false, important/pinned 必须 boolean) + toIntent（严格白名单、类型校验；省略 projectId/date 时不带该键）。

## 4. 判据
每工具 toIntent 正常 + 未知参数拒绝 + 缺必填/类型错拒绝；local-api/app-host 相关测试绿；tsc 0 错。
