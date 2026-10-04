# 自建一套 heyta 同步服务端

面向**第一次把 heyta 部署到自己的机器上**的人。需要 Docker（含 `docker compose`）、`git`、
`curl`，走部署脚本时还要 `jq`（它用来读"当前这套 compose 实际解析出的镜像"以核对版本；
没有 `jq` 脚本会**响亮地**拒绝，不会静默跳过那道核对）。
不需要我们这边的任何账号、机器或内网。

⚠️ 这里**不承诺 Podman**：本批所有真跑验收都在 Docker 上做的，Podman 的 compose 兼容层
没有一次实测记录。它大概率能跑，但那是"未证伪"，不是"支持"。

> 这篇是"怎么做"。想知道"做完是什么样、有哪些旋钮"，看
> [`server/README.md`](../../server/README.md) 与 [`server/env.example`](../../server/env.example)；
> 我们**自己**那台线上机器的运维现场在 [`deployment.md`](deployment.md)，
> 那篇里有内部主机名与本机路径，**不是**给外部部署者的入口，也不该是。

---

## 0. 先把三件事说清楚（这三条会让人中途放弃，所以放在最前面）

1. **目前没有发布任何 heyta 的服务端镜像**，你要在自己的机器上把它构建出来。
   发布流水线已经落地但**没有启用**（`.github/workflows/heyta-server-image.yml`），
   启用与否是一个还没拍板的产品决定。
2. **把服务"起来"不等于部署完成**：表结构的变更要显式跑一次迁移。默认配置里
   服务端**不**在启动时动表结构（那是为了保护多副本与滚动升级），
   所以下面给的两条入口**其中一条必须走对**。
3. **同步服务看不到你的数据**（端到端加密），但它**能**看到你的账号元数据与
   操作时间线。自建之后，"能看到元数据的那个人"就是你自己 —— 日志保留多久、
   备份放哪儿，都是你要自己负责的策略，没有一个云服务商会替你决定。

---

## 1. 取代码

```bash
git clone https://github.com/Xaiver03/heyta.git
cd heyta
```

版本钉住 = 钉住 commit：

```bash
git checkout <某个 commit>        # 之后构建与部署都在这个检出上做
```

**不要**把镜像指向上游 Super Productivity 的 `master-<commit>` 标签 —— 那是
别人的服务端，实体清单、迁移、加密强制都已经和 heyta 分叉；它会正常启动、
`/health` 正常，跑的却是别人的表结构。

## 2. 准备配置

```bash
cd server
cp env.example .env
```

`.env` 里**不给就跑不起来**的只有三个：`JWT_SECRET`（至少 32 字符，缺了或太短直接抛）、
`PASSWORD_PEPPER`（同一条纪律）、`POSTGRES_PASSWORD`。
前两个各生成一个长随机串就行：`openssl rand -hex 32`。

`POSTGRES_PASSWORD` 的"跑不起来"分两种，第二种最容易漏：
**空库**时官方 postgres 镜像直接拒绝初始化（实测 `exit 1`，响亮）；
但**数据卷已存在**时它会**跳过初始化、沿用卷里那个旧口令** —— 于是换口令后
应用容器 `P1000` 认证失败并无限重启，而症状长得像"数据库坏了"。
所以改口令要连着迁移数据卷，或者一开始就别留空。

有默认值但**必须按你的域名改**的两个：`DOMAIN` 与 `PUBLIC_URL`。
`DOMAIN` 只给 Caddy 当站点地址（服务端本体不读它）；`PUBLIC_URL` 才是邮件里那些链接的来源。
不改的后果不是报错，是**邮件里的验证 / 找回密码链接指向 `http://localhost:1900`**
（`PUBLIC_URL` 的默认值就是它）。而 `NODE_ENV=production` 下，**公网** host 的
`PUBLIC_URL` 必须是 https（会抛）；局域网 / 回环地址的 http 是**放行**的 ——
这条禁令只管"公网上的明文"，不是为了逼你自己搞证书。
这两句合起来的意思是：**留默认值 == 认证链路是坏的，但它坏得很安静**。



两个容易被默认值咬到的旋钮：

| 旋钮 | 默认 | 你要不要管 |
|---|---|---|
| `CORS_ORIGINS` | `https://app.super-productivity.com`（**上游的演示站**，而且 `env.example` 里是**未注释**的，`cp` 完就生效） | 界面与服务端同源部署时，浏览器根本不发跨域请求，所以"能不能用"不依赖它 —— 但它此刻的含义是**放行上游那个站在访问你的服务器**。自建就把它改成你自己的 origin，或干脆只留同源 |
| `REQUIRE_EMAIL_VERIFICATION` | `true` | 不配 `SMTP_*` 就注册不进来。只给自己人用时**显式**设成 `false` —— 代价是任何人都能用任意邮箱建号，找回密码也找不到真人 |

## 3. 构建镜像

```bash
./scripts/deploy.sh --build
```

这一条同时做四件事：构建镜像 → 在**旧容器还在服务**的情况下跑迁移 → 换容器 →
等健康检查。它是**唯一受支持的部署入口**。

国内机器拉不动 Alpine / npm 官方源时，在 `.env` 里加两行再跑，否则 `apk add`
与 `pnpm install` 会**无声挂住**（不是网络慢，是根本不报错）：

```bash
APK_MIRROR=你的-alpine-镜像源
NPM_REGISTRY=https://你的-npm-镜像
```

镜像仓库同理：**我们不提供任何第三方公共镜像**，需要就近拉取就把它推到
**你自己的** registry，`SUPERSYNC_IMAGE` 指向那里。

## 4. 只想用一条 `docker compose` 起全套（含第一次的迁移）

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml \
  -f docker-compose.migrate-once.yml up -d --build
```

**`docker-compose.build.yml` 那一份不能省。** 我们没发布镜像，而默认图里
`image:` 的取值是 `${SUPERSYNC_IMAGE:-supersync:local}` —— 不带这一份 override 时，
compose 手里既没有 build 说明、本地也没有那个 tag，于是它去**拉**，实测得到的是：

```
Image supersync:local Error pull access denied for supersync, repository does not exist
or may require 'docker login'
```

那句 `may require 'docker login'` 是这条路上最容易误导人的一步 —— 它会让人去找
"该登录哪个仓库"，而真相是**根本没有仓库**。带上 build override 之后，同一条命令
自己把镜像打出来（`APK_MIRROR` / `NPM_REGISTRY` 两个旋钮在这条路上也生效，
它们就住在这份 override 的 `args` 里）。

`docker-compose.migrate-once.yml` 是一个**一次性迁移服务**的 override：默认服务图里
没有它（那里恰好是 `caddy / postgres / supersync` 三个），加进来之后迁移跑完就退出，
应用容器要等它成功才启动。

⚠️ **它只在第一次开机迁移。** compose 不会重跑一个已经退出的 `restart: "no"` 服务，
所以升级时要么用第 3 节的 `./scripts/deploy.sh`，要么显式补一刀：

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml \
  -f docker-compose.migrate-once.yml up -d --build --force-recreate supersync-migrate
```

裸跑 `docker compose up -d`（不带 override、也不用 `deploy.sh`）会**起在一个
未迁移的表结构上** —— 症状通常是服务端日志里一片 `column ... does not exist`，
而所有容器都是 `healthy`。

## 5. 验证真的可用

```bash
curl -fsS https://你的域名/health
```

然后开浏览器访问 **`https://你的域名/app/`** —— 界面就打在服务端镜像里，
挂载路径由 `WEB_APP_PATH` 决定（默认 `/app/`，镜像内产物路径 `WEB_APP_DIR`
默认 `/app/web-dist`；把界面挪到别的挂载点是两个旋钮一起改，改一个是静默无效）。

注册一个账号，看它能不能建任务、刷新之后还在不在。**只看容器状态不构成"可用"**：
上面第 4 节那种"起了但未迁移"的现场，`docker compose ps` 是全绿的。

## 6. 反向代理（以及一个默认值会咬人的地方）

`docker-compose.yml` 默认自带一个 Caddy 服务，它会绑宿主机的 **80/443**，
而**应用自己只绑 `127.0.0.1:1900`** —— 也就是说：

- 想让别的机器（或你的手机）访问，**要么用 Caddy，要么自己加一层反代**；
  直接 `http://服务器IP:1900` 从局域网是**连不通的**（不是防火墙，是它只听回环）。
  要放开就覆盖那一行 `ports`，并想清楚你放开的是什么。
- 如果你前面已经有 nginx / 别的站点占着 80，就别让 Caddy 起来：
  起的时候点名服务，**三份 override 一份都别省**：

  ```bash
  docker compose -f docker-compose.yml -f docker-compose.build.yml \
    -f docker-compose.migrate-once.yml up -d postgres supersync supersync-migrate
  ```

  或者在自己的 override 文件里把 caddy 的 `ports` 覆盖掉。
  ⚠️ 点名服务**不等于**可以省 override —— 它们管的是两件不同的事：
  `docker-compose.build.yml` 管"镜像从哪来"（省掉 ⇒ 去拉一枚不存在的镜像，见第 4 节），
  `docker-compose.migrate-once.yml` 管"表结构谁迁移"（省掉 ⇒ 起了但未迁移，
  症状是日志里一片 `column ... does not exist` 而**容器全绿**）。
  点名服务时也要把 `supersync-migrate` 一起点出来，否则那条一次性迁移根本不会跑。

`deploy.sh` 会在最后一步因为 Caddy 绑不上端口而以"启动失败"收尾 —— 那种情况下
`supersync-server` / `supersync-postgres` 可能已经是 `healthy` 的，
**先看那两个容器再看脚本文字**，别照着那句报错去查应用。


## 7. 升级与备份

- 升级：`git checkout <新 commit>` → `./scripts/deploy.sh --build`（迁移在换容器**之前**跑）。
- 备份：`./scripts/backup.sh`（pg_dump 到 `server/backups/`）。
  🔴 端到端加密下**备份就是全部** —— 我们这边没有任何一份你的明文可以还原给你。
- 数据是事件溯源（op-log）而不是"当前状态表"：`prisma` 表里的行是可重放的日志，
  不要手改。

## 8. 还没做到的（别按"企业级"预期用它）

| 事实 | 影响 |
|---|---|
| 没有发布镜像，因此也**没有可钉的版本号** | "升级到哪个版本"目前唯一的官方答案是**源码提交号**；tag 三件套（`vX.Y.Z` + 滚动 `X.Y` + `latest`）与发布流水线已经写成文件但**没有启用**，启用与否是一个还没拍板的产品决定 |
| 没有客户端/服务端兼容矩阵 | 政策写在 `server/README.md` 的 "Clients and version coupling"，而且它**刻意不承诺跨版本兼容**：镜像里那份界面与服务端同一次构建（结构上不会错配）；**其他任何客户端**（移动壳、桌面壳、你另起的界面）唯一被支持的组合是**与服务端同一份源码修订**。注意这里没有"同 major 即可"或"N-1 可用"的承诺 —— 那种话要等真做出兼容矩阵才说得出 |
| 服务端镜像的 npm 依赖树没被钉住 | 同一份源码两次构建可能装到不同的传递依赖版本；许可证与漏洞扫描因此只能覆盖"某一次解析"（`pnpm check:image-license` 就是那条会红的对账） |
| 没有自动更新、没有多副本编排 | 一台机器一套 compose；要横向扩展请先读 `server/docker-compose.yml` 里关于 `RUN_MIGRATIONS_ON_STARTUP` 的那段注释 |
