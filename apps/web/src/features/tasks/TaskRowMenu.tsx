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
 * ## 一级菜单只有两枚，其余十项去了详情面
 *
 * | 项 | 去哪 | 为什么 |
 * |---|---|---|
 * | 打开详情 | 这里（一级） | 它是**所有字段编辑的唯一门口**：右键只是给熟练用户的加速键 |
 * | 删除 | 这里（危险区，分隔线以下） | 它不可与"打开详情"并列成同一档 |
 *
 * 移动 / 标签 / 子任务 / 截止 / 重复 / 提醒 / 备注 / 优先级 / AI 都不在这里 ——
 * 它们住在 `TaskDetailCard`（详情列或窄档的详情对话框）。判据是
 * `ux-principles.md` §4「配置项默认收起」与产品负责人那句「重操作不在一级菜单里」。
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

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { isUndoableDeletion, resolveDangerTier } from '@heyta/domain';
import { closePolicyOf, dismissActionFor } from '@heyta/ui';
import { useMenuKeyboard } from '../../lib/menu/useMenuKeyboard.js';
import { useI18n } from '@heyta/i18n';

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
}

export function TaskRowMenu({
  taskId,
  taskTitle,
  childCount,
  anchor,
  onClose,
  onOpenDetail,
  onDelete,
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

  /** 滚动 / 改窗口大小之后锚点就没有意义了 —— 收走，而不是画在一个错的地方。 */
  useEffect(() => {
    const onMove = (): void => {
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

  return createPortal(
    <div
      ref={panelRef}
      role="menu"
      aria-label={t('web.rowMenu.label', { title: taskTitle })}
      className="ht-row-menu ht-material"
      data-testid="task-row-menu"
      onKeyDown={onKeyDown}
    >
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
        {t('web.rowMenu.open')}
      </button>

      {/* 🔴 危险项**单独一组**：分隔线以上的都安全，以下那一条不可与它们并列成同一档。 */}
      <div className="ht-row-menu__sep" role="separator" />

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
        {confirming ? t('web.rowMenu.confirmDelete') : t('web.rowMenu.delete')}
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
    </div>,
    document.body,
  );
}
