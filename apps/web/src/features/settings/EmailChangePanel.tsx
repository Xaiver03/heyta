/**
 * 换绑登录邮箱面板（设置 → 个人信息，紧挨着只读的邮箱那一行）
 * ======================================================
 *
 * 在此之前 `ProfilePanel` 的邮箱行是**纯只读**的，而 `common.profile.email.hint`
 * 原先写着"邮箱不可修改"。这一面板补的就是那个缺口：用户终于能换一个地址，
 * 而换法是**两边各点一次**（旧邮箱 = 授权，新邮箱 = 验证）。
 *
 * ## 分层（AGENTS.md §3.5）
 *
 * 这里**没有一行协议知识**：
 *   - 路径 / 方法 / 令牌怎么带 / 失败归类 → `@heyta/app-host` 的 `account-security.ts`；
 *   - "24 小时""60 秒冷却""两边点齐才生效" → `@heyta/shared-schema` 的契约 + 服务端；
 *   - 状态机 → `./emailChangeStore.js`；
 *   - 句子 → `@heyta/i18n` 的 `common.emailChange.*`（中英已同步，本壳不许硬编码）。
 * 本文件只做两件事：**把结构化状态渲染成人看得懂的句子**，以及**收集那一个新地址**。
 *
 * ## 🔴 四条必须说清楚的地方
 *
 *   1. **"还等哪一边"只从服务端的 status 读，绝不记在组件里。**
 *      两封信可能由**两台设备、两个人、隔几个小时**各点一次；本地态结构上
 *      不可能知道另一边发生了什么。刷新一次就把本地标记丢掉，而界面上那句
 *      话会继续说一个它已经不知道的事实。判据在测试里：面板**一次按钮都没点**，
 *      只凭 status 的两种取值必须渲染出两句不同的话。
 *   2. **冷却期里"发起更换"这个动作必须不存在**（不是变灰、不是点了没反应）。
 *      服务端此时**什么都不会发**（429 + `email_change_cooldown`），而一个能按的
 *      按钮在用户手上等于"再发两封信"。此时他该做的是去点开已经在收件箱里的那两封。
 *   3. **这里没有"确认"按钮。** 确认在**邮件里**（服务端渲染的 `/change-email?token=`），
 *      客户端故意不开那条通路 —— 见 `account-security.ts` 文件头。摆一个
 *      "我点过确认了"只会造出第二个裁决点，而那两个收件箱各自的时序只能有一个地方判。
 *   4. **标签与值分开渲染，不拼 `{label}：{value}`。** 冒号是一种文案，而中英两种
 *      语言的标点不一样（`check:ui-language` 只查句子，这种短标点最容易溜过去）。
 */

import { useEffect, useRef, useState } from 'react';

import { AlertTriangle, CheckCircle2, Loader2, Mail, XCircle } from 'lucide-react';

import { useI18n, type MessageKey, type MessageVars } from '@heyta/i18n';
import { emailChangeStage, type HostedAuthFailureReason } from '@heyta/app-host';
import { ICON_SIZE } from '@heyta/design-system';

import { useSyncStore } from '../sync/store.js';
import { useEmailChangeStore, type EmailChangeRequestFailure } from './emailChangeStore.js';
import { SettingsAccountGate } from './SettingsAccountGate.js';

/**
 * 失败原因 → 词条 key。
 *
 * 🔴 这是本面板**唯一**把 `HostedAuthFailureReason` 翻成人话的地方（发起与读取共用）。
 * 每一条都要单独一句的理由是"用户接下来做的事不同"：
 * `taken` 要换一个地址、`notVerified` 要去点**另一封**邮件、`invalidLink` 是重新发起、
 * 而 `network` 必须明说"邮箱没有改动"（否则用户不知道现在该信哪一边）。
 */
function failureKey(reason: HostedAuthFailureReason): MessageKey {
  switch (reason) {
    case 'email-taken':
      return 'common.emailChange.taken';
    case 'email-unchanged':
      return 'common.emailChange.unchanged';
    case 'email-not-verified':
      return 'common.emailChange.notVerified';
    case 'invalid-change-link':
      return 'common.emailChange.invalidLink';
    case 'network':
      return 'common.emailChange.network';
    default:
      return 'common.emailChange.error';
  }
}

/**
 * 发起失败要渲染的那句话（可能**没有**话可渲染）。
 *
 * 🔴 `email-change-cooldown` 特殊：那句 `{seconds}` 的数字**只能来自服务端**
 * （`retryAfterSeconds`，或重读 status 拿到的 `resendAvailableAt`）。
 * 两个都没有时**宁可这一行不出现**，也不许编一个秒数 —— 界面报"0 秒后可以重新发起"
 * 而服务端仍在冷却，用户点第二次拿到同一个 429，那就是界面在骗人。
 */
function requestFailureOutcome(
  failure: EmailChangeRequestFailure,
): { key: MessageKey; vars?: MessageVars } | undefined {
  if (failure.reason === 'email-change-cooldown') {
    return failure.retryAfterSeconds === undefined
      ? undefined
      : { key: 'common.emailChange.cooldown', vars: { seconds: failure.retryAfterSeconds } };
  }
  return { key: failureKey(failure.reason) };
}

/**
 * 阶段 → 那句实话。输入的**只有** status 派出的 stage，没有第二个来源。
 *
 * ⚠️ `idle` 这一支在面板里不会走到（那时候摆的是表单）；留着是因为
 * `emailChangeStage` 的返回类型是那个封闭联合，**穷举**才不会在下一次共享层
 * 加一个阶段时静默落到 default 上。
 */
function stageKey(stage: ReturnType<typeof emailChangeStage>): MessageKey {
  switch (stage) {
    case 'awaiting-both':
      return 'common.emailChange.awaitingBoth';
    case 'awaiting-old':
      return 'common.emailChange.awaitingOld';
    case 'awaiting-new':
      return 'common.emailChange.awaitingNew';
    default:
      // `invalid` = 服务端说这张请求还活着，却两边都不等。说"等另一边"是假话，
      // 说"已生效"也是假话 ⇒ 老实落在那句"没成功，请重试"。
      // ⚠️ 本轮拿到的 key 清单里**没有**专用词条，所以借用这一句。
      return 'common.emailChange.error';
  }
}

export function EmailChangePanel({ active = true }: { active?: boolean }): React.JSX.Element {
  const { t, locale } = useI18n();

  const baseUrl = useSyncStore((s) => s.baseUrl);
  const token = useSyncStore((s) => s.token);
  const email = useSyncStore((s) => s.email);

  const state = useEmailChangeStore((s) => s.state);
  const requesting = useEmailChangeStore((s) => s.requesting);
  const cancelling = useEmailChangeStore((s) => s.cancelling);
  const requestFailure = useEmailChangeStore((s) => s.requestFailure);
  const cancelFailure = useEmailChangeStore((s) => s.cancelFailure);
  const justSent = useEmailChangeStore((s) => s.justSent);
  const justCancelled = useEmailChangeStore((s) => s.justCancelled);
  const load = useEmailChangeStore((s) => s.load);
  const request = useEmailChangeStore((s) => s.request);
  const cancel = useEmailChangeStore((s) => s.cancel);
  const dismissNotices = useEmailChangeStore((s) => s.dismissNotices);

  const [draft, setDraft] = useState('');
  /** 只有"没填"这一种本地校验（它不需要任何服务端知识）。 */
  const [localMissing, setLocalMissing] = useState(false);
  /**
   * "现在"。只用来把 `resendAvailableAt` 这个**绝对时刻**折算成倒计时秒数。
   *
   * 🔴 它**不是**"还等哪一边"那类状态（那个永远从 status 读，见文件头第 1 条）：
   * 这里只是一个渲染期的换算，掉一次下一次 tick 会重新算，刷新也不丢。
   */
  const [now, setNow] = useState(() => Date.now());
  const activeRef = useRef(active);
  activeRef.current = active;

  const signedIn = baseUrl.trim() !== '' && typeof token === 'string' && token !== '';

  useEffect(() => {
    if (!active || !signedIn) return;
    // 换账号 / 换服务器都要重读：这张活请求属于**当前**这个账号。
    void load(baseUrl, token);
  }, [active, baseUrl, token, signedIn, load]);

  const status = state.kind === 'loaded' ? state.status : undefined;
  const stage = status === undefined ? 'idle' : emailChangeStage(status);
  /*
    🔴 这一块的开关是**服务端说的那个 `pending`**，不是 stage 推出来的三种"还在等"。
    `stage === 'invalid'`（pending 为真却两边都不等）也要显示它：那张请求在服务端
    **还活着**，把它藏起来就等于把表单摆在一个 429 的位置上 —— 用户点第二次拿到
    同一句"还在冷却"，而这里唯一的出口（撤销那张请求）被他看不见。
  */
  const requestPending = status?.pending === true;
  const resendAvailableAt = status?.resendAvailableAt;
  const cooldownSecondsLeft =
    resendAvailableAt === undefined || resendAvailableAt <= now
      ? undefined
      : Math.max(1, Math.ceil((resendAvailableAt - now) / 1000));

  // 只在真的要倒计时时才装这个定时器，到点自己停（不留一个每秒空转的 interval）。
  useEffect(() => {
    if (resendAvailableAt === undefined) return;
    const timer = window.setInterval(() => {
      if (Date.now() >= resendAvailableAt) window.clearInterval(timer);
      else setNow(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendAvailableAt]);

  /** 发起失败那一句（可能**没有**话可说 —— 见 `requestFailureOutcome`）。 */
  const failureMessage =
    requestFailure === undefined ? undefined : requestFailureOutcome(requestFailure);

  if (!signedIn) {
    return (
      <div className="ht-settings__section" data-testid="email-change-panel">
        <h3 className="ht-settings__h3 ht-type-headline">{t('common.emailChange.title')}</h3>
        <SettingsAccountGate
          messageKey="common.emailChange.intro"
          testId="email-change-needs-sign-in"
        />
      </div>
    );
  }

  return (
    <div className="ht-settings__section" data-testid="email-change-panel">
      <h3 className="ht-settings__h3 ht-type-headline">{t('common.emailChange.title')}</h3>
      <p className="ht-settings__hint">{t('common.emailChange.intro')}</p>

      {/* 当前邮箱：值来自本机存的凭据（不是我们猜的）。没读到就**不编一个**。 */}
      {email === undefined ? null : (
        <div className="ht-settings__field" data-testid="email-change-current-row">
          <div className="ht-settings__item-label">{t('common.emailChange.currentLabel')}</div>
          <p className="ht-settings__hint" data-testid="email-change-current">
            {email}
          </p>
        </div>
      )}

      {/*
        🔴 读侧失败**不是**"没有进行中的换绑"（见 emailChangeStore 文件头那条纪律），
        也不是"更换没有成功"（那一次没有人发起过任何东西）—— 所以这里**不**走 `failureKey`，
        那一张表服务的是发起失败，句句都带"这次没发起成功"的预设。
      */}
      {state.kind === 'failed' && (
        <p className="ht-settings__danger" role="alert" data-testid="email-change-load-failed">
          <AlertTriangle size={ICON_SIZE.xs} aria-hidden="true" />{' '}
          {t('common.emailChange.loadFailed')}
        </p>
      )}

      {state.kind === 'loading' && (
        <p className="ht-settings__hint" role="status" data-testid="email-change-loading">
          <Loader2 size={ICON_SIZE.xs} aria-hidden="true" />{' '}
          {/*
            ⚠️ 借用 `common.sessions.busy`（"正在处理…"）：`common.emailChange.busy`
            的字面是"正在**发起**…"，摆在**读取**那一句上是一句提前许诺（还没发起过任何东西）。
            本轮只拿到那份 key 清单，所以这里选那句**不撒谎**的。
          */}
          {t('common.sessions.busy')}
        </p>
      )}

      {requestPending && status !== undefined ? (
        <div className="ht-settings__field" data-testid="email-change-pending">
          {/* 这句**只**由 status 派生的 stage 决定 —— 本面板从没自己记过任何一边。 */}
          <p className="ht-settings__item-label" data-testid="email-change-stage" role="status">
            {t(stageKey(stage))}
          </p>
          {status.pendingEmail === undefined ? null : (
            <div className="ht-settings__field">
              <div className="ht-settings__item-label">{t('common.emailChange.pendingLabel')}</div>
              <p className="ht-settings__hint" data-testid="email-change-pending-email">
                {status.pendingEmail}
              </p>
            </div>
          )}
          {cooldownSecondsLeft === undefined ? null : (
            <p className="ht-settings__hint" data-testid="email-change-cooldown">
              {t('common.emailChange.cooldown', { seconds: cooldownSecondsLeft })}
            </p>
          )}
          <div className="ht-settings__actions">
            <button
              type="button"
              className="ht-btn ht-btn--ghost"
              data-testid="email-change-cancel"
              disabled={cancelling}
              onClick={() => {
                if (!activeRef.current) return;
                dismissNotices();
                setLocalMissing(false);
                void cancel(baseUrl, token);
              }}
            >
              {cancelling ? (
                <Loader2 size={ICON_SIZE.xs} aria-hidden="true" />
              ) : (
                <XCircle size={ICON_SIZE.xs} aria-hidden="true" />
              )}{' '}
              {t('common.emailChange.cancel')}
            </button>
          </div>
        </div>
      ) : null}

      {/*
        🔴 冷却期里**整个发起动作不渲染**（文件头第 2 条）。
        过了冷却窗口才回到这张表 —— 那正是"可以重新发两封信"的时刻。
      */}
      {cooldownSecondsLeft === undefined ? (
        <div className="ht-settings__field" data-testid="email-change-form">
          <label className="ht-settings__item-label" htmlFor="email-change-new">
            {t('common.emailChange.newLabel')}
          </label>
          <div className="ht-settings__actions">
            <input
              id="email-change-new"
              className="ht-input"
              type="email"
              inputMode="email"
              autoComplete="email"
              // 🔴 这台应用的输入框按现行控件风格**没有边框**，而 `.ht-input { flex: 1 }`
              // 让这一格横向铺满整行 —— 空着的时候那一片就是白的。占位文字是唯一
              // "这里可以输入"的线索（真浏览器截图实测出来的，见计划 §6.4）。
              placeholder={t('common.emailChange.newPlaceholder')}
              data-testid="email-change-new"
              value={draft}
              aria-invalid={localMissing}
              onChange={(event) => {
                setDraft(event.target.value);
                setLocalMissing(false);
                dismissNotices();
              }}
            />
            <button
              type="button"
              className="ht-btn ht-btn--primary"
              data-testid="email-change-submit"
              // 忙态用 guard（见 `emailChangeStore.request` 第一行），不用 disabled。
              onClick={() => {
                if (!activeRef.current) return;
                if (draft.trim() === '') {
                  setLocalMissing(true);
                  return;
                }
                setLocalMissing(false);
                dismissNotices();
                void request(baseUrl, token, draft, locale);
              }}
            >
              {requesting ? (
                <Loader2 size={ICON_SIZE.xs} aria-hidden="true" />
              ) : (
                <Mail size={ICON_SIZE.xs} aria-hidden="true" />
              )}{' '}
              {requesting ? t('common.emailChange.busy') : t('common.emailChange.submit')}
            </button>
          </div>
        </div>
      ) : null}

      <div aria-live="polite" data-testid="email-change-live">
        {localMissing && (
          <p className="ht-settings__danger" data-testid="email-change-local-error">
            <AlertTriangle size={ICON_SIZE.xs} aria-hidden="true" />{' '}
            {t('common.auth.form.emailRequired')}
          </p>
        )}

        {justSent && (
          <p className="ht-settings__notice" data-testid="email-change-sent">
            <CheckCircle2 size={ICON_SIZE.xs} aria-hidden="true" /> {t('common.emailChange.sent')}
          </p>
        )}

        {justCancelled && (
          <p className="ht-settings__notice" data-testid="email-change-cancelled">
            <CheckCircle2 size={ICON_SIZE.xs} aria-hidden="true" />{' '}
            {t('common.emailChange.cancelled')}
          </p>
        )}

        {failureMessage === undefined ? null : (
          // 冷却那一行由上面的 pending 块说（它读的是服务端的绝对时刻），
          // 所以这里在没有秒数可说时是 `undefined` —— **不补一句假话**。
          <p className="ht-settings__danger" role="alert" data-testid="email-change-failed">
            <AlertTriangle size={ICON_SIZE.xs} aria-hidden="true" />{' '}
            {t(failureMessage.key, failureMessage.vars)}
          </p>
        )}

        {cancelFailure === undefined ? null : (
          <p className="ht-settings__danger" role="alert" data-testid="email-change-cancel-failed">
            <AlertTriangle size={ICON_SIZE.xs} aria-hidden="true" /> {t(failureKey(cancelFailure))}
          </p>
        )}
      </div>
    </div>
  );
}
