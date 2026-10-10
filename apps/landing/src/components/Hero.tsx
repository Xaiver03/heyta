/**
 * 英雄区
 * ========
 *
 * 版面：**非对称 5/7 分栏**（左文右景）。taste skill 的规则 ——
 * `DESIGN_VARIANCE > 4` 时避免居中英雄区；居中版会立刻读成"模板"。
 *
 * 产品界面是证据，不是装饰。首屏只做一次轻量入场，避免指针倾斜让文字
 * 变形、让用户误以为这个窗口可以直接操作，也把动效预算留给后面的真实视图切换。
 */

import { useMemo } from 'react';
import { motion } from 'motion/react';

import { useI18n } from '@heyta/i18n/provider';

import { AppWindow } from '../mockup/AppWindow.js';
import { Magnetic } from './Magnetic.js';
import {
  HERO_ENTRANCE_DELAY,
  maskedRevealVariants,
  revealVariants,
  staggerContainer,
  useMotionPreset,
  VIEWPORT,
} from '../lib/motion.js';

export function Hero(): React.JSX.Element {
  const preset = useMotionPreset();
  const { t } = useI18n();

  const copy = revealVariants(preset.reduced, preset.ui, '1rem');

  return (
    <section className="lp-hero" id="top">
      <motion.div
        className="lp-hero__copy"
        variants={staggerContainer(preset.reduced)}
        initial="hidden"
        animate="visible"
      >
        <motion.span className="lp-eyebrow" variants={copy}>
          {t('landing.hero.eyebrow')}
        </motion.span>

        {/*
          标题走遮罩式显现（maskedRevealVariants）：外层 h1 是裁剪槽，
          内层块从槽底升起 —— keynote 的"文字从缝里长出来"。
          h1 自身的 variants 是空壳，只为占住错峰序列的第二个节拍；
          视觉完全由内层承担（结构理由见 motion.ts 该函数的注释）。
        */}
        <motion.h1 className="lp-h1 lp-mask" variants={{ hidden: {}, visible: {} }}>
          <motion.span
            className="lp-mask__inner"
            variants={maskedRevealVariants(preset.reduced, preset.ui)}
          >
            {t('landing.hero.titleLead')}
            <em>{t('landing.hero.titleEmphasis')}</em>
          </motion.span>
        </motion.h1>

        <motion.p className="lp-lede" variants={copy}>
          {t('landing.hero.lede')}
        </motion.p>

        {/*
          主 CTA 指向界面、次 CTA 指向价格 —— 大众先问「好不好用」「多少钱」，
          不会先问「我怎么自建」。自建的入口留在 SelfHost 一节与底部，
          那是愿意往下读的人才到的地方（理由写在 i18n 的 hero 词条上）。
          磁性只给主 CTA：全页到处都"吸"就不是磁性了，是抖。
        */}
        <motion.div className="lp-hero__ctas" variants={copy}>
          <Magnetic>
            <a className="lp-btn lp-btn--primary lp-btn--lg" href="#showcase">
              {t('landing.hero.ctaShowcase')}
            </a>
          </Magnetic>
          <a className="lp-btn lp-btn--secondary lp-btn--lg" href="#pricing">
            {t('landing.hero.ctaPricing')}
          </a>
        </motion.div>
      </motion.div>

      <div className="lp-hero__stage">
        <div className="lp-hero__glow" aria-hidden="true" />

        {/* 卡片只做一次轻微入场；它是产品证据，不应持续跟随指针漂移。 */}
        <motion.div
          className="lp-hero__enter"
          initial={preset.reduced ? { opacity: 0 } : { opacity: 0, y: '2rem', scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ ...preset.sheet, delay: preset.reduced ? 0 : HERO_ENTRANCE_DELAY }}
        >
          <motion.div className="lp-hero__card">
            {/* 真实界面的复现。见 mockup/ 的文件头：这是复现，不是应用本身。 */}
            <AppWindow view="tasks" />

          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}

/**
 * 事实条。**刻意不是 logo 墙。**
 *
 * taste skill 要求信任区用真实素材而不是文字伪装 —— 但这个项目还没有
 * 任何客户或合作方，编一排 logo 就是造假。所以这里放的是**可核实的事实**，
 * 每一条都能在仓库里查到出处。
 *
 * 数据挪进组件内是文案迁移的硬要求（模块级拿不到 `t`）。取舍见 `Landing.tsx` 文件头。
 *
 * 🔴 选哪四条也是**受众排序**问题，不只是事实问题。这一条紧贴在首屏下面，
 * 所以放的是大众能用的理由（离线、不限设备、加密同步、一套数据）。
 * 「MIT 许可」和「一条命令自建」同样是可核实的事实，但它们只对开发者构成理由 ——
 * 那两条在 Footer 与 SelfHost，愿意读到那里的人才关心。
 */
export function Facts(): React.JSX.Element {
  const preset = useMotionPreset();
  const { t } = useI18n();

  const facts = useMemo(
    () => [
      {
        value: t('landing.facts.offline.value'),
        label: t('landing.facts.offline.label'),
      },
      {
        value: t('landing.facts.devices.value'),
        label: t('landing.facts.devices.label'),
      },
      {
        value: t('landing.facts.encrypted.value'),
        label: t('landing.facts.encrypted.label'),
      },
      {
        value: t('landing.facts.oneData.value'),
        label: t('landing.facts.oneData.label'),
      },
    ],
    [t],
  );

  return (
    <section className="lp-facts" aria-label={t('landing.facts.ariaLabel')}>
      <div className="lp-wrap">
        <motion.div
          className="lp-facts__grid"
          variants={staggerContainer(preset.reduced)}
          initial="hidden"
          whileInView="visible"
          viewport={VIEWPORT}
        >
          {facts.map((fact) => (
            <motion.div key={fact.value} className="lp-fact" variants={revealVariants(preset.reduced, preset.ui)}>
              <span className="lp-fact__value">{fact.value}</span>
              <span className="lp-fact__label">{fact.label}</span>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
