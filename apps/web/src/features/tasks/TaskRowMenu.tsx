/**
 * 任务行的**右键上下文菜单**（行操作 UX 重设计，2026-11）
 * ==========================================================
 *
 * ## 它替掉了什么
 *
 * 改之前行尾是一枚「⋯ 更多」的 `<details>`，展开后把**九个控件**摊成一行：
 * 备注 / 子任务 / 清单+标签 / 重复 / 截止 / 提醒 / AI 拆解 / AI 估时 / 删除。
 * 九个同级、无分组、无主次，"删除"与"重复"同一视觉重量 —— 产品负责人的原话是
 * 「不需要有更多的三个点」，参照产品那一行只有**勾选 + 标题 + 一行淡元信息**。
 *
 * ## 菜单里有哪些项：**由共享层那份词汇表决定，不由本文件决定**
 *
 * 2026-11-06（R14 入口契约 · C2）改的就是这一句。之前本文件自己维护了一份
 * 7 个 id 的清单，与 `packages/ui/src/task-list/row-actions.ts` 的 7 个**只交集 3 个**
 * （`open` / `pin` / `delete`）—— 于是同一个"删除"两端各叫各的，而"放弃"在 Web 上
 * 干脆没有词（A1 的零入口就是这么长出来的）。两套词汇表不会有任何测试变红。
 *
 * 现在：
 *
 * | 决定 | 谁定 |
 * |---|---|
 * | 有哪些 id | `ROW_ACTION_IDS`（`@heyta/ui`，唯一一份） |
 * | 顺序 | 同上（`groupRowActions()` 按它排） |
 * | 分组：安全 / 危险（分隔线在哪） | `groupRowActions()` |
 * | 这一项长什么样、点了做什么 | **本文件**（`hostContentOf` + `renderRowAction`） |
 *
 * 于是"本端有哪几项"= 遍历共享清单 × 本端这一档能不能提供。
 * 加一项 = 先在共享层加 id（并按 `docs/plans/r14-entry-table.md` 登记层级），
 * 而不是先在这里插一枚按钮。
 *
 * ⚠️ 项数不是常量：宿主没接的能力**不画**（"按下去没反应的一行"不留）。
 * 只接 `onOpenDetail` + `onDelete` 时菜单就是两枚（判据 `task-row-menu.spec.tsx` 的 P1）。
 *
 * ## 一级的两枚是"最小集"，其余都在同一层里按能力长出来
 *
 * | 项 | 层级 | 为什么在这儿 |
 * |---|---|---|
 * | 打开详情 | 对象层 | 它是**所有字段编辑的唯一门口**：右键只是给熟练用户的加速键 |
 * | 置顶 / 放弃 | 对象层 | 改的是**这一条任务本身**（J2），不是某个字段的值 |
 * | 优先级 / 移动到 / 标签 | 字段值子菜单 | 抄参照产品的做法（取证 §3.2 #2）；⚠️ 与详情面同字段两落点是 R1 的债，入口表登记为"收敛" |
 * | 加子任务 | 对象层第 2 跳 | 需要父任务上下文才成立（取证 §3.2 #4） |
 * | 删除 | 对象层 · 危险区（分隔线以下） | 它不可与"打开详情"并列成同一档（J5） |
 *
 * 截止 / 提醒 / 重复 / 备注 / AI 不在这里 —— 它们住在 `TaskDetailCard`
 * （详情列或窄档的详情对话框）。判据是 `ux-principles.md` §4「配置项默认收起」。
 *
 * ## 🔴 右键**不是**唯一通路，这是硬要求
 *
 * 右键在三个场景下根本不可达：**触屏**（笔记本的触摸屏、平板）、**键盘**（没有鼠标）、
 * **不认这个手势的用户**。所以本组件永远成对出现两条别的路径：
 *
 *  1. **键盘等价**：行本身是 `role="button"` + `tabIndex=0`（共享 `TaskRow` 的
 *     `onOpenTask` 那一枚），浏览器在 `Shift+F10` / 菜单键上会派发 `contextmenu`，
 *     目标就是**当前聚焦的那一行** ⇒ 与鼠标右键走**同一个**处理函数（宿主侧）。
 *     宿主另外显式接了 `Shift+F10` / `ContextMenu` 的 `keydown`，因为个别引擎
 *     不派发合成事件，而那一条落空时用户看到的是"按了没反应"。
 *  2. **可发现入口**：**点行 → 详情**。这是界面上真的看得见的那条路，
 *     而且它到达的是**同一批能力**（详情面里字段是全集）。右键盘菜单里那两枚
 *     都是它的子集 ⇒ "右键找不到"不会让任何一个功能变成不可达。
 *
 * 换句话说：**右键是加速器，不是入口**。删掉右键，功能一个都不少。
 *
 * ## 危险项按档位走，不按"文案里有没有删除"
 *
 * 档位由 `@heyta/domain` 的 `resolveDangerTier()` 裁决（`overlay-feedback.md` §2）：
 * 单条任务删除 `undoAvailable = isUndoableDeletion('task')` 为真、连带为 0 ⇒ `undo`
 * （直接做 + 撤销回执，**不弹确认**）；**带子任务时** `collateralImpact > 0` ⇒
 * `popconfirm`（就地二次确认）。判定不在本文件里写第二份。
 *
 * ⚠️ 本组件的"就地二次确认"是 `popconfirm` 档的**实现**，不是自定档位：
 * 第一下点"删除"只把那一行换成「仍要删除」+ 一句后果，第二下才真的删。
 * 判据 `apps/web/tests/task-row-menu.spec.tsx` 的 D1–D3。
 */

import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { isUndoableDeletion, resolveDangerTier, Priority } from '@heyta/domain';
import {
  closePolicyOf,
  dismissActionFor,
  groupRowActions,
  ROW_ACTION_IDS,
  type RowAction,
  type RowActionId,
} from '@heyta/ui';
import { ICON_SIZE } from '@heyta/design-system';
import { useMenuKeyboard } from '../../lib/menu/useMenuKeyboard.js';
import { useI18n } from '@heyta/i18n';
import { Archive, ArchiveRestore, CalendarOff, Flag, FolderOpen, Plus, Tag, ListPlus, Pin, PinOff } from 'lucide-react';

import './task-row-menu.css';

/** 菜单的锚点：视口坐标（鼠标）或行矩形的一角（键盘）。 */
export interface TaskRowMenuAnchor {
  readonly x: number;
  readonly y: number;
}

export interface TaskRowMenuProps {
  readonly taskId: string;
  readonly taskTitle: string;
  /** 直接子任务数（存活）。`> 0` 时档位抬到 `popconfirm`。 */
  readonly childCount: number;
  readonly anchor: TaskRowMenuAnchor;
  readonly onClose: () => void;
  readonly onOpenDetail: (taskId: string) => void;
  /** 真的执行删除。撤销回执由宿主给（`resolveDangerTier` 判成 `undo` 的那一档）。 */
  readonly onDelete: (taskId: string) => void;
  /** 添加子任务（B2）。点击后宿主负责展开行内输入框。 */
  readonly onAddSubtask?: (parentId: string) => void;
  /**
   * 置顶 / 取消置顶（B5）。写的是 `Task.pinnedAt`，一次点击 = 一条 op；
   * 🔴 顺序**不在界面排** —— 置顶只改同分组内的次序那条判断住在 `@heyta/app-host`。
   */
  readonly onSetPinned?: (taskId: string, pinned: boolean) => void;
  /**
   * 这一条现在是不是置顶态（决定文案与图标）。
   * ⚠️ 由宿主用领域层的 `isPinned()` 算好传进来 —— 本层不许自己读 `pinnedAt` 选文案
   * （`packages/domain/src/entities.ts` 文件头明写了这条禁令）。
   */
  readonly pinned?: boolean;
  /**
   * 放弃 / 取消放弃（A1，2026-11-06 滴答对齐）。
   *
   * 🔴 这一格补的是**零入口**，不是"再加一个入口"：共享词汇表里 `abandon` / `unabandon`
   * 从 ADR-0083 起就有（`packages/ui/src/task-list/row-actions.ts`），移动端的行菜单
   * 一直在用（`apps/mobile/src/screens/TasksScreen.tsx`），而 `grep abandon apps/web/src`
   * 在补这一格之前是 **0** —— Web 用户没有"放弃"这个词，只有删除。
   *
   * 层级：**对象层**（改的是一条任务本身的状态，J2）。落点就是行菜单这一处，
   * 与"完成"不同（完成有 4 个入口，因为它的代价低且高频）。
   */
  readonly onSetAbandoned?: (taskId: string, abandoned: boolean) => void;
  /**
   * R3「跳过这一次」：把当前这一次跳过去（到期日推进到下一次，规则不动）。
   *
   * 🔴 **只有重复任务才有"这一次"** —— 所以宿主用一个单独的布尔
   * （`repeating`）说明"这条有规则"，而不是让本组件去读 `repeatRule`
   * （规则串的合法性判据在领域层，壳里不该再判一次）。
   */
  readonly onSkipOccurrence?: (taskId: string) => void;
  /** 这条任务有没有生效的重复规则。`false` / 省略 ⇒ 那一项不出现。 */
  readonly repeating?: boolean;
  /**
   * 这一条现在是不是已放弃态。由宿主用领域层 `isAbandoned()` 算好传进来 ——
   * 与 `pinned` 同一条纪律：本层不读 `abandonedAt` 选文案。
   */
  readonly abandoned?: boolean;
}

export function TaskRowMenu({
  taskId,
  taskTitle,
  childCount,
  anchor,
  onClose,
  onOpenDetail,
  onDelete,
  onAddSubtask,
  onSetPinned,
  pinned = false,
  onSetAbandoned,
  onSkipOccurrence,
  repeating = false,
  abandoned = false,
}: TaskRowMenuProps): React.JSX.Element {
  const { t } = useI18n();
  const panelRef = useRef<HTMLDivElement>(null);
  const [confirming, setConfirming] = useState(false);

  /**
   * 档位：**只描述事实，判定交给 `resolveDangerTier`**。
   * `collateralImpact` 的口径是"连带受影响的条目数"，对一条任务就是它的直接子任务数
   * （删除父任务之后 `buildTaskTree` 会把它们提到顶层，见 `@heyta/domain/subtasks.ts`）。
   */
  const tier = resolveDangerTier({
    affectedCount: 1,
    undoAvailable: isUndoableDeletion('task'),
    collateralImpact: childCount,
  });
  const deleteNeedsConfirm = tier === 'popconfirm';

  /**
   * 关闭策略查表，不在这里内联比较（`overlay-feedback.md` §3）：
   * `menu` 这一行是「背景 / Esc / 返回键都收走、不给 ×」。
   */
  const policy = closePolicyOf('menu');
  const closeIfAllowed = useCallback(
    (channel: 'scrim' | 'escape') => {
      const action = dismissActionFor(policy, channel === 'escape' ? policy.escape : policy.scrim);
      if (action === 'none') return;
      onClose();
    },
    [onClose, policy],
  );

  /**
   * 🔴 定位**不写内联 `style` 字面量**：`check:l4-no-style` 的棘轮按"含 `style={{` 的行数"
   * 计（web 上限 98，只减不增）。这里用 `style.setProperty` 落两条**标准属性**，
   * 于是既没有字面量、也没有自造 CSS 变量（后者被同一道门禁的断言 B 禁止）。
   * 夹取在视口内：菜单画到屏幕外等于"点了没反应"。
   */
  useLayoutEffect(() => {
    const node = panelRef.current;
    if (node === null) return;
    node.style.setProperty('inset-block-start', `${anchor.y}px`);
    node.style.setProperty('inset-inline-start', `${anchor.x}px`);
    const rect = node.getBoundingClientRect();
    const margin = 8;
    if (rect.right > window.innerWidth - margin) {
      node.style.setProperty('inset-inline-start', `${Math.max(margin, window.innerWidth - rect.width - margin)}px`);
    }
    if (rect.bottom > window.innerHeight - margin) {
      node.style.setProperty('inset-block-start', `${Math.max(margin, window.innerHeight - rect.height - margin)}px`);
    }
  }, [anchor.x, anchor.y, confirming]);

  /**
   * 焦点：打开即给第一枚（键盘用户按 Enter 就已经在"打开详情"上）。
   * 关闭时归还给触发那一行 —— 由宿主在 `onClose` 里做（它才知道是哪一行）。
   */
  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, []);

  /** 点外面收走。`mousedown` 而不是 `click`：与 `WebModalShell` 同一条理由。 */
  useEffect(() => {
    const onPointerDown = (event: MouseEvent | TouchEvent): void => {
      const node = panelRef.current;
      if (node === null) return;
      if (event.target instanceof Node && node.contains(event.target)) return;
      onClose();
    };
    document.addEventListener('mousedown', onPointerDown, true);
    document.addEventListener('touchstart', onPointerDown, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true);
      document.removeEventListener('touchstart', onPointerDown, true);
    };
  }, [onClose]);

  /**
   * 滚动 / 改窗口大小之后锚点就没有意义了 —— 收走，而不是画在一个错的地方。
   *
   * 🔴 但**面板自己的滚动不算**：锚点是 `position: fixed` 钉在视口上的，
   * 面板内部滚一下并不改变它和那一行的关系；而列表/页面滚动会。
   * 少了这一格判断，"面板里长出输入框并被浏览器滚进视野"就会自己把自己关掉。
   */
  useEffect(() => {
    const onMove = (event?: Event): void => {
      const node = panelRef.current;
      if (node !== null && event?.target instanceof Node && node.contains(event.target)) return;
      onClose();
    };
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [onClose]);

  /**
   * 键盘：**交给全仓唯一那份判断**（`packages/ui/src/control/menu.ts` +
   * `lib/menu/useMenuKeyboard.ts`）。
   *
   * 🔴 这里原本是**第四份**手写键盘模型：只认 Escape / Tab / 上下 / Home-End，
   * 没有类型查找、没有环绕（`menuActionOf` 的 `focus` 动作自带环绕），
   * 而且三枚菜单项都**没有** `tabIndex={-1}` —— 于是 Tab 会走进菜单而菜单还开着
   * （`check:menu-keyboard` 的 M1/M2 两格各红一次）。
   *
   * 关闭仍然走 `closeIfAllowed`：共享判断只给出"要不要还焦点"，
   * **这一层的关闭策略是查表来的**（`closePolicyOf('menu')`），不是它的事。
   * `refocusTrigger` 恰好就是"Esc（还焦点）"与"Tab（去下一枚控件，不还）"的分界，
   * 所以两者用同一个布尔分开，不会把 Tab 也当成 Esc 处理。
   */
  const noTriggerRef = useRef<HTMLElement | null>(null);
  const onKeyDown = useMenuKeyboard({
    open: true,
    containerRef: panelRef,
    triggerRef: noTriggerRef,
    itemSelector: '[role="menuitem"]',
    // 🔴 草稿框展开时把整把键盘让给它：打字不是"类型查找"，方向键也不该把焦点
    // 从输入框里抢走。用的就是共享层为"菜单里再开一层"准备的那一格（`nestedOpen`），
    // 不在这里另写一份按键解释。
    // 菜单里没有第二层输入框了（标签子菜单已按 R1 收敛到面单），所以这里是 `false`。
    nestedOpen: false,
    // 焦点进入由上面那条既有 `useEffect` 负责（它按"第一枚"取，与共享常量同值）。
    focusOnOpen: false,
    // 焦点归还由宿主做（它才知道是哪一行触发的菜单），见文件头那段说明。
    focusTrigger: () => {},
    onClose: ({ refocusTrigger }) => {
      if (refocusTrigger) closeIfAllowed('escape');
      else onClose();
    },
  });

  const runDelete = (): void => {
    if (deleteNeedsConfirm && !confirming) {
      setConfirming(true);
      return;
    }
    onDelete(taskId);
  };

  /**
   * 本端为每个 id 提供的**内容**（词条 + 图标）；`null` = 本端这一档不提供。
   *
   * 🔴 这里**不**决定顺序、**不**决定分组、**不**决定哪一项算危险 ——
   * 那三件事在 `@heyta/ui` 的 `groupRowActions()` 里，id 集合在 `ROW_ACTION_IDS` 里。
   * 本组件只回答"这一项长什么样、点了做什么"。
   *
   * 2026-11-06（R14 入口契约 · C2）：改之前本文件自己写了一份 7 个 id 的清单，
   * 与共享层的 7 个**只交集 3 个**（`open` / `pin` / `delete`）—— 于是"放弃"在 Web 上
   * 根本没有词。现在词汇表只有一份：本文件里出现的每个 id 都必须先在 `ROW_ACTION_IDS`
   * 里存在，否则 `RowActionId` 类型就编译不过（判据 `docs/plans/r14-entry-table.mjs` 第 7 条）。
   */
  const hostContentOf = (
    id: RowActionId,
  ): { label: string; confirmingLabel?: string; icon: ReactNode } | null => {
    switch (id) {
      case 'open':
        return { label: t('web.rowMenu.open'), icon: null };
      case 'pin':
        return pinned || onSetPinned === undefined
          ? null
          : { label: t('web.rowMenu.pin'), icon: <Pin size={ICON_SIZE.sm} className="ht-row-menu__icon" /> };
      case 'unpin':
        return pinned && onSetPinned !== undefined
          ? { label: t('web.rowMenu.unpin'), icon: <PinOff size={ICON_SIZE.sm} className="ht-row-menu__icon" /> }
          : null;
      case 'addSubtask':
        return onAddSubtask === undefined
          ? null
          : {
              label: t('web.rowMenu.addSubtask'),
              icon: <ListPlus size={ICON_SIZE.sm} className="ht-row-menu__icon" />,
            };
      case 'skipOccurrence':
        /**
         * 只在**有生效规则**且宿主接了回调时才出现。
         * 判据不是"有没有下一次"（那要跑一次求值，而求值在领域层）——
         * 规则走到尽头时动作会拒绝并给一句人话，比这里悄悄少一项更好：
         * "我明明有重复任务，为什么菜单里没有跳过"是没法回答的。
         */
        return repeating && onSkipOccurrence !== undefined
          ? {
              label: t('web.rowMenu.skipOccurrence'),
              icon: <CalendarOff size={ICON_SIZE.sm} className="ht-row-menu__icon" />,
            }
          : null;
      case 'abandon':
        return abandoned || onSetAbandoned === undefined
          ? null
          : {
              label: t('web.rowMenu.abandon'),
              icon: <Archive size={ICON_SIZE.sm} className="ht-row-menu__icon" />,
            };
      case 'unabandon':
        return abandoned && onSetAbandoned !== undefined
          ? {
              label: t('web.rowMenu.unabandon'),
              icon: <ArchiveRestore size={ICON_SIZE.sm} className="ht-row-menu__icon" />,
            }
          : null;
      case 'select':
        // 多选在 Web 是**视图层**的一档（页头 `⋯` 的 `task-select-open`，进入之后由页头的
        // 批量条接管），不在行菜单里重复一枚 —— 入口表里那一行的层级就是视图。
        return null;
      case 'delete':
        return {
          label: t('web.rowMenu.delete'),
          // 共享契约里的"第二下要显示的字"：省略它，就地确认退化成"连点两下"。
          confirmingLabel: t('web.rowMenu.confirmDelete'),
          icon: null,
        };
    }
  };

  /**
   * 本端这一档实际提供的项。
   *
   * 🔴 **遍历共享层那份 id 清单**，不是自己再排一遍：id 集合、顺序、分组、危险档
   * 四件事因此结构上不可能与本端另一处（或多端之间）分家。
   */
  const available: readonly RowAction[] = ROW_ACTION_IDS.flatMap((id) => {
    const content = hostContentOf(id);
    return content === null
      ? []
      : [{ id, label: content.label, confirmingLabel: content.confirmingLabel, icon: content.icon }];
  });
  const { safe, danger } = groupRowActions(available);

  /**
   * 画一项。**只画，不排** —— 进来的 `action` 已经由 `groupRowActions()` 定过组与序。
   *
   * ⚠️ 每一项的 testid 保留历史名字（`task-row-menu-move` / `-add-subtask` 等）：
   * 它们是 e2e 与既有用例的锚点；改名的收益只是"和 id 一样"，代价是一批断言跟着漂。
   */
  const renderRowAction = (action: RowAction): ReactNode => {
    switch (action.id) {
      case 'open':
        return (
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className="ht-row-menu__item"
            data-testid="task-row-menu-open"
            onClick={() => {
              onOpenDetail(taskId);
              onClose();
            }}
          >
            {action.label}
          </button>
        );

      /*
        置顶 / 取消置顶（B5，2026-11-04 滴答对齐）。
        🔴 这一格**不是新功能**：字段（`Task.pinnedAt`）、动作（`TaskActions.setPinned`）、
        出口排序（`byPinnedFirst` 只作用于同分组内，ADR-0083 §3.2）、移动端的菜单项
        （`TasksScreen.tsx`）全都早就在 —— Web 上缺的只有这一枚按钮。
        ⚠️ 但浏览器腿量出来**展示**那一半当时也是缺的：行序走的是领域的
        `sortTasks`，它当时不看 `pinnedAt`，所以点了之后字段写了、行不动。
        那一档补在 `packages/domain/src/task-order.ts`（唯一那份），不在这里补。
        文案与图标跟着**当前状态**换（置顶过的那条再点一次是取消），当前态由宿主
        用领域层 `isPinned()` 算好传进来，本层不读 `pinnedAt` 选文案。
      */
      case 'pin':
      case 'unpin':
        return (
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className="ht-row-menu__item"
            data-testid="task-row-menu-pin"
            onClick={() => {
              onSetPinned?.(taskId, !pinned);
              onClose();
            }}
          >
            {action.icon}
            {action.label}
          </button>
        );

      /* B2: 添加子任务 */
      case 'addSubtask':
        return (
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className="ht-row-menu__item"
            data-testid="task-row-menu-add-subtask"
            onClick={() => {
              onAddSubtask?.(taskId);
              onClose();
            }}
          >
            {action.icon}
            {action.label}
          </button>
        );

      /* R3「跳过这一次」：对象层、代价低于删除（一条普通 UPD，⌘Z 能撤回来）。 */
      case 'skipOccurrence':
        return (
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className="ht-row-menu__item"
            data-testid="task-row-menu-skip-occurrence"
            onClick={() => {
              onSkipOccurrence?.(taskId);
              onClose();
            }}
          >
            {action.icon}
            {action.label}
          </button>
        );

      /*
        A1: 放弃 / 取消放弃（第五态，ADR-0083 §3.1）。
        🔴 补的是**零入口**：共享词汇表（`abandon` / `unabandon`）与移动端的行菜单
        从 ADR-0083 起就有这个词，而 `grep abandon apps/web/src` 一直是 0 ——
        Web 用户没有"放弃"，只有删除（那是另一档代价，J5）。
        层级是**对象层**（改的是一条任务本身的状态，J2）；代价低于删除 ⇒ 不进危险组。
      */
      case 'abandon':
      case 'unabandon':
        return (
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className="ht-row-menu__item"
            data-testid="task-row-menu-abandon"
            onClick={() => {
              onSetAbandoned?.(taskId, !abandoned);
              onClose();
            }}
          >
            {action.icon}
            {action.label}
          </button>
        );

      /* 危险项：分隔线以下那一组。它由共享层的分组决定，不是在这里挑位置。 */
      case 'delete':
        return (
          <Fragment>
            {confirming ? (
              <p className="ht-row-menu__consequence" role="status" data-testid="task-row-menu-consequence">
                {t('web.rowMenu.childConsequence', { count: childCount })}
              </p>
            ) : null}
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="ht-row-menu__item ht-row-menu__item--danger"
              data-testid="task-row-menu-delete"
              onClick={runDelete}
            >
              {confirming ? (action.confirmingLabel ?? action.label) : action.label}
            </button>
            {confirming ? (
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                className="ht-row-menu__item"
                data-testid="task-row-menu-cancel"
                onClick={() => {
                  setConfirming(false);
                }}
              >
                {t('web.rowMenu.cancel')}
              </button>
            ) : null}
          </Fragment>
        );

      case 'select':
        // `hostContentOf` 对本端这一档恒给 `null`（多选是视图层的一档），走不到这里。
        return null;
    }
  };

  return createPortal(
    <div
      ref={panelRef}
      role="menu"
      aria-label={t('web.rowMenu.label', { title: taskTitle })}
      className="ht-row-menu ht-material"
      data-testid="task-row-menu"
      onKeyDown={onKeyDown}
    >
      {safe.map((action) => (
        <Fragment key={action.id}>{renderRowAction(action)}</Fragment>
      ))}

      {/* 🔴 危险项**单独一组**：分隔线以上的都安全，以下那一条不可与它们并列成同一档。
          线的位置由"共享层判成危险组"决定，不由本文件决定。 */}
      <div className="ht-row-menu__sep" role="separator" />

      {danger.map((action) => (
        <Fragment key={action.id}>{renderRowAction(action)}</Fragment>
      ))}
    </div>,
    document.body,
  );
}
