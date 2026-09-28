/**
 * 「帮助 / 价格 / 更新动态在哪」的唯一事实源
 * =============================================
 *
 * 🔴 这个文件补的是**产品孤岛的另一半**：站点 → 应用早就通了
 * （`apps/landing` 的 `VITE_APP_URL`），而**应用 → 站点完全没有过一行链接**。
 * 也就是说：用户在应用里遇到问题，找不到帮助；想知道要不要付费，找不到价格；
 * 想知道这东西还在不在维护，找不到更新动态。
 * 这不叫"还没有帮助中心"，这叫**两个产品**。
 *
 * ## 地址怎么定（为什么不是"没配就不显示"）
 *
 * 应用的地址（`apps/landing` 的 `VITE_APP_URL`）没配时**什么都不渲染** ——
 * 一个猜出来的应用地址点下去是 404，比没有链接更坏。
 * 这里反过来，理由是一个已知事实而不是猜测：
 *
 *   `docs/runbooks/deployment.md` §3.3.1 定下的是**唯一域名** ——
 *   站点住在这个域名的**根**（`/`），应用住在 `/app/`。
 *   所以站点就在**应用自己所在的这个来源**的根上。这不是"猜一个域名"，
 *   而是"这个文档是从哪来的"。
 *
 * `VITE_SITE_URL` 是给别的形态留的口子（站点与应用分域名部署时配它）。
 *
 * ## ⚠️ 开发环境下的表现
 *
 * 本地起 `apps/web` 时来源是 `http://localhost:5173`，而那里没有站点 ——
 * 但 Vite 的 SPA 兜底会把 `/help` 也返回应用自己的 HTML，所以它是
 * **一个回到应用本身**的链接，不是 404。真实部署里（`/` 是站点）才是站点。
 * 这一点如实写在这里，不假装开发环境也能跳对。
 */

/**
 * 读到并校验构建期的 `VITE_SITE_URL`。
 *
 * 每次调用都重新读 `import.meta.env`（而不是在模块顶层读一次）：
 * 顶层读会把它固化下来，测试就没法覆盖两种状态，而"配了 / 没配"两种
 * 都该被测到（与 `apps/landing/src/lib/app-url.ts` 同一条纪律）。
 *
 * @returns 去掉末尾斜杠的绝对地址；未配置或格式不合法时返回 `null`。
 */
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

/**
 * 站点根地址（**不带尾斜杠**）。
 *
 * 优先级：`VITE_SITE_URL` → 当前来源的根（见文件头）。
 * `BASE_URL` 只用来判断"应用挂在什么路径下"，不参与结果 ——
 * 站点永远在来源的根上，不在应用 base 的上一层或下一层。
 */
export function siteRoot(): string {
  return configuredSiteUrl() ?? window.location.origin;
}

/**
 * 站点里某个路径的绝对地址。
 *
 * @param path 以 `/` 开头、**含可能的锚点**（例如 `/help#sync`）。
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
export const HELP_SYNC_ANCHOR = '/help#sync';
