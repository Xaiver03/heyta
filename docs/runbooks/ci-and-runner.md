# CI 与自托管 runner 操作手册

> 本文件是 **CI 怎么跑、runner 怎么运维的唯一操作事实源**。
>
> 配套：
> - 门禁清单本身见 [`../../AGENTS.md`](../../AGENTS.md) §6；
> - 服务器分工与代理链路见同目录的 [`deployment.md`](deployment.md)；
> - AI 相关的门槛（`check:layering` 的 AI 规则等）见
>   [`../reference/ai-architecture.md`](../reference/ai-architecture.md) §13。
>
> ⚠️ 本文件里的每一条命令都**在 finlaw 上实跑过**。标「未核实」的才是没验过的。

## 0. 图例

| 标记 | 含义 |
|---|---|
| ✅ | 实测通过，命令可直接复制 |
| 🔴 | 硬约束，违反会出事（安全 / 计费 / 数据） |
| ⚠️ | 容易踩的坑，已踩过 |

---

## 1. 一句话

`push` 到 `main`（或提 PR）→ GitHub 把任务派给 **finlaw 上的自托管 runner**
→ 在容器里干净检出一份新克隆 → 跑 `pnpm check`（门禁串联）+ `pnpm test`
→ 结果回报 GitHub。

⚠️ **门禁条数刻意不写在这里** —— 它漂过好几次。唯一权威是根 `package.json` 的
`check` 脚本，`pnpm check` 就是按它逐条跑的；要数就直接读那一行。

**这个 workflow 的核心不是"跑一下测试"，而是每次都在干净环境里重新回答一次
「一个新克隆能不能自己立起来」。**

---

## 2. 为什么要有 CI

在此之前，仓库**没有任何 CI**，`pnpm check` 只由人手动跑。后果是：

> 🔴 **`pnpm check` 在干净检出上从来就没通过过，而这个事实可以一直没人知道。**

三个被它掩盖的缺陷，全都是靠"换一台机器 / 换一个目录再来一遍"才现形的：

| # | 缺陷 | 为什么开发机上看不见 |
|---|---|---|
| 1 | 14 个包的 tsconfig 都声明 `types: ["vitest", "node"]`，但**没人声明 `@types/node`** | 被开发机上层路径里的 `~/node_modules` 兜住了 |
| 2 | `server` 的 build 需要已生成的 Prisma Client，却只有 `pretest` 里有 `prisma generate` | 同上 |
| 3 | `server` 声明了 `@types/ws`（类型）却**没有 `ws`（运行时本体）** | 同上 |

三类属于**同一个模式：声明了能力，本体从没被真正装上。**

所以 workflow 坚持 `pnpm install --frozen-lockfile`：
package.json 与 lockfile 一旦漂移立刻红，而不是等到某个人在新机器上克隆时才炸。

---

## 3. runner 放在哪

| 项 | 值 |
|---|---|
| 主机 | **finlaw**（SSH 别名 `finlaw` / `ubuntu-jcli`，`124.223.13.226`） |
| 系统 | Ubuntu 22.04.5 LTS / `x86_64` / **4 核** / 7 GiB RAM / 磁盘 ~35 G 可用 |
| GitHub 上的名字 | `heyta-ci-finlaw` |
| 标签 | `self-hosted`, `Linux`, `X64`, `heyta-ci` |
| 容器名 | `heyta-ci-runner` |
| 目录 | `/opt/heyta-ci/` |
| 状态 | ✅ `online` |

**为什么是 finlaw**：这台本来就是构建机（跑着 registry + buildkit），
而且**没有邮件服务器** —— 最坏的失败模式只是"构建变慢"，不是"邮件发不出去"。

> ⚠️ 曾考虑过 `sanjiaozhou`（8 核 / 15 GiB，配置更好），**已否决**：
> 那台跑着 14 个生产容器，**包括 Mailu 邮件服务器**（25 / 465 / 993）。
> 把 CI 放上去等于让一个限流失败的构建任务和一个邮件服务抢资源。

---

## 4. runner 的组成

三个文件 + 一个数据目录：

```
/opt/heyta-ci/
├── Dockerfile            # 派生镜像（补 libatomic1 + 预铺 runner 本体）
├── docker-compose.yml    # 容器定义（含 entrypoint 脚本）
├── .env                  # RUNNER_TOKEN（mode 600）
└── data/                 # 挂进 /home/runner —— runner 本体 + _work（Node 工具链）
```

### 4.1 为什么需要派生镜像

`docker-compose.yml` 里**没有** `build:`，镜像 `heyta-ci-runner:local` 是本地构建的。
它解决两件事：

| 问题 | 做法 |
|---|---|
| `@pnpm/exe/pnpm` 报 `libatomic.so.1: cannot open shared object file`（exit 127） | `apt-get install libatomic1` |
| 挂载 `/opt/heyta-ci/data` 会**盖住** `/home/runner`，导致 `./config.sh: No such file or directory` | 镜像里把 runner 本体复制到 `/opt/runner-seed`，首次启动再铺进挂载目录 |

### 4.2 🔴 entrypoint 为什么写成列表

```yaml
entrypoint:
  - /bin/bash
  - -c
  - |
    set -e
    ...
```

⚠️ **写成 `command: |` 多行字符串时，Compose 会按空白把它拆成
`["set","-e","if",...]`** —— `bash -lc` 就只执行了 `set` 一个词。
症状是**日志里把全部 shell 变量打印出来**而 runner 完全没注册。

⚠️ 还有一条：**Compose 也会插值 `entrypoint` 里的 `$VAR`**。
所以脚本里引用环境变量必须转义成 `$$RUNNER_REPOSITORY_URL`，
否则会被 Compose 替换成空字符串，配置时报
`Invalid configuration provided for url. Terminating unattended configuration`（`Arg 'url': ''`）。

### 4.3 🔴 代理是必需的，不是可选

**finlaw 直连 `github.com` 是超时的（实测）** —— 不挂代理，clone 会永久卡住。
宿主机 mihomo 监听 docker0 网关 `172.17.0.1:7890`，容器可达。

✅ 实测走代理：`github.com` HTTP **200 / 0.68 s / 846 KB/s**。

---

## 5. 日常操作

所有命令都**不需要 sudo**（`ubuntu` 用户在 `docker` 组里）。

```bash
ssh finlaw
```

| 我要… | 命令 |
|---|---|
| 看容器在不在 | `docker compose -f /opt/heyta-ci/docker-compose.yml ps` |
| 看实时日志 | `docker logs -f heyta-ci-runner` |
| 重启 | `docker compose -f /opt/heyta-ci/docker-compose.yml restart` |
| 停 | `docker compose -f /opt/heyta-ci/docker-compose.yml down` |
| 起 | `docker compose -f /opt/heyta-ci/docker-compose.yml up -d` |
| 看 GitHub 侧是否在线 | `gh api repos/Xaiver03/heyta/actions/runners --jq '.runners[] \| "\(.name) \(.status)"'` |
| 看某次运行 | `gh run list --limit 5` / `gh run view <id> --log` |

### 5.1 ⚠️ 日志里的 `BrokerServer` 报错是正常的

```
ERR BrokerServer] System.Net.Sockets.SocketException (125): Operation canceled
WARN BrokerServer] Back off 5.847 seconds before next retry. 4 attempt left.
```

这是长轮询被取消后重连，**不影响在线状态**。判断"到底好不好"要看
GitHub 侧的状态（上一节的 `gh api`），**不要看这条日志**。

### 5.2 换 token / 重新注册

runner 的 token 只用于**首次注册**；注册成功后 `.runner` 文件存在，
脚本会走 `已注册过，直接启动（不需要新 token）` 分支。

需要重新注册时（例如换了仓库、或 runner 被删）：

```bash
# 1. 去 GitHub 取新 token（有效期 1 小时）
gh api -X POST repos/Xaiver03/heyta/actions/runners/registration-token --jq .token

# 2. 写进 .env
ssh finlaw
cd /opt/heyta-ci
vi .env                     # 只改 RUNNER_TOKEN=...

# 3. 删掉 .runner 让它重新走注册分支，然后重启
sudo rm -f data/.runner
docker compose -f /opt/heyta-ci/docker-compose.yml up -d --force-recreate
```

⚠️ `.env` 的权限必须是 `600`（现在是）。里面是**能注册 runner 的凭据**。

---

## 6. 安全边界

| 项 | 现状 |
|---|---|
| 运行用户 | **非 root**（`1001:1001`，镜像内置的 runner 用户） |
| 资源上限 | `cpus: 2` / `mem_limit: 3g` / `pids_limit: 2048` |
| 🔴 docker socket | **不挂** —— 挂了等于把宿主机 root 交出去 |
| 重启策略 | `restart: unless-stopped` |
| 工作流权限 | `permissions: contents: read` —— 这个 workflow 不写回任何东西 |

限流收得比配置允许的**更紧**：这台只有 4 核、负载常年 3.5+。
CI 属于"**可以慢、不可以抢**"的负载，2 核 / 3G 是刻意留余量。

---

## 7. 🔴🔴 计费与「转公开」的硬约束

| 事实 | 依据 |
|---|---|
| 自托管 runner **免费无限量** | GitHub 官方计费文档明说 |
| 私有仓库的 GitHub 托管 runner **有月度分钟额度** | 这就是当初选自托管的原因 |
| **公开仓库在标准托管 runner 上也是免费的** | 所以公开后没有理由再自托管 |

计费单价（备查）：`actions_linux` $0.006/min、`actions_macos` $0.062/min、
`actions_windows` $0.010/min。

> ### 🔴🔴 如果哪天这个仓库要转公开，**必须先把 `runs-on` 改回 `ubuntu-latest`**。
>
> 自托管 runner + 公开仓库是**最危险的组合**：任何人都能提 PR，
> 而 PR 的工作流会在**你自己的服务器上**执行任意代码。
>
> 两者只能选一个 —— 想公开就回到托管 runner（公开仓库同样免费）。

---

## 8. CI 里跑不了的两件事（已如实交代）

workflow 有**两个 `if: always()` 的诚实步骤**，把跑不了的写进 Job Summary
并 `::warning`，**不让它们安静地空跑**：

| 门禁 / 测试 | 为什么跑不了 | 本机怎么真跑 |
|---|---|---|
| `check:arkts` | 需要真 ArkTS 编译器 `es2abc`（随 DevEco Studio 分发）。找不到时它**故意 exit 0 并打印"跳过"** | 在装有 DevEco Studio 的 macOS 上跑 |
| `apps/web` 的真实用户旅程测试 | 需要真实模型端点（`/tmp/heyta-ai-live/provider.json`），CI 里不存在，会 `skipIf` 跳过 | `pnpm verify:ai-live` 系列 |

⚠️ 测试汇总里的 **skipped 数量就来自第二项**。
看到 skipped 不要当成失败，但也不要当成通过 —— 去 Job Summary 看它说了什么。

---

## 9. 排障速查

| 症状 | 原因 | 处理 |
|---|---|---|
| 任务一直 **Queued**，不派给 runner | runner 离线，或标签不匹配 | `gh api .../actions/runners` 看状态；确认 `runs-on` 的标签与容器 `RUNNER_LABELS` 一致 |
| 「检出」卡住十几分钟 | **不是 runner 坏了** | 曾经是仓库体积问题（444.9 MiB 缓存）；现在已清理到 10.3 MiB。若复现，查仓库大小与代理 |
| `libatomic.so.1: cannot open shared object file`，exit 127 | 基础镜像缺库 | 已在派生镜像里 `apt-get install libatomic1`；改镜像后要重建 |
| `./config.sh: No such file or directory` | 挂载盖住了 `/home/runner` | 派生镜像 + `/opt/runner-seed` 预铺（见 §4.1） |
| 日志打印出 shell 变量、runner 没注册 | `command: \|` 被按空白拆成 argv | entrypoint 写成列表（见 §4.2） |
| `Invalid configuration provided for url` | Compose 插值吃掉了 `$RUNNER_*` | 转义成 `$$RUNNER_*`（见 §4.2） |
| clone 永久卡住 | finlaw 直连 github.com 超时 | 确认代理环境变量在容器里生效（见 §4.3） |

---

## 10. 当前基线

| 项 | 值 |
|---|---|
| 工作流文件 | [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)（144 行） |
| 触发 | `push` 到 `main`、`pull_request`、`workflow_dispatch` |
| 并发 | 同分支连续 push **取消上一次**（省额度） |
| 超时 | `timeout-minutes: 40` |
| Node 版本 | **24**（写死） |
| 步进 | 检出 → 装 pnpm → 装 Node → 根 `--frozen-lockfile` → **`pnpm --dir e2e install --frozen-lockfile`** → 缓存/装 Chromium → `pnpm check` → `pnpm test` → 两条诚实说明 |
| 门禁 | 见根 `package.json` 的 `check` 脚本（本文件刻意不写条数） |
| 首次全绿 | run `36228333270`，**12 分 21 秒**，当时那批门禁 + 3256 个测试全过 |

> ⚠️ **`e2e/` 那一步不能省**：它是**独立工作区**（`e2e/pnpm-workspace.yaml`，自带 lockfile），
> 根 `pnpm install` 不装它。漏掉的表现是 `check:ai-e2e` 报
> `playwright: command not found` —— 看着像门禁坏了，其实是没装。

### ⚠️ 关于 Node 版本的一个未核实项

根 `package.json` 的 `engines` 写的是 `"node": ">=22"`，但 workflow 里**写死 24**，
注释里也明说了原因：

- `packages/storage` 与 `apps/node-host` 用 `node:sqlite`；
- `node:sqlite` 在 **Node 22.5–23.3 需要 `--experimental-sqlite` 标志**，到 23.4 才免标志；
- 测试脚本是裸的 `vitest run`，没有那个标志。

> 也就是说 `engines` 的 `">=22"` 是**没被验证过**的声明 —— 这是一条**待办**，
> 不是这里能顺手改的。见 [`../../AGENTS.md`](../../AGENTS.md) §9。

---

## 11. 换一台 runner 要做的事

1. 在新机器上建 `/opt/heyta-ci/`，放**三个文件**（`Dockerfile` / `docker-compose.yml` / `.env`）。
2. 改 `docker-compose.yml` 的 `RUNNER_NAME`（**别和 `heyta-ci-finlaw` 重名**）
   与代理地址（`HTTP_PROXY` 等，若该机不需要代理就删掉那 6 行）。
3. `docker build -t heyta-ci-runner:local /opt/heyta-ci`
4. 取 registration token 写进 `.env`（§5.2）。
5. `docker compose -f /opt/heyta-ci/docker-compose.yml up -d`
6. `gh api repos/Xaiver03/heyta/actions/runners` 确认在线、标签含 `heyta-ci`。
7. 🔴 确认 `runs-on` 的四个标签与新 runner 一致；
   若是**替换**而非新增，删掉 GitHub 上的旧 runner 记录。
