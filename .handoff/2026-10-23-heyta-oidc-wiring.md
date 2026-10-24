# heyta 接中央 OIDC —— 交接文档

> 写给接手这件事的 agent。
> 起因：线上 `https://heyta.waytofuture.cn` 登录显示「Central sign-in is temporarily unavailable」，
> 落地页 live-site 验收 4 条红（注册协议 ×2、登录入口 ×2）。
>
> **一句话结论：凭证早就齐了、中央侧早就注册好了、连 secret 文件都在服务器上了。
> 唯一缺的是 heyta 自己的服务端没有读它 —— 因为它的环境变量里一个 `HEYTA_OIDC_*` 都没有。**

---

## 一、先纠正三个错误前提

上一轮排查得出过三个错误结论，别再走一遍：

| 错误结论 | 事实 | 证据 |
| --- | --- | --- |
| 「需要向中央身份方索取 issuer/clientId/clientSecret」 | **不需要。三样早就给你了** | `heyta/.central/credentials.env` 里 `CENTRAL_OIDC_*` 四行齐全，注释写着「已注册」 |
| 「中央侧还没注册 heyta 客户端」 | **已注册，且 `active=true`** | 中央库里 `platform_auth_clients` 有 `heyta` 行，`confidential=true`、`hash_set=true`、`rotated=true` |
| 「凭证要写进服务器 `.env` 里」 | **secret 的正确位置是文件，不是 env** | 见第四节；`OIDC_CLIENT_SECRET_DIR/heyta` 已在位，43 字节，sha256 与库里 hash 逐字相同 |

---

## 二、凭证在哪（本机，已固定）

**路径：`heyta/.central/credentials.env`**（也就是
`/Users/rocalight/Desktop/All in one Data/01_PROJECTS/heyta/.central/credentials.env`）

权限 `0600`，已 gitignore，**不要提交、不要贴聊天、不要下发前端**。

与本任务相关的四行：

```bash
CENTRAL_OIDC_ISSUER=https://waytofuture.cn/api/oidc
CENTRAL_OIDC_CLIENT_ID=heyta
CENTRAL_OIDC_CLIENT_SECRET=<43 字符，见文件>
CENTRAL_OIDC_REDIRECT_URI=https://heyta.waytofuture.cn/api/auth/oidc/callback
```

同目录 `README.md` 是短版说明。**注意**：那份 README 里「## OIDC 还没注册」一节
已经过期（写它的时候确实没注册）。实际已注册，以本节为准。

### 已核验的一致性

- 本地 secret 长度 43 字节
- 服务器 `/srv/xiaoli-platform/env/identity-client-secrets/heyta` 也是 43 字节
- 本地 `sha256(secret)` = `96945de4441ca7e40d8c5634bdf9e6b60523181acc3c03be9850d1408c5348a7`
- 中央库 `platform_auth_clients.heyta.clientSecretHash` = **同一个值**

三重对上，说明这把钥匙就是当前生效的那把，不需要轮换。

---

## 三、中央侧现状（已核实，不用再动）

| 项 | 状态 |
| --- | --- |
| 中央身份服务容器 | `xiaoli-identity-identity-1`，`Up (healthy)` |
| issuer | `https://waytofuture.cn/api/oidc` |
| discovery 端点 | 正常返回（含 ES256 / authorization_code / PKCE S256） |
| `heyta` 客户端行 | `active=true`、`confidential=true`、`clientSecretVersion=1` |
| `redirectUris` | `https://heyta.waytofuture.cn/api/auth/oidc/callback`<br>`https://heyta.finlaw.cloud/api/auth/oidc/callback` |
| `audiences` | `heyta.app` |
| `allowedOrigins` | `https://heyta.waytofuture.cn` |
| secret 文件 | `/srv/xiaoli-platform/env/identity-client-secrets/heyta`（640，2026-10-23 18:18 写入） |
| `OIDC_CLIENT_IDS` | 含 `heyta`（在容器 env 里，第 9 个） |

**中央侧无需任何改动。** 不要动 `OIDC_CLIENT_IDS`、不要改 redirectUris、不要重新生成 secret。

---

## 四、真正要做的：给 heyta 服务端配上七件事

### 4.1 服务端在哪

- 宿主机：`ubuntu-jcli`（也就是 `finlaw`）
- compose 目录：`/home/ubuntu/heyta/server/`
- `.env`：`/home/ubuntu/heyta/server/.env`（0600，已存在，**当前没有任何 `HEYTA_AUTH_*` / `HEYTA_OIDC_*`**）
- 容器：`supersync-server`
- compose 文件：`docker-compose.yml` + `docker-compose.monitoring.yml` + `docker-compose.build.yml`

### 4.2 代码契约（`server/src/central-auth/config.ts`）

必须**全设或全不设**，设一半会抛错。六个变量来自凭据，第七个自己生成：

| 变量 | 值 | 说明 |
| --- | --- | --- |
| `HEYTA_AUTH_DEPLOYMENT` | `official` | 只接受 `self-hosted` / `official` |
| `HEYTA_AUTH_MODE` | `oidc` | 配 `official` 时必须是 `oidc`（见 tests） |
| `HEYTA_OIDC_ISSUER` | `https://waytofuture.cn/api/oidc` | 必须 https |
| `HEYTA_OIDC_CLIENT_ID` | `heyta` | |
| `HEYTA_OIDC_CLIENT_SECRET` | 见 `.central/credentials.env` | 服务端专用 |
| `HEYTA_OIDC_REDIRECT_URI` | `https://heyta.waytofuture.cn/api/auth/oidc/callback` | 必须与登记逐字符一致 |
| `HEYTA_OIDC_SESSION_ENCRYPTION_KEY` | **需新生成** | ≥32 字符，且**不得等于 `JWT_SECRET`**（`config.ts` 会显式拒绝） |

生成第七个：

```bash
openssl rand -base64 48
```

### 4.3 compose 是白名单（这一步最容易漏）

`docker-compose.yml` 里 `supersync-server` 的 `environment:` 是**显式列举**的。
往 `.env` 里写了键但没在 compose 的 `environment:` 里列出来，**等于没写** ——
容器里根本看不到。

所以顺序是：**先改 `.env`，再改 compose `environment:`，最后 `up -d`。**

### 4.4 重启

```bash
cd /home/ubuntu/heyta/server
sudo docker compose up -d supersync-server
```

---

## 五、验收（四条，缺一不可）

```bash
# ① 配置端点不再返回 local
curl -s https://heyta.waytofuture.cn/api/auth/central/config
# 期望：{"mode":"oidc",...} 且 documentVersion 非 null
# 之前是：{"mode":"local","loginPath":"/api/auth/oidc/start","documentVersion":null}

# ② 授权端点活着（缺参数应 400，不是 500）
curl -s -o /dev/null -w '%{http_code}\n' 'https://waytofuture.cn/api/oidc/auth'

# ③ 未登录授权请求应 303 并带 Location
curl -s -o /dev/null -D- "https://waytofuture.cn/api/oidc/auth?client_id=heyta&redirect_uri=https://heyta.waytofuture.cn/api/auth/oidc/callback&response_type=code&scope=openid&state=x&code_challenge=x&code_challenge_method=S256" | grep -i '^location'

# ④ 走一遍真实登录（浏览器），确认能回来并建起本地会话
```

然后复跑 live-site 验收，之前那 4 条红（注册协议 ×2、登录入口 ×2）应当转绿。

---

## 六、踩过的坑（别再踩）

1. **`/app/api/...` 会被 SPA fallback 吞成 index.html** —— heyta 的 web 挂在 `/app/` 下时，
   API 必须打**根** `/api/...`，不要带 `/app` 前缀。本次核查确认 URL 层目前是对的（相对路径解析到根）。
2. **`mode` 由 runtime 决定**：`mode: runtime ? 'oidc' : 'local'`，runtime 由 env 决定。
   配好 env 一切自愈，不要改代码。
3. **四端同一条契约**：桌面端内嵌同一套 web 认证面板，移动端共用 `@heyta/app-host`。
   服务端配好，四端同时恢复，不需要分别改。
4. **别去改中央**。中央侧全部健康，问题 100% 在 heyta 服务端这一侧。
5. **别把 secret 写进 `.env` 明文就以为完事** —— `.env` 存的是 heyta **读到的**那段；
   中央侧的 secret **文件**（`/srv/xiaoli-platform/env/identity-client-secrets/heyta`）已经是好的，不要重写。

---

## 七、本机各产品仓路径（已固定）

产品代码都在本机，都在 `/Users/rocalight/Desktop/All in one Data/01_PROJECTS/` 下，
每个仓库下都有 `.central/credentials.env`：

| 产品目录 | git remote | `.central` OIDC client id |
| --- | --- | --- |
| `heyta/` | `git@github.com:Xaiver03/heyta.git` | `heyta` |
| `home/` | `git@github.com:Xaiver03/home.git` | `home` |
| `openpenpal/` | `git@github.com:Xaiver03/openpenpal.git` | `openpenpal-web` |
| `ssos/` | `https://gitee.com/dengxiadeng/ssos.git` | `startup-os-web`（即**创业OS**） |
| `litopia12/` | `https://github.com/Xaiver03/litopia12.git` | （未登记） |
| `originx-web/` | `git@github.com:Xaiver03/originx-web.git` | （未登记） |

> `WunoOS/` **不在上表**：它是**合作产品**，不是我们的产品。它的 remote 是
> `github.com/aidenwlf/WunoOS`（非 `Xaiver03`），且与 `ssos` 共用 `startup-os-web`
> 的同一把 secret 与同一回调。**我们的产品只有创业OS**。若要给 WunoOS 独立身份，
> 那是合作方的事，需另行注册，不属于本仓产品清单。

⚠️ **已知待办**：`litopia12`、`originx-web` 还没有 OIDC 登记
（`.central/credentials.env` 里没有 `CENTRAL_OIDC_*` 段）。
要接登录得先提供精确回调地址给中央登记。

中央接入总文档：`../x-c/docs/integration/central-services.md`

---

## 八、这件事之外的背景（避免误解）

- 中央**不做登录页、不接管会话**。它只回答「这个人是谁」。
  heyta 的登录界面和会话仍然归 heyta 自己。
- heyta 服务端代码**不在** x-c 仓里，它在服务器 `/home/ubuntu/heyta`；
  本机副本是 `01_PROJECTS/heyta/`（remote 指向 GitHub）。
- 上一轮 x-c 侧的会话已经把**中央身份服务的客户端管理面**做了一半：
  `services/identity/src/oidc/admin/client-admin.js`（`POST /api/oidc/admin/clients`）。
  那是「以后怎么加新客户端」的工具，**与修好 heyta 登录无关**，
  本次不需要碰它，也不要因为看到它没提交就以为本任务没做完。
