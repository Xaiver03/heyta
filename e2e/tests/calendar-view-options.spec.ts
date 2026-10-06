/**
 * R17 · 日历**档位下拉**的真浏览器取证（档位表只有一份）
 * =======================================================
 *
 * 这一条补的是 R17（把「有哪些档 + 每档叫什么」从两端各一份收成 `packages/ui` 一份）
 * 在 §6.2 规定一上欠的那张图。单测那两份（`apps/web/tests/calendar-view-tabs.spec.tsx`
 * 的 jsdom 载体、`packages/ui/tests/calendar-view-step.spec.ts` 的算术载体）已经钉住了
 * **内容** —— 这里只补浏览器里才成立的三件：
 *
 * 1. 🔴 **下拉里的档位序列就是共享那份表**：顺序从 `CALENDAR_VIEW_ORDER` 现读、
 *    档位→键从 `CALENDAR_VIEW_LABEL_KEYS` 现读、每档的字从 `packages/i18n` 的 zh 表现读。
 *    三样都不是抄的（这个文件里**不出现任何档位名与汉字字面量**），所以它证明的是
 *    "宿主画出来的那份 == 真源里那一份"，而不是"界面里有个下拉"。
 * 2. 🔴 **四档都点得动**：选完之后界面真的换成那一段（月/周数格子、日/年数板子），
 *    而标题四档各说各的 —— 「点了没反应的菜单项」那一类在这里会当场红。
 *    这条打的正是 goal 那句立场：**下拉里只放真的能用的档位**。
 * 3. `timeline` 只允许出现在**四个档之后**（它是外壳视图，不是日历档位），
 *    除它以外不许有第五个 `<option>` 凭空长出来。
 *
 * ⚠️ 浏览器截不了原生 `<select>` 展开的那层（它是 OS 画的，不在页面里），
 *    所以这里的图证的是"四档都在页面上、年档真的摊开了"，展开态由 DOM 断言负责。
 */

import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

import { openApp, switchView } from './helpers';

const APP_ZH = '/?lang=zh-CN';
const VIEW_SELECT = '[data-testid="calendar-view-select"]';
const TITLE = '[data-testid="calendar-toolbar-month"]';
const CELL = '[data-testid^="calendar-cell-"][role="button"]';
const YEAR_BOARD = '[data-testid="calendar-board-year"]';
/**
 * 🔴 前缀选择器（`^=`），不是精确等值。
 *   月卡的 testID 是**拼出来的**：`packages/ui/src/calendar/CalendarYearBoard.tsx:327,338` 的
 *   `${testID}-month-${suffix}`（`suffix` = `YYYY-MM`），宿主把 `testID` 传成 `calendar-board-year`
 *   ⇒ 真名是 `calendar-board-year-month-2026-10` 这种。写成 `[data-testid="…-month-"]`
 *   是**精确等值**，永远数出 0（2026-10-03 22:52 首次真跑就是这么红的，`Received: 0`）。
 *   `[role="button"]` 那一维是承重的：只有外层 `Pressable` 带 `accessibilityRole="button"`
 *   （同文件 335-339），而 `-body` / `-title` / `-weekdays` / `-week-N` 都没有 role。
 */
const YEAR_MONTH_CARD = '[data-testid^="calendar-board-year-month-"][role="button"]';
const YEAR_MONTH_ANY_PREFIX = '[data-testid^="calendar-board-year-month-"]';
const DAY_BOARD = '[data-testid="calendar-board-day"]';
const TIMELINE_VALUE = 'timeline';
/** 证据落在**受版本控制**的目录里（`e2e/test-results/` 每趟会被清掉）。 */
const SHOT = (name: string): string => `../apps/web/evidence/calendar-view-options/${name}.png`;

function watchConsole(page: Page): string[] {
  const lines: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') lines.push(`[console.error] ${msg.text()}`);
  });
  page.on('pageerror', (err) => lines.push(`[pageerror] ${err.message}`));
  return lines;
}

/**
 * 🔴 档位表从**共享源码**读，不在这个文件里抄一份四档。
 *   e2e 刻意不在根 pnpm 工作区内 ⇒ import 不到 `@heyta/ui`，只能读文件；
 *   读不到或两份集合对不上就**响亮地失败** —— 那说明真源坏了，而不是判据松了。
 */
async function sharedViewTable(): Promise<{ order: string[]; labelKey: Record<string, string> }> {
  const src = await readFile(
    new URL('../../packages/ui/src/calendar/model.ts', import.meta.url),
    'utf8',
  );
  const orderMatch = /export const CALENDAR_VIEW_ORDER[^=]*= \[([\s\S]*?)\]/u.exec(src);
  if (orderMatch === null) throw new Error('在 packages/ui/src/calendar/model.ts 里找不到 CALENDAR_VIEW_ORDER');
  const order = [...orderMatch[1]!.matchAll(/'([^']+)'/gu)].map((m) => m[1]!);

  const keysMatch =
    /export const CALENDAR_VIEW_LABEL_KEYS[^=]*= \{([\s\S]*?)\n\};/u.exec(src);
  if (keysMatch === null) {
    throw new Error('在 packages/ui/src/calendar/model.ts 里找不到 CALENDAR_VIEW_LABEL_KEYS');
  }
  const labelKey: Record<string, string> = {};
  for (const m of keysMatch[1]!.matchAll(/(\w+):\s*'([^']+)'/gu)) {
    labelKey[m[1]!] = m[2]!;
  }

  if (order.length === 0) throw new Error('CALENDAR_VIEW_ORDER 是空的 ⇒ 探针坏了');
  const a = [...order].sort().join(',');
  const b = Object.keys(labelKey).sort().join(',');
  if (a !== b) throw new Error(`共享那份自己就不一致：顺序 [${a}] vs 键表 [${b}]`);
  return { order, labelKey };
}

/** 词条的中文值从 **zh 词条表**读（同一个理由：不在测试里抄句子）。 */
async function zhText(key: string): Promise<string> {
  const src = await readFile(
    new URL('../../packages/i18n/src/locales/zh-CN.ts', import.meta.url),
    'utf8',
  );
  const m = new RegExp(`'${key}':\\s*'((?:[^'\\\\]|\\\\.)*)'`, 'u').exec(src);
  if (m === null) throw new Error(`zh 词条表里找不到 ${key}`);
  return m[1]!.replace(/\\'/gu, "'");
}

/** 一年几个月**从领域源码读**（照 `calendar-year.spec.ts` 那条既有纪律）。 */
async function monthsPerYear(): Promise<number> {
  const src = await readFile(
    new URL('../../packages/domain/src/date.ts', import.meta.url),
    'utf8',
  );
  const m = /export const MONTHS_PER_YEAR = (\d+);/u.exec(src);
  if (m === null) throw new Error('在 packages/domain/src/date.ts 里找不到 MONTHS_PER_YEAR');
  return Number(m[1]);
}

async function gotoCalendarMonth(page: Page): Promise<void> {
  await switchView(page, '日历');
  await expect(page.locator(VIEW_SELECT)).toBeVisible();
  await page.selectOption(VIEW_SELECT, 'month');
  await expect(page.locator(CELL)).not.toHaveCount(0);
}

test('🔴 档位下拉里画的就是共享那份表（顺序 / 键 / 词条文本三样都现读真源）', async ({ page }) => {
  const errors = watchConsole(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await openApp(page, APP_ZH);
  await gotoCalendarMonth(page);

  const { order, labelKey } = await sharedViewTable();
  const options = page.locator(`${VIEW_SELECT} option`);
  const rendered = await options.evaluateAll((els) =>
    els.map((el) => ({ value: (el as HTMLOptionElement).value, text: el.textContent ?? '' })),
  );

  // ① 先截图再断言（§6.2 规定一 1：失败时也要有图）。
  await page.screenshot({ path: SHOT('view-select-closed'), fullPage: false });

  /*
    ② 🔴 除"共享那四档 + 外壳的时间线"之外不许有别的 option。
      这条挡的是"凭空多一档"（点了没反应那一类）与"档位表被抄回宿主后长歪"。
  */
  const allowed = new Set([...order, TIMELINE_VALUE]);
  for (const o of rendered) {
    expect(allowed.has(o.value), `下拉里出现一个不属于共享那份表的档位：${o.value}`).toBe(true);
  }
  const calendarOnly = rendered.filter((o) => o.value !== TIMELINE_VALUE).map((o) => o.value);
  expect(calendarOnly, '档位顺序与共享那份 CALENDAR_VIEW_ORDER 不一致').toEqual(order);
  expect(new Set(rendered.map((o) => o.value)).size, '下拉里有重复档位').toBe(rendered.length);
  const timelineAt = rendered.findIndex((o) => o.value === TIMELINE_VALUE);
  if (timelineAt >= 0) {
    expect(timelineAt, '「时间线」挤进了日历档位中间（它是外壳视图，只许排在四个档之后）').toBe(
      rendered.length - 1,
    );
  }

  /*
    ③ 🔴 每档的字 = 它绑定的那个键在 zh 表里的值。
      这一条就是"年这一档不许念成「日」"的浏览器版本：错绑会在这里红，
      而不是等到人去读界面文案。
  */
  for (const kind of order) {
    const o = rendered.find((r) => r.value === kind);
    expect(o, `下拉里没有 ${kind} 这一档`).toBeDefined();
    expect(o!.text, `${kind} 档的字不是词条表里那句`).toBe(await zhText(labelKey[kind]!));
  }
  // 反向：不许把键名本身漏到界面上（那等于"翻译没接上"）。
  for (const kind of order) {
    expect(rendered.map((o) => o.text)).not.toContain(labelKey[kind]!);
  }

  expect(errors, `控制台报错：${errors.join(' / ')}`).toEqual([]);
});

test('🔴 四档都点得动，而且标题四档各说各的那一段', async ({ page }) => {
  const errors = watchConsole(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await openApp(page, APP_ZH);
  await gotoCalendarMonth(page);

  const { order } = await sharedViewTable();
  const titles: string[] = [];
  for (const kind of order) {
    await page.selectOption(VIEW_SELECT, kind);
    const title = (await page.locator(TITLE).textContent()) ?? '';
    expect(title.trim(), `${kind} 档切过去之后标题是空的（那就是"点了没反应"）`).not.toBe('');
    titles.push(title.trim());

    if (kind === 'month') {
      const cells = await page.locator(CELL).count();
      expect(cells, '月档格子数不超过一周 ⇒ 月历没摊开').toBeGreaterThan(7);
      await expect(page.locator(YEAR_BOARD)).toHaveCount(0);
      await expect(page.locator(DAY_BOARD)).toHaveCount(0);
    }
    if (kind === 'week') {
      // 🔴 与 `calendar-week.spec.ts` 同一条读数（那里钉的是 7），差别是这里逐档比。
      await expect(page.locator(CELL)).toHaveCount(7);
    }
    if (kind === 'day') {
      await expect(page.locator(DAY_BOARD)).toBeVisible();
    }
    if (kind === 'year') {
      await expect(page.locator(YEAR_BOARD)).toBeVisible();
      await expect(page.locator(YEAR_MONTH_CARD)).toHaveCount(await monthsPerYear());
      // 🔴 对照：同前缀但**不带** `[role=button]` 的节点一定**更多**
      // （`-body` / `-title` / `-weekdays` / `-week-N` 都共用这个前缀，见 CalendarYearBoard.tsx:264,267,277,289）。
      // 这一条的作用是：证明上面那条"恰好 12"是 `role=button` **筛出来的**，
      // 而不是前缀选择器随便数到 12 个什么东西 —— 少了这条对照，把选择器写宽也一样绿。
      const anyPrefixed = await page.locator(YEAR_MONTH_ANY_PREFIX).count();
      expect(
        anyPrefixed,
        '同前缀的节点数不多于 12 ⇒ `[role=button]` 那一维没在筛东西，判据是空的',
      ).toBeGreaterThan(await monthsPerYear());
    }
  }
  expect(new Set(titles).size, `四档里有两档标题一样：${titles.join(' | ')}`).toBe(order.length);

  // 年档是这张图的主体：12 张月卡真的摊开，而下拉就在它上方。
  await page.screenshot({ path: SHOT('view-tabs-year'), fullPage: false });
  expect(errors, `控制台报错：${errors.join(' / ')}`).toEqual([]);
});
