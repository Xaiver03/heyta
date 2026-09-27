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
 * `showDetail` 由 **reason ＋ cause** 决定，而不是"看起来像不像同一句"：
 * 本地就能判定的拒绝（`empty-*` / `unparseable`）其 `message` 完全由 reason
 * 决定，词条已经把它说完了，再显示一遍是噪音。`message` 还带着**词条给不了
 * 的信息**时才显示：
 *   - `ai-unavailable`：可能是端点返回的原文（4xx/5xx、DNS 失败……）；
 *   - `text-too-long`：里面是**具体的字数与上限**（那两个数只在包里，
 *     没有作为结构化字段传出来 —— 所以主句写通用句、数字留在详情里，
 *     信息一点不丢）。
 *
 * ⚠️ `ai-unavailable` 里还有一档例外，判据在 `PURE_SENTENCE_CAUSE`：有些
 * `cause` 的原文**本身就是一句界面话**（`not-configured`），词条已把它说完 ——
 * 再渲染一遍，在英文界面里就是一句中文。这一档只写在那一个常量上，
 * 不散进四个 `*FailureCopy`。
 *
 * ## 那个 `<details>` 里会有中文 —— 这是**有意的**，不要"顺手修掉"
 *
 * 包给的 `message` 是中文原文，所以英文界面的折叠块里会出现汉字。
 * 本仓库对"原始错误文本"早有明确处置，这不是这里新开的口子：
 * `features/shell/ErrorScreen.tsx` 把 `error.message`（`packages/storage` 抛的中文）
 * 同样降级进 `error-details`，文件头写着「**原始错误文本 —— 数据，不翻译。**」；
 * `error-hint.ts` 更直接地接受了这个代价 —— 那条中文异常**无条件抛**，
 * 英文用户注定会读到它，处置是"按结构化原因给词条 + 原文降级成技术详情"。
 *
 * 🔴 判据：**主文案**必须取词条（`cause` → `CAUSE_KEY`，本文件负责），
 * **原文**只允许出现在折叠的诊断块里（面板负责）。两侧都由
 * `apps/web/tests/ai-failure-locale.spec.tsx` 钉住（已用两种注入验证会红：
 * 把主文案换成原文、把原文塞到 `<details>` 之外）。
 * 删掉原文、或只在中文下显示它，都是**信息倒退**：`http-error` 的原文里有
 * 状态码与端点名，`egress-not-*` 的原文里有动态披露（要发哪些字段、保留多久），
 * 这两样词条给不了。
 *
 * ⚠️ 顺带纠正一条曾经的实测结论（旧版本写的是"`not-configured` / `no-route`
 * 这两条都到不了失败态"，**后半句错了**）：
 *   - `no-route` **到不了** —— 候选为空，披露之前就被 `RouteUnavailable` 拦下
 *     （没有"发送"按钮）；
 *   - `not-configured` **会到** —— `resolveRoute()` **不看** `config.enabled`
 *     （只有 `invokeRouted()` 的第 1 道闸看），总开关关着时候选仍在、披露照常
 *     显示，用户按下"发送"才拿到它。「总开关关着」是最容易遇到的"AI 不能用"。
 */

import type {
  BreakdownFailureReason,
  CaptureFailureReason,
  DurationFailureReason,
  PrioritizeFailureReason,
} from '@heyta/app-host';
import type { AiFailureReason } from '@heyta/ai';
import type { MessageKey } from '@heyta/i18n';

import type { SettingsTarget } from './route-explanation.js';

/** 一条失败态要渲染的东西：词条 + （可选）技术详情 + （可选）下一步。 */
export interface AiFailureCopy {
  readonly key: MessageKey;
  readonly detail: string;
  readonly showDetail: boolean;
  /**
   * 这次失败能在设置里修 → "去设置"该落在哪一块。
   *
   * 🔴 `undefined` 是有意义的：网络抖动、端点返回空内容、模型没读懂……
   * 这些**在设置里改什么都修不好**。给它们也放一个"去设置"按钮，
   * 等于教用户去一个没有答案的地方找答案 —— 比没有按钮更糟。
   */
  readonly settingsTarget: SettingsTarget | undefined;
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

/**
 * 原因码 → "去设置"目标区块。`undefined` = 设置里没有能修它的控件。
 *
 * 🔴 这一层是"失败态也要给出下一步"的唯一事实源：四个面板都从这里取，
 * **不许**各自判断"这个原因该不该显示按钮"（那会变成四份会漂移的策略）。
 *
 * ⚠️ 它只导航，不授权。`egress-not-authorized` 指到 `consent` 区块，
 * 用户到那里按"我同意"才真的写授权 —— 面板自己不碰 `consents`。
 */
const CAUSE_SETTINGS_TARGET: Record<AiFailureReason, SettingsTarget | undefined> = {
  // AI 没开：启用开关就在设置页顶部。
  'not-configured': 'endpoints',
  // 未授权：落在逐功能授权那一块（那里才有"我同意"）。
  'egress-not-authorized': 'consent',
  // 网络与空响应是**暂时性**的，设置里改什么都修不好。
  network: undefined,
  'empty-response': undefined,
  // 端点报错：多半是密钥 / 余额 / 模型名 —— 都在端点行里。
  'http-error': 'endpoints',
  // 没有候选：端点或路由配错了。
  'no-route': 'endpoints',
  // 回退端点要另一次授权：同样是逐功能授权那一块。
  'fallback-needs-consent': 'consent',
};

export function causeSettingsTarget(
  cause: AiFailureReason | undefined,
): SettingsTarget | undefined {
  return cause === undefined ? undefined : CAUSE_SETTINGS_TARGET[cause];
}

/** `ai-unavailable` 且有原因码时才谈得上"去设置"；本地就能判定的拒绝没有下一步。 */
function settingsTargetFor(reason: string, cause: AiFailureReason | undefined): SettingsTarget | undefined {
  return reason === 'ai-unavailable' ? causeSettingsTarget(cause) : undefined;
}

/** 这个 `reason` 的 `message` 里有没有词条给不了的信息。 */
function showDetailFor(reason: string, cause: AiFailureReason | undefined): boolean {
  if (reason === 'text-too-long') return true;
  if (reason !== 'ai-unavailable') return false;
  // `cause` 缺失时分类不了 → 保留原文（诊断价值优先于"可能重复"）。
  if (cause !== undefined && PURE_SENTENCE_CAUSE.has(cause)) return false;
  return true;
}

/**
 * 哪些原因码的 `message` **本身就是一句界面话** —— 词条已经把它说完了。
 *
 * 判据是**信息**，不是"看起来像不像同一句"：
 * `not-configured` 在包里有两个站点（`routing.ts` 的「在设置里打开总开关」、
 * `provider.ts` 的「选择使用自己的 AI 端点」），两处都是一句完整的中文界面话，
 * 而词条 `web.ai.failure.cause.notConfigured` 说的是同一件事、还更具体。
 * 再显示一遍在中文里是纯重复，**在英文界面里就是一句中文**。
 *
 * ⚠️ 它**会**走到失败态，所以这条不是理论问题：`resolveRoute()` **不看**
 * `config.enabled`（只有 `invokeRouted()` 的第 1 道闸看），于是总开关关着时
 * 候选仍在、披露照常显示，用户按了"发送"才拿到 `not-configured`。
 * 「总开关关着」是最容易遇到的那个"AI 不能用"。
 *
 * ⚠️ 与 `no-route` 的区别：后者候选为空，在披露之前就被 `RouteUnavailable`
 * 拦下了（没有"发送"按钮），**根本到不了**这个折叠块。
 */
const PURE_SENTENCE_CAUSE: ReadonlySet<AiFailureReason> = new Set(['not-configured']);

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
    showDetail: showDetailFor(reason, cause),
    settingsTarget: settingsTargetFor(reason, cause),
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
    showDetail: showDetailFor(reason, cause),
    settingsTarget: settingsTargetFor(reason, cause),
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
    showDetail: showDetailFor(reason, cause),
    settingsTarget: settingsTargetFor(reason, cause),
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
    showDetail: showDetailFor(reason, cause),
    settingsTarget: settingsTargetFor(reason, cause),
  };
}
