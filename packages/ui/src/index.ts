/**
 * `@heyta/ui` —— 四端共用的 UI 组件
 * ==================================
 *
 * 这一层的存在理由只有一条（ADR-0003 §2.1）：**业务与界面逻辑不能在 `apps/<应用>` 里
 * 各写一份。** 每多一个宿主就多一份拷贝，而拷贝之间的漂移不会报错，
 * 只会让"Web 上是对的、Android 上是错的"变成常态。
 *
 * 边界：
 *   - 进得来的：RN 原语写成的展示组件、以及它们依赖的纯逻辑（各目录下的 `model.ts`）。
 *   - 进不来的：任何 `apps/<应用>` 的东西、任何 i18n（会拖进第二份 React）、
 *     任何 DOM 标签、任何裸样式值（`check:design` 会拦）。
 */

export { TaskList, type TaskListProps } from './task-list/TaskList.js';
export {
  sortTasksForDisplay,
  toTaskRow,
  toTaskRows,
  type TaskRow,
  type ToTaskRowOptions,
} from './task-list/model.js';

export {
  HeytaUiProvider,
  resolveHeytaUiTheme,
  useHeytaText,
  useHeytaTokens,
  useHeytaUiTheme,
  type HeytaUiProviderProps,
  type HeytaUiTheme,
} from './theme.js';
