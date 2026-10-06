# ADR-0046：向量时钟无损保存与签名因果前沿

> 状态：**已接受**
> 日期：2026-10-03
> 取代：[ADR-0008](0008-vector-clock-limit.md)

## 背景

ADR-0008 把向量时钟上限从 20 提到 100，但 top-K 裁剪仍会删除
`clientId` 维度。设备保存了裁剪后的时钟后，下一次离线写入可能被服务端
判成并发并永久拒绝。A1 的 100/101 实测证明这是真实的协议故障：它不是
“设备太多时性能变慢”，而是因果历史被静默改写。

## 候选方案

| 方案 | 结论与依据 |
| --- | --- |
| 提高 top-K 上限、按活跃度删除维度 | 否决。100/101 的可执行反例证明：活跃度不是因果稳定性的证明，提高阈值只推迟相同故障。 |
| 完整持久化 + 服务端签名前沿 delta | 采用。展开后的时钟与原时钟逐项相等，保留现有向量比较语义；缺少证明时可回退完整表示。 |
| epoch 分段与设备退役 | 本轮不采用。需要定义离线设备跨 epoch 的加入、旧操作处理及退役确认；当前没有成员关系协议，不能用超时替代确认。它可作为未来突破维度资源上限的独立设计。 |
| Interval Tree Clocks | 本轮不迁移。需要改变身份分配、时钟代数和线协议，并重新证明与现有 op-log 冲突裁决的组合性质；也不能从已经丢键的旧时钟推断缺失历史。当前无损前沿方案不要求替换 vendored 比较算法。 |

这里选择的是**无损表示压缩**，并未证明可以永久遗忘设备身份。4096 维度的
资源边界仍然存在，不能把本方案描述成无界设备成员治理。

## 决策

1. **生产路径保存完整时钟。** `OpLogEngine` 的合并、恢复、远端前沿和
   存储都保留全部维度；服务端在接受时钟后也完整落库。旧的
   `limitVectorClockSize` 只保留给兼容代码和历史故障测试，生产写入、下载
   前沿和冲突判定不再调用它。
2. **资源保护只做显式拒绝。** 服务端接受最多 4096 个合法维度；超过上限
   返回 `INVALID_VECTOR_CLOCK`，不删除任何键。4096 是输入资源上限，不是
   比较或持久化的裁剪上限。
3. **压缩必须有可验证的稳定前沿。** 服务端签发绑定账号、快照序号和完整
   时钟的 HMAC 前沿 token。协商到 `causalFrontierDelta` 且操作时钟支配该
   前沿时，客户端才发送 `frontier-delta`；服务端验签、验账号、验序号和
   delta 边界后展开并以完整时钟存储。旧客户端、缺少 token 或验证失败时
   回退完整时钟。
4. **服务端观察到的前沿独立持久化。** 客户端把仅由快照响应提供的
   `snapshotVectorClock` 以 component-wise max 写入独立 META，再推进下载游标。
   它不能与可丢弃的 materialized checkpoint 混用。
5. **客户端维护只生成并消费版本化 Heyta snapshot。** `engine.createSyncCheckpoint()` 生成
   `REPAIR`，payload 必须是 `HeytaFullStatePayload`（含 `heytaStateVersion`
   和 `repairBaseServerSeq`），并保留字段/实体版本前沿。服务端要求该 base
   仍是最新序列，失败以 `REPAIR_STALE` 拒绝，不删除新写入，也不无限重试。
   `REPAIR` 单独上传，重试按 op 身份幂等返回原序号。
   服务端无法读取 E2EE 内容；载荷完整性由客户端验证，序列证明不替代内容验证。
6. **旧快照形状不假装兼容。** 上游 NgRx snapshot 不是 heyta 的生产调用
   形状，无法无损映射到 heyta 的字段版本和墓碑元数据。缺少 heyta 版本化
   marker、损坏或无法解密的全量操作不会被当成已消费；应用失败时下载游标
   不推进。`engine.importOperations()` 也在落盘前验证全量 payload。存量裁剪
   时钟不凭空“自愈”：只能由完整 op 流或明确的迁移/导入恢复。

## 判据与证据

- `packages/op-log/tests/engine.spec.ts`：101 个 clientId 经远端合并、下一次
  本地写入和重启仍完整存在。
- `server/tests/integration/causal-frontier-http.integration.spec.ts`：真实
  HTTP + PostgreSQL 验证 101 维度签名前沿、delta 展开、幂等重试、篡改/跨账号
  /低计数拒绝，以及完整保存 4096、显式拒绝 4097。
- `packages/sync-client/tests/sync.spec.ts`：快照只有
  `snapshotVectorClock` 时也会先持久化前沿；部分解密失败或 `gapDetected`
  会持久化不可完整历史标记。
- `scripts/mutate-op-log-semantics.mjs`：删除 clientId 决胜、前沿支配关系或
  durable frontier 判据时，测试报告必须出现真实失败测试。
- A1 的旧 100/101 裁剪结果保留在
  [vector-clock-a1-evidence.md](../research/vector-clock-a1-evidence.md)，作为
  历史基线，不是当前生产行为。

## 后果

时钟大小会随设备维度增长；达到 4097 个维度时系统可诊断地拒绝请求，避免
用静默丢因果信息换取短暂的载荷上限。稳定前沿 delta 可以减少重复载荷，但
任何一方无法证明前沿时都必须使用完整时钟。
签名前沿 token 限制为 65536 字符；超过时不签发 token，仍走完整时钟，
不能为了压缩率裁剪 token 中的因果信息。

`createSyncCheckpoint()` 是显式维护 API，没有自动 timer；本地 materialized
checkpoint 的自动 cadence 只是启动加速，不会自动向服务端声明可物理压实的
同步边界。

本 ADR 的实现、真实 HTTP/PostgreSQL、Hermes、全仓门禁与四端当前产物收尾证据
已汇总在 [AED 实施证据](../research/aed-implementation-evidence.md)。
