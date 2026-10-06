# AED 实施证据汇总

> 状态：**A/E/D 实施与验收完成**
> 日期：2026-10-03

本文只汇总当前实现和已运行证据，不把单包通过写成全仓完成。

**范围边界**：下列完成记录仅覆盖 A/E/D 当轮源码。后续 B（[ADR-0050](../adr/0050-e2ee-key-lifecycle-and-recovery.md)）与 C（[多端覆盖计划](../plans/goal-multi-end-coverage.md) §4、[ADR-0051](../adr/0051-mobile-reminder-delivery.md)）仍在实施；此处旧门禁和四端安装记录不代表 B/C 已验收。

## 已落地的边界

- **E**：字段/实体版本前沿、确定性 LWW、墓碑、批量 `entityIds`、幂等和收敛
  property 测试；冲突分类由 sync-core、客户端和服务端共享。`semantic-invariants.spec.ts`
  还以固定 seed 生成因果图，让两台独立 `OpLogEngine` 分别经过不同乱序、批次、重复
  投递后，与纯 reducer 投影和彼此状态对账，并检查接收后的向量时钟等于所有已见
  操作的逐维最大值。这样 E 的“收敛”不是只在 `replayOperations()` 的单个调用中
  证明，而是包含存储、幂等闸门和远程投递边界。
- **A**：生产路径完整保存向量时钟；服务端超过 4096 维度显式拒绝；签名
  frontier-delta 在验证后展开为完整时钟；`observedClock` 独立持久化；
  `REPAIR` 使用版本化全量 payload 与 `repairBaseServerSeq`，stale base fail-closed。
- **D**：可校验 materialized checkpoint、增量水合、损坏回退、归档/热区联合
  读取、pendingApply 空洞保护、sticky incomplete-history marker；显式维护时
  扫描未物化实体，未知 snapshot bucket fail-closed。客户端本地归档保留
  op-log 事实；服务端才在 causal REPAIR 通过后物理 drain。

## 已运行的证据

| 证据 | 结果 |
| --- | --- |
| 真实 P1 同步链路 | `/tmp/heyta-aed-p1-final.log`：12 条通过 |
| 真实 HTTP + PostgreSQL 集成 | `/tmp/heyta-aed-http-final.log`：三份集成测试共 17 条通过，含 101 维 frontier、delta 展开、签名拒绝、4096/4097 边界、REPAIR、物理前缀删除、离线并发和 stale 拒绝 |
| hydration 性能 | 历史基线 `/tmp/heyta-aed-hydration-final.log`：100,000 条全量约 9.5672s；当前树重建 storage/op-log 后复跑 `/tmp/heyta-aed-hydration-current-20261004.log`：100,000 条全量 10,790.9ms、checkpoint 后 100 条尾部 40.1ms、未调用 `getAllOps`。两者均为 Node + SQLite，不冒充移动端 Hermes 性能。 |
| Android Hermes + op-sqlite | `pnpm verify:mobile-aed`：101 维关库重开保留、checkpoint 尾部 1 条、真实库 warning 进入 logcat；[日志摘要](../../apps/mobile/evidence/hermes-aed-latest.txt) |
| 存储与引擎专项 | 378 条存储、99 条引擎、98 条 sync-client 测试通过；C# 原样存储契约 61/61 通过 |
| 服务端单测 | `/tmp/heyta-aed-server-final.log`：2100 通过，1 跳过 |
| 变异判据 | `/tmp/heyta-aed-mutations-final.log`：9 类变异均产生真实失败断言 |
| E 状态机补强 | `packages/op-log/tests/semantic-invariants.spec.ts`：8 个固定 seed；两台独立引擎、不同批次/乱序/重复投递；纯 reducer、两端可见状态、时钟前沿和重试幂等全部对账。独占窗口定向实跑：`pnpm --filter @heyta/op-log exec vitest run tests/semantic-invariants.spec.ts`，1 个文件 / 5 条通过；同窗口的完整 `@heyta/op-log` 运行是 9 个文件 / 112 条通过。随后 `node scripts/mutate-op-log-semantics.mjs` 的 9 类 A/D/E 变异全部被至少 1 条断言抓到。 |

## 本文已经闭合的收尾边界

以下两项在本文件下方有对应的运行日志、截图和产物新鲜度记录，已经完成；它们只证明
A/E/D 及仓库级收尾，不会把 B/C 的移动密钥与原生提醒缺口扩大成已完成：

- 全仓最终 build、typecheck、test、`pnpm check`：已完成；
- 四端用当前工作树重新打包、安装和截图/产物新鲜度证据：已完成。

B/C 的当前完成度和未闭合项仍以 [ADR-0050](../adr/0050-e2ee-key-lifecycle-and-recovery.md)、
[ADR-0051](../adr/0051-mobile-reminder-delivery.md) 以及[多端覆盖计划](../plans/goal-multi-end-coverage.md)
的最新实施矩阵为准。

## 最终收尾证据

- `pnpm check` 最终整轮：126 条主浏览器用例（2 条按配置跳过，1 条 trace
  竞争后重试通过）、17 条落地页用例，以及全量 workspace 测试通过；服务端
  115 个测试文件、app-host 1,002 条、移动端 625 条、落地页 1,303 条均在
  `/tmp/heyta-aed-check-final7.log` 留有输出。
- `pnpm -r build` 最终通过；最后一次 iOS 重装前的构建日志为
  `/tmp/heyta-reinstall-build-final6.log`。
- 四端当前产物重装：macOS 主蓝 1,266（窗口与 WebView 快照）、Windows
  源码/`web-dist`/bridge 哈希对账、Android 64 MB APK 主蓝 4,001、iOS
  Release 新鲜度通过且主蓝 4,136。汇总日志为
  `/tmp/heyta-aed-reinstall-final.log` 与 `/tmp/heyta-aed-reinstall-ios-final4.log`。
- 人工查看的共享 UI 截图：
  `/tmp/heyta-reinstall-mac-installed.png.webview.png`、
  `/tmp/heyta-reinstall-android.png`、`/tmp/heyta-reinstall-ios.png`；
  Windows 取证在 `dist/windows/install-capture.txt`。

`createSyncCheckpoint()` 目前是显式维护 API，没有自动 timer；本地 checkpoint
的自动 cadence 只用于启动加速。AI 推断仍按派生数据处理，Web 当前的
`MEMORY_OP_WINDOW=1000`/`readRecentOps()` 是读取窗口，不是持久化推断结果。
