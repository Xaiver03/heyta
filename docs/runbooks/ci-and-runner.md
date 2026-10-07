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

---

## 🟢 当前答案（2026-10-06 起）

| | 现在怎么跑 | 以前怎么跑 |
|---|---|---|
| **载体** | **`node scripts/gate-ssh.mjs`**（§12）：源码经 **SSH** 送到 finlaw，在一枚容器里干净装依赖、逐段跑根 `package.json` 的 `check` | push → GitHub Actions → finlaw 上的自托管 runner 容器 |
| **为什么换** | runner 那条路的每一个字节都要经宿主机 mihomo（付费代理额度）。实测**门禁需要的源这台机器直连就通**，需要代理的只有 GitHub 的批量传输与 docker.io 拉取 —— 两样都能绕开 | 当时以为"GitHub 直连不通 ⇒ 必须走代理" |
| **归因** | 见 [`../research/ci-proxy-traffic-attribution.md`](../research/ci-proxy-traffic-attribution.md)（逐条读数 + 明确写了哪些**归因不到**） | —— |
| **已停用** | 两枚 workflow 手工停用，**没有删除**：`367547590`(CI) / `374087511`(服务端镜像发布) 都是 `disabled_manually` | —— |
| **恢复一条命令** | `gh api -X PUT /repos/Xaiver03/heyta/actions/workflows/367547590/enable`，然后 `ssh ubuntu-jcli 'docker start heyta-ci-runner'` | —— |
| **再停一条命令** | `gh api -X POST /repos/Xaiver03/heyta/actions/workflows/367547590/disable` + `ssh ubuntu-jcli 'docker stop heyta-ci-runner'` | —— |

🔴 **§3–§11 描述的是那台自托管 runner**（容器与 `/opt/heyta-ci` 都**还在**，只是停了）。
留着不是整理没做完 —— 那里记着"为什么当初必须自托管"（§2、§7 转公开的硬约束）
和七八条**只会以同样方式再踩一次**的坑（§4.2 的 Compose 拆词、§8.1 的"看着在跑其实什么都没验"）。
那些理由与坑**和走哪条路无关**，换载体不会让它们失效。

---


## 0. 图例

| 标记 | 含义 |
|---|---|
| ✅ | 实测通过，命令可直接复制 |
| 🔴 | 硬约束，违反会出事（安全 / 计费 / 数据） |
| ⚠️ | 容易踩的坑，已踩过 |

---

## 1. 一句话

**现在**：人在开发机上敲一条 `node scripts/gate-ssh.mjs` → 源码打包经 **SSH** 送到 finlaw
的一个隔离目录 → 在一枚容器里 `pnpm install --frozen-lockfile` → **逐段**跑根
`package.json` 的 `check` → 每段一个 rc 落进 `result.tsv`，汇总印"真正执行 N / 全链 M 段、
因环境跳过 K 段"。全程**没有一个字节经过 mihomo**（这条是被测出来的，见 §12.4）。

**以前（§3 起那一整段，已停用但保留）**：`push` 到 `main`（或提 PR）→ GitHub 把任务派给
**finlaw 上的自托管 runner** → 在容器里干净检出一份新克隆 → 跑 `pnpm check`（门禁串联）
+ `pnpm test` → 结果回报 GitHub。

⚠️ **门禁条数刻意不写在这里** —— 它漂过好几次。唯一权威是根 `package.json` 的
`check` 脚本，`pnpm check` 就是按它逐条跑的；要数就直接读那一行。
新载体同样是**运行时解析那一行**，`scripts/check-gate-ssh.mjs` 里有一条臂专门钉这件事
（注入"抄一份硬编码清单"会红）。

**这个载体的核心不是"跑一下测试"，而是每次都在干净环境里重新回答一次
「一个新克隆能不能自己立起来」。** 换载体没有改这一条 —— §12.3 里那条"镜像不许预装依赖"
就是它的落地。

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

> ⚠️ **§3 到 §11 是已停用的那条路**（2026-10-06 停用，容器与目录都还在）。
> 保留的理由写在文件顶部那张表下面；要跑门禁请看 §12。

| 项 | 值 |
|---|---|
| 主机 | **finlaw**（SSH 别名 `finlaw` / `ubuntu-jcli`，`124.223.13.226`） |
| 系统 | Ubuntu 22.04.5 LTS / `x86_64` / **4 核** / 7 GiB RAM / 磁盘 ~35 G 可用 |
| GitHub 上的名字 | `heyta-ci-finlaw` |
| 标签 | `self-hosted`, `Linux`, `X64`, `heyta-ci` |
| 容器名 | `heyta-ci-runner` |
| 目录 | `/opt/heyta-ci/` |
| 状态 | 🟡 **`exited (143)`，容器保留**（2026-10-06 由 `docker stop` 停；恢复 `docker start heyta-ci-runner`） |

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

> 🔴 **这条的前提在 2026-10-06 被复测推翻了一半，原文留着**（它撑住了"当初为什么必须
> 自托管 + 为什么必须挂代理"，那部分**结论仍然成立**，只是理由换了位置）：
>
> | 原话 | 复测读数（2026-10-06，命令见归因文档 §6.7） |
> |---|---|
> | "finlaw 直连 `github.com` 是超时的（实测）" | **不再成立**：`https://github.com/` = **200 / 0.09 s**，宿主 5/5 次、容器 1/1 次；`api.github.com` = 200 / 0.47 s |
> | "不挂代理，clone 会永久卡住" | **仍然成立，但要改口径**：慢的是**批量传输** —— `codeload.github.com` 直连实测 **109 KB/s**，20 s 只拿到 2.19 MB 就超时。63 MiB 的源码包按这个速率约 **10 分钟且会中途失败** |
> | "所以必须走代理" | 对**当时的动作**成立（一次冷构建要下 Node 208 MB + Chromium 658 MB + Electron 100 MB+，全从 GitHub/Azure CDN） |
>
> 🔴 **可迁移的一条**：那条"实测"在十天内变成了"只对批量传输成立"，而没人回去量过 ——
> 于是它同时撑住了两句本来该分开说的话。凡把一条网络读数当**决策前提**，旁边必须写复现命令。
>
> **换载体之后**：批量传输那一站被绕开了 —— 源码由 SSH（22 端口，实测直连、`~/.ssh/config`
> 无 ProxyCommand）送来，依赖从 `registry.npmmirror.com` 取（实测**直连 9.4 MB/s**，
> 比走代理的 0–40 KiB/s 快两个数量级），基础镜像用机器上已有的那一枚（不 pull）。
> 详见 §12。

**宿主机 mihomo 监听 docker0 网关 `172.17.0.1:7890`**，容器可达（这条没变，仍是事实）。
✅ 实测走代理：`github.com` HTTP **200 / 0.68 s / 846 KB/s**（2026-09-26 的读数）。

⚠️ 另有三条**不写在环境变量里**的代理通道，2026-10-06 现量：

1. `git config --global http.proxy=http://172.17.0.1:7890`（finlaw 的 ubuntu 用户）。
   ⇒ 清掉 shell 变量**拦不住它**：一次 `git ls-remote https://github.com/…` 在
   "看起来没有代理"的 shell 里照样成功。我自己差点把这条读成"直连 GitHub 通了"。
2. `/etc/docker/daemon.json` 里的 `proxies` 块 = 同一个 mihomo。
   ⇒ 任何 `docker pull` 都是代理字节。这一条**不能改**（红线），所以新载体只用
   **机器上已有**的基础镜像，缺了就响亮拒绝、不去 pull。
3. runner 容器 compose 里那 6 行（`HTTP_PROXY` 等）—— 那是**显式**设置，最容易看见。

✅ 同时实测：daemon 的 proxy **不会**注入到普通容器 ——
`docker inspect supersync-server` 里 proxy 变量命中 **0 条**。所以"容器不挂代理"
是默认状态，而新载体仍然把六个变量**显式置空**：盖掉镜像层可能带进来的值。

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

## 8. CI 里跑不了的三件事（已如实交代）

workflow 有**两个 `if: always()` 的诚实步骤**，把跑不了的写进 Job Summary
并 `::warning`，**不让它们安静地空跑**：

| 门禁 / 测试 | 为什么跑不了 | 本机怎么真跑 |
|---|---|---|
| `check:arkts` | 需要真 ArkTS 编译器 `es2abc`（随 DevEco Studio 分发）。找不到时它**故意 exit 0 并打印"跳过"** | 在装有 DevEco Studio 的 macOS 上跑 |
| `apps/web` 的真实用户旅程测试 | 需要真实模型端点（`/tmp/heyta-ai-live/provider.json`），CI 里不存在，会 `skipIf` 跳过 | `pnpm verify:ai-live` 系列 |
| **桌面窗口冒烟**（`e2e/tests/desktop-window.spec.ts` 的"开发构建"一条） | **runner 拉不到 Electron 二进制**：`electron/index.js` 打印 `Downloading Electron binary...`，90 秒后 `TypeError: fetch failed`。装不上就 `test.skip` | `node apps/desktop/node_modules/electron/install.js`（要代理，见 [`desktop.md`](desktop.md) §4.1）后跑 `pnpm --dir e2e test` |

⚠️ 测试汇总里的 **skipped 数量就来自第二、三项**。
看到 skipped 不要当成失败，但也不要当成通过 —— 去 Job Summary 看它说了什么。

### 🔴 第三项曾经不是"跳过"，而是**把整套测试带崩**

2026-09-28 实测：那一版 `desktop-window.spec.ts` 把

```ts
const electronBinary = desktopRequire('electron');   // ← 模块顶层
```

写在**模块顶层**。而 `electron/index.js` 在 `path.txt` 缺失时会**自动发起下载** ——
于是这个文件**只要被"收集"（还没跑任何用例）**就会下载 100 MB+，
拉到失败就抛 `Error: Electron failed to install correctly`。

后果比"某条用例失败"严重得多：`check:ai-e2e` 跑的是整个 e2e 套件，
**收集阶段就崩 → Playwright 进程直接死 → `门禁` 步骤 exit 1**，
**其余所有 e2e 用例连跑的机会都没有**。

**一个可选二进制的缺失，不该有能力否决整个测试套件。** 修法两条缺一不可：

1. **收集期绝不下载**：先看 `path.txt` 在不在（`existsSync`），在才 `require`；
   判存在用 `require.resolve`（只解析路径），不要用 `require`（会执行）。
2. 不在就 `test.skip(理由)` **响亮跳过** —— 理由里写清"是什么没了"和"怎么补上"。

验证方式（本机，两条都要看）：

```bash
cd e2e
npx playwright test desktop-window --list        # ① 有二进制：应列出 2 条且 exit 0
mv ../../node_modules/.pnpm/electron@*/node_modules/electron/path.txt{,.bak}
npx playwright test desktop-window --list        # ② 没二进制：**也不能崩**，仍 exit 0
npx playwright test desktop-window -g 开发构建    #    → 1 skipped（不是 failed）
mv ../../node_modules/.pnpm/electron@*/node_modules/electron/path.txt{.bak,}
npx playwright test desktop-window -g 开发构建    # ③ 还原后：1 passed（**不能变成永远跳过**）
```

### 8.1 🔴🔴 最难发现的一种红：**看着在跑，其实什么都没验**

**2026-09-27→28 实测**：CI 连续 5 次 `failure`，而失败点**全都**是
`按 lockfile 严格安装`（`pnpm install --frozen-lockfile`）。
后面那两步在 GitHub 的步骤列表里显示成 **`-`（灰色横线，不是 `✗`）**：

```
  ✓ 按 lockfile 严格安装          ← 这一版是修好之后
  ✓ 装 E2E 工作区（独立 lockfile）
  ✓ 缓存 Chromium
  ✓ 装 Chromium
  X 门禁                          ← 真正的红在这里
  - 全量测试                      ← 被跳过
```

**修好之前是这样**：

```
  X 按 lockfile 严格安装
  - 装 E2E 工作区（独立 lockfile）
  - 缓存 Chromium
  - 装 Chromium
  - 门禁                          ← -！不是 ✗
  - 全量测试                      ← -！不是 ✗
```

🔴 **所以"CI 红了"当时只意味着"装依赖失败了"，22 道门禁一次都没跑过。**
而 `gh run view` 的默认输出里，一线人员最可能扫的就是那个 `X` 和结论词 `failure`，
**不会去数后面有几个 `-`**。

**怎么识破**（任一）：

```bash
# ① 数一数到底有几个步骤被跳过 —— 跳过的门禁不产生任何保护
gh run view <id> | sed -n '/JOBS/,/ANNOTATIONS/p'

# ② 直接看那一步的日志标题行，别猜
gh run view <id> --log-failed | grep -E "frozen-lockfile|OUTDATED_LOCKFILE|ELIFECYCLE"

# ③ 只信"门禁"和"全量测试"两步都是 ✓
gh run view <id> --json jobs -q '.jobs[].steps[] | "\(.conclusion//"-") \(.name)"'
```

⚠️ 配套的两个陷阱，都在 [`../../AGENTS.md`](../../AGENTS.md) §7：

- `--frozen-lockfile` 失败**只在干净检出上出现**。本机有 `node_modules`，**毫无感觉**。
- `pnpm check` 的链路是 `build → typecheck → check:*`，**它平时不跑测试**。
  所以"门禁全绿"和"测试全过"是**两件独立的事**，必须都看。

**教训**：一条把前一步失败**吞成"跳过"**的流水线，会让人把"没验"读成"验过了"。
判断 CI 健康，看的是**每一步的结论**，不是那个总体的 `X`。

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
| CI 红，但红的只有 `按 lockfile 严格安装`，**后面全是 `-`** | 锁文件与 `package.json` 不一致 —— 后面的门禁**一个都没跑** | 见 §8.1；修复见 [`../../AGENTS.md`](../../AGENTS.md) §7 |
| 门禁在 CI 红、本机全绿 | 产物字节依赖**环境**（时区 / locale / 换行符） | 见 [`../../AGENTS.md`](../../AGENTS.md) §7 的「golden 夹具：时区必须钉死」 |
| ArkTS 门禁每次都是 `⚠️ 跳过` | runner 上没有 `es2abc`（随 DevEco 分发） | 这是**已交代**的跳过（见 §8），不是通过；只有本机能真跑 |

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

---

## 12. ✅ 当前载体：`gate:ssh`（2026-10-06 起）

### 12.1 一条命令

```bash
node scripts/gate-ssh.mjs              # 跑 HEAD 那一批源码（= 新克隆的语义）
node scripts/gate-ssh.mjs --dirty      # 跑**当前工作树**（含未提交文件，按 .gitignore 排除）
node scripts/gate-ssh.mjs --strict     # 环境类跳过也算红（发版前用这一档）
node scripts/gate-ssh.mjs --dry-run    # 只打印计划，一个字节都不写
```

九个步骤，每一步都有读数、任何一步不对就**响亮停**：

| 步 | 做什么 | 判据（不对就停） |
|---|---|---|
| 1 | 从根 `package.json` 的 `check` **运行时解析**门禁链 | 解析不到就停，不凭记忆编一份 |
| 2 | `git archive`（或临时索引 + `write-tree`）打包 | 归档里 `.env` **枚数必须为 0** |
| 3 | 读远端负载 | 阈值 = `nproc × 3/4`（从被约束的常量推导，不写死）；等满 15 分钟 ⇒ **exit 3 = 环境无效**，不是产品失败 |
| 4 | tar 经 **SSH** 送达 | 两端 **sha256 逐字相同**，对不上拒绝继续 |
| 5 | 确认载体镜像 | 基础镜像必须**已在机器上**；缺了就停 —— 去 `docker pull` 就是代理字节 |
| 6 | 🔴 **出口探针**（在任何花钱动作之前） | `EGRESS=FAIL` 停；`EGRESS=INCONCLUSIVE` 可以继续，但汇总只能写"未证明" |
| 7 | `pnpm install --frozen-lockfile` | 失败 ⇒ 汇总必须写「N 段门禁**一段都没有执行**」并 exit 1 |
| 8 | **逐段**跑链 | 每段一个 rc 进 `result.tsv`；**行数 ≠ 段数就停**（少一行就是有一段既没跑也没登记） |
| 9 | 汇总 | 「真正执行 N / 全链 M」+「因环境跳过 K」逐条点名理由 |

### 12.2 为什么是这个形状（含被否掉的备选）

不变量只有一条：**跑门禁这件事，一个字节都不许再经过 mihomo。** 四条候选路，
按实测挑了一条，其余三条留下为什么不行：

| 备选 | 判决 | 实测理由 |
|---|---|---|
| 在**这台 Mac** 上跑门禁（容器里干净装依赖） | ❌ 否掉 | Mac 的 `git config --global` 里就写着 `http.proxy=127.0.0.1:7890` —— 装依赖同样是**那份付费额度**，只是换台机器花。"零代理"这个性质只有在 finlaw 才成立（那里 SSH 会话里根本没有 proxy 变量，且 npm 源直连可达） |
| 复用那台自托管 **runner**，只是少跑几步 | ❌ 否掉 | runner 的字节大头是 GitHub 批量与 CDN 二进制，"少跑几步"改不了载体；而且它**空转**就在花 1.2 GiB/月（归因文档 §2 第 7 条实测） |
| 在 finlaw 上 `git clone` 拉源码 | ❌ 否掉 | GitHub 的**批量传输**直连实测 109 KB/s 且 20 s 超时（63 MiB ⇒ 十分钟级、中途失败）；而宿主 ubuntu 用户 `git config --global http.proxy` 写着 mihomo ⇒ 一次"看起来没代理"的 clone **照样走代理** |
| **SSH 送 tar + 国内/官方 npm 源直连 + 机器上已有的基础镜像** | ✅ 采用 | 三条都有数：SSH 22 端口直连（`~/.ssh/config` 无 ProxyCommand，实测上行约 350 KB/s ⇒ 63 MiB ≈ 3 分钟）；`registry.npmjs.org` 直连 1.78 MB/s；`node:24-alpine` 242 MB **已在机器上** ⇒ 零 pull |

依赖源那一格有个**反直觉的更正**：默认用的是**官方 registry**，不是国内镜像 ——
`registry.npmmirror.com` 缺包（实测 `pnpm install --frozen-lockfile` 死在
`[ERR_PNPM_FETCH_404] @op-engineering/op-sqlite/-/op-sqlite-18.2.5.tgz`）。
"为了看起来本地化而用一个会缺包的镜像"不成立。旋钮 `HEYTA_GATE_NPM_REGISTRY` 留着。

### 12.3 门禁清单与「响亮跳过」

- **链的唯一权威是根 `package.json` 的 `check`**，`gate-ssh.mjs` 在**运行时解析**它。
  `scripts/check-gate-ssh.mjs` 里有一臂专门注入"抄一份硬编码清单"，会红。
- 逐段跑，**不是**一条 `pnpm check`。理由：那条链是 `&&`，第一段红就整条断，
  后面什么样永远看不到；而"逐段"能给出"哪几段红、红在哪"，也才谈得上把
  **载体跑不了**与**代码坏了**分开登记。
- 🔴 跳过必须**点名 + 给缺的是什么**。`ENV_LIMITED` 那张表每一项都写着缺哪个能力，
  汇总里印成「下面这些**没有被验证**（不是"通过"，是"没跑"）」。今天跳过的是：
  `check:ai-e2e` / `check:privacy-consent-e2e` / `check:landing-e2e`（载体无 Chromium）、
  `screenshot:verify`（没有本轮采集的图）、`check:arkts`（没有 DevEco 的 `es2abc`）。
- `--only` 跑出来的绿会被大字标成「**这不是一次完整验证**」（子集段数 / 全链段数并列）。
  这一条防的是 §8.1 那个形状的**新版**：拿一次局部运行当整体通过。
- `--strict` 把所有跳过折成红。

### 12.4 🔴 "确实没走代理"是怎么证的

见 `scripts/ci/egress-probe.sh`。它**不判可达性**（那条前提已被推翻，见 §4.3），
而是拿 mihomo 的 `/connections` 当仪器做一次**配对测量**：

```
A：容器内不挂代理，打一次只有本项目会打的 URL（自己仓库的 pnpm-lock.yaml，限速拖住 14 秒）
B：同一发请求，显式 -x http://172.17.0.1:7890
```

| 读数 | 含义 |
|---|---|
| B 在账本里**有**记录 | 仪器看得见这类连接（对照成立） |
| A 在账本里**零**记录 | 这批发出去的字节确实没经过 mihomo |
| B **没**记录 | 🟠 `EGRESS=INCONCLUSIVE` + exit 2 —— 仪器瞎了，A 的"没有"什么都不是 |
| A **有**记录 | 🔴 `EGRESS=FAIL`，整趟停 |

2026-10-06 实测读数：`B_VIA_PROXY … mihomo_matched=1 73506` / `A_NO_PROXY … mihomo_matched=0 0`
⇒ `CONTROL=OK`、`LEAK=NONE`、`EGRESS=OK`。B 那一次约 218 KB 是**整套方案里唯一刻意花额度的动作**。

四个"仪器自己坏了"的坑，都是跑出来的，都写在脚本注释里，`check-gate-ssh` 各自有一臂盯着：
① 采样时机（`/connections` 只列活跃连接，跑完再采 ⇒ 永远 BLIND）；
② `-4`（那个域名解析到 AAAA，容器没有 IPv6 出口 ⇒ A 一个字节都没发出去，
   而"零记录"会被读成"没走代理" —— 这是最坏的一种假绿，所以补了「A 字节下限」那一档）；
③ 判据跑在带注释的原文上（说明里就写着被禁的那个词 ⇒ 永远红）；
④ 控制器地址被抄成两份。

### 12.5 触发方式：手动一条命令（默认）

| 候选 | 判决 | 理由 |
|---|---|---|
| **人敲一条命令** | ✅ 采用 | 与这个仓库现有的工作方式一致（提交前人跑 `pnpm check`）；负载门保护那台共享生产机 |
| `post-receive` 钩子 | ❌ 暂不做 | finlaw 上**没有**这个仓库的 git remote（源码是按 tar 送来的），要先建裸库 + 配 SSH 推送；而这个仓库有**多个并行会话在同一条 main 上高频推送**（一天里 207 次 run 就是那台托管 runner 被 push 出来的）⇒ 钩子会把 4 核的生产机打成队列 |
| 定时（每晚之类） | ❌ 暂不做 | 没有决策需求时烧 4 核共享机的 30–60 分钟，只为"看起来在跑" |

需要钩子或定时的话，落点是清楚的：把它们做成 `gate-ssh.mjs` 的两个调用方，**不要再抄一份流程**。

### 12.6 GitHub 侧可见性（未做，且这不是环境问题）

🔴 实测**不需要代理**也能回报：`api.github.com` 从 finlaw 直连 **200 / 0.47 s**。
所以"要不要把结果写回 commit status"是一个**纯决策**，不是"这条路技术上不通"：
代价是要在那台共享生产机上放一枚凭据（`repo:status` 范围的 fine-grained token 最小），
而那台机器上还跑着别的项目。→ 记在归因文档 §7 待裁决。
在拿到决定之前，结果**只在本地与远端留档**（`/tmp/heyta-gate-evidence/<run>.summary.txt`
+ `ubuntu-jcli:~/heyta-gate/runs/<id>/logs/{result.tsv,steps.log}`），
没有留任何"会悄悄走代理的轮询"。

### 12.7 红了怎么归因

```bash
ssh ubuntu-jcli 'cat ~/heyta-gate/runs/<id>/logs/result.tsv'        # 每段一行：rc / 段名 / 起止
ssh ubuntu-jcli 'tail -200 ~/heyta-gate/runs/<id>/logs/steps.log'   # 那一段的原文
```

`result.tsv` 三列固定：`rc \t step \t note`。**跳过与执行过在文件里长得就不一样** ——
这是"不许把没跑的读成跑过的"那一半的实现。

### 12.8 还没验到的边界（不包装成完成）

- ⚠️ **载体是 musl（`node:24-alpine`）**。门禁里凡依赖 glibc 行为、原生模块编译、
  Prisma 引擎二进制分档的段，在 musl 上的结果**不等于** Debian 上的结果。
  第一次全量跑的逐段读数写在 §12.9（跑完回填；没跑完之前这一格是空的）。
- ⚠️ **`--dirty` 跑的是工作树**，里面有并行会话未提交的代码。那些段红了不一定是本路的问题，
  而归属只能靠 run id + 当时的 HEAD 去对。要"这条 main 到底行不行"的结论请用 `--ref`。
- ⚠️ 首次真跑就抓到一条**已提交的 main 是坏的**：`package.json` 从 `4b31fde5` 起
  在 `}` 之后多了一行 ⇒ 不是合法 JSON ⇒ 任何新克隆 `pnpm install` 直接失败。
  这正是这个载体存在的理由（§2 那句话今天又成立了一次），**修法归那个改动的所有者**，
  本路不代改（工作树里那份已经是好的）。
- ⚠️ 真机/原生类段（`check:macos-*`、`check:windows-shell`、`check:linux-shell`、
  `check:native-deps`、`check:mobile-*`）在这台机器上的表现与在开发机上不同，
  它们**自己**的跳过逻辑是否够响亮，要看 §12.9 那一次读数。
- ⚠️ **e2e 那一族今天没有跑**（无 Chromium）。要在这台机器上跑它们，需要先解决
  浏览器二进制的来路（`cdn.playwright.dev` 实测 307/400，机器上也没有那份缓存）——
  那是另一件事，不在本路的范围里。
