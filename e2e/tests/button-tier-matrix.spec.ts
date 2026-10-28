import { expect, test, type Page } from '@playwright/test';

import { addTask, openApp, openRowTail, switchTheme, switchView } from './helpers';

/**
 * 四档 × 亮暗 × 宽窄的截图矩阵（全局 UX 线 P8 第 4 档）
 * ======================================================
 *
 * 计划 §P8 把第四档写成"截图矩阵：宽/窄、亮/暗……且人实际查看"。在此之前每一族只有
 * 零散的几张图（1440 亮、390 亮、1280 亮各一张），**没有任何一个地方能一次看全**
 * "同一档按钮在四种组合下长得一样吗"。这一条把那 16 格补齐，并且每格都带算出来的数 ——
 * 图给人看，数给机器判：只有图没有数，退化成"什么都没画"时看不出来；
 * 只有数没有图，判不了"看起来重不重"。
 *
 * 🔴 四个档位全部取自**真界面**，不是把 `class` 摆进页面里拍：
 *   · `primary` —— 习惯空态那枚动作按钮（P7 新加的动作槽）；
 *   · `secondary` / `danger+commit` —— 回收站「彻底删除」的确认层（取消 / 确认）；
 *   · `danger`（行内档）—— 批量条上那枚「删除」（选中一条之后出现）。
 * 摆出来的夹具只会证明 CSS 自己等于自己，证明不了"这一档真的用在了这个位置"。
 *
 * 期望值一律由**页面自己算**（`tokenRgb` 那枚探针，理由见 `control-semantics.spec.ts`：
 * 自定义属性的计算值是代入前的 `var(...)`，必须挂到真属性上才读得到终值）。
 */

const EVIDENCE = '../apps/web/evidence/button-tier-matrix';
const TITLE = '档位矩阵取证';

async function tokenRgb(page: Page, varName: string): Promise<string> {
  return page.evaluate(([name]) => {
    const probe = document.createElement('span');
    probe.style.setProperty('color', `var(${name})`);
    document.body.append(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  }, [varName]);
}

async function look(page: Page, selector: string): Promise<{ bg: string; fg: string; opaque: boolean }> {
  return page.locator(selector).first().evaluate((el) => {
    const cs = getComputedStyle(el as HTMLElement);
    return { bg: cs.backgroundColor, fg: cs.color, opaque: !/rgba\(.*\s0\)$|^transparent$/u.test(cs.backgroundColor) };
  });
}

/** 走到"回收站里那条的彻底删除确认层"，返回两枚按钮的选择器。 */
async function openPurgeConfirm(page: Page): Promise<{ cancel: string; submit: string }> {
  // 上一档停在习惯视图，添加任务的输入框只长在任务视图里
  await switchView(page, '任务');
  await addTask(page, TITLE);
  const row = page.locator('[data-testid^="task-item-"]').filter({ hasText: TITLE });
  await expect(row, `列表里没有刚加的「${TITLE}」`).toBeVisible();
  await openRowTail(page, row);
  await page.getByRole('button', { name: `删除：${TITLE}` }).click();
  await expect(row, '删了一下之后它还留在主列表').toHaveCount(0);
  await switchView(page, '回收站');
  await page.getByRole('button', { name: `彻底删除：${TITLE}` }).click();
  await expect(page.getByTestId('trash-confirm-cancel')).toBeVisible();
  await expect(page.getByTestId('trash-confirm-submit')).toBeVisible();
  return { cancel: '[data-testid="trash-confirm-cancel"]', submit: '[data-testid="trash-confirm-submit"]' };
}

/** 选中一条 ⇒ 批量条出现，那枚「删除」是危险行的行内档。 */
async function openBulkBar(page: Page): Promise<string> {
  await switchView(page, '任务');
  await page.getByRole('button', { name: '选择任务' }).click();
  await page.locator('[data-testid^="bulk-select-"]').first().click();
  await expect(page.getByTestId('bulk-toolbar'), '选中一条之后批量条没出现').toBeVisible();
  return '[data-testid="bulk-toolbar"] button.ht-btn--danger';
}

for (const theme of ['light', 'dark'] as const) {
  for (const width of [1440, 390] as const) {
    test(`${theme} · ${width}：四档各自等于表里那一格，且确认层那枚比行内那枚重`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openApp(page, '/?lang=zh-CN');
      if (theme === 'dark') await switchTheme(page, 'dark');

      // ① primary：习惯空态的动作按钮
      await switchView(page, '习惯');
      const primary = page.getByTestId('habits-empty-add');
      await expect(primary, '习惯空态那枚动作按钮没出现（矩阵少一档，别读成"这档没变化"）').toBeVisible();
      await page.screenshot({ path: `${EVIDENCE}/primary-${theme}-${width}.png` });
      const p = await look(page, '[data-testid="habits-empty-add"]');
      expect(p.bg, 'primary 的底不是 primary token').toBe(await tokenRgb(page, '--ht-color-primary'));
      expect(p.fg, 'primary 的字不是 on-primary').toBe(await tokenRgb(page, '--ht-color-on-primary'));
      expect(p.opaque, 'primary 画成了透明底').toBe(true);

      // ②③ secondary 与 danger+commit：同一层里两枚，重量必须分得出
      const { cancel, submit } = await openPurgeConfirm(page);
      await page.screenshot({ path: `${EVIDENCE}/confirm-${theme}-${width}.png` });
      const s = await look(page, cancel);
      const c = await look(page, submit);
      expect(s.bg, '次要档的底不是 surface-sunken').toBe(await tokenRgb(page, '--ht-color-surface-sunken'));
      expect(s.fg, '次要档的字不是 foreground').toBe(await tokenRgb(page, '--ht-color-foreground'));
      expect(c.bg, '确认层那枚危险按钮的底不是 danger').toBe(await tokenRgb(page, '--ht-color-danger'));
      expect(c.fg, '确认层那枚危险按钮的字不是 on-danger').toBe(await tokenRgb(page, '--ht-color-on-danger'));
      expect(c.opaque, '确认层那枚退回了透明底 —— 它在确认层里必须是实底').toBe(true);
      expect(s.bg, '取消与确认同底 ⇒ 重量档没分出两档').not.toBe(c.bg);

      // 关掉确认层再走批量那一段（刚那条已经进了回收站，批量条要的是**列表里**的任务）
      await page.getByTestId('trash-confirm-cancel').click();
      await switchView(page, '任务');
      await addTask(page, `${TITLE}乙`);

      // ④ danger 行内档：批量条上那枚
      const danger = await openBulkBar(page);
      await page.screenshot({ path: `${EVIDENCE}/danger-inline-${theme}-${width}.png` });
      const d = await look(page, danger);
      expect(d.bg, '行内档画成了实底（它就该是透明底红字）').toBe('rgba(0, 0, 0, 0)');
      expect(d.fg, '行内档的字不是 danger').toBe(await tokenRgb(page, '--ht-color-danger'));
      expect(d.bg, '行内档与确认层那枚同形 ⇒ 位置没参与判断').not.toBe(c.bg);
    });
  }
}
