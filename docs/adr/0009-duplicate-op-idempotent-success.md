# ADR-0009：精确重复的 op 回幂等成功，不再回 `DUPLICATE_OPERATION`

> 状态：**已接受**
> 日期：2026-09-26
> 取代：无（修改了 vendored 的 `server/` 上传路径的**语义**，未取代任何 ADR）

## 1. 背景与约束

### 现象：一台设备**永久**同步不了，而数据一条没丢

`pnpm verify:mobile-ios` 的跨设备那一路是通的（笔记本能读到手机写的任务），
但手机自己那侧报「同步失败」，任务页角标从 5 一路涨到 10，**待上传数永远不减**。

手机上应用自己写出来的报错（AX 树 `--dump` 读到的原文）：

```
服务端拒绝了 5/5 条 op：other-device-x-1790381101253-1(INVALID_CLIENT_ID: ...),
  muhmhxil-1-n6fnf68i-17903824(DUPLICATE_OPERATION: Duplicate operation ID), ... ×4
```

也就是**一批 5 条，被拒 5 条**，而其中 4 条的真实含义是"服务端早就有了"。

### 机制：一条自持的链

```
上传 → 看 results[].accepted → 只要有硬拒绝就 throw
                               ↑ 这个 throw 在 markUploaded / setLastServerSeq **之前**
```

1. 同批里**已被服务端接受**的 op 永远不落"已上传"标记；
2. 下次同步重传**整批**（包括那几条服务端已收下的）；
3. 服务端看到的就是**精确重复**，回 `DUPLICATE_OPERATION`；
4. 客户端继续 `throw` → 回到第 1 步。

**数据在云上没丢**，但这台设备再也同步不动了。用户看到的是
"同步一直失败 + 待上传数永远不减" —— 一个很容易被误判成网络问题或配额问题的形状。

### 是被一条"我以为是写错的断言"逼出来的

`verify-mobile-ios` 里原来断言"上传后 `uploadStatus` 应从 `pending` 变 `uploaded`"。
它红了，第一反应是"断言写错了"。**去查真因才发现断言没错、产品错了。**
（这条教训已记为 `AGENTS.md` §7 第 34 条。）

### 硬约束

- **不能把"id 冲突"也放行。** id 相同但内容不同 = 另一条 op 撞了 id，那是真错误，
  必须继续硬拒绝（`INVALID_OP_ID`）。**"幂等重试"与"id 冲突"的分界线是这条决策的核心。**
- **op-log 是唯一写入口**，冲突判定语义在 `packages/sync-core`，不许在客户端另发明一套。
- 不改线协议字段，不 bump `CURRENT_SCHEMA_VERSION`。
- `server/` 与 `packages/sync-core/` 是 vendored（MIT），改动要更新 `PROVENANCE.md`。

## 2. 选项

| 选项 | 优点 | 缺点 | 关键证据 |
|---|---|---|---|
| **A. 服务端把"精确重复"回幂等成功**（选） | 治根因；**已安装的旧客户端也自动被救**（不用等发版）；回的是**真实 serverSeq**；上游自己已有同形先例 | 动了 vendored 服务端语义；要让 10 条既有断言跟着改 | `sync.routes.snapshot-handler.ts:454-478` 的 BACKUP_IMPORT / REPAIR 分支**已经在这么做**，注释写着 "Surface the original serverSeq as success instead of a confusing DUPLICATE_OPERATION rejection" |
| B. 只改客户端：见到 `DUPLICATE_OPERATION` 就跳过 | 不动服务端，改动面最小 | 跳过时**拿不到 serverSeq**；已经装出去的旧客户端**不会被救**；每种硬拒绝都要单独打补丁 | `client.ts` 里只有 `CONFLICT*` 有专门的收敛路径，非冲突拒绝**没有** |
| C. 只改文案 / 只做 UI 提示 | 零风险 | 队列还是不清空，**症状从"报错"变成"永远在转圈"**，更差 | — |

## 3. 结论

**选 A，并且补上 B 的客户端那一半作为第二道防线。**

服务端（`server/src/sync/services/operation-upload.service.ts`）两处"磁盘上已有"的分支
（可预测的 `existingOp` 分支 + 竞态失败后的 `duplicateOp` 分支）在
`isSameDuplicateOperation(...)` 判定为**同一条 op** 时，改为返回：

```ts
result: { opId: op.id, accepted: true, serverSeq: existingOp.serverSeq },
```

`storageBytes: 0` —— 这条路径**什么都没写**，而调用方只在 `accepted === true` 时读它
（`sync.service.ts:420-426`）。

- **保留硬拒绝**：`INVALID_OP_ID`（内容/时钟/持久化元数据不同、跨用户 id 碰撞、
  竞态里的 id 碰撞）**一条都没放松**。相关 5 条既有断言**原样未改、仍然绿**。
- **同批次内重复**（`firstRequestOperation`）**故意不动**：客户端不可能产出这种批次
  （`getPendingUpload()` 返回的是库里互不相同的 op），真出现就是客户端 bug，硬拒绝是有用的信号。

客户端（`packages/sync-client/src/client.ts`）把 `markUploaded(seqsByOpId)` 提到
`hardRejects` 的 `throw` **之前**，但**游标不提前推进**：

- 先落盘，队列才会收敛到"只剩那条真被拒的 op"；
- 游标记的是**下载**进度，这条路径下面还有 piggyback 的 `newOps` 没应用，
  先推进会跳过它们 —— **那是真的丢数据，比"多下几次"严重得多**。

错误文案补一句"（同批另有 N 条已被接受，已标记为已上传，不会再重传）"，
避免用户把"部分被拒"读成"全军覆没"。

## 4. 后果

- **`DUPLICATE_OPERATION` 这个错误码在生产路径上几乎变成不可达**
  （只剩同批次内重复那一条）。它不是废弃 —— 别顺手删掉它和它的常量。
- **10 条上游断言按新语义改写**（`duplicate-operation-precheck.spec.ts` 10 条、
  `sync.service.spec.ts` 2 条），并加了文件头说明，**明确写出边界没有放松**。
  改写的是"期望值"，不是"判据" —— 内容/时钟/元数据/跨用户/竞态碰撞那 5 条**一字未动**。
- **旧客户端会被自动救活**（这是选项 A 的主要收益）：修复只在服务端，不用等客户端发版。
- **`AGENTS.md` §7 第 34 条**从"已取证未修"改成"已修"，并补上机制与验收证据。
- **同步协议语义变了**，所以任何"重复上传应当报错"的假设都作废。
  写新的同步测试时，不要拿 `DUPLICATE_OPERATION` 当"上传失败"的例子。

## 5. 未核实项

- ⚠️ **生产环境里有没有真实账号处于这个卡死状态**，没查过 —— 本地只有一个验收账号。
  自愈路径依赖"服务端先升级"，而**已安装的客户端不需要动**，所以推断能自愈；
  **但没有在真实用户数据上验证过**。
- ⚠️ **`Web` 壳是否也会卡在这个形状**，未实测。`packages/sync-client` 是共享的，
  理论上修了；Web 侧的 `markUploaded` 回调是否真的落 IndexedDB，**没跑过端到端**。
- ⚠️ **同批次内重复回硬拒绝是否会在某种真实时序下被触发**，未穷举。
  当前论据是"`getPendingUpload()` 不会返回重复 op"，这是**读代码得出的**，不是实测得出的。
- ⚠️ **因果安全压缩**仍未做（与 ADR-0008 同一个未决项），本决策与它无关。
