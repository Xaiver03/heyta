/** Website content lives on the official website, including when the app runs
 * in a local WebView or development server. Self-hosted sites can override it
 * explicitly with VITE_SITE_URL; never infer a website from the storage origin.
 */
import { OFFICIAL_SITE_ORIGIN } from '@heyta/app-host';

function configuredSiteUrl(): string | null {
  const raw: unknown = import.meta.env.VITE_SITE_URL;
  if (typeof raw !== 'string') return null;

  const trimmed = raw.trim().replace(/\/+$/, '');
  if (trimmed === '') return null;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  } catch {
    return null;
  }
  return trimmed;
}

/** Explicit site override, otherwise the official public website. */
export function siteRoot(): string {
  return configuredSiteUrl() ?? OFFICIAL_SITE_ORIGIN;
}

/**
 * 站点里某个路径的绝对地址。
 *
 * @param path 以 `/` 开头、**含可能的锚点**（例如 `/docs#sync`）。
 *   锚点之所以要能带，是因为应用里的报错提示应当直接落到**那一问**上，
 *   而不是把人丢在帮助页顶部让他自己找。
 */
export function siteLink(path: string): string {
  return `${siteRoot()}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * 帮助中心里「同步」那一问的落点。
 *
 * 与 `apps/landing/src/site/content.ts` 的 `HELP_QUESTIONS` 里那条 `id: 'sync'`
 * 对应 —— 两边都对不上时，链接会落到帮助页顶部（不报错，只是差一点），
 * 所以这里不做一个共享常量：跨 app 的共享常量会把两个仓库的不同发布节奏
 * 绑死，而失败的代价只是"差一点"。
 */
export const HELP_SYNC_ANCHOR = '/docs#sync';
