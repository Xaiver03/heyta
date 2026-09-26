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
 *     `CREATE INDEX CONCURRENTLY`，项目里有 5 个这样的迁移，会在第 6 个上失败。
 *   把这条"为什么"留在页面上，比只给一行命令有用。
 */

import { motion } from 'motion/react';
import { AlertTriangle, BookOpen, Container, Database, Terminal } from 'lucide-react';

import { revealVariants, staggerContainer, useMotionPreset, VIEWPORT } from '../lib/motion.js';
import { GITHUB_URL } from './Nav.js';

/** 终端里逐行浮现的命令。最后一行是光标行。 */
const COMMANDS = [
  'git clone https://github.com/Xaiver03/heyta.git',
  'cd heyta && pnpm install && pnpm -r build',
  'cd server && docker compose up -d',
];

const STEPS = [
  {
    icon: <Terminal size={18} />,
    title: '拉代码并构建',
    body: '需要 Node 22 以上、pnpm 11.8.0。装完依赖跑一次全量构建。',
  },
  {
    icon: <Container size={18} />,
    title: '起服务端',
    body: '一条命令拉起同步服务与数据库。服务端只存密文，它没有解密的钥匙。',
  },
  {
    icon: <Database size={18} />,
    title: '在客户端填地址',
    body: '首次启动时二选一：填自己的服务器地址，或者用托管。选了随时能换。',
  },
];

export function SelfHost(): React.JSX.Element {
  const preset = useMotionPreset();

  return (
    <section className="lp-section lp-selfhost" id="selfhost">
      <div className="lp-wrap">
        <header className="lp-section__head">
          <h2 className="lp-h2">自己的服务器，一条命令的事</h2>
          <p className="lp-section__lede">
            不需要注册账号，不需要订阅。服务端只负责转发密文与判并发，
            换掉它、关掉它、搬到别的机器上，你的数据都不受影响。
          </p>
        </header>

        <div className="lp-selfhost__grid">
          <motion.div
            className="lp-term"
            initial="hidden"
            whileInView="visible"
            viewport={VIEWPORT}
            variants={staggerContainer(preset.reduced, 0.16)}
          >
            <div className="lp-term__bar">
              <span className="lp-term__dot" />
              <span className="lp-term__dot" />
              <span className="lp-term__dot" />
              <span className="lp-term__title">终端</span>
            </div>

            <div className="lp-term__body">
              {COMMANDS.map((command) => (
                <motion.div
                  key={command}
                  className="lp-term__line"
                  variants={revealVariants(preset.reduced, '0.4rem')}
                >
                  <span className="lp-term__prompt" aria-hidden="true">
                    $
                  </span>
                  <code>{command}</code>
                </motion.div>
              ))}

              <motion.div className="lp-term__line" variants={revealVariants(preset.reduced, '0.4rem')}>
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
              variants={staggerContainer(preset.reduced, 0.07)}
              initial="hidden"
              whileInView="visible"
              viewport={VIEWPORT}
            >
              {STEPS.map((step, index) => (
                <motion.li key={step.title} className="lp-step" variants={revealVariants(preset.reduced)}>
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
              variants={revealVariants(preset.reduced)}
              initial="hidden"
              whileInView="visible"
              viewport={VIEWPORT}
            >
              <AlertTriangle size={16} aria-hidden="true" />
              <div>
                <strong>数据库迁移不要直接调 Prisma。</strong>
                项目里有 5 个并发建索引的迁移，Prisma 会把迁移包进事务，而 PostgreSQL
                不允许在事务里建并发索引，跑到第 6 个就会失败。请用仓库里的
                {/* 与 apps/web 的 AiSettings 同一写法：代码元素里带中文前缀。
                    这不是凑格式 —— 路径本身对用户没有意义，得先说明它是什么。 */}
                <code>迁移脚本 scripts/migrate-deploy.sh</code>。
              </div>
            </motion.div>

            <a className="lp-link" href={`${GITHUB_URL}/blob/main/docs/runbooks/local-server-verification.md`} target="_blank" rel="noreferrer noopener">
              <BookOpen size={16} aria-hidden="true" />
              完整的部署与验收步骤
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
