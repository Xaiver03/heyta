# ADR-0040：登录口令**只用于认证**，与 E2EE 口令解耦；Argon2id + pepper 落进已有的可空列；口令进系统钥匙串；对 NIST「≥15 字符」的偏离由三道补偿控制兜住

> 状态：**已接受**（2026-10-01）
> 取代：[ADR-0039](0039-email-first-auth-and-desktop-reverse-authorization.md) §1.4「密码这条路**不存在**」与
> §2.5「不引入密码」里那句"**若将来要加，是新决定**" —— 本篇就是那个新决定。
> ADR-0039 的**其余**结论（邮箱链接全链路、桌面反向授权、手机号只留位）一条没动。
> 触发修订：[ADR-0029](0029-refuse-to-delete-last-passkey.md) 的判据因此落后于产品状态，由
> [ADR-0041](0041-last-passkey-guard-keys-on-any-usable-entry.md) 换掉（**取舍保留**）。
> 相关：[ADR-0030](0030-passkey-not-found-existence-oracle.md)（存在性预言机的既有先例与判法）、
> [ADR-0036](0036-main-battlefield-and-rn-single-source-ui.md)（UI 单源）
> 落地计划：[`../plans/email-password-auth.md`](../plans/email-password-auth.md)（D1–D5 的原文、W0 五条探针、判据 J1′–J17）

---

## 1. 背景与约束

### 1.1 产品负责人的指令（2026-10-01）

> 「邮箱密码登录**一定要做**。我们现在 SMTP 应该都有了。按最好的 UI/UX 来。」

三个岔路已拍板（都选了下面这个方向，不是本文替她选的）：登录口令与 E2EE 口令**解耦**、
口令进**系统钥匙串**；范围是**全套**（注册/登录/改密/找回/全设备登出/防爆破/泄露口令拦截/令牌哈希化）；
界面走**单邮箱字段 +「继续」+ 口令为主**，passkey 收进 autofill 与二级文字链。

### 1.2 量出来的事实（这些决定了结论，不是偏好）

| 事实 | 出处 |
|---|---|
| 生产里**从来没有**口令认证：`server/src/auth.ts` 零 bcrypt、零口令校验，建号一律 `passwordHash: null` | 立计划时实测 |
| 但 `users.passwordHash` 是**已存在的可空列**，`resetPasswordToken` / `failedLoginAttempts` / `lockedUntil` 三列与索引都在 —— 只是**没有任何生产路由写过它们** | `schema.prisma` |
| 🔴 `failedLoginAttempts` 全仓**只被清零、从没递增**；`lockedUntil` 只有后台读来显示"锁定" | 立计划时实测 |
| 🔴 **一条真缺陷**：验证/登录/找回令牌**明文入库、按值查询** ⇒ 一次数据库读等于全站账号接管 | `auth.ts` 原 `where: { verificationToken: token }` |
| 登录凭据与 E2EE 口令**今天就已经彻底解耦**：口令只在客户端内存，服务端从不接收，JWT 不参与任何密钥派生 | `packages/sync-client/src/client.ts`、`packages/sync-core/src/encryption/argon2.ts` |
| E2EE 的 KDF 已经是 Argon2id `t=3 / m=64 MiB / p=1`，**高于** OWASP 给口令校验的最低值 | `packages/sync-core/src/encryption/argon2.ts` |
| 口令四端**都不落盘**，移动端每次冷启动要重输 —— 这是"解耦"这个选择今天真实的体验代价 | `apps/web/src/features/sync/credential-storage.ts`、`apps/mobile/src/sync/config.ts` |
| SMTP 生产可用且实测真投递 | [`deployment.md`](../runbooks/deployment.md) §3.9 |

⚠️ 前提：heyta 还在开发阶段、没有存量用户（AGENTS §0），所以"兼容在途凭据"**不作为约束** ——
把三类令牌从明文换成哈希、并作废所有已发出的链接，是可以直接做的。这条前提在开发阶段结束后失效。

---

## 2. 选项

### 2.1 两个秘密是一把还是两把

| 选项 | 优点 | 缺点 / 否决理由 |
|---|---|---|
| A. **一把主密码**同时认证 + 派生 vault 根（Proton、Bitwarden） | 体验最优：只记一个秘密；重置即换根 | 🔴 **必须同时做恢复码**，否则"忘记密码 = 数据永久不可达"（Cryptomator 官方原话："We cannot reset the password of a vault for you in any way"）。本轮没有恢复码，选 A 等于把这条风险直接交给用户 |
| **B. 两把，解耦；口令进钥匙串**（选定） | **重置密码不毁任何数据**；口令丢失的风险面与今天**完全一样**、零新增；D2 把"每次重输"的痛点单独消掉 | 用户要理解两个秘密 ⇒ 由 §5 的术语命名与帮助页正面处理，不靠沉默 |
| C. 不加口令，只留 passkey + 魔法链接 | 零新增攻击面 | 产品负责人明确否决；且 ADR-0039 的桌面实测显示**壳里 passkey 根本不可用**（`NotAllowedError: The document is not focused`），"只留 passkey"在多端是不成立的 |

**方向仍是合流**：WebAuthn 的 **PRF 扩展**能让 passkey 直接派生 E2EE 密钥（Bitwarden 已这么做），
那时两把自动收敛成一把。本轮不做，登记在 §7。

### 2.2 口令怎么存

| 选项 | 否决理由 |
|---|---|
| 沿用 TEST_MODE 的 `bcryptjs` | bcrypt 非内存硬、**72 字节截断**与 NIST"≥64 字符、禁止静默截断"直接冲突；绕过截断要先预哈希，而 OWASP 明确说裸 `bcrypt(H(pw))` 危险（空字节碰撞 + password shucking）。**footgun 比 Argon2id 多** |
| Argon2id + **HMAC 预哈希** | 预哈希存在的唯一理由是绕开 bcrypt 截断，Argon2 对输入长度没限制 ⇒ 绕一步只多一处能写错的地方 |
| Argon2id + `node:crypto` scrypt 兜底 | 留两条哈希族 = 同一句口令在两台服务器上可能解不开，而"降级"恰恰发生在运维最忙的时候。W0 实测 musl 在**生产形状**里逐字节正确 ⇒ 兜底不需要，改用启动 known-answer 自检（§3.3） |
| **Argon2id，pepper 作为原生 `secret` 参数，存 PHC 自描述串**（选定） | — |

### 2.3 要不要 SRP / PAKE

正解（Proton 自 2016 起全部登录用它、1Password 用它 + Secret Key），但 Node 生态
`srp-js` / `node-srp` / `secure-remote-password` / `oprf` **最后发版全停在 2022-05/06**，
AGENTS §3.1 的可维护性门槛**一票否决**；而协议的形式化分析 2023 年才补齐（IACR 2023/1457），
自研等于自己养一个协议。**结论：不做**，走 §2.1-B + "服务端只存校验值"，
它拿到 SRP 的大部分收益而不背它的维护债。

### 2.4 爆破限制锁什么

| 选项 | 否决理由 |
|---|---|
| 锁**账号**（所有登录方式一起拒） | NIST SP 800-63B §3.2.2 的立场是限制**该 authenticator**。锁死账号等于把合法用户交给攻击者做 Denial-of-Account：攻击者拿别人的邮箱喷错口令，就能把真主人关在门外 |
| **只禁用"口令认证器"**（选定）；魔法链接与 passkey 照旧可走 | — |
| 只靠 IP 限流 | 分布式喷洒（一句常见口令 × 一万个邮箱）每个账号只掉一次计数，IP 层拦不住；而 NAT 后第 6 个正常用户会被前 5 个人的拼写失误连带挡掉 |

---

## 3. 结论

### 3.1 D1 登录口令**只用于认证**

服务端存 `Argon2id(口令, salt, secret = pepper)` 的**校验值**；E2EE 口令继续只在客户端本地派生，
服务端设计上看不到用户明文这条立场**一个字没改**。
后果写死在一句话里：**重置登录口令不会让任何数据不可读**。

### 3.2 D2 口令进**系统钥匙串**（Web 除外）

| 端 | 机制 |
|---|---|
| macOS 壳 | `SecItemAdd`（壳已有钥匙串能力位） |
| Windows 壳 | Credential Manager（`CredWrite` / `PasswordVault`） |
| iOS / Android | `expo-secure-store`（MIT，57.0.4，2026-09-29 发版）。🔴 **不用 `react-native-keychain`**：MIT 但停在 2025-03-23，按 §3.1 排除 `cal-heatmap` 的同一先例应判不合格 |
| node-host | 复用 `apps/node-host/src/keychain-secret-store.ts`（原本只给 AI BYOK 用） |
| **Web** | **不假装**：token 进 `localStorage`，口令仍只在内存 |
| Linux / 鸿蒙 | 不做专项（Linux 定位是"同架构但不做专项功能"；RNOH 无 secure store） |

🔴 这一条**精确化**了既有措辞：`user-journey-and-auth.md` §7 第 4 条写"不把 E2EE 口令落盘"，
而同文件 §4 的表却给移动端指定 Keychain 并写"绝不明文落盘" —— 两句在字面上打架。
裁决后的规则：**不得以可读形式落盘；允许 OS Keychain / Keystore / Credential Manager 这类
操作系统级加密托管；Web 例外，仍只在内存。**

### 3.3 D3 哈希：Argon2id（OWASP 最低值）+ pepper 作 `secret` + PHC 自描述串

- 参数 `m=19456 KiB, t=2, p=1, len=32`（OWASP 2025 口令存储表对 Argon2id 的**最低**推荐），
  实现 `@node-rs/argon2`（MIT）。
- 存 **PHC 模块化串**（`$argon2id$v=19$m=…$salt$hash`）进**已有的** `passwordHash` 列
  ⇒ **不加列、不 bump `CURRENT_SCHEMA_VERSION`**；算法与成本跟着哈希串走，将来抬参数时按前缀分派
  验证并在**登录成功时重算**（`needsRehash` 用库的 `parseOptions()` 判，不自己解析字符串）。
- pepper（`PASSWORD_PEPPER`，env，不进库；缺失或过短 ⇒ 启动即失败，与 `JWT_SECRET` 同一纪律）
  作为 Argon2 的**原生 `secret` 参数**参与哈希。W0 实测：同一组固定输入下
  **macOS glibc 原生 / 生产 musl 原生 / 纯 JS `@noble/hashes`** 三家输出**逐字节相同**。
- **启动 known-answer 自检**（`assertPasswordBackend()`）：跑固定口令/salt/pepper，
  PHC 串与裸摘要必须等于钉死的字节，不等或抛错 ⇒ **启动即退出**。
  🔴 宁可起不来，也不要"能起、第一个用户点登录时 500"。它的角色是**长期的架构不变量守卫**
  （换基础镜像、换 CPU 架构、依赖漂移时当场响），不是弥补探针没跑完的赌注。
- **并发闸门**：Argon2 太贵 ⇒ 登录洪水会打成自伤 DoS。哈希并发限制在 `cpus-1`（自写信号量，零依赖）。
  纯 JS 对照在 OWASP 最低参数下 **8 671 ms** ⇒ 服务端**排除**纯 JS（一次登录 8 秒 = 自我 DoS）。

### 3.4 D4 不做 SRP / PAKE（理由见 §2.3）

### 3.5 D5 爆破与撤销：禁用"口令认证器"，不永久锁号

- 已有列**真正用起来**：失败递增 `failedLoginAttempts`；达 **5 次** ⇒ `lockedUntil = now + 15 min`，
  期间**只拒绝口令认证**（`password/service.ts` 的 `MAX_FAILED_LOGIN_ATTEMPTS` / `LOGIN_LOCKOUT_MS`），
  魔法链接与 passkey 照常。成功即清零。运营出口复用既有 `POST /api/admin/users/:id/unlock`，**不新建**。
- 路由级限流（注册/登录 50/15min per IP）**叠加**在账号计数之上，各管各的（§2.4 第三行）。
- 🔴 **反枚举**：账号不存在 / 没有口令这个认证器 / 口令错，三者回**同码同文案**（`invalid_credentials`），
  且前两条也**各真跑一次 Argon2 校验**（对固定 dummy PHC 串）把耗时对齐（OWASP 要求 identical response time）——
  否则"这个邮箱没设口令"又是一个计时特征。
  ⚠️ 对**不存在口令的账号不计数、不锁定**：一次枚举会把无辜账号的 `lockedUntil` 写上，
  那正是 §2.4"锁认证器不锁账号"要防的事。
- **锁定期过后计数一并作废**：不作废的形状是"用户老实等了 15 分钟，回来打错**一个**字又被锁 15 分钟，
  而界面上没有任何东西能解释为什么一次就锁上了"。上游契约「5 次失败锁 15 分钟」读起来就是
  "窗口过后重新数 5 次"。
- **撤销**：改密 / 重置 ⇒ `tokenVersion++`。它已经 gate 每一条 JWT 且 `auth-cache` 以它为键，
  所以**这正是"所有已连接设备都要重新认证"**，不需要新机制；当前设备由 `/password/change`
  当场换一枚**读回来的**新号令牌，不中断。
- 🔴 客户端在令牌失效后的行为是**产品要求**，不是边缘情况：**停止上传、本地数据继续可读、
  界面提示"重新认证"、绝不自动清库**。落地方式是新增一个 `SyncFailureReason: 'unauthorized'`
  且 **`retryable: false`**（`packages/sync-client/src/client.ts`）—— 在此之前 401 被归成
  `retryable: true`，退避调度器会**拿着已作废的令牌永远重试**，界面上显示的是"同步失败"这句谎话。
  封闭枚举让两个壳的 `switch` 被编译器逼着改，这是选它而不是选"字符串匹配"的理由。

### 3.6 令牌哈希化（与 D3 同一刀）

`verificationToken` / `loginToken` / `passkeyRecoveryToken` / `resetPasswordToken` 四列
**一律改存 SHA-256 hex**，按哈希查（已有 `@@index` 直接可用）。
配一条清理迁移把现存非空 token 置 null —— **在途链接全部作废**，15 分钟 TTL，
在开发阶段可接受（§1 前提）。这一条修掉的是 §1.2 里那条真缺陷。

### 3.7 界面：一份共享组件，两个秘密各有名字

- 表单落进 `packages/ui/src/auth/AuthForm.tsx`（[ADR-0036](0036-main-battlefield-and-rn-single-source-ui.md)
  §10.3 欠着的"组件那一半"）。🔴 **不许写四份表单** —— §3.5 那个"抽了新版、旧版从没删"的错不重犯。
- **单邮箱框 +「继续」**，口令紧随其后（FIDO 2023 UX Guidelines：一个 affordance 同时管注册与登录）。
- passkey 从大按钮**降级为文字链** + 浏览器 autofill（依据同上：autofill 成功率最高，
  而"专用 passkey 按钮"因人们记不得自己建过而没被发现）。**降级不等于删除**，三条路都在 DOM 里。
- **两个秘密两条词条**：`common.auth.signInPassword.label`「登录密码」与
  `common.auth.e2eePassphrase.label`「加密口令」，绝不共用一个"密码"字样 ——
  前者点一封邮件就能重置，后者**不可恢复**（§7 第 3 条）。一句话指两样东西的界面，
  会让人以为自己忘了登录密码也就忘了数据。
- 显隐默认档：桌面默认遮、移动默认显示（NNG《Stop Password Masking》+ NIST），两档都保留开关。
- 🔴 **没有 `maxLength`**：NIST 禁止静默截断口令输入；超长由服务端按**码点**判并给 `too_long` 那句。
- 错误必须是文字（WCAG SC 3.3.1）+ `aria-live` 播报 + **保留已输入内容** + 焦点移到第一个错误字段。
- **不禁用按钮**，用 in-flight guard（NNG：禁用态让人困惑；提交后禁用会丢焦点）。

---

## 4. 与规范的关系：一条**有意的偏离**，和它的前提

按 NIST SP 800-63B Rev 4 执行的部分：允许全部可打印 Unicode、每个 code point 计 1 位、
上限 256（要求 ≥64）、**禁止组成规则**、**禁止定期强制更换**、不做 hint / 密保问题、
不做红框式强度条（Troy Hunt：强度条推着用户做 `P@ssw0rd1!` 式选择）。
归一化：NFC 后再 NFKC，**设置与校验同一个函数、同一次归一化**（`password/policy.ts` 是唯一口径）。

🔴 **偏离**：Rev 4 对**单因子**口令的要求是 SHALL ≥15 字符，15 只在对口令加盐（多因子）时放宽到 8。
产品负责人定的下限是 **8 个码点**（`AUTH_PASSWORD_MIN_CODE_POINTS`，唯一真源在
`packages/shared-schema/src/auth-http-contract.ts`，四端与服务端共用同一个数）。
**偏离成立的前提就是下面三道补偿控制必须同时存在，缺一即打回**：

1. **本地常见口令表精确匹配**：`@zxcvbn-ts/language-common` 的 `passwords-common`（49 233 条，MIT）。
   🔴 只当黑名单用，**不引入 `@zxcvbn-ts/core`、不把它的"分数"做成门槛** —— 分数门槛本质是
   组成规则的另一种写法（它会因"含日期"拒掉一个 20 字符的 passphrase）。这是**确定性的那一道**，零网络、每次必查。
2. **泄露口令检查**：HIBP `range` 接口（k-匿名，SHA-1 前 5 位出网，完整哈希与口令都不离开服务器）。
   W0 在生产主机（腾讯云，国内出口）实测 6 次全 200、耗时 **0.94–2.71 s**
   ⇒ 原计划的"1 s 超时"会把**一半以上有用的查询在结果回来之前砍掉**。改成三条：
   **只在"设口令"的那一刻查**（注册 / 改密 / 重置），🔴 **登录路径一律不查**（把 2 秒外部依赖挂在
   认证热路径上是自我 DoS，NIST 也不要求）；超时 **2000 ms**；仍 fail-open，
   但 **必须留一条 warn 日志** —— 没有它，"检查通过"与"根本没检查成"事后不可区分。
3. **账号级失败锁定**（§3.5）。

🔴 因此产品文案**不许**把 heyta 描述成"符合 NIST 800-63B"。允许的说法是行为级的：
「我们只保存不可逆的校验值，看不到你的密码」。

---

## 5. 与 ADR-0039 的两处**故意不一致**

| # | 不一致 | 理由 |
|---|---|---|
| 1 | 重置口令成功后**不发会话**（`/password/reset` 只回"去登录"那句），而 ADR-0039 的"验证即登录"照旧 | OWASP 明说 don't auto-login after reset：重置发生的那一刻正是高风险时刻（能触发重置的前提是邮箱已失守），而这条路径的终点本来就该是登录页。**验证邮箱**与**重置口令**的信任级别不同，所以两条路不同结果，不是漂移 |
| 2 | 未验证账号给**可区分**提示（`email_not_verified`：「口令验对了，请先点我们发到你邮箱的验证链接」），而"邮箱不存在 / 口令错"仍然同码同句 | 边际泄露是"该邮箱已注册且未验证"。理由是刚完成注册的人必须能自救 —— 否则他把正确的口令反复重打，而那句"邮箱或密码不正确"是**假的**。判法与 ADR-0030 里 passkey not-found oracle 的既有先例一致：**只为"用户此刻必须知道才能自救"的信息付出泄露代价** |

---

## 6. 后果

1. 🔴 **pepper 是承重的秘密，不是可选加固**。实测：同一条 PHC 串用**不带 `secret`** 的 `verify`
   返回 `false` ⇒ `PASSWORD_PEPPER` 换掉或丢失，**存量口令全部验不过**（不是"降级还能登"）。
   它必须进部署手册与备份纪律，与 `JWT_SECRET` 同级。
2. **不 bump schema、不加列**（§3.3）；新增持久化字段那条"hydration 会炸"的纪律没有被触碰。
3. **一次数据库读不再等于全站账号接管**（§3.6），代价是在途验证/找回链接一次性作废。
4. `passkey.ts` 里那个 `if (user.passwordHash)` 分支必须**重新定义** —— 口令上线前它表示
   "这是纯 passkey 账号"，上线后它会把"设过口令"的账号误判。已随 W1 改掉（计划 §9 变异 6 钉住）。
5. **A2 的反枚举形状保持**：`/register/email-password` 对已占用邮箱回同一句中性的"去看收件箱"，
   且**不写任何东西**；`termsAccepted` 仍是 `z.literal(true)` —— 同意只能由用户做出。
6. **状态码与文案已在服务端收口**（不在各端猜）：注册 **201** + 中性文案（计划 §3 原写 202，
   落地形状以代码为准）、登录 **401** 同码同文案、找回密码**恒 200** + 中性文案、
   重置 200 **不发会话**、改密 200 换新令牌。
7. **找回的发送节流换了形状**：计划写"按账号 3/小时"，落地成
   **一张链接还没过期时不再发第二张**（`password/recovery.ts`）—— 它不需要计数器列、
   不随 TTL 漂移，而且把"连点三次"的动机（前两次没收到）直接消掉。
8. **界面单源**：一份 `AuthForm` + 三处 `autocomplete` 属性值 + DOM 层判据
   （`apps/web/tests/auth-form.spec.tsx` 41 条；变异验证 12 条坏实现各自转红）。
9. **依赖账**：`@node-rs/argon2`、`@zxcvbn-ts/language-common` 是新增产品依赖（都 MIT），
   `expo-secure-store` 随 W7 进；三者都必须在 `research/tools/license-inventory.mjs` 逐项登记 ——
   那条门禁现在**真的会判失败**（白名单外默认不合格）。
10. **落地页与帮助中心原来在宣传"没有密码"**，本轮之后那三句话是假的 ⇒ 必须改写（zh/en）
    并重跑 `gen:entries`（入口页是**提交物**，`check:entries` 逐字节比对，不许手改 HTML）。

---

## 7. 本轮不做 / 已知边界

1. **D2 的四端钥匙串还没落地**（W7）。判据是每端一条"**写入 → 杀进程重启 → 读回 → 用它解开真实密文**"（J16），
   🔴 不许用"写进了 localStorage"糊过去。**在它落地之前，"口令不用每次重输"这句话不许对用户说**。
2. **Web 端口令不持久化**（PRF 支持前不假装）。`e2e/auth-journey` 那条"`parsed.password` 必须 `undefined`"
   的断言**保持有效**，不是被本篇推翻。
3. **不做 E2EE 口令的找回**。口令丢了 = 数据不可达，与 Cryptomator / Bitwarden / Obsidian Sync 同款边界；
   这条**必须写进帮助页**，不能靠沉默含糊过去。
4. **不做 WebAuthn PRF**（两把合一的终局路径）。
5. **E2EE 口令的 NFC/NFD 缺陷本篇之外**：`packages/sync-core` 派生密钥前不做任何 normalize，
   而 `'café'.normalize('NFC') !== 'café'.normalize('NFD')` ⇒ iOS 键盘给出 NFD 时同一句话派生出**不同密钥**。
   🔴 不顺手修的理由是**存量密文**：加了 normalize 之后，用 NFD 写过 op 的设备当场解不开自己已落盘的密文 ——
   那是数据不可达，不是登录失败。修它要同时决定旧密文怎么办，是一条独立的 ADR。
   本篇只保证**口令这条新路径**自洽（§4）。
6. **不做 2FA/TOTP**（passkey 已是第二因子）；**不做手机号/短信**（ADR-0039 只留了位）。
7. **限流仍是单进程内存态** ⇒ 多副本部署前要换共享 store。
8. **JWT 365 天不改**（NIST 给 AAL1 的建议是 30 天）：改会话寿命要同时动四个壳和离线路径，
   本轮只做"可撤销"。登记为缺口。
9. **`bcryptjs` 现在是"声明了但没人用"**：两处引用都已摘掉（TEST_MODE 改用同一个 Argon2id 后端 ——
   它过去写 bcrypt 串，产品那条登录路径**永远验不过**，是只在 E2E 里现形的假账号），
   依赖条目没跟着删是因为 `pnpm install --lockfile-only` 会顺带规范化 90 行无关的 peer 后缀，
   混进认证提交会让下一位分不清哪些改动是本轮目的。⚠️ 生产镜像走 `--frozen-lockfile`
   ⇒ `package.json` 与 lockfile **必须同一个提交**改。

---

## 8. 判据（每条都要能因注入故障转红）

| 层 | 判据落在哪里 |
|---|---|
| 哈希与参数、known-answer、pepper 参与哈希、`needsRehash` | `server/tests/password-hash.spec.ts` |
| 策略：码点长度、NFKC 单一口径、常见口令表精确命中、HIBP 只在设口令时查 + fail-open 必留 warn | `server/tests/password-policy.spec.ts` |
| 注册 / 登录：同码同文案、dummy 校验对齐耗时、5 次锁 15min 且魔法链接仍通 | `server/tests/password-auth-flow.spec.ts`、`password-auth-routes.spec.ts` |
| 找回 / 重置 / 改密：重置后**不发会话**、`tokenVersion++` 让旧令牌全 401、一张未过期链接不再发第二张 | `server/tests/password-recovery.spec.ts` |
| 第四张凭据页 | `server/tests/password-reset-page.spec.ts` |
| 线协议契约（长度界限、错误码、策略码的**唯一真源**） | `packages/shared-schema/tests/auth-http-contract.spec.ts`、`server/tests/password-contract.spec.ts` |
| 宿主端口（失败归类、状态码收口、不返加密串） | `packages/app-host/tests/hosted-password-auth.spec.ts` |
| 表单的 DOM 级属性（`autocomplete` 三处、无 `maxlength`、`aria-pressed`、`aria-live`、降级位置、服务端失败不指字段） | `apps/web/tests/auth-form.spec.tsx`（41 条 + **12 条变异**） |
| 链式：注册设口令 → 收邮件 → 验证 → **用口令登录** → 同步上行 → 第二设备读到 | `scripts/verify-email-password-chain.mjs`（W9），并登记进 `check-journey-coverage` |
