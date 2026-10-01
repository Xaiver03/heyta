/**
 * 注册勾选框旁边那两条条款链接（**宿主无关**）
 * =============================================
 *
 * 界面上一句话已经写了很久：「我同意**该服务端**提供的服务条款与隐私政策」
 * （i18n 的 `web.auth.terms.label` / `mobile.auth.terms.label`），但它**从来没有
 * 一个可点开的落点** —— 用户同意的是一份读不到的东西。
 * 《个人信息保护法》第 17 条要求处理规则"公开"，《App 违法违规收集使用个人信息
 * 行为认定方法》第二类把"未公开收集使用规则"直接认定为违法违规，而"公开"可执行的
 * 形态就是链接真能打开。计划与裁决见
 * `docs/plans/legal-compliance-before-filing.md`
 * 的「链 2」与 §5 的 **D-01 / D-09**。
 *
 * ## 🔴 落点按 baseUrl 分流，而不是按"我们自己有没有那份文本"分流
 *
 * 一句"该服务端"决定了链接该指向**那个服务端**发布的规则：
 *
 * | 用户连的是 | 链接指向 | 为什么 |
 * |---|---|---|
 * | 官方托管实例（`heyta.waytofuture.cn`） | 落地页 `/legal/terms/`、`/legal/privacy/` | 那两份**必然**是 heyta 署名的文本 |
 * | 别的 host（自建 / 第三方） | `<baseUrl>/terms.html`、`<baseUrl>/privacy.html` | 服务端把运营者自己放进 `<dataDir>/legal/` 的文件发布在这两条路径上；**没有就是 404** |
 *
 * 第二条那一栏是整件事的关键：**把官方那份政策挂到别人实例的勾选框旁边，
 * 就是替那位运营者作出没有依据的承诺** —— 而隐私政策自己写着"自建部署时对你而言
 * 承担处理者义务的是你，不是 heyta"。所以这里**不许**回落到官方页面，404 是诚实的失败。
 *
 * ## 🔴 不发任何探测请求
 *
 * "先 HEAD 一下 `<baseUrl>/privacy.html`，404 就改指官方页面"是这条链接最自然的写法，
 * 也是**最坏**的写法：勾选框出现在注册表单上，而**同意之前不该发任何一个请求**
 * （那份计划里的 **G-12** 钉的就是这条，探测只会让它更糟）。
 * 分流必须**纯本地**可判定。
 *
 * ## 为什么是纯字符串而不是 `new URL`
 *
 * Hermes 上没有 `URL` 构造器（全仓 `packages/app-host` 与 `apps/mobile` 里
 * `new URL(` 零命中），而这份解析四个壳都要用。主机名提取复用
 * `@heyta/sync-client` 的 `hostFromServerUrl()` —— 它和"这台服务器算不算明文"
 * 判的是**同一件事**，抄第二遍就会漂移（理由见那个函数的注释）。
 */

import { hostFromServerUrl } from '@heyta/sync-client';

import { joinEndpointUrl } from './endpoint-url.js';

/**
 * heyta 官方托管实例的**来源**（scheme + host，不含路径）。
 *
 * 🔴 这一份字符串的事实源是 `packages/legal` 的 `OPERATOR.hostedDomain`，
 * 这里**不能** import 那个包：`@heyta/legal` 是九份对外文本的全量 AST（六千余行），
 * 把它拖进移动端 bundle 只为读一个域名是纯粹的负担。
 * 漂移由 `pnpm check:legal-host` 拦（两边不一致就红，已做过变异验证）。
 *
 * 为什么不是"用应用自己的 origin"（web 的 `site-url.ts` 那套推导）：
 * 那条规则只对 web 壳成立，而移动端连的是用户手填的地址、它自己不在任何来源上。
 * 四个壳必须给出同一个答案，所以这里放一份显式常量，而不是三种推导。
 */
export const OFFICIAL_SITE_ORIGIN = 'https://heyta.waytofuture.cn';

/** 官方实例上，落地页里那两份文本的地址（**带尾斜杠**，与 `apps/landing` 的目录式产物一致）。 */
export const LEGAL_SITE_PATHS = {
  terms: '/legal/terms/',
  privacy: '/legal/privacy/',
} as const;

/** 服务端给**运营者自己**发布的条款留的两条路径（见 `server/src/server.ts` 的 `installOperatorLegalPages`）。 */
export const OPERATOR_LEGAL_PATHS = {
  terms: '/terms.html',
  privacy: '/privacy.html',
} as const;

/**
 * 落地页的非默认语言前缀。
 *
 * ⚠️ 只认 `/en` 整段：这是 `apps/landing/src/site/paths.ts` 里 `stripLocalePrefix()`
 * 认的**同一条**规则的两面（那边解析、这边生成）。落地页目前只有中英两版，
 * 加第三种语言时**两处都要动** —— 单边改动会让新语言的条款页变成 404。
 */
const SITE_LOCALE_PREFIX: Readonly<Record<string, string>> = { en: '/en' };

export interface LegalLinks {
  /** 《服务条款》。 */
  readonly terms: string;
  /** 《隐私政策》。 */
  readonly privacy: string;
}

/** 用户还没填地址（或填成全空白）时没有"该服务端"可指 —— 返回 `null`，界面不渲染链接。 */
export function resolveLegalLinks(baseUrl: string, locale?: string): LegalLinks | null {
  const trimmed = baseUrl.trim();
  if (trimmed === '') return null;

  const host = hostFromServerUrl(trimmed);
  if (host !== '' && host === hostFromServerUrl(OFFICIAL_SITE_ORIGIN)) {
    const prefix = SITE_LOCALE_PREFIX[locale?.toLowerCase() ?? ''] ?? '';
    return {
      terms: `${OFFICIAL_SITE_ORIGIN}${prefix}${LEGAL_SITE_PATHS.terms}`,
      privacy: `${OFFICIAL_SITE_ORIGIN}${prefix}${LEGAL_SITE_PATHS.privacy}`,
    };
  }

  // 非官方 host：地址由运营者提供。没写 scheme 时按**明文**补齐 —— 与
  // `classifyTransportSecurity()` 把无 scheme 视为明文的口径一致（同一个判断不许有两套答案），
  // 而链接打不开时得到的是一个诚实的 404，不是一份别人的政策。
  const base = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`;
  return {
    terms: joinEndpointUrl(base, OPERATOR_LEGAL_PATHS.terms),
    privacy: joinEndpointUrl(base, OPERATOR_LEGAL_PATHS.privacy),
  };
}
