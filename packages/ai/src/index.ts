/**
 * @heyta/ai
 *
 * AI 能力对外的**唯一**端口。
 *
 * 三层职责，逐层收窄：
 *
 *   1. `supply.ts`  —— 供给模式与出境目的地。**由端点推导目的地，不由模式声明。**
 *      它的两条腿各在自己文件里：`endpoint-address.ts`（地址**类别**，纯字面量、
 *      绝不解析域名）与 `managed-endpoints.ts`（托管档的**境内白名单**）。
 *      🔴 两样都是"唯一一份判断"，消费者不许再写第二遍（ADR-0056）。
 *   2. `egress.ts`  —— 出境闸门。授权绑定在 `(功能, 目的地)` 上，目的地一变就失效。
 *   3. `provider.ts` —— OpenAI 兼容调用。**只产出建议，类型上无法产出 op。**
 *   4. `routing.ts`  —— 配置路由：多端点、能力→端点映射、回退、熔断。
 *      🔴 **回退不得跨越隐私边界**（见该文件顶部，这是与通用 AI 网关的根本区别）。
 *
 * ## 这个包刻意不做的事
 *
 * - **不写 op、不碰 op-log。** AI 是输入法不是业务逻辑（ADR-0005 §3.1）。
 * - **不含任何业务格式的解析。** 模型返回的自由文本由调用方解释，
 *   因为这个包不该知道"任务"长什么样。
 * - **不含厂商 SDK。** 零运行时依赖，只走 OpenAI 兼容 HTTP 契约。
 * - **不决定凭据存哪。** 那是壳的事，且必须进系统钥匙串（ADR-0005 §3.2.1）。
 *   路由层因此只持有 `keyRef`，**从不持有密钥字面量**。
 * - **不做相对日期的计算。** 🔴 这条是真实实测换来的：
 *   同一天、同一句「明天下午三点开周会」，规则内核算出 `2026-09-27`，
 *   而真实模型给出 `2026-05-08` —— **错了约 4 个半月**。
 *   模型没有"今天"的概念，让它算"明天"等于让它猜。
 *   凡能用规则算准的，一律不交给模型（ADR-0005「LLM 做得最少」）。
 *
 * ## 当前状态
 *
 * 🟢 `managed`（heyta 托管）**可以启用了**，条件是端点落在境内白名单上
 * （`managed-endpoints.ts`，ADR-0056 §3.3）。挡了它很久的"保留策略未定案"
 * 已由 [ADR-0054](../../../docs/adr/0054-managed-ai-retention-and-selling-preconditions.md)
 * 定案：正文不保留、元数据 45 天，天数是 `supply.ts` 里的两个常量，
 * 结构化披露与对外文本都从那里出 —— **没有第二份数字**。
 * ⚠️ 仍未闭合的是"到期删除"那一半：45 天之后的删除作业还没部署（ADR-0054 §8），
 * 所以对外只说"保留期定为 45 天"，不说"到期自动删除"。
 * 自备端点（`own`）不受影响。
 */

export {
  AiConfigError,
  MANAGED_AI_CONTENT_RETENTION_DAYS,
  MANAGED_AI_METADATA_RETENTION_DAYS,
  assertEnableable,
  classifyDestination,
  describeDestination,
  describeRetention,
  destinationDisclosure,
  requiresEgressConsent,
  retentionDisclosure,
  type AiSupplyMode,
  type DestinationDisclosure,
  type EgressDestination,
  type RetentionDisclosure,
} from './supply.js';

// 端点地址的**类别**（ADR-0056 §3.1）。`isLoopbackEndpoint` 是兼容名，
// 它现在只是 `isLoopbackAddress` 的别名 —— 判定只有一份，在 `endpoint-address.ts`。
export {
  classifyEndpointAddress,
  describeEndpointAddress,
  isLoopbackAddress,
  isLoopbackEndpoint,
  type AddressDecider,
  type EndpointAddressCategory,
  type EndpointAddressClass,
  type UnknownAddressReason,
} from './endpoint-address.js';

// 托管路径的**境内白名单**（ADR-0056 §3.3）。表是"境内"的唯一事实源，
// 而它的形状由 `scripts/check-ai-coverage.mjs` 第 8 段在运行时对账。
export {
  MANAGED_MODEL_HOSTS,
  describeManagedModelHosts,
  isDomesticManagedEndpoint,
  managedEndpointVerdict,
  managedEndpointVerdictAgainst,
  type ManagedEndpointRejection,
  type ManagedEndpointVerdict,
  type ManagedJurisdiction,
  type ManagedModelHost,
} from './managed-endpoints.js';

export {
  diagnoseNetworkFailure,
  originToWhitelist,
  type NetworkFailureDiagnosis,
  type NetworkFailureSignal,
} from './diagnose.js';

export {
  authorizeEgress,
  buildDisclosure,
  retainValidConsents,
  type AiFeature,
  type EgressConsent,
  type EgressDecision,
  type EgressDisclosure,
  type EgressRequest,
} from './egress.js';

export {
  EGRESS_ORDER_NOTE,
  createProvider,
  extractContent,
  extractToolCalls,
  previewDisclosure,
  type AiFailure,
  type AiFailureReason,
  type AiInvocation,
  type AiProvider,
  type AiProviderConfig,
  type AiResult,
  type AiSuggestion,
  type AiToolCall,
  type AiToolDescriptor,
  type ProviderDeps,
} from './provider.js';

// 🔴 三个硬上界的家在这里（出境层），不在循环那一层 —— 理由见文件头：
// 它们约束的是"离开设备的东西"，与谁在驱动循环无关；放进调用方就等于各家一套。
// ⚠️ 只导出**类型**，不导出 `buildChatRequestBody` 那组函数：线格式是包内接缝，
// 导出组装器就等于邀请包外再拼一份请求体（工单 W7 刚删掉过两份）。
// 但 `AiInvocation.messages` 的类型在包外必须能写，所以类型单独放行。
export type { ChatMessage } from './wire.js';
// 只有**测量**函数放行（它不返回请求体，见 `wire.ts` 的注释）。
export { egressBytesFor } from './wire.js';

export {
  MAX_ASSISTANT_EGRESS_BYTES,
  MAX_ASSISTANT_MESSAGES,
  MAX_ASSISTANT_TOOL_STEPS,
  assistantLimitLabel,
  exceedsEgressBudget,
  utf8ByteLength,
  type AssistantLimit,
} from './assistant-limits.js';

export {
  AI_ENDPOINT_PRESETS,
  findPreset,
  presetDestinations,
  type AiEndpointPreset,
} from './presets.js';

export {
  DEFAULT_FEATURE_CAPABILITIES,
  DEFAULT_ROUTING_POLICY,
  EMPTY_HEALTH,
  EMPTY_SECRET_STORE,
  countsAsEndpointFailure,
  describeRouteIntent,
  endpointCapabilities,
  invokeRouted,
  isAvailable,
  recordOutcome,
  requiredCapabilities,
  resolveRoute,
  shouldTryNextEndpoint,
  validateEndpointUrl,
  type AiCapability,
  type AiEndpointConfig,
  type AiRouteTarget,
  type AiRoutingConfig,
  type AiRoutingPolicy,
  type CandidateExclusion,
  type CandidateExclusionReason,
  type EndpointHealth,
  type EndpointUrlVerdict,
  type HealthMap,
  type ResolvedCandidate,
  type RouteAttempt,
  type RouteResolution,
  type RoutedDeps,
  type RoutedOutcome,
  type SecretStore,
} from './routing.js';

export {
  FAILURE_MEMORY_MS,
  HEALTH_SNAPSHOT_VERSION,
  MAX_CIRCUIT_MS,
  MAX_LAST_ERROR_LENGTH,
  describeEndpointHealth,
  endpointHealthDisclosure,
  fromHealthSnapshot,
  toHealthSnapshot,
  type AiHealthSnapshot,
  type EndpointHealthDisclosure,
  type PersistedEndpointHealth,
} from './health-store.js';
