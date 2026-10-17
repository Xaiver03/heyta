import { expect, type Page } from '@playwright/test';

/**
 * 露出一行任务的**行内动作**（AI 拆解 / 耗时估计就住在那一行的「更多」披露里）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 为什么写成"有披露就打开、没有就原样返回"（2026-10-17 两头实测）
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 行内动作当前在**工作树里**被收进了每行那枚 `details.ht-compose-actions` 的
 * 「更多」披露里，而 **HEAD 上这套披露根本不存在**
 * （现量：`git show HEAD:apps/web/src/App.tsx | grep -c ht-compose-actions` = **0**）——
 * 那笔 IA 改动尚未入库。于是同一份规格在两棵树上一个"点得到"、一个"点不到"，
 * 而失败形状是 `element is not visible`（元素**在 DOM 里**、只是被折叠的
 * `details` 挡着）—— 读起来像产品坏了，其实只是入口深了一层。
 *
 * ⇒ 判据不该钉"入口在第几层 DOM"，只该问"这一行的动作**露出来了吗**"。
 * 两种形态都能跑；真点不到时**仍然会红**（本函数不吞错，调用点的断言也没有放宽）。
 *
 * ⚠️ 它不是 `.spec.ts`，所以不被 Playwright 当用例收集（`testMatch` 只认 `*.spec.ts`）。
 */
export async function revealRowActions(page: Page, title: string): Promise<void> {
  // 🔴 `:visible` 不能省：同一份行标记在**详情列/隐藏分支**里也可能有一份（实测：
  //    不带它时 `.first()` 选中了不可见的那一份，于是展开的是它，而真正要点的
  //    `task-organize-summary` 还是折叠的 —— 症状是"点了没反应"，接着
  //    `locator.click: element is not visible` 一路重试到超时）。
  const item = page
    .locator('[data-testid^="task-item-"]:visible')
    .filter({ hasText: title })
    .first();
  await expect(item, `找不到「${title}」那一行`).toBeAttached();

  const disclosure = item.locator('details.ht-compose-actions').first();
  if ((await disclosure.count()) === 0) return; // HEAD 形态：动作直接挂在行上
  if ((await disclosure.getAttribute('open')) !== null) return; // 已经开着，别点第二下把它收起
  // 🔴 只能点**它自己的** summary：面板里还嵌着别的 `<details>`（备注 / 高级 / 重复 / 截止…），
  //    裸 `locator('summary')` 会一次匹配到 8 个（strict mode violation —— 本轮实测的形状）。
  await disclosure.locator('> summary').click();
  await expect(disclosure, '「更多」披露必须真的打开（否则入口仍然是折叠的）').toHaveAttribute(
    'open',
    '',
  );
}


/**
 * 同一个「更多」披露，但**按里面的可访问名**定位那一行。
 *
 * 🔴 为什么需要第二个入口：按 `hasText` 找行在有些用例里**不安全** ——
 * 窄档行尾那颗 `<select>` 会把**别的任务的标题**写进 `option`，
 * 于是"含某个标题的行"会同时命中两行（`selection-projections.spec.ts` 文件头第 1 条、
 * `detail-pane-task.spec.ts` T9 的注释都记着这件事）。
 * 可访问名（`aria-label`）是界面自己声明的、只有那一行会带 ⇒ 用 `:has([aria-label=…])`
 * 反查"包含它的那一枚 `details.ht-compose-actions`"，再点它**自己的** summary。
 */
export async function revealRowActionsBy(page: Page, innerAriaLabel: string): Promise<void> {
  const disclosure = page
    .locator(`details.ht-compose-actions:has([aria-label="${innerAriaLabel}"])`)
    .first();
  if ((await disclosure.count()) === 0) return; // HEAD 形态：没有披露这层
  if ((await disclosure.getAttribute('open')) !== null) return;
  await disclosure.locator('> summary').click();
  await expect(disclosure, '「更多」披露必须真的打开').toHaveAttribute('open', '');
}
