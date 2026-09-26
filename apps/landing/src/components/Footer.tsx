/**
 * 页脚
 * =======
 *
 * 🔴 必须有的那句免责声明：README 里写着
 * 「本仓库为个人项目，与滴答清单/TickTick 及其关联公司无任何关系」。
 * 落地页是**最容易被截图传播**的界面，漏掉这句会让人误以为这是官方产品。
 *
 * ⚠️ 这里原本有三组指向 GitHub 的链接（源码 / 贡献指南 / 路线图 / ADR /
 * 第三方许可证 / 文档索引）。仓库当前是**私有的**，那些链接对任何访客
 * 一律 404 —— 一个「看起来能点、点了是 404」的链接比没有链接更坏，
 * 所以整组摘掉了。加回来的完整清单（别只把图标放回来）见 `Nav.tsx` 顶部。
 *
 * 现在剩下的链接**全部是页内锚点**，所以不再需要
 * `target="_blank"` / `rel="noreferrer"` 那一套。
 */

import { useMemo } from 'react';

import { useI18n } from '@heyta/i18n';

import { BrandMark } from './BrandMark.js';

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
          { label: t('landing.footer.pricing'), href: '#pricing' },
          { label: t('landing.footer.selfHostServer'), href: '#selfhost' },
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
            {/*
              字标与导航用的是**同一个组件**，不是"蓝点 + 文字"的另一种画法。
              之前两处品牌表达不一致（导航是字标、页脚是圆点+文字），
              同一个品牌在一页里出现两种画法是没道理的区别。
              它标了 aria-hidden，所以链接的可访问名由 aria-label 提供。
            */}
            <a className="lp-brand" href="#top" aria-label={t('common.brand')}>
              <BrandMark />
            </a>
            <p className="lp-footer__tagline">{t('landing.footer.tagline')}</p>
          </div>

          {groups.map((group) => (
            <nav key={group.title} className="lp-footer__group" aria-label={group.title}>
              <h3 className="lp-footer__group-title">{group.title}</h3>
              <ul className="lp-footer__links">
                {group.links.map((link) => (
                  <li key={link.label}>
                    <a className="lp-footer__link" href={link.href}>
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="lp-footer__bottom">
          <p>{t('landing.footer.disclaimer')}</p>
          <p>{t('landing.footer.licenseNote')}</p>
        </div>
      </div>
    </footer>
  );
}
