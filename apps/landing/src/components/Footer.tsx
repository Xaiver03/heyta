import { ICON_SIZE } from '@heyta/design-system';
/**
 * 页脚
 * =======
 *
 * 🔴 必须有的那句免责声明：README 里写着
 * 「本仓库为个人项目，与滴答清单/TickTick 及其关联公司无任何关系」。
 * 落地页是**最容易被截图传播**的界面，漏掉这句会让人误以为这是官方产品。
 *
 * ⚠️ 这里原本有三组指向 GitHub 的链接（源码 / 贡献指南 / 路线图 / ADR /
 * 第三方许可证 / 文档索引）。仓库私有时期它们一律 404，整组被摘掉过；
 * **2026-09-29 仓库转公开**，恢复为一个「文档」组 + 品牌列的「在 GitHub 上查看」。
 * 每个链接的目标都在公开仓库 main 上逐一验过 200 —— 死链接比没有链接更坏。
 * 恢复清单见 `Nav.tsx` 文件头；地址唯一化在 `lib/repo.ts`。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 **分组与链接同样来自站点注册表**（`footerGroups()`），与导航同源。
 *
 * 页脚是"可达性"的最后一道保险：某些页面（更新日志 / 登录）**故意不进导航**
 * —— 导航栏是给第一次来的访客用的 —— 但它们在页脚里一定有一条。
 * 于是"页面上有但没人链得到"这件事在结构上不可能发生：见
 * `src/site/pages.ts` 的文件头。判据本身住在 `render.spec.tsx` 的 N2 用例里
 * （从渲染出的 DOM 走可达性），**不是**一个独立的 `check:site-reachability` 脚本 ——
 * 那个脚本截至 2026-09-28 尚未落地（见计划 §9 与 ADR-0033 §5）。
 *
 * ⚠️ 空分组**不渲染**：一个只有标题、没有链接的分组看起来像渲染坏了。
 * 法律组（Terms / Privacy / License）现在就是空的 —— 依据 A6-1，
 * 链接要等**线上真的能打开**再加（404 的法务链接比没有更坏）。
 */

import { Github } from 'lucide-react';

import { useI18n, useLocale, type MessageKey } from '@heyta/i18n/provider';

import { GITHUB_URL, SELF_HOST_GUIDE_URL } from '../lib/repo.js';
import { footerGroups, pageById, type SiteGroup } from '../site/pages.js';
import { siteHref } from '../site/paths.js';
import { BrandMark } from './BrandMark.js';

/**
 * 「文档」分组：指向**公开仓库**的文档。它与注册表分组（站点页面）分开写 ——
 * 注册表管的是"站点有哪些页面"，这些是仓库资源，不是页面；混进注册表
 * 会让 `footerGroups()` 的类型与 N2 可达性判据都要为外链开洞。
 * 🔴 每条路径在公开仓库 main 上验过 200 才准进这张表（见文件头）。
 *
 * ⚠️ 这张表存**完整地址**而不是"仓库根 + 路径片段"：自建指南的路径已有唯一
 * 事实源 `SELF_HOST_GUIDE_URL`，在这里再抄一遍片段就等于允许"指南搬家"只改一处
 * —— 而漏掉的那一处表现为链接 404。
 */
const DOCS_LINKS: readonly { key: MessageKey; href: string }[] = [
  { key: 'landing.footer.source', href: GITHUB_URL },
  { key: 'landing.footer.contributing', href: `${GITHUB_URL}/blob/main/CONTRIBUTING.md` },
  { key: 'landing.footer.deployGuide', href: SELF_HOST_GUIDE_URL },
  { key: 'landing.footer.roadmap', href: `${GITHUB_URL}/blob/main/docs/plans/roadmap.md` },
  { key: 'landing.footer.adr', href: `${GITHUB_URL}/tree/main/docs/adr` },
  { key: 'landing.footer.licenses', href: `${GITHUB_URL}/blob/main/THIRD_PARTY_LICENSES.md` },
  { key: 'landing.footer.docsIndex', href: `${GITHUB_URL}/blob/main/docs/README.md` },
];

/**
 * 分组的标题词条。`SiteGroup` 的三个取值与词条表一一对应。
 *
 * 🔴 参数类型用**注册表导出的 `SiteGroup`**，不在这里再抄一遍
 * `'product' | 'support' | 'legal'`（R18）—— 加一个分组时，抄的那份不会跟着变，
 * 而它恰好是"分组标题该取哪条词条"的唯一依据。
 */
function groupTitleKey(group: SiteGroup): MessageKey {
  return `site.footer.group.${group}`;
}

/**
 * 页脚**不需要知道当前是哪一页**：它每一条都是站点绝对地址
 * （`siteHref(page, locale)`），没有一处依赖"我在哪"。
 * 收一个 `page` 参数只会让下一个人以为它有用。
 */
export function Footer(): React.JSX.Element {
  const { t } = useI18n();
  const locale = useLocale();

  return (
    <footer className="lp-footer">
      <div className="lp-wrap">
        <div className="lp-footer__grid">
          <div className="lp-footer__brand">
            {/*
              字标与导航用的是**同一个组件**，不是"蓝点 + 文字"的另一种画法。
              之前两处品牌表达不一致（导航是字标、页脚是圆点+文字），
              同一个品牌在一页里出现两种画法是没道理的区别。
              它标了 aria-hidden，所以链接的可访问名由 aria-label 提供。

              🔴 落点是首页，与导航里的字标同一判据（`#top` 只在首页存在）。
            */}
            <a
              className="lp-brand"
              href={siteHref(pageById('home'), locale)}
              aria-label={t('common.brand')}
            >
              <BrandMark />
            </a>
            <p className="lp-footer__tagline">{t('landing.footer.tagline')}</p>
            <a
              className="lp-footer__link lp-footer__github"
              href={GITHUB_URL}
              rel="noopener noreferrer"
            >
              <Github size={ICON_SIZE.sm} aria-hidden="true" />
              {t('landing.footer.viewOnGithub')}
            </a>
          </div>

          {footerGroups().map((entry) => {
            const title = t(groupTitleKey(entry.group));
            return (
              <nav key={entry.group} className="lp-footer__group" aria-label={title}>
                <h3 className="lp-footer__group-title">{title}</h3>
                <ul className="lp-footer__links">
                  {entry.pages.map((target) => (
                    <li key={target.id}>
                      <a className="lp-footer__link" href={siteHref(target, locale)}>
                        {t(target.labelKey)}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            );
          })}

          <nav className="lp-footer__group" aria-label={t('landing.footer.group.docs')}>
            <h3 className="lp-footer__group-title">{t('landing.footer.group.docs')}</h3>
            <ul className="lp-footer__links">
              {DOCS_LINKS.map((link) => (
                <li key={link.key}>
                  <a
                    className="lp-footer__link"
                    href={link.href}
                    rel="noopener noreferrer"
                  >
                    {t(link.key)}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <div className="lp-footer__bottom">
          <p>{t('landing.footer.disclaimer')}</p>
          <p>{t('landing.footer.licenseNote')}</p>
        </div>
      </div>
    </footer>
  );
}
