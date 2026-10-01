# 邮箱 + 密码登录：落地计划

> 状态：**规划中**（2026-10-01 立）
>
> **归属**：本篇是 [`user-journey-and-auth.md`](user-journey-and-auth.md) 的**下游工单**，只负责"密码"这一条认证方法。
> A1–A8 的服务端语义、各端宿主形态、J1–J7 判据**仍以那份为准**；本篇需要它改的地方列在 §10。
> 决策落点：需新增 **ADR-0040**（取代 [ADR-0039](../adr/0039-email-first-auth-and-desktop-reverse-authorization.md)
> §1.4/§2.5 里"本 ADR 不引入密码……若将来要加，是新决定"那一段）。ADR 只增不改。

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

服务端存 `Argon2id(pepper ‖ 密码)` 的**校验值**，口令继续由客户端本地派生（`encryption/argon2.ts:203`）。

**为什么不解成一把**（Proton/Bitwarden 那种"主密码同时是 vault 根"）：那是体验最优解，但**必须同时上恢复码**，
否则"忘记密码 = 数据永久不可达"（Cryptomator 官方原话："We cannot reset the password of a vault for you in any way"）。
解耦之后：**重置密码不会毁任何数据**，口令丢失的风险面和今天完全一样、没有新增。
代价是用户要理解两个秘密 —— 这一条由 §5 的术语与帮助页正面处理，并靠 D2 把"每次重输口令"的痛点消掉。

**方向仍是合流**：WebAuthn 的 **PRF 扩展**能让 passkey 直接派生 E2EE 密钥（Bitwarden 已经这么做），
本轮不做，登记为 §11 的下一条。

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

- `sendPasswordResetEmail` → `${PUBLIC_URL}/reset-password?token=…`，`withLocale` 带上语言；语言优先级链不变（`?lang=` > 账号 `locale` > `Accept-Language` > `zh-CN`，`design-html.ts:76-99`）。
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
🔴 **不塞进本轮顺手改**，按 §11 单独立案；本轮只保证**密码这条新路径**自洽：设置与校验**同一个地方、同一次 NFKC**，两处共用一个函数。

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
7. `packages/shared-schema` 里那个 `'PASSWORD_CHANGED'` 的 import reason（`supersync-http-contract.ts:26`）今天只有 fixture 在用 —— 本轮要么真正接上（改密后要求客户端带 reason 重传），要么删掉，**不许留着当装饰**。
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

---

## 11. 下一步

按 W0 → W9 顺序推进。W0 是探针，半天内能出结论，且**它的四条否定结果都可能改写上面的表**
（尤其是 1、2、4）。W0 之后任何一步想偏离本篇，先改 `user-journey-and-auth.md` 并写明理由。
