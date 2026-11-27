/**
 * 登录对话框左侧的**滚动 Banner**（电脑端）。
 *
 * 2026-11-27：从一张静态插画升级为**多张自动轮播**，用画面讲故事/展示功能
 * （任务 → 日历 → 专注 → 统计），与移动端首启页"滚动展示功能"同一套思路。
 *
 * - 4 张图都用本地 MOSS 生成（1536×1152 大图，够大可以缩；小图放不大）。
 * - 只做氛围，`aria-hidden`；不放任何文字（界面只用排版/画面表达）。
 * - 横向滚动：一排 4 个 slide 的轨道，`translateX(-i*100%)` 逐个滑过；每 ~5.2s 换一张。
 * - `prefers-reduced-motion: reduce` 时不自动轮播（停在第 0 张）。
 * - 窄屏/手机由 CSS 整块隐藏（`.ht-sheet__auth-plan { display:none }`），只影响电脑端。
 * - 素材出处见 `assets/illustrations/auth/provenance.json`。
 */
import { useEffect, useState } from 'react';

const SLIDES = [
  { key: 'tasks', art: new URL('../../../../../assets/illustrations/auth/banner-tasks.jpg', import.meta.url).href },
  { key: 'calendar', art: new URL('../../../../../assets/illustrations/auth/banner-calendar.jpg', import.meta.url).href },
  { key: 'focus', art: new URL('../../../../../assets/illustrations/auth/banner-focus.jpg', import.meta.url).href },
  { key: 'stats', art: new URL('../../../../../assets/illustrations/auth/banner-stats.jpg', import.meta.url).href },
] as const;

const HOLD_MS = 5200;

export function AuthPlanScene(): React.JSX.Element {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const id = window.setInterval(() => {
      setIndex((v) => (v + 1) % SLIDES.length);
    }, HOLD_MS);
    return () => {
      window.clearInterval(id);
    };
  }, []);

  return (
    <aside className="ht-sheet__auth-plan" aria-hidden="true" data-testid="auth-plan-scene">
      <div className="ht-auth-banner" style={{ transform: `translateX(-${index * 100}%)` }}>
        {SLIDES.map((s) => (
          <div className="ht-auth-banner__slide" key={s.key}>
            <img className="ht-auth-banner__img" src={s.art} alt="" aria-hidden="true" draggable={false} />
          </div>
        ))}
      </div>
    </aside>
  );
}
