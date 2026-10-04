/**
 * 「页头那次遮罩揭示**真的落位**了没有」—— 截图/取证的唯一判据。
 * ==================================================================
 *
 * 单一所有者：`e2e/landing/head-reveal.ts` 只是把这里再导出一次，
 * `scripts/screenshots/capture.mjs` 直接消费这里。理由与两份抄件会漂在何处，
 * 写在那份 e2e 文件的头部注释里（审计文档 §8.110 那批证据图事故）。
 *
 * 为什么必须有它：落地页标题走 `.lp-mask { overflow: hidden }` +
 * 内层 `translateY(112%) → 0%`，引言再错峰淡入。动画没跑完就拍，
 * **页头在图里就是一条空白带** —— 那不是产品缺陷，但是**不能用的证据**。
 * ⚠️ Playwright 的 `animations: 'disabled'` 单独不够：它只完成 CSS 动画/过渡，
 * 管不到 framer-motion 走 WAAPI 的 transform（实测 lede/按钮回来了、H1 仍空白）。
 */

/** 揭示落位的判据本体（在页面上下文里跑）。 */
export function headRevealed() {
  const h1 = document.querySelector('.lp-h1');
  const inner = h1?.querySelector('.lp-mask__inner') ?? null;
  const lede = document.querySelector('.lp-lede');
  if (h1 === null || inner === null || lede === null) return false;
  const box = h1.getBoundingClientRect();
  const innerBox = inner.getBoundingClientRect();
  return (
    box.height > 0 &&
    Math.abs(innerBox.top - box.top) < 2 &&
    getComputedStyle(lede).opacity === '1'
  );
}

/**
 * 等揭示落位；等不到就**超时抛错**（结构缺失时 `headRevealed()` 恒 false，
 * 于是红在超时上而不是静默放行 —— 静默放行等于"这条判据永远通过"）。
 */
export async function waitHeadRevealed(page, timeout = 30_000) {
  await page.waitForFunction(headRevealed, undefined, { timeout });
}

/**
 * 截图前的收尾等待，按**这一页有没有落地页页头**分叉。
 *
 * 没有 `.lp-h1` 的页面（应用视图那批）走原来那条固定等待 ——
 * 这里刻意不"顺手"把它们也接进新判据：那会让每张应用截图都等一个
 * 永远不成立的条件。固定值保留在原处、只服务它本来服务的对象。
 */
export async function settleForShot(page, { fallbackMs = 600, timeout = 30_000 } = {}) {
  if ((await page.locator('.lp-h1').count()) === 0) {
    await page.waitForTimeout(fallbackMs);
    return 'fallback';
  }
  await waitHeadRevealed(page, timeout);
  return 'revealed';
}
