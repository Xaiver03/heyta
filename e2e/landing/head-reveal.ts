import type {Page} from '@playwright/test';

/**
 * 🔴 等页头那一次"遮罩揭示"**真的落位**，再截图。唯一事实源。
 *
 * 页头的标题走 `.lp-mask { overflow: hidden }` + 内层 `translateY(112%) → 0%`，
 * 引言再错峰淡入。动画没跑完时，**页头在截图里就是一条空白带** ——
 * 那不是产品缺陷，但它是**不能用的证据**：§6.2 规定一要的是"访客看到的画面"，
 * 而对着这张图去查就会去修一个不存在的问题。
 * 这仍是 §7 第 83 条那一族 —— 探针观测的时刻本身就是判据的一部分。
 *
 * ⚠️ 两个失效形态都实测过：
 * 1. 不等待 ⇒ 图顶整块空白（`/platforms` 的「平台状态」H1 就是这样被拍没的）；
 * 2. 以为 `screenshot({animations: 'disabled'})` 就够了 ⇒ **不够**：那个参数只完成
 *    CSS 动画/过渡，而 framer-motion 的遮罩走 WAAPI transform，加了它 lede 与按钮
 *    回来了、H1 仍是空白（同一趟实测）。
 *
 * 结构缺失时返回 `false` 而不是抛错 —— 于是 `waitForFunction` 会**超时红**，
 * 不会静默放行（"标题不在了"和"标题还没落位"都必须拦得下来）。
 */
export async function waitHeadRevealed(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const h1 = document.querySelector<HTMLElement>('.lp-h1');
    const inner = h1?.querySelector<HTMLElement>('.lp-mask__inner') ?? null;
    const lede = document.querySelector<HTMLElement>('.lp-lede');
    if (h1 === null || inner === null || lede === null) return false;
    const box = h1.getBoundingClientRect();
    const innerBox = inner.getBoundingClientRect();
    return (
      box.height > 0 &&
      Math.abs(innerBox.top - box.top) < 2 &&
      getComputedStyle(lede).opacity === '1'
    );
  });
}
