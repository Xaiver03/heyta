import { expect, test } from '@playwright/test';
import { openApp, switchView } from './helpers';

/**
 * 激励体系的**真浏览器**验收。
 *
 * 与 `smoke.spec.ts` 的分工：那条证明"链路本身是通的"（环境问题还是功能问题），
 * 这条验的是**激励体系自己的设计契约** —— 所以每一条都必须是**能失败**的，
 * 断言里写的都是我们从源码里刻意选定的判据，不是"页面能打开"。
 *
 * ## 判据来自哪些源码
 *
 * - 7 个标签与顺序：`apps/web/src/App.tsx` 的 `VIEW_TABS`
 * - 哪 5 个视图的居中标题 === 标签：同文件的 `VIEW_TITLED_BY_TAB`
 * - 进度卡的可见范围：同文件的 `{view !== 'settings' && view !== 'growth' && …}`
 * - 周复盘 / 年度视图 / 中性差值：`apps/web/src/features/motivation/GrowthView.tsx`
 * - `section.ht-today`：`apps/web/src/features/motivation/TodayProgressCard.tsx`
 *
 * ## 🔴 为什么进度卡的可见范围值得一条用例
 *
 * 它常驻「做事」的四个视图（任务 / 四象限 / 习惯 / 番茄钟）而不常驻设置页与成长页。
 * 成长页是**故意**排除的：那一页讲的是更长尺度，再顶一条"今天 3/5"会把"历史"
 * 重新压回"今天"，恰好抵消掉那个页面存在的意义。
 * **这种"某处故意不显示"的约束最容易被后来的一次重构抹掉，而抹掉之后什么都不报错。**
 */

const TABS = ['任务', '四象限', '习惯', '番茄钟', '时间线', '成长', '设置'] as const;
type Tab = (typeof TABS)[number];

/** 居中标题 === 标签本身的视图（其余视图的标题是清单/筛选名） */
const TITLED = ['习惯', '番茄钟', '时间线', '成长', '设置'] as const satisfies readonly Tab[];

/** 今日进度卡应当出现的视图 = 全部 − 设置 − 成长 */
const CARD_ON = ['任务', '四象限', '习惯', '番茄钟', '时间线'] as const satisfies readonly Tab[];
const CARD_OFF = ['设置', '成长'] as const satisfies readonly Tab[];

/**
 * 已登记的已知缺失：仓库**从来没有** favicon
 * （源 `apps/web/index.html` 无引用、无 `public/`、git 里一个 `.ico` 都没有、main 同样如此）。
 *
 * 🔴 这里登记**具体路径**，而不是过滤 "404" 字样 ——
 * 后者会把将来真正坏掉的资源一起藏掉（v1 的自检脚本正是这么写的，已改）。
 */
const KNOWN_MISSING = ['/favicon.ico'] as const;

test.describe('激励体系：真浏览器契约', () => {
  test('七个视图标签齐全，顺序与文案逐字一致', async ({ page }) => {
    await openApp(page);

    const tabs = page.getByRole('tab');
    await expect(tabs).toHaveCount(7);

    const labels = (await tabs.allTextContents()).map((t) => t.trim());
    expect(labels, '标签的顺序与文案都必须与 VIEW_TABS 逐字一致').toEqual([...TABS]);
  });

  test('有居中标题的五个视图，标题等于标签本身', async ({ page }) => {
    await openApp(page);

    for (const tab of TITLED) {
      await switchView(page, tab);
      await expect(
        page.locator('.ht-header__title').first(),
        `${tab} 页的居中标题应当就是「${tab}」`,
      ).toHaveText(tab);
    }
  });

  test('🔴 今日进度卡常驻做事视图，且不在设置页与成长页', async ({ page }) => {
    await openApp(page);
    const card = page.locator('section.ht-today');

    for (const tab of CARD_ON) {
      await switchView(page, tab);
      await expect(card, `${tab} 应当显示今日进度卡`).toHaveCount(1);
    }
    for (const tab of CARD_OFF) {
      await switchView(page, tab);
      await expect(card, `${tab} 不该显示今日进度卡`).toHaveCount(0);
    }
  });

  test('成长页渲染周复盘与年度视图，差值中性、无负数', async ({ page }) => {
    await openApp(page);
    await switchView(page, '成长');

    const growth = page.locator('.ht-growth');
    await expect(growth).toHaveCount(1);
    await expect(growth, '周复盘').toContainText('本周');
    await expect(growth, '年度视图').toContainText('这一年');
    await expect(growth, '差值只用中性表述（"还差"），不出现"比上周少"').toContainText('还差');
    await expect(growth, '最长/累计只增不减这条红线要在界面上说出来').toContainText('只增不减');

    // 🔴 先剥离 ISO 日期再断言 —— `2026-09-21` 里的 `-09` 不是负数。
    // （这一条踩过：自检脚本 v1 用裸的 `-\d` 把日期判成了负数。）
    const text = (await growth.textContent()) ?? '';
    const noDates = text.replace(/\d{4}-\d{2}-\d{2}/gu, '');
    expect(noDates, '剥离 ISO 日期后不该出现任何负数').not.toMatch(/-\d/u);
  });

  test('每个视图都有实质内容（白屏检测）', async ({ page }) => {
    await openApp(page);

    for (const tab of TABS) {
      await switchView(page, tab);
      const text = ((await page.locator('body').textContent()) ?? '').trim();
      expect(text.length, `${tab} 的文本长度 ${String(text.length)}，疑似白屏`).toBeGreaterThan(60);
    }
  });

  test('走一遍全部视图，控制台不出现意外 error', async ({ page }) => {
    const consoleErrors: string[] = [];
    const badResponses: string[] = [];
    page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${String(e)}`));
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('response', (r) => {
      if (r.status() >= 400) badResponses.push(new URL(r.url()).pathname);
    });

    await openApp(page);
    for (const tab of TABS) await switchView(page, tab);

    const unexpected = badResponses.filter(
      (u) => !KNOWN_MISSING.some((k) => u === k),
    );
    expect(unexpected, `除已登记缺失外不该有非 2xx：${JSON.stringify(unexpected)}`).toEqual([]);

    // "Failed to load resource" 那类已由上面的 URL 断言精确覆盖，
    // 这里要的是**其余**控制台 error 为零（即真正的 JS 层报错）。
    const nonResource = consoleErrors.filter((t) => !/Failed to load resource/u.test(t));
    expect(nonResource, `不该有 JS 层报错：${JSON.stringify(nonResource)}`).toEqual([]);
  });
});