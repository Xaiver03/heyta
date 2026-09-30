#!/usr/bin/env node
/**
 * 生成社交分享卡片 `public/og-card.png`
 * ======================================
 *
 *     node scripts/gen-og-card.mjs
 *
 * 源文件是 `scripts/og-card.html`（1200×630，排版锁死），这里用**无头 Chrome**
 * 把它截成 PNG。产物**签进仓库** —— 理由见下面那条"为什么不用构建期生成"。
 *
 * 🔴 为什么这张图必须是**真 PNG**
 *
 * `og:image` 是链接贴进微信 / X / Slack 时的第一印象。而 SVG 在那些平台的
 * 卡片里普遍不被渲染 —— 声明一个 SVG 的 og:image，效果等于"没有图"，
 * 而且多了一次无效请求。所以源是 HTML/SVG 都行，**落点必须是位图**。
 *
 * 🔴 为什么**不用构建期生成**（`pnpm build` 里跑）
 *
 * 那会让"能不能构建站点"取决于**构建机上有没有 Chrome** —— 而 CI 与别人的
 * 机器上都没有。于是这一页的产物会因为环境不同而不同，最坏情况是构建直接失败。
 * 生成的 PNG 签进仓库之后：任何环境都有图，只有"想重新生成"时才需要 Chrome。
 * （与 `gen-entries.mjs` 的取舍相反：那个必须每次都对，因为它由注册表派生；
 * 这张图不派生自任何东西，它只派生自一份手写的 HTML。）
 *
 * ⚠️ 找不到 Chrome 时**明确报错并给出两条出路**，而不是静默跳过 ——
 * 静默跳过会让人以为"图已经更新了"。
 */

import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { siteOriginFrom } from '../src/site/origin.ts';
import { LOCALES } from '../../../packages/i18n/src/types.ts';
import { en } from '../../../packages/i18n/src/locales/en.ts';
import { zhCN } from '../../../packages/i18n/src/locales/zh-CN.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '..');
const SOURCE = join(HERE, 'og-card.html');
/** 仓库根 —— 用来读 design tokens（那是配色的唯一事实源）。 */
const REPO = resolve(APP, '../..');
/** 卡片产物落在 `public/` 下（与 `og:image` 的地址对应）。 */
const PUBLIC = join(APP, 'public');

/**
 * 语言 → 词条表。
 *
 * 🔴 R16：卡片**分语言生成**。此前只有一张**中文**卡（`og-card.png`），
 * 而英文页的 `og:image:alt` 用英文描述它 —— 无障碍文本描述的是一张
 * 不存在的英文卡。修法是让卡片文案进词条表、按语言各生成一张，
 * 而不是把 alt 改成一句"泛指"的话（那会让读屏用户读到的描述与图无关）。
 */
const TABLES = { 'zh-CN': zhCN, en };

/** 某种语言的卡片文件名。中文版是默认名，英文版加 `-en`。 */
function cardFile(locale) {
  return locale === 'zh-CN' ? 'og-card.png' : 'og-card-en.png';
}

/** 卡片尺寸。与 `og-card.html` 里锁死的 `1200×630` 必须一致。 */
const WIDTH = 1200;
const HEIGHT = 630;

const CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter((candidate) => typeof candidate === 'string' && candidate !== '');

const chrome = CANDIDATES.find((candidate) => existsSync(candidate));

if (chrome === undefined) {
  process.stderr.write(
    [
      '',
      '🔴 找不到 Chrome / Chromium / Edge，无法渲染分享卡片。',
      '',
      '两条出路：',
      '  1. 装上其中一个，或把路径给 CHROME_PATH 环境变量；',
      '  2. **不重新生成也行 —— 但只在域名与词条都没变的前提下。**',
      '     `public/og-card.png` 已经签进仓库；它派生自两样东西：',
      '       · `VITE_SITE_URL` / `src/site/origin.ts` 的部署地址（卡片右下角印的那个域名），',
      '       · `@heyta/i18n` 的 `site.og.card.*` 词条。',
      '     🔴 所以**换域名或改词条时必须走第 1 条**，否则站上的卡片仍印旧域名',
      '     —— 它不报错，只是安静地撒谎。',
      '',
      `    如果你改了 ${SOURCE.slice(APP.length + 1)}，同样必须走第 1 条。`,
      '',
    ].join('\n'),
  );
  process.exit(1);
}

/**
 * 把模板渲染成最终 HTML —— **域名与主色都是注入的，不是写死的**。
 *
 * 🔴 这两处此前是硬编码的，各自都是一条"没人核对的值"：
 *
 *   1. **域名** `heyta.finlaw.cloud` 写死在 HTML 里。而站点地址的唯一事实源是
 *      `src/site/origin.ts` + `VITE_SITE_URL`（那个文件头写着"换域名 = 一次构建参数"）。
 *      写死之后，换域名时**这张图仍印着旧域名**，而且没有任何门禁会发现。
 *   2. **主色** `#2f6fed`。注释声称"与 design tokens 的 primary 同一个色相…
 *      不该出现第二种蓝" —— 而 token 是 `#2563eb`。**那就是第二种蓝**，
 *      而且它是硬编码 hex，绕过了设计系统（`check:design` 管不到 `.html`）。
 *
 * 现在两者都从各自的**唯一事实源**取：域名走 `siteOriginFrom`，
 * 主色走 `packages/design-system/src/tokens.css` 的 `--ht-blue-600`
 * （`--ht-color-primary` 指向它）。
 *
 * ⚠️ 取不到就**抛**，不回落 —— 一条安静回落到旧值的渲染会让"换了 token
 * 但卡片没变"变成一个不报错的漂移，而那正是本仓库最忌讳的失效形状。
 */
function renderTemplate(locale) {
  const tokens = readFileSync(join(REPO, 'packages/design-system/src/tokens.css'), 'utf8');

  /**
   * 从 tokens.css 取一个 **raw 色阶**的值；取不到就抛。
   *
   * 🔴 不回落是刻意的：一条安静回落到旧值的渲染会让"换了 token 但卡片没变"
   * 变成一个不报错的漂移 —— 而那正是本仓库最忌讳的失效形状。
   */
  const token = (name, why) => {
    const value = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(tokens)?.[1];
    if (value === undefined) {
      throw new Error(
        `tokens.css 里找不到 ${name}（${why}）。分享卡片从它派生，` +
          '取不到就不能生成 —— 静默回落会让卡片与设计系统悄悄分叉。',
      );
    }
    return value;
  };

  const host = new URL(siteOriginFrom(process.env.VITE_SITE_URL)).host;
  const table = TABLES[locale];

  /** HTML 文本节点里的转义。卡片文案来自词条表，`&` 必须转。 */
  const escapeHtml = (text) =>
    text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

  const values = {
    SITE_HOST: host,
    // 主色：`--ht-color-primary` 指向它。
    PRIMARY: token('--ht-blue-600', '主色 --ht-color-primary 指向它'),
    // 暖纸色四件套（R15）：此前是硬编码在 og-card.html 里的 hex。
    PAPER_BG: token('--ht-paper-50', '卡片纸面'),
    PAPER_INK: token('--ht-paper-900', '卡片正文'),
    PAPER_INK_MUTED: token('--ht-paper-600', '卡片次要文字'),
    PAPER_RULE: token('--ht-paper-200', '卡片分隔线'),
    // 卡片上真的要印的字（R16）：从词条表按语言取，不是写给 alt 看的描述。
    CARD_TITLE1: table['site.og.card.title1'],
    CARD_TITLE2: table['site.og.card.title2'],
    CARD_LEDE: table['site.og.card.lede'],
  };

  let html = readFileSync(SOURCE, 'utf8');
  for (const [placeholder, value] of Object.entries(values)) {
    html = html.replaceAll(`{{${placeholder}}}`, escapeHtml(value));
  }
  if (html.includes('{{')) {
    throw new Error('og-card.html 里还有没被替换的占位符 —— 模板与渲染器对不上了。');
  }

  const rendered = join(tmpdir(), `heyta-og-card-${locale}.html`);
  writeFileSync(rendered, html);
  return rendered;
}

/**
 * 🔴 **不能等 Chrome 自己退出。**
 *
 * 实测（macOS，Chrome 140）：`--headless --screenshot` 会**把图写出来，
 * 然后挂住不退** —— 于是 `spawnSync` 一直等下去，在 CI / agent 的超时里
 * 变成一次没有产出的失败，而图其实已经生成好了。
 * （这正是本仓库 §7 一贯那类坑：工具的行为与它看起来的样子不一致。）
 *
 * 所以这里改成"**等文件出现，然后杀掉它**"：文件一出现就说明这一帧已经截完，
 * 再等下去只是白等。等待有上限，超时就明确报错 —— 不静默通过。
 */
const WAIT_MS = 40_000;
const POLL_MS = 250;

for (const locale of LOCALES) {
  const rendered = renderTemplate(locale);
  const target = join(PUBLIC, cardFile(locale));
  const relative = target.slice(APP.length + 1);

  rmSync(target, { force: true });

  const profileDir = mkdtempSync(join(tmpdir(), 'heyta-og-'));
  const child = spawn(
    chrome,
    [
      '--headless',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-sync',
      '--disable-background-networking',
      '--hide-scrollbars',
      `--user-data-dir=${profileDir}`,
      `--window-size=${WIDTH},${HEIGHT}`,
      `--screenshot=${target}`,
      `file://${rendered}`,
    ],
    { stdio: 'ignore' },
  );

  const startedAt = Date.now();
  let produced = false;
  while (Date.now() - startedAt < WAIT_MS) {
    if (existsSync(target) && statSync(target).size > 0) {
      produced = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }

  child.kill('SIGKILL');
  rmSync(profileDir, { recursive: true, force: true });

  if (!produced) {
    process.stderr.write(
      `\n🔴 等了 ${WAIT_MS / 1000} 秒也没看到 ${relative}。\n` +
        '   可能是 Chrome 版本不认 `--headless --screenshot`，或系统字体还没就位。\n',
    );
    process.exit(1);
  }

  const bytes = statSync(target).size;
  process.stdout.write(` 写入 ${relative}（${WIDTH}×${HEIGHT}，${bytes} 字节）\n`);
}
