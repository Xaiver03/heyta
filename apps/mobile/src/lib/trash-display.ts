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

import type { TrashItem } from '@heyta/domain';

import type { Translate } from '../i18n/translate';
import { formatStamp } from './date';

/**
 * 删除时间 → 「删除于 9-27 21:30」。
 *
 * 🔴 这里**不再需要**回退：共享的 `toTrashItems()` 只收"带着删除时刻"的记录
 *（领域层 `inTrash` 是类型谓词），所以 `TrashItem.deletedAt` 在类型上就是 `number`。
 * 原来这一层自己写 `deletedAt ?? updatedAt`，是因为它收的是整条 `Task`；
 * 而"这条回退规则两端必须一致"当时只是一句注释。（`formatStamp(undefined)`
 * 会渲染出 `NaN-NaN` —— 那种"看着像日期"的字符串比缺一小段信息更坏。）
 */
export function deletedAtText(item: TrashItem, t: Translate): string {
  return t('mobile.trash.deletedAt', { date: formatStamp(item.deletedAt) });
}

/**
 * 一行的种类徽标。
 *
 * 🔴 它**不是**一个本地字符串，也不是回收站自己的一套词：唯一合规的取值表是
 * `packages/ui/src/sync/model.ts` 的 `entityLabelOf`（键 = `common.entity.*`）。
 * 因此这一格由**宿主**注入（`TrashScreen` 直接调 `entityLabelOf`），
 * 本文件只留类型 —— `lib/` 会被 node 里的单测直接加载，
 * 值引入 `@heyta/ui` 会把 react-native 一起拖进来（Flow 源码，node 解析不了）。
 * 判据在 `tests/trash-display.spec.ts` 里，走的是与 `conflict-keys.spec.ts`
 * 同一相对路径，两边同一份表。
 */

/** 恢复按钮的无障碍名（按钮上只有图标，读屏全靠它）。 */
export function restoreA11y(item: TrashItem, t: Translate): string {
  return t('mobile.trash.restoreA11y', { title: item.title });
}

/** 彻底删除按钮的无障碍名。 */
export function purgeA11y(item: TrashItem, t: Translate): string {
  return t('mobile.trash.purgeA11y', { title: item.title });
}

/** 二次确认对话框的全部措辞。 */
export interface PurgeConfirmCopy {
  title: string;
  /**
   * 影响面那一句（W4 / P-1）：清单 → "里面还有 N 条任务，它们不会被删除"；
   * 习惯 → "打卡记录不会被删除"。任务和便签**没有**这一句 ⇒ `undefined`。
   *
   * 🔴 它是**可选的**而不是空串：空串会渲染出一行空白，而"这一类没有影响面"
   *   与"这句文案丢了"在界面上长得一样，下一次没人看得出来。
   */
  readonly impact?: string;
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

export function purgeConfirmCopy(
  title: string,
  t: Translate,
  impact?: string,
): PurgeConfirmCopy {
  return {
    title: t('mobile.trash.confirm.title', { title }),
    // 只有算得出影响面的那两类才带；`undefined` 是"这一类没有这一行"，不是"空行"。
    ...(impact === undefined ? {} : { impact }),
    body: t('mobile.trash.confirm.body'),
    notErasure: t('mobile.trash.confirm.notErasure'),
    submit: t('mobile.trash.confirm.submit'),
    cancel: t('mobile.trash.confirm.cancel'),
  };
}

/**
 * 彻底删除之前的**影响面**那一句（W4）。
 *
 * 🔴 为什么必须有：删一条清单**不级联删任务**、删一个习惯**不删打卡记录**
 *   （`project-actions.ts` 文件头第 2 条 / `habit-actions.ts` 同一条规则）。
 *   不说这一句，用户会以为连着 N 条一起没了 —— 那是一个会让人**不敢点**、
 *   而说的又不是实话的确认框。
 *
 * @param liveTaskCount 这条清单里**活着**的任务数（由 `liveTaskCountOfProject` 算，
 *   规则在共享层；本函数不自己数 —— 两端各数一遍就是两份口径）。
 */
export function purgeImpactText(
  item: TrashItem,
  t: Translate,
  liveTaskCount: number,
): string | undefined {
  if (item.kind === 'PROJECT') return t('mobile.trash.confirm.projectTasks', { count: liveTaskCount });
  if (item.kind === 'HABIT') return t('mobile.trash.confirm.habitLogs');
  return undefined;
}

/**
 * 确认框当前指向的那一条任务。
 *
 * 🔴 返回 `undefined` 时界面**不许**提供可执行的"彻底删除"路径 ——
 * 这就是"不可逆动作必须二次确认"在代码里的落点：
 *
 *   - 没有 `confirmingId`（用户还没点那个图标）→ `undefined`；
 *   - `confirmingId` 指向一条已经不在列表里的条目
 *     （比如另一台设备同步过来把它恢复了）→ 也是 `undefined`。
 *
 * 第二种情况与 Web 端 `TrashView` 的 effect 同源：对着一个已不存在的条目
 * 点"彻底删除"要么静默失败，要么删错东西。
 */
export function pendingPurge(
  items: readonly TrashItem[],
  confirmingId: string | undefined,
): TrashItem | undefined {
  if (confirmingId === undefined) return undefined;
  return items.find((item) => item.id === confirmingId);
}
