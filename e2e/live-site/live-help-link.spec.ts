/**
 * 原生壳交给浏览器的那枚帮助链接，在真浏览器里渲染出来的**是帮助中心**。
 * ========================================================================
 *
 * ## 它补的是哪一格
 *
 * macOS 壳那条后台诊断链（`scripts/verify-macos-widget-help.sh`，读数
 * `apps/desktop-macos/evidence/widget-help-dom-20261011-r92.txt`）证的是**交接这个决定**：
 * scheme 对不对、收到哪枚 URL、壳自己有没有跟着导航。它**故意不叫** `NSWorkspace.open`
 * （`WIDGET_EXTERNAL_LAUNCH=suppressed(HEYTA_WIDGET_HELP_PROBE)`），因为那会把用户的浏览器
 * 拽到前台，撞 `AGENTS.md` §6.2 规定二。于是「浏览器里真的渲染出那一页」长期没有读数，
 * 而台账把它写成"只能靠负责人点头允许一次前台激活"。
 *
 * 🔴 **那句是通道想窄了**：§6.2 规定二第 71–74 行是负责人 2026-09-29 拍过的
 * 「Web UI 的验证**默认优先用外接浏览器**（Playwright，无头、不开任何原生窗口）」。
 * 帮助中心就是一枚 Web UI —— 所以这一格**本来就该**用无头浏览器判，零前台、零抢焦点。
 * 本套件住在 `e2e/live-site/`：真浏览器 + 真域名 + 真 TLS，且域名用
 * `--host-resolver-rules` 钉在真服务器 IP 上、`--no-proxy-server`（同族另一条理由：
 * 走本机代理就变成"验代理"，代理一关这条会静默改对象）。
 *
 * ## 判据的形状：九条**各自打分**，最后一起断言
 *
 * ⚠️ 为什么不是一条 `expect` 接一条：`expect` 在第一条红处就中止，于是后面几条**这一趟根本没被判**，
 * 而报告读起来像"这条臂只点亮了这一枚" —— 那是**顺序遮挡**出来的假象，不是判据在分工。
 * 本条把九枚判据全部算完、写进 `readout.json`，再逐条断言，所以每一臂的"判假集合"是实测集合。
 *
 * 1. `documentStatus` —— 主文档响应存在且 2xx（拿不到响应/连不上 ⇒ 假）。
 * 2. `landsInDocsOrigin` —— 最终 URL 的**来源**没被换掉。
 * 3. `landsInDocsPath` —— 重算完之后的**最终** URL 仍落在 `/docs/` 下。
 *    这条守的是本条判据真正在防的风险：**被营销页顶掉**（壳里那条链接写 `/docs`，
 *    服务器改写 `/docs/`；若落到站点根 `/`，用户看到的是一张落地页，
 *    而落地页很漂亮，不会因为"页面漂亮"而有任何一条红）。
 * 4. `hasSingleNonEmptyH1` —— 恰好一枚 `h1` 且非空。
 * 5. `bodyHasContent` —— 正文可见文本 > 200 字符。
 * 6. `hasOtherDocsRoute` —— 至少一条指向**别的**文档页的链接（解析成绝对 URL 再比 pathname：
 *    文档站的 href 是路径式 `/docs/first-run/`，拿 `a[href*="域名/docs/"]` 去匹配读到的是 0，
 *    而那个 0 会被读成"帮助中心没有链接"，实际是探针选错对象 —— 2026-10-13 实测撞到一次）。
 * 7. `hasDocsNav` —— 页面有 `navigation` 地标。
 * 8. `screenshotNotBlank` —— 用仓库自己的零依赖尺 `inspectPng` + `looksBlank` 量那张图。
 *    ⚠️ 射程写清楚：**"非空白"挡不住错误屏**（§7 那条实测：错误屏有标题有正文），
 *    这一条判的不是"是不是帮助中心"，而是**截图这件事本身有没有截到东西**。
 *    它这枚尺本身的牙由 `scripts/screenshots/png-stats.test.mjs` 那套自测承担，
 *    而**接线**有牙：臂 C 里 Chromium 的错误页就是一张纯白图（`contentRatio=0`），这条跟着红了。
 *    截图失败或读不出 PNG 时按"空白"记（`judge=false`），不会静默绿。
 * 9. `noRuntimeErrors` —— `console.error` 与 `pageerror` 都收集且必须为空。
 *
 * ## 能红有证（四臂实测，改的是**输入**不是代码，所以无需 `.mut-bak`）
 *
 * `HEYTA_HELP_LINK_URL` 是给这条判据用的**唯一真相旋钮**，默认 = 壳交接的那枚 URL。
 * 每臂一份原文与 `readout.json` 落在 `apps/web/evidence/help-link-render-1013/arms/<臂号>/`。
 * 🔴 下面每一行的"判假集合"是**实测集合**，不是我预测的集合（我第一版预测"臂 B 只点落点那条"，
 * 实测是两条 —— 见这里为什么要把预测换成读数的理由：`AGENTS.md` §7 元规则二）。
 *
 * | 臂 | 输入 | 判假集合（实测） | 这一臂证明的事 |
 * |---|---|---|---|
 * | 绿 | `${ORIGIN}/docs`（壳交接的那枚） | 空，九条全真 | 帮助中心确实渲染了 |
 * | A | `/docs-outside-armA-404/` | `landsInDocsPath`、`hasSingleNonEmptyH1` | 落点这条与锚点这条都不是恒真 |
 * | A2 | `/docs/no-such-article-armA2/` | **空（九条全真）** | 边界：这枚**不能**当"逐篇可达"用，见下一节 |
 * | B | `/`（营销页） | `landsInDocsPath`、`hasSingleNonEmptyH1` | "被营销页顶掉"确实会红，而且**不靠**内容长度那类弱判据 |
 * | C | `${ORIGIN}:9/docs`（连不上） | 除 `noRuntimeErrors` 外**八条全红**（`status=0`、`contentRatio=0`、`finalUrl=chrome-error://`） | `documentStatus` 与 `screenshotNotBlank` 各自有牙：Chromium 的错误页是一张**纯白图**，"非空白"这条真能红 |
 *
 * ⚠️ **一条没被点过的判据**：`noRuntimeErrors` 四臂全真（连不上那一臂也不红）。
 * 本轮**没有**反臂证明它能红 ⇒ 诚实登记成"其牙未证"，别把它读成一条已验证的守卫。
 *
 * ⚠️ **一趟实测出来的边界**（别把它读成"能抓 404"）：这台服务器对 `/docs/` 下不存在的文章
 * 返回 **200 并渲染帮助中心索引**（臂 A2 ⇒ 九条全绿，`h1=帮助中心`、正文 2358 字符、与索引页同形）。
 * ⇒ 本判据集合**区分不了**"一篇不存在的文章"与"索引页"；对用户那不是缺陷（他落在帮助中心），
 * 但也不许把这条读成"文档链接逐篇可达"。同理站点根对未知路径也是 200 并回落到落地页
 * （臂 A 与臂 B 的读数逐字段相同：`bodyTextLength=2768`、`contentRatio=0.18108…`），
 * 所以 **`documentStatus` 抓不到 404** —— 它能抓的只有"连不上/没有响应"那一档。
 */
import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { inspectPng, looksBlank } from '../../scripts/screenshots/png-stats.mjs';

const ORIGIN = process.env['HEYTA_LIVE_ORIGIN'] ?? 'https://heyta.waytofuture.cn';
/** 真源 = macOS 壳那次读数里的 `WIDGET_EXTERNAL_HANDOFFS`（不带尾斜杠，正是要看服务器怎么改写）。 */
const HELP_URL = process.env['HEYTA_HELP_LINK_URL'] ?? `${ORIGIN}/docs`;
// 落点按 `import.meta.url` 解析，不用 cwd —— Playwright 的 cwd 是 `e2e/`，
// 写相对路径会把证据放进 `e2e/apps/web/evidence/`（同仓 `e2e/vault/*` 就是这么定的）。
const EVIDENCE_DIR =
  process.env['HEYTA_HELP_LINK_EVIDENCE'] ??
  fileURLToPath(new URL('../../apps/web/evidence/help-link-render-1013/', import.meta.url));

test('壳交接的帮助链接在真浏览器里渲染成帮助中心，且没有被营销页顶掉', async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const shotPath = `${EVIDENCE_DIR}/help-link-live.png`;
  // 规定一第 1 条：先约定好固定截图路径，失败时也要有图（Playwright 另存 test-failed-1.png，
  // 而这条判据自己的那张必须落在固定位置，人才找得到）。
  const readout: Record<string, unknown> = { requested: HELP_URL, expectedOrigin: ORIGIN };

  let response = null;
  let gotoError = '';
  try {
    response = await page.goto(HELP_URL, { waitUntil: 'networkidle' });
  } catch (error) {
    gotoError = String(error && (error as Error).message);
  }
  await page.screenshot({ path: shotPath, fullPage: false }).catch((error) => {
    gotoError += gotoError ? ` | 截图也失败：${String(error)}` : `截图失败：${String(error)}`;
  });

  const status = response ? response.status() : 0;
  readout.status = status;
  readout.gotoError = gotoError;

  const finalUrl = new URL(page.url());
  readout.finalUrl = page.url();

  const h1s = page.locator('h1');
  const h1Count = await h1s.count();
  const h1Text = h1Count === 1 ? (await h1s.first().innerText()).trim() : '';
  const bodyText = (await page.locator('body').innerText().catch(() => '')).trim();
  // href 是路径式，必须解析成绝对 URL 再比 pathname（文件头第 6 条写了撞过的形状）。
  const hrefPaths = await page
    .locator('a[href]')
    .evaluateAll((els) => els.map((el) => new URL((el as HTMLAnchorElement).href).pathname))
    .catch(() => [] as string[]);
  const otherDocsRoutes = [...new Set(hrefPaths.filter((p) => p.startsWith('/docs/') && p !== finalUrl.pathname))];
  const navCount = await page.getByRole('navigation').count();

  let png: Record<string, unknown> = {};
  let blank: boolean;
  try {
    const stats = inspectPng(shotPath);
    blank = looksBlank(stats);
    png = { contentRatio: stats.contentRatio, colorSpan: stats.colorSpan, width: stats.width, height: stats.height };
  } catch (error) {
    blank = true;
    png = { inspectError: String(error && (error as Error).message) };
  }

  const judges: Record<string, boolean> = {
    documentStatus: status >= 200 && status < 300,
    landsInDocsOrigin: finalUrl.origin === new URL(ORIGIN).origin,
    landsInDocsPath: finalUrl.pathname.startsWith('/docs/'),
    hasSingleNonEmptyH1: h1Count === 1 && h1Text.length > 0,
    bodyHasContent: bodyText.length > 200,
    hasOtherDocsRoute: otherDocsRoutes.length > 0,
    hasDocsNav: navCount > 0,
    screenshotNotBlank: !blank,
    noRuntimeErrors: pageErrors.length === 0 && consoleErrors.length === 0,
  };

  const evidence = {
    ...readout,
    h1: h1Text,
    bodyTextLength: bodyText.length,
    anchorLinkCount: hrefPaths.length,
    otherDocsRoutes,
    navCount,
    png,
    shotPath,
    consoleErrors,
    pageErrors,
    judges,
    judgedFalse: Object.entries(judges)
      .filter(([, value]) => !value)
      .map(([key]) => key),
  };
  writeFileSync(`${EVIDENCE_DIR}/readout.json`, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence));

  // 正向锚点排最前（AGENTS §7 元规则二）：锚点是假时，先让人看见"渲染没发生"，
  // 而不是先看见一条依赖渲染结果才成立的落点比较。
  const order = [
    'hasSingleNonEmptyH1',
    'bodyHasContent',
    'hasOtherDocsRoute',
    'hasDocsNav',
    'documentStatus',
    'landsInDocsOrigin',
    'landsInDocsPath',
    'screenshotNotBlank',
    'noRuntimeErrors',
  ];
  for (const key of order) {
    expect(judges[key], `${key} 为假。本趟判假集合=${JSON.stringify(evidence.judgedFalse)} 读数=${JSON.stringify(readout)}`).toBe(
      true,
    );
  }
});
