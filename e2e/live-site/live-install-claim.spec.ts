/**
 * 线上落地页那两句**对外承诺**的部署层守卫（G-51 步骤 ④ + G-71/G-49 那句全称承诺）。
 *
 * 本地那份 `e2e/landing/platforms-install-claim.spec.ts` 量的是**当前源码构建出来的那份**，
 * 而用户读到的是**公网上的那一份**。这两件事在本仓库不是一件事：
 * 落地页要 `publish` 才换（§8.27 那次就是"词条改了但线上还是旧的"）。
 * 所以"没有载体就不许承诺""不许写没有门禁盯着的全称句"必须在线上再量一次，
 * 否则摘掉的承诺可以悄悄从发布层回来。
 *
 * ## 🔴 这条是红的（2026-10-04 20:1x 首次记录，2026-10-05 19:5x 复跑仍红），而且红得对
 *
 * 首次现量（`LIVE_RC=1`，两条 locale 各一条红）：线上 Web 卡正文仍是
 * 「完整产品，不是演示。**可安装**、可离线用，数据就存在你的浏览器里。」/
 * "… **Installable**, works offline …"。当时 `main` 里也还是这一句，
 * 所以那次写的结论是"线上与 main 一致，缺的是落地不是发布"。
 *
 * ⚠️ **那句"缺的不是发布动作"到 2026-10-05 只对了一半，这里按逐键现量改写**（审计 §8.247）：
 * `site.platforms.web.body` 的新文案已随裁决①那 9 笔进了 **`origin/main`**（88c6e91a），
 * 而本地 `main` 与线上都还是旧的 —— 也就是这一句**只差一次重发**，不差整批落地；
 * `site.docs.selfhost.s3p1`（下面第二组腿）的新文案还在未落地的那 75 笔里，**必须等落地**。
 * ⇒ 两句的关闭路径不同，别再当成一格。
 *
 * 关闭条件（各自两条都要成立，缺一条对应的腿就还是红的）：
 *   ① 平台卡那组：从**含新文案的那笔 main** 重发落地页；
 *   ② 指南那组：`feat/self-host-distribution` 落进 `main`（目标第 1 项）**再**重发。
 * 在那之前不要"为了绿"改断言 —— 那正是这两组判据要拦的动作。
 *
 * ## 为什么每组都长成"正向锚点 + 负向断言"两条
 *
 * 只写"页面里不含 `可安装`"的话，**页面空了、被 SPA 兜底成别的页、CDN 挂了返回一张壳**
 * 都会让它无条件成立 —— 那是最典型的假绿（AGENTS §7 元规则 2）。
 * 所以先要求那个区块**渲染了、正文非空、且含当前这句新文案**，再判被摘掉的词不在里面。
 *
 * 两腿的"能红"与"能绿"分别有证：
 * - 锚点腿今天因"线上还是旧文案"红；
 * - 负向腿在**受控变异**（暂时拿掉锚点断言）下报出
 *   `线上 Web 卡不该再承诺「可安装」：…`；
 * - 🔴 **阳性对照**（2026-10-05 补，§8.247）：把 `HEYTA_LIVE_ORIGIN` 指到**本分支源码构建的
 *   `apps/landing/dist`**（一份含全部新文案的静态产物）时，四腿必须全绿。
 *   没有这一条，"红"就分不清是"线上旧"还是"选择器根本取不到那段正文"。
 */
import { expect, test, type Page } from '@playwright/test';

const ORIGIN = process.env['HEYTA_LIVE_ORIGIN'] ?? 'https://heyta.waytofuture.cn';

/**
 * 两组判据：同一形状（正向锚点 + 被摘掉的措辞不许出现），两个不同的对外承诺。
 * 锚点与禁词逐字取自 `packages/i18n` 里那两个键的新旧两版，不凭印象拼。
 */
const CASES = [
  {
    name: 'Web 卡',
    section: '#web',
    path: { 'zh-CN': '/platforms/', en: '/en/platforms/' },
    anchor: { 'zh-CN': '断网也能照常记', en: 'keeps working when you are offline' },
    forbidden: ['可安装', 'Installable'],
    removed: '「可安装」这句（Web 端没有可安装的载体）',
  },
  {
    name: '自建指南「完整步骤在哪」段',
    section: '#full-steps',
    path: { 'zh-CN': '/docs/selfhost/', en: '/en/docs/selfhost/' },
    anchor: { 'zh-CN': '逐字是同一条', en: 'byte-for-byte the same one' },
    forbidden: ['每句都对得上', 'they agree with every sentence'],
    removed: '「跟这一页讲的每句都对得上」那句无门禁的全称承诺（G-71）',
  },
] as const;

function attachLogs(page: Page): string[] {
  const hits: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') hits.push(`console.error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => hits.push(`pageerror: ${err.message}`));
  return hits;
}

/**
 * 读那个区块的**第一个正文段落**。
 *
 * 🔴 取 `<section> p.lp-prose` 而不是整页文本：这些卡/段各自只由一个 i18n 键供文。
 *   整页文本会让"别处出现这个词"误红，也会让"这个区块根本没渲染"被别处的文字盖住。
 */
async function bodyParagraph(page: Page, section: string): Promise<string> {
  const card = page.locator(section);
  await expect(card, `${page.url()} 上应当有 id="${section.slice(1)}" 这个区块`).toBeVisible();
  const paras = card.locator('p.lp-prose');
  await expect(paras.first(), `${section} 应当至少渲染出一个正文段落`).toBeVisible();
  return (await paras.first().innerText()).trim();
}

for (const c of CASES) {
  for (const locale of ['zh-CN', 'en'] as const) {
    test(`线上 ${c.name}（${locale}）：新句在场，且${c.removed}没有从发布层回来`, async ({ browser }) => {
      // 线上验收开**独立 context**（不带 storageState），且 locale 显式给：
      // 这条走的是"访客直接打开那一枚入口"，语言由**路径**决定（`/en/…`），不由查询串决定。
      const context = await browser.newContext({ locale });
      const page = await context.newPage();
      const logs = attachLogs(page);

      await page.goto(`${ORIGIN}${c.path[locale]}`, { waitUntil: 'domcontentloaded' });

      // §6.2 规定一第 1 条：**先截图再断言**，失败时那张图必须已经在盘上。
      // 放在本套件自己的 outputDir（`live-site-results/`，已忽略），不写进共享的 `test-results/`。
      await page
        .locator(c.section)
        .screenshot({ path: `live-site-results/${c.section.slice(1)}-${locale}.png` });

      const body = await bodyParagraph(page, c.section);
      expect(body.length, `正文不能是空串（空串会让下面那条负向断言无条件成立）`).toBeGreaterThan(0);
      expect(
        body,
        `线上 ${c.name} 里没有当前文案锚点「${c.anchor[locale]}」——` +
          `如果读到的是被摘掉的那一句，说明对应的 main 那一笔还没落地或落地页还没从它重发（不是站点坏了）：${body}`,
      ).toContain(c.anchor[locale]);
      for (const needle of c.forbidden) {
        expect(body, `线上 ${c.name} 不该再出现「${needle}」：${body}`).not.toContain(needle);
      }
      expect(logs.filter((l) => l.startsWith('[pageerror]')), `页面不该有未捕获报错：${logs.join('\n')}`).toEqual([]);

      await context.close();
    });
  }
}

