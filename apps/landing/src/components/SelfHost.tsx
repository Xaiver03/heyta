import { ICON_SIZE } from '@heyta/design-system';
/**
 * 自建
 * ======
 * 两栏：左边三步说明，右边自建指南的入口。**布局族与前两节不同**（前两节是 bento 与
 * 滚动固定展厅），避免整页读起来像同一段重复八遍。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 这一节**不写命令行**，也**不写数据库与构建机制**。2026-09-30 之前它是反例：
 * 左边一块终端贴着 `git clone` / `pnpm install` / `docker compose up -d`，
 * 右边一段橙色警告讲"Prisma 会把迁移包进事务，而 PostgreSQL 不允许在事务里
 * 建并发索引"。那句话本身是对的 —— 但它是 [AGENTS.md](../../../AGENTS.md) §4
 * 里**对贡献者成立的纪律**，被逐字搬到了面向用户的营销页上。
 *
 * 为什么会被搬上来：`docs/runbooks/` 里有一段写得很清楚的解释 → 有人觉得
 * "这条重要，用户也该知道" → 抄过来 → 再写一段注释自我论证它为什么该留在页面上 →
 * 下一轮改动读到那段注释，把它当成产品决策，于是保留并继续加。
 * **机制本身是错的**，不是那次抄写错。所以：
 *
 * - 判据住在 `tests/public-copy-register.spec.tsx`（每一页 × 每一语言渲染出的
 *   真实文本 + 读屏会念到的无障碍名），不在这里再写一份；
 * - 这一节的职责是把"自建起来是什么样"说清楚，**具体命令、依赖、配置一律交回
 *   `SELF_HOST_GUIDE_URL`** —— runbook 随构建一起更新，页面上的抄本不会。
 *
 * ⚠️ 想往这里加"一条命令"或"一个内部路径"之前，先回答：**用户读完这句话，
 * 下一步动作是什么？** 答案是"打开终端"的，留在指南里；
 * 答案是"往下读/去仓库看一眼"的，才属于这一页。
 */

import { useMemo } from 'react';
import { motion } from 'motion/react';
import { ArrowUpRight, Container, Globe, Lock } from 'lucide-react';

import { useI18n } from '@heyta/i18n/provider';

import { SELF_HOST_GUIDE_URL } from '../lib/repo.js';
import { revealVariants, staggerContainer, useMotionPreset, VIEWPORT } from '../lib/motion.js';

export function SelfHost(): React.JSX.Element {
  const preset = useMotionPreset();
  const { t } = useI18n();

  // 数据挪进组件内是文案迁移的硬要求（模块级拿不到 `t`）。取舍见 `Landing.tsx` 文件头。
  const steps = useMemo(
    () => [
      {
        icon: <Container size={ICON_SIZE.md} />,
        title: t('landing.selfhost.step1.title'),
        body: t('landing.selfhost.step1.body'),
      },
      {
        icon: <Globe size={ICON_SIZE.md} />,
        title: t('landing.selfhost.step2.title'),
        body: t('landing.selfhost.step2.body'),
      },
      {
        icon: <Lock size={ICON_SIZE.md} />,
        title: t('landing.selfhost.step3.title'),
        body: t('landing.selfhost.step3.body'),
      },
    ],
    [t],
  );

  return (
    <section className="lp-section lp-selfhost" id="selfhost">
      <div className="lp-wrap">
        <header className="lp-section__head">
          <h2 className="lp-h2">{t('landing.selfhost.title')}</h2>
          <p className="lp-section__lede">{t('landing.selfhost.lede')}</p>
        </header>

        <div className="lp-selfhost__grid">
          <div className="lp-selfhost__steps">
            <motion.ol
              className="lp-steps"
              variants={staggerContainer(preset.reduced)}
              initial="hidden"
              whileInView="visible"
              viewport={VIEWPORT}
            >
              {steps.map((step, index) => (
                <motion.li
                  key={step.title}
                  className="lp-step"
                  variants={revealVariants(preset.reduced, preset.ui)}
                >
                  <span className="lp-step__icon">{step.icon}</span>
                  <span className="lp-step__index">{String(index + 1).padStart(2, '0')}</span>
                  <div>
                    <h3 className="lp-step__title">{step.title}</h3>
                    <p className="lp-step__body">{step.body}</p>
                  </div>
                </motion.li>
              ))}
            </motion.ol>
          </div>

          <motion.aside
            className="lp-selfhost__guide"
            variants={revealVariants(preset.reduced, preset.ui)}
            initial="hidden"
            whileInView="visible"
            viewport={VIEWPORT}
          >
            <h3 className="lp-selfhost__guide-title">{t('landing.selfhost.guide.title')}</h3>
            <p className="lp-selfhost__guide-body">{t('landing.selfhost.guide.body')}</p>
            <a
              className="lp-btn lp-btn--secondary"
              href={SELF_HOST_GUIDE_URL}
              rel="noopener noreferrer"
            >
              {t('landing.selfhost.guide.link')}
              <ArrowUpRight size={ICON_SIZE.sm} aria-hidden="true" />
            </a>
          </motion.aside>
        </div>
      </div>
    </section>
  );
}
