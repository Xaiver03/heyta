/**
 * 收尾 CTA
 * ==========
 *
 * 居中的宣言式收尾 —— 这是**允许**居中的少数场景之一
 * （taste skill：宣言式排版可以居中；居中英雄区不行）。
 *
 * 🔴 全页只有**一个** CTA 标签对应**一个**意图：
 *   英雄区与这里都用「开始自建」，都指向 `#selfhost`。
 *   同一意图换标签（"开始使用" / "免费试用" / "立即部署"）会让用户以为
 *   它们是不同的事，而实际上只是文案没统一。
 */

import { motion } from 'motion/react';
import { ArrowRight, Github } from 'lucide-react';

import { useI18n } from '@heyta/i18n';

import { revealVariants, staggerContainer, useMotionPreset, VIEWPORT } from '../lib/motion.js';
import { GITHUB_URL } from './Nav.js';

export function FinalCta(): React.JSX.Element {
  const preset = useMotionPreset();
  const { t } = useI18n();

  return (
    <section className="lp-section lp-cta">
      <div className="lp-wrap">
        <motion.div
          className="lp-cta__inner"
          variants={staggerContainer(preset.reduced)}
          initial="hidden"
          whileInView="visible"
          viewport={VIEWPORT}
        >
          <motion.h2 className="lp-h2 lp-cta__title" variants={revealVariants(preset.reduced, preset.ui)}>
            {t('landing.cta.title')}
          </motion.h2>

          <motion.p className="lp-cta__lede" variants={revealVariants(preset.reduced, preset.ui)}>
            {t('landing.cta.lede')}
          </motion.p>

          <motion.div className="lp-cta__actions" variants={revealVariants(preset.reduced, preset.ui)}>
            <a className="lp-btn lp-btn--primary lp-btn--lg" href="#selfhost">
              {t('landing.cta.selfHost')}
              <ArrowRight size={18} aria-hidden="true" />
            </a>
            <a
              className="lp-btn lp-btn--secondary lp-btn--lg"
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer noopener"
            >
              <Github size={18} aria-hidden="true" />
              {t('landing.cta.viewCode')}
            </a>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
