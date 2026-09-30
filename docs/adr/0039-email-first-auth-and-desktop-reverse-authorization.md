# ADR-0039：鉴权走**邮箱链接全链路**（一条链接走完注册+登录）；桌面壳走**系统浏览器反向授权**；手机号通道**预留**

> 状态：**已接受**
> 日期：2026-09-30
> 相关：[ADR-0029](0029-refuse-to-delete-last-passkey.md)（最后一条通行密钥不许自助删除）、
> [ADR-0030](0030-passkey-not-found-existence-oracle.md)、
> [ADR-0036](0036-main-battlefield-and-rn-single-source-ui.md)、
> [ADR-0037](0037-desktop-ui-falls-back-to-webview.md)
> 过程账：[`../plans/desktop-storage-host-handoff.md`](../plans/desktop-storage-host-handoff.md) §6

---

## 1. 背景与约束

### 1.1 产品负责人的直接指令（2026-09-30）

> 「鉴权用系统浏览器吧，就是用我们的……应该是用浏览器来反向授权来登录。
> 本地为什么会要有通行密钥的登录呢？现在登录不应该是邮箱和密码登录吗？……
> **尤其是现在的注册登录，应该一定要走邮箱的全链路。**
> 然后**预留好手机注册登录的全链路**。」

### 1.2 量出来的事实（决定了结论，不是取舍）

| 事实 | 出处 |
|---|---|
| 壳里**通行密钥不可用**：带焦点 `uvpaa=false`；不带焦点 `NotAllowedError: The document is not focused` | `apps/desktop-macos/evidence/storage-host/webauthn-*.txt` |
| 壳里**没有深链**（无 `CFBundleURLTypes`、无 `application(_:open)`） | 全仓 grep 为空 |
| 页面 `heyta-local://app` 在 WKWebView 里**是**安全上下文，`PublicKeyCredential` 存在 | 同上 |
| 而**正常 https origin 上通行密钥好用**：Chromium 6/6，注入翻回 IP 字面量即红 | `apps/web/evidence/auth-journey/` |

### 1.3 现状的断点：邮箱链路是**两跳**，且第二跳在桌面壳无处可接

| 动作 | 邮件里的链接 | 点开之后 |
|---|---|---|
| 注册 `POST /api/register/magic-link` | `${publicUrl}/verify-email?token=…` → `verificationToken` | 页面**只把邮箱标记为已验证**，给一个"去应用"的链接 —— **不签发会话** |
| 登录 `POST /api/login/magic-link` | `${publicUrl}/magic-login?token=…` → `loginToken` | 确认页 POST `/api/login/magic-link/verify` → 页面把 JWT 写 `sessionStorage` → 跳 `/app/` |

⇒ 一个新用户**必须收两封邮件**（注册一封、登录一封）才能真正进去。
而 `requestLoginMagicLink` 又**要求 `isVerified=1`**（`server/src/auth.ts:357`），
所以这两跳的顺序还不能颠倒。**这是"邮箱全链路"真正要补的地方。**

### 1.4 密码这条路**不存在**（产品负责人要求"检查一下"，已查）

- 路由只有 `register/passkey/*`、`login/passkey/*`、`register/magic-link`、`login/magic-link`、`login/magic-link/verify`；
  **没有** `register/password` / `login/password`（`server/src/api.ts`）。
- `AuthPanel` 里**没有任何密码输入框**；`bcryptjs` **只**用在 `server/src/test-routes.ts`（TEST_MODE 造号）。
- `User.passwordHash` **存在但可空**，是遗留/未来字段。

⇒ 本 ADR **不**引入密码（那是另一件产品决定）。"完整注册机制"是有的，就是邮箱链接。

### 1.5 硬约束

1. 注册/登录**必须走邮箱全链路**（真发一封、点开、落到会话）。
2. 手机号通道**预留**，但**没有**真实短信网关 ⇒ 不许声称能用。
3. **一个规则只有一份实现**（本仓的既有纪律）：不得为"注册"和"登录"各写一套校验。
4. 老邮件里的链接**必须继续可用**（它们已经发出去了）。

---

## 2. 决定

### 2.1 一个校验核心 + 一个确认端点

新增 **`POST /api/auth/email/verify { token }`**，作为**唯一**的"邮箱链接换会话"入口。
它按**同一条实现**解析两种令牌：

| 令牌来源 | 语义 |
|---|---|
| `User.verificationToken`（注册那封） | 校验未过期 → **置 `isVerified=1`** → 签发 JWT |
| `User.loginToken`（登录那封） | 要求 `isVerified=1`（现状不变）→ 校验未过期 → 签发 JWT |

两者都返回 `{ token, user }`，并**消费**该令牌（一次性）。
失败一律返回**可判别但中性**的错误（不泄露"这个邮箱存不存在"）。

### 2.2 两封邮件、一个终点

- 邮件里的 **URL 路径保持不动**（`/magic-login?token=…`、`/verify-email?token=…`）——
  老邮件继续可用，这是 §1.5 的硬约束。
- 但两个页面渲染**同一个确认页**、POST 到 **§2.1 的那一个端点**。
  ⇒ **注册也是一次点击就进去**（不再需要第二封邮件）。

### 2.3 会话怎么落地（三条消费方，一个端点）

| 消费方 | 落地方式 |
|---|---|
| **web** | 确认页把 JWT 写 `sessionStorage['loginToken']` 再跳 `/app/`（沿用既有 `apps/web/src/features/auth/pending-login.ts`） |
| **macOS 壳** | **系统浏览器反向授权**：`ASWebAuthenticationSession` 打开同一个确认页，带 `client=desktop` + `state`；成功后回调 `heyta://auth#token=…&state=…`；壳校验 `state` 后把令牌交给**页侧既有**登录路径 |
| **Windows 壳** | 同上（等价物：系统默认浏览器 + 自定义协议回调），复用**同一个** `state` 校验与端点 |

🔴 壳**不再**自己做通行密钥（§1.2 已量出那条不可行）。壳只做两件事：
把浏览器打开到我们的站点、把回调里的令牌交出去。

**回跳的两条硬约束**（都落在 `apps/web/src/features/auth/desktop-handoff.ts`）：

1. **令牌放在 URL 的 fragment 里**（`heyta://auth#token=…&state=…`），**不进 query** ——
   `#` 之后不会发给服务器、不进 `Referer`、也不进任何一层的访问日志。
2. **没有 `state` 就不算桌面流程**：壳靠它判断"这个回调是不是我这次发起的那一个"。
   放行空 `state` 等于允许任意网页把令牌塞进壳。

**还要一个看得见的兜底入口**：程序化跳自定义 scheme 会被浏览器**静默拒绝**
（没装对应应用、或某些策略下），用户看到的是"点了登录，什么都没发生"。
所以应用在回跳前先挂一个**可点的链接**（「正在返回 heyta…」），再尝试自动跳。
它同时让"回跳地址对不对"这件事**可被断言**（不是测试钩子，是产品行为）。

**判定点只有一处**：`applyAuthSession`（`apps/web/src/features/auth/store.ts`）——
所有登录路径（通行密钥 / 邮箱链接 / 粘贴令牌）都汇聚到它，所以在它上面加一次判定
不会漏掉某一条路。⚠️ 邮件回跳那条也走它：`consumePendingLogin` **委托** `verify()`。

### 2.4 手机号全链路：**预留**，默认关闭，且"预留"本身可判

| 层 | 预留什么 |
|---|---|
| schema | `User.phone`（唯一、可空）、`User.phoneVerifiedAt`；验证码表（码的哈希、过期、尝试次数） |
| 接口契约 | `POST /api/auth/phone/request-code`、`POST /api/auth/phone/verify` —— 形状与邮箱那条**同构**（请求中性、码一次性、验完签发**同一个** JWT） |
| 开关 | `AUTH_PHONE_ENABLED`，**默认关** |
| 客户端 | `AuthPanel` 里预留入口位与 i18n key，开关关闭时**不渲染** |
| 文档 | 本节 + 计划文件里的落地清单 |

**预留的判据**（不是"写个 TODO"）：

1. 开关**关闭**时那两个端点必须**明确拒绝**（可判别的错误码），**不是** 404、也不是静默成功；
2. 开关**打开**时，契约测试能证明"请求 → 码 → 校验 → 签发 JWT"这条链**形状成立**
   （码由测试注入/读出，因为**没有真实短信网关**）；
3. 契约测试与邮箱那条**共用同一组断言**（同一个端点返回同一个 `{token,user}` 形状）。

### 2.5 不引入密码

见 §1.4。若将来要加，是**新**决定（涉及服务端路由、密码策略、找回流程、
以及 `passwordHash` 从"可空遗留"升为一等凭据的迁移）。

---

## 3. 后果与边界（如实写）

1. **没有短信网关**：手机号通道只能"预留 + 契约测试"，**不能**声称可用。
   自建实例若要真开通，需要先选供应商（阿里云/腾讯云短信等）并补 `SMS_*` 配置。
2. **老的 `/api/login/magic-link/verify`**：保留但**委托**给 §2.1 的同一核心
   （不许两份实现）。它已发出的邮件链接必须继续可用。
3. **`state` 是安全边界**：桌面壳回调必须校验 `state`，且**一次性**。
   不校验 = 任意网页都能把令牌塞进壳。
4. **自建 SMTP**：本地 `server/.env` 目前**没有** `SMTP_*`（实测 0 个键）⇒ 开发态走
   **Ethereal**（`server/src/email.ts` 的兜底，会打印 preview URL）。
   验收判据必须在**两种发送后端**下都成立：都是"读得到那封信"。
5. **老邮件的一次性**：注册令牌与登录令牌都是**一次性**的；消费后立刻失效。
   重发受既有上限（`MAX_VERIFICATION_RESEND_COUNT`）与限流约束。
6. 🔴 **注册确认页的文案暂复用** `verify.*` / `login.*`（贴切度一般：注册链接会说
   "完成这次登录"）。**这不是漏掉，是明确的跟进项** —— 专用 key 属文案改动，
   要同时改 zh-CN/en 并重生成 server copy（`check:server-copy`）。

---

## 4. 落地与判据（2026-09-30 第 1 轮）

| 落点 | 文件 |
|---|---|
| 唯一校验核心（三类令牌分流） | `server/src/auth.ts` 的 `verifyEmailLink` |
| 唯一签发会话实现 | `server/src/auth.ts` 的 `issueSession`（`verifyLoginMagicLink` 也改用它） |
| 统一端点 | `server/src/api.ts` 的 `POST /api/auth/email/verify`；**老的 `/api/login/magic-link/verify` 委托给它** |
| `/verify-email` 改成确认页（GET 不消费） | `server/src/pages.ts` |
| 确认脚本改调统一端点 + 处理 `verified-only` | `server/public/magic-login-confirm.js` |
| 判据（可复用） | `node scripts/verify-email-auth-chain.mjs`（= `pnpm verify:email-auth`） |

**绿**（`apps/web/evidence/email-chain/email-chain-pass.txt`）：
真发出一封信（Ethereal 兜底，**从预览页把信读回来**）→ GET 渲染确认页 →
`POST /api/auth/email/verify` 拿到 **`kind:'session'`** → 同令牌再用 401 →
库里 `is_verified=1` 且 `verification_token` 已清。

🔴 **红（注入）**：把 `/verify-email` 改回"**GET 就消费令牌**"（= 修之前的行为）⇒
第 ④ 步当场 **401**（`email-chain-INJECTION-get-consumes.txt`）。
⇒ 同一份判据在两种实现下给出相反结论，证明这次修复是**承重的**。

### 第 2 轮：桌面壳反向授权的 **web 侧**已验

| 落点 | 文件 |
|---|---|
| 意图解析 / 回跳地址 / 兜底入口 | `apps/web/src/features/auth/desktop-handoff.ts` |
| 唯一判定点 | `apps/web/src/features/auth/store.ts` 的 `applyAuthSession` |
| 单测（8 条） | `apps/web/tests/desktop-handoff.spec.ts` |
| 真浏览器端到端 | `e2e/auth-journey/auth-journey.spec.ts` 的 **J7** |

**绿**：`pnpm verify:web-auth` **7 passed**（J1–J6 + J7）——J7 打开 `/?auth=desktop&state=…`、
用通行密钥登录，断言兜底链接的 `href` 是 `heyta://auth#token=…&state=<原 state>`
且 **query 里没有 token**。人看过的截图：`auth-journey-8-desktop-handoff.png`
（底部就是那条「正在返回 heyta…」）。

**红（注入）**：① 拿掉 `readDesktopHandoff` 的空 state 守卫 ⇒ 单测"缺 state 不认"红；
② 拿掉 `applyAuthSession` 里的回跳钩子 ⇒ **J7 红**（兜底入口不出现）而 J1–J6 仍绿。

### 第 3 轮：桌面壳反向授权的 **macOS 壳侧**（逻辑验通，端到端卡住）

`HeytaShellCore/ShellAuth.swift`（纯逻辑：`state` 生成 / 授权起点 / 回调解析与校验）+
`HeytaMac/ShellAuthSession.swift`（`ASWebAuthenticationSession` 封装）+
`package-app.sh` 注册 scheme `heyta`（⚠️ 壳**第一次**对外承诺 URL scheme）。

**判据**：冒烟 6 条（合法回调接受 / **state 不一致拒绝** / 令牌在 query 里拒绝 /
别的 scheme 拒绝 / state 64 位 / 授权起点形状）；**注入**：拿掉 state 校验 ⇒
冒烟红「state 不一致竟然被接受了 —— 安全边界失效」。
壳里真喂错 state 的回调 ⇒ `AUTH_CALLBACK=rejected`（实测）。

#### ✅ 第 3 轮：端到端走通了 —— 并纠正两处

**壳侧反向授权现在端到端成立**（浏览器那一步用注入的回调代替）：

```
AUTH_CALLBACK=ok            ← state 校验通过、令牌交给页侧
AUTH_STATE=signed-in        ← 重载之后独立的菜单 IA 断言确认登录成立
```
错 state 的对照仍被拒。证据：`apps/desktop-macos/evidence/storage-host/shell-auth-*.txt`。

**纠正一（我上一轮的结论是错的）**：我曾把"`identity:0`"判成"壳的第二次 `load()` 挂不上应用"。
真因是**我自己**加的两个验证口子**没有"只跑一次"的开关** —— 它们都会重载页面，
而重载后首屏探针再次成功 ⇒ **无限重载循环**，症状与"壳加载不了第二次"一模一样。
加上一次性开关后同一实验立刻恢复。⇒ **验证口子自己也要被判据约束**。

**纠正二（真缺陷，已修）**：web 邮件回跳的**第二腿一直是坏的** —— 确认页存的是
**会话 JWT**，而应用拿它去 `/api/login/magic-link/verify` 当**一次性链接令牌**换 ⇒ **必然 401**，
失败又被 `consumePendingLogin` 吞掉（"点了链接回来还是未登录"）。修：确认页存原始链接令牌。
**没有任何测试覆盖它**（J1–J7 走通行密钥、`verify:email-auth` 只验服务端）。

**随之明确的契约**：`pending-login.ts` 现在有**两条分开的通道** ——
`loginToken`（一次性链接令牌 ⇒ 去服务端换）与 `sessionToken`（**会话本身**，壳交付 ⇒ 直接采用，
内部仍复用同一个 `applyAuthSession`）。回跳 URL 也带上 `email`。

web 套件 1003 通过、服务端 1806 通过、冒烟全绿。

### 第 4 轮：补上「确认页 → 应用」这条腿的判据（**当前红**）

新增 `scripts/verify-email-web-chain.mjs`：真浏览器 + **真邮件**，走**生产同源拓扑**的本地复刻。
它已经验过：UI 注册 → 真发一封 → 链接 → 确认页 → 点击 → **POST 200** → 落到 `/app/` 且应用挂载。
🔴 **但"应用最终登录成立"这一格是红的** —— 而这条腿**从来没有测试盯着**，
所以它坏了很久（§4 第 3 轮那段）没人发现。

**已收窄**：应用侧采用是好的（隔离探针：预置 `sessionToken` 重载 ⇒ 凭据落盘 ✓）；
而完整链路里落地时 `sessionStorage` 是空的 ⇒ 确认页**没写**、或写的与应用读的**不是同一套键**。
**未定位**，是下一轮的第一件事。

⚠️ 连同一条**判据自身**的坑：用 `res.text()` 读那次 POST 的响应体会被随后的导航取消，
`.catch` 一吞就只剩"(没抓到)" —— 看起来像"根本没发请求"。改成**同步记状态码**才看见 200。

⚠️ **尚未验**：真实 SMTP（本机走 Ethereal）、**Windows 壳**、手机号通道（预留）。
