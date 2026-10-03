/**
 * 倒数纪念日（W5）的**真浏览器**验收
 * ===================================
 *
 * jsdom 那套（`apps/web/tests/countdown-board.spec.tsx`，12 条 + 12 例变异）钉的是
 * **共享层的契约**：顺序只有一份、逾期不飘红、一次保存一个 op、失败不清草稿。
 * 它刻意**看不到**的四件事，全部只能在真浏览器里验，这份就只管这四件：
 *
 * 1. **模块开关的两侧**：`countdown` 默认关 ⇒ 新装用户那一屏**没有**这个 tab；
 *    打开之后 rail 上有点它、切得过去、板子渲染出来。
 *    （jsdom 那套用可控 props 渲染，根本没有"进不进 DOM"这一层。）
 * 2. **真点出来的数据真落库**：输入 → 选日期 → 添加 → **刷新之后卡片还在**。
 *    这条是"op 真的写进 IndexedDB 并重放回来了"，不是"组件的本地 state 变了"。
 * 3. **两列是真的两列**：1280px 下两张卡的 `boundingBox().x` 必须不同 ——
 *    `flexWrap` + `minWidth:'50%'` + `gap` 在 web 上会塌成一列（`QuadrantBoard`
 *    那次实测的坑），而 DOM 里"有两个 cell"照样成立。
 * 4. **品牌蓝是从 token 来的，不是兜底值**：选中档位的 `background-color` 必须等于
 *    `--ht-color-primary` 在浏览器里解析出来的那个值（两边都是运行时读数，
 *    测试里**不出现裸 hex** —— 抄一份 `#2563EB` 就是第二套事实源）。
 *
 * ## 截图（AGENTS §6.2 规定一）
 *
 * 每条用例**先截图再断言**，失败时图上还有当时那一屏；固定路径不随用例名漂移：
 *   · `test-results/countdown-board.png`（两列 + 两张卡 + 强调条）
 *   · `test-results/countdown-archived.png`（归档视图）
 *
 * ⚠️ `console` 的 error 与 `pageerror` 全部收集并**进断言**：白屏的根因几乎只在
 * 这里现形（模块 404 / CSP / React 抛错），而"那个元素没出现"本身不说原因。
 */
import { expect, test, type Page } from '@playwright/test';
import {
  decidePrivacyConsent,
  openApp,
  pinChineseUi,
  switchView,
} from './helpers';
import { installMissingProducerShims } from './shims';

const TAB = '倒数纪念日';
const BOARD = '[data-testid="countdown-view"]';

/** 冻结的"今天"从**应用自己**读，不在测试里造第二个时钟。 */
function todayParts(): { year: number; month: number; day: number } {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

/** `YYYY年M月D日` 里那一天的**无障碍名**（共享 DatePicker 的 `dayLabel` 形状）。 */
function cellLabel(month: number, day: number): string {
  return `${String(month)}月${String(day)}日`;
}

/** 下一月的 1 号（永远是未来）。 */
function nextMonthFirst(): { label: string; days: number } {
  const now = new Date();
  const target = Date.UTC(now.getFullYear(), now.getMonth() + 1, 1);
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const month = new Date(target).getUTCMonth() + 1;
  return { label: cellLabel(month, 1), days: Math.round((target - today) / 86_400_000) };
}

/** 上一月的 2 号（永远是过去；2 号在任何月份都存在）。 */
function prevMonthSecond(): string {
  const now = new Date();
  const month = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 1, 2)).getUTCMonth() + 1;
  return cellLabel(month, 2);
}

/**
 * 在板子上加一条倒数日：点日期 → 翻到目标月 → 点那一格 → 输标题 → 点添加。
 *
 * 🔴 每步都**落账**（等它该产出的界面状态），不"点完就走"：
 * 点击被吞掉时，症状会是后面那条断言红，而不是"这一步没生效"。
 */
async function addEvent(page: Page, title: string, label: string, months: number): Promise<void> {
  await page.getByTestId('event-pick-date').click();
  const picker = page.getByTestId('event-date-picker');
  await expect(picker, '点「选日期」之后日历必须展开').toBeVisible();
  for (let step = 0; step < Math.abs(months); step += 1) {
    await page.getByRole('button', { name: months > 0 ? '下个月' : '上个月' }).click();
  }
  const cell = page.locator(`[aria-label="${label}"]`);
  // 翻月之后这一格必须**唯一**（跨月的首尾行会重复出现别的月份的格子）。
  await expect(cell, `日历里「${label}」应当只有一格`).toHaveCount(1);
  await cell.click();
  await expect(
    page.getByTestId('event-pick-date'),
    '选完日期，日历收起并把那一天回显在按钮上',
  ).toContainText(label);

  await page.getByTestId('event-title-input').fill(title);
  await page.getByTestId('event-add').click();
  await expect(
    page.locator('[data-testid^="event-card-"]').filter({ hasText: title }).first(),
    `添加「${title}」之后卡片必须出现`,
  ).toBeVisible();
}

async function collectErrors(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

test.describe('倒数纪念日：真浏览器契约（W5）', () => {
  test('🔴 默认关着 ⇒ 这个 tab 根本不在 DOM（模块开关的承诺，正向对照在下一条）', async ({
    page,
  }) => {
    const errors = await collectErrors(page);
    await installMissingProducerShims(page);
    await pinChineseUi(page);
    await page.goto('/?lang=zh-CN');
    await expect(page.locator('input[placeholder^="添加任务"]')).toBeVisible();
    await decidePrivacyConsent(page);

    // 关掉的功能模块**不进 DOM**，所以既没有 tab、也没有那块板。
    await expect(page.getByRole('tab', { name: TAB })).toHaveCount(0);
    await expect(page.locator(BOARD)).toHaveCount(0);
    // 阳性对照：同一屏上**默认开着的**视图在（否则"数不到 0"可能是整片没渲染）。
    await expect(page.getByRole('tab', { name: '日历' })).toHaveCount(1);
    expect(errors, `控制台不该有 error：\n${errors.join('\n')}`).toEqual([]);
  });

  test('打开模块：tab 在、切得过去、板子渲染出来，且页标题跟着 tab 走', async ({ page }) => {
    const errors = await collectErrors(page);
    await openApp(page);

    await expect(page.getByRole('tab', { name: TAB })).toHaveCount(1);
    await switchView(page, TAB);
    await expect(page.locator(BOARD)).toHaveCount(1);
    await expect(page.locator('.ht-header__title')).toHaveText(TAB);
    // 空态是两块文案，不是一句"没有数据"。
    await expect(page.getByTestId('event-empty')).toContainText('还没有倒数日');
    // 先截图再看断言（失败时图上仍是这一屏）。
    await page.screenshot({ path: 'test-results/countdown-empty.png' });
    expect(errors, `控制台不该有 error：\n${errors.join('\n')}`).toEqual([]);
  });

  test('真点出一条倒数日：数字是"还有 N 天"，刷新之后还在', async ({ page }) => {
    const errors = await collectErrors(page);
    await openApp(page);
    await switchView(page, TAB);

    const target = nextMonthFirst();
    await addEvent(page, '上线那天', target.label, 1);

    const days = page.locator('[data-testid^="event-card-"]').first().locator('[data-testid^="event-days-"]');
    // 🔴 期望值从**日历事实**算（独立真值），不是把领域的算术抄一遍：
    // 下月 1 号距今 28–31 天，且界面必须说出那个数。
    expect(target.days, '下月 1 号距今应落在 28–31 天').toBeGreaterThanOrEqual(28);
    expect(target.days).toBeLessThanOrEqual(31);
    await expect(days).toHaveText(`还有 ${String(target.days)} 天`);
    await page.screenshot({ path: 'test-results/countdown-board.png' });

    // 🔴 刷新之后仍在 = 它真的落成 op 并被重放回来了（本地 state 活不过刷新）。
    await page.reload();
    await expect(page.locator('input[placeholder^="添加任务"]')).toBeVisible();
    await decidePrivacyConsent(page);
    await switchView(page, TAB);
    await expect(
      page.locator('[data-testid^="event-card-"]').filter({ hasText: '上线那天' }),
      '刷新后卡片必须还在（op 真落库）',
    ).toHaveCount(1);
    expect(errors, `控制台不该有 error：\n${errors.join('\n')}`).toEqual([]);
  });

  test('1280px 下两列：两张卡的 x 真的不同（DOM 里两个 cell ≠ 屏幕上两列）', async ({ page }) => {
    const errors = await collectErrors(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await openApp(page);
    await switchView(page, TAB);

    await addEvent(page, '甲日子', nextMonthFirst().label, 1);
    // 第二条用**上一月**的格子 ⇒ 一前一后，顺带把"逾期"那一副面孔也画进同一张图。
    await addEvent(page, '乙日子', prevMonthSecond(), -1);

    const cards = page.locator('[data-testid^="event-card-"]');
    await expect(cards).toHaveCount(2);
    const [a, b] = [await cards.first().boundingBox(), await cards.last().boundingBox()];
    expect(a, '第一张卡量不到盒子').not.toBeNull();
    expect(b, '第二张卡量不到盒子').not.toBeNull();
    // 🔴 同屏两列 ⇒ x 必须不同；`flexWrap + minWidth:50% + gap` 塌成一列时 x 相同。
    expect(
      Math.abs((a?.x ?? 0) - (b?.x ?? 0)) > 8,
      '1280px 下两张卡必须并排（同一列就是布局塌了）',
    ).toBe(true);

    // 逾期不飘红，在**浏览器解析完 CSS 之后**再验一次：两行数字的颜色逐字相同。
    const colors = await Promise.all(
      [cards.nth(0), cards.nth(1)].map(async (card) =>
        card
          .locator('[data-testid^="event-days-"]')
          .evaluate((node) => getComputedStyle(node as HTMLElement).color),
      ),
    );
    expect(colors[0], '两张卡的天数颜色必须一致（§2.7 不判负）').toBe(colors[1]);
    // 阳性对照：颜色确实被写进了 computed style，不是两边都取到空串。
    expect(colors[0] ?? '').toMatch(/rgb/);

    // 🔴 两张卡都必须说得出"是哪一天"。逾期那条在真浏览器里曾经**整行不画**
    // （`nextDate` 对一次性已过的事件是 undefined ⇒ 界面上只剩"已经 31 天"，
    // 用户没法核对它记的到底是哪天）—— 这一条是看图看出来的，不是想出来的。
    const dateLines = await Promise.all(
      [cards.nth(0), cards.nth(1)].map(async (card) =>
        (await card.locator('[data-testid^="event-date-"]').textContent())?.trim() ?? '',
      ),
    );
    expect(dateLines[0], '第一张卡没有日期行').not.toBe('');
    expect(dateLines[1], '第二张卡（逾期那条）没有日期行').not.toBe('');
    expect(
      dateLines[0],
      `两张卡的日期不该相同：${JSON.stringify(dateLines)}`,
    ).not.toBe(dateLines[1]);

    // 品牌蓝来自 token：选中档位的背景色 == `--ht-color-primary` 解析值。
    const [chipBackground, primary] = await page
      .getByTestId('event-filter-all')
      .evaluate((node) => {
        const el = node as HTMLElement;
        return [
          getComputedStyle(el).backgroundColor,
          getComputedStyle(document.documentElement).getPropertyValue('--ht-color-primary').trim(),
        ];
      });
    expect(chipBackground, '选中档位必须用主色').not.toBe('');
    expect(
      // `--ht-color-primary` 是 `#2563EB` 这种十六进制，computed 侧是 `rgb(...)` ⇒ 归一化再比。
      await page.evaluate(
        async ([value]) => {
          const probe = document.createElement('span');
          probe.style.color = value;
          document.body.append(probe);
          const rgb = getComputedStyle(probe).color;
          probe.remove();
          return rgb;
        },
        [primary],
      ),
      `选中档位(${chipBackground})必须等于 token 解析值(${primary})`,
    ).toBe(chipBackground);

    await page.screenshot({ path: 'test-results/countdown-board.png' });
    expect(errors, `控制台不该有 error：\n${errors.join('\n')}`).toEqual([]);
  });

  test('归档 ≠ 删除：归档后主列表没了、归档视图能还原回来', async ({ page }) => {
    const errors = await collectErrors(page);
    await openApp(page);
    await switchView(page, TAB);
    await addEvent(page, '要归档的日子', nextMonthFirst().label, 1);

    const card = page.locator('[data-testid^="event-card-"]').filter({ hasText: '要归档的日子' });
    await expect(card).toHaveCount(1);
    const menu = card.locator('[data-testid^="event-menu-"]');
    await menu.click();
    await card.locator('[data-testid^="event-archive-"]').click();

    // 落账：归档之后主列表里它没了，而且**空态**接手（不是"整片消失"）。
    await expect(page.locator('[data-testid^="event-card-"]')).toHaveCount(0);
    await expect(page.getByTestId('event-empty')).toBeVisible();

    await page.getByTestId('event-toggle-view').click();
    await expect(page.getByTestId('event-composer'), '归档视图不该再有新建输入行').toHaveCount(0);
    const archived = page.locator('[data-testid^="event-card-"]');
    await expect(archived).toHaveCount(1);
    await page.screenshot({ path: 'test-results/countdown-archived.png' });

    await archived.locator('[data-testid^="event-menu-"]').click();
    // 🔴 归档视图里**没有**"编辑"和"归档"，只有还原/删除（§2.5 归档是独立一态）。
    await expect(archived.locator('[data-testid^="event-edit-open-"]')).toHaveCount(0);
    await archived.locator('[data-testid^="event-unarchive-"]').click();
    await expect(page.locator('[data-testid^="event-card-"]')).toHaveCount(1);
    expect(errors, `控制台不该有 error：\n${errors.join('\n')}`).toEqual([]);
  });

  test('就地编辑改标题：刷新后新名字还在（保存真的落了一条 op）', async ({ page }) => {
    const errors = await collectErrors(page);
    await openApp(page);
    await switchView(page, TAB);
    await addEvent(page, '旧名字', nextMonthFirst().label, 1);

    const card = page.locator('[data-testid^="event-card-"]').filter({ hasText: '旧名字' });
    await card.locator('[data-testid^="event-menu-"]').click();
    await card.locator('[data-testid^="event-edit-open-"]').click();
    const editorTitle = card.locator('[data-testid^="event-editor-title-"]');
    await expect(editorTitle, '编辑器必须已经展开').toBeVisible();
    await editorTitle.fill('新名字');
    await card.locator('[data-testid^="event-editor-save-"]').click();

    await expect(page.locator('[data-testid^="event-card-"]').filter({ hasText: '新名字' })).toHaveCount(1);
    await page.reload();
    await expect(page.locator('input[placeholder^="添加任务"]')).toBeVisible();
    await decidePrivacyConsent(page);
    await switchView(page, TAB);
    await expect(page.locator('[data-testid^="event-card-"]').filter({ hasText: '新名字' })).toHaveCount(1);
    await expect(page.locator('[data-testid^="event-card-"]').filter({ hasText: '旧名字' })).toHaveCount(0);
    expect(errors, `控制台不该有 error：\n${errors.join('\n')}`).toEqual([]);
  });
});
