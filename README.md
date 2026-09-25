# heyta

一款**功能等价于滴答清单（TickTick）**的任务 / 习惯 / 专注管理应用，目标是让用户不再为高昂订阅费买单。

> 当前状态：**立项调研阶段**。代码尚未开始，先把"需求基准 + 技术选型 + 开源复用清单"钉死。

---

## 为什么做这个

滴答清单这类产品把「清单 + 日历 + 四象限 + 习惯打卡 + 番茄钟」打包成订阅制，年费不低。
而其中每一块能力，开源社区都已经有成熟实现。我们要做的是**把它们整合成一套体验统一的产品**，而不是从零发明轮子。

## 项目原则

1. **功能等价，不抄皮**：对标功能与交互逻辑，不使用对方商标、图标、文案与界面素材。
2. **复用优先**：能 fork 的 fork，能引库的引库，只自研真正差异化的部分。
3. **本地优先**：数据默认存用户设备，云端只是同步通道。
4. **导出自由**：任何时刻都能一键带走全部数据。
5. **许可证干净**：所有引入的代码必须允许我们的分发/商业模式，逐项登记。
6. **可维护优先**：引入的第三方组件**必须 2021 年之后仍在持续更新**。许可证再宽松，
   一个停更三年的库也是负债。核实手段：`python3 research/tools/ghinfo.py owner/repo`。

## 文档索引

### 决策文档（`docs/`）

| 文档 | 内容 |
|------|------|
| [`docs/00-feature-matrix.md`](docs/00-feature-matrix.md) | 滴答清单功能对照矩阵 —— 需求基准线（P0/P1/P2 分级） |
| [`docs/01-oss-landscape.md`](docs/01-oss-landscape.md) | 开源项目盘点（16 个项目的许可证、成熟度、可复用性） |
| [`docs/02-licensing-and-compliance.md`](docs/02-licensing-and-compliance.md) | 许可证与合规边界（AGPL §13、商标、上架成本、定价数据） |
| [`docs/03-architecture.md`](docs/03-architecture.md) | 技术选型与架构（⚠️ 顶部有推翻声明，同步引擎部分仍有效） |
| [`docs/04-license-decision.md`](docs/04-license-decision.md) | **ADR-0001** heyta 自己的许可证选择（待确认） |
| [`docs/05-codebase-assessment.md`](docs/05-codebase-assessment.md) | 上游代码体检：依赖许可证扫描 + 代码量实测 |
| [`docs/06-reuse-plan.md`](docs/06-reuse-plan.md) | ⭐ **复用方案核心**：精确分层账本 + 复用矩阵 + 待决策点 |
| [`docs/07-reusable-components.md`](docs/07-reusable-components.md) | 外部组件决策表：每个模块"用现成的还是自研" |
| [`docs/08-implementation-plan.md`](docs/08-implementation-plan.md) | ⭐ **实施计划**：阶段划分、P0 任务分解、组件判定、风险 |

### 深度调研（`research/`）

| 文档 | 内容 |
|------|------|
| [`research/deep-dive-sync-core.md`](research/deep-dive-sync-core.md) | `packages/sync-core` 逐文件拆解 + 跨语言先例 |
| [`research/deep-dive-supersync-server.md`](research/deep-dive-supersync-server.md) | 同步服务端：完整 API、数据模型、鉴权、部署 |
| [`research/deep-dive-schema-providers.md`](research/deep-dive-schema-providers.md) | `shared-schema` + `sync-providers` + **独立构建验证** |
| [`research/deep-dive-cross-language.md`](research/deep-dive-cross-language.md) | 跨语言集成路径评估（含 Flutter/Dart） |
| [`research/licenses.md`](research/licenses.md) | ⭐ **依赖许可证登记表**（强制登记规则） |
| [`research/oss-task-manager-deep-dive.md`](research/oss-task-manager-deep-dive.md) | 16 个开源任务管理项目深度对比 |
| [`research/ticktick-clone-oss-research.md`](research/ticktick-clone-oss-research.md) | 按功能模块（习惯/番茄/四象限/日历/NLP/RRULE/同步/小组件）的开源方案盘点 |
| [`research/module3-eisenhower.md`](research/module3-eisenhower.md) | 四象限模块专项调研 |
| [`research/module5-nlp-dates.md`](research/module5-nlp-dates.md) | 自然语言日期解析专项调研 |
| [`research/module7-sync-engines.md`](research/module7-sync-engines.md) | 同步引擎市场调研 |

### 工具（`research/tools/`）

| 工具 | 用途 |
|------|------|
| `licscan.py` | 扫描 `package-lock.json`，按许可证分类汇总依赖树 |
| `crypto-interop/` | **跨语言加解密互操作测试**（验证加密契约可移植） |
| `ghinfo.py` | 绕过 api.github.com DNS 问题抓取仓库事实（stars/许可证/分支） |
| `wfetch.py` | 经系统代理抓取网页并输出可读文本 |
| `bsearch.py` | 经代理做 Bing 搜索并输出结构化结果 |

> 上述三个脚本是为绕开本机 `api.github.com` 解析到 `198.18.0.x` 伪 IP 的问题而写的，
> 后续调研同样适用。

## 目录结构（规划）

```
heyta/
├── docs/          # 决策文档，先文档后代码
├── research/      # 调研原始材料、竞品截图、许可证登记
└── (待定)         # 应用代码，技术栈确定后生成
```

## 决策记录

见 `docs/` 下的文档。重大选型会以 ADR 形式追加，不接受"口头决定"。

---

*本仓库为个人项目，与滴答清单/TickTick 及其关联公司无任何关系。*
