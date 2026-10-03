/**
 * `@heyta/ui` 里**不依赖 `react-native` 运行时**的那一半。
 * ==================================================================
 *
 * ## 为什么要单独一个入口
 *
 * 主入口 `@heyta/ui` 的 `theme.tsx` 在运行时 `import { AccessibilityInfo, useColorScheme }
 * from 'react-native'`，所以**任何**从主入口的运行时 import 都会把 RN 拖进来。
 * 后果分两种，都真实存在：
 *
 * · `apps/mobile` 的测试跑在 node 里，而本仓**刻意不 mock `react-native`**
 *   （`tests/widget-bridge.spec.ts` 文件头写着理由：node 里加载它直接失败，
 *    而"没有 RN"本身就是被测的那条降级路径）。mock 它就把那条判据测的东西换掉了。
 * · 纯函数（版面、折行、措辞映射）是**最该被真跑**的一层 ——
 *   只因为它们的邻居 import 了 RN 就测不到，等于把判据的覆盖率让给目录结构。
 *
 * 所以边界按"要不要 RN 运行时"切，不按"像不像组件"切。
 * `packages/design-system` 的 `./native` 子路径是同一个做法，本包沿用同一套约定。
 *
 * ## 这一条线上只许出现什么
 *
 * **只有**不 `import 'react-native'` 的模块。加了带 RN 的文件进来，
 * `scripts/check-card-export.mjs` 会红（它 import 这个入口并断言 node 里可加载）。
 */

export {
  buildCardExportLayout,
  cardExportFileName,
  cardExportFileStem,
  estimateAdvance,
  wrapCardText,
  type CardExportDrawOp,
  type CardExportLayout,
  type CardExportRequest,
  type CardExportTheme,
  type TextMeasurer,
} from './countdown/card-export-layout.js';
export {
  COUNTDOWN_FILTERS,
  cardTextsFor,
  countdownFace,
  filterEventCards,
  toEventCards,
  toEventRows,
  type CountdownFace,
  type CountdownFilter,
  type CountdownView,
  type EventCard,
  type EventCardTextLabels,
  type EventCardTexts,
} from './countdown/model.js';
export { categorySlotToken, type CategoryColorToken } from './categories/model.js';
// `CategorySlot` 的真身在 `@heyta/domain`；`categories/model.ts` 只是 import 它，
// 没有 re-export ⇒ 从这里 re-export 会报 TS2459，得直接说出处。
export type { CategorySlot } from '@heyta/domain';
