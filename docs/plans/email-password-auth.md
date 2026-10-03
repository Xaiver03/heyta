# 邮箱 + 密码登录：落地计划

> 状态：**进行中**（2026-10-01 立）。W1–W5 与 W6a–W6c 已落地并各自成组提交：服务端口令认证核心、
> 四类令牌哈希化、找回/改密/全设备登出、第四张凭据页 `/reset-password`、线协议契约与 app-host 宿主端口、
> `packages/ui` 共享认证表单（41 条 DOM 判据 + 12 条变异）。
> 🔴 **还没落地的三块**：Web 接入（`AuthPanel` 变薄壳）、四端钥匙串（W7）、
> 文档改写与链式验收（W8/W9）—— 各自的现状与为什么卡着写在 §7 末尾的「进度」段。
>
> **归属**：本篇是 [`user-journey-and-auth.md`](user-journey-and-auth.md) 的**下游工单**，只负责"密码"这一条认证方法。
> A1–A8 的服务端语义、各端宿主形态、J1–J7 判据**仍以那份为准**；本篇需要它改的地方列在 §10。
> 决策落点：**[ADR-0040](../adr/0040-email-password-auth-decoupled-from-e2ee.md) 已成文**（取代
> [ADR-0039](../adr/0039-email-first-auth-and-desktop-reverse-authorization.md) §1.4/§2.5 里
> "本 ADR 不引入密码……若将来要加，是新决定"那一段）。**本篇 §2 是它的底稿，结论以 ADR 为准**；
> ADR 只增不改 —— 落地过程中与本篇不一致的地方记在下面 §3 的「落地勘定」，不改写上面的原表。

---

## 0. 产品负责人的原话与要求

> "邮箱密码登录**一定要做**。我们现在 SMTP 应该都有了。按最好的 UI/UX 来，你可以搜一下这方面应该怎么做。"

已拍板的三个岔路（2026-10-01）：

1. **登录密码与 E2EE 口令解耦**，口令首次输入后写进**系统钥匙串**；
2. 范围是**全套**：注册 / 登录 / 改密 / 找回 / 全设备登出 / 防爆破 / 泄露口令拦截 / 令牌哈希化；
3. 界面走 **单邮箱字段「继续」+ 密码为主**，passkey 收进 autofill 与二级链。

---

## 1. 现状（实测，不是文档结论）

| 事实 | 证据 |
|---|---|
| **生产里没有密码登录，连"用密码注册"都没有**。`server/src/auth.ts` 里**零** bcrypt/密码代码，建号一律 `passwordHash: null` | `auth.ts:613`、`passkey.ts:311` |
| 唯一的密码实现是 TEST_MODE 的 `POST /api/test/create-user` —— 而且它**只建号发令牌，没有"校验密码"这条路** | `test-routes.ts:34-117`（bcrypt `:55`） |
| `users.passwordHash` 是**已存在的可空列**，`resetPasswordToken` / `failedLoginAttempts` / `lockedUntil` 四列 + 索引都在，但**没有任何生产路由写过它们** | `schema.prisma:16,21-22,27-28` |
| `failedLoginAttempts` 全仓**只被清零、从没递增**；`lockedUntil` 只被后台读来显示"锁定"，只有运营 `POST /users/:id/unlock` 会清 | `auth.ts:457`、`admin.routes.ts:108,406-416` |
| 🔴 **真缺陷：验证/登录/找回令牌明文入库、按值查询** ⇒ 一次数据库读等于全站账号接管 | `auth.ts:96,147`（`where: { verificationToken: token }`） |
| **登录凭据与 E2EE 口令已经彻底解耦**：口令只在客户端内存，服务端从不接收；JWT 不参与任何密钥派生 | `sync-client/src/client.ts:637,796,828`、`packages/sync-core/src/encryption/argon2.ts:203`、`server/docs/architecture.md:155` |
| 口令今天**四端都不落盘**，移动端每次冷启动都要重输 | `apps/web/src/features/sync/credential-storage.ts:16-17`、`apps/mobile/src/sync/config.ts:15-23` |
| E2EE 的 KDF 已经是 Argon2id `t=3/m=64MiB/p=1`，**高于 OWASP 最低值** | `packages/sync-core/src/encryption/argon2.ts:11-15` |
| SMTP 生产可用且实测真投递（腾讯云 SES `heyta@waytofuture.cn:465`，`DeliverStatus: 1`） | [`deployment.md`](../runbooks/deployment.md) §3.9 / §3.9.1 |
| `@fastify/rate-limit` 已注册，但是**全局 500/15min、内存态、单进程**；TEST_MODE 下整体跳过 | `server.ts:417-421` |
| 落地页与帮助中心**正在宣传"没有密码"** —— 本轮会让这三句话变成假的 | `packages/i18n/src/locales/zh-CN.ts:2571,2645,2994` + 生成的 `apps/landing/docs/account/index.html` |

> ⚠️ 因为 heyta 还在开发阶段、没有存量用户（AGENTS §0），**"兼容在途凭据"不作为约束**：
> 令牌形态从明文换成哈希、以及把已发出的验证链接全部作废，都是可以直接做的。

---

## 2. 五条架构裁决（ADR-0040 的正文）

### D1 登录密码**只用于认证**，不参与 E2EE 密钥派生

服务端存 `Argon2id(口令, salt, secret = pepper)` 的**校验值**（pepper 走 Argon2 原生
`secret` 参数、参与哈希，**不是拼在口令前后** —— 见 D3 与 W0 实测），口令继续由客户端本地派生（`encryption/argon2.ts:203`）。

**为什么不解成一把**（Proton/Bitwarden 那种"主密码同时是 vault 根"）：那是体验最优解，但**必须同时上恢复码**，
否则"忘记密码 = 数据永久不可达"（Cryptomator 官方原话："We cannot reset the password of a vault for you in any way"）。
解耦之后：**重置密码不会毁任何数据**，口令丢失的风险面和今天完全一样、没有新增。
代价是用户要理解两个秘密 —— 这一条由 §5 的术语与帮助页正面处理，并靠 D2 把"每次重输口令"的痛点消掉。

**方向仍是合流**：WebAuthn 的 **PRF 扩展**能让 passkey 直接派生 E2EE 密钥（Bitwarden 已经这么做），
本轮不做，登记见 §10 第 4 条。

### D2 口令进**系统钥匙串**（web 除外）

| 端 | 机制 | 依据 |
|---|---|---|
| macOS 壳 | `SecItemAdd`（壳已有钥匙串能力位） | [`user-journey-and-auth.md`](user-journey-and-auth.md) §4 |
| Windows 壳 | Credential Manager `CredWrite` / `PasswordVault` | 同上 |
| iOS / Android | `expo-secure-store`（MIT，57.0.4，**2026-09-29** 发版） | 🔴 **不用 `react-native-keychain`**：MIT 但停在 2025-03-23（19 个月），按 §3.1 排除 `cal-heatmap`（停在 2024）的同一先例应判不合格。这同时**关闭**该计划 §8 未核实项 3 |
| node-host | 复用 `apps/node-host/src/keychain-secret-store.ts`（现在只给 AI BYOK 用） | 已存在 |
| **Web** | **不假装**：token 进 `localStorage`，口令仍只在内存 | `credential-storage.ts:16-17` 的既有承诺 + `e2e/auth-journey` 断言 |
| Linux 壳 / 鸿蒙 | 不做专项（Linux 定位是"同架构但不做专项功能"；RNOH 无 secure store） | AGENTS §1 |

> 🔴 **这一条会改既有裁决的措辞**：`user-journey-and-auth.md` §7 第 4 条写的是"不把 E2EE 口令落盘（其余端沿用）"，
> 而 §4 的表却给移动端指定了 Keychain 并写"绝不明文落盘"。两句在字面上打架。
> 精确化后的规则（§10 去改）：**不得以可读形式落盘；允许 OS Keychain / Keystore / Credential Manager 这类加密托管；Web 例外，仍只在内存。**

### D3 哈希算法：Argon2id + pepper + PHC 自描述串

- 参数取 OWASP 最低值 `m=19 MiB, t=2, p=1`（`@node-rs/argon2` 的默认即此，MIT，2026-09 发版）。
- 存 **PHC 模块化串**（`$argon2id$v=19$m=…$salt$hash`）进已有的 `passwordHash` 列 ⇒ **不需要新列、不需要 bump schema**。算法/成本跟着哈希走，将来升级参数时按前缀分派验证，并在**登录成功时重算**以抬升工作因子。
- **pepper**（`PASSWORD_PEPPER`，env，不进库；缺失即启动失败，与 `JWT_SECRET` 同一纪律）：
  🔴 **不做 HMAC 预哈希**，而是把它**作为 Argon2 原生的 `secret`（密钥）参数**直接传进 KDF。
  预哈希存在的理由是绕开 bcrypt 的 72 字节截断，而 Argon2 对输入长度没有限制 —— 绕一步只会多一处能写错的地方。
  W0 已实测：`@node-rs/argon2`（原生）与 `@noble/hashes`（纯 JS）在**带 `secret` 与固定 salt** 时输出**逐字节相同**，
  所以 pepper 是**参与哈希的秘密**，不是拼在口令前后的字符串。
- 🔴 **不用 bcrypt**，也不沿用 TEST_MODE 的 `bcryptjs`：bcrypt 非内存硬、有 72 字节截断（与 NIST "≥64 字符、禁止静默截断"冲突），而绕过截断要先做预哈希 —— OWASP 明确说裸 `bcrypt(H(pw))` 是危险的（空字节碰撞 + password shucking）。**footgun 比直接用 Argon2id 多。**
- 🔴 **不留 scrypt 退路**（原计划的兜底已被 W0 实测作废）：musl 预编译产物在**生产形状**里逐字节正确（见 W0-1）。
  留两条哈希族意味着同一句口令在两台服务器上可能解不开，而"降级"恰恰发生在运维最忙的时候。
  替代它的是**启动 known-answer 自检**：用固定口令/salt/pepper 跑一次，PHC 串与裸摘要必须等于钉死的字节，
  不等或抛错 ⇒ **启动即退出**并打印绑定缺失。宁可起不来，也不要"能起、第一次登录就 500"。
- **并发闸门**：Argon2 太贵 ⇒ 登录洪水会打成自伤 DoS。哈希并发限制在 `cpus-1`（自写 ~20 行信号量，不引依赖）。

### D4 SRP / PAKE **本轮不做**（被本仓库自己的门槛拦掉）

SRP 是"服务端永远拿不到可重放的秘密"的正解（Proton 自 2016 起全部登录、1Password 用它 + Secret Key），
但 Node 生态里 `srp-js` / `node-srp` / `secure-remote-password` / `oprf` **最后发版全停在 2022-05/06**，
AGENTS §3.1 一票否决。协议的形式化分析 2023 年才补齐（IACR 2023/1457），自研等于自己养一个协议。
**结论**：走 D1 的"服务端只存校验值 + wrap key 独立派生"，它拿到 SRP 的大部分收益而不背它的维护债。

### D5 爆破与撤销：禁用"密码认证器"，不永久锁号

- 已有列**真正用起来**：失败递增 `failedLoginAttempts`；达 **5 次** ⇒ 写 `lockedUntil = now + 15min`，
  期间**只拒绝密码认证**，magic-link 与 passkey 照常（NIST SP 800-63B §3.2.2 的立场是限制该 authenticator，
  而不是锁死账号 —— 锁死账号等于把合法用户交给攻击者做 Denial-of-Account）。
  ✅ 运营侧的出口**已经存在**：`POST /api/admin/users/:id/unlock`（`admin.routes.ts:406`），复用，不新建。
- 路由级 `config.rateLimit`（10/15min per IP）**叠加**在账号计数之上。全局 500/15min 是内存态单进程 ⇒ 多副本需共享 store，登记为边界。
- **撤销**：改密 / 重置 / 后台强制登出 ⇒ `tokenVersion++`；它已经 gate 每一条 JWT 且 `auth-cache` 以它为键
  （`auth.ts:291`），所以**这正是 Entra 式的"所有已连接设备都要重新认证"**，不需要新机制。
- 🔴 客户端在 `tokenVersion` 失效后的行为是**产品要求**，不是边缘情况：**停止上传、本地数据继续可读、界面提示"重新认证"、绝不自动清库**（口令在本地，数据不该因为一次改密变得不可读）。列为 W0 探针 4 与 J8。

---

## 3. 线协议（服务端）

🔴 契约**补进 `packages/shared-schema`**（新文件 `auth-http-contract.ts`）：今天全部 auth 的 zod 只活在
`server/src/api.ts:40-212`，而密码长度/规则要在服务端与四端一致 —— §3.5 的教训是"两份实现必漂移"。
新增文件是纯可加，**不 bump `CURRENT_SCHEMA_VERSION`**（它只管 op/snapshot）。

| 方法 | 路径 | 请求 | 响应 | 说明 |
|---|---|---|---|---|
| POST | `/api/register/email-password` | `{email, password, termsAccepted: true}` | **202** `{message}` 中性 | 建号（设 `passwordHash`，`isVerified=0`）+ 发验证邮件。A2 原样保持：已存在则同码同文案、**不写任何东西**；`termsAccepted` 是 `z.literal(true)`（A4），UI 必须用户自己勾 |
| POST | `/api/auth/email/verify`（**复用** `api.ts:1170`，不造第二条入口） | `{token}` | `{kind:'session', token, email, baseUrl}` \| `{kind:'verified-only'}` | 账号**已设密码** ⇒ 验证即发会话（延用 ADR-0039 的"验证即登录"）；魔法链接/passkey 账号仍回 `verified-only` |
| POST | `/api/login/email-password` | `{email, password}` | **200** `{token, email}` \| **401** 同码同文案 | 账号不存在 / 密码错 / 已锁定 **全部回同一个 401**。不存在账号也要跑一次 Argon2 校验（对固定 dummy hash），**对齐耗时**（OWASP 要求 identical response time） |
| POST | `/api/password/forgot` | `{email}` | **202** 中性 | 单用 `SHA-256(token)` 存进已有的 `resetPasswordToken` 列，TTL **15min**（与 `auth.ts:25` 的魔法链接一致）；按账号限流 3/小时 |
| POST | `/api/password/reset` | `{token, password}` | **202** 中性 | 成功 ⇒ 写新 hash、清 token、`tokenVersion++`、**发安全通知邮件**、🔴 **不发会话**（OWASP 明说 don't auto-login after reset。这与 ADR-0039 的"验证即登录"**故意不一致**，理由写进 ADR-0040：重置发生的那一刻正是高风险时刻，且这条路径的终点本来就该是登录页） |
| POST | `/api/password/change` | Bearer `{currentPassword, newPassword}` | 200 `{token}` | 当前设备换新会话**不中断**，其余设备因 `tokenVersion++` 掉线 |
| POST | `/api/passkeys/*`, `/api/login/magic-link*` | 不变 | 不变 | 🔴 **一条都不许改语义**。`passkey.ts:691` 现在靠 `if (user.passwordHash)` 决定"这是不是纯 passkey 账号" —— 密码上线后这个分支会把"设过密码"的账号误判，**必须在 W1 里重新定义**（见 §9 变异 6） |

令牌哈希化（D4 的配套，同一刀做完）：`verificationToken` / `loginToken` / `passkeyRecoveryToken` /
`resetPasswordToken` 四列**一律改存 SHA-256 hex**，按哈希查（已有 `@@index` 直接可用）。
配一条清理迁移（一条语句、无 CONCURRENTLY，先跑 `node scripts/check-migrations.mjs`）把现存非空 token 置 null —— 在途链接全作废，15 分钟 TTL，可接受。

### 落地勘定（2026-10-01，代码写完之后回读）

🔴 **上面那张表是设计时的预测，下面这几条是实际形状 —— 以代码为准**（`server/src/api.ts` 的
`passwordAuthResponseOf` 是状态码与文案的**唯一**收口处，四端只按 `code` 取词条）：

| # | 计划原写 | 实际落地 | 为什么要改 |
|---|---|---|---|
| 1 | 注册 **202** | **201** + 同一句中性文案 | 202 是"已接受、尚未处理"，而这条路**账号当场就建好了** —— 那个码在描述一件不存在的事。防枚举由**文案**承担（已占用邮箱回同一句"去看收件箱"且不写任何东西，`registerWithMagicLink`），不需要把状态码压成一个不描述任何事实的值 |
| 2 | 找回密码 **202** 中性 | **恒 200**，🔴 **连服务端异常也回 200 + 那句中性话**（不是 500） | 这条与 `/reset`、`/change` 的 500 兜底**故意不同**，差别在请求里含不含身份：那两条"这次是服务端坏了"不泄露任何人；**这条含**。只要"账号存在且口令认证器正常"是唯一能走到写库的路，一次异常（库抖、超长邮箱、并发）就会把响应分成 200/500 两堆 —— 攻击者**不需要猜口令**，制造一次失败就能把这条接口变回预言机。**中性设计只看得出文案，泄露却发生在状态码上** |
| 3 | 登录回 `{token, email}` | `{token, user: {id, email, locale}}` | 与 `/login/passkey/verify` **同形**，客户端不为这条路演第二套接线（响应里永远不含 `passwordHash`，由 J12 逐字段钉住） |
| 4 | 改密回 `200 {token}` | `200 {token, user}`，且是**读回来的**新号 | `tokenVersion` 是全局计数器，bump 之后手上那枚同时失效；不换新号等于"改个密码把自己的这个标签页也踢出去" |
| 5 | 找回"按账号限流 3/小时" | **一张链接还没过期就不再发第二张**（拿那一行 `reset_password_token_expires_at` 当状态，`password/recovery.ts`）；IP 侧 50/15min | 不需要计数器列、不随 TTL 漂移，而且把"连点三次"的动机（前两次没收到）直接消掉。**这条改动来自实现时发现形状更简单，不是为了迁就既有表** |
| 6 | 表里没给 `/reset`、`/change` 的数 | `/reset` 30/15min、`/change` 10/15min | `/change` 最紧：它已经带着有效会话，滥用它的人本来就有口令 |
| 7 | 未验证账号"给可区分提示" | 403 + `email_not_verified`（**不是 401**） | 401 的语义是"你没证明你是谁"，而这里口令**验对了**；报 401 会让通用 HTTP 层去重放认证。锁定期用 **429 + `Retry-After`**（不是 423），哈希后端过载用 **503 + `Retry-After`**（从队列数学推出秒数，不是拍的） |

🔴 **长度门槛的数据源也换了**：§4 写"退化用 `@zxcvbn-ts/core` 4.2.0 的 dictionary"，实际只装
**`@zxcvbn-ts/language-common@4.1.3`**（MIT）—— 那是一张**纯词表**，`core` 一个都没进，
于是"把分数当门槛"在依赖层面**结构上不可能发生**（而不只是"我们约定不用"）；
命中判据是**整串精确匹配**（`password/policy.ts`，49 233 条）。HIBP 超时同步更正：
**2000 ms**（W0 探针 2 的实测上界，原写 1s 会把一半以上有用的查询在结果回来前砍掉），
fail-open 且**必须留一条 warn** —— 没有它，"检查通过"与"根本没检查成"事后不可区分。

---

## 4. 密码策略与泄露口令拦截

下面这份清单**除长度下限外**按 NIST SP 800-63B Rev 4 执行：

- **允许空格、全部可打印 ASCII 与 Unicode**，每个 code point 计 1 位；**长度上限 256**（要求 ≥64）；**不做任何 composition 规则**；**不要求定期改密**；**不做 hint / 密保问题**。
- 输入**不做 normalize**（不 casefold、不 trim 中间空格），但**统一 NFKC** —— 否则 macOS/iOS 键盘可能给出 NFD 串，同一密码在两端字节不同。**顺带查 E2EE 口令有没有同一问题**（W0 探针 5）：如果没有，跨设备输入某些口令会解不开密文，那是一条独立的真缺陷。
- **黑名单优先于强度计**：整串比对常见口令表，命中就拒并**说明原因**。
  - 数据源：`api.pwnedpasswords.com/range/<前 5 位>` 的 k-匿名 range API（SHA-1 前 5 位出网，完整哈希与密码都不离开服务器；HIBP 官方就是给 SP 800-63B 用的），服务端调用，**超时 1s、fail-open**。
  - 🔴 **不能假设国内服务器可达**（生产在腾讯云 `124.223.13.226`）。W0 探针 2 实测；不可达 ⇒ 退化为本地常见口令表（`@zxcvbn-ts/core` 4.2.0，MIT，2026-08，只用它的 dictionary，**不把它的分数做成门槛**），并在 ADR 里写明这条退化。
- **不做红框式强度条**：NNG 推荐，但 Troy Hunt 论证它会推着用户做"P@ssw0rd1!"式的糟糕选择，OWASP/NIST 也偏好长度 + 黑名单。取舍：长度下限 + 黑名单 + 一句"长句比符号有用"。

### 已拍板（2026-10-01，产品负责人）

1. **长度下限 = 8 个字符**（原话："密码最少 8 位吧，就是 8 个字符"）。
   🔴 这是对 NIST Rev 4 的**有意偏离** —— 它对**单因子**口令的要求是 **SHALL ≥15**，8 只在对口令**加盐**（即多因子）时成立。
   因此下面的补偿项从"建议"**升级为必须**，缺一即打回：常见口令黑名单、泄露口令拦截（HIBP k-匿名）、按账号失败锁定（D5）。
   ADR-0040 必须**如实写明这条偏离与它的补偿**，**不许**把产品描述成"符合 NIST 800-63B"。
2. **未验证账号给可区分提示**（未被否决 ⇒ 按本计划默认执行）："请先点击我们发到你邮箱的验证链接"。
   边际泄露是"该邮箱已注册且未验证"，理由是刚完成注册的人必须能自救；对照 ADR-0030 里 passkey not-found oracle 的既有先例写进 ADR-0040。

---

## 5. UI/UX 规范（逐条带来源；这是"按最好的来"的落点）

1. **一个入口、一个邮箱框**。单字段 + 「继续」，密码框紧随其后 —— FIDO 的 UX 研究结论：一个 affordance 同时管注册与登录，比"注册藏在登录之后"更可发现。
   入口位置**不改**（仍是头像菜单第一项，`user-journey-and-auth.md` §3.1）。
2. **passkey 从大按钮降级为文字链 + 浏览器 autofill**。🔴 这是对现状（`AuthPanel.tsx:352` 的大 passkey 按钮）的**偏离**，依据是 FIDO 2023 UX Guidelines：autofill 成功率最高，而"专用 passkey 按钮"因人们记不得自己建过而没有被发现，**建议避免**。登录成功后再引导创建 passkey（`hosted-auth.ts:933 beginPasskeyEnrollment` 已有）。理由要写回 §3.2。
3. **autofill 属性是功能，不是装饰**：邮箱 `autocomplete="username webauthn"`，登录密码 `current-password`，注册/改密 `new-password`，验证码 `one-time-code`（web.dev / Apple 密码自动填充文档）。**判据直接断言 DOM 上的这些值。**
4. **显隐**：桌面默认遮 + "显示密码"**复选框**；移动默认显示 + "隐藏"（NNG《Stop Password Masking》与 NIST 一致）。真 `button` + `aria-pressed`，图标用 **Lucide**（§5：不许 emoji）。
5. **不做**：禁用直到表单合法（NNG：禁用按钮让人困惑）、点提交后禁用按钮（用 in-flight guard + busy 态，保持焦点）、caps lock 提示（NIST 的答案是显隐开关）、逐击键校验（走 blur/submit；GOV.UK 也说密码的即时校验证据不足）。
6. **错误必须是文字**：WCAG SC 3.3.1 要求识别错误靠文本而不是仅红框；`aria-live` 播报；**保留用户已输入的内容**；焦点移到第一个错误（GOV.UK 校验模式）。
7. **文案定稿**（OWASP 反例→正例，中英各一条词条）：
   - 登录失败：`登录失败：邮箱或密码不正确。` / `Sign in failed; Invalid email or password.`
   - 找回：`如果该邮箱已注册，我们会发送重置链接。` / `If that email address is in our database, we'll email a link to reset your password.`
   - 注册：`我们已向该邮箱发送验证邮件。`
   - 🔴 状态码也必须一致（不同状态码本身就是泄露，OWASP 明确点名）。
8. **设计系统**：新组件一律 `cssVar()`、文字走 `TEXT_STYLES` 整条、`:focus-visible` 不许 `outline:none`、**暗色主题必须实际切过去看**（§5 的四条老错，本轮全都会撞上）。
9. **§7 #80 仍在**：浮层里 autoFocus 的输入框会吞掉冒泡阶段的 Esc ⇒ 键盘监听挂**捕获**阶段。
10. 🔴 **本轮最大的认知风险是两个秘密**，必须正面命名：i18n 拆两条独立词条 **「登录密码」** 与 **「加密口令」**，绝不共用一个"密码"字样；帮助中心**必须新增一页**讲两者区别与"口令丢了数据不可达"。
    ⚠️ 口径受 `check:docs-voice` 约束：`Argon2` / `AES-GCM` / `向量时钟` 在**用户文档**里是黑名单 —— 帮助页只说行为：「我们只保存不可逆的校验值，看不到你的密码」。
11. **移动端现状要改名**：`AuthScreen.tsx:110-113` 现在把**口令**字段叫 `password` 并放在凭据表单里。改成两步（登录凭据 → 加密口令），并把 `scripts/check-mobile-settings.mjs:86-90` 的 `CREDENTIAL_KEYS` 断言一起改掉（它会红）。
12. 🔴 **不许写四份表单**。新 UI 落进 `packages/ui` 的共享认证组件（`user-journey-and-auth.md` §10.3 的"目标形状"），各端只做宿主壳 —— 这就是 §10.1 欠着的"组件那一半"，本轮顺手交付。写四份等于重犯 §3.5 那个"抽了新版、旧版从没删"的错。

---

## 6. 邮件（第 4 封 + 第 4 张页）

`server/src/email.ts` 现在恰好三个模板（`:119` 验证 / `:142` passkey 找回 / `:165` 魔法链接登录），
`server/src/pages.ts:48,136,197` 三张页。新增：

- `sendPasswordResetEmail` → `${PUBLIC_URL}/reset-password?token=…`，`withLocale` 带上语言；当时语言优先级链不变（`?lang=` > 账号 `locale` > `Accept-Language` > `zh-CN`，`design-html.ts:76-99`）。⚠️ **2026-10-03 起 `Accept-Language` 那一档已删**，现在是 `body.locale` > 账号 `locale` > `zh-CN`（拍板口径见上面 `5-confirm-page` 那行）。
- 第 4 张页 + `server/public/reset-password-confirm.js`（新密码 + 显隐 + 提交后**不自动登录**，直接跳登录页文案）。
- 🔴 **真源仍只有一份**：文案进 `packages/i18n` 的 `server.*` 词条 → `server/scripts/gen-server-copy.ts` 生成 `copy.generated.ts`；色值走 `generated/tokens.json` → `design.generated.ts`。**只搬 light**。改完必须重跑生成，否则 `check:server-copy` / `check:server-design`（都挂在 `pnpm check`）红。
- 第 6 封（可选，但 OWASP 要求）：**密码被改后的安全通知**，复用同一套模板骨架。

---

## 7. 实施顺序

| # | 工作 | 依赖 | 完成判据 |
|---|---|---|---|
| **W0** | **五个探针，不写产品代码** | — | 见下 |
| **W1** | 服务端认证核心：Argon2id+pepper+PHC、`/register/email-password`、`/login/email-password`、dummy-hash、账号失败计数与 `lockedUntil`、并发闸门；并重新定义 `passkey.ts:691` 那个 `passwordHash` 分支 | W0-1 | `server/tests/*` 全绿 + §9 变异 1/2/3 各自转红 |
| **W2** | 令牌哈希化（四列 SHA-256）+ 清理迁移 | W0-3 | `auth.ts:96,147` 不再有按明文值查询；库里 grep 不到 token 明文 |
| **W3** | 找回 / 改密 / 全设备登出 | W1,W2 | §9 变异 4/5 |
| **W4** | 第 4 封邮件 + 第 4 张凭据页 | W3 | `check:server-copy`/`check:server-design` 绿 + 真 SES 收到并点开 |
| **W5** | `shared-schema/auth-http-contract.ts` + `hosted-auth.ts` 新函数 | W1 | 契约测逐字段钉字节 |
| **W6** | **共享认证组件**（§10 欠的组件那一半）+ Web 接入 | W5 | `e2e` 真浏览器 + 截图**人真的看过**（§6.2 规定一）+ 暗色 |
| **W7** | 移动端两步表单 + 四端钥匙串（mac/win/iOS/android） | W5 | 每端一条"写入 → 杀进程 → 读回 → 能解密同步" |
| **W8** | ADR-0040 + §10 的文档勘误清单 + i18n 三处"没有密码"改写（zh/en）+ `gen:entries` | W6 | `check:entries` exit 0 + `docs-link-check` 无死链 + `check:ui-language` |
| **W9** | 链式验收 + `pnpm reinstall:all` 四端重装 | 全部 | §8 全绿 + 每端"装上的是当前产物"判据（§6.1.1） |

### 进度（2026-10-02 回读代码；上一版是 2026-10-01，那条"只完成一半"已过期）

- **W0–W5 ✅ 全部落地**（服务端口令核心、四类令牌哈希化 + 清理迁移、找回/改密/全设备登出、
  第 4 张凭据页 `/reset-password`、`shared-schema/auth-http-contract.ts` 契约与 app-host 宿主端口）。
- **W6 ✅ 整条闭合**：`apps/web/src/features/auth/AuthPanel.tsx` 已变薄壳（它自己那套 DOM 已删，
  现在渲染 `@heyta/ui` 的 `AuthForm`），口令注册/登录在界面上**可达**；
  DOM 级判据在 `apps/web/tests/auth-form.spec.tsx`（**48 条**）。
  真浏览器一腿见下面「W6e 人眼复核记录」。
- **W7 ✅ 移动端两步表单已接**（`apps/mobile` 的 `AuthScreen` 走同一个共享表单），
  四端钥匙串（J16）**仍未做** ⇒ 🔴 **"口令不用每次重输"这句话仍然不许对用户说**（ADR-0040 §7 第 1 条）。
- **W7b ✅ 已判定**：node-host CLI 与 Electron 壳的认证入口按各自结论落地/登记为缺口。
- **W9 ✅ 链式验收在跑，🔴 但两条入口还没进 `HEAD`**：`pnpm verify:password-chain`
  （`scripts/verify-email-password-chain.mjs`）与 `pnpm verify:email-auth` 两条**在库里**；
  `pnpm verify:email-web`、`pnpm verify:password-web` 两条**只在当前工作树里** ——
  `6a5f03c8`（2026-10-02 19:14）把它们从 `package.json` 摘了出去（上一笔整文件 add 误收了
  并行会话的在途行，摘出是对的，但那两行的作者是本条线，**还没有自己提交**）；
  而 `scripts/verify-password-web-journey.mjs` **根本不在 `HEAD` 里**（`git cat-file -e` 实测失败）。
  ⇒ **干净检出上这两条命令走不通**。落地动作：提交这两行 + 那个脚本 + `e2e/password-web/` 的截图证据。
  ⚠️ 原句"`check:script-snapshot` 对账过"即将失去依据：那个门禁正被并行会话删除
  （索引里有 `D scripts/check-script-snapshot.mjs` 与 `package.json` 里从 `check` 链摘掉它）。
  🔴 同一条"没进库"也适用于 journey 门禁：`scripts/check-journey-coverage.mjs` 里把
  `e2e/password-web/password-journey.spec.ts` + `scripts/verify-password-web-journey.mjs`
  登记为**真实入口**那一处**是未提交的改动**（`git status` = ` M`；`HEAD` 版里 `password-web` 0 命中），
  所以"转正"这件事目前的载体仍是工作树。
- **W8 🟡 仍缺一半**：ADR-0040 已成文；**未做**的是 i18n 三处"没有密码"改写（zh/en）+ 帮助页
  新增一页讲「登录密码」与「加密口令」的区别与"口令丢了数据不可达"（§5 第 10 条）+ `gen:entries`。
  这三样和隐私同意那条并行工单改的是**同一批落地页产物**，排在它后面做。

### W6e 人眼复核记录（2026-10-02，AGENTS §6.2 规定一）

载体：`pnpm verify:password-web`（真服务端 + 真 SMTP 假端点 + 真 Chromium，**2 passed**），
7 张截图落在 `apps/web/evidence/password-web-journey/`（固定文件名）。**七张全部打开看过**：

| 截图 | 看到了什么 | 结论 |
|---|---|---|
| `1-register-revealed` | 注册态、口令**明文可见**（眼睛切换已按下）、策略提示在字段下方 | ✅ 符合 §5（显隐可切 + 就地提示） |
| `2-register-policy-error` | 弱口令被拒，红色策略提示在**对话框顶部**；口令框里是 `123`，框**下方只有灰色提示**，没有「还没有填密码。」 | ✅ 矛盾 caption 已修（见下「登记 1」的拆分）；🟡 剩下的就是登记 1 那条设计观察 |
| `3-register-submitted` | 「注册申请已提交。去邮箱点开那条验证链接」+ 邮箱行 + 改邮箱 | ✅ 成功态与可修正入口并存 |
| `4-email-not-verified` | 「密码是对的，只差最后一步…」 | ✅ 反枚举 + 不指责用户，文案按 D5/§5 落地 |
| `5-confirm-page` | 服务端渲染的确认页是**英文**（`Confirm your email`） | ~~✅ **排除，不是缺陷**：`server/src/pages.ts:48` 的 `localeOf` 走 `resolveLocale(?lang, Accept-Language, 默认 zh-CN)`，Playwright 默认发 `en-US` ⇒ 英文是**设计行为**~~ 🔴 **这条"排除"是错的，2026-10-03 撤回并重开**：错在它把**探针导航的那个 URL**当成了用户点开的 URL。spec 里取链接的正则写到 `token=[0-9a-f]+` 就停，把发信时写进去的 `&lang=zh-CN` **截掉了** —— 真实收件人点的那条永远带语言。两层都修了：① 探针取整条链接，并钉「链里的 `lang=` == 界面 `<html lang>`」+「确认页的 `<html lang>` == 界面语言」；② 产品负责人同日拍板「默认中文，英文只能是用户自己选的」，于是服务端把 `Accept-Language` 整档**摘掉**（`design-html.ts` / `api.ts` 的 `localeFromRequest`、`localeForEmail`），三条反向判据各做过一次变异（把浏览器头加回去 ⇒ 恰好三条红）。中英两个方向仍由 `server/tests/server-i18n-design.spec.ts` 钉着 |
| `6-signed-in-light` / `7-signed-in-dark` | 登录后回到收集箱，亮/暗两版都正常，主蓝在位 | ✅ 暗色不是反相（§5 那条） |

**看过之后被推翻的一条怀疑（玻璃面）**：`e2e/test-results/glass-account-menu-light.png` 里我以为
"侧栏文字在面板盒子里仍然锐利"，即 `backdrop-filter` 只是计算样式上的存在。
用同一次运行里的三张同区域裁剪图判定（探针为一次性脚本，已删）：

| 读法 | 数字 |
|---|---|
| A = 真玻璃（blur 20） | 面板区域内**没有任何**身后导航字 |
| B = 同一面板、强制 `backdrop-filter: none` | 「最近 7 天」「已完成」与日历图标**锐利地透出来**，A/B 逐像素最大差 **107**（三通道和） |
| C = 同一面板、强制 `blur(60px)` | 与 A 的最大差只有 **6**，`>8` 的像素 **0 个** |
| D = 面板未开（纯背景） | 边缘能量 2976；A 2765 / B 2879 |

⇒ **blur 在像素上真的生效**，我先前把**面板自己的**菜单项（登录/注册、设置、成长）误读成了侧栏文字。
A≈C 不是"没糊"，而是**已经糊到底**：20px 作用在 12px 中文小字上等于**抹平**，不是"看得出模糊"。
📌 一般规律：**判玻璃要看"身后的字在不在"，不是"看不看得出糊"** —— 小字号 + 高斯模糊的结果是消失，
而 `blur(20)` 与 `blur(60)` 无差恰好是"已经糊过头"的证据，不是"没生效"的证据。
（同一轮还排除了三个假设：headless 不渲染 `backdrop-filter`、`fixed` 在 overflow 祖先里失效、入场动画未落位。）

**排除 2（差点登记成幻影缺陷的一条）**：`4-email-not-verified` 里对话框**顶到画面下沿**，
我以为 `maxHeight` 没生效、底部的「服务端地址」输入框够不着。量了那张图的白色卡片边界才否掉：
图是 **1280×720**（Playwright 默认视口，不是 800），卡片白色区 y=54…665 ⇒ 高 **611**，
而 `AuthPanel.tsx:390` 给的是 `maxHeight: '85vh'` = **612**，居中后 top=(720−611)/2=**54.5** —— 两处都对上，
`overflowY: 'auto'` 在容器上，所以那只是**没滚动时的首屏**。
📌 判"界面被裁了"之前先量图的尺寸：我这次是按 800 高的假设去读 720 的图，
差出来的 80px 正好足够编出一个不存在的缺陷。

**这第七张图当场抓到的一条真缺陷，已经修在同一天**：`2-register-policy-error` 那张图**第一次**看的时候，
口令框里写着 `123`，框下面却印着「还没有填密码。」—— 因为服务端按策略拒绝时把字段指到 `password`
（`AuthPanel` 的 `isPolicy` 那条），而组件把"宿主说该改哪一格"和"这一格没填"当成了同一件事。
现拆成两个判据：`errorField`（`aria-invalid` 用，指格子是对的）与 `missingField`
（**只有本地那次"没填"的判定**才配得上"还没有填 X"这句话），见 `packages/ui/src/auth/AuthForm.tsx:308-326`。
时间线（`stat` 实测）：源码 18:22:38 改完 ⇒ 19:04:19 这一张就是**改完之后**重跑 `verify:password-web`
打出来的（该脚本每次运行先从源码重打 `apps/web` 与全部 workspace 依赖），所以这张图**是修好的产物**，
不是旧包 —— 这就是上面表格里那一行的证据来源。
📌 反面记一句：jsdom 那批用例当时全都只判"状态区有没有话"，所以这句话在框里明明有内容时也没有任何一条会红
（§7 元规则 2：**只判"有没有话"的判据，判不出"这句话是不是在撒谎"**）。

**登记 1（本轮不改，理由在文末）**：服务端返回的**字段级**错误只渲染在对话框**顶部**的
live region（`packages/ui/src/auth/AuthForm.tsx:414-454`），出问题的输入框只拿到
`aria-invalid`（`:538`），**没有可见标记**，两者相距三行。
本地校验错误**是**就地渲染的（`:484`、`:563`）—— 所以同一个表单里"错在哪"有两套空间约定。
组件已经**知道**是哪个字段（`status.field`，`AuthPanel.tsx:366` 对 `password-policy` 就在传它），
缺的只是把这句话搬到字段下面 + 给无效字段一条可见样式。
**下一轮的第一件**：把 `status.field !== undefined` 的错误搬到对应字段下（顶部只留无字段的），
并补一条能失败的判据（断"错误文案出现在该字段之后、且在下一个字段之前"）。
🔴 本轮不动的理由：它要改 `packages/ui/src` 并重建 `dist/`，而 auth-form 新判据的**变异验证**
本来就压在同一件事上（B8 的形态：一次失败的 build 会清空共享 `dist/`）—— 两笔该一起做、一起验。

### W0 探针 —— ✅ 已跑完（2026-10-01），**五条里四条改写了设计**

**1. `@node-rs/argon2` 能不能用 → ✅ 能，musl 已经**在生产形状里逐字节验过**（不再是"只能靠自检兜底"）。**

| 事实 | 数字 / 证据 |
|---|---|
| glibc（本机 Node 24）加载 + 哈希 + verify | **27 ms**，PHC 串 `$argon2id$v=19$m=19456,t=2,p=1$…`；错密码 `verify` 返回 `false` 而非抛错 |
| 🔴 **生产形状实测**（2026-10-01，生产主机 `124.223.13.226`，`--platform linux/amd64`） | `node:24-alpine` = **musl**（`glibcVersionRuntime` 为空）、`npm i --omit=dev --ignore-scripts`（与 `server/Dockerfile` 运行阶段同一条命令）⇒ 装到的是 `@node-rs/argon2-linux-x64-musl`，**加载成功、哈希 37 ms、verify 对/错 = `true`/`false`** |
| **三方逐字节一致** | 同一组固定输入（口令 `correct horse battery staple`、salt `fill(7)`×16、pepper `fill(11)`×32、`m=19456,t=2,p=1,len=32`）下，**macOS glibc 原生**、**生产 musl 原生**、**纯 JS `@noble/hashes`** 三家都给出 `8698ebcd…edf2bbc9` ⇒ 这就是启动自检要钉的那个 known-answer |
| PHC 串（钉死） | `$argon2id$v=19$m=19456,t=2,p=1$BwcHBwcHBwcHBwcHBwcHBw$hpjrzf04FKELqgfB1yCxEOWCsgZFlpjf1FKL7O3yu8k` |
| pepper 是真的参与哈希 | 同一条 PHC 串用**不带 `secret`** 的 `verify` 返回 **`false`** ⇒ pepper 换掉/丢了，存量密码**全部验不过**（不是"降级还能登"）。这条要写进部署手册与 ADR-0040 的后果说明 |
| `parseOptions()` | 返回 `{algorithm:2,version:1,memoryCost:19456,timeCost:2,parallelism:1,outputLen:32,saltLen:16}` ⇒ **重哈希判定（needsRehash）不用自己解析字符串** |
| 纯 JS 对照（`@noble/hashes`，sync-core 已在用） | OWASP 最低参数下 **8 671 ms** ⇒ 🔴 **服务端排除纯 JS**（一次登录 8 秒 = 自我 DoS）。它只作为**本机交叉验证**存在，不进产品依赖 |
| ~~`node:crypto` scrypt 兜底~~ | 190 ms（N=2^17, r=8；要显式 `maxmem` 512MB）—— **作废，不实现**：见 D3"不留 scrypt 退路" |

启动自检**仍然要**（`AGENTS.md` §7 第 32 条"pod 装了 ≠ 链接了"），但它的角色变了：
从"弥补探针没跑完的赌注"变成**长期的架构不变量守卫** —— 换基础镜像、换 CPU 架构、依赖漂移时当场响，
而不是等第一个用户点"登录"收到 500。

**2. HIBP 从生产可达 —— 但 1s 超时的原设计是错的。**

实测于生产主机 `124.223.13.226`（腾讯云，国内出口）：宿主机 6 次全 **HTTP 200**，
耗时 **0.94 / 1.03 / 1.41 / 1.83 / 2.05 / 2.71 s**（TLS 握手单独就占 1.17 s）；
**应用容器 `supersync-server` 内 4 次全 OK**（bridge 网络出网正常）。冷启动第一次探测 `--max-time 4` 直接 **000**。

⇒ 原写的"超时 1s、fail-open"会让**一半以上的查询在有用的结果回来之前被砍掉**，而 fail-open 会把这种超时伪装成"这口令没问题"。
改成三条，都进 ADR-0040：

- **只在"设密码"的那一刻查**（注册 / 改密 / 重置完成），🔴 **登录路径一律不查** —— 把一个 2 秒的外部依赖挂在认证热路径上是自我 DoS，而 NIST 也不要求在这里查。
- 超时 **2000 ms**（覆盖实测上界），仍 **fail-open**，但**必须记一条 warn 日志**（"泄露检查未送达"），否则 fail-open 与"检查通过"在事后不可区分。
- **本地常见口令表是确定性的那一道**（零网络、每次必查），HIBP 只是第二层加分。

**3. 迁移形状**：待 W2 真正写出清理迁移后用 `node scripts/check-migrations.mjs` 验（探针没做完 = 不算通过，登记为 W2 的前置）。

**4. 🔴 `sync-client` 遇到 401 现在做的事，证明 D5 那条不是免费的。**

读码结论（`packages/sync-client/src/client.ts`）：非 2xx 一律经 `toHttpError()`（:1382）抛
`同步请求失败：HTTP 401 — …`，落到 `sync()` 的 catch（:763-769）：

```ts
const offline = isNetworkError(error);          // 401 → false（不是 TypeError，也不匹配网络正则）
return report({ kind: 'error', reason: 'unexpected', message, retryable: true });
```

而 `apps/mobile/src/sync/auto-sync.ts:100` 是 `case 'error': return !status.retryable;` ——
`retryable: true` 意味着**这个决定没结算**，退避调度器（`createRetryScheduler`，上限 60s）会
**拿着一个已作废的令牌永远重试下去**，界面上显示的是「同步失败」。

⇒ 用户"在其他设备登出全部设备"之后，这台设备看到的是一句谎话，而且后台在打一个永远不可能成功的请求。
**必须新增一个 `SyncFailureReason`：`'unauthorized'` + `retryable: false`**，两个壳的 `switch` 才会被编译器逼着改。
这条是 D5「停上传、本地数据继续可读、提示重新认证、绝不自动清库」的**唯一落地方式**，列为 W1 的一部分（不是 W3 的）。

**5. 口令归一化 —— 缺陷确认，但不在本工作流里顺手修。**

`grep "normalize("` 覆盖 `packages/sync-core/src`、`packages/app-host/src`、`packages/storage/src`：**零命中**。
Node 实测 `'café'.normalize('NFC') === 'café'.normalize('NFD')` 为 **`false`** ⇒ 同一句口令在 iOS（可能给 NFD）与 macOS（NFC）下
派生出**不同密钥**，跨设备解不开密文。这是一条**独立的真缺陷**（涉及已落盘数据的可解性，改它会让"用 NFD 写过 op"的设备当场解不开），
🔴 **不塞进本轮顺手改**，登记在 §10 第 11 条；本轮只保证**密码这条新路径**自洽：设置与校验**同一个地方、同一次 NFKC**，两处共用一个函数。

**W0 的第六条发现（不在原清单里，但它改变 §1 与 §9）**：
`server/tests/auth-flows.spec.ts` 是**上游 email+密码的完整契约**（5 次失败锁 15 分钟、成功清零、
`'Email not verified'`、不存在账号与错密码**同一句** `'Invalid credentials'`），
它被 `server/vitest.config.ts:25` **排除在运行之外**，而它 import 的 `registerUser` / `loginUser`
在 `server/src` 里**根本不存在**（`git log -S loginUser -- server/src/auth.ts` 零命中，随 `f3efce04` vendoring 时被删）。
⇒ 语义**照它移植**（这正是 `AGENTS.md` §3.4 说的"移植语义，不要拷贝代码"），但🔴 **不许把这个死文件重新启用**：
它绑的是同步 SQLite（`tests/setup.ts` 的 `db.prepare`），与现在的 Prisma/Postgres 不是一回事，
硬打开只会得到一句 "Cannot find undefined export"。判据在 Prisma 上重写（W1）。


---

## 8. 判据（每条都要能因注入故障转红 —— "不能失败的检查没有价值"）

| # | 判据 | 反假通过（变异） |
|---|---|---|
| J1' | 前置性沿用 `user-journey-and-auth.md` J1，加"密码表单也在 ≤2 次点击内" | 把表单移回设置深处 ⇒ 红 |
| J8 | 真服务端链：注册设密码 → 收邮件 → 验证 → **用密码登录** → 同步上行 → 第二设备读到 | 把 `/login/email-password` 做成空操作 ⇒ 红 |
| J9 | **令牌只存哈希**：发一封验证邮件后，库里按发出的 token 明文 `findUnique` 必须查不到 | 拿掉 `SHA-256` ⇒ 红 |
| J10 | **爆破**：5 次错误后第 6 次即使密码正确也拒，且 magic-link 仍通；15min 后恢复 | 拿掉递增 ⇒ 拦不住 ⇒ 红 |
| J11 | **反枚举**：不存在账号与错密码**同状态码同文案**，且耗时差 < 一个阈值（阈值从 Argon2 参数推导，不用拍脑袋数） | 去掉 dummy-hash 校验 ⇒ 耗时判据红 |
| J12 | `passwordHash` 与任何 token 不得出现在响应里（沿用后台白名单投影那条判据） | 把它加进投影 ⇒ 红 |
| J13 | **全设备登出**：改密后旧 token 全部 401，而本地数据仍可读 | 不 bump `tokenVersion` ⇒ 红 |
| J14 | 重置成功后**不自动登录** | 顺手发会话 ⇒ 红 |
| J15 | DOM 断言 `autocomplete` 三处值、显隐按钮 `aria-pressed`、错误走 `aria-live` 且**是文字**、输入内容被保留 | 去掉属性 ⇒ 逐条红 |
| J16 | 钥匙串：写入 → **杀进程重启** → 读回 → 用它解开真实密文 | 只写内存 ⇒ 红；且**不许**用"写进了 localStorage"糊过去 |
| J17 | `pnpm -r typecheck && pnpm -r test && pnpm check` 全绿，再 `pnpm reinstall:all` | — |

链式验收新建 `scripts/verify-email-password-chain.mjs`（TEST_MODE **关**、真 Postgres、真 SES 读回、真浏览器），
沿用 `verify-email-web-chain.mjs` 的形状与 `RESULT=PASS` / 注入证据目录，并把它登记进
`scripts/check-journey-coverage.mjs`（🔴 这条门禁会因"新增路由没有对应 journey"而红）。

---

## 9. 本轮会撞到的既有断言（先列出来，免得当成新 bug 查）

1. `server/README.md:324-335` 与 `server/docs/authentication.md:5,14-36` 明写"生产没有密码注册/登录" —— 要改。
2. `packages/i18n` 三处 **"heyta 的账号只有两种进入方式，没有密码"**（`zh-CN.ts:2571,2645,2994`）与 en 对应 +
   生成的 `apps/landing/docs/account/index.html`。🔴 入口页是**提交物**，`check:entries` 会逐字节比对，
   必须重跑 `gen:entries`，不能手改 HTML。
3. `user-journey-and-auth.md`：**A1 已过期**（魔法链接注册现在验证即发会话，`auth.ts:498-531`，且它引的行号 `908/377/616/215` 也是旧的）；§3.2 的旅程要从 ②a/②b 变三条；§7 第 4 条与 §4 的落盘措辞冲突按 D2 精确化；**J1 写 ≤1 次点击、§3.1 已放宽到 2 次**（同文件内的自相矛盾，顺带修）。
4. `e2e/auth-journey/auth-journey.spec.ts:160`（`parsed.password` 必须 `undefined`）**保持有效** —— 因为 Web 端仍不落盘（D2 的例外）。移动端新增钥匙串判据不冲突。
5. `scripts/check-mobile-settings.mjs:86-90` 的 `CREDENTIAL_KEYS`（serverUrl/token/password 必须在 SettingsScreen 不在 ProfileScreen）会红。
6. `research/tools/license-inventory.mjs` 必须逐项登记 `@node-rs/argon2` 与 `expo-secure-store`（🔴 白名单外默认失败，且现在**真的会判失败**）。
7. ✅ `packages/shared-schema` 里那个 `'PASSWORD_CHANGED'` 的 import reason（`supersync-http-contract.ts:26`）今天只有 fixture 在用 —— 本轮要么真正接上（改密后要求客户端带 reason 重传），要么删掉，**不许留着当装饰**。
   **已删**（2026-10-01）：全仓零生产者，连 vendored 的上游克隆里都搜不到。选"删"而不是"接上"的理由就是 D1 —— 登录口令与 E2EE 口令解耦之后，**改登录口令不需要重传任何东西**（密文不变，`tokenVersion` 前进只作废令牌）；而"轮换 E2EE 口令"这个功能本身还没做，真做时它需要的是跟着那条流程一起设计的标记（要能表达"新口令解不开旧密文"这种中途失败），不是把这个成员捡回来。两个 fixture 改用在册的 `'FORCE_UPLOAD'`（那两条用例判的是状态替换栅栏的时序，与 reason 无关），词表封闭性新增一条断言钉住（变异验证：把成员加回去 ⇒ 恰好 1 红）。
8. 各链式脚本与 `scripts/lib/*` 用 `/api/test/create-user` 造账号 —— 新增 `J8` 必须走**生产路由**，判据不许踩 TEST_MODE 的路。

---

## 10. 明确不做 / 已知边界

1. **不做 2FA/TOTP** —— passkey 已经是第二因子，再加一套只增加支持面。
2. **不改 JWT 的 365 天**（`auth.ts:19`）。NIST 给 AAL1 的建议是 30 天，但改会话寿命要同时动四个壳和离线路径，本轮只做"可撤销"（`tokenVersion`）。登记为缺口。
3. **不做 SRP/PAKE**（D4 已给理由）。
4. **不做 E2EE 口令的找回**。口令丢了 = 数据不可达，与 Cryptomator / Bitwarden / Obsidian Sync 同款边界；这条**必须写进帮助页**，不能靠沉默含糊过去。恢复码或 passkey-PRF 是下一刀的解法。
5. **Web 端口令不持久化**（PRF 支持前不假装）；**Linux / 鸿蒙不做钥匙串**。
6. **不做手机号、短信验证码**（ADR-0039 只留了位）。
7. **限流仍是单进程内存态** ⇒ 多副本部署前要换共享 store。
8. `check:docs-voice` 拦算法名进用户文档 ⇒ 帮助页只写行为；机制细节留在 `docs/` 与自托管篇。
9. 落地页 `VITE_APP_URL` 未配置时整条入口不渲染，这是故意的 —— 验收时别把它当断点。
10. ✅ **`deleteUserPasskey` 的"最后一条不许删"前提已经裁决并落地**（2026-10-01，
    [ADR-0041](../adr/0041-last-passkey-guard-keys-on-any-usable-entry.md)）。
    它写于"通行密钥是唯一入口"的时代，那时"最后一条"恰好等价于"没有别的入口"。
    现在不等价，所以判据换成那个**真实**条件：账号有**能用的**登录口令
    （`passwordHash IS NOT NULL AND is_verified = 1`）时删掉最后一条通行密钥**放行**，
    否则照旧 409 `last_passkey_required`。ADR-0029 的**取舍**（宁可拒绝，也不把
    账号可进入性寄托在用户读到一条文案上）一条没动。三条落地时的硬要求：
    ① `is_verified` 不能省 —— `loginWithEmailPassword` 在校验通过**之后**还会因未验证
    抛 `email_not_verified`，只看 hash 会放出一个谁也进不去的账号；
    ② 口令被限流**算**能用（限流自己会到期，用瞬时状态否决一个删不掉的凭据会让界面
    只能说"过一会儿再来"）；③ 两条判据必须在**同一条 `deleteMany` 谓词**里求值
    （那是唯一的 TOCTOU 防护），并且**服务端与显示那句提示的客户端同时改** ——
    词条 `common.auth.error.lastPasskey` / `web.passkeys.error.lastPasskey` 已同时改成
    给两条出路（再添一条通行密钥 / 设登录口令，并注明邮箱得先验证过）。
11. ⚠️ **E2EE 口令的 NFC/NFD 缺陷仍在本轮之外**（W0 探针 5）。`packages/sync-core` 派生密钥前
    **不做任何 normalize**，而 `'café'.normalize('NFC') !== 'café'.normalize('NFD')` ⇒ iOS 键盘
    给出 NFD 时同一句口令派生出**不同密钥**，跨设备解不开密文。
    🔴 不顺手修的理由是**存量密文**：加了 normalize 之后，用 NFD 写过 op 的设备当场解不开自己
    已经落盘的密文 —— 那是数据不可达，不是登录失败。修它要同时决定"旧密文怎么办"（重派生 +
    全量重加密，或按输入形式双读），是一条独立的 ADR。
    本轮只保证**密码这条新路径**自洽：设置与校验同一个函数、同一次 NFKC。
12. ⚠️ **`bcryptjs` 现在是"声明了但没人用"的依赖**（`server/package.json`），而摘掉它要单独一个提交。
    它的两处引用这次都拿掉了：`test-routes.ts` 改用产品的 Argon2id 后端（TEST_MODE 造的号过去写
    bcrypt 串，产品那条登录路径**永远验不过** —— 只在 E2E 里现形的假账号），
    `server/tests/auth-flows.spec.ts` 则本来就**是死的**：它 import 的
    `registerUser / loginUser / initDb / getDb` 在 `server/src` 里一个都不存在，而它一直躺在
    `vitest.config.ts` 的 exclude 名单里 ⇒ 从没跑过、也从没红过。文件与那条 exclude 一起删了。
    🔴 **依赖条目没跟着删，是因为删它的代价不在本次改动里**：`pnpm install --lockfile-only`
    顺带把 `@react-native/*` 的 90 行 peer 后缀（`(supports-color@5.5.0)`）整个重新规范化了 ——
    那是 pnpm 小版本差异，与口令无关，混进认证提交会让下一位分不清哪些改动是这轮的目的。
    做这件事的人：命令是 `pnpm install --lockfile-only`，判据是 `grep -c bcryptjs pnpm-lock.yaml` → 0、
    `cd server && npx tsc --noEmit` exit 0、`pnpm check:licenses` exit 0。
    ⚠️ 生产镜像走 `pnpm install --frozen-lockfile`（`server/Dockerfile:58`）⇒
    **package.json 与 pnpm-lock.yaml 必须同一个提交改**，只删前者会让构建直接失败。

13. ⚠️ **缺口：新增认证器不发任何告知信**（2026-10-01 落地 `/password/set` 时确认）。
    四条改动账号的东西里只有**改密**发信（`sendPasswordChangedEmail`，`/password/change` 成功时）。
    **设第一个口令**（`/password/set`）与**新增一条通行密钥**都不发。
    🔴 这不是"少了一封邮件"，是**留了后门的通知通道**：拿到一枚有效会话的人（共享设备、
    被盗的令牌）可以先给账号加一个自己知道的口令作为持久入口，而原主**一个字都收不到** ——
    改密那封信拦不住的正是这件事，而加认证器比改密更安静。
    本轮不补的理由只有一条：**它需要第 5 封信与第 5 张模板**，而 `check:server-copy` 那条门禁
    要求文案从 `packages/i18n` 生成（`server/src/copy.generated.ts`），一起动会把认证提交
    撑成"邮件模板 + 生成物 + 门禁"三件事。
    闭合时需要的三样：① 中英两条词条（"你的账号新增了一种登录方式"，**并且**要说出是哪一种
    —— 只说"有改动"等于没说）；② 与改密那封**同一套**表格模板与语言切换；③ 判据形状沿用
    改密那条：成功路径发**一封**、失败路径**零封**，且**不许**因为反枚举而对"没有这个账号"发信。

---

## 11. 下一步

按 W0 → W9 顺序推进。W0 是探针，半天内能出结论，且**它的四条否定结果都可能改写上面的表**
（尤其是 1、2、4）。W0 之后任何一步想偏离本篇，先改 `user-journey-and-auth.md` 并写明理由。

---

## 12. 自托管也必须走这条路（2026-10-03 追加，产品负责人裁决）

**原话**：「抽象的账号密码登录层是一定要有的，一定是主流的。即使用户自托管了，给了那种
各种的回调域名之类的，给了同步域名之类的，他应该是给一个服务器的同步域名嘛。即使有了这个
东西，他也是账号密码登录的，都一样应该是。」

这句话拆成两条判据：**① 判定与表单只有一份，在抽象层**；**② 换任何一台服务器，这条路都走得完**。
第①条落地时就是成立的（下表）。第②条**不成立**，而且坏的地方没人会当 bug 看 —— 这就是本轮修的。

### 12.1 第①条的现状（读被调方本体核过，不是 grep 符号）

| 层 | 位置 | 是否随服务器地址漂移 |
|---|---|---|
| 判定（长度/泄露/锁定/同码同句） | `server/src/password/` | 否 —— 谁运营谁裁决 |
| 协议（路径、请求体、失败归类） | `packages/app-host/src/hosted-auth.ts`：`registerWithEmailPassword:1547` / `loginWithEmailPassword:~1580` / `resetPasswordWithToken` / `changePassword` / `setInitialPassword` | 否 —— 每个函数第一个参数就是 `options.baseUrl` |
| 表单（两步、显隐、`autocomplete`、错误落点） | `packages/ui/src/auth/AuthForm.tsx` 一份 | 否 —— web/移动共用 |
| 界面可达性 | 头像菜单第一项「登录 / 注册」→ 面板第一屏是邮箱+口令，通行密钥降到「或者用别的方式」文字链（§W6e 两张图） | 否 |
| 自托管入口 | `AuthPanel` 的 `selfHostToggle` + 地址框，`effectiveBaseUrl` 决定打到哪台服务器；移动壳 `AuthScreen` 有同一个地址栏 | 否 |

### 12.2 第②条当时是**断的**，断点有两处，都是"界面在说谎"那一类

1. `isVerified` 是**所有**登录路的硬前置：`verifyToken` 拒未验证账号，
   `loginWithEmailPassword` 更是在**口令校验通过之后**才抛 `email_not_verified`
   （那条顺序是为了不泄露邮箱是否存在，见 `server/src/passkey.ts:1030` 的注释）。
   而开这道闸的唯一动作是点那封验证邮件里的链接。
2. `server/src/auth.ts` 的两处发信分支（新建 + 重发）在 `sendVerificationEmail` 返回
   `false` 时，**回的是同一句**"Registration successful. Please check your email…"。
   一台没配 SMTP 的服务器上：信从来没发出去 → 界面说"去查收" → 用户能做的只有
   再点一次注册 → 再拿到同一句谎话。`server/src/passkey.ts` 的注册路同形。

> 顺带记一条**没动**的：非生产模式下没配 SMTP 会退回 Ethereal（第三方测试收件箱），
> 而 `scripts/verify-password-web-journey.mjs:49` **正是靠抓那行 `Preview URL:`**
> 来证明"那封信真的存在"。所以这条兜底是承重的，不能顺手删；本轮只把它的
> 隐私代价写进那行 `Logger.warn`（`server/src/email.ts`），并把"生产要么配 SMTP、
> 要么显式关验证"写进 `server/env.example`。

### 12.3 修法（三层，每层各一条判据）

| 层 | 改动 | 判据 |
|---|---|---|
| 裁决 | 新 env `REQUIRE_EMAIL_VERIFICATION`（默认 `true`，取值严格、写错启动即报错，与 `ENTITLEMENT_GATE_ENABLED` 同纪律）。判点抽成 `emailVerificationRequired(config)`，**三条注册路共用同一个函数** | `server/tests/self-host-email-verification.spec.ts` 第 3 组 |
| 服务端诚实 | 发信失败 ⇒ 响应多一个 `emailDelivered: false`，而**中性文案与状态码一字不变**（变了就成邮箱存在性预言机）；"不需要信"与"信没发出去"是两件事，前者**不带**这个字段 | 同文件第 1、2 组（9 条） |
| 客户端 | `app-host` 严格读（只认字面 `false`）→ web store `registeredFrom` → `AuthPanel` 换那句；移动壳 `registerNoticeKey` 同理。词条 `web/mobile.auth.sent.mailNotSent` 中英各一条 | `packages/app-host/tests/hosted-password-auth.spec.ts` 第 6 组、`apps/web/tests/auth-store-password.spec.ts` 第 6 组、`apps/web/tests/auth-panel.spec.tsx` 新增那条 |

### 12.4 变异数字（含一条反直觉的，值得所有写判据的人看）

`emailVerificationRequired` 往**两个方向**各改一次，红字名单**不重合**：

| 变异 | 结果 |
|---|---|
| 换成 `config.testMode?.autoVerifyUsers === true`（忽略开关、**永远不**验证） | 3 红 = 第 2 组两条 + 判点那条。🔴 **第 1 组两条照样绿** —— 一台什么都不验证的机器恰好满足"当场激活、一封都不发" |
| 换成 `config.testMode?.autoVerifyUsers !== true`（忽略开关、**永远要**验证） | 3 红 = 第 1 组两条 + 判点那条 |
| `auth.ts` 两处 `emailDelivered: false` 改回只回中性句 | **恰好** 2 红（第 2 组），其余 7 条不动 |

📌 教训：**"这条判据测得出这个缺陷"取决于缺陷往哪边坏。** 只做一次单向变异就宣布有牙齿，
测到的可能是"实现和缺陷恰好同向"。开关类判据必须两个方向各变异一次。
（本条目第一版写的是"改回 `testMode?.autoVerifyUsers` ⇒ 第 1 组红"，实测**不成立**，
已按实测改在这里。）

### 12.5 ⚠️ 这批改动**还没提交**，而且不能整文件提交（2026-10-03 01:00 现场）

代码与判据都已实测（见下表），但共享工作树里此刻同时躺着**另外三条线的未提交源码**
（AI 收尾、账号资料 `withAccountProfile`、移动端导出/还原）。逐文件按 hunk 量过：

| 文件 | 我的 hunk | 别人的 hunk | 能不能整文件提交 |
|---|---|---|---|
| `server/src/config.ts`、`email.ts`、`passkey.ts`、`password/service.ts`、`env.example`、`server/tests/magic-link-registration.spec.ts`、`server/tests/passkey.spec.ts`、`apps/web/src/features/auth/store.ts`、`apps/web/src/features/auth/AuthPanel.tsx`、`apps/web/tests/auth-panel.spec.tsx`、`apps/web/tests/auth-store-password.spec.ts`、`apps/mobile/src/screens/AuthScreen.tsx`、`apps/mobile/tests/auth-screen-password.spec.ts`、`docs/plans/email-password-auth.md`、`docs/reference/environment-traps.md` | 全部 | 0 | ✅ 能 |
| `server/src/auth.ts` | 7 | 7（`withAccountProfile` 那半） | ❌ 混 |
| `packages/app-host/src/hosted-auth.ts` | 5 | 6 | ❌ 混 |
| `packages/i18n/src/locales/{zh-CN,en}.ts` | 各 2 | 各 3（`web.ai.failure.cause.networkOriginRejected` 那半） | ❌ 混 |
| `packages/app-host/tests/hosted-password-auth.spec.ts` | 1 | 1 | ❌ 混 |

🔴 **不许"顺手整文件提交"的三个理由**：① 会把别人正在写的东西以我的名义钉进历史；
② `server/src/auth.ts` 那半此刻**自己是红的**（`magic-link-registration.spec.ts` 的
"consume a login token" 一条因 session `user` 多了 `avatarHash`/`displayName`/`locale`
而失败 —— HEAD 里 `withAccountProfile` 命中 0 次、工作树 4 次），跟着提交就是把一笔
红账算到我头上（§7 第 123 条那个"check 链把账算到下一笔"的形状）；
③ 本仓今天已经有一次 plumbing 提交脚本伤到另一条会话的自报（`BLOCKED.md` 22:06 那条）。

**正确的提交窗口**是"树上没有别人的未提交源码"那一刻（与 §6.1.1 四端重装同一个前提）。
到时候：`git commit --only -- <上面那串路径>`，提交后 `git show --stat` 复核
**删除数为 0**，再跑第二轮 `reinstall:all`（本轮那套装的是 00:23 的 HEAD，
不含 §12.3 的客户端那半）。

### 12.6 本轮实测数字（新鲜，不是复述）

| 判据 | 结果 |
|---|---|
| `cd server && npx tsc --noEmit` | exit 0 |
| `cd server && npx vitest run` | 2052 passed / 5 failed → 修完我那 4 条后 **1 failed**，而那 1 条是上表的 `withAccountProfile`（不是本条线） |
| `packages/app-host` | 911 passed |
| `packages/i18n` | 22 passed（中英键集一致） |
| `apps/web` | 1431 passed / 12 skipped，exit 0 |
| `apps/mobile` | 538 passed，`tsc --noEmit` exit 0 |
| 门禁 | `check:ui-language` / `check:layering` / `check:server-copy` / `check:server-design` / `check:design` / `check:crosslang-contract` / `check:journey-coverage` 全 OK；`check:docs` 红在 ADR-0044/0045 那两条线的未跟踪文档上，与本条线无关 |
| 四端重装（隔离检出 @ HEAD，00:23–00:44） | `CHAIN_EXIT=0`：mac ✅ / windows ✅ / android ✅（1080x2400、内容 55.3%、主蓝 4036）/ ios ✅（1206x2622、内容 61.5%、主蓝 4136，且"已装的包比源码新"） |
| `verify:password-web`（改完客户端之后**又跑了一遍**） | 2 passed / exit 0（真服务端 `TEST_MODE` 关 + 同源反代 + 从工作树重打的 `apps/web/dist`） |
| 全量离线 e2e（同一批改动之后） | 96 passed / 2 skipped / **4 failed**。🔴 那 4 条**不是**本条线的：`admin-console.spec.ts` 抓的是别人在途的账号资料端点 `GET /api/account/profile` 没进假端点 —— 取证与闭口清单在 `BLOCKED.md` B14。（20:5x 那一跑同一条判据是 100 passed，差的就是那半件在途事。）

## 13. 移动端那一层为什么整轮假红 —— 首启隐私同意面板（2026-10-03）

> 🔴 **待入台账 `docs/reference/environment-traps.md`**：本节写作时那份台账正被另一条会话
> 改着（2026-10-03 12:15 现量：工作树相对 HEAD `+48 -0`，#177–#180 都是他们在飞的号且**已落到工作树**），
> 所以**不往它追加**，正文先落在这里。追加时的号**以现量 `max+1` 为准**
> （12:15 工作树最大号 = 180 ⇒ 本条应为 **#181**；早先写的"#180"作废，那个号已经被占了 ——
> 这正是本条自己要防的那件事：编号是工作树的瞬时读数，按记忆写就会撞号。若之上又被占号就顺延，别抢号）。

### 13.1 症状与真因

`verify-mobile-auth.sh` 2026-10-03 10:54–10:58 那一轮：**17 条 ❌ / 4 条 ✅**，
其中 **11 条是"找不到输入框 / 取不到坐标 / 找不到按钮"**这一类。报出来的第一句是
「冷启动第一屏没有『注册 / 登录』—— 入口不在第一屏」，读起来像产品把入口藏深了。

真因一条都不在产品里：`apps/mobile/src/privacy/startup.ts` 在冷启动且"这台设备从没被问过"时
弹一块首启隐私同意面板（标题「在使用联网功能之前」），而它是一块
**`accessibilityViewIsModal` 的 RN Modal**（`apps/mobile/src/screens/PrivacyConsentSheet.tsx:196`）。
它立着的时候，**欢迎页与主界面的节点根本不在无障碍树里** ——
`uiautomator dump` 里只有那块面板的 9 行文字。第 0 步刚跑过 `pm clear`（= 全新设备 = 从没被问过），
所以它必然在。

这条面板是 2026-10-01 那把并行刀落地的（G-11「首启没征求过隐私同意」+ G-12「前台同步可能先于询问发请求」）。

### 13.2 真正的问题不是"漏了一步"，是"处置有五份抄件"

| 脚本 | 处置 | 按哪颗按钮 | 等面板吗 | 复验它走了吗 |
|---|---|---|---|---|
| `verify-mobile-inbox.sh:69` | 本地一份 | 同意并联网 → 只用本机 | 轮询 ≤10s | ❌ |
| `verify-mobile-reminder-ring.sh:45` | 本地一份 | 只用本机 | 轮询 ≤10s | ❌ |
| `verify-mobile-schedule.sh:51` | 本地一份 | 以后再说 → 只用本机 | 轮询 ≤10s | ❌ |
| `verify-mobile-task-row.sh:85` | 本地一份 | 只用本机（**用按钮文字判面板在不在**） | ❌ 不等 | ❌ |
| `verify-mobile-timeline.sh:65` | 本地一份 | 以后再说 → 只用本机 → text 第 2 匹配 | 轮询 ≤10s | ✅ 补点一次 |
| `verify-mobile-auth.sh` | **谁也没抄到** | — | — | — |

五份各不相同（等待、按钮、有没有复验），而第六个直接没有。
`verify-mobile-task-row.sh` 的注释里写着当时为什么不进共享库 ——
"这个功能还在另一条会话手里改，动 `lib/mobile-e2e.sh` 会撞车；将来它进了 lib，这段就该收掉"。
**那句已经过期，而且它预言的后果到了**：没人回来收，于是新脚本抄不到。

AGENTS §3.5 早就给过这条的形状（`ids.ts` / `createSyncClient` 那两次）：
**抽取的收尾动作是删掉旧的那份并加门禁，不是写一个更好的新版本。**

### 13.3 修法（四处，按上面那条纪律做完）

1. **单一所有者**：`scripts/lib/mobile-e2e.sh` 新增 `handle_privacy_consent <按钮优先级…>`，
   把五份抄件里**各自最好的那一片**收进来（timeline 的轮询等入场动画、
   它的"按钮名在 content-desc 不在 text ⇒ `xy_text` 兜底要取第 2 个匹配"、
   它的"点一次未必收下 ⇒ 复验还在就补点一次"）。
   它自己**不碰 PASS/FAIL**，只置 `CONSENT_GATE_SEEN` / `CONSENT_GATE_CHOSEN` 给调用方断言 ——
   "要不要把这次豁免算成一条检查"必须由脚本决定，不能由库替脚本决定。
2. **五份抄件全部改成委托**（`inbox` / `reminder-ring` / `schedule` / `task-row` / `timeline`），
   各自点名自己的按钮（本地类验收**不替用户做联网决定**：`只用本机` / `以后再说`）。
3. **`dismiss_welcome_if_present` 第一件事就是收这块面板** —— 顺序就是屏幕上的顺序
   （面板在上面）。这一改把剩下 15 个只调它的脚本一并救回来（它们全是
   `pm clear` 之后靠无障碍树驱动界面的）。默认按钮 `同意并联网`，
   要换的 `export CONSENT_GATE_PREFERRED=…`，理由与代价写在库的注释里。
4. **把 J1 的豁免落成断言**（`verify-mobile-auth.sh` 新增 0.5 步）：
   第 0 步刚 `pm clear`，所以「面板没出现」不是省一步，**是 G-11 那条要求的失败** ⇒
   `CONSENT_GATE_SEEN` 必须 = 1。第 7 步再加一条：做过决定之后再冷启动**不许再问一遍**
   （`startup.ts` 判的是 `undecided()`），并且**这条必须排在"欢迎页不许回来"之前** ——
   面板盖屏时「先离线使用」读不到，那句会印成假绿。

⚠️ 顺带纠正一处归因：`schedule` / `timeline` 的注释把"同意面板再弹一次"写成
"首启两块屏**交替出现**、界面换序"。机制不是随机的 ——
**选「以后再说」= 决定仍是没问过 ⇒ 下次冷启动或下次撞上门闸（`required-for-action`）必然再弹**。
它们外面那圈 `settle_*` 循环处理的是这个后果。选「同意并联网」的脚本不会有这个现象。

### 13.4 新门禁 `check:mobile-first-run-gate`，以及它自己第一跑就是一条恒过的判据

三条判据（都已挂进 `pnpm check`，位置在 `check:script-snapshot` 之后 —— 同为"验收脚本自身结构"类）：

| 判据 | 钉的事 |
|---|---|
| 0 | 共享实现在 `lib` 里**在**，且 `dismiss_welcome_if_present()` 里**真的还调着**它 —— 否则"调了欢迎页 helper 就算处置过"这条推定（覆盖 15 个脚本）会全部变成假绿，而门禁自己不会有任何反应 |
| 1 | 凡 `pm clear` 之后靠无障碍树驱动界面的脚本，必须**调用**得到共享处置；输出逐条打印它是**怎么**成立的（直接调 / 经欢迎页 helper） |
| 2 | 任何脚本里名字含 `consent` 的函数**不得**自己 `input tap` —— 那是第二份实现 |

🔴 **它前两次都是恒过的**，两次都因为我判"在不在"用了名字而不是形状：

1. 第一版把"驱动界面"写成 `(xy_desc|xy_text|…)\s*\(`，而 shell 里的调用是
   `$(xy_desc "邮箱")` —— 名字后面跟的是空格和引号，**一个脚本都没被认出来**，
   于是它打印「冷启动驱动界面 0 个」然后 ✅ 通过。
2. 改完之后再跑变异 A（把 `auth` 的调用整行删掉）**仍然 RC=0**：
   `src.includes('handle_privacy_consent')` 命中的是**脚本文件头里那句注释** ——
   正是我为了让下一个人看懂为什么必须有它而写的那句话。
   ⇒ 注释提到 ≠ 调用了。两处都改成"剥掉注释行 + 按行首调用形状匹配"。

（§7 元规则二又添一种面目：**判据写错时最省事的通过方式，是让它什么都没看见**。）

### 13.5 变异数字（五条各注入一次，还原后复跑）

| 变异 | 结果 |
|---|---|
| A 拿掉 `verify-mobile-auth.sh` 的调用行 | **RC=1**，指名 `scripts/verify-mobile-auth.sh 冷启动后驱动界面，却没有任何一处走到隐私面板的共享处置` |
| B 往 `verify-mobile-tags.sh` 塞一份带 `input tap` 的本地处置 | **RC=1**，指名 `scripts/verify-mobile-tags.sh:63 my_local_consent_handler() 自己点了按钮` |
| C 把共享调用从 `dismiss_welcome_if_present()` 里摘出去 | **RC=1**，打的是判据 0（"这条推定现在不成立了"） |
| D 删掉 `verify-mobile-task-row.sh:87` 的 `CONSENT_GATE_PREFERRED=只用本机` | **RC=1**，判据 3 指名那个脚本 |
| F 给 `verify-mobile-sort-sheet.sh` 末尾加一行惰性的 `: wait_laptop_has` | **RC=1**，判据 4 指名那个脚本 |
| 五份还原 | 复跑 **RC=0**；两份注入过的脚本 `cmp` 与注入前备份**逐字节相同**（`task-row` sha `e06f0079…`、`sort-sheet` sha `9434b8d7…`，与注入前后一致） |
| 分母 | 扫描 21 个安卓验收脚本（排除 `-ios`：另一套无障碍技术），其中冷启动驱动界面 **21 个**，全部列出各自的成立方式 |

🔴 **D 第一次注入注错了对象，而且注完差点被我读成"变异不成立"**：
我先删了 `verify-mobile-sort-sheet.sh:70` 那行 `CONSENT_GATE_PREFERRED=只用本机`，门禁 **RC=0** ——
这不是判据 3 没牙，是**那条脚本本来就不满足判据 3 的前提**。判据 3 要三样同时在场：
脚本**自己**按行首形状点名本地按钮（`task-row:94 handle_privacy_consent "只用本机" "以后再说"`）
**且**调 `dismiss_welcome_if_present` **且**没设 `CONSENT_GATE_PREFERRED`。
`sort-sheet` 只有后者（它靠欢迎页 helper 收面板，没有自己的点名行），摘掉 pin 之后它退化成
"完全跟着库的默认走" —— 没有信号、也就没有矛盾，门禁**不该**报它。
⇒ **判据 3 的有效覆盖面现量 = 4 个**（`reminder-ring`、`schedule`、`task-row`、`timeline`：
既自己按行首点名本地按钮、又调 helper、又设了 pin），
`quadrant-fill` 与 `sort-sheet` 只有 pin（靠 helper 收面板、自己没有点名行）——
摘掉 pin 之后它们退化成"完全跟着库的默认走"，没有信号也就没有矛盾，
**这两条由判据 4 管而不是判据 3**。六个点名的总数不变（4 + 2 = 6）。

🔴 **数这六个时先用 BSD grep 得到 0**：`grep -cE '^[[:space:]]*CONSENT_GATE_PREFERRED=("?(只用本机|以后再说)")'`
对已知在场的那行（`sort-sheet:70`）**恒 0 命中**，而同一条去掉交替组的模式命中 1 ——
这台机器的 `LANG`/`LC_ALL` 都是空，交替组里两条中文串让 BSD grep 的 ERE 直接判不匹配。
换成**门禁自己那枚 JS 正则**现量才得到 6 / 21。⇒ 数中文模式要么走 node，要么别用交替组；
一次"0 命中"在宣布结论前要先拿一行已知在场的样本喂同一条命令（这就是阳性对照）。

🔴 **同一次操作里差点写下第二个假读数**：我把整条串成
`… && grep -c 'CONSENT_GATE_PREFERRED=' "$F" && node gate; echo RC=$?` ——
`grep -c` 在 0 命中时**退出 1**，`&&` 链当场断掉，门禁根本没跑，而打印出来的 `RC=1`
看起来正好是"变异让门禁转红"。⇒ 判"门禁红"只认**门禁自己的**退出码与它输出的那行指名，
测量前后各打一次注入状态（本条最终写法：先 `grep -c` 单独成句、再单独跑 `node gate`）。

### 13.6 顺带照出来的两件载体不新鲜（同一条纪律：远端字节 == 本地提交）

- **盘上那枚 APK 是 03:21 打的**（md5 `f19dfadfcc8f1123cd36592720595bdd`），
  而 `bb41e9fe`(07:16 `refactor(mobile-ui)`)、`ab13c22e`(09:38 `packages/ui`)、
  `a29881e9`(09:44 合入倒数日批次一动了 `app-host`/`domain`/`op-log`)、
  `bf271a1e`(10:55 i18n 词条) 全在它之后 ⇒ 直接跑就是"验旧产物报新结论"（§7 第 27 条）。
  主检出的工作树正被别的会话的日历改动占着（`packages/ui/src/calendar/*`、
  `packages/op-log/src/*` 等未提交），就地打会把别人的在飞源码混进包里，
  所以在隔离检出 `/private/tmp/heyta-g8-clean` 上 `git checkout --detach f4fe87d2`、
  断言**脏文件数 = 0** 之后重打：`md5 8a1d9654b397f3823d2bff0a0053238b`，11:18:29。
  为此给 `verify-mobile-auth.sh` 加了 `HEYTA_APK` 覆盖点（沿用
  `verify-mobile-quadrant-fill.sh:100` 已有口径，不改 lib 里那条共享路径）。
- **两台在跑的服务端都比今天的 `server/src` 旧**：`:3000`（pid 87593，10-02 18:56，
  `/api/account/legal-consent` → **404**）与 `:3100`（pid 58679，10-03 01:35 → 401）
  都早于 `b055efc0` / `7e299118` / `ce23d3ab` 那三笔 `server/src` 改动。
  本轮另起一台 `:3101`，跑隔离检出里 f4fe87d2 构建的 `server/dist`（已断言 dist 不比 src 旧），
  用完即停 —— **不动别人的那两台**。
  ⚠️ 起它的时候**没有把 `server/.env` 拷进 `/tmp`**：dotenv 读 `process.cwd()/.env`，
  所以 cwd 用主检出的 `server/`、跑的产物用隔离检出那枚 dist —— 配置原位读，代码是 HEAD 的。

### 13.6.1 顺带量出来的两条"要不要重装"的判据（省掉一轮无谓的四端重装）

- **四端装的产物到今天为止还有效吗**：`69f64ae4..HEAD`（mac 那次）与 `267ac912..HEAD`
  （另三端那次）之间的**打包输入**一共动了 11 个文件，逐个分过后只有三类：
  ① `apps/web/evidence/*`（9 枚，证据图与日志，不进包）；
  ② `apps/landing/docs/index.html` + `en/`（落地页产物，随那 11 条词条重生成过，`check:entries` 现量 RC=0）；
  ③ `packages/i18n/src/locales/{zh-CN,en}.ts`（今天那 11 条公开词条）。
- 🔴 而那 11 条**没有一条进应用壳**：逐个键去 `apps/web/src`、`apps/mobile/src`、
  `packages/ui/src`、`packages/app-host/src` 里搜（**不限扩展名**，界面常是 `.js`），
  四个集合命中 **0** —— 它们全是 `site.docs.*` / `site.help.*`，消费者只有
  `apps/landing` 的文档中心（构建期烘焙进 HTML）与 `packages/legal`。
  ⇒ 装着的那四个端**不需要为这批词条重装**；要让线上文档中心也显示新文案，缺的只是
  落地页的重建与部署（属于"部署那条线"，本批没动）。
- ⚠️ 反向留一行给下一个人：安装副本的 bundle 里**确实还能搜到旧串**
  「没有邮箱+密码这条路」（`index-CObYzQxm.js` 命中 2，两种字形各扫过）。
  那不是"界面在说旧话"，是**整张词条表被原样打进包**而没人读它 ——
  命中旧串只证明"表在里面"，不证明"界面渲染它"；要判后者得去数消费者。

### 13.7 这一轮的状态（写在这里，不靠记忆）

**12:35 那一跑拿到了负载窗口，然后整轮自判无效 —— 而它先印出两条假红、一条假绿。**
读数（`/tmp/heyta-mobile-auth-head.log`）：负载从 400+ 落到 **9.61** 命中窗口，但设备此刻被
另一条线的 `verify-mobile-repeat.sh`（`heyta-wt-closeout` 检出）占着 ⇒ `uiautomator` **连续 10 次抓不到界面**，
`/tmp/ui.xml` 被截成空文件；脚本随后按 lib 的约定打印
`❌ 拿不到真实界面 —— 本轮结果无效（环境失败，不是产品失败）` 并以 **`RUN_EXIT=3`** 收尾。**产品一条没坏。**

🔴 **这一跑照出的是我自己那两条判据是盲的**（撞见就当场修，不等下一轮）：

| 位置 | 空 dump 上的读数 | 性质 |
|---|---|---|
| 0.5 步 G-11「首启必须问」 | ❌「冷启动**没有**征求隐私同意」 | **假红** —— 会响，至少自己会说话 |
| 第 7 步「决定跨启动落盘」 | ✅「再冷启动没有重复征求」 | **假绿** —— 不响：空 dump 上 `privacy_gate_present` 为假 ⇒"没再问"**无条件为真** |
| 第 7 步「欢迎页没有回来」 | ✅ | 同一个空 dump，紧接上一条，同样性质 |

两处各补一行 `require_screen`（0.5 在判"问没问"之前先 `dump` + 要一张真界面；第 7 步在
`launch_app` 之后、那两条缺席断言之前）。**"缺席即为真"这类断言在空界面上恒成立**，
假绿那条比假红贵 —— 它印的是 ✅，§7 元规则二说的正是这个形状。
同轮还核了另外两处缺席断言（`:396` 服务端没建号、`:436-438` 界面没有那四句断言性文案）：
前者读的是库不是屏，后者要走到那一步得先 `scroll_to_desc` 抓到真节点 ⇒ **构造上自带数据门控**，不改。

🔴 **另一条改的是链自己**（`/tmp/run-mobile-auth-v2.sh`，不入库）：上一版把隔离检出的 HEAD
**钉死成 `f4fe87d2`**，而 main 一直被兄弟会话推进 ⇒ 重跑会红在"提交不等于我上次记的那个数"上，
那既不是产物问题也不是产品问题。改成**可核对的关系**：`ISO HEAD` 必须是 `main` 的祖先
（`merge-base --is-ancestor`），两边 sha 与「应用侧源码差集」逐枚打印；差集里只要有一枚落在
`auth|login|password|credential|privacy|consent` 路径上就 `RUN_EXIT=5` 拒绝起跑。
本轮现量：`f4fe87d2`（脏 0）是 `3603db71` 的祖先，差集 **2 枚**（`NotificationsScreen.tsx`、
`SettingsScreen.tsx`），逐行看过是 `View + gap` → `Stack`/`HStack` 的**纯容器替换**
（`testID="privacy-consent-section"`、`inbox-notifications-list` 原样保留、零文案变化）⇒ 载体可用。
另外窗口命中后新增 **C2 设备预检**（连抓 3 次 uiautomator，且 `dump` 报成功之后还要
`exec-out cat` 里真有 `<hierarchy>` 才算数），把"跑了一半才发现设备不可用"压成"30 秒内退回等窗口"。

**v2 那一跑截至本节写作时还没有读数**；在它打印出 `RUN_EXIT=` 之前，本节不写任何"移动端全绿"的结论。
等满窗口同样以 `RUN_EXIT=3` 结束 —— 那是**环境不成立**，不把 `≤12` 的阈值调低去挤进窗口。
链与读数：`/tmp/heyta-mobile-auth-v2.log` = `A 产物来源核对（关系式）→ B 起/复用 :3101 的当前源码服务端
→ C 等负载窗口（60 轮 = 30 分钟）→ C2 设备预检 → D HEYTA_APK=<ISO 那枚> bash scripts/verify-mobile-auth.sh`。

🔴 **没做完的一件事，按"未量"登记而不是写个 0**：其余 20 个安卓脚本里同一类"靠缺席判通过"的断言
有多少条**没有**先闸住真载体 —— 面积**没有量出来**。两次静态形状都失败了，而且都是被
**我自己已知在场的那一条**（`verify-mobile-auth.sh:601` 那条 `has_desc/has_text … = "1" ⇒ else ok`）证伪的：
① 按措辞抓 `hasnt_` / `if !` ⇒ 报 0；② 按结构抓"`then` 支先 `bad`、`else` 支是 `ok`"⇒ 仍报 0，
因为条件里是 `$(has_desc "$L_OFFLINE")` 这种**嵌套双引号**，而且那条是 `… ] || [ … ]` 的**两测条件**，
我的正则两头都没处理。⇒ 这件事要么写一个认得 shell 引号/`||` 的真解析（成本高，而且这些脚本正被
兄弟会话改着，量出来的数一落地就过期），要么**逐个人工过一遍**。**在有人做完之前，这一项是敞口，不是"已确认没有其他条"**。

🔴 本节的另一条教训（写下来是因为我自己又踩了一次）：**运行中的 bash 脚本不许编辑**。
第一条链在等窗口时我改了 `/tmp/run-mobile-auth-head.sh`，bash 按字节偏移续读 ⇒
日志里冒出 `line 77: /legal-consent)（401… : No such file or directory`，
那条链之后的行为不可信，只能整条杀掉重来（仓里 `verify-mobile-*.sh` 的
`HEYTA-SNAPSHOT-BOOTSTRAP` 就是为了这件事，而 `/tmp` 的手写链没有它）。

---

## 14. 线上部署的那套载体是哪一年的（2026-10-03 现量）

起因是"用户能不能直接打开线上站点验注册登录"。答案要用**年代**回答，不能用"部署过了"回答。

**探针口径**：不用界面文案（整张 `packages/i18n` 词条表都被原样打进包，命中只证明"表在里面"，
不证明"界面渲染它" —— §13.6.1 已经为这件事栽过一次）；用**线协议路径常量**，
它们只出现在真的调用它的那段代码里（`packages/app-host/src/hosted-auth.ts:81` 的 `HOSTED_AUTH_PATHS`）。

| 探针 | 本地 `apps/web/dist`（10-03 11:13 构建） | 线上 `/app/` 入口 bundle | 落笔时刻 |
|---|---|---|---|
| `login/email-password` | 1 | 1 | 10-01 19:14（`abcd2238`） |
| `password/set` | **1** | **0** | 10-01 23:10（`b75be397`） |
| `account/legal-consent` | 1 | **0** | 10-02 08:46（`881aa92a`） |

线上那枚 `index-AYTzWCmT.js` 的 `Last-Modified: Thu, 01 Oct 2026 13:00:56 GMT` = **10-01 21:00（本地时刻）**
⇒ **线上部署的 web 应用是 10-01 21:00 那次构建**，缺三件事：给 passkey-only 账号加第一个口令的入口（`/password/set`）、
首启法务同意闸门（G-11/G-12）、以及其后的一切。

服务端比它新一点，但**同样旧**：

| 线上 `heyta.waytofuture.cn` | 本机 `:3101`（当前源码构建） | 判读 |
|---|---|---|
| `POST /api/password/set` → **401** | 401 | 路由在（10-01 23:10 那笔已上线） |
| `GET /api/account/legal-consent` → **404** | 401 | 路由**不在** |
| `POST /api/account/legal-consent` → **404** | 401 | 同上 |

🔴 **404 必须两个方法各打一次**：Fastify 对"路径在、方法不对"**也回 404**（报文里带着
`Route GET:/api/… not found`），所以单看一个方法的 404 判不了"路由不存在"。这一条是靠
**同机同路径的本机 :3101 做对照**（两条方法都回 401）才定案的，不是靠那一个状态码。

**结论与处置**：

- 现在**不要**把线上站点当作"当前源码的 web"来验注册登录 —— 它是 10-01 21:00 的应用。
  要验就用本机的四个端（装着的那套 = `f47e65ca`，认证那条路自那之后**零改动**，见 §13.6.1 与本节表格），
  或我起的这台 `:3101`（当前源码构建的服务端）。
- 🔴 **反向风险**：拿**当前源码**的应用去连**线上**服务端会在法务同意那一步打到 404
  （`hosted-auth.ts:121` 那条 `accountLegalConsent` 是要发请求的）。这不是"能不能注册"的问题，
  但会是"点了同意之后一条 404"，容易被误读成产品坏了。
- 补齐它属于**部署那条线**（本批没做，也不该由我在别人可能在发版的时候顺手做）：
  `apps/web` 重新构建并部署 + 服务端镜像重建走 `server/scripts/deploy.sh`，
  步骤与两个必须记住的坑见 [`../runbooks/deployment.md`](../runbooks/deployment.md) §3.7。
  ⚠️ 本节只登记年代与判据，**不构成"已经重部署"**。
