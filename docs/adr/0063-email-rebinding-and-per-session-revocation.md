# ADR-0063：邮箱**换绑**走双侧确认；会话带 `jti`，让「退出登录」真的能撤销一枚令牌

> 状态：已接受（2026-10-08）
> 工单：[`account-standard-suite.md`](../plans/account-standard-suite.md)（本 ADR 是它的裁决层）
> 前置：[ADR-0039](0039-email-first-auth-and-desktop-reverse-authorization.md)（邮箱优先，**不改结论**）、
> [ADR-0040](0040-email-password-auth-decoupled-from-e2ee.md)（登录口令与 E2EE 解耦，**不改结论**）、
> [ADR-0041](0041-last-passkey-guard-keys-on-any-usable-entry.md)（`is_verified` 是承重的）、
> [ADR-0055](0055-account-tombstones-and-restore-gate.md)（`email_hash` 的归一化口径）
> 取代：无。它**兑现**了三处早已预登记的触发条件（`data-rights.ts:352`、G-10、`terms.ts:76`）

---

## 1. 背景：两件事各自都是真的，而且互相咬着

### 1.1 换绑邮箱：三层零实现，而政策已经替它写好"什么时候必须改我"

四路只读侦察的实测（2026-10-08）：

| 层 | 现状 | 证据 |
|---|---|---|
| 服务端 | **零**。`server/src/**` grep `changeEmail\|pending_email\|换绑` 无匹配；`users.email` 只有 `@unique`，没有任何写它的代码 | `packages/legal` 那三处否定承诺的存在本身就是证据 |
| 共享契约 | 零。`AUTH_PASSWORD_PATHS` 有 register/login/forgot/reset/change/set 六条，没有一条关于邮箱 | `packages/shared-schema/src/auth-http-contract.ts:39-69` |
| app-host | 零函数 | `packages/app-host/src/hosted-auth.ts` 全部导出清单 |
| 界面 | web `ProfilePanel.tsx:416-421`、mobile `ProfileScreen.tsx:1168-1169` 都是**只读行**，词条 `common.profile.email.hint` 原文写着「**不能在这里修改**」 | `packages/i18n/src/locales/zh-CN.ts:654` |

它不是"没人想到"。`data-rights.ts:345-355` 那张"这份文件什么时候会变"的表里就写着一条：
「**邮箱换绑实现之后**：第三节那条"邮箱不可更换"会被删除，并换成换绑流程」。
`legal-dataflow-ai-rights.md:456-460` 逐条数过账号面只有两条路由。G-10（`legal-compliance-before-filing.md:426`）
把它登记成"更正权的完整度"缺口，处置栏写的正是"如实写"。

⇒ 所以这次做的**不是**新增功能，是**兑现一条已经挂在墙上的触发条件**。
这也意味着：**代码和法务文本必须同批落地**。`check:legal-closure-truth` 就是为此存在的——
它把政策里"今天还不存在"这类封闭句与代码现状对账，谁单独走谁红。

### 1.2 「退出登录」今天不撤销任何东西

`issueSession`（`server/src/auth.ts:492`）签的 JWT 有效期 **365 天**（`JWT_EXPIRY`，ADR-0040:254 已登记为缺口），
payload 只有 `{userId, email, tokenVersion}`。撤销只有一档：`tokenVersion++`，而它是**全局**的。

于是界面上那个「退出登录」实际做了什么？`apps/web/src/App.tsx:2146` 的 `onSignOut` 是
`useSyncStore.getState().clearCredentials()` —— **纯本机删除**。那枚令牌在服务端**仍然有效一整年**。
在共享电脑、借来的笔记本、忘了退出的旧手机上，"我已经退出了"是一句**界面在说谎**。

更糟的是它对外的说法：`packages/app-host/src/device-management.ts` 那族"撤销设备"是真的
（`DELETE /api/sync/devices/:clientId`），但它走的是 `revokeAllTokens(userId)`
（`server/src/sync/sync.routes.ts:391-392`）—— **撤销一台 = 全部登出**。
而 `packages/sync-client/tests/account-closed-erasure.spec.ts:90` 的注释已经在把一个
「登出所有设备」按钮当作既有事实描述，那个按钮在产品里**不存在**。

⇒ 两个动作各自都缺一半：本机退出没有撤销能力，逐台撤销附带全量登出。

---

## 2. 决策

### 2.1 换绑 = **双侧确认**，两边都点才生效，顺序无关

一次换绑产生一张"活请求"，同时向两个地址各发一封信：

```
① 已登录的设备上提交新邮箱
     → 服务端建请求（pending_email + 两枚独立一次性令牌）
     → 发给 旧邮箱：「有人请求把你的账号换绑到 X，这是授权入口」
     → 发给 新邮箱：「有人想把此邮箱绑成 heyta 的登录标识」
② 两半各自被点过 ⇒ 生效；只点一边 ⇒ 账号一个字都不动，界面上写"还在等什么"
③ 生效 ⇒ 写 users.email、置 is_verified=1、撤销该请求、bump tokenVersion、给两个地址各发一封完成通知
```

**为什么不是"新邮箱确认 + 旧邮箱只通知"**（这是更常见的做法，也是最容易被照抄的）：
旧邮箱是这个账号**唯一的找回通道**（`common.profile.email.hint` 那句"找回账号的唯一凭据"就是它自己说的）。
只通知而不要求点击的形态下，一个拿到有效会话又控制着新邮箱的人可以在**主人还没翻到那封通知信**
的时间窗里完成换绑，从此"忘记密码"发到他自己的收件箱 —— 账号就此易主，而原主唯一的自救通道被一起换走了。
双确认把攻击条件从"控制一个新邮箱"抬到"**同时控制两个邮箱**"，而代价只是多点一次。

**为什么允许旧邮箱那边先点**：顺序无关是刻意的。两半都落成布尔字段（`old_confirmed_at` / `new_confirmed_at`），
最后一步用一条**带条件的 `updateMany` 原子 claim** 收口（复用 `recovery.ts:125` 那条形状），
"谁点到最后一边谁触发生效"，重复点击不会二次生效。

### 2.2 生效时 **bump `tokenVersion`，不发会话** —— 承接 `/password/reset` 的 J13/J14 那一双

理由不是"更安全所以顺手踢一遍"，是**结构上的必然**：JWT 的 payload 里**就带着 email**
（`server/src/auth.ts:499`，而 `middleware.ts:60` 把它填进 `req.user.email`）。换绑之后，
每一枚还在飞的令牌携带的地址都是**上一个**——这不是"旧令牌仍可用"那么无害：任何从
`req.user.email` 取"当前邮箱"的地方都会对新地址的主人不作为。做不到"换绑后旧令牌还正确"，
因为旧令牌里写的就是那个旧地址。

于是采用仓内**已有**的那一对语义，而不是发明第三种：
`/password/reset` 成功后 **bump（J13：其他设备全失效）** 且 **不发会话（J14：点链接不等于登录）**
（`ADR-0040:206` 引 OWASP "don't auto-login after reset"）。换绑的生效同样发生在**点邮件链接**那一刻，
所以它也必须不发会话。界面上把后果写在那一次点击**之前**（`web.settings.password.otherDevices` 同族句式）。

### 2.3 不留历史邮箱：一个字段一个值，审计不落明文

被否决的"换绑要留 `previous_email` 审计列"：

1. 政策现在写的是「这是库里**唯一的直接标识符**」（`privacy.ts:201`）。多存一个历史地址，
   那句话就要改成"当前 + 曾经"，而 `personal-info-list.ts:288` 那张"账号表里没有真实姓名、没有电话…"
   的封闭清单要重画，`privacy.ts:404` 那条**四处**的注销后副本清单也要跟着算 —— 而备份是**整库**的。
   身份残留的面因为一个"方便运营"的列而扩大，没有对应的产品收益。
2. 安全通知的价值已经由"两个地址各发一封完成信"兑现了，不需要在库里再存一份。
3. `Logger.audit` 落 `event: 'EMAIL_CHANGED'` + `userId` + 时间，**不落任何一个地址**
   （同族纪律：`admin-log-pii` 门禁管的就是"审计行不许带邮箱明文"）。

### 2.4 邮箱归一化**收成一处**，并让墓碑复用同一处

侦察实测：同一个"把邮箱归一"的动作在 `server/src` 里有 **6 种写法**——
`email.toLowerCase()`（`auth.ts:440`、`auth.ts:646`、`recovery.ts:108`、`service.ts:312`、`api.ts:306`）、
`normalizeEmail = trim().toLowerCase()`（`registration-otp.ts:67`）、
`hashAccountEmail` 里 `trim().toLowerCase()` 后取 SHA-256（`account-tombstones.ts:14-16`）。

`users.email` 是 `@unique`，唯一性比的是**落库那一串**，而注册与登录走的归一化**不是同一个函数**。
⇒ 症状是 `A@x.com ` 与 `a@x.com` 能各自建号，或者同一个地址在某个入口下查不到账号。
换绑把这件事推到台前：`pending_email` 要建**唯一索引**，而索引比的是我写进去的那一串 ——
如果换绑用 `trim().toLowerCase()` 而注册用 `toLowerCase()`，两张唯一约束就是**两套裁决标准**。

这正是 AGENTS §3.5 那条"抽取的收尾动作是**删掉旧的那份并加门禁**，不是写一个更好的新版本"的
**第四复发**（前三次：`ids.ts`、任务 op 构造、`SyncClientOptions`）。所以：

- 新增 `server/src/account/email-normalize.ts` 的 `normalizeEmail()` 作为唯一实现，口径 = `trim().toLowerCase()`
  （**取墓碑那一族的口径**，因为它已经是 ADR-0055:50-52 点名过的、和 `email_hash` CHECK 绑在一起的那一份）；
- 上面 6 处**全部改掉**，不留第二份；
- `hashAccountEmail` 变成 `sha256(normalizeEmail(email))`，即它**调用**那一处而不是自带一套；
- 新门禁 `check:email-normalization`：`server/src` 里任何对 `\.email` 做 `toLowerCase()`/`trim()` 的行、
  或任何新增的"自己拼归一化"的行，除那唯一一处之外一律红。
  ⚠️ 这条门禁**必须能失败**：用注入一行 `email.toLowerCase()` 验证它转红（AGENTS §8 第 3 条）。

### 2.5 会话带上 `jti`，退出登录 = 撤销**这一枚**

- `issueSession` 成为**唯一**的铸令牌点（`replaceToken` 现在在 `auth.ts:236` 自己 `jwt.sign` 一份，
  那是第二份 mint —— 一并改掉）。payload 增加 `jti`（`randomBytes(16).hex`）。
- 新表 `access_sessions`：`jti_hash`（SHA-256 hex，主键，同 `hashToken` 那一族的立场：
  **库里不存那句发出去的东西**）、`user_id`（FK `ON DELETE CASCADE`）、`device_name`、`user_agent`、
  `created_at`、`last_seen_at`。🔴 **没有** `revoked_at`：撤销=删那一行，"存在即有效"。
  软撤销标记那一版**被否掉了**，理由是它只换来一行多余留存 —— 撤过的会话没有任何产品用途，
  而"留一行只为了记下它曾被撤"在 GDPR 侧是反向的（同一句理由写在迁移文件第 57 行的注释里）。
- `verifyToken` 在签名与 `tokenVersion` 判定**之后**加一关：这一枚 `jti` 有没有被单独撤销。
  撤销任一会话时 `authCache.invalidate(userId)`，所以 30 s 的缓存窗口不会变成"撤销了还能用半小时"。
  🔴 **上面那句 10-09 之前不成立，被一次真机旅程前的协议探针否证**（全过程与三层变异读数在
  [`../plans/account-standard-suite.md`](../plans/account-standard-suite.md) §6.7）：`authCache` 的条目
  **只按 `userId` 分格**，而**命中路径直接回 `valid: true`、根本不读 `sessionIsLive`** ⇒
  撤掉 C 之后只要同账号的 B 还在鉴权（它会把 `userId` 那一格重新焐热），C 仍回 **200**。
  `invalidate` 该调的地方一条都没少调 —— 它挡不住的是**"别一枚令牌把这一枚的判断替做了"**。
  修法：缓存键换成 `userId:<sessionId | 'no-jti'>`，`invalidate(userId)` 改成扫掉该用户的全部格。
  ⚠️ 这一句修的是**实现事实**，本节三条裁决（双确认、会话带 `jti`、撤销=删行）**一条没动**；
  没有 `jti` 的老令牌落 `'no-jti'` 那一格，所以上面 §4 边界那族"本轮之前签的令牌不可单独撤销"照旧成立
  （同一条也记在计划 §5 第 1 条）。
  📌 留下一句被证伪的原文是为了让人看清这类断言怎么活下来的：
  当时单测与集成**全绿**，因为它们检查的是"我有没有调 `invalidate`"，不是"撤销之后那一枚还能不能被接受"；
  而那条"撤一枚不动另一枚"的断言把**被撤的那一枚排在最前面探**，顺序本身就照不出焐热路径（traps **#392**）。
- 三条路由（全部 `preHandler: authenticate`）：`GET /api/auth/sessions`（列，含 `current: true` 标记）、
  `DELETE /api/auth/sessions/:sessionId`（撤销一枚；线名是 `sessionId`，库里那一列叫 `jti_hash`，
  界面上不需要知道它来自 `jti`）、`POST /api/auth/sessions/revoke-all`（撤销全部 = 旧的全局档）。
- **界面上两个动作分开、措辞分开**：「退出登录（本设备）」= 撤销这一枚 + 清本机凭据；
  「登出所有设备」= 那枚早已存在、但客户端从来没有调用点的 `/api/replace-token`（`app-host` 里
  连 `replaceToken` 函数都没有，实测：`hosted-auth.ts` 全部导出零命中）。

被否决的替代方案「用 `clientId` 绑会话」：`clientId` 属于同步面，登录时客户端**并不发送它**，
要它进 JWT 就得改五个宿主与线协议；`jti` 是服务端自己铸的，零协议变更。
被否决的"per-device `token_version` 加在 `sync_devices` 上"：把登录面挂到同步表的行上，
而那张表只在**首次同步**时才存在（只登录不同步的账号根本没有行）。

### 2.6 新增认证器**必须发告知信**（兑现 `email-password-auth.md` 缺口 13）

`service.ts:185` 现在明写"成功后**不发信**"。那条登记的后果是：
拿到一枚有效会话的人可以先给账号加一个**自己知道的**口令作为持久入口，而原主一个字都收不到。
本次把它补上：`/password/set`（加第一个口令）与 `passkeys/registration/complete`（加一条通行密钥）
成功后各发一封「账号新增了一种登录方式」。

### 2.7 明确不做

- **不做 2FA/TOTP**（`ADR-0040:252` 的原裁决不变；passkey 就是第二因子）。
- **不做手机号通道**（`ADR-0039:117-120`：触发条件是"有可用的短信供应商"，本次没有改变它）。
- **不给注销加冷静期**（`ADR-0049:40` 已否决，本文**不重开**）。
- **不做 E2EE 口令找回**（`ADR-0040:244` + `ADR-0050:58`：不许用登录密码、邮箱找回链接或 JWT 当数据恢复凭据）。
  ⇒ 换绑与"忘记密码"这两条链都**只碰认证器**，一行都不碰密钥。
- **不把"换绑需要再次输入当前密码"当成默认**：双侧邮箱确认已经是两样凭据，再加一道口令在
  "口令忘了但会话还活着"的那一类真实场景里只会把人锁在门外，而那正好是要修的洞。登记为可复议项。

---

## 3. 后果

1. **政策四处的"不能换"必须同批改写**：`privacy.ts:506`、`terms.ts:76`、`data-rights.ts:158`、`:316`，
   并按 `data-rights.ts:352` 预登记的处置删掉那条触发条件、在各文档变更表加一行。
2. **邮件从五封变八封**（换绑-新邮箱确认 / 换绑-旧邮箱授权 / 换绑完成通知）。"五封"这个数字在
   `privacy.ts:201`、`:296`、`:315` 与 `third-parties.ts:130`（en 栏 `:513`）**四处**被当封闭枚举用，
   漏改任一处就是一句假话。
   🔴 **2026-10-08 落地时实测更正：真值是十封，不是八封。** 两处当时都还没被算进来 ——
   `sendEmailPasswordRegistrationCodeEmail`（注册验证码那封）**在本批之前就存在而词表里没有它**，
   也就是说那句"五封"在 2026-10-08 之前就已经是假的，而没有任何一层会失败（同批那笔提交给
   政策加了「邮箱注册验证码挑战」这一*数据*类别，却没动这三个数 —— 同一功能在一份政策里一半新一半旧）；
   本批 §2.6 的「新增认证器告知」又是一封。⇒ 五 + 1（早已存在的注册验证码）+ 3（换绑）+ 1（认证器）= **十封**，
   四处与中英两栏逐处改写，并由新落成的 `packages/legal/tests/email-catalog.spec.ts` 把这整族封闭枚举
   钉在 `server/src/email.ts` 的导出集合上（新增一封而词表没跟上 ⇒ 红；撤掉一封而文案留着 ⇒ 也红）。
3. **一次性令牌的种类封闭枚举要重算**：`privacy.ts:539`、`personal-info-list.ts:229`、`:540` 三处
   逐类写了种类与时长（24h/15min/1h），换绑令牌与"新增认证器"通知都进这几张表。
4. **新增一张账号关联表** ⇒ 注销级联数从迁移终态**重算**（`structure.spec.ts:483-589` 会算它，
   中英两侧同数），`privacy.ts:404` 那"四处副本"清单跟着变。
5. **`access_sessions` 存设备名与 UA** ⇒ 这是**新增的元数据类别**，必须进 `personal-info-list`
   与 `privacy.ts:179` 那一节"端到端加密覆盖内容、不覆盖元数据"的枚举里，不能只在 s11 提一句。
6. 版本 bump：`privacy@1.8→1.9`、`terms@1.2→1.3`、`data-rights@1.5→1.6`、
   `personal-info-list@1.5→1.6`、`third-parties@1.4→1.5`，进 `legalSetVersion()` ⇒ 触发**补签**
   （`server/src/legal-recheck.ts` 与 web/mobile 的 `LegalReconfirmSheet`），顺序不能反。
7. ⚠️ 顺手要修的一处**已存在的红**：`server/src/legal.generated.ts:22` 的快照停在 `third-parties@1.3`，
   真源已是 `1.4` ⇒ `check:server-legal` 当前就该判红（本文实测两边取值而来，不是推测）。

---

## 4. 边界（不许读多）

- `pending_email` 的唯一索引挡得住"两个账号抢同一个待绑地址"，**挡不住**"另一个账号已经**持有**
  那个地址"——那一半由请求那一步的查重负责，两侧都要有判据。
- 换绑之后**旧邮箱不留墓碑**：`account_tombstones` 只在注销那一刻按当时地址取哈希（ADR-0055）。
  用旧邮箱去恢复一份旧备份，恢复闸认不出它。这是**既有形状**的延续，不是新增破口，
  但它是真的边界，写在这里而不是等下一个人重新发现。
- 单进程内存限流（`email-password-auth.md` §10）对本次新增的三条路由**同样是坏的**：
  多副本部署下形同虚设。本文不解决它，只把它从"口令那族"扩大到"换绑与会话"。
- `jti` 只让"撤销这一枚"成为可能；它**不**缩短仍然 365 天的有效期，也不解决
  "从未被列出来的历史令牌"（本次之前签的令牌没有 `jti`，因此**不可单独撤销**，只能全局 bump）。
  这是有意接受的过渡，不是"已经解决"。
- iOS/Android 的会话界面是**页侧**（共享 `web-dist`）还是原生屏，本次只做到移动端有一块
  可验收的原生面；鸿蒙端仍然没有壳（AGENTS §2 那张表）。
