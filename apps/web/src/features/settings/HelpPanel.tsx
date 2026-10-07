/** Website content has a single home; this panel only provides browser entry points. */
import { ICON_SIZE } from '@heyta/design-system';
import { ArrowUpRight, BookOpen, ScrollText, Tag } from 'lucide-react';
import { useI18n, type MessageKey } from '@heyta/i18n';
import { siteLink } from '../../lib/site-url.js';
import './help-settings.css';

const ENTRIES = [
  { path: '/docs', label: 'web.about.help.label', hint: 'web.about.help.hint', icon: BookOpen },
  { path: '/changelog', label: 'web.about.changelog.label', hint: 'web.about.changelog.hint', icon: ScrollText },
  { path: '/pricing', label: 'web.about.pricing.label', hint: 'web.about.pricing.hint', icon: Tag },
] satisfies readonly { path: string; label: MessageKey; hint: MessageKey; icon: typeof BookOpen }[];

export function HelpPanel(): React.JSX.Element {
  const { t } = useI18n();
  return (
    <div className="ht-settings__help" data-testid="about-panel">
      <div className="ht-settings__help-links" data-testid="about-links">
        {ENTRIES.map(({ path, label, hint, icon: Icon }) => (
          <a
            key={path}
            className="ht-settings__help-link"
            data-testid={`about-link-${path.slice(1)}`}
            href={siteLink(path)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className="ht-settings__help-icon"><Icon size={ICON_SIZE.md} aria-hidden="true" /></span>
            <span className="ht-settings__help-copy">
              <span className="ht-type-row-title">{t(label)}</span>
              <span className="ht-type-row-meta">{t(hint)}</span>
            </span>
            <ArrowUpRight size={ICON_SIZE.sm} aria-hidden="true" />
          </a>
        ))}
      </div>
      <p className="ht-settings__help-note ht-type-row-meta">{t('web.about.lead')}</p>
    </div>
  );
}
