/**
 * 注册 / 登录面板（移动端）
 * ==========================
 *
 * 这是规范 §3.2 那一段旅程的移动端落点。此前移动端**完全没有**这个界面：
 * 「我的」页只有三个手填输入框（服务器地址 / 访问令牌 / 口令），而没有任何
 * 地方告诉用户令牌从哪来 —— 全库 `grep` 认证关键词只命中注释，
 * `@heyta/app-host` 的 `hosted-auth` 是 **0 调用方**。
 *
 * ## 分层（AGENTS.md §3.5）：这里**没有一行协议知识**
 *
 *   - 端点、请求体、凭据字段、失败归类、`termsAccepted` 的语义 →
 *     `@heyta/app-host` 的 `hosted-auth.ts`；
 *   - "链接里的哪一段是令牌" → 同处的 `extractAuthLinkToken`；
 *   - "先当登录令牌试、不成立再当验证令牌试" → `src/auth/paste.ts`；
 *   - 失败原因 → 句子（**连同句子里要填的那个数字**）→ **`@heyta/ui` 的
 *     `authFailureMessage`**（唯一一份，与 web 共用；命名空间 `common.auth.error.*`
 *     与 `common.auth.policy.*`）。不给"只拿 key 不填 vars"留空间：那样屏幕上
 *     会印出字面量 `{min}` / `{seconds}`，而这不会报错；
 *   - 「这一次点击缺的是哪一栏」的**先后** → 同处的 `firstAuthErrorField`。
 *     顺序与归类都不在这里重写 —— 重写一次就
 *     多一套规则，而四端不一致的认证判定等于四套账号系统（AGENTS §3.5）；
 *   - 拿到会话之后要做什么 → `src/auth/session.ts`。
 *
 * 本文件只做两件事：**把状态渲染成句子**、**收集用户输入**。
 * 这也是它能在两个宿主（欢迎页 / 「我的」页）里复用的原因。
 *
 * ## 🔴 四条不许违反的口径
 *
 *   1. **中性文案**（规范 §2-A2）：注册可能是"假成功"（邮箱已属已验证账号时，
 *      服务端**故意**回成功而不写凭据）。所以这里**不出现**"账号已创建"这类断言。
 *   2. **同意项由用户自己勾**（规范 §2-A4）：初值 `false`，未勾时**不发注册请求**，
 *      并且明说为什么 —— 而不是让服务端回一个 400。
 *   3. **通行密钥不支持时要说出来**（规范 §3.2 ②a 那条分支仍然要在）：
 *      这台设备今天没有 WebAuthn 实现（见 `src/auth/passkey-host.ts`），
 *      但按钮**不禁用**：禁用了却不说，用户只会以为界面坏了。
 *   4. **两个秘密不共用一个字段**：「登录密码」与「端到端加密口令」是两个 state、
 *      两个输入框。把口令注册/登录发出去的那一份接到 E2EE 那个 state 上，
 *      等于把**设计上不该离开设备的秘密**发上服务端；反方向接错的症状是
 *      "能登录、同步却解不开自己的数据"。两条路都必须显式命名，
 *      判据钉在 `tests/auth-screen-password.spec.ts`。
 */

import React, { useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import {
  beginPasskeyLogin,
  beginPasskeyRegistration,
  completePasskeyLogin,
  completePasskeyRegistration,
  loginWithEmailPassword,
  registerWithEmailPassword,
  requestMagicLink,
  registerWithMagicLink,
  resolveLegalLinks,
  verifyEmailAddress,
  verifyMagicLink,
  type HostedAuthFailure,
  type HostedAuthFailureReason,
  type HostedAuthSession,
  type HostedPasskeyCredential,
} from '@heyta/app-host';
import { useI18n, type MessageKey, type MessageVars } from '@heyta/i18n';

import { Button, Card, Checkbox, Screen, SectionHeader, Text, TextField } from '../ui/kit';
import { useTokens } from '../theme';
import { syncNow } from '../sync/store';
import {
  AUTH_TERMS_REQUIRED_KEY,
  E2EE_PASSPHRASE_LABEL_KEY,
  SIGN_IN_PASSWORD_LABEL_KEY,
  authFailureMessage,
  defaultPasswordRevealed,
  firstAuthErrorField,
  type AuthFormMode,
  type AuthFormField,
} from '@heyta/ui';
import { describePasskeyError, resolvePasskeyProvider } from '../auth/passkey-host';
import { redeemPastedAuthToken } from '../auth/paste';
import { saveAuthSession } from '../auth/session';
import { requireNetworkConsent } from '../privacy/consent-ui';

/** 正在跑的那件事。只为了在按钮上画菊花 + 让"哪一步在忙"可读。 */
type AuthAction =
  | 'password-login'
  | 'password-register'
  | 'magic-login'
  | 'magic-register'
  | 'passkey-login'
  | 'passkey-register'
  | 'verify'
  | 'save';

/**
 * 面板的状态机。
 *
 * 🔴 `session` 是**独立的一档**，不是 `idle` 加一个 token 字段：
 * "已经拿到令牌但还没填口令"在规范 §3.2 里是**第 ④ 步**，
 * 界面必须停在那里等用户，而不是悄悄当成"还没登录"（那会让用户
 * 再走一遍注册/登录）或当成"已完成"（那会让同步带着空口令失败）。
 */
type Phase =
  | { kind: 'idle' }
  | { kind: 'busy'; action: AuthAction }
  /** 中性提示：注册/登录链接已发出、邮箱已验证。**不是成功断言**。 */
  | { kind: 'notice'; key: MessageKey }
  /**
   * 失败。`vars` 只为策略那几条存在（「至少要 {min} 个字符」不填数字
   * 就等于把 `{min}` 印在界面上）。
   */
  | { kind: 'failed'; key: MessageKey; vars?: MessageVars }
  | { kind: 'session'; session: HostedAuthSession };

export interface SavedAuthSession {
  serverUrl: string;
  token: string;
  password: string;
  email: string;
}

export interface AuthScreenProps {
  onBack: () => void;
  /** 同步设置里的服务端地址 —— 认证与同步**必须**指向同一个服务端。 */
  initialServerUrl: string;
  /** 已经填过的 E2EE 口令（有的话不必让用户再输一遍）。 */
  initialPassword: string;
  /** 会话已经写进活配置、同步已经触发。宿主据此离开本屏。 */
  onSignedIn: (saved: SavedAuthSession) => void;
}

export function AuthScreen({
  onBack,
  initialServerUrl,
  initialPassword,
  onSignedIn,
}: AuthScreenProps): React.JSX.Element {
  const { t, locale } = useI18n();
  const tokens = useTokens();

  const [serverUrl, setServerUrl] = useState(initialServerUrl);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState(initialPassword);
  /**
   * 🔴 **登录密码** —— 与上面那个 `password`（端到端加密口令）**是两个秘密**。
   * 这一个会离开设备（发给服务端验 Argon2id），那一个永远不离开；
   * 忘了这一个可以点「忘记密码」重置，忘了那一个数据**不可恢复**。
   * 两者共用一个 state 的代价不是不好看，是**把不该出设备的秘密发上服务端**。
   */
  const [loginPassword, setLoginPassword] = useState('');
  /**
   * 显隐开关的**默认档**取自共享层（移动默认明文、桌面默认遮住），
   * 依据是 NNG 与 NIST 的一致结论：手机几乎没有肩窥场景，却有很强的单手错字场景。
   * ⚠️ 默认值不是能力 —— 开关本身必须在。
   */
  const [passwordRevealed, setPasswordRevealed] = useState(defaultPasswordRevealed('mobile'));
  const [pasted, setPasted] = useState('');
  /**
   * 🔴 初值**必须**是 `false`。规范 §2-A4：服务端在 `termsAccepted` 上用的是
   * `z.literal(true)`，我们**不替用户发明同意**。预勾就是发明。
   */
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  const busy = phase.kind === 'busy';
  const action = phase.kind === 'busy' ? phase.action : undefined;
  const session = phase.kind === 'session' ? phase.session : undefined;

  /** 这台设备有没有通行密钥实现。没有时**如实说**，而不是把按钮藏起来。 */
  const passkeyProvider = resolvePasskeyProvider();

  /**
   * 勾选框旁边两条条款链接的地址。分流规则在 `@heyta/app-host` 的 `legal-links.ts`
   * ——「哪份文本适用于这台服务端」是协议知识，四个壳各写一遍必然漂移（AGENTS §3.5）。
   */
  const legalLinks = resolveLegalLinks(serverUrl, locale);

  /**
   * 打开一条外部链接。
   *
   * 🔴 用 `Linking` 而不是 RN 内建 `<Text onPress>` 的隐式行为：系统浏览器是唯一
   * 合理的载体（条款是给读的，而壳里没有第二个渲染器），但**打开失败必须看得见** ——
   * 没有浏览器 / 被系统拦截时静默什么都不发生，用户会以为界面卡住。
   * ⚠️ **不**把 `canOpenURL()` 加进来当预检：iOS 13+ 要在 Info.plist 里逐 scheme 登记
   * `LSApplicationQueriesSchemes` 才查得到，没登记时它恒返回 false，
   * 于是"能不能打开"这个判断会变成一台设备的 Info.plist 决定的假红 ——
   * 直接 `openURL()` 失败再说话，才是两端一致的口径。
   */
  const openLegalLink = (href: string): void => {
    Linking.openURL(href).catch(() => {
      failWithKey('mobile.auth.link.unopenable');
    });
  };

  const fail = (reason: HostedAuthFailureReason): void => {
    const message = authFailureMessage({ reason });
    failWithKey(message.key, message.vars);
  };

  /**
   * 直接在界面上说一句话，**不走** `HostedAuthFailureReason`。
   *
   * 🔴 只有"未勾同意项"用它，而且这是**刻意的**：那个原因集合是**协议**的
   * 失败集合（服务端会怎么回答），而"你没勾同意项"是**本地**的输入问题 ——
   * 它甚至没发出请求。把它塞进协议集合会污染那份封闭清单，
   * 也会让 app-host 对这个纯界面状态负责。
   */
  const failWithKey = (key: MessageKey, vars?: MessageVars): void => {
    setPhase(vars === undefined ? { kind: 'failed', key } : { kind: 'failed', key, vars });
  };

  /**
   * 带**上下文**的失败。
   *
   * 🔴 两条不许塌成一条，而这两条**都不在这里判**：
   *   · `password-policy` 的四种拒绝（太短 / 太长 / 太常见 / 已在泄露库）
   *     状态码与 `code` **完全相同**，而用户要做的动作四种都不同 ——
   *     只说"不符合要求"等于没说；
   *   · `password-locked` 有秒数就说"等 N 秒"，没有就只说换别的路，
   *     **不能把 `undefined` 当 0** —— 那会显示成"再等 0 秒"。
   * 两半（句子 + 句子里要填的数）由共享层 `authFailureMessage` **一次交出**：
   * 分两次拿就有"只拿了句子、忘了填数"的空间，而那不会报错 —— `translateIn`
   * 在 vars 缺省时原样保留占位符，屏幕上就是字面量 `{min}` / `{seconds}`。
   * web 的两处面板真实漏过这个形状，所以这里从一开始就不给第二次机会。
   */
  const failFrom = (failure: HostedAuthFailure): void => {
    const message = authFailureMessage(failure);
    failWithKey(message.key, message.vars);
  };

  /**
   * 这一次点击**缺**的是哪一栏（`undefined` = 齐了，可以出门）。
   *
   * 🔴 先后顺序取自共享层的 `firstAuthErrorField`，**不在这里重写**：
   *    重写一次就有了第二套规则，症状是"web 让你前进、移动端不让你"那种两端不一致。
   * ⚠️ 口令只判**空串**（空串是一次没必要的往返）。长度与常见度归服务端裁决并
   *    给 `policyCode` —— 客户端提前按长度拒绝一句 20 字符的口令是 NIST 明令禁止的
   *    组成规则，而且这个屏**没有** `maxLength`，静默截断口令是更糟的错法。
   * ⚠️ `termsMissing` 只在**注册**这条路成立：登录不需要重新同意一次，
   *    把同意项挡在登录前面会让老用户以为自己被登出了。
   */
  const missingField = (mode: AuthFormMode): AuthFormField | undefined =>
    firstAuthErrorField({
      baseUrlMissing: serverUrl.trim() === '',
      emailMissing: email.trim() === '',
      // 🔴 这里是 `loginPassword`（要发出去的那一个），不是 `password`（E2EE 口令）。
      passwordMissing: loginPassword === '',
      termsMissing: mode === 'register' && !termsAccepted,
    });

  /** 缺的那一栏怎么说。句子在词条表里，这里只给落点。 */
  const missingFieldKey = (field: AuthFormField): MessageKey => {
    if (field === 'baseUrl') return 'common.auth.error.unconfigured';
    if (field === 'email') return 'common.auth.form.emailRequired';
    if (field === 'password') return 'common.auth.form.passwordRequired';
    return AUTH_TERMS_REQUIRED_KEY;
  };

  const options = { baseUrl: serverUrl, locale };

  /**
   * 注册（邮箱 + 密码）—— 现在这是**主路**。
   *
   * 🔴 未勾同意项时**一个请求都不发**（`missingField('register')` 就把 `terms`
   *    报出来），而且说清为什么 —— 不是让服务端回一个 400。
   * ⚠️ 成功后那句是**中性**的：服务端对"邮箱已被占用"回同一句、同一个状态码，
   *    所以这里不能写"账号已创建"（规范 §2-A2）。
   */
  const registerWithPassword = async (): Promise<void> => {
    const missing = missingField('register');
    if (missing !== undefined) return failWithKey(missingFieldKey(missing));
    if (!requireNetworkConsent()) return;
    setPhase({ kind: 'busy', action: 'password-register' });
    const result = await registerWithEmailPassword(options, {
      email,
      password: loginPassword,
      termsAccepted: true,
    });
    if (!result.ok) return failFrom(result);
    setPhase({ kind: 'notice', key: 'mobile.auth.sent.register' });
  };

  /**
   * 登录（邮箱 + 密码）—— **产出会话的第三条路**（另两条是魔法链接与通行密钥）。
   *
   * 拿到会话之后仍然**停在** `session` 那一档等端到端加密口令（规范 §3.2 第 ④ 步）：
   * 登录成功不等于同步可用，那是两件事、两个秘密。
   */
  const loginWithPassword = async (): Promise<void> => {
    const missing = missingField('sign-in');
    if (missing !== undefined) return failWithKey(missingFieldKey(missing));
    if (!requireNetworkConsent()) return;
    setPhase({ kind: 'busy', action: 'password-login' });
    const result = await loginWithEmailPassword(options, {
      email,
      password: loginPassword,
    });
    if (!result.ok) return failFrom(result);
    setPhase({ kind: 'session', session: result.session });
  };

  /**
   * 🔴 这里的顺序是**口径**，不是风格：`false` 时**不 `setPhase(busy)`**、不发请求，
   * 面板由 `requireNetworkConsent()` 替用户打开。
   *
   * 先进 busy 再判闸门的话，症状是"菊花转起来、什么都没人发"，
   * 而那块面板被一个"正在登录"的界面盖着 —— 用户看到的是应用卡住，
   * 不是"我们还不能替你出门"。
   */
  const sendLoginLink = async (): Promise<void> => {
    if (!requireNetworkConsent()) return;
    setPhase({ kind: 'busy', action: 'magic-login' });
    const result = await requestMagicLink(options, email);
    if (!result.ok) return fail(result.reason);
    setPhase({ kind: 'notice', key: 'mobile.auth.sent.login' });
  };

  const register = async (): Promise<void> => {
    // 🔴 未勾同意项 → **一个请求都不发**，并说清原因。
    if (!termsAccepted) return failWithKey(AUTH_TERMS_REQUIRED_KEY);
    if (!requireNetworkConsent()) return;
    setPhase({ kind: 'busy', action: 'magic-register' });
    const result = await registerWithMagicLink(options, { email, termsAccepted: true });
    if (!result.ok) return fail(result.reason);
    // 中性：不读 `result.message`（那是服务端给的安全文案，而且它本身中性），
    // 也不渲染成"账号已建"。
    setPhase({ kind: 'notice', key: 'mobile.auth.sent.register' });
  };

  const passkeyLogin = async (): Promise<void> => {
    // 🔴 **先判能力，再发请求。** 反过来的话请求已经出去了，
    //    而 `passkey-unsupported` 的契约是"一个请求都没发"（见 hosted-auth.ts）。
    if (passkeyProvider === undefined) return fail('passkey-unsupported');
    // 能力之后、闸门之前：这两条本地检查都不该被"要不要联网"这个问题打断。
    if (!requireNetworkConsent()) return;
    setPhase({ kind: 'busy', action: 'passkey-login' });
    const begun = await beginPasskeyLogin(options, email);
    if (!begun.ok) return fail(begun.reason);
    let credential: HostedPasskeyCredential;
    try {
      credential = await passkeyProvider.get(begun.options);
    } catch (error) {
      return fail(describePasskeyError(error));
    }
    const done = await completePasskeyLogin(options, { email, credential });
    if (!done.ok) return fail(done.reason);
    setPhase({ kind: 'session', session: done.session });
  };

  const passkeyRegister = async (): Promise<void> => {
    if (!termsAccepted) return failWithKey(AUTH_TERMS_REQUIRED_KEY);
    if (passkeyProvider === undefined) return fail('passkey-unsupported');
    if (!requireNetworkConsent()) return;
    setPhase({ kind: 'busy', action: 'passkey-register' });
    const begun = await beginPasskeyRegistration(options, { email, termsAccepted: true });
    if (!begun.ok) return fail(begun.reason);
    let credential: HostedPasskeyCredential;
    try {
      credential = await passkeyProvider.create(begun.options);
    } catch (error) {
      return fail(describePasskeyError(error));
    }
    const done = await completePasskeyRegistration(options, { email, credential });
    if (!done.ok) return fail(done.reason);
    // 注册**不产出令牌**（规范 §2-A1）—— 说"去登录"，不说"已建好账号"。
    setPhase({ kind: 'notice', key: 'mobile.auth.sent.register' });
  };

  const redeemPasted = async (): Promise<void> => {
    if (!requireNetworkConsent()) return;
    setPhase({ kind: 'busy', action: 'verify' });
    const outcome = await redeemPastedAuthToken(
      {
        verifyLoginToken: async (token) => {
          const result = await verifyMagicLink(options, token);
          return result.ok
            ? { ok: true, session: result.session }
            : { ok: false, reason: result.reason };
        },
        verifyEmailToken: async (token) => {
          const result = await verifyEmailAddress(options, token);
          return result.ok ? { ok: true } : { ok: false, reason: result.reason };
        },
      },
      pasted,
    );

    switch (outcome.kind) {
      case 'session':
        setPasted('');
        setPhase({ kind: 'session', session: outcome.session });
        return;
      case 'email-verified':
        // 验证成功但**没有令牌**（规范 §2-A1）—— 明确说"还要再登录一次"。
        setPasted('');
        setPhase({ kind: 'notice', key: 'mobile.auth.emailVerified' });
        return;
      case 'failed':
        return fail(outcome.reason);
    }
  };

  const saveAndSync = (): void => {
    if (session === undefined) return;
    setPhase({ kind: 'busy', action: 'save' });
    const saved = saveAuthSession({
      serverUrl,
      token: session.token,
      password,
      email: session.user.email,
    });
    // 🔴 顺序：**先写活配置，再触发同步**。反过来第一次同步用的还是上一次的凭据，
    //    用户会看到"第一次点没反应、第二次才成功"。
    void syncNow();
    onSignedIn({ ...saved, email: session.user.email });
  };

  return (
    <Screen
      title={t('mobile.auth.title')}
      actions={[
        {
          icon: 'action.back',
          label: t('mobile.auth.back'),
          onPress: onBack,
        },
      ]}
    >
      <Text variant="caption" tone="subtle">
        {t('mobile.auth.intro')}
      </Text>

      {/* 状态区。失败用 danger，中性提示用 muted —— 两者**不能同色**，
          否则"链接已发出"和"登录失败"在视觉上分不出来。 */}
      {phase.kind === 'failed' ? (
        <Text variant="caption" tone="danger">
          {phase.vars === undefined ? t(phase.key) : t(phase.key, phase.vars)}
        </Text>
      ) : null}
      {phase.kind === 'notice' ? (
        <Text variant="caption" tone="muted">
          {t(phase.key)}
        </Text>
      ) : null}
      {phase.kind === 'session' ? (
        <Card>
          <View style={{ gap: tokens['space.1'] }}>
            <Text variant="row-title" tone="success">
              {t('mobile.auth.signedIn.title')}
            </Text>
            <Text variant="caption" tone="muted">
              {t('mobile.auth.signedIn.body', { email: phase.session.user.email })}
            </Text>
          </View>
        </Card>
      ) : null}

      <SectionHeader icon="action.settings" title={t('mobile.profile.section.account')} />
      <Card>
        <View style={{ gap: tokens['space.4'] }}>
          <TextField
            label={t('mobile.auth.email.label')}
            value={email}
            onChangeText={setEmail}
            placeholder={t('mobile.auth.email.placeholder')}
          />
          {/*
            🔴 **登录密码** —— 与下面那栏「加密口令」是**两个秘密**、两个 state：
            这一栏的值要发给服务端验 Argon2id，那一栏的值永远不出这台设备。
            显隐开关**必须在**（NNG：口令错字主要来自看不见的最后一位），
            而移动端的默认档是明文 —— 取自共享层
            `defaultPasswordRevealed('mobile')`，不在这里重新决定。
          */}
          <View style={{ gap: tokens['space.1'] }}>
            <TextField
              label={t(SIGN_IN_PASSWORD_LABEL_KEY)}
              value={loginPassword}
              onChangeText={setLoginPassword}
              secure={!passwordRevealed}
              hint={t('common.auth.form.passwordHint')}
            />
            <Pressable
              accessibilityRole="button"
              hitSlop={tokens['gesture.hit-slop']}
              onPress={() => {
                setPasswordRevealed((current) => !current);
              }}
            >
              <Text variant="caption" tone="primary">
                {t(passwordRevealed ? 'common.auth.form.hidePassword' : 'common.auth.form.showPassword')}
              </Text>
            </Pressable>
          </View>
          {/* 🔴 口令放在**动作按钮之上**：它是规范 §3.2 的第 ④ 步，
              而且登录完之后要停在 `session` 那一档等它 —— 放在屏底会让人以为
              登录已经全部完成了。 */}
          <TextField
            label={t(E2EE_PASSPHRASE_LABEL_KEY)}
            value={password}
            onChangeText={setPassword}
            secure
            hint={t('mobile.auth.passwordNeeded')}
          />
          {/*
            🔴 服务端地址是**最后一栏**。放第一栏等于要求用户在开始注册之前
            先回答"你要连哪台机器" —— 而绝大多数人连的是这项服务默认提供的那台，
            他们没有自己的地址可填。这不是排序偏好，是产品负责人定的硬约束。
          */}
          <TextField
            label={t('mobile.profile.serverUrl.label')}
            value={serverUrl}
            onChangeText={setServerUrl}
            keyboard="url"
            hint={t('mobile.profile.serverUrl.hint')}
          />
        </View>
      </Card>

      {/* 同意项（规范 §2-A4）。**必须由用户自己勾**，初值 false。 */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: tokens['space.2'] }}>
        <Checkbox
          checked={termsAccepted}
          onToggle={() => {
            setTermsAccepted((current) => !current);
          }}
          label={t('mobile.auth.terms.label')}
        />
        <Text variant="caption" tone="muted" style={{ flex: 1 }}>
          {t('mobile.auth.terms.label')}
        </Text>
      </View>

      {/*
        条款的**落点**。这句"我同意该服务端提供的服务条款与隐私政策"长期没有
        任何地方能读到那份东西 —— 要求同意一份读不到的文本，PIPL 第 17 条的"公开"
        就没做到。链接放在勾选行**外面**：整行都是 Checkbox 的触控区，
        嵌进去会让"我想先读条款"变成"我已经同意了"。
      */}
      {legalLinks === null ? null : (
        <View style={{ flexDirection: 'row', gap: tokens['space.4'] }}>
          <Pressable
            accessibilityRole="link"
            hitSlop={tokens['gesture.hit-slop']}
            onPress={() => {
              openLegalLink(legalLinks.terms);
            }}
          >
            <Text variant="caption" tone="primary" style={{ textDecorationLine: 'underline' }}>
              {t('common.legal.termsDoc')}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="link"
            hitSlop={tokens['gesture.hit-slop']}
            onPress={() => {
              openLegalLink(legalLinks.privacy);
            }}
          >
            <Text variant="caption" tone="primary" style={{ textDecorationLine: 'underline' }}>
              {t('common.legal.privacyDoc')}
            </Text>
          </Pressable>
        </View>
      )}

      <Text variant="caption" tone="subtle">
        {t('mobile.auth.terms.hint')}
      </Text>

      {/*
        口令这条路（规范 §3.2 的主路）。**登录在前**：它是唯一直接产出会话的按钮，
        而注册只发一封验证邮件（规范 §2-A1 —— 注册不给令牌）。
        ⚠️ 按钮文案**不许**写成"已注册 / 已登录"：点下去只是发出请求，
        结果由状态区那句说，而那句在中性情形下不能断言账号已建（§2-A2）。
      */}
      <Button
        label={t('mobile.auth.password.login')}
        onPress={() => {
          void loginWithPassword();
        }}
        tone="primary"
        disabled={busy}
        loading={action === 'password-login'}
      />
      <Button
        label={t('mobile.auth.password.register')}
        onPress={() => {
          void registerWithPassword();
        }}
        disabled={busy}
        loading={action === 'password-register'}
      />

      {/* 邮件链接与通行密钥现在明确是**第二条路**（规范 §3.2 ②a / ②b）。 */}
      <SectionHeader icon="action.more" title={t('common.auth.form.otherWays')} />
      {/* 邮件链接那条路。 */}
      <Button
        label={t('mobile.auth.magicLink.login')}
        onPress={() => {
          void sendLoginLink();
        }}
        tone="primary"
        disabled={busy}
        loading={action === 'magic-login'}
      />
      <Button
        label={t('mobile.auth.magicLink.register')}
        onPress={() => {
          void register();
        }}
        disabled={busy}
        loading={action === 'magic-register'}
      />

      {/* 通行密钥那条路（规范 §3.2 ②a）。**不禁用**，因为"为什么点不了"必须说出来。 */}
      <Button
        label={t('mobile.auth.passkey.login')}
        onPress={() => {
          void passkeyLogin();
        }}
        disabled={busy}
        loading={action === 'passkey-login'}
      />
      <Button
        label={t('mobile.auth.passkey.register')}
        onPress={() => {
          void passkeyRegister();
        }}
        disabled={busy}
        loading={action === 'passkey-register'}
      />
      {passkeyProvider === undefined ? (
        <Text variant="caption" tone="subtle">
          {t('mobile.auth.passkey.unavailable')}
        </Text>
      ) : null}

      {/* 粘贴邮件里的链接 / 令牌（规范 §2-A6 在各端的共同出口）。 */}
      <TextField
        label={t('mobile.auth.paste.label')}
        value={pasted}
        onChangeText={setPasted}
        placeholder={t('mobile.auth.paste.placeholder')}
      />
      <Button
        label={t('mobile.auth.verify')}
        onPress={() => {
          void redeemPasted();
        }}
        disabled={busy}
        loading={action === 'verify'}
      />

      {/* 规范 §3.2 第 ④ 步：拿到令牌之后**停在**这里，等 E2EE 口令。 */}
      {session !== undefined || action === 'save' ? (
        <Button
          label={t('mobile.auth.enableSync')}
          onPress={saveAndSync}
          tone="primary"
          icon="action.sync"
          disabled={phase.kind === 'busy'}
        />
      ) : null}
    </Screen>
  );
}
