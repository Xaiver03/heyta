# ADR-0016：读侧解不开的 op 跳过并上报，不再让设备永久卡死

> 状态：**已接受**
> 日期：2026-09-26
> 取代：无（是 **ADR-0009 的读侧对偶**；两者改的是同一类"一条坏 op 让设备永久卡死"）

## 1. 背景与约束

### 现象：第二台设备**永久**同步不了，而手机自己一切正常

`pnpm verify:mobile-ios` 第 5 步的跨设备探针（真 `node-host` + 真 SQLite 的"笔记本"）
连续 300 秒读不到手机刚写的任务，每轮输出都是：

```json
{"ok":false,"command":"sync","status":{"kind":"error","reason":"unexpected",
 "message":"The operation failed for an operation-specific reason","retryable":true}}
```

`The operation failed for an operation-specific reason` 是 WebCrypto 的 `OperationError`
—— **AES-GCM 认证失败**。逐条解密服务端上 `user:37` 的 9 条 op 之后，边界非常清楚：

```
seq 1..5   旧客户端（legacy 格式）    OK
seq 6,7    iOS 客户端  muhxicqi      FAIL  OperationError
seq 8,9    iOS 客户端  muhxicqi      OK
```

第 6、7 条是**同一台手机在更早一次会话里、用另一个口令**传上去的
（口令只存内存，重启就要重填 —— 中间那轮我手动填过一份不同的）。

### 机制：与 ADR-0009 完全同形，只是发生在读侧

```
download → Promise.all(ops.map(decodeServerOp))
           ↑ 一条抛 OperationError，整页作废
         → 抛在 setLastServerSeq **之前**
         → 游标永远不推进
         → 下次从同一位点开始，撞上同两条，再抛
```

三条后果，每一条都是产品问题：

1. **整页一条都应用不上** —— 同页那 7 条明明是好的；
2. **游标永不推进** —— 设备**永久**同步不了，不是"这次失败"；
3. **界面只说"同步失败"** —— 用户以为同步坏了，其实只是历史里混着两条读不了的。

而且它**只毒害别的设备**：客户端下载时会带 `excludeClient=<自己>`，
所以手机自己永远看不到自己那两条，界面显示「已是最新」——
**最容易被忽略的那种损坏：出问题的那台机器看起来最健康。**

### 硬约束

- **不能静默丢弃。** 解不开的 op 必须**可见**（否则就是无声的数据丢失，
  这正是 `decodeServerOp` 原注释在防的事）。
- **不能把"口令打错"也一起放过。** 整页一条都解不开时最常见的原因是**用户手滑**，
  那时推进游标 = 把整段历史静默跳过，**比卡死更糟**。
- 不改线协议字段，不 bump `CURRENT_SCHEMA_VERSION`，不新增持久化字段。
- `packages/sync-client/` 是自有包；`packages/sync-core/` 是 vendored（MIT）。

## 2. 选项

| 选项 | 优点 | 缺点 | 关键证据 |
|---|---|---|---|
| **A. 跳过 + 推进游标 + 结构化上报**（选中） | 设备不再永久卡死；能读的数据立刻可用；信息可见 | 读不了的 op 本机**拿不回来**了（重试也不会变好） | 笔记本修复后第 1 轮就读到了标题 |
| B. 保持抛错，但**不推进游标**、另存"已跳过"集合 | 换对口令后还能补回来 | 需要**新的持久化字段**（schema 纪律不允许顺手加）；且每轮都要重扫同一批 | — |
| C. 整页失败就跳过（无全失败守卫） | 代码最短 | **口令打错一次 = 静默跳过整段历史** | 变异测试：去掉守卫后 `expected 77 to be +0` |
| D. 静默跳过、不报 | 界面干净 | 无声的数据丢失；用户永远不知道有数据没过来 | 与 `decodeServerOp` 原注释直接冲突 |

## 3. 决策

采用 **A**，并把"口令打错"的守卫写进同一处：

- 逐条 `decodeServerOp`，**一条解不开不拖垮整页**；
- 解得开的**照常 `applyRemote`**；
- 解不开的**跳过**，并记下 `serverSeq:opId(errorName)`；
- **游标照常推进到 `latestSeq`**；
- 只要跳过了任何一条，`sync()` **不返回 `synced`**，而是
  `{kind:'error', reason:'undecryptable-ops', retryable:false, message:"<可定位清单>"}`；
- 🔴 **整页一条都解不开时改为抛错且不推进游标** —— 那是"口令不对"，
  不是"历史里混着别的口令"。

`retryable:false` 是刻意的：重试**永远不会**让这些 op 变得可读。

## 4. 后果

- `SyncFailureReason` 加了一个成员，两个壳**编译器强制**跟着改
  （`Record<Exclude<SyncFailureReason,'unexpected'>, MessageKey>` 穷尽），
  已同步加词条 `common.sync.error.undecryptableOps`（中/英）。
- 新增 3 条回归用例（`packages/sync-client/tests/sync.spec.ts`），
  并做过**变异验证**：还原"直接抛出"→ 混合页用例红；去掉全失败守卫 → 游标用例红。
- `scripts/lib/mobile-e2e.sh` 的探针判据同步放宽：`undecryptable-ops`
  表示**同步真的跑起来了**，不再被误判成"探针自己坏了"（rc=2）。
- **未做的部分（留给后续）**：读不回来的 op 目前**没有**找回路径。
  真要做需要一份 ADR 讨论"换口令后如何重放历史"，因为它涉及持久化字段与密钥世代。

## 5. 验收

- `pnpm --filter @heyta/sync-client test` → **59/59**（含新增 3 条）。
- 真服务端 + 真节点：修复前笔记本**永久**报 `unexpected`；修复后一轮内读到
  `iOS输入验收…`，并如实报出
  `6:muhxicqi-…-1(OperationError), 7:muhxicqi-…(OperationError)`。
- `bash scripts/verify-mobile-ios.sh` → **31 项通过 / 0 失败**，
  含"iOS → 服务端 → 另一台设备"全链路无 mock。

## 6. 补遗（2026-09-27）：同一形状还藏在**上传响应**的搭车路径里

本 ADR 只修了 `download()`。实测发现**写侧响应的搭车 op 走的是同一段没被保护的代码**：

```
upload → 服务端在同一个响应里搭车返回 newOps
       → await Promise.all(body.newOps.map(decodeServerOp))   ← 无保护
       → 一条抛错，整次同步作废
       → 抛在 sync() 的 **upload 阶段**，download() 根本没执行
```

现场（Android 模拟器 + 真服务端，`user:37`）：

- 手机上有 3 条待上传的 op → 上传**成功**（服务端确实收到，`PROJECT|CRT` 等落库），
  响应里搭车回了 14 条新 op，其中 2 条是换口令之前写的；
- 结果：本地库里**远端 op 数 = 0**，界面「同步失败 / `aes-gcm: invalid tag`」，
  且被 `sync()` 归成 `unexpected` + `retryable: true` —— 用户重试多少次都一样；
- 而**同一份代码在 Node 上完全正常**，因为它从干净数据库起、没有待上传的 op。
  `upload()` 开头就是 `if (pending.length === 0) return;` ——
  **没有待上传的 op 就永远走不到这一行**。

这条比读侧那处更隐蔽，因为它同时骗过了两种排查方式：

1. 用干净数据库复现 → 路径根本不会被走到，得出"解密没问题"的**错误结论**；
2. 在 Node 里模拟 Hermes（摘掉 `WebAssembly` 与 `crypto.subtle`）→ 依然是绿的，
   因为问题不在密码学，在**控制流**。

**修法与 §3 完全一致**（这也是本节的意义：判断只有一份策略）：

- 逐条解密，能读的 `applyRemote`、读不了的跳过并记入 `unreadableOps`；
- **不在这里另写一套"全失败"判断**：整批解不开时只做一件事 ——
  **不推进游标**，把区分（口令错 / 历史混着别的口令）交给紧随其后的 `download()`，
  它已经有 §3 那套策略。两套策略迟早会漂移，而漂移的冲突策略是最难查的一类 bug。

**因此游标推进的位置也随之移动**：从"上传成功就推进"改为
"上传成功 **且** 搭车 op 没有整批解不开时才推进"。

### 验收与变异

- `packages/sync-client/tests/sync.spec.ts` 新增 2 条：混合搭车页、整批解不开；
- **变异验证**：把搭车段改回无保护的 `Promise.all` → **恰好这 2 条红**（30 通过 / 2 失败），
  恢复后 32/32；
- 真机复验见 `docs/plans/phase-2-multi-platform.md` §3.19。

### 教训（已记入 `AGENTS.md` §7 第 46 条）

**"在干净环境里复现不出来"不等于"不存在"。**
一个缺陷如果只在"有东西可写"时才走到，那么所有"从零开始"的复现都会给出**假绿**。
复现前先问一句：**这个代码路径需要什么前置条件才会被执行？**
