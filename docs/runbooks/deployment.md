# 运维与部署现状

> **最后实测：2026-09-30（CST）对 §3.7.2 与线上入口（`heyta.waytofuture.cn`）；
> §3.7.1 仍是 2026-09-27 的实测；其余章节仍为 2026-09-26 的实测。**
> 🔴 **对外入口自 2026-09-30 起是 `https://heyta.waytofuture.cn/`**，
> `heyta.finlaw.cloud` 只作回滚路径（不是入口）。
> 本文只讲「哪台机器、跑什么、对外地址、怎么核实」，**不讲 heyta 的应用源码**。
> 应用怎么构建、怎么本地跑，见 [`local-server-verification.md`](local-server-verification.md)；
> 多端产物见 [`../reference/build-matrix.md`](../reference/build-matrix.md)。

---

## 0. 怎么读这份文档

### 0.1 证据标记

每条事实都带标记，表示它是怎么来的：

| 标记 | 含义 |
|---|---|
| ✅ **实测** | 本文档写作时**当场用只读命令查到的**（SSH / curl / tccli）。命令列在 [§8](#8-怎么核实)。 |
| 📋 **引用** | 来自上一次的运维记录 / 口头交代，**这次没有独立复核**。会变。 |
| ⚪ **未核实** | 明确没查到或没权限查。**不要当成结论用。** |

> 🔴 **凡是没有 ✅ 的条目，用之前先自己跑一遍 §8 的命令。**
> 这套环境变得很快：光 2026-09-26 一天，`litopia.space` 的一大批 A 记录就从 OPP 搬到了 sanjiaozhou。

### 0.2 只读纪律

本文档对应的所有核实动作**只读**：`docker ps`、`cat` 配置、`nginx -T`、`systemctl status`、`curl GET`、`tccli Describe*`。

**核实运维现状时不要**：重启服务、改配置、删文件、`docker compose up/down`、续期证书、改 DNS。
需要动手时另开一次有意识的变更，不要在"看一眼"的过程中顺手做掉。

### 0.3 密钥

文档里**不出现任何密钥明文**。token / 密码 / 私钥一律只写"存在，位于 X"。
生产 `.env` 里的敏感值**不止一把**，而且**每一条参与运算的秘密都必须备份**
（✅ 逐条实测，见 [§3.5](#35-生产环境变量清单)）：

| 键 | 它一旦丢了/被换了会怎样 |
|---|---|
| `JWT_SECRET` | 全部已签发会话立即失效，用户要重新登录（passkey 不受影响） |
| `POSTGRES_PASSWORD` | 服务端连不上库（🔴 必须同时 `ALTER USER`，见 §3.10 坑 ①） |
| `SMTP_PASS` | 发信断掉；由腾讯云 SES 签发，可轮换 |
| `PASSWORD_PEPPER` | 🔴 **存量口令哈希全部验不过**（`verify` 返回 `false`，不是"降级还能登"）；缺失则**新镜像直接拒绝启动**（见下） |

---

## 1. 一页速览

| 机器 | SSH 别名 | IP | 跑什么 | 对外地址 | 状态 |
|---|---|---|---|---|---|
| **腾讯云 ubuntu-jcli** | `ubuntu-jcli`（别名 `finlaw`） | `124.223.13.226` | ✅ **heyta 公网部署**（supersync）；另有 xiaoli-* 等约 34 个容器、宿主机 nginx、mihomo | `https://heyta.waytofuture.cn`（**当前产品入口**，2026-09-30 迁来，见 §3.7.2；`heyta.finlaw.cloud` 只留作回滚路径） | ✅ 在线，容器 healthy |
| **腾讯云轻量 12km（=OPP）** | `12km` / `12kmroot` | `121.4.24.238` | Caddy + Dokploy + Litopia 生产/预发 + Mailu 邮件 + cloudflared 等 32 个容器 | `mail.litopia.space`（**唯一还指向它的 litopia 域名**） | 🔴 **实例已过期**（2026-09-25 21:32 到期），仍在跑 |
| **腾讯云 sanjiaozhou** | `sanjiaozhou` | `101.34.250.109` | **mihomo 故障切换代理**；Caddy（80/443）+ 大量项目（Litopia 站点、SSOS、Mailu、CMS 等） | `litopia.space`、`api` / `docs` / `studio` / `staging`、`openpenpal.com`、`finlaw.cloud` 等 | ✅ 在线，负载正常 |
| **华为云 wunoos** | `wunoos` | `119.8.167.61` | ⚪ 未核实（用户明确交代**不要用**） | `climming.*` / `huagong.finlaw.cloud` 等指向它 | 仅确认 SSH 可达 |
| **阿里云 lingchuang** | `lingchuang` | `39.107.226.94` | ⚪ 未核实（用户明确交代**太小，不用**） | — | 仅确认 SSH 可达 |
| **本机 Mac** | —（本地） | — | 开发环境：Postgres 5432、开发服务端 3000、Android/iOS 模拟器 | 仅本机 | ✅ 运行中，**别动** |

**当前公网部署选型：`ubuntu-jcli`。** 12km 到期后不要再往它上面部署任何东西。

---

## 2. 服务器清单

### 2.1 规格与系统（✅ 全部本次实测）

| 项 | ubuntu-jcli | 12km（OPP） | sanjiaozhou |
|---|---|---|---|
| IP | `124.223.13.226` | `121.4.24.238` | `101.34.250.109` |
| 主机名 | `VM-0-17-ubuntu` | `VM-12-8-ubuntu` | `VM-0-14-ubuntu` |
| SSH 用户 | `ubuntu` | `ubuntu`（`12kmroot` = `root`） | `root` |
| 系统 | Ubuntu 22.04.5 LTS | **Ubuntu Server 24.04 LTS 64bit** | Ubuntu 24.04 LTS |
| 内核 | `5.15.0-179-generic` | `6.8.0-64-generic` | `6.8.0-71-generic` |
| CPU | 4 核 | 4 核 | 8 核 |
| 内存 | 7.6 GiB | 7.5 GiB | 15 GiB |
| 根盘 | 118 G / 已用 72 G（64%） | 178 G / 已用 101 G（60%） | 266 G / 已用 107 G（42%） |
| 云厂商 | 腾讯云 | 腾讯云轻量应用服务器 | 腾讯云 |
| 机房 | — ⚪ | `ap-shanghai-4`（上海） | — ⚪ |

> ✅ OPP 的实例 ID 是 `lhins-gg5wua1u`，规格 `bundle_gen_mc_lg8_01`（4C8G，180 G SSD，12 Mbps，`ap-shanghai-4`）。
> ⚪ ubuntu-jcli / sanjiaozhou 的实例 ID 与到期时间：**账号的 CVM 列表为空**（`tccli cvm DescribeInstances` 返回 0 条），
> 说明这两台不在当前 tccli 凭据可读的账号下，或不是 CVM 产品。**到期时间未核实。**

### 2.2 12km / OPP —— 🔴 到期风险

| 字段 | 值 | 来源 |
|---|---|---|
| 实例 ID | `lhins-gg5wua1u` | ✅ `tccli lighthouse DescribeInstances` |
| 实例名 | `OpenCloudOS-8tfs` | ✅ 同上（**只是显示名**，见下） |
| 创建时间 | 2025-09-25 21:32:10 CST | ✅ |
| **到期时间** | ✅ **2026-09-25 21:32:10 CST**（= `2026-09-25T13:32:10Z`） | ✅ API 字段 |
| 续费方式 | `NOTIFY_AND_MANUAL_RENEW`（**手动续费**，不会自动续） | ✅ |
| 实例状态 | `RUNNING`；`InstanceRestrictState = NORMAL`；`IsolatedTime = null` | ✅ |
| 预计停服 | 📋 2026-09-27 00:00:00 | **引用，未复核**（API 没有这个字段） |

**读法**：到期时间**已经过去**（现在是 09-26 下午），但机器仍在正常运行、限制状态还是 `NORMAL`。
"09-27 00:00 停服"是回收宽限期的经验值，**没有 API 可以复核**。

🔴 **结论不变**：这台机器随时可能被回收，**不要在上面做任何新部署**。
它现在还在承担的、搬到别处之前会受影响的东西见 [§7.2](#72--12km--opp-到期的连带影响)。

### 2.3 各机器上跑什么

#### ubuntu-jcli（`124.223.13.226`）

- ✅ 系统级：`nginx/1.18.0`（Ubuntu 22.04 自带），监听 `0.0.0.0:80` 和 `0.0.0.0:443`；`nginx -t` 通过。
- ✅ certbot `1.21.0`（`/usr/bin/certbot`），`certbot.timer` 已启用，下次运行 2026-09-27 05:54。
- ✅ mihomo（见 [§4](#4-代理链路)）。
- ✅ 约 40 个容器，其中 34 个属于 `xiaoli-*` 项目（`x` / `ai` / `content` / `xcreative` / `staging` 等）。
  **这些与 heyta 无关**，本文不展开。
- ✅ heyta 相关容器只有两个：`supersync-server`、`supersync-postgres`。
- ✅ 还有若干直接跑在宿主机上的 node/next 服务（`/var/www/s…`、`/opt/home/…`、`/opt/x-cre…`），端口 3000 / 3004 / 3007 / 3010 / 4000 / 4010 —— ⚪ **这些属于其他项目**，本次未逐一定位归属。

#### 12km / OPP（`121.4.24.238`）

- ✅ **对外 80/443 由 Caddy 提供**（`caddy.service` active），**不是 nginx**。
  `/etc/nginx` 里那套配置**存在但没在跑**：`nginx.service` 是 `inactive` + `disabled`。
- ✅ 32 个容器，主要几组：
  - Dokploy 编排本身（`dokploy.*`、`dokploy-postgres`、`dokploy-redis`）；
  - Litopia 生产（`litopia-api-dokploy`、`litopia-frontend-dokploy`、`litopia-db` / `-rest` / `-auth` / `-storage` / `-storage-api` / `-realtime` / `-minio`）；
  - `litopia-staging-*`（api / rest / auth / realtime / storage / storage-api / db / file-service）；
  - `litopia-mail-*`（Mailu：smtp / imap / webmail / admin / antispam / resolver / front / redis / copies）；
  - `openpenpal-frontend-dokploy`。
- ✅ **没有 heyta**：`~/heyta` 和 `/opt/heyta` 都不存在，容器里也没有 heyta。
- ✅ 常驻系统服务（除通用件外）：`caddy`、`cloudflared`、`fail2ban`、`hermes-gateway`、`mihomo`、`postgresql@16-main`、`pure-ftpd`。
- ✅ 定时任务：`litopia-seo-refresh.timer`、`litopia-mail-certificate.timer`（把 Caddy 证书同步给 Mailu）、
  `litopia-mail-backup.timer`（带恢复校验的 Mailu 备份）、`snap.certbot.renew.timer`。
- ✅ cron.d：`certbot`、`docker-prune-safe`（外加一堆 09-25 的备份文件）、`e2scrub_all`、`sgagenttask`、`sysstat`、`yunjing`。
- ✅ 磁盘：`/var/lib/docker` 26 G、`/opt` 18 G、`/root` 15 G。

#### sanjiaozhou（`101.34.250.109`）

- ✅ 对外 80/443 也是 **Caddy**（`caddy.service`，pid 976200）。宿主机另有 nginx `1.24.0`，
  但只启用三个站点（`ai-study`、`docs.aiconfig.finlaw.cloud`、`wuno.finlaw.cloud`），**没占 80/443**。
- ✅ mihomo 故障切换代理（见 [§4](#4-代理链路)）。
- ✅ Docker Compose 项目（按 project / working_dir 去重）：
  `cc-switch-sync`、`docker`(`/opt/litopia-selfhosted/docker`)、`litopia-mail`(`/opt/litopia-mail`)、
  `litopia-minio`、`litopia-staging`、`rustdesk`、`sanjiaozhou`、`ssos`、`ssos-staging`、`wunoos`。
- ✅ PM2（root）在线进程：`litopia-api`(8101)、`litopia-file-service`(9200)、`litopia-webhook`、`pay-service`(3002)、`postgrest`(3005)。
  另有 `oval-website`、`ssos-backend-staging` 处于 stopped。
- ✅ Caddy vhost（`/etc/caddy/conf.d/`）里与本文相关的：
  `openpenpal.com` / `www`、`litopia.space` / `www`、`docs.litopia.space`、`studio.litopia.space`、`api.litopia.space`、
  `mail.litopia.space`，以及 `finlaw.cloud` 系列、`cms.auracluba.com` 等。
  `litopia-sites.caddy` 头部注释直接写着 **"自 12kmroot 迁移"**；`mail.litopia.space.caddy` 写的是
  **"Migrated from 12kmroot (121.4.24.238) on 2026-09-26"**。
- ✅ `caddy validate --config /etc/caddy/Caddyfile` → `Valid configuration`。

---

## 3. 公网部署（在 ubuntu-jcli 上）

### 3.1 拓扑

```
                     DNS: heyta.finlaw.cloud      A 124.223.13.226  (RecordId 2419295096)  ← 唯一域名
                          heyta-tmp.litopia.space A 124.223.13.226  (RecordId 2419225598)  ← 已弃用
                                        │
                                        ▼
        ┌──────────────────────── ubuntu-jcli  124.223.13.226 ────────────────────────┐
        │  宿主机 nginx 1.18.0   :443 (TLS, certbot)  ──►  :80 → 301 https              │
        │      │                                                                        │
        │      ├── sites-enabled/heyta.finlaw.cloud   ← **唯一域名**（2026-09-27 起）      │
        │      │     ├── /               → 落地页 root /var/www/heyta-landing/           │
        │      │     ├── /app/           → alias /var/www/heyta-app/   (apps/web 产物)   │
        │      │     ├── /api/           → proxy_pass 127.0.0.1:1900 （含 WS 升级头）     │
        │      │     └── /verify-email · /recover-passkey · /magic-login → 同一 proxy    │
        │      │                                                                        │
        │      └── sites-enabled/heyta-tmp   ← **已弃用**（留作回滚路径）                  │
        │            ├── /app* /landing* → 301 → https://heyta.finlaw.cloud/            │
        │            └── / · /api/ · /health → proxy_pass 127.0.0.1:1900 （端点，不 301） │
        │                                    │                                           │
        │                          docker: supersync-server  (supersync:local, healthy)  │
        │                                    │  depends_on service_healthy                │
        │                          docker: supersync-postgres (postgres:16-alpine)        │
        │                                                                                │
        │  镜像自带的 caddy 服务：**故意没启动**（没有 supersync-caddy 容器）             │
        └────────────────────────────────────────────────────────────────────────────────┘
```

- ✅ **镜像里那个 caddy 容器故意没起**：`docker ps -a | grep caddy` 为空。
  镜像 `docker.m.daocloud.io/library/caddy:2-alpine` 存在，但只是构建时被拉过。
  之所以这样，是因为宿主机的 80/443 已经被 nginx 占用（同一台机器上还跑着别的站点）。
- ✅ `supersync-server`：`image=supersync:local`、`state=running`、`health=healthy`、
  `restart=unless-stopped`、mem 768 MiB、cpus 1.0、发布在 `127.0.0.1:1900`（**只绑回环**）。
- ✅ `supersync-postgres`：`image=postgres:16-alpine`、`health=healthy`、`restart=unless-stopped`，
  端口 `5432/tcp` 只在 compose 网络内，**不对宿主机发布**。
- ✅ compose 项目名 `server`，工作目录 `/home/ubuntu/heyta/server`，卷 `server_supersync-data`。
- ✅ 镜像 `supersync:local`：id `sha256:eb8ff66a2824…`，构建于 **2026-09-26 11:34:07 +08:00**，约 489 MB（126 MB 压缩）。
- ⚪ 监控栈 **没有在跑**：`docker-compose.monitoring.yml` 存在，但 `docker compose -f … ps` 只列出
  postgres 和 supersync 两个服务（说明当前生效的是主 compose）。没有 prometheus / grafana / node-exporter 容器。

### 3.2 源码与发布方式

- ✅ 源码在 `ubuntu-jcli:~/heyta/`（`/home/ubuntu/heyta`）。
- ✅ **那不是 git 仓库**（`git status` → `fatal: not a git repository`）。说明是**拷贝/rsync 上来**的，
  不是 `git clone`。发布形态是「源码 + 本机构建镜像 + compose」，不是 CI 拉取。
- ✅ `~/heyta/server/` 下有：`docker-compose.yml`、`docker-compose.build.yml`、`docker-compose.monitoring.yml`、
  `docker-compose.test.yml`、`.env`、`scripts/deploy.sh`。
- ✅ 发布脚本 `server/scripts/deploy.sh`：校验 Caddyfile 语法 → 拉/建镜像 → **先跑迁移** → 换容器 → 等 healthcheck。
- ✅ 落地页产物 `apps/landing` 构建后同步到 `/var/www/heyta-landing/`
  （`index.html` + `assets/` + `favicon.svg`）。
  🔴 **落地页住在 `https://heyta.finlaw.cloud/` 的根，不是 `/landing/`** ——
  本域名下的 `/landing*` 现在是 **301 跳过去**（见 §3.3 与 §3.7）。本文旧版写的
  「通过 `/landing/` 提供，实测 200」**已经过期**。
- ✅ 应用本体 `apps/web` 的产物同步到 `/var/www/heyta-app/`，由本域名的 `/app/` 提供。
  **构建时必须带 `--base=/app/`** —— 理由见 §3.7，弄错会得到一个「控制台报
  样式表 MIME 是 `application/json`」的白屏。
- ⚪ 具体是谁、用什么命令把源码推上来的：**未核实**（没有 git 元数据、本次未查 shell history）。

### 3.3 反向代理（宿主机 nginx）

**机器上有两个 heyta 站点**（✅ 实测）：

| `/etc/nginx/nginx.conf` 行 | include | 角色（2026-09-27 起） |
|---|---|---|
| 67 | `sites-enabled/heyta-tmp;` | **已弃用** —— 只留同步端点 + 入口 301（§3.3.2） |
| 68 | `sites-enabled/heyta.finlaw.cloud;` | **唯一域名** —— 落地页 + 应用 + API + 凭据页（§3.3.1） |

🔴 这个 include **不是 `sites-enabled/*` 通配**，是逐行手写的白名单（60–68 行）：
新增站点必须手动加一行，否则 `nginx -t` 照样通过、站点却根本不生效。

#### 3.3.1 `heyta.finlaw.cloud`（唯一域名）

- ✅ `server_name heyta.finlaw.cloud;`、`client_max_body_size 64m;`
- ✅ `location /` → `root /var/www/heyta-landing;` + SPA 兜底 `try_files $uri $uri/ /index.html`
  （落地页本身也是 SPA；`/en/` 走同一段）。`/assets/` 单独一段长缓存。
- ✅ `location /app/` → `alias /var/www/heyta-app/;` + `try_files $uri $uri/index.html /app/index.html`，
  `Cache-Control: no-cache`；`/app/assets/` 单独一段长缓存。
- 🔴 **`location /app/` 与 `location /app/assets/` 都必须 `include /etc/nginx/mime.types;` 之后再补自己的 `types {}`。**
  这台机器的 `/etc/nginx/mime.types`（nginx/1.18.0 Ubuntu）里既没有 `wasm` 也没有 `webmanifest`，
  于是那两类文件一律答 `application/octet-stream`；而 **`types` 在嵌套层级是替换继承、不是叠加**，
  只补一条会把同一段里的 `.js` / `.css` / `.png` 一起打回默认类型（模块脚本直接不执行）。
  已按这个形状修过两次：`.wasm`（2026-09-27，`instantiateStreaming` 被拒）与
  `.webmanifest`（2026-10-04，G-60：`/app/manifest.webmanifest` 曾被答成 octet-stream）。
  判据在 `e2e/live-site/live-manifest.spec.ts`（两腿：真清单判 true、被 SPA 兜底成 HTML 的路径判 false）。
  ⚠️ **旧域名 `heyta.finlaw.cloud` 那份只补过 `.wasm`，没补 `.webmanifest`**（现量：那份文件里
  `application/wasm` 在、`webmanifest` 无）。2026-10-04 把同一份判据指过去得 **2 failed / 1 passed**，
  所以**回滚到旧域名会把清单类型这一处带回去**（图标与 SW 那侧两域名都正常）。
- 🔴 `location = /app { return 301 /app/$is_args$args; }` **必须单独写**：`location /app/`
  **不匹配** `/app`，而落地页给出的地址去掉尾斜杠是**故意的**（`apps/landing/src/lib/app-url.ts`）。
  少了它，`/app` 会掉进 `location /` 拿回**落地页 HTML**（HTTP 200、看着正常，点进去却是别的页面）。
  带 `$is_args$args` 是为了**保留查询串** —— `?lang=en` 必须跟着走，否则英文用户又回到中文应用。
  🟢 **2026-10-03 起这条从"必须"降成"留着无害"**：服务端自己注册了
  `GET /app → 307 /app/`（`server/src/web-app.ts`，判据 `server/tests/web-app-slash-redirect.spec.ts`），
  所以**跑当前镜像**的自建者不写这条 nginx 规则也不会踩到。上面那句"少了它拿回落地页 HTML"
  现在只对**旧镜像**成立 —— 上面这套 nginx 配置里这条规则仍然保留（nginx 的精确匹配先命中，
  于是仍然是 301 在前、服务端的 307 在后者不会被用到），删它没有收益。
- ✅ `location /api/` → `proxy_pass http://127.0.0.1:1900;`，带 `Upgrade` / `Connection: upgrade`
  （WebSocket，真实路径 `/api/sync/ws`）、`Host` / `X-Real-IP` / `X-Forwarded-For` /
  `X-Forwarded-Proto`，`proxy_read_timeout 90s` / `proxy_send_timeout 90s`。
- ✅ `location ~ ^/(verify-email|recover-passkey|magic-login)$` → 同一个 `proxy_pass`。
  🔴 这三张是**服务端渲染**的页面（`server/src/pages.ts`），不代理就会掉进落地页的 SPA 兜底，
  用户看到的是落地页而不是「令牌无效 / 请重新注册」。
- 🔴 `location ~ ^/(recover-passkey|magic-login-confirm)\.js$` 与
  `location = /simplewebauthn-browser.min.js` → 同一个 `proxy_pass`。
  **只代页面不代脚本 = 页面画得出来、按钮是死的。** 2026-09-27 线上实测过这个形状：

  | | 真值 |
  |---|---|
  | `GET /recover-passkey.js` | **`200` 但 `Content-Type: text/html`**，内容是**落地页**（2370 B） |
  | 浏览器 | `Unexpected token '<'`，`window.SimpleWebAuthnBrowser === undefined` |
  | 点「Register New Passkey」 | 文案不变、无报错、**零请求**（`apiCallsFromPage: []`） |
  | `curl` 看状态码 | **200，完全正常** —— 所以只看状态码的验收抓不到它 |

  后果不是"少个功能"：丢了通行密钥的用户**收到邮件 → 点开链接 → 按钮不动 → 进不去**。
  同一条缺陷也打死了**魔法登录链接**（`/magic-login-confirm.js` 同样被吞），
  也就是**主要的登录路径**。修完之后的实测：`Content-Type: application/javascript`、
  `SimpleWebAuthnBrowser === "object"`、点按钮 → `200 /api/recover/passkey/options`
  + `200 /api/recover/passkey/complete`、页面成功文案出现。

  📌 **只列这三个**：它们是 `server/src/pages.ts` 里三张页面**真正引用**的脚本。
  `server/public/` 里另有 `app.js` / `style.css` / `eu-stars.svg`，但那是服务端**自带
  standalone 首页**（`templates/index.template.html`）的资源；本域名 `/` 服务的是真正的
  落地页（`/var/www/heyta-landing/`，它只用 `/assets/*` 与 `/favicon.svg`），
  那份首页在这里用不到 —— 所以**故意不代**，免得把 `/style.css` 这种通用名字从落地页手里抢走。

  ⚠️ **验收纪律**：这一整类缺陷只在"看响应体"时才现形。对**服务端渲染页面引用的每个资源**，
  验收必须断言 `Content-Type` **和**内容开头，不能只断言 `200`。
- ✅ certbot 追加的 HTTPS 块 + Let's Encrypt 证书（见 §3.4）。

#### 3.3.2 `heyta-tmp`（已弃用，留作回滚路径）

- ✅ `server_name 124.223.13.226 heyta-tmp.litopia.space;`、`client_max_body_size 64m;`
- ✅ `/app`、`/app/`、`/landing`、`/landing/` → `301 https://heyta.finlaw.cloud$request_uri`。
  用 `$request_uri` 而不是 `$is_args$args`：前者原样带上**完整路径与查询串**，
  `/app?lang=en`、`/app/assets/<hash>.js` 都不会走样。
- ✅ `location /` → `proxy_pass http://127.0.0.1:1900;`（Connect 页、`/api/`、`/health`）。
- 🔴 **同步端点刻意不做 301**：301 会让浏览器与客户端把 **POST 改写成 GET**，
  正在同步的客户端会被**无声地打断** —— 请求"成功"了，内容却丢了。
  所以这个站点只重定向"给人点的入口"，程序化端点原样直连。
- 🔴 之所以还留着它：这是**回滚路径**（配 `.env.bak-*` 一起用）。
  但它给出的应用入口是 301，所以不会再有人在旧域名上撞见
  「应用能打开、登录永远失败」的 passkey 陷阱（§3.7.1）。

- ✅ **HTTP 行为（与线索不同，务必注意）**：
  - 两个域名的 `http://…/…` → **301** 跳 `https://`（certbot 写的 `if ($host = …)` 块）。
  - `http://124.223.13.226/…` → **404**（certbot 块的兜底是 `return 404`）。
    **用裸 IP 访问不会跳 HTTPS，会 404。** ✅ 实测两次确认。

### 3.4 证书与续期

- ✅ `certbot certificates`（2026-09-27 实查）：

  | 证书名 | 域名 | 到期 | 剩余 |
  |---|---|---|---|
  | `heyta.finlaw.cloud` | `heyta.finlaw.cloud` | **2026-12-25 06:50:16 UTC** | 88 天 |
  | `heyta-tmp.litopia.space` | `heyta-tmp.litopia.space` | **2026-12-25 03:35:57 UTC**（= 11:35:57 CST） | 88 天 |

  ✅ **迁域名不需要重新签证书**：`heyta.finlaw.cloud` 那张早就有了（落地页一直住在那儿），
  所以这次迁移在 TLS 这一层是零改动。两张都在 certbot 的自动续期范围内。

  同一台机器上还有 `ai.finlaw.cloud`、`aiconfig.finlaw.cloud`、`aistudy.finlaw.cloud`、`codex.finlaw.cloud`、
  `lingchuang.finlaw.cloud`、`sumei.finlaw.cloud`、`xcreative.finlaw.cloud`、`x.finlaw.cloud`、
  `x-creative.team`、`xiangleideng.site`、`yuanyuan.finlaw.cloud`。
- ✅ 文件：`/etc/letsencrypt/live/{heyta.finlaw.cloud,heyta-tmp.litopia.space}/{fullchain.pem,privkey.pem}`；
  私钥**存在，位于**该目录（不在本文档抄写内容）。
- ✅ 自动续期：`certbot.timer`（systemd）已启用，下次触发 2026-09-27 05:54 CST，✅ 上次运行 2026-09-26 12:47。
  注意这是 **snap 之外的系统 certbot 1.21.0**（`snap.certbot.renew.timer` 在这台机器上不存在）。

### 3.5 生产环境变量清单

文件：`ubuntu-jcli:~/heyta/server/.env`（✅ 实测，只列键与非敏感值）。

🔴 **2026-10-01 起是 19 条键**（原先 18 条，新增 `PASSWORD_PEPPER`）。
`grep -c '^[A-Z]' .env` 是这条清单的**对账判据** —— 少了哪个键，先和下面这张表比。

🔴 **2026-09-30 全部域名相关变量的值已切到 `heyta.waytofuture.cn`**（见 §3.7.2），
`SMTP_*` 同时切到 `waytofuture.cn` 发信（见 §3.9.1）。改完**必须换容器**才生效
（`docker compose … up -d --no-build supersync`，三个 `-f` 都要带）。

| 变量 | 值 | 说明 |
|---|---|---|
| `NODE_ENV` | `production` | ✅ |
| `PUBLIC_URL` | `https://heyta.waytofuture.cn` | ✅ 2026-09-30 起（§3.7.2） |
| `CORS_ORIGINS` | `https://heyta.waytofuture.cn` | ✅ 与 `PUBLIC_URL` 同源 |
| `DOMAIN` | `heyta.waytofuture.cn` | ✅ 供 compose 的 caddy 服务用（当前没起，nginx 直接反代 1900） |
| `RUN_MIGRATIONS_ON_STARTUP` | `false` | ✅ 迁移由 `deploy.sh` / `migrate-deploy.sh` 显式跑 |
| `TEST_MODE` | ~~`true`~~ **已于 2026-09-27 删除** | ✅ **服务端从来不在测试模式**：生产 compose 不转发它，容器里是空的，线上 `/api/test/*` 全是 404。见 §7.4 |
| `TEST_MODE_CONFIRM` | ~~`yes-i-understand-the-risks`~~ **同时删除** | ✅ 同上；`NODE_ENV=production` 下这两个键只会让服务端起不来 |
| `WEBAUTHN_RP_ID` | `heyta.waytofuture.cn` | ✅ 🔴 **改它会让旧域名上已注册的 passkey 全部失效**（§3.7.1 / §3.7.2） |
| `WEBAUTHN_RP_NAME` | `heyta` | ✅ |
| `WEBAUTHN_ORIGIN` | `https://heyta.waytofuture.cn` | ✅ |
| `SMTP_HOST` | `gz-smtp.qcloudmail.com` | ✅ 腾讯云 SES 的 SMTP 网关（**不是**企业邮） |
| `SMTP_PORT` / `SMTP_SECURE` | `465` / `true` | ✅ |
| `SMTP_USER` | `heyta@waytofuture.cn` | ✅ 2026-09-30 起；SES 发信地址，见 §3.9.1 |
| `SMTP_FROM` | `heyta <heyta@waytofuture.cn>` | ✅ 同上 |
| `POSTGRES_USER` | `heyta` | ✅ |
| `POSTGRES_DB` | `heyta` | ✅ |
| `JWT_SECRET` | 🔒 **存在，值不抄** | ✅ 键存在 |
| `POSTGRES_PASSWORD` | 🔒 **存在，值不抄** | ✅ 键存在 |
| `SMTP_PASS` | 🔒 **存在，值不抄**（SES 发信地址的 SMTP 密码，可在 SES 控制台/tccli 轮换） | ✅ 键存在 |
| `PASSWORD_PEPPER` | 🔒 **存在，值不抄**（64 hex） | ✅ **2026-10-01 补上的** —— 见下面那条 🔴 |

🔴 **`PASSWORD_PEPPER` 是"新镜像 + 旧 `.env`"的隐藏断点，2026-10-01 实测踩到。**
邮箱+口令登录（ADR-0040）把 pepper 做成了**参与哈希的秘密**，并且把它设成**启动硬要求**
（`server/src/password/hash.ts` 的 `getPasswordPepper` 缺失或短于 32 字符就抛，
`server/src/index.ts` 把它转成"拒绝启动"）。生产 `.env` 里当时**没有这一条** ⇒ 换容器后
`supersync-server` 进 `Restarting (1)` 循环、`/health` 与 `/api/*` **全部 502** ——
也就是**整个后端对外消失**，而 compose 只在启动那行给了一句
`The "PASSWORD_PEPPER" variable is not set. Defaulting to a blank string.`

**补法**（值不上命令行、不进日志；改前先备份，§3.8 那条 `.env` 纪律同样适用）：

```bash
ssh ubuntu-jcli 'bash -s' <<'REMOTE'
set -euo pipefail
cd /home/ubuntu/heyta/server
cp -p .env ".env.bak-$(date -u +%Y%m%dT%H%M%SZ)"
umask 077
grep -q '^PASSWORD_PEPPER=' .env || \
  node -e 'console.log("PASSWORD_PEPPER="+require("crypto").randomBytes(32).toString("hex"))' >> .env
chmod 600 .env
echo "PEPPER_COUNT=$(grep -c '^PASSWORD_PEPPER=' .env) LEN=$(grep '^PASSWORD_PEPPER=' .env | awk -F= '{print length($2)}')"
REMOTE
# 只换 server 服务，别把 caddy 一起拉起来（:80 被宿主 nginx 占着，§3.8）
ssh ubuntu-jcli 'cd /home/ubuntu/heyta/server && sudo docker compose \
  -f docker-compose.yml -f docker-compose.monitoring.yml -f docker-compose.build.yml \
  up -d --wait supersync'
```

判据（2026-10-01 实测）：`supersync-server Up (healthy)`、启动日志
`🔒 Password hashing backend verified (Argon2id, 173 ms per hash)`（那是 known-answer 自检，
不只是"读到了变量"）、`/health` 200。

⚠️ **它一旦定了就不能换**：换 pepper ⇒ 存量口令哈希**全部验不过**（`verify` 返回 `false`，
不是"降级还能登"）。所以它属于 §0.3 那张"必须备份的秘密"表，不属于"随手轮换"那类。

⚠️ **存量 bcrypt 哈希没有升级路径**：库里有一条 `$2b$12$…` 的旧哈希（vendored 上游时代的
测试账号）。新栈只认 Argon2id PHC 串，`verifyPassword` 解析失败 ⇒ 一律当"密码不对"
（**不会 500**，因为 `verifyPassword` 把异常吞成 `false`），那个账号因此**登不进口令这条路**。
要恢复它只能给它重设口令。

compose 里还有一批**未在 `.env` 中设置、走默认值**的键（`HOST`、`PRIVACY_*`、`ALLOWED_EMAILS`、
`SUPERSYNC_DEFAULT_STORAGE_QUOTA_BYTES`、`OLD_OPS_CLEANUP_*`、`POSTGRES_MEM_LIMIT` 等）。
它们不在 `.env` 里，就**没有生效**，由 `server/docker-compose.yml` 的默认值决定（如 `POSTGRES_MEM_LIMIT=1536m`）。

⚠️ **`PRIVACY_*` 没配**（实测容器日志：
`No PRIVACY_* configuration set: /privacy.html and the registration consent notice are disabled`）。
后果是注册接口**不要求**勾选任何同意项。要合规上线得先配这五个键 —— 与 §3.11 是同一件事。

### 3.6 公网实测结果

**唯一域名 `heyta.waytofuture.cn`（2026-09-30 起）：**

| 请求 | 结果 | 来源 |
|---|---|---|
| `GET https://heyta.finlaw.cloud/` | `200`（落地页中文版） | ✅ 2026-09-27 |
| `GET https://heyta.finlaw.cloud/en/` | `200`（落地页英文版） | ✅ 2026-09-27 |
| `GET https://heyta.finlaw.cloud/app/` | `200` `text/html`，`<title>heyta</title>`（迁移前这里返回的是**落地页**） | ✅ 2026-09-27 |
| `GET https://heyta.finlaw.cloud/app` | `301` → `/app/`（**保留查询串**） | ✅ 2026-09-27 |
| `GET https://heyta.finlaw.cloud/app/assets/<hash>.js` | `200` `application/javascript` | ✅ 2026-09-27 |
| `POST https://heyta.finlaw.cloud/api/login/passkey/options` | `{"rpId":"heyta.finlaw.cloud",…}` | ✅ 2026-09-27 |
| `GET https://heyta.finlaw.cloud/verify-email`、`/recover-passkey`、`/magic-login` | `400 Token is required`（服务端响应，不是落地页 HTML） | ✅ 2026-09-27 |
| `GET https://heyta.finlaw.cloud/health` | `200` `application/json` + `{"status":"ok","db":"connected",…}` | ✅ 2026-09-27（当天补的，见下） |
| `GET https://heyta.finlaw.cloud/live` | `200` `application/json` + `{"status":"ok"}` | ✅ 2026-09-27（当天补的，见下） |

🔴 **`/health` 和 `/live` 是 2026-09-27 补上的 —— 在那之前它们在唯一域名上是坏的。**

新域名的 `location /` 属于落地页（`try_files ... /index.html`），而服务端只在根路径暴露
两个健康入口（`server/src/server.ts:460` 的 `/health`、`:483` 的 `/live`）。**这两个
location 从没被写进新域名**，于是探针请求掉进落地页的 `try_files`，拿回一个
**HTTP 200 + `text/html`**。

这是最坏的一类失效：**不报错，只是永远绿**。旧域名反而一直是对的（它的 `location /`
整体代理到 1900，健康检查"顺带就有"）—— 迁移时这份顺带的能力没被带过来，
而"旧域名有、新域名没有"正是最容易被漏掉的形状（谁会去测一个自己刚说已经修好的东西？）。

补法（`/etc/nginx/sites-available/heyta.finlaw.cloud`，已含备份）：

```nginx
location ~ ^/(health|live)$ {
    proxy_pass http://127.0.0.1:1900;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

⚠️ 这句**已过期**（2026-10-03 逐字核过）：原文写"这条不在仓库里 —— nginx 站点文件只是主机上的文件"。
现在它在：`server/deploy/nginx/` 是线上站点文件的**版本化镜像**
（`heyta.finlaw.cloud.conf`、`heyta.waytofuture.cn.conf` 两份都在 `git ls-files` 里），
`server/scripts/nginx-sync.sh --apply` 才是把改动推上服务器的那一步。

真正的告诫是**反过来**的方向，而且现在更要紧：**改仓库里那一份不会改变线上行为**。
所以改站点配置要动两处（服务器上的文件 + 仓库里的镜像），只动一处就出现
"仓库说的和线上跑的不是同一份"——那正是这个目录被建出来的原因（见其 README）。

**旧域名 `heyta-tmp.litopia.space`（已弃用，只留端点与入口 301）：**

| 请求 | 结果 | 来源 |
|---|---|---|
| `GET https://heyta-tmp.litopia.space/health` | `200` + `{"status":"ok","db":"connected","wsConnections":0}` | ✅ |
| `GET https://heyta-tmp.litopia.space/` | `200`（同步服务端的 Connect 页 —— 这是**端点**，刻意不做 301） | ✅ |
| `GET https://heyta-tmp.litopia.space/app/` | `301` → `https://heyta.finlaw.cloud/app/`（**原来的 200 已退休**） | ✅ 2026-09-27 |
| `GET https://heyta-tmp.litopia.space/app?lang=en` | `301` → `https://heyta.finlaw.cloud/app?lang=en`（查询串原样带过去） | ✅ 2026-09-27 |
| `GET https://heyta-tmp.litopia.space/app/assets/<hash>.js` | `301` → `…/app/assets/<hash>.js`（路径不走样） | ✅ 2026-09-27 |
| `GET https://heyta-tmp.litopia.space/landing/`、`/landing` | `301` → `https://heyta.finlaw.cloud/`（**不再直接 200**） | ✅ 2026-09-27 |
| `GET http://heyta-tmp.litopia.space/health` | `301` → `https://…/health` | ✅ |
| `GET http://124.223.13.226/health` | `404` | ✅ |

> ⚠️ 本机 shell 设了 `HTTP_PROXY`/`HTTPS_PROXY`，**测公网/本机服务必须加 `--noproxy '*'`**，否则走代理，
> 结果不可信。另外本机 DNS 会把域名解析成 `198.18.0.x`（fake-ip），
> 所以**判断域名到底解析到哪台机器，要在远端机器上用 `getent hosts` 查**，不要本机 `dig`（见 §8.3）。

### 3.7 应用本体（`apps/web`）的发布 —— 2026-09-27 首次完成

🔴 **在此之前 `apps/web` 从来没有被部署到任何地方。** 落地页与同步服务端都在公网，
唯独"应用本身"没有任何地址：访客能读落地页、能连服务端，却**无处可以打开应用**。
这是整条用户旅程上最后一个断点。

#### 它住在哪

| 项 | 值 |
|---|---|
| 公网地址 | 🔴 **当前（2026-09-30 起）：`https://heyta.waytofuture.cn/app/`** —— 见 §3.7.2。<br>2026-09-27 → 2026-09-30 期间是 `https://heyta.finlaw.cloud/app/`（见 §3.7.1） |
| 静态根目录 | `/var/www/heyta-app/`（`ubuntu:ubuntu`）—— 两次迁移**都没动**这个目录，换的只是它挂在哪个域名下 |
| 为什么放这个域名 | 与同步服务端**同源**：`WEBAUTHN_RP_ID` / `WEBAUTHN_ORIGIN` / `CORS_ORIGINS` 都指向它，passkey 才能用（§3.7.1 解释了为什么不能再挂第二个域名） |
| nginx 片段 | `/etc/nginx/sites-available/heyta.waytofuture.cn` —— 应用（`/app/`）、同步 API（`/api/`）与三张凭据页都在这里；`heyta.finlaw.cloud` 那份保留但**不是入口** |
| 旧地址 | `https://heyta-tmp.litopia.space/app/` 与 `https://heyta.finlaw.cloud/app/` 都**不再提供服务**（两者都留作回滚路径，passkey 均不可用：RP ID 只能有一个，见 §3.7.1） |

#### 重新发布的三条命令

🔴 **三条都在仓库根跑，不要 `cd apps/web`。** 原来这一段是 `cd apps/web && …` 后面紧跟
`rsync -az --delete apps/web/dist/ …` —— 那条 rsync 的源路径在 `cd` 之后**不存在**，
照抄的人得到一条 rsync 报错，而它看起来像"服务器连不上"。
下面这一段与落地页那组（「站点与应用要**一起**发布」）现在同一个形状：**同一条命令链只有一份写法**。

```bash
# 1) 构建：🔴 挂载路径必须显式给（参数在 apps/web/vite.config.ts 的 webBase()，取值不合理会当场报错）
HEYTA_WEB_BASE=/app/ pnpm --filter @heyta/web build

# 2) 🔴 发布前对账：产物自己声明的挂载路径，必须等于我们真要放在的位置
pnpm check:web-artifact:app

# 3) 上传
rsync -az --delete apps/web/dist/ ubuntu-jcli:/var/www/heyta-app/
```

🔴 **这一节连同落地页那一组，以及"备份在前、站点先发、发完线上验收"的整条顺序，已固化成一条默认不动手的命令**：
`node research/tools/publish-public-sites.mjs`（不带 `--confirm` 时只打印将要执行的每一条；它拒绝发"不是正好
`main` 那一笔"的字节，也不发服务端镜像）。这一节仍是**命令本体**的说明与手敲逃生门（脚本自己被守卫挡掉时照这里走）；
两份抄件的**目的目录**由脚本自己的 `--selftest` P19 臂与这里对账 —— 改了这里不改脚本，那条臂就红。
`--mutation` 是那 20 条臂各自的变异读数（12 条腿，含未变异对照）。

🔴 **第 2 条不是仪式，它挡的是这一族里最难归因的那一发**：`apps/web/dist` 是**一个目录、两种载体**
（`/` 给 dev/preview/`pnpm check`，`/app/` 给生产），谁最后构建谁覆盖谁。
在 build 与 rsync 之间跑一次对账，就把"发出去的字节是不是这个载体"变成了判据 ——
而只比"本地 vs 远端哈希"是挡不住的（两边可以是同一份错的产物，§7 第 82 条）。

🔴 **`--base=/app/` 必须显式给。** Vite 默认 `base` 是 `/`，产物的资源引用是
**根绝对路径**（`/assets/…`）。挂在 `/app/` 下时浏览器会去请求
`https://<域名>/assets/…` —— 而那个路径属于**落地页**（`root /var/www/heyta-landing`），
于是拿到落地页的 HTML 而不是样式表，现象是**控制台报样式表 MIME 是 `text/html`**、
页面白屏。落地页 2026-09-27 踩的就是同一个坑，两个站点文件里都有对应注释。

#### 落地页上的入口：`VITE_APP_URL`

落地页的「立即使用 / Use it now」由**构建期变量** `VITE_APP_URL` 决定
（判据在 `apps/landing/src/lib/app-url.ts`）：

```bash
# 两条都在**仓库根**跑。
# 🔴 2026-10-03 实测更正：这里原来写的是 `cd apps/landing && VITE_APP_URL=… pnpm exec vite build`
#    紧跟一行 `rsync -az --delete apps/landing/dist/ …` —— 第二行的路径在 `cd` 之后**不存在**，
#    照抄的人会得到一条 rsync 报错，而它看起来像"服务器连不上"。改成与下面
#    「站点与应用要**一起**发布，而且站点先发」那两条同一个形状（同一条命令只有一份写法）。
VITE_APP_URL=https://heyta.waytofuture.cn/app/ pnpm --filter @heyta/landing build
rsync -az --delete apps/landing/dist/ ubuntu-jcli:/var/www/heyta-landing/
```

⚠️ 域名那一串是**抄不得的**：它必须等于当前 canonical 域名（以 §3.7.2 为准），
否则落地页会把人送到一个不再提供服务的入口。上面这行的取值日期是 2026-10-03。

🔴 **不带这个变量重新构建落地页，入口会静默消失** —— 页面不报错，只是又变回
"只能自建"。仓库默认构建（无该变量）**是故意的**：应用还没部署时露出一个
「立即使用」，比没有入口更坏。

⚠️ **2026-10-03 起这条管两个意图，不只一个**：`VITE_APP_URL` 现在同时决定
「立即使用」（→ 应用根）与导航上那个「登录」（→ 应用根 **带 `?signin`，进去直接打开认证面板**，
判据在 `apps/landing/src/lib/app-url.ts` 的 `signInHref()`）。没配置时两者各自退回
站内形状（自建那一节 / `/signin/` 那一页），**不会**出现一个指向不存在应用的链接。
`apps/web` 那一侧读的参数名住在 `apps/web/src/lib/auth-deep-link.ts` ——
两份抄件由 `apps/landing/tests/render.spec.tsx` 逐字对账（改名任何一边都会红）。

#### 应用里的站点入口：`VITE_SITE_URL`（通常**不用配**）

2026-09-28 起，应用内新增了「帮助与关于」（设置页），以及两处上下文入口
（同步出错时的「查看帮助」、托管到期提示里的「价格与订阅」）。它们指向站点 ——
判据在 `apps/web/src/lib/site-url.ts`。

那个文件**默认取应用自己的来源**（`window.location.origin`），因为 §3.3.1 定的是
**唯一域名**：站点住 `/`、应用住 `/app/`。所以"站点在应用所在来源的根上"是一个
已知事实，不是猜一个域名。`VITE_SITE_URL` 只给**分域名部署**那种形态留口子：

```bash
# 只有分域名部署时才有意义。单域名（现状）不要给 —— 给了反而会指向错的地方。
cd apps/web && VITE_SITE_URL=https://site.example.com pnpm exec tsc -b && \
  pnpm exec vite build --base=/app/
```

#### 🔴 站点已经是多页站点：`try_files` 里的 `$uri/` **不能删**

落地页从 2026-09-28 起不再是一页：`/features/`、`/platforms/`、`/pricing/`、
`/help/`、`/changelog/`、`/signin/` 各自是一个**目录 + `index.html`**
（中英双份，共 14 份入口，由 `apps/landing/scripts/gen-entries.mjs` 生成）。

§3.3.1 里那条 `try_files $uri $uri/ /index.html` 的 **`$uri/` 正是它们能打开的原因**。
🔴 把它简化成 `try_files $uri /index.html`（看起来只是少了一个候选）的后果是：

| | 结果 |
|---|---|
| `/features/` | 返回 **HTTP 200 + 落地页首页的 HTML**（`$uri` 是个目录、不存在同名文件） |
| 浏览器 | 页面画得出来、看着"正常"，只是**永远停在首页** —— 标题、正文、锚点全是首页的 |
| `curl -I` | 200，完全正常 |

也就是说：**任何一个"只看状态码"的验收都抓不到它**，而用户看到的是
"点了功能却什么也没发生"。同理，`/app/` 那条的 `$uri/index.html` 也不能删。

#### 🔴 站点与应用要**一起**发布，而且站点先发

应用里的那三条链接指向站点的 `/help`、`/changelog`、`/pricing`。
先发应用、后发站点，用户点到的就是一个 **200 + 首页**（SPA 兜底，同上表）——
不是 404，但也不是他要的那一页。

**发布顺序**：站点（`VITE_APP_URL=… pnpm --filter @heyta/landing build` → rsync）
→ 再发应用。反过来做的那段时间里，帮助入口是坏的。

⚠️ 生成物必须与站点结构一致。CI 里的 `pnpm --filter @heyta/landing check:entries`
会拦住"改了注册表忘了重新生成"（`gen-entries.mjs --check`）。
`dev` / `build` / `test` 三个脚本**各自会先生成一次**，所以本地不会因此踩空。

#### 🔴 2026-09-27 实况：上面这两条**不是"建议"，是部署命令**

当天用 `pnpm --filter @heyta/web build` 与 `pnpm --filter @heyta/landing build`
（也就是工作区里那个 `build` 脚本）重新发了一次，**两个坑同时复发**：

| 现象 | 根因 |
|---|---|
| `/app/` 白屏、`#root` 空的、`/assets/index-*.js` **404** | 工作区的 `build` 脚本**不带 `--base=/app/`**，产物引用 `/assets/…`，而那个前缀属于落地页 |
| 落地页的「立即使用」**消失** | 那个 `build` 脚本**不带 `VITE_APP_URL`**，入口按设计不渲染 |

⚠️ 所以：**要发布就用本节列出的那组命令，不要用裸的 `pnpm --filter … build`。**
两者名字一样、行为不同 —— 这正是"命令看起来对、结果错得没有报错"的那一类。
（🔴 这里原先写的是"这两条命令"，而应用那组已经含一条发布前对账 —— 把**条数**写进结论句，
它就是下一个会漂的东西。发布序列的唯一清单在 §3.7「重新发布的三条命令」。）

#### 🔴 2026-09-27 又两个坑（本次一并修掉，都在站点文件里）

**① `.wasm` 的 MIME**：本机 `/etc/nginx/mime.types` **没有** wasm 条目，nginx 于是返回
`application/octet-stream`；浏览器据此**拒绝** `WebAssembly.instantiateStreaming`
（`Incorrect response MIME type. Expected 'application/wasm'`），再回退到 ArrayBuffer。
**功能没坏、页面没白，只有打开控制台才看得见** —— 属于"不报错就不管"那一类。
已在 `location /app/assets/` 里修：先 `include /etc/nginx/mime.types;` 再
`types { application/wasm wasm; }`。
⚠️ **顺序不能反、也不能省掉 include**：`types` 在嵌套层级是**替换**继承而非叠加，
只写 wasm 会让同目录的 `.js` / `.css` 一起失去类型（模块脚本直接不执行）。

**② `/en/assets/`**：两侧 HTML 用的都是**绝对路径**（`src="/assets/…"`），所以英文页
本身是好的；但 `/en/assets/x.js` 会掉进 `location /en/` 的
`try_files … /en/index.html`，返回 **HTTP 200 + text/html**。当时探测就是这个现象。
已加 `location /en/assets/ { return 404; }` —— 资源确实不在 `/en/` 下，就别假装它在。

验证方式（都实跑过）：主机上 `curl --resolve` 直连 nginx 与公网各测一遍
`.wasm` / `.js` / `.css` 三类 `content-type`；再用真浏览器跑域名验收 23 项全过、
**零 `console.error`**。⚠️ 公网第一次测仍是旧的 `octet-stream`，
是**缓存**；加随机 query 或稍后重测才是真相，别据此改配置。

#### 🔴 同一类坑的第六次：`/legal/*` 未命中被答成 200 + 首页（2026-10-02 修）

上面 ② 的形状是"**资源**掉进 HTML 兜底"，这次是"**页面**掉进 HTML 兜底"，机制完全相同：
`location /` 与 `location /en/` 各有一条 `try_files $uri $uri/ /index.html`，
所以把 `/legal/terms/` 转错一个字母 —— 或者随便编一个 `/legal/xxx/` —— 得到的是
**HTTP 200 + 首页的完整字节**（实测 7022 B，与中文首页逐字相同）。
对搜索引擎那叫**软 404**，对人那叫"我点开的政策页怎么是首页"。

修法（`/etc/nginx/sites-available/heyta.waytofuture.cn`，插在 `location /en/assets/` 之前）：

```nginx
location /legal/ {
    add_header Cache-Control "no-cache" always;
    try_files $uri $uri/ =404;
}
location /en/legal/ {
    add_header Cache-Control "no-cache" always;
    try_files $uri $uri/ =404;
}
```

三条不能省的细节：

- **`$uri/` 不能删**。那 18 个法务入口在磁盘上是**目录**（`/var/www/heyta-landing/legal/terms/index.html`），
  只写 `try_files $uri =404` 会把好页一起 404 掉 —— 这是**把修坏的方向**。
  保留 `$uri/` 还顺带留住了 `/legal/terms` → 301 → `/legal/terms/` 的既有行为（与 canonical 一致）。
- **必须是 prefix location，不是 regex**。nginx 先按 prefix 最长匹配、之后才按文件顺序判 regex；
  加 regex 会改变**已有** regex（`/health|live`、`/terms|privacy\.html`、三张凭据页）的判定顺序。
  逐条核过：那几条 regex 都不匹配 `/legal/` 前缀，所以两条互不干扰。
- **裸 `/legal/` 仍然是 403**，这是**对的**：那里没有 `index.html` 且目录列表关闭，
  403 是 nginx 的诚实回答。别为了"好看"把它兜成首页 —— 那正是本次要修的东西。

验证（都实跑过，`curl --noproxy '*' --resolve heyta.waytofuture.cn:443:124.223.13.226`）：

| 地址 | 改前 | 改后 |
|---|---|---|
| `/legal/nope-not-a-doc/` | **200** + 7022 B（= 首页） | **404** + 162 B |
| `/en/legal/nope-not-a-doc/` | **200** + 6976 B（= 英文首页） | **404** + 162 B |
| 18 份真实入口 | 全 200 | **仍全 200**，title 各异 |
| `/`、`/en/`、`/app/`、`/app/nope-route`、`/health`、`/robots.txt` | 全 200 | **逐字节未变** |

⚠️ 最后一行才是这条改动的**风险所在**：`/app/` 与 `/app/nope-route` 依赖的正是 SPA 兜底，
深链刷新必须仍然 200，所以"没牵连前端路由"要和"未命中变 404"**同时**验，缺一条都不算过。
常驻判据：`e2e/live-site/live-legal.spec.ts` 第 12 条（含阳性对照：同层未知路径
`/not-a-page-xyz/` 仍须 200 —— 否则那两条 404 可能只是"整站都在 404"）。
⚠️ 那条判据是在页面里 `fetch` 相对路径，**必须先 `page.goto(origin)`**：新开的 page 停在
`about:blank`，相对 URL 没有 base 可解析，报的是 `TypeError: Failed to parse URL from /` ——
长得像"服务器坏了"，其实是探针没落到目标域。
🔴 **修完缺陷要回去重跑当初那个变异**，别假定它还会红在同一句上：本次修好软 404 之后，
套件里那条"字节必须与首页不同"对拼错的路径**再也不红了**（404 页的字节本来就不同），
失败退化成 `page.goto` 等一个永不出现的元素、30 秒后只报 `TimeoutError`。
现在 `rawHtml` 先断言 HTTP 200 再返回字节，同一个变异红在「取到 HTTP 404…」那一句。

回滚：`cp /etc/nginx/sites-available/heyta.waytofuture.cn.bak-g25b-20261001T165913Z \`
换回原文件 → `nginx -t` → `systemctl reload nginx`。
🔴 **改动流程本身也要照这个顺序**：先备份 → 改 → `nginx -t` 通过才 reload → 复验 → 不通过就还原。
`nginx -t` 闸门是必要的：这台机器上 nginx 同时服务约 34 个容器的入口，语法错会让**别的站点**一起下线。

✅ 那条边界已经补掉了（2026-10-02，**G-35 闭合**）：未命中的 `/legal/*` 与 `/en/legal/*` 现在答的是**我们自己的双语品牌 404 页**，并且 `server_tokens off` 之后 `Server` 头不再带版本。实现上的两条纪律留在这里，因为它们是**运维事实**而不是台账内容：

- 🔴 **仍然不要用 `try_files … /404.html`** —— 那会把状态码变回 200，等于撤销 G-25b；用的是 `error_page 404 /404.html;`（**不带 `=`**，带 `=` 才是改写状态码的写法）。
- 🔴 **`error_page` 按 location 继承，不继承 `server` 块以外的那份配置** —— 站点里每一个可能未命中的 `location`（含英文那侧的 `/en/legal/`、`/en/assets/`）都要**各自**一条，漏一处那片就答错语言。`/api/` 不需要，因为 `proxy_intercept_errors` 默认 off，上游自己的 404 JSON 不会被接管（这一点由 `live-legal.spec.ts` 的反向判据钉着）。
- 页面本身是**构建产物**，不在这里手改：`apps/landing/public/404.html` 由 `gen-entries.mjs` 生成，改文案去 `packages/i18n`、改样式去 design token。

判据、实测取值与回滚备份路径以台账为准：[`legal-compliance-before-filing.md`](../plans/legal-compliance-before-filing.md) §4 **G-35**（不在这里复述，避免两处漂）。

#### 同意留痕到底生效了没有：`pnpm verify:consent-trail`（2026-10-02 增）

G-32 的结论以前**只以散文形式存在**于台账里。散文的问题是它会被读成"这件事已经查过了"，
而生产状态每周都在变 —— 所以这条现在是一**命令**：`scripts/verify-consent-trail-production.mjs`。

```bash
pnpm verify:consent-trail                # 五条自动腿 + 一条待办腿，每条打印期望值与实测值
pnpm verify:consent-trail --self-test    # 变异门禁：证明每条判据都能被改坏（15 个臂）
```

🔴 **退出码分六种，不是一种"红"** —— 这是它存在的理由：把"批次没进库"和"运维没跑"
混成一个红，会让人去服务器上找一个根本不存在的迁移目录。

| 码 | 含义 | 下一步归谁 |
|---|---|---|
| 0 | L0–L3 + L5 全绿 ⇒ 生产开始记版本号，且用户读到的那一套 == 记账的那一套 | 只剩 L4（注册一条真账号复验那一行） |
| 2 | **L0 红：批次根本没进版本库**（台账 **G-34**） | 链 3 批次的所有者；**运维此刻无事可做** |
| 3 | 代码进了库、生产迁移没应用 | `export PATH="$PWD/research/tools/macos-sed-shim:$PATH"; cd server && sh scripts/migrate-deploy.sh` |
| 4 | 库改好了、镜像里没这段代码 | 走 `server/scripts/deploy.sh` 重建并替换镜像 |
| **5** | **L5 红：线上落地页 JS 里的九份版本 ≠ 镜像 `LEGAL_SET_VERSION`** ⇒ 用户在读 A、注册在记 B（台账 **G-36②**） | **唯一修法是把两侧收进同一批**：重建镜像 + 发布落地页一起做。**不许改这条判据的阈值** |
| 1 | 探针本身没跑成（ssh 不通 / psql 报错 / 库的阳性对照不成立） | **先修探针再谈结论**（§7 元规则一） |

五条自动腿：**L0** 版本库（HEAD 里有那条迁移目录、`schema.prisma` 声明了该列、
`server/src` 里有写入点）· **L1** 生产库有列 · **L2** `_prisma_migrations` 里已应用 ·
**L3** 部署镜像 `/app/dist` 里 grep 得到那段代码 · **L5** 线上产物 ↔ 镜像指纹。
每条都配**独立于被测值**的阳性对照。

🔴 **L5 要在这一步的两端各跑一次**（2026-10-02 增，台账 **G-36②**）：**重建镜像之前**一次、
**发布落地页之后**一次。原因是这两件事各自都有门禁、合起来却没有：`check:server-legal`
只比"生成物 ↔ `@heyta/legal` 真源"，`check:entries` 只比"入口 HTML ↔ 站点注册表"，
**两道闸可以同时绿而线上是"读 1.1、记 1.0"**。它挂不进 `pnpm check`（要 SSH 与公网，
干净检出上必然红 = 一条永远红的判据），所以钉在流程上而不是钉在闸里。

🔴 **L5 的三条取证形状**（都是本轮实跑踩出来的，改这条腿前先读）：
① **不能拿页面 HTML grep** —— 那 18 个入口是客户端渲染的外壳，实测里面一个版本号都没有，
必须打 `/assets/main-*.js`；② 镜像侧只能用**带引号**的形状 `LEGAL_SET_VERSION = "…"` ——
编译产物里同时存在 `= void 0` 占位，而**指纹自己含 `;`**，用 `[^;]*` 会截出半条串
（第一次实跑得到的就是这个错答案），"恰好一条命中"那条控制另配了 `loose > quoted` 证明它不是空判据；
③ 探针必须绕本机代理：`curl --noproxy '*' --resolve heyta.waytofuture.cn:443:124.223.13.226`
（与 `e2e/playwright.live-site.config.ts` 同一立场），否则这台机器上量的是代理的缓存。

🔴 **2026-10-02 第四次重建之后重跑：记账 14/14、退出码 0**（同一天早些时候是 **8/14、退出码 2**，
批次进库后自动变 **退出码 3**，迁移与镜像跟上后才到 0 —— 三个码各对应一次真实的阻塞，
这正是"退出码分五种"要买的东西）。当次实测值：HEAD 迁移命中 1（HEAD 共 **40** 条迁移）、
`schema.prisma` 声明 1、`server/src` 写入点 **3** 个文件、生产列 1、对照 `users.locale`=1 /
`users.terms_accepted_at`=1、`_prisma_migrations` 共 **45** 条且 `20261005000000_*` 与
`20261006000000_*` 各命中 1、`/app/dist` 里 **95** 个 `.js`、grep `termsDocumentVersion` 命中
**3** 个文件、对照 `requireAdmin` 命中 3 个文件。

🔴 **同日补上 L5 之后重跑：记账 18/18、退出码 0，`--self-test` 15/15 个臂会红。**
L5 当次两侧逐字相同（九份里 `terms@1.1`、其余 `1.0`），但脚本同时打印出一条真状态：
**HEAD 已经领先线上产物与镜像**（链 5 那三份 bump 到 1.1 已进库、未发布）——
那不是噪声，那是这条腿存在的理由：链 5 发布那一刻，只动一侧就会退出码 5。

🟡 **L4 不在这条命令里冒充绿**：它要动生产数据（注册一条测试账号，再看那一行是否等于
当前 `legalSetVersion()` 的指纹），脚本只把该跑的 psql 原样打印出来。
✅ **2026-10-02 人工实跑过**：`POST /api/register/email-password`（带 `termsAccepted:true`）→ **201**，
那一行 `terms_accepted_at=1790878335391`、`terms_document_version` **逐字等于镜像里的
`LEGAL_SET_VERSION`**；再与线上落地页 JS 产物里九份 `id/version` 拼出的串对账 ⇒ 三方相同。
收尾按 §3.8.1 下面那段：11 张带 `user_id` 的子表逐张计数全 0 ⇒ `DELETE 1`，`users` 回到 10、
带指纹行数回到 0。
🔴 **参照物必须是"线上那一侧"的常量，不是工作树的**：工作树里 `legal.generated.ts` 可能已经被
另一条批次 bump 过（本轮就是：工作树 `privacy@1.1`，线上与镜像仍是 `privacy@1.0`）。
拿工作树的串去比线上那一行会得到一个**假红**，判据要写 `git show HEAD:server/src/legal.generated.ts`。

📌 写这条命令时踩到两处，都是"探针自己错"那一类，`--self-test` 当场把它们抓出来：

1. **`information_schema` 只认 snake_case**。库里的列是 `terms_document_version`，
   JS 里的字段是 `termsDocumentVersion`；拿后者去查前者会**永远**得到 0 ——
   一条永远红的假判据，看起来恰好和结论一致，因此最危险。
2. **SQL 的 `case when` 挡不住不存在的列**：PostgreSQL 在**解析期**就拒绝
   `… where terms_document_version is not null`，哪怕那个分支永远走不到。
   要用 **shell 的 `if [ "$COL" = "1" ]`** 分两次查询。
3. 顺带：远端 `echo "k\tv"` 在 dash 下**不解释 `\t`**，按 tab 切分的解析器会把整行当噪声 ⇒
   远端一律 `printf`。

⚠️ 还有一条已在台账 G-32 里记过的：`_prisma_migrations` 的列名是 **`migration_name`**，
写成 `name` 会得到 `ERROR: column "name" does not exist` —— 那是探针写错，不是生产缺列。

#### 🔴 改了入口的 URL 形状，就**必须**同时重建应用本体

2026-09-27 实测踩到，而且**只有真浏览器看得见**。

落地页开始往外链带 `?lang=en`（`545d22a`）之后，`/var/www/heyta-app/` 里那份应用
**还是旧的、不认识这个参数** —— 于是英文用户被送进 `/app/?lang=en`，
应用却按默认语言渲染成**中文**。当时所有 `curl` 检查**全绿**：
`/app/` 返回 200、`<title>heyta</title>`、bundle 在、旧域名零命中。
缺的只是"用真浏览器打开它看一眼"这一步。

**判据**（实测）：构建产物里 `"lang"` 这个字面量出现几次。

| | `"lang"` 出现次数 | 行为 |
|---|---|---|
| 旧产物（`index-gkCtydgq.js`） | **0** | 不认识 `?lang=`，英文用户落到中文应用 |
| 重建后（`index-B3XVhPzM.js`） | **1** | 认了；真浏览器复验 `html lang="en"` |

```bash
ssh ubuntu-jcli 'grep -o "\"lang\"" /var/www/heyta-app/assets/index-*.js | wc -l'
```

修法是**重建应用本体**（§3.7「重新发布的三条命令」），不是重发落地页。实测结果：
中文页 → `/app/` → `#root` 141 字符；英文页 → `/app/?lang=en` → `html lang="en"`、
`#root` 335 字符；旧域名 `/app/` → 301 → 同样可用；`/health` 仍 200 JSON 未被重定向。
（共 23 项断言，见 `verify-domain` 脚本；它住在 `/tmp`，不属于仓库。）

🔴 **发布应用时不要直接用这个工作区构建。** 本工作区有并发 agent 在改
`packages/domain` / `packages/app-host`，而 `apps/web` 是从它们的**源码**编译的 ——
直接用会把别人**未提交**的半成品发布到线上。正确做法是在干净 HEAD 上构建：

```bash
# 🔴 先清掉旧的：`git worktree add` 对已存在的路径会直接报错，
#    而这套命令本来就是要反复跑的（每次 main 前进都要重来一遍）。
git worktree remove --force /tmp/heyta-head 2>/dev/null || true
rm -rf /tmp/heyta-head
git worktree add --detach /tmp/heyta-head HEAD
cd /tmp/heyta-head && pnpm install && pnpm build
# ↓ 下面三条都在这个干净检出**的根**跑（原写法 `cd apps/web` 之后那条 rsync 的源路径不存在）
HEYTA_WEB_BASE=/app/ pnpm --filter @heyta/web build
pnpm check:web-artifact:app
rsync -az --delete apps/web/dist/ ubuntu-jcli:/var/www/heyta-app/
```

⚠️ 2026-09-27 那次 `pnpm install` 得加 `--no-frozen-lockfile`：当时 HEAD 的
`pnpm-lock.yaml` 已经引用 `packages/widget-core`，而那个包**还没被提交**
（`git ls-tree HEAD packages/` 里没有它），所以 frozen 安装直接失败。
那是并发 agent 的在途状态，不是本节的长期前提。

#### 线上那份应用是**钉在某个 commit 上的**，main 前进它不会自己更新

同一天第二次踩到，这次不是参数形状变了，是**应用本身落后了**：
迁移时我在 `ede9c02` 重建了应用，之后 `5154236`（"找回通行密钥的入口"）
改了 `apps/web/src/features/auth/AuthPanel.tsx` 与 `packages/i18n` ——
那是**要上线的代码**，而线上那份还是 `ede9c02` 的产物，于是线上少了这个入口。

🔴 这一次不是无关紧要的：**域名迁移把旧域名上的通行密钥全部作废了**
（WebAuthn 的 RP ID 跨不了 registrable domain，用户已接受重新注册）。
"找回通行密钥"正是这次迁移伤口的**补救入口** —— 迁移期间它必须在线。

判定"线上是哪一版"的办法：把产物文件名和本地重建的比。

```bash
ssh ubuntu-jcli 'ls /var/www/heyta-app/assets/'
```

`apps/web` 一有提交就要重建。这跟落地页那条（`VITE_APP_URL`）是两件事：
落地页管"入口在不在、指向哪"，应用管"点进去之后是什么"。

#### 🔴 2026-10-03：线上那份应用**三列塌成三段全宽**，而门禁全绿 —— 根因还是"产物比源码旧"

现象是产品负责人**肉眼**看出来的，没有任何一条判据报过：`/app/` 在 2560 宽下
rail、sidebar、main 各占满一整行竖着堆，图标旁边没有名字。

实测根因（三层，缺一层就会归错因）：

| 量什么 | 读数 |
|---|---|
| `.ht-app` 的 computed `grid-template-columns` | `2560px` —— **一列**，不是三列 |
| 线上 CSS 里 `.ht-app--with-sidebar` 那条声明 | 引用 `--ht-layout-sidebar-min-width` 与 `-max-width` |
| 同一份 CSS 的 `:root` | **没有这两条定义** |

⇒ 引用落空让**整条声明**在 computed-value 阶段失效，网格退化成单列。
控制台 0 条错误、CSS 200、资源零缺失、`pnpm check` 全绿 —— 也就是说这一族坏法
在 CSS 层的表现是"**布局塌了，但所有读数都正常**"。

**修法与验证顺序**（每一步都有读数，别跳）：

```bash
# 1) 从当前源码重打，带挂载参数
cd apps/web && pnpm exec vite build --base=/app/
# 2) 本地量几何要用**与生产同形状**的静态服务：
#    ⚠️ `vite preview` 在 --base=/app/ 下会把 /app/assets/*.js 回成 index.html（text/html），
#    拿它验产物会得到"整页空白"的**假结论** —— 本次实测踩到，别再用 preview 验 /app/ 产物。
# 3) 备份 → 发布 → 线上复量同一组几何 + 截图给人看
ssh ubuntu-jcli 'tar czf /tmp/heyta-app-backup-pre-a6e1a017.tgz -C /var/www heyta-app'
rsync -az --delete apps/web/dist/ ubuntu-jcli:/var/www/heyta-app/
```

🔴 **上面这段是 2026-10-03 那一趟实际跑的顺序，留作事故记录，不要照抄**：它少了 rsync 之前的
产物对账（`pnpm check:web-artifact:app`），而且 `cd apps/web` 之后那条 rsync 的源路径并不存在。
要重发请照 §3.7「重新发布的三条命令」。**不改写这一段本身** —— 把事故现场的命令改成"后来修好的样子"，
下一轮就没人能从这段读出当时到底跑了什么。

本地与线上读数一致：`64px 240px 2256px`（rail / sidebar / main），`errs 0 条`。
备份：`/tmp/heyta-app-backup-pre-a6e1a017.tgz`。

**判据（这次不再靠人眼）**：`check:web-artifact` 加了第 5 条 —— 产物里每个**无兜底值**的
`var(--ht-*)` 必须在该 CSS 里定义过。只判 `--ht-` 命名空间（实测第三方 react-native-web
自己用 `var(--placeholderTextColor)`，算进来就是天天加豁免）；带兜底值的不判（规范上优雅降级）。
注入验证：把当前 CSS 里那两条定义摘掉 ⇒ **精确复刻线上那一版** ⇒ 报出两个名字、`rc=1`；真产物 `rc=0`。

🔴 **线上现在跑的是哪个 commit 要写明白**：本次产物
（`index-CBdUhwXG.css` / `index-8ESfmTgh.js`）来自分支 `feat/self-host-distribution` 的 `a6e1a017`，
**它还没合进 `main`**（被并行会话在飞的 6 个重叠文件挡着，见 `docs/research/self-host-distribution-audit.md` §8.13）。
也就是说这一刻 **生产 ≠ main** —— 下次重建前必须先确认那批改动已经进 main，否则会把修复覆盖回去。

📌 **待入 `environment-traps`**（该文件此刻正被并行会话改着，不往里挤）：
"产物比源码旧"在 CSS 层的**第三种面目** —— 前两种是 APK 里打旧 JS bundle（§7 第 27 条）
与安装包没打 `web-dist`（第 82 条）；这一种是旧产物的 CSS 引用了当时还不存在的 token，
症状既不是白屏也不是缺样式，而是**布局塌了但每个读数都正常**。

#### 变更前备份（回滚用）

- `/etc/nginx/sites-available/heyta.finlaw.cloud.bak-20260927T145658Z`（**迁移前**：只有落地页、没有 `/app/` 与 `/api/`）
- `/home/ubuntu/heyta/server/.env.bak-20260927T145733Z`（**迁移前**：origin 全指向 `heyta-tmp.litopia.space`）
- `/etc/nginx/sites-available/heyta-tmp.bak-20260927T124302Z`（tmp 站点加 `/app/` 之前）
- `/etc/nginx/sites-available/heyta-tmp.bak2-20260927T124707Z`（tmp 站点加 `/app` 重定向之前）
- `/var/www/heyta-landing.bak-20260927T124628Z`（旧落地页产物）
- `/var/www/heyta-landing.bak-20260929T035321Z`（动画微交互上线前的落地页产物；本次只发静态文件，nginx/env 未动）
- `/var/www/heyta-landing.bak-20260929T151330Z`（信息架构与文案改版上线前的落地页产物；只发静态文件，nginx/env 未动）
- `/var/www/heyta-landing.bak-20260930T022530Z`（导航改造 + 仓库公开后的 GitHub 链路恢复上线前的落地页产物；只发静态文件，nginx/env 未动）
- `/etc/nginx/sites-available/heyta.waytofuture.cn.bak-g25b-20261001T165913Z`（**加 `/legal/` 两条 404 location 之前**；回滚见上文那节）

#### 3.7.1 2026-09-27：把测试域名固定到 `heyta.finlaw.cloud`

**为什么迁。** 测试阶段要有**一个**固定域名，不能把入口挂在一个被文档标成"临时资产"
的域名上。迁完 `heyta.finlaw.cloud` 同时提供落地页（`/`）、应用（`/app/`）、
同步 API（`/api/`）和三张凭据页，是测试阶段唯一的域名。

**为什么不能只把应用挂过去、API 留在 tmp。** 🔴 应用与同步服务端做 WebAuthn
时**必须同源**：`WEBAUTHN_RP_ID` 只能取一个值，而 `finlaw.cloud` 与 `litopia.space`
是**不同的可注册域**、没有公共 RP ID —— 跨源时 passkey 不可能工作（浏览器会拒绝）。
所以 API 与凭据页必须跟应用一起搬。

**改了三处，缺一不可：**

| 层 | 改动 |
|---|---|
| nginx | `sites-available/heyta.finlaw.cloud` 新增 `location /app/`（含 `/app` 重定向与 `/app/assets/`）、`location /api/`（含 WebSocket 升级头）、三张凭据页的 `proxy_pass`；`client_max_body_size` 与 tmp 站点对齐到 `64m` |
| 服务端 env | `~/heyta/server/.env` 的 `PUBLIC_URL` / `CORS_ORIGINS` / `DOMAIN` / `WEBAUTHN_RP_ID` / `WEBAUTHN_ORIGIN` 五个值全部改成 `heyta.finlaw.cloud`，然后 `docker compose … up -d --no-build supersync` 换容器 |
| 落地页 | `VITE_APP_URL=https://heyta.finlaw.cloud/app/` 重新构建并 rsync |

**DNS 不用改。** `heyta.finlaw.cloud` 与 `heyta-tmp.litopia.space` 本来就是**同一个 IP**
（`124.223.13.226`），两个 A 记录都指向它 —— 所以这件事 tccli 帮不上忙，
卡点一直是 nginx 与 env，不是解析。

**🔴 已知代价（唯一一条）：tmp 域名上已注册的 passkey 全部失效，测试者要重新注册。**
这不是可以两边兼容的事 —— 见上，RP ID 只能一个。JWT 不受影响（不绑 origin），
所以已登录会话照常。

**验收（2026-09-27 实测）：**

| 请求 | 结果 |
|---|---|
| `GET https://heyta.finlaw.cloud/` / `/en/` | `200` 落地页中/英 |
| `GET https://heyta.finlaw.cloud/app/` | `200` `text/html`，`<title>heyta</title>`（**迁移前这里返回的是落地页**） |
| `GET https://heyta.finlaw.cloud/app` | `301` → `/app/`，**且保留查询串**（`?lang=en` → `/app/?lang=en`） |
| `GET https://heyta.finlaw.cloud/app/assets/<hash>.js` | `200` `application/javascript` |
| `POST https://heyta.finlaw.cloud/api/login/passkey/options` | `{"rpId":"heyta.finlaw.cloud",…}` —— WebAuthn 的 RP ID 真的换了 |
| `GET https://heyta.finlaw.cloud/verify-email`、`/recover-passkey`、`/magic-login` | `400 Token is required` —— 是**服务端**的响应，不是落地页 HTML（即代理通了） |
| `GET https://heyta.finlaw.cloud/api/<不存在>` | Fastify 的 JSON 404，与 tmp 域名**逐字一致**（即 `/api/` 真的到 1900） |

#### 验收方式：**必须用真浏览器**

`apps/web` 是客户端渲染的 SPA，落地页的 CTA 也是 React 渲染出来的 ——
`curl` 只能证明"文件在"，证明不了"点下去真的能打开应用"。本次用 `e2e/` 里的
Playwright 实测：中文页与英文页各两个入口都指向应用地址且带
`rel="noopener noreferrer"`；点「Use it now」→ 落在 `/app/`、`title=heyta`、
`#root` 渲染出 14629 字符、**无 pageerror / console.error**。

（迁移前那次跑的目标是 `https://heyta-tmp.litopia.space/app`；迁移后入口变成
`https://heyta.finlaw.cloud/app`，且**英文页会多一个 `?lang=en`**。
上面那条实测结论与具体域名无关，仍然成立。）

⚠️ 正是这一步抓到了一个 `curl` 抓不到的 bug：`appUrl()` 会去掉末尾斜杠，
而 nginx 的 `location /app/` **不匹配** `/app` —— 点链接（而不是手输 `/app/`）
的用户拿到的是 JSON 404。修法即 `location = /app { return 301 /app/; }`。
🟢 **2026-10-03 补**：这条修法后来**下沉到服务端自己**了（`GET /app → 307 /app/`，
`server/src/web-app.ts`），因为自建的人不会记得加这条 nginx 规则，而少它的表现和
"应用坏了"长得一样。上面这段历史记录本身不改 —— 它记的是**当时**靠 nginx 补的那一刀。

#### 还没做的

- 🔴 **2026-09-30 实测发现：PWA 的两个根绝对路径在 `/app/` 部署下是坏的（本次迁移之前就坏，不是迁移造成的）。**
  真浏览器验收（`e2e/live-site/live-domain.spec.ts`）抓控制台时现形：

  | 请求 | 实测 |
  |---|---|
  | `GET /sw.js` | `200` **`text/html`** ← 落进落地页的 `try_files … /index.html` 兜底 ✗ |
  | `GET /app/sw.js` | `200 application/javascript` ✓（文件在 `/var/www/heyta-app/sw.js`） |

  控制台原文：
  `SecurityError: Failed to register a ServiceWorker … script ('https://heyta.waytofuture.cn/sw.js'):
  The script has an unsupported MIME type ('text/html')`，出自
  `apps/web/src/pwa/register.ts:23` 的 `const SW_URL = '/sw.js'`。

  **同一个根因还有第二处（用户看得见的那处）**：`apps/web/scripts/gen-pwa.mjs`
  生成的 `manifest.webmanifest` 里 `start_url` / `scope` / `icons[].src` 全是 `/…`。
  实测 `GET /icons/icon-192.png` → `200 text/html`（同样是落地页兜底），
  而 `GET /app/icons/icon-192.png` → `200 image/png`。
  ⇒ **在这台域名上安装 PWA，装出来的入口是落地页，图标也是坏的。**

  ⚠️ 为什么以前没发现：`vite preview` / 离线 e2e 都跑在**根路径**，
  那里 `/sw.js` 与 `/manifest.webmanifest` 本来就对。**只有 subpath 部署才露。**
  ✅ 已经对的一件事：Vite 会重写 `index.html` 里的 assets 引用，
  所以构建产物里 `<link rel="manifest" href="/app/manifest.webmanifest">` 是**对的** ——
  坏的只有「manifest **内部**的路径」与「JS 里写死的 `SW_URL`」。

  **建议改法**（与落地页 `VITE_SITE_URL` 同一条设计：把挂载路径变成构建参数，不写死）：
  1. `register.ts`：`const SW_URL = `${import.meta.env.BASE_URL}sw.js`;`
     —— `BASE_URL` 正是"应用挂在什么路径下"，两种形态（`/` 与 `/app/`）自动都对；
  2. `gen-pwa.mjs`：同样从 `BASE_URL`（或新加的 `VITE_BASE`）派生
     `id` / `start_url` / `scope` / `icons[].src`。
     ⚠️ 它是**生成物**（`apps/web/public/{sw.js,manifest.webmanifest,icons/}` 已签进仓库），
     改完要重跑 `pnpm --filter @heyta/web gen:pwa`
     —— 与落地页 `check:entries` 同一类"提交物必须与生成器一致"的纪律。
  3. 顺手：`/app/manifest.webmanifest` 的 Content-Type 是 `application/octet-stream`，
     本机 `mime.types` 里没有 `.webmanifest`。不影响解析（浏览器按 `link` 的 `rel` 认），
     但值得补一条 `application/manifest+json webmanifest;`。

- 应用产物没走 CDN、没有 SRI、没有构建版本号注入。`/app/` 那段 nginx **在仓库里有镜像**
  （`server/deploy/nginx/*.conf`，那个目录自 2026-09-28 起被跟踪 —— 本条原先写"仓库只跟踪
  `server/Caddyfile`"，是过期话），但**那份镜像不是部署源** —— 改它不会改变线上，要
  `server/scripts/nginx-sync.sh --apply`。
- `heyta-tmp.litopia.space` 那份 nginx 站点仍在（`location /` → 1900 的 Connect 页与 `/api/`、
  `/health`；`/app*` 与 `/landing*` 已改成 **301**），留作回滚路径。它**已经不是入口**了：
  落地页的「立即使用」自 2026-09-27 起指向 `heyta.finlaw.cloud`，而且那里 passkey 不可用（§3.7.1）。
- 🔴 同步服务端**仍然是临时形态**（`supersync:local` 本机构建、`RUN_MIGRATIONS_ON_STARTUP=false`）——
  换域名**没有**改变这些。域名只是名字，不是"转生产"。
  ⚠️ 这条原先写的是"没有 SMTP" —— **那当天就不成立了**：§3.9 记着 SMTP 已配好且实测真投递。
  ⚠️ 也**不要**再往这里写 `TEST_MODE=true`：服务端**从来不在**测试模式（§7.4），
  那两个键已于 2026-09-27 从 `.env` 删掉 —— 它们在生产 `NODE_ENV` 下只会让服务端起不来。

#### 原先记在这里、现已做掉的

- ✅ **入口依赖临时域名** —— 已修（§3.7.1）：`VITE_APP_URL` 改成
  `https://heyta.finlaw.cloud/app/`，入口不再挂在一个被标成"临时资产"的域名上。
- ✅ **从英文落地页点进去会到默认中文的应用** —— 已修：
  `apps/landing/src/lib/app-url.ts` 给外链带 `?lang=en`，应用侧
  `apps/web/src/lib/locale.ts` 在**没有已存偏好**时采纳它（已存偏好优先 ——
  反过来的话，一个陈旧的地址栏参数会覆盖用户在应用里的明确选择）。

#### 3.7.2 2026-09-30：把入口迁到 `heyta.waytofuture.cn`

**为什么迁（这次的动因与上次不同）。** 上次（§3.7.1）是"别把入口挂在临时资产上"，
纯运维整洁问题。**这次是被备案倒逼的**：

- 腾讯云 ICP APP 备案（订单 `30179057320250614`）三个平台填报的服务域名都是
  `heyta.waytofuture.cn` —— 它是本主体**已备案主域 `waytofuture.cn`** 的子域，
  避开了 §四 的"域名实名主体不一致"坑；
- 而备案要求**填报的域名真的指向那台已备案的腾讯云服务器**
  （`124.223.13.226`）。填一个只有解析、没有服务的域名，是"服务与填报不一致"。

所以这次迁移不是换个名字，是**让备案填报的那个域名真的成为产品入口**。
见 [`icp-app-filing.md`](icp-app-filing.md) §一。

**与 §3.7.1 同构的四层改动（缺一不可）：**

| 层 | 改动 |
|---|---|
| DNS | `tccli --profile waytofuture dnspod CreateRecord --Domain waytofuture.cn --SubDomain heyta --RecordType A --Value 124.223.13.226 --TTL 600` ⇒ RecordId `2421537933`。⚠️ 本机 `dig` 走本地代理（fake-ip 返回 `198.18.x.x`），**不能用它判断生效** —— 用 DNSPod API 或 DoH 核对 |
| nginx | 新增 `/etc/nginx/sites-available/heyta.waytofuture.cn`（由 `heyta.finlaw.cloud` 那份逐字改写 `server_name`），`sites-enabled` 软链 + 在 `nginx.conf` 第 **69** 行加一条 `include`（本机 nginx **不**自动加载 `sites-enabled`，必须显式 include；`conf.d/*.conf` 才是自动的） |
| 证书 | `certbot --nginx -d heyta.waytofuture.cn --redirect` ⇒ 新证书有效至 **2026-12-29**，自动续期任务已建 |
| 服务端 env | `~/heyta/server/.env` 的 `PUBLIC_URL` / `CORS_ORIGINS` / `DOMAIN` / `WEBAUTHN_RP_ID` / `WEBAUTHN_ORIGIN` 五个值全改；`docker compose -f docker-compose.yml -f docker-compose.monitoring.yml -f docker-compose.build.yml up -d --no-build supersync` 换容器（**三个 `-f` 都要带** —— 容器 label 记的启动组合就是这三份，少一份就是另一份配置） |
| 落地页 | `VITE_SITE_URL=https://heyta.waytofuture.cn VITE_APP_URL=https://heyta.waytofuture.cn/app/ pnpm exec vite build` ⇒ rsync |
| 应用本体 | 无域名变量（`site-url.ts` 默认取自身 origin），照 §3.7 重建即可 |

**🔴 这次多出来的一条纪律：`DEFAULT_SITE_ORIGIN` 必须跟着改。**

`apps/landing/src/site/origin.ts` 的 `DEFAULT_SITE_ORIGIN` 此前写着
"换域名时传 `VITE_SITE_URL`，不要改这个常量" —— **这句话是错的**，
本次迁移踩到了它的后果。真实约束是：

- `index.html` 与各入口页是**已提交的生成物**；
- `pnpm check` 的**第一道**门禁 `check:entries` 会用 `DEFAULT_SITE_ORIGIN`
  重新生成一遍，再与提交物**逐字节比对**。

所以只传 `VITE_SITE_URL` 会让仓库里提交的产物继续自我声明旧域名
（下一次干净检出的 `pnpm check` 会用旧默认值把新产物判红）；
只改常量又会让部署漏掉新域名。**两件事必须一起做**，
然后 `pnpm --filter @heyta/landing gen:entries` 重生成入口页。
（`gen-og-card.mjs` 生成的 `public/og-card{,-en}.png` 同理 —— 卡片右下角印的就是这个域名。）

**🔴 已知代价（与 §3.7.1 逐字相同，不可两边兼容）：`WEBAUTHN_RP_ID` 只能取一个值，
旧域名上注册的 passkey 全部失效，测试者要重新注册。** JWT 不受影响（不绑 origin）。

**回滚路径。** `heyta.finlaw.cloud` 的站点文件**保留在 `sites-enabled` 里**，
但**不是入口**：它的 `.env` 已被改掉，服务端只会给新域名签 challenge，
所以那个域名上 passkey 不可用。要整体回滚，需同时还原
`.env.bak-20260930T063250Z` 与两个 `VITE_*` 构建参数。

**验收（2026-09-30 实测）：**

| 请求 | 结果 |
|---|---|
| `GET /`、`/en/`、`/features/`、`/pricing/` | `200` `text/html` |
| 线上 HTML 的 `<link rel="canonical">` | `https://heyta.waytofuture.cn/`（**页面里已无 `heyta.finlaw.cloud`**） |
| `GET /app/` | `200`，`<title>heyta</title>`，资源走 `/app/assets/…` |
| `GET /app?lang=en` | `301` → `/app/?lang=en`，**保留查询串** |
| `GET /health` | `{"status":"ok","db":"connected",…}` |
| `GET /verify-email` | `400` + `Token is required`（**服务端**响应，不是落地页 HTML ⇒ 代理通了） |
| `POST /api/login/passkey/options` | `{"rpId":"heyta.waytofuture.cn",…}` —— RP ID 真的换了 |
| 证书（`openssl s_client`） | `CN=heyta.waytofuture.cn`，`notAfter=Dec 29 05:33:59 2026 GMT` |
| 真浏览器（`e2e/playwright.live-site.config.ts`） | 落地页渲染 → 点「立即使用」→ `/app/` → 应用外壳可见（输入框 + 主导航），控制台零 `pageerror` |

**验收方式：真浏览器，不是 `curl`。** 见 `e2e/live-site/live-domain.spec.ts` 与
`e2e/playwright.live-site.config.ts`。那份配置把域名用
`--host-resolver-rules` 钉到真实 IP 并加 `--no-proxy-server` ——
否则在这台开发机上验的是**本地代理**（fake-ip），代理一关就变成假绿。

### 3.8 服务端镜像（`supersync`）的重建 —— 2026-09-27 首次在本机完成

服务端**不是**静态产物，改动 `server/` 必须重建镜像并换容器。步骤与两个实测陷阱：

```bash
# 1) 本机：只打包 Dockerfile 真正 COPY 的路径（整个仓库太大，且有 gitignore 的 research/upstream）
#    ⚠️ packages/domain 与 tsconfig.base.json **必须在列**，见下面的第 3、4 条
git archive --format=tar.gz -o /tmp/heyta-server-src.tar.gz HEAD \
  pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json \
  packages/sync-core packages/shared-schema packages/domain server
scp /tmp/heyta-server-src.tar.gz ubuntu-jcli:/tmp/
ssh ubuntu-jcli 'cd ~/heyta && tar xzf /tmp/heyta-server-src.tar.gz'   # .env 不在归档里，会被保留

# 2) 主机：🔴 两个镜像源都不能省（见下）
ssh ubuntu-jcli 'cd ~/heyta/server && \
  APK_MIRROR=mirrors.aliyun.com NPM_REGISTRY=https://registry.npmmirror.com sudo -E docker compose \
    -f docker-compose.yml -f docker-compose.build.yml build supersync'

# 3) 主机：跑迁移 + 换容器（deploy.sh 会先迁移、成功后才切，失败时旧容器继续服务）
ssh ubuntu-jcli 'cd ~/heyta/server && \
  APK_MIRROR=mirrors.aliyun.com NPM_REGISTRY=https://registry.npmmirror.com \
  sudo -E ./scripts/deploy.sh --build'
```

⚠️ **这两个旋钮不是"构建镜像需要的全部旋钮"**，只是**这台生产机**当时需要的那两个：
它拉 `docker.io` 是通的，所以 base 镜像从来没成为问题。有一台**连不上 docker.io** 的机器要照这一段
重打镜像时，还要第三个 `NODE_IMAGE` —— 它坏得更早在**第一条 Dockerfile 指令之前**，
所以得到的是一条响亮但没有层线索的 `load metadata … failed to fetch anonymous token`。
见 [`self-host.md`](self-host.md) §3（含实测错误原文）与 `check:image-build-args` 那条门禁。

> 第 3 步要**带上和第 2 步一样的两个变量**：`deploy.sh --build` 会再跑一次
> `docker compose build`，变量不一致就是不同的 ARG ⇒ **缓存全废、重头再建一遍**。

> 🔴 **要带上未提交的改动时，不许把第 1 步换成对工作树打 `tar czf`。**
> `git archive` 只打**已跟踪**文件，所以 `.env`（gitignored 的本机开发配置）天然不在包里；
> 而对目录打 `tar` 会**把 `server/.env` 一起带上并就地覆盖生产配置**。
>
> **2026-09-30 实测踩到。** 症状绕了一圈才现形：`docker compose` 报
> `supersync-postgres is unhealthy`、日志刷 `FATAL: role "supersync" does not exist`，
> 而数据库本身完好（用正确的角色照样查得到 8 个用户）。更阴的是
> **`JWT_SECRET` 被换成了本机那套** —— 全部已签发令牌与在途的验证 / 魔法登录链接
> 都会失效，且在容器重启之前**一声不响**。
>
> **正确写法**（`-o` 让未跟踪但未忽略的新文件也进包，`--exclude-standard` 排掉 `.env`）：
>
> ```bash
> git ls-files -co --exclude-standard -- \
>   pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json \
>   packages/sync-core packages/shared-schema packages/domain server \
>   | tar czf /tmp/heyta-server-src.tar.gz -T -
> # 解包前先自检：
> tar tzf /tmp/heyta-server-src.tar.gz | grep -E '(^|/)\.env$' && echo '🔴 包里带了 .env，别用！'
> ```
>
> 完整条目录在 [`../reference/environment-traps.md`](../reference/environment-traps.md)
> 「用 `tar` 打包工作树会把 `.env` 一起带上服务器」。**改 `.env` 前永远先备份** ——
> 这次能几分钟恢复靠的就是 `.env.bak-20260930T063250Z`。

> 🔴 **`deploy.sh` 会把整个 compose 栈拉起来，包括 `caddy` —— 而本机 :80 被宿主 nginx 占着。**
> 实测（2026-09-30）：迁移与 `supersync` 容器**都成功了**，最后卡在
> `failed to bind host port 0.0.0.0:80/tcp: address already in use`，
> 于是脚本以"启动失败"收尾，留下一个永远起不来的 `supersync-caddy`（状态 `Created`）。
> **这不是应用故障** —— `supersync-server` / `supersync-postgres` 都是 `healthy`。
> 本机对外服务的一直是**宿主 nginx**（§3.7.2），caddy 在这个部署里是多余的。
> 收尾：`sudo docker rm supersync-caddy`（下一次 `deploy.sh` 还会再造一个，这是 compose 栈的固有形状）。

- 🔴 **`APK_MIRROR` 不设会永久挂住，而且看起来像"在编译"**。这台主机**连不上
  `dl-cdn.alpinelinux.org`**（实测超时无响应；`mirrors.aliyun.com` 0.26s 返回 200），
  而 `apk add` 不设超时 ⇒ `docker compose build` 卡在 `RUN apk add` 且**零输出**。
  实测挂满 40 分钟无任何进展。`server/Dockerfile` 与 `docker-compose.build.yml` 现在把它做成了
  构建参数，**默认仍是官方 CDN**（别处的自建者行为不变）。
- 🔴 **`NPM_REGISTRY` 同理，而且它有个更坏的坑**：光是把它当**环境变量**传是**没用的** ——
  pnpm 会忽略 `npm_config_registry`，照旧从 `registry.npmjs.org` 取包并超时
  （构建日志里命令打印得完全正确，只有 URL 出卖了它）。`server/Dockerfile` 现在用
  `pnpm config set registry "$NPM_REGISTRY"`。详见 `AGENTS.md` §7 第 74 条。
- 🔴 **镜像里原来根本没有 `packages/domain`，也没有 `tsconfig.base.json`** ——
  于是 `server` 其实**早就构建不出来了**（`TS2307` / `TS5083`），而本地 `pnpm -r build` 永远绿。
  这是本次重建挖出的最危险的一条：**"本地全绿"证不了"镜像能构建"**。
  见 `AGENTS.md` §7 第 75 条。
- ⚠️ `deploy.sh` 第一句是 `git pull --ff-only`，而 `~/heyta` **不是 git 仓库** ⇒ 它会打一行
  WARNING 然后继续。**这是预期的**，不是故障。
- ⚠️ `deploy.sh --build` 原本还有一道 dirty-input 守卫，靠 `git diff` 判断输入是否干净 ——
  在没有 `.git` 的目录里它**必然误判为"有脏文件"并拒绝构建**。现已改为"不是 git 仓库就
  跳过并告警"（`AGENTS.md` §7 第 76 条），所以现在会看到一行 `WARNING: not a git work tree …`，
  **同样是预期的**。
- ⚠️ `deploy.sh` 用 in-image 的 `scripts/migrate-deploy.sh` 跑迁移（`docker compose run --rm` 一次性
  容器），**不要**直接 `prisma migrate deploy`（AGENTS §4）。
- ⚠️ `deploy.sh` 会自动带上 `docker-compose.monitoring.yml`（若文件存在），于是会顺带建
  `caddy` / `dozzle` / `uptime-kuma`。**这台主机用 nginx 占着 80/443，`caddy` 必然起不来**
  （`failed to bind host port 0.0.0.0:80: address already in use`），`up -d --wait` 因此整体报错 ——
  但**应用容器已经换好了**。本轮的做法是：确认 `supersync` 健康后
  `docker rm -f supersync-caddy dozzle uptime-kuma` 恢复原拓扑。
- ⚠️ 重建会**覆盖 `supersync:local` 这个 tag**。先留回滚点：
  `sudo docker tag supersync:local supersync:rollback-<日期>`（2026-09-27 已留一份
  `supersync:rollback-20260927`）。
- ⚪ 构建耗时主要在 `pnpm install`（`registry.npmjs.org` 实测 0–40 KiB/s，多次 error 23 重试），
  **不是**在编译。换成 `registry.npmmirror.com` 后这一段从"超时作废"变成**秒级**。
  ⚠️ **失败的层不进缓存**，所以 npm 那次是每次重试都从零开始。
- ✅ 2026-09-27 实测结果：镜像构建成功 → `deploy.sh` 跑完（迁移全部应用，
  `prisma migrate status` 报 `Database schema is up to date!`）→
  `https://heyta-tmp.litopia.space/` 上 `Super Productivity` 与 `SuperSync` 各 **0 次**、
  `heyta` **6 次**，`<title>heyta Server - Connect</title>`；`/health` 200。
- ✅ **2026-09-27 第二次重建**（接入 SMTP + 邮件品牌修正）：同样的三步、
  `APK_MIRROR`/`NPM_REGISTRY` 照旧不能省；`deploy.sh` 报 `No pending migrations to apply`，
  `supersync-server` 换成新镜像后 healthy，`/health` 200。
  随后按本文自己的告诫做了拓扑清理（见上一条 `docker rm -f supersync-caddy dozzle uptime-kuma`）。
  新的回滚点：`supersync:rollback-20260927-smtp`（上一版是 `supersync:rollback-20260927`）。
  ⚠️ 域名这时已经**不是** `heyta-tmp.litopia.space` 而是 `heyta.finlaw.cloud`（§3.7.1）。
- ✅ **2026-10-01 第三次重建**（邮箱+口令登录 ADR-0040、令牌改存 SHA-256、`users.locale`）：
  迁移 `20261004000000_add_user_locale` 与 `20261005000000_invalidate_stored_auth_tokens`
  在 `13:06:30Z` 应用（`_prisma_migrations.finished_at` 实测）；回滚点 `supersync:rollback-20261001`。
  🔴 **这一轮重建自带一个新前提：镜像没有 `PASSWORD_PEPPER` 就拒绝启动** ——
  旧 `.env` 喂不起新镜像，于是换完容器**整个后端 502**。
  这是"改 `server/` 的代码把秘密变成了启动硬要求，而部署侧的 `.env` 不会自己长出这一条"
  的形状；补法与判据在 §3.5 的 `PASSWORD_PEPPER` 那一行。
  ⚠️ 换容器**不必**跑 `deploy.sh`：迁移已经应用时，只需
  `docker compose -f docker-compose.yml -f docker-compose.monitoring.yml -f docker-compose.build.yml up -d --wait supersync`
  —— 带上 `deploy.sh` 反而会再造一个起不来的 caddy（见上面那条 🔴）。
- ✅ **2026-10-02 第四次重建**（同意留痕的版本指针 `20261006000000_add_terms_document_version`，台账 G-32）：
  走的是上面同一套三步，顺序与取值都留了取证：
  1. **批次先进 `main`**（`ad8d9222` 实现 + 迁移、`31b6b1c3` 补漏带的迁移证据、`66e2d8e9` 第三入口判据、
     `2e6f87f7` 后台读那一列）。🔴 这一步不是形式：`git archive HEAD` 只带**已跟踪**文件，
     未进库的代码**打包带不出去** —— 上一轮就是在这里得到"退出码 2"。
  2. **打回滚标签** `supersync:rollback-20261002-consent`（= 当时在跑的镜像 `b98b7b4d9d2b`）。
  3. `git archive --format=tar.gz HEAD <§3.8 那张路径清单>` → scp → 构建
     （`APK_MIRROR=mirrors.aliyun.com` **和** `NPM_REGISTRY=https://registry.npmmirror.com` 两个都要给，
     缺任何一个这台机器上都会失败或慢到超时）。🔴 归档里**不含** `server/.env`：换完容器后
     用 sha256 对账证明生产配置**没被覆盖**（本机与工作树那份是两套值，见上面 tar 那条坑）。
  4. **先迁移、后换容器**：在旧容器里跑镜像自带的 `sh scripts/migrate-deploy.sh` ⇒ `MIGRATE_RC=0`，
     `_prisma_migrations` 从 44 条变 **45** 条；然后 `up -d --wait supersync`（**不**跑 `deploy.sh`）
     ⇒ 新容器 `2b0018b113315` `healthy`，两个容器都 `healthy`，`caddy`/`dozzle` 一个都没被造出来。
  5. 🔴 **换完立刻重取 §3.8.1 那五条线上判据**，全绿 —— 特别是"不存在的账号登录回 **401**
     `invalid_credentials`"，它同时证明 ADR-0040 的口令链路与反枚举的 dummy verify 在这次重建之后
     仍然在跑（这次改的代码只碰注册写库，但**判据不推断，只实测**）。
  6. 数据卫生：L4 用的那条测试账号按 §3.8.1 下面那段流程删掉，`users` 回到 **10**。
  ⚠️ **这一轮没有覆盖的东西**：链 5 的 `packages/legal/{privacy,minors,data-rights}.ts` 与它派生的
  `server/src/legal.generated.ts` 不在 HEAD，所以线上九份文本仍是 `privacy@1.0` —— 与镜像里的
  `LEGAL_SET_VERSION` 一致，这是**刻意的**（把别人在飞的改版发上去，落库的指纹就会替他们宣告版本）。

### 3.8.1 🔴 换完镜像必须重取的五条**线上**判据（2026-10-01 定）

镜像重建只证明"容器 healthy"，不证明"用户那条旅程通了"。本轮真正闭合 ② 的是这五条，
它们每一条都对应一段**曾经坏掉而看起来没坏**的链路：

```bash
curl -sS -o /dev/null -w 'health=%{http_code}\n' https://heyta.waytofuture.cn/health
curl -sS -o /dev/null -w '%{http_code}\n' -X POST https://heyta.waytofuture.cn/api/login/email-password \
  -H 'content-type: application/json' -d '{"email":"nobody@example.com","password":"wrong-password-here"}'
curl -sS -o /dev/null -w '%{http_code}\n' -X POST https://heyta.waytofuture.cn/api/register/email-password \
  -H 'content-type: application/json' -d '{"email":"<一次性邮箱>","password":"<够长的口令>"}'
curl -sS https://heyta.waytofuture.cn/magic-login-confirm.js | grep -c sessionToken
ssh ubuntu-jcli 'sudo docker logs --since 5m supersync-server 2>&1 | grep -i "Password hashing backend"'
```

| 判据 | 期望 | 为什么是它 |
|---|---|---|
| `/health` | `200` | 容器活着（`Restarting` 时这里是 502） |
| `POST /api/login/email-password`（不存在的账号） | **`401 invalid_credentials`**，不是 404/500 | 404=路由没上线；500=pepper/Argon2 后端坏了。**401 同时证明反枚举那条 dummy verify 真的跑了** |
| `POST /api/register/email-password` | `201` + 中性文案 + 日志里 `Verification email sent` | 建号与发信是两条独立的腿，201 不代表送达 |
| `magic-login-confirm.js` 里 `sessionToken` | **≥ 1** | fragment 投递（§3.7 那条"sessionStorage 跨代理集群会丢"的修法）在线上真的在跑 |
| 启动日志有 `Password hashing backend verified` | 有 | Argon2id **known-answer 逐字节**过了 —— "读到了 pepper"不等于"这台 musl 机器算得对"（AGENTS §7 第 32 条同一形状） |

⚠️ **第二、三条会在生产建出真实账号并发出真实邮件**。跑完要收尾：
`select id from users where email='…'` → 确认子表零行 → `delete from users where id=… and email=…`
（2026-10-01 实测：`DELETE 1`、`users` 回到 10）。`_email` 那条验证链接随账号一起消失，
不需要单独吊销。


### 3.9 ✅ 生产 SMTP —— 2026-09-27 打通，发信已实测**真投递**

**历史问题**（保留，因为它是"看起来像代码 bug 的部署缺口"的典型）：
服务端日志一直是
`Failed to send verification email: Error: SMTP configuration is required in production environments`
（`email.ts` `getTransporter`，`NODE_ENV=production` 且 `config.smtp` 为空时抛）。
后果：`POST /api/register/magic-link` 能建号但验证邮件永不到达；
`POST /api/login/magic-link` 会生成 `login_token`，发信失败后又**把 token 清掉** ——
用户点「发送登录链接」之后**什么都不会发生**。
即**登录/注册面板在承诺一封永远不来的邮件**。

#### 现状：已配好并端到端验证通过

发信走**腾讯云邮件推送（SES）**，发件域名 **`finlaw.cloud`**（与应用同域，`heyta.finlaw.cloud`）。

- ✅ `finlaw.cloud` **此前就已是 SES 里验证通过的发件域名**（`ses GetEmailIdentity`：
  `VerifiedForSendingStatus: true`，MX / SPF / DKIM(`qcloud._domainkey`) / DMARC 四项 `Status` 全 `true`）。
  ⇒ **不需要新建发件域名**，也**没有**新建。这一步的"完成验证"是既成事实，不是本次做的。
- ✅ 新建了一个**该域名下的专用发件地址** `noreply@finlaw.cloud`
  （`tccli ses CreateEmailAddress` + `UpdateEmailSmtpPassWord`）。
  🔴 **故意不复用** `abuse@` / `postmaster@` / `legal@` / `invoice@` 那几个 ——
  它们在 `ListEmailAddress` 里属于别的系统（SSOS），而 `UpdateEmailSmtpPassWord` 是**改写**密码，
  会给那个系统换掉 SMTP 凭据。
- ✅ SMTP 参数（本机其它项目同款，非猜的）：
  `host=gz-smtp.qcloudmail.com`、`port=465`、SSL、**用户名 = 发件地址**。
- ✅ 配置住在 **`ubuntu-jcli:~/heyta/server/.env`**（compose 从这个文件插值 `SMTP_*`），
  不是 `~/heyta/.env`（那个文件根本不存在）。
- ✅ 实测发信链路（服务端日志，真实）：
  `SMTP configured: gz-smtp.qcloudmail.com:465`
  → `Verification email sent: <0398d177-…@finlaw.cloud>`
  → `Magic link login email sent: <4dbc1f64-…@finlaw.cloud>`。

#### 端到端验收（这次把"邮件本身"也验了）

用一次性外部邮箱（Guerrilla Mail，有读取 API）走完整用户旅程：

1. `POST /api/register/magic-link` → 201；
2. **邮件真的到了外部邮箱**，`From: noreply@finlaw.cloud`、`Subject: Verify your heyta account`、
   正文 `Welcome to heyta!`、链接 `https://heyta.finlaw.cloud/verify-email?token=…`；
3. `POST /api/verify-email {token}` → `Email verified successfully`；
4. `POST /api/login/magic-link` → 第二封真到达，`Subject: Your heyta login link`；
5. `POST /api/login/magic-link/verify {token}` → **真 JWT（221 字符）**；
6. `GET /api/sync/status` → **200**，`{"latestSeq":0,"storageUsedBytes":0,"storageQuotaBytes":104857600}`。

**上一版记的"唯一没被验证的一环就是邮件本身的投递"到此关闭。**

#### 🔴 这次挖出的两个坑

- 🔴 **`SMTP_FROM` 的引号写法会让整个 deploy 卡死**。写成
  `SMTP_FROM="heyta" <noreply@finlaw.cloud>`（——照抄代码里 `email.ts` 那个联引号的旧默认值，
  它在 JS 里对，在 `.env` 里错）会让 **compose 的 `.env` 解析器**报
  `failed to read …/.env: line N: unexpected character "<" in variable name`
  ⇒ `docker compose build` 直接失败，**迁移和换容器都轮不到**。
  必须**整体**加引号：`SMTP_FROM="heyta <noreply@finlaw.cloud>"`。
  自检：`docker compose -f … config | grep SMTP_FROM` 应输出 `heyta <noreply@finlaw.cloud>`。
- 🔴 **收件侧另有一个独立故障，不要误判成发信失败**：往 `@finlaw.cloud` **自己**发信会失败。
  `finlaw.cloud` 的 MX 是 `mail.finlaw.cloud` → `121.4.24.238`，SES 投递时报
  `DeliverStatus: 3`，`DeliverMessage: dial tcp 121.4.24.238:25: connect: connection timed out`。
  这是**收件方**那台机器的 25 端口对 SES 不可达，**与发件域名/凭据无关** ——
  往外部域（Gmail/QQ/一次性邮箱）发信实测正常。排查时看 `DeliverStatus` 而不是 `SendStatus`：
  **`SendStatus 0` 只表示"腾讯云收下了"，不等于"送到了"**。

#### ⚠️ 一条**不要做**的事

`TEST_MODE` 下有个 `autoVerifyUsers` 开关（`config.ts`）会**跳过**邮箱验证
（并且在跳过时不发验证邮件）。**不要为了"跑通 E2E"在生产打开它** —— 那等于关掉邮箱验证这道门。
本次没动它。

#### 3.9.1 2026-09-30：发信地址从 `finlaw.cloud` 切到 `waytofuture.cn`

**动因**：域名整体迁到 `waytofuture.cn`（§3.7.2），发信不该还挂着一个别的域名 ——
收件人看到 `From: heyta <noreply@finlaw.cloud>` 而站点是 `heyta.waytofuture.cn`，
既是品牌不一致，也是**送达率的实际风险**（发信域与站点域不一致更容易被判可疑）。

**关键前提（实测）**：`waytofuture.cn` 早就是腾讯云 **SES** 里一个**已验证、可发信**的身份 ——
`tccli ses GetEmailIdentity --EmailIdentity waytofuture.cn` 显示
DKIM（`qcloudgz1024._domainkey`）/ MX / SPF / DMARC **四条 DNS 属性全部 `Status: true`**，
配额 500 封/天。所以**没有新增任何 DNS 记录**，也没有动 SPF。

⚠️ 别把它和**企业邮**搞混：`waytofuture.cn` 的 MX 是 `mxbiz1/2.qq.com`（企业邮，用来**收信**），
而 heyta 用的是 `gz-smtp.qcloudmail.com`（SES 的 SMTP 网关，用来**发信**）。
两者共用同一条 SPF `include:qcloudmail.com`，互不冲突。

**做了什么**（全部经 `tccli ses`，profile 用 **`default`** —— SES 身份在那个账号下，
不是 `waytofuture` 那个，后者只有 DNSPod 域名）：

```bash
tccli ses CreateEmailAddress --EmailAddress heyta@waytofuture.cn --EmailSenderName heyta
tccli ses UpdateEmailSmtpPassWord --cli-input-json file:///tmp/ses-pw.json
```

🔴 `UpdateEmailSmtpPassWord` 有**密码策略**：10–20 位，且**至少 2 位不重复数字 + 小写 + 大写**。
第一次随便生成的 base64 密码被拒（`InvalidParameterValue.InvalidSmtpPassWord`）。
密码写进 `.env` 的 `SMTP_PASS`（**不入档**；轮换就用上面第二条命令）。

**验收（2026-09-30 实测）**：

| 证据 | 结果 |
|---|---|
| 服务端日志 | `SMTP configured: gz-smtp.qcloudmail.com:465` → `Verification email sent: <…@waytofuture.cn>` |
| `tccli ses GetSendEmailStatus --RequestDate 2026-09-30` | `ToEmailAddress: <管理员邮箱，见 docs/operations/icp-app-filing.values.local.md>`、`FromEmailAddress: heyta@waytofuture.cn`、`SendStatus: 0`、**`DeliverStatus: 1`（已投递）** |
| 容器内 env | `SMTP_USER=heyta@waytofuture.cn`、`SMTP_FROM=heyta <heyta@waytofuture.cn>` |

> 📌 `noreply@waytofuture.cn` 这个 SES 发信地址**早就存在**，但它的 `EmailSenderName` 是
> 「晓黎学习」—— 那是同主体的另一个产品。heyta 用它会以别人的名义出现在收件箱里，
> 所以**新建了 `heyta@waytofuture.cn`** 而不是复用。

#### 3.9.2 2026-09-30：邮件与凭据页改成「中文优先 + 设计系统 + 零渐变」

**改之前的状态**（产品负责人当场贴出来的那张 `Email Verified!` 就是它）：

| 面 | 改前 |
|---|---|
| 三封邮件（`server/src/email.ts`） | 全英文；按钮色硬编码 `#3b82f6`（不是设计系统的主色 `#2563EB`）；只有 `h2` + 一个按钮 |
| 三张凭据页（`server/src/pages.ts`） | 全英文；**深色主题**（`#0f172a` 底 + `#1e293b` 卡片），与 heyta 的蓝白亮色系完全不是一套；8 个硬编码色值 |
| 两个页内脚本（`public/*.js`） | 英文状态文案写死在脚本里（`Preparing...` / `Logging in...`） |

**改之后：默认中文，按收件人语言切中英文；颜色/间距/字体全部来自设计系统；零渐变。**

##### 真源只有一份，靠"生成物 + 门禁"搬过来

🔴 `server/Dockerfile` 只打包 `packages/{sync-core,shared-schema,domain}` ——
**运行时镜像里没有 `@heyta/design-system`、也没有 `@heyta/i18n`**。
所以不能用"运行时 import"，改用仓库已有的模式（与 `apps/landing` 的
`gen-og-card.mjs`／`check:entries` 同构）：**脚本生成 → 提交生成物 → 门禁查漂移**。

| 生成物 | 真源 | 生成 | 门禁 |
|---|---|---|---|
| `server/src/design.generated.ts`（41 个 token） | `packages/design-system/generated/tokens.json`（它自己由 `tokens.css` 生成） | `pnpm gen:server-design` | `pnpm check:server-design` |
| `server/src/copy.generated.ts`（2 语言 × 45 条） | `packages/i18n/src/locales/{zh-CN,en}.ts` | `pnpm --filter @heyta/sync-server gen:server-copy` | `pnpm check:server-copy` |

两者都已挂进 `pnpm check`。**改词条或改 token 之后必须重跑生成**，否则门禁红。

- 文案那条**只用 `server.` 前缀**的词条 —— 服务端用不到 `web.*` / `mobile.*`。
- 生成脚本用 **TypeScript 的解析器**读词条表（不是正则）：词条值里有转义，
  正则会变成第二套转义规则，必然出错。脚本认不出形状时会**抛**，不会安静地抽到 0 条。
- 设计那条**只搬 light**：`tokens.json` 的 `dark` 是稀疏覆盖（73 条 vs 198 条），
  设计系统自己标注了"不适合直接消费"。邮件客户端的暗色模式由收件方决定，
  我们控制不了 —— 所以邮件与凭据页**只用亮色**。
- 🔴 **零渐变**：`gen-server-design.mjs` 会在设计系统那一侧**断言**没有 `gradient(`，
  有就拒绝生成；`server/tests/server-i18n-design.spec.ts` 在产物那一侧再断言一次。

##### 语言怎么定

优先级：**`?lang=`（邮件链接里带）> 默认 `zh-CN`**。

⚠️ **`Accept-Language` 这一档已于 2026-10-03 删除**（产品负责人拍板：「默认应该是
中文，除非用户登录之后改成了英文、或者一开始就选了英文」）。浏览器语言不是选择，
是环境噪声 —— 它当时正把中文界面注册的人的**第一封信**和**确认页**渲染成英文。
现在英文只有三条来路，全都是用户自己的选择：客户端界面语言（`body.locale`）、
账号语言（`users.locale`）、发信时写进链接的 `?lang=`（它是前两者在发信那一刻的快照）。

发信时把语言写进链接（`email.ts` 的 `withLocale`）是刻意的：邮件是**为收件人**渲染的，
而收件人点开链接时的浏览器语言未必等于他注册时用的语言（在英文系统里注册的中文用户就是典型）。
语言随链接走，收件人看到的就是**发信那一刻**他该看到的语言。

页内脚本的文案**经 `data-*` 下发给静态 JS**（`data-msg-busy` 等）——
脚本是静态资源，取不到词条表；写死就会出现"页面中文、按钮英文"的半吊子状态。
取不到 `data-*` 时脚本**保留服务端已渲染的那一句**（降级方向是"什么都不改"，不是"换个语言"）。

##### 顺带修掉的三个真问题

1. **验证失败的页面会回显服务端的原始错误**。第一版把 `errorMessage(err)` 直接拼进页面 ——
   等于把内部字符串（令牌无效的具体原因、库的错误文案）渲染给任何点到过期链接的人看。
   现在对外只说"这个链接无效或已过期"，细节进日志。
   （`server-security.spec.ts` 加了一条 `not.toContain('Invalid verification token')` 钉住它。）
2. **魔法登录成功后跳到站点根（落地页）**，而令牌放在 `sessionStorage` 里、
   **只有应用启动时才会被消费** ⇒ 用户点了"登录"却停在落地页，还得自己再点一次"立即使用"。
   现在跳 `/app/`。
3. 🔴 **页内脚本被渲染到 `<head>`，导致按钮点了完全没反应**（2026-09-30 **用户实测报障**）。
   报障原文：控制台
   `magic-login-confirm.js:15 Uncaught TypeError: Cannot read properties of null (reading 'dataset')`，
   现象是"页面出来了、按钮点一下没反应"。
   根因：`renderPage` 把 `<script>` 放进了 `<head>`，而那些脚本**没有 `defer`** ——
   在 `<head>` 里是**同步执行**的，那一刻 `<body>` 还没被解析，`document.body` 是 `null`，
   脚本第一行 `document.body.dataset.token` 直接抛错。
   **修法两件一起做**：① 脚本移回 **`</body>` 之前**；② 脚本里加 `DOMContentLoaded` guard，
   让"挂在哪"不再承重（放错也不会崩）。
   **判据**：`server-i18n-design.spec.ts` 断言"脚本必须在 `<body>` 之内且在 `</body>` 之前"
   （把它挪回 `<head>` ⇒ 2 条转红）；`e2e/live-site` 再在**真浏览器**里断言
   **无 `pageerror`**、且点按钮**真的会出现错误状态**（无效 token 场景）。
   ⚠️ 这条也说明：**单测绿不等于用户能用** —— 服务端渲染出来的 HTML 一直是"对的"，
   坏的是加载时机，只有真浏览器点一下才现形。

##### 验收（2026-09-30）

| 证据 | 结果 |
|---|---|
| `pnpm --filter @heyta/sync-server test` | **91 文件 / 1804 passed**（新增 15 条针对这三条硬要求的判据） |
| 变异验证 | 模板里塞一个裸 hex ⇒ 「色值都来自 token」精确报红（指出 `#123456`）；加一句 `linear-gradient` ⇒ 「严禁渐变」报红；让 `resolveLocale` 忽略显式参数 ⇒ 2 条报红 |
| 门禁 | `check:server-design` / `check:server-copy` / `check:ui-language` / `check:design` / `check:migrations` 全绿 |
| 真实发信 | 见 §3.9.1 的同一条链路（`heyta@waytofuture.cn` → 收件箱 `DeliverStatus: 1`） |

### 3.10 密钥轮换 —— 2026-09-27 已完成

#### 有哪些"key"

| 位置 | 键 | 能否由我轮换 |
|---|---|---|
| `~/heyta/server/.env` | `JWT_SECRET`（64 hex） | ✅ 能 |
| `~/heyta/server/.env` | `POSTGRES_PASSWORD`（32 hex） | ✅ 能，但**必须同时改数据库里那把锁** |
| `~/heyta/server/.env` | `SMTP_PASS` | ✅ **能** —— 2026-09-27 实测：它由**腾讯云 SES（邮件推送）**签发，本机 `tccli` 够得到，见下面「SES 口令怎么换」 |

⚠️ `WEBAUTHN_RP_ID` / `WEBAUTHN_ORIGIN` **不是密钥**（是公开标识）。"轮换"它们等于**再换一次域名**，
代价和收益见 §3.7.1 —— 别顺手改。

#### 🔴 三个会让"轮换看起来成功、其实没生效"的坑

**① 只改 `.env` 不改数据库 = 服务端连不上。**
`POSTGRES_PASSWORD` 对 `postgres` 镜像**只在 initdb 时**生效，而卷 `server_postgres-data`
已经存在 —— 改 `.env` 不会改库里那个用户的口令。必须同步：

```sql
ALTER USER heyta WITH PASSWORD '<新口令>';
```

**② `docker restart` 不会重读 `.env`。** 环境变量在容器**创建时**就烘进去了，必须重建：

```bash
cd ~/heyta/server && docker compose \
  -f docker-compose.yml -f docker-compose.monitoring.yml -f docker-compose.build.yml \
  up -d --no-deps supersync
```

**③ 🔴 验证"旧口令真的失效了"时，别用 `-h 127.0.0.1` —— 那条路根本不查口令。**

`pg_hba.conf` 里 local 与 127.0.0.1/::1 都是 **`trust`**，只有容器网段走 `scram-sha-256`：

```
local  all  all               trust
host   all  all  127.0.0.1/32 trust
host   all  all  ::1/128      trust
host   all  all  all          scram-sha-256
```

所以拿**旧**口令 `psql -h 127.0.0.1` 会**成功** —— 本次第一轮就因此误判成"轮换没生效"。
要测就必须走容器 IP：

```bash
IP=$(docker exec supersync-postgres sh -c 'hostname -i')
docker exec -e PGPASSWORD="$OLD" supersync-postgres psql -h "$IP" -U heyta -d heyta -tAc 'select 1'
# 期望：认证失败
```

顺带说清边界：服务端自己连的是 `...@postgres:5432`（容器网段）→ 走 `scram-sha-256`，
**口令对它才是真边界**；loopback 的 `trust` 只是本机运维的便利，不是"口令没用"。

**④ 🔴 `ssh host bash -s <<'REMOTE'` 里**绝不能**再出现会读 stdin 的命令。**

本次轮换就栽在这里：远程脚本第 ① 步是 `docker exec **-i** supersync-postgres psql …`。
`-i` 会把 stdin 接过去，而 stdin 正是 `bash -s` 用来**继续读脚本**的那条流 ——
于是 docker 把脚本剩下的部分（改 `.env`、重建容器）**全吃掉了**，命令却正常退出。

结果是**最危险的那种中间态**：

| | 状态 |
|---|---|
| 数据库里的口令 | ✅ 已经换成新的（第 ① 步执行完了） |
| `.env` 里的口令 | ❌ 还是旧的 |
| 容器 | 还活着，靠**已建立的连接池**撑着，`/health` 依旧 `db:connected` |

**一切看起来正常**，但容器一旦重启就再也连不上库。是复验时逐个比对
`.env` 与新建口令的值才发现的（长度都是 32，光看长度看不出来）。

纪律：远程脚本里用 `docker exec`（不带 `-i`）；要传 stdin 就把脚本先落到远端文件再执行，
不要嵌套 heredoc 去喂同一份 stdin。**并且永远不要只凭"命令退出码 0"就认为脚本跑完了** ——
关键步骤要各自回读实际值来验。

#### 轮换步骤（实测可用）

```bash
cd ~/heyta/server
cp -a .env ".env.rotbak-$(date -u +%Y%m%dT%H%M%SZ)"      # 回滚点

NEW_JWT=$(openssl rand -hex 32)
NEW_PG=$(openssl rand -hex 16)
sed -i "s|^JWT_SECRET=.*|JWT_SECRET=${NEW_JWT}|" .env
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${NEW_PG}|" .env

docker exec supersync-postgres psql -U heyta -d heyta \
  -c "ALTER USER heyta WITH PASSWORD '${NEW_PG}';"

docker compose -f docker-compose.yml -f docker-compose.monitoring.yml \
  -f docker-compose.build.yml up -d --no-deps supersync
```

用 `openssl rand -hex` 而不是随机可见字符：口令要被插进 compose 的
`DATABASE_URL`（`postgresql://user:PASS@host/...`），hex 没有任何需要转义的字符。

#### 复验（三条缺一不可）

```bash
curl --noproxy '*' -sS https://heyta.finlaw.cloud/health     # {"status":"ok","db":"connected"}
curl --noproxy '*' -sS -X POST https://heyta.finlaw.cloud/api/login/passkey/options \
  -H 'Content-Type: application/json' -d '{"email":"<某个真实用户>"}'   # rpId 正确
# 容器实际拿到的 JWT_SECRET 必须等于 .env 里的新值（比 md5，别打印值）
```

`/health` 返回 `db:connected` 是**最强的那条证据** —— 它证明服务端用新口令真的连上了库。

#### SES 口令怎么换（`SMTP_PASS`）—— 实测可用

它**不是腾讯企业邮**，是**腾讯云 SES（邮件推送）**，尽管主机名长得像企业邮
（`gz-smtp.qcloudmail.com`）。所以只能在 SES 侧重签，而 `tccli` 做得到：

```bash
export PATH="$HOME/.local/bin:$PATH"          # tccli 不在 PATH 里
tccli ses ListEmailIdentities                  # 确认 finlaw.cloud 域名 SendingEnabled
tccli ses ListEmailAddress                     # 确认 noreply@finlaw.cloud 存在

# 🔴 口令格式有硬规则，接口会拒：
#    长度 10~20；至少 2 位**不重复**的数字；含小写；含大写。
#    （第一次拿 32 位带特殊字符的被拒：InvalidParameterValue.InvalidSmtpPassWord）
tccli ses UpdateEmailSmtpPassWord \
  --EmailAddress noreply@finlaw.cloud --Password '<新口令>'
```

⚠️ **改完不会立刻生效 —— 大约 1~2 分钟内新旧口令都能过，然后旧口令才被拒。**
本次实测：改完立刻测，**旧口令仍然 LOGIN_OK、新口令反而失败**；等约 45~135 秒后
再测才是「旧 FAIL / 新 OK」。**别在这个窗口里下"轮换失败"的结论，更别回滚。**

负向验证要在**容器内**做（那才是服务端真正用的那份配置）：

```bash
docker exec supersync-server node -e '…SMTP AUTH LOGIN…'   # 期望 235 2.0.0 OK
```

⚠️ 轮换前先确认**没有别的服务共用这个发信地址** —— 换了会把它们一起弄坏：

```bash
for c in $(docker ps --format '{{.Names}}'); do
  docker exec "$c" sh -c 'echo "${SMTP_USER:-}${SMTP_FROM:-}"' 2>/dev/null \
    | grep -q noreply@finlaw.cloud && echo "$c 也用它"
done
```

本次实测只有 `supersync-server` 一个，可以放心换。

#### 已完成的收尾

- ✅ 2026-09-27 轮换 `JWT_SECRET` + `POSTGRES_PASSWORD`；旧口令在 scram 路径上被拒、新口令可用。
- ✅ 销毁了三个持有旧密钥的备份：`.env.bak-20260927T145733Z`、`.env.bak-smtp-1790521888`、
  `.env.rotbak-20260927T154324Z`（`shred -u`）。**旧值不再存在于这台机器上。**
- ⚠️ `JWT_SECRET` 一变，所有已签发的会话/令牌立即失效，用户要重新登录 —— 测试环境可接受。
- ✅ **2026-09-27 第二次轮换（本轮）**：`JWT_SECRET`（64 hex）、`POSTGRES_PASSWORD`（32 位字母数字）、
  `SMTP_PASS`（20 位，走 SES）。三把**全部换掉并逐个复验**：
  - 数据库：容器 IP 上 **新口令 ✅ 可用 / 旧口令 ✅ 已被拒**；
  - 容器内 `JWT_SECRET` 与 `.env` **逐字符相等**；
  - 容器内 SMTP `AUTH` 返回 **`235 2.0.0 OK`**；
  - `/health` → `{"status":"ok","db":"connected"}`，`docker logs` 无错误，`RestartCount=0`。
- ✅ **数据没丢**：重建 `supersync` 时 compose 连带重建了 `supersync-postgres`，
  但卷 `server_postgres-data` 在，复验 `tables=14`、`users=8`。
  （⚠️ `--force-recreate supersync` 会**连带重建依赖**，不是只重建那一个。）
- ⚠️ **passkey 没有失效**，与早先的预期不同：凭据存在库里，而库没动；
  `JWT_SECRET` 只让**已签发的会话**过期。用户重新登录后 passkey 照用。

### 3.11 法律页（`/terms.html`、`/privacy.html`）—— 2026-09-27 从"伪装成 200 的落地页"改成诚实 404

#### 🔴 原缺口：服务条款的网址，打开是营销页

新域名**没有** `/terms.html` / `/privacy.html` 这两个 location，于是它们掉进
`location /` 的 SPA 兜底 —— 返回**落地页**，`HTTP 200`、`text/html`，
且与 `/var/www/heyta-landing/index.html` **逐字节相同**（实测 2370 字节，`cmp` 过）。

这是"**200 但内容是别的页面**"的又一次出现（同一形状见 §3.3.1 的 `/*.js`）。
在这里后果特别坏：做 **KYC / 上架审查**的人恰恰会点开这两个地址 ——
**看到 200 就当作"有条款"**，而实际上什么都没有。

已补 location 并代理到 1900，让服务端那份**诚实的 404** 透出来：

```nginx
location ~ ^/(terms|privacy)\.html$ {
    proxy_pass http://127.0.0.1:1900;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

复验：`/terms.html`、`/privacy.html` → **404 `application/json`**；
`/`、`/en/`、`/app/`、`/health` 不受影响。旧域名本来就对（它的 `location /` 整体代理到 1900）。

#### 法律页怎么才**真的**会对外

| 页 | 来源 | 默认 | 打开它的开关 |
|---|---|---|---|
| `/terms.html` | **操作者自己**放进数据卷的 `<dataDir>/legal/terms.html`（`installOperatorLegalPages`） | **不发布** | `SUPERSYNC_INSTALL_REPO_TERMS=true` |
| `/privacy.html` | 由 `templates/privacy.template.html` 渲染 | **不发布** | 五个 `PRIVACY_*` **全部**设齐；缺一个**直接报错**，不回落占位文本 |

已有的几道防线：`installOperatorLegalPages` **拒绝符号链接**（复制目标是公开可读的
`/terms.html`，跟着软链走会把 `.env` 发布出去）、有大小上限、模板残留由
`assertFullyRendered` 兜住（见 `server/src/server.ts`）。

⚠️ **仓库里那个 `server/legal/terms.html` 是上游的** —— Super Productivity Sync 的德语 AGB，
服务提供者是**另一家公司**。把 `SUPERSYNC_INSTALL_REPO_TERMS` 打开去装它，
等于把**别人的条款**当成自己的发布出去；`deploy.sh` 对这条有专门警告。

⚠️ 两份 heyta 条款草稿（`server/legal/terms-of-service.heyta.md` 与
`terms-of-service.ai.heyta.md`）**不是发布源**，不会被渲染成任何页面。
它们是**门禁的输入**（被当作"对外承诺"核对金额与额度）以及给人读的正文 ——
这一点已就地写在两份草稿的头部，免得有人以为改了 `.md` 线上就变了。

**线上现状（2026-09-27 实测）**：`.env` 里 `PRIVACY_*` **0 条**、数据卷里**没有** `legal/`，
所以两页**都没有发布**。因此 `/terms.html` 与 `/privacy.html` 现在返回的是
**诚实的 404 —— 这不是故障，是当前正确的状态**（草稿还没过法务，本来就不该对外）。

### 3.12 运营管理后台 —— 2026-09-30 首次部署

依据 [ADR-0038](../adr/0038-admin-console-scope.md) /
[`../plans/admin-console.md`](../plans/admin-console.md)。

| 项 | 值 |
|---|---|
| 端点 | `https://heyta.waytofuture.cn/api/admin/*`（与站点同源，经 nginx `location /api/`） |
| 鉴权 | `requireAdmin`：先认证（401），再按 `users.is_admin` 判权（403）。**每次请求都查库** ⇒ 撤销立刻生效 |
| 迁移 | `20261003000000_add_admin_flag` —— `users.is_admin BOOLEAN NOT NULL DEFAULT false`（**实测已应用**） |
| 界面 | 挂在 `apps/web` 的设置页里；**非管理员什么都不渲染**（它自己探测一次，403 就返回 null） |

#### 🔴 部署后是"锁着"的，这是设计而不是故障

`is_admin` 默认 `false` ⇒ **没有人生来是管理员**，`/api/admin/overview` 对所有人 403。
部署完必须显式授权：

```bash
# 🔴 必须在**容器里**跑：DATABASE_URL 的主机名是 `postgres`，
#    那是 compose 网络里的名字，从宿主机解析不到。
ssh ubuntu-jcli 'sudo docker exec supersync-server node dist/scripts/admin.js list'
ssh ubuntu-jcli 'sudo docker exec supersync-server node dist/scripts/admin.js grant <email>'
ssh ubuntu-jcli 'sudo docker exec supersync-server node dist/scripts/admin.js revoke <email>'
```

- 那个人**必须已经注册过**（管理员是账号上的一列，不是一张独立的表）。
- `revoke` **拒绝撤销最后一个管理员** —— 撤销错了不会报错，只会让后台对所有人关闭。
- ⚠️ 镜像里是**编译产物** `dist/scripts/admin.js`，不是 `scripts/admin.ts`：
  生产安装是 `--omit=dev`，没有 `ts-node`。
  所以在服务器上**不要**用 `pnpm admin:grant`（那条是给本机开发用的）。

#### 验收（2026-09-30 实测）

| 请求 | 结果 |
|---|---|
| `GET /api/admin/overview`（无令牌） | `401` `{"error":"Missing or invalid Authorization header"}` |
| `SELECT column_name, is_nullable, column_default … 'is_admin'` | `is_admin \| NO \| false` |
| `docker exec … node dist/scripts/admin.js list` | 「当前没有任何管理员 —— 后台对所有人关闭。」（fail-closed 生效） |
| `supersync-server` / `supersync-postgres` | 均 `Up (healthy)`；`/health` → `{"status":"ok","db":"connected"}` |

### 3.13 nginx 站点文件现在**进了仓库**，并且能查漂移

**问题**：上面 §3.3.1、§3.11 记的这些修复，以及更早的 `/app/`、`/assets/` 迁移，
**全部只发生在服务器上**。仓库里没有任何一处能回答"线上到底有哪些 location" ——
于是同一天踩了**三次**同一个坑（**HTTP 200，但内容是落地页**），而每次都要靠重新发现。

**做法**：把线上那份**逐字节**抄进仓库，并给一个能 diff 的工具。

| 位置 | 作用 |
|---|---|
| `server/deploy/nginx/heyta.finlaw.cloud.conf` | 线上 `/etc/nginx/sites-available/heyta.finlaw.cloud` 的**版本化镜像** |
| `server/deploy/nginx/README.md` | 为什么要有它、它**不是**部署源、本机 include 白名单的坑 |
| `server/scripts/nginx-sync.sh` | `--check`（默认，报漂移，退出码 1）/ `--pull` / `--apply` |

```bash
server/scripts/nginx-sync.sh --check    # 只比对，安全
server/scripts/nginx-sync.sh --pull     # 服务器上改完 → 抓回来提交
server/scripts/nginx-sync.sh --apply    # 仓库 → 线上（先备份、先 nginx -t、通过才 reload）
```

⚠️ **`--apply` 会用仓库副本整体覆盖线上。** 如果仓库副本是旧的，它会连带把线上的修复
一起回滚 —— 脚本会先打印差异、先备份，但**不替你判断**。所以顺序是先 `--check`，再决定。

⚠️ **它不是自动化的部署路径**：`deploy.sh` 不读这个目录，没有任何 CI 会跑 `--apply`。
它唯一的作用是**让漂移可见**。相应地有一条纪律：**在服务器上改完 nginx，必须 `--pull`
回来并提交** —— 否则下次 `--check` 就报漂移，而一个总是响的警报等于没有警报。

⚠️ 本机是**显式 include 白名单**（`nginx.conf` 逐行写 `sites-enabled/<name>`），
不是 `sites-enabled/*` 通配；新增站点要同时改白名单。`heyta-tmp.litopia.space`
是**独立**站点文件，**故意不合并**（那份 `location /` 整个代理到 1900）。

---

## 4. 代理链路

### 4.1 sanjiaozhou：mihomo + 主备故障切换

- ✅ systemd 单元 `/etc/systemd/system/mihomo.service`：`ExecStart=/usr/local/bin/mihomo-failover.sh`，
  `Restart=always`，`RestartSec=15`，描述为 *"Mihomo (Clash.Meta) Service with primary/fallback failover"*。
- ✅ 二进制 `/usr/local/bin/mihomo`，版本 **`Mihomo Meta v1.19.23 linux 386`**（注意是 **386 / 32 位** 构建）。
- ✅ 配置目录 `/etc/mihomo/`，`config.yaml` 是**符号链接**，✅ 当前 → `config.primary.yaml`。
- ✅ 监听：`127.0.0.1:7890`（port）、`127.0.0.1:7891`（socks-port）、`127.0.0.1:9090`（external-controller）。
  `allow-lan: false`、`mode: Rule`、`external-controller: 127.0.0.1:9090`（**只回环**）。
- ✅ 故障切换脚本 `/usr/local/bin/mihomo-failover.sh` 的关键行为：
  - `CONFIG_DIR=/etc/mihomo`，管理 `config.primary.yaml` + `config.fallback.yaml`，
    用 `ln -sfn` 把 `config.yaml` 指向当前生效的那份；
  - 探测：`https://raw.githubusercontent.com/Wei-Shaw/model-price-repo/main/model_prices_and_context_window.sha256`
    **且** `https://api.openai.com/v1/models`，两个都通才算健康（`curl --proxy http://127.0.0.1:7890`，8s 连接 / 20s 总超时）；
  - 健康时每 **120 秒** 重探一次；不健康就换下一份；两份都不健康则 30 秒后重试；
  - 换配置前先 `mihomo -t` 校验；启动后等 controller `/version` 可用；日志 `/var/log/mihomo-failover.log`。
- ✅ 当前生效配置：`proxies` 段 **46 个节点**，`proxy-groups` 含 **`🔰 选择节点`** 等 11 个组。
  ✅ 日志尾部显示流量实际落在 `🔰 选择节点[🇭🇰 香港Z01]`。
- ✅ 日志最近一次切换：无切换记录，持续 `config_healthy`（日志尾部全是正常代理匹配行）。
- ✅ Docker 走代理：`/etc/systemd/system/docker.service.d/http-proxy.conf`：
  `HTTP_PROXY` / `HTTPS_PROXY` = `http://127.0.0.1:7890`，`NO_PROXY=localhost,127.0.0.1,172.17.0.0/16,.internal`。
- ✅ 备份：`/etc/mihomo/config.primary.yaml.bak-before-newsub-20260926T125258`（483899 B）。
  另有大量历史备份（`config.primary.yaml.bak-20260917T125420`、`…backup-before-sg-tw-…` 等）。

### 4.2 ubuntu-jcli：mihomo（**固定配置，无自动故障切换**）

- ✅ systemd 单元 `/etc/systemd/system/mihomo.service`：描述为
  *"Mihomo proxy (fixed configuration, no automatic failover)"*，`User=ubuntu`，
  `ExecStart=/home/ubuntu/clash/mihomo -d /home/ubuntu/.config/mihomo -f /home/ubuntu/.config/mihomo/config.yaml`。
- ✅ 这两台机器的代理**机制不同**：sanjiaozhou 是 failover 脚本管的 `config.yaml → config.primary.yaml` 符号链接；
  ubuntu-jcli 是**固定的 `config.yaml` 实文件**，没有切换。（`~/clash/mihomo-failover.sh` 已改名为
  `…removed-20260904` / `…new` / `…bak-20260727-1512`，即**已弃用**。）
- ✅ 为了让**容器**也能用代理，显式设了：
  `allow-lan: true`、`bind-address: 172.17.0.1`、`external-controller: 172.17.0.1:9090`。
  ✅ 实测监听：`172.17.0.1:7890`、`172.17.0.1:7891`、`172.17.0.1:9090`（以及 `172.17.0.1:7896` 上的一个 ssh 隧道）。
  `bind-address` 只绑 docker0 网桥，**不对公网开放**。
- ✅ 当前 `config.yaml`：494600 B，mtime **2026-09-26 12:55:05**，`proxies` 段 **46 个节点**，
  含 `🔰 选择节点` 组。
- ✅ 备份里有一个**很容易读错的文件**：
  `~/.config/mihomo/config.yaml.bak-before-newsub-20260926T125425` —— 它只有 **1265 字节**，
  内容是一份**极简 direct 配置**（只有 `port/socks-port/allow-lan/bind-address/…/dns`，**没有 proxies**）。
  也就是说：换订阅**之前**这台机器用的是一份"直连"小配置，换完之后才是 46 节点的大配置。
  排查"订阅到底换没换"时别被这个文件名骗了。

### 4.3 本机 Mac

- ✅ `~/.ssh/config` 全局 `SetEnv` 注入了 `http_proxy=http://127.0.0.1:7890` 等（`Host *` 段），
  所以本机所有命令默认走本地 7890。测直连必须 `--noproxy '*'` 或 `env -u HTTP_PROXY -u HTTPS_PROXY …`。

---

## 5. DNS 现状

> 数据源：`tccli dnspod DescribeRecordList`（只读）。✅ 实测 2026-09-26。
> 另外用远端 `getent hosts` 交叉验证了解析结果（因为本机是 fake-ip）。

### 5.1 `litopia.space`（19 条记录）—— 🔴 重点

| 名称 | 类型 | 值 | RecordId | 最后更新 |
|---|---|---|---|---|
| `@` | A | **`101.34.250.109`**（sanjiaozhou） | 2311528075 | 2026-09-26 13:39:39 |
| `api` | A | **`101.34.250.109`** | 2311528078 | 2026-09-26 13:39:41 |
| `dev` | A | **`101.34.250.109`** | 2311528082 | 2026-09-26 13:39:43 |
| `staging` | A | **`101.34.250.109`** | 2311528084 | 2026-09-26 13:39:44 |
| `studio` | A | **`101.34.250.109`** | 2320811684 | 2026-09-26 13:39:46 |
| `docs` | A | **`101.34.250.109`** | 2337124985 | 2026-09-26 13:39:48 |
| `www` | CNAME | `litopia.space.` | 2311528087 | 2026-06-09 |
| `mail` | A | 🔴 **`121.4.24.238`**（**仍是 OPP**） | 2402069694 | 2026-09-26 14:48:46 |
| `@` | MX | `mail.litopia.space.`（优先级 10） | 2311528092 | 2026-09-10 |
| `@` | TXT | `v=spf1 include:qcloudmail.com ~all` | 2311528097 | 2026-06-09 |
| `@` | TXT | `google-site-verification=…` | 2404593564 | 2026-09-12 |
| `_dmarc` | TXT | `v=DMARC1; p=none` | 2311528096 | 2026-06-09 |
| `_acme-challenge` | TXT | （ACME 校验值） | 2311528099 | 2026-06-09 |
| `_cdnauth` | TXT | （CDN 校验值） | 2311528102 | 2026-06-09 |
| `dkim._domainkey` | TXT | `v=DKIM1; k=rsa; p=…`（公钥） | 2402091049 | 2026-09-10 |
| `qcloud._domainkey` | TXT | `v=DKIM1; k=rsa; p=…`（公钥） | 2402103199 | 2026-09-10 |
| **`heyta-tmp`** | A | **`124.223.13.226`**（ubuntu-jcli） | **2419225598** | 2026-09-26 12:29:39 | ⚠️ **已弃用**（§7.1）—— 入口已 301 到 `heyta.finlaw.cloud` |
| `@` ×2 | NS | `library.dnspod.net.` / `fair.dnspod.net.` | — | — |

> ✅ **唯一域名的 A 记录在另一个区**（`finlaw.cloud`，DomainId `98829969`）：
> `heyta` A `124.223.13.226`，RecordId **`2419295096`**，TTL 600。
> 它与 `heyta-tmp` **指向同一个 IP**，所以 2026-09-27 的域名迁移
> **一条 DNS 记录都没改** —— 卡点自始至终在 nginx 与 `.env`（§3.7.1）。

🔴 **与旧线索的关键差异**：旧记录说 `@`/`api`/`dev`/`staging`/`studio`/`docs` 都指向 OPP（`121.4.24.238`）。
**现在不是了** —— 这 6 条在 **2026-09-26 13:39** 已经被改到 sanjiaozhou（`101.34.250.109`）。
唯一还压在 OPP 上的是 **`mail`**（以及它派生出来的 MX / 邮件链路）。

✅ 各子域实测（在 sanjiaozhou 上强制 `--resolve` 探测）：

| 域名 | 结果 | 备注 |
|---|---|---|
| `litopia.space` | 200 | Caddy 静态 + API 反代 |
| `www.litopia.space` | 308 → `https://litopia.space` | 符合预期 |
| `docs.litopia.space` | 200 | `/var/www/docs-litopia/dist` |
| `studio.litopia.space` | 200 | |
| `staging.litopia.space` | 200 | |
| `api.litopia.space` | 404 | 应用层返回（vhost 存在） |
| `dev.litopia.space` | 🔴 **TLS 握手失败** | DNS 指向 sanjiaozhou，但 caddy conf 里**没有 `dev.litopia.space` 的 vhost** → 证书签不出来 |
| `mail.litopia.space` | 301 → `/webmail/?homepage` | 强制打到 `121.4.24.238` 和 `101.34.250.109` **都能返回**（两边各有一套 Mailu） |

### 5.2 `finlaw.cloud`（记录很多，与本文相关的高危项）

✅ 实测。指向 **OPP（`121.4.24.238`）** 的记录（会跟 OPP 一起消失）：

| 名称 | 值 | RecordId |
|---|---|---|
| `deploy` | `121.4.24.238` | 2326683730 |
| `*.deploy`（通配） | `121.4.24.238` | 2326693238 |
| `12km` | `121.4.24.238` | 2326686653 |
| `nexus` | `121.4.24.238` | 2346199235 |
| `mail` | `121.4.24.238` | 2402221134 |

其余大量子域分散在 `101.34.250.109`（sanjiaozhou）与 `124.223.13.226`（ubuntu-jcli），少量在 `119.8.167.61`（wunoos）。

### 5.3 其他域名

| 域名 | 现状 | 与 OPP 的关系 |
|---|---|---|
| `openpenpal.com` | `litopia.openpenpal.com` → OPP；`openpenpal.com` / `www` 在 sanjiaozhou（Caddy 已接管） | 🔴 `litopia.*` 仍指 OPP |
| `x-creative.team` | `@` / `www` → `124.223.13.226`（ubuntu-jcli） | 无关 |
| `xiaolihub.team` | ⚪ 本次查询返回空 | — |
| `litera.space` | ⚪ 本次查询返回空 | — |

---

## 6. 本机开发环境

> 这一节讲的是**你手上这台 Mac**，不是服务器。所有条目 ✅ 实测。

| 组件 | 现状 | 说明 |
|---|---|---|
| **Postgres** | ✅ 监听 `127.0.0.1:5432`（IPv4 + IPv6）；`PostgreSQL 15.13 (Homebrew)` | `brew services` 里 `postgresql@15` 为 `started`；`postgresql@14` / `@17` 未启动；客户端 `psql` 是 14.18 |
| 库 `heyta_mobile_smoke` | ✅ **存在** | 另有 `heyta_mobile_conflict_smoke`、`heyta_p2_node_host_smoke`、`heyta_sync_smoke`；本机共 63 个库（大部分是别的项目） |
| **开发服务端** | ✅ `node dist/src/index.js`，监听 `*:3000` | 🔴 **这是正在运行的开发服务，不要动它。** `GET http://127.0.0.1:3000/health` → `200` + `{"status":"ok","db":"connected","wsConnections":0}` |
| 本机 1900 端口 | ✅ **未监听** | 只有服务器/compose 才跑 1900 |
| 本机 Docker | ✅ **没有 `docker` 命令** | 本机不跑容器 |
| 本机配置 `server/.env` | ✅ 存在（键：`DOMAIN`、`PUBLIC_URL`、`POSTGRES_USER/_PASSWORD/_DB`、`JWT_SECRET`、`CORS_ORIGINS`、`WEBAUTHN_RP_ID`、`WEBAUTHN_ORIGIN`） | 注释写明"本地 P0 验收用的临时配置"；已被 `.gitignore` 忽略 |
| **Android 模拟器** | ✅ **正在跑**：`emulator-5554`，AVD = **`SSOS-Parity-A36`** | `adb` 在 `/opt/homebrew/bin/adb`（**不在默认 PATH**）；AVD 目录 `~/.android/avd/` |
| **iOS 模拟器** | ✅ 当前 Booted：`Litopia-Gate-iPhone`、`Litopia-Gate-iPad` | Xcode 的 iOS 26.5 runtime。📋 线索里提的 SSOS 相关模拟器这次**没有**在运行 |
| 代理 | ✅ `http_proxy` 等环境变量默认注入，指向 `127.0.0.1:7890` | 见 §4.3 |

---

## 7. 待清理 / 有风险的事项

> 本节只做**登记**。文档里不给"现在就去改"的操作指令——真要动，另开一次有意识、可回滚的变更。

### 7.1 `heyta-tmp.litopia.space` 已弃用（2026-09-27）

**它不再是任何东西的入口。** 测试阶段唯一的域名是 `https://heyta.finlaw.cloud/`
（落地页 + 应用 + 同步 API + 三张凭据页，§3.7.1）。旧域名现在的角色只有两个：
`/app*` 与 `/landing*` 做 **301** 跳过去；`/`、`/api/`、`/health` 仍直连同步服务端
（刻意**不** 301 —— 301 会把 POST 改写成 GET，见 §3.3.2）。

| 当初登记的"临时资产" | 2026-09-27 之后 |
|---|---|
| DNS `heyta-tmp.litopia.space` A `124.223.13.226`（RecordId **`2419225598`**，TTL 600） | 仍在；清它**不再影响任何入口** |
| Let's Encrypt `heyta-tmp.litopia.space`（到期 2026-12-25 03:35:57 UTC） | 跟着上面那条一起清 |
| `sites-available/heyta-tmp` + `sites-enabled` 软链 + `nginx.conf` 第 **67** 行那条**手写** `include` | 现在只提供端点与 301；删它同样不影响入口 |

🔴 **仍然不要"只清一半"**：这三样是一套。清 DNS 而留 nginx，同步服务端会少一个可达域名；
清 nginx 而留 DNS，会留下一个指向 404 的解析。

⚠️ **别把这件事和"服务端还是临时形态"混为一谈**：这台机器上的 `supersync-server` 仍是
本地构建的 `supersync:local`、`RUN_MIGRATIONS_ON_STARTUP=false`（见 §7.4）。
**换域名没有改变这一点** —— 换的只是它对外叫什么名字。

2026-09-27 的几次变更留下的备份，清理时一并决定去留：

- `/etc/nginx/sites-available/heyta.finlaw.cloud.bak-20260927T145658Z`（finlaw 加 `/app/` 与 `/api/` 之前）
- `/etc/nginx/sites-available/heyta-tmp.bak-20260927T151156Z`（tmp 退休成 301 之前）
- `/etc/nginx/sites-available/heyta-tmp.bak-20260927T124302Z`（tmp 加 `/app/` 之前）
- `/etc/nginx/sites-available/heyta-tmp.bak2-20260927T124707Z`（tmp 加 `/app` 重定向之前）
- `/home/ubuntu/heyta/server/.env.bak-20260927T145733Z`（origin 还全指向 tmp 时）
- `/var/www/heyta-landing.bak-20260927T124628Z`（旧落地页产物）

（同目录下还有 30+ 个更早的 `.bak-*`，见 §7.5。）

### 7.2 🔴 12km / OPP 到期的连带影响

OPP 已过期、随时回收。✅ 已经搬走的（**这次实测确认不在 OPP 了**）：
`litopia.space` / `api` / `dev` / `staging` / `studio` / `docs` / `www`（→ sanjiaozhou）。

✅ **仍压在 OPP 上、回收后会断的**：

| 资产 | 指向 OPP 的 DNS | 备注 |
|---|---|---|
| **`mail.litopia.space`**（+ MX `litopia.space`、SPF/DKIM/DMARC 链路） | `litopia.space/mail` A = `121.4.24.238` | 🔴 **最高危**。sanjiaozhou 上已经有一套 Mailu 且 Caddy 已配 `mail.litopia.space`（注释写明 2026-09-26 从 12kmroot 迁来），但 **DNS 还没切** |
| `litopia.openpenpal.com` | `openpenpal.com` 记录 → `121.4.24.238` | |
| `deploy.finlaw.cloud` / `*.deploy` / `12km.finlaw.cloud` / `nexus.finlaw.cloud` | → `121.4.24.238` | |
| `mail.finlaw.cloud` | → `121.4.24.238` | |
| OPP 上的 Dokploy、Litopia 生产容器、`litopia-staging-*`、cloudflared、`litopia-seo-refresh` / `litopia-mail-certificate` / `litopia-mail-backup` 三个 timer | — | 回收即全部停止 |

另外：12km 的 `/etc/letsencrypt/live/litopia.space/cert.pem` **已经过期**
（✅ `notAfter=Jan 2 09:09:14 2026 GMT`），且宿主机 nginx 是 `inactive`+`disabled`，
那些 nginx 站点块本来也没在提供服务。**不要被 `/etc/nginx` 里的一大堆配置误导**——
对外实际是 Caddy。

### 7.3 `dev.litopia.space` 当前是坏的

✅ DNS 已指向 sanjiaozhou，但 Caddy 配置里**没有这个 vhost**，TLS 握手直接失败（`tlsv1 alert internal error`）。
是一次迁移没搬全的残留。

### 7.4 ✅ 原判「生产环境开着 `TEST_MODE=true`」**是错的** —— 服务端从来不在测试模式

**2026-09-27 更正。** 本节原先写着：`.env` 里 `TEST_MODE=true`、`NODE_ENV=production`，
"这是需要人拍板的事"。**它把"配置里写了"当成了"运行时长这样"**，而这两件事在这里恰好相反。

实际链路（逐层查过）：

| 层 | `TEST_MODE` |
|---|---|
| `~/heyta/server/.env` | `true` —— **当天已删** |
| `server/docker-compose.yml` 的 `environment:` | **不转发**（它是显式白名单，没有这一行） |
| 容器内 `$TEST_MODE` | **空**（`docker exec … 'echo $TEST_MODE'`） |
| 线上 `/api/test/create-user`、`/api/test/users`、`/api/test/reset` | **全部 404**（实测） |

所以服务端**一直**不在测试模式，`/api/test/*` 没被暴露过。而且这件事不可能反过来：

1. `server/docker-compose.test.yml:11-14` 明写了 TEST_MODE "**必须通过覆盖文件注入，
   绝不能写进生产 compose**" —— 这是**设计**，不是疏漏；
2. 就算硬塞进去也**起不来**：`config.ts:540` 见 `NODE_ENV=production` 且 `TEST_MODE=true`
   会直接 `throw`。

**真正的问题是那两行死配置。** 留着它有两个害处：(a) 让本文档这样误判（已发生）；
(b) 诱使后来者"顺手"往生产 compose 补一行让它生效 —— 而那会让服务端**直接崩**。
已于 2026-09-27 从 `.env` 删除（**20 键 → 18 键**），容器全程不受影响，因为它本来就没拿到这两个变量。

> ⚠️ **这一节的教训不是"漏了核实"，而是核实错了层。** 配置文件的真相不在文件里，
> 在 `docker exec <容器> sh -c 'echo $VAR'` 里。凡是"某个开关是不是开着"，
> 都要落在**运行时**上，否则记下来的是意图而不是事实。

### 7.5 备份文件堆积

- `sanjiaozhou:/etc/mihomo/` 下有 **20+ 个** `config.*.yaml.bak-*` / `*.backup-*`（最早的到 2026-05）；
- `ubuntu-jcli:~/.config/mihomo/` 下同样 20+ 个 `config.yaml.backup-*`；
- `ubuntu-jcli:/etc/nginx/sites-enabled/` 里混着 **30+ 个 `.bak-*` 文件**（本该在 `sites-available/`，放这儿只是因为
  逐行 include 白名单没写 `*`，所以侥幸没被加载——但**很脏**）；
- `12km:/etc/cron.d/` 有 6 个 `docker-prune-safe.bak-20260925-*`；
- `sanjiaozhou:/etc/caddy/conf.d/` 有 10+ 个 `sanjiaozhou.caddy.backup*`。

清理前先确认没人靠旧文件名做回滚。**本次不动。**

### 7.6 ⚪ 未核实项汇总

| 项 | 为什么没核实 |
|---|---|
| ubuntu-jcli / sanjiaozhou 的实例 ID 与**到期时间** | 账号 CVM 列表为空，这两台不可从当前 tccli 凭据读到 |
| 12km「09-27 00:00 停服」 | Lighthouse API 无此字段，属经验值 |
| `wunoos` / `lingchuang` 上跑什么 | 用户明确交代不用；本次只 `hostname`/`whoami` 确认 SSH 可达 |
| ubuntu-jcli 上 3000/3004/3007/3010/4000/4010 各端口归属 | 属于其他项目，超出本文范围 |
| heyta 源码推上服务器的具体方式 | 目录不是 git 仓库；未查 shell history |
| `12km` 的 `/var/www` 总占用 | `du` 超时未跑完 |

---

## 8. 怎么核实

> 下面全是**只读**命令，可以直接重跑。SSH 别名见 §1。

### 8.1 SSH 可达性

```bash
for h in 12km sanjiaozhou ubuntu-jcli wunoos lingchuang; do
  printf '%-14s ' "$h"
  ssh -o BatchMode=yes -o ConnectTimeout=8 "$h" 'hostname; whoami' 2>&1 | tr '\n' ' '; echo
done
```

### 8.2 单机巡检模板

```bash
ssh -o BatchMode=yes ubuntu-jcli '
  cat /etc/os-release | head -3; uname -r; nproc; free -h | head -2
  df -h /
  docker ps -a --format "{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"
  ss -lntp
  systemctl list-timers --no-pager | head -20
'
# 12km 上 docker 需要 sudo（ubuntu 不在 docker 组）：
ssh -o BatchMode=yes 12km 'sudo -n docker ps --format "{{.Names}}\t{{.Status}}"'
```

### 8.3 heyta 公网部署

```bash
# 容器状态与镜像
ssh ubuntu-jcli 'docker inspect supersync-server  --format "{{.Config.Image}} {{.State.Status}} {{.State.Health.Status}} {{.HostConfig.RestartPolicy.Name}}"'
ssh ubuntu-jcli 'docker inspect supersync-postgres --format "{{.Config.Image}} {{.State.Status}} {{.State.Health.Status}}"'
# 确认镜像自带的 caddy 没被启动
ssh ubuntu-jcli 'docker ps -a --format "{{.Names}} {{.Status}}" | grep -i caddy || echo "no caddy container"'

# nginx 片段与 include 位置
ssh ubuntu-jcli 'cat /etc/nginx/sites-available/heyta.finlaw.cloud'   # 唯一域名
ssh ubuntu-jcli 'cat /etc/nginx/sites-available/heyta-tmp'            # 已弃用（端点 + 入口 301）
ssh ubuntu-jcli 'grep -n include /etc/nginx/nginx.conf'
ssh ubuntu-jcli 'sudo -n nginx -t'

# 证书与续期
ssh ubuntu-jcli 'sudo -n certbot certificates'
ssh ubuntu-jcli 'systemctl list-timers --no-pager | grep -i certbot'

# 环境变量（只打印键，不打印值）
ssh ubuntu-jcli 'sed -E "s/=.*/=<REDACTED>/" ~/heyta/server/.env'
```

### 8.4 公网端点（**必须 `--noproxy '*'`**）

```bash
# ── 唯一域名 heyta.finlaw.cloud：落地页 / 应用 / API / 凭据页 ──────────
curl --noproxy '*' -sS -m 15 -w '\nHTTP %{http_code}\n' https://heyta.finlaw.cloud/health
curl --noproxy '*' -sS -m 15 -o /dev/null -w 'HTTP %{http_code}\n' https://heyta.finlaw.cloud/app/
curl --noproxy '*' -sS -m 15 -o /dev/null -D - https://heyta.finlaw.cloud/app     # 期望 301 → /app/（带 $is_args$args）
# 凭据页必须是**服务端**响应（400 Token is required），不是落地页的 HTML
curl --noproxy '*' -sS -m 15 -w '\nHTTP %{http_code}\n' https://heyta.finlaw.cloud/recover-passkey

# ── 旧域名 heyta-tmp.litopia.space：入口 301、端点直连 ─────────────────
curl --noproxy '*' -sS -m 15 -o /dev/null -D - https://heyta-tmp.litopia.space/app/    # 期望 301
curl --noproxy '*' -sS -m 15 -w '\nHTTP %{http_code}\n' https://heyta-tmp.litopia.space/health  # 期望 200，**不能**是 301
curl --noproxy '*' -sS -m 15 -o /dev/null -D - http://124.223.13.226/health            # 期望 404

# 强制指定解析目标，绕开本机 fake-ip / 代理
curl --noproxy '*' -sS -m 12 -k --resolve litopia.space:443:101.34.250.109 -o /dev/null -w 'HTTP %{http_code}\n' https://litopia.space/
```

> ⚠️ **`/health` 那一条是这套检查里最容易看错的一条**：旧域名上它必须是 **200**，
> 因为它仍然直连同步服务端。如果它变成 301，说明有人把旧域名整个重定向了 ——
> 那会**打断正在同步的客户端**（301 让 POST 变 GET，客户端"成功"了却丢了内容）。

### 8.5 DNS（**只读，不要改**）

```bash
export PATH="$HOME/.local/bin:$PATH"
tccli dnspod DescribeRecordList --Domain litopia.space --output json
# 只看关键字段
tccli dnspod DescribeRecordList --Domain litopia.space --output json \
  | python3 -c 'import json,sys;[print(f"{r[\"Name\"]:<20}{r[\"Type\"]:<6}{r[\"Value\"]:<45}id={r[\"RecordId\"]}upd={r[\"UpdatedOn\"]}") for r in json.load(sys.stdin)["RecordList"]]'

# 唯一域名的 A 记录在**另一个区**（finlaw.cloud，DomainId 98829969）
tccli dnspod DescribeRecordList --Domain finlaw.cloud --output json \
  | python3 -c 'import json,sys;[print(f"{r[\"Name\"]:<20}{r[\"Type\"]:<6}{r[\"Value\"]:<30}id={r[\"RecordId\"]}") for r in json.load(sys.stdin)["RecordList"] if r["Name"]=="heyta"]'

# 判断域名到底解析到哪台机器：在远端查，别在本机 dig
ssh ubuntu-jcli 'getent hosts litopia.space mail.litopia.space heyta-tmp.litopia.space heyta.finlaw.cloud'
```

### 8.6 12km 实例信息（只读）

```bash
export PATH="$HOME/.local/bin:$PATH"
tccli lighthouse DescribeInstances --region ap-shanghai --output json \
  | python3 -c 'import json,sys;i=json.load(sys.stdin)["InstanceSet"][0];[print(k,"=",i.get(k)) for k in ("InstanceId","InstanceName","OsName","InstanceState","ExpiredTime","RenewFlag","InstanceRestrictState","IsolatedTime")]'
```

### 8.7 代理

```bash
# sanjiaozhou：故障切换脚本与当前生效配置
ssh sanjiaozhou 'systemctl cat mihomo; readlink -f /etc/mihomo/config.yaml; tail -20 /var/log/mihomo-failover.log'
# ubuntu-jcli：固定配置 + 给容器用的 bind-address
ssh ubuntu-jcli 'systemctl cat mihomo; grep -nE "^(allow-lan|bind-address|external-controller|port|socks-port)" ~/.config/mihomo/config.yaml'
```

### 8.8 本机开发环境

```bash
lsof -nP -iTCP:5432 -sTCP:LISTEN     # 本机 Postgres
lsof -nP -iTCP:3000 -sTCP:LISTEN     # 本机开发服务端
curl --noproxy '*' -sS -m 8 http://127.0.0.1:3000/health
/opt/homebrew/bin/psql -h 127.0.0.1 -p 5432 -lqt | cut -d'|' -f1 | grep heyta
/opt/homebrew/bin/adb devices -l
xcrun simctl list devices booted
```

### 8.9 文档门禁

```bash
export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:/opt/homebrew/bin:$PATH"
pnpm check:docs
```

> ⚠️ **本机已知坑（与文档内容无关）**：如果 `node_modules` 与 lockfile 不同步，`pnpm check:docs` 会在
> precheck 阶段直接抛 `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` 并**要重装依赖**，
> 根本走不到检查脚本。这是仓库工作区的既有状态（`.pnpm-store` 被删过），不是文档错误。
> 想只跑死链检查、不重装依赖，直接执行 `check:docs` 真正调用的那条命令：
>
> ```bash
> node research/tools/docs-link-check.mjs
> ```
>
> 本文档交付时的结果：**✅ 无死链（exit 0）**。扫描的文件数与链接数会随文档增长，
> 以命令实际输出为准 —— **不要在这里写死数字**，它一定会漂移。

---

## 9. 本次核实与旧记录的差异

> 这一节是给下一次维护的人看的：**旧线索里哪些已经过期**。

| # | 旧记录 | 本次实测 | 证据 |
|---|---|---|---|
| 1 | `litopia.space` 的 `@`/`api`/`dev`/`staging`/`studio`/`docs` 都指向 **OPP `121.4.24.238`** | 🔴 **全部已改到 sanjiaozhou `101.34.250.109`**（2026-09-26 13:39 改的）；只有 **`mail`** 还在 OPP | `tccli dnspod DescribeRecordList`；远端 `getent hosts` |
| 2 | 12km 系统是 **OpenCloudOS-8tfs** | 实际是 **Ubuntu Server 24.04 LTS**。`OpenCloudOS-8tfs` 只是**实例显示名** | `cat /etc/os-release`；`OsName` 字段 |
| 3 | （隐含）12km 用 nginx | 对外是 **Caddy**；`nginx.service` 是 `inactive`+`disabled` | `ss -lntp`（caddy 占 80/443）；`systemctl is-active nginx` |
| 4 | `http://` 应 301 跳 HTTPS | **只有带正确 Host 才跳**；`http://124.223.13.226/` 返回 **404** | `curl -D -` 实测 |
| 5 | 两份服务器都换成新订阅，"**57 个节点**" | 两边 `proxies` 都是 **46 个节点**（sanjiaozhou primary/fallback 各 46，ubuntu-jcli 46） | Python 解析 YAML 段计数 |
| 6 | sanjiaozhou "在跑代理" | 不只是代理：它现在是 **litopia.space 等站点的对外主机**（Caddy + PM2 Litopia + Mailu + SSOS 等） | Caddyfile、PM2 list、docker compose project 列表 |
| 7 | OPP "预计停服 2026-09-27 00:00" | 到期时间 `2026-09-25T13:32:10Z` **已过**，但实例仍 `RUNNING`、`InstanceRestrictState=NORMAL`；"09-27 停服"**无 API 可复核** | `tccli lighthouse DescribeInstances` |
| 8 | （未提） | `dev.litopia.space` **当前 TLS 失败**：DNS 已切但 Caddy 无 vhost | `curl -k --resolve` + grep caddy conf |
| 9 | heyta 生产 env 清单 | 基本吻合；`POSTGRES_USER`/`POSTGRES_DB` 都是 `heyta`。~~多出 `TEST_MODE=true`~~ → **查实为死配置**（生产 compose 不转发它，服务端从不在测试模式，§7.4），已于 2026-09-27 从 `.env` 删除 | `ssh ubuntu-jcli 'cat ~/heyta/server/.env'`（去值）**加** `docker exec … 'echo $TEST_MODE'` |
| 10 | 交付路径 `docs/ops/deployment.md` | 按 [`docs/README.md`](../README.md) 的分层规则，运维操作手册归 **`runbooks/`**，故落在 **`docs/runbooks/deployment.md`**（命名规范 `runbooks/<kebab-case>.md`） | `docs/README.md` §一、§二 |
| 11 | 备份文件 `ubuntu-jcli:…config.yaml.bak-before-newsub-20260926T125425` | 文件存在，但**只有 1265 B、无 proxies**——是"换订阅之前的直连小配置"，不是旧订阅 | `ls -la` + `head` |
| 12 | 本机跑 Android 模拟器 `emulator-5554`（AVD `SSOS-Parity-A36`） | ✅ **属实**（这次仍在跑） | `adb -s emulator-5554 emu avd name` |
| 13 | iOS 模拟器 | 当前 Booted 的是 `Litopia-Gate-iPhone` / `Litopia-Gate-iPad`，**不是** SSOS 的 | `xcrun simctl list devices booted` |

---

## 10. 🔴 heyta 自己把 finlaw 的全机 Docker 自动回收卡死了（2026-09-26 已修）

### 现象

`ubuntu-jcli` / finlaw（`124.223.13.226`）磁盘长期停在 70%+，`docker system df`
显示 **16.17 GB 镜像"可回收"**却一直不动。机器上有 `/usr/local/sbin/docker-prune-safe`
（cron 每 30 分钟、内部 20 小时闸门），但它**每次都跳过重活**：

```
/var/log/docker-prune-safe.log
===== 2026-09-26T15:00:01+08:00 开始 =====
BUSY: 685122 /sbin/docker-init -- docker-entrypoint.sh sh -c if [ "${RUN_MIGRATIONS_ON_STARTUP:-false}" = "true" ]; then sh scripts/migrate-deploy.sh || exit 1; fi; exec node dist/src/index.js
SKIP: 检测到部署或构建进程，跳过重活
```

`/var/lib/docker-prune-safe.last-success` = `2026-09-25 21:30:01` —— 自那以后没成功过一次。

### 根因（两处叠加）

1. **子串误命中**：`BUSY_PAT` 里含 `deploy\.sh`，而我们的 entrypoint 命令行里有
   `sh scripts/migrate-deploy.sh` —— **`migrate-deploy.sh` 含子串 `deploy.sh`**。
   而 `RUN_MIGRATIONS_ON_STARTUP=false`，那个分支**永远不会执行**，
   它只是 `sh -c` 里的一段死字符串。
2. **"忽略 `-c` 包装器"的规则只认前缀**：

   ```bash
   case "$args" in
     "bash -c "*) continue ;;
     "sh -c "*) continue ;;
   ```

   我们的 cmdline 以 `/sbin/docker-init -- docker-entrypoint.sh …` 开头，
   **不匹配任何一条**。而脚本第 13–15 行的设计声明明确写着应该忽略 `-c` 编排包装器。

`MAX_BUSY_AGE=86400`（24 小时）兜底也救不了：**容器一重启计时器就归零**，
对长期运行的服务永不生效。

> 这不是第一次：脚本注释里记着同一类事故发生过两次
> （sanjiaozhou 的监控命令文本、以及一个 2026-07-14 卡死的 `bash deploy.sh` 孤儿）。
> 我们现在是第三次。

### 修复（已应用）

`/usr/local/sbin/docker-prune-safe` 的 `is_busy()` 里补了一条容器包装器规则：

```bash
case "$args" in
  *docker-init*|*docker-entrypoint.sh*)
    case "$args" in
      *" -c "*) continue ;;
    esac
    ;;
esac
```

备份：`/usr/local/sbin/docker-prune-safe.bak-before-heyta-fix-20260926T162444`

### 验证（可证伪，不是"看着像好了"）

`is_busy` 是"**任一**进程命中即为真"，直接跑它会和同机 xiaoli 的真实构建混淆。
所以判据是：**把 `pgrep` 覆盖成只返回我们那一个 PID，再跑从文件里提取的真实逻辑**。

```
修复前 → BUSY（我们这条挡住全机回收）
修复后 → 不 BUSY（不再挡路）
```

生产日志佐证：

```
16:00:01 BUSY: 685122 … migrate-deploy.sh      ← 我们（修复前）
16:25:44 BUSY: 2185176 docker buildx build … xiaoli-build   ← 只剩真实构建
16:26:00 BUSY: 2185176 docker buildx … xiaoli-build
```

**剩下的 SKIP 是正确的**：xiaoli 确实在构建，守卫就该等它。

### 顺带回收

| 项 | 量 |
|---|---|
| 构建缓存（`docker builder prune`） | 1.101 GB |
| journald（压到 200M） | 176 MB |
| `~/heyta/.pnpm-store`（孤儿 store） | 211 MB |

那 16.17 GB 镜像**交给机器自己的脚本**在下个空窗回收 —— 它有明确安全边界
（只删**无引用**且**创建 >3 天**且**不在保留集**的镜像，**从不删卷**），
手动强推没有额外收益，反而会绕开 3 天保护窗。

---

## 11. 🔴 `heyta.finlaw.cloud` + `/opt/heyta-ci`：一条此前未记录的 heyta 生产线

**这不是残留，是在用的。** 2026-09-26 只读盘点发现：

| 资产 | 说明 |
|---|---|
| `/opt/heyta-ci` | **3.0 G**，GitHub Actions **self-hosted runner**，compose project `heyta-ci` |
| 容器 `heyta-ci-runner` | `Up` |
| 镜像 `heyta-ci-runner:local` | **3.12 GB** |
| nginx 站点 `heyta.finlaw.cloud` + 证书 | 09-26 15:37–15:48 创建 |

⚠️ **最容易误删的一条**：`ghcr.io/actions/actions-runner:latest`（2.15 GB、0 容器）
**不是可回收** —— 它是 `heyta-ci-runner:local` 的 **FROM 基镜像**，
Docker 会拒绝删有子镜像的父镜像。别把它当"无引用镜像"。

> 这份记录来自只读盘点，未做任何变更。清单见
> [`finlaw-cleanup-candidates.md`](finlaw-cleanup-candidates.md)。

---

## 12. 盘点纠正：这台机器上**没有** Mailu / SSOS / openpenpal / litopia

`ubuntu-jcli` 的 42 个容器实际归属（只读实测）：

| 归属 | 数量 |
|---|---|
| `xiaoli-*` 系 | 27 |
| 其他 finlaw 系（sub2api / minio / asset-inventory 等） | 12 |
| **heyta** | 3（`supersync-server`、`supersync-postgres`、`heyta-ci-runner`） |
| Mailu / SSOS / openpenpal / litopia | **0** |

上一节表格里"另有 xiaoli-* 等约 34 个容器"的表述容易让人误以为那些服务在这台上
—— 它们其实在 **sanjiaozhou**。以本表为准。

另外：**"反代指向空端口"一条都不存在**。15 个唯一 `proxy_pass` 目标全部有进程在听。
最容易误判的 `172.30.33.14:8080`（aistudy）实测是 `learning-preview-gateway`
在 ingress 网络上的**静态绑定 IP**（`IPAMConfig`），经 nginx 实测返回 200；
宿主直连超时只是因为 Caddy 不认 `Host: <IP>`。
