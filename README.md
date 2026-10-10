# heyta

一款**功能对标滴答清单（TickTick）**的任务 / 习惯 / 专注管理应用 —— 目标是不再为高昂的订阅费买单，并且**可以自建自托管**。

> **当前状态：P0 奠基 ✅ · P1 单端闭环 ✅ · P2 多端补齐 🔄 进行中（2026-09-27）。**
> 同步协议已在真实 Docker + PostgreSQL 上验证：A 端加密写入 → B 端可见 → 载荷在服务端保持密文
> → 并发写入被判 `CONFLICT_CONCURRENT`。Web 端核心功能与冲突解决闭环已跑通（零 mock E2E）。
> AI 线（基座 / 捕获 / 结构化 / 本地 API）与激励成长体系均已并入 `main`。
> **进度以 [`docs/plans/roadmap.md`](docs/plans/roadmap.md) 为准**，这里只给一句话。

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
   **导出**覆盖 **Web 设置页**（JSON 完整保真 / Markdown 清单）、**node-host CLI**
   （`heyta-ai export --out <路径>`）与 **移动端**（「我的 → 导出数据」，走系统分享面板 ——
   手机上分享出去的是一个文本片段，文件名由接收方决定，界面里如实写着这一点）。
   导出含墓碑与完整 op-log，所以它是完整的。
   **导入**覆盖 **Web 设置页**、**node-host CLI** 与**移动端**（「导出数据」页的「从备份还原」卡），
   三端同一条口径：**只支持还原到空库**（合并到非空库会静默丢数据，是被明确拒绝的，不是排期问题）。
   ⚠️ 原句「移动端只有导出、没有导入」在 2026-10-03（goal 批五）过期；
   移动端那条诚实条款现在是**还原回来的数据只在这台设备上**（op 带来源设备 `clientId` ⇒ 不上行）。
6. **许可证干净**：所有引入的代码必须允许我们的分发/商业模式，逐项登记。
7. **可维护优先**：引入的第三方组件**必须 2021 年之后仍在持续更新**。许可证再宽松，
   一个停更三年的库也是负债。

## 快速开始

```bash
pnpm install
pnpm -r build
pnpm -r test          # 全部单测（2026-09-27 实测：16 个工作区项目 4652 passed / 13 skipped）
                      #   那 13 条是 env-gated 的 `describe.skipIf`（web 12 条需要真实服务端
                      #   的 e2e，server 1 条同理），不是失败。`e2e/` 不在根工作区，另跑。

pnpm verify:sync:dry  # 校验同步 op 形状（不需要服务端）
pnpm check            # 构建 + 类型 + 全套门禁（迁移 / 分层 / 词条 / 许可证 / 死链 / 定价 /
                      #   AI 额度 / 设计 / token / ArkTS / 原生依赖 / 移动包 / 物化读 / AI 覆盖 / AI e2e）
```

跑通服务端（本地或 Docker）、数据库迁移、完整验收流程：
👉 [`docs/runbooks/local-server-verification.md`](docs/runbooks/local-server-verification.md)

## 目录结构

```
heyta/
├── packages/
│   ├── sync-core/        # 同步内核：加密、向量时钟、冲突判定（vendored, MIT，不改动）
│   ├── shared-schema/    # 实体清单、schema 版本、HTTP 线协议契约（zod）
│   ├── storage/          # 存储适配层：接口 + IndexedDB / SQLite / 内存三套实现
│   ├── op-log/           # op-log 状态机、墓碑、崩溃恢复、实体覆盖门禁
│   ├── domain/           # 领域规则：四象限派生、习惯连续与韧性、RRULE、番茄钟、时间归因
│   ├── app-host/         # 宿主外壳：把领域 + 存储 + 同步接成可直接渲染的门面（两端共用）
│   ├── ai/               # AI 出站：provider / routing / egress / presets / supply / health
│   ├── local-api/        # AI 入站：只监听回环的本地 API / MCP server
│   ├── design-system/    # 设计 token 与生成物（TS / RN / Swift / ArkTS）+ 对比度实测
│   └── i18n/             # 中英词条表（自研零依赖，受 check:ui-language 约束）
├── apps/
│   ├── web/              # Web 客户端（产品主入口）
│   ├── mobile/           # React Native 移动端（Android / iOS / 鸿蒙）
│   ├── node-host/        # 笔记本 / 桌面宿主设备
│   └── landing/          # 落地页
├── server/               # 同步服务端 + 计费：Fastify + Prisma + PostgreSQL（vendored, MIT）
├── e2e/                  # 真浏览器验收（⚠️ **刻意不在根 pnpm 工作区内**，自己一份 lockfile）
├── docs/                 # 产品文档（分层规则见 docs/README.md）
├── design-system/        # 设计系统的门禁脚本（硬编码扫描 / ArkTS 编译）
├── research/             # 调研原料：上游克隆、原始报告、工具脚本（非产品文档）
└── scripts/              # 仓库级脚本与门禁（全部 check:* 的实现）
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

**全部 ADR 的清单在 [`docs/README.md`](docs/README.md#adr--架构决策记录)** ——
这里**刻意不复制一份**，避免两处漂移。这条纪律是有来历的：README 曾经自己维护一张两行的
ADR 表，然后它漂了 —— 长期把**早已接受的 ADR-0001 标成「🟡 待确认」**，还声称它是
"唯一还挡在前面的决策"。两张表必然对不上，所以只留一张。
