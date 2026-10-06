/**
 * 习惯「本月统计四格」的真浏览器验收（工单 W8，§8.121）
 * =====================================================
 *
 * jsdom 那一层（`apps/web/tests/habits-board.spec.tsx` 的 G 组 5 条 +
 * `packages/domain/tests/habit-period-stats.spec.ts` 的 11 条手算夹具）已经把**算式**钉死了。
 * 这一份只验 jsdom 够不着的三件事：
 *
 * 1. **每一张卡都带着这四格**。断言写成存在性（每枚 `habit-card-*` 里四格各一枚），
 *    不是给"我以为会有的那几行"逐个写内容判据 —— §7 那课：**断言只会验界面写了什么，
 *    不会验界面少了什么**（W5 那张少了一行日期的逾期卡就是这么漏的）。
 * 2. **单位分叉真的分得开**。有 `unit` 走 `…{value} {unit}`，没有就退化成不带单位的句子 ——
 *    这条只在真界面量得到，因为两份句子来自 i18n 词条表，jsdom 那边桩给的是同一个字符串。
 * 3. **暗色下四格读得清**。AGENTS §5 要求暗色实际切换查看，不是反相就算。
 *
 * ## 数据全部从界面上真点出来
 *
 * 不注入 IndexedDB、不调内部 store（与 `habits-pane.spec.ts` 同一条理由）。
 *
 * ⚠️ 边界（别读多）：「分母为 0 ⇒ 完成率显示占位句」这一档**不在这里验** ——
 *   浏览器里点不出"本月一个到期计划日都没有"的状态（新建的每日习惯当天就算到期），
 *   它由 jsdom 的 G 组与 domain 的 T6 钉住。这里没有绕过它，只是换了载体。
 */
import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import {
  openApp,
  switchTheme,
  switchView,
} from './helpers';

const ADD_PLACEHOLDER = '新习惯，例如「喝水」';
const APP_ZH = '/?lang=zh-CN';
const STAMP = Date.now().toString().slice(-6);

const SHOT = (name: string) =>
  fileURLToPath(new URL(`../../apps/web/evidence/habit-month-stats/${name}.png`, import.meta.url));

test.use({ viewport: { width: 1280, height: 1000 } });

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e)}`));
  return errors;
}

async function createHabit(page: Page, name: string): Promise<string> {
  const input = page.getByPlaceholder(ADD_PLACEHOLDER);
  await input.fill(name);
  await input.press('Enter');
  const row = page.locator('[data-testid^="habit-row-"]').filter({ hasText: name }).first();
  await expect(row, `新建的习惯没有出现在清单里：${name}`).toBeVisible();
  const testId = await row.getAttribute('data-testid');
  expect(testId, '习惯行没有 data-testid').not.toBeNull();
  return (testId ?? '').replace('habit-row-', '');
}

async function selectHabit(page: Page, id: string): Promise<void> {
  await page.locator(`[data-testid="habit-row-${id}"]`).click();
  await expect(page.getByTestId(`habit-card-${id}`), '窗格没有切到这一条习惯').toBeVisible();
}

/** 四格在同一枚卡片里；前缀写一处，M1 的分母判据与逐格取值都用它。 */
const CELL_PREFIXES = ['habit-month-days', 'habit-month-rate', 'habit-month-value', 'habit-total-value'];

async function cellText(page: Page, prefix: string, id: string): Promise<string> {
  return (await page.getByTestId(`${prefix}-${id}`).innerText()).trim();
}

test('M1 🔴 每一张卡都带着这四格（存在性先于取值）', async ({ page }) => {
  const errors = watchErrors(page);
  await openApp(page, APP_ZH);
  await switchView(page, '习惯');
  const a = await createHabit(page, `月度统计A-${STAMP}`);
  const b = await createHabit(page, `月度统计B-${STAMP}`);

  /* 🔴 2026-10-05（工单 §8.131）：窗格不再"默认展示第一条"，所以这里**必须先选一条**，
     否则这一面在浏览器里根本没有卡片（旧版本这条判据靠那枚宿主猜的回落拿到分母）。 */
  await selectHabit(page, a);

  const cards = page.locator('[data-testid^="habit-card-"]');
  const count = await cards.count();
  expect(count, '卡片数就是分母：零张卡的存在性判据是空集，什么都不说明').toBeGreaterThan(0);

  for (let i = 0; i < count; i += 1) {
    const card = cards.nth(i);
    const cardId = (await card.getAttribute('data-testid'))!.replace('habit-card-', '');
    for (const prefix of CELL_PREFIXES) {
      await expect(
        card.locator(`[data-testid="${prefix}-${cardId}"]`),
        `卡片 ${cardId} 里少了「${prefix}」这一格`,
      ).toHaveCount(1);
    }
  }

  await selectHabit(page, a);
  await expect(page.getByTestId(`habit-month-days-${a}`)).toContainText('本月打卡');
  await expect(page.getByTestId(`habit-month-rate-${a}`)).toContainText('本月完成率');

  // 🔴 上面那个循环的分母其实只有"窗格里当前这一枚卡片"（这一面是列表 + 窗格）。
  //    换一条习惯再查一遍，才把"四格只长在**某一枚**上"这种形状挡住 —— 自 §8.131 起
  //    窗格里没有"默认那一枚"，所以这一腿量的正是**换人之后新那一枚**也带着四格。
  await selectHabit(page, b);
  for (const prefix of CELL_PREFIXES) {
    await expect(
      page.getByTestId(`${prefix}-${b}`),
      `换到第二条习惯后少了「${prefix}」`,
    ).toHaveCount(1);
  }
  await page.screenshot({ path: SHOT('light-two-cards') });
  expect(errors, `控制台报错：${errors.join(' | ')}`).toEqual([]);
});

test('M2 🔴 点一次卡 ⇒ 天数与总完成量各 +1，刷新后仍在（真的落盘，不是 DOM 回读）', async ({ page }) => {
  const errors = watchErrors(page);
  await openApp(page, APP_ZH);
  await switchView(page, '习惯');
  const id = await createHabit(page, `月度统计打卡-${STAMP}`);
  await selectHabit(page, id);

  const daysBefore = await cellText(page, 'habit-month-days', id);
  const totalBefore = await cellText(page, 'habit-total-value', id);
  expect(daysBefore, `起点不是 0 天：${daysBefore}`).toContain('0');

  await page.getByTestId(`habit-checkin-${id}`).click();
  await expect
    .poll(async () => await cellText(page, 'habit-month-days', id), { timeout: 10_000 })
    .toContain('1');

  await page.reload({ waitUntil: 'networkidle' });
  await switchView(page, '习惯');
  await selectHabit(page, id);
  expect(await cellText(page, 'habit-month-days', id), '刷新后天数为 1').toContain('1');
  expect(await cellText(page, 'habit-total-value', id), '总完成量没有跟着动').not.toBe(totalBefore);
  await page.screenshot({ path: SHOT('light-after-checkin') });
  expect(errors, `控制台报错：${errors.join(' | ')}`).toEqual([]);
});

test('M3 🔴 单位分叉：有 unit 带「杯」，没有 unit 不带、也不出现 undefined', async ({ page }) => {
  const errors = watchErrors(page);
  await openApp(page, APP_ZH);
  await switchView(page, '习惯');

  const plain = await createHabit(page, `月度统计无单位-${STAMP}`);
  await selectHabit(page, plain);
  await page.getByTestId(`habit-checkin-${plain}`).click();
  await expect
    .poll(async () => await cellText(page, 'habit-month-days', plain), { timeout: 10_000 })
    .toContain('1');
  const plainMonth = await cellText(page, 'habit-month-value', plain);
  expect(plainMonth, `无 unit 的习惯退化成空串：${plainMonth}`).toMatch(/本月完成量\s*\S/);
  expect(plainMonth).not.toContain('undefined');

  const counted = await createHabit(page, `月度统计有单位-${STAMP}`);
  await selectHabit(page, counted);
  await page.getByTestId(`habit-goal-toggle-${counted}`).click();
  const panel = page.getByTestId(`habit-goal-panel-${counted}`);
  await expect(panel).toBeVisible();
  await panel.getByTestId(`habit-goal-target-${counted}`).fill('8');
  await panel.getByTestId(`habit-goal-unit-${counted}`).fill('杯');
  await panel.getByTestId(`habit-goal-type-atLeast-${counted}`).click();
  await expect
    .poll(async () => (await page.getByTestId(`habit-goal-summary-${counted}`).innerText()).includes('8'), {
      message: '目标没写成 8 —— 载体没成立，后面那两格的读数无效',
    })
    .toBe(true);

  for (let i = 0; i < 3; i += 1) await page.getByTestId(`habit-amount-plus-${counted}`).click();
  await expect
    .poll(async () => await cellText(page, 'habit-month-value', counted), { timeout: 10_000 })
    .toContain('3');
  expect(await cellText(page, 'habit-month-value', counted)).toContain('杯');
  expect(await cellText(page, 'habit-total-value', counted)).toContain('杯');
  await page.screenshot({ path: SHOT('light-unit-vs-no-unit') });
  expect(errors, `控制台报错：${errors.join(' | ')}`).toEqual([]);
});

/** 逐层合成 alpha 后，取"文字亮度 / 它实际压着的背景亮度"。 */
async function inkAndBackdrop(page: Page, testId: string): Promise<{ fg: number; bg: number }> {
  return page.evaluate((sel) => {
    const parse = (v: string): [number, number, number, number] => {
      const m = /rgba?\(([^)]+)\)/.exec(v);
      if (!m) return [255, 255, 255, 1];
      const p = m[1]!.split(/[\s,/]+/).filter(Boolean).map(Number);
      return [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0, p[3] ?? 1];
    };
    const lum = (c: [number, number, number, number]) => {
      const f = (x: number) => {
        const s = x / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
    };
    const el = document.querySelector(sel);
    if (!el) throw new Error(`找不到 ${sel}`);
    const layers: [number, number, number, number][] = [];
    for (let n: Element | null = el; n !== null; n = n.parentElement) {
      const bg = parse(getComputedStyle(n).backgroundColor);
      if (bg[3] > 0) layers.unshift(bg);
      if (n === document.documentElement) break;
    }
    let acc: [number, number, number, number] = layers.length ? layers[0]! : [255, 255, 255, 1];
    for (let i = 1; i < layers.length; i += 1) {
      const l = layers[i]!;
      acc = [0, 1, 2].map((k) => l[k]! * l[3] + acc[k]! * (1 - l[3])) as [number, number, number, number];
      acc[3] = 1;
    }
    return { fg: lum(parse(getComputedStyle(el).color)), bg: lum(acc) };
  }, `[data-testid="${testId}"]`);
}

test('M4 🔴 暗色要真的切过去（emulateMedia 不算），四格字色与底色两边都要量', async ({ page }) => {
  const errors = watchErrors(page);
  await openApp(page, APP_ZH);
  await switchView(page, '习惯');
  const id = await createHabit(page, `月度统计暗色-${STAMP}`);
  await selectHabit(page, id);
  await page.getByTestId(`habit-checkin-${id}`).click();
  await expect
    .poll(async () => await cellText(page, 'habit-month-days', id), { timeout: 10_000 })
    .toContain('1');

  // 亮色档先量一次 —— 它是暗色那条断言的**对照**：没有它，"亮度差"可以恒真。
  const light = await inkAndBackdrop(page, `habit-month-days-${id}`);
  expect(light.fg, `亮色下文字不该是亮字：${JSON.stringify(light)}`).toBeLessThan(0.5);
  expect(light.bg, `亮色下画布不该是深底：${JSON.stringify(light)}`).toBeGreaterThan(0.6);

  // 🔴 主题由应用自己的开关决定（`html[data-theme]`），`emulateMedia` 改的是
  //   `prefers-color-scheme`，切不动它 —— 上一版这一条**过了但量的是亮色那张图**，
  //   是"用例名字比断言强"的假绿。断言必须钉住属性真的翻了。
  await switchTheme(page, 'dark');
  await expect(page.getByTestId(`habit-month-rate-${id}`)).toBeVisible();

  const dark = await inkAndBackdrop(page, `habit-month-days-${id}`);
  expect(dark.fg, `暗色下四格文字不该还是深字：${JSON.stringify(dark)}`).toBeGreaterThan(0.5);
  expect(dark.bg, `暗色下画布没真的翻：${JSON.stringify(dark)}`).toBeLessThan(0.4);
  await page.screenshot({ path: SHOT('dark-month-cells') });
  expect(errors, `控制台报错：${errors.join(' | ')}`).toEqual([]);
});
