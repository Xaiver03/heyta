/**
 * `@heyta/widget-core` —— 系统小组件的共享契约。
 *
 * 本包**只做三件事**，且都在 `packages/` 里（不在任何壳里）：
 *
 * 1. **契约**：`v:1` 快照信封 + 明文载荷 + 校验（`contract.ts`）
 * 2. **选择器**：从物化状态投影出四款组件要的数据（`selectors.ts`）
 * 3. **意图队列语义**：组件点击如何合并成一次应用内动作（`intents.ts`）
 *
 * 🔴 与 `@heyta/local-api` 同一条红线：**本包在类型上产生不了 op。**
 * 组件只能写"意图"，意图如何变成 op 由 `@heyta/app-host` 决定 ——
 * 那一条边界不是风格问题，是防止同一份 op 被两条路径构造出两个版本。
 */

export {
  WIDGET_CONTRACT_VERSION,
  WIDGET_ALG,
  WIDGET_MAX_TASKS,
  MAX_EPOCH_MS,
  envelopeAad,
  parseEnvelope,
  parsePayload,
  emptyPayload,
  readSnapshotSafely,
  readSnapshotOrNull,
  sealSnapshot,
} from './contract.js';

export type {
  WidgetEnvelope,
  WidgetTask,
  WidgetHabit,
  WidgetFocus,
  WidgetProjectColor,
  WidgetPayload,
  EnvelopeRejection,
  EnvelopeParseResult,
  PayloadRejection,
  PayloadParseResult,
  SnapshotDecryptor,
  SnapshotSealer,
  SealOptions,
} from './contract.js';

export {
  selectTodayTasks,
  selectQuadrant,
  selectHabits,
  selectFocus,
  selectProjectColors,
  buildWidgetPayload,
} from './selectors.js';

export type { WidgetSelectorInput } from './selectors.js';

export {
  ADAPTIVE_CARD_KINDS,
  ADAPTIVE_CARD_SCHEMA,
  ADAPTIVE_CARD_TEMPLATES,
  ADAPTIVE_CARD_VERSION,
  buildAdaptiveCardData,
  buildAdaptiveCardPlaceholder,
  buildFocusCardData,
  buildFocusCardFallback,
  buildHabitsCardData,
  buildQuadrantCardData,
  buildTodayCardData,
  formatDuration,
  serializeAdaptiveCardTemplates,
} from './adaptive-card.js';

export type {
  AdaptiveCardCommonData,
  AdaptiveCardData,
  AdaptiveCardFocusData,
  AdaptiveCardFocusState,
  AdaptiveCardHabitRow,
  AdaptiveCardHabitsData,
  AdaptiveCardKind,
  AdaptiveCardQuadrantData,
  AdaptiveCardQuadrantSlot,
  AdaptiveCardTaskRow,
  AdaptiveCardTemplate,
  AdaptiveCardTodayData,
  WidgetCardKey,
  WidgetTranslate,
} from './adaptive-card.js';

export {
  WIDGET_INTENT_VERSION,
  WIDGET_INTENT_MAX,
  emptyIntentQueue,
  parseIntentQueue,
  parseIntentQueueJson,
  mergeIntent,
  mergeIntents,
  classifyIntents,
  drainableIntents,
} from './intents.js';

export type {
  WidgetIntent,
  WidgetIntentQueue,
  CurrentDoneLookup,
  IntentClassification,
} from './intents.js';
