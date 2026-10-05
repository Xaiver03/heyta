import { ICON_SIZE } from '@heyta/design-system';
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
 * ⚠️ 这里有**两个**按钮，且它们是两个意图：「立即使用」（新访客的主入口）
 * 与「看源码」（开发者的入口，2026-09-29 仓库公开后恢复 —— 私有时期它是
 * 404，所以被摘掉过）。两者样式一主一次，标签词条不同 —— 同一意图换标签
 * 才是错的（见文件头那条单一意图规则），两个意图各用自己的标签没有问题。
 * 地址的唯一定义在 `lib/repo.ts`。
 */

import { motion } from 'motion/react';
import { ArrowRight, Github } from 'lucide-react';

import { useI18n, useLocale } from '@heyta/i18n/provider';

import { startCta } from '../lib/app-url.js';
import { GITHUB_URL } from '../lib/repo.js';
import { revealVariants, staggerContainer, useMotionPreset, VIEWPORT } from '../lib/motion.js';
import { Magnetic } from './Magnetic.js';

export function FinalCta(): React.JSX.Element {
  const preset = useMotionPreset();
  const { t } = useI18n();
  // 两种语言都要把 `?lang=` 带进应用（默认语言也带，理由见 `lib/app-url.ts`）。
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
            {/* 磁性给收尾的主入口 —— 全页只有英雄区与这里两处（见 Magnetic.tsx）。
                「看源码」是次按钮：另一个意图（开发者），不抢主行动的戏；
                外链必须带 rel=noopener（render.spec 的判据）。 */}
            <Magnetic>
              <a
                className="lp-btn lp-btn--primary lp-btn--lg"
                href={cta.href}
                {...(cta.external ? { rel: 'noopener noreferrer' } : {})}
              >
                {t(cta.labelKey)}
                <ArrowRight size={ICON_SIZE.md} aria-hidden="true" />
              </a>
            </Magnetic>
            <a
              className="lp-btn lp-btn--secondary lp-btn--lg"
              href={GITHUB_URL}
              rel="noopener noreferrer"
            >
              <Github size={ICON_SIZE.md} aria-hidden="true" />
              {t('landing.cta.viewCode')}
            </a>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
