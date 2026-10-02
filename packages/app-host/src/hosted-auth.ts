/**
 * 服务端认证客户端（**宿主无关**）
 * =================================
 *
 * 服务端**早就有完整认证**（邮箱验证 / 通行密钥注册与登录 / 恢复 / 登录链接），
 * 但在本文件之前**没有任何客户端调用过它** —— 用户唯一的凭据入口是同步设置里
 * 三个手填的输入框，而且没人告诉他令牌从哪来。
 *
 * 本文件是那份缺口的**协议一侧**：把服务端既有的 HTTP 契约收成一组**窄而显式**
 * 的函数，供三个宿主（Web / 移动 / 非 Web）共用。
 *
 * ## 🔴 为什么在 `packages/app-host`，不在 `apps/web`
 *
 * 每个函数都在决定"业务上该怎么做"（AGENTS.md §3.5 的判据）：
 *   - 哪个路径、发什么字段、成功长什么样；
 *   - 失败如何归类（400/401/403/429/5xx/断网/响应不像话）；
 *   - 凭据从哪里取出来（响应体里的 `token`，不是 cookie）。
 *
 * 这三件事必须**所有宿主逐字相同**：认证协议漂移的后果不是"某个平台少个按钮"，
 * 而是"某台设备永远登不进自己的服务器"。宿主只该决定"用什么网络实现"与
 * "怎么把 options 交给平台的人机接口"。
 *
 * ## 🔴 通行密钥只做协议，不做平台调用
 *
 * `beginPasskey*` 只负责**取 options**，`completePasskey*` 只负责**交 credential**。
 * 中间那一步 —— `navigator.credentials.create()` / `.get()` 或原生等价物 ——
 * **刻意留在宿主里**：浏览器与 Hermes（乃至未来的原生模块）差异极大，
 * 而且那一步调用的返回值形状是平台决定的。把平台调用塞进这里，
 * 等于让 app-host 依赖一个在非 Web 宿主上不存在的全局量。
 *
 * ## 凭据形式（以代码为准，不是猜的）
 *
 * 服务端**不发 cookie**。令牌在**响应体**里：
 *
 *   - `POST /api/login/magic-link/verify` → `{ token, user: { id, email } }`
 *   - `POST /api/login/passkey/verify`    → `{ token, user: { id, email } }`
 *
 * 也就是说 `completePasskeyLogin` / `verifyMagicLink` 是仅有的两个
 * 会产出 `HostedAuthSession` 的函数。
 *
 * ## 失败是可判定的结果，不是异常
 *
 * 全部函数返回 `{ ok: true, ... } | { ok: false, reason, status?, message? }`，
 * 与同目录的 `ai-*.ts`、`entitlement.ts` 同一形状。**任何路径都不抛错** ——
 * "登录失败"是正常状态，不是崩溃点。`message` 是服务端给的安全文案（**数据**，
 * 不翻译）；用户看到的句子由壳按 `reason` 取词条。
 *
 * 🔴 fail-safe 的两个具体动作：
 *   1. `baseUrl` 为空 → **一个请求都不发**（自托管/未配置不受影响）；
 *   2. 宿主没有 `fetch`（Hermes 某些配置下）→ 判 `network`，**不是**进程崩溃。
 *
 * `packages/app-host/tests/hosted-auth.spec.ts` 用注入的 `fetch` 把这些逐条钉住。
 */

import {
  AUTH_PASSWORD_PATHS,
  PASSWORD_AUTH_ERROR_CODES,
  PASSWORD_POLICY_CODES,
  type PasswordPolicyCode,
} from '@heyta/shared-schema';
import { joinEndpointUrl } from './endpoint-url.js';
import { PrivacyConsentBlockedError } from './privacy-consent.js';

/**
 * 服务端认证端点。
 *
 * 🔴 路径**只在这一次定义**，常量同时被测试当作断言目标。
 * 服务端注册在 `prefix: '/api'` 下（见 `server/src/server.ts`），
 * 所以这里的路径都带 `/api`。
 */
export const HOSTED_AUTH_PATHS = {
  verifyEmail: '/api/verify-email',
  magicLinkRegister: '/api/register/magic-link',
  magicLinkRequest: '/api/login/magic-link',
  magicLinkVerify: '/api/login/magic-link/verify',
  passkeyRegisterOptions: '/api/register/passkey/options',
  passkeyRegisterVerify: '/api/register/passkey/verify',
  passkeyLoginOptions: '/api/login/passkey/options',
  passkeyLoginVerify: '/api/login/passkey/verify',
  passkeyRecoverRequest: '/api/recover/passkey',
  passkeyRecoverOptions: '/api/recover/passkey/options',
  passkeyRecoverComplete: '/api/recover/passkey/complete',
  /**
   * 已认证地给**当前账号**再添一条凭据。
   *
   * 🔴 与上面的 `passkeyRegister*`（公开注册新账号）是**两条不同的协议**：
   * 公开注册的完成端点在"email 已属于一个已验证账号"时**故意**提前返回成功
   * 而**不写任何凭据**（防账号枚举）。已登录用户走那条路只会得到一次
   * 静默空操作。这两条路径带 Bearer 令牌，归属由令牌决定。
   */
  passkeyEnrollOptions: '/api/passkeys/registration/options',
  passkeyEnrollComplete: '/api/passkeys/registration/complete',
  /** 自助管理：列出 / 删除当前账号自己的通行密钥。 */
  passkeys: '/api/passkeys',
  /** 账号语言（登录态写回；应用语言解析链第 2 层）。 */
  accountLocale: '/api/account/locale',
  /**
   * 法务文本的**重新确认**（读状态 GET / 记确认 POST 同一条路径）。
   *
   * 挂在 `/api/account/` 下与 `accountLocale` 为伍，而不是新造一套鉴权面：
   * 归属同样只来自 Bearer 令牌。服务端裁决在 `server/src/legal-recheck.ts`。
   */
  accountLegalConsent: '/api/account/legal-consent',

  // ── 邮箱 + 口令（W5）──────────────────────────────────────
  //
  // 🔴 这几条**不写字符串**，而是 `'/api'` + `@heyta/shared-schema` 里的相对形状。
  // 理由就是那份契约存在的理由：服务端注册的字符串与客户端请求的字符串一旦分家，
  // 症状是 404，而 404 在这里归成 `request-rejected` —— 用户看到的是一句
  // "登录没有完成"，没有人会想到"两端各写了一遍路径"。
  emailPasswordRegister: `/api${AUTH_PASSWORD_PATHS.register}`,
  emailPasswordLogin: `/api${AUTH_PASSWORD_PATHS.login}`,
  passwordForgot: `/api${AUTH_PASSWORD_PATHS.forgot}`,
  passwordReset: `/api${AUTH_PASSWORD_PATHS.reset}`,
  passwordChange: `/api${AUTH_PASSWORD_PATHS.change}`,
  /** 已登录**加上第一个**口令（与 `passwordChange` 不是一条路，见共享契约）。 */
  passwordSet: `/api${AUTH_PASSWORD_PATHS.set}`,
} as const;

/**
 * 删除单条凭据的路径。
 *
 * 🔴 `encodeURIComponent` 不是装饰：id 会原样进 URL 路径。
 * 服务端那边的行 id 是 cuid（不含特殊字符），但这里**不假设**它安全 ——
 * 拼接属于协议，协议在 app-host 里只有一份，不能指望每个调用方都记得转义。
 */
export function passkeyPath(id: string): string {
  return `${HOSTED_AUTH_PATHS.passkeys}/${encodeURIComponent(id)}`;
}

/**
 * 删除单条凭据的路径。
 *
 * 删除与改名是**同一个资源**（`/api/passkeys/:id`），只是 HTTP 方法不同，
 * 所以这里与 `renamePasskey` 共用一个实现（`passkeyPath`）。
 * 保留这个名字是因为已有调用方和测试在用；它不再自己拼字符串。
 */
export function passkeyDeletePath(id: string): string {
  return passkeyPath(id);
}

/**
 * 凭据名字的最大长度。**权威在服务端**（`PASSKEY_NAME_MAX_LENGTH`，zod 用它
 * 返回 400 + `passkey_name_too_long`）。
 *
 * 这里放一份是为了界面能用 `maxLength` 在**输入时**就挡住：让用户打完 100 个字
 * 再被拒是一次没必要的往返。两处万一不一致，表现是"界面让输、服务端 400"，
 * 而那条错误码会在界面上说清为什么 —— 不会变成一个说不明白的失败。
 */
export const HOSTED_PASSKEY_NAME_MAX_LENGTH = 60;

/** 一次登录得到的会话。`token` 就是要填进同步设置的访问令牌。 */
export interface HostedAuthSession {
  token: string;
  /**
   * `locale` 是**账号语言**（服务端 `users.locale`，可空 ⇒ 字段可缺）：
   * 客户端在本机无显式选择时采纳它（应用语言解析链第 2 层，
   * docs/plans/i18n-multilingual.md §3，2026-10-01 拍板）。
   */
  user: { id: number; email: string; locale?: HostedAuthLocale };
}

/**
 * 通行密钥的 options / credential。
 *
 * 🔴 刻意是 `Record<string, unknown>` 而不是从 `@simplewebauthn` 引入的类型：
 * 那会变成 app-host 的新依赖（AGENTS.md §3.1–3.2 两道门），而这里
 * **一个字段都不消费** —— 原样取出来交给宿主的人机接口，再把宿主拿到的
 * credential 原样交回服务端。服务端才是校验它的人。
 */
export type HostedPasskeyOptions = Record<string, unknown>;
export type HostedPasskeyCredential = Record<string, unknown>;

/**
 * 失败原因。**封闭集合** —— 壳按它取词条，所以每加一条都要想清楚
 * "用户看到的句子会因此不同吗"。
 */
export type HostedAuthFailureReason =
  /** 没填服务端地址。**不发请求**。 */
  | 'unconfigured'
  /** 服务端说输入不合法（400）。含"要求同意法律条款但没勾"。 */
  | 'invalid-input'
  /** 该实例不允许这个邮箱注册（403）。 */
  | 'not-allowed'
  /** 令牌/链接无效或已过期（401）。 */
  | 'unauthorized'
  /** 请求太频繁（429）。 */
  | 'rate-limited'
  /** 其它 4xx。 */
  | 'request-rejected'
  /** 断网 / DNS / 证书 / 宿主没有 fetch。 */
  | 'network'
  /** 5xx。 */
  | 'server-error'
  /** 2xx 但响应体不是预期的 JSON 形状。**绝不当成功**。 */
  | 'malformed-response'
  /**
   * 这台设备/浏览器没有通行密钥能力（`navigator.credentials` 或
   * `PublicKeyCredential` 不存在），请求**一个都没发**。
   *
   * 🔴 与"用户拒绝"是**两句不同的话**：这个在这个设备上再试多少次都一样，
   * 用户该换设备或改用登录链接；而拒绝重试一次就行。
   */
  | 'passkey-unsupported'
  /**
   * 用户在系统弹窗里取消 / 超时 / 设备上没有可选凭据。
   *
   * 🔴 刻意**不复用** `not-allowed`：后者的契约是"服务端 403，该实例不允许
   * 这个邮箱注册"。拿它当"用户取消"，会让真正的 403 在界面上显示成
   * "你取消了通行密钥" —— 一句把服务端策略说成用户行为的假话。
   */
  | 'passkey-cancelled'
  /**
   * 这台设备上**已经有**这个账号的通行密钥了（WebAuthn 的 `InvalidStateError`，
   * 由服务端下发的 `excludeCredentials` 命中触发）。
   *
   * 🔴 同样不复用 `passkey-cancelled`：用户**什么都没取消**，
   * 该做的是改用"用通行密钥登录"，而不是"再试一次" —— 再试一次会永远同样失败。
   */
  | 'passkey-already-registered'
  /**
   * 这条通行密钥服务端**已经不认了**（多半是在别处删掉了的陈旧凭据）。
   *
   * 🔴 与 `unauthorized` 分开是缺口 B 的全部目的：以前两者都是
   * "Authentication failed"，用户分不清"这条旧密钥失效了，请重新注册或
   * 换登录方式"与"刚建的新密钥坏了"。服务端给出稳定的
   * `code: 'passkey_not_found'`，这里把它翻成一句**可执行**的话。
   */
  | 'passkey-not-found'
  /**
   * 服务端**认得**这条凭据，但这次断言没验过（签名 / 计数器 / 来源）。
   *
   * 🔴 与 `passkey-not-found` 分开：这种情况"再试一次"是有意义的，
   * 而陈旧凭据再试多少次都一样。两句不同的话对应两个不同的动作。
   */
  | 'passkey-rejected'
  /**
   * 服务端**拒绝**删除这条通行密钥（409）：它是账号上最后一条，而账号
   * 也没有**能用的**登录口令（`passwordHash` 已设**且**邮箱已验证）。
   *
   * 🔴 判据是"没有别的入口"，不是"只剩一条"（ADR-0029 → ADR-0041）：
   * 有可用口令时删掉最后一条是允许的，服务端自己会放行，所以这里
   * 收到 409 就**一定**意味着两条都不成立 —— 界面因此可以同时给两条出路
   * （"先添加一条新的"或"设一个登录口令"），不必猜用户手上有什么。
   * 纯通行密钥账号确实没有别的登录方式，删掉就是把用户永久锁在门外。
   *
   * 🔴 界面该说的是那两条出路，而不是"操作失败，请重试" ——
   * 后者会让用户一直重试同一个不可能成功的操作。
   */
  | 'last-passkey'
  /**
   * 改名的输入超过上限（服务端 400 + `code: 'passkey_name_too_long'`）。
   *
   * 🔴 与 `invalid-input` 分开：那个是"输入不合法"的统称，用户不知道该怎么办；
   * 这个能直接说"名字最多 60 字"。正常路径上界面的 `maxLength` 就会挡住，
   * 所以它出现就说明调用方绕过了界面 —— 但那更该给出准确的话，而不是笼统的
   * "输入不合法"。
   */
  | 'passkey-name-too-long'
  /**
   * 邮箱或口令不对（401 + `code: 'invalid_credentials'`）。
   *
   * 🔴 与 `unauthorized` 分开：那个的契约是"令牌 / 链接无效或已过期"，用户该
   * **重新发起一次登录**；这个是"重打一遍"。更要紧的是这句话**故意不区分**
   * 账号不存在 / 没设口令 / 口令错 —— 三种情况在服务端就是同一个码同一句话，
   * 少一条它就变成邮箱枚举器。
   */
  | 'invalid-credentials'
  /**
   * 口令**验对了**，但邮箱还没验证（403 + `code: 'email_not_verified'`）。
   *
   * 🔴 与 `not-allowed` 分开：那个是"这台实例不允许这个邮箱"，用户什么也做不了；
   * 这个的动作是**去收件箱点那封邮件**，而且必须说清"口令是对的" —— 否则用户会
   * 以为自己打错了，于是反复重打同一个正确的口令。
   */
  | 'email-not-verified'
  /**
   * 口令认证器被临时锁定（429 + `code: 'account_locked'`）。
   *
   * 🔴 与 `rate-limited` 分开：那个是 IP 侧限流，句子是"过一会儿再试"；
   * 这条锁的是**这一个账号的口令这一种认证器**，而魔法链接与通行密钥**照旧能走**，
   * 所以界面必须给一条**换路**的出口（"用链接登录，或 N 秒后再试"，
   * 秒数在 `retryAfterSeconds`）。把"账号被锁"说成"网络繁忙"是最误导人的读法，
   * 而说成"账号被封"则是假话。
   */
  | 'password-locked'
  /**
   * 服务端**明说**它现在忙不过来（503 + `code: 'password_backend_busy'`）。
   *
   * 🔴 与 `server-error` 分开：后者是我们自己都不知道发生了什么；这条是哈希闸门
   * 过载这个**具体**原因，`retryAfterSeconds` 有值，界面可以老实说"服务器正在忙"
   * 并保留用户已输入的内容。也**绝不**把它并进 `rate-limited` —— 那是"你发得太猛"，
   * 而这次是**我们的容量问题**，退避策略不该惩罚这个无辜用户。
   */
  | 'password-backend-busy'
  /**
   * 重置链接查不到 / 已过期 / 已被用过（400 + `code: 'invalid_reset_link'`）。
   *
   * 动作是"回去重新申请一封"。🔴 不许与 `unauthorized` 合并：后者暗示"重新认证一次"，
   * 而客户端照做就是**重放同一枚已经用过的链接** —— 服务端会一直回同一个码，死循环。
   */
  | 'invalid-reset-link'
  /**
   * 这个账号**从来没设过口令**（400 + `code: 'no_password_set'`，只出现在已认证的改密）。
   *
   * 🔴 与 `invalid-reset-link` 分开不是为了措辞，是因为两条的 CTA **相反**：
   * 那条要他"重新点一次链接"，这条要他"去走「设置登录密码」把口令设上"
   * （`/password/set` —— 见 {@link setInitialPassword}）。
   * 共用一个码就意味着在一半人面前说错话。
   *
   * ⚠️ 旧版本这里写的是"去走「忘记密码」" —— 那是一句**做不到的指引**：
   * `requestPasswordReset` 对没有口令认证器的账号根本不发信。
   */
  | 'no-password-set'
  /**
   * 这个账号**已经有**登录口令（400 + `code: 'password_already_set'`，
   * 只出现在已认证的"设第一个口令"）。
   *
   * 🔴 与上一条互为反面，而界面上摆的是两张不同的表单：一条是"设一个密码"
   * （单字段），一条是"当前密码 + 新密码"。合并成"这条路不许走"就等于把用户
   * 引到他走不通的那张表上。
   */
  | 'password-already-set'
  /**
   * 新口令不满足策略（400 + `code: 'password_policy_violation'`）。
   *
   * 🔴 具体是哪条规则（太短 / 太长 / 太常见 / 已泄露）**只**由 `policyCode` 判别 ——
   * 四种拒绝的状态码和这一层原因都相同，而用户的动作四种都不同。
   * 只说"口令不符合要求"而不给动作，等于没说。
   */
  | 'password-policy'
  /**
   * **本机闸门把请求拦下了**（用户还没同意，或选的是「只用本机」）。
   *
   * 🔴 与 `network` 分开是这条的唯一存在理由：闸门拦下时抛的是
   * {@link PrivacyConsentBlockedError}，而 `sendJson` 原来的 `catch` 把所有抛错
   * 一律归成 `network` ⇒ 界面会说"网络不可用，请检查连接"。那句话**每个字都是假的**：
   * 网络好好的，是**我们**一个字节都没发。而用户照那句去做（检查 WiFi、换网络）
   * 永远做不对 —— 他要作的是一个隐私决定。
   *
   * 与 `unconfigured` 也不同：那条的动作是"填服务端地址"，
   * 这条的动作是"在弹出来的面板里选同意 / 只用本机"。
   *
   * ⚠️ 它**不代表**服务端拒绝了什么 —— 请求从未离开这台设备。
   */
  | 'consent-required';

export interface HostedAuthFailure {
  ok: false;
  reason: HostedAuthFailureReason;
  /** HTTP 状态码。网络层失败 / 未发请求时为 `undefined`。 */
  status?: number;
  /** 服务端给的**安全**错误串。是数据，不是文案。 */
  message?: string;
  /**
   * 服务端给的稳定机器码（`{ code }` 字段），原样透传。
   *
   * 🔴 判别**只**按它，不按对 `message` 做字符串匹配：文案一改，
   * 匹配就悄悄失效，而失败会静默退化成笼统的一类。
   */
  code?: string;
  /**
   * `password_policy_violation` 的**下一层**判别（服务端响应体的 `policyCode`）。
   *
   * 🔴 类型直接来自 `@heyta/shared-schema`，不在这里重述那四个串 —— 重述就是第二套词表。
   * 值只从**白名单**里来（见 `readServerPolicyCode`）：服务端以后加一个码，
   * 这里给 `undefined`，界面落回那句统称，而不是猜一个可能错的动作。
   */
  policyCode?: HostedPasswordPolicyCode;
  /**
   * 服务端 `Retry-After` 头（秒）。只在 `password-locked` 与 `password-backend-busy`
   * 上有意义，其他情况**一律缺失** —— 缺失和 0 是两件事：0 会让界面显示"再等 0 秒"。
   */
  retryAfterSeconds?: number;
}

/**
 * 策略码的**别名**，不是第二份定义。
 *
 * 命名跟着本文件的习惯（`HostedAuth*`），实体在 `@heyta/shared-schema` ——
 * 那里才是服务端与四个宿主共用的那一份。
 */
export type HostedPasswordPolicyCode = PasswordPolicyCode;

/** 统一的返回形状：成功分支自己带字段，失败分支永远可判定。 */
export type HostedAuthOutcome<T> = (T & { ok: true }) | HostedAuthFailure;

/**
 * 界面语言的封闭集合，随发信请求带给服务端（`body.locale`）。
 * 与 `@heyta/i18n` 的 `Locale` / 服务端的 `ServerLocale` 是**同一张表** —— 这里
 * 刻意不引那个包（app-host 的依赖表里没有 i18n，也不为此加）：用结构相同的
 * 字面量联合，第三种语言落地时 web 侧把新的 `Locale` 传进来会**编译报错**，
 * 逼着这里同步 —— 漂移不可能静默发生。
 */
export type HostedAuthLocale = 'zh-CN' | 'en';

export interface HostedAuthOptions {
  /** 服务端根地址，例如 `http://127.0.0.1:3000`。空串 = 未配置。 */
  baseUrl: string;
  /**
   * 当前界面语言。带上时**发信类**请求会把它作为 `body.locale` 发出去 ——
   * 服务端按「显式 body > 账号语言 > Accept-Language > zh-CN」解析，
   * 于是在中文浏览器里把应用切成英文的用户，邮件也是英文。
   * 可选：不传则服务端照旧（老行为）。
   */
  locale?: HostedAuthLocale;
  /** 网络实现，宿主注入（浏览器 fetch / RN fetch / 测试替身）。 */
  fetchImpl?: typeof fetch;
}

/** 只报 2xx 主体，失败已归一成 `HostedAuthFailure`。 */
type PostResult = { ok: true; body: unknown } | HostedAuthFailure;

const failure = (
  reason: HostedAuthFailureReason,
  status?: number,
  message?: string,
  code?: string,
  extra?: { policyCode?: HostedPasswordPolicyCode; retryAfterSeconds?: number },
): HostedAuthFailure => ({
  ok: false,
  reason,
  ...(status === undefined ? {} : { status }),
  ...(message === undefined ? {} : { message }),
  ...(code === undefined ? {} : { code }),
  ...(extra?.policyCode === undefined ? {} : { policyCode: extra.policyCode }),
  ...(extra?.retryAfterSeconds === undefined
    ? {}
    : { retryAfterSeconds: extra.retryAfterSeconds }),
});

/** 服务端的错误体形如 `{ error: string, details?: ... }`。只取可展示的那一段。 */
function readServerError(body: unknown): string | undefined {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const error = (body as Record<string, unknown>)['error'];
  return typeof error === 'string' && error !== '' ? error : undefined;
}

/** 服务端的稳定机器码（`{ code: string }`）。缺了就是 `undefined`，不猜。 */
function readServerCode(body: unknown): string | undefined {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const code = (body as Record<string, unknown>)['code'];
  return typeof code === 'string' && code !== '' ? code : undefined;
}

function readServerMessage(body: unknown): string | undefined {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const message = (body as Record<string, unknown>)['message'];
  return typeof message === 'string' && message !== '' ? message : undefined;
}

/**
 * 服务端 `policyCode` 的**白名单**读取。
 *
 * 词表来自 `@heyta/shared-schema`（那四个串唯一的定义处），所以这里不需要重述它们。
 * 查不到就给 `undefined` —— 界面落回那句"口令不符合要求"。🔴 绝不"照原样透传字符串"：
 * 那等于让服务端的任何新取值直接决定界面说哪句话，而没人给它写过词条。
 */
function readServerPolicyCode(body: unknown): HostedPasswordPolicyCode | undefined {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const raw = (body as Record<string, unknown>)['policyCode'];
  return (PASSWORD_POLICY_CODES as readonly unknown[]).includes(raw)
    ? (raw as HostedPasswordPolicyCode)
    : undefined;
}

/**
 * `Retry-After` 头 → 秒。
 *
 * 只接受**正整数**（HTTP 的 delta-seconds 形状）。小数、负数、日期串一律给
 * `undefined` —— 界面拿不到数就说"稍后再试"，拿到一个 `NaN` 却会显示"再等 NaN 秒"。
 */
function readRetryAfter(headers: Headers | undefined): number | undefined {
  if (headers === undefined) return undefined;
  const raw = headers.get('retry-after');
  if (raw === null) return undefined;
  const seconds = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

/**
 * 服务端的 `code` → 本层的封闭原因。
 *
 * 🔴 白名单，不是"有 code 就用"。服务端以后加一个新码，客户端**不会**
 * 悄悄把它当成某一种已知失败 —— 它会退回按状态码分类（最保守的结论），
 * 而不是猜一个可能错的动作。
 *
 * ⚠️ 服务端那些口令码**每一个都在这里有一行**。这条"一一对应"由
 * `packages/app-host/tests/hosted-password-auth.spec.ts` 对着
 * `PASSWORD_AUTH_ERROR_CODES`（共享契约）逐项检查 —— 少一行不会有任何类型错误，
 * 症状只是"一种本来能说清的失败变成了一句笼统的话"，而那正是最难被发现的回归。
 *
 * 导出**只为**那条对账测试；调用方不该拿它当查询表用（该用函数返回的 `reason`）。
 */
export const FAILURE_REASON_BY_SERVER_CODE: Readonly<Record<string, HostedAuthFailureReason>> = {
  // 登录时出示的凭据服务端不认得（缺口 B）。
  passkey_not_found: 'passkey-not-found',
  // 登录时凭据认得但断言没通过（缺口 B 的另一半）。
  passkey_verification_failed: 'passkey-rejected',
  // 删除时目标凭据不是自己的 / 不存在 —— 服务端故意与上一条分开命名，
  // 但对用户来说是同一件事："这条凭据不在你的账号上了"。
  passkey_not_found_for_user: 'passkey-not-found',
  // 删除最后一条被拒绝。
  last_passkey_required: 'last-passkey',
  // 已认证"再加一条"时，这条凭据已经在服务端登记过（P2002）。
  // 前端正常会被 excludeCredentials 先挡在设备侧（InvalidStateError，
  // 同样映射到这个原因），这是绕过前端时的服务端守卫给出的码。
  passkey_already_registered: 'passkey-already-registered',
  // 改名时名字超过上限。没有这一条它会退回 classifyStatus(400) → 'invalid-input'，
  // 也是一句正确但没用的话；用户需要知道"最多 60 字"。
  passkey_name_too_long: 'passkey-name-too-long',

  // ── 邮箱 + 口令那条路的八个码（与共享契约一一对应）──────────
  invalid_credentials: 'invalid-credentials',
  email_not_verified: 'email-not-verified',
  // 🔴 429 在这个码上**不是**"你发得太猛"。状态码分类会给 `rate-limited`，
  // 那是一句对一半人错的话（他被锁的是口令这条路，而链接登录现在就能走），
  // 所以必须用 code 覆盖状态分类。
  account_locked: 'password-locked',
  // 同理：503 会被状态码分类成 `server-error`（"我们不知道发生了什么"），
  // 而服务端其实**明说**了是哈希闸门过载。
  password_backend_busy: 'password-backend-busy',
  password_policy_violation: 'password-policy',
  invalid_reset_link: 'invalid-reset-link',
  no_password_set: 'no-password-set',
  // "设第一个口令"打在已有口令的账号上 ⇒ 该走改密。与上一条相反，两张不同的表单。
  password_already_set: 'password-already-set',
};

/** 由服务端 `code` 与 HTTP 状态共同决定原因；只有白名单里的码会覆盖状态分类。 */
function classifyFailure(
  status: number,
  code: string | undefined,
): HostedAuthFailureReason {
  if (code !== undefined) {
    const mapped = FAILURE_REASON_BY_SERVER_CODE[code];
    if (mapped !== undefined) return mapped;
  }
  return classifyStatus(status);
}

/** HTTP 状态 → 原因。分类只按**用户能做的动作**分，不按服务端实现分。 */
function classifyStatus(status: number): HostedAuthFailureReason {
  if (status >= 500) return 'server-error';
  switch (status) {
    case 400:
      return 'invalid-input';
    case 401:
      return 'unauthorized';
    case 403:
      return 'not-allowed';
    case 429:
      return 'rate-limited';
    default:
      return 'request-rejected';
  }
}

/**
 * 发一次请求并归一结果。
 *
 * 🔴 **不抛错**。三种失败各有归宿：地址没配（不发请求）、网络层抛错（`network`）、
 * 宿主根本没有 `fetch`（同样是 `network` —— Hermes 上"没有这个全局量"是
 * 一种环境事实，不是产品崩溃）。
 *
 * `token` 是**访问令牌**（服务端发的是 Bearer，不是 cookie）。带上它时
 * 请求就是"以某个已登录用户的名义"发的 —— 列 / 删自己的凭据走这条。
 */
async function sendJson(
  options: HostedAuthOptions,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  payload?: unknown,
  token?: string,
): Promise<PostResult> {
  if (options.baseUrl.trim() === '') return failure('unconfigured');

  const impl =
    options.fetchImpl ??
    (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : undefined);
  // 没有可用的网络实现：判成 network，而不是让 "undefined is not a function" 炸出去。
  if (impl === undefined) return failure('network');

  const headers: Record<string, string> = {};
  if (payload !== undefined) headers['content-type'] = 'application/json';
  if (token !== undefined) headers['authorization'] = `Bearer ${token}`;

  let response: Response;
  try {
    response = await impl(joinEndpointUrl(options.baseUrl, path), {
      method,
      headers,
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
  } catch (error) {
    // 🔴 **本机闸门拦下不等于网络故障**。这一条是本轮实测出来的：
    // 闸门抛的是 `PrivacyConsentBlockedError`，而原来这个 `catch` 把所有抛错
    // 一律归成 `network` ⇒ 未同意的用户点登录，界面说"网络不可用，请检查连接"。
    // 那句话每个字都是假的（网络好好的，是我们一个字节都没发），
    // 而用户照它去做（换网络、重连 WiFi）永远做不对 —— 他要作的是一个隐私决定。
    if (error instanceof PrivacyConsentBlockedError) return failure('consent-required');
    return failure('network');
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    // 响应体不是 JSON（或为空）。状态码仍然有效 —— 别因为解析失败丢掉结论。
    body = undefined;
  }

  if (!response.ok) {
    const code = readServerCode(body);
    const policyCode = readServerPolicyCode(body);
    const retryAfterSeconds = readRetryAfter(response.headers);
    const extra: { policyCode?: HostedPasswordPolicyCode; retryAfterSeconds?: number } = {};
    if (policyCode !== undefined) extra.policyCode = policyCode;
    if (retryAfterSeconds !== undefined) extra.retryAfterSeconds = retryAfterSeconds;
    return failure(
      classifyFailure(response.status, code),
      response.status,
      readServerError(body),
      code,
      Object.keys(extra).length === 0 ? undefined : extra,
    );
  }

  // 🔴 2xx 但没有可解析的主体 = **不能当成功**。
  // 把这一步写成"没有就忽略"，会让"服务端返回了 HTML（比如反代配错）"
  // 看起来像"登录成功但令牌是空的" —— 而空的令牌会让同步静默失败。
  if (body === undefined) return failure('malformed-response', response.status);

  return { ok: true, body };
}

/** 发一次 POST。既有调用方全部走它，行为与重构前逐字相同。 */
async function postJson(
  options: HostedAuthOptions,
  path: string,
  payload: unknown,
): Promise<PostResult> {
  return sendJson(options, 'POST', path, payload);
}


/** 邮箱归一：服务端自己做格式校验（唯一事实源），这里只挡"空的"这一种。 */
function normalizedEmail(email: string): string | undefined {
  const trimmed = email.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** 从响应体里取出会话。缺任何一项都判 `malformed-response`。 */
function parseSession(body: unknown): HostedAuthSession | undefined {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const record = body as Record<string, unknown>;
  const token = record['token'];
  if (typeof token !== 'string' || token === '') return undefined;

  const user = record['user'];
  if (user === null || typeof user !== 'object' || Array.isArray(user)) return undefined;
  const userRecord = user as Record<string, unknown>;
  const id = userRecord['id'];
  const email = userRecord['email'];
  if (typeof id !== 'number' || typeof email !== 'string') return undefined;

  // 账号语言：可缺（老服务端 / 用户从未设置过）。集合外的值当缺失处理 ——
  // 它是"采纳建议"，不是必需要素，不值得为它判 malformed。
  const rawLocale = userRecord['locale'];
  const locale: HostedAuthLocale | undefined =
    rawLocale === 'zh-CN' || rawLocale === 'en' ? rawLocale : undefined;

  return { token, user: { id, email, ...(locale === undefined ? {} : { locale }) } };
}

/** options / credential 这类"宿主负责解释"的 JSON 对象。 */
function parsePasskeyObject(value: unknown): HostedPasskeyOptions | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as HostedPasskeyOptions;
}

// ── 登录链接（magic link）─────────────────────────────────────

/**
 * 发一封登录链接邮件。
 *
 * 🔴 服务端**永远**回同一句中性文案（防邮箱枚举），所以成功**不代表**
 * "该邮箱存在" —— 界面不许把它渲染成"已登录"。
 */
export async function requestMagicLink(
  options: HostedAuthOptions,
  email: string,
): Promise<HostedAuthOutcome<{ message: string }>> {
  const normalized = normalizedEmail(email);
  if (normalized === undefined) return failure('invalid-input');

  const result = await postJson(options, HOSTED_AUTH_PATHS.magicLinkRequest, {
    email: normalized,
    ...(options.locale === undefined ? {} : { locale: options.locale }),
  });
  if (!result.ok) return result;
  return { ok: true, message: readServerMessage(result.body) ?? '' };
}

/**
 * 注册新账号（只凭邮箱）。
 *
 * `termsAccepted` 只在**用户真的勾了**的时候才传 —— 服务端在这条字段上
 * 用的是 `z.literal(true)`，缺键即类型错误。我们**不替用户发明同意**
 * （服务端自己的注释写得很清楚：`Never invent an acceptance`）。
 *
 * 实例没提供法律页面时该字段是可选的，不传也能注册。
 */
export async function registerWithMagicLink(
  options: HostedAuthOptions,
  input: { email: string; termsAccepted?: boolean; inviteCode?: string },
): Promise<HostedAuthOutcome<{ message: string }>> {
  const normalized = normalizedEmail(input.email);
  if (normalized === undefined) return failure('invalid-input');

  const result = await postJson(options, HOSTED_AUTH_PATHS.magicLinkRegister, {
    email: normalized,
    ...(options.locale === undefined ? {} : { locale: options.locale }),
    ...(input.termsAccepted === undefined ? {} : { termsAccepted: input.termsAccepted }),
    // 🔴 邀请码**原样**发出去，不在客户端归一化：归一化只在
    // `@heyta/domain` 的 `normalizeInviteCode` 与服务端那一处发生。
    // 客户端多归一化一次的后果是"两端对同一个输入得到不同结论"。
    ...(input.inviteCode === undefined ? {} : { inviteCode: input.inviteCode }),
  });
  if (!result.ok) return result;
  return { ok: true, message: readServerMessage(result.body) ?? '' };
}

/**
 * 用登录链接里的令牌换会话。
 *
 * 🔴 这是**产出令牌的入口之一**。服务端把 JWT 放在响应体里（不发 cookie）。
 */
export async function verifyMagicLink(
  options: HostedAuthOptions,
  token: string,
): Promise<HostedAuthOutcome<{ session: HostedAuthSession }>> {
  const trimmed = token.trim();
  if (trimmed === '') return failure('invalid-input');

  const result = await postJson(options, HOSTED_AUTH_PATHS.magicLinkVerify, { token: trimmed });
  if (!result.ok) return result;

  const session = parseSession(result.body);
  if (session === undefined) return failure('malformed-response');
  return { ok: true, session };
}

/**
 * 验证邮箱。
 *
 * 这一步**不产出令牌**：它只是把账号标成已验证，之后用户还要走一次登录。
 * 界面必须如实区分"已验证"与"已登录"。
 */
export async function verifyEmailAddress(
  options: HostedAuthOptions,
  token: string,
): Promise<HostedAuthOutcome<{ message: string }>> {
  const trimmed = token.trim();
  if (trimmed === '') return failure('invalid-input');

  const result = await postJson(options, HOSTED_AUTH_PATHS.verifyEmail, { token: trimmed });
  if (!result.ok) return result;
  return { ok: true, message: readServerMessage(result.body) ?? '' };
}

/**
 * 从用户粘贴的东西里取出令牌。
 *
 * 接受两种输入，别的都返回 `undefined`：
 *   1. 完整/相对链接：`https://host/magic-login?token=abc`、`/verify-email?token=abc`
 *   2. 裸令牌：一封邮件里那串十六进制
 *
 * ⚠️ 这是**协议知识**（链接长什么样、参数叫什么），所以在这里而不在界面里。
 * 返回 `undefined` 是"这段文本里没有令牌"，不是错误 —— 界面据此提示用户重贴。
 */
export function extractAuthLinkToken(input: string): string | undefined {
  const trimmed = input.trim();
  if (trimmed === '') return undefined;

  const queryIndex = trimmed.indexOf('?');
  if (queryIndex !== -1) {
    for (const pair of trimmed.slice(queryIndex + 1).split('&')) {
      const eq = pair.indexOf('=');
      if (eq === -1) continue;
      if (pair.slice(0, eq) !== 'token') continue;
      const value = pair.slice(eq + 1);
      if (value === '') continue;
      try {
        return decodeURIComponent(value);
      } catch {
        // 非法百分号编码：原样返回比丢掉好 —— 服务端会给出权威判定。
        return value;
      }
    }
    return undefined;
  }

  // 裸令牌：带空白就不是令牌（多半是用户粘了一整段话）。
  if (/\s/.test(trimmed)) return undefined;
  return trimmed;
}

// ── 通行密钥（协议一半：取 options / 交 credential）──────────

/** 取注册 options。`credential` 由宿主用平台 API 产出，不在本层。 */
export async function beginPasskeyRegistration(
  options: HostedAuthOptions,
  input: { email: string; termsAccepted?: boolean; inviteCode?: string },
): Promise<HostedAuthOutcome<{ options: HostedPasskeyOptions }>> {
  const normalized = normalizedEmail(input.email);
  if (normalized === undefined) return failure('invalid-input');

  const result = await postJson(options, HOSTED_AUTH_PATHS.passkeyRegisterOptions, {
    email: normalized,
    ...(options.locale === undefined ? {} : { locale: options.locale }),
    ...(input.termsAccepted === undefined ? {} : { termsAccepted: input.termsAccepted }),
    ...(input.inviteCode === undefined ? {} : { inviteCode: input.inviteCode }),
  });
  if (!result.ok) return result;

  const passkeyOptions = parsePasskeyObject(result.body);
  if (passkeyOptions === undefined) return failure('malformed-response');
  return { ok: true, options: passkeyOptions };
}

/** 交回宿主产出的注册 credential。成功只表示"账号建好了"，**令牌还要登录拿**。 */
export async function completePasskeyRegistration(
  options: HostedAuthOptions,
  input: { email: string; credential: HostedPasskeyCredential; inviteCode?: string },
): Promise<HostedAuthOutcome<{ message: string }>> {
  const normalized = normalizedEmail(input.email);
  if (normalized === undefined) return failure('invalid-input');

  const result = await postJson(options, HOSTED_AUTH_PATHS.passkeyRegisterVerify, {
    email: normalized,
    credential: input.credential,
    // 🔴 **两次调用都要带**：服务端在 `verify` 那一步才拿到 User 行、
    // 也才绑定邀请（options 那次会收下但不用）。只带一次的后果是
    // "用通行密钥注册的人永远绑不上邀请码"，而那看起来只是"邀请没生效"。
    ...(options.locale === undefined ? {} : { locale: options.locale }),
    ...(input.inviteCode === undefined ? {} : { inviteCode: input.inviteCode }),
  });
  if (!result.ok) return result;
  return { ok: true, message: readServerMessage(result.body) ?? '' };
}

/** 取登录 options。 */
export async function beginPasskeyLogin(
  options: HostedAuthOptions,
  email: string,
): Promise<HostedAuthOutcome<{ options: HostedPasskeyOptions }>> {
  const normalized = normalizedEmail(email);
  if (normalized === undefined) return failure('invalid-input');

  const result = await postJson(options, HOSTED_AUTH_PATHS.passkeyLoginOptions, {
    email: normalized,
  });
  if (!result.ok) return result;

  const passkeyOptions = parsePasskeyObject(result.body);
  if (passkeyOptions === undefined) return failure('malformed-response');
  return { ok: true, options: passkeyOptions };
}

/** 交回登录 credential。**另一个产出令牌的入口。** */
export async function completePasskeyLogin(
  options: HostedAuthOptions,
  input: { email: string; credential: HostedPasskeyCredential },
): Promise<HostedAuthOutcome<{ session: HostedAuthSession }>> {
  const normalized = normalizedEmail(input.email);
  if (normalized === undefined) return failure('invalid-input');

  const result = await postJson(options, HOSTED_AUTH_PATHS.passkeyLoginVerify, {
    email: normalized,
    credential: input.credential,
  });
  if (!result.ok) return result;

  const session = parseSession(result.body);
  if (session === undefined) return failure('malformed-response');
  return { ok: true, session };
}

/** 申请恢复：让服务端把恢复链接发到邮箱。成功文案与登录链接同样是中性的。 */
export async function requestPasskeyRecovery(
  options: HostedAuthOptions,
  email: string,
): Promise<HostedAuthOutcome<{ message: string }>> {
  const normalized = normalizedEmail(email);
  if (normalized === undefined) return failure('invalid-input');

  const result = await postJson(options, HOSTED_AUTH_PATHS.passkeyRecoverRequest, {
    email: normalized,
    ...(options.locale === undefined ? {} : { locale: options.locale }),
  });
  if (!result.ok) return result;
  return { ok: true, message: readServerMessage(result.body) ?? '' };
}

/**
 * 登录态下把当前界面语言写回账号（`users.locale`）。
 *
 * 这是解析链第 2 层的**写侧**：登录响应带回 `user.locale` 是读侧。
 * 由语言切换器调用，**fire-and-forget**：失败不影响本机语言已切换 ——
 * 账号语言只是"下一次登录 / 下一封邮件"的建议值，不是本机状态的事实源。
 */
export async function updateAccountLocale(
  options: HostedAuthOptions,
  token: string,
  locale: HostedAuthLocale,
): Promise<HostedAuthOutcome<{ locale: HostedAuthLocale }>> {
  const trimmed = token.trim();
  if (trimmed === '') return failure('invalid-input');

  const result = await sendJson(
    options,
    'PUT',
    HOSTED_AUTH_PATHS.accountLocale,
    { locale },
    trimmed,
  );
  if (!result.ok) return result;
  return { ok: true, locale };
}

/**
 * 读侧带回的那一条判定。四个字段各自回答一个问题，**都不参与本机裁决**：
 * 本机只照 `needsReconfirm` 办事，`reason` 只决定界面怎么说（以及要不要说）。
 */
export const LEGAL_CONSENT_REASONS = [
  'current',
  'version-changed',
  'unprovable',
  'not-applicable',
] as const;

export type LegalConsentReason = (typeof LEGAL_CONSENT_REASONS)[number];

export interface LegalConsentStatus {
  readonly needsReconfirm: boolean;
  readonly reason: LegalConsentReason;
  /** 服务端当前那一版；`not-applicable` 时为 `null`（那台实例没有可宣告的版本）。 */
  readonly currentVersion: string | null;
  /** 服务端实际据以裁决的那一版；没有记录时 `null`。 */
  readonly recordedVersion: string | null;
}

/**
 * 解析响应形状：**任何不确定的形状都返回 `null`**（→ `malformed-response`，绝不当成功）。
 *
 * 🔴 `reason` 按**封闭词表**判，表外取值不认。这一处值得较真：把词表外的串
 * （服务端以后加的原因码、被反代改写的响应）当成"某种不需要确认的原因"，
 * 症状是**改版以后一个弹窗都不出现** —— 那正是这条机制存在的理由。
 * ⚠️ 与 `parsePrivacyConsent` 相反，这里**不接受**多余字段的宽松读法之外的任何东西：
 * `needsReconfirm` 必须是真布尔，缺字段就是 `null`。
 */
export function parseLegalConsentStatus(body: unknown): LegalConsentStatus | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const { needsReconfirm, reason, currentVersion, recordedVersion } = body as {
    needsReconfirm?: unknown;
    reason?: unknown;
    currentVersion?: unknown;
    recordedVersion?: unknown;
  };
  if (typeof needsReconfirm !== 'boolean') return null;
  if (typeof reason !== 'string' || !(LEGAL_CONSENT_REASONS as readonly string[]).includes(reason))
    return null;
  if (currentVersion !== null && typeof currentVersion !== 'string') return null;
  if (recordedVersion !== null && typeof recordedVersion !== 'string') return null;
  return {
    needsReconfirm,
    reason: reason as LegalConsentReason,
    currentVersion: (currentVersion ?? null) as string | null,
    recordedVersion: (recordedVersion ?? null) as string | null,
  };
}

/**
 * 重新确认的**读侧**：这台服务端问这个账号要"再看一次并确认"吗。
 *
 * 🔴 这一层**不做任何判定**。判定的事实源是服务端那一列指针与那张历史表
 * （`server/src/legal-recheck.ts`），因为客户端说不出服务端发布的是哪一版文本 ——
 * 它唯一能说的"我本机存过某版"恰恰是不可信的那一半。
 * `privacy-consent.ts` 文件头对设备级同意立过同一条分工（"版本化留痕由服务端承担"），
 * 这里是它在账号级的照搬。
 */
export async function getLegalConsentStatus(
  options: HostedAuthOptions,
  token: string,
): Promise<HostedAuthOutcome<LegalConsentStatus>> {
  const trimmed = token.trim();
  if (trimmed === '') return failure('invalid-input');

  const result = await sendJson(
    options,
    'GET',
    HOSTED_AUTH_PATHS.accountLegalConsent,
    undefined,
    trimmed,
  );
  if (!result.ok) return result;
  const status = parseLegalConsentStatus(result.body);
  if (status === null) return failure('malformed-response');
  return { ok: true, ...status };
}

/**
 * 重新确认的**写侧**：记下"他确认了界面上那一版"。
 *
 * `documentVersion` 必须是**服务端刚刚经读侧带回**的那一版，不是界面自己缓存的旧值 ——
 * 服务端逐字比对，不等就回 409 `version_mismatch`（理由见 `recordLegalReconfirm` 文件头：
 * 一条版本号写错的历史记录比没有记录更糟，它会被人当证据）。
 */
export async function confirmLegalConsent(
  options: HostedAuthOptions,
  token: string,
  documentVersion: string,
  acceptedAt: number,
): Promise<HostedAuthOutcome<{ recordedVersion: string }>> {
  const trimmed = token.trim();
  if (trimmed === '' || documentVersion === '') return failure('invalid-input');

  const result = await sendJson(
    options,
    'POST',
    HOSTED_AUTH_PATHS.accountLegalConsent,
    { documentVersion, acceptedAt },
    trimmed,
  );
  if (!result.ok) return result;
  const body = result.body as { recordedVersion?: unknown };
  if (typeof body.recordedVersion !== 'string') {
    return failure('malformed-response');
  }
  return { ok: true, recordedVersion: body.recordedVersion };
}

/** 用恢复链接里的令牌取新通行密钥的注册 options。 */
export async function getPasskeyRecoveryOptions(
  options: HostedAuthOptions,
  token: string,
): Promise<HostedAuthOutcome<{ email: string; options: HostedPasskeyOptions }>> {
  const trimmed = token.trim();
  if (trimmed === '') return failure('invalid-input');

  const result = await postJson(options, HOSTED_AUTH_PATHS.passkeyRecoverOptions, {
    token: trimmed,
  });
  if (!result.ok) return result;

  if (result.body === null || typeof result.body !== 'object' || Array.isArray(result.body)) {
    return failure('malformed-response');
  }
  const record = result.body as Record<string, unknown>;
  const email = record['email'];
  const passkeyOptions = parsePasskeyObject(record['options']);
  if (typeof email !== 'string' || passkeyOptions === undefined) {
    return failure('malformed-response');
  }
  return { ok: true, email, options: passkeyOptions };
}

/** 完成恢复：交回新通行密钥的 credential。同样不产出令牌。 */
export async function completePasskeyRecovery(
  options: HostedAuthOptions,
  input: { token: string; credential: HostedPasskeyCredential },
): Promise<HostedAuthOutcome<{ message: string }>> {
  const trimmed = input.token.trim();
  if (trimmed === '') return failure('invalid-input');

  const result = await postJson(options, HOSTED_AUTH_PATHS.passkeyRecoverComplete, {
    token: trimmed,
    credential: input.credential,
  });
  if (!result.ok) return result;
  return { ok: true, message: readServerMessage(result.body) ?? '' };
}

// ── 自助管理通行密钥（列 / 删）────────────────────────────────
//
// 服务端此前只有注册 / 登录 / 恢复，用户**没有任何自助管理凭据的能力**。
// 这两个函数是那半边的协议一侧：路径、方法、令牌怎么带、响应怎么验。
//
// 🔴 「最后一条能不能删」不是这里决定的 —— 服务端拒绝并给出
// `last_passkey_required`，这里只把它翻成 `last-passkey` 这个
// 结构化原因。把守卫写在客户端等于没有守卫（旧版本客户端、直接调 API 都绕过）。

/**
 * 一条通行密钥的**用户可见**投影。
 *
 * 🔴 只有这三个字段，**没有** `credentialId` / `publicKey`：
 * 这不是"服务端顺手少给"，而是接口契约 —— 列表接口不返回凭据内部数据。
 * 客户端连解析它们的代码都不该有。
 */
export interface HostedPasskeySummary {
  /** 服务端行 id。删除时用它，**不是** credential ID。 */
  id: string;
  /** ISO 8601 字符串（原样透传服务端，不在这里转 Date）。 */
  createdAt: string;
  /** ISO 8601 或 null（从未使用过）。 */
  lastUsedAt: string | null;
  /**
   * 用户自己起的名字；**没起过时为 `null`**。
   *
   * 界面据此回落到创建时间。刻意与空串区分：`''` 既不是名字、
   * 又会让"有没有名字"的判断失效，服务端因此把它归一成 `null`。
   */
  name: string | null;
}

/**
 * 只把服务端给的字段挑出来。缺任何一个都判 `malformed-response`。
 *
 * ⚠️ `name` 必须显式列进这个白名单。它是**新增**字段，而白名单的语义是
 * "服务端多给的字段不会流到界面上" —— 光靠服务端返回、不在这里挑，
 * 名字会**静默丢掉**，界面永远只显示回落值，而且没有任何测试会红
 * （这正是 `apps/web/tests/passkey-panel.spec.tsx` 里那条"改名之后
 * 列表里出现新名字"的用例要钉住的东西）。
 */
function parsePasskeySummaries(body: unknown): HostedPasskeySummary[] | undefined {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const list = (body as Record<string, unknown>)['passkeys'];
  if (!Array.isArray(list)) return undefined;

  const summaries: HostedPasskeySummary[] = [];
  for (const entry of list) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return undefined;
    const record = entry as Record<string, unknown>;
    const id = record['id'];
    const createdAt = record['createdAt'];
    const lastUsedAt = record['lastUsedAt'];
    const name = record['name'];
    if (typeof id !== 'string' || id === '') return undefined;
    if (typeof createdAt !== 'string' || createdAt === '') return undefined;
    if (lastUsedAt !== null && typeof lastUsedAt !== 'string') return undefined;
    // 老服务端不会有这个键 → `undefined`。那是"没名字"，不是畸形响应：
    // 服务端可能还没升级，而少一个可选字段不该让整个列表变成错误。
    if (name !== undefined && name !== null && typeof name !== 'string') return undefined;
    // 🔴 白名单映射：服务端哪天多返回一个字段，也**不会**流到界面上。
    summaries.push({ id, createdAt, lastUsedAt, name: typeof name === 'string' ? name : null });
  }
  return summaries;
}

/**
 * 列出当前账号的通行密钥。
 *
 * `token` 是访问令牌；空令牌**不发请求**（判 `unauthorized`）——
 * 未登录却去问服务端要一次 401 是没有意义的往返。
 */
export async function listPasskeys(
  options: HostedAuthOptions,
  token: string,
): Promise<HostedAuthOutcome<{ passkeys: HostedPasskeySummary[] }>> {
  const trimmed = token.trim();
  if (trimmed === '') return failure('unauthorized');

  const result = await sendJson(options, 'GET', HOSTED_AUTH_PATHS.passkeys, undefined, trimmed);
  if (!result.ok) return result;

  const passkeys = parsePasskeySummaries(result.body);
  // 2xx 但形状不对 → 不能当"没有凭据"。界面把空列表画成"还没有凭据"，
  // 一次反代配错就会让用户以为自己的凭据全没了。
  if (passkeys === undefined) return failure('malformed-response');
  return { ok: true, passkeys };
}

/**
 * 删除当前账号的一条通行密钥。
 *
 * 归属由服务端按令牌判定；本函数**不**发送任何"这是谁的"字段。
 * 404（不是自己的 / 不存在）与 409（最后一条）各有自己的
 * `HostedAuthFailureReason`，界面据此说不同的话。
 */
export async function deletePasskey(
  options: HostedAuthOptions,
  input: { token: string; id: string },
): Promise<HostedAuthOutcome<{ deleted: true }>> {
  const trimmedToken = input.token.trim();
  if (trimmedToken === '') return failure('unauthorized');
  const id = input.id.trim();
  if (id === '') return failure('invalid-input');

  const result = await sendJson(
    options,
    'DELETE',
    passkeyDeletePath(id),
    undefined,
    trimmedToken,
  );
  if (!result.ok) return result;

  return { ok: true, deleted: true };
}

/**
 * 给当前账号的一条通行密钥改名；`name: null`（或空串）表示**去掉名字**。
 *
 * 归属由服务端按令牌判定；本函数**不**发送任何"这是谁的"字段 ——
 * 与 `deletePasskey` 同一条纪律。
 *
 * 归一化（首尾空白、空串 → `null`）**只做在服务端**：客户端再写一遍
 * 就是第二个真相源，两处迟早对不上。这里原样送出去。
 *
 * ⚠️ 成功时**不返回**改名后的对象。界面的真相来自重新拉取列表
 * （`passkeysStore.rename` 之后会 `refresh()`）。在这里回传一份
 * "我以为服务端存了什么"的副本，只会多一个可能与服务端不一致的状态。
 */
export async function renamePasskey(
  options: HostedAuthOptions,
  input: { token: string; id: string; name: string | null },
): Promise<HostedAuthOutcome<{ renamed: true }>> {
  const trimmedToken = input.token.trim();
  if (trimmedToken === '') return failure('unauthorized');
  const id = input.id.trim();
  if (id === '') return failure('invalid-input');

  const result = await sendJson(
    options,
    'PATCH',
    passkeyPath(id),
    { name: input.name },
    trimmedToken,
  );
  if (!result.ok) return result;

  return { ok: true, renamed: true };
}

// ── 已认证地给当前账号「再加一条」凭据（协议一半）──────────────
//
// 🔴 为什么不是复用 `beginPasskeyRegistration`：服务端的公开注册完成端点对
// "email 已属于一个已验证账号"**故意**提前返回成功而**不写凭据**
// （防账号枚举）。已登录用户走那条路 = 界面说成功、凭据不存在。
// 而设置页在拒绝"删最后一条"时让用户"先添加一条新的" ——
// 用户照做后删掉旧的，就再也登不进去。
//
// 归属由**令牌**决定：这两个函数都不发送任何"这是谁的"字段
// （服务端从 JWT 取 userId）。这与 `deletePasskey` 是同一条纪律。
//
// 命名刻意不叫 `*Registration`：`beginPasskeyRegistration` 已经占了
// "注册一个新账号"的语义，同名会让调用方以为可以互相顶替。

/**
 * 取"给当前账号再加一条"的注册 options。
 *
 * 空令牌**不发请求**（判 `unauthorized`）—— 未登录却去要一次 401
 * 是没有意义的往返，与 `listPasskeys` 同一条 fail-safe。
 */
export async function beginPasskeyEnrollment(
  options: HostedAuthOptions,
  token: string,
): Promise<HostedAuthOutcome<{ options: HostedPasskeyOptions }>> {
  const trimmed = token.trim();
  if (trimmed === '') return failure('unauthorized');

  // 无请求体：options 的生成完全由令牌决定，客户端没有任何输入要带。
  const result = await sendJson(
    options,
    'POST',
    HOSTED_AUTH_PATHS.passkeyEnrollOptions,
    undefined,
    trimmed,
  );
  if (!result.ok) return result;

  const passkeyOptions = parsePasskeyObject(result.body);
  if (passkeyOptions === undefined) return failure('malformed-response');
  return { ok: true, options: passkeyOptions };
}

/**
 * 交回宿主产出的 credential，让服务端把它挂到当前账号上。
 *
 * 🔴 成功（`ok: true`）**就是**"凭据已经写进去了"：服务端只有在
 * `passkey.create` 真的成功之后才返回 2xx。调用方据此刷新列表，
 * 不要自造一个"看起来成功了"的乐观更新。
 */
export async function completePasskeyEnrollment(
  options: HostedAuthOptions,
  input: { token: string; credential: HostedPasskeyCredential },
): Promise<HostedAuthOutcome<{ message: string }>> {
  const trimmedToken = input.token.trim();
  if (trimmedToken === '') return failure('unauthorized');

  // 🔴 只发 `credential`。请求体里**没有** userId / email 这类归属字段：
  // 归属只由 Authorization 头上的令牌决定。服务端就算收到多余的键也会丢弃，
  // 但契约上我们连发都不发。
  const result = await sendJson(
    options,
    'POST',
    HOSTED_AUTH_PATHS.passkeyEnrollComplete,
    { credential: input.credential },
    trimmedToken,
  );
  if (!result.ok) return result;
  return { ok: true, message: readServerMessage(result.body) ?? '' };
}

// ── 邮箱 + 口令（W5：协议一侧的五个函数）──────────────────────
//
// 🔴 这五条路的**判定**都不在这里：长度、常见口令、泄露口令、失败计数与锁定、
// "账号不存在 / 没设口令 / 口令错"三者同码同句 —— 全部由服务端裁决
// （`server/src/password/`）。这一层只决定三件事：路径、请求里放哪些字段、
// 响应怎么归成 `HostedAuthOutcome`。判定写在客户端就是 §3.5 那份"每个宿主一套
// 业务语义"的复发，而四端不一致的认证判定等于四套账号系统。
//
// ⚠️ **这里刻意不跑口令策略**。`policyCode` 是服务端给的，界面按它取词条。
// 界面**可以**在提交前用共享契约那两个数先挡一下（少一次没必要的往返），
// 但那必须是**提示**而不是裁决 —— 客户端把一句 20 字符的 passphrase 判成"不合格"
// 是真实发生过的错法（NIST 禁止组成规则，而长度上限按码点算，UTF-16 数法会截断）。

/**
 * 注册（邮箱 + 口令）。
 *
 * 🔴 成功**不代表已登录**，也不代表"这个邮箱是你的"：服务端建号并把口令存好，
 * 但账号 `isVerified=0`，要等那封验证邮件。响应是一句中性的"去看收件箱"。
 * 邮箱已被占用时**同一句、同一个状态码** —— 所以这个端点不是邮箱存在性预言机，
 * 界面也不许把它渲染成"注册成功，登录好了"。
 *
 * `termsAccepted` 只在**用户真的勾了**时才发（服务端 `z.literal(true)`）——
 * 我们绝不替用户发明一次同意。
 *
 * 口令只做"非空"这一条本地检查：空串是一次没必要的往返，而"够不够长"属于裁决，
 * 归服务端（它给 `policyCode`）。
 */
export async function registerWithEmailPassword(
  options: HostedAuthOptions,
  input: { email: string; password: string; termsAccepted?: boolean; inviteCode?: string },
): Promise<HostedAuthOutcome<{ message: string }>> {
  const normalized = normalizedEmail(input.email);
  if (normalized === undefined) return failure('invalid-input');
  if (input.password === '') return failure('invalid-input');

  const result = await postJson(options, HOSTED_AUTH_PATHS.emailPasswordRegister, {
    email: normalized,
    password: input.password,
    ...(options.locale === undefined ? {} : { locale: options.locale }),
    ...(input.termsAccepted === undefined ? {} : { termsAccepted: input.termsAccepted }),
    // 与 `registerWithMagicLink` 同一条纪律：邀请码**原样**发出，客户端不归一化。
    ...(input.inviteCode === undefined ? {} : { inviteCode: input.inviteCode }),
  });
  if (!result.ok) return result;
  return { ok: true, message: readServerMessage(result.body) ?? '' };
}

/**
 * 登录（邮箱 + 口令）。**产出会话的第三条路**（另两条是魔法链接与通行密钥）。
 *
 * 🔴 响应形状与 `/login/passkey/verify` **同形**，所以这里复用同一个
 * `parseSession` —— 缺 `token` 或缺 `user.id/email` 都判 `malformed-response`，
 * **绝不当成功**（一枚空令牌会让同步静默失败，而那正是最难归因的形状）。
 *
 * 口令原样送出，**不在这里 normalize**：归一化（NFC + NFKC，按码点）只在服务端
 * 一处发生，且存的与验的都是它归一化后的串。客户端多归一化一次就是第二套规则，
 * 而那正是"同一句口令在两端字节不同"的生成方式。
 */
export async function loginWithEmailPassword(
  options: HostedAuthOptions,
  input: { email: string; password: string },
): Promise<HostedAuthOutcome<{ session: HostedAuthSession }>> {
  const normalized = normalizedEmail(input.email);
  if (normalized === undefined) return failure('invalid-input');
  if (input.password === '') return failure('invalid-input');

  const result = await postJson(options, HOSTED_AUTH_PATHS.emailPasswordLogin, {
    email: normalized,
    password: input.password,
  });
  if (!result.ok) return result;

  const session = parseSession(result.body);
  if (session === undefined) return failure('malformed-response');
  return { ok: true, session };
}

/**
 * 申请一封"重置口令"的邮件。
 *
 * 🔴 服务端**永远**回同一句中性文案 + **同一个状态码（200）**，连服务端异常时
 * 也回 200 —— 因为这条请求里含邮箱，只要状态码随"账号是否存在"变化，
 * 它就还是预言机（OWASP 点名的是状态码，不只是文案）。所以成功**不代表**
 * "该邮箱存在"，界面那句话只能是"如果我们认得这个邮箱，信已经发出去了"。
 *
 * 不发请求前唯一的本地检查是"邮箱非空"。
 */
export async function requestPasswordReset(
  options: HostedAuthOptions,
  email: string,
): Promise<HostedAuthOutcome<{ message: string }>> {
  const normalized = normalizedEmail(email);
  if (normalized === undefined) return failure('invalid-input');

  const result = await postJson(options, HOSTED_AUTH_PATHS.passwordForgot, {
    email: normalized,
    ...(options.locale === undefined ? {} : { locale: options.locale }),
  });
  if (!result.ok) return result;
  return { ok: true, message: readServerMessage(result.body) ?? '' };
}

/**
 * 用邮件链接里的一次性令牌换新口令。
 *
 * 🔴 成功**不发会话**（ADR-0040）。响应只有"去登录"那句中性话，界面据此把用户
 * 导向登录页 —— 不许在这里顺手换一枚令牌让流程"更顺"：重置成功的那一刻正是
 * 高风险时刻，而"持有收件箱"不等于"该拿到登录态"。
 *
 * 令牌原样送出（不 trim 中间、不改大小写）：形状规则属于签发方。
 * 查不到 / 过期 / 用过三种情况服务端给**同一个** `invalid_reset_link`。
 */
export async function resetPasswordWithToken(
  options: HostedAuthOptions,
  input: { token: string; password: string },
): Promise<HostedAuthOutcome<{ message: string }>> {
  const trimmed = input.token.trim();
  if (trimmed === '') return failure('invalid-input');
  if (input.password === '') return failure('invalid-input');

  const result = await postJson(options, HOSTED_AUTH_PATHS.passwordReset, {
    token: trimmed,
    password: input.password,
    // 这条**没有邮箱可查账号语言**，而正在填这张表的人手上就有当前语言。
    ...(options.locale === undefined ? {} : { locale: options.locale }),
  });
  if (!result.ok) return result;
  return { ok: true, message: readServerMessage(result.body) ?? '' };
}

/**
 * 已登录改口令。**当前设备换新会话、其余设备全部掉线**。
 *
 * 🔴 成功时**必须**把新会话换出去：`tokenVersion` 是全局计数器，bump 之后
 * 手上这枚也失效了。如果这里只回 `{message}`，症状就是"改个密码把自己的这个
 * 标签页也踢出去"，而界面刚说完"修改成功"。
 *
 * 两个口令字段都**不**在这里判强度：当前口令是老值（用户当年可能设得比现在松），
 * 对它套新规则会让"改密这件事本身"变成一条用新规则拒绝老口令的路。
 * 策略只跑在新口令上，服务端裁决、`policyCode` 给出具体的那一条。
 *
 * 空令牌**不发请求**（判 `unauthorized`）—— 与 `listPasskeys` 同一条 fail-safe。
 */
export async function changePassword(
  options: HostedAuthOptions,
  token: string,
  input: { currentPassword: string; newPassword: string },
): Promise<HostedAuthOutcome<{ session: HostedAuthSession }>> {
  const trimmedToken = token.trim();
  if (trimmedToken === '') return failure('unauthorized');
  if (input.currentPassword === '' || input.newPassword === '') return failure('invalid-input');

  const result = await sendJson(
    options,
    'POST',
    HOSTED_AUTH_PATHS.passwordChange,
    {
      currentPassword: input.currentPassword,
      newPassword: input.newPassword,
      ...(options.locale === undefined ? {} : { locale: options.locale }),
    },
    trimmedToken,
  );
  if (!result.ok) return result;

  const session = parseSession(result.body);
  if (session === undefined) return failure('malformed-response');
  return { ok: true, session };
}

/**
 * 已登录**给账号加上第一个口令**（纯通行密钥 / 魔法链接注册的账号）。
 *
 * 🔴 成功时**只有一句"设好了"**，没有会话：这条不 bump `tokenVersion`，
 * 手上那枚仍然有效。把它写成返回会话的形状会造出一个更糟的对称错误 ——
 * 调用方以为要换令牌，于是把界面上正在用的令牌换成一枚服务端没发过的，
 * 下一次同步 401。（`changePassword` 必须换，两条路的差别正在这里。）
 *
 * 为什么要有这条而不是"去走忘记密码"：`requestPasswordReset` 对**没有口令认证器**
 * 的账号刻意不发信（反枚举），所以对这类账号那是死路。少了这条路由，
 * 设置页里"设一个登录密码"那句话就是一句指向不存在的路的谎话。
 *
 * 本地只检查空串（省一次没必要的往返），强度归服务端裁决并给 `policyCode` ——
 * 与 `changePassword` 同一条纪律。
 */
export async function setInitialPassword(
  options: HostedAuthOptions,
  token: string,
  input: { newPassword: string },
): Promise<HostedAuthOutcome<{ message: string }>> {
  const trimmedToken = token.trim();
  if (trimmedToken === '') return failure('unauthorized');
  if (input.newPassword === '') return failure('invalid-input');

  const result = await sendJson(
    options,
    'POST',
    HOSTED_AUTH_PATHS.passwordSet,
    {
      newPassword: input.newPassword,
      ...(options.locale === undefined ? {} : { locale: options.locale }),
    },
    trimmedToken,
  );
  if (!result.ok) return result;
  return { ok: true, message: readServerMessage(result.body) ?? '' };
}
