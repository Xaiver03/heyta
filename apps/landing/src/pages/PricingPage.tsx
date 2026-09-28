/**
 * `/pricing`：高级会员
 * =======================
 *
 * 三块内容，顺序是刻意的：
 *   1. **价格卡**（`components/Pricing.tsx`，与首页那一节是**同一个组件**）；
 *   2. **「自建 vs 我们托管」对照表** —— 对照的是运维责任，不是功能多少；
 *   3. **常见问题** —— 最后一条如实说"现在买不到"。
 *
 * 🔴 价格卡复用而不是复制：价格数字在词条表里只写一次，而"渲染出来的那一份"
 * 如果各写一遍，数字相同也可能口径不同（一边写"每月"一边写"月付"）。
 *
 * 🔴 **这一页没有购买按钮**（A3-4）：大陆支付通道未接通、海外 KYC 未过。
 * 卡片里那个位置由 `*.cta` 如实说明当前状态，而 `check:payment-entry`
 * 会在有人加上付款入口时报红。
 *
 * ⚠️ 对照表里"功能"与"锁定"两行**两边是同一句话**（`sameKey`）：
 * 拆成两栏各写一遍，就会出现"措辞不同 → 被读成不一样"的错觉。
 */

import { useI18n } from '@heyta/i18n';

import { Pricing } from '../components/Pricing.js';
import { FaqList } from '../site/FaqList.js';
import { KeyText, PageHead } from '../site/PageSections.js';
import { PRICING_COMPARE_ROWS, PRICING_QUESTIONS } from '../site/content.js';
import type { SitePage } from '../site/pages.js';

export function PricingPage({ page }: { page: SitePage }): React.JSX.Element {
  const { t } = useI18n();

  return (
    <>
      <PageHead page={page} />
      <Pricing />
      <div className="lp-section">
        <div className="lp-wrap">
          <h2 className="lp-h2">{t('site.pricing.compare.title')}</h2>
          <div className="lp-compare" role="table">
            <div className="lp-compare__row lp-compare__row--head" role="row">
              <span className="lp-compare__cell" role="columnheader" />
              <span className="lp-compare__cell" role="columnheader">
                {t('site.pricing.compare.diy')}
              </span>
              <span className="lp-compare__cell" role="columnheader">
                {t('site.pricing.compare.hosted')}
              </span>
            </div>
            {PRICING_COMPARE_ROWS.map((row) => (
              <div key={row.labelKey} className="lp-compare__row" role="row">
                <span className="lp-compare__cell lp-compare__label" role="rowheader">
                  <KeyText messageKey={row.labelKey} />
                </span>
                {/*
                  两栏答案相同时**跨列**渲染（`--same`）：同一条文案渲染两次
                  会让读屏软件读两遍，也会让两栏看起来像"恰好写一样"。
                */}
                {row.sameKey !== undefined ? (
                  <span className="lp-compare__cell lp-compare__cell--same" role="cell">
                    <KeyText messageKey={row.sameKey} />
                  </span>
                ) : (
                  <>
                    <span className="lp-compare__cell" role="cell">
                      {row.diyKey === undefined ? null : <KeyText messageKey={row.diyKey} />}
                    </span>
                    <span className="lp-compare__cell" role="cell">
                      {row.hostedKey === undefined ? null : (
                        <KeyText messageKey={row.hostedKey} />
                      )}
                    </span>
                  </>
                )}
              </div>
            ))}
          </div>

          <h2 className="lp-h2 lp-faq__heading">{t('site.pricing.faq.title')}</h2>
          <FaqList pairs={PRICING_QUESTIONS} />
        </div>
      </div>
    </>
  );
}
