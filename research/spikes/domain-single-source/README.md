# Spike：`packages/domain` 的单源问题（Windows 原生的 W0-4 门槛）

> **结论（2026-09-28 实测）**：**D2 成立。**
> `@heyta/domain` 的同一份 bundle 字节，在**裸 V8 上下文**（零宿主全局）
> 与 **.NET 10 + Jint** 两台引擎上跑 **22/22 用例全部成功，结果逐条一致**。
> ⇒ Windows 换 C# 原生壳**不需要**把领域层做成两份源。
>
> 复现：`bash research/spikes/domain-single-source/run.sh`

---

## 这个 spike 在问什么

[多端原生构建计划](../../../docs/plans/desktop-native-migration.md) §2 决定 Windows 走
WinUI 3 / Windows App SDK 原生（C#，[ADR-0034](../../../docs/adr/0034-windows-native-winui3-not-rnw.md)）。
那条路把 ADR-0032 的三笔成本（C1 同步 SQLite / C2 原生库缺口 / C3 provider 只能 C++）
全部消掉了，但**换来一个新问题**，而且它是整个计划里**唯一真正的未知数**：

`packages/domain` 是 **6603 行纯 TS 业务逻辑**（四象限 / 习惯连续天数 / 番茄钟状态机 /
重复规则），被 web、mobile、鸿蒙、widget-core **全部共用**，是本仓最核心的资产。
**C# 进程跑不了 TS。** 于是只有两条路：

| | 做法 | 代价 |
|---|---|---|
| **D1** | C# 移植 + golden fixture 逐字节校验 | 🔴 核心业务逻辑变成**两份源** —— 不是一次性代码量，是**永久双份维护** |
| **D2** | C# UI + **内嵌 JS 引擎**跑同一份 TS bundle | 多一个运行时依赖；跨边界编组成本 |

⚠️ **"哪怕是代码量偏大"授权的是 D1 的一次性体积，不是它永久的双份维护。**
所以 D1 **不是默认答案** —— 必须先验 D2。

## 为什么用"裸 V8 + Jint"两台引擎比

D2 的整个前提是"内嵌引擎跑的还是同一份字节"。内嵌引擎（Jint / ClearScript）提供的
就是一个**没有宿主能力**的环境：没有 `process` / `require` / `window` / `fetch` / `Buffer`。

所以这个 spike 做两件事：

1. **裸 V8 那一侧**：`vm.createContext` 给一个只有 ECMAScript 内建的沙箱，
   并把常见宿主全局定义成**一访问就抛错**的 getter。
   ⇒ "bundle 偷偷用了宿主能力"会当场炸掉，而不是静默拿到 `undefined` 再在别处出怪结果。
2. **.NET 那一侧**：Jint 执行同一个文件，不给它注入任何宿主对象。

两侧跑**同一份 `cases.json`**（用例是 JS 源码字符串，与引擎无关），
并把结果都规范成 `JSON.stringify(<expr>)` 产出的字符串 ——
比对的是**两台引擎对同一份 bundle 的求值结果**，而不是两台宿主的序列化器谁更像谁。

## 实测结果（2026-09-28）

```
bundle：338445 字节（两侧读的是同一个文件，--platform=neutral 构建，零 require）
导出：146 个符号
裸 V8：node v22.22.3 / vm.createContext(空沙箱)
 .NET：.NET 10.0.8 / Jint 4.16.4.0
用例：22 条，两侧都成功 22 条，结果一致 22 条
裸 V8 触碰宿主全局：0 次
```

⚠️ bundle 字节数**依赖构建方式**：同一个入口，从 `packages/domain` 目录里跑
`esbuild src/index.ts` 得到 **338083** 字节，而 `run.sh` 从仓库根用**绝对路径**跑
得到 **338445** 字节（esbuild 对 `tsconfig` 的发现路径不同）。
上表是 `run.sh` 的数 —— **以它为准**，因为它才是可复现的那条路径。

用例覆盖（不只是"能加载"）：

- 纯日期运算：`addDays` 跨月 / 跨年 / 闰年末，`daysBetween` 双向，`daysInMonth`
- **打包进来的 `ical.js` RRULE 求值**：`occurrencesInRange` 每周一三、
  每月末（`BYMONTHDAY=-1`）、以及 `FREQ=SECONDLY` 那条**已知会抛错的保护路径**（返回 `[]` 侧行为）
- 文本规则：`countChecklistItems`（多行 checkbox 正则）
- 聚合形状：`computeTodayProgress` 返回的整个对象
- 规则描述与合法性：`describeRecurrence`（产出中文串）、`isValidRecurrenceRule`

## 前置与用法

前置：`node`、`npx`（esbuild 来自仓库 `node_modules`）、**dotnet SDK ≥ 8**。

```bash
bash research/spikes/domain-single-source/run.sh
```

输出目录可用 `DOMAIN_SPIKE_OUT` 指定（默认 `mktemp -d`）。退出码：任一步失败即非 0。

## ⚠️ 这个 spike **没有**证明的事

1. **没有验证 Jint 对全部 ES 语法/内建的支持面。** 22 条用例是**采样**，不是全量。
   真正的结论要等 W1 把整个领域层接上去跑（那时用 `packages/domain` 自己的测试
   反过来验 C# 侧）。
2. **没有验证跨引擎的浮点/大整数边界。** 现有用例只有 `completionRatio` 一条浮点，
   且它恰好是二进制可精确比较的 `2/3`。**不要**据此宣称"任意数值都一致"。
3. **没有验证性能。** bundle 338 KB，Jint 是解释执行；启动与单次调用开销**未测**。
   如果领域层在 UI 热路径上被高频调用，这个开销可能不可接受。
4. **没有验证内存/GC 行为**，也没有验证 `LimitMemory` 在真实负载下的表现。
5. **没有验证打包形态**：这里用的是 esbuild 现场产出的 IIFE；
   `packages/domain` 正式的 tsup 产物（ESM + CJS）**不是**这个，
   两者是否等价未测。
6. **没有决定 Jint vs ClearScript。** 这里选 Jint 只因为它是**纯 C#、无原生依赖**，
   而桌面端正在为"少一个原生依赖"付代价；ClearScript/V8 的速度可能更好，**未比较**。

以上都写进了 [计划 §9 进度账本](../../../docs/plans/desktop-native-migration.md) ——
**W0-4 只答"可行不可行"，不答"够不够快"。**
