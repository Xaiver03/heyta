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
import { ICON_SIZE } from '@heyta/design-system';
import { startCheckout, type CheckoutFailureCode, type CheckoutOutcome } from '@heyta/app-host';
import { QrCode } from 'lucide-react';

import { useSyncStore } from '../sync/store.js';
import { privacyConsent } from '../privacy/consent-gate.js';

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
  NETWORK_ERROR: 'web.subscription.renew.fail.network',
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

export function RenewPanel(): React.JSX.Element {
  const { t, locale } = useI18n();
  const [couponCode, setCouponCode] = useState('');
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [outcome, setOutcome] = useState<CheckoutOutcome | null>(null);
  const [consentBlocked, setConsentBlocked] = useState(false);

  const onPlaceOrder = async (): Promise<void> => {
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
      couponCode: couponCode.trim() === '' ? undefined : couponCode.trim(),
    });
    setOutcome(next);
    setPending(false);
  };

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
    <div className="ht-settings" data-testid="renew-panel">
      <h2 className="ht-settings__title ht-type-section-title">{t('web.subscription.renew.title')}</h2>
      <p className="ht-settings__hint">{t('web.subscription.renew.intro')}</p>

      <div className="ht-settings__actions">
        <input
          type="text"
          className="ht-input"
          value={couponCode}
          placeholder={t('web.subscription.renew.couponPlaceholder')}
          onChange={(event) => setCouponCode(event.target.value)}
        />
        <button
          type="button"
          className="ht-btn ht-btn--primary"
          data-testid="renew-place-order"
          disabled={pending}
          onClick={() => void onPlaceOrder()}
        >
          <QrCode size={ICON_SIZE.xs} aria-hidden="true" />
          {pending ? t('web.subscription.renew.busy') : t('web.subscription.renew.action')}
        </button>
      </div>

      {outcome?.kind === 'qr' || outcome?.kind === 'redirect' ? (
        <div data-testid="renew-order">
          <p>{t('web.subscription.renew.amount', { amount: amountLabel(outcome.amountMinor, outcome.currency) })}</p>
          <p>{t('web.subscription.renew.validUntil', { time: expiryLabel(outcome.expiresAt, locale) })}</p>
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
          <p className="ht-settings__hint">{t('web.subscription.renew.payHint')}</p>
          <div className="ht-settings__actions">
            <button type="button" className="ht-btn ht-btn--ghost" data-testid="renew-copy" onClick={onCopy}>
              {copied ? t('web.subscription.renew.copied') : t('web.subscription.renew.copy')}
            </button>
          </div>
        </div>
      ) : null}

      {consentBlocked ? (
        <p data-testid="renew-consent" role="alert">
          {t('common.privacy.consent.whyRequiredForAction')}
        </p>
      ) : null}

      {outcome?.kind === 'failed' ? (
        <p data-testid="renew-failure" role="alert">
          {t(FAILURE_KEYS[outcome.code] ?? 'web.subscription.renew.fail.unknown', { code: outcome.code })}
        </p>
      ) : null}
    </div>
  );
}
