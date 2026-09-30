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
 */
const ARTICLE_IDS = ['how', 'account', 'passphrase', 'conflict', 'selfhost', 'transfer'];

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
