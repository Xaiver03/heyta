<!-- AI 生成代码/用例的检视规则。返回规则地图：[`AGENTS.md` §4](../../AGENTS.md)。
     机械可校验部分由 `scripts/check-ai-case-usability.mjs`（`pnpm check:ai-case-usability`）承担；
     不可机械判的部分（覆盖负例、只测正常流）靠人按清单逐条勾。 -->

# AI 生成代码检视规则

**适用范围**：本仓所有 AI agent 产出的代码与用例（含各壳、共享包、`server/`、`e2e/`）。
人写的代码同样适用，但重点盯 AI 产出——AI 最容易在下列几处"看起来对、其实没验到"。

**判据**：一条 AI 产出的改动，下面六项**逐项过一遍**，任一命中即打回重做，不带病合并。

| # | 检视项 | 什么算不合格（判据） | 怎么查 |
|---|---|---|---|
| 1 | **幻觉依赖** | 引入/调用了仓库里并不存在的包、函数、导出、字段或脚本键；引用的 API 形状、参数、返回类型凭记忆写而非按真实源码 | 对被调用的每个符号 `grep` 一次真实定义；不存在的键（含 `pnpm` 脚本键）一律当作幻觉 |
| 2 | **越权** | 越过既有边界：`apps/*` 里写了业务判断、绕过 op-log 直接写库、认证/授权依赖客户端自报、跨层直接 import 内部实现 | 对照 [`hard-constraints.md`](hard-constraints.md) §3.4/§3.5 与 [`repo-map.md`](repo-map.md) 的"能不能改"档 |
| 3 | **硬编码密钥 / ID** | 源码或用例里出现密钥、token、账号 ID、本机绝对路径（`/Users/…`）、带口令的连接串；本可用配置/环境却写死成字面量 | 机械判：见 [`清单`](ai-generated-test-usability-checklist.md) 第 5 条；`pnpm check:ai-case-usability` 对 AI 用例做这一项 |
| 4 | **空断言** | 断言不验真实结果：`expect(x);`（无匹配器）、`expect(true).toBe(true)`（恒真）、整份用例没有任何 `expect`/`assert` | 机械判：`pnpm check:ai-case-usability`（`EMPTY_ASSERTION`） |
| 5 | **只测正常流** | 只覆盖 happy path，没有任何失败/边界/非法输入的用例 | 人工：按 [`清单`](ai-generated-test-usability-checklist.md) 第 3 条勾；没有负例即打回 |
| 6 | **顺序依赖** | 用例之间靠共享可变状态串起来（一个用例写、下一个读）；用 `.only` 让套件不再隔离；依赖执行顺序才绿 | 机械判：`pnpm check:ai-case-usability`（`ORDER_DEPENDENCY`）；再补一条单跑也应绿 |

## 机械校验 vs 人工勾选

- **能机械判死的**（空断言 / 顺序依赖 / 硬编码）→ 由 `pnpm check:ai-case-usability` 对着**声明的 AI 用例**逐条判，红即打回。它接在 `pnpm check` 链里。
- **要读意图的**（覆盖负例 / 只测正常流）→ 没有可靠的机械判据，靠检视者按 [`清单`](ai-generated-test-usability-checklist.md) 逐条勾，不许跳。

## 对 AI 生成用例的额外硬要求

- AI 生成的用例文件，**首行必须写标记** `// @ai-generated-case`。机械校验只对带此标记的文件生效；不写标记 = 逃出射程，视同未检视。
- 达不到 [`AI 生成用例可用性清单`](ai-generated-test-usability-checklist.md) 五条的用例，**不许进回归**。
