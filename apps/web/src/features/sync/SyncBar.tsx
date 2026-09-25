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
import {
  AlertTriangle,
  CheckCircle2,
  CloudOff,
  Loader2,
  RefreshCw,
  Settings,
  X,
} from 'lucide-react';

import { describeStatus, statusColorToken, useSyncStore } from './store.js';

function statusIcon(kind: string): React.JSX.Element {
  switch (kind) {
    case 'synced':
      return <CheckCircle2 size={14} aria-hidden="true" />;
    case 'syncing':
      return <Loader2 size={14} aria-hidden="true" className="ht-spin" />;
    case 'offline':
      return <CloudOff size={14} aria-hidden="true" />;
    case 'error':
      return <AlertTriangle size={14} aria-hidden="true" />;
    default:
      return <CloudOff size={14} aria-hidden="true" />;
  }
}

export function SyncBar() {
  const sync = useSyncStore();
  const [open, setOpen] = useState(false);
  const [baseUrl, setBaseUrl] = useState(sync.baseUrl);
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');

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
          {describeStatus(sync.status)}
        </span>

        <button
          type="button"
          className="ht-btn ht-btn--ghost"
          aria-label="立即同步"
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
          aria-label="同步设置"
          onClick={() => setOpen(true)}
        >
          <Settings size={14} aria-hidden="true" />
        </button>
      </div>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="同步设置"
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
              <h2 style={{ margin: 0, fontSize: cssVar('font-size.lg') }}>同步设置</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="关闭同步设置"
                className="ht-btn ht-btn--ghost"
                style={{ marginLeft: 'auto' }}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>

            <label style={labelStyle}>
              服务端地址
              <input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="http://127.0.0.1:3000"
                style={fieldStyle}
              />
            </label>

            <label style={labelStyle}>
              访问令牌
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                autoComplete="off"
                style={fieldStyle}
              />
            </label>

            <label style={labelStyle}>
              端到端加密口令
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
              口令<strong>不会</strong>被保存到磁盘，只存在于本次会话的内存中。
              它一旦丢失，已同步的数据将无法解密 —— 请自行妥善保管。
              没有口令时同步会被拒绝，服务端只接受端到端加密的载荷。
            </p>

            <div style={{ display: 'flex', gap: cssVar('space.2'), justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="ht-btn ht-btn--ghost"
                onClick={() => {
                  sync.clearCredentials();
                  setOpen(false);
                }}
              >
                清除凭据
              </button>
              <button
                type="button"
                className="ht-btn ht-btn--primary"
                onClick={() => {
                  sync.configure(baseUrl, token, password);
                  setOpen(false);
                  void sync.syncNow();
                }}
              >
                保存并同步
              </button>
            </div>
          </div>
        </div>
      )}
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
