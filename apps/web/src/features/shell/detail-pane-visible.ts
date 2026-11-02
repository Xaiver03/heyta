/**
 * 详情列"这一屏放得下吗" —— 与 `narrow.css` 那两条媒体规则**同源**的 JS 读数。
 *
 * 🔴 为什么要一份 JS 版：CSS 在放不下时把 `.ht-app__detail` 整块 `display:none`。
 * 而"把某个面单放进那一栏"是**渲染时**的决定 —— 只按 CSS 藏，用户点一条便签就会得到
 * 一个藏在 `display:none` 里的编辑器：界面上什么都没发生，数据却已经进模型。
 * 所以放置决定必须读同一个条件，而不是各写一套。
 *
 * ⚠️ 两侧同源现在由 `lib/breakpoints.ts` + 门禁 `scripts/check-breakpoints.mjs` 保证，
 * **不再靠"逐字对齐"这句注释**（那是两份会各自漂的抄件）：
 *   · `narrow.css` `@media (max-width: 63.9375rem)` ⇒ 隐藏；
 *   · `narrow.css` `@media (min-width: 64rem) and (max-height: 29.9375rem)` ⇒ 隐藏。
 *   ⇒ 放得下 = 宽 ≥ 64rem **且** 高 ≥ 30rem（= 1024 × 480）。
 * 🔴 这三个数以前在 JS 里是 `1024px` / `480px` 两枚手写字面量 —— "同一个阈值两种拼法"
 * 那一类缺陷的 JS 版；现在读 `lib/breakpoints.ts`，而 `apps/web/src` 里别的 `.ts`
 * 再写宽/高字面量会被门禁 B5 判红。
 */
import { useEffect, useState } from 'react';

import { DETAIL_FITS_QUERY } from '../../lib/breakpoints';

export { DETAIL_FITS_QUERY };

const hasMatchMedia = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function';

/** 纯读数（不带"用户收起"那一档）。jsdom 没有 `matchMedia` 时按"放不下"处理。 */
export function detailFitsViewport(): boolean {
  return hasMatchMedia() ? window.matchMedia(DETAIL_FITS_QUERY).matches : false;
}

/**
 * 那一栏现在**看得见**吗。
 *
 * ⚠️ `collapsed` 是用户主动收起，与"放不下"是两件事（`narrow.css` 文件头自己写明
 * "两处的理由不同，不许合成一个布尔"）—— 所以这里收两个输入，而不是把 pref 直接当几何。
 */
export function useDetailColumnShown(collapsed: boolean): boolean {
  const [fits, setFits] = useState(detailFitsViewport);
  useEffect(() => {
    if (!hasMatchMedia()) return undefined;
    const mq = window.matchMedia(DETAIL_FITS_QUERY);
    const onChange = () => setFits(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return fits && !collapsed;
}
