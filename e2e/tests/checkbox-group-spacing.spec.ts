/**
 * 复选/单选**组内**的行距必须落在"控件↔控件"那一格上（真浏览器，零 mock）
 * ============================================================================
 *
 * ## 它补的是哪一格
 *
 * `e2e/tests/auth-form-spacing.spec.ts` 量的是登录面板。这一条量的是任务行尾的标签多选组
 * （一行一枚可勾的复选框）；同族的另一处 `TaskRepeat` 重复方式单选**同法已改**，
 * 但它不进这里的分母 —— 理由与它的读数写在测试体那段注释里，别在这儿复述。
 * 这两处原本的宿主容器都写 `gap: space.1`（4px）—— 而 4px 这一档在本仓的语义是
 * **同一个控件内部**（标签↔输入框↔提示），不是"下一枚控件"。
 *
 * 🔴 这不是我现编的规矩，是**仓内其余同类组自己选的档**：
 *   `.ht-settings__caps` = `space.3`（12px）、`.ht-settings__sub-plans` = `space.2`（8px）。
 *   这两处内联样式的组是全仓仅有的例外。
 *
 * ## 判据
 *
 *  ① 组内相邻两行之间的实测间距 ≥ `space.2`（8px，容差 0.5px）。
 *  ② 分组标题（`<legend>`）与第一行之间 ≥ `space.1`（4px）。
 *     🔴 这一条不是凑数：`legend` 在 flex 容器里**不是 flex item**，容器那个 `gap`
 *     管不到它 —— 不单独给它 `marginBottom`，标题与第一枚复选框实测 **0px**（贴在一起）。
 *     也就是说"把 gap 从 4px 调到 8px"这一步**修不到**这一格，两件事得分别做。
 *  ③ 探针：每一行都必须拿得到矩形；拿不到记为失败而不是跳过（选择器改名会让这条静默退化）。
 *
 * ## 能红性（2026-10-27 实测，不是推断）
 *
 * 修之前跑同一套量法（本文件成型前的探针版）：标签两行 **4px**、`legend → 第一行` **0px**、
 * 重复单选 5 对行距全 **4px**
 * ⇒ ① 与 ② 一起红。把 `gap` 换成 `space.2`、给 `legend` 补 `marginBottom: space.1` 之后：
 * 行距 8px、标题到第一行 4px，全绿。
 *
 * ⚠️ 为什么这一条要真开浏览器而不是读样式表：读代码判这类问题**已经判错过一次**——
 *   同族扫描的第一版把这两处判成"多选组=单一控件内部，4px 合理"，而实测行高 24px、
 *   盒子紧贴墨迹，与用户当面报的「记住密码贴脸」是同一个形状。
 *   `pnpm check:design` 判的是裸值（这里写的都是合规的 `cssVar('space.1')`），看不见用错档。
 *
 * 🔴 截图落固定路径、人必须打开看（§6.2）。
 */
import { existsSync, rmSync } from 'node:fs';
import { expect, test } from '@playwright/test';

import { addTask, openApp, openRowTail, rowFor, switchView } from './helpers.js';

const STAMP = Date.now().toString().slice(-6);
const TITLE = `group-gap-${STAMP}`;
const TAG_A = `group-tag-a-${STAMP}`;
const TAG_B = `group-tag-b-${STAMP}`;
const SIDEBAR = 'aside[aria-label="清单与标签"]';
const SHOT = 'test-results/checkbox-group-spacing.png';

const MIN_ROW_GAP = 8;
const MIN_LEGEND_GAP = 4;
const TOLERANCE = 0.5;

test.beforeAll(() => {
  if (existsSync(SHOT)) rmSync(SHOT);
});

/** 量一个组：返回行距数组与"标题→第一行"的距离（没有 legend 时为 null）。 */
async function measureGroup(group: import('@playwright/test').Locator) {
  const rows = group.locator('label');
  const boxes: { y: number; height: number }[] = [];
  for (let i = 0; i < (await rows.count()); i += 1) {
    const b = await rows.nth(i).boundingBox();
    if (b) boxes.push(b);
  }
  const gaps = boxes.slice(1).map((b, i) => Number((b.y - (boxes[i].y + boxes[i].height)).toFixed(2)));
  const legend = await group.locator('legend').boundingBox();
  return {
    rowCount: boxes.length,
    gaps,
    legendGap: legend && boxes.length ? Number((boxes[0].y - (legend.y + legend.height)).toFixed(2)) : null,
  };
}

test('标签多选组：行距与分组标题到第一行的距离都在合规那一格上', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await openApp(page);
  await addTask(page, TITLE);

  const sidebar = page.locator(SIDEBAR);
  for (const name of [TAG_A, TAG_B]) {
    await sidebar.getByLabel('新建标签').click();
    await sidebar.locator('#ht-category-create-name').fill(name);
    await sidebar.getByRole('button', { name: '创建标签' }).click();
    await expect(sidebar.getByText(name, { exact: true })).toBeVisible();
  }
  await switchView(page, '任务');

  const row = rowFor(page, TITLE);
  await expect(row).toBeVisible();
  await openRowTail(page, row);
  await row.getByTestId('task-organize-summary').click();

  const failures: string[] = [];
  const groups = [
    {
      name: '标签多选组',
      locator: page.locator('fieldset').filter({ hasText: TAG_A }).filter({ hasText: TAG_B }).first(),
      expectRows: 2,
    },
  ];
  /*
    ⚠️ 同族的另一处（`TaskRepeat` 的重复方式单选，6 行）也照同一句改成了 space.2，
    但**没有**进这份判据的分母 —— 不是省事，是它在这一屏里落在一个收起的 `<details>` 后面：
    实测 `fieldset:has(input[type=radio])` 解析得到但 Playwright 判 hidden（`display:none`），
    要为它写一条"必须可见"的断言，就得先把那一层展开，而展开路径归 `task-organize` 那条旅程，
    一把量间距的尺不该背一条导航旅程 —— 它会在"界面没坏、只是没展开"的时候红。
    它的读数是在一次性探针里量到并写进下面那段（修前 5 对全 4px ⇒ 修后全 8px），
    改法与这里同一句（`gap` 换档 + `legend` 的 `marginBottom`）。
  */

  for (const g of groups) {
    await expect(g.locator, `${g.name} 没渲染出来 ⇒ 探针失效，不是"没有缺陷"`).toBeVisible();
    const m = await measureGroup(g.locator);
    console.log(`${g.name}：${String(m.rowCount)} 行，行距 ${m.gaps.join('/')}px，标题→第一行 ${String(m.legendGap)}px`);
    if (m.rowCount < g.expectRows) {
      failures.push(`③ ${g.name} 只量到 ${String(m.rowCount)} 行（预期至少 ${String(g.expectRows)} 行）⇒ 探针失效`);
    }
    for (const [i, gap] of m.gaps.entries()) {
      if (gap < MIN_ROW_GAP - TOLERANCE) {
        failures.push(
          `① ${g.name} 第 ${String(i + 1)} 对行间距实测 ${String(gap)}px < ${String(MIN_ROW_GAP)}px（space.2）` +
            ` ⇒ 一行是一枚独立可勾的控件，却拿到了"控件内部"的 4px 档` +
            `（仓内同类组：.ht-settings__sub-plans=space.2、.ht-settings__caps=space.3）`,
        );
      }
    }
    if (m.legendGap !== null && m.legendGap < MIN_LEGEND_GAP - TOLERANCE) {
      failures.push(
        `② ${g.name} 的 <legend> 到第一行实测 ${String(m.legendGap)}px < ${String(MIN_LEGEND_GAP)}px` +
          ` ⇒ legend 不是 flex item，容器那个 gap 管不到它，要单独给它 marginBottom`,
      );
    }
  }

  await page.screenshot({ path: SHOT });
  expect(failures, failures.join('\n')).toEqual([]);
});
