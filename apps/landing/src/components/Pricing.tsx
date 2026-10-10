import { AssistantIcon } from './AssistantIcon.js';
import { ICON_SIZE } from '@heyta/design-system';
/**
 * 价格
 * =======
 *
 * 版面：**三栏**（自建免费 / 官方托管 ¥5 / 官方托管 + 云端 AI ¥12）。
 *
 * 🔴 为什么是这三栏，以及为什么**不是**常见的「按功能分档」：
 *   1. **功能分档做不到**：服务端只中转密文，我们没有能力执行功能闸门。
 *      所以三栏里**没有任何一栏的功能是少的** —— 免费那一栏就是全部功能。
 *   2. **付费的只有两件东西**：替我们运维服务器（`hosting`）与我们的云端 AI（`ai`）。
 *      这两个词是**授权白名单**，`scripts/check-pricing-consistency.mjs` 会强制
 *      收费清单上不许出现任何功能名（ADR-0020 §3.2）。
 *   3. 免费那一栏刻意保留 `--featured`：这一节唯一的论点是"自建这条路真的走得通"，
 *      把它做成三栏里最不起眼的一栏会把论点讲反。收费的两栏反而**不**加推荐角标 ——
 *      两档的差别只有 AI，加角标等于暗示"上面那档少了什么"。
 *
 * 🔴 价格数字在词条表里，而词条表里的价格与**代码价目表**、**两份法务文本**
 *   必须一致 —— `scripts/check-pricing-consistency.mjs` 会红。
 *   改价时先读 `docs/reference/pricing-and-entitlements.md`。
 *
 * ⚠️ 两个付费档**现在都买不到** —— 但原因**不是"没接线"**：服务端收银台路由
 *   （`POST /api/billing/checkout`）已经接通，且会走到 `adapter.createCheckout`；
 *   真正缺的是**通道本身** —— 实例里只有 `noop` adapter，所以必然回 `503`；
 *   海外则是 KYC 没过。所以这里**刻意不放按钮**：一个点了没反应的"立即购买"比没有按钮更坏。
 *   状态由各自的 `*.cta` + `landing.pricing.statusNote` 如实说明。
 */

import { useMemo } from 'react';
import { motion } from 'motion/react';
import { Check, Cloud, Hourglass, Server } from 'lucide-react';

import { useI18n } from '@heyta/i18n/provider';

import { revealVariants, staggerContainer, useMotionPreset, VIEWPORT } from '../lib/motion.js';
import { useSelfHostHref } from '../site/cta.js';
/**
 * 两个付费档的形状完全一样，只有词条前缀不同。
 *
 * 抽出来不是为了少写几行，而是为了让"两档结构一致"这件事**在代码里看得见**：
 * 如果哪天有人在其中一档里加了别的东西，那一定是产品决策，应该改 ADR，
 * 而不是顺手在 JSX 里多插一段。
 */
function PaidCard({
  keyPrefix,
  icon,
  preset,
}: {
  keyPrefix: 'landing.pricing.hosted' | 'landing.pricing.hostedAi';
  icon: React.ReactNode;
  preset: ReturnType<typeof useMotionPreset>;
}): React.JSX.Element {
  const { t } = useI18n();
  // 🔴 `as const` 不是装饰：`t()` 的入参是 `MessageKey` 联合类型。
  // 写成 `[1, 2, 3]` 会得到 `number`，模板字面量类型就成了
  // `` `${keyPrefix}.feature${number}` `` —— **无限联合**，赋不给 `MessageKey`，
  // `tsc -b` 直接失败（`pnpm test` 会红）。`as const` 把它收窄成 `1 | 2 | 3`，
  // 于是类型是 6 个字面量的有限联合，正好都在词条表里。
  const features = useMemo(
    () => ([1, 2, 3] as const).map((n) => t(`${keyPrefix}.feature${n}`)),
    [t, keyPrefix],
  );

  return (
    <motion.article className="lp-pricing__card" variants={revealVariants(preset.reduced, preset.ui)}>
      <h3 className="lp-pricing__name">
        <span className="lp-pricing__icon">{icon}</span>
        {t(`${keyPrefix}.name`)}
      </h3>

      {/*
        两个地区用 <dl> 列出，而不是并排两个大数字：
        它们是**同一个档在不同地区的定价**，不是两档 —— 用并排大数字
        会让人读成"两个价格可选"，那正好是我们最不想要的误解。
      */}
      <dl className="lp-pricing__regions">
        <div className="lp-pricing__region">
          <dt>{t(`${keyPrefix}.regionCny`)}</dt>
          <dd>{t(`${keyPrefix}.priceCny`)}</dd>
        </div>
        <div className="lp-pricing__region">
          <dt>{t(`${keyPrefix}.regionUsd`)}</dt>
          <dd>{t(`${keyPrefix}.priceUsd`)}</dd>
        </div>
      </dl>

      <p className="lp-pricing__body">{t(`${keyPrefix}.body`)}</p>

      <ul className="lp-pricing__features">
        {features.map((feature) => (
          <li key={feature} className="lp-pricing__feature">
            <Check size={ICON_SIZE.sm} aria-hidden="true" />
            {feature}
          </li>
        ))}
      </ul>

      {/* 没有按钮，只有一个状态说明 —— 见文件头 */}
      <p className="lp-pricing__pending">
        <Hourglass size={ICON_SIZE.sm} aria-hidden="true" />
        {t(`${keyPrefix}.cta`)}
      </p>
    </motion.article>
  );
}

export function Pricing(): React.JSX.Element {
  const preset = useMotionPreset();
  const { t } = useI18n();
  const selfHostHref = useSelfHostHref();

  // 数据挪进组件内是文案迁移的硬要求（模块级拿不到 `t`）。取舍见 `Landing.tsx` 文件头。
  const free = useMemo(
    () => [
      t('landing.pricing.free.feature1'),
      t('landing.pricing.free.feature2'),
      t('landing.pricing.free.feature3'),
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
          {/* ── 自建：免费，而且这条路过得通（全部功能，一个不少）───────── */}
          <motion.article
            className="lp-pricing__card lp-pricing__card--featured"
            variants={revealVariants(preset.reduced, preset.ui)}
          >
            <h3 className="lp-pricing__name">
              <span className="lp-pricing__icon">
                <Server size={ICON_SIZE.md} aria-hidden="true" />
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
                  <Check size={ICON_SIZE.sm} aria-hidden="true" />
                  {feature}
                </li>
              ))}
            </ul>

            {/* 🔴 这个链接的目标**取决于当前在哪一页**（见 `site/cta.ts`）：
                首页上是本页锚点 `#selfhost`，搬到 `/pricing` 上就变成
                `/{locale}/#selfhost`。写死 `#selfhost` 的话，/pricing 上
                这个按钮点下去**完全没有反应**（页面上没有那个 id）。 */}
            <a className="lp-btn lp-btn--primary lp-pricing__cta" href={selfHostHref}>
              {t('landing.pricing.free.cta')}
            </a>
          </motion.article>

          {/* ── 托管：我们替你运维服务器，不含我们的 AI ───────────────── */}
          <PaidCard
            keyPrefix="landing.pricing.hosted"
            icon={<Cloud size={ICON_SIZE.md} aria-hidden="true" />}
            preset={preset}
          />

          {/* ── 托管 + 云端 AI：唯一一个我们卡得住的能力 ──────────────── */}
          <PaidCard
            keyPrefix="landing.pricing.hostedAi"
            icon={<AssistantIcon size={ICON_SIZE.md} aria-hidden="true" />}
            preset={preset}
          />
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
