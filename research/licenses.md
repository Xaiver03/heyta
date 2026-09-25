# 依赖许可证登记表

> 目的：任何进入 heyta 的代码/依赖都必须在此登记，**未登记不得引入**。
> 数据来源：本机对 `research/upstream/super-productivity/package-lock.json`（1993 个包）的实测扫描。
> 扫描时间：2026-09-25

---

## 图例

| 标记 | 含义 |
|---|---|
| ✅ 绿 | 宽松许可，闭源商用无障碍 |
| 🟡 黄 | 弱 copyleft，有义务但可控 |
| 🔴 红 | 强 copyleft / source-available，**引入前必须评估** |

---

## 1. 计划复用的资产

### 1.1 `@sp/sync-core`（✅ 已批准）

| 项 | 值 |
|---|---|
| 来源 | `super-productivity/packages/sync-core` |
| License | **MIT**（随主仓 LICENSE，Copyright (c) 2018 Johannes Millan） |
| 规模 | 4,240 行源码 / 271 测试 |
| 义务 | 保留版权声明与许可证全文；无开源义务 |

**运行时依赖（全部 ✅）**

| 包 | 版本 | License |
|---|---|---|
| `@noble/ciphers` | 2.2.0 | **MIT** ✅ |
| `hash-wasm` | 4.12.0 | **MIT** ✅ |

> 仅 2 个依赖，且都是纯算法库、无传递依赖风险。

### 1.2 `@sp/shared-schema`（🟡 改造后使用）

| 项 | 值 |
|---|---|
| License | **MIT** |
| 规模 | 952 行（18 个 ts 文件） |
| 改造点 | `entity-types.ts` 的 21 项实体清单需替换为 heyta 自己的 |

**运行时依赖**

| 包 | 版本 | License |
|---|---|---|
| `zod` | 4.4.3 | **MIT** ✅ |

### 1.3 `@sp/sync-providers`（⚠️ 按需，当前倾向不用）

| 项 | 值 |
|---|---|
| License | **MIT** |
| 说明 | 文件型同步（WebDAV / Dropbox / OneDrive）。若只走 SuperSync 服务端，**不需要引入** |

**运行时依赖**：`hash-wasm` 4.12.0 **MIT** ✅

### 1.4 `super-sync-server`（✅ 已批准）

| 项 | 值 |
|---|---|
| License | **MIT** |
| 规模 | 148 个 ts 文件 |

**运行时依赖（全部 ✅，零 copyleft）**

| 包 | 版本 | License |
|---|---|---|
| `fastify` | 5.12.1 | MIT ✅ |
| `@fastify/cors` | 11.2.0 | MIT ✅ |
| `@fastify/helmet` | 13.0.2 | MIT ✅ |
| `@fastify/rate-limit` | 10.3.0 | MIT ✅ |
| `@fastify/static` | 10.1.2 | MIT ✅ |
| `@fastify/websocket` | 11.2.0 | MIT ✅ |
| `@prisma/client` | 5.22.0 | **Apache-2.0** ✅（有专利授权，需带 NOTICE） |
| `@simplewebauthn/server` | 13.3.2 | MIT ✅ |
| `@simplewebauthn/types` | 12.0.0 | MIT ✅ |
| `bcryptjs` | 3.0.3 | BSD-3-Clause ✅ |
| `dotenv` | 17.4.2 | BSD-2-Clause ✅ |
| `jsonwebtoken` | 9.0.3 | MIT ✅ |
| `nodemailer` | 9.1.1 | MIT-0 ✅（最宽松，连署名都不要求） |
| `uuidv7` | 1.2.1 | **Apache-2.0** ✅ |
| `zod` | 4.4.3 | MIT ✅ |
| `@sp/shared-schema` | — | 工作区包，随主仓 MIT |
| `@sp/sync-core` | — | 工作区包，随主仓 MIT |

### 1.5 上游的 Kotlin 参考实现（✅ 可作为移植蓝本）

| 文件 | 行数 | 说明 |
|---|---|---|
| `android/.../crypto/Argon2.kt` | 371 | 随主仓 MIT |
| `android/.../crypto/Blake2b.kt` | 124 | 随主仓 MIT |
| `android/.../crypto/OpPayloadDecryptor.kt` | 138 | 随主仓 MIT |

> 用途：如果 heyta 走 Flutter/Dart 或其他非 JS 技术栈，这是**已通过 CI 互操作验证**的移植蓝本。

---

## 2. 🔴 禁止引入清单

| 包 / 代码 | License | 位置 | 原因 |
|---|---|---|---|
| **`@nextcloud/cdav-library`** | **AGPL-3.0-or-later** | `src/app/features/issue/providers/caldav/caldav-client.service.ts:4` | ⚠️ **被生产代码 import，会被打进产物**。这是整个依赖树里唯一的强 copyleft，也是"MIT 项目里藏 AGPL"的真实案例。**Reuse CalDAV 功能时必须自己实现或换宽松许可的库** |
| `src/app/features/issue/providers/caldav/` 整个目录 | 受上述污染 | 同上 | 连带排除 |

### 上游其他 copyleft 命中（均非运行时，可忽略）

| 包 | License | 状态 |
|---|---|---|
| `ical.js` @2.2.1 | MPL-2.0 🟡 | devDependency。MPL 是文件级 copyleft，**只要不修改该库源文件就无义务**。Tududi 也用它 |
| `@nextcloud/cdav-library` | AGPL-3.0-or-later 🔴 | 见上 |

---

## 3. 整个依赖树的健康度（实测）

**Super Productivity 全量：1,993 个包**

| License | 数量 |
|---|---|
| MIT | 1,614 |
| ISC | 142 |
| Apache-2.0 | 94 |
| BSD-3-Clause | 44 |
| BSD-2-Clause | 37 |
| BlueOak-1.0.0 | 22 |
| **未标注 license** | **16** |
| MIT-0 | 5 |
| CC0-1.0 / 0BSD / Unlicense / OFL-1.1 / Python-2.0 / CC-BY-4.0 / MPL-2.0 / Public Domain | 各 1–2 |
| **🔴 AGPL-3.0-or-later** | **1** |

**结论**：除 `@nextcloud/cdav-library` 外，**整棵树没有第二个强 copyleft**。
而我们选定的复用栈（sync-core / shared-schema / super-sync-server）**完全不含它**。

### ⚠️ 16 个未标注 license 的包

`map-stream`、`svg-tags`、`union` 为第三方；其余 13 个是 `@sp/*` 和 `@super-productivity/*` **工作区自有包**（随主仓 MIT，无需单独授权）。

第三方未标注者需在引入前单独核实。**当前选定的复用栈不包含这三个包**（它们属于 Angular 构建工具链）。

**Tududi 对照：1,742 个包，零 AGPL/GPL**，运行时仅 3 个 MPL-2.0（`dompurify` 可选 Apache-2.0、`ical.js`、`web-push`）——若将来改用 Tududi 路线，同样干净。

---

## 4. heyta 自己的许可证选择

见 `docs/04-license-decision.md`（ADR-0001，待确认）。

**当前倾向**：fork MIT 底座 + 自己新增部分以 **AGPL-3.0** 发布 + 运营层（计费/多租户/运维）保持闭源。
法律依据：MIT 允许再许可（sublicense），可把"MIT 底座 + 自研新增"整体以 AGPL 分发，只需保留原 MIT 声明。

---

## 5. 登记规则（强制）

1. 任何新依赖，**先查 License，再写进本表，最后才允许 import**
2. 🔴 类许可证一律需要单独评估并记录结论
3. 🟡 类（MPL/LGPL）需记录义务与履行方式
4. 每次依赖升级后重跑扫描（脚本见下）

### 重跑扫描的方法

```bash
# 在含 package-lock.json 的目录
python3 research/tools/licscan.py <path-to>/package-lock.json
```

扫描脚本逻辑：遍历 `package-lock.json` 的 `packages`，提取每个包的 `license` 字段，
聚合分布，并筛出含 `GPL` / `SSPL` / `BUSL` / `ELASTIC` / `MPL` / `CC-BY-SA` / `EUPL` 的条目，
标注其是否为 dev-only。

---

*本表随依赖变更持续更新。上游代码位置：`research/upstream/`（已 gitignore，不在版本控制内）。*
