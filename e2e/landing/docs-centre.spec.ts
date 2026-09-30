import { expect, test, type Page } from '@playwright/test';

/**
 * 文档中心 —— 真浏览器验收（帮助中心的两层深度）
 * =================================================
 *
 * 这一组判据回答的是一个 jsdom 测不到的问题：**访客真的看到的是什么**。
 * `render.spec.tsx` 已经证明"每个页面都能渲染、没有孤立路由"，但那是虚拟 DOM；
 * 而本轮新增的东西**全部是版面事实**：一列 sticky 侧栏、六张卡片、
 * 当前项的高亮、塌缩态里侧栏该退到正文之后。这些在 jsdom 里**没有几何**，
 * 于是"测试全绿而界面是错的"恰恰是这里最可能的失效形态
 * （AGENTS §6.2 规定一说的就是它）。
 *
 * 三条纪律都按 §6.2 写：
 *   1. **先截图、再断言** —— 失败时那张图必须已经落盘；
 *   2. 截图**固定文件名**，跑完可以直接打开同一个路径看；
 *   3. 抓 `console` 与 `pageerror`，白屏的根因几乎只在这一处现形。
 *
 * 🔴 被测的是 **build 产物 + preview**（理由见 `playwright.landing.config.ts` 文件头）：
 * 那 12 份新生成的入口 HTML 必须真的能在浏览器里打开，而不是只在磁盘上存在。
 */

/**
 * 文档中心此刻应有的文章。
 *
 * ⚠️ **这份清单是刻意独立重述的**，事实源在 `apps/landing/src/site/pages.ts`。
 * 两边对不上时这里应该红 —— 那要么意味着有人加了文章没配套（应该红），
 * 要么意味着有人**删了**文章而浏览器里的链接集合变了（更应该红）。
 * 从注册表 import 进来只会让这条判据永远自我印证。
 *
 * 顺序 = 注册表顺序（start 两篇 → sync 四篇 → organize 三篇 → data 三篇 → trust 两篇），
 * 但下面每条判据都 `.sort()` 两边再比，所以顺序在这里只是给人读的分组线。
 */
const ARTICLE_IDS = [
  // start
  'first-run',
  'concepts',
  // sync
  'how',
  'account',
  'passphrase',
  'conflict',
  // organize
  'views',
  'repeat',
  'reminders',
  // data
  'selfhost',
  'transfer',
  'trash',
  // trust
  'privacy',
  'loss',
];

/**
 * 本轮补进来的八篇（start / organize / trust 各补两篇以上）。
 * 单独列一份是因为「正文段落 ≥ 8」这条死规矩**只管新文章**：
 * 早先六篇的分区更短（`how` 六段），把它们一起套上去会变成假红，
 * 而假红的代价是下次没人信这条判据。
 */
const NEW_ARTICLE_IDS = [
  'first-run',
  'concepts',
  'views',
  'repeat',
  'reminders',
  'trash',
  'privacy',
  'loss',
];

/** 有文章、因此有分类页的五个模块（与 `content.ts` 的 `HELP_MODULES` 同序）。 */
const CATEGORY_IDS = ['start', 'sync', 'organize', 'data', 'trust'];

/** 帮助中心此刻应有的分类与速答条数（`content.ts` 的 `HELP_MODULES`）。 */
const MODULE_COUNT = 5;
const FAQ_COUNT = 10;

type Hit = { kind: string; text: string };

/**
 * 🔴 监听从**页面一创建**就挂上（§6.2 规定一第 3 条）。
 * 挂晚了收到的是"控制台无内容" —— 那是最误导人的结果：白屏的模块 404
 * 全部发生在加载期。
 */
function watchConsole(page: Page): Hit[] {
  const hits: Hit[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') hits.push({ kind: 'console.error', text: msg.text() });
  });
  page.on('pageerror', (err) => hits.push({ kind: 'pageerror', text: err.message }));
  return hits;
}

function expectCleanConsole(hits: Hit[]): void {
  expect(
    hits,
    `加载与交互期间控制台不该有报错（白屏/半件成品的根因通常只在这里现形）：\n${hits
      .map((h) => `${h.kind}: ${h.text}`)
      .join('\n')}`,
  ).toEqual([]);
}

/**
 * 🔴 等页头那一次"遮罩揭示"**真的落位**，再截图。
 *
 * 页头的标题走 `.lp-mask { overflow: hidden }` + 内层 `translateY(112%) → 0%`，
 * 引言再错峰淡入。动画没跑完时，**页头在截图里就是一条空白带** ——
 * 第一轮六张图里有四张是这样（暗色那张甚至拍到标题被横切一半）。
 *
 * 那不是产品缺陷，但它是**不能用的证据**：§6.2 规定一要的是"访客看到的画面"，
 * 而对着这张图去查就会去修一个不存在的问题。
 * 这仍是 §7 第 83 条那一族 —— 探针观测的时刻本身就是判据的一部分。
 */
async function waitHeadRevealed(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const h1 = document.querySelector<HTMLElement>('.lp-h1');
    const inner = h1?.querySelector<HTMLElement>('.lp-mask__inner') ?? null;
    const lede = document.querySelector<HTMLElement>('.lp-lede');
    if (h1 === null || inner === null || lede === null) return false;
    const box = h1.getBoundingClientRect();
    const innerBox = inner.getBoundingClientRect();
    return (
      box.height > 0 &&
      Math.abs(innerBox.top - box.top) < 2 &&
      getComputedStyle(lede).opacity === '1'
    );
  });
}

/** 去掉前导 `/`、结尾 `/` 与语言前缀，取最后一段 —— 也就是文章 id。 */
function articleIdOf(href: string): string {
  const segments = href.split('/').filter((s) => s !== '');
  return segments[segments.length - 1] ?? '';
}

test('帮助中心是两层的共同入口：五个分类、十条速答、六张文章卡', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const hits = watchConsole(page);

  await page.goto('/help/');
  await page.locator('#main .lp-help__module').first().waitFor();
  // ① 先落证据，再打分。
  await waitHeadRevealed(page);
  await page.screenshot({ path: 'landing-results/landing-help-hub.png', fullPage: true });

  const probe = await page.evaluate(() => {
    const modules = [...document.querySelectorAll('#main .lp-help__module')];
    const cards = [...document.querySelectorAll<HTMLAnchorElement>('#main .lp-docs__card-link')];
    return {
      modules: modules.length,
      faqQuestions: document.querySelectorAll('#main .lp-faq__q').length,
      details: document.querySelectorAll('#main details').length,
      cardHrefs: cards.map((a) => a.getAttribute('href') ?? ''),
      // 卡片"有没有正文"要按字数判，不是按元素存在判 —— 空 span 也是元素。
      cardTitles: cards.map((a) => (a.querySelector('.lp-docs__card-title')?.textContent ?? '').trim()),
      cardSumChars: cards.map(
        (a) => (a.querySelector('.lp-docs__card-sum')?.textContent ?? '').trim().length,
      ),
      eyebrows: [...document.querySelectorAll('#main .lp-docs__eyebrow')].map(
        (e) => e.textContent ?? '',
      ),
      modulesWithCards: modules.filter((m) => m.querySelector('.lp-docs__card-link') !== null).length,
      // 空白页在自动化里最阴的地方是它什么都不报，所以直接量正文有没有字数。
      mainChars: (document.querySelector('#main')?.textContent ?? '').trim().length,
    };
  });

  await expect
    .soft(probe.modules, '分类数应与 HELP_MODULES 一致')
    .toBe(MODULE_COUNT);
  expect(probe.faqQuestions, '速答条数应与问答清单一致').toBe(FAQ_COUNT);
  expect(probe.details, '速答不是折叠面板（折叠=内容不在首屏）').toBe(0);

  expect(
    probe.cardHrefs.map(articleIdOf).sort(),
    `文章卡必须恰好链到注册表里那六篇：${probe.cardHrefs.join(' ')}`,
  ).toEqual([...ARTICLE_IDS].sort());
  expect(
    probe.cardTitles.every((title) => title.length > 1),
    `每张卡都要有标题（标题：${probe.cardTitles.join(' / ')}）`,
  ).toBe(true);
  expect(
    probe.cardSumChars.every((n) => n > 20),
    `每张卡都要有一句话摘要（字数：${probe.cardSumChars.join(', ')}）`,
  ).toBe(true);

  // 🔴 「速答」小标题只在**有文章的**分类出现，成对的是「速答」+「深入阅读」。
  // 判据从 DOM 自己推出来（不写死 4），所以加一篇文章不会让这条假红。
  expect(probe.eyebrows.length, '每个两层分类给两个小标题').toBe(probe.modulesWithCards * 2);
  expect(probe.mainChars, '正文真的有字数，不是一张空壳').toBeGreaterThan(600);

  expectCleanConsole(hits);
});

test('文章页：侧栏是整个文档中心的地图，当前篇只高亮一条，顶部导航仍亮着「帮助」', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const hits = watchConsole(page);

  await page.goto('/help/how/');
  await page.locator('#main .lp-docs__nav').first().waitFor();
  await waitHeadRevealed(page);
  await page.screenshot({ path: 'landing-results/landing-docs-article.png', fullPage: true });

  const probe = await page.evaluate(() => {
    const links = [...document.querySelectorAll<HTMLAnchorElement>('#main .lp-docs__nav .lp-docs__link')];
    const sections = [...document.querySelectorAll<HTMLElement>('#main section.lp-row')];
    return {
      lang: document.documentElement.lang,
      h1: document.querySelector('h1')?.textContent ?? '',
      sectionIds: sections.map((s) => s.id),
      sectionTitles: sections.map((s) => s.querySelector('h2')?.textContent ?? ''),
      proseChars: [...document.querySelectorAll('#main .lp-prose')].reduce(
        (n, p) => n + (p.textContent ?? '').trim().length,
        0,
      ),
      listItemCount: document.querySelectorAll('#main .lp-list__item').length,
      navLinks: links.map((a) => a.getAttribute('href') ?? ''),
      navCurrent: links
        .filter((a) => a.getAttribute('aria-current') === 'page')
        .map((a) => a.getAttribute('href') ?? ''),
      backHref: document.querySelector('#main .lp-docs__back')?.getAttribute('href') ?? '',
      topNavCurrent: [
        ...document.querySelectorAll<HTMLAnchorElement>('.lp-nav__links a[aria-current="page"]'),
      ].map((a) => a.getAttribute('href') ?? ''),
      ctaCount: document.querySelectorAll('#main .lp-page__cta').length,
    };
  });

  expect(probe.lang, '中文文章的 html lang').toBe('zh-CN');
  expect(probe.h1.trim().length, '文章必须有 H1').toBeGreaterThan(0);
  // 🔴 分区 id 逐字对上 `docs.ts` 里那三条 —— 这条判据管的是"正文真的按注册表渲染了"，
  // 而不是"随便渲染了点东西"。改 `docs.ts` 忘了这里会红，那正是想要的耦合。
  expect(probe.sectionIds, '分区锚点必须按 docs.ts 的顺序出现').toEqual([
    'local-first',
    'when-it-syncs',
    'what-the-server-cannot-see',
  ]);
  expect(probe.sectionTitles.every((s) => s.trim().length > 0), '每个分区都有标题').toBe(true);
  expect(probe.proseChars, '正文有可读的字数').toBeGreaterThan(300);
  expect(probe.listItemCount, '并列条目渲染成列表').toBeGreaterThan(0);

  expect(
    probe.navLinks.map(articleIdOf).sort(),
    '侧栏必须列出全部六篇（它是地图，不是本页目录）',
  ).toEqual([...ARTICLE_IDS].sort());
  // 🔴 恰好一条当前项，而且是这一篇自己。零条=人不知道在哪；两条=高亮没有意义。
  expect(probe.navCurrent, '侧栏当前项必须恰好一条且是本页').toEqual(['/help/how/']);
  expect(probe.backHref, '侧栏顶部那条回到帮助中心').toBe('/help/');
  expect(probe.topNavCurrent, '文章不进导航，但顶部导航要亮着「帮助」').toEqual(['/help/']);
  // 文章页不给收尾 CTA：读的人正在解决一件具体的事，不该被拔出去（见 PageHead 的 cta）。
  expect(probe.ctaCount, '文章页不渲染「立即使用」那颗按钮').toBe(0);

  expectCleanConsole(hits);
});

test('侧栏跳转是真路由：从「同步原理」点到「冲突」，当前项跟着搬过去', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const hits = watchConsole(page);

  await page.goto('/help/how/');
  await page.locator('#main .lp-docs__nav').first().waitFor();

  // 🔴 按 **href** 点而不是按文字点：文案会改，而"侧栏那条链接指向哪"才是要验的事。
  await page.locator('#main .lp-docs__link[href="/help/conflict/"]').click();
  await page.waitForURL('**/help/conflict/');
  await page.locator('h1').first().waitFor();
  await waitHeadRevealed(page);
  await page.screenshot({ path: 'landing-results/landing-docs-jumped.png', fullPage: true });

  const after = await page.evaluate(() => ({
    path: location.pathname,
    h1: document.querySelector('h1')?.textContent ?? '',
    sectionIds: [...document.querySelectorAll<HTMLElement>('#main section.lp-row')].map((s) => s.id),
    current: [
      ...document.querySelectorAll<HTMLAnchorElement>(
        '#main .lp-docs__nav .lp-docs__link[aria-current="page"]',
      ),
    ].map((a) => a.getAttribute('href') ?? ''),
    topNavCurrent: [
      ...document.querySelectorAll<HTMLAnchorElement>('.lp-nav__links a[aria-current="page"]'),
    ].map((a) => a.getAttribute('href') ?? ''),
  }));

  expect(after.path, '地址真的换到冲突那一篇').toBe('/help/conflict/');
  expect(after.sectionIds, '正文换成冲突的三节').toEqual([
    'why-they-exist',
    'how-it-decides',
    'what-you-see',
  ]);
  expect(after.current, '高亮搬到新页面自己').toEqual(['/help/conflict/']);
  expect(after.topNavCurrent, '顶部导航仍然亮着「帮助」').toEqual(['/help/']);

  expectCleanConsole(hits);
});

test('英文版文章用的是英文条目，且 canonical / hreflang 指向自己这一对', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const hits = watchConsole(page);

  const read = async (path: string) => {
    await page.goto(path);
    await page.locator('#main section.lp-row').first().waitFor();
    await waitHeadRevealed(page);
    return page.evaluate(() => ({
      lang: document.documentElement.lang,
      h1: document.querySelector('h1')?.textContent ?? '',
      canonical: document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ?? '',
      alternates: [
        ...document.querySelectorAll<HTMLLinkElement>('link[rel="alternate"][hreflang]'),
      ].map((l) => `${l.getAttribute('hreflang')}=${l.href}`),
      xDefault:
        document.querySelector<HTMLLinkElement>('link[rel="alternate"][hreflang="x-default"]')
          ?.href ?? '',
    }));
  };

  const zh = await read('/help/passphrase/');
  await page.screenshot({ path: 'landing-results/landing-docs-passphrase-zh.png', fullPage: true });
  const en = await read('/en/help/passphrase/');
  await page.screenshot({ path: 'landing-results/landing-docs-passphrase-en.png', fullPage: true });

  expect(zh.lang, '中文版 lang').toBe('zh-CN');
  expect(en.lang, '英文版 lang').toBe('en');
  // 🔴 英文页必须真的渲染出英文条目：只要 locale 解析回落到中文，
  // 两页 H1 就会一模一样 —— 而所有其他判据（入口存在、状态 200）都照样绿。
  expect(/[一-鿿]/.test(zh.h1), `中文页 H1 应当含中文：${zh.h1}`).toBe(true);
  expect(/[一-鿿]/.test(en.h1), `英文页 H1 不该含中文：${en.h1}`).toBe(false);
  expect(en.h1, '两版标题必须不同（相同=语言回落）').not.toBe(zh.h1);

  expect(en.canonical, '英文版 canonical 指向英文版自己').toMatch(/\/en\/help\/passphrase\/$/);
  expect(en.alternates.join(' '), 'hreflang 必须成对给出中英两版').toContain('zh-CN');
  expect(en.alternates.join(' ')).toContain('en');
  expect(en.xDefault, 'x-default 落中文版').toBe(zh.canonical);

  expectCleanConsole(hits);
});

test('暗色主题不是反相：同一篇文章在暗色下真的走暗色 token', async ({ page, browser }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const darkHits = watchConsole(page);
  // 引导脚本读的是 `heyta.theme`（与 apps/web 逐字一致的契约，见 src/lib/theme.ts）。
  //
  // 🔴 **必须用两个 context，不能在同一页里"先切暗再切回亮"**：
  // `addInitScript` 在**每次导航**前都会重跑，于是"把 key 写回 light"再 goto
  // 时它又被写成了 dark —— 探针把自己要验的那个状态覆盖了。第一版就栽在这里：
  // `切回亮色后 data-theme 跟着变` 拿到 `dark` 而报红，**界面没有任何问题**
  // （AGENTS §7 第 83 条的同一个形状：探针是被测系统的一段真实操作）。
  await page.addInitScript(() => window.localStorage.setItem('heyta.theme', 'dark'));

  await page.goto('/help/how/');
  await page.locator('#main .lp-docs__nav').first().waitFor();
  await waitHeadRevealed(page);
  await page.screenshot({ path: 'landing-results/landing-docs-article-dark.png', fullPage: true });

  const dark = await page.evaluate(() => ({
    theme: document.documentElement.dataset['theme'] ?? '',
    bodyBg: getComputedStyle(document.body).backgroundColor,
    currentBg: getComputedStyle(
      document.querySelector('#main .lp-docs__link[aria-current="page"]') ?? document.body,
    ).backgroundColor,
    // 暗色下当前项仍有对比度（不靠"亮色下刚好看得见"）。
    currentColor: getComputedStyle(
      document.querySelector('#main .lp-docs__link[aria-current="page"]') ?? document.body,
    ).color,
  }));

  // 亮色基线 = 一个**什么都没存过**的新访客：新 context 的 localStorage 是空的。
  // 🔴 `colorScheme: 'light'` 必须显式钉住 —— `resolveInitialTheme()` 在没有存档时
  // 跟随系统偏好，不钉的话这台机器"外观=深色"会把**基线**也变成暗色，
  // 于是下面"背景确实不同"那条成了自己和自己比（永远绿，也永远无效）。
  const origin = new URL(page.url()).origin;
  const lightCtx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    colorScheme: 'light',
  });
  const lightPage = await lightCtx.newPage();
  const lightHits = watchConsole(lightPage);
  await lightPage.goto(`${origin}/help/how/`);
  await lightPage.locator('#main .lp-docs__nav').first().waitFor();
  await waitHeadRevealed(lightPage);
  await lightPage.screenshot({
    path: 'landing-results/landing-docs-article-light.png',
    fullPage: true,
  });

  const light = await lightPage.evaluate(() => ({
    theme: document.documentElement.dataset['theme'] ?? '',
    bodyBg: getComputedStyle(document.body).backgroundColor,
  }));
  await lightCtx.close();

  expect(dark.theme, 'data-theme 必须是 dark').toBe('dark');
  expect(light.theme, '没存过选择的访客落在 light').toBe('light');
  // 🔴 判据是"背景色真的不一样"，而不是"我设了 localStorage" ——
  // 后者在暗色覆盖没挂上的时候照样成立。
  expect(dark.bodyBg, '暗色背景必须与亮色不同（否则暗色覆盖没生效）').not.toBe(light.bodyBg);
  expect(dark.currentBg, '侧栏当前项在暗色下有自己的底色（不是透明）').not.toBe('rgba(0, 0, 0, 0)');

  expectCleanConsole(darkHits);
  expectCleanConsole(lightHits);
});

test('窄屏（390×844）塌缩成单列，侧栏退到正文之后', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const hits = watchConsole(page);

  await page.goto('/help/selfhost/');
  await page.locator('#main .lp-docs__nav').first().waitFor();
  await waitHeadRevealed(page);
  await page.screenshot({ path: 'landing-results/landing-docs-narrow.png', fullPage: true });

  const boxes = await page.evaluate(() => {
    const nav = document.querySelector('#main .lp-docs__nav')?.getBoundingClientRect();
    const prose = document.querySelector('#main section.lp-row')?.getBoundingClientRect();
    return {
      navTop: nav?.top ?? -1,
      proseTop: prose?.top ?? -1,
      width: window.innerWidth,
      // 横向溢出=手机上出现水平滚动条，那是排版事故而不是"塌缩没做好"。
      overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
      navLinkCount: document.querySelectorAll('#main .lp-docs__link').length,
    };
  });

  expect(boxes.proseTop, '正文有几何').toBeGreaterThan(0);
  // 🔴 手机上先给答案，导航放后面 —— 与 CSS 里 `order: 1` 对应的**几何**判据。
  // 只断言"侧栏在 DOM 里存在"是挡不住的：它在正文上面时也照样存在。
  expect(boxes.navTop, '侧栏必须排在正文之后').toBeGreaterThan(boxes.proseTop);
  expect(boxes.overflowX, '不该出现横向溢出').toBe(false);
  expect(boxes.navLinkCount, '塌缩后六篇仍然都在').toBe(ARTICLE_IDS.length);

  expectCleanConsole(hits);
});

test('分类页是这一组的入口：卡片恰好等于侧栏这一组的链接，当前分组亮着它自己', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const hits = watchConsole(page);

  await page.goto('/help/sync/');
  await page.locator('#main .lp-docs__nav').first().waitFor();
  await waitHeadRevealed(page);
  await page.screenshot({ path: 'landing-results/landing-docs-category.png', fullPage: true });

  const probe = await page.evaluate(() => {
    const groupLinks = [
      ...document.querySelectorAll<HTMLAnchorElement>('#main .lp-docs__group-link'),
    ];
    const currentGroup = groupLinks.find((a) => a.getAttribute('aria-current') === 'true');
    const group = currentGroup?.closest('.lp-docs__group');
    // 当前分组自己那一列文章（侧栏里的），拿它和页面上的卡片对账。
    const groupArticleHrefs =
      group === null || group === undefined
        ? []
        : [...group.querySelectorAll<HTMLAnchorElement>('.lp-docs__link')].map(
            (a) => a.getAttribute('href') ?? '',
          );
    return {
      h1: document.querySelector('h1')?.textContent?.trim() ?? '',
      currentGroupText: currentGroup?.textContent?.trim() ?? '',
      currentGroupCount: groupLinks.filter((a) => a.getAttribute('aria-current') === 'true').length,
      currentGroupHref: currentGroup?.getAttribute('href') ?? '',
      groupArticleHrefs,
      cardHrefs: [...document.querySelectorAll<HTMLAnchorElement>('#main .lp-docs__card-link')].map(
        (a) => a.getAttribute('href') ?? '',
      ),
      // 分类页**不是**一篇文章，所以侧栏里不该有 `aria-current="page"`（那是"就是这一篇"）。
      articleCurrentCount: document.querySelectorAll('#main .lp-docs__link[aria-current="page"]')
        .length,
      faqCount: document.querySelectorAll('#main .lp-faq__q').length,
      eyebrowCount: document.querySelectorAll('#main .lp-docs__eyebrow').length,
      navLinkTotal: document.querySelectorAll('#main .lp-docs__link').length,
      backHref: document.querySelector('#main .lp-docs__back')?.getAttribute('href') ?? '',
      topNavCurrent: [
        ...document.querySelectorAll<HTMLAnchorElement>('.lp-nav__links a[aria-current="page"]'),
      ].map((a) => a.getAttribute('href') ?? ''),
      ctaCount: document.querySelectorAll('#main .lp-page__cta').length,
    };
  });

  expect(probe.h1.length, '分类页必须有 H1（它就是这一组的标题）').toBeGreaterThan(0);
  // 🔴 恰好一个当前分组，而且指向本页。零个=人不知道自己在哪一组；
  // 两个=高亮没有意义。走的是 `aria-current="true"`，与文章的 `"page"` 分开（见 DocsNav）。
  expect(probe.currentGroupCount, '侧栏当前分组必须恰好一个').toBe(1);
  expect(probe.currentGroupHref, '当前分组指向本页').toBe('/help/sync/');
  expect(probe.articleCurrentCount, '分类页不是文章，侧栏不该有当前文章项').toBe(0);
  // 页头 h1 与侧栏亮着的那一项是同一个词 —— 两处各自 `t(module.titleKey)`，对不上就是有一处写错。
  expect(probe.currentGroupText, '侧栏高亮的分组名必须就是页标题').toBe(probe.h1);

  // 🔴 **这一条管的是"分类页只列这一组"**。卡片来自 `docsCategoryById`、侧栏那几行来自
  // `docsOutline()`，两条不同的代码路径。若分类页误把全部文章摆出来，卡片数会等于侧栏总数，
  // 而当前分组的链接数小于它 —— 这里就会红。
  expect(
    probe.cardHrefs.map(articleIdOf).sort(),
    `分类页的卡片必须恰好等于侧栏这一组的文章：${probe.cardHrefs.join(' ')}`,
  ).toEqual(probe.groupArticleHrefs.map(articleIdOf).sort());
  expect(probe.cardHrefs.length, '这一组至少有篇文章，否则不该建分类页').toBeGreaterThan(1);
  expect(
    probe.cardHrefs.length,
    '分类页只列这一组，不等于文档中心的全部文章',
  ).toBeLessThan(probe.navLinkTotal);

  // 分类页 = 速答 + 深读卡片（同一块 `DocsModuleBlock`，与 `/help` 上那块逐字同源）。
  expect(probe.faqCount, '分类页保留这一组的速答').toBeGreaterThan(0);
  expect(probe.eyebrowCount, '速答 + 深入阅读两个小标题').toBe(2);
  expect(probe.backHref, '侧栏顶部那条回到帮助中心').toBe('/help/');
  expect(probe.topNavCurrent, '分类页不进导航，顶部仍亮着「帮助」').toEqual(['/help/']);
  expect(probe.ctaCount, '分类页不给收尾 CTA').toBe(0);

  expectCleanConsole(hits);
});

test('侧栏分组能收能开：收起是「看不见」而不是「不存在」，且各分组互不干扰', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const hits = watchConsole(page);

  await page.goto('/help/how/');
  await page.locator('#main .lp-docs__nav').first().waitFor();
  await waitHeadRevealed(page);
  await page.screenshot({ path: 'landing-results/landing-docs-groups-open.png' });

  /**
   * 读第 `index` 个折叠按钮**和它控制的那一列**：
   * `aria-controls` 指向的 id 才是被操作的那个 `<ul>`，这里坚持按 id 取（而不是
   * 「下一个 ul」），因为这条判据同时要验"`aria-controls` 真的指对了地方"。
   */
  const readGroup = (index: number) =>
    page.evaluate((i) => {
      const toggles = [...document.querySelectorAll<HTMLButtonElement>('#main .lp-docs__toggle')];
      const toggle = toggles[i];
      if (toggle === undefined) throw new Error(`第 ${i} 个折叠按钮不存在（共 ${toggles.length} 个）`);
      const list = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
      const links = list === null ? [] : [...list.querySelectorAll<HTMLAnchorElement>('.lp-docs__link')];
      const visibleNavLinks = [
        ...document.querySelectorAll<HTMLElement>('#main .lp-docs__link'),
      ].filter((a) => a.offsetParent !== null);
      return {
        expanded: toggle.getAttribute('aria-expanded'),
        listFound: list !== null,
        hidden: list?.hasAttribute('hidden') ?? true,
        listHeight: list?.getBoundingClientRect().height ?? -1,
        linkCount: links.length,
        visibleLinks: links.filter((a) => a.offsetParent !== null).length,
        visibleNavTotal: visibleNavLinks.length,
      };
    }, index);

  const syncBefore = await readGroup(0);
  const dataBefore = await readGroup(1);
  // 🔴 默认全展开。这是**产品判据**不是方便：访客第一眼要能看见"文档中心一共有什么"，
  // 默认收起会把六篇藏成两个分组标题，那和没有侧栏等价。
  expect(syncBefore.expanded, '默认展开').toBe('true');
  expect(syncBefore.hidden, '默认不带 hidden').toBe(false);
  expect(syncBefore.listFound, 'aria-controls 指向的 id 必须真实存在').toBe(true);
  expect(syncBefore.listHeight, '展开时这一列有高度').toBeGreaterThan(0);
  expect(dataBefore.expanded, '第二个分组默认也展开').toBe('true');
  expect(syncBefore.visibleNavTotal, '页面上六篇都看得见').toBe(ARTICLE_IDS.length);

  await page.locator('#main .lp-docs__toggle').first().click();

  const syncCollapsed = await readGroup(0);
  expect(syncCollapsed.expanded, '收起后 aria-expanded 变 false').toBe('false');
  expect(syncCollapsed.hidden, '收起后这一列带 hidden').toBe(true);
  expect(syncCollapsed.listHeight, '收起后这一列没有高度').toBe(0);
  expect(syncCollapsed.visibleLinks, '收起后这一列看不见任何链接').toBe(0);
  // 🔴 **收起 ≠ 卸载**。DOM 里那几条链接必须一条不少 —— 这是这轮改造里最容易做错的一件事：
  // 用 `{open && <ul>}` 把列表摘掉，读屏软件与"这一组有什么"的搜索都会失去内容，
  // 而界面上看起来完全正确。窄屏那条"六篇仍然都在"的判据也依赖这一点。
  expect(syncCollapsed.linkCount, '收起后链接仍在 DOM 里（只是不可见）').toBe(syncBefore.linkCount);
  expect(syncCollapsed.visibleNavTotal, '全局只少掉这一组的四条').toBe(
    ARTICLE_IDS.length - syncBefore.linkCount,
  );
  await page.screenshot({ path: 'landing-results/landing-docs-groups-collapsed.png' });

  await page.locator('#main .lp-docs__toggle').first().click();

  const syncAfter = await readGroup(0);
  expect(syncAfter.expanded, '再点一次回到展开').toBe('true');
  expect(syncAfter.visibleLinks, '展开后这一组重新看得见').toBe(syncBefore.linkCount);
  expect(syncAfter.visibleNavTotal, '六篇重新全部可见').toBe(ARTICLE_IDS.length);
  // 🔴 分组状态各自独立：收起 sync 不许把 data 一起收掉（一份 collapsed 列表按 id 存）。
  expect((await readGroup(1)).expanded, '另一个分组不受影响').toBe(dataBefore.expanded);

  expectCleanConsole(hits);
});

test('页内目录从渲染出的分区生成，点最后一条就滚到那一条', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const hits = watchConsole(page);

  await page.goto('/help/how/');
  await page.locator('#main .lp-docs__toc').first().waitFor();
  await waitHeadRevealed(page);

  const before = await page.evaluate(() => {
    const links = [...document.querySelectorAll<HTMLAnchorElement>('#main .lp-docs__toc a')];
    const sections = [...document.querySelectorAll<HTMLElement>('#main section.lp-row')];
    const header = document.querySelector('.lp-nav')?.getBoundingClientRect();
    const last = sections[sections.length - 1];
    return {
      tocHrefs: links.map((a) => a.getAttribute('href') ?? ''),
      tocTexts: links.map((a) => a.textContent?.trim() ?? ''),
      sectionIds: sections.map((s) => s.id),
      sectionTitles: sections.map((s) => s.querySelector('h2')?.textContent?.trim() ?? ''),
      headerBottom: header?.bottom ?? 0,
      innerHeight: window.innerHeight,
      // 点之前，最后一节在不在视口里（不在，"滚过去"这条判据才有意义）。
      lastTop: last?.getBoundingClientRect().top ?? -1,
    };
  });

  // 🔴 **目录不是第二份手写清单**：条目必须与页面上真实渲染出来的 `<section id>` 一字不差、
  // 顺序一致。`DocsToc` 的 props 就是 `article.sections` —— 这里验的是"它真的从同一份数据来"，
  // 而不是"它看起来条数差不多"。少一节、多一节、顺序错、id 拼错，都会在这里红。
  expect(
    before.tocHrefs,
    `目录条目必须等于渲染出的分区（目录：${before.tocHrefs.join(' ')}）`,
  ).toEqual(before.sectionIds.map((id) => `#${id}`));
  expect(before.sectionIds.length, '这篇文章至少三节，目录才有意义').toBeGreaterThanOrEqual(3);
  expect(
    before.tocTexts.every((text, i) => text === before.sectionTitles[i]),
    `目录文字必须就是那几节的标题：${before.tocTexts.join(' / ')}`,
  ).toBe(true);

  const target = `#${before.sectionIds[before.sectionIds.length - 1]}`;
  expect(before.lastTop, '点之前最后一节应在视口之下（否则这条判据证明不了滚动）').toBeGreaterThanOrEqual(
    before.innerHeight,
  );

  // 🔴 用 `a.click()` 而不是 Playwright 的 `.click()`：后者会先把目标滚进视口，
  // 于是"滚动发生在跳转之后"这个判据被探针自己满足了（§7 第 83 条那一族：
  // 探针留下的状态就是判据的输入）。`click()` 派发的仍是真实的锚点激活。
  await page
    .locator(`#main .lp-docs__toc a[href="${target}"]`)
    .evaluate((a) => a.click());

  const after = await page.evaluate(
    (sel) => {
      const section = document.querySelector<HTMLElement>(sel);
      const header = document.querySelector('.lp-nav')?.getBoundingClientRect();
      return {
        path: location.pathname,
        hash: location.hash,
        scrollY: window.scrollY,
        top: section?.getBoundingClientRect().top ?? -1,
        headerBottom: header?.bottom ?? 0,
        innerHeight: window.innerHeight,
        h2: section?.querySelector('h2')?.textContent?.trim() ?? '',
      };
    },
    target,
  );

  expect(after.path, '跳转不许换页（目录是页内锚点，不是路由）').toBe('/help/how/');
  expect(after.hash, '地址栏带上这一节的锚点（这才叫"可分享的深链"）').toBe(target);
  expect(after.scrollY, '页面真的滚动了').toBeGreaterThan(0);
  // 🔴 两条几何判据，方向各一：不能顶到 sticky 页头**底下**（被盖住=看着没反应），
  // 也不能还在视口之外（没滚过去）。`.lp-row` 的 scroll-margin 就是为第一条存在的。
  expect(after.top, '目标分区不被顶部导航盖住').toBeGreaterThanOrEqual(after.headerBottom - 2);
  expect(after.top, '目标分区进入视口').toBeLessThan(after.innerHeight);
  expect(after.h2, '滚到的正是目录里那一条').toBe(before.sectionTitles[before.sectionTitles.length - 1]);

  await page.screenshot({ path: 'landing-results/landing-docs-toc-scrolled.png' });

  expectCleanConsole(hits);
});

/**
 * 一篇文档页在浏览器里应有的全部事实。
 *
 * 🔴 这一份探针**只管"内容真的到了页面上"**，与上面那六条管的"结构对不对"是两件事：
 * 结构判据在只有一篇文章时也能全绿，而本轮的失效形态恰恰是"注册了十四篇、
 * 其中几篇渲染出的是 key 或者一段没有"。
 */
async function readArticle(page: Page, path: string) {
  await page.goto(path);
  await page.locator('#main .lp-docs__nav').first().waitFor();
  await waitHeadRevealed(page);
  return page.evaluate(() => {
    const main = document.querySelector('#main')?.textContent ?? '';
    const sections = [...document.querySelectorAll<HTMLElement>('#main section.lp-row')];
    const toc = [...document.querySelectorAll<HTMLAnchorElement>('#main .lp-docs__toc a')];
    const current = [
      ...document.querySelectorAll<HTMLAnchorElement>(
        '#main .lp-docs__nav .lp-docs__link[aria-current="page"]',
      ),
    ].map((a) => a.getAttribute('href') ?? '');
    return {
      lang: document.documentElement.lang,
      h1: document.querySelector('h1')?.textContent?.trim() ?? '',
      // 一个 bodyKey = 一个 `<p class="lp-prose">`（见 PageSections.tsx），数段落就是数正文条数。
      proseCount: document.querySelectorAll('#main .lp-prose').length,
      proseChars: [...document.querySelectorAll('#main .lp-prose')].reduce(
        (n, p) => n + (p.textContent ?? '').trim().length,
        0,
      ),
      sectionIds: sections.map((s) => s.id),
      tocIds: toc.map((a) => (a.getAttribute('href') ?? '').replace(/^#/, '')),
      // 🔴 这里**原样交回 href**：`articleIdOf` 是本文件的 Node 侧函数，
      // `page.evaluate` 的回调会被序列化到浏览器里执行，看不见它（拿到的是 `not defined`）。
      currentHrefs: current,
      // 词条 key 泄漏长这样：`site.docs.trash.s1p1`。要求 `\bsite.` 后面紧跟两段名字，
      // 否则英文正文里句末的 "site." 会被当成泄漏（假红比没判据更糟）。
      leakedKeys: main.match(/\bsite\.[\w-]+\.[\w-]+/g) ?? [],
    };
  });
}

test('补进来的八篇中文文章每篇都有真正文：段落 ≥ 8、目录等于分区、页面上没有词条 key', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const hits = watchConsole(page);

  for (const id of NEW_ARTICLE_IDS) {
    const probe = await readArticle(page, `/help/${id}/`);
    // 🔴 元素截图（不是 fullPage）：这一条要看的判据是"正文有没有字数"，
    // 而 fullPage 拍不进内部滚动容器（本轮已实测过一次），`#main` 恰好是能整张拍下来的那个。
    await page.locator('#main').screenshot({ path: `landing-results/landing-article-${id}.png` });

    expect(probe.lang, `${id}：中文版 lang`).toBe('zh-CN');
    expect(probe.h1.length, `${id}：必须有 H1`).toBeGreaterThan(0);
    expect(/[一-鿿]/.test(probe.h1), `${id}：中文页标题应含中文：${probe.h1}`).toBe(true);
    expect(probe.proseCount, `${id}：正文段落数（死规矩 ≥ 8）`).toBeGreaterThanOrEqual(8);
    expect(probe.proseChars, `${id}：正文是真的有字数，不是空 p`).toBeGreaterThan(400);
    expect(
      probe.tocIds,
      `${id}：页内目录必须等于渲染出的分区（目录：${probe.tocIds.join(' ')} / 分区：${probe.sectionIds.join(' ')}）`,
    ).toEqual(probe.sectionIds);
    expect(
      probe.currentHrefs.map(articleIdOf),
      `${id}：侧栏当前项恰好是这一篇：${probe.currentHrefs.join(' ')}`,
    ).toEqual([id]);
    expect(
      probe.leakedKeys,
      `${id}：页面上出现了词条 key 字面量，说明某个 key 在词条表里查不到：${probe.leakedKeys.join(' ')}`,
    ).toEqual([]);
  }

  expectCleanConsole(hits);
});

test('同八篇的英文版不是中文回落：标题没有汉字、段落数与中文版一致', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const hits = watchConsole(page);

  for (const id of NEW_ARTICLE_IDS) {
    const zh = await readArticle(page, `/help/${id}/`);
    const en = await readArticle(page, `/en/help/${id}/`);
    await page.locator('#main').screenshot({ path: `landing-results/landing-article-${id}-en.png` });

    expect(en.lang, `${id}：英文版 lang`).toBe('en');
    // 🔴 这一条管的是"locale 解析回落到 zh-CN"：那样两版会渲染同一套词条，
    // 于是入口存在、段落数、目录、状态码**全都照样绿**，只有英文标题里的汉字会露馅。
    expect(/[一-鿿]/.test(en.h1), `${id}：英文页标题不该含中文：${en.h1}`).toBe(false);
    expect(en.h1, `${id}：两版标题必须不同`).not.toBe(zh.h1);
    expect(en.proseCount, `${id}：英文版段落数应与中文版一致`).toBe(zh.proseCount);
    expect(en.sectionIds, `${id}：分区 id 不随语言变`).toEqual(zh.sectionIds);
    expect(en.leakedKeys, `${id}：英文版同样不许漏 key`).toEqual([]);
  }

  expectCleanConsole(hits);
});

test('五个分类页都真的可达：卡片恰好是这一组的文章，侧栏亮着这一个分组', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const hits = watchConsole(page);

  for (const id of CATEGORY_IDS) {
    await page.goto(`/help/${id}/`);
    await page.locator('#main .lp-docs__nav').first().waitFor();
    await waitHeadRevealed(page);
    await page.locator('#main').screenshot({ path: `landing-results/landing-category-${id}.png` });

    const probe = await page.evaluate(() => {
      const groupLinks = [...document.querySelectorAll<HTMLAnchorElement>('#main .lp-docs__group-link')];
      const current = groupLinks.filter((a) => a.getAttribute('aria-current') === 'true');
      const group = current[0]?.closest('.lp-docs__group');
      return {
        h1: document.querySelector('h1')?.textContent?.trim() ?? '',
        currentCount: current.length,
        currentHref: current[0]?.getAttribute('href') ?? '',
        currentText: current[0]?.textContent?.trim() ?? '',
        groupArticleIds:
          group === null || group === undefined
            ? []
            : [...group.querySelectorAll<HTMLAnchorElement>('.lp-docs__link')].map((a) =>
                (a.getAttribute('href') ?? '').split('/').filter(Boolean).pop() ?? '',
              ),
        cardIds: [
          ...document.querySelectorAll<HTMLAnchorElement>('#main .lp-docs__card-link'),
        ].map((a) => (a.getAttribute('href') ?? '').split('/').filter(Boolean).pop() ?? ''),
        cardSumChars: [
          ...document.querySelectorAll<HTMLAnchorElement>('#main .lp-docs__card-link'),
        ].map(
          (a) => (a.querySelector('.lp-docs__card-sum')?.textContent ?? '').trim().length,
        ),
        articleCurrentCount: document.querySelectorAll('#main .lp-docs__link[aria-current="page"]')
          .length,
        navLinkTotal: document.querySelectorAll('#main .lp-docs__link').length,
        faqCount: document.querySelectorAll('#main .lp-faq__q').length,
        mainChars: (document.querySelector('#main')?.textContent ?? '').trim().length,
        leakedKeys: (document.querySelector('#main')?.textContent ?? '').match(
          /\bsite\.[\w-]+\.[\w-]+/g,
        ) ?? [],
      };
    });

    expect(probe.h1.length, `${id}：分类页必须有 H1`).toBeGreaterThan(0);
    expect(probe.currentCount, `${id}：当前分组必须恰好一个`).toBe(1);
    expect(probe.currentHref, `${id}：当前分组指向本页`).toBe(`/help/${id}/`);
    // 页标题与侧栏亮着的那一项是同一个词：两处各自 `t(module.titleKey)`，对不上就是有一处写错。
    expect(probe.currentText, `${id}：侧栏高亮的分组名必须就是页标题`).toBe(probe.h1);
    expect(probe.articleCurrentCount, `${id}：分类页不是文章，不该有当前文章项`).toBe(0);
    // 🔴 **每个分类都至少有 2 篇** —— 这是这一轮的完成条件之一，判据必须落在浏览器里，
    // 而不是落在 `docs.ts` 的条数上：入口能生成不代表卡片摆得出来。
    expect(
      probe.cardIds.sort(),
      `${id}：卡片必须恰好等于侧栏这一组的文章（卡片：${probe.cardIds.join(' ')}）`,
    ).toEqual([...probe.groupArticleIds].sort());
    expect(probe.cardIds.length, `${id}：这一组至少两篇`).toBeGreaterThanOrEqual(2);
    expect(probe.cardIds.length, `${id}：分类页只列这一组`).toBeLessThan(probe.navLinkTotal);
    expect(
      probe.cardSumChars.every((n) => n > 20),
      `${id}：每张卡都有一句话摘要（字数：${probe.cardSumChars.join(', ')}）`,
    ).toBe(true);
    expect(probe.faqCount, `${id}：分类页保留这一组的速答`).toBeGreaterThan(0);
    expect(probe.mainChars, `${id}：分类页正文有字数`).toBeGreaterThan(200);
    expect(probe.leakedKeys, `${id}：不许漏词条 key`).toEqual([]);
  }

  expectCleanConsole(hits);
});

/**
 * 文档中心此刻应有的五张配图：**`图 <文章注册序>-<该篇第几张>` + 文件名 + 挂在哪个分区**。
 *
 * 🔴 这张表与 `ARTICLE_IDS` 同理，是**独立重述**的：图号由 `docs.ts` 的 `docsFiguresOf()`
 * 从 `pages.ts` 的注册表顺序现算（`first-run` 是第 14 个页面 ⇒ `图 14-1`），
 * 测试里再 import 一遍就成了自我印证。加一篇没配图的文章、或把某篇在注册表里挪个位置，
 * 这张表必须跟着改 —— 而浏览器里那行字面必须对上，对不上就红。
 *
 * ⚠️ `file` 不是装饰：它是 `gen-help-figures.mjs` 落盘的复制品名。
 * 渲染器与生成器共用 `helpFigures.ts` 那一条命名规则，这里第三个视图对不上，
 * 说明有一处悄悄改了规则。
 */
const FIGURES: readonly {
  readonly article: string;
  readonly sectionId: string;
  readonly number: string;
  readonly file: string;
}[] = [
  { article: 'first-run', sectionId: 'first-screen', number: '图 14-1', file: 'W01-tasks.png' },
  { article: 'concepts', sectionId: 'habits', number: '图 15-1', file: 'W03-habits.png' },
  { article: 'views', sectionId: 'quadrant', number: '图 20-1', file: 'W02-quadrant.png' },
  { article: 'views', sectionId: 'timeline', number: '图 20-2', file: 'W05-timeline.png' },
  { article: 'trash', sectionId: 'tasks-only', number: '图 25-1', file: 'W07-trash.png' },
];

const FIGURED_ARTICLE_IDS = [...new Set(FIGURES.map((figure) => figure.article))];

/**
 * 打开一篇文章，把它**真的画出来的配图**逐张交回。
 *
 * 🔴 先滚到每张图，再判"图真的解码出来了"：`<img loading="lazy">` 在没进过视口时
 * `complete` 是 `false`、`naturalWidth` 是 `0` —— 不滚就判，测的是探针够不着，
 * 不是产品没画（项目记忆里的 e2e 探针陷阱第 1 条：`fullPage` 拍不进滚动容器，同一族）。
 */
async function readFigures(page: Page, path: string) {
  await page.goto(path);
  await page.locator('#main .lp-docs__nav').first().waitFor();
  await waitHeadRevealed(page);

  const imgs = page.locator('#main .lp-figure img');
  const count = await imgs.count();
  for (let i = 0; i < count; i += 1) {
    await imgs.nth(i).scrollIntoViewIfNeeded();
  }
  if (count > 0) {
    await page.waitForFunction(() =>
      [...document.querySelectorAll<HTMLImageElement>('#main .lp-figure img')].every(
        (img) => img.complete && img.naturalWidth > 0,
      ),
    );
  }

  return page.evaluate(() => {
    const figures = [...document.querySelectorAll<HTMLElement>('#main .lp-figure')].map((el) => {
      const img = el.querySelector('img');
      return {
        // 交回**渲染出来的字面**（`图 20-1`），不在这里拆成"前缀 + 数字"：
        // 这一条要验的正是页面上那一行读起来对不对，包括语言前缀。
        number: el.querySelector('.lp-figure__number')?.textContent?.trim() ?? '',
        sectionId: el.closest('section')?.id ?? '',
        src: img?.getAttribute('src') ?? '',
        alt: img?.getAttribute('alt')?.trim() ?? '',
        caption: el.querySelector('.lp-figure__caption')?.textContent?.trim() ?? '',
        naturalWidth: img?.naturalWidth ?? 0,
      };
    });
    return {
      figures,
      // 页面上所有指向复制品的 `<img>`：与 `.lp-figure img` 数量不等，
      // 就说明有一张图挂在正文里（不是配图槽）或者复制品被别处引用了。
      helpImgCount: document.querySelectorAll('#main img[src^="/assets/help/"]').length,
      proseCount: document.querySelectorAll('#main .lp-prose').length,
      leakedKeys: (document.querySelector('#main')?.textContent ?? '').match(
        /\bsite\.[\w-]+\.[\w-]+/g,
      ) ?? [],
    };
  });
}

test('五张配图真的挂在指定分区上：图号是「图 注册序-序」、图真的解码出来、alt 与说明都有字', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const hits = watchConsole(page);

  for (const id of FIGURED_ARTICLE_IDS) {
    const probe = await readFigures(page, `/help/${id}/`);
    const expected = FIGURES.filter((figure) => figure.article === id);

    // 🔴 元素截图（不是 fullPage），且**先截图再断言**（§6.2 规定一第 1、2 条）：
    // 这一条要看的判据是"那张图在页面上长什么样、压在它上面的图号写了什么"，
    // 而 `#main` 恰好是能整张拍下来的那个容器。
    await page
      .locator('#main')
      .screenshot({ path: `landing-results/landing-figures-${id}.png` });

    expect(probe.figures.length, `${id}：配图张数（页面上：${probe.figures.map((f) => f.number).join(' ')}）`).toBe(
      expected.length,
    );
    expect(probe.helpImgCount, `${id}：指向复制品的 <img> 数必须等于配图数`).toBe(
      expected.length,
    );

    expected.forEach((want, i) => {
      const got = probe.figures[i];
      if (got === undefined) return;
      // 图号那一行是**页面上的字面**：前缀来自词条，数字来自注册表顺序。
      // 对不上只有两种可能 —— 有人在页面里手写了编号，或者注册表顺序变了而没人回头改这一条。
      expect(got.number, `${id}：第 ${i + 1} 张的图号`).toBe(want.number);
      expect(got.sectionId, `${id}：第 ${i + 1} 张必须挂在分区 "${want.sectionId}" 里`).toBe(
        want.sectionId,
      );
      expect(got.src, `${id}：第 ${i + 1} 张的地址`).toBe(`/assets/help/${id}/${want.file}`);
      // 🔴 真像素：`naturalWidth` 为 0 的 <img> 是"有标签没内容"，
      // 而 src 写对、alt 写对、图号写对 —— 断言全绿而访客看到一块空框。
      expect(got.naturalWidth, `${id}：第 ${i + 1} 张必须真的解码出像素`).toBeGreaterThan(100);
      expect(got.alt.length, `${id}：第 ${i + 1} 张必须有 alt 描述：${got.alt}`).toBeGreaterThan(10);
      // caption 含图号那一行，所以判据是"图号以外还有字"。
      expect(
        got.caption.length,
        `${id}：第 ${i + 1} 张必须有说明文字：${got.caption}`,
      ).toBeGreaterThan(want.number.length + 10);
    });

    expect(probe.leakedKeys, `${id}：配图不许漏词条 key：${probe.leakedKeys.join(' ')}`).toEqual(
      [],
    );
  }

  expectCleanConsole(hits);
});

test('反向对照：没配图的十篇一张都不许多画，英文版整片不挂中文界面的图', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const hits = watchConsole(page);

  // 上半：`HELP_FIGURES` 里写的是空数组的那些篇，页面上必须**一张图都没有**。
  // 这一条管的是"图挂错文章"：映射表的 key 写错、或渲染器把整张表都倒给每一篇，
  // 上面那条"该有的有"照样全绿。
  for (const id of ARTICLE_IDS.filter((a) => !FIGURED_ARTICLE_IDS.includes(a))) {
    const probe = await readFigures(page, `/help/${id}/`);
    expect(
      probe.figures.map((f) => f.number),
      `${id}：这一篇不该有配图，画出来了就是挂错地方`,
    ).toEqual([]);
    expect(probe.helpImgCount, `${id}：正文里也不许出现复制品的地址`).toBe(0);
  }

  // 🔴 下半：英文版**整片不挂配图**。这不是省事 —— 那五张图全是中文界面截图
  // （采集脚本把 `locale: 'zh-CN'` 写死在判卷文件里），挂在英文正文中间就是错的东西。
  // 判据必须落在浏览器里：`DocsArticlePage` 那行 locale 判断一旦写反，
  // 英文页会出现一张中文界面的图 + 中文的「图」字，而段落数、目录、状态码**全都照样绿**。
  for (const id of FIGURED_ARTICLE_IDS) {
    const probe = await readFigures(page, `/en/help/${id}/`);
    await page
      .locator('#main')
      .screenshot({ path: `landing-results/landing-figures-${id}-en.png` });
    expect(probe.figures, `${id}：英文版不该渲染配图（图全是中文界面）`).toEqual([]);
    expect(probe.helpImgCount, `${id}：英文版不该引用复制品`).toBe(0);
    // 图没了，正文不能被一起挡掉：这一条把"locale 判据写反把整段正文吞了"也一并照住。
    expect(probe.proseCount, `${id}：英文版正文还在`).toBeGreaterThanOrEqual(4);
    expect(probe.leakedKeys, `${id}：英文版同样不许漏 key`).toEqual([]);
  }

  expectCleanConsole(hits);
});

/** 一条搜索结果行的形状（全部从 DOM 原样交回 —— `page.evaluate` 里看不见本文件的函数）。 */
interface SearchRow {
  readonly href: string;
  readonly title: string;
  readonly from: string;
  readonly section: boolean;
}

/** 当前页上挂着的结果行 + 空态/截断那两句话 + 输入框里的值。 */
async function readSearchRows(page: Page): Promise<{
  rows: SearchRow[];
  resultsMounted: boolean;
  emptyText: string;
  moreText: string;
  inputValue: string;
  blockText: string;
}> {
  return page.evaluate(() => {
    const links = [
      ...document.querySelectorAll<HTMLAnchorElement>('#main .lp-docs__search-link'),
    ];
    const box = document.querySelector('#main .lp-docs__search');
    return {
      rows: links.map((a) => ({
        href: a.getAttribute('href') ?? '',
        title: a.querySelector('.lp-docs__search-title')?.textContent?.trim() ?? '',
        from: a.querySelector('.lp-docs__search-from')?.textContent?.trim() ?? '',
        section: a.getAttribute('data-section') === 'true',
      })),
      resultsMounted: document.querySelector('#main .lp-docs__search-results') !== null,
      emptyText: document.querySelector('#main .lp-docs__search-empty')?.textContent?.trim() ?? '',
      moreText: document.querySelector('#main .lp-docs__search-more')?.textContent?.trim() ?? '',
      inputValue:
        document.querySelector<HTMLInputElement>('#main .lp-docs__search-input')?.value ?? '',
      blockText: box?.textContent?.trim() ?? '',
    };
  });
}

/** 一篇文章页此刻真实渲染出来的分区（`id` + 标题）—— 搜索锚点的对账对象。 */
async function readSections(page: Page, path: string): Promise<{ id: string; title: string }[]> {
  await page.goto(path);
  await page.locator('#main section.lp-row').first().waitFor();
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('#main section.lp-row')].map((s) => ({
      id: s.id,
      title: s.querySelector('h2')?.textContent?.trim() ?? '',
    })),
  );
}

/** 去掉锚点，取页面那一段（`/help/passphrase/#what-it-is` → `/help/passphrase/`）。 */
function pathOfHref(href: string): string {
  const i = href.indexOf('#');
  return i < 0 ? href : href.slice(0, i);
}

/** 只取锚点，不带 `#`。 */
function anchorOfHref(href: string): string {
  const i = href.indexOf('#');
  return i < 0 ? '' : href.slice(i + 1);
}

/**
 * 按目标页分组，把「搜索给的锚点」和「那一页上标题含这个词的节」并排交回来。
 *
 * 🔴 期望值**从页面自己算**，不写死锚点清单：新增一节、改一个标题、把锚点拼错，
 * 这三件事在这里长得都不一样，而写死的清单只能抓住其中一件。
 */
async function anchorsByPage(
  page: Page,
  rows: readonly SearchRow[],
  token: string,
): Promise<{ path: string; anchors: string[]; expected: string[] }[]> {
  const sectionRows = rows.filter((r) => r.section);
  const paths = [...new Set(sectionRows.map((r) => pathOfHref(r.href)))];
  const groups: { path: string; anchors: string[]; expected: string[] }[] = [];
  for (const path of paths) {
    const sections = await readSections(page, path);
    groups.push({
      path,
      anchors: sectionRows
        .filter((r) => pathOfHref(r.href) === path)
        .map((r) => anchorOfHref(r.href))
        .sort(),
      expected: sections
        .filter((s) => s.title.toLowerCase().includes(token.toLowerCase()))
        .map((s) => s.id)
        .sort(),
    });
  }
  return groups;
}

test('搜索搜的是当前语言的标题，命中分区就带锚点，且那个锚点页面上真有', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const hits = watchConsole(page);

  await page.goto('/help/');
  await page.locator('#main .lp-docs__search-input').first().waitFor();
  await waitHeadRevealed(page);

  await page.fill('#main .lp-docs__search-input', '口令');
  await page.locator('#main .lp-docs__search-link').first().waitFor();
  // ① 先落证据，再打分（§6.2 规定一）。
  await page.screenshot({ path: 'landing-results/landing-docs-search.png', fullPage: true });

  const zh = await readSearchRows(page);
  expect(zh.rows.length, `搜「口令」该有命中：${JSON.stringify(zh.rows)}`).toBeGreaterThanOrEqual(3);
  // 🔴 每一行的标题里都得有这个词 —— 匹配面**只有**标题。哪天有人把正文也塞进索引，
  // 这一条会红：那种搜索会在一篇文章里命中好几节，读者拿到的是同页不同位置的链接，
  // 那不是搜索是噪声；而文案里那句「搜标题里的关键词」也会变成界面在骗人。
  expect(
    zh.rows.every((r) => r.title.includes('口令')),
    `结果标题必须都含这个词：${zh.rows.map((r) => r.title).join(' / ')}`,
  ).toBe(true);
  expect(
    zh.rows.some((r) => r.href === '/help/passphrase/' && !r.section),
    '文章级命中：href 就是那一页，不带锚点',
  ).toBe(true);
  // `data-section` 与 href 里的 `#` 必须同进同退：一个是给读者看的形状，一个是给判据的。
  expect(
    zh.rows.every((r) => r.href.includes('#') === r.section),
    `带锚点的行必须标 data-section：${zh.rows.map((r) => `${r.href}[${r.section}]`).join(' ')}`,
  ).toBe(true);
  expect(
    zh.rows.filter((r) => r.section).every((r) => r.from.length > 0),
    '分区那一行要写清它属于哪一篇（不同篇有小节同名）',
  ).toBe(true);
  expect(zh.blockText, '搜索区不许漏词条 key').not.toMatch(/site\.[\w-]+\.[\w-]+/);

  const zhGroups = await anchorsByPage(page, zh.rows, '口令');
  expect(zhGroups.length, '至少对账两篇（口令那篇与丢失那篇），否则这条判据是空的').toBeGreaterThanOrEqual(
    2,
  );
  for (const group of zhGroups) {
    // 🔴 正反两个方向都判：锚点拼错 → 链接照样 200、照样跳过去、只是落在页顶，界面上
    // **没有任何东西会报**；标题含这个词却搜不出来 → 读者以为没写。
    expect(group.anchors, `${group.path}：搜索给的锚点必须就是含「口令」的那几节`).toEqual(
      group.expected,
    );
    expect(group.anchors.length, `${group.path}：这一篇至少命中一节`).toBeGreaterThan(0);
  }

  // 清除：输入清空之后结果区**整块下架**（常驻空列表会让侧栏那类计数判据数出一堆空条目）。
  await page.goto('/help/');
  await page.locator('#main .lp-docs__search-input').first().waitFor();
  await page.fill('#main .lp-docs__search-input', '口令');
  await page.locator('#main .lp-docs__search-clear').waitFor();
  await page.locator('#main .lp-docs__search-clear').click();
  await expect(page.locator('#main .lp-docs__search-results')).toHaveCount(0);
  const cleared = await readSearchRows(page);
  expect(cleared.inputValue, '清除按钮把输入框真的清空').toBe('');

  // 没命中要给一句话，不能一片空白 —— 空白读起来像"坏了"。
  await page.fill('#main .lp-docs__search-input', 'zzzqqq');
  await page.locator('#main .lp-docs__search-empty').waitFor();
  const none = await readSearchRows(page);
  expect(none.rows, '不该有命中却出了条目').toEqual([]);
  expect(none.emptyText.length, '没命中时那句提示要有字').toBeGreaterThan(0);
  expect(none.emptyText, '提示不许漏词条 key').not.toMatch(/site\.[\w-]+\.[\w-]+/);

  // 🔴 英文页搜英文标题：这条管的是"索引跟着语言走"。若索引是在 Node 侧按中文解析好的，
  // 英文页会出现中文标题的结果 —— 而入口存在、状态 200、段落数全照样绿。
  await page.goto('/en/help/');
  await page.locator('#main .lp-docs__search-input').first().waitFor();
  await page.fill('#main .lp-docs__search-input', 'passphrase');
  await page.locator('#main .lp-docs__search-link').first().waitFor();
  const en = await readSearchRows(page);
  expect(en.rows.length, `英文搜 passphrase 该有命中：${JSON.stringify(en.rows)}`).toBeGreaterThanOrEqual(
    2,
  );
  expect(
    en.rows.every((r) => /[一-鿿]/.test(r.title) === false),
    `英文页的结果标题不该有汉字（有=语言回落）：${en.rows.map((r) => r.title).join(' / ')}`,
  ).toBe(true);
  expect(
    en.rows.every((r) => r.href.startsWith('/en/')),
    `英文页的命中必须落在 /en/ 下：${en.rows.map((r) => r.href).join(' ')}`,
  ).toBe(true);
  for (const group of await anchorsByPage(page, en.rows, 'passphrase')) {
    expect(group.anchors, `${group.path}：英文锚点同样必须落在真实那一节`).toEqual(group.expected);
  }

  // 截断：上限是代码里的常量，而那一句要把数字带给读者（一个高频词能命中二十几条）。
  await page.goto('/en/help/');
  await page.locator('#main .lp-docs__search-input').first().waitFor();
  await page.fill('#main .lp-docs__search-input', 'the');
  await page.locator('#main .lp-docs__search-link').first().waitFor();
  const many = await readSearchRows(page);
  expect(many.rows.length, '结果必须截断在上限 8 条').toBe(8);
  expect(many.moreText, '截断必须说出来，那句里的数字就是上限').toContain('8');

  expectCleanConsole(hits);
});

test('窄屏上搜索框不靠抽屉就能用，且全页只有一个', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const hits = watchConsole(page);

  await page.goto('/help/sync/');
  await page.locator('#main .lp-docs__search-input').first().waitFor();
  await waitHeadRevealed(page);

  const narrow = await page.evaluate(() => {
    const box = document
      .querySelector('#main .lp-docs__search-input')
      ?.getBoundingClientRect();
    return {
      inputCount: document.querySelectorAll('#main .lp-docs__search-input').length,
      height: box?.height ?? 0,
      left: box?.left ?? -1,
      right: box?.right ?? -1,
      width: window.innerWidth,
      drawerOpen: document.querySelector('.lp-docs__drawer') !== null,
      overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });

  // 🔴 恰好一个输入框：窄屏时侧栏**渲染两份**（外面那一列 + 抽屉那一层），
  // 搜索若挂在侧栏里就会有两个框、两份状态 —— 那正是折叠状态被提到 DocsLayout 的理由。
  expect(narrow.inputCount, '全页只许一个搜索框').toBe(1);
  expect(narrow.drawerOpen, '不打开抽屉也要用得了搜索').toBe(false);
  expect(narrow.height, '窄屏上搜索框真的有高度（画出来了才谈得上能用）').toBeGreaterThan(20);
  expect(narrow.left, '不许左溢出').toBeGreaterThanOrEqual(0);
  expect(narrow.right, '不许右溢出').toBeLessThanOrEqual(narrow.width);
  expect(narrow.overflowX, '不该出现横向溢出').toBe(false);

  // 真在手机上搜一次：能输入、能出结果，抽屉不参与。
  await page.fill('#main .lp-docs__search-input', '口令');
  await page.locator('#main .lp-docs__search-link').first().waitFor();
  await page.screenshot({ path: 'landing-results/landing-docs-search-narrow.png', fullPage: true });
  const rows = await readSearchRows(page);
  expect(rows.rows.every((r) => r.title.includes('口令')), '窄屏出的是同一份结果').toBe(true);

  expectCleanConsole(hits);
});

/**
 * 分类 → 文章。与 `ARTICLE_IDS` 的分组线一致，同样**刻意独立重述**：
 * 这一条判的是"五个分类每个都有 ≥2 篇有正文的文章"，
 * 从注册表 import 就变成"注册表自己证明自己有多篇"，而注册表里放一篇也算数。
 */
const ARTICLE_BY_CATEGORY: Record<string, string[]> = {
  start: ['first-run', 'concepts'],
  sync: ['how', 'account', 'passphrase', 'conflict'],
  organize: ['views', 'repeat', 'reminders'],
  data: ['selfhost', 'transfer', 'trash'],
  trust: ['privacy', 'loss'],
};

test('五个分类每个都有 ≥2 篇有正文的文章：十四篇 × 中英两版逐个在浏览器里数段落', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const hits = watchConsole(page);
  const lines: string[] = [];

  for (const [category, ids] of Object.entries(ARTICLE_BY_CATEGORY)) {
    // 🔴 「有正文」只由**页面上数出来的段落**决定，不由注册表决定：
    // 一篇注册了但正文词条空掉的文章，会从这里掉出去，而不是从这里蒙过去。
    const zhDeep: string[] = [];
    const enDeep: string[] = [];
    const rows: string[] = [];

    for (const id of ids) {
      const zh = await readArticle(page, `/help/${id}/`);
      await page.locator('#main').screenshot({ path: `landing-results/landing-body-${id}.png` });
      const en = await readArticle(page, `/en/help/${id}/`);

      expect(zh.lang, `${id}：中文版 lang`).toBe('zh-CN');
      expect(en.lang, `${id}：英文版 lang`).toBe('en');
      expect(en.h1, `${id}：英文版标题不该是中文`).not.toBe(zh.h1);
      expect(/[一-鿿]/.test(en.h1), `${id}：英文版标题漏汉字：${en.h1}`).toBe(false);
      expect(zh.leakedKeys, `${id}：中文版漏词条 key`).toEqual([]);
      expect(en.leakedKeys, `${id}：英文版漏词条 key`).toEqual([]);
      if (zh.proseCount >= 5 && zh.proseChars >= 300) zhDeep.push(`${id}(${zh.proseCount}段/${zh.proseChars}字)`);
      if (en.proseCount >= 5 && en.proseChars >= 300) enDeep.push(`${id}(${en.proseCount}段/${en.proseChars}字)`);

      rows.push(
        `${category.padEnd(9)} ${id.padEnd(11)} zh ${String(zh.proseCount).padStart(2)}段/${String(
          zh.proseChars,
        ).padStart(4)}字 · en ${String(en.proseCount).padStart(2)}段/${String(en.proseChars).padStart(4)}字`,
      );
    }

    rows.push(
      `→ ${category}: 中文有正文 ${zhDeep.length} 篇 / 英文有正文 ${enDeep.length} 篇（清单：${zhDeep.join(' ')}）`,
    );
    // 🔴 打印必须在断言**之前**：这张表是失败时唯一的证据，放在循环外面就等于没有。
    console.log(rows.join('\n'));
    lines.push(...rows);
    expect(zhDeep.length, `${category}：中文版有正文的文章数（死规矩 ≥ 2）`).toBeGreaterThanOrEqual(2);
    expect(enDeep.length, `${category}：英文版有正文的文章数（死规矩 ≥ 2）`).toBeGreaterThanOrEqual(2);
  }
  expectCleanConsole(hits);
});
