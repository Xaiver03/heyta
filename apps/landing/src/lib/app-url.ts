/**
 * 「应用在哪」的唯一事实源
 * ==========================
 *
 * 🔴 这个文件补的是用户旅程上最后一个断点：**访客没有任何入口能真正打开应用**。
 *
 * 在此之前，整页的「开始使用」意图（英雄区 / 定价免费档 / 收尾 CTA）全都落在
 * `#selfhost` 上，而自建区的第一步是一行占位命令（仓库私有），
 * 并配了一句诚实的说明「源码尚未公开」。也就是说：页面从不说谎，
 * 但**读完的人也没法开始用**。
 *
 * 现在把「应用地址」抽成一个构建期变量。运维真的把应用部署起来之后，
 * 只要用 `VITE_APP_URL` 构建一次，三个 CTA 就同时变成指向应用的
 * 「立即使用」；没配置时**逐字退回今天的行为**（仍然指向自建那一节），
 * 不会出现"按钮说能用、点了是 404"。
 *
 * ## 为什么用环境变量而不是写死常量
 *
 * 应用部署在哪个域名是**运维/业务决定**，不是产品决定，而且它会变
 * —— 2026-09-27 就真的变了一次（`heyta-tmp.litopia.space` → `heyta.finlaw.cloud`），
 * 而那次迁移**没有改这个文件的一行代码**，只重建了落地页：这正是这条设计的兑现。
 * 写死常量会让"换域名"变成一次改代码 + 改测试；环境变量让它变成一次构建参数。
 *
 * ## 为什么校验，而不是拿到就用
 *
 * 一个拼错的 `VITE_APP_URL`（少了协议、多了空格、被写成 `"undefined"`）
 * 如果在页面上变成一个 `href`，浏览器会把它当成**相对路径**，
 * 用户点下去得到的是当前域名下的一个 404 —— 正是我们要避免的那类谎言。
 * 所以非 `http(s)` 一律当作"没配置"。
 */

import { DEFAULT_LOCALE, type Locale, type MessageKey } from '@heyta/i18n/provider';

/**
 * 读到并校验构建期的 `VITE_APP_URL`。
 *
 * 每次调用都重新读 `import.meta.env`（而不是在模块顶层读一次）：
 * 顶层读会把它固化下来，测试就没法用 `vi.stubEnv` 覆盖两种状态，
 * 而"配置了 / 没配置"这两种状态**都必须被测到**（见 `tests/app-url.spec.ts`）。
 *
 * @returns 去掉末尾斜杠的绝对地址；未配置或格式不合法时返回 `null`。
 */
export function appUrl(): string | null {
  const raw: unknown = import.meta.env.VITE_APP_URL;
  if (typeof raw !== 'string') return null;

  const trimmed = raw.trim().replace(/\/+$/, '');
  if (trimmed === '') return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

  return trimmed;
}

/**
 * 把落地页的语言**带进应用**。
 *
 * 🔴 不这样做会留下一个真实的尴尬：访客在**英文**落地页上读完、点「Use it now」，
 * 落到的却是**中文**界面。原因是两边判断语言的依据不同 ——
 * 落地页由 URL 决定（要 SEO），应用由自己的偏好存储决定（`apps/web/src/lib/locale.ts`）。
 * 这是 `docs/plans/roadmap.md` §5.1 留下的两条保留之一。
 *
 * 默认语言**不带参数**：应用在没有任何偏好时本来就是默认语言，
 * 带上只会给每个链接加一段噪音，也让 `lang=` 失去"这条链接特意指定了语言"的含义。
 */
const LANG_PARAM = 'lang';

function withLocale(url: string, locale: Locale): string {
  if (locale === DEFAULT_LOCALE) return url;
  // 用 `URL` 拼而不是字符串相加：`VITE_APP_URL` 自己可能带查询串
  // （例如带一个灰度参数），手拼 `?`/`&` 会在那种情况下生成坏地址。
  const parsed = new URL(url);
  parsed.searchParams.set(LANG_PARAM, locale);
  return parsed.toString();
}

/**
 * 应用**自己**提供的某个路径的绝对地址（服务端渲染的页面，不在 `/app/` 下）。
 *
 * 🔴 为什么要按路径拼而不是把整条地址写进常量：`/recover-passkey`、`/verify-email`、
 * `/magic-login` 这三张是**服务端渲染**的页面，住在**域名的根**上
 * （`docs/runbooks/deployment.md` §3.3.1 的 nginx 段），而 `/app/` 只是应用产物。
 * 所以"站点上的这个链接指向哪"= `VITE_APP_URL` 的**来源** + 这条路径。
 * 把整条绝对地址写成常量，换域名时就会漏掉它（而漏掉的表现是 404）。
 *
 * @returns 绝对地址；**未配置应用地址时返回 `null`** —— 调用点据此**不渲染**
 *   那个链接。这与 `startCta()` 的取舍是同一条：一个猜出来的地址点下去是 404，
 *   比没有这个入口更坏。
 */
export function appPathHref(path: string): string | null {
  const url = appUrl();
  if (url === null) return null;
  return new URL(path.startsWith('/') ? path : `/${path}`, url).toString();
}

/**
 * 「开始使用」这个意图该指向哪。
 *
 * 全页**只有这一个**意图对应**一个**标签（见 `FinalCta.tsx` 顶部）：
 * 配了应用地址就是「立即使用 → 应用」，没配就是「开始自建 → #selfhost」。
 * 两种状态各有各的诚实说法，但**始终是同一个意图**。
 */
export interface StartCta {
  /** `href`。配了应用就是绝对外链，没配就是站内锚点。 */
  readonly href: string;
  /** 标签词条。调用方用 `t(cta.labelKey)` 取文案。 */
  readonly labelKey: MessageKey;
  /** 是否是外链 —— 外链必须带 `rel="noopener noreferrer"`。 */
  readonly external: boolean;
}

/**
 * @param locale 当前页面的语言。**必须显式传入**，不从路径里偷偷读 ——
 *   隐式读取会让这个函数依赖 `window.location`，而"英文页 / 中文页"两种状态的
 *   测试就得去 stub 全局对象，那时测试断的是 stub 而不是真实判据。
 */
export function startCta(locale: Locale): StartCta {
  const url = appUrl();
  return url === null
    ? { href: '#selfhost', labelKey: 'landing.cta.selfHost', external: false }
    : { href: withLocale(url, locale), labelKey: 'landing.cta.useApp', external: true };
}
