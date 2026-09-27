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
 * ## 通行密钥（未接）
 *
 * `@heyta/app-host` 已经提供了通行密钥的协议两半（取 options / 交 credential），
 * 中间那一步平台调用（`navigator.credentials`）**刻意留在宿主里**。
 * 本面板目前只走登录链接这条路 —— 它是零额外平台代码、且在浏览器与原生端
 * 行为一致的那条。通行密钥的浏览器接线**尚未做**（见交付报告）。
 */

import { useState } from 'react';
import { cssVar } from '@heyta/design-system';
import { useI18n, type MessageKey } from '@heyta/i18n';
import type { HostedAuthFailureReason, HostedAuthSession } from '@heyta/app-host';
import { AlertTriangle, CheckCircle2, Loader2, Mail, UserPlus, X } from 'lucide-react';

import { useAuthStore } from './store.js';

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

/**
 * 失败原因 → 词条 key。
 *
 * 🔴 这是**唯一**让 `HostedAuthFailureReason` 这个封闭集合变成句子的地方。
 * 新增一个原因时这里会因 `switch` 不穷尽而由类型系统拦住（默认分支只在
 * "确实说不出更具体的话"时兜底）。
 */
function authFailureKey(reason: HostedAuthFailureReason): MessageKey {
  switch (reason) {
    case 'unconfigured':
      return 'web.auth.error.unconfigured';
    case 'invalid-input':
      return 'web.auth.error.invalidEmail';
    case 'not-allowed':
      return 'web.auth.error.notAllowed';
    case 'unauthorized':
      return 'web.auth.error.unauthorized';
    case 'rate-limited':
      return 'web.auth.error.rateLimited';
    case 'network':
      return 'web.auth.error.network';
    case 'server-error':
      return 'web.auth.error.server';
    default:
      return 'web.auth.error.unknown';
  }
}

export function AuthPanel({ baseUrl, onClose, onSignedIn }: AuthPanelProps): React.JSX.Element {
  const { t } = useI18n();
  const status = useAuthStore((s) => s.status);
  const sendLoginLink = useAuthStore((s) => s.sendLoginLink);
  const registerAccount = useAuthStore((s) => s.registerAccount);
  const verify = useAuthStore((s) => s.verify);

  const [email, setEmail] = useState('');
  const [pasted, setPasted] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);

  const busy = status.kind === 'busy';
  const signingIn = status.kind === 'signed-in';

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
              {t(authFailureKey(status.reason))}
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
                </>
              )}
            </span>
          )}
        </div>

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
              void sendLoginLink(baseUrl, email);
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
              void registerAccount(baseUrl, email, termsAccepted);
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
              void verify(baseUrl, pasted).then((session) => {
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
