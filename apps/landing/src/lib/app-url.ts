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

import type { Locale, MessageKey } from '@heyta/i18n/provider';

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
 * 把落地页的语言**带进应用** —— 两种语言都带，包括默认语言。
 *
 * 🔴 不这样做会留下一个真实的尴尬：访客在**英文**落地页上读完、点「Use it now」，
 * 落到的却是**中文**界面。原因是两边判断语言的依据不同 ——
 * 落地页由 URL 决定（要 SEO），应用由自己的偏好存储决定（`apps/web/src/lib/locale.ts`）。
 * 这是 `docs/plans/roadmap.md` §5.1 留下的两条保留之一。
 *
 * ## 为什么"默认语言不带参数"这条捷径在 2026-10-03 被撤掉
 *
 * 它原来的理由是"应用在没有任何偏好时本来就是默认语言，带了只是噪音"。
 * 那个前提死于 `0aa6cb0e`（10-01 15:33，P1-1 把首启语言解析链收进 i18n 与两个壳）：
 * 应用的解析链现在是 **显式存储 > `?lang=` > 系统语言**，第三层是新加的。
 * 于是"没有偏好"不再等于"默认语言"，而是等于"访客的浏览器语言" ——
 * 一个用英文浏览器读**中文**落地页的人点「立即使用」，会被静默换成英文界面。
 * 这正是这条函数要避免的那件事，只是换了方向，而方向换了没人报警：
 * 线上 `live-site/live-domain.spec.ts:96`（标题就叫"中文落地页 → 应用"）
 * 红在等中文输入框超时，而截图里应用是**英文**的（`live-app-after-cta.png`）。
 *
 * ⚠️ 带参数**不会**盖掉用户已经选过的语言：解析链里显式存储排在 `?lang=` 前面，
 * 而首启经系统语言推断出来的那个值**不算**显式存储（见 `locale.ts` 里那条注释）。
 * 所以这条改动只影响"第一次从落地页进来"这一件事，不影响回头客。
 */
const LANG_PARAM = 'lang';

function withLocale(url: string, locale: Locale): string {
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
 * 「登录」这个意图：带 `?signin` 进应用，让应用**把认证面板直接打开**。
 *
 * 🔴 2026-10-03 的改动。在此之前它落在站内 `/signin/` 那张页面上，而那张页面的
 * 第一屏是三段解释（为什么认证在应用里 / 两种方式 / 找回通行密钥）——
 * 访客点"登录"却先读到一篇说明。产品负责人实测后否掉了这个形状。
 * 认证 UI 仍然**只在应用里**（地址与令牌必须同源，否则会出现"对着 A 登录、令牌存到 B"），
 * 这条没变；变的是入口。解释的内容搬进了文档中心那篇《账号、令牌与登录方式》。
 *
 * ⚠️ `signin` 这个字面量与 `apps/web/src/lib/auth-deep-link.ts` 里那条是**同一份值的两份抄件**
 *   （落地页不能依赖 `@heyta/domain`，那会把整个领域包打进落地页的 bundle）。
 *   钉它们相等的是 `apps/landing/tests/render.spec.tsx` —— 漂移会在 CI 里红，
 *   而不是在用户点了没反应时才被发现。
 *
 * @returns 绝对地址；**未配置应用地址时返回 `null`**，调用方据此退回站内那张页面。
 */
const SIGNIN_PARAM = 'signin';

export function signInHref(locale: Locale): string | null {
  const url = appUrl();
  if (url === null) return null;
  const parsed = new URL(withLocale(url, locale));
  parsed.searchParams.set(SIGNIN_PARAM, '1');
  return parsed.toString();
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
