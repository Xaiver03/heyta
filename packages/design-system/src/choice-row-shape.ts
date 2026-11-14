/**
 * 单选行的**形状契约**（从 N 个里选 1 个）
 * =========================================
 *
 * 🔴 **这个文件只登记"一行用哪些 token"，不引入任何新取值。**
 *
 * ## 为什么需要它（2026-11-14 的实测事故）
 *
 * 「视图选项」这一张面板里，**同一个语义（选 1 个）出现了三种形态**：
 *
 * | 组 | 渲染件 | 实测几何（density 480 / ÷3） |
 * |---|---|---|
 * | 视图 | 圆形 Chip | 48×44dp，文字居中，底色反转 |
 * | 日期显示 | 圆形 Chip | 同上 |
 * | 排序方式 | 通栏 Button（选中换 `tone`） | 353×44dp，文字居中，**选中那一项变成一条蓝底通栏** |
 *
 * 三种形态各自都"合法"（都用了 token、都过 `check:design`），但用户看到的是
 * **一屏里没有一条共用的左缘、没有一档共用的行高、没有一个共用的选中记号**。
 * 产品负责人对着它说的原话是「这么低级的 UX 排版问题」。
 *
 * 根因不是"某个值写错了"，是**没有一个可被引用的行契约**：每一处都在自己组装
 * 行（Chip / Button / 手写 Pressable），而 `check:design` 只问"值是不是 token"，
 * 它看不见"这一组的行和那一组的行不是同一种行"。
 *
 * ## 契约里为什么只有"间距与尺寸"，没有"颜色"
 *
 * 与 `task-row-shape.ts` 同一条边界：颜色属于主题（亮/暗两套），由
 * `useHeytaTokens()` 各自取。写进契约会让"跟随主题"变成"跟随一份快照"。
 *
 * ## 三档间距，不许只有一档
 *
 * 实测当时整张面板**只有一个间距**：`space.2`（8dp）同时充当
 * 组内、组间、标签与控件、控件与说明。屏幕上是这样一句话：
 * 「所有东西离得一样近」⇒ 眼睛读不出分组 ⇒ 用户只能靠字猜层级。
 *
 * 所以这里把三档分开登记：`labelGap`（组标签→行）/ `rowGap`（行→行）/
 * `groupGap`（组→组）。**它们必须是三个不同的值**，由
 * `packages/design-system/tests/choice-row-shape.spec.ts` 钉住。
 *
 * ⚠️ 值的类型由 `satisfies Record<string, TokenName>` 钉住：
 * 写一个不存在的 token 名会**编译不过**。
 */

import type { TokenName } from './tokens.js';
import type { TextStyleName } from './typography.js';

/** 单选行的**空间**几何。每一项都是 `tokens.css` 里真实存在的 token 名。 */
export const CHOICE_ROW_SHAPE = {
  /**
   * 行最小高度。
   *
   * 取触控目标下限（44），**不是** `size.row-min-height`（60）：
   * 60 是任务行（带勾选框 + 副标题 + 换行）的高度，单选行只有一行文字。
   * 用 60 会让 4 个选项吃掉半屏，这正是"每屏都要滚"的来源之一。
   */
  minHeight: 'touch-target.min',
  /** 行内：文字与右侧选中记号之间的间距。 */
  inlineGap: 'space.3',
  /** 组标签 → 组内第一行。**小**：标签属于它下面那一组。 */
  labelGap: 'space.1',
  /** 行 → 行。**0**：同一组是一整块，靠行本身的高度分界，不靠缝。 */
  rowGap: 'space.0',
  /** 组 → 组。**大**：这是屏幕上唯一表达"换了一件事"的手段。 */
  groupGap: 'space.6',
  /** 右侧选中记号的视觉尺寸。 */
  markerSize: 'icon.sm',
  /**
   * 行的左右内边距。
   *
   * **0** —— 行自己不加左右留白，由容器（`screen.gutter`）统一给。
   * 加内边距会让"组标签的左缘"与"行文字的左缘"错开，而
   * `apps/mobile/src/screens/TasksScreen.tsx` 的旧实现正是这样：
   * 标签在 16dp、Chip 在 16dp、通栏按钮在 16dp，但按钮里的**字**在 71dp。
   */
  rowInset: 'space.0',
} as const satisfies Record<string, TokenName>;

/** 单选行里每一段文字用哪条**语义文字样式**（`typography.ts` 的 `TEXT_STYLES`）。 */
export const CHOICE_ROW_TEXT = {
  /** 组标签（「视图」「日期显示」「排序方式」）。 */
  groupLabel: 'group-label',
  /** 行文字。与任务标题同一档：用户在扫读"我要哪一个"。 */
  option: 'row-title',
} as const satisfies Record<string, TextStyleName>;
