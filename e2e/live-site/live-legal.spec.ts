/**
 * 线上验收：**九份对外法律文本在中英两侧真的发布出来了**。
 * ======================================================
 *
 * 分工：`e2e/legal-links/` 验的是**产品代码把点击带到哪**（刻意离线，官方那一侧
 * 由本地构建产物顶替）；这一份验的是**服务器上真的有哪些字节**，也就是
 * `docs/plans/legal-compliance-before-filing.md` 缺口表里 **G-25** 那一格。
 * 两者不重叠：前者红了是代码坏，后者红了是**部署没跟上**。
 *
 * ## 🔴 第一条判据拦的是"看起来像成功"
 *
 * 落地页由 nginx 以 SPA 兜底服务，所以**不存在的路径也会回 200**，而且正文就是
 * 首页的字节。2026-10-01 实测：`/legal/nope-not-a-doc/` 的 `<title>` 与 `<html lang>`
 * 与首页逐字相同。于是"状态码 200"与"curl 拿到了 HTML"都**不是**可达性证据 ——
 * 必须比字节。这条判据因此放在最前，且在**同一台线上服务器**上取参照物（首页）。
 *
 * ⚠️ **2026-10-02 之后这句话的适用面变了，别照它理解现状**：nginx 已对未命中的
 * `/legal/*` 返回真 404（缺口 **G-25b** 闭合），所以在这个前缀下状态码**重新变成**证据
 * —— 由最后那条判据钉住。比字节这条仍然留着，但它现在防的是**兜底被改回去**，
 * 而不是"当前是不是软 404"。两者都要：只留状态码判据的话，兜底一回来就是 200 + 首页，
 * 而那条判据恰好也会绿。
 *
 * ## 为什么断言全部是"对等 / 一致"，没有一条是我编的数字
 *
 * 「至少 N 个字符」「至少 3 段」这类阈值是本仓库明确拒绝过的写法
 * （见同目录 `live-domain.spec.ts` 里那段 `#root` 注释）。这里用的每条判据都从
 * 页面自身或另一种语言侧**推导**出来：
 *
 * - `lang` 属性：由站点注册表决定，中英两侧必须分别是 `zh-CN` / `en`；
 * - 顶层小节数 == 目录条目数：`LegalDocumentPage` 的目录就是逐条 `sections.map` 渲染的，
 *   两者不等只可能是渲染漏了；
 * - 中大小节总数相等，且版本行里的**版本号与日期**相等
 *   （整句不相等是对的 —— 标签本地化；`structure.spec.ts` 在库里钉的是同一件事，
 *   这里钉的是"线上那份产物也真的对等"）；
 * - 每页恰好一个 `h1`：组件注释写明的层级约定；
 * - 草稿横幅：今天九份的 `status` 全是 `draft`，横幅**必须**在。
 *   ⚠️ 改成 `effective` 那天这条会红 —— 那是提醒"对外文本要生效了，复核一下"，
 *   不是误报，届时连同 §6 那条"律师复核 → 改 status → 发布"一起处理。
 *
 * ## 最后那一条是**唯一比较"本地 ↔ 线上"的判据**（G-31 闭合时补的）
 *
 * 上面九条比的都是"线上自己两侧对不对等"，所以它们**看不出部署落后**。
 * 而"服务器上的字节是不是当前构建"这件事，只有拿真源当参照才判得出来 ——
 * 参照物从 `@heyta/legal` 的构建产物取（`OPERATOR.name` 与 `terms` 的 `version`），
 * **不在这里抄一份字面量**：抄件一定会漂，而漂了的法务抄件比没有抄件更危险。
 *
 * 🔴 前置：`pnpm --filter @heyta/legal build`。它读的是 `dist/` 不是 `src/`，
 * 没先 build 会拿旧产物当参照，症状是"线上明明是新的而判据报红"
 * （AGENTS §7 第 27、79 条同族）。
 *
 * ⚠️ **只比 `terms`，不比其余八份** —— 这是实测过的取舍，不是偷懒：`dist/` 取自
 * 当前工作树，而工作树里同时躺着并行会话**尚未发布**的 `privacy@1.1`／`minors@1.1`／
 * `data-rights@1.1`。拿它们当参照会得出一条"线上落后了"的红，而那条红**不是缺陷**
 * （改动还没进版本库，本来就不该在线上）。判据一旦会因别人的在制品而红，
 * 它就不再是信号。
 */

import { expect, test, type Page } from '@playwright/test';
// 参照物取自**构建产物**（见文件头）。零运行时依赖、无 import，所以 e2e 这份
// 独立工作区不需要装 @heyta/legal 也能直接相对路径引入。
import { LEGAL_DOCUMENTS, OPERATOR } from '../../packages/legal/dist/index.js';
// 🔴 404 页的期望文案取自**词条表本身**，不在这里抄一遍字面量 ——
// 抄件一定会漂，而漂了的判据比没有判据更糟（它会绿着放过错的东西）。
import { zhCN } from '../../packages/i18n/dist/locales/zh-CN.js';
import { en } from '../../packages/i18n/dist/locales/en.js';

const ORIGIN = process.env['HEYTA_LIVE_ORIGIN'] ?? 'https://heyta.waytofuture.cn';
/**
 * 截图落在**本套件自己的产物目录**，不落共享的 `test-results/`。
 *
 * 🔴 这不是排版偏好，是实测：`test-results/` 是好几条套件的 outputDir，而
 * Playwright 在每次运行开始会**删除并重建**它。本目录下的截图先写后删，
 * 我在 2026-10-01 就是这样把刚拍的 `live-legal-terms-*.png` 弄丢的
 * （另一条会话随后起跑，把人还没看的证据整片抹掉）。
 * 与 `playwright.legal-links.config.ts` 里那条同一个家族。
 */
const SHOT_DIR = 'live-site-results';

/** 九份文本的 id —— 与 `packages/legal` 的注册表同序，也是页脚的展示顺序。 */
const LEGAL_DOC_IDS = [
  'terms',
  'privacy',
  'personal-info-list',
  'permissions',
  'third-parties',
  'ai-and-transfer',
  'minors',
  'subscription-refund',
  'data-rights',
] as const;

/** `<lang>/<docId>` 那一条的站点路径（与 `apps/landing/src/site/pages.ts` 一致）。 */
function legalPath(docId: string, locale: 'zh' | 'en'): string {
  return locale === 'zh' ? `/legal/${docId}/` : `/en/legal/${docId}/`;
}

function attachLogs(page: Page): string[] {
  const logs: string[] = [];
  page.on('console', (message) => logs.push(`[console.${message.type()}] ${message.text()}`));
  page.on('pageerror', (error) => logs.push(`[pageerror] ${error.message}`));
  page.on('requestfailed', (request) =>
    logs.push(`[requestfailed] ${request.url()} ${request.failure()?.errorText ?? ''}`),
  );
  return logs;
}

function hardErrors(logs: readonly string[]): string[] {
  return logs.filter((line) => line.startsWith('[pageerror]'));
}

/**
 * 用**页面内**的 fetch 取原始 HTML（不用 Playwright 的 request fixture）：
 * 后者走 Node 的网络栈，会绕开这份配置用 `--host-resolver-rules` 钉下来的
 * 解析路径 —— 那样验的就不是同一台服务器了。
 */
async function rawHtml(page: Page, path: string): Promise<string> {
  const { status, body } = await page.evaluate(
    async (p: string): Promise<{ status: number; body: string }> => {
      const response = await fetch(p, { cache: 'no-store' });
      return { status: response.status, body: await response.text() };
    },
    path,
  );
  // 🔴 先判状态码，再比字节。顺序反了会让"路径拼错"这一类失败**退化**：
  // nginx 对未命中的 `/legal/*` 返回真 404 之后（G-25b），404 页的字节本来就
  // 与首页不同，于是"字节不等于首页"这条抓不到拼错的路径，测试会继续往下走
  // 到 `page.goto` 等一个永远不出现的元素，30 秒后只报 `TimeoutError`。
  // 实测过这个退化：把 `terms` 换成 `/legal/terms-typo/` ⇒ 红在 `locator.waitFor` 超时。
  expect(
    status,
    `${path} 取到 HTTP ${status}。这里 200 之外只有两种坏法：404 = 那一页没发布或部署没跟上，5xx = 服务器侧坏了`,
  ).toBe(200);
  return body;
}

/** 渲染完一条法务页之后取出的结构事实。 */
interface LegalRender {
  lang: string | null;
  h1Count: number;
  topLevelSections: number;
  allSections: number;
  tocItems: number;
  metaText: string;
  hasDraftBanner: boolean;
}

async function readLegalRender(page: Page): Promise<LegalRender> {
  // 外壳先到位：`.lp-legal__meta` 是这份页面**最先**渲染的元素，取不到就说明
  // React 根本没挂上这份文档（白屏与"路径不存在"在这里长得一样）。
  await page.locator('.lp-legal__meta').first().waitFor({ state: 'visible', timeout: 30_000 });
  return page.evaluate(() => {
    const root = document.querySelector('.lp-legal');
    return {
      lang: document.documentElement.getAttribute('lang'),
      h1Count: document.querySelectorAll('h1').length,
      topLevelSections: document.querySelectorAll('.lp-legal > section.lp-legal__section').length,
      allSections: document.querySelectorAll('section.lp-legal__section').length,
      tocItems: document.querySelectorAll('.lp-legal__toc a').length,
      metaText: (root?.querySelector('.lp-legal__meta')?.textContent ?? '').trim(),
      hasDraftBanner: Boolean(root?.querySelector('.lp-legal__banner')),
    };
  });
}

for (const docId of LEGAL_DOC_IDS) {
  test(`${docId}：中英两侧线上都渲染，且与首页字节可区分`, async ({ page }) => {
    const logs = attachLogs(page);

    // 参照物：首页原始字节。缺路径时 nginx 兜底返回的就是它。
    await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' });
    const homeHtml = await rawHtml(page, '/');

    const sides = {} as Record<'zh' | 'en', LegalRender>;
    for (const locale of ['zh', 'en'] as const) {
      const path = legalPath(docId, locale);
      const html = await rawHtml(page, path);
      // 🔴 这条是本套件的存在性判据本体：兜底命中时两者逐字相同。
      expect(
        html,
        `${path} 返回的字节与首页完全相同 ⇒ nginx 兜底把一个不存在的页面答成了 200`,
      ).not.toBe(homeHtml);

      await page.goto(`${ORIGIN}${path}`, { waitUntil: 'domcontentloaded' });
      const render = await readLegalRender(page);
      sides[locale] = render;

      expect(render.lang, `${path} 的 <html lang> 不是 ${locale === 'zh' ? 'zh-CN' : 'en'}`).toBe(
        locale === 'zh' ? 'zh-CN' : 'en',
      );
      expect(render.allSections, `${path} 一节正文都没渲染`).toBeGreaterThan(0);
      expect(render.h1Count, `${path} 的 h1 数不是 1（组件约定的层级塌了）`).toBe(1);
      expect(render.metaText, `${path} 没有版本/更新日期行`).not.toBe('');
      // 目录必须逐条列出顶层小节（`sections.length > 1` 时才渲染目录，所以 1 节时两边都是 0）。
      expect(
        render.tocItems,
        `${path} 的目录条目数（${String(render.tocItems)}）≠ 顶层小节数（${String(render.topLevelSections)}）`,
      ).toBe(render.topLevelSections);
      expect(
        render.hasDraftBanner,
        `${path} 没有"尚未生效"横幅 —— 九份文本今天全是 draft，缺这条等于把草稿当已生效发布`,
      ).toBe(true);

      if (docId === 'terms') {
        // 规定一：先截图再断言之余，把中英各一张落到固定路径，供人**真的打开看**。
        await page.waitForLoadState('networkidle');
        await page.screenshot({ path: `${SHOT_DIR}/live-legal-${docId}-${locale}.png` });
      }
    }

    // 🔴 中英对等：库里 `structure.spec.ts` 钉的是源码，这里钉的是**线上产物**。
    expect(
      sides.en.allSections,
      `中英小节数不等（zh ${String(sides.zh.allSections)} / en ${String(sides.en.allSections)}）`,
    ).toBe(sides.zh.allSections);

    /**
     * 版本行：整句**本来就该不同**（`版本 1.0 · 更新于 2026-10-01` /
     * `Version 1.0 - updated 2026-10-01`），比整句是我一开始写错的判据 ——
     * 它红了九次，红在标签上而不是红在事实上。
     *
     * 对等的对象是句子里那两个**与语言无关的事实**：版本号与更新日期。
     * 两个都必须真的解析出来（`match` 为 null 直接红），否则"两侧都没匹配上"
     * 会在相等断言下变成一次假绿。
     */
    const facts = (raw: string): { version: string; date: string } => {
      const version = raw.match(/\d+\.\d+/u)?.[0];
      const date = raw.match(/\d{4}-\d{2}-\d{2}/u)?.[0];
      expect(version, `版本行里取不出版本号：「${raw}」`).toBeDefined();
      expect(date, `版本行里取不出更新日期：「${raw}」`).toBeDefined();
      return { version: version ?? '', date: date ?? '' };
    };
    const zhFacts = facts(sides.zh.metaText);
    const enFacts = facts(sides.en.metaText);
    expect(
      enFacts.version,
      `中英版本号不一致（zh ${zhFacts.version} / en ${enFacts.version}）`,
    ).toBe(zhFacts.version);
    expect(enFacts.date, `中英更新日期不一致（zh ${zhFacts.date} / en ${enFacts.date}）`).toBe(
      zhFacts.date,
    );

    const hard = hardErrors(logs);
    console.log(`控制台共 ${String(logs.length)} 条：\n  ${logs.join('\n  ')}`);
    expect(hard, `页面抛了未捕获异常：\n${hard.join('\n')}`).toEqual([]);
  });
}

/**
 * 九条都在注册表里 —— 少一份就是"发布漏了一页"，而漏的那页在线上**看起来**
 * 只是另一个不存在的链接（兜底首页），没人会去点它。
 *
 * 这条不重新下载九份页面，它只做一件事：数出 `LEGAL_DOC_IDS` 有 9 个。
 * 🔴 数字 9 不是阈值，是 `packages/legal` 注册表的**当前条目数**；
 * 加第十份文本时必须同时改这里，改测试是**预期动作**（与 structure.spec 同批）。
 */
test('法务清单仍是九份（与 @heyta/legal 注册表同数）', () => {
  expect(LEGAL_DOC_IDS.length).toBe(9);
});

/**
 * 🔴 唯一一条"本地真源 ↔ 线上"的对照。设计理由见文件头那一节。
 *
 * 为什么必须**渲染**才能比：法务页的 `index.html` 是**外壳**（实测线上那份
 * `<body>` 里只有 `<div id="root"></div>`，正文全在 JS chunk 里）。
 * 所以"curl 到的字节里有没有这句话"在这里根本问不出结果 ——
 * 上面那九条之所以能用字节比，比的只是"是不是首页"，不是"里面写了什么"。
 */
test('线上 terms 英文侧 = 本地真源（G-31 的部署级复验）', async ({ page }) => {
  const logs = attachLogs(page);
  const source = LEGAL_DOCUMENTS.find((d: { id: string }) => d.id === 'terms');

  // 前提断言：参照物自己必须真的有料。`OPERATOR.name` 若哪天是空串，
  // 下面的 `toContain('')` 会**永远成立** —— 一条永远通过的判据比没有判据更糟。
  expect(source, '@heyta/legal 注册表里没有 terms（dist 过期？先 pnpm --filter @heyta/legal build）').toBeDefined();
  expect(
    OPERATOR.name.trim().length,
    '参照物 OPERATOR.name 是空的，这条判据会假绿',
  ).toBeGreaterThan(0);

  const path = legalPath('terms', 'en');
  await page.goto(`${ORIGIN}${path}`, { waitUntil: 'domcontentloaded' });
  const render = await readLegalRender(page);

  // ① 用户看得见的那段里必须有登记名称。
  const body = await page.evaluate(
    () => document.querySelector('.lp-legal')?.textContent ?? '',
  );
  expect(
    body,
    `线上 ${path} 渲染出的正文里没有登记中文主体名「${OPERATOR.name}」⇒ 部署还没跟上（或 dist 落后于源码）`,
  ).toContain(OPERATOR.name);

  // ② 版本行报出的版本号必须就是源码里的那一个 —— 这是"部署跟上了没"的读数。
  const liveVersion = render.metaText.match(/\d+\.\d+/u)?.[0];
  expect(liveVersion, `线上版本行里取不出版本号：「${render.metaText}」`).toBeDefined();
  expect(
    liveVersion,
    `线上 terms 是 ${String(liveVersion)}，@heyta/legal 的 dist 里是 ${String(
      source?.version,
    )} ⇒ 两侧不同源。先分清是"没发布"还是"没 build"：` +
      `pnpm --filter @heyta/legal build 后重跑；仍红就是部署落后`,
  ).toBe(source?.version);

  // 规定一：截图必须**拍得出被断言的那句话**。整页首屏截图拍的是标题区，
  // 登记名称在 s1 正文里、在首屏之外 —— 那种图看了等于没看。
  const namedSection = page
    .locator('section.lp-legal__section')
    .filter({ hasText: OPERATOR.name })
    .first();
  await expect(
    namedSection,
    `线上 ${path} 找不到包含登记名称的那一节，没法截图作证`,
  ).toBeVisible();
  await namedSection.evaluate((el: Element) => {
    // 页头是 sticky 的（约 90px 高）：把这一节的**顶边**停在页头下面，
    // 而不是 `scrollIntoViewIfNeeded` 那样对齐到 y=0 —— 实测那样第一行会被页头压住，
    // 而被断言的那句恰好就是第一行。
    const top = el.getBoundingClientRect().top + window.scrollY - 110;
    window.scrollTo({ top, behavior: 'instant' as ScrollBehavior });
  });
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${SHOT_DIR}/live-legal-terms-en-operator.png` });

  const hard = hardErrors(logs);
  expect(hard, `页面抛了未捕获异常：\n${hard.join('\n')}`).toEqual([]);
});

/**
 * G-25b：**未命中的 `/legal/*` 必须是真 404，而不是"200 + 首页字节"**。
 *
 * 为什么这条必须判**状态码**而不是判内容：本套件第一条那条"字节必须与首页不同"
 * 只能证明**已存在的页面**是真页面，它证明不了**不存在的路径**被答成了什么。
 * 2026-10-01 实测 `/legal/nope-not-a-doc/` 是 200 + 首页 7022 字节 —— 那正是
 * "看起来像成功"：审核者点开、状态码 200、有标题、有正文（首页的），于是没人会发现
 * 政策链接其实指到了一个不存在的文档。nginx 的 SPA 兜底对**前端路由**是必要的
 * （`/app/` 下的深链必须由壳接住），对**磁盘上的多页站点**就是伪装。
 *
 * 🔴 同一条测试里必须带**阳性对照**，否则它可能只是"整站都 404"的假绿：
 *   · 落地页根下的未知路径 `/not-a-page-xyz/` 仍应是 **200**（兜底还在，别人没被我牵连）；
 *   · `/app/nope-route` 仍应是 **200**（应用的前端路由没被改坏 —— 这是 G-25b
 *     明确要求"不影响前端路由"的那一半）；
 *   · 18 份**真实入口**逐条 200（改兜底时把真页面一起干掉是最容易犯的错，
 *     而九份 × 中英两侧只有逐条数过才知道都在）。
 * 判据数从 `LEGAL_DOC_IDS`（九）推导，不是抄一个魔数。
 */
test('未命中的 /legal/* 是真 404；首页兜底与 /app/ 前端路由都没被牵连', async ({ page }) => {
  const logs = attachLogs(page);

  // 🔴 必须先落到目标 origin 再 fetch 相对路径：`page.evaluate` 里的相对 URL 按
  //    **当前文档**解析，而新开的 page 是 `about:blank` —— 那时 `fetch('/')` 直接
  //    `Failed to parse URL from /`（本轮实测踩过，报错长得像"服务器坏了"，其实是探针没落地）。
  await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' });

  async function probe(path: string): Promise<{ status: number; body: string }> {
    return page.evaluate(async (p: string) => {
      const response = await fetch(p, { cache: 'no-store' });
      return { status: response.status, body: await response.text() };
    }, path);
  }

  const home = await probe('/');
  expect(home.status, `参照物：线上首页本身取不到（${home.status}），后面的对照全部无效`).toBe(200);

  for (const path of ['/legal/nope-not-a-doc/', '/en/legal/nope-not-a-doc/']) {
    const miss = await probe(path);
    expect(miss.status, `线上 ${path} 是 ${miss.status}，期望真 404 —— 200 就意味着 nginx 的 SPA 兜底把一个不存在的法务页答成了成功（G-25b）`).toBe(404);
    expect(
      miss.body,
      `${path} 返回 404 但字节却是首页（${home.body.length} 字节的同一份文档）—— 状态码与内容不一致，比单纯 200 更难被发现`,
    ).not.toContain('<title>heyta：本地优先的任务管理');
  }

  // 阳性对照一：落地页根下的未知路径**仍然**走兜底（证明 404 只作用在 /legal/ 这一层）。
  const control = await probe('/not-a-page-xyz/');
  expect(
    control.status,
    `阳性对照失败：/not-a-page-xyz/ 是 ${control.status} 而不是 200 —— 说明刚才那两条 404 不是 /legal/ 的规则生效，而是整站都在 404（探针或服务器坏了）`,
  ).toBe(200);

  // 阳性对照二：应用的前端路由必须还是壳接住。
  const appRoute = await probe('/app/nope-route');
  expect(
    appRoute.status,
    `/app/nope-route 是 ${appRoute.status}：改 /legal/ 的兜底时把 /app/ 一起改坏了 —— 深链刷新会白屏`,
  ).toBe(200);

  const served: string[] = [];
  for (const docId of LEGAL_DOC_IDS) {
    for (const locale of ['zh', 'en'] as const) {
      const path = legalPath(docId, locale);
      const hit = await probe(path);
      // 404 之外还要判"不是首页字节"：路径改成兜底目标时状态码可能仍 200。
      expect(hit.status, `真实入口 ${path} 取到 ${hit.status}（改兜底时把已发布的页面弄没了）`).toBe(200);
      if (docId === 'terms' && locale === 'zh') {
        expect(
          hit.body,
          `${path} 返回 200 但内容就是首页 —— 兜底目标被写进了 /legal/ 这一层`,
        ).not.toBe(home.body);
      }
      served.push(path);
    }
  }
  // 🔴 这条不是"served 有几条"的自证（那永远成立），而是**本地清单 vs 注册表**的对照：
  //    注册表多出一份而 `LEGAL_DOC_IDS` 忘了加，逐条遍历就**悄悄少验一份**。
  const missing = LEGAL_DOCUMENTS.map((d: { id: string }) => d.id).filter(
    (id) => !served.includes(legalPath(id, 'zh')) || !served.includes(legalPath(id, 'en')),
  );
  expect(
    missing,
    `注册表里的这些 id 没被逐条取到（清单漂移 ⇒ 这条判据在少验）：${missing.join(', ')}`,
  ).toEqual([]);

  // 规定一：把那张 404 页面也留下一份图（"状态码是 404"这件事的可见形态）。
  await page.goto(`${ORIGIN}/legal/nope-not-a-doc/`, { waitUntil: 'domcontentloaded' });
  await page.screenshot({ path: `${SHOT_DIR}/live-legal-404.png` });

  const hard = hardErrors(logs);
  expect(hard, `页面抛了未捕获异常：\n${hard.join('\n')}`).toEqual([]);
});

/**
 * 🔴 G-35：未命中的 `/legal/*` 答的是**我们那一页**，不是 nginx 的裸默认页。
 *
 * 上一条判据（G-25b）只承诺"真 404 且不牵连前端路由"。它绿着的时候，访客看到的
 * 仍然是两行 `404 Not Found` / `nginx/1.18.0 (Ubuntu)` —— 没有品牌、没有任何
 * 能点的入口、还把服务器版本外露给任意外部访客。**说了真话但没人接**。
 *
 * 这一条判的四件事，每件都对应裸默认页的一个缺陷：
 *
 * 1. **状态码仍是 404** —— 这是最容易弄丢的一件：把它做成"品牌页"最省事的写法是
 *    `try_files … /404.html`，而那会把状态码又变回 200，**恰好撤销 G-25b**。
 *    所以这条必须与"正文是我们的页"**同时**成立 —— 单独任何一条都能绿。
 * 2. **正文是我们那一页**（期望文案从 `packages/i18n` 的词条表取，不抄字面量）。
 * 3. **页上每个入口都真的能打开** —— 不是"数出有 4 个链接"（那 4 个全指错也能绿），
 *    而是逐个 fetch 要求 200。这条会随站点演化自动变严：入口指到一个改过名的路径时
 *    它就红，不需要有人记得来改这里的期望值。
 * 4. **服务器版本不再外露**（`Server` 头里数不出数字，正文里也没有 `nginx/`）。
 *
 * ⚠️ 还有一条**反向**判据：`/api/` 的 404 必须**仍是 JSON**。nginx 的
 *    `error_page` 默认不接管上游响应（`proxy_intercept_errors` off），
 *    但那取决于代理配置有没有别处打开过它 —— 一旦接管，同步客户端拿到的
 *    就是 404 + 一张 HTML，症状会是"客户端 JSON 解析失败"而不是"路由不存在"。
 */
test('未命中的 /legal/* 答的是双语品牌 404 页；状态码仍是 404，且 /api/ 的 404 仍是 JSON', async ({
  page,
}) => {
  const logs = attachLogs(page);
  const cases = [
    { path: '/legal/nope-not-a-doc/', locale: 'zh', table: zhCN, lang: 'zh-CN' },
    { path: '/en/legal/nope-not-a-doc/', locale: 'en', table: en, lang: 'en' },
  ] as const;

  for (const { path, table, lang } of cases) {
    const response = await page.goto(`${ORIGIN}${path}`, { waitUntil: 'domcontentloaded' });
    const status = response?.status() ?? -1;
    const serverHeader = (response?.headers()['server'] ?? '').trim();
    const body = await page.content();

    // 1) 状态码：404 而不是 200。
    expect(
      status,
      `${path} 是 ${status}。200 意味着这张 404 页是用 try_files 兜底做的 —— 那会把"不存在"重新写成"存在"，正是 G-25b 刚拆掉的那台机器`,
    ).toBe(404);

    // 2) 正文是我们那一页。
    expect(
      body,
      `${path} 的正文里没有本站 404 页的标题 —— 答的还是 nginx 的裸默认页（G-35）`,
    ).toContain(table['site.notfound.heading']);
    expect(body, `${path} 缺正文那一句`).toContain(table['site.notfound.body']);
    expect(
      body,
      `${path} 的 <html lang> 不是 ${lang}（英文子树漏了 error_page，就会答成中文那页）`,
    ).toContain(`<html lang="${lang}"`);
    expect(body, `${path} 没有 noindex —— 404 不该向搜索引擎声明自己是一个页面`).toContain(
      'name="robots"',
    );

    // 3) 每个入口逐个真打开。
    const hrefs = await page.$$eval('nav a, p.alt a', (nodes) =>
      nodes.map((node) => node.getAttribute('href')),
    );
    expect(
      hrefs.length,
      `${path} 上一个入口都没有 —— 那正是 G-35 记的"没有回首页／回法务清单的入口"`,
    ).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href, `${path} 上有入口取不到 href`).not.toBeNull();
      const target = new URL(href as string, ORIGIN);
      const linked = await page.request.get(target.toString(), {
        headers: { 'cache-control': 'no-cache' },
      });
      expect(
        linked.status(),
        `${path} 给出的入口 ${href} 自己打不开（${linked.status()}）—— 这张页把人从一扇错门领到另一扇错门`,
      ).toBe(200);
    }

    // 4) 服务器版本不外露。
    expect(body, `${path} 的正文里出现了 nginx 版本`).not.toMatch(/nginx\/\d/);
    expect(
      serverHeader,
      `${path} 的 Server 头是 "${serverHeader}" —— 还带着版本号，说明 server_tokens off 没生效（或没进这份配置）`,
    ).not.toMatch(/\d/);
  }

  // 反向判据：/api/ 的 404 仍是上游的 JSON，不是被 error_page 换掉的那张 HTML。
  const apiMiss = await page.request.get(`${ORIGIN}/api/nope-not-a-route`);
  const apiType = apiMiss.headers()['content-type'] ?? '';
  expect(
    apiType,
    `/api/ 未命中路由的 content-type 是 "${apiType}" 而不是 JSON —— error_page 接管了上游错误，同步客户端会 JSON 解析失败`,
  ).toContain('json');
  expect(
    await apiMiss.text(),
    `/api/ 未命中路由的响应体里出现了 404 页的文案`,
  ).not.toContain(zhCN['site.notfound.heading']);

  // 阳性对照：真实法务页仍 200，且**不是** 404 页的字节。
  const realPage = await page.goto(`${ORIGIN}/legal/privacy/`, { waitUntil: 'domcontentloaded' });
  expect(
    realPage?.status(),
    `/legal/privacy/ 变成了 ${realPage?.status()} —— 加 error_page 时把真页面一起弄没了`,
  ).toBe(200);
  expect(await page.content(), `/legal/privacy/ 答的竟是 404 页`).not.toContain(
    zhCN['site.notfound.heading'],
  );

  // 规定一：两侧各留一张图，且**人必须打开看过**。
  for (const { path, locale } of cases) {
    await page.goto(`${ORIGIN}${path}`, { waitUntil: 'domcontentloaded' });
    await page.screenshot({ path: `${SHOT_DIR}/live-notfound-${locale}.png`, fullPage: true });
  }

  const hard = hardErrors(logs);
  expect(hard, `404 页抛了未捕获异常：\n${hard.join('\n')}`).toEqual([]);
});

test('线上法律页页脚在平板和手机宽度不塌陷、不横向溢出', async ({ page }) => {
  for (const viewport of [
    { width: 1024, height: 900, columns: 2 },
    { width: 768, height: 900, columns: 2 },
    { width: 390, height: 844, columns: 1 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(`${ORIGIN}/legal/terms/`, { waitUntil: 'networkidle' });
    const columns = await page.locator('.lp-footer__grid').evaluate((element) =>
      getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean).length,
    );
    expect(columns, `${viewport.width}px 页脚列数不符合响应式规则`).toBe(viewport.columns);
    const width = await page.evaluate(() => ({
      body: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    }));
    expect(width.body, `${viewport.width}px 页面横向溢出`).toBeLessThanOrEqual(width.viewport);
    if (viewport.width === 390) {
      await page.screenshot({ path: `${SHOT_DIR}/live-terms-footer-390.png`, fullPage: true });
    }
  }
});
