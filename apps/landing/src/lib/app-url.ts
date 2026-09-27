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
 * （当前这台机器上的 `heyta-tmp.litopia.space` 在部署文档里就被标成临时资产）。
 * 写死常量会让"换域名"变成一次改代码 + 改测试；环境变量让它变成一次构建参数。
 *
 * ## 为什么校验，而不是拿到就用
 *
 * 一个拼错的 `VITE_APP_URL`（少了协议、多了空格、被写成 `"undefined"`）
 * 如果在页面上变成一个 `href`，浏览器会把它当成**相对路径**，
 * 用户点下去得到的是当前域名下的一个 404 —— 正是我们要避免的那类谎言。
 * 所以非 `http(s)` 一律当作"没配置"。
 */

import type { MessageKey } from '@heyta/i18n';

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

export function startCta(): StartCta {
  const url = appUrl();
  return url === null
    ? { href: '#selfhost', labelKey: 'landing.cta.selfHost', external: false }
    : { href: url, labelKey: 'landing.cta.useApp', external: true };
}
