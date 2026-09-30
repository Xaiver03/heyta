/**
 * 登录 / 注册面板（Web）
 * ======================
 *
 * 服务端有完整认证，而在此之前的 Web 界面里**没有一个入口调用它**：
 * 用户只能在同步设置里手填令牌，而没有任何地方告诉他令牌从哪来。
 * 这个面板就是那个入口。
 *
 * ## 分层（AGENTS.md §3.5）
 *
 * 这里**没有一行协议知识**：
 *   - 端点、请求体、凭据字段、失败归类 → `@heyta/app-host` 的 `hosted-auth.ts`；
 *   - "链接里的哪一段是令牌" → 同处的 `extractAuthLinkToken`；
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
   * 服务端地址的**面板内**输入（W2：让顶栏一次点击就能到达注册/登录）。
   *
   * 🔴 为什么需要它：`AuthPanel` 原本只接受外部传入的 `baseUrl`
   * （来自同步设置对话框的输入框），于是它**只能在那个对话框里打开** ——
   * 而产品要求"注册/登录前置"，前置就意味着要能从顶栏直接进来。
   *
   * 🔴 为什么不是"另做一个入口、各用各的地址"：认证与同步**必须指向同一个服务端**
   * （见 `AuthPanelProps.baseUrl` 的注释）。所以这里的输入**不是**第二个地址来源 ——
   * 登录成功后 `applyAuthSession` 就是用它写进同步配置的，仍然是唯一一份。
   *
   * 行为：`baseUrl` 非空（已配置）时**不显示**这个输入，面板与原来完全一致。
   */
  const [localBaseUrl, setLocalBaseUrl] = useState('');
  const effectiveBaseUrl = baseUrl === '' ? localBaseUrl : baseUrl;

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

        {/* W2：只在**尚未配置服务端**时显示地址输入。
            已配置时（从同步设置对话框进来）这一块整体不渲染 ——
            面板与改动前逐像素一致，避免出现"同一个地址两个输入框"。 */}
        {baseUrl === '' ? (
          <label style={labelStyle}>
            {t('web.sync.serverUrl.label')}
            <input
              type="url"
              value={localBaseUrl}
              onChange={(e) => setLocalBaseUrl(e.target.value)}
              placeholder={t('web.sync.serverUrl.placeholder')}
              autoComplete="url"
              inputMode="url"
              style={fieldStyle}
            />
          </label>
        ) : null}

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

        <div style={{ display: 'flex', gap: cssVar('space.2') }}>
          <button
            type="button"
            className="ht-btn ht-btn--primary"
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
          <button
            type="button"
            className="ht-btn ht-btn--ghost"
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
          通行密钥。与上面两个按钮是**并列的两条路**，不是同一条的快捷方式：
          这里多了一步系统弹窗。
        */}
        <div style={{ display: 'flex', gap: cssVar('space.2'), flexWrap: 'wrap' }}>
          <button
            type="button"
            className="ht-btn ht-btn--ghost"
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
            className="ht-btn ht-btn--ghost"
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
        </div>

        {/* 不支持时**不禁用按钮、而是说明原因** —— 禁用了却不说，用户只会以为界面坏了。 */}
        {!passkeySupported ? (
          <span
            style={{
              fontSize: cssVar('font-size.2xs'),
              color: cssVar('color.foreground-muted'),
            }}
          >
            {t('web.auth.passkey.unavailable')}
          </span>
        ) : null}

        {/* 系统弹窗期间必须说"去看弹窗"，否则用户会以为卡住了。 */}
        {waitingForPasskey ? (
          <span
            role="status"
            aria-live="polite"
            style={{
              fontSize: cssVar('font-size.2xs'),
              color: cssVar('color.foreground-muted'),
            }}
          >
            {t('web.auth.passkey.waiting')}
          </span>
        ) : null}

        {/*
          找回通行密钥的**入口**（只是入口 —— 恢复本身在邮件点开后的服务端页面上完成，
          因为那一步必须在真实浏览器里让系统弹窗创建新凭据）。

          🔴 补这个按钮之前，丢了通行密钥的用户**没有任何办法拿到恢复链接**：
          服务端 `/api/recover/passkey` 与 app-host 的 `requestPasskeyRecovery`
          都是完整实现，却零调用方 —— 功能做完了，用户做不到。
        */}
        <div style={{ display: 'flex' }}>
          <button
            type="button"
            className="ht-btn ht-btn--ghost"
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
