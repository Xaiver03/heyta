# ADR-0047：可校验 checkpoint 驱动增量水合与安全压实边界

> 状态：**已接受**
> 日期：2026-10-03

## 1. 背景与约束

op-log 是唯一事实源。每次启动都从所有历史逐条重放虽然正确，但成本是
O(全历史)；只落盘当前实体又会丢字段版本、墓碑、幂等闸门和因果时钟。服务端
物理删除历史还需要一个能证明“完整前缀已被捕获”的同步边界。

## 2. 选择

| 方案 | 结论 | 原因 |
| --- | --- | --- |
| 每次启动全量重放 | 保留为正确性回退 | 正确，但移动端冷启动随历史线性变慢 |
| 把实体 JSON 当事实并删除 op | 否决 | 丢失字段级版本、墓碑和因果历史 |
| 带 checksum 的物化 checkpoint + 增量重放 | **采用** | 可校验、可失效、仍以 op-log 对账 |
| 直接用本地 checkpoint 授权服务端删历史 | 否决 | 本地缓存没有服务端序列证明，也可能缺历史 |

## 3. 本地实现

`MaterializedCheckpoint` 保存：

- `serializeMaterializedState()` 产生的所有物化桶；
- 实体级和字段级版本元数据（包括显式清除和删除墓碑）；
- 覆盖到的本地 `seq`、完整向量时钟和已应用 `opId` 集合；
- 格式版本与确定性 checksum。

启动先验证格式、checksum、`coveredSeq`、本地最后序号和 pendingApply
空洞。有效时只读取 checkpoint 之后的增量；读取失败、校验失败、覆盖范围有
未应用记录时把 checkpoint 当缓存未命中，回退到归档区与热区的完整日志重放。
`getAllOps`、`getOpsSince` 和 `getOpsForEntity` 都合并归档与热区。

`checkpoint()` 是本地物化缓存的显式入口；引擎还有按已应用记录数触发的最佳
努力自动写入（写失败只打印诊断，不能让已提交 op 失败）。这不等于同步压实：
`createSyncCheckpoint()` 是另一个显式 API，没有自动 timer。它只有在
`appliedSeq === lastLocalSeq`、没有 pending upload/apply 且历史完整时，才把
当前版本化状态写成一条 `REPAIR` op，并把已知服务端序号写入
`repairBaseServerSeq`。

普通维护不能把本地导入或被服务端永久拒绝的意图隐式发布出去，因此日志含
`source=import` 或被拒绝的普通 op 时也拒绝创建同步快照。用户明确恢复备份是
另一种意图，不由这个维护 API 代办。因 base 过期而被拒的旧维护 REPAIR 没有
新增实体意图，不触发这项限制。

维护扫描还会逐条检查日志里的实体类型。旧 reducer 若把未来但尚未物化的
实体留在日志中，`createSyncCheckpoint()` 会拒绝创建压实 snapshot，保留完整
日志等待能理解该实体的版本；这次扫描只发生在显式维护操作，不增加冷启动的
全量扫描成本。snapshot 反序列化同样拒绝未知 bucket，避免新实体被旧客户端
读入后静默丢失。

服务端返回 `gapDetected`、跳过部分无法解密的 delta，或其他证据表明历史不
完整时，客户端持久化单向 `historyIncomplete=true`。没有清除 API；在完整历史
重新建立前，后续 `REPAIR` 会 fail-closed。仅收到 snapshot 时钟也写进独立的
`observedClock`，删除本地 checkpoint 不会丢掉这项服务端因果事实。

## 4. 本地归档与服务端物理 drain

本地 `archiveUpTo()` 只是把已上传、已应用且被有效 checkpoint 覆盖的旧记录从
热区移到归档区；没有覆盖 cutoff 的有效 checkpoint 时拒绝归档。归档仍属于本地
日志，完整回退、导出和实体查询都能读到它。

本次服务端维护使用带版本化状态及 `repairBaseServerSeq` 的因果 `REPAIR`，
在数据库锁内证明 base 仍为最新之后，才能作为压实边界。真实
HTTP + PostgreSQL 测试验证了：服务端可以删除旧前缀，新设备从唯一 REPAIR
恢复，离线并发编辑仍存活；base 过期时拒绝并保留新写入。旧的无 base
`REPAIR` 不作为因果压实边界。上游 NgRx snapshot 在 heyta 客户端明确拒绝，
不推进本机游标。服务端看不到加密载荷，不能替客户端验证内容完整性；仍须信任
快照作者遵守协议，不能把服务端序列校验描述为对密文内容的验证。

## 5. 证据

- `packages/storage` 的六套存储契约覆盖 checkpoint、归档边界、归档/热区联合
  读取、独立 observedClock 和 sticky incomplete-history marker。
- `packages/op-log/tests/checkpoint-recovery.spec.ts` 覆盖并发 dispatch、未应用
  空洞、损坏 checkpoint、真实 SQLite 重开和归档后的完整回退。
- `packages/op-log/tests/full-state-recovery.spec.ts` 覆盖版本化 REPAIR、保留
  离线并发版本、重复投递、损坏 payload、未知 bucket、未物化实体、未排空队列
  和不完整历史拒绝。
- `server/tests/integration/checkpoint-drain-http.integration.spec.ts` 等三份真实
  HTTP + PostgreSQL 集成测试共 17 条通过，证据记录在
  `/tmp/heyta-aed-http-final.log`；它不是最终全仓门禁结果。
- `scripts/measure-hydration.mjs` 的 Node + 真实 SQLite 测量记录在
  `/tmp/heyta-aed-hydration-final.log`：100,000 条历史全量恢复 9.5672s，使用
  checkpoint 后只重放 100 条尾部约 30.9ms。该数据不能冒充移动端 Hermes
  性能结论。

实现与最终全仓/多端收尾结果见
[AED 实施证据](../research/aed-implementation-evidence.md)。
