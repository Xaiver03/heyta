/**
 * 任务行的**形状契约**（L1/L2 组合规格）
 * =======================================
 *
 * 🔴 **这个文件只登记"一行用哪些 token"，不引入任何新取值。**
 *
 * 为什么需要它：`TaskRow` 的**几何**（行高、勾选框尺寸/圆角/描边、内间距、间距）
 * 原本只以字面量的形式写在 `packages/ui/src/task-list/TaskList.tsx` 的
 * `StyleSheet.create` 里 —— 那是**唯一一份实现**，但它**不是一个可被引用的契约**。
 *
 * 于是有了一个具体的失效形状（`docs/research/dida-view-unification.md` §4.5）：
 *
 *   `apps/landing/src/mockup/` 手工复刻了同一行。它不可能 import RN 组件
 *   （那会把 `react-native-web` 拖进营销页首屏，实测 **+62 kB gzip / +31%**），
 *   所以它只能**照抄取值** —— 而照抄必然漂移。实测那一次已经漂了两处：
 *
 *   | 位置 | 复刻件（漂移） | 共享行（真值） |
 *   |---|---|---|
 *   | 勾选框 | `--ht-icon-md`（20px）+ `border-radius: full`（圆） | `size.checkbox`（22px）+ `radius.sm`（圆角方） |
 *   | 标题字号 | `--ht-font-size-sm` | 语义样式 `row-title`（`font-size.base`） |
 *
 *   这两处**没有一条门禁看得见**：`check:design` 管"取值是不是 token"
 *   （两个都是 token，都合法），`check:tokens` 管生成物一致，
 *   没有一条在问"复刻件抄的是不是共享行那一组 token"。
 *
 * 有了这个文件之后：
 *   - `packages/ui` 的行**从它取值**（契约是承重的，不是摆设）；
 *   - `apps/landing` 的复刻件**也从它取值**（经 `cssVar()` 落成 CSS 自定义属性）；
 *   - 两边同时改：改契约 → 两边一起变，**不可能只改一边**。
 *
 * ⚠️ 边界：**这里只放"形状"，不放颜色。** 颜色属于主题（`tokens.css` 的
 * 亮/暗两套），由 `useHeytaTokens()` / `var(--ht-*)` 各自取 —— 把颜色写进契约
 * 会让"跟随主题"这件事变成"跟随一份快照"。
 *
 * ⚠️ `TASK_ROW_SHAPE` 的值必须是**已存在的 token 名**：类型上由
 * `satisfies Record<string, TokenName>` 钉住（新增一个不存在的 token 名会编译不过），
 * 值上由 design-system 自己的 `cssVar()` 在运行时抛错（`tokens.css` 缺这个变量时）。
 */

import type { TokenName } from './tokens.js';
import type { TextStyleName } from './typography.js';

/** 一行的**空间**几何。每一项都是 `tokens.css` 里真实存在的 token 名。 */
export const TASK_ROW_SHAPE = {
  /** 行最小高度。 */
  minHeight: 'size.row-min-height',
  /** 行内主要元素之间的间距。 */
  gap: 'space.1',
  /** 列表里**行与行之间**的间距（属于列表容器，与行的内部几何同一处登记）。 */
  listGap: 'space.1',
  /** 勾选框的视觉尺寸（**不是**触控区，见下）。 */
  checkboxSize: 'size.checkbox',
  /** 勾选框圆角。 */
  checkboxRadius: 'radius.sm',
  /** 勾选框描边宽度。 */
  checkboxBorderWidth: 'border-width.thin',
  /**
   * 勾选框的**触控区**下限。
   *
   * 🔴 它比视觉尺寸大，所以共享行用一圈负外边距把它拉回来与屏幕留白对齐
   *（见 `TaskList.tsx` 的 `checkboxHit`）。复刻件没有这一层（展厅不可交互），
   * 但**必须登记在这里**：哪天共享行改了补偿方式，这里的差异要能被看见。
   */
  touchTarget: 'touch-target.min',
  /** 标题行（文字块）的上下内间距。 */
  bodyPaddingBlock: 'space.2',
  /** 标题下方元信息行的间距。 */
  metaGap: 'space.2',
} as const satisfies Record<string, TokenName>;

/** 一行里每一段文字用哪条**语义文字样式**（`typography.ts` 的 `TEXT_STYLES`）。 */
export const TASK_ROW_TEXT = {
  /** 任务标题。全应用最高频的样式。 */
  title: 'row-title',
  /** 截止 / 优先级 / 重复这些次要信息。 */
  meta: 'row-meta',
  /** 勾选框里那个勾的字号。 */
  check: 'badge',
} as const satisfies Record<string, TextStyleName>;
