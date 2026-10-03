# A1：向量时钟 100/101 故障与存量自愈证据

> 状态：**阶段证据与 Android Hermes 实测已完成；最终全仓验收待补**
> 日期：2026-10-03

## 结论先行

100/101 的旧故障已经被代码修复：生产客户端、服务端存储和下载前沿均不再
top-K 裁剪，服务端改为最多 4096 条时钟、超限显式拒绝。本文保留的“101
丢一键、无法自动长回来”是 **ADR-0008 时代的历史基线**，用于证明为什么
不能把改上限当成存量修复；它不是当前生产路径的描述。

## 历史基线

旧测试 `vector-clock-trim.spec.ts` 和 `vector-clock-a1.spec.ts` 固定了以下
故障形状：完整的 101 维时钟经过 `limitVectorClockSize` 后只剩 100 维；再把
服务端当时返回的 bounded snapshot clock 合并回去，仍无法恢复缺失键。真实
HTTP + PostgreSQL 对照也复现了：一条带完整 101 维时钟的历史写入成功，另一
台设备用缺一维的 100 维时钟写同一实体得到 `CONFLICT_CONCURRENT`。

体积探针 `node research/tools/measure-vector-clock-a1.mjs` 给出当前 JSON
形状的单字段大小：短 ID（6 字符）100 条约 1,101 B、101 条约 1,112 B；合法
最长 ID（255 字符）100 条约 26,001 B、101 条约 26,261 B。它支持显式资源
上限，但不支持无界时钟。

## 当前修复与存量边界

- `OpLogEngine.trimClock()` 保留完整时钟；`getClock()`、恢复和下一条本地
  op 都不会丢维度。
- 服务端 `sanitizeVectorClock()` 完整接受 4096 条，4097 条返回
  `INVALID_VECTOR_CLOCK`。
- 服务端下载同时提供兼容的 `snapshotVectorClock` 和完整签名
  `causalFrontier`；客户端在推进游标前持久化前沿，下一条写入会继承它。
- 因果前沿 delta 只有在 token、账号、序号和支配关系都验证通过后才展开；
  存储中仍是完整 clock。
- 已裁剪的旧磁盘数据不能凭空恢复缺失键。能否自愈取决于服务端是否仍保留
  完整 op/快照或是否有明确的迁移、导入路径；当前实现不把 bounded 响应冒充
  为完整历史。

因此，A1 的“存量自动自愈”结论是：**旧实现不能自愈；当前实现对新写入不再
制造该损坏，但不承诺从已损坏时钟推断缺失因果。**

## 运行时可见性

`pnpm verify:mobile-aed` 已在 Android arm64 真 Hermes + op-sqlite 上运行：
101 个 peer 时钟维度关库重开后逐项保留；checkpoint 覆盖 101 条，重启只重放
1 条尾部。旧 helper 的真实库 warning 进入 `ReactNativeJS` logcat，脚本要求
同时出现库 warning 与 `PROBE_PASS` 才通过。证据见
[Hermes 日志摘要](../../apps/mobile/evidence/hermes-aed-latest.txt)。这是 Android
运行时证据，不宣称 iOS 日志验证。生产写路径已不调用这个有损 helper。

## 可重复证据

- 单测：`packages/sync-core/tests/vector-clock-a1.spec.ts`、
  `packages/op-log/tests/engine.spec.ts`。
- 真实 frontier：`server/tests/integration/causal-frontier-http.integration.spec.ts`。
- 真实服务端 P1：`/tmp/heyta-aed-p1-final.log`，12 条通过；其中包括受害时钟经
  完整源产生 REPAIR，受损目标通过共享 app-host wiring 接收、重启后保留
  丢失维度，下一条写入被服务端接受。
- 变异门禁：`scripts/mutate-op-log-semantics.mjs` 会在删除前沿支配判据时
  产生真实失败测试。
