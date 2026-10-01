/**
 * 登录 / 注册面板（Web）
 * ======================
 *
 * 服务端有完整认证，而在此之前的 Web 界面里**没有一个入口调用它**：
 * 用户只能在同步设置里手填令牌，而没有任何地方告诉他令牌从哪来。
 * 这个面板就是那个入口。
 *
 * ## 🔴 2026-10-01 的旅程重构：这里原来有一道墙
 *
 * 产品负责人的原话：**「绝对不允许什么用自己正在用的域名才能够注册，不可能是这样子的。」**
 *
 * 重构前面板有两件事在同一个方向上出错：
 *
 *   1. **六个动作并列**（发送登录链接 / 注册 / 通行密钥注册 / 通行密钥登录 /
 *      找回 / 粘贴令牌），一个刚来的人看不出主路是哪条；
 *   2. 🔴 **第一个必填项是服务端地址**（`baseUrl === ''` 那个分支）。
 *      对官方托管的用户，这意味着注册的前提是"你知道自己该连哪台服务端吗" ——
 *      而这个问题他答不上来，也不该由他来答。
 *
 * 现在的形状：
 *
 *   - **先选档**（创建账号 / 已有账号），一档只给**一个主按钮**；
 *   - 地址由 `./auth-endpoint`（`authBaseUrl()`）给：**已配置的 > VITE_SYNC_URL > 本机来源**。
 *     官方托管是"站点 `/` + 应用 `/app/` + API `/api/` 同一个域名"（deployment §3.3.1），
 *     所以来源本身就是答案，不是猜一个域名；
 *   - 地址输入框**不删**（自建要能改），但它进「高级」且**已经填好** ——
 *     配合一句"不用你写"，否则一个预填好的框读起来仍然像"这里该我核对"；
 *   - 「粘贴登录链接 / 令牌」同样降级到「高级」：它是**兜底**，不是主路。
 *     主路是邮件里那条链接点开后自己回到应用（`pending-login.ts` + ADR-0039 §2.2），
 *     所以注册/登录那两句话也按机制改了口径（词条里有注释）。
 *
 * ⚠️ 两档**都不显示**"当前已配置成另一台服务端"的暗示：`baseUrl` 非空时以它为准，
 * 面板只是把那台地址透明地写出来（`web.auth.server.at`）。
 *
 * ## 分层（AGENTS.md §3.5）
 *
 * 这里**没有一行协议知识**：
 *   - 端点、请求体、凭据字段、失败归类 → `@heyta/app-host` 的 `hosted-auth.ts`；
 *   - "链接里的哪一段是令牌" → 同处的 `extractAuthLinkToken`；
 *     （按用户连的 baseUrl 分流；官方实例落落地页，别的 host 落那台自己发布的页面，
 *     **不许**悄悄回落到 heyta 的文本 —— 那是替别人作承诺）；
 *   - 状态机 → `./store.ts`。
 * 本文件只做两件事：**把状态渲染成人看得懂的句子**，以及**收集用户输入**。
 * 失败句子按**结构化 reason** 取词条，不猜也不映射服务端的原始串。
 *
 * ## 空状态是明确的
 *
 * 未登录时不是"什么都不显示"，而是明说"还没有凭据 + 怎么才能有"。
 * 反过来，服务端为防邮箱枚举会把"已发送"回成中性文案，
 * 所以这里也**不许**把它渲染成"登录成功"。
 *
 * ## 通行密钥（已接）
 *
 * `@heyta/app-host` 提供通行密钥的协议两半（取 options / 交 credential），
 * 中间那一步平台调用（`navigator.credentials`）**刻意留在宿主里** —— 对本壳就是
 * `./passkey-browser.ts`。本面板只负责**触发**它，并把结构化状态渲染成句子。
 *
 * ⚠️ 设备不支持时按钮**不禁用**，而是在下面明说"这个浏览器或设备不支持"：
 * 禁用按钮却不说为什么，用户只会以为界面坏了。
 */

import { useState } from 'react';
import { cssVar } from '@heyta/design-system';
import {
  INVITE_QUERY_PARAM,
  INVITE_CODE_LENGTH,
  inspectInviteCodeShape,
  isInviteCodeShape,
  normalizeInviteCode,
} from '@heyta/domain';
import { useI18n, type MessageKey } from '@heyta/i18n';
import type { HostedAuthFailureReason, HostedAuthSession } from '@heyta/app-host';
import {
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  LifeBuoy,
  Loader2,
  Mail,
  UserPlus,
  X,
} from 'lucide-react';

import { detectPasskeyBrowser } from './passkey-browser.js';
import { useAuthStore } from './store.js';
import { authBaseUrl, isUnconfigured } from '../../lib/auth-endpoint.js';
import { authFailureMessageKey } from '@heyta/ui';

export interface AuthPanelProps {
  /** 当前同步设置里的服务端地址 —— 认证与同步必须指向同一个服务端。 */
  baseUrl: string;
  onClose: () => void;
  /**
   * 登录成功。壳拿它把设置对话框里的令牌输入框也同步上 ——
   * 否则用户随后点"保存并同步"会用空的输入框把刚拿到的令牌覆盖掉。
   */
  onSignedIn?: (session: HostedAuthSession) => void;
}

export function AuthPanel({ baseUrl, onClose, onSignedIn }: AuthPanelProps): React.JSX.Element {
  const { t } = useI18n();
  const status = useAuthStore((s) => s.status);
  const sendLoginLink = useAuthStore((s) => s.sendLoginLink);
  const registerAccount = useAuthStore((s) => s.registerAccount);
  const registerPasskey = useAuthStore((s) => s.registerPasskey);
  const loginWithPasskey = useAuthStore((s) => s.loginWithPasskey);
  const requestRecovery = useAuthStore((s) => s.requestRecovery);
  const verify = useAuthStore((s) => s.verify);

  const [email, setEmail] = useState('');
  const [pasted, setPasted] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  /**
   * 邀请码。🔴 **初值来自 URL 上的 `?invite=`** —— 那是邀请链接带来的，
   * 而邀请链接是"邀请新人"这个机制唯一的入口形态：被邀请人不需要理解
   * "邀请码"是什么，他只需要点开链接、填邮箱注册。
   *
   * 之所以仍然是一个**可见、可编辑**的输入框而不是隐藏参数：
   * ① 有人是口头/截图拿到码的，没有链接可点；
   * ② 链接里的码可能被截断，用户得能改；
   * ③ 用户应该**看得见**自己正在被谁邀请（而不是被静默归因）。
   */
  const [inviteCode, setInviteCode] = useState(() => {
    if (typeof window === 'undefined') return '';
    const raw = new URLSearchParams(window.location.search).get(INVITE_QUERY_PARAM);
    return raw === null ? '' : normalizeInviteCode(raw);
  });
  /**
   * 服务端地址。
   *
   * 🔴 **这里的初值就是那道墙被拆掉的地方**（文件头有原话）。
   * 以前是 `useState('')` + 「`baseUrl` 为空就显示一个必填的地址框」，
   * 于是官方托管的访客第一件事就是被要求写出自己的同步域名。
   * 现在初值来自 `authBaseUrl(baseUrl)`：**已配置的 > `VITE_SYNC_URL` > 本机来源**
   * （为什么来源就是答案，见 `../../lib/auth-endpoint.ts` 文件头）。
   *
   * 这个草稿仍然**可以改**，因为自建是真实形态 —— 但它被收进「高级」，
   * 而且不是空的：一个预填好的框 + 一句"不用你写"，与一个空框 + 一句"请填"，
   * 是两种产品。
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
  if (previousBaseUrl !== baseUrl) {
    setPreviousBaseUrl(baseUrl);
    setAddressDraft(authBaseUrl(baseUrl));
  }

  /**
   * 这次认证真正要发去哪。
   *
   * 草稿被清空时**回到默认值**而不是发一个空地址 —— 空地址在服务端那边
   * 是一个请求都不发 + `unconfigured`，对用户来说那是"按钮坏了"。
   */
  const effectiveBaseUrl = addressDraft.trim() === '' ? authBaseUrl(baseUrl) : addressDraft.trim();

  /**
  // 每次渲染都重新探测。缓存成模块级常量会把**第一次**的结果永久钉住，
  // 而它在 jsdom 与真实浏览器里不同，用户中途接上安全密钥时也会变。
  const passkeySupported = detectPasskeyBrowser() !== undefined;

  /**
   * 形状对不对（空串算"没填"，不是"填错了"）。
   *
   * 🔴 判据来自 `@heyta/domain`，与**服务端**用于查表的那一份是同一个函数 ——
   * 客户端这里只提前说一句，权威判定永远在服务端。
   */
  const inviteProblem = inviteCode === '' ? null : inspectInviteCodeShape(inviteCode);
  const validInviteCode = isInviteCodeShape(inviteCode) ? inviteCode : undefined;

  const busy = status.kind === 'busy';
  const signingIn = status.kind === 'signed-in';
  const waitingForPasskey =
    status.kind === 'busy' &&
    (status.action === 'passkey-register' || status.action === 'passkey-login');

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('web.auth.title')}
      style={{
        position: 'fixed',
        inset: 0,
        display: 'grid',
        placeItems: 'center',
        background: cssVar('color.overlay'),
        zIndex: cssVar('z.modal'),
      }}
    >
      <div
        style={{
          width: '90vw',
          maxWidth: cssVar('layout.prose-max'),
          background: cssVar('color.surface-raised'),
          borderRadius: cssVar('radius.lg'),
          boxShadow: cssVar('shadow.lg'),
          padding: cssVar('space.6'),
          display: 'flex',
          flexDirection: 'column',
          gap: cssVar('space.3'),
          color: cssVar('color.foreground'),
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: cssVar('font-size.lg') }}>{t('web.auth.title')}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('web.auth.close')}
            className="ht-btn ht-btn--ghost"
            style={{ marginLeft: 'auto' }}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        {/* 状态 / 空状态。异步变化，用 live region 让屏幕阅读器播报。 */}
        <div
          role="status"
          aria-live="polite"
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: cssVar('space.2'),
            fontSize: cssVar('font-size.sm'),
            lineHeight: cssVar('line-height.normal'),
          }}
        >
          {status.kind === 'failed' ? (
            <span
              style={{
                display: 'inline-flex',
                gap: cssVar('space.1'),
                color: cssVar('color.danger'),
              }}
            >
              <AlertTriangle size={16} aria-hidden="true" />
              {t(authFailureMessageKey(status.reason))}
            </span>
          ) : (
            <span
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: cssVar('space.1'),
                color: cssVar('color.foreground-muted'),
              }}
            >
              {signingIn ? (
                <>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: cssVar('space.1'),
                      color: cssVar('color.success'),
                    }}
                  >
                    <CheckCircle2 size={16} aria-hidden="true" />
                    {t('web.auth.signedIn.title')}
                  </span>
                  <span>
                    {t('web.auth.signedIn.body', {
                      email: status.kind === 'signed-in' ? status.email : '',
                    })}
                  </span>
                </>
              ) : (
                <>
                  <strong style={{ color: cssVar('color.foreground') }}>
                    {t('web.auth.empty.title')}
                  </strong>
                  <span>{t('web.auth.empty.body')}</span>
                  {status.kind === 'link-sent' ? <span>{t('web.auth.sent.login')}</span> : null}
                  {status.kind === 'registered' ? (
                    <span>{t('web.auth.sent.register')}</span>
                  ) : null}
                  {status.kind === 'recovery-sent' ? (
                    <span>{t('web.auth.sent.recovery')}</span>
                  ) : null}
                </>
              )}
            </span>
          )}
        </div>

        {/*
          服务端地址不在主路上了（它在下面「高级」里，而且**已经填好**）。
          这里原来是一块 `baseUrl === ''` 才渲染的必填输入 —— 那道墙的理由与原话在文件头。
        */}

        <label style={labelStyle}>
          {t('web.auth.email.label')}
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('web.auth.email.placeholder')}
            autoComplete="email"
            style={fieldStyle}
          />
        </label>

        {/*
          邀请码（选填）。

          🔴 **形状不对时不发出去**（下面的按钮会用 `validInviteCode`），
          而且这时**不禁用注册按钮** —— 用户是来注册账号的，一个抄错的码
          不该把他挡在门外。他照常注册，只是这次邀请不作数。
        */}
        <label style={labelStyle}>
          {t('web.auth.invite.label')}
          <input
            type="text"
            value={inviteCode}
            onChange={(e) => setInviteCode(normalizeInviteCode(e.target.value))}
            placeholder={t('web.auth.invite.placeholder')}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            style={fieldStyle}
          />
        </label>
        {inviteProblem === null ? null : (
          <p style={hintStyle}>{t('web.auth.invite.invalid', { length: INVITE_CODE_LENGTH })}</p>
        )}

        <label style={checkboxLabelStyle}>
          <input
            type="checkbox"
            checked={termsAccepted}
            onChange={(e) => setTermsAccepted(e.target.checked)}
            style={{ accentColor: cssVar('color.primary') }}
          />
          {t('web.auth.terms.label')}
        </label>

        {/*
        {/*
          主路：**只有一个主按钮**。

          原来这里是两个同样重的按钮并排（「发送登录链接」是 primary、「注册新账号」是 ghost），
          于是"我是新人"和"我已经有账号"在界面上是同一件事 —— 而一个冷启动的用户 100% 是前者
          （本机没有凭据时这个面板才会打开）。现在注册是那一个蓝色按钮，
          登录跟在下面一句话里；两个动作**都还在 DOM**，只是不再是两个一样的东西。

          ⚠️ 这里**不许**再放第二个"发送登录链接"：上一次改到一半时它并排一份、注脚里又一份，
          同一个动作在界面上出现两次（`getByRole` 也会因为多个匹配而直接红）。
        */}
        <div style={{ display: 'flex', alignItems: 'center', gap: cssVar('space.2'), flexWrap: 'wrap' }}>
          <button
            type="button"
            className="ht-btn ht-btn--primary"
            disabled={busy}
            onClick={() => {
              void registerAccount(effectiveBaseUrl, email, termsAccepted, validInviteCode);
            }}
          >
            {status.kind === 'busy' && status.action === 'register' ? (
              <Loader2 size={14} aria-hidden="true" className="ht-spin" />
            ) : (
              <UserPlus size={14} aria-hidden="true" />
            )}
            {t('web.auth.register')}
          </button>
        </div>

        {/*
          注册之外的那一句：把"我已经有账号"表达成一句话，而不是第二个一样大的按钮。
          两个动作仍然都在 DOM 里（`tests/auth-panel.spec.tsx` 按 label 找按钮，不依赖视觉权重），
          变的只是权重。依据：`docs/plans/email-password-auth.md` §5 第 1-2 条
          （一个 affordance 同时管注册与登录；次要的那条降级为文字链）。
        */}
        <p style={switchStyle}>
          {t('web.auth.switchToSignin')}
          <button
            type="button"
            style={linkButtonStyle}
            disabled={busy}
            onClick={() => {
              void sendLoginLink(effectiveBaseUrl, email);
            }}
          >
            {status.kind === 'busy' && status.action === 'login-link' ? (
              <Loader2 size={14} aria-hidden="true" className="ht-spin" />
            ) : (
              <Mail size={14} aria-hidden="true" />
            )}
            {t('web.auth.sendLoginLink')}
          </button>
        </p>

        {/*
          通行密钥：从两个大按钮**降级成文字链**（依据同上 §5 第 2 条）。

          🔴 降级不等于删掉。这里刻意保留三条都能点：
            · 用通行密钥**注册**与用通行密钥**登录**是两条不同的路（多一步系统弹窗）；
            · 找回的**入口**必须留 —— 服务端 `/api/recover/passkey` 早就实现完整，
              缺的从来只是"没人能触发那封邮件"（见 §9 的那条纠正）。

          ⚠️ 不支持时**不禁用、而是说明原因**（禁用了却不说，用户只会以为界面坏了）。
        */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: cssVar('space.1') }}>
          <span style={groupLabelStyle}>{t('web.auth.passkey.group')}</span>
          <div style={{ display: 'flex', gap: cssVar('space.3'), flexWrap: 'wrap' }}>
            <button
              type="button"
              style={linkButtonStyle}
              disabled={busy}
              onClick={() => {
                void registerPasskey(effectiveBaseUrl, email, termsAccepted, {
                  inviteCode: validInviteCode,
                });
              }}
            >
              {status.kind === 'busy' && status.action === 'passkey-register' ? (
                <Loader2 size={14} aria-hidden="true" className="ht-spin" />
              ) : (
                <KeyRound size={14} aria-hidden="true" />
              )}
              {t('web.auth.passkey.register')}
            </button>
            <button
              type="button"
              style={linkButtonStyle}
              disabled={busy}
              onClick={() => {
                void loginWithPasskey(effectiveBaseUrl, email).then((session) => {
                  if (session !== undefined) onSignedIn?.(session);
                });
              }}
            >
              {status.kind === 'busy' && status.action === 'passkey-login' ? (
                <Loader2 size={14} aria-hidden="true" className="ht-spin" />
              ) : (
                <KeyRound size={14} aria-hidden="true" />
              )}
              {t('web.auth.passkey.login')}
            </button>
            <button
              type="button"
              style={linkButtonStyle}
              disabled={busy}
              onClick={() => {
                void requestRecovery(effectiveBaseUrl, email);
              }}
            >
              {status.kind === 'busy' && status.action === 'recovery' ? (
                <Loader2 size={14} aria-hidden="true" className="ht-spin" />
              ) : (
                <LifeBuoy size={14} aria-hidden="true" />
              )}
              {t('web.auth.recovery.request')}
            </button>
          </div>

          {/* 不支持时**不禁用按钮、而是说明原因** —— 禁用了却不说，用户只会以为界面坏了。 */}
          {!passkeySupported ? <span style={noteStyle}>{t('web.auth.passkey.unavailable')}</span> : null}

          {/* 系统弹窗期间必须说"去看弹窗"，否则用户会以为卡住了。 */}
          {waitingForPasskey ? (
            <span role="status" aria-live="polite" style={noteStyle}>
              {t('web.auth.passkey.waiting')}
            </span>
          ) : null}
        </div>

        {/*
          「高级」：给**已经知道自己要做什么**的人的两到三样东西。

          🔴 用原生 `<details>`（不是"点一下展开的 div"）：键盘可达、屏幕阅读器原生播报、
          折叠状态不进朗读顺序但**仍在 DOM 里** —— 折叠不是藏起来。

          ⚠️ 地址框**只在"这台设备还没配置过服务端"时出现**，而且是**预填好**的：
            · 已配置时不给第二个地址输入 —— 那里已经有唯一事实源（同步设置），
              面板里再放一个可编辑框就是"两个地址来源"（判据钉在
              `tests/signin-entry.spec.tsx`，它同时也在钉"未配置时必须给默认值"这一半）；
            · 未配置时它是自建部署的入口，但**不再是注册的前置条件**（文件头那道墙）。
          两种情况下都能看到「这次会连到 …」那行：透明性不随折叠档位变化。
        */}
        <details style={advancedStyle}>
          <summary style={summaryStyle}>{t('web.auth.advanced')}</summary>

          {isUnconfigured(baseUrl) ? (
            <>
              <label style={labelStyle}>
                {t('web.sync.serverUrl.label')}
                <input
                  type="url"
                  value={addressDraft}
                  onChange={(e) => setAddressDraft(e.target.value)}
                  placeholder={t('web.sync.serverUrl.placeholder')}
                  autoComplete="url"
                  inputMode="url"
                  style={fieldStyle}
                />
              </label>
              <p style={noteStyle}>{t('web.auth.server.prefilled')}</p>
            </>
          ) : null}
          {/* 透明性：这一次认证真的发去哪台服务端。自建与官方托管并存时，这一行是唯一能核对的地方。 */}
          <p style={noteStyle}>{t('web.auth.server.at', { baseUrl: effectiveBaseUrl })}</p>

          <label style={labelStyle}>
            {t('web.auth.paste.label')}
            <input
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder={t('web.auth.paste.placeholder')}
              autoComplete="off"
              style={fieldStyle}
            />
          </label>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="ht-btn ht-btn--primary"
              disabled={busy}
              onClick={() => {
                void verify(effectiveBaseUrl, pasted).then((session) => {
                  if (session !== undefined) {
                    setPasted('');
                    onSignedIn?.(session);
                  }
                });
              }}
            >
              {status.kind === 'busy' && status.action === 'verify' ? (
                <Loader2 size={14} aria-hidden="true" className="ht-spin" />
              ) : null}
              {t('web.auth.verify')}
            </button>
          </div>
        </details>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: cssVar('space.1'),
  fontSize: cssVar('font-size.2xs'),
  color: cssVar('color.foreground-muted'),
};

const checkboxLabelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: cssVar('space.2'),
  fontSize: cssVar('font-size.2xs'),
  color: cssVar('color.foreground-muted'),
};

/** 邀请码那个输入框下面的提示（只在形状不对时出现）。 */
const hintStyle: React.CSSProperties = {
  margin: 0,
  fontSize: cssVar('font-size.2xs'),
  color: cssVar('color.warning-strong'),
};

/**
 * 「已经有账号了？」那一句。
 *
 * `margin: 0` + 紧贴主按钮：它读起来应当是主按钮的**注脚**，不是第二个区块。
 */
const switchStyle: React.CSSProperties = {
  margin: 0,
  display: 'flex',
  alignItems: 'center',
  gap: cssVar('space.1'),
  flexWrap: 'wrap',
  fontSize: cssVar('font-size.2xs'),
  color: cssVar('color.foreground-muted'),
};

/** 分组小标题（「或用通行密钥」）。用 `xs` 而不是 `2xs`：它下面挂着三个可点的东西。 */
const groupLabelStyle: React.CSSProperties = {
  fontSize: cssVar('font-size.xs'),
  fontWeight: cssVar('font-weight.semibold'),
  color: cssVar('color.foreground-muted'),
};

/** 面板里的补充说明句（预填说明、去哪台服务端、弹窗等待、不支持原因）。 */
const noteStyle: React.CSSProperties = {
  margin: 0,
  display: 'inline-flex',
  alignItems: 'center',
  gap: cssVar('space.1'),
  fontSize: cssVar('font-size.2xs'),
  color: cssVar('color.foreground-muted'),
};

/**
 * 降级成文字链的次要动作。
 *
 * 🔴 不用 `ht-btn--ghost`：那个类有边框与内边距，三个并排时视觉上仍然是"三个按钮"，
 * 降级的意思就没做到。这里**只留一条下划线**，但保留 `min-height` 到触摸目标下限 ——
 * 文字链也要能被手指点中（§5 的触摸目标 token）。
 */
const linkButtonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: cssVar('space.1'),
  padding: 0,
  border: 'none',
  background: 'none',
  color: cssVar('color.primary'),
  textDecoration: 'underline',
  fontSize: cssVar('font-size.2xs'),
  fontFamily: cssVar('font.sans'),
  minHeight: cssVar('touch-target.min'),
  cursor: 'pointer',
};

/** 「高级」整块。折叠时只剩一行 `summary`，主路的高度因此没有变高。 */
const advancedStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: cssVar('space.2'),
  borderTop: `${cssVar('border-width.thin')} solid ${cssVar('color.border')}`,
  paddingTop: cssVar('space.3'),
};

const summaryStyle: React.CSSProperties = {
  cursor: 'pointer',
  fontSize: cssVar('font-size.xs'),
  fontWeight: cssVar('font-weight.semibold'),
  color: cssVar('color.foreground-muted'),
};

const fieldStyle: React.CSSProperties = {
  minHeight: cssVar('touch-target.min'),
  padding: `0 ${cssVar('space.2')}`,
  borderRadius: cssVar('radius.md'),
  border: `${cssVar('border-width.thin')} solid ${cssVar('color.border')}`,
  background: cssVar('color.background'),
  color: cssVar('color.foreground'),
  // ≥16px，否则 iOS 聚焦时自动放大页面
  fontSize: cssVar('font-size.base'),
  fontFamily: cssVar('font.sans'),
};
