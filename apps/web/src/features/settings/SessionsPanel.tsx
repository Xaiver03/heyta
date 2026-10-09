/**
 * 登录设备面板（设置 → 账号安全）
 * ============================
 *
 * 在这一面板之前，"退出某一台设备"这件事只有**一档**：`tokenVersion++` 全局作废
 * （也就是"把所有地方都踢下线"）。服务端本轮补了按 `sessionId` 逐个撤销，
 * 而 `apps/web` 里既没有列表也没有按钮 —— 这个面板补的就是那个界面。
 *
 * ## 分层（AGENTS.md §3.5）
 *
 * 这里**没有一行协议知识**：
 *   - 路径 / 方法 / Bearer / `sessionId` 的合法形状 / 失败归类 → `@heyta/app-host`；
 *   - **"这一行是不是手上这一枚"由服务端判**（它比对自己验出来的 `jti`）。
 *     界面上那个标记就是 `session.current`，**不**是"我本机的 clientId" ——
 *     后者在另一台设备上会把「退出登录」点成撤销别人的令牌；
 *   - 句子 → `@heyta/i18n` 的 `common.sessions.*`。
 *
 * ## 🔴 四条必须说清楚的地方
 *
 *   1. **读侧失败不许画成空列表。** "没有别的设备登录着"是一句需要**证据**的话。
 *   2. **`current` 那一行的撤销按钮是禁用的，而且旁边有一句为什么。**
 *      撤销手上这一枚的正确出口是「退出登录」（它同时清本机凭据）；
 *      在这里点它只会让令牌先死、界面还挂着会话，那是最难解释的一种半状态。
 *   3. **单台撤销是一次点击，不做两段式确认**（与 `PasskeyPanel` 的删除不同）：
 *      删通行密钥对纯通行密钥账号是**不可逆**的，而撤一枚会话的代价是"那台设备
 *      重新登录一次"。误点了能走出去，所以不给人加一道"确认"。
 *   4. **`unknown-session` 不说"已退出"，也不报失败** —— 见 `sessionsStore.ts` 文件头
 *      第 3 条。三种情况（不存在 / 不是你的 / 已经撤过）在服务端故意同一个码同一句话。
 *
 * ## 名字回落
 *
 * `deviceName` 与 `userAgent` **都**没有时**不编一个"未命名"**（与 `PasskeyPanel`
 * 同一条立场：那会造出一个看起来像名字的字符串，而它不是）。那一行仍然带着
 * 两个真实存在的字段（这次登录开始于 / 上次用到），足够认出是谁。
 */

import { useEffect, useRef, useState } from 'react';

import { AlertTriangle, CheckCircle2, Loader2, LogOut, RefreshCw } from 'lucide-react';

import { useI18n, type Locale } from '@heyta/i18n';
import { EmptyState, HeytaUiProvider } from '@heyta/ui';
import { ICON_SIZE } from '@heyta/design-system';
import type { SessionSummary } from '@heyta/shared-schema';

import { useSyncStore } from '../sync/store.js';
import { useSessionsStore } from './sessionsStore.js';
import { useSignOutStore } from './signOutStore.js';
import { SettingsAccountGate } from './SettingsAccountGate.js';

/**
 * 时间戳 → 人读的一行。
 *
 * ⚠️ 与 `ConflictDialog.formatTime` / `ReminderPanel.formatReminderWhen` 同一条理由：
 * 语言要从 `useI18n()` 拿，**不能**裸 `toLocaleString()` —— 那跟的是操作系统语言，
 * 实测会让英文界面用中文习惯排日期。
 */
function formatWhen(ms: number, locale: Locale): string {
  return new Date(ms).toLocaleString(locale, {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** 这一行叫什么：设备名 → UA → **什么都不编**。 */
function rowLabel(session: SessionSummary): string | undefined {
  const device = session.deviceName?.trim();
  if (device !== undefined && device !== '') return device;
  const ua = session.userAgent?.trim();
  return ua === '' ? undefined : ua;
}

/**
 * 最近的那次登录排在最前。
 *
 * ⚠️ 排序是**呈现**，不是业务判断，所以它可以住在壳里：服务端刻意不承诺顺序
 * （`listHostedSessions` 原样返回行），而"我刚才在哪台设备登录的"必须在第一屏。
 */
const newestFirst = (a: SessionSummary, b: SessionSummary): number => b.createdAt - a.createdAt;

export function SessionsPanel({ active = true }: { active?: boolean }): React.JSX.Element {
  const { t, locale } = useI18n();

  const baseUrl = useSyncStore((s) => s.baseUrl);
  const token = useSyncStore((s) => s.token);

  const state = useSessionsStore((s) => s.state);
  const revokingId = useSessionsStore((s) => s.revokingId);
  const revokeFailure = useSessionsStore((s) => s.revokeFailure);
  const justRevoked = useSessionsStore((s) => s.justRevoked);
  const load = useSessionsStore((s) => s.load);
  const revoke = useSessionsStore((s) => s.revoke);
  const dismissNotices = useSessionsStore((s) => s.dismissNotices);

  const signOutEverywhere = useSignOutStore((s) => s.signOutEverywhere);
  const signingOutAll = useSignOutStore((s) => s.running === 'all');

  /** 手动刷新那一下的本地视觉态（列表内容一律以服务端为准，见 sessionsStore）。 */
  const [refreshing, setRefreshing] = useState(false);
  const activeRef = useRef(active);
  activeRef.current = active;

  const signedIn = baseUrl.trim() !== '' && typeof token === 'string' && token !== '';

  useEffect(() => {
    if (!active || !signedIn) return;
    // 换账号 / 换服务器都要重拉：这份列表属于**当前**这个账号。
    void load(baseUrl, token);
  }, [active, baseUrl, token, signedIn, load]);

  const sessions = state.kind === 'loaded' ? [...state.sessions].sort(newestFirst) : undefined;

  const reload = (): void => {
    setRefreshing(true);
    dismissNotices();
    void load(baseUrl, token).finally(() => setRefreshing(false));
  };

  return (
    <div className="ht-settings" data-testid="sessions-panel">
      <h2 className="ht-settings__title ht-type-section-title">{t('common.sessions.title')}</h2>
      <p className="ht-settings__hint">{t('common.sessions.intro')}</p>

      {!signedIn ? (
        <SettingsAccountGate
          messageKey="common.sessions.intro"
          testId="sessions-needs-sign-in"
        />
      ) : (
        <>
          <div className="ht-settings__actions">
            <button
              type="button"
              className="ht-btn ht-btn--ghost"
              data-testid="sessions-refresh"
              disabled={state.kind === 'loading' || refreshing}
              onClick={() => {
                if (!activeRef.current) return;
                reload();
              }}
            >
              {state.kind === 'loading' || refreshing ? (
                <Loader2 size={ICON_SIZE.xs} aria-hidden="true" />
              ) : (
                <RefreshCw size={ICON_SIZE.xs} aria-hidden="true" />
              )}{' '}
              {t('web.passkeys.refresh')}
            </button>
            {/*
              🔴 「退出所有设备」是这一面板里唯一一次会**把这台也退出**的动作，
              所以它是危险色按钮，而且后果写在按钮之前（下面那句 hint）。
              走的是与头像菜单同一个实现（`signOutStore`），不是第二份登出逻辑。
            */}
            <button
              type="button"
              className="ht-btn ht-btn--danger"
              data-testid="sessions-logout-all"
              onClick={() => {
                if (!activeRef.current) return;
                dismissNotices();
                void signOutEverywhere();
              }}
            >
              {signingOutAll ? (
                <Loader2 size={ICON_SIZE.xs} aria-hidden="true" />
              ) : (
                <LogOut size={ICON_SIZE.xs} aria-hidden="true" />
              )}{' '}
              {signingOutAll ? t('common.sessions.busy') : t('common.sessions.logoutAll')}
            </button>
          </div>

          {state.kind === 'loading' && (
            <p className="ht-settings__hint" role="status" data-testid="sessions-loading">
              {t('common.sessions.busy')}
            </p>
          )}

          {state.kind === 'failed' && (
            <p className="ht-settings__danger" role="alert" data-testid="sessions-load-failed">
              <AlertTriangle size={ICON_SIZE.xs} aria-hidden="true" /> {t('common.sessions.failed')}
            </p>
          )}

          {sessions !== undefined && sessions.length === 0 && (
            /*
              🔴 走**共享那一个实现**（`packages/ui` 的 `EmptyState`），不在视图里手写
              骨架与文案 —— `pnpm check:empty-state` 的判据 3，也是 `AdminPanel` /
              `FocusDetailPane` 已经在用的形状。
              共享组件必须挂在 `<HeytaUiProvider>` 之内（它读 token，缺了会**主动抛错**，
              与 `check:ui-provider` 同源）；这里自带一层，面板被单独挂载时也不塌。
            */
            <HeytaUiProvider>
              <EmptyState title={t('common.sessions.empty')} />
            </HeytaUiProvider>
          )}

          {/*
            本轮之前签出去的令牌**没有 `jti`**，因此不在这份列表里、也不能逐个撤销
            （服务端契约里写明的过渡）。列表再干净也不等于"只有这几台"，
            所以这句在**任何**加载成功的状态下面都要出现 —— 空列表时最需要它的正是
            "看起来谁都没登录"的那一刻。
          */}
          {sessions !== undefined && (
            <p className="ht-settings__hint" data-testid="sessions-legacy-hint">
              {t('common.sessions.legacyHint')}
            </p>
          )}

          {sessions?.map((session) => {
            const label = rowLabel(session);
            const revoking = revokingId === session.sessionId;
            return (
              <section
                className="ht-settings__section ht-settings__credential"
                key={session.sessionId}
                data-testid={`session-row-${session.sessionId}`}
              >
                <div className="ht-settings__credential-main">
                  {label === undefined ? null : (
                    <p className="ht-settings__item-label" data-testid={`session-label-${session.sessionId}`}>
                      {label}
                    </p>
                  )}
                  {session.current && (
                    <p
                      className="ht-settings__item-label"
                      data-testid={`session-current-${session.sessionId}`}
                    >
                      {t('common.sessions.thisDevice')}
                    </p>
                  )}
                  <p className="ht-settings__credential-meta">
                    {t('common.sessions.signedInSince')} {formatWhen(session.createdAt, locale)}
                    {' · '}
                    {t('common.sessions.lastSeen')} {formatWhen(session.lastSeenAt, locale)}
                  </p>
                  {/* 🔴 这台就是正在用的设备 ⇒ 撤销它的出口不在这里（文件头第 2 条）。 */}
                  {session.current && (
                    <p className="ht-settings__hint" data-testid={`session-hint-${session.sessionId}`}>
                      {t('common.sessions.currentHint')}
                    </p>
                  )}
                </div>
                <div className="ht-settings__actions">
                  <button
                    type="button"
                    className="ht-btn ht-btn--ghost"
                    data-testid={`session-revoke-${session.sessionId}`}
                    // 这一行的按钮禁用，**不影响**别的行；current 那一行永远禁用。
                    disabled={session.current || revoking}
                    onClick={() => {
                      if (!activeRef.current) return;
                      dismissNotices();
                      void revoke(baseUrl, token, session.sessionId);
                    }}
                  >
                    {revoking ? (
                      <Loader2 size={ICON_SIZE.xs} aria-hidden="true" />
                    ) : (
                      <LogOut size={ICON_SIZE.xs} aria-hidden="true" />
                    )}{' '}
                    {revoking ? t('common.sessions.busy') : t('common.sessions.revoke')}
                  </button>
                </div>
              </section>
            );
          })}

          {justRevoked && (
            <p className="ht-settings__notice" role="status" data-testid="sessions-revoked">
              <CheckCircle2 size={ICON_SIZE.xs} aria-hidden="true" /> {t('common.sessions.revoked')}
            </p>
          )}

          {revokeFailure !== undefined && (
            <p className="ht-settings__danger" role="alert" data-testid="sessions-revoke-failed">
              <AlertTriangle size={ICON_SIZE.xs} aria-hidden="true" /> {t('common.sessions.failed')}
            </p>
          )}
        </>
      )}
    </div>
  );
}
