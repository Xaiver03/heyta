# AI 验收门禁：什么叫「AI 功能做完了」

> **读法**：这份文档回答一个问题 —— **我说"AI 功能做完了"，凭什么信？**
>
> 它不解释 AI 怎么实现（那在 [`ai-architecture.md`](../reference/ai-architecture.md)），
> 只解释**验收**：验什么、怎么验、红了怎么归因、加新功能要补哪几步。

---

## 1. 一句话

跑 `pnpm check`。它现在包含两道 AI 专属的门：

| 门 | 命令 | 验的是 |
|---|---|---|
| 静态可达性 | `pnpm check:ai-coverage` | 每个 `AiFeature` 从「实现」到「用户能点到」这条链**没有断开** |
| 真实浏览器 | `pnpm check:ai-e2e` | 用户旅程在**真的 Chromium** 里真的走得通 |

**门禁全绿 = 四个 AI 功能都已实现、已接线、经真实浏览器验收。**

---

## 2. 为什么需要一道"可达性"门禁（而不是只有测试）

本仓库反复栽在同一个形状上：**能力实现了、单测过了、生产里一个调用点都没有。**

统计下来这个形状出现过 **12 次以上**。每次的表现都一样：所有测试绿，代码看着完整，
功能却不可用 —— 因为没人真的去点它。

所以 `check:ai-coverage` 不测行为，它测**连接**。对 `AiFeature` 联合类型里的
每一个成员，逐条要求：

1. `packages/app-host/src/` 里有调用构建器（`feature: '<F>'`）
2. 有 `export function request*` 入口
3. 该入口从 `packages/app-host/src/index.ts` 可达
4. 在 `DEFAULT_FEATURE_CAPABILITIES` 里声明了能力（`packages/ai/src/routing.ts`）
5. 在 `RELEVANT_PREFERENCES` 里声明了偏好（`packages/domain/src/preference-hints.ts`）
6. **界面真的可达**，分两级：
   - a. `apps/web/src/` 里有人调用它的入口
   - b. 调用它的那个界面文件**自己也被别处 import**

### 🔴 第 6b 级是被一个坏门禁逼出来的

第一版只查到 6a。结果 `AiPrioritize.tsx` / `AiDuration.tsx` 静静地 import 了入口，
门禁立刻变绿 —— **而没有任何地方渲染这两个组件**。

这是同一类失效上升了一层：第一层是"能力实现了但没调用点"，第二层是"组件写好了但没挂载"。
两层都不报错、都不影响测试，都只在"有人真的去用"的时候才暴露。

**门禁绿不等于用户能用 —— 所以这里必须查到"渲染"为止，而不是查到"引用"为止。**

### 它同时守住一条裁决

门禁还会在运行时断言托管云 AI **仍然被挡住**：

- `describeRetention('heyta-cloud') === undefined`（保留策略仍未定案，ADR-0013）
- `assertEnableable({ mode: 'managed' })` 抛 `retention-undecided`
- `describeDestination('heyta-cloud')` 含**明确否定**「不受端到端加密」（ADR-0006）

这条断言的意义是：**哪天有人悄悄把托管 AI 放开了，门禁会红，而不是悄悄上线。**

---

## 3. 为什么真实浏览器 E2E **不接真模型**

这是这套门禁里最重要的一个取舍，值得单独说。

仓库里已经有接真端点的验收（`scripts/verify-ai-*-live.mjs`、
`apps/web/tests/journey-ai-memory.integration.spec.tsx`）。实测过一次：
在并发负载下，真端点那条旅程测试会**偶发超时**（该测试文件第 310–312 行自己写明了
「单独跑必过、成套并行跑偶发失败」）。

把它当门禁的后果是：**门禁的红绿取决于别人的服务器和本机负载。**
于是"红了"不再意味着"代码坏了" —— 而**一个会被忽略的门禁比没有门禁更糟**。

所以取舍是明确的：

| | 用什么 | 参不参与门禁 |
|---|---|---|
| **门禁** | `e2e/stub-provider.mjs`（确定性假端点） | ✅ 参与 |
| **真世界验收** | `verify:ai-*-live`、`journey-ai-memory` | ❌ 不参与，作为补充证据 |

假端点仍然验证**真的发出了网络请求**：它记录每次调用的功能名，
测试读 `GET /__requests` 断言计数与 `feature` 都对得上。
所以"浏览器里真的发了请求"这件事仍然是验过的，不是组件内部伪造的结果。

---

## 4. 怎么在本地跑

```bash
pnpm check:ai-coverage     # 秒级，不需要浏览器
pnpm check:ai-e2e          # 需要 Chromium，1–2 分钟
```

第一次跑 E2E 之前，`e2e/` 这个**独立工作区**要单独装依赖和浏览器：

```bash
cd e2e
pnpm install
pnpm run install-browser   # 下载 Chromium
```

> ⚠️ **端口占用会误伤。** 配置里 `reuseExistingServer: false` 是**故意的** ——
> 否则本机同时开着别的项目时，可能把**别人的应用**当成被测对象，
> 而症状是"测试全绿但测的是另一个网站"。
> 代价是：上一次跑崩留下的残留进程会让下一次直接报
> `http://127.0.0.1:4319/__requests is already used`。
> 清理：`lsof -ti:4318,4319 | xargs kill`。

---

## 5. 为什么 `e2e/` 是一个独立工作区

`e2e/` 有自己的 `pnpm-workspace.yaml`，**不在**根工作区里（根 glob 是
`packages/*` / `apps/*` / `server`）。

原因不是洁癖，是当时的现实：根 lockfile 里落着一个**并发开发中**的新应用
（`apps/landing`）的依赖，而它的 `package.json` 还没提交。此刻往根 lockfile 里
加任何东西，都会把那些依赖一起提交出去，于是 CI 的 `--frozen-lockfile` 会因为
"lockfile 里有未提交的 importer"而红。

> ⚠️ **上面那段描写的那个具体原因已经消失了** —— `apps/landing/package.json`
> 早已提交（`a1fb23b`），而且现在它本来就是根工作区的一员。但 `e2e/` **仍然**
> 刻意留在根工作区之外，因为另外两点今天依然成立：
> ① 它的依赖（Playwright + 浏览器二进制）与产品运行时无关，混进根 lockfile 只会污染它；
> ② `.github/workflows/ci.yml` **显式**多跑一步 `pnpm --dir e2e install --frozen-lockfile`
> —— 忘了它，`pnpm check` 会死在 `check:ai-e2e`，而报错完全不指向真正的原因。

独立工作区让 E2E 的依赖与根工作区**完全解耦**：根 lockfile 保持干净，
`e2e/pnpm-lock.yaml` 只描述 Playwright，可独立提交、独立复现。

> 🔴 **代价必须记住**：独立工作区有**自己的一份 store**。
> `research/tools/license-inventory.mjs` 曾经只扫根 store，于是 Playwright
> 对它**完全不可见** —— 许可证门禁绿着，而它根本没看过那个包。
> 该工具已改成扫描 `STORES` 里登记的所有工作区。
>
> **加新工作区必须在那个清单里登记。忘了的表现是"汇总数字没变"，不是"报错"。**

---

## 6. 加一个新的 AI 功能，要补哪几步

`check:ai-coverage` 是**由 `AiFeature` 联合类型驱动**的，不是硬编码清单。
所以顺序是固定的：

1. 在 `packages/ai/src/egress.ts` 的 `AiFeature` 里加字面量
2. 写 `packages/app-host/src/ai-<名字>.ts`（照 `ai-breakdown.ts` 的形状）+ 从 `index.ts` 导出
3. 在 `routing.ts` 的 `DEFAULT_FEATURE_CAPABILITIES` 与 `preference-hints.ts` 的
   `RELEVANT_PREFERENCES` 里声明
4. 写界面组件并在**别处挂载**它（通常是 `apps/web/src/App.tsx`）
5. 跑 `pnpm check:ai-coverage` —— 它会告诉你**还差哪一步**，而不是只说"失败"

> ⚠️ 反过来也成立：**光加 `AiFeature` 字面量而不做后面四步，门禁会红。**
> 这是刻意的 —— 字面量一旦存在，设置界面就会为它渲染配置行，
> 也就是说**用户可以授权、可以配端点，然后什么都不会发生**。

### 有意豁免

如果某个功能确实只给本机 API / MCP 用、不该有界面入口，
把它加进 `scripts/check-ai-coverage.mjs` 的 `NO_UI_ENTRY` 并写明理由。
**目前这个集合是空的** —— 四个功能都有界面入口。

### 🔴 一条不能碰的红线

**`AiFeature` 不得加入可视化。** 甘特图与倒计时**不是 AI** ——
排程是确定性的（依赖图 + 拓扑排序），AI 在这里唯一正当的位置是
**从标题估算工期**。

这条已被裁决过两次（见 [`ai-strategy.md`](../plans/ai-strategy.md) §3、
[`ai-capability-branches.md`](../plans/ai-capability-branches.md) §3），
理由不是"AI 做不到"，而是**给甘特图套一个模型是最典型的"AI 当装饰"**：
成本、延迟、隐私风险全涨，结果还不如确定性算法准。

---

## 7. 红了怎么归因

**先跑 `pnpm check:ai-e2e` 里的 `smoke.spec.ts`。**

那条冒烟用例存在的唯一目的就是**失败归因**：它只验"真浏览器能打开真应用"
与"假端点活着"。如果它也红，问题在**环境**（端口残留、浏览器没装、构建失败），
不必去读功能代码。

| 症状 | 大概率原因 |
|---|---|
| `is already used` | 上次跑崩的残留进程占着 4318/4319 |
| 冒烟红、其它红 | 环境问题，先修环境 |
| 冒烟绿、某功能红 | 该功能的接线或行为坏了 —— 这时候才去读代码 |
| 只有 `journey-ai-memory` 红 | **不是门禁的一部分**，它依赖真端点，见 §3 |
| `check:ai-coverage` 红 | 按它给出的"还差哪一步"逐条补 |

---

## 8. 这道门禁**没有**覆盖什么

如实列出，免得"全绿"被读成"什么都验过了"：

- **真模型的输出质量**。假端点返回的是固定内容，所以"模型是否听话"、
  "JSON 合规率多少"**没有验**。那要靠 `verify:ai-*-live` 手工跑。
- **托管云 AI**。被 ADR-0013 有意挡住，门禁只断言它**仍然被挡住**。
- **多端（ArkTS / iOS / Android）**。E2E 只跑 web。移动端有各自的门禁与脚
  （见 [`multi-platform-build.md`](multi-platform-build.md)）。
- **视觉回归**。没有截图比对，只有"元素可见 / 文本正确"这类断言。
- **性能**。没有对首屏或交互延迟设阈值。

---

*相关*：[`ai-architecture.md`](../reference/ai-architecture.md)（AI 怎么实现）、
[`ci-and-runner.md`](ci-and-runner.md)（CI 与 runner）、
[`ai-strategy.md`](../plans/ai-strategy.md)（为什么是这四个功能）。
