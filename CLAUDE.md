# CLAUDE.md

本仓库的 agent 规则**只有一份**，在 [`AGENTS.md`](AGENTS.md)。

请直接读它 —— 那里有：仓库地图、硬性约束（可维护性门槛 / 许可证 / schema 与持久化字段 / op-log 纪律）、
数据库迁移纪律、常用命令、**实测踩过的环境陷阱**，以及当前进度。

这里**故意不复制**那些规则。两份规则一定会漂移，而漂移的规则比没有规则更危险：
agent 会照着过期的那份执行，而且没人知道哪份是对的。

---

## 如果你只想快速上手

| 我要… | 去哪 |
|---|---|
| 知道这个项目是什么 | [`AGENTS.md` §1](AGENTS.md) |
| 知道某段代码能不能改 | [`AGENTS.md` §2 仓库地图](AGENTS.md) |
| 引入一个新依赖 | [`AGENTS.md` §3.1–3.2](AGENTS.md)（两道门：可维护性 + 许可证） |
| 改数据库迁移 | [`AGENTS.md` §4](AGENTS.md) —— **别直接跑 `prisma migrate deploy`** |
| 跑测试 / 验收 | [`AGENTS.md` §5](AGENTS.md) |
| 排查"本地过、容器不过" | [`AGENTS.md` §6](AGENTS.md) |
| 知道现在做到哪了 | [`AGENTS.md` §8](AGENTS.md) + [`docs/plans/roadmap.md`](docs/plans/roadmap.md) |
| 知道文档该放哪 | [`docs/README.md`](docs/README.md) |
| 提 PR | [`CONTRIBUTING.md`](CONTRIBUTING.md) |
