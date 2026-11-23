# ADR-0088：恢复「任务提醒」通知档并解禁 `Task.assigneeUserId` 写点（仍不做真实多用户后端）

> 状态：**已接受**（产品负责人 2026-11-23 授权：「恢复通知『任务提醒』档 + 新写一份 ADR 调整 ADR-0062 实施记录 #1」以解锁任务指派）。
> 相关：[ADR-0062](0062-shared-list-key-distribution.md)（决策 7 的偏好清单、实施记录 #1）。本 ADR 只增加规则，不改 ADR-0062 任何一条裁决的原文。

## 背景

- ADR-0062 决策 7 把通知偏好分成三族：三档活动通知、**四档任务提醒**、自动接受已知合作者。四档任务提醒判的是 `Task.assigneeUserId`。
- `Task.assigneeUserId?: string` 早在 `packages/domain/src/entities.ts` 就有声明（语义 = **共享清单内指派的成员 id**，个人任务缺席 = 未指派；值在加密 payload 里，服务端读不到）。但它**全仓零写点**——没有任何一处把这个字段写进 op。
- 因此 [ADR-0062 实施记录 #1](0062-shared-list-key-distribution.md) 记下「四档任务提醒不实现」：四档摆在一起行为逐字相同，界面等于在撒谎。当时的判据与"四档不实现"结案都建立在一个前提上：**该字段零写点**。
- 2026-11-23 产品负责人批准「恢复任务提醒档 + 调整实施记录 #1」，目标是把「在共享清单里指派任务给某成员」做成一条真实的写入通道，从而让这一档通知有真实输入。

## 决定

1. **恢复「任务提醒」通知档（按原设计）**：`packages/ui/src/sync/notification-model.ts` 重新提供
   `TaskReminderScope = 'all' | 'allExceptAssignedToOthers' | 'assignedToMe' | 'none'`，
   `ShareNotificationPrefs.taskScope` 默认 `'assignedToMe'`，并恢复纯判定 `shouldNotifyTaskReminder(prefs, task, myUserId)`。
   「自己改自己的任务永远不响」「指派给他人的除外」两条语义照原设计保留。
   偏好仍**存本地、服务端零知识**（ADR-0062 决策 7 / ADR-0071）：服务端只发信号，响不响由本机偏好定。

2. **解禁 `Task.assigneeUserId` 写点——边界是硬的**：
   - 唯一写入通道是**一个本地 API 工具** `set_task_assignee`（`kind:'write'`、`risk:'write'`），
     经 `packages/app-host` 的 `patchDetails` 产生**一条 `UPD` op**，落在既有 `TASK` 实体的 op-log 里。
     op-log 仍是唯一写入口；reducer 对 `UPD` payload 逐键泛化物化，**无需改 reducer**。
   - `patchDetails` 语义：`assigneeUserId` 存在即设/清——字符串 = 指派给该成员 id；`null` = 清除（空缺 = 未指派）。
   - **不做**真实多用户后端：不加服务端成员校验 / ACL / 端点 / 表；不 bump `CURRENT_SCHEMA_VERSION`、不新增迁移；无 purge；不碰 `server/`。
     这个字段只在"共享清单里指派给某个已知成员 id"这一语义下有意义，写入本身不校验对方是否存在——那是协作后端那一层的职责，本轮不在范围内。
   - 不做任务级共享、不做自动接受已知合作者。

3. **对 ADR-0062 实施记录 #1 的调整**：记录 #1「四档不实现」的**事实前提**（`assigneeUserId` 全仓零写点）**已不成立**。
   按本仓「ADR 只增不改、结论变更新写一份」的纪律，**#1 原文保留为历史**，其"四档不实现"的结论**由本 ADR 调整**为：
   任务提醒档**已实现**（四档 + 默认 `assignedToMe`）。同一记录里"两类信号 / 服务端零知识"等其余事实不受影响。
   ⚠️ 记录 #1 相邻的 #8（自动接受邀请按"撤下"结案）**不变**：`autoAcceptKnownCollaborators` 仍不恢复——它的前提"合作者名单"仍不存在，且落地要先过 ADR-0071 的同意闸（自动加入 = 绕过同意面），属要另立 ADR 的口径变更。

4. **双向哨兵按新事实重钉（不是删、不是放宽）**：`packages/ui/tests/notification-model.spec.ts` 里那枚 `assignmentWriteSites()`
   原本断言"零写点"，并约定「谁给任务加了指派写点…那一天真落地时这一档必须回来」。本轮既然落地，哨兵改为：
   写点**预期存在**、`taskScope` 档**预期在**、且写点落到的**文件集合恰为白名单那几处**；
   条件臂仍证明「写点>0 而偏好缺档 ⇒ gap 成立」这一反向逻辑有牙。旧 `toBe(0)` 若不改会永远红——改的是**期望**，因为它测的产品行为确实变了。

## 为什么现在做（用户价值优先）

依 [AGENTS.md §0.1](../../AGENTS.md)：判"做不做"的只有用户价值。共享清单里"把任务指派给某人、并按指派提醒我"是一条用户要用的功能；
"不做真实多用户后端"是**本轮范围边界**（怎么做的约束），不是"因为这个功能不能做"。所以本轮解禁字段写点 + 恢复通知档 + 登记 ADR，
把前端/本地能力做成真的，后端协作能力留作后续独立决策。

## 后果

- 偏好模型里「任务提醒」重新成为**有输入**的一档（不再是空壳）；`autoAcceptKnownCollaborators` 仍缺。
- 指派写入成为 op-log 里一条普通 `UPD` op，随既有同步通道走；值在加密 payload 内，服务端不可见。
- 本地 API / AI 工具目录 TASK 增 1 席（在既有每实体 32 席预算内，不抬上限），并在 web/mobile 有对应的中文/英文人话回执。
- 未做（明确边界）：真实多用户协作与 ACL、服务端成员校验、任务级共享、自动接受合作者、指派字段的服务端可见性。

## 验证

- `packages/ui/tests/notification-model.spec.ts`：默认偏好恰好 `activities + taskScope`；写点存在、写点文件集合恰为白名单、档位在、反向条件臂仍红。
- `packages/local-api/tests/task-tools-batch8.spec.ts`：`set_task_assignee` 目录形状 + `toIntent`（设 / 清 / 裁剪 / 白名单 / 类型拒）。
- `packages/app-host/tests/local-api-host-batch4.spec.ts`「任务指派」组：设置 → `patchDetails(taskId,{assigneeUserId})`；空串/缺省 → `{assigneeUserId:null}`；not-found；抛错 → invalid。
- `packages/app-host/tests/ai-tool-proposal-all-writes.spec.ts`：`set_task_assignee` 走提案三腿（清单必须跟着目录走）。
- 门禁：`check-ai-tools`（能力清单与目录一致）、`check-ai-coverage`（实体读写覆盖与每实体预算）、`gen-ai-capability-manifest`、`check:i18n-vars`。
