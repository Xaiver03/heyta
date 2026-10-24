/**
 * 托管同步的续费入口（web 壳）。
 *
 * ## 它做的唯一一件"收钱"的事
 *
 * 点一下 → `startCheckout()`（接线在 `@heyta/app-host`，移动端用的是同一份）→
 * 服务端报价、冻结订单、返回这一单的支付串。**这里没有任何金额**：
 * 显示出来的金额是从服务端响应里读回来的，不是本地算的。
 *
 * ## 🔴 临时方案的两条边界（不是缺陷，是写明着的取舍）
 *
 * 1. **付款靠链接，不靠二维码。** 微信 Native 给的 `code_url` 本来就是
 *    "编码进二维码 / 在手机上直接打开"两用的一条串。桌面端渲染二维码需要一个
 *    QR 编码器，而 §3.1/§3.2 两道门之前不引新依赖 —— 所以这里如实把链接交给用户，
 *    并说明"用手机微信打开"。**不假装已经能扫码。**
 * 2. **不做自动续费**，因为全仓库没有任何签约/代扣（`wechat.adapter.ts` 只有
 *    单次 Native 支付）。续费 = **再下一单**，服务端把 30 天叠加在
 *    `max(now, 当前到期日)` 之后（`extendSubscriptionPeriod`），
 *    所以提前续费不会丢掉已付过的剩余时间。
 *
 * ## 为什么它挂在设置页而不是那条到期提示里
 *
 * `SubscriptionNotice` 只在**已经被限制**时才渲染。续费是"还没到期也要能买"
 * 的动作，挂在那儿就等于只有过期用户能看到入口。
 */
import { useState } from 'react';
import { useI18n, type Locale, type MessageKey } from '@heyta/i18n';
import {
  CHECKOUT_TIER_PRICE_IDS,
  CHECKOUT_TIERS,
  DEFAULT_CHECKOUT_TIER_ID,
  startCheckout,
  type CheckoutFailureCode,
  type CheckoutFailureReason,
  type CheckoutOutcome,
  type CheckoutTierId,
} from '@heyta/app-host';

import { useSyncStore } from '../sync/store.js';
import { SettingsInfoTip } from '../settings/SettingsInfoTip.js';
import { privacyConsent } from '../privacy/consent-gate.js';
import { SettingsAccountGate } from '../settings/SettingsAccountGate.js';

/**
 * 档位 → 词条。
 *
 * 🔴 这里**不写金额**，也**不新写一句档位说明** —— 名字与那句"这一档给什么"
 * 复用落地页那两条已被 `check-pricing-consistency` 钉住的词条
 * （`landing.pricing.hosted.*` / `landing.pricing.hostedAi.*`）。
 * 在收银台另抄一份价格句子，就是给同一个事实造第二个会漂的副本；
 * 而 `landing.pricing.hostedAi.body` 自带那句"这一步会把内容发到我们的服务器，
 * 它不受端到端加密保护" —— 收钱的那一屏正该说这句话（ADR-0054 §7）。
 */
const TIER_KEYS: Record<
  CheckoutTierId,
  {
    readonly name: MessageKey;
    readonly detail: MessageKey;
    /** 标价：与价格页**同一个词条**（`check:pricing` 钉着数值一致）。 */
    readonly price: MessageKey;
    readonly features: readonly MessageKey[];
  }
> = {
  hosted: {
    name: 'landing.pricing.hosted.name',
    detail: 'landing.pricing.hosted.body',
    price: 'landing.pricing.hosted.priceCny',
    features: [
      'landing.pricing.hosted.feature1',
      'landing.pricing.hosted.feature2',
      'landing.pricing.hosted.feature3',
    ],
  },
  hostedAi: {
    name: 'landing.pricing.hostedAi.name',
    detail: 'landing.pricing.hostedAi.body',
    price: 'landing.pricing.hostedAi.priceCny',
    features: [
      'landing.pricing.hostedAi.feature1',
      'landing.pricing.hostedAi.feature2',
      'landing.pricing.hostedAi.feature3',
    ],
  },
};

/**
 * 失败码 → 词条。用 `Record` 而不是动态拼 key（拼错了没有类型兜底，
 * 而且界面文案门禁按字面 key 认）。
 *
 * 词表里没有的码一律落到 `unknown` —— 但**把陌生码原样显示出来**，
 * 因为"用一句中文解释一个我们没读过的服务端码"就是替服务端编造语义。
 */
const FAILURE_KEYS: Partial<Record<CheckoutFailureCode, MessageKey>> = {
  UNCONFIGURED: 'web.subscription.renew.fail.unconfigured',
  UNAUTHORIZED: 'web.subscription.renew.fail.unauthorized',
  BILLING_PROVIDER_NOT_CONFIGURED: 'web.subscription.renew.fail.provider',
  PRICE_NOT_SELLABLE: 'web.subscription.renew.fail.sellable',
  PRICE_TIER_LOSES_GRANTS: 'web.subscription.renew.fail.downgrade',
  NETWORK_ERROR: 'web.subscription.renew.fail.network',
};

/**
 * 拒单原因码 → 词条。**比错误码更细的那一层**：同一个 `PRICE_NOT_SELLABLE`
 * 下面挂着一件"换一档就能买"的事与一件"别买"的事。
 *
 * 🔴 只有 `MANAGED_AI_NOT_CONFIGURED` 值得单独说：它有一个**用户能做**的动作 ——
 * 换成不含云端 AI 的那一档（那一档判据在服务端，`billing-checkout.routes.spec.ts`
 * 的「同一台没配上游的实例，¥5 那一档照卖」钉着）。别的原因码没有这种出口，
 * 说了也只会变成又一句"买不了"。
 */
const FAILURE_REASON_KEYS: Partial<Record<CheckoutFailureReason, MessageKey>> = {
  MANAGED_AI_NOT_CONFIGURED: 'web.subscription.renew.fail.managedAi',
};

/** 这条原因码对应的"那一档还能买"的换档动作（`undefined` = 没有可换的档）。 */
const REASON_SWITCH_TIER: Partial<Record<CheckoutFailureReason, CheckoutTierId>> = {
  MANAGED_AI_NOT_CONFIGURED: 'hosted',
};

const amountLabel = (amountMinor: number, currency: string): string =>
  `${(amountMinor / 100).toFixed(2)} ${currency}`;

/**
 * 这一单的失效时刻。
 *
 * 🔴 locale 必须由界面传进来（`TrashView` / `ConflictDialog` 同一条理由）：
 * 裸 `toLocaleString()` 跟的是**操作系统**的语言，这台机器实测在中文界面里
 * 打出 `10/5/2026, 5:47:10 PM`。`check:ui-language` 抓不到它 —— 它看的是词条，
 * 而这一串是运行时生成的。
 */
const expiryLabel = (expiresAt: number, locale: Locale): string =>
  new Date(expiresAt).toLocaleString(locale, {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

export function RenewPanel({
  /**
   * 这个账号现在是不是**已经**订阅着（由 `SubscriptionPanel` 从权益投影里读出来）。
   *
   * 只影响主按钮那一个词（「订阅」/「续费」）—— **不影响**任何请求：
   * 能不能买、买哪一档、收多少钱，全由服务端判（`checkout.routes.ts` 的 ①②′④）。
   * 也就是说这个 prop 写错了只会说错一个词，不会下错一单。
   */
  entitled = false,
}: {
  entitled?: boolean;
} = {}): React.JSX.Element {
  const { t, locale } = useI18n();
  const [couponCode, setCouponCode] = useState('');
  const [tierId, setTierId] = useState<CheckoutTierId>(DEFAULT_CHECKOUT_TIER_ID);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [outcome, setOutcome] = useState<CheckoutOutcome | null>(null);
  const [consentBlocked, setConsentBlocked] = useState(false);
  const token = useSyncStore((state) => state.token);
  const signedIn = typeof token === 'string' && token.trim() !== '';

  const onPlaceOrder = async (): Promise<void> => {
    // 续费是账号动作。未登录时不创建 checkout 请求，也不把一个支付表单
    // 摆出来让用户误以为可以匿名下单；登录入口由统一 gate 提供。
    if (!signedIn) return;
    // 🔴 同意闸门在**这里**判，而不是等 `consentFetch` 抛错再归一：
    //    真浏览器实测过那样会得到一句假话 —— 一个请求都没出去，屏上却写着
    //    "连不上服务端，这一单没有下成"。闸门保证发不出去（`consent-gate.ts`），
    //    这一处保证界面说的是真话（同 `InboxBell` 里那条"pollNotifications"的理由）。
    if (!privacyConsent.networkAllowed()) {
      setConsentBlocked(true);
      // 上一次的结果不能继续挂着：那会让"一个请求都没发"的这一次看起来像有了新单。
      setOutcome(null);
      return;
    }
    setConsentBlocked(false);

    const { baseUrl, token } = useSyncStore.getState();
    setPending(true);
    const next = await startCheckout({
      baseUrl,
      getToken: async () => token,
      priceId: CHECKOUT_TIER_PRICE_IDS[tierId],
      couponCode: couponCode.trim() === '' ? undefined : couponCode.trim(),
    });
    setOutcome(next);
    setPending(false);
  };

  /** 这一条拒单原因有没有"换一档就能买"的出口（见 `REASON_SWITCH_TIER`）。 */
  const switchTarget =
    outcome?.kind === 'failed' && outcome.reason !== undefined
      ? REASON_SWITCH_TIER[outcome.reason]
      : undefined;

  const payTarget =
    outcome?.kind === 'qr'
      ? outcome.codeUrl
      : outcome?.kind === 'redirect'
        ? outcome.redirectUrl
        : null;

  const onCopy = (): void => {
    if (payTarget === null) return;
    // 剪贴板在部分上下文里不可用（非安全上下文 / 权限被拒）。
    // 复制不成**不许**假装"已复制"：所以只在写成功时才翻那条标签。
    navigator.clipboard
      ?.writeText(payTarget)
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  };

  return (
    <div className="ht-settings ht-settings__sub-buy" data-testid="renew-panel">
      {!signedIn ? (
        <SettingsAccountGate
          messageKey="web.subscription.renew.fail.unauthorized"
          testId="renew-needs-sign-in"
        />
      ) : (
        <>
          {/*
            🔴 这一块**没有自己的 h2**：它现在住在「订阅」这一节里，页标题已经有了。
            块头只有一句"选一档"+一句"怎么计费"，然后就是两档卡片。
          */}
          <div className="ht-settings__sub-block-head">
            <p className="ht-settings__h3">
              {t('web.subscription.plans.title')}
              {/* 计费规则（一次性 30 天 / 不自动扣款）是"这怎么算"，不是状态 —— 进 `?`。 */}
              <SettingsInfoTip
                testId="tip-subscription-plans"
                label={t('web.subscription.plans.title')}
                text={t('web.subscription.plans.hint')}
              />
            </p>
          </div>

          <fieldset className="ht-settings__sub-plans" data-testid="renew-tier">
            {/* legend 只给读屏：两档卡片已经各写了自己的名字。 */}
            <legend className="sr-only">{t('web.subscription.plans.title')}</legend>
            {CHECKOUT_TIERS.map((id) => (
              <label key={id} className="ht-settings__sub-plan" data-checked={tierId === id ? 'true' : undefined}>
                <span className="ht-settings__sub-plan-top">
                  <input
                    type="radio"
                    name="renew-tier"
                    data-testid={`renew-tier-${id}`}
                    checked={tierId === id}
                    onChange={() => {
                      setTierId(id);
                      // 换档之后上一张单不能继续挂着：那张卡写的是**旧档**冻的金额，
                      // 挂着就会读成"这一单是这么多钱"。
                      setOutcome(null);
                      setCopied(false);
                    }}
                  />
                  <span className="ht-settings__sub-plan-name">
                    {t(TIER_KEYS[id].name)}
                    {/* 这一档给什么 → `?`（2026-10-24 禁令）。 */}
                    <SettingsInfoTip
                      testId={`tip-plan-${id}`}
                      label={t(TIER_KEYS[id].name)}
                      text={t(TIER_KEYS[id].detail)}
                    />
                  </span>
                  <span className="ht-settings__sub-plan-price">{t(TIER_KEYS[id].price)}</span>
                </span>
                <ul className="ht-settings__sub-plan-features">
                  {TIER_KEYS[id].features.map((feature) => (
                    <li key={feature}>{t(feature)}</li>
                  ))}
                </ul>
              </label>
            ))}
          </fieldset>

          {/*
            促销码默认**收起来**：绝大多数人没有码，摊在面上等于每次购买都先问一个
            多半用不上的问题（渐进披露）。`<details>` 原生可键盘操作、无需 JS。
          */}
          <details className="ht-settings__sub-coupon">
            <summary>{t('web.subscription.coupon.toggle')}</summary>
            <label className="ht-settings__item-label" htmlFor="renew-coupon">
              {t('web.subscription.renew.couponPlaceholder')}
            </label>
            <input
              id="renew-coupon"
              type="text"
              className="ht-input"
              value={couponCode}
              placeholder={t('web.subscription.renew.couponInput')}
              onChange={(event) => setCouponCode(event.target.value)}
            />
          </details>

          {/* 主按钮**独占一行**：它是这一屏唯一的提交动作。 */}
          <div className="ht-settings__actions ht-settings__sub-cta">
            <button
              type="button"
              className="ht-btn ht-btn--primary"
              data-testid="renew-place-order"
              disabled={pending}
              onClick={() => void onPlaceOrder()}
            >
              {pending
                ? t('web.subscription.renew.busy')
                : entitled
                  ? t('web.subscription.renew.action')
                  : t('web.subscription.renew.subscribe')}
            </button>
          </div>
        </>
      )}

      {outcome?.kind === 'qr' || outcome?.kind === 'redirect' ? (
        <section className="ht-settings__sub-order" data-testid="renew-order">
          <div className="ht-settings__sub-order-summary" aria-live="polite">
            <p>{t('web.subscription.renew.amount', { amount: amountLabel(outcome.amountMinor, outcome.currency) })}</p>
            <p>{t('web.subscription.renew.validUntil', { time: expiryLabel(outcome.expiresAt, locale) })}</p>
          </div>
          {/*
            🔴 这里只说"哪个码没生效"，**不**渲染服务端的 `explanation`。
            那张表（`coupon.ts` 的 `COUPON_REJECTION_EXPLANATION`）只有中文，
            把它原样搬到界面上 = 英文界面里漏出一句中文。要在界面上说清"为什么"，
            正确做法是给那 14 个 reason 建词条并让门禁对账，而不是在这里抄一句。
          */}
          {outcome.rejectedCoupons.map((row) => (
            <p key={row.rawCode}>{t('web.subscription.renew.rejected', { code: row.rawCode })}</p>
          ))}
          <label htmlFor="renew-pay-url">{t('web.subscription.renew.payLinkLabel')}</label>
          {/* 🔴 只读输入框而不是"已支付"的确认：到账只有 webhook 知道，
              客户端在这里**没有**任何可以声称成功的信息（见 checkout.ts 文件头）。 */}
          <input id="renew-pay-url" className="ht-input" readOnly value={payTarget ?? ''} />
          <p className="ht-settings__hint" role="status">
            {t('web.subscription.renew.payHint')}
          </p>
          <div className="ht-settings__actions">
            <button type="button" className="ht-btn ht-btn--ghost" data-testid="renew-copy" onClick={onCopy}>
              {copied ? t('web.subscription.renew.copied') : t('web.subscription.renew.copy')}
            </button>
          </div>
        </section>
      ) : null}

      {consentBlocked ? (
        <p className="ht-settings__danger" data-testid="renew-consent" role="alert">
          {t('common.privacy.consent.whyRequiredForAction')}
        </p>
      ) : null}

      {outcome?.kind === 'failed' ? (
        <div className="ht-settings__renew-failure" data-testid="renew-failure" role="alert">
          {/*
            🔴 先按**原因码**说，再退回错误码：`PRICE_NOT_SELLABLE` 一句话盖住了两件事，
            而其中一件（这一档要交付云端 AI、本实例没开）有明确的出路。
            词表外的码仍然原样带出来（`{code}`），不替服务端编造语义。
          */}
          <p>
            {t(
              (outcome.reason === undefined ? undefined : FAILURE_REASON_KEYS[outcome.reason])
                ?? FAILURE_KEYS[outcome.code]
                ?? 'web.subscription.renew.fail.unknown',
              { code: outcome.code },
            )}
          </p>
          {switchTarget === undefined ? null : (
            <div className="ht-settings__actions">
              <button
                type="button"
                className="ht-btn ht-btn--ghost"
                data-testid="renew-switch-tier"
                onClick={() => {
                  setTierId(switchTarget);
                  // 换档与"旧单不能继续挂着"同一条纪律：上一张单写的是旧档冻的金额。
                  setOutcome(null);
                  setCopied(false);
                }}
              >
                {t('web.subscription.renew.switchTier')}
              </button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
