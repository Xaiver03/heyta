/**
 * 侧栏右边缘的拖拽手柄（设备本地偏好）
 * ======================================
 *
 * 出处：产品负责人 2026-09-30「侧边栏那个应该是可以自由的去拖拽的，
 * 就是拖拽那个侧边栏宽度的，然后自适应」。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 宽度落在 `:root` 的 `--ht-sidebar-width` 上，不是 React state 传给 `App.tsx`
 *
 * 真正被消费的只有一条：`app.css` 里
 * `.ht-app--with-sidebar { grid-template-columns: … clamp(…) … }`。
 * 把值写在 `:root` 上有两个理由：
 *
 *   1. 拖拽期间每帧都要变。走 state 就得让 `App.tsx` 重渲染 —— 而它下面是
 *      **整个应用**（任务列表、日历、统计）。这里是把一个自定义属性写到一个
 *      DOM 节点上，代价与 React 无关。
 *   2. 手柄与网格列是**两棵树**（手柄在 `<nav>` 里，列在 `.ht-app` 上）。
 *      为了传一个数字去跨两层 props，不值。
 *
 * CSS 自定义属性是继承的 ⇒ 挂在 `:root` 上，`.ht-app` 一定读得到。
 * 同一个位置已经挂着 `<html data-theme>`（`lib/theme.ts`），不是新发明。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 设备本地，**不进 op-log**
 *
 * 与功能模块开关（`features/shell/modules.ts`）、截止时间显示方式
 * （`features/tasks/due-display-pref.ts`）同一条推理：「这台设备上侧栏多宽」
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
 * 改边界去改 `--ht-layout-sidebar-min-width` / `--ht-layout-sidebar-max-width`，
 * 两边都会跟着动 —— 这正是它们存在理由。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '@heyta/i18n';

const STORAGE_KEY = 'heyta.sidebarWidth';
const CSS_VAR = '--ht-sidebar-width';

/** 只在 `:root` 上写这一个属性；`null` = 交回默认值（删掉覆盖）。 */
function applyWidth(px: number | null): void {
  const style = document.documentElement.style;
  if (px === null) style.removeProperty(CSS_VAR);
  else style.setProperty(CSS_VAR, `${px}px`);
}

/** 隐私模式下 `localStorage` **访问本身**会抛（与 `lib/theme.ts` 同一契约）。 */
function readStored(): number | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

function writeStored(px: number | null): void {
  try {
    if (px === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, String(px));
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

function bounds(): { min: number; max: number } | null {
  const min = tokenPx('--ht-layout-sidebar-min-width');
  const max = tokenPx('--ht-layout-sidebar-max-width');
  if (min === null || max === null || max <= min) return null;
  return { min, max };
}

export function SidebarResizer() {
  const { t } = useI18n();
  const handle = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; start: number } | null>(null);

  // 挂载时把设备上存的那一份交出去（首屏就要是对的，不能等用户再拖一次）。
  useEffect(() => {
    const stored = readStored();
    const box = bounds();
    const next = stored !== null && box !== null ? Math.min(Math.max(stored, box.min), box.max) : stored;
    setWidth(next);
    applyWidth(next);
  }, []);

  useEffect(() => {
    applyWidth(width);
  }, [width]);

  const commit = useCallback((px: number | null) => {
    setWidth(px);
    writeStored(px);
  }, []);

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    // 起点宽度取**实测**的那一列，而不是 state —— 首次拖时 state 还是 `null`
    // （默认值由 token 决定），拿 0 当下手会让侧栏瞬间弹走。
    const column = handle.current?.parentElement?.getBoundingClientRect().width;
    if (column === undefined || column === 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, start: column };
    setDragging(true);
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (drag.current === null) return;
    const next = drag.current.start + (event.clientX - drag.current.x);
    const box = bounds();
    // 🔴 手柄只能**往右**拖（它在侧栏右边缘）：往左拖 = 变窄。
    setWidth(box === null ? Math.round(next) : Math.round(Math.min(Math.max(next, box.min), box.max)));
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (drag.current === null) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    drag.current = null;
    setDragging(false);
    commit(width);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const box = bounds();
    const current = width ?? handle.current?.parentElement?.getBoundingClientRect().width ?? 0;
    if (current === 0) return;
    // 步长从"当前宽度"推导，不写死一个 16 —— 与 §7 第 2 条元规则一致。
    const step = Math.max(1, Math.round(current * 0.05));
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const next = current + (event.key === 'ArrowRight' ? step : -step);
      commit(box === null ? Math.round(next) : Math.round(Math.min(Math.max(next, box.min), box.max)));
    } else if (event.key === 'Home') {
      // 回到设计系统的默认值（双击同一条路）。
      event.preventDefault();
      commit(null);
    }
  }

  const box = bounds();
  const announced = width ?? handle.current?.parentElement?.getBoundingClientRect().width;

  return (
    <div
      ref={handle}
      className={`ht-sidebar__resizer${dragging ? ' ht-sidebar__resizer--dragging' : ''}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={t('web.shell.sidebar.resize')}
      tabIndex={0}
      aria-valuenow={announced !== undefined ? Math.round(announced) : undefined}
      aria-valuemin={box !== undefined && box !== null ? Math.round(box.min) : undefined}
      aria-valuemax={box !== undefined && box !== null ? Math.round(box.max) : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => {
        commit(null);
      }}
      onKeyDown={onKeyDown}
    />
  );
}
