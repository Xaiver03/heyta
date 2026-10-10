/**
 * 列宽的拖拽手柄（设备本地偏好）—— **一份实现，两条列**
 * =====================================================
 *
 * 出处：产品负责人 2026-09-30「侧边栏那个应该是可以自由的去拖拽的，
 * 就是拖拽那个侧栏宽度的，然后自适应」，以及 2026-10-06 第 6 条
 * 「右边那一栏空白的侧边栏，中间那条线应该是可以调整的。侧边栏的宽度都可以自己调整，
 * 通过拖拽来调整」—— 后半句里的"都可以"是要第二枚把手，不是要第二份实现。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 为什么是一份实现 + 两份**必填**参数，而不是两个组件
 *
 * 这份逻辑里每一段都在别处被实测咬过一口（触屏 `touch-action`、起点宽度取实测值、
 * `aria-valuenow` 必须报**真的**数、步长从当前宽推导）。抄第二份 = 让下一轮改动
 * 只落在其中一份上 —— 本仓为这个形状付过的账写在 `AGENTS.md` §3.5 那段"同形状的第二次"。
 *
 * ⚠️ 参数**一律必填、没有默认值**：带默认值的可选 prop 会把"宿主忘了接"伪装成
 * "做完了"（`docs/reference/environment-traps.md` #195）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 宽度落在 `:root` 的自定义属性上，不是 React state 传给 `App.tsx`
 *
 * 真正被消费的只有一条：`app.css`/`base.css` 里那两条 `grid-template-columns`
 * 各自把 `clamp(…)` 拼进轨道。把值写在 `:root` 上有两个理由：
 *
 *   1. 拖拽期间每帧都要变。走 state 就得让 `App.tsx` 重渲染 —— 而它下面是
 *      **整个应用**（任务列表、日历、统计）。这里是把一个自定义属性写到一个
 *      DOM 节点上，代价与 React 无关。
 *   2. 手柄与网格列是**两棵树**（手柄挂在被拖那一列**之外**，见下面那条），
 *      为了传一个数字去跨两层 props，不值。
 *
 * CSS 自定义属性是继承的 ⇒ 挂在 `:root` 上，`.ht-app` 一定读得到。
 * 同一个位置已经挂着 `<html data-theme>`（`lib/theme.ts`），不是新发明。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 手柄**不许住在滚动容器里**（两条列各自的实测）
 *
 *   · 侧栏：`overflow-y: auto` 会把 `overflow-x` 变成 `clip` ⇒ 那枚骑在右边缘外
 *     4px 的命中带**被裁掉一半**，症状是"把手在那儿、拖不动"。所以它留在
 *     `<nav>` 这一层，里面那层 `.ht-sidebar__body` 才是滚动区。
 *   · 详情列：`<aside>` 自己**就是**滚动容器（`base.css` 里那条"一屏封顶 + 内部
 *     滚动"），而往槽里加一层 `<div>` 会被 `check:detail-pane-slot` 的腿 A 判红
 *     （装配处不许手写标记）。所以这一枚挂在 `.ht-main` 的右边缘上 ——
 *     它拖的是右边那一列，不是自己所在的那一列 ⇒ 起点宽度由 `columnSelector`
 *     **现查**，不再拿 `parentElement`（拿父节点在这一点上恰好是错的）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 设备本地，**不进 op-log**
 *
 * 与功能模块开关（`features/shell/modules.ts`）、截止时间显示方式
 * （`features/tasks/due-display-pref.ts`）同一条推理：「这台设备上这一列多宽」
 * 是界面选择，不是用户数据。跨设备同步一个拖出来的像素值没有意义
 * （屏幕不一样，本来就该不一样）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ 边界有几处夹取，分工是刻意的（**不是同一个判断写两遍**）
 *
 *   · **CSS `clamp()`**：唯一决定"屏幕上画多宽"的地方。它同时兜住
 *     "窗口后来变窄了"——不需要监听 `resize`，浏览器每次布局自己重夹。
 *   · **这里的 `clamp()`**：只为了 `aria-valuenow` 报出去的数字**是真的**
 *     （报 900 而画 416 会让读屏在撒谎）。上下限从 token 读，不写死。
 *
 * 改边界去改 `--ht-layout-*-min-width` / `--ht-layout-*-max-width`，
 * 两边都会跟着动 —— 这正是它们存在理由。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n, type MessageKey } from '@heyta/i18n';

/**
 * `'end'` = 手柄在被拖那一列的**右**边缘（往右拖 = 变宽）。
 * `'start'` = 在**左**边缘（往左拖 = 变宽）。
 *
 * 🔴 这不是装饰性的差别：符号搞反的症状是"往宽拖它变窄"，而两条列的把手
 * 长完全一样 —— 只有真拖一下才会发现。判据在
 * `e2e/tests/detail-column-resize.spec.ts`（往左拖必须变宽）。
 */
export type ResizerEdge = 'start' | 'end';

export interface ColumnResizerProps {
  readonly edge: ResizerEdge;
  /** 被拖那一列的选择器。**现查**，不假设"手柄的父节点就是那一列"。 */
  readonly columnSelector: string;
  /** 写进 `:root` 的自定义属性名。 */
  readonly cssVar: string;
  /** 设备本地持久化的键。 */
  readonly storageKey: string;
  readonly minToken: string;
  readonly maxToken: string;
  readonly labelKey: MessageKey;
  /** 类族跟着它所**属于**的那一列走（`ht-sidebar__*` / `ht-app__detail-*`）。 */
  readonly className: string;
}

/** 只在 `:root` 上写这一个属性；`null` = 交回默认值（删掉覆盖）。 */
function applyWidth(cssVar: string, px: number | null): void {
  const style = document.documentElement.style;
  if (px === null) style.removeProperty(cssVar);
  else style.setProperty(cssVar, `${px}px`);
}

/** 隐私模式下 `localStorage` **访问本身**会抛（与 `lib/theme.ts` 同一契约）。 */
function readStored(key: string): number | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

function writeStored(key: string, px: number | null): void {
  try {
    if (px === null) localStorage.removeItem(key);
    else localStorage.setItem(key, String(px));
  } catch {
    // 存不下不影响本次生效。
  }
}

/**
 * 把 `--ht-layout-sidebar-min-width: 12rem` 这样的 token 读成 px。
 * `rem` 的基准是**根字号**，所以这里读它而不是假设 16。
 */
function tokenPx(name: string): number | null {
  const root = document.documentElement;
  const raw = getComputedStyle(root).getPropertyValue(name).trim();
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) return null;
  if (raw.endsWith('rem')) {
    const base = Number.parseFloat(getComputedStyle(root).fontSize);
    return Number.isFinite(base) ? value * base : null;
  }
  return value;
}

function bounds(minToken: string, maxToken: string): { min: number; max: number } | null {
  const min = tokenPx(minToken);
  const max = tokenPx(maxToken);
  if (min === null || max === null || max <= min) return null;
  return { min, max };
}

export function ColumnResizer(props: ColumnResizerProps) {
  const { edge, columnSelector, cssVar, storageKey, minToken, maxToken, labelKey, className } = props;
  const { t } = useI18n();
  const handle = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  /** `width === null`（= 用默认值）时**实际画出来**的那个数，供 `aria-valuenow` 报。 */
  const [reportedWidth, setReportedWidth] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; start: number; previous: number | null; current: number } | null>(null);
  const widthRef = useRef<number | null>(null);
  const keyboardOrigin = useRef<number | null | undefined>(undefined);

  /** 被拖那一列此刻的宽度（`null` = 读不到）。 */
  const columnWidth = (): number | null => {
    const w = document.querySelector<HTMLElement>(columnSelector)?.getBoundingClientRect().width;
    return w === undefined || w === 0 ? null : w;
  };

  // 挂载时把设备上存的那一份交出去（首屏就要是对的，不能等用户再拖一次）。
  useEffect(() => {
    const stored = readStored(storageKey);
    const box = bounds(minToken, maxToken);
    const next = stored !== null && box !== null ? Math.min(Math.max(stored, box.min), box.max) : stored;
    setWidth(next);
    widthRef.current = next;
    applyWidth(cssVar, next);
  }, [cssVar, maxToken, minToken, storageKey]);

  // 🔴 `aria-valuenow` 在**写完自定义属性之后**量一次，而不是在 render 里量：
  // render 时那一帧的布局还是上一个值。症状（H10 第一刀现量）：双击/Home 复位之后
  // 界面画的是 352，而读屏报 351 —— 报的是"上一次那一帧"。
  // 拖拽途中 `width` 本身就是真值（已经夹取过），所以只在归回默认值时补这一次量。
  useEffect(() => {
    applyWidth(cssVar, width);
    if (width === null) setReportedWidth(columnWidth());
  }, [cssVar, width]);

  const commit = useCallback(
    (px: number | null) => {
      setWidth(px);
      widthRef.current = px;
      writeStored(storageKey, px);
    },
    [storageKey],
  );

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    // 起点宽度取**实测**的那一列，而不是 state —— 首次拖时 state 还是 `null`
    // （默认值由 token 决定），拿 0 当下手会让那一列瞬间弹走。
    const column = columnWidth();
    if (column === null) return;
    keyboardOrigin.current = undefined;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, start: column, previous: widthRef.current, current: column };
    setDragging(true);
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (drag.current === null) return;
    // 🔴 方向：手柄在列的**右**边缘时往右拖变宽；在**左**边缘时往左拖变宽。
    const delta = event.clientX - drag.current.x;
    const next = edge === 'end' ? drag.current.start + delta : drag.current.start - delta;
    const box = bounds(minToken, maxToken);
    const clamped = box === null ? Math.round(next) : Math.round(Math.min(Math.max(next, box.min), box.max));
    drag.current.current = clamped;
    setWidth(clamped);
    widthRef.current = clamped;
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (drag.current === null) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const finalWidth = drag.current.current;
    drag.current = null;
    setDragging(false);
    commit(finalWidth);
  }

  function onPointerCancel(event: React.PointerEvent<HTMLDivElement>) {
    if (drag.current === null) return;
    const previous = drag.current.previous;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    drag.current = null;
    setDragging(false);
    commit(previous);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const box = bounds(minToken, maxToken);
    const current = width ?? columnWidth() ?? 0;
    if (current === 0) return;
    // 步长从"当前宽度"推导，不写死一个 16 —— 与 §7 第 2 条元规则一致。
    const step = Math.max(1, Math.round(current * 0.05));
    const growKey = edge === 'end' ? 'ArrowRight' : 'ArrowLeft';
    const shrinkKey = edge === 'end' ? 'ArrowLeft' : 'ArrowRight';
    if (event.key === growKey || event.key === shrinkKey) {
      event.preventDefault();
      if (keyboardOrigin.current === undefined) keyboardOrigin.current = width;
      const next = current + (event.key === growKey ? step : -step);
      commit(box === null ? Math.round(next) : Math.round(Math.min(Math.max(next, box.min), box.max)));
    } else if (event.key === 'Home') {
      // 回到设计系统的默认值（双击同一条路）。
      event.preventDefault();
      commit(null);
      keyboardOrigin.current = undefined;
    } else if (event.key === 'Escape' && keyboardOrigin.current !== undefined) {
      event.preventDefault();
      commit(keyboardOrigin.current);
      keyboardOrigin.current = undefined;
    }
  }

  const box = bounds(minToken, maxToken);
  const announced = width ?? reportedWidth;

  return (
    <div
      ref={handle}
      className={`${className}${dragging ? ` ${className}--dragging` : ''}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={t(labelKey)}
      tabIndex={0}
      aria-valuenow={announced !== null && announced !== undefined ? Math.round(announced) : undefined}
      aria-valuemin={box !== null ? Math.round(box.min) : undefined}
      aria-valuemax={box !== null ? Math.round(box.max) : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onBlur={() => {
        keyboardOrigin.current = undefined;
      }}
      onDoubleClick={() => {
        commit(null);
      }}
      onKeyDown={onKeyDown}
    />
  );
}

/** 范围列（任务页的清单/标签那一列、日历页的日期导航列**共用同一份宽度状态**）。 */
export function SidebarResizer() {
  return (
    <ColumnResizer
      edge="end"
      columnSelector=".ht-sidebar"
      cssVar="--ht-sidebar-width"
      storageKey="heyta.sidebarWidth"
      minToken="--ht-layout-sidebar-min-width"
      maxToken="--ht-layout-sidebar-max-width"
      labelKey="web.shell.sidebar.resize"
      className="ht-sidebar__resizer"
    />
  );
}

/**
 * 详情列（最右那一栏）。
 *
 * 🔴 它挂在 `.ht-main` 的右边缘上，**不在**被拖的那一列里 —— 理由见文件头
 * "手柄不许住在滚动容器里"那一段（详情列自己是滚动容器，而往槽里加一层 `<div>`
 * 会被 `check:detail-pane-slot` 腿 A 判红）。
 */
export function DetailColumnResizer() {
  return (
    <ColumnResizer
      edge="start"
      columnSelector='[data-testid="detail-column"]'
      cssVar="--ht-detail-width"
      storageKey="heyta.detailWidth"
      minToken="--ht-layout-detail-min-width"
      maxToken="--ht-layout-detail-max-width"
      labelKey="web.shell.detail.resize"
      className="ht-app__detail-resizer"
    />
  );
}
