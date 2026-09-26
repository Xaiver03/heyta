/**
 * 真实界面展厅
 * ==============
 *
 * 这是"尽可能把真实界面放上去"的正面回答：**三块真实界面**（四象限 / 习惯 / 番茄钟）
 * 以 3D coverflow 的形式在滚动中依次就位。
 *
 * 为什么是「滚动固定 + 3D 换位」而不是「标签页」：
 *   标签页把"看另外两块界面"变成一次**用户主动的导航**，而滚动是连续的 ——
 *   界面自己在动，用户只需要往下滚。这符合 Apple §8「中间帧要指向结果」：
 *   下一块界面在换位过程中已经斜着露出来了，用户知道它要去哪。
 *
 * 实现要点：
 *   - 三块窗口**同时挂载**、绝对定位堆叠。不用 AnimatePresence 卸载重挂 ——
 *     重挂会重建每块的 ResizeObserver 与缩放计算，滚动中会闪。
 *   - 每个窗口的偏移量由**同一个滚动进度**推导（`index - progress * total`），
 *     所以它们是严格联动的，不会各跑各的。
 *   - `prefers-reduced-motion` 下退化成纯透明度交叉淡入（去掉位移与旋转）。
 */

import { useRef, useState } from 'react';
import { motion, useMotionValueEvent, useScroll, useTransform, type MotionValue } from 'motion/react';

import { AppWindow, type MockView } from '../mockup/AppWindow.js';
import { useMotionPreset } from '../lib/motion.js';

interface Screen {
  view: MockView;
  label: string;
  title: string;
  body: string;
}

/**
 * 声明成**非空元组**而不是 `Screen[]`：这样 `SCREENS[0]` 的类型是 `Screen`
 * 而不是 `Screen | undefined`（`noUncheckedIndexedAccess` 下普通数组索引
 * 一律带上 `undefined`）。下面取当前项时就能安全地兜底到第 0 项。
 */
const SCREENS: readonly [Screen, ...Screen[]] = [
  {
    view: 'quadrant',
    label: '四象限',
    title: '不用自己想「先做哪个」',
    body: '重要与紧急是两个独立的轴。紧急程度由截止时间推导，你只回答"这件事重要吗"，剩下的交给矩阵。',
  },
  {
    view: 'habits',
    label: '习惯',
    title: '连续天数比打卡次数更值得看',
    body: '热力图用同一色阶的深浅表示强度，不靠颜色区分档位，色觉差异下一样读得出来。',
  },
  {
    view: 'focus',
    label: '番茄钟',
    title: '专注记录和任务长在一起',
    body: '每段专注都关联到具体任务并落进本地日志，所以"这周时间花在哪"是查得出来的。',
  },
];

/** 单块窗口。抽成子组件是为了让每个窗口有自己的 hook —— 循环里不能调 hook。 */
function ShowcaseWindow({
  progress,
  index,
  total,
  screen,
  reduced,
}: {
  progress: MotionValue<number>;
  index: number;
  total: number;
  screen: Screen;
  reduced: boolean;
}): React.JSX.Element {
  // 该窗口在"自己那一格"时 offset = 0；滚过去变负，还没到变正。
  const offset = useTransform(progress, (p) => index - p * (total - 1));

  const opacity = useTransform(offset, (o) => Math.max(0, 1 - Math.abs(o) * 1.05));
  const rotateY = useTransform(offset, (o) => o * -34);
  const x = useTransform(offset, (o) => `${String(o * 46)}%`);
  const z = useTransform(offset, (o) => o * -220);
  const scale = useTransform(offset, (o) => 1 - Math.min(0.18, Math.abs(o) * 0.1));

  return (
    <motion.div
      className="lp-showcase__win"
      style={
        reduced
          ? { opacity }
          : { opacity, rotateY, x, z, scale, transformStyle: 'preserve-3d' }
      }
      aria-hidden={false}
    >
      <AppWindow view={screen.view} />
    </motion.div>
  );
}

export function Showcase(): React.JSX.Element {
  const preset = useMotionPreset();
  const sectionRef = useRef<HTMLElement>(null);
  const [active, setActive] = useState(0);

  // 进度取自**这一节自身的滚动跨度**：从"节的顶部碰到视口顶部"到"节的底部离开"。
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start start', 'end end'],
  });

  useMotionValueEvent(scrollYProgress, 'change', (value) => {
    const index = Math.round(value * (SCREENS.length - 1));
    setActive(Math.max(0, Math.min(SCREENS.length - 1, index)));
  });

  const current = SCREENS[active] ?? SCREENS[0];

  return (
    <section className="lp-showcase" id="showcase" ref={sectionRef}>
      <div className="lp-showcase__inner">
        <div className="lp-wrap lp-showcase__grid">
          <div className="lp-showcase__aside">
            <h2 className="lp-h2">这就是它现在的样子</h2>
            <p className="lp-section__lede">
              下面这三块不是效果图，是用真实界面的结构与取值复现出来的。
            </p>

            <ol className="lp-showcase__list">
              {SCREENS.map((screen, index) => (
                <li
                  key={screen.view}
                  className={`lp-showcase__item${
                    index === active ? ' lp-showcase__item--active' : ''
                  }`}
                >
                  <span className="lp-showcase__index">{index + 1}</span>
                  <span>
                    <span className="lp-showcase__item-label">{screen.label}</span>
                    <span className="lp-showcase__item-body">{screen.body}</span>
                  </span>
                </li>
              ))}
            </ol>

            <p className="lp-showcase__hint" aria-live="polite">
              当前显示：{current.label}
            </p>
          </div>

          <div className="lp-showcase__stage">
            {SCREENS.map((screen, index) => (
              <ShowcaseWindow
                key={screen.view}
                progress={scrollYProgress}
                index={index}
                total={SCREENS.length}
                screen={screen}
                reduced={preset.reduced}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
