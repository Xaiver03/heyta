/**
 * `/signin`：登录
 * =================
 *
 * 🔴 **这是一页出口，不是一段说明**（2026-10-03 的产品负责人实测）。
 *
 * 原来这一页排着两张"方式卡"、一节「为什么登录在应用里」、一节「通行密钥丢了？」，
 * 末尾还有一条「⚠️ 为什么没有邮箱 + 密码」。两个问题叠在一起：
 *
 * 1. 想登录的人点开「登录」，先读的是一段**关于**登录的阅读材料。
 *    说明文字的位置是文档中心，不是行动点的对面 —— 于是"为什么认证在应用里"
 *    整段搬进了 `site.docs.account.s5`（那一篇本来就讲登录方式）。
 * 2. 那段说明里写着"只有两种进入方式，没有密码"，而产品的主路是**邮箱 + 口令**。
 *    这不是措辞问题，是对访客说了不成立的话（`check:claims` 那一类）。
 *
 * 所以这一页现在只做三件事：给出**去应用登录**的出口、在配了应用地址时给出
 * **找回通行密钥**的出口、指一条去文档中心的链接。没有正文。
 *
 * 🔴 认证 UI 为什么仍然不在这里（依据 D5）：它要用的服务端地址**就是**同步设置里
 * 那个地址，在这里再放一套表单会出现"对着 A 登录、令牌存到 B"的错位。
 * 这条理由现在写在文档中心，而不是写在这一页上 —— 它回答的是"为什么点完会跳走"，
 * 而那是一个人**先撞上这件事、之后才会去查**的问题。
 *
 * ⚠️ 没配 `VITE_APP_URL` 时**不猜地址**：主行动退回首页的自建那一节，
 * 找回那一条整条不渲染（一个指向不存在应用的链接点下去是 404，比没有出口更坏）。
 */

import { useI18n, useLocale } from '@heyta/i18n/provider';

import { appPathHref, signInHref, startCta, type StartCta } from '../lib/app-url.js';
import { PageHead } from '../site/PageSections.js';
import { pageById, type SitePage } from '../site/pages.js';
import { siteHref } from '../site/paths.js';

/**
 * 找回通行密钥那张页面的路径。
 *
 * 🔴 它是**服务端渲染**的页面（`server/src/pages.ts`），住在**域名的根**上，
 * 不在 `/app/` 下 —— 所以地址是"应用地址的来源 + 这条路径"，
 * 由 `appPathHref()` 算。见 `docs/runbooks/deployment.md` §3.3.1。
 */
const RECOVER_PATH = '/recover-passkey';

export function SigninPage({ page }: { page: SitePage }): React.JSX.Element {
  const { t } = useI18n();
  const locale = useLocale();

  /**
   * 主行动：配了应用就是「去应用登录 → 应用（带 `?signin`，面板当场打开）」，
   * 没配就退回 `startCta()` 那一条（「开始自建 → #selfhost」）。
   *
   * ⚠️ 复用 `StartCta` 这个形状而不是另发明一个：它的三个字段（`href` /
   * `labelKey` / `external`）正是"外链必须带 `rel`"这条判据要的三个读数。
   */
  const appSignin = signInHref(locale);
  const cta: StartCta =
    appSignin === null
      ? startCta(locale)
      : { href: appSignin, labelKey: 'site.signin.cta', external: true };

  const recoverHref = appPathHref(RECOVER_PATH);

  return (
    <>
      {/*
        `cta={false}`：页头那颗走的是 `siteCta`（「立即使用」→ 应用根），
        而这一页的主行动是「去应用登录」（→ 应用 + 打开认证面板）。
        两颗并排会让访客挑错，而它们说的本来就不是同一件事。
      */}
      <PageHead page={page} cta={false} />

      <div className="lp-section">
        <p className="lp-page__cta">
          <a
            className="lp-btn lp-btn--primary"
            href={cta.href}
            {...(cta.external ? { rel: 'noopener noreferrer' } : {})}
          >
            {t(cta.labelKey)}
          </a>
        </p>

        {recoverHref === null ? null : (
          <p className="lp-page__cta">
            <a className="lp-btn lp-btn--secondary" href={recoverHref} rel="noopener noreferrer">
              {t('site.signin.recover.link')}
            </a>
          </p>
        )}

        <p className="lp-note">
          <a className="lp-link" href={siteHref(pageById('account'), locale)}>
            {t('site.signin.helpLink')}
          </a>
        </p>
      </div>
    </>
  );
}
