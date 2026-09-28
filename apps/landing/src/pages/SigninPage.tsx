/**
 * `/signin`：登录
 * =================
 *
 * 🔴 **这是一个跳板页，不是登录表单**（依据 D5）。
 *
 * 认证 UI 本来就在应用里（开在同步设置内部），而它要用的服务端地址
 * **就是同步设置里的那个地址** —— 在这里再放一套表单，就会出现
 * "对着 A 登录、令牌存到 B"这种极难排查的错位。所以这一页只做三件事：
 * 说清支持哪些方式、说明为什么认证在应用里、指出找不回通行密钥时该去哪。
 *
 * 页面顶部那个行动点（`PageHead` 里的）就是入口：没配 `VITE_APP_URL` 时
 * 它指向首页的自建那一节，配了就直接进应用。
 *
 * ⚠️ 这里**没有**"邮箱 + 密码"表单，理由写在 `site.signin.noPassword` 里 ——
 * 它作为页末说明渲染，而不是塞进正文：它是对一页缺席东西的解释，
 * 放在最后才不会打断"怎么进去"这条主线。
 */

import { useI18n } from '@heyta/i18n';

import { appPathHref } from '../lib/app-url.js';
import { KeyText, PageHead, PageSections, RichText } from '../site/PageSections.js';
import { SIGNIN_METHODS } from '../site/content.js';
import type { MessageKey } from '@heyta/i18n';
import type { SitePage } from '../site/pages.js';

/**
 * 找回通行密钥那张页面的路径。
 *
 * 🔴 它是**服务端渲染**的页面（`server/src/pages.ts`），住在**域名的根**上，
 * 不在 `/app/` 下 —— 所以地址是"应用地址的来源 + 这条路径"，
 * 由 `appPathHref()` 算。见 `docs/runbooks/deployment.md` §3.3.1。
 */
const RECOVER_PATH = '/recover-passkey';

/** 「为什么登录在应用里」与「通行密钥丢了怎么办」两节，按 key 排。 */
const SECTIONS = [
  { id: 'why-in-app', titleKey: 'site.signin.why.title', bodyKeys: ['site.signin.why.body'] },
  {
    id: 'recover',
    titleKey: 'site.signin.recover.title',
    bodyKeys: ['site.signin.recover.body'],
  },
] as const satisfies readonly { id: string; titleKey: MessageKey; bodyKeys: readonly MessageKey[] }[];

export function SigninPage({ page }: { page: SitePage }): React.JSX.Element {
  const { t } = useI18n();
  /**
   * 找回入口。**没配 `VITE_APP_URL` 时是 `null`，那时不渲染任何东西** ——
   * 与「立即使用」同一条判据：一个猜出来的地址点下去是 404，比没有入口更坏。
   */
  const recoverHref = appPathHref(RECOVER_PATH);

  return (
    <>
      <PageHead page={page} />
      <div className="lp-section">
        <PageSections sections={SECTIONS}>
          {/* 两种方式并排：它们是**同一个意图的两条路**，不是两个推荐等级 */}
          <ul className="lp-methods">
            {SIGNIN_METHODS.map((method) => (
              <li key={method.titleKey} className="lp-methods__item">
                <h3 className="lp-methods__title">
                  <KeyText messageKey={method.titleKey} />
                </h3>
                <p className="lp-prose">
                  <KeyText messageKey={method.bodyKey} />
                </p>
              </li>
            ))}
          </ul>

          {recoverHref === null ? null : (
            // 🔴 这一段是**说出"怎么点"**，不是把恢复流程复制到站点上：
            // 真正发信、注册新凭据的页面是服务端那张（`/recover-passkey`），
            // 而在站点上再做一个表单就会出现"对着 A 提交、令牌存到 B"。
            <p className="lp-page__cta">
              <a className="lp-btn lp-btn--secondary" href={recoverHref}>
                {t('site.signin.recover.link')}
              </a>
            </p>
          )}

          <p className="lp-note">
            <RichText text={t('site.signin.noPassword')} />
          </p>
        </PageSections>
      </div>
    </>
  );
}
