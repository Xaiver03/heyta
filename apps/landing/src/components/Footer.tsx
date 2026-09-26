/**
 * 页脚
 * =======
 *
 * 🔴 必须有的那句免责声明：README 里写着
 * 「本仓库为个人项目，与滴答清单/TickTick 及其关联公司无任何关系」。
 * 落地页是**最容易被截图传播**的界面，漏掉这句会让人误以为这是官方产品。
 */

import { Github } from 'lucide-react';

import { GITHUB_URL } from './Nav.js';

const GROUPS: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: '产品',
    links: [
      { label: '能力', href: '#capabilities' },
      { label: '界面', href: '#showcase' },
      { label: '同步怎么工作', href: '#sync' },
      { label: '隐私', href: '#privacy' },
    ],
  },
  {
    title: '上手',
    links: [
      { label: '自建服务端', href: '#selfhost' },
      { label: '部署与验收步骤', href: `${GITHUB_URL}/blob/main/docs/runbooks/local-server-verification.md` },
      { label: '参与贡献', href: `${GITHUB_URL}/blob/main/CONTRIBUTING.md` },
      { label: '源代码', href: GITHUB_URL },
    ],
  },
  {
    title: '文档',
    links: [
      { label: '总路线图', href: `${GITHUB_URL}/blob/main/docs/plans/roadmap.md` },
      { label: '架构决策记录', href: `${GITHUB_URL}/tree/main/docs/adr` },
      { label: '第三方许可证', href: `${GITHUB_URL}/blob/main/THIRD_PARTY_LICENSES.md` },
      { label: '文档索引', href: `${GITHUB_URL}/blob/main/docs/README.md` },
    ],
  },
];

export function Footer(): React.JSX.Element {
  return (
    <footer className="lp-footer">
      <div className="lp-wrap">
        <div className="lp-footer__grid">
          <div className="lp-footer__brand">
            <a className="lp-brand" href="#top">
              <span className="lp-brand__dot" aria-hidden="true" />
              heyta
            </a>
            <p className="lp-footer__tagline">
              本地优先的任务管理。数据先落本地，云端只是同步通道。
            </p>
            <a className="lp-link" href={GITHUB_URL} target="_blank" rel="noreferrer noopener">
              <Github size={16} aria-hidden="true" />
              在 GitHub 上查看
            </a>
          </div>

          {GROUPS.map((group) => (
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
            个人项目，与滴答清单 / TickTick 及其关联公司无任何关系。
          </p>
          <p>heyta 采用 MIT 许可证；第三方代码归属逐项登记在 THIRD_PARTY_LICENSES.md。</p>
        </div>
      </div>
    </footer>
  );
}
