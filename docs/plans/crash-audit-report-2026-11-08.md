# 崩溃审计报告 · heyta（2026-11-08）

> 🔴 **本报告不声称"零崩溃"，也不声称"证明了无崩溃"。** 静态审计在原理上无法得出这个结论。
> 本报告给出的是：**已复核的缺陷清单 + 已定位的结构性根因 + 明确的未覆盖边界**。

---

## A. 审计范围与覆盖边界

### A.1 仓库与分区

单仓库 monorepo（pnpm workspace，17 个包 + 1 个 server + 8 个客户端壳）：

| 层 | 路径 | 实测规模 |
|---|---|---|
| 共享核心 | `packages/{op-log,domain,storage,sync-core,sync-client,app-host,ai,local-api,inbound-core,widget-core,shared-schema}` | ~12 MB TS |
| 服务端 | `server/`（Fastify + Prisma + PostgreSQL） | 6.5 MB / 422 文件 |
| 客户端壳 | `apps/{web,mobile,desktop,node-host,desktop-macos,desktop-windows,landing}` | ~14 MB（含 182 个原生源文件） |

分区产物：`audit_plan.json`（21 个单元，含 `unit_id / paths / tech_stack / entry_points / cross_unit_dependencies`）。
执行中因平台并发上限（8）与子代理失败，把大单元进一步切小，实际落地为 **15 个单元**。

### A.2 覆盖实况

| 单元 | 范围 | 状态 | 发现 |
|---|---|---|---|
| **U01a** | `storage/src/sqlite/**` | ✅ 完成 | 10（2 P0） |
| **U01b** | `storage` indexeddb + memory + db-op-log-store | ✅ 完成 | 14（3 P0） |
| **U02a** | `op-log` engine + state | ✅ 完成 | 3（1 P0） |
| **U02b** | `domain` events / date / activity-categories / habit-review | ✅ 完成 | 5（3 P0） |
| **U02c** | `domain` recurrence / reminders / ticktick-import | ✅ 完成 | 3（0 P0） |
| **U03** | `sync-core`（含 compression / encryption） | ✅ 完成 | 6（2 P0） |
| **U04a** | `sync-client` | ✅ 完成 | 9（3 P0） |
| **U04b** | `ai` | ✅ 完成 | 8（2 P0） |
| **U05a/b/c** | `app-host` 切片（actions / admin / ai-* / entitlement / central-auth / inbound-* / vault / share） | ✅ 完成 | 20（1 P0） |
| **U06a** | `app-host` vault + share | ✅ 完成 | 8（1 P0） |
| **U07** | `local-api` + `inbound-core` + `widget-core` | ✅ 完成 | 14（0 P0） |
| **U08a** | `server/src/sync` routes / conflict / replay / quota | ✅ 完成 | 5（0 P0） |
| **U08b** | `server/src/sync/services` | ✅ 完成 | 4（1 P0，**已证伪**） |
| **U09/U10** | `server` billing / central-auth / api.ts / 其余 | ⛔ 未完成 | — |
| **U11/U12** | `apps/desktop` + `apps/node-host` / `apps/web` | ⛔ 未完成 | — |
| **U13–U21** | mobile / web features / ui / 原生壳 / landing | ⛔ 未派发 | — |

**合计：15 个单元完成，约 101 条发现，其中 18 条被标为 P0。**

### A.3 覆盖边界（**这一节比上面的表更重要**）

**完全未审计：**

| 面 | 为什么这是最大的风险 |
|---|---|
| `apps/web`（6.1 MB） | 用户看到的"白屏/闪退"绝大多数发生在这里：ErrorBoundary 是否存在、启动引导失败、SW 缓存白屏。**零覆盖** |
| `apps/mobile`（3.5 MB + 原生） | React Native 崩溃 + 5 个原生桥 |
| `apps/desktop` / `node-host` | Electron 主进程崩 = 整窗闪退；`uncaughtException` 是否注册 |
| 6 个原生壳（Swift / C# / Kotlin / ArkTS / C / GTK） | native 崩溃边界，**零覆盖** |
| `server/` billing + central-auth + `api.ts`（2925 行） | 公网暴露面，支付回调是未认证入口。**零覆盖** |

**排除项：** `node_modules / dist / build / obj / bin / .build / generated / **/*.generated.ts`、
`packages/x|y`（空）、`research / scripts / docs / e2e / evidence / probe`、`apps/desktop-linux`（未分配单元）。

---

## B. P0 缺陷清单

### B.1 🔴🔴 一条 `__proto__` 键让应用**永久无法启动**

**这是本次审计最重要的发现。它不是理论风险，机制已逐行核实，且触发物是一段普通 JSON。**

| 项 | 值 |
|---|---|
| 缺陷类 | `unhandled-exception` → 冷启动永久失败 |
| 位置 | `packages/op-log/src/state.ts:589`（根因）；`engine.ts:869-872`、`engine.ts:1003`、`host.ts:540`（放大链） |
| 外部可触发性 | **高** —— 导入一份备份 JSON 即可 |
| confidence | **confirmed（机制/缺 catch/落盘顺序均已逐行核实）** |

**根因（`state.ts:588-591`）：**
```ts
const addFieldVersion = (key: string, value: unknown, deleted: boolean): void => {
  const versions = (fieldVersions[key] ??= []);
  addUnique(versions, { meta: currentMeta, value, deleted });
};
```
`fieldVersions` 是普通对象。若 op 的 payload 里出现 `__proto__`、`constructor`、`toString`、
`valueOf` 等**任何 `Object.prototype` 上的成员名**，则：

1. `fieldVersions['constructor']` 读到的是**继承来的** `Object` 函数（truthy）；
2. `??=` **不会**赋值（左值已"有值"）；
3. `versions` = 那个函数 → `addUnique` 里 `versions.some(...)`（`state.ts:268`）
   → **`TypeError: versions.some is not a function`**。

**为什么能到盘上（`engine.ts:856-872`）：**
```ts
for (const op of ops) {
  validateReminderOwnerOperation(op);
  if (isFullStateOperation(op) || hasTaskBatchMarker(op.payload) || ...) {  // ← 只覆盖三类
    applyOperation(emptyState(), op);
  }
}
const result = await this.options.store.appendImported([...ops]);   // ← 普通实体 op 未校验就入盘
await this.recoverLocked();                                        // ← 在这里炸，但已经晚了
```
源码注释自己写着 `"Otherwise a bad backup poisons every subsequent cold start"` —— 
**而这个防护恰好漏掉了普通实体 op**（普通 op 的 payload 只被 `if (payload === null || typeof payload !== 'object') return state;` 这种弱检查放行）。

**为什么不可恢复（`host.ts:540`）：**
```ts
await engine.recover();     // 无 try/catch，且在 vaultStore / vaultSession 一切初始化之前
```
`recover()` → `recoverLocked()` → `engine.ts:1003` `applyOperation(this.state, record.op)`
（回溯循环无 try/catch）→ 抛 → `openAppHost()` reject → **宿主对象不存在，没有任何 UI 能报错**。

**完整触发路径：**
> 用户在导入面板选一份备份 JSON（或同步对端送来一条 op）→ payload 含 `"constructor"` 键
> → `appendImported` 落盘 → `recoverLocked` 抛 TypeError → 本次导入失败
> → **此后每次启动都在同一处炸** → 重装无效（数据在本地库）。

**验证要点（可复现）：** `JSON.parse('{"constructor":1}')` 会生成**自有属性** `constructor`，
`Object.entries` 会枚举到它 —— 所以这段 JSON 完全合法且能穿透到 reducer。

**消除器（推荐）：**
1. `fieldVersions` / `entityVersions` 一律用 `Object.create(null)` 或 `Map` 承载 ——
   **一个改动让整类"原型链污染致 TypeError"不可能再发生**；
2. reducer 返回 `Result<State, OpError>`，永不 throw；
3. `recoverLocked` 把失败 op 持久化为 `quarantined` 并跳过，向 UI 上报计数；
4. `importOperationsLocked` 改为**先全量校验（含普通实体 op）再 append**，或 append 失败则回滚已追加行。

---

### B.2 🔴 一条坏远端 op 永久杀死同步（永不隔离）

| 项 | 值 |
|---|---|
| 缺陷类 | `unhandled-exception` → 同步永久失效 |
| 位置 | `packages/op-log/src/engine.ts:769-777` |
| 外部可触发性 | **高** —— 任何一台设备、任何一次服务端脏数据 |
| confidence | **confirmed** |

```ts
private async applyRemoteLocked(ops: Operation<string>[]): Promise<RemoteApplyResult> {
  if (ops.length === 0) return { applied: [], skipped: 0, overwritten: [] };
  for (const op of ops) {
    validateReminderOwnerOperation(op);                    // 可 throw
    if (isFullStateOperation(op) || hasTaskBatchMarker(...) || ...) {
      applyOperation(emptyState(), op);                     // 可 throw（B.1 的 TypeError 也在这里）
    }
  }
```
**整个循环没有 try/catch。**

后果链：throw → `sync-client/src/client.ts:1399` `await this.options.applyRemote(decoded)`（无 catch）
→ `sync()` 顶层 catch（`client.ts:1017`）接住 → 返回 `{kind:'error'}`
→ **但该 op 既未落盘也未隔离，游标不推进** → 下次 `sync()` 拉到同一条 op → 再抛
→ **同步永久停在错误上**，用户看到的与网络抖动无法区分，重试一万次都一样。

**消除器：** ingress 循环把校验失败转成**逐 op 拒绝结果**（`{opId, reason}[]`），
**并把被拒 op 持久化**（否则游标不推进的重拉会无限重复）；`sync()` 把它作为**终态**上报。

> 🔴 B.1 与 B.2 共享同一个根因：**reducer 会 throw，而没有任何一层准备接住它**。
> 修 B.1 的消除器（reducer → Result + null-prototype 桶）会同时消掉 B.2。

---

### B.3 🔴 错误规范化自身会抛错，把 catch 变成新的崩溃点

| 项 | 值 |
|---|---|
| 缺陷类 | `unhandled-exception`（二次抛） |
| 位置 | `packages/storage/src/errors.ts:92` |
| confidence | **confirmed** |

```ts
export function storageError(cause: unknown, fallbackMessage: string, failure: StorageFailure): StorageError {
  if (cause instanceof Error) return new StorageError(cause.message, failure, cause);
  if (cause === undefined || cause === null) return new StorageError(fallbackMessage, failure);
  return new StorageError(String(cause), failure, cause);      // ← String(cause) 可抛
}
```
对 `Object.create(null)`（无 `toString`）或 toString 自身的对象，`String(cause)` 抛
`TypeError: Cannot convert object to primitive value`。
**它是在 catch 块里被调用的** —— 于是"处理错误"这件事本身变成了新的未捕获异常，
并且会跳过事务的清理逻辑（子代理 U01b 描述为"挂起事务"）。

**消除器：** 所有错误规范化走一个**自身不可能抛**的 `safeMessage(cause)`（内部 try/catch + 类型白名单），
并加一条 `check:error-normalizer-total` 门禁。

---

### B.4 🟠 重试调度器的 `.then` 无 `.catch`，`run()` 拒绝即未处理 rejection

`packages/sync-client/src/client.ts:2034`
```ts
timer = setTimeout(() => {
  void run().then((status) => { ... schedule(); });
}, delay);
```
`void` 丢弃了 `.then` 产出的 promise。`run()` 一旦 reject（而非返回 error status），
就是一条 **unhandled rejection**。Node 22 默认 `--unhandled-rejections=throw`；
浏览器侧它会静默消失但把状态机卡在"永不重试"。

**结构性缺陷，已核实形状；`run()` 的实际 reject 概率未取证。**

---

### B.5 🟠 恢复路径的三个 throw 点（B.1 的放大器）

`packages/op-log/src/state.ts`
- `:362` `throw new Error('Unsupported full-state operation: ...')`
- `:375` `throw new Error('Invalid full-state operation: ...')` 与 `assertCovered`（`Full-state metadata exceeds its causal boundary`）
- `:667` `parseTaskBatchOperation(op)` → `shared-schema/src/task-batch-contract.ts:84/87` 两处 throw

它们都在**回放路径**上被调用，而回放路径（`engine.ts:1003`、`:1047`）**无 try/catch**。
`host.ts:540` 的 `await engine.recover()` 同样无 try/catch。

> 与 B.1 的区别：B.1 是**普通实体 op**（完全未校验就入盘），这里三类 op 在入盘前**有**校验，
> 但校验用 `emptyState()`、回放用真实累积状态 —— 两者目前恰好等价，
> 而 `task-batch-contract.ts:86` 把 op 的**持久化身份**绑死在**当前版本的 id 派生算法**上，
> 算法一变历史 op 全部回放失败。此外 `checkpoint.formatVersion` 恒为 1、从不 bump，
> 旧 reducer 语义写出的快照会被新版本**直接信任**而不回放。

---

## C. P1 缺陷清单（已复核，按影响面）

| # | 位置 | 缺陷 | 说明 |
|---|---|---|---|
| C1 | `op-log/src/engine.ts:489-494` | `dispatchChecked` 返回值谎报成功 | 成功时返回的 `value` 是 build 阶段基于旧快照算的，调用方当"已提交"用 |
| C2 | `op-log/src/engine.ts:599` | `result.ops[0]!` 在 batch 对账路径取到**原始 op** 而非 inverse op | 重做栈记录错三元组，下次重做写错字段 |
| C3 | `app-host/src/import-dump.ts:160` | `JSON.parse` 前**无长度上限**，之后全量重放**两遍** | 500 MB 备份 = OOM kill（Hermes 堆更小） |
| C4 | `import-dump.ts:475` / `export-dump.ts:453` | `sortKeysDeep` 递归无深度上限 | `{"a":`×10000 → `RangeError`，从"永不 throw"的函数里逃出 |
| C5 | `domain/src/recurrence.ts:182` | `catch { return out; }` 返回**被截断**的日期数组 | `occursOn` 把它当完整结果 → 重复任务停止推进 |
| C6 | `domain/src/recurrence.ts:316` | `maxIterations` 随 `diffDays` 无界放大 | `repeatDtstart: '1900-01-01'` + `FREQ=SECONDLY` → UI 线程挂死 |
| C7 | `app-host/src/inbound-worker.ts:383` | commit-proof 日志**从不清理**（`remove()` 全包零引用） | 单行 META 无限增长，每次 save 重写整个 blob（O(n²) 写） |
| C8 | `app-host/src/host.ts:1202` / `:1211` | 声明 `| undefined` 但实际 `throw` | 两处都在 UI 事件路径上 |
| C9 | `app-host/src/inbound-worker.ts:182/198` | `leaseGeneration/attempt/ruleVersion` 只判 `typeof number`；`maxItems` 无上限 | `3.7` 当 CAS token → 租约永不续期；同语义在 `inbound-rules-remote.ts:60` **有**校验 |
| C10 | `app-host/src/ai-tool-run.ts:133` | `stableJson` 递归无深度/环检测，输入注释写明"不做 schema 校验" | 模型输出深层嵌套 → `RangeError` 从"永不抛"的函数里逃出 |
| C11 | `app-host/src/ai-assistant.ts:972` | 工具观测**无截断**进对话，字节预算在两次分配**之后**才检查 | 2 万条任务的列表 = OOM |
| C12 | `app-host/src/actions.ts:112` | `update()` 不校验实体存在 | 6 个动作裸调；`setTags` 是唯一守卫的 |
| C13 | `local-api/src/server.ts:321-359` | `handle()` 整个 switch 无 try/catch | 靠 2 个壳各自写 catch 维持；新壳漏写 = 进程终止 |
| C14 | `local-api/src/tools/task.ts:298`、`event.ts:157` | `limit` 未过 `clampListLimit` | 5 个列表工具中这 2 个漏了，`1e308` 直达 SQL 绑定 |
| C15 | `local-api/src/tools/task.ts:379-391` | `fields` 只判 `typeof === 'object'` | 数组通过 → `Object.entries` 产出 `0:'a'` 伪字段 |
| C16 | `widget-core/src/selectors.ts:164` | `buckets[slot].slice()` 无 `?? []` | 文件头承诺"四键永远在"，但承诺的执行点不在本文件 |
| C17 | `widget-core/src/selectors.ts:296-300` | 未知 token 静默产出 `undefined` | `JSON.stringify` 丢键 → 下游判 `malformed-section` → **整份快照被拒**，日志不含 token 名 |
| C18 | `inbound-core/src/parser.ts:13` | `copy()` 递归无上限 + `localeCompare` 排序 | 跨 ICU 版本算出**不同 digest** → 签名校验偶发失败 |

> 另有约 60 条 P1 在 `.audit-crash/units/*.json` 中（storage 事务/worker 桥、sync-client 并发守卫、
> ai 的 SSE 无界缓冲、app-host 的 share 密钥竞态、server sync 的配额与清理等），本表只列已复核的主干。

---

## D. 消除器清单（按消除的缺陷类分组）

### D.1 消除「reducer 抛错 → 启动/同步永久失败」 ← **最高优先级**

| 受影响位置 | 结构性修复 |
|---|---|
| `state.ts:589`（`fieldVersions[key] ??=`）、`:262-285`（`addUnique`） | 字段/实体版本桶改用 **`Object.create(null)` 或 `Map`** —— 一次性消掉「原型链成员名 → TypeError」整类 |
| `state.ts:362/375/667`、`engine.ts:988/1003/1047` | reducer 返回 **`Result<State, OpError>`**，永不 throw |
| `engine.ts:856-872`（`importOperationsLocked`） | **先全量校验（含普通实体 op）再 append**，或 append 失败回滚 |
| `engine.ts:1003`（`recoverLocked`） | 失败 op **持久化标记 `quarantined` 并跳过**，向 UI 上报计数 |
| `host.ts:540`（`openAppHost`） | `recover()` 包 try/catch，进入「隔离恢复」模式而非 reject |
| `engine.ts:930`（checkpoint 校验） | 增加 **`reducerRevision`**，语义不匹配时强制全量回放 |

### D.2 消除「外部输入未校验直达业务层」

| 受影响位置 | 结构性修复 |
|---|---|
| `inbound-worker.ts:182/198` | 一个 zod `claimedEventSchema`；`maxItems` 复用规则层**同一个常量** |
| `ai-tool-call.ts`（`parseToolArguments`） | 按工具声明的 `inputSchema` 做 `safeParse`，让下游对象**已知浅层封闭** |
| `local-api/src/tools/{task,event}.ts` | `limit` 统一过 `clampListLimit`；`fields` 过共用 `rejectUnknownKeys` |
| `import-dump.ts:160` | 解析**前**判字节数、解析**后**立刻判 op 条数 |

### D.3 消除「递归处理不受信结构 → 栈溢出」

一处共享的**迭代式 canonical-JSON 序列化器**（显式栈 + 深度上限 + 码元键排序），替换：
`import-dump.ts:475`、`export-dump.ts:453`、`inbound-core/src/parser.ts:13`、`ai-tool-run.ts:133`。

### D.4 消除「错误吞咽掩盖语义丢失」

| 位置 | 修复 |
|---|---|
| `recurrence.ts:182/271` | 返回 `{dates, truncated, error?}`；`occursOn` 改直接迭代探测（命中即止） |
| `inbound-runner.ts:81` | `safeParse` + 独立 `modelResultSchema`，失败走 `nonRetryable` 终态，**在 `advance()` 扣次数之前**判定 |

### D.5 消除「异步错误无主」

| 位置 | 修复 |
|---|---|
| `inbound-worker-loop.ts:26`、`client.ts:2034`、`realtime.ts:296` | **受管 promise 集合**替代裸 `void`：进 `Set` → `.catch` 转 `onError` → `finally` 删除；停表时能看到未结算 promise 与 `lastError` |
| `local-api/src/server.ts:321` | `handle()` 整体 try/catch → `-32603` + **固定文案**（不回显 `e.message`） |
| `sync-client` 的 8 处 `response.json()` | 一个 `readJsonObject()` 区分 `transport` / `malformed` |
| `storage/src/errors.ts:92` | `safeMessage(cause)` 自身不可能抛 |

### D.6 消除「无界增长」

| 位置 | 修复 |
|---|---|
| `inbound-worker.ts:383` | proof 改**按事件分行** + 上传确认后 `remove(eventId)` + 启动扫除 |
| `op-log/src/state.ts:262` | 字段版本裁剪到**最大前沿 + LWW 赢家**；checkpoint 加体积上限，超限退化为全量回放 |
| `ai-assistant.ts:972` | 观测在**产出点**截断（16 KiB + 显式 `…truncated, N more`） |

---

## E. 未复核 / 已证伪 / 已降级的清单

### E.1 ❌ 已证伪（**对抗验证的实际产出**）

| 原报告 | 复核结论 |
|---|---|
| U08b-sync-services：`server/src/sync/services/websocket-connection.service.ts:681` `touchDevice` 丢弃 Promise → 心跳定时器致 unhandledRejection（标 P0） | **假阳性。** `sync.service.ts:726-731` 的实现是 `void this.deviceService.touchDevice(...).catch(err => Logger.debug(...))` —— 拒绝**已被捕获**，且该方法的文档明确写着 "must never fail"。子代理只看了调用点、没看被调用方 |

### E.2 ⬇️ 已降级（子代理标 P0，我降为 P1）

| 原报告 | 降级理由 |
|---|---|
| U02a：`state.ts:590` "reducer 字段键命中 Object.prototype 成员即 TypeError" 标 P0 | **机制成立且我把它升为核心 P0（见 B.1）** —— 但原报告把它归为"远端/导入先落盘后成重启毒丸"，我核实后**精确化了触发路径**：远端路径会在 ingress 被拦（→ B.2），只有 **import 路径的普通实体 op** 会落盘成毒丸（→ B.1）。两条分开报 |
| U05：`inbound-worker-loop.ts:26` `void tick()` 标 P0 | `tick` 内部**有** try/catch 同时罩住 `processOnce` 与 `isRunnable`，`onError` 自身再包一层。当前**不具备** unhandled rejection 条件。降为 P1（结构性脆弱：一次收窄就变 P0） |
| U03：`compression.ts:148` gzip 解压无输出上限标 P0 | 我**未亲自核实**解压路径是否真的没有 `maxOutputLength`/大小校验。按纪律标 `likely`，列入 E.3 |

### E.3 未复核的 P0（子代理上报，我**没有**打开 file:line 确认）

**按纪律，以下不代表已确认的崩溃路径，只代表"值得下一步优先复核"。**

| 单元 | 位置 | 声称的缺陷 |
|---|---|---|
| U01a | `storage/src/sqlite/sqlite-adapter.ts:689` | `iterate/count` 无视 limit，全表 `SELECT *` 后逐行 `JSON.parse` → OOM |
| U01a | `sqlite-adapter.ts:337` | 事务回调 `await` 后再调 `transaction()` 绕过 `syncDepth` 检测 → FIFO 队列永久自锁（自评 suspicious） |
| U01b | `indexeddb/indexeddb-adapter.ts:486` | 游标访问者异常逃逸 IDB 事件边界 |
| U01b | `db-op-log-store.ts:293` | op 读取默认无上限，可物化全库 |
| U02b | `domain/src/events.ts:180/196` | `nextEventOccurrence` 农历/公历路径均无 try → 抛穿到渲染层 |
| U02b | `domain/src/date.ts:137` | `parseLocalDate` 对外部 LocalDate 直接 throw，只读渲染路径全部裸传 |
| U03 | `sync-core/src/operation.types.ts:323` | payload 提取器对 `undefined/null` `actionPayload` 解引用 |
| U03 | `sync-core/src/compression.ts:148` | gzip 解压无输出上限 → 远端 gzip bomb OOM |
| U04a | `sync-client/src/share-payload-cipher.ts:124` | `keys.get(外部世代号)!` 缺世代即 TypeError |
| U04a | `sync-client/src/realtime.ts:296` | `void this.run()` 无 catch |
| U04b | `ai/src/routing.ts:1101` / `:646` | `invokeRouted` 等待在异常边界外；`requiredCapabilities` 词表外 feature 返回 undefined 后展开 |
| U06a | `app-host/src/vault-migration.ts:461` | 根轮换迁移把整份 inventory + 全部重加密结果同时驻留内存 |

### E.4 其余 suspicious（子代理自评，已记录在单元 JSON）

`history.ts:226`（墓碑/实体消失混为一谈）、`subtasks.ts:233/242`（`as Task` 断言）、
`timeline.ts:352`（原型链查表）、`entities.ts:536`（`Note.content` 必填但 reducer 不保证）、
`sqlite-adapter.ts:337`、`web-crypto.ts:149`、`conflict-resolution.ts:468`、`selectors.ts:164`。

---

## F. 向"零崩溃收敛"的下一步

### F.1 先修（按性价比）

1. **D.1 全部** —— 一次改动消掉「启动永久失败」+「同步永久死亡」两整类，且是后续一切错误处理的地基。
   `Object.create(null)` 那一条是最小成本、最大收益的单点。
2. **B.3 的 `safeMessage`** —— 十几行，消掉「错误处理本身会崩」。
3. **D.5 的三处 `void`** —— 都是小改动，消除「未处理 rejection 杀进程」。

### F.2 CI 门禁（防回归，不是修当前实例）

本仓库已有 300+ 个 `check:*`，风格是"每条门禁都要能自己红"。据此建议：

| 新门禁 | 判据 | 为什么必须有 |
|---|---|---|
| `check:reducer-total` | `state.ts` 的 `apply*` 函数体内**静态禁止 `throw`** | B.1/B.5 的本质是"reducer 会 throw"，人肉 review 拦不住新增 |
| `check:null-prototype-buckets` | 版本桶/字段桶的构造点必须是 `Object.create(null)` 或 `Map` | 这条是 B.1 的**唯一**根治点 |
| `check:no-bare-void-async` | 禁止 `void <async call>()`（白名单需注释理由） | `void tick()` / `void run().then()` 是这个形状；会随演进重新变成 P0 |
| `check:catch-boundaries` | 每个 `ipcMain.handle` / 路由 handler / JSON-RPC `case` 必须可追溯到 try/catch 或统一 wrapper | `local-api/server.ts:321` 靠"每个壳记得写 catch"维持，该约定会漂 |
| `check:recursion-depth` | 处理外部 JSON 的函数强制带 `depth` 参数 | 四处递归实现已各自漂移 |
| `check:declared-vs-throws` | 返回类型含 `| undefined` 的函数体内不得 `throw` | C8 那两处正是"类型说返回 undefined、实际 throw" |
| **测试（比门禁更重要）** | ① `recover()` 面对抛错 op 必须**成功启动**并隔离该 op；② `applyRemote` 面对畸形 op 必须**返回逐 op 拒绝**；③ `importOperations` 失败时**盘上不得留下坏 op**；④ payload 含 `constructor`/`__proto__` 的 op 不得致 TypeError | 目前 `server.spec.ts` 全文件 8 处 `throw` **全是测试自身断言**，没有一条驱动"host 抛错"或"超深/污染 JSON"。**没有能失败的用例 = 这些缺陷会原样回来** |

### F.3 明确不承诺

- 本报告**未覆盖**客户端壳、服务端计费/认证、原生边界、`apps/web` 与 `apps/mobile` —— 
  修完 D.1 不等于"不会闪退"。
- 101 条发现是**已识别**的缺陷，不是缺陷总集；其中 12 条 P0 仍待逐条复核（§E.3）。
- 静态审计**无法**证明零崩溃，只能证明"这些具体路径已被关闭"。

---

## G. 修复实况（2026-11-08 晚，已落地并验证）

### G.1 已修复（每条都配了**能变红**的测试，已实测变红）

| # | 缺陷 | 改动 | 判据 |
|---|---|---|---|
| **1** | **B.1 原型链键 → TypeError → 冷启动永久失败** | `state.ts`：版本桶改 `Object.create(null)`（`nullProtoMap`）；`materializeVersions` 跳过 `__proto__/constructor/prototype` 防止实体原型被换 | `packages/op-log/tests/prototype-key-poisoning.spec.ts`（9 条）—— 把 `nullProtoMap` 换回 `{}` ⇒ **9/9 全红** |
| **2** | **B.3 错误规范化二次抛错** | `storage/errors.ts`：新增 `safeToString()`，`String(cause)` 关进 try，兜底成 `[unstringifiable …]` | `storage/tests/storage-error.spec.ts` 新增 3 条 —— 换回 `String(cause)` ⇒ **2 条变红** |
| **3** | **B.5/E2 `openAppHost` 恢复失败无边界 + 连接泄漏** | `app-host/host.ts`：`recover()` 包 try/catch，失败时 **`adapter.close()`** 再抛可诊断错误（保留 `cause`） | `app-host/tests/host.spec.ts` 新增 1 条 —— 换回裸调用 ⇒ **变红**（且证明错误会裸穿成 `Unsupported full-state operation`） |
| **4** | **B.1 导入路径未校验普通实体 op** | `engine.ts`：`importOperationsLocked` 对**所有** op 无条件预演 `applyOperation(emptyState(), op)`，失败时**在任何东西落盘之前**拒绝，并把原始 message 并进错误 | 由 #1 的端到端用例覆盖（导入后 `recover()` 仍可跑完 + 原型未被污染） |
| **5** | **B.4 重试调度器 `.then` 无 `.catch`** | `sync-client/client.ts`：`.catch` 把一次意外 reject 当**可重试失败**继续退避（不是静默忽略） | `sync-client/tests/sync.spec.ts` 新增 1 条 —— 删掉 `.catch` ⇒ **变红**在 `unhandledRejection` 上 |

### G.2 回归验证（全绿）

| 包 | 测试 | typecheck |
|---|---|---|
| `op-log` | **170 passed** / 15 files | rc=0 |
| `storage` | **434 passed** / 8 files | rc=0 |
| `sync-client` | **176 passed** / 13 files | rc=0 |
| `app-host` | **2112 passed** / 130 files | rc=0 |

### G.3 复核结论：12 条"未验证 P0"**没有一条成立为 P0**

派了 5 个只读复核子代理逐条取证（其中一条在真实 Chromium 里做了实验）。结果：

| 原编号 | 判定 | 关键理由 |
|---|---|---|
| A1 sqlite iterate OOM | → P1 | `count` 无 range 时确实全表物化（与 `engine.ts:403` 契约相违），但 `iterate` 无生产调用方 |
| A2 事务自锁 | → P1 | 机制成立（`syncDepth` 在首个 `await` 处已复位），但全仓 `transaction()` 调用点都是顶层，无现存触发路径 |
| A3 IDB 游标异常逃逸 | → **证伪** | 真跑 Chromium：游标访问者抛出后事务**确实 abort**、`tx.error.name === 'AbortError'`，适配器已拒绝调用方 promise |
| A4 op 读取无上限 | → **证伪** | `getOpsSince` 两个生产调用方都传了上限（250 / maxOps） |
| B1 农历越表抛穿 | → P1 | 机制确认（`lunar.ts:47` 真的 throw，上游 4 个渲染点无 try），但需 1900–2100 表外日期 |
| B2 公历 `nextOccurrence` 抛穿 | → **证伪** | `recurrence.ts:206/226` 两处已 try，坏规则返回 undefined |
| B3 `parseLocalDate` 裸传 | → **证伪** | 接外部字符串的入口都做了 try（`safeLocalDate` / `localMidnight`），写侧也拦了 |
| C1 payload 提取器解引用 | → P1 | 解引用确实存在，但唯一使用它的函数**无生产调用方** |
| C2 gzip 炸弹 | → **证伪** | 无生产调用方；服务端真实路径 `compressed-body-parser.ts` 有压缩前 10MB + 解压后 30/60MB 双上限 |
| D1 share 世代 `!` 解引用 | → P1 | `!` 确实漏判（同文件 decrypt 路径有判空），但 `reencrypt` 无生产调用点 |
| D2 realtime `void run()` | → **证伪** | 抛错面被逐段 try 关死；仅测试注入的 sleep/伪造 WS 才能触发 |
| D3 ai 请求体在 try 外 | → P1 | 位置属实，但唯一 `managedTransport` 实现明确"不抛" |
| D4 `requiredCapabilities` undefined | → **证伪** | 前置 `config.routes[feature]` 为 undefined 时已早退，走不到展开点 |
| E1 vault 迁移 OOM | → P1 | 机制属实，但服务端 100 MiB 配额把峰值钉在 300–400 MB，仅"满配额 + 移动端 WebView"会崩 |
| E2 recover 半初始化 | → **P1（已修，见 G.1 #3）** | 确认无 try/catch 且 adapter 从不 close |

> **这条结果本身是审计纪律的价值证明**：如果当时把 12 条未经复核的 P0 直接写进计划，
> 会让团队花大量时间在 6 条不存在的崩溃上。**未复核的 P0 不得进最终计划。**

### G.4 尚未修（下一步）

| 优先级 | 项 | 为什么还没动 |
|---|---|---|
| 高 | B.2 sync ingress 逐 op 拒绝 + 隔离 | 要改 `RemoteApplyResult` 形状并让 `sync()` 上报终态，跨 `op-log` / `sync-client` 两个包，需先定契约 |
| 高 | D.1 reducer → `Result<State, OpError>` | 大重构，`applyOperation` 有 5 个回放调用点；现在有 #1/#3/#4 兜底，不再是"一定崩" |
| 中 | `inbound-worker-loop` 的 `void tick()`、`realtime` 的 `void run()` | 当前不可触发，但形状会随演进重新变成 P0；建议按 D.5 一并收敛 |
| 中 | `import-dump` 的解析前字节上限 / 递归深度 | 未改动 |
| 待补 | 客户端壳（web/mobile/desktop/原生）与服务端计费/认证 | **本轮零覆盖** —— 用户看到的闪退主要在这里 |

---

## H. 第二轮修复（2026-11-08 晚 · 补齐零覆盖面）

这一轮先把**零覆盖的五个面**审完（web / mobile / desktop+node-host / server / 原生壳），
再按"确认能杀进程 × 修复代价低"修。

### H.1 新增审计（5 个单元，全部完整返回）

| 单元 | 面 | 发现 | 其中 P0 |
|---|---|---|---|
| **U12** | `apps/web` + PWA | 13 | 6 |
| **U16** | `apps/mobile`（38 屏） | 13 | 2 |
| **U11** | `apps/desktop` + `apps/node-host` | 15 | 7 |
| **U10** | `server` 启动/配置/错误边界/auth | 9 | 1 |
| **U09** | `server` billing / central-auth / password / account / admin | 9 | **0** |
| **U18** | 4 个原生壳（Swift / C# / Kotlin / ArkTS） | 15 | 3 |

**U09 结论值得单独记**：支付回调这个**未认证公网入口**的防御是合格的 ——
`parseAs:'buffer'`、验签在 `JSON.parse` **之前**、`!ok` 一律 401 且不落
`PaymentEvent`、不存原文 payload、120/min 限流。**没有找到可触发的 P0。**

### H.2 这一轮修掉的（每条都有能变红的判据）

| # | 缺陷 | 位置 | 判据 |
|---|---|---|---|
| 1 | **Web 零 ErrorBoundary**：任意组件抛错整树卸载 → 纯白屏 | 新增 `apps/web/src/lib/error-boundary.tsx`，四条渲染出口全部包住 | `apps/web/tests/crash-barriers.spec.ts`（8 条） |
| 2 | **Web 零全局错误钩子**：`void` 掉的 promise、事件处理器、定时器抛错全部无声消失 | 新增 `apps/web/src/lib/fatal-hooks.ts`，在 `createRoot` **之前**安装 | 同上 |
| 3 | **两条 `?shell=` / `?slice=` 动态 import 无 catch** → root 永不渲染 → 品牌帧永久覆盖（正是安装包入口） | `main.tsx` 补 `.catch(renderFatal)` | 同上（源码级判据） |
| 4 | **`session.ready` 无超时** → worker 起不来则启动永久挂死 | `oplog.ts` 提取 `awaitWorkerReady`（race：ready / error / 15s 超时） | — |
| 5 | **splash 退场无上界** → 任何"root 永远为空"都变成永久品牌帧 | `boot-splash.ts` 加 12s 绝对上界 | — |
| 6 | **`deleteDatabase` 无 `onblocked`/无超时** → 注销 UI 永久挂起 | `local-data-destruction.ts` 补 `onblocked` + 8s 上界（如实报 blocked） | — |
| 7 | **`initPromise` 缓存拒绝态** → 失败后同页面无法重试 | `oplog.ts` 失败即 `initPromise = undefined` + 清半初始化 store/engine | — |
| 8 | **`ErrorScreen` 无重试入口** | 加 `onRetry` + 词条 | — |
| 9 | **移动端零 ErrorBoundary**：38 屏共用根，一处抛错整应用白屏 | 新增 `apps/mobile/src/ui/error-boundary.tsx`，`Root` 最外层包住 | 类型/构建 |
| 10 | **Electron 主进程零 `uncaughtException`/`unhandledRejection`**；4 处 `void window.loadFile/loadURL` | `apps/desktop/src/main.ts`：进程级处理器 + `guardedLoad`（失败落到窗口内可读页） | desktop tsc |
| 11 | **`bootHost` 用可空变量当锁** → 并发首请求开两个库连接（两个 writer 写同一份数据） | 改共享 promise 记忆化 + 失败清缓存 + `quitting` 守卫 | desktop tsc |
| 12 | **MCP stdio 无 EPIPE 兜底**；`onEnd` 的 async IIFE 无 catch；`cli-mcp` 入口 `void main()` 无 catch | `mcp-stdio-server.ts` + `cli-mcp.ts`：stream `'error'` 监听 + 写调用 try + 入口 catch | node-host 213 tests |
| 13 | **日志流无 `'error'` 监听** → 磁盘满/权限丢失 = 整个服务停掉（`LOG_TO_FILE` 部署） | `server/src/logger.ts`：`error` 监听 + 降级到 console + `safeStringify`（循环引用/BigInt） | server 3188 tests |
| 14 | **Android 小组件系统广播回调无 try** → KeyStore 失效（改锁屏密码）即「应用已停止运行」 | `WidgetClicks.onUpdate` 收口 + `WidgetAead.existing/delete` 归一成 null/静默 | — |
| 15 | **WinUI `async void` 事件处理器** → `ExecuteScriptAsync` 在 WebView 销毁时崩进程 | `MainWindow.xaml.cs`：`RunChromeMetricsSafelyAsync` 包装 | `dotnet build Heyta.Windows.Core` ✅ |
| 16 | **C# 门面 `Deserialize(...)!`** → 门面回 `"null"` 时裸 NRE | `AppApi.cs`：`DeserializeRequired` 带原始载荷的显式异常 | 同上 ✅ |
| 17 | **macOS 提醒回执恒 `false`** → 已投出的通知被当没投出 ⇒ **用户收到重复通知** | `ShellReminderBridge.swift`：返回真字典而非元组 | — |

### H.3 ❌ 尝试过但**回退**的改动（B.2）

把 `applyRemoteLocked` 的入盘前校验改成"逐 op 隔离 + `rejected[]` 跳过"。

- **诊断是对的**：一条坏远端 op 让整批 reject → `sync()` 只把它转成
  `{kind:'error'}` → 游标不推进 → 下次重拉同一条 → 永久失败。
- **修法被既有决定否决**：`packages/op-log` 的 **10 条用例当场变红**
  （`full-state-recovery` / `task-batch` / `engine`），它们明确断言这条路径
  必须 reject —— 那是 `ADR-0016` fail-closed 的判据。
  被跳过的若是 full-state / batch op，代价不是"少一条数据"，而是
  **可能丢掉整份库**。
- **已完整回退**（引擎 + sync-client + app-host 三处接线 + 结果类型），
  并把"别再改回去"写成判据：`packages/op-log/tests/apply-remote-fail-closed.spec.ts`（5 条）。

> 要真正解决"永久焊死"，缺的不是 try/catch，而是一份**隔离协议**
> （隔离表放哪、谁批准跳过、用户怎么知道、坏 op 怎么导出）—— ADR 级问题。

### H.4 第二轮**未修**（已确认但代价大 / 需决策）

| 面 | 项 | 为什么没动 |
|---|---|---|
| mobile | `resetTaskHostCache` 作废单例却不 close；屏幕以 `[]` 依赖持快照（原标 P0） | 🔧 **机制已修**（§H.8）：`useSyncExternalStore` 通道 + 21 屏迁移 + 9 条判据。🔴 **但降级**：§H.9.4 在真机上把通知整个摘掉（等价修复前）走完注销，**没有复现**「一读就 `AdapterDestroyedError`」—— 两种解释未分辨（树重挂 / 另有路径重开宿主）。⇒ 这是**结构缺陷**，不是「用户一定看到崩溃」。远端擦除那条路**仍未在设备上验**；判据 D 口径**待产品拍板**（§H.9.5） |
| macOS | `ScriptHost.call()` 用全局 `__done/__r/__e` 做落定协议 + 嵌套 RunLoop，**重入即静默错值**（P0） | **仍未动**：本机 `swift build` 被沙箱挡住，盲改会整端不可用 |
| ~~Windows~~ | ~~`HeytaWindows`（WinUI 工程）未在本机编译（只有 `.Core` 通过）~~ | ✅ **已验**（§H.8）：`windows-pc` 上 0 警告 0 错误，冒烟 39 条 ✅；**窗口未真的打开过** |
| desktop | `quitting` 只写不读；IPC 参数零运行时校验；`second-instance` 未判 `isDestroyed` | P1，改动分散 |
| server/billing | 9 条 P1，其中 3 条在**钱**的路径上：① `reconcile.ts` 的对账前缀与 adapter 写入前缀不一致 ⇒ `findUnsettledPaidOrders` **永远 0 候选**，日清日志打印 "settled 0 of 0" 看起来健康；② `expireStaleOrders` **无生产调用方** ⇒ 放弃支付的订单永久占着优惠券名额；③ 退款回调丢掉 `paidAmountMinor` ⇒ 部分退款按全额回收权益 | 需要产品/财务确认口径，不是纯代码修 |
| 各包 | 约 60 条 P1（storage worker 桥、sync-client 并发守卫、ai SSE 无界缓冲、share 密钥竞态…） | 本报告已逐条给出 file:line |

### H.5 回归验证（第二轮结束时的现量）

| 面 | 结果 |
|---|---|
| `apps/web` | **2840 passed** / 242 files |
| `apps/mobile` | **1327 passed** / 105 files |
| `apps/node-host` | **213 passed** / 14 files |
| `packages/op-log` | **175 passed** / 16 files |
| `packages/storage` | **434 passed** / 8 files |
| `packages/sync-client` | **176 passed** / 13 files |
| `packages/app-host` | **2112 passed** / 130 files |
| `server` | **3188 passed** / 183 files（含 .pglite 集成） |
| tsc | web / mobile / desktop / node-host / op-log / storage / sync-client / app-host / server / i18n 全 rc=0 |
| `dotnet build Heyta.Windows.Core` | ✅ 0 warnings 0 errors |
| 门禁 | `check:ui-language` ✅ / `check:layering` ✅ / `check:design-token-refs` ✅ / `check:safe-error-fallbacks` ✅ |

> 🔴 **更正（2026-11-08 晚）**：此前这里还写着 `check:crosslang-contract` ✅ —— **那是错的**。
> 这枚门禁自 `395c7db86`（2026-11-07）起**每次都是红的**，而原因与被测代码无关：
> Jint 里没有 `console`（契约打印「这一腿跳过」时直接 ReferenceError）；
> 补上之后又露出第二层 —— `vitest-shim.ts` 没实现那条断言用的 `toBeLessThanOrEqual`。
> 已修（`be53f4843`），现量「断言 69 条，通过 69 条，失败 0 条」。
> 记这一笔的理由：**一条恒红的门禁和一条恒绿的门禁一样没有价值**。

> ⚠️ 一条**偶发**：`server` 的 `.pglite` 用例里
> `the wrong passphrase refuses with exit 2…` 在一次并行跑里红过、重跑绿。
> 未定位是否为 flake —— 不要因为"第二次绿了"就当它没问题。

### H.6 第三批：钱的路径（server/billing，3 条静默错误）

这三条都**不崩溃**，但都属于"看起来一切正常、实际什么都没做"的失效 ——
比崩溃更难发现，因为它们留下了健康的日志。

| # | 缺陷 | 修法 | 判据 |
|---|---|---|---|
| 18 | **对账永远 0 候选**：`paycenter.adapter.ts` 自己拼 `payment.succeeded:<out_trade_no>`，而 `reconcile.ts` 按 `PAYMENT_SUCCEEDED_EVENT_PREFIX`（`payment_succeeded:`）关联（`payment_events` 表上**没有** `out_trade_no` 列）⇒ `findUnsettledPaidOrders` 永久 0 候选，日清日志打印 "settled 0 of 0" | 成功事件改走唯一拼装点 `buildPaymentEventId()`（`payment-event-id.ts` 的文件头**正是**在警告这件事）；退款/退款失败仍带类型+状态前缀 | `billing-paycenter-adapter.spec.ts` 里那条断言改为 `${PAYMENT_SUCCEEDED_EVENT_PREFIX}SS-ORDER-1` —— 把 adapter 与 reconcile 钉在一起，改任何一边都红 |
| 19 | **优惠券名额永久泄漏**：`expireStaleOrders` **无生产调用方**（只有 `.pglite.spec` 调它），而它自己的注释写着"这是一个**必须真的在跑**的后台任务" | 接进 `sync/cleanup.ts` 的定时（与 `runBillingReconciliation` 同一处），**无条件打日志含 0**（跑了但扫到 0 与根本没跑，从日志上必须能分开） | server 全量 3188 |
| 20 | **部分退款被按整单回收**：`webhook.routes.ts` 只传 outRefundNo/status/providerRefundId，`paycenter.adapter.ts` 算好的退款金额在接线处**被丢掉** ⇒ 下游无法判定"是不是全退" | 三层透传（`RefundNotice.refundedAmountMinor` → `ApplyRefundResultInput` → `refund-store`），并加**检测告警**（金额 ≠ 冻结金额 ⇒ `Logger.warn`）。**不改会计行为** —— 回收口径是产品/财务决定，需要单独 ADR | `billing-paycenter-adapter.spec.ts` 断言 `refundedAmountMinor: 30` |

> 🔴 第 20 条刻意只做到"让缺口可见"：`refund-store.ts` 里那段
> "回收量必须等于当初授予的量，不许调用方凭手感改天数"是**刻意的设计**，
> 凭猜去改部分退款的会计口径，比留着可见的告警更危险。

另：`apps/mobile/src/db/open-host.ts` 的 `resetTaskHostCache` 现在会**先 `close()` 旧宿主**
再作废它（此前只清模块变量 ⇒ 原生句柄泄漏到进程退出）。
"32 个屏幕仍拿着死宿主"那一层需要一条宿主换代订阅通道，未做（见 §H.4）。

### H.7 第四批：资源上界与 `void` 收敛（目标项 ② ③）

| # | 缺陷 | 修法 | 判据 |
|---|---|---|---|
| 21 | **`JSON.parse` 前无大小上限**：2 GB 的"备份文件"会先读进内存再解析 ⇒ 移动端 OOM 杀进程 | `import-dump.ts` 加 `MAX_EXPORT_BYTES`（64 MiB），**解析之前**判，超限明确 `too-large` | `tests/import-dump-limits.spec.ts` —— 喂一段**非法 JSON** 的超长文本：先解析会报 `invalid-json`，先判大小才报 `too-large`。删掉那句 ⇒ **变红** |
| 22 | **解析后立刻判 op 条数**：原有的 `counts.totalOps === opLog.length` 自洽校验是在数组**已存在**之后，拦不住分配 | 加 `MAX_EXPORT_OPS`（50 万），在逐 op 循环之前 | 同上 |
| 23 | **递归规范化会爆栈**：`sortKeysDeep` 无深度上限，`{'a':`×10000 是合法 JSON | 加 `MAX_CANONICAL_DEPTH`（32）；超限时 `canonical()` 返回 `undefined`（不可比较）⇒ 调用方判"不一致"，**失败形状仍是布尔返回值**而不是异常 | ⚠️ **无区分性判据**（见下） |
| 24 | `inbound-worker-loop` 的裸 `void tick()`：当前 `tick` 内部有 try/catch 罩住一切，但"收窄那个 catch"是合理重构 ⇒ 立刻变 unhandled rejection | 收敛到 `runTick()`（第二层 `.catch` 转 `onError`），启动与 `setInterval` 都走它 | app-host 2116 |
| 25 | `realtime` 的 `void this.run()`：抛错面目前被逐段 try 关死，但那是**实现细节** | 补 `.catch`（静默 —— 该类刻意不依赖 logger）；`finally` 已复位 `running`，重连不会被卡死 | sync-client 176 |

> 🔴 **第 23 条如实标注"未覆盖"**：试过 5000 层与 20000 层两版判据都**不区分**
> （前者 Node 栈跑得完；后者 `stateMatchesDocument` 在到达 `canonical()` 之前就因
> "计数对不上"返回了 false）。要真测它得构造一份**自洽的深层物化状态**，
> 成本高于这条防御本身。所以**没有写一条假装覆盖它的测试** ——
> "删掉实现测试还是绿的"比没有测试更糟：它会让人以为有保护。
> 这条的上限依据是**代码形状**，不是一条会失败的用例。

---

## H.8 第五批：把「本机没法验」的那几格搬到远程载体上（2026-11-08 夜）

前四批里有一批结论是**我这边验不了**：Windows 壳要 Windows SDK、Android 要在真
模拟器上跑、而本机既不许起模拟器（`check:android-build-host` 的规则）也没装 Windows SDK。
这一批把它们挪到两台载体机上做，**并因此撞出四个新的缺陷** —— 后一件比前一件更值。

### H.8.1 载体与规则

| 载体 | 用途 | 现量 |
|---|---|---|
| `windows-pc`（ZeroTier `10.111.127.237`） | Windows 桌面壳 | .NET **10.0.401**；`api.nuget.org` 200；`github.com` 超时（所以源码走 scp 不 clone） |
| `linux-dev`（`Xaiver-linux`） | **Android 构建 + 模拟器＋设备侧验收** | 12 核 / 15 GB / `/dev/kvm` 可用 / 699 GB 空闲 |

> 🔴 规则已更新过（`scripts/run-gradle.mjs:29-33`）：2026-10-04 曾拍板「Android 一律
> `ssh windows-pc`」，**2026-10-28 改口为「整个安卓迁移到 Linux dev」**。
> 所以"在 linux-dev 上构建 + 起模拟器"是既定路线，不是绕开规则。
> 本机仍然**不起**任何模拟器与 Gradle 构建。

### H.8.2 Windows 壳：从「从未编译过」到 0 警告 0 错误

判据与读数（全文与日志见 `apps/desktop-windows/evidence/crash-audit-2026-11-08-winui-build.md`）：

| 判据 | 读数 |
|---|---|
| `Heyta.Windows.Core` | ✅ 产出 `Heyta.Windows.Core.dll` |
| **`HeytaWindows`（WinUI 3）** | ✅ 产出 `HeytaWindows.dll`，`0 个警告 0 个错误` |
| 无头跨语言冒烟（真 bundle + 真落盘） | ✅ **39 条 ✅**，末行「跨语言那一层 + 落盘 全部通过」 |

⚠️ 两个必须记下来的坑：

1. **`WindowsAppSDKSelfContained` 必须配 RID**。裸跑 `dotnet build` 报
   `WindowsAppSDKSelfContained requires a supported Windows architecture` ——
   csproj 里 `<Platforms>x64;arm64</Platforms>` 只是声明可用平台，不提供默认值。
   要 `-r win-x64`。**这是构建参数，不是代码缺陷**。
2. **`bridge-bundle/native-bridge.js` 不被 git 跟踪**（`.gitignore:151`），
   而 csproj 有 `RequireBridgeBundle` 会在缺它时构建期报错 ⇒ 传源码子集时必须单独带上它。

### H.8.3 移动端：宿主换代可订阅（§H.4 第 2 层，P0 主体）

19 个屏原来各自 `useState<AppHost>` + `useEffect(…, [])`，拿的是**快照**；
本机数据被销毁（主动注销，或**别的设备注销后同步读到信号** —— 后一条路根本不导航）之后，
`resetTaskHostCache()` 作废单例并 `close()` 掉 adapter，屏幕却永久攥着那个死实例 ⇒
下一次读/写 `AdapterDestroyedError`，且**不会自己好**。

修法（`f0edf7cca`）：`open-host.ts` 暴露 `subscribeTaskHostEpoch` / `getTaskHostEpoch`，
`resetTaskHostCache()` 在**清干净之后**通知；新增 `src/db/use-task-host.ts`；
21 个屏迁移（其中 `FocusScreen` / `VaultSettingsSection` 改成**渲染时现读当前代**，
宿主不进 state；`SearchScreen` 里绑在宿主上的 `noteActions` 改为随宿主派生）。

> ⚠️ 为什么不用「稳定的代理对象」：`getState()` 是**同步**的，代理在"新宿主还没打开"
> 那一帧没有同步答案 —— 只能抛，或**静默把旧库的数据给用户看**。后者更糟。

**判据**（`apps/mobile/tests/task-host-generation.spec.ts`，9 条）+ **三枚变异臂**，
每枚都实测**恰好**红在预期位置：

| 变异 | 结果 |
|---|---|
| M1 摘掉 `emitEpochChange()` | 「reset 必须真的通知订阅者」「一个订阅者抛错不许挡住其余订阅者」**2 条红** |
| M2 把 `useState<AppHost>` 写回任一屏 | 写法门禁第 1 条**红**（报出具体文件名） |
| M3 在空依赖 effect 里调 `openTaskHost()` | 写法门禁第 2 条**红** |

写法门禁**先剥注释再判**：这些文件的注释里会*引用*旧写法，
一条会因为说明文字而变红的门禁很快会被绕过而不是被遵守。

### H.8.4 🔴 这一批真正值钱的产出：**为跑验证而暴露的四个新缺陷**

| # | 缺陷 | 为什么此前一直看不见 | 修法 |
|---|---|---|---|
| 21 | `ExportImportFailureReason` 新增 `'too-large'` 后，web 的 `REASON_KEYS` 与 mobile 的 `RESTORE_FAILURE_KEYS` **两处 `Record` 穷举都没补** | **类型检查打在过期的 `dist/*.d.ts` 上**。`app-host` 重新构建之后才红 —— 「测试全绿 ≠ 这是当前产物」 | 补 4 条词条 + 2 处映射（`f64db2f43`），**不给 Record 加 default** |
| 22 | HEAD 引用了一个**未被跟踪**的文件：`main.tsx` 里 `desktop-chrome`（并行会话的半成品），干净克隆上 `tsc -b` 直接 `TS2307` | 我提交 `main.tsx` 时把别人工作树里的两行接线一起带进去了；而 `git add <file>` 看不见依赖是不是 `??` | 把那份**已通过 10 条测试**的实现一并提交（`ae590bbd1`）。删掉接线等于抹掉别人的成果，所以没那么做 |
| 23 | `apps/mobile/src/App.tsx` 用 `.js` 后缀导入新文件，**Metro 打包解析不到** | **只有 release 会红**：debug APK 不打包 JS，`tsc` 与 1336 条单测都会尝试 `.tsx` 而通过 | 改成无扩展名（与同文件其余导入一致，`b50f14ce9`） |
| 24 | `check:crosslang-contract` **自 2026-11-07 起恒红**（Jint 无 `console`；shim 缺 `toBeLessThanOrEqual`） | 恒红的门禁没人看。而我在 §H.5 里还把它记成 ✅ —— **那句是错的，已在该节更正** | 在**装置**侧补齐能力（`be53f4843`），不是改契约 |

四条里第 21、23 两条有同一个形状：**只有"按当前产物重新跑一遍"才会红**。
第 22 条是并发协作那条老规则的又一次现形。

### H.8.5 回归读数（第五批结束）

| 面 | 结果 |
|---|---|
| `apps/mobile` | **1336 passed** / 106 files（新增 9） |
| `apps/web` | **2840 passed** / 242 files（2 files / 13 tests skipped） |
| tsc | mobile `rc=0`；web `tsc -b` `rc=0` |
| `pnpm check:crosslang-contract` | **69/69**（此前恒红） |
| 门禁 | `ui-language` / `layering` / `design-token-refs` / `safe-error-fallbacks` / `docs` / `android-build-host` 全 ✅ |
| `dotnet build HeytaWindows -r win-x64` | ✅ 0 warnings 0 errors |
| `assembleRelease` | ✅ `app-release.apk` **69,816,704 字节**（此前红过两次） |

### H.8.6 Android 运行时：真模拟器上的五条判据

全文见 `apps/mobile/evidence/crash-audit-2026-11-08-android-release.md`。真 release 包
（JS 已打进 APK，**不依赖 Metro**），两台 headless 模拟器（zh-CN / en）。

| # | 判据 | 读数 |
|---|---|---|
| A | 两台都装得上起得来 | pid `26369`（5554）/ `4180`（5556） |
| B | UI 真的渲染（不是白屏/红屏） | 中文与英文两套界面截图均为真内容 |
| C | 5 个 tab 全走一遍不崩 | **pid 全程未变**；`FATAL EXCEPTION` 0，`AdapterDestroyedError` 0 |
| D | 经钩子取到的宿主**能写** | 新建任务后「1 项待办」、收集箱 1、tab 徽标 1 |
| E | 写入**真的落盘** | `adb root` 后 `sqlite3 … "select count(*) from ops;"` → **1**；库文件 **73,728 字节** |

⚠️ **关于 E 的取证诚实说明**：`tasks-zh.png` 与 `persist-after-restart.png` 的
sha256 **完全相同**，所以这两张截图**不构成**"重启后数据还在"的证据
（同一张静止界面重启前后必然一样）。真正的证据是两条互相独立的读数：
`force-stop` 后 `pidof` 为空、重启后 pid 变为 `26581`；以及**文件级**的 `ops` = 1 行。

### H.8.7 这一批**仍未证明**的事（不许含糊）

| 项 | 为什么还没验 |
|---|---|
| **「本机数据被销毁 → 屏幕恢复」的设备侧端到端** | 两个擦除入口都要真服务端。仓库既有的 `scripts/verify-mobile-account-erasure.sh` 要求 `$HOST_SERVER` **已经在跑**（不通时它自己说「环境未就绪，不是产品失败」）。本轮没起 Fastify + Prisma + PostgreSQL。⇒ 换代恢复目前由那 9 条判据 + 3 枚变异守着，**设备侧那一格待验** |
| **WinUI 窗口真的打开** | 全程 SSH，没在 Windows 上登录桌面去点它。只到「编得过 + 无头冒烟过」。`MainWindow.xaml.cs` 那处 `RunChromeMetricsSafelyAsync` 是否真挡住 `COMException`，仍未验 |
| **MSIX 打包** | 另一条腿（`scripts/package-msix.ps1`），需要签名与 packaged 形态 |
| **规模压测** | 只 2 台设备。内存实测已到边界（15 GB、13 GB 已用、swap 19 GB 在用），第三台 AVD 因端口冲突先死了一次，之后没有再试 |
| **macOS `ScriptHost.call()` 重入** | 本机 `swift build` 被沙箱挡住，无法编译 ⇒ 无法验证。两处 P0（Swift / C# 镜像）仍然开着 |
| 4 个原生壳的其余项、约 60 条 P1 | 见 §H.4 / §C，未动 |

### H.8.8 一句话结论

这一批把 §H.4 里**两格「本机没法验」**（Windows 壳 / 移动端宿主换代）变成了有读数的
**已验证 / 已修**，代价是暴露出 **4 个新缺陷**（两个"只有按当前产物重跑才会红"、
一个并发协作污染、一个恒红门禁）。
仍未验的三格（注销端到端、WinUI 窗口、MSIX）都是我**如实标出来**的，不是省略。

🔴 重复开篇那句：**这不构成"零崩溃"的证明。** 静态审计 + 有限运行时验证
能给的是"这一类缺陷已被消除，且判据能在它复发时变红"，不是"它不存在了"。

---

## H.9 第六批：真把「注销」在设备上跑了一遍 —— 结论对我自己不利，照实写

第六批的目标是补 §H.8.7 的第一格：**「本机数据被销毁 → 屏幕恢复」的设备侧端到端**。
跑法是 `linux-dev` 上起真栈（Postgres 16 容器 + `TEST_MODE` 服务端 + 真号），
`emulator-5554` 装 release 包，走真 UI 注销。

### H.9.1 栈怎么起来的（可复现）

```sh
# 1) 库：本机没装 Postgres 服务端二进制（只有客户端），docker 又要 sudo ⇒ 起一个隔离容器
sudo docker run -d --name heyta-e2e-pg -p 127.0.0.1:5432:5432 \
  -e POSTGRES_USER=$(whoami) -e POSTGRES_DB=heyta_mobile_smoke \
  -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16
# 2) 迁移：**必须**走仓库脚本，不许直接 prisma migrate deploy
cd ~/heyta-crash-audit/server && DATABASE_URL=postgresql://$(whoami)@127.0.0.1:5432/heyta_mobile_smoke sh scripts/migrate-deploy.sh
# 3) 栈（3000 被别的项目占着 ⇒ 换 3100；`PORT` 一处驱动服务端与设备侧地址）
cd ~/heyta-crash-audit && PORT=3100 bash scripts/mobile-e2e-up.sh
```

### H.9.2 先修掉一个**挡住了整条路**的可移植性缺陷（`965183030`）

`scripts/lib/mobile-e2e-fresh-account.sh` 那一发 psql 写死了 `-U rocalight`（macOS 主检出的用户）。
搬到 `linux-dev`（用户 `xaiver`）之后查询连不上 ⇒ `count` 是空串 ⇒ 判据报
「账号 client 预算不足 —— 换号后重跑」，**而一行产品代码都没参与**。
同一类写死在本仓已被修过两次（`lib/mobile-e2e.sh:57-61`、`verify-mobile-due-time.sh:791-795`
都留着这条教训），这是漏掉的第三处。改后 `client 数 0 < 20` ✅。

### H.9.3 🔴 我修的东西引入了一个真机才看得见的回归，已修（`9eaeafc6f`）

第一版 `resetTaskHostCache()` 是**同步**通知订阅者的。真机上走完注销，第一屏是：

```
打开本地数据库失败
技术细节：本地数据库恢复失败：读不出已存在的操作日志…
```

同一台设备上：`pragma integrity_check` = **ok**、`ops`/`state` 都是 0 行、**杀进程重开一切正常**。
⇒ 是**瞬时竞态**：仍挂载的 4 张 tab 在同一 tick 重开宿主，撞上 `adapter.destroy()`
刚返回之后的收尾（原生 `close()` / 文件删除的后半段）。改成把通知推到下一个宏任务。

判据：新增一条专门钉「**必须是延后的**」，变异 M4（改回同步）实测**恰好 1 条红**。
这条判据的存在理由要单独记：**库本身是好的，所以任何只测数据的判据都看不见这个回归** ——
只有"用户第一屏看到什么"看得见。

改后同一流程：第一屏是「**还没有任务**」，`ops=0 / state=0 / meta=1`、`integrity=ok`、
错误屏命中 **0**、`FATAL` **0**。

### H.9.4 🔴🔴 但原 P0 **在注销路径上没有复现** —— 这一条必须写清楚

我把通知整个摘掉（变异 M1，**等价于修复前的行为**：屏幕拿到的还是那个死宿主），
重新打包、重装、重走同一条注销流程。结果是：

| 读数 | 修复版 | 变异 M1（等价于修复前） |
|---|---|---|
| 注销后第一屏 | 还没有任务 | **还没有任务** |
| `ops` / `state` | 0 / 0 | 0 / 0 |
| 库里 `heyta.sqlite*` 文件数 | 1 | **1** |
| 错误屏 / `AdapterDestroyedError` 命中 | 0 | **0** |
| 切过 4 个 tab 之后 | 正常 | **正常** |

也就是说：**"32 屏持有已作废宿主 ⇒ 注销后一读就报错"这条，在注销这条路上没有发生。**
两种可能的解释，我**没有**继续把它分辨到底：

1. **注销会让树重挂**（账号状态切换 ⇒ tab 整体卸载再挂回）⇒ 每个屏的 effect 重跑、
   重新取宿主 ⇒ 拿到的本来就是新的那一份，快照问题被重挂掩盖了；
2. 还有**另一条路径**在作废之后自己重开了宿主（库里那个空文件在**我没点任何东西**时
   就已经被建回来了，mtime 就是注销那一刻）。

⇒ 对报告的影响：§H.4 那一行我原来标的是 **P0（"任何读/写落到 `AdapterDestroyedError`"）**。
**注销这条路撑不住这个措辞**，已按 §H.9.2 降级改写。真正没被这条实验覆盖的是
**远端擦除**那条路（别的设备注销 → 本机同步读到 ACCOUNT_CLOSED → 擦除，**完全不导航**），
那才是屏幕会原地挂着的场景 —— 而它**仍未在设备上验过**（要自己控制两端令牌，本轮没做）。

机制层面的修复（换代订阅 + 21 屏迁移 + 9 条判据 + 4 枚变异）仍然成立且必要 ——
它消掉的是"屏幕持有快照"这个**结构**；但我不该把"结构缺陷"直接说成"用户一定看到崩溃"。

### H.9.5 🔴 判据 D 与「全新空库」契约**直接冲突**（需要产品拍板）

`scripts/verify-mobile-account-erasure.sh` 的判据 D 要求：
`/data/data/com.heyta/databases/` 下以 `heyta.sqlite` 为前缀的残留 **0 枚**。

而产品契约（计划 §10.188 / AGENTS 同段）承诺的是「这台设备回到**全新空库**」——
**空库必然有文件**。于是：

- 应用**正常**（注销后立刻重开一个空库）⇒ D **红**；
- 应用**坏着**（屏幕攥着死宿主、从不重开）⇒ D **绿**。

本轮两种实现的实测都落在"文件数 = 1"，因为重开不是我那条通知触发的（见 §H.9.4 第 2 条）。

我不打算为了让 D 变绿去改产品行为，也不打算顺手改 D —— **这是产品口径问题**：
"注销之后这台设备上允许不允许存在一个空的库文件？"
倾向的答案是"允许"（那就是 §10.188 的字面意思），届时 D 应该改成
「**没有明文行**（`ops`/`state` 都为 0）」而不是「文件不存在」，并在注释里写明
为什么原来的文件腿会与正确实现互斥。**但这句要产品负责人拍板，不由我改。**

### H.9.6 这一批**仍未**做到的

| 项 | 状态 |
|---|---|
| 远端擦除路径的设备侧复现 | **未做**（需自己控制两端令牌 + 在 app 里填配） |
| 判据 D 的口径 | **待拍板**（§H.9.5） |
| `verify-mobile-account-erasure.sh` 自己的第 2 步 | **跑不过**：它 `scroll_to_desc "写点什么…"` 假设当前屏是便签，实际停在「我的」⇒ 报「找不到便签输入框」。这是**装置**的导航假设问题，不是产品失败；同一台设备手动走同一步是通的 |
| MSIX / WinUI 窗口 | 同 §H.8.7，未动 |

### H.9.7 第二轮尝试：远端擦除这条路**没能验成** —— 原因是应用从未同步过

目标：走「别的设备注销 → 本机同步读到 `ACCOUNT_CLOSED` → 本地擦除」，
这条路**不导航**，才是屏幕会原地挂着死宿主的场景。

做法（全部在设备上实测，不是推理）：

1. 自带令牌建号：`POST /api/test/create-user` → 拿到 JWT（user id 6 / 7）。
2. 用 rig 自己的 `configure_sync_credentials` 把三元凭据填进界面 —— **5/5 ✅**
   （服务器地址 / 访问令牌 / 端到端加密口令 / 三个同时都在 / 界面认为已配置）。
3. 建 1–2 条任务 ⇒ `ops=1` 然后 `ops=2`（真落盘）。
4. **宿主机侧**注销：`DELETE /api/account` → `200`，同一令牌再请求
   `/api/sync/status` → **`410`**（`ACCOUNT_CLOSED` 信号确实发出去了）。
5. 重启应用等 35 s；再补一次写（写会触发一次同步）等 22 s。

结果：`ops` **一直是 2**，没有擦除；`logcat` 里 `ACCOUNT_CLOSED` 相关命中 **0**；
任务屏正常显示「2 项待办」；错误屏命中 **0**。

关键读数：「我的」页上那一格写的是「**尚未同步**」，并且账号区显示「**还没登录** / 注册/登录」。
⇒ **只填令牌并不会让这台设备去同步**；`/api/test/create-user` 的令牌配上之后，
界面仍认为没登录，同步一次都没发生过。于是 `ACCOUNT_CLOSED` 那条路径**根本没有被走到**，
判据自然无从谈起。

这一格要验成，缺的是"让模拟器上那个 app 真的完成一次同步"：
按界面结构应该在「我的 → 设置 → 同步与隐私」里点「立即同步」，
而我在这一步反复没把导航点对（`ensure_phone_sync` 报
「找不到 profile-entry-settings」/「同步按钮既不空闲也不在忙」）。
**这是装置/导航的坑，不是产品失败** —— 但也**不能**因此把它记成"验过了"。

⇒ 因此 §H.4 里 mobile 那一行维持 §H.9.4 的降级结论：
**机制已修且有判据；"用户一定看到崩溃"没有复现（注销路）；远端擦除路未验。**
