# 第三方代码归属声明

本仓库包含**非 heyta 原创**的第三方代码。按各自许可证的要求，此处登记归属。

> heyta 自身的许可证尚未确定，见 `docs/04-license-decision.md`（ADR-0001）。
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

## 2. 通过包管理器引入的依赖

所有第三方依赖的许可证必须**逐项登记**在 [`research/licenses.md`](research/licenses.md)，
准入规则有两条硬门槛：

1. **许可**：允许闭源商用（MIT / Apache-2.0 / BSD / ISC / MPL-2.0 等）
2. **可维护性**：**2021 年之后仍在持续更新**（否则排除，无论许可多宽松）

核实手段：
```bash
python3 research/tools/ghinfo.py owner/repo        # 最后提交/发版时间
python3 research/tools/licscan.py path/package-lock.json   # 依赖树许可证汇总
```

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
> 见 `docs/02-licensing-and-compliance.md`。

---

*本文件随第三方引入更新。任何新依赖在合入前必须同时完成：许可证登记 + 可维护性核实 + 在此处登记归属（如为 vendored）。*
