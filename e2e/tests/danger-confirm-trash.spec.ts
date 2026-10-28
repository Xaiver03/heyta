import { expect, test, type Page } from '@playwright/test';
import { addTask, openApp, openRowTail, switchTheme, switchView } from './helpers';

/**
 * 危险确认的语义（全局 UX 整改 P2 · 第一格：回收站「彻底删除」）
 * =============================================================
 *
 * 判据的正文在 `docs/agents/overlay-feedback.md` 与本计划 §P2；表在代码里的唯一实现是
 * `packages/ui/src/overlay/dismissal.ts` 的 `danger-confirm` 那一行 +
 * `packages/domain/src/danger-tier.ts` 的 `resolveDangerTier` / `requiresModalCommitment`。
 * 本用例证的是**那一格界面真的按它们接了线**，不是表写得对不对（那由
 * `packages/domain/tests/danger-tier.spec.ts` 钉）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 这一格在写本用例之前**没有任何真实浏览器覆盖**
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `grep -rn trash-confirm e2e/tests` 现量为 0 命中；`rail-trash-anchor.spec.ts` 只钉
 * 左下角那枚 tab 的几何。所以下面每一条都是**第一次**真点这层浮层，
 * 而前 6 条里有几条在写下时是预期**红**的（红在实现，不红在探针）——
 * 每条都写了它红的是哪一格，避免下一次有人把"红"读成"用例写错了"。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 正/负成对（同 `overlay-modal-contract.spec.tsx` 的纪律）
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 「点了没生效」单独写会空转：如果那一下**根本没送达**，`not.toBeVisible()` 照样绿。
 * 所以每条"不许发生"的断言都配一条同通道的"会发生"作对照臂：
 * · 点背景不删（N）＋ 点「取消」会关（P）—— 两条都走这层的鼠标通道；
 * · 主按钮不会误触（N）＋ 真点它才会删（P）—— 两条都走 `trash-confirm-submit`。
 */

const TITLE = '危险确认判据甲';
const EVIDENCE_DIR = '../apps/web/evidence/danger-confirm';

const rowOf = (page: Page, title: string) =>
  page.locator('[data-testid^="task-item-"]').filter({ hasText: title });

/**
 * 把一条任务删进回收站，再打开它那一格的「彻底删除」确认框。
 *
 * ⚠️ `theme` 走的是设置里那枚**真开关**（`switchTheme`，它自己断言 `html[data-theme]`）。
 * 第一版在这里写的是 `documentElement.classList.add('dark')` —— 那一枚不是本仓的暗色开关，
 * 于是产出的文件叫 `purge-confirm-1440-dark.png` 而**画面是亮色的**：一张贴错标签的证据，
 * 比没有证据更坏（看图的人会以为暗色量过了）。注释里还写着"走真开关"，与实际相反。
 */
async function openPurgeConfirm(page: Page, theme?: 'dark'): Promise<void> {
  await openApp(page);
  if (theme !== undefined) await switchTheme(page, theme);
  await addTask(page, TITLE);
  const row = rowOf(page, TITLE);
  await expect(row, `列表里没有刚加的「${TITLE}」—— 外壳或 addTask 没生效，后面读数全废`).toBeVisible();
  await openRowTail(page, row);
  await page.getByRole('button', { name: `删除：${TITLE}` }).click();
  await expect(row, '删了一下之后它还留在主列表 ⇒ 那一格不是"进回收站"').toHaveCount(0);

  await switchView(page, '回收站');
  const purge = page.getByRole('button', { name: `彻底删除：${TITLE}` });
  await expect(purge, '回收站里没有那条任务，或"彻底删除"那颗没画出来').toBeVisible();
  await purge.click();
  await expect(page.getByTestId('trash-confirm'), '确认框没出现').toBeVisible();
}

test.describe('危险确认：回收站彻底删除', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test.beforeEach(async ({ context, page }) => {
    // 不抢前台（AGENTS §6.2）。
    await context.addInitScript(() => {
      Object.defineProperty(window.document, 'visibilityState', { get: () => 'visible' });
    });
    await page.emulateMedia({ colorScheme: 'light' });
  });

  test('对照臂 P：点「取消」会关掉这层（证明鼠标通道送达了）', async ({ page }) => {
    await openPurgeConfirm(page);
    await page.getByTestId('trash-confirm-cancel').click();
    await expect(page.getByTestId('trash-confirm')).toHaveCount(0);
    // 取消之后那条仍在回收站里 —— "关掉"不等于"删掉"。
    await expect(page.getByRole('button', { name: `彻底删除：${TITLE}` })).toBeVisible();
  });

  test('N1 点背景既不删也不关：危险确认不响应 scrim', async ({ page }) => {
    await openPurgeConfirm(page);
    // 打在最外层遮罩的左上角，离对话框本体足够远。
    await page.locator('.ht-trash__overlay').click({ position: { x: 6, y: 6 } });
    await expect(page.getByTestId('trash-confirm'), '点背景把危险确认关掉了（scrim 必须是 deny）').toBeVisible();
    await expect(page.getByRole('button', { name: `彻底删除：${TITLE}` })).toBeVisible();
  });

  test('N2 Esc 等价于「取消」这一侧，绝不执行删除', async ({ page }) => {
    await openPurgeConfirm(page);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('trash-confirm')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: `彻底删除：${TITLE}` }),
      'Esc 把那条删掉了 —— Esc 必须落在安全的那一侧',
    ).toBeVisible();
  });

  test('N3 危险确认不给 × 出口，且一个目的地只许一个控件', async ({ page }) => {
    await openPurgeConfirm(page);
    const dialog = page.getByTestId('trash-confirm');
    // `danger-confirm` 在策略表里是 `explicitCloseButton: false`：出口必须是**具名动作**，
    // 因为 × 的无障碍名与「取消」撞成同一个词时，屏幕上就有两枚"看起来是取消"的控件，
    // 而其中一枚是纯图标 —— 读屏用户无法从名字分辨自己按的是哪一枚。
    await expect(
      dialog.getByRole('button', { name: '取消' }),
      '危险确认里有 × 与「取消」两枚同名的出口（explicitCloseButton 必须为 false）',
    ).toHaveCount(1);
  });

  test('N4 不可逆主按钮必须是 danger tone，不是 primary', async ({ page }) => {
    await openPurgeConfirm(page);
    const submit = page.getByTestId('trash-confirm-submit');
    const reading = await submit.evaluate((el) => {
      const style = getComputedStyle(el as HTMLElement);
      return { color: style.color, background: style.backgroundColor, className: el.className };
    });
    /**
     * 🔴 比的是**两个计算值**，不是"类名里有没有 danger"这一半，也不是"颜色不等于
     * `--ht-color-primary` 那串十六进制"那一半 —— 后者是枚恒真的断言：计算值永远是
     * `rgb(...)`，token 原文永远是 `#xxxxxx`，两个字符串一辈子不相等，
     * 于是"改回 primary"照样读绿（AGENTS §6 第 2 条：不能失败的判据没有价值）。
     * 正确做法是在同一棵树里立两枚参考元素，把 token 各自解析成 `rgb()` 再比。
     */
    const resolved = await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.style.position = 'absolute';
      probe.style.opacity = '0';
      document.body.append(probe);
      const read = (css: string) => {
        probe.style.color = css;
        return getComputedStyle(probe).color;
      };
      const out = {
        danger: read('var(--ht-color-danger)'),
        primary: read('var(--ht-color-primary)'),
        onDanger: read('var(--ht-color-on-danger)'),
      };
      probe.remove();
      return out;
    });
    expect(resolved.danger, '--ht-color-danger 解析不出来，这条断言没东西可比').not.toBe('');
    expect(
      resolved.danger,
      'danger 与 primary 解析成同一个颜色 ⇒ 这一比没有分辨力，先修 token 再谈档位'
    ).not.toBe(resolved.primary);
    expect(
      reading.className,
      `主按钮的类不是 danger 变体：${reading.className}`,
    ).toContain('ht-btn--danger');
    /*
     * 🔴 2026-10-28（P4·A2）这一条的**期望值换过**，理由要留在这里：
     * 原来它钉的是"主按钮的字色 = `--ht-color-danger`"，那等于把"危险档"与
     * "透明底红字"当成同一件事 —— 而 A2 把危险档分成两档之后，
     * **确认层里那枚唯一要按下去的按钮是实底档**（底 = danger、字 = on-danger），
     * 列表行里那些才是透明底红字。这一格站在确认层，所以它现在钉实底那一档。
     *
     * ⚠️ 两向都还要有分辨力：底不许是 primary、字不许是 primary 的字，
     *    所以"改回 primary"照样会红在这里（不是被放宽成"只要带 danger 类就行"）。
     */
    expect(
      reading.background,
      `确认层里那枚主按钮必须是实底 danger（${resolved.danger}）：实际底 ${reading.background}`,
    ).toBe(resolved.danger);
    expect(
      reading.color,
      `实底危险按钮上的字必须是 on-danger（${resolved.onDanger}），不是反色前景那一格：实际 ${reading.color}`,
    ).toBe(resolved.onDanger);
    expect(reading.background, '主按钮的底色解析成了 primary ⇒ 这一比没有分辨力').not.toBe(resolved.primary);
  });

  test('N5 初始焦点落在安全动作上，不在对话框容器上', async ({ page }) => {
    await openPurgeConfirm(page);
    const focusedTestId = await page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? 'none');
    // 现在红的是这一条：`TrashView` 打开时 focus 的是 `dialogRef`（容器，tabIndex=-1）。
    // 判据要的是**安全侧**拿到初始焦点 —— 键盘用户回车的第一下应当是"不删"。
    expect(
      ['trash-confirm-cancel', 'trash-confirm-submit'],
      '初始焦点既不在取消也不在删除上 ⇒ 它在容器上，回车落在谁身上由 Tab 次数决定',
    ).toContain(focusedTestId);
    expect(focusedTestId, '危险确认的初始焦点必须在「取消」（安全侧），不能在删除上').toBe('trash-confirm-cancel');
  });

  test('N6 焦点不许从这层逃出去（Tab 一整圈仍在对话框内）', async ({ page }) => {
    await openPurgeConfirm(page);
    const dialog = page.getByTestId('trash-confirm');
    // 文件头那句注释写着"自绘 dialog + 焦点陷阱"，而这一族里既没有 Tab 处理也没有
    // `aria-hidden`/inert —— 注释不是判据（AGENTS §6 第 2 条）。走 12 次 Tab 够穿过
    // 它后面那一整页的列表，一旦跑出来说明那句话是假的。
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press('Tab');
      const inside = await page.evaluate(() => {
        const el = document.activeElement;
        const box = document.querySelector('[data-testid="trash-confirm"]');
        return Boolean(el && box && box.contains(el));
      });
      expect(inside, `第 ${i + 1} 次 Tab 之后焦点跑出了危险确认层`).toBe(true);
    }
    await expect(dialog).toBeVisible();
  });

  test('N7 关掉之后焦点回到触发它的那颗按钮，而不是掉进 body', async ({ page }) => {
    await openPurgeConfirm(page);
    await page.getByTestId('trash-confirm-cancel').click();
    await expect(page.getByTestId('trash-confirm')).toHaveCount(0);
    const name = await page.evaluate(
      () => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName ?? 'none',
    );
    // 触发者就是回收站那一行的「彻底删除：…」；层卸载后焦点若落在 body，
    // 键盘用户的下一次 Tab 会从页面**开头**重新走起。
    expect(
      name,
      `关闭后焦点没归还给触发它的那颗按钮（当前 activeElement：${name}）`,
    ).toBe(`彻底删除：${TITLE}`);
  });

  test('P2 真点「彻底删除」才会删：对照臂，证明上面那些"不会删"不是空转', async ({ page }) => {
    await openPurgeConfirm(page);
    await page.getByTestId('trash-confirm-submit').click();
    await expect(page.getByTestId('trash-confirm')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: `彻底删除：${TITLE}` }),
      '真点了危险主按钮，那条却还留在回收站',
    ).toHaveCount(0);
  });

});

/**
 * 第四档验收：截图矩阵（AGENTS §6.2 要求**人实际看过**，不是"跑出来了"）。
 *
 * 上面 N4 断言的是计算色 —— 它能证明"不是 primary"，证明不了"这一屏看着就是危险"。
 * 对比度、图标与文字的层级、暗色下 danger 会不会糊成一片，只有眼睛判得了。
 */
for (const theme of ['light', 'dark'] as const) {
  for (const size of [
    { label: '1440', width: 1440, height: 900 },
    { label: '375', width: 375, height: 844 },
  ]) {
    test(`证据：${size.label} ${theme} 的危险确认`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await openPurgeConfirm(page, theme === 'dark' ? 'dark' : undefined);
      // 证据文件的**名字**与画面必须一致：这一句红，就说明文件名在说谎。
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await page.waitForTimeout(120);
      await page.screenshot({ path: `${EVIDENCE_DIR}/purge-confirm-${size.label}-${theme}.png` });
    });
  }
}
