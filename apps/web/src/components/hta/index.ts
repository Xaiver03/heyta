/**
 * 共享 web 组件壳（`apps/web/src/components/hta`）—— 纯 DOM React + 现有共享类/token。
 *
 * 设计口径：
 *   · 能复用的就薄包一层现有件：`.ht-btn*`、`FormField`、`EmptyState/ErrorState/Skeleton`、
 *     `WebModalShell`、`AnchoredMenu`；
 *   · **交互底座用 Radix Primitives**（`@radix-ui/react-*`，15 个包，MIT、支持 React 19、
 *     持续维护 —— 过 hard-constraints §3.1/§3.2 两道门）。Radix 负责行为与无障碍
 *     （焦点陷阱、roving tabindex、aria 关系、Portal 层叠），**不带样式**；
 *     视觉仍由本目录 `hta.css` 消费 `--ht-*` token，状态选择用 Radix 的 `data-state`。
 *     清单：Switch / Checkbox / RadioGroup / Tabs / Tooltip / Popover 已改到 Radix 上。
 *   · 不新建 package；色调与判断从 `@heyta/ui` 取（`ControlTone` 等），组件里不复制配方。
 */

export { Button, type ButtonProps, type ButtonSize, type ButtonTone } from './Button.js';
export { IconButton, type IconButtonProps } from './IconButton.js';
export { Badge, type BadgeProps, type BadgeTone } from './Badge.js';
export { Select, type SelectOption, type SelectProps } from './Select.js';
export { Checkbox, type CheckboxProps } from './Checkbox.js';
export { Switch, type SwitchProps } from './Switch.js';
export { RadioGroup, type RadioGroupOption, type RadioGroupProps } from './RadioGroup.js';
export { Tabs, type TabItem, type TabsProps } from './Tabs.js';
export { Spinner, type SpinnerProps, type SpinnerSize } from './Spinner.js';
export { InlineFeedback, type FeedbackTone, type InlineFeedbackProps } from './InlineFeedback.js';
export { Toast, type ToastProps } from './Toast.js';
export { StatCard, MetricGrid, type StatCardProps, type MetricGridProps, type StatTone } from './StatCard.js';
export { ListState, type ListStateError, type ListStateProps } from './ListState.js';
export { SideSheet, type SideSheetProps } from './SideSheet.js';
export {
  DataTable,
  type DataTableColumn,
  type DataTableProps,
  type DataTableSelection,
  type DataTableSort,
  type SortDirection,
} from './DataTable.js';
export { Pager, type PagerLabels, type PagerProps } from './Pager.js';
export { FilterBar, type FilterBarProps } from './FilterBar.js';
export { Tooltip, type TooltipProps } from './Tooltip.js';
export { Popover, type PopoverProps } from './Popover.js';
