/**
 * 悬浮导航
 * ==========
 *
 * 两条来自设计系统的规则，这里必须遵守：
 *   1. **导航高度 ≤ 80px，桌面端单行**（MASTER.md / taste skill 都要求）。
 *      用了 `--ht-layout-header-height`（56px）。
 *   2. 材质只叠在**滚动内容**上，不叠在另一个半透明面上
 *      （tokens.css §3d 硬规则 2）—— 所以这里只有一层。
 *
 * 交互：滚动超过一屏的 24px 后，导航从"贴着页面"变成"浮在内容上"
 * （加重阴影）。这是 Apple 的 **scroll edge effect** ——
 * 用材料变化表达"内容从下面过去了"，而不是加一条硬分割线。
 */

import { useState } from 'react';
import { motion, useMotionValueEvent, useScroll } from 'motion/react';
import { Github, Moon, Sun } from 'lucide-react';

import { useMotionPreset } from '../lib/motion.js';
import type { Theme } from '../lib/theme.js';

export const GITHUB_URL = 'https://github.com/Xaiver03/heyta';

/** 锚点与 `Landing.tsx` 里各区块的 `id` 必须一致 —— 写错了只是"点了没反应"。 */
const LINKS = [
  { href: '#capabilities', label: '能力' },
  { href: '#showcase', label: '界面' },
  { href: '#sync', label: '同步' },
  { href: '#selfhost', label: '自建' },
];

export function Nav({
  theme,
  onToggleTheme,
}: {
  theme: Theme;
  onToggleTheme: () => void;
}): React.JSX.Element {
  const preset = useMotionPreset();
  const { scrollY } = useScroll();
  const [floating, setFloating] = useState(false);

  // 只在跨过阈值时改变状态；React 对同值 setState 会 bail out，
  // 所以不会每帧重渲染。
  useMotionValueEvent(scrollY, 'change', (value) => {
    setFloating(value > 24);
  });

  return (
    <header className="lp-nav">
      <motion.div
        className="lp-nav__bar"
        initial={preset.reduced ? { opacity: 0 } : { opacity: 0, y: '-140%' }}
        animate={{ opacity: 1, y: 0 }}
        transition={preset.sheet}
        style={{ boxShadow: floating ? 'var(--ht-shadow-lg)' : 'var(--ht-shadow-sm)' }}
      >
        <a className="lp-brand" href="#top">
          <span className="lp-brand__dot" aria-hidden="true" />
          heyta
        </a>

        <nav className="lp-nav__links" aria-label="页面导航">
          {LINKS.map((link) => (
            <a key={link.href} className="lp-nav__link" href={link.href}>
              {link.label}
            </a>
          ))}
        </nav>

        <div className="lp-nav__actions">
          <button
            type="button"
            className="lp-iconbtn"
            aria-label={theme === 'light' ? '切换到暗色主题' : '切换到亮色主题'}
            onClick={onToggleTheme}
          >
            {/*
              图标在主题切换时**转着换**：月亮与太阳是同一个"光"的两面，
              用旋转表达它们的关系，比淡入淡出更说得通。
              Apple《Spatial consistency》：从哪来回哪去，所以是两个方向相反的旋转。
            */}
            <motion.span
              key={theme}
              initial={preset.reduced ? { opacity: 0 } : { rotate: theme === 'dark' ? -90 : 90, opacity: 0 }}
              animate={{ rotate: 0, opacity: 1 }}
              transition={preset.ui}
              style={{ display: 'grid', placeItems: 'center' }}
            >
              {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
            </motion.span>
          </button>

          <a
            className="lp-iconbtn"
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer noopener"
            aria-label="在 GitHub 上查看源代码"
          >
            <Github size={18} aria-hidden="true" />
          </a>
        </div>
      </motion.div>
    </header>
  );
}
