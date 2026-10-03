/**
 * W7 · 纪念卡片**成品图**导出的真浏览器判据（工单那句"导出全程零网络请求"在这里数出来）
 * ============================================================================
 *
 * 工单定义在 [`countdown-anniversary.md`](../../docs/plans/countdown-anniversary.md) §3 的
 * `#### ⏹ W7 · 纪念卡片导出为成品图`；实现状态与缺口编号在
 * [`countdown-w7-device-export.md`](../../docs/plans/countdown-w7-device-export.md)。
 * jsdom 那一份（`apps/web/tests/countdown-card-export.spec.ts`）钉的是**版面契约**与
 * "源文件里没有网络调用形状"，它刻意**做不到**的四件事全部在这里：
 *
 * | 判据 | 为什么只能在真浏览器里 |
 * |---|---|
 * | ① 导出这一趟**真**零出站 | jsdom 没有真网络栈，"没调用 fetch"≠"没发请求" |
 * | ② 出厂尺寸**逐字等于**契约那一对数 | 只有真栅格化之后才有像素可数 |
 * | ③ 图上画的底色**就是屏幕上那套 token**（含暗色） | jsdom 里 `getComputedStyle` 不解析 CSS 变量 |
 * | ④ 界面上那句"也没有发出任何请求"为真 | 措辞是对**行为**的承诺，行为要在载体里量 |
 *
 * ## 🔴 ①的两个计数器，和为什么必须同时为零
 *
 * 见 `./net-egress.ts` 的文件头：只看 `page.on('request')` 的"零"有一个洞 ——
 * SW / `page.route` 会把请求吃掉，那时分类器收到 0 条而页面确实调了 `fetch`。
 * 所以再挂一支页内计数器，两支同时要求为零；并且**由测试自己发一条** `/api/*`
 * 做正向对照（那条数不出来，前面所有"零"都不成立）。
 *
 * ## 载体是 `vite dev`（4318），这条决定了"零"是不是恒真
 *
 * `apps/web/src/pwa/register.ts` 在 `!import.meta.env.PROD` 时直接 return ⇒ dev 载体里
 * **根本没有 SW**。这不是缺陷而是这一支的要件：本单证的是"**导出这条路不发请求**"，
 * 需要的是分类器**抓得到**，而不是"有个拦截器会替我吞掉"。
 * 所以这里把 SW 状态**实测打印**（dev 下应为 `NONE`），它既是"本载体没有拦截器"的证据，
 * 也是"两支计数器本应一致"的理由。
 * （隐私那一支反过来：它测"同意之前不注册 SW"，在 dev 里那条正向对照永远拿不到非零，
 * 所以它跑在生产构建的独立配置里。）
 *
 * ## 尺寸为什么从**构建产物**读，而不是在测试里再算一遍
 *
 * `EXPORT_CARD_HEIGHT_PX` 是 `Math.round(EDGE * H / W)`。把这条公式抄进测试 = 第二套
 * 事实源，而漂移恰好发生在"有人改了边长而没改测试"的那一刻（测试会跟着错，不会红）。
 * e2e 不在根 pnpm 工作区内（`e2e/pnpm-workspace.yaml`），所以走**绝对路径动态 import**
 * `packages/shared-schema/dist/index.js`；读不到就**响亮失败**并给出 `pnpm build`，
 * 不许退回一个写死的 1080×1440。
 *
 * ## 截图（AGENTS §6.2 规定一）
 *
 * 先截图、再断言，固定路径。导出那张**成品图本身**就是证据文件（不是窗口截图）：
 *   · `/tmp/heyta-card-export-results/board.png`（点导出之前那一屏）
 *   · `/tmp/heyta-card-export-results/card-light.png` / `card-dark.png`（导出的图）
 *   · `/tmp/heyta-card-export-results/export-failed.png`（失败上屏那一格）
 * 落在 `/tmp` 而不是 `test-results/`：后者每轮被 Playwright 清空，会把上一轮唯一的证据删掉。
 */
import { expect, test, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  countColor,
  inspectPng,
  looksBlank,
  looksSmeared,
} from '../../scripts/screenshots/png-stats.mjs';
import { openApp, switchView } from './helpers';
import {
  TAB,
  addCountdownEvent,
  cardDateLine,
  collectErrors,
  nextMonthFirst,
  openCardMenu,
} from './countdown-events';
import {
  installInPageNetCounter,
  readInPageNetCounts,
  swState,
  trackEgress,
} from './net-egress';

const EVIDENCE = '/tmp/heyta-card-export-results';
const TITLE = '结婚纪念日';

type Rgb = readonly [number, number, number];

interface ExportContract {
  readonly width: number;
  readonly height: number;
  readonly contentType: string;
}

/** 从**构建产物**读契约（见文件头：不在测试里重推导那条公式）。 */
async function exportContract(): Promise<ExportContract> {
  const dist = fileURLToPath(new URL('../../packages/shared-schema/dist/index.js', import.meta.url));
  let mod: Record<string, unknown>;
  try {
    mod = (await import(dist)) as unknown as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `读不到 @heyta/shared-schema 的构建产物（${dist}）：先跑 pnpm build。` +
        `这条判据**不**在测试里抄一份尺寸公式（抄件会漂），也不退回写死的数。(${String(error)})`,
    );
  }
  const edge = mod['EXPORT_CARD_EDGE_PX'];
  const height = mod['EXPORT_CARD_HEIGHT_PX'];
  const contentType = mod['EXPORT_CARD_CONTENT_TYPE'];
  // 🔴 前提：三个数**真拿到了**。读成 `undefined` 会让下面"两边相等"变成同义反复。
  for (const [name, value] of [
    ['EXPORT_CARD_EDGE_PX', edge],
    ['EXPORT_CARD_HEIGHT_PX', height],
  ] as const) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new Error(`${name} 不是一个正数（实为 ${JSON.stringify(value)}）—— 尺寸判据没内容可数`);
    }
  }
  if (typeof contentType !== 'string' || contentType === '') {
    throw new Error(`EXPORT_CARD_CONTENT_TYPE 不是非空串（实为 ${JSON.stringify(contentType)}）`);
  }
  return { width: edge, height, contentType };
}

/** 把某个 CSS 变量在**这台浏览器里**解析成 rgb（不抄 hex：抄一份就是第二套事实源）。 */
async function tokenRgb(page: Page, name: string): Promise<Rgb> {
  const rgb = await page.evaluate((varName) => {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    const probe = document.createElement('span');
    probe.style.color = raw;
    document.body.append(probe);
    const computed = getComputedStyle(probe).color;
    probe.remove();
    const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)/u.exec(computed);
    if (match === null) return null;
    return [Number(match[1]), Number(match[2]), Number(match[3])] as [number, number, number];
  }, name);
  if (rgb === null) {
    throw new Error(`${name} 在这台浏览器里解析不出 rgb —— 后面所有颜色判据都没了参照`);
  }
  return rgb;
}

/** 点「导出成品图」并等到文件真落地。**先挂 waitForEvent 再点**，反过来会漏掉事件。 */
async function exportCardImage(page: Page, saveTo: string): Promise<string> {
  const card = await openCardMenu(page, TITLE);
  const downloadPromise = page.waitForEvent('download');
  await card.locator('[data-testid^="event-export-"]').click();
  const download = await downloadPromise;
  await download.saveAs(saveTo);
  return download.suggestedFilename();
}

/** 开一台刚装好的设备：中文界面、模块全开、已答过同意面板，并有一条可导出的倒数日。 */
async function openWithOneEvent(
  page: Page,
  consent: 'local-only' | 'accepted' = 'local-only',
): Promise<string> {
  await openApp(page, '/', consent);
  await switchView(page, TAB);
  await addCountdownEvent(page, TITLE, nextMonthFirst().label, 1);
  return cardDateLine(page, TITLE);
}

test.beforeAll(async () => {
  await mkdir(EVIDENCE, { recursive: true });
});

test.describe('W7 · 导出成品图：零出站、尺寸对账、token 跟着主题走', () => {
  test('🔴 尺子先自检：读得出 3×2 的图，容差判得出"差 1 个通道就不是它"', async ({ page }) => {
    // 这一条不测产品，测的是**下面那些判据用的那把尺子**。它必须在产品正常时也红过：
    // 把 `inspectPng` 换成恒返回 `{width:0,height:0}`，这条就是第一根红。
    await page.goto('about:blank');
    const dataUrl = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 3;
      canvas.height = 2;
      const ctx = canvas.getContext('2d');
      if (ctx === null) throw new Error('这个浏览器连 3×2 的画布都不给');
      ctx.fillStyle = 'rgb(255, 0, 255)';
      ctx.fillRect(0, 0, 3, 2);
      return canvas.toDataURL('image/png');
    });
    const fixture = `${EVIDENCE}/probe-3x2.png`;
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    await writeFile(fixture, Buffer.from(String(base64), 'base64'));

    const stats = inspectPng(fixture);
    expect([stats.width, stats.height], '尺子必须数得出这张图真的是 3×2').toEqual([3, 2]);
    // 阳性对照 + 反证：同一支 `countColor`，命中色数得出 6 个采样点，
    // 而"只差一个通道"的颜色必须一个都数不出（容差判据自己不能有牙口缝）。
    expect(countColor(fixture, [255, 0, 255], 0)).toBe(6);
    expect(countColor(fixture, [255, 0, 254], 0)).toBe(0);

    const contract = await exportContract();
    expect(
      contract.width > 0 && contract.height > contract.width,
      `契约读数不成样子：${JSON.stringify(contract)}`,
    ).toBe(true);
  });

  test('🔴 正向对照：闸门放行后，页面自己发一条 /api/* 让两支计数器**各** +1', async ({
    page,
    baseURL,
  }) => {
    const origin = String(baseURL);
    await installInPageNetCounter(page);
    const { egress, sockets } = trackEgress(page, origin);
    // 🔴 这台设备走「同意并联网」，不是随手选的：`apps/web/src/features/privacy/consent-gate.ts:179`
    //   把 `globalThis.fetch` 整个换成了带闸门的实现，而它装的位置**在我们的页内计数器之外**
    //   （init script 先跑，产品代码后跑并包在它外面）。实测在「只用本机」下点这条对照，
    //   得到的是 `PrivacyConsentBlockedError: … 拒绝发起任何请求（/api/card-export-probe）`
    //   —— 两支计数器都数不到东西。那是**产品的 fail-closed 在生效**，不是探针坏了，
    //   但作为"探针能不能数"的正向对照它不成立，所以载体必须选放行那一侧。
    await openWithOneEvent(page, 'accepted');

    const before = await readInPageNetCounts(page);
    const beforeEgress = egress.length;
    await page.evaluate(async () => {
      await fetch('/api/card-export-probe');
    });
    // `page.on('request')` 是异步派发的，轮询到它数出来为止。
    await expect
      .poll(() => egress.length - beforeEgress, {
        message: '请求分类器数不出页面主动发的那条 /api/* ⇒ 前面所有"零"都是恒真',
        timeout: 10_000,
      })
      .toBeGreaterThanOrEqual(1);
    const after = await readInPageNetCounts(page);
    expect(after.fetch - before.fetch, '页内 fetch 计数器没数到那一条').toBe(1);
    expect(after.urls.length < 100, '页内计数器的 urls 溢出 ⇒ 切片读数不再可信').toBe(true);
    // 载体本身也报出来：dev 没有 SW ⇒ 没有拦截器 ⇒ 两支计数器本应一致。
    const state = await swState(page);
    console.log(`[carrier] SW=${state} sockets=${sockets.length} ${JSON.stringify(sockets)}`);
    expect(state, '本载体应当是 dev（无 SW），否则"零"可能是被吞出来的').toBe('NONE');
  });

  test('导出这张图：这一趟零出站，而文件的尺寸逐字等于契约', async ({ page, baseURL }) => {
    const origin = String(baseURL);
    const errors = await collectErrors(page);
    await installInPageNetCounter(page);
    const { egress, sockets } = trackEgress(page, origin);
    const dateLine = await openWithOneEvent(page);

    // 存在性先于取值：日期行没有内容，文件名那条判据就没参照。
    expect(dateLine, '卡片上没有日期行，成品图的文件名就没有那一段可对账').not.toBe('');
    await page.screenshot({ path: `${EVIDENCE}/board.png` });

    const pageBefore = await readInPageNetCounts(page);
    const egressBefore = egress.length;
    const socketsBefore = sockets.length;

    const cardPath = `${EVIDENCE}/card-light.png`;
    const fileName = await exportCardImage(page, cardPath);

    const pageAfter = await readInPageNetCounts(page);
    const newEgress = egress.slice(egressBefore);
    const newSockets = sockets.slice(socketsBefore);
    // 🔴 两支**同时**为零。只有分类器为零 = "看不见"，不是"没发"（见 ./net-egress.ts）。
    expect(newEgress, `导出这一趟浏览器真发出了请求：${JSON.stringify(newEgress)}`).toEqual([]);
    expect(
      pageAfter.total - pageBefore.total,
      `导出这一趟页面自己调了网络 API：${JSON.stringify(pageAfter.urls.slice(pageBefore.urls.length))}`,
    ).toBe(0);
    expect(newSockets, `导出这一趟另开了 WebSocket：${newSockets.join(', ')}`).toEqual([]);

    expect(fileName, '文件名不是"标题 + 屏上那一行日期"').toBe(`heyta-${TITLE}-${dateLine}.png`);

    const contract = await exportContract();
    const stats = inspectPng(cardPath);
    // 🔴 判据数的是**出厂字节里的 IHDR**（由 png-stats 那一份解码器读出），不是宿主自报。
    expect(
      [stats.width, stats.height],
      `导出的图是 ${String(stats.width)}×${String(stats.height)}，契约要的是 ${String(contract.width)}×${String(contract.height)}`,
    ).toEqual([contract.width, contract.height]);
    // 内容判据：错误屏/空白屏会过掉"尺寸对"，过不掉这两条（§7 #82 同族）。
    expect(looksBlank(stats), `成品图是空白的：${JSON.stringify(stats)}`).toBe(false);
    expect(looksSmeared(stats), '成品图上的字被横向涂抹了（有内容没边缘）').toBe(false);
    expect(stats.hasTransparency, '成品图里有透明像素（查看器会出黑边）').toBe(false);

    // 图上画的底色 == **这台浏览器解析出来的**那套 token（不是抄进来的 hex）。
    const background = await tokenRgb(page, '--ht-color-background');
    const surface = await tokenRgb(page, '--ht-color-surface');
    expect(countColor(cardPath, background, 2), `成品图里没有底色 token ${JSON.stringify(background)}`).toBeGreaterThan(0);
    expect(countColor(cardPath, surface, 2), `成品图里没有卡面 token ${JSON.stringify(surface)}`).toBeGreaterThan(0);
    // 阳性对照：同一支计数器在**不**属于这套主题的颜色上必须数得出 0，
    // 否则上面那两个 `> 0` 只可能是"什么都数得出正数"。
    expect(countColor(cardPath, [255, 0, 255], 2), '洋红不该出现在成品图里（计数器没牙）').toBe(0);

    expect(errors, `控制台报错：${errors.join(' | ')}`).toEqual([]);
  });

  test('暗色主题跟着走：切暗色再导，底色换成暗色那套 token', async ({ page, baseURL }) => {
    const origin = String(baseURL);
    const errors = await collectErrors(page);
    await installInPageNetCounter(page);
    const { egress } = trackEgress(page, origin);
    await openWithOneEvent(page);

    const lightBackground = await tokenRgb(page, '--ht-color-background');
    const lightPath = `${EVIDENCE}/card-light.png`;
    await exportCardImage(page, lightPath);

    await page.getByRole('button', { name: '切换到暗色主题' }).click();
    const darkBackground = await tokenRgb(page, '--ht-color-background');
    // 前提：主题**真的**切了。两值相同的话，下面那条"跟着走"就是恒真。
    expect(
      darkBackground.join(',') !== lightBackground.join(','),
      `切了暗色而底色 token 没变（两边都是 ${JSON.stringify(lightBackground)}）—— 这一条测不到任何东西`,
    ).toBe(true);

    const egressBefore = egress.length;
    const darkPath = `${EVIDENCE}/card-dark.png`;
    await exportCardImage(page, darkPath);
    expect(egress.slice(egressBefore), '切主题/再导一次发出了请求').toEqual([]);

    const contract = await exportContract();
    const dark = inspectPng(darkPath);
    expect([dark.width, dark.height], '暗色那一张的尺寸不是一档规格数').toEqual([
      contract.width,
      contract.height,
    ]);
    expect(countColor(darkPath, darkBackground, 2), '暗色成品图里没有暗色底 —— 导出没跟着主题').toBeGreaterThan(0);
    expect(countColor(darkPath, lightBackground, 2), '暗色成品图里还留着亮色底（第二套主题）').toBe(0);
    expect(dark.hash !== inspectPng(lightPath).hash, '两张图逐字节相同 ⇒ 主题根本没参与绘制').toBe(true);

    await page.screenshot({ path: `${EVIDENCE}/board-dark.png` });
    expect(errors, `控制台报错：${errors.join(' | ')}`).toEqual([]);
  });

  test('导不出来必须上屏：界面上那句"也没有发出任何请求"由计数器核', async ({
    page,
    baseURL,
  }) => {
    const origin = String(baseURL);
    await installInPageNetCounter(page);
    // 只给"导出这块画布"下绊子：`getContext` 平时照常，`__breakCanvas` 一置真就返回 null。
    // 不加这个开关的话，注入会顺手把别的用到画布的代码弄坏，症状看着像产品坏了。
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (...args: unknown[]) {
        const flag = (window as unknown as { __breakCanvas?: boolean }).__breakCanvas === true;
        if (!flag) {
          return (original as (...rest: unknown[]) => unknown).apply(this, args);
        }
        return null;
      };
    });
    const { egress } = trackEgress(page, origin);
    await openWithOneEvent(page);

    await page.evaluate(() => {
      (window as unknown as { __breakCanvas?: boolean }).__breakCanvas = true;
    });
    // 🔴 读数**必须在导航之后、点击之前**取：`addInitScript` 每份新文档重跑一次，
    // 计数器跟着归零 —— 在 `goto` 之前取的那一份属于 `about:blank`，减出来的差值没有意义。
    const before = await readInPageNetCounts(page);
    const egressBefore = egress.length;
    const card = await openCardMenu(page, TITLE);
    const downloadPromise = page
      .waitForEvent('download', { timeout: 5_000 })
      .then(() => 'GOT')
      .catch(() => 'NONE');
    await card.locator('[data-testid^="event-export-"]').click();

    const error = page.getByTestId('event-export-error');
    await expect(error, '拿不到画布时界面必须说话（失败静默吞掉是便签那条高危）').toBeVisible();
    await page.screenshot({ path: `${EVIDENCE}/export-failed.png` });
    expect(await downloadPromise, '这条路失败了却仍然放下了一个文件').toBe('NONE');

    // 🔴 那句措辞是对**行为**的承诺：它说"没有发出任何请求"，那就得数得出来。
    // 词条从 i18n 真源读，抄在这里就是第二套文案（`check:ui-language` 拦不住测试文件）。
    const zh = await readFile(
      fileURLToPath(new URL('../../packages/i18n/src/locales/zh-CN.ts', import.meta.url)),
      'utf8',
    );
    const match = /'web\.countdown\.export\.failed':\s*'([^']+)',/u.exec(zh);
    if (match === null) throw new Error('在 zh-CN 词条里找不到 web.countdown.export.failed');
    await expect(error).toContainText(String(match[1]));

    const newEgress = egress.slice(egressBefore);
    expect(newEgress, `失败路径发出了请求：${JSON.stringify(newEgress)}`).toEqual([]);
    const after = await readInPageNetCounts(page);
    expect(
      after.total - before.total,
      `失败路径调了网络 API：${JSON.stringify(after.urls.slice(before.urls.length))}`,
    ).toBe(0);
  });
});
