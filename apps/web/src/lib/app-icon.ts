/**
 * 应用图标切换 —— Web 的等价物是**浏览器标签页图标（favicon）**
 * ==========================================================
 *
 * 补的是覆盖图谱 #56「应用图标」那一格。**先说实话**（`?` 里也这么写）：
 * 装到系统里的**应用图标**由各平台（MSIX / PWA manifest / iOS / Android）在安装时定死，
 * **Web 版在运行期改不了它** —— 这是平台事实，不是我们偷懒。
 *
 * 所以在 Web 上做的是**最小可行等价物**：动态切换 `<link rel="icon">` 的 favicon。
 * 它和"应用图标"同样回答"这个入口长什么样"，同样能被用户看见（浏览器标签 / 书签栏），
 * 而且**不假装**改了系统图标。
 *
 * ## 🔴 三条纪律
 *
 * 1. **设备属性、零 op**（[ADR-0085](../../../../docs/adr/0085-appearance-is-device-local-and-never-an-op.md)）：
 *    只写 `localStorage`，不 dispatch。
 * 2. **取色走 token，不发明色值**：每个变体的底色引用 tokens.css 里**已有的原色阶**
 *    （与强调色同一族）。运行时用 `getComputedStyle` 把 token 解析成实际颜色再塞进 SVG，
 *    于是本文件**一个裸 hex 都没有**，改 token 图标跟着变。
 * 3. **`default` = 真实图标**：回到 `public/icons/icon.svg`（gen-pwa 生成的那一枚）。
 *
 * ⚠️ favicon 的图形（"h" 字形）与 `public/icons/icon.svg` 是**同一份几何**。抽出来只为
 *    让变体不必新增二进制资源、也不依赖构建期脚本 —— 若将来图形改了，这里跟着改
 *    （判据 `apps/web/tests/app-icon.spec.ts` 会钉住 default 落在真实路径上）。
 */

/** 存储键。🔴 只导出给判据用；产品代码走 `loadAppIcon` / `saveAppIcon`。 */
export const APP_ICON_STORAGE_KEY = 'heyta.appIcon';

/** 真实 favicon（gen-pwa 产物）。 */
export const DEFAULT_APP_ICON_HREF = '/icons/icon.svg';

export const APP_ICONS = ['default', 'emerald', 'sky', 'amber'] as const;
export type AppIcon = (typeof APP_ICONS)[number];

/** 每个非默认变体的底色 token（与强调色同族）。 */
const APP_ICON_COLOR_TOKEN: Record<Exclude<AppIcon, 'default'>, string> = {
  emerald: '--ht-emerald-600',
  sky: '--ht-sky-600',
  amber: '--ht-amber-600',
};

/** 把 token 名解析成实际颜色。测试里注入替代实现，避免依赖真实样式表。 */
export type ColorReader = (token: string) => string;

function readTokenColor(token: string): string {
  if (typeof document === 'undefined') return '';
  return getComputedStyle(document.documentElement).getPropertyValue(token).trim();
}

/**
 * 用给定底色拼一张 favicon 的 data URI（与 `icon.svg` 同几何：圆角方块 + 白色 "h"）。
 *
 * 纯函数、不碰 DOM。底色是**变量**，所以这里没有裸 hex；`white` 用具名颜色而非 `#fff`。
 */
export function faviconDataUri(color: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="${color}"/><rect x="140" y="120" width="52" height="272" rx="22" fill="white"/><rect x="320" y="228" width="52" height="164" rx="22" fill="white"/><rect x="140" y="228" width="232" height="48" rx="22" fill="white"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * 某个图标档应写进 `<link rel="icon">` 的 href。
 *
 * - `default` → 真实图标路径；
 * - 变体 → 用它底色的 data URI；取不到颜色（token 解析为空）时**回落到默认**，
 *   绝不写一个 `fill=""` 的坏 SVG。
 */
export function appIconHref(icon: AppIcon, readColor: ColorReader = readTokenColor): string {
  if (icon === 'default') return DEFAULT_APP_ICON_HREF;
  const color = readColor(APP_ICON_COLOR_TOKEN[icon]);
  if (color === '') return DEFAULT_APP_ICON_HREF;
  return faviconDataUri(color);
}

/** 读用户选的图标；认不出的脏值回落 `default`。 */
export function loadAppIcon(): AppIcon {
  try {
    const raw = localStorage.getItem(APP_ICON_STORAGE_KEY);
    if (raw !== null && (APP_ICONS as readonly string[]).includes(raw)) return raw as AppIcon;
  } catch {
    // 隐私模式：读不到就当没设过。
  }
  return 'default';
}

/** 记下用户选的图标。写不上不致命。 */
export function saveAppIcon(icon: AppIcon): void {
  try {
    localStorage.setItem(APP_ICON_STORAGE_KEY, icon);
  } catch {
    // 存不上不影响本次生效。
  }
}

/**
 * 把图标应用到当前文档的 `<link rel="icon">`（幂等）。
 *
 * 找不到就建一枚（带 `type="image/svg+xml"`，与 `index.html` 里那枚一致）——
 * 判据要的是"页头真的有这枚 link"，而不是"恰好某一枚被改了"。
 */
export function applyAppIcon(icon: AppIcon, readColor: ColorReader = readTokenColor): void {
  if (typeof document === 'undefined') return;
  const href = appIconHref(icon, readColor);
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"][type="image/svg+xml"]');
  if (link === null) {
    link = document.createElement('link');
    link.rel = 'icon';
    link.type = 'image/svg+xml';
    document.head.appendChild(link);
  }
  link.setAttribute('href', href);
}
