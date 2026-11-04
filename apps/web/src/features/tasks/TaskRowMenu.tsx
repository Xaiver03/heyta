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
import { isUndoableDeletion, resolveDangerTier, Priority } from '@heyta/domain';
import { closePolicyOf, dismissActionFor } from '@heyta/ui';
import { ICON_SIZE } from '@heyta/design-system';
import { useMenuKeyboard } from '../../lib/menu/useMenuKeyboard.js';
import { useI18n } from '@heyta/i18n';
import { Flag, FolderOpen, Plus, Tag, ListPlus, Pin, PinOff } from 'lucide-react';

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
  /** 设置优先级。 */
  readonly onSetPriority?: (taskId: string, priority: Priority) => void;
  /** 当前优先级（用于高亮当前项）。 */
  readonly currentPriority?: Priority;
  /** 移动到清单。 */
  readonly onMoveToProject?: (taskId: string, projectId: string | undefined) => void;
  /** 可用清单列表（用于"移动到"子菜单）。 */
  readonly projects?: ReadonlyArray<{ id: string; name: string }>;
  /** 当前清单 ID（用于高亮当前项）。 */
  readonly currentProjectId?: string;
  /** 添加子任务（B2）。点击后宿主负责展开行内输入框。 */
  readonly onAddSubtask?: (parentId: string) => void;
  /** 设置标签（B3）。 */
  readonly onSetTags?: (taskId: string, tagIds: string[]) => void;
  /** 可用标签列表（用于"标签"子菜单）。 */
  readonly tags?: ReadonlyArray<{ id: string; name: string }>;
  /** 当前标签 ID 列表（用于高亮已选项）。 */
  readonly currentTagIds?: ReadonlyArray<string>;
  /**
   * 新建标签（B3 的另一半）。宿主负责"重名就当选中那条已有的"这件事 ——
   * 判重需要的是**全量标签**，那份名册在宿主手里，不在这一层复制一份。
   * 返回的 id 由本层直接并进那一组，所以用户看到的是一步到位：起名 → 勾上。
   */
  readonly onCreateTag?: (name: string) => Promise<string | undefined>;
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
}

export function TaskRowMenu({
  taskId,
  taskTitle,
  childCount,
  anchor,
  onClose,
  onOpenDetail,
  onDelete,
  onSetPriority,
  currentPriority,
  onMoveToProject,
  projects,
  currentProjectId,
  onAddSubtask,
  onSetTags,
  tags,
  currentTagIds,
  onSetPinned,
  pinned = false,
  onCreateTag,
}: TaskRowMenuProps): React.JSX.Element {
  const { t } = useI18n();
  const panelRef = useRef<HTMLDivElement>(null);
  const [confirming, setConfirming] = useState(false);
  const [showPrioritySubmenu, setShowPrioritySubmenu] = useState(false);
  const [showProjectSubmenu, setShowProjectSubmenu] = useState(false);
  const [showTagsSubmenu, setShowTagsSubmenu] = useState(false);
  /**
   * 「新建标签」那格草稿（`null` = 没展开）。它不是"顺手加个输入框"：
   * 一旦展开，菜单的键盘归属就要让给它 —— 见下面 `nestedOpen` 那一格。
   */
  const [tagDraft, setTagDraft] = useState<string | null>(null);
  const tagDraftRef = useRef<HTMLInputElement | null>(null);

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

  /**
   * 草稿**刚展开**时把焦点交进去：用户刚点的就是那一行，不该再让他多按一次 Tab。
   *
   * 🔴 依赖必须是"草稿开没开"这一个布尔，不是 `tagDraft` 本身：按一个字就改一次值 ⇒
   * 每次按键都重新 `focus()` ⇒ 浏览器把聚焦的元素**滚进视野** ⇒ 触发下面那条
   * `scroll` 监听 ⇒ 整层菜单被关掉。症状是"名字打不进去，按第一个字母菜单就没了"
   * （浏览器腿 ⑧ 量到的就是这条链）。
   */
  const draftOpen = tagDraft !== null;
  useEffect(() => {
    if (!draftOpen) return;
    tagDraftRef.current?.focus();
  }, [draftOpen]);

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
    nestedOpen: tagDraft !== null,
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

      {/*
        置顶 / 取消置顶（B5，2026-11-04 滴答对齐）。
        🔴 这一格**不是新功能**：字段（`Task.pinnedAt`）、动作（`TaskActions.setPinned`）、
        出口排序（`byPinnedFirst` 只作用于同分组内，ADR-0083 §3.2）、移动端的菜单项
        （`TasksScreen.tsx`）全都早就在 —— Web 上缺的只有这一枚按钮。
        ⚠️ 但浏览器腿量出来**展示**那一半当时也是缺的：行序走的是领域的
        `sortTasks`，它当时不看 `pinnedAt`，所以点了之后字段写了、行不动。
        那一档补在 `packages/domain/src/task-order.ts`（唯一那份），不在这里补。
        文案与图标跟着**当前状态**换（置顶过的那条再点一次是取消），当前态由宿主
        用领域层 `isPinned()` 算好传进来，本层不读 `pinnedAt` 选文案。
      */}
      {onSetPinned ? (
        <button
          type="button"
          role="menuitem"
          tabIndex={-1}
          className="ht-row-menu__item"
          data-testid="task-row-menu-pin"
          onClick={() => {
            onSetPinned(taskId, !pinned);
            onClose();
          }}
        >
          {pinned ? (
            <PinOff size={ICON_SIZE.sm} className="ht-row-menu__icon" />
          ) : (
            <Pin size={ICON_SIZE.sm} className="ht-row-menu__icon" />
          )}
          {t(pinned ? 'web.rowMenu.unpin' : 'web.rowMenu.pin')}
        </button>
      ) : null}

      {/* 优先级子菜单 */}
      {onSetPriority && (
        <div className="ht-row-menu__submenu-trigger">
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className="ht-row-menu__item ht-row-menu__item--has-submenu"
            data-testid="task-row-menu-priority"
            aria-haspopup="menu"
            aria-expanded={showPrioritySubmenu}
            onClick={() => {
              setShowPrioritySubmenu(!showPrioritySubmenu);
              setShowProjectSubmenu(false);
              setShowTagsSubmenu(false);
            }}
          >
            <Flag size={ICON_SIZE.sm} className="ht-row-menu__icon" />
            {t('web.rowMenu.priority')}
          </button>
          {showPrioritySubmenu && (
            <div className="ht-row-menu__submenu" role="menu">
              {([Priority.None, Priority.High, Priority.Medium, Priority.Low] as Priority[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  className={`ht-row-menu__item ${currentPriority === p ? 'ht-row-menu__item--active' : ''}`}
                  data-testid={`task-row-menu-priority-${String(p)}`}
                  onClick={() => {
                    onSetPriority(taskId, p);
                    onClose();
                  }}
                >
                  <Flag
                    size={ICON_SIZE.sm}
                    className="ht-row-menu__icon"
                    style={{
                      color:
                        p === Priority.High
                          ? 'var(--ht-color-priority-high)'
                          : p === Priority.Medium
                          ? 'var(--ht-color-priority-medium)'
                          : p === Priority.Low
                          ? 'var(--ht-color-priority-low)'
                          : 'var(--ht-color-foreground-subtle)',
                    }}
                  />
                  {t(p === Priority.None ? 'mobile.priority.none' : p === Priority.High ? 'mobile.priority.high' : p === Priority.Medium ? 'mobile.priority.medium' : 'mobile.priority.low')}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 移动到子菜单 */}
      {onMoveToProject && projects && projects.length > 0 && (
        <div className="ht-row-menu__submenu-trigger">
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className="ht-row-menu__item ht-row-menu__item--has-submenu"
            data-testid="task-row-menu-move"
            aria-haspopup="menu"
            aria-expanded={showProjectSubmenu}
            onClick={() => {
              setShowProjectSubmenu(!showProjectSubmenu);
              setShowPrioritySubmenu(false);
              setShowTagsSubmenu(false);
            }}
          >
            <FolderOpen size={ICON_SIZE.sm} className="ht-row-menu__icon" />
            {t('web.rowMenu.moveTo')}
          </button>
          {showProjectSubmenu && (
            <div className="ht-row-menu__submenu" role="menu">
              {/* 收集箱（无清单） */}
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                className={`ht-row-menu__item ${!currentProjectId ? 'ht-row-menu__item--active' : ''}`}
                data-testid="task-row-menu-project-inbox"
                onClick={() => {
                  onMoveToProject(taskId, undefined);
                  onClose();
                }}
              >
                <FolderOpen size={ICON_SIZE.sm} className="ht-row-menu__icon" />
                {t('web.rowMenu.inbox')}
              </button>
              {projects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  className={`ht-row-menu__item ${currentProjectId === project.id ? 'ht-row-menu__item--active' : ''}`}
                  data-testid={`task-row-menu-project-${project.id}`}
                  onClick={() => {
                    onMoveToProject(taskId, project.id);
                    onClose();
                  }}
                >
                  <FolderOpen size={ICON_SIZE.sm} className="ht-row-menu__icon" />
                  {project.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* B2: 添加子任务 */}
      {onAddSubtask && (
        <button
          type="button"
          role="menuitem"
          tabIndex={-1}
          className="ht-row-menu__item"
          data-testid="task-row-menu-add-subtask"
          onClick={() => {
            onAddSubtask(taskId);
            onClose();
          }}
        >
          <ListPlus size={ICON_SIZE.sm} className="ht-row-menu__icon" />
          {t('web.rowMenu.addSubtask')}
        </button>
      )}

      {/*
        B3: 标签子菜单。
        🔴 这一行的渲染条件**不是"有标签才画"**：原文承诺的是"显示已有标签 **+ 新建**"，
        而"一条标签都还没有"恰恰是最需要新建的那一刻 —— 上一版按 `tags.length > 0` 整行收掉，
        结果是新用户从行菜单里**永远建不出第一条标签**（浏览器腿 ⑧ 量到的）。
        现在按"有得挑，或有得建"来判：两者都没有才不画（那才是按下去没反应的一行）。
      */}
      {onSetTags && ((tags?.length ?? 0) > 0 || onCreateTag !== undefined) && (
        <div className="ht-row-menu__submenu-trigger">
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className="ht-row-menu__item ht-row-menu__item--has-submenu"
            data-testid="task-row-menu-tags"
            aria-haspopup="menu"
            aria-expanded={showTagsSubmenu}
            onClick={() => {
              setShowTagsSubmenu(!showTagsSubmenu);
              setShowPrioritySubmenu(false);
              setShowProjectSubmenu(false);
            }}
          >
            <Tag size={ICON_SIZE.sm} className="ht-row-menu__icon" />
            {t('web.rowMenu.tags')}
          </button>
          {showTagsSubmenu && (
            <div className="ht-row-menu__submenu" role="menu">
              {(tags ?? []).map((tag) => {
                const isSelected = currentTagIds?.includes(tag.id) ?? false;
                return (
                  <button
                    key={tag.id}
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    className={`ht-row-menu__item ${isSelected ? 'ht-row-menu__item--active' : ''}`}
                    data-testid={`task-row-menu-tag-${tag.id}`}
                    aria-pressed={isSelected}
                    onClick={() => {
                      const next = isSelected
                        ? (currentTagIds ?? []).filter((id) => id !== tag.id)
                        : [...(currentTagIds ?? []), tag.id];
                      onSetTags(taskId, next);
                      // 不关闭主菜单，让用户可以连续选多个标签
                    }}
                  >
                    <Tag size={ICON_SIZE.sm} className="ht-row-menu__icon" />
                    {tag.name}
                  </button>
                );
              })}

              {/*
                新建（B3 的另一半）。草稿态与"列表 + 一行入口"在同一格里换，
                不弹第二层：这一格已经在 `document.body` 的浮层里了。
                空名不给提交（`disabled` + `submit` 里再挡一次：回车那条路绕得过 disabled）。
              */}
              {onCreateTag ? (
                tagDraft === null ? (
                  <button
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    className="ht-row-menu__item ht-row-menu__item--create"
                    data-testid="task-row-menu-new-tag"
                    onClick={() => {
                      setTagDraft('');
                    }}
                  >
                    <Plus size={ICON_SIZE.sm} className="ht-row-menu__icon" />
                    {t('web.tags.addNew')}
                  </button>
                ) : (
                  <form
                    className="ht-row-menu__create"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const name = tagDraft.trim();
                      if (name === '' || onCreateTag === undefined) return;
                      void onCreateTag(name).then((created) => {
                        if (created === undefined) return;
                        onSetTags?.(taskId, [...(currentTagIds ?? []), created]);
                        setTagDraft(null);
                        onClose();
                      });
                    }}
                  >
                    <input
                      ref={tagDraftRef}
                      className="ht-input ht-row-menu__create-input"
                      type="text"
                      value={tagDraft}
                      aria-label={t('web.tags.newLabel')}
                      placeholder={t('web.tags.newPlaceholder')}
                      data-testid="task-row-menu-new-tag-input"
                      onChange={(event) => {
                        setTagDraft(event.target.value);
                      }}
                      onKeyDown={(event) => {
                        /*
                         * 🔴 草稿态的 Esc：**退掉草稿，菜单留着**（一次 Esc 只退一层）。
                         * 上一版这里什么都没有 —— 共享层因为 `nestedOpen` 为真把整把键盘
                         * 让给了草稿，而草稿自己又不接，于是 Esc 成了**死键**：
                         * 用户改主意按 Esc，屏幕上什么都没发生（菜单和输入框都还在原地）。
                         * `stopPropagation` 是防"以后有人把这层的 Esc 又接到宿主上"时两层各退一次。
                         */
                        if (event.key === 'Escape') {
                          event.stopPropagation();
                          setTagDraft(null);
                        }
                      }}
                    />
                    <button
                      type="submit"
                      className="ht-row-menu__item ht-row-menu__create-submit"
                      data-testid="task-row-menu-new-tag-submit"
                      disabled={tagDraft.trim() === ''}
                    >
                      {t('web.categories.create.tag.submit')}
                    </button>
                  </form>
                )
              ) : null}
            </div>
          )}
        </div>
      )}

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
