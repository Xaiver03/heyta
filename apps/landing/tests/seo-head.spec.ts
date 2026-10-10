/**
 * 全部入口的「头部契约」
 * ========================
 *
 * 站点是"多 HTML 入口"架构：每个页面 × 每种语言 = 一份真静态 HTML，
 * 现在 7 × 2 = 14 份。它们的 `<head>` **全部由 `scripts/gen-entries.mjs`
 * 从 `entry-template.html` + `src/site/pages.ts` 生成**，所以这里查的不是
 * "有没有写对"，而是**"生成器有没有把该派生的东西派生出去"**：
 *
 *   - 少了 canonical，两个语言地址会被当成重复内容互相抢排名；
 *   - hreflang 不成对（只有一边声明、或两边声明不一致），搜索引擎**整组忽略**；
 *   - `x-default` 缺失时，语言不匹配的访客没有兜底版本；
 *   - 把中文入口**复制**成英文入口却忘了改 title/description —— 英文页顶着
 *     中文标题，人工点开才看得出来，但**爬虫看到的就是中文**，而恰恰是爬虫
 *     在决定收录；
 *   - 🔴 **子页面的 hreflang / canonical 指向首页** —— 这是本类站点最常见、
 *     也最难发现的一种错：地址栏完全正常，而那一页的英文版永远进不了索引。
 *
 * 这些没有一处能被类型系统拦住（全是 HTML 里的字符串），所以在这里钉住。
 *
 * ⚠️ 覆盖全部页面的方式**不是**在这里维护一份页面清单 —— 清单从
 * `SITE_PAGES` 读，于是"加了第八页忘了补测试"不可能发生。
 *
 * ⚠️ 与 `theme-contract.spec.ts` 的分工：那个只管主题引导脚本要同步执行、
 * 且不依赖样式表。本文件补的是"**14 份入口的引导脚本逐字相同**"——
 * 因为"只改了主入口"正是这类站点最容易发生的一类漂移。
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { LOCALES, type Locale } from '@heyta/i18n';

import { SITE_PAGES, entryDir, hrefPath, type SitePage } from '../src/site/pages.js';
import { siteOriginFrom } from '../src/site/origin.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '..');
const ORIGIN = siteOriginFrom(import.meta.env.VITE_SITE_URL);

/** 语言清单来自 `@heyta/i18n`，与站点注册表、入口生成器同一份（R9）。 */
type EntryLocale = Locale;

const CJK = /[\u4e00-\u9fff]/;

/** 入口文件在磁盘上的相对路径。 */
function entryPath(page: SitePage, locale: EntryLocale): string {
  const dir = entryDir(page, locale);
  return `${dir === '' ? '' : `${dir}/`}index.html`;
}

/** 某一页在某种语言下的绝对地址（**带尾斜杠**）。 */
function entryUrl(page: SitePage, locale: EntryLocale): string {
  // 复用 `pages.ts` 的 `hrefPath`（R9）：这一形状此前在这里与生成器里各写一遍。
  return `${ORIGIN}${hrefPath(page, locale)}`;
}

interface Head {
  readonly lang: string;
  readonly canonical: string;
  /** hreflang → href，按 hreflang 去重（同一语言声明两次是错误，见下面的断言）。 */
  readonly alternates: Map<string, string>;
  readonly title: string;
  readonly description: string;
  /** Open Graph / Twitter 的元信息，按 `property`/`name` 取值（小写）。 */
  readonly meta: Map<string, string>;
  /** 结构化数据。**解析后**的对象数组 —— 断言作用在数据上，不是 HTML 文本上。 */
  readonly jsonLd: readonly Record<string, unknown>[];
}

/**
 * 把 `<head>` 里的空白压平再匹配。
 *
 * 不这么做的话，源码里跨行写的 `<meta\n name="description"\n content="…" />`
 * 会匹配不到 —— 而"匹配不到"的表现是**断言被跳过**（拿到空串后 expect 空串），
 * 不是报错。压平是为了让下面每条断言都真的作用在内容上。
 */
function readHead(page: SitePage, locale: EntryLocale): Head {
  const relativePath = entryPath(page, locale);
  const html = readFileSync(resolve(APP, relativePath), 'utf8');
  const headEnd = html.indexOf('</head>');
  if (headEnd === -1) throw new Error(`${relativePath} 里没有 </head>`);
  const head = html.slice(0, headEnd).replace(/\s+/g, ' ');

  const lang = /<html lang="([^"]*)"/.exec(head)?.[1];
  if (lang === undefined) throw new Error(`${relativePath} 的 <html> 没有 lang`);

  const canonical = /<link rel="canonical" href="([^"]*)"/.exec(head)?.[1];
  if (canonical === undefined) {
    throw new Error(`${relativePath} 没有 canonical —— 两个语言入口会互相抢排名`);
  }

  const alternates = new Map<string, string>();
  const alternatesRe = /<link rel="alternate" hreflang="([^"]*)" href="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = alternatesRe.exec(head)) !== null) {
    const [, hreflang, href] = m;
    if (hreflang === undefined || href === undefined) continue;
    const existing = alternates.get(hreflang);
    if (existing !== undefined) {
      throw new Error(
        `${relativePath} 把 hreflang="${hreflang}" 声明了两次（${existing} / ${href}）`,
      );
    }
    alternates.set(hreflang, href);
  }

  const title = /<title>([^<]*)<\/title>/.exec(head)?.[1];
  if (title === undefined) throw new Error(`${relativePath} 没有 <title>`);

  const description = /<meta name="description" content="([^"]*)"/.exec(head)?.[1];
  if (description === undefined) throw new Error(`${relativePath} 没有 meta description`);

  /**
   * `og:*` 用 `property`、`twitter:*` 用 `name` —— 两种都收，键统一小写。
   * 不用"按前缀分别匹配"：那样每加一个 meta 就要改一次正则，
   * 而漏改的表现是**断言查不到值**（拿到 undefined），不是报错。
   */
  const meta = new Map<string, string>();
  const metaRe = /<meta (?:property|name)="([^"]*)" content="([^"]*)"\s*\/?>/g;
  let metaMatch: RegExpExecArray | null;
  while ((metaMatch = metaRe.exec(head)) !== null) {
    const [, name, content] = metaMatch;
    if (name === undefined || content === undefined) continue;
    meta.set(name.toLowerCase(), content);
  }

  /**
   * 结构化数据：**解析**它，而不是在 HTML 上做字符串匹配。
   *
   * ⚠️ 这条差别真实发生过：模板里的注释**提到了** `aggregateRating`（说明我们
   * 为什么不写它），于是"HTML 里含 aggregateRating"这种断言会对着注释变红 ——
   * 而它守的其实是"数据里没有假评分"。断言必须落在**数据**上。
   */
  const jsonLd: Record<string, unknown>[] = [];
  const ldRe = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  let ldMatch: RegExpExecArray | null;
  while ((ldMatch = ldRe.exec(html)) !== null) {
    const payload = ldMatch[1];
    if (payload === undefined) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch (error) {
      throw new Error(`${relativePath} 的 JSON-LD 不是合法 JSON：${String(error)}`);
    }
    if (Array.isArray(parsed)) jsonLd.push(...(parsed as Record<string, unknown>[]));
    else if (typeof parsed === 'object' && parsed !== null) {
      jsonLd.push(parsed as Record<string, unknown>);
    }
  }

  return { lang, canonical, alternates, title, description, meta, jsonLd };
}

/** 每一份入口 —— 用例对它们逐个跑一遍。 */
const ENTRIES = SITE_PAGES.flatMap((page) =>
  LOCALES.map((locale) => ({ page, locale, label: `${entryPath(page, locale)}` })),
);

/** 主题引导脚本（`<script>` 那一段），用于逐入口比对。 */
function bootstrap(page: SitePage, locale: EntryLocale): string {
  const html = readFileSync(resolve(APP, entryPath(page, locale)), 'utf8');
  const start = html.indexOf('<script>');
  const end = html.indexOf('</script>', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return html.slice(start, end);
}

describe('入口齐全：每个页面 × 每种语言一份', () => {
  it('磁盘上真的读得到每一份入口（不是只在注册表里存在）', () => {
    for (const { page, locale } of ENTRIES) {
      // 读不到会抛 ENOENT —— 那正是"注册了页面但没生成入口"的表现。
      expect(() => readHead(page, locale)).not.toThrow();
    }
  });
});

describe('<html lang> 按语言写对', () => {
  it.each(ENTRIES)('$label', ({ page, locale }) => {
    expect(readHead(page, locale).lang).toBe(locale);
  });
});

describe('canonical 指向自己这一页', () => {
  it.each(ENTRIES)('$label', ({ page, locale }) => {
    expect(readHead(page, locale).canonical).toBe(entryUrl(page, locale));
  });

  it('🔴 子页面的 canonical **不是首页** —— 这是本类站点最隐蔽的一种错', () => {
    for (const page of SITE_PAGES) {
      if (page.path === '/') continue;
      for (const locale of LOCALES) {
        const canonical = readHead(page, locale).canonical;
        expect(canonical, `${page.id}@${locale} 的 canonical 指向了首页`).not.toBe(
          entryUrl(SITE_PAGES[0], locale),
        );
        expect(canonical).toContain(`/${entryDir(page, locale)}/`);
      }
    }
  });
});

describe('hreflang 三件套齐全、成对、且**指向本页**', () => {
  it.each(ENTRIES)('$label：三种语言声明齐全', ({ page, locale }) => {
    // 一组 hreflang 里只要有一条不一致，搜索引擎会**整组忽略**，
    // 而忽略是静默的 —— 页面照常打开，只是不再算多语言版本。
    expect([...readHead(page, locale).alternates.keys()].sort()).toEqual([
      'en',
      'x-default',
      'zh-CN',
    ]);
  });

  it.each(ENTRIES)('$label：每个落点都是**本页**的对应语言版本', ({ page, locale }) => {
    const { alternates } = readHead(page, locale);
    expect(alternates.get('zh-CN')).toBe(entryUrl(page, 'zh-CN'));
    expect(alternates.get('en')).toBe(entryUrl(page, 'en'));
    // x-default 指向主站版本（中文）：语言不匹配时的兜底。
    expect(alternates.get('x-default')).toBe(entryUrl(page, 'zh-CN'));
  });

  it.each(ENTRIES)('$label：自指 —— 每个语言版本都把自己也列进去', ({ page, locale }) => {
    // 规范要求每个语言版本都列出**包括自己**在内的全部版本。
    // 只列对方是很常见的写法，而它会被判为不完整。
    const head = readHead(page, locale);
    expect(head.alternates.get(locale)).toBe(head.canonical);
  });

  it('同一页的两个语言版本声明的 hreflang 落点逐条一致', () => {
    for (const page of SITE_PAGES) {
      const zh = readHead(page, 'zh-CN').alternates;
      const en = readHead(page, 'en').alternates;
      for (const [hreflang, href] of zh) {
        expect(en.get(hreflang), `${page.id} 的 hreflang=${hreflang} 两边不一致`).toBe(href);
      }
    }
  });
});

describe('标题与描述必须真的分语言', () => {
  it('每份入口的 title / description 都非空', () => {
    for (const { page, locale } of ENTRIES) {
      const head = readHead(page, locale);
      expect(head.title.length).toBeGreaterThan(0);
      expect(head.description.length).toBeGreaterThan(0);
    }
  });

  it('同一页的中英两版 title / description 都不同', () => {
    // 复制过去忘了改的后果：英文页顶着中文标题。
    // 人工点开一眼能看出来，但爬虫看到的就是中文 —— 而爬虫决定收录。
    for (const page of SITE_PAGES) {
      const zh = readHead(page, 'zh-CN');
      const en = readHead(page, 'en');
      expect(en.title, `${page.id} 的中英 title 相同`).not.toBe(zh.title);
      expect(en.description, `${page.id} 的中英 description 相同`).not.toBe(zh.description);
    }
  });

  it('中文版的标题与描述含汉字', () => {
    for (const page of SITE_PAGES) {
      const zh = readHead(page, 'zh-CN');
      expect(zh.title).toMatch(CJK);
      expect(zh.description).toMatch(CJK);
    }
  });

  it('英文版的标题与描述**不含**汉字 —— 与词条表规则同一套判据', () => {
    // `apps/mobile` 与 `apps/landing` 的词条表都有这条规则（en 不许含汉字），
    // 但 head 里的文案不在词条表里、门禁也扫不到，所以在这里单独钉一次。
    for (const page of SITE_PAGES) {
      const en = readHead(page, 'en');
      expect(en.title, `${page.id} 的英文标题含汉字`).not.toMatch(CJK);
      expect(en.description, `${page.id} 的英文描述含汉字`).not.toMatch(CJK);
    }
  });

  it('标题里没有漏出来的 markdown 标记（`**` / 反引号）', () => {
    // 词条表里带 `**`/反引号是给页面渲染器用的（见 `RichText`），
    // 而 `<title>` 是**纯文本**出口：不剥掉就会把星号原样发给爬虫和分享卡片。
    for (const { page, locale } of ENTRIES) {
      const head = readHead(page, locale);
      expect(head.title, `${page.id}@${locale} 的标题带 markdown`).not.toMatch(/\*\*|`/);
      expect(head.description).not.toMatch(/\*\*|`/);
    }
  });
});

describe('主题引导脚本 14 份逐字相同', () => {
  /**
   * 加了英文入口之后，英文访客就成了唯一会看到一帧亮色的那群人 ——
   * 而他们正是最不可能来报这个 bug 的人。所以判据是"全部逐字相同"，
   * 而不是"中文那份对"。
   */
  it('与主入口逐字一致', () => {
    const reference = bootstrap(SITE_PAGES[0], 'zh-CN');
    for (const { page, locale, label } of ENTRIES) {
      expect(bootstrap(page, locale), `${label} 的引导脚本与主入口不同`).toBe(reference);
    }
  });
});

describe('入口文件是生成物，不是手抄的', () => {
  it('每份入口都带着"不要手改"的说明和生成命令', () => {
    for (const { page, locale } of ENTRIES) {
      const html = readFileSync(resolve(APP, entryPath(page, locale)), 'utf8');
      expect(html).toContain('由 `scripts/gen-entries.mjs` 生成');
      expect(html).toContain('gen:entries');
    }
  });
});

describe('Open Graph / Twitter 卡片', () => {
  it.each(ENTRIES)('$label：必需的 meta 都在', ({ page, locale }) => {
    const { meta } = readHead(page, locale);
    for (const key of [
      'og:type',
      'og:site_name',
      'og:locale',
      'og:title',
      'og:description',
      'og:url',
      'og:image',
      'og:image:alt',
      'twitter:card',
      'twitter:image',
    ]) {
      expect(meta.get(key), `${entryPath(page, locale)} 缺少 ${key}`).toBeTruthy();
    }
  });

  it.each(ENTRIES)('$label：og:url 与 canonical 是同一个地址', ({ page, locale }) => {
    // 🔴 两者不一致时：平台抓一个、搜索引擎认另一个，而分享出去的链接
    // 指的其实是第三个。它们必须由同一个函数算出来。
    const head = readHead(page, locale);
    expect(head.meta.get('og:url')).toBe(head.canonical);
  });

  it.each(ENTRIES)('$label：og:title/description 与页面标题描述逐字相同', ({ page, locale }) => {
    // 分享卡片上的标题与页面上的是两回事就会很难看：点进来发现标题变了。
    const head = readHead(page, locale);
    expect(head.meta.get('og:title')).toBe(head.title);
    expect(head.meta.get('og:description')).toBe(head.description);
  });

  it('og:locale 与语言一致', () => {
    expect(readHead(SITE_PAGES[0], 'zh-CN').meta.get('og:locale')).toBe('zh_CN');
    expect(readHead(SITE_PAGES[0], 'en').meta.get('og:locale')).toBe('en_US');
  });

  it('🔴 og:image 是绝对地址、分语言，而且**那张图真的存在**', () => {
    // 一个 404 的 og:image 比不声明更坏：平台会显示一个破图位。
    // 🔴 R16：中英**各一张**卡 —— 此前共用一张中文卡，而英文页的 alt 是英文，
    // 于是无障碍文本描述的是一张不存在的英文卡。
    for (const { page, locale } of ENTRIES) {
      const file = locale === 'en' ? 'og-card-en.png' : 'og-card.png';
      const image = readHead(page, locale).meta.get('og:image') ?? '';
      expect(image).toBe(`${ORIGIN}/${file}`);

      // 落点在 `public/` 下，构建时会被拷到站点根。
      const onDisk = resolve(APP, 'public', file);
      expect(existsSync(onDisk), `public/${file} 不存在：跑 pnpm gen:og`).toBe(true);
      // 位图，不是 SVG —— 微信 / X / Slack 的卡片普遍不渲染 SVG。
      expect(image.endsWith('.png')).toBe(true);
    }
    // 两张都必须存在（只存在中文那张是这次修复之前的形状）。
    expect(existsSync(resolve(APP, 'public', 'og-card.png'))).toBe(true);
    expect(existsSync(resolve(APP, 'public', 'og-card-en.png'))).toBe(true);
  });

  it('twitter:card 要的是大图卡，且图与 og:image 是同一张', () => {
    for (const { page, locale } of ENTRIES) {
      const { meta } = readHead(page, locale);
      expect(meta.get('twitter:card')).toBe('summary_large_image');
      expect(meta.get('twitter:image')).toBe(meta.get('og:image'));
    }
  });

  it('og:image:alt 分语言，且中文版含汉字 / 英文版不含', () => {
    const zh = readHead(SITE_PAGES[0], 'zh-CN').meta.get('og:image:alt') ?? '';
    const en = readHead(SITE_PAGES[0], 'en').meta.get('og:image:alt') ?? '';
    expect(zh).toMatch(CJK);
    expect(en).not.toMatch(CJK);
    expect(zh).not.toBe(en);
  });

  it('卡片文案里不漏 markdown 标记', () => {
    // 与 `<title>` 同一条判据：纯文本出口不能带 `**` 或反引号。
    for (const { page, locale } of ENTRIES) {
      const { meta } = readHead(page, locale);
      for (const key of ['og:title', 'og:description', 'og:image:alt']) {
        expect(meta.get(key), `${page.id}@${locale} 的 ${key} 带 markdown`).not.toMatch(/\*\*|`/);
      }
    }
  });
});

describe('结构化数据（JSON-LD）', () => {
  const typeOf = (node: Record<string, unknown>): string => String(node['@type'] ?? '');

  it.each(ENTRIES)('$label：有一条 SoftwareApplication，url 指向站点', ({ page, locale }) => {
    const app = readHead(page, locale).jsonLd.find((n) => typeOf(n) === 'SoftwareApplication');
    expect(app, `${entryPath(page, locale)} 里没有 SoftwareApplication`).toBeDefined();
    expect(app?.['url']).toBe(ORIGIN);
    expect(String(app?.['name'])).toBe('heyta');
    // `inLanguage` 与页面语言一致：一份中文描述不该挂在英文页上。
    expect(app?.['inLanguage']).toBe(locale);
  });

  it('🔴 数据里没有假评分、假评论、假价格', () => {
    /**
     * 三样都不许出现，各有各的理由：
     *   · `aggregateRating` / `review` —— 我们**还没有真实用户**，编一个
     *     会在搜索结果里显示一个假星级（计划 §8 明确不做）；
     *   · `offers` —— 价格只在词条表里写一次（`check:pricing` 核对那四处）。
     *     在生成的 HTML 里再写一遍就是第五处，而**门禁扫不到生成的 HTML**。
     */
    for (const { page, locale } of ENTRIES) {
      for (const node of readHead(page, locale).jsonLd) {
        for (const forbidden of ['aggregateRating', 'review', 'offers']) {
          expect(
            Object.keys(node).includes(forbidden),
            `${entryPath(page, locale)} 的 ${typeOf(node)} 里出现了 ${forbidden}`,
          ).toBe(false);
        }
      }
    }
  });

  it('FAQPage 只出现在真正有问答的页面上，且条数与页面一致', () => {
    // 4 条价格 FAQ、12 条帮助问答 —— 这两个数字来自 `src/site/content.ts`，
    // 改那边忘了改这里会立刻红（而不是让结构化数据与页面悄悄不一致）。
    // 帮助那一条从 10 涨到 12 是 2026-10-08 工单 W4（换绑邮箱 / 登录设备各一问）。
    const expected: Record<string, number> = { pricing: 4, help: 12 };
    for (const { page, locale } of ENTRIES) {
      const faq = readHead(page, locale).jsonLd.find((n) => typeOf(n) === 'FAQPage');
      const want = expected[page.id];
      if (want === undefined) {
        expect(faq, `${page.id} 上不该有 FAQPage（页面上没有问答区块）`).toBeUndefined();
        continue;
      }
      expect(faq, `${page.id} 上缺少 FAQPage`).toBeDefined();
      const mainEntity = faq?.['mainEntity'];
      expect(Array.isArray(mainEntity)).toBe(true);
      expect((mainEntity as unknown[]).length).toBe(want);
      for (const q of mainEntity as Record<string, unknown>[]) {
        expect(String(q['name']).length).toBeGreaterThan(0);
        const answer = q['acceptedAnswer'] as Record<string, unknown> | undefined;
        expect(String(answer?.['text']).length).toBeGreaterThan(0);
        // 问答文本也不能漏 markdown。
        expect(String(q['name'])).not.toMatch(/\*\*|`/);
        expect(String(answer?.['text'])).not.toMatch(/\*\*|`/);
      }
    }
  });
});
