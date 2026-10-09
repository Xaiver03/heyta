# 注册登录标准套件：补齐账号面

> 状态：**进行中**（2026-10-08 立）
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
7. 🔴 **级联数字与"类别名"那两格在共享检出上会红到并行 automation 线把 `20261018160000` 那笔补完对外文案为止**。
   本线的数已按约束逐条归因证明是对的（全树 34/33；摘掉那笔 32/31 = 文案现值）。
   归那条线的是**两张新表的用户可读类别名 + 数字跟着 +2**，不是本线能代拍的两件对外承诺。
8. 新增的集成套件要真 PostgreSQL（本地建的是隔离库 `heyta_account_w9`），
   `pnpm -r test` 那条默认通道**不含**它（`vitest.integration.config.ts` 的 exclude 是对的）。
   它已点名进 `server/package.json` 的 `test:integration:postgres`（`check:integration-coverage` rc=0），
   但**那条脚本不在 `pnpm check` 链里** —— 与仓内其余 30 多份集成套件同一条边界，不是本轮新开的洞。
9. `access_sessions.device_name` 这一列**目前没有任何客户端上报**（界面上看到的一律为空）。
   政策文本里那句"设备名你起"讲的是**同步设备**那张表（`sync_devices`），不是会话表 ——
   两者在 `personal-info-list.ts` 里是分开的两行，别读成同一件事。
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
| W7 | 🟡 本线已落，**两枚红归并行线** | 九行逐条对过：①三份文本的"邮箱不可更换"改成双侧确认（`privacy.ts:506`、`terms.ts:76`+`:80`+`:317`、`data-rights.ts:158`）②触发条件表那条结掉换成"旧地址收不到信时如何更正"（`data-rights.ts:352`）③功能邮件**五封→十封**并逐类点名（`privacy.ts:201`/`:296`）④一次性凭据时长表补注册验证码 10 min 与换绑两枚 24 h（`privacy.ts:539`）⑤`personal-info-list.ts:236`/`:243` 新增"待绑定的新邮箱地址"与"登录会话"两行，并写明"设备名那一列目前没有任何客户端上报"⑦`gen:server-legal` 重跑 ⇒ `check:server-legal` rc=0（顺带关掉 **D4**）⑧帮助中心 `site.docs.account.s6/s7` + `site.help.q/a.rebind|sessions` ⑨五份版本各 bump 一版（`privacy@1.9`、`terms@1.4`、`data-rights@1.6`、`personal-info-list@1.6`、`third-parties@1.5`）+ 变更表各一行、中英同序 ⇒ 进 `legalSetVersion()`，补签同批。<br>🔴 **⑥级联数字这一格是本次唯一"判据绿不了但不是我的数错了"**：`structure.spec.ts` 现量真源 **34 处 / 33 张**，文案写 **32 / 31**。逐约束归因（用该判据自己的推导复刻一遍，标定=不排除时逐字等于它报的数）：**摘掉并行 automation 线那笔未提交的 `20261018160000_add_automation_entitlement_tickets` ⇒ 32 / 31 = 文案现值**；再摘掉本线那笔 ⇒ 30 / 29（= 本批的底数）。⇒ 本线的数字是对的，多出来的两张表（`automation_entitlement_bindings`、`automation_entitlement_ticket_uses`）与它们缺的那个"用户读得到的类别名"归那条线。**不代改**：类别名与对外承诺的措辞是判据口径（见记忆「代改别线代码要三条齐」） |
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

链跑法：逐条 `pnpm <step>` 串行、`NO_COLOR=1`、每步只留 rc 与末两行（脚本在 `/tmp/run-check-chain.mjs`，
一次性夹具，不入库）。**97 步取数 + 2 步单独取数（`typecheck` / `-r test`）= 99**，其中 **16 道非零**。
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
那一笔的 `--stat` 里除了 ADR 与计划，还扫进了 **ADR-0058/0059/0060**、`apps/landing` 两份文档页、
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
| 单元/HTTP 层基线 | 五枚 spec `134 passed (134)` |
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
运行时腿（iOS 设备、真浏览器）仍然等 §6.59 那一格（`packages/ui` 的 barrel 已入库、它引用的 11 枚来源没入库），
而默认通道 `pnpm check` 里本线的红也不在这层：见 §6.17 / §6.20 / §6.21 / §6.59 / §6.61 各自归属。




