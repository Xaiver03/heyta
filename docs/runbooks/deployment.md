# 运维与部署现状

> **最后实测：2026-09-27（CST）对 §3.7 与应用入口；其余章节仍为 2026-09-26 的实测。**
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
生产 `.env` 里只有 `JWT_SECRET` 和 `POSTGRES_PASSWORD` 是敏感值（✅ 实测，见 [§3.5](#35-生产环境变量清单)）。

---

## 1. 一页速览

| 机器 | SSH 别名 | IP | 跑什么 | 对外地址 | 状态 |
|---|---|---|---|---|---|
| **腾讯云 ubuntu-jcli** | `ubuntu-jcli`（别名 `finlaw`） | `124.223.13.226` | ✅ **heyta 公网部署**（supersync）；另有 xiaoli-* 等约 34 个容器、宿主机 nginx、mihomo | `https://heyta-tmp.litopia.space` | ✅ 在线，容器 healthy |
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
                     DNS: heyta-tmp.litopia.space  A 124.223.13.226   (RecordId 2419225598)
                                        │
                                        ▼
        ┌──────────────────────── ubuntu-jcli  124.223.13.226 ────────────────────────┐
        │  宿主机 nginx 1.18.0   :443 (TLS, certbot)  ──►  :80 → 301 https              │
        │      │                                                                        │
        │      ├── /app/       → alias /var/www/heyta-app/  (apps/web 静态产物)          │
        │      ├── /landing*   → 301 → https://heyta.finlaw.cloud/                       │
        │      └── /           → proxy_pass http://127.0.0.1:1900                        │
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

nginx 片段：`/etc/nginx/sites-available/heyta-tmp`，软链到 `/etc/nginx/sites-enabled/heyta-tmp`（✅ 实测）。

- ✅ `server_name 124.223.13.226 heyta-tmp.litopia.space;`
- ✅ 在 `/etc/nginx/nginx.conf` 第 **67** 行被显式 `include`（`include /etc/nginx/sites-enabled/heyta-tmp;`），
  紧跟在第 66 行 `xiangleideng.site` 之后。**这个 include 不是 `sites-enabled/*` 的通配**——
  它是逐行手写的白名单（60–67 行），所以新增站点必须手动加一行。
- ✅ `client_max_body_size 64m;`
- ✅ 反代块：`proxy_pass http://127.0.0.1:1900;`，带 `Upgrade` / `Connection: upgrade`（WebSocket）、
  `Host` / `X-Real-IP` / `X-Forwarded-For` / `X-Forwarded-Proto`，`proxy_read_timeout 90s` / `proxy_send_timeout 90s`。
- ✅ 另有 `/app`、`/app/`、`/app/assets/` 三段与 `/landing*` 三段（见 §3.7）。
  **`location /app/` 不匹配 `/app`** —— 所以 `/app` 单独有一条 `location = /app { return 301 /app/; }`。
  少了它，落地页的「立即使用」会把用户送到同步服务端的 JSON 404（实测踩到过）。
- ✅ **HTTP 行为（与线索不同，务必注意）**：
  - `http://heyta-tmp.litopia.space/…` → **301** 跳 `https://`（certbot 写的 `if ($host = …)` 块）。
  - `http://124.223.13.226/…` → **404**（certbot 块的兜底是 `return 404`）。
    **用裸 IP 访问不会跳 HTTPS，会 404。** ✅ 实测两次确认。
- ✅ certbot 追加的 HTTPS 块 + Let's Encrypt 证书（见下）。

### 3.4 证书与续期

- ✅ `certbot certificates`：

  | 证书名 | 域名 | 到期 | 剩余 |
  |---|---|---|---|
  | `heyta-tmp.litopia.space` | `heyta-tmp.litopia.space` | **2026-12-25 03:35:57 UTC**（= 11:35:57 CST） | 89 天 |

  同一台机器上还有 `ai.finlaw.cloud`、`aiconfig.finlaw.cloud`、`aistudy.finlaw.cloud`、`codex.finlaw.cloud`、
  `lingchuang.finlaw.cloud`、`sumei.finlaw.cloud`、`xcreative.finlaw.cloud`、`x.finlaw.cloud`、
  `x-creative.team`、`xiangleideng.site`、`yuanyuan.finlaw.cloud`。
- ✅ 文件：`/etc/letsencrypt/live/heyta-tmp.litopia.space/{fullchain.pem,privkey.pem}`；
  私钥**存在，位于**该目录（不在本文档抄写内容）。
- ✅ 自动续期：`certbot.timer`（systemd）已启用，下次触发 2026-09-27 05:54 CST，✅ 上次运行 2026-09-26 12:47。
  注意这是 **snap 之外的系统 certbot 1.21.0**（`snap.certbot.renew.timer` 在这台机器上不存在）。

### 3.5 生产环境变量清单

文件：`ubuntu-jcli:~/heyta/server/.env`（✅ 实测，只列键与非敏感值）。

| 变量 | 值 | 说明 |
|---|---|---|
| `NODE_ENV` | `production` | ✅ |
| `PUBLIC_URL` | `https://heyta-tmp.litopia.space` | ✅ |
| `CORS_ORIGINS` | `https://heyta-tmp.litopia.space` | ✅ |
| `DOMAIN` | `heyta-tmp.litopia.space` | ✅ 供 compose 的 caddy 服务用（当前没起） |
| `RUN_MIGRATIONS_ON_STARTUP` | `false` | ✅ 迁移由 `deploy.sh` / `migrate-deploy.sh` 显式跑 |
| `TEST_MODE` | `true` | ✅ 🔴 **生产环境开着测试模式，见 §7.4** |
| `TEST_MODE_CONFIRM` | `yes-i-understand-the-risks` | ✅ |
| `WEBAUTHN_RP_ID` | `heyta-tmp.litopia.space` | ✅ |
| `WEBAUTHN_RP_NAME` | `heyta` | ✅ |
| `WEBAUTHN_ORIGIN` | `https://heyta-tmp.litopia.space` | ✅ |
| `POSTGRES_USER` | `heyta` | ✅ |
| `POSTGRES_DB` | `heyta` | ✅ |
| `JWT_SECRET` | 🔒 **存在，值不抄** | ✅ 键存在 |
| `POSTGRES_PASSWORD` | 🔒 **存在，值不抄** | ✅ 键存在 |

compose 里还有一批**未在 `.env` 中设置、走默认值**的键（`HOST`、`SMTP_*`、`PRIVACY_*`、`ALLOWED_EMAILS`、
`SUPERSYNC_DEFAULT_STORAGE_QUOTA_BYTES`、`OLD_OPS_CLEANUP_*`、`POSTGRES_MEM_LIMIT` 等）。
它们不在 `.env` 里，就**没有生效**，由 `server/docker-compose.yml` 的默认值决定（如 `POSTGRES_MEM_LIMIT=1536m`）。

### 3.6 公网实测结果

| 请求 | 结果 | 来源 |
|---|---|---|
| `GET https://heyta-tmp.litopia.space/health` | `200` + `{"status":"ok","db":"connected","wsConnections":0}` | ✅ |
| `GET https://heyta-tmp.litopia.space/` | `200` | ✅ |
| `GET https://heyta-tmp.litopia.space/app/` | `200` `text/html`（`apps/web` 产物，`Cache-Control: no-cache`） | ✅ 2026-09-27 |
| `GET https://heyta-tmp.litopia.space/app` | `301` → `/app/` | ✅ 2026-09-27 |
| `GET https://heyta-tmp.litopia.space/app/assets/<hash>.js` | `200` `application/javascript`，`Cache-Control: max-age=31536000` | ✅ 2026-09-27 |
| `GET https://heyta.finlaw.cloud/` | `200`（落地页中文版） | ✅ 2026-09-27 |
| `GET https://heyta.finlaw.cloud/en/` | `200`（落地页英文版） | ✅ 2026-09-27 |
| `GET https://heyta-tmp.litopia.space/landing/` | `301` → `https://heyta.finlaw.cloud/`（**不再直接 200**） | ✅ 2026-09-27 |
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
| 公网地址 | `https://heyta-tmp.litopia.space/app/` |
| 静态根目录 | `/var/www/heyta-app/`（`ubuntu:ubuntu`） |
| 为什么放这个域名 | 与同步服务端**同源** —— 于是 `CORS_ORIGINS`、`WEBAUTHN_RP_ID`、`WEBAUTHN_ORIGIN` **一个字都不用改**，passkey 也能用 |
| nginx 片段 | `/etc/nginx/sites-available/heyta-tmp`（就是 §3.3 那个文件） |

#### 重新发布的两条命令

```bash
# 1) 构建：🔴 --base=/app/ 不能省
cd apps/web && pnpm exec tsc -b && pnpm exec vite build --base=/app/

# 2) 上传
rsync -az --delete apps/web/dist/ ubuntu-jcli:/var/www/heyta-app/
```

🔴 **`--base=/app/` 必须显式给。** Vite 默认 `base` 是 `/`，产物的资源引用是
**根绝对路径**（`/assets/…`）。挂在 `/app/` 下时浏览器会去请求
`https://heyta-tmp.litopia.space/assets/…` —— 而那个路径属于同步服务端
（`location /` → `proxy_pass 127.0.0.1:1900`），于是拿到 JSON 404，
现象是**控制台报样式表 MIME 是 `application/json`**、页面白屏。
落地页 2026-09-27 踩的就是同一个坑，`sites-available/heyta-tmp` 里那段注释就是为它写的。

#### 落地页上的入口：`VITE_APP_URL`

落地页的「立即使用 / Use it now」由**构建期变量** `VITE_APP_URL` 决定
（判据在 `apps/landing/src/lib/app-url.ts`）：

```bash
cd apps/landing && VITE_APP_URL=https://heyta-tmp.litopia.space/app/ pnpm exec vite build
rsync -az --delete apps/landing/dist/ ubuntu-jcli:/var/www/heyta-landing/
```

🔴 **不带这个变量重新构建落地页，入口会静默消失** —— 页面不报错，只是又变回
"只能自建"。仓库默认构建（无该变量）**是故意的**：应用还没部署时露出一个
「立即使用」，比没有入口更坏。

#### 变更前备份（回滚用）

- `/etc/nginx/sites-available/heyta-tmp.bak-20260927T124302Z`（加 `/app/` 之前）
- `/etc/nginx/sites-available/heyta-tmp.bak2-20260927T124707Z`（加 `/app` 重定向之前）
- `/var/www/heyta-landing.bak-20260927T124628Z`（旧落地页产物）

#### 验收方式：**必须用真浏览器**

`apps/web` 是客户端渲染的 SPA，落地页的 CTA 也是 React 渲染出来的 ——
`curl` 只能证明"文件在"，证明不了"点下去真的能打开应用"。本次用 `e2e/` 里的
Playwright 实测：中文页与英文页各两个入口都指向
`https://heyta-tmp.litopia.space/app` 且带 `rel="noopener noreferrer"`；
点「Use it now」→ 落在 `/app/`、`title=heyta`、`#root` 渲染出 14629 字符、
**无 pageerror / console.error**。

⚠️ 正是这一步抓到了一个 `curl` 抓不到的 bug：`appUrl()` 会去掉末尾斜杠，
而 nginx 的 `location /app/` **不匹配** `/app` —— 点链接（而不是手输 `/app/`）
的用户拿到的是 JSON 404。修法即 `location = /app { return 301 /app/; }`。

#### 还没做的

- **`heyta-tmp.litopia.space` 是临时资产**（§7.1 有清理清单）。这个入口今天是通的，
  **不是永久的**。换永久域名时只需改 `VITE_APP_URL` 并重跑上面两组命令。
- 从英文落地页点进去会到**默认中文**的应用（应用有自己的语言设置，页面上有
  English 切换）—— 落地页的 locale 没有传过去。
- 应用产物没走 CDN、没有 SRI、没有构建版本号注入；`/app/` 那段 nginx 是手工维护的。

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
| **`heyta-tmp`** | A | **`124.223.13.226`**（ubuntu-jcli） | **2419225598** | 2026-09-26 12:29:39 |
| `@` ×2 | NS | `library.dnspod.net.` / `fair.dnspod.net.` | — | — |

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

### 7.1 🔴 `heyta-tmp.litopia.space` 是**临时资产**

三件东西都是临时的，**用完应该清掉**：

1. **临时 DNS 记录**：`litopia.space` 下的 `heyta-tmp` A 记录，RecordId **`2419225598`**，TTL 600。
2. **临时证书**：Let's Encrypt `heyta-tmp.litopia.space`（到期 2026-12-25 03:35:57 UTC）。
3. **临时容器与镜像**：`supersync-server` / `supersync-postgres` 用的是本地构建的 `supersync:local`，
   `RUN_MIGRATIONS_ON_STARTUP=false`，`TEST_MODE=true`。它**不是**正式生产形态。

连带要清的：`/etc/nginx/sites-available/heyta-tmp` + `sites-enabled` 软链 +
`/etc/nginx/nginx.conf` 第 67 行那条**手写**的 `include`（通配不会替你删）+
`/var/www/heyta-app/`（`apps/web` 产物，§3.7）+ `/var/www/heyta-landing/`。

⚠️ 2026-09-27 的两次变更另外留下了三个备份，清理时要一并决定去留：

- `/etc/nginx/sites-available/heyta-tmp.bak-20260927T124302Z`
- `/etc/nginx/sites-available/heyta-tmp.bak2-20260927T124707Z`
- `/var/www/heyta-landing.bak-20260927T124628Z`

（同目录下还有 30+ 个更早的 `.bak-*`，见 §7.5。）

🔴 **注意这里的连带关系**：`heyta-tmp` 一清，§3.7 那个应用入口就断了，
落地页上的「立即使用」会指向死地址。所以清理时要么同时换掉 `VITE_APP_URL`
并重建落地页，要么把入口一起去掉 —— **不要只清一边**。

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

### 7.4 🔴 生产环境开着 `TEST_MODE=true`

✅ `ubuntu-jcli:~/heyta/server/.env` 里 `TEST_MODE=true` + `TEST_MODE_CONFIRM=yes-i-understand-the-risks`，
而 `NODE_ENV=production`。线索里没提这一条。**这是需要人拍板的事，不是本文档能改的。**

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
ssh ubuntu-jcli 'cat /etc/nginx/sites-available/heyta-tmp'
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
curl --noproxy '*' -sS -m 15 -w '\nHTTP %{http_code}\n' https://heyta-tmp.litopia.space/health
curl --noproxy '*' -sS -m 15 -o /dev/null -D - http://heyta-tmp.litopia.space/health   # 期望 301
curl --noproxy '*' -sS -m 15 -o /dev/null -D - http://124.223.13.226/health            # 期望 404

# 强制指定解析目标，绕开本机 fake-ip / 代理
curl --noproxy '*' -sS -m 12 -k --resolve litopia.space:443:101.34.250.109 -o /dev/null -w 'HTTP %{http_code}\n' https://litopia.space/
```

### 8.5 DNS（**只读，不要改**）

```bash
export PATH="$HOME/.local/bin:$PATH"
tccli dnspod DescribeRecordList --Domain litopia.space --output json
# 只看关键字段
tccli dnspod DescribeRecordList --Domain litopia.space --output json \
  | python3 -c 'import json,sys;[print(f"{r[\"Name\"]:<20}{r[\"Type\"]:<6}{r[\"Value\"]:<45}id={r[\"RecordId\"]}upd={r[\"UpdatedOn\"]}") for r in json.load(sys.stdin)["RecordList"]]'

# 判断域名到底解析到哪台机器：在远端查，别在本机 dig
ssh ubuntu-jcli 'getent hosts litopia.space mail.litopia.space heyta-tmp.litopia.space'
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
| 9 | heyta 生产 env 清单 | 基本吻合，但**多出 `TEST_MODE=true`**（线索没提），且 `POSTGRES_USER`/`POSTGRES_DB` 都是 `heyta` | `ssh ubuntu-jcli 'cat ~/heyta/server/.env'`（去值） |
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
