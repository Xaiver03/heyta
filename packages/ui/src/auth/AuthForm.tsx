/**
 * `AuthForm` —— 登录 / 注册的**唯一一份**表单
 * ============================================
 *
 * ## 它补的是什么
 *
 * `docs/plans/user-journey-and-auth.md` §10.1 记的实测数字：web 的 `AuthPanel.tsx`
 * 484 行、mobile 的 `AuthScreen.tsx` 403 行，**同一件事做了两遍**，
 * 连"失败原因 → 句子"都各写一份。ADR-0036 把 UI 单源定成已接受的决策，
 * 而认证是**最不该漂移**的那一块：两端对同一次失败说不同的话，
 * 或把"注册成功"承诺成"已经登录好了"，都是用户可见的行为不一致。
 *
 * 本文件是那一半欠着的**组件那一半**（`authFailureMessageKey` 那半早已收进 `model.ts`）。
 *
 * ## 🔴 命名：这里叫 `AuthForm`，不叫 `AuthPanel`
 *
 * §10.3 原本写的是 `packages/ui/src/auth/AuthPanel.tsx`。改名的唯一理由是
 * 各端的**外壳**本来就叫 `AuthPanel` / `AuthScreen`：同名的两份东西（一份是被包装的表单、
 * 一份是包装它的壳）会让读代码的人先猜哪份是哪份。形状没变。
 *
 * ## 两步，而不是两个入口
 *
 * 一个邮箱框 +「继续」，口令紧随其后 —— FIDO 2023 UX Guidelines 的结论：
 * **一个 affordance 同时管注册与登录**比"注册藏在登录后面"更可发现。
 * 于是界面**不许**问用户"你是新来的吗"：他不知道，而且这个实例上他可能就是第一次来。
 *
 * ## 🔴 为什么这个组件**不知道**任何协议
 *
 * 端点、请求体、`inviteCode` 原样发出、失败归类、口令策略的**裁决** ——
 * 全部在 `@heyta/app-host` 与服务端（AGENTS §3.5）。本组件只做三件事：
 * 收输入、把宿主给的句子渲染出来、把用户意图交回宿主。
 * 所以这里**不判**邮箱格式、**不判**口令长度：判了就是第二套规则，
 * 而两套规则迟早给出两个答案（NIST 禁止组成规则；长度按码点算，UTF-16 数法会截断）。
 *
 * ## 文案不进这个包
 *
 * `labels` 由宿主用 `t()` 解析后传进来（`SearchPanelLabels` 的既有模式）。
 * `packages/ui` import `@heyta/i18n` 会拖进**第二份 React** —— 本仓为此崩过一次。
 * 但**哪些 key 存在**是这里的判断：见 `model.ts` 的 `authFailureMessageKey` /
 * `passwordPolicyMessageKey` / 两个秘密的命名常量。
 *
 * ## 显隐、autofill、错误
 *
 * - **显隐**：桌面默认遮、移动默认显示（NNG《Stop Password Masking》+ NIST），
 *   两档都**保留**开关 —— 默认值不是能力。开关是真 `Pressable` + 平铺 `aria-pressed`，
 *   图标用 Lucide（§5：不许 emoji）。
 * - 🔴 **无障碍属性一律平铺**（`aria-pressed` / `aria-invalid` / `aria-checked`），
 *   **不许**用对象形态 `accessibilityState`：`react-native-web@0.21.3` 会把对象形态
 *   **整个丢掉**（属性根本不进 DOM），而原生两端照常 —— 于是同一个组件在 web 上
 *   静默失去无障碍状态，且没有任何测试会红。判据是 `pnpm check:rn-aria`。
 * - **autofill 是功能不是装饰**：取值由 `model.ts` 给（`current-password` vs
 *   `new-password` 用反了，管理器会把**旧口令**填进注册表单，用户看到的是
 *   "我明明填了新口令却注册失败"）。
 * - 🔴 **没有 `maxLength`**：NIST 明确禁止静默截断口令输入。
 *   超长由服务端按**码点**判并给 `too_long` 那句 —— 界面自己截掉是数据丢失。
 * - **按钮不禁用**：禁用态按钮让人困惑（NNG），提交后禁用会丢焦点。
 *   所以这里用 in-flight guard（`busy` 时直接不响应）+ 明确的进行中句子。
 * - **错误是文字**：WCAG SC 3.3.1 不许只靠红框；`accessibilityLiveRegion`（web = `aria-live`）
 *   播报；**保留用户已输入的内容**；本地校验失败时焦点移到第一个错误字段（GOV.UK）。
 */

import React, { useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Check, Eye, EyeOff, KeyRound, Loader2, Mail, X } from 'lucide';

import type { HeytaNativeTokens } from '@heyta/design-system';

import { HeytaIcon } from '../icon/Icon.js';
import { useHeytaText, useHeytaTokens } from '../theme.js';
import {
  AUTH_EMAIL_AUTOCOMPLETE,
  AUTH_TERMS_REQUIRED_KEY,
  authFormStageAfterContinue,
  defaultPasswordRevealed,
  firstAuthErrorField,
  passwordAutocomplete,
  type AuthFormMode,
  type AuthFormField,
  type AuthFormStage,
} from './model.js';

/* ========================================================================
 * 文案：全部由宿主解析后传进来
 * ====================================================================== */

export interface AuthFormLabels {
  /** 表单区的无障碍名。界面上**不出现**这行字（标题另有 `titleText`）。 */
  readonly title: string;
  readonly titleText: string;
  readonly close: string;
  readonly email: string;
  readonly emailPlaceholder: string;
  readonly continue: string;
  /** 「登录到：xxx」—— 第二步上面那一行身份回执。 */
  readonly accountSummary: (email: string) => string;
  readonly changeEmail: string;
  /** 🔴 「登录密码」（与「加密口令」是两条词条，见 `model.ts` 末尾）。 */
  readonly password: string;
  readonly passwordPlaceholder?: string;
  readonly signIn: string;
  readonly signUp: string;
  readonly showPassword: string;
  readonly hidePassword: string;
  /** 「长一句比加符号有用」那一句。 */
  readonly passwordHint: string;
  readonly forgotPassword: string;
  readonly switchToRegister: string;
  readonly switchToSignIn: string;
  readonly otherWays: string;
  readonly terms: string;
  readonly magicLink: string;
  readonly recovery: string;
  readonly passkeyRegister: string;
  readonly passkeyLogin: string;
  readonly passkeyUnavailable: string;
  readonly passkeyWaiting: string;
  readonly emptyTitle: string;
  readonly emptyBody: string;
  /**
   * 有请求在路上时的那一句（"正在发送…"）。
   *
   * 🔴 它**不能**由 `otherWays` 那类固定文案顶替：进行中必须说的是**在做什么**，
   * 一句与动作无关的话会让用户以为界面在胡言乱语，反而去点第二次。
   */
  readonly busyText?: string;
  /** 邀请码（选填）。不给就整块不渲染 —— 没有邀请机制的实例不该出现这一栏。 */
  readonly invite?: {
    readonly label: string;
    readonly placeholder: string;
    readonly invalid: (length: number) => string;
  };
  /** 未配置服务端地址时的那一栏。给了 `serverUrl` 才会出现。 */
  readonly serverUrl?: {
    readonly label: string;
    readonly placeholder: string;
  };
  /** 粘贴链接 / 令牌那一栏（自托管与桌面回跳的逃生门）。 */
  readonly paste?: {
    readonly label: string;
    readonly placeholder: string;
    readonly verify: string;
  };
  /** 条款两条链接的**文字**（地址由宿主的 `legalLinks` 决定，这里不拼 URL）。 */
  readonly legal?: {
    readonly terms: string;
    readonly privacy: string;
    /**
     * 两条链接的**落点地址**。给了并且在 web 上，就渲染真的 `<a href>`；
     * 不给则退回 `Pressable` + `onOpenLegal`（原生壳那边交给 `Linking.openURL`）。
     *
     * 🔴 为什么 web 上必须是真的 `<a>`：一条"看起来能点、其实是个 div"的链接
     * 拿不到中键/⌘ 点击、没有状态栏预览、右键也复制不了地址。而这里的判据不是审美 ——
     * 要求用户同意一份政策，就必须让他能用他习惯的任何方式把它打开。
     */
    readonly hrefs?: { readonly terms: string; readonly privacy: string };
  };
  /** 本地校验的句子（空地址 / 空邮箱 / 空口令 / 没勾同意项）。 */
  readonly localErrors: {
    readonly baseUrl: string;
    readonly email: string;
    readonly password: string;
    readonly terms: (key: typeof AUTH_TERMS_REQUIRED_KEY) => string;
  };
}

/* ========================================================================
 * 状态：宿主把 `reason` 翻成句子之后交给这里渲染
 * ====================================================================== */

export interface AuthFormStatus {
  /**
   * `error` 用危险色、`success` 用成功色、`info` 用正文色。
   *
   * 🔴 刻意**不叫** `busy`：进行中是 `busy` prop，不是一种消息。
   * 把"正在发送"当成一种 tone，就会出现"进度句子用成功色"那种半截谎言。
   */
  readonly tone: 'error' | 'success' | 'info';
  readonly message: string;
  /**
   * 这句挂在哪一个字段上（决定哪个输入框带 `aria-invalid`）。
   *
   * ⚠️ 服务端失败**不填**这一项：那类失败没有"哪个框错了"的答案
   * （邮箱存在性故意不区分），硬标一个框就是在替服务端猜原因。
   */
  readonly field?: AuthFormField;
  /**
   * 跟在 `message` 下面的第二句（**成功态**专用，比如已登录后补一句"是谁在登录"）。
   *
   * 为什么要单独一个字段而不是让宿主把两句拼成一条字符串：拼起来的那条会挤掉
   * `row-meta` 的换行，而"登录成功"与"登录到哪个邮箱"是两件事 ——
   * 屏幕阅读器读成两句才听得出来第二句是补充信息。
   */
  readonly detail?: string;
}

export interface AuthFormProps {
  readonly labels: AuthFormLabels;
  readonly onClose: () => void;
  /**
   * 显隐默认档。**不给就按当前平台判**（`Platform.OS === 'web'` 算桌面）。
   * 宿主可以覆盖 —— 但覆盖要有理由：那一档是 NNG/NIST 的结论，不是审美。
   */
  readonly platform?: 'desktop' | 'mobile';
  readonly status?: AuthFormStatus | null;
  /**
   * 🔴 有请求在路上。这一段是**守卫**而不是样式：
   * `busy` 时所有提交入口直接不响应，而按钮**不禁用**（禁用会丢焦点）。
   */
  readonly busy?: boolean;
  /** 这台设备**没有**通行密钥能力（宿主探测的结果）。 */
  readonly passkeyAvailable?: boolean;
  /** 正在等系统弹窗 —— 必须说"去看弹窗"，否则用户以为界面卡住。 */
  readonly waitingForPasskey?: boolean;
  readonly initialEmail?: string;
  readonly initialInviteCode?: string;
  /** 未配置服务端地址时的那一栏（值 + 回调都在宿主）。 */
  readonly serverUrl?: { readonly value: string; readonly onChange: (value: string) => void };
  /** 邀请码形状不对时给 `true`（权威判定在服务端，这里只提前说一句）。 */
  readonly inviteInvalid?: boolean;
  readonly inviteCodeLength?: number;
  /**
   * 邀请码**改动时**把它交回宿主。
   *
   * 🔴 为什么薄壳**必须**拿到这一份：邀请码的归一化规则（大写、去连字符与空格、
   * 去掉零宽字符）在 `@heyta/domain`，而**形状是否合法**要用归一化**之后**的值去判 ——
   * 那些都不是这个组件的裁决（它不判格式，见文件头）。不交出去，宿主就只能对着
   * `initialInviteCode` 那个**挂载时**的旧值算，于是"粘进一个带空格的码"永远判不出对。
   *
   * ⚠️ 它是**只出不进**的镜像，不是受控值：受控要连 `value` 一起给，而这里没有那个
   * 需求 —— 宿主拿它只是为了**提前说一句**（以及决定发不发），不需要改写用户正在打的字。
   */
  readonly onInviteCodeChange?: (code: string) => void;
  readonly onSignIn: (input: { email: string; password: string }) => void;
  readonly onRegister: (input: {
    email: string;
    password: string;
    termsAccepted: boolean;
    inviteCode?: string;
  }) => void;
  readonly onMagicLink: (email: string) => void;
  readonly onPasskey: (input: {
    kind: 'register' | 'login';
    email: string;
    password: string;
    termsAccepted: boolean;
    inviteCode?: string;
  }) => void;
  readonly onRecovery: (email: string) => void;
  readonly onForgotPassword: (email: string) => void;
  readonly onVerifyToken?: (token: string) => void;
  /** 点两条条款链接。地址与打开方式都是宿主的决定。 */
  readonly onOpenLegal?: (kind: 'terms' | 'privacy') => void;
  readonly testID?: string;
}

/**
 * 组件自己的**视图态**：字段内容、两步、模式、显隐、本地错误。
 *
 * 🔴 这些都不进 store、不进 op-log —— 它们是"此刻屏幕上有什么"。
 * 口令尤其**只活在组件本地 state**：一旦进 store 就等着被写进持久化层、
 * 被日志打印、被同步带出去（本仓库对"口令出现在不该出现的地方"零容忍）。
 */
export function AuthForm({
  labels,
  onClose,
  platform,
  status = null,
  busy = false,
  passkeyAvailable = true,
  waitingForPasskey = false,
  initialEmail = '',
  initialInviteCode = '',
  serverUrl,
  inviteInvalid = false,
  inviteCodeLength,
  onInviteCodeChange,
  onSignIn,
  onRegister,
  onMagicLink,
  onPasskey,
  onRecovery,
  onForgotPassword,
  onVerifyToken,
  onOpenLegal,
  testID = 'auth-form',
}: AuthFormProps): React.JSX.Element {
  const tokens = useHeytaTokens();
  const text = useHeytaText();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);

  const resolvedPlatform = platform ?? (Platform.OS === 'web' ? 'desktop' : 'mobile');

  const [stage, setStage] = useState<AuthFormStage>('identify');
  const [mode, setMode] = useState<AuthFormMode>('sign-in');
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [revealed, setRevealed] = useState(defaultPasswordRevealed(resolvedPlatform));
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [inviteCode, setInviteCode] = useState(initialInviteCode);
  const [token, setToken] = useState('');
  /** 本地校验的错误字段（提交时算一次；输入时**不**逐键校验）。 */
  const [localField, setLocalField] = useState<AuthFormField | undefined>(undefined);

  const emailInput = useRef<TextInput | null>(null);
  const passwordInput = useRef<TextInput | null>(null);

  /**
   * 此刻该报错的字段：本地校验的，或宿主指明的（`status.field`）。
   * 两者互斥出现 —— 服务端失败刻意不标字段（见 `AuthFormStatus.field`）。
   */
  const errorField: AuthFormField | undefined =
    status?.tone === 'error' ? status.field : localField;

  const invalidFor = (field: AuthFormField): boolean => errorField === field;

  /**
   * in-flight guard：有请求在路上就**不响应**。
   *
   * 🔴 它代替的是"把按钮禁用掉"：禁用态按钮让人困惑（NNG），而提交后禁用
   * 会把焦点从用户正站着的地方抽走。控件保持可用，动作只放行一次。
   */
  const idleOnly = (action: () => void): void => {
    if (busy) return;
    action();
  };

  /** 给 `onPress` 用的形态（`idleOnly` 是个函数调用，不能直接当 handler 交出去）。 */
  const guard = (action: () => void): (() => void) => () => idleOnly(action);

  const onContinue = (): void => {
    setLocalField(undefined);
    if (email.trim() === '') {
      setLocalField('email');
      emailInput.current?.focus();
      return;
    }
    setStage(authFormStageAfterContinue({ stage, email }));
  };

  const onSubmit = (): void => {
    const missing = firstAuthErrorField({
      baseUrlMissing: serverUrl !== undefined && serverUrl.value.trim() === '',
      emailMissing: email.trim() === '',
      passwordMissing: password === '',
      termsMissing: mode === 'register' && !termsAccepted,
    });
    if (missing !== undefined) {
      setLocalField(missing);
      if (missing === 'email') emailInput.current?.focus();
      if (missing === 'password') passwordInput.current?.focus();
      return;
    }
    setLocalField(undefined);
    idleOnly(() => {
      if (mode === 'sign-in') {
        onSignIn({ email, password });
        return;
      }
      onRegister({
        email,
        password,
        termsAccepted,
        ...(inviteCode === '' || inviteInvalid ? {} : { inviteCode }),
      });
    });
  };

  /**
   * 「继续」之后邮箱框**收起来**，身份以一行的形式回执。
   *
   * 理由不是省地方：邮箱此时已经决定"这是哪个账号"，继续显示一个可编辑的框，
   * 用户会改它而**不重新走「继续」** —— 于是口令打在 A、界面还显示改后的 B。
   * 要点开才能改，就是把这件事变成一次显式动作。
   */
  return (
    <View
      accessibilityRole="summary"
      accessibilityLabel={labels.title}
      testID={testID}
      style={styles.root}
    >
      <View style={styles.head}>
        <Text style={[text['section-title'], styles.title]} accessibilityRole="header">
          {labels.titleText}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={labels.close}
          hitSlop={tokens['gesture.hit-slop']}
          onPress={onClose}
          style={({ pressed }) => [styles.close, pressed ? styles.pressed : null]}
          testID={`${testID}-close`}
        >
          <HeytaIcon
            data={X}
            size={tokens['icon.sm']}
            color={tokens['color.foreground-muted']}
          />
        </Pressable>
      </View>

      {/* 状态 / 空状态：一条 **live region**（web 落 `aria-live`）。 */}
      <View
        accessibilityLiveRegion="polite"
        style={styles.status}
        testID={`${testID}-status`}
      >
        {status === null ? (
          <>
            <Text style={[text['row-title'], styles.statusStrong]}>{labels.emptyTitle}</Text>
            <Text style={[text['row-meta'], styles.muted]}>{labels.emptyBody}</Text>
          </>
        ) : (
          <>
            <Text
              style={[
                text['row-meta'],
                status.tone === 'error'
                  ? styles.danger
                  : status.tone === 'success'
                    ? styles.success
                    : styles.muted,
              ]}
            >
              {status.message}
            </Text>
            {status.detail === undefined ? null : (
              <Text style={[text['row-meta'], styles.muted]}>{status.detail}</Text>
            )}
          </>
        )}
        {busy && labels.busyText !== undefined ? (
          <View style={styles.busyRow} testID={`${testID}-busy`}>
            <HeytaIcon
              data={Loader2}
              size={tokens['icon.xs']}
              color={tokens['color.foreground-muted']}
            />
            <Text style={[text['caption'], styles.muted]}>{labels.busyText}</Text>
          </View>
        ) : null}
      </View>

      {stage === 'identify' ? (
        <View style={styles.field}>
          <Text style={[text['caption'], styles.muted]}>{labels.email}</Text>
          <TextInput
            ref={emailInput}
            value={email}
            onChangeText={(next) => {
              setEmail(next);
              if (localField === 'email') setLocalField(undefined);
            }}
            placeholder={labels.emailPlaceholder}
            placeholderTextColor={tokens['color.foreground-subtle']}
            // 🔴 `username webauthn`：允许口令管理器填，也让浏览器在这个字段上
            // 提议通行密钥（FIDO 混合登录）。RN 的类型联合里**没有**这一串 ——
            // 它早于 WebAuthn 的 autofill 规范 —— 所以唯一的 cast 点在
            // `model.ts` 的那个常量上；原生端忽略这个字符串，web 端
            // （react-native-web 把它原样落到 DOM 的 `autocomplete`）才是它起作用的地方。
            autoComplete={AUTH_EMAIL_AUTOCOMPLETE as 'username'}
            inputMode="email"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            style={[text['row-title'], styles.input]}
            accessibilityLabel={labels.email}
            aria-invalid={invalidFor('email')}
            testID={`${testID}-email`}
          />
          {invalidFor('email') ? (
            <Text style={[text['caption'], styles.danger]}>{labels.localErrors.email}</Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            onPress={onContinue}
            style={({ pressed }) => [styles.primary, pressed ? styles.primaryPressed : null]}
            testID={`${testID}-continue`}
          >
            <HeytaIcon
              data={Mail}
              size={tokens['icon.xs']}
              color={tokens['color.on-primary']}
            />
            <Text style={[text['headline'], styles.primaryLabel]}>{labels.continue}</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.field}>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              // 回到第一步时**不清空**已输入的口令：用户可能只是改个字母。
              setStage('identify');
              setLocalField(undefined);
            }}
            style={({ pressed }) => [styles.identityRow, pressed ? styles.pressed : null]}
            testID={`${testID}-change-email`}
          >
            <Text style={[text['row-meta'], styles.identityText]} numberOfLines={1}>
              {labels.accountSummary(email)}
            </Text>
            <Text style={[text['caption'], styles.linkText]}>{labels.changeEmail}</Text>
          </Pressable>

          <Text style={[text['caption'], styles.muted]}>{labels.password}</Text>
          <View style={styles.passwordRow}>
            <TextInput
              ref={passwordInput}
              value={password}
              onChangeText={(next) => {
                // 🔴 原样收下：不 normalize、不 trim、不改大小写。
                // 归一化只在服务端一处发生（存的与验的都是它归一化后的串）。
                setPassword(next);
                if (localField === 'password') setLocalField(undefined);
              }}
              placeholder={labels.passwordPlaceholder}
              placeholderTextColor={tokens['color.foreground-subtle']}
              secureTextEntry={!revealed}
              autoComplete={passwordAutocomplete(mode)}
              autoCapitalize="none"
              autoCorrect={false}
              // 🔴 **没有** maxLength：NIST 禁止静默截断口令输入。
              style={[text['row-title'], styles.input, styles.passwordInput]}
              accessibilityLabel={labels.password}
              aria-invalid={invalidFor('password')}
              testID={`${testID}-password`}
            />
            {/*
              显隐开关。**默认值不是能力**：两档都有这一个按钮。
              平铺 `aria-pressed`（web 落 `aria-pressed`），所以读屏用户听到的是
              "已选中：显示密码"，而不是"一个按钮"。
            */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={revealed ? labels.hidePassword : labels.showPassword}
              aria-pressed={revealed}
              hitSlop={tokens['gesture.hit-slop']}
              onPress={() => setRevealed((v) => !v)}
              style={({ pressed }) => [styles.reveal, pressed ? styles.pressed : null]}
              testID={`${testID}-reveal`}
            >
              <HeytaIcon
                data={revealed ? EyeOff : Eye}
                size={tokens['icon.sm']}
                color={tokens['color.foreground-muted']}
              />
            </Pressable>
          </View>
          {invalidFor('password') ? (
            <Text style={[text['caption'], styles.danger]}>{labels.localErrors.password}</Text>
          ) : null}
          <Text style={[text['caption'], styles.muted]}>{labels.passwordHint}</Text>

          {mode === 'register' ? (
            <>
              {labels.invite !== undefined ? (
                <View style={styles.field}>
                  <Text style={[text['caption'], styles.muted]}>{labels.invite.label}</Text>
                  <TextInput
                    value={inviteCode}
                    onChangeText={(next) => {
                      // 内部照旧存着（提交时由 `inviteInvalid` 决定发不发），
                      // 同时把这一份交回宿主 —— 归一化与形状判定都在宿主那侧。
                      setInviteCode(next);
                      onInviteCodeChange?.(next);
                    }}
                    placeholder={labels.invite.placeholder}
                    placeholderTextColor={tokens['color.foreground-subtle']}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    autoComplete="off"
                    style={[text['row-title'], styles.input]}
                    accessibilityLabel={labels.invite.label}
                    aria-invalid={inviteInvalid}
                    testID={`${testID}-invite`}
                  />
                  {inviteInvalid && inviteCodeLength !== undefined ? (
                    <Text style={[text['caption'], styles.danger]}>
                      {labels.invite.invalid(inviteCodeLength)}
                    </Text>
                  ) : null}
                </View>
              ) : null}

              {/*
                同意项。**它不是样式，是一段必须由用户自己做出的决定**，
                所以用真的 `role="checkbox"` + `aria-checked`（平铺形态，理由见文件头），
                而不是"一个会变色的方块"。
              */}
              <Pressable
                accessibilityRole="checkbox"
                aria-checked={termsAccepted}
                onPress={() => {
                  setTermsAccepted((v) => !v);
                  if (localField === 'terms') setLocalField(undefined);
                }}
                style={styles.termsRow}
                testID={`${testID}-terms`}
              >
                <View style={[styles.checkbox, termsAccepted ? styles.checkboxOn : null]}>
                  {termsAccepted ? (
                    <HeytaIcon
                      data={Check}
                      size={tokens['icon.xs']}
                      color={tokens['color.on-primary']}
                    />
                  ) : null}
                </View>
                <Text style={[text['caption'], styles.termsText]}>{labels.terms}</Text>
              </Pressable>
              {invalidFor('terms') ? (
                <Text style={[text['caption'], styles.danger]}>
                  {labels.localErrors.terms(AUTH_TERMS_REQUIRED_KEY)}
                </Text>
              ) : null}
              {labels.legal !== undefined ? (
                labels.legal.hrefs !== undefined && Platform.OS === 'web' ? (
                  <View style={styles.legalRow} testID={`${testID}-legal`}>
                    <Text style={[text['row-meta'], styles.linkText]}>
                      <a
                        href={labels.legal.hrefs.terms}
                        target="_blank"
                        rel="noopener noreferrer"
                        data-testid={`${testID}-legal-terms`}
                      >
                        {labels.legal.terms}
                      </a>
                    </Text>
                    <Text style={[text['row-meta'], styles.linkText]}>
                      <a
                        href={labels.legal.hrefs.privacy}
                        target="_blank"
                        rel="noopener noreferrer"
                        data-testid={`${testID}-legal-privacy`}
                      >
                        {labels.legal.privacy}
                      </a>
                    </Text>
                  </View>
                ) : (
                  <View style={styles.legalRow} testID={`${testID}-legal`}>
                    <Pressable
                      accessibilityRole="link"
                      onPress={guard(() => onOpenLegal?.('terms'))}
                      style={({ pressed }) => [styles.link, pressed ? styles.pressed : null]}
                      testID={`${testID}-legal-terms`}
                    >
                      <Text style={[text['row-meta'], styles.linkText]}>{labels.legal.terms}</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="link"
                      onPress={guard(() => onOpenLegal?.('privacy'))}
                      style={({ pressed }) => [styles.link, pressed ? styles.pressed : null]}
                      testID={`${testID}-legal-privacy`}
                    >
                      <Text style={[text['row-meta'], styles.linkText]}>
                        {labels.legal.privacy}
                      </Text>
                    </Pressable>
                  </View>
                )
              ) : null}
            </>
          ) : null}

          {/*
            主按钮：登录或创建账号。
            🔴 `busy` 时**不禁用**（丢焦点），由 in-flight guard 不响应第二次提交。
          */}
          <Pressable
            accessibilityRole="button"
            onPress={guard(onSubmit)}
            style={({ pressed }) => [styles.primary, pressed ? styles.primaryPressed : null]}
            testID={`${testID}-submit`}
          >
            <Text style={[text['headline'], styles.primaryLabel]}>
              {mode === 'sign-in' ? labels.signIn : labels.signUp}
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={() => {
              const next: AuthFormMode = mode === 'sign-in' ? 'register' : 'sign-in';
              setMode(next);
              setLocalField(undefined);
            }}
            style={({ pressed }) => [styles.textAction, pressed ? styles.pressed : null]}
            testID={`${testID}-switch-mode`}
          >
            <Text style={[text['row-meta'], styles.linkText]}>
              {mode === 'sign-in' ? labels.switchToRegister : labels.switchToSignIn}
            </Text>
          </Pressable>

          {mode === 'sign-in' ? (
            <Pressable
              accessibilityRole="button"
              onPress={guard(() => onForgotPassword(email))}
              style={({ pressed }) => [styles.textAction, pressed ? styles.pressed : null]}
              testID={`${testID}-forgot`}
            >
              <Text style={[text['row-meta'], styles.linkText]}>{labels.forgotPassword}</Text>
            </Pressable>
          ) : null}
        </View>
      )}

      {/*
        ── 二级链：通行密钥**从大按钮降级为文字**（FIDO 2023 UX Guidelines）──

        依据：autofill 的成功率最高，而"专用 passkey 按钮"因为人们记不得自己建过
        而**没有被发现**。所以这里它排在口令之后，样式与「忘记密码」同级。
        不支持时**不禁用、而是说明原因** —— 禁用了却不说，用户只会以为界面坏了。
      */}
      {stage === 'credential' ? (
        <View style={styles.secondary}>
          <Text style={[text['caption'], styles.muted]}>{labels.otherWays}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={guard(() =>
              onPasskey({
                kind: mode === 'sign-in' ? 'login' : 'register',
                email,
                password,
                termsAccepted,
                ...(inviteCode === '' || inviteInvalid ? {} : { inviteCode }),
              }),
            )}
            style={({ pressed }) => [styles.textAction, pressed ? styles.pressed : null]}
            testID={`${testID}-passkey`}
          >
            <HeytaIcon
              data={KeyRound}
              size={tokens['icon.xs']}
              color={tokens['color.foreground-muted']}
            />
            <Text style={[text['row-meta'], styles.linkText]}>
              {mode === 'sign-in' ? labels.passkeyLogin : labels.passkeyRegister}
            </Text>
          </Pressable>
          {!passkeyAvailable ? (
            <Text style={[text['caption'], styles.muted]}>{labels.passkeyUnavailable}</Text>
          ) : null}
          {waitingForPasskey ? (
            <Text style={[text['caption'], styles.muted]}>{labels.passkeyWaiting}</Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            onPress={guard(() => onMagicLink(email))}
            style={({ pressed }) => [styles.textAction, pressed ? styles.pressed : null]}
            testID={`${testID}-magic-link`}
          >
            <Text style={[text['row-meta'], styles.linkText]}>{labels.magicLink}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={guard(() => onRecovery(email))}
            style={({ pressed }) => [styles.textAction, pressed ? styles.pressed : null]}
            testID={`${testID}-recovery`}
          >
            <Text style={[text['row-meta'], styles.linkText]}>{labels.recovery}</Text>
          </Pressable>
        </View>
      ) : null}

      {/*
        ── 服务端地址：**表格里最后一栏，不是第一栏**（2026-10-01）──

        🔴 它原来在邮箱**上面**。那个位置本身就是产品负责人点名要拆掉的那道墙：
        「绝对不允许什么用自己正在用的域名才能够注册，不可能是这样子的。」
        一张表单的第一栏要用户写出同步域名，等于把"你是自建部署的运维吗"当成注册前置条件。

        两条配套纪律，缺一条这道墙就会以另一种形式回来：
          1. **宿主负责给一个预填好的值**（web 是 `已配置的 > VITE_SYNC_URL > 本机来源`，
             见 `apps/web/src/lib/auth-endpoint.ts`）。这里不许出现"空着等用户填"的默认态；
          2. 宿主**可以不传** `serverUrl` —— 那一栏就不存在（`baseUrlMissing` 也就永远不成立）。
        ⚠️ 位置变了，但 `baseUrlMissing` 的判定与 `firstAuthErrorField` 的顺序**没动**：
        自建用户把地址清空时仍然会被指到那一栏，只是它现在在下方。
      */}
      {serverUrl !== undefined && labels.serverUrl !== undefined ? (
        <View style={styles.field}>
          <Text style={[text['caption'], styles.muted]}>{labels.serverUrl.label}</Text>
          <TextInput
            value={serverUrl.value}
            onChangeText={serverUrl.onChange}
            placeholder={labels.serverUrl.placeholder}
            placeholderTextColor={tokens['color.foreground-subtle']}
            autoComplete="url"
            inputMode="url"
            // 🔴 没有 maxLength（见文件头）。
            style={[text['row-title'], styles.input]}
            accessibilityLabel={labels.serverUrl.label}
            aria-invalid={invalidFor('baseUrl')}
            testID={`${testID}-server-url`}
          />
          {invalidFor('baseUrl') ? (
            <Text style={[text['caption'], styles.danger]}>{labels.localErrors.baseUrl}</Text>
          ) : null}
        </View>
      ) : null}

      {labels.paste !== undefined && onVerifyToken !== undefined ? (
        <View style={styles.field}>
          <Text style={[text['caption'], styles.muted]}>{labels.paste.label}</Text>
          <TextInput
            value={token}
            onChangeText={setToken}
            placeholder={labels.paste.placeholder}
            placeholderTextColor={tokens['color.foreground-subtle']}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect={false}
            style={[text['row-title'], styles.input]}
            accessibilityLabel={labels.paste.label}
            testID={`${testID}-paste`}
          />
          <Pressable
            accessibilityRole="button"
            onPress={guard(() => {
              onVerifyToken(token);
              setToken('');
            })}
            style={({ pressed }) => [styles.ghost, pressed ? styles.pressed : null]}
            testID={`${testID}-verify`}
          >
            <Text style={[text['row-title'], styles.ghostText]}>{labels.paste.verify}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function makeStyles(tokens: HeytaNativeTokens) {
  return StyleSheet.create({
    root: {
      gap: tokens['space.3'],
    },
    head: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: tokens['space.2'],
    },
    title: {
      flex: 1,
      color: tokens['color.foreground'],
    },
    close: {
      marginLeft: 'auto',
      minHeight: tokens['touch-target.min'],
      minWidth: tokens['touch-target.min'],
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: tokens['radius.md'],
    },
    status: {
      gap: tokens['space.1'],
    },
    statusStrong: { color: tokens['color.foreground'] },
    muted: { color: tokens['color.foreground-muted'] },
    danger: { color: tokens['color.danger'] },
    success: { color: tokens['color.success'] },
    busyRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: tokens['space.1'],
    },
    field: {
      gap: tokens['space.1'],
    },
    input: {
      minHeight: tokens['size.field-height'],
      paddingHorizontal: tokens['space.2'],
      borderRadius: tokens['radius.md'],
      borderWidth: tokens['border-width.thin'],
      borderColor: tokens['color.border'],
      backgroundColor: tokens['color.background'],
      color: tokens['color.foreground'],
      // 🔴 字号走 `text['row-title']`（`font-size.base` = 16）整条带上 ——
      // 低于 16px 时 iOS 聚焦会**自动放大整个页面**，且不会缩回去。
      // 焦点环不许抹掉（§5：用 `:focus-visible`），这里只把 RN 默认的 outline 宽度归零，
      // web 侧的焦点样式由 `apps/web` 的全局 `:focus-visible` 规则负责。
      outlineWidth: 0,
    },
    passwordRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: tokens['space.1'],
    },
    passwordInput: {
      flex: 1,
    },
    reveal: {
      minHeight: tokens['touch-target.min'],
      minWidth: tokens['touch-target.min'],
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: tokens['radius.md'],
    },
    identityRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: tokens['space.2'],
      minHeight: tokens['touch-target.min'],
      paddingHorizontal: tokens['space.2'],
      borderRadius: tokens['radius.md'],
      borderWidth: tokens['border-width.thin'],
      borderColor: tokens['color.border-subtle'],
      backgroundColor: tokens['color.surface-sunken'],
    },
    identityText: {
      flex: 1,
      color: tokens['color.foreground'],
    },
    primary: {
      flexDirection: 'row',
      alignSelf: 'flex-start',
      alignItems: 'center',
      justifyContent: 'center',
      gap: tokens['space.1'],
      minHeight: tokens['touch-target.min'],
      paddingHorizontal: tokens['space.4'],
      borderRadius: tokens['radius.md'],
      backgroundColor: tokens['color.primary'],
      borderWidth: tokens['border-width.thin'],
      borderColor: tokens['color.primary'],
    },
    primaryPressed: {
      // 按压态用**更深的品牌色**，不用透明度：`state.pressed-opacity` 是 0.08，
      // 给实心主按钮用会让它按下去像"变淡了"，而按钮的实心感正是它的可点性提示。
      backgroundColor: tokens['color.primary-active'],
      borderColor: tokens['color.primary-active'],
    },
    primaryLabel: { color: tokens['color.on-primary'] },
    ghost: {
      alignSelf: 'flex-start',
      minHeight: tokens['touch-target.min'],
      paddingHorizontal: tokens['space.3'],
      borderRadius: tokens['radius.md'],
      borderWidth: tokens['border-width.thin'],
      borderColor: tokens['color.border'],
      alignItems: 'center',
      justifyContent: 'center',
    },
    ghostText: { color: tokens['color.foreground'] },
    textAction: {
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: tokens['space.1'],
      minHeight: tokens['touch-target.min'],
      paddingVertical: tokens['space.1'],
    },
    linkText: {
      color: tokens['color.primary'],
      textDecorationLine: 'underline',
    },
    secondary: {
      gap: tokens['space.1'],
    },
    termsRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: tokens['space.2'],
    },
    checkbox: {
      width: tokens['size.checkbox'],
      height: tokens['size.checkbox'],
      borderRadius: tokens['radius.sm'],
      borderWidth: tokens['border-width.thin'],
      borderColor: tokens['color.border'],
      backgroundColor: tokens['color.background'],
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: tokens['space.1'],
    },
    checkboxOn: {
      backgroundColor: tokens['color.primary'],
      borderColor: tokens['color.primary'],
    },
    termsText: {
      flex: 1,
      color: tokens['color.foreground-muted'],
    },
    legalRow: {
      flexDirection: 'row',
      gap: tokens['space.3'],
    },
    link: {
      paddingVertical: tokens['space.1'],
    },
    pressed: {
      // 扁平风格用**底色**表达按压，不用阴影（AGENTS §5：阴影只给真正的浮层）。
      backgroundColor: tokens['color.surface-sunken'],
    },
  });
}
