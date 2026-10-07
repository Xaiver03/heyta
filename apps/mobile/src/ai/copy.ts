/**
 * 移动端 AI 面的**词条选择表**
 * ============================
 *
 * 🔴 这里只有 `原因 → 词条 key`，**没有任何句子**。
 * 句子在 `packages/i18n` 的两张表里（中英成对），硬编码由 `check:ui-language` 拦。
 *
 * ## 为什么 key 选在壳里、而不是在 `@heyta/app-host` 里
 *
 * `packages/app-host` **刻意不依赖** `@heyta/i18n`（`ai-output-language.ts` 文件头
 * 写了理由：加那条边会让 packages/ 反向依赖界面词表）。所以"这一次出境失败该说哪句"
 * 的**判断**在 app-host（`cause` 是封闭词表），而**措辞**归壳 —— 与 web 侧
 * `apps/web/src/features/ai/ai-failure-copy.ts` 同一条分工。
 *
 * ## 🔴 为什么复用 `web.ai.*` 那批 key 而不是新造 `mobile.ai.*`
 *
 * 本壳的先例是**屏内文案复用、入口文案新建**（`lib/countdown-display.ts` 复用
 * `web.countdown.*`，`mobile.countdown.entry` 才是本端新增）。
 * 披露、失败诊断、提案动作那些句子说的不是"在这台手机上打开它"，
 * 而是同一件事的同一句解释 —— 另起一份就会得到两条口径
 * （"web 说'留多久未知'、手机说'不保留'"这种跨端矛盾正是隐私话术最要命的样子）。
 *
 * `tests/ai-copy-parity.spec.ts` 把这张表与 web 那份**逐条对账**，
 * 因为两条表各写一遍时，漂移的表现是"某一端的用户在说谎"而不会报错。
 *
 * ## ⚠️ 这里**没有**网络诊断（`origin-likely-rejected` 那一档）
 *
 * web 那一份把 `network` 再分成"端点在你机器上但拒绝了你的来源"与"真的连不上"，
 * 判据需要一个**宿主 Origin**（`host-origin.ts` 读 `window.location`）。
 * RN 没有 Origin 这个概念，原生 `fetch` 也不发 `Origin` 头 ——
 * 所以那一档在本端**到不了**，硬做一个等于是编一条诊断。
 * 这里保留 `web.ai.failure.cause.network` 那一句（"检查它是不是在运行"），
 * 对本端恰好是对的：Android/iOS 上连不上本机端点，最常见的原因就是
 * 服务没跑、或者地址填的是模拟器看不见的 `127.0.0.1`（见 `sync/config.ts` 的 `10.0.2.2`）。
 */

import type {
  AiFailureReason,
  AiFeature,
  EndpointHealthDisclosure,
  RetentionDisclosure,
} from '@heyta/ai';
import type { MessageKey, MessageVars } from '@heyta/i18n';
import type {
  AiNoCandidateReason,
  AssistantFailureReason,
  BreakdownFailureReason,
  CaptureFailureReason,
  DurationFailureReason,
  PrioritizeFailureReason,
  ToolCallFailureReason,
} from '@heyta/app-host';

/** 五个 AI 功能在界面上的名字（封闭词表：少一条编译不过）。 */
export const AI_FEATURE_LABEL_KEY: Record<AiFeature, MessageKey> = {
  capture: 'web.ai.feature.capture',
  breakdown: 'web.ai.feature.breakdown',
  prioritize: 'web.ai.feature.prioritize',
  'duration-estimate': 'web.ai.feature.duration',
  'tool-calling': 'web.ai.feature.toolCalling',
};

/** "这个功能压根没配路由"那一句（与"配了但全被排除"必须分开）。 */
export const AI_NO_TARGET_KEY: Record<AiFeature, MessageKey> = {
  capture: 'web.ai.noTarget.capture',
  breakdown: 'web.ai.noTarget.breakdown',
  prioritize: 'web.ai.noTarget.prioritize',
  'duration-estimate': 'web.ai.noTarget.duration',
  'tool-calling': 'web.ai.noTarget.toolCalling',
};

/** 候选全被排除 → 词条。穷尽 `CandidateExclusionReason` 加两档兜底。 */
export const AI_ROUTE_EXPLAIN_KEY: Record<AiNoCandidateReason, MessageKey> = {
  'remote-not-allowed': 'web.ai.routeExplain.remoteNotAllowed',
  'capability-missing': 'web.ai.routeExplain.capabilityMissing',
  'endpoint-disabled': 'web.ai.routeExplain.endpointDisabled',
  'endpoint-url-rejected': 'web.ai.routeExplain.endpointUrlRejected',
  'circuit-open': 'web.ai.routeExplain.circuitOpen',
  'endpoint-missing': 'web.ai.routeExplain.endpointMissing',
  unconfigured: 'web.ai.routeExplain.unknown',
  unknown: 'web.ai.routeExplain.unknown',
};

/**
 * 保留策略 → 词条 + 插值（判别式穷尽）。
 *
 * 🔴 传的是**整个披露对象**，不是 `kind`：`metadata-only` 那句里有天数，天数必须
 * 从披露对象取（它由 `packages/ai` 的两个常量投影出来）。壳里写死 45 就是第二份
 * 保留期，改了常量之后界面会说谎。与 web 那份 `disclosure-copy.ts` 同一条分工，
 * 由 `tests/ai-copy-parity.spec.ts` 逐条对账。
 */
export function retentionMessage(disclosure: RetentionDisclosure): {
  readonly key: MessageKey;
  readonly vars?: MessageVars;
} {
  switch (disclosure.kind) {
    case 'not-applicable':
      return { key: 'web.ai.disclosure.retentionNotApplicable' };
    case 'third-party-decides':
      return { key: 'web.ai.disclosure.retentionThirdParty' };
    case 'metadata-only':
      return {
        key: 'web.ai.disclosure.retentionMetadataOnly',
        vars: { contentDays: disclosure.contentDays, metadataDays: disclosure.metadataDays },
      };
  }
}

/** 路由层的原因码 → 词条。**穷尽**：`packages/ai` 新增一档而这里没登记 ⇒ 编译红。 */
export const AI_CAUSE_KEY: Record<AiFailureReason, MessageKey> = {
  'not-configured': 'web.ai.failure.cause.notConfigured',
  'no-route': 'web.ai.failure.cause.noRoute',
  'egress-not-authorized': 'web.ai.failure.cause.egressNotAuthorized',
  'fallback-needs-consent': 'web.ai.failure.cause.fallbackNeedsConsent',
  network: 'web.ai.failure.cause.network',
  'http-error': 'web.ai.failure.cause.httpError',
  'empty-response': 'web.ai.failure.cause.emptyResponse',
};

export const CAPTURE_FAILURE_KEY: Record<CaptureFailureReason, MessageKey> = {
  'ai-unavailable': 'web.ai.failure.aiUnavailable',
  unparseable: 'web.ai.failure.capture.unparseable',
  'empty-text': 'web.ai.failure.capture.emptyText',
  'text-too-long': 'web.ai.failure.capture.textTooLong',
};

export const BREAKDOWN_FAILURE_KEY: Record<BreakdownFailureReason, MessageKey> = {
  'ai-unavailable': 'web.ai.failure.aiUnavailable',
  unparseable: 'web.ai.failure.breakdown.unparseable',
  'empty-title': 'web.ai.failure.breakdown.emptyTitle',
};

export const PRIORITIZE_FAILURE_KEY: Record<PrioritizeFailureReason, MessageKey> = {
  'ai-unavailable': 'web.ai.failure.aiUnavailable',
  unparseable: 'web.ai.failure.prioritize.unparseable',
  'empty-tasks': 'web.ai.failure.prioritize.emptyTasks',
};

export const DURATION_FAILURE_KEY: Record<DurationFailureReason, MessageKey> = {
  'ai-unavailable': 'web.ai.failure.aiUnavailable',
  unparseable: 'web.ai.failure.duration.unparseable',
  'empty-title': 'web.ai.failure.duration.emptyTitle',
};

export const TOOL_CALL_FAILURE_KEY: Record<ToolCallFailureReason, MessageKey> = {
  'empty-text': 'web.ai.tools.failure.emptyText',
  'text-too-long': 'web.ai.tools.failure.textTooLong',
  'no-granted-tools': 'web.ai.tools.failure.noGrantedTools',
  'ai-unavailable': 'web.ai.failure.aiUnavailable',
  'model-returned-text': 'web.ai.tools.failure.modelReturnedText',
  'multiple-tool-calls': 'web.ai.tools.failure.multipleToolCalls',
  'tool-call-malformed': 'web.ai.tools.failure.toolCallMalformed',
};

export const ASSISTANT_FAILURE_KEY: Record<AssistantFailureReason, MessageKey> = {
  'empty-text': 'web.ai.assistant.failure.emptyText',
  'text-too-long': 'web.ai.assistant.failure.textTooLong',
  'no-tools-available': 'web.ai.assistant.failure.noToolsAvailable',
  'routing-failed': 'web.ai.failure.aiUnavailable',
  'multiple-tool-calls': 'web.ai.assistant.failure.multipleToolCalls',
  'arguments-malformed': 'web.ai.assistant.failure.argumentsMalformed',
  'write-failed': 'web.ai.assistant.failure.writeFailed',
  'egress-outside-disclosed-set': 'web.ai.assistant.failure.egressOutsideDisclosedSet',
};

/** 披露块需要的九个 key（`@heyta/ui` 的 `AiDisclosure` 只认已经翻好的整句）。 */
export const AI_DISCLOSURE_KEYS = {
  destinationLead: 'web.ai.disclosure.destinationLead',
  local: 'web.ai.disclosure.local',
  remote: 'web.ai.disclosure.remote',
  model: 'web.ai.disclosure.model',
  fallbackLead: 'web.ai.disclosure.fallbackLead',
  retentionLead: 'web.ai.disclosure.retentionLead',
  fieldsLead: 'web.ai.disclosure.fieldsLead',
  e2eeLead: 'web.ai.disclosure.e2eeLead',
  e2eeStrong: 'web.ai.disclosure.e2eeStrong',
} as const satisfies Record<string, MessageKey>;

/**
 * 端点健康状态 → 词条 key + 插值参数。
 *
 * ⚠️ 它**不能**抽进 `@heyta/app-host`：那一层不依赖 `@heyta/i18n`（`MessageKey` 拿不到），
 * 而"哪个状态说哪句话"按设计留在壳里 —— web 那边同名的那份在
 * `apps/web/src/features/settings/health-copy.ts`，形状完全一样。
 *
 * ⚠️ `switch` 穷尽三个 `kind`：`packages/ai` 以后加一档（比如"半开"）而这里没登记，
 * 返回类型就不完整，**编译期报错**，而不是静默退回一句笼统的话。
 */
export function healthCopy(disclosure: EndpointHealthDisclosure): {
  key: MessageKey;
  params: Record<string, string | number>;
} {
  switch (disclosure.kind) {
    case 'ok':
      return { key: 'web.ai.health.ok', params: {} };
    case 'failing':
      return { key: 'web.ai.health.failing', params: { failures: disclosure.failures } };
    case 'circuit-open':
      return {
        key: 'web.ai.health.circuitOpen',
        params: {
          failures: disclosure.failures,
          retryInSeconds: disclosure.retryInSeconds,
        },
      };
  }
}
