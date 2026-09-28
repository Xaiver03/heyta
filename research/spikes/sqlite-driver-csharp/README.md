# Spike：C# 同步 `SqliteDriver` + **真正的 TS `SqliteAdapter`**（Windows 原生的 W0-2）

> **结论（2026-09-28 实测，exit 0）**：**成立。**
> `packages/storage` 的 **`SqliteAdapter`（未改一行）** 在 **.NET 10 + Jint** 里，
> 跑在 **C# 提供的同步 `SqliteDriver`**（`Microsoft.Data.Sqlite` 10.0.12）之上，
> **契约里最容易挂的每一条都过了** —— 复合主键、唯一索引、`addToleratingDuplicate`、
> **multiEntry 索引**、事务提交与回滚。
>
> 复现：`bash research/spikes/sqlite-driver-csharp/run.sh`

---

## 这个 spike 在问什么

[多端原生构建计划](../../../docs/plans/desktop-native-migration.md) §2 的 D2 路线是：

```
WinUI 3 壳（C#） → 内嵌 JS 引擎 → 同一份 TS 业务与存储源码
                                    ↓ 只在这一层跨语言
                                  C# 同步 SqliteDriver
```

[ADR-0032](../../../docs/adr/0032-windows-native-via-rnw.md) 曾把"Windows 上要写一个
**同步** `SqliteDriver`"记成**全计划的门槛（C1）**。拆开看它其实是两件事：

1. **.NET 上有没有同步 SQLite？** —— 有。`Microsoft.Data.Sqlite` 是 ADO.NET，API 本来就全同步
   （[ADR-0034](../../../docs/adr/0034-windows-native-winui3-not-rnw.md) §1.4）。
2. 🔴 **跨语言同步调用 + 类型映射，能不能撑住那套契约？** —— **本 spike 验的就是这个。**

第 2 条才是真风险：契约里有**可选钩子**和**异常驱动的回滚**，
"能开库"完全不代表"能过契约"。

## 实测结果

```
微任务泵次数：0
=== probe 结果 ===
  · init（建 4 个 store + 索引） = ok
  · meta 往返 = {"key":"probe","value":42}
  · meta count = 1
  · state 复合主键 get = {"entityType":"task","entityId":"t1","title":"A"}
  · state getAll 条数 = 2
  · ops count = 2
  · ops by_entity 复合索引命中数 = 2
  · ops by_entityIds multiEntry 命中数（t2 只在 o1 里） = 1
  · ops by_applyStatus 命中数 = 2
  · 重复 opId 被拒 = True
  · 重复 opId 的错误文案 = SQLite Error 19: 'UNIQUE constraint failed: ops.ix0_0'.
  · 冲突后 ops count 未变 = 2
  · addToleratingDuplicate 吸收冲突 = {"ok":false,"reason":"duplicate"}
  · 事务提交后能读到 = {"key":"tx","value":"committed"}
  · 回滚：错误冒泡 = boom
  · 回滚：值必须不存在 = __undefined__
probe_ok=True
```

**C# 侧独立复核**（不信 JS 的自述，自己开一个新连接看盘上的库）：

```
index  ops__iix0_0   ops__iix1_0   ops__iix2_0   ops__iix4_0
index  archive__iix0_0
table  __heyta_seq  archive  meta  ops  ops__mt3  state
行数 meta = 2   state = 2   ops = 2
```

注意 `ops__mt3` —— 那是适配器为 **multiEntry 索引**自己生成的边表。
它出现了、也只有它出现了，说明适配器走的是它**本来**的那条路，没被宿主环境带偏。

### 为什么这几条值得单独测

| 用例 | 为什么它才是风险点 |
|---|---|
| `addToleratingDuplicate` = `{ok:false}` | 它依赖驱动的 `isUniqueViolation` 回退（按**错误文案/扩展码**认冲突）。宿主的异常文案一变，冲突就吸收不了，会变成"整条同步链断在一个重复 op 上" |
| `by_entityIds` multiEntry 命中 = 1 | multiEntry 在 SQLite 里没有对等物，适配器靠边表模拟 —— 最容易在跨语言绑定上悄悄错 |
| 复合主键 `['entityType','entityId']` | 键是**数组**，跨语言边界上最容易退化成字符串 `"task,t1"` |
| 回滚后读到 `undefined` | 回滚是隐式的（靠异常），不是显式 API |

## 两个真撞出来的坑（都会静默致命）

### 坑 1：`Microsoft.Data.Sqlite` 只认**具名**参数，而契约是 `?` 位置占位符

heyta 的 `SqliteDriver` 契约（`packages/storage/src/sqlite/sqlite-driver.ts` §29）原文：

> "`?:` 占位符按位置绑定 `params`"

而直接 `Parameters.Add(new SqliteParameter { Value = ... })` 会当场抛：

```
System.InvalidOperationException: ParameterName must be set.
```

⇒ **任何 Windows 侧的真驱动都必须做这一层翻译**：`?` → `$p0..$pN`。
本 spike 的翻译**跳过字符串字面量**里的 `?`（并处理 SQLite 的 `''` 转义）——
否则 `WHERE title = 'a?b'` 这种语句会被改坏，而且坏法是**多出一个参数**，
报错点离现场很远。

### 坑 2（更危险）：Jint 默认把 CLR 异常**冒泡给宿主、中断脚本**

Jint 官方 XML 文档原文：

> "Exceptions that thrown from CLR code are converted to JavaScript errors and can be used
> in at try/catch statement. **By default these exceptions are bubbled to the CLR host and
> interrupt the script execution.** If handler returns true these exceptions are converted
> to JS errors that can be caught by the script."

而 heyta 的存储契约**整个建立在异常上**：驱动抛错 → 适配器回滚 →
`isUniqueViolation` 把冲突吸收成 `{ok:false}`。

⇒ **不打开 `CatchClrExceptions`，一条重复写入就会直接杀掉整个桌面进程**，
而不是被 `try/catch` 接住。实测就是这么炸的（`Unhandled exception ... SQLite Error 19`）。

这一条属于"**默认值就是错的**"那一类：不测就不会知道，而且只在第一次真冲突时现形。

## 复现

```bash
bash research/spikes/sqlite-driver-csharp/run.sh
```

前置：`node`、`dotnet SDK ≥ 8`（本机实测 .NET 10.0.108）。
输出目录可用 `SQLITE_SPIKE_OUT` 指定（默认 `mktemp -d`）。退出码：任一步失败即非 0。

## ⚠️ 这个 spike **没有**证明的事

1. 🔴 **没有证明性能够用。** 每次驱动调用都过一趟 `JSON.stringify` / `JSON.parse`。
   `微任务泵次数：0` 说明它**不会被事件循环拖慢**，但**单次调用的编组开销没测**。
   存储层在同步热路径上是高频调用的，**这一条可能否掉当前这种 JSON 桥**，
   改成 CLR 对象直接编组（或 `JsValue` 手写编组）可能必要。
2. **没有跑 `packages/storage` 自己的那套完整契约测试。**
   `packages/storage/tests/contract/adapter.contract.ts` 有**几十条**断言，
   本 spike 只挑了其中最危险的一组（16 步）。**完整重放还没做** ——
   这才是"同一套契约"的严格形态，也是计划 §6 新增门禁的正文。
3. **没有测 blob（`Uint8Array`）。** JSON 桥**根本表达不了二进制** ——
   当前这条桥遇到 blob 会坏。契约的 `SqlValue` 是含 `Uint8Array` 的，
   所以这是**已知的、必须在 W1 前解决**的缺口。
4. **没有测 `isUniqueViolation` 被显式实现的情况**（本 spike 走的是文案回退）。
5. **没有测 WAL 之外的并发形状**：单连接、单线程。
   契约里"所有方法可安全并发调用"那条由适配器的 FIFO 队列保证，**未在跨语言下验证**。
6. **没有测 `OpLogStore` 层**（`DbOpLogStore` / Worker 桥）。
7. **没有测断电/崩溃后的恢复**（`__heyta_seq` 与自增 seq 的重建）。
8. **`db_bytes=4096` 是 WAL 未 checkpoint 造成的**：数据在 `-wal` 里，
   新连接读得到（所以行数是对的），但"文件大小"这个观测值本身**不能当作落盘证据**。
