# heyta

一款**功能对标滴答清单（TickTick）**的任务 / 习惯 / 专注管理应用 —— 目标是不再为高昂的订阅费买单，并且**可以自建自托管**。

> **当前状态：P0 奠基已完成（2026-09-25）。** 同步协议已跑通并在真实 Docker + PostgreSQL 上验证：
> A 端加密写入 → B 端可见 → 载荷在服务端保持密文 → 并发写入被判 `CONFLICT_CONCURRENT`。
> 下一步：**P1 单端闭环**（Web 端跑通核心功能）→ [详细计划](docs/plans/phase-1-single-client-loop.md)

---

## 为什么做这个

滴答清单这类产品把「清单 + 日历 + 四象限 + 习惯打卡 + 番茄钟」打包成订阅制，年费不低。
而其中每一块能力，开源社区都已经有成熟实现。我们要做的是**把它们整合成一套体验统一的产品**，
而不是从零发明轮子。

## 项目原则

1. **功能等价，不抄皮**：对标功能与交互逻辑，不使用对方商标、图标、文案与界面素材。
2. **复用优先**：能 fork 的 fork，能引库的引库，只自研真正差异化的部分。
3. **本地优先**：数据默认存用户设备，云端只是同步通道，**不是事实源**。
4. **隐私优先**：端到端加密，服务端从设计上就看不到用户明文。
5. **导出自由**：任何时刻都能一键带走全部数据。
6. **许可证干净**：所有引入的代码必须允许我们的分发/商业模式，逐项登记。
7. **可维护优先**：引入的第三方组件**必须 2021 年之后仍在持续更新**。许可证再宽松，
   一个停更三年的库也是负债。

## 快速开始

```bash
pnpm install
pnpm -r build
pnpm -r test          # 当前 1444 个测试通过

pnpm verify:sync:dry  # 校验同步 op 形状（不需要服务端）
pnpm check            # 类型 + 迁移规范 + 许可证 + 文档死链
```

跑通服务端（本地或 Docker）、数据库迁移、完整验收流程：
👉 [`docs/runbooks/local-server-verification.md`](docs/runbooks/local-server-verification.md)

## 目录结构

```
heyta/
├── packages/
│   ├── sync-core/        # 同步内核：加密、向量时钟、冲突判定（vendored, MIT）
│   ├── shared-schema/    # 实体清单、schema 版本、HTTP 线协议契约（zod）
│   └── storage/          # 存储适配层接口 + 内存实现
├── server/               # 同步服务端：Fastify + Prisma + PostgreSQL（vendored, MIT）
├── apps/                 # 客户端应用（P1 开始建）
├── docs/                 # 产品文档（分层规则见 docs/README.md）
├── research/             # 调研原料：上游克隆、原始报告、工具脚本（非产品文档）
└── scripts/              # 仓库级脚本（P0 验收、迁移校验）
```

## 📚 文档

**完整索引见 [`docs/README.md`](docs/README.md)** —— 这里不复制一份，避免两处漂移。

按你的身份选入口：

| 你是 | 先读 |
|---|---|
| **想了解这个项目** | [`docs/plans/roadmap.md`](docs/plans/roadmap.md) —— 总路线图与当前进度 |
| **要开始写代码** | [`AGENTS.md`](AGENTS.md)（AI agent 规则）或 [`CONTRIBUTING.md`](CONTRIBUTING.md)（人的流程） |
| **要跑起来 / 部署** | [`docs/runbooks/local-server-verification.md`](docs/runbooks/local-server-verification.md) |
| **关心合规与许可证** | [`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md) + [`ADR-0001`](docs/adr/0001-license-decision.md) |
| **想理解架构怎么定的** | [`docs/adr/`](docs/adr/)（决策记录）+ [`docs/reference/architecture.md`](docs/reference/architecture.md) |

## 决策记录

重大选型一律以 **ADR** 形式落档，不接受"口头决定"。见 [`docs/adr/`](docs/adr/)。

| 编号 | 决策 | 状态 |
|---|---|---|
| [0001](docs/adr/0001-license-decision.md) | heyta 自身的许可证选择 | 🟡 **待确认** |
| [0002](docs/adr/0002-migration-tooling.md) | 数据库迁移方案：继续用 Prisma | ✅ 已接受 |

**ADR-0001 是唯一还挡在前面的决策** —— 它决定"能不能用某个库"的判断依据，**建议优先拍板**。

---

*本仓库为个人项目，与滴答清单/TickTick 及其关联公司无任何关系。*
