/**
 * 底部面板的可拖区域（纯判据，宿主无关）
 * ======================================
 *
 * 和 `sheet-detents.ts`、`dismissal.ts` 同一个形状：**一张表 + 一个函数**，
 * 组件里不许内联比较区域名 —— 判据问两次就有两种问法，第二种通常是错的
 * （`docs/agents/overlay-feedback.md` §3 同一条纪律）。
 *
 * ## 为什么是"把手 + 标题栏"，不是"整块面板"
 *
 * 对标的那块面板是**头部整条都能拽**：用户不需要瞄准一条 5px 的把手，
 * 按住标题往上往下都是拖。所以这里加的是 `header`。
 *
 * 🔴 而**内容区一寸都不接**：面板里是 `ScrollView`，本仓没有引 gesture-handler
 * （`BottomSheet.tsx` 文件头取舍第 1 条），没有原生滚动协调时
 * "内容滚到顶再往下拖才收起"做不对。做一半的那个形状是
 * **"想滚却把面板关了"** —— 比没有更糟，所以 `body` 明确不在表里。
 * 这一格什么时候该翻案：引入了 gesture-handler 并且过了 §3.1/§3.2 两道门
 * （可维护性 + 许可证），那时才谈滚动协调。
 *
 * ⚠️ `closeButton` 同样不在表里，理由不是几何而是**事件**：× 是宿主唯一的
 * 具名出口，父层在 move 阶段抢走 responder 会让它变成"点了没反应"。
 * 所以 `BottomSheet` 的结构是"标题栏里可拖的那一段"包标题，× 留在拖拽段之外。
 */

/** 面板上被点名的一块区域。 */
export type SheetDragRegion = 'handle' | 'header' | 'closeButton' | 'body';

/**
 * 能发起拖拽的区域。
 *
 * 🔴 表里没有 `body` / `closeButton`：加进去之前先回答上面那两条，别顺手补全。
 */
export const SHEET_DRAG_REGIONS = ['handle', 'header'] as const satisfies readonly SheetDragRegion[];

/** 这一块区域该不该接拖拽手势。 */
export function isSheetDragRegion(region: SheetDragRegion): boolean {
  return (SHEET_DRAG_REGIONS as readonly SheetDragRegion[]).includes(region);
}
