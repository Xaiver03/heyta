/**
 * 认证的**纯逻辑**：失败原因 → 词条 key（唯一一份）
 * ==================================================
 *
 * ## 它收的是什么
 *
 * 「`HostedAuthFailureReason` → 一句人话」这条路此前在**两个壳里各写了一份**：
 *
 * | 位置 | 行数 |
 * |---|---|
 * | `apps/web/src/features/auth/AuthPanel.tsx` 的 `authFailureKey` | 内联在 484 行的组件里 |
 * | `apps/mobile/src/auth/failure-key.ts` | 403 行组件旁边的独立文件 |
 *
 * 后者的文件头自己就写着「与 `apps/web/.../AuthPanel.tsx` 的 `authFailureKey`
 * **同一职责**」。**两份同一职责的映射 = 两端可能对同一次失败说不同的话**，
 * 而认证恰恰是最不该漂移的那一块。
 *
 * ## 形状照谁：`packages/ui/src/sync/model.ts` 的 `SyncFailureMessageKey`
 *
 * 仓库**已经为"同步失败"做过一次一模一样的收编** —— 那份文件的注释写着
 * 「此前在两个壳里各写了一份……现在收在这里一份」。本文件是同一招用在认证上，
 * 连**命名空间的选择**都照它：共用词条用 `common.` 前缀，不叫 `web.` 也不叫 `mobile.`
 * （叫任何一端都等于宣称它属于那一端）。
 *
 * ## 🔴 为什么这里**不 import `@heyta/i18n`**
 *
 * `packages/ui` 里**没有任何一个文件** import 它 —— 连类型都不 import。
 * 理由写在多处（`capture/model.ts`、`habits/model.ts`、`empty-state/model.ts`…）：
 * **会拖进第二份 React**（本仓为此崩过一次，见 `index.ts` 的边界说明）。
 *
 * 所以这里只写**字符串字面量联合**：key 的正确性由**宿主侧的词条表类型系统**校验
 * （宿主 `t()` 的参数是 `MessageKey`，传错一个字面量就编译不过）。
 * 这是既有先例（`SyncFailureMessageKey` 的注释里也写明了这一条）。
 */

/**
 * 已知认证失败原因 → 共用词条 key。
 *
 * ⚠️ 这个联合**必须与下面的 `switch` 保持一一对应** —— 少了哪一条，
 * `authFailureMessageKey` 的穷尽性检查会在编译期报错。
 */
export type AuthFailureMessageKey =
  | 'common.auth.error.unconfigured'
  | 'common.auth.error.invalidInput'
  | 'common.auth.error.notAllowed'
  | 'common.auth.error.unauthorized'
  | 'common.auth.error.rateLimited'
  | 'common.auth.error.network'
  | 'common.auth.error.server'
  | 'common.auth.error.passkeyUnsupported'
  | 'common.auth.error.passkeyCancelled'
  | 'common.auth.error.passkeyAlreadyRegistered'
  | 'common.auth.error.passkeyNotFound'
  | 'common.auth.error.passkeyRejected'
  | 'common.auth.error.lastPasskey'
  | 'common.auth.error.unknown';

/**
 * 失败原因 → 词条 key。
 *
 * 🔴 这是**唯一**让 `HostedAuthFailureReason` 那个封闭集合变成句子的地方。
 *
 * ⚠️ **不用 `@heyta/app-host` 的 `HostedAuthFailureReason` 类型**：
 * 那会给 `packages/ui` 加一个它现在没有的依赖（今天只依赖
 * `design-system` + `domain`）。这里按**字符串**收，认不出来就落到 `unknown` ——
 * 这个模块的契约是"给我一个原因字符串，我给你一个 key"，
 * 而"哪些字符串是合法原因"由 app-host 那个封闭集合在**调用方**保证。
 *
 * ⚠️ `malformed-response` 刻意**没有**单独的词条：它意味着"服务端回了 2xx
 * 但响应体读不懂"，用户能做的与 `server-error` 完全一样（稍后重试），
 * 多给一句话只是多一处要翻译的字符串。它落到 `unknown`。
 * 这是**有意的合并**，不是漏了。
 */
export function authFailureMessageKey(reason: string | undefined): AuthFailureMessageKey {
  switch (reason) {
    case 'unconfigured':
      return 'common.auth.error.unconfigured';
    case 'invalid-input':
      return 'common.auth.error.invalidInput';
    case 'not-allowed':
      return 'common.auth.error.notAllowed';
    case 'unauthorized':
      return 'common.auth.error.unauthorized';
    case 'rate-limited':
      return 'common.auth.error.rateLimited';
    case 'network':
      return 'common.auth.error.network';
    case 'server-error':
      return 'common.auth.error.server';
    case 'passkey-unsupported':
      return 'common.auth.error.passkeyUnsupported';
    case 'passkey-cancelled':
      return 'common.auth.error.passkeyCancelled';
    case 'passkey-already-registered':
      return 'common.auth.error.passkeyAlreadyRegistered';
    // 设备上这条旧凭据服务端已经不认了 —— 说"重新注册 / 换登录方式"，
    // 而不是笼统的"登录没有完成"。
    case 'passkey-not-found':
      return 'common.auth.error.passkeyNotFound';
    // 凭据还在但断言没验过 —— 说"可以再试一次"，与上一条是两句不同的话。
    case 'passkey-rejected':
      return 'common.auth.error.passkeyRejected';
    // 这条原因也会从删除路径冒出来（最后一条被拒绝）。登录面板上不太可能
    // 出现，但封闭集合里必须有着落。
    case 'last-passkey':
      return 'common.auth.error.lastPasskey';
    default:
      return 'common.auth.error.unknown';
  }
}

/* ========================================================================
 * 二、旅程的**步骤**
 * ====================================================================== */

/**
 * 规范旅程里的步骤（`docs/plans/user-journey-and-auth.md` §3.2）。
 *
 * 🔴 它的价值不是"多一个枚举"，而是把**服务端的真实语义**变成有类型的步骤 ——
 * 那几条语义与直觉不同，而且**做错了不会报错**：
 *
 * | 步骤 | 真实语义 |
 * |---|---|
 * | `register` | **不发令牌**（`/register/*`、`/verify-email` 都只回 `{message}`） |
 * | `verify-email` | 只是把账号标成已验证，**仍然没有令牌** |
 * | `login` | **唯一发令牌的落点**（`verifyMagicLink` / `completePasskeyLogin`） |
 *
 * ⇒ 类型上就把"注册完就登录好了"这种误解排除掉：
 * `REGISTER_STEPS_WITHOUT_TOKEN` 明确列出**哪些步骤拿不到令牌**，
 * 界面据此必须提示"去邮箱点链接"，而不是显示"已登录"。
 */
export type AuthJourneyStep =
  | 'identify' // 填邮箱
  | 'register' // 注册（**不发令牌**）
  | 'verify-email' // 验证邮箱（**不发令牌**）
  | 'login' // 登录（**唯一发令牌**）
  | 'set-passphrase' // 设 E2EE 口令（同步必需）
  | 'ready'; // 可以用了

/**
 * **拿不到令牌**的步骤。
 *
 * 🔴 这是一条**能失败**的断言所用的清单：界面若在这些步骤之后显示"已登录"，
 * 就是本仓最忌讳的"界面说成功、功能没接上"。
 */
export const STEPS_WITHOUT_TOKEN: readonly AuthJourneyStep[] = ['identify', 'register', 'verify-email'];

/**
 * 「必须先勾选同意项」这条**本地校验**的 key。
 *
 * 🔴 它**不是**服务端返回的失败原因（服务端的 `termsAccepted` 是 `z.literal(true)`，
 * 缺了就 400）—— 它是**客户端自己先拦一下**，好在用户点下去之前就说清楚。
 * 之所以仍然放在同一个命名空间：用户看到的是同一类东西（"这次注册没成，因为…"），
 * 分成两个命名空间只会让"该翻哪张表"变成一道题。
 *
 * ⚠️ 句子本身必须保留"**这一项必须由你自己做出**"的意思 —— 同意是**用户的动作**，
 * 界面不许替他勾、也不许把它写成一句走过场的话。
 */
export const AUTH_TERMS_REQUIRED_KEY = 'common.auth.error.termsRequired' as const;

/** 这一步之后**已经有令牌**了吗。 */
export function hasTokenAfter(step: AuthJourneyStep): boolean {
  return step === 'login' || step === 'set-passphrase' || step === 'ready';
}