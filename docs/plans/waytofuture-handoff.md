# 交接：迁到 waytofuture.cn + 管理后台 + 邮件/凭据页中文化

> 状态：**全部已上线可用**（交还用户的三件事在 §3）
> 交接日期：**2026-09-30**（CST）
> 给**全新会话**用：不从聊天记录继承任何前提。每条都带可复现命令或实测输出。
>
> 🔴 本文只记**当前停在哪**，不重复已经定下来的决策与已有知识。那些在
> [`docs/adr/0038-admin-console-scope.md`](../adr/0038-admin-console-scope.md)、
> [`docs/plans/admin-console.md`](admin-console.md)、
> [`docs/runbooks/deployment.md`](../runbooks/deployment.md)（§3.7.2 / §3.9.1 / §3.9.2 / §3.12）、
> [`docs/research/ai-feature-completeness-audit.md`](../research/ai-feature-completeness-audit.md)
> 与 `AGENTS.md §9` 里。
>
> ⚠️ **工作区里有 417 个未提交改动，绝大多数不是本轮做的**（见 §7）。
> 接手前先读 §7，不要假设"看起来相关"的文件都是本轮的产物。

---

## 0. 一句话现状

**产品第一次真正跑在自己的域名上了**：`https://heyta.waytofuture.cn`（落地页 + 应用 + API + 凭据页），
另有一个 API 专用域名 `https://apiheyta.waytofuture.cn`。
运营面（管理后台）、邮件（三封）、凭据页（三张）**全部中文化 + 用设计系统 + 零渐变**，都已部署并线上验证。

一路上挖出并修掉 **4 个真缺陷**（§4），其中 2 个是**用户实测报障**才发现 ——
它们的共同形状是"**服务端渲染出来的东西看起来是对的，坏的是浏览器那一步**"。

---

## 1. 交付状态（事实，非推测）

| 面 | 状态 | 证据 |
|---|---|---|
| 站点域名 | ✅ `https://heyta.waytofuture.cn` | 落地页/应用/凭据页全 200；线上 HTML 里 `finlaw.cloud` 出现 **0** 次 |
| API 专用域名 | ✅ `https://apiheyta.waytofuture.cn` | `/`→200 JSON、`/health`→200、`/api/*`→反代、`/nope`→**404**；证书 `CN=apiheyta.waytofuture.cn` 至 **2026-12-29** |
| TLS（主域） | ✅ | `certbot` 证书至 **2026-12-29** |
| 同步服务端 | ✅ 容器 `healthy` | `supersync-server` / `supersync-postgres` 均 Up |
| 管理后台 | ✅ 已上线且**锁着** | `GET /api/admin/overview` 无令牌 → **401**；管理员 = 见 `docs/operations/icp-app-filing.values.local.md`（不入库；`admin.js list` 可查） |
| 邮件 | ✅ 中文优先、按语言切 | 线上日志 `Magic link login email sent [zh-CN]`；SES `DeliverStatus: 1` |
| 凭据页 | ✅ 三张都中文化 | 默认中文、`?lang=en` 英文、`gradient` 出现 **0** 次 |
| AI 完整度 | ✅ 审计完成 | [`docs/research/ai-feature-completeness-audit.md`](../research/ai-feature-completeness-audit.md) |

**测试与门禁（本轮结束时的实测）**

| 命令 | 结果 |
|---|---|
| `pnpm --filter @heyta/sync-server test` | **91 文件 / 1804 passed** |
| `pnpm --filter @heyta/web test` | 990 passed |
| `pnpm --filter @heyta/app-host test` | 739 passed |
| `e2e/live-site`（线上真浏览器） | **6/6 passed** |
| `check:server-design` / `check:server-copy` | 新增的两道门禁，已挂进 `pnpm check` |
| `check:migrations` / `check:design` / `check:ui-language` / `docs-link-check` | 全绿 |

⚠️ **`pnpm check` 整体不是 exit 0** —— 卡在两处**预存在**的红，见 §3。

---

## 2. 复现命令（每条独立）

```bash
# 线上验收（真浏览器打真域名；6 条）
cd e2e && npx playwright test --config=playwright.live-site.config.ts

# 服务端
pnpm --filter @heyta/sync-server test

# 两道新门禁（改了词条或设计 token 之后必须重跑生成）
pnpm --filter @heyta/sync-server gen:server-copy    # 从 packages/i18n 抽取
pnpm gen:server-design                             # 从设计系统抽 token
pnpm check:server-copy && pnpm check:server-design  # 校验漂移

# 管理后台
ssh ubuntu-jcli 'sudo docker exec supersync-server node dist/scripts/admin.js list'
```

---

## 3. 交还用户的三件事 / 当前卡在哪

| # | 事项 | 为什么卡住 | 怎么继续 |
|---|---|---|---|
| 1 | **ICP APP 备案「提交审核」** | 必须本人：勾三个同意项 + 视频核身 | 见 [`icp-app-filing.md`](../runbooks/icp-app-filing.md) §一。域名现在**真的通了**（备案要求填报域名指向已备案服务器 —— 这条已满足） |
| 2 | **`pnpm check` 的 e2e `motivation.spec.ts` 2 红** | **不是本轮造成**，已用对照实验证明（§6） | 见 [`BLOCKED.md`](../../BLOCKED.md) 第 1 条，里面写了排查顺序 |
| 3 | **`pnpm verify:i18n-failures` 4/91 红** | **不是本轮造成**（脚本锚点指向已被移动的文件 / i18n 多入口后 dist 结构变了） | 见 `BLOCKED.md` 第 2 条。⚠️ 那两组涉及的 `apps/web/src/features/sync/*` **当前有别的会话的未提交改动**，动它会撞车 |

**另外两件"已交还但已完成"的**（列在这里是因为下一个会话可能会问）：
- **授权管理员**：已完成（唯一管理员的邮箱记在 `docs/operations/icp-app-filing.values.local.md`，该文件不入库；`admin.js list` 可查当前值）
- **SMTP 切到 waytofuture.cn**：已完成（见 §4）

---

## 4. 本轮实际做好的东西（含判据）

### 4.1 迁到 `heyta.waytofuture.cn`

动因是**备案倒逼**（备案填报的就是这个域名，且要求它真的指向那台服务器），不是运维整洁。
全过程见 [`deployment.md`](../runbooks/deployment.md) §3.7.2。

顺带修掉一条**错误纪律**：`apps/landing/src/site/origin.ts` 原先写着"换域名时传 `VITE_SITE_URL`，
**不要改** `DEFAULT_SITE_ORIGIN`" —— **那是错的**。`check:entries`（`pnpm check` 的第一道门禁）
会用该常量重新生成入口页再与提交物**逐字节比对**，所以换域名必须**同时**改常量 + 重跑 `gen:entries`。
`og-card{,-en}.png` 同理（卡片右下角印的就是这个域名）。

### 4.2 `apiheyta.waytofuture.cn`（API 专用域名）

**应用继续走同源**（`/api/`），这个域名只作**对外**的 API 地址。
🔴 这么定是为了**不动通行密钥**：若应用也改调它（跨源），`WEBAUTHN_RP_ID` 必须退到父域
`waytofuture.cn`，那会让整个 `waytofuture.cn` 下所有子域共享同一套通行密钥命名空间
（**含同主体的另一个产品「晓黎学习」**）。

- nginx 配置在服务器 `/etc/nginx/sites-available/apiheyta.waytofuture.cn`
  （根路径返回自述 JSON、`/api/` + `/health` + `/live` 反代、**其余诚实 404**）
- ⚠️ 它在 `nginx.conf` 里被**显式 include**（第 70 行）—— 本机 nginx **不**自动加载 `sites-enabled`

### 4.3 运营管理后台（首版）

决策 [`ADR-0038`](../adr/0038-admin-console-scope.md)：**抄 SSOS 的模式、不抄它的页面**
（它那 42 个页面服务的是租户/税务/合规/Mailu，heyta 一个对应模型都没有）。
范围＝概览/用户/订阅/订单/优惠码/邀请 + **三个不碰钱的动作**（解锁、调配额、强制登出）。
权限＝单级 `users.is_admin`（默认 false，只能 CLI 授权）。落地清单见
[`admin-console.md`](admin-console.md)。

**授权命令（只能在容器里跑）**：
```bash
ssh ubuntu-jcli 'sudo docker exec supersync-server node dist/scripts/admin.js grant <email>'
```
⚠️ 镜像里是**编译产物** `dist/scripts/admin.js`（生产装依赖带 `--omit=dev`，**没有 ts-node**），
所以服务器上**不要**用 `pnpm admin:grant`。

### 4.4 邮件 + 凭据页：中文化 + 设计系统 + 零渐变

改前：三封邮件全英文 + 硬编码 `#3b82f6`；三张凭据页全英文 + **深色主题**（与 heyta 蓝白系完全不是一套）。
改后：中文默认、按收件人语言切、颜色/间距/字体全部来自设计系统、**零渐变**。
机制与判据全文见 [`deployment.md`](../runbooks/deployment.md) §3.9.2。

🔴 **真源只有一份，靠"生成物 + 门禁"搬到服务端**（`server/Dockerfile` 不打包 i18n / design-system）：

| 生成物 | 真源 | 生成 | 门禁 |
|---|---|---|---|
| `server/src/design.generated.ts` | 设计系统的 `generated/tokens.json` | `pnpm gen:server-design` | `pnpm check:server-design` |
| `server/src/copy.generated.ts` | `packages/i18n` 词条表（**只有 `server.` 前缀**） | `pnpm --filter @heyta/sync-server gen:server-copy` | `pnpm check:server-copy` |

**语言优先级**：`?lang=`（发信时写进链接）> `Accept-Language` > **默认 `zh-CN`**。

### 4.5 修掉的 4 个真缺陷

| # | 缺陷 | 谁发现的 | 判据 |
|---|---|---|---|
| 1 | **PWA 装出来的入口是落地页**（`SW_URL` 写死 `/sw.js` + manifest 根绝对路径，而应用挂在 `/app/`） | 本轮线上验收 | `apps/web/tests/pwa.spec.ts`（两处变异各自转红） |
| 2 | **验证失败页回显服务端原始错误** | 本轮 | `server-security.spec.ts` 的 `not.toContain('Invalid verification token')` |
| 3 | **魔法登录成功后跳落地页**（令牌只在应用启动时被消费 ⇒ 用户还得再点一次） | 本轮 | 现在跳 `/app/` |
| 4 | 🔴 **页内脚本放在 `<head>`，按钮点了完全没反应** | **用户实测报障** | 见 §6 |

---

## 5. 下一步（有序，第 1 条是主攻方向）

1. **修 `pnpm check` 的两处预存在红**（`BLOCKED.md` 两条都有排查顺序）。
   注意第 2 条涉及的 `apps/web/src/features/sync/*` 有别的会话的未改动 —— 先确认归属再动。
2. **管理后台的写操作**：首版**只读** + 3 个不碰钱的动作。
   改订阅 / 退款 / 发券 各自需要幂等键、审计记录、失败回滚，以及与 `billing/apply-event` 的协调
   —— 那是**独立的工作单元**，ADR-0038 §3.4 写明了为什么没有塞进首版。
   真要做审计级，需要一张 `admin_audit_log`，那时**新发一个 ADR**，不要悄悄加表。
3. **AI 审计里那 3 个缺口**（报告 §4）：受保护条目 `readable:false` 没有产品机制（最严重，
   压在入站 AI 的隐私承诺上）、"发特征不发原文"从未实现（文档债）、工具调用 P3/P4 未开始。
4. **ICP 备案提交**（等用户本人）。

---

## 6. 环境陷阱（本轮又踩了，`AGENTS.md §7` / [`environment-traps.md`](../reference/environment-traps.md) 有更全的一份）

### 6.1 🔴 `tar` 打包工作树会把 `server/.env` 一起带上服务器，覆盖生产配置

**是本轮踩的，代价最大的一次。** `deploy.sh` 的文档流程用 `git archive HEAD`（只打已跟踪文件
⇒ `.env` 天然不在包里）；我为带上未提交改动换成了对**目录**打 `tar`，于是把本机的 `server/.env`
一起带上并**就地覆盖了生产配置**（连 `JWT_SECRET` 都换了 —— 所有令牌与在途验证链接会失效，
且在容器重启之前**一声不响**）。

**正确写法**（`-o` 让未跟踪但未忽略的新文件也进包，`--exclude-standard` 排掉 `.env`）：
```bash
git ls-files -co --exclude-standard -- \
  pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json \
  packages/sync-core packages/shared-schema packages/domain server \
  | tar czf /tmp/heyta-server-src.tar.gz -T -
# 解包前自检：
tar tzf /tmp/heyta-server-src.tar.gz | grep -E '(^|/)\.env$' && echo '🔴 包里带了 .env，别用！'
```
已从 `.env.bak-20260930T063250Z` 恢复；**数据库未受损**（8 个用户可查）。

### 6.2 🔴 `deploy.sh` 会因 `caddy` 绑不上 :80 而以"启动失败"收尾 —— **那不是应用故障**

compose 栈里含 `caddy`，而本机 :80 被**宿主 nginx** 占着。迁移与 `supersync` 容器**都成功**，
脚本最后卡在 caddy 并以"启动失败"退出。收尾：`sudo docker rm -f supersync-caddy`（下次还会再造一个）。

### 6.3 🔴 页内脚本必须在 `</body>` 之前 —— 放 `<head>` 会让按钮"点了没反应"

**用户实测报障**：`magic-login-confirm.js:15 Uncaught TypeError: Cannot read properties of null (reading 'dataset')`。
根因：脚本放进 `<head>` 且**没有 `defer`** ⇒ 同步执行时 `<body>` 还没解析，`document.body` 是 `null`。

**修法两件一起做**：① 脚本移回 `</body>` 之前；② 脚本里加 `DOMContentLoaded` guard。
**判据**：`server-i18n-design.spec.ts`（挪回 head ⇒ 2 条转红）+ `e2e/live-site`（真浏览器断言无 `pageerror`）。

### 6.4 🔴 `pnpm check` 的 e2e `motivation.spec.ts` 2 红 —— **不是本轮造成**

**归因证据（对照实验）**：把本轮对 `apps/web/src/App.tsx` 的两行改动（一行 import + 一行 `<AdminPanel />`）
**临时撤掉后重跑，同样 2 红**。嫌疑来源是 `packages/ui/src/**` 那批**别的会话未提交**的 M3 共享 UI 迁移。

### 6.5 `tccli` 的 `waytofuture` profile 是 **oauth 凭证**，会过期

过期症状是 `AuthFailure.TokenFailure` + `refresh_user_token ... RefreshTokenError`。
重登：`tccli auth login --profile waytofuture`（会打开浏览器）。
⚠️ 2026-09-30 该 profile 指向的账号**已从 `100050003573` 变成 `100050005585`**（域名转移过去了）；
`default` profile **无权**操作 `waytofuture.cn` 的 DNS。

---

## 7. 交接时的工作区状态

🔴 **`git status` 有 417 个改动文件，其中绝大多数不是本轮做的** ——
`apps/desktop-*`、`packages/ui/src/**`（M3 共享 UI 迁移）等都有**别的会话的在途改动**。

**本轮新增（未跟踪）**：
```
docs/adr/0038-admin-console-scope.md
docs/plans/admin-console.md
docs/research/ai-feature-completeness-audit.md
server/prisma/migrations/20261003000000_add_admin_flag/migration.sql
server/src/admin/{admins,admin.middleware,admin.routes}.ts
server/src/{design-html.ts,design.generated.ts,copy.generated.ts}
server/scripts/{admin.ts,gen-server-design.mjs,gen-server-copy.ts}
server/tests/{admin-admins,admin-routes,server-i18n-design}.spec.ts
server/tests/admin-migration.pglite.spec.ts
packages/app-host/src/admin-client.ts + tests/admin-client.spec.ts
apps/web/src/features/admin/{store.ts,AdminPanel.tsx} + tests/admin-panel.spec.tsx
e2e/playwright.live-site.config.ts + e2e/live-site/
```

**本轮修改（挑要紧的）**：`AGENTS.md`、`PROGRESS.md`、`BLOCKED.md`、`package.json`、
`docs/plans/README.md`、`docs/runbooks/deployment.md`、`docs/reference/environment-traps.md`、
`packages/i18n/src/locales/{zh-CN,en}.ts`、`packages/app-host/src/index.ts`、
`server/src/{email,pages,server,api,auth,passkey}.ts`、`server/package.json`、
`server/public/{recover-passkey,magic-login-confirm}.js`、
`apps/web/src/{App.tsx,styles/app.css,pwa/register.ts,scripts/gen-pwa.mjs}`、
`apps/landing/src/site/{origin.ts,paths.ts}` + `scripts/gen-og-card.mjs`。

**服务器上（不在 git 里）**：
```
/etc/nginx/sites-available/heyta.waytofuture.cn      （主域）
/etc/nginx/sites-available/apiheyta.waytofuture.cn   （API 域）
/etc/nginx/nginx.conf                                 （第 69/70 行两条显式 include）
~/heyta/server/.env                                   （18 个键；域名与 SMTP 都已切）
~/heyta/server/.env.bak-20260930T063250Z              （改域名之前的完整生产配置）
```

---

## 8. 验收判据（"接手成功"长什么样）

```bash
# 1) 站点与 API 都在
curl -s https://heyta.waytofuture.cn/health
curl -s https://apiheyta.waytofuture.cn/health
curl -s https://apiheyta.waytofuture.cn/            # → {"service":"heyta-api",...}

# 2) 管理端点仍锁着（401 是**正确**状态，不是故障）
curl -s -o /dev/null -w '%{http_code}\n' https://heyta.waytofuture.cn/api/admin/overview

# 3) 凭据页默认中文、可切英文、无渐变
curl -s 'https://heyta.waytofuture.cn/magic-login?token=x' | grep -o '<h1>[^<]*</h1>'
curl -s 'https://heyta.waytofuture.cn/magic-login?lang=en&token=x' | grep -o '<h1>[^<]*</h1>'
curl -s 'https://heyta.waytofuture.cn/magic-login?token=x' | grep -c gradient   # → 0

# 4) 线上真浏览器 6 条
cd e2e && npx playwright test --config=playwright.live-site.config.ts
```

---

## 9. 相关资产（别重造）

- **部署与运维**：[`deployment.md`](../runbooks/deployment.md) —— §3.7.2（域名迁移）、§3.9.1（SMTP）、§3.9.2（邮件/页面机制）、§3.12（管理后台运维）、§3.5（生产环境变量清单）
- **管理后台**：[`ADR-0038`](../adr/0038-admin-console-scope.md)（决策）+ [`admin-console.md`](admin-console.md)（清单/判据/边界）
- **AI**：[`ai-feature-completeness-audit.md`](../research/ai-feature-completeness-audit.md)
- **备案**：[`icp-app-filing.md`](../runbooks/icp-app-filing.md)
- **门禁**：`check:server-design` / `check:server-copy`（本轮新增，已挂进 `pnpm check`）
- **线上验收套件**：`e2e/playwright.live-site.config.ts` + `e2e/live-site/live-domain.spec.ts`（6 条）
