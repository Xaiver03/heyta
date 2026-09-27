# finlaw / ubuntu-jcli 回收候选清单

> 状态：**盘点完成，等待拍板**。本文**不含任何已执行的变更**——从盘点到成文全程只读。
> 最后实测：**2026-09-26（CST）16:09–16:22**，目标机 `ubuntu-jcli`（别名 `finlaw`，`124.223.13.226`）。
> 机器基线、heyta 部署拓扑、DNS / 证书现状见 [`deployment.md`](deployment.md)，本文不重复。
> 本文只回答一件事：**这台机器上「该回收的」有哪些，各自有多少证据，谁可以动谁不能动。**

---

## 0. 怎么读这份文档

### 0.1 证据标记

沿用 [`deployment.md` §0.1](deployment.md) 的约定：

| 标记 | 含义 |
|---|---|
| ✅ **实测** | 本文写作时当场用**只读**命令查到，命令列在 [§6](#6-我跑过的命令)。 |
| 📋 **引用** | 来自 [`deployment.md`](deployment.md) 或本次未独立复核的记录。会变。 |
| ⚪ **未核实** | 明确没查到。**不要当结论用。** |

### 0.2 只读纪律（本次严格遵守）

本次**没有执行**任何 `docker rm/rmi/stop/prune`、`docker compose down`、`rm`、
`systemctl stop/disable`、改配置、动 DNS。

本文里出现的「回收命令」一律是**给你拍板后执行的建议**，**不是本次跑过的命令**。
它们全部写在代码块里，且各自只回收 [§2](#2--可安全回收清单) 里对应的那一项。

### 0.3 密钥

本文不出现任何密钥明文。token / 密码 / 私钥一律只写「存在，位于 X」。
本次**确实在配置里看到过密钥**（`~/heyta/server/.env` 的 `JWT_SECRET` / `POSTGRES_PASSWORD`、
`/opt/heyta-ci/.env` 的 `RUNNER_TOKEN`），均**未抄写内容**。

### 0.4 一个必须先说的前提：这台机器上的数字是活的

盘点全程这台机器**一直在构建和发布**：

- ✅ 16:14:41 有一个 `docker buildx build --builder xiaoli-build … -t 127.0.0.1:5000/xiaoli-learning/db:<sha>` 在跑；
- ✅ `xiaoli-learning` 的 gateway / web / ws / auth 四个容器是 **16:09 前 14 分钟**才被换掉的；
- ✅ `docker system df` 的「RECLAIMABLE」在 **11 分钟内从 14.19 GB 变成 16.17 GB**。

所以：**本文的数字是 2026-09-26 16:1x 的快照，不是稳定值。** 真正执行回收前先重跑 [§6.2](#62-docker-占用) 。

---

## 1. 磁盘现状

### 1.1 根盘

✅ `df -h`（16:09）：

```
Filesystem      Size  Used Avail Use% Mounted on
/dev/vda2       118G   79G   35G  70% /
```

已用 **79 G / 118 G（70%）**，可用 35 G。📋 `deployment.md` 记的是「72 G（64%）」，
一天之内涨了约 7 G——和这台机器上密集的镜像构建吻合。

inode 不是瓶颈：✅ `df -i` = 27%。

### 1.2 大目录（✅ `du -sh`）

| 目录 | 占用 | 主要内容（谁的东西） |
|---|---|---|
| `/var/lib/docker` | **19 G** | `rootfs/` 14 G、`volumes/` 1.6 G、`buildkit/` 1.4 G、`containers/` 411 M |
| `/home` | **11 G** | 见 [§1.4](#14-home-的构成-du--sh-) |
| `/opt` | **7.5 G** | `heyta-ci` 3.0 G、`lingchuang-motor` 2.0 G、`home` 1.3 G、`x-creative-team` 1.2 G、`asset-inventory` 23 M |
| `/var/www` | **3.1 G** | `xiaoli-platform` 1.6 G、`sub2api` 1.1 G、`sumei` 401 M、`heyta-landing` 980 K |
| `/var/log` | **752 M** | journal 597 M、`syslog` 116 M、`auth.log` 15 M、nginx 8.5 M |
| `/usr`、`/root`、`/srv` | ⚪ | 本次 `du` 在这几个上超时，未取到 |

> ✅ `/var/lib/docker` 的 19 G 和 `docker system df` 报的 28.3 G **不是同一个口径**：
> 前者是宿主文件系统的实际块占用，后者是镜像/卷的逻辑大小（含共享层重复计数）。
> 做容量决策用前者，做「能回收多少」用后者。

### 1.3 `/var/log` 明细（✅）

| 项 | 大小 | 说明 |
|---|---|---|
| `/var/log/journal/` | **597 M** | `journalctl --disk-usage` = 596.7 M |
| `/var/log/syslog` | **116 M** | 当前文件，没有轮转上限之外的限制 |
| `/var/log/auth.log` | 15 M | |
| `/var/log/nginx/` | 8.5 M | |
| `/var/log/*.gz`（18 个轮转归档） | 11 M | 最早 2026-08-30 |
| `/var/log/docker-prune-safe.log` | 17 KB | 见 [§5.1](#51--heyta-自己的容器把全机的-docker-自动回收卡死了) |

🔴 **`/etc/systemd/journald.conf` 里除了 `[Journal]` 一行什么配置都没有**（✅ `grep -vE "^\s*#|^\s*$"`）——
即 journald 用的是默认上限「磁盘的 10%」≈ 11 G。**现在 597 M，等于没有闸门。**

### 1.4 `/home` 的构成（✅ `du -sh ~/*`）

| 目录 | 占用 | mtime | 归属 |
|---|---|---|---|
| `projects/litopia12` | 1.7 G | 2026-06-23 | litopia（别的项目） |
| `.local` | 2.5 G | 2026-07-02 | pip / python 用户级安装 |
| `.npm` | 1.2 G | 2026-07-31 | npm 缓存 |
| `ai-study-qa-e993c85` | 1.2 G | 2026-08-03 | aistudy QA 环境（别的项目） |
| `ai-study-qa-56be3dd` | 1.2 G | 2026-08-03 | 同上 |
| `ai-study-qa-4b017f5` | 1.2 G | 2026-08-03 | 同上 |
| `build/` | 980 M | 2026-09-19 | `sub2api-*` 四个构建源码目录（别的项目） |
| `.npm-global` | 587 M | 2026-06-23 | 全局 npm 包 |
| `.hermes-venv` | 348 M | 2026-06-25 | hermes 虚拟环境 |
| `ikuuu-appimage-test` | 285 M | 2026-08-29 | 实验残留 |
| `ai-study-qa-66f8dd6` | 252 M | 2026-08-03 | 同上 |
| **`heyta/`** | **218 M** | 2026-09-26 | **heyta 的全部源码 + 构建残留** |
| `squashfs-root` | 183 M | 2026-08-29 | AppImage 解包残留 |
| `.cache` | 92 M | 2026-08-22 | |
| `clash` | 37 M | — | mihomo 二进制（**在用**） |
| `site-backups/` | 4.7 M | 2026-07-25 | 一次全 home 清理前的快照 |

### 1.5 Docker 占用（✅ `docker system df`）

| 类型 | 总数 | 使用中 | 大小 | 可回收 |
|---|---|---|---|---|
| Images | 107 | 34 | 28.3 GB | **16.17 GB（57%）** |
| Containers | 42 | 39 | 20.36 MB | 81.92 kB |
| Local Volumes | 9 | 6 | 1.719 GB | **492.5 MB（28%）** |
| Build Cache | 106 | 7 | 9.14 GB | 0 B（见下） |

> ⚠️ 同一命令在 **16:09** 读到的旧值是：Images 105 / 26.31 GB / 可回收 **14.19 GB**；
> Build Cache 131 / 10.24 GB / 可回收 **1.101 GB**。**11 分钟内变了 2 GB。**
>
> ⚠️ **Build Cache 的「可回收」两个口径打架**：`docker system df` 报 0 B（因为当时有构建在跑），
> 而 `docker buildx du --builder default` 报 **Total 9.14 GB / Reclaimable 9.079 GB**。
> 两个数都不是错的，是「是否把当前构建正在用的记录算进去」的区别。
> 见 [§3.2](#32-b-组其他项目的-reclaimable--仅登记不建议动作)。

---

## 2. 🟢 可安全回收清单

**本档判据（三条全中才算）**：

1. **没有任何运行中的进程 / 容器 / 配置引用它**（附查法）；
2. **删掉不会造成任何数据丢失**（要么是可再生的缓存，要么是根本没被加载的文件）；
3. **它不是别的项目正在用的东西**（属于别的项目的一律降到 [§3](#3--需你确认清单)）。

### 2.1 汇总

| # | 项 | 大小 | 回收命令（**本次未执行**） |
|---|---|---|---|
| 1 | `~/heyta/.pnpm-store` | **211 MB** | `rm -rf ~/heyta/.pnpm-store` |
| 2 | 悬空镜像（untagged、无引用、>24h） | **88.7 MB** | `sudo -n docker image prune -f --filter until=24h` |
| 3 | 两个无主匿名卷 | **3.8 MB** | `sudo -n docker volume rm fc3c99229f88… 918f666c8b04…` |
| 4 | journald 历史（压到 200 M） | **≈ 400 MB** | `sudo -n journalctl --vacuum-size=200M` |
| 5 | nginx 配置备份文件（61 个） | **133 KB** | `sudo -n rm /etc/nginx/sites-{available,enabled}/*.bak-* …`（见下） |
| 6 | `/etc/cron.d/docker-prune-safe.bak-*`（6 个） | **24 KB** | `sudo -n rm /etc/cron.d/docker-prune-safe.bak-*` |

> ### ✅ 确定安全的总可回收量 ≈ **0.7 GB**（700 MB 量级）
>
> 其中 **211 MB 是 heyta 自己的**，其余 0.5 G 是无主的系统级缓存/日志/死备份。
> 这个数字远小于「这台机器磁盘吃紧」的直觉——**原因见 [§5.1](#51--heyta-自己的容器把全机的-docker-自动回收卡死了)：
> 真正的大头（16 GB 镜像 + 9 GB 构建缓存）不是「不能回收」，而是「被一条 cron 卡住了，而且大部分属于别的项目」。**

### 2.2 逐项判据

#### 2.2.1 `~/heyta/.pnpm-store` —— 211 MB

**是什么**：宿主上 pnpm 的内容寻址包存储（`.pnpm-store/v11/files/…`），211 M 占 `~/heyta` 218 M 的 97%。

**为什么确信它没有主人**（✅ 五条独立证据）：

```bash
$ find ~/heyta -maxdepth 3 -name node_modules -type d      # → 空输出
$ grep -n "pnpm-store" ~/heyta/.dockerignore
.pnpm-store/                                                # → 被构建上下文显式排除
$ grep -n "pnpm" ~/heyta/server/scripts/deploy.sh           # → 只出现 ../pnpm-lock.yaml（传给 docker build 的参数）
$ pgrep -af pnpm                                           # → 只有本次 ssh 命令自身
$ stat -c "%y" ~/heyta/.pnpm-store
2026-09-25 14:40:20 +0800
```

- ① `~/heyta` 下**没有任何 `node_modules`**——store 的服务对象不存在了；
- ② 镜像构建是**在容器内**跑 `pnpm install --frozen-lockfile`（`server/Dockerfile:22`），
  而 `.dockerignore` 明确排除了 `.pnpm-store/` 和 `*.tgz`，**宿主 store 从来不参与镜像构建**；
- ③ `deploy.sh` 里没有任何宿主侧 `pnpm` 调用；
- ④ 没有任何 pnpm 进程在跑；
- ⑤ mtime 停在 **2026-09-25 14:40**，即源码上传当天，之后再没被写过。

**代价**：删掉后，**下次有人在宿主上跑 `pnpm install` 会重新下载全部依赖**。CI 不受影响（CI 用的是
`/opt/heyta-ci/data/setup-pnpm`，见 [§4.2](#42-heyta-ci-runner-与-optheyta-ci)）。

#### 2.2.2 悬空镜像 —— 88.7 MB

```bash
$ sudo -n docker images -f dangling=true
REPOSITORY  TAG  IMAGE ID      SIZE     CREATED
<none>      <none>  c2b80a1afa11  88.7MB  4 hours ago
$ sudo -n docker images -f dangling=true -q | wc -l
1
```

**为什么无主**：`dangling=true` 的定义就是「没有 tag、没有任何容器引用」。且它已存在 4 小时。

> ⚠️ **别把 `docker images -a` 里的 58 个 `<none>` 也算进来**：那些是**构建的中间层**，
> 只能由 builder prune 处理，`docker image prune` 不动它们。见 [§3.2](#32-b-组其他项目的-reclaimable--仅登记不建议动作)。
>
> 📋 本机的 `docker-prune-safe`（[§5.1](#51--heyta-自己的容器把全机的-docker-自动回收卡死了)）本来每 30 分钟就会清掉这一类，
> **目前被 heyta 自己的容器挡住了**——这正是它现在还剩 88.7 MB 的原因。

#### 2.2.3 两个无主匿名卷 —— 3.8 MB

```bash
$ sudo -n docker system df -v | sed -n '/Volumes space usage/,/Build cache/p'
VOLUME NAME                                                        LINKS  SIZE
buildx_buildkit_xiaoli-build0_state                                1      2.904GB
fc3c99229f886b502fadee724f47a02331434c36c53eb619a2f2a075e603a8cb   0      3.797MB     ←
minio_lingchuang-minio-data                                        1      33.44MB
server_supersync-data                                              1      0B          ← heyta 的，在用
server_postgres-data                                               1      48.79MB     ← heyta 的，在用
918f666c8b046b367b9f79ab3123ba19f4859fe40a42295a75f7c8a8f9257e9d   0      0B          ←
xiaoli-learning-registry-data-6aa4025b6a50                         0      488.7MB     ← 属别的项目，见 §3.2
e004d4c6072ebab8444b3f6805af124351406d84b3b82ad3bf2022df266d954b   1      0B
xiaoli-learning-registry-data-ae17240cabf7                         1      0B
```

**为什么确信无主**：`LINKS=0`（没有任何容器挂载），且卷名是 Docker 自己生成的 64 位随机 hex /
`buildx_*` —— compose 命名的卷是 `server_postgres-data` 这种可读名字。
随机 hex 卷通常是 `docker run -v` 不带名字时留下的。

**注意**：`fc3c…` / `918f…` 无法从卷名判断归属。按体积（3.8 MB）风险极低，但**严格的只读纪律下
无法证明它不是某次手工 `docker run` 的产物**——如果你要绝对保守，可以只回收 `918f…`（0 B，回收无意义）
或干脆跳过这一项。**这一项不是收益项。**

#### 2.2.4 journald 历史 —— 压到 200 M，回收 ≈ 400 MB

```bash
$ journalctl --disk-usage
Archived and active journals take up 596.7M in the file system.
$ grep -vE "^\s*#|^\s*$" /etc/systemd/journald.conf
[Journal]
```

**为什么安全**：journal 是系统日志，`--vacuum-size` 只删**最旧的**归档段，不改配置、不动当前日志。
`journald.conf` 里没有任何容量约束（默认 10% 磁盘 ≈ 11 G），所以这 597 M 只会继续涨。

**建议**：先 `sudo journalctl --vacuum-size=200M`（回收 ≈ 400 M）。
如果想让上限持续生效，那是**改配置**，属于 [§3](#3--需你确认清单) 的范畴，本次不碰。

#### 2.2.5 nginx 配置备份文件 —— 61 个 / 133 KB

```bash
$ sudo -n find /etc/nginx -type f \( -name "*.bak-*" -o -name "*.before-*" -o -name "*.backup-*" … \) -printf "%s\n" \
    | awk '{s+=$1;n++} END{print n" files, "s/1024" KB"}'
61 files, 133.089 KB
```

**为什么确信它们没被加载**：`nginx.conf` 用**逐行白名单** include，不是通配（✅ `grep -n include`）：

```
59:  include /etc/nginx/conf.d/*.conf;
60:  include /etc/nginx/sites-enabled/aiconfig.finlaw.cloud;
61:  include /etc/nginx/sites-enabled/codex.finlaw.cloud;
62:  include /etc/nginx/sites-enabled/ai.finlaw.cloud;
63:  include /etc/nginx/sites-enabled/finlaw;
64:  include /etc/nginx/sites-enabled/sumei.finlaw.cloud;
65:  include /etc/nginx/sites-enabled/x-creative.team;
66:  include /etc/nginx/sites-enabled/xiangleideng.site;
67:  include /etc/nginx/sites-enabled/heyta-tmp;
68:  include /etc/nginx/sites-enabled/heyta.finlaw.cloud;
```

- `sites-enabled/` 下混着 30+ 个 `.bak-*` / `.backup-*` 文件，**没有一个出现在上面这 10 行里**；
- `conf.d/` 只有 `*.conf` 会被加载，而备份叫 `aistudy.finlaw.cloud.conf.before-…`（**不以 `.conf` 结尾**）；
- ✅ `nginx -T` 的完整输出（1308 行）里不出现任何 `*.bak-*` 路径。

> ⚠️ **`nginx -T` 的 include 顺序有坑**：`conf.d/*.conf` 在**第 59 行**，早于白名单。
> 所以往 `conf.d/` 放一个 `*.conf` 会**立即生效且不受白名单保护**——清理时别把新文件放错地方。

**回收命令**（保守版，只删带时间戳后缀的）：

```bash
sudo -n rm /etc/nginx/sites-available/*.bak-* /etc/nginx/sites-available/*.before-* \
           /etc/nginx/sites-available/*.backup-* /etc/nginx/sites-available/*.nossl
sudo -n rm /etc/nginx/sites-enabled/*.bak-*  /etc/nginx/sites-enabled/*.backup-*
sudo -n rm /etc/nginx/conf.d/*.before-*
sudo -n nginx -t          # 删完必须先验语法
```

**收益只有 133 KB，但不亏**：它清掉的是「看起来像配置、其实不生效」的认知负担——
📋 这一点 [`deployment.md` §7.5](deployment.md) 已经把它登记为「很脏」。

#### 2.2.6 `/etc/cron.d/docker-prune-safe.bak-*` —— 6 个 / 24 KB

**为什么无主**：cron 只读 `/etc/cron.d/` 下**不含点**的文件名，`.bak-*` 后缀一律不加载。
这 6 个是 2026-09-25 当天反复编辑时留下的。删掉不影响 `docker-prune-safe` 本身。

---

## 3. 🟡 需你确认清单

分两组：**A 组是 heyta 自己相关、必须由你决定**；**B 组属于别的项目，本报告只登记，不建议动作**。

### 3.1 A 组：heyta 自己相关

| 项 | 大小 | 为什么我拿不准 |
|---|---|---|
| `~/heyta/server/archive/encryption-attempts-openvz-incompatible/` | 12 KB | 目录名像「失败的尝试」，但它在仓库里、有 README，**看起来是刻意留档而不是垃圾**。需要你判断这段历史是否还有价值。 |
| `/var/www/heyta-landing/` 的 `hey.svg` | 1.8 KB | ✅ **已定性（2026-09-27）**：它**没有任何引用** —— `index.html` 用的是 `favicon.svg`，而 `hey.svg` 只是仓库里 `apps/landing/public/hey.svg` 的部署残留，那个文件已经从仓库删除（它的几何与 `BrandMark.tsx` 重复，是漂移源）。**可以安全删掉**，下次同步 `dist/` 时不要把它带过去。 |
| `~/heyta/server/docker-compose.monitoring.yml` + `Dockerfile.test` + `docker-compose.test.yml` | < 20 KB | 📋 `deployment.md` 说监控栈没在跑。文件本身极小，**留着不占地方**，只是「配置与现实不一致」的认知成本。不建议动。 |

> ⚪ **`~/heyta` 里没有别的可回收项了。** 我实际找了这些，全部**没有命中**：
> `node_modules`、`dist`、`build`、`.next`、`.turbo`（`find -type d` 空）；
> `*.tar` / `*.tar.gz` / `*.tgz`（`find ~ -maxdepth 4` 只命中 litopia 和 npm 预编译包）；
> 旧镜像 tag（`docker images` 里 `supersync` 只有 `local` 一个 tag）。
> **`~/heyta` = 218 M，其中 211 M 是 `.pnpm-store`（[§2.2.1](#221-heytapnpm-store--211-mb)），剩下 7 M 是源码。**
> brief 里猜的「构建中间产物 / 临时 tar 包 / 旧镜像 tag」在这台机器上**不存在**。

### 3.2 B 组：其他项目的 reclaimable —— **仅登记，不建议动作**

> 🔴 按任务边界，这一组的**主人不是我们**。下面只给「活着 / 占多少 / 是不是残留」三项事实，
> **不给回收建议、不给命令**。要不要动，请项目主人自己判断。

| 项 | 大小 | 状态判据 |
|---|---|---|
| Docker **无容器引用的镜像** | **16.17 GB** | ✅ `docker system df` 的 RECLAIMABLE。构成：56 个 `<none>` 构建中间层 ≈ 11 GB + `127.0.0.1:5000/xiaoli-learning/{db,web,ws,gotrue}` ≈ 3 GB + `curlimages/curl` / `docker/dockerfile` / `proxytest` 等小件。**全部属于 xiaoli 系构建链。** |
| BuildKit **default builder 缓存** | **9.14 GB**（buildx 报 reclaimable **9.079 GB**） | ✅ `docker buildx du --builder default`。xiaoli 用 `--builder xiaoli-build`，所以这 9 GB 是**其他构建**（含 heyta 的 supersync / heyta-ci-runner 构建）产生的。**本机脚本刻意不清理 BuildKit 缓存**（见 [§5.1](#51--heyta-自己的容器把全机的-docker-自动回收卡死了) 第 7 条）。 |
| `xiaoli-build` builder 缓存 | 2.376 GB（reclaimable 0 B） | ✅ `docker buildx du`。属 xiaoli 活跃构建链，不可回收。 |
| 卷 `xiaoli-learning-registry-data-6aa4025b6a50` | **488.7 MB** | ✅ `LINKS=0`——旧的 learning 构建 registry 数据卷。**从字面看是残留**，但属 xiaoli，且本机有 `xiaoli-build-artifact-reaper.timer` 专门管这类，**别抢它的活**。 |
| `~/ai-study-qa-{e993c85,56be3dd,4b017f5,66f8dd6}` | **4.8 GB** | ✅ mtime 全部停在 **2026-08-03**，此后近两个月未变。像 aistudy 的 QA 环境快照。 |
| `~/build/sub2api-*`（4 个） | **980 MB** | ✅ mtime 2026-09-19。sub2api 构建源码目录；对应容器 `xiaoli-platform-core-backend-*` **正在 Up**。 |
| `~/projects/litopia12` | **1.7 GB** | ✅ mtime 2026-06-23。含 `builds/*.tar.gz` 5 个（各 7.6 MB）。 |
| `~/squashfs-root` | **183 MB** | ✅ mtime 2026-08-29。AppImage 解包残留。 |
| `~/ikuuu-appimage-test` | **285 MB** | ✅ mtime 2026-08-29。 |
| `~/.npm` | **1.2 GB** | ✅ mtime 2026-07-31。npm 缓存，可再生但属宿主工具链。 |
| `~/.npm-global` | **587 MB** | ✅ mtime 2026-06-23。全局 npm 包。 |
| `~/.hermes-venv` | **348 MB** | ✅ mtime 2026-06-25。 |
| `~/.local` | **2.5 GB** | ✅ mtime 2026-07-02。pip / python 用户级安装。 |
| `~/site-backups/home-pre-clean-20260725-1252` | 4.7 MB | ✅ 2026-07-25 的一次清理前快照。 |

> ### 🟡 需确认的总量：约 **38 GB**
>
> 拆开看：**Docker 镜像 16.2 G + BuildKit 9.1 G + 构建缓存 2.4 G + 卷 0.5 G + home 残留 ~9.8 G**。
> 但请注意这个数字的**可信度分层**：
> - 「镜像 / 缓存」的 16.2 G + 9.1 G 里，**没有一字节是 heyta 的**，且本机**已经有脚本打算回收它们**（被 [§5.1](#51--heyta-自己的容器把全机的-docker-自动回收卡死了) 卡住）；
> - `~/.local` / `~/.npm` / `~/.npm-global` / `~/.hermes-venv` 共 4.6 G 是**宿主工具链**，「可回收」意味着下次用会更慢，**不是垃圾**；
> - 真正看起来像「没人要了」的，是 `~/ai-study-qa-*` 4.8 G（停更近 2 个月）和两个 squashfs/appimage 实验目录 468 M。

---

## 4. 🔴 绝不能动清单

### 4.1 heyta 的在线服务

| 对象 | 证据 |
|---|---|
| 容器 `supersync-server` | ✅ `Up 4 hours (healthy)`，image `supersync:local`，`127.0.0.1:1900->1900/tcp`；`GET http://127.0.0.1:1900/health` → **HTTP 200**（12 ms） |
| 容器 `supersync-postgres` | ✅ `Up 5 hours (healthy)`，`postgres:16-alpine`，`5432/tcp` 只在 compose 网络内 |
| 镜像 `supersync:local` | **正在被 `supersync-server` 使用**（`docker system df -v` 里它的 CONTAINERS 列 = 1）。**不是垃圾。** |
| 卷 `server_postgres-data` / `server_supersync-data` | `LINKS=1`，被上面两个容器挂着 |
| `/var/www/heyta-landing/` | 由 `heyta.finlaw.cloud` 的 `root` 直接服务（[§4.3](#43-heyta-的两个公网入口)） |
| nginx `sites-enabled/heyta-tmp` + `sites-enabled/heyta.finlaw.cloud` | 在 `nginx.conf` 第 67、68 行被显式 include |
| 证书 `heyta-tmp.litopia.space` / `heyta.finlaw.cloud` | 均 `VALID: 88 days`（2026-09-27 复查） |
| DNS `heyta-tmp.litopia.space`（RecordId `2419225598`） / `heyta.finlaw.cloud`（RecordId `2419295096`） | 均 → `124.223.13.226` |

### 4.2 heyta CI runner 与 `/opt/heyta-ci`

**这是 brief 里没提、但本次发现的 heyta 生产线，全部在用：**

| 对象 | 证据 |
|---|---|
| 目录 `/opt/heyta-ci` | **3.0 GB**，mtime 2026-09-26 15:37：`data/setup-pnpm` 1.3 G、`data/externals` 597 M、`data/_work/heyta` **994 M**、`data/bin` 81 M |
| 容器 `heyta-ci-runner` | ✅ `Up 9 minutes`，compose project `heyta-ci`，`/opt/heyta-ci/docker-compose.yml` |
| 镜像 `heyta-ci-runner:local` | **3.12 GB**，正在被上面那个容器使用 |
| 镜像 `ghcr.io/actions/actions-runner:latest` | **2.15 GB**，0 个容器引用——**但它是 `heyta-ci-runner:local` 的 `FROM` 基镜像（`/opt/heyta-ci/Dockerfile:5`）。Docker 会拒绝删除有子镜像的父镜像。⚠️ 它不是 [§3.2](#32-b-组其他项目的-reclaimable--仅登记不建议动作) 那种「无引用可回收」，别误删。** |
| `/opt/heyta-ci/.env` | 🔒 token **存在，位于**该文件（43 字节），**内容未抄写** |

> 🔴 `data/setup-pnpm`（1.3 G）和 `data/_work/heyta`（994 M）是**刻意的持久化缓存**——
> compose 注释写明「工作目录挂出来持久化，Node 工具链只下一次（磁盘只有 37 G）」。
> 删了不会坏，但会让每次 CI 重新下载工具链和克隆仓库。**属于在用资产，不是残留。**

### 4.3 heyta 的两个公网入口

✅ `nginx -T` 实测，**两个都在生效**：

| 站点 | server_name | 行为 |
|---|---|---|
| `sites-enabled/heyta.finlaw.cloud` | `heyta.finlaw.cloud` | **测试阶段唯一的域名**（2026-09-27 起）：`/` 与 `/en/` → 落地页（`root /var/www/heyta-landing` + SPA 兜底）；`/app/`（含 `= /app` 重定向与 `/app/assets/`）→ 应用（`alias /var/www/heyta-app/`）；`/api/` 与 `/verify-email`、`/recover-passkey`、`/magic-login` → `proxy_pass http://127.0.0.1:1900`（同步服务，含 WebSocket 升级头）。迁移见 [deployment.md §3.7](deployment.md) 的 3.7.1 小节 |
| `sites-enabled/heyta-tmp` | `124.223.13.226 heyta-tmp.litopia.space` | `location /`、`/api/`、`/health` → `proxy_pass http://127.0.0.1:1900`（同步服务的 Connect 页 —— 端点，**刻意不 301**）；`/app*` 与 `/landing*` → `301` 到 `heyta.finlaw.cloud`。**已弃用，留作回滚路径，不是入口**；该域名下 passkey 不可用（`WEBAUTHN_RP_ID` 只能是 `heyta.finlaw.cloud`） |

> ⚠️ 两份站点文件都**不在仓库里**（仓库只跟踪 `server/Caddyfile`），改它们只能上机；
> 每次改完要回来更新本表，以及 `deployment.md` 里对应的那一节（§3.7，其中有 3.7.1）。

### 4.4 全机基础设施（与 heyta 无关但动了会出大事）

| 对象 | 证据 |
|---|---|
| 宿主机 nginx | ✅ 占 `0.0.0.0:80` + `0.0.0.0:443`（pid 1995472–1995475、826314）。**全机唯一入口。** |
| mihomo | ✅ `172.17.0.1:7890/7891/9090`——**容器出网全靠它**（`heyta-ci` compose 的 `HTTP_PROXY` 就指向它） |
| `mysqld` / `postgresql@14-main` / `redis-server` | ✅ 分别 `127.0.0.1:3306,33060` / `5432` / `6379` |
| PM2（用户 `ubuntu`）**9 个 online 进程** | ✅ `sumei-api`、`lingchuang-web`、`xcreative-api`、`xcreative-blog`、`spaceP_pro`、`blog-frontend`、`music-api`、`ws-gateway`、`lingchuang-webhook-gitee` |
| 39 个 Up 容器 | ✅ 见 [§5.3](#53-容器与项目归属) |
| `codex-egress-tunnel` / `codex-web-auth` / `codex-web-proxy` | ✅ systemd active |

---

## 5. 残留证据与意外情况

### 5.1 🔴 heyta 自己的容器把全机的 Docker 自动回收卡死了

**这是本次最重要的一条。**

这台机器**本来就有**自动回收：`/etc/cron.d/docker-prune-safe` 每 30 分钟触发
`/usr/local/sbin/docker-prune-safe`（脚本内部自限为每 20 小时真正回收一次）。
但它在 `is_busy` 判定处**永远提前退出**：

```bash
$ sudo -n tail -6 /var/log/docker-prune-safe.log
===== 2026-09-26T16:00:01+08:00 开始 =====
--- 悬空镜像（untagged、无引用、>24h）---
Total reclaimed space: 0B
BUSY: 685122 /sbin/docker-init -- docker-entrypoint.sh sh -c if [ "${RUN_MIGRATIONS_ON_STARTUP:-false}" = "true" ]; then sh scripts/migrate-deploy.sh || exit 1; fi; exec node dist/src/index.js
SKIP: 检测到部署或构建进程，跳过重活（悬空镜像已回收，下次触发再试）
===== 结束（跳过）=====
$ sudo -n cat /var/lib/docker-prune-safe.last-success
1790343001        # → date -d @1790343001 = Fri Sep 25 09:30:01 PM CST 2026
```

**根因**：脚本的 `BUSY_PAT` 里有 `deploy\.sh`，而 `migrate-deploy.sh` **以 `deploy.sh` 结尾**，
子串匹配直接命中。pid `685122` 就是 **`supersync-server` 容器的 entrypoint 进程**
（它调的 `scripts/migrate-deploy.sh` 是该镜像的启动脚本）。

脚本里还有一道 `MAX_BUSY_AGE=86400`（24 h）的兜底，用来忽略「卡死的孤儿构建进程」。
但 `supersync-server` 是**长期存活的服务**：它启动后头 24 小时内，这道兜底**不会**生效
（pid 685122 的 `etimes` 才 3 小时 39 分）。而每次容器重启，计时器就归零。

**后果**：**每次 `supersync-server` 重启后 24 小时内，这台机器 16 GB 级的可回收镜像都会被跳过回收。**
脚本注释里记着一模一样的历史事故（2026-07-14 一个 `bash deploy.sh` 孤儿把 10~12 GB 挡了几十天），
**说明这个正则的判据本身是有缺陷的——而今天挡住它的是 heyta。**

**这不是本报告能改的事**（改脚本是变更，且这台机器是别项目共用的）。登记在此，供你决定
是否向这台机器的维护者提出「把 `deploy\.sh` 锚定成 `/scripts/deploy\.sh` 或加词边界」。

> ✅ 已排除「真的是构建在跑」这个解释：16:00 那一刻 log 里只有这一个 BUSY pid，
> 没有 `docker build` / `buildx`。而 16:14 那次确实有 xiaoli 构建在跑（那是另一回事）。

### 5.2 反代指向空端口 —— **一条都没有**

任务要求「反向代理规则指向的端口已经没有进程在听」。✅ 把 `nginx -T` 的 15 个唯一 `proxy_pass`
目标与 `ss -lntp` 逐一对表，**全部有进程在听**：

| proxy_pass 目标 | 监听者 |
|---|---|
| `127.0.0.1:1900` | ✅ docker-proxy（`supersync-server`） |
| `127.0.0.1:18085` | ✅ docker-proxy（`xiaoli-platform-core-backend-405fix-v2`） |
| `127.0.0.1:9000` / `:9200` | ✅ `node /opt/lingc…` / docker-proxy（`lingchuang-minio`） |
| `127.0.0.1:3010` | ✅ `next-server` |
| `127.0.0.1:3000` | ✅ `node /var/www/s…`（sumei） |
| `127.0.0.1:3004` / `:4000` / `:4010` / `:8085` | ✅ node（xiangleideng 系） |
| `127.0.0.1:3030` | ✅ docker-proxy（xcreative gateway） |
| `127.0.0.1:7681` / `:7682` | ✅ `ttyd` / `python3`（codex web） |
| `172.30.33.14:8080` | ✅ 见下 |

**`172.30.33.14:8080` 是最容易误判成残留的一条**，这里说清楚：

- 从宿主直接 `curl http://172.30.33.14:8080/` 得到 **HTTP 000（6 秒超时）**，
  `bash -c 'echo > /dev/tcp/…'` 也报 CLOSED —— 看起来就是「死端口」；
- 但 ✅ `docker inspect` 显示它是 `xiaoli-learning-learning-preview-gateway-1` 在
  `xiaoli-learning_learning-ingress` 网络上的**静态绑定地址**（`IPAMConfig.IPv4Address = 172.30.33.14`），
  而且是 **Caddy**——不认识 `Host: 172.30.33.14` 就直接关连接；
- ✅ 经 nginx 实测：`curl -k --resolve aistudy.finlaw.cloud:443:127.0.0.1 https://aistudy.finlaw.cloud/` → **HTTP 200**。
- 配置注释也印证：*"上游是 learning-preview-gateway 在 ingress 网络上的地址（172.30.33.14:8080）"*。

**结论：`aistudy.finlaw.cloud` 的是活的。所谓「反代指向空端口」在本机不存在。**
（对比：[`deployment.md` §7.3](deployment.md) 记的 `dev.litopia.space` TLS 失败是在 **sanjiaozhou**，不是这台。）

### 5.3 容器与项目归属

✅ `docker ps -a` 加 `com.docker.compose.project` 标签解析，**42 个容器 / 39 个 Up / 3 个 `Exited (0)`**：

| compose project | 个数 | 归属 | 状态 |
|---|---|---|---|
| `xiaoli-xcreative-candidate` | 10 | 别的项目 | 9 Up，1 个 `minio-init` Exited(0) |
| （无 project 标签，手工 `docker run`） | 9 | xiaoli 系 8 + `home-minio` 1 | 全 Up |
| `xiaoli-staging` | 7 | 别的项目 | 6 Up，1 个 `db-migrate` Exited(0) |
| `xiaoli-learning` | 5 | 别的项目 | 全 Up（**gateway/web/ws/auth 是 16:09 前 14 分钟才换的**） |
| **`server`** | **2** | **heyta** | **全 Up healthy** |
| `xiaoli-staging-minio` | 2 | 别的项目 | 1 Up，1 个 `minio-init` Exited(0) |
| `asset-inventory` | 2 | 别的项目 | 全 Up |
| `xiaoli-platform-core` | 2 | 别的项目 | 全 Up |
| **`heyta-ci`** | **1** | **heyta** | **Up** |
| `xiaoli-learning-minio` | 1 | 别的项目 | Up |
| `minio`（lingchuang） | 1 | 别的项目 | Up |

**3 个 `Exited (0)` 全是 compose 的一次性 init/migrate 任务**（`db-migrate`、两个 `minio-init`），
退出码 0 = 正常完成。`docker container prune --filter until=72h` 会自动收掉它们，
**不值得手动动**，而且它们属别的项目。

> ### ⚠️ brief 与实际不符：这台机器上**没有** Mailu / SSOS / openpenpal / litopia
>
> ✅ `grep -icE "mail|ssos|openpenpal|litopia" containers.tsv` → **0**。
> 任务背景里说的那些项目**全部在别的主机上**（📋 [`deployment.md` §2.3](deployment.md)：Mailu 在 12km/sanjiaozhou，
> Litopia/SSOS/openpenpal 在 sanjiaozhou）。这台机器现在是 **xiaoli 系 + finlaw 系 + heyta** 的主机。

### 5.4 DNS：盘点期间还在动

✅ `tccli dnspod DescribeRecordList`（只读）在 16:1x 查到：

| 记录 | 值 | 最后更新 | 备注 |
|---|---|---|---|
| `litopia.space` / `heyta-tmp` | `124.223.13.226` | 2026-09-26 12:29 | ⚠️ **已弃用**（2026-09-27）：入口全部 301 到 `heyta.finlaw.cloud`，📋 [`deployment.md` §7.1](deployment.md) |
| `finlaw.cloud` / `heyta` | `124.223.13.226` | **2026-09-26 15:46** | ✅ **现在是测试阶段唯一的域名**（落地页 + 应用 + 同步 API + 凭据页，见 [deployment.md](deployment.md) 的 3.7.1 小节）。**迁移没有改过这条记录。** |
| `litopia.space` / `mail` | **`101.34.250.109`** | **2026-09-26 15:28** | 🔴 [`deployment.md` §5.1](deployment.md) 说它「仍是 OPP `121.4.24.238`」——**本次实测已切到 sanjiaozhou**。文档已过期。 |
| `finlaw.cloud` / `deploy` `*.deploy` `12km` `nexus` `mail` | `121.4.24.238` | 06-27 ~ 09-10 | 仍压在已过期的 OPP 上（📋 非本文范围） |

### 5.5 证书：全都有效，没有可回收的过期证书

✅ `certbot certificates` 共 **12 张**，全部 `VALID`：

| 证书 | 剩余天数 | 与 heyta 的关系 |
|---|---|---|
| `heyta-tmp.litopia.space` | 88 天 | **heyta 的（已弃用）** |
| `heyta.finlaw.cloud` | 88 天 | **heyta 的（唯一域名）** |
| `ai` / `aiconfig` / `aistudy` / `codex` / `lingchuang` / `sumei` / `xcreative` / `x.finlaw.cloud` / `x-creative.team` / `xiangleideng.site` / `yuanyuan.finlaw.cloud` | 52 ~ 89 天 | 别的项目 |

> 任务提到的「过期证书」在这台机器上**没有**。[`deployment.md` §7.2](deployment.md) 记的那张过期证书
> （`/etc/letsencrypt/live/litopia.space/cert.pem`，`notAfter=Jan 2 2026`）在 **12km** 上，不在这台。
> `/etc/letsencrypt/archive/heyta-tmp.litopia.space/` 只有 1 个版本（24 KB），无可回收旧证书。

### 5.6 其余意外情况汇总

| # | 意外 | 证据 |
|---|---|---|
| 1 | **heyta 有一条 brief 完全没提的 CI 生产线**（`/opt/heyta-ci` 3.0 G + runner 容器 + 3.12 GB 镜像 + `heyta.finlaw.cloud` 站点/证书，全部 2026-09-26 15:37–15:48 才建）。**这是「看起来像垃圾其实在用」的头号项。** | [§4.2](#42-heyta-ci-runner-与-optheyta-ci) |
| 2 | `supersync-server` 的 entrypoint 挡住了全机 Docker 自动回收 | [§5.1](#51--heyta-自己的容器把全机的-docker-自动回收卡死了) |
| 3 | brief 说的 Mailu/SSOS/openpenpal/litopia 在这台机器上**一个都没有** | [§5.3](#53-容器与项目归属) |
| 4 | `mail.litopia.space` 的 DNS 在盘点期间从 OPP 切到了 sanjiaozhou，`deployment.md` 已过期 | [§5.4](#54-dns盘点期间还在动) |
| 5 | `~/.oh-my-zsh` 之类不存在；`~/.codex-a`、`~/.codex-b`、`~/.secure-backups`、`~/snap` 各几十 KB——**小到不值得立项** | ✅ `du -sh ~/*` |
| 6 | `docker system df` 的可回收量在 11 分钟内从 14.19 GB 变 16.17 GB | [§0.4](#04-一个必须先说的前提这台机器上的数字是活的) |
| 7 | 宿主 `nproc`=4、负载常年 3.5+，而 `heyta-ci` compose 刻意限成 `cpus: 2 / mem_limit: 3g` | ✅ `docker-compose.yml` 注释 + `uptime` |

---

## 6. 我跑过的命令

> 全部**只读**，可直接重跑。SSH 别名 `ubuntu-jcli`。docker 一律走 `sudo -n`（`ubuntu` 不在 docker 组）。

### 6.1 磁盘与日志

```bash
ssh ubuntu-jcli 'date; df -h; df -i /'
ssh ubuntu-jcli 'sudo -n du -sh /var/lib/docker /var/log /home /var/www; journalctl --disk-usage'
ssh ubuntu-jcli 'sudo -n du -sh /var/www/* | sort -rh | head -20'
ssh ubuntu-jcli 'sudo -n du -sh /opt/* | sort -rh | head -25'
ssh ubuntu-jcli "sudo -n bash -c 'du -sh /var/lib/docker/* | sort -rh'"
ssh ubuntu-jcli 'sudo -n find /var/log -type f -printf "%s\t%TY-%Tm-%Td\t%p\n" | sort -rn | head -25'
ssh ubuntu-jcli 'grep -vE "^\s*#|^\s*$" /etc/systemd/journald.conf'
ssh ubuntu-jcli 'du -sh ~/* ~/.[a-z]* 2>/dev/null | sort -rh | head -30'
```

### 6.2 Docker 占用

```bash
ssh ubuntu-jcli 'sudo -n docker system df'
ssh ubuntu-jcli 'sudo -n docker system df -v'                 # 含镜像/容器/卷/构建缓存四张表
ssh ubuntu-jcli 'sudo -n docker images -f dangling=true'     # 悬空镜像
ssh ubuntu-jcli 'sudo -n docker images -a --format "{{.Repository}} {{.Tag}}" | grep -c "<none>"'
ssh ubuntu-jcli 'sudo -n docker volume ls'
ssh ubuntu-jcli 'sudo -n docker buildx ls'
ssh ubuntu-jcli 'sudo -n docker buildx du --builder default | tail -3'   # Total / Reclaimable
ssh ubuntu-jcli 'sudo -n docker network ls'
```

### 6.3 容器与项目归属

```bash
ssh ubuntu-jcli 'sudo -n docker ps -a --format "{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}\t{{.CreatedAt}}\t{{.RunningFor}}\t{{.Labels}}"'
ssh ubuntu-jcli 'sudo -n docker inspect <容器> --format "{{json .NetworkSettings.Networks}}" | python3 -m json.tool'
```

### 6.4 端口与 nginx

```bash
ssh ubuntu-jcli 'sudo -n ss -lntp'
ssh ubuntu-jcli 'sudo -n nginx -T > /tmp/nginx-T.txt; grep -nE "^\s*server_name" /tmp/nginx-T.txt; grep -nE "proxy_pass" /tmp/nginx-T.txt'
ssh ubuntu-jcli 'grep -n include /etc/nginx/nginx.conf'
ssh ubuntu-jcli 'ls -la /etc/nginx/sites-enabled/ /etc/nginx/sites-available/ /etc/nginx/conf.d/'
ssh ubuntu-jcli 'cat /etc/nginx/sites-available/heyta-tmp /etc/nginx/sites-available/heyta.finlaw.cloud'
# 反代目标存活交叉验证（逐个目标，示例）：
ssh ubuntu-jcli 'for u in http://127.0.0.1:1900/health http://127.0.0.1:3010/ http://127.0.0.1:18085/; do
  printf "%-40s " "$u"; curl --noproxy "*" -s -o /dev/null -w "HTTP %{http_code}\n" -m 6 "$u"; done'
ssh ubuntu-jcli 'curl -k -s -o /dev/null -w "HTTP %{http_code}\n" -m 10 --resolve aistudy.finlaw.cloud:443:127.0.0.1 https://aistudy.finlaw.cloud/'
```

### 6.5 自动回收是否在跑（[§5.1](#51--heyta-自己的容器把全机的-docker-自动回收卡死了) 的证据）

```bash
ssh ubuntu-jcli 'cat /etc/cron.d/docker-prune-safe'
ssh ubuntu-jcli 'sudo -n cat /usr/local/sbin/docker-prune-safe'
ssh ubuntu-jcli 'sudo -n tail -40 /var/log/docker-prune-safe.log'
ssh ubuntu-jcli 'sudo -n cat /var/lib/docker-prune-safe.last-success; date -d @$(sudo -n cat /var/lib/docker-prune-safe.last-success)'
ssh ubuntu-jcli 'ps -eo pid,lstart,etime,args | grep -E "deploy\.sh|docker build|buildx" | grep -v grep'
```

### 6.6 heyta 自己的东西

```bash
ssh ubuntu-jcli 'du -sh ~/heyta ~/heyta/* ~/heyta/.pnpm-store | sort -rh'
ssh ubuntu-jcli 'find ~/heyta -maxdepth 3 -name node_modules -type d'      # 期望空
ssh ubuntu-jcli 'grep -n "pnpm 的 store" -A3 ~/heyta/.dockerignore'         # .pnpm-store/ 被排除
ssh ubuntu-jcli 'grep -n "pnpm" ~/heyta/server/scripts/deploy.sh'
ssh ubuntu-jcli 'stat -c "%y %n" ~/heyta/.pnpm-store'
ssh ubuntu-jcli 'find ~ -maxdepth 4 \( -name "*.tar" -o -name "*.tar.gz" -o -name "*.tgz" \) -printf "%s\t%TY-%Tm-%Td %p\n" | sort -rn'
ssh ubuntu-jcli 'sudo -n du -sh /opt/heyta-ci/data/* | sort -rh | head -15'
ssh ubuntu-jcli 'sudo -n cat /opt/heyta-ci/docker-compose.yml /opt/heyta-ci/Dockerfile'
ssh ubuntu-jcli 'sudo -n certbot certificates'
```

### 6.7 DNS（只读，不改）

```bash
export PATH="$HOME/.local/bin:$PATH"
tccli dnspod DescribeRecordList --Domain litopia.space --output json   # 本地 Mac 上跑
tccli dnspod DescribeRecordList --Domain finlaw.cloud  --output json
```

### 6.8 文档门禁

```bash
node research/tools/docs-link-check.mjs
```

> ✅ **后补（2026-09-27）：`pnpm check:docs` 现在跑得起来。** 在本仓库实测
> exit 0，输出「扫描 139 个 Markdown 文件，检查 568 个相对链接 —— ✅ 无死链」。
> 当时那条 `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` 是**那台机器**
> `node_modules` 与 lockfile 不同步的本地环境问题（见 [`deployment.md` §8.9](deployment.md)），
> **不是仓库状态**。上面那条底层命令仍然可用。

---

## 7. 一句话结论

- **「确定安全」的可回收量只有 ≈ 0.7 GB**，其中 211 MB 是 heyta 的 `.pnpm-store`；
- **「需确认」的量约 38 GB**，但其中 25 GB（Docker 镜像 + BuildKit 缓存）**全是别的项目的**，
  且**本来就有脚本打算回收，只是被 heyta 自己的容器挡住了**（[§5.1](#51--heyta-自己的容器把全机的-docker-自动回收卡死了)）；
- 这台机器上**没有任何「看起来是垃圾、其实有人在用」的 heyta 资产被漏判**——
  反而新发现了一条 **brief 完全没提、必须保护的 heyta CI 生产线**（[§4.2](#42-heyta-ci-runner-与-optheyta-ci)）。
