/**
 * 路由解析 → **界面能显示的那一层**（宿主无关）
 * ==========================================
 *
 * `packages/ai` 的 `resolveRoute()` 给的是候选链；每个壳都要回答同一个问题：
 * **"这个功能这次会走到哪个端点，以及一个候选都没有时为什么。"**
 *
 * 这段判断原先住在 `apps/web/src/features/ai/route-explanation.ts`。
 * 移动壳接 AI 的时候它只有两个选择：抄一份（两份会漂），或者不显示目标
 * （那出境披露就变成"发给某个不知道的地方"，制度本身就不成立）。
 * 两条都不接受 ⇒ 抽到这里。
 *
 * 🔴 本文件**只出结构，不出句子**：
 * 词条 key 的选择留在壳里（`packages/app-host` 刻意不依赖 `@heyta/i18n`，
 * 见 `./ai-output-language.ts` 文件头那条反向依赖的理由）。
 *
 * ## 为什么"取第一个候选"是承重的
 *
 * `invokeRouted` 的尝试顺序就是 `resolveRoute` 返回的候选顺序。
 * 界面如果自己去端点表里"随便挑一个启用的"来显示，就会出现
 * **披露说 A、实际发到 B（另一家公司）** —— 这不是假想的洁癖：
 * `apps/web/src/features/ai/route-explanation.ts` 文件头记的就是这个 bug 的
 * 前一次发作（四份平行实现里的一份漂了）。所以"取哪一个候选"必须只有一份。
 *
 * ## 为什么"只报一个排除原因"也是承重的
 *
 * 六个原因同时甩给用户不是信息，是噪音；而优先级只有一条判据：
 * **先报用户下一步真能解决的那个**。`remote-not-allowed` 必须在最前 ——
 * 那道闸关着时其余原因在本机根本无从判断（远端端点连能力都不会被检查），
 * 报别的会让用户白改一轮配置。顺序是产品决策，所以它也住在这里，不住在壳里。
 */

import {
  isLoopbackEndpoint,
  resolveRoute,
  type AiFeature,
  type AiRoutingConfig,
  type CandidateExclusionReason,
  type EgressDestination,
  type HealthMap,
  type RouteResolution,
} from '@heyta/ai';

/**
 * 首选目标的界面视图。
 *
 * ⚠️ 它**不是** `ResolvedCandidate` 的别名：这里只留界面要显示的东西
 * （标签、地址、模型、回环判据、回退链），不把 `keyRef` / `capabilities`
 * 这类配置细节带到渲染层。
 */
export interface AiRouteTarget {
  endpointId: string;
  label: string;
  endpoint: string;
  model: string;
  /** 回环判据只有一份 —— `packages/ai` 的 `isLoopbackEndpoint()`。 */
  isLocal: boolean;
  /** `resolveRoute` 算出的目的地类别 —— 直接传给 `buildDisclosure`，**不在这里重新判**。 */
  destination: EgressDestination;
  /**
   * 回退链上**其余**端点的标签（不含首选）。
   *
   * 🔴 回退是真实行为：首选失败会自动试下一个。只说首选不够 ——
   * 用户同意了 A，数据却可能发到 B，而这类切换**不报错**（最终成功了）。
   */
  fallbacks: readonly string[];
}

/**
 * "一个候选都没有"的原因。
 *
 * 🔴 `unconfigured` 与"配了但全被排除"必须分开：前者要说的是"先去添加端点"，
 * 后者要说的是"你加的那个为什么用不了"。合成一句，用户就会去添加一个
 * 同样用不了的端点。
 */
export type AiNoCandidateReason = CandidateExclusionReason | 'unconfigured' | 'unknown';

/** 排除原因的**报告优先级**（顺序即优先级，理由见文件头）。 */
const REASON_PRIORITY: readonly CandidateExclusionReason[] = [
  'remote-not-allowed',
  'capability-missing',
  'endpoint-disabled',
  'endpoint-url-rejected',
  'circuit-open',
  'endpoint-missing',
];

/** 从一次路由解析里挑出**该报给用户的那一个**排除原因。 */
export function pickNoCandidateReason(resolution: RouteResolution): AiNoCandidateReason {
  if (resolution.unconfigured) return 'unconfigured';
  const present = new Set(resolution.excluded.map((e) => e.reason));
  for (const reason of REASON_PRIORITY) {
    if (present.has(reason)) return reason;
  }
  // 既没配也没有排除记录 —— 理论到不了，但**宁可承认判断不了**也不编一个原因。
  return 'unknown';
}

/**
 * 解析一个功能的路由 —— **每个壳唯一允许的取法**。
 *
 * ⚠️ 判据是"有没有候选"，不是"配置好不好看"：熔断中的端点此刻确实没有路可走，
 * 界面就该说熔断，而不是继续披露一个不会被打到的端点。
 * 这要求把**熔断状态**一并传进来（`options.health`），否则 `circuit-open`
 * 这一档永远不会出现，界面上那条诊断就成了死分支。
 *
 * 🔴 传进来的 health 必须是**发送时同一份**（落盘快照经 `fromHealthSnapshot` 还原）。
 * 披露与发送对熔断的判断一旦分叉，就会出现"界面说可以发、按下去必然失败"。
 */
export function resolveAiRoute(
  routing: AiRoutingConfig,
  feature: AiFeature,
  options: { now?: number; health?: HealthMap } = {},
): { resolution: RouteResolution; target: AiRouteTarget | undefined; noCandidate: AiNoCandidateReason | undefined } {
  const resolution = resolveRoute(routing, feature, {
    now: options.now ?? Date.now(),
    ...(options.health === undefined ? {} : { health: options.health }),
  });
  const first = resolution.candidates[0];
  if (first === undefined) {
    return { resolution, target: undefined, noCandidate: pickNoCandidateReason(resolution) };
  }
  return {
    resolution,
    target: {
      endpointId: first.endpointConfig.id,
      label: first.endpointConfig.label,
      endpoint: first.endpointConfig.endpoint,
      model: first.model,
      isLocal: isLoopbackEndpoint(first.endpointConfig.endpoint),
      destination: first.destination,
      fallbacks: resolution.candidates.slice(1).map((c) => c.endpointConfig.label),
    },
    noCandidate: undefined,
  };
}
