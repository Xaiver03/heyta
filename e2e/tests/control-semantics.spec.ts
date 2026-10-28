import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  addTask,
  openApp,
  openRowTail,
  switchTheme,
  switchView,
} from './helpers';

/**
 * 控件档位的真实浏览器读数（全局 UX 线 P4 · A2）
 * ==============================================
 *
 * P4 的判据里有两句是**源码尺量不到**的：
 *   · 「配方对不对」在源码两边可以互相抄得整整齐齐，而浏览器算出来的可能是第三个值
 *     （被别的功能 CSS 覆盖、被 `:not()` 的权重翻掉、变量链指到不存在的名字）；
 *   · 「重量有序」是**看起来**的事：确认层里那枚危险按钮必须比「取消」更重，
 *     这件事只有截图与算出来的背景色能证。
 * 所以这里读的每一个期望值都**从 CSS 变量现算**（`tokenRgb`），测试里一个十六进制都不抄 ——
 * 抄进来的色值半年就会变成第三份口径（§5 的那条老账）。
 *
 * 覆盖的四态：静止 / hover / 禁用 / 暗色档（同一枚控件在亮暗两档各读一遍）。
 *
 * 🔴 两条对照臂不是装饰，它们各治一种"假绿"：
 *   · 「两枚背景不相同」—— 如果整个 CSS 没加载，两枚都会是 `rgba(0,0,0,0)`，
 *     逐条比 token 反而全绿；先钉"它们不一样"，才排掉"什么都没画"。
 *   · 「实底那枚不许是透明」—— 透明底的危险按钮在旧形状下是**合规**的（它确实等于
 *     行内档的配方），只有"确认层里那枚必须是实底"这条结果判据能抓住退回去。
 */

const EVIDENCE = '../apps/web/evidence/control-semantics';
const TITLE = '控件档位判据甲';

/**
 * token（CSS 自定义属性名）→ 浏览器**算出来**的值。
 *
 * 🔴 为什么要有这一枚探针而不是直接读 `getPropertyValue('--ht-…')`：
 * 自定义属性的计算值是**代入前**的形状（`--ht-color-danger` 算出来是 `var(--ht-red-600)`），
 * 拿它去和按钮的计算值比会永远不等。所以把它挂到一个真属性上再读那一格的计算值 ——
 * 颜色走 `color`、数字走 `opacity`，属性名由调用方给（同一个原因，`opacity` 探针读不出颜色）。
 */
async function tokenValue(page: Page, varName: string, prop: 'color' | 'opacity'): Promise<string> {
  return page.evaluate(
    ([name, property]) => {
      const probe = document.createElement('span');
      probe.style.setProperty(property, `var(${name})`);
      document.body.append(probe);
      const value = getComputedStyle(probe).getPropertyValue(property);
      probe.remove();
      return value.trim();
    },
    [varName, prop] as const,
  );
}

/** 一枚控件的算出来外观。`disabled` 一起读回来，免得"点不动"这一态没人量过。 */
async function look(loc: Locator): Promise<{ bg: string; fg: string; opacity: string; disabled: boolean }> {
  return loc.evaluate((el) => {
    const cs = getComputedStyle(el as HTMLElement);
    return {
      bg: cs.backgroundColor,
      fg: cs.color,
      opacity: cs.opacity,
      disabled: (el as HTMLButtonElement).disabled,
    };
  });
}

/** 打开回收站里那格「彻底删除」的确认层。 */
async function openPurgeConfirm(page: Page): Promise<{ cancel: Locator; submit: Locator }> {
  await addTask(page, TITLE);
  const row = page.locator('[data-testid^="task-item-"]').filter({ hasText: TITLE });
  await expect(row, `列表里没有刚加的「${TITLE}」`).toBeVisible();
  await openRowTail(page, row);
  await page.getByRole('button', { name: `删除：${TITLE}` }).click();
  await expect(row, '删了一下之后它还留在主列表').toHaveCount(0);
  await switchView(page, '回收站');
  const purge = page.getByRole('button', { name: `彻底删除：${TITLE}` });
  await expect(purge, '回收站里没有那条任务').toBeVisible();
  await purge.click();
  const cancel = page.getByTestId('trash-confirm-cancel');
  const submit = page.getByTestId('trash-confirm-submit');
  await expect(cancel).toBeVisible();
  await expect(submit).toBeVisible();
  return { cancel, submit };
}

test.describe('P4 控件档位：确认层里两枚的重量与逐态读数', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`${theme}：取消走次要档、确认走危险实底档，hover 换到 danger-strong`, async ({ page }) => {
      await openApp(page);
      if (theme === 'dark') await switchTheme(page, 'dark');
      const { cancel, submit } = await openPurgeConfirm(page);

      const sunken = await tokenValue(page, '--ht-color-surface-sunken', 'color');
      const foreground = await tokenValue(page, '--ht-color-foreground', 'color');
      const danger = await tokenValue(page, '--ht-color-danger', 'color');
      const onDanger = await tokenValue(page, '--ht-color-on-danger', 'color');
      const dangerStrong = await tokenValue(page, '--ht-color-danger-strong', 'color');

      const cancelLook = await look(cancel);
      const submitLook = await look(submit);

      expect(cancelLook.bg, '「取消」的填充必须等于次要档 token').toBe(sunken);
      expect(cancelLook.fg, '「取消」的字必须等于 foreground').toBe(foreground);
      expect(submitLook.bg, '确认那枚必须是实底 danger').toBe(danger);
      expect(submitLook.fg, '实底危险按钮上的字必须是 on-danger，不是反色前景').toBe(onDanger);

      // 对照臂一：两枚不许同色（CSS 没加载时两边都是 rgba(0,0,0,0)，逐 token 比会一起绿）。
      expect(cancelLook.bg).not.toBe(submitLook.bg);
      // 对照臂二：实底那枚不许是透明（旧形状"透明底红字"在这条上必须红）。
      expect(submitLook.bg, '确认那枚退化成透明底 ⇒ 危险确认只是两句并排的文字').not.toMatch(
        /rgba\(0, 0, 0, 0\)|transparent/u,
      );

      await submit.hover();
      /**
       * 🔴 这里**不许**在 hover 之后立刻读一次：`background-color` 带
       * `--ht-duration-fast` 的过渡，刚移上去那一次 `getComputedStyle` 拿到的还是**起点色**
       * （实测读回 `rgb(220, 38, 38)` = danger，而终值是 `rgb(185, 28, 28)` = danger-strong），
       * 于是"hover 没换底"这条假红会指回实现。改成轮询到终态：过渡走完就绿，
       * 真的不换底则在超时后红 —— 能红的方向没被削弱。
       */
      await expect
        .poll(async () => (await look(submit)).bg, {
          message: 'hover 必须换到 danger-strong（与表里 hoverBg 同一格）',
          timeout: 2_000,
        })
        .toBe(dangerStrong);

      await page.screenshot({ path: `${EVIDENCE}/purge-confirm-1440-${theme}.png` });

      /*
       * ✅ 禁用档那一格**已经量到了**，就在下面那条独立用例里
       * （`禁用档：浏览器算出来的 opacity 就是 token 那个数`）。
       * 这里曾登记过"两条路径都画不出那枚按钮"（`vault-unlock`/`vault-create` 都要先配好
       * 服务器与库才出现）—— 那句判断本身没错，错的是**只在那一屏找**：
       * 新建习惯那一格"名称为空 ⇒ 提交禁用"是默认态，零前置就读得到。
       * 旧口径不留在这里当警示标签，指向新落点即可。
       */
    });
  }

  test('窄档 390 的确认层：两枚仍读得出主次（截图归人工看）', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openApp(page);
    const { submit } = await openPurgeConfirm(page);
    await expect(submit).toBeVisible();
    await page.screenshot({ path: `${EVIDENCE}/purge-confirm-390-light.png` });
  });

  /*
   * 🔴 上面那格登记为"未判定"的禁用档，这一趟量到了 —— 换的是**落点**，不是断言。
   *
   * 原来试的两条路径（`vault-unlock` / `vault-create`）在未建库/未配服务器时根本不渲染
   * 那枚按钮，所以量不到。新建习惯那一格里"名称为空 ⇒ 提交按钮 disabled"是**默认态**，
   * 不需要任何前置：同一句 `opacity = var(--ht-state-disabled-opacity)` 在这里读得到。
   * 对照臂钉的是"没禁用的那一枚不许也等于那个数"—— 否则这把尺分不清
   * "禁用档读到了 token"与"整屏都被调成了 0.38"。
   */
  test('禁用档：浏览器算出来的 opacity 就是 token 那个数（含未禁用那一枚的对照臂）', async ({ page }) => {
    await openApp(page, '/?lang=zh-CN');
    await switchView(page, '习惯');
    await page.getByTestId('habits-add-open').click();
    const dialog = page.getByTestId('habit-create-dialog');
    await expect(dialog).toBeVisible();
    const disabled = dialog.locator('footer button[type="submit"]');
    await expect(disabled, '名称为空时提交按钮就该是禁用的（这一格是默认态，不需要前置）').toBeDisabled();
    const enabled = dialog.locator('footer button[type="button"]');
    await expect(enabled, '同一排里那枚「取消」不该是禁用的').toBeEnabled();

    const token = await tokenValue(page, '--ht-state-disabled-opacity', 'opacity');
    const off = await look(disabled);
    const on = await look(enabled);
    expect(off.disabled, '读出来的那一枚其实没禁用').toBe(true);
    expect(off.opacity, `禁用档算出来的 opacity 不等于 token（token=${token}）`).toBe(String(Number(token)));
    expect(on.opacity, '对照臂：未禁用的那一枚也读成了禁用值 ⇒ 这把尺分不清两态').toBe('1');
    await page.screenshot({ path: `${EVIDENCE}/disabled-opacity-habit-create.png` });
  });
});
