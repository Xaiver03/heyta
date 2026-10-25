# `server/deploy/caddy/` —— 线上 Caddy 站点片段的**版本化镜像**

## 这是什么，以及它**不是**什么

这里放的是线上 `/etc/caddy/sites.d/` 里**属于 heyta 的那几片**的逐字节副本：

| 文件 | 管的东西 |
|---|---|
| `sites.d/00-heyta.caddy` | 主域 `heyta.waytofuture.cn`：落地页、`/app/`、`/admin`、`/api/`、托管 AI 上游、凭据页、品牌 404 |
| `sites.d/01-heyta-api.caddy` | `apiheyta.waytofuture.cn`：只给 `/api/*` 与健康检查 |
| `sites.d/02-heyta-legacy.caddy` | 旧域整站 301、临时域、裸 IP 入口 |

- ✅ 它是：**可 diff 的真源快照** —— 用来发现「服务器上偷偷改了、仓库里不知道」的漂移。
- ❌ 它不是：**部署源**。没有任何自动化读这个目录；改这里的文件**不会**改变线上行为，
  除非显式跑 `server/scripts/caddy-sync.sh --apply`。

## 为什么又多出一份（不是和 `server/deploy/nginx/` 重复）

因为**这一域名现在不由 nginx 服务**。2026-10-24 起边缘是 `caddy-edge`
（`ssh finlaw 'ss -ltnp | grep :443'` 现量），`nginx.service` 是 masked，
于是 `/etc/nginx/sites-available/*` 与 `server/deploy/nginx/` 那一份镜像**双双变成死配置**。

这一课不是新的：ADR-0054 §落地动作 3 逐字记过「改边缘配置前先 `ss -ltnp | grep :443`
看是谁在监听」，2026-10-25 上线 `/admin` 时又踩了一遍 —— 因为当时计划里写着
「最后一步 `nginx-sync.sh --apply`」。所以这一份存在的理由与 nginx 那份**完全相同**
（见 `../nginx/README.md`：一天之内三次「HTTP 200，但内容是别的页面」，
而修改只存在于服务器上），只是换了个真的在服务的边缘。

## 三档怎么用

```sh
server/scripts/caddy-sync.sh --check   # 默认。只比对，有漂移退出 1
server/scripts/caddy-sync.sh --pull    # 线上是对的：抓回仓库，然后必须提交
server/scripts/caddy-sync.sh --apply   # 仓库是对的：逐片备份 → 整份校验 → 过了才 reload
```

🔴 **三条不许忘的**：

1. `--apply` 只碰名字匹配 `*heyta*.caddy` 的片。`sites.d/` 是**多产品共用**目录，
   整目录覆盖会打掉别人的站（`00-heyta.caddy` 文件头写着同一条纪律）。
2. 校验用的是 `/usr/local/bin/caddy-edge`，**不是** PATH 上那枚 `caddy`：
   后者没编进 `rate_limit` 模块，会在别人的 `21-originxspace.caddy` 上报
   `unrecognized directive: rate_limit`，把一份好配置量成坏的（2026-10-25 实测）。
   要换二进制就设 `HEYTA_CADDY_BIN`，别改脚本里的默认值。
3. 校验的是**整份** `/etc/caddy/Caddyfile`（`sites.d` 是被 import 进去的，
   单片自洽不等于整体自洽）；不过就**全部还原**且不 reload。

## 改线上站点的正确顺序

先在本目录改 → `--apply`（它自己会打备份名）→ 线上验收
（`cd e2e && npx playwright test --config playwright.live-site.config.ts`，
`live-admin-entry.spec.ts` 与 `live-manifest.spec.ts` 都钉在这一枚边缘上）。
**不要**直接在服务器上改完就走 —— 那正是这一份镜像要防的事；
万一已经改了，跑 `--pull` 并把它提交回来。
