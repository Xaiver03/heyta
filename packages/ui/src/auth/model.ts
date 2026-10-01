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
 *
 * ⚠️ 与上面那条不冲突的一处 import：这个文件**确实** import
 * `@heyta/shared-schema` 的两个口令长度常量。理由与"为什么不 import i18n"是同一类
 * 判断 —— 那个包会拖进第二份 React，而 shared-schema 是纯契约（零 React、零平台代码），
 * 且它已经是 `@heyta/app-host` 的依赖、今天就在 RN 的图里。
 * 在这里 import 它换来的东西是：**句子里的数字与裁决它的那份数字是同一个**，
 * 而宿主拿不到"忘了填 `{min}`"这个选项。
 */

import {
  AUTH_PASSWORD_MAX_CODE_POINTS,
  AUTH_PASSWORD_MIN_CODE_POINTS,
} from '@heyta/shared-schema';

/**
 * 已知认证失败原因 → 共用词条 key。
 *
 * ⚠️ 这个联合与下面的 `switch` 要**一一对应**，但编译器**只盯得住一个方向**：
 * `switch` 返回了一个联合里没有的 key ⇒ 编译不过；反过来（联合里有一条、
 * `switch` 从不返回它，或某个 reason 掉进 `default` 的 `unknown`）**不会报错**。
 *
 * 🔴 所以穷尽性靠的是 `packages/ui/tests/auth-model.spec.ts` 那张**原因快照表**：
 * 它逐个断言"每一条已知原因落到具体的那一条，不是 `unknown`"。
 * 原来这里写的是"穷尽性检查会在编译期报错" —— 那句是错的（2026-10-01 核过：
 * 函数有 `default`，编译期根本不可能不穷尽）。
 */
export type AuthFailureMessageKey =
  | 'common.auth.error.unconfigured'
  | 'common.auth.error.invalidInput'
  | 'common.auth.error.notAllowed'
  | 'common.auth.error.unauthorized'
  | 'common.auth.error.rateLimited'
  | 'common.auth.error.requestRejected'
  | 'common.auth.error.network'
  | 'common.auth.error.server'
  | 'common.auth.error.passkeyUnsupported'
  | 'common.auth.error.passkeyCancelled'
  | 'common.auth.error.passkeyAlreadyRegistered'
  | 'common.auth.error.passkeyNotFound'
  | 'common.auth.error.passkeyRejected'
  | 'common.auth.error.lastPasskey'
  | 'common.auth.error.passkeyNameTooLong'
  | 'common.auth.error.invalidCredentials'
  | 'common.auth.error.emailNotVerified'
  | 'common.auth.error.passwordLocked'
  | 'common.auth.error.passwordLockedWithWait'
  | 'common.auth.error.passwordBackendBusy'
  | 'common.auth.error.invalidResetLink'
  | 'common.auth.error.noPasswordSet'
  /** 账号**已有**口令 ⇒ 走「修改密码」，不是「设置登录密码」。与上一条相反。 */
  | 'common.auth.error.passwordAlreadySet'
  | 'common.auth.error.passwordPolicy'
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
 *
 * `extra.retryAfterSeconds` 只有 `password-locked` 会读：有秒数就说"等 N 秒"，
 * 没有就只说换路。**不能把 `undefined` 当 0** —— 那会让界面显示"再等 0 秒"。
 */
export function authFailureMessageKey(
  reason: string | undefined,
  extra?: { retryAfterSeconds?: number },
): AuthFailureMessageKey {
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
    case 'request-rejected':
      return 'common.auth.error.requestRejected';
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
    case 'passkey-name-too-long':
      return 'common.auth.error.passkeyNameTooLong';
    // 🔴 与 `unauthorized` 是两句不同的话：那条的动作是"重新发起一次登录"，
    // 这条的动作是"重打一遍"。混用会让人去点一个已经过期的链接。
    case 'invalid-credentials':
      return 'common.auth.error.invalidCredentials';
    // 口令**验对了**。这句必须说清那一点，否则用户会反复重打同一个正确口令。
    case 'email-not-verified':
      return 'common.auth.error.emailNotVerified';
    case 'password-locked': {
      const seconds = extra?.retryAfterSeconds;
      // 没有秒数就只给换路的那半句 —— 拼一个"等 undefined 秒"是界面谎报。
      return seconds === undefined || seconds <= 0
        ? 'common.auth.error.passwordLocked'
        : 'common.auth.error.passwordLockedWithWait';
    }
    // 是我们的容量问题，不是用户发得太猛 —— 所以这句不许与 `rate-limited` 共用。
    case 'password-backend-busy':
      return 'common.auth.error.passwordBackendBusy';
    // 动作是"回去重新申请一封"，不是"重新认证一次"（后者会重放用过的链接）。
    case 'invalid-reset-link':
      return 'common.auth.error.invalidResetLink';
    // CTA 与上一条**相反**：这条是"这个账号还没有口令，去设一个"，
    // 那条是"回去重新点一次链接"。🔴 不许写成"去走忘记密码" —— 那条路对
    // 没有口令认证器的账号**刻意不发信**，照做只会得到一个"没收到邮件"。
    case 'no-password-set':
      return 'common.auth.error.noPasswordSet';
    // 与上一条互为反面：这个账号**已经有**口令 ⇒ 该走"修改密码"（两张不同表单）。
    case 'password-already-set':
      return 'common.auth.error.passwordAlreadySet';
    // 具体哪一条由 `passwordPolicyMessageKey` 给；这里只兜"服务端没给 policyCode"。
    case 'password-policy':
      return 'common.auth.error.passwordPolicy';
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

/* ========================================================================
 * 三、`policyCode` → 词条（口令被拒时**具体哪一条**）
 * ====================================================================== */

/**
 * 策略码 → 词条 key。
 *
 * 🔴 为什么还要第二层：四种拒绝的状态码与 `code` 完全相同（400 +
 * `password_policy_violation`），而用户的动作四种都不同（加长 / 缩短 / 换一句 /
 * 这句已经在泄露库里）。只说"口令不符合要求"而不给动作，等于没说。
 *
 * ⚠️ 认不出来（服务端以后加了新码）就落回那句统称 `common.auth.error.passwordPolicy`。
 * 这里**不许**"照原样把码拼进 key"：那等于让服务端的一个新取值直接决定界面说哪句话，
 * 而没人给它写过词条 —— 症状是界面上冒出一行 `common.auth.policy.xyz`。
 */
export type AuthPolicyMessageKey =
  | 'common.auth.policy.tooShort'
  | 'common.auth.policy.tooLong'
  | 'common.auth.policy.tooCommon'
  | 'common.auth.policy.breached'
  | 'common.auth.error.passwordPolicy';

export function passwordPolicyMessageKey(policyCode: string | undefined): AuthPolicyMessageKey {
  switch (policyCode) {
    case 'too_short':
      return 'common.auth.policy.tooShort';
    case 'too_long':
      return 'common.auth.policy.tooLong';
    case 'too_common':
      return 'common.auth.policy.tooCommon';
    case 'breached':
      return 'common.auth.policy.breached';
    default:
      return 'common.auth.error.passwordPolicy';
  }
}

/** 这句话该带上限那个数吗（`too_long` 要，其余不要 —— 带错数字比不带更糟）。 */
export function policyMentionsMax(policyCode: string | undefined): boolean {
  return policyCode === 'too_long';
}

/* ========================================================================
 * 四、表单的**两步**（一个邮箱框 + 「继续」，口令紧随其后）
 * ====================================================================== */

/**
 * 表单阶段。
/**
 * 词条的插值参数。**不 import `@heyta/i18n` 的 `MessageVars`**（理由见文件头），
 * 与它**同形**（不是 `Readonly` —— 那个是可变索引签名，包一层只会有人再解一次），
 * 宿主侧 `t(key, vars)` 直接吃得下。
 */
export type AuthMessageVars = Record<string, string | number>;

/**
 * 失败 → **该说的那句话 + 句子里要填的数**。
 *
 * 🔴 这个函数存在的理由是 `authFailureMessageKey` 的一个**真实缺陷形态**：
 * 它只交 key，而三条词条带占位符（`{min}` / `{max}` / `{seconds}`）。
 * 宿主只拿 key、忘了填数时**不会报错** —— `@heyta/i18n` 缺变量时刻意
 * **保留原占位符**（那是为了"漏填一眼看得见"的取向，方向正确），
 * 于是界面上印出"或者等 {seconds} 秒后再试密码"。
 * 2026-10-01 实测 web 的 `AuthPanel.tsx:370` 与 `PasswordPanel.tsx:130`
 * **两处都漏了** `{seconds}`。
 *
 * ⇒ key 与 vars 由同一个函数交出，宿主就没有"只拿一半"这个选项。
 * `authFailureMessageKey` 保留：它是纯映射，`packages/ui/tests/auth-model.spec.ts`
 * 那张原因快照表直接吃它，而且不带占位符的那些原因本来就不需要第二个返回值。
 *
 * ⚠️ `password-policy` 只在**带 `policyCode`** 时才走策略那句 ——
 * 服务端没给码（老服务端 / 未来加了新码）时落回统称，这是
 * `passwordPolicyMessageKey` 已有的纪律，这里不改变它。
 */
export function authFailureMessage(failure: {
  reason?: string;
  policyCode?: string;
  retryAfterSeconds?: number;
}): { key: AuthFailureMessageKey | AuthPolicyMessageKey; vars?: AuthMessageVars } {
  const { reason, policyCode, retryAfterSeconds } = failure;

  if (reason === 'password-policy' && policyCode !== undefined) {
    const key = passwordPolicyMessageKey(policyCode);
    // 🔴 只有这两条带数字，其余两条（太常见 / 已泄露）说的是动作、不是区间 ——
    //    给它们塞 `{min}` 会让一句本不需要数字的话开始依赖数字。
    if (policyCode === 'too_short') {
      return { key, vars: { min: AUTH_PASSWORD_MIN_CODE_POINTS } };
    }
    if (policyCode === 'too_long') {
      return { key, vars: { max: AUTH_PASSWORD_MAX_CODE_POINTS } };
    }
    return { key };
  }

  if (reason === 'password-locked' && retryAfterSeconds !== undefined && retryAfterSeconds > 0) {
    return {
      key: 'common.auth.error.passwordLockedWithWait',
      vars: { seconds: retryAfterSeconds },
    };
  }

  return { key: authFailureMessageKey(reason, { retryAfterSeconds }) };
}

 *
 * 🔴 它**不是** `AuthJourneyStep` 的别名，两件事不同层次：
 * `AuthJourneyStep` 说的是**协议走到了哪一步**（注册不发令牌、验证邮箱也不发令牌…），
 * 这里说的是**屏幕上此刻有几个字段**。把两者合成一个枚举，就会出现在
 * "阶段=credential"时以为"已经登录好了"的那类错觉 —— 而那正是 §10.1 要防的漂移。
 */
export type AuthFormStage = 'identify' | 'credential';

/** 表单此刻在做什么。**一个 affordance 同时管注册与登录**（FIDO 2023 UX Guidelines）。 */
export type AuthFormMode = 'sign-in' | 'register';

/**
 * 点「继续」之后落在哪个阶段。
 *
 * 唯一的判据是"邮箱里有没有东西"：空串不算"填错了"，也不许前进 ——
 * 前进到一个没有身份的口令框，用户下一步只能瞎猜这是在给哪个账号设口令。
 * 除此之外**不做任何格式裁决**：邮箱是否合法由服务端说（它才是裁决者），
 * 而在用户还没按下「继续」之前就飘红，是 NNG 与 GOV.UK 都反对的那种即时校验。
 */
export function authFormStageAfterContinue(input: {
  stage: AuthFormStage;
  email: string;
}): AuthFormStage {
  if (input.stage === 'credential') return 'credential';
  return input.email.trim() === '' ? 'identify' : 'credential';
}

/**
 * 邮箱框的 `autocomplete`。
 *
 * 🔴 `'username webauthn'` 是 **FIDO 的混合登录标记**：它同时允许密码管理器填口令、
 * 也让浏览器在这个字段上提议通行密钥。RN 的类型联合里**没有**这一串
 * （那份联合早于 WebAuthn 的 autofill 规范），所以这里把它作为**唯一的 cast 点**
 * 交出去，理由写在调用处 —— 原生端会忽略这个字符串，web 端（react-native-web 把
 * `autoComplete` 原样落到 DOM 的 `autocomplete`）才是它起作用的地方。
 */
export const AUTH_EMAIL_AUTOCOMPLETE = 'username webauthn' as string;

/**
 * 口令框的 `autocomplete`。
 *
 * 🔴 这两个值**不是**可选项而是功能：写错一个，浏览器就会把**旧口令**填进
 * "注册新账号"那个框里（`current-password` 用在新口令字段上是最常见的错法），
 * 用户看到的现象是"我明明填了新口令却注册失败"。
 * 也**不许**退化成 `on` —— 那一档既不触发管理器也不触发强口令建议。
 */
export function passwordAutocomplete(mode: AuthFormMode): 'current-password' | 'new-password' {
  return mode === 'sign-in' ? 'current-password' : 'new-password';
}

/**
 * 显隐开关的**默认档**：桌面默认遮住，移动默认显示。
 *
 * 依据是 NNG《Stop Password Masking》与 NIST 的一致结论 —— 遮罩防的是肩窥，
 * 而手机几乎没有肩窥场景、却有很强的单手输入错字场景。
 * 两档都**保留**开关本身：默认值不是能力。
 */
export function defaultPasswordRevealed(platform: 'desktop' | 'mobile'): boolean {
  return platform === 'mobile';
}

/** 表单上的字段（错误落点与焦点去向用同一个词表，不用字符串到处飞）。 */
export type AuthFormField = 'baseUrl' | 'email' | 'password' | 'terms' | 'invite' | 'token';

/**
 * 第一个出错的字段 —— 界面据此把焦点移过去（GOV.UK 的校验模式）并标 `aria-invalid`。
 *
 * 顺序是**表单从上到下的视觉顺序**，不是"哪个错误更严重"：焦点跳到一个
 * 用户视线不在那里的字段，比不跳更糟。
 */
export function firstAuthErrorField(input: {
  baseUrlMissing: boolean;
  emailMissing: boolean;
  passwordMissing: boolean;
  termsMissing: boolean;
}): AuthFormField | undefined {
  if (input.baseUrlMissing) return 'baseUrl';
  if (input.emailMissing) return 'email';
  if (input.passwordMissing) return 'password';
  if (input.termsMissing) return 'terms';
  return undefined;
}

/* ========================================================================
 * 五、两个秘密的**命名**（本轮最大的认知风险）
 * ====================================================================== */

/**
 * 「登录密码」与「加密口令」是**两个不同的东西**，各自一条独立词条。
 *
 * 🔴 绝不共用一个"密码"字样：一句话同时指两样东西的界面，会让用户以为
 * 忘了登录密码也就忘了数据 —— 而前者点一封邮件就能重置，后者**不可恢复**。
 * 这两条 key 的存在本身就是一堵墙：谁想合并，就得先删掉一条并解释为什么。
 */
export const SIGN_IN_PASSWORD_LABEL_KEY = 'common.auth.signInPassword.label' as const;
export const E2EE_PASSPHRASE_LABEL_KEY = 'common.auth.e2eePassphrase.label' as const;