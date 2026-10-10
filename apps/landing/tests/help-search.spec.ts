import { describe, expect, it } from 'vitest';

import { zhCN } from '@heyta/i18n/zh-CN';

import {
  filterHelpSearchResults,
  helpSearchHref,
  helpSearchResults,
} from '../src/site/help-search.js';
import { pageById } from '../src/site/pages.js';

const translate = (key: keyof typeof zhCN): string => zhCN[key];

describe('帮助中心搜索索引', () => {
  it('从现有 FAQ 与文档注册表派生，并保留 FAQ 的可分享落点', () => {
    const results = helpSearchResults();
    const sync = results.find((result) => result.id === 'faq/sync');

    expect(results.length).toBeGreaterThan(20);
    expect(sync?.kind).toBe('faq');
    expect(helpSearchHref(sync!, pageById('help'), 'zh-CN')).toContain('/docs/#sync');
  });

  it('按当前语言文字做 AND 匹配，空查询不渲染结果', () => {
    const results = helpSearchResults();
    const syncResults = filterHelpSearchResults(results, '同步 设备', translate);

    expect(syncResults.length).toBeGreaterThan(0);
    expect(syncResults.some((result) => result.id === 'faq/sync')).toBe(true);
    expect(filterHelpSearchResults(results, '   ', translate)).toEqual([]);
  });

  it('答案文字也可检索，但结果仍显示问题标题', () => {
    const results = helpSearchResults();
    const result = filterHelpSearchResults(results, '恢复码', translate).find(
      (row) => row.id === 'faq/passphrase',
    );

    expect(result?.titleKey).toBe('site.help.q.passphrase');
    expect(result?.searchKeys).toContain('site.help.a.passphrase');
  });

  it('同步失败搜索落到文章锚点，文章侧栏提供回帮助中心路径', () => {
    const results = helpSearchResults();
    const result = filterHelpSearchResults(results, '同步失败', translate).find(
      (row) => row.id === 'section/how/sync-failure',
    );

    expect(result?.kind).toBe('section');
    expect(helpSearchHref(result!, pageById('help'), 'zh-CN')).toBe('/docs/how/#sync-failure');
    // DocsNav 的回链由同一注册表 pageById('help') 派生，避免文章脱离帮助中心。
    expect(pageById('help').path).toBe('/docs');
  });
});
