/**
 * 同步状态条
 * ============
 *
 * 计划 3.3 的判据：**界面能看出"已同步 / 同步中 / 冲突 / 离线"**。
 *
 * 设计取舍：状态用**图标 + 文字**表达，不只靠颜色。
 * 只靠颜色的话，色觉障碍用户无法区分"离线"和"出错" ——
 * 而这两者的用户动作完全不同（等待 vs 去修设置）。
 */

import { useState } from 'react';
import { cssVar, type TokenName } from '@heyta/design-system';
import { useI18n, type I18nValue } from '@heyta/i18n';
import type { SyncStatus } from '@heyta/sync-client';
import type { HostedAuthSession } from '@heyta/app-host';
import {
  AlertTriangle,
  CheckCircle2,
  CloudOff,
  Loader2,
  RefreshCw,
  Settings,
  X,
} from 'lucide-react';

import { AuthPanel } from '../auth/AuthPanel.js';
import { statusColorToken, useSyncStore } from './store.js';
import { SYNC_FAILURE_KEY } from './sync-failure-copy.js';

/**
 * 服务端地址的示例。**不是文案，是 URL 字面量。**
 *
 * URL 两种语言完全一样，不该翻译；而 zh 词条被门禁要求"必须含汉字"，
 * 一个纯 URL 词条放不进词条表。所以它在这里作为**具名常量**存在 ——
 * 直接把这个字面量写进输入的 placeholder 属性会被迁移模式判成"硬编码文案"，
 * 而它其实是数据（用户要照着填的地址格式）。
 */
const SERVER_URL_EXAMPLE = 'http://127.0.0.1:3000';

/**
 * 同步状态 → 用户能读、能行动的句子。
 *
 * 🔴 这段话原先由 `features/sync/store.ts` 的 `describeStatus` 在**非 UI 层**
 * 拼成中文返回，组件直接渲染 —— 英文界面因此永远显示中文。
 * 现在按"state 只带数据、句子在壳里拼"的纪律全部搬到这里：
 * `SyncStatus` 本身是结构化的判别联合，措辞属于壳；
 * 连"没配置"那一条也只在 store 里留一个**结构化原因**（`reason: 'not-configured'`）。
 *
 * ⚠️ `error.message` 其余情况仍是**数据**（来自网络或服务端的技术串），
 * 原样带进句子里，不编也不映射。
 */
function describeSyncStatus(status: SyncStatus, t: I18nValue['t']): string {
  switch (status.kind) {
    case 'idle':
      return t('web.sync.status.idle');
    case 'syncing':
      // 下载与上传是两件事，措辞必须分开。
      return status.phase === 'download'
        ? t('web.sync.status.downloading')
        : t('web.sync.status.uploading');
    case 'synced':
      return t('web.sync.status.synced');
    case 'offline':
      return t('web.sync.status.offline');
    case 'conflict': {
      // 🔴 词条表没有 ICU：1 处冲突是最常见的情形，必须分支到单数兄弟词条。
      // 不写 `t(count === 1 ? 'a' : 'b')` —— 那样两种形状都认不出（见门禁文件头）。
      const count = status.conflicts.length;
      if (count === 1) return t('web.sync.status.conflictOne', { count });
      return t('web.sync.status.conflict', { count });
    }
    case 'error': {
      // 🔴 已知原因：**整句**走词条。不要退回成
      // `t('web.sync.status.errorRetryable', { message: status.message })` ——
      // 那会把包里的中文插进英文句子里（中英混排），而门禁扫不到这种变量渲染。
      if (status.reason === 'unexpected') {
        // 意外异常：`message` 是诊断数据（不是文案），当参数带进来。
        return t('web.sync.status.errorRetryable', { message: status.message });
      }
      return t(SYNC_FAILURE_KEY[status.reason]);
    }
  }
}

function statusIcon(kind: string): React.JSX.Element {
  switch (kind) {
    case 'synced':
      return <CheckCircle2 size={14} aria-hidden="true" />;
    case 'syncing':
      return <Loader2 size={14} aria-hidden="true" className="ht-spin" />;
    case 'offline':
      return <CloudOff size={14} aria-hidden="true" />;
    case 'error':
    case 'conflict':
      // 冲突不是故障，但确实需要用户注意 —— 和 error 共用警示图标，
      // 具体措辞由 describeSyncStatus 区分
      return <AlertTriangle size={14} aria-hidden="true" />;
    default:
      return <CloudOff size={14} aria-hidden="true" />;
  }
}

export function SyncBar() {
  const { t } = useI18n();
  const sync = useSyncStore();
  /**
   * 对话框的开合状态**在 `useSyncStore` 里**，不是这里的局部 state ——
   * 订阅提示的「改用你自己的服务器」也要打开它（见 store 里的注释）。
   */
  const open = useSyncStore((s) => s.settingsOpen);
  const [baseUrl, setBaseUrl] = useState(sync.baseUrl);
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  /**
   * 认证面板的开合。
   *
   * 🔴 它在**同步设置对话框里面**打开，而不是另做一个更靠前的入口：
   * 认证要用的服务端地址就是这里的地址，两者分开会让用户对着 A 登录、
   * 把令牌存到 B。状态留成局部 state 是因为**只有一个入口**打开它 ——
   * 两个入口才需要提到 store 里（见 `store.ts` 里 `settingsOpen` 的注释）。
   */
  const [authOpen, setAuthOpen] = useState(false);

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: cssVar('space.2'),
          fontSize: cssVar('font-size.2xs'),
          color: cssVar('color.foreground-muted'),
        }}
        // 同步状态是异步变化的，用 live region 让屏幕阅读器播报
        role="status"
        aria-live="polite"
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: cssVar('space.1'),
            color: cssVar(statusColorToken(sync.status) as TokenName),
          }}
        >
          {statusIcon(sync.status.kind)}
          {describeSyncStatus(sync.status, t)}
        </span>

        {/* 冲突需要一个**看得见的入口**：关掉对话框之后，
            用户还得能再打开它，否则问题就从"没法解决"变成"看不见了" */}
        {sync.status.kind === 'conflict' ? (
          <button
            type="button"
            className="ht-btn ht-btn--primary"
            onClick={sync.openConflictDialog}
          >
            {t('web.sync.resolveConflicts')}
          </button>
        ) : null}

        <button
          type="button"
          className="ht-btn ht-btn--ghost"
          aria-label={t('web.sync.a11y.syncNow')}
          disabled={sync.status.kind === 'syncing'}
          onClick={() => {
            void sync.syncNow();
          }}
        >
          <RefreshCw size={14} aria-hidden="true" />
        </button>

        <button
          type="button"
          className="ht-btn ht-btn--ghost"
          aria-label={t('web.sync.settings.title')}
          onClick={sync.openSettings}
        >
          <Settings size={14} aria-hidden="true" />
        </button>
      </div>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('web.sync.settings.title')}
          style={{
            position: 'fixed',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            background: cssVar('color.overlay'),
            // 模态是真正的浮层 —— 这里用阴影是对的
            zIndex: cssVar('z.modal'),
          }}
        >
          <div
            style={{
              background: cssVar('color.surface-raised'),
              borderRadius: cssVar('radius.lg'),
              boxShadow: cssVar('shadow.lg'),
              padding: cssVar('space.6'),
              minWidth: cssVar('layout.content-max'),
              maxWidth: '90vw',
              display: 'flex',
              flexDirection: 'column',
              gap: cssVar('space.3'),
              color: cssVar('color.foreground'),
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <h2 style={{ margin: 0, fontSize: cssVar('font-size.lg') }}>
                {t('web.sync.settings.title')}
              </h2>
              <button
                type="button"
                onClick={sync.closeSettings}
                aria-label={t('web.sync.settings.close')}
                className="ht-btn ht-btn--ghost"
                style={{ marginLeft: 'auto' }}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>

            <label style={labelStyle}>
              {t('web.sync.serverUrl.label')}
              <input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={SERVER_URL_EXAMPLE}
                style={fieldStyle}
              />
            </label>

            <label style={labelStyle}>
              {t('web.sync.token.label')}
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                autoComplete="off"
                style={fieldStyle}
              />
            </label>

            {/* 「令牌从哪来」的入口。手填**保留**（自建用户可能已有令牌），
                这里只是补上一条不必手填的路。 */}
            <p style={hintStyle}>{t('web.auth.tokenHint')}</p>
            <button
              type="button"
              className="ht-btn ht-btn--ghost"
              style={{ alignSelf: 'flex-start' }}
              onClick={() => setAuthOpen(true)}
            >
              {t('web.auth.open')}
            </button>

            <label style={labelStyle}>
              {t('web.sync.password.label')}
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                style={fieldStyle}
              />
            </label>

            <p
              style={{
                margin: 0,
                fontSize: cssVar('font-size.2xs'),
                color: cssVar('color.foreground-muted'),
                lineHeight: cssVar('line-height.normal'),
              }}
            >
              {t('web.sync.password.lead')}
              <strong>{t('web.sync.password.strong')}</strong>
              {t('web.sync.password.tail')}
            </p>

            <div style={{ display: 'flex', gap: cssVar('space.2'), justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="ht-btn ht-btn--ghost"
                onClick={() => {
                  sync.clearCredentials();
                  sync.closeSettings();
                }}
              >
                {t('web.sync.clearCredentials')}
              </button>
              <button
                type="button"
                className="ht-btn ht-btn--primary"
                onClick={() => {
                  sync.configure(baseUrl, token, password);
                  sync.closeSettings();
                  void sync.syncNow();
                }}
              >
                {t('web.sync.saveAndSync')}
              </button>
            </div>
          </div>
        </div>
      )}

      {authOpen ? (
        <AuthPanel
          baseUrl={baseUrl}
          onClose={() => setAuthOpen(false)}
          onSignedIn={(session: HostedAuthSession) => {
            // 认证 store 已经把令牌写进了同步配置；这里把**这个对话框的输入框**
            // 也对齐，否则用户接着点「保存并同步」会用空输入框把它覆盖掉。
            setToken(session.token);
            setAuthOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: cssVar('space.1'),
  fontSize: cssVar('font-size.2xs'),
  color: cssVar('color.foreground-muted'),
};

/** 字段下方的说明句 —— 比标签更轻，但仍然可读。 */
const hintStyle: React.CSSProperties = {
  margin: 0,
  fontSize: cssVar('font-size.2xs'),
  color: cssVar('color.foreground-muted'),
  lineHeight: cssVar('line-height.normal'),
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
