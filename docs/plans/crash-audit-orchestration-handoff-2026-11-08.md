# 交接 · 崩溃审计编排（进行中，2026-11-08 下午）

> 写给下一个接手的人。**读完这一份就不需要再问"审计跑到哪了"。**
> 本文只回答四件事：目标是什么、**已经固化了什么**、**卡在什么上**、怎么接着跑。

---

## 1. 目标与验收口径

用户要求做一次**跨仓库崩溃审计编排**：发现仓库 → 分区 → 派发只读子代理 → 聚合去重 → 产出可执行的崩溃消除计划。

🔴 **可验收目标不是"零崩溃"**。静态审计不可能证明零崩溃，报告里也不许这么写。可验收目标是：

| 级别 | 内容 |
|---|---|
| **P0（崩溃）** | 空指针解引用、未捕获异常、越界、UAF/双重释放、OOM 路径、死锁/活锁、整数溢出致内存错误、未处理 Promise rejection、native 边界未防御调用 |
| **P1（准崩溃）** | 错误吞咽、缺 cleanup 致资源耗尽、共享可变状态无保护并发、边界条件未处理、部分完成致状态不一致 |

每条发现必须区分 **点修复**（`if (x == null)`）与 **消除器**（把 `T \| null` 改成强制调用方处理的 `Result`）。**优先上报消除器。**

## 2. 已经固化下来的东西（**不要重新做**）

### 2.1 分区已经做完，产物在 `audit_plan.json`

- 21 个审计单元（U01–U21），每个带 `unit_id / repos / paths / tech_stack / entry_points / cross_unit_dependencies`。
- 分区是**按实测字节数**切的，不是拍脑袋：`packages/app-host/src`（1648KB）拆成 U05(A–L)/U06(M–Z)；`apps/web`（6.1MB）拆成 U12 shell / U13 功能 A / U14 功能 B；`server`（6.5MB）拆成 U08 sync / U09 billing-auth / U10 api-misc。
- 生成脚本 `.audit-crash/gen_plan.mjs`（可重跑：`node .audit-crash/gen_plan.mjs`）。
- 排除规则写在 `audit_plan.json` 的 `exclusion_rules`：`node_modules / dist / build / obj / bin / .build / generated`、`packages/x|y`（空）、`research / scripts / docs / e2e`、`**/*.generated.ts`。

### 2.2 每个单元的派发 prompt 已经写好（在本文 §5 原样取用）

prompt 含四条硬约束：只读给定路径集合、崩溃类清单、输出 JSON schema、**上下文不超过窗口 25%**（按目录分批读）。

## 3. 跑过的子代理与结果（**这是最需要知道的部分**）

平台硬限制：**同时最多 8 个活跃子代理**（`subagent limit reached (active child limit: 8)`）。第一次一口气派 8 个，第 9–12 个直接被拒。

| 单元 | agent id | 状态 | 结果 |
|---|---|---|---|
| U01-storage | `51bdcf79-1ea1-4449-a4a2-72ad46b21c8f` | ❌ failed | 无收尾消息，**零产出** |
| U02-oplog-domain | `b6a9c9d3-e110-46b2-8139-178eb95ec703` | ⏳ running | 会话结束时仍在跑 |
| U03-sync-core | `301b73c4-a391-4e93-b2b1-929132eefde2` | ❌ failed | 无收尾消息，**零产出** |
| U04-sync-client-ai | `bba59308-b2f8-41da-b9a6-564ff2a43c60` | ❌ failed | 只留下一句"I'll start by surveying…"，**零产出** |
| U05-apphost-a | `595010fd-6523-4df0-b12c-4ee5c4294c94` | ⏳ running | 会话结束时仍在跑 |
| U06-apphost-b | `bdb32cab-0ec9-4fa6-a449-1c1cd0ff92a7` | ❌ failed | 无收尾消息，**零产出** |
| U07-localapi-inbound | `da3be826-cc14-4c57-81dc-84068b55d33a` | ⏳ running | 会话结束时仍在跑 |
| U08-server-sync | `b92fe77b-7679-478e-9cde-9c45236df701` | ❌ failed | 无收尾消息，**零产出** |
| U09–U21 | — | 未派发 | 被 8 并发上限拒掉 |

🔴 **结论：本轮没有任何一个单元拿到完整 JSON 结果。** 已经 failed 的 **5 个**（U01 / U03 / U04 / U06 / U08）
全都是"开始就死"、返回消息为空 —— 最可能是子代理在加载阶段就超了上下文或工具调用出错。
所以重派时**必须把单元再切小**（见 §4），并且**边跑边落盘**（见 `.audit-crash/units/README.md`）。

## 4. 下一步（按顺序，别跳）

1. **先重派 5 个失败单元，且切小**（U01 / U03 / U04 / U06 / U08）：
   - U01-storage 拆成 `U01a-sqlite`（`packages/storage/src/sqlite/**`）与 `U01b-idb-memory`（`indexeddb/** + memory/** + 顶层*.ts`）。
   - U03-sync-core 拆成 `U03a-conflict-replay`（`conflict-resolution.ts + remote-apply.ts + replay-coordinator.ts + operation.types.ts`）与 `U03b-encryption-keys`（`encryption*/* + share-keys.ts + key-lifecycle.ts`）。
   - U04-sync-client-ai 拆成 `U04a-sync-client` 与 `U04b-ai`（两个合计 810KB，一个子代理吃不消）。
   - U06-apphost-b 拆成 `U06a-vault-share`（`vault-* + share-*`）与 `U06b-native-sync`（`native-bridge + sync-wiring + reminder-* + ticktick-import-actions + privacy-consent + hosted-auth + public-facts`）。
   - U08-server-sync 拆成 `U08a-sync-routes`（`sync.routes*.ts + service.ts + conflict/op-replay`）与 `U08b-sync-services`（`services/** + cleanup.ts`）。
2. **观察那些 running 的**：拿到结果就落盘成 `.audit-crash/units/<unit_id>.json`，**不要只留在上下文里**（本轮教训：结果没落盘 = 会话一结束就没了）。
3. **按批次派发**，每批 ≤6 个，留 2 个槽位给重试。批次建议：
   - 批 2：U09、U10、U11、U12
   - 批 3：U13、U14、U15、U16
   - 批 4：U17、U18、U19、U20、U21
4. **聚合与对抗验证由编排器自己做**（不外派）：按 `(defect_class, file, line)` 去重 → P0 优先 → **每条 P0 与 likely 以上的 P1 必须亲自打开 file:line 复核** → 无法确认的降级为 `suspicious` 单独列。
5. 产出最终 Markdown：A 覆盖边界 / B 已复核 P0 / C 已复核 P1 / D 消除器清单 / E suspicious / F 防回归的 CI 检查建议。

## 5. 单元派发 prompt 模板（原样取用，把方括号换掉）

```
你是只读代码审计子代理。工作目录 /Users/rocalight/Desktop/All in one Data/01_PROJECTS/heyta

UNIT_ID: [UNIT_ID]
PATHS: [PATHS]（严格只读此集合，不得读集合外任何文件）
TECH_STACK: [TECH_STACK]
ENTRY_POINTS: [ENTRY_POINTS]

任务：找出会导致"闪退/崩溃"的 P0 与"准崩溃"的 P1。
审计顺序：先读入口与适配器接口，画出运行时边界（哪些输入来自外部、哪些是共享可变状态），
再沿"外部输入 → 状态变更 → 资源获取/释放 → 异常边界"追踪。

崩溃类清单：
P0: null-deref / unhandled-exception / buffer-overflow / uaf(含 double-close、close 后使用) /
    oom(无界缓存/无界结果集) / deadlock / integer-overflow / unhandled-async / native-boundary
P1: error-swallow(兜底后继续) / resource-leak(句柄、定时器) / race / boundary(空/零/极大输入) /
    state-inconsistency(部分完成)

对每条判断 fix_kind=eliminator 还是 spot-fix；eliminator 要写明它消除了哪一类缺陷。优先 eliminator。

上下文预算：不超过窗口 25%，按目录分批读，skip dist/ build/ obj/。

只输出一个 JSON 对象，不要输出 schema 之外的自然语言：
{"unit_id":"...","tech_stack":"...","files_covered":["..."],"findings":[{"file":"...","line":0,
"defect_class":"...","severity":"P0|P1","title":"≤80字符","evidence":"...","trigger_path":"...",
"fix_kind":"eliminator|spot-fix","eliminator_class":"...|null","suggested_fix":"...",
"confidence":"confirmed|likely|suspicious"}],"coverage_notes":"哪些路径没被深入审计、原因"}
```

## 6. 工作区现状（别被误导）

`git status` 里有一批**与本审计无关**的既有改动（`packages/op-log/src/engine.ts`、`apps/web/src/features/tasks/store.ts`、`apps/web/src/lib/oplog.ts`、若干 `docs/agents/*` 与 `scripts/*`）。**它们不是本轮审计产生的**，不要去还原也不要当成未提交的审计修复。

本审计产出的东西（全部未跟踪，不含任何业务代码改动）：
- `audit_plan.json`（分区结果，可交付）
- `.audit-crash/gen_plan.mjs`（分区生成脚本，可重跑）
- `.audit-crash/audit_plan.json`（同一份的副本，供 `.audit-crash` 自包含）
- `.audit-crash/units/`（子代理结果落盘目录，含 `README.md` 约定；**目前为空**）
- `docs/plans/crash-audit-orchestration-handoff-2026-11-08.md`（本文）

## 7. 环境

无。本任务纯只读静态审计，不需要起服务、不需要 build、不需要跑测试。**不要为了"验证"去跑 `pnpm build` 或 e2e** —— 那与审计目标无关，且本机四端构建很重。

## 8. 这一轮踩过的坑（避免重复）

- ❌ **一口气派 12 个**：8 个是硬上限，后面 4 个直接报错，浪费了一轮。
- ❌ **prompt 里给单个子代理 800KB+ 的路径集合**：3 个如此派发的单元全部 failed。切到 300–400KB 以下再试。
- ❌ **结果只在子代理的返回消息里**：failed 掉的那 3 个什么也没留下。**每个返回都先 `write` 落盘**。
