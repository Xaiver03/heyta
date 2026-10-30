# 注册登录标准套件：补齐账号面

> 状态：**代码与判据侧已闭合；剩下的格要么有外部前提，要么是本线在案的对外欠账**（2026-10-08 立，10-10 12:2x 现量刷新）
> ⇒ 已闭合的那一半：换绑邮箱（服务端 + app-host + Web/移动界面 + 中英词条）、忘记密码/重置、改口令、
> 逐台撤销与"退出这台设备"的实时通道、账号注销对齐，四层判据（单元 / HTTP / SQL / **真库+真 socket**）
> 加真浏览器腿都有，且每条 🔴 判据各做过变异 —— 逐格读数在 §6，撤销那一族的现状表在 §6.73（四格全 ✅）。
> ⇒ 还开着的格，每一格写清了它等的是谁：iOS 设备腿与四端重装（等 `packages/ui` 那批入库，§5 第 11 条）、
> 法务那三句**漏披露**（本线自己欠的账，逐枚名字由 `pnpm check:legal-email-claims` 的 🟡 那行给出；
> 为什么不能从这条共享检出单面提交，见 §6.78）、帮助中心那两行挂载（等 landing 那批 ——
> 但那两行的**内容**已逐句对过实现与判据，§6.78 末段；原先那条"必须与十封联合提交"的理由已被现量否证）、
> 真收件箱那一腿（§5 第 4 条）。
> §5 第 9 条（`device_name` 没有任何客户端上报）与第 18 条那一半（`SAFE_ERROR_MESSAGES` 认不出那句兜底话）
> 已按负责人这一轮的授权拍完并落：拍板表在 §6.77，静态尺与那条被否证的第一版口径在 §6.79。
> 裁决层：[ADR-0063](../adr/0063-email-rebinding-and-per-session-revocation.md)
> 上游规范：[`user-journey-and-auth.md`](user-journey-and-auth.md)（A1–A8、§7 明确不做、J1–J7 —— **本文不改它，只补它没覆盖的动作**）
> 姊妹工单：[`email-password-auth.md`](email-password-auth.md)（它的缺口 13 由本文 W6 兑现）
> 法务联动：`packages/legal` 五份文档 + 帮助中心，见 W7

---

## 1. 本轮的起因与"缺什么"的实测答案

产品负责人的要求是：**换绑、忘记密码，整个注册登录的标准套件全都要做**，法律条文跟着更新。

四路只读侦察（服务端 / 各端界面与共享层 / 法务与门禁 / 既有 ADR 与计划）合出来的答案是：
**"标准套件"这个词比这个仓库实际缺的东西大**。逐格对照如下（✅ = 已实现且有判据）：

| 标准件 | 服务端 | app-host | web | mobile | 判定 |
|---|---|---|---|---|---|
| 注册（口令+邮箱验证码 / 魔法链接 / passkey） | ✅ | ✅ | ✅ | ✅ | 不动 |
| 登录（三条认证器 + 粘贴令牌） | ✅ | ✅ | ✅ | ✅ | 不动 |
| **忘记密码** | ✅ `/password/forgot` `/reset` | ✅ | ✅ 发信入口 | ✅ 发信入口 | **已经做完**，重置表在服务端页 `server/src/pages.ts:254` |
| 改密码（验当前口令） | ✅ `/password/change` | ✅ | ✅ `PasswordPanel` | ✅ `SecurityScreen:95` | 不动 |
| 设第一个口令 | ✅ `/password/set` | ✅ | ✅ | ❌ **无 UI** | W5 |
| 邮箱验证 | ✅ 两条链路 | ✅ | ✅ | ✅ | 不动 |
| 通行密钥 列/改名/删 | ✅ | ✅ | ✅ | ✅ | 不动 |
| **通行密钥 添加** | ✅ enrollment 两条 | ✅ | ✅ `PasskeyPanel` | ❌ **无 UI** | W5 |
| **通行密钥 恢复闭环** | ✅ 三条路由 | 发信 ✅ | 只有发信入口 | ❌ **连发信入口都没有** | W5 |
| **换绑邮箱** | ❌ **零** | ❌ 零 | ❌ 只读行 | ❌ 只读行 | **W1–W4 主菜** |
| **退出登录** | — | ❌ 无函数 | ⚠️ 只清本机 | ⚠️ 只清本机 | W3：`jti` 让"撤销这一枚"成为可能 |
| **登出所有设备** | ✅ `/replace-token`（早已有） | ❌ **客户端零调用点** | ❌ 无入口 | ❌ 无入口 | W3 |
| 逐台撤销 | ✅ 但 `revokeAllTokens`（撤一台 = 全登出） | ✅ | ✅ | ✅ | W3 把两件事分开 |
| 账号注销 + 墓碑 | ✅ | ✅ | ✅ | ✅ | **不动**（ADR-0049 已否决冷静期，本文不重开） |
| 2FA / 手机号通道 | ❌ 明确不做 | — | — | — | 不做（ADR-0040:252 / ADR-0039:117） |

另外四件在侦察里当场量出来的真缺陷，一并收进本轮：

- **D1** `POST /api/auth/email/verify`（`verifyEmailLink` 的三分流）**全仓零 HTTP 判据**；
  `/password/change`、`/password/set` 只有 service 层测试，路由层零覆盖。
- **D2** `admin POST /users/:id/logout`（`admin.routes.ts:528`）只做裸 `tokenVersion: increment`，
  **不 `authCache.invalidate`、不关 WebSocket** —— 而 `revokeAllTokens` 两样都做。症状是"管理员
  点了强制登出，那个人最长还能用 30 s 且实时连接不断"。
- **D3** 一次性令牌的过期清扫只覆盖 `pending_passkey_registrations` 与"从未验证的账号"
  （`sync.service.ts:968-996`），`users` 上那四列过期后**永久残留**（消费时才置 null）。
- **D4** `server/src/legal.generated.ts:22` 快照停在 `third-parties@1.3`，真源已是 `1.4`
  ⇒ `check:server-legal` **本轮动手前就是红的**。这是起跑基线，不是本轮造成的。

---

## 2. 批次

> 每批的收尾动作都一样：**门禁 + 一条能红的判据 + 把读数写进 §6 台账**。
> 结构重构与行为变更**不混提交**；一批一个逻辑提交。

### W1 服务端：换绑邮箱的数据与核心

| 项 | 内容 |
|---|---|
| 迁移 | 新表 `email_change_requests`：`user_id`（PK，FK→users，`ON DELETE CASCADE`）、`pending_email TEXT NOT NULL`、`old_token`/`new_token`（**SHA-256 hex**，走 `hashToken`）、两个 `*_expires_at BIGINT`、`old_confirmed_at`/`new_confirmed_at` BIGINT NULL、`requested_at`、`resend_count`。`@@unique([pendingEmail])`。普通 DDL，无 `CONCURRENTLY`（表是新的、零行） |
| 核心 | `server/src/account/email-change.ts`：`requestEmailChange` / `confirmEmailChange` / `cancelEmailChange` / `getEmailChangeStatus` |
| 生效 | 双侧齐 ⇒ 一条事务里 写 `users.email`、`is_verified=1`、删请求、`tokenVersion++`、`authCache.invalidate`、给两个地址各发完成通知 |
| 令牌 | TTL **24 h**（锚 `VERIFICATION_TOKEN_EXPIRY_MS`，不新拍数字）；冷却 **60 s**（锚 `EMAIL_PASSWORD_REGISTRATION_RESEND_COOLDOWN_MS`）；限流 **5/15min**（锚 `/replace-token`） |
| 反枚举 | 换绑全程 Bearer 已认证 ⇒ 按 ADR-0040:139-159 那条既有论证（`no_password_set` 只在已认证接口出现就不构成枚举面），**允许**区分"该邮箱已被占用"与"这就是当前邮箱" |
| 发信失败 | 回滚令牌（照 `recovery.ts:147` / `auth.ts:467` 的形状），不许留下"库里等着、邮件没出去"的死请求 |
| 不做 | 不留 `previous_email`（ADR-0063 §2.3）；审计只落 `userId` + 事件名 |

**判据**（每条都要能红）：
`J-W1a` 只点一边 ⇒ `users.email` 一字不变 · `J-W1b` 两边都点 ⇒ 恰好生效一次（重复点击不第二次生效）
· `J-W1c` 落库的是那句发出去的信令的 SHA-256，**不是**明文（两个出口对照，照 `password-recovery.spec.ts` 的形状）
· `J-W1d` `pending_email` 撞已占用 ⇒ 拒且不改库 · `J-W1e` 策略/查重在**消费令牌之前**
· `J-W1f` 发信失败 ⇒ 不留活请求 · `J-W1g` 生效 ⇒ `tokenVersion` 恰好 +1 且**响应里没有会话**
· `J-W1h` 过期 ⇒ 与"从没有过"同一句（不区分） · `J-W1i` 撤销 ⇒ 之后两边点击都不生效

### W2 服务端：会话带 `jti`

| 项 | 内容 |
|---|---|
| 迁移 | 新表 `access_sessions`：`jti_hash TEXT PK`、`user_id`（FK CASCADE）、`device_name`、`user_agent`、`created_at`/`last_seen_at`/`revoked_at` |
| mint | `issueSession` 成唯一铸点（把 `replaceToken` 在 `auth.ts:236` 自己 `jwt.sign` 的那份**改掉**，不留第二份）；payload 加 `jti`；同事务落 `access_sessions` 行 |
| verify | 签名 + `tokenVersion` 之后加"这一枚撤销了没有"；任何撤销都 `authCache.invalidate(userId)` |
| 路由 | `GET /api/auth/sessions`（含 `current`）、`DELETE /api/auth/sessions/:sessionId`、`POST /api/auth/sessions/revoke-all`；`POST /api/auth/logout`（撤销当前这一枚） |
| 边界 | 本轮之前签的令牌没有 `jti` ⇒ **不可单撤**，只能全局 bump。明写在代码注释与 §5 |

**判据**：`J-W2a` 撤销一枚后那枚立刻 401 且**别的枚仍能用**（这条是本轮的核心，也是最容易被"顺手全 bump"糊过去的地方）
· `J-W2b` 列表是白名单投影（不出现 `jti` 明文、不出现别人的行）· `J-W2c` `current` 只有一枚为真
· `J-W2d` 注销账号 ⇒ 会话行随级联消失 · `J-W2e` mint 点唯一（注入第二处 `jwt.sign` ⇒ 门禁红）

### W3 共享层 + 两端界面：退出 / 登出所有设备

`packages/app-host`：`listHostedSessions` / `revokeHostedSession` / `logoutEveryDevice`（打那条早已存在的
`/api/replace-token`）/ `logoutCurrentDevice`。返回 `HostedAuthOutcome`，**不抛错**，与既有 26 个函数同形。

- web：`AccountMenu` 的「退出登录」接 `logoutCurrentDevice`；「账号安全」组里新增「登录设备」面板（列 + 撤销 + 全部登出）。
- mobile：`SecurityScreen` 加同一块（`check:mobile-settings` R3 要求凭据类表单**只**在 `SettingsScreen`/安全面，不许塞回「我的」滚动流）。
- 措辞判据：界面上必须**分开**这两个动作的文案，不许用一句"退出登录"糊两件事。

### W4 换绑邮箱的界面（web + mobile）

替换 `ProfilePanel.tsx:416-421` / `ProfileScreen.tsx:1168` 那两个只读行：当前邮箱 + 「换绑邮箱」→
新邮箱输入 → **后果先写在点之前**（"两边各点一次才生效；生效后所有设备要重新登录"）→
状态区（还等哪一边 / 撤销请求）。服务端页 `server/src/pages.ts` 新增第 5 张 `/change-email?token=`，
守"GET 不消费令牌"那条既有纪律（`password-reset-page.spec.ts:97-102` 是它的判据形状）。

### W5 补齐协议已就绪、纯缺 UI 的三块（移动端）

`setInitialPassword`（`/password/set` 的 app-host 函数 `:1935` 已有）· `beginPasskeyEnrollment`
（`:1641`/`:1670` 已有）· `requestPasskeyRecovery`（`:980` 已有）。三块都是**界面缺口**，不是协议缺口。

### W6 新增认证器发告知信（兑现 `email-password-auth.md` 缺口 13）

`/password/set` 与 `passkeys/registration/complete` 成功后各发一封「账号新增了一种登录方式」，
删掉 `service.ts:185` 那句"成功后不发信"的**说明**（不改它的语义，改它的实现）。

### W7 法务与对外说明（**与 W1–W6 同批落地，不许后补**）

| # | 落点 | 现在写着什么 | 要变成什么 |
|---|---|---|---|
| 1 | `privacy.ts:506`、`terms.ts:76`、`data-rights.ts:158`、`:316` | ❌「邮箱不可更换…服务端没有换绑邮箱的路由」 | 换绑流程：双侧各点一次、生效时点、旧地址何时失效 |
| 2 | `data-rights.ts:352` 触发条件表 | 「邮箱换绑实现之后：第三节那条会被删除」 | 照"注销界面入口那一条已在 1.2 兑现"的先例，**改成已兑现** |
| 3 | `privacy.ts:201`/`:296`/`:315`、`third-parties.ts:130`（en `:513`） | 「**五封**功能邮件」+ 封闭枚举 | **八封**，枚举加换绑新邮箱确认 / 旧邮箱授权 / 完成通知；**四处都要改** |
| 4 | `privacy.ts:539`、`personal-info-list.ts:229`/`:540` | 一次性令牌种类与时长封闭枚举（24h/15min/1h） | 加换绑双令牌（24 h），逐处逐语言 |
| 5 | `personal-info-list.ts:187-235`、`:288` | 邮箱行 +「账号表里没有…其它联系方式」封闭清单 | 新增 `email_change_requests` 的待绑地址与 `access_sessions` 的设备名/UA 两行；封闭清单重画 |
| 6 | `privacy.ts:404`、`data-rights.ts:211`、`personal-info-list.ts:535` | 注销级联「共 31 处、覆盖 30 张表」 | **从迁移终态重算**（`structure.spec.ts:483-589` 会算它，中英同数） |
| 7 | `legal.generated.ts:22` | `third-parties@1.3`（**已 stale**） | 重跑 `gen:server-legal`（顺带关掉 D4） |
| 8 | 帮助中心 `zh-CN.ts:4027-4061` `site.docs.account.*` + `content.ts:307` 速答 | 只讲登录方式与口令 vs 加密口令 | 新增"换绑邮箱 / 登录设备"小节；速答与深读**同一份分类词表**，不能只加一处 |
| 9 | 版本 | `privacy@1.8`、`terms@1.2`、`data-rights@1.5`、`personal-info-list@1.5`、`third-parties@1.4` | 各 bump 一版 + 变更表加一行（中英同序），进 `legalSetVersion()` ⇒ **补签流程同批**（`privacy.ts:565` 那句"新增采集种类必须有一次独立重新提示"） |

🔴 **`check:legal-closure-truth` 是这一批的裁判**：它把政策里"今天还不存在"这类封闭句与代码现状对账。
W1 先落、W7 后落 ⇒ 中间任何一次 `pnpm check` 都会红。**这不是门禁坏了，是它说对了话。**

### W8 判据补强与那三件顺手要修的

- **D1**：给 `/auth/email/verify`、`/password/change`、`/password/set` 补 HTTP 层判据（路由级，不是 service 级）。
- **D2**：admin 强制登出改走 `revokeAllTokens` + 关 WebSocket，并钉一条"管理员点完之后那台实时连接必须断"。
- **D3**：过期一次性令牌清扫扩到 `users` 那四列 + 新加的换绑双令牌 + `access_sessions` 过期行。
- **邮箱归一化收一处**（ADR-0063 §2.4）：6 处散写 ⇒ 1 处 + 新门禁 `check:email-normalization`（要能红）。

### W9 验收

每条新链跑**真服务端**（`verify:p1`/`verify:p2` 那族形状，零 mock）。**本轮不承诺**真收件箱点击那一腿
（缺口 G1 仍然开着，见 `user-journey-and-auth.md:741-753`），也不承诺真实 SMTP 投递（traps #81）。

---

## 3. 线协议（新增部分）

| 方法 路径 | 鉴权 | 请求 | 成功响应 | 稳定码 |
|---|---|---|---|---|
| `POST /api/account/email/change/request` | Bearer | `{ newEmail }` | `{ message, expiresAt, resendAvailableAt }` | `email_change_pending` |
| `POST /api/account/email/change/confirm` | — | `{ token }` | `{ message, applied: boolean }` | `invalid_change_link` |
| `POST /api/account/email/change/cancel` | Bearer | `{}` | `{ message }` | — |
| `GET /api/account/email/change/status` | Bearer | — | `{ pending, awaitingOld, awaitingNew, pendingEmail, expiresAt, resendAvailableAt }` | — |
| `GET /api/auth/sessions` | Bearer | — | `{ sessions: [{ sessionId, deviceName, userAgent, createdAt, lastSeenAt, current }] }` | — |
| `DELETE /api/auth/sessions/:sessionId` | Bearer | — | `{ success }` | `unknown_session` |
| `POST /api/auth/sessions/revoke-all` | Bearer | — | `{ success, count }` | — |
| `POST /api/auth/logout` | Bearer | — | `{ message }` | — |

⚠️ 线名是 `sessionId` 而列名是 `jti_hash`（`access-sessions.ts:195` 那一处 `sessionId: row.jtiHash`）：
库里那一列存的是**令牌的 SHA-256**，界面上不需要知道它来自 `jti`。
`pendingEmail` 同样与最初写这里的 `pendingEmailMasked` 不同 —— 这一条只回给**带着自己 Bearer 的账号主人**，
遮一份自己待绑的地址只会让人认不出"等的到底是哪一封"。

路径的**唯一真源**进 `packages/shared-schema/src/`（与 `AUTH_PASSWORD_PATHS`、`ACCOUNT_PROFILE_PATHS` 同一族规矩：
服务端注册与客户端拼串**共用一枚常量**，因为漂移的症状是 404 而不是报错）。
错误码进封闭词表，客户端**白名单**消费（`FAILURE_REASON_BY_SERVER_CODE` 那一族）。

---

## 4. 不可触碰（照抄 ADR-0063 §2.7 与侦察结论）

不改 ADR-0039/0040/0041/0049/0050/0055 的任何结论；不 bump `CURRENT_SCHEMA_VERSION`（新表新列全是纯可加）；
登录口令与 E2EE 密钥**一行都不碰**；反枚举那三族同码同句不松动；不在 `apps/` 写协议知识（端点、fetch）；
界面文案零硬编码（`check:ui-language`）；不给口令框加 `maxLength`（`auth-http-contract.ts:25-29`）。

---

## 5. 已知边界（登记，不包装成完成）

1. 本轮之前签的令牌没有 `jti` ⇒ 不可单独撤销，只能全局 bump。
2. 单进程内存限流对本次新增路由同样失效（多副本部署下形同虚设）。
3. 换绑后旧邮箱不留墓碑，恢复闸认不出它（ADR-0055 既有形状的延续）。
4. 真收件箱那一腿（G1）与真实 SMTP 投递仍未验。
5. 换绑不要求重输当前口令（ADR-0063 §2.7 登记为可复议项）。
6. 鸿蒙端没有壳，谈不上账号面。
7. 🔴 **级联数字与"类别名"那两格现在在纯 HEAD 上也是红的**（10-10 03:0x 现量更正，两臂读数与逐枚归属在 §6.65）。
   ~~归并行 automation 线的是两张新表的用户可读类别名 + 数字跟着 +2。~~
   这句已被现量否证：纯 HEAD 上缺类别名的是 **17 枚**表，其中只有 2 枚是本线的，
   而**把本线那份还没入库的文案算进去之后**还剩 3 枚（`automation_entitlement_activations` / `_links` / `_subjects`，
   `3fcc3bef` 10-09 18:25 带进来），数字差也跟着从 +2 变 **+3**（臂 B 现量：文案 34/33，真源 37/36）。
   仍然成立的只有"类别名与数字是对外承诺，本线不代拍"这一半。
   而**这一格里有本线自己的责任**：本线 10-08 21:31 那笔"立 ADR-0063"的提交 `9fa53ab9`
   把**六枚别的线的迁移目录**一起带进了 main，其中**八枚新表随注销级联**
   （`automation_workers` `automation_commit_permits` `automation_rules` `automation_events` `automation_recipient_keys`
   `shares` `share_invitations` `share_members`），而它们的对外文案当时还躺在别人工作树里；那笔提交的"归属说明"只声明了 `docs/plans/README.md` 三行。
   本线**能停手的只有措辞那一半**，"把别人的持久层带进 main"这一半不是判据口径，是动作。
8. 新增的集成套件要真 PostgreSQL（本地建的是隔离库 `heyta_account_w9`），
   `pnpm -r test` 那条默认通道**不含**它（`vitest.integration.config.ts` 的 exclude 是对的）。
   它已点名进 `server/package.json` 的 `test:integration:postgres`（`check:integration-coverage` rc=0），
   但**那条脚本不在 `pnpm check` 链里** —— 与仓内其余 30 多份集成套件同一条边界，不是本轮新开的洞。
9. `access_sessions.device_name` 这一列**目前没有任何客户端上报**（界面上看到的一律为空）。
   政策文本里那句"设备名你起"讲的是**同步设备**那张表（`sync_devices`），不是会话表 ——
   两者在 `personal-info-list.ts` 里是分开的两行，别读成同一件事。
   🔴 **这一格已拍完（10-10 12:0x，负责人把这类口径交给产品侧拍）**：**不给登录请求加上报入参**
   （那要动线协议契约，换来的只是把已经能读的 UA 换成一个客户端自报、服务端无从校验的字符串），
   界面继续读 `deviceName ?? userAgent`。要钉的换成另一件事：**两个都没有时不许替用户编一个设备名**。
   用例 `apps/web/tests/account-security.spec.tsx`（臂 M1 编名字 / 臂 M2 空标签行，各红各的断言）与两臂读数在 §6.77。
10. ✅ **换绑与会话两块新界面的真浏览器证据已取**（AGENTS §6.2 规定一，10-09 01:1x）。
    判据文件 `e2e/tests/account-email-change-and-sessions.spec.ts` **4 条全绿**、七张图**在最后一趟之后**
    逐张打开看过，看图当场查出**两条断言查不出的缺陷**并修完（两条各做过一次变异）⇒ 全过程在 §6.4。
    🟢 同一份判据文件后来并进了改密的三条真浏览器用例，**13:5x 已取数**（7/7 绿、
    两臂变异各红一次）⇒ §6.14 与 §6.15。条数现量：
    `grep -c "^test(" e2e/tests/account-email-change-and-sessions.spec.ts`；
    图数现量：`ls apps/web/evidence/account-suite/*.png | wc -l`。
    ⚠️ **仍然开着的是移动端那一腿，但措辞要换准**（10-09 12:0x 现量）：设备窗口产品负责人给了，
    三趟都跑了 —— 红的分别是**探针判定窗口不够**、**模拟器系统语言是英文**（traps #391）、
    **模拟器进程被宿主机负载风暴打死**（swap 6.2 G / load 158–540），
    🔴 ~~**没有一趟红在移动壳的代码上，所以这一腿的证据仍然等于零**，不是"验过没验好"。~~
    ✅ **10-09 17:5x 现量更正（§6.16）：这一腿的证据取到了。** 第 11 趟 `通过 73 / 失败 6`，
    其中步骤 1–9 **全绿** —— 换绑整条链（发起 → 两封信 → 只点旧那半再回来读到「等新邮箱那一边」
    → 点新那半 → 库里改了 / 活请求清了 / 旧令牌全局 401 / 本机明文库还在）是在**真 iOS 模拟器**上
    跑出来的，不是共享层单测。那六条红里五条是探针自己的错（逐条机制与修法见 §6.16），
    第六条（步骤 10）**是本线的一条真缺陷并已修完**：换绑成功之后界面还说旧地址。
    仍不闭合的是步骤 14 那一格（E2EE 口令进不了应用状态）—— 同一份产物上兄弟 rig 也拿不到，
    不记本线产品失败也不记已验证。
    它带回来的唯一一条产品缺陷在**服务端**（`authCache` 按用户分格 ⇒ 撤掉的那一枚仍被接受），
    三层证据与逐层变异读数、续跑配方都在 §6.7。
    🔴 **12:1x 现量更正了这一格的等待条件**（§6.8）：iOS 模拟器上**已装**的产物里就含本线那两节、
    系统语言就是中文 ⇒ **不需要重新构建**，缺的是一份 iOS 侧 AX 驱动脚本与一个**没被另一条会话的
    `idb_companion` 占着的窗口**。等待条件是"别人跑完"，不是"载体坏了"。
    ⚠️ 移动侧那 30 条 RN 测试树照旧存在，它证的是共享层接线，**不替代**真机界面。
11. 🔴 **本轮没有跑 `pnpm reinstall:all`** ⇒ 现在装在四个端上的产物**不含**这一批
    （AGENTS §6.1.1 的固定收尾；与 §7 第 27/82 条、traps #178 同一条理由："测试全绿 ≠ 这是当前产物"）。
    起跑时 1 分钟负载 **340** / 16 核（并行会话在跑自己的链），而那条链要独占模拟器与打包目录。
    这一格只能由后来者在设备窗口空时跑，**本轮不把它写成已完成**。
12. 本轮新写那份 e2e 夹具的红记在 §6.4、整链 16 道红的逐条归因记在 §6.5；
    两条可迁移的教训已入 `docs/reference/environment-traps.md`
    （**#389**：共享检出上"这个界面开机只发我这几条"永远不成立；
    **#390**：无边框控件风格下空输入框在截图里是一片白，判据验得出"在"验不出"看得见"）。
13. ⚠️ **本线那份集成套件在共享载体上有一条载体天花板，不是产品红**：
    `server/vitest.integration.config.ts` **不设** `testTimeout` ⇒ 走 vitest 默认 **5 s**，
    而它跑的是真库 + 真 HTTP。10-09 11:4x 那次 1 分钟负载 **371**，两条换绑用例报 timeout；
    同一条命令加 `--testTimeout=30000` 复跑 `14 passed` ⇒ 判据成立、超时预算不够。
    🔴 **没有**顺手把默认超时写进配置 —— 超时预算属于判据口径，要拍由负责人拍（同 §5 第 12 条那两条的处置）。
14. 🔴 **`authCache` 那一格不是"登记一条边界"，是本轮修掉的一条真缺陷**（§6.7）：
    它让 ADR-0063 §2.5 那句"30 s 的缓存窗口不会变成撤销了还能用半小时"在实测上**不成立**。
    ADR 里那句话已就地更正（**结论一条没动**：双确认、`jti` 会话、撤销=删行），
    改的是那句被证伪的实现事实。⚠️ 单测与集成当时**全是绿的** ——
    "撤一枚不动另一枚"这条断言写在了错误的顺序上（先探被撤的那一枚就永远照不出焐热路径），
    这条是 traps **#392**。
    ⚠️ 换签名之后 `tests/` 里还有**两处旧调用点**是本线自己的，而**没有一档编译期检查看得见它们**
    （§6.9，并入 traps #210 的第三种面目：`tsconfig` 不含 tests、这一包没有 `typecheck`）——
    那一格是随后那趟**全量单测**替本线抓出来的，不是构建也不是 typecheck。
15. ⚠️ **"跑了全量单测"这句话的分母要自己数**（§6.11，traps **#393**）：
    21 枚有 `test` 脚本的包里只有 20 枚打了 `Tests` 汇总行，差的 `packages/sync-core`
    是因为它的 `test` 写成 `tsc && vitest run` 而前置那半红在**别人一枚 spec** 上 ⇒
    那一包的全部用例这一趟**不存在**，而输出里没有任何一行写这件事。
    本线报绿之前要先过那条对账（它会点名是谁没起跑）；这条边界是全仓的，不是本线开的洞。
16. 🔴 **"完整用户旅程"这一问的最后一条缺口是撤销的第二半**（§6.13，traps **#395**）：
    改密 / 重置口令 / 换绑生效这三条路当时只抬 `tokenVersion`，既没删会话行也**没关实时通道**，
    而那三条恰恰是用户所说的"把别人踢下线"。发现它靠**两个动作集合做减法**
    （谁抬计数器 vs 谁撤行/关通道），不是读实现 —— 每一处单看都"做了它说的事"，
    日志还印着 `all previous sessions revoked`。修法把两半绑成 `revokeAllDeviceSessions()`
    并加结构门禁 `pnpm check:session-revocation`（已进链，`--pkg` 注入做过负向）。
    判据四层里只有**真运行时那一层**能红（改前产物 `37 过 / 2 红`，改后 `39 过 / 0 红`）：
    单元与 HTTP 层对一个"只写计数器"的实现全绿，因为它们数的是请求与响应，
    缺的那一半是一条**已经建立的连接**。
    🔴 **这一条的"哪几条路已在运行时层验过"已有独立状态表**（§6.73，第四格注销补在 §6.74、
    换绑生效补在 §6.75）：**改密 ✅ / 重置 ✅ / 换绑生效 ✅ / 注销 ✅ —— 四格全闭合**。
    注销那一格的 `closeForUser` 不经过收口函数，红在另一枚臂（§6.74 那两条臂互不重叠）。
    这一条本文原样保留 —— 它记的是**发现方式**（两个动作集合做减法），
    而那张表记的是**现在的覆盖**，两码事，别拿后者去删前者。
17. ✅ **逐枚撤销不关那一枚的实时通道** —— **这一格已关**（10-10 02:45，`be4e41b4` + `0c7e7476`，读数与三臂在 §6.60）。
    原文留着，因为它记的三件前置正是落地时做的三件：upgrade 鉴权时把 `jti` 的 SHA-256 记进连接、
    加 `closeForSession(userId, sessionId)`、再补一条**真运行时**的 WS 判据。
    它是第 16 条那一族的**另一半分界**，不是它的回归。`DELETE /sessions/:id` 删的是那一行的会话与 30 s 鉴权缓存，
    而那台设备**已经开着的页面**还会继续收 op 通知，直到它自己重连。
    它**不是**"界面在说谎"：`common.sessions.intro` 说的是"退出哪一台，它的**下一次请求**就要重新登录"
    —— 那句话与实现逐字对齐，没有多承诺一分，所以关掉它**不需要**动任何对外文案。
    当时"想关也关不准"的原因也记在这里：连接簿记是 `Map<userId, Set<ConnectedClient>>`，
    而 `ConnectedClient` 只带 `ws / clientId / userId / lastPong / connectedAt` —— 没有 jti。
    ⚠️ 这一条原先写的是"现存的 pglite 与 HTTP 层判据都看不见已经开着的连接，所以逐枚那条**只有注释里那句解释**"——
    后半句已被现量否证（§6.56 臂B）：HTTP 层**有**一条负向判据，往逐枚那条路径里塞一句
    `closeForUser(user.userId)` 就会让它红。
    🔴 **关掉之后仍然开着的那一小格**：本轮之前签的、没有 `jti` 的令牌，服务端认不出对应哪条连接，
    那一档还是只能等它自己重连（ADR-0063 §4 第 1 条原样）。运行时层造不出这种组合，
    它由单元层"`sessionId` 为 `null` 的连接不许被误关"那条**反向**钉住 —— 反向，不是正向。
    复取：`git grep -n "closeForUser\|closeForSession" HEAD -- server/src` ⇒ 逐枚那条现在是**真调用**，不是注释；
    `git grep -n "closeForUser" HEAD -- server/tests` ⇒ 正向 1 条 + 负向 2 条；两臂读数见 §6.56。

18. 🔴 **两条邮件链接路由的"兜底句"不一样，而 `api.ts` 里那段注释承诺的正是"必须一致"** ——
    这一格**已修**（10-10 04:1x，读数与修法在 §6.71），原文留着记它是怎么被照出来的：
    新增的链路 10b 第一次把两条路放在一起比字节，当场红 —— legacy 那路回
    `{"error":"Invalid or expired login link"}`，唯一入口回 `{"error":"Invalid or expired link"}`。
    现量（行号会漂，只给命令）：`git grep -n "Invalid or expired" HEAD -- server/src/api.ts server/src/auth.ts`。
    ✅ **那一半已闭合**（10-10 11:4x，读数在 §6.77）：负责人把这类口径的拍板权交给了产品线，
    处置是**纳进封闭词表 + 补一把静态尺**，不是继续只靠一条运行时判据。
    静态尺 `pnpm check:safe-error-fallbacks` 已进 `pnpm check` 链；它拦的形状是
    "一句话既被 `throw` 又被某处当 `getSafeErrorMessage` 的兜底句 ⇒ 必须在 `SAFE_ERROR_MESSAGES` 里"。
    ⚠️ 口径**不是**"所有兜底句都进表" —— 那样一条会一次判红别线在用的十七处通用失败句，
    等于给封闭词表灌水；逐格理由与那条否证在 §6.77。
    现量（这一档还剩几处）：`pnpm check:safe-error-fallbacks`（rc=0 即清零）。

---

## 6. 台账（逐批带读数，**不许写"基本完成"**）

> 读数的口径：条数=当场现量的 vitest 汇总行；变异臂=改坏实现后**红了哪几条用例**，
> 不是"跑过变异"。还原一律从 `<file>.mut-bak`（共享检出里 git 那一份不等于"改前的这一份"），
> 每臂跑完 `cmp -s` 逐字节校验。

| 批 | 状态 | 读数 |
|---|---|---|
| W1 | ✅ | 迁移 `20261018140000_add_email_change_and_access_sessions`（两张表，`users` 上**零 ALTER**）+ `server/src/account/email-change.ts`。判据：`server/tests/email-change.spec.ts` **31 条**全绿（10-09 13:2x 现量 33 条 —— §6.13 加了通道与删行那两条）。变异 **5 臂全红**：M1 单边即生效 ⇒ 1 红（`J-W1a` 本体）；M2 落库写明文令牌 ⇒ **17 红**（`J-W1c` 加上下游全部依赖那两列的形状）；M3 `increment: 0` ⇒ 2 红（`J-W1b` 与其"不第二次 +1"的补条）；M4 摘掉 `authCache.invalidate` ⇒ 1 红（"库里 +1 与旧设备真的登出之间隔着那 30 s"）；M14 `cancel` 的 `where` 多带一个条件 ⇒ 1 红（`J-W1i`） |
| W2 | ✅ | `server/src/account/access-sessions.ts` + `issueSession` 成唯一铸点（`auth.ts:237`/`api.ts:1370` 那两份裸 `jwt.sign` 已改成调用它）+ 五条路由。判据：`access-sessions.spec.ts` **27 条** + `account-security.routes.spec.ts` **28 条**（真 Fastify/真鉴权/真 `authCache`，只 mock 库与发信）。变异 **4 臂全红**：M5 撤销一枚改成撤整账号 ⇒ 6 红（含"另一枚照常 200"与 `logout` 那条）；M6 `sessionIsLive` 恒真 ⇒ 6 红（含 HTTP 层那两条 401）；M7 白名单投影多带字段 ⇒ 2 红；M13 摘掉 `last_seen` 节流 ⇒ 1 红。新门禁 `check:token-minting`（`jwt.sign` 只许一处，rc=0）+ `check:email-normalization`（扫描 116 文件，rc=0） |
| W3 | ✅ | `packages/app-host/src/account-security.ts`（7 个函数，返回 `HostedAuthOutcome` 不抛错）判据 **45→46 条**；web `signOutStore`+`SessionsPanel`+`AccountMenu` **40 条**；mobile `sign-out-flow`+`SessionsSection`+`account-security-copy` **30 条**。🔴 **变异 M12 当场照出一条没牙的判据**：把 `logoutCurrentDevice` 的调用点换成 `sessionsRevokeAll` ⇒ app-host 那 45 条**全绿**（存活）。补上"两个动作各自打自己的 URL + 反向对照两条路由不同形"那条判据后重跑 **M12′ ⇒ 恰好 1 红**。这条是本轮唯一由变异新增的判据，也是"界面分开措辞、共享层却接到同一条路由"唯一能被抓出来的地方 |
| W4 | ✅ 代码 + jsdom 判据 | web `EmailChangePanel.tsx`+`emailChangeStore.ts`，mobile `EmailChangeSection.tsx`；服务端第 5 张凭据页 `server/public/change-email.js`（守"GET 不消费令牌"）。后果先写在点之前那句进词条（中英各一份），状态区读 `GET …/status`。判据含在 W3/W1 的三组里（web 40→**41** 条、mobile 30 条、server 31+28 条）。<br>⚠️ 这一格原先写着"没有真浏览器截图"，**10-09 01:1x 已闭合**：`e2e/tests/account-email-change-and-sessions.spec.ts` 4 条 + 七张图逐张看过，看图查出两条并修完 ⇒ **§6.4**。移动端那一腿仍只有测试树（没上真机），留在 §5 第 10 条 |
| W5 | ✅ | `apps/mobile/src/screens/SecurityScreen.tsx` 接上三块纯缺 UI 的：`setInitialPassword` / `beginPasskeyEnrollment`+`complete` / `requestPasskeyRecovery`（app-host 那三个函数早就有）。判据在 mobile 那 30 条与既有 `auth-screen-password.spec.ts` 里 |
| W6 | ✅ | `server/src/account/authenticator-notice.ts` 一份收口，`/password/set`（`service.ts:249`）与通行密钥注册完成（`passkey.ts:556`）两处共用；`service.ts` 那句"成功后不发信"的**说明**已改写（语义没动：改口令那封照旧只在成功后发）。发信失败的形状由 `passkey-enrollment.spec.ts:529` 那条钉住 |
| W7 | 🔴 **未入库 —— "已落"这句是错的，10-10 现量更正**（九行的字都只在共享检出的工作树里；`git log -S '十封功能邮件'`、`-S '换绑-新邮箱确认'` 两把都输出空，而 HEAD 里现在还是"发五封"与"**邮箱不可更换。**"。逐枚现量、为什么不能从这条检出单面提交、以及本线自己欠的那四枚漏披露，全在 §6.78）。下面那九行照原样留着，读的时候要带上这一句：**两枚红归并行线** | 九行逐条对过：①三份文本的"邮箱不可更换"改成双侧确认（`privacy.ts:506`、`terms.ts:76`+`:80`+`:317`、`data-rights.ts:158`）②触发条件表那条结掉换成"旧地址收不到信时如何更正"（`data-rights.ts:352`）③功能邮件**五封→十封**并逐类点名（`privacy.ts:201`/`:296`）④一次性凭据时长表补注册验证码 10 min 与换绑两枚 24 h（`privacy.ts:539`）⑤`personal-info-list.ts:236`/`:243` 新增"待绑定的新邮箱地址"与"登录会话"两行，并写明"设备名那一列目前没有任何客户端上报"⑦`gen:server-legal` 重跑 ⇒ `check:server-legal` rc=0（顺带关掉 **D4**）⑧帮助中心 `site.docs.account.s6/s7` + `site.help.q/a.rebind|sessions` ⑨五份版本各 bump 一版（`privacy@1.9`、`terms@1.4`、`data-rights@1.6`、`personal-info-list@1.6`、`third-parties@1.5`）+ 变更表各一行、中英同序 ⇒ 进 `legalSetVersion()`，补签同批。<br>🔴 **⑥级联数字这一格是本次唯一"判据绿不了但不是我的数错了"**：`structure.spec.ts` 现量真源 **34 处 / 33 张**，文案写 **32 / 31**。逐约束归因（用该判据自己的推导复刻一遍，标定=不排除时逐字等于它报的数）：**摘掉并行 automation 线那笔未提交的 `20261018160000_add_automation_entitlement_tickets` ⇒ 32 / 31 = 文案现值**；再摘掉本线那笔 ⇒ 30 / 29（= 本批的底数）。⇒ 本线的数字是对的，多出来的两张表（`automation_entitlement_bindings`、`automation_entitlement_ticket_uses`）与它们缺的那个"用户读得到的类别名"归那条线。**不代改**：类别名与对外承诺的措辞是判据口径（见记忆「代改别线代码要三条齐」）。<br>🔴 **10-10 12:5x 两格状态换人**（逐条读数在 §6.80②③）：本线**不再欠那四枚漏披露** —— 这一格里 ③④ 的文本与 `CATEGORY_NAMES` 登记都已在 10-08 那批里做过，我这一轮从 tip 重推导是多余且错的（tip 的探针不认识 `DROP TABLE`）；而"十封那行超承诺"也不是缺陷，是我那把尺用 `git grep` 找调用点造出的假红，已修（`server/src/password/registration-otp.ts` 有调用点，只是那枚文件未跟踪） |
| W8 | ✅ | **D1** `/auth/email/verify` 此前全仓零 HTTP 判据 ⇒ 现在真库 5 条（`email-change-and-sessions.integration.spec.ts` 的 D1 组：三种分流形状、消费即失效、过期与"从没有过"同码同句逐字相同、空令牌 400、通行密钥那一格不发会话）。`/password/change`、`/password/set` 的路由级判据在 `password-auth-routes.spec.ts`。<br>**D2** `admin POST /users/:id/logout` 改走 `revokeAllTokens` + `revokeAllSessions` + `getWsConnectionService().closeForUser`，钉在 `admin-routes.spec.ts:415`/`:420`。<br>**D3** `credential-sweep.ts` 覆盖 `users` 那四列 + 换绑双令牌那两张 + `access_sessions` 过期行，判据 **6 条**；变异 **M8** 摘掉 `lt` ⇒ 2 红（`J-S1` 与配对那条）。挂在 `sync/cleanup.ts` 第 9 步。<br>**邮箱归一化**收进 `account/email-normalize.ts` 一处（11 个调用点），门禁 `check:email-normalization` rc=0 |
| W9 | ✅ 真 PG，零 mock | 隔离验收库 `heyta_account_w9`（本地 PG 14，`psql` 建库 → `sh scripts/migrate-deploy.sh` 应用**全部**迁移 ⇒ "All migrations have been successfully applied"，含本线那笔）。判据文件 `server/tests/integration/email-change-and-sessions.integration.spec.ts`：**13 条全绿**（真 `PrismaClient` + 真 `apiRoutes` + 真 `accountSecurityRoutes`，只 mock SMTP）。跑法（已点名进 `server/package.json` 的 `test:integration:postgres`，`check:integration-coverage` rc=0）：<br>`cd server && DATABASE_URL=postgresql://$USER@127.0.0.1:5432/heyta_account_w9?schema=public npx vitest run --config vitest.integration.config.ts tests/integration/email-change-and-sessions.integration.spec.ts`<br>🔴 这一层当场照出**我自己写错的一条前提**：D1 那格我先按"邮箱注册⇒不发会话"写，真库里返回的是 `session`（`auth.ts:697`），"不发会话"的是**通行密钥注册**那一格（`auth.ts:680`）⇒ 拆成两条各测各的。假绿的一层（假 prisma）不会告这个 |

### 6.1 W4 补上的一条**真空**：那张凭据页此前一条判据都没有

现量（10-09 00:40）：`grep -rln "change-email" server/tests/*.spec.ts` **零命中** ——
W4 那行写着"守 GET 不消费令牌那条既有纪律"，而那条纪律在这一页上**没有任何一层在守**
（`password-reset-page.spec.ts` 只管 `/reset-password`）。⇒ 新增 `server/tests/email-change-page.spec.ts` **9 条**：

- 缺 token ⇒ 400 + 那句"需要链接"，默认中文；`?lang=en` ⇒ 切英文，并带一条"不许同时印着那句中文"的反向对照。
- 🔴 **GET 不消费令牌**用源码断言钉（`pages.ts` 里不许出现 `confirmEmailChange`、不许 import 那个模块）。
  负向对照现量：往副本源码注入那次调用 ⇒ `includes('confirmEmailChange')` 由 `false` 翻成 `true`。
  为什么不用 mock 数：这一页本来就不碰库，"没有发生写"是一条永远为 0 的判据（§7 元规则 2）。
- 令牌拼进 HTML 属性前必须过 `escapeHtml`：拿 `abc"onload="alert(1)` 当 token，断言那串不在页上且 `&quot;` 在。
- "两边各点一次才生效"那句的**存在性**判据（中英各一次）—— 只断言"点了以后出现什么"抓不到"少了一整段说明"。
- 「这一边确认了」与「整个换绑生效了」两句都必须下发，且断言两句话**不相等**（合成一句就是界面在说谎）。
- 脚本里零用户可见的话：先**剥注释**再判。🔴 不剥就是探针假红 —— 第一版就是这么红的，
  命中处在 `change-email.js` 的头注释里（与 `structure.spec.ts` 的 `stripSqlComments` 同一个理由）。
- 「去登录」`<a id="goLogin">` 初始 `hidden`（还在等另一边时给登录入口，人会拿旧地址登）。
- 失败不回显服务端内部话术（脚本里不许把 `data.error` / `body.message` 拼进界面）。
- 脚本挂在 `</main>` 之后（`<head>` 那次事故的形状）。

### 6.2 全量套件的读数与那几格"红但不是本线"

`pnpm -r --no-bail test`（2026-10-08 24:0x，负载 `{60.7 33.5 30.0}` / 16 核 —— 短窗远高于长窗，是并行会话在跑东西，不是本机底噪）：
**21 个包有 test 脚本、21 行 `Tests` 汇总**（对得上数，见 AGENTS §6 那条"收尾必须对一次数"）。

| 红在哪个包 | 条数 | 归因 |
|---|---|---|
| `packages/legal` | 2 | 见 W7 那一格：并行 automation 线未提交的迁移带来的 +2/+2。本线数字经逐约束归因证明是对的 |
| `packages/ai` | 3 | `capability-manifest.generated.ts` 停在 `COMMENT` 实体之前（`gen-ai-capability-manifest.mjs --check` 报"应为 968 行 / 现在 892 行"）⇒ 那条线加了实体没重跑生成 |
| `apps/web` | 28 | 21 条在 AI 助手面板（`找不到 ai-assistant-send`）、5 条 Esc 类（`search-overlay`/`calendar-capture`/`task-sort`/`shell-more`/`app-mount`）、2 条时间线拖拽 ⇒ **本线的账号面文件一条都不在这 28 条里**。⚠️ 一条已被现量否证的假设要留着挡后人：我先猜"App.tsx 里新加的隐私让路守卫吞掉了 Esc"，但那 4 个用例的失败 DOM 里 `隐私/privacy` 命中 **0 次** ⇒ 面板没开着，守卫不成立。真因待那条线报（不在本线射程内） |
| `server` | 6 | 5 条 `sync-compressed-body.routes.spec.ts`：`uploadOps` 第 9 个参数 `inboundIdentity` 是 inbound-automation 那笔加的（`git show HEAD:` 现量：HEAD 没有这一参数）；1 条 `validation.service.spec.ts`：实体数 17→18（`COMMENT`，与 `packages/ai` 同一根因） |
| `packages/sync-client` | 1 | `share-payload-cipher.spec.ts`（共享清单那条线） |

本线自己的套件（10-09 01:1x 复跑，加完两条词条与两条判据之后）：**server 95**（四个账号面文件：
31 + 27 + 28 + 9）+ **14**（PGlite）+ **13**（真 PG 集成）= **122 条**、app-host 46、
web **41**（`account-security.spec.tsx`，换绑 + 会话 + 退出登录共用这一份）、mobile 30、i18n 26、
ui 626、node-host 198、**e2e 7 条真浏览器**（§6.4 + §6.15）；legal 74/76（那 2 条见上）。

### 6.3 `pnpm -r typecheck` 照出来的一条**本线**缺口

`--no-bail` 现量：两个包红 —— `packages/sync-client`（`share-payload-cipher.spec.ts` 的 `possibly undefined`，共享清单那条线）与 `apps/node-host`。
🔴 后者是**本线的**：`apps/node-host/src/cli-auth.ts:135` 那张 `Record<HostedAuthFailureReason, string>` 少了我新加的五条。
这一族的穷尽检查是编译期的（文件头那句"少了就编不过，而不是落进 `default` 把新失败说成旧的假话"），
所以它**必然**红 —— 但"必然红"不等于"有人跑过"：`pnpm check` 里 `typecheck` 排在 `-r test` 之前，
而这条链此前从没在带这批改动的树上跑到过 node-host 那一层。已补五条人话（每条说"用户能做的动作"），
`pnpm --filter @heyta/node-host typecheck` rc=0、`test` **198 passed**。
🔴 顺手把这一类收干净：全仓（`**/src/**` 范围）只此一处 `Record<HostedAuthFailureReason, …>` 是穷尽的，
`CloseAccountPanel.tsx:53` 那张是 `Partial<…>`（有意，注释已写明它以前抄了一份），所以没有第二处要补。

### 6.4 真浏览器那一腿：七张图**逐张看过**，看图查出两条断言查不出的缺陷

跑法（无头、不抢焦点、不碰 4318/4319 之外的端口；刻意**不走** `pnpm check:ai-e2e`，
因为那条前置 `check-ai-e2e-preflight.mjs` 会按端口 SIGKILL 别人 —— 见 §7 第 87 条那一族）：

```bash
cd e2e && npx playwright test tests/account-email-change-and-sessions.spec.ts   # 4 passed (22.1s)
```

读数（2026-10-09 01:10，起跑时 1 分钟负载 **340** / 16 核 —— 并行会话在跑自己的链；
这一族 4 条单跑仍 4/4，所以这个数不影响结论，但**整族**是否在合并态载体上绿没验，见 §6.5）：
`4 passed`，七张图落在**受版本控制**的 `apps/web/evidence/account-suite/`（`01-before-request` …
`07-status-load-failed`），七张**都打开看过**。假的只有账号面那几条 HTTP 的响应体；真的是
Chromium、IndexedDB、React 树、store、词条渲染、点击与焦点。

🔴 **两条只有图能查出来的缺陷**（都不是断言报的，两条都补了能红的判据 + 各做过一次变异）：

1. **读侧失败那一句，说的是一次不存在的尝试。** 截图上印的是
   「更换没有成功，请重试。」—— 可这一次**没有人发起过任何东西**，只是状态没读到。
   根因是形状：web 面板把 `failureKey(state.reason)` **同时**用在读侧与发起侧，而那张表
   句句带"这次没发起成功 / 地址没有改动"的预设（对发起侧是对的）。移动侧早就分开了
   （`mobile.emailChange.statusFailed`），**web 少这一档**。
   修：新增 `common.emailChange.loadFailed`（中英各一条，只说两件实话：没读到、地址没有任何改动），
   读侧分支不再走 `failureKey`。变异：把那句换回 `failureKey(state.reason)` ⇒ **恰好 1 红**，
   而它报的原文逐字是 `expected ' The change did not go through. Pleas…' to contain 'could not be read'`
   —— 也就是说**这条判据在修之前根本不存在**，红的是我自己刚写的那一句。
2. **空着的输入框在界面上看不见。** 「新邮箱地址」那一格里什么都没有，只剩标签和右边的按钮 ——
   不是没渲染（`fill()` 成功、DOM 里有节点），是 `.ht-input { border: 0 }`（这台应用现行的
   无边框控件风格）加上 `.ht-settings__actions` 是 flex + `.ht-input { flex: 1 }`
   ⇒ 空的那一格横向铺满、纯白一片。姊妹那一栏（昵称）本来就有占位文字，所以这是**本面板**的缺口。
   修：新增 `common.emailChange.newPlaceholder`（中英）+ 一条"占位文字不许为空"的判据。
   变异：摘掉 `placeholder` ⇒ **1 红**（`占位文字不能是空的: expected 0 to be greater than 0`）。

⚠️ 这两条与 §8.5 W5 那条教训是**同一族的第三、第四种面目**：断言只会验"界面写了什么"，
不会验"该说的没说"（1）与"该看得见的看不见"（2）。要抓它们，判据得写成**存在性**，而**人必须看图**。

🔴 一条**探针自己坏过**的登记（第一趟 4 条全红，红的不是产品）：
`除已登记缺失外不该有非 2xx：["/api/automation/rules","/api/automation/events","/api/account/profile"]` ——
那三条是**别人的面板**开机就发的（入站自动化 + 自己的资料），与本主题无关。
补成"空但合法"的形状后才有被测判据说话的机会；形状不许猜，逐条抄真源：
`{rules: []}` 与 `{events: []}` 来自 `packages/app-host/src/inbound-rules-remote.ts:143-146`/`:131-134`
（两处都要求是数组，否则整条判 `transport`），`{displayName: null, avatarHash: null}` 来自
`packages/shared-schema/src/account-profile-contract.ts:286` 的 `accountProfileResponseSchema`。
⚠️ 反过来这条 `assertNoProblems` 是**有用的**：它把"夹具没覆盖到的开机面"变成一条能读的失败，
而不是让一片 500 混进界面里被当成正常。

📌 一条被现量否证的断言（留着挡后人，别照着写第二遍）：我原先写「当前那一枚**不许有**
『退出这一台』按钮」⇒ 真浏览器里它有 **1 枚**。读组件才知道设计是**渲染但禁用**
（`SessionsPanel.tsx:254` `disabled={session.current || revoking}`）+ 旁边一句 `currentHint`，
而 jsdom 那 41 条里「当前那一枚」那条钉的正是"存在且禁用 + 别的行不受影响"
（`apps/web/tests/account-security.spec.tsx`，**不写行号** —— 这一族行号会随上面的增删漂，
本轮自己就漂了一次：那条从 609 走到了 634）。改断言不是迁就实现：
**"从这张列表里撤掉自己这一枚"这件事界面上确实做不到**，只是形状从"没有按钮"
换成"按钮按不动 + 一句解释"。新断言因此是三条一对：`toBeDisabled()` + 那句 hint 必须可见 +
另一枚 `toBeEnabled()`（缺了最后一条，"全都禁用"也能把这条骗过去）。

📌 这份 e2e 入口已登记进 `scripts/check-journey-coverage.mjs` 的 web `journeySpecs`
（`pnpm check:journey-coverage` rc=0）。登记不是写完就算：把那一行换成一个不存在的文件名 ⇒
`❌ web：声明的入口**不存在**`、rc=1；改回后 `cmp -s` 逐字节等于改前。
**不登记的后果是门禁看不见它** —— 那正是那个脚本文件头写的失效形状（"手写清单漏掉的不是细节，
是整个条目"）在这里的第三次现形。

### 6.5 整条 `pnpm check` 链的读数，与 16 道红的逐条归因

链跑法：逐条 `pnpm <step>` 串行、`NO_COLOR=1`、每步只留 rc 与末两行（脚本原先住 `/tmp/run-check-chain.mjs`，
10-10 已把它连 md5 一起挪到 `~/heyta-carriers/w9-acct-logs/run-check-chain.mjs` —— 一次性夹具也不该住 /tmp，
因为一次重启就把这条链的复取装置抹掉；它仍然**不入库**，因为它是本线这轮的取数壳，不是仓库的门禁），**97 步取数 + 2 步单独取数（`typecheck` / `-r test`）= 99**，其中 **16 道非零**。
本线自己的那部分：**没有一道红是本线的实现或判据**；第 13 道（`check:ai-e2e`）里**有本线那份新 spec
第一趟的夹具缺口**（已修，见 §6.4），但那一趟留下的末两行**不是**本线的形状 —— 两半在表里分开记。

| # | 红的那道 | 现量证据（可复跑） | 归因 |
|---|---|---|---|
| 1 | `check:reachability` | `pnpm check:reachability \| grep '🔴'` → `COMMENT 0 处写路径` | 入站/评论那条线（与 `packages/ai` manifest 红、`validation.service` 17→18 **同一根因**）。本线一个新实体都没加 |
| 2 | `check:row-single-source` | 族数 33 > 基线 28；`grep -ohE 'ht-[a-z]+' apps/web/src/features/settings/{EmailChangePanel,SessionsPanel}.tsx` → 只有 `ht-settings ht-btn ht-input ht-type`，**一枚新族都没有** | 新增族来自未跟踪的 `scope-drawer.css`/`assistant-layout.css`/`borderless-controls.css`（`.ht-scope`/`.ht-ai-agent-surface`/`.ht-category-create-dialog`/`.ht-profile-overview`） |
| 3 | `check:selection-single-source` | 点名文件：`InboundAutomationSettings.tsx`(4 处)、`GrowthScreen.tsx`、`TasksScreen.tsx`、`FocusTimer.tsx:191` | 无一是本线文件 |
| 4 | `check:l4` | web 那一档 `90 ≤ 98 ✅`；红在 `apps/mobile/src/screens 108 > 90`。逐文件与 `git show HEAD:` 对账：`SettingsScreen +6`、`TasksScreen +6`、`ProfileScreen +1`、`TaskDetailSheet +1`、`AuthScreen −1` | 本线新增的 `EmailChangeSection.tsx`/`SessionsSection.tsx` 各 **0** 处内联样式，`SecurityScreen.tsx` 1=1（没动过这一维） |
| 5 | `check:empty-state` | 五处新手写空态点名 `AssistantPanel.tsx`×3、`CategoryCreateDialog.tsx`、`InboundAutomationSettings.tsx` | 本线两枚面板走的是**共享 `EmptyState`**（`SessionsPanel.tsx:197`、`SessionsSection.tsx:203`）⇒ 不进债务账是对的 |
| 6 | `check:legal-tools` | 它自己报的原文：中文表第 187 行 / 英文表第 549 行各缺 **4 枚**工具 —— `append_task_checklist`、`get_task_estimate_context`、`set_task_estimate`、`set_task_priorities` | 那四枚是"估时 / 优先级 / 清单追加"那条线往目录里加的（本线**一枚工具都没加**，`packages/local-api` 与 `ai-tool-*` 里没有本线的写入）。条款把那张表当授权面 ⇒ 补表那一笔归那条线（同 AGENTS §7 那条"封闭句式必须有一条对账门禁"） |
| 7 | `check:licenses:stamp` | 它要求"在**装了全部 workspace** 的检出里重渲染" | 载体条件（`check:licenses` 本体 rc=0），不是许可问题 |
| 8 | `check:image-license` | `@noble/hashes` 在 `packages/inbound-core/package.json:23` 写 `2.4.0`、`packages/sync-core/package.json:33` 写 `^2.4.0` | 入站那条线的新包 |
| 9 | `check:linux-shell` | `❌ shell 可移植性对账不通过` | Linux 那条线 |
| 10 | `check:docs` | 全部命中"本机存在但 git 没跟踪"：`docs/runbooks/app-distribution.md` 的 `ux-closeout/release-2026-10-08*`、inbound 的两份 `*-tests.txt` | 别的线入库即可。⚠️ **本线也有同一形状的前置**：§6.4 那七张图现在同样未跟踪，入库那一笔必须连它们一起 `git add` |
| 11 | `check:ai-tools` | capability manifest 与真目录漂（它自己给的修法就是重跑生成器） | AI 那条线 |
| 12 | `check:ai-coverage` | "用户在哪儿用这个东西"那一族 | AI 那条线 |
| 13 | `check:ai-e2e` | 链里那趟只留了末两行：`Failed to read the 'localStorage' property from 'Window': Access is denied for this document.` | 🔴 **两半都要分开记**：① 本线那份新 spec 当时就在这一族里，它第一趟确实红过，但红的是"夹具没覆盖别人的开机请求"（§6.4 最后一段），**不是**这行 localStorage；单跑修好后 4/4，而这行字在单跑里**一次都没出现** ⇒ 它属于这一族里**另一份** spec，归因未做（要重跑整族才认得出是哪一份，负载 340 下这一族 60 s 超时本身就会造红）。② 整族是否在合并态载体上绿：**没验** |
| 14 | `check:landing-e2e` | 落地页那一族 | 落地页那条线 |
| 15 | `check:verify-script-copy` | 脚本副本登记表 | 别的线 |
| 16 | `check:android-gradle-remote` | 远端载体形状（`ssh windows-pc`） | 环境 / Android 那条线 |

📌 这一表里最该被后人记住的一条是 **#13**：一个**新写的** e2e 夹具第一次跑就红了，而红的原因是
它假设"这个应用开机只发账号面那几条"。这条假设在共享检出上**永远不成立** ——
别的线随时会往开机路径上加请求。所以新 e2e 的默认形状应该是 `inbox.spec.ts`/`admin-console.spec.ts`
那套"补无关的开机请求 + 结尾 `assertNoProblems`"，而不是自己造一个只认自己那几条的假服务端。


**起跑基线**（2026-10-08 21:2x，动手前取）：工作树有 1054 个未提交路径，正被并行会话写
（`server/src/api.ts` 21:08、`packages/i18n/src/locales/*` 21:13 为热文件 ⇒ 只做**增量 Edit**，不整文件重写）。
负载 `load1=41.5 / 16 核`，重验证排队跑。已知红：**D4**（`check:server-legal`）。

### 6.6 落笔的四笔提交，与**为什么代码那一笔现在不能落**

10-09 10:37 按用户指令分笔提交，四笔都走 `git commit -- <我的路径>`（带 pathspec）：

| 笔 | 内容 | 文件数 |
|---|---|---|
| `feat(账号面 门禁)` | `check:token-minting` + `check:email-normalization` + 共用的 `scripts/lib/strip-ts-comments.mjs` | 3 |
| `test(账号面)` | e2e 真浏览器套件 + 十一张图 + `check-journey-coverage.mjs` 的登记 | 9 |
| `docs(陷阱 #389 #390)` | 两条可迁移教训 | 1 |
| `docs(账号面 台账)` | §6.4 / §6.5 / §3 / §5 + ADR-0063 三处更正 | 2 |

🔴 **代码那一笔（服务端 + 共享层 + 两端界面 + 词条 + 法务）刻意没落**，三条都是现量、不是借口：

1. **注册点文件里我的行和别人的行在**同一行**上**：`server/package.json` 的
   `test:integration:postgres` 那一行同时含本线的 `email-change-and-sessions`、
   别人的 `inbound-worker-identity` 与 `registration-otp`，另有别人的 `"@heyta/inbound-core": "workspace:*"`
   —— 把这一枚提走 = 在 HEAD 上留一条指向**未入库包名**的 workspace 依赖 ⇒ `pnpm install` 当场坏。
   同一形状的还有 `packages/shared-schema/src/index.ts`（+32 行里本线只占 4 行）、
   `packages/app-host/src/index.ts`（+92）、`server/src/api.ts`（+596）、`apps/web/src/App.tsx`（+365/−470）。
2. **词条表此刻正被并行会话写**：`packages/i18n/src/locales/{zh-CN,en}.ts` 的 mtime 是
   提交前 **6 分钟**（10:27），而本线全部 `common.emailChange.*` / `common.sessions.*` 词条
   和他们的协作词条**混在同一个 blob 里**（现量：staged blob 里 `common.emailChange.` 命中 37 处，
   HEAD 里 0 处）。此时提交 = 把别人未完成的措辞署在我的提交信息下；不提交 = 面板引用的 key 不在 HEAD。
3. **索引里有别人预 staged 的 32 枚**（`git diff --cached --name-only | wc -l`，且从 21 涨到 32 ⇒ 正在写）。
   带 pathspec 提交不会带走它们（四笔之后复量仍是 32 ✓），但**他们**随后不带 pathspec 一提交，
   就会把本线的词条提到他们的信息下 —— 那是 §7 第 82 条那一族，归属由他们那笔决定，不由我。

⇒ 正确的落笔时机是**并行那几笔先入库**（协作线 + 入站线），之后本线剩下的一笔
（服务端 + 共享层 + 两端界面 + 词条 + 法务 + 迁移）就能干净自成一组。
现取命令：`git status --porcelain -- packages/i18n server/package.json packages/shared-schema/src/index.ts`
＋ `git diff --cached --name-only | wc -l`。
⚠️ 这条边界与 §5 第 11 条不是一回事：那条讲**装出来的产物**，这条讲**历史里的代码**。

### 6.7 移动端那一腿：设备窗口给了、三趟各红在别处，而它当场照出**一条真缺陷**

10-09 01:4x 产品负责人给出设备窗口（`emulator-5554` + `heyta-iphone-17pro` 两台 booted）。
三趟旅程各有根因，**只有一趟是产品**，而那一条不是移动壳的 —— 是服务端 `authCache` 的。
这一节按"装置 → 三趟 → 那条缺陷 → 续跑配方"记，因为装置与配方是下一个跑这一腿的人唯一需要的东西。

**两枚装置（都还没入库，落点见本节末）**

| 装置 | 形状 | 它能拒绝什么 |
|---|---|---|
| `scripts/verify-mobile-account-email-sessions.sh` | 14 步零 mock 真机旅程：注册 → 验证邮箱 → 改密 → 换绑双确认 → 列会话 → 撤一枚 → 另一枚照常 → `logout` → `revoke-all` | 走 `mobile-e2e` 那套共享 lib，所以服务端认证闸（cwd=`server/`、`dist` 不早于 `src`、进程启动晚于 `dist`、与 `ROOT` HEAD 一致）是它自带的 |
| `research/tools/account-email-sessions-http-probe.mjs` | 同一条旅程在 **HTTP + 库面 + 实时通道**上跑一遍，**判据标签到 38（10-09 13:2x 现量：`check()` 计数 39；§6.13 加了 31–38 那八条）** | 🔴 两道自检：① `PORT` / `PUBLIC_URL` / `HEYTA_E2E_LOGFILE` / `HEYTA_E2E_DB` 少一枚就**拒绝跑**；② 开跑前两条新路由必须回 **401**，不对就**拒绝跑** |

**自检当场抓到一次真误连**（这是那两道自检存在的理由）：这台机上 `:3000` 有一个 **10-06 的 dist** 在跑，
对本线那两条路由回 **404**。判据是 **404 ≠ 401** —— 形状不对就不继续。若探针只连端口不验形状，
整趟会对着那份旧产物跑完，那几十条要么全红、要么被误读成产品失败。
📌 这是 AGENTS §7 元规则 1（先怀疑探针）的一次**正例**：探针没坏，是它够不着的那个东西救了整轮。

**产物新鲜度怎么证的**（§6.1.1 / §7 第 27 条那一族）。APK 里是 Hermes 字节码，
🔴 中文在里面是 **UTF-16LE**，直接 `grep` 中文**恒 0**（traps #171）⇒ 判据必须**把要搜的词条先编成 UTF-16LE** 再搜。
现量命令（读数：`APK` mtime `10-09 01:52` = 本线移动侧那两节落地之后）：

```bash
APK=apps/mobile/android/app/build/outputs/apk/release/app-release.apk
unzip -p "$APK" assets/index.android.bundle > /tmp/h.bundle
python3 -c 'd=open("/tmp/h.bundle","rb").read(); print(d[:4].hex(), [(s, d.count(s.encode("utf-16-le")), d.count(s.encode())) for s in ["更换登录邮箱","发起更换","退出所有设备","退出这一台"]])'
```

12:07 实跑：魔数 `c61fbc03`、8 385 088 B，四枚词条 **UTF-16LE 命中 3/1/4/5 而 UTF-8 命中全 0**
⇒ 这一份 APK 里**确实**是本线当前的移动侧文案，而不是 §7 第 27 条那种旧 bundle。

**三趟红，各自的根因（只有一趟是产品）**

| 趟 | 屏幕上看到的 | 真实根因 | 这一趟产出什么 |
|---|---|---|---|
| 1 | `三次启动都没到前台` | **探针坏**：App 其实已经在前台，判定窗口 10×3 s 在负载 497 下不够（实测那台机上一次冷启动到前台 **27 s**）。⚠️ 更糟的是它连"没到前台"都**判错方向** —— 它会对着一个已经能操作的屏幕报失败 | 窗口放宽到 40×3 s。**只改判据不查根因就是 §7 元规则 1 的反例**，这一趟没犯 |
| 2 | 整族**逐条**红，一条都点不到 | 🔴 **模拟器系统语言是 `en-US`** ⇒ App 跟着走英文词条，而 lib 里那道 `privacy_gate_present()` **只认中文**，英文下它返回的是"没有门"（**不是**"没有同意"），于是脚本一直停在隐私同意之前 | traps **#391**：按文案定位的探针隐含"载体语言"前提。处置=`settings put system system_locales zh-Hans-CN` **且必须重起 App 进程** |
| 3 | `120 秒内没到前台（模拟器状态或宿主机负载？）` | **载体死了**：`adb devices` 空列、`ps` 里 emulator 进程 **0** 枚、swap used **6.2 G**、load **158–540**（风暴来自另一条线的 `.worktrees` 扇出） | 设备腿到本轮为止**仍未闭合**。⚠️ **没有**在这台 Mac 上重起模拟器 —— AGENTS §6.1 那条资源纪律（headless 模拟器 3.6 G+ 常驻 / 90 % CPU / 20 G+ 缓存）优先于"这一趟想跑完" |

🔴 三趟里**没有一趟**红在移动壳的代码上。这不等于移动壳没问题 —— 它等于**这一腿的证据还没取到**，
§5 第 10 条那一格按这个措辞改（见下面）。

**这一腿真正带回来的一条产品缺陷：`authCache` 按用户分格，撤销挡不住**

`server/src/auth-cache.ts` 的条目**只按 `userId` 分格**，而 `verifyToken` 的**命中路径直接回 `valid: true`、
根本不读 `sessionIsLive`**。于是：

1. 撤掉会话 C ⇒ 那一行删了，`authCache.invalidate(userId)` 也**确实调了**（ADR-0063 §2.5 就是靠这句立"没有空窗"的）；
2. 同账号的会话 B 下一次鉴权 ⇒ 把 `userId` 那一格重新焐热；
3. 会话 C 再鉴权 ⇒ **命中那一格**，压根没走到"这一枚还在不在库里" ⇒ **回 200**。

`invalidate` 一条都没少调，它挡不住的是**"别枚令牌把这一枚的判断替做了"**。
这条不是推理：判据 25 在第一版探针上打的是 `实测 200`，
而**当时 `server/tests/auth-cache.spec.ts` 与集成套件里那条"撤一枚不动另一枚"全是绿的** ——
它们检查的是"我有没有调 `invalidate`"，不是"撤销之后那一枚还能不能被接受"。

修法（一笔，键的形状换掉，`invalidate` 改成扫该用户的全部格）：

```ts
const keyOf = (userId: number, sessionId: string | null): string =>
  `${userId}:${sessionId ?? 'no-jti'}`;
```

`sessionId` 就是线协议上那枚 SHA-256 hex；**没有 `jti` 的老令牌落 `'no-jti'` 那一格**，
所以 §5 第 1 条那条"本轮之前签的令牌不可单独撤销"没有被顺手改掉。

**三层证据 + 每层一次变异**（读数都带日期；复跑命令在下面"续跑配方"）：

| 层 | 修后 | 变异（将缓存键改回只按 `userId`） |
|---|---|---|
| 单测 `server/tests/auth-cache.spec.ts` | `Tests 6 passed (6)`（10-09 11:2x） | `1 failed \| 5 passed` —— 红的是新加那一枚"另一枚焐热缓存，被撤的那一枚必须仍然 401" |
| 真 PostgreSQL 集成 `email-change-and-sessions.integration.spec.ts` | `14 passed`（10-09 11:4x） | `1 failed \| 13 passed (14)`，且红的**恰好**是 `链路 3b`，`✓ 链路 3` 仍绿 |
| 协议探针（真服务端 + 真库，跨进程） | `通过 31 项，失败 0 项`、判据 25 `实测 401`（10-09 12:08 复跑仍 31/31） | 修前那趟打的是 `判据 25 … 实测 200` |

🔴 **判据顺序本身是一个维度**（traps **#392**）：`链路 3` 撤的是**手上那一枚**，它先探自己 ⇒
缓存里那一格是它自己的，永远照不出"另一台把它焐热"。`链路 3b` 写的是
**先撤 C、再用 A 焐热、然后探 C** —— 只有这个顺序会红。
"两条用例断言同一件事、一条能红一条不能红"是变异测试唯一能照出来的东西。

⚠️ 集成那一层的**载体天花板**（不是产品失败，两条换绑用例在负载 371 下报 timeout，
`--testTimeout=30000` 复跑 `14/14`）：`server/vitest.integration.config.ts` **不设** `testTimeout` ⇒ 走 vitest 默认 **5 s**，
而真库 + 真 HTTP 在那台载体上会超。这一格**没有**顺手改配置（改默认超时是判据口径，不是本轮该拍的）。

**ADR-0063 §2.5 那句"所以 30 s 的缓存窗口不会变成撤销了还能用半小时"已就地更正** ——
它不是结论变更（撤销=删行、`jti` 会话、双确认三条裁决一条没动），是**一条实现事实写错了**，
而写错的这句话正是"为什么不需要额外撤销延迟设计"的依据。

**续跑配方（下一个跑这一腿的人从这里开始）**

```bash
# ① 槽端口 + 隔离库起栈（不要复用 :3000 —— 那是 10-06 的 dist，对本线路由回 404）
export PORT=3101 PUBLIC_URL=http://127.0.0.1:3101 HEYTA_E2E_DB=heyta_account_w9 \
       HEYTA_E2E_PIDFILE=/tmp/heyta-acc-mobile-3101.pid HEYTA_E2E_LOGFILE=/tmp/heyta-acc-mobile-3101.log
bash scripts/mobile-e2e-up.sh
# ② 协议层（判据到 38 条，零设备依赖 —— 设备死了也能跑这一层）
node research/tools/account-email-sessions-http-probe.mjs
# ③ 设备层前置：模拟器必须**中文**，且负载低到一次冷启动 < 40×3 s
adb -s emulator-5554 shell settings put system system_locales zh-Hans-CN
scripts/verify-mobile-account-email-sessions.sh
```

⚠️ 两处**仍未闭合**，不包装成完成：① 设备层那条 14 步旅程**一次都没跑完过**（趟 3 之后模拟器进程没了，
按资源纪律没重起）；② §5 第 9 条那句"`access_sessions.device_name` 没有任何客户端上报"会在设备层
**第一次被真实读到** —— 界面上那一栏此刻应当是空的，这条预期还没在真机上对过。

**落点**：装置与修复分散在两笔里 ——
`auth-cache.ts` / `auth.ts` / 两份 spec 属于本线那一笔**代码**（仍被 §6.6 那三条挡住：
现量 `git diff --cached --name-only | wc -l` = **42**（12:04，比 §6.6 写下的 32 又涨 10 ⇒ 还在写），
`git show HEAD:packages/i18n/src/locales/zh-CN.ts | grep -c 'common\.emailChange'` = **0**）；
`scripts/verify-mobile-account-email-sessions.sh` 与 `research/tools/account-email-sessions-http-probe.mjs`
**必须和词条同一笔落**，理由不是"登记表要同步"而是 `check:verify-script-copy` 会**自动**把
`scripts/verify-*.sh` 全收进输入集合（`readdirSync` + `/^verify-/`，128-167 行）——
脚本一入库，它里面每一句界面 needle 就得能在 `packages/i18n/dist` 里查到，**分两笔必先红那道门禁**。
✅ 预检已经跑过（这正是那道门禁存在的理由：把这类缺陷挪到**不占设备窗口**的地方）：

```bash
node scripts/check-verify-script-copy.mjs scripts/verify-mobile-account-email-sessions.sh
```

10-09 12:09 读数：`输入脚本=1 needle=14 命中词条表=14 … 缺失=0`、`RC=0`，
对照样本里就有本线那三句（`更换登录邮箱` / `两封信已经发出` / `还在等两个邮箱各点一次`）
⇒ **趟 2 那一族（needle 对不上词条）在这份脚本里不存在**，它红的是载体语言，不是文案。
根 `package.json` 里那枚 `verify:mobile-account-email-sessions` 别名此刻**加不了**：
`package.json` 正被别人 staged（现量 `git diff --cached --name-only | grep -c '^package.json$'`），
所以别名与脚本同一笔落 —— 这条与 §6.6 第 1 条是同一个阻塞，不是新开的。

⚠️ 旅程账本 `scripts/check-journey-coverage.mjs` 那一格**要写"已登记缺口"而不是"已验证"** ——
设备层一次都没跑完过；这条区分本身就是那枚门禁唯一判得动的事，写反了就是拿装置给自己发绿。

### 6.8 补记：iOS 那一腿其实**已经就绪**，缺的是窗口而不是产物

12:1x 现量（`heyta-iphone-17pro`，UDID `FE195661-B021-4A71-AAD1-1F2F7AE3A102`）：

| 事实 | 读数 |
|---|---|
| 模拟器 | `Booted`（iOS 27.0） |
| 系统语言 | `zh-Hans-CN` ⇒ **趟 2 那一族（traps #391）在这一侧不成立**，脚本可以按中文 needle 写 |
| 已装产物 | `Heyta.app/main.jsbundle` mtime **10-09 01:43**、Hermes 魔数 `c61fbc03`、10 195 120 B |
| 🔴 里面有没有本线那两节 | UTF-16LE 命中 `更换登录邮箱 3 / 发起更换 1 / 退出所有设备 4 / 退出这一台 5 / 登录设备 7`，UTF-8 全 0（同一把尺见 §6.7 那段命令） |

⇒ **设备腿不需要重新构建**，`xcodebuild` 那一格早在本轮之前就装过了；缺的只有一份 **iOS 侧驱动脚本**
（Android 那份是 adb 的，逐条点不了 AX）与一个**没人占用的窗口**。

🔴 **此刻不能上，两条都是现量**：

1. 那台模拟器上挂着一枚 `idb_companion`（pid 27352，起于 **10-08 08:19**，父进程是**另一条会话**的
   `codex app-server`，监听 `*:11983`）—— 不是我的装置。AGENTS §8 工作流第 9 条
   （同一模拟器不得并行覆盖）与"只对自己创建的对象动手"两条都挡在这里。
2. 同一时刻（12:09 起）有会话在跑**整族** `check:ai-e2e`
   （`sh -c node scripts/check-ai-e2e-preflight.mjs && pnpm --dir e2e run test` + 4 枚 chromium headless）——
   这就是 §6.7 那个 load 342 与趟 3 那台模拟器死亡的来源。

⚠️ 所以这一格的准确措辞是 **"窗口不属于我"，不是"载体坏了"** ——
两者在台账里长得一样，但只有前者的等待条件是"别人跑完"，后者会诱使下一个人去重起模拟器。

**能上时的现量判据（两条，先跑这两条再决定要不要动手）**：

```bash
xcrun simctl list devices booted
ps aux | grep -E '[i]db_companion' | grep -c FE195661        # >0 就还不是我的窗口
ps aux | grep -E '[c]heck-ai-e2e|[p]laywright' | wc -l        # >0 就别抢（负载 + SIGKILL 专用端口）
```

**驱动脚本的形状**（留给下一位，本轮**没有**写它 —— 写了也跑不了，而一份跑不了的验收脚本
就是一条会腐烂的判据）：复用 `verify-mobile-ios.sh` 的 TCP companion 用法（trap #263：
可执行文件路径与 `HOST:PORT` 必须分开传，只能给 `--companion`）与
`scripts/tools/ios-ax-shim.test.py` 的几何安全检查（trap #25：AX 报 `success` 只代表 HID tap 被设备接受）。
判据只要 §6.7 那 31 条里**界面半边**的那几条：两节渲染出来 → 发起更换后状态区读到"还在等两个邮箱各点一次" →
会话列表里 `current` 只有一枚 → 撤"这一台"之外的那一枚 → 手上这枚仍 200。

#### 6.8.1 12:3x 摸完现状之后，这一格从"留给下一位"变成**一枚有名字的接缝**

跑之前先量了这台模拟器的现状，两条读数决定它不是"写个脚本就能跑"：

| 现量 | 读数 | 后果 |
|---|---|---|
| 已装 App 的本地库 `Library/heyta.sqlite` | `ops` = **0 行**；`meta` 只 1 行，里面**一条 http URL 都没有** | 这台是**全新未配置**态 ⇒ iOS 旅程必须自己走完"填服务器地址 + E2EE 口令 + 访问令牌"那一步才到得了已登录 |
| 那一步的实现住在哪 | **不在** `scripts/lib/mobile-e2e.sh`（那里只有 `idb_dump / idb_has / idb_label_center / idb_field_center / ok / bad / summary` 这些原子），而是内联在 `scripts/verify-mobile-ios-account-erasure.sh:662` 的 `fill_three_credentials` 与其依赖簇：`open_settings_sheet`、`fill_field`、`dismiss_ios_save_password`、`close_settings_sheet`、`ax_press`、`idb_wait_label`、`HOST_SERVER`、`E2EE` | 那一枚脚本 **1055 行、属于注销那条线**。复制这七个函数就是 AGENTS §3.5 数过的那种"同一件事的第二份实现"（代价是两套裁决标准）；正道是**由那一格的 owner 把这簇抽进一份 iOS rig lib**，抽完之后本线的旅程只剩约 120 行判据 |

🔴 **为什么这一抽不由本线代做**（不是懒，是验不动）：搬共享函数要主张"运行时形状逐字段等于改前"，
而对这簇唯一有意义的复验 = **把那一格 1055 行的整条验收再跑一遍**，它要占的正是此刻挂着
别人 `idb_companion`（pid 27352，起于 10-08 08:19，父进程是另一条会话的 codex app-server）的那台模拟器。
没有窗口就没有复验，**没有复验的搬迁比复制更危险**。
⚠️ 载体读数一并留着：12:35 `load 29.11 / 26 / 60`（比 §6.7 那三趟时的 342 已退潮），
但仍有 5 枚 headless chromium 在别人那族 e2e 里没收尾。

⇒ 这一格的**准确等待条件**从"给个设备窗口"改成：**与注销那条线约一次共享窗口，把那簇抽成 lib，本线再补旅程**。
`BLOCKED.md` 里那一格由 owner 那一线登记更合适（本线不代写别人的账）。

### 6.9 换缓存键之后跑的那一层全量单测：它抓到的是**本线自己的两处旧调用点**

改的是 `src/auth-cache.ts` 的**函数签名**（`get(userId)` → `get(userId, sessionId)`），
而**没有任何编译期的一档会拦下 `tests/` 里的旧调用点**（这一族并入 traps **#210** 的第三种面目）。
三条都是结构性事实，现量命令附在后面：`server/tsconfig.json` 的 `include` 不含 `tests`、
`server/package.json` 的 scripts 里**没有 `typecheck`**（所以 `pnpm -r typecheck` 对这一包**根本没有这一步**）、
vitest 用 esbuild 只做转译 ⇒ arity 错**不报错**，只是拿到 `undefined` 参数、读到空的缓存格。
⇒ 服务端构建 RC=0 而两份 spec 已经坏掉，这**不是矛盾**；唯一的可见层是把那一包的 vitest 整包跑一遍。

```bash
node -e "const p=require('./server/package.json');console.log('typecheck' in p.scripts)"   # false
node -e "console.log(require('./server/tsconfig.json').include)"                            # [ 'src/**/*', 'scripts/**/*' ]
```

10-09 12:1x 那一趟（载体 load 342）：`Test Files 2 failed | 150 passed (152)`、
`Tests 6 failed | 2683 passed | 1 skipped (2690)`。逐条归属：

| 红的那几条 | 现量证据 | 归属 |
|---|---|---|
| 5 条 `sync-compressed-body.routes.spec.ts` | 断言的是 `uploadOps` **调用参数形状**多出一枚实参；出处 = 未提交的 `server/src/sync/sync.types.ts` 新增 `inboundCommitProofs?: Record<string, string>`（`git diff -- server/src/sync/sync.types.ts`） | 入站那条线。本线**一枚 `server/src/sync/**` 都没碰**（本线服务端改动是 `server.ts`/`auth.ts`/`auth-cache.ts`/`account/*`/`password/*`，另有 `api.ts` 里 2 行邮箱归一化收口 —— 那张文件同一枚 diff 里另有他们 10 行，见 §6.10） |
| 1 条 `validation.service.spec.ts` | 它断言 `ALLOWED_ENTITY_TYPES.size === HEYTA_ENTITY_TYPES.length`，两侧现在不等；出处 = **别人 staged 的** `packages/shared-schema/src/entity-types.ts` 新增 `TASK_COMMENT`（ADR-0062 协作线，`git diff --cached -- …/entity-types.ts`） | 与 §6.5 第 1 道 `check:reachability` **同一根因** |

🔴 而这一层**为**本线抓到的两条（两条都红在 `expected null not to be null`）：

1. `tests/account-security.routes.spec.ts` 里"撤销前先把两枚都焐热"那一句用的是 `authCache.get(USER_ID)`。
   修法不是把断言改窄：换成**逐枚验两格**（`get(USER_ID, a.sessionId)` + `get(USER_ID, b.sessionId)`），
   因为 `invalidate(userId)` 的语义本来就是"扫掉这个用户的全部格"—— 探针比原来更贴那条不变量。
2. `tests/access-sessions.spec.ts` 那条"🔴 特征：缓存命中时这一层整段跳过"**整段描述的是已经被修掉的行为**
   （它把"另一枚焐热 ⇒ 被撤那枚仍 `valid: true`"当成**已知空窗的形状**钉住）。
   按 AGENTS §8 第 8 条改写正文而不是删掉它：**invalidate 那一档保留**（同格空窗仍然真实，
   删掉 `invalidate` 这件事仍要在**两个文件**里都红），另**加一臂**"另一枚刚被焐热，不能替这一枚做判断"
   —— 上面四条在两种键形状下都绿，只有这一臂能区分。

修后读数（12:17）：`tests/access-sessions.spec.ts` + `tests/auth-cache.spec.ts` +
`tests/account-security.routes.spec.ts` 三份一起 `Tests 61 passed (61)`，RC=0。

变异（把 `keyOf` 退化成按 `userId`，**保留** `no-jti` 那一支，好让变异只打"会话分格"这一维）：
`Tests 2 failed | 59 passed (61)`，红的**恰好**是
`access-sessions.spec.ts > 🔴 特征…` 与 `auth-cache.spec.ts > a warm entry for one session…` 两条新臂。
⚠️ 如实记一条**不算判据**的观察：`account-security.routes.spec.ts` 在两种键形状下**都绿**
（退化时两枚写进同一格，`get(USER_ID, a.sessionId)` 仍然非空）—— 它验的是"撤销前缓存确实有东西"，
不承担区分键形状这件事；别把它读成"这一层已经覆盖了那个缺陷"。
还原：`cp src/auth-cache.ts.mut-bak src/auth-cache.ts` + `cmp -s` 通过（`RESTORE=ok`），
`grep -c MUT` = 0，只从 `.mut-bak` 还原、没走 git。

⚠️ **有一处注释刻意保持原样**：迁移文件 `20261018140000_add_email_change_and_access_sessions` 第 63 行
那句"撤销时当场 `authCache.invalidate(userId)`"没有改 —— AGENTS §4「永不修改已应用的迁移」
（它已在验收库 `heyta_account_w9` 上应用过，改注释会造成 checksum 漂移）。
更正写在四处：`server/prisma/schema.prisma`（那三行补了前提）、`server/src/account/access-sessions.ts`
规则 3、`server/src/auth.ts` 的 ⚠️ 段，以及 ADR-0063 §2.5。

### 6.10 代码那一笔的阻塞集，12:2x **重取**之后形状变了三条（含一条对本台账自己的更正）

现量：`git diff --cached --name-only | wc -l` = **42**，全部属于协作线（shares/comments，ADR-0062）
与入站线；逐枚名列在 `git diff --cached --name-only` 里，本台账**不抄这份清单**（它每十分钟就不是这个样了）。

| 注册点 | §6.6 当时记的 | 12:2x 现量 | 本线能不能单独取 |
|---|---|---|---|
| `server/package.json` | 我的行与别人的行**在同一行**，且含未入库包名 `@heyta/inbound-core` | 它**已经离开**他们的暂存集（现在是 ` M`）；`@heyta/inbound-core` **已在 HEAD**（`git ls-tree -r HEAD -- packages/inbound-core` 有产物），但那一行还指着 **未入库** 的 `server/tests/integration/registration-otp.integration.spec.ts`（磁盘上有、`git ls-tree HEAD` 里 0） | ❌ 单独取 = 在 HEAD 上留一条指向**别人未入库 spec** 的脚本，干净检出上那条 `test:integration:postgres` 直接找不到文件 |
| `packages/i18n/src/locales/{zh-CN,en}.ts` | 我的 37 枚 key 与他们的措辞混在同一个 blob | 仍 `M `（staged），staged blob 里本线 `common.emailChange\|common.sessions` **37 处**、协作线 `comment\|share\|评论\|共享` **75 处** | ❌ 取走 = 把别人未完成的措署在本线提交信息下；不取 = 面板引用的 key 不在 HEAD |
| 根 `package.json` | （§6.6 只记了"被别人 staged"这一半） | 仍 `M `，且 staged 版本里本线那枚 `verify:mobile-account` 别名 **0 处** | ❌ 别名与脚本必须同一笔（见 §6.7 那段 `check:verify-script-copy` 的自动收录） |
| `server/src/api.ts` → 其实注册点是 `server/src/server.ts` | 🔴 记的是"api.ts +596 行里本线只占几行" | **这句按现量更正**：本线的服务端接线**不在 api.ts**，注册点是 `server/src/server.ts` 那四行（`import { accountSecurityRoutes }` + `await fastifyServer.register(accountSecurityRoutes, { prefix: '/api' })`）。现量：`git status --porcelain=v2 -- server/src/server.ts` 打的是 **`.M`**（只有未暂存改动），而 `git diff -- server/src/server.ts` 的 `^+` 行**全是本线那四行** | ✅ 这一枚**单独可取** —— 但它等的是下面那一枚（路径常量） |
| `packages/shared-schema/src/index.ts` | +32 行里本线只占 4 行 | ✅ **已单独落（`343ffc8a`）**，而且落之前先更正了本台账自己的两处错记：① 那 25 行未暂存差异**全是本线的**（先前那次"归属探针"拿 `share` 当特征串，把 `shared` 这个词自己命中了 ⇒ 假阴性一个人都没抓到）；② 这一枚**根本不在他们的暂存集里**（`.M`，只有未暂存改动），所以"要替别人重写 index blob"那句前提当场不成立 | ✅ 落法：整枚 pathspec 取走，两枚新契约文件零 import、`tsup.config.ts` 只有 `src/index.ts` 一个 entry ⇒ 不需要动 `package.json`。复验：该包 build RC=0（含 tsup 的 dts 档）+ `Tests 173 passed (173)` |

🔴 **顺手否证掉本会话自己刚假设过的一个最坏形状**：12:2x 曾推"他们那份 staged 的 `server.ts` 里可能已经带着本线那行 import ⇒ 他们一提交，HEAD 就得到一句指向**未入库文件**的 import、构建当场坏"。
三行现量把它推翻：`git show HEAD:server/src/server.ts \| grep -c accountSecurityRoutes` = **0**、
`git show :server/src/server.ts \| grep -c …` = **0**、工作树 = **2** ⇒ **他们那笔不会带着本线的接线**。
记下来是因为"会撞坏别人"这类判断和"没人挡我"一样，**只有 `git show :<file>` 这一种读法能定**，
从"这枚文件在暂存集里"推不出来。

🔴 结论没有变，但**理由换了**，而这个理由要写清：不把代码一笔整部落，不是"每一枚注册点都被挡住"，
而是**这一批本身是一个原子集** —— `schema.prisma` 的 `AccessSession` 模型 + 迁移 +
`server/src/account/*` + `auth.ts`/`auth-cache.ts` 的新签名 + `server.ts` 那四行注册 +
`@heyta/shared-schema` 里那两枚路径常量 + 两端面板引用的 i18n key。
🟢 **这一节写完之后原子集缩了一次**：路径常量那一枚已单独落（见上面那张表的 shared-schema 那行），
所以现在挡着的只剩 **i18n 两份词条表**（仍 `M `、staged blob 里本线 37 处 / 协作线 75 处）、
根 `package.json`（仍 `M `）、`server/package.json`（那一行还指着别人未入库的 spec）。
⚠️ 另外记下服务端那一笔的一条**结构性**依赖（**尚未实测**）：`server/src/copy.generated.ts`
是 i18n 词条的生成物且已在库里，服务端代码落库而词条不落 ⇒ 那条门禁按 HEAD 的词条重生成再逐字节比，
应当红 —— 机制出自 AGENTS"改词条必须重跑生成"那一档的反面，但要判它还得构造一次部分提交，本轮没造。
**任取其一都会在 HEAD 上留下一个跑不通的形状**，而它不一定报出来：
最硬的一环原本是那两枚路径常量 —— 服务端与客户端 import 的是**同一个字面量**（这条纪律本轮刚立），
它不在 HEAD 时两侧就各拼各的；这一节写完之后它已单独落库（`343ffc8a`），所以现在最硬的一环换成 i18n。
至于"面板引用不在 HEAD 的词条 key"那一档**由谁拦，本轮没验**
（判它要么构造一次部分提交 —— 那是在共享检出上自己造红，不划算；要么读 `check:ui-language` 的实现，
那是别人的判据口径，不该由我这一笔记成结论）。
逐枚试探过一遍的事实就记在上面那张表里。

📌 这一节要留下的教训与 §6.6 那条是同一族的第三面：**「谁挡住了我」必须每次重取，
而重取之后常常发现挡住的不是当初记的那一枚**。本轮四处都变了形：
`server/package.json` 离开了他们的暂存集（但那一行仍指着别人未入库的 spec，所以照样不能单独取）、
本线服务端接线的注册点其实是 `server.ts` 而不是 api.ts（**本台账自己记错的一条**）、
`shared-schema/index.ts` 那 25 行全是本线的、且它根本不在他们的暂存集里（先前那句"要替别人重写 index blob"
的前提当场不成立 ⇒ 已单独落），
而真正没变的是 i18n 那一枚 —— 它从 10:55 起一直是 `M `。
⚠️ 这一族的成因值得单独记一句：那两次错记都来自**同一种探针写法** ——
拿 `share` 这类子串当"归属特征串"去 `grep`，结果 `shared` 这个词自己命中了。
**归属探针要用区分大小写的完整标识符**（`SharePanel`、`inboundCommitProofs` 这种），
否则它会同时造出假阳性（"这枚文件被污染了"）和假阴性（"这一枚不能单独取"），而两种错都会让人不去动手。
判据现量命令就在表里，别照抄这一节的结论去决定下一笔要不要落。

### 6.11 全量单元测试那一趟：43 条红逐条归属，其中**零条在本线文件上**，而覆盖对账自己抓到一层从没起跑

跑法：`pnpm -r --no-bail test`（`NO_COLOR=1`），10-09 12:40–12:43。
**为什么带 `--no-bail`**：默认那条会在第一个失败包停下 —— 12:39 先按默认跑过一趟，
它停在 `packages/ai`，于是只拿到 **4 行**汇总，而**有 `test` 脚本的包是 21 枚**。
AGENTS §6 那条对账（"两数不等就说明有一层从来没被跑过"）在这一趟里以两种方式各命中一次：
一次是 bail 造成的 4 ≠ 21，一次是 `--no-bail` 之后仍然 **20 ≠ 21**。

🔴 **那 21 枚与 20 枚之间差的正是 `packages/sync-core`**：它的 `test` 是
`npm run test:typecheck && vitest run`，而 `tsc -p tsconfig.spec.json` 在
`tests/share-keys.spec.ts:234` 报 **TS2345 少一个 `identity` 参数** ⇒ **vitest 从来没起跑**，
所以它连一行 `Tests` 都不会打。归属：那枚 spec 配套的 `packages/sync-core/src/share-keys.ts`
正在他们的 42 枚暂存集里（协作线，ADR-0062 的 share 那一族）。
⚠️ 值得单独记住的形状：**一层"类型检查先跑"的测试在类型检查失败时不会计入任何测试读数** ——
它既不算红也不算绿，只在 `--no-bail` 的 rc 里现形；不数"有 test 脚本的包 vs 打了汇总行的包"就看不见它。

**总和（现量取自那一趟的汇总行）**：`passed 12937 / failed 43 / skipped 14`。43 条的逐条归属：

| 包 | 红数 | 是什么 | 归属（带现量） |
|---|---|---|---|
| `packages/ai` | 5 | `capability-manifest.spec.ts`：产物与上游不逐字一致、工具集合双向不等、kind 逐字、分母成员点名、剔除项登记 | 协作线加了实体没重生成清单。现量：`node scripts/gen-ai-capability-manifest.mjs --check` 打出的"应为"集合里含 **`COMMENT`**，产物里没有；与 §6.5 第 1/11/12 道同源 |
| `packages/domain` | 1 | `subscription.spec.ts > contract with server/src/entitlement.ts`：断言"我们知道的全部 denial reason 与服务端那侧逐字相等"，实测**服务端 16 枚 vs 这份清单 8 枚** | 不是本线（本线一枚 entitlement 词都没加）。深因归收款/AI 计量那一族，**本轮不代归因** |
| `apps/mobile` | 1 | `legal-recheck-mobile.spec.ts > 补签闸门的宿主接缝 > 没配凭据时一个请求都不发、判 anonymous 且不拦` | 补签/法务那条线，不是本线 |
| `server` | 7 | §6.9 那 5 条 `sync-compressed-body` + 1 条 `validation.service`（`COMMENT` 实体进了共享清单）+ **新增的第 7 条** `backup-script.spec.ts > the closure ledger carries one row per tombstone` | 🔴 第 7 条**单跑复验后判为载体**：`npx vitest run tests/backup-script.spec.ts --testTimeout=90000` ⇒ `16 passed (16)` RC=0，而它在整包里报的是 `Test timed out in 20000ms`。**同一条在 §6.9 那趟（6 红）与这一趟（7 红）之间的差就是负载**（12:43 那次现量 `load 339.76`），不是产品 |
| `apps/web` | 29 | 13 份文件 | 拆两半，见下 |

`apps/web` 那 29 条**不能整块推给载体**，所以把那 13 份文件单独复跑了一遍
（`npx vitest run <13 份> --testTimeout=90000`）：`Test Files 2 failed | 11 passed (13)`、
`Tests 9 failed | 151 passed (160)` ⇒

- **20 条**是默认 5 s 超时的载体红（在 90 s 预算下全过）。这与 traps #392 那格同族，
  但它是**单位层**（jsdom 测试），比集成层更容易被负载打到 —— 记在这里以免下一个人重新查。
- **残留 9 条**集中在两份文件：`ai-panel-remount.spec.tsx`(4) 与 `assistant-history-panel.spec.tsx`(5)，
  九条的 Error 是**同一条**：`useHeytaUiTheme 必须在 <HeytaUiProvider> 内使用`。
  归属现量：那两份 spec 渲染的是 `apps/web/src/features/ai/AssistantPanel`，
  而 `apps/web/src/features/ai/*` 有一整片 ` M`（体验/AI 那条线正在写）；
  本线在 `apps/web` 只碰 `features/settings/*` 那几枚与 `App.tsx` 的接线。
  ⇒ **不是本线的文件**；深因（他们新用的那个 hook 没进测试夹具）归那条线自己判，
  本线不代改别人的判据夹具。

🔴 本线在这一趟里的位置：**43 条红里没有一条落在本线的文件上**。
本线那份 web 面板 spec 另外**单独复跑取过直接读数**：
`npx vitest run tests/account-security.spec.tsx --testTimeout=90000` ⇒ `Tests 41 passed (41)`，RC=0
（引这个而不是整包那 2156 —— 整包读数不指名到文件，单跑才算直接证据）。
⚠️ 这条结论的边界要说清：它说的是**当前共享工作树**（含别人未提交的改动）；
**不等于**"本线那一笔落到干净 HEAD 上会绿"——那一格要等代码整笔入库后在隔离副本里再取一次
（AGENTS §8 第 9 条：隔离副本通过不能冒充主检出后续改动已验）。

**同一时段落的第二笔**：`343ffc8a` 那枚共享契约层落之前/之后各取一次复验 ——
`pnpm --filter @heyta/shared-schema build` RC=0（含 tsup 的 `dts` 那一档，traps #162 说的就是它），
`pnpm --filter @heyta/shared-schema test` `Tests 173 passed (173)`。
另外两枚新装置过了它们能过的静态档：`bash -n` SYNTAX=OK、
`check:verify-script-copy` 14/14 needle 命中、`check:script-snapshot` 把它计入 41 枚在位脚本。

### 6.12 落笔清单：等 i18n 一放行就是一条命令，而这条命令的**分母是现取的**

12:5x 把"本线还没入库的到底是哪些文件"按内容签名枚举了一遍。做法：对 `git status --porcelain -uall`
的每一枚，未跟踪的读文件内容、已跟踪的读 **`git diff HEAD`**，命中原词表
（`EMAIL_CHANGE|SESSION_PATHS|ADR-0063|emailChange|common\.sessions|access_sessions|sessionIdOf|…`）算本线的，
再用对方的原词表（`TASK_COMMENT|ShareEncrypted|share-|inboundCommitProofs|widget|assistant-history|habit-export|…`）
判是否混着别人的。

🔴 **第一版把这条做错了，而且错的方向正好是会让人贸然动手的那一边**：已跟踪那半用了 `git diff`
（比的是索引 vs 工作树），对别人 staged 的词条表恒为空串 ⇒ 读数打成"混着别人 = **0**"，
看起来像"本线这 64 枚随时能单独落"。换成 `git diff HEAD` 之后同一趟变成
**`纯本线 = 64 / 混着别人 = 6`**。这条并入 traps **#394**（"枚举归属的探针必须先确认比的是哪两个对象"），
里面带三条现量命令：那一枚词条表 `git diff` = 0 行、`git diff HEAD` = 1683 行、状态首列是 `M `。

🔴 **同一个探针还有第二个缺陷，也是当场被自己的复跑纠正的**：判归属时拿的是**整段 diff**，
而 diff 里的**上下文行**也带着别人那些标识符。后果两头都错了一次 ——
`packages/legal/tests/structure.spec.ts` 被误判成混合（它的新增行里只有本线的 `access_sessions`），
而 `apps/web/src/App.tsx` 被误判成纯本线。改成**只取 `^[+-]` 那几行**再重跑：
**`纯本线 = 63 / 混着别人 = 7`**，其中第 7 枚是本台账自己（`docs/plans/account-standard-suite.md`
—— 它引用别人的标识符是为了记账，不参与归属分类，这一枚要从集合里剔出去）。
⇒ **真正挡着的代码文件是 6 枚**：

| 文件 | 混合形态 |
|---|---|
| `packages/i18n/src/locales/zh-CN.ts` / `en.ts` | 🔴 他们 **staged**（`M `），blob 里本线 37 处 / 协作线 75 处 —— 取它 = 消费掉他们那份暂存态 |
| `packages/app-host/src/hosted-auth.ts` | 未暂存混合：他们那三行注册入口（`requestEmailPasswordRegistrationCode` 等）与本线引 `account-security` 那行同文件 |
| `packages/app-host/src/index.ts` | 未暂存混合：本线那 17 行导出块与他们的 habit-export / assistant-history / widget-publish / task-batch 各块并列 |
| `apps/mobile/src/screens/ProfileScreen.tsx` | 未暂存混合：本线那一节（`common.sessions`）与他们的 `Widget*` / `assistantOpen` 同文件 |
| `apps/web/src/App.tsx` | 未暂存混合：本线的设置面接线与他们的 widget/assistant 面同文件（**这一枚第一版探针判成"纯本线"，是那个缺陷的反面**） |

⇒ **等的那一件事缩小成两枚文件**：词条表一旦随他们入库，剩下这 4 枚混合文件本线就能整枚取走
（它们的未提交内容 = 他们的 + 本线的，而那些"他们的"此刻已在 HEAD 里，取走不再算代署）。
⚠️ 但顺序要反过来才成立：**本线这一笔必须排在他们那笔之后**，否则同样的混合又变成代署。

**落笔时的命令形状**（清单**不冻结在这份文档里** —— 它每十分钟就不是这个样子，现取就是上面那条枚举）：

```bash
# 1) 现取本线未提交集（把上面那段枚举原样跑一遍，拿"纯本线"那一列）
# 2) 逐枚 pathspec 提交，绝不用 -A
git add -- <那 64 枚 + 词条表两枚（届时已入库，无需再取）> && git commit -- <同一批路径> -m "…"
# 3) 复量：他们的暂存集必须一条不少地还在
git diff --cached --name-only | wc -l
```

**落完必须跑的那一排**（每条都指定了它挡的是本线哪一格，不是"跑一遍全绿"）：
`pnpm --filter @heyta/sync-server build`（迁移与 Prisma 客户端 + `server.ts` 注册）、
`pnpm check:migrations`（那一笔迁移的形状）、`pnpm check:server-copy` 与 `check:server-design`
（`copy.generated.ts` 与词条表/ token 的逐字节对账 —— §6.10 那条"尚未实测"的依赖就是它）、
`pnpm check:ui-language`（两节引用的 key 必须中英都在）、
`pnpm check:verify-script-copy`（新装置那 14 枚 needle）、`pnpm check:script-snapshot`、
`pnpm check:integration-coverage`（新集成套件在 `test:integration:postgres` 那一行里点了名），
以及 `pnpm --filter @heyta/sync-server test:integration:postgres` 只跑本线那一份文件（负载高时带
`--testTimeout=30000`，见 §6.7 那条载体天花板）。

🧹 顺手清掉的自有残留（都是本会话自己造的、且当场判过无用）：`.mut-w6-bak/`（3 枚）与
`research/tools/.mut-credential-sweep-bak/`。判"无用"的依据不是"看着像备份"：
`authenticator-notice.ts` 那份与活文件 `cmp -s` **逐字相同**；另两份是**已跟踪**文件的旧形态，
它们的回退点在 `git diff HEAD` 里，不在我这儿。复量：`git status --porcelain | grep -c 'mut-'` = 0。

**13:3x 补：这一节自己变长了，落笔集合也跟着变（一枚新门禁 + 一次单行撞车）**

- 新增两枚未入库文件要一起走：`scripts/check-session-revocation.mjs`（§6.13 的门禁实现）与本台账自己。
- 🔴 `package.json` 这一枚是**单行撞车**，不是混合 hunk：本线在两处加了字
  （`"check:session-revocation"` 定义一行，以及 `check` 那条巨型链里插入的一段），
  而**链那一整行同时也在他们那份 staged 内容里**（他们那笔正往链里加 `check:token-minting` /
  `check:email-normalization` —— `git diff --cached -- package.json` 现量 8 增 2 删）。
  一整行没法按 hunk 拆 ⇒ 落笔时必须**先重取一次并集**再提交：
  `git diff --cached -- package.json` 与 `git diff -- package.json` 两份读数的并集，
  缺一段链就要 `check:gate-wiring` 红（它抓的正是"定义在、链里没有"，
  本线已经用它做过一次负向：`--pkg` 注入"链里去掉这一道"⇒ `rc=1`）。
  ⚠️ 反方向同样成立：**他们后落的话会把这一行整行覆盖回去**，所以谁最后动这一枚，
  谁就要在提交前重新并一次链。这不是仪式 —— `check:gate-wiring` 的文件头记的就是
  2026-10-03 那次"唯一冲突文件就是 package.json，两侧差异全是各自加门禁"。

**13:3x 静态门禁现量（本线全绿，三处红都在别人那半）**

| 门禁 | rc | 归属 |
|---|---|---|
| `check:gate-wiring` · `check:md-tables` · `check:doc-citations` · `check:docs-voice` · `check:script-snapshot` · `check:claims` · `check:journey-coverage` · `check:integration-coverage` · 新加的 `check:session-revocation` | 0 | 本线（新加那道的 `--self-test` 全臂 OK，接线还做过一次 `--pkg` 负向） |
| `check:docs`（死链） | 1 | `apps/desktop-windows/README.md:89` → `scripts/windows/launch-data-transfer-qa.ps1`：本机有、git 没跟踪（`?? `），属数据迁移那条线 |
| `check:verify-script-copy` | 1 | 2 枚缺失 needle（`填好服务器地址与访问令牌后才能同步。`）住在 `scripts/lib/mobile-e2e.sh:1475` 与 `scripts/verify-mobile-habits.sh:631`，两枚文件都**干净**（`git status` 无输出）⇒ 红的是**他们 staged 的那份词条表**改了句子，不是脚本 |
| `check:layering` | 1 | `apps/web/src/features/share/share-key-store.ts:56` 的 `entityType: 'SHARE_KEY'` —— 协作/分享那条线 |

🔴 记一条口径：这三处红**不是**"本线整链 `pnpm check` 绿"的一部分，落笔前必须逐条问"这一枚是谁的文件"，
问法就是 §6.12 上面那套枚举（`git status --porcelain -- <path>` + `git diff HEAD -- <path>` 只取 `^[+-]`）。

### 6.13 「改密码把人踢下线」当时只做到了 HTTP 那一半（13:2x，一条**类别级**的缺口 + 一枚新门禁）

起因是收口的最后一问：换绑、改密、重置这三条密码旅程，撤销动作做全了没有。读数是这样的 ——
`revokeAllSessions(userId)`（删会话行）全仓只有**两**个调用点（后台强制登出、`/revoke-all`），
而抬 `tokenVersion` 的地方有 **6** 处（`grep -rn "tokenVersion: { increment" server/src` 命中 8 行，
其中 `admin.routes.ts` 那 2 行在注释里，是文档不是代码）。两件事一减，缺口就是三条路：
**改密、重置口令、换绑生效**只写了计数器，既没删会话行，也**没关实时通道**。

🔴 漏掉的那一半不是整洁问题，是一条安全属性没主人。`closeForUser` 自己的注释写着：
通道**只在 upgrade 时鉴权**，之后靠心跳维持，"without this a revoked device would keep receiving
op notifications indefinitely"。所以只 bump 时，那台旧设备的每一次 HTTP 都 401、界面上写着"已登出"，
而它**已经打开的那个页面**继续实时收这个账号的 op。换绑那一条更难看：JWT 的 payload 里就带着
`email`，于是继续收用的是**上一个地址**那枚令牌。`auth.ts` 里 `TOKEN_REVOKED` 的注释本来就把
"改密 / 换绑 / 后台强制登出 / passkey 恢复"都算撤销事件 —— 声称与实现之间缺的正是这一格。

**修法修在收口处**，不在三处各抄两行：`access-sessions.ts` 新增 `revokeAllDeviceSessions(userId)`
= 删该人全部会话行 + `closeForUser`，并写明它**不碰计数器**（计数器与那次 `user.update` 必须同一条写）
与"排在 `issueSession` **之前**"的顺序约束。然后：三条缺口的路各补一句；两处原本把两半分开写的站点
（`/revoke-all`、后台强制登出）收进同一个助手 —— 现在"撤全部"在仓库里只有一种形状。

判据分四层取，每层都能红：

| 层 | 新增判据 | 变异读数 |
|---|---|---|
| 单元 `password-recovery.spec.ts` | 4 条（重置成功撤通道+删行 / 改密成功同上且**删行排在铸新行之前** / 链接无效不撤 / 口令错不撤） | 三处调用同时摘掉 ⇒ **恰好 5 红**（另两处在 HTTP 层），失败路径那两条**保持绿**（它们钉的就是"不许乱撤"） |
| HTTP 半边 `password-auth-routes.spec.ts` | 2 条（改密与重置那两条既有用例各加一句 `closeForUser` 被以这个人 id 调用） | 同上一趟变异里一起红 |
| 顺序专项 | 上面那条"删行 < 铸行"用的是 `invocationCallOrder` | 只把改密那次撤销挪到 `issueSession` 之后 ⇒ **恰好 1 红**，红的就是顺序那一句（`expected false to be true` @ `deleteBeforeCreate()`） |
| 真运行时（真 dist + 真 Postgres + 真 WebSocket） | 探针 `research/tools/account-email-sessions-http-probe.mjs` 新增 31–38：**改前产物 `通过 37 项，失败 2 项`**（34 `close=null`、35 库里剩 3 枚），重建重启后 **`通过 39 项，失败 0 项`**（34 实测 `close=4003`、35 剩 1 枚、37 失败那次谁都没被踢、38 一行都没删 `1 → 1`） | 这一层本身就是"改前红 / 改后绿"的对照，不是桩 |

门禁 **`pnpm check:session-revocation`**（`scripts/check-session-revocation.mjs`，已进 `pnpm check` 链）
把这条不变量钉成结构判据：① 每处代码级 bump 所在文件必须关得到通道（`closeForUser(` 或
`revokeAllDeviceSessions(`），豁免要进登记表并**带上该文件的期望 bump 数**（现量只有 `auth.ts`：2 处，
计数一漂就红）；② `revokeAllSessions(` 只许住在助手里 —— 钉的就是"两半不许分开写"；
③ 射程为空 ⇒ 退 2 报探针。实测：真实树 `SUMMARY 文件=116 bump=6 豁免命中=1 违规=0`；
`--self-test` 全臂 OK（`ARMS` 由它自己打印，本文不抄数）；接线判据也做了负向 ——
`--pkg` 注入一份"链里去掉这一道"的 package.json ⇒ `rc=1` 且理由是
「定义还在，但不在这次的 check 链里」。⚠️ 这一趟第一次读数是 `rc=0`，因为命令尾巴接了 `| tail`
（管道吃掉退出码，traps **#45** 的第五次撞上）—— 改成 `> file; echo $?` 才是 `1`。

🔴 三条**边界**，不包装成完成：
① 发起改密那一台的通道也会被关（与 `POST /api/replace-token` 逐字同形，理由是 socket 的 `clientId`
是自报的、放行"调用者自己那一枚"等于让被盗令牌自称调用者），**"它带新令牌重连一次成功"这一格未实测**
—— 要设备窗口或一份真客户端的实时重连读数。
② 门禁只认 `tokenVersion: { increment }` 这一种写形状。现量：`grep -rn token_version server/src` 数到的
裸 SQL 全是 SELECT / 比较，**没有一条 UPDATE**，所以今天的口径是闭合的；将来出现
`data: { tokenVersion: 5 }`（直接赋值）它看不见 —— 要加形状分析，记在这里而不是假装覆盖。
③ `passkey.ts` 的恢复、`auth.ts` 的 `replaceToken`、`sync.routes.ts` 的设备撤销这三条**关了通道但没删行**。
它们没有安全后果（通道关了、列表按版本过滤），只剩留存口径不一致（那几行要等
`credential-sweep` 按 `SESSION_ROW_RETENTION_MS = 365d` 收）。**本线不改**：改它们要动两条已交付线的判据，
收益只有留存。留作负责人可拍的一格。

**法务联动：这一格是条款把实现照出来的，不是"要不要改条款"**

`packages/legal/src/documents/privacy.ts` 那句话（中文 `:539`、英文 `:1133`）早就写着：
重置或修改口令、以及换绑生效的那一刻，"都会让**其他设备上的登录立即失效**"。
🔴 改前这句话是**半真**的：HTTP 那半边真（下一次请求 401），实时通道那半边不真
（那个页面还开着、还在收）。所以法务文案**一个字没改** —— 需要改的是实现，
而这一格给出一条可迁移的做法：**条款里的动词与范围词（"立即""所有设备""不会"）
应当被当作验收判据来读**，它们比读代码更容易照出"做了上半没做下半"。
本线此前那趟法务逐行核对（§5 第 12 条那批）对的是**工具目录 ↔ 条款表**，
没有把这类句子拿去对代码 —— 那类"封闭句式对账"已由 `check:legal-tools` 覆盖，
而这种"能力承诺对账"没有门禁，只能靠人拿条款去读实现（记在这里，不新开门禁：
一句话对应一条四件动作的不变量，形状分析写不出来）。

保留口径顺带一起对过：删行只把"已知死掉的行"从 365 天里提前拿走，
条款里"账号行连同名下的**登录会话**按外键级联删除"（中文 `:404`）与
"密钥包/撤销设备记录保留至注销"（中文 `:134`）两句都**没有因此变假**，
所以不动版本号、不动同意指纹。

**续跑配方（这一腿）**

```bash
pnpm --filter @heyta/sync-server build                       # 改了 server/src ⇒ dist 必须重打
bash scripts/mobile-e2e-up.sh                                # 槽端口 :3101 + 隔离库 heyta_account_w9
node research/tools/account-email-sessions-http-probe.mjs     # 到 38 条；34/35 是这一节的承重读数
node scripts/check-session-revocation.mjs && node scripts/check-session-revocation.mjs --self-test
```

### 6.14 改登录密码那三块的**真浏览器**腿（判据已写进套件，端口被别人那一趟占着）

`PasswordPanel` 此前只有 jsdom 那份（`apps/web/tests/password-panel.spec.tsx`），AGENTS §6.2 规定一
要的是"任何'界面能用'的结论只有截图算"，所以把三条腿并进本线已有的那一份 Playwright 套件
`e2e/tests/account-email-change-and-sessions.spec.ts`（同一台假状态机，改一处路由形状）：

| 用例 | 判据 | 为什么只有真浏览器看得见 |
|---|---|---|
| 改密成功 | 🔴「其它设备上的登录都会失效」那一句必须在**点之前**就在界面上（存在性判据）；成功后 `password-changed` 出现、**两个框都被清空**、假服务端那侧口令真的换掉 | 清空草稿是"旧口令不留在框里"这条隐私行为；jsdom 只断 store |
| 同上，跨面板 | 改密之后「登录设备」那一节**自己**只剩这台：新的那一行出现，另外两行消失 | 🔴 这条是本节最值钱的发现，见下面那段 |
| 当前口令打错 | 只出 `password-failed`、`password-changed` 必须**零个**、焦点落回**当前密码**框、假库里口令没被换、设备列表一格没少 | `toBeFocused()` 在 jsdom 里是假的（焦点环与 RNW 吞键那类同族，#80） |
| 反证（路由 500） | 读失败不许画成"已修改" | 与换绑状态区那条同形（§6.4） |

🟢 **顺带查实的一条设计事实**（本来准备改代码，读源码后否证）：`SessionsPanel` 的取数键是
`useEffect(…, [active, baseUrl, token, signedIn, load])` —— 而改密成功的**定义**就是换发一枚新令牌
（J13 那一半），所以 `token` 一变，设备列表**自动**重拉。也就是说"改完密码后列表还列着已被踢下线的设备"
这个形状在代码里不成立；这条判据因此从"要修的缺陷"变成"要钉的既有不变量"（上面第二行）。
📌 一般规律：**面板之间的一致性要拿"它们的取数键是不是同一个事实"来判**，不是拿"有没有人写刷新按钮"。

⚠️ **13:42 当时这一趟没跑成**：`e2e/playwright.config.ts` 把 4318/4319 写死且
`reuseExistingServer: false`，起跑时 4319 已被占（`node stub-provider.mjs`，pid 73160，
从 12:09 起在册、4318 上还有 ESTABLISHED 连接 ⇒ 另一会话的 e2e 正在用）。
**不抢那条链、不动别人的进程**（AGENTS §8 第 9 条 / 只对自己创建的对象动手）。
⇒ 当时这三条用例的状态是**已写好、未取数**。
🟢 **这一格已在 §6.15 闭合**（13:47–13:57，走仓库现成的并行载体 4418/4419），
上面那句"未取数"不再是现状；跑法两条都写在 §6.15 第 1 条。

🟡 **登记一条措辞缺陷（不改，等词条表那一笔放行）**：改密那张表上 `invalid_credentials` 渲染的是
共享词表的 `common.auth.error.invalidCredentials` ⇒ 用户看到的是
**「登录失败：邮箱或密码不正确。」**，而这里它指的是"当前密码打错了"，人不在登录。
面板其实已经知道这件事（`failureOutcome` 的注释写着"在改密这张表上指当前密码"，并把焦点落回那个框），
只是句子没有跟着分叉。没有现成 key 可复用（现量：`grep -n 当前密码 packages/i18n/src/locales/zh-CN.ts`
只命中字段标签与移动页那两句）。**为什么本线不顺手加**：新增一句要中英同步，而这两枚词条文件
正在别人的 **staged** 集合里（§6.12）——现在加 = 把混合面扩大一格。留待随同一笔落，
或负责人先拍那句要不要与登录句分开（`错误措辞零新增/走共享层` 是既有立场，改它属于口径决定）。

🟢 **跑之前先把这组判据的四个前置读了一遍源码**（免得那一趟只得到一个"探针没对上"的红）：
`password-current` / `password-new` 的 `data-testid` 落在 **`<input>` 本身**
（`PasswordPanel.tsx:185-191`，同一个元素上还带着 `ref={props.inputRef}` ⇒
`toHaveValue('')` 与 `toBeFocused()` 都是可判的），`session-row-<sessionId>` 在
`SessionsPanel.tsx:220`，而"失败后不清空、只有成功那一条重置输入"是
`PasswordPanel.tsx:194` 那句既有注释（ADR-0040 §3.7）—— 本节的成功清空判据与它同向，不是另造一套口径。
13:42 现量：4319 仍由 `node stub-provider.mjs` 占着（pid 73160，12:09 起）。

### 6.15 那三条的**真浏览器**读数（并行载体 4418/4419）+ 两臂变异各自转红

#### 1 载体：为什么换端口，以及换之前核对过什么

4318/4319 在 13:47 仍被**活着**的两套 Playwright 占着（`ps` 现量：pid 73099 =
`@playwright/test/cli.js test`（父 73047，12:09 起），pid 53398 那棵还挂着
`chrome-headless-shell` + ffmpeg）⇒ **不是残留，不能清**（只对自己创建的对象动手）。
于是走仓库为这件事**已经准备好**的那份并行载体 `e2e/playwright.parallel.config.ts`
（4418/4419；它自己的文件头写着"同一台 vite dev、同一份 `stub-provider.mjs`、
同一套判据文本 —— 换的是载体，不是尺子"）。

换载体前核过它的射程限制（那份配置明写：碰假端点的用例不许用它）：

- 本 spec 的账号面 HTTP **全部**走 `page.route`，假 origin 是
  `http://account-suite.e2e.test`（`:31`），不是 4319；
- 从 `helpers.ts` 只借了导航件（`openApp` / `openSettingsSheet` /
  `selectSettingsSection` / `closeSettingsSheet`）与两个夹具件
  `stubLegalRecheck` / `stubPublicFacts`，而后者在本 spec 里**显式传了 `SERVER`**
  （`:216-217`），没有走那个写死 4319 的默认值；
- `resetStub` / `stubLog` / `expectStubCount` / `configureEndpoint` 一条都没用。

🔴 产物隔离：并行配置继承了主配置的 `outputDir`，而 Playwright 起跑会**重建**它 ——
不指出去就会删掉别的套件**还没被人看过**的 `test-results/`（`playwright.password-web.config.ts`
文件头记过同一条理由）。所以两条命令都带 `--output=/tmp/…`：

```bash
# 规范端口被占时（本次用的这条）
cd e2e && npx playwright test -c playwright.parallel.config.ts \
  tests/account-email-change-and-sessions.spec.ts --output=/tmp/heyta-account-suite-results
# 4318/4319 空出来时仍然是原来那条
cd e2e && npx playwright test tests/account-email-change-and-sessions.spec.ts
```

截图照旧落 `apps/web/evidence/account-suite/08..11-*.png`（受版本控制，不是 `test-results/`）。

#### 2 读数：四趟

| 时刻 | 结果 | 说明 |
|---|---|---|
| 13:47 | `RC=1`：1 failed / 6 passed | 探针缺陷 ①（见下） |
| 13:49 | `RC=1`：1 failed / 6 passed | 探针缺陷 ②（见下） |
| 13:51 | **`RC=0` / 7 passed (18.2s)** | 两处都修完之后 |
| 13:56:5x | **`RC=0` / 7 passed (18.1s)** | 两臂变异还原后重跑，把被变异覆盖掉的 08/09 换回干净态（新图 mtime 13:56:53 / 13:56:54） |

#### 3 两处坏的都是**我自己的探针**，判据一条没有放宽

- **①** `panel.getByText('登录密码')` 在严格模式下命中两个节点：面板标题 `<h2>` 与
  那颗「从来没设过登录密码？在这里设一个。」按钮（文本含住"登录密码"）。
  改成 `getByRole('heading', { name, exact: true })`。
  📌 顺按 §6.2 规定一第 1 条把 08 那张图**挪到断言之前**落盘 —— 原来它挂在两条断言后面，
  第一趟失败时**一张图都没有**，正是那条规定要防的形状。
- **②** 改密成功后多出一次 `GET /api/automation/recipient-key` 404。读源码定性：
  收件密钥是**按令牌**取的（`packages/app-host/src/inbound-recipient-remote.ts:35`），
  而"改密成功"的定义就是换发新令牌 ⇒ **真行为、不是缺陷**，只是不属于账号面。
  只在这一条用例里把它作为"已登记的无关路由"传给 `assertNoProblems`，
  **没有**塞进全局 `KNOWN_MISSING`（那会替所有用例消掉这一格，别处出现就看不见了）。

#### 4 两臂变异（都从 `PasswordPanel.tsx.mut-bak` 还原，`cmp -s` 验过，`grep -c "MUT "` 现为 0）

| 臂 | 改什么 | 读数 | 红在哪一条 |
|---|---|---|---|
| MUT A | 删掉 `password-consequence` 那一段（后果句） | `MUTA_RC=1`（18.3s，两次尝试同一点） | 🔴 正是"点之前就得看得见"那条**存在性**判据：`waiting for …getByText('其它设备上的登录都会失效…')` ⇒ element(s) not found |
| MUT B | 注释掉成功分支里的 `setCurrent('')` / `setNext('')` | `MUTB_RC=1` | `toHaveValue('')` 在 `password-current` 上 `unexpected value "the-old-one"`（合成夹具值，不是真凭据） |

📌 MUT A 是这两臂里值钱的那条：它红在**点之前**，也就是说这一格真的在盯
"界面有没有替用户把后果说出来"，而不是"点完有没有东西出现"。

#### 5 四张图人都打开看过（§6.2 规定一第 4 条）

08 面板打开态（两个框空、后果句在按钮之下）／09 已修改（`登录密码已修改。` 在最底、
两个框仍空）／10 当前密码打错（只出 `登录失败：邮箱或密码不正确。`、**没有**"已修改"、
草稿保留）／11 路由 500（`服务端暂时不可用，请稍后重试。`、**没有**"已修改"）。

- **看图查出、读源码否证的一条**：08/09 里那句「重置链接会发到 light-user@example.test。」
  坐在改密这张表上，看着像多出来的东西。`PasswordPanel.tsx:539-547` 写明它是给
  「忘记密码?」那颗按钮**交代去处**的（按钮不知道账号有没有口令，服务端也不许界面猜），
  且 `email === undefined` 时整段不渲染。**不是缺陷，不改。**
- 🟡 §6.14 登记的那条措辞缺陷在**图 10 里看得见**：用户没在登录，界面却说
  「登录失败：邮箱或密码不正确。」。这条仍留给负责人拍（新增一句要中英同步，
  而两枚词条文件在别人 staged 集合里）。

#### 6 ⚠️ 一条共享检出的险情（写给后来者，不是写给本线的成绩）

变异窗口里 `apps/web/src/features/settings/` **整片正被另一会话重写**（现量：
`AiSettings / CloseAccountPanel / ExportPanel / HelpPanel / ImportPanel / MemoryPanel /
PasskeyPanel / PasswordPanel / PrivacyPanel / ProfileOverview` 全是 ` M`，
`PasswordPanel.tsx` 里多出 `SettingsAccountGate` 与 `ht-settings__field` 两处）。
我的 `.mut-bak` 恰好是在他们落盘**之后**取的（13:53:1x），所以两次 `cp` 还原把他们的
在飞改动**原样放回去了**（现量 `git diff -- PasswordPanel.tsx` 只剩他们那 7+/5−，
我的 MUT 注释 0 处）。

**这是运气，不是流程。** 对**别人正在写的文件**做变异，要先按 §8 第 9 条要独占窗口，
或者把变异挪到隔离副本里做 —— 否则一次 `cp` 还原就能吃掉别人一段没提交的工作。
上面 13:51 与 13:56:5x 两趟分别落在那次落盘的两侧（都是 7/7），
所以这一格不拿"含别人在飞改动"的那趟冒充"只含本线改动"。

#### 7 随这一格取的三道静态门读数（13:59）与**一条跨线红**

| 门 | rc | 读数 |
|---|---|---|
| `check:md-tables` | 0 | 12 个文件、四类一致都过 ⇒ §6.15 新加的那张两栏表形状没问题 |
| `check:journey-coverage` | 0 | "每一端要么有旅程验收、要么有显式登记的缺口"，且它自己抽查了 web 旅程能跑 |
| `check:docs` | **1** | 🔴 一处死链，**不在本线**：`apps/desktop-windows/README.md:89` → `scripts/windows/launch-data-transfer-qa.ps1`（本机存在、`git status` 是 `??`、`git log` 零条 ⇒ 从没入库）。那枚 README 自己是 `M `（别人 staged），`.ps1` 没被忽略（`check-ignore` rc=1）⇒ 归数据迁移/Windows 那条线，三条出路里该走哪一条由他们拍（**不代改**：这是别人资产的对外说明）。本线文档零命中。 |

### 6.16 iOS 设备腿：换绑整条链在真模拟器上跑通了，而它后半那五发红**全是探针自己的**（17:0x–17:5x，第 11 趟）

第 10 趟是 `通过 24 / 失败 4`，第 11 趟是 **`通过 73 / 失败 6`**。差别不在产品，在这把尺子被修了六处。
装置：`scripts/verify-mobile-ios-account-email-sessions.sh`（16 步、判据 A–O、退出码 0/1/3），
入口已入库成 `pnpm verify:mobile-ios-account-email`（Android 侧那份是 `verify:mobile-account-email`）。
取证目录 `apps/mobile/evidence/account-suite-ios/`，**每张都人打开看过**（下面逐张写它证的是哪一格）。

**先说结论里最硬的一条**：步骤 1–9 **全绿** —— 全新账号 → 设备上用邮箱+密码登录 → 设置面里
「更换登录邮箱」区块在、当前邮箱那行就是登录邮箱 → 填新地址发起 → 界面成功文案是
「两封信已经发出」**而不是**「已更换」 → 等待态那三句来自服务端那一次读 → 两封信各自从
Ethereal 预览取回链接 → 只点旧那半、切走再回来读到「等新邮箱那一边」（**这一格只有真设备能证**）
→ 点新那半：库里地址改了、活请求没留下、换绑前那枚令牌全局 401、本机明文库还在盘上。

#### 五处探针错（每条都写"症状长得像产品坏了"的那一面）

1. **iOS AutoFill「保存密码？」系统弹窗**：它**不在 App 的可及树里**，结构指纹是整棵树塌成
   一枚 `AXLabel`。`fresh_dump` 现在按"可及名枚数 ≤ 2"当场摘掉再重取（摘法照兄弟 rig 的四条实测：
   不许拿页面标题当"没有弹窗"的证据、坐标按当前 app frame 推、它是**延迟**弹出来的）。
   不修它的后果：登录其实已经成功（截图里设置面就在弹窗后面），脚本读到"0 条含「设置」的可及名"。
   人看图：`02-sign-in.png` 就是那张弹窗压在设置面上。
2. **到站判据写错**：原来用「立即同步」当"站到「我的」根层"的证据 —— 那句话跟着另一条会话的
   重构**搬进设置面**了（`ProfileScreen.tsx:1066` 的 `syncStatus` 现在作为 prop 在 `:1383` 交过去），
   根层永远读不到。改成读那行的分组副标题「个人资料、偏好、同步与安全」，并把"到站"升成
   **硬前置**：没站到根层就直接判红，不许拿"某句话不见了"当终态断言（那是一条**假绿**，
   它会在根本没到站的时候判"界面没显示旧邮箱 = 换绑生效了"）。
3. 🔴 **收键盘这个动作本身就是一次提交**（这一条把第 4 步的红解释了整整两趟）：
   `ios-ax-shim.py:709-752` 的 `--dismiss-keyboard` 是按**键盘右下角那枚 return 键**收的
   （return 的标签随输入法语言变，所以按 KeyboardKey trait 结构匹配），而那颗输入框写着
   `onSubmitEditing={() => void submit()}`（`EmailChangeSection.tsx:281`）⇒ 填完收键盘 = 已发起。
   于是"先收键盘、再去找那颗还没被按过的按钮"是一条**恒红**判据。
   证据不是截图看起来像：`select count(*) from email_change_requests … = 1`，而脚本一次按钮都没按；
   截图里那颗主按钮是 spinner（`kit.tsx:785` 只有 `loading` 为真才画它）。
   改法：收键盘 → 轮询"在途/已出结果/按钮可按"三态 → **只有它没提交才去按**，并把触发路径打进输出。
   ⚠️ 不许"没找到按钮就补按一次"：再按一次撞冷却，会把一条好判据换成一句假失败。
   顺带把这条风险钉住：步骤 5 现在**先数活请求枚数**（恰好 1）再看形状，多提交伪装不成"形状对"。
4. **`row_candidates` 的两个不对称**（步骤 11 数出 0 枚可撤、步骤 12 说"1 条可及名但没一枚可点"）：
   ① 它把可及名**规范化之后**交出去，而下游 shim 的 `find()` 是按**原文**比 `AXLabel`
   （`label_of` 不做任何归一化）⇒ 词条里的全角「：」被换成半角，节点再也找不回来；
   ② 它认得的"复合可及名"只有逗号那一档，而本 App 自己的 aria 模板用的是全角冒号
   （`mobile.sessions.revoke.aria` = 「退出这一台：{device}」）⇒ 那两行**根本不在枚举结果里**。
   症状与"按钮点不动/产品坏了"完全一样，而界面上那两行在同一趟的文本转写里就列着。
   两处都修了，并留下**不用设备就能跑**的判据（合成树五条：枚数、交出去的是原文、
   needle 出现在别人名字中间不算命中、逗号那一档没被改坏、整棵树没有可撤行 ⇒ 0 枚），
   外加一条直接喂 shim `find()` 的对照：原文命中 / 规范化串不命中。
   枚数那一档还顺手收紧成只数 `^退出这一台：` 的形状 —— 那颗按钮的可见文字本身也叫
   「退出这一台」，它一旦被单独暴露成一枚节点，枚数就会虚增，而这条判据要的恰恰是枚数。
5. **步骤 13 在根层读「未配置」那句**：与第 2 条同源（那句话住在搬进设置面的 `syncStatus` 里），
   所以"退出所有设备没清本机凭据"这句是**探针读不到**，不是产品没清。改成开设置面 → 根层找 →
   找不到再进「同步与隐私」找，并且 🔴 **不**按「使用自托管服务器」（那一步会把凭据填回去，
   把"清没清"变成"我自己弄脏了"）。同趟的库里读数支持这个方向：`access_sessions` 0 枚、
   对照那枚 401、界面出现「所有设备都已退出,包括这台。请重新登录。」。

**第六处是判据自己的缺口**：主蓝那一半（AGENTS §7 第 82 条）在**表单页**上恒红 ——
草稿为空时那颗主按钮是 `disabled`，`kit.tsx:776` 用 token 的 `state.disabled-opacity`（现值 0.38）
表达禁用 ⇒ 屏上是「主蓝 over 卡片底」的**混合色**，`countBrandBlue` 对两张真界面实测命中 **0**
（`03-email-change-section.png` / `04-no-submit.png`）。没有删判据、没有放宽容差，改成**双目标**：
启用态主蓝 **或** 按 `tokens.css` **现算**的禁用态混合色（两个都是从 token 读的，脚本里没有第二个字面量）。
下限另立并写清依据：真界面（整颗按钮）命中 8618 / 8809，按钮处于启用态的那张只剩 45 / 34
⇒ `BLUE_DISABLED_MIN=1000` 要的是"数得出**一整颗**按钮"。两枚阴性对照跑过：纯灰屏 `0/0`、
一整块**错误的蓝** `#3b82f6` 也 `0/0`（就是 §3.9.2 点过的那个值）⇒ 这条闸不是被放宽，是被补全。

#### 这一趟照出来的一条真产品缺陷：换绑成功之后，界面还说旧地址

步骤 10 的红**不是**探针错（前五条都是）。库里 `users.email` 已经是新地址、活请求已删、
旧令牌全局失效，而「当前邮箱」那一行仍显示旧地址 —— 因为它读的是 `signedInEmail`，
而那个值**唯一的写入点是登录那一次**（`apps/mobile/src/auth/session.ts:87`）。
换绑是在**邮件里的两条链接**上生效的，这台设备不会被通知第二次 ⇒ 它没有第二条路知道。
它同时喂着「我的」页六处"当前账号"（头像字母、邮箱行、昵称副标题、账号区两行、`ProfileScreen.tsx:1239/1249/1265/1267/1270/1283`）
⇒ 这是一类，不是一个。

修法按"服务端是唯一裁决者"走，新增一个字段而不是新增一个端点：

| 层 | 改了什么 | 为什么在这层 |
|---|---|---|
| `server/src/account/email-change.ts` | `getEmailChangeStatus` 的响应带 `currentEmail`，**`pending: false` 那一支也带** | 生效之后活请求就没了，那一发恰恰最需要真地址；界面本来就读这个端点，不必多一次请求 |
| `packages/shared-schema` | `EmailChangeStatusResponse.currentEmail?`（可选、纯增量、不 bump schema） | 线协议向前兼容的既有口径 |
| `packages/app-host` | 解析器点名这个键 | 🔴 它是**白名单**解析器，不点名就**静默丢掉** —— 症状正是"响应里有、界面还是旧的" |
| `apps/mobile/src/auth/session.ts` | `setSignedInEmailFromServer()`：契约写死"只接受服务端事实" | 空串不许变成一个能显示的空值 |
| `EmailChangeSection.tsx` | 那一行走 `status?.currentEmail ?? currentEmail`，并把读到的真值写回会话 | 父层那一个是回落，不是权威 |

判据与能红的证明（四臂变异，每臂三段哈希守卫、只从 `.mut-bak` 还原、还原后逐字相同）：

| 臂 | 变异 | 读数 |
|---|---|---|
| A1 | 共享层解析器不点名 `currentEmail` | `2 failed / 47 passed` |
| A2 | 把它和 `pending` 一起门控（"只在有活请求时带"） | `1 failed` —— 红在"生效之后那一支"，正是最该失效的那一格 |
| A3a | 服务端 `pending: false` 那一支不带回 | `2 failed` |
| A3b | 服务端 `pending: true` 那一支不带回 | `1 failed` |
| A4 | 界面退回只信父层 prop | `1 failed`（移动端接线判据） |

配套单测：server `email-change.spec.ts` **36 passed**（新增 4 条）、
app-host `account-security.spec.ts` **49 passed**（新增 3 条）、
mobile `auth-flow.spec.ts` **17 passed**（新增 3 条：覆盖旧值 / 空串回到 `undefined` / **不碰凭据**）+
`account-security-wiring.spec.ts` 新增 4 条接线判据（含"`signedInEmail` 全仓只有 4 处赋值、
其中 2 处是登出与注销的忘掉"）。`shared-schema` / `app-host` / `server` / `mobile` 四份 typecheck 全 0
（🔴 mobile 那一份**必须**先 `pnpm --filter @heyta/shared-schema --filter @heyta/app-host build`
才过 —— 它读的是包里的 `.d.ts`，这是 §7 第 27 条那一族在类型层的现形）。

**web 侧同一件事没在这一批做，是有意留的**：那一侧的邮箱行住在
`apps/web/src/features/settings/ProfilePanel.tsx` + `useAccountIdentity.ts`，两枚都是
**另一条会话正在写**的（`M ` / 由 `6d868af0` 那批带来）。`status.currentEmail` 已经在契约里，
那一侧接过去即可 ⇒ 交接给产品体验线，本线不代改别人的在飞文件。

#### 仍然不闭合的那一格（不包装）

步骤 14「退出所有设备之后重新登录并同步成」仍然红，形状与前几趟**一模一样**：
三件凭据都填进去了（口令那一格掩码码点 18 = 原文 18，secure 走的是 HID 键盘输入那条唯一有效路），
界面却停在「还没设置端到端加密口令,同步已停止」⇒ 同步被**客户端**闸住，`立即同步` 那颗按钮根本没出现。
不是本线：同一份产物上跑兄弟 rig `verify:mobile-ios` 也拿不到那一格（`SIB_RC=1`），
而 AGENTS §6.1 现在写着它"36 项零 mock 全绿" ⇒ **这句对外声称当前是红的**，归多端覆盖那条线
（本线不改别人的判据，也不为了让自己的套件绿去动它）。
⚠️ 那一趟附带一条必须说清的事实：兄弟 rig 自己会重装，它装的是 16:24 那次构建，
**取自另一条会话在飞的源码** ⇒ 它的红既不能记成本线的产品失败，也不能记成"环境无关"。

**步骤 10–15 的下一趟必须先重建安装**：本批改了 `EmailChangeSection.tsx` 与 `session.ts`，
装置步骤 0 那条"本线源码都不比 bundle 新"的新鲜度判据现在会**响亮地 exit 3** ——
那是它应有的行为（§6.1.1：测试绿 ≠ 装的是当前产物），不要绕。重建走 `pnpm reinstall:mobile`，
而它按 §7 那条不变量要求"工作树里没有任何别人未提交的源码"，目前不成立 ⇒
顺序是：UI 挂载那一笔落地 → 重建 → 第 12 趟取 10–15 的读数。

### 6.17 与本批直接相关的五道门禁：三道 0、两道 1，而那两道**都在 HEAD 里、都不在本线**（17:5x 现量）

跑的是"改到什么就验什么"那一组，不是整条 `pnpm check`（76 步链在共享载体上的那一档仍按
`FULLCHECK-01` 记环境无效）：

| 门 | rc | 读数 |
|---|---|---|
| `check:session-revocation` | 0 | 6 处 `tokenVersion` 抬法都关得到实时通道（117 文件、豁免 1 枚且计数逐字相符）—— §6.13 那枚新门禁 |
| `check:adr-numbering` | 0 | 63 枚 ADR、2184 处裸引用，同号 0 / 歧义 0 / 悬空 0 ⇒ ADR-0063 那节补写没造出第二枚同号 |
| `check:md-tables` | 0 | §6.16 新加的两张三栏表形状没问题 |
| `check:layering` | **1** | 🔴 仓库级：`apps/web/src/features/share/share-key-store.ts:56` 在外壳里就地拼 op（`entityType: 'SHARE_KEY'`）。**这一行在 HEAD 里**（`git show HEAD:…` 逐字命中），那枚文件工作树**干净** ⇒ 不是别人在飞的东西，是已经落地的违规。归 share 那条线：正确做法是给 `SHARE_KEY` 在 `app-host` 加动作层，那是**产品语义**，本线不代定 |
| `check:ui-language` | **1** | 🔴 仓库级：`packages/i18n/src/locales/en.ts:4404` 的 `"Don't ask again"` 用了**双引号**，而那道门的解析器只认单引号 ⇒ 候选 3863 行、解析出 3862 条，它按"漏一行就是假绿"直接失败。同一键的中文侧是 `'不再提示'`（单引号，形状没问题）。修法是一处引号类别的改写、**运行时字符串逐字不变**：`'Don\'t ask again'` |

两道红都**不在本批引入的东西上**（本批那三枚新测试与四处源码改动过的门是上面三个 rc=0）。
`ui-language` 这一条本线**能**一行改掉（一子可换、运行时值逐字相同、一条命令可回退），
没有动手的理由是具体的：`packages/i18n/src/locales/en.ts` 与 `zh-CN.ts` 此刻都是 ` M`
（另一条会话的算法备案词条未提交），往一枚脏的共享词条文件里写一行，等于替别人把那一整份
带进本线的一笔 ⇒ 登记 + 把补丁原文留在上面，由那条线落地。
`layering` 那一条不是"顺手整理"：它要的 `SHARE_KEY` 动作层是别人那个实体的产品语义。

### 6.18 这一轮之后还开着的格（逐条写"谁能关"与现量命令，不写成"基本完成"）

| 格 | 现状 | 谁能关 / 现量 |
|---|---|---|
| iOS 步骤 10–15 的**设备**复跑 | 判据与产品修都已入库（`64425db6` / `117ced83`），装置步骤 0 的新鲜度闸现在会 exit 3 | 重建安装之后由本线跑：`pnpm reinstall:mobile` ⇒ 再 `pnpm verify:mobile-ios-account-email`。前置不变量是"工作树里没有任何别人未提交的源码"，**每轮重测**：`git status --porcelain -- apps packages server \| grep -cE '^ ?M'` |
| 换绑之后界面显示旧地址的 **web 那一半** | 契约里 `currentEmail` 已备好，服务端与共享层两侧都有判据 | 产品体验线：那一行住在他们正在写的 `ProfilePanel.tsx` + `useAccountIdentity.ts`（两枚都 `M`）。接法：读 `status.currentEmail`，别再用登录那一刻的快照 |
| Android 侧「改密会让其它设备失效」那一句 | `verify-mobile-account.sh` 有改密那一发（真点提交 + 轮询成功文案），但**没有**这一句 | 本线可写，但**写不了读数**：`adb devices` 当前为空，而 AGENTS §6.1（产品负责人 10-04 拍板）明令不要再在这台 Mac 上起模拟器 ⇒ 要么给一台已连着的设备，要么由 Windows 侧设备窗口承接。在此之前它是**已登记的缺口**，不是"验过" |
| 步骤 14 那一格（E2EE 口令进不了应用状态） | 三件凭据都填进去了、掩码码点对得上，界面仍停在「还没设置端到端加密口令,同步已停止」 | 不在本线：同一份产物上兄弟 rig `verify:mobile-ios` 也拿不到（`SIB_RC=1`）。归多端覆盖那条线；顺带一条更正 —— AGENTS §6.1 写着它"36 项零 mock 全绿"，当前实测是红的 |
| `check:layering` / `check:ui-language` 两道仓库级红 | 都在 HEAD、都属 share 那条线（逐条见 §6.17） | share 那条线：`SHARE_KEY` 动作层进 `app-host`；英文词条那一行换回单引号（运行时值逐字不变）。本线不代改：前者是别人的产品语义，后者落在一枚**脏的**共享词条文件上 |
| UI 挂载那一笔（web 三块面板 + `account-security-wiring.spec.ts`） | 三枚面板与 `SettingsAccountGate.tsx` 都还是 `??`，而 `App.tsx` / `main.tsx` 是别人在写的 `M` | 🔴 **这一格原先那句"移动端挂载早就在 HEAD 里"是错的**（那条命令当时是对着脏树跑的）；更正见 §6.27，移动端那两行已落到 `76944386`，`SessionsSection` 为什么没跟着挂、以及它的闭合判据在 §6.28。剩下的只有 web 这一半：等 `App.tsx` / `main.tsx` 落地后一次提交（⚠️ **09 23:3x 更正**：这一半不等他们 —— 面板与挂载落进 `3dd210bd`、判据与真浏览器图落进 `23a3a24b`，而且挂载落点是 `App.tsx` 与 `ProfilePanel.tsx` 两处，`main.tsx` 从来不是那两块的宿主。读数与三条边界在 §6.41） |
| 全量 `pnpm check` 与 `pnpm reinstall:all` | 都没在最终载体上跑过 | 环境前提同 `FULLCHECK-01` 那一档：负载短窗/长窗比值正常、工作树没有别人未提交的源码、e2e 那三段不与别人的 dev server 抢端口 |
| 帮助页控件名门禁的**射程外**那 16 处 | `check:site-control-names` 只查本线那几页；整站普查另有 16 处引号名对不上真源（逐条现量命令见 §6.19） | 各页面所属线：多数要先把"文档站导航标题"接成第二个分母（那些标题住 `pages.ts`，不在词条表），否则一并钉会造出一屏假红 |
| `check:entries` 那 32 格生成物滞后 | **HEAD 自己就红**，与本线无关（纯 HEAD 对照臂读数与一格实例见 §6.20） | landing 那条线在他们那笔里连源码一起重生成；本线不代提交产物 |
| 法务文本里两颗"界面上不存在的按钮" | `permissions.ts:84`（zh）与 `:257`（en）写「开启提醒通知」/`turn on reminder notifications`，真值是区块「提醒通知」里的按钮「开启通知」；`personal-info-list.ts` 那行写「退出这一台设备」——它**不在 HEAD**，在另一条会话的未提交 diff 里（逐条与真值见 §6.22） | 提醒那条线 + 写那份清单的那条线。本线不代改：改的是别人的对外合规措辞；且现量否证了两条能把尺伸进去的规则，扩射程会造出一屏假红 |

### 6.19 帮助页让用户去点的那颗按钮，界面里**不叫那个名字** —— 8 处现量，并把它钉成门禁（10:2x）

goal 那条"帮助中心同步更新"落完之后回头核：帮助页与文档页教用户"点 X"，而 X 是**抄进说明文里的**第二份文案。
AGENTS §5 那条"零硬编码文案"只管代码，管不到散文 —— 界面改了、说明没跟着改，**两层都不会失败**，
用户照说明找不到按钮，读出来的是"这功能没做"。

🔴 **第一版普查是假绿的，而且假得很有代表性**：我把现成装置 `check-locator-labels.py` 里的
`template_matches`（"这条标签是带占位符的词条渲染出来的"那一档）拿去对 **en 表**，结果
`site.*` 里 73 段引号名**全部命中**，一处不缺。真原因是那张表里有 6 枚词条整条值就是一个占位符
（`web.search.count` = `'{count}'`、`common.date.yearTitle` = `'{year}'`、`mobile.recurrence.yearDay.n` = `'{n}'` …），
`entry_to_pattern` 给它们拼出 `^.+$` ⇒ **任何字符串都算"合法渲染结果"**。这个洞不会报错，
只会让每一处调用无声地放行一切，而那正是这道检查唯一在回答的问题。
修在**共享函数本身**（`entry_to_pattern` 对"光占位符"的词条返回 `None`，`template_matches` 跳过它），
不在调用方打补丁；`check:locator-labels` 一并受益 —— 它此前只喂 zh 表（zh 没有这种词条），
所以还没被咬到，那是运气不是设计。取现量：

```sh
python3 - <<'PY'   # 哪些词条会把通配变成"永远通过"
import importlib.util
s=importlib.util.spec_from_file_location('c','scripts/qa/check-locator-labels.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
for name,t in (('zh',m.ZH_TABLE),('en',m.EN_TABLE)):
    print(name,[k for k,v in t.items() if '{' in v and m.entry_to_pattern(v) is None])
PY
```

修完探针的真读数：**新门禁 `check:site-control-names` 在真表上报 8 处红**（射程 = 本线那几页：
账号 / 口令 / 通行密钥 / 会话 / 找回；69 枚 `site.*` 键，抽出 12 段引号名）：

| 帮助页写的 | 界面里真正渲染的 | 落在哪些键 |
|---|---|---|
| 「换绑邮箱」 | `common.emailChange.title` = 「更换登录邮箱」 | `site.help.a.rebind`、`site.docs.account.s6p1` |
| `"Change e-mail address"` | 同一枚 en 值 = `Change sign-in email` | 上面那两键的 en 侧 |
| 「忘记密码」 | `common.auth.form.forgotPassword` = 「忘记密码？」 | `site.docs.account.s2p1`（en 侧写 `"Forgot your password"`，真值 `Forgot password?`） |
| `"Sign this device out"` | `common.sessions.revoke` = `Sign out this device` | `site.help.a.sessions`、`site.docs.account.s7`、`s7i1` |
| `"passkey"` | 那两颗按钮叫 `Sign in with a passkey` / `Create an account with a passkey` | `site.help.a.passkey` —— 🔴 **zh 侧「通行密钥」是逐字存在的**，这一处只有英文错 |
| 「丢失了通行密钥？」 | `web.auth.recovery.request` = 「丢失了通行密钥？发一封找回链接」 | `site.docs.loss.s2p1`、`site.help.a.passkey`、`site.docs.account.s2i3` 及 en 三处 |

另有 **2 处是手查出来的、规则抓不到**，把边界写清免得后来者以为这把尺量到了整页：
`site.docs.account.s7i3` 的「设备名」既不是动词紧邻也不是加粗开头，而且它指的是一个**界面里就没有的列**
（`common.sessions.*` 里没有这一枚键，列表只有时间与浏览器标识）—— 已去掉引号；
`site.docs.account.s2i3` 那句中间隔着"应用里登录面板上的"，不满足相邻。

修复 = **16 处替换（zh 7 / en 9）**，每处先断言"在源文件里恰好命中 N 次"再替换
（`press "Change e-mail address" and type the new one.` 期望 2 次，其余各 1 次），全部一次到位；
改完射程内引号名全命中、`--self-test` 全绿 —— 臂数与分母（射程内键数 / 抽出的引号名段数 / 命中豁免条数）
都由门禁自己打印，本文件不抄（抄了就漂：这一句原先写的"12 段 / 六臂"在 §6.24 扩完射程后就成了旧数）。
阳性对照里含"用不上的豁免自己会红"与
"光占位符词条通配不了一切"两条。豁免表当前是**空的**：一张只进不出的豁免表会和它要挡的
漂移一起烂掉，所以门禁同时把"豁免没被用到"判成错。

整站普查另有 **16 处**引号名落在**别的线**的页面（重复任务 / 导出 / 迁移 / 视图 / 自托管 / 集成说明），
其中多数指的是文档站自己的导航标题，而那些标题住 `apps/landing/src/site/pages.ts`、**不在词条表里**
⇒ 要把它们一起钉住，必须先给这道门禁加第二个分母。**登记，不在本线替他们改**。现量命令：
把 `check-site-control-names.py` 里那两条抽取规则对全表跑（去掉 `in_scope` 那道闸）即可复现那 16 行。

### 6.20 HEAD 自己的 `check:entries` 就是红的：32 份生成物与 HEAD 源码对不上（10:3x 现量，归 landing 那条线）

为了证明"我这批不夹带别人的产物"，开了一枚**纯 HEAD 的对照 worktree**（无任何未提交改动）跑同一条生成命令：

```sh
git worktree add --detach .worktrees/ctrl HEAD
mkdir -p .worktrees/ctrl/node_modules/@heyta
ln -s "$PWD/packages/i18n" .worktrees/ctrl/node_modules/@heyta/i18n    # pages.ts 运行时 import `@heyta/i18n/provider`
cd .worktrees/ctrl && node apps/landing/scripts/gen-entries.mjs && git status --porcelain | grep -c ''
```

读数 = **32**。也就是说 HEAD 提交里的 `apps/landing/docs/**` **不等于** HEAD 源码的生成物，
`check:entries` 那道逐字节对账在 HEAD 上本来就红 —— 与本线无关，也与那枚工作树的脏改动无关。
举一格：`site.docs.account.sum` 在 HEAD 已是「注册账号，选择登录方式，管理访问凭据。」，
而 HEAD 的 `docs/account/index.html` 里 `<meta name="description">` / og / twitter / JSON-LD 四处还是旧那句。

🔴 **所以本线没有提交任何生成物**，理由不是省事，是现量出来的两件事：
① 那 16 处替换里只有 **2 处**（中英各一的 `site.help.a.passkey` 那一问）真的进生成物 —— 其余走客户端渲染；
② 而那两份文件（`docs/index.html`、`en/docs/index.html`）**本来就在那 32 格里**，
它们与主检出的脏版还差着 18 行 —— 那是 landing 那条线从**他们自己的在飞源码**生成的
（例如 JSON-LD 里多出的「怎么换绑登录邮箱？」一问，HEAD 的 `content.ts` 没有）。
⇒ 我把 HEAD 形状的那份提交进去，等于替他们决定产物长什么样；不提交则一行都不新增滞后。

`check:entries` 那 32 格的收口归 landing 那条线：他们那笔连源码一起重生成即可。谁能关 / 现量：
`node apps/landing/scripts/gen-entries.mjs --check` 在**纯 HEAD** 上就非零退出。
⚠️ 一条工具事实顺手记下：本机 `node` 有四枚（`.tfa-shield` / nvm 22.22 / fnm / `/usr/local`），
`gen-entries.mjs` 直接 `import` `.ts`，22.22 起 type stripping 默认开、能跑，但**隔离 worktree 必须
先补那一枚 `@heyta/i18n` 软链**，否则 `ERR_MODULE_NOT_FOUND` —— 它报的是"包找不到"，很容易被读成"生成器坏了"。

### 6.21 纯 HEAD 那棵树上还另有一格仓库级红：`check:tokens` 指着一条**没提交**的实现（10:3x 现量，归产品体验线）

同一枚对照 worktree（纯 HEAD、无人在飞改动）里顺手跑出的，与本线无关但必须登记，因为它决定
后来者"在干净检出上跑 `pnpm check`"会撞到哪一道：

| 门 | 纯 HEAD | 主检出（有未跟踪文件） | 归因 |
|---|---|---|---|
| `check:gate-wiring` | **1** | 0 | `check:tokens` 定义里有 `node scripts/gen-android-widget-colors.mjs --check`，而那枚文件是 `??`（`git status --porcelain -- scripts/gen-android-widget-colors.mjs`）⇒ **HEAD 的 `package.json` 指着一份没跟着提交实现**。这道门自己就是这么设计的（"链是文本级的，这种断点 merge-tree 看不见"），它抓到了真的 |
| `check:ui-language` | 1 | 1 | 同 §6.17 那条：解析器对 `en.ts` 里双引号词条直接拒绝继续 —— 两侧逐字同一条红，与本批无关 |

谁能关：产品体验线把那枚实现文件一起提交即可（`git add scripts/gen-android-widget-colors.mjs`）。
本线不代提交：它是别人那条线的门禁实现，不是本线交付物的一部分。
📌 同族：AGENTS §7 第 191 条讲的是"挂在文件名枚举上的门禁，目标文件不在树上时**安静地不执行**还照样打印通过"，
本条讲的是"同一道门在**只含已提交内容**的那棵树上第一次执行就红"。两边其实是同一件事的两面：
**判据的载体不在它声称检查的那棵树上**。合起来的教训是那句老话的第三种面目 ——
主检出上它是绿的，而它绿**只因为那枚未跟踪文件躺在磁盘上**。

**这两笔在共享检出上是怎么落地的**（`acb14b6d` / `ef15f795`，后来者撞同类局面时照这个做）：
词条与 traps 此刻都躺在别人的未提交改动里 ⇒ 不在主检出上改它们，而是在**纯 HEAD 的 detached worktree**
里做完整份改动，`git hash-object -w` 造 blob、`git update-index --cacheinfo` 只暂存我那几枚路径，
然后 `git commit` **不带 pathspec**（提交索引，不是工作树）。选高层 `git commit` 而不是
`commit-tree + update-ref` 的理由是 §7 第 88 条那两格收尾责任 —— 索引刷新与 `.git/hooks/post-commit`
它自己会做；代价是要在暂存前确认索引为空、暂存后确认待提交集合逐枚是我要的那些
（`git diff --cached --name-only`），本次两侧都验过。
提交完**再把工作树对齐**成「HEAD ∪ 他们那 30 行（en 侧 14 行）」，逐行做多重集对账：
HEAD 的行一行不许少、他们多出的行一行不许变。这一步不是洁癖 —— 工作树要是落后于 HEAD，
`check:site-control-names` 在别人眼里就是红的（它读的是工作树），而下一个人会去"修"我那笔已入库的改动。
🔴 这一格和 §6.17 那两道的**实质区别**：那两道红落在一枚脏的共享文件上、没有任何东西兜住回归；
这一格有 —— 万一后来者用旧的编辑器缓冲整份覆盖回去，新门禁当场红。
traps 第 396 条同理已补进工作树那份（他们那 40 行未提交条目逐行未动）。

### 6.22 同一类漂移在**法务文本**里还有两处（HEAD 里就有），以及两条被我现量否证的规则（别再试）

把 §6.19 那把尺往法务文本伸之前，先量了适用面 —— 结论是**不能伸**，但量本身照出两处真缺陷：

| 在哪 | 写的 | 界面里真是什么 | 归谁 |
|---|---|---|---|
| `packages/legal/src/documents/permissions.ts:84`（zh） | 设置里主动点「**开启提醒通知**」 | 区块叫「提醒通知」（`web.reminder.notify.title`），里面那颗按钮叫「**开启通知**」（`web.reminder.notify.request`）—— 法务文本把两个名字拼成了一个界面里不存在的 | 提醒那条线。⚠️ 这一句讲的是"**什么时候才向浏览器申请权限**"，属于对外合规承诺的措辞，不由本线代改 |
| 同文件 `:257`（en） | tap "**turn on reminder notifications**" | 真值 `Turn on notifications` | 同上，两语要一起改 |
| `packages/legal/src/documents/personal-info-list.ts` 的 B 表「登录会话」那一行（zh 写「退出这一台设备」/ en 写 `"sign this device out"`） | —— | 🔴 **这一行不在 HEAD 里**（`git show HEAD:… \| grep -c 退出这一台` = 0，而它在主检出是 `+` 行）⇒ 是**另一条会话正在写**的内容 | 写它的那条线：按钮真值「退出这一台」，弹窗标题「退出这一台设备？」（**带问号**，`mobile.sessions.revoke.title`）—— 用途栏引的那颗是按钮，不是弹窗 |

🔴 **两条候选规则被现量否证，写在这里是为了让后来者不重试**（都在纯 HEAD 的对照树上跑的）：

1. **"近似名"档**（引号里的名字若与某真值互为前缀/后缀/包含 ⇒ 判错），锚在本线那 6 枚控件名上：
   HEAD 上命中 3 段，**3 段全是假阳** —— 「通行密钥」本身就是真控件名（它被包含在
   「丢失了通行密钥？发一封找回链接」里），en 侧 `'device'` 是被引号括住的普通词。
   ⇒ 中文标签天然互相包含，containment 判不出"抄错的名字"。
2. **把动词表从 `点/按/走/用/进入/打开/在/见` 扩到 `让/使` 并伸进法务文档**：29 段引号名、14 段不在词条表 ——
   其中 **12 段是术语不是控件**（「完整状态边界」「我们不判断内容」「先披露、后上线」「要不要单独同意」…），
   只有 1 段（「开启提醒通知」）是真缺陷。
   ⇒ 法务散文里的 `「」` 主要用来标**术语与自造短语**，而帮助页里的 `「」` 才主要标**控件名**；
   同一个标点符号在两种文体里不是同一个东西，`check:site-control-names` 的射程就停在帮助页那一侧。
   复现（两臂各一条，改动词表或改 NAMED 清单就能重跑）：把 §6.19 末尾那段普查脚本的 `SCOPE` 去掉、
   再对 `packages/legal/src/**/*.ts` 的单引号字面量跑同两条 `finditer`。

顺手一条判据教训（与我这轮第一条同源）：**"这把尺在另一个载体上还成立吗"必须实测**，
不能从"它在这个载体上有效"外推 —— 外推的失败形状不是报错，而是一屏假红或一屏假绿。

### 6.23 法务那一族门禁的现状读数（10:5x 现量，四绿一红，而那红不在 HEAD）

本线动过对外文案，所以把与它相邻的五道门各跑一次，逐道给 rc 与归因：

| 门 | rc | 读数 |
|---|---|---|
| `check:legal-closure-truth` | 0 | 九份文档（含版本变更表两栏）没有被现实现否证的句子 |
| `check:legal-gdpr` | 0 | 主表 8 行 × 条文号 + 逐领域文档各带自己的那一条 |
| `check:legal-host` | 0 | 官方托管域名三方对账一致 |
| `check:legal-copy` | 0 | 站点的标题/摘要与 `@heyta/legal` 一致 —— 也说明 §6.22 那类**正文**改动不进这条对账（它只搬标题与摘要），所以改正文不需要重生成 |
| `check:legal-tools` | **1** | 🔴 目录 30 条里有 4 枚（`append_task_checklist` / `get_task_estimate_context` / `set_task_estimate` / `set_task_priorities`）没写进 `ai-and-transfer.ts` 的中英两张表（条款把那张表当**授权面**）。**归因是现量出来的**：这四枚在 `HEAD` 的目录源里出现 **0** 次（`git grep -c "<tool>" HEAD -- packages/local-api packages/app-host`），而 `ai-and-transfer.ts` 本身干净 ⇒ 它们是**别人未提交的新增**，这道门会在他们提交时把红挡住 —— **不记 HEAD 红，也不记本线红** |

⚠️ 记这条是为了挡住一种具体的误读：下一个跑 `pnpm check` 的人看到 `legal-tools` 红，很可能按 §6.17 的先例去找"哪条线在 HEAD 里漏了登记"。这一次不是那种情况，
判据是"那 4 个名字在 HEAD 里到底有没有"，一条命令就能分开。

### 6.24 同一类漂移在**服务端文案**里还有 6 条，以及我把别人的修法带回 HEAD 又改回来那一次（11:5x 现量）

§6.19 那条门（`check:site-control-names`：文案里让用户点的名字必须是词条真源里某个值）原本只扫 `site.*`，
而它只认直引号 `"…"`。把射程扩到 `server.*` 与弯引号 `“…”` 之后，**服务端信里同一类错全现形**：

| 位置 | 文案教用户点的名字 | 真源里那个名字 |
|---|---|---|
| `server.email.passwordChanged.notYou`（zh） | 「忘记密码」 | 「忘记密码？」（`common.auth.form.forgotPassword`） |
| `server.email.changed.notYou`（zh） | 「忘记密码」 | 同上 |
| `server.email.passwordChanged.notYou`（en） | "Forgot password" | "Forgot password?" |
| `server.email.changed.notYou`（en） | "Forgot password" | 同上 |
| `server.email.authenticatorAdded.notYou`（en） | "Sign-in methods" | 词条表里没有这一栏 ⇒ 真路径 "Passkeys" |
| `site.docs.account.s1i3`（en） | "The encryption passphrase" | 「加密与恢复码」/ "Encryption and recovery" |

**这六条要紧在它们住在哪两封信里**：`passwordChanged` / `authenticatorAdded` 是**账号已被盗时用户唯一会读的东西**，
名字对不上等于让他在一屏里找一颗不存在的按钮，而攻击者正在里面等他磨蹭。

🔴 **两处扩了射程也扫不到，是人眼补的 —— 而且它们各暴露一种不同的射程边界**：
- zh `请到设置里的「登录方式」`：中文那条规则要求引号**紧跟在动词后面**，动词表是
  `点|按|走|用|进入|打开|在|见`；这中间隔了一个「的」⇒ 没抽到名字。
  （同一句的 en `under "Sign-in methods"` 抽到了，因为英文动词表里有 `in|under|see|with|go to`。）
- zh `边界见「端到端加密口令」`：「见」在动词表里，名字**也抽到了**，但它**判据过**——
  `端到端加密口令` 确实是两条词条的值（`web.sync.password.label` / `mobile.profile.password.label`）。
  真缺陷是**类别指错了**：那句话引用的是帮助页某一节的**标题**，而那一节的标题词条是
  `site.docs.passphrase.title` = 「加密与恢复码」。⇒ **membership 型判据挡不住"名字属于另一类对象"**，
  它只能回答"界面上有没有这个东西"，回答不了"这句话指的是不是它"。这一格现在是人的活，
  要纳入判据得先给"节标题"单开一张表，再让交叉引用只对那张表 —— 不是扩动词表能解决的。

（更正一条口径：笔 `4c4b3617` 的提交信息把这二处并成了"都在动词紧邻那条射程之外"。上面才是分开说清的版本，
以本节为准。提交时 HEAD 已被并行会话推进过，旧笔不能再改写。）
**中文其余形状**（`里的「X」` 这类）现在靠人。要把它们纳入，得先把动词表扩成一族再拿假阳数量过一遍 ——
按 §6.22 那两条被否证的规则的教训，扩表之前不许写进判据。

读数：扩射程后、改词条前 = **rc=1 且恰好 6 条 🔴**（分母：射程内 site 键 187 枚 / 抽出的引号名 19 段 / 命中豁免 0 条）；
改后 = **rc=0**，`--self-test` 全绿（臂数由它自己打印，本文件不抄），其中一臂是"整条值就是一个占位符的词条不许通配不了一切"，见 §7 第 396 条）。
`server/scripts/gen-server-copy.ts --check` = **rc=0**（118 条 × 2 语言）⇒ 生成物与真源同一。

🔴 **这一笔里我自己制造了一次红灯，记下来是因为它的形状会复发**：
落地用的隔离树是从 `3789e27f` 拉的，而**就在我准备的这两分钟里**产品体验线落了 `fce852e8`
（把 `common.share.consent.dontAskAgain` 的双引号词条值改成单引号 + 转义，好让 `check:ui-language` 在 HEAD 上能跑）。
我的 blob 是那棵树 + 我的 8 处 ⇒ 提交上去**把他们刚修的那一行带回双引号形**。
纯 HEAD 树上的两次读数（同一枚脚本 `node scripts/check-ui-language.mjs`）：

| 那棵树上的 en.ts | rc | 报的是哪一格 |
|---|---|---|
| 我的笔 `4c4b3617` | 1 | 🔴 `无法解析词条表：packages/i18n/src/locales/en.ts —— 看起来像词条的行有 3858 行，只解析出 3857 条` |
| 他们的笔 `fce852e8` | 1 | 价格那一格（`hosted-ai-monthly` 的 grants 带 `automation`）—— **在我之前就有**，归 automation/价格那条线 |

⇒ 修法：`d833ace7` 只回退那一行（`git diff HEAD~1 HEAD` 恰好 1 对行），我这 4 条 en 词条逐字不动。
**可迁移的那一条**：用 `base..HEAD` 的隔离树落地之前，先跑
`git diff --name-only <base> HEAD -- <我要提交的每一枚路径>` —— 输出非空就说明基线过期，
必须重新装配。（这笔之后每一枚文件我都重跑了这一条，笔 B/C 的前置见 §6.25。）

⚠️ **顺带又踩了一次文档里已经写过的那条**：`pnpm --filter @heyta/server test …` 打
`No projects matched the filters` 然后**退 0**（真名是 `@heyta/sync-server`）。AGENTS §6 早就把这条列成假绿，
我第一次读数时还是照直觉写了包名 —— 读数必须来自 `pnpm -r … test` 那种**会因缺脚本而退 1** 的形状，
或者直接把退出码与 `Tests N passed` 那行一起看。

### 6.25 过期凭据的清扫落到了地上：6 + 9 + 36 条判据，以及那条**第一趟活下来的变异**（11:5x 现量）

ADR-0063 §3 承诺过"一次性、消费即失效、留存 N 天"，而**没有任何一层真的去清**：
`users` 上四对「令牌 + 过期时刻」列、`email_change_requests` 那一行（它带**新邮箱明文** `pending_email`）、
`access_sessions`（带设备名与 UA）在过期之后一直留在库里。

落地三件：

| 文件 | 内容 |
|---|---|
| `server/src/account/credential-sweep.ts` | `sweepExpiredAccountCredentials(nowMs)`：四列各一次 `updateMany`（条件 `not: null` **且** `lt: now`），换绑行 `deleteMany` 要求**两侧都无人持有**，会话行走 `deleteSessionsOlderThan(now - SESSION_ROW_RETENTION_MS)`，阈值从 `JWT_EXPIRY` 推导 |
| `server/src/sync/cleanup.ts` 第 9 步 | 调用它并**计数为 0 也记日志**（"跑了但没活干"必须与"根本没跑到"分得开）；炸了响亮记 error，不局部吞掉 |
| `server/tests/credential-sweep.spec.ts` | J-S1…J-S6，6 条 |
| `server/tests/email-change-page.spec.ts` | `/change-email` 凭据页 9 条（GET 不消费令牌、令牌进 HTML 属性前过 `escapeHtml`、两种成功是两句不同的话、「去登录」只在生效那一支才亮、失败不回显内部话术、脚本挂在 `</main>` 之后） |

读数（载体 = `.worktrees/mail` 那棵**只含本线改动**的树，`server/node_modules` 软链到主检出；
这条很重要：主检出的 `server/src` 里同时躺着别人未提交的改动（automation 那条线的 `purgeExpired*` 就在其中），读数为 0 或为 1 都不能归因到本笔）：

- `credential-sweep.spec.ts` **6 passed (6)**
- `credential-sweep` + `email-change-page` + `email-change` **51 passed (51)**（9 + 36 + 6）
- `tsc --noEmit -p tsconfig.json`：该树 **2 错**（`src/automation/ai-metering.ts(98,85) TS2741`、`src/email.ts(314,60) TS2554`），
  主检出（脏）**0 错** ⇒ **那两枚红是 HEAD 自带的**（消费者已提交、生产者在路上），不是本笔带进来的；
  本笔那块代码在该树上类型干净。

🔴 **这一族真正产出的判据来自一条活下来的变异**：
臂 `cs-2-drop-old-side-guard`（把换绑那行的"old 侧也要无人持有"整段删掉，只剩 new 侧）
**第一趟 6 条全绿**。查了才确认不是探针坏：`git diff` 证明变异进了产物（`oldExpiresAt` 在 `where` 里出现次数
由 2 变 0、`OR` 子句只剩 1 段），而 J-S3 的 fixture **只造了"new 侧有人在等"那一半** ——
"只看 new 一侧"的错法在那一行数据上行为完全一样。
⇒ 补了**镜像 fixture**（old 侧 `FUTURE` + 有 token、new 侧 `null`），
J-S3 从此要求"两边各有一行都在等人"，重跑该臂 = **rc=1、恰好 J-S3 红**。
这是 §7 第 274 条的形状（负向断言的正向对照要落在"条件不成立时确实会变"那一侧）在本线的第二次命中。

三臂终局读数（每臂跑完立刻从 `.mut-bak` 还原并 `cmp -s` 验证）：

| 臂 | 改的是哪条形状 | 红在哪条 |
|---|---|---|
| `cs-1-unpair-columns`（`data` 里去掉过期时刻列） | "令牌与它的时刻必须在同一次写里成对出现" | J-S1 + J-S2（2 failed） |
| `cs-2-drop-old-side-guard` | "两侧都无人持有才删" | J-S3（1 failed，补镜像 fixture 之后） |
| `cs-7-sessions-unreported`（`sessions` 写死 0） | "每格报告的都是真正删掉的行数，0 也必须在场" | J-S6（1 failed） |

⚠️ **一枚混着两条线的文件是怎么只提交自己那一半的**：`server/src/sync/cleanup.ts` 在主检出里同时带着
automation 那条线的两个 `purgeExpired*` 调用（未提交）和我这一步。直接提交工作树内容 = 代他们提交。
做法：在隔离树上从 **HEAD 版**出发只插入我那块（锚点选 ai-usage-counters 那节的收尾，
并断言 `startCleanupJobs` 排在我的块之后 —— 第一次锚 `body.rindex("};\n")` 把块插进了 `startCleanupJobs` 里，
`TS1308 await outside async` 当场抓住），再 `git hash-object -w` + `update-index --cacheinfo`，
`git diff --cached --name-only` 确认恰好是本线那几枚路径，最后 **不带 pathspec 的 `git commit`**
（`git commit -- <path>` 提交的是工作树内容，会把别人的脏行一起带走）。

### 6.26 为 iOS 设备腿起隔离载体时，当场撞出两件**在 HEAD 上就坏**的跨线缺陷（12:1x 现量）

隔离载体（`.worktrees/iosacct` @ 当时 HEAD）第一步是 `pnpm install --frozen-lockfile`。它没装成，
报的不是网络也不是磁盘：

```
[ERR_PNPM_OUTDATED_LOCKFILE] Cannot install with "frozen-lockfile" because
pnpm-lock.yaml is not up to date with <ROOT>/packages/ui/package.json
* 2 dependencies were removed: @zxcvbn-ts/core@4.2.0, @zxcvbn-ts/language-common@4.1.3
```

| 缺陷 | 现量形状 | 由谁消 / 一条命令 |
|---|---|---|
| 🔴 **HEAD 的 `pnpm-lock.yaml` 与 HEAD 的 `packages/ui/package.json` 互相不认** | `git show HEAD:pnpm-lock.yaml \| grep -c zxcvbn` = 10；`git show HEAD:packages/ui/package.json \| grep -c zxcvbn` = 0。⇒ **任何干净检出（CI 的默认形态就是 frozen）装不起来**，而 `packages/ui/package.json` 在主检出是 `M`（有人正在把那一半补上）= 锁文件先落地、声明还在飞 | ui 那条线：把 package.json 那一半与锁文件一起落；复核命令 `git -C <干净检出> pnpm install --frozen-lockfile` |
| 🔴 **`pnpm check` 链里没有任何一道比这对** | `node -e` 扫 `check:*` 键名含 lock/depend/install 的 = 0 道；链的 `&&` 串里含 `lock\|frozen` 字样的段 = 0 段。也就是说这条**会让 CI 整条挂掉**的不变量，靠的是"有人恰好跑过 frozen 安装" | 谁先需要谁立：最小形状是把 `pnpm install --frozen-lockfile --lockfile-only` 做成一道门（它会因这对漂移而红）——**本线不代建**：新建判据的口径要负责人拍（§6.22 那两条被否证的规则就是先例） |
| ⚠️ `check:docs` 在 HEAD 上红一处 | `apps/desktop-windows/README.md:89` 指向 `scripts/windows/launch-data-transfer-qa.ps1`，"本机有、仓库里没有"；该 README 在主检出是 `M` | Windows 那条线：把那枚脚本一起提交，或按它自己的说明进 `UNTRACKED_LINK_OK` 带理由登记 |

📌 **为什么这条值得单独一节**：这两格都不是"某条线的功能没做完"，而是**干净检出这一形态本身已经不成立**。
本仓库的立场（AGENTS §7 第 46 条那一族）是"红要能归因到字节"，而 frozen 安装失败这件事
`pnpm check` 全链一次都不会碰 —— 链里 `pnpm -r build` / `-r test` 都吃**已经装好的** `node_modules`。
⇒ 我在隔离载体上撞见它，不是运气：那是这台机器上**唯一一个"从锁文件重新装一遍"的动作**。

本线的处置：载体改用 `pnpm install --no-frozen-lockfile`，**装完立刻把 `pnpm-lock.yaml` 还原成 HEAD 那一版**，
再用 `git status --porcelain` 数被跟踪脏 = 0 才允许过窗口门 ——
否则"我为了让装起来而改动的字节"会混进本轮打包输入，读数就不再属于这批代码。

### 6.27 🔴 更正 §6.18：移动端那两块面板**从来没在 HEAD 上挂过** —— 那句"已 = 2"是拿脏树量的（12:2x 现量）

为 iOS 设备腿起完隔离载体，第一件事是把判据**对着 HEAD 复跑**（§6.18 那条行当时写的是
`git show HEAD:apps/mobile/src/screens/ProfileScreen.tsx | grep -c EmailChangeSection` 已 = 2）。
现量结果：

| 问法 | 命令 | 读数 |
|---|---|---|
| HEAD 上有没有换绑挂载 | `git grep -c EmailChangeSection HEAD -- apps/mobile/src/screens/ProfileScreen.tsx` | **无匹配**（不是 0，是根本没有） |
| 工作树里呢 | `grep -nE "EmailChangeSection" apps/mobile/src/screens/ProfileScreen.tsx` | 第 87 行 import + 第 1249 行 JSX ⇒ **挂载只活在未提交的工作树里** |

"那两块组件在 HEAD 上到底有没有人渲染"这条问法里有管道符，放进表格会把列数改掉，所以单独列：

```bash
git grep -lE 'import .*(EmailChangeSection|SessionsSection)' HEAD -- apps   # 空 ⇒ 两枚组件都是孤儿
```

⇒ §6.18 那句是**把"工作区属性"读成了"提交属性"**：`git show HEAD:` 那条命令本身没写错，
是我当时读的是一份已经被别的会话写过、而我把它当成 HEAD 的树。这一条在本线不是新鲜事
（记忆 `feedback-rerun-the-gate-against-head-after-committing` 记的就是同一个形状），但**这次它把一格本该做的工作伪装成了已完成**。

产品后果是实的：`EmailChangeSection`、中英词条、`packages/app-host` 编排、服务端路由、单测、
设备脚本全在仓库里，而**移动端界面上点不到"更换登录邮箱"** —— 一个只能靠设备验收才能证的入口，
在 HEAD 上任何设备上都找不到。这一格此前记成"早已入库"，所以没人去查。

### 6.28 换绑那两行挂载落到了 HEAD（`76944386`），会话那一块**没有跟着挂**，理由写在账上

**挂上的**：`ProfileScreen.tsx` 两行（import + JSX），插在 HEAD 自带的 `profileEditor` 区域里
只读邮箱行与那句 `common.profile.email.hint` 之后。三件事各自成立才敢说这一格：
- 入参 `form.serverUrl` / `form.token` / `signedInEmail` **逐字取自 HEAD 已有的标识符**
  （同一份 HEAD 文件里 `signedInEmail` 在 620 行、`form.token` 在 621 行、`form.serverUrl` 在 894 行都已经在用），不依赖任何未提交代码；
- 装配前用 `git show HEAD:<file>` 造 blob、两处锚各断言"恰好命中 1 次"，落盘后先过一遍
  **解析证明**（`esbuild --loader=tsx` rc=0）再谈提交 —— 见 §7 第 397 条，
  自报"PATCHED"不算生效，能被解析才算；
- 那两行与在飞那版**逐字同形**（`grep -Fxq` 两条都命中）⇒ 对方整份提交 `ProfileScreen.tsx` 时
  不会把我这两行当"多出来的改动"删掉。
- 判据：`check:mobile-settings` rc=0（那块表单不进「我的」滚动流这条形状由它的 R3 钉住）；
  `git grep -c EmailChangeSection HEAD -- …` 现在**真的是 2**。

**没挂的**：`SessionsSection`。它需要 `onSignOutCurrentDevice` / `onSignedOutEverywhere` 两个回调，
而这两个名字在 HEAD 的 `SecurityScreen` 里出现 **0 次** —— 它们住在别人正在重写的
`ProfileScreen.tsx` / `SecurityScreen.tsx` 的未提交部分（那一趟现量 `git diff --stat` 得
616 插入 / 117 删除；这个数会漂，复取：`git diff --stat -- apps/mobile/src/screens/{ProfileScreen,SecurityScreen}.tsx`）。按记忆里那条"隔离载体叠哪些未提交改动是一个要明写的裁决"：
从 616 行里只挑我那几行 = 造一棵谁都不有的树，红了没人能归因；整片叠上 = 读数含别人在飞的代码。
两种都不做 ⇒ **这一格等那两枚文件落地**，闭合判据现量一条：

```bash
git grep -c "onSignOutCurrentDevice" HEAD -- apps/mobile/src/screens/SecurityScreen.tsx   # 非 0 ⇒ 可以挂了
```

### 6.29 设备腿那一趟是怎么排的（载体、探针、以及我自己写坏的那枚探针）

- 载体：`.worktrees/iosacct`，`git worktree add --detach` 到当时 HEAD，`pnpm install --no-frozen-lockfile`
  （frozen 装不起来的原因见 §6.26 —— **那是 HEAD 自带的漂移，不是载体的问题**），
  装完立刻 `git checkout -- pnpm-lock.yaml` 并断言被跟踪脏 = 0，
  否则窗口门的 `src` 那一格会把我自己为了让装起来而改的字节算进本轮打包输入。
- 编排：`~/.heyta-window-rigs/heyta-ios-account-chain.sh`，串行四步 + 每步落 rc 到证据目录，
  **只认整条链的 `CHAIN_RC`**：`install.rc` → 载体脏=0 → 软链解析 → blob 同枚自证 →
  `verify-mobile-window-gate.sh --target b`（负载 / 脏源码 / 设备独占，有界轮询 60 分钟，等满退 3）→
  `reinstall-all.sh --only ios`（第 0 段自己跑 `pnpm -r build` ⇒ 它就是这笔挂载的编译证明）→
  `--target c` → `verify-mobile-ios-account-email-sessions.sh` → 收尾把验收流程自己改写的
  `apps/mobile/ios/*` 留 diff 后还原，并核对载体首尾同一枚 pin。
- 🔴 **我第一版探针把合格的载体判成不合格**：软链自证写的是 `readlink … | grep iosacct`，
  而 pnpm 的 workspace 软链是**相对**串（`../../../../packages/domain`），恒不含树名 ⇒
  第一轮 `CHAIN_RC=3` 报"软链没指载体这棵树"，而那棵树其实完全指对自己。
  改成 `realpath` 后比前缀才分得开。这正是记忆里"入口判断要比 realpath（/tmp 是软链）"那条的第二次命中，
  换了个对象又踩一次 —— **假阻塞的形状永远是"探针报红"，不是"事情做不成"**。
- 读数落在 `~/.heyta-evidence/ios-account-email-<时间戳>-r3/`（`chain.log` 有各步 rc；
  截图按 §7 第 208 条只认 `primary` 那张，并按"腿绿 + mtime + md5"三条齐才算本轮）。

### 6.30 三份只活在工作树里的东西入库，以及"文档引用的文件根本没跟踪"这一整形状（12:5x 现量）

起 iOS 设备腿的等待窗口里做了一件不依赖设备的事：把本计划**自己引用过、但从来没入库**的东西查出来。
一条命令（反引号里出现过的路径 ∩ 未跟踪集合）：

```bash
node /tmp/cited-paths-sweep2.mjs docs/plans/account-standard-suite.md
```

（脚本本体是一次性夹具，不入库；形状就两步：`git ls-files` 与 `git ls-files --others --exclude-standard`
各取一份，按 basename 分桶后用**后缀**匹配，命中未跟踪那一桶就是它。）
现量结果：计划里 64 枚被点名的路径，**3 枚只有未跟踪的那份**，其中两枚属本线
（⚠️ 这一句是**当时**的读数。复取：`git ls-files --error-unmatch <每一枚>`，逐枚看退码 ——
现在本线那两枚都已入库，只剩另一条线那一枚。写这张表的理由不变，别把"表里三行"读成"现在还有三枚"。）

| 被引用的东西 | 归谁 | 为什么承重 |
|---|---|---|
| `research/tools/account-email-sessions-http-probe.mjs` | 本线，计划里 6 处（§6.7 / §6.13 的读数 34、35 出自它） | ✅ 已入库（现量：`git ls-files --error-unmatch research/tools/account-email-sessions-http-probe.mjs`） |
| `apps/web/tests/account-security.spec.tsx` | 本线 | ✅ 已入库 `23a3a24b`。它当时"不能单独入库"的理由（§6.31）随挂载那笔 `3dd210bd` 消失，读数在 §6.41 |
| `server/tests/integration/registration-otp.integration.spec.ts` | 另一条线（注册口令验证码那一族） | 本计划只是在写 `test:integration:postgres` 那份清单时点到它 ⇒ **只登记，不动别人的字节**。现量：`git ls-files --error-unmatch <这枚>` 仍报 not tracked |

反过来的形状也查了一遍，并且命中一枚：`research/tools/mutate-credential-sweep.py`（§6.25 那批变异臂的装置）
此前**入了工作树却没有任何文档引用过它** —— 那批读数在仓库里就没有可复跑的通道。
本条就是那条引用：`python3 research/tools/mutate-credential-sweep.py --list`（臂数由装置自己打印）。

入库的三件（`7f6fb547`）与各自入库前怎么验的：

- `server/tests/email-change-sessions-schema.pglite.spec.ts` —— W1 那张迁移的**数据库层**证据。
  应用层那两组（`email-change.spec.ts` / `access-sessions.spec.ts`）跑的是假 prisma，
  `where` / `deleteMany` / 主键都是测试自己写的模拟，
  证得了"代码按我理解的语义走"，证不了"库真的拦得住"。这一趟 `14 passed`（PGlite 是真 Postgres 语义）。
  🔴 判据**能不能红**没有靠嘴说：用一枚一次性负向对照探针（跑完即删，不进仓库）把两句 DDL 各自摘掉 ——
  臂 1 摘 `pending_email` 那条 UNIQUE ⇒ "两个账号抢同一个待绑地址"就**写得进去**；
  臂 2 摘两条外键 ⇒ 注销账号后那张待绑请求与会话行**留在库里成孤儿**。
  同一份未改的 SQL 上两臂的反面都成立（第二句被拒 / 两张表的行一起消失）
  ⇒ 那两条 🔴 判据的红分别由那两句 DDL 承担，不是由测试脚手架或驱动报错承担。
- 两份 `research/tools/` 装置入库前各跑一次：`python3 -m py_compile` 过、
  `--list` 由装置**自己**打印臂数与每臂该点名的判据编号；探针在缺前置变量时**响亮拒绝并退 2**
  （不是栈，也不是"跑成功但什么都没判"）。

### 6.31 🔴 本线在 HEAD 上留了一道必红的 e2e，归属写清楚，别让它被读成别人的

`e2e/tests/account-email-change-and-sessions.spec.ts` **已入库**，而它点的那三块 web 面板
（`EmailChangePanel` / `SessionsPanel` / `SettingsAccountGate` 与两份 store、一枚 css）
**全部还是未跟踪**。于是干净检出上这条判据**永远红** —— 不是抖动，是主体没跟着判据一起进来。
现量两条：

```bash
git grep -c "email-change-submit" HEAD -- apps/web      # 0 ⇒ 界面里没有这个 testID
git ls-files --others --exclude-standard -- apps/web/src/features/settings | wc -l   # 本线那几枚在未跟踪集合里
```

🔴 **为什么不现在把面板单独入库**：那枚 jsdom 判据 import 的就是这几枚面板，面板又要挂进设置面才有意义，
而挂载点 `apps/web/src/App.tsx` 正被并行会话整片重写（那一趟现量 `git diff --stat` =
367 插入 / 471 删除；复取：`git diff --stat -- apps/web/src/App.tsx`）。
把别人文件里的挂载行提取进我这一笔 = 替他们决定"这一节可以落地了"，而且他们下一次整份提交会把我的行
当"多出来的改动"删掉。⇒ **这一格与挂载同一笔闭合**，与 §6.28 移动端那一格是同一个等待条件
（现量：`git grep -c "onSignOutCurrentDevice" HEAD -- apps/mobile/src/screens/SecurityScreen.tsx` 非 0 那一趟，
web 侧对应的是 `App.tsx` / `main.tsx` 落地）。
在那之前，任何人在干净检出上跑 `check:ai-e2e` 见到这一条红，**归本线**，不要记成环境。

✅ **09 23:3x 现量：这一格已闭合，而且本节那条预测被否证了一半。** 面板与挂载落进 `3dd210bd`、
判据与真浏览器图落进 `23a3a24b`，于是上面那两条现量命令换了读数：
`git grep -c "email-change-submit" HEAD -- apps/web` 从 **0**（干净检出必红）变成 **1**。
预测里"他们下一次整份提交会把我的行当多出来的改动删掉"这一半**没有发生**：
他们那版 `App.tsx` 的工作树里现在带着 `<SessionsPanel active={…} />`（现量：
`grep -n 'SessionsPanel' apps/web/src/App.tsx` ⇒ 三处，含带 `active` 那一处），
也就是**覆盖同一行**而不是删掉 —— 这正是当初把落点取在他们那一处的全部理由（§6.41 有对照：
第一版候选把两块面板都往 `App.tsx` 挂，那才会造出第二张）。
本节"为什么不现在单独入库"的**前提**（挂载点没落地 ⇒ 面板入库就是死代码）随挂载那笔消失，
留在原文里是为了让后来者认出"判据先于主体入库"这个形状，不是照它行动。

### 6.32 设备腿 r3 那趟整链死在**我自己两枚探针缺陷**上，而它的症状是"链在跑"

- 缺陷 1：链的第 0 步是"等载体装依赖的终态旗 `$EVID/pnpm-install2.rc`"，而那枚旗由**外面那一趟 launcher** 落。
  我 kill 掉旧链、直接重投链本体时没人落旗 ⇒ 它在第 0 步空转 `160 × 15 s` 然后 `finish 3`。
  现象是"进程活着、`chain.log` 一个字节都没写"—— 与"正在安静地等窗口"逐字同形。
  ✅ 修在**行为**上：旗改由链自己落（没有旗就自己装、装完落旗），不再依赖上游那一趟存在。
- 缺陷 2：软链自证那一步我上一版写的是 `cd "$(dirname "$0")"; realpath 相对路径` ——
  脚本住在 `~/.heyta-window-rigs`，于是那枚相对路径在**脚本自己的目录**里解析 ⇒ 恒 `MISSING`
  ⇒ 把合格的载体第二次判成不合格（`CHAIN_RC=3`）。同一枚教训（入口判断要比 realpath）第二次命中，
  这次咬的是我为了"修第一版"新写的那一行。✅ 修法：那一步不许 `cd`（链在第 1 步前已经 `cd` 进载体）。
- 🔴 **判"链在跑"与"链在等一个永远不会来的东西"的现量只有一条**：看它有没有写出**新的**读数文件
  （`gate-b.log` / `reinstall-ios.log`），不是看 `ps` 里有没有那个 pid。
- 载体 pin 复用是有据的，不是省事：`git diff --name-only 76944386 HEAD` 只列
  两份 plan 文档 + `scripts/qa/check-locator-labels.py` + 那两份装置 + 那一枚 pglite 判据 ——
  **一枚移动端产品源码都没有** ⇒ r3 那趟装依赖的终态旗对 r4 仍然成立（沿用并写明出处：
  `install-flag-provenance.txt`）。
- r4 窗口门 `--target b` 第一趟就开（`chain.log` 20:58:09）：负载 **11 < 阈值 12**（16 核，阈值由 `hw.ncpu` 推）、
  载体被跟踪脏 = 0、`scripts/reinstall-all.sh` 自身干净、没有别的移动端验收/别的 `reinstall-all` 在跑。
  ⚠️ 那一趟现量有**两台 booted 模拟器**（`heyta-iphone-17pro` 与另一条项目留下的 `ssos-1.0.6-review-ipad`），
  门自己警告 `--confirm` 默认取列表第一台 ⇒ 链是**显式**传 `IOS_DEVICE_NAME=heyta-iphone-17pro` 的，
  没有依赖顺序。闸门与验收脚本的 blob 与主 HEAD 逐枚同枚（三枚都 `blob 同枚`）。


### 6.33 🔴 HEAD 上那句「只发五封功能邮件」是假的：代码实际发九封，其中四封就是本批那四封（13:0x 现量）

做 §6.30 那条普查时，ADR-0063 也过了同一把尺，它指着 `packages/legal/tests/email-catalog.spec.ts`
—— **本线 W7 那枚"邮件封闭词表回到代码对账"的判据，写完就没入库**。
把它现量了一遍，结论比"少一份文件"重：

| 问法 | 读数 |
|---|---|
| HEAD 的政策数了几封 | **五封**：`privacy.ts:201/296/315` 与 `third-parties.ts:130/152`（另有一处文件头注释也写着"五封邮件"） |
| HEAD 的代码真发几封 | **九封**（`^export const send*Email` 的条数） |
| 这九封是不是摆设 | 九枚**全有调用点**（`auth.ts` / `passkey.ts` / `password/recovery.ts` / `account/email-change.ts` / `account/authenticator-notice.ts`） |
| 多出来那四封是谁的 | 换绑-新邮箱确认、换绑-旧邮箱授权、换绑完成通知、新增认证器告知 ⇒ **本批那四封** |

上面四条的现量命令（"几封"那种数法要对着代码数，不能抄文案）：

```bash
git grep -nE '(十|九|五) ?封' HEAD -- packages/legal                       # 政策侧的每一个数
git show HEAD:server/src/email.ts | grep -cE '^export const send.*Email'   # 实现侧的真值
for f in $(git show HEAD:server/src/email.ts | grep -oE '^export const send[A-Za-z]+Email' | sed 's/export const //'); do
  printf '%s <- %s\n' "$f" "$(git grep -l "$f" HEAD -- server/src | grep -v 'email.ts' | tr '\n' ' ')"
done                                                                        # 逐枚证明不是摆设
```

`privacy.ts:296` 那句是**封闭句式**（"只有第 3 条列过的那五封"），按本仓已经吃过一次的规矩
（AGENTS §7 那条"凡是封闭句式，它指的集合必须有一条对账门禁"），它现在就是一句没人守的对外承诺，
而且方向是**少承诺**：用户读到"只有五封"，实际会收到九封，其中"换绑完成"与"新增认证器告知"两封是安全通知。

🔴 **为什么没有任何一层会失败**：法务那一族五道门在 HEAD 上是绿的（§6.17 / §6.23 的读数），
因为它们对账的是**生成物 ↔ 真源文本一致**，不是"代码里到底有几封"。
把这句话钉回代码的那把尺就是那枚未入库的 spec。

### 6.34 那枚判据为什么不能单独入库，以及"联合那一笔"的完整清单

它**在主树里是绿的**（`npx vitest run tests/email-catalog.spec.ts` ⇒ 5 判据通过），但那个绿是
「HEAD + 别人在飞的改动」的属性，不是提交属性 —— 现量三条：

| 命令 | 读数 | 含义 |
|---|---|---|
| `git grep -c sendEmailPasswordRegistrationCodeEmail HEAD -- server/src/email.ts` | **HEAD 里没有**（`git diff` 里它是 `+` 行） | 第十封（注册验证码）属另一条会话，未提交 |
| `grep -cE '^export const send.*Email' server/src/email.ts` | 工作树 **10**，HEAD **9** | 该 spec 的登记表是 **10** 行 ⇒ 拿 HEAD 那棵树跑必红"登记表多于实现" |
| `git diff --stat -- packages/legal` | 7 枚文件 366 插入 / 308 删除 | 「十封」那句改写与 `automation-metadata` 那一节**同处这些文件** |

⇒ 单独入库 = 在 HEAD 上造第二道本线必红（§6.31 已经有一道了），而且会把别人未提交的注册验证码那封信
挂到我的提交信息下。**这一格只能由"实现与文本同一批"那一笔关闭**，清单就地写清：

1. `server/src/email.ts` 那第十枚 sender 与它的调用点（**注册验证码那条线**）；
2. 本线已写好、仍未入库的政策改写：`packages/legal/src/documents/{privacy,third-parties,data-rights,personal-info-list,terms}.ts`
   与 `src/index.ts`（五封 → 十封、换绑在途那枚明文例外、一次性凭据时长表补两档、注销级联按迁移终态重算、中英同步）；
3. `packages/legal/tests/structure.spec.ts` 里跟着级联数字变的那批断言；
4. `server/src/legal.generated.ts` 重新生成（`check:server-copy` / `check:legal-copy` 的前置）；
5. `packages/legal/tests/email-catalog.spec.ts` 本体入库 + ADR-0063 那条引用随之成立。

复取这一格还开着的判据（输出 `CLOSEABLE` = 可以闭）：

```bash
git grep -q 'sendEmailPasswordRegistrationCodeEmail' HEAD -- server/src/email.ts \
  && git diff --quiet -- packages/legal && echo CLOSEABLE || echo "still open"
```

📌 **09 23:5x 复取：`still open`，而且挡路的那三枚现在有名字了**（逐条 `git ls-files --error-unmatch`，
全部报 not tracked）：`server/src/password/registration-otp.ts`、
`server/prisma/migrations/20261016000000_add_email_password_registration_challenges/migration.sql`、
`server/tests/integration/registration-otp.integration.spec.ts`。
同批两条读数没变：`grep -cE '^export const send.*Email' server/src/email.ts` 工作树 **10** / HEAD **9**，
`git status --porcelain -- packages/legal` 仍是 7 枚 ` M` + 3 枚 `??`。
⇒ 这一格的**唯一**外部前提就是那三枚落地（它们属注册验证码那条会话，不是本线能代拍的：
迁移是不可逆层，而"十封"是一句对外法律表征）。它们落地后本线的动作是清单上第 2–5 项一次做完。


### 6.35 移动端与 web 那几格产品面：**代码都写好了，卡在"文件正被别人整片重写"** —— 一张总账（13:0x 现量）

这一轮把所有"界面点不到"的格逐格现量了一遍。结论不是"还缺一堆实现"，而是
**六格里只有一格需要新写代码，其余五格是已写好却没入库的改动**，而它们的共享前置是同一条：
并行会话把那几枚文件提交（`apps/mobile/src` 418 枚脏、`apps/web/src` 567 枚脏，
`AuthScreen.tsx` 单枚 381 插入 / 108 删除、`SecurityScreen.tsx` 432 行改动 —— 都是**别人的活**，
从里面挑我那几行就是造一棵谁都不有的树，见 §6.28）。

⚠️ **09 23:5x 现量更正这一句里关于 `SecurityScreen.tsx` 的那一半**：那批改动**是本线自己写好没提交的**，
不是别人的（判据：那 369 行加/删行里的标识符只有账号套件的词，别线词命中 0 —— 现量与两条后果在 §6.43）。
`ProfileScreen.tsx` 那一半才是真混的。所以这一格卡住的原因从"等别人提交"换成
"**要整片落，而那一片里含别线字节**"—— 这不是等待条件变了，是**归属**变了：它归本线做，
欠的是一次能过编译级判据的整片落地。

| 格 | HEAD 上到底有没有 | 代码在哪 | 谁关 |
|---|---|---|---|
| 移动端「更换登录邮箱」挂载 | ✅ **有**（`git grep -c EmailChangeSection HEAD -- apps/mobile/src/screens/ProfileScreen.tsx` = 2） | 已入库 `76944386` | 已关，见 §6.28 |
| 移动端「登录设备 / 逐枚撤销 / 退出这台 / 退出所有」挂载 | ✅ **有**（10-09 16:3x 现量：`git grep -c "onSignOutCurrentDevice" HEAD -- apps/mobile/src/screens/SecurityScreen.tsx` = 3，`…ProfileScreen.tsx` = 1） | 已入库 `bf9426d0`（`SecurityScreen.tsx` +369/−63 与 `ProfileScreen.tsx` 那处 hunk +103/−0 一次落） | 已关，读数与为什么必须整片落在 §6.44；**只剩设备腿那一趟读数**（§5 第 10 项、§6.40） |
| 移动端「丢失了通行密钥？发一封找回链接」 | ✅ **有**（同一笔里落的；`git grep -c "security-recover-submit" HEAD -- apps/mobile` = 1 ⇒ 那枚孤儿词条从此有宿主了） | 同上 `bf9426d0`（`requestPasskeyRecovery` 在 HEAD 命中 1 枚文件） | 同上（同一批）；已登录那条添加通行密钥的路径也在这笔里从红转绿（`beginPasskeyEnrollment` HEAD 命中 2） |
| 移动端「忘记密码？」入口 | ❌ 没有（`git grep -c forgotPassword HEAD -- apps/mobile` = 0） | 写好在**未提交**的 `AuthScreen.tsx`（`requestPasswordReset` 导入 + `forgotPassword` 那个 handler） | 等 `AuthScreen.tsx` 落地 |
| web 三块面板（换绑 / 会话 / 登出这台与所有） | ✅ **有**（现量：`git grep -c "EmailChangePanel" HEAD -- apps/web` ⇒ 面板 1 / `ProfilePanel.tsx` 3 / 判据 23；`git grep -c "email-change-submit" HEAD -- apps/web` = 1） | 已入库：组件+挂载 `3dd210bd`，jsdom 判据 41 条 + 6 张真浏览器图 `23a3a24b` | 已关，见 §6.41（含 §6.31 那道必红的闭合）；剩下的只有设备腿与法务那一笔 |
| 法务「十封」政策文本 + `email-catalog` 对账判据 | ❌ 文本改动在未提交的 5 份 legal 文档里，判据未跟踪 | 已写好 | 与实现同一批，见 §6.34 |
| 移动端「改登录密码」 | ✅ **有**（`changePassword` 在 HEAD 的 `SecurityScreen.tsx` 里 4 处） | 早已入库 | 本线没有欠项，这一格只是设备腿还没在干净载体上证过 |

⇒ **这一轮之后真正"没写"的产品面只剩一条**：鸿蒙端没有壳（§5 第 6 条，平台级，不在本线射程内）。
其余每一格都只需要一次提交 + 一次复跑。

🔴 一条给下一位的操作提醒：这些格子**互不相同的闭合条件**别读成同一个。
`SecurityScreen.tsx` 落地会同时关掉上面两格（会话 + 通行密钥找回），
`AuthScreen.tsx` 落地只关"忘记密码"那一格，`App.tsx` / `main.tsx` 只关 web 那一格，
而 legal 那一格还需要 `server/src/email.ts` 的第十枚 sender。
每格都带了一条现量命令，别按印象合并。

**它们落地之后必须复跑的两件**（否则"入库"不等于"能用"）：
① 设备腿 `bash scripts/verify-mobile-ios-account-email-sessions.sh` 的步骤 11–14（会话那一块在 HEAD 上不可能过）。
   🔴 这是一条**预期**不是读数：那一趟共 17 步（复取 `grep -cE '^[[:space:]]*step\b' scripts/verify-mobile-ios-account-email-sessions.sh`），步骤 15 是改登录密码（HEAD 上挂好了）、16–17 是收尾判据，
   11–14 需要会话挂载 ⇒ 本轮载体读数的**上限**就是"除 11–14 外全绿"。真实读数落在下一节，别看这段倒推。
② web 那一族真浏览器判据 `e2e/tests/account-email-change-and-sessions.spec.ts` —— §6.31 说了它现在是必红。


### 6.36 🔴 HEAD 打不出包：`pnpm -r build` 在纯 HEAD 的隔离载体上第 0 段就失败 —— 根因是本线昨天那一笔"docs"提交

r4 那条设备腿链走到第 5 步（`reinstall-all.sh --only ios`）以 rc=1 结束，`CHAIN_RC=1`。
失败点是它自己的第 0 段前置，而那句前置语现在读起来是这十六小时里最有价值的一行字：

```
═══ 0. 前置：pnpm -r build ═══
  🔴 全仓构建失败 —— 打包必然打进旧产物，停下
```

失败体（`reinstall-ios.log` 与 `reinstall-ios.tail.txt`，载体 = `76944386`、被跟踪脏 = 0）：
`packages/shared-schema/src/index.ts` 报 **TS2307 / TS2305**，指向四枚**没入库的 contract 文件**
与 `auth-http-contract.ts` 里**七个没入库的导出成员**。
那一趟只留了日志末尾若干行，所以"到底缺哪几枚"是拿 `git ls-tree` 对着 `index.ts` 的引用逐枚问出来的：

| index.ts 引用了 | 那些东西在哪 |
|---|---|
| `./task-batch-contract`、`./task-priority-batch-contract`、`./task-repeat-completion-contract`、`./reminder-owner-contract` | **四枚全部未跟踪**：`git ls-tree --name-only HEAD packages/shared-schema/src/` 里没有它们，而 `git ls-files --others --exclude-standard -- packages/shared-schema` 里四枚都在 |
| `EMAIL_PASSWORD_REGISTRATION_{ERROR_CODES, CODE_LENGTH, CODE_TTL_MS, RESEND_COOLDOWN_MS}` + 三个同名类型 | 住在 `auth-http-contract.ts` 那 32 行**未提交**的 diff 里 |

现量（一条命令，退出码非 0 = HEAD 仍然打不出包）：

```bash
git grep -c "EMAIL_PASSWORD_REGISTRATION" HEAD -- packages/shared-schema/src/auth-http-contract.ts || echo "HEAD 里没有那些成员"
```

🔴 **归因：是本线，不是别人。** `git log -S task-priority-batch-contract -- packages/shared-schema/src/index.ts`
指向 `9fa53ab9`（10-08 21:31，标题 `docs(账号面): 立 ADR-0063 与标准套件工单…`）。
那一笔的 `--stat` 里除了 ADR 与计划，还扫进了 **`0064-inbound-automation-commit-and-task-batch` / `0059-inbound-worker-authenticated-identity` / `0060-automation-entitlement-and-retention`（写文件名不写裸号：`0058` 这个号在 HEAD 上有两枚文件，裸号读法判别不了 —— `check:adr-numbering` 当时因此红；本线按那枚门禁文件头写明的修法把后来那一枚（本线自己的 `9fa53ab9`）改号成 0064 收回 ⇒ 该门禁现 RC=0，逐处读数见 BLOCKED B160；裸号仍不许写，写文件名。**、`apps/landing` 两份文档页、
33 张别的线的证据图，以及上面这些**别人的导出块** —— 而实现文件没跟着进来。
⇒ 一句"docs"标题的提交把别人半条流水线钉进了 HEAD，却把它们的依赖留在工作树里。

**为什么十六小时没人发现**：主检出一直是脏的（这一轮现量 `git status --porcelain | wc -l` = 1477 枚），
任何在主树上跑的构建都"看得见"那些文件。AGENTS §7 那条"『测过是绿的』是工作区属性不是提交属性"
这一轮被推到了极致 —— 连 **`pnpm -r build` 能不能过**都是工作区属性，而只有"纯 HEAD 的隔离载体"
这种载体才照得出来（这正是 §6.26 起隔离载体的理由，也是 §6.16 那趟 73 过的读数**不能**当作
"HEAD 可用"的证据的原因：它跑在脏树上）。

**影响面（不是本线一格，是全仓）**：`pnpm reinstall:all` 的每一端、任何设备腿、CI 打包路径全部阻塞；
本线剩下的 iOS 设备腿因此**无法由干净载体取证** —— `CHAIN_RC=1` 既不是产品失败也不是探针失败，
是 HEAD 本身不可构建。修复与预演在 §6.37。


### 6.37 修 HEAD 的构建：为什么最终是我来提那五枚文件，以及提完之后还剩什么（13:2x 现量）

§6.36 报出红之后，先在纯 HEAD 的隔离载体上做了预演（把候选文件复制进 `.worktrees/iosacct`，
pin 未动、被跟踪脏 = 0，全程不改主检出）：

| 预演 | 命令（载体里，绕开 pnpm 的自动装依赖 —— 它会把整趟拖进 registry 重试：本机代理流量额度已停 CI，`ECONNRESET` / `error 23` 反复出现） | 读数 |
|---|---|---|
| 类型层 | `node_modules/.bin/tsc -p tsconfig.json --noEmit`（`packages/shared-schema`） | **rc=0** |
| 产物层 | `node_modules/.bin/tsup` 同包 | **rc=0**，ESM + DTS 都成（`dist/index.d.ts 80.70 KB`） |
| 负对照 | 同一载体**不加**那五枚时 `pnpm -r build` | 第一枚包就 TS2307/TS2305 红（就是 §6.36 那一趟） |

于是落成 `209f7997`。为什么这一笔**是**本线该做的，而 §6.28 / §6.31 / §6.34 那些笔**不是**：

- 那些格子等的是"别人的**产品语义**还没落地"；这一格等的是"HEAD 自己引用了不存在的东西"——
  它不是别人没写完的功能，是**本线 `9fa53ab9` 造成的不自洽**（引用与消费方都进了 HEAD，实现留在工作树）。
  修自己造的裂口不在"别代拍别人"的那条线上。
- 另一头的理由也要写清：`packages/op-log/src/state.ts` 在 HEAD 上就已经是消费方，
  所以**回退方向**（把 index.ts 那些块摘掉）会删掉别人已入库的产品代码 —— 那不是更小的一步，是更坏的一步。
- 边界照旧守住：那三枚 `packages/shared-schema/tests/task-*.spec.ts` **没有**带进来（不是构建前提，
  留给作者按自己的节奏入库）；`auth-http-contract.ts` 只带 HEAD 缺的那 32 行（`git diff --stat` 逐枚对齐）。
- 可逆性：`git revert 209f7997` 一条命令回到现状态；提交信息里逐枚写了来源与 mtime，归属没有改写。

🔴 **还剩的一件事（本线不代拍，但记在这里）**：这一类"一句 docs 提交扫进整片工作树"已经不止一次
（§6.10、§6.26、本条）。而这一维**不是没有层判** —— `pnpm check` 里就有 `pnpm build`
（= `pnpm -r build`）和 `pnpm typecheck` 两步（现量命令只写在 §6.38 一处，免得抄两份漂一份）。
它十六小时一次没响的唯一理由是**每一次 `pnpm check` 都跑在那棵脏树上**：
在脏检出上"构建那一维"等于没判，而这比"缺一道门禁"更难防 —— 门禁在场、还全绿。
所以补的不是"再加一道构建"，而是**能把判据对准某一枚 ref** 的那把尺（见 §6.38）；
现量这型缺陷的范围（不依赖尺）：

```bash
git ls-files --others --exclude-standard -- packages | grep -E '\.ts$'   # 未跟踪的源码
git grep -hoE "from '\.[^']*'" HEAD -- packages | sort -u                # HEAD 引用了哪些相对模块
```

设备腿 r5（载体 pin = `209f7997`、被跟踪脏 = 0、三枚闸门脚本与主 HEAD 逐枚同 blob）
停在了第 4 步的窗口门：21:27–21:53 连续 14 趟全是 `REDS=load`（阈值 ≤12，那趟实测 17–27），
一次都没过，我把它停了。🔴 但**停它不只是因为负载** —— 那一枚 pin 本身就打不出包：
现量 `node scripts/check-imports-resolve.mjs --tree 209f7997 --sources-only` = **9 条构建输入缺失**，
而 `reinstall-all.sh --only ios` 的第 0 步正是 `pnpm -r build`。
⇒ r5 就算等到负载落下来也会在重装那一步红，而**那口红不是设备缺陷**，会被读成设备缺陷。
所以 r6 没有沿用 `209f7997`，改成对准 §6.39 那枚声明过的叠（`f1edde47`，同一问法读数 0 条）。

这 9 条的归属（现量，不是我推的）：它们全在 `packages/ui`、`apps/web`、`packages/app-host`，
其中 `./auth/PasswordStrength.js` 那一行是 `e6058120`（`docs(产品体验线 台账 §UX-S9-153)`，
10-09 14:35）加进 `packages/ui/src/index.ts` 的，而那两枚实现文件
`git merge-base --is-ancestor` 对 HEAD = **NO**、`git branch -a --contains` 列不出任何分支
⇒ **同一型第二次**，而且落笔的是**另一条线**、标题同样是 `docs(...)`。
复取：`git log --oneline -1 -S "'./auth/PasswordStrength.js'" -- packages/ui/src/index.ts`。


### 6.38 把这型缺陷变成一枚尺：`scripts/check-imports-resolve.mjs`（它现在量到多少条，只给现量命令）

§6.36 那一型（引用进了 HEAD、实现留在工作树）能藏十六小时，不是因为**没有层判它**：
`pnpm check` 里就有 `pnpm build`（= `pnpm -r build`）与 `pnpm typecheck` 两步，都判这一维，
但它们**每一次都跑在那棵脏树上**，于是每一次都绿。
死链检查只看 markdown 里可点的链接，`check:docs` 判的是链接目标存不存在 —— 那两把是真不判。
补的尺因此是"**能对准某一枚 ref** 的静态一条"：某一枚 ref 里每个源码文件的每个相对 import，
都必须解析到**同一枚 ref 里存在的文件**。
（现量：`git show HEAD:package.json | grep -o '"check": "[^"]*"' | grep -oE 'pnpm (build|typecheck|-r test)'`
⇒ 三个都命中，即构建与类型检查**都在 `check` 里**）

```bash
node scripts/check-imports-resolve.mjs                    # 默认 --tree HEAD
node scripts/check-imports-resolve.mjs --sources-only     # 只看构建输入（测试文件另算一档）
node scripts/check-imports-resolve.mjs --self-test        # 三臂：两红一绿
node scripts/check-imports-resolve.mjs --tree 9fa53ab9 --sources-only   # 事故本体的阳性对照
```

它自己得先证明能红，两件事分别做了：

| 证明 | 读数 |
|---|---|
| `--self-test` 多臂（内存夹具，不碰仓库；**臂数由它自己打印**）：引用未入库的实现 / 引用不存在的模块 / 合规形状（`.js` 后缀的 NodeNext 写法 + 目录 index）/ **判据字符串里那句 `from '…'`** / 真 import 但行尾注释带撇号 / 真 import 但行尾注释带 URL | 期望 红 / 红 / 绿 / **绿** / **红** / **红** ⇒ 10-09 22:3x 实得六臂全按期望（第 4 臂是下面那条假红的回归护栏，第 5、6 臂是它的反面 —— 挡"修过头把真 import 也吞掉"） |
| 事故本体当阳性对照：`--tree 9fa53ab9 --sources-only` | 🔴 7 条，其中 `packages/shared-schema/src/index.ts` 的四枚契约文件全在里面，**还多抓出两条我肉眼没找到的**（`./inbound-crypto-contract`、`server/src/automation/inbound.routes`） |

🔴 探针第一版有假红，形状很典型：注释里的示例（`apps/landing/src/site/pages.ts` 那段讲 Node ESM 解析的散文里
写着 `from './x.js'`）被当成 import，`../dist/index.js` 那类**构建产物**也被当成"实现没入库"。
⇒ 加了"剥块注释与整行 `//`、`*` 注释"与"`spec` 里含 `dist/` 就不算"两条，行数在剥注释后仍逐行对齐
（块注释按字符换成空格、保留换行），否则报出来的行号会指错地方。

**HEAD 现在的读数**（2026-10-09 22:4x 现量，命令 `node scripts/check-imports-resolve.mjs --tree HEAD`）：
**构建输入 9 条 + 测试文件 0 条**。构建输入那九条是：`packages/ui/src/index.ts` 引七枚组件（`StateIllustration`、`HabitArtwork`、
`HabitMetricIcon`、`PasswordStrength`、`LegalDocumentSheet`、`AssistantMark`、`AiGeneratedLabel`）、
`packages/app-host/src/inbound-process.ts` 引 `./task-batch-actions`、
`apps/web/src/features/settings/WidgetJourneyPanel.tsx` 引 `../../lib/native-widgets` ——
这十三枚（含它们各自的生成 JSON 与 model 文件）**都只在别人的工作树里**，mtime 从 10-07 19:29 到 10-09 10:43。

⇒ **结论：`209f7997` 只修好了第一条红**。HEAD 仍然打不出包，而这次不是本线的字节：
那七枚是 UI 那条线的、`task-batch-actions` 是入站那条线的、`native-widgets` 是 widget 那条线的。
**本线不代提这些**（§6.37 代提的是自己 `9fa53ab9` 造成的裂口；这三条是别人正在写的产品语义，
其中 `AiGeneratedLabel.tsx` 的 mtime 是今天 10:43）。各位的闭合动作是同一条：把自己的实现 `git add` 进来。

🔴 **上面那句"构建输入 9 条 + 测试 0 条"是对**上一笔提交里我写的那句的更正，而错因在**探针自己**：
第一版尺在 HEAD 上报的是 `9 + 12`，那 12 条"测试文件 import 了没入库的主体"**一条都不是 import** ——
它们是**源码文本型判据**，长这样：

```ts
expect(source).not.toContain("from './account/email-change'");   // server/tests/email-change-page.spec.ts:82
expect(EMAIL).toContain("from '../auth/session'");               // apps/mobile/tests/account-security-wiring.spec.ts:213
```

`SPEC_RE` 只认 `from '…'` 这个形状，分不出"这是一条 import"还是"这是一句被当字符串写下来的 import"。
后果不只是难看：那 12 条被我当成"HEAD 的 `pnpm -r test` 必红"写进了台账，
**如果我照它去"修"，就会去给别人的 spec 补根本不缺的文件**。
⇒ 修法在尺本身：命中处到行首之间的**未转义引号个数为奇数** ⇒ 它落在字符串字面量里 ⇒ 不算 import。
顺带把行尾 `//` 也剥掉（只剥前面不邻 `:` 的那两处，否则 `https://` 会被吃），
因为撇号（`// it's fine`）会让上面的配对判据把**真 import** 误杀 —— 这是**漏报**，比假红危险。
两半各有一臂钉住（上面那张表第 4 臂 / 第 5、6 臂）。
🟢 反面对照同时复量了一次：`--tree 9fa53ab9` 修后 = **构建 7 + 测试 2**，而那 2 条是**真的**
（`server/tests/integration/inbound-worker-identity.integration.spec.ts` 引 `../../src/automation/commit-proof`
与 `../../src/automation/inbound.routes`）⇒ 修过滤**没有把这一族病一起洗掉**。
（那两条属入站那条线、且住 `*.integration.spec.ts`，按 §5 第 8 条它本来就不在 `pnpm -r test` 的默认通道里。）

**为什么这枚尺先不接进 `pnpm check`**：接进去 = 立刻让别人那九条红挂在本线的提交上，
而本线没有办法替他们把它们变绿（§6.22 那条"扩射程会造出一屏假红"是同一件事）。
登记在 `scripts/check-gate-wiring.mjs` 的 `ALLOWED_UNREFERENCED_IMPL` 里，
消费方 = 本节与设备腿载体（下面那条）。等 `--sources-only` 在 HEAD 上报 0 条时接进链，判据口径不变。

### 6.39 设备腿 r6：载体身份是"HEAD + 13 枚声明过的在飞实现"，这一条写在读数旁边

纯 HEAD 打不出包 ⇒ 干净载体上设备腿不可能起跑。这一趟没有等别人，而是把"叠哪些未提交改动"**写成明账**
（记忆里那条"隔离载体叠哪些未提交改动是一个要明写的裁决"）：

- 载体 = `f1edde47` = main `a458abb1` + 13 枚文件（清单 `overlay-manifest-files.txt`，逐条 `git diff --name-only` 导出，
  不是手抄）；那枚提交住 `refs/tmp/heyta-headplus-account-1009`，**不在 `main` 上**，不替任何人决定落地；
- 造它用的是临时索引（`GIT_INDEX_FILE=… git read-tree <HEAD>` + 逐枚 `git add` + `write-tree` + `commit-tree`），
  共享索引从头到尾没被我碰过；
- 复取叠加集与校验叠加后自洽：
  `git diff --name-only a458abb1 f1edde47` 与 `node scripts/check-imports-resolve.mjs --tree f1edde47 --sources-only`（⇒ 绿）；
- 载体的被跟踪脏 = 0，三枚闸门/验收脚本与 main HEAD 逐枚同 blob，装依赖沿用 r4 的终态旗
  （叠加只加源码文件，没有依赖变动）；
- 🔴 因此 r6 那趟读数只能说"**HEAD + 这叠在飞代码**"，不能说"HEAD 已验"。
  步骤 11–14（会话那一块）在 HEAD 上仍是必红，理由见 §6.35 那张表；
  `CHAIN_RC` 的读法照 §6.32：0 = 全链成，3 = 环境无效，其余 = 产品或装置红。


### 6.40 设备腿 r6 的终局：窗口等满 60 分钟没开，按 `CHAIN_RC=3` 记成**环境无效**（22:56 现量）

这一节只把 r6 实际读到的东西写下来，并把它和"这一腿还欠什么"分开。

**r6 的载体身份**（写在读数旁边，按 §6.39 那条纪律）：

```bash
cat ~/.heyta-evidence/ios-account-email-1009-215612-r6/overlay-manifest-files.txt   # 13 枚，逐枚由 git diff --name-only 导出
node scripts/check-imports-resolve.mjs --tree f1edde47                              # ⇒ 绿（叠完自洽）
```

**窗口门那一档的读数**（`--target b`；阈值 = `hw.ncpu × 3/4`，那台机器 16 核 ⇒ 12）：

| 项 | 读数 |
|---|---|
| 起跑时刻 / 收尾时刻 | `chain.log` 首行 `21:55:42` ⇒ 末行 `22:56:08 CHAIN_RC=3` |
| 窗口门尝试次数 | **30**（`grep -c "窗口门 b rc=3" chain.log`），每趟间隔 120 s，全部 `REDS=load` |
| 最后一趟的负载读数 | `gate-b.log`：`现量：1 分钟负载 103，阈值 12（16 核）` |
| 有没有走到第 5 步（重打并装 iOS 端） | **没有**。第 4 步就没过 ⇒ 一次 `reinstall` 也没起过、一次设备验收也没跑过 |

⇒ 按 §6.32 那张 `CHAIN_RC` 读法表：`3` = **环境无效**。
这一趟**不记产品失败，也不记"验过"**，尤其**不许读成"步骤 11–14 是红的"** —— 那一步根本没起跑。
🔴 顺带把 §6.39 那句前瞻按这一趟的实测定住：它当时写"步骤 11–14（会话那一块）在 HEAD 上仍是必红"，
而 r6 连第 5 步都没走到 ⇒ **那句预测没有被检验，不许读成"已证实"**。
它仍然是一个由 §6.35 那张表支撑的**推断**（HEAD 上 `git grep -c "SessionsSection" HEAD -- apps/mobile/src/screens/SecurityScreen.tsx` 无匹配），
但推断不是读数。
（负载是并行会话把自己的链堆出来的：同一时刻 `vm.loadavg` 我看到 40 → 46 → 103，而我这一趟全程没起被测进程。）

**这一趟真正取到的东西不在设备侧**，是它把两把我自己的尺逼出来并当场更正了：

1. §6.37 那句关于 r5 的话先前写错了（"已按修好的 pin 重投"），现在按 `chain.log` 与 `gate-b.log` 的原文更正，
   并补了一条**归因**：`--tree 209f7997 --sources-only` = 9 条构建输入缺失 ⇒ r5 就算等到负载也会红在重装第 0 步，
   而那口红不是设备缺陷；这 9 条现量属于另外三条线（其中 `./auth/PasswordStrength.js` 那行由 `e6058120` 带进来）。
2. §6.38 的 HEAD 读数从 `9 + 12` 更正成 `9 + 0` —— 那 12 条是**探针自己造的假红**
   （判据字符串里那句 `from './x'` 被当成了 import），修在尺里并补了两向臂（`e8d780c6`）。
3. 这两型各入一枚环境陷阱：**#398**（门禁跑在错的树上）、**#399**（扫描器认错了语句）。

**这一腿欠的只有一件事**：一个负载落得下来的窗口。复现命令与前置（三个条件要**同时**成立）：

```bash
# 载体必须先钉到一枚"打得出包"的 ref：要么等别人那 9 枚实现落进 main，要么再叠一枚声明过的载叠（§6.39）
node scripts/check-imports-resolve.mjs --tree <要用的 ref> --sources-only    # ⇒ 必须报 0 条
sysctl -n vm.loadavg                                                        # ⇒ 1 分钟负载要 ≤12
git status --porcelain -- apps packages server | grep -cE '^ ?M'             # 别人在飞的源码（挡"装的是不是当前产物"那条对账）
bash ~/.heyta-window-rigs/heyta-ios-account-chain.sh ~/.heyta-evidence/<新戳>-r7 "$PWD/.worktrees/iosacct" "$PWD"
```

⚠️ 不写成"等明天就好了"：`--target b` 这一档在并行会话密集时段本来就够不着（今晚 30 趟、负载最高 103）。
任务 #15 的闭合判据仍是 §6.28 / §6.35 那两行现量命令 **加** 一趟真的走到第 5、6 步的读数；
在那之前这一格的状态是"**设备腿未取数**"，不是"验过但没验好"。

### 6.41 Web 那半的挂载落到了 HEAD（换绑挂 `ProfilePanel`、会话挂 `App.tsx`），并当场避开一张重复面板

先说这一格先前被记成什么：§6.18 / §6.35 一直写"web 那一半等 `App.tsx` 落地后一次提交"。
现量否证了"只能等"这一半 —— **等的是别人的 hunk，不是我的入口**：

| 问法 | 命令 | 读数 |
|---|---|---|
| 那块真浏览器判据在不在 HEAD | `git ls-files --error-unmatch e2e/tests/account-email-change-and-sessions.spec.ts` | 在册 |
| 它断言的两块面板在不在 HEAD | `git grep -c -F "email-change-panel" HEAD -- apps/web/src`（同问法换 `sessions-panel` / `password-panel`） | 前两个 **无匹配**；`password-panel` ⇒ `PasswordPanel.tsx:1` 这一条是**对照臂**（同一个问法量得出在册的那枚，说明尺没坏） |
| 所以 HEAD 上那一族用例的形状 | —— | **不是"某条断言红"，是"界面里根本没有那两个东西"** —— 一道已入库的判据红在产品没入库上，就是 §6.36 那一型换到 e2e 层 |

**闭合动作不是"等 `App.tsx`"，是把 13 枚自洽的东西一次落完**：
8 枚面板/store（`EmailChangePanel`、`SessionsPanel`、`SettingsAccountGate`、`SettingsNotice`、`SignOutNotice`、
`emailChangeStore`、`sessionsStore`、`signOutStore`）+ 2 枚样式（`settings-notice.css`、
`styles/app/settings-account.css`）+ 3 处 hunk（`App.tsx` 会话挂载、`ProfilePanel.tsx` 换绑挂载、`app.css` 那行 `@import`）。
入库那一笔是 `3dd210bd`（13 枚路径 +1452/−0，纯新增）。判据那枚 `account-security.spec.tsx`（41 条）
与 6 张真浏览器图随后落进 `23a3a24b` —— 它当初"不能单独入库"的理由（§6.31）随挂载那笔消失。

🔴 **中途差点造出一张重复面板，靠的是"先查这块 UI 现在挂在谁身上"**：
第一版把两块面板都往 `App.tsx` 挂。现量工作树：换绑挂在 `ProfilePanel.tsx`（就在"当前邮箱"那一行下面），
只有会话挂在 `App.tsx`。照第一版落地 ⇒ 别人那笔一落，设置页会出现**两张换绑面板**，
而 `check:ui-language` / `check:design` / typecheck **三道都不会响**。
⇒ 落点改成与 theirs 同一处：他们落地时是**覆盖同一行**，不是并列第二份。
这条预测当场有了读数：他们那版 `App.tsx` 现在带着 `<SessionsPanel active={…} />`
（现量：`grep -n 'SessionsPanel' apps/web/src/App.tsx`），没有把我的行当"多出来的改动"删掉。

**落地前验的三件事**（都在隔离载体 `.worktrees/iosacct` 上对着候选树做，不是对着工作树；
候选树 `845e81c9` = 当时的 HEAD + 那 13 枚在飞构建输入 + 我这一笔的 13 枚。
⚠️ 早先那版候选 `9c1dafa1` 作废：它钉在 `f1edde47` 上，而 HEAD 在它之后又动了，重建成 `845e81c9` 才是"落完这一笔之后 HEAD 长什么样"）：

| 验什么 | 命令 | 读数 |
|---|---|---|
| 这棵树的相对 import 全解析（没有"引用在册、实现不在册"） | `node scripts/check-imports-resolve.mjs --tree 845e81c9 --sources-only` | ✅ 全解析 |
| 我这 13 枚路径有没有类型错误 | 一份临时 `apps/web/tsconfig.mountcheck.json`（把 `@heyta/ui` / `app-host` / `i18n` / `design-system` 四条 `paths` 指到**源码**，因为那几枚包的 `dist` 里根本没有 `.d.ts`）+ `tsc -p` | **基线臂（同一棵树去掉我这 13 枚）68 条 / 挂载臂 68 条，两份错误集合逐字相同**（`diff <(sort 基线) <(sort 挂载)` 空），我这 13 枚里 **0 条**。那 68 条全在 `@heyta/widget-core`、`@heyta/inbound-core` 两枚不在这棵树上的包与 `packages/ui/src/index.ts` 那 5 个缺失具名导出里 |
| 这两臂有没有牙 | 两趟变异：`sessionsStore.ts` 的 `listHostedSessions` 改成不存在的名字 ⇒ 我的文件多 2 条；`SessionsPanel.tsx` 一个词条 key 改成 `common.sessionZ.title` ⇒ 多 1 条 TS2345（`t()` 的参数是 3950 个 key 的并集）。两趟都从 `.mut-bak` 还原并 `cmp -s` 过 | 变异进得来、还原得回去 |
| 中英词条 | 上面那条 TS2345 就是编译级核对（比 §6.15 那次逐枚 grep 更强）；两侧表的集合对账在 `packages/i18n` 自己的测试里 | 0 缺 |
| 三道静态门 | `node design-system/heyta/check-hardcoded.mjs`、`node scripts/check-md-table-rows.mjs`、`node scripts/check-ui-language.mjs`、`node scripts/check-layering.mjs` | design **rc=0**（扫 500 枚源文件含我这 3 枚新样式）、md-tables **rc=0**；ui-language 与 layering **红**，但**基线臂输出逐字相同**（两份 log `diff` 空）⇒ 红的是价格词条三处不一致与别处就地拼 op，属另外的线 |

⚠️ 三条边界，不包装成完成：
1. **图先于这笔**：那 6 张截图是 14:2x 在主检出的工作树上取的（那时那三处 hunk 还没入库），
   所以图里的设置面 IA 是并行会话那一版（rail 里"账号与安全"那一格）。挂载**落点**与入库那份相同
   （两处各两行：`import` 与 JSX；注释的措辞他们压过一行 —— §6.41 末那条撤回写清了）。
   🔴 "在干净检出上重跑一趟这一族 e2e"这一格**没做**，而且挡它的原因**不是**"装不起 `e2e/` 的依赖"
   （现量否证：`test -d e2e/node_modules` 成立，`e2e/node_modules/.bin/playwright` 在）。
   真正的三条前置，逐条都是现量而不是印象：
   ① 那枚 spec 把图写进 `apps/web/evidence/account-suite/`（`const EVIDENCE = …account-suite`，
      现量：`grep -n EVIDENCE e2e/tests/account-email-change-and-sessions.spec.ts`）——
      也就是**重跑会改写刚提交的 11 枚受版本控制的图**，这正是产品体验线那条还开着的
      "整族 e2e 会改写已跟踪证据"；跑之前要先定"图落哪、要不要把改写后的入库"。
   ② 它的 `webServer` 是 `vite --port 4318 --strictPort` + `stub-provider.mjs`（4319），
      而 `check:ai-e2e` 的 preflight 按这两个端口 SIGKILL。现量：4318/4319 此刻空闲，
      但本机有**别人会话**起了 7–8 小时的 vite dev（pid 55973 在 4383、pid 59513 在主检出，在 4379）
      —— 那一族用的是槽位端口，下一次槽位轮到我的窗口就会撞上他们的清理。
      按 §8.9"共享资源独占验收"，不协调好不开跑。
   ③ 读数只能是"HEAD + 那叠在飞代码"，不是干净 HEAD —— 主检出的 `App.tsx` / `ProfilePanel.tsx`
      仍是 ` M`（现量：`git status --porcelain -- apps/web/src/App.tsx`）。
2. `main` 这一笔之后**仍然打不出包**，因为别人那 13 枚构建输入还没落（§6.38 现量命令）——它没让它变好也没让它变坏；
   候选树之所以能构建，是因为它叠了那 13 枚。⚠️ 这一格产品体验线正在做（`41d10423` / `61126d7d` / `0f74c0c2`
   三笔都在同一格上），**归属在他们那边**，本线只留现量命令不重复修。
3. `SessionsPanel` / `EmailChangePanel` 那条 `active` 属性在这一笔里**没有传**（HEAD 还没有分组目录那个变量），
   默认值 `true` 等于"总是活跃"。别人那笔一落就会带上 `active={…}` —— 这是 §7 第 195 条那种
   "默认值会把宿主没接伪装成做完了"，所以写在这里而不是藏在代码注释里。

📌 一处要撤回的措辞（写在我自己的提交信息里，改在台账而不是改写历史）：
`23a3a24b` 的信息写了"挂载行与入库的那份逐字相同"，并给了一条支撑不住它的命令。
现量是 `grep -n SessionsPanel` 在 HEAD 那份 4 处、在他们工作树那份 3 处 ——
差的那一处是我那三行注释里的一句（他们把它压成了一行）。**挂载的两行（import 与 JSX）两边都在**，
"逐字相同"这四个字说过头了。判据同 §6.38 那一型：**引用一条命令时，它打印的东西必须能撑起紧跟它的那句结论**。

### 6.42 🔴 HEAD 上有一枚文件 parse 不过，是**本线昨天那笔**造成的：`hosted-auth.ts` 少了三行声明

发现它不是靠 `pnpm check`（它跑在脏树上，见 §6.38），也不是靠 §6.38 那枚 import 尺
（那三行是**声明**不是**引用**，尺只会说"每个 import 都解析得到"然后报绿）。
它是上一节那把临时 tsconfig 的副产品：`paths` 指对之后错误从 **697 条掉到 22 条**，
而 22 条**全在同一枚文件**里，且全是 `TS1109 / TS1005 / TS1128` 这种**语法**码 —— 语法码成堆出现
意味着 parse 失败，不是类型不匹配。文件：`packages/app-host/src/hosted-auth.ts`。

根因逐字可查：`git show 469408c4 -- packages/app-host/src/hosted-auth.ts` 的那个 hunk
`@@ -438,10 +473,7 @@` 与 `@@ -628,7 +673,6 @@` 删了 **5 行**，其中三行是声明：

```
export type PostResult = { ok: true; body: unknown } | HostedAuthFailure;
export const failure = (          ← 同文件 100+ 处调用它
export async function sendJson(   ← 同一笔带进来的 account-security.ts 从 './hosted-auth.js' import 它
```

**`-` 行没有配对的 `+` 行**，而调用点与返回类型标注全留着 —— 于是整枚文件 parse 不过，
`@heyta/app-host` 这一层编译不了，所有依赖它的包连编译都到不了。
那两行本来是要改成 `export` 的（工作树里别人那份就是 `export const failure` / `export async function sendJson`），
补丁只落了删除那一半。⇒ 这一型与 §6.36 / §6.37 是同一个动作（hunk 级入库）的第三种失效面，
入档为 **§7 第 400 条**。

修法与取证（`63e3fbbd`，只补那三行，`+3/−0`）：

| 判据 | 命令 | 读数 |
|---|---|---|
| 整棵 HEAD 有没有第二枚这样的文件 | `node research/tools/parse-sweep-ts.mjs d1704811`（在隔离副本里 checkout 到那枚再跑） | **扫 1823 枚，parse-broken = 1**，就是这一枚。这条 sweep 同时是它自己的阳性对照（它抓到的正是已知那一枚） |
| 补完能不能 parse | `git show HEAD:packages/app-host/src/hosted-auth.ts \| apps/web/node_modules/.bin/esbuild --loader=ts` | 修前 `✘ Unexpected ":"` rc=1 → 修后 **rc=0** |
| 🔴 **这一枚修好的是不是真判据**（前后各一趟，同一份 spec、同一台载体） | `packages/app-host` 里 `vitest run tests/account-security.spec.ts` | 修前那棵树（`d1704811`）⇒ **`Transform failed … [PARSE_ERROR] Unexpected token`，1 file failed，`no tests`，rc=1** —— 一个用例都没跑到；修后那棵树（`845e81c9`）⇒ **49 passed (49)**，rc=0。⇒ 症状不是"某条断言红"，是**那 49 条判据整枚不存在** |
| 整包在修后的形状 | `packages/app-host` 里 `vitest run` | **1506 passed / 0 failed**，另有 **14 枚文件加载不了** —— 逐枚看原因全是 `Failed to resolve entry for package "@heyta/widget-core"` / `"@heyta/inbound-core"`（两枚不在这棵树上的包，注册自动化与小组件那两条线的在飞件）与 vault/calendar/ai 那几枚同源缺口。**这 14 枚不是本线欠项**，复取：`grep -E '^ FAIL' <那份 log>` |
| 有没有动别人在这枚文件上的在飞改动 | `git hash-object <工作树那份>` 落地前后各一次 | 两次同一个 sha（`11eaea7b…`），`git status` 从 `MM` 回到 ` M` ⇒ 他们那 40 行改动逐字节还在，**没有**被我的 blob 顶掉 |
| 落地只 staged 我自己 | `git diff --cached --name-only`（提交前后各一次） | 恰好 1 枚路径，`--numstat` = `3 0` |

⚠️ 三条没包装成完成的边界：
1. **sweep 做成了可复跑的一次性装置，但没升成门禁**。装置：`research/tools/parse-sweep-ts.mjs`
   （`node research/tools/parse-sweep-ts.mjs [ref]`，ref 默认 `HEAD`；它先比"要扫的 ref"与"工作树的 HEAD"，
   不一致就**拒绝跑**并以 2 退出 —— 因为它是读工作树的字节，ref 与工作树不一致时读数不是那棵树的）。
   三臂读数：修前那棵 `d1704811` ⇒ `parse-broken = 1` 且 rc=1（**阳性对照**，它抓到的正是已知那一枚）；
   挂载候选 `845e81c9` ⇒ `1842 枚 / 0 条` rc=0；ref 与工作树不一致那一臂 ⇒ rc=2。
   为什么不进 `pnpm check`：这一格 `pnpm -r typecheck` 本来就该抓到，它抓不到的唯一理由是链在更上游就断了
   （§6.38 那 9 枚）。要加就得连"排在第几步、非 TS 文件怎么办、与 typecheck 的分工"一起拍 ——
   那是**判据口径**，不是本线能代拍的。留在这里是"能复跑的读数"，不是"已生效的门"。
2. `pnpm -r typecheck` 在**干净 HEAD** 上仍然到不了 `app-host` 之后的那些包（`packages/ui` 先红），
   所以"HEAD 现在能编译"这句**没有**取到，只取到了"这枚文件 parse 得过"。
3. 归因写清楚：`469408c4` 是**本线**那笔（`feat(账号标准套件 共享层一笔)`），不是并行会话。
   修它的这笔也归本线。别人工作树里那份带导出注释的版本落地时会**覆盖同一行**，与 §6.41 那个落点是同一条规矩。

### 6.43 移动端那 4 条红在干净 main 上现量到了；当场关掉一条真类型红，剩下的写明为什么不能手搬

**先说怎么发现的**：不是跑出来的，是**换了载体才看见的**。之前所有"移动端验过"的读数都来自主检出
（脏树）。这一轮为了拿编译级判据，把两份把 `@heyta/*` 指到**源码**的临时 tsconfig 正式落进仓库：
`apps/web/tsconfig.mountcheck.json` 与 `apps/mobile/tsconfig.mountcheck.json`（用法：
`cd apps/<web|mobile> && ./node_modules/.bin/tsc -p tsconfig.mountcheck.json`）。
它们存在的理由是**当前唯一能跑的编译级尺**：`pnpm -r typecheck` 在干净 main 上先死在
`packages/ui` 的 dist（§6.38 那几枚），根本到不了这两枚 app。四枚读数（同一台机器、同一批源码）：

| 臂 | `apps/web` | `apps/mobile` |
|---|---|---|
| 干净 main（隔离副本 detached 在 `1b14b3e0`） | 69 条（**app 里 10 条**，全是引用不到在飞实现：`native-widgets` / `@heyta/widget-core`…） | 76 条（**app 里 1 条**：`src/ui/habit-icon-slot.tsx` 要的 `HABIT_GLYPHS` 那枚导出不在 `@heyta/ui` —— 归习惯/图标那条线） |
| 主检出工作树（叠着所有在飞改动） | **0 条** | **0 条** |

⇒ "app 侧一行都不错"这件事**只有在工作树里成立**。这一格与 §6.38 是同一句话的两侧：
在飞的代码是对的，落地的代码缺一块。

**那 4 条红**（`cd apps/mobile && vitest run tests/account-security-wiring.spec.ts`，干净 main ⇒ **4 failed / 15 passed**）：

| 红的断言 | 它要的主体在哪 | 本线能不能自己搬 |
|---|---|---|
| `SECURITY` 不出现 `readSyncConfig(` | 在 `SecurityScreen.tsx` 未提交的那 +369/−63 里 | 见下 |
| import 了 `beginPasskeyEnrollment` / `completePasskeyEnrollment` | 同一枚文件的同一批 hunk（`git grep -l beginPasskeyEnrollment HEAD -- apps/mobile/src` ⇒ **空**） | 同上 |
| 平台那一步只用 `auth/passkey-host.ts`，且探测在发请求之前 | 同上（`resolvePasskeyProvider` 在 HEAD 的 `SecurityScreen.tsx` 里**只出现在注释**，而这份判据先 `stripComments`） | 同上 |
| 两条退出出口接到 `ProfileScreen` 的清理编排上 | `ProfileScreen.tsx` 未提交 diff 的 `950-953` / `1309-1312` 两处 | 见下 |

🔴 归属这一次要写准，因为**它和台账原先记的不是一回事**。§6.28 / §6.35 记的是"这两枚文件正被并行会话整片重写"。
现量把这句话拆成两半：`SecurityScreen.tsx` 那批 hunk 里**加/删行的标识符集合只有账号套件的**
（`SessionsSection` / `beginPasskeyEnrollment` / `submitRecovery` / `onSignedOutEverywhere` / `readSyncConfig`，
而习惯·日历·倒数·小组件·assistant 这些别线词命中 **0**）⇒ 那 369 行是**本线自己写好没提交的**，不是别人在写。
`ProfileScreen.tsx` 那批则**确实是混的**（同一枚 diff 里加了 `widgetCleanupRetrying` / `widgetCleanupPending` /
`assistant` / `countdown` 等 5+3+3+1 处别线标识符，30 个 hunk）。

**为什么不能手搬**（这是本轮唯一"看起来能做、量完决定不做"的一格）：
只落 `SecurityScreen` 一枚，编译级判据给出**恰好 1 条新错** ——
`src/screens/ProfileScreen.tsx(823,8): TS2739 … missing … baseUrl, token, onSignOutCurrentDevice, onSignedOutEverywhere`
（两臂同一台载体：基线 76 条 / 加这枚 77 条，差集就这一行）。
也就是这两枚文件是**一个原子改动**，而其中一枚的 diff 挑不出干净的账号子集：
手挑出来的 `ProfileScreen` 会是"既不是 HEAD 也不是他们那版"的**第三份**，
下一笔整片提交要么覆盖它要么和它冲突。⇒ 把没编译验过的东西落到 HEAD 正是 §6.42 / 第 400 条那一型，
本线刚为它写过教训，不再犯一次。**这一格只能整片落**（本线那 369 行 + 那两处 `ProfileScreen` hunk 一起），
而"整片"里含别线的字节 ⇒ 要么那条线自己把账号 hunk 带上，要么等 `ProfileScreen` 那批别线改动落地后本线重打一次。

✅ **当场关掉的一条**：`1b14b3e0` 给 `apps/mobile/src/ui/kit.tsx` 的 `TextField.keyboard` 联合加上
`'email-address'`。它不是"顺手改别人"：`EmailChangeSection.tsx:298`（**已入库的本线界面**）写的就是
`keyboard="email-address"`，而 HEAD 的联合只有 `'default' | 'url'` ⇒ 干净 main 上 `apps/mobile`
本来就有一条 TS2322（现量：`src/screens/EmailChangeSection.tsx(298,9)`，加完这一笔后**读数 0**）。
一个联合成员、纯类型层、运行时 `keyboardType={keyboard}` 逐字不变，且与并行会话工作树里那一行
**文本逐字相同**（只有行号差 51）⇒ 他们落地时覆盖同一行。
落法用临时索引 `read-tree main` + `update-index` + `commit-tree` + `update-ref … <旧值>`：
**当时共享索引里有别人 staged 的 `BLOCKED.md` / `PROGRESS.md`**（现量：`git diff --cached --numstat` 三行），
裸 `git commit` 会把他们那两枚的暂存态一起带走 —— 这一型下**不能**用裸提。

复取这一格还开着的判据：

```bash
cd .worktrees/<一棵 detached 在 main 的副本>/apps/mobile
./node_modules/.bin/vitest run tests/account-security-wiring.spec.ts   # 4 failed / 15 passed = 还开着
git diff --numstat HEAD -- apps/mobile/src/screens/ProfileScreen.tsx    # 别线字节还在里面 = 还不能整片落
git grep -c "onSignOutCurrentDevice" HEAD -- apps/mobile/src/screens/ProfileScreen.tsx   # 0 = 那处 hunk 没落
```

⚠️ **这三条读数已经在 10-09 16:3x 换相了**（那一格由 §6.44 那笔关掉）：现在跑它们得到的是
`19 passed`、`git grep -c … = 1`。留着这段是因为它记录的是"**为什么当时不能手搬**"那套判据，
不是当前的状态；当前状态一律读 §6.44。

### 6.44 移动端那一格整片落了：`bf9426d0` —— 两枚文件一次落，四道判据逐条现量

先说这一笔落的是**什么形状**，因为它决定下一个读这段的人能不能照做：

| 问法 | 命令 | 读数 |
|---|---|---|
| 这一笔到底动了哪几枚文件 | `git diff-tree -r --name-only 9e02933d bf9426d0` | 恰好两枚：`SecurityScreen.tsx`、`ProfileScreen.tsx` |
| `ProfileScreen` 里进了多少别线字节 | `git diff --numstat 9e02933d bf9426d0 -- …/ProfileScreen.tsx` | `103 0` —— **零删除**，只有我那一处加法 |
| 那 103 行是不是工作树那枚的子集（决定别人落地时是覆盖还是并列第二份） | 逐行取 `git diff -U0` 的 `+` 行，问它在不在工作树版本里 | **103 / 103 逐字命中，缺失 0 行** ⇒ 他们那笔一落是**盖在同一批行上**，不会长出第二份退出编排（§6.41 那把判别尺在这里同样成立） |

`ProfileScreen.tsx` 那 103 行是**我自己写的最小 hunk**（不是从工作树那枚 30 hunk 的版本里搬的）：
五个唯一锚点各命中 1 次 —— ① `../auth/session` 那行 import 之后加 `../auth/sign-out-flow`；
② `setSecurityOpen` 那个函数之后加两条退出出口的状态与三个回调；
③ `<SecurityScreen` 之后补 `baseUrl={form.serverUrl}` 与 `token={form.token}`；
④ `onPasswordChanged` 那个闭包之后补 `onSignOutCurrentDevice` / `onSignedOutEverywhere`；
⑤ 账号那颗按钮之后、`<SettingsRow row={settingsRow} />` 之前插"还没撤成 / 已退出所有设备"两张卡。

为什么②③④⑤必须同时在场 —— 这就是 §6.43 说的原子性：只落 `SecurityScreen.tsx` 会让
`ProfileScreen` 少四枚必填 props，编译级判据当场给出恰好一条 `TS2739`（当刻现量取到过）。

**证据四条，全部在同一棵隔离载体（`.worktrees/iosacct`）上两臂对跑**：

1. **编译级**：`tsc -p apps/mobile/tsconfig.mountcheck.json --noEmit` 的错误行排序后取双向差集：
   基线臂（干净 `a1d9eb60`）**76 条**，候选臂**76 条**，`comm -13` 与 `comm -23` **都是空**；
   而那 76 条全落在 `packages/*`（`grep "screens/SecurityScreen\|screens/ProfileScreen"` 命中 0）
   ⇒ 本笔对类型面**净贡献 0**。
   尺有牙：摘掉 `token={form.token}` 那一行 ⇒ `error TS2741: Property 'token' is missing…` 精确指到那枚 props；
   还原走 `src/screens/ProfileScreen.tsx.mut-bak`，`cmp -s` 对过与候选**逐字相同**。
2. **接线判据**：`account-security-wiring.spec.ts` 基线 `4 failed | 15 passed` → 候选 **`19 passed`**。
   摘掉 `onSignedOutEverywhere` 那条 prop ⇒ **恰好 1 条红**（不是整片红，说明那四条各钉各的）。
3. **整族不回归**：`vitest run`（`apps/mobile` 全量）基线 `55 failed | 502 passed` → 候选
   `51 failed | 506 passed`；把两臂的失败用例名排序做差集，**候选 − 基线 = 空**，
   基线 − 候选 = 恰好那 4 条 ⇒ 剩下的 51 条红**一条都不是本笔带来的**（它们是别线没落的实现与缺依赖）。
4. **静态门**：`check:mobile-settings` rc=0（那张卡进的是「我的」常驻区，不是凭据表单，
   所以没有撞"表单不许进滚动流"那条），`check:rn-aria` rc=0；
   `check:layering` / `check:ui-language` 两臂输出用 `cmp` 比过**逐字相同** ⇒ 与本笔无关。
   词条：这两枚文件用到 109 枚键，对 HEAD 中英两份表逐枚比 ⇒ **zh 缺 0 / en 缺 0**。

🔴 **顺带现量到、且必须让下一位知道的一条**：HEAD 上 `pnpm check` 现在**不会全绿**，红的两道不在本线：

| 门 | 命中 | 归属 |
|---|---|---|
| `check:layering` | `apps/web/src/features/share/share-key-store.ts:56` 在 `apps/*` 里就地拼 op | 那条共享层/后台那一线（最近碰那枚文件的是 `e6058120`，产品体验线那笔） |
| `check:ui-language` | 价格 SSOT 三处不一致：`server/src/billing/price-book.ts` 的 `SKU_GRANTS` = `[ai, hosting]`，而 `docs/reference/pricing-and-entitlements.md` = `[ai, automation, hosting]`；另有 `web.ai.settings.localApi.source.file` 那条"zh 里没有汉字" | `automation` 那一档由 `7350e309`（自动收集线权益判定定案）写进价格表。这不是抄错数字：它判的是**对外承诺哪组能力**，按口径要负责人拍，且与本线无关 ⇒ 不代改，只登记 |

复取这两道红的现量命令（都在干净载体上跑，别在主检出跑 —— 那里工作树是别人的）：

```bash
node scripts/check-layering.mjs        # rc=1，指向 share-key-store.ts:56
node scripts/check-ui-language.mjs     # rc=1，指向价格 SSOT 那条
```

**落法**：临时索引 `read-tree <tip>` + 两枚 `update-index` + `write-tree` + `commit-tree` +
`update-ref refs/heads/main <新> <旧>`。那条**旧值守卫真的拦下了一次**：
`update_ref failed … is at 9e02933d but expected a1d9eb60` —— 并行会话在我取数期间落了一笔
只动 `docs/plans/product-ux-optimization.md` 的文档笔。守卫的作用不是仪式：
落笔前重取了一次那两枚文件在两个 ref 上的 blob（`ad17a925` / `3ffe25c2` **两侧逐字相同**）
⇒ 那份 A/B 读数描述的就是落地面内容，取数臂不必重跑。
落完刷新了共享索引里我那两枚（`update-index --cacheinfo`），否则下一位的裸 `git commit`
会拿旧索引把我的 hunk 倒回去。

🔴 **那次刷新十分钟内被倒回去了一次，形状正是上面说的那种**（现量：`git diff --cached --numstat`
给出 `0 103 ProfileScreen.tsx` + `63 369 SecurityScreen.tsx` —— 索引里躺的是 `ad17a925` / `3ffe25c2`
即落地面之前那两枚 blob，而 HEAD 里是 `6c8a5fcd` / `eec92b1b`）。谁刷的没查（那一档正是并行会话在
落他们那三笔的时候），但**只要有人在那段时间裸 `git commit` 一次，本笔就被静默撤掉，而且门禁不会响**。
对策写成可复取的两句：落完立刻刷；**下一笔落地前再取一次** `git diff --cached --numstat -- <我的路径>`，
非空就再刷。这条不是"洁癖"，是本线在 §6.42 刚写过的那一型（一道已入库的判据红在产品没入库上）
的反面：一次已入库的落地红在索引被倒回上。

**这一格关掉之后仍然开着的两件事**（不许读成"移动端全做完了"）：
1. **设备腿那一趟读数**：界面在 HEAD 上了，但"真模拟器上点得到这四格 + 退出这台/退出所有"
   还没取过 —— 前置三个（能构建的载体 ref、没人占的模拟器窗口、1 分钟负载 ≤12）见 §6.40。
2. **HEAD 整仓仍然打不出包**（§6.38 那 9 枚构建输入）—— 本笔没让它变好也没让它变坏；
   上面那条"编译级 = 0 新增错误"用的是 mountcheck 那把尺（源码映射，绕开 `packages/ui` 的 dist），
   它**不是** `pnpm -r build`，不要把两者读成一回事。

### 6.45 剩下四格逐格现量：三格的"做不了"各有不同类的理由，一格是 HEAD 级红（不归本线）

§6.44 关掉移动端那一格之后，把还开着的四格逐格取了一遍现量（10-09 16:4x，全部在
干净载体 `.worktrees/iosacct` 与主检出上跑过，不是回忆）。

| 格 | 现量 | 为什么这一轮没做 |
|---|---|---|
| 帮助中心那六枚孤儿键（`site.docs.account.s6`/`.s7`、`site.help.q/a.rebind`、`site.help.q/a.sessions`） | HEAD 中英两侧**都在**（逐枚 `git show HEAD:packages/i18n/src/locales/zh-CN.ts \| grep -c` = 1）；注册表命中 **0**（`git grep -c <键> HEAD -- apps/landing/src/site` 全 0）⇒ 词条在册、页面渲染不到 | ⚠️ **这一格在同一轮里被拆开并落了一半**（下面这段是当时的形状，留着是为了看清判据怎么换的）：挂载确实极薄（`content.ts` 两行问答对 + `docs.ts` 两节），但 `gen-entries.mjs:178` 会把 `HELP_QUESTIONS` 灌进 `/help` 页的 `FAQPage` JSON-LD。**先量哪一半改生成物**：`docs.ts` 那两节**不改**（两臂各跑一次生成器，中英全部产物 `diff -rq` 逐字节相同）⇒ 已落 `da5c7f52`；`content.ts` 那两行**会改**，而现量证明那 30 枚 HTML 里的一枚与"从 HEAD 真源重生成"的结果 `cmp` **逐字节相同** ⇒ 并行会话正在落的那批**就是** `check:entries` 的修法本身，我不落第二份。四格全过程与逐条读数在 §6.47 |
| 移动端「忘记密码？」入口 | HEAD 的 `apps/mobile` 里 `forgotPassword` 命中 **0**；工作树版本有（`requestPasswordReset` 导入 + handler + 那条 `Pressable`，共 8 行） | 那 8 行**不是自洽的**：它调 `beginAuthAction` / `isCurrentAuthAction` / `enterSession`，三枚 helper 只在未提交版本里定义（`AuthScreen.tsx:242-250`），HEAD 命中 **0**。手挑我这半 ⇒ 发的是一份**没有竞态守卫**的弱版本；把 helper 抬过去 ⇒ 抬的是别人的活。两条都是 §6.28 那棵"谁都不有的树"，本线刚为同一型写过教训（§6.42 / 第 400 条）。他们那笔一落，我这半自动跟着落 |
| `pnpm check` 在 HEAD 上不全绿：`check:entries` | 干净载体上 `node apps/landing/scripts/gen-entries.mjs --check` ⇒ **rc=1，32 枚已跟踪 HTML 不一致（130 插 / 130 删）**。性质：`-` 侧（已入库的 HTML）是**新话**，`+` 侧（从 HEAD 真源生成）是**旧话** —— 例如 account 页入库的是"…那同步要用的访问令牌是从哪来的"，而 HEAD 的 `site.docs.account.sum` 是"注册账号，选择登录方式，管理访问凭据。" | 🔴 **这条不在本线**：那句长的 SEO 描述**本来就在真源里**（`ed9ee2d0` 09-30 进 `packages/i18n`），是 `e6058120`（10-09 14:35，产品体验线那笔，`zh-CN.ts` 864 行）把它换成了短的那句，**却没重跑生成器** —— 而 HTML 里那句长描述是 `f82ace65`（10-02）生成的（`git log -S"<长句>" -- apps/landing/docs/account/index.html` 只命中那一笔），换话之后没人再生成 ⇒ HTML 留的是换话**之前**的句子。⇒ 修法是一条命令（`pnpm --filter @heyta/landing gen:entries` 再提交），但那改的是**对外 SEO 文案**且他们那批已在飞（上面那 30 枚 ` M`），按"对外口径不代改"只登记 |
| 浏览器腿 / 设备腿 | 现量：1 分钟负载 **26.9** / 16 核（§6.40 那条阈值是 ≤12），`vm_stat` 的 free+speculative **0.3 G** / 64 G；`check-imports-resolve --sources-only` 仍报 `packages/ui/src/index.ts` 那批构建输入解析不到；载体里 `e2e/node_modules` 不存在 | 两个**环境**挡着（负载与内存），不是产品也不是判据 —— 在这种余量上起 Chromium + vite dev 只会同时得到掺假的读数和一次内存弹窗。`e2e` 那份 lockfile 要单独装（它刻意不在根工作区内），装它要 registry 通道。复取：见下面那三条命令，任一条回到阈值内就重起那一趟 |

复取这四格的命令，逐条能跑：

```bash
# ① 孤儿键：词条在不在 + 注册表挂没挂
git show HEAD:packages/i18n/src/locales/zh-CN.ts | grep -c "'site.help.q.rebind'"
git grep -c "site.help.q.rebind" HEAD -- apps/landing/src/site        # 0 = 还没挂
# ② 忘记密码那 8 行依赖的 helper 落没落
git grep -c "beginAuthAction" HEAD -- apps/mobile                     # 0 = 还在别人那笔里
# ③ HEAD 级那道 entries 红（在干净载体上跑，别在脏主检出跑）
(cd .worktrees/<载体>/apps/landing && node scripts/gen-entries.mjs --check); echo rc=$?
# ④ 环境档
node -e 'const os=require("os");console.log(os.loadavg()[0].toFixed(1), os.cpus().length)'
node -e 'const m=require("child_process").execSync("vm_stat").toString();const pg=+m.match(/page size of (\d+)/)[1];console.log(((+m.match(/Pages free:\s+(\d+)/)[1])+(+m.match(/Pages speculative:\s+(\d+)/)[1]))*pg/1073741824+" G free")'
```

一句话把这一轮的账面收平：本线的产品面 —— 服务端路由与迁移、共享层编排、web 三块面板、
移动端换绑 / 改密 / 会话四格 / 找回通行密钥、中英词条、判据与变异 —— 现在**都在 `main` 上**；
没关的只剩"设备与浏览器那两趟读数"（环境档）、"帮助中心挂载"与"忘记密码那一格"
（两格都等别人那批落地才能不带副作用地落）、以及"法务十封"（等那三枚未跟踪的服务端文件，
现量见 §6.34，本轮重取仍是 `HEAD=0 工作树=存在`）。

### 6.46 「撤销的四件事」逐路对账：一处确认没缺口、一处登记成第 17 条边界（10-10 00:5x，纯读盘）

§5 第 16 条那把尺是**两个动作集合做减法**。这一轮把同一把尺换到"会话族"的每一条路上重跑一遍，
四件事各查：**抬计数器 / 删会话行 / 关实时通道 / 失效鉴权缓存**。全部现量，没有一条靠印象。

| 那条路 | 代码在哪 | 四件事 |
|---|---|---|
| 改登录密码 | `server/src/password/recovery.ts:257`（bump）与 `:276` | 四件都有主人：`revokeAllDeviceSessions` = 删行 + `closeForUser` |
| 重置口令 | `password/recovery.ts:381` | 同上（同一枚助手） |
| 换绑生效 | `account/email-change.ts:371`（bump）与 `:419` | 同上 |
| 通行密钥恢复 | `passkey.ts:909` | 那一枚文件自己就写着 `closeForUser(` ⇒ 关得到 |
| 登出所有设备 | `account/account-security.routes.ts:213-214` | 走 `revokeAllTokens`（`auth.ts:215` 那一处 bump）+ `revokeAllDeviceSessions` ⇒ **bump 与关通道分在两个文件里**，这正是门禁把 `auth.ts` 列进豁免、并且**连豁免处的 bump 计数一起钉住**的理由（`node scripts/check-session-revocation.mjs` 那句"豁免 1 枚且计数逐字相符"） |
| 后台强制登出 | `admin/admin.routes.ts:548-550` | 同一类分法，表上写明"删行 + 关通道是一个助手" |
| **账号注销** | `api.ts` 里 `DELETE /account`：`prisma.$transaction((tx) => deleteAccountWithTombstone(tx, userId))` 之后 `authCache.invalidate` 与 `closeForUser` 各一句 | ✅ **没有缺口**：会话行由 `AccessSession.user` 上的 `onDelete: Cascade` 带走（`server/prisma/schema.prisma` 那枚模型），通道单独关、注释还写明"删完之后关，否则重连会再铸一条孤儿 socket" ⇒ 这一路**不需要** `revokeAllDeviceSessions`，不是漏调 |
| **逐枚撤销** | `account-security.routes.ts` 里 `DELETE /sessions/:id` 那一支 | ✅ **这一格已关（§6.60，10-10 02:45）** —— 下面这段是当时的现状读数，保留原文：⚠️ 四件里三件有主人（删那一行、`authCache.invalidate`、审计日志），**关通道那件没有**，而且是**明知故漏**：那里的注释自己写着 `closeForUser(userId)` 会把这个账号**全部**设备踢下线。根因在服务端认不出"那一枚会话是哪一条 socket"：`sync/services/websocket-connection.service.ts:79-80` 的簿记是 `Map<userId, Set<ConnectedClient>>`，而 `ConnectedClient` 只带 `ws / clientId / userId / lastPong / connectedAt`，**没有 jti**。⇒ 登记成 §5 第 17 条，含关闭它需要的三件事 |

**这条边界为什么不算"界面在说谎"**：`common.sessions.intro` 的原话是"退出哪一台，它的
**下一次请求**就要重新登录" —— 与实现逐字对齐。多承诺一分的那句（"它立刻什么都收不到"）界面没说，
所以这不是文案回归，是一条**语义上真实存在的窄口子**，而按第 16 条同一条理由，它只有真运行时判据抓得住。

顺带把门禁自己登记的那条口径**量了一次**（不替别人改门禁，只把"现在有没有"从断言变成读数）：
`check-session-revocation` 只认 `tokenVersion: { increment }`；直接赋值那一形状全仓现在**只有一处**
—— `server/src/test-routes.ts:100` 的 `tokenVersion: 0`，而它在 `prisma.user.create` 的**建号**分支里
（不是撤销路径）⇒ 那一档盲区此刻没有活的漏法。
复取：`git grep -nE "tokenVersion: *[0-9]" HEAD -- server/src packages`；
逐路命中：`git grep -n "revokeAllDeviceSessions\|closeForUser" HEAD -- server/src`。

### 6.47 两笔落进去了（帮助文档那两节 + 一道红了两天的法务文案门禁），另一格用字节对账确认"不该我落"

**① `da5c7f52`：文档中心「注册与登录」那一篇补两节。** `site.docs.account.s6` / `s7` 的词条
（标题、正文、四/三条要点）早在 HEAD 的中英两份表里，而注册表只列到 `s5` ⇒ 页面渲染不到，
用户读不到"换绑是可以的"与"逐台退出怎么用"。这一格能现在就落，靠的是先量了一件事实：
**这一处挂载不改生成物** —— `gen-entries.mjs` 只把 `pages.ts` 的 head/lede 与 `content.ts` 的问答清单
灌进已跟踪的静态 HTML，文章内的小节是运行时从注册表渲染的。两臂各跑一次生成器，
中英全部产物 `diff -rq` 逐字节相同 ⇒ 不需要碰那 32 枚正被别人重生成的 HTML。
四条读数：候选那枚引用 291 枚键，zh 缺 0 / en 缺 0；两臂生成器都 rc=0 且产物相同；
`pnpm --filter @heyta/landing typecheck` 基线 44 条 / 候选 44 条且 `comm` 双向差集为空
（两臂落在 `site/docs.ts` 上的错误都是 0 条 —— 顺带记下 **HEAD 上 `typecheck` 也是红的**，
红在缺 dist 的那几枚包，不只是"打不出包"）；本笔新增 23 行逐字都在并行会话那枚未提交的 `docs.ts` 里
（23/23，缺失 0）⇒ 他们落地是盖在同一批行上。
⚠️ 那条"子集"测量是在提交**之后**才跑成的（命令里那半段先崩了一次 `subprocess.run(...).read()`）——
读数成立，顺序不对；下次把这条挪到落地之前，别把"事后补上"读成"事前验过"。

**② `47552d43`：`check:legal-copy` 那格红从 10-04 起，本笔关掉。**
`packages/legal/src/documents/terms.ts` 的摘要在 `fcff5bbb`（10-04 10:11，注销批次 E3）换了新话，
但没人重跑 `gen-site-copy.mjs` ⇒ 站点词条里 `site.legal.terms.lede` / `.seo.description` 两条一直是旧话，
两臂同尺在干净载体上 rc=1 红了六天。落的是**生成器自己的输出**（4 行，全在生成区里），
不是一句新写的法律表述。复验：`check:legal-copy` 转 rc=0；相邻 `legal-permissions` / `legal-tools` /
`legal-host` 三道各自 rc=0 没被带动；生成器幂等（再跑 `git diff` 为空）。
同一轮 `@heyta/i18n` 那包有一条红（`中文表每一条都含汉字` 点名 `web.ai.settings.localApi.source.file`
与 `.command`），**与本笔无关**：那是路径与命令值，本笔只动 `site.legal.terms.*`，而同样两条早在干净 HEAD 上
被 `check:ui-language` 点过名（§6.44 的两臂逐字相同读数）。归属：AI 那条线的 `UNTRANSLATABLE_KEYS`，不代拍。
基线臂当刻没跑成（`内存闸门拒绝启动：轻量档已有 2 趟在跑`，那是仓里的并发闸门，不是产品红），
所以这条归属用的是内容级对账 + 那道门禁的既有读数，不是"两臂各跑一次"—— 写清，别读成后者。

**③ 那 32 枚 landing HTML 的红不该由我再落一份 —— 字节对账给的证据。**
把主检出里那枚未提交的 `apps/landing/docs/account/index.html` 与"从 HEAD 真源重生成"的结果 `cmp`
⇒ **逐字节相同**。也就是说并行会话正在落的那一批**就是** `check:entries` 的修法本身。
⇒ §6.45 那张表里"帮助中心挂载"这一格现在拆成两半并已量准：文档中心那两节**已落**（上面①），
`content.ts` 那两行问答对**仍排在他们那批之后**（`gen-entries.mjs:178` 读 `HELP_QUESTIONS`
写 `FAQPage` JSON-LD，落它会改正在被别人重生成的 HTML）。复取这条排序判断：

```bash
# 他们那批 == 从 HEAD 重生成？（是 ⇒ 别落第二份）
(cd .worktrees/<载体> && git checkout --force <HEAD> && cd apps/landing && node scripts/gen-entries.mjs >/dev/null)
cmp -s apps/landing/docs/account/index.html .worktrees/<载体>/apps/landing/docs/account/index.html && echo 同一份
```

### 6.48 HEAD 上现在红着哪几道门禁、各归谁（一张可复取的快照，10-10 01:0x 现量）

本线自己那一格已经关了（② 那笔把红了六天的 `check:legal-copy` 打到 rc=0）。
在干净载体（`git checkout --force <HEAD>`，不借主检出的工作树）上逐道重取，剩下红的是这四道，
**没有一道在本线**：

| 那道红 | 命中 | 归谁、为什么不由本线动 |
|---|---|---|
| `check:entries` | 32 枚已跟踪 HTML 与生成物不一致 | 并行会话正在落的那批**就是**修法（§6.47③ 用 `cmp` 逐字节证过）；落第二份 = 覆盖他们 |
| `check:ui-language` | ① 价格 SSOT：`server/src/billing/price-book.ts` 的 `SKU_GRANTS` = `[ai, hosting]`，`docs/reference/pricing-and-entitlements.md` = `[ai, automation, hosting]`（那档 `automation` 由 `7350e309` 写进价格表）；② `web.ai.settings.localApi.source.file` / `.command` 两条中文表里没有汉字 | ①判的是"对外承诺哪组能力"，要负责人或那条线拍；②归 AI 那条线的 `UNTRANSLATABLE_KEYS` 登记表 |
| `check:layering` | `apps/web/src/features/share/share-key-store.ts:56` 在 `apps/*` 里就地拼 op | 那枚文件不在本线射程，修法要把 op 构造收进 `@heyta/app-host` 的动作层 = 改 web 那一线的写路径 |
| `check:gate-wiring` | `package.json` 里 `check:tokens` 指着 `scripts/gen-android-widget-colors.mjs`，而那枚文件**在盘上、从未入库**（`git status` = `??`，`git log --all -- <那枚>` 空）；带这行的是 `e6058120`（10-09 14:35） | 是别人那枚没跟着 `package.json` 一起提交的实现文件。本线代落 = 提交一份自己没验过的别人的实现（§6.42 / 第 400 条那一型的"引用在册、实现不在册"） |

📌 值得记下的一点：最后那道红是 `check:gate-wiring` **自己抓出来的** —— 它第 4 条就是在防
"链里有定义、实现文件不在树上"这种 `merge-tree` 与逐条门禁都看不见的断点。
上一轮（§6.38 / 第 400 条）栽在同类形状上时没有任何一层会响，这次有一层响了。

复取这四道（都在干净载体上，别在主检出跑 —— 那里工作树是别人的）：

```bash
node scripts/check-gate-wiring.mjs; echo rc=$?
node scripts/check-layering.mjs; echo rc=$?
node scripts/check-ui-language.mjs; echo rc=$?
(cd apps/landing && node scripts/gen-entries.mjs --check); echo rc=$?
```

### 6.49 移动端「忘记密码」那一格换了个说法（不是"等别人"，是"那一格有人在做完了"），并记下一种会骗人的读数姿势（10-10 01:1x 现量）

**先复取外部前提：一件都没解除。** main tip 从 `47afe367` 走到 `e0aae83a`（中间那两笔是产品体验线的
test/docs，不碰本线），而：

- 十封那三枚仍 `??`（`server/src/password/registration-otp.ts`、它的 integration spec、
  迁移 `20261016000000_add_email_password_registration_challenges`）⇒ 第 17 项任务照旧不动；
- `apps/landing/src/site/content.ts`、`apps/mobile/src/screens/AuthScreen.tsx`、
  `packages/i18n/src/locales/zh-CN.ts` 仍 ` M`。

**那一格换了说法，靠的是把「只能等别人」换成三条可跑的判据（§6.41 那三条）**：
`git diff -- apps/mobile/src/screens/AuthScreen.tsx` 的 `+` 行里已经躺着**整条**忘记密码入口 ——
phase 词表加了 `| 'forgot-password'`、`const forgotPassword = async () => {…}`、
`await requestPasswordReset(options, email)`、通知态 `common.auth.sent.reset`、
以及一行真的挂上去的 `<Pressable … onPress={() => { void forgotPassword(); }}>`。
它骑在一枚 HEAD 上不存在的**本地**代际守卫上（`beginAuthAction`，`git grep -c beginAuthAction HEAD -- apps/mobile` = 0）。
⇒ 判据②（我的 hunk 引用的符号在 HEAD 有没有）不过；而判据①在这里是**反向形状** ——
不是"我的行是他们版本的子集"，是**他们那版已经把这一格做完了**，我落一份 = 在同一处落第二份、并把他们的盖掉。
所以这一格登记的不是"我的活被挡住"，是"**这一格有主，且主人在飞**"。

📌 反过来，本线欠他们的那半格这次验了：**他们引用的中文针在 HEAD 就在** ——
`common.auth.sent.reset` 在中英两张词表里各命中（共 2 枚文件），`requestPasswordReset` 在 HEAD 已由
`apps/mobile/src/screens/SecurityScreen.tsx`（本线 ⑰⑱ 那笔落的那枚）与 web 在用。
⇒ 他们那笔落地**不会缺针**，也不需要本线补词条。这条是"我这条线会不会让别人落地时红"的一格，之前没查过。

**环境现量（它决定后面两趟读数什么时候能起）**：`vm.loadavg` 当刻 `{44.27 29.36 28.27}`，
`pnpm --filter @heyta/app-host test` 在干净载体上被**仓库自己的内存闸门**拒绝启动，原话：
`内存闸门拒绝启动：立即可用 123MB < 这一档要求的 384MB（改这一档要求的量是 TFA_LIGHT_NEED_MB）`，rc=1。
这一条按既有纪律记成**载体无效**，不记产品失败；iOS 设备腿与真浏览器腿在这一档不可能起。

**HEAD 上不占内存就能重取的读数，这一轮补了四把**：`node research/tools/parse-sweep-ts.mjs $(git rev-parse HEAD)`
= 扫 1834 枚 tracked `.ts/.tsx` ⇒ **parse-broken = 0**（§6.42 那笔"HEAD 里一枚文件 parse 不过"的形状在新 tip 上没复发）；
`check:migrations`、`check:adr-numbering`、`check:md-tables` 三道 rc=0。
构建输入那一格照旧：**9 条相对 import 解析不到**（`packages/ui/src/index.ts` 引 `./ai/AssistantMark.js` 等，归并行会话在飞），
⇒ 任何"干净检出打得出包"的读数还不能起。

🔴 **一条本轮自己犯的读数姿势错，值得入档（它比看起来更阴）**：Bash 工具的工作目录**在命令之间残留**，
我上一批 `git status` 是在隔离载体 `.worktrees/iosacct` 里跑的。那棵载体 `git checkout --force` 过，所以它报
"content.ts / AuthScreen.tsx 干净"，而主检出是 ` M`。更骗人的是同一批里 `git rev-parse refs/heads/main` 给出的是
**正确的同一个 tip** —— refs 在 worktree 之间是共享的，于是那批读数**只有"未提交状态"那一维是错的**，
其余全对，没有任何一行输出会提示我在另一棵树上。
⇒ 跨 worktree 取"脏/干净/未跟踪"这类读数，命令里必须自带 `pwd` 或显式 `git -C <主检出>`；
**`rev-parse` 对得上不能当作"我在哪棵树"的证据**。

复取这一节：

```bash
cd "<主检出>" && pwd && git rev-parse --short refs/heads/main
git status --porcelain -- apps/landing/src/site/content.ts apps/mobile/src/screens/AuthScreen.tsx packages/i18n/src/locales/zh-CN.ts
for f in server/src/password/registration-otp.ts server/tests/integration/registration-otp.integration.spec.ts \
         server/prisma/migrations/20261016000000_add_email_password_registration_challenges/migration.sql; do
  printf "%s HEAD=%s wt=%s\n" "$f" "$(git cat-file -e HEAD:$f 2>/dev/null && echo 1 || echo 0)" "$([ -e "$f" ] && echo 1 || echo 0)"; done
git grep -c beginAuthAction HEAD -- apps/mobile
git grep -l common.auth.sent.reset HEAD -- packages/i18n/src/locales | wc -l   # = 2 才算不缺针
node research/tools/parse-sweep-ts.mjs $(git rev-parse HEAD)
node scripts/check-imports-resolve.mjs --sources-only
```

### 6.50 「写好了没人挂」那一型的收尾点名：本线在 HEAD 上已经没有这种格子（10-10 01:1x 现量，纯只读）

这台机器现在起不了测试腿（§6.49 那条内存闸门），所以把**不占内存也能证**的一格补掉：
逐枚点名本线全部共享动作与四块面板在 HEAD 上有没有消费者 —— 这一型过去三次骗过我们
（web 两块面板、移动端 `SecurityScreen` 都是"代码齐了、没人挂"，而所有静态门禁全绿）。

**先记一条我自己犯的探针错**（它比结论更值得留）：我第一版点名名单写的是
`requestEmailRebind / confirmEmailRebind / EmailRebindPanel`，跑出来**三枚都是 0 消费者**，
看起来像"换绑那一整块从来没挂上"。现量否证：`git grep -inE "(function|const|class) [A-Za-z]*[Rr]ebind" HEAD`
**整个仓库 0 命中**（只有 ADR 那枚文件名带 `rebinding`）—— 真词表是 `email-change`：
`packages/app-host/src/account-security.ts` 的 `requestEmailChange` / `getEmailChangeStatus` /
`cancelEmailChange` / `emailChangeStage`，`server/src/account/email-change.ts`，
`apps/web/src/features/settings/EmailChangePanel.tsx`，`apps/mobile/src/screens/EmailChangeSection.tsx`。
⇒ **"0 消费者"这一类红，先问"这个名字是不是我从记忆里编的"**；名单必须来自
`git grep` 的**声明点**，不是台账里的口语词。（本台账自己就一直用"换绑"两个字，而代码里没有一个 rebind。）

**用真名重取，每一枚都有消费者，四块面板的挂载链在 HEAD 上是完整的**（排除测试与证据目录后逐枚数）：

- `requestEmailChange` 6 枚、`confirmEmailChange` 3 枚、`requestPasswordReset` 8 枚、
  `resetPasswordWithToken` 5 枚、`changePassword` 9 枚、`revokeSession` 2 枚、
  `revokeAllDeviceSessions` 5 枚、`signOutCurrentDevice` 3 枚、`retryServerRevocation` 2 枚、
  `beginPasskeyEnrollment` 4 枚、`requestPasskeyRecovery` 6 枚 ⇒ **没有一枚是 0**。
- 挂载面逐条对上：`EmailChangePanel` ← `ProfilePanel.tsx`；`SessionsPanel` ← `App.tsx`；
  `EmailChangeSection` ← `ProfileScreen.tsx`；`SessionsSection` ← `SecurityScreen.tsx` ← `ProfileScreen.tsx`。
  四条链每枚都恰好是"面板自身 + 宿主 + 判据"三枚文件。

顺带把我自己落的那两节帮助文档也照同一把尺照了一次（它引用一批中文针）：
`git grep -oE "'site\.docs\.account\.s[67][a-z0-9]*'"` 取出 **11 枚 key**，
逐枚查 `packages/i18n/src/locales/{zh-CN,en}.ts` ⇒ **缺针 0 条**，中英两边都是成文的句子（抽查 `s6i1` 逐字看过）。
这一格以前只在"我写的词条在不在"上查过，没在"我引用的词条在不在"上查过。

**结论（不包装）**：本线的代码侧在 HEAD 上**已经没有"写好了没挂上"那一型**的缺口；
还开着的三类分别是 ① 设备腿与真浏览器腿的**读数**（载体内存/负载 + 9 条构建输入，§6.49），
② 排在别人那批重生成之后的 `content.ts` 两行问答（§6.47③），
③ 有主且主人在飞的两格（移动端忘记密码入口、十封那三枚未入库实现）。

复取这一节：

```bash
git grep -inE "export (async )?function [A-Za-z]*[Ee]mailChange|export const [A-Za-z]*[Ee]mailChange" HEAD -- packages server/src
for s in requestEmailChange confirmEmailChange requestPasswordReset resetPasswordWithToken changePassword \
         revokeSession revokeAllDeviceSessions signOutCurrentDevice retryServerRevocation \
         beginPasskeyEnrollment requestPasskeyRecovery EmailChangePanel EmailChangeSection SessionsPanel SessionsSection; do
  printf "%-26s files=%s\n" "$s" "$(git grep -l "$s" HEAD -- apps packages server/src 2>/dev/null | grep -vE '/(tests?|evidence)/|\.test\.|\.spec\.' | wc -l | tr -d ' ')"; done
for k in $(git grep -h -oE "'site\.docs\.account\.s[67][a-z0-9]*'" HEAD -- apps/landing/src/site/docs.ts | tr -d "'" | sort -u); do
  printf "%s zh=%s en=%s\n" "$k" \
    "$(git grep -c "'$k'" HEAD -- packages/i18n/src/locales/zh-CN.ts | cut -d: -f3)" \
    "$(git grep -c "'$k'" HEAD -- packages/i18n/src/locales/en.ts | cut -d: -f3)"; done   # 两列都必须 = 1
```

### 6.51 本线自己的判据里有没有"死针"：67 枚引用逐枚对表，唯一那枚是故意的负向断言（10-10 01:2x 现量，纯只读）

"绿色证据会跟着针一起过期"这一型本线抓到过两次（`scripts/lib/mobile-e2e.sh`、
`verify-mobile-ios-account-erasure.sh` 各拿一句**已不存在的中文**做负向检查 ⇒ 那条**永远不会红**）。
测试腿现在起不了（§6.49 的内存闸门），所以这一格可以用只读的方式先关掉：
把本线八枚文件（四枚界面 + 四枚判据）引用的**词条 key** 逐枚对两张词表。

**先记两次探针自错（它们比结论更值得留，因为两次都是 rc 正常、数字却毫无意义）**：

1. 第一版把三份 spec 里所有含汉字的字符串都当针 ⇒ 报"174 条里 147 条找不到"。
   那 147 条绝大多数是 `it('…')` 的**用例标题**和注释 —— 它们本来就不该出现在词条表里。
2. 收紧到断言调用（`toContainText(` / `getByText(` / `toHaveText(`…）后只命中 **1 条**。
   这不是"针少"，是本线那几份套件**不按字面文案断言**：jsdom 那份走词条 key，
   `apps/mobile/tests/account-security-wiring.spec.ts` 那份整枚是**源码文本判据**（它验的是"这个文件里出现了哪些标识符"）。
   ⇒ 取样口径要先问"这份套件凭什么说话"，不然尺量到的永远是空集或垃圾集。

**用对的口径重取，结论是干净的**：八枚文件各自去重后**引用数相加 = 67 次**（同一枚 key 在多份文件里各数一次），
`zh-CN.ts` 与 `en.ts` 两张表里**都在的 = 66 次**，唯一"两张表都没有"的那枚
`common.emailChange.applied` 不是死针，是 `account-security-wiring.spec.ts:89` 那行
**故意的负向断言** —— `expect(EMAIL).not.toContain('common.emailChange.applied')`，
它钉的是"移动端成功文案只许说『信发出去了』，不许说『邮箱已经改好了』"（服务端那一边还没确认旧邮箱）。
🔴 关键是这行的**上一行就是它的正向对照**：`expect(EMAIL).toContain('common.emailChange.sent')`，
而 `…​.sent` 两张表里都在 ⇒ 这条负向断言不是"永不成立"，它配的那句实话要是哪天不说了，88 行会红。
（这一对正是"负向断言要落在条件不成立时确实会变的那一侧"该有的形状。）

复取这一节（python 内联，取样口径写死在正则里）：

```bash
python3 - <<'PY'
import subprocess, re
files = ["e2e/tests/account-email-change-and-sessions.spec.ts", "apps/web/tests/account-security.spec.tsx",
         "apps/mobile/tests/account-security-wiring.spec.ts", "apps/web/tests/password-panel.spec.tsx",
         "apps/web/src/features/settings/EmailChangePanel.tsx", "apps/mobile/src/screens/EmailChangeSection.tsx",
         "apps/mobile/src/screens/SessionsSection.tsx", "apps/web/src/features/settings/SessionsPanel.tsx"]
loci = {l: subprocess.run(["git","show",f"HEAD:packages/i18n/src/locales/{l}.ts"],capture_output=True,text=True).stdout
        for l in ("zh-CN","en")}
KEY = re.compile(r"['\"]((?:common|settings|site|app|errors|auth)\.[A-Za-z0-9_.]{2,60})['\"]")
for f in files:
    src = subprocess.run(["git","show",f"HEAD:{f}"],capture_output=True,text=True).stdout
    miss = [k for k in sorted(set(KEY.findall(src)))
            if all(("'"+k+"'") not in v and ('"'+k+'"') not in v for v in loci.values())]
    print(f, "缺:", miss)
PY
# 期望：只有 apps/mobile/tests/account-security-wiring.spec.ts 报出 ['common.emailChange.applied']，其余七枚报 []；
# 再用 git show HEAD:apps/mobile/tests/account-security-wiring.spec.ts | sed -n '86,90p' 确认它是 not.toContain 且上一行有正向对照
```

### 6.52 门禁快照重取：§6.48 那四道红现在只剩一道，而那一道的 30 枚差异**逐枚**都不是本线（10-10 01:2x 现量）

载体（`.worktrees/iosacct`，`checkout --force refs/heads/main`）上重跑 §6.48 那四条命令，tip 走到 `d971a73f`：

- `check-gate-wiring.mjs` **rc=0**（原红：`scripts/gen-android-widget-colors.mjs` 在盘上没入库）
- `check-layering.mjs` **rc=0**（原红：`share-key-store.ts:56` 在 `apps/*` 里就地拼 op）
- `check-ui-language.mjs` **rc=0**（原红：价格 SSOT 的 `automation` 那档 + 两条无汉字词条）
- `gen-entries.mjs --check` **仍 rc=1** —— 30 枚已跟踪 HTML 与生成物不一致

三道是它们的 owner 自己落的（不是本线代改）。剩那道红本线**不代落**的理由与 §6.47③ 相同
（`cmp` 证过他们工作树那 30 枚就是修法），但这一轮把"不是我的"从**推断**升级成**逐枚归因**：

> 做法：在载体里真跑一次生成器 ⇒ `git diff --name-only` = 30 枚；对每一枚取**一条新增文案**，
> 回指"哪笔提交把这句词条改成现在这样"：
> `git log --oneline -S"<那条新增文案>" -- packages/i18n/src/locales`。
> 读数：**30 枚全部落在同一笔 `e6058120`**（`docs(产品体验线 台账 §UX-S9-153)`）——
> 它改了 `site.docs.*.sum` 与 FAQ 答案（中英各 15 枚），没有重跑 `gen:entries`。
> 同一笔也正是 §6.48 里 `check:gate-wiring` 那道红的引入者，同一个习惯的第二次。
> ⇒ 本线在这道红里 **0 枚**。

⚠️ 这把尺自己坏过一次，值得留：**第一版只认单引号 key**，于是法务那族（生成进表里是**双引号**）
整批报成"引用了不存在的 key" —— 72 条假阳性，其中还包括 `site.legal.terms.title` 这种明显在表里的。
两种引号都认之后：**4316 个引用点 / 真缺 0 条**，且中英两张表**键集合差 0/0**（3888 枚）。

🔴 顺带证伪了本线自己的一个"要不要补装置"的判断：本来看上去缺一道
**"代码/文档引用的词条 key 必须在两张表里都存在"** 的门禁（现有 `check:ui-language` 只比表↔表）。
实量否证 —— 这一轴**编译器已经钉住**：`translate(locale, key: MessageKey)` 的入参是联合类型，
`en` 声明成 `Record<MessageKey, string>`（少一条就编译不过），而 landing 那些数据表里的
`titleKey/questionKey/bodyKeys` 全部声明为 `MessageKey`（`docs.ts:864`、`content.ts:259/288/422`、`pages.ts:167`）。
⇒ §6.51 那把尺量到 0 缺是**结构性**的，不是运气；再写一道同样的门禁就是重复装置。
（这条也说明了为什么"缺针"类怀疑该先去 `typecheck`，而不是先建门禁。）

📌 还补上了一条**正向对照**：§6.47 那句"文档中心的小节是运行时渲染 ⇒ HTML-neutral"当时只有
"我的内容没出现在差异里"这一半。现在两半都有：`git show HEAD:apps/landing/docs/account/index.html`
里 `rebinding-email` 命中 **0**，重生成后仍 **0**，而源码侧 `docs.ts` 命中 **1**。

复取这一节（都在干净载体上）：

```bash
cd .worktrees/<载体> && git checkout --force $(git rev-parse refs/heads/main)
node scripts/check-gate-wiring.mjs; node scripts/check-layering.mjs; node scripts/check-ui-language.mjs
node apps/landing/scripts/gen-entries.mjs            # 然后逐枚归因
python3 - <<'PY'   # 30 枚各取一条新增文案，回指是哪笔提交改的这句词条
import subprocess, re
sh=lambda *a: subprocess.run(a,capture_output=True,text=True).stdout
for f in [x for x in sh('git','diff','--name-only').split('\n') if x.strip()]:
    d=sh('git','diff','-U0','--',f)
    s=(re.findall(r'^\+.*?content="([^"]{12,120})"',d,re.M) or
       re.findall(r'^\+.*?>([^<]{12,120})<',d,re.M) or
       re.findall(r'^\+\s*"text":\s*"([^"]{12,120})',d,re.M) or ['<无>'])[0]
    print(f.split('/')[-2], '←', sh('git','log','--oneline','-S',s,'--','packages/i18n/src/locales').split('\n')[0][:9])
PY
git checkout --force HEAD    # 载体收干净
```

### 6.53 共享层第一次拿到纯 HEAD 的整包读数：86 份里本线那 6 份全过，残留的 7 份只有一个根因（10-10 01:3x 现量）

§6.49 那一趟被内存闸门拒绝，这次闸门放行，于是在干净载体（`checkout --force refs/heads/main`，tip `d971a73f`）
把 `pnpm --filter @heyta/app-host test` 整包跑完：

- **`Test Files 14 failed | 72 passed (86)`**，其中**本线那六份全部通过**：
  `account-security` / `hosted-account-profile` / `account-closure` / `hosted-password-auth` /
  `device-revocation-controller` / `assistant-session-actions` —— 这是这条线的共享层编排
  第一次在**纯 HEAD**（不借主检出工作树）上取到通过读数。

- 🔴 **那 14 枚一开始不能当产品红读**：本仓 vitest 走 `package.json` exports ⇒ 兄弟包解析到的是**它的 dist**，
  而载体里除我补编过的那几枚之外都是旧 dist。补编 `@heyta/design-system` → `@heyta/widget-core` → `@heyta/inbound-core`
  （各 rc=0）后**同一批 14 份**再跑 ⇒ `4 passed / 10 failed (14)`：
  `widget-actions`、`inbound-draft-review`、`inbound-recipient-remote`、`inbound-rules-remote` 四枚**直接转绿**
  —— 它们先前那份红整个是旧 dist 造成的，不是行为红。

- 残留 **10 份失败 / 15 条用例红**，两种根因，**没有一种在本线**：
  ① **7 份整枚加载不到**：`packages/app-host/src/inbound-process.ts:6` 引 `./task-batch-actions.js`，
  而那枚文件**在 HEAD 里不存在**（`check-imports-resolve --sources-only` 当刻报 9 条，测试文件 0 条）。
  它同时把 `src/index.ts` 的整条入口带塌，所以 `ai-egress-legal-parity` / `assistant-egress-disclosure` /
  `calendar-anchor` / `vault-key-package-store` / `vault-migration` / `vault-session` 这六枚是**被连坐**的，
  不是各自的红。决定性的一条：**`pnpm --filter '@heyta/app-host...' build` 自己就 rc=1**
  （`Could not resolve "./task-batch-actions.js"` + `src/index.ts(25,8) TS2305 没有导出成员 'InboundAutomation…'`）
  ⇒ 共享层这个包在 HEAD 上**打不出来**，归 inbound/协作那一族（"引用在册、实现不在册"，
  与 §6.48 里 `check:gate-wiring` 那道红同型）。**本线不代落**：那枚文件不是本线写的，
  代提交 = 替别人给一份自己没验过的实现发通行证。
  ② **3 份是用例级真红**（补齐依赖后仍在）：`inbound-key-store` 与 `inbound-secret-store` 都报
  `Error: store「meta」的 put 缺少主键`，`inbound-runner` 报
  `TypeError: Cannot read properties of undefined (reading 'every')` —— 同一族，本线 0 份。
  这 15 条用例红登记给别人，不动本线判据、也不拿它当"共享层没验"的理由（本线那六份是过了的）。

复取（顺序不能换 —— 先补依赖再跑，否则拿到的是一张掺假的账面）：

```bash
cd .worktrees/<载体> && git checkout --force $(git rev-parse refs/heads/main)
pnpm --filter @heyta/app-host test    # 臂 A（不动 dist）：期望 14 failed | 72 passed
pnpm --filter @heyta/design-system build && pnpm --filter @heyta/widget-core build && pnpm --filter @heyta/inbound-core build
pnpm --filter @heyta/app-host exec vitest run <那 14 份>   # 臂 B（补齐依赖）实测：10 failed | 4 passed (14)
# ⚠️ 整包 86 份在补依赖后的账面**没有实测**（当刻内存闸门按并发维拒绝：轻量档已有 2 趟在跑），
#    10 failed | 76 passed 那个数是 72+4 推出来的，只作预期参考，别当读数引用。
pnpm --filter '@heyta/app-host...' build; echo rc=$?     # 期望 rc=1，报 task-batch-actions.js
node scripts/check-imports-resolve.mjs --sources-only
```

### 6.54 移动端那一笔的变异验证补完了，而它照出来的是**本线自己的一条判据缺口**（10-10 01:4x 现量，载体 `d971a73f`）

§6.44 那两枚移动端文件落地时只做过 A/B 两臂（HEAD 4 红 → 候选 19 过），没证过"删掉挂载会让判据红"。
这一轮在纯 HEAD 载体里补完，三条臂各红自己那条：

- 臂② `断掉本屏两条退出出口的接线`（从 `ProfileScreen` 删 `onSignOutCurrentDevice={…}` 与
  `onSignedOutEverywhere={runSignOutEverywhere}`）⇒ **恰好 1 条红**：
  `本屏那两条退出出口都接到了 ProfileScreen 的清理编排上`。
- 臂③ `负向判据的正向对照`（往 `SecurityScreen` 函数体里把 `const legacySnap = readSyncConfig();` 读回来）
  ⇒ **恰好 1 条红**：`SecurityScreen 不出现 readSyncConfig(` —— 那条"会不会永不成立"的嫌疑被这次量掉了。
- 🔴 **臂① 一开始什么都没红**：把 `<SessionsSection … />` 整块**删掉**，
  `account-security-wiring.spec.ts` 依旧 `19 passed / rc=0`。
  这不是探针坏 —— 逐条读过那枚 spec：它对 `SECURITY` 只断言通行密钥那族符号、两个 prop 类型声明，
  和那条 `readSyncConfig(` 负向判据，**没有任何一条钉着"登录设备这一块挂在安全面上"**；
  全仓再搜一遍，这个挂载只被 `verify-mobile-account-email-sessions.sh` 与它的 iOS 姊妹**两枚设备脚本**读着
  （而那两枚要真模拟器，`pnpm check` 与 CI 都不跑）。
  ⇒ **症状会是"设置面里根本没有登录设备这一块"，而静态一层完全不响** ——
  这一型本线在 web 侧**早就写过**（`apps/web/tests/account-security.spec.tsx:988`
  那枚 `接线（挂载点真的存在 —— "做好了但没接上"不算做完）` 的 describe），
  移动端那笔落地时**漏了它的孪生**。

**已补并落地**（`b6581174`，只改测试文件，`+17/−0`）：新判据把挂载与四个 prop 一起钉
（`<SessionsSection` + `baseUrl={baseUrl}` + `token={token}` + `onSignOutCurrentDevice={onSignOutCurrentDevice}`
+ `onSignedOutEverywhere={onSignedOutEverywhere}`）。补完后**臂① 恰好 1 条红**，红名就是
`那一块真的挂在安全面上，四个 prop 一起接`；同一载体里带新判据的基线 `rc=0`
（`it(` 数 19 → 20，与跑出的条数一致）。

⚠️ **这一轮还犯了一条装置错，值得留**：`mutate()` 里 `shutil.copy(path, path+'.mut-bak')` 对**同一枚文件的两处编辑**
各跑一次 ⇒ 第二次 copy 把**已经改过的那份**当基线存了，随后第一次 `restore()` 就把"半变异"写回树上、
第二次无源可回直接抛 `FileNotFoundError` —— 载体里 `ProfileScreen.tsx` 当场停在缺一个 prop 的状态。
后果可控（那是我的隔离载体，随后 `git checkout -- <文件>` + `git show HEAD:<文件> | cmp -s - <文件>` 验回 SAME），
但形状是通用的：**"一处编辑一个 bak"的写法在同文件多编辑下必坏**。
改法：变异臂的还原**一律从 `git show HEAD:<path>` 取**（载体是纯 HEAD ⇒ HEAD 就是基线），
还原后 `git diff --quiet -- <path>` 复验；`.mut-bak` 只留给"工作树本身是脏的、HEAD 不是基线"那种场景
（那也正是仓库既有纪律用它的前提，不是默认起手式）。

复取这三条臂（不依赖那个一次性脚本 —— 它住 `/tmp`，会被清；下面这段自包含）：

```bash
cd .worktrees/<载体> && git checkout --force $(git rev-parse refs/heads/main)
R() { git show HEAD:"$1" > "$1"; }            # 还原 = 从 HEAD 取
run() { pnpm --filter @heyta/mobile exec vitest run tests/account-security-wiring.spec.ts 2>&1 | grep -E '^ *(Test Files|Tests|×)'; }
S=apps/mobile/src/screens/SecurityScreen.tsx; P=apps/mobile/src/screens/ProfileScreen.tsx
python3 - <<'PY'   # 臂①：删掉挂载整块（补判据之后这条必须红）
import io; p='apps/mobile/src/screens/SecurityScreen.tsx'; s=io.open(p,encoding='utf8').read()
m='      <SessionsSection\n        baseUrl={baseUrl}\n        token={token}\n        onSignOutCurrentDevice={onSignOutCurrentDevice}\n        onSignedOutEverywhere={onSignedOutEverywhere}\n      />\n'
assert s.count(m)==1; io.open(p,'w',encoding='utf8').write(s.replace(m,''))
PY
run; R $S; git diff --quiet -- $S && echo CLEAN
python3 - <<'PY'   # 臂②：断掉两条退出出口的接线
import io; p='apps/mobile/src/screens/ProfileScreen.tsx'; s=io.open(p,encoding='utf8').read()
a='        onSignOutCurrentDevice={() => {\n          void runSignOut();\n        }}\n'
b='        onSignedOutEverywhere={runSignOutEverywhere}\n'
assert s.count(a)==1 and s.count(b)==1
io.open(p,'w',encoding='utf8').write(s.replace(a,'').replace(b,''))
PY
run; R $P; git diff --quiet -- $P && echo CLEAN
python3 - <<'PY'   # 臂③：负向判据的正向对照
import io; p='apps/mobile/src/screens/SecurityScreen.tsx'; s=io.open(p,encoding='utf8').read()
a='  return (\n    <Screen'; assert s.count(a)==1
io.open(p,'w',encoding='utf8').write(s.replace(a,'  const legacySnap = readSyncConfig(); //MUT\n'+a))
PY
run; R $S; git diff --quiet -- $S && echo CLEAN
```

### 6.55 同一型在**服务端那一层**也照出来一处：生产入口的注册那两行没人守（已补判据 + 两臂证明会红，10-10 01:47 现量）

§6.54 那条移动端缺口不是孤例。这轮把同一把尺搬到服务端：**"路由写好了、`server.ts` 少注册一行"会不会有任何一层响？**
答案是不会 —— 三条现量：

- `server/src/server.ts:39/40` 是两枚 import，`:589/:592` 是两枚 `register(… { prefix: '/api' })`；
- 那份 HTTP 判据（`server/tests/account-security.routes.spec.ts`）里**每一组用例都是自己起一个 Fastify**
  再 `app.register(accountSecurityRoutes)`（`:223`），它验的是路由本身的行为，不验生产入口挂没挂；
- 集成那份（`server/tests/integration/email-change-and-sessions.integration.spec.ts:92`）虽然也自注册，
  但它**没有 `DATABASE_URL` 时整组 `describe.skip`**（那文件头第 24 行自己写着），所以它不在 `pnpm check` 的守卫面里。
  ⇒ 症状会是"点了没反应、服务端零日志（404）"，而单测与门禁全绿。

**已补并落地**（`73ea01db`，只改测试文件，`+25/−0`）：一条 `接线` describe 把 import 与注册**一起**钉，
并连 `prefix: '/api'` 一起钉（路由自身路径是 `/account/…`，前缀换掉等于换一条对外契约）。
两臂在纯 HEAD 载体实测，各**恰好红自己那一条**（`1 failed | 29 passed (30)`）：

- 臂① 删掉 `await fastifyServer.register(accountSecurityRoutes, { prefix: '/api' });`
  ⇒ 红 `accountSecurityRoutes：import 与注册都在生产入口里（换绑邮箱 + 逐枚会话撤销）`；
- 臂② 把 profile 那族前缀改成 `/api2` ⇒ 红另一条同名判据。
- 基线（带新判据）`30 passed`。⚠️ 别拿文件里的 `it(` 数当条数：静态数是 18 → 19，
  而运行时是 28 → 30 —— 新写的那一枚在 `for` 里，一枚生成**两条**用例（这正是"正文不存会漂的值"那条纪律的形状）。

⚠️ **这一趟的载体前置，得按实说**：载体的 `server/node_modules/@heyta/inbound-core` 那枚链接**不存在**，
`vitest` 连文件都加载不了（`Cannot find package '@heyta/inbound-core' imported from server/src/entitlement.ts`，
`Test Files 1 failed / Tests no tests`）。根因现量：`server/package.json` 里**没登记**这枚工作区包
（只有 `app-host/domain/shared-schema/storage/sync-client/sync-core/sync-server`），
而 `pnpm-lock.yaml` 的 `server:` importer **有**它（`link:../packages/inbound-core`）。
⇒ 后果不是红：`pnpm install --frozen-lockfile` 在载体里 rc=0，干净安装按 lockfile 建链，CI 与主检出都跑得动
（主检出那枚链接确实在）。**登记面与现实不一致**这一格归 inbound/协作那一线（6 枚 `server/src/**` 文件 import 它），
本线不代改 —— 补登记要同时改 `server/package.json` 与共享 `pnpm-lock.yaml`，那是别人的在飞面。
本轮为了让判据跑起来，在**载体**里手工补了那枚 symlink（`ln -sfn ../../../packages/inbound-core …`）；
上面所有读数都读的是"HEAD + 这枚按 lockfile 本该存在的链接"，不是"HEAD 裸态"。

📌 一条做法值得留：**等内存闸门时变异不留在盘上等**。
这两臂最初两次都被拒（`立即可用 356MB < 这一档要求的 384MB`），当时脚本已经把变异写进 `server.ts`。
正确的形状是"变异 → 有界重试（这次 6 次 × 35s）→ `finally` 无条件从 HEAD 还原 → `git diff --quiet` 复验"，
而不是"变异好再慢慢等人让位"——被拒的每一分钟里，那棵树上躺着的都是**故意改坏的代码**。
实测：两次被拒的臂都还原成 `CLEAN`，第 3、4 次拿到额度后读数如上。

复取这两臂：

```bash
cd .worktrees/<载体> && git checkout --force $(git rev-parse refs/heads/main)
ln -sfn ../../../packages/inbound-core server/node_modules/@heyta/inbound-core   # 见上面那段前置
python3 - <<'PY'   # 臂①
import subprocess, io, re, time
p='server/src/server.ts'
def head(): open(p,'wb').write(subprocess.run(['git','show',f'HEAD:{p}'],capture_output=True).stdout)
head(); s=io.open(p,encoding='utf8').read()
r="      await fastifyServer.register(accountSecurityRoutes, { prefix: '/api' });\n"
assert s.count(r)==1; io.open(p,'w',encoding='utf8').write(s.replace(r,''))
try:
    for _ in range(6):
        x=subprocess.run(['pnpm','--filter','@heyta/sync-server','exec','vitest','run','tests/account-security.routes.spec.ts'],capture_output=True,text=True)
        o=re.sub(r'\x1b\[[0-9;]*m','',x.stdout+x.stderr)
        if '内存闸门' not in o:
            print([l.strip() for l in o.split('\n') if re.search(r'Test Files|Tests  |× ',l)]); break
        time.sleep(35)
finally:
    head(); print('还原:', 'CLEAN' if subprocess.run(['git','diff','--quiet','--',p]).returncode==0 else 'DIRTY')
PY
```

### 6.56 撤销那"四件事"里通道那一件的判据牙已证，而它顺手否证了 §5 第 17 条的半句话（10-10 01:53 现量）

第 17 条那格原先写着"逐枚那条**只有注释里那句解释**"。这一轮往那两条断言上各打一臂，结论是：

- **正向**（`臂A`）：从 `revokeAllDeviceSessions()` 里删掉 `getWsConnectionService().closeForUser(userId);`
  ⇒ `1 failed | 29 passed`，红的正是 `` `revoke-all` ⇒ 每一枚都 401（含没有 `jti` 的旧令牌），且关掉整个账号的通道 ``。
- **负向对照**（`臂B`）：在**逐枚撤销**那条 handler 里（`authCache.invalidate` 之后）塞一句
  `getWsConnectionService().closeForUser(user.userId);`（并补一行 import，否则 esbuild 之后运行时 `undefined` 会 500 ——
  那也是红，但红得没有说明力，所以要把"红"钉在断言上而不是钉在崩溃上）
  ⇒ `1 failed | 29 passed`，红的正是 `单枚撤销**不**关掉整个账号的实时通道（那是 revoke-all 的语义）`。

⇒ 这条边界**有人守**：本线那三条断言在 `account-security.routes.spec.ts:326/:368/:396`
（正向 `toHaveBeenCalledWith` 1 条 + 负向 `not.toHaveBeenCalled` 2 条）。
同一次 `git grep -n "closeForUser" HEAD -- server/tests` 还会命中别的行，逐条读过来历只有两处：
`admin-routes.spec.ts:420` 是后台强制登出**另一条**正向断言，
而 `account-closed-signal.spec.ts:34/55` **只是 mock 定义**（那份注销信号的判据不断言"关没关通道"）。
⇒ 不要把命中行数读成守卫条数，也不要反过来读成"账号注销那条线也守住了这一件"。第 17 条已就地更正：还缺的准确说是
**"没有任何一层看得见那台设备已经开着的连接的实际后果"**（要一条真 WS 运行时判据），
不是"这条边界没人守"。原句留在上面一行，标成已被否证。

⚠️ 载体前置与 §6.55 同一件：`server/node_modules/@heyta/inbound-core` 那枚链接在载体里不存在
（`server/package.json` 没登记它、lockfile 有 ⇒ 干净安装建得出链，CI 不受影响），
本轮两臂都是"HEAD + 手工补上那枚按 lockfile 本该存在的链接"下读的，跑完已把链接撤掉、载体 `checkout --force` 回复干净。

复取（两臂各自 `finally` 从 HEAD 还原并 `git diff --quiet` 复验；被闸门拒时**别让变异留在盘上**这一条
按 §6.55 那个形状写进循环里）：

```bash
cd .worktrees/<载体> && git checkout --force $(git rev-parse refs/heads/main)
ln -sfn ../../../packages/inbound-core server/node_modules/@heyta/inbound-core
# 臂A：删 revoke-all 那侧的通道关闭
python3 - <<'PY'
import subprocess, io
p='server/src/account/access-sessions.ts'
open(p,'wb').write(subprocess.run(['git','show',f'HEAD:{p}'],capture_output=True).stdout)
s=io.open(p,encoding='utf8').read(); c='  getWsConnectionService().closeForUser(userId);\n'
assert s.count(c)==1; io.open(p,'w',encoding='utf8').write(s.replace(c,''))
PY
pnpm --filter @heyta/sync-server exec vitest run tests/account-security.routes.spec.ts 2>&1 | grep -E "Test Files|Tests  |× "
git checkout -- server/src/account/access-sessions.ts
# 臂B：让逐枚撤销也去关整个账号的通道（锚点要取"那一处"，authCache.invalidate 在文件里有两处）
python3 - <<'PY'
import subprocess, io
p='server/src/account/account-security.routes.ts'
open(p,'wb').write(subprocess.run(['git','show',f'HEAD:{p}'],capture_output=True).stdout)
s=io.open(p,encoding='utf8').read()
imp="import { listSessions, revokeAllDeviceSessions, revokeSession } from './access-sessions';\n"
anchor="      authCache.invalidate(user.userId);\n      if (!revoked) {"
assert s.count(imp)==1 and s.count(anchor)==1
io.open(p,'w',encoding='utf8').write(
    s.replace(imp, imp + "import { getWsConnectionService } from '../sync/services/websocket-connection.service';\n")
     .replace(anchor, "      authCache.invalidate(user.userId);\n      getWsConnectionService().closeForUser(user.userId);\n" + anchor.split('\n',1)[1]))
PY
pnpm --filter @heyta/sync-server exec vitest run tests/account-security.routes.spec.ts 2>&1 | grep -E "Test Files|Tests  |× "
git checkout -- server/src/account/account-security.routes.ts
rm -f server/node_modules/@heyta/inbound-core; git status --porcelain | grep -v pnpm-lock   # 期望空
```

### 6.57 试过"明账叠加"之后：两趟运行时腿等的**不是负载**，是别人一整片在飞实现（10-10 02:00 现量，载体已复原）

§6.49 / §6.53 把那两趟读数记成"内存闸门 + 负载 + 9 条构建输入"。这一轮真去叠那 9 条，量到的比那多得多，
于是**这一格的等待条件要改写**：

- 9 枚 `check-imports-resolve` 报的实现文件**全部在别人的工作树里**（`??`，逐枚 sha256 前缀记在下面），
  拷进载体后 `packages/app-host` 的 **ESM 产物出得来**（`dist/index.js` 427 KB），
  但 `tsup` 的 **dts 那一步红**：`src/index.ts(25,8) TS2305: Module './host.js' has no exported member
  'InboundAutomationHostOptions'` —— 该成员只存在于他们工作树那版 `host.ts`（`M`，HEAD 里命中 0）。
- 再往下游：`pnpm --filter @heyta/ui build` 又报**三枚**新的解析不到
  （`./artwork.js`、`./password-strength-model.js`、`./habit-artwork.generated.json`），
  其中最后一枚是**生成物**（主检出有它：`packages/ui/src/habits/habit-artwork.generated.json`），
  不是"拷一个源码"能补的。
- ⇒ 要在载体里得到一棵**构建得起来**的树，需要 **11 枚未入库源码 + 1 枚未入库生成物
  （`packages/ui/src/habits/habit-artwork.generated.json`）+ 1 枚已跟踪文件的未提交版本（`host.ts`，` M`）**。
  到那一步，读数描述的就是**他们的树**而不是 HEAD 了 —— 那不再叫"明账叠加"，叫替别人构树。
  **本轮就此收手**：叠加的 9 枚已逐枚删除、载体 `checkout --force` 复原（`脏=0`、`未跟踪=0`）。

🔴 所以这一格的准确说法是：**web 的运行时腿（jsdom 与真浏览器）与设备腿等的不是机器空不空，
是 `packages/ui` / `apps/web` 在 HEAD 上根本打不出产物**。在此之前任何"负载降到 12 以下再起"的排期都是白排。
闭合判据（不是"9 条变 0 条"，是构建本身）：

```bash
pnpm -r build; echo rc=$?                       # 这才是那条旗
# 分步定位（现量按这两条读）：
node scripts/check-imports-resolve.mjs --tree $(git rev-parse HEAD) --sources-only   # 文件存在性
pnpm --filter '@heyta/app-host...' build; echo $?                                    # 导出成员契约
```

⚠️ 两条探针语义，都是本轮自己踩的，值得留：

1. `check-imports-resolve` 读的是**提交树**（默认 `HEAD`，可用 `--tree <ref>` 换），
   所以**工作树里补上那些文件不会让它变绿**。我这轮拷完 9 枚见它还报 9 条，一度判成"叠加失败"——
   它报的从来不是我脚下这棵树。叠加成功与否要用**构建**和**产物在不在**来判。
2. **"构建输入解析得到" ≠ "构建得出来"**：前者只查文件存在性，后者还查导出成员契约（dts 那一步）。
   `app-host` 这一枚就是"ESM 出得来、dts 出不来"，所以一条尺绿不能替另一条尺绿。

叠加清单（撤除前的现量，逐枚 sha256 前缀，来自**主检出工作树**）：
`d647a635142b415d apps/web/src/lib/native-widgets.ts`、`19934156c9fe7668 packages/app-host/src/task-batch-actions.ts`、
`db05322b3f4a6796 packages/ui/src/empty-state/StateIllustration.tsx`、`8a6edf9fc480870a packages/ui/src/habits/HabitArtwork.tsx`、
`22b803d1416464e4 packages/ui/src/habits/HabitMetricIcon.tsx`、`ccc66edb7f089a11 packages/ui/src/auth/PasswordStrength.tsx`、
`4408ec692c7549c3 packages/ui/src/auth/LegalDocumentSheet.tsx`、`728ba7b330d89c73 packages/ui/src/ai/AssistantMark.tsx`、
`a334dca4aaec4ace packages/ui/src/ai/AiGeneratedLabel.tsx`。

### 6.58 那三条"HEAD 上的红"是**载体没生成 Prisma 客户端**，不是产品红；补一条五秒前置判据，并把两臂重取成干净读数（10-10 02:16 现量，载体已复原）

上一轮在本线核心那枚 spec 上读到 `3 failed | 33 passed`，而主检出同一棵 HEAD 内容 `36 passed`，
我把它记成"纯 HEAD 上本线有 3 条红"。**这句是错的**，根因在载体：

- 三条红的共同形状是 `err.code` 为 `undefined`（不是加载失败、不是断言值差一位）。
  把 `capture()` 里那句 `catch` 加一行诊断打出来，收到的实际是
  `TypeError: Right-hand side of 'instanceof' is not an object` ——
  生产侧 `email-change.ts:226/:386` 写的是 `err instanceof Prisma.PrismaClientKnownRequestError`，
  而在那棵 worktree 里 `typeof Prisma.PrismaClientKnownRequestError` 是 **`undefined`**：
  **它从来没跑过 `prisma generate`**（生成物住在 `node_modules/.pnpm/@prisma+client@*/node_modules/.prisma`，
  主检出有、载体没有 ⇒ 同一个 `import { Prisma } from '@prisma/client'` 在两边给的不是同一套成员）。
- 所以凡是**走唯一索引那条 P2002 映射**的判据在载体里恒红。这三条恰好全是这一族
  （`email_taken` 两轨 + `invalid_change_link` 反枚举那一族）。
- `cd server && npx prisma generate` 在载体里 rc=0 就补上了。AGENTS §6 那句"沙箱里跑不了 `@heyta/sync-server`"
  指的是**安装生命周期**里的 `prisma generate` EPERM，不是这条命令本身。

补完生成物后，本线服务端那六枚 spec 在**纯 main tip** 上一趟读干净（`167 passed (167)`，6 个文件）：
`email-change` / `email-change-page` / `account-security.routes` / `access-sessions` / `password-recovery` / `account-profile`。
⇒ **"HEAD 上有 3 条产品红"否证**；本线的服务端判据在 HEAD 上是绿的。

两臂因此在干净基线上重取一次（基线 `36 passed`，各**恰好红 1 条**、红的是本就该红的那条）：

| 臂 | 变异 | 唯一那条红 |
|---|---|---|
| C | 删掉生效那一步的 `await revokeAllDeviceSessions(after.userId);` | 🔴 生效必须关掉全部实时通道并删掉会话行（计数器只管得住下一次 HTTP 请求） |
| D | 把"只点一边"那条分支的 `applied: false` 改成 `true` | 🔴 J-W1a 只点一边 ⇒ `users.email` 一字不变、计数器不动、applied:false |

⇒ §6.56 那两臂 A/B 的读数**不受这件事影响**：`account-security.routes.spec.ts` 不碰 P2002，
而那里基线是全绿（两臂各 `1 failed | 29 passed`，红的都是本条边界那一句）。

前置判据（以后在任何隔离 worktree 里取服务端读数之前先跑这一条，五秒）：

```bash
( cd server && node -e "const {Prisma}=require('@prisma/client');console.log(typeof Prisma.PrismaClientKnownRequestError)" )
# 期望 function。读到 undefined 就在这棵载体里 npx prisma generate，别把由此产生的红写进台账。
```

⚠️ 顺带一条载体卫生，同一个坑的两半：在载体里 `pnpm --filter … exec` **会重写 `pnpm-lock.yaml`**
（实测 −101/+9，因为那棵树里没有别人未提交的包）。所以
1. 复验"变异已还原"要用**带 pathspec** 的 `git diff --quiet -- <文件>`，不带 pathspec 会被那枚锁文件永久判脏；
2. 收尾要 `git checkout -- pnpm-lock.yaml`，否则下一位在载体里读到"不干净"会以为是我留的。

可迁移的形状：**"红在 `err.code === undefined`"这一族要当成一类读**。它不是"某个码写错了"，
而是**那条映射分支整条没跑到**——`instanceof` 右侧 undefined、模块双实例、桩少了成员，三种成因在输出上长得一样，
而三种里只有"产品真的漏了映射"那一种该记进台账。

### 6.59 `pnpm -r build` 在**纯 main tip** 上就是红的：`packages/ui` 的 barrel 已入库、它导出的那 11 枚来源没入库（本线两趟运行时腿真正等的是这一格，10-10 02:25 现量）

§6.57 把两趟运行时腿的等待条件写成"别人一整片在飞实现"。这一轮把那片量成了两个数，
并且**结论比"在飞"更硬**：那 11 枚还没入库，而引用它们的 `packages/ui/src/index.ts` **已经在 main 上了**。

载体：`.worktrees/iosacct`，`git checkout --force` 到当时的 `refs/heads/main`，`git status --porcelain` 空，
Prisma 客户端已生成（§6.58 那一格修好之后）——所以这两条读数不再混着载体的账。

- `pnpm -r build` ⇒ rc=1，第一枚红的是 `@heyta/ui`（`tsup`：esbuild 阶段 `Could not resolve` + dts 阶段一批 TS 错）。
- `pnpm --filter '@heyta/mobile...' build` ⇒ 同样 rc=1（`apps/mobile` 的 `@heyta/*` 依赖清单里有 `@heyta/ui`）。
  ⇒ **iOS 设备腿与 web 运行时腿不是等负载、也不是等模拟器窗口，是等这一格**：从干净检出打不出当前源码的产物。

两类缺口逐枚列（每条都带现量命令，别抄这里的数）：

| 类 | 内容 | 现量 |
|---|---|---|
| A **实现文件从未入库**（工作树 `??`） | `packages/ui` 下 `empty-state/StateIllustration.tsx`、`habits/HabitArtwork.tsx`、`habits/HabitMetricIcon.tsx`、`auth/PasswordStrength.tsx`、`auth/LegalDocumentSheet.tsx`、`ai/AssistantMark.tsx`、`ai/AiGeneratedLabel.tsx`（另有它们各自依赖的 `empty-state/artwork.ts`、`auth/password-strength-model.ts`、生成物 `habits/habit-artwork.generated.json`） | `git cat-file -e HEAD:<路径>` 失败而 `test -e <路径>` 成立；`git log --diff-filter=A -- <路径>`（**不带 `--all`**）为空 = 本历史从没新增过它 |
| B **成员只在工作树版里**（文件是入库的，那一行是 `M`） | `calendar/model.ts` 的 `calendarTaskSpan` / `groupTasksByCalendarDate` / `CalendarTaskSpan`、`theme.tsx` 的 `useHeytaUiLocale`、`ai/AiDisclosure.tsx` 的 `AI_DISCLOSURE_FIELD_GROUPS` | `git grep -c <符号> HEAD -- <文件>` 为空 + `grep -c <符号> <文件>` ≥1 + `git status --porcelain -- <文件>` 报 `M` |

⚠️ 取"从未入库"这句话的时候别用 `--all`：本线自己就留过三笔**验证用的候选提交**
（`74d39be4`、`845e81c9`、`f1edde47`，标题都写着"不进 main"），带上 `--all` 会把它们读成"入库过 5 次"。
判"在不在 main"用**当前分支历史**，判"在不在这一棵提交树"用 `git cat-file -e HEAD:<路径>`。

**归属**：把那些 `export` 行带进 main 的是 `e6058120`（标题写作 `docs(产品体验线 台账 §UX-S9-153)`，
而它改 `packages/ui/src/index.ts` **+57/−15** —— 一笔"台账"标题的提交里带着共享层的 barrel）。
`git merge-base --is-ancestor e6058120 refs/heads/main` = 是。
⇒ **归 产品体验线**（它的落点与那份台账都在 `docs/plans/product-ux-optimization.md` 那条线），本线不代改：
那 11 枚来源在别人工作树里正被写，删 `index.ts` 那些行会让他们的界面整片消失，
补提交它们又等于替别人决定入库时机 —— 两半都不是本线的资产。

🔴 **一条比"我的腿被挡住"更要紧的读数，交给负责人**：`pnpm check` 的第**二**步就是 `pnpm build`
（`check → check:gate-wiring && build && …`），而**主检出里这一道现在是绿的**——绿的原因是工作树里躺着那 11 枚未入库文件。
也就是说"门禁全绿"目前**依赖没进仓库的代码**：干净检出（CI 的唯一形态，也是任何一台新机器）会在第 2 步就红，
AGENTS §6.1.1 那套 `pnpm reinstall:all` 固定收尾在干净检出上同样走不通。
仓里**没有任何一道门禁**在守这一格：`scripts/check-imports-resolve.mjs` 存在，但它**不在 `pnpm check` 链里**
（现量：`python3 -c "import json;print([k for k,v in json.load(open('package.json'))['scripts'].items() if 'imports-resolve' in v])"` = `[]`）。
⇒ 这一格要补的判据形状与 §6.55 那条"写了没人挂"完全同型：**一道能红的构建输入对账**（把 `index.ts` 引用的
每一枚 `./x.js` 与 HEAD 的文件清单对账），而不是再多一份说明。要不要现在立这道门属于**判据口径**，归负责人拍。

可迁移的形状：**"共享层的 `index.ts` 提交了、实现文件没提交"这一型，任何按文件看的静态门禁都看不见**——
每枚文件单独看都合法，只有"引用必须解析到已提交对象"这一条能抓住它。这与 §6.55（路由写了没挂）、
§6.50（面板写了没 mount）是同一族的第三种面目：前两种是"写了没人消费"，这一种是"**消费的东西不在仓库里**"。

### 6.60 §5 第 17 条那一半缺口关掉了：撤销那一枚现在当场断掉那一枚的通道（判据在无 mock 的运行时层，三臂各红；10-10 02:45 现量）

改前三层里有两层**结构上看不见**这件事：单元层用假 prisma、HTTP 层用 `app.inject`，
两者都把 `websocket-connection.service` 整个 mock 掉 ⇒ 把 `revokeSession` 里那句 `closeForSession` 整行删掉，
那两层照样全绿。这正是第 17 条写的"缺的那一半是一条已经建立的连接"，所以这一格**必须**落在一趟真连接上。

产品侧的形状（`be4e41b4`）：
- upgrade 时把**服务端自己验出来的** `sessionId`（= `jti` 的 SHA-256，`auth.ts:338` 已经算好了，只是没人往下传）
  记进连接簿记，撤销那一行真删掉时 `closeForSession(userId, sessionId)` 只关那一枚。
- 🔴 **不按 `clientId` 关**：那是查询串里客户端自报的值，冒认别台的 id 就能让自己的连接免关
  （`closeForClient` 自己的注释也这么写，而它**一个调用点都没有** —— 死代码，别读成"已经有这一半"）。
- `addConnection` 的第四枚参数**必填、不给默认值**：给了默认值 = 把"宿主没接"伪装成"做完了"（traps #195 那一型）。
- 修在收口处：close 挂在 `revokeSession` 里，所以「退出登录」那条走同一枚助手的**一并生效**，没有第二份实现。

判据（`0c7e7476`）分两层，都在**默认通道**里有人跑：
- 单元/HTTP 层：服务级四条（只关那一枚／`sessionId` 为 `null` 的旧令牌那档不许被误关／按用户分域／未知 id 不炸）
  + 路由级"恰好一次且带那一枚的 id" + "撤不动的那一枚一个通道都不许关"。
- 运行时层：`server/tests/integration/session-revoke-websocket.integration.spec.ts`
  （真 PostgreSQL + 真 Fastify + 真 `ws` 客户端；形状照仓内既有的 `websocket-storm` 那枚，没另造一套夹具）。
  四条 = 前提两条连接真 up、撤销 A 关掉 A、B 那台不许被牵连、撤不存在的 id 谁都不许多关。
  已进 `test:integration:postgres` 点名清单，`check:integration-coverage` rc=0（盘上 34 枚逐一对上）。

读数（载体 `.worktrees/iosacct` 纯 `refs/heads/main` + 主检出，逐趟 NO_COLOR）：

| 趟 | 读数 |
|---|---|
| 运行时基线 | `4 passed (4)`，其中 A 的 close 在 **1 ms** 内到达，`{code:4003, reason:'Session revoked'}` |
| 臂E（`revokeSession` 不关那一枚 = 改前行为） | `1 failed`，红的是"撤销 A 关掉 A"，**5 s 内没有任何 close** |
| 臂F（逐枚去关整个账号） | `1 failed`，同一条红，received 是 `{4003,'Token revoked'}` |
| 臂G（upgrade 没记 session id，即接线半漏） | `1 failed`，同一条红，5 s 无 close |
| 单元/HTTP 层基线 | 五枚 spec `134 passed (134)`。<br>⚠️ 10-10 03:2x 标注：这一行没写取数的那棵树，而它若含 `password-auth-routes.spec.ts`，**就不可能是纯 HEAD 的读数** —— 那枚 spec 的 W10 两条在补接线之前于纯 `2647f768` 上是红的（A/B 与归因在 §6.66）。数值保留，层级按 §6.66 读 |
| `check:session-revocation` | rc=0（`bump=6 违规=0 豁免命中=1 计数逐字相符`）—— 新增这句不抬计数器，所以那道结构门禁没有被迫改口径 |

🔴 **这轮最值钱的一条是判据自己的形状**（不是产品）：第一版运行时判据我只比 close 的 **code**，
于是臂E 与臂F **两臂都活着**（`4 passed`）—— 4003 那一档两种实现都发，"精确关掉那一枚"和"整个账号一起关"
在它眼里长得一样，而后者正是这一族最危险的错法。加上 `reason` 逐字对之后三臂各红自己该红的那条。
⇒ **一条断言只比"状态码/枚举值"而不比"是谁、为什么"时，它会同时放过两种相反的错法**；
补一条对照（臂F 那种"越界实现"）比多写几条正向用例更能回答"这判据能不能红"。
复取：`cd server && DATABASE_URL=postgresql://$(whoami)@127.0.0.1:5432/heyta_account_w9?schema=public npx vitest run --config vitest.integration.config.ts --maxWorkers=1 tests/integration/session-revoke-websocket.integration.spec.ts`

⚠️ **两条没包装的边界**：
1. 本轮之前签的、没有 `jti` 的令牌仍然认不出对应哪条连接 ⇒ 那一档还是等它自己重连（ADR-0063 §4 第 1 条原样）。
   运行时层对此**没有**判据可写（要一条旧令牌 + 一条连接的组合，而那枚令牌在新库里造不出来），
   它由单元层"`sessionId` 为 `null` 的连接不许被误关"那条反向钉住 —— 反向，不是正向。
2. 臂E 有一趟观察到的是 `{4003,'Invalid token'}` 而不是"无 close"（另一趟是 5 s 无 close）。
   那句 `Invalid token` 是**又一次 upgrade 尝试**被拒时发的（行已删 ⇒ 验签过不了），
   不影响红/绿（两种读数都不是 `Session revoked`），但说明这一层还混着一条"重连即拒"的既有路径，
   别把它读成"改前也在关连接"。
3. 单元/HTTP 层的两臂**随后取到了**（10-10 02:49，当时被本机内存闸门按余量那一维拒了一趟：`立即可用 109MB < 384MB`，
   不是产品红）—— 而臂G 在那一层**活了**，那一格单独记成 §6.61 并当场补了判据。
   复取命令：`cd server && npx vitest run tests/websocket-connection.service.spec.ts tests/websocket.routes.spec.ts tests/account-security.routes.spec.ts`
   ⚠️ 变异还原的经验：`io.open(p,'w')` 求值时**文件已经被清空**，之后再去读 `.mut-bak` 抛异常就会把源码留在 0 字节
   （本轮真遇上一次，靠 `git show HEAD:<路径>` 重建 + 只重放自己那一处 hunk 恢复，`git diff` 复核过）。
   要留快照就用**内存里的字符串**，别用"先落盘 bak 再读回来"。

顺带三条**别的线的红**，本轮现量到、归属写清楚，不记在本线账上：
- `pnpm --filter @heyta/sync-server test` 在主检出是 `6 failed | 2738 passed`。其中 `sync-compressed-body.routes.spec.ts` 那 5 条
  在**纯 main tip 的载体里全绿** ⇒ 红在主检出那几枚 `M` 的 `server/src/sync/*`（同步那条线在飞）。
- `validation.service.spec.ts:667` 的 `expected 18 to be 17`（`ALLOWED_ENTITY_TYPES.size` vs `HEYTA_ENTITY_TYPES.length`）
  **在纯 HEAD 上就红** ⇒ HEAD 级红，跨层词表漂移，与 §6.20/§6.21 同族；归共享 schema 那条线，不在本线文件上。
- 在载体里跑 `pnpm -r build` 会**改写被跟踪的** `apps/landing/docs/**/index.html`（本轮 30 枚 `M`）⇒
  构建写跟踪产物，读"载体干不干净"之前要先 `git checkout --` 它们，否则下一位会以为是别人在飞。已复原并复核为空。

### 6.61 那条"接线判据"其实是**镜像**：把生产里第四枚参数摘掉，整组 31 条照样全绿（10-10 02:49 现量，已补一条按源码读的）

§6.60 收尾时留了一条"单元/HTTP 层两臂未取（闸门拒）"。补取之后它不是"补个读数"，而是照出一件判据本身的事：

| 臂 | 单元/HTTP 层（`websocket-connection.service` + `websocket.routes` + `account-security.routes`，基线 `94 passed`） | 运行时层 |
|---|---|---|
| E：`revokeSession` 不关那一枚 | `1 failed` —— 红的正是本线那条正向断言（`closeForSession` 恰好一次、带那一枚的 id） | `1 failed`（5 s 无 close） |
| G：`upgrade` 没把 `result.sessionId` 记进连接 | 🔴 **`94 passed` —— 活了** | `1 failed`（5 s 无 close） |

原因在 `websocket.routes.spec.ts`：它整组跑的是文件里自己重写的 `simulateWsHandler`
（文件头明写着 "mirrors the exact validation flow"），**不是** `src/sync/websocket.routes.ts` 那枚处理函数。
所以它对生产漂移天生是瞎的 —— 我在镜像里加的那条"第四枚参数等于服务端验出的 session id"也确实会红，
但它红的是**镜像自己被改**，不是产品被改。⇒ 与 §6.55（路由写好了没人挂）、§6.50（面板写了没挂载）同族，
只是这一型更阴：**判据看起来在测那条路由，实际在测它自己的副本**，而且副本还通过了全部 31 条。

补法照 §6.55 的形状：新增一条**读生产源码**的接线判据（`addConnection` 调用点必须带 `result.sessionId`），
外加一条阳性对照（不许把客户端自报的 `clientId` 当会话凭据 —— 那条冒认得起）。读数：

- 基线 `31 passed (31)`；
- 臂G ⇒ `1 failed`，红的正是新加那条接线判据；
- 臂H（把第四枚参数换成 `clientId`）⇒ `2 failed`，两条各红一次 ⇒ 阳性对照证明第二条款**真的会红**，不是装饰。

⇒ 现在这一半接线的覆盖形状是：**默认通道里有一条静态对账**（会红，但不验行为）+
**一条真连接运行时判据**（验行为，但要本地库、走 `test:integration:postgres`，不在 `pnpm check` 链里）。
两边都缺一边都会漏：只有静态 ⇒ 传对了值但连接簿记没用它也不知道；只有运行时 ⇒ 那一趟没人跑就等于没有。

可迁移的一条：**看到"某文件的 spec 全绿"之前，先问这个 spec 调的是生产导出还是文件里的镜像函数**。
判据是 `grep -n "async function simulate\|function mock_\|mirrors" <那枚 spec>` ——
命中就说明那一组在测副本。镜像本身不一定错（有些分支用真 HTTP 造不出来），但它**不能算成接线证据**。

### 6.62 本线服务端那一层在新尖上的合并读数：两枚集成套件一起 `18 passed`（10-10 02:53 现量，载体已复原）

上面几笔落完之后重新取一次"这一层合在一起是不是绿的"，而不是只看新加那一枚：

```bash
cd .worktrees/<载体> && git checkout --force $(git rev-parse refs/heads/main)
# 前置三件，缺一件就整组读不到（都是载体账，不是产品账）：
# ①§6.58 那条 Prisma 判据  ②server/node_modules/@heyta/inbound-core 那枚按 lockfile 本该存在的链接
#   （缺了的症状是 `Cannot find package '@heyta/inbound-core' imported from src/entitlement.ts`，
#    两枚 spec 都以 **[文件]** 形状报"加载不到"，一条用例都不会起跑）  ③跑完 `git checkout -- pnpm-lock.yaml`
(cd server && DATABASE_URL="postgresql://$(whoami)@127.0.0.1:5432/heyta_account_w9?schema=public" \
  npx vitest run --config vitest.integration.config.ts --maxWorkers=1 \
  tests/integration/email-change-and-sessions.integration.spec.ts \
  tests/integration/session-revoke-websocket.integration.spec.ts)
```

读数：`Test Files 2 passed (2)` / `Tests 18 passed (18)` —— W9 那 14 条（真库换绑 + 会话撤销全链）
与本轮新增那 4 条（真连接撤销 A／B 不被牵连／幽灵 id 不许多关／前提两条连接真 up）**同趟**绿。
载体跑完已把链接撤掉、锁文件复原、`git status --porcelain` 逐字为空。

⚠️ 这一格回答的问题有边界，别读多：它只说"**服务端那一层**在本线的文件上是绿的"。
🔴 10-10 03:2x 补一条它当时没说出口的边界：这 `18 passed` 本身是**载体纯 tip** 的读数，成立且今天重取仍是 18；
但同一层里另有两条本线的 🔴 判据（工单 W10 的 UA）在纯 HEAD 上是**红的**，本线当时没看见 —— 见 §6.66 的 A/B。
⇒ "**服务端那一层**在本线的文件上是绿的"这句要收窄成"**这两枚集成套件**在纯 HEAD 上是绿的"。
运行时腿（iOS 设备、真浏览器）仍然等 §6.59 那一格（`packages/ui` 的 barrel 已入库、它引用的 11 枚来源没入库），
而默认通道 `pnpm check` 里本线的红也不在这层：见 §6.17 / §6.20 / §6.21 / §6.59 / §6.61 / **§6.66** 各自归属。

### 6.63 默认通道那条 `expected 18 to be 17` 是一台"只会因为自己过期而红"的机器（10-10 02:57 现量，归 产品体验线，本线不代改）

§6.62 提到 HEAD 上那条红（`server/tests/validation.service.spec.ts:667`，`ALLOWED_ENTITY_TYPES.size` vs
`HEYTA_ENTITY_TYPES.length`）时只写了"跨层词表漂移"。这一轮把它量到底，结论是**链上没有任何不一致**，
红的是判据自己的第三份手抄清单。

现量（载体纯 `refs/heads/main`，两条都是同一棵树上读的）：

| 趟 | 读数 |
|---|---|
| 只读，不改 | `1 failed / 62 passed (63)`，红的就是那条 count 断言 |
| 阳性对照：**只**往那枚副本里补一个 `'COMMENT'` | `63 passed (63)` |

差的正是 `COMMENT`。它的来历：`e6058120` 把 `'COMMENT'` 加进 `packages/shared-schema/src/entity-types.ts`
的 `ENTITY_TYPES`（与 §6.59 那格**同一笔**），没动这枚副本。

三份清单的受控程度各不相同，这是这格的全部成因：

- 服务端：`ALLOWED_ENTITY_TYPES: Set<string> = new Set(ENTITY_TYPES)` —— **派生**，不可能与单一来源不一致。
- 领域层：`packages/domain` 的 `MODELED_ENTITY_TYPES` 带**编译期兜底**（`AllModeledAreListed`：清单漏掉
  `EntityModelMap` 任何一个键就编译不过）+ 一条运行时守卫。
- 服务端那枚 spec：一份**手抄数组**，没有任何一层看着它。⇒ 唯一会红的就是这份副本没跟上。

🔴 由此这条判据**照不出任何产品缺陷**：它比的是"我的抄本"与"抄本所抄的那个派生集合"的长度，
而后者永远相等。真有牙的是同一文件 `:670` 那条（不许接受 Super Productivity 专属实体）。
⇒ 修法有两个候选，**口径归负责人**（本线不代改别线判据）：
① 往抄本补 `'COMMENT'`（一行，恢复绿，但同一台机器下一次加实体还会再红）；
② 让这条判据去量一个真正会变的东西 —— 例如断言"客户端可构造的实体集合 ⊆ 服务端白名单"两侧都取被约束的那份源，
把"不许多收"写成真判据，删掉长度相等这一条。
复取：`cd .worktrees/<载体> && git checkout --force $(git rev-parse refs/heads/main) && ln -sfn ../../../packages/inbound-core server/node_modules/@heyta/inbound-core && (cd server && npx vitest run tests/validation.service.spec.ts)`
（载体三件前置照 §6.62；跑完 `git checkout -- pnpm-lock.yaml` 并撤链接。）

可迁移的形状：**"手抄清单的长度 == 派生集合的大小"这类断言是一台只会因为自己过期而红的机器**。
它看起来像护栏（每次加实体都要有人动测试），实际把"审查"实现成了"改一个数字"，
于是它的红既不能拦住真正的漏改（比如 §6.59：加了实体却没人检查法务文本与存储层），
又会在什么都没坏的时候长红。要么删，要么让它去量两侧都可能变的东西。
同一枚病在本线已经出现过：§6.52 那条"引用的词条在不在词表"我准备写门禁前先量了编译器已经管着 ⇒ 没写。

### 6.64 那两腿 runtime 证据的拦路（§6.59）现在有两条秒级只读谓词，不必再重跑整条 build（10-10 03:0x 现量）

产品体验线 02:5x 那一笔（`54e1a7d7`）写的是"本轮没有重跑 install / build 本身（要新建检出 + 2.8 G 全新装，此刻负载 26），
量的是产生那条报错的谓词"。这一轮把那两条谓词固定下来 —— 它们就是 §6.59 那格的两类成因。
只读、零依赖安装、零构建，本机实测 1.4 秒。

**类 A（来源文件完全没入库）**：

```bash
git show HEAD:packages/ui/src/index.ts | grep -oE "from '\./[^']+'" \
  | sed "s/from '//;s/'$//" | sed 's/\.js$//' | sort -u \
  | while read f; do found=""; for ext in ts tsx; do p="packages/ui/src/${f#./}.${ext}"; [ -e "$p" ] && found="$p"; done; \
      if [ -z "$found" ]; then echo "ABSENT_ON_DISK ${f#./}"; elif ! git cat-file -e "HEAD:${found}" 2>/dev/null; then echo "UNTRACKED_IN_HEAD $found"; fi; done | sort
```

03:0x 读数：**7 枚 `UNTRACKED_IN_HEAD`，`ABSENT_ON_DISK` 0 枚** ——
`ai/AiGeneratedLabel` `ai/AssistantMark` `auth/LegalDocumentSheet` `auth/PasswordStrength`
`empty-state/StateIllustration` `habits/HabitArtwork` `habits/HabitMetricIcon`
（与工作树侧同刻的 `packages/ui/src` = 42 枚 `M` + 11 枚 `??` 一并看：文件数比 7 大，因为那 11 枚里含类 B 的文件与它们各自的依赖。）

**类 B（文件入库了，被引用的成员只在工作树版里）**——逐枚对符号，`HEAD=` 那列为**空**就是这一枚缺
（`git grep -c` 无匹配时整行不输出，所以这里读"空"而不是 0）：

```bash
for pair in "calendar/model.ts:calendarTaskSpan" "calendar/model.ts:groupTasksByCalendarDate" \
            "calendar/model.ts:CalendarTaskSpan" "theme.tsx:useHeytaUiLocale" \
            "ai/AiDisclosure.tsx:AI_DISCLOSURE_FIELD_GROUPS"; do
  f="packages/ui/src/${pair%%:*}"; s="${pair#*:}"
  printf "%-40s %-28s HEAD=%s disk=%s git=%s\n" "$f" "$s" \
    "$(git grep -c -- "$s" HEAD -- "$f" 2>/dev/null | cut -d: -f3)" \
    "$(grep -c -- "$s" "$f" 2>/dev/null)" "$(git status --porcelain -- "$f" | awk '{print $1}')"
done
```

03:0x 读数：五枚符号 `HEAD=` 全空、`disk` 分别 3/1/2/1/1、三枚宿主文件 `git=M` ⇒ 类 B 成立的是
**三枚文件里的五枚成员**（`calendar/model.ts`、`theme.tsx`、`ai/AiDisclosure.tsx`），与 §6.59 那张表逐枚对上。
⚠️ 符号要给**声明处的写法**，别照 barrel 写成 `type CalendarTaskSpan` —— 声明是 `export interface CalendarTaskSpan`，
带前缀去 grep 会把一枚真缺口读成 `disk=0`（本机第一次就是这么读的，已按去前缀的写法重取）。

⇒ **A 红了就足以判定 HEAD 打不出包（充分条件）；A 绿了还不能判定拦路已撤**，因为 B 是另一种形状（文件在、成员不在）。
本线那两腿（iOS 设备 / 真浏览器）的关闭判据因此是"这两条谓词都空 **且** 载体上 `pnpm -r build` rc=0"，
后者不能省 —— 谓词是"必要且好查"，构建才是"充分"。

登记这一条的理由不是它新，是它**改变了等法**：之前 §6.59/§6.62 写的都是"等别人提交完"，而这句话没法检查；
现在它是两条命令，下一位（或本线下一轮）先跑这两行，再决定要不要花那 2.8 G 新建一棵检出。

⚠️ 一条踩过的写法：把类 B 的检查自动化成"把 barrel 里 `export { A, B } from './x'` 的名字逐个去 HEAD 的那份文件里找"是**不可用的** ——
本机实测它一次报出 **169** 枚"缺失"，而绝大多数是 `export { type Foo }` 那个 `type ` 前缀造成的假红
（声明处写的是 `export interface Foo`），另有注释块里的示例文本与 `as` 改名两种形状也会命中。
那 169 枚我**没有逐枚复核**，所以这一格的读数只认按 §6.59 那张表手点的五枚符号 + `git grep <符号> HEAD -- <文件>`。
要把类 B 做成自动判据的人，得先把这三种形状处理掉，否则它会比 §6.63 那条更长红。

### 6.65 §5 第 7 条那一格没有闭合，而且它有一半是本线自己造的（10-10 03:0x 现量，纯 HEAD 与共享检出两臂）

去检查它是因为 `20261018160000_add_automation_entitlement_tickets` **已经进 main 了**（`git ls-tree -r --name-only HEAD -- server/prisma/migrations` 现量：
它之后还有 `…170000 / …180000 / …190000`），也就是说 §5 第 7 条写的等待条件按字面已经满足 ⇒ 该收这一格了。
读数是：**没闭合，而且比登记的更糟** —— 那两格红**在纯 HEAD 上也在**。

| 臂 | 载体 | 读数 | 缺类别名的表 | 级联数字 |
|---|---|---|---|---|
| A | 隔离载体纯 `refs/heads/main`（`39eb92e9`） | `2 failed / 60 passed (62)` | **17 枚** | 文案 20 处 / 19 张，真源 37 条 / 36 张 |
| B | 共享检出（本线 parked 的那份文案在工作树里） | `2 failed / 61 passed (63)` | **3 枚** | 文案 34 / 33，真源 37 / 36 |

两枚红的判据（都在 `packages/legal/tests/structure.spec.ts`，`对外文本里可复算的数字，回到真源对账` 那一组）：
`:489` "每张随注销消失的表都在文案里有一个用户读得到的类别名"、`:533` "所有抄了「N 处级联 / N cascades / N foreign keys」的文档、中英两栏，都等于真源条数"。

**臂 B 是决定性的那一臂**：它说明本线那份还没入库的文案一旦落，`17` 会降到 `3` ——
剩下的三枚（`automation_entitlement_activations` / `_links` / `_subjects`）连名字都还没有，
数字差也从登记的 "+2" 变成 **+3**。它们由 `3fcc3bef`（10-09 18:25，`feat(自动收集 持久层)`）带进来，
而本线写下 §5 第 7 条那次登记时那三枚还不存在（当时登记的是 `20261018160000` 那两枚）⇒ 那句"两张 / +2"之外又多出三枚，数字差跟着变 +3。
⇒ 原文那句"等 `20261018160000` 补完对外文案为止"整句作废（已就地更正）。

17 枚逐枚归属（判据自己的推导复刻一遍：`CREATE TABLE` 在 HEAD 各迁移里的位置 → `git log --full-history --diff-filter=A` 找把它带进 main 的那笔）：

| 带进 main 的那笔 | 表 | 归属 |
|---|---|---|
| `703cafc8`（本线服务端一笔） | `access_sessions`、`email_change_requests` | **本线**：类别名写在 parked 文案里（`privacy.ts:404` 枚举"登录会话""邮箱变更请求"、`personal-info-list.ts:236 / :243` 两行），**没入库** |
| `9fa53ab9`（**本线"立 ADR-0063"那笔**） | `automation_workers`、`automation_commit_permits`、`automation_rules`、`automation_events`、`automation_recipient_keys`、`shares`、`share_invitations`、`share_members` | **别线的持久层 + 别线的类别名**：那笔提交一共带了 **6 枚迁移目录**（另有 `20261018000000_add_automation_grant`、`20261018110000_separate_direct_automation_ai_attempts`），而它正文里的"归属说明"只声明了 `docs/plans/README.md` 那 3 行 |
| `e8b3e982`（自动收集 服务端） | `automation_ai_attempts`、`automation_sender_credentials`、`automation_entitlement_bindings`、`automation_entitlement_ticket_uses` | 自动收集线 |
| `3fcc3bef`（自动收集 持久层） | `automation_entitlement_activations`、`automation_entitlement_links`、`automation_entitlement_subjects` | 自动收集线 |

🔴 **本线的责任有两处，都不在"别人没提交"这一侧**：
① `9fa53ab9` 把别的线**尚未配好对外文案的持久层**一次性带进了 main —— 这是 §6.50 / §6.55 / §6.59 那一族的**第四种面目**：
§6.55 "路由写了没挂"、§6.50 "面板写了没 mount"、§6.59 "barrel 入库而来源文件没入库"，这一格是"**表建好了、界面上读得到它的那句话还不存在**"。
② 本线自己那枚迁移 `703cafc8` 也先入库了，而它的类别名躺在 parked 文案里（同一件事，只是成员换成我）。

**这一格为什么不能由本线现在收**：类别名与"共 N 处级联 / 覆盖 N 张表"是**对外承诺**（判据口径，归负责人；
本线在 §5 第 7 条、§6.59、§6.63 三处都按这条停手）；而承载它们的那几枚文件此刻正被别的会话写
（现量：`packages/legal` 下 7 枚 `M` + 3 枚 `??`），本线落任何一行都等于替别人决定入库时机。
⇒ 交给负责人的一句话判断是：**要么由自动收集线把这三枚的名字与数字补完，要么把 §5 第 7 条改成一条长期边界**，两个都比"本线代写"干净。

复取（两臂各一条，秒级）：
```bash
# 臂 A（纯 HEAD；先 `git checkout --force $(git rev-parse refs/heads/main)` 把载体钉到尖上，三件前置照 §6.62）
cd .worktrees/<载体>/packages/legal && NO_COLOR=1 npx vitest run tests/structure.spec.ts
# 臂 B（共享检出，读 parked 文案的那一份）
cd packages/legal && NO_COLOR=1 npx vitest run tests/structure.spec.ts
```

🔴 **HEAD 为什么能带着这两枚红长这么久**：判据**在**默认通道里（`packages/legal` 有 `test` 脚本 ⇒ `pnpm check` 末尾那步 `pnpm -r test` 会跑它），
停的是**执行者**：`gh run list -L 5` 现量最近一枚 CI run 是 `2026-10-05T16:32:52Z`（结论 failure），
而 `git rev-list --count --since='2026-10-05T16:33:00Z' refs/heads/main` = **321** ——
321 笔 main 提交没有一笔被那道链跑过。⇒ 这条与 §6.55（判据写了没挂进链）同型但方向不同：
**那一格缺消费者，这一格缺执行者**。恢复 CI 属于运维口径（见记忆「CI/CD 因代理流量额度暂停，改 SSH」），本线不代做。

⚠️ 取证时踩到的一个分母坑，值得单独留形：`git show --stat 9fa53ab9 | grep prisma/migrations` 命中 **0 枚**，
而同一笔用 `git show --numstat` 全路径读是 **6 枚**。`--stat` 会把长路径中段缩成 `...`（这笔的输出里就有
`.../inbound-recovery/…png` 那种形状），所以"我这笔没带迁移"这个**否结论**差一点就从一条 grep 上写出去了。
判"某笔提交带没带某类路径"要用 `--numstat` / `--name-status`，`--stat` 只配给人看形状。（同一族：负结论也要枚举分母。）

### 6.66 本线自己那两片接线一直没入库：两道在 `pnpm check` 链里的门禁与两枚 🔴 判据在纯 HEAD 上是红的（10-10 03:2x 现量并修完，`d0ea794d`）

起因只是取一格读数（"整包 server 单测在纯 HEAD 上是多少"）。读数是 `5 failed / 2728 passed`，
逐条归因之后发现**其中两枚红是本线的**，而根因不是别人：
`703cafc8`（本线 10-09 16:31 服务端那一笔）把**判据、helper、函数签名都入库了，唯独调用点没入库** ——
那些调用点全在 `server/src/api.ts` 里，而这枚文件同时被另外两线在写，所以整枚文件不能代提交，
于是它一直躺在共享检出里，本线此前每一次"绿"都是在含有它的树上取的。

HEAD 上的实际后果（都在 `pnpm check` 链里，不是登记在册的边缘）：

| 那一格 | 现量（载体纯 tip） | 它意味着什么 |
|---|---|---|
| `check:token-minting` | rc=1：`文件=116 签名=2 import=2 调用=6` | 通行密钥登录里那份裸 `jwt.sign` 签出的令牌**没有 `jti`** ⇒ "退出登录"在**主力登录路**上什么都撤销不了（ADR-0063 §4 第 1 条那条边界被扩大到一条正常路径上） |
| `check:email-normalization` | rc=1：`违规=1`（`api.ts:localeForEmail` 自己拼 `email.toLowerCase()`） | `users.email` 与 `pending_email` 两张唯一约束按两套标准裁决同一个地址（工单 W8 原话的那种形状） |
| `password-auth-routes.spec.ts` 两枚 🔴 | 会话行的 `user-agent` 收 `null` | 工单 W10 那句"「登录设备」列表里唯一认得出来源的一列"在 HEAD 上是空的 |

补的就是那**十处接线**，一行不越界：`import { sessionMetaFromRequest }` + `import { normalizeEmail }` + `issueSession` 进 `./auth` 的 import 名单，
六处调用带元数据（`/replace-token`、通行密钥登录（连带换成 `issueSession`）、两条确认邮箱链接的路由、`/login/email-password`、`/password/change`），
以及 `localeForEmail` 那处换成 `normalizeEmail(email)`。
🔴 **残差核对**（这一步才是"没替别人落东西"的证明）：把补完的文件与共享检出那一份 `diff -u`，剩下的差异逐条都是别人的 ——
注册验证码那三条路由与两枚 schema、`localeFromRequest` 抽到 `./request-locale.js`、权益票据作用域那段注释。

读数（载体 `.worktrees/iosacct` 纯 `refs/heads/main` + 只换这一枚文件）：
`check:token-minting` rc=0（`签名=1 import=1 调用=7 全带元数据`）、`check:email-normalization` rc=0（`违规=0`）、
`password-auth-routes + account-security.routes + access-sessions + email-change` 四枚 spec `141 passed (141)`、
整包 server 单测 `5 failed / 2728 passed` ⇒ **`3 failed / 2730 passed`**（少的两条正是本线那两枚），
本线那两枚集成套件 `18 passed (18)` 同趟仍绿。
变异：把口令登录那一处的 `sessionMetaFromRequest(req)` 摘掉 ⇒ 恰好 `1 failed / 46 passed`，红的就是那条 UA 判据。

入库方式与它带出来的一个坑（这条对本仓所有并行会话都成立）：
`server/src/api.ts` 在共享检出里正被别人写着（` M`，133 增 / 33 删），所以**不能**用 `git commit -- <path>` —— 那会把别人的 133 行一起提交。
走独立索引：`git hash-object -w` 造 blob → `GIT_INDEX_FILE=/tmp/… git read-tree refs/heads/main` → `update-index --cacheinfo` → `write-tree` → `commit-tree` → `update-ref`，
并用 `git diff-tree -r <旧 tree> <新 tree>` 证明**这一笔只动了一枚文件**。
🔴 **副作用（本线没预料到，已就地抹平并留形）**：推进 `refs/heads/main` 之后，共享索引里那枚 `api.ts` 条目还停在**旧 HEAD 的 blob**，
于是那枚文件在 `git status` 里从 ` M` 变成 **`MM`** —— 看起来像"别人 staged 了旧内容"。
若有人此时跑一次**不带 pathspec 的 `git commit`**，提交的就是索引里那枚旧 blob ⇒ **本线这一笔被无声退回去**（工作树里别人的在飞内容不受影响，但判据会重新红）。
归一化：`git restore --staged -- server/src/api.ts`（只把索引刷新到新 HEAD，**不动工作树**），
动前动后各取一次 `git hash-object` 证明那枚文件逐字未变（`727a8cbe` → 同一个值）。
⇒ **凡用 plumbing 推进共享分支，收尾都要对这些路径各做一次 `git ls-files -s` 与 `git status` 对账**，
否则留下的是一颗"谁的提交都会回退我"的索引。

剩余三枚 HEAD 红逐条归属（**这一列只覆盖 `server` 那一层**；其余各包的逐层读数在 §6.67。都不是本线的，且本线不代改）：
① `migration-sql.spec.ts` 那条 `@map` 列对账（6 枚列没有对应迁移）—— 注册验证码那一族的 `schema.prisma` 已入库而 `20261016000000_…` 那枚迁移还没入库；
② `password-contract.spec.ts` 那条"六条路由都要以常量注册"—— 同一族：`AUTH_PASSWORD_PATHS.registerRequest/Verify/Resend` 三枚常量已在 HEAD（`209f7997`），
   而注册它们的路由还没入库；
③ `validation.service.spec.ts` 的 `expected 18 to be 17` —— 见 §6.63。
⚠️ 顺带补一条**载体前置**（与 §6.58 / §6.62 那三件并列）：`packages/*/dist` 在载体里没构建时，
`recover-artifact-envelope.spec.ts` 会在**加载期**就失败（`Failed to resolve entry for package "@heyta/app-host"`），
整枚文件的用例一条都不跑，而汇总行只是"少一枚文件"，不写这件事。

🔴 **同时更正本线先前读数的适用层级**（AGENTS §8 第 8 条：新证据改变结论要改正文，不能只在文末追加）：
A/B 是同一枚 spec 在两棵树上的对照 —— 纯 `2647f768`（补之前那枚尖）`2 failed / 45 passed`，纯 `d0ea794d`（补之后）`47 passed`，
两条红的都是工单 W10 那两枚 UA 判据。
⇒ 凡**包含 `password-auth-routes.spec.ts`** 的那几行"绿"都不可能来自纯 HEAD，只能是共享检出上的绿。
本线受影响的是 §6.60 表里"单元/HTTP 层基线 五枚 spec `134 passed`"那一行（它没写取数的树，分母也没留文件名）；
§6.62 那 `18 passed` 是载体纯 tip 取的，**不受这条更正影响**，两趟同值。
两行都已在原处标注。此后本线取判据读数的口径：**写清哪棵树；在共享检出取的每一行都要标"这一行含未入库内容"**。

可迁移的形状：**"判据入库了、实现在没入库的那枚共享文件里"与 §6.65 是同一族的镜像** ——
§6.65 是"表建好了、能读到它的那句话不存在"，这一格是"**断言写好了、被断言的那次调用不存在**"。
两者都不是"别人没提交"，而是**在同一枚被多人共写的文件上，本线只落了能被单独提交的那一半**。
防法不是"以后小心点"：接线落不下的那一笔，提交信息里就要写明"这枚文件还剩哪几处没落、落在谁的工作树里"，
并且**在纯 HEAD 的载体上取一次整包读数**——主检出的绿在这条路上没有任何预警价值。

### 6.67 默认通道在纯 HEAD 上的红，逐包取完了：本线的格子已清，剩下每一格都点名得到别线（10-10 03:3x 现量）

§6.66 那一格教的东西直接拿去扫一遍"还有没有同类"：把本线涉及的每一层都在**载体纯 tip**（`d0ea794d`）上跑一次。
前置除 §6.58 / §6.62 那三件之外又冒出一件，写在最后一格。

| 层（都住在默认通道 `pnpm check` 里） | 纯 HEAD 现量 | 逐条归属 |
|---|---|---|
| `server` 整包 | `3 failed / 2730 passed / 1 skipped (2734)` | ① `migration-sql.spec.ts`：6 枚 `@map` 列没有对应迁移 —— 注册验证码那族的 `schema.prisma` 已入库而 `20261016000000_…` 还没；② `password-contract.spec.ts`：`AUTH_PASSWORD_PATHS.registerRequest/Verify/Resend` 三枚常量已在 HEAD（`209f7997`）而注册它们的路由还没入库；③ `validation.service.spec.ts` 的 `18 ≠ 17` ⇒ §6.63 |
| `packages/app-host` 整包 | `15 failed / 1579 passed (1594)`，另有 **7 枚 spec 一条都没跑**（加载期就失败） | 7 枚同一个成因：`src/inbound-process.ts:8` import 了 **HEAD 里没有的** `./task-batch-actions.js`，而 `src/index.ts:895` 转出它 ⇒ 凡走 barrel 的 spec 全挂（§6.59 那一型在 `app-host` 的再现，归入站自动化线）。那 15 条测试红的成因是 `storage` 内存适配器抛「store「meta」的 put 缺少主键」（入站 / Vault 两线） |
| `packages/sync-client` | `5 failed / 149 passed (154)`，全在 `inbound-authorization.spec.ts` | 🔴 **同一族的第三种位置**：`getInboundUploadAuthorization` 这个成员在 HEAD 里只存在于**判据**（`packages/sync-client/tests/inbound-authorization.spec.ts`）与**消费者**（`packages/app-host/src/inbound-worker.ts:332`）两处，而 `packages/sync-client/src/client.ts` 里没有 —— 主检出那份实现是别人正在写的 ` M`。⇒ 与 §6.66 逐字同型（判据与消费者入库、被约束的实现没入库），只是换了一枚包 |
| `packages/i18n` | `1 failed / 25 passed (26)` | 判据"中文表每一条都含汉字"抓到 `web.ai.settings.localApi.source.file` / `.command`（中文栏的值是 `heyta-ai local-api init`，纯命令串）。判据与词条同生于 `1ca03ed4`，而把中文值换成命令串的是 **`e6058120`（10-09 14:35，产品体验线）** —— 与 §6.59、§6.63 同一笔 |
| `packages/shared-schema` | `1 failed / 147 passed (148)` | `auth-http-contract.spec.ts` 的 `toHaveLength(6)` 对上现在有 **9** 条的契约 ⇒ **§6.63 那台"只会因自己过期而红"的机器的第二例**，形状逐字相同。⚠️ 现量：这枚文件此刻是 ` M`，另一条会话正在把它改成 `9` 并把标题里的"六条"去掉 —— 也就是正按 §6.63 写的**选项①**修（恢复绿，下次加路径还会红）。本线不插手：那是别人手里的判据，而且那一行正在被写 |
| `packages/legal` | `2 failed / 60 passed (62)` | §6.65（17 枚缺类别名里 2 枚是本线的，文案躺在 parked 那一份里） |
| 构建（`check` 的第 2 步就是 `pnpm build`） | `@heyta/ui` 红（§6.59 / §6.64 谓词）；**新读数**：`@heyta/app-host` 也红 | `pnpm --filter "@heyta/app-host..." build` 在纯 tip `Failed`：`src/inbound-worker.ts(332,34) error TS2339` ⇒ 就是上面 `sync-client` 那一格，只是从"测试红"升级成"**构建红**"。依赖是先编的（`ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL` 落在 app-host），所以这不是载体旧 dist 的假红 |

🔴 **这一节最要紧的后果不是"还有几条红"，是有一整层现在没法验**：客户端的单测层要在纯 HEAD 上跑需要依赖包的 `dist`，
而 `app-host` / `ui` 的 `dist` 在 HEAD 上**打不出来** ⇒ 载体里 `apps/web/tests/account-security.spec.tsx` 连加载都过不去
（`Failed to resolve entry for package "@heyta/app-host"`，汇总行是 `no tests`），`apps/mobile` 同理。
⇒ 本线 W3/W4/W5 那些界面层读数**只能标注成"共享检出（含未入库内容）"** —— §6.66 收窄的那两句话就是这条的落地。
这一格不是"本线还没跑"，是**在 HEAD 上跑不出来**；等的是 §6.64 那两条谓词清空之后才能重取。

本线自己的格子在这一节里的状态（同一趟取的，都是纯 tip）：
`packages/app-host/tests/account-security.spec.ts 49 passed (49)`、`server` 那 5 枚本线 spec `141 passed`（§6.66 表）、
`packages/i18n` 里本线新增的换绑/会话词条通过（唯一两条红是别人的 `localApi` 值）、
`packages/shared-schema` 里本线那批断言通过（唯一那条是过期抄本），`packages/legal` 见 §6.65。
⇒ **除 §6.65 那一格对外承诺的边界之外，默认通道里没有一条红是本线的了。**

复取（每条一行，都不写死数字）：
```bash
cd .worktrees/<载体>/packages/app-host && NO_COLOR=1 npx vitest run          # 15 failed + 7 枚 FAIL [ … ]
cd .worktrees/<载体>/packages/sync-client && NO_COLOR=1 npx vitest run       # 5 failed，全在 inbound-authorization
cd .worktrees/<载体>/packages/i18n && NO_COLOR=1 npx vitest run
cd .worktrees/<载体>/packages/shared-schema && NO_COLOR=1 npx vitest run
cd .worktrees/<载体> && NO_COLOR=1 pnpm --filter "@heyta/app-host..." build  # 看那行 error TS2339
```
⚠️ 载体前置再补一件：`pnpm --filter … build` 会重写 `pnpm-lock.yaml` —— 本线跑完 `git checkout -- pnpm-lock.yaml`，
`git status --porcelain` 回空才敢说载体没被自己污染。（§6.62 那三件前置之外的第四件是**构建类**命令带来的，测试类命令不会。）

### 6.68 工单 W10 的运行时半边补了一条**真 HTTP** 判据，而它顺带说清"那一格以前没有任何一层守着"（10-10 03:3x 现量，载体 `.worktrees/iosacct` 纯 tip，`331f563c`）

起因不是"再补一条测试"，是 §6.66 那次漏入库**为什么能漏**。本线那枚真库集成套件里，前面六条链**全都自己用
`issueSession()` 铸会话**，所以整套对"登录路由有没有把请求头的元数据交给铸造口"这句话是**瞎的**。那一格在仓库里的
状态是三层全绿：helper 在（`sessionMetaFromRequest`）、唯一签名出口在（`issueSession`）、单元判据在
（`password-auth-routes.spec.ts` 那两枚 UA）—— 唯独 `api.ts` 里那次**调用**没入库，而它恰好躺在被三线共写的那枚文件里。
⇒ 真库判据逐字照旧绿，而 10-10 那次"HEAD 上 `user-agent` 收 `null`"没有任何一层会失败。

新增那条（链路 7）不替被测代码自报，四步都在别人的库连接上读：

1. 从**真 HTTP 口令登录口**拿令牌，请求头带 `user-agent: W9-W10-Agent/7.7`；
2. 用**观察者的那条 Prisma 连接**读 `access_sessions` 那一行（不是响应体自报）；
3. 逐字对 `userAgent`（值就是请求头原文），并对列表接口给出的 `sessionId` == 库里那格 `jtiHash`；
4. 同一条里把"这一枚可被单独撤销"走完（撤自己那枚 ⇒ 下一发 401）。

`PASSWORD_PEPPER` 给的是**合成假值**（只为满足 `password/hash.ts` 那道"至少 32 字符"的前置），**没有**把哈希函数
mock 掉 —— 这一套的口径是"除 SMTP 之外零 mock"，给假值比换掉被测实现诚实。

读数（载体 = 纯 `refs/heads/main` + 本地隔离库 `heyta_account_w9`，命令逐字沿用 §6.62 那一行，只把文件名换成这一枚）：

| 臂 | 读数 |
|---|---|
| 基线 | `15 passed (15)` |
| 变异：只摘掉 `api.ts` 口令登录那一处的 `sessionMetaFromRequest(req)` | `1 failed / 14 passed`，红的正是新那条，报 `expected null to be 'W9-W10-Agent/7.7'` |

🔴 两行合起来才是这一节的产出：**变异红 = 判据有牙**；**其余 14 条逐字照旧绿 = 这一格以前没有任何一层守着**
（与 §6.66 那次"漏入库没被照出来"同一个形状，区别是现在它有了守的那一层）。

⚠️ **这一条没覆盖到的，别读成"六条登录路都验了"**（现量：`git show HEAD:server/src/api.ts | grep -n sessionMetaFromRequest`，
去掉那行 import 之后是 **6 处调用**）：

| 那一路 | 运行时层状态 | 为什么 |
|---|---|---|
| 口令登录 `/login/email-password` | ✅ 链路 7 | —— |
| 邮箱链接换会话 `/auth/email/verify` | ✅ **同批已补**（§6.69 臂 4 证明它会红） | 原先 D1 那条**发了**请求头却没对库里的 `userAgent` 断言 |
| 魔法登录（legacy 那路 `/login/magic-link/verify`） | ❌ 集成层从没走过 | ADR-0039 §3.2 那句"同一封邮件走两条路不能有两种结果"在真库层无判据 |
| 改口令后换发的那一枚 `/password/change` | ✅ **同批已补**（链路 8，§6.69 三臂各红一次） | §5 第 16 条那句话（"改密/重置/换绑三条路的撤销第二半"）的**改密那一路**运行时半边 |
| 通行密钥登录 `/auth/passkey/verify` | ❌ | 要真 WebAuthn 断言；`registration-races` 那套只走注册侧 |
| 注册验证码激活 | ❌ | 那一族的实现还没入库（§6.67 server 那格的红②） |

⇒ 这一节的产出不是"补了一条"，是**把"运行时层对登录元数据是瞎的"这个类别量成了上表**。
其中两行（换会话断言、改密那一路）**在同一批就补完了**（§6.69），剩下三行分别等：legacy 那路的对账判据（本线能补，
只是没排进这一批）、真 WebAuthn 装置、别人那笔还没入库的实现。

载体复原：跑完 `git checkout -- server/src/api.ts`、变异文件只从 `<file>.mut-bak` 还原（§6.66 那条索引副作用的教训：
本线在载体上不动共享 `refs/heads/main`，只动工作树），`git status --porcelain` 已逐字为空。

### 6.69 把 §6.68 那张表里"现在就能补"的两行补完了，而第一趟四臂里有两臂是**叠加读数**（10-10 03:5x 现量，载体 `.worktrees/iosacct` 纯 tip，已入 traps #401）

补的两处（都在 `server/tests/integration/email-change-and-sessions.integration.spec.ts`）：

1. **链路 8 —— 真 HTTP 改口令**：两台设备各从真登录口进来（各自的会话行带各自的 UA），A 调
   `POST /api/password/change`，然后逐条读**观察者的库**：
   会话行只剩 **1** 行、那一行的 `userAgent` == 改密那一发的请求头原文、
   A 手上那枚旧令牌 401（界面必须换用响应里新发的那枚）、B 那枚 401、
   用新令牌读列表 ⇒ 只剩 1 枚且 `current: true`、告知信恰好一封且收件人是这个账号的邮箱。
2. **D1 那条已有的用例补一句**：邮箱链接换出来的那一枚，库里的会话行必须带着**那一次点击**的 UA。
   它此前发了 `user-agent` 头却只断言"列表里有当前会话"，所以那一行是 `null` 也照样绿。

第四枚 SMTP 捕获（`sendPasswordChangedEmail`）**不是为了让测试变快**：不 mock 它，`changePassword`
会去 Ethereal 真建一个测试账号，第一趟就是被这件事拖过 vitest 默认 5 s 而报
`Test timed out in 5000ms` —— 那一条红的是超时预算（§5 第 13 条已经登记过这一型），不是产品。
这一套的口径本来就是"唯一 mock 的是 SMTP 发信函数"，前三枚早在那儿了。

读数（载体纯 `refs/heads/main` + 本地隔离库 `heyta_account_w9`；前置 = §6.58 那条五秒 Prisma 判据读到 `function`）：
基线 **`16 passed (16)`**，`链路 8` 那一趟 1401 ms（整套最慢的一条，慢在 `checkNewPassword` 里那道
HIBP 真实外发查询 —— 它 fail-open，所以它只会拖时间、不会造红）。

四臂，每臂跑完立刻 `git checkout -- <文件>` + `git diff --quiet -- <文件>` 复验，红句逐条抄原文：

| 臂 | 摘掉的那一句 | 唯一那条红 | 红句原文 |
|---|---|---|---|
| 1 | `api.ts` 里 `changePassword(...)` 的第五个实参 `sessionMetaFromRequest(req)` | 链路 8 | `当前设备换发的那一枚没带上改密请求的 UA: expected null to be 'W9-Chain8-Device-A-after'` |
| 2 | `recovery.ts` 里 `changePassword` 那句 `await revokeAllDeviceSessions(user.id)` | 链路 8 | `expected [ …(3) ] to have a length of 1 but got 3` |
| 3 | 同一处的 `await notifyPasswordChanged(user.id, user.email, locale)` | 链路 8 | `expected [] to have a length of 1 but got +0` |
| 4 | `api.ts` 里 `/auth/email/verify` 那处的 `verifyEmailLink(token, …)` 第二实参 | D1 登录令牌那条分流 | `邮箱链接换出的会话行没带上那一次点击的 UA: expected null to be 'W9-D1-probe'` |

🔴 **臂 2 才是这一节真正的新判据**：只抬 `tokenVersion` 的实现（也就是 §5 第 16 条那句"每一处单看都做了它说的事"）
在 HTTP 层**全绿** —— 旧令牌与另一台那枚都因为版本号对不上而 401，两条鉴权断言分辨不了它。
分辨得了的是**库里那一行在不在**，而那一句此前只在 WS 层与结构门禁 `check:session-revocation` 里有过。
`3` 这个数字本身就是形状：两枚登录 + 换发的一枚 = 3，说明删的那一步整条没跑。

⚠️ **第一趟的四臂读数有两臂是作废的**，根因记成 **traps #401**：还原那一步的 `mv` 把路径拼重了一层
（`server/server/src/…`），报了一行 `No such file or directory` 之后**没有停**（`$?` 被后面那条 `git diff` 吃掉），
而下一臂的 `cp <file> <file>.mut-bak` 是**无条件覆盖**——于是它把"已经带着前一臂变异"的那份存成了基线。
输出完全正常：`1 failed | 15 passed`、红的还是同一条用例 —— **条数与用例名都区分不了叠加**，只有红句能。
那两臂（当时的臂 2/臂 3）的读数是三臂叠加，本表不采用；上表四行都是**重跑后的单臂**。
⇒ 从此本线多臂装置的三条硬规矩（已写进 traps #401）：还原走 `git checkout --`；每臂跑完立刻复验
`git diff --quiet -- <path>` 并把退出码打进同一行；台账抄**红句原文**而不是"1 failed"。

这一条**没有**覆盖到的（别读成"改密的运行时半边全验了"）：
① 改密那一路的**实时通道**那一半 —— 这条新用例不建 socket，所以它只声称"会话行当场删掉"，
   通道那一半的证据仍是 §5 第 16 条那趟（改前 `37 过 / 2 红` ⇒ 改后 `39 过 / 0 红`）与 §6.60；
② `legacy 那路 /login/magic-link/verify` 与 `/auth/passkey/verify`（见 §6.68 那张表）；
③ **重置口令**那条路（`/password/reset`）成功时不发会话、也不换发 —— 它的"删行 + 关通道"那一半
   由 `revokeAllDeviceSessions` 共用，但**它自己**在运行时层同样零判据，与臂 2 是同一型，下一格补它。
   ✅ **同批就补了**（链路 9，读数与三臂在 §6.70；那里还留下一条**存活臂**的归因）。

复取（一条命令，载体账与判据都在 §6.62）：
```bash
cd .worktrees/<载体> && git checkout --force $(git rev-parse refs/heads/main)
( cd server && node -e "const {Prisma}=require('@prisma/client');console.log(typeof Prisma.PrismaClientKnownRequestError)" )   # 期望 function
( cd server && NO_COLOR=1 DATABASE_URL="postgresql://$(whoami)@127.0.0.1:5432/heyta_account_w9?schema=public" \
  npx vitest run --config vitest.integration.config.ts --maxWorkers=1 \
  tests/integration/email-change-and-sessions.integration.spec.ts )                                                              # 期望 16 passed
```
载体收尾：`git status --porcelain` 只剩那枚预期新增的 spec，`.mut-bak` 已清，`pnpm-lock.yaml` 未被这条链碰过。
⚠️ **traps #401 这一条目前只在那枚文件的**工作树版**里**（`docs/reference/environment-traps.md` 此刻正被别线写着，
` M`），所以它没有随本笔入库 —— 这不是本线把它落在工作树里，是那枚文件不能整枚代提交（§6.66 同一条理由）。
现量（为 `1` 才算真入库）：`git show HEAD:docs/reference/environment-traps.md | grep -c '^401\. '`。
它有两种收敛方式，都比本线整枚提交安全：别线那笔把这枚文件带进去（`git add` 取的是当前工作树字节，会带上这段），
或本线在它干净时按 §6.66 那套 plumbing 只补自己那一段。

### 6.70 链路 9 把 §6.69 那第③格关掉，而它留下一条**有归因的存活臂**（10-10 03:5x 现量，载体 `.worktrees/iosacct` 纯 tip，`79b2614c`+）

`/password/reset` 那一路在真库层此前零判据（§6.69 边界③）。新增那条走真 HTTP：
另一台设备先从真登录口进来（留下一行带 UA 的会话），重置令牌按这套既有手法直接写库
（`hashToken(link)` + 到期），然后 POST 换口令，断言逐条读观察者的库：

- 响应 200 且**没有** `token`（J14：点开一封重置邮件不等于一次登录）；
- 🔴 `access_sessions` 里这个账号**一行都不剩**（`count === 0`）；
- 那一枚旧令牌 401；
- `users` 上那两列当场清空，同一枚链接第二次点 ⇒ **400** + `code: 'invalid_reset_link'`，
  且与"从没有过这枚链接"**逐字同一句**（账号存在性证据）；
- 旧口令 401、新口令 200（真换了）；
- `lockedUntil` 为 `null`、`failedLoginAttempts` 为 `0`、`tokenVersion` 为 `1`；
- 告知信恰好一封。

读数（同一载体、同一库，前置仍是 §6.58 那条五秒 Prisma 判据）：基线 **`17 passed (17)`**（tests 1.58 s，
链路 9 那条 655 ms）。三臂：

| 臂 | 摘掉的那一句 | 结果 | 红句原文 |
|---|---|---|---|
| R1 | `resetPasswordWithToken` 里的 `await revokeAllDeviceSessions(user.id)` | 🔴 恰好 1 红（链路 9） | `expected 1 to be +0` |
| R2 | 那道 `if (consumed.count !== 1) throw` | 🟡 **存活**（`17 passed`） | —— |
| R3 | `resetPasswordWithToken` 里的 `await notifyPasswordChanged(...)` | 🔴 恰好 1 红（链路 9） | `expected [] to have a length of 1 but got +0` |

🔴 **R2 存活是本线要的读数，不是这一格的缺口**，归因写清楚：那道闸门管的是**并发**——
同一枚链接在两个请求之间被用掉。单线程重放撞不到它，因为更前面那次
`findFirst({ where: { resetPasswordToken: tokenHash } })` 已经先因为那一列被清空而抛
`invalid_reset_link`（所以 R2 之后我的那两条 400 断言仍然成立）。
**能造出那个时序的是 mock**：单元层 `password-recovery.spec.ts` 就有一条「③ 被并发的第二个请求用掉了
（`consumed.count === 0`）」，用 `updateMany` 返回 `count: 0` 把这一刻顶出来 —— 那正是运行时层结构上够不着的位置。
⇒ 记这一条的理由：AGENTS §9 那条 W10 教训说的是"**存活的那几条才是这单真正产出的判据**"，
而它的前置是每条存活都要能被归因（是判据没牙，还是这一档本来就不属于这一层）。这里答案是后者，
且证据是那一枚具体用例名，不是"应该有人测过"。

⚠️ 顺带一条**本线自己写错的期望**，被运行时当场否证：我第一趟把"同一枚链接第二次点"写成
`toBe(401)`，实收 **400**。单元层早就钉着这一档（`password-auth-routes.spec.ts:593`：
"查不到这枚令牌 ⇒ 400 + code=invalid_reset_link（**不是 401**：不是'你是谁'的问题）"）。
⇒ 可迁移的一句：**姊妹用例的状态码不能照抄**。这一族里"邮件链接换会话"（`/auth/email/verify`）是认证边界 ⇒ 401，
"链接换口令"（`/password/reset`）不是 ⇒ 400，两条路只差一个字面、语义差一档。
现在那条按 `code` 断言而不是只看状态码，因为 400 在这条路上有两种来源（口令策略不过 / 链接无效）。

仍然开着的边界（这一格没关的）：
① 重置那一路的**实时通道**那一半（`revokeAllDeviceSessions` 里 `closeForUser` 那半）—— 链路 9 不建 socket，
   所以它只声称"会话行当场删掉"；通道那一半的证据仍是 §5 第 16 条那趟（改前 `37 过 / 2 红` ⇒ 改后 `39 过 / 0 红`）与 §6.60。
   这一格能补，但要动 `session-revoke-websocket` 那枚夹具（socket 建两条 + 走真重置口），不是零新装置。
   ✅ **改密那一路这一半已补**（10-10 04:2x，§6.72：走的就是那枚夹具，臂 W1 恰好红这一条、其余 24 条全绿）。
   **重置那一路仍未补**（同一型，只是这一批没排）。
② `legacy 那路 /login/magic-link/verify` 与 `/auth/passkey/verify`（§6.68 那张表的剩下两行）。

复取：与 §6.69 同一条命令（同一枚文件），期望从 `16 passed` 变成 `17 passed`；
三臂的摘除锚点各是一条整句，逐字抄在本节表中，改哪一句就应当红哪一条 —— 除 R2 以外。
载体收尾：`git status --porcelain` 只剩那枚预期新增的 spec，无 `.mut-bak` 残留（§6.69 那三条硬规矩这一趟全程执行：
还原走 `git checkout --`、每臂跑完 `git diff --quiet -- <path>` 复验、红句逐条抄原文）。

### 6.71 链路 10 把两条邮件链接路由**放在一起比**，当场照出一条真缺陷并修完（10-10 04:1x 现量，载体 `.worktrees/iosacct` 纯 tip）

§6.68 那张表里最后一行本线能自己补的（legacy 那路 `/login/magic-link/verify`）不是一条新判据，
而是**第一次把两条路放在一起比**。理由写在那枚路由自己的注释里：
"这里保留它是因为已经发出去的邮件指向它 —— 但**行为必须与新的那个端点一致**，否则同一封邮件走两条路会得到两种结果"。
这句承诺此前没有任何一层守过：两条路各自都有判据，没有一条把它们对比。

新增三条（同一枚集成套件，真库 + 真 HTTP）：

| 那条 | 钉住的五项里哪几项 |
|---|---|
| 链路 10a | 同一类登录令牌走两条路 ⇒ 判别式 `kind` 一致、各自换出的令牌**真能过鉴权**、那一行带着**各自那一次点击**的 UA、两条路都把 `loginToken` 那两列清空 |
| 链路 10b | 同一状态下两条路都 401、每条路内部"过期"与"从没有过"**逐字同一句**、响应里不许出现邮箱或令牌，🔴 且**跨那两条路也逐字同一句** |
| 链路 10c | 通行密钥注册那一格在 legacy 那路必须是 **409 一句明白话**，而不是"200 但没有令牌"（那段 `if (result.kind !== 'session')` 是这条路由独有的一段，摘掉就退化成注释里明说的那种形状），且这一路**不许换出会话**、而验证那一步确实生效 |

读数（载体 = 纯 `refs/heads/main` + 本地隔离库 `heyta_account_w9`）：

| 那一格 | 现量 |
|---|---|
| 基线（10a/10b/10c 加完，未改产品） | `20 passed (20)` —— 10a/10c 一次过 |
| 10b  strengthened 那一趟（跨路比句子，**修前**） | `1 failed / 19 passed`：`expected '{"error":"Invalid or expired login li…' to be '{"error":"Invalid or expired link"}'` |
| 修完那一趟 | `20 passed (20)` |
| 臂 L1：legacy 那处的 `sessionMetaFromRequest(req)` 摘掉 | 恰好 1 红（10a）：`expected [ 'W9-Chain10-Canonical', null ] to deeply equal [ 'W9-Chain10-Canonical', …(1) ]` |
| 臂 L2：legacy 那段 `if (result.kind !== 'session')` 整块摘掉 | 恰好 1 红（10c）：`{"kind":"verified-only",…}: expected 200 to be 409` |

🔴 **修的那一行**：legacy 那路 catch 里的兜底字面量 `'Invalid or expired login link'` ⇒ `'Invalid or expired link'`
（与 §2.1 那个唯一入口逐字同一句，并在原地写下为什么是这一句）。根因不在这两枚字面量本身，在它下面一层：
`SAFE_ERROR_MESSAGES` 认得出 `verifyLoginMagicLink` 抛的那句、**认不出** `auth.ts` 里「查不到这个人」那句
`'Invalid or expired link'` ⇒ 走不到白名单时用户看到的就是**各条路自己那份兜底**。
这正是 AGENTS §3.5 那句"同一件事的第二份实现"的又一副面目：一个概念（"这枚链接没用"）两句字面量，
而两句分别藏在两个 `catch` 里，构建与 typecheck 都不会说 anything。

⚠️ **这条不是"顺手改文案"的两个前置**（都现量过才动的手）：
① legacy 那路是**活路径** —— `packages/app-host/src/hosted-auth.ts` 的 `magicLinkVerify` 在调它，
  服务端渲染的 `/magic-login` 那页那颗按钮也在调它（`server/src/pages.ts` 文件头那段两跳流程的注释），
  所以两句话都是用户真能读到的，不是"内部字符串"；
② **别人手里的判据一条没代改** —— 先前我怕的那两枚钉句（`magic-link-registration.spec.ts`）钉的是
  **函数抛出**的那句（`verifyLoginMagicLink`），不经过路由，所以修兜底碰不到它们。
  同趟证明：`npx vitest run tests/magic-link-registration.spec.ts tests/api.routes.spec.ts` = `23 passed`。
  🔴 我先前把这两枚钉读成"改那句就要连别人那两枚断言一起动"，那是**没现量就下的判断**，已就地否证并写回 §5 第 18 条。

入库方式（与 §6.66 同一套，因为是同一枚共写文件）：`server/src/api.ts` 在共享检出里正被别人写着
（现量 `M`，132 增 / 22 删），所以不能 `git commit -- server/src/api.ts`。
走 plumbing：blob 取自载体里那棵**纯 HEAD + 本线这一处**的文件（不是主检出的工作树版），
`hash-object -w` → `read-tree refs/heads/main` → `update-index --cacheinfo` → `write-tree` → `commit-tree` → `update-ref`，
再用 `git diff-tree -r` 证明这一笔只动一枚文件；随后 `git restore --staged -- server/src/api.ts` 把共享索引那格刷到新 HEAD
（§6.66 那条"谁的提交都会回退我"的索引副作用，这次**先做**而不是事后补）。
主检出的工作树版**同样打上这一处**，这样别线整枚提交时不会把它退回去。

⚠️ 载体环境读数（不记产品、也不记"已验证"）：这一格里 vitest 被**内存闸门**拒了三次
（立即可用 264 / 104 / 201 MB < 那一档要求的 384 MB），成因是另一条会话正在跑 Playwright
（几枚 `chrome-headless-shell`，按"只对自己创建的对象动手"不动它们）。
最后一次是先有界等到 `FREE=1695MB` 才起跑，那一趟就是上面的 `20 passed`。
🔴 顺带把这条写成判据的姿势：**闸门拒绝启动时那条输出里没有被测命令的 rc**，
所以包装命令的 `exit 0` 完全可能是"没跑"（仓内 traps #164/#179 那一族）。本线这一趟每次都在日志里留了
`CHAIN10_BASE_RC=` / `ARM_*_RC=` 那一行才敢读数。

仍然开着的：见 §5 第 18 条那"仍然开着的那一半"（allowlist 认不出那句 ⇒ 这件事结构上只由链路 10b 一条运行时判据守着，
没有静态尺；做成词表的一部分要拍）。

复取（一条命令，前置 = §6.62 那三件 + §6.58 那条 Prisma 判据 + §6.69 那条内存余量）：
```bash
cd .worktrees/<载体> && git checkout --force $(git rev-parse refs/heads/main)
( cd server && node -e "const {Prisma}=require('@prisma/client');console.log(typeof Prisma.PrismaClientKnownRequestError)" )
( cd server && NO_COLOR=1 DATABASE_URL="postgresql://$(whoami)@127.0.0.1:5432/heyta_account_w9?schema=public" \
  npx vitest run --config vitest.integration.config.ts --maxWorkers=1 \
  tests/integration/email-change-and-sessions.integration.spec.ts )   # 期望 20 passed
```

### 6.72 改密那一路"关掉已经开着的页面"补上了通道层的判据，而它顺带修掉**这枚夹具自己的两处抢跑**（10-10 04:2x 现量，载体 `.worktrees/iosacct` 纯 tip）

§6.70 留的那一格（改密/重置那两路的 `closeForUser` 那一半）用的就是 §6.60 那枚 WS 夹具。
新那条**自带**两条连接（两个 `issueSession` + 两个真 socket），走真 `/password/change`，断言：
两条 socket 都以 `4003 / Token revoked` 当场断、库里只剩换发给当前设备那一行、
而响应里那枚**新令牌能重新连上**（"改个密码把自己的这个标签页也踢出去"就是最后这句没兑现时的形状）。

| 那一格 | 现量 |
|---|---|
| 全文件 + 另一枚集成套件同趟（默认 5 s 预算） | `2 passed / 25 passed (25)` rc=0 |
| 只跑新那条（`-t "真改口令"`，默认预算） | `1 passed / 4 skipped` rc=0 |
| 🔴 臂 W1：`revokeAllDeviceSessions` 里摘掉 `getWsConnectionService().closeForUser(userId)`（只删行、不关通道） | **恰好 1 红 = 新那条**，其余 `24 passed` |

第三行是本节的全部要点：**改密那一路的通道那一半，此前只有这一层看得见** ——
那一臂下 HTTP 层照旧全绿（链路 8 的"旧令牌 401"与"库里只剩 1 行"两条都不依赖连接簿记），
这是 §6.13 那一族（"判据四层里只有真运行时那一层能红"）在本线的**第三次**实证。
⚠️ 那一臂的红形状是 `Test timed out in 5000ms` 而不是 `AssertionError` ——
因为监听等满 `waitForClose` 的 5 s 而 vitest 默认预算也是 5 s（§5 第 13 条那一格的两半）。
**别把它读成载体抖动**：判据成立的证据是"未变异那两趟 `25 passed` 与 `1 passed`"。

🔴 而这一格里最值钱的其实是**修掉的这两处夹具抢跑**（第一条旧用例在 HEAD 上突然红就是这个）：

1. `openSocket` 只等客户端的 `open`，而服务端 `websocket.routes.ts` 是
   `await verifyToken(token)` **之后**才 `addConnection`（那一次 `verifyToken` 里有一次库查）。
   ⇒ "前提"可以在服务端一条都没登记时就成立，随后那句撤销找不到该关的连接，
   而那枚令牌自己的 `verifyToken` 晚一步回来时 socket 收到的是升级期那条通用拒绝
   `4003 / Invalid token`，本套件钉的 `Session revoked` 根本不会发生。
   补了一条 `waitForConnectionCount(target)`（读 `getWsConnectionService().getConnectionCount()`，
   有界 5 s，等不到就抛"前提不成立"）用在四处：前提、幽灵那条（按**增量**等，不写死绝对值）、新那条的两处。
2. `waitForClose` 原本挂在 HTTP 响应**之后**，而 close 帧与响应是两条通道、谁先到没有保证。
   ⇒ 新那条改成先挂监听再发请求，并**同样改掉已有的"撤销 A"那一条**（那是本线 §6.60 的判据，不是别人的文件）。

现量证明第 1 点不是产品回归：`git log 331f563c..HEAD -- server/src/sync` **为空**，
而 HEAD 那版夹具（不含我的任何改动）单独重跑同样红在 `expected { code: 4003, reason: 'Invalid token' } to deeply equal …`。
⇒ **又一例"先怀疑探针"**（AGENTS §7 元规则第 1 条）：同一枚文件昨天绿今天红，第一问应当是
"这一层今天有没有别的东西改了时序（负载、别的套件的库状态）"，而不是"产品坏了"。
🔴 也要如实记一句：**这条抢跑一直在，只是没人看见** —— 而 §6.62 那次 `18 passed` 的**负载读数没有留档**
（那一趟没记），所以只能说"当时没撞到"，不能说"当时是稳的"。这正是要把负载/预算一起写进读数的理由。
判据不稳的判据比没有判据更危险（AGENTS §7 元规则第 2 条）。

仍然开着的：
① **重置那一路**（`/password/reset`）的通道那一半仍未在这层验（同一型，只是这一批没排；
  它比改密那条更简单——不发会话，要的是"两条 socket 全断 + 库里 0 行"）；
  ✅ **同批就补了**（§6.73：`6 passed`，臂 W1 重取一次同时打红改密与重置那两条）。
② §5 第 13 条那格（默认 5 s 预算属于判据口径，由负责人拍）今天有了**第二个具体例子**：
  新那条在"未变异 + 负载高"时贴着预算，读数以 `--maxWorkers=1` 取。

复取（同 §6.71 那条命令，把文件名换成 `session-revoke-websocket`，期望 `5 passed`；
臂 W1 的摘除句是 `access-sessions.ts` 里 `revokeAllSessions(userId)` 后面那一整行，
还原按 §6.69 那三条硬规矩：`git checkout -- <path>` + `git diff --quiet -- <path>` + 抄红句原文）。

### 6.73 三条撤销路径在真运行时这一层的现状表（重置那一路补上后重取了臂 W1，10-10 04:2x 现量，载体纯 tip）

> 📌 这张表**现在是四格**（注销补在 §6.74、换绑生效补在 §6.75），标题里的"三条"是它立起来那一刻的范围，留着不改。

§6.72 留下的那一格（重置那一路的通道那一半）用同一枚夹具补上了：
自带两条连接（`device-e` / `device-f`），把重置令牌按这套既有手法写库，走真 `/password/reset`，
断言"两条都以 `4003 / Token revoked` 当场断 + 库里**零行** + 响应里没有 `token`（J14）"。

| 那一格 | 现量 |
|---|---|
| 本文件（默认 5 s 预算） | `6 passed (6)` rc=0 |
| 同一枚命令**再跑两趟**（验证 §6.72 那两处抢跑真的修完了） | 各 `6 passed (6)`，rc 均 0；取数时负载 6.8（16 核）/ 余量 1400 MB |
| 🔴 臂 W1 **重取**（还是摘 `revokeAllDeviceSessions` 里 `closeForUser` 那一行，但现在两条通道判据都在） | `2 failed / 24 passed (26)` —— 红的恰好是改密与重置那两条，其余（§6.60 那四条真 socket 判据 + 另一枚集成套件那 20 条）逐条照旧绿 |

⇒ **§5 第 16 条那三条路在这一层的现状**（这一张表是这一节的产出，比"又补了一条"有用）：

| 那条路 | 真 socket 读数 | 只有 spy 的那一条 |
|---|---|---|
| 改口令 `/password/change` | ✅ §6.72 | 同左 |
| 重置口令 `/password/reset` | ✅ 本节 | 同左 |
| 换绑生效（`EMAIL_CHANGE_PATHS.confirm` 那一步） | ❌ **本节登记成欠项** —— ✅ **同批就补了，见 §6.75**（这一行原文留着，因为下面那段"为什么不补"的理由**是错的**） | `account-security.routes.spec.ts` 断的是"调用了 `closeForUser`"，不是"那条连接真的断了" |
| 注销账号 `DELETE /api/account` | ✅ §6.74（**第四格，本节原来没有它**） | `delete-account.routes.spec.ts` 断的是"调用了 `closeForUser`"＋"调用排在删除**之后**"，同样不是"那条连接真的断了" |

🔴 ~~为什么这一格**登记而不顺手补**：同一枚共用收口函数（`revokeAllDeviceSessions`）已经在**两个调用方**上
取到"真的把连接断了"的读数，臂 W1 一次同时打红这两条；而要在这一层补换绑那一路，
得把另一枚套件的那两封信装置（`sent.authorize/confirm/changed` 那份 mock）重铺进 WS 套件 ——
那会让两枚套件共享一份夹具，此后任何一侧动它都会红在另一侧。这一格留成欠项，不包装成完成。~~
**这段理由是错的，§6.75 用一条真用例否证了它**：生效那一步读的是**库里那张请求行的两边确认状态**
（`confirmEmailChange` 只看 `email_change_requests.oldConfirmedAt/newConfirmedAt`），
所以按形状直接把那张行写进库就够了 —— 与本节上面重置那条写 `resetPasswordToken` 是同一手法，
**一行邮件装置都不用搬**。留下的教训：**"要共享别人的夹具"这句判断要先去读被验那一步的输入来自哪里**，
从"这条路是靠两封信驱动的"直接推"就得有两封信的装置"，推的是**用户视角的形状**，不是**代码的输入**。

复取：与 §6.72 同一条命令（文件名 `session-revoke-websocket`），期望从 `5 passed` 变成 **`6 passed`**；
臂 W1 那一行的摘除与还原照 §6.69 那三条硬规矩，重取时预期 `2 failed / 24 passed`。
⚠️ 上面这张表与这两条期望**已被本节第四格过期**：那条用例补进来之后本文件是 `7 passed`，
臂 W1 单跑这一枚文件是 `2 failed / 5 passed (7)`，注销那一格红在**另一枚臂**（§6.74）。
分母也要认账：`2 failed / 24 passed (26)` 那一趟是**两枚集成套件同跑**，§6.74 那两趟只跑这一枚文件。

### 6.74 注销那一格补上了真 socket 读数，而**两条臂各红各的调用点**（互不重叠）（10-10 04:3x 现量，载体 `.worktrees/iosacct` 纯 tip）

§6.73 那张表原来只有三条路。第四格（注销）用的是同一枚 WS 夹具：两条真连接（`device-g` / `device-h`）
→ 真 `DELETE /api/account` → 断言"两条都以 `4003 / Token revoked` 当场断 + `accessSession` 零行 +
`syncDevice` **零行** + 手上那枚令牌此后 **410 / `ACCOUNT_CLOSED`**"。

| 那一格 | 现量 |
|---|---|
| 未变异（默认 5 s 预算，`--maxWorkers=1`） | `7 passed (7)` rc=0，`Duration 4.31s` |
| 🔴 臂 **W4**：摘 `api.ts` 里 `DELETE /account` 那一处**直接**的 `closeForUser(userId)` | **恰好 1 红 = 新那条**（`Error: Test timed out in 5000ms.`），其余 `6 passed` |
| 🔴 臂 **W1** 重取：摘 `revokeAllDeviceSessions` 收口函数里那一行 | `2 failed / 5 passed (7)` —— 红的还是改密与重置那两条，**新那条照旧绿（60 ms）** |

⇒ 这一行是本节的全部要点：**两条臂的红集互不重叠**，因为注销那一路的 `closeForUser` 是**另一个调用点**，
不经过那个收口函数。它自己那条理由（生产注释原文）是"级联删掉用户行之后不关那条连接，它还继续答 ping，
于是死连接那支永远收不掉它，而它的心跳 touch 会替一个**已经不存在的账号**重新 INSERT 一行 `sync_devices`，
从此每个节流窗口撞一次外键"。**spy 层（`delete-account.routes.spec.ts`）表达不了这条理由**：
它断的是"调用了 `closeForUser`"和"调用排在删除之后"，而"没有再长出一行设备"只有在真库 + 真连接那一层才读得到
（所以那条用例里 `syncDevice.count` 那一格是**这一层独有的**，不是重复 `accessSession` 那一格）。
§6.13 那一族（"判据四层里只有真运行时这一层能红"）在本线的**第四次**实证。

🔴 **最后一格我一开始写错了档**，写成了其余三条撤销路径的 401：
`AssertionError: 注销之后那枚令牌还在用: expected 410 to be 401`。
查 `account-closed-signal.spec.ts`：410 是**注销独占**的对外契约（2026-10-04 随 E1b 落地，那里还钉了
"其余三种失效各自仍是 401，且码各不相同"）⇒ **产品没错，是我的期望错**。
这是 §6.70 那句"姊妹用例的状态码不能照抄"的**第二次**实证，同一型：前一次是把重置的重放写成 401（实收 400 + `code`）。
判据的档位只能从**对外契约那一层**取，不能从"同一族里另一条路的读数"取。

一臂的定位方式也改了：夹具第一版按**行号**写死 `api.ts:1491`，在载体上直接 `TARGET_LINE_MATCHED=NO-ABORT` 自闸
（主检出那枚 `api.ts` 的工作树比载体 tip 多几行 ⇒ 同一句在生产里落在 **1481**）。
⇒ 改成"按整行 trim 相等找唯一命中，命中数 ≠ 1 就退 7 不动文件"，并把 `hits=` 与 `MUTATED_LINE=` 打进读数；
加了一发 `STILL_PRESENT_AFTER_MUTATION` 复验（§7 那条"变异到底进没进产物"的前置）。
**行号跨树会漂，整行内容不会** —— 与本文件 §6.69 那三条硬规矩同族，但这一发是"定位"而不是"还原"。

复取（载体 `.worktrees/iosacct`，库 `heyta_account_w9`）：
`cd server && NO_COLOR=1 DATABASE_URL='postgresql://rocalight@127.0.0.1:5432/heyta_account_w9?schema=public' npx vitest run --config vitest.integration.config.ts --maxWorkers=1 tests/integration/session-revoke-websocket.integration.spec.ts`
⇒ 期望 `7 passed`。两条臂的夹具与逐臂还原留在线下载物目录（`~/heyta-carriers/w9-acct-logs/arms-ws-close.mjs`，
按 §6.69 三条硬规矩：每臂独立 `.mut-bak-<臂名>`、跑完 `git checkout -- <path>` + `git diff --quiet -- <path>` 复验、
红句抄原文）。取数时负载 6.17（16 核）/ 余量 6936 MB / 轻量档在册 0 趟。
载体收尾：`git status --porcelain` 只剩那枚预期未提交的 spec，`.mut-bak*` 残留 0 枚。

仍然开着的：§6.73 那张表里唯一那个 ❌ —— **换绑生效那一路的真 socket 读数**（本线欠项，未闭合）。
✅ **同一批就补了**（§6.75），而那一格登记的理由本身是错的，见 §6.73 被划掉的那段。

🔴 **顺带一格，不是本线的，但下一个跑 `check:docs` 的人会以为是自己的**（§6.73 那一族"红不是自己造成的"）：
纯 tip 载体上 `node research/tools/docs-link-check.mjs` **真 rc=1**（尾巴上照旧别拿 `tail` 的码 —— 陷阱 **#363**），
唯一那处死链是 `apps/web/evidence/ux-final-20261009/reinstall/RESULT.md:22 → windows/`：
那枚 `RESULT.md` **已入库**（`4f375210`，产品体验线），而它指的那个子目录**本机有、git 没跟踪**
（`git ls-files` 该前缀命中 **0**、`git check-ignore` 不回 ⇒ 是未跟踪，不是被忽略）。
⇒ 干净检出 / CI 那一侧它是死的，本机那一侧它是活的。两处**话术也不同**，别当成两条不同缺陷：
纯 tip 上打「🔴 发现 1 个死链：`…RESULT.md:22 -> windows/`」，主检出上打「发现 1 处**本机有、仓库里没有**的链接」。
**同一时刻主检出红的却是另一处**（`apps/desktop-windows/README.md:89 → scripts/windows/launch-data-transfer-qa.ps1`，
`BLOCKED.md` 已登记），两棵树的死链**不重叠** —— 所以"我这笔提交把文档门禁弄红了"这句话在两棵树上都判不了，
要先说清是哪棵树。本线那两枚文件（本台账 + 那枚 WS spec）在两棵树上都不是命中项，`check:docs-voice` 两棵树都 rc=0。
三条出路（① 把它入库 / ② 链接改成纯文字 / ③ 在 `UNTRACKED_LINK_OK` 里登记路径 + 一句理由）
是**那条线自己的证据件与判据口径**，本线不代拍、不代改，
只把读数与归属留在这里。

🔴 **同一批还照出第二格，形状更要紧**：纯 tip 上 `node scripts/check-layering.mjs` **也 rc=1**，
唯一那处违规是 `apps/web/src/features/share/share-key-store.ts:56` 的 `entityType: 'SHARE_KEY'`
（AGENTS §3.5"外壳里不许自己拼 op"那一族），来自 `e6058120`（10-09 14:35，**同一条线**那批），
载体那一侧该文件与 tip 逐字相同（`git status --porcelain -- <那枚>` 为空）。
⇒ 当时 HEAD 上有**两道门禁是红的**（`check:docs` + `check:layering`），两道都不红在本线文件上 ——
🔴 **这句已在 10-11 05:3x 过期**：`check:docs` 那一格随协作线把自己的证据件入库收平（链接改指
`launch-data-transfer-qa.ps1` = `d49f77e3`，目标脚本 = `16da3ecb`，**不是本线修的**），
而合并态被逐道量出来的红**现在是五道**（`reachability` / `layering` / `ui-language` /
`verify-script-copy` / `integration-coverage`）—— 现量请跑那五道本身，别照本段推断；
逐道归属读 **BLOCKED B161**，本线自己那枚撞号 ADR 的收回读 **B160**（正文见 §6.88）。
本线那枚 `check:session-revocation` 在同一棵树上 rc=0（`文件=116 bump=6 豁免命中=1 违规=0`）。
修法（把 `SHARE_KEY` 的 op 构造收进 `@heyta/app-host` 的动作层再让外壳调它）**改的是产品语义的落点**，
归那条线拍；这里只留读数、归属与一条复现命令，**不代改、也不因为"不是我弄红的"就把它当不存在**。
下一个从干净检出跑 `pnpm check` 的人会先撞见 `check:layering`，所以这一格值得写在离门禁最近的地方。

### 6.75 换绑生效那一路补上了真 socket 读数，而 §6.73 登记它时写的那条理由是**错的**（10-10 04:4x 现量，载体 `.worktrees/iosacct` 纯 tip）

§6.73 那张表里最后一个 ❌ 用同一枚 WS 夹具补上了，**一行邮件装置都没搬**：
`confirmEmailChange` 生效那一步读的是**库里那张请求行的两边确认状态**
（`email_change_requests.oldConfirmedAt / newConfirmedAt` 都非 null 才进事务），
所以直接按形状把那张行写进库就够了 —— 与本文件重置那条写 `resetPasswordToken` 同一手法，
两次 `POST /api/account/email/change/confirm`（旧边一枚令牌、新边一枚令牌）就把它驱动到生效。
SMTP mock 只多一枚 `sendEmailChangedEmail`（在**本文件已有**的那份 `vi.mock('../../src/email')` 上加一项，
不是把另一枚套件的 `sent.authorize/confirm/changed` 那套装置重铺过来）。

那条用例断的是**两半**，各自有归宿：
**只点一边** ⇒ `applied:false`，且**两条真连接一条都不许断**（先挂监听、`waitForClose(ws, 400)` 回 `null`、`readyState` 仍 `OPEN`）；
**两边齐** ⇒ `applied:true` + 两条都以 `4003 / Token revoked` 当场断 + `accessSession` 零行 +
那张请求行零行 + `users.email` **真的换成了待绑地址**（这一格防的是"通道断了但地址没换"）。

| 那一格 | 现量 |
|---|---|
| 未变异（默认 5 s 预算，`--maxWorkers=1`） | `8 passed (8)` rc=0，`Duration 4.59s`；新那条 441 ms。同一份文件（含后来那段注释修订）**再跑一趟**：`8 passed (8)` rc=0 / `4.66s` |

⚠️ 这两趟之间有一次**被内存闸门按水位维拒了启动**（`立即可用 346MB < 这一档要求的 384MB`），
那一趟的包装 rc=1 **不是产品红**，日志里没有被测命令自己的读数行（§6.71 那格同一形状）；
复跑走的是"原样重试在册那条命令、阈值一个字不动"的那条路，第一发就排到。
| 🔴 臂 **W1** 重取（摘 `revokeAllDeviceSessions` 里 `closeForUser` 那一行，行号 261） | `3 failed / 5 passed (8)` —— 改密、重置、**换绑**三条一起红（各 `Error: Test timed out in 5000ms.`），注销那条照旧绿（60 ms） |
| 🔴 臂 **W5**（把 `email-change.ts:332` 那道"两边都确认才生效"的闸改成 `if (false)`） | **恰好 1 红 = 新那条**，红句原文 `AssertionError: 只点一边就生效了: expected true to be false`；其余 7 条全绿 |

⇒ 这一节真正要记的是**两枚臂各管一条用例里的一半**：W1 只证得到"生效那一步真的把通道关了"，
它证不到"只点一边时不许关" —— 后一半由 W5 负责，而且 W5 红的**不是** socket 那一格，
是 `applied` 那一格先错（`if (false)` 让第一次点击就走进生效分支，而那条分支的
`deleteMany(where 两边都已确认)` 拿不到行 ⇒ `appliedId=null` ⇒ 回的是 `applied:true` 而**地址没换、通道也没关**）。
所以这条用例里"两条都不许断"那三句**当下不是被 W5 照出来的**，它是被 W1 的反向形状（未变异时两边齐才断）
与 W5 的 `applied` 那一行**合起来**钉住的 —— 记清哪一枚臂负责哪一格，别让"做过两臂"读成"两臂各自覆盖了全部断言"。

🔴 **§6.73 那句登记理由已被本节否证**（原文与划掉它的位置在那里，不重复抄）：
"要在这一层补它，得把那两封信的装置重铺进 WS 套件"——**它推的是用户视角的形状**（这条路是靠两封信驱动的），
不是**代码的输入**（生效那一步只看那张行）。可迁移的一条：**判"补它要搬多少装置"要先读被验那一步读的是什么**，
读到的是库里的形状而不是邮件里的字符串，就不需要邮件装置。

复取（载体 `.worktrees/iosacct`，库 `heyta_account_w9`，与 §6.74 同一条命令）⇒ 期望 `8 passed`。
两臂夹具与逐臂还原：`~/heyta-carriers/w9-acct-logs/arms-emailchange.mjs`（按 §6.69 三条硬规矩 + §6.74 那处改进：
按整行 trim 唯一命中定位、`ORIGINAL_LINE_STILL_PRESENT` 复验变异真落进文件、每臂独立 `.mut-bak-<臂名>`、
跑完 `git checkout -- <path>` + `git diff --quiet -- <path>` 复验）。
取数时（臂读数收工后同一分钟现量）负载 6.17（16 核）/ 余量 6936 MB / 轻量档在册 0 趟。
载体收尾：`git status --porcelain` 只剩那枚预期未提交的 spec，`.mut-bak*` 残留 0 枚。

⇒ **§6.73 那张表现在四格全 ✅**，这一层（真库 + 真 Fastify + 真 WebSocket）没有欠项了。
**两枚集成套件同趟**（`email-change-and-sessions` + `session-revoke-websocket`，`--maxWorkers=1`）：
`2 passed (2) / Tests 28 passed (28)` rc=0，`Duration 5.88s` —— 这一行才是 §6.73 那格
`2 failed / 24 passed (26)` 那个分母今天的对应值（26 → 28 是本轮加的两条真 socket 用例）。
本线仍然开着的格都不在这一层：iOS 设备腿与四端重装（等 `packages/ui` 那批入库）、
法务「十封」联合提交、帮助中心两行、§5 第 18 条那一半（对外文案 + 判据口径，等负责人拍）。

### 6.76 设备腿那两条谓词复量到第三次，顺带照出**同一形状的第三处**（10-10 12:0x 现量，载体 `.worktrees/iosacct` 纯 tip）

负责人这一轮把还开着的四类交给我按产品口径拍板（原话："我授权你来从产品经理的角度来拍板"）。
拍板之前先把"设备腿到底等什么"再量一遍 —— 两条谓词的命令在 §6.64，读数逐字未变：

- 类 A：**7 枚 `UNTRACKED_IN_HEAD`、`ABSENT_ON_DISK` 0 枚**，名字与 §6.64 那次列的同一批。
- 类 B：**五枚符号 `HEAD=` 那列仍全空**，`disk` 分别 3/1/2/1/1，三枚宿主文件 `git=M`。

⚠️ 别把这两个数与 `git status --porcelain -- packages/ui` 的枚数当同一分母 —— 那次是 42 枚 `M` + 11 枚 `??`，
比类 A 大是因为那 11 枚里含类 B 的文件与它们各自的依赖（§6.64 已经写过一次，这次仍然有人按裸 `M` 数读）。

**这一轮真正新增的是第三处同形状**：`packages/app-host` 也在类 A 那一档里。
现量（只读，两条命令）：

```bash
git show HEAD:packages/app-host/src/inbound-process.ts | grep -c "task-batch-actions"   # 1
git cat-file -e HEAD:packages/app-host/src/task-batch-actions.ts && echo 在 || echo 没在  # 没在
git status --porcelain -- packages/app-host/src/task-batch-actions.ts                     # ?? （工作树里有）
```

⇒ §6.64 把这两条谓词写成"设备腿的关闭判据"时**漏了这一枚**，而它比 ui 那一处更硬：
它不是"装不上模拟器"，是 **HEAD 上 `packages/app-host` 根本打不出包** —— 直接证据是载体里
`tsup` 在 ESM 阶段就断：`Could not resolve "./task-batch-actions.js"`（`tsup` 整段读数在
`~/heyta-carriers/w9-acct-logs/app-host-build-nodts.log`）。
`check:reachability` 那一条 COMMENT 写路径的红、`packages/ai` manifest 的红、这一枚，
是同一条线（入站/自动收集）在 HEAD 上的三张脸。

**这一枚把本线一格的口径改了**：web 层的单元判据（`apps/web/tests/*.spec.tsx`）在纯 tip 上**取不了数** ——
`apps/web` 里那些面板 `import { … } from '@heyta/app-host'`，而 app-host 的 `exports` 指向 `dist/`，
tip 打不出那份 `dist` ⇒ vitest 在**收集期**就断，报的是 `Failed to resolve entry for package "@heyta/app-host"`
而不是任何产品断言。第一趟我就把这一行当成"套件红了"读过，实际是**探针够不着**（§7 元规则第 1 条）。

本线 §6.77 那一枚 web 层新用例因此记两条边界，别读成"载体没毛病"：
① 取数在**主检出**（那里 `packages/app-host/dist` 是别线在飞源码打出来的）；
② 被测的两枚面板 `SessionsPanel.tsx` / `EmailChangePanel.tsx` 当场 `git status --porcelain` 为空 ⇒
   界面实物是 tip 字节，掺进来的只有 `ProfilePanel.tsx` 那类同目录别人在改的文件，
   而本用例不渲染它们（`grep -c "^  it(" ` 现量：tip 41 → 工作树 42，只多我这枚）。

### 6.77 负责人授权后拍掉的四格，每格带现量与臂（10-10 12:0x–12:2x）

| 拍的那一格 | 拍成什么 | 依据与读数 |
|---|---|---|
| iOS 设备腿 | **不抢跑**：继续等，但等待条件从"别人跑完"换成 §6.64 那两条命令 + 一条新增的 app-host 谓词 | 上面那三个数；载体上 tip 打不出包是当场撞出来的，不是推断 |
| `access_errors.device_name` 没有任何客户端上报（§5 第 9 条） | **不做上报**（要给登录请求加一个入参、动线协议契约，而界面读的是 UA）；改钉"两个都缺 ⇒ 那一行不许编名字" | `apps/web/tests/account-security.spec.tsx` 新增一枚，基线 **42 passed**；臂 M1（`rowLabel` 兜底成 `'Unknown device'`）红 **1 条 = 本用例**，臂 M2（兜底成空串 ⇒ 标签行照样渲染）红 **2 条 = 本用例 + 那条"念出设备名与 UA"**。两臂各红各的断言，M2 证明"不许出现编出来的名字"那半不是独木难支 |
| `SAFE_ERROR_MESSAGES` 认不出那句兜底话（§5 第 18 条那一半） | 纳进封闭词表 + 补一把静态尺（`pnpm check:safe-error-fallbacks`） | 读数与那条被否证的第一版口径在 §6.79（不要在这里抄臂数） |
| 法务「十封」联合提交 + 帮助中心两行 | 两格都**不是**原先登记的那个形状 —— 见 §6.78，处置也不同 | §6.78 |

拍板口径的来源记清楚，免得下一位以为是本线自决：负责人这一轮把"还开着的 4 类"整体交给产品侧拍，
但**没有**授权把对外法律句子的**内容**改成我没写过的东西 —— 所以 §6.78 那一格里我把能机械推导的做掉、
要重新起草法律句子的留成在案欠项（这是同一条授权的两面，不是挑软柿子）。

### 6.78 法务那一类：我原先登记的**两条理由都被现量否证**，而真相是本线自己的一笔欠账（10-10 12:0x–12:2x 现量）

原先写的是"等注册验证码那封同批落地的联合提交"，以及 §6.47 那格"排在别人的 landing 重生成批次之后"。
这一轮逐枚现量，两句都站不住：

**① 那批法务文本从来没进过 HEAD —— 一行都没有。**
`git log --oneline -S '十封功能邮件' -- packages/legal/src` 输出空，`git log -S '换绑-新邮箱确认'` 同样空；
而 HEAD 里现在躺着的是：`发五封功能邮件（验证邮箱、魔法登录、找回通行密钥、重置口令、口令已改通知）`、
`**邮箱不可更换。**`（`data-rights.ts` 命中 3 处、`privacy.ts` 2 处、`terms.ts` 3 处）、
`personal-info-list.ts` 里 `登录会话|待绑定` 命中 **0**。
⇒ W7 那行写的"①…⑨ 已落"读起来像"已入库"，实际是"已改在工作树"。**这句要按本节改**（原文留着看清它怎么错的）。

**② "等注册验证码那封"这句把因果写反了：那一封在 HEAD（也在工作树）里根本发不出去。**
⚠️ **这一整条的"工作树"那一半于 10-10 12:5x 被现量否证，见 §6.80②** —— 工作树里有调用点，
是我那把尺用 `git grep` 找调用点（只看得见索引）才把它读成"发不出去"。留原文是为了看清混载体造出的假红长什么样。

`server/src/email.ts` **有** `export const sendEmailPasswordRegistrationCodeEmail`（158 行），
但 `git grep -l "sendEmailPasswordRegistrationCodeEmail(" -- server/src` 去掉定义文件后**零命中**，
`server.email.registerCode.*` 那套词条在 HEAD 里有、消费者没有，`EMAIL_PASSWORD_REGISTRATION_CODE_TTL_MS` 只有声明处一处命中。
⇒ 工作树里那句"十封"是**对外承诺了一封代码不会发的信**（超前表述），不是"等它落地就齐了"。
所以那格合法的等法是：**先有调用点，文本才能点那一封** —— 顺序原先写反了。

**③ 剩下的那一半是本线自己的欠账，而且是可机械量出来的。**
把 HEAD 的真源数一遍：`server/src/email.ts` 里被调用到的发信口共 **9 封**（逐枚 `git grep -l '<fn>(' -- server/src` 去掉定义文件都有命中），
而 HEAD 的对外文本写 5 封 ⇒ **少披露 4 枚，全是我那笔服务端提交（`703cafc8`）带进去的**：
`changeConfirm` / `changeAuthorize` / `changed` / `authenticatorAdded`。
AGENTS §8 工作流第 18 条要的正是"新增持久数据与能力须同步原有对外说明"，这条我欠着。

**这一格落了什么**：`pnpm check:legal-email-claims`（`scripts/check-legal-email-claims.mjs`，已进链）。
它把"封闭句式 ↔ 代码集合"钉成对账（先例是 `check:legal-tools` 钉那张工具表），两个方向按形状分档：

- 文本点名的那封**代码里不会发** ⇒ 判红。它现在就是红的，红在共享检出的那两行"十封/registration code"上 ——
  归那条把 `registerCode` 写进文本的线，四枚命中逐条带文件与句子；复现：`pnpm check:legal-email-claims`。
- 代码会发而文本没点名 ⇒ 只打印（那一档要**重写对外句子**，而那五份文件此刻被三条线同时握着未提交改动：
  `privacy.ts` 的 19 枚 hunk 里 **8 枚**带 `automation-metadata` / `2026-10-07` 那批行 / `本公司` 整片改写，
  `index.ts` 还多一枚指向未跟踪 `presentation.ts` 的导出，`terms.ts` 有 368 行是别人的合同主体重写。
  从这条检出单面提交整片＝切掉别人那半，而法务版本号进 `legalSetVersion()` ⇒ 连带同意指纹）。
  臂 A4 钉住"这一档现在只报不红"，等那批一次收拢后把 `undisclosed` 并进 failing，臂不用改。

⚠️ 造这把尺的过程中，我自己的探针先中了两枪（都在 tip 那趟读数里现形，不是设计时想到的）：
`email.ts` 的发信口是 `export const` 不是 `export async function` ⇒ 第一版解析出 `shipped=0`（臂 A1 当场拦住）；
英文枚举最后一枚带 `and ` 前缀 ⇒ 被我的连接词过滤器整枚丢掉，把 HEAD 判成"写五封只点到四枚"的假自相矛盾。
两条都是**尺错，不是文本错** —— 逐条按 `SELFTEST_ARMS` 的输出复核才敢下结论，臂数与全部臂名由 `--self-test` 自己打印。

**这一格仍然开着的**（写成欠项，不包装成做完）：§5 第 9 条那半句"界面上现在显示的是 UA"已用用例钉住；
但 §6.78③ 那四枚**漏披露的文本更正还没落** —— 它要重写 `privacy.ts`/`third-parties.ts` 那三句（中英各三），
而这三句和上面那 8 枚别线 hunk 在同一批文件里。落法已备齐：改哪三句、每句改成什么，由
`pnpm check:legal-email-claims` 的 🟡 那行直接给出名字清单；落地那一笔必须**一次收拢三条线**（像倒数纪念日
那批的分组提交），并连带 `node server/scripts/gen-server-legal.mjs` 与 `node packages/legal/scripts/gen-site-copy.mjs`
两份生成物 —— 后者会写 `packages/i18n/src/locales/{zh-CN,en}.ts` 里那一段 `<<<generated>>>` 块，
不碰 landing 的 HTML，所以与 §6.47 那格"landing 重生成批次"的撞车面**不相交**（原先那条登记理由也因此作废）。

### 6.79 `SAFE_ERROR_MESSAGES` 那一格：静态尺的形状、被否证的第一版口径，与"两半各归各"的臂（10-10 11:3x–12:0x 现量）

§6.71 修完之后剩的那一半是：`auth.ts` 抛的 `'Invalid or expired link'` 不在 `SAFE_ERROR_MESSAGES` 里
⇒ 它永远被 `getSafeErrorMessage` 的兜底句顶掉，而那件事当时**只有链路 10b 一条运行时判据守着**，没有静态尺。

落的两样：

1. `server/src/api.ts` 的白名单里补进那一句（一笔五行：四行理由 + 那一句）。
   `api.ts` 在主检出被别人写着 ⇒ 走 plumbing（HEAD 版 + 我这五枚字节的 hunk），随后把**同一片补丁**打回工作树，
   复验 `git diff HEAD -- server/src/api.ts | grep -c "Invalid or expired link'"` = **0**（两边都不掺）。
2. 新门禁 `scripts/check-safe-error-fallbacks.mjs`（`pnpm check:safe-error-fallbacks`，已进链）。

**第一版口径是错的，而且是"把自己的 RED 消掉"那种错法**：我原先写成"每一枚兜底句都必须在白名单里"。
真树现量：白名单 12 句 / 抛出点 115 处（去重 68）/ 兜底句 18 处（去重 14）⇒ 那一版**一次判红 17 处**，
全是别线在用的通用失败句。那不是他们错了，是我那条规则超出了主张本身 ——
主张讲的是"抛出的那句与兜底的那句是同一句话时，它必须能被识别"，所以判据是 **throw 集合 ∩ fallback 集合**，
交集命中才是缺陷。改成交集后真数 **2 处**命中（其中一处正是我这格），修完 **0** 处、白名单 13 句。
⚠️ 记这条是因为它的反面很有诱惑力：给封闭词表加一档豁免、或者把别人那 17 处一起登记成缺陷，都能让我自己那枚红消失。

臂（`--self-test` 自己打印臂数与每条名，别在这里抄）：阳性对照（真树必须扫到 ≥1 处交集）、
把白名单里那一行摘掉 ⇒ 红、只抛不兜底 ⇒ 放行、只兜底不抛出 ⇒ 放行、注释里提到 ⇒ 不算、
跨三行的调用点 ⇒ 认得出、双常量名 ⇒ 认得出。自守下限三条（分母解析不足退 **2** 而不是退 0）。
真树臂 S1：在纯 tip 载体上摘掉我加的那行 ⇒ rc=1 并点名两处命中，`RESTORE=clean`、复跑 rc=0。

### 6.80 三把尺互相指认的"法务欠账"，最后两条是我自己造的（10-10 12:3x–13:0x 现量）

这一节四条，前两条各自撤回一条我已经入库的结论。起因是我想把 W7 那批法务文本"按 HEAD 的真值重推导一遍"，
而推导用的是 tip 那几把尺 —— 结果 tip 的尺本身就是坏的，于是我"修"出来一份**假话**，
差点把它提交进法务文件。

**① 我从 tip 派生的那批法务文本整个作废**（载体 `.worktrees/iosacct` 已 `git checkout --` 回 tip；派生过程的中间件
留在 `~/heyta-carriers/w9-acct-logs/legal-derived/` 那 6 枚作留形，最后那两笔 —— 把数字改成 37/36、把「墓碑」加回英文清单 ——
没有留形，因为它们本来就不该存在）。
坏在探针，不在文本：tip 的 `packages/legal/tests/structure.spec.ts` 顺序回放迁移里的外键增删，
但**不认识 `DROP TABLE`** —— `tombstones_user_id_fkey`（`0_init:130` 加、`20251228000001_remove_tombstones` 随表删掉）
一直留在账上。于是 tip 现量算出 **37 条 / 36 张**，而真表 `account_tombstones`（`schema.prisma:549-553`）
**故意不建外键** —— 建了级联就会把注销标记一起抹掉。
我按那个数改了 privacy 与 data-rights 的级联数字，又把「墓碑 / tombstones」加回注销承诺的英文清单，
而那句对本线恰好是**假话**（注销标记必须比账号活得久，这是那份文件自己写明的设计）。
主检出里 10-08 那批未提交的法务文本早就把这两处修掉了：它带一枚把这条扣减照出来的判据
「🔴 已 DROP 的表不许留在级联账上（幽灵外键）」，并把 `tombstones` 从 `CATEGORY_NAMES` 摘掉。

派生过程中的三档读数（**"失败条数更少"不等于更对**，那一红列里的表名才是内容）：
纯 tip 基线 `2 failed | 64 passed (66)` ⇒ 我的派生态 `1 failed | 65 passed (66)` ⇒
主检出那批装在纯 tip 代码上 `5 failed | 71 passed (76)`。

**② §6.78② 那句"工作树里也发不出去"是假的，错因是我今天刚入库的那把尺混了载体。**
`check:legal-email-claims` 读文本用磁盘（`readFileSync`）、找调用点用 `git grep`（只看得见索引）。
`server/src/password/registration-otp.ts:259,319` 真的调 `sendEmailPasswordRegistrationCodeEmail`
（那一枚文件此刻未跟踪），所以"十封"是**真话**，被我的尺判成四枚超承诺。
改法与两向取证：调用点改成按磁盘扫（`SERVER_TS` 递归收 `server/src/**/*.ts`，跳 node_modules/dist），
删掉 `gitGrepFiles`；新臂 A6 抹掉那一枚发信常量的**全部**调用文件 ⇒ 那一封必须立刻不算实发
（`git grep` 那一版在这臂上纹丝不动），A2 改成用 A6 那把摘掉调用点的读法现造"有发信器、没调用点"，
不再依赖真树上恰好有一封没接上的信。`--self-test` **7/7 绿**。
两头读数：主检出实发 **10**、rc=**0**；纯 tip 代码 + 那批未提交文本实发 **9**、rc=**1** 逐条点名「注册验证码 / registration code」。
同类扫查：本线另一把新尺 `check-safe-error-fallbacks` 走 `readdirSync` ⇒ 没有这个形状；
仓内另有九枚脚本用 `git grep`，但它们判的是 tracked 内容自身的形状，不属于这一类。提交 `scripts/check-legal-email-claims.mjs` 单独一笔。

**③ 那批法务文本（10-08，未提交）的真身：本线那一格其实早就做完了，还差的两格都不是我的。**
它已经把 `access_sessions`／`email_change_requests` 逐类写进注销承诺**并**登记进 `CATEGORY_NAMES`
（中英两栏 + 变更行），所以 §5 那条"本线欠四枚漏披露"的判据侧不必重做。差的两格：
- **差 A**（自动收集那条线）：带修正探针的真源现为 **36 条 / 35 张**，文案写 34/33；
  `automation_entitlement_activations` / `_links` / `_subjects` 三张在类别表里没登记。
- **差 B**（同批里别人那半，`packages/legal/tests/email-catalog.spec.ts` 未跟踪）：三枚命中，
  其中一枚是它自己的内部矛盾「排除变更表之后仍有不符项，与上面那条判据矛盾: expected 10 to be +0」。
⇒ 联合提交的前置没有变（那五份文件此刻仍被三条线同时握着），但**"欠什么"这张表现在是准的**：
本线不再欠法务文本，只欠"由文件的写入者一次收拢"。

**④ 共享检出那几分钟的索引里躺着我线的删除件**（写清给并行会话）：`git status` 报 **6 枚**路径 D/M，
恰好是本线最后四笔提交的全部文件 —— 两枚门禁脚本 `D`、台账 −162 行、`apps/web` 用例 −42、`server/src/api.ts` −5、
`package.json` 那两条门禁链。工作树完好（磁盘内容逐枚 == HEAD），所以**任何一次基于索引的提交都会把本线那四笔无声删掉**。
处置只动索引、不动工作树：`git restore --staged --source=HEAD -- <那 6 枚路径>`，
复验 `git diff --cached` 空、`server/src/api.ts` 回到 ` M`（别人那半没碰）。不猜是谁写的，也不替谁回滚别的路径。

### 6.81 iOS 设备腿今天取不了数：**两棵树各自在一处红**，两处都不是本线（10-10 13:1x 现量）

负责人把这一腿留成 goal 的收口条件（"先不合上，等设备腿"）。这一轮真的去取了，结论是**这一腿现在谁都跑不了**，
而原因有两种相反的形状 —— 两种都由别线那批在飞的改动带着：

| 载体 | 结果 | 现量 |
|---|---|---|
| 纯 HEAD（tip `731cc2e2`） | `pnpm -r build` 红 | §6.76 那第三处：`packages/app-host` 的 barrel 导出一枚**不在 HEAD 里**的源文件（`task-batch-actions.ts`，`??`），另有 `SyncClientOptions.getInboundUploadAuthorization` 只在未跟踪那半里 |
| HEAD ＋ 整片在飞改动（3782 枚脏路径逐枚 sha256 同步进隔离载体，验过 3707 枚） | `pnpm -r build` 红在**另一处** | `apps/node-host` 的 dts 阶段：`Type '"waiting-entitlement"' is not assignable to type '"empty" \| "submitted" \| "needs-confirmation"'` |

第二处的形状值得写给那条线（也写给下一个跑重装的人）：生产侧 `packages/app-host/src/inbound-process.ts:53`
把 `InboundAutomationCycleState` 加宽成四态（`:72-73` 真会回 `waiting-entitlement`），
而消费侧 `apps/node-host/src/host.ts:274` **把那个 union 内联重抄了一遍**（没 import 共享类型）⇒
共享层加一态，抄的那一处不会报错，直到 dts 阶段才炸。
这正是 AGENTS §3.5 拦的形状（apps/ 里重抄一份产品语义），而 §3.5 那次教训的原话就是"抽取的收尾动作是删掉旧的那份并加门禁"。

**不代改**（三条不齐）：① 修它不是删一子 —— 要把内联 union 换成 import，还得决定 node-host 在
`waiting-entitlement` 那一档**做什么**（CLI 是退避重试、报错、还是安静等订阅，那是产品语义）；
② 改后的运行时形状无法现量等于改前；③ `apps/node-host/src/host.ts` 此刻是 ` M`（那条线正在写）。
交回内容：根因两行（`inbound-process.ts:53` ↔ `host.ts:274`，报错落在 `src/host.ts(422,5)`：
把加宽后的 `InboundAutomationCycleResult` 交给那个内联签名）＋ 一条已现量真跑出红（rc=1）的命令
`cd .worktrees/iosacct && npm_config_verify_deps_before_run=false pnpm --filter @heyta/node-host build`。

⚠️ 另一条顺带的装置事实，写给下一个想在载体里跑构建的人：`pnpm -r build` 在载体里会先触发
pnpm 的 deps 自检并**自作主张跑 `pnpm install`**，本机那一条会 ECONNRESET 到 registry，
于是失败信息长得像"缺依赖"。加 `npm_config_verify_deps_before_run=false` 才是走到真错的那一步
（第一趟就是被它挡住的，红在那枚 install，而不是红在类型）。**不动任何本机网络配置**。

⇒ 台账 §5/§6 的状态不变：本线那三块（换绑 / 会话撤销 / 改密）在**设备**那一腿的最后一趟读数仍停在 §6.16 的第 11 趟
（步骤 1–9 全绿、5 处探针错）。要取"探针修完之后"那一趟，前提是上面两枚红里有任一枚被它的 owner 收掉。

**载体现在的形状（写给下一个来跑这一腿的人，别重新推一遍）**：`.worktrees/iosacct` 的 HEAD = `731cc2e2`，
工作树 = 主检出那一刻的整片在飞状态（3782 枚脏路径里 3707 枚逐文件 sha256 对过；
清单与哈希基线在**本机路径、不在仓内**：`~/heyta-carriers/w9-acct-logs/dirty-files.txt` 与同目录 `dirty-baseline.sha256`）。
它的 `node_modules` 完整（含在飞新加的 `@zxcvbn-ts/*`），`pnpm-lock.yaml` 干净 ⇒
**不要**在载体里跑 `pnpm install`（会撞网），构建一律带 `npm_config_verify_deps_before_run=false`。
跑法两步已备好：`bash ~/heyta-carriers/w9-acct-logs/run-ios-account-leg.sh <IOS_UDID>（同样住在本机、不在仓内）`
（里面是"槽端口选空位 → `scripts/mobile-e2e-up.sh` → 那一腿 → 只停本趟 pidfile 里那一枚"），
装包那一层是 `IOS_DEVICE_NAME="heyta-ios-isolated" HEYTA_NO_FOCUS=1 npm_config_verify_deps_before_run=false bash scripts/reinstall-all.sh --only ios`。











### 6.82 交接写成的一趟里，拦设备腿的墙**在两小时内自己塌了**；顺带把我自己那三条旧结论各否证一次（10-10 18:3x–19:1x 现量，载体 `.worktrees/iosacct`）

负责人要的是交接（`close-long-session`），落点是仓内既有体例 `docs/plans/<线>-handoff.md` ＋ `-reflection.md`
（现量：`ls docs/plans/*-handoff.md | wc -l`，写这份时 15 枚，另有同族 `-reflection.md` 3 枚）。
两份新文件**没等到我提交就被别线那笔 `0243762a` 一起收进 HEAD**（宽 `git add` 第二次扫走本线未提交件；
第一次是 B131 那段进 `0eea4c0f`）⇒ 里面的错**只能新写一笔更正，不能 amend**。

写交接的同一趟里连着量到四件事，三件**否证我自己刚入库的结论**：

| # | 事实 | 它推翻的是 |
|---|---|---|
| ① | `waiting-entitlement` 的内联重抄**不是一处**：18:5x 枚出三处（`apps/node-host/src/host.ts:274`、`apps/web/…/inbound-runtime.ts`、`apps/web/…/InboundAutomationSettings.tsx`），其中**第三处被第二处遮着** —— `setProcessState(result.state)` 里 `result` 的类型来自第二处那个三态签名，所以把第二处改成 import 共享类型的那一刻第三处才会红 | §6.81 那句「排除 `apps/node-host` 就能构建」：排除之后 `BUILD_RC` 仍是 1，红只是搬到 `apps/web` |
| ② | 已提交的 `packages/i18n` 有 **4 行重复键**（en/zh 各 `site.platforms.android.body` 与 `…desktop.body` 两遍）⇒ `TS1117` 让 `pnpm -r build` **停在第一枚包**，后面每枚包都没编译过。修法零行为变更：JS 字面量**后者覆盖前者**，所以"删前留后"改的只是把没生效的那半行去掉（反证形状：反过来就会改界面文案）。登记 **B141**（原取 B138，19:1x 发现与别线撞号 ⇒ 后到者让号；`BLOCKED.md` 没有防重号门禁） | —— 全新 |
| ③ | 🔴 **这两格都不是我修的，也不是我等的 —— 是 owner 在我写交接的同一小时里自己收掉的**：19:1x 现量主检出 tip 已到 `1a30d3bc`，i18n 重复键复核 **0**；`apps/node-host/src/host.ts:275` 现在是 `Promise<InboundAutomationCycleResult>`（`:56` 已 import 共享类型），另外两处也一并改成 import（`InboundAutomationSettings.tsx:13/:37/:72` 用 `Partial<Record<InboundAutomationCycleState \| 'failed', …>>` ⇒ 四态都有位置） | §6.81 第一行「纯 HEAD 红在 app-host barrel」；以及我 B137 里那句「三处内联」——现在**零处** |
| ④ | ⇒ **全链构建绿**（载体 = tip `1a30d3bc` ＋ 32 枚脏路径）：`pnpm -r build` **`BUILD_RC=0`、`error TS` 计数 0、18 个顶层目录被建** | 本线设备腿的**拦路条件消失** |

另外两条**装置层**的自纠，都写进了复盘表：

- 🔴 我凭记忆拼的两枚 ADR 文件名**两枚都不存在**（`0063-session-rows-and-email-rebind.md`、
  `0039-token-compartmentalization.md`；真名 `0063-email-rebinding-and-per-session-revocation.md`、
  `0039-email-first-auth-and-desktop-reverse-authorization.md`）。
  **发现者不是我** —— 别线那枚 B136 的死链读数点名了我这两行。⇒ 文档里指向具体文件的路径必须 `ls` 现量，
  编号＋主题拼不出文件名。
- 🔴 我第一版"摘重复键"的脚本有 **off-by-one**（`seen[k]+1` 当 0-based 下标用），删掉的是重复键**中间那行空行**，
  两枚重复键原封不动 —— 于是「红从 en.ts 搬到 zh-CN.ts」被我一度读成"en 修好了"。
  改成正确的 `kill.add(seen[k])` 之后复核 `重复=0`。
  ⚠️ 诊断改动**只落在载体**，做完**逐字还原**（`git hash-object` == `git rev-parse HEAD:<file>`、
  `git status --porcelain -- packages/i18n/` 当时为空）；**主检出一个字没动**。

⚠️ 一条给下一个跑 pnpm 的人：`grep -c` **在零命中时以 rc=1 结束**，把它接在 `&&` 链里会让后面所有命令静默不执行
（我这趟真实撞到过一次：`No-projects-matched 命中=0` 之后整条链断了，看起来像"什么都没发生"）。
数命中就用 `;` 串，别用 `&&`。

**设备腿现状**：墙塌了 ⇒ 19:1x 起 `heyta-ios-isolated`（UDID 现量 `xcrun simctl list devices booted`），
locale 设 `zh_CN`，`IOS_DEVICE_NAME="heyta-ios-isolated" HEYTA_NO_FOCUS=1 bash scripts/reinstall-all.sh --only ios`
（**走脚本原路，不做任何偏离**，日志 `~/heyta-carriers/w9-acct-logs/reinstall-ios-leg.log`），
随后 `bash ~/heyta-carriers/w9-acct-logs/run-ios-account-leg.sh <UDID>`。
那一腿的读数落在下面 §6.83（跑完再写，跑不完就如实写"未闭合"）。

### 6.83 设备腿这一趟照出的两枚**探针/装置**缺陷，都不是产品（10-10 20:0x–20:2x 现量，载体 `.worktrees/iosacct`）

腿脚本 `scripts/verify-mobile-ios-account-email-sessions.sh` 第一趟 `LEG_RC=3`（**前提不成立**，不是产品判决）：
「装着的 bundle 比这些源码文件旧：`hosted-auth.ts`」。这条闸门是对的、也没被绕 ——
它照出的是**装包那一趟用的是 19:4x 的源码**，而 `packages/app-host/src/hosted-auth.ts` 在那之后又被改过。
⇒ 处置是重打重装（第四趟，进行中），不是改闸门。

同一趟里照出两枚**探针/装置**缺陷，各自带两路对照，登记为 **B145 / B146**：

| # | 缺陷 | 两路对照（同一时刻、同一设备） |
|---|---|---|
| B145 | **无头 boot 的模拟器上 `xcrun simctl io screenshot` 恒给纯黑**，与"app 没起来"的黑**逐字节同形** | `simctl io`（含 `--display internal`）= **106123 B 纯黑**；`idb --companion … screenshot` = **3331342 B**，**人眼看过是主屏**（heyta 图标品牌蓝在左上、Safari 在 dock、状态栏 20:24）。与陷阱 #208 不同族：换 `--display` 救不了（两枚逐字节相同），差别在**采集通道** |
| B146 | `pnpm install --frozen-lockfile --offline`（**含 `--force`**）在 lockfile 与 manifest 一致时**不补** node_modules 里缺的链接，只报 `Already up to date` | 主检出有 `apps/mobile/node_modules/@heyta/legal` 与 `packages/ui/node_modules/@zxcvbn-ts/{core,language-common}`；载体**都没有**（后者是个空目录）。两棵树全量链接差集 = **恰好这 3 枚**；手补后 `pnpm -r build` ⇒ `BUILD_RC=0`、18 个顶层目录。症状两枚：Metro `UnableToResolveError '@heyta/legal'`（`Bundle React Native code and images` 段失败）、tsup `TS2307 '@zxcvbn-ts/core'` |

**B145 的直接后果**：`reinstall-all.sh` 的 ios 段在无头设备上**永远**收不到 `RESULT_ios=OK`
（装包 ✅、新鲜度 ✅、截图 🔴「装上了但没起来」）。AGENTS §6.1.1 把截图那一格当"装上了且能起来"的定义，
所以**无头跑四端重装这个组合，判据形状上就闭合不了** —— 而 §6.2 规定二又要求验收不抢前台（即无头）。
这两条硬规定在无头 iOS 上**互相顶住了**，顶住的位置就是这条采集路。
修法不放松判据（仍要非空白 + 主蓝命中），只换采集路：改走 idb，或 simctl 黑时回退 idb 并**响亮打印用了哪条**。
本会话**没有改**那个共享脚本（三条不齐：改的是别人线的判据载体，且要配变异臂）。

**本会话这一趟的口径（写给读 §6.84 的人）**：iOS 装包与新鲜度两格由 `reinstall-all.sh` 给；
"装上了且能起来"由**腿脚本自己的 AX/界面判据**给（B145 已证 simctl 那条路在这类设备上不可用）；
app 二进制对应的源码 tip 与腿跑时服务端对应的 tip **可能不同代**，§6.84 会把两枚 tip 都写出来，
并列出两代之间碰没碰 `apps/mobile` 与账号面（现量命令：`git diff --name-only <apptip>..<servertip> -- apps/mobile packages/app-host`）。

### 6.84 iOS 设备腿第一趟完整读数：**77 绿 / 10 红**，换绑与撤销在真设备上成立，改密那一块没闭合（10-10 20:4x–21:10 现量）

载体 `.worktrees/iosacct`（tip `a63aa9e9` ＋ 7 枚脏路径），设备 `heyta-ios-isolated`，服务端槽端口 3102。
日志 `~/heyta-carriers/w9-acct-logs/leg-run3.log`；证据图 `apps/mobile/evidence/account-suite-ios/`。
🔴 两代 tip 要写清：**app 二进制**对应 `1a30d3bc`＋32 枚（19:4x 那趟 xcodebuild），**服务端**对应 `a63aa9e9`＋7 枚；
两代之间 `git diff --name-only 1a30d3bc..a63aa9e9 -- apps/mobile packages/app-host` **为空**（现量），
所以"app 里跑的是不是当前账号面代码"这一格成立。

**绿的核心三块（真设备、真服务端、零 mock）**：
- 换绑：判据 A–G 全绿 —— 设置面「个人资料」里换绑区块可达、当前邮箱行=登录邮箱、两封信真发出去（Ethereal 各取一条链接）、
  链接 GET 是确认页且不烧令牌、只点旧那半→重挂载读到「等新邮箱那一边」、点新那半→**库里地址改了、活请求没留下、旧令牌全局 401**、
  界面上的当前邮箱变成新地址。
- 撤销：判据 I 全绿 —— 真点「退出这一台」→ 系统 Alert 选 destructive → **库里少一枚、那一枚当场 401**；
  判据 J 的**库侧**全绿 —— 200 阳性对照之后「退出所有设备」→ **库里 0 枚（原来 2）、对照那枚同样 401**。
- 本地优先：判据 K 绿 —— 退出所有设备之后**本机明文库仍在盘上**（退出≠注销），新邮箱＋旧口令能重新签出一枚会话。

**10 枚红逐枚归因（不打包成一句"环境不行"）**：

| 行 | 红 | 归因 | 登记 |
|---|---|---|---|
| 90 / 115 | 两张「等待对方那一边」屏的截图主蓝臂 0 | 🔴 **2026-10-11 现量更正（见 §6.85）**：不是"尺的标定错"。混合色候选里第一枚就是屏幕上的 `#ACC4F7`（`color-surface` 就是 `#ffffff`，与卡片底同值）；真因是拍照时那颗禁用主按钮在**折叠线以下**，整屏零枚品牌色 | **B147**（其 10-11 追记） |
| 133 / 211 | 「设置面关不上（点了 6 次关闭它还在）」 | 腿自己的导航缺陷；两次都自愈（改走「先关再按一次」），后续判据不受影响 | **B148** |
| 180 / 188 | 「同步与隐私」在 AX 树里**有行但没有可点节点** ⇒ 判据 J 的界面侧进不去 | 同 B148 一族（设置面分组目录的可达性）；注意第 14 步同一屏**曾点进去过** ⇒ 与滚动/展开态有关，不是恒坏 | **B148** |
| 189 | 「界面还认为已配置 ⇒ 退出所有设备没清本机凭据」 | 🔴 **不能当独立产品结论读**：它是 180 的连带 —— 进不去那一屏时它回退去读根层文本，量的是错的屏。库侧判据（0 枚 / 对照 401）已经直接否掉"没清"这个说法 | 随 B148，正文写明连带 |
| 118 | 「新侧确认 HTTP 000」 | 取链接那一次 HTTP 抖动；**同一步的库侧三枚判据全绿**（地址已改 / 活请求已删 / 对照 401）⇒ 产品结果成立，红在探针那一跳 | **B149** |
| 215 / 233 | 90+90 秒等不到「立即同步」、4 分钟没到已同步态 ⇒ 改密对照基线没成立 | 🔴 **21:2x 更正**：不是"口令没进应用状态"。config 本就纯内存、口令喂得进 password 模式（`host.ts:625`）；第 68 行那枚 ⚠ 在填凭据**之前**（初始状态）；等不到控件时腿上只有根 tab —— 量的是错的屏。真因是 **B148 的导航连带** | **B148**（B149 已降级，见其 21:2x 更正节） |

**⇒ 改密（改登录密码）在真设备上这一趟没闭合**。🔴 这一句原先写的是"被 E2EE 口令没进应用状态闸住"，
**与本节上面那张表自相矛盾**（表里 21:2x 已经把它否证了）—— 实际卡点是 **B148 的导航缺陷**：
设置面关不上 ⇒ 后面每一步量错屏 ⇒ 「立即同步」根本没被按到。
换绑与撤销两块**已经在真设备上闭合**。

### 6.85 第 4–6 趟读数与"三枚探针缺陷"的逐枚归因闭合（10-10 21:2x – 10-11 00:3x 现量）

同一载体（`.worktrees/iosacct`，tip `a63aa9e9`）、同一台隔离模拟器（`heyta-ios-isolated`）、槽端口 3102。
日志 `~/heyta-carriers/w9-acct-logs/leg-run{4,5,6}.log`。

| 趟 | 结果 | 这一趟改了什么装置 | 卡在哪 |
|---|---|---|---|
| 4 | 未跑完（前置红） | —— | 载体缺 3 枚 node_modules 软链（**B146**），`pnpm install --frozen-lockfile` 报 `Already up to date` 也不补，手工建链后绿 |
| 5 | 第 14 步红 | 关设置面改成"只认可点的关闭"+ 收键盘 + `--scroll-into-view` + 「返回」兜底（`4c3e4c2c`） | 发现**第二张同意面**：凭据变更后 `LegalReconfirmSheet` 弹起、请求级闸住一切对外请求 ⇒ 处理器接上（`f7e40e37`） |
| 6 | **78 绿 / 8 红**（22:43 收） | 法务面处理器 + `sync_now` 的"进设置面同步分组再等一轮"诊断腿 | 8 枚红全部归因完毕，见下面三行 |

**第 6 趟 8 枚红的逐枚归因（每一枚都在这台模拟器上真按真回读量过，不是推的）**：

| 红 | 枚 | 真因 | 落点 |
|---|---|---|---|
| 两张等待态截图主蓝臂 | 2 | 拍照时那颗 `disabled` 的「发起更换」（屏幕色 = `#ACC4F7`）在**折叠线以下**；同屏在取景含它的那两张里同一枚色数到 **154 257** 枚 | 新增 `frame_email_change_action`（拍前滚进取景框）。**阈值一个字没动** |
| 「设置面关不上」 | 2 | 两层叠在一起：① 第二层那枚"可点的关闭"是**外层面板的残留 AX 节点**，按它 `result=success` 而界面不动（实测按中心与按下缘各一次）；② `ax_press` 旧写法既不滚、又把 `not-found`/`tap-outside-screen` 丢进 `/dev/null` | `close_settings_sheet` 改成"先退层再关面板"，判据改为"树上两枚可点节点都不在"；`ax_press` 拆两次调用 + 非 success 进日志。新陷阱 **#403** |
| 「同步与隐私 没有可点节点」+ 连带两枚 | 3 | 上一行的连带：面板没关成 ⇒ 腿停在"已经在分组页里"的状态，此时 `同步与隐私` 只剩一枚 `StaticText` 标题。**不是产品缺陷** —— 目录层实测它是 `Button`(32,249,402×44)，一发就进 | 随上；交给第 7 趟验 |
| 「4 分钟内同步没到已同步态」 | 1 | 分组页里「立即同步」的 frame 实测 **y=-343**（屏外上方），`--press` 被几何闸拒成 `tap-outside-screen` 而无人看见 ⇒ 探针从头到尾没按到过那颗按钮 | 随 `ax_press` 的修法（先滚再按）。#190 的第二种面目 |

🔴 **本线一条自己踩过的规律（写下来是因为它错了两版）**：**"按了没反应"要先证明那一下真按出去了**。
`result=success` 只等于"HID tap 被设备接受"，不等于"目标控件收到事件"；
而 `--scroll-into-view --press` 写成一次调用时**一下都不按、退出码还是 0** ——
这条仓库里 #190 早就明写过，是我在自己新写的腿里违反它、又拿 `>/dev/null` 把证据吞了，
才会把三枚探针缺陷读成"产品导航缺陷 + 同步被闸住"。

**改密（判据 L/M/N）的设备侧读数**：第 6 趟仍**没取到**（卡在最后一行）。第 7 趟是修完这三处之后的第一次整腿跑。

### 6.86 第 7 趟完整读数与**最后两块红的真因**（10-11 00:4x–01:5x 现量）

第 7 趟（修完 §6.85 那三枚探针缺陷之后）：**96 绿 / 8 红**，`LEG_RC=1`。
逐枚对上号：2 枚等待态截图（B147，已由"取景"修法闭合，本趟 `blueDisabled` 0→11043）、
2 枚「设置面关不上」+ 3 枚第 16 步链（**同一处，见下面第二格**）、
2 枚改密成功句（见下面第一格）、1 枚连带读数（不许当独立产品结论）。

这一节把剩下那两块红的**真因**写死，因为前两版归因都是停在腿的日志片段上推的：

**① 改密那一块：不是"没生效"，是"生效了却被报成连不上服务端"。**
服务端 `16:57:03.811 Password changed … all other sessions revoked`、库里 `token_version` 2→3、
旧令牌 401、新口令换得到新会话 200 —— 全在同一次运行里；而界面上（人看过那张图，
`apps/mobile/evidence/account-suite-ios/15-password-changed.png`）是一行红字
「连不上服务端，检查地址与网络后重试。」同一份服务端日志 **17:04:00** 才写
`Failed to send Password changed notice: Error: read ETIMEDOUT`。
⇒ 两条改口令的路由 `await` 了那封告知信，而 `deliver()` 内部已经 catch，
**不抛、不 5xx、只会挂**；iOS `URLSession` 默认 60 s 先断。
已修（`notifyPasswordChangedSoon`：发出但**不等**），判据是"让发信永不 resolve 也不 reject，
改密请求仍必须当场返回"，预算取自约束方（客户端 60 s）的 1/20；
变异把 `await` 加回去 ⇒ `MUT_RC=1` 且红的正是「响应被那封告知信扣住了」那一行；
全文件 21/21、`server` 的 `tsc --noEmit` 0 条错。详见 **B154** 与第 405 条。
📌 同一形状一共四处，另两枚（`service.ts:249` / `passkey.ts:556` 的 `notifyAuthenticatorAdded`）
`git log -S` 现量**也是本线那笔 `703cafc8` 引进的** ⇒ 已一并收掉：各加一条「发信永不 settle
仍当场返回」的判据，变异把 `await` 加回 ⇒ 两条各红一次，两文件全量 64/64 绿。

**② 顶栏那一格：不是导航缺陷，是载体机型。**
`heyta-ios-isolated` 是 iOS 27.1 SDK 新增的 **iPhone-Duo**，实测顶栏标题在 **y=18**
（同一份产物在 iPhone 17 Pro 上是 **y=80**）⇒ 这一档给的 `insets.top` 是 **0**，
顶栏**最右那一格**（x 406..450，中心 (428,28)）坐在系统状态列的挖孔摄像头下面，
`ui tap` 回 `result=success` 而控件收不到。它一次解释了 B148 那两枚「设置面关不上」
与第 16 步那三枚「退不回根层」。
🔴 **判别实验不能省**：同带内（y 同样 6..50）的次右格 `打开搜索` (376,28) **一点就开**
（树 17→52 个节点）⇒ 我第一版写的"状态条带吞掉点击"是错的，死的只有最右那一格。
处置是**换载体不改产品**：`Screen` 顶栏本来就写 `paddingTop: insets.top`，
为一份模拟器 profile 去垫最小值，是替一个没量到的真设备做设计。
新载体 `heyta-ios-isolated17`（iPhone 17 Pro / iOS 27.0）装同一份当前产物，
腿的两条新鲜度判据成立；旧载体只 `shutdown`、没删。详见 **B155** 与第 404 条，
以及第 403 条的追记（它当时那枚「关闭」的"残留节点"归因**没被检验过** ——
残留节点与"那一格是死的"给出同一个读数）。

**③ 顺手撤回一条假绿**：`fill_three_credentials` 原来在关完面板后回根层找
`notConfigured` 那句 —— 现量那句挂在 `ProfileScreen.tsx:1099` 的同步段里，
而那一段 10-09 起作为 prop 交进了设置面，**根层从来不画它** ⇒ 那条 `if … then bad`
是一条永不成立的断言。已换成本屏独有的正面证据「返回 heyta 官方同步」。


### 6.87 第 8 趟（新载体 iPhone 17 Pro）：**通过 101 项 / 失败 0 项，`LEG_RC=0`** —— goal 的收口条件「iOS 设备腿取到读数」在这一趟闭合（10-11 01:45–02:22 现量）

载体 = `heyta-ios-isolated17`（iPhone 17 Pro / iOS 27.0），装的是同一份当前产物
（bundle mtime 10-10 20:41，腿自己的两条新鲜度判据都成立），
服务端从隔离检出 `.worktrees/iosacct` 起在槽端口 3102，收尾只停本趟那一枚
（`STOPPED pid=77846 port=3102`）。日志 `~/heyta-carriers/w9-acct-logs/leg-run8.log`。

**第 7 趟那 8 枚红，这一趟逐枚的读数**：

| 第 7 趟的红 | 第 8 趟 | 靠的是什么 |
|---|---|---|
| 两张等待态截图主蓝臂 | ✅ | 上一批的"取景"修法（`frame_email_change_action`），与载体无关 |
| 「设置面关不上」×2 + 连带 | ✅ | 载体换档 ⇒ 顶栏最右那枚 ✕ 不再被挖孔压住（B155 / 第 404 条） |
| 第 16 步「退不回根层」×3 | ✅ | 同上 |
| **改密成功句没出现**×2 | ✅ | **服务端那笔修**：告知信发出但不等（B154 / 第 405 条） |

🔴 **这一栏是 goal 收口条件的那一格，写清它证到哪一步**：
`✅ 界面出「登录密码已修改。」（'mobile.security.password.done'）` +
`✅ 成功那一句说清了别的设备要重新登录（'doneDetail'）`，
同屏还有 `15-password-changed.png`（`blue=9068`，过了"非空白 + 数得出主蓝"两条）；
协议侧同趟对上了：旧令牌 401、新口令换到新会话 200、库里 `token_version` 2→3、
旧口令换不到会话 401、**改密之后这台自己仍能同步**（第 4 秒到已同步态，
⇒ 新令牌确实落了活配置，没有"改个密码把自己这台也踢出去"）、本机明文库仍在盘上。

**第 13/14 步（上一趟的红区）这一趟的读数**：「退出所有设备」那句必须是真的那一条走通了
（库里 0 枚 + 事先证明回 200 的那一枚新会话当场 401 + 同步分组那面两面尺），
重新登录并同步成、本机库还在（判据 K）也过。

**一处探针毛刺，不记红也不记已验证**：`[press] 「我的」没落地：{"result": "not-found"}`
在这一趟出现两次（第 15 步进出各一次），腿的兜底路径每次都自己恢复（改按「设置」那一行）。
这一趟**没有取到"那一刻树上到底有什么"的证据**（装置那份 dump 在退出时删掉，而
`not-found` 本身不带树），所以本条**只登记现象、不给成因** —— 下一手要收它，先把失败那
一刻的树留下来再看，别从"选中态的 tab 大概换了角色"往下推（元规则一：那是第三种读法，不是读数）。

**这一趟仍然不证的**（腿自己写在第 16 步末尾，别读多）：邮件里那两条链接由**人/设备**
点开的旅程（腿是 curl 直打服务端，点链接的人手上没有会话）、通行密钥那一块、Android、真机。

### 6.88 合并态门禁逐道现量（10-11 04:0x–05:3x）：**整条链第一道红不是本线的，第二道却是本线自己撞的 —— 已改号收回**

goal 的交付标准写着「门禁全绿」，而本线此前只按文件跑过单测，所以这一段是**第一次把门禁逐道量 clean**。
整条 76 步链的断点仍是 `check:reachability`（`COMMENT` 已建模、零写路径）—— 读数、归属与本线因此不能声明的那一格在
**BLOCKED B159**；本段只补**断点之后**的部分：把链上会撞到的其余各道单独取数，一道一道问【这一格红在谁手上】。

**本线能修的只有本线弄红的那一枚**：`check:adr-numbering` 报 `同号=1 歧义=4`，
`git log --diff-filter=A` 取到 `docs/adr/0058-…` **有两枚**，后到的一枚是本线 `9fa53ab9`（10-08 21:31）。
按那枚门禁文件头写明的修法（后来那一枚改号）⇒ 本线那枚 **0058 → 0064**，六处引用逐处改，
改号前先现量确认 0064 是空号（主检出 + 各隔离检出 + 全历史 `--diff-filter=A` + `grep 'ADR-0064'`）。
复验读数：`check:adr-numbering` RC=**0**（`ADR文件=64 裸引用=2223 同号=0 歧义=0 悬空=0`）、
`check:docs`（死链）RC=**0**、`check:doc-citations` RC=**0**（臂数由它自己打印，本处不抄）、
`check:md-table-rows` RC=**0**、`check:docs-voice` RC=**0**。逐处清单与理由在 **B160**。
⚠️ 改名与引用**不能拆成两笔提交**：中间那一笔的状态就是五处死链，`check:docs` 会当场红给它看。
🔴 **而这一格本可以完全不发生**：`9fa53ab9` 落下去之前，同一天的 0053 双订已经写进那枚门禁的文件头注释里了 ——
取号之前先 `ls docs/adr` + 现量空号，这一步的成本是十秒，代价是后来者读到的 `ADR-0058 §N` 有两种读法。

**红的五道，逐道查过归属，没有一道能由本线修**（详见 B161；这里只留【本线不动手的理由】）：

| 道 | 本线不动手的理由 |
|---|---|
| `check:reachability`（`COMMENT`） | 修法是给评论功能补 app-host 动作层 + 宿主入口 ⇒ **另一条线的功能**，不在注册登录的地界 |
| `check:layering`（`SHARE_KEY`） | 那枚文件工作树**干净**（本段现量 `git status --porcelain -- <那枚>` 为空），所以它是已落地的违规、不是在飞的东西 —— 但修它要新增一族动作层，而它的**消费方**（share 面）此刻正被协作线整片改 ⇒ 本线加那一族等于替他们决定形状 |
| `check:ui-language`（`web.share.invite.emailPlaceholder`） | 两条出路（翻成中文 / 进 `UNTRANSLATABLE_KEYS`）**都是别人的判卷口径或对外文案** |
| `check:verify-script-copy`（2 枚失效 needle） | 那是**别人验收脚本的判据**；真因是 `e6058120` 改了词条而脚本没跟上 ⇒ 改哪一侧都要那条线拍 |
| `check:integration-coverage`（1 枚从未跑过的用例） | 点名要写进别线的 `test:integration:postgres`，而那枚用例的运行前提（要不要外部服务）只有它的作者知道 |

📌 **这一轮最值钱的不是改号，是一条一般规律**：一枚别线提交（`e6058120`，10-09 14:35）**同时占着三道红**
（`COMMENT` 的可达性、`SHARE_KEY` 的分层、`notConfigured` 换词后的两枚 needle）。
所以撞见第一道红时该做的是 `git show --stat` 那笔、看它还动过哪些**收口面**（词条表、实体登记面、外壳 op 构造面），
而不是每撞一道重新查一次归属 —— 查归属是本段五道里最贵的那部分成本。

🔴 **本线自己也被同一族咬了一次登记层**：本段第一版把 B156 写在并行线 02:0x 那枚 B156 之后
（`grep -c '^## B156' BLOCKED.md` 当场 = 2），而 ADR 有 `check:adr-numbering`、**BLOCKED 的编号没有尺在守**；
更早的一例是 `B102` 也躺着两枚（`0533f460` 10-07 / `2a378fdf` 10-09），两天没人报。
本线这枚按同一套修法改登 **B159**（后写的改号），细节在 B161 末节。

**本线因此能说与不能说的那一格**（不包装成完成）：
✅ 能说：覆盖本线改动全部落点的门禁与套件都取过数 —— 下列读数取自 `15fca4f7`（改名那一笔之前），
**要现量请重跑，别抄这张表**：`pnpm -r typecheck` RC=0（20 个顶层目录）、
服务端 158 文件 / 2785 passed、`@heyta/app-host` 94 文件 / 1775 passed、本线新加的真库判据所在文件 21/21、
文档族五道 RC=0、iOS 设备腿第 8 趟 101/0（§6.87）。
🔴 不能说：「`pnpm check` 整条链绿」—— 它停在 `check:reachability`，后面（含 `check:ai-e2e` 整族与 `pnpm -r test`）
在共享载体上没走到，而这一档按 `FULLCHECK-01` 记的是**环境未验**，不是【通过】。

**载体一行**（下一趟要用，别重新试）：设备腿第 8 趟的载体是新建的 **`heyta-ios-isolated17`**
（iPhone 17 Pro / iOS 27.0，402×874、`insets.top = 62`）。换它的原因与量到的读数在 **B155** 与环境陷阱 **#404** ——
旧载体 `heyta-ios-isolated` 是 iPhone-Duo，顶栏最右那一格坐在挖孔摄像头下面、`insets.top` 报 0，
HID 点击回 `success` 而控件收不到（**探针说成功，不等于界面收到了**）。

### 6.89 重置密码邮件点开是 404：四种可能各自怎么被排掉，与那两处边缘白名单（10-26 夜 现量）

用户报的是一枚打不开的信：`https://heyta.waytofuture.cn/reset-password?token=…` ⇒ **404**。
"路由没写"、"代码里有但线上没部署"、"域名指错"、"静态托管缺 fallback"这四种都可能长成那样，
所以逐种给一条排掉它的读数，而不是挑一种最像的解释：

| 假设 | 排掉它的读数（都是当夜现量） |
|---|---|
| 代码里没这张路由 | `node scripts/check-credential-page-routes.mjs --json` 从 `server/src/pages.ts` 读到**五张**页在册，含 `/reset-password` 与 `/change-email` |
| 有代码但线上没部署 | **同一个域名**上被放行的三条（`/verify-email`、`/magic-login`、`/recover-passkey`）回的是 **400**（缺 `?token=`），且响应头带 Fastify 的安全头与限流头 ⇒ 服务端活着、路由在；而那两条 404 的 `content-type` 与落地页一致 ⇒ 请求**根本没到服务端** |
| 域名指错 | 出事的与没出事的那几条**同一个 host**；链式验收 ⑫ 还额外断言信里的链接指向**本次**这台服务端（`scripts/verify-email-password-chain.mjs`） |
| 静态托管缺 fallback | 方向正好相反：落地页 `location /` 那条兜底**就是**把这两条压成 404 的东西。凭据页必须走代理，靠 SPA fallback 只会拿到落地页（那族本域名历史上踩过五次"200 + 落地页字节"） |

**真因一句话**：`server/deploy/caddy/sites.d/00-heyta.caddy` 里那两条**手写枚举**
（`@credPages` / `@credJs`）停在"三张页"，后加的 `/reset-password`、`/change-email` 没被抄进去。
要覆盖的集合长在代码里，白名单是手抄的 —— 这两处之间隔着一个仓库边界，**没有任何一步会失败**。

**改了什么**：`@credPages` 扩到五张、`@credJs` 扩到四支（少脚本的那两支是"页面画得出来、
按钮是死的"那种半死形状，同一次补齐），`server/scripts/caddy-sync.sh --apply` 上线
（先备份 `00-heyta.caddy.bak-<UTC>`、整份 `Caddyfile` 验过 "Valid configuration" 才 reload）。

**防复发三件**（各带能红性）：
1. 常驻门禁 `pnpm check:credential-routes`（已进 `check` 链）：双向对账 —— 少一页红、
   少一脚本红、多一条孤儿代理红、两侧读空报"探针不成立"退 2 而不是报合规；
   `--self-test` 六臂逐条证自己那条判据（干净/抽页/抽脚本/造孤儿/信里指向不存在的页/边缘读空）。
2. 线上判据 `e2e/live-site/live-credential-pages.spec.ts`：分母从 `--json` 现读，
   逐枚量状态码、正文不等于落地页、脚本 content-type、邮件里的 `/app/` 两枚深链、
   脚本自己发的 `/api/…` 端点答得像服务端，外加 ⑦「这张页服务的是不是它自己那张页」
   与一枚未注册路径的阳性对照。
3. 手册里"三张凭据页"那种**枚数抄件**删掉，改成指向这把尺（`docs/runbooks/deployment.md`）。

**同族逐枚读数（10-27 用真浏览器在线上复量，同一趟里取的；分母 = 信里真会写出的全部目的地）**：

| 目的地 | 读数 | 结论 |
|---|---|---|
| `/reset-password?token=…` | 200 `text/html`，正文不等于落地页，引自己那支 `/reset-password.js` | 可达（**修前是 404**） |
| `/change-email?token=…` | 200 `text/html`，正文不等于落地页，引 `/change-email.js` | 可达（**修前同样是 404**，与上面同一次补齐） |
| `/verify-email?token=…` | 200 `text/html`，引 `/magic-login-confirm.js`（与 magic-login **共用**那支） | 可达，修前也通 |
| `/magic-login?token=…` | 200 `text/html`，引 `/magic-login-confirm.js` | 可达，修前也通 |
| `/recover-passkey?token=…` | 200 `text/html`，引 `simplewebauthn` + 自己那支 | 可达，修前也通 |
| `/app/` 与 `/app/?signin=1` | 200，两份字节相同的应用外壳（正文引 `/app/assets/`） | 可达；但落地页导航上的「登录」不带 `signin` ⇒ 记 **B232**，不归本线 |
| 未注册路径（阳性对照） | 404 | 边缘仍在区分"没这条路由"，不是整站放开 |
| 脚本自己发的五枚 `/api/…` | 400 / 401，且各带机器可读 `code` | 服务端在答（不是边缘答的 404） |

⇒ **"还有没有同样打不开的"这一问的答案是：只有那两张，一起修好了**；另外三张凭据页与应用侧本来就通。
五张页的正文两两不同（判据 ⑦），所以不存在"两张页互换而看不出来"那种绿。

**边界，别读多**：`server/deploy/nginx/*.conf` 那两份是**死镜像**（本域名由 `caddy-edge` 服务、
`nginx.service` masked），里面那句"三张凭据页"没去动它，理由写在门禁文件头
（往没人读的文件里补规则只会制造一次假漂移）；真收件箱那一腿仍缺（缺口 G1，这里读的是
Ethereal preview）；线上落地页导航「登录」缺 `signin`、线上产物比 HEAD 旧那一处**不归本线**，
记在 **B232**。

### 6.90 间距扫描最后一格（验证码屏）改判成现量，与整条 `pnpm check` 的收尾读数（10-27 现量）

上一节的同族扫描剩最后一格没落：`AuthForm` 验证码屏那两处（登录档 / 注册档同形）当时登记成
**未判定**，写的理由是"这一屏要 `onLoginCode` 真发出挑战才渲染，而 e2e 装置里没有真服务端"。
**那句理由是错的，错的是一次探针失误**：触发器要先填邮箱才出现、而且住在「其他登录方式」那层折叠里，
我两次都没做这两步就去点它，读到 `isVisible()=false` 便把它当成了装置的限制。
现量：那一屏的同目录两条用例一直在用 `page.route()` fulfill 假挑战把它渲染出来 ——
`grep -n "page.route(" e2e/tests/auth-login-code.spec.ts e2e/tests/auth-registration-otp.spec.ts`。
坑本身登记成环境陷阱（号从 `grep -cE '^[0-9]+\. ' docs/reference/environment-traps.md` 取）。

补法不是"这次手动量一下记个数"，而是把那一格变成**常驻的四条臂**
（`e2e/tests/auth-form-spacing.spec.ts` 末尾，登录档 / 注册档 × 1440 / 375 各一条），
判据沿用本单已有那两条，不新造阈值：① 独立控件之间合成视觉距离 ≥ 12px；
④ 住在 `gap=space.1` 容器里的文字链按「触控目标 ≥ 44×44px」那条明文规则判**它自己成立**（高度 ≥ 44）。
读数（2026-10-27 真 Chromium，四档全同）：

| 量的是哪一格 | 读数 | 判的尺 |
|---|---|---|
| 验证码框 → 验证按钮（登录档 1440 / 375） | 12px | ①（吃 `primary` 自带的 `marginTop: space.2` 补偿） |
| 验证码框 → 验证按钮（注册档 1440 / 375） | 12px | 同上 |
| `-submit` / `-resend` / `-change-email` 盒子高 | 44px（墨迹 20-21px） | ④ |
| 两枚文字链的墨迹间距 | 27px | 只报数不判：仓内没有一条明文规则规定两行文字之间隔几 px |

⇒ 那两处的"不是缺陷"从此**不再靠代理读数**。移动壳那一格仍登记为未判定，理由与判它的断言写在尺的文件头。

**整条 `pnpm check` 的收尾读数**（10-27 一趟跑完，43.0 分钟）：`423 passed / 1 flaky / 2 skipped`。
那枚 flaky 是 `e2e/tests/rail-roving.spec.ts:300`（键盘拖拽与 dnd-kit `KeyboardSensor` 共存，
断言的是"进入拖拽后 `.ht-rail__item--dragging` 归零"），retry 即过，与本线的间距改动无关。
唯一的**硬红在链条最后一道**，而且是自己那枚：`node scripts/check-shell-unicode-vars.mjs` 指着
`server/scripts/caddy-sync.sh` 的第 78、187 行 —— 那是我 2026-10-25 那笔 `7f7349cda` 留下的
`$name（…）` / `$CADDY_BIN）`。本机（bash 3.2.57）同一句只换写法的现量对照：

```
LC_ALL=en_US.UTF-8  修前> 尾 / 校验通过（          ← 变量值整个被吞掉，只剩替换符
LC_ALL=en_US.UTF-8  修后> caddyfile（尾 / 校验通过（caddy）
LC_ALL=C            两种写法都对 —— 所以这枚坑只在正常终端环境下现形，而那正是人盯着看证据的地方
```

症状与门禁写的那句一致：**脚本照常退 0，只是打印出来的实测证据是乱码** —— 对一份"以实测输出为证据"
的部署脚本比崩溃更糟。改法照门禁给的修法（`$var` → `${var}`），复量 `node scripts/check-shell-unicode-vars.mjs` 退 0（分母：210 枚被跟踪的 `.sh`）。

**这四条新臂的能红性（10-27 现量，变异只动产品、没动过任何一条断言）**：把 `textAction` 的
`minHeight` 从 `touch-target.min` 单独改成 `space.4`（16px）、重建 `@heyta/ui` 再跑这四项 ⇒
**4 项全红**，报的是 `④ …「-resend」「-change-email」实测高 29px < 44px`（16 是声明值，29 是它
被内容 + `paddingVertical` 撑到之后的实际高度——两数都低于 44 那一档，所以这条抓的是"点击区变矮"
而不是"数值等于几"）。从自己那份 `.mut-bak` 还原、再重建一次，整条尺复跑 **6 passed（24.1s）**，
`git status` 对 `packages/ui/src/auth/AuthForm.tsx` 退空 ⇒ 产品源回到原样。

**线上那把尺自己坏过一次，修好后 13:49 重取的读数**（这条必须记，因为它坏的时候所有门都是绿的）：
我给本单文件头抄的那条现量命令里含 `sed 's/?.*//'`，其中"星号紧跟斜杠"是**块注释的终止符** ⇒
`e2e/live-site/live-credential-pages.spec.ts` 从那一刻起一枚用例都不剩，而 `pnpm check` 的 e2e 腿
只跑 `e2e/tests`，这个目录的编译没有常驻消费者。修法与常驻防线：命令换成等价的 `cut -d'?' -f1`，
新门 `pnpm check:e2e-specs-parse`（27 枚配置逐枚 `--list`，parse 判红、其它拒跑只报数；
`--self-test` 两臂用今天这个形状现造夹具，读数「2 臂，0 臂不符」），坑记在环境陷阱 #596。
用修好的尺重量（真域名，13:49）：**五张凭据页全 200 `text/html`、五支脚本全 200 `application/javascript`、
未注册路径仍 404、五个 `/api/…` 各带机器可读 `code`**（逐项正文哈希由尺自己打印，不在这里抄数）。
⇒ §6.89 那张表里的读数现在是**同一把能编译的尺**复量出来的，不是修好之前那批旧引用。

**第二趟 `pnpm check`（13:51–14:38，带上 `check:e2e-specs-parse` 一起跑）**：e2e 腿 **428 passed / 2 skipped（39.8m）、
`✘` 计数 0**；新门在链内读数「2 臂，0 臂不符」＋「25 过 / 2 按设计拒跑 / 0 编译红」；我的间距尺在链内
6 枚（含验证码屏那四条）全绿。整条链 `CHAIN_RC=1` 只由**一枚红**贡献：`apps/web` 的
`tests/task-sort.spec.tsx:253`（断言 `entities.tasks[task.id]` 存在，读到 `undefined`）——
不是本线的文件（它最后一次改动是 `63e61f237`，属产品体验线），而且**单独把 2603 枚全跑一遍是
`2590 passed | 0 failed`** ⇒ 这枚红是 2603 枚同跑时的时序/隔离读数，登记为负载红，不由本线代改。

### 6.91 线上「验证码登录」当场是死的：schema 没把列名 map 到迁移给的名字（10-27 22:1x 现量，本线名下已修）

**缺陷定性**：生产容器 `/app/prisma/schema.prisma` 里 `EmailLoginChallenge.userId` 后面没有 `@map("user_id")`，而库里那一列**是**迁移建的 `user_id` ⇒ Prisma Client 引用 `"userId"` ⇒ 这张表每一次读写都 `P2022`。注册那条（`email_verifications`）不受影响，所以症状只有一个：验证码登录进不去。口令登录、重置密码、换绑都不在这张表上，所以此前四趟线上验收全绿也没撞上它。

**为什么 build/typecheck/单测一个都不响**：`server/tests/registration-otp.spec.ts` 那一族不打真库（`npx vitest run` 8 passed 而文件里没有任何迁移/真库标记），而 schema 与 migrations 是同一现实的两种写法，没有任何一把尺逐枚对过名字 ⇒ 本线补了一把静态尺（下格）。

**已入库（两笔，都在 `origin/main` 上）**：
1. `fix(注册登录/schema)` —— `email_login_challenges` 的 `userId` 补 `@map`、`@@index` 补 `map:`；顺带把 `automation_events` 那枚租约索引按迁移 20261018050000 的裸 SQL 名字登记 `map:`（不登记，`migrate diff` 会对着线上提 `DROP INDEX`，而租约续期那条读路径正靠它）。
2. `feat(门禁/尺)` —— `scripts/check-schema-migration-drift.mjs`：A) 迁移建了而 schema 认不出的索引名 / B) 迁移建了列而没有任何字段映射到它 / C) schema 声明了而按迁移重放出来的库里没有（名字与形状两条路，唯一性单独成一维），带 WHERE/USING/函数列/`_ops`/COLLATE 的按形状豁免并计数，`KNOWN_GAPS` 两枚各带归属与理由、命中数变了就红。复量 `pnpm check:schema-migration-drift`；自检臂数由脚本自己打印（`node scripts/check-schema-migration-drift.mjs --self-test | tail -1`），含"删声明必须红""注释里的索引名不许当 DDL""同语句先 DROP 再 CREATE 不许红""未知旗标必须被拒""尺的输入不在场必须点名红""迁移目录空着必须红"。变异实测：抹 `@map("user_id")` ⇒ B 红，抹租约 `map:` ⇒ A 红，把 `unknownFlags` 改成恒空 ⇒ 只有"未知旗标"那一臂红、`rc=1`，把 `missingInputs` 改成恒空 ⇒ 两臂同时红、`rc=1`，还原复绿（`.mut-bak` 还原）。

**这笔尺自己挨的一记（22:2x 自查，同一晚补上）**：写完第一版只 `process.argv.includes('--self-test')`，**不认的旗标被静默忽略** —— 我用 `--schema <别的路径>` / `--migrations-dir <别的路径>` 去试"路径指错会不会红"，两发都 `rc=0` 并打出仓库这一份的绿。那一刻读起来像"尺对坏路径免疫"，其实是**整发命令没成形**：它压根没读我指的路径。同族形状就是环境陷阱 #601/#603/#604（打空仍然 rc=0）。处置：未知旗标一律拒 + `missingInputs()` 点名 schema 与迁移目录两格（含"目录在但一枚带时间戳前缀的迁移都没有"那种空重放），各配臂与变异实测（上句）。耗时那一维顺手量了：真树单次 `real 0.05s`，`--self-test` 同量级 —— 它进链不构成成本。

**线上读数与取法**：逐格表（库里列名/索引名、容器里那几行 schema、两发点名探针、`/api/login/email-code/verify` 503 对 `/api/register/email-password/verify` 400 的对照、resend 400、诱饵 201）记在 [`BLOCKED.md` B238](../../BLOCKED.md)。**日志里 `P2022` 取 0 次不等于没人碰**——那台容器 `Up 23 hours` 而 `docker logs --since 720h` 回来的总行数比一次正常启动还短，取不到更久历史（两格都带现量命令，B238 里）。

**我自己第一发探针是假绿**：`findMany({ take: 0 })` 回过 `SELECT_OK`，那一刻读起来像否证了本条结论；`take: 0` 不生成列引用，所以它什么都没判。规矩（判列名存在性必须 `WHERE`/`SELECT` 点名那一列 + 挑一个匹配不到任何行的值，零副作用与可证伪不冲突）入 [环境陷阱 #604](../reference/environment-traps.md)。

**待拍板（不算已修）**：
- **换线上容器那一步**：本修复不需要新迁移（库里的名字本来就对，改的是客户端的看法），要做的是"重建生产镜像 + 换容器"。`scripts/deploy-ssh.mjs` 三档：`--dry-run` 只打印计划 → 默认 `--sandbox`（一次性网络/库/容器）→ `--apply --yes-production`（覆盖在用镜像 tag、重启 `supersync-server`，两旗同时给才算人拍过）。按 `docs/runbooks/deployment.md` 6b：先打 `supersync:rollback-<日期>`、旧容器仍在服务时跑迁移、`MIGRATE_RC=0` 才 `up -d --wait`；换完重取 §3.8.1 五条线上判据。**没授权之前本线两档都不跑**。
- **`resend` 那格把服务端故障说成"这验证码无效或已过期"**（`server/src/api.ts:2520`），而同一族紧邻的 verify 已明写"服务端故障不许说成码不对"（`server/src/api.ts:2488`）⇒ 一份立场两处写法。改成 503 是 **HTTP 线协议语义**（🔴 不可逆层），要连三端壳的 `FAILURE_REASON_BY_SERVER_CODE`（`packages/app-host/src/hosted-auth.ts:678`）与 i18n 词条一起判，所以登记不代改；同形状的第二枚在注册 resend（`server/src/api.ts:2422`），今天不露出来只因为那张表没坏。
- **`login_unavailable` 没进客户端白名单** ⇒ 503 落到 `server-error`，丢掉服务端明说的"稍后再试"（`grep -n "login_unavailable" packages/app-host/src/hosted-auth.ts` 无命中即现状）；要不要为它加一档 reason 归文案与四端词条一起定，`hosted-auth.ts:671` 那句"别为一个子流程迫使所有壳加词条"就是它的反方。

### 6.92（2026-10-27 22:35–22:56 · 负责人授权「直接换线上容器」后）发布落地与发布后读数

上一节那条"没授权之前本线两档都不跑"在 22:3x 被解除：负责人选的是**直接换线上容器**那一档。执行的是 `scripts/deploy-ssh.mjs --apply --yes-production --ref b55e988078f8…`（`--ref` 显式钉死，不拿 `HEAD` 当参数 —— 那台机器上 `headSha` 与 `git archive` 是**两个时刻**读的）。判决行、逐格发布后读数与复取命令都在 [`BLOCKED.md` B238](../../BLOCKED.md) 那张"发布已落地"表里，本节只记三件**下一位会用得上、又不在读数里**的事：

1. **修好的是服务端那一半，用户可达的那一半要靠另一件产物**。网页应用不在镜像里被服务：公网 `/app/` 打的是宿主机 `/var/www/heyta-app`（`index.html` 两端 sha256 相同可证），镜像里那份 `/app/web-dist` 是第二份拷贝。所以"换容器成功"与"用户能看到验证码登录"是**两件事**，`/health=200`、五张凭据页全绿、`HEALTH` 判据都覆盖不到后者。为此把线上尺 `e2e/live-site/live-signin-entry.spec.ts` 加了一条常驻判据（文件头判据 2a）：展开「其他登录方式」后 `auth-form-login-code-trigger` 必须可见 —— 它判的正是"那一盘 SPA 里这一档在不在"，而不是"服务端接不接"。
2. **变异轮自己会打空，而且打空的样子和通过一模一样**。第一发我用 `perl -0pi -e 's/auth-form-login-code-trigger/…-MUTANT/'`，`-0` 把整份文件当一条记录、没有 `/g` ⇒ 只替换**第一处**，而第一处是我自己写在文件头注释里的那枚同名串；断言那行没动，用例照绿 `rc=0`。要改的目标必须带上只有代码里才有的形状（`[data-testid="…"]` 整串），并且**跑之前先 `grep -n` 确认命中的是断言那一行**。还原也不从 git 拿（判据此刻还没提交，`git checkout` 会把我这一整块抹掉），从同目录的快照 `cp` 回去。
3. **`/var/www/heyta-app` 与 HEAD 不齐这一格停在待拍板**，不在本线代做：把它对齐要重新构建并 rsync，而 22:21 之后落进 `apps/web` 的那批输入全是自动收集线的产品改动 ⇒ 一次 rsync 会把**别人那两笔**一起推上线。判"盘里有没有这两句新文案"用的是 grep 命中数，配了一枚控制臂（同目录 grep `email-code` 命中 1 ⇒ 证明搜法本身有效，前两枚的 0 不是"尺没扫到"）。命令在 B238 那张新待拍板表的右栏。

### 6.93（10-27 23:0x 现量）本轮编辑的质量复核：五格各自怎么量的

范围只圈**本轮这几笔**（`server/prisma/schema.prisma`、`scripts/check-schema-migration-drift.mjs` + `package.json` 接线、`e2e/live-site/live-signin-entry.spec.ts` 判据 2a、两份证据件、台账）。每条都带一条**现在就能重跑**的命令，不写"看过了"。

| 格 | 读数 | 命令 |
|---|---|---|
| ① 重复实现：新尺与仓内另一枚迁移尺重叠吗 | 不重叠。`check-migrations.mjs` 判的是 CONCURRENTLY/隐式事务形状，文件里 `indexname`/`@@index`/`map:` **命中 0**；碰过 `schema.prisma` 或 `migrations/` 的脚本共 4 枚，逐枚看过职责 | `grep -cE 'indexname\|@@index\|dbName\|map:' scripts/check-migrations.mjs`；`grep -rln 'schema\\.prisma\|prisma/migrations' scripts/*.mjs` |
| ② 死代码：尺里每个声明都有调用点吗 | 30 枚顶层声明，**没有一枚只出现一次**（即没有"定义了没人叫"）。⚠️ 第一发我按 `^function` 数，返回空 —— 那把尺只扫一种写法；真实声明是 `function`/`const`/`async` 三种混着，重数才是 30 | `grep -oE '^(export )?(async )?(function\|const) [A-Za-z0-9_]+' scripts/check-schema-migration-drift.mjs \| awk '{print $NF}' \| sort \| while read f; do n=$(grep -c "\\b$f\\b" scripts/check-schema-migration-drift.mjs); [ "$n" -le 1 ] && echo "$f 只出现一次"; done` |
| ②b 无自动消费者的出口 | `--dump-indexes` 只有文档引用它（人看的取数出口），没有门禁叫它。**判为不修**：删它等于删一条排障路径，而它 0.05s 就能跑完 | `grep -rl 'dump-indexes' --include='*.md' --include='*.mjs' . \| grep -v node_modules` |
| ③ 性能 | 尺真树单次 `real 0.05s`（进链不构成成本）；本轮唯一碰到读路径的是那枚 `@@index([userId], map: …)` —— 它**登记的是库里已存在的索引**，不改库。没引入循环内 IO / N+1：尺是纯静态读两份文件 | `time node scripts/check-schema-migration-drift.mjs` |
| ④ 错误处理是否真实存在 | 两处当场修完：a) 尺自己吞未知旗标 ⇒ 现在未知旗标拒、输入不在场点名红（臂数自打印，变异实测见 §6.91）；b) 线上那发 `verify` 的 503 兜底把 P2022 说成"服务不可用"，**形状是机器可读的**（带 `code` 与 `retry-after`），所以它不是吞异常，是**话说错了**——改它归线协议语义 ⇒ 进待拍板 | `node scripts/check-schema-migration-drift.mjs --self-test \| tail -1`；`curl -s -X POST https://heyta.waytofuture.cn/api/login/email-code/resend -H 'content-type: application/json' -d '{"challengeId":"no-such"}'` |
| ⑤ 产品视角：本轮改动有没有做出"两个入口/没有回执" | 一格**新缺陷形状**（不是本轮引入，是本轮量出来的）：网页应用与服务端是两件产物两条发布路径，`deploy-ssh.mjs` 只换容器 ⇒ "改对了但没上线"仍可在整条 check 全绿时发生。已用常驻判据 2a 把"验证码那一档在线上那盘里在不在"钉住；**发布链本身要不要收第二件产物**归发布线判（见下） | `cd e2e && npx playwright test --config playwright.live-site.config.ts live-signin-entry`；`ssh finlaw 'sudo -n sha256sum /var/www/heyta-app/index.html'` 对 `curl -s https://heyta.waytofuture.cn/app/ \| shasum -a 256` |
| ⑤b 可达性（不算缺陷，登记给人看） | 「使用验证码登录」收在「其他登录方式」那根折叠条后面（`aria-expanded=false`），而那条写作一行被横线穿过的字 ⇒ 第一眼读起来像**分隔线**而不是按钮。要不要默认展开是取向题，本线不代改 | `cd e2e && node -e`（探针留在 `~/.heyta-evidence/login-code-prod-deploy-1027/probe-panel-2.mjs`，打印 `toggle 展开前 expanded=false` 与展开后四枚 testid） |

**本轮"已修"合计（都在 git 里，逐笔可对账）**：`git log --oneline --since="2026-10-27 20:00" --author-date-order -- server/prisma/schema.prisma scripts/check-schema-migration-drift.mjs package.json e2e/live-site/live-signin-entry.spec.ts apps/web/evidence/login-code-live-after-deploy-1027`。
**仍停在待拍板的**：B238 那两张表（错误形状那三格 + `KNOWN_GAPS` 两枚 + `main` 上游指 gitee + 别人在飞的脏项 + 本轮新增的"`/var/www/heyta-app` 与 HEAD 不齐要不要现在对齐"）。

### 6.94（10-27 23:1x 现量）两枚新尺：线上那盘新不新、门禁自己 parse 不 parse

**① `scripts/live-web-freshness.mjs`（`pnpm verify:live-web-freshness`）** —— 把"公网 `/app/` 那盘 SPA 落后仓库多远"从我手搓 grep 变成一条命令。针脚 = 最近若干枚动过 `packages/i18n/src/locales/zh-CN.ts` 的提交里**新增**、且 key 被 `apps/web/src` 引用过、值够长的词条；顺着入口 JS 里的 chunk 名**再爬一层**（只抓入口会让住在懒加载 chunk 里的新文案假红）。默认**永远 exit 0**（承 `dist-freshness.mjs` 同一条纪律：并行会话刚落 i18n 而还没发布时，"落后"是正常态，一条天生红的门禁等于没有门禁），要为一个读数负责就显式 `--strict`。三种假绿各有一臂：分母为空判红、抓不到线上记 `fetch-error` 而不折算成"不在场"、未知旗标直接拒。
现量读数（23:0x）：`臂数 8 ｜ 不符 0`；真跑抓回 8 枚产物，针脚 13 枚来自 3 笔提交，**1 枚不在场 ⇒ 线上那盘旧于 `b55e98807`**，`--strict` 退 1。这一发同时是它的**真实世界阳性对照**：同一件事我今天早上是手搓三条 `grep -rl` 加一枚控制臂才量出来的。
🔴 一条诚实的限制：针脚只认"被 `apps/web/src` 引用"的 key，所以一枚只在 `packages/ui` 里用的词条不会成为针脚（读数里那行"没被 web 引用 9"就是它）—— 收窄分母是刻意的，宁可少判也不假红。

**② `scripts/check-scripts-parse.mjs`（已接进 `pnpm check`）** —— 逐枚 `node --check` 扫 `scripts` 下全部 `.mjs`。它挡的是这一族：块注释里出现那对"星号斜杠"字符 ⇒ 注释被提前关掉 ⇒ **整枚文件 parse 不过**，而**没接进链的工具没有任何一层会告诉你**（唯一解析它的时刻就是有人手动去跑它）。本仓这一族咬过三次（e2e/live-site 那把线上尺坏过一整晚、hunk 删声明没删调用点、以及今天我自己写尺时又犯一次），按"同一手滑犯到第三次就下沉成会拒的命令"办。
现量读数：`枚举 207 枚 ｜ 语法红 0 枚`，单次 `real 4.2s`；自检 `臂数 5 ｜ 不符 0`（含"坏的那枚必须被点名、好的不许被牵连"与"分母为空必须判红"两臂）。
**它第一趟就红给了我自己看**：这枚尺自己的文件头写了 `` `scripts/**/*.mjs` `` —— 那对字符把注释关掉，`--self-test` 第一趟 `rc=1`。第四形、当场被自己造的尺抓住，这就是它该在链里的理由。

**同一晚我自己造成的一次夹带与一次丢件（都当场发现、当场复原，记下来给下一位避坑）**：

- **夹带**：`git add -- <我的路径>` 之后 `git commit` **不带 pathspec**，提交的是**整份索引** —— 于是别人**早已暂存**的一枚新文件被我一笔带走（第一发是 `docs/plans/global-ux-system-remediation.md`，第二发更糟：`package.json` 里别人未提交的 `check:focus-single-source` 定义与链上那一格被推进了 HEAD，而那枚脚本文件还没落仓 ⇒ 干净载体的 `pnpm check` 会**替他们红**）。复原都是 `git reset --soft HEAD~1` + `git restore --staged <那一格>`，别人的暂存原样留在索引里。
- **丢件**：为了"只提交我那一行"，我把 `package.json` 按 **HEAD 的内容**重写了一遍 —— 那一步把别人**未暂存**的两格从工作树里抹掉了。亏在动手前先 `cp` 了快照（`~/.heyta-evidence/login-code-prod-deploy-1027/package.json.{final,mixed-worktree}`），从快照原子还原后逐格核对才没造成实际丢失。
- **正确的做法（本轮最终用的就是这个）**：要提交"HEAD + 只我的改动"，**不要动工作树里那份共享文件** —— 用 `git hash-object -w` 造 blob、`GIT_INDEX_FILE=<临时索引> read-tree HEAD` + `update-index --cacheinfo`、`write-tree`、`commit-tree -p <OLD>`，最后 `update-ref refs/heads/main <新> <OLD>`（**带 OLD 做 CAS**，HEAD 被别人推过就会拒）。收尾记得 `git restore --staged <我那两格>` 把陈旧索引刷回 HEAD，否则 `git status` 会报出一枚"暂存的删除"看着像我把文件删了。
- **判据**：每笔提交后除了 `git show --stat`，还要对**共享文件**做一次结构对账（`git show HEAD:<file>` 与工作树逐键比，确认"链里新增的格"只有我的）。本轮那两次红都是这么抓出来的，不是靠眼看 diff。

**顺手登记一件我自己的手法缺陷**：改 `package.json` 用的是"截断式写"（`open(p,'w')` 再写），而这是**共享仓里被所有门禁读的文件**。改完那一分钟里 `pnpm check:gate-wiring` 报了一次 `rc=1`，随后连跑三趟全 `rc=0`，日志被覆盖所以无法归因到具体读法——**不写成结论**，只登记两条：① 改共享 JSON 要走"写临时文件 + rename"的原子替换；② 一次性的红要留日志再重跑，否则下一位只能听我转述。

### 6.95（2026-10-27 23:3x · 把"复取命令"当被测物来验，而不是当散文来写）

这一节全部来自同一个动作：B238 那张归属表写完之后，**把表里每条命令真跑一遍**。四件事当场翻出来，都是"写的时候完全看不出来"的形状。

| 发现 | 现量 | 去处与判据形状 |
|---|---|---|
| 🔴 **表格单元里的 shell 命令会被 markdown 转义毁成一条死探针**。管道符在表格里必须写成斜杠竖线，复制到终端后 `grep -E` 里那个转义竖线读成**字面竖线** ⇒ 这条自称"扫敏感件"的判据永远 0 命中、也永远不会红 | 见下面【死探针的自证】—— 坏写法 0 行 rc=1，好写法 4 行 | **不开新尺**：仓内同形状的分母见下面【分母】，太大 ⇒ 一条天生红的门禁等于没有门禁（本仓 §7 元规则）。做法是本线改写：可复制执行的命令一律写进**表外代码块**，表格里只留归属与理由；判据 = 写完后逐条实跑并核对退出码（本轮 13 条，过 13 / 不符 0） |
| 敏感件按**文件名子串**扫会自己造出假案 | 修好转义后同一条命令读回 4 行命中，**全是 `tokens.*` 家族**（`packages/design-system/` 下的设计变量件与其生成产物）—— 名字里有 token ≠ 密钥 | 判据落在**内容形状**上（私钥头，见下面【敏感件该扫的形状】）；文件名只做二次线索、不做判决 |
| 我上一条 commit 的信息**声称做了两件事，实际只做了一件** | 链条把 python 改写与 `git commit` 用**分号**串起来 ⇒ python 因中文引号撞语法错先失败，commit 照样跑完（`COMMIT_RC=0`），信息里那句"并把方向词改对"当时并没有落地 | 两处永久形状：① 分号换成 **`&&`**（前一步失败就不许走下一步）；② 提交信息点名的每一处改动，要能在 `git show` 的 diff 里找到对应行。处置走 forward-fix，不 reset：这棵树的 tip 随时会被别线推进（本轮就看着 `9cc4e000f` 落在我上一笔之后） |
| 台账里的"指名"复取命令**保质期是分钟级** | 那条读旧符号的 grep 写表时命中、4 分钟后 rc=1 —— 因为自动收集线自己把那枚重命名提交了 | 复取命令要读**不会随提交消失**的那一面：读那笔提交、读文件头的署名句，而不是读"当前 index 里还有没有旧符号"。表里那一列同时挂上"这一列会漂，先取数再打勾" |

```sh
# 【死探针的自证】同一件事的两种写法，坏的那条读不出任何东西
git status --porcelain | grep -E '\.env\|id_rsa\|\.pem\|token'   # 表格里那种写法复制到终端：0 行，rc=1（看起来"很干净"）
git status --porcelain | grep -E '\.env|id_rsa|\.pem|token'   # 修好转义：4 行，全是 tokens.* 家族（假案）

# 【分母】仓内"表格单元里的转义管道"同形状有多少处 —— 这枚数决定为什么不开新尺
grep -rhc '`[^`]*grep[^`]*\\|[^`]*`' --include='*.md' docs BLOCKED.md | paste -sd+ - | bc

# 【敏感件该扫的形状】按内容扫，不按名字扫
git status --porcelain | sed 's/^...//' | while read p; do
  [ -f "$p" ] && grep -lE 'BEGIN (RSA|EC|OPENSSH) PRIVATE KEY' "$p"
done                                               # 判据：空输出；非空就单独隔离不入库
```

一句话形状：**登记一条命令和登记一条结论是同一种责任 —— 它必须能失败。** 探针自己坏掉时，它给出的"干净"是最贵的一种假绿，因为读的人正照着它决定不做什么。


### 6.96（2026-10-27 23:3x · 按路径限定提交之后，"HEAD 自己是不是半棵树"只能拿干净检出量）

工作树里有别人未提交的件，所以**在工作树上跑绿，证明不了 HEAD 绿**。这轮造了一枚只读检出把这件事量掉：

```sh
git worktree add --detach /tmp/heyta-head-selfcheck HEAD
cd /tmp/heyta-head-selfcheck
for s in check-gate-wiring check-scripts-parse check-doc-command-claims live-web-freshness; do
  node scripts/$s.mjs --self-test > /dev/null 2>&1; a=$?
  node scripts/$s.mjs > /dev/null 2>&1; b=$?
  printf '%-28s 自检 rc=%d ｜ 现跑 rc=%d\n' "$s" "$a" "$b"
done
git worktree remove /tmp/heyta-head-selfcheck        # 只删自己造的这枚
```

读数：**四把全 rc=0**（含本线今晚新加的两把）——`check:scripts-parse` 的定义与链入、`verify:live-web-freshness` 都没把半棵树留在 HEAD 上。
链的自洽另量一次（引用步数、每步有没有定义、定义指向的文件在不在树上）用同一段 python，读数是"定义缺失 无 / 文件缺失 无"。

**两条我自己的假发现，如实记（它们比那条真结论更值得防）**

| 我量到了什么 | 实际是什么 | 为什么会错 |
|---|---|---|
| "链里引用了两枚不存在的定义 `--filter`、`-r`" | 探针错。链里那两步真身是 `pnpm --filter @heyta/landing check:entries` 与 `pnpm -r test`，我的正则把**旗标**当成了命令名 | 把"pnpm 后面那个词"当成键名，没排掉以 `-` 开头的 token |
| "HEAD 里三枚 `check-*.mjs` 没有任何定义引用 = 孤儿尺"（`check-imports-resolve`、`check-ratchet-ceilings`、`check-module-boundaries`） | 尺错。三枚都在 `scripts/check-gate-wiring.mjs` 的**在册消费者表**里（见同文件 `:174`、`:190`、`:206` 的 needle），它们的调用方不在 package.json 里 | 我只在 `package.json` 这一个面上找引用 —— 正是"一把尺在某处读 0，只说明它扫的那套写法里没有" |

顺手把这条问完了：**"链里引用了不存在的脚本"这一向有没有人管** —— 有，`scripts/check-gate-wiring.mjs:347` 那句注释就是它（"拼错或定义被摘掉 ⇒ 后面整串都不跑"），所以**不开新尺**。


### 6.97（2026-10-27 23:5x · 落地页那半边第一次做到字节级，顺手量出一枚"从未接上的目的地"）

`pnpm verify:live-web-freshness` 只看应用那盘 SPA。落地页（`heyta.waytofuture.cn` 根）那半边以前要人肉 `curl` + `diff`，
今晚把它并成同一枚尺的第二种模式：

```sh
node scripts/live-web-freshness.mjs --landing            # 分母 = HEAD 里已入库的每份落地页 HTML
node scripts/live-web-freshness.mjs --landing --strict;  # 不齐或线上没这页 ⇒ rc=1（本轮现实读数就是 1）
```

**归一化只许剔两类行**：仓库那份写着源文件（`main.tsx`），线上那份写着构建后的哈希产物（`/assets/main-…` 的 js 与同名 css）。
这两类之外的一行差异都算不齐。这条界限是判据的全部价值所在 —— 多剔一行就会把"线上真的旧了"吞掉，
少剔一行就会把**管线的阶段差**读成**版本差**：第一趟手搓就中了这一枪，每页恰好差 96 字节，
diff 打开只有那两行，与"旧"无关。

读到的事实（每次重跑，别抄数）：

| 格 | 读数 | 复取 |
|---|---|---|
| 落地页与 HEAD 齐不齐 | 不齐 **0** 枚；线上没这页 **1** 枚（`/pitch/`） | `node scripts/live-web-freshness.mjs --landing` |
| 这把尺在现实面前会红 | `--strict` rc=**1**（不是靠改判据变绿的） | `node scripts/live-web-freshness.mjs --landing --strict; echo $?` |
| 自检 | 臂数由脚本打印、不符 0 | `node scripts/live-web-freshness.mjs --self-test` |

**`/pitch/` 这一枚**：`apps/landing/pitch/` 是完整的 5 件套（`index.html`、`main.tsx`、`PitchDeck.tsx`、`pitch.css`、自己的 `vite.config.ts`），
但不在 `SITE_PAGES` 注册表里（注册表条数由右栏打印），线上回 **HTTP 404**。仓内引用面按**整词**读回来逐行分类，
没有一行是在接这枚页面。所以它不是"线上旧"，是**目的地存在过但从未接上**——产品视角里和"同一个目的地两个入口"相反的那一型。
归落地页/文档站那线拍板（接进去并给入口，还是整目录删），本线只让它可复量。

⚠️ 一枚**射程**结论，顺手量清了：`pnpm --filter @heyta/landing check:entries` 的分母是**注册表**，
所以"产物堆里躺着一枚没注册的 HTML"落在它射程外 —— 它今天绿（"入口文件与注册表一致"），而 `/pitch/` 就在树上。
有反向孤儿判据的是图片那侧（`gen-help-figures.mjs` 会点名"映射里没有的复制品"），HTML 这侧没有。

**第二次中"先怀疑探针"这一枪**：断言"仓内没有任何引用"那趟用的是带 `\b` 的正则；本机 BSD grep 的 `-E` 对 `\b` 的支持不是可以赌的东西，
所以换成 `grep -w` 并把分母逐行读完才敢写进台账（两种写法这次读数恰好一致，但"恰好一致"不是判据）。


### 6.98（2026-10-27 23:5x · "只剩登记过的例外"下沉成一枚尺，并顺手量到别人正在修的一枚永远绿的判据）

归属表是散文，脏集成员几分钟换一次人 —— 所以把分类本身钉进脚本：`scripts/check-worktree-exceptions.mjs`。
`git status --porcelain` 的每一枚必须命中一条**带理由**的规则，命不中的那一枚才是真正危险的那批
（"谁都可能顺手替别人提交掉"）。默认不红、`--strict` 才红；自检 9 臂里有两枚是牙：坏规则被拒、未登记被点名。

| 格 | 现量 | 复取 |
|---|---|---|
| 定义/链的冲突 | 加完定义后 `check:gate-wiring` **当场红**："定义还在但不在这次的链里 ⇒ 它不会再被跑，而链子照样绿" | `pnpm check:gate-wiring` |
| 出路（不是我想加的，是仓库自带的） | 链外**允许表**：逐条要写"为什么不进链"+ 一条**会执行它**的消费方；消费方落在 `docs/agents/commands.md` 的命令块 | `node scripts/check-gate-wiring.mjs --self-test && node scripts/check-gate-wiring.mjs` |
| 为什么不进链（这枚尺自己的理由） | 干净检出上它必然报"未提交 0 枚"⇒ 进链就是恒绿；并行会话正写着时它必然红 ⇒ 进链就是每天替别人红一次。两头都不对的门禁不该装在链上，载体是**人** | `git worktree add --detach /tmp/x HEAD && cd /tmp/x && node scripts/check-worktree-exceptions.mjs; git worktree remove /tmp/x` |
| 它第一次跑就点到的两枚 | ① 一枚 `*.mut-bak` 残渣（有人此刻正在对 `server/src/ai/managed-completion.ts` 施变）—— 这种**不该登记成例外**，它该在下一分钟自己消失；② `apps/mobile/tests/share-ui-assembly.spec.ts` | `pnpm check:worktree-exceptions` |
| 第②枚归谁（协作线自己正在修） | 它的加行写着：那枚 `/<Pressable[\s\S]*?testID="…"/` 从**文件里第一枚** `Pressable`（"不再提示"的勾选框）起手 ⇒ 摘掉真触发件的 `onPress` 它照样绿 = **一枚永远绿的判据**；他们配了 `press-channel-gone-mobile` 那发变异臂在修（`6e05f077c`） | `git show --stat 6e05f077c`；`grep -n 'press-channel-gone-mobile' research/tools/mutation-rigs/mutate-collab-consent-gate.mjs` |

**这轮我自己的一次手法，值得留一句**：`check-` 前缀的脚本必须在 package.json 里有定义（就是这枚尺的判据之一），
而 `package.json` 正被别的会话改着 ⇒ 只能用临时索引提"HEAD + 我这一行"。
提完必须**把同一行也插回工作树**：工作树少了这一行，任何一次整文件提交都会把我的定义抹掉，
而那时红的是下一位的 `check:gate-wiring`。判据：`git diff -- package.json | grep -c worktree-exceptions` 要读 **0**（这句在正文段落里，管道不该转义）
（我这行不在"未提交差异"里），同时 `grep -c focus-single-source` 要仍读 **2**（别人的行没被我动）。


### 6.99（2026-10-27 23:5x · 例外归属尺上岗第一天点出来的三枚，其中一枚是真的要修）

`pnpm check:worktree-exceptions` 今天的读数：未提交 43 枚里 **40 枚归到 4 条已登记规则、3 枚没人登记**。
逐枚定性（判据 = 它自己在仓里的形状，不是我猜的）：

| 那枚 | 定性 | 复取 |
|---|---|---|
| `?? e2e/tests/tmp-discard-probe.spec.ts` | 🔴 **一次性探针住进了常驻射程**：它已经在默认 e2e 配置的收集清单里（用例名自己写着 `TEMP probe: what is in the DOM after Esc on a dirty capture`），所以每一次全量跑都会执行它 —— 今天它进的是 `check:ai-e2e` 与那趟四十几分钟的串行全量的分母。后果不是"多跑一条"，是**"全量绿"这句判据里混进一条不稳定的临时用例** | `cd e2e && npx playwright test --list > /tmp/l 2>&1; grep -c tmp-discard-probe /tmp/l`（读 **1** 就是在册） |
| `?? docs/adr/0077-inbound-hosted-extraction-at-ingest.md` | 自动收集线正在写的 ADR（编号已定、正文未落）—— 他们 23:2x 已经把同批的 schema/迁移提交了，这份是同一件事的另一半 | `git log --oneline -3 -- server/prisma` |
| `M server/tests/inbound-hosted-extraction.spec.ts` | 同上那批的测试腿，此刻还在写 | `stat -f "%Sm %N" server/tests/inbound-hosted-extraction.spec.ts`（分钟级） |

**处置**：三枚都**不归本线代做** —— 前两枚的作者是自动收集线（他们在飞），第三枚是 UX 线的临时探针（作者随时要收）。
本线只做两件自己能做的：① 让它可复量（这枚尺）；② 把"临时探针会进常驻射程"这句连同取数命令登记在这里。
⚠️ 这不是"我删了它"：`e2e/tests/tmp-discard-probe.spec.ts` 不是我造的对象，共享检出上按名字删别人的在飞文件是本仓明令禁止的那一类。

### 6.100（2026-10-28 00:3x · "含并行会话的也要入库"量到最后是一枚跨线 import，不是一堆能直接提的改动）

目标那句是"所有未提交改动（含并行会话留下的）按逻辑分组入库"，收干净的口径给了两档：脏集为空，**或**只剩明确登记的例外并写清为什么。这一节就是那个"为什么"，并且把它从散文变成尺判得到的东西。

**量到的形状（三条现量，逐条附命令）**

| 读数 | 内容 |
|---|---|
| ① 硬前提 | 一枚**已跟踪、已改动**的界面文件 import 了一枚**没入库**的新模块：`apps/web/src/features/calendar/CalendarCapturePopover.tsx:9` → `../../lib/form/useDirtyDismissGuard.js`，而 HEAD 的 `apps/web/src/lib/form/` 里只有 `FormField.tsx` |
| ② 它还在被写 | 那枚 hook 不是"写完忘了提交"：mtime 落在分钟级（同上一条命令里的 `stat`），作者此刻还在调 |
| ③ 本组自身没缺口 | 日历那一组其余依赖全在 HEAD：两个 locale 文件里 `web.calendar.sidebar.*` 各就位；被删的两个 prop 在**源码**里引用面为 0 |

第③条我第一发读错过，两格都值得记：

- 我先 `git show HEAD:packages/i18n/src/locales/zh.ts` 读回 **0**，据此差点写成"词条不在 HEAD"。那个 0 的成因是 **`zh.ts` 这个文件在本仓不存在**（真名 `zh-CN.ts`，`git ls-tree` 现量）—— 对着不存在的文件 grep，空读数是搜法的属性，不是词条的属性。逐个真名重读：两份 locale 各有 2 枚，HEAD 里就在。
- `sidebarOpen` / `onToggleSidebar` 的第一发引用面读回 7 行，全住在 `apps/web/dist-types/**`（上一次构建的产物，不是调用方）。限定到 `apps/web/src`、`packages`、`e2e` 并剔产物后读回 **0** —— "没有别的调用方"这句这才成立。

**为什么这三条合起来就停在这里**：提那 4 枚 = 把 HEAD 写成"代码引用仓库里没有的模块"，红的是下一位的 `pnpm build` / `typecheck`，不是我这笔；把 hook 一起提 = 我以别人两分钟前写完的一半落仓。两档里前一档（登记例外）是目标允许、且不制造半棵树的那一档。

**把登记变成尺**：`scripts/check-worktree-exceptions.mjs` 加第二判 `crossLineImports` —— 逐枚扫未提交里**已跟踪**的 `.ts/.tsx/.mts`，解析其相对说明符（含 `.js`→`.ts/.tsx` 与无扩展名两档），落点不在 `git ls-files` 里就点名，分 `untracked`（在树上没入库）与 `dangling`（落点上根本没有）两种判决。自检 **14 臂**（新增 ⑩⑪⑫⑬⑭），现实读数 1 处、`--strict` rc=1。

```sh
# 现量：第二判 + 臂数 + strict 的退出码
node scripts/check-worktree-exceptions.mjs | sed -n '/跨线依赖/,$p'
node scripts/check-worktree-exceptions.mjs --self-test | tail -1
node scripts/check-worktree-exceptions.mjs --strict > /dev/null 2>&1; echo $?
```

**变异轮（证明第二判能红，还原只从 `.mut-bak`）**：把 `isTracked(c)` 那一格换成恒真 ⇒ 自检 ⑩⑫ 两臂 🔴、`臂数 14 ｜ 不符 2`、rc=1，同时现实里那枚真依赖被洗成"跨线依赖 0 处"（这就是假绿的长相）。`mv` 回原文件后：14 臂全绿、现实读数回到 1 处、`grep -c` 那句判据读回 1 行原始形状。

**我自己这一趟又犯了一次同一类错**：第一发 `--strict` 之前，尺把三枚 `from './helpers'` 判成 `dangling`，而 `e2e/tests/helpers.ts` 明明已入库 —— 成因是我的候选解析只补了 `index.*`，没补无扩展名那一档，于是别线的 spec 整批假红。修解析并加 ⑭ 臂把它钉住（⑭ 的夹具让 `exists()` 恒假、只有 `isTracked` 认 `helpers.ts`，解析再漏一次就红）。同一天在复取命令上栽的是同一类：**报"没有"之前先问是不是搜法看不见**。

**翻案条件（读数一变我就该代提）**：

```sh
git ls-files --error-unmatch apps/web/src/lib/form/useDirtyDismissGuard.tsx  # 退 0 = 作者已入库
```
那时第二判读 0 处，日历那组自成一组（词条与 prop 的依赖面已在 HEAD，见上③），我按 pathspec 代提；`pnpm check:worktree-exceptions` 的未登记栏届时应只剩 `tmp-discard-probe.spec.ts` 一枚 —— 那一枚要 UX 线的作者自己收（见 §6.99）。

### 6.101（2026-10-28 00:4x · 自线上那笔以来 35 枚的质量审阅：逐条开码复核，两处口径是我自己搜错的）

范围现量（别抄数）：

```sh
git rev-list --count b55e98807..HEAD                      # 自那次发布落进 HEAD 的提交
git diff --name-only b55e98807..HEAD -- server/ packages/app-host packages/ui apps/web/src apps/mobile | wc -l
```

⚠️ **这一节的标题里那个"35 枚"不可复现**（2026-10-28 01:5x 现量：把上面两条命令逐个跑过，
窄口径给 26、把 `packages/` 换成全量再连 `e2e/ scripts/` 给 49，两个口径在任何一枚历史提交上都没给过 35）。
所以"35"当时读的是**审阅条目数**（两腿交回的判决条数），不是文件数，而我把它写成了文件数的样子。
留在原处不删，是因为 §6.104/§6.105 那两节是按"35 里抽出 12 条"的口径续写的——
真要改口径得连着那两节一起改，而改成一个命令给不出的数就是造假。
**正确的范围陈述**：以 `b55e98807..HEAD` 的净差为分母；本线逐枚开码审过的判决见 §6.101–§6.105、§6.107、§6.110。

两腿并行审阅（服务端一腿、客户端与宿主层一腿）回来后，**每条我都自己开了码**才写在这里。判"已复核"的标准：判决那一行在 HEAD 的文件里当场读得到，不是我转抄的。

**确认成立的（严重度排序，全部归自动收集线 / 协作线，见下面"为什么不代改"）**

| # | 判决 | 位置 |
|---|---|---|
| 🔴 高·产品 | 新建规则成功后表单不重置：`createRule` 只 `setBusy/setError`，`hostedExtraction` 从初始 `false` 一旦被勾成 `true` 就**留在那格**，同屏再造第二条规则 = 静默沿用"同意服务端读明文"；编辑那条路（`beginEdit`）反倒逐字段回填 | `apps/web/src/features/settings/InboundAutomationSettings.tsx:223`（createRule 收尾）、`:117`（初值）、`:246`（beginEdit 回填）、`:419`（那枚 checkbox） |
| 🔴 高·承诺 | 同意面的无条件句"服务器看不到任务明文"与同批上线的"这一次读明文"档位并存：句子是同意面的常驻回执，档位是规则级 opt-in，两处不是同一次改动写的 | 承诺在 `packages/i18n/src/locales/zh-CN.ts:150`（键 `common.privacy.consent.acceptedGuarantee`）；档位来自 `67c533212`（`git log --oneline b55e98807..HEAD -- packages/i18n/src/locales/zh-CN.ts` 现量两笔） |
| 🟠 中·错误处理 | 抽取失败那一支把行退回 `queued` 时写 `reasonCode: null` —— 而它自己上面那行注释（`:103`）明写"这一行的 `reason_code` 与审计里的 `outcome` 都从这里取"。八枚封闭词表的失败原因最后只活在 `inbound.routes.ts:228` 那行 warn 里，行上与响应里都没有 ⇒ 设备与后台都无法机读"为什么这次退回" | `server/src/automation/hosted-extraction.ts:268`（`if (outcome.state === 'failed')`）与 `:272`（`reasonCode: null`） |
| 🟠 中·重复实现（守卫分叉） | `allowedFields` 的词表校验三份：`rules.ts:61` 与 `:96`、`events.ts:180` 都逐值查 `INBOUND_AUTOMATION_FIELDS`，只有托管那条腿 `inbound.routes.ts:215` 只判 `Array.isArray` 然后整份塞进 `HostedExtractionRule` ⇒ 同一份脏 config，设备腿抛/降，托管腿原样带进抽取 | 复量：`grep -rn "INBOUND_AUTOMATION_FIELDS as readonly" server/src/automation` |
| 🟡 低·回执 | `outcome.state === 'failed'` 时回执硬写 `'queued'`（`:229`），成功/待确认才回真实状态（`:231`）。库里那一行确实是退回 `queued`（`:272` 同批），所以**这一格我判"与库一致"**，不判成缺陷 —— subagent 报的是"库里状态是 leased/prepared"，那一句我没在读到的代码里核实，按未判定处理 | `server/src/automation/inbound.routes.ts:227` |

**我自己复核时搜错的两发（记下来是因为它们本来会变成假发现）**

- 我先按下划线写法 `grep -w model_not_configured …` 读回 0，据此差点写"六枚码全仓零引用"。真写法是**连字符且带 `model-` 前缀**（`model-upstream-rejected`、`model-entitlement-required`，见 `hosted-extraction.ts:106-114` 的类型体）。按真写法逐枚数：八枚里有 `server/src` 一份（就是它自己的定义文件）+ 测试侧仅 `result-conflict`、`model-result-unreadable` 各一枚 —— 所以成立的判决是"**词表被产出、但没落进行、也没被任何消费者读**"，不是"词表不存在/零引用"。
- 上一节那枚 `zh.ts` 同型：文件真名 `zh-CN.ts`。两次都是**搜法看不见**，不是对象不在。

**为什么不代改**：这五条全在自动收集线 / 协作线的**产品语义**上（同意继承、承诺文案、`reason_code` 落库、托管腿的校验口径）。按本仓那条纪律 —— 代改别线代码要"一子可删 + 运行时形状逐字段等于改前 + 一条命令可回退"三条齐 —— 这五条**没有一条**满足：改哪一条都会让用户可见的语义或库里的值变。所以它们进待拍板表（`BLOCKED.md` B238 末"新落到的一格待拍板"那张），**不进"已修"**。

**本线当场做的两件能做的**：① 把每条判决钉到 HEAD 的行（上表）；② 把复量命令写成表外代码块（表格单元里的竖线会毁命令，§6.95 那条同一坑）。

```sh
# 逐条复量（每条独立可读，不依赖上面的表）
sed -n '223,237p' apps/web/src/features/settings/InboundAutomationSettings.tsx   # createRule 收尾：没有任何 set…(默认值)
grep -n "看不到任务明文" packages/i18n/src/locales/zh-CN.ts                        # 那句无条件承诺
sed -n '268,273p' server/src/automation/hosted-extraction.ts                      # 失败支的 reasonCode: null
grep -rn "INBOUND_AUTOMATION_FIELDS as readonly" server/src/automation            # 三份校验、一份漏查词表
```

**这枚例外尺今天已知的射程边界（写清，别让下一位以为它全覆盖）**：第二判只扫未提交里已跟踪的 `.ts/.tsx/.mts`，且只认 `from '…'` / `import '…'` 两种写法 —— 动态 `import('./x')`、`package.json` 里 `node scripts/x.mjs` 那种**命令行式引用**、以及 `.mjs/.js` 的 importer 都不在射程内。判它的断言：把一枚未入库模块改成动态 import 形式，第二判读 0 处 ⇒ 那正是射程外，不是"没问题"。

### 6.102（2026-10-28 00:5x · 第二判上岗十分钟内就自己证明了一次：同一枚未入库的 hook 扩散到 5 枚）

上一节写的"翻案条件"今天没到，但现实自己动了三格，都按现量记：

| 格 | 读数 | 复取 |
|---|---|---|
| §6.99 那枚临时探针 | 🔴→闭合：**作者自己收掉了** —— 文件已不在树上，默认 e2e 配置的收集清单里也读不到它 | `ls e2e/tests/tmp-discard-probe.spec.ts`（No such file）；`cd e2e && npx playwright test --list > /tmp/l 2>&1` 后 `grep -c tmp-discard-probe /tmp/l`（读 0） |
| 跨线依赖 | 从 1 处扩到 **5 处**，五枚 importer 全指向同一枚未入库的 `apps/web/src/lib/form/useDirtyDismissGuard.tsx`（新增的四枚：分类对话框、习惯视图、共享清单两张弹窗/特性页） | `pnpm check:worktree-exceptions`（末段逐枚点名） |
| 未登记栏 | 51 枚未提交里 **0 枚没登记** —— 新落的两条规则各自带"那句指名在哪"当证据 | 同上，第一段逐行计数 |

**这五处同目标说明的事**（不是我推测，是尺读回来的）：UX 线正在把一枚**还没进仓库**的守卫 hook 逐个接进已跟踪的界面文件。接得越多，"按堆提交"这件事越危险 —— 任何一堆先入库都会让 HEAD 引用一个仓库里没有的模块，而红的是下一位。所以这一格的去处不是"我替他们提"，是**让他们那一堆和 hook 同一笔进去**。

**规则表新增两条（都带证据，不写"看着像他们改的"）**：① 自动收集（inbound）线 —— `server/src/automation/`、`packages/inbound-core/`、那份 dual-host-fault integration spec、ADR-0077；理由里点明 §6.101 那四格待拍板正落在这层。② 各线共用的环境陷阱正文 —— `docs/reference/environment-traps.md` 编号只增不改、谁踩坑谁追加，它在脏集里只说明"某一行的正文还没入库"。

⚠️ 一条我没扩的口子：给 `apps/web/src/features/categories/`、`.../habits/` 这类**整目录**登记我没做 —— 目录前缀会把"以后任何人改这个目录"都自动归给 UX 线，那是假归属；所以只登记**现量在飞的那两枚文件**。归属表的价值在"每条都指得出名"，不在"未登记栏好看地读 0"。

### 6.103（2026-10-28 01:0x · 第三判"HEAD 自洽"上线，同时当场抓到并修掉我自己三枚 bug）

**第三判**：`--head --range <ref>` 只读对象库（`git show HEAD:<file>`），分母 = `git diff --name-only <ref>..HEAD` 里那些**现在仍在 HEAD** 的源文件。今天的读数：那批 35 枚源文件，**引用不到 HEAD 落点的 0 处** ⇒ 自那次发布以来别人提交的每一笔都不是半棵树。

```sh
node scripts/check-worktree-exceptions.mjs --head --range b55e98807      # 读 0 处
node scripts/check-worktree-exceptions.mjs --head --range HEAD~80        # 控制臂：换个更宽的分母，仍读 0
node scripts/check-worktree-exceptions.mjs --head                        # 不带 range ⇒ rc=1 并说明为什么
```

**我试过后撤掉的那一档**：不带 range 扫整棵 HEAD。分母 1721 枚带相对引用的源文件，第一发判不中 381 处、修掉注释与断言字符串后仍 286 处。剩下两类噪声（指向 `packages/*/dist/*` 这种**构建产物**的引用、以及非语句式的 import 写法）要真正的解析器才分得清。本仓那条元规则就在这儿：**一枚天生红的尺比没有尺更糟**，所以这一档不进代码，只进报错文字。

**三枚自家 bug（都属于"空读数先归因搜法"）**

| bug | 症状 | 修法与那枚臂 |
|---|---|---|
| 扩展名判错 | `extname('server/src/account/account-profile.store')` 读回 `.store` ⇒ 候选一个都不补，**已入库的模块被报成"HEAD 里没有"**；第三判第一发那 5 处全是这一类假红 | 改成"结尾是不是已知模块扩展名"；⑱ 臂拿 `account-profile.store` 这类带点文件名钉住 |
| 路径被转义 | `git status --porcelain` 默认把非 ASCII 路径写成 `"…\344\271\240…"`，那种字符串跟任何前缀都拼不上 ⇒ 中文名证据件**整批**读成"没登记过"（未登记一栏从 26 涨到 44 全是它） | 取数改 `-c core.quotepath=off`；判据：`git -c core.quotepath=off status --porcelain` 里不该再出现反斜杠转义 |
| 按目录穷举 | 脏集几分钟从 51 涨到 98，其中 45 枚是**被截图类门禁重写的已入库 PNG** —— 逐目录登记永远在追 | 改成按机制登记：`apps/web/evidence/` 下的修改归"门禁产物回执"，但 `skipUntracked` ⇒ 新出现的取证文件仍被点名（⑲ 臂就是这一条的牙） |

**抽引用那一档也收紧了**：只认语句式的 `import … from './x';` / `export … from './x';` / `import './x';`，注释行先丢、行尾注释仍要吃到（⑯⑰ 两臂）。这修的是"散文里的 import 字样被读成依赖"那一类假红。

**今天的现实读数**（别抄，现量）：未提交 98 枚、未登记 **2** 枚。这两格我**没有**替它们编归属，因为拿不出"那句指名"：`e2e/tests/habit-create-options.spec.ts`（习惯线在飞的用例）、`?? e2e/tests/danger-confirm-trash.spec.ts`（新增的危险确认用例，作者还没落）。

```sh
node scripts/check-worktree-exceptions.mjs --self-test | tail -1     # 臂数 19
node scripts/check-worktree-exceptions.mjs | sed -n '/没登记过/,$p'   # 逐枚点名
```

### 6.104（2026-10-28 01:0x · 上一节没开码的断言逐条补验：六格成立，两格判成"不是缺陷"，一格拒收）

§6.101 那五格是抽出来的，两腿审阅还留着一批我**没自己开码**的断言。留着不当结论是不够的，所以逐条重读：

**成立（六格，都归自动收集线 / 协作线）**

| # | 判决（现量） | 位置 |
|---|---|---|
| ① | 同一份规则 config 在 create 与 saveEdit 里**手抄两遍**，`Math.max(1, Math.min(50, …))` 那一行在两处逐字符相同 ⇒ 任何夹取规则改动都要记得改两次 | `apps/web/src/features/settings/InboundAutomationSettings.tsx:231` 与 `:258` |
| ② | 两条保存路径的 catch **不绑 error**：`catch { setError(t('web.ai.inbound.error.save')) }` —— 服务端明写的 `code`（含 402 的付费门槛）在界面层被丢成同一句"没接受这次改动" | 同文件 `:235`、`:263` |
| ③ | 那个 402 错误类**在任何壳层都没有消费者**：`AutomationEntitlementRequiredError` 逐枚数（剔 `dist` 产物）命中只在 `packages/app-host` 的 src 与 tests，`apps/**` 读 **0** ⇒ 抛得出来、没人分得清 | `grep -rn "AutomationEntitlementRequiredError" --include='*.ts' --include='*.tsx' apps packages`（剔产物后 apps 侧 0） |
| ④ | 读面自己写的红线没被执行：`:55-58` 注释是"认不出这个字段就**不渲染这一格**，而不是当 false 猜"，而 `list()` 的写法是 `!body.rules.every(valid) ⇒ throw transport` —— 一条坏规则拖垮整张列表，且把契约不合报成"网络故障" | `packages/app-host/src/inbound-rules-remote.ts:181`（对照 `:55`） |
| ⑤ | 队列上限只数**还没抽的**行（`AND payload_ciphertext IS NOT NULL`），而抽取成功那一刻就把该列置 NULL（`hosted-extraction.ts:280`）⇒ 这条腿越成功，被计入 1000 条 / 64MB 分母的行越少 | `server/src/automation/inbound.routes.ts:182` |
| ⑥ | 结果体积上限只在一腿有：设备腿 `events.ts:295` 卡 `resultCiphertext.length > 1_000_000`，托管腿那一档 `hosted-extraction.ts` 里 `1_000_000` 读 **0** 次 ⇒ 托管写进 `result_ciphertext` 的东西没有同一道闸 | `grep -c "1_000_000" server/src/automation/hosted-extraction.ts` |

**判成"不是缺陷"的一格（如实记，别混进清单）**：`inbound.routes.ts:229` 失败时回执硬写 `'queued'`。库里那一行同批确实被改回 `queued`（`hosted-extraction.ts:272`），**回执与库一致**；审阅那条说"真实状态是 leased/prepared"，那一句我在读到的代码里没核实 ⇒ 判未成立。

**拒收的一格**：同意面"四行条款各写一遍"——我原话抄了审阅的措辞，开码后形状不是那样。现量：唯一真源 `SHARE_CONSENT_SCOPE_KEYS` 在 `packages/ui/src/sync/share-consent-model.ts:74`，共享原语 `ShareConsentModal.tsx` 引用它 4 次（正确用法）；但**四枚宿主文件各自手抄同一串 key、零次引用那枚常量**（`ShareSpaceScreen` / `JoinShareScreen` / `ShareFeature` / `JoinSharedListDialog`，逐枚 `grep -c "consent.scope.e2ee"` 读 1、`SHARE_CONSENT_SCOPE_KEYS` 读 0）。所以成立的判决是"**宿主绕过了唯一真源**"（AGENTS §3.5 那一档），不是"条款文案被抄了四遍"。

**为什么这一格我没顺手加一把尺**：条款清单的顺序现在有四处在宿主层各写各的，此时把"宿主不许自己列 `consent.scope.*`"做成门禁 ⇒ **它生下来就是红的**，本仓那条元规则（一枚天生红的尺比没有尺更糟）直接否掉。正确顺序是先让那四处改走常量、再上尺；那是协作线的代码与口径，代改不满足"三条齐"。要做也可以非红地做：按**棘轮**登记现量 4 为上限、只许减（仓里已有 `check-ratchet-ceilings` 那一族机制），但那是**判据口径**，得他们或你点头。

```sh
# 上面六格 + 那一格拒收的复量（整条可复制，全都不带竖线）
grep -n "Math.min(50" apps/web/src/features/settings/InboundAutomationSettings.tsx
sed -n '232,236p;260,266p' apps/web/src/features/settings/InboundAutomationSettings.tsx
grep -rn "AutomationEntitlementRequiredError" --include='*.ts' --include='*.tsx' apps packages
sed -n '53,59p;176,184p' packages/app-host/src/inbound-rules-remote.ts
grep -n "payload_ciphertext IS NOT NULL" server/src/automation/inbound.routes.ts
grep -c "1_000_000" server/src/automation/hosted-extraction.ts
grep -rn "SHARE_CONSENT_SCOPE_KEYS" --include='*.ts' --include='*.tsx' apps packages
```

### 6.105（2026-10-28 01:1x · 把"没复核就不作为结论"那几格也跑完：三格有读数、一格保持未判定）

上一节末尾我留了一句"剩下的没自己开码，不当结论"。这一节把那一摞清空，逐格给现量：

| 那格 | 复核读数 | 去处 |
|---|---|---|
| `data-testid="inbound-hosted-notice"` 零消费者 | 逐字面枚文件搜（`apps packages e2e server scripts`，剔 `dist`）命中 **1 处 = 它自己**（`InboundAutomationSettings.tsx:424`） | 低·待拍板：这枚锚点是留给将来的用例、还是白挂的，只有自动收集线能判；我不替他们删（别人资产） |
| `ShareFeature.tsx` 那枚 2 秒 `setTimeout` 没配 `clearTimeout` | 现量在 `:443`，全文件 `clearTimeout` 读 0；**但 `git merge-base --is-ancestor` 判它来自 `a923f7fa2`（10-10），早于线上那笔** | 判"**非本批引入**"，不进这轮清单（不冒充成本轮改动的缺陷，也不顺手修别人历史里的一格） |
| `collab-journey` 同一枚证据图连截两次 | `e2e/tests/collab-journey.spec.ts:256` 与 `:257` 传的是同一个文件名 ⇒ 后一次覆盖前一次，产物只有一枚 | 低·待拍板：归协作线（删哪一发、要不要留两帧是他们的取证口径）；我不动那枚 spec |
| `ShareConsentModal` 的 `aria-controls`/`nativeID` 是否悬空引用 | **没验**：判它要一次真渲染（web 端读那个元素 id 是否等于触发件的 `aria-describedby` 值），不是一条 grep | 保持"未判定 + 判它的断言"，既不写进缺陷也不写进"没问题" |

```sh
grep -rn "inbound-hosted-notice" --include='*.ts' --include='*.tsx' --include='*.mjs' apps packages e2e server scripts
grep -n "setTimeout\|clearTimeout" apps/web/src/features/share/ShareFeature.tsx
git merge-base --is-ancestor a923f7fa2 b55e98807; echo $?   # 退 0 = 那枚早于线上那笔
sed -n '254,258p' e2e/tests/collab-journey.spec.ts
```

**这一节为什么值得单开**：审阅的两腿交回 12 条，我最后写进清单的是 **8 条**（§6.101 五格 + §6.104 三格新成立），另有 **2 条判成不是缺陷**、**1 条拒收（措辞与实物不符）**、**1 条保持未判定**。这个"逐条定性并把排除项也写出来"的动作才是审阅的全部交付 —— 只报成立的那几条，等于拿别人的射程当我的结论。

### 6.106（2026-10-28 01:1x · 把"推不推那一拍"的输入量齐：落地页那半边已对齐，SPA 那半边的可见变化只有一族文案）

发布是对外动作，所以我先把**决策输入**取全（全程只读，没动线上任何一件文件）：

| 那一半 | 现量 | 读数含义 |
|---|---|---|
| 落地页 / 帮助页 | `node scripts/live-web-freshness.mjs --landing` ⇒ 分母是 HEAD 里全部已入库 HTML，**不齐 0**（另有 1 枚线上 404 的 `/pitch/`，那是 §6.97 登记过的"从未接上的目的地"，不是"线上旧"） | 目标第 4 件里"线上落地页与 HEAD 逐字节对得上"这一半**今天是成立的** |
| 网页应用那盘 SPA | `node scripts/live-web-freshness.mjs` ⇒ 不在场的都是**中文文案针脚**，逐枚点名：同意面那四行条款（`common.share.consent.scope.*`）与"抽取归谁"那一档五句（`web.ai.inbound.hosted.*` / `…boundary.foregroundOnly`） | 重新发布带来的**全部可见变化就是这两族文案**：登录与凭据面不受影响（同一条尺里它们都在场），没有夹带别的界面改动 |

**这条判据为什么敢说"只有一族文案"**：那把尺的分母是 HEAD 里全部被界面读取的中文针脚（`collectNeedles`），它逐枚报"在不在场"，而不是我挑几句去搜。要出现"夹带的别的改动"，必须先在这份清单里点名。

**顺带把 UX 线那批 P2 文件的依赖面量清了**（这决定我能不能说"他们那一堆是自洽的"）：
`purgeDanger.ts` 从 `@heyta/domain` 取的 `resolveDangerTier` / `requiresModalCommitment` **HEAD 里已有**（`packages/domain/src/danger-tier.ts`），所以那一堆缺的只有自己那枚新 hook `apps/web/src/lib/dialog/useModalFocusIsolation.ts`。归属按它们**自己头注释里写的那句**「2026-10-27，全局 UX 整改 P2」登记进例外尺，不是我按目录猜的 —— 登记后未登记栏只剩 `e2e/tests/habit-create-options.spec.ts` 一枚（它没有任何自名，我不替它编归属）。

```sh
node scripts/live-web-freshness.mjs --landing            # 落地页逐字节对账
node scripts/live-web-freshness.mjs                      # 线上那盘 SPA 相对 HEAD 缺哪些针脚
git ls-tree -r --name-only HEAD | grep -i danger-tier     # 那条域层依赖确实在 HEAD
node scripts/check-worktree-exceptions.mjs | sed -n '/没登记过/,$p'
```








### 6.107（2026-10-28 01:2x · 门禁与尺那一层审完：抓到 gate-wiring 自己吞旗标并补 9 臂，顺手记下"臂没人跑"那张债表）

§6.101–§6.105 审的是产品与实现层（分母见 §6.101 那节末尾的更正——那里"35"是判决条数不是文件数）。**唯一没开码的一层是这轮落进 HEAD 的门禁与尺**。分母现量：

```sh
git diff --name-only b55e98807..HEAD -- scripts/ package.json
```

#### 成立并已修的 1 格：`scripts/check-gate-wiring.mjs` 把不认的旗标**静默走过去**

它的 argv 循环原先只处理 `--pkg` / `--root`，落到 `else` 的分支根本不存在。后果不是"少个功能"，是**一枚假读数**：
我这趟照本仓惯例敲 `node scripts/check-gate-wiring.mjs --self-test`，拿到 **rc=0 + 一行普通判决**，
读起来完全像"自检过了"——而它当时**压根没有自检**。这枚尺的职责恰恰是"检查别的门禁有没有被接上"，
它自己吞旗标，等于把"没人验过它"伪装成"验过了"（AGENTS §7 元规则 2 的正面案）。

补的东西（`scripts/check-gate-wiring.mjs:62-91` 参数闸门、`:505` 起 `runSelfTest()`）：

| 臂 | 钉住的那条形状 | 现量 |
|---|---|---|
| Ⓐ | 阳性对照：注入树与链原样时必须**绿** | ✅ 红条数 0、rc=0 |
| Ⓑ | 定义在、链段被摘 ⇒ 判据 1 红 | ✅ 独红 1 条 |
| Ⓒ | 链段在、定义被摘 ⇒ 判据 3 红 | ✅（同趟还捎带点亮孤儿判据，见下） |
| Ⓓ | 链段与定义**一起**消失 ⇒ 只有锚点看得见（10-04 那次整文件覆盖 rc=0 那一形） | ✅ 独红"链里少了锚点" |
| Ⓔ | 载体里那行改成**仍含命令文本的散文** ⇒ 必须红 | ✅ 独红 1 条 |
| Ⓕ | 那行整行删掉 ⇒ 必须红 | ✅ 独红 1 条 |
| Ⓖ | 树上实现还在、定义与链段都没了 ⇒ 孤儿判据点名它 | ✅ 独红 1 条 |
| Ⓗ/Ⓘ | 不认的旗标 / `--pkg` 不带值 ⇒ 拒 | ✅ rc=1 且文案点名 |

**Ⓔ 是这一节真正想买的东西**：它复现的正是本文件头部记载的那次事故（runbook 里多了一句"这里少了 …"而门禁绿）。
我把注入下沉成一枚仓内台架（`research/tools/mutate-gate-wiring-arms.mjs`：载体清单从尺自己的表里取，不写死文件名），
逐枚读回**红条数**而不只是 rc —— 只判 rc 挡不住"红是因为另一条判据"那一形：

```sh
node research/tools/mutate-gate-wiring-arms.mjs   # Ⓐ 红条数必须 0；Ⓑ–Ⓖ 每臂点名它是哪条判据红的
```

`Ⓒ` 那次是 **2 条**：删 `check:gate-ssh` 的定义既让判据 3 红，又顺手把 `scripts/check-gate-ssh.mjs` 变成孤儿。
两条都该红，但**这一臂不是单判据**，登记成单判据就是我在替读数夸大精度。

**臂从此有人跑**：定义改成 `node scripts/check-gate-wiring.mjs --self-test && node scripts/check-gate-wiring.mjs`
（现量 `pnpm -s check:gate-wiring` ⇒ rc=0，9 臂 + 普通判决；自检一趟 0.33s，链上成本可忽略）。

#### 我自己在这节里造的三枚假读数（都要留在原处，不许悄悄改掉）

1. **第一版债表探针是瞎的**：`research/tools/audit-gate-selftest-consumers.mjs` 我按 `"--self-test"`（双引号）匹配，
   而脚本里一律写 `argv.includes('--self-test')` ⇒ **总数 0、rc=0**。它与我同一趟刚拿到的"链上二十多枚定义带
   `--self-test`"直接冲突，才被抓住。修法是把谓词换成单/双引号都收（反引号仍不算：散文里的 `--self-test` 是叙述不是分支），
   并加一条**视力臂**——已知在场的 `check-scripts-parse.mjs` 必须既"有臂"又"被定义跑着"，否则整张表拒答、退 2
   （rc=2 = "我没干活"，与 rc=1 = "判了且不合格"分档）。
2. **`grep -c` 报 0 就退 1，把我 `&&` 串后面的 `pnpm check:gate-wiring` 挡掉了**：那次输出的 `rc=1`
   不是门禁的读数，是我的探针没跑。同一趟第二次犯（§6.103 那节刚写过一条同族）。
3. **plumbing 用 `.trim()` 取母本，吃掉了 `package.json` 的行尾换行**：`9087f8e9e` 的 numstat 因此是 `2/2`
   而不是 `1/1`，多出来的那一行就是 `-}` / `+}`（`\ No newline at end of file`）。
   已用 `28b9806aa` 单独补回（**不 amend**，按本仓规矩新写一笔）。
   通用形状：plumbing 里凡是"取 blob 原文再改一处"的，**不许过任何去空白的手**（`.trim()`、`String.prototype.replace` 前的模板字符串都算）。

#### 跨线的一格：43 枚尺里 23 枚有臂但没人跑臂（**不归我修，进待拍板表**）

`node research/tools/audit-gate-selftest-consumers.mjs` 现量：有臂 43 枚、定义里跑臂 19 枚、有定义不跑臂 23 枚、
无定义 1 枚（`check-imports-resolve.mjs`，它已在 `ALLOWED_UNREFERENCED_IMPL` 里登记并有载体，本探针不重复判）。

臂不跑不等于臂没用，**等于臂会烂**：判据改了、夹具没跟着改，没有任何东西会红。
我没有一次性把 23 枚的臂都接进定义，理由是**成本与归属都不在我这格**：`pnpm check` 的分母正被并行会话计数
（同一形见 `check:android-build-host` 那枚不进链的理由），且每一枚要不要跑臂是那条线的口径决定。
探针因此**不因"有人没跑臂"退非零**，只出一张债表；翻案条件：任何一条线把自己的臂接进定义后，
重跑该探针的"有定义不跑臂"那一行应当少一枚。

```sh
node research/tools/audit-gate-selftest-consumers.mjs        # 债表（视力臂不成立则 rc=2）
node scripts/check-gate-wiring.mjs --self-test               # 本线那 9 臂
git show --numstat --format= 28b9806aa                      # 行尾换行那一笔的实形
```
### 6.108（2026-10-28 01:3x · 顺手量"跑臂的定义是否真被脚本认"：假红一枚是我自己造的，外加一枚会顶掉我刚落的 209 行的索引 hazard）

§6.107 修完 gate-wiring 之后，顺着同一条线问一句反向的问题：**定义里写了 `--self-test`，
那枚脚本真的认这个旗标吗？**不认就是"声称验过而什么都没验"——与刚修掉的那格同一族。

```sh
node -e 'const fs=require("fs"),p=require("path");const pkg=JSON.parse(fs.readFileSync("package.json","utf8"));
const A=/[\x27"]--self-test[\x27"]/u;let ok=0,bad=[];
for(const [k,v] of Object.entries(pkg.scripts)){if(typeof v!=="string"||!v.includes("--self-test"))continue;
for(const rel of new Set([...v.matchAll(/(?:^|[\s;&(])(?:node|bash|sh)\s+([\w.\/-]+\.(?:mjs|cjs|js|sh))(?=$|[\s;&)])/g)].map(m=>m[1].replace(/^.\//,"")))){
if(!fs.existsSync(p.resolve(rel))){bad.push(k+" → "+rel+"（文件不在）");continue;}
if(A.test(fs.readFileSync(rel,"utf8")))ok++;else bad.push(k+" → "+rel);}}
console.log("认这个旗标 "+ok+" ｜ 不认或不在 "+bad.length);bad.forEach(b=>console.log("   "+b));'
```

读数：**26 认 + 1 枚被我误报**。那 1 枚是 `check:apk-freshness → scripts/lib/apk-freshness.sh`，
现开码：它 `:477` 写的是 bash `case --self-test) …`，**不带引号** ⇒ 我的谓词按 JS 那一族的写法下，
在 shell 的写法上结构性失明。真数是**全部 27 枚都认**。
（这是本节第三次"尺自己瞎"，与前两次的形状各不相同：双引号漏单引号、`grep -c` 的退出码、
这一枚是**跨栈的写法差异**。通用的一句：**按名字/写法搜代码之前，先问这个标识符在被测语言里怎么拼**。）

⚠️ 因此也**没有**把"定义跑臂而脚本不认旗标"做成 gate-wiring 的新判据：一把需要同时覆盖
JS 引号形与 shell `case` 形、且我只有 27 个样本的谓词，今天写出来就是一枚可能天生红或天生瞎的门禁
（AGENTS §7 元规则 2）。要做得连着两栈的谓词与各自的臂一起做。

**另一格更要紧，且不归我修**：这棵共享检出的**索引**里压着并行会话在 17:2x 之前 `git add` 的两枚**旧内容**：

```sh
git diff --cached --numstat
```

现量 `scripts/check-gate-wiring.mjs` 是 `6 增 / 209 删`、`package.json` 是 `1/1` ——
也就是**索引里那份是 gate-wiring 被我改之前的版本**。他一旦跑一次不带 pathspec 的
`git commit`，我刚落的 209 行自检与那枚 def 就在 HEAD 里被顶回去；
而**最坏的是它顶回去之后不会有任何东西红**：旧版正好把 `--self-test` 当不认的旗标走过去。
我不替他 unstage（只对自己创建的对象动手），这格登记给那一号线：
**提交前重新 `git add scripts/check-gate-wiring.mjs package.json` 一次，或改用 `git commit -- <路径>`。**
### 6.109（2026-10-28 01:3x · 例外归属尺补上"索引旧内容"那一档：它原先把 `MM` 当成未登记的例外，那是假例外）

§6.108 记下那枚索引 hazard 之后，归属尺的未登记栏从 1 枚涨到 7 枚。逐枚读了它们自己的 diff，两种成因要分开：

- **6 枚是并行 UX 线新写的在飞件**：`deviceRevocationDanger.ts` 文件头第一行就写「2026-10-27，全局 UX 整改 P2 第二格」，
  被 `VaultSettingsPanel.tsx:3` 引、`app.css:33` 把 `./app/danger-confirm.css` 带进来、
  `e2e/tests/vault-settings.spec.ts` 与 `apps/web/evidence/danger-confirm/` 是同批的界面腿取证。
  ⇒ 归属有原文，加进那一行的成员表（不是我猜的）。
- **1 枚根本不是"未提交的改动"**：`scripts/check-gate-wiring.mjs` 显示 `MM`，而
  `git diff HEAD --numstat -- scripts/check-gate-wiring.mjs` 是**空**的 —— 工作树对 HEAD 干净，
  脏的只是索引里那一枚旧 blob（§6.108 那格）。

第二枚不该靠"再登记一条路径规则"洗掉（那正是本尺最反对的：按名字补黑名单永远补不完），
所以改的是**机制**：`classify()` 现在多收一枚"工作树相对 HEAD 真改了哪些路径"的集合
（`git diff HEAD --name-only -z`，NUL 分隔 ⇒ 路径里的空格与中文都不会被引号骗），
不在其中且非 `??` 的路径一律进 `indexOnly` 一档，**不进未登记栏**、`--strict` 也不为它红。

三枚新臂钉住这一档不许变成洗白口：

```sh
node scripts/check-worktree-exceptions.mjs --self-test
```

| 臂 | 判的形状 |
|---|---|
| ⑳ | `MM` 且工作树干净 ⇒ 未登记栏必须读 0（这才叫"分类"而不是"报错"） |
| ⑳b | 同一枚路径若工作树**确实**改了 ⇒ 仍回到未登记栏（这一档不许顺手洗白真改动） |
| ⑳c | `??` 不在 `diff HEAD` 里是常态 ⇒ 未跟踪件一律不许被这一档吃掉 |

这一节的**枚数不写在这里**（脏集在并行检出上是分钟级在换的东西，写下来当天就漂）：
要读数就跑 `node scripts/check-worktree-exceptions.mjs`，三档各自的含义就是上面那些 ——
未登记栏只报真没人认领的路径、索引旧内容那档自己打印正解、跨线依赖逐枚点名 importer 与被引的没入库模块。
臂数由 `--self-test` 那行打印。
### 6.110（2026-10-28 01:5x · 把审阅分母的洞补掉：同意面 12 条逐条开码复核，服务端那 8 枚我自己读）

触发是上一节那条命令给不出它自己标题里的数。重算之后：窄口径 26 枚里**有 17 枚从未在任何一节被点过名**，
其中同意面/共享那一族是产品语义最重的，所以补审。

**派出去的一条腿两次没跑起来**（服务端 8 枚，模型服务连续拒绝，不是我没派）。所以我自己开码读它，只报我读到的：

- **库形状（③）**：这轮唯一的新迁移是 `server/prisma/migrations/20261027000000_add_hosted_inbound_extraction/migration.sql`，
  体是 `ALTER TABLE "automation_rules" ADD COLUMN IF NOT EXISTS "hosted_extraction" BOOLEAN;` ——
  可空、无 DEFAULT、无索引、无 `CREATE INDEX`，所以不涉及 CONCURRENTLY 与锁表那两道纪律。
  它注释里那句"没有任何查询以它为谓词"**是真的**：现量 0 处。
- **端到端加密的承诺（⑤）**：自动化路径里搜不到把正文/主题写进日志的形状；
  抽取成功那一支反过来把 `payload_ciphertext` 抹成 `NULL`（`hosted-extraction.ts:19` 那张表与 `:239` 的守卫注释）。
  全仓唯一出现 `Logger.info({ body })` 这个形状的地方是 `server/src/ai/managed-proxy.routes.ts:50`，
  而它是一句**警告注释**（讲那道拦不住这种写法），不是代码。

**同意面那条腿交回 12 条，我逐条开码复核。成立的：**

🔴 **成立·最重的一条（本来就在那儿，不是这轮引入）**：**web 的 owner 侧同意闸从未接线。**
`apps/web/src/features/share/ShareFeature.tsx:199-201` 的初始相位是
`initialShareId === undefined ? { kind: 'consent' } : …` —— **无条件**进同意相位；
`shouldShowConsent` 与 `applyShareConsent` 在这个文件里只出现在 import 名单（`:41`、`:42`），零次调用。
对照：移动 owner 侧 `apps/mobile/src/screens/ShareSpaceScreen.tsx:519` 读它，web 入群侧
`JoinSharedListDialog.tsx:145` 也读它。模态自己会写记录（`ShareConsentModal.tsx:111` 的 `decide` 走
`applyShareConsent`），所以**勾了「不再提示」会被存下来，但那一屏永远不读它** ⇒ 那个复选框在 web owner 路径上是装饰，
而 `packages/ui/src/sync/share-consent-model.ts:9-11` 明写的红线正是"否则它就是装饰"。
**并且没有任何用例钉着这一侧**：`apps/web/tests/share-join-consent-gate.spec.tsx` 从名字到渲染体只覆盖 join 侧（`:7`、`:41`、`:62`）
⇒ 我要是把这条做成门禁，它**生下来就是红的**（AGENTS §7 元规则 2），所以只登记判决 + 那条该写的断言，不装门。

复核（四条都能直接跑）：

```sh
grep -cw shouldShowConsent apps/web/src/features/share/ShareFeature.tsx      # 读 1 = 只有 import 那一行
grep -n shouldShowConsent apps/mobile/src/screens/ShareSpaceScreen.tsx       # 对照：真调用在 519
git show b55e98807:apps/web/src/features/share/ShareFeature.tsx | grep -n 'useState<Phase>' -A2
grep -rln shouldShowConsent apps/web/tests e2e/tests apps/mobile/tests packages/ui/tests
```

🟠 **条款清单的"唯一真源"现在管不住宿主**：常量 `SHARE_CONSENT_SCOPE_KEYS` 在，`ShareConsentModal` 正确用它，
但手抄同一串 key 的地方是 **4 枚宿主 + 本轮新增的 1 枚移动测试里的字面量数组**，宿主侧唯一引常量的是一枚 theme 测试。
**结构通道**（现在不红、将来必静默）：modal 按**下标**取宿主的 `labels.details[index]`，取不到就 `return null`
（`ShareConsentModal.tsx:194-196`）⇒ 往常量加第 5 条条款时，新条款在四个屏上**同时静默消失**，
而两壳的测试各自只比它自己那份手抄 ⇒ 没有一把尺会红。条款内容**目前没有分叉**（同一笔提交把常量与四份手抄一起从 3 键改 4 键）。

🟠 同一块约 14 行的 `consentLabels` 构造在四枚宿主**逐字写了四遍**（AGENTS §3.5 那档：这段在决定"展示哪些条款"，属业务语义）。
🟠 web 同意**落盘失败没有回执**：`saveShareConsent` 签名是 `void`、调用点无 try（`JoinSharedListDialog.tsx:352-355`、
`ShareFeature.tsx:557-560`），移动同场景有具名回执（`ShareSpaceScreen.tsx:777-778`）⇒ 同意面两壳不对称。
🟠 移动共享面板：每发同步把 `dataRevision` +1 都重建 admin ⇒ 那条链（两个 GET + Keychain 读 + 重封 + 签名补发）整条重跑
（`ShareSpaceScreen.tsx:174-193`，文件头自己写着"现取现用"；本轮该文件的 diff 只有 12 行标签，这形状是原有的）。

🟡 记下来但判低的四条：`finalize` 的 catch 只认 403/404、其余畸形信封与"对方还没发"在用户眼里是同一句话；
一条坏规则把列表整张报成 `transport`（契约错说成网络错）；保存失败把 402/契约/传输折成同一句；
`ShareFeature.tsx:487` 在渲染体内读 localStorage、`:443` 的 2000ms 定时器不随卸载清。

**我自己这轮又造了一次假读数（第三次，形状不同）**：为了核"有没有查询把这枚新列当谓词"，我写了
`grep -rn 'hostedExtraction' server/src | grep -iE 'where|findMany|findFirst'`，**在此之前**那一发我写的是
`grep -E 'where|filter|:'` —— 那个 `:` 匹配了**每一行**（每条 `file:line:` 都带冒号）⇒ 它是一枚恒真的过滤器，
"11"是它数出来的噪声，不是命中数。重下谓词后真数是 0。
通用形状：**复核命令里凡是"或"列，每一项都要能单独把整条读数判红**；混进一项恒真的，整条读数就只是长度。

**为什么不代改**：`git status --porcelain -- apps/web/src/features/share/` 现量两枚 `M`（协作线正在写这两只壳），
且这条 🔴 改的是**同意语义**（哪一屏免弹），不满足"一子可删 + 运行时形状逐字段等于改前 + 一条命令可回退"三条齐。
⇒ 全部进 `BLOCKED.md` 的待拍板表，不进"已修"。

### 6.111（2026-10-28 04:1x–04:5x · 「第三版索引」这一类雷是**我自己那套 plumbing 造的**：三枚全拆、尺补一栏、台架六种注入全咬住）

**起因不是找雷，是收「未登记的例外」。** 例外归属尺当时报 `⚠️ 索引旧内容 1 枚 ｜ MM scripts/check-gate-wiring.mjs`。
那枚文件的工作树**对 HEAD 是干净的**，脏的只有索引那一格，而且索引那版跟 HEAD、工作树**都不相同**：

```sh
# 🔴 这三枚雷当晚就被我拆了，所以现在照跑会读回"三版一致"（索引 == HEAD == 工作树）——
# 留在这里的是**取法**，不是当时的数值；当时那三枚的哈希只在本节正文里。
git rev-parse :scripts/check-gate-wiring.mjs HEAD:scripts/check-gate-wiring.mjs
git hash-object scripts/check-gate-wiring.mjs
git log --all --format='%h %s' --find-object=8047483d3c36edd85845ca646756047b4e9852a7
```

`--find-object` 读回来两笔：`2ab9efb45` 引入、`9087f8e9e` 替换掉。也就是说**索引停在「我提交之前那一版」**，
而那一版里 `--self-test` 出现 0 次、HEAD 那版出现 6 次。

**机制（这才是重点，不是某枚文件的事故）**：plumbing 提交那条路 ——
`hash-object -w --stdin` → 私有 `GIT_INDEX_FILE` → `read-tree` → `update-index --cacheinfo` → `write-tree` →
`commit-tree` → `update-ref <new> <OLD>` —— **从头到尾不写共享索引**。所以每用一次它提一枚文件，
共享索引里那一格就留在提交前的内容，变成一个「既不是 HEAD、也不是工作树」的**第三版**。
不带 pathspec 的 `git commit` 走的正是索引 ⇒ 谁随手提一次，就把那一格写回历史。今晚实际造出三枚。

**最狠的一枚是 `package.json:208`。** 三版逐行对出来只有这一行差：

```sh
git cat-file -p :package.json > /tmp/pkg.idx; git show HEAD:package.json > /tmp/pkg.head; diff /tmp/pkg.head /tmp/pkg.idx
```

索引那版是 `"check:gate-wiring": "node scripts/check-gate-wiring.mjs",` —— **不带 `--self-test`**。
谁不带 pathspec 提一次 `package.json`，我这格自检就静默消失，而 build / typecheck / 单测都不会告诉你
（这条和 §6.107 那句「门禁定义了≠门禁跑了」是同一族，只是这次的偷法在索引里）。

**§6.109 那一档为什么没拦住它 —— 不是翻案，是补。** 那一档的判据是「工作树对 HEAD 干净」，
而 `package.json` 的工作树对 HEAD **也脏**（UX 线往里加了两行 `check:undo-receipt`）⇒ 它不进那一档，
只在未登记栏露了一下就被归属表吃掉。所以判据从「路径 + 一种形状」换成**三版之间的关系**：

    索引 ≠ HEAD 且（工作树里没这枚文件 或 索引 ≠ 工作树） ⇒ 命中

`MM` / `AM` / `AD` 三种失法各配一枚臂（㉑–㉗），另加两枚解析器臂（㉘㉙）与一枚配对器臂（㉚）——
解析器一坏分母就空、**空就等于假绿**，所以分母本身也得有牙；main 里还有一枚视力臂：
有脏件却取到 0 条索引 ⇒ `rc=2`（"我今天没干活"），不许它说"没有雷"。

```sh
node scripts/check-worktree-exceptions.mjs --self-test        # 臂数与不符数由尺自己打印
node research/tools/mutate-worktree-third-version.mjs          # 六种注入形状，打空数必须 0
```

**三种拆法与各自的前后读数**（都只动那一格，不碰别人的暂存）：

| 那一格 | 索引那版是什么 | 拆法 | 为什么是这个方向 |
|---|---|---|---|
| `scripts/check-gate-wiring.mjs` | 我提交前的旧版 | `git update-index --cacheinfo 100644,<HEAD blob>,<路径>` | 工作树 == HEAD，索引归位到 HEAD 就是三版一致 |
| `BLOCKED.md` | 我上一笔 plumbing 前的版本 | 同上（设成 HEAD 版） | 🔴 **不能设成工作树版**：工作树那版含别的会话 79 行未提交内容，设过去等于替他们 stage |
| `package.json` | 同上 | 同上 | 工作树那版含 UX 线未提交的两行，同理 |

**新落的纪律（下次不再造雷）**：**单归属文件优先 `git commit -o -F <消息文件> -- <路径>`**。
pathspec 提交自己会把索引那一格刷成新提交的内容 —— 今晚 `0ac67ffda`、`4e1555cd6` 两笔之后
`git -c core.quotepath=off status --porcelain -- <路径>` 都读回空。
plumbing 只在「这枚文件里含别人的行」时才有理由用，且**用完必须立刻刷那一格**（就是上面那三种拆法）。

**顺手记两条我自己的假读数**（都是「先怀疑探针」的现量样本）：

1. 我先用 `grep -c 'check:gate-wiring.mjs --self-test'` 探 HEAD，读回 **0**，差点写成「我那行没进 HEAD」。
   链里的**定义名**是冒号（`check:gate-wiring`），**脚本路径**是连字符（`check-gate-wiring.mjs`），
   我把两种写法拼成一枚不存在于任何文本里的串 ⇒ 恒不命中。重下谓词 `grep -c 'gate-wiring\.mjs --self-test'`
   读回 HEAD=1、工作树=1、索引=0 —— 这才和上面的机制对上。
2. `git rev-list --left-right --count origin/main...HEAD` 报 `0 14`，看着像"有 14 笔没推"。
   而 `git ls-remote origin refs/heads/main` 与本地 HEAD 逐字符相同。原因：`main` 的**上游是 `gitee/main`**，
   我用显式 refspec 推 GitHub ⇒ 本地那枚 `refs/remotes/origin/main` 不会自己跟着动。
   复验只认 `ls-remote`；把追踪 ref 刷成真相是一条：
   `git fetch origin refs/heads/main:refs/remotes/origin/main`（刷完 `0 0`）。

**归属表这一轮把 UX 线 P3「撤销回执」那一批按原文登记了进去**（未登记栏 15 → 0）。
证据分三种独立来源，不是我猜的：① `scripts/check-undo-receipt.mjs` 头注释第一行写「撤销回执门禁（全局 UX 线 P3）」、
`packages/ui/src/feedback/receipt-timing.ts` 与 `packages/ui/src/index.ts` 的新增段写「2026-10-28，全局 UX 线 P3」；
② `e2e/tests/quadrant-move-ux.spec.ts` 自己写「那一枚撤销按钮现在住在共享的 `UndoReceipt` 里」；
③ 四枚界面文件（`HabitDetailCard` / `NotesView` / `ProjectsPanel` / `QuadrantBoard`）头注释里**没有**日期（现量：
`head -20 <文件> | grep -cE '2026-10-2[0-9]'` 各读 0），但本尺第二判的跨线依赖那一格报出它们各 import 一枚
未入库的 `apps/web/src/lib/feedback/UndoReceipt.tsx` ⇒ 同一族。`?? apps/web/evidence/undo-receipt/` 是两次读数之间
新冒出来的，同一族的取证目录。

**目标第 1 件「全量入库」到这一拍的判决**：本线的改动已**全部**进 HEAD；剩下的都归别人，且**不能代提**，
硬前提是现量不是推测 —— 上面那次 `--self-test` 之后的真跑读数是「跨线依赖 18 处」，
即 18 条**已跟踪代码 import 了没在 HEAD 里的模块**，未入库的新模块三族（`lib/form/useDirtyDismissGuard.tsx`、
`lib/dialog/DangerConfirmDialog.tsx` + 两枚 `*Danger.ts`、`lib/feedback/*`），外加那把新尺已经接进他们工作树的
`package.json` 链但定义没入库。按堆代提的结果就是 HEAD 变半棵树，红的是下一位。取数：

```sh
node scripts/check-worktree-exceptions.mjs          # 分档 + 未登记栏 + 跨线依赖，全部现量打印
git ls-files --error-unmatch apps/web/src/lib/form/useDirtyDismissGuard.tsx   # 读回 error = 仍未入库
```

### 6.112（2026-10-28 09:4x–10:1x · 第 3 件"审自己这轮的码"抓到两处自己的毛病：一栏重复打印、一条打不到的守卫）

**这一节审的是本线今晚新写的码，不是别人的产品面。** 五个维度各量一发，读数如下。

**① 重复实现 —— 有，就在同一枚文件里。** `check-worktree-exceptions.mjs` 打印「索引旧内容」那一档的路径集合，
是新建的「第三版」那一栏的**真子集**（工作树==HEAD 且 索引≠HEAD ⇒ 索引既不等于 HEAD 也不等于工作树 ⇒ 必命中）。
两栏并排印同一批路径 ⇒ 下一位读者不知道哪一栏是权威。处置：**归属那一档照旧参与计算**
（索引旧内容不算"未登记的例外"这个结论要留着，它挡住的是假例外），**只是不再单独打印**；
`wt === head` 那一支的正解行里补上"这就是旧版单独打印的那一档，正文见 §6.108"，把交叉引用接回去。
🔴 折叠不许把路径吞掉，所以加了**包含性臂 ㉛**：`classify` 判为 `indexOnly` 的每一枚，
`thirdVersionRows` 必须同时点名 —— 两条谓词今后谁被单独改动而破坏包含关系，这一臂就红。

**④ 错误处理 —— 有一条是死的。** 我写完 `git hash-object --stdin-paths` 之后加了一句
"取回条数 != 分母枚数 ⇒ 退 2"。这句话**永远轮不到执行**：路径读不到时 `hash-object` 整发失败，
`zip` 配对器先抛 ⇒ 长度不等早在异常里发生了。这就是本仓那句"写了但打不到的错误处理等于没有"的现量样本。
处置：守卫包到真正会失败的那一步外面（`try/catch` ⇒ `🔴 工作树哈希这一发没取成 …` + `rc=2`），
死分支删掉。**可达性怎么证的**：`node -e` 直接喂一发 `git hash-object --bogus-flag` ⇒ 真抛
（`Command failed:` 进 catch），不吞。这一发是**机制级**验证，端到端那一列我**没有**在真树上造出
"某枚脏文件在两次 git 调用之间消失"的形状，所以写成机制读数，不写成端到端已证。

**③ 性能 —— 量了，没问题。** 整把尺（含三条批量 git：`ls-files -s -z` / `ls-tree -r -z HEAD` / `hash-object --stdin-paths`）
**同一趟**取到的一对读数是分母 144 枚 / `real 0.20` 秒（10:5x 那一戳；分母与耗时必须同趟取，
我上一版把 140 与 0.21 配成一对，那是两个时刻的读数硬拼出来的，已改掉）。臂全是纯函数、不碰 git。
没有逐枚 spawn 那条 N+1 形状。
```sh
N=$(node scripts/check-worktree-exceptions.mjs | grep -oE '未提交 [0-9]+' | grep -oE '[0-9]+')   # 先取分母
T=$(/usr/bin/time -p node scripts/check-worktree-exceptions.mjs 2>&1 >/dev/null | awk '/^real/{print $2}')
echo "同一趟：分母 $N 枚 ｜ real ${T}s"
```

**② 死代码 —— 一条。** 上面那个死分支就是。其余新增（`parseLsFilesStage` / `parseLsTree` / `zip` / `thirdVersionRows`）
各有臂消费：`grep -n "㉑\|㉒\|㉓\|㉔\|㉕\|㉖\|㉗\|㉘\|㉙\|㉚\|㉛" scripts/check-worktree-exceptions.mjs` 逐枚有点名。

**判据能不能红（不靠自证）**：母本被我这轮改过之后，台架六种注入**仍全打得到**——
`node research/tools/mutate-worktree-third-version.mjs` ⇒ 注入形状 6 种、打空 0 种；
`node scripts/check-worktree-exceptions.mjs --self-test` ⇒ 臂数与不符数由尺自己打印。

**顺带两条现场事实（都归别人，我只登记不动手）**：
- UX 线新起了 P4 一族（`packages/ui/src/control/`、`packages/ui/tests/control-states.spec.ts`），
  spec 头行自写「`control/states.ts` 的契约 —— 全局 UX 线 P4」，`states.ts` 的 mtime 距我读数 47 秒 ⇒ 正在写。已按原文登记进归属表。
- 🔴 那一分钟里 `packages/ui/src/control/` 还躺着一枚 `states.ts.mut-bak`，几分钟后自己消失 ——
  那是**变异台架的还原备份**，不是残渣（本仓 18 份文档明文写着"还原只从 `.mut-bak` 取，不从 git 取"，
  现量 `grep -rl 'mut-bak' docs | wc -l`）。按"清理未跟踪文件"的直觉删掉它，就会在别人下一次还原时把人家的母本删了。
  ⇒ 别人名下任何 `*.mut-bak` / `*.teeth-bak` 一律不碰；这一条也写进了归属表的注释里，挡住下一个想"顺手清理"的人。

### 6.113（2026-10-29 10:3x · 隔了一天回来：归属表补了两处"看不见"的洞，另把自己两节的时间戳改对）

**回来第一眼不是接着写，是重取。** 隔了一昼夜（本机 10-28 10:5x → 10-29 10:3x），现场全变了：
HEAD 被 UX 线推进若干笔、远端 `refs/heads/main` 落在后面，未提交集合从 144 枚换成另一批。
取数三条（每次都重跑，别用上一次的结论）：

```sh
date "+本机现在 %F %T %Z"
git ls-remote origin refs/heads/main | cut -f1; git rev-parse HEAD      # 远端与本地各一枚
node scripts/check-worktree-exceptions.mjs                              # 分档、未登记栏、第三版栏、跨线依赖
```

**这一轮补的两个洞（都是"判据看不见"，不是"代码写错"）**：

① **归属表只能逐枚列路径，遇到"一批会长会缩的临时件"就变成会漂的抄件。**
现量是仓根躺着别线跑批的 `.run-arms-*.txt`（那一分钟 19 枚，第一行自写"载具闸门 …不是零脏"）。
逐枚登记 19 行 ⇒ 作者每跑一轮就多一枚少一枚，明天这条规则本身就过期。
改法是给前缀加**段内通配**：`*` 展开成 `[^/]*`，所以 `.run-arms-*.txt` 吃下仓根那批，
但**不会**跨目录去吃 `docs/run-arms-x.txt` —— 跨段认领等于替别人把他们线的同名文件划到我这条行下，
是这张表最不能犯的错。坏形状（首尾裸星号、整段一个星号）由规则表自检直接拒（臂 ㉞）。

② **跨线依赖那一判原先只扫 `.ts/.tsx/.mts`，`.mjs` 的 importer 完全不在射程。**
现量一枚就在眼前：`scripts/verify-windows-shell-journey.mjs` 相对 import 自己的 lib。
补 `.js/.mjs/.cjs` 之后，这一趟读回跨线依赖 0 处 —— 注意这**不是**"以前也 0"：
以前那个 0 是"没扫到"，现在这个 0 是"扫到了且确实没有"（那枚 lib `scripts/lib/sync-build-sources.sh` 已在 HEAD，
`git cat-file -e HEAD:scripts/lib/sync-build-sources.sh` 现量）。两枚臂：㊱ 认 `.mjs` 的 importer、㊲ 不认非模块扩展名。
⚠️ **仍未覆盖的形状：shell 的 `source` / `.`** —— 路径常写成 `source "$ROOT/scripts/lib/x.sh"`，
展开 `$ROOT` 要引第二个解析器。这一格登记成**已知边界**，不写成"已覆盖"；下次真出事再补。

**臂 ㉞ 上线第一件事就抓到我自己的夹具**：我给它写的 fixture 里 `why` 只有 8 个字，
被 `auditRules` 判成"理由过短"，于是它多回一条违规（4 而非 3）。**这不是臂错了，是臂有牙**——
它同时说明：新加的臂如果第一趟就绿，反而要怀疑它有没有真跑到断言。

**顺手把自己上一节的两处时间戳改对**（这是我自己那条"正文不存会漂的值"的反例，还是硬拼出来的）：
§6.112 我写「04:0x–04:1x」，而提交日期那三枚真身是 10-28 09:43 / 09:47 / 10:07 / 10:16；
§6.111 收尾那笔实际到 04:53。判据固定成一句：**写时刻之前先 `git log -1 --format=%ad` 取真身**，
别拿"我当时以为是几点"的那分钟。性能那一格原先还把"140 枚"与"0.21 秒"两个时刻的读数配成一对，
换成同一趟取的那对（写法也一并落在 §6.112 的代码块里）。

**别线那批跑批日志的处理**：我只**登记**（让它不再冒充"谁都可能顺手提交掉"的真例外），**一枚都不删、一枚都不提** ——
不是本会话创建的对象；要不要进 `.gitignore` 归那条线自己判（那批日志里含远端载具路径与提交号，
进了 ignore 就再没人会看见它们躺在仓根这件事，这本身就是他们那条线的口径选择）。

**待你一句话的那两件事（都属对外动作，我不动）**：
① 推 `main` 到 GitHub：这一推会**连带公开 UX 线那几笔本地提交**（逐枚 SHA 用
`git log --oneline origin/main..HEAD` 现取，别抄这里）。
② 重新发布 `/var/www/heyta-app` 那盘 SPA（命令与可见变化在 §6.110 与本文件那两条 runbook 引用里，已说过两次）。

### 6.114（2026-10-29 11:3x · 发布这一拍：共享树被守卫**正确**拦停，换干净载体又撞到一条 runbook 没写的前置）

负责人批了"按老命令走一遍"。走的是 runbook §3.7 自己固化的那条
`node research/tools/publish-public-sites.mjs`（它比手敲多三道闸：必须正好是 `main` 那一笔、
发前先备份、站点先发应用后发）。**两发读数**：

**第一发（主检出，dry-run）：守卫拒绝执行，拒得对。**
它读"构建输入脏条目"非零就不动一行。这一趟脏的不是我的码，是**别人正在写的源码**——
按它的粗 pathspec 报 74 条，其中真正参与构建的只有 9 条（其余是门禁重写的已入库截图）。
9 条那批就是 UX 线 P6「可延后的意思表示层」那一族（`apps/web/src/features/legal-recheck/`、
`privacy/PrivacyConsentSheet.tsx`、`packages/ui/src/overlay/dismissal.ts`、三枚 spec、
一枚 `?? e2e/tests/deferrable-sheet.spec.ts`）。现量：

```sh
git -c core.quotepath=off status --porcelain -- apps packages server/public e2e pnpm-lock.yaml package.json \
  | grep -vE '/evidence/|/dist/|/node_modules/'
```

⇒ **拿主检出直接发，发出去的就是别人没写完的源码**。守卫在这里挡的是真事，不是仪式。

**第二发（`main` 的干净 detached 载体）：先红在第 1 步，而且线上一个字节都没动。**
载体是 `git worktree add --detach ~/heyta-carriers/web-pub-<短 SHA> main`，脏条目 0、守卫放行。
它停下来的位置和原因不在我预期里：

```
1/9 pnpm --filter @heyta/landing check:entries
  ERR_MODULE_NOT_FOUND: apps/landing/node_modules/@heyta/i18n/dist/provider.js
🔴 一条 rsync 都没执行 ⇒ 线上还是发之前那一份，不用回滚（宁可不发，也不发一半）
```

**根因不是仓库坏，是"干净检出"这件事本身缺一格**：`dist/` 不进 git，
而 `apps/landing` 与 `apps/web` 是**通过 workspace 包的 `dist` 入口**消费 `@heyta/i18n` 的
（`packages/*/package.json` 里把 `main`/`exports` 指向 `dist/` 的包共 15 枚：
`grep -l '"main": "dist\|"exports"' packages/*/package.json`）。
主检出里 `packages/i18n/dist` 早就存在（现量 `ls -d packages/i18n/dist`），所以 runbook 那三条命令
**在任何一棵构建过的树上都能照抄成功**，而在干净检出上手敲就会在第一发炸——
**它缺的前置是"先把 workspace 包构建出来"**，这一条 §3.7 那一段里没有写。
修法用的是仓库自己的口径（不发明）：载体里先 `pnpm -r build`，再重跑发布器。

**两条登记给自托管分发那一条线（不代改——都是判据/装置口径，且那枚装置不是本线创建的对象）**：
① 发布器的"构建输入"分母按 `apps packages …` 粗路径算，把 `apps/*/evidence/**`（门禁自己重写的截图）
   也算进去 ⇒ 报出来的条数系统性高估（这一趟 74 vs 9），读的人会以为"有一大片源码没落库"。
   同一族的高估在"要不要再跑一趟四端重装"那格已经量过一次（见项目记忆里那条粗 pathspec 的教训）。
② 发布器不检查"workspace 包的 `dist` 在不在"，所以干净载体上它的第一发是一条
   `ERR_MODULE_NOT_FOUND`——看起来像仓库坏了，实际缺一格前置。守卫补一句"dist 未构建 ⇒ 先 `pnpm -r build`"
   比让人去猜这条红强。
   两条都带现量命令，落在下面的 ③ 那一节；**发与不发的判据口径不在我这边改**。

### 6.115（2026-10-29 11:4x · 发布跑成：两站都换成 `main` 的字节，逐字节对账「不齐 0」，登录三件按名字各自绿；线上验收带出一条**从 10-26 就在那儿**的 legal 红）

发布器 `--confirm` 在干净载体（先 `pnpm -r build`，`RBUILD_RC=0`）上的 9 步读数：
**1–8 全 `exit 0`**（两站构建、两次产物对账、远端 `tar` 备份、落地页与应用两条 `rsync --delete` 都跑成），
第 9 步线上验收 **51 passed / 1 failed**。日志在 `/tmp/pub-confirm2.log`，
🔴 它自己把"已经跑成的 rsync"点名列出并给了还原入口（取 `/tmp/heyta-public-backup-*.tgz` 最新一枚解回 `/var/www`）——
**这条设计在这里兑现了**：第 9 步红的时候，脚本没有假装"整链没发生"。

**目标第 4 件要的三样，逐样现量**（都在载体根跑，跑的就是发出去那份）：

```sh
node scripts/live-web-freshness.mjs --landing
#  落地页逐字节对账 ｜ 分母 79 份已入库 HTML ｜ 齐 78 ｜ 不齐 0 ｜ 线上没这页 1 ｜ 抓取失败 0
#  ⚠️ /pitch/ 线上回 404 —— 不在注册表、也不会被发布（这是早就登记的那一格，不是新红）
pnpm --dir e2e exec playwright test --config playwright.live-site.config.ts live-signin-entry live-credential-pages
#  4 passed：中文「登录」点一次直达、英文页同一条路（语言参数不许挤掉 signin）、
#            /signin/ 只剩出口、邮件里每一枚目的地在线上都可达
```

⇒ **台账里那一格"线上产物比 HEAD 旧"这半件事关闭**（不齐 0，且抓取失败 0 = 不是"扫不到所以齐"）。
另注：正文里不写 SHA —— 要核对发的是哪一笔，`git ls-remote origin refs/heads/main` 与载体的 `git rev-parse HEAD` 现取现比。

**那条 legal 红，定性是"断言的前提过期"，不是线上说假话，也不是这次发布带出来的。** 三方时刻：

| 什么事 | 时刻 / 现量 |
|---|---|
| `hasDraftBanner` 这条断言写进线上验收 | `55768bd94`（10-01 23:58）—— 那一天 10 篇**全是** draft，前提成立 |
| `ai-and-transfer` 翻成 `effective` | `41f2ba1ea`（10-26 21:20），带 `effectiveDate: '2026-10-26'`；正文双语两处都写着"这一版起不再是草案"，并注明是产品负责人当天定的口径 |
| 现在线上这页有没有横幅 | 没有 —— 而源码里横幅只在 `status === 'draft'` 时渲染（`apps/landing/src/pages/LegalDocumentPage.tsx:56`），所以**线上与仓库自己的数据一致** |

`grep -rn "status: '" packages/legal/src/documents` 现量是 9 枚 `draft` + 1 枚 `effective`，
而 `e2e/live-site/live-legal.spec.ts:174` 那个 `for (const docId of LEGAL_DOC_IDS)` 对**每一篇**都要横幅
⇒ 这一条从 10-26 起就会红，任何一次跑线上验收都会撞上它。

**为什么不代改**：改这条断言等于改法务页对外呈现的判据口径（"哪几篇算已生效、要不要挂草案横幅"），
而且它落在别人的线上验收套件里 —— 两条都越过本线的授权。该写的不变量是
"横幅存在 ⟺ 该篇在 `draft` 名单里"（名单本身 `packages/legal/src/index.ts:138` 已经导出，
断言却把 10 篇一视同仁），这一格连同时刻表已进 `BLOCKED.md` 的待拍板表。

**载体留着**（`~/heyta-carriers/web-pub-<短 SHA>`，`git worktree` 一枚，脏条目 0）：
UX 线那 9 枚源码一落地，重发只需 `git -C <载体> checkout --force main` + `pnpm -r build` + 再跑发布器，省一趟装依赖。
不要了就这样收（是本会话创建的对象）：`git worktree remove --force <载体>`。

### 6.116（2026-10-29 11:4x–11:5x · 一次"替并行会话收"的判断：三个假设里两个被现量否证，第三个是 HEAD 上真断的）

目标第 1 件写明"含并行会话留下的"。剩下这批脏件 15 小时没人动过（mtime 全在 10-28 18:2x–20:0x），
所以"他们还在写"这句**不再成立**——该替他们收的就收。但我没有直接动手，先量三件事，前两件都量错了方向：

| 我先假设的 | 现量把假设否证在哪 |
|---|---|
| 「那枚新 lib 在 HEAD 里没有消费者 ⇒ 是死代码」 | `git grep -l sync-build-sources HEAD` 读回 11 处，其中 `scripts/android-carrier-device.sh`、`check-android-build-host.mjs`、`check-android-gradle-remote.mjs`、`lib/msix-install-facts.sh` 是真消费者；它是随 `fa907e7cd`（10-28 16:36）**带着消费者一起**进的 ⇒ 不是死代码 |
| 「`reinstall-all.sh` 里还留着同一份逻辑的内联 ⇒ HEAD 有重复实现」 | 拿 lib 自己的函数名去 HEAD 的那份里找，四个名字各命中 0；再看它 `source` 的是哪枚——指向**旧名** ⇒ 不是重复，是下面那一格 |
| 「HEAD 里有人 `source` 一枚不在 HEAD 的文件」 | ✅ 成立：`scripts/lib/sync-windows-sources.sh` 已不在 HEAD（`git cat-file -e HEAD:…` 退 128），而 HEAD 里 4 行还指着它：`reinstall-all.sh:385`（注释）、`:388`（`source`）、`verify-windows-shell-journey.mjs:295`、`research/tools/selfhost-windows-sync-arms.mjs:27` |

**⇒ 干净检出上 `pnpm reinstall:all` 一启动就炸。** 而这件事链上没有任何一层会报：
`check:shell-erasure-parity`、`check:shell-exit-chain` 那族判的是别的东西，本尺原先那一判**读工作树文本**
（工作树里别人已经改成新名了）、且只认模块 `import`——两条都拦不住它。

**怎么收的（代收的唯一一格，其余仍归各自线）**：那三枚脏文件的未提交内容**就是这处改名本身**——
逐枚 `git diff HEAD --numstat` 是 2/2、1/1、1/1，四行全同一路径名，没有夹带任何别的改动；
新 lib 在 HEAD 里且导出的正是它们调用的 `sync_windows_sources`（`git show HEAD:scripts/lib/sync-build-sources.sh` 的函数名单）。
⇒ 提交它只把 HEAD 从不一致变成一致，不改任何语义。归属照旧记在自托管分发那条线名下（提交信息第一行写明"代收拢"）。
复量：`git grep -c sync-windows-sources HEAD` 现在读回 0 处。

**把那一判固化下来（先修后上尺，所以它生下来不红）**：`check-worktree-exceptions.mjs` 新增
「HEAD 的 shell `source` 是否指向不在 HEAD 的文件」。解析取的是**锚点后缀**不是变量求值
（本仓 `source` 的变量前缀按约定都是仓库根，所以从 `scripts|packages|apps|server|docs|research|e2e` 起那一段就够）；
取不到锚点的 14 处落成**「未判定」计数照实打印**——静默跳过等于把"没看到"记成"没有"，那是本仓最贵的一类错。
五枚臂：㊳ 命中（形状就是今天这枚）、㊔ 目标在 HEAD ⇒ 不许命中、㊕ 无锚点 ⇒ 未判定不是绿、㊖ 注释行不算、㊗ dot-source 与 `$REPO` 前缀同权。
默认进退出码；`node scripts/check-worktree-exceptions.mjs` 那行 `HEAD shell source 对账` 自己打印扫了多少行、悬空几处、未判定几处。

**另一件只登记不代办的（归全局 UX 线）**：`apps/web/evidence/` 那批被门禁重写的 PNG，
mtime 全落在 10-28 18:2x–20:0x，而 10-28 20:19 / 20:38 / 20:45 与 10-29 11:40 又有会改像素的 UI 提交落库
⇒ **未提交那一版和 HEAD 那一版都比当前产品旧**。所以"替他们收截图"是错的动作——谁收都把过期证据再钉一次；
正解是改 UI 的那条线重跑截图矩阵、随自己那笔一起提交。这一格连同现量命令进了 `BLOCKED.md` 的待拍板表。

### 6.117（2026-10-29 11:5x · 第 3 件第 ② 维补上一台有分母的死码探针；读数只登记，一枚都不删）

`node research/tools/audit-unused-package-exports.mjs` 的当趟读数（枚数由命令自己打印，别抄这里）：
分母是 `packages/<pkg>/src` 里**全部** `export` 声明，分成三桶报——有消费者 / 只被 barrel 再导出 / 全仓零引用。

**为什么必须有中间那一桶**：本仓包边界是 `index.ts` 再导出 + 各壳按名 import。只问"仓库里搜得到这名字吗"，
会把"barrel 导出了、但没有任何壳 import 它"这条**断掉的转发链**读成活着。第二桶就是这一格。

**独立反查（不信尺一面）**：抽三枚用 `git grep -lw <名字> -- '*.ts' '*.tsx' '*.mjs' '*.js'` 对——
`CompletionAccumulator` 只出现在声明它的那枚文件（零引用桶 ✓）；
`EgressRequest`、`PRIVACY_CONSENT_BLOCKED_ERROR_NAME` 只多出一枚 `packages/ai/src/index.ts`（barrel-only ✓）。

**探针自己的两枚臂抓到我的 bug**（这一族的规矩：臂不能只演示成功，得能挑出写尺的人的错）：
`U2` 指出解析器漏了 `export type { X } from` 这一形——漏了就是把整条类型面从分母里丢掉；
修好后 `U3` 的期望必须跟着变（它盯着"别漏类型面"）。另加一条 `dist/` 不算消费者的加固
（现量：`git ls-files 'packages/*/dist/*'` 读 0，所以这条**不改当趟读数**，只是防别人把本地产物烤进索引）。

**处置边界（写清楚，免得下一位以为可以顺手删）**：两桶都是**候选**，不是判词。
本尺看不见动态引用与 `export *` 通配转发后的间接使用，而且删公共面是产品决定，
按包归各包负责人——`packages/domain` 与 `packages/app-host` 是零引用最厚的两族（分布由命令打印）。
这一格连同复量命令进 `BLOCKED.md` 的待拍板表；本轮**一个字节都没删**。

### 6.118（2026-10-29 12:0x · 第 ③ 维"缺索引的读路径"补上一台按处记账的探针；64 处候选，一枚都不动）

`node research/tools/audit-server-read-index-coverage.mjs` 当趟读数（全部由命令自己打印）：
model 枚数、查询点处数、**判得出的处数**、含判不了条目的处数、左前列命中、无一命中、该表零索引。

判的是**必要条件**：一处查询的 `where` 里没有任何字段能当某条索引的最左列 ⇒ 进候选。
复合索引没有左前列就用不上，这不是我的猜测而是 B-tree 的形状；反过来它**不**保证命中
（排序、分页、统计信息都不在文本判据的射程里），所以候选 ≠ 判词。

**抽验一枚（不信尺一面）**：`User where=[isVerified]`、`where=[isAdmin]`（`admin.routes.ts:351/352`、
`admins.ts:73/83`、`credential-sweep.ts:166`）—— `awk '/^model User /,/^\}/' server/prisma/schema.prisma`
读回 User 只有 `verificationToken / resetPasswordToken / passkeyRecoveryToken / loginToken` 四枚索引，
没有以 `isVerified` 或 `isAdmin` 为左前列的 ⇒ 候选成立。是不是要加索引，取决于 `users` 实际行数与
这些查询的调用频率，那是服务端那条线的判断（管理员列表与凭据清扫都是低频小表的话，加索引反而是负资产）。

**这台尺是怎么被自己的臂和人工复核修了两次的**（这一族值钱的地方就在这儿）：
① 按行切 `where` ⇒ 同一行写三枚键时只拿到第一枚，把"其实命中 `userId` 复合索引"的查询**误报**成缺口
（现量 `server/src/automation/events.ts:305`，加臂 I4b 之后那一处从候选里消失）；
② 站点级与条目级两个数印在同一行 ⇒ `未判定 241` 读起来像"241 处没判"，实际是 183 处含判不了的条目。
现在两条分开记账，未判定还分因（无字面 where / 关系过滤 / `AND·OR·NOT` / 展开）。

**处置边界**：64 处候选按文件与 model 分布由命令打印，**一枚都不动**——加索引要写迁移（本仓不可逆层），
不加也得有人写下"这是小表"的判断。这一格进 `BLOCKED.md` 的待拍板表。

### 6.119（2026-10-29 12:2x · 第 ③ 维"无界监听器与定时器"补上一台按 effect 记账的探针；两发假阳性都落成了臂）

这台尺管的是"注册了没人拆"。它报**候选**，一字节不改：

```
node research/tools/audit-listener-timer-cleanup.mjs            # 读数（诊断档，默认可失败性由 --mutate 证）
node research/tools/audit-listener-timer-cleanup.mjs --self-test # 臂数与不符数自己打印
node research/tools/audit-listener-timer-cleanup.mjs --mutate    # 在内存副本上把拆除那一手抹掉，必须看见候选变出来
```

**当趟读数**（分母、判得出、各档条数都由上面第一条命令自己打印，别抄这里）：射程 = `git ls-tree -r --name-only HEAD` 里
`apps/<壳>/src` 与 `packages/<包>/src` 下的 `.ts`/`.tsx`；每枚 effect 出一行判读，分四档 ——
拆除配上了 / 🟠 有注册没拆除 / 🔴 不返回清理 / 判不了（并分因：具名函数、单表达式、返回值看不懂、括号配不上）。
`setTimeout` 这类一次性定时器与 effect 之外的注册**单列计数、不进候选**：它们与"无界增长"不是同一件事，
混进来只会让下一位把这把尺关掉。

**这把尺是被自己的臂修了两轮的，不是被测物修了两轮**：

① 第一发 7 枚候选**全是假的**。逐枚开码看（`apps/mobile/src/App.tsx:106`、`nav/navigation.tsx:49`、
`screens/AuthScreen.tsx:229`、`screens/TasksScreen.tsx:766`、`lib/use-today.ts:51`、`lib/use-reminder-delivery.ts:79`、
`packages/ui/src/theme.tsx:160`），现场无一例外是 RN 那一味：`const sub = X.addEventListener(…)` ⇒ 收尾 `sub.remove()`。
词表里没有 `.remove(` 这一手 ⇒ 候选整批假。补词表时加了**变量名限定**（臂 A20）：只有当那个名字确实是从本 effect 里的
`addEventListener` 赋来的，`.remove()` 才算拆除 —— 否则一句毫不相干的 `node.remove()` 就能替一整枚漏掉的监听器买单，
那是把尺自己造绿，比造红更糟。

② 第二发 2 枚候选又是假的（`apps/mobile/src/screens/ProfileScreen.tsx:457`、`apps/web/src/features/settings/PrivacyPanel.tsx:47`）。
它们是另一味合法写法：**收尾直接把退订函数交给 React**（`return subscribePrivacyConsent(cb)`）。
原判据只认 `return () =>` 那种箭头，于是把它读成"不返回清理函数"。现在认这一味（臂 A25），
同时留了三条反向的牙：只交了 subscribe 的返回值但同 effect 里还有别的注册 ⇒ 仍要点名（A26）；
收尾 return 一个看不懂的表达式 ⇒ 落"判不了"而不是"干净"（A27）；`return (a || b)` 的括号不等于箭头（A28）。

③ 顺带抓到一台**分母虚报**：判读只 push"有注册的"那几枚，于是"射程内 275 处 effect"被读成 77 处。
现在每个 effect 都出一行，并在主读数那一路把 `判读行数` 与 `遮蔽后认得的 effect 调用数` 现场对账，
对不上就整趟作废退出 2（臂 A18 是同一件事的合成版）。

**能失败**（这一条是本仓的门槛，不是可选项）：`--mutate` 把某一档拆除在**内存副本**里整片抹掉，必须看见候选从 0 变出来；
抹不动就报"打空"并非零退出。当趟 6 种形状：5 种翻出候选、**0 种打空**、1 种**无宿主** ——
`abort`（AbortController 当拆除手段）那一味在现量上没有一枚判成干净的 effect 依赖它，所以这一档只在自检的合成臂里证过
（A4），本趟在真代码上证不了。这把尺**不做原地变异**：共享检出里只有 `--mutate` 的副本，一个字节都不写盘。

**处置边界**：当趟候选为 0 ⇒ 没有要递给别人的一格，`BLOCKED.md` 不新开行。
它**不接进 `pnpm check` 链**（与另两台 audit 探针同一档）：判据是文本必要条件、词表还会随写法长，
一接进去就会变成一把"生下来就红"或"永远绿"的尺；要接，先等到能给出 `--strict` 且当场判得出零违规的那个口径。
复量分母：`git ls-tree -r --name-only HEAD | grep -cE '^(apps|packages)/[^/]+/src/.*\.(ts|tsx)$'`。

### 6.120（2026-10-29 14:3x · 第 ① 维"重复实现"补上一台按函数体对账的探针；本面那一枚当场收掉，别面的逐条登记）

新装置两枚，加上共用的一枚文本工具：

```
node research/tools/lib/text-mask.mjs            # 注释与字符串遮蔽、括号配对、行号、顶层 return（四把尺共用一份）
node research/tools/audit-duplicate-function-bodies.mjs --self-test    # 臂数与不符数自打印
node research/tools/audit-duplicate-function-bodies.mjs                 # 全树读数（诊断档）
node research/tools/audit-duplicate-function-bodies.mjs --strict --scope server/src/password   # 只钉本面那一层的棘轮
```

**为什么先把遮蔽那几枚下沉**：这台尺和刚做的监听器尺都要"先挖掉注释与字符串再正则"。各写一遍，
将来某一枚里修了遮蔽规则、另一枚留着旧规则 ⇒ 两把尺对同一份代码给出互相矛盾的读数，那正是第 ① 维点名的形状。
下沉是**行为不变**的：监听器尺下沉前后两次读数逐字相同（分母、各档条数、候选枚数都没动）。

**这台尺判什么**：把每一枚**声明级**函数体折掉空白做哈希，跨**不同文件**撞进同一枚桶 ⇒ 候选。两档分得很死 ——
🔴 逐字相同（连字符串都对得上）、🟠 只差注释或文案（遮蔽后相同而原文不同）。同文件里各写一遍的另立一档，
不混进"跨文件重叠"。**口径要写在读数里**：内部回调与带泛型参数的箭头不在射程 ⇒ "没有重叠"只覆盖声明级这一层。

**这台尺自己被自己的臂修了三回**（每一回都是判据错，不是被测物错）：
① 取体时把 `balanced()` 返回的 `end` 当成"闭括号之后"，其实它就是那枚 `)` 本身 ⇒ 每一枚 `function` 声明
都被读成"表达式体"跳过：整树只解析出 60 枚函数（真值 996）。D1 那枚臂当场判红。
现在加了两半阳性对照：整树跑要求**两路都吃到东西**，带 `--scope` 时只要求本层那一路（一个全是箭头声明的目录里
`function` 为 0 是事实，不是尺坏）。
② D2 那条臂的夹具把差异注释写在**函数外面** ⇒ 两枚体本来就逐字相同，测的根本不是 🟠 档（实读 `[1,0]` 才暴露）。
③ `--mutate` 第一发抹掉一枚"4 员桶"里的一个成员 ⇒ 桶照旧 ⇒ 报了个"本尺不敏感"的**假红**。
正确的证法是把整桶成员剔干净、要求那一枚桶消失（现在还会打印有没有牵连到别的桶，并说明那不算判据坏）。

**当趟全树读数**（枚数与桶数由上面第三条命令自己打印）：射程含 `server/src`，跨文件 🔴 与 🟠 两档都有桶，
明细带 `file:line(函数名,行数)`。

**本面那一格当场收掉**：`server/src/password/login-otp.ts` 与 `registration-otp.ts` 各写过一份**逐字相同**的
`sameDigest`（hex 摘要的时序安全比较）。这枚不是"难看但无害"：长度守卫 `a.length === b.length` 必须在
`timingSafeEqual` 之前，谁在重构时漏掉它，长度不等就从"返回 false"变成**抛异常**，而调用点把它当"码不对"处理。
收成 `server/src/util/hex-digest.ts` 一份，两处的调用点改指它。
判据：`--strict --scope server/src/password` 在改之前 `rc=1`（列出那一枚桶），改之后 `rc=0`。
行为复核：`pnpm --dir server exec tsc --noEmit -p tsconfig.json` 过；
`vitest run tests/registration-otp.spec.ts`（注册那条流）与 `tests/password-auth-routes.spec.ts`（登录那条流）全过。

**别面的候选逐条登记，不混进"已修"**（每条的复量就是那条 `--scope` 换成它自己的目录；**一枚都不代改**）：

> 🔴 **2026-10-29 16:1x 改口不删旧文**：下面这张表**不是全集**。当时那把尺漏掉了带返回类型标注的
> `function` 声明，整树少报约 4 倍 ⇒ 表里每一格仍然成立，但"**只有**这些"这句不成立。
> 全集由 `node research/tools/audit-duplicate-function-bodies.mjs --top 500` 自己打印，
> 族表与作废声明见 §6.124。

| 叠在哪 | 归谁 | 为什么不由我收 |
|---|---|---|
| `apps/mobile/src/lib/export-copy.ts` 与 `apps/web/src/features/settings/export-copy.ts` 的 `priorityLabel`（🔴 逐字 + 🟠 只差注释） | 导出/习惯那两面各自的负责人 | 跨端文案表收不散收是个产品口径（要不要一份共享 copy 表），不是我这一层的判断 |
| `apps/web/src/features/share/` 里 `toBase64` / `fromBase64` 各两份 | 共享协作线 | 同面同线，但它有自己的迁移节奏；且这三枚要不要进 `packages/` 属于边界判断 |
| `packages/sync-core/src/{key-lifecycle,share-keys}.ts` 的 `decodeStrictBase64` | vendored 层 | 本仓铁律：动 vendored 要同步 `PROVENANCE.md` |
| `packages/app-host/` 里 `parseJson`/`readBody`/`body`/`responseBody` 那一枚 4 员桶，以及 `fetchImpl` 那一对 | app-host 各家 | 逐枚都不是本线写的 |
| `apps/mobile/src/screens/{LegalReconfirmSheet,PrivacyConsentSheet}.tsx` 的 `openLegalLink` | 同意面线 | 同上 |
| `apps/{mobile,web}` 习惯频率编辑器的 `submit`（🟠） | 习惯线 | 同上 |
| `server/src/billing/paycenter.adapter.ts:224` 的 `timingSafeEqualHex` | 计费线 | 它比本面那枚多一道 `a.length > 0` 守卫 ⇒ **不是逐字相同**，是不是同一件事要它自己判；如果是，可以直接改用 `server/src/util/hex-digest.ts` |

🔴 这一张表**还没进 `BLOCKED.md`**：那本账本此刻在别人手里脏着（`git status --porcelain -- BLOCKED.md` 现量），
按既有纪律先落在本计划，等它空了再由搬运者按"立新条还是并入既有条目"复核一次。

### 6.121（2026-10-29 15:4x · 第 ③ 维"循环里逐行查库 / 同步 IO"补上一台有分母的探针；顺手把共用遮蔽工具的两处洞补上）

新装置：`research/tools/audit-loop-io.mjs`。两档形状 ——
🟠 A 档"循环里逐行查库"（`for` / `while` / `do` / `.forEach`·`.map` 这类每行调一次回调），
🟠 B 档"循环内或 async 路径里的同步 IO"（`*Sync(` 系列）。报的都是**候选**，一枚都不改。

四格显式落成"不判/判不了"并**报条数**：批量形状（`createMany`、`where:{in:}`）、有界计数重试
（`for (let i = 0; i < 5; i += 1)`）、动态模型名 `prisma[name]`、循环体括号配不上（**带 file:line**，不是只报个数）。
`setTimeout` 那种一次性定时器由另一把尺管（见 §6.119）。分母自证写在主读数那一路：
"判读到的调用点数"必须等于"遮蔽后正则命中数"，对不上整趟作废退出 2。

四把尺各自的自检：`node research/tools/lib/text-mask.mjs --self-test`（共用遮蔽）与另三把的 `--self-test`；
臂数由每条命令自己打印。全树三把 audit 探针 + 归属尺一次跑完的墙钟在秒级
（`S=$(date +%s); for f in research/tools/lib/text-mask.mjs research/tools/audit-*.mjs; do node "$f" --self-test >/dev/null; done; echo $(( $(date +%s) - S ))`）。

**这一轮我自己造的三个错，都被臂/读数当场抓住**（记下来是因为它们都是"判据错"而不是"被测物错"）：
① 取循环体时把 `balanced()` 的 `end`（就是那枚闭括号本身）当成"闭括号之后" ⇒ `for`/`while` 两路整体失效，
   只剩 `.map`/`.forEach` 那一路还能吃 —— 现量：D1/P1/P5 三条臂同时红。
② 给共用遮蔽工具加自测时，我只判了"`--self-test` 在不在 argv 里"，没判"它是不是被直接执行的那一枚" ⇒
   **三把 import 它的尺一跑自检，就先执行库里的自测并 `process.exit`** —— 症状是四把尺报出同一个臂数。
   "几台仪器给出同一个数"本身就是信号，别当巧合。现在库的守卫同时要求旗标与 `pathToFileURL(argv[1])` 是自己。
③ 补正则字面量遮蔽时，判定"前一个非空白字符"写成了 `text.slice(0, i)` —— 把整趟遮蔽变成 O(n²)，
   三把消费方一起挂住（一次读数超时到被移到后台）。现在只维护一个游标，关键字那次判断只看最后 14 个字符。

**共用遮蔽工具补的那一格洞**：它以前不认正则字面量，于是 `/[\s,}\]]/` 这种字符类里的花括号把后面的配对全搅乱 ——
现量两处"循环体配不上"（`packages/inbound-core/src/webhook.ts`、`packages/design-system/src/generate.ts`）都是它。
补上之后 webhook 那一处从"判不了"变成"判得出"。除法不许被误认成正则（臂 T7），
关键字后面接正则要认（T8），未闭合撇号不许吞掉整行（T5）。

**本面那一档是绿的（现量）**：`node research/tools/audit-loop-io.mjs --strict --scope server/src/password` 退出 0 ⇒
注册登录这条线自己的面上没有"循环里逐行查库"。整层 `--scope server/src` 退出 1，红在别人那一面，见下表。

| 叠在哪 | 归谁 | 为什么不由我收 |
|---|---|---|
| `server/src/sync/services/storage-quota.service.ts` 三处：两处 `findFirst` 在 `for` 里逐用户查、一处 `findMany` 在 `while` 里 | 同步/配额那条线 | 那三处的注释自己写着"Exact semantics over a faster plan"——是**明知 slower 而选 exact** 的判断，改它要连着改那条 sweep 的正确性论证 |
| `packages/design-system/src/generate-cli.ts` 两处循环内同步 IO | 设计系统 token 生成 | 构建期脚本，不在任何在线请求路径上；它阻塞的是生成那一趟，不是用户请求 |
| `apps/desktop/src/smoke.ts` 一处循环内同步 IO | 桌面壳冒烟 | 冒烟脚本，同上 |
| `packages/storage/src/sqlite/node-sqlite-driver.ts:64` 循环内 `rmSync` | 存储驱动 | 那是 `['', '-wal', '-shm']` 三元素的**拆卸**循环，有界且必须在卸载路径上同步 |
| `packages/ai/src/routing.ts` 的 `secretStore.get`（已被本尺改判成"判不了"那一档） | AI 路由 | 它是密钥库取物不是查库 ⇒ 这一格我已经**按机制修掉尺**而不是算成缺陷 |
| `server/src/activity/invite.ts` 两处（`create` + `findUnique` 在 `for (attempt<5)` 里） | 邀请/活动 | 有界计数重试，已被本尺改判成"不判"那一档 |

🔴 与 §6.120 同一格纪律：这张表**还没进 `BLOCKED.md`**（那本账此刻在别人手里脏着，
`git status --porcelain -- BLOCKED.md` 现量），先落本计划，等它空了由搬运者复核"立新条还是并入既有条目"。

---

### 6.122（2026-10-29 16:0x · 第 ④ 维"失败支有没有真回执"补上一台分六桶的探针；11 枚候选逐枚开码，结论不是一把尺给的）

**为什么这一维先前只有散文**：①②③⑤ 各有装置，④ 只靠人读 diff。而"吞异常"这件事人眼只在
**看到的那一枚**上成立 ⇒ 与 §6.119 同一格毛病：负结论没有分母。

**判法（`research/tools/audit-silent-failure-branch.mjs`）**：对每枚 `catch` 取体，按体里做了什么分六桶：

| 桶 | 判据 | 算不算候选 |
|---|---|---|
| `empty` | 体是空的 | 🔴 算 |
| `consoleOnly` | 只有 `console.*` 与注释 | 🟠 算 |
| `commentOnly` | 只有注释（一条真语句都没有） | 不算——那是文档 |
| `throw` | 重新抛出 | 不算——失败已经上抛 |
| `receipt` | 调了回执形状（`*Notice(` / `*Toast(` / `setFeedback(` / `setError(` / `setAlert(` 等**带括号**的调用） | 不算 |
| `otherState` | 只 setState / 只赋值 | 不算——它可能把失败写进了界面状态，尺看不见语义 |
| `other` / `unbalanced` | 其余 / 体配不上 | 不算，`unbalanced` 单独报条数 |

词表从可选 `[=(]?` 收紧成必须 `\(` 的那一发，与 `aria-live` 那枚死词目（被遮蔽挖掉、永不命中）都记在臂 Q6/Q7；
判定用不带 `g` 的那枚正则 ⇒ 臂 Q4/Q5 比的是同一件事，`/g` 的 `lastIndex` 状态污染过一次的教训在 §6.120。

**分母自证**（打印在尺自己的第一行，不抄进这里）：扫了几枚客户端文件、几枚 `catch`、回执词表命中几处，
以及"要人眼看的（判不了那一族）"条数。**候选数 ≠ 覆盖率**这一格就是靠这行说清的。

**能失败**：15 枚臂（`--self-test`，含最大号=条数那枚编号臂）；`--mutate` 两形 2/2 ——
S1 在 `apps/desktop/src/reminder-notify-electron.ts` 的内存副本里插一枚空 catch ⇒ 候选 +1；
S2 把 `apps/mobile/src/screens/ExportScreen.tsx:357` 那枚真回执整个换掉 ⇒ `receipt` −1。都不写盘。

**11 枚候选逐枚开码后的归属**（这一步是尺做不了的，也是"候选不是判词"的意思）：

- 🔴 **一枚是真的，且不在本线**：`apps/mobile/src/screens/ProfileScreen.tsx:243` ——
  登出时 `new URL(config.serverUrl)` 抛 ⇒ `scope` 留 `undefined`，而 `apps/mobile/src/lib/vault-session-cleanup.ts:48/57`
  在 `scope === undefined` 时**两步都跳过**（`disableVaultAutoUnlock` 与 `removeRootKey`）并返回 `{}` ⇒
  调用方 `ProfileScreen.tsx:272` 读成"没有 `secureStorageError`"，`setVaultCleanupPending(undefined)` = 界面报"已清干净"，
  而设备上的根密钥与自动解锁开关原封不动。这是"失败支静默成功"那一形，不是"只 console.log"。
  **不代改**：改它是改那条安全边的契约（`b3d9ad394 feat(mobile): 设备撤销与账户抹除的手机侧接线` 那一族，
  现有断言在 `apps/mobile/tests/device-revocation-behavior.spec.ts`），且"跳过时要不要按失败呈现"是他们的口径。
  可达性我判不了死：`serverUrl` 是保存时被校验过的值，所以这一支今天多半走不到 —— 但走不到的支路**报成功**
  与走得到的支路报成功是同一个形状，登记由下一位连可达性一起判。
- 其余 10 枚**都是写下过的决定**，不是缺陷：`apps/{mobile,web}/src/**/privacy/consent-gate.ts` 与
  `apps/mobile/src/sync/config.ts:111` 的注释明写"一个订阅者抛错不许影响其余的 / 凭据本身已经清掉了"；
  `apps/mobile/src/widgets/lifecycle.ts:89/108/129` 与 `apps/web/src/pwa/lifecycle.ts:81`、
  `apps/web/src/pwa/widget-drain.ts:155` 都是"组件是增强，不是功能前提"；
  `apps/web/src/features/settings/CloseAccountPanel.tsx:94` 的 `catch` 体做 `setPending(undefined)`，
  而同文件 `:79-80` 写着为什么——"显示 0 会让人敢按下，显示未知会被读成没有"。
  ⚠️ 这一格上一轮我差点判成缺陷（理由是"界面没有回执"），开码后**就地作废那个判断**。
- 🟠 一枚留在"该改但归别人拍"：`apps/web/src/lib/oplog.ts:437` —— 局部 op-log 迁移失败时 `console.error` 一句
  "将从空库开始"。同文件 `:413-415` 的守卫 #5 写明这是**有意不阻断启动**（否则用户连导出/反馈的入口都没有），
  但同一句注释说的是"必须留下**可见**痕迹"，实现只留了控制台 ⇒ 意图与实现之间差一档用户可见的呈现。
  改它要碰浮层与反馈那条线（`docs/agents/overlay-feedback.md` 的债务账本），不在本线授权内。

复量：`node research/tools/audit-silent-failure-branch.mjs`（诊断）／ `--strict`（候选非 0 则退 1）／
`--self-test`／ `--mutate`。单枚反查：`awk 'NR>=A && NR<=B' <文件>` 或直接开上面那些 `file:line`。

---

### 6.123（2026-10-29 16:0x · 共享检出的**整文件写回**抹掉了本线 6 行待拍板登记；补一把能抓"已入库的行消失"的尺）

形状：一枚并行会话把 `BLOCKED.md` 整份读入、追加自己那 388 行（B239–B249）、再整份写回。
在它读与写之间，最近 6 笔碰过这枚文件的提交落了地 ⇒ 它写回的那一版**不带那 6 行**，
`git diff` 于是长成"一次纯追加 + 顺手删了 6 行"——这形状在共享检出里**没有任何门禁会报**。

先证明那 6 件不是"已经结了"（结了当然该删）：`node research/tools/audit-blocked-number-collisions.mjs --strict`
仍退 1、`git -c core.quotepath=off status --porcelain -- apps/web/evidence docs/research/evidence` 仍有脏图、
索引覆盖与导出面两把探针照旧出候选。⇒ 是**销毁记录**，不是收尾。

**还原做法**（不碰别人那 388 行）：以 `git show HEAD:BLOCKED.md` 与当前工作树做**顺序无关的行并集**，
只把"ref 里有、工作树里没有"的行搬回去。对账三条：`git diff --numstat` 由 `388 6` 变 `388 0`；
逐主题 `grep -c` 由 0 回 1；搬完再跑新尺 ⇒ 报消失 0 枚。

**新尺**：`research/tools/audit-ledger-row-loss.mjs`。比的是**整行文本（只去行尾空白）的多重集差**，
所以搬家不算丢（臂 L3/L4）、格式化不算丢（臂 L5/L6）、改缩进**有意**算丢（臂 L8，保守：宁可多报由人判）。
分母自己打印；`ref` 取不到或为空 ⇒ 退 2，不许把瞎尺读成"没有消失的行"（臂 L9 + 主读那条 ⚠️ 行）。
牙：`--self-test` 全过（臂数由尺自己打印，别在这里抄），`--mutate` 两形
（抹 1 行 / 抹**连续 5 行**＝事故形状，逐枚对得上被抹的那几行）、以及**把事故那一版回放一次**：
按当时的 hunk 头从 `HEAD` 里剔掉那 6 行喂给尺 ⇒ 报 6 枚。回放用的是真账本，不是夹具自证。

🔴 **下一位的操作纪律**（这才是这条的本体）：动 `BLOCKED.md` 这类多人追加的账本，
**提交前跑一次** `node research/tools/audit-ledger-row-loss.mjs --strict; echo $?`。
退 1 就有两种可能：要么这一行讲的事真结了（那按本仓规矩应留字并标作废），要么就是这一族。
另：本尺默认诊断退 0，别把它接进 `pnpm check` 当恒绿门禁——**永远通过的判据比没有判据更糟**（§7 元规则）。

---

### 6.124（2026-10-29 16:1x · 重叠探针的**口径漏**：带返回类型标注的声明整枚不在分母，旧读数就地作废）

发现路径不是"尺报了红"，是**反着查出来的**：第 ④ 维那 11 枚候选里有一对
`subscribePrivacyConsent()`（`apps/mobile/src/privacy/consent-gate.ts:110` 与
`apps/web/src/features/privacy/consent-gate.ts:144`）逐字只差一行注释，按 §6.120 的判据**应当**落 🟠 桶，
但 `node research/tools/audit-duplicate-function-bodies.mjs` 里 `grep consent-gate` 读回 0。
顺着"0 读数先归因搜法"去挖，`extractFns` 对这两枚文件返回**空数组** —— 整枚文件不在分母。

成因：判据要求 `{` 紧跟参数表闭括号，而本仓主流写法带返回类型标注
（`function f(x): void {` / `async f(): Promise<void> {`）⇒ 每一枚这样的声明被当成"表达式体"**静默跳过**。
修法见尺内注释与臂 D14（三个读数：单枚解析到 / 成对落桶 / 重载签名不吃掉下一枚声明）；
"跳过一段不含 `{`/`;` 的类型"是有意保守——对象返回类型 `): {a: T} {` 落 exprBody 计数，可反查，不假装解析得动。

**旧读数作废声明**（§6.120 与 §6.121 那两张候选表都是同一枚尺的旧口径产物）：改后整树读数由尺自己打印，
本面那一档复核 `node research/tools/audit-duplicate-function-bodies.mjs --strict --scope server/src/password; echo $?`
**仍退 0** ⇒ §6.120 里"本面那格已收口"这句不受影响；受影响的是"**别面只有七格**"那句——它是少报约 4 倍的读数。
新读数的材料族（逐格 `file:line` 由 `--top 500` 打印，这里只点名族与代表格）：

| 族 | 代表格 | 归谁 |
|---|---|---|
| 🔴 展示逻辑在两个壳各写一遍（同一枚函数、跨 `apps/mobile` 与 `apps/web`） | `apps/mobile/src/lib/export-copy.ts:16/25` 与 `apps/web/src/features/settings/export-copy.ts:16/17`；`apps/mobile/src/lib/habits-display.ts:274` 与 `apps/web/src/features/habits/board-labels.ts:166`；`apps/mobile/src/lib/countdown-display.ts:160` 与 `apps/web/src/features/countdown/CountdownView.tsx:109`；`apps/mobile/src/lib/due-display.ts:55` 与 `apps/web/src/lib/due-display.ts:78` | 这一族是 AGENTS §3.5 那条铁律的**现量证据**（业务语义只许在 `packages/*`），要的是"下沉到哪一枚包"的决定，不是逐格删重复 ⇒ 归全局 UX 分层整改线与各自特性线 |
| 🟠 AI 意图文案表两份（百行级） | `apps/mobile/src/ai/intent-copy.ts:53`（88 行）与 `apps/web/src/features/ai/AiToolRun.tsx:125`（102 行） | AI 线 |
| 🔴 同一包内两份 | `packages/sync-core/src/key-lifecycle.ts:78` 与 `packages/share-keys.ts:133` 的 `decodeStrictBase64`；`packages/storage/src/memory/memory-adapter.ts:120` 与 `sqlite/sqlite-adapter.ts:95` | ⚠️ `sync-core` 是 **vendored**（改要跟 `PROVENANCE.md`），存储那对是两种适配器的同类谓词 ⇒ 各自负责人 |
| 🔴 订阅器骨架在 13 枚 store 各写一遍 | `apps/mobile/src/{ai/settings-store,inbound/rules-store,inbound/status,sync/store,sync/write-signal,privacy/consent-gate,privacy/consent-ui,legal-recheck/reconfirm-ui,lib/focus-timer,lib/native-reminder-scheduler,share/share-activity-notify}.ts` + `apps/web/src/features/privacy/consent-gate.ts`、`apps/web/src/features/settings/inbound-lifecycle.ts` | 抽 `makeSubscriber` 是跨线公共面决定，且会动 barrel（`packages/app-host/src/index.ts` 那格 hunk 切不开的已知限制） |
| 🟠 **不是**重叠、由人判掉的一格 | `apps/web/src/features/settings/EmailChangePanel.tsx:56` 与 `apps/web/src/features/settings/PasskeyPanel.tsx:84` | 两枚 `switch` 的**分支集合与词条都不同**（`network` 那支的文案承担"邮箱没有改动"这句），形状相同是巧合 ⇒ 🟠 档天生会报"以文案为本体"的映射函数，这一族**开码不可省**，已判掉 |

🔴 这一族的教训是 §7 元规则「**先怀疑探针**」的又一次现量，并且它纠正的是我自己写下的一句话：
上一轮我把 `consent-gate` 那对当成"尺没抓到 ⇒ 没有重叠"记进了 §6.120 的结论，那句现在作废 ——
**一把尺在某处读 0，只说明它扫的那套写法里没有**，不说明被测物里没有。

---

### 6.125（2026-10-29 16:2x · 本轮收尾三件读数：推远端、线上落地页逐字节、线上那盘应用旧在哪）

- **推**：`git push origin main:main` 前过 pre-push 闸（9 笔待推、1286 行 diff、在册值 21 枚 ⇒ 0 命中）；
  推后复验三条各取一次：本地 `git rev-parse HEAD` 与 `gh api repos/Xaiver03/heyta/git/refs/heads/main --jq '.object.sha'`
  逐字相同，`git rev-list --count origin/main..HEAD` 与反向都是 0，`git rev-parse --abbrev-ref main@{upstream}` 仍读 `gitee/main`
  （系统级禁令：改 git 配置不做，只报）。
- **线上落地页**：`node scripts/live-web-freshness.mjs --landing` ⇒ 分母、齐、不齐、线上没这页四项由尺自己打印，
  不齐 0；唯一那枚 404 是 `/pitch/`（在册的待拍板格，仓库有 HTML 但不在注册表里、也不会被发布）。
- **线上登录链路（发布后读数，真浏览器 + 真 TLS）**：
  `pnpm --dir e2e exec playwright test --config playwright.live-site.config.ts live-signin-entry live-credential-pages`
  ⇒ 全绿，逐条打印：五张凭据页各自引的脚本与 `pages.ts` 声明逐字相同、四枚凭据 POST 的 `code` 各自是机读形状、
  `/signin/` 只剩出口、中文与英文同一条路都一次到登录界面。**B232 那两处（导航不带 signin、产物旧于 HEAD）在这一半边是闭的。**
- **线上那盘应用旧在哪**：`node scripts/live-web-freshness.mjs` ⇒ 不在场的那几枚针脚由尺自己点名（含来源提交），
  判决行读回"线上那盘旧于 `<当时那一笔>`"。**这一族今天多了一条现量**：
  `node research/tools/publish-public-sites.mjs`（不带 `--confirm`，纯守卫读数）当场拒发，理由是
  "构建输入有未提交改动"——脏的那批是 `apps/web/evidence/**` 的截图，落在 `apps/web` 这个前缀里，
  尺按前缀把它们算成构建输入。⇒ 于是"代收那批过期截图"与"发一次线上"在这一格是**互斥**的：
  要么由改 UI 的那条线把截图矩阵重跑并随自己的提交落地，要么走手册 §3.7 那条**干净检出**路线
  （`git worktree add --detach` + 在那棵干净树里 `pnpm install && pnpm build` 再 rsync），
  手册自己写着"发布应用时不要直接用这个工作区构建"。两都不是本线能代拍的：发出去是对外的，
  而 `rsync --delete` 打的是生产目录。**本轮没有再发一次**：上一轮那句"发，按老命令走一遍"是那一趟的授权，
  单次授权不外扩。要发的人需要知道的就一行：`node research/tools/publish-public-sites.mjs --confirm`
  （它拒绝发不是正好 `main` 那一笔的字节，也不动服务端镜像）。

---

### 6.126（2026-10-29 16:2x · 把"要不要再发一次"变成"只差一句点头"：载体路线逐步骤跑通，顺带量出发布装置的一格真空）

上一格留下的那一格（线上那盘应用旧于 main）本轮**不再是拦路状态**，做法是手册 §3.7 那条载体路线：
`~/heyta-carriers/web-pub-d703f1baa` 从 `d703f1baa` 换钉到当前 `main`（换钉前先看
`git diff --stat d703f1baa..HEAD -- pnpm-lock.yaml package.json pnpm-workspace.yaml` 回空 ⇒ 免重装），
再把那棵树唯一一枚脏件（`apps/web/evidence/help-link-render-1013/readout.json`，门禁自己重写的读数件）
先 `git diff` 存到 `~/.heyta-evidence/carrier-webpub-1029/` 再 `git restore` ⇒ `git status --porcelain` 现量 0 枚。

**守卫过了**：`cd <载体> && node research/tools/publish-public-sites.mjs` ⇒ `HEAD==main`、构建输入脏 0 条、`✅ 守卫成立`，
九步原样打印且一步没执行（第 6 步是远端备份，第 7/8 步两条 `rsync --delete`，第 9 步线上验收）。

**本地那五步逐条跑绿**（都在载体里，一个字节没往生产写）：
第 1 步 `pnpm --filter @heyta/landing check:entries` 与第 5 步 `verify-landing-dist.mjs` 各 rc=0；
第 4 步 `node scripts/check-web-artifact.mjs --mount /app/ --dist apps/web/dist` rc=0。
第 3 步第一次是 **rc=1**，第二次 **rc=0**，成因就是本轮记进手册的那格：换钉只换源码不换 `packages/*/dist`，
`tsc` 于是报一串"键不存在于 `MessageKey`"（属 §7 第 615 条那一族），补一次根 `pnpm build` 就绿。
**更要紧的是第二种后果**：把 `packages/i18n/src/locales/zh-CN.ts` 单独 `touch` 一下（内容不变、`git status` 仍 0 枚脏），
第 3、4 步照样 rc=0 ⇒ 发布链条**没有任何一步**比过"包产物 vs 包源码"，可以拿着上一戳的包产物对外发布。
陈旧尺的形状量清楚了（新鲜回 0、陈旧回 ≥1）：`find packages/i18n/src -type f \( -name '*.ts' -o -name '*.tsx' \) -newer packages/i18n/dist/index.d.ts | wc -l`。
把它加进那枚装置的守卫 = 改别人的工具与它 20 枚臂的账，**登记不代改**，格在 `BLOCKED.md` 那张「待拍板 / 跨线」表里。

**要发的人现在只需要一条命令**（在载体根跑）：`node research/tools/publish-public-sites.mjs --confirm`。
可见变化：`/var/www/heyta-landing` 与 `/var/www/heyta-app` 各自被换成这一笔的产物（两条 `rsync` 都带 `--delete`，
发之前第 6 步先在远端 `tar` 一份到 `/tmp/heyta-public-backup-<戳>.tgz`），先发站点后发应用，最后第 9 步线上验收真跑。
发布后逐字节复验的两枚指纹（**那一戳**载体的产物，复算就在载体里跑同一条 `shasum`）：
`apps/web/dist/index.html` 与 `apps/landing/dist/index.html`——现量命令
`cd <载体> && shasum -a 256 apps/web/dist/index.html apps/landing/dist/index.html`。

---

### 6.127（2026-10-29 23:4x · 第 ③ 维最后一格没装置的那一格落成尺：无界列表读；它先抓的是我自己）

**为什么这一格先前是散文**：③ 里 N+1、循环内同步 IO、监听器/定时器、读路径索引各有装置，
"可避免的全量重渲染"住在性能线（P0/P1 各带会红的用例与变异台架，先 grep 过才没另造一把），
只剩**缺分页**没有尺。本轮补 `research/tools/audit-unbounded-read-paths.mjs`。

**判法（A 档=Prisma 行列表读）**：`findMany` 的实参对象**顶层**没有 `take`/`skip`/`cursor` ⇒ 候选；
`findMany()` 一枚参数都没有 ⇒ 候选（整张表）。
`count`/`aggregate`/`groupBy` 不是行列表 ⇒ 不判；实参是变量或 `{ ...opts }` ⇒ 记「判不了」并逐枚给位置；
`$queryRaw` 整族 ⇒ **射程外**（判一条 SQL 有没有界要真解析 `WHERE` 谓词，本尺没这能力）；
客户端与 HTTP 层的分页参数是另一套写法 ⇒ 第一行就打印"这两族都没量"。

**牙（这台尺先抓到的是我自己，两发）**：
① 臂 N3 红 ⇒ `balanced` 交回来的实参**带着那层 `{}`**，顶层键的深度是 1 不是 0 ⇒ 每一枚有界的读都会被误报成候选；
② 修完仍红一次 ⇒ 括号类写成 `[{[(\])]` 漏了 `}`，嵌套对象只加不减深度。
两发的教训同一条：**判据里的字符类要写全，臂要"有界不许报"和"无界必须报"两边都有**。
现在臂全过（枚数由 `--self-test` 自己打印，别在这里抄）；`--mutate` 两个方向（给候选补 `take` ⇒ 候选 −1；从有界的摘掉 `take` ⇒ +1）各只动被点名那一枚。
⚠️ 变异臂自己也红过一次：`find()` 用闭包变量存 `file`/`text`，第二次 `find()` 把第一次那对覆盖了 ⇒
拿 A 文件的行号去 B 文件找括号，读数落成"本尺不敏感"的**假红**。改成每枚命中自带 `{file, text, hit}`。

**当趟读数**（分母与候选数由尺自己打印，别抄这里）：`--top 40` 逐枚列 `file:line`，
分布最厚的是 `server/src/admin/admin.routes.ts` 与 `server/src/shares/share.routes.ts` 两族；
`server/` 整棵是 **vendored**（AGENTS §2：尽量不改，改了要动 `PROVENANCE.md`）⇒ 这一族**全部只登记不代改**。

🔴 **本线那一枚是"不许照字面修"的那一族**（写在尺头，防下一位照候选去加 `take`）：
`server/src/account/access-sessions.ts:189` 的 `listSessions` 没有 `take` 是**对的**——
同文件 `:178` 的注释写着"退出登录撤销不了它们就变成一句界面上的谎"，加 `take` 会把一部分会话静默藏起来；
它的边界在行的生命周期（`access-sessions.ts:218/239/274` 与 `central-auth/repository.ts:689/749` 自己就在删行），不在查询。
⇒ 这一格的正确结论是"**候选不是缺陷**，且这一族的缺陷形态是行不清理而不是查询无界"。

复量：`node research/tools/audit-unbounded-read-paths.mjs`（诊断）／ `--strict`（候选非 0 退 1）／
`--self-test`／ `--mutate`／ `--scope server/src/account`（单面）。

---

### 6.128（2026-10-29 23:5x · 例外尺自己有一处只在一个模式下滤噪声；顺带记一条"等人在飞"的瞬时读数）

撞见的形状：`e2e/live-site/live-legal.spec.ts` 一被别人改脏，归属尺的第二判就报三处"跨线依赖"
（它 import `../../packages/legal/dist/index.js`、`packages/i18n/dist/locales/{zh-CN,en}.js`，见 `:69/:72/:73`）。
那些是 `pnpm build` 的**产物**，按设计不入库 ⇒ 假红。
根因不是判据写错，是**同一类噪声只在一个模式下被承认过**：`--head` 那一臂当初就因为
"指向 `packages/*/dist/*` 这种构建产物…都要真正的解析器才分得清"而撤掉了（尺内那条 `console.error` 还留着），
默认模式却没滤 ⇒ 谁碰这枚文件谁吃三行假红，而假红的代价是别人开始不信这栏。

修法按机制不按计划表：`isBuildArtifactOfTrackedPackage(target, isTracked)`——
`*/node_modules/*` 一律豁免；`packages/<p>/dist/*`、`apps/<p>/dist/*` 只有在**那枚包自己在 HEAD 里**时豁免
（`packages/<p>/package.json` 取不到 ⇒ 整枚包没入库，那就是真半棵树，照报）。
牙三臂：㉞ 已入库包的 dist 不许点名、㉟ 包没入库必须点名（防豁免放走真缺陷）、㊀ `node_modules` 不许点名。
现量：`node scripts/check-worktree-exceptions.mjs --self-test`（臂数由它自己打印）；
同一趟默认模式那三行"跨线依赖"读回消失，未登记例外 0 枚。

🟠 **一条瞬时读数（"等人在飞"不是状态，旁边要连命令）**：法务线此刻正在按待拍板表里那一格
（`49899b546` 登记的"横幅断言前提已过期"）改 `e2e/live-site/live-legal.spec.ts`——
这次未提交的 diff 自己新增 `DOC_STATUS`（从 `@heyta/legal` 注册表取每份件状态）+ 一枚"分母自检"用例，
并把横幅断言改成双向。复取：`git status --porcelain -- e2e/live-site/live-legal.spec.ts`（空=他们已落地）、
`git log --oneline -3 -- e2e/live-site/live-legal.spec.ts`。
本线一行不代改（那是对外呈现的判据口径，又在别人的验收套件里），只把它登记进归属表，
让"未登记栏"读得出真例外。

---

### 6.129（2026-10-29 24:0x · 第 ⑤ 维"同一目的地两个入口"落成装置；「两处都能编辑」明写未判定）

⑤ 那一维先前只有逐枚开码的复核。补上 `research/tools/audit-duplicate-destinations.mjs`：
认四族字面量写法（`setView/switchView/setActiveView`、`setSection/setTab/openPanel/setPanel`、`href="/…"`、
`navigate('/…')`），按 **壳 + 族 + 目的地** 分组（web 与 mobile 各有"设置"是平台差异，合法 ⇒ 不判），
四档阶梯：🔴 `ritual-dup`（同组两枚入口**周围 5 行的调用集合逐字相同**）／🟠 同文件多入口但仪式不同／
🟡 同壳跨文件／⚪ 跨壳。🔴 不看文件边界——跨文件抄同一件仪式一样是重复实现（臂 E14 钉这条阶梯）。

**三处自纠，都是臂先红：**
① 字面量必须扫**原文**——`maskText` 把引号里的内容挖成空格，在遮蔽文本上找 `setView('settings')` 永远找不到，
整枚尺静默读成"零入口"（臂 E8 抓住；E4 也一并补成"枚数必须是 1"，因为 `[].every()` 恒真＝一枚永远绿的臂）；
② 组件名窗口 400 行太窄——本仓壳入口是几千行的巨型 `App`，读回来全是一片 `(顶层)`，改成一路看到文件头；
③ 变异臂第一发读回"变化 0"——它盯 🔴 那一档，而插入行的 ±5 行窗口与被模仿那枚的窗口差几行 ⇒ 落成 🟠。
判"敏感不敏感"要盯**重复入口组**（≥2 枚），🔴 的敏感性由臂 E10/E13/E14 在受控输入上钉。

**当趟读数**（分母、各组枚数由尺自己打印）：🔴 一组，全在 `apps/web/src/App.tsx` 的"打开设置面"那一族：
- `:932` 与 `:991` 仪式逐字同（`setSecondaryAccountSurface/setSettingsAnchor/setSettingsFocus/setSettingsReturnSurface/setSettingsSection/setView`）；
- `:2424`、`:2430`、`:2450` 三枚同仪式（分别是 `onOpenProfile`、`onOpenProfileCenter`、`onOpenHelp`）。
🔴 **顺链看出来的产品形状**（这才是 ⑤ 要的话）：`apps/web/src/features/shell/AccountMenu.tsx:101-102` 同时收
`onOpenProfile` 与 `onOpenProfileCenter` 两枚 prop 并且都渲染（`:351` 只在后者缺席时才退化成一枚）——
**同一个账号菜单里并排两个"个人资料"入口，且两者走的还是不同的状态字段**（一枚设 `settingsAnchor='profile'`、
一枚设 `secondaryAccountSurface='profile'`）。它们是不是两个真目的地，本线不判：
`App.tsx` 归日历/详情面线登记地界、账号菜单与"面"的分层归全局 UX 线，而"该留哪一个"是产品口径 ⇒ 入待拍板表不代改。

⚠️ **射程外的那半句要留在读数里**：「两处都能编辑」这一族**没有装置**——要知道两个控件写的是不是同一个业务字段，
得跨组件对账 state 的语义来源（`setTitle` 与 `setTitleDraft` 静态分不开）。这一格是**未判定**，不是"查过没有"。

复量：`node research/tools/audit-duplicate-destinations.mjs`（诊断）／`--strict`（只被 🔴 触发）／
`--self-test`（臂数它自己打印）／`--mutate`（先注入再拆除，两步都不依赖树上恰好有什么形状）。

---

### 6.130（2026-10-29 24:1x · 自己那把"账本行消失"尺被一次合规的追记判红；修成"就地改写"另立一档）

写 §6.129 之后往 `BLOCKED.md` 那条 legal 格里追加了一句"已由法务线自己收口"的追记，
`node research/tools/audit-ledger-row-loss.mjs --strict` 当场退 1 —— 报"已入库的行消失"。
判据本身没坏（整行文本确实变了），坏在**它把本仓的常态读成事故**：「改口不删旧文」最常见的落点
就是往同一格里追加一段，整行文本因此必变。假红的代价与所有假红一样：下一位开始跳过这一栏。

改法是加一档，不是放宽：`findVanished` 现在先按整行多重集比，比不中的再看**行首 40 码点**在不在
worktree 别处——在 ⇒ 记 `revised`（单独报条数与 `ref → worktree` 的行号，不判红）；不在 ⇒ 仍是 `vanished`，
`--strict` 照样退 1。短于 25 码点的行不参与前缀判定（分隔线那类本来靠多重集数）。
两枚新臂把这条缝钉住：L13 追加追记 ⇒ `vanished 0 / revised 1`；
L14 整行换成不相干内容 ⇒ `vanished 1 / revised 0`（**豁免不许把销毁读成改写**）。
L13 第一发是假红的夹具自己太短（拿 `- 项目符号行` 测前缀，走的是多重集那档，测不到东西）——
记下来是因为这类"臂测了个寂寞"的形状，比红更难发现。
牙复核：`--self-test` 全过（臂数由尺打印）、`--mutate` 两形仍 2/2（抹 1 行 / 抹连续 5 行＝事故形状）；
真账本对真账本自比 ⇒ 消失 0 枚，那一格读回 `✎ 就地改写 ref :12598 → worktree 12598`。

顺带把那条 legal 的**闭合凭据**留在表里（不删旧文）：法务线自己落成 `599955aea`
（横幅改成按 `@heyta/legal` 真源状态双向对账 + 一枚分母自检用例），本线复跑
`pnpm --dir e2e exec playwright test --config playwright.live-site.config.ts live-legal` 全过，
条数由套件自己打印。**"文件不脏了"不等于"事结了"** —— 这一格是复跑出来的，不是读状态读出来的。

### 6.131（2026-10-30 00:1x · 「已入库文档把凭据指给一枚没进库的件」这一族：量到一枚真的，判了不该装门）

收尾那条"未登记=0"的读数时顺链问了一句：**仓里那些写死了凭据出处的句子，指的件真的在版本库里吗？**
答案分两半，都值得记，因为**窄的那条只有一枚、宽的那条噪声到不能用**。

窄口径（当前未跟踪件里被已入库 `.md` 点到裸名的）读回 **1 枚**：`docs/plans/inbound-automation.md`
文末第八节把那张 22 臂逐臂记录的出处写成"由 `.run-arms-carrier-run2.txt` 那台载具日志程序化生成"。
那枚日志在本机盘上（第一行钉着 `CARRIER_HEAD=c249bb6f1`，那笔 commit 在仓里，`还原_ok` 数与文档那句臂数一致），
但 `git ls-tree HEAD -- .run-arms-carrier-run2.txt` 回**空**，且它住在归属门已登记的例外桶 `.run-arms-*.txt` 里
⇒ **"程序化生成"这句的可回证件有保质期**。
登记不代做：把那枚别线的跑批产物按我的名义入库是同表"门禁自己的产物回执"那一格明令禁止的动作；
而改那一半句（入库 vs 换成"装置在仓里、可重跑：`research/tools/verify-inbound-hosted-arms.py`"）是他们的证据口径。
**这格我判 🟠 不判 🔴**——造它的装置已入库，缺的只是原件，复现能力没丢。

宽口径（文档点名的路径在当前树里不存在）**不能当门**：命中的 top 全是 `*.png` 这种通配、
`README.md` 这种同名件、以及设计上就住仓外的产物名。
🔴 **上一轮那个"1466 命中／813 名"的读数作废**——它和这一轮的判据不是同一口径（我这一轮把扩展名清单加宽到
`sh/mjs/py` 并改了去重方式），拿两把不同尺的数当同一件事的两次测量，本身就是"抄来的分母没核口径"。
现量命令与两种口径各一条都写进 `BLOCKED.md` 那张待拍板表的表外代码块了。

**没装门的第三条理由**（这条比噪声更硬）：窄口径的分母就是"当前脏集"。
同一分钟里它从 22 枚漂到 19 枚（别线清掉三枚未跟踪件），而树彻底干净那天它恒 0——
**一把只在树脏时有意义、还随并行会话漂的尺，判不出"没有死指针"和"没东西可判"**。

两发自错，都记下来因为它们比红难发现：
① 第一发漏了 `grep '^?? '`，于是 ` M BLOCKED.md` 这类**已跟踪有改动**的行被 `sed` 原样留下、
被 `read` 吃掉前导空格后当成未跟踪件喂进循环 ⇒ 读数从 1 枚虚报成 **39 枚**（现量：去掉那根过滤器重跑其余不动）。
过滤器漏掉不报错，只是**静默换了分母**。
② 想给这一族找"归谁"时按名字猜会猜错：`.run-arms-*.txt` 那批 19 枚是**几条例共用**的仓根scratch 名，
真正的答案在尺里（`grep -n "run-arms" scripts/check-worktree-exceptions.mjs` 那三条前缀），不在文件名里。

覆盖面对账（先读尺绑定的谓词，不凭"有一把指针尺"就宣布已覆盖）：
死链尺 `node research/tools/docs-link-check.mjs` rc=0 且输出里这个名命中 **0** 枚——它只走 markdown 链接，
不吃反引号里的裸文件名（它自己的表头还印着"无『本机有仓库里没有』的链接"，那句说的是**链接**那一档）；
本线证据指针尺 `verify-inbound-evidence-pointers.py` 的 `DEFAULT_PATTERN` 锚在 `~/\.heyta-evidence/`，
且它的谓词是"盘上还在不在"（这一枚在盘上，所以扩了分母也读绿）；
截图 pin 尺 `check-evidence-pins.mjs` 只吃「png 名 + 32 位 md5」成对写法。
**三把都不瞎，只是三把量的都不是这一形**——这正是"别用一把只扫某套写法的尺去断言没有"的反面用法：
断言"没有门覆盖"之前，得逐把读出它绑的谓词。

入库前的对账：`node research/tools/audit-ledger-row-loss.mjs --strict` 退 **0**（消失 0 枚；
本节的追加不改任何已入库行），尺自己打印 ref/worktree 非空行数。

### 6.132（2026-10-30 00:2x · 发布那一格只剩"要不要发"这一句；顺手量到手册那枚载体目录是会被清掉的）

线上那盘应用与 HEAD 还差一笔对外动作，本线**不自己按**。要点头的可见效果与命令在
`docs/runbooks/deployment.md` §3.7（干净检出构建 → `pnpm check:web-artifact:app` → `rsync` 到 `/var/www/heyta-app`），
发完的凭据按老形状取：`node scripts/live-web-freshness.mjs --landing`（今天 **齐 78 ｜ 不齐 0 ｜ 线上没这页 1**，
那 1 枚是 `/pitch/`，已在待拍板表里）＋ `pnpm --dir e2e exec playwright test --config playwright.live-site.config.ts`。

**量到一件事**：手册 §3.7 让所有人把载体建在 `/tmp/heyta-head`，而这一枚 00:2x 已经不在了——
`git -C /tmp/heyta-head rev-parse --short HEAD` 回 `fatal: cannot change to '/tmp/heyta-head'`。
不是谁删的，那本来就是重启/清理会走掉的位置（本仓那条"可复现物不要住 /tmp"说的就是这件事）。
后果分两种，都对外：要么发布那一趟现建现装（慢，但结论正确），要么下一位图快**直接在本工作区构建**——
那正是手册用🔴标出来的那条（这里有并行会话在写 `packages/domain` / `packages/app-host`，
`apps/web` 从它们的**源码**编译，直接把未提交的半成品推上线）。
载体该住哪儿（`<仓>/.worktrees/head-publish` 之类）是发布这条链的口径，归它拍；本线只登记现量与那一发 fatal 的形状。

另一枚瞬时读数（**别照抄，它一分钟就换名**）：`node scripts/check-worktree-exceptions.mjs`
在 00:20 那一趟报"未登记例外 1 枚"，点名的是一枚 `e2e/tmp-inbound-*.mjs`；同一分钟里它的名字已经换过一次，
而两趟都 rc=0 —— 那条🔴是**读数**，`--strict` 也不进退出码（尺自己 `:390` 注释写着"能拆的雷只有这格是谁留下的才知道答案"）。
不归本线动：那是别人此刻正在写的探针。

### 6.133（2026-10-30 10:4x · ⑤ 那一格"两处都能编辑"从散文变成装置；三发瞎是自己那把对账尺抓的）

上一轮 §6.129 把这一族整格写成**未判定**，理由是"要跨组件对账 state 的语义来源"。
今天重读那句话发现它**只对了一半**：跨组件判不了，但**同一枚组件里两枚控件绑同一枚 `useState` 变量**
是纯本地对账——同一作用域里的同一个名字就是同一个存储，不需要猜语义。于是那半判掉了，
剩下的半留成明写的射程。装置 `research/tools/audit-dual-edit-controls.mjs`（臂数、档位、逐枚位置由它自己打印）。

**判什么**：`🔴 dual-edit` = 同组件 ≥2 枚"可编辑控件"（值绑定 `value|checked|defaultValue|defaultChecked`
的表达式**整段就是那枚变量名** + 带 `onChange|onInput|onChangeText|onValueChange|onSelectionChange`）写同一枚 state；
`🟠 一改一显` / `🟡 全回显` / 单点都不判红。分组键含**组件名**：不同组件的同名 `useState` 是两个存储，
并档会把"两屏各有一个标题框"读成缺陷（臂 F4 钉这条）。
**明写不判**：① 跨组件/跨文件写同一字段（父传 `title`、子里两枚 input）⇒ 逐枚计入「未判定」并给位置；
② 非 `useState` 的状态（store/context/`useReducer`/表单库 `register`）⇒ 不在分母里，读 0 **不等于**"没有"；
③ 值写成表达式（`title.trim()`、`items[0].name`）⇒ 记「判不了」。

**当趟读数**（2026-10-30 10:4x，别抄数，命令现量）：🔴 四组，逐枚开码后**没有一枚是缺陷**——
四组的两枚控件都落在**互斥分支**上（`!hasPackage` 建密码库 vs `hasPackage && !unlocked` 解锁；
`stage === 'identify'` 与后续相位各有一枚邮箱框；移动登录页两枚密码框各在自己的 `? (`/`) : (` 支路）。
所以这一族今天的真相是"界面按相位复用同一枚存储"，不是"两处都能编辑"。
`--hints` 会打出一行**启发式**分支提示（同一支路 / 各有分支标记）——它不参与判红：
分支写法千变万化，把启发式焊进退出码就是造假绿。

🔴 **三发"尺自己瞎"全是第二把尺抓出来的**（一条元规则：一把尺看不出自己瞎，得有一把口径不同的尺跟它对账）：
① 作用域按"往上最近的声明行"认 ⇒ 组件体里先写 `const onSubmit = …` 再写 JSX 时，控件被归到那枚 handler 上，
真树读回来 678 枚 `useState` 只剩 **1 组**本地绑定进档——那是尺瞎不是代码干净（改成**区间包含**，臂 F14 钉）；
② 元素属性区"整段正则扫一遍" ⇒ `trailing={<> … <select value={x}/> … </> }` 这一族把**嵌套元素的属性**
算到外层元素头上，真树 3 枚属性数成 6 枚（改成按 `balanced` 整块跳过 `{…}`，只取顶层属性，臂 F16 钉）；
③ 对账那把尺自己按 `\bchecked` 数 ⇒ `aria-checked={x}` 里 `-` 与 `c` 之间也是词边界，多算 13 枚；
   同一把尺按 `value\s*=` 数又把 `const value = { … }` 那类普通对象赋值算了进来（臂 F13 把两边口径焊死）。
另有两发是夹具自错：F2 原本拿 `<Text>{title}</Text>` 当"回显"，读回来是 `single`——
**子节点插值不是值绑定**，本尺只认那四枚属性（补 F2b 把这条边界钉住）；F16 第一发的比较运算符夹具写成 `n < count`，
`<` 后面隔了空格根本不构成 `tagRe` 的匹配，得写 `n<count` 才测得到那一支。
牙：`--self-test` 全过（臂数由尺打印）、`--mutate` 两形都对（注入一枚同绑定控件 ⇒ 🔴 +1；
摘掉一枚值绑定 ⇒ 该组退出 🔴，且只动被点名的那一枚；全程只在内存，不碰工作树）。

**为什么不挂进门禁**：`--strict` 现在退 0（四组候选全判成有意），装上去它是一枚"今天恰好不红"的门；
而它真的会漏（跨组件那一族）——漏的门比没有门更糟。归法与上面几把尺一样：只交装置与候选。
顺带把 `audit-duplicate-destinations.mjs` 头里那句"这一格未判定"追改成指针（旧文一个字不改）。

### 6.134（2026-10-30 10:5x · ③ 最后一格"可避免的全量重渲染"落成尺；它一上来把**共用遮蔽器**照出一个吃代码的洞）

新装置 `research/tools/audit-avoidable-rerenders.mjs`。这一族静态判不了"这次重渲染值不值"（那是运行时读数），
但有两种形状纯静态可判、而且正是整面重渲染的常见成因，所以照旧拆成"能判的判掉 + 判不了的逐枚登记"：
**A 族**下标当 key——判据是**绑定关系**不是变量名：`key={X}` 里的 `X` 必须是同一枚 `.map(` 回调的**最后一个形参**
（`(row, _col, index)` 这种三参写法按 `[1]` 取会永远对不上，臂 K6 钉）；源是顶层字面量表的落 🟠，
源是会变的列表才落 🔴。**B 族**内联对象/数组字面量 props 打在具名 `memo` 组件上（那枚 `memo` 是白包的），
一律 🟠 不判红——代价随列表尺寸走，值不值归改的人判。
**明写不判**：该不该 `useMemo`、树顶 state 带动的重渲染、高频事件（全是运行时问题）；内联**函数** props（本仓上千处，
进分母就是噪声，只数规模）；`forwardRef(memo(...))`/未具名导出的 memo（收不到名字）。

🔴 **这发值得单独记：它抓到的不是候选，是共用的那把"遮蔽器"在吃代码。**
`research/tools/lib/text-mask.mjs` 判断"这里的 `/` 是不是正则开头"用的是"前一个非空白字符是运算符/括号"那一类启发式，
而它的字符集里**含 `<`** ⇒ TSX 里每一枚闭标签 `</li>` 都被当成正则起点，一路挖到下一个 `/` 为止——
**中间那整段真代码（含 `value={x}` 这类结构）被抹成空格**；`<Foo /> <Bar />` 写在同一行时同理。
表现是 `.map(` 的闭括号"配不上"、`key=` 数不完整。抓到它的正是新尺自带的**第二把尺**：
`key={…}` 独立计数 必须等于「回调里按下标 + 回调里用成员名 + 回调外」三档之和，不等就退 2 拒答——
第一发读回来 73 ≠ 60，顺藤摸到遮蔽器。修法两条判据：`/` 紧跟 `>`（自闭合与片段收尾）不当正则；
`/` 直接挨在 `<` 之后（闭标签）不当正则。代价写在注释里：`a </b` 这种不带空格的比较本仓没有、prettier 也不许，
真出现了只是那一枚正则不再被挖——比抹掉整行代码小一个量级。

**改完必做的对账**（遮蔽器是六把尺共用的，动它等于同时动六把尺的分母）：
`for t in $(grep -rl "lib/text-mask.mjs" research/tools/*.mjs); do node $t --self-test; done` —— 逐把臂全过；
再把已入库读数逐把重跑一遍比对：`audit-silent-failure-branch` / `audit-duplicate-destinations` /
`audit-unbounded-read-paths` / `audit-duplicate-function-bodies` / `audit-listener-timer-cleanup` / `audit-loop-io` /
`audit-unused-package-exports` / `audit-dual-edit-controls`（§6.133 那批数）——**这一趟读数一根没变**，
所以旧读数不作废；那六把尺主要吃 `.ts`，`</` 那形本来就少。**"我改了共用件所以所有读数都得重测"是硬动作，
不是一句"应该不影响"**。

**当趟读数**（现量命令见尺头，别抄这里）：A 族候选 1 枚 → 开码后判**无风险**：
`packages/ui/src/habits/HabitMetricIcon.tsx` 那枚 `key={index}` 映射的是 `HABIT_METRIC_PATHS[kind]`——
一张顶层字面量表，顺序恒定；把它的源识别补进尺（认 `TABLE[key].map` 那种写法、贴表声明认 `[` 与 `{` 两种 initializer）之后，
它自己落进 🟠 那一档，🔴 读 0。B 族**没有分母**：`git grep -nw memo` 剔掉 `useMemo` 与注释后
全仓**一处 `React.memo` 都没有**，所以"内联字面量打穿 memo"这一族今天可判的对象是 0——
这句**只说 B 族没东西可判**，不说"性能没问题"：同一片分母里内联函数 props 有上千处，
配合零 memo，等于父组件一渲染整棵子树都跟着重渲染是**这个库当前的默认形状**。
代价量不量得到要看运行时：那一条是 ③ 剩下的**射程**，不是已闭合的结论（要读数得开 profiling，
本线没有现成装置，也没替各线拍这个）。
牙：`--self-test`（臂数由尺打印）+ `--mutate` 两发都不依赖树上恰好有什么——M1 注入一枚 props 列表的下标 key ⇒ 🔴 +1；
M2 把一枚真存在的顶层贴表改名 ⇒ 那一枚必须从 🟠 翻到 🔴（证明静态/动态那档不是装饰）。

两发新尺自错，都是"读数为 0 但其实尺瞎"那一族：① `mappedSource` 传了 `.map` 那个点的下标（该传开括号），
源名一律读回空 ⇒ 静态表那档永远判不出来，K4 第一次就是这么红的；② 贴表 initializer 只认 `[`，
本仓的图标路径表是 `{ kind: […] }` 这种表套表 ⇒ 顺序恒定的写法被读成 🔴，K13 第一次就是这么红的。

### 6.135（2026-10-30 11:0x · ④ 那一维最后一格"错误形状机器可读性"落成尺；读数过关，但过程里假红过一轮）

新装置 `research/tools/audit-error-shape-machine-readable.mjs`。④ 的四格里吞异常 / 只 console.log /
失败支静默成功早有 `audit-silent-failure-branch.mjs`，**只有"形状机读不机读"是散文**。
判据落成一条能问的问题：**消费方拿什么区分失败**——拿类型 / `name` / `code` 是机读的；
拿 `message` 里的**文案**当分支就是把人读的那一份当契约（本仓有 i18n 门禁与四端词条，文案一改分支静默失效，
没有任何东西会红）。三族：F1 消费侧（比自家中文文案 ⇒ 🔴；测试面同样写法 ⇒ 🟡；比上游整句 ⇒ 🟠；
比 `*_MARKER` 常量或无空格连字符串 ⇒ 🔵「码位塞在文案里」；比变量/模板 ⇒ ⚪ 判不了）；
F2 生产侧（具名错误类既无 `name` 也无 code 类字段 ⇒ 🟠，再加两道闸：有 `instanceof` 消费者的不算缺陷、
**确实被 `throw new` 抛出过**才算）；F3 抛出侧只报裸/具名规模（工具函数里裸抛合法，1400 枚塞进待办就是噪声）。
射程明写：服务端对外 JSON 里有没有 `code` 键这一格**未判定**（那要按服务端真实响应写法下谓词，
本仓不是 `res.status().json({message})` 那一族，现量 `git grep -hoE "res\.status\([^)]*\)\.json\(\{ *[a-zA-Z]+:" -- server/src` 读 0）。

**当趟读数**（现量命令见尺头）：F1 生产侧 🔴 **0** 枚；测试面 2、上游整句 6、码位在文案里 2、判不了 1。
F2：具名错误类 87 枚，其中 13 枚没有机读字段**但都有 `instanceof` 消费者** ⇒ 分得开，不算缺陷；
抛过又谁也分不了的 🔴 **0** 枚。F3：裸 1411 / 具名 460。
⇒ 这一格今天的结论是**过关**，留下的两格要人看是"测试面拿自家文案当断言"与"往 message 里塞码位"
（后者证明形状里缺一个正经的 code 字段，是改法线索，不是缺陷判决）。

四发自身问题，三发靠臂当场兜住，都是"读数为 0 或为真但其实尺瞎/假红"那一族：
① **假红三枚**：`packages/sync-core` 那几枚类的机读承载写成 `override name = 'X'`，
字段探测只认 `^\s*name` 与 `this.name =` ⇒ 有码位的被读成"无机读承载"。逐枚开码才发现（臂 G17 钉）。
② 记账记错维：第一版把"定义了但从来没抛出"的类也算 🔴——那是 ② 死代码那一族的账，
不该记到 ④ 头上；补了"必须被 `throw new` 抛出过"这道闸（臂 G16 钉）。
③ 纯 ASCII 一刀切：把 `privacy-consent-not-granted`（自家往文案塞的 slug）与
`Access Handles cannot be created…`（浏览器整句）并成一档，前者其实是"码位在文案里"；按"有没有空格"分开（臂 G14 钉）。
④ 🔴 **新踩的一种"静默失效"**：把正则片段拼进**模板字面量**再交给 `new RegExp()` 时，
`` `\s` `` 会被模板转义成字母 `s` ⇒ 谓词当场失效、所有类都读成"无机读承载"（87/87），
而调用点一切正常。改成像片段数组用 `String.raw` 拼、键名单独插（臂 G8/G17 当场把这一发红出来）。
牙：`--self-test` 18 枚（含三枚阳性对照与一枚"注释里的比较不算"）；`--mutate` 两向——
注入一枚比自家文案的分支 ⇒ 🔴 +1，同一位置换成比 `name` ⇒ 回到基线（全程只在内存）。
不挂 `pnpm check`：今天它 🔴 读 0，装上去是一枚"恰好不红"的门；判据口径归各线与错误处理那条线。

### 6.136（2026-10-30 11:1x · ④ 那格挂着"未判定"的对外响应体，按真实形状量掉了）

上一节把"服务端对外 JSON 有没有 `code` 键"留成**未判定**，理由是"谓词得按真实形状重下"。
这一轮真去下了：`git grep -lE 'res\.status\([0-9]{3}\)\.json\(' -- server/src` 读**空**，
真形状是 Fastify 的 `reply.status(4xx|5xx).send({ … })`（现量 305 处）。于是 F4 那一族落成四档：
统一码位（`code|reasonCode|errorCode`）／**另一种码位**（`status: 'approved'`、`channel: 'unavailable'` 这类枚举字段）／
什么都没有（5xx ⇒ 🔴，4xx ⇒ 🟠）／**判不了**（`send(变量)`、对象里带 `...展开`、括号配不上）。
**当趟读数**：300 枚统一码位、2 枚另一种码位、🔴🟠 **0 枚**、判不了 3 处 ⇒ 这一格从今天起是"量过的过关"，
不再是"没装置"。`--self-test` 20 枚臂（G18 钉四档分得开、G19 钉"谓词按真形状下"）。

三发自身问题，都是"假红一片"或"假绿一片"那一族，逐枚开码才对得上：
① 只认 `code:` 会把健康检查与退款通道那两处（机读、只是不统一）读成缺陷——**假红两枚**；
② `send({ ...helper() })` 这种展开在字面量里看不见内容，第一版读成"没有码位"——**假红一枚**，
   现在归"判不了"；
③ 最阴的一发：**`maskText` 连引号一起挖掉**，所以"值是不是字符串字面量"这类判断在遮蔽文本上**永远读不到**，
   `status: 'approved'` 那一整档在遮蔽文本上直接消失（臂 G18 第一发就是这么读出 4xx-没码位的假红）。
   改法是这三项判据吃**原文**，键名结构吃遮蔽——与 §6.133 那条"字面量必须回原文读"是同一条教训的第二次付账。
对账臂（`reply.status(4xx/5xx)` 独立计数 == 四档之和）留在那里，不等就退 2 拒答。

同一轮把汇总稿（`docs/research/quality-review-2026-10-30.md`）里那条"未判定"改成本节读数；
另记一处自己写重的：索引那格待拍板表是 🟠（候选），汇总稿一时写成 🔴，同级两处不能两份账（`41d1c0fe7` 已改）。
