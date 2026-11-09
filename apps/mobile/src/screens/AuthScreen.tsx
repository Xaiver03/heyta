/**
 * 注册 / 登录面板（移动端壳）
 * ==========================
 *
 * ## 🔴 2026-10-26：这张表单不再由本文件手写
 *
 * 产品负责人的原话：**「手机上的注册登录页面非常的混乱」「这个布局到手机上就废掉了」**。
 * 根因不是"样式没调好"，而是**同一张表单被写了两遍**：
 *
 *   · Web 用 `@heyta/ui` 的 `AuthForm`（四端共用的那一份），外面套
 *     `AuthPanel` + `AuthPlanScene` + `auth-dialog.css`：一栏字段、一个主按钮、
 *     次级路径折叠、有入场动效；
 *   · 移动端这一屏**自己又写了一张**（1088 行）：六个动作平铺、主按钮夹在正文中段、
 *     模式切换藏在按钮下面一行小字、`Animated` 在整个文件里出现 **0 次**。
 *
 * 于是 Web 的布局与动效**从来没有到过手机**。这一轮把移动端改成用**同一份**
 * `AuthForm`，本文件只剩「宿主的那一半」（Web 的 `AuthPanel` 也是这一半）：
 *
 *   - 端点、请求体、失败归类 → `@heyta/app-host` 的 `hosted-auth.ts`；
 *   - 字段、显隐、`autocomplete`、本地校验与错误落点、「其他登录方式」的折叠 →
 *     `@heyta/ui` 的 `AuthForm`（**共享层唯一一份**）；
 *   - 失败原因 → 句子（连同句子里要填的数字）→ `@heyta/ui` 的 `authFailureMessage`；
 *   - 本文件只做：**把状态机翻成 `status` / `busy`**、**把动作接到 app-host**、
 *     以及三件共享表单不管的事（见下）。
 *
 * ## 共享表单不管、只能留在壳里的三件事
 *
 *   1. **端到端加密口令**（规范 §3.2 第 ④ 步）。它与「登录密码」是**两个秘密**：
 *      登录密码要发给服务端验 Argon2id，加密口令永远不出设备。
 *      ⚠️ 这条现在有了**结构上的**保证，而不是"两处 state 各自接对"：
 *      登录密码在 `AuthForm` 内部，**根本不进这个文件**；本文件里只有一个
 *      `passphrase`，它不进任何网络请求，只进 `saveAuthSession`。
 *   2. **统一身份（中央 OIDC）的设备配对**：浏览器里完成登录、本机轮询领取令牌。
 *      Web 那一侧走的是同源 POST，壳内宿主的 origin 不同 ⇒ 只能走 device handoff。
 *   3. **条款正文的读取**：官方文本在应用内可读（`LegalDocumentSheet`），
 *      自托管文本只能由那台服务端自己发布，交系统浏览器打开。
 *
 * ## 🔴 四条不许违反的口径（与重排前一致，判据已迁到新文件）
 *
 *   1. **中性文案**（规范 §2-A2）：注册可能是"假成功"（邮箱已属已验证账号时，
 *      服务端**故意**回成功而不写凭据）。所以这里**不出现**"账号已创建"这类断言。
 *   2. **同意项由用户自己勾**（规范 §2-A4）：`AuthForm` 未勾时**不发注册请求**，
 *      并且明说为什么 —— 本壳在 `onRegister` 里再兜一次同样的闸（两道闸不嫌多：
 *      漏了的那一道不会报错，只会让一次枚举尝试出门）。
 *   3. **通行密钥不支持时要说出来**（规范 §3.2 ②a）：这台设备今天没有 WebAuthn
 *      实现（见 `src/auth/passkey-host.ts`），但按钮**不禁用** —— 禁用了却不说，
 *      用户只会以为界面坏了。
 *   4. **拿到令牌不等于完成**：登录成功后停在 `session` 那一档等加密口令，
 *      而不是当成"已经登录好了"（那会让同步带着空口令失败）。
 */

import React, { useEffect, useRef, useState } from 'react';
import { Animated, AppState, Easing, Linking, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  beginCentralDeviceAuth,
  claimCentralDeviceAuth,
  getCentralAuthConfig,
  isOfficialCentralAuthEndpoint,
  type CentralDeviceStart,
  beginPasskeyLogin,
  beginPasskeyRegistration,
  completePasskeyLogin,
  completePasskeyRegistration,
  loginWithEmailPassword,
  requestEmailPasswordRegistrationCode,
  verifyEmailPasswordRegistrationCode,
  resendEmailPasswordRegistrationCode,
  requestMagicLink,
  requestPasskeyRecovery,
  requestPasswordReset,
  OFFICIAL_SITE_ORIGIN,
  resolveLegalLinks,
  verifyEmailAddress,
  verifyMagicLink,
  type HostedAuthFailure,
  type HostedAuthFailureReason,
  type HostedAuthSession,
  type HostedPasskeyCredential,
} from '@heyta/app-host';
import { legalDocumentById, legalDocumentPresentation } from '@heyta/legal';
import { useI18n, type MessageKey, type MessageVars } from '@heyta/i18n';

import { Button, Card, Checkbox, Text, TextField } from '../ui/kit';
import { useTheme, useTokens } from '../theme';
import { syncNow } from '../sync/store';
import {
  AuthForm,
  AUTH_TERMS_REQUIRED_KEY,
  E2EE_PASSPHRASE_LABEL_KEY,
  SIGN_IN_PASSWORD_LABEL_KEY,
  authFailureMessage,
  LegalDocumentSheet,
  type AuthFormLabels,
  type AuthFormStatus,
} from '@heyta/ui';
import { describePasskeyError, resolvePasskeyProvider } from '../auth/passkey-host';
import { redeemPastedAuthToken } from '../auth/paste';
import { saveAuthSession } from '../auth/session';
import { acceptNetworkConsent, requireNetworkConsent } from '../privacy/consent-ui';

/** 正在跑的那件事。只为了在按钮上画菊花 + 让"哪一步在忙"可读。 */
type AuthAction =
  | 'central-start'
  | 'password-login'
  | 'password-register'
  | 'registration-code'
  | 'forgot-password'
  | 'magic-login'
  | 'recovery'
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
  | {
      kind: 'registration-code';
      challengeId: string;
      email: string;
      expiresAt: number;
      resendAvailableAt: number;
    }
  | { kind: 'session'; session: HostedAuthSession };

/**
 * 每个动作各有一句"正在…"。
 *
 * 🔴 **不是一句通用的"正在处理"**：口令登录要跑 Argon2id（比其它动作慢一个量级），
 * 说成"正在登录"会让人以为卡死，于是去点第二次。
 * ⚠️ 用 `Record<AuthAction, …>` 而不是 `Partial`：**新增动作却忘了配句子**
 * 会在编译期红 —— 那正是"界面对着一个进行中的请求说不出话"的形状。
 */
const BUSY_MESSAGE_KEY: Record<AuthAction, MessageKey> = {
  'central-start': 'web.auth.central.busy',
  'password-login': 'common.auth.busy.signIn',
  'password-register': 'common.auth.busy.register',
  'registration-code': 'common.auth.busy.verify',
  'forgot-password': 'common.auth.busy.forgot',
  'magic-login': 'common.auth.busy.link',
  recovery: 'common.auth.busy.recovery',
  'passkey-login': 'web.auth.passkey.waiting',
  'passkey-register': 'web.auth.passkey.waiting',
  verify: 'common.auth.busy.verify',
  save: 'common.auth.busy.verify',
};

/**
 * 注册"成功之后说哪一句"的**唯一**判点。
 *
 * 🔴 服务端亲口说那封信没发出去（`emailDelivered: false`）时，"去查收邮件"
 * 是一句谎话，而这个屏幕上它唯一的出口 —— 用户会一直等一封永远不会来的信。
 * ⚠️ 缺省**不是** false：发信成功、连的是没有这个字段的老服务端、以及
 * `REQUIRE_EMAIL_VERIFICATION=false` 的自托管服务器（当场激活、压根不需要信）
 * 三种情况都说的是原来那句。
 */
type RegisterNoticeSource = { emailDelivered?: boolean };

/**
 * ⚠️ 判据是「明确为 false」而不是「有值就说没发」：`undefined`（老服务端 / 无需验证的
 * 自托管）必须说原来那句，`true` 更是。把 `undefined` 当 false 会让每个自托管用户
 * 都看到「邮件没发出去」。
 */
const registerNoticeKey = (result: RegisterNoticeSource): MessageKey =>
  result.emailDelivered === false ? 'mobile.auth.sent.mailNotSent' : 'mobile.auth.sent.register';

export interface SavedAuthSession {
  serverUrl: string;
  token: string;
  password: string;
  email: string;
  accountId: string;
}

export interface AuthScreenProps {
  onBack: () => void;
  /** 同步设置里的服务端地址 —— 认证与同步**必须**指向同一个服务端。 */
  initialServerUrl: string;
  /** 只有从设置 → 同步显式打开自托管路径时才允许编辑服务端地址与粘贴令牌。 */
  allowServerSelection?: boolean;
  /** 已经填过的 E2EE 口令（有的话不必让用户再输一遍）。 */
  initialPassword: string;
  /** 会话已经写进活配置、同步已经触发。宿主据此离开本屏。 */
  onSignedIn: (saved: SavedAuthSession) => void;
  /**
   * 把这一屏**就地展开**在宿主页面里（2026-10-26）。
   *
   * 🔴 产品负责人的原话：**「为什么我们现在的注册、登录竟然分为好几个页面？这太离谱了」**。
   *    原来点「注册 / 登录」是**整屏替换**成另一个页面 —— 一次登录被拆成
   *    「欢迎页 → 认证页 → 验证码 → 口令」四屏。现在欢迎页把这一块**原地展开**：
   *    主视觉留在上面，表单在它下面长出来，退出去也只是收起来。
   *
   * ⚠️ 这一档不自己滚动、不吃安全区、不占满屏 —— 那三件事归宿主。
   *    它还保留一句：**它是同一个组件**。就地展开不等于"再抄一份欢迎页版本"。
   */
  embedded?: boolean;
}

export function AuthScreen({
  onBack,
  initialServerUrl,
  allowServerSelection = false,
  initialPassword,
  onSignedIn,
  embedded = false,
}: AuthScreenProps): React.JSX.Element {
  const { t, locale } = useI18n();
  const tokens = useTokens();
  const { reducedMotion, native } = useTheme();
  const insets = useSafeAreaInsets();

  /**
   * 复用的布局形状（不是"样式抽象"，是**同一件事的第二处**）。
   *
   * 「已登录」「统一身份」两张卡里的字段栈、条款行各出现一次：
   * 写成两段内联对象就是两份可以各自漂的间距。而 `check:l4` 把
   * `style={{` 的**行数**当棘轮（只减不增）—— 收进具名对象同时满足两边。
   */
  const layout = {
    root: { flex: 1, backgroundColor: tokens['color.background'], paddingTop: insets.top },
    fill: { flex: 1 },
    stack1: { gap: tokens['space.1'] },
    stack3: { gap: tokens['space.3'] },
    rowCenter: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: tokens['space.2'] },
    rowLegal: { flexDirection: 'row' as const, gap: tokens['space.4'] },
  };
  const [serverUrl, setServerUrl] = useState(initialServerUrl);
  /**
   * 🔴 **端到端加密口令**。它只存在本机内存里、只进 `saveAuthSession`。
   * 「登录密码」在 `AuthForm` 内部，**不进这个文件** —— 两个秘密在结构上就分开了。
   */
  const [passphrase, setPassphrase] = useState(initialPassword);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [sessionServerUrl, setSessionServerUrl] = useState<string | undefined>(undefined);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [centralAttempt, setCentralAttempt] = useState<(CentralDeviceStart & { generation: number }) | undefined>();
  const [openLegalDocument, setOpenLegalDocument] = useState<string | null>(null);
  const authGeneration = useRef(0);
  const centralClaiming = useRef(false);
  const centralStarting = useRef(false);
  const scrollRef = useRef<ScrollView | null>(null);

  const busy = phase.kind === 'busy';
  const action = phase.kind === 'busy' ? phase.action : undefined;
  const session = phase.kind === 'session' ? phase.session : undefined;
  const centralMode = isOfficialCentralAuthEndpoint(serverUrl);
  const termsLabel = t('mobile.auth.terms.label');

  /** 这台设备有没有通行密钥实现。没有时**如实说**，而不是把按钮藏起来。 */
  const passkeyProvider = resolvePasskeyProvider();

  /**
   * 勾选框旁边两条条款链接的地址。分流规则在 `@heyta/app-host` 的 `legal-links.ts`
   * ——「哪份文本适用于这台服务端」是协议知识，四个壳各写一遍必然漂移（AGENTS §3.5）。
   */
  const legalLinks = resolveLegalLinks(serverUrl, locale);
  const officialLegalLinks =
    legalLinks !== null && legalLinks.terms.startsWith(`${OFFICIAL_SITE_ORIGIN}/`);
  const options = { baseUrl: serverUrl, locale };

  /**
   * ── 入场与状态切换的动效 ────────────────────────────────────────────────
   *
   * 重排前这一屏**一点动效都没有**：状态从「填表」跳到「已登录」是整块瞬变。
   * 这里只做一件事：内容淡入 + 轻微上浮，**只发生一次**。
   * 没有循环、没有呼吸、没有注意力钩子（Web 那侧的 `ht-sheet-auth-in` 同一口径）。
   *
   * 🔴 `reducedMotion` 时**一帧都不动**（直接钉到进度 1），不是"动画跑快一点"：
   * 系统设置里关掉动效的人，看到的应该是最终状态。
   * ⚠️ 依赖列里是**数字**而不是整个 `tokens` 对象：主题一变 `tokens` 引用就换，
   * 那样用户切一次系统配色，整屏会重新淡入一遍。
   */
  const entryDuration = tokens['duration.normal'];
  const entry = useRef(new Animated.Value(reducedMotion ? 1 : 0)).current;
  useEffect(() => {
    if (reducedMotion) {
      entry.setValue(1);
      return;
    }
    // 🔴 曲线走 token，和 `StateIllustration` 同一条取法（`native.easing(key)`），
    // 不再硬编码 `Easing.out(Easing.cubic)`。
    //
    // 选 `ease.enter`（`cubic-bezier(0, 0, 0.2, 1)`，token 里标着"ease-out：进入"）：
    // 这一格是**进入**语义 —— 内容从 `opacity 0` 淡入、同时从 `space.3` 上浮到 0，
    // 只发生一次、终点恒为进度 1（上面那段注释已钉住"没有循环、没有呼吸"）。
    // 形状上也最贴合原来的 `Easing.out(Easing.cubic)`：两者都是"起步快、收尾慢"的
    // ease-out 族，换成 `ease.exit`（`cubic-bezier(0.4, 0, 1, 1)`，ease-in）会变成
    // "起步慢、收尾急"，与"内容进场"的读感相反。
    const easing = native.easing('ease.enter');
    Animated.timing(entry, {
      toValue: 1,
      duration: entryDuration,
      // 回退到 `Easing.linear` 而不是再写一条内置曲线（与 `SwipeReveal` /
      // `StateIllustration` 同一条）：解析不出来说明 token 被改成了 RN 不认的形状，
      // 那是**配置缺陷**，此时最该做的是别掩盖它。这一格位移只有 `space.3`、
      // 时长 `duration.normal` 又短，线性并不突兀。
      easing: easing === null ? Easing.linear : Easing.bezier(...easing),
      useNativeDriver: true,
    }).start();
  }, [entry, entryDuration, native, reducedMotion]);

  const entryStyle = {
    opacity: entry,
    transform: [
      { translateY: entry.interpolate({ inputRange: [0, 1], outputRange: [tokens['space.3'], 0] }) },
    ],
  };

  /**
   * 失败时把正文滚回顶部。
   *
   * 🔴 这是结构问题不是美化：失败句渲染在表单顶部，而人在屏幕下方按按钮。
   * 不滚的话，用户看到的是"点了没反应"。
   * ⚠️ 只有失败才滚：中性提示（"邮件已发出"）不抢滚动位置。
   */
  const failedKey = phase.kind === 'failed' ? phase.key : undefined;
  useEffect(() => {
    if (failedKey === undefined) return;
    scrollRef.current?.scrollTo({ y: 0, animated: !reducedMotion });
  }, [failedKey, reducedMotion]);

  useEffect(() => {
    if (centralAttempt === undefined) return;
    let disposed = false;
    const claim = async (): Promise<void> => {
      if (disposed || centralClaiming.current || AppState.currentState !== 'active') return;
      if (Date.now() >= centralAttempt.expiresAt) {
        setCentralAttempt(undefined);
        setPhase({ kind: 'failed', key: 'mobile.auth.central.expired' });
        return;
      }
      centralClaiming.current = true;
      const result = await claimCentralDeviceAuth({ baseUrl: serverUrl }, centralAttempt.handoffId, centralAttempt.verifier);
      centralClaiming.current = false;
      if (disposed || centralAttempt.generation !== authGeneration.current) return;
      if (!result.ok) {
        // A lost response may already have consumed the one-time bearer. Never retry that claim.
        setCentralAttempt(undefined);
        setPhase({ kind: 'failed', key: 'mobile.auth.central.claimFailed' });
      } else if (result.value.status === 'claimed') {
        setCentralAttempt(undefined);
        setSessionServerUrl(serverUrl.trim());
        setPhase({ kind: 'session', session: { token: result.value.token, user: result.value.user } });
      }
    };
    const timer = setInterval(() => { void claim(); }, 5000);
    const foreground = AppState.addEventListener('change', (state) => { if (state === 'active') void claim(); });
    return () => { disposed = true; clearInterval(timer); foreground.remove(); };
  }, [centralAttempt, serverUrl]);

  /** 切换服务端必须丢掉刚拿到的会话，避免把旧 token 绑定到新地址。 */
  const updateServerUrl = (next: string): void => {
    if (serverUrl.trim() !== next.trim()) {
      authGeneration.current += 1;
      setPhase({ kind: 'idle' });
      setSessionServerUrl(undefined);
      setCentralAttempt(undefined);
      setPassphrase('');
      setTermsAccepted(false);
    }
    setServerUrl(next);
  };

  useEffect(() => () => {
    authGeneration.current += 1;
  }, []);

  const beginAuthAction = (): number => {
    authGeneration.current += 1;
    return authGeneration.current;
  };

  const isCurrentAuthAction = (generation: number): boolean => generation === authGeneration.current;

  const enterSession = (next: HostedAuthSession): void => {
    setSessionServerUrl(serverUrl.trim());
    setPhase({ kind: 'session', session: next });
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
   * 它甚至没发出请求。
   */
  const failWithKey = (key: MessageKey, vars?: MessageVars): void => {
    setPhase(vars === undefined ? { kind: 'failed', key } : { kind: 'failed', key, vars });
  };

  const failFrom = (failure: HostedAuthFailure): void => {
    const message = authFailureMessage(failure);
    failWithKey(message.key, message.vars);
  };

  /** 打开一条外部链接。失败必须看得见 —— 静默什么都不发生会让人以为界面卡住。 */
  const openLegalLink = (href: string): void => {
    Linking.openURL(href).catch(() => {
      failWithKey('mobile.auth.link.unopenable');
    });
  };

  /** 官方文本在应用内可读；自托管文本只能由自托管运营者发布，交给浏览器打开。 */
  const openLegalDocumentOrLink = (kind: 'terms' | 'privacy'): void => {
    if (officialLegalLinks) {
      setOpenLegalDocument(kind);
      return;
    }
    const href = kind === 'terms' ? legalLinks?.terms : legalLinks?.privacy;
    if (href !== undefined) openLegalLink(href);
  };

  const startCentralLogin = async (): Promise<void> => {
    if (centralStarting.current || centralAttempt !== undefined) return;
    if (!requireNetworkConsent()) return;
    if (!termsAccepted) return failWithKey('mobile.auth.central.termsRequired');
    centralStarting.current = true;
    try {
      const generation = beginAuthAction();
      setPhase({ kind: 'busy', action: 'central-start' });
      const centralOptions = { baseUrl: serverUrl.trim() };
      const config = await getCentralAuthConfig(centralOptions);
      if (!isCurrentAuthAction(generation)) return;
      if (!config.ok || config.value.mode !== 'oidc' || !config.value.documentVersion) {
        return failWithKey('mobile.auth.central.unavailable');
      }
      const started = await beginCentralDeviceAuth({ ...centralOptions, termsAccepted: true,
        documentVersion: config.value.documentVersion });
      if (!isCurrentAuthAction(generation)) return;
      if (!started.ok) return failWithKey('mobile.auth.central.unavailable');
      setCentralAttempt({ ...started.value, generation });
      setPhase({ kind: 'notice', key: 'mobile.auth.central.waiting' });
    } finally {
      centralStarting.current = false;
    }
  };

  /**
   * 登录（邮箱 + 密码）—— 产出会话的三条路之一（另两条是邮件链接与通行密钥）。
   *
   * 🔴 口令**原样**交出去：不 trim / 不改大小写 / 不提前按长度拒绝。
   * 归一化只在服务端一处发生，客户端多算一次就是第二套规则（NIST 禁止组成规则）。
   * 拿到会话之后仍然**停在** `session` 那一档等加密口令：登录成功不等于同步可用。
   */
  const login = async (email: string, password: string): Promise<void> => {
    const generation = beginAuthAction();
    if (!requireNetworkConsent()) return;
    setPhase({ kind: 'busy', action: 'password-login' });
    const result = await loginWithEmailPassword(options, { email, password });
    if (!isCurrentAuthAction(generation)) return;
    if (!result.ok) return failFrom(result);
    enterSession(result.session);
  };

  /**
   * 注册（邮箱 + 密码）。
   *
   * 🔴 `AuthForm` 已经保证"未勾同意项不会调到这里"，这里**再兜一次**：
   * 一次漏勾的注册请求会让服务端回 400，但那次**枚举尝试**已经出门了。
   * 勾选同意同时就是"允许本机联网"的明示（规范 §2-A4），所以先记下来再判闸门。
   */
  const register = async (email: string, password: string, accepted: boolean): Promise<void> => {
    if (!accepted) return failWithKey(AUTH_TERMS_REQUIRED_KEY);
    const generation = beginAuthAction();
    acceptNetworkConsent();
    if (!requireNetworkConsent()) return;
    setPhase({ kind: 'busy', action: 'password-register' });
    const result = await requestEmailPasswordRegistrationCode(options, {
      email,
      password,
      termsAccepted: true,
    });
    if (!isCurrentAuthAction(generation)) return;
    if (!result.ok) return failFrom(result);
    if (result.emailDelivered === false) {
      setPhase({ kind: 'notice', key: registerNoticeKey(result) });
      return;
    }
    setPhase({
      kind: 'registration-code',
      challengeId: result.challengeId,
      email,
      expiresAt: result.expiresAt,
      resendAvailableAt: result.resendAvailableAt,
    });
  };

  const verifyRegistrationCode = async (code: string): Promise<void> => {
    if (phase.kind !== 'registration-code') return;
    if (Date.now() >= phase.expiresAt) return;
    const generation = beginAuthAction();
    if (!requireNetworkConsent()) return;
    setPhase({ kind: 'busy', action: 'registration-code' });
    const result = await verifyEmailPasswordRegistrationCode(options, {
      challengeId: phase.challengeId,
      code,
    });
    if (!isCurrentAuthAction(generation)) return;
    if (!result.ok) return failFrom(result);
    enterSession(result.session);
  };

  const resendRegistrationCode = async (): Promise<void> => {
    if (phase.kind !== 'registration-code' || Date.now() < phase.resendAvailableAt) return;
    const challenge = phase;
    const generation = beginAuthAction();
    if (!requireNetworkConsent()) return;
    setPhase({ kind: 'busy', action: 'registration-code' });
    const result = await resendEmailPasswordRegistrationCode(options, challenge.challengeId);
    if (!isCurrentAuthAction(generation)) return;
    if (!result.ok) return failFrom(result);
    setPhase({ kind: 'registration-code', email: challenge.email, ...result });
  };

  const cancelRegistrationCode = (): void => {
    authGeneration.current += 1;
    setPhase({ kind: 'idle' });
  };

  const forgotPassword = async (email: string): Promise<void> => {
    const generation = beginAuthAction();
    if (email.trim() === '') return failWithKey('common.auth.form.emailRequired');
    if (!requireNetworkConsent()) return;
    setPhase({ kind: 'busy', action: 'forgot-password' });
    const result = await requestPasswordReset(options, email);
    if (!isCurrentAuthAction(generation)) return;
    if (!result.ok) return failFrom(result);
    setPhase({ kind: 'notice', key: 'common.auth.sent.reset' });
  };

  /** 找回通行密钥（`labels.recovery`）。与"忘记密码"是两条不同的邮件，所以是两个入口。 */
  const recoverPasskey = async (email: string): Promise<void> => {
    const generation = beginAuthAction();
    if (email.trim() === '') return failWithKey('common.auth.form.emailRequired');
    if (!requireNetworkConsent()) return;
    setPhase({ kind: 'busy', action: 'recovery' });
    const result = await requestPasskeyRecovery(options, email);
    if (!isCurrentAuthAction(generation)) return;
    if (!result.ok) return failFrom(result);
    setPhase({ kind: 'notice', key: 'web.auth.sent.recovery' });
  };

  /**
   * 🔴 这里的顺序是**口径**，不是风格：`false` 时**不 `setPhase(busy)`**、不发请求，
   * 面板由 `requireNetworkConsent()` 替用户打开。先进 busy 再判闸门的话，
   * 症状是"菊花转起来、什么都没发"。
   */
  const sendLoginLink = async (email: string): Promise<void> => {
    const generation = beginAuthAction();
    if (!requireNetworkConsent()) return;
    setPhase({ kind: 'busy', action: 'magic-login' });
    const result = await requestMagicLink(options, email);
    if (!isCurrentAuthAction(generation)) return;
    if (!result.ok) return fail(result.reason);
    setPhase({ kind: 'notice', key: 'mobile.auth.sent.login' });
  };

  const passkeyLogin = async (email: string): Promise<void> => {
    const generation = beginAuthAction();
    // 🔴 **先判能力，再发请求。** 反过来的话请求已经出去了，
    //    而 `passkey-unsupported` 的契约是"一个请求都没发"。
    if (passkeyProvider === undefined) return fail('passkey-unsupported');
    if (!requireNetworkConsent()) return;
    setPhase({ kind: 'busy', action: 'passkey-login' });
    const begun = await beginPasskeyLogin(options, email);
    if (!isCurrentAuthAction(generation)) return;
    if (!begun.ok) return fail(begun.reason);
    let credential: HostedPasskeyCredential;
    try {
      credential = await passkeyProvider.get(begun.options);
      if (!isCurrentAuthAction(generation)) return;
    } catch (error) {
      return fail(describePasskeyError(error));
    }
    const done = await completePasskeyLogin(options, { email, credential });
    if (!isCurrentAuthAction(generation)) return;
    if (!done.ok) return fail(done.reason);
    enterSession(done.session);
  };

  const passkeyRegister = async (email: string, accepted: boolean): Promise<void> => {
    if (!accepted) return failWithKey(AUTH_TERMS_REQUIRED_KEY);
    const generation = beginAuthAction();
    if (passkeyProvider === undefined) return fail('passkey-unsupported');
    acceptNetworkConsent();
    if (!requireNetworkConsent()) return;
    setPhase({ kind: 'busy', action: 'passkey-register' });
    const begun = await beginPasskeyRegistration(options, { email, termsAccepted: true });
    if (!isCurrentAuthAction(generation)) return;
    if (!begun.ok) return fail(begun.reason);
    let credential: HostedPasskeyCredential;
    try {
      credential = await passkeyProvider.create(begun.options);
      if (!isCurrentAuthAction(generation)) return;
    } catch (error) {
      return fail(describePasskeyError(error));
    }
    const done = await completePasskeyRegistration(options, { email, credential });
    if (!isCurrentAuthAction(generation)) return;
    if (!done.ok) return fail(done.reason);
    // 注册**不产出令牌**（规范 §2-A1）—— 说"去登录"，不说"已建好账号"。
    setPhase({ kind: 'notice', key: registerNoticeKey(done) });
  };

  const redeemPasted = async (token: string): Promise<void> => {
    const generation = beginAuthAction();
    if (!requireNetworkConsent()) return;
    setPhase({ kind: 'busy', action: 'verify' });
    const outcome = await redeemPastedAuthToken(
      {
        verifyLoginToken: async (value) => {
          const result = await verifyMagicLink(options, value);
          return result.ok ? { ok: true, session: result.session } : { ok: false, reason: result.reason };
        },
        verifyEmailToken: async (value) => {
          const result = await verifyEmailAddress(options, value);
          return result.ok ? { ok: true } : { ok: false, reason: result.reason };
        },
      },
      token,
    );
    if (!isCurrentAuthAction(generation)) return;

    switch (outcome.kind) {
      case 'session':
        enterSession(outcome.session);
        return;
      case 'email-verified':
        // 验证成功但**没有令牌**（规范 §2-A1）—— 明确说"还要再登录一次"。
        setPhase({ kind: 'notice', key: 'mobile.auth.emailVerified' });
        return;
      case 'failed':
        return fail(outcome.reason);
    }
  };

  const saveAndSync = (): void => {
    if (session === undefined || sessionServerUrl !== serverUrl.trim()) {
      setPhase({ kind: 'idle' });
      setSessionServerUrl(undefined);
      setPassphrase('');
      return;
    }
    setPhase({ kind: 'busy', action: 'save' });
    const saved = saveAuthSession({
      serverUrl,
      token: session.token,
      password: passphrase,
      email: session.user.email,
      accountId: String(session.user.id),
    });
    // 🔴 顺序：**先写活配置，再触发同步**。反过来第一次同步用的还是上一次的凭据，
    //    用户会看到"第一次点没反应、第二次才成功"。
    void syncNow();
    onSignedIn({ ...saved, email: session.user.email, accountId: String(session.user.id) });
  };

  /**
   * 状态机 → 一句人话。
   *
   * 🔴 三条口径，缺一条界面就会说谎：
   *   · **`notice` 一律是 `info` 不是 `success`** —— 服务端用中性文案防邮箱枚举，
   *     "信已发出"不等于"你收到了"；
   *   · **只有真的拿到令牌才可能 `success`**（本屏把它换成独立那一档，不走 status）；
   *   · **服务端失败不指 `field`** —— 那类失败没有"哪个框错了"的答案
   *     （邮箱存在性故意不区分）。唯一例外是口令策略不合格：那一格确实错了。
   */
  const formStatus = (): AuthFormStatus | null => {
    if (phase.kind === 'failed') {
      const { key, vars } = phase;
      const isPolicy = key.startsWith('common.auth.policy.');
      return {
        tone: 'error',
        message: vars === undefined ? t(key) : t(key, vars),
        ...(isPolicy ? { field: 'password' as const } : {}),
      };
    }
    if (phase.kind === 'notice') return { tone: 'info', message: t(phase.key) };
    return null;
  };

  const labels: AuthFormLabels & {
    readonly otherWaysToggle: { readonly open: string; readonly close: string };
  } = {
    title: t('mobile.auth.title'),
    titleText: t('mobile.auth.title'),
    /*
      🔴 2026-10-26 产品负责人：「可以去掉绝大多数注册登录相关的说明文字……
      去掉所有说明文字，现在严禁有任何说明文字，除了必要的。」

      所以这里**没有 `subtitle`**：原来那段「用邮箱和密码注册或登录。登录成功后，
      服务器地址、访问令牌与端到端加密口令会自动接上同步。」说的是**这个产品怎么运作**，
      不是"你现在要做什么"—— 它属于文档中心，不属于登录框上方。

      留在这里的每一句都必须回答"现在该做什么 / 刚才发生了什么"：
      字段标签、错误句、验证码已发出、通行密钥不可用（点不动的原因）。
    */
    close: t('mobile.auth.back'),
    email: t('web.auth.email.label'),
    emailPlaceholder: t('web.auth.email.placeholder'),
    continue: t('common.auth.form.continue'),
    accountSummary: (email) => t('common.auth.form.accountSummary', { email }),
    changeEmail: t('common.auth.form.changeEmail'),
    // 🔴 「登录密码」，不是「密码」：另一个秘密是端到端加密口令，
    // 一句话同时指两样东西的界面，会让人以为忘了登录密码也就忘了数据。
    password: t(SIGN_IN_PASSWORD_LABEL_KEY),
    signIn: t('common.auth.form.signIn'),
    signUp: t('web.auth.register'),
    showPassword: t('common.auth.form.showPassword'),
    hidePassword: t('common.auth.form.hidePassword'),
    confirmPassword: t('common.auth.form.confirmPassword'),
    passwordMismatch: t('common.auth.form.passwordMismatch'),
    passwordConfirmationRequired: t('common.auth.form.passwordConfirmationRequired'),
    registrationCode: {
      title: t('web.auth.registrationCode.title'),
      sent: (email) => t('web.auth.registrationCode.sent', { email }),
      label: t('web.auth.registrationCode.label'),
      placeholder: t('web.auth.registrationCode.placeholder'),
      verify: t('web.auth.registrationCode.verify'),
      resend: t('web.auth.registrationCode.resend'),
      resendIn: (seconds) => t('web.auth.registrationCode.resendIn', { seconds }),
      changeEmail: t('web.auth.registrationCode.changeEmail'),
      expired: t('web.auth.registrationCode.expired'),
      codeLength: 6,
    },
    passwordStrength: {
      tooShort: (current, minimum) => t('common.auth.form.passwordStrength.tooShort', { current, min: minimum }),
      tooLong: (current, maximum) => t('common.auth.form.passwordStrength.tooLong', { current, max: maximum }),
      weak: t('common.auth.form.passwordStrength.weak'),
      fair: t('common.auth.form.passwordStrength.fair'),
      strong: t('common.auth.form.passwordStrength.strong'),
    },
    forgotPassword: t('common.auth.form.forgotPassword'),
    switchToRegister: t('common.auth.form.switchToRegister'),
    switchToSignIn: t('common.auth.form.switchToSignIn'),
    otherWays: t('common.auth.form.otherWays'),
    // 🔴 折叠是**信息架构**裁决（`ux-principles.md` §4「配置项默认收起」）：
    // 邮件链接、通行密钥、找回入口都是低频路，不该与主路平铺。
    otherWaysToggle: {
      open: t('common.auth.form.otherWaysOpen'),
      close: t('common.auth.form.otherWaysClose'),
    },
    terms: t('mobile.auth.terms.label'),
    magicLink: t('web.auth.sendLoginLink'),
    recovery: t('web.auth.recovery.request'),
    passkeyRegister: t('web.auth.passkey.register'),
    passkeyLogin: t('web.auth.passkey.login'),
    passkeyUnavailable: t('web.auth.passkey.unavailable'),
    passkeyWaiting: t('web.auth.passkey.waiting'),
    emptyTitle: '',
    emptyBody: '',
    localErrors: {
      baseUrl: t('common.auth.form.serverUrlRequired'),
      email: t('common.auth.form.emailRequired'),
      password: t('common.auth.form.passwordRequired'),
      // 「这一项必须由你自己做出」那半句不许丢：界面不许替他勾，也不许写成走过场。
      terms: (key) => t(key),
    },
    ...(busy && action !== undefined ? { busyText: t(BUSY_MESSAGE_KEY[action]) } : {}),
    // 地址只在这个壳**显式**允许时才出现，而且和粘贴令牌一起收在同一个展开入口里 ——
    // 与 Web 的 `advanced` 分组同一个裁决（两个来源 = 漂移）。
    ...(allowServerSelection
      ? {
          serverUrl: {
            label: t('web.auth.server.label'),
            placeholder: t('web.auth.server.placeholder'),
          },
          paste: {
            label: t('web.auth.paste.label'),
            placeholder: t('web.auth.paste.placeholder'),
            verify: t('web.auth.verify'),
          },
          advancedToggle: {
            open: t('web.auth.advanced.open'),
            close: t('web.auth.advanced.close'),
          },
        }
      : {}),
    ...(legalLinks === null
      ? {}
      : {
          legal: {
            terms: t('common.legal.termsDoc'),
            privacy: t('common.legal.privacyDoc'),
            ...(officialLegalLinks ? {} : { hrefs: legalLinks }),
          },
        }),
  };

  const waitingForPasskey = busy && (action === 'passkey-login' || action === 'passkey-register');

  /** 已经拿到令牌：停在第 ④ 步，等加密口令。 */
  const passphraseStep = session !== undefined || action === 'save';

  return (
    <View style={layout.root}>
      <ScrollView
        ref={scrollRef}
        // 🔴 内嵌档不自己滚：宿主那一层已经在滚，两层都能滚的话，
        //    手指在表单上滑会滑里层，滑到底也不继续 —— 用户以为页面卡住了。
        scrollEnabled={!embedded}
        style={embedded ? undefined : layout.fill}
        contentContainerStyle={{
          paddingHorizontal: embedded ? 0 : tokens['screen.gutter'],
          paddingTop: embedded ? 0 : tokens['space.4'],
          paddingBottom: embedded ? 0 : insets.bottom + tokens['space.6'],
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Animated.View style={[{ gap: tokens['space.4'] }, entryStyle]}>
          {passphraseStep && session !== undefined ? (
            <Card>
              <View style={layout.stack3}>
                <View style={layout.stack1}>
                  <Text variant="row-title" tone="success">
                    {t('mobile.auth.signedIn.title')}
                  </Text>
                  <Text variant="caption" tone="muted">
                    {t('mobile.auth.signedIn.body', { email: session.user.email })}
                  </Text>
                </View>
                {/*
                  🔴 **加密口令**那一栏。它与 AuthForm 里的「登录密码」是两个秘密，
                  而这个文件里只有这一个 state —— 它不进任何网络请求。
                */}
                <TextField
                  label={t(E2EE_PASSPHRASE_LABEL_KEY)}
                  value={passphrase}
                  onChangeText={setPassphrase}
                  secure
                />
                <Button
                  label={t('mobile.auth.enableSync')}
                  onPress={saveAndSync}
                  tone="primary"
                  icon="action.sync"
                  disabled={busy}
                  loading={action === 'save'}
                />
                <Pressable accessibilityRole="button" onPress={onBack} testID="mobile-central-auth-back">
                  <Text variant="caption" tone="primary">{t('mobile.auth.back')}</Text>
                </Pressable>
              </View>
            </Card>
          ) : centralMode ? (
            <Card>
              <View style={layout.stack3}>
                <View style={layout.stack1}>
                  <Text variant="section-title">{t('mobile.auth.title')}</Text>
                  <Text variant="caption" tone="muted">{t('mobile.auth.central.intro')}</Text>
                </View>
                {/* 状态区。失败用 danger，中性提示用 muted —— 两者**不能同色**，
                    否则"链接已发出"和"登录失败"在视觉上分不出来。 */}
                {phase.kind === 'failed' ? (
                  <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
                    {phase.vars === undefined ? t(phase.key) : t(phase.key, phase.vars)}
                  </Text>
                ) : null}
                {phase.kind === 'notice' ? (
                  <Text variant="caption" tone="muted" accessibilityLiveRegion="polite">
                    {t(phase.key)}
                  </Text>
                ) : null}
                <View style={layout.rowCenter}>
                  <Checkbox
                    checked={termsAccepted}
                    onToggle={() => setTermsAccepted((value) => !value)}
                    label={termsLabel}
                  />
                  <Text variant="caption" grow>{termsLabel}</Text>
                </View>
                {legalLinks !== null ? (
                  <View style={layout.rowLegal}>
                    <Pressable accessibilityRole="link" onPress={() => openLegalDocumentOrLink('terms')}>
                      <Text variant="caption" tone="primary">{t('common.legal.termsDoc')}</Text>
                    </Pressable>
                    <Pressable accessibilityRole="link" onPress={() => openLegalDocumentOrLink('privacy')}>
                      <Text variant="caption" tone="primary">{t('common.legal.privacyDoc')}</Text>
                    </Pressable>
                  </View>
                ) : null}
                <Button
                  label={t('mobile.auth.central.start')}
                  tone="primary"
                  onPress={() => { void startCentralLogin(); }}
                  disabled={busy || centralAttempt !== undefined}
                  loading={action === 'central-start'}
                  testID="mobile-central-auth-start"
                />
                {centralAttempt !== undefined ? (
                  <>
                    <Text variant="caption" tone="muted">{t('mobile.auth.central.pairing')}</Text>
                    <Text variant="row-title">{centralAttempt.pairingCode}</Text>
                    <Button
                      label={t('mobile.auth.central.openBrowser')}
                      onPress={() => {
                        void Linking.openURL(centralAttempt.launchUrl).catch(() => {
                          failWithKey('mobile.auth.link.unopenable');
                        });
                      }}
                      testID="mobile-central-auth-browser"
                    />
                  </>
                ) : null}
                {allowServerSelection ? (
                  <Pressable accessibilityRole="button" onPress={() => updateServerUrl('')}>
                    <Text variant="caption" tone="primary">{t('mobile.auth.selfHost.open')}</Text>
                  </Pressable>
                ) : null}
                <Pressable accessibilityRole="button" onPress={onBack}>
                  <Text variant="caption" tone="primary">{t('mobile.auth.back')}</Text>
                </Pressable>
              </View>
            </Card>
          ) : (
            <AuthForm
              labels={labels}
              onClose={onBack}
              platform="mobile"
              status={formStatus()}
              busy={busy}
              passkeyAvailable={passkeyProvider !== undefined}
              waitingForPasskey={waitingForPasskey}
              /* 🔴 **不给 `initialPassword`**：那个 prop 是「登录密码」的预填，
                 而本壳手里只有加密口令 —— 接错这一根线就是把
                 设计上不该出设备的秘密预填进要发出去的框里。 */
              onSignIn={({ email, password }) => { void login(email, password); }}
              onRegister={({ email, password, termsAccepted: accepted }) => {
                void register(email, password, accepted);
              }}
              {...(phase.kind === 'registration-code'
                ? {
                    registrationChallenge: {
                      email: phase.email,
                      expiresAt: phase.expiresAt,
                      resendAvailableAt: phase.resendAvailableAt,
                      onVerify: (code: string) => { void verifyRegistrationCode(code); },
                      onResend: () => { void resendRegistrationCode(); },
                      onChangeEmail: cancelRegistrationCode,
                    },
                  }
                : {})}
              onMagicLink={(email) => { void sendLoginLink(email); }}
              onPasskey={({ kind, email, termsAccepted: accepted }) => {
                if (kind === 'register') {
                  void passkeyRegister(email, accepted);
                  return;
                }
                void passkeyLogin(email);
              }}
              onRecovery={(email) => { void recoverPasskey(email); }}
              onForgotPassword={(email) => { void forgotPassword(email); }}
              onVerifyToken={(token) => { void redeemPasted(token); }}
              onOpenLegal={(kind) => openLegalDocumentOrLink(kind)}
              {...(allowServerSelection
                ? { serverUrl: { value: serverUrl, onChange: updateServerUrl } }
                : {})}
              testID="mobile-auth-form"
            />
          )}
        </Animated.View>
      </ScrollView>

      {openLegalDocument !== null ? (() => {
        const document = legalDocumentPresentation(legalDocumentById(openLegalDocument));
        return (
          <LegalDocumentSheet
            document={document}
            locale={locale}
            labels={{
              close: t('web.auth.close'),
              meta: t('site.legal.meta', { version: document.version, date: document.updatedDate }),
              status: document.status === 'draft' ? t('site.legal.draft.banner') : undefined,
            }}
            visible
            onClose={() => setOpenLegalDocument(null)}
            onDocumentReference={setOpenLegalDocument}
            testID="mobile-auth-legal-sheet"
          />
        );
      })() : null}
    </View>
  );
}
