# `server/deploy/nginx/` —— 生产 nginx 站点的**版本化镜像**

## 这是什么，以及它**不是**什么

这里放的是**线上那台机器上真实生效的** nginx 站点文件的一份**逐字节副本**。

- ✅ 它是：**可 diff 的真源快照** —— 用来发现「服务器上偷偷改了、仓库里不知道」的漂移。
- ❌ 它不是：**部署源**。`deploy.sh` **不读这个目录**，也没有任何自动化会把它推上去。
  改这里的文件**不会**改变线上行为，除非你显式执行下面的 `--apply`。

**为什么要有它。** 2026-09-27 一天之内，光这一个域名就踩了**三次**同一类事故，
而三次都只存在于服务器上、仓库里查不到：

| 事故 | 现象 | 为什么差点漏掉 |
|---|---|---|
| `/health`、`/live` 没有 location | 掉进 `location /`，返回**落地页** | 状态码 200 |
| `/terms.html`、`/privacy.html` 没有 location | 同上，且与落地页**逐字节相同** | 状态码 200 |
| `/recover-passkey.js`、`/magic-login-confirm.js` 没有 location | 脚本返回到落地页 HTML | 状态码 200 |

三次的症状是同一个：**200，但内容是别的页面**。做 KYC / 上架审查、或只是点开看一眼的人，
看到 200 就走了。而这三次修改（以及更早的 `/app/`、`/assets/` 迁移）
**全部只发生在服务器上** —— 仓库里没有任何一处能回答"线上到底有哪些 location"。

这就是本目录存在的唯一理由：**让运维事实可被 diff，而不是靠人记得。**

## 当前版本化的文件

| 文件 | 线上路径 |
|---|---|
| `heyta.finlaw.cloud.conf` | `/etc/nginx/sites-available/heyta.finlaw.cloud` |

⚠️ **本机是显式 include 白名单**，不是 `sites-enabled/*` 通配：
`/etc/nginx/nginx.conf` 里逐行写着 `include /etc/nginx/sites-enabled/<name>;`。
所以往 `sites-enabled/` 里丢文件**不会**生效 —— 新增站点必须同时改 `nginx.conf` 的白名单。
（这也是为什么 `sites-enabled/` 里那 30+ 个 `.bak-*` 侥幸没被加载。）

⚠️ `heyta-tmp.litopia.space` 是**另一个**站点文件，**故意不合并**：
那份把 `location /` 整个代理到 1900（它要服务 Connect 页），
这份完全不碰它，所以改动这份不会影响那份。**别为了"统一"把它们合起来。**

## 用法

```bash
# 只看有没有漂移（不改任何东西）；有漂移时退出码为 1
server/scripts/nginx-sync.sh --check

# 把仓库里的版本装上去（先备份、先 nginx -t、通过才 reload）
server/scripts/nginx-sync.sh --apply

# 反向：把线上现状抓回来覆盖仓库副本（你直接在服务器上改过之后）
server/scripts/nginx-sync.sh --pull
```

`--apply` 与 `--pull` 都需要能 `ssh finlaw`。`--check` 同样需要，因为它要取线上文件来比对。

## 纪律

1. **在服务器上改完 nginx，必须 `--pull` 回来并提交。** 否则下次 `--check` 会报漂移，
   而那个报警本身会成为噪音 —— 一个总是响的警报等于没有警报。
2. **`--apply` 之前先 `--check`。** `--apply` 会用仓库副本**整体覆盖**线上文件；
   如果仓库副本是旧的，它会把今天的修复一起回滚掉。脚本会先备份，但不会替你判断。
3. 站点文件不含任何密钥（只有 Let's Encrypt 的**证书路径**）。可以安全提交。
   **不要把 `privkey.pem` 或任何口令放进这个目录。**

## 这不能替代什么

设置这些 location 的**原因**写在 `docs/runbooks/deployment.md` 里（§3.3.1 凭据页脚本、
§3.11 法律页）。这里只有配置本身；**为什么这么配**要看手册，
否则下次有人会"顺手"把它简化掉。
