/**
 * W6 · 计数型习惯：「今天记了几格」在真界面上可读、可写、可落盘
 * ==============================================================
 *
 * 工单（`docs/plans/detail-pane-alignment.md` W6）的三条验收在这里逐条对应：
 *
 * | 工单原话 | 这里的那一条 |
 * |---|---|
 * | ① 目标 8 页、今天记 5 页 ⇒ 落盘 `value=5` **且界面显示 5** | T1（显示 5）+ T1 里的**刷新后仍是 5**（落盘） |
 * | ② 不传 value 时逐字保持旧行为 | T2（主打卡按钮记满 8，一个参数都不带的调用形状由 `habits-board.spec.tsx` F8 钉） |
 * | ③ 撤销打卡仍走软删 | T2（从 1 减下去 ⇒ 回到"今天没做"，而不是记一条 0） |
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 为什么 jsdom 那 12 条（F 组）不够
 *
 * `apps/web/tests/habits-board.spec.tsx` 是**直接渲染共享组件**：它证明不了
 * 数值真的穿过 `store.checkIn → op-log → IndexedDB → 重放 → 重新渲染` 这条链。
 * 本文件那条"刷新后仍是 5"量的就是这条链 —— 也是本仓反复出现的那句
 * **"写进内存不算写完"**（Web 清单/标签那批判据同一条）。
 *
 * ⚠️ 数据**全部从界面上真点出来**（新建习惯 → 展开目标编辑器 → 填 8 与「杯」 →
 * 点「至少」提交）。不注入 IndexedDB、不调内部 store：一份靠探针写进去的数据
 * 渲染出的界面，证明不了用户点出来的数据能渲染（与 `habits-pane.spec.ts` 同约定）。
 *
 * 🔴 截图先于断言落盘（AGENTS §6.2 规定一），且**视口加高**：
 * 数量行在卡片中段，默认 720 高的图里容易只拍到半张卡，
 * 而"人看图"要看的正是那一整行（W5 那轮的四行只拍进三行就是这么发现的）。
 */
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { openApp, parkCursor, switchView } from './helpers';

const ADD_PLACEHOLDER = '新习惯，例如「喝水」';
const APP_ZH = '/?lang=zh-CN';
const STAMP = Date.now().toString().slice(-6);

const SHOT = (name: string) =>
  fileURLToPath(
    new URL(`../../apps/web/evidence/habit-counted-amount/${name}.png`, import.meta.url),
  );

test.use({ viewport: { width: 1280, height: 1000 } });

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e)}`));
  return errors;
}

/** 建一条习惯并返回它的 id（id 从行自己的 testID 上取，不抄生成规则）。 */
async function createHabit(page: Page, name: string): Promise<string> {
  const input = page.getByPlaceholder(ADD_PLACEHOLDER);
  await input.fill(name);
  await input.press('Enter');
  const row = page.locator('[data-testid^="habit-row-"]').filter({ hasText: name }).first();
  await expect(row, `新建的习惯没有出现在清单里：${name}`).toBeVisible();
  const testId = await row.getAttribute('data-testid');
  // ⚠️ `replace` 必须给**两个**参数：只给一个会把前缀换成 `"undefined"`，
  // 拼回去的选择器永远找不到元素（本仓在 habits-pane 的暗色用例上真踩过）。
  expect(testId, '习惯行没有 data-testid').not.toBeNull();
  return (testId ?? '').replace('habit-row-', '');
}

/**
 * 把窗格切到**这一条**习惯上。
 *
 * 🔴 不是多余的一步：右窗格在"没有选中项"时兜到 `rows[0]`，而 rows 按创建时间升序
 * ⇒ 兜的往往是**更早那轮留下的另一条习惯**（本套件的 IndexedDB 不是每条用例全新的）。
 * 不点这一下的话，`habit-amount-<id>` 找不到可能只是因为"根本不是它"，
 * 于是那条"默认习惯没有数量行"会是一条**没有正对照的**存在性负判据。
 */
async function selectHabit(page: Page, id: string): Promise<void> {
  await page.locator(`[data-testid="habit-row-${id}"]`).click();
  // 正对照：这条习惯**确实**渲染在窗格里（卡片在、板在）。
  await expect(page.getByTestId(`habit-card-${id}`)).toBeVisible();
}

/**
 * 用**界面自己**的目标编辑器把习惯改成"每天 8 杯"。
 *
 * 🔴 这一步是载体前提：`hasCountableGoal` 为假时数量行根本不渲染，
 * 那时"数量行不存在"与"产品坏了"在断言上长得一模一样。所以这里先验
 * **目标摘要已经变成「至少 8 杯」**（那是目标编辑器自己的 testID 契约），
 * 再去找数量行。
 */
async function setGoalToEightCups(page: Page, id: string): Promise<void> {
  await page.getByTestId(`habit-goal-toggle-${id}`).click();
  const panel = page.getByTestId(`habit-goal-panel-${id}`);
  await expect(panel).toBeVisible();
  await panel.getByTestId(`habit-goal-target-${id}`).fill('8');
  await panel.getByTestId(`habit-goal-unit-${id}`).fill('杯');
  // 三个字段**一次提交**（点口径按钮就是提交，见 HabitGoalEditor 文件头第 2 条）。
  await panel.getByTestId(`habit-goal-type-atLeast-${id}`).click();
  await expect
    .poll(async () => (await page.getByTestId(`habit-goal-summary-${id}`).innerText()).includes('8'), {
      message: '目标没写成 8 —— 载体没成立，后面所有数量行的读数都无效',
    })
    .toBe(true);
}

/** 数量行那句话（`common.habits.amount.today` 的产出）。 */
function amountLine(page: Page, id: string) {
  return page.getByTestId(`habit-amount-${id}`);
}

test('T1 🔴 目标 8、界面点出 5 ⇒ 显示 5/8，且**刷新之后还是 5**（真的落盘）', async ({ page }) => {
  const errors = watchErrors(page);
  await openApp(page, APP_ZH);
  await switchView(page, '习惯');
  const id = await createHabit(page, `计数阅读-${STAMP}`);
  await selectHabit(page, id);

  // 前提：**默认习惯没有数量行**（真浏览器层的"老界面一个节点都不多"）。
  // 上面那一条 `habit-card-<id>` 就是它的正对照 —— 卡片在而数量行不在。
  await expect(amountLine(page, id)).toHaveCount(0);
  await setGoalToEightCups(page, id);

  await expect(amountLine(page, id), '目标改成 8 之后数量行没出现').toBeVisible();
  await expect(amountLine(page, id)).toContainText('今天 0/8 杯');

  // 「+」五下 —— 每下是**一个意图 = 一条 op**，不是攒到最后一次写。
  for (let i = 0; i < 5; i += 1) {
    await page.getByTestId(`habit-amount-plus-${id}`).click();
  }
  await expect
    .poll(() => amountLine(page, id).innerText(), { timeout: 10_000 })
    .toContain('今天 5/8 杯');

  await parkCursor(page);
  await page.screenshot({ path: SHOT('light-five-of-eight') });

  // 🔴 落盘判据：重载。op 若只写在内存，这里会回到 0/8。
  await page.reload();
  await expect(page.locator('input[placeholder^="添加任务"]')).toBeVisible();
  await switchView(page, '习惯');
  await selectHabit(page, id);
  await expect
    .poll(() => amountLine(page, id).innerText(), {
      message: '刷新后不是 5/8 —— 「+」写进了内存而没进 op-log',
    })
    .toContain('今天 5/8 杯');

  expect(errors, `控制台有报错：${errors.join('\n')}`).toEqual([]);
});

test('T2 「−」减到 1 之后再减是**撤销打卡**（回到"今天没做"），不是一条值为 0 的记录', async ({ page }) => {
  const errors = watchErrors(page);
  await openApp(page, APP_ZH);
  await switchView(page, '习惯');
  const id = await createHabit(page, `计数喝水-${STAMP}`);
  await selectHabit(page, id);
  await setGoalToEightCups(page, id);

  await page.getByTestId(`habit-amount-plus-${id}`).click();
  await expect(amountLine(page, id)).toContainText('今天 1/8 杯');
  // 减之前：按钮**没有**被置灰。
  // ⚠️ 判"可点"要用"不是 true"而不是"等于 false"：RNW 在未禁用时**不写这个属性**
  //（实测浏览器里 `aria-disabled` 缺席，而 `toHaveAttribute(…, 'false')` 会一直重试到超时，
  // 症状长得像"按钮坏了"）。置灰那一腿反过来，写的是 `= 'true'`。
  await expect(page.getByTestId(`habit-amount-minus-${id}`)).not.toHaveAttribute(
    'aria-disabled',
    'true',
  );

  await page.getByTestId(`habit-amount-minus-${id}`).click();
  await expect
    .poll(() => amountLine(page, id).innerText(), { timeout: 10_000 })
    .toContain('今天 0/8 杯');
  // 🔴 减到 0 之后按钮**必须置灰**：没有记录就没得减，
  // 而让它去发 `DEL` 会让"点一下"变成两种完全不同的操作。
  await expect(page.getByTestId(`habit-amount-minus-${id}`)).toHaveAttribute('aria-disabled', 'true');

  // 正对照：主打卡按钮仍然记满（一个参数都不带的旧行为）。
  await page.getByTestId(`habit-checkin-${id}`).click();
  await expect
    .poll(() => amountLine(page, id).innerText(), { timeout: 10_000 })
    .toContain('今天 8/8 杯');

  await parkCursor(page);
  await page.screenshot({ path: SHOT('light-after-undo-and-full') });
  expect(errors, `控制台有报错：${errors.join('\n')}`).toEqual([]);
});

test('T3 🔴 暗色主题实际切了看：数量行读得清，且两个步进按钮各有自己的无障碍名', async ({ page }) => {
  const errors = watchErrors(page);
  // 主题必须在导航**之前**种进去（`applyTheme` 在启动时读一次 localStorage）。
  await page.addInitScript(() => {
    window.localStorage.setItem('heyta.theme', 'dark');
  });
  await openApp(page, APP_ZH);
  await switchView(page, '习惯');
  const id = await createHabit(page, `计数冥想-${STAMP}`);
  await selectHabit(page, id);
  await setGoalToEightCups(page, id);
  await page.getByTestId(`habit-amount-plus-${id}`).click();

  // 🔴 正对照：暗色真的生效了，否则这张"暗色图"是亮色的。
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset['theme'] ?? ''), {
      message: '界面没有切到暗色（data-theme != dark）',
    })
    .toBe('dark');

  await parkCursor(page);
  await page.screenshot({ path: SHOT('dark-counted-row') });

  // 文字颜色必须等于暗色下的 `--ht-color-foreground`（不是硬编码的灰）。
  // 🔴 探针指的是**那句文本自己**的 testID，不是整行：整行读到的是继承色，
  // 而暗色下继承下来的恰好也是 foreground —— 那样这条判据恒真。
  const { fg, text } = await page.evaluate((habitId) => {
    const probe = document.createElement('div');
    probe.style.color = 'var(--ht-color-foreground)';
    document.body.append(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    const line = document.querySelector(`[data-testid="habit-amount-text-${habitId}"]`);
    if (!line) throw new Error(`暗色下找不到这条习惯的数量文本：${habitId}`);
    return { fg: resolved, text: getComputedStyle(line).color };
  }, id);
  expect(text, `数量文字色 ${text} != 暗色 foreground ${fg}`).toBe(fg);

  // 两个按钮的无障碍名都带习惯名，且**互不相同**。
  const plus = await page.getByTestId(`habit-amount-plus-${id}`).getAttribute('aria-label');
  const minus = await page.getByTestId(`habit-amount-minus-${id}`).getAttribute('aria-label');
  expect(plus ?? '').toContain(`计数冥想-${STAMP}`);
  expect(minus ?? '').toContain(`计数冥想-${STAMP}`);
  expect(plus).not.toBe(minus);

  expect(errors, `控制台有报错：${errors.join('\n')}`).toEqual([]);
});
