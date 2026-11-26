/**
 * 打印当前视图（覆盖图谱 #70）
 * =================================
 *
 * 产品裁决：**不造 PDF 引擎**，用浏览器原生 `window.print()` 打印当前这一屏。
 * 打印样式在 `styles/app/print.css`（`@media print` 里收掉 rail / 侧栏 / 详情列
 * 等外壳，正文铺满）。这里只回答一个问题：**什么时候调 `print()`**。
 *
 * ## 为什么还要一条 JS 绑定
 *
 * 浏览器自带的 ⌘P / Ctrl+P 在关键场景里不保证命中：
 *  - 桌面壳（Electron）**默认没有应用菜单**（`main.ts` 用 `before-input-event`
 *    只截了 ⌘,，其余交给 Chromium），某些平台的 ⌘P 在无菜单窗口里不一定有默认动作；
 *  - 无头 / 精简 WebView 里也可能没有这条快捷键。
 *
 * 所以这里显式接一条 ⌘P / Ctrl+P，命中就 `preventDefault()` 后调 `window.print()`。
 * 判断抽成纯函数（`isPrintShortcut`），接线只做副作用 —— 与本仓
 * `settings-shortcut.ts` / `print` 同一形状，好处是判据能在**不起浏览器**时逐条打。
 */

/** 一次按键里与打印相关的字段（够判即可，不依赖 DOM 的完整 `KeyboardEvent`）。 */
export interface PrintShortcutInput {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
}

/**
 * 这一次按键是不是"打印"。
 *
 * 规则：**⌘ / Ctrl + P**，且不带 Alt。
 *  - 不带 Alt：⌥⌘P 之类是别的应用的组合键，抢它没有理由；
 *  - 大小写都认（CapsLock / Shift 时 `key` 可能是 `'P'`）。
 */
export function isPrintShortcut(input: PrintShortcutInput): boolean {
  if (input.altKey) return false;
  if (!(input.metaKey || input.ctrlKey)) return false;
  return input.key === 'p' || input.key === 'P';
}

/**
 * 在 `window` 上挂打印快捷键。返回退订函数。
 *
 * ⚠️ 挂在**捕获阶段**（`capture: true`）：有些组件会在冒泡阶段把 P 键用在别处，
 * 而"打印"是全局动作，不该被某一个局部处理器吞掉。
 *
 * 环境没有 `window`（SSR / 单测）时安全地什么都不做 —— 与本仓其他 arm* 同一条防御。
 */
export function armPrintShortcut(target: Window | undefined = typeof window === 'undefined' ? undefined : window): () => void {
  if (target === undefined) return () => undefined;

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!isPrintShortcut(event)) return;
    event.preventDefault();
    target.print();
  };

  target.addEventListener('keydown', onKeyDown, true);
  return () => {
    target.removeEventListener('keydown', onKeyDown, true);
  };
}
