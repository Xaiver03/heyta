# ADR-0027：客户端存储统一 = **SQLite everywhere**；web 走 `sqlite-wasm` + OPFS，**鸿蒙能力待实测**

> 状态：**已接受**
> 日期：2026-09-28
> 决定：**三端共用同一套 SQLite 存储契约。web 从 IndexedDB 迁到
> `@sqlite.org/sqlite-wasm`（Apache-2.0）+ OPFS 的 SyncAccessHandle Pool VFS。
> `SqliteDriver` 的同步接口一行不改 —— 依据是 SAH Pool 产出的 DB 对象方法本身同步（§3.2，一手核实）。
> 🔴 同时明确：**在鸿蒙上实测之前，不得把 FTS5 / sqlite-vec 当作鸿蒙端已具备的能力**；
> 检索能力必须做成**运行时能力协商**，而不是默认存在（§5）。**
> 依据：[ADR-0003](0003-multi-platform-strategy.md)（业务逻辑与框架无关）、
> [ADR-0024](0024-desktop-shell-and-ui-convergence.md) §2.6（鸿蒙 op-sqlite 版本差 10 个大版本）、
> [多端 UI 融合调研](../research/multi-platform-ui-fusion.md) §3.7 / §5.7

---

## 1. 背景与约束

### 1.1 一个不成立的前提

既有的技术选型里有一条隐含假设：**"三端一套 SQL"**。调研 §3.7 实测判定它**不成立** ——
浏览器端当时用的是 **IndexedDB，没有 SQL**。

后果不是"性能差一点"，而是两条**能力上的**缺失：

- **FTS5 全文检索在 web 上永远用不了**
- **AI 记忆检索天然只有 2/3 端可复用**（`research/ai-memory-db-2026-09.md` 的实测结论）

也就是说：**同一份产品能力，在 web 上要靠另一套实现去"假装做到"**，
而假装不出来的部分（检索质量）就成了端与端之间的真实差异。

### 1.2 一个容易搞混的关键区分

> **不能用 WASM 的是 Hermes（移动端 JS 引擎）**，
> 而移动端本来就有**原生** SQLite（op-sqlite，且已带 FTS5）。
> **浏览器是能吃 WASM 的。**

所以"web 换 sqlite-wasm"这件事**不触碰移动端的任何约束** ——
它只动 web，不改 `apps/mobile`、不改原生绑定、不改 `SqliteAdapter` 的逻辑。

### 1.3 不能违反的既有约束

1. **`SqliteDriver` 的接口是同步的**（`exec` / `run` / `all` / `close`，见 `sqlite-driver.ts`）。
   这不是随手定的：原生桥（JSI / NAPI）通常就是同步调用，
   而 `DbAdapter` 的并发契约由适配器内部的 FIFO 队列负责，**不依赖驱动**。
   如果为了 web 把接口改成 `async`，**三端的驱动实现和全部适配器逻辑都要跟着改** ——
   为了一个端，让另外两个端一起承担复杂度。
2. **适配器逻辑只存在一份**（ADR-0003 §2.2）。驱动接口窄，正是为了"同一套契约测试跑遍所有实现"。
3. **许可证必须是宽松许可**，且**先登记再引入**（AGENTS.md §3.1–3.2）。

---

## 2. 决策

**客户端存储统一到 SQLite。** web 端使用 `@sqlite.org/sqlite-wasm` +
**OPFS 的 SyncAccessHandle（SAH）Pool VFS**。

新增一个驱动实现 `packages/storage/src/sqlite/sqlite-wasm-driver.ts`，
只实现既有的四个同步方法；**`SqliteAdapter` 一行不改**。

---

## 3. 支撑决策的两组事实（一手核实）

### 3.1 包的硬事实

| 项 | 值 | 怎么得到的 |
|---|---|---|
| 版本 | **3.53.4-build1** | npm registry `dist-tags.latest` |
| 许可证 | **Apache-2.0** | 同上（宽松许可，白名单内） |
| 依赖数 | **0** | 同上 —— 不引入传递依赖面 |
| 发布日 | **2026-09-08** | 同上（在维护） |
| `dist/sqlite3.wasm` | **852 KB** | 实测文件大小 |
| `dist/index.mjs` | 628 KB | 实测文件大小 |

### 3.2 🔴 关键：SAH Pool 产出的 DB 对象，方法是**同步**的

这是整个决策能成立的前提，所以用一手证据说清楚，而不是引用二手描述：

- `installOpfsSAHPoolVfs()` **本身是异步的**（返回 Promise，一次性初始化池）。
- 但它 resolve 出的工具对象上挂着 `OpfsSAHPoolDb`，而
  `OpfsSAHPoolDb.prototype = Object.create(oo1.DB.prototype)`
  （`dist/sqlite3-worker1.mjs`）；
- `oo1.DB` 的方法签名是**同步**的，例如：

  ```js
  selectObjects: function(sql, bind) {
    return __selectAll(this, sql, bind, "object");
  },
  ```

  —— `function` 而不是 `async function`，直接返回结果。

**结论**：把"异步初始化"和"同步调用"分开看之后，`SqliteDriver` 的同步接口
**原样可实现**。初始化走一次异步，之后所有 `exec`/`run`/`all` 都是同步的。

> 🔴 **补充（实测修正，见 [ADR-0028](0028-web-sqlite-must-run-in-worker.md)）**：
> 上面这段结论**成立，但缺了一个前提 —— 这段代码只能跑在 DedicatedWorker 里**。
>
> 真浏览器实测：页面主线程上 `FileSystemFileHandle.prototype.createSyncAccessHandle`
> 是 **`undefined`**（规范里它是 `[Exposed=DedicatedWorker]`），
> 于是 `installOpfsSAHPoolVfs()` 在主线程必然报
> `Error: Missing required OPFS APIs.`。**Worker 里同一项是 `function`，一次通过。**
>
> 换句话说：**同步接口在 Worker 内部成立；跨到主线程的那一层必然异步**
> （postMessage 的性质，不是接口设计问题）。
>
> 另外 §6.1 把"OPFS 兼容面"列为代价时**没有区分**两条 VFS：
> 需要 COOP/COEP 的是**异步 `opfs` VFS**；我们选的 **SAH Pool 这条不需要**
> （实测 `SharedArrayBuffer` 为 `undefined` 也照样跑通）。这一项风险实际比 §6.1 写的小。

> ⚠️ 这条如果搞反（以为整个 API 都是异步的），结论会完全反过来：
> 会去改 `SqliteDriver` 的接口，进而牵动三端全部驱动与适配器。
> **一个二手描述里的"异步"两个字，代价是三个端。**

---

## 4. 被否决的选项

| 选项 | 否决理由 |
|---|---|
| **保持 IndexedDB** | 代价是**永久的**：web 永远没有本地全文检索，AI 记忆检索永远只有 2/3 端。这不是性能取舍，是能力缺失，而且**会随时间越来越贵**（其他端的能力继续长，web 停在原地）。 |
| **sqlite-wasm + 内存库，手工持久化** | 要自己把整个库序列化/反序列化。写入与落盘之间有**数据丢失窗口**，且库一大就退化。等于自己实现一个更差的 VFS。 |
| **sqlite-wasm + 默认 `opfs`（异步）VFS** | 它的调用面是异步的 → **必须改 `SqliteDriver` 的接口** → 为 web 一个端，把三端驱动与全部适配器一起改成 async。这正是 §1.3 第 1 条要避免的事。 |
| **第三方 wasm 封装（wa-sqlite / absurd-sql 等）** | 维护活跃度与长期可用性都不如官方 `@sqlite.org/sqlite-wasm`，而它由 SQLite 官方维护、零依赖。没有理由承担这个不确定性。 |
| **不做本地检索，改走服务端** | 直接违反离线优先与 E2EE。服务端拿不到明文，**在物理上就做不到**。 |

---

## 5. 🔴 鸿蒙：先划边界，不假装知道

[ADR-0024](0024-desktop-shell-and-ui-convergence.md) §2.6 已一手核实：

> 鸿蒙适配版 `@react-native-oh-tpl/op-sqlite` 是 **8.0.2**，
> 而仓库用的是 `@op-engineering/op-sqlite@^18.2.5` —— **差 10 个大版本**。

既有调研称"`op-sqlite` 已内置 FTS5 与 sqlite-vec"，但
**该结论是否覆盖 8.0.2，未核实**。

因此本 ADR 明确：

1. **不得**把 FTS5 / sqlite-vec 当作鸿蒙端已具备的能力 —— 既不写进契约、也不写进默认值。
2. 检索能力必须是**运行时能力协商**（探测 `sqlite_compileoption_used('ENABLE_FTS5')`
   或建表试探），拿不到就走降级路径，而不是让功能直接崩。
3. 三端契约测试**必须把"没有 FTS5"当作一个合法配置去跑** ——
   否则测试只在"有 FTS5"的机器上绿，等于把鸿蒙的失败推迟到用户手上。
4. 鸿蒙上到底有没有，**要么实测，要么在文档里显式标注"未知"**。
   这正是 M1 要求"鸿蒙在场"的同一个理由：**它是唯一不可回退的那一端。**

---

## 6. 后果

### 6.1 接受的代价

- **体积**：852 KB 的 wasm + 628 KB 的 JS bootstrap，且 wasm **必须单独作为资源**被
  正确打包与 MIME 分发（这是 web 构建要新增的一类失败模式）。
- **OPFS 兼容面**：依赖 `FileSystemSyncAccessHandle`，浏览器支持有下限。
  ⚠️ **Safari / Firefox 的实际行为本 ADR 未实测**（调研 §5.7 也把它列为未查项）。
- **数据迁移**：这是**不可逆层**的迁移 —— 用户既有的 IndexedDB 数据必须一次性导入。
- **web 端多了一个"初始化是异步的"启动阶段**：首帧与"库可用"之间出现一个窗口，
  UI 必须显式处理（否则又是一个"白屏但无报错"）。

### 6.2 换来的东西

- **一套存储契约跑三端**，同一套契约测试对所有实现生效。
- **FTS5 在 web 上可用** → AI 记忆检索从 2/3 端变成 3/3 端。
- **`SqliteAdapter` 一行不改** —— 窄接口的价值在这里兑现。

### 6.3 回退

IndexedDB 路径**保留到迁移验证通过之后**再删，两者可并存一个版本周期
（见计划的 M4-3）。

---

## 7. 落实与验收

| # | 事项 | 判据 |
|---|---|---|
| M4-2 | 实现 `SqliteWasmDriver`（只实现 4 个同步方法） | `packages/storage/tests/contract.spec.ts` 把新驱动也跑一遍 |
| M4-3 | 迁移 web 存储、删掉 IndexedDB 路径 | 契约测试三端同一套；FTS5 检索在真浏览器里可用 |
| — | 鸿蒙检索能力 | 实测，或显式标注"未知"并走降级路径 |

**尚未验证、不要当成已完成的事**：

- OPFS 的**接入**已在 Chromium 上跑通（`scripts/verify-web-sqlite.mjs`，含跨刷新持久）；
  ⚠️ 但**只在 Chromium 上验过**
- OPFS SAH Pool 在 **Safari / Firefox** 上的实际行为 —— **未实测**
- **鸿蒙端** FTS5 / sqlite-vec 是否存在 —— 未知

**已由后续 ADR 修正的条目**：

- 🔴 **"主线程能不能跑"** —— 不能。见 [ADR-0028](0028-web-sqlite-must-run-in-worker.md)。
- 🔴 **§6.1 的 COOP/COEP 代价** —— SAH Pool 这条路径**不需要**，风险被高估了。
