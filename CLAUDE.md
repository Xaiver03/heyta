# CLAUDE.md

本仓库的 agent 规则**只有一份**，入口是 [`AGENTS.md`](AGENTS.md)。

2026-10-12 起，详细规则按**作用域**拆到 [`docs/agents/`](docs/agents/) 下 ——
原先那份 131,843 字节（128.8 KiB）的单体文件超出 Codex `project_doc_max_bytes`
默认值 4.0 倍，**约 3/4 的内容从未被任何 agent 读到过**。
现在 `AGENTS.md` 是**入口与索引**（10.9 KiB），全文在 `docs/agents/`。

这里**故意不复制**那些规则。两份规则一定会漂移，而漂移的规则比没有规则更危险：
agent 会照着过期的那份执行，而且没人知道哪份是对的。

---

## 如果你只想快速上手

| 我要… | 去哪 |
|---|---|
| 知道这个项目是什么 | [`AGENTS.md` §1](AGENTS.md) |
| 知道某段代码能不能改 | [`AGENTS.md` §2 仓库地图](AGENTS.md) → [`docs/agents/repo-map.md`](docs/agents/repo-map.md) |
| 引入一个新依赖 | [`docs/agents/hard-constraints.md`](docs/agents/hard-constraints.md) §3.1–3.2（两道门：可维护性 + 许可证） |
| 改数据库迁移 | [`docs/agents/db-migrations.md`](docs/agents/db-migrations.md) —— **别直接跑 `prisma migrate deploy`** |
| 写 UI | [`docs/agents/design-system.md`](docs/agents/design-system.md) |
| 跑测试 / 验收 | [`docs/agents/commands.md`](docs/agents/commands.md) + [`docs/agents/ui-acceptance.md`](docs/agents/ui-acceptance.md) |
| 交付一轮（四端重装） | [`docs/agents/multi-end-build.md`](docs/agents/multi-end-build.md) |
| 排查"本地过、容器不过" | [`AGENTS.md` §5](AGENTS.md) → [`docs/agents/environment-traps-index.md`](docs/agents/environment-traps-index.md) |
| 知道现在做到哪了 | [`docs/agents/progress-log.md`](docs/agents/progress-log.md) + [`docs/plans/roadmap.md`](docs/plans/roadmap.md) |
| 知道有哪些已定决策 | [`docs/agents/key-decisions.md`](docs/agents/key-decisions.md) |
| 知道文档该放哪 | [`docs/README.md`](docs/README.md) |
| 提 PR | [`CONTRIBUTING.md`](CONTRIBUTING.md) |

**规则地图（全部子文件一览）在 [`AGENTS.md` §4](AGENTS.md)。**
