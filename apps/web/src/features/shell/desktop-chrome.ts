/**
 * 桌面壳的「标题栏融合」：**平台判定与 <html> 标记的逻辑层**。
 * ============================================================================
 *
 * 🔴 **零 DOM 依赖的判定（`resolveDesktopPlatform` / 各 `…Enabled`）是单测对象**；
 * DOM 包裹层（`applyDesktopChrome` / `clearDesktopChrome` / `setDesktopChromeActive`）
 * 只在原生壳内、首帧前被调用，浏览器 / PWA / 移动端**不会**走到这里。
 *
 * 与 `pwa/widget-install.ts` 的分工：`resolveInstallPlatform` 服务「装成应用引导」文案，
 * 本文件服务「窗口 chrome 融合」。两者对 win / mac 的判定口径一致（只看平台名，不猜 UA 全文）。
 *
 * 🔴 **硬约束落点（与任务书的两条红线同义）**：
 *  · macOS 红绿灯、Windows caption buttons **一律由系统绘制**，壳只保留命中测试 / 失焦态；
 *    本层用 `keepsNativeCaptionButtons` 把这个不变量显式成可测的判定，而不是埋在样式里。
 *  · 平台判定是**真实分支**（`other` 仅当确实不是三端桌面之一），不是兜底 ——
 *    见 `widget-install.ts` 文件头那条纪律。
 */

import { isNativeShellHost } from '../../pwa/widget-install.js';

/** 桌面平台四分支。`other` = 浏览器 / PWA / 移动端 / 未知。 */
export type DesktopPlatform = 'macos' | 'windows' | 'linux' | 'other';

/**
 * 平台名 → 四分支。
 *
 * ⚠️ 大小写与空白容错：运行时值，非常量。win / mac 的判定与 `resolveInstallPlatform` 同口径；
 * linux / x11 / gtk 归为 `linux`（本仓库的 `apps/desktop-linux` 也是 WebView 系壳，同样融合）。
 */
export function resolveDesktopPlatform(platform: string | null | undefined): DesktopPlatform {
  const p = typeof platform === 'string' ? platform.trim().toLowerCase() : '';
  if (p.includes('win')) return 'windows';
  if (p.includes('mac')) return 'macos';
  if (p.includes('linux') || p.includes('x11') || p.includes('gtk')) return 'linux';
  return 'other';
}

/** 该平台下，窗口级内容延伸进标题栏、需给原生控件让位（mac 红绿灯 / win caption）。 */
export function requiresCaptionInset(platform: DesktopPlatform): boolean {
  return platform === 'macos' || platform === 'windows';
}

/**
 * 原生控件是否由系统绘制、壳只保留命中测试。
 *
 * 🔴 两条桌面端都返回 `true`：这是任务书 macOS / Windows 红线的可测表达 ——
 * 红绿灯与 caption buttons **不**自绘（Apple HIG 反对自绘窗口控件；Win11 Snap 需要原生按钮）。
 * `linux` 这里保守归 `false`：Linux 壳的窗口装饰策略随发行版而定，不在本轮范围。
 */
export function keepsNativeCaptionButtons(platform: DesktopPlatform): boolean {
  return platform === 'macos' || platform === 'windows';
}

/** 顶栏空白处是否可用于拖拽窗口。两桌面端原生均已支持。 */
export function dragRegionEnabled(platform: DesktopPlatform): boolean {
  return platform === 'macos' || platform === 'windows';
}

/** 双击标题栏是否触发最大化 / 还原。两桌面端系统级支持。 */
export function doubleClickMaximizeEnabled(platform: DesktopPlatform): boolean {
  return platform === 'macos' || platform === 'windows';
}

/** 失焦时顶栏是否变暗（系统窗口非活跃态的视觉呼应）。 */
export function inactiveDimEnabled(platform: DesktopPlatform): boolean {
  return platform === 'macos' || platform === 'windows';
}

const MARKER_BASE = 'heyta-shell';
const specificMarker = (platform: DesktopPlatform): string => `${MARKER_BASE}--${platform}`;

/** 首帧前调用：给 <html> 打共享基类 + 平台子类。已在类上则幂等（重复调用无害）。 */
export function applyDesktopChrome(doc: Document, platform: DesktopPlatform): void {
  const root = doc.documentElement;
  if (!root.classList.contains(MARKER_BASE)) root.classList.add(MARKER_BASE);
  if (platform !== 'other') {
    const specific = specificMarker(platform);
    if (!root.classList.contains(specific)) root.classList.add(specific);
  }
}

/** 移除全部 `heyta-shell*` 类（还原到浏览器 / PWA 默认布局）。 */
export function clearDesktopChrome(doc: Document): void {
  const root = doc.documentElement;
  for (const cls of Array.from(root.classList)) {
    if (cls === MARKER_BASE || cls.startsWith(`${MARKER_BASE}--`)) root.classList.remove(cls);
  }
}

/** 窗口活跃态开关：原生失焦时由壳切，这里只管 <html> 上的 `--active` 标记。 */
export function setDesktopChromeActive(doc: Document, active: boolean): void {
  doc.documentElement.classList.toggle(`${MARKER_BASE}--active`, active);
}

/**
 * 取「我跑在哪个平台」的名字。WebView2 走 `userAgentData.platform`（Chromium），
 * 退回 `navigator.platform`（WKWebView 仍是 MacIntel / 老 Chromium / Firefox）。
 */
function platformName(): string | null | undefined {
  const uaData = (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData;
  return uaData?.platform ?? navigator.platform ?? null;
}

/**
 * 集合入口：仅在原生壳内、首帧前调用一次。
 *
 * 🔴 由 `isNativeShellHost` 把关 ⇒ 浏览器 / PWA / 移动端**不会**进入，DOM 零变化。
 * 返回实际平台（便于调用方记录 / 后续扩展）。
 */
export function bootstrapDesktopChrome(): DesktopPlatform {
  // `isNativeShellHost` 来自 widget-install.ts：认的是壳**实际注入**的信号
  // （`__heytaHostStoragePort` / `chrome.webview` / `webkit.messageHandlers.*`），不做 UA 猜测。
  const w = window as unknown as {
    chrome?: { webview?: unknown };
    webkit?: { messageHandlers?: Record<string, unknown> };
    __heytaHostStoragePort?: unknown;
  };
  const signals = {
    storagePort: w.__heytaHostStoragePort !== undefined,
    webview2Host: w.chrome?.webview !== undefined,
    shellMessageHandlers: ['heytaStorage', 'heytaWidget', 'heytaReminder'].filter(
      (name) => w.webkit?.messageHandlers?.[name] !== undefined,
    ),
  };
  if (!isNativeShellHost(signals)) return 'other';

  const platform = resolveDesktopPlatform(platformName());
  if (requiresCaptionInset(platform)) applyDesktopChrome(document, platform);
  setDesktopChromeActive(document, typeof document.hasFocus === 'function' ? document.hasFocus() : true);
  window.addEventListener('focus', () => setDesktopChromeActive(document, true));
  window.addEventListener('blur', () => setDesktopChromeActive(document, false));
  return platform;
}
