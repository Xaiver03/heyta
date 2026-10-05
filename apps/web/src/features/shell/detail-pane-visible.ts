/**
 * 详情列"这一屏放得下吗" —— 与 `narrow.css` 那两条媒体规则**同源**的 JS 读数。
 *
 * 🔴 为什么要一份 JS 版：CSS 在放不下时把 `.ht-app__detail` 整块 `display:none`。
 * 而"把某个面单放进那一栏"是**渲染时**的决定 —— 只按 CSS 藏，用户点一条便签就会得到
 * 一个藏在 `display:none` 里的编辑器：界面上什么都没发生，数据却已经进模型。
 * 所以放置决定必须读同一个条件，而不是各写一套。
 *
 * ⚠️ 两处规则逐字对齐（改 CSS 就要改这里；`note-editor-placement` 那组判据钉着两侧）：
 *   · `narrow.css` `@media (max-width: 1023px)` ⇒ 隐藏；
 *   · `narrow.css` `@media (min-width: 1024px) and (max-height: 479px)` ⇒ 隐藏。
 *   ⇒ 放得下 = 宽 ≥ 1024 **且** 高 ≥ 480。
 */
import { useEffect, useState } from 'react';

export const DETAIL_FITS_QUERY = '(min-width: 1024px) and (min-height: 480px)';

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
