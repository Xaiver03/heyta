import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

/**
 * 窄屏底部导航的几何契约（本线自己的一枚，2026-10-11）。
 *
 * 这条判据存在的原因：`documentElement.scrollWidth` 那一把尺**对它天生瞎**。
 * 台账「窄屏底部导航第 7 枚」那一格量到：同步那一枚自己的盒子 302→388（视口 375），
 * 越出 13px、压住通知 21px，而 `scrollWidth` 仍等于 375 —— 它是被**画到屏外**，
 * 不是可以横滚出去的内容。所以这里量的不是"页面有没有横向溢出"，
 * 而是**每一枚可交互项自己的盒子**。
 *
 * 牙（两条变异臂都跑过，读数在台账同一格）：
 * ① 摘掉 `narrow.css` 里那组收缩规则 ⇒ 红在「相邻两项水平重叠」（通知×同步 3px）；
 * ② 再把状态文字换回整句（也就是修之前的形状）⇒ 红在「有可交互项被画到视口外」，
 *    打印出来的正是 `同步，当前状态：登录以同步=302→388`。
 *
 * ⚠️ 只读几何、**不写任何在册证据目录** —— 写图会覆盖已复核过的截图（§7 第 175 条那族）。
 */
const NARROW_RAIL_CASES = [
  { locale: 'zh-CN', url: '/?lang=zh-CN', width: 375, height: 812 },
  { locale: 'zh-CN', url: '/?lang=zh-CN', width: 390, height: 844 },
  { locale: 'en', url: '/?lang=en', width: 375, height: 812 },
] as const;

test('窄屏底部导航：每一枚可交互项都在视口内、互不重叠、命中区不小于 44px', async ({ page }) => {
  test.setTimeout(300_000);
  for (const spec of NARROW_RAIL_CASES) {
    await page.setViewportSize({ width: spec.width, height: spec.height });
    await openApp(page, spec.url);
    const rail = page.locator('nav.ht-compact-rail');
    await expect(rail, `${spec.locale} ${spec.width}px 这一档应走窄屏导航`).toBeVisible();
    const read = await rail.evaluate((nav, viewportWidth) => {
      const boxes = [...nav.querySelectorAll('button, a[href], [role="tab"]')]
        .filter((el) => getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0)
        .map((el) => {
          const r = el.getBoundingClientRect();
          const label = (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 20);
          return {
            label: label || el.className.toString().slice(0, 20),
            left: Math.round(r.left),
            right: Math.round(r.right),
            width: Math.round(r.width),
            height: Math.round(r.height),
          };
        })
        .sort((a, b) => a.left - b.left);
      const outside = boxes.filter((b) => b.left < 0 || b.right > viewportWidth).map((b) => `${b.label}=${b.left}→${b.right}`);
      const overlaps: string[] = [];
      for (let i = 1; i < boxes.length; i += 1) {
        const a = boxes[i - 1]!;
        const b = boxes[i]!;
        const inter = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        if (inter > 2) overlaps.push(`${a.label}×${b.label}=${inter}px`);
      }
      const small = boxes.filter((b) => b.width < 44 || b.height < 44).map((b) => `${b.label}=${b.width}x${b.height}`);
      return { count: boxes.length, outside, overlaps, small };
    }, spec.width);

    // 分母自检：`.every`/`.filter` 对空集合都是"通过"，所以先钉住这一档确实有七枚。
    expect(read.count, `${spec.locale} ${spec.width}px：窄屏导航应有 7 枚可交互项（头像/两枚目的地/助手/更多/通知/同步）`).toBeGreaterThanOrEqual(7);
    expect(read.outside, `${spec.locale} ${spec.width}px：有可交互项被画到视口外`).toEqual([]);
    expect(read.overlaps, `${spec.locale} ${spec.width}px：相邻两项水平重叠`).toEqual([]);
    expect(read.small, `${spec.locale} ${spec.width}px：命中区小于 44px`).toEqual([]);
  }
});
