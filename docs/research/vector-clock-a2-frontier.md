# A2/A3：稳定前沿、持久观察与安全压缩

> 状态：**实现与真实链路证据已完成；最终仓库/多端门禁待补**
> 日期：2026-10-03

## A2 的安全规则

`compactVectorClockAgainstFrontier(clock, stableFrontier)` 只删除前沿中已有且
计数相等的维度；前沿缺少的键、操作高于前沿的键和调用方自己的 clientId
都会保留。操作时钟必须 `EQUAL` 或 `GREATER_THAN` 前沿，否则直接抛错。
这条支配关系不能省略：把低于前沿的离线旧操作展开到前沿，会凭空给它添加
因果依赖。

`expandVectorClockFromFrontier()` 只用于显式标记的 `frontier-delta`。没有签名
前沿时，v1 操作仍发送完整 clock；不能把压缩后的对象当作完整 v1 时钟发送，否则省略键会被错误地解释为零。

## A3 已启用的线协议

服务端在下载响应中返回完整 `causalFrontier` token，并声明
`capabilities.causalFrontierDelta=true`。客户端上传到独立的
`/api/sync/ops/causal` 路径；服务端验证 HMAC、账号绑定、快照序号、每个 delta
值和 4096 维度上限后才展开入库。旧服务端、不支持能力或验证失败时客户端清除
缓存 token 并用完整时钟重试。

下载时的 `snapshotVectorClock` 是兼容的快进元数据。它在成功消费本页之后、
游标推进之前写入独立 durable `observedClock`；即使本页没有可应用 op，下一条
本地写入也继承该前沿。持久化失败时不推进游标。`gapDetected` 或部分解密失败
会把 `historyIncomplete` 永久置为 true，禁止该设备生成服务端压实 snapshot。

## 真实证据

`server/tests/integration/causal-frontier-http.integration.spec.ts` 使用真实
TCP、认证路由和 PostgreSQL 覆盖：

- 101 维完整签名前沿的签发和下载；
- delta 展开后数据库保存 102 维完整时钟；
- 同一个 REPAIR/操作重试返回原 server sequence；
- 缺 token、篡改 token、跨账号 token、低于前沿计数均拒绝且不写库；
- 4096 条接受、4097 条明确返回 `INVALID_VECTOR_CLOCK`。

`/tmp/heyta-aed-http-final.log` 中的三份真实 HTTP + PostgreSQL 集成测试共 17
条通过；其中 checkpoint/drain 测试证明真实 REPAIR 与远端物理 drain 能一起
工作，并能在过期 base 时 fail-closed。

## 与旧实现的边界

A1 的 100/101 bounded snapshot 和自愈失败是旧协议基线；warning 的 Android
Hermes 可见性如今已实测。当前实现不能从裁剪后的磁盘本身推断丢失键，但可以
从仍完整的远端 op/版本化快照恢复它们，P1 已验证受损目标重启后的下一次写入
被服务端接受。新的合并、存储、前沿和后续写入均不再静默丢键。上游 NgRx snapshot 没有 heyta 生产调用链，也没有
heyta 的版本化字段/墓碑元数据，因此不能当作兼容快照；无法验证的全量操作不
得推进下载游标。
