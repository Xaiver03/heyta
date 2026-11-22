# 工具层补全 —— P0/P1 精确契约（供并行子 Agent 共同遵循）

> 2026-11-22。目标：把"产品能点的操作"补成 AI 工具。**所有写仍走 op-log 单入口**；删除=回收站（可逆、可撤销）；purge 不给 AI。

## 0. 铁律（每个子 Agent 必读）
- 一个用户意图 = 一个 op；工具只产出 `LocalApiWriteIntent`，**绝不直接改状态**。
- 删除 = 软删除（`DEL`→墓碑 `deletedAt`）；`purge`/清空回收站**永不**做工具。
- 新增写入动作 = **三处同时改**：① `local-api/src/tools/shared.ts` 的 `LocalApiWriteIntent` 联合；② `app-host/src/local-api-host.ts` 的 `submitIntent` switch（漏一条编译不过）；③ 实体 `tools/<entity>.ts` 的 `toIntent()`。
- 工具风险档用 `ToolRisk`：`read` / `write` / `destructive-reversible`（删除→回收站、归档、移动：直接执行，靠版本回溯兜底）/ `destructive-irreversible`（purge：**不建工具**）。
- 不改 `CURRENT_SCHEMA_VERSION`，不动线协议，不改 AGENTS/ADR。
- 只改你被分配的文件。**不要改** `shared.ts` 与 `local-api-host.ts`（那是 seam-owner 的）。

## 1. 新增 `LocalApiWriteIntent` 成员（seam-owner 负责，其余人照此引用）

```ts
// 任务生命周期（P0）
| { action: 'trash-task'; taskId: string }
| { action: 'restore-task'; taskId: string }
| { action: 'archive-task'; taskId: string }
| { action: 'unarchive-task'; taskId: string }
| { action: 'move-task'; taskId: string; projectId?: string }
| { action: 'uncomplete-task'; taskId: string }
// 清单（P1）
| { action: 'rename-project'; projectId: string; name: string }
| { action: 'archive-project'; projectId: string; archived?: boolean }
| { action: 'delete-project'; projectId: string }
// 标签（P1）
| { action: 'rename-tag'; tagId: string; name: string }
| { action: 'delete-tag'; tagId: string }
// 笔记（P1）
| { action: 'delete-note'; noteId: string }
| { action: 'restore-note'; noteId: string }
| { action: 'move-note'; noteId: string; projectId?: string }
// 提醒（P1）
| { action: 'update-reminder'; reminderId: string; date: string; time: string }
| { action: 'delete-reminder'; reminderId: string }
// 事件（P1）
| { action: 'delete-event'; eventId: string }
| { action: 'restore-event'; eventId: string }
| { action: 'archive-event'; eventId: string }
```

## 2. `submitIntent` 映射（seam-owner 负责）

| intent.action | 调用（在 submitIntent 参数里已有这些 action 包） | 备注 |
|---|---|---|
| `trash-task` | `actions.remove(intent.taskId)` | 软删除 |
| `restore-task` | `actions.restore(intent.taskId)` → boolean；false ⇒ `{ok:false,reason:'not-found'}` | |
| `archive-task` | `actions.setAbandoned(intent.taskId, true)` | |
| `unarchive-task` | `actions.setAbandoned(intent.taskId, false)` | |
| `move-task` | 先验 projectId 存在（若给定）；`actions.moveToProject(intent.taskId, intent.projectId)` | |
| `uncomplete-task` | `actions.setCompleted(intent.taskId, false)` | |
| `rename-project` | `projectActions.renameProject(intent.projectId, intent.name)` | 名字空 ⇒ invalid |
| `archive-project` | `projectActions.archiveProject(intent.projectId, intent.archived ?? true)` | |
| `delete-project` | `projectActions.removeProject(intent.projectId)` | |
| `rename-tag` | `projectActions.renameTag(intent.tagId, intent.name)` | |
| `delete-tag` | `projectActions.removeTag(intent.tagId)` | |
| `delete-note` | `noteActions.removeNote(intent.noteId)` | |
| `restore-note` | `noteActions.restoreNote(intent.noteId)` → boolean | |
| `move-note` | `noteActions.setNoteProject(intent.noteId, intent.projectId ?? null)` | |
| `update-reminder` | 先验存在；用 `localDateTimeToEpoch(date+"T"+time)` 换算成 epoch 后 `reminderActions.rescheduleReminder(intent.reminderId, epoch)` | 与 create-reminder 同口径（收 date+time，换算在宿主） |
| `delete-reminder` | `reminderActions.removeReminder(intent.reminderId)` | |
| `delete-event` | `eventActions.removeEvent(intent.eventId)` | |
| `restore-event` | `eventActions.restoreEvent(intent.eventId)` → boolean | |
| `archive-event` | `eventActions.archiveEvent(intent.eventId)` | |

存在性校验照既有 `submitIntent` 的写法（读 `ctx.getState()` 里的 `tasks/projects/tags/notes/reminders/events`，墓碑 `deletedAt` 视为不存在；缺失 ⇒ `{ok:false, reason:'not-found', message:'…'}`）。**不重写领域规则**，只挡"不存在的东西"。

## 3. 工具清单（各实体子 Agent 负责自己的文件）

每个工具要有：`LOCAL_API_TOOLS` 里一条（name/egressFields（写工具为 `[]`）/description/kind:'write'/risk/defaultEnabled:false）、`SCHEMAS[name]` 参数、`toIntent` 的 case（严格白名单参数、类型校验，错误走 `{ok:false,message}`）。

### task.ts（subagent: task-tools）
| 工具 | 参数 | intent | risk |
|---|---|---|---|
| `trash_task` | `taskId:string` | trash-task | destructive-reversible |
| `restore_task` | `taskId:string` | restore-task | write |
| `archive_task` | `taskId:string` | archive-task | destructive-reversible |
| `unarchive_task` | `taskId:string` | unarchive-task | destructive-reversible |
| `move_task` | `taskId:string, projectId?:string` | move-task | destructive-reversible |
| `uncomplete_task` | `taskId:string` | uncomplete-task | write |

### project.ts / tag.ts（subagent: project-tag-tools）
| 工具 | 参数 | intent | risk |
|---|---|---|---|
| `rename_project` | `projectId:string, name:string` | rename-project | write |
| `archive_project` | `projectId:string, archived?:boolean` | archive-project | destructive-reversible |
| `delete_project` | `projectId:string` | delete-project | destructive-reversible |
| `rename_tag` | `tagId:string, name:string` | rename-tag | write |
| `delete_tag` | `tagId:string` | delete-tag | destructive-reversible |

### note.ts / reminder.ts / event.ts（subagent: note-reminder-event-tools）
| 工具 | 参数 | intent | risk |
|---|---|---|---|
| `delete_note` | `noteId:string` | delete-note | destructive-reversible |
| `restore_note` | `noteId:string` | restore-note | write |
| `move_note` | `noteId:string, projectId?:string` | move-note | write |
| `update_reminder` | `reminderId:string, date:string(YYYY-MM-DD), time:string(HH:MM)` | update-reminder | write |
| `delete_reminder` | `reminderId:string` | delete-reminder | destructive-reversible |
| `delete_event` | `eventId:string` | delete-event | destructive-reversible |
| `restore_event` | `eventId:string` | restore-event | write |
| `archive_event` | `eventId:string` | archive-event | destructive-reversible |

> 新增工具后，`tests/tool-pack-coverage.spec.ts` 会遍历整份目录逐个驱动；漏 `toIntent` 认领会红。各子 Agent 需自建本实体工具的单测（正确路径 + 参数白名单拒绝）。

## 4. 完成判据
- 每个新工具：`toIntent` 能产出对应 intent；参数越界被拒；写工具 `egressFields: []`。
- seam-owner：`LocalApiWriteIntent` 联合与 `submitIntent` switch 逐条覆盖，`local-api-host` 单测驱动每条新动作落到对应 action（可用假 action 桩）。
- `pnpm --filter @heyta/local-api test`、`--filter @heyta/app-host test`、`check:ai-tools` 绿。
- `npx tsc --noEmit` 相关包 0 错。
