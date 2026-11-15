/**
 * 按下扩散的原点（web）
 * ======================
 *
 * 交代它解决什么：`controls.css` 里 `.ht-btn::after` 画的是**以按下点为圆心**的
 * 径向高光。CSS 不知道点击落在按钮的哪个位置，所以每个按钮在 `pointerdown`
 * 那一刻需要收到两个坐标。这份文件就是那唯一一处写入。
 *
 * ## 为什么是 document 级委托，而不是每个按钮各挂一次
 *
 * 按钮在 web 端有几百个（列表行、工具栏、对话框、面板），每个挂一对监听
 * 会让"能不能点"和"有没有装监听"耦合在一起 —— 于是**任何一处忘了挂，
 * 那个按钮就没有按下反馈，而且不报错**。委托只有一个监听，新按钮天然就有。
 *
 * ## 为什么用百分比而不是 px
 *
 * 按钮在 `transform: scale(var(--ht-motion-press-scale))` 时宽高会变，px 坐标会在按下与缩放的
 * 同一帧里对不上；百分比相对盒子永远成立。另外百分比不引入单位问题，
 * 也就不用为它开一个 token（见 `docs/agents/design-system.md` 的禁止裸值）。
 *
 * ## 边界
 *
 * - 只在 `pointerdown` 写属性，不改任何状态、不调 React、不产生 re-render。
 * - 找不到 `.ht-btn` 祖先时什么都不做（事件冒泡到 document 是常态）。
 * - `prefers-reduced-motion` 下**照写**：样式表那边会把高光整个关掉，
 *   写坐标不会产生任何可见效果；在这里再判一次等于两套降级策略。
 */

/** 写入的 CSS 变量名。`controls.css` 的 `::after` 读这两个。 */
export const PRESS_ORIGIN_X = '--ht-press-x';
export const PRESS_ORIGIN_Y = '--ht-press-y';

/**
 * 装一次即可。返回卸载函数（供测试与 HMR 使用）。
 */
export function installPressOrigin(doc: Document = document): () => void {
  const onPointerDown = (event: PointerEvent): void => {
    // `composedPath` 而不是 `event.target`：事件穿过 Shadow DOM / 跨根时
    // `target` 可能是一个不被 `.closest` 认识的重定向节点。
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    const hit = path.find(
      (node): node is HTMLElement => node instanceof HTMLElement && node.classList.contains('ht-btn'),
    );
    const button = hit ?? (event.target instanceof Element ? event.target.closest<HTMLElement>('.ht-btn') : null);
    if (button === null) return;

    const rect = button.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    // 钳到盒内：从屏幕边缘按下时 `clientX` 可能落在盒子外，
    // 不钳的话渐变中心会跑出按钮，读起来像"高光从外面飘进来"。
    const clamp = (v: number): number => Math.min(100, Math.max(0, v));
    button.style.setProperty(PRESS_ORIGIN_X, `${clamp(x).toFixed(2)}%`);
    button.style.setProperty(PRESS_ORIGIN_Y, `${clamp(y).toFixed(2)}%`);
  };

  doc.addEventListener('pointerdown', onPointerDown, { passive: true });
  return () => doc.removeEventListener('pointerdown', onPointerDown);
}
