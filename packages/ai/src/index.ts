/**
 * @heyta/ai
 *
 * AI 能力对外的**唯一**端口。
 *
 * 三层职责，逐层收窄：
 *
 *   1. `supply.ts`  —— 供给模式与出境目的地。**由端点推导目的地，不由模式声明。**
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
 * ⚠️ `managed`（heyta 托管）**暂时无法启用** —— 它的数据保留策略尚未定案，
 * 而 `supply.ts` 拒绝编造一个数字，`assertEnableable` 因而会抛错。
 * 这是**刻意的失败**，见 [ADR-0006](../../../docs/adr/0006-supply-modes.md) §5。
 * 自备端点（`own`）不受影响，是当前可用路径。
 */

export {
  AiConfigError,
  assertEnableable,
  classifyDestination,
  describeDestination,
  describeRetention,
  destinationDisclosure,
  isLoopbackEndpoint,
  requiresEgressConsent,
  retentionDisclosure,
  type AiSupplyMode,
  type DestinationDisclosure,
  type EgressDestination,
  type RetentionDisclosure,
} from './supply.js';

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
