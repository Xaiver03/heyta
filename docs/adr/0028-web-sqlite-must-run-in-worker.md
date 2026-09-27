# ADR-0028：web 的 SQLite **必须跑在 DedicatedWorker 里**；主线程拿不到 OPFS

> 状态：**已接受**
> 日期：2026-09-28
> 决定：**`openSqliteWasmDriver()` 只能在 DedicatedWorker 中调用。**
> `FileSystemSyncAccessHandle` 的暴露范围是 `[Exposed=DedicatedWorker]`，
> **页面主线程上 `createSyncAccessHandle` 根本不存在** —— 在主线程调用
> `installOpfsSAHPoolVfs()` 必然失败。跨到主线程的那一层**必然异步**（postMessage 的性质）。
> 附带结论：SAH Pool 路径**不需要 COOP/COEP 跨源隔离**。
> 依据：[ADR-0027](0027-unified-client-storage-sqlite-everywhere.md)（存储统一决策）、
> 下面 §2 的一手实测证据

---

## 1. 背景

[ADR-0027](0027-unified-client-storage-sqlite-everywhere.md) 决定 web 端用
`sqlite-wasm` + OPFS 的 SAH Pool VFS，并核对了"异步初始化、之后同步调用"这一点，
结论是 `SqliteDriver` 的同步接口不用改。

那个结论**本身是对的，但不完整**：它没有回答"这段代码**在哪里**跑"。
本 ADR 补上这一条，因为缺了它的后果是**代码在主线程上根本跑不起来**。

---

## 2. 证据（一手实测，不是推测）

### 2.1 主线程与 Worker 的同一份能力探测对比

用真浏览器（Playwright + Chromium）逐项摊开 OPFS 能力，两次只差"跑在哪"：

| 能力 | 主线程（页面） | DedicatedWorker |
|---|---|---|
| `isSecureContext` | `true` | `true` |
| `SharedArrayBuffer` | `undefined` | `undefined` |
| `Atomics` | `object` | `object` |
| `WorkerGlobalScope` | `undefined` | `function` |
| `FileSystemHandle` | `function` | `function` |
| `FileSystemDirectoryHandle` | `function` | `function` |
| **`FileSystemFileHandle.prototype.createSyncAccessHandle`** | **`undefined`** | **`function`** |
| `navigator.storage.getDirectory` | `function` | `function` |

**唯一为 `undefined` 的就是 `createSyncAccessHandle`** —— 其余都齐。

主线程上探针稳定报的是一句笼统的话：

```
Error: Missing required OPFS APIs.
```

### 2.2 与上游源码对照（`dist/sqlite3-worker1.mjs:16992`）

SAH Pool 自己的入口检查是：

```js
if (!globalThis.FileSystemHandle || !globalThis.FileSystemDirectoryHandle
 || !globalThis.FileSystemFileHandle
 || !globalThis.FileSystemFileHandle.prototype.createSyncAccessHandle
 || !navigator?.storage?.getDirectory)
  return initPromises[vfsName] = Promise.reject(new Error("Missing required OPFS APIs."));
```

四项条件里，主线程只有 `createSyncAccessHandle` 那项为假 —— 与 §2.1 的探测**互相印证**。

### 2.3 工作区里跑通的结果

同一个探针改成在 Worker 里跑之后，一次通过：

```
② Worker 里的 OPFS 能力 → createSyncAccessHandle: "function"
③ SAH Pool VFS 已装上，驱动已打开
⑥ 读回 → [{"id":1,"note":"来自真浏览器 Worker"}]
⑦ 唯一冲突被判定 → true
⑧ 本运行时支持 FTS5 → true
⑨ 关闭两次都没抛（幂等）
```

并且**刷新页面后再读**：`④ 刷新前已有行数 → 1` —— 数据真的落在 OPFS 里，
不是内存。截图：`e2e/test-results/web-sqlite-opfs.png`。

### 2.4 ⚠️ 顺带纠正一个容易混淆的点

ADR-0027 §6.1 把"OPFS 兼容面"列为代价时，没有区分两条 VFS：

- **异步 `opfs` VFS**：需要 `SharedArrayBuffer` → **需要 COOP/COEP 响应头**。
- **SAH Pool VFS（我们选的这条）**：检查里**没有 `SharedArrayBuffer`**。

§2.1 的实测印证了后者：`SharedArrayBuffer` 是 `undefined`（没有跨源隔离），
**但 SAH Pool 照样装上并跑通了**。

**所以少了一整类部署风险**：不必为了让 web 存储能用而给全站加 COOP/COEP，
也就不会连带影响第三方资源、埋点、内嵌页面等对这两个头的敏感行为。

---

## 3. 决策

1. **`openSqliteWasmDriver()` 只在 DedicatedWorker 中调用。** 主线程调用是**不支持的用法**，
   不要为它加降级分支 —— 那条路在平台上就不存在。
2. **跨线程那一层必然是异步的**（postMessage）。这是通信介质的性质，
   **不是** `SqliteDriver` 接口设计的问题：同步接口在 Worker 内部完全成立，保持原样。
3. **不引入 COOP/COEP**（§2.4）。

---

## 4. 被否决的选项

| 选项 | 否决理由 |
|---|---|
| 在主线程硬跑，失败就降级到 IndexedDB | 那条路在平台上**根本不成立**（§2.1），不是"兼容差"而是"没有这个能力"。为一条不存在的路径写降级分支，只会让真正的失败被伪装成"降级了"。 |
| 改用异步的 `opfs` VFS（它的异步代理能跑在主线程） | 会把 `SqliteDriver` 的接口改成 async，从而**牵动三端的驱动与全部适配器**（ADR-0027 §1.3）；而且它**需要 COOP/COEP**，多一类部署风险。 |
| 给全站加 COOP/COEP，换主线程可用 | COOP/COEP 会影响第三方资源与内嵌内容的加载行为，代价远超收益；而 SAH Pool 路径**本来就不需要**它（§2.4）。 |

---

## 5. 后果

### 需要做的

`apps/web` 的存储层需要一个 **Worker 侧入口** + 主线程侧的异步调用层。
这属于 [ADR-0027](0027-unified-client-storage-sqlite-everywhere.md) 的 M4-3（迁移），
尚未实现。

### 明确的边界

- Worker 与 `SharedArrayBuffer` 的可用性**未在 Safari / Firefox 上实测**。
- 本 ADR 的结论**只在 Chromium 上有一手证据**；其余浏览器属于未验证。

---

## 6. 为什么值得单独写一份 ADR

因为它**不写在代码里**：`openSqliteWasmDriver` 的签名看上去在主线程也能调，
编译器不会拦，Node 侧测试也**永远碰不到**（Node 没有 OPFS，跑的是内存库那条路径）。

也就是说 —— **这个约束只有在真浏览器里跑一次才会暴露**。
一个"看起来能调用、Node 测试全绿、但在浏览器里必然失败"的接口，
正是最需要被记录下来的那种事。
