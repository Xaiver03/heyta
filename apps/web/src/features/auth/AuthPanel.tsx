/**
 * 登录 / 注册面板（Web 薄壳）
 * ============================
 *
 * 服务端有完整认证，而在此之前的 Web 界面里**没有一个入口调用它**：
 * 用户只能在同步设置里手填令牌，而没有任何地方告诉他令牌从哪来。
 * 这个面板就是那个入口。
 *
 * ## 🔴 2026-10-02：表单本体不在这里了
 *
 * 这里原来是一份**手写的表单**（484 行），而移动端 `AuthScreen.tsx` 里有另一份
 * （403 行）。同一张表单写两遍 = 两端可以对同一个字段说不同的话，而认证恰恰
 * 是最不该漂移的那一块（`docs/plans/user-journey-and-auth.md` §10.1 记的就是
 * 这两个数字）。现在表单唯一一份在 `@heyta/ui` 的 `AuthForm`，**这个文件只做宿主的事**：
 *
 *   - 把 `t()` 的结果拼成 `labels`（`packages/ui` 不 import `@heyta/i18n` —— 会拖进第二份 React）；
 *   - 把 store 的状态机翻成 `status` / `busy` / `waitingForPasskey`；
 *   - 决定服务端地址栏**给不给**（只有未配置时才给，而且给的是**预填好的值**）；
 *   - 决定条款链接落在**哪一份文本**（`resolveLegalLinks`，按连的那台服务端分流）；
 *   - 把每个动作接到 `./store.ts`。
 *
 * ⚠️ 壳里**不许**再出现字段、显隐开关、`autocomplete` 取值、错误落点、两步流转 ——
 * 那些是共享表单的裁决，重写一遍就是让两端再次分叉。
 *
 * ## 🔴 2026-10-01 的旅程重构：这里原来有一道墙
 *
 * 产品负责人的原话：**「绝对不允许什么用自己正在用的域名才能够注册，不可能是这样子的。」**
 *
 * 重构前面板有两件事在同一个方向上出错：
 *
 *   1. **六个动作并列**（发送登录链接 / 注册 / 通行密钥注册 / 通行密钥登录 /
 *      找回 / 粘贴令牌），一个刚来的人看不出主路是哪条；
 *   2. 🔴 **第一个必填项是服务端地址**。对官方托管的用户，这意味着注册的前提是
 *      "你知道自己该连哪台服务端吗" —— 而这个问题他答不上来，也不该由他来答。
 *
 * 现在这两件事都由**共享表单**的结构解决（邮箱 + 登录口令同屏，一个 affordance
 * 同时管注册与登录；地址是**最后一栏**而且只在设置路径显式进入时出现），而壳这边仍然承担着
 * 拆墙的另一半：**预填**。地址由 `./auth-endpoint`（`authBaseUrl()`）给 ——
 * **已配置的 > `VITE_SYNC_URL` > 本机来源**。官方托管是"站点 `/` + 应用 `/app/` +
 * API `/api/` 同一个域名"（deployment §3.3.1），所以来源本身就是答案，不是猜一个域名。
 *
 * ⚠️ 地址输入框给不给的判据是 `isUnconfigured(baseUrl)`：**已经在同步设置里配好
 * 服务端时不给第二个可编辑框** —— 那会造成"两个地址来源"（判据在
 * `tests/signin-entry.spec.tsx`，它同时钉着"未配置时必须给默认值"那一半）。
 *
 * ## 分层（AGENTS.md §3.5）
 *
 * 这里**没有一行协议知识**：
 *   - 端点、请求体、凭据字段、失败归类 → `@heyta/app-host` 的 `hosted-auth.ts`；
 *   - "链接里的哪一段是令牌" → 同处的 `extractAuthLinkToken`；
 *   - 两条条款链接指向**哪一份文本** → 同处的 `resolveLegalLinks`
 *     （官方实例落落地页，别的 host 落那台自己发布的页面，**不许**悄悄回落到
 *     heyta 的文本 —— 那是替别人作承诺）；
 *   - 失败原因 → 哪一条词条（**连同句子里要填的数字**）→ `@heyta/ui` 的
 *     `authFailureMessage`（四端共用一份）；
 *   - 状态机 → `./store.ts`。
 * 本文件只做两件事：**把状态渲染成人看得懂的句子**，以及**把输入接到动作上**。
 *
 * ## 空状态是明确的
 *
 * 未登录时不是"什么都不显示"，而是明说"还没有凭据 + 怎么才能有"。
 * 反过来，服务端为防邮箱枚举会把"已发送"回成中性文案，
 * 所以这里也**不许**把它渲染成"登录成功"。
 *
 * ## 通行密钥（已接）
 *
 * `@heyta/app-host` 提供协议两半（取 options / 交 credential），中间那一步平台调用
 * （`navigator.credentials`）**刻意留在宿主里** —— 对本壳就是 `./passkey-browser.ts`。
 * 本壳只负责**触发**它、并把探测结果交给共享表单：设备不支持时按钮**不禁用**，
 * 而是在下面明说"这个浏览器或设备不支持"（禁用了却不说为什么，用户只会以为界面坏了）。
 */

import { useEffect, useRef, useState } from 'react';
import { AuthPlanScene } from './AuthPlanScene.js';
import { cssVar } from '@heyta/design-system';
import {
  INVITE_QUERY_PARAM,
  INVITE_CODE_LENGTH,
  inspectInviteCodeShape,
  normalizeInviteCode,
} from '@heyta/domain';
import { useI18n, type MessageKey } from '@heyta/i18n';
import { OFFICIAL_SITE_ORIGIN, resolveLegalLinks, type HostedAuthSession } from '@heyta/app-host';
import {
  AuthForm,
  HeytaUiProvider,
  authFailureMessage,
  type AuthFormLabels,
  type AuthFormStatus,
} from '@heyta/ui';

import { detectPasskeyBrowser } from './passkey-browser.js';
import { useAuthStore, type AuthBusyAction } from './store.js';
import { authBaseUrl, isUnconfigured } from '../../lib/auth-endpoint.js';
import './auth-dialog.css';

export interface AuthPanelProps {
  /** 当前同步设置里的服务端地址 —— 认证与同步必须指向同一个服务端。 */
  baseUrl: string;
  /** 只有从设置 → 同步显式进入时，才展示自托管 / 粘贴令牌的备用入口。 */
  allowAdvanced?: boolean;
  onClose: () => void;
  /**
   * 登录成功。壳拿它把设置对话框里的令牌输入框也同步上 ——
   * 否则用户随后点"保存并同步"会用空的输入框把刚拿到的令牌覆盖掉。
   */
  onSignedIn?: (session: HostedAuthSession) => void;
}

/**
 * 每一个在路上的动作各有一句"正在…"。
 *
 * 🔴 **不是一句通用的"正在处理"**：用户停在表单前最想知道的就是这一步在做什么，
 * 而口令登录要跑 Argon2id（比其它动作慢一个量级），说成"正在登录"会让人以为卡死、
 * 于是去点第二次。`passkey-*` 两条另有系统弹窗那句话（`waitingForPasskey`），
 * 这里给的是**这一侧**在做什么。
 *
 * ⚠️ 用 `Record<AuthBusyAction, …>` 而不是 `Partial`：**新增一个动作却忘了配句子**
 * 会在编译期红 —— 那正是"界面对着一个进行中的请求说不出话"的形状。
 */
const BUSY_MESSAGE_KEY: Record<AuthBusyAction, MessageKey> = {
  'login-link': 'common.auth.busy.link',
  register: 'common.auth.busy.register',
  verify: 'common.auth.busy.verify',
  'passkey-register': 'web.auth.passkey.waiting',
  'passkey-login': 'web.auth.passkey.waiting',
  recovery: 'common.auth.busy.recovery',
  'password-sign-in': 'common.auth.busy.signIn',
  'password-register': 'common.auth.busy.register',
  'registration-code': 'common.auth.busy.verify',
  'password-forgot': 'common.auth.busy.forgot',
  'password-change': 'common.auth.busy.change',
  'password-set': 'web.settings.password.setBusy',
};

/**
 * 口令显隐的**默认档**由谁定：共享表单给了规则（桌面遮住、移动显示，依据
 * NNG《Stop Password Masking》与 NIST），但它只能按 **`Platform.OS`** 判 ——
 * 而 react-native-web 里手机浏览器同样是 `'web'`。
 *
 * 🔴 所以这一档**必须由壳覆盖**：一台手机上的 Safari 是"web"，但它几乎没有肩窥场景、
 * 却有很强的单手输入错字场景 —— 按默认档给它遮住口令是拿桌面结论套移动端。
 * 判据用指针类型（`pointer: coarse`）而不是屏幕宽度：宽度会在分屏/横屏里跳，
 * 而"用什么手指头点"才是那篇研究真正区分的东西。
 */
function passwordDefaultPlatform(): 'desktop' | 'mobile' {
  if (typeof window === 'undefined') return 'desktop';
  return window.matchMedia?.('(pointer: coarse)').matches === true ? 'mobile' : 'desktop';
}

export function AuthPanel({
  baseUrl,
  allowAdvanced = false,
  onClose,
  onSignedIn,
}: AuthPanelProps): React.JSX.Element {
  const { t, locale } = useI18n();
  const status = useAuthStore((s) => s.status);
  const registrationChallenge = useAuthStore((s) => s.registrationChallenge);
  const sendLoginLink = useAuthStore((s) => s.sendLoginLink);
  const registerPasskey = useAuthStore((s) => s.registerPasskey);
  const loginWithPasskey = useAuthStore((s) => s.loginWithPasskey);
  const requestRecovery = useAuthStore((s) => s.requestRecovery);
  const verify = useAuthStore((s) => s.verify);
  const signInWithPassword = useAuthStore((s) => s.signInWithPassword);
  const requestRegistrationCode = useAuthStore((s) => s.requestRegistrationCode);
  const verifyRegistrationCode = useAuthStore((s) => s.verifyRegistrationCode);
  const resendRegistrationCode = useAuthStore((s) => s.resendRegistrationCode);
  const cancelRegistrationCode = useAuthStore((s) => s.cancelRegistrationCode);
  const forgotPassword = useAuthStore((s) => s.forgotPassword);
  const invalidatePendingAuth = useAuthStore((s) => s.invalidatePendingAuth);

  /**
   * 服务端地址草稿。
   *
   * 🔴 **这里的初值就是那道墙被拆掉的地方**（文件头有原话）。
   * 以前是 `useState('')` + 「`baseUrl` 为空就显示一个必填的地址框」，
   * 于是官方托管的访客第一件事就是被要求写出自己的同步域名。
   * 现在初值来自 `authBaseUrl(baseUrl)`：**已配置的 > `VITE_SYNC_URL` > 本机来源**
   * （为什么来源就是答案，见 `../../lib/auth-endpoint.ts` 文件头）。
   *
   * ⚠️ 它**不会**被写回 `useSyncStore.baseUrl`：空的 baseUrl 在 app-host 里是
   * **纯本地模式**，不是错误状态。预填只服务"发起一次认证动作"，
   * 真正落进同步配置发生在登录成功之后（`applyAuthSession`）——
   * 那才是用户选择了云端的时刻。
   *
   * ⚠️ `baseUrl` 在面板打开后变化（用户在同步设置里改了地址）时跟着重置：
   * 这里用渲染期比较外部 prop 的老写法（`prevBaseUrl`），不引入 effect ——
   * 一个 effect 会多渲染一帧，而那一帧里用户看到的还是旧地址。
   */
  const [addressDraft, setAddressDraft] = useState(() => authBaseUrl(baseUrl));
  const [previousBaseUrl, setPreviousBaseUrl] = useState(baseUrl);
  const baseUrlRef = useRef(baseUrl);
  if (previousBaseUrl !== baseUrl) {
    setPreviousBaseUrl(baseUrl);
    setAddressDraft(authBaseUrl(baseUrl));
  }
  useEffect(() => {
    if (baseUrlRef.current !== baseUrl) {
      baseUrlRef.current = baseUrl;
      invalidatePendingAuth();
    }
  }, [baseUrl, invalidatePendingAuth]);

  // Closing the panel is a new authentication boundary. Invalidate only the
  // request generation; the sync store keeps any credentials already saved by
  // a completed login.
  useEffect(() => () => {
    invalidatePendingAuth();
  }, [invalidatePendingAuth]);

  const changeAddress = (next: string): void => {
    invalidatePendingAuth();
    setAddressDraft(next);
  };

  /**
   * 这次认证真正要发去哪。
   *
   * 草稿被清空时**回到默认值**而不是发一个空地址 —— 空地址在服务端那边
   * 是一个请求都不发 + `unconfigured`，对用户来说那是"按钮坏了"。
   */
  const effectiveBaseUrl = addressDraft.trim() === '' ? authBaseUrl(baseUrl) : addressDraft.trim();

  /**
   * 两条条款链接的**落点**（规则与理由在 `@heyta/app-host` 的 `legal-links.ts`）。
   * 用 `effectiveBaseUrl`：面板内刚敲进去的地址也要算，否则未配置状态下
   * 用户填完地址仍然读不到条款。
   *
   * 🔴 地址交给共享表单渲染成**真的 `<a href>`**（不是"看起来能点的 div"）：
   * 我们要求用户同意一份政策，就必须让他能用他习惯的任何方式把它打开 ——
   * 中键、⌘ 点击、右键复制链接、状态栏预览，一个都不能少。
   */
  const legalLinks = resolveLegalLinks(effectiveBaseUrl, locale);
  // Reuse the shared legal host classification so a trailing slash or an
  // equivalent official URL gets the same official/custom treatment.
  const isOfficialService = legalLinks?.terms.startsWith(`${OFFICIAL_SITE_ORIGIN}/`) === true;

  // 每次渲染都重新探测。缓存成模块级常量会把**第一次**的结果永久钉住，
  // 而它在 jsdom 与真实浏览器里不同，用户中途接上安全密钥时也会变。
  const passkeySupported = detectPasskeyBrowser() !== undefined;

  /**
   * 邀请码：初值 + 镜像。
   *
   * 🔴 **初值来自 URL 上的 `?invite=`** —— 邀请链接是"邀请新人"这个机制唯一的入口形态：
   * 被邀请人不需要理解"邀请码"是什么，他只需要点开链接、填邮箱、设密码。
   *
   * ⚠️ 这一栏的**输入与存储**在共享表单里（那是四端共用的字段），壳只拿到
   * `onInviteCodeChange` 的**镜像**。为什么壳还需要拿：归一化（大写、去连字符与空格、
   * 去零宽字符）与形状判定属于 `@heyta/domain`，**不是表单的裁决** ——
   * 而"这码发得出去吗"必须在发之前就知道。
   *
   * ⚠️ 为什么仍然是一个**可见、可编辑**的框而不是隐藏参数：
   * ① 有人是口头/截图拿到码的，没有链接可点；② 链接里的码可能被截断，用户得能改；
   * ③ 用户应该**看得见**自己正在被谁邀请（而不是被静默归因）。
   */
  const [inviteSeed] = useState(() => {
    if (typeof window === 'undefined') return '';
    const raw = new URLSearchParams(window.location.search).get(INVITE_QUERY_PARAM);
    return raw === null ? '' : normalizeInviteCode(raw);
  });
  const [inviteMirror, setInviteMirror] = useState(inviteSeed);
  /**
   * 形状对不对（空串算"没填"，不是"填错了"）。
   *
   * 🔴 判据来自 `@heyta/domain`，与**服务端**查表用的那个函数是同一个 ——
   * 这里只提前说一句，权威判定永远在服务端。
   */
  const normalizedInvite = normalizeInviteCode(inviteMirror);
  const inviteInvalid = normalizedInvite !== '' && inspectInviteCodeShape(normalizedInvite) !== null;

  const busy = status.kind === 'busy';
  const waitingForPasskey =
    busy && (status.action === 'passkey-register' || status.action === 'passkey-login');

  const labels: AuthFormLabels & {
    readonly otherWaysToggle: { readonly open: string; readonly close: string };
  } = {
    title: t('web.auth.title'),
    titleText: t('web.auth.title'),
    close: t('web.auth.close'),
    email: t('web.auth.email.label'),
    emailPlaceholder: t('web.auth.email.placeholder'),
    continue: t('common.auth.form.continue'),
    accountSummary: (email) => t('common.auth.form.accountSummary', { email }),
    changeEmail: t('common.auth.form.changeEmail'),
    // 🔴 「登录密码」，不是「密码」：另一个秘密是端到端加密口令，
    // 一句话同时指两样东西的界面，会让人以为忘了登录密码也就忘了数据。
    password: t('common.auth.signInPassword.label'),
    signIn: t('common.auth.form.signIn'),
    signUp: t('web.auth.register'),
    showPassword: t('common.auth.form.showPassword'),
    hidePassword: t('common.auth.form.hidePassword'),
    passwordHint: t('common.auth.form.passwordHint'),
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
    otherWaysToggle: {
      open: t('common.auth.form.otherWaysOpen'),
      close: t('common.auth.form.otherWaysClose'),
    },
    terms: t('web.auth.terms.label'),
    magicLink: t('web.auth.sendLoginLink'),
    recovery: t('web.auth.recovery.request'),
    passkeyRegister: t('web.auth.passkey.register'),
    passkeyLogin: t('web.auth.passkey.login'),
    passkeyUnavailable: t('web.auth.passkey.unavailable'),
    passkeyWaiting: t('web.auth.passkey.waiting'),
    emptyTitle: '',
    emptyBody: '',
    ...(busy ? { busyText: t(BUSY_MESSAGE_KEY[status.action]) } : {}),
    invite: {
      label: t('web.auth.invite.label'),
      placeholder: t('web.auth.invite.placeholder'),
      invalid: (length) => t('web.auth.invite.invalid', { length }),
    },
    // 地址这一栏**只在同步设置显式进入且未配置时给**（两个来源 = 漂移），而且给的是配好的 label ——
    // 少一边就整栏不渲染，"只传一半"不会留下一个没有标题的空框。
    ...(allowAdvanced && isUnconfigured(baseUrl)
      ? {
          serverUrl: {
            label: t('web.auth.server.label'),
            placeholder: t('web.auth.server.placeholder'),
          },
        }
      : {}),
    ...(allowAdvanced
      ? {
          paste: {
            label: t('web.auth.paste.label'),
            placeholder: t('web.auth.paste.placeholder'),
            verify: t('web.auth.verify'),
          },
        }
      : {}),
    /*
      🔴 两条逃生门各给一个展开入口（2026-10-02）。不给的话共享表单会**常驻**渲染
      它们 —— 那正是产品负责人判掉的那个默认屏：「为什么还是默认就是要什么粘贴
      服务器地址和令牌之类的东西？……这不是把那些普通用户给拒之门外了吗？」
      折叠发生在**渐进披露层**：展开入口本身可键盘聚焦、可被读屏发现，展开后地址与令牌
      输入完整挂载；与「通行密钥 / 邮件登录链接」降到二级链用的是同一条口径。
    */
    ...(allowAdvanced
      ? {
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
            hrefs: legalLinks,
          },
        }),
    localErrors: {
      baseUrl: t('common.auth.form.serverUrlRequired'),
      email: t('common.auth.form.emailRequired'),
      password: t('common.auth.form.passwordRequired'),
      // 「这一项必须由你自己做出」那半句不许丢：界面不许替他勾，也不许写成走过场。
      terms: (key) => t(key),
    },
  };

  /**
   * 状态机 → 一句人话。
   *
   * 🔴 三条口径，缺一条界面就会说谎：
   *   · **`*-sent` 一律是 `info` 不是 `success`** —— 服务端用中性文案防邮箱枚举，
   *     "信已发出"不等于"你收到了"，更不等于"已经登录好了"；
   *   · **只有 `signed-in` 用 `success`**（那是唯一真的有令牌的落点）；
   *   · **服务端失败不指 `field`** —— 那类失败没有"哪个框错了"的答案
   *     （邮箱存在性故意不区分），硬标一个框就是在替服务端猜原因。
   *     唯一的例外是**口令策略不合格**：它指到口令框，因为那一格确实是错的。
   *     ⚠️ 这句注释以前把 `invalid-credentials` 也算进"能指"的那一类，**那是错的**
   *     （2026-10-02 对着 `isPolicy` 那一行核过）：口令错与"邮箱没注册 / 没设口令"
   *     在服务端是**同一句话同一个码**，指框就等于猜其中一种；而且登录档的口令框
   *     是用户刚自己填完的那格，红框在这里不提供任何信息。
   */
  const formStatus = (): AuthFormStatus | null => {
    switch (status.kind) {
      case 'signed-out':
      case 'busy':
      case 'registration-code':
        return null;
      case 'link-sent':
        return { tone: 'info', message: t('web.auth.sent.login') };
      case 'registered':
        // 🔴 服务端**亲口说**那封信没发出去时，不许再说"去查收邮件"。
        // 用 `error` 而不是 `info`：这不是提示，是这条路此刻走不下去；
        // 但也不标任何字段（`field` 留空）—— 该修的是服务器的邮件配置，
        // 不是用户刚打的那一格。
        return status.mailDelivered === false
          ? { tone: 'error', message: t('web.auth.sent.mailNotSent') }
          : { tone: 'info', message: t('web.auth.sent.register') };
      case 'recovery-sent':
        return { tone: 'info', message: t('web.auth.sent.recovery') };
      case 'reset-sent':
        return { tone: 'info', message: t('common.auth.sent.reset') };
      case 'signed-in':
        return {
          tone: 'success',
          message: t('web.auth.signedIn.title'),
          detail: t('web.auth.signedIn.body', { email: status.email }),
        };
      case 'password-changed':
        return {
          tone: 'success',
          message: t('web.settings.password.changed'),
          detail: t('web.settings.password.otherDevices'),
        };
      case 'password-set':
        return {
          tone: 'success',
          message: t('web.settings.password.setDone'),
          detail: t('web.settings.password.setConsequence'),
        };
      case 'failed': {
        // 口令策略：四种拒绝的状态码与 `code` 完全相同，而用户的动作四种都不同，
        // 所以只说"不符合要求"等于没说。哪一条、以及句子里那个 `{min}`/`{max}`/
        // `{seconds}`，由共享层的 `authFailureMessage` **一次交出** —— 分两次拿
        // 就有"只拿了句子、没填数字"的空间，而那不会报错：界面上印的是
        // 字面量 `{seconds}`。（本文件与 `PasswordPanel` 两处都真实漏过。）
        const { key, vars } = authFailureMessage(status);
        const isPolicy = status.reason === 'password-policy' && status.policyCode !== undefined;
        return {
          tone: 'error',
          message: vars === undefined ? t(key) : t(key, vars),
          ...(isPolicy ? { field: 'password' as const } : {}),
        };
      }
    }
  };

  return (
    <div
      className="ht-sheet__auth"
      role="dialog"
      aria-modal="true"
      aria-label={t('web.auth.title')}
    >
      <div className="ht-sheet__auth-dialog">
        <AuthPlanScene />
        <div className="ht-sheet__auth-form">
        {/*
          `HeytaUiProvider` 必须挂在共享组件外面：它从 context 取 token 与文本样式，
          缺了它共享组件会**主动抛错**而不是静默降级。`check:ui-provider` 钉的就是
          这一层（`AuthForm` 已在登记清单里）。
        */}
        <HeytaUiProvider>
          <AuthForm
            labels={labels}
            onClose={onClose}
            platform={passwordDefaultPlatform()}
            status={formStatus()}
            busy={busy}
            passkeyAvailable={passkeySupported}
            waitingForPasskey={waitingForPasskey}
            initialInviteCode={inviteSeed}
            onInviteCodeChange={setInviteMirror}
            inviteCodeLength={INVITE_CODE_LENGTH}
            inviteInvalid={inviteInvalid}
            {...(allowAdvanced && isUnconfigured(baseUrl)
              ? { serverUrl: { value: addressDraft, onChange: changeAddress } }
              : {})}
            onSignIn={({ email, password }) => {
              // 🔴 口令**原样**交出：不在这里 trim / normalize / 改大小写。
              // 归一化只在服务端一处发生，客户端多算一次就是第二套规则。
              void signInWithPassword(effectiveBaseUrl, email, password).then((session) => {
                if (session !== undefined) onSignedIn?.(session);
              });
            }}
            onRegister={({ email, password, termsAccepted, inviteCode }) => {
              void requestRegistrationCode(
                effectiveBaseUrl,
                email,
                password,
                termsAccepted,
                inviteCode === undefined ? undefined : { inviteCode },
              );
            }}
            {...(registrationChallenge !== undefined
              ? {
                  registrationChallenge: {
                    email: registrationChallenge.email,
                    expiresAt: registrationChallenge.expiresAt,
                    resendAvailableAt: registrationChallenge.resendAvailableAt,
                    onVerify: (code: string) => {
                      void verifyRegistrationCode(effectiveBaseUrl, registrationChallenge.challengeId, code).then((session) => {
                        if (session !== undefined) onSignedIn?.(session);
                      });
                    },
                    onResend: () => {
                      void resendRegistrationCode(effectiveBaseUrl, registrationChallenge.challengeId);
                    },
                    onChangeEmail: cancelRegistrationCode,
                  },
                }
              : {})}
            onMagicLink={(email) => {
              void sendLoginLink(effectiveBaseUrl, email);
            }}
            onPasskey={({ kind, email, termsAccepted, inviteCode }) => {
              if (kind === 'register') {
                void registerPasskey(effectiveBaseUrl, email, termsAccepted, { inviteCode });
                return;
              }
              void loginWithPasskey(effectiveBaseUrl, email).then((session) => {
                if (session !== undefined) onSignedIn?.(session);
              });
            }}
            onRecovery={(email) => {
              void requestRecovery(effectiveBaseUrl, email);
            }}
            onForgotPassword={(email) => {
              void forgotPassword(effectiveBaseUrl, email);
            }}
            onVerifyToken={(token) => {
              void verify(effectiveBaseUrl, token).then((session) => {
                if (session !== undefined) onSignedIn?.(session);
              });
            }}
            onOpenLegal={(kind) => {
              if (legalLinks === null) return;
              const href = kind === 'terms' ? legalLinks.terms : legalLinks.privacy;
              window.open(href, '_blank', 'noopener,noreferrer');
            }}
            testID="auth-form"
          />
        </HeytaUiProvider>
        </div>

        {/*
          透明性：这一次认证真的发去哪台服务端。它挂在**壳这一层**而不是表单里，
          因为自建与官方托管并存时，这一行是唯一能核对的地方 —— 而且它必须
          **不随地址栏给不给、折叠与否而消失**。
        */}
        {!isOfficialService ? (
          <div className="ht-sheet__auth-notes">
            <p style={noteStyle}>{t('web.auth.server.custom')}</p>
            <p style={noteStyle}>{t('web.auth.server.address', { baseUrl: effectiveBaseUrl })}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** 壳级补充说明句（服务类型与可核对地址）。 */
const noteStyle: React.CSSProperties = {
  margin: 0,
  fontSize: cssVar('font-size.2xs'),
  lineHeight: cssVar('line-height.normal'),
  color: cssVar('color.foreground-muted'),
};
