/**
 * 菜单（`role="menu"`）的键盘判断 —— 全局 UX 线 P5
 * =================================================
 *
 * ## 为什么要有这一份
 *
 * 立项现量（2026-10-28，`grep -rn 'role="menu"' apps/web/src`）：全仓三枚自绘菜单，
 * 键盘行为**三种答案**：
 *
 *   1. `apps/web/src/features/shell/AccountMenu.tsx` —— 唯一一套完整的：
 *      Esc 关并把焦点还给触发者、Tab 走人即收、上下环绕、Home/End 跳两端；
 *   2. `apps/web/src/features/shell/RailNavigation.tsx` 的 More 菜单 —— **只接 Escape**，
 *      方向键进去没反应（用户从键盘进了菜单就出不来，只能再按一次 Esc）；
 *   3. `apps/web/src/features/habits/HabitsView.tsx` 的 More 菜单 —— **一条都没有**：
 *      没有 `onKeyDown`、菜单项没写 `tabIndex={-1}`、焦点既不进入也不归还，
 *      按 Esc 焦点还留在那枚 `role="menuitem"` 上而菜单照旧开着。
 *
 * 三枚菜单**长得一样**（同一个 `ht-*__menu` 形状、同样的一列 `role="menuitem"`），
 * 所以用户按下去的同一枚键得到三种结果 —— 这正是本线要消灭的形状：
 * 视觉相同的控件必须有相同的键盘模型。
 *
 * ## 这里放判断、不放渲染
 *
 * 与 `control/states.ts` 同一个分工：这一份只回答"**这枚键该发生什么**"，
 * 不碰 DOM、不认识 `document`、不知道焦点在不在。各端拿这个答案去做自己那一半
 * （Web 调 `.focus()` / 关面板；移动端今天还没有自绘菜单，将来直接复用同一份判断）。
 *
 * 🔴 判据的形状是"输入一枚键 + 当前状态 → 一个动作"，所以它可以被**穷举**测：
 * 见 `packages/ui/tests/control-menu.spec.ts`。穷举的意义在于——
 * 三处复制事件处理时，"Home 在最后一项按下去该回哪"这种格子只有一处答对过，
 * 而答错的那两处**没有任何测试会红**。
 *
 * ## 与 `apps/web/src/lib/tab-roving.ts` 的分工
 *
 * 那一枚管 `role="tablist"`（漫游焦点、**不**环绕到面板内、Home/End 走两端标签）；
 * 这一枚管 `role="menu"`（环绕、Esc 是**关掉**而不是"回到触发者"、Tab 是**离开即收起**）。
 * 两者形状不同不是重复：把菜单并进 tablist 那把尺会得到"按 Esc 关不掉菜单"这种红。
 */

/** 一次按键该发生的动作。各端只许照这个执行，不许自己再解释一遍按键。 */
export type MenuAction =
  | {
      readonly kind: 'focus';
      /** 目标项下标（已由本模块算好环绕/夹取，调用方不许再算一次）。 */
      readonly index: number;
    }
  | {
      readonly kind: 'close';
      /**
       * 关掉之后焦点要不要还给触发者。
       *
       * 🔴 两格是**相反**的，而且都是对的：Esc 是"我没选，回到我来的地方"⇒ 还；
       * Tab 是"我要去下一枚控件"⇒ 不还（还了就把用户刚走的那一步拽回来）。
       * 这一格以前只有 AccountMenu 答对过。
       */
      readonly refocusTrigger: boolean;
    }
  | { readonly kind: 'activate'; readonly index: number }
  | { readonly kind: 'ignore' };

export interface MenuKeyInput {
  /** `KeyboardEvent.key` 原文（本模块只认列出来的那几个，其余一律 `ignore`）。 */
  readonly key: string;
  /** 与 `labels` 同序的项数。0 项是合法输入（菜单刚打开、项被过滤空）。 */
  readonly itemCount: number;
  /** 当前有焦点的项下标；**没有一项有焦点时传 -1**（不是 0）。 */
  readonly activeIndex: number;
  /** 各菜单项的可见文案，按渲染顺序。类型查找（typeahead）用它。 */
  readonly labels: readonly string[];
  /**
   * 已敲的类型查找前缀（调用方负责计时与清空，本模块只按它查）。
   * 不传＝这一枚键不参与类型查找。
   */
  readonly typed?: string;
  /**
   * 这一层之上有嵌套的模态（对话框/确认层）开着。
   *
   * 🔴 判据「嵌套 dialog 不抢外层焦点组」就落在这格：为真时**整把键盘都让出去**
   * （连 Esc 都 `ignore`）—— 外层菜单若在那一刻也处理 Esc，一次按键会同时
   * 关掉对话框与它自己，用户看到的后果是"我按了一下，两层都没了"。
   */
  readonly nestedOpen?: boolean;
  /** 带 Ctrl/Alt/Meta 的组合键：菜单一律不吃（那是宿主与浏览器的那一格）。 */
  readonly withModifier?: boolean;
}

/** 打开菜单时焦点该落在哪一项（ARIA menu-button：第一项，而不是触发者留着不动）。 */
export const MENU_FOCUS_INDEX_ON_OPEN = 0;

/** 空菜单（`itemCount === 0`）时"没有一项"的表达 —— 与 `activeIndex` 的 -1 同一格。 */
export const MENU_NO_ACTIVE_INDEX = -1;

function isPrintableChar(key: string): boolean {
  return key.length === 1;
}

/**
 * 类型查找：从 `activeIndex` 之后开始找**第一个**以该前缀开头的项，找不到再从头绕。
 *
 * ⚠️ 比较前把两侧空白去掉并按大小写无关比 —— 菜单文案常带前导空格（图标位缩进），
 * 而用户敲的是看得见的第一个字。
 */
function typeaheadIndex(labels: readonly string[], typed: string, activeIndex: number): number {
  const prefix = typed.trim().toLocaleLowerCase();
  if (prefix === '') return MENU_NO_ACTIVE_INDEX;
  const matches = (label: string): boolean => label.trim().toLocaleLowerCase().startsWith(prefix);
  for (let offset = 1; offset <= labels.length; offset += 1) {
    const candidate = (Math.max(activeIndex, MENU_NO_ACTIVE_INDEX) + offset) % labels.length;
    if (matches(labels[candidate] ?? '')) return candidate;
  }
  return MENU_NO_ACTIVE_INDEX;
}

const IGNORE: MenuAction = { kind: 'ignore' };

/**
 * 一枚键 + 当前状态 → 该发生的动作。
 *
 * 纯函数：不读 DOM、不管计时、不碰焦点。所有边界都在这里答完，
 * 所以各端**没有**再解释一次的余地。
 */
export function menuActionOf(input: MenuKeyInput): MenuAction {
  const { key, itemCount, activeIndex, labels, typed, nestedOpen = false, withModifier = false } = input;

  // 嵌套层开着 ⇒ 整把键盘让出去（含 Esc，见 `nestedOpen` 那格的注释）。
  if (nestedOpen) return IGNORE;
  // 组合键不是菜单的格子。⌘F / Ctrl+W 这类被菜单吃掉是**夺命**级别的错。
  if (withModifier) return IGNORE;

  switch (key) {
    case 'Escape':
      return { kind: 'close', refocusTrigger: true };
    case 'Tab':
      // 菜单不是对话框：Tab 走人就该收起（留着"看不见还开着"的菜单是最坏状态）。
      return { kind: 'close', refocusTrigger: false };
    case 'Enter':
    case ' ':
      return activeIndex === MENU_NO_ACTIVE_INDEX ? IGNORE : { kind: 'activate', index: activeIndex };
    case 'Home':
      return itemCount === 0 ? IGNORE : { kind: 'focus', index: 0 };
    case 'End':
      return itemCount === 0 ? IGNORE : { kind: 'focus', index: itemCount - 1 };
    case 'ArrowDown':
    case 'ArrowRight':
      return itemCount === 0 ? IGNORE : { kind: 'focus', index: stepFrom(activeIndex, 1, itemCount) };
    case 'ArrowUp':
    case 'ArrowLeft':
      return itemCount === 0 ? IGNORE : { kind: 'focus', index: stepFrom(activeIndex, -1, itemCount) };
    default: {
      if (!isPrintableChar(key)) return IGNORE;
      if (itemCount === 0 || typed === undefined) return IGNORE;
      const found = typeaheadIndex(labels, typed, activeIndex);
      return found === MENU_NO_ACTIVE_INDEX ? IGNORE : { kind: 'focus', index: found };
    }
  }
}

/**
 * 环绕的一步。
 *
 * 🔴 `activeIndex === -1`（刚打开、还没有项有焦点）时两个方向**不对称**，
 * 这一格是 AccountMenu 里唯一一处值得抄的判断：
 *   · 向下 ⇒ 第一项（用户想"往下走"，从顶上开始）；
 *   · 向上 ⇒ 最后一项（从底部开始，而不是"什么也没发生"）。
 * 写成 `(-1 + 1 + n) % n` 会把向上那一下送到第一项 —— 图上读起来就是"方向键反了"。
 */
function stepFrom(activeIndex: number, delta: 1 | -1, itemCount: number): number {
  const base = activeIndex === MENU_NO_ACTIVE_INDEX ? (delta === 1 ? -1 : 0) : activeIndex;
  return (base + delta + itemCount) % itemCount;
}
