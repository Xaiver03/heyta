/**
 * 页脚
 * =======
 *
 * 🔴 必须有的那句免责声明：README 里写着
 * 「本仓库为个人项目，与滴答清单/TickTick 及其关联公司无任何关系」。
 * 落地页是**最容易被截图传播**的界面，漏掉这句会让人误以为这是官方产品。
 */

import { useMemo } from 'react';
import { Github } from 'lucide-react';

import { useI18n } from '@heyta/i18n';

import { GITHUB_URL } from './Nav.js';

export function Footer(): React.JSX.Element {
  const { t } = useI18n();

  // 数据挪进组件内是文案迁移的硬要求（模块级拿不到 `t`）。取舍见 `Landing.tsx` 文件头。
  const groups = useMemo<{ title: string; links: { label: string; href: string }[] }[]>(
    () => [
      {
        title: t('landing.footer.group.product'),
        links: [
          { label: t('landing.nav.capabilities'), href: '#capabilities' },
          { label: t('landing.nav.showcase'), href: '#showcase' },
          { label: t('landing.footer.syncHow'), href: '#sync' },
          { label: t('landing.footer.privacy'), href: '#privacy' },
        ],
      },
      {
        title: t('landing.footer.group.gettingStarted'),
        links: [
          { label: t('landing.footer.selfHostServer'), href: '#selfhost' },
          {
            label: t('landing.footer.deployGuide'),
            href: `${GITHUB_URL}/blob/main/docs/runbooks/local-server-verification.md`,
          },
          { label: t('landing.footer.contributing'), href: `${GITHUB_URL}/blob/main/CONTRIBUTING.md` },
          { label: t('landing.footer.source'), href: GITHUB_URL },
        ],
      },
      {
        title: t('landing.footer.group.docs'),
        links: [
          { label: t('landing.footer.roadmap'), href: `${GITHUB_URL}/blob/main/docs/plans/roadmap.md` },
          { label: t('landing.footer.adr'), href: `${GITHUB_URL}/tree/main/docs/adr` },
          {
            label: t('landing.footer.licenses'),
            href: `${GITHUB_URL}/blob/main/THIRD_PARTY_LICENSES.md`,
          },
          { label: t('landing.footer.docsIndex'), href: `${GITHUB_URL}/blob/main/docs/README.md` },
        ],
      },
    ],
    [t],
  );

  return (
    <footer className="lp-footer">
      <div className="lp-wrap">
        <div className="lp-footer__grid">
          <div className="lp-footer__brand">
            <a className="lp-brand" href="#top">
              <span className="lp-brand__dot" aria-hidden="true" />
              {t('common.brand')}
            </a>
            <p className="lp-footer__tagline">
              {t('landing.footer.tagline')}
            </p>
            <a className="lp-link" href={GITHUB_URL} target="_blank" rel="noreferrer noopener">
              <Github size={16} aria-hidden="true" />
              {t('landing.footer.viewOnGithub')}
            </a>
          </div>

          {groups.map((group) => (
            <nav key={group.title} className="lp-footer__group" aria-label={group.title}>
              <h3 className="lp-footer__group-title">{group.title}</h3>
              <ul className="lp-footer__links">
                {group.links.map((link) => (
                  <li key={link.label}>
                    <a
                      className="lp-footer__link"
                      href={link.href}
                      {...(link.href.startsWith('#') ? {} : { target: '_blank', rel: 'noreferrer noopener' })}
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="lp-footer__bottom">
          <p>
            {t('landing.footer.disclaimer')}
          </p>
          <p>{t('landing.footer.licenseNote')}</p>
        </div>
      </div>
    </footer>
  );
}
