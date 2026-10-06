# CI/CD 的代理流量归因（finlaw × mihomo，2026-10-06 实测）

> 状态：**已完成**（只读测量 + 一次约 2 分钟的载体容器启停，启停对象是本项目自己的容器）
> 日期：2026-10-06（读数都是当天现取的；本文件里的可达性/速率会随网络环境漂，复现命令在 §6）
>
> 这份文档回答一个问题：**"CI/CD 吃掉了代理流量额度"这句话，能有几分归因到 heyta？**
>
> 结论先说：**大部分归因不到，而且原先的前提有一半已经不成立。**
> 替代方案的落点在 [`../runbooks/ci-and-runner.md`](../runbooks/ci-and-runner.md) §12
> 与 [`../runbooks/deployment.md`](../runbooks/deployment.md) §3.8b。

---

## 0. 三条结论

1. **今天还在花额度的那条，不是"跑门禁"，是"runner 空转等活"。**
   实测：把 `heyta-ci-runner` 启起来 120 秒，mihomo 账本记到
   **57,916 B 下行 / 8,894 B 上行**，目标域名只有 `*.actions.githubusercontent.com`（2 条连接，broker 长轮询）。
   同一窗口 mihomo 总计数只涨了 174,977 B ⇒ heyta 占那 2 分钟的 **33%**。
   线性外推 **≈ 41.7 MiB/天、1.22 GiB/月**（只算下行）。这一条是 100% 可归因的，
   而且它**不需要跑任何一次 CI** 就在花钱。
2. **2026-09-29 之后，heyta 的 CI 作业本身一个代理字节都没花过。**
   `ci.yml` 的 `runs-on` 在 `9073f1fa`（2026-09-30 02:30 +0800）改回了 `ubuntu-latest`
   —— 那是"仓库转公开必须离开自托管 runner"那条硬约束的落地。此后 **73 次 CI 运行全部跑在
   GitHub 托管 runner 上**，一个字节都不经过 finlaw，也就不经过 mihomo。
   自托管窗口只有 2026-09-26 07:41Z → 09-28 14:25Z，**129 个作业**（runner 自己的 Worker 日志数出来的）。
3. **CD 那条路从来没跑过。** 工作流 `374087511`（服务端镜像发布）的 `total_count = 0` ——
   一次都没有运行过 ⇒ **0 字节**。它的名字里就写着"文件已落地，当下这条路走不通"。

⇒ 所以"CI/CD 把额度吃掉了"这个判断，**在 09-29 之后只对第 1 条成立，而那是空转不是构建**。
真正需要做的止血是：让那台 runner 不再空转（已做，容器保留），
而不是"少跑门禁"。下面逐条给证据。

---

## 1. 仪器：什么能归因，什么不能

| 仪器 | 能回答什么 | 为什么不能更多 |
|---|---|---|
| **mihomo `/connections`**（`172.17.0.1:9090`） | 某条**活跃**连接的目标域名、上下游字节、起止时刻 | **只列活跃连接**，历史不留 ⇒ 事后无法回查"昨天那次构建花了多少"。所以归因只能对"正在发生的"做，不能对"已经发生的"做 |
| mihomo `/connections` 的 `downloadTotal` | 这台机器**全部项目**的累计字节 | 共享计数器。105 GB 那个数**不能**说成 heyta 的（本轮实测：runner 停机期间它仍以约 117 KB / 2 分钟的速度被别人推着走） |
| runner 容器自己的磁盘（`/opt/heyta-ci/data`） | 装过哪些东西、一次性成本的上界 | 是**留存产物**，不是"每次构建的下载量"；缓存让它只下过一次 |
| runner 的 `Worker_*.log` | **跑过几次、什么时候跑的** | 不含步骤 stdout ⇒ 拿不到 git/pnpm 自报的字节数 |
| GitHub Actions 的日志 zip（保留 90 天） | 每次运行的**包数**（pnpm 自报 `Packages: +897`、`downloaded 894`） | 报的是**条数不是字节**；且只对拉得到的那些天有效 |
| 容器/宿主 `env`、`git config --global`、`/etc/docker/daemon.json` | 谁**会**被路由到代理 | 是配置证据，不是用量证据 |

🔴 **一张"归因不到"的清单（不包装）**：

- **单次构建的代理字节** —— 归因不到。mihomo 不留历史，runner 日志不记 stdout 字节。
  只能给"上界 + 一次性成分"（见 §3），不能给"每次多少"。
- **105 GB 里 heyta 占多少** —— 归因不到。共享计数器，无按项目切分的记录。
- **`heyta-ci-runner:local` 那次镜像构建拉过多少** —— 归因不到（发生在 09-26，无留存计量）。
- **iKuuu 订阅侧的账单切分** —— 本次没查（那是供应商后台，不在这台机器上）。

---

## 2. 逐条读数

| # | 事实 | 读数 | 怎么取的（可复现） |
|---|---|---|---|
| 1 | 两枚 workflow 的当前状态 | `367547590` CI、`374087511` 镜像发布，**都是 `disabled_manually`** | `gh api /repos/Xaiver03/heyta/actions/workflows --jq '.workflows[]|"\(.id) \(.state) \(.path)"'` |
| 2 | CI 运行总数 / 镜像发布总数 | **207** / **0** | `gh api "/repos/Xaiver03/heyta/actions/workflows/<id>/runs?per_page=1" --jq .total_count` |
| 3 | 自托管窗口 | `beb3ec7d` 09-26 15:41(+0800) 切到 finlaw → `9073f1fa` 09-30 02:30(+0800) 改回 `ubuntu-latest` | `git log --date=iso -S'runs-on' -- .github/workflows/ci.yml` |
| 4 | 在 finlaw 上真跑过的作业数 | **129**（首 `Worker_20260926-074135-utc.log`，末 `Worker_20260928-142539-utc.log`） | `ssh ubuntu-jcli 'ls /opt/heyta-ci/data/_diag/Worker_*.log \| wc -l'` |
| 5 | 同窗口 GitHub 侧 run 数 | 133（42 cancelled / 82 failure / 9 success） | `gh api ".../runs?created=2026-09-26T07:41:00Z..2026-09-29T18:30:00Z"` |
| 6 | 09-29 之后的 run 在哪跑 | **73 次，全部 `runs-on: ubuntu-latest`**（抽样 3 次的 job.labels 都是 `ubuntu-latest`） | `gh api ".../runs/<id>/jobs" --jq '.jobs[].labels'` |
| 7 | runner 空转的代理出口 | **120 s：57,916 B 下行 / 8,894 B 上行**，域名 `*.actions.githubusercontent.com`，2 条连接；同窗口 mihomo 总增量 174,977 B（heyta 占 33%） | `docker start heyta-ci-runner` → 每 5 s 采 `/connections` × 24 → `docker stop`；按 `metadata.host` 过滤求和 |
| 8 | runner 磁盘留存 | 合计 **3.3 GB**：`externals` 597 MB、`data/_work/heyta/heyta` 1.2 GB（其中 `.git` 44 MB、`node_modules` 912 MB apparent）、`.cache/ms-playwright` **658 MB**、`_tool/node` 208 MB、`_work/_actions` 25 MB、`_diag` 111 MB | `ssh ubuntu-jcli 'sudo du -sh /opt/heyta-ci/data/* /opt/heyta-ci/data/.cache/*'` |
| 9 | 一次性 vs 每次 | 8 里那几项**是留存，不是每次构建的下载量**：Node 208 MB、Playwright 658 MB、runner externals 597 MB 各只下过一次；`_actions` 25 MB 按版本缓存；只有 `.git` 与 npm 包是每次都可能碰 | 同上 + `run-gradle.mjs` 那套"按动作归因"的读法 |
| 10 | 单次安装的包数 | `Packages: +897`、`reused 1 / downloaded 894`（首次那趟冷缓存） | `gh api "/repos/Xaiver03/heyta/actions/runs/36228333270/logs"` 解压后 grep `Packages:` / `Progress: resolved` |
| 11 | 本机 npm 直连速率（**不经代理**） | `registry.npmmirror.com` **9.4 MB/s**、`registry.npmjs.org` **1.78 MB/s**（typescript 4,377,468 B 的 tarball） | `ssh ubuntu-jcli 'curl -sSL -o /dev/null -w "%{speed_download}" …'`（SSH 会话里本来就没有 proxy 变量，另用 `env -u` 兜一层） |
| 12 | GitHub 直连现状 | `https://github.com/` = **200 / 0.09 s**（宿主 5/5 次、容器 1/1 次）；`api.github.com` = 200/0.47 s；`codeload.github.com` 批量 = **109 KB/s，20 s 超时只拿到 2.19 MB** | 同上；容器侧用 `heyta-gate:local` 里的 curl |
| 13 | 被代理的三条隐藏通道 | ① `git config --global http.proxy=http://172.17.0.1:7890`（ubuntu 用户）② `/etc/docker/daemon.json` 的 `proxies` 块 ③ runner 容器 compose 里那 6 行 | `git config --global -l`；`sudo cat /etc/docker/daemon.json`；`docker inspect heyta-ci-runner` |
| 14 | daemon 的 proxy **不会**注入到普通容器 | `docker inspect supersync-server` 里 proxy 变量命中 **0** 条 ⇒ 容器只有被显式设置才走代理 | `sudo docker inspect supersync-server --format '{{range .Config.Env}}{{println .}}{{end}}' \| grep -ci proxy` |
| 15 | SSH 上行带宽（决定"传什么"可行） | **约 350 KB/s**（40 MB 用时 120 s，22 端口直连、不经代理） | `dd 40MB | scp ubuntu-jcli:` 计时；`~/.ssh/config` 无 ProxyCommand |
| 16 | HEAD 树 / 归档体积 | 跟踪文件 **98.6 MiB / 3,725 个**；`git archive HEAD` = **63.1 MiB** ⇒ 一趟源码约 **3 分钟**（按 15 的速率） | `git ls-tree -r -l HEAD \| awk '{s+=$4} END{print s,NR}'`；`git archive --format=tar.gz -o /tmp/x.tar.gz HEAD` |

---

## 3. 上界估算（明确标注：**不是实测**）

第 10 条给的是**条数**，第 11 条给的是**速率**，两者不能直接相乘得出"那次构建花了多少代理字节"——
包的平均大小差异很大。可以说的只有：

- **冷缓存一次安装**的 npm 字节上界 = 装完之后 store 的体积（见 §4 的新路实测，
  `pnpm install --frozen-lockfile` 在 finlaw 落地的 store 大小就是那一档，**走国内源时**）。
- 首次那趟还额外要：Node 208 MB + Playwright Chromium 658 MB + runner externals 597 MB
  —— 都是**一次性**，且 09-26 那次之后被缓存复用。
- 此后每次作业新增的量主要由 `.git` 增量与 lockfile 变化决定，
  而 09-28 之后**作业根本没在 finlaw 上跑**。

⇒ 一句话：**"CI/CD 吃掉的额度"里，可归因到构建作业的部分集中在 09-26～09-28 那 2.3 天，
且大头是一次性的工具链下载；09-29 之后可归因的只剩空转那一档（§2 第 7 条，约 1.2 GiB/月）。**

---

## 4. 新路实测（替代方案的字节去向）

| 动作 | 字节 | 经代理？ |
|---|---|---|
| 源码送达（`git archive HEAD` → SSH 22） | 63.1 MiB / 趟 | ❌ 直连 SSH |
| `pnpm install --frozen-lockfile`（npmmirror） | 见下 | ❌ 国内源直连 |
| 载体镜像 `heyta-gate:local` 构建 | apk 走 aliyun（0.61 s 直连 200）、corepack 走 npmmirror | ❌，且基础镜像 `node:24-alpine` **机器上已有** ⇒ 零 pull |
| 出口探针的阳性对照那一次 | 约 280 KB | ✅ **唯一一处刻意花额度的动作**，用来证明其余的没花 |

<!--NPM-STORE-MEASURED-->

---

## 5. 这次测量**推翻**了哪些写在文档里的话

| 原话 | 出处 | 现状 |
|---|---|---|
| "finlaw 直连 `github.com` 是超时的（实测）" | `ci-and-runner.md` §4.3 | **过期**：2026-10-06 实测 200 / 0.09 s（宿主 5/5、容器 1/1）。仍然成立的是**批量传输慢**（codeload 109 KB/s 且会超时） |
| "push → GitHub 把任务派给 finlaw 上的自托管 runner" | `ci-and-runner.md` §1 | **过期**：09-30 起 `runs-on: ubuntu-latest`，runner 只是一直在线空转 |
| "自托管 runner + 公开仓库是最危险的组合" | `ci-and-runner.md` §7 | **仍然成立**，而且它正是把 `runs-on` 改回托管的原因 —— 这一条不改 |
| "`pnpm check` 在干净检出上从来就没通过过" | `ci-and-runner.md` §2 | 与本次无关，但**动机仍然有效**：这正是替代方案必须保留的性质（干净环境 + `--frozen-lockfile`） |

📌 可迁移的一条：**"实测"两个字带着保质期。** §4.3 那句在 09-26 是对的，
十天里它变成了"只对批量传输成立"，而没有人回去量过一次 —— 于是它同时把
"为什么必须自托管"和"为什么必须走代理"两句都撑住了。凡是拿一条网络读数做**决策前提**的，
旁边就该写清复现命令（本文 §6 干的就是这件事）。

---

## 6. 复现命令

```bash
# 2.1 workflow 状态与运行数
gh api /repos/Xaiver03/heyta/actions/workflows --jq '.workflows[]|"\(.id) \(.state) \(.path)"'
for w in 367547590 374087511; do printf "%s " $w; gh api "/repos/Xaiver03/heyta/actions/workflows/$w/runs?per_page=1" --jq .total_count; done

# 2.2 自托管窗口的两端（提交号 + 时间）
git log --date=iso -S'runs-on' -- .github/workflows/ci.yml

# 2.3 在 finlaw 上真跑过几次（runner 自己的日志）
ssh ubuntu-jcli 'ls /opt/heyta-ci/data/_diag/Worker_*.log | wc -l; ls -1 /opt/heyta-ci/data/_diag/Worker_*.log | sort | sed -n "1p;\$p"'

# 2.4 runner 空转的代理出口（本项目自己的容器；启停各一条命令）
#     采样窗口 120 s；停机是原状态，跑完必须停回去
ssh ubuntu-jcli 'docker start heyta-ci-runner; for i in $(seq 1 24); do curl -sS http://172.17.0.1:9090/connections -o /tmp/c$i.json; sleep 5; done; docker stop heyta-ci-runner'

# 2.5 磁盘留存
ssh ubuntu-jcli 'sudo du -sh /opt/heyta-ci/data/* /opt/heyta-ci/data/.cache/* | sort -h'

# 2.6 三条"会被路由到代理"的通道（全部只读）
ssh ubuntu-jcli 'git config --global -l; sudo cat /etc/docker/daemon.json | head -8'
ssh ubuntu-jcli 'sudo docker inspect supersync-server --format "{{range .Config.Env}}{{println .}}{{end}}" | grep -ci proxy'

# 2.7 直连可达性与速率（SSH 会话里没有 proxy 变量；env -u 只是多兜一层，不改任何全局配置）
ssh ubuntu-jcli 'for u in https://github.com/ https://api.github.com/ https://registry.npmjs.org/ https://registry.npmmirror.com/ https://registry-1.docker.io/v2/; do printf "%-36s " "$u"; env -u http_proxy -u https_proxy curl -sS -o /dev/null -m 8 -w "%{http_code} %{time_total}s\n" "$u" || echo FAIL; done'

# 2.8 SSH 上行带宽与源码体积
ssh ubuntu-jcli 'curl -sS -o /dev/null -m 25 -w "codeload=%{size_download}B %{speed_download}B/s\n" https://codeload.github.com/Xaiver03/heyta/tar.gz/refs/heads/main'
git ls-tree -r -l HEAD | awk '{s+=$4} END{print s/1048576" MiB", NR" files"}'
```

---

## 7. 待产品负责人裁决（本文只登记，不代拍）

1. `/opt/heyta-ci/` 与 `heyta-ci-runner` 容器（镜像 3.44 GB + data 3.3 GB = **约 6.7 GB 磁盘**）
   留还是删。留 = 恢复只要两条命令；删 = 腾 6.7 GB，但恢复要重新注册 runner（要走代理拉 externals）。
2. GitHub 侧要不要保留可见性（commit status）。**实测这条路不需要代理**（`api.github.com` 直连 200/0.47 s），
   代价是要在 finlaw 上放一枚有 `repo:status` 权限的凭据。
3. 触发方式：手动一条命令 / `post-receive` 钩子 / 定时。
