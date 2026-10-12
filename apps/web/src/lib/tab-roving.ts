import type { KeyboardEvent } from 'react';

/**
 * `role="tablist"` 的方向键漫游（APG：一组互斥标签里**只有一枚**进 Tab 序列，
 * 组内用方向键移动，Home/End 到两端）。
 *
 * 🔴 **为什么挂在容器上，而不是逐枚标签各写一份 handler**：
 * rail 的标签在 DOM 里是**两段** —— `role="tablist"` 里的主标签，和它**外面**的工具标签
 * （`RailNavigation.tsx` 的 `visibleToolTabs`）。它们控制同一个主区，是**一个**标签组。
 * 逐枚各写一份会把"这一组是哪些"这个判断写散；容器按 DOM 顺序取 `[role="tab"]`，
 * 两段一起漫游。把 DOM 合成一段会改 rail 的 flex 布局 —— 那是另一刀的半径（要重新截图验收）。
 *
 * 🔴 **漫游只移焦点，不切换视图**。APG 允许"自动激活"，但这里的每一枚标签切的是整个主区
 * （重算数据、可能带副作用），顺着方向键走一遍就等于把六个视图各打开一次。
 * 激活留在 Enter/Space（原生按钮行为）。
 */
export type TabRovingOrientation = 'vertical' | 'horizontal';

/**
 * 属于本组、且当下真的可聚焦的标签。
 *
 * 两层排除各有其事故：
 * - **嵌在容器里的 dialog**：通知铃铛的面板就挂在 rail 的 `<nav>` 子树里，它自己是一对
 *   `role="tab"`。不排掉的话，从 rail 最后一枚按 ArrowDown 会跳进面板里，
 *   而从面板按 ArrowLeft 会跳回 rail —— 两个焦点圈被并成一个。
 *   判据是"那个 dialog **不包含**容器本身"：面板自己的 tablist 处理时，容器就在面板里，
 *   所以它那两枚照样是自己的组。
 */
function groupTabs(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[role="tab"]')).filter((tab) => {
    const dialog = tab.closest('[role="dialog"]');
    return dialog === null || dialog.contains(container);
  });
}

export function onTabRovingKeyDown(
  event: KeyboardEvent<HTMLElement>,
  orientation: TabRovingOrientation,
): void {
  // 别人已经消费掉的按键不抢：rail 的主标签挂着 dnd-kit 的 KeyboardSensor，
  // 它在重排模式下用的是同一组方向键。
  if (event.defaultPrevented) return;
  const target = event.target;
  // 容器里非标签的控件（头像菜单的 `role="menuitem"`、同步条、帮助钮）自己管键盘。
  if (!(target instanceof HTMLElement) || target.getAttribute('role') !== 'tab') return;

  const forward = orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight';
  const backward = orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft';
  const tabs = groupTabs(event.currentTarget);
  const at = tabs.indexOf(target);
  if (at < 0) return;

  let next: HTMLElement | undefined;
  if (event.key === forward) next = tabs[(at + 1) % tabs.length];
  else if (event.key === backward) next = tabs[(at - 1 + tabs.length) % tabs.length];
  else if (event.key === 'Home') next = tabs[0];
  else if (event.key === 'End') next = tabs[tabs.length - 1];
  if (next === undefined) return;

  // 不 preventDefault 的话，ArrowDown 在移焦点的同时还会滚动整页。
  event.preventDefault();
  next.focus();
}

/**
 * 组里唯一进 Tab 序列的那一枚：**选中那枚**；当前视图不属于这一组时用**第一枚**。
 *
 * 🔴 后面那条不是兜底而是承重：rail 在设置/成长这类不落在标签上的视图里，
 * 没有任何一枚是"选中"的 —— 只写 `tabIndex={selected ? 0 : -1}` 会让整组
 * 一个停留点都没有，键盘用户按 Tab 直接越过整个导航。
 */
export function rovingTabKey(orderedKeys: readonly string[], selectedKey: string | null): string | null {
  if (selectedKey !== null && orderedKeys.includes(selectedKey)) return selectedKey;
  return orderedKeys[0] ?? null;
}
