/**
 * 文档中心的搜索
 * ================
 *
 * 访客带着一个词进来（「口令」「导出」「自建」），而侧栏回答的是"这一站有什么"，
 * 页内目录回答的是"这一页有什么" —— 两个都不回答"我要的那句话在哪"。
 * 搜索是第三种入口，也是 SSOS 那套文档中心有、我们此前没有的那一件。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 三条判据都在别的文件里，这里只是它们的落点：
 *
 *   1. **索引是派生的，不是生成的**（`docs.ts` 的 `docsSearchHits()`）。
 *      生成物要有人重跑才更新，而"新文章没进索引"这件事没有任何一层会失败 ——
 *      段落数、目录、sitemap 全照样对。派生没有那个时刻。
 *   2. **匹配的是当前语言解析出来的标题**，不是词条 key。
 *      key 在渲染层最后一刻才变成话（`t(hit.titleKey)`），所以中文页搜中文、
 *      英文页搜英文，而**不存在**"索引是中文、页面是英文"这种一半对一半错。
 *   3. **命中就跳锚点**（`/help/passphrase/#what-it-is`），与页内目录同一条形状：
 *      地址可分享、可回退，落点由 `.lp-row` 已有的 `scroll-margin-block-start` 让开吸顶导航。
 *
 * ⚠️ 结果**只在有输入时挂进 DOM**。常驻一个空列表会让"侧栏恰好是那一份地图"
 * 那类判据去数出一堆空条目，而读者看到的是搜索框底下莫名其妙的一条缝。
 *
 * ⚠️ 上限 `MAX_RESULTS` 是个代码常量，那句"只显示前 N 条"用插值把它带给读者 ——
 * 把数字写进文案，它就会和常量分叉，而分叉的表现是界面在骗人。
 *
 * 🔴 搜索框**放在文档区自己的顶上**，不在侧栏里：窄屏时侧栏收进抽屉，
 * 挂在里面的搜索要先进抽屉才用得了；而两份侧栏（外面那一列 + 抽屉那一层）
 * 各带一个输入框，就又是"同一个界面两个事实源"—— 那正是折叠状态被提到
 * `DocsLayout` 的理由（见那个文件头）。
 */

import { useMemo, useState } from 'react';

import { useI18n, useLocale, type Locale } from '@heyta/i18n/provider';
import { Search, X } from 'lucide-react';

import type { DocsSearchHit } from './docs.js';
import { docsSearchHits } from './docs.js';
import { siteHref } from './paths.js';

/**
 * 结果上限。为什么非要有：一个「的」能命中三十几条，一屏放不下。
 * 🔴 但截断必须说出来 —— 默默少给几条，读者以为搜索就是找不到，
 * 于是这功能从"帮忙"变成"劝退"。所以上面那句词条和这个数字是配套的。
 */
const MAX_RESULTS = 8;

/** 一条命中解析完的样子：标题给了读者看，归一化后的标题用来匹配。 */
interface Row {
  readonly hit: DocsSearchHit;
  readonly title: string;
  readonly articleTitle: string;
  /** 匹配面：**只有**这一条自己的标题（小写）。理由见 `docsSearchHits()`。 */
  readonly needle: string;
}

/** 命中 → 地址：文章级就是那一页，分区级在后面接上那一节的锚点。 */
function hitHref(hit: DocsSearchHit, locale: Locale): string {
  const base = siteHref(hit.article, locale);
  return hit.sectionId === undefined ? base : `${base}#${hit.sectionId}`;
}

export function DocsSearch(): React.JSX.Element {
  const { t } = useI18n();
  const locale = useLocale();
  const [query, setQuery] = useState('');

  /**
   * 解析一次、缓存住：`t` 在同一语言下是稳定引用（`useI18n` 里 `useMemo` 过），
   * 所以这份索引不随每次按键重算，只在换语言时重算。
   */
  const rows = useMemo<readonly Row[]>(
    () =>
      docsSearchHits().map((hit) => {
        const title = t(hit.titleKey);
        return {
          hit,
          title,
          articleTitle: t(hit.article.labelKey),
          needle: title.toLowerCase(),
        };
      }),
    [t],
  );

  // 多个词之间是「都要包含」，与产品内那个搜索面板同一个语义（词条里也这么写）。
  // 中文没有词边界，所以匹配用子串而不是分词 —— 访客搜「口令」不该要求他先输完整标题。
  const matched = useMemo(() => {
    const tokens = query.trim().toLowerCase().split(/\s+/).filter((token) => token !== '');
    if (tokens.length === 0) return [];
    return rows.filter((row) => tokens.every((token) => row.needle.includes(token)));
  }, [rows, query]);

  const shown = matched.slice(0, MAX_RESULTS);
  const hasQuery = query.trim() !== '';

  return (
    <div className="lp-docs__search" role="search">
      <div className="lp-docs__search-field">
        <Search className="lp-docs__search-icon" size={15} aria-hidden="true" />
        <input
          className="lp-docs__search-input"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label={t('site.docs.search.label')}
          placeholder={t('site.docs.search.placeholder')}
        />
        {hasQuery ? (
          <button
            type="button"
            className="lp-docs__search-clear"
            aria-label={t('site.docs.search.clear')}
            onClick={() => setQuery('')}
          >
            <X size={14} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {hasQuery ? (
        <div className="lp-docs__search-results" aria-live="polite">
          {matched.length === 0 ? (
            <p className="lp-docs__search-empty">{t('site.docs.search.none')}</p>
          ) : (
            <ul className="lp-docs__search-list">
              {shown.map((row) => (
                <li key={`${row.hit.article.id}/${row.hit.sectionId ?? ''}`}>
                  <a
                    className="lp-docs__search-link"
                    href={hitHref(row.hit, locale)}
                    {...(row.hit.kind === 'section' ? { 'data-section': 'true' as const } : {})}
                  >
                    <span className="lp-docs__search-title">{row.title}</span>
                    {row.hit.kind === 'section' ? (
                      <span className="lp-docs__search-from">{row.articleTitle}</span>
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
