/**
 * 行动作的共享词汇表：id、危险档、分组顺序
 * =========================================
 *
 * 出处：`docs/plans/row-actions-redesign.md` §3.2（行尾不常驻动作）、
 * §3.3（危险项**不手填档位**，一律问 `resolveDangerTier()`）、
 * §3.4（移动端主入口 = 长按菜单，第二入口 = 左滑露出动作）。
 *
 * ## 为什么这一枚要单独存在
 *
 * 移动端同一组动作有**两个落点**（长按菜单、左滑露出的那一条），而两处都必须回答
 * 同样三个问题：**这一档要不要就地二次确认**、**危险项排在哪一组**、**动作叫什么**。
 * 各写一遍就会出现两份裁决 —— 而"菜单里问了一句、滑出来的那枚直接删"这种分叉
 * 不会有任何测试变红（正是 `AGENTS.md` §3.4/§3.5 与 `danger-tier.ts` 文件头反复打的那类）。
 *
 * 所以：**判断住在这里，各落点只负责几何。**
 *
 * ## 边界（与 `TaskRow.tsx` / `RowActionMenu.tsx` 同一套纪律）
 *
 * · 🔴 **零文案**。本包不 import `@heyta/i18n`（`packages/ui/src/index.ts` 文件头那条），
 *   所有 `label` / `confirmingLabel` / `consequence` 由宿主注入。
 * · 🔴 **零数据变更**。动作只带一个 `id`，执行归宿主的 action 层
 *   （`packages/app-host`）—— 共享层不碰 op-log。
 * · 档位**不在这里发明**：转调 `@heyta/domain` 的 `resolveDangerTier()`，
 *   与 `apps/web/src/features/tasks/TaskRowMenu.tsx` 喂的是同一组事实。
 */

import { isUndoableDeletion, resolveDangerTier, type DangerTier } from '@heyta/domain';
import type { ReactNode } from 'react';

/**
 * 行动作菜单的**唯一词汇表**（顺序即菜单顺序）。
 *
 * 2026-11-06（R14 入口契约 · C2）：**这份清单是唯一的**。此前 Web 的行菜单
 * （`apps/web/src/features/tasks/TaskRowMenu.tsx`）自己另写了一份 7 个 id，
 * 与这里的 7 个只**交集 3 个** —— 于是同一个"删除"两端各叫各的、
 * "放弃"在 Web 上干脆没有词。两套词汇表不会有任何测试变红（各自内部自洽），
 * 而它会稳定地长出"同一动作两个入口、一端没入口"。
 *
 * 🔴 各端**只渲染，不发明**：宿主遍历 `ROW_ACTION_IDS`、为每一项给内容
 * （词条 / 图标 / 执行），顺序与分组由 `groupRowActions()` 给。
 * 新增一个行动作 = 先在这里加 id（并按 `docs/plans/r14-entry-table.md` 登记层级），
 * 而不是先在某个壳里加一枚按钮。
 *
 * ⚠️ `pin` / `unpin` / `abandon` / `unabandon` 是**同一个槽位的两副面孔**
 * （已置顶就给 `unpin`，已放弃就给 `unabandon`）：宿主按当前状态只给其中一副，
 * 于是共享层不需要知道"这条到底置没置顶"，少一份判断。
 * 语义依据：`docs/adr/0083-task-abandonment-fifth-state-and-share-boundary.md` §3.1（放弃是
 * 第五态、与完成互不推导）与 §3.2（置顶只有 `pinnedAt` 一个字段）。
 *
 * ⚠️ **`priority` / `moveToProject` / `tags` 已从这一份里删掉（B 包 R1 收敛，2026-11-06）。**
 * 它们都是**单值字段**，按 J1（作用域决定层）住在**字段层**（`TaskDetailCard`）；
 * 留在行菜单是同一个字段的**第二个编辑落点**，而入口表把这三行的处置写成 `收敛`
 * 就是这笔债。删掉之后：
 *   · 字段仍在面单里可改（能力没有减少）；
 *   · 行菜单不再与面单争夺"这个字段在哪儿改"；
 *   · `ROW_ACTION_IDS` 因此从 11 个 id 变成 9 个（`skipOccurrence` 加了 1 个）。
 * 判据：`apps/web/tests/task-row-menu.spec.tsx` 的「面单是这三个字段的唯一编辑落点」那一组。
 *
 * ⚠️ `addSubtask` 留下了：它是**结构动作**（建一条新任务），不是字段值 ——
 * 而且它在行菜单里是**导航型**（只 `openTask`），不是第二个建任务的落点。
 */
export const ROW_ACTION_IDS = [
  'open',
  'pin',
  'unpin',
  'addSubtask',
  /*
    R3「跳过这一次」（B 包，2026-11-06）：**只对重复任务**有意义。
    它的位置在这里而不是在"重复"那个字段格里，理由是**代价**（J5）：
    跳过会推进到期日（改变"这条任务出现在哪一天"），那是对象层的动作；
    而"改规则"才是字段层。宿主**只在**有重复规则时才提供它
    （没有规则 ⇒ `hostContentOf` 返回 `null`），所以词表里有、菜单里按条件出现。
  */
  'skipOccurrence',
  'abandon',
  'unabandon',
  'select',
  'delete',
] as const;

/** 一项行动作的**语义名**，不是文案。取值域 = `ROW_ACTION_IDS`。 */
export type RowActionId = (typeof ROW_ACTION_IDS)[number];

/** 一项动作 = 语义 id + 宿主注入的内容。 */
export interface RowAction {
  readonly id: RowActionId;
  /** 这一枚上写出来的字（宿主词条）。 */
  readonly label: string;
  /**
   * 只有 `delete` 且档位是 `popconfirm` 时有意义：**第二下**要显示的字
   *（「仍要删除」）。省略时第二下仍显示 `label` —— 少了那句改口，
   * 就地确认就退化成"连点两下"，所以宿主在有子任务的那一条上必须给。
   */
  readonly confirmingLabel?: string;
  /** 图标节点由宿主画（图标登记表在各端壳里，共享层不认识具体图标库）。 */
  readonly icon?: ReactNode;
}

/**
 * 危险项：分隔线以下的那一组。
 *
 * 判据来自 §3.3 与 `apps/web/tests/task-row-menu.spec.tsx` 的 P2 ——
 * 「危险项在分隔线之后」在 Web 上已经是钉住的事实，移动端不许变成第二个形状。
 */
const DANGEROUS_ROW_ACTION_IDS: readonly RowActionId[] = ['delete'];

/**
 * ⚠️ `select`（进入批量选择）排在 `delete` 之前、`delete` 归危险组：
 * 长按原本就是"进入多选"的手势（`mobile.tasks.gestureHint` 钉过它），
 * 手势改派给上下文菜单之后，**那条效率路径不许丢**，只能搬进菜单里成为一项。
 *
 * 🔴 顺序**不再另写一份**：以前这里有一个 6 项数组，而 id 集合有 7 个 ——
 * 多出来那一个会静默排到末尾。现在顺序就是 `ROW_ACTION_IDS`。
 */
export function isDangerousRowAction(id: RowActionId): boolean {
  return DANGEROUS_ROW_ACTION_IDS.includes(id);
}

/**
 * 分组：**安全项在前、危险项在后**，各组内部按 `ROW_ACTION_IDS` 的顺序排。
 * 顺序由这一枚给出，各落点（菜单 / 滑动条）不再自己排一遍。
 */
export function groupRowActions(actions: readonly RowAction[]): {
  readonly safe: readonly RowAction[];
  readonly danger: readonly RowAction[];
} {
  const rank = (id: RowActionId): number => {
    const index = ROW_ACTION_IDS.indexOf(id);
    // 没登记过的 id 排在已知项之后（不该发生，但它不该让界面乱序成不可用）。
    return index === -1 ? ROW_ACTION_IDS.length : index;
  };
  const byRank = (a: RowAction, b: RowAction): number => rank(a.id) - rank(b.id);
  return {
    safe: actions.filter((action) => !isDangerousRowAction(action.id)).sort(byRank),
    danger: actions.filter((action) => isDangerousRowAction(action.id)).sort(byRank),
  };
}

/**
 * 删除**一条任务**该走哪一档 —— §3.3 那张表的唯一实现。
 *
 * 三个输入都是**事实**，不是措辞：
 *  · `affectedCount: 1` —— 这里只管单条（批量另有既有实现，不在本单）；
 *  · `undoAvailable: isUndoableDeletion('task')` —— 任务进回收站 ⇒ 撤销真的可执行，
 *    不手填布尔（手填迟早和动作层的运行时拦截分家）；
 *  · `collateralImpact: childCount` —— 删除只给父任务写墓碑，`buildTaskTree` 会把
 *    "父已删除"的子任务提到顶层（`@heyta/domain` 的 `promotedFromDeletedParent`），
 *    所以"它下面还有 N 条"是可核对的后果句，不是修辞。
 *
 * 单条 + 可撤销 ⇒ 档位只可能是 `undo`（无子任务，直接删 + 撤销回执）
 * 或 `popconfirm`（有子任务，就地二次确认）。
 */
export function deleteTierForTask(childCount: number): DangerTier {
  return resolveDangerTier({
    affectedCount: 1,
    undoAvailable: isUndoableDeletion('task'),
    collateralImpact: childCount,
  });
}

/** 删除这一条要不要就地二次确认（`popconfirm` 档）。几何层只问这一句。 */
export function deleteNeedsConfirm(childCount: number): boolean {
  return deleteTierForTask(childCount) === 'popconfirm';
}

/**
 * 一行的"左滑露出动作"契约（`TaskRow` 的 `swipeActions` 插槽给宿主回的东西）。
 *
 * 🔴 它**只在滑出之后**才是可点的：不做"滑到底直接删"
 *（§9.3 明文：若要全滑直删，那是另一档，必须先配撤销回执与误触反悔的证据）。
 */
export interface TaskRowSwipeSpec {
  /** 露出来的那几枚（宿主给内容，共享层给几何）。 */
  readonly actions: readonly RowAction[];
  /** 直接子任务数 —— 危险档的输入，判定仍走 `deleteNeedsConfirm()`。 */
  readonly childCount: number;
  /** `popconfirm` 时要说的那句后果（宿主词条，真事实）。 */
  readonly consequence: string;
  /** 露出之后，点行身那一块透明收口按钮的无障碍名（"收起动作"）。 */
  readonly closeLabel: string;
  /**
   * 执行那一枚。🔴 共享层**不碰数据**：这里只回吐语义 id，
   * 具体写哪条 op 由宿主的 action 层决定（`AGENTS.md` §3.4 的"op-log 是唯一写入口"）。
   */
  readonly onAction: (actionId: RowActionId) => void;
  /** 这一条正在处理中：手势与动作都不该再接受第二次点击。 */
  readonly busy?: boolean;
}
