/**
 * `@heyta/app-host`
 * ===================
 *
 * 宿主无关的应用接线与写入动作。ADR-0003 §2.1 的**唯一实现处**：
 *
 *   - `openAppHost()`       —— 把平台 SQLite 驱动接到 op-log 引擎与同步客户端
 *   - `createTaskActions()`     —— 任务 op 的构造
 *   - `createProjectActions()`  —— 清单 / 标签 op 的构造
 *   - `createHabitActions()`    —— 习惯 / 打卡 op 的构造
 *   - `createFocusActions()`    —— 专注记录 op 的构造
 *   - `randomId()` / `newTaskId()` —— 带 RN 安全回退的标识符生成
 *
 * 宿主（`apps/*`）应当**只**提供三样东西：驱动工厂、库路径、同步参数。
 * 任何"这个平台要怎么建任务"的代码出现在 `apps/` 里，都是分层的失败。
 */

export {
  openAppHost,
  resolveClientId,
  materializedState,
  type AppHost,
  type AppHostOptions,
  type SyncConfig,
} from './host.js';

export {
  createTaskActions,
  type ActionContext,
  type TaskActions,
  type NewTaskFields,
} from './actions.js';

/**
 * 专注动作。与任务动作同一个理由：**op 的构造只有一份**（AGENTS.md §3.5）。
 *
 * 🔴 `apps/*` 里**不得出现 `entityType: 'FOCUS_SESSION'` 的字面量** ——
 * 出现就说明宿主在自己拼 op。
 */
export {
  createFocusActions,
  type FocusActions,
  type FocusActionsOptions,
} from './focus-actions.js';

/**
 * 清单 / 标签 / 习惯动作。同一理由：**op 的构造只有一份**（AGENTS.md §3.5）。
 *
 * 🔴 `apps/*` 里**不得出现 `entityType: 'PROJECT' | 'TAG' | 'HABIT' | 'HABIT_LOG'`
 * 的字面量** —— 出现就说明宿主在自己拼 op。这条由 `pnpm check:layering` 的
 * `no-op-construction-in-apps` 规则钉住（它上线时一次抓出了 17 处真实违规）。
 */
export {
  createProjectActions,
  type ProjectActions,
  type ProjectActionsOptions,
} from './project-actions.js';

export {
  createHabitActions,
  habitLogId,
  type HabitActions,
  type HabitActionsOptions,
  type NewHabitFields,
} from './habit-actions.js';

/**
 * 同步接线。**所有宿主共用这一份** —— 见 `sync-wiring.ts` 文件头：
 * 它此前在 `packages/app-host` 与 `apps/web` 里各有一份，连注释都是复制的。
 *
 * 🔴 `apps/*` 里**不得出现 `new SyncClient(`**。宿主能决定的只有
 * 地址、令牌、口令、网络实现，以及"应用远端后要不要通知 UI"。
 */
export { createSyncClient, type SyncWiringOptions } from './sync-wiring.js';

export { newTaskId, randomId, usingRandomIdFallback } from './ids.js';

/**
 * 权益探测。**所有宿主共用这一份** —— 见 `entitlement.ts` 文件头：
 * 它是一次**不携带任何任务内容**的 GET（E2EE 硬约束：计费只碰账户与权益状态）。
 * 判定本身是 `@heyta/domain` 的纯函数，这里只负责发请求。
 */
export {
  HOSTED_ENTITLEMENT_PATH,
  fetchHostedEntitlementReading,
  type HostedEntitlementProbeOptions,
} from './entitlement.js';

/**
 * 服务端认证客户端。**所有宿主共用这一份** —— 见 `hosted-auth.ts` 文件头：
 * 服务端早就有完整认证，而此前**没有任何客户端调用它**（用户只能在同步设置里
 * 手填令牌，没人告诉他令牌从哪来）。
 *
 * 🔴 协议语义（哪个路径、发什么字段、凭据在响应体里不是 cookie、
 * 失败如何归类）一律在 `packages/app-host`，`apps/*` 只负责
 * 「用什么网络实现」和「把通行密钥 options 交给平台的人机接口」。
 */
export {
  HOSTED_AUTH_PATHS,
  beginPasskeyLogin,
  beginPasskeyRegistration,
  completePasskeyLogin,
  completePasskeyRecovery,
  completePasskeyRegistration,
  extractAuthLinkToken,
  getPasskeyRecoveryOptions,
  registerWithMagicLink,
  requestMagicLink,
  requestPasskeyRecovery,
  verifyEmailAddress,
  verifyMagicLink,
  type HostedAuthFailure,
  type HostedAuthFailureReason,
  type HostedAuthOptions,
  type HostedAuthOutcome,
  type HostedAuthSession,
  type HostedPasskeyCredential,
  type HostedPasskeyOptions,
} from './hosted-auth.js';

/**
 * 重复规则的预设。**"每周"到底是哪一天是产品语义**，所以在这里而不在界面里
 * （判据见 §3.5："这段代码里有没有一行在决定业务上该怎么做？"）。
 * 界面只负责选 id 与显示文字。
 */
export {
  REPEAT_PRESET_IDS,
  repeatPresetRule,
  type RepeatPresetId,
} from './repeat-presets.js';

export {
  createLocalApiHost,
  fromLocalDateString,
  taskToItem,
  toLocalDateString,
  type LocalApiHostOptions,
} from './local-api-host.js';

export {
  MAX_BREAKDOWN_ITEMS,
  MAX_ITEM_LENGTH,
  buildBreakdownInvocation,
  manualChecklistSkeleton,
  mergeChecklistIntoNote,
  parseBreakdownItems,
  renderChecklist,
  requestBreakdown,
  type BreakdownFailureReason,
  type BreakdownOutcome,
  type BreakdownProposal,
  type BreakdownSource,
  type RequestBreakdownDeps,
} from './ai-breakdown.js';
export {
  createAiFeedbackActions,
  createPreferenceCorrectionActions,
  type AiFeedbackActions,
  type AiFeedbackInput,
  type PreferenceCorrectionActions,
} from './ai-feedback-actions.js';
export {
  MAX_PRIORITIZE_TASKS,
  MAX_REASON_LENGTH,
  PRIORITIZE_PRIORITY_VALUES,
  buildPrioritizeInvocation,
  parsePrioritizeResult,
  requestPrioritize,
  type PrioritizeDecision,
  type PrioritizeFailureReason,
  type PrioritizeOutcome,
  type PrioritizeProposal,
  type PrioritizeSource,
  type PrioritizeSuggestion,
  type PrioritizeTaskInput,
  type RequestPrioritizeDeps,
} from './ai-prioritize.js';
export {
  MAX_DURATION_MINUTES,
  MAX_HISTORY_ROWS,
  MIN_DURATION_MINUTES,
  buildDurationInvocation,
  clampDurationMinutes,
  countUsableDurationHistory,
  parseDurationMinutes,
  parseDurationResult,
  requestDuration,
  selectDurationHistory,
  type DurationEstimate,
  type DurationFailureReason,
  type DurationHistoryRow,
  type DurationOutcome,
  type DurationProposal,
  type DurationSource,
  type RequestDurationDeps,
} from './ai-duration.js';
export {
  MAX_CAPTURE_INPUT_LENGTH,
  MAX_CAPTURE_RESPONSE_LENGTH,
  MAX_CAPTURE_TITLE_LENGTH,
  buildCaptureInvocation,
  parseCaptureResult,
  requestCapture,
  type CaptureFailureReason,
  type CaptureField,
  type CaptureOutcome,
  type CaptureProposal,
  type CaptureSource,
  type ParsedCaptureResult,
  type RequestCaptureDeps,
} from './ai-capture.js';
export {
  readDurationFromNote,
  removeDurationFromNote,
  renderDurationLine,
  writeDurationIntoNote,
} from './duration-note.js';
export {
  aliveRecords,
  categoryReportFromState,
  categoryReportFromTables,
  type CategoryTables,
} from './category-report.js';

/**
 * 激励体系：物化状态 → 领域输入（`category-report.ts` 的同形状第二次）。
 *
 * 两个宿主（Web / 移动端）画的是同一批数字，所以"摊平 + 滤墓碑 + 注入 now"
 * 只有这一份实现。领域算法仍全在 `@heyta/domain`。
 */
export {
  DEFAULT_ACTIVITY_DAYS,
  activityTotalsFromState,
  bestCurrentStreak,
  dailyActivityCountsFromState,
  habitGrowth,
  habitGrowthFromState,
  identityTagsFromState,
  milestonesFromState,
  todayProgressFromState,
  weeklyReviewFromState,
  type DailyActivityCount,
  type HabitGrowthRow,
  type MotivationTables,
} from './motivation.js';

/**
 * 导出（**导出自由**，README 设计原则第 5 条）。
 *
 * 🔴 导出的**内容形状**是产品语义，所以它在这里而不在 `apps/*` ——
 * 理由见 `export-dump.ts` 文件头。宿主只负责把状态、op-log、时间戳递进来，
 * 以及把结果写进文件/触发下载。
 */
export {
  EXPORT_APP_NAME,
  EXPORT_FORMAT_VERSION,
  buildExportDocument,
  buildTaskExportRows,
  exportDocumentFromHost,
  exportFileName,
  renderTasksMarkdown,
  serializeExportDocument,
  type BuildExportOptions,
  type ExportCounts,
  type ExportDocument,
  type ExportEntityCount,
  type ExportFormat,
  type ExportTaskRow,
  type TasksMarkdownCopy,
} from './export-dump.js';
