/**
 * 帮助中心的可搜索内容。
 *
 * 这份索引只由现有的帮助问答与文档注册表派生，不另建一份内容清单。
 * 这样新增一条速答或一篇文档时，帮助首页的搜索会自动跟上；搜索结果也能
 * 直接落到原有的 FAQ 锚点或文档分区，而不会产生第二套路由。
 */

import { useMemo, useState } from 'react';

import { ICON_SIZE } from '@heyta/design-system';
import { useI18n, useLocale, type Locale, type MessageKey } from '@heyta/i18n/provider';
import { Search, X } from 'lucide-react';

import { docsSearchHits, docsOutline, type DocsSearchHit } from './docs.js';
import type { FaqPair, HelpModule } from './content.js';
import type { SitePage } from './pages.js';
import { siteHref } from './paths.js';

export type HelpSearchResultKind = 'faq' | 'article' | 'section';

export interface HelpSearchResult {
  readonly id: string;
  readonly kind: HelpSearchResultKind;
  readonly titleKey: MessageKey;
  /** 搜索时匹配的文字；渲染层在当前语言下解析它。 */
  readonly searchKeys: readonly MessageKey[];
  readonly article?: DocsSearchHit;
  readonly module?: HelpModule;
  readonly faq?: FaqPair;
}

/**
 * 帮助中心所有可落地的搜索结果：FAQ 在前，深读文章随后。
 * FAQ 的答案也参与匹配，但结果仍显示问题标题，避免一条长答案充斥结果列表。
 */
export function helpSearchResults(): readonly HelpSearchResult[] {
  const faqResults = docsOutline().flatMap(({ module }) =>
    module.pairs.map((faq) => ({
      id: `faq/${faq.id}`,
      kind: 'faq' as const,
      titleKey: faq.questionKey,
      searchKeys: [faq.questionKey, faq.answerKey],
      module,
      faq,
    })),
  );

  const documentResults = docsSearchHits().map((hit) => ({
    id: `${hit.kind}/${hit.article.id}/${hit.sectionId ?? ''}`,
    kind: hit.kind,
    titleKey: hit.titleKey,
    searchKeys: [hit.titleKey],
    article: hit,
  }));

  return [...faqResults, ...documentResults];
}

/** 当前语言下按空白分词的 AND 搜索，中文则按连续子串匹配。 */
export function filterHelpSearchResults(
  results: readonly HelpSearchResult[],
  query: string,
  translate: (key: MessageKey) => string,
): readonly HelpSearchResult[] {
  const tokens = query
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return [];

  return results.filter((result) => {
    const haystack = result.searchKeys
      .map((key) => translate(key))
      .join(' ')
      .toLocaleLowerCase();
    return tokens.every((token) => haystack.includes(token));
  });
}

export function helpSearchHref(
  result: HelpSearchResult,
  page: SitePage,
  locale: Locale,
): string {
  const base = siteHref(page, locale);
  if (result.kind === 'faq') return `${base}#${result.faq?.id ?? ''}`;
  if (result.article === undefined) return base;
  const articleBase = siteHref(result.article.article, locale);
  return result.article.sectionId === undefined
    ? articleBase
    : `${articleBase}#${result.article.sectionId}`;
}

const MAX_HELP_RESULTS = 10;

/** 帮助首页的本地搜索：问题和深读文章共用同一份派生索引。 */
export function HelpSearch({ page }: { page: SitePage }): React.JSX.Element {
  const { t } = useI18n();
  const locale = useLocale();
  const [query, setQuery] = useState('');
  const results = useMemo(() => helpSearchResults(), []);
  const matched = useMemo(
    () => filterHelpSearchResults(results, query, t),
    [results, query, t],
  );
  const shown = matched.slice(0, MAX_HELP_RESULTS);
  const hasQuery = query.trim().length > 0;

  return (
    <section className="lp-help-discovery" aria-labelledby="lp-help-search-title">
      <h2 id="lp-help-search-title" className="lp-h2 lp-help-discovery__title">
        {t('site.help.search.title')}
      </h2>
      <div className="lp-help-discovery__search" role="search">
        <div className="lp-help-discovery__field">
          <Search
            className="lp-help-discovery__icon"
            size={ICON_SIZE.sm}
            aria-hidden="true"
          />
          <input
            className="lp-help-discovery__input"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && hasQuery) {
                event.preventDefault();
                setQuery('');
              }
            }}
            aria-label={t('site.help.search.title')}
            placeholder={t('site.help.search.placeholder')}
            aria-controls="lp-help-search-results"
          />
          {hasQuery ? (
            <button
              type="button"
              className="lp-help-discovery__clear"
              aria-label={t('site.help.search.clear')}
              onClick={() => setQuery('')}
            >
              <X size={ICON_SIZE.xs} aria-hidden="true" />
            </button>
          ) : null}
        </div>

        {hasQuery ? (
          <div
            id="lp-help-search-results"
            className="lp-help-discovery__results"
            aria-live="polite"
          >
            <p className="lp-help-discovery__count">
              <span className="lp-help-discovery__count-number">{matched.length}</span>
              <span className="lp-sr-only"> {t('site.help.search.results', { count: matched.length })}</span>
            </p>
            {matched.length === 0 ? (
              <p className="lp-help-discovery__empty">{t('site.help.search.none')}</p>
            ) : (
              <ul className="lp-help-discovery__list">
                {shown.map((result) => (
                  <li key={result.id}>
                    <a
                      className="lp-help-discovery__link"
                      href={helpSearchHref(result, page, locale)}
                    >
                      <span className="lp-help-discovery__result-title">
                        {t(result.titleKey)}
                      </span>
                      {result.module ? (
                        <span className="lp-help-discovery__result-from">
                          {t(result.module.titleKey)}
                        </span>
                      ) : result.article?.kind === 'section' ? (
                        <span className="lp-help-discovery__result-from">
                          {t(result.article.article.labelKey)}
                        </span>
                      ) : null}
                    </a>
                  </li>
                ))}
              </ul>
            )}
            {matched.length > shown.length ? (
              <p className="lp-help-discovery__more">
                {t('site.docs.search.truncated', { count: MAX_HELP_RESULTS })}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

/**
 * 按「我现在要做什么」给出五个低成本入口。
 * 标签和问题直接来自 HELP_MODULES；模块名称不会在帮助首页另造一份。
 */
export function HelpQuickLinks({ page }: { page: SitePage }): React.JSX.Element {
  const { t } = useI18n();
  const locale = useLocale();
  const modules = useMemo(() => docsOutline(), []);

  return (
    <section className="lp-help-discovery__quick" aria-labelledby="lp-help-quick-title">
      <h2 id="lp-help-quick-title" className="lp-h2">
        {t('site.help.topics.title')}
      </h2>
      <ul className="lp-help-discovery__quick-list">
        {modules.map(({ module }) => {
          const firstQuestion = module.pairs[0];
          if (firstQuestion === undefined) return null;
          return (
            <li key={module.id} className="lp-help-discovery__quick-item">
              <a
                className="lp-help-discovery__quick-link"
                href={`${siteHref(page, locale)}#${firstQuestion.id}`}
              >
                <span className="lp-help-discovery__quick-module">
                  {t(module.titleKey)}
                </span>
                <span className="lp-help-discovery__quick-label">
                  {t(firstQuestion.questionKey)}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
