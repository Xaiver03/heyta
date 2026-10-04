import { expect, test } from '@playwright/test';

import { openApp } from './helpers';

/**
 * 清单「移入文件夹」选择器：两端共用那份共享组件在**真浏览器里**的取证
 * ================================================================
 *
 * 为什么要这一条（§6.2 规定一）：`setParent` 的写侧、领域层守卫、`FolderPicker`
 * 共享组件、两端接线与中英词条都已经在 `main` 里，但**没有任何一层给过界面证据**：
 * `grep -rln 'folder' e2e/tests` 是 0 个文件，而 jsdom 那几份
 * （`packages/ui/tests/list-parent-wiring.spec.ts`）断的是**源码文本里有没有那句调用**，
 * 不是"点开菜单画出来的是什么"。
 *
 * 断言的写法刻意走**存在性**而不是给"我以为会有的那几行"逐个写内容判据
 * （那条教训来自 W5：15 条断言全绿的截图里，逾期卡少了一整行日期）：
 *
 *   ① 每一行清单都必须有一个「移入文件夹」入口（数量 == 行数）；
 *   ② 移进去**之后刷新页面**，那条关系还在，且菜单里"当前所在"那一项被禁；
 *   ③ 反向那一腿不是"点了报错"，而是**非法目标根本不给点**（候选集由领域层筛）：
 *      父清单的菜单里不许出现自己的子清单 ⇒ 那一项必须**不在 DOM 里**。
 *
 * ③ 这一条同时钉住组件的文件头承诺：「候选集由宿主传进来，组件自己不算」——
 * 如果组件自己筛一遍，就会有两套裁决标准，本仓为这件事付过三次学费。
 *
 * ⚠️ 没覆盖的（不在这里假装全了）：`点了当前父不产生第二条 UPD` 那条守卫只在
 *    组件的 disabled 上，界面侧无法数 op-log ⇒ 由 `apps/web/tests/*` 与 reducer 层钉。
 */

const UNIQUE = `文件夹判据-${Date.now().toString(36).slice(-5)}`;

async function addList(page: import('@playwright/test').Page, name: string): Promise<void> {
  // 🔴 「新建清单」那颗按钮是**开关**（`setAddingProject(!addingProject)`），而建完表单
  //    **不收起**（连建几条是常态）⇒ 第二次无脑点它会**把表单关掉**。这条不是猜的：
  //    读的是 HEAD 里 ProjectsPanel.tsx:222-232 那个 onClick。
  //    所以只在 `aria-expanded` 不为 true 时才点。
  const addBtn = page.locator('[aria-label="新建清单"]');
  if ((await addBtn.getAttribute('aria-expanded')) !== 'true') await addBtn.click();
  const input = page.locator('input[aria-label="新清单名称"]');
  await expect(input).toBeVisible();
  await input.fill(name);
  await input.press('Enter');
  await expect(page.locator(`[data-testid="projects-list"] >> text=${name}`)).toBeVisible();
}

/**
 * 从触发按钮**同时**读出 id 与它属于哪条清单。
 *
 * 🔴 为什么不按"建序 = DOM 序"取 `ids[0]` / `ids[1]`（这条草稿最初那么写）：
 *   `OrganizerList` 渲染的是**树**（`items={tree}`，子清单嵌在父行里面，见 `:663/:690`），
 *   一旦第一次移动成功，后面的读数就不再等于建序 —— 那种写法会把"父子搞反"读成"判据失败"。
 *   名字住在 `aria-label` 里：`labels.button(name)` = `把「<name>」移入文件夹`，
 *   所以 id↔名字是**界面上真有的两个属性**，不需要我猜顺序。
 */
async function folderRows(page: import('@playwright/test').Page): Promise<Array<{ id: string; name: string }>> {
  return page
    .locator('[data-testid^="web-list-folder-"][data-testid$="-trigger"]')
    .evaluateAll((els) =>
      els.map((e) => ({
        id: (e.getAttribute('data-testid') ?? '').replace(/^web-list-folder-/, '').replace(/-trigger$/, ''),
        name: e.getAttribute('aria-label') ?? '',
      })),
    );
}

async function idOf(page: import('@playwright/test').Page, name: string): Promise<string> {
  const hit = (await folderRows(page)).filter((r) => r.name.includes(name));
  expect(hit.length, `名为「${name}」的那一行必须恰好有一个「移入文件夹」入口`).toBe(1);
  return hit[0].id;
}

/**
 * 🔴 滚进视口 + 截图，全部走**新鲜定位器**并在 detach 时重试（10-04 修）。
 *
 * 为什么需要它：移动/展开这类动作之后 op 异步落地、`OrganizerList` 按树重排
 * 会**换掉整行节点** —— 旧定位器解析到的元素在 `scrollIntoViewIfNeeded()`
 * 执行瞬间 detach，而 Playwright 对这个动作不自动重试（实测全套件里
 * 两次确定性红都是这个形状）。重试用 `data-testid` 重新解析，重排完成后
 * 节点稳定，最多一两趟就过；判据（可见性/计数）不变。
 */
async function scrollFreshAndShoot(
  page: import('@playwright/test').Page,
  testId: string,
  shotName: string,
  attempts = 3,
): Promise<void> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const loc = page.getByTestId(testId);
      await loc.waitFor({ state: 'visible', timeout: 5_000 });
      await loc.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `test-results/${shotName}` });
      return;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

test('清单移入文件夹：入口常驻、跨刷新还在、非法目标不给点', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });

  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));

  const parentName = `${UNIQUE}父`;
  const childName = `${UNIQUE}子`;

  await openApp(page);
  await addList(page, parentName);
  await addList(page, childName);

  // 🔴 先截图，再断言（失败时也要有图，§6.2 规定一第 1 条）。
  await page.screenshot({ path: 'test-results/list-folder-1-two-lists.png', fullPage: false });

  const rows = await folderRows(page);
  expect(rows.length, '两条清单必须各有且只有一个「移入文件夹」入口').toBe(2);
  const parentId = await idOf(page, parentName);
  const childId = await idOf(page, childName);

  // ② 把第二条移进第一条。
  await page.getByTestId(`web-list-folder-${childId}-trigger`).click();
  const menu = page.getByTestId(`web-list-folder-${childId}-menu`);
  await expect(menu, '展开的菜单必须真的出现在 DOM 里（不是 CSS 隐藏）').toBeVisible();
  // 🔴 必须先滚进视口再截图：这条入口挂在侧栏**清单行的末尾**，行内展开的菜单落在折线以下 ——
  //    03:33 那一趟的 `list-folder-2-menu-open.png` 就是这个形状：断言全过（DOM 里确实有），
  //    而 viewport 截图只拍到菜单边框的一小条，人看不出任何事（§6.2 规定一要的是"人看过"，
  //    不是"截了"）。`fullPage: true` 也不行 —— 侧栏是滚动容器，整页截图拍不进它内部。
  await scrollFreshAndShoot(page, `web-list-folder-${childId}-menu`, 'list-folder-2-menu-open.png');
  await expect(
    menu.getByText('移入文件夹', { exact: true }),
    '菜单标题必须用共享词条，不是宿主自己拼的串',
  ).toBeVisible();
  await page.getByTestId(`web-list-folder-${childId}-to-${parentId}`).click();

  // 菜单选定后收起：展开内容**只在 open 时进 DOM**，所以判据是"整个菜单消失"。
  await expect(page.getByTestId(`web-list-folder-${childId}-menu`)).toHaveCount(0);
  // 这张图要证的是「子行现在缩进在父行下面」，而那一行在清单末尾 —— 同上，不滚进视口就拍不到它。
  // 🔴 移动点击之后 op 异步落地、`OrganizerList` 按树重排会**换掉子行节点**：旧定位器在
  //    滚动瞬间 detach（`scrollIntoViewIfNeeded` 不对 detached 自动重试）。必须用新鲜
  //    定位器重试这一对动作 —— 实测 10-04 全套件里两次确定性红都在这一步。
  await scrollFreshAndShoot(page, `web-list-folder-${childId}-trigger`, 'list-folder-3-after-move.png');

  // 🔴 刷新后仍在（这条是"真的写进 op-log 并物化了"的判据，不是本地态）。
  await page.reload();
  await expect(page.locator('[data-testid="projects-list"]')).toBeVisible();
  const afterReload = await folderRows(page);
  expect(afterReload.length, '刷新后两行都还在，且入口仍各有其一（子行也走同一个 renderItemExtra 插槽）').toBe(2);

  const childMenuAfter = page.getByTestId(`web-list-folder-${childId}-menu`);
  await page.getByTestId(`web-list-folder-${childId}-trigger`).click();
  await expect(childMenuAfter).toBeVisible();
  const currentRow = page.getByTestId(`web-list-folder-${childId}-to-${parentId}`);
  await expect(currentRow, '刷新后那一行仍在（父级关系进了 op-log，不是本地态）').toBeVisible();
  await childMenuAfter.scrollIntoViewIfNeeded();   // 同上：不滚进视口，这张图拍不到菜单
  await expect(currentRow).toHaveAttribute('aria-disabled', 'true');
  // 组件画的是 `<Text>{candidate.name} {labels.current}</Text>`（两个子节点，中间一个空格），
  // 所以这里断**整行的文本包含**，而不是 `getByText('（当前位置）')` —— 后者在 RN-web 的
  // 嵌套 span 下可能命中多层，撞 strict-mode 后读起来像"界面坏了"。
  await expect(currentRow, '那一行必须标成当前位置').toContainText('（当前位置）');
  await page.screenshot({ path: 'test-results/list-folder-4-current-after-reload.png' });
  await page.getByTestId(`web-list-folder-${childId}-trigger`).click();

  // ③ 反向那一腿：父清单的菜单里**不许出现自己的子清单**（领域层把目标筛掉了）。
  await page.getByTestId(`web-list-folder-${parentId}-trigger`).click();
  await expect(page.getByTestId(`web-list-folder-${parentId}-menu`)).toBeVisible();
  await page.getByTestId(`web-list-folder-${parentId}-menu`).scrollIntoViewIfNeeded();
  await expect(
    page.getByTestId(`web-list-folder-${parentId}-to-${childId}`),
    '父清单不许被移进自己的子清单（cycle / has_children）：非法目标必须根本不给点，' +
      '而不是给点了再报错 —— 组件不许自己再筛一遍候选集',
  ).toHaveCount(0);
  // 阳性对照：同一张菜单里「不放进文件夹」那一项在（否则上一条 0 是因为菜单整块没渲染）。
  await expect(page.getByTestId(`web-list-folder-${parentId}-none`)).toBeVisible();
  await page.screenshot({ path: 'test-results/list-folder-5-parent-menu.png' });

  expect(consoleErrors, `控制台不应有错误：\n${consoleErrors.join('\n')}`).toEqual([]);
});
