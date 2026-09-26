# 第三方代码归属声明

本仓库包含**非 heyta 原创**的第三方代码。按各自许可证的要求，此处登记归属。

> heyta 自身的许可证尚未确定，见 `docs/adr/0001-license-decision.md`（ADR-0001）。
> 本文件只处理**第三方代码的合规义务**。

---

## 1. Vendored（内联在仓库中的第三方代码）

### `packages/sync-core/` — 同步内核

| 项 | 值 |
|---|---|
| 来源 | [Super Productivity](https://github.com/super-productivity/super-productivity) |
| 原路径 | `packages/sync-core/` |
| 原包名 | `@sp/sync-core`（本仓库中已更名为 `@heyta/sync-core`） |
| **commit** | `aa9690ca28aa6751971dd0e47d9b39c5b72922cb` |
| **日期** | 2026-09-24 |
| **License** | **MIT** |
| **版权** | Copyright (c) 2018 Johannes Millan |
| 许可全文 | [`packages/sync-core/LICENSE`](packages/sync-core/LICENSE) |
| 改动说明 | [`packages/sync-core/PROVENANCE.md`](packages/sync-core/PROVENANCE.md) |

MIT 许可证的合规义务：**保留版权声明与许可声明**。本仓库完整保留了原始 `LICENSE` 文件。

**MIT 允许闭源商用**——无论 heyta 最终选择什么许可证，使用本包都不受限制。

---

### `packages/shared-schema/` — 实体清单 / 版本策略 / HTTP 契约

| 项 | 值 |
|---|---|
| 来源 | [Super Productivity](https://github.com/super-productivity/super-productivity) |
| 原路径 | `packages/shared-schema/` |
| 原包名 | `@sp/shared-schema`（本仓库中已更名为 `@heyta/shared-schema`） |
| **commit** | `aa9690ca28aa6751971dd0e47d9b39c5b72922cb` |
| **License** | **MIT** |
| **版权** | Copyright (c) 2018 Johannes Millan |
| 许可全文 | [`packages/shared-schema/LICENSE`](packages/shared-schema/LICENSE) |
| 改动说明 | [`packages/shared-schema/PROVENANCE.md`](packages/shared-schema/PROVENANCE.md) |

**部分复用，部分是 heyta 原创：**

| 文件 | 状态 |
|---|---|
| `src/supersync-http-contract.ts`（384 行 zod 线协议） | ✅ 上游原样 |
| `src/migrate.ts` + `src/migration.types.ts`（迁移框架） | ✅ 上游原样 |
| `src/entity-types.ts` | 🔧 heyta 重写（上游是 SP 专属 21 项） |
| `src/schema-version.ts` | 🔧 heyta 重写（版本重置为 v1，**政策继承上游**） |
| `src/migrations/*`（3 个 SP 迁移） | ❌ 已删除 |

---

### `server/` — 同步服务端

| 项 | 值 |
|---|---|
| 来源 | [Super Productivity](https://github.com/super-productivity/super-productivity) |
| 原路径 | `packages/super-sync-server/` |
| 原包名 | `@super-productivity/super-sync-server`（本仓库中更名为 `@heyta/sync-server`） |
| **commit** | `aa9690ca28aa6751971dd0e47d9b39c5b72922cb` |
| **License** | **MIT** |
| **版权** | Copyright (c) 2018 Johannes Millan |
| 许可全文 | [`server/LICENSE`](server/LICENSE) |
| 改动说明 | [`server/PROVENANCE.md`](server/PROVENANCE.md) |

**改动极小**：仅包名与 22 处依赖名（`@sp/*` → `@heyta/*`），**业务代码未改**。

服务端之所以能自动适配 heyta，是因为它的实体校验是
`new Set(ENTITY_TYPES)`（`server/src/sync/services/validation.service.ts:25`）——
**直接从共享包派生**。这正是把实体清单放在共享包里的价值。

---

## 2. 通过包管理器引入的依赖

所有第三方依赖的许可证必须**逐项登记**，准入规则有两条硬门槛：

1. **许可**：允许闭源商用（MIT / Apache-2.0 / BSD / ISC / MPL-2.0 等）
2. **可维护性**：**2021 年之后仍在持续更新**（否则排除，无论许可多宽松）

### 逐项清单

📋 **[`research/licenses-inventory.generated.md`](research/licenses-inventory.generated.md)**
—— 由工具生成，**当前 896 个包：宽松许可 895，受限 0，无许可证 0，白名单外已登记 1**。

> ⚠️ **这个数字曾经是 315，而且是错的。** 该文件在 React Native 的依赖树装进来
> **之前**生成，之后一直没重新生成 —— 里面 `react-native*` 条目为 **0 行**，
> 也就是说**风险最高、原生依赖最多的那一整棵子树从未被登记过**。
> 门禁脚本本身扫的是实时依赖树（所以它一直是准的），烂的是这份**登记产物**：
> 它读起来像"都核对过了"，实际漏掉了 581 个包。
> **门禁绿 ≠ 登记全** —— 产物必须跟着依赖树一起重新生成。
>
> 那 1 个是 `caniuse-lite`（**CC-BY-4.0**，署名许可证）。
> 它是 `browserslist` 的构建期数据包，**不进入运行时产物**；但 CC-BY-4.0
> 确实**不在 §3.2 的白名单里**，所以走的是"逐项登记"这条路，而不是并进"全部宽松许可"。
>
> ✅ **门禁弱点已修（不再是弱点）。** 这里原本记着一句：脚本在存在"需归类"包时
> **仍然退出 0** 并打印"全部依赖均为宽松许可 ✅"，也就是**这一档永远不会失败**。
> 那是个真问题 —— 白名单是显式枚举的，所以**任何不在表里的许可都会落进"需归类"
> 并被静默放行**，正好是白名单想拦的那一类。把弱点写在纸上拦不住任何一次引入。
>
> 现在的语义：**"白名单外"默认失败**，只有在
> `research/tools/license-inventory.mjs` 的 `REVIEWED_OTHER` 里逐项登记理由才放行。
> 同时修掉了它的成因 —— 失败判据原来被**抄了三遍**（`--json` / `--flagged` / 汇总）
> 且三遍都漏了 `other`；漂移就是从"同一个判断写三次"开始的，现在只有一个 `failing`。
>
> **已实测它会失败（4 种注入，全部验证过）：**
>
> | 注入 | 期望 | 实测 |
> |---|---|---|
> | 基线（CC-BY-4.0 已登记） | 退出 0 | ✅ 0 |
> | 把 `CC-BY-4.0` 的登记拿掉 | 退出 1 | ✅ 1（`caniuse-lite` 落入"未登记"） |
> | 注入 `CC-BY-ND-4.0` 假包 | 退出 1 | ✅ 1 |
> | 注入 `AGPL-3.0-or-later` 假包 | 退出 1 | ✅ 1 |
> | 清理假包后 | 退出 0 | ✅ 0（无残留） |
>
> 第 2 行是关键：它证明这条登记是**承重的** —— 不是"CC-BY-4.0 被全局放行"，
> 而是"这一个包被明确接受过"。`--flagged` 在未登记时同样退 1（也已实测）。

该清单的数据来源是**实际安装的依赖树**（pnpm store 里的每个 `package.json`），
不是 lockfile 的声明范围 —— 后者只说明"想装什么"，前者才是"实际装了什么"。
去重口径为 `包名@版本`，同名多版本分别登记。

```bash
# 重新生成
node research/tools/license-inventory.mjs            # 人读汇总
node research/tools/license-inventory.mjs --json     # 机器可读
node research/tools/license-inventory.mjs --flagged  # 只看需人判断的
```

**非零退出码 = 存在受限 / 无许可证 / 白名单外**未登记**的包**，可直接接进 CI 当门禁。

### 其他核实手段

```bash
python3 research/tools/ghinfo.py owner/repo   # 最后提交/发版时间（可维护性门槛）
```

决策记录与逐项调研见 [`research/licenses.md`](research/licenses.md)。

### 🔴 明确的禁令

| 包 | 许可证 | 禁止原因 |
|---|---|---|
| `@nextcloud/cdav-library` | **AGPL-3.0-or-later** | 网络 copyleft，会传染整个产品。CalDAV 功能必须自研或换宽松许可实现 |
| PowerSync Service | FSL-1.1 | **明文禁止竞品托管**（heyta 就是竞品） |
| Couchbase Lite 4.x | BSL 1.1 | 禁止提供竞争性托管服务 |
| `sqlite-sync` | Elastic 改版 | 禁止自实现 Network Layer |
| Triplit | AGPL-3.0-only | 网络 copyleft + 疑似停滞 |
| Time_NLP 系列 | **无 LICENSE 文件** | 无授权即默认保留全部权利，**一行代码都不能用** |

完整清单见 `research/licenses.md` §2。

---

## 3. 参考但未使用代码的项目

以下项目**只作为设计/架构参考**，未复制任何代码：

| 项目 | License | 参考内容 |
|---|---|---|
| Super Productivity 的 `src/app/op-log/` | MIT | 同步编排的语义（状态机、墓碑、崩溃恢复），**重写而非搬运** |
| `harin/todoist-matrix` | MIT | "给已有任务系统加矩阵视图层、不改数据层"的架构范式 |
| `Spikeysanju/Einsen` | Apache-2.0 | 四象限 UI 信息架构 |
| `remvze/moodist` | MIT | 白噪音功能设计 |

> ⚠️ 即使许可证允许，heyta 也**不使用**滴答清单（TickTick）的商标、图标、文案与界面素材。
> 见 `docs/research/licensing-and-compliance.md`。

---

*本文件随第三方引入更新。任何新依赖在合入前必须同时完成：许可证登记 + 可维护性核实 + 在此处登记归属（如为 vendored）。*
