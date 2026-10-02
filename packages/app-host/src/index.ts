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
  openOpLogStore,
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
  FOCUS_LOG_FAILURE_CODES,
  focusLogFailureCode,
  type FocusActions,
  type FocusActionsOptions,
  type FocusLogFailureCode,
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
 * 提醒动作（B1-1 的写路径）。
 *
 * 🔴 `apps/*` 里**不得出现 `entityType: 'REMINDER'` 的字面量** —— 出现就说明
 * 宿主在自己拼 op（同 `no-op-construction-in-apps` 规则，见 AGENTS.md §3.5）。
 * 到期判定在 `@heyta/domain` 的 `reminders.ts`，这里只负责把它变成 op。
 */
export {
  createReminderActions,
  reminderId,
  rescheduleRemindersForRepeat,
  type NewReminderFields,
  type ReminderActions,
  type ReminderActionsOptions,
} from './reminder-actions.js';

/**
 * 便签动作（幻觉 #12「笔记模块」的写路径）。
 *
 * 🔴 `apps/*` 里**不得出现 `entityType: 'NOTE'` 的字面量** —— 出现就说明
 * 宿主在自己拼 op（同 `no-op-construction-in-apps` 规则，见 AGENTS.md §3.5）。
 * 排序 / 归属 / 摘要全在 `@heyta/domain` 的 `notes.ts`，这里只负责把它变成 op。
 *
 * ⚠️ 与任务上的 `note` 字段**不是同一个东西**：那是任务正文（估时会往里写，
 * 见 `duration-note.ts`），这是独立的一条记录（可不挂项目、可钉到「今天」、
 * 任务删掉它还在）。理由写在 `packages/domain/src/notes.ts` 的文件头上。
 */
export {
  createNoteActions,
  type NewNoteFields,
  type NoteActions,
  type NoteActionsOptions,
} from './note-actions.js';

/**
 * 同步接线。**所有宿主共用这一份** —— 见 `sync-wiring.ts` 文件头：
 * 它此前在 `packages/app-host` 与 `apps/web` 里各有一份，连注释都是复制的。
 *
 * 🔴 `apps/*` 里**不得出现 `new SyncClient(`**。宿主能决定的只有
 * 地址、令牌、口令、网络实现，以及"应用远端后要不要通知 UI"。
 */
export {
  createHostRealtimeClient,
  createSyncClient,
  type RealtimeWiringOptions,
  type SyncWiringOptions,
} from './sync-wiring.js';

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
 * 运营管理后台的数据访问（ADR-0038）。**宿主无关**地放在这里，
 * 与权益探测同一条口径（AGENTS.md §3.5：`apps/*` 只留平台差异）。
 *
 * 🔴 这里**不做**权限判断 —— 401/403 只是呈现层的事实，
 * 真正的授权在 `server/src/admin/admin.middleware.ts`。
 */
export {
  ADMIN_API_PREFIX,
  adminForceUserLogout,
  adminSetUserQuota,
  adminUnlockUser,
  fetchAdminCoupons,
  fetchAdminInvites,
  fetchAdminOrders,
  fetchAdminOverview,
  fetchAdminSubscriptions,
  fetchAdminUser,
  fetchAdminUsers,
  type AdminClientOptions,
  type AdminCouponRow,
  type AdminFailureReason,
  type AdminInvites,
  type AdminOrderRow,
  type AdminOverview,
  type AdminPage,
  type AdminResult,
  type AdminSubscriptionRow,
  type AdminUserDetail,
  type AdminUserRow,
} from './admin-client.js';

/**
 * 通知中心 / 活动（福利中心）的读取。**所有宿主共用这一份** ——
 * 见 `inbox.ts` 文件头：三个请求都不携带任何用户内容（E2EE 硬约束），
 * 并且都 fail-open（读不到 ≠ 没有通知）。
 */
export {
  ACTIVITY_PATH,
  NOTIFICATIONS_PATH,
  NOTIFICATIONS_READ_PATH,
  fetchAccountNotifications,
  fetchActivityFeed,
  markNotificationsRead,
  type AccountNotificationItem,
  type ActivityReading,
  type CampaignItem,
  type InboxReading,
  type InboxRequestOptions,
  type InboxUnavailableCause,
  type InviteActivity,
  type ReferralItem,
  type WriteOutcome,
} from './inbox.js';

/**
 * 服务端认证客户端。**所有宿主共用这一份** —— 见 `hosted-auth.ts` 文件头：
 * 服务端早就有完整认证，而此前**没有任何客户端调用它**（用户只能在同步设置里
 * 手填令牌，没人告诉他令牌从哪来）。
 *
 * 🔴 协议语义（哪个路径、发什么字段、凭据在响应体里不是 cookie、
 * 失败如何归类）一律在 `packages/app-host`，`apps/*` 只负责
 * 「用什么网络实现」和「把通行密钥 options 交给平台的人机接口」。
 *
 * ⚠️ 邮箱 + 口令那六条（`registerWithEmailPassword` / `loginWithEmailPassword` /
 * `requestPasswordReset` / `resetPasswordWithToken` / `changePassword` /
 * `setInitialPassword`）在这一版
 * 才补上导出：函数与契约测在 W5 就写完了，但**包外一个调用方都没有** ——
 * 症状正是本仓库反复记过的那类"功能做完了、用户做不到"。
 */
export {
  HOSTED_AUTH_PATHS,
  HOSTED_PASSKEY_NAME_MAX_LENGTH,
  beginPasskeyEnrollment,
  beginPasskeyLogin,
  beginPasskeyRegistration,
  changePassword,
  completePasskeyEnrollment,
  completePasskeyLogin,
  completePasskeyRecovery,
  completePasskeyRegistration,
  confirmLegalConsent,
  deletePasskey,
  extractAuthLinkToken,
  getLegalConsentStatus,
  getPasskeyRecoveryOptions,
  LEGAL_CONSENT_REASONS,
  listPasskeys,
  loginWithEmailPassword,
  parseLegalConsentStatus,
  passkeyDeletePath,
  passkeyPath,
  registerWithEmailPassword,
  registerWithMagicLink,
  renamePasskey,
  requestMagicLink,
  requestPasskeyRecovery,
  requestPasswordReset,
  resetPasswordWithToken,
  setInitialPassword,
  updateAccountLocale,
  verifyEmailAddress,
  verifyMagicLink,
  type HostedAuthFailure,
  type HostedAuthFailureReason,
  type HostedAuthLocale,
  type HostedAuthOptions,
  type HostedAuthOutcome,
  type HostedAuthSession,
  type HostedPasskeyCredential,
  type HostedPasskeyOptions,
  type HostedPasskeySummary,
  type HostedPasswordPolicyCode,
  type LegalConsentReason,
  type LegalConsentStatus,
} from './hosted-auth.js';

/**
 * 账号级"重新确认"闸门（G-27）。
 *
 * 🔴 与链 5 那道设备级闸**串联、不合并**：判据不同、事实源不同、失败方向也不同
 * （详见 `legal-recheck.ts` 文件头那张对照表）。宿主只许用
 * `dataEgressAllowed()` 这一处判断"数据现在能不能出门"，不许在壳里再判一遍 `phase` ——
 * 漏掉 `checking` 就是"改版后每次冷启动先推一次再拦"，而那正是这道闸存在的理由。
 */
export {
  createLegalRecheckGate,
  type LegalRecheckGate,
  type LegalRecheckPhase,
  type LegalRecheckPorts,
  type LegalRecheckView,
} from './legal-recheck.js';

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
  DEFAULT_TOOL_SELECTION_RULES,
  findCatalogTool,
  resolveToolSelection,
  type ResolveToolSelectionOptions,
  type ToolArgs,
  type ToolCandidate,
  type ToolSelection,
  type ToolSelectionContext,
  type ToolSelectionNoneReason,
  type ToolSelectionRule,
} from './ai-tool-selection.js';
export {
  confirmAiToolProposal,
  grantedToolNames,
  runAiTool,
  runSelectedTool,
  type AiToolProposal,
  type AiToolRunOutcome,
  type AiToolRunnerDeps,
} from './ai-tool-run.js';
export {
  MAX_TOOL_CALL_TEXT_LENGTH,
  TOOL_CALL_EGRESS_FIELDS,
  buildToolCallInvocation,
  parseToolArguments,
  requestToolCall,
  toToolDescriptors,
  type ParsedToolArguments,
  type RequestToolCallDeps,
  type ToolCallFailureReason,
  type ToolCallOutcome,
  type ToolCallSource,
} from './ai-tool-call.js';
export {
  readDurationFromNote,
  removeDurationFromNote,
  renderDurationLine,
  writeDurationIntoNote,
} from './duration-note.js';
export {
  deriveTaskTimePosition,
  planTimelineBlock,
  planTimelineRow,
  planTimelineRows,
  type TimelineTaskLike,
} from './timeline-plan.js';
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

/**
 * 导入 / 还原（**导出自由的另一半**）。
 *
 * 🔴 本轮**只做「还原到空库」**，不做「合并到已有数据的库」——
 * 理由（id 冲突、时钟/顺序、本地是否更新版本）见 `import-dump.ts` 文件头。
 * 还原**绝不**清空或覆盖现有数据：目标非空直接拒绝，且在写之前就拒绝。
 */
export {
  parseExportDocument,
  restoreIntoEmptyTarget,
  stateMatchesDocument,
  type ExportImportFailureReason,
  type ImportTarget,
  type ParseExportResult,
  type RestoreExportResult,
} from './import-dump.js';

/**
 * 小组件意图的落地（`widget-core/intents.ts` → 真正的 op）。
 *
 * 🔴 这一组导出是 `packages/widget-core` **在类型上产生不了 op** 那条红线的另一半：
 * 组件写意图，`widget-core` 负责合并与分类，**只有这里**把意图变成 op。
 *
 * 这条边界由 `scripts/check-widgets.mjs` 反向钉住：
 * `packages/widget-core` 不得 import `@heyta/app-host`（否则就绕回来了）。
 */
export {
  drainWidgetIntents,
  type WidgetDrainResult,
  type WidgetDrainTasks,
} from './widget-actions.js';

/**
 * 滴答清单导入：**导入计划 → op 批次**的构造器。
 *
 * `packages/domain` 产出纯数据的 `TickTickImportPlan` + `TickTickImportReport`；
 * 这个文件把它按引用完整性排好序、翻成 op、派发进 op-log，并把报告**原样**
 * 交回调用方。顺序 / 幂等 / 引用校验都单点定义在那里 —— 见文件头。
 *
 * 🔴 `apps/*` 里**不得**自己把计划拼成 op，也不得把"先建清单再建任务"
 * 的次序写第二遍 —— 出现就说明宿主在重造产品语义（AGENTS.md §3.5）。
 * 这条由 `pnpm check:layering` 的 `no-op-construction-in-apps` 规则钉住
 * （`entityType: 'TASK' | 'PROJECT' | 'TAG'` 字面量）。
 */
export {
  TICKTICK_IMPORT_ORDER,
  createTickTickImportActions,
  planTickTickImportBatch,
  tickTickTaskPayload,
  type TickTickImportActions,
  type TickTickImportBatch,
  type TickTickImportBatchEntry,
  type TickTickImportCounts,
  type TickTickImportKind,
  type TickTickImportResult,
} from './ticktick-import-actions.js';

/**
 * 条款链接的分流（链 2）。**宿主无关**：用户连的是哪台服务端，就该看到那台
 * 服务端发布的规则 —— 这是协议知识，不是界面知识（AGENTS.md §3.5）。
 */
export {
  LEGAL_SITE_PATHS,
  OFFICIAL_SITE_ORIGIN,
  OPERATOR_LEGAL_PATHS,
  resolveLegalLinks,
  type LegalLinks,
} from './legal-links.js';

/**
 * 隐私同意闸门（链 5，计划里的 **G-11 / G-12**）。
 *
 * 🔴 「同意之前不得发起任何请求」是**产品语义**而不是平台差异，所以判定住在这里：
 * 四个壳只能注入自己的存储端口（`localStorage` / op-sqlite / 内存）并把
 * {@link createConsentGatedFetch} 套在自己的 `fetchImpl` 上。
 * 宿主里出现"没同意也照发"的判断，就是把这条合规前提交回给约定 ——
 * 而约定挡不住"新加一个调用点忘了传"。
 */
export {
  PRIVACY_CONSENT_BLOCKED_MARKER,
  PRIVACY_CONSENT_KEY,
  PRIVACY_DECISIONS,
  PrivacyConsentBlockedError,
  UNAVAILABLE_PRIVACY_CONSENT_PORT,
  createConsentGatedFetch,
  createPrivacyConsentGate,
  formatPrivacyDecisionTime,
  parsePrivacyConsent,
  privacyNetworkAllowed,
  serializePrivacyConsent,
  type PrivacyConsentGate,
  type PrivacyConsentPort,
  type PrivacyConsentReadout,
  type PrivacyConsentRecord,
  type PrivacyDecision,
} from './privacy-consent.js';
