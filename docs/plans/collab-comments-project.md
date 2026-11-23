# 协作（指派 / 清单共享）与评论 —— 立项方案

## 结论
- 协作与评论是**产品级大项**，依赖真实服务端 share（共享清单、成员名册、权限三档、密钥分发、多用户同步），需**单独立项**，不在「AI 工具层补齐」范围内硬做。
- AI 工具 `set_task_assignee`、评论 `add/list/delete_task_comment` **只有在真实成员与 share 会话就位后才有意义**。当前「个人 op-log 单入口」不能安全承载评论（评论走 share 通道，加密+逐 op 签名+上行）。

## 现状约束（事实）
- `Task.assigneeUserId?` 字段已存在，但全仓**零写点**；被 `packages/ui/tests/notification-model.spec.ts` 的**双向哨兵**隔离：任何非声明、非注释行只要出现该字段即计为写点并断言为 0。这是有意边界——落地指派必须先恢复「任务提醒」通知档位，并新写 ADR 重开 `ADR-0062` 实施记录 #1（该记录现为「四档不实现」）。
- 评论 `CommentActions` 写入**只走** `dispatchShareOp(shareId,intent)`，仅共享清单可用，个人清单抛 `ListNotSharedError(code:'list-not-shared')`；构造需 `currentUserId`，dispatch 需 `isSignedIn/cipherFor/signerFor/api/clientId/storage` 一整套 share 会话。CLI / MCP / agent-cloud 宿主**无登录态**。

## 分期
- **P1 真实 share 基础设施**（后端+产品）：`server/` shares 端点族、成员名册/邀请、权限三档（owner/editor/commenter/viewer）硬门、密钥分发与 rekey、多用户同步。
- **P2 端壳 share 会话与 UI**：Web/移动 `ShareSpaceScreen` 等接入 share 会话（登录态 + share op 通道）。
- **P3 指派**：`TaskDetailsPatch` 增 `assigneeUserId`（设置/清除写 null，一意图一 op）；恢复通知「任务提醒」档；新写 ADR 调整 ADR-0062 实施记录 #1；再补 `set_task_assignee` 工具。
- **P4 评论工具**：新增**share 感知的独立工具通道**（区别于个人 `LocalApiWriteIntent`/`submit`），由端壳注入 `CommentActions`；仅已登录的 web/mobile 可用，CLI/MCP 明确回「当前宿主无共享会话」；撤销 `AI-COV-8` 缺口、同步 `ai-event-tool-contract.md §5.1`。

## 授权决策点（待产品拍板）
- **A**：批准「恢复通知『任务提醒』档 + 新写 ADR 调整 ADR-0062」以解锁**指派**。
- **B**：批准「新增 share 感知独立工具通道」以解锁**评论**。
- 两者可实现清单分别见下「附录」。

## 验收口径
- 指派：单条 `UPD` op；通知档恢复且消费者就位；ADR 更新。
- 评论：仅共享清单可写、个人清单**零 op**；`ListNotSharedError → { ok:false, reason:'invalid', message:'评论只存在于共享清单' }`。
- 真实 share：端点 + ACL 硬门 + 密钥分发 + 多用户同步 + 端到端验收。

## 附录 · 可实现清单（获授权后照此落地）
### 指派
1. `packages/app-host/src/actions.ts`：`TaskDetailsPatch` 增 `assigneeUserId?: string`，`patchDetails` 处理设置/清除（清除写 `null`）→ 一条 `UPD`。
2. `packages/local-api/src/tools/shared.ts`：`LocalApiWriteIntent` 增 `{ action:'set-task-assignee'; taskId:string; assigneeUserId?:string }`。
3. `packages/local-api/src/tools/task.ts`：增 `set_task_assignee`（write/write，描述「仅共享清单内有意义」）+ schema + toIntent。
4. `packages/app-host/src/local-api-host.ts`：`submit` 增 `case 'set-task-assignee'`。
5. 前置：恢复通知档 + 新 ADR；reducer 无需改（UPD 泛化物化已支持）。
### 评论
- 执行层调 `commentActions.addComment/editComment/removeComment`，捕获 `ListNotSharedError` 译成 `{ok:false,reason:'invalid',message:'评论只存在于共享清单'}`，本地清单零 op；写入只经 share 通道。
