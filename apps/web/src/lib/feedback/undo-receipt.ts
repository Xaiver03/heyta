/**
 * 撤销回执的宿主侧接线（全局 UX 线 P3）
 * =====================================
 *
 * 只有两件事住在这里，因为它们**每个宿主都要做**并且做错一次就是一条静默的失败：
 *
 * ① `restoreOrRefuse`：四家 store 的 `restore*` 一律返回**布尔**而不是抛
 *    （`notes/store.ts:71`、`projects/store.ts:54`、`habits/store.ts:70`、`tasks/store.ts:107`）。
 *    🔴 直接把那个布尔递给 `UndoReceipt` 的话，"捞不回来了"会被读成**撤销成功**：
 *    回执整条消失，屏幕上什么都不剩，而对象还在回收站里。这一枚把"没恢复成"
 *    变成一次拒绝，让 `UndoReceipt` 走它唯一的失败出口（`role="alert"` + 不自消）。
 *
 * ② `undoReceiptFor`：撤销资格**不在界面层判**。判据是 ADR-0048 的四态 ——
 *    只有进回收站的那四类（任务／便签／清单／习惯）撤销真的可执行，
 *    而这份名单的正文在 `@heyta/domain` 的 `isUndoableDeletion()`。
 *    这里只做一件事：把"这条删除是不是可撤销"变成一个宿主能问的问题。
 *    🔴 标签那一格永远读回 `false`（它不进回收站，`§7.1 P-1`），所以点它**不会**
 *    长出撤销按钮 —— 判据 e「不可撤销档位不出撤销按钮」就是从这一枚来的。
 */

import { isUndoableDeletion, type DeletableSubject } from '@heyta/domain';

/** 撤销没做成时用户要读到的那一句（由宿主用 `t()` 填好，共享层不 import i18n）。 */
export async function restoreOrRefuse(
  restore: () => Promise<boolean>,
  refusedMessage: string,
): Promise<void> {
  const restored = await restore();
  if (!restored) throw new Error(refusedMessage);
}

/**
 * 这一次删除**该不该**给撤销出口。
 *
 * ⚠️ 它只回答"对象还在不在回收站"，不回答"这次动作危险不危险"—— 后者是
 * `resolveDangerTier()` 的事（档位决定点之前要不要问，这一枚决定点之后能不能反悔）。
 * 把两件事合成一枚布尔，就会长成"危险的动作才有撤销"那种反过来的形状。
 */
export function undoReceiptFor(subject: DeletableSubject): boolean {
  return isUndoableDeletion(subject);
}
