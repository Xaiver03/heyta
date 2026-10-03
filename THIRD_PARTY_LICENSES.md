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

### `scripts/vendor/holiday-cn/` — 国务院节假日公告的机器可读整理件

| 项 | 值 |
|---|---|
| 来源 | [NateScarlet/holiday-cn](https://github.com/NateScarlet/holiday-cn) |
| 原路径 | 仓库根下按年命名的 `YYYY.json`（2007–2026 共 20 份） |
| **上游 commit** | `159faa58969f6a89ecc671dc04001837c4dca13e`（master，2026-09-27） |
| **取数日期** | 2026-10-03 |
| **License** | **MIT** |
| **版权** | Copyright (c) 2019 NateScarlet |
| 许可全文 | [`scripts/vendor/holiday-cn/LICENSE`](scripts/vendor/holiday-cn/LICENSE) |
| 读取入口 | [`scripts/vendor/holiday-cn/load.mjs`](scripts/vendor/holiday-cn/load.mjs)（唯一解析者） |

**两道门都过**：

- **可维护性**：上游每日自动抓取国务院公告，最后提交 **2026-09-27**，最新数据发布
  2026-01-01，2.2k★，未归档。
- **许可**：MIT，且它的内容本身是**政府公文**（放假安排公告），不构成受版权保护的
  独创性表达 —— 项目里**没有任何一端运行时读这些 JSON**。

🔴 **它在产品里的角色必须说清，否则这条登记会被读成"产品依赖第三方数据源"。**
这些 JSON 是**构建期反证材料**：`scripts/gen-calendar-tables.mjs --verify` 用它核对
算出来的节日是否落进"那几天放假"的集合。随包交付的是
`packages/domain/src/generated/holiday-cn.generated.ts`（**只含休/班日期与公告链接**，
不含上游的文件结构与任何代码），因此**它不是运行时依赖，也就不需要随产物署名**。
保留 LICENSE 的理由是另一条：MIT 要求"保留版权声明与许可声明"，而派生件与原件
在同一条复制路径上（构建期），一并留着成本为零。

⚠️ **这些 JSON 不进任何客户端包，也不进服务端** —— 由
`scripts/gen-calendar-tables.mjs --bundle` 的"随包只有表"判据盯住。

---

## 2. 通过包管理器引入的依赖

所有第三方依赖的许可证必须**逐项登记**，准入规则有两条硬门槛：

1. **许可**：允许闭源商用（MIT / Apache-2.0 / BSD / ISC / MPL-2.0 等）
2. **可维护性**：**2021 年之后仍在持续更新**（否则排除，无论许可多宽松）

### 逐项清单

📋 **[`research/licenses-inventory.generated.md`](research/licenses-inventory.generated.md)**
—— 由工具生成（`node research/tools/render-license-inventory.mjs`）。
🔴 **包数与分布只在那份产物里，本文件不复述数字** —— 这里曾抄着一句「当前 910 个包」，
而产物同期已经是 962 个。**登记册的摘要与明细不一致，读的人就无法判断该信哪一半。**

> 📌 **2026-10-03 因「倒数纪念日」历法层（ADR-0044 批次一 W1）新增 1 个包**：
> `lunar-typescript@1.8.6`（**MIT**，零运行时依赖），**且它是 devDependency**。
>
> 两道门都过：
> * **可维护性**：`6tail/lunar-typescript` 最后提交 **2026-08-13**、最新发版
>   **v1.8.6（2025-11-05）**，372★，未归档。
> * **许可**：`package.json` 的 `license` 字段为 `MIT`，仓库带 LICENSE 全文。
>
> 🔴 **它只在构建期用一次**（把 1900–2100 的农历表编码成数据随包交付），
> **一个字节都不进任何端的产物**。这条不是靠声明保证的，是由
> `pnpm check:calendar` 里的 **bundle 闸门**（`scripts/gen-calendar-tables.mjs --bundle`）
> 钉住的三条判据：产品源码里 0 处引用、它只许出现在根 `devDependencies`（子包自己声明
> 也算违规）、随包数据合计不超过库入口的 1/4。三条各自做过变异验证。
>
> ⚠️ **`research/licenses-inventory.generated.md` 需要一次全量重渲染**（本次没动它）：
> 渲染器扫的是**当前检装的依赖树**，而在隔离 worktree 里跑它会把**别人工作树才装着的包**
> （Playwright、`@floating-ui/*` 等）判成"不存在"并写掉。
> **正确做法是在装了完整树的主检出上、合入本批 lockfile 之后重跑。**
> 这正是本文件上面那条"门禁绿 ≠ 登记全"的同一个形状。

> 📌 **2026-09-26 因真实浏览器验收（`e2e/`）新增 3 个包**：
> `@playwright/test@1.63.0` + `playwright@1.63.0` + `playwright-core@1.63.0`，
> **全部 Apache-2.0**（§3.2 白名单内，无需逐项例外登记）。
>
> 两道门都过：
> * **可维护性**：`microsoft/playwright` 最后提交 **2026-09-26**、最新发版
>   **v1.63.0（2026-09-04）**，96.7k★，未归档。远超"2021 年之后仍活跃"的门槛。
> * **许可**：发布包 `package.json` 的 `license` 字段为 `Apache-2.0`（已核）。
>
> ⚠️ **`e2e/` 是一个独立的 pnpm 工作区**（`e2e/pnpm-workspace.yaml`），
> 因此它有**自己的一份 store**。上面那个 910 之所以是对的，是因为
> `research/tools/license-inventory.mjs` 已经改成扫描**所有工作区的 store**
> （见那里的 `STORES` 清单）—— 在那之前它只扫根 store，于是 Playwright
> **完全不可见**，而汇总数字看起来毫无异常。
>
> **这正是本仓库吃过两次亏的同一个形状**：315 → 908 那次漏掉整棵 React Native
> 子树，这次差点漏掉整个 e2e 工作区。判据因此写死：
> **门禁绿 ≠ 登记全；新增工作区必须在 `STORES` 里登记，
> 忘了的表现是"数字没变"，不是"报错"。**

> 📌 **2026-09-26 因落地页（`apps/landing`）新增 12 个包**：
> `three@0.186.1`（MIT，**零运行时依赖**）、`motion@13.4.4`（MIT，依赖树只有
> `framer-motion` / `motion-dom` / `motion-utils`），以及 `@types/three` 带进来的
> 6 个**仅类型**依赖（`@dimforge/rapier3d-compat` 是 Apache-2.0，其余 MIT）。
> `lucide-react` 本来就在树里（`apps/web` 在用），未新增。
> 两道门都过：许可全在白名单内；维护性上 `three`（116k★，2026-09-25）与
> `motion`（34k★，2026-09-25）都在活跃维护。
>
> ⚠️ **落地页刻意没有引入 GSAP。** 它不是 OSI 许可：发布包里**没有 LICENSE 文件**，
> `package.json` 的 license 字段是散文（`Standard 'no charge' license`），
> 归属 Webflow 且保留随时修改或终止的权利。按 §3.2 白名单它落进"白名单外"，
> 而这一档**默认失败**。同一判断也排除了 `@splinetool/*`（无 LICENSE 且仓库非公开）
> 与 `@theatre/studio`（AGPL-3.0）。滚动驱动因此改用 Motion 的 `useScroll` + CSS sticky，
> 3D 改用 `three` 手写渲染循环。

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
