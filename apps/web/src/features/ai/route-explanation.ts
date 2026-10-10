/**
 * 路由解析 → 界面能说的话
 * ==========================
 *
 * 这是 `packages/ai` 的 `resolveRoute()` 与四个 AI 面板之间的**唯一**一层。
 * 它回答两个问题，而且只回答这两个：
 *
 *   1. **这个功能会走到哪个端点**（首选候选，与 `invokeRouted` 的取法一致）
 *   2. **如果一个候选都没有，为什么**（`RouteResolution.excluded` 的原因码 → 词条）
 *
 * ## 🔴 为什么必须有第 2 个问题
 *
 * 在此之前，四个面板各自调 `resolveRoute()`，但**只取 `candidates[0]`**，
 * `resolution.excluded` 从头到尾没有任何读取点。后果是具体的：
 *
 *   用户看到的永远是「还没有给「X」配置端点。去设置里添加端点并指定路由。」
 *   —— 而真实原因可能是端点被停用、能力没声明、熔断中、远端闸没开、
 *   地址非法、甚至路由指向了一个不存在的端点。
 *
 * 于是用户照着那句话去"添加端点"，加完还是不行，因为**问题从来不在那里**。
 * 这是最坏的一类失效：**界面在说一句自己都不确定的话，而且指向错误的方向**。
 *
 * ## 🔴 为什么四个面板必须共用这一份
 *
 * 本仓库对"同一件事两套实现"有明确纪律（见 `AiBreakdown.resolvePreferredTarget`
 * 里记的那次实测：披露说 A、实际发到 B）。四条路由解释如果各写一套，
 * 一定会漂移 —— 而其中一条漂移的后果是**用户按提示做了却解决不了问题**。
 *
 * 顺带把四份重复的"取首选候选并描述它"收掉了 —— 而那一份现在又在
 * `packages/app-host/src/ai-route-target.ts`（移动壳是第二个消费者）。
 * 本文件因此只剩**两件事**：原因 → 词条、原因 → 设置的哪一块。
 */

import {
  type AiFeature,
  type AiRoutingConfig,
  type CandidateExclusionReason,
  type HealthMap,
  type RouteResolution,
} from '@heyta/ai';
import {
  pickNoCandidateReason,
  resolveAiRoute,
  type AiNoCandidateReason,
  type AiRouteTarget,
} from '@heyta/app-host';
import type { MessageKey, MessageVars } from '@heyta/i18n';

/**
 * 首选目标的界面视图 —— 四个面板披露与发送都用它。
 *
 * 🔴 它**就是** `@heyta/app-host` 的那一份（`AiRouteTarget`），不再是本文件的
 * 私有形状。"取哪一个候选 / 是不是回环 / 回退链上有谁"这三个判断
 * 在移动壳接 AI 之后会有两个消费者，两份实现必漂
 * （理由见 `packages/app-host/src/ai-route-target.ts` 文件头）。
 */
export type ResolvedRouteTarget = AiRouteTarget;

/**
 * "去设置"要落到哪一块。
 *
 * ⚠️ 这是**导航参数**，不是授权。四个面板只做"打开设置并定位"，
 * **绝不**在面板里写 `consents` —— 那会造成第二套事实源
 * （上一轮刚修掉的就是这个形状：授权只能经 `AiSettings` 的
 * `updateRouting` / `grant()` 写入）。
 */
export type SettingsTarget = 'endpoints' | 'remote' | 'consent' | 'capability';

/** 一条"没有可用端点"的解释：原因码 + 词条 + 下一步该去哪。 */
export interface RouteExplanation {
  /** 结构化原因 —— 便于测试与将来做按原因分流的动作。 */
  readonly reason: CandidateExclusionReason | 'unconfigured' | 'unknown';
  readonly key: MessageKey;
  readonly params: MessageVars;
  readonly settingsTarget: SettingsTarget;
}

/**
 * 一个功能当前的路由全貌。
 *
 * `target` 与 `explanation` **恰好有一个**非 `undefined`：有路可走时说"发给谁"，
 * 没路可走时说"为什么、下一步"。
 *
 * 🔴 这个不变式**写在类型里**（判别联合），不是写在注释里：
 * 调用点 `if (target === undefined)` 会让 TypeScript 同时把 `explanation`
 * 收窄成 `RouteExplanation`。靠"两个字段都可能是 undefined、由调用点自己判断"
 * 的形状，四个面板迟早各判各的 —— 那正是这个模块要消灭的东西。
 */
export type FeatureRoute =
  | {
      readonly resolution: RouteResolution;
      readonly target: ResolvedRouteTarget;
      readonly explanation: undefined;
    }
  | {
      readonly resolution: RouteResolution;
      readonly target: undefined;
      readonly explanation: RouteExplanation;
    };

const NO_TARGET_KEY: Record<AiFeature, MessageKey> = {
  capture: 'web.ai.noTarget.capture',
  breakdown: 'web.ai.noTarget.breakdown',
  prioritize: 'web.ai.noTarget.prioritize',
  'duration-estimate': 'web.ai.noTarget.duration',
  'tool-calling': 'web.ai.noTarget.toolCalling',
  'inbound-automation': 'web.ai.noTarget.inboundAutomation',
};

/**
 * 原因码 → 词条。**穷尽的**：`packages/ai` 新增一个排除原因却忘了词条 → 编译错误。
 *
 * 每条句子都必须同时说清**为什么**和**下一步** —— 只说原因等于把用户留在原地
 * （这正是这条通道原来缺失的那一半）。
 */
const REASON_KEY: Record<CandidateExclusionReason, MessageKey> = {
  'remote-not-allowed': 'web.ai.routeExplain.remoteNotAllowed',
  'capability-missing': 'web.ai.routeExplain.capabilityMissing',
  'endpoint-disabled': 'web.ai.routeExplain.endpointDisabled',
  'endpoint-url-rejected': 'web.ai.routeExplain.endpointUrlRejected',
  'circuit-open': 'web.ai.routeExplain.circuitOpen',
  'endpoint-missing': 'web.ai.routeExplain.endpointMissing',
};

/** 原因码 → "去设置"的目标区块。 */
const REASON_SETTINGS_TARGET: Record<CandidateExclusionReason, SettingsTarget> = {
  'remote-not-allowed': 'remote',
  'capability-missing': 'capability',
  'endpoint-disabled': 'endpoints',
  'endpoint-url-rejected': 'endpoints',
  'circuit-open': 'endpoints',
  'endpoint-missing': 'endpoints',
};

/**
 * 多个候选被排除、且原因各不相同时，报哪一个。
 *
 * 🔴 顺序**就是优先级**，判据只有一条：**先报用户下一步真能解决的那个**。
 *
 *   - `remote-not-allowed` 排第一：闸 2 关着时，其他原因在本机上
 *     根本无从判断（远端端点连能力都不会被查）—— 报别的会让用户白改配置。
 *   - 接着是能在一个控件里修好的（能力 / 停用 / 地址），
 *     再是"等一会儿就好"的熔断，最后才是配置损坏。
 *
 * ⚠️ 刻意**只报一个**：同时列六条原因对用户不是信息，是噪音；
 * 而且改完第一条之后，第二条多半会自己消失（闸 2 打开后能力才被检查）。
 *
 * 🔴 那六条的**顺序**现在在 `@heyta/app-host` 的 `ai-route-target.ts`
 * （`pickNoCandidateReason`）。下面 `REASON_KEY` / `REASON_SETTINGS_TARGET`
 * 两张表按 `CandidateExclusionReason` **穷尽**，所以词表新增一档时这里仍会
 * 编译红 —— 搬家搬走的是"报哪一条"，留在这里的是"那一条怎么说"。
 */

/**
 * 「一个候选都没有」→ 一条能读的解释。
 *
 * 三种情形，**必须分开**（`unconfigured` / 有排除记录 / 两者都不是），
 * 而"是哪一种"的判断在 `@heyta/app-host` 的 `pickNoCandidateReason()` ——
 * 包括那六条原因的**报告优先级**。这里只剩"这个原因说成哪句词条、
 * 下一步带用户去设置哪一块"，因为那两件事是措辞与导航，属于壳。
 *
 * ⚠️ 优先级原先住在本文件。移动壳接 AI 时它要么抄一份、要么不显示原因，
 * 两条都不可接受（抄的那份一改就漂，不显示则披露制度不成立），
 * 所以上收成一份。**这里删掉了那一行数组，不是复制了一份。**
 */
export function explainNoCandidate(
  resolution: RouteResolution,
  feature: AiFeature,
): RouteExplanation {
  const reason = pickNoCandidateReason(resolution);
  const settingsTarget: SettingsTarget =
    reason === 'unconfigured' || reason === 'unknown'
      ? 'endpoints'
      : REASON_SETTINGS_TARGET[reason];

  return {
    reason,
    key:
      reason === 'unconfigured'
        ? NO_TARGET_KEY[feature]
        : reason === 'unknown'
          ? 'web.ai.routeExplain.unknown'
          : REASON_KEY[reason],
    params: {},
    settingsTarget,
  };
}

/**
 * 解析一个功能的路由 —— **四个面板唯一允许的取法**。
 *
 * 🔴 取哪一个候选、回环判据、回退链、以及"一个候选都没有时报哪个原因"
 * 全在 `@heyta/app-host` 的 `resolveAiRoute()`（与移动壳同一份）。
 * 本文件只做**词条映射**。
 *
 * ⚠️ `ok` 的判据是"有没有候选"，不是"配置好不好看"：熔断中的端点此刻
 * 确实没有路可走，界面就该说熔断，而不是继续披露一个不会被打到的端点。
 * 这要求把**熔断状态**一并传进去（`options.health`）——否则
 * `circuit-open` 这条原因永远不会出现，那条词条就成了死分支。
 *
 * 🔴 传进来的 health 必须是**发送时同一份**（组件的 `healthSnapshot` 经
 * `fromHealthSnapshot` 还原）。披露与发送对熔断的判断一旦分叉，就会出现
 * "界面说可以发、按下去必然失败"——那正是披露制度要防的意外。
 */
export function resolveFeatureRoute(
  routing: AiRoutingConfig,
  feature: AiFeature,
  options: { now?: number; health?: HealthMap } = {},
): FeatureRoute {
  const { resolution, target, noCandidate } = resolveAiRoute(routing, feature, options);
  if (target === undefined) {
    return { resolution, target: undefined, explanation: explainNoCandidate(resolution, feature) };
  }
  return { resolution, target, explanation: undefined };
}
