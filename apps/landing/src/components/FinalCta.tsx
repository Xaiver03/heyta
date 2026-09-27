/**
 * 收尾 CTA
 * ==========
 *
 * 居中的宣言式收尾 —— 这是**允许**居中的少数场景之一
 * （taste skill：宣言式排版可以居中；居中英雄区不行）。
 *
 * 🔴 全页只有**一个** CTA 标签对应**一个**意图：
 *   英雄区、定价区的免费档、这里，都用同一个说法，都指向同一个地方。
 *   同一意图换标签（"开始使用" / "免费试用" / "立即部署"）会让用户以为
 *   它们是不同的事，而实际上只是文案没统一。
 *
 *   那个"同一个地方"由 `lib/app-url.ts` 决定：应用已部署 → 指向应用的
 *   「立即使用」；还没部署 → 指向 `#selfhost` 的「开始自建」。
 *   两种状态各有各的诚实说法，但**意图始终只有一个**。
 *
 * ⚠️ 这里原来还有第二个按钮「先看看代码」指向 GitHub —— 摘掉的原因见
 *   `Nav.tsx` 顶部那段（仓库私有，链接对访客是 404）。
 */

import { motion } from 'motion/react';
import { ArrowRight } from 'lucide-react';

import { useI18n, useLocale } from '@heyta/i18n';

import { startCta } from '../lib/app-url.js';
import { revealVariants, staggerContainer, useMotionPreset, VIEWPORT } from '../lib/motion.js';

export function FinalCta(): React.JSX.Element {
  const preset = useMotionPreset();
  const { t } = useI18n();
  // 英文页要把 `?lang=en` 带进应用，否则访客进应用看到的是中文（见 `lib/app-url.ts`）。
  const locale = useLocale();
  const cta = startCta(locale);

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
            <a
              className="lp-btn lp-btn--primary lp-btn--lg"
              href={cta.href}
              {...(cta.external ? { rel: 'noopener noreferrer' } : {})}
            >
              {t(cta.labelKey)}
              <ArrowRight size={18} aria-hidden="true" />
            </a>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
