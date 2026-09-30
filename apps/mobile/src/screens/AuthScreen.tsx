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
 *   - 失败原因 → 句子 → **`@heyta/ui` 的 `authFailureMessageKey`**（唯一一份，
 *     与 web 共用；命名空间 `common.auth.error.*`）；
 *   - 拿到会话之后要做什么 → `src/auth/session.ts`。
 *
 * 本文件只做两件事：**把状态渲染成句子**、**收集用户输入**。
 * 这也是它能在两个宿主（欢迎页 / 「我的」页）里复用的原因。
 *
 * ## 🔴 三条不许违反的口径
 *
 *   1. **中性文案**（规范 §2-A2）：注册可能是"假成功"（邮箱已属已验证账号时，
 *      服务端**故意**回成功而不写凭据）。所以这里**不出现**"账号已创建"这类断言。
 *   2. **同意项由用户自己勾**（规范 §2-A4）：初值 `false`，未勾时**不发注册请求**，
 *      并且明说为什么 —— 而不是让服务端回一个 400。
 *   3. **通行密钥不支持时要说出来**（规范 §3.2 ②a 那条分支仍然要在）：
 *      这台设备今天没有 WebAuthn 实现（见 `src/auth/passkey-host.ts`），
 *      但按钮**不禁用**：禁用了却不说，用户只会以为界面坏了。
 */

import React, { useState } from 'react';
import { View } from 'react-native';
import {
  beginPasskeyLogin,
  beginPasskeyRegistration,
  completePasskeyLogin,
  completePasskeyRegistration,
  requestMagicLink,
  registerWithMagicLink,
  verifyEmailAddress,
  verifyMagicLink,
  type HostedAuthFailureReason,
  type HostedAuthSession,
  type HostedPasskeyCredential,
} from '@heyta/app-host';
import { useI18n, type MessageKey } from '@heyta/i18n';

import { Button, Card, Checkbox, Screen, SectionHeader, Text, TextField } from '../ui/kit';
import { useTokens } from '../theme';
import { syncNow } from '../sync/store';
import { AUTH_TERMS_REQUIRED_KEY, authFailureMessageKey } from '@heyta/ui';
import { describePasskeyError, resolvePasskeyProvider } from '../auth/passkey-host';
import { redeemPastedAuthToken } from '../auth/paste';
import { saveAuthSession } from '../auth/session';

/** 正在跑的那件事。只为了在按钮上画菊花 + 让"哪一步在忙"可读。 */
type AuthAction =
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
  | { kind: 'failed'; key: MessageKey }
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
  const { t } = useI18n();
  const tokens = useTokens();

  const [serverUrl, setServerUrl] = useState(initialServerUrl);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState(initialPassword);
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

  const fail = (reason: HostedAuthFailureReason): void => {
    setPhase({ kind: 'failed', key: authFailureMessageKey(reason) });
  };

  /**
   * 直接在界面上说一句话，**不走** `HostedAuthFailureReason`。
   *
   * 🔴 只有"未勾同意项"用它，而且这是**刻意的**：那个原因集合是**协议**的
   * 失败集合（服务端会怎么回答），而"你没勾同意项"是**本地**的输入问题 ——
   * 它甚至没发出请求。把它塞进协议集合会污染那份封闭清单，
   * 也会让 app-host 对这个纯界面状态负责。
   */
  const failWithKey = (key: MessageKey): void => {
    setPhase({ kind: 'failed', key });
  };

  const options = { baseUrl: serverUrl };

  const sendLoginLink = async (): Promise<void> => {
    setPhase({ kind: 'busy', action: 'magic-login' });
    const result = await requestMagicLink(options, email);
    if (!result.ok) return fail(result.reason);
    setPhase({ kind: 'notice', key: 'mobile.auth.sent.login' });
  };

  const register = async (): Promise<void> => {
    // 🔴 未勾同意项 → **一个请求都不发**，并说清原因。
    if (!termsAccepted) return failWithKey(AUTH_TERMS_REQUIRED_KEY);
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
          {t(phase.key)}
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
            label={t('mobile.profile.serverUrl.label')}
            value={serverUrl}
            onChangeText={setServerUrl}
            keyboard="url"
            hint={t('mobile.profile.serverUrl.hint')}
          />
          <TextField
            label={t('mobile.auth.email.label')}
            value={email}
            onChangeText={setEmail}
            placeholder={t('mobile.auth.email.placeholder')}
          />
          {/* 🔴 口令放在**动作按钮之上**：它是规范 §3.2 的第 ④ 步，
              而且登录完之后要停在 `session` 那一档等它 —— 放在屏底会让人以为
              登录已经全部完成了。 */}
          <TextField
            label={t('mobile.profile.password.label')}
            value={password}
            onChangeText={setPassword}
            secure
            hint={t('mobile.auth.passwordNeeded')}
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
      <Text variant="caption" tone="subtle">
        {t('mobile.auth.terms.hint')}
      </Text>

      {/* 邮件链接那条路（规范 §3.2 ②b）。 */}
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
