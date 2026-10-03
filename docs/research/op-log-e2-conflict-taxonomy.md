# E2：冲突分类学与跨层判据

> 状态：**已实现并由客户端/服务端共享测试约束**
> 日期：2026-10-03

同步先判断向量关系，再进入 LWW、可交换增量或人工解决。协议分类不能和产品
层的“最后显示谁”混为一谈。

## 协议分类

| 分类 | 向量关系 | 服务端结果 | 客户端含义 |
| --- | --- | --- | --- |
| `causal-successor` | incoming `GREATER_THAN` existing | 接受 | 正常后继，不进入冲突面板 |
| `retry` | clock `EQUAL` 且 op/client 身份一致 | 幂等接受，返回原序号 | 标记原 op 已上传 |
| `equal-different-client` | clock `EQUAL`、clientId 不同 | `CONFLICT_CONCURRENT` | 证据不足，保守进入冲突处理 |
| `concurrent` | 时钟无序 | `CONFLICT_CONCURRENT`；计时增量除外 | 才是并发候选，交给 LWW/人工策略 |
| `superseded` | incoming `LESS_THAN` existing | `CONFLICT_SUPERSEDED` | 原待上传 op 不再重试；日志和诊断仍保留 |

`TASK_TIME_DELTA_ACTION_TYPE` 是明确的可交换例外：并发增量都能落库，因为
它们是加法贡献，不是互相覆盖的实体快照。其他 op 不能把“服务端接受”误读成
“产品层某一个版本必胜”。

## 共享实现与证据

`packages/sync-core/src/conflict-classification.ts` 提供客户端、服务端和测试
共用的 `classifyOperationRelation`；`packages/sync-core/tests/conflict-classification.spec.ts`
覆盖五类关系和 equal-clock 跨 client 保护。服务端
`server/tests/conflict-detection.spec.ts` 覆盖真实上传形状、错误码、
`existingClock`、重复幂等和计时增量例外；reducer 测试覆盖删除、同毫秒
clientId 决胜、创建/更新交换后的收敛。

## A/D 的边界

- checkpoint 恢复不能把“服务端已知 clock”当成“每个 op 已应用”；必须恢复
  `appliedOpIds`、pendingApply 和版本 metadata。
- 本地收到全量 REPAIR 时合并版本前沿，保留本地离线并发编辑；不能把 snapshot
  当成无条件覆盖。
- `superseded` 不是物理删除授权。服务端历史只有在带有效 base 的 causal
  REPAIR 通过数据库锁内检查后，才可由 quota cleanup 物理 drain。
- 上游 NgRx snapshot 没有 heyta 的版本化 payload 和生产调用链。无法无损解析
  时，应用失败并保持下载游标；不能为了兼容而跳过它。
