/**
 * R16 · 日历**日档**的英文界面（真浏览器）
 * ========================================
 *
 * 这一条补的是台账 `ui-review-fill-zh-timeline.md` §9.12 登记的**边界 3**：
 * `check:ui-language` 管不到"同一条英文句子比中文长得多，界面还装不装得下"。
 * ⚠️ 这里原来写的是「它**只**保证中英键集对等」—— 22:1x 现量**否证**（台账 §4 V4/V4b：
 * 把 en 的一条值抄成中文、或把 zh 的值写成英文，**它自己就 rc=1 并指名那一条**）。
 * 本文件成立的理由不靠那句错话：它守的是**几何**，而几何是任何按文本比对的门禁都摸不到的；
 * 它真正独有的另一维在这里 ——「组件写死中文字面量」门禁也看不见（V5 实测 rc=0）。
 * 而日档恰好有一句**整屏最长**的说明：
 *
 * · `common.calendar.dayNoTimed` —— zh **29** 字符，en **83** 字符（2026-10-03 18:0x
 *   现量：`node -e` 按词条表那一行取 `m[1].length`，两本表各一次）。
 *   ⚠️ 本文件头原写的是「zh 25 字，en 101 字符」—— **那两个数是我凭记忆写的，表里查不到**
 *   （`grep -rn "101" docs/plans/` 只命中 `check:l4` 的内联样式行数，与文案无关）。
 *   留这一行是为了让下一个人看清：判据里的数字要么当场量，要么就别写。
 *
 * 所以"键集对等 ≠ 被覆盖"在这一屏是字面成立的：中文那档全绿的几何，换英文可能溢出、
 * 被裁、或者顶穿容器（产品负责人 2026-10-03 那句「有的内容超出容器范围之外了」量的
 * 就是这一类，见计划 §4 里 08:55 那一行）。
 *
 * ## 🔴 为什么期望串**从词条表读**，不在这里抄一份英文
 *
 * 手抄的抄件一定会漂。这里把 `packages/i18n/src/locales/en.ts` 当作**唯一的期望来源**：
 * 读不到那个键就**响亮地失败**（`throw`），而不是退回一句硬编码的英文 —— 后者会让判据
 * 在词条改名之后变成"对着自己的夹具打分"。形状与 `calendar-day.spec.ts` 里
 * `hoursInDay()` 那条既有纪律一致。
 *
 * ## 为什么浏览器语言刻意设成 `zh-CN`
 *
 * 这一条要拍的是**英文界面**。如果它只是"这台机器的浏览器恰好是 en-US"碰出来的，
 * 那判据测的是环境不是产品。把 `locale` 钉成 `zh-CN` 之后界面还能是英文，
 * 只可能是 URL 上那个 `?lang=en` 起的作用（解析链第 2 层 > 第 3 层，见
 * `apps/web/src/lib/locale.ts`）—— 语言的**来源**与界面的**形状**因此是同一趟验出来的。
 *
 * ⚠️ 不使用共享的 `openApp()`：它先 `pinChineseUi()`（写 `heyta.locale='zh-CN'`，
 * 那是第 1 层、胜过 `?lang=`），再等中文 placeholder 锚点 —— 两条都会把英文界面按回中文。
 * 走的是 `language-first-launch.spec.ts` 那条"中立启动"的形状。
 */

import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

import { decidePrivacyConsent, enableAllModules } from './helpers';
import { installMissingProducerShims } from './shims';

const APP_EN = '/?lang=en';
const BOARD = '[data-testid="calendar-board"]';
const DAY_BOARD = '[data-testid="calendar-board-day"]';
const ALL_DAY_BAND = '[data-testid="calendar-board-day-all-day"]';
const ALL_DAY_LABEL = '[data-testid="calendar-board-day-all-day-label"]';
const NO_TIMED = '[data-testid="calendar-board-day-no-timed"]';
const ALL_DAY_EMPTY = '[data-testid="calendar-board-day-all-day-empty"]';
const AXIS_CARD = '[data-testid="calendar-board-day-axis-card"]';
const VIEW_SELECT = '[data-testid="calendar-view-select"]';
const CONTENT = '.ht-content';
const STAMP = Date.now().toString().slice(-6);
/** 证据落在**受版本控制**的目录里（`e2e/test-results/` 每趟会被清掉）。 */
const SHOT = (name: string): string => `../apps/web/evidence/calendar-day/${name}.png`;

function watchConsole(page: Page): string[] {
  const lines: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') lines.push(`[console.error] ${msg.text()}`);
  });
  page.on('pageerror', (err) => lines.push(`[pageerror] ${err.message}`));
  return lines;
}

/**
 * 从**词条表本身**取英文值（不抄进本文件）。
 *
 * 表是 `packages/i18n/src/locales/en.ts`，一行一条、单引号、内部引号转义
 * （那是 `check:ui-language` 要求的形状）。按那个形状解析，形状一变就读不到 ⇒
 * 下面 `throw` 会响亮地报"键没读到"，而不是静默拿到 `undefined` 再去断言
 * `textContent === undefined`（那种红看起来像产品坏了，其实是探针坏了）。
 */
async function enValue(key: string): Promise<string> {
  const src = await readFile(
    new URL('../../packages/i18n/src/locales/en.ts', import.meta.url),
    'utf8',
  );
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const line = new RegExp(`^  '${escaped}': '(.*)',?$`, 'mu').exec(src);
  if (line === null) throw new Error(`在 packages/i18n/src/locales/en.ts 里读不到键「${key}」`);
  return line[1].replace(/\\'/gu, "'").replace(/\\\\/gu, '\\');
}

/**
 * 一段文字"读得出"的三件事（全部只能在真浏览器里量，jsdom 的 rect 全是 0）：
 * 没被横向裁、没被纵向裁、没被浏览器画成省略号。
 */
async function fitProbe(
  page: Page,
  selector: string,
): Promise<{ text: string; height: number; clippedX: boolean; clippedY: boolean; ellipsised: boolean }> {
  return page.locator(selector).evaluate((el) => {
    const cs = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    return {
      text: el.textContent ?? '',
      height: Number(box.height.toFixed(1)),
      clippedX: el.scrollWidth > el.clientWidth + 1,
      clippedY: el.scrollHeight > el.clientHeight + 1,
      ellipsised: cs.textOverflow === 'ellipsis',
    };
  });
}

/** 元素的三条边（"超出容器范围"与"压住邻居"都拿它与另一个元素比）。 */
async function edges(
  page: Page,
  selector: string,
): Promise<{ top: number; right: number; bottom: number }> {
  return page.locator(selector).evaluate((el) => {
    const box = el.getBoundingClientRect();
    return {
      top: Number(box.top.toFixed(1)),
      right: Number(box.right.toFixed(1)),
      bottom: Number(box.bottom.toFixed(1)),
    };
  });
}

/** 中立地把应用开到英文（停在任务页 —— 输入框只在这一页）。 */
async function openAppEnglish(page: Page): Promise<void> {
  await enableAllModules(page);
  await installMissingProducerShims(page);
  await page.goto(APP_EN);
  // 锚点用 `language-option-en`（testID，语言中立）而不是任何一句界面文字 ——
  // 与 `language-first-launch.spec.ts` 同一个理由：拿句子当"起来了"的锚，
  // 等于把词条抄进测试。
  await expect(page.getByTestId('language-option-en')).toBeVisible();
  await decidePrivacyConsent(page);
  // 🔴 英文确实生效：`<html lang>` 是应用按解析结果自己写的。
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
}

/** 从任务页进**日档**。日历 tab 的名字来自表 —— 界面不是英文就点不到。 */
async function gotoDayView(page: Page): Promise<void> {
  await page
    .getByRole('tab', { name: await enValue('web.shell.modules.calendar.label') })
    .click();
  await expect(page.locator(BOARD)).toBeVisible();

  /**
   * 日档入口跟着当前宿主的真实控件走：共享档位入口是 tab 时点击它；
   * 旧版 Web 页头仍是原生 select 时才使用 option。不能无条件对 select
   * 调 `selectOption('day')`，那会在 tab 入口的页面上等待一个不存在的 option
   * 直到整条用例超时，而且错误看起来像日档内容没渲染。
   */
  const dayTab = page.getByTestId('calendar-view-tabs-day');
  if (await dayTab.count() > 0) {
    await expect(dayTab).toBeVisible();
    await dayTab.click();
  } else {
    const select = page.locator(VIEW_SELECT);
    const dayOption = select.locator('option[value="day"]');
    if (await dayOption.count() === 0) {
      throw new Error(
        '日历已打开，但没有可用的日档入口：既没有 calendar-view-tabs-day，' +
        '也没有 calendar-view-select[value="day"]。',
      );
    }
    await select.selectOption('day');
  }
  await expect(page.locator(DAY_BOARD)).toBeVisible();
}

test('🔴 英文日档：那条最长的说明**整句读得出**，没有溢出容器、也没有裁掉', async ({
  page,
}) => {
  const errors = watchConsole(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await openAppEnglish(page);

  /*
   * 先播一条**只排了日期、没有时刻**的任务：`dayNoTimed` 那句的出现条件是
   * `timedCount === 0 && allDay.length > 0`（`CalendarDayBoard.tsx:205`）。
   * 不播就没有这句话可量，这条判据会退化成"在一块没有该元素的界面上断言元素不存在"。
   *
   * ⚠️ 用**中文的「今天」**播种，这不是笔误：捕获语法目前只有中文那一套
   *   （`packages/domain/src/capture.ts` 的 `RULES` 全是 `今天|明天|下周…`），
   *   它与**界面语言无关** —— 把界面切成 en 不会同时把输入语法切成英文。
   *   标题本体用 ASCII：那个词会被确定性吃掉，落库的标题里没有中文，
   *   否则下面"零中文残留"那条会被**我自己的种子**打到（那不是产品结论）。
   */
  const title = `en-day-${STAMP}`;
  const composer = page.getByPlaceholder(await enValue('web.capture.placeholder'), {
    exact: true,
  });
  // 🔴 这个定位符本身就是"界面是英文"的第二次证明：中文 placeholder 下它找不到元素。
  await expect(composer).toBeVisible();
  await composer.fill(`今天 ${title}`);
  await composer.press('Enter');
  await expect(page.locator('[data-testid^="task-item-"]').first()).toBeVisible();

  await gotoDayView(page);
  // 先截图，再断言（§6.2 规定一 1：失败时也要有图）。
  await page.screenshot({ path: SHOT('day-en-full'), fullPage: false });

  // ① 「All day」那一行的名字必须**逐字等于**表里那条（不是"包含某个词"）。
  await expect(page.locator(ALL_DAY_LABEL)).toHaveText(await enValue('common.calendar.dayAllDay'));
  // ② 那条长说明在，而且**整句**在。
  const noTimed = await enValue('common.calendar.dayNoTimed');
  await expect(page.locator(NO_TIMED)).toBeVisible();
  await expect(page.locator(NO_TIMED)).toHaveText(noTimed);
  // ③ 读得出：没有被裁、没有被画成省略号。
  const probe = await fitProbe(page, NO_TIMED);
  // 探针自检：量到 0 高 = 探针没落到元素上，不许把"没量到"报成"判据绿了"。
  expect(probe.height, `那句说明量到的高度是 ${String(probe.height)} ⇒ 探针坏了`).toBeGreaterThan(0);
  expect(probe.clippedX, '英文说明被横向裁掉了').toBe(false);
  expect(probe.clippedY, '英文说明被纵向裁掉了（它比中文长四倍，容器给的高度不够）').toBe(false);
  expect(probe.ellipsised, '英文说明被画成了省略号').toBe(false);
  /*
   * ④ 🔴 **不超出容器范围**：句子的右下沿都在内容盒里。
   *    参照取 `.ht-content`（页头、内边距都会把内容盒与视口拉开），不取视口。
   *    这句说明在 DOM 里排在轴卡**之后**（`CalendarDayBoard.tsx:119 → :147 → :206`），
   *    而轴卡是 `flexGrow` 的那一块 —— 英文把它顶高一行，最可能的形状就是
   *    "句子被挤出内容盒下沿"（正是产品负责人报过的那一类）。
   */
  const sentence = await edges(page, NO_TIMED);
  const content = await edges(page, CONTENT);
  expect(
    sentence.right,
    `说明右沿 ${String(sentence.right)} 越出内容盒右沿 ${String(content.right)}`,
  ).toBeLessThanOrEqual(content.right + 1);
  expect(
    sentence.bottom,
    `说明底沿 ${String(sentence.bottom)} 越出内容盒底沿 ${String(content.bottom)}`,
  ).toBeLessThanOrEqual(content.bottom + 1);
  const axis = await edges(page, AXIS_CARD);
  // 它与轴卡是**上下相邻**，不许重叠（重叠的两种来源：绝对定位、或负 margin）。
  expect(
    sentence.top,
    `说明（顶 ${String(sentence.top)}）与轴卡（底 ${String(axis.bottom)}）重叠了`,
  ).toBeGreaterThanOrEqual(axis.bottom - 1);

  /*
   * ⑤ 轴上 24 行都在，且英文下每个时刻标签仍读得出来（折行/溢出都不算"读得出"）。
   *    行数**从源码读**（`HOURS_IN_DAY`），不抄数字 —— 与 `calendar-day.spec.ts` 同一条纪律。
   */
  const modelSrc = await readFile(
    new URL('../../packages/ui/src/calendar/model.ts', import.meta.url),
    'utf8',
  );
  const raw = /export const HOURS_IN_DAY = (\d+);/u.exec(modelSrc)?.[1];
  if (raw === undefined) throw new Error('在 packages/ui/src/calendar/model.ts 里找不到 HOURS_IN_DAY');
  const hours = Number(raw);
  const labels = await page
    .locator('[data-testid^="calendar-board-day-clock-"]')
    .evaluateAll((nodes) =>
      nodes.map((el) => {
        const cs = getComputedStyle(el);
        const parsed = Number.parseFloat(cs.lineHeight);
        const b = el.getBoundingClientRect();
        return {
          text: el.textContent ?? '',
          wrapped: Number.isNaN(parsed) ? false : b.height > parsed * 1.5,
          overflow: el.scrollWidth > el.clientWidth + 1,
        };
      }),
    );
  expect(
    labels.length,
    `英文下轴上的时刻标签是 ${String(labels.length)} 个，应为 ${String(hours)}`,
  ).toBe(hours);
  const offenders = labels.filter((l) => l.wrapped || l.overflow);
  expect(
    offenders,
    `这些时刻标签折行或溢出：${offenders.map((o) => `「${o.text}」`).join(' | ')}`,
  ).toEqual([]);

  // ⑥ 🔴 这一屏**不该有中文残留**：中英混排正是"键集对等但值没换过去"那类缺陷的形状。
  //    范围取内容盒（页头 + 板子 + 说明）。
  const cjk = await page.locator(CONTENT).evaluate((el) => {
    const hits: string[] = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
      const text = (n.nodeValue ?? '').trim();
      if (/[㐀-䶿一-鿿　-〿＀-￯]/u.test(text)) hits.push(text.slice(0, 40));
    }
    return hits;
  });
  expect(cjk, `英文日档里残留了中文：${cjk.join(' | ')}`).toEqual([]);

  // 单独把那句说明拍进证据（`day-en-full` 可能已经把它滚出视口）。
  await page.locator(NO_TIMED).scrollIntoViewIfNeeded();
  await page.screenshot({ path: SHOT('day-en-no-timed'), fullPage: false });

  expect(errors, `控制台报错：${errors.join(' | ')}`).toEqual([]);
});

test('🔴 英文日档·空的那天：空态那句也整句读得出，且没顶出它那张卡', async ({ page }) => {
  const errors = watchConsole(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await openAppEnglish(page);
  await gotoDayView(page);

  await page.screenshot({ path: SHOT('day-en-empty'), fullPage: false });

  // 不播任务 ⇒ 全天带是空的、轴也是空的 ⇒ `timedCount > 0` 不成立，带里那句走
  // `dayEmpty`（选哪句的裁决在 `CalendarDayBoard.tsx:138`）。
  await expect(page.locator(ALL_DAY_EMPTY)).toBeVisible();
  await expect(page.locator(ALL_DAY_EMPTY)).toHaveText(await enValue('web.calendar.dayEmpty'));
  await expect(
    page.locator(NO_TIMED),
    '两条带都空时不该再补一句"它们都在上面那条里"（上面那句自己就是空态）',
  ).toHaveCount(0);

  const probe = await fitProbe(page, ALL_DAY_EMPTY);
  expect(probe.height, `空态那句量到的高度是 ${String(probe.height)} ⇒ 探针坏了`).toBeGreaterThan(0);
  expect(probe.clippedX, '英文空态被横向裁掉').toBe(false);
  expect(probe.clippedY, '英文空态被纵向裁掉').toBe(false);
  const sentence = await edges(page, ALL_DAY_EMPTY);
  const card = await edges(page, ALL_DAY_BAND);
  expect(
    sentence.right,
    `空态那句伸出「All day」带卡片右沿（${String(sentence.right)} > ${String(card.right)}）`,
  ).toBeLessThanOrEqual(card.right + 1);
  expect(
    sentence.bottom,
    `空态那句伸出「All day」带卡片底沿（${String(sentence.bottom)} > ${String(card.bottom)}）`,
  ).toBeLessThanOrEqual(card.bottom + 1);

  expect(errors, `控制台报错：${errors.join(' | ')}`).toEqual([]);
});
