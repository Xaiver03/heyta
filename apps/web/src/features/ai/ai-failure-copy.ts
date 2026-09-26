/**
 * AI 面板的失败文案
 * ==================
 *
 * 🔴 **通道 #5**：四个面板原来整句渲染 `outcome.message`（`packages/app-host`
 * 拼好的中文），于是英文界面在**失败时**露中文 —— 而门禁看不见它
 *（渲染的是变量 `{failure}`，不是字面量）。这类"变量渲染"通道已经修了六条，
 * 这是第七条；共同形状都是**跨包中文被壳整句渲染**。
 *
 * 现在分两层，与 `ErrorScreen` 的技术详情同一分类：
 *
 *   1. **主文案**：按 `reason` 取词条（四张 `Record<…FailureReason, MessageKey>`，
 *      穷尽 —— 包新增一个 reason 就是编译错误）。
 *   2. **技术详情**：包给的 `message` 原文，收在 `<details>` 里。
 *
 * `showDetail` 由 **reason** 决定，而不是"看起来像不像同一句"：
 * 本地就能判定的拒绝（`empty-*` / `unparseable`）其 `message` 完全由 reason
 * 决定，词条已经把它说完了，再显示一遍是噪音。只有两种情况 `message`
 * 还带着**词条给不了的信息**：
 *   - `ai-unavailable`：可能是端点返回的原文（4xx/5xx、DNS 失败……）；
 *   - `text-too-long`：里面是**具体的字数与上限**（那两个数只在包里，
 *     没有作为结构化字段传出来 —— 所以主句写通用句、数字留在详情里，
 *     信息一点不丢）。
 */

import type {
  BreakdownFailureReason,
  CaptureFailureReason,
  DurationFailureReason,
  PrioritizeFailureReason,
} from '@heyta/app-host';
import type { AiFailureReason } from '@heyta/ai';
import type { MessageKey } from '@heyta/i18n';

/** 一条失败态要渲染的东西：词条 + （可选）技术详情。 */
export interface AiFailureCopy {
  readonly key: MessageKey;
  readonly detail: string;
  readonly showDetail: boolean;
}

const BREAKDOWN_KEY: Record<BreakdownFailureReason, MessageKey> = {
  'ai-unavailable': 'web.ai.failure.aiUnavailable',
  unparseable: 'web.ai.failure.breakdown.unparseable',
  'empty-title': 'web.ai.failure.breakdown.emptyTitle',
};

const CAPTURE_KEY: Record<CaptureFailureReason, MessageKey> = {
  'ai-unavailable': 'web.ai.failure.aiUnavailable',
  unparseable: 'web.ai.failure.capture.unparseable',
  'empty-text': 'web.ai.failure.capture.emptyText',
  'text-too-long': 'web.ai.failure.capture.textTooLong',
};

const DURATION_KEY: Record<DurationFailureReason, MessageKey> = {
  'ai-unavailable': 'web.ai.failure.aiUnavailable',
  unparseable: 'web.ai.failure.duration.unparseable',
  'empty-title': 'web.ai.failure.duration.emptyTitle',
};

const PRIORITIZE_KEY: Record<PrioritizeFailureReason, MessageKey> = {
  'ai-unavailable': 'web.ai.failure.aiUnavailable',
  unparseable: 'web.ai.failure.prioritize.unparseable',
  'empty-tasks': 'web.ai.failure.prioritize.emptyTasks',
};

/**
 * 路由层的失败原因码 → 词条。
 *
 * 🔴 为什么需要这一层：`ai-unavailable` 时 `outcome.message` 是**路由层给的
 * 可操作原因**（"去逐功能授权" / "缺能力声明" / "熔断中"……），不是技术噪音 ——
 * 所以它不能只当技术详情。但它是**动态披露**（含要发的字段、保留策略），
 * 整句进不了词条。真正可本地化的是**原因码**，而它就在 `result.reason` 里，
 * 此前被丢掉了。第 18 轮把它作为 `cause` 带出来。
 *
 * 穷尽 —— `packages/ai` 新增一个失败原因，这里漏一个就是编译错误。
 * 词条的 zh **第一行与 `packages/ai` 的句子逐字一致**（有测试钉住）。
 */
const CAUSE_KEY: Record<AiFailureReason, MessageKey> = {
  'not-configured': 'web.ai.failure.cause.notConfigured',
  'egress-not-authorized': 'web.ai.failure.cause.egressNotAuthorized',
  network: 'web.ai.failure.cause.network',
  'http-error': 'web.ai.failure.cause.httpError',
  'empty-response': 'web.ai.failure.cause.emptyResponse',
  'no-route': 'web.ai.failure.cause.noRoute',
  'fallback-needs-consent': 'web.ai.failure.cause.fallbackNeedsConsent',
};

/**
 * 原因码 → 词条。`cause` 缺失时退回通用那句。
 *
 * ⚠️ 退回是**必要**的：`instanceof`/跨模块类型在"模块被加载两份"时会静默为假，
 * 那时 `cause` 是 undefined。宁可说"AI 服务暂时不可用"，也不能崩。
 */
export function causeKey(cause: AiFailureReason | undefined): MessageKey {
  return cause === undefined ? 'web.ai.failure.aiUnavailable' : CAUSE_KEY[cause];
}

/** 这个 reason 的 `message` 里有没有词条给不了的信息。 */
function showDetailFor(reason: string): boolean {
  return reason === 'ai-unavailable' || reason === 'text-too-long';
}

export function breakdownFailureCopy(
  reason: BreakdownFailureReason,
  detail: string,
  cause: AiFailureReason | undefined,
): AiFailureCopy {
  return {
    // 有原因码就用它 —— 它比 `ai-unavailable` 那句话具体得多。
    key:
      reason === 'ai-unavailable'
        ? causeKey(cause)
        : BREAKDOWN_KEY[reason],
    detail,
    showDetail: showDetailFor(reason),
  };
}

export function captureFailureCopy(
  reason: CaptureFailureReason,
  detail: string,
  cause: AiFailureReason | undefined,
): AiFailureCopy {
  return {
    // 有原因码就用它 —— 它比 `ai-unavailable` 那句话具体得多。
    key:
      reason === 'ai-unavailable'
        ? causeKey(cause)
        : CAPTURE_KEY[reason],
    detail,
    showDetail: showDetailFor(reason),
  };
}

export function durationFailureCopy(
  reason: DurationFailureReason,
  detail: string,
  cause: AiFailureReason | undefined,
): AiFailureCopy {
  return {
    // 有原因码就用它 —— 它比 `ai-unavailable` 那句话具体得多。
    key:
      reason === 'ai-unavailable'
        ? causeKey(cause)
        : DURATION_KEY[reason],
    detail,
    showDetail: showDetailFor(reason),
  };
}

export function prioritizeFailureCopy(
  reason: PrioritizeFailureReason,
  detail: string,
  cause: AiFailureReason | undefined,
): AiFailureCopy {
  return {
    // 有原因码就用它 —— 它比 `ai-unavailable` 那句话具体得多。
    key:
      reason === 'ai-unavailable'
        ? causeKey(cause)
        : PRIORITIZE_KEY[reason],
    detail,
    showDetail: showDetailFor(reason),
  };
}
