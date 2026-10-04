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
 *
 * 📌 "怎么加一条倒数日"那几步现在住在 `./countdown-events.ts`（W7 的导出用例也要用它）。
 *    搬过去而不是抄一份：那份代码的形状由共享 `EventBoard` 的 testID 决定，
 *    抄两处的话契约改一次只有一份会红，另一份按旧形状点、症状是超时。
 */
import { expect, test } from '@playwright/test';
import {
  decidePrivacyConsent,
  openApp,
  pinChineseUi,
  switchView,
} from './helpers';
import { installMissingProducerShims } from './shims';
import {
  BOARD,
  TAB,
  addCountdownEvent,
  cardByTitle,
  collectErrors,
  nextMonthFirst,
  openCardMenu,
  prevMonthSecond,
} from './countdown-events';


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
    await addCountdownEvent(page, '上线那天', target.label, 1);

    const days = page.locator('[data-testid^="event-card-"]').first().locator('[data-testid^="event-days-"]');
    // 🔴 期望值从**日历事实**算（独立真值），不是把领域的算术抄一遍：
    // 界面必须说出"下月 1 号距今 N 天"里的那个 N。
    //
    // ⚠️ 这里原来写的是 `28 ≤ N ≤ 31` —— 那不是日历事实，是**"今天恰好是月初"**。
    //   N 的真实取值范围是 `1..31`（当月最后一天 ⇒ 1 天，当月 1 号 ⇒ 最多 31 天），
    //   所以那一句让这条用例在**每月 5 号之后每天必红**，而红字写的是"下月 1 号距今
    //   应落在 28–31 天" —— 读起来像产品的日历算错了。2026-10-05 现量 N=27 命中。
    //   留下来的界仍然挡得住它本来想挡的：目标日落到过去（N ≤ 0）或挑错了月份（N > 31）。
    expect(target.days, '下月 1 号必须是**未来**的一天').toBeGreaterThanOrEqual(1);
    expect(target.days, '下月 1 号不可能比一个月更远').toBeLessThanOrEqual(31);
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

    await addCountdownEvent(page, '甲日子', nextMonthFirst().label, 1);
    // 第二条用**上一月**的格子 ⇒ 一前一后，顺带把"逾期"那一副面孔也画进同一张图。
    await addCountdownEvent(page, '乙日子', prevMonthSecond(), -1);

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
    await addCountdownEvent(page, '要归档的日子', nextMonthFirst().label, 1);

    const card = await openCardMenu(page, '要归档的日子');
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
    // 🔴 原来这里直接数"屏幕上有一张卡"，那是**一句会随机翻转的断言**：
    //   还原之后界面**仍停在归档视图**，所以它既可能数到还没重算完的那一张（假绿），
    //   也可能等 15 秒数到 0（假红）。同一份代码实测两趟：16.7s 数到 0、retry 1.4s 数到 1。
    //   正确的两条可观测后果是：归档视图空掉 + **切回主列表**它在。
    await expect(page.getByTestId('event-empty'), '还原之后归档视图必须空掉').toBeVisible();
    await page.getByTestId('event-toggle-view').click();
    await expect(cardByTitle(page, '要归档的日子'), '还原之后主列表必须有它').toHaveCount(1);
    expect(errors, `控制台不该有 error：\n${errors.join('\n')}`).toEqual([]);
  });

  test('就地编辑改标题：刷新后新名字还在（保存真的落了一条 op）', async ({ page }) => {
    const errors = await collectErrors(page);
    await openApp(page);
    await switchView(page, TAB);
    await addCountdownEvent(page, '旧名字', nextMonthFirst().label, 1);

    const card = await openCardMenu(page, '旧名字');
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
