/**
 * 习惯清单 = **两列卡片**（工单 H1 = W13a）
 * ==========================================
 *
 * 产品负责人拿滴答的习惯页对照，指的不是数字不够多，是**排法**：
 * 我们这一列是一条纵列（一行一个习惯），滴答是两列卡片。
 * 落点只有 CSS（`apps/web/src/styles/app/habits.css`），DOM 结构一行不动 ——
 * 中栏是 web 的 DOM 层，`packages/ui/src/habits/*` 一动就推给四端（本单明确不动它）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 为什么这一层必须在浏览器里量（jsdom 那 8 组判据已经存在）
 *
 * `apps/web/tests/habits-list-pane.spec.tsx` 量的是**结构与取数**（一行一个习惯、
 * 三个数字常驻、7 个点、图标闭集）。它量不到"两列"这件事本身 ——
 * **jsdom 不做布局**，`boundingBox()` 在 jsdom 里恒为 0，
 * 所以"第 1、2 张卡在同一排"这种结论**只有这里能给**（AGENTS §6.2 规定一 + 本仓库 W5 那批教训：
 * 断言只会验界面写了什么，验不出界面**少了**什么）。
 *
 * 台架：`research/tools/mutation-rigs/mutate-habits-two-column.mjs`（三臂 layout-only，
 * 腿 A 专门证明 jsdom 那一层对这三份坏**一条都不红**）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ 载体是 `vite preview` + `apps/web/dist`（见 `playwright.detail-pane.config.ts` 文件头）：
 *    改完 `apps/web/src/**` **必须先重打**，否则量的是旧产物（§7 第 27 条那一族）。
 *    跑法（仓库根）：
 *      pnpm --filter @heyta/web build && cd e2e && \
 *        npx playwright test tests/habits-two-column.spec.ts --config playwright.detail-pane.config.ts
 *
 * ⚠️ 与 `habits-pane.spec.ts` / `detail-pane-habit.spec.ts` 的分工：
 *    前者量"列表 + 窗格"这套版式自己的四件事，`detail-pane-habit` 量 H8 那条"整行铺满"（量的是**行**），
 *    这一份量**卡片之间的排法**与**每张卡的零件齐不齐**。阈值全部从被约束的常量推导
 *    （`--ht-space-2` 的网格间距、`--ht-space-3` 的卡片内边距），不抄像素字面量。
 */
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';

import { addHabit, boxOf, openApp, switchView } from './helpers';

const APP_ZH = '/?lang=zh-CN';

/** 截图落**固定路径**（§6.2 规定一第 2 条），跑完可以直接打开同一张看。 */
const SHOT = (name: string) =>
  fileURLToPath(
    new URL(`../../apps/web/evidence/habits-two-column/${name}.png`, import.meta.url),
  );

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  // 🔴 监听在导航之前挂上（§6.2 规定一第 3 条）：挂晚了收不到加载期错误，
  //    而"控制台无内容"是这一族最误导人的读数。
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e)}`));
  return errors;
}

const cards = (page: Page): Locator => page.locator('.ht-habit__list > .ht-habit__item');

/**
 * 清单这一列**实际算出几根列轨道**（CSSOM 的 resolved 值，不是源码里那行声明）。
 *
 * 🔴 它当"前提"用，不当结论用：本单真正的判据是下面的几何（同一排、间距等宽、铺满整列），
 *    这一条只负责先钉住"这一趟确实走在两列那一支上"。
 *    只读源码里的 `repeat(2, …)` 挡不住"规则被层叠吃掉"—— 同仓
 *    `mutate-detail-pane-habit-e2e.mjs` 文件头记的 E2 第一版就是因为层叠打空、五条全绿。
 */
async function listTrackCount(page: Page): Promise<number> {
  const value = await page
    .locator('.ht-habit__list')
    .evaluate((el) => getComputedStyle(el).gridTemplateColumns);
  return value.split(' ').filter(Boolean).length;
}

/** 把某个 CSS 变量的**实际像素值**量出来（阈值从被约束的常量推导，不抄字面量）。 */
async function pxOfCssVar(page: Page, name: string): Promise<number> {
  return page.evaluate((varName) => {
    const probe = document.createElement('div');
    probe.style.position = 'absolute';
    probe.style.visibility = 'hidden';
    probe.style.inlineSize = `var(${varName})`;
    document.body.appendChild(probe);
    const px = probe.getBoundingClientRect().width;
    probe.remove();
    return px;
  }, name);
}

/**
 * 每张卡的**零件清点**（存在性判据，排在一切内容判据之前）。
 *
 * 🔴 数的是**每张卡各自**的零件，不是整列的总数：整列总数对而上、某一张少一枚点
 *    是读不出来的（W5 那批实测出来的形状 —— "15 条断言全绿的截图里少了一整行日期"）。
 */
async function inventory(page: Page) {
  return page.evaluate(() => {
    const items = Array.from(
      document.querySelectorAll('.ht-habit__list > .ht-habit__item'),
    );
    return items.map((li) => ({
      rows: li.querySelectorAll('[data-testid^="habit-row-"]').length,
      discs: li.querySelectorAll('.ht-habit__disc').length,
      names: li.querySelectorAll('.ht-habit__name').length,
      dots: li.querySelectorAll('.ht-habit__dot').length,
      nums: li.querySelectorAll('.ht-habit__chip-num').length,
      marked: li.querySelectorAll('[data-testid^="habit-row-"][aria-current="true"]').length,
    }));
  });
}

test.describe('习惯清单两列卡片（H1）', () => {
  test('T1 每张卡的零件齐（底盘/名字/7 点/三个数各一枚），且卡片数 == 习惯数', async ({ page }) => {
    const errors = watchErrors(page);
    await openApp(page, APP_ZH);
    await switchView(page, '习惯');
    for (const name of ['喝水', '阅读', '跑步', '冥想']) await addHabit(page, name);

    await page.screenshot({ path: SHOT('cards-4-light') });
    expect(await cards(page).count(), '卡片数不等于习惯数').toBe(4);
    for (const card of await inventory(page)) {
      expect(card, '这一张卡少了零件').toEqual({
        rows: 1,
        discs: 1,
        names: 1,
        dots: 7,
        nums: 3,
        marked: 0,
      });
    }
    expect(errors, `控制台报错：${errors.join(' | ')}`).toEqual([]);
  });

  test('T2 宽容器 ⇒ 第 1、2 张在同一排（y 同 x 异），间距 == --ht-space-2', async ({ page }) => {
    await openApp(page, APP_ZH);
    await switchView(page, '习惯');
    await addHabit(page, '喝水');
    await addHabit(page, '阅读');

    const side = await boxOf(page, page.locator('.ht-habit__side'), '清单那一列');
    const gap = await pxOfCssVar(page, '--ht-space-2');
    // 🔴 先断言**前提成立**（AGENTS §7 元规则 2）：不写这一条，"两列成立"可能只是
    //    视口恰好没塌缩，而"两列那条规则本身被人摘了"在这一趟读数里读不出来。
    expect(
      await listTrackCount(page),
      `清单算出的列轨道不是两根（容器宽 ${String(Math.round(side.width))}px）`,
    ).toBe(2);

    const [a, b] = await Promise.all([
      boxOf(page, cards(page).nth(0), '第 1 张卡'),
      boxOf(page, cards(page).nth(1), '第 2 张卡'),
    ]);
    expect(Math.abs(a.y - b.y), `两张卡的 y 差了 ${String(Math.round(b.y - a.y))}px`).toBeLessThanOrEqual(
      1,
    );
    expect(b.x, '第 2 张卡不在第 1 张右边').toBeGreaterThan(a.x + a.width - 1);
    // 间距 = 网格 gap 的实际像素（不是"看起来挨着"）；两列等宽。
    expect(Math.abs(b.x - (a.x + a.width) - gap)).toBeLessThanOrEqual(1);
    expect(Math.abs(a.width - b.width), '两根轨道不等宽').toBeLessThanOrEqual(1);
    // 🔴 两张卡必须**合起来铺满整列**：只量"两张在同一排"挡不住"三根轨道排两根"
    //    那一份坏（卡片会挤在左边，右侧留一整块空白 —— 正是 H8 在行上防的那件事）。
    const list = await boxOf(page, page.locator('.ht-habit__list'), '清单容器');
    expect(Math.abs(a.x - list.x), '第一张卡没贴住清单左边缘').toBeLessThanOrEqual(1);
    expect(
      Math.abs(list.x + list.width - (b.x + b.width)),
      '两张卡右侧留了空轨道',
    ).toBeLessThanOrEqual(1);
  });

  test('T3 第三、四张也成排（两列不是"恰好两条"的巧合），且第二排在第一排之下', async ({ page }) => {
    await openApp(page, APP_ZH);
    await switchView(page, '习惯');
    for (const name of ['喝水', '阅读', '跑步', '冥想']) await addHabit(page, name);

    const [b1, b2, b3, b4] = await Promise.all([
      boxOf(page, cards(page).nth(0), '第 1 张卡'),
      boxOf(page, cards(page).nth(1), '第 2 张卡'),
      boxOf(page, cards(page).nth(2), '第 3 张卡'),
      boxOf(page, cards(page).nth(3), '第 4 张卡'),
    ]);
    expect(Math.abs(b1!.y - b2!.y), '第 1、2 张不在同一排').toBeLessThanOrEqual(1);
    expect(Math.abs(b3!.y - b4!.y), '第 3、4 张不在同一排').toBeLessThanOrEqual(1);
    expect(b3!.y, '第二排没有落在第一排之下').toBeGreaterThan(b1!.y);
    // 第二排必须回到左列（x 与第一排左卡对齐）—— 只数"有几排"挡不住"错一列排下去"。
    expect(Math.abs(b3!.x - b1!.x), '第 3 张没有回到左列').toBeLessThanOrEqual(1);
  });

  test('T4 窄容器 ⇒ 塌回一列（x 同 y 异），前提也要现量', async ({ page }) => {
    await openApp(page, APP_ZH);
    await switchView(page, '习惯');
    await addHabit(page, '喝水');
    await addHabit(page, '阅读');
    await page.setViewportSize({ width: 480, height: 900 });
    await expect(cards(page).first()).toBeVisible();

    const side = await boxOf(page, page.locator('.ht-habit__side'), '窄屏清单那一列');
    // 🔴 塌缩那一支的前提同样要现量钉住：容器确实窄到装不下两张 16rem 的卡。
    //    （16rem 不是新造的数 —— 它就是 `.ht-habit` 外层轨道自己写死的那根下限，
    //    本文件里唯一一处"这一列还读得下去"的既有常量。）
    const cardMin = 16 * 16;
    const gap = await pxOfCssVar(page, '--ht-space-2');
    expect(
      side.width,
      `容器有 ${String(Math.round(side.width))}px，本来就该排两列 —— 这一趟量不到塌缩`,
    ).toBeLessThan(2 * cardMin + gap);
    expect(
      await listTrackCount(page),
      '窄容器下清单仍不是单轨道',
    ).toBe(1);

    const [a, b] = await Promise.all([
      boxOf(page, cards(page).nth(0), '第 1 张卡'),
      boxOf(page, cards(page).nth(1), '第 2 张卡'),
    ]);
    expect(Math.abs(a.x - b.x), '塌缩后两张卡左右错开了').toBeLessThanOrEqual(1);
    expect(b.y, '第 2 张没有落在第 1 张下面').toBeGreaterThan(a.y);
    await page.screenshot({ path: SHOT('cards-narrow-one-column') });
  });

  test('T5 卡内三个数字不被裁切，且最右那枚贴着卡片右边界（阈值 = 卡片内边距）', async ({ page }) => {
    await openApp(page, APP_ZH);
    await switchView(page, '习惯');
    await addHabit(page, '喝水');
    await addHabit(page, '这是一条长得会逼省略号出现的习惯名字');

    const padding = await pxOfCssVar(page, '--ht-space-3');
    const n = await cards(page).count();
    for (let i = 0; i < n; i += 1) {
      const card = await boxOf(page, cards(page).nth(i), `第 ${i + 1} 张卡`);
      const nums = page.locator('.ht-habit__list > .ht-habit__item').nth(i)
        .locator('.ht-habit__chip-num');
      await expect(nums, '这一张卡上的数字不是三枚').toHaveCount(3);
      for (let k = 0; k < 3; k += 1) {
        const num = await boxOf(page, nums.nth(k), `第 ${i + 1} 张卡的第 ${k + 1} 枚数字`);
        // 🔴 存在性之外还要量"没被裁掉"：卡片变窄之后数字被挤出右边界，
        //    在 DOM 上一切都在、在截图上少一个数（W5 那一族的反面）。
        expect(
          num.x + num.width,
          `第 ${i + 1} 张卡第 ${k + 1} 枚数字溢出卡片右边界 ${String(
            Math.round(num.x + num.width - card.x - card.width),
          )}px`,
        ).toBeLessThanOrEqual(card.x + card.width + 1);
        expect(num.width, `第 ${i + 1} 张卡第 ${k + 1} 枚数字被压成 0 宽`).toBeGreaterThan(0);
      }
      const last = await boxOf(page, nums.nth(2), '最右那枚数字');
      const slack = card.x + card.width - (last.x + last.width);
      expect(
        slack,
        `最右那枚数字离卡片右边界 ${String(Math.round(slack))}px（内边距只有 ${String(
          Math.round(padding),
        )}px）⇒ 卡片右侧空着一大片`,
      ).toBeLessThanOrEqual(padding + 2);
    }
  });

  test('T6 选中态仍是单源：点第 2 张卡 ⇒ 只有它带痕迹，且面单说的是它', async ({ page }) => {
    const errors = watchErrors(page);
    await openApp(page, APP_ZH);
    await switchView(page, '习惯');
    await addHabit(page, '喝水');
    await addHabit(page, '阅读');

    await page.locator('[data-testid^="habit-row-"]').filter({ hasText: '阅读' }).first().click();
    const marked = page.locator('[data-testid^="habit-row-"][aria-current="true"]');
    await expect(marked, '全列不止一行带选中痕迹 ⇒ 选中态不是单源').toHaveCount(1);
    await expect(marked).toContainText('阅读');
    // 面单跟着换人（与共享选中态同一个值，不是第二份状态）。
    await expect(page.getByTestId('habit-pane')).toHaveAttribute('aria-label', /「阅读」/);

    await page.locator('[data-testid^="habit-row-"]').filter({ hasText: '喝水' }).first().click();
    await expect(marked).toHaveCount(1);
    await expect(marked).toContainText('喝水');
    expect(errors, `控制台报错：${errors.join(' | ')}`).toEqual([]);
  });

  test('T7 暗色：两列照旧成立、零件照旧齐，且选中那张的边框确实是主色', async ({ page }) => {
    await openApp(page, APP_ZH);
    await switchView(page, '习惯');
    await addHabit(page, '喝水');
    await addHabit(page, '阅读');
    await page.getByRole('button', { name: '切换到暗色主题' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.locator('[data-testid^="habit-row-"]').filter({ hasText: '阅读' }).first().click();

    // 暗色不是亮色的反相（AGENTS §5）：这里不只看"画得出来"，还看**选中态那圈边框**
    // 在暗色下确实取到主色 token（回收线实测过"原生控件跟系统强调色走"那一族：
    // 没显式声明的东西都在替用户的系统设置说话）。
    const primary = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--ht-color-primary').trim(),
    );
    expect(primary, '暗色下取不到主色 token').not.toBe('');
    const border = await page
      .locator('[data-testid^="habit-row-"][aria-current="true"]')
      .evaluate((el) => getComputedStyle(el).borderTopColor);
    const toRgb = (s: string) => {
      const hex = s.replace('#', '');
      const v = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
      const n = Number.parseInt(v, 16);
      return `rgb(${String((n >> 16) & 255)}, ${String((n >> 8) & 255)}, ${String(n & 255)})`;
    };
    expect(border, `选中边框是 ${border}，不是主色 ${toRgb(primary)}`).toBe(toRgb(primary));

    // 两列这件事在暗色下必须仍然成立（暗色改的是颜色，不该动排法）。
    const [a, b] = await Promise.all([
      boxOf(page, cards(page).nth(0), '暗色第 1 张卡'),
      boxOf(page, cards(page).nth(1), '暗色第 2 张卡'),
    ]);
    expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1);
    for (const card of await inventory(page)) {
      expect(card.dots, '暗色下某张卡少了点位').toBe(7);
      expect(card.nums, '暗色下某张卡少了数字').toBe(3);
    }
    await page.screenshot({ path: SHOT('cards-2-dark-selected') });
  });
});
