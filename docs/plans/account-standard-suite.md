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
| UI 挂载那一笔（web 三块面板 + `account-security-wiring.spec.ts`） | 三枚面板与 `SettingsAccountGate.tsx` 都还是 `??`，而 `App.tsx` / `main.tsx` 是别人在写的 `M` | 等那两枚落地后一次提交（`git show HEAD:apps/mobile/src/screens/ProfileScreen.tsx \| grep -c EmailChangeSection` 已 = 2 ⇒ **移动端挂载早就在 HEAD 里**，只剩 web 这一半） |
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
改完射程内 12 段全命中、`--self-test` 六臂全绿 —— 六臂含"用不上的豁免自己会红"与
"光占位符词条通配不了一切"两条阳性对照。豁免表当前是**空的**：一张只进不出的豁免表会和它要挡的
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
