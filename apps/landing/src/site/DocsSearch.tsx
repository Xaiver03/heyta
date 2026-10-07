/** One shared search for questions, articles and their sections on every docs page. */
import { useMemo, useState } from 'react';
import { ICON_SIZE } from '@heyta/design-system';
import { useI18n, useLocale } from '@heyta/i18n/provider';
import { Search, X } from 'lucide-react';
import { helpSearchResults, filterHelpSearchResults, helpSearchHref } from './help-search.js';
import { pageById } from './pages.js';
const MAX_RESULTS = 8;

export function DocsSearch(): React.JSX.Element {
  const { t } = useI18n();
  const locale = useLocale();
  const [query, setQuery] = useState('');

  const results = useMemo(() => helpSearchResults(), []);
  const matched = useMemo(() => filterHelpSearchResults(results, query, t), [results, query, t]);
  const hub = pageById('help');

  const shown = matched.slice(0, MAX_RESULTS);
  const hasQuery = query.trim() !== '';
  const resultsId = 'lp-docs-search-results';

  return (
    <div className="lp-docs__search" role="search">
      <div className="lp-docs__search-field">
        <Search className="lp-docs__search-icon" size={ICON_SIZE.sm} aria-hidden="true" />
        <input
          className="lp-docs__search-input"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label={t('site.docs.search.label')}
          placeholder={t('site.docs.search.placeholder')}
          aria-controls={resultsId}
          aria-expanded={hasQuery}
        />
        {hasQuery ? (
          <button
            type="button"
            className="lp-docs__search-clear"
            aria-label={t('site.docs.search.clear')}
            onClick={() => setQuery('')}
          >
            <X size={ICON_SIZE.xs} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {hasQuery ? (
        <div
          id={resultsId}
          className="lp-docs__search-results"
          role="region"
          aria-label={t('site.docs.search.label')}
          aria-live="polite"
          aria-atomic="true"
        >
          <p className="lp-docs__search-count lp-sr-only">
            {t('site.docs.search.results', { count: matched.length })}
          </p>
          {matched.length === 0 ? (
            <p className="lp-docs__search-empty">{t('site.docs.search.none')}</p>
          ) : (
            <ul className="lp-docs__search-list">
              {shown.map((row) => (
                <li key={row.id}>
                  <a
                    className="lp-docs__search-link"
                    href={helpSearchHref(row, hub, locale)}
                    data-kind={row.kind}
                    {...(row.kind === 'section' ? { 'data-section': 'true' as const } : {})}
                  >
                    <span className="lp-docs__search-title">{t(row.titleKey)}</span>
                    {row.kind === 'section' ? (
                      <span className="lp-docs__search-from">{row.article ? t(row.article.article.labelKey) : ''}</span>
                    ) : null}
                  </a>
                </li>
              ))}
            </ul>
          )}
          {matched.length > shown.length ? (
            <p className="lp-docs__search-more">
              {t('site.docs.search.truncated', { count: MAX_RESULTS })}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
