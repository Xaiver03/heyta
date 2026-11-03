/**
 * 打开某条任务的**面单**（`task-pane`）—— 两档落点共用这一份入口。
 * ==================================================================
 *
 * 🔴 为什么这一族需要一个新文件（2026-11 行操作 UX 重设计之后）：
 * 行尾那一排**行内字段编辑器整排被删了**（产品负责人：「把所有这种铺开式组件全都删掉，
 * 全都收拢进来」）。现在字段编辑器的**唯一**所有者是 `TaskDetailCard`，它只有两个落点
 * （见 `apps/web/src/App.tsx` 的 `renderTaskTrailing` 上方那张表 + `openTask` 的注释）：
 *
 * | 档 | 判据 | 落点 |
 * |---|---|---|
 * | 宽档（详情列在画） | `taskPaneInColumn` = `detailColumnShown && 选中 !== null` | `[data-testid="detail-column"]` 里的 `task-pane` |
 * | 窄档（宽 < 1024 / 栏被收起 / 日历这种没有栏的视图） | 同上取反 | `WebModalShell` 对话框（`task-detail-dialog`，标题 `task-detail-dialog-title`）里的 `task-pane` |
 *
 * 于是旧判据里那一整族"窄档 ⇒ 行尾那颗 chip 把编辑权接回去"的**前提整个消失了**：
 * 行尾现在只有只读徽标（`NoteBadge` / `SubtaskBadge` / `TagChips` / `RepeatChip` /
 * `ReminderBadge`），它们没有任何一个能编辑。窄档问"这一档改不改得了"，
 * 现在只能问一件事：**点行 ⇒ 对话框开 ⇒ 编辑器在面单里**。
 *
 * ⚠️ 它不是 `.spec.ts`，所以不被 Playwright 当用例收集（`testMatch` 只认 `*.spec.ts`）。
 */
import { expect, type Locator, type Page } from '@playwright/test';

import { openTaskDetail } from './ai-entry.js';

/**
 * 点行体打开面单，把**面单本体**交回来（哪个档都行）。
 *
 * 定位与等待全部复用 `ai-entry.ts` 的 `openTaskDetail`（它点 `task-row-*` 那一棵、
 * 等 `task-pane` 出现）—— 不在这里抄第二份"怎么开"：两处各写一遍，
 * 迟早一处跟着 `openTask` 的落点规则走、另一处停在旧形状上。
 */
export async function openTaskPane(page: Page, title: string): Promise<Locator> {
  await openTaskDetail(page, title);
  return page.getByTestId('task-pane');
}

/**
 * 窄档：点行 ⇒ **对话框**里的人肉面单，并把"它确实在对话框里"这件事钉下来。
 *
 * 🔴 为什么要断言对话框本身，而不是"`task-pane` 出现了"就收工：
 * 窄档下详情列**不画**面单（`taskPaneInColumn` 为假），所以 `task-pane` 只可能来自对话框。
 * 少了这一条，"点行 ⇒ 面单出现"在**宽档**也成立 —— 判据会漏掉"窄档其实没开对话框、
 * 编辑权靠详情列接住"这种回退（那时窗口一窄，字段就整个消失，而且不报错）。
 * 实测（900×600，对话框 640×568）：标题「任务详情」可见、面单 1 枚、备注框 558×79。
 */
export async function openNarrowTaskPane(page: Page, title: string): Promise<Locator> {
  await openTaskDetail(page, title);
  const dialog = page.getByTestId('task-detail-dialog');
  await expect(
    dialog,
    '窄档下行尾没有编辑器之后，点行必须在对话框里给出面单 —— 否则这一档改不了任何字段',
  ).toBeVisible();
  await expect(
    page.getByTestId('task-detail-dialog-title'),
    '窄档面单对话框没有标题（`labelledBy` 指过去的那一枚）⇒ 读屏听到的是一个无名对话框',
  ).toBeVisible();
  const pane = dialog.getByTestId('task-pane');
  await expect(pane, '对话框里没有面单本体').toHaveCount(1);
  return pane;
}

/**
 * 关掉窄档那个面单对话框（本来就关着 ⇒ 什么都不做）。
 *
 * 🔴 不是方便：对话框开着的时候，它那层遮罩会把**行上**的点击全吃掉
 * （`WebModalShell` 的 `modal-readonly` 策略），于是后面任何一句"点回那一行"
 * 都会卡在 actionability 上直到超时 —— 报出来像"那一行坏了"。
 * 出口用壳自己的（Esc；背景与返回键也是出口），不自造关闭按钮。
 */
export async function closeTaskDetailIfOpen(page: Page): Promise<void> {
  const dialog = page.getByTestId('task-detail-dialog');
  if ((await dialog.count()) === 0) return;
  // 焦点如果还在面单里的输入框上，先交出去：Esc 是壳的出口，先让它真的到达壳。
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });
  await page.keyboard.press('Escape');
  await expect(dialog, '窄档面单对话框没关掉（后面的行上判据会被遮罩挡住）').toHaveCount(0);
}
