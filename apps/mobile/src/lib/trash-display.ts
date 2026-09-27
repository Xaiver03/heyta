/**
 * 回收站的**展示**逻辑（纯函数）
 * ==============================
 *
 * 🔴 这里**没有一行"该怎么删/怎么恢复"**。软删除发什么 op、恢复写
 * `{ deletedAt: null }`、purge 写 `purgedAt` 标记 —— 全部在
 * `@heyta/app-host` 的 `TaskActions`（`restore` / `purge` / `listTrashed`）。
 * 这一层只决定**界面上该说哪句话、以及确认框当前指着谁**。
 *
 * ## 为什么它值得单独一个文件、还值得测
 *
 * 1. **`pendingPurge` 是"不可逆动作必须有二次确认"的机器可查形状。**
 *    它的返回值是"确认框当前指向的那一条"，而界面只有在它有值时才能走到
 *    `purge()`。如果哪天有人图省事直接 `onPress={() => purge(task.id)}`，
 *    这一层就形同虚设 —— 所以把它写成一个能断言"没有确认 id 就没有对象"的函数。
 *
 * 2. **`notErasure` 是承重的一句，不是装饰。** purge 只追加 `purgedAt`，
 *    墓碑与 op 载荷都留着（`packages/op-log/src/state.ts`），也就是说这是
 *    "界面不再提供恢复"，**不是物理擦除历史**。这句话要是被删掉或抄成 Web
 *    那句更短的措辞，用户会拿到一个不实的承诺 —— 所以它有独立的词条 key，
 *    并在 `tests/trash-display.spec.ts` 里被断言。
 *
 * ⚠️ 本文件**绝不 import `react-native`**：`lib/` 会被 node 里的单测直接加载，
 * 加载 react-native 会解析失败（理由见 `growth-display.ts` 的文件头）。
 */

import type { Task } from '@heyta/domain';

import type { Translate } from '../i18n/translate';
import { formatStamp } from './date';

/**
 * 删除时间 → 「删除于 9-27 21:30」。
 *
 * 🔴 `deletedAt` 缺失时回退 `updatedAt`：列表按 `deletedAt` 过滤，理论上它一定在；
 * 但一个半应用状态的墓碑（或字段被别的路径清掉）到这里就是 `undefined`，
 * 而 `formatStamp(undefined)` 会渲染出 `NaN-NaN` —— 那种"看着像日期"的字符串
 * 比缺一小段信息更坏。
 */
export function deletedAtText(task: Task, t: Translate): string {
  return t('mobile.trash.deletedAt', { date: formatStamp(task.deletedAt ?? task.updatedAt) });
}

/** 恢复按钮的无障碍名（按钮上只有图标，读屏全靠它）。 */
export function restoreA11y(task: Task, t: Translate): string {
  return t('mobile.trash.restoreA11y', { title: task.title });
}

/** 彻底删除按钮的无障碍名。 */
export function purgeA11y(task: Task, t: Translate): string {
  return t('mobile.trash.purgeA11y', { title: task.title });
}

/** 二次确认对话框的全部措辞。 */
export interface PurgeConfirmCopy {
  title: string;
  /** 说清后果：从回收站消失、无法恢复。 */
  body: string;
  /**
   * 🔴 诚实条款：这不是物理擦除。
   *
   * 单独成段渲染，不并进 `body` —— 并进去之后它很容易在某次改文案时被删掉，
   * 而删掉它界面**照样渲染**，只是说了一句不实的话。
   */
  notErasure: string;
  submit: string;
  cancel: string;
}

export function purgeConfirmCopy(title: string, t: Translate): PurgeConfirmCopy {
  return {
    title: t('mobile.trash.confirm.title', { title }),
    body: t('mobile.trash.confirm.body'),
    notErasure: t('mobile.trash.confirm.notErasure'),
    submit: t('mobile.trash.confirm.submit'),
    cancel: t('mobile.trash.confirm.cancel'),
  };
}

/**
 * 确认框当前指向的那一条任务。
 *
 * 🔴 返回 `undefined` 时界面**不许**提供可执行的"彻底删除"路径 ——
 * 这就是"不可逆动作必须二次确认"在代码里的落点：
 *
 *   - 没有 `confirmingId`（用户还没点那个图标）→ `undefined`；
 *   - `confirmingId` 指向一条已经不在列表里的任务
 *     （比如另一台设备同步过来把它恢复了）→ 也是 `undefined`。
 *
 * 第二种情况与 Web 端 `TrashView` 的 effect 同源：对着一个已不存在的任务
 * 点"彻底删除"要么静默失败，要么删错东西。
 */
export function pendingPurge(
  items: readonly Task[],
  confirmingId: string | undefined,
): Task | undefined {
  if (confirmingId === undefined) return undefined;
  return items.find((task) => task.id === confirmingId);
}
