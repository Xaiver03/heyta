# E1：op-log 同步语义可执行规格

> 状态：**已实现并由 property / 变异测试约束**
> 日期：2026-10-03

这份规格是 A 的因果历史治理和 D 的 checkpoint 水合的共同前置。它描述
heyta 的 reducer 语义，不把上游 NgRx 的实现细节当作可直接拷贝的协议。

## 状态模型

- 一个用户意图生成一条 op；多实体作用域用同一条 op 的 `entityIds` 表达。
- `appliedOpIds` 是具体 op 的幂等闸门，聚合 clock 不能代替它。
- 实体保存实体级版本和字段级版本；版本包含 clock、时间戳、clientId、opId。
- 先按向量关系淘汰被因果支配的版本，再在并发最大集合中用
  `timestamp + clientId` 确定性决胜；同 client 或 legacy 缺 clientId 时最后用
  `opId` 稳定排序。
- 删除是字段级墓碑。墓碑可先于创建到达，不能被因果旧写入清除；可见性由
  `deletedAt` 派生，内容仍保留给回收、恢复和导出语义。
- 全量状态不是无版本实体 JSON。版本化 `HeytaFullStatePayload` 会合并实体/
  字段版本，并拒绝超过 REPAIR 因果边界的 metadata；本地并发版本必须保留。

## 不变量与证据

| 不变量 | 可执行证据 |
| --- | --- |
| 合法因果图按不同到达顺序收敛 | `packages/op-log/tests/semantic-invariants.spec.ts`：确定性 PRNG 图、多个投递顺序 |
| 同一 opId 重放幂等 | `packages/op-log/tests/engine.spec.ts`、remote retry 测试 |
| 因果更新不被墙上时间击败 | 同毫秒、时钟回拨和因果旧写入测试 |
| 并发决胜确定 | timestamp/clientId 相反顺序测试与生成式场景 |
| 删除不复活 | 删除先到、创建后到及旧字段清除测试 |
| 未见过的因果前驱不丢失 | semantic invariant 的 `{remote: 2}` 后 `{remote: 1}` 场景 |
| checkpoint 不跨未应用空洞 | `packages/op-log/tests/checkpoint-recovery.spec.ts` |
| 不完整历史不能授权压实 | `packages/op-log/tests/full-state-recovery.spec.ts` |

`scripts/mutate-op-log-semantics.mjs` 先验证绿色基线，再分别突变 clientId
决胜、墓碑、未见前驱、frontier dominance、checkpoint 空洞、全量快照水合、
durable frontier、incomplete-history guard，以及维护不得发布本地专属历史
这九类行为；每个突变都必须让测试报告包含失败断言。

## 对 A/D 的硬约束

1. 向量压缩只能在可验证稳定前沿上进行；没有 frontier 时必须保留完整 clock。
2. checkpoint 必须序列化版本元数据、墓碑和完整 clock，不能只存当前实体 JSON。
3. 服务端已知 clock 不等于每个 op 都已重放；不能用它绕过 `appliedOpIds` 或
   pendingApply。
4. 远端回放和快照应用不能再次触发用户副作用；压实 REPAIR 只能由显式维护
   API 生成，且不允许对历史不完整、队列未排空或仍含未物化实体的设备授权。
   snapshot 反序列化遇到未知 bucket 必须拒绝，不能把新实体当作空状态丢掉。
