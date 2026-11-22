# 工具层补全 —— 批次 2 精确契约（层级移动 / 批量删除恢复 / 排序）

> 2026-11-22 第二批。承接 `2026-11-22-tool-layer-p0-p1-contract.md`。铁律不变（只产出 LocalApiWriteIntent、全走 op-log、删除=软删除可逆、不建 purge、不改 schema/线协议/AGENTS/ADR、只改自己文件）。

## 1. 新增 `LocalApiWriteIntent` 成员（seam-owner 负责）
```ts
// 任务层级 / 批量 / 排序（P2）
| { action: 'set-task-parent'; taskId: string; parentId?: string }
| { action: 'trash-tasks'; taskIds: readonly string[] }
| { action: 'restore-tasks'; taskIds: readonly string[] }
| { action: 'reorder-task'; taskId: string; order: number }
// 清单层级 / 恢复
| { action: 'move-project'; projectId: string; parentId?: string }
| { action: 'restore-project'; projectId: string }
```

## 2. `submitIntent` 映射（seam-owner 负责）
| intent.action | 实现 |
|---|---|
| `set-task-parent` | 先验 taskId 存在；`try { await actions.setParent(taskId, parentId) } catch(e){ return {ok:false,reason:'invalid',message: e.message} }`（`setParent` 对环/超深**同步 throw**，必须 try/catch 翻成人话） |
| `trash-tasks` | `taskIds` 非空数组；`await actions.bulkRemove(taskIds)` |
| `restore-tasks` | `taskIds` 非空数组；`await actions.bulkRestore(taskIds)` |
| `reorder-task` | 先验存在；`Number.isFinite(order)`；`await actions.setOrder(taskId, order)` |
| `move-project` | 先验 projectId 存在；`try { await projectActions.setParent(projectId, parentId) } catch → invalid` |
| `restore-project` | `const ok = await projectActions.restoreProject(projectId)`；`false ⇒ {ok:false,reason:'not-found'}` |

存在性校验照既有写法（读 `ctx.getState()`，墓碑 `deletedAt` 视为不存在）。返回值形状沿用既有（任务回 `{ok:true,taskId}`；项目回 `{ok:true,entityId,entityType:'PROJECT'}`）。

## 3. 工具（各实体子 Agent 负责自己文件）
### task.ts（subagent: task-tools2）
| 工具 | 参数 | intent | risk |
|---|---|---|---|
| `set_task_parent` | `taskId:string, parentId?:string` | set-task-parent | write |
| `trash_tasks` | `taskIds:string[]（≥1）` | trash-tasks | destructive-reversible |
| `restore_tasks` | `taskIds:string[]（≥1）` | restore-tasks | write |
| `reorder_task` | `taskId:string, order:number` | reorder-task | write |

### project.ts（subagent: project-tools2）
| 工具 | 参数 | intent | risk |
|---|---|---|---|
| `move_project` | `projectId:string, parentId?:string` | move-project | write |
| `restore_project` | `projectId:string` | restore-project | write |

每个工具：`LOCAL_API_TOOLS` 一条（egressFields:[]、description、kind:'write'、risk、defaultEnabled:false）+ `SCHEMAS` + `toIntent` case（严格白名单 + 类型校验）。
- `parentId` 省略 = 提为顶级（intent 不带该键）。
- `trash_tasks`/`restore_tasks` 的 `taskIds` 必须非空字符串数组（去重可选；越界拒绝）。
- `reorder_task` 的 `order` 必须有限数。

## 4. 完成判据
- 每工具 toIntent 正常 + 未知参数拒绝 + 缺必填拒绝；`setParent` 环/超深经宿主翻成 invalid。
- local-api / app-host 相关测试绿；tsc 0 错。
