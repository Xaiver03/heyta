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

/* ── 404 页（G-35）─────────────────────────────────────────── */

/**
 * 站点自己的 404 页，中英各一份：`public/404.html` 与 `public/en/404.html`。
 *
 * 🔴 **为什么它由这个脚本生成，而不是手写两份。** 它是 `error_page 404` 的落点，
 * 而 `error_page` 是**内部跳转** —— 状态码保持 404（用 `try_files … /404.html`
 * 会把状态码又变回 200，那正是 G-25b 刚修掉的坏法）。跳转过去的文件本身
 * 是一份站点产物，它要跟着语言走、跟着导航走、跟着设计 token 走。
 * 手写的失败方式和其它入口一模一样：**静默**。这份页面上的四个链接此前
 * 只能抄字面量（`/docs/`、`/en/legal/privacy/`），而改一次页面路径
 * 只有这一页不会跟着改 —— 它平时根本不出现，出现了也只是一张 404。
 * 走 `hrefPath()` 之后，路径只有一个事实源。
 *
 * 🔴 **色值同样不抄**：`{{T:…}}` 由生成器从 `packages/design-system` 的
 * `generated/tokens.json`（light 块）取值，与 `server/src/design.generated.ts`
 * 同一来源。改 token → 产物字节变 → `check:entries` 逐字节比对红。
 */
const notfoundTemplate = readFileSync(join(HERE, 'notfound-template.html'), 'utf8');

const TOKEN_LIGHT = JSON.parse(
  readFileSync(join(HERE, '../../../packages/design-system/generated/tokens.json'), 'utf8'),
).light;

/**
 * 取一个 token 并**带单位**输出；取不到就报错，不生成本半截的页面。
 *
 * 🔴 单位规则不是这里发明的，是 `server/src/design.generated.ts` 已经在用的那套
 * （`'font-size.base': '16px'` 与 `'font-weight.semibold': 600` 同时出现在同一个文件里）：
 * `tokens.json` 把尺寸存成**裸数字**（`16`）、字重与行高也是裸数字（`600` / `1.5`），
 * 只有尺寸类要补 `px`。字重/行高补单位会直接让 CSS 失效 —— 所以白名单写在这，
 * 模板里只写裸 `{{T:…}}`，不写 `px`（写了就会变成 `16pxpx`）。
 */
const UNITLESS_TOKENS = /^(font-weight|line-height)\./;

function tokenValue(name) {
  const value = TOKEN_LIGHT[name];
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error(
      `设计 token 里没有 ${name}（tokens.json 的 light 块）—— 去 packages/design-system 加，别在模板里写死`,
    );
  }
  const text = String(value);
  if (text === '') throw new Error(`token ${name} 是空值`);
  // 这些值直接进 `<style>`：`<`/`>` 能提前闭合 `</style>`，`{`/`}` 会打乱声明块。
  // 🔴 引号**不算**违规 —— `font.sans` 逐字就是 `'Plus Jakarta Sans', …`。
  if (/[<>{}]/.test(text)) throw new Error(`token ${name} 的形状不像 CSS 值：${text}`);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`token ${name} 不是有限数：${text}`);
    return UNITLESS_TOKENS.test(name) ? text : `${text}px`;
  }
  return text;
}

/** `{{T:color.primary}}` → 真值。 */
function fillTokens(html) {
  return html.replaceAll(/\{\{T:([a-z0-9.-]+)\}\}/g, (_match, name) => tokenValue(name));
}

/** 按 id 从注册表取页 —— 取不到就红：那意味着 404 页要把人指向一个不存在的东西。 */
function pageById(id) {
  const page = SITE_PAGES.find((entry) => entry.id === id);
  if (page === undefined) {
    throw new Error(`站点注册表里没有 id 为 ${id} 的页面 —— 404 页那条链接无处可指`);
  }
  return page;
}

const NOTFOUND_TARGETS = {
  home: pageById('home'),
  help: pageById('help'),
  privacy: pageById('legal-privacy'),
  terms: pageById('legal-terms'),
};

for (const locale of LOCALES) {
  const table = TABLES[locale];
  // 🔴 换语言那条链接的**文案**是按"恰好另一种语言"写的（中文表里写的是英文站、
  //   英文表里写的是中文站）。加第三种语言时这句话就不成立了，而 `LOCALES.find`
  //   会安静地选中第一种 —— 症状是日文页上有个"切换到英文站点"但其实该有两个选项。
  //   所以这里宁可直接炸，也不让它在未来变成一条自我感觉良好的错话。
  if (LOCALES.length !== 2) {
    throw new Error(`404 页的换语言链接只在恰好两种语言时成立，现在是 ${LOCALES.length} 种（${LOCALES.join(', ')}）`);
  }
  const other = LOCALES.find((entry) => entry !== locale);
  if (other === undefined) {
    throw new Error('LOCALES 里只有一种语言，404 页那条换语言链接无处可指');
  }

  /**
   * 词条缺失**必须炸**，不能渲染成 `undefined`：这一页一年里几乎不出现，
   * 而它出现的那一次正是用户在出错的时候。`{{BODY}}` 打成 `undefined`
   * 没有任何一道闸会因此变红 —— 除了这一行。
   */
  const text = (key) => {
    const value = table[key];
    if (typeof value !== 'string' || value === '') {
      throw new Error(`词条表 ${locale} 里没有 ${key}（404 页要用）—— 中英两边都得加`);
    }
    return escapeHtml(value);
  };

  const homeDir = entryDir(NOTFOUND_TARGETS.home, locale);
  const html = fillTokens(notfoundTemplate)
    .replaceAll('{{LANG}}', locale)
    .replaceAll('{{TITLE}}', text('site.notfound.seo.title'))
    .replaceAll('{{HEADING}}', text('site.notfound.heading'))
    .replaceAll('{{BODY}}', text('site.notfound.body'))
    .replaceAll('{{NAV_ARIA}}', text('site.nav.aria'))
    .replaceAll('{{HOME_TEXT}}', text('site.notfound.home'))
    .replaceAll('{{HOME_URL}}', hrefPath(NOTFOUND_TARGETS.home, locale))
    .replaceAll('{{HELP_TEXT}}', text('site.nav.help'))
    .replaceAll('{{HELP_URL}}', hrefPath(NOTFOUND_TARGETS.help, locale))
    .replaceAll('{{PRIVACY_TEXT}}', text('site.footer.legal.privacy'))
    .replaceAll('{{PRIVACY_URL}}', hrefPath(NOTFOUND_TARGETS.privacy, locale))
    .replaceAll('{{TERMS_TEXT}}', text('site.footer.legal.terms'))
    .replaceAll('{{TERMS_URL}}', hrefPath(NOTFOUND_TARGETS.terms, locale))
    .replaceAll('{{OTHER_TEXT}}', text('site.notfound.otherLanguage'))
    .replaceAll('{{OTHER_URL}}', hrefPath(NOTFOUND_TARGETS.home, other));

  // 🔴 落点是 `public/`，不是包根：`viteInputEntries()` 只从 `SITE_PAGES` 注册表
  //   取多页入口，注册表里没有"404"这一页（它也不该有 —— ADR-0033 的双向可达性门禁
  //   会遍历注册表要求每页互相链接，而 404 不是一页）。`public/` 下的东西由 Vite
  //   原样拷进站点根，同一批里 `public/sitemap.xml` 就是这个形状。
  //   ⇒ 线上落点正是 nginx `error_page 404 /404.html;` 要跳的那两个路径。
  artifacts.set(`public/${homeDir === '' ? '' : `${homeDir}/`}404.html`, html);
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

/* ── robots.txt ───────────────────────────────────────────── */

artifacts.set(
  'public/robots.txt',
  [
    '# heyta 落地页',
    '#',
    '# 由 scripts/gen-entries.mjs 生成，不要手改（见该文件的文件头）。',
    '# 那行 `Sitemap:` 的地址是从站点部署地址的唯一事实源',
    '# （`src/site/origin.ts` 的 `DEFAULT_SITE_ORIGIN` / 构建参数 `VITE_SITE_URL`）',
    '# 推出来的 —— 手写它等于留一份"换域名时不会跟着变、也没有门禁会报"的抄件，',
    '# 而 `check:entries` 现在把它当生成物逐字节对账。',
    '#',
    '# 为什么这个文件非有不可：`location /` 有 SPA 兜底（try_files … /index.html），',
    '# 所以**任何不存在的路径都会返回 HTTP 200 + 落地页 HTML**。',
    '# /robots.txt 也在此列 —— 爬虫拿到的是一份 HTML，而不是"没有 robots"。',
    '# 那比没有 robots.txt 更坏：没有文件时爬虫用默认全站可抓，给它 HTML 反而是一次解析失败。',
    '# （站点文件里已加 `location = /robots.txt { try_files $uri =404; }` 兜住这种情况。）',
    '',
    'User-agent: *',
    'Allow: /',
    '',
    '# 应用本体是一个私有 SPA：没有账号的人打开只有登录页，爬不到任何可索引内容。',
    '# 抓它只会浪费爬虫预算，还会把 `/app/` 变成搜索结果里的一个空壳。',
    'Disallow: /app/',
    '',
    `Sitemap: ${SITE_URL}/sitemap.xml`,
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
