/**
 * 锚定菜单（`⋯` 那一枚）—— **全仓唯一一份**
 * =========================================
 *
 * ## 为什么要有这一份
 *
 * 2026-11-02 立项时的现量：任务视图页头平铺着 9 个可交互控件
 * （分享 / 选择任务 / 完成 / 重复警告 / 撤销 / 排序标签 / 排序下拉 / 助手 / 详情开关），
 * 其中"排序"还是 `12px 文字 + 44px 原生 select` 的混合体，而**空的收集箱里它整个消失**
 * （`visible.length > 0` 才渲染）。同一屏四种控制语法，没有一个是"别的功能收在这里"。
 *
 * 而在此之前仓里已经有**三枚**长得一样、键盘模型三套答案的 `role="menu"`
 * （账号菜单 / rail 的 More / 习惯的 More，见 `packages/ui/src/control/menu.ts` 文件头）。
 * 第四枚如果再各写一份，就是把那个问题再放大一次 ——
 * 所以这一份把「门户 + 定位 + 点外面关」接过来，键盘交给既有的
 * `useMenuKeyboard`（它已经管了 Esc / 方向键 / Home-End / 类型查找 / 焦点进入与归还）。
 *
 * ## 三个不变量
 *
 * 1. **键盘判断不在这里**：`menuActionOf`（`@heyta/ui`）决定"这枚键该发生什么"，
 *    `useMenuKeyboard` 执行 DOM 那一半，本文件只负责**几何与生命周期**。
 *    想改按键行为就去改共享判断，不许在这里加一条 `if (key === 'ArrowDown')`。
 * 2. **点外面关，但**不**把焦点抢回触发者**：用户点哪儿焦点就该去哪儿；
 *    把焦点拽回 `⋯` 是"我点了别处，光标却跳回去"那种说不清的错。
 *    Esc 相反 —— 那是"我没选，回到我来的地方"，由 `useMenuKeyboard` 归还。
 * 3. **贴着触发者、被视口夹住、放不下就翻到上方**：这是唯一需要量 DOM 的一格，
 *    所以它必须只有一处实现（原来 rail 那份量了 `nav` 的朝向、这里换成通用锚点）。
 *
 * ## 为什么门户到 `body`
 *
 * 页头与列表栏都是 `overflow` 容器（滚动/裁切），菜单挂在里面会被裁掉半截；
 * 而 `position: fixed` 在带 `transform` 的祖先下会退化成相对该祖先定位。
 * 门户到 `body` 是唯一不依赖祖先样式的前提 —— 代价是必须自己量坐标（本文件）。
 */

import { ICON_SIZE, cssVar } from '@heyta/design-system';
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { useMenuKeyboard } from './useMenuKeyboard.js';

/** 面板与触发者/视口边缘之间留的距离 —— 与 rail 那份同一个取值。 */
const EDGE_GAP_TOKEN = '--ht-space-2';

function tokenPx(name: string): number {
  if (typeof window === 'undefined') return 0;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * 菜单项的关闭出口。
 *
 * 🔴 选完一项**必须**收起来：不收的菜单会让用户以为"点了没生效"而又点一次，
 * 于是同一个动作执行两遍（排序无所谓，删除/完成不是）。所以关闭不放给每个调用点，
 * 由 `MenuItem` 自己接。
 */
const MenuCloseContext = createContext<() => void>(() => {});

export interface AnchoredMenuProps {
  readonly open: boolean;
  /** 关（含 Esc / 点外面 / 选中一项）。调用方只改自己的 `open` 状态。 */
  readonly onClose: () => void;
  readonly triggerRef: Readonly<RefObject<HTMLElement | null>>;
  /** 面板的可访问名（`aria-label`）。菜单没有可见标题时必须有。 */
  readonly label: string;
  /** 贴哪一边：`end` 对齐触发者的右缘（页头右端那种），`start` 对齐左缘。 */
  readonly align?: 'start' | 'end';
  readonly testID?: string;
  readonly children: ReactNode;
}

export function AnchoredMenu({
  open,
  onClose,
  triggerRef,
  label,
  align = 'end',
  testID,
  children,
}: AnchoredMenuProps): React.JSX.Element | null {
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | undefined>(undefined);

  /**
   * 🔴 归还焦点用 `preventScroll`：面板门户在 `body` 上，默认 `.focus()` 会把
   * 页面滚到触发者 —— 用户看到的是"关个菜单页面跳一下"。
   * 这一格是 rail 的 More 在真浏览器里抓出来的，不是理论。
   */
  const onKeyDown = useMenuKeyboard({
    open,
    containerRef: panelRef,
    triggerRef,
    onClose: () => onClose(),
    focusTrigger: (trigger) => (trigger as HTMLElement | null)?.focus({ preventScroll: true }),
    itemSelector: '[role="menuitem"],[role="menuitemradio"]',
  });

  // 定位：量触发者 → 夹进视口 → 放不下就翻上去。窗口尺寸/滚动变化时重量一次。
  useLayoutEffect(() => {
    if (!open) return;
    const update = (): void => {
      const trigger = triggerRef.current;
      const panel = panelRef.current;
      if (trigger === null || panel === null) return;
      const rect = trigger.getBoundingClientRect();
      const gap = tokenPx(EDGE_GAP_TOKEN);
      const edge = tokenPx(EDGE_GAP_TOKEN);

      // 先按"最多能占多大"约束，再量高度 —— 否则长菜单会把 top 算到视口外。
      panel.style.maxInlineSize = `${Math.max(0, window.innerWidth - edge * 2)}px`;
      panel.style.maxBlockSize = `${Math.max(0, window.innerHeight - edge * 2)}px`;
      const size = panel.getBoundingClientRect();

      const below = rect.bottom + gap;
      const fitsBelow = below + size.height <= window.innerHeight - edge;
      const top = fitsBelow ? below : Math.max(edge, rect.top - gap - size.height);
      const preferred = align === 'end' ? rect.right - size.width : rect.left;
      const left = Math.max(edge, Math.min(preferred, window.innerWidth - edge - size.width));
      setPosition({ top, left });
    };
    update();
    window.addEventListener('resize', update);
    document.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      document.removeEventListener('scroll', update, true);
    };
  }, [align, open, triggerRef, children]);

  // 点外面关（不抢焦点，见文件头不变量 2）。
  useLayoutEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (triggerRef.current?.contains(target) === true) return;
      if (panelRef.current?.contains(target) === true) return;
      onClose();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [onClose, open, triggerRef]);

  const closeAfterSelect = useCallback(() => onClose(), [onClose]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={panelRef}
      className="ht-header__menu"
      role="menu"
      aria-label={label}
      data-testid={testID}
      // 测量那一帧之前不画：先算坐标再显示，否则菜单会在错误位置闪一下。
      style={position === undefined ? { visibility: 'hidden' } : { top: position.top, left: position.left }}
      onKeyDown={onKeyDown}
    >
      <MenuCloseContext.Provider value={closeAfterSelect}>{children}</MenuCloseContext.Provider>
    </div>,
    document.body,
  );
}

export interface MenuItemProps {
  readonly onSelect: () => void;
  readonly disabled?: boolean;
  readonly testID?: string;
  /** 单选型菜单项（排序档位那种）。传了就是 `menuitemradio`。 */
  readonly checked?: boolean;
  readonly danger?: boolean;
  readonly icon?: ReactNode;
  readonly children: ReactNode;
}

/**
 * 一枚菜单项。
 *
 * `tabIndex={-1}` 是**必须**的：漫游焦点由 `useMenuKeyboard` 管，
 * 让浏览器把每一项都放进 Tab 序列会让 Tab 变成"逐项走一遍菜单"
 * （那是工具栏，不是菜单）。
 */
export function MenuItem({
  onSelect,
  disabled = false,
  testID,
  checked,
  danger = false,
  icon,
  children,
}: MenuItemProps): React.JSX.Element {
  const close = useContext(MenuCloseContext);
  const isRadio = checked !== undefined;
  return (
    <button
      type="button"
      role={isRadio ? 'menuitemradio' : 'menuitem'}
      aria-checked={isRadio ? checked : undefined}
      tabIndex={-1}
      disabled={disabled}
      data-testid={testID}
      className={`ht-header__menu-item${danger ? ' ht-header__menu-item--danger' : ''}${isRadio ? ' ht-header__menu-item--radio' : ''}`}
      onClick={() => {
        onSelect();
        close();
      }}
    >
      {icon !== undefined ? <span className="ht-header__menu-icon" aria-hidden="true">{icon}</span> : null}
      <span className="ht-header__menu-label">{children}</span>
      {isRadio ? (
        <span className="ht-header__menu-check" aria-hidden="true">
          {checked ? <CheckMark /> : null}
        </span>
      ) : null}
    </button>
  );
}

/** 分组标题（不可聚焦：它是标签，不是动作）。 */
export function MenuSection({ children }: { readonly children: ReactNode }): React.JSX.Element {
  return (
    <div className="ht-header__menu-section ht-type-caption" role="presentation">
      {children}
    </div>
  );
}

export function MenuSeparator(): React.JSX.Element {
  return <div className="ht-header__menu-separator" role="separator" />;
}

/** 勾。内联 SVG 而不是引图标库：一枚 12px 的勾不值得拉一个 chunk。 */
function CheckMark(): React.JSX.Element {
  return (
    <svg
      width={ICON_SIZE.xs}
      height={ICON_SIZE.xs}
      viewBox="0 0 12 12"
      fill="none"
      stroke={cssVar('color.primary')}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2.5 6.5 5 9l4.5-5.5" />
    </svg>
  );
}
