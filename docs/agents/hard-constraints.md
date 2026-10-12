<!-- 由 heyta/AGENTS.md 按作用域拆分而来（2026-10-12）。内容零删除。
     本文件是「硬性约束（违反即打回）」的完整规则（原文 §3 硬性约束）。返回入口：[`AGENTS.md`](../../AGENTS.md)。
     原始单体文件备份：`AGENTS.md.bak-full-2026-10-12`。 -->

## 3. 硬性约束（违反即打回）

### 3.1 可维护性门槛

引入任何第三方组件前，**必须确认它在 2021 年之后仍在持续更新**。否则排除，无论许可证多宽松。

```bash
python3 research/tools/ghinfo.py owner/repo    # 查最后提交/发版时间
```

已因此被排除的例子：`rrule.js`（停在 2023）、`cal-heatmap`（停在 2024）。
**不要因为它们"看起来成熟"就放行** —— 这个门槛是有意的。

### 3.2 许可证

- ✅ **允许**：MIT / Apache-2.0 / BSD / ISC / MPL-2.0 / 0BSD / Unlicense / CC0
- 🔴 **禁止**进入产品代码：**AGPL / GPL / LGPL / BUSL / FSL / Elastic License / SSPL / CC-BY-NC**
- **无 LICENSE 文件 = 无授权 = 一行都不能用**

每个依赖必须**逐项登记**。门禁：

```bash
node research/tools/license-inventory.mjs      # 非零退出 = 有不合格依赖
```

它扫描的是**实际安装的依赖树**，并已通过"注入假 AGPL 包"验证过**能失败**。

🔴 **白名单外默认失败。** 不在上面那张表里的许可（例如 `caniuse-lite` 的 `CC-BY-4.0`）
一律算**不合格**，除非在 `research/tools/license-inventory.mjs` 的 `REVIEWED_OTHER`
里**逐项登记它为什么可以接受**。加一条的成本是刻意的 —— 它逼人为这个许可做一次
真正的判断，而不是让它悄悄混进"全部宽松"里。

> **这条以前是坏的，而且坏得很典型**：脚本把"白名单外"（`other`）**只打印、不判定**，
> 打印完 `❔ 其他（需归类）: 1` 之后接着报 `结论：全部依赖均为宽松许可 ✅` 并退出 **0**。
> 也就是说**这一档永远不会失败** —— 而白名单想拦的，恰好就是不在表里的东西。
> 成因是失败判据被**抄了三遍**（`--json` / `--flagged` / 汇总）且三遍都漏了 `other`；
> 漂移就是从"同一个判断写三次"开始的，现在只有一个 `failing` 常量能决定失败与否。
> 已用 4 种注入验证会红，其中一种是"把 `CC-BY-4.0` 的登记拿掉"—— 它证明这条登记是
> **承重的**，而不是"CC-BY-4.0 被全局放行"。

> 已知雷区：`@nextcloud/cdav-library` 是 **AGPL-3.0-or-later**，已被上游生产代码引用。
> heyta 的 CalDAV 要么自研，要么换 `tsdav`（MIT）。**不要引入任何 Nextcloud 服务端组件。**

### 3.3 schema 与持久化字段

- **默认不 bump `CURRENT_SCHEMA_VERSION`**。bump 是近乎单向的栅栏、且即使安全也不免费（要长期养一条迁移链）。
- 新增语义要能用 **payload marker / 惰性标记**向前兼容 —— 理由是**磁盘上和服务端库里已经写进去的数据会长期存在**（我们自己的开发机、测试库、服务器库都算），不是"要救老用户"。
- 🔴 **给持久化模型新增"必填"字段会在 hydration 时炸**：已经落盘的数据里没有这个字段。
  **新字段一律写成可选（`?`）并给运行时默认值。** **TypeScript 只保护新数据，构建会绿，炸在运行时** —— 这才是要防的东西。

### 3.4 op-log 纪律（P1 起）

- **一个用户意图 = 一个 op。**
- **被回放/来自远端的 op 不得再次触发副作用。** 否则会出现"同步回来又写一遍"的双向灾难。
- **op-log 是唯一写入口**：UI 不得绕开它直接改状态。详见 [`P1 计划`](../../docs/plans/phase-1-single-client-loop.md) 的 D4。
- 多实体变更要**在一次操作里完成**，不要 fan-out 成多个 op。

> 依据：上游 `src/app/op-log/` 那 5 万行是**用真实故障换来的规格书**。改动同步逻辑前先读它，
> 但**移植语义，不要拷贝代码**（它绑定 Angular + NgRx）。

### 3.5 宿主外壳的边界（`packages/app-host`）

ADR-0003 §2.1 的分界线原来有个说不清的地方：把零件接起来算"业务逻辑"还是"平台外壳"。
结论是**两者都不是** —— 它是每个宿主都要做、且**一模一样**的管道。

所以：**`apps/*` 只允许有一处平台差异** —— 注入哪个 SQLite 驱动。

| 允许出现在 `apps/*` | 必须出现在 `packages/app-host` |
|---|---|
| `driverFactory: () => new NodeSqliteDriver(path)` | `SqliteAdapter` 的 schema 与初始化顺序 |
| 库文件路径 / 库名 | `clientId` 的读取与持久化 |
| UI 组件与平台 API | 同步游标读写、`SyncClientOptions` 的十几个回调 |
| | **任务 op 的构造**（`createTaskActions`） |

判断方法很直接：**这段代码里有没有任何一行在决定"业务上该怎么做"？**
有就是提取得不够。`addTask` 该写哪些字段、软删除发 `DEL` 还是改标志位、
清除字段该写 `null` 还是 `undefined` —— 全是产品语义，**一律不许出现在 `apps/`**。

> 实测代价：抽出来之前，`apps/web` 与 `apps/node-host` 各有一份任务 op 构造，
> 而且**已经漂移了**：`node-host` 用 `crypto.randomUUID()` 生成 entityId 且没有回退，
> 而 `apps/web` 用的是 `Date.now()+counter` 且有回退。移动端（Hermes）没有
> `randomUUID` 时会**在用户点"新建任务"的那一刻抛异常**。

**同形状的第二次，发生在同步接线上。** `SyncClientOptions` 有 12 个回调，
`packages/app-host` 与 `apps/web` 里**各写了一份，逐字相同、连注释都是复制的**；
clientId 的回退逻辑还真的漂移了（`randomId()` vs 自己写的 `Math.random()`）。
clientId 是 LWW 的决胜依据 —— 两份实现 = 两套裁决标准。
现已抽成 `packages/app-host` 的 `createSyncClient()`，并由
`pnpm check:layering` 钉住（4 条规则，已用注入违规验证能失败）。

> 教训：**"抽出了一个共享实现"不等于"重复被消除了"。** `ids.ts` 抽出来了、
> 文件头还专门列了一张漂移对照表 —— 但 `apps/web` 那份**从没被删掉**，
> 表里列着它，它却一直活在代码里。抽取的收尾动作是**删掉旧的那份并加门禁**，
> 不是写一个更好的新版本。

---
