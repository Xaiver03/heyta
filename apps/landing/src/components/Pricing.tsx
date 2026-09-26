/**
 * 价格
 * =======
 *
 * 版面：**两栏对比**（免费的自建 / 收费的托管），不是常见的「三档订阅表」。
 *
 * 🔴 为什么是两档而不是三档，以及为什么没有「推荐」角标：
 *   我们只有一个付费档（`docs/adr/0017-single-paid-tier-and-payment-channel.md` §3.1）。
 *   三档表在这里不只是"多余" ——
 *   它是**假的**：服务端只中转密文，我们按功能分档根本没有能力执行。
 *   把免费/付费做成两个对等的选项、并且明确说"两边功能完全一样"，
 *   是这一节唯一的论点。
 *
 * 🔴 价格数字在词条表里，而词条表里的价格与**代码价目表**、**法务文本**
 *   必须一致 —— `scripts/check-pricing-consistency.mjs` 会红。
 *   改价时先读 `docs/reference/pricing-and-entitlements.md`。
 *
 * ⚠️ 托管那一档**现在买不到**（大陆通道没接线、海外 KYC 没过），
 *   所以这里**刻意不放按钮**：一个点了没反应的"立即购买"比没有按钮更坏。
 *   状态由 `landing.pricing.hosted.cta` + `landing.pricing.statusNote` 如实说明。
 */

import { useMemo } from 'react';
import { motion } from 'motion/react';
import { Check, Cloud, Hourglass, Server } from 'lucide-react';

import { useI18n } from '@heyta/i18n';

import { revealVariants, staggerContainer, useMotionPreset, VIEWPORT } from '../lib/motion.js';

export function Pricing(): React.JSX.Element {
  const preset = useMotionPreset();
  const { t } = useI18n();

  // 数据挪进组件内是文案迁移的硬要求（模块级拿不到 `t`）。取舍见 `Landing.tsx` 文件头。
  const free = useMemo(
    () => [
      t('landing.pricing.free.feature1'),
      t('landing.pricing.free.feature2'),
      t('landing.pricing.free.feature3'),
    ],
    [t],
  );
  const hosted = useMemo(
    () => [
      t('landing.pricing.hosted.feature1'),
      t('landing.pricing.hosted.feature2'),
      t('landing.pricing.hosted.feature3'),
    ],
    [t],
  );

  return (
    <section className="lp-section lp-pricing" id="pricing">
      <div className="lp-wrap">
        <motion.header
          className="lp-section__head"
          variants={revealVariants(preset.reduced, preset.ui)}
          initial="hidden"
          whileInView="visible"
          viewport={VIEWPORT}
        >
          <h2 className="lp-h2">{t('landing.pricing.title')}</h2>
          <p className="lp-section__lede">{t('landing.pricing.lede')}</p>
        </motion.header>

        <motion.div
          className="lp-pricing__grid"
          aria-label={t('landing.pricing.ariaLabel')}
          variants={staggerContainer(preset.reduced)}
          initial="hidden"
          whileInView="visible"
          viewport={VIEWPORT}
        >
          {/* ── 自建：免费，而且这条路过得通 ───────────────────────── */}
          <motion.article
            className="lp-pricing__card lp-pricing__card--featured"
            variants={revealVariants(preset.reduced, preset.ui)}
          >
            <h3 className="lp-pricing__name">
              <span className="lp-pricing__icon">
                <Server size={18} aria-hidden="true" />
              </span>
              {t('landing.pricing.free.name')}
            </h3>

            <p className="lp-pricing__price">
              <span className="lp-pricing__amount">{t('landing.pricing.free.price')}</span>
              <span className="lp-pricing__period">{t('landing.pricing.free.period')}</span>
            </p>

            <p className="lp-pricing__body">{t('landing.pricing.free.body')}</p>

            <ul className="lp-pricing__features">
              {free.map((feature) => (
                <li key={feature} className="lp-pricing__feature">
                  <Check size={16} aria-hidden="true" />
                  {feature}
                </li>
              ))}
            </ul>

            <a className="lp-btn lp-btn--primary lp-pricing__cta" href="#selfhost">
              {t('landing.pricing.free.cta')}
            </a>
          </motion.article>

          {/* ── 托管：唯一收费的东西，两个地区分别标价 ───────────── */}
          <motion.article
            className="lp-pricing__card"
            variants={revealVariants(preset.reduced, preset.ui)}
          >
            <h3 className="lp-pricing__name">
              <span className="lp-pricing__icon">
                <Cloud size={18} aria-hidden="true" />
              </span>
              {t('landing.pricing.hosted.name')}
            </h3>

            {/*
              两个地区用 <dl> 列出，而不是并排两个大数字：
              它们是**同一个档在不同地区的定价**，不是两档 —— 用并排大数字
              会让人读成"两个价格可选"，那正好是我们最不想要的误解。
            */}
            <dl className="lp-pricing__regions">
              <div className="lp-pricing__region">
                <dt>{t('landing.pricing.hosted.regionCny')}</dt>
                <dd>{t('landing.pricing.hosted.priceCny')}</dd>
              </div>
              <div className="lp-pricing__region">
                <dt>{t('landing.pricing.hosted.regionUsd')}</dt>
                <dd>{t('landing.pricing.hosted.priceUsd')}</dd>
              </div>
            </dl>

            <p className="lp-pricing__body">{t('landing.pricing.hosted.body')}</p>

            <ul className="lp-pricing__features">
              {hosted.map((feature) => (
                <li key={feature} className="lp-pricing__feature">
                  <Check size={16} aria-hidden="true" />
                  {feature}
                </li>
              ))}
            </ul>

            {/* 没有按钮，只有一个状态说明 —— 见文件头 */}
            <p className="lp-pricing__pending">
              <Hourglass size={16} aria-hidden="true" />
              {t('landing.pricing.hosted.cta')}
            </p>
          </motion.article>
        </motion.div>

        <motion.div
          className="lp-pricing__notes"
          variants={revealVariants(preset.reduced, preset.ui)}
          initial="hidden"
          whileInView="visible"
          viewport={VIEWPORT}
        >
          <p className="lp-pricing__note-strong">{t('landing.pricing.noFeatureGate')}</p>
          <p className="lp-pricing__note">{t('landing.pricing.statusNote')}</p>
        </motion.div>
      </div>
    </section>
  );
}
