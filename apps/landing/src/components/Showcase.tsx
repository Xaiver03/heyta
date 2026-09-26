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

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useMotionValueEvent, useScroll, useTransform, type MotionValue } from 'motion/react';

import { useI18n } from '@heyta/i18n';

import { AppWindow, type MockView } from '../mockup/AppWindow.js';
import { showcaseWindowOpacity, showcaseWindowOpacityReduced, useMotionPreset } from '../lib/motion.js';

interface Screen {
  view: MockView;
  label: string;
  title: string;
  body: string;
}

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

  /**
   * 🔴 两条曲线，因为"谁遮挡谁"在两条路径上不是同一回事。
   *
   * 3D 路径下靠 `translateZ` 分出前后，**靠前的那块必须完全不透明**，
   * 否则后面那块会从它里面透出来 —— 换位中点上前后两块同时 47.6%，
   * 看起来就是双重曝光。所以 3D 走"平台 + 快速收尾"。
   *
   * 减动效路径下位移与旋转都被去掉、三块 `inset: 0` 直叠，
   * "前后关系"不存在了，只能靠透明度表达遮挡 —— 那一路径必须保留平滑淡出。
   *
   * ⚠️ 曲线做成 `lib/motion.ts` 里的纯函数，是因为它有一个**能证伪的不变量**
   * （任何进度下都至少有一块完全不透明），只能靠测试钉：
   * `tests/showcase-opacity.spec.ts`。
   */
  const opacity = useTransform(offset, (o) =>
    reduced ? showcaseWindowOpacityReduced(o) : showcaseWindowOpacity(o),
  );

  /**
   * 🔴 合成**一条** transform 字符串，而不是 x / z / rotateY / scale 四个简写。
   *
   * AUDIT §5：简写会各写一次 style，目标是合成单条完整 transform ——
   * 每帧只写一次，旋转顺序也显式可控（translate → rotate）。
   * 几何取值与原来逐个一致，观感不变。
   *
   * 这是页面**签名级**的滚动交互（300vh sticky + 三块整屏窗口联动），
   * 所以每帧少写三次 style 在这里最值得。
   */
  const transform = useTransform(offset, (o) => {
    const tx = o * 46; // %
    const tz = o * -220; // px
    const ry = o * -34; // deg
    const s = 1 - Math.min(0.18, Math.abs(o) * 0.1); // 无单位
    return `translateX(${tx}%) translateZ(${tz}px) rotateY(${ry}deg) scale(${s})`;
  });

  return (
    <motion.div
      className="lp-showcase__win"
      style={
        reduced
          ? { opacity }
          : { opacity, transform, transformStyle: 'preserve-3d' }
      }
      aria-hidden={false}
    >
      <AppWindow view={screen.view} />
    </motion.div>
  );
}

export function Showcase(): React.JSX.Element {
  const preset = useMotionPreset();
  const { t } = useI18n();
  const sectionRef = useRef<HTMLElement>(null);
  const [active, setActive] = useState(0);
  const [active3d, setActive3d] = useState(false);

  /**
   * 声明成**非空元组**而不是 `Screen[]`：这样 `screens[0]` 的类型是 `Screen`
   * 而不是 `Screen | undefined`（`noUncheckedIndexedAccess` 下普通数组索引
   * 一律带上 `undefined`）。下面取当前项时就能安全地兜底到第 0 项。
   *
   * 数据挪进组件内是文案迁移的硬要求（模块级拿不到 `t`）。取舍见 `Landing.tsx` 文件头。
   */
  const screens = useMemo<readonly [Screen, ...Screen[]]>(
    () => [
      {
        view: 'quadrant',
        label: t('landing.feature.quadrant'),
        title: t('landing.showcase.quadrant.title'),
        body: t('landing.showcase.quadrant.body'),
      },
      {
        view: 'habits',
        label: t('landing.feature.habits'),
        title: t('landing.showcase.habits.title'),
        body: t('landing.showcase.habits.body'),
      },
      {
        view: 'focus',
        label: t('landing.feature.focus'),
        title: t('landing.showcase.focus.title'),
        body: t('landing.showcase.focus.body'),
      },
    ],
    [t],
  );

  /**
   * `will-change` 只在展厅**进入视口**时才加（AUDIT §5：它必须窄而临时）。
   * 三块窗口是 `inset: 0` 的整屏元素、内部各有 `backdrop-filter` 材质，
   * 永久提升三层大图层 = 页面整个生命周期都在吃 GPU 内存，
   * 而这套变换只在滚过这一节时才发生。
   *
   * 没有 IntersectionObserver 时按「可见」处理：宁可多提升一层，
   * 也不要让动画在旧浏览器上退化成非合成。范式同 `Deferred.tsx`。
   */
  useEffect(() => {
    const el = sectionRef.current;
    if (el === null || typeof IntersectionObserver === 'undefined') {
      setActive3d(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        setActive3d(entries[0]?.isIntersecting === true);
      },
      { rootMargin: '25% 0% 25% 0%' },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, []);

  // 进度取自**这一节自身的滚动跨度**：从"节的顶部碰到视口顶部"到"节的底部离开"。
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start start', 'end end'],
  });

  useMotionValueEvent(scrollYProgress, 'change', (value) => {
    const index = Math.round(value * (screens.length - 1));
    setActive(Math.max(0, Math.min(screens.length - 1, index)));
  });

  const current = screens[active] ?? screens[0];

  /**
   * 点击左侧条目 = **把页面滚到那一屏的进度点**，而不是另起一个"当前项"状态。
   *
   * 为什么不直接 `setActive(index)`：那会造出**两个真相源** —— 滚动一个、点击一个。
   * 点完第 3 项再往回滚，高亮会卡在第 3 项不动；而三块窗口的 3D 位置仍由滚动进度决定，
   * 于是"高亮的条目"和"实际显示的界面"会分家。这个不同步在本节**真的出现过**
   * （`lp-showcase__hint` 那个 `aria-live` 就是为它加的），不该再引入第二条路径。
   *
   * 滚过去则由同一个 `scrollYProgress` 驱动：换位连贯，标签永远与画面一致，
   * 而且点击不需要任何新状态。
   */
  const scrollToIndex = (index: number): void => {
    const el = sectionRef.current;
    if (el === null) return;
    const rect = el.getBoundingClientRect();
    const sectionTop = rect.top + window.scrollY;
    // 🔴 必须与 useScroll 的 offset ['start start', 'end end'] 用同一个公式：
    // 进度 p 对应的滚动位置是 sectionTop + p × (节高 − 视口高)。
    // 公式对不上，点击的落点与动画进度就会差一截。
    const span = rect.height - window.innerHeight;
    if (span <= 0) return;
    const top = sectionTop + (index / (screens.length - 1)) * span;
    // 减少动态偏好下用 'auto'：平滑滚动本身就是一种动效。
    window.scrollTo({ top, behavior: preset.reduced ? 'auto' : 'smooth' });
  };

  return (
    <section
      className="lp-showcase"
      id="showcase"
      ref={sectionRef}
      data-active={active3d ? 'true' : undefined}
    >
      <div className="lp-showcase__inner">
        <div className="lp-wrap lp-showcase__grid">
          <div className="lp-showcase__aside">
            <h2 className="lp-h2">{t('landing.showcase.title')}</h2>
            <p className="lp-section__lede">
              {t('landing.showcase.lede')}
            </p>

            <ol className="lp-showcase__list">
              {screens.map((screen, index) => {
                const isActive = index === active;
                return (
                  <li
                    key={screen.view}
                    className={`lp-showcase__item${
                      isActive ? ' lp-showcase__item--active' : ''
                    }`}
                  >
                    {/*
                      整行做成 button，而不是只让 1/2/3 那个圆点可点：
                      圆点只有 24px，触屏上很难按准；整行可点也更符合
                      "这是一条导航"的心智。

                      `aria-current` 是给读屏用户的 —— 视觉上的高亮与
                      不透明度变化对他们完全不可见。
                    */}
                    <button
                      type="button"
                      className="lp-showcase__item-btn"
                      onClick={() => {
                        scrollToIndex(index);
                      }}
                      aria-current={isActive ? 'true' : undefined}
                    >
                      <span className="lp-showcase__index">{index + 1}</span>
                      <span>
                        <span className="lp-showcase__item-label">{screen.label}</span>
                        <span className="lp-showcase__item-body">{screen.body}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>

            <p className="lp-showcase__hint" aria-live="polite">
              {t('landing.showcase.hint', { label: current.label })}
            </p>
          </div>

          <div className="lp-showcase__stage">
            {screens.map((screen, index) => (
              <ShowcaseWindow
                key={screen.view}
                progress={scrollYProgress}
                index={index}
                total={screens.length}
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
