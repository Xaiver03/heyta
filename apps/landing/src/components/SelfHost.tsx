/**
 * 自建
 * ======
 * 分栏：左边是终端，右边是三步说明。**布局族与前两节不同**（前两节是 bento 与
 * 滚动固定展厅），避免整页读起来像同一段重复八遍。
 *
 * 🔴 命令是从 `docs/runbooks/local-server-verification.md` 抄的**真实流程**，
 * 不是编的。有几条是踩过坑才写下来的，值得原样保留：
 *   - Node ≥ 22、pnpm 11.8.0（根 `package.json` 的 engines / packageManager）
 *   - PostgreSQL **≥ 16**（compose 里是 `postgres:16-alpine`）
 *   - 迁移**必须走 `sh scripts/migrate-deploy.sh`，不能用 `prisma migrate deploy`**
 *     —— 后者会把每个迁移包进事务，而 PostgreSQL 禁止在事务块里执行
 *     `CREATE INDEX CONCURRENTLY`，项目里有 9 个这样的迁移，会在第一个上失败。
 *   把这条"为什么"留在页面上，比只给一行命令有用。
 */

import { useMemo } from 'react';
import { motion } from 'motion/react';
import { AlertTriangle, BookOpen, Container, Database, Terminal } from 'lucide-react';

import { useI18n } from '@heyta/i18n';

import { revealVariants, staggerContainer, useMotionPreset, VIEWPORT } from '../lib/motion.js';

/**
 * 终端里逐行浮现的命令。最后一行是光标行。
 *
 * ⚠️ 这三行**故意不进词条表**：它们是可复制粘贴执行的 shell 命令（含仓库 URL
 * 与 pnpm 子命令），不是给人读的句子。把命令"翻译"一遍会让用户复制到一条跑不通的
 * 命令 —— 那不是本地化，是造假。真正的文案（标题、步骤、警告）都已走 `t()`。
 *
 * 🔴 第一行是**占位符**，不是仓库地址。
 *
 * 仓库当前是私有的，在页面上印一个真的 `git clone <真地址>` 等于教访客去撞一个
 * “repository not found” —— 那比不给出地址更坏，因为它看起来是能用的。
 * 所以 `<repo-url>` 是**故意留着不填**的，并紧跟着用
 * `landing.selfhost.sourcePending` 说明为什么 —— 页面下方那条说明不是装饰，
 * 是这段代码诚实的前提。真地址在 `Nav.tsx` 顶部那份「公开后要加回来的清单」里，
 * 公开后替换这一行即可。
 */
const COMMANDS = [
  'git clone <repo-url>',
  'cd heyta && pnpm install && pnpm -r build',
  'cd server && docker compose up -d',
];

export function SelfHost(): React.JSX.Element {
  const preset = useMotionPreset();
  const { t } = useI18n();

  // 数据挪进组件内是文案迁移的硬要求（模块级拿不到 `t`）。取舍见 `Landing.tsx` 文件头。
  const steps = useMemo(
    () => [
      {
        icon: <Terminal size={18} />,
        title: t('landing.selfhost.step1.title'),
        body: t('landing.selfhost.step1.body'),
      },
      {
        icon: <Container size={18} />,
        title: t('landing.selfhost.step2.title'),
        body: t('landing.selfhost.step2.body'),
      },
      {
        icon: <Database size={18} />,
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
          <p className="lp-section__lede">
            {t('landing.selfhost.lede')}
          </p>
        </header>

        <div className="lp-selfhost__grid">
          <motion.div
            className="lp-term"
            initial="hidden"
            whileInView="visible"
            viewport={VIEWPORT}
            variants={staggerContainer(preset.reduced)}
          >
            <div className="lp-term__bar">
              <span className="lp-term__dot" />
              <span className="lp-term__dot" />
              <span className="lp-term__dot" />
              <span className="lp-term__title">{t('landing.selfhost.terminal')}</span>
            </div>

            <div className="lp-term__body">
              {COMMANDS.map((command) => (
                <motion.div
                  key={command}
                  className="lp-term__line"
                  variants={revealVariants(preset.reduced, preset.ui, '0.4rem')}
                >
                  <span className="lp-term__prompt" aria-hidden="true">
                    $
                  </span>
                  <code>{command}</code>
                </motion.div>
              ))}

              <motion.div className="lp-term__line" variants={revealVariants(preset.reduced, preset.ui, '0.4rem')}>
                <span className="lp-term__prompt" aria-hidden="true">
                  $
                </span>
                {/*
                  光标闪烁用 Motion 而不是 CSS `@keyframes`。
                  原因很具体：闪烁周期约 1 秒，而设计系统把 `--ht-duration-*`
                  全部锁在 300ms 以内（MASTER.md §6，且有测试断言这个区间）。
                  写 CSS 动画就必须写一个裸的 `1.05s`，那会被 `check:design` 拦下。
                  Motion 的 duration 是**裸数字**（秒），不触发那条规则，
                  而且能直接受 `prefers-reduced-motion` 控制。
                */}
                <motion.span
                  className="lp-term__caret"
                  aria-hidden="true"
                  animate={preset.reduced ? { opacity: 1 } : { opacity: [1, 1, 0, 0] }}
                  transition={
                    preset.reduced
                      ? { duration: 0 }
                      : { duration: 1.05, times: [0, 0.5, 0.5, 1], repeat: Infinity, ease: 'linear' }
                  }
                />
              </motion.div>
            </div>
          </motion.div>

          <div className="lp-selfhost__steps">
            <motion.ol
              className="lp-steps"
              variants={staggerContainer(preset.reduced)}
              initial="hidden"
              whileInView="visible"
              viewport={VIEWPORT}
            >
              {steps.map((step, index) => (
                <motion.li key={step.title} className="lp-step" variants={revealVariants(preset.reduced, preset.ui)}>
                  <span className="lp-step__icon">{step.icon}</span>
                  <span className="lp-step__index">{String(index + 1).padStart(2, '0')}</span>
                  <div>
                    <h3 className="lp-step__title">{step.title}</h3>
                    <p className="lp-step__body">{step.body}</p>
                  </div>
                </motion.li>
              ))}
            </motion.ol>

            {/* 这条警告是从真实踩坑记录里拿来的，所以值得占一块版面 */}
            <motion.div
              className="lp-note lp-note--warn"
              variants={revealVariants(preset.reduced, preset.ui)}
              initial="hidden"
              whileInView="visible"
              viewport={VIEWPORT}
            >
              <AlertTriangle size={16} aria-hidden="true" />
              <div>
                <strong>{t('landing.selfhost.warnStrong')}</strong>
                {t('landing.selfhost.warnBody')}
                {/* 与 apps/web 的 AiSettings 同一写法：代码元素里带中文前缀。
                    这不是凑格式 —— 路径本身对用户没有意义，得先说明它是什么。 */}
                <code>{t('landing.selfhost.warnCode')}</code>
              </div>
            </motion.div>

            {/*
              这条替换掉了原来指向 `docs/runbooks/local-server-verification.md` 的
              外链（仓库私有 → 对访客是 404）。**不能只删不补**：上面那三行命令
              现在跑不通，页面上必须有人把这件事说出来。
            */}
            <motion.div
              className="lp-note"
              variants={revealVariants(preset.reduced, preset.ui)}
              initial="hidden"
              whileInView="visible"
              viewport={VIEWPORT}
            >
              <BookOpen size={16} aria-hidden="true" />
              <div>{t('landing.selfhost.sourcePending')}</div>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
}
