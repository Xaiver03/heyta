# 贡献指南

面向**人**的贡献流程。面向 AI agent 的硬性规则在 [`AGENTS.md`](AGENTS.md) —— 两边都读，但规则以 AGENTS.md 为准，本文件不重复。

---

## 1. 环境准备

```bash
node -v          # 需要 >= 22
pnpm -v          # 需要 11.x（根 package.json 已用 packageManager 锁定）

pnpm install
pnpm -r build
pnpm -r test     # 应该全绿
```

数据库迁移、本地跑服务端、Docker 部署：见
[`docs/runbooks/local-server-verification.md`](docs/runbooks/local-server-verification.md)。

---

## 2. 提交前门禁（必须全过）

**唯一权威是 `pnpm check`** —— 它是全部门禁的串联，CI 跑的就是它（`.github/workflows/ci.yml`）。
⚠️ 这里**刻意不写门禁条数** —— 这条纪律有来历，见 `AGENTS.md` §7
里那条「`pnpm <名字>` 找不到脚本时会去跑 PATH 上同名二进制」的陷阱：那句话漂过一次。
要数就直接读 `package.json` 的 `check` 脚本，那是唯一权威。

```bash
pnpm check   # build + typecheck + 迁移 / 分层 / 词条 / 许可证 / 死链 / 定价 / AI 额度 /
             #   设计 / token / ArkTS / 原生依赖 / 移动包 / 物化读 / AI 覆盖 / AI e2e
pnpm test    # 全部单测（CI 也跑这一步）
```

只想快速迭代时，下面几条是最常改动的**子集** —— 但它们**不等于"全过"**：

```bash
pnpm -r typecheck                          # 类型
pnpm -r test                               # 测试
node research/tools/license-inventory.mjs  # 许可证（引入新依赖时必跑）
node research/tools/docs-link-check.mjs    # 改了文档时必跑
```

退出码 **0 = 通过**。别等 CI 告诉你。这条纪律有来历：在 `.github/workflows/ci.yml`
建立**之前**，仓库没有任何 CI，`pnpm check` 只由人手动跑 ——
结果是 **`pnpm check` 在干净检出上从来就没通过过，而这个事实可以一直没人知道**。

---

## 3. 提交信息

- **说清"为什么"**，不只是"改了什么"。尤其是反直觉的地方：
  > 好：`fix: server deps use "*" not workspace:* (npm cannot resolve workspace: protocol in the Docker runtime stage)`
  >
  > 差：`fix: deps`
- 一次提交做一件事。把"修 bug"和"顺手格式化"混在一起会让评审无法判断风险。
- 触及**不可逆层**（线协议、schema、迁移）时，提交信息里写明影响面与回滚方式。

---

## 4. 评审要点

评审时**先问该不该做，再问做得对不对**。一个正确实现了但本不该存在的功能，仍然是退步。

重点看**长期成本**，而不是当前 diff 是否正确：

| 看什么 | 为什么 |
|---|---|
| 数据形状 / 线协议 / 插件 API | 一旦发布就近乎不可逆 |
| 是否新增了依赖 | 两道门：可维护性（2021 后仍在更新）+ 许可证白名单 |
| 是否 bump 了 schema 版本 | **默认不该 bump**，见 AGENTS.md §3.3 |
| 是否给持久化模型加了必填字段 | 会静默破坏所有老安装 |
| 门禁/校验是否**真的会失败** | 不能失败的检查没有价值 —— 请故意喂一个违规输入验证 |
| 同步逻辑改动 | 🔴 高风险：可能静默损坏或丢失跨设备数据。要求可复现的失败用例，不接受"防御性地加个判断" |

### 不可逆层变更的额外要求

改动 `packages/shared-schema/`、线协议契约、`server/prisma/migrations/` 时：

1. 先有新写的或更新的 **ADR**（见 [`docs/adr/`](docs/adr/)）
2. 说明**老客户端/老数据**会发生什么
3. 迁移要符合 [`AGENTS.md` §4](AGENTS.md) 的单语句与可恢复形状规则

---

## 5. 文档

按 [`docs/README.md`](docs/README.md) 的分层规则放置：

| 你要写的东西 | 放哪 |
|---|---|
| 一次决策（选了 X 不选 Y） | `docs/adr/` |
| 计划、进度、排期 | `docs/plans/` |
| 稳定的工程参考（架构、协议） | `docs/reference/` |
| 怎么操作某件事 | `docs/runbooks/` |
| 一次调研的过程与证据 | `docs/research/` |

**ADR 不可修改**。结论变了就新写一份，互相标注取代关系。

---

## 6. 如果你是 AI agent

不要只看本文件 —— 读 [`AGENTS.md`](AGENTS.md)，那里有仓库地图、硬性约束和**实测踩过的环境陷阱**
（`DATABASE_URL` 污染 compose、`minimumReleaseAge` 导致"本地过容器不过"、服务端强制 E2EE 等）。
