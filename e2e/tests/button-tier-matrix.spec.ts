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

/**
 * 悬停后的读数**必须等过渡跑完**再取。
 *
 * §7 第 609 条：`getComputedStyle` 在过渡中读到的是**起点色**，
 * 直接比终值会造出一枚"永远红"的假缺陷 —— 所以这里 `expect.poll` 到终值，
 * 而不是 hover 完立刻读一次。
 */
async function lookHovered(page: Page, selector: string, want: { bg?: string; fg?: string }): Promise<void> {
  await page.locator(selector).first().hover();
  await expect
    .poll(
      async () => {
        const now = await look(page, selector);
        return JSON.stringify({ bg: want.bg === undefined || now.bg === want.bg, fg: want.fg === undefined || now.fg === want.fg });
      },
      `悬停之后没换到 hover 档（要 ${JSON.stringify(want)}，实际 ${String(JSON.stringify(await look(page, selector)))}）`,
    )
    .toBe('{"bg":true,"fg":true}');
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
      // 悬停档要**在它还在场上的时候**量：这一条后面就切去回收站了，
      // 第一版把四枚悬停全堆到末尾 ⇒ 等 `habits-empty-add` 等到 60s 测试超时（真红因是探针跑错时机）。
      await lookHovered(page, '[data-testid="habits-empty-add"]', {
        bg: await tokenRgb(page, '--ht-color-primary-hover'),
      });

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
      await lookHovered(page, cancel, { bg: await tokenRgb(page, '--ht-color-hover') });
      await lookHovered(page, submit, {
        bg: await tokenRgb(page, '--ht-color-danger-strong'),
        fg: await tokenRgb(page, '--ht-color-on-danger'),
      });
      if (width === 1440) {
        await page.locator(submit).first().hover();
        await page.screenshot({ path: `${EVIDENCE}/confirm-hover-${theme}.png` });
      }
      // 拍完把鼠标挪开，别让悬停态影响后面那一段的截图
      await page.mouse.move(20, 20);

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
      await lookHovered(page, danger, {
        bg: await tokenRgb(page, '--ht-color-danger-subtle'),
        fg: await tokenRgb(page, '--ht-color-danger-strong'),
      });

      /* ⑨ 选中档（`aria-pressed`）：日历页头那枚侧栏开关。
         这一档**只靠颜色表达**（`controls.css` 里 pressed 把字换成 `color.primary`、底仍透明），
         所以它是四档里最容易"看起来没差别"的一格 —— 不量就没人知道它掉了。
         按之前/之后各读一次，比的是"哪一次是 pressed 就哪一次该读到 primary"。 */
      await switchView(page, '日历');
      const sel = '.ht-header__calendar-sidebar-toggle';
      const toggle = page.locator(sel);
      await expect(toggle, '日历页头没有那枚侧栏开关').toHaveCount(1);
      /*
       * 🔴 选中档（`aria-pressed`）两件事一起判：
       *   · **哪一次是 pressed 从界面上读回来**（`aria-pressed`），不靠"我猜点击前是关着的"
       *     —— 第一版就是这么猜的，红在把 idle 当成 pressed（读数：期望 `foreground-muted`
       *     拿到 `rgb(37,99,235)`）；
       *   · 每一档都 `expect.poll` **到过渡终值**再比（§7 第 609 条：过渡中读到的是起点色；
       *     第二版就栽在这里，390 档读到的是 `rgb(67,87,120)` 这种半程值）。
       * 基档 ghost 的字色是 `foreground-muted` 而不是 `foreground`（`controls.css:108-111`），
       * pressed 换成 `color.primary` ⇒ 这一档**只靠颜色表达**，掉了没人看得出来"开着"。
       */
      const ON = await tokenRgb(page, '--ht-color-primary');
      const OFF = await tokenRgb(page, '--ht-color-foreground-muted');
      const readFg = async (): Promise<string> => (await look(page, sel)).fg;
      const was = await toggle.getAttribute('aria-pressed');
      await page.mouse.move(20, 20);
      await expect.poll(readFg, '开关当前这一档读到的字色不对').toBe(was === 'true' ? ON : OFF);
      await toggle.click();
      await expect.poll(async () => await toggle.getAttribute('aria-pressed')).not.toBe(was);
      await page.mouse.move(20, 20);
      await expect
        .poll(readFg, `翻过去之后没换到另一档（pressed 该读到 ${ON}、未 pressed 该读到 ${OFF}）`)
        .toBe(was === 'true' ? OFF : ON);
      if (width === 1440) {
        await page.screenshot({ path: `${EVIDENCE}/pressed-${theme}.png` });
      }
    });
  }
}
