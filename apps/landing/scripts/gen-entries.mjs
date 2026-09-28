#!/usr/bin/env node
/**
 * 从站点注册表生成**入口 HTML** 与 **sitemap.xml**
 * =================================================
 *
 * 用法：
 *
 *     node scripts/gen-entries.mjs            # 写文件
 *     node scripts/gen-entries.mjs --check    # 只校验磁盘上的文件是不是最新的
 *
 * 🔴 **为什么必须存在这个脚本。**
 *
 * 站点是"多 HTML 入口"架构（ADR-0033）：每个页面 × 每种语言 = 一份独立的 HTML 入口。
 *
 * 🔴 **口径更正（2026-09-28，见 ADR-0033 §7.1 的勘误）**：这里原先写的是
 * "一份**真静态** HTML，所以首屏不用等 JS" —— **实测证伪**：
 * 生成的入口里 `#root` 是空容器，正文仍由 `main.tsx` 挂载的 React 树渲染。
 * 真正兑现的是「**爬虫拿到的 head 完整**」（title / description / canonical /
 * hreflang / og / JSON-LD 都在静态 HTML 里）与「每页有独立地址」，
 * **不是**"无 JS 首屏"——那需要预渲染 / SSR，是另一份决策。
 *
 * 代价是入口数 = 页数 × 语言数。手写这些 HTML 的失败方式**不是报错，是静默少收流量**：
 *
 *   - 某页忘了写 hreflang → 那页的中英两版互相抢排名，两边都掉；
 *   - 某页 copy 了中文的 `<title>` → 爬虫看到的是中文（人工点开才发现）；
 *   - 某页把语言引导脚本改动过 → 只有那一页的暗色用户看到一帧白。
 *
 * 这个脚本让上述每一处都**只有一份**（在 `entry-template.html` 里），
 * 而页面的差异（路径、语言、标题、描述）从 `src/site/pages.ts` + 词条表派生。
 *
 * 🔴 **`--check` 是它的另一半。** 生成物签进仓库（这样没有构建步骤也能打开
 * 站点，`seo-head.spec.ts` 也能直接读磁盘），于是"改了注册表忘了重新生成"
 * 成为一种可能。`--check` 就是那条漏法的封堵：CI 跑它，不一致就红。
 *
 * ## 为什么站点地址有一个默认值（而不是"没配就不输出"）
 *
 * 应用地址（`VITE_APP_URL`）没配时**什么都不渲染** —— 一个猜出来的应用地址
 * 点下去是 404，比没有链接更坏。
 * canonical / hreflang / sitemap 不一样：它们**必须**是绝对地址（规范与爬虫
 * 都这么要求），所以不能"没有就不输出"，只能有一个明确的部署地址。
 * 于是 `VITE_SITE_URL` 的默认值就是当前真实部署地址；换域名时传环境变量重建。
 *
 * ## 为什么直接 import `.ts`
 *
 * 注册表与词条表都是 TypeScript 源码，而这个脚本必须是 Node 能直接跑的
 * （它是构建**之前**的一步，不能先要求一次 tsc）。Node 22 的类型擦除
 * （type stripping）正好覆盖这个用法：这两个文件只用 `interface` / `as const`
 * 这类可擦除语法。**如果哪天给它们加了 enum / namespace / 参数属性，
 * 这个脚本会立刻报错** —— 那是好事，比偷偷生成一份错的入口好。
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SITE_PAGES, entryDir, hrefPath } from '../src/site/pages.ts';
import { HELP_QUESTIONS, PRICING_QUESTIONS } from '../src/site/content.ts';
import { siteOriginFrom } from '../src/site/origin.ts';
import { LOCALES } from '../../../packages/i18n/src/types.ts';
import { en } from '../../../packages/i18n/src/locales/en.ts';
import { zhCN } from '../../../packages/i18n/src/locales/zh-CN.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '..');

/** 部署地址。默认值与规范化只有一份，在 `src/site/origin.ts`（见那个文件的文件头）。 */
const SITE_URL = siteOriginFrom(process.env.VITE_SITE_URL);

/**
 * 语言清单来自 `@heyta/i18n` 的 `LOCALES`（**唯一事实源**）——
 * 这里曾自己写一遍 `['zh-CN', 'en']`，加第三种语言时不会跟着变（R9）。
 */
const TABLES = { 'zh-CN': zhCN, en };

const CHECK = process.argv.includes('--check');

/** 生成中的全部文件：相对路径 → 内容。最后一次性比对/落盘。 */
const artifacts = new Map();

/* ── 入口 HTML ────────────────────────────────────────────── */

const template = readFileSync(join(HERE, 'entry-template.html'), 'utf8');

/**
 * HTML 文本节点/属性里的转义。
 *
 * ⚠️ `&` 必须先转，否则后面转出来的 `&amp;` 会被再转一次（`&amp;amp;`）。
 * 词条里确实有 `&`（英文的 "AI & MCP"），而没有转义的 `&` 在属性里会让
 * 解析器去猜实体 —— 猜错的表现是**标题少了半句**，而那是爬虫看到的那一半。
 */
function escapeHtml(text) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/**
 * 一份入口的 hreflang 三件套 —— 🔴 **指向本页**，不是首页。
 *
 * 子页面的 hreflang 指向首页是这类站点最常见的一种错，而它的表现是
 * "英文版功能页永远进不了索引"（它声明自己是首页的英文版，
 * 而首页的英文版另有其人）。
 * `x-default` 指向中文版（主站）：语言不匹配的访客落到主站版本。
 */
function alternatesFor(page) {
  return [...LOCALES, 'x-default']
    .map((hreflang) => {
      const locale = hreflang === 'en' ? 'en' : 'zh-CN';
      return `    <link rel="alternate" hreflang="${hreflang}" href="${urlFor(page, locale)}" />`;
    })
    .join('\n');
}

/** 某一页在某种语言下的绝对地址（**带尾斜杠**，与 `siteHref` 的形状一致）。 */
function urlFor(page, locale) {
  // 🔴 复用 `pages.ts` 的 `hrefPath`（R9）：这一形状此前在生成器、测试里
  // 各手写了一遍，而"首页是 `/` 而不是空串"这个特例正是漏掉一次就 404 的地方。
  return `${SITE_URL}${hrefPath(page, locale)}`;
}

/**
 * 把词条里的行内标记去掉，得到**纯文本**。
 *
 * 🔴 `og:*` 与 JSON-LD 都是**纯文本出口**：它们不进 `RichText`（那是页面渲染器），
 * 所以 `**强调**` 与反引号会原样发出去 —— 分享卡片上会出现星号，
 * 结构化数据里会出现一段没人能读的标记。而这两处**都没有测试会因此变红**，
 * 除非专门钉住（`seo-head.spec.ts` 里那条"标题不带 markdown"管的是 `<title>`）。
 */
function stripMarkup(text) {
  return text.replaceAll(/\*\*(.+?)\*\*/g, '$1').replaceAll(/`([^`]+)`/g, '$1');
}

/**
 * 卡片图片。绝对地址 + 位图，理由见 template 里那段注释。
 *
 * 🔴 R16：卡片**分语言**（`og-card.png` / `og-card-en.png`）——
 * 中英页此前共用一张中文卡，而英文页的 `og:image:alt` 用英文描述它。
 * 文件名规则与 `scripts/gen-og-card.mjs` 的 `cardFile()` 必须一致。
 */
function ogImageFor(locale) {
  return `${SITE_URL}/${locale === 'zh-CN' ? 'og-card.png' : 'og-card-en.png'}`;
}

/**
 * 一个页面的结构化数据（JSON-LD）。
 *
 * 两个类型，都只写**能被核对的事实**：
 *   · `SoftwareApplication` —— 产品是什么、跑在哪些平台上（平台清单与
 *     `/platforms` 一致，但这里只列操作系统名字，不声称进度）；
 *   · `FAQPage` —— 只在 `/pricing` 与 `/help` 上，因为那两页的问答
 *     是**页面上真实存在**的问答（不是为结构化数据编出来的）。
 *
 * 🔴 刻意不写：`offers`（价格会变成第五处价格）、`aggregateRating`
 * （没有真实评分）、`review`（没有真实用户）。这三样都是"给搜索引擎看、
 * 给用户看不了"的数据，而本仓库的判据是同一个：**说了的必须能核对**。
 */
function jsonLdFor(page, locale, table) {
  const text = (key) => stripMarkup(table[key]);
  const description = text(page.descriptionKey);

  const graph = [
    {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'heyta',
      url: SITE_URL,
      description,
      applicationCategory: 'ProductivityApplication',
      operatingSystem: 'Web, Windows, macOS, Linux, Android, iOS',
      inLanguage: locale,
    },
  ];

  /** 页面上的问答 → FAQPage。两者的 key 清单来自 `src/site/content.ts`。 */
  const faqPairs =
    page.id === 'pricing' ? PRICING_QUESTIONS : page.id === 'help' ? HELP_QUESTIONS : null;

  if (faqPairs !== null) {
    graph.push({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      inLanguage: locale,
      mainEntity: faqPairs.map((pair) => ({
        '@type': 'Question',
        name: text(pair.questionKey),
        acceptedAnswer: { '@type': 'Answer', text: text(pair.answerKey) },
      })),
    });
  }

  return JSON.stringify(graph, null, 2).replaceAll('</', '<\\/');
}

for (const page of SITE_PAGES) {
  for (const locale of LOCALES) {
    const table = TABLES[locale];
    const html = template
      .replaceAll('{{LANG}}', locale)
      .replaceAll('{{TITLE}}', escapeHtml(table[page.titleKey]))
      .replaceAll('{{DESCRIPTION}}', escapeHtml(table[page.descriptionKey]))
      .replaceAll('{{CANONICAL}}', urlFor(page, locale))
      .replaceAll('{{ALTERNATES}}', alternatesFor(page))
      .replaceAll('{{OG_LOCALE}}', locale === 'en' ? 'en_US' : 'zh_CN')
      .replaceAll('{{OG_IMAGE}}', ogImageFor(locale))
      .replaceAll('{{OG_IMAGE_ALT}}', escapeHtml(table['site.og.imageAlt']))
      .replaceAll('{{JSONLD}}', jsonLdFor(page, locale, table));

    const dir = entryDir(page, locale);
    artifacts.set(`${dir === '' ? '' : `${dir}/`}index.html`, html);
  }
}

/* ── sitemap.xml ──────────────────────────────────────────── */

const urlEntries = [];
for (const page of SITE_PAGES) {
  for (const locale of LOCALES) {
    urlEntries.push(
      [
        '  <url>',
        `    <loc>${urlFor(page, locale)}</loc>`,
        '    <changefreq>weekly</changefreq>',
        ...[...LOCALES, 'x-default'].map((hreflang) => {
          const targetLocale = hreflang === 'en' ? 'en' : 'zh-CN';
          return `    <xhtml:link rel="alternate" hreflang="${hreflang}" href="${urlFor(page, targetLocale)}" />`;
        }),
        '  </url>',
      ].join('\n'),
    );
  }
}

artifacts.set(
  'public/sitemap.xml',
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!--',
    '  由 scripts/gen-entries.mjs 生成，不要手改（见该文件的文件头）。',
    '',
    '  每个页面 × 每种语言各一条，hreflang 三件套与入口 HTML 里那一组',
    '  说同一件事 —— 两处不一致时搜索引擎会各自挑一个当成"真正的那个页面"。',
    '',
    '  刻意**不列** `/app/`：它需要登录，见 robots.txt 的 Disallow。',
    '  也**不列**锚点（`#pricing` 之类）：锚点不是独立 URL。',
    '-->',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
    '        xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...urlEntries,
    '</urlset>',
    '',
  ].join('\n'),
);

/* ── 落盘 / 校验 ──────────────────────────────────────────── */

const drift = [];

for (const [relativePath, content] of artifacts) {
  const absolutePath = join(APP, relativePath);
  let current = null;
  try {
    current = readFileSync(absolutePath, 'utf8');
  } catch {
    current = null;
  }

  if (current === content) continue;

  if (CHECK) {
    drift.push(relativePath);
    continue;
  }

  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content, 'utf8');
  process.stdout.write(` 写入 ${relativePath}\n`);
}

if (CHECK) {
  if (drift.length > 0) {
    process.stderr.write(
      [
        '',
        '🔴 入口文件与站点注册表不一致：',
        ...drift.map((path) => `   ${path}`),
        '',
        '跑一次 `pnpm --filter @heyta/landing gen:entries` 再提交。',
        '（手改这些 HTML 是没用的 —— 下一次生成会覆盖它。）',
        '',
      ].join('\n'),
    );
    process.exit(1);
  }
  process.stdout.write(`入口文件与注册表一致（${artifacts.size} 份）。\n`);
}
