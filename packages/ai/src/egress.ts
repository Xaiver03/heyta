/**
 * 出境闸门
 * ==========
 *
 * ADR-0006 §3.2 的 5 条约束里，有 3 条是关于"出境必须是显式的"。本文件是它们
 * 的执行点：**任何一次把明文送出去的调用，都必须先经过 `authorizeEgress`。**
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 核心不变量：**授权是绑定在 (功能, 目的地) 这个二元组上的**
 *
 * 这条来自一个真实的坏场景：
 *
 *   1. 用户开了"AI 拆解任务"，走的是自己那台 Ollama（`localhost`）——
 *      这在隐私上根本不是出境，他当然会同意；
 *   2. 后来他换了 heyta 托管，或者把端点改成了一个远程地址；
 *   3. **如果授权只记"用户同意过 AI 拆解"，那么第 2 步之后，
 *      他的任务明文就会在我们从未征求过同意的情况下流出去。**
 *
 * 所以 `authorizeEgress` 要求 `(feature, destination)` **精确匹配**。
 * 目的地变了 → 旧授权**自动失效**，必须重新征求。
 * 这不是"防御性编程"，是"用户同意的是 A、你做了 B"那类事故的唯一止血点。
 * ─────────────────────────────────────────────────────────────────────────
 */

import {
  describeDestination,
  describeRetention,
  destinationDisclosure,
  requiresEgressConsent,
  retentionDisclosure,
  type DestinationDisclosure,
  type EgressDestination,
  type RetentionDisclosure,
} from './supply.js';

/**
 * AI 功能标识。
 *
 * ⚠️ 刻意**按"用哪几个字段"来划分**，而不是按"界面在哪"。
 * 授权与披露的粒度必须是"哪些数据会出去"，而界面上怎么摆是另一回事。
 */
export type AiFeature =
  /** 自然语言捕获：只要标题那一行。**字段最少的一条。** */
  | 'capture'
  /** 拆解任务：要标题 + 备注。 */
  | 'breakdown'
  /** 逐条优先级建议：要标题 + 截止时间 + 优先级。 */
  | 'prioritize'
  /** 估时（时间线视图用）：要标题 + 备注 + 历史耗时。 */
  | 'duration-estimate'
  /**
   * 工具调用：把用户这句话 + **已授权工具的名字与说明**发出去，让模型选一个工具。
   *
   * ⚠️ 它**必须**是独立成员，不能复用上面四个功能的授权 ——
   * 授权绑定的是"哪些数据会出去"，而这条链路会送出**工具目录本身**
   * （工具名是能力范围的信息，见 `mcp.ts` 的"未授权即不可见"）。
   *
   * 🔴 它要求端点在 `capabilities` 里**显式声明** `tool_calling`：
   * 没声明 = 只有基线能力 = 被路由排除。这是 ADR-0010"不做能力推断"的直接后果。
   */
  | 'tool-calling';

/** 一次授权：用户为**某个功能**、**某个目的地**同意过。 */
export interface EgressConsent {
  feature: AiFeature;
  destination: EgressDestination;
  /** 授权时间（epoch ms）。用于展示"你何时同意的"，不用于过期。 */
  grantedAt: number;
}

/** 一次出境请求。 */
export interface EgressRequest {
  feature: AiFeature;
  destination: EgressDestination;
  /** 本次实际会送出去的字段名。**必须逐项列出**，不许写 `['*']`。 */
  fields: readonly string[];
}

/** 展示给用户的完整披露。**无论是否放行都要能拿到** —— 拒绝时也要能说清为什么。 */
export interface EgressDisclosure {
  destination: EgressDestination;
  fields: readonly string[];
  /**
   * "发给谁"的**结构化**结论 —— 界面要中英双语，所以措辞必须归壳。
   *
   * 🔴 与下面 `destinationText` 的关系：两者**同源**（都来自 `destinationDisclosure()`），
   * 所以不可能一个说"本地"另一个说"到了我们服务器"。壳应该用这个字段 + 词条表渲染；
   * `destinationText` 是过渡期的兼容字段，等所有壳切过来就删。
   */
  destinationDisclosure: DestinationDisclosure;
  /** "留多久"的**结构化**结论。三档都有值 —— 托管那一档的两个天数来自 `supply.ts` 的常量。 */
  retentionDisclosure: RetentionDisclosure;
  /**
   * "发给谁"。⚠️ **过渡期的兼容字段**（中文句子），新代码不要用。
   * @deprecated 用 `destinationDisclosure` + 词条表。
   */
  destinationText: string;
  /**
   * "留多久"（中文句子）。
   * @deprecated 用 `retentionDisclosure` + 词条表。
   */
  retentionText: string;
  /** 是否需要用户授权才能进行。 */
  requiresConsent: boolean;
}

export type EgressDecision =
  | { allowed: true; disclosure: EgressDisclosure }
  | {
      allowed: false;
      /**
       * 拒绝原因。UI 必须**分开呈现**，因为该做的事不同。
       *
       * ⚠️ 这里曾经并列过一个 `consent-required`（注释说它表示"需要授权但本次没有"）。
       * 它是**死的**：`authorizeEgress` 只有两个出口，全仓也没有任何地方构造它，
       * 而本文件自己的注释就写着"这个 reason 不会出现"。一个永远不会出现的联合成员
       * 读起来像"还有第三种状态要处理"，实际只是让类型说谎 —— 已收敛掉。
       * 🔴 若将来真的要区分"提示态"与"拒绝态"，**必须先有一条真的构造它的代码路径**，
       * 再加回类型；不要凭注释预留。
       */
      reason: 'consent-missing';
      disclosure: EgressDisclosure;
    };

/** 组装披露内容。纯函数，测试与 UI 共用同一条路径。 */
export function buildDisclosure(request: EgressRequest): EgressDisclosure {
  return {
    destination: request.destination,
    fields: request.fields,
    // 结构化结论是**唯一**的判断来源，下面两句兼容文本由它投影出来 ——
    // 两条路径不可能对同一次出境给出不同结论。
    destinationDisclosure: destinationDisclosure(request.destination),
    retentionDisclosure: retentionDisclosure(request.destination),
    destinationText: describeDestination(request.destination),
    retentionText: describeRetention(request.destination),
    requiresConsent: requiresEgressConsent(request.destination),
  };
}

/**
 * 判定一次出境是否被授权。
 *
 * 唯一的拒绝原因是 `consent-missing`：需要授权，且**找不到匹配的授权记录**。
 * （"不需要授权"不是拒绝，而是 `allowed: true` —— 见下面本地端点的分支。）
 *
 * ⚠️ 这里曾经并列过一个 `consent-required`，注释把它写成"需要授权但本次没有的提示态"。
 * 但 `authorizeEgress` 从未构造过它，全仓也没有第二个构造点 —— 也就是说那条注释
 * 描述的是一个**不存在**的分支。死分支的害处不是"多一行"，而是**让下一个读代码的人
 * 以为还有第三种状态要处理**。已从类型里收敛掉，理由与证据见 `EgressDecision`。
 *
 * ⚠️ 拒绝时**必须**带上 `disclosure` —— 必须能告诉用户"什么会被发出去"，
 * 否则用户没法做出知情决定。一个只说"未授权"而不说"授权后会发生什么"的
 * 提示框，等于逼用户盲签。
 */
export function authorizeEgress(
  request: EgressRequest,
  consents: readonly EgressConsent[],
): EgressDecision {
  const disclosure = buildDisclosure(request);

  // 本地端点：根本没出境，不索要授权。
  // 🔴 这是"自备 + 本地端点"相对"托管"的**实质优势**，必须真的免授权，
  // 而不是走个形式 —— 否则用户会被训练成"看到提示就点同意"。
  if (!disclosure.requiresConsent) {
    return { allowed: true, disclosure };
  }

  const match = consents.some(
    (c) => c.feature === request.feature && c.destination === request.destination,
  );

  return match ? { allowed: true, disclosure } : { allowed: false, reason: 'consent-missing', disclosure };
}

/**
 * 切换供给模式时，**必须失效哪些授权**。
 *
 * 返回的是"切换后仍然有效"的授权列表 —— 也就是把**目的地不再匹配的那些**丢掉。
 *
 * 🔴 这是本文件的核心不变量的另一半：光在 `authorizeEgress` 里比对还不够，
 * 因为旧的授权记录**会一直留在存储里**。如果切换模式时不清掉它们，
 * 用户从"本地 Ollama"切到"heyta 托管"、再切回"自备远端"时，
 * 那些陈旧记录会**重新**变得可匹配 —— 于是出现"我没同意过这个组合，但它放行了"。
 *
 * 因此模式切换走这个函数，把不匹配的授权**删除**，而不是留着。
 */
export function retainValidConsents(
  consents: readonly EgressConsent[],
  currentDestination: EgressDestination,
): EgressConsent[] {
  // 本地端点不需要授权 → 一条都不该留（留着就是将来误放行的种子）。
  if (!requiresEgressConsent(currentDestination)) return [];
  return consents.filter((c) => c.destination === currentDestination);
}