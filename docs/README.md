# heyta 文档中心

本文件是 `docs/` 的**唯一权威入口**。新增文档前先读「文档规则」，否则大概率会放错层。

---

## 一、文档分层规则

按**文档的生命周期**分层，而不是按主题。判断标准只有一个：**这份文档会不会变？谁依赖它？**

| 目录 | 放什么 | 生命周期 | 能不能改 |
|---|---|---|---|
| [`adr/`](adr/) | **架构决策记录**：一次决策一份，写清背景/选项/结论/后果 | 永久 | 🔒 **不可改**（只能新增"取代"关系） |
| [`plans/`](plans/) | **阶段计划**：roadmap + 每个阶段的详细计划 | 随阶段推进 | ✅ 持续更新，做完的划掉 |
| [`reference/`](reference/) | **稳定工程参考**：架构、协议、数据模型 | 长期 | ✅ 随代码演进 |
| [`runbooks/`](runbooks/) | **操作手册**：怎么跑起来、怎么验证、出事怎么办 | 长期 | ✅ 随运维实践更新 |
| [`research/`](research/) | **调研记录**：一次调研的完整过程与证据 | 归档 | ⚠️ 原则上冻结；结论有变时**新增**勘误，不改原文 |

**放错层的典型症状**：

- 把"我们决定用 X 而不是 Y"写在 `research/` 里 → 应该进 `adr/`。调研负责**给证据**，ADR 负责**下结论**。
- 把"当前进度"写在 `adr/` 里 → ADR 是不可变的历史记录，进度属于 `plans/`。
- 把一次性排查过程写在 `reference/` 里 → 那是 `research/`。

### 与 `research/`（仓库根）的区别

两个 `research` 目录容易混，分工是明确的：

- **`docs/research/`** —— 调研**结论**，是给人读的成品。
- **`research/`**（仓库根）—— 调研**原料**：上游源码克隆、抓取的原始报告、一次性脚本（`tools/`）、许可证清单。**不属于产品文档**，也不参与死链检查之外的任何门禁。

---

## 二、命名规范

```
adr/NNNN-<kebab-case>.md          例：0001-license-decision.md
plans/<kebab-case>.md             例：phase-1-single-client-loop.md
reference/<kebab-case>.md         例：architecture.md
runbooks/<kebab-case>.md          例：local-server-verification.md
docs/research/<kebab-case>.md     例：reuse-plan.md
```

- 全小写，中划线分词，**不加日期前缀**（日期写在文档正文的元信息里，不写在文件名里）。
- ADR 编号**只增不改**，从 `0001` 连续递增。

> 历史遗留：`docs/` 原先是 `00-feature-matrix.md` … `09-local-server-verification.md` 的平铺编号。
> 已按上面的规则迁入分层目录，**原编号不再保留**。旧路径在 git 历史里仍可查到。

---

## 三、状态标记约定

每份 `plans/` 与 `adr/` 文档**开头必须有状态行**：

```markdown
> 状态：**待确认** | **已接受** | **已取代** | **已废弃**（ADR）
> 状态：**规划中** | **进行中** | **已完成**（计划）
```

`已取代` 必须写明被谁取代：`> 状态：**已取代** → [ADR-0002](0002-xxx.md)`。

---

## 四、写作规则

1. **链接用文件相对路径**，不要写仓库根相对路径。
   - ✅ `` [架构](reference/architecture.md) ``
   - ❌ `` [架构](docs/reference/architecture.md) ``（从 `docs/` 里这样写会解析到 `docs/docs/`）
   - 在**反引号 code span** 里提及路径时，用仓库根相对路径（不会被解析，只是给人看）。
2. **提交前跑死链检查**：
   ```bash
   node research/tools/docs-link-check.mjs
   ```
   它扫描全部 `.md`，解析每个相对链接，死链则**退出码 1**。跳过 `research/upstream/` 等第三方克隆。
3. **不确定的事标"未核实"**，不要写成结论。调研类文档尤其重要。
4. **数字要给证据**：引用代码行数、版本号、日期时，写明是怎么得到的。

---

## 五、索引

### ADR — 架构决策记录

| 编号 | 决策 | 状态 |
|---|---|---|
| [0001](adr/0001-license-decision.md) | heyta 自身的许可证选择 = **MIT** | ✅ **已接受** |
| [0002](adr/0002-migration-tooling.md) | 数据库迁移方案：继续用 Prisma，不引入 Flyway | ✅ **已接受** |
| [0003](adr/0003-multi-platform-strategy.md) | 多端策略：业务逻辑全在 `packages/`，`apps/*` 只做壳 | ✅ **已接受** |
| [0004](adr/0004-ui-stack.md) | UI 技术栈 = **React Native**（跨平台） | ✅ **已接受** |
| [0005](adr/0005-ai-data-path.md) | AI 能力的数据路径 = **客户端内 + 用户自有推理端点**为默认；🔴 云端 AI 是**显式例外**（由 ADR-0013 补充，不再是「不做」） | ✅ **已接受** |
| [0006](adr/0006-supply-modes.md) | 同步与 AI 的**供给模式**：自备与托管并存；🔴 托管 AI 与 E2EE 互斥，必须显式例外 | ✅ **已接受** |
| [0007](adr/0007-transport-security.md) | 传输安全：**允许明文 HTTP，但不静默**（E2EE 保护内容、不保护令牌）；🔴 iOS 的 ATS 覆盖范围未实测 | ✅ **已接受**（iOS 待实测） |
| [0008](adr/0008-vector-clock-limit.md) | 向量时钟上限 **20 → 100**：把墙挪远、**不假装拆掉**（真正的修法是因果安全压缩，未做） | ✅ **已接受** |
| [0009](adr/0009-duplicate-op-idempotent-success.md) | 精确重复的 op 回**幂等成功**（附原 serverSeq），不再回 `DUPLICATE_OPERATION`；id 冲突仍硬拒绝 | ✅ **已接受** |
| [0010](adr/0010-ai-config-routing.md) | AI **配置路由**：三道闸（总开关 / 允许远程 / 逐功能出境授权）；🔴 **回退不得跨越隐私边界**；能力显式声明不推断；URL 校验双点执行 | ✅ **已接受** |
| [0011](adr/0011-local-api-mcp.md) | 本机 API / MCP：默认关、只监听回环、显式 token、逐工具授权；🔴 **加密条目可列举不可读**；写入只能经 `dispatch()` 形状的端口 | ✅ **已接受** |
| [0014](adr/0014-memory-switch-and-corrections.md) | 🔴 记忆偏好层的两个闸门：**主开关默认关闭且 fail-closed**（必填参数，不是可选）；用户**纠正进 op-log** 跨设备同步，且因 `applyOperation` 静默忽略未建模实体类型 —— **不需 bump schema** | ✅ **已接受** |
| [0013](adr/0013-cloud-ai-and-maas.md) | 🔴 云端 AI 与 MaaS：**方向已定**（会提供统一云端 AI 并按此收费，后续 MaaS），但**开放条件未满足**；托管模式**不是端到端加密**（承接 ADR-0006） | ✅ **已接受** |
| [0017](adr/0017-single-paid-tier-and-payment-channel.md) | 💰 **唯一付费档的价格与支付通道**：大陆 **¥99/年**、海外 **$49/年**、自建**永久免费**（承接 [subscription-boundary.md](plans/subscription-boundary.md) §0，并**关闭**它 §3 一直留着的「价格未定」）；改价必须三处同时改，由 `scripts/check-pricing-consistency.mjs` 拦 | ✅ **已接受** |
| [0018](adr/0018-adjustable-pricing-and-coupons.md) | 💰 **价格可运行期调整 + 自建优惠券域模型**：代码基线 + 数据库版本（带生效区间，**有缝绝不回落**）；券一单一券、13 个拒绝原因、名额口径 `reserved/applied/reversed` 计数而 `expired` 不计数；顺带**修掉** ADR-0017 §4「回调只校验金额是价目表里的某一个」那个洞（改成跟订单冻结金额比） | ✅ **已接受** |

### 计划

| 文档 | 内容 |
|---|---|
| [roadmap.md](plans/roadmap.md) | ⭐ **总路线图**：阶段划分、P0 完成情况、组件决策、风险 |
| [phase-1-single-client-loop.md](plans/phase-1-single-client-loop.md) | ⭐ **P1 详细计划**：单端（Web）闭环 |
| [phase-2-multi-platform.md](plans/phase-2-multi-platform.md) | **P2 详细计划**：多端补齐（存储契约 / SQLite / RN / 鸿蒙） |
| [ai-memory-necessity.md](research/ai-memory-necessity.md) | ⭐ **要不要向量数据库**：用重复检测做可证伪实验得出的结论（难档召回 0%） |
| 🔴 [ai-memory-system.md](plans/ai-memory-system.md) | **AI 记忆系统实施计划**：该记住什么偏好、怎么验证、分几阶段做 |
| [ai-strategy.md](plans/ai-strategy.md) | ⭐⭐ **AI 入口文档**：读这一份就够（定位 / 三档结构 / 护城河 / 现状 / 下一步） |
| 🔴 [subscription-boundary.md](plans/subscription-boundary.md) | **会员订阅的免费/付费边界**：收费的是「服务器」不是「功能」；为什么按设备数卡而不按存储量；「到期不许变成数据 hostage」这条硬约束 |
| 🔴 [subscription-integration.md](plans/subscription-integration.md) | **会员订阅的服务端接入点**：Fastify/JWT/配额守卫/迁移纪律的落点，以及 🔴「代码里没有官方实例标志，付费闸门必须默认关」 |
| [ai-capability-branches.md](plans/ai-capability-branches.md) | **AI 能力分支与开发分支策略**（含对 5 条功能设想的逐条裁决）—— 大而全，深挖用 |
| [ai-open-decisions.md](plans/ai-open-decisions.md) | **AI 功能需要拍板的决策清单**（不是需求表单，是「代码解决不了的事」） |

### 工程参考

| 文档 | 内容 |
|---|---|
| [architecture.md](reference/architecture.md) | 技术选型与架构（⚠️ 顶部有推翻声明，同步引擎部分仍有效） |
| [build-matrix.md](reference/build-matrix.md) | ⭐ **多端构建矩阵**：各平台构建环境 / 工具链版本 / 产物路径 / 状态，含 **Windows 打包机身份固化** |
| ⭐ [pricing-and-entitlements.md](reference/pricing-and-entitlements.md) | 💰 **价格与权益的工程参考**（不是营销文案）：一张表说清唯一付费档、权益对照、到期行为、价格的**三个事实源**在哪、以及**现在还买不到**的诚实状态。含被 `scripts/check-pricing-consistency.mjs` 读取的机器可读价格块 |
| ⭐ [pricing-and-coupons.md](reference/pricing-and-coupons.md) | 💰 **价格可调与优惠券的工程参考**：价格的事实源住哪（代码基线 ↔ 数据库版本 ↔ 覆盖的裁决规则）、模块地图、**全部具名常量与数值**、13 个拒绝原因与其顺序为什么是规格、五张表与 CHECK、订单状态机、名额口径表、并发核销的锁形状、🔴 **sweep 必须真的在跑**、以及 §7 的未验证项清单 |
| [ai-architecture.md](reference/ai-architecture.md) | ⭐ **AI 架构参考**：出站（`packages/ai` 四层收窄）/ 入站（`packages/local-api`）的模块地图、封闭词表、全部具名常量与数值、**20 条不变量清单**、数据流。⚠️ 它描述"代码现在长什么样"，与 ADR 冲突时以 ADR 为准 |

### 操作手册

| 文档 | 内容 |
|---|---|
| [local-server-verification.md](runbooks/local-server-verification.md) | ⭐ 不依赖 Docker 跑通服务端 + Docker 部署 + 实测发现 |
| [multi-platform-build.md](runbooks/multi-platform-build.md) | ⭐ **多端构建操作手册**：Android / iOS / Windows / 鸿蒙怎么打包、怎么验产物、高频坑 |
| [ci-and-runner.md](runbooks/ci-and-runner.md) | ⭐ **CI 与自托管 runner 操作手册**：push 之后发生什么、runner 为什么在 finlaw、日常操作命令、7 条已踩过的坑、安全边界、🔴 **转公开必须改回托管 runner**的硬约束 |
| [ai-acceptance.md](runbooks/ai-acceptance.md) | ⭐ **AI 验收门禁**：什么叫「AI 功能做完了」——静态可达性门禁查什么（含"引用了 ≠ 用户能用"那条）、真实浏览器 E2E 为什么不接真模型、红了怎么归因、加新功能要补哪几步、以及这道门禁**没覆盖**什么 |

### 调研

| 文档 | 内容 |
|---|---|
| [feature-matrix.md](research/feature-matrix.md) | 滴答清单功能对照矩阵 —— 需求基准线（P0/P1/P2 分级） |
| [oss-landscape.md](research/oss-landscape.md) | 开源项目盘点（16 个项目的许可证、成熟度、可复用性） |
| [licensing-and-compliance.md](research/licensing-and-compliance.md) | 许可证与合规边界（AGPL §13、商标、上架成本、定价数据） |
| [codebase-assessment.md](research/codebase-assessment.md) | 上游代码体检：依赖许可证扫描 + 代码量实测 |
| [reuse-plan.md](research/reuse-plan.md) | ⭐ **复用方案核心**：精确分层账本 + 复用矩阵 + 待决策点 |
| [ssos-ai-routing-design-analysis.md](research/ssos-ai-routing-design-analysis.md) | SSOS「AI 配置路由」源码分析：可移植的语义与**不可移植的**设计 |
| [reusable-components.md](research/reusable-components.md) | 外部组件决策表：每个模块"用现成的还是自研" |
| [migration-tooling.md](research/migration-tooling.md) | 迁移工具调研：Flyway vs Prisma 的官方证据与未核实清单（支撑 [ADR-0002](adr/0002-migration-tooling.md)） |
| [ai-competitive-and-architecture.md](research/ai-competitive-and-architecture.md) | ⭐ **AI 调研结论层**：滴答清单的 AI 做法 + AI 排程成败账 + E2EE 下可用的推理架构（支撑 [ADR-0005](adr/0005-ai-data-path.md)） |
| [ai-feature-landscape.md](research/ai-feature-landscape.md) | ⭐ **AI 格局层**：13 个竞品逐产品详述 + 374 条内联来源 + 25 处「未找到公开信息」。⚠️ 与上一条的分工见下方注 |
| [e2ee-apps-ai.md](research/e2ee-apps-ai.md) | ⭐ **E2EE 产品怎么做 AI**（192 处 ✅ 官方全文）：Bear / Joplin / Anytype / Standard Notes / Obsidian / Proton Lumo。🔴 核心结论：**"厂商托管 AI + 维持 E2EE" 在所有样本中一个都不存在**。支撑 [ADR-0006](adr/0006-supply-modes.md) |
| [ai-competitive-teardown.html](research/ai-competitive-teardown.html) | 上两条的**可视化渲染**（战情室风格功能矩阵，单文件、离线可看）。⚠️ **`.md` 是唯一事实源**，本文件只是呈现 |

> ⚠️ **两份 AI 调研文档的分工（不要当成重复，也不要让它们漂移）**：
> - `ai-competitive-and-architecture.md` = **结论层**。只放**影响 ADR-0005 / AI 计划决策**的结论，
>   每条都指向决策。**改决策时改这一份。**
> - `ai-feature-landscape.md` = **格局层**。逐产品事实与来源，**事实的原始出处以它为准**。
> - 🔴 **唯一事实源规则**：**同一事实只在一处定义**。格局层给事实，结论层给判断与指向；
>   若两处冲突，**先核对格局层的来源，再修结论层** —— 已发生过一次（§5.2 的 Time Left 更正）。

### 仓库根的其他文档

| 文档 | 内容 |
|---|---|
| [`../README.md`](../README.md) | 项目门面：heyta 是什么、现状、怎么开始 |
| [`../AGENTS.md`](../AGENTS.md) | 🤖 **AI/agent 协作规则**（硬性约束、禁令、工作流） |
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md) | 贡献流程：分支、提交、测试、评审门禁 |
| [`../THIRD_PARTY_LICENSES.md`](../THIRD_PARTY_LICENSES.md) | 第三方代码归属声明与许可证政策 |
