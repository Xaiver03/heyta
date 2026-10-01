/**
 * 九份对外法律文本在站点上的接线判据
 * ==================================
 *
 * ## 为什么这条门禁必须存在，而不是"编译期已经兜住了"
 *
 * `PAGE_COMPONENTS` 是 `Record<SitePageId, …>`，所以"注册了页面没写组件"确实
 * 是编译错误。但它兜不住的是**另一半**，而那一半在法务场景里更贵：
 *
 *   1. **`@heyta/legal` 里有一份文件，站点上却没有它** —— 类型上完全成立
 *      （注册表与文档清单是两份东西）。后果不是 404，是**那份承诺根本不存在**：
 *      应用里勾选的「隐私政策」点进去没有页、商店表单里那个 URL 是空的、
 *      备案材料引用的地址打不开。而九份文件看起来都在仓库里，
 *      `pnpm -r test` 也全绿 —— 这正是"看起来有、其实没有"那一类。
 *   2. **反过来：站点上挂了一份 `@heyta/legal` 里没有的文件** —— `legalDocId`
 *      拼错一个字母，页面在渲染的那一刻才抛错，而入口 HTML 早就生成好、
 *      爬虫与商店拿到的是一条**正文空白**的地址。
 *   3. **站点文案与文本本身漂移** —— 页脚标签、`<title>`、`<meta description>`
 *      这三样是生成器从 `@heyta/legal` 投影进词条表的（`scripts/gen-site-copy.mjs`）。
 *      投影跑了但词条没提交、或者有人手改了词条，`<title>` 就会说"这一版是 X"
 *      而正文是 Y。**搜索引擎读到的那一半与用户读到的那一半不一致。**
 *
 * 所以这里逐条核对：清单 ↔ 注册表 ↔ 组件登记表 ↔ 投影出来的词条，四个方向都对得上。
 *
 * 🔴 **URL 形状也在判据里**（`/legal/<文档 id>`）。这些地址会被写进应用、
 * 商店表单与备案材料，改版只许改内容与 `version`，不许改 path。
 * 把形状钉成断言，是因为"顺手把 `/legal/personal-info-list` 缩短成
 * `/legal/pi-list`"在类型上、在生成器上都不会报错 —— 只会让已经发出去的
 * 引用全部失效。
 *
 * 用法：`pnpm --filter @heyta/landing test`（随 `pnpm -r test` 进 `pnpm check`）。
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { en } from '@heyta/i18n/en';
import { zhCN } from '@heyta/i18n/zh-CN';
import { LOCALES, type Locale } from '@heyta/i18n/provider';
import { LEGAL_DOCUMENTS, legalDocumentById } from '@heyta/legal';

import { PAGE_COMPONENTS } from '../src/pages/index.js';
import { LegalDocumentPage } from '../src/pages/LegalDocumentPage.js';
import {
  LEGAL_PAGES,
  SITE_PAGES,
  footerGroups,
  hrefPath,
  legalPageByDocId,
} from '../src/site/pages.js';

const TABLES: Record<Locale, Record<string, string>> = { 'zh-CN': zhCN, en };

/**
 * ⚠️ 用 `fileURLToPath(import.meta.url)` 而不是 `new URL(相对路径, import.meta.url)`：
 * 本仓库的路径里有空格，vitest 会把模块 URL 发成 `/@fs/…`，相对 URL 解析出来的
 * 路径便打不开文件（实测 ENOENT `/@fs/Users/…`）。`seo-head.spec.ts` 用的是
 * 同一个写法（`dirname(fileURLToPath(...))` 再 `resolve`），照它。
 */
const LOCALE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../packages/i18n/src/locales');

/** 与 `scripts/gen-site-copy.mjs` 同一套品牌后缀（两处不一致就是漂移）。 */
const BRAND: Record<Locale, string> = { 'zh-CN': ' —— heyta', en: ' — heyta' };

/** 去掉行内标记 —— 投影进词条表时是这么做的，这里用同一个函数口径。 */
const strip = (text: string): string =>
  text.replaceAll(/\*\*(.+?)\*\*/g, '$1').replaceAll(/`([^`]+)`/g, '$1');

describe('九份法律文本一份都不许漏挂', () => {
  it('文档清单与站点页面清单**数量相等**且**逐一对应**', () => {
    // 只比 id 集合不够：漏一份 + 多挂一份（拼错的那个）会让集合大小看起来正常。
    expect(LEGAL_PAGES.length).toBe(LEGAL_DOCUMENTS.length);
    const mounted = new Set(LEGAL_PAGES.map((page) => page.legalDocId));
    expect([...mounted].sort()).toEqual(LEGAL_DOCUMENTS.map((d) => d.id).sort());
    // 没有重复挂载（同一个 docId 出现两次 ⇒ 两份 URL 指向同一承诺，规范地址就没了唯一答案）。
    expect(mounted.size).toBe(LEGAL_PAGES.length);
  });

  it.each(LEGAL_DOCUMENTS.map((d) => [d.id, d.version] as const))(
    '%s：`legalPageByDocId()` 取得到，且组件登记的就是法律文本组件',
    (docId) => {
      const page = legalPageByDocId(docId);
      expect(page, `站点上没有 /legal/${docId} 这一页`).toBeDefined();
      // legalDocumentById 取不到会**抛** —— 这一行就是那条判据。
      expect(legalDocumentById(docId).id).toBe(docId);
      expect(PAGE_COMPONENTS[page!.id as keyof typeof PAGE_COMPONENTS]).toBe(LegalDocumentPage);
    },
  );

  it('每一条 `legalDocId` 都指向**真实存在**的文档（反向：站点不许挂幽灵文件）', () => {
    const ids = new Set(LEGAL_DOCUMENTS.map((d) => d.id));
    for (const page of LEGAL_PAGES) {
      expect(ids.has(page.legalDocId), `注册表里的 "${page.legalDocId}" 没有对应的文本`).toBe(true);
    }
  });
});

describe('URL 形状是承诺，不是可改的实现细节', () => {
  it.each(LEGAL_DOCUMENTS.map((d) => [d.id] as const))('%s：path 就是 `/legal/<文档 id>`', (docId) => {
    const page = legalPageByDocId(docId);
    expect(page?.path).toBe(`/legal/${docId}`);
    // 页脚可达（`inNav: false` 是刻意的：法律文本不进顶部导航，进页脚 legal 组）。
    expect(page?.inFooter).toBe(true);
    expect(page?.inNav).toBe(false);
  });

  it('中英两版的地址都带语言段，且英文版的 canonical 不是中文版那条', () => {
    for (const page of LEGAL_PAGES) {
      const zh = hrefPath(page, 'zh-CN');
      const enPath = hrefPath(page, 'en');
      expect(zh).toBe(`/legal/${page.legalDocId}/`);
      expect(enPath).toBe(`/en/legal/${page.legalDocId}/`);
    }
  });

  it('页脚 legal 组存在且九条齐全 —— 空组会被 `footerGroups()` 丢掉', () => {
    const legal = footerGroups().find((g) => g.group === 'legal');
    expect(legal, '页脚里没有 legal 组（这些地址就成了只能手打的页面）').toBeDefined();
    expect(legal?.pages.map((p) => p.id).sort()).toEqual(
      LEGAL_PAGES.map((p) => p.id).sort(),
    );
  });
});

describe('投影进词条表的站点文案与文本本身一致', () => {
  /**
   * 🔴 这一组判据的存在理由只有一条：**手改词条不会有任何东西变红**。
   * `MessageKey` 是从中文表派生的，key 存在、值随便改 —— 类型检查、
   * `check:ui-language`、`gen:entries` 全都过。只有把值与 `@heyta/legal`
   * 对账才能发现"标题说的是另一版"。
   */
  for (const document of LEGAL_DOCUMENTS) {
    for (const locale of LOCALES) {
      it(`${document.id} / ${locale}：title、lede、seo.title、seo.description 四条都等于投影`, () => {
        const table = TABLES[locale];
        const title = document.title[locale];
        expect(table[`site.legal.${document.id}.title`]).toBe(title);
        expect(table[`site.legal.${document.id}.lede`]).toBe(document.summary[locale]);
        expect(table[`site.legal.${document.id}.seo.title`]).toBe(`${title}${BRAND[locale]}`);
        expect(table[`site.legal.${document.id}.seo.description`]).toBe(
          strip(document.summary[locale]),
        );
      });
    }
  }

  it('生成器确实跑过（两张词条表里都有哨兵区间），不是有人手抄了一份', () => {
    // ⚠️ 读的是**源码**而不是 dist：`--check` 门禁比的也是源码，
    // 而 dist 只有在跑过 `pnpm --filter @heyta/i18n build` 之后才新。
    for (const file of ['zh-CN', 'en']) {
      const source = readFileSync(resolve(LOCALE_DIR, `${file}.ts`), 'utf8');
      expect(source, `${file}.ts 里没有生成区间 —— 站点文案不是投影来的`).toContain(
        '<<<generated:packages/legal/scripts/gen-site-copy.mjs>>>',
      );
      expect(source).toContain('<<<end:generated:packages/legal/scripts/gen-site-copy.mjs>>>');
    }
  });
});

describe('注册表里剩下的页面都不是法律页面（判据的负半边）', () => {
  it('除这九条以外，没有任何页面带 `legalDocId`', () => {
    const legalIds = new Set(LEGAL_PAGES.map((p) => p.id));
    const strays = SITE_PAGES.filter(
      (page) => 'legalDocId' in page && !legalIds.has(page.id),
    ).map((page) => page.id);
    expect(strays).toEqual([]);
  });
});
