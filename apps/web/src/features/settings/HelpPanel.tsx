/** Website content has a single home; this panel only provides browser entry points. */
import { ICON_SIZE } from '@heyta/design-system';
import { ArrowUpRight, BookOpen, ScrollText, Send, Tag } from 'lucide-react';
import { useI18n, type MessageKey } from '@heyta/i18n';
import { OPERATOR } from '@heyta/legal';
import { siteLink } from '../../lib/site-url.js';
import './help-settings.css';

const ENTRIES = [
  { path: '/docs', label: 'web.about.help.label', hint: 'web.about.help.hint', icon: BookOpen },
  { path: '/changelog', label: 'web.about.changelog.label', hint: 'web.about.changelog.hint', icon: ScrollText },
  { path: '/pricing', label: 'web.about.pricing.label', hint: 'web.about.pricing.hint', icon: Tag },
] satisfies readonly { path: string; label: MessageKey; hint: MessageKey; icon: typeof BookOpen }[];

export function HelpPanel(): React.JSX.Element {
  const { t } = useI18n();

  /**
   * 这一行是本算法对外承诺的**投诉/举报入口**（备案材料与九份法律文本都写了它）。
   *
   * 🔴 `mailto` 这一行**不带** `target="_blank"`：Chrome 会先开一个空白标签页
   * 再去拉起邮件客户端，那一片空白读起来就是"点了没反应"。
   * 尾部那支斜箭头也只给站外链接 —— 它承诺的是"打开一个页面"，
   * 而这一行打开的是邮件应用，承诺由文案自己说（`common.feedback.hint`）。
   *
   * 🔴 收件人**不写在界面里**：它取 `OPERATOR.contactEmail`，也就是隐私政策与
   * 个人信息主体权利页对外公示的那一枚。抄一份到这里就允许两份漂移，
   * 而漂移的症状是用户的举报发进一个没人看的信箱。
   */
  const links = [
    ...ENTRIES.map(({ path, label, hint, icon }) => ({
      testId: `about-link-${path.slice(1)}`,
      href: siteLink(path),
      label,
      hint,
      icon,
      site: true,
    })),
    {
      testId: 'about-link-feedback',
      href: `mailto:${OPERATOR.contactEmail}?subject=${encodeURIComponent(t('common.feedback.subject'))}`,
      label: 'common.feedback.label',
      hint: 'common.feedback.hint',
      icon: Send,
      site: false,
    },
  ] satisfies readonly {
    testId: string;
    href: string;
    label: MessageKey;
    hint: MessageKey;
    icon: typeof BookOpen;
    site: boolean;
  }[];

  return (
    <div className="ht-settings__help" data-testid="about-panel">
      <div className="ht-settings__help-links" data-testid="about-links">
        {links.map(({ testId, href, label, hint, icon: Icon, site }) => (
          <a
            key={testId}
            className="ht-settings__help-link"
            data-testid={testId}
            href={href}
            {...(site ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          >
            <span className="ht-settings__help-icon"><Icon size={ICON_SIZE.md} aria-hidden="true" /></span>
            <span className="ht-settings__help-copy">
              <span className="ht-type-row-title">{t(label)}</span>
              <span className="ht-type-row-meta">{t(hint)}</span>
            </span>
            {site ? <ArrowUpRight size={ICON_SIZE.sm} aria-hidden="true" /> : null}
          </a>
        ))}
      </div>
      <p className="ht-settings__help-note ht-type-row-meta">{t('web.about.lead')}</p>
    </div>
  );
}
