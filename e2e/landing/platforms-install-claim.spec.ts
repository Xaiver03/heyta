import { expect, test, type Page } from '@playwright/test';

import { waitHeadRevealed } from './head-reveal';

/**
 * `/platforms` 的 Web 卡：那句「可安装」不能回来（G-51）
 * =====================================================
 *
 * 这条判据盯的是**一个对外承诺有没有载体**。`site.platforms.web.body` 原来说
 * 「完整产品，不是演示。可安装、可离线用，数据就存在你的浏览器里。」——
 * 而 Web 端从来没有可安装的 PWA：`apps/web/src/pwa/register.ts` 的 `SW_URL` 是
 * `/sw.js`，应用挂在 `/app/` 下，线上那个路径返回的是**落地页 HTML**，
 * SW 注册以 `SecurityError` 失败（§8.57 / deployment.md §3.7「还没做的」）。
 * 也就是说这句在界面上永远兑现不了，于是整条安装承诺被摘掉，只留可兑现的两条
 * （断网能记、恢复后补传）。
 *
 * 🔴 **为什么判据落在本地 build 产物、而不是线上站点**：
 * 线上那一份还等着重新发布（G-51 步骤⑤）。把这条挂进 `e2e/live-site/` 会红在
 * "还没发布"这件事上，而不是红在代码上 —— 那不是判据，是排期。
 * 现在这个形状拦的是**代码往回退**：谁把那句改回来，这里立刻红。
 *
 * ⚠️ **断言范围只到 `section#web`**。同一页另外三张卡合法地含「安装」二字
 * （iOS 卡讲模拟器上的安装、鸿蒙卡讲能打安装包、self-host 卡讲"不是一键安装"），
 * 全页级"没有安装字样"会红在三条正确的文案上。
 */

/** 新文案的锚点。**先证它在，才有资格说那句不在。** */
const ZH_ANCHOR = '断网也能照常记';
const EN_ANCHOR = 'keeps working when you are offline';

/** 被摘掉的承诺。中英各一条，两条都算违规。 */
const FORBIDDEN = ['可安装', 'Installable'];

function attachConsole(page: Page): string[] {
  const hits: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') hits.push(`console.error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => hits.push(`pageerror: ${err.message}`));
  return hits;
}

/**
 * 读 Web 卡的正文段落。
 *
 * 🔴 取的是 `section#web p.lp-prose` 而不是整页文本 —— 这张卡是唯一由
 * `site.platforms.web.body` 供文的区块，范围收在这里，摘掉别的东西不会让它误红。
 */
async function webCardBody(page: Page): Promise<string> {
  const card = page.locator('section#web');
  await expect(card, '`/platforms` 上应当有 id="web" 这张卡').toBeVisible();
  const paras = card.locator('p.lp-prose');
  await expect(paras.first(), 'Web 卡应当至少渲染出一个正文段落').toBeVisible();
  return (await paras.first().innerText()).trim();
}

test('中文 Web 卡：新句在场，且「可安装」这句没有载体', async ({page}) => {
  const errors = attachConsole(page);
  await page.goto('/platforms/');

  // §6.2 规定一第 1 条：先截图再断言，失败时那张图必须已经在盘上。
  await page.locator('#main').screenshot({path: 'landing-results/platforms-web-card-zh.png'});

  const body = await webCardBody(page);
  expect(body.length, 'Web 卡正文不能是空串（空串会让下面那条负向断言无条件成立）').toBeGreaterThan(0);
  expect(body, `Web 卡应当含新文案锚点「${ZH_ANCHOR}」：${body}`).toContain(ZH_ANCHOR);
  for (const needle of FORBIDDEN) {
    expect(body, `Web 卡不该再承诺「${needle}」（没有能装进设备的载体）：${body}`).not.toContain(needle);
  }
  expect(errors, `控制台不该有报错：${errors.join('\n')}`).toEqual([]);
});

test('英文 Web 卡：同一句承诺在英文页也不能回来', async ({page}) => {
  const errors = attachConsole(page);
  await page.goto('/en/platforms/');

  await page.locator('#main').screenshot({path: 'landing-results/platforms-web-card-en.png'});

  const body = await webCardBody(page);
  expect(body.length, '英文 Web 卡正文不能是空串').toBeGreaterThan(0);
  expect(body, `英文 Web 卡应当含新文案锚点「${EN_ANCHOR}」：${body}`).toContain(EN_ANCHOR);
  for (const needle of FORBIDDEN) {
    expect(body, `英文 Web 卡不该出现「${needle}」：${body}`).not.toContain(needle);
  }
  expect(errors, `控制台不该有报错：${errors.join('\n')}`).toEqual([]);
});

test('整页仍有「离线」这一档承诺，摘掉的只是「可安装」', async ({page}) => {
  await page.goto('/platforms/');
  // 🔴 先等页头那次遮罩揭示**落位**再拍，否则这张"给人看的证据图"会稳定地谎报一个
  //   不存在的缺陷：实测不等待时图顶留一条 180px 空白带，而 DOM 里 H1 的
  //   rect / opacity / transform 全部正常（另拍视口图标题在）。
  //   `animations:'disabled'` **单独不够** —— 它只完成 CSS 动画/过渡，遮罩那一下是
  //   framer-motion 的 WAAPI transform；加上它之后 lede 与主蓝按钮回来了，H1 仍空白。
  //   等待逻辑住在 `./head-reveal.ts`（与文档中心那 16 处共用一份，不抄第二份）。
  await waitHeadRevealed(page);
  await page.screenshot({path: 'landing-results/platforms-page.png', fullPage: true, animations: 'disabled'});

  // 阳性对照：这一趟读的字节是**当前构建产物**，不是上一轮留在 dist 里的旧树
  // （AGENTS §7 第 27/82 条那个失效形态：判据跑在旧产物上照样绿）。
  const prose = await page.locator('section#web p.lp-prose').first().innerText();
  expect(prose).toContain('数据就存在你自己的浏览器里');
  // 反向对照：这一页**合法地**含「安装」二字（iOS / 鸿蒙 / self-host 三张卡），
  // 所以上面两条的范围必须收在 section#web —— 这条断言钉住"为什么不能写全页级判据"。
  const pageText = await page.locator('#main').innerText();
  expect(pageText.includes('安装'), '本页应当还有别的卡合法地提到「安装」').toBe(true);
  expect(pageText, '整页出现的「可安装」应当为 0 次').not.toContain('可安装');
});

/**
 * 🔴 页末那条说明**不许是 flex**（本轮看截图时撞见的真缺陷）。
 *
 * `.lp-note` 原来是 `display:flex` + `gap`。它的子节点不是"图标 + 文字"，
 * 而是 `RichText`（`apps/landing/src/site/PageSections.tsx:77`）把一条词条按
 * `**粗体**` / `` `代码` `` 切出来的一串**兄弟文本节点** —— flex 把它们各排一栏，
 * 于是 `/platforms` 那条「未签名」说明被排成三列，第二列以「，需要右键打开」起头
 * （改前图：`/tmp/g138-before/platforms-page.png`，md5 `1c6798b6…`）。
 * ⚠️ 图标 `⚠️` 住在**词条文本里**，不是元素 —— 所以这一条不是"缺了图标所以要 flex"。
 */
test('页末说明是一段 flowing 文本，不是一排 flex 栏', async ({page}) => {
  await page.goto('/platforms/');
  const note = page.locator('.lp-note').first();
  await expect(note, '本页应当渲染出那条「未签名」说明').toBeVisible();

  const display = await note.evaluate((el) => getComputedStyle(el).display);
  expect(['flex', 'inline-flex', 'grid', 'inline-grid'],
    `.lp-note 的 display=${display} 会把 RichText 的文本切片排成多栏`).not.toContain(display);

  // 非空前提（否则上面那条会在"这一页根本没有带标记的说明"时无条件成立）：
  // 说明里必须真的渲染出 ≥2 个切片，且粗体那一段的字在文本流里读得到。
  const kids = await note.evaluate((el) => el.children.length);
  expect(kids, '这条说明应当被 RichText 切成 ≥2 个兄弟切片（少于 2 条上面那条就没牙）').toBeGreaterThanOrEqual(2);
  await expect(note.locator('strong').first()).toBeVisible();
  expect((await note.innerText()).includes('双击会被系统拦下'),
    '粗体那一段应当出现在正文流里').toBe(true);
});
