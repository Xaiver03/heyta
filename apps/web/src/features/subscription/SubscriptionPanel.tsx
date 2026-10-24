/**
 * 订阅页（web）：**状态 → 方案 → 下单**，一屏按这个顺序读下来
 * ==========================================================
 *
 * 产品负责人 2026-10-24 的两句原话是这一页的由来：
 *
 * > 「需要卖的，而且需要有**单独的订阅界面**。」
 *
 * 在此之前，购买入口是「账号与安全」里的第一张卡（`RenewPanel`）。那有两个毛病：
 * 付钱这件事躲在"安全"底下；而且它和通行密钥、改密码、注销账号挤在同一列里，
 * 读起来像同一类事。现在它是**自己的一节**，页内三段：
 *
 * | 段 | 回答什么 | 由谁画 |
 * |---|---|---|
 * | ① 当前状态 | 我现在是什么状态、到哪一天 | 本文件（只读投影） |
 * | ② 选一档 + 下单 | 有哪些档、各自给什么、怎么付 | `RenewPanel`（收银台机器都在那儿） |
 * | ③ 关于收费 | 为什么收、自托管为什么免费 | 本文件（脚注） |
 *
 * ## 🔴 这一页**不判断**任何权益
 *
 * 判定只有一份：`@heyta/domain` 的 `decideHostedSyncAccess`，由
 * `features/subscription/store.ts` 持有。这里只把 `access` 投影成一句话 + 一枚状态点。
 * **不**在这里写 `if (currentPeriodEnd < Date.now())` —— 那会造出第二套"算不算过期"
 * 的口径，而两套口径里总有一套是错的（这条纪律见 `domain/src/subscription.ts` 文件头）。
 *
 * ## 🔴 金额的边界
 *
 * 方案卡上那行标价用的是**落地页已有的词条**（`landing.pricing.*.priceCny`）——
 * 它们被 `check:pricing` 钉在"四处一致"里，本文件不写第二个金额字面量。
 * 而**这一单实际收多少**仍然只来自服务端报价（折扣、券都在那边算），
 * 见 `@heyta/app-host` 的 `checkout.ts` 文件头第 1 条。
 */
import { useEffect, useState } from 'react';
import { useI18n } from '@heyta/i18n';
import { ICON_SIZE } from '@heyta/design-system';
import type { HostedEntitlementReading, HostedSyncAccess } from '@heyta/domain';
import { CircleDollarSign, RefreshCw, Server } from 'lucide-react';

import { siteLink } from '../../lib/site-url.js';
import { useSubscriptionStore } from './store.js';
import { RenewPanel } from './RenewPanel.js';
import { SettingsInfoTip } from '../settings/SettingsInfoTip.js';

type Tone = 'ok' | 'warn' | 'muted' | 'unknown';

interface StatusView {
  readonly tone: Tone;
  readonly title: string;
  readonly hint: string;
}

export function SubscriptionPanel({ active = true }: { active?: boolean }): React.JSX.Element {
  const { t, locale } = useI18n();
  const access = useSubscriptionStore((s) => s.access);
  const reading = useSubscriptionStore((s) => s.reading);
  const checking = useSubscriptionStore((s) => s.checking);
  const refresh = useSubscriptionStore((s) => s.refresh);
  /** 至少问过一次 —— 只有问过之后，"没结论"才配叫"读不到"。 */
  const [asked, setAsked] = useState(false);

  // 每次切到这一节都问一次（用户可能刚付完钱，服务端 webhook 已落账）。
  // 🔴 只在 `active` 时问：设置浮层里**所有**面板都挂着，不问这一句就会每开一次设置打一次接口。
  useEffect(() => {
    if (!active) return;
    setAsked(true);
    void refresh();
  }, [active, refresh]);

  const view = statusView({ access, reading, asked, locale, t });

  return (
    <section
      className="ht-settings ht-settings--subscription"
      data-testid="subscription-panel"
      aria-label={t('web.subscription.page.title')}
    >
      {/* ── ① 当前状态 ───────────────────────────────────────────── */}
      <div
        className={`ht-settings__sub-status ht-settings__sub-status--${view.tone}`}
        data-testid="subscription-status"
      >
        <div className="ht-settings__sub-status-main">
          <span className="ht-settings__sub-dot" aria-hidden="true" />
          <div className="ht-settings__sub-status-text">
            <p className="ht-settings__sub-status-title">
              {view.title}
              {/* 「这代表什么」+「到期不删数据」两句话都进 `?`（2026-10-24 禁令）。 */}
              <SettingsInfoTip
                testId="tip-subscription-status"
                label={t('web.subscription.status.title')}
                text={
                  <>
                    {view.hint}
                    {' '}
                    {t('web.subscription.status.localData')}
                  </>
                }
              />
            </p>
          </div>
        </div>
        <button
          type="button"
          className="ht-btn ht-btn--ghost ht-settings__sub-refresh"
          data-testid="subscription-refresh"
          disabled={checking}
          onClick={() => void refresh()}
        >
          <RefreshCw size={ICON_SIZE.xs} aria-hidden="true" />
          {checking ? t('web.subscription.status.checking') : t('web.subscription.status.refresh')}
        </button>
      </div>


      {/* ── ② 选一档 + 下单（收银台机器全在 `RenewPanel` 里）───────── */}
      {/*
        `entitled` 只影响主按钮那一个词（「订阅」/「续费」），不影响任何请求 ——
        已在订阅着的人看到「订阅这一档」会以为自己从没买过。
      */}
      <RenewPanel entitled={isEntitled(access)} />

      {/* ── ③ 关于收费 ───────────────────────────────────────────── */}
      <div className="ht-settings__sub-about" data-testid="subscription-footnote">
        <p className="ht-settings__h3">
          <CircleDollarSign size={ICON_SIZE.sm} aria-hidden="true" />
          {t('web.subscription.footnote.title')}
          <SettingsInfoTip
            testId="tip-subscription-pricing"
            label={t('web.subscription.footnote.title')}
            text={t('web.subscription.footnote.selfHost')}
          />
        </p>
        <div className="ht-settings__actions">
          <a
            className="ht-btn ht-btn--ghost"
            href={siteLink('/pricing')}
            rel="noopener noreferrer"
            data-testid="subscription-pricing-link"
          >
            <Server size={ICON_SIZE.xs} aria-hidden="true" />
            {t('web.subscription.footnote.pricingLink')}
          </a>
        </div>
      </div>
    </section>
  );
}

/**
 * 这个账号现在是不是"订阅着"。
 *
 * 🔴 只认 `access`（domain 的判定产物），不看日期、不看 `reading` ——
 * 否则就是第二套"算不算有效"的口径。`entitled` 由服务端 2xx 或"自托管默认关闸门"给出，
 * 两者对用户是同一句话（"能用"），只是**付费与否**我们不知道（自托管也是 entitled）。
 * 所以按钮说「续费」在自托管实例上可能不准确 —— 那种实例里这一节本来也不该被打开
 * （没配官方服务器时状态是 `not-configured`，走的是「还没订阅」那一支）。
 */
function isEntitled(access: HostedSyncAccess): boolean {
  return access.kind === 'unrestricted' && access.because === 'entitled';
}

/**
 * `access` → 屏幕上的那两句。
 *
 * 🔴 四种"没有明确结论"的状态**分别**说，不合并：
 * - `not-configured`（还没填服务器）不能说成"你没有订阅"；
 * - `entitlement-unknown`（探测失败/断网）更不能 —— 用户可能刚付过钱；
 * - 还没问过时说的是"还没有订阅"，因为那是**最可能的**状态，而且下面的购买入口就是出路；
 * - 问过之后仍无结论 ⇒ 如实说"读不到"，并明确"不影响购买"。
 */
function statusView(input: {
  readonly access: HostedSyncAccess;
  /**
   * 原始观察。**只借它取"到哪天为止"**（`denied.currentPeriodEnd`）——
   * `HostedSyncAccess` 里刻意没有这个字段：那是措辞用的，不是判据用的
   * （见 `domain/src/subscription.ts` 那两行注释）。所以界面上"算不算过期"
   * 仍然只认 `access.expired`，这里读到的日期只用于显示。
   */
  readonly reading: HostedEntitlementReading;
  readonly asked: boolean;
  readonly locale: string;
  readonly t: ReturnType<typeof useI18n>['t'];
}): StatusView {
  const { access, reading, asked, locale, t } = input;
  const date = (value: number): string =>
    new Date(value).toLocaleDateString(locale, { year: 'numeric', month: 'numeric', day: 'numeric' });

  if (access.kind === 'restricted') {
    const until = reading.kind === 'denied' ? reading.currentPeriodEnd : undefined;
    if (access.expired) {
      return {
        tone: 'warn',
        title:
          until === undefined
            ? t('web.subscription.status.refused')
            : t('web.subscription.status.expired', { time: date(until) }),
        hint: t('web.subscription.status.localData'),
      };
    }
    return {
      tone: 'warn',
      title:
        until === undefined
          ? t('web.subscription.status.refused')
          : `${t('web.subscription.status.refused')} · ${t('web.subscription.status.until', { time: date(until) })}`,
      hint: t('web.subscription.status.localData'),
    };
  }

  switch (access.because) {
    case 'entitled':
      return {
        tone: 'ok',
        title: t('web.subscription.status.entitled'),
        hint: t('web.subscription.status.entitledHint'),
      };
    case 'not-configured':
      return {
        tone: 'muted',
        title: t('web.subscription.status.none'),
        hint: t('web.subscription.status.noneHint'),
      };
    default:
      // `entitlement-unknown`：一次探测没结论。
      return asked
        ? {
            tone: 'unknown',
            title: t('web.subscription.status.unavailable'),
            hint: t('web.subscription.status.unavailableHint'),
          }
        : {
            tone: 'muted',
            title: t('web.subscription.status.none'),
            hint: t('web.subscription.status.noneHint'),
          };
  }
}
