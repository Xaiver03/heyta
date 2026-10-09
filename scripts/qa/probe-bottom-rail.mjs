// 一次性探针（不属于常驻判据）：读窄屏底部那条导航的实际形状。
// 用法：node scripts/qa/probe-bottom-rail.mjs   （需要有人在该端口上起着 apps/web）
import { chromium } from '../../e2e/node_modules/@playwright/test/index.mjs';

const ORIGIN = process.env.HEYTA_RESPONSIVE_ORIGIN ?? 'http://127.0.0.1:4387';
const CASES = [
  { theme: 'light', width: 375, height: 812 },
  { theme: 'dark', width: 375, height: 812 },
  { theme: 'light', width: 390, height: 844 },
  { theme: 'dark', width: 390, height: 844 },
];

const browser = await chromium.launch({ headless: true });
const out = [];
for (const spec of CASES) {
  const ctx = await browser.newContext({
    viewport: { width: spec.width, height: spec.height },
    colorScheme: spec.theme === 'dark' ? 'dark' : 'light',
  });
  await ctx.addInitScript(([t]) => {
    localStorage.setItem('heyta.locale', 'zh-CN');
    localStorage.setItem('heyta.theme', t);
  }, [spec.theme]);
  const page = await ctx.newPage();
  await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle' });
  const localOnly = page.getByTestId('privacy-consent-local-only');
  if (await localOnly.count() === 1) {
    await localOnly.click();
    await page.waitForTimeout(400);
  }
  const sheetClose = page.getByTestId('auth-form-close');
  if (await sheetClose.count() === 1) {
    await sheetClose.click();
    await page.waitForTimeout(300);
  }
  const read = await page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const clickables = (el) => [...el.querySelectorAll('a, button, [role="tab"], [role="button"]')];
    const cands = [...document.querySelectorAll('nav, header, footer, div, [role="navigation"], [role="tablist"]')]
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { el, r, items: clickables(el).filter((i) => i.getBoundingClientRect().width > 0) };
      })
      .filter((c) => c.r.top > vh - 140 && c.r.height > 24 && c.r.height < 140 && c.items.length >= 3)
      // 取"最贴底、条目最多"的那一枚，避免抓到内容区里恰好靠下的卡片
      .sort((a, b) => b.r.bottom - a.r.bottom || b.items.length - a.items.length);
    const pick = cands[0];
    if (!pick) return { found: false };
    const items = pick.items.map((el) => {
      const r = el.getBoundingClientRect();
      const label = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ');
      const clipped = [...el.querySelectorAll('*')].some((n) => n.scrollWidth > n.clientWidth + 1);
      const host = el.closest('.ht-rail__sync, .ht-rail__tab, .ht-rail__top') || el.parentElement;
      const hr = host?.getBoundingClientRect();
      return {
        label: label.slice(0, 24),
        rect: { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom) },
        fullyInsideViewport: r.left >= -0.5 && r.right <= vw + 0.5 && r.bottom <= vh + 0.5,
        textClipped: clipped || el.scrollWidth > el.clientWidth + 1,
        touchSize: { w: Math.round(r.width), h: Math.round(r.height) },
        // 它有没有超出自己那一格（flex 槽位）——超出说明收缩只加在外层、没加在里面的按钮上
        slot: host ? {
          cls: host.className?.toString().slice(0, 40),
          left: Math.round(hr.left),
          right: Math.round(hr.right),
          overflowsSlotRight: r.right > hr.right + 0.5,
          overflowsSlotLeft: r.left < hr.left - 0.5,
        } : null,
      };
    });
    let overlaps = 0;
    for (let i = 1; i < items.length; i += 1) {
      const a = items[i - 1].rect;
      const b = items[i].rect;
      const inter = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const vertical = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (inter > 2 && vertical > 2) overlaps += 1;
    }
    return {
      found: true,
      host: { tag: pick.el.tagName.toLowerCase(), cls: pick.el.className?.toString().slice(0, 60), rect: { top: Math.round(pick.r.top), bottom: Math.round(pick.r.bottom) } },
      itemCount: items.length,
      items,
      overlaps,
      anyClipped: items.some((i) => i.textClipped),
      anyOutside: items.filter((i) => !i.fullyInsideViewport).map((i) => i.label),
      under44: items.filter((i) => i.touchSize.w < 44 || i.touchSize.h < 44).map((i) => `${i.label}=${i.touchSize.w}x${i.touchSize.h}`),
      docScrollWidth: document.documentElement.scrollWidth,
      viewportWidth: vw,
      horizontalOverflow: document.documentElement.scrollWidth > vw + 1,
    };
  });
  out.push({ ...spec, read });
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(out, null, 1));
