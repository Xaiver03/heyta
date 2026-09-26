/**
 * AI 配置路由
 * =============
 *
 * ADR-0010 的实现。这一层回答一个具体问题：
 *
 *   **"这次调用，到底该发给哪个端点？发不出去怎么办？"**
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴🔴 本文件与通用 AI 网关（CC Switch / LiteLLM / one-api 等）的**根本区别**
 *
 * 通用网关遇到失败就**换下一个端点重试**，这没错 —— 对它来说端点只是供应商。
 * 但对 heyta 来说，**端点还带着隐私等级**：有的是本机（明文没出设备），
 * 有的是远端（明文出了设备）。
 *
 * 所以有一条通用网关不会有的规则：
 *
 *   **回退不得跨越隐私边界。**
 *
 * 具体说：候选链是 `[本地 Ollama, 云端]`，本地挂了 —— **不许**悄悄发给云端。
 * 那不是"高可用"，那是**在用户没同意的情况下把数据送出去**。
 * 通用网关做这件事是对的，因为它没有"本机"这个概念。
 *
 * 本文件用 `fallback-needs-consent` 这个**独立的失败原因**把它钉住，
 * 并有测试断言：**这种情况下一次网络请求都不发**。
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ## 三道闸，缺一不可（照抄 Joplin 的双开关 + 本项目的出境授权）
 *
 * | 顺序 | 闸 | 关掉时的含义 |
 * |---|---|---|
 * | 1 | `enabled`（总开关） | 整个 AI 关掉 |
 * | 2 | `allowRemote`（允许远程） | 只用本机端点，远端端点**不进入候选** |
 * | 3 | 出境授权 `(功能, 目的地)` | 这一个功能、这一个目的地，用户还没同意 |
 *
 * ⚠️ 第 2 道与第 3 道**不是重复**：
 *   - 第 2 道是"我根本不想用云"（粗粒度、一次设定、长期有效）
 *   - 第 3 道是"这个功能可以发，但那个功能不行"（细粒度、按功能、可撤销）
 * 合并成一道就会丢掉其中一个语义。
 *
 * ## 依赖策略
 *
 * 与 `provider.ts` 一致：**零运行时依赖、零厂商 SDK**，只用 OpenAI 兼容 HTTP。
 * 密钥**只通过 `SecretStore` 端口取**，本文件从不持有密钥字面量 ——
 * 这样"密钥必须进系统钥匙串"就成了一条**类型上做得到、做错很别扭**的事。
 */

import {
  classifyDestination,
  describeDestination,
  type EgressDestination,
} from './supply.js';
import { authorizeEgress, type AiFeature, type EgressConsent } from './egress.js';
import { extractContent, type AiFailure, type AiResult, type AiSuggestion } from './provider.js';

// ─────────────────────────────────────────────────────────────────────────
// 配置
// ─────────────────────────────────────────────────────────────────────────

/**
 * 一个端点。
 *
 * 🔴 注意这里**没有 `apiKey` 字段**，只有 `keyRef`。
 * 密钥本身由 `SecretStore` 端口提供（壳实现：系统钥匙串）。
 * 这是刻意的：**配置文件会被同步/导出/贴进 issue**，而钥匙串里的不会。
 * 对照 ADR-0005 §3.2.1 与 Obsidian Copilot 的做法
 * （"Keys are stored in this device's Obsidian Keychain, not in the vault's data.json"）。
 */
export interface AiEndpointConfig {
  /** 稳定标识。健康记录、钥匙串引用、路由表都指它 —— **改了等于换了端点**。 */
  id: string;
  /** 展示名，给用户看。 */
  label: string;
  /** OpenAI 兼容 base（例如 `http://localhost:11434/v1`）。 */
  endpoint: string;
  /** 默认模型。路由目标可以覆盖它。 */
  model: string;
  /**
   * 该端点**显式声明**支持的能力。
   *
   * 🔴 **不做任何推断。** 这是从 SSOS 的经验里学来的反面教训：
   * 它有一个 `VISION_PROVIDERS` 集合，按 provider 名猜谁支持视觉 ——
   * 那种写法**随模型改名即失效**，而且失效时是静默的
   * （猜测结果看起来永远合理）。
   *
   * ⚠️ `undefined` 的含义是**"只声明了基线能力"**，不是"支持一切"：
   * 默认只当作支持 `structured_output`（OpenAI 兼容的 chat 总可以被要求输出 JSON）。
   * `vision` / `tool_calling` / `long_context` **必须显式写出来**。
   * 这样"没配"= 保守，而不是"没配"= 放开。
   */
  capabilities?: readonly AiCapability[];
  /** 钥匙串引用。本机端点（Ollama）通常不需要。 */
  keyRef?: string;
  /** 单独禁用某个端点，不必把它从配置里删掉。 */
  disabled?: boolean;
}

/**
 * 能力词表。
 *
 * 调用方说的是**能力**，不是"哪个模型" —— 这样换模型不需要改调用点。
 * 移植自 SSOS 的三层词表（task → workload → capability），
 * 但只保留 heyta 真正需要的四项。
 */
export type AiCapability =
  | 'structured_output'
  | 'vision'
  | 'long_context'
  | 'tool_calling';

/**
 * 每个功能**至少**需要哪些能力。
 *
 * 与 SSOS 的 `requiredCapabilities` 同构：用 `every()` 做单表达式过滤，
 * 而不是散在各处的 if。
 */
export const DEFAULT_FEATURE_CAPABILITIES: Readonly<
  Record<AiFeature, readonly AiCapability[]>
> = {
  capture: ['structured_output'],
  breakdown: ['structured_output', 'long_context'],
  prioritize: ['structured_output'],
  'duration-estimate': ['structured_output'],
};

/** 端点未声明能力时的默认值 —— 只有基线，不含视觉/工具/长上下文。 */
const BASELINE_CAPABILITIES: readonly AiCapability[] = ['structured_output'];

/** 路由目标：某个端点 + 可选的模型覆盖。 */
export interface AiRouteTarget {
  endpointId: string;
  /** 覆盖端点的默认模型 —— 同一个端点给不同功能配不同模型是常见需求。 */
  model?: string;
}

/**
 * 完整配置。
 *
 * ⚠️ `routes` 里的 key 是 `AiFeature`。**没配的功能就是不提供**，
 * 而不是"回退到默认模型" —— 后者会让一个没打算启用 AI 的功能悄悄跑起来。
 */
export interface AiRoutingConfig {
  /** 第 1 道闸：总开关。**默认必须是 false。** */
  enabled: boolean;
  /** 第 2 道闸：允许远程。**默认必须是 false**（照抄 Joplin 的 `Allow remote AI providers`）。 */
  allowRemote: boolean;
  endpoints: readonly AiEndpointConfig[];
  /** 功能 → 有序候选链。顺序即回退顺序。 */
  routes: Partial<Record<AiFeature, readonly AiRouteTarget[]>>;
}

/** 超时与重试策略。 */
export interface AiRoutingPolicy {
  /**
   * **跨端点**的总尝试上限。
   *
   * ⚠️ 它是"尝试次数"不是"端点数"：同一个端点不会重复试两次
   * （同一个端点立刻重试几乎必然再失败，只会让用户多等一个超时）。
   */
  maxAttempts: number;
  /** 单次请求超时（ms）。 */
  timeoutMs: number;
  /** 连续失败多少次后**跳闸**（跳闸 = 冷却期内不再尝试这个端点）。 */
  circuitFailureThreshold: number;
  /** 跳闸后的冷却时长（ms）。 */
  circuitCooldownMs: number;
}

/**
 * ⚠️ 默认值**刻意偏保守**。理由：这是任务管理，不是批处理。
 * 用户盯着一个输入框等结果，超过十几秒就已经算"坏了"。
 *
 * 对照真实网关的取值（本机 CC Switch 的 `proxy_config`：`max_retries=6`、
 * `non_streaming_timeout=600s`、`circuit_failure_threshold=4~8`、冷却 60~90s）：
 * 那些数字是给**无人值守的长任务**用的，直接搬过来会让用户在输入框前站 10 分钟。
 */
export const DEFAULT_ROUTING_POLICY: AiRoutingPolicy = {
  maxAttempts: 2,
  timeoutMs: 30_000,
  circuitFailureThreshold: 3,
  circuitCooldownMs: 60_000,
};

// ─────────────────────────────────────────────────────────────────────────
// 密钥端口
// ─────────────────────────────────────────────────────────────────────────

/**
 * 密钥读取端口。
 *
 * 壳负责实现：原生端用系统钥匙串，Web 端**没有钥匙串** ——
 * 所以 Web 端只能实现成"内存中、会话级"，并在 UI 上说明"关掉页面就没了"。
 * 这是 ADR-0005 §3.2.2 的结论（Web 上的 BYOK 架构上就不牢），
 * 本文件不替它遮掩。
 */
export interface SecretStore {
  get(keyRef: string): Promise<string | undefined>;
}

/** 没有密钥的 store。给本机端点（不需要密钥）与测试用。 */
export const EMPTY_SECRET_STORE: SecretStore = {
  get: () => Promise.resolve(undefined),
};

// ─────────────────────────────────────────────────────────────────────────
// 健康与熔断
// ─────────────────────────────────────────────────────────────────────────

/** 一个端点的健康状态。**可持久化**（但它是本机偏好，不进 op-log）。 */
export interface EndpointHealth {
  endpointId: string;
  consecutiveFailures: number;
  /** 跳闸到这个时刻为止（epoch ms）。`undefined` = 未跳闸。 */
  circuitOpenUntil?: number;
  lastError?: string;
  lastSuccessAt?: number;
}

/** 全部端点健康状态。 */
export type HealthMap = Readonly<Record<string, EndpointHealth>>;

export const EMPTY_HEALTH: HealthMap = {};

/** 这个端点现在能不能用（未跳闸）。 */
export function isAvailable(health: EndpointHealth | undefined, now: number): boolean {
  if (health?.circuitOpenUntil === undefined) return true;
  return now >= health.circuitOpenUntil;
}

/**
 * 根据一次调用结果更新健康状态。
 *
 * 🔴 **只有"端点自己的问题"才计入失败。** 这条必须写清楚，
 * 否则会出现最难查的一类 bug：**把自己的错误记到端点头上，于是好好的端点被跳闸**。
 *
 * | 结果 | 是否计入 | 理由 |
 * |---|---|---|
 * | `network` / `http-error` / `empty-response` | ✅ 计入 | 端点确实没给出可用结果 |
 * | `egress-not-authorized` | ❌ **不计入** | 是**我们没获授权**，与端点无关 |
 * | `not-configured` | ❌ 不计入 | 配置问题 |
 * | `fallback-needs-consent` | ❌ **不计入** | 同上，而且它是**回退被隐私拦住**，端点本身是好的 |
 *
 * 「跳闸」的判据是**连续**失败：一次成功立刻清零。
 */
export function recordOutcome(
  health: HealthMap,
  endpointId: string,
  outcome: { ok: true } | { ok: false; reason: AiFailure['reason'] },
  policy: AiRoutingPolicy,
  now: number,
): HealthMap {
  const previous = health[endpointId] ?? { endpointId, consecutiveFailures: 0 };

  if (outcome.ok) {
    return {
      ...health,
      [endpointId]: {
        endpointId,
        consecutiveFailures: 0,
        lastSuccessAt: now,
      },
    };
  }

  // 不是端点的错 → 原样保留（连 consecutiveFailures 都不动）
  if (!countsAsEndpointFailure(outcome.reason)) return health;

  const consecutiveFailures = previous.consecutiveFailures + 1;
  const shouldTrip = consecutiveFailures >= policy.circuitFailureThreshold;
  return {
    ...health,
    [endpointId]: {
      endpointId,
      consecutiveFailures,
      ...(shouldTrip ? { circuitOpenUntil: now + policy.circuitCooldownMs } : {}),
      ...(previous.lastSuccessAt === undefined ? {} : { lastSuccessAt: previous.lastSuccessAt }),
      lastError: outcome.reason,
    },
  };
}

/** 这个失败原因算不算"端点的错"。导出是为了让测试能直接钉住这张表。 */
export function countsAsEndpointFailure(reason: AiFailure['reason']): boolean {
  switch (reason) {
    case 'network':
    case 'http-error':
    case 'empty-response':
      return true;
    case 'not-configured':
    case 'egress-not-authorized':
    case 'fallback-needs-consent':
    case 'no-route':
      return false;
  }
}

/**
 * 失败是否值得**换下一个端点**。
 *
 * 与 `countsAsEndpointFailure` 是**两个不同的问题**，不要合并：
 *   - "要不要记它一笔" → 端点的锅吗
 *   - "要不要换下一个" → 换个端点有可能成功吗
 *
 * 例：`http-error 401`（凭据错）**要换下一个**（另一个端点的凭据可能是对的），
 * 但它**也是端点的锅**（这个端点的凭据确实错了）。
 * 而 `http-error 400`（请求格式错）**不该换**：我们发的东西就是错的，
 * 换谁都会 400，只会把同一个错误重放一遍、让排查更难。
 */
export function shouldTryNextEndpoint(failure: AiFailure): boolean {
  switch (failure.reason) {
    case 'network':
    case 'empty-response':
      return true;
    case 'http-error': {
      const status = failure.status;
      if (status === undefined) return true;
      // 400 / 422：请求本身有问题，换端点也一样
      if (status === 400 || status === 422) return false;
      // 401/402/403/404/429/5xx：都可能是这个端点特有的
      //  401/403 凭据、402 余额、404 模型名、429 限流、5xx 上游故障
      return true;
    }
    // 🔴 这两个**必须**是 false：
    //  - 没授权 → 换下一个端点不是"重试"，是**换一个目的地偷发**
    //  - 回退被隐私拦住 → 正是我们要停下来问用户的那一刻
    case 'egress-not-authorized':
    case 'fallback-needs-consent':
      return false;
    case 'not-configured':
    case 'no-route':
      return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 端点 URL 校验
// ─────────────────────────────────────────────────────────────────────────

export type EndpointUrlVerdict =
  | { ok: true; destination: EgressDestination }
  | { ok: false; reason: 'unparseable' | 'bad-scheme' | 'credentials-in-url' | 'plaintext-remote'; message: string };

/**
 * 校验端点 URL。
 *
 * 移植自 SSOS 的一条**最有价值的做法**：它的 `isAllowedAIBaseUrl` 要求 https、
 * 拒 userinfo/query/hash、按 IP 段拒私有地址，并且——
 * 🔴 **在"写入"和"发送"两个点都执行**。它自己的注释说得最好：
 *
 * > "Enforcement has to sit on the path that actually sends the request,
 * >  not only on the path that stores it."
 *
 * 也就是：**只在保存时校验是不够的**，因为配置可能来自导入、同步、
 * 或一个绕过保存路径的写入。请求真正发出的那一刻必须再查一次。
 * 本文件两处都调它（`resolveRoute` 与 `attemptOnce`）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 但规则**必须反向改一条**：SSOS **拒绝 localhost**，而 heyta **必须允许它**。
 *
 * SSOS 是服务端产品，端点必然是公网服务，所以"拒私有地址"对它是对的
 * （那条规则防的是 SSRF：让服务器去访问内网）。
 * heyta 是**本地优先**的：`http://localhost:11434/v1`（Ollama）
 * 正是我们**最想支持**的那种端点 —— 明文根本没出设备。
 * 照抄 SSOS 会把最主要的使用场景拒掉。
 *
 * 所以本函数的规则是**按目的地分岔**的：
 *
 * | 端点 | 明文 HTTP | HTTPS |
 * |---|---|---|
 * | 回环（本机） | ✅ **允许** | ✅ 允许 |
 * | 远端 | ❌ **拒绝** | ✅ 允许 |
 *
 * 最后一条不是洁癖：**远端明文 HTTP 意味着用户的提示内容会以明文经过网络**，
 * 而 heyta 的同步通道是端到端加密的 —— 在 AI 这条路上退化成明文 HTTP
 * 会让整个产品的隐私承诺自相矛盾。要发到远端就必须是 https。
 */
export function validateEndpointUrl(raw: string): EndpointUrlVerdict {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return {
      ok: false,
      reason: 'unparseable',
      message: `端点地址无法解析：${raw}`,
    };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return {
      ok: false,
      reason: 'bad-scheme',
      message: `端点必须是 http 或 https，当前是 ${url.protocol}`,
    };
  }

  // URL 里带凭据会把密钥写进配置、日志、以及任何打印这个 URL 的地方。
  if (url.username !== '' || url.password !== '') {
    return {
      ok: false,
      reason: 'credentials-in-url',
      message: '端点地址里不要写用户名/密码，请用独立的凭据字段。',
    };
  }

  const destination = classifyDestination({ mode: 'own', endpoint: raw });

  if (url.protocol === 'http:' && destination !== 'none') {
    return {
      ok: false,
      reason: 'plaintext-remote',
      message:
        '远端端点必须是 https。' +
        '用明文 http 发到远端，意味着你的任务内容会以明文经过网络 —— ' +
        '这与 heyta 的端到端加密承诺冲突。' +
        '（本机端点不受此限制：http://localhost:11434/v1 是允许的。）',
    };
  }

  return { ok: true, destination };
}

/** 该端点声明支持的能力。未声明 → 只有基线能力（**保守方向**）。 */
export function endpointCapabilities(endpoint: AiEndpointConfig): readonly AiCapability[] {
  return endpoint.capabilities ?? BASELINE_CAPABILITIES;
}

// ─────────────────────────────────────────────────────────────────────────
// 候选解析
// ─────────────────────────────────────────────────────────────────────────

/** 一个已解析、待尝试的候选。 */
export interface ResolvedCandidate {
  target: AiRouteTarget;
  endpointConfig: AiEndpointConfig;
  /** 由端点推导的目的地。**不是从配置里读的**（见 `supply.ts` 的 `classifyDestination`）。 */
  destination: EgressDestination;
  model: string;
}

/** 候选被排除的原因。**必须能解释给用户听**，不能只是"没试"。 */
export type CandidateExclusionReason =
  | 'endpoint-missing'
  | 'endpoint-disabled'
  | 'remote-not-allowed'
  | 'circuit-open'
  | 'capability-missing'
  | 'endpoint-url-rejected';

export interface CandidateExclusion {
  target: AiRouteTarget;
  reason: CandidateExclusionReason;
}

export interface RouteResolution {
  /** 有序候选（会被尝试的顺序）。 */
  candidates: readonly ResolvedCandidate[];
  /** 被排除的候选和原因。UI 用它解释"为什么只试了一个"。 */
  excluded: readonly CandidateExclusion[];
  /** 该功能压根没配路由。 */
  unconfigured: boolean;
}

/**
 * 解析某个功能的有序候选链。
 *
 * 它会**过滤掉**三类候选（而不是让它们在里面失败）：
 *   1. 端点不存在 / 被单独禁用
 *   2. 远端端点但 `allowRemote === false`
 *   3. 端点已跳闸（还在冷却）
 *
 * ⚠️ 第 2 类**不是**"授权失败"，是"用户不想用云" ——
 * 所以它被排除在候选之外、不产生授权询问。这个区别很重要：
 * **不想用云的人不该被反复弹"要不要授权云"。**
 */
export function resolveRoute(
  config: AiRoutingConfig,
  feature: AiFeature,
  options: { health?: HealthMap; now: number },
): RouteResolution {
  const byId = new Map(config.endpoints.map((e) => [e.id, e]));
  const health = options.health ?? EMPTY_HEALTH;
  const targets = config.routes[feature];

  if (targets === undefined || targets.length === 0) {
    return { candidates: [], excluded: [], unconfigured: true };
  }

  const required = requiredCapabilities(feature);
  const candidates: ResolvedCandidate[] = [];
  const excluded: CandidateExclusion[] = [];

  for (const target of targets) {
    const endpointConfig = byId.get(target.endpointId);
    if (endpointConfig === undefined) {
      excluded.push({ target, reason: 'endpoint-missing' });
      continue;
    }
    if (endpointConfig.disabled === true) {
      excluded.push({ target, reason: 'endpoint-disabled' });
      continue;
    }

    // ① URL 校验（第一次：解析候选时）
    const verdict = validateEndpointUrl(endpointConfig.endpoint);
    if (!verdict.ok) {
      excluded.push({ target, reason: 'endpoint-url-rejected' });
      continue;
    }
    const destination = verdict.destination;

    // ② 第 2 道闸：不允许远程时，远端端点直接不进入候选。
    if (destination !== 'none' && !config.allowRemote) {
      excluded.push({ target, reason: 'remote-not-allowed' });
      continue;
    }

    // ③ 能力过滤（单表达式，与 SSOS 的 requiredCapabilities.every 同构）
    const declared = endpointCapabilities(endpointConfig);
    if (!required.every((cap) => declared.includes(cap))) {
      excluded.push({ target, reason: 'capability-missing' });
      continue;
    }

    // ④ 熔断
    if (!isAvailable(health[endpointConfig.id], options.now)) {
      excluded.push({ target, reason: 'circuit-open' });
      continue;
    }

    candidates.push({
      target,
      endpointConfig,
      destination,
      model: target.model ?? endpointConfig.model,
    });
  }

  return { candidates, excluded, unconfigured: false };
}

/**
 * 某个功能需要哪些能力。
 *
 * 抽成函数是留一个覆盖点：将来若要按用户设置调（例如"允许用视觉模型做拆解"），
 * 只改这里，不用改路由主体。
 */
export function requiredCapabilities(feature: AiFeature): readonly AiCapability[] {
  return DEFAULT_FEATURE_CAPABILITIES[feature];
}

// ─────────────────────────────────────────────────────────────────────────
// 路由调用
// ─────────────────────────────────────────────────────────────────────────

export interface RoutedDeps {
  secretStore?: SecretStore;
  fetchImpl?: typeof fetch;
  /** 时钟。**注入是为了测试能确定性地验证跳闸与冷却**（AGENTS.md §7 #25）。 */
  now?: () => number;
  /**
   * 起始健康状态。
   *
   * ⚠️ 它也可以走 `invokeRouted` 的返回值链（上一次的 `health` 传回来），
   * 这里是给"从磁盘恢复的历史健康状态"用的 —— 冷却要跨会话才有意义，
   * 否则重启一次就把熔断忘了，等于没有熔断。
   */
  healthSeed?: HealthMap;
}

/** 一次路由调用的可观察账本 —— UI 与测试都读它。 */
export interface RouteAttempt {
  endpointId: string;
  destination: EgressDestination;
  model: string;
  ok: boolean;
  reason?: AiFailure['reason'];
  status?: number;
}

export interface RoutedOutcome {
  result: AiResult;
  /** 按发生顺序记录的尝试。 */
  attempts: readonly RouteAttempt[];
  /** 更新后的健康状态。**调用方负责持久化**（它是本机偏好，不进 op-log）。 */
  health: HealthMap;
  /** 候选解析结果（含被排除项），供 UI 解释。 */
  resolution: RouteResolution;
}

/**
 * 路由调用：**唯一对外入口**。
 *
 * 流程：
 *   1. 总开关 → 关了就明确失败
 *   2. 解析候选（含两道静默过滤：不允许远程、已跳闸）
 *   3. 逐候选：**先过出境闸门**，再发请求
 *   4. 失败了看 `shouldTryNextEndpoint` 决定要不要继续
 *
 * 🔴 第 3 步的顺序是硬性的：**授权检查必须在网络动作之前**。
 * 每个候选**各自**过一次闸门，因为每个候选的目的地可能不同 ——
 * 这正是"回退不得跨越隐私边界"的实现方式。
 */
export async function invokeRouted(
  config: AiRoutingConfig,
  invocation: {
    feature: AiFeature;
    system: string;
    user: string;
    fields: readonly string[];
  },
  consents: readonly EgressConsent[],
  policy: AiRoutingPolicy = DEFAULT_ROUTING_POLICY,
  deps: RoutedDeps = {},
): Promise<RoutedOutcome> {
  const now = deps.now ?? Date.now;
  const secretStore = deps.secretStore ?? EMPTY_SECRET_STORE;
  const doFetch = deps.fetchImpl ?? globalThis.fetch;

  let health = deps.healthSeed ?? EMPTY_HEALTH;

  const resolution = resolveRoute(config, invocation.feature, { health, now: now() });

  // ── 第 1 道闸 ────────────────────────────────────────────────────────
  if (!config.enabled) {
    return {
      result: {
        ok: false,
        reason: 'not-configured',
        message: 'AI 未启用。在设置里打开总开关，并选择至少一个端点。',
      },
      attempts: [],
      health,
      resolution,
    };
  }

  if (resolution.unconfigured) {
    return {
      result: {
        ok: false,
        reason: 'no-route',
        message: `功能「${invocation.feature}」没有配置任何端点。`,
      },
      attempts: [],
      health,
      resolution,
    };
  }

  if (resolution.candidates.length === 0) {
    return {
      result: {
        ok: false,
        reason: 'no-route',
        message: explainNoCandidate(resolution),
      },
      attempts: [],
      health,
      resolution,
    };
  }

  const attempts: RouteAttempt[] = [];
  let lastFailure: AiFailure | undefined;
  /** 见过"被隐私拦住的回退"就记下来 —— 它要和普通失败区分开报给用户。 */
  let blockedByConsent: { destination: EgressDestination; disclosureText: string } | undefined;

  const limit = Math.min(policy.maxAttempts, resolution.candidates.length);

  for (let index = 0; index < limit; index += 1) {
    const candidate = resolution.candidates[index];
    if (candidate === undefined) break;

    // ── 第 3 道闸：出境授权。**必须在网络之前。** ────────────────────
    const decision = authorizeEgress(
      { feature: invocation.feature, destination: candidate.destination, fields: invocation.fields },
      consents,
    );
    if (!decision.allowed) {
      const isFirst = index === 0;
      if (isFirst) {
        // 首选就没授权 → 就是"需要授权"，照常报
        const d = decision.disclosure;
        const retention = d.retentionText === undefined ? '（保留策略未定案）' : d.retentionText;
        return {
          result: {
            ok: false,
            reason: 'egress-not-authorized',
            message:
              `该功能需要你先授权数据出境。\n发送内容：${d.fields.join('、') || '（无）'}\n` +
              `${d.destinationText}\n保留：${retention}`,
          },
          attempts,
          health,
          resolution,
        };
      }

      // 🔴🔴 这是本文件存在的理由：**首选失败后，回退目标在隐私边界之外。**
      // 不许发，也不许"静默跳过当作没这回事" —— 要明确告诉用户
      // "本地的都挂了，接下来那个要出设备，你得先同意"。
      blockedByConsent = {
        destination: candidate.destination,
        disclosureText: decision.disclosure.destinationText,
      };
      break;
    }

    // ── 网络 ─────────────────────────────────────────────────────────
    const apiKey = candidate.endpointConfig.keyRef === undefined
      ? undefined
      : await secretStore.get(candidate.endpointConfig.keyRef);

    const failure = await attemptOnce(
      candidate,
      apiKey,
      invocation,
      doFetch,
      policy.timeoutMs,
    );

    if (!failure.ok) {
      attempts.push({
        endpointId: candidate.endpointConfig.id,
        destination: candidate.destination,
        model: candidate.model,
        ok: false,
        reason: failure.reason,
        ...(failure.status === undefined ? {} : { status: failure.status }),
      });
      health = recordOutcome(health, candidate.endpointConfig.id, { ok: false, reason: failure.reason }, policy, now());
      lastFailure = failure;

      if (!shouldTryNextEndpoint(failure)) break;
      continue;
    }

    attempts.push({
      endpointId: candidate.endpointConfig.id,
      destination: candidate.destination,
      model: candidate.model,
      ok: true,
    });
    health = recordOutcome(health, candidate.endpointConfig.id, { ok: true }, policy, now());

    return {
      result: {
        ok: true,
        suggestion: {
          feature: invocation.feature,
          text: failure.text,
          destination: candidate.destination,
        },
      },
      attempts,
      health,
      resolution,
    };
  }

  // ── 收尾：优先报"被隐私拦住"，因为它需要用户做一个决定 ──────────────
  if (blockedByConsent !== undefined) {
    const tried = attempts.filter((a) => !a.ok).map((a) => a.endpointId).join('、');
    return {
      result: {
        ok: false,
        reason: 'fallback-needs-consent',
        message:
          `首选端点（${tried === '' ? '无' : tried}）没有给出结果。\n` +
          `下一个备用端点在**你的设备之外** —— ${blockedByConsent.disclosureText}\n` +
          `heyta 不会替你决定，所以停在这里。要让它作为备用，请在设置里授权这个功能。`,
      },
      attempts,
      health,
      resolution,
    };
  }

  return {
    result: lastFailure ?? {
      ok: false,
      reason: 'no-route',
      message: '没有可用的端点。',
    },
    attempts,
    health,
    resolution,
  };
}

/** 单次尝试。抽出来是为了让上面的循环保持可读。 */
async function attemptOnce(
  candidate: ResolvedCandidate,
  apiKey: string | undefined,
  invocation: { system: string; user: string },
  doFetch: typeof fetch,
  timeoutMs: number,
): Promise<{ ok: true; text: string } | AiFailure> {
  // 🔴🔴 第二次 URL 校验 —— **在真正要发的那一刻**。
  //
  // 移植自 SSOS 最有价值的一条工程实践（原文见 `validateEndpointUrl` 注释）：
  // "Enforcement has to sit on the path that actually sends the request,
  //  not only on the path that stores it."
  //
  // 为什么这里要再查一遍（`resolveRoute` 已经查过了）：
  // 配置可能来自**导入 / 同步 / 迁移 / 手工改文件**，任何一条路径都可能
  // 绕过保存时的校验。而这里是**唯一的实际发送点** ——
  // 把控制放在这里，就等于"无论配置从哪来，出去的东西都得先过这一关"。
  //
  // ⚠️ 这不是重复代码，是**纵深防御**。删掉它，校验就退化成"只防君子"。
  const verdict = validateEndpointUrl(candidate.endpointConfig.endpoint);
  if (!verdict.ok) {
    return {
      ok: false,
      reason: 'http-error',
      message: `端点「${candidate.endpointConfig.label}」被拒绝：${verdict.message}`,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const res = await doFetch(`${candidate.endpointConfig.endpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(apiKey !== undefined && apiKey !== '' ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      // 数据面**恰好**是 system + user。没有别的字段。
      body: JSON.stringify({
        model: candidate.model,
        messages: [
          { role: 'system', content: invocation.system },
          { role: 'user', content: invocation.user },
        ],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      return {
        ok: false,
        reason: 'http-error',
        status: res.status,
        message: `端点「${candidate.endpointConfig.label}」返回 ${String(res.status)}。`,
      };
    }

    const json: unknown = await res.json();
    const text = extractContent(json);
    if (text === undefined || text.trim() === '') {
      return {
        ok: false,
        reason: 'empty-response',
        message: `端点「${candidate.endpointConfig.label}」返回了空内容。`,
      };
    }
    return { ok: true, text };
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    return {
      ok: false,
      reason: 'network',
      message: aborted
        ? `端点「${candidate.endpointConfig.label}」超过 ${String(timeoutMs)} 毫秒未返回。`
        : `无法连接端点「${candidate.endpointConfig.label}」：${
            error instanceof Error ? error.message : String(error)
          }`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** 把"一个候选都没有"翻译成用户能看懂的一句话。 */
function explainNoCandidate(resolution: RouteResolution): string {
  const reasons = resolution.excluded.map((e) => e.reason);
  if (reasons.includes('remote-not-allowed') && reasons.length === 1) {
    return (
      '该功能的端点全部在你的设备之外，而你没有允许远程端点。\n' +
      '这不是故障：heyta 默认只用本机端点。要使用云端，请在设置里打开"允许远程端点"。'
    );
  }
  if (reasons.includes('circuit-open')) {
    return '端点连续失败已暂时停用（熔断冷却中）。稍后会自动恢复。';
  }
  if (reasons.includes('endpoint-url-rejected')) {
    return (
      '端点地址没通过校验。常见原因：远端端点用了明文 http（必须是 https）、' +
      '地址里带了用户名密码、或地址写错了。'
    );
  }
  if (reasons.includes('capability-missing')) {
    return (
      '没有端点声明支持该功能需要的能力。' +
      '能力和模型不同，它必须由端点在设置里**显式声明** —— ' +
      'heyta 不按模型名去猜（猜错的代价是静默失败）。'
    );
  }
  if (reasons.includes('endpoint-missing')) {
    return '路由指向了一个不存在的端点 —— 配置可能已损坏。';
  }
  return '没有可用的端点。检查设置里的端点与路由。';
}

/**
 * 给 UI 用：这个功能现在"会走到哪里"。
 *
 * ⚠️ 它只做**静态**推导（不含健康状态），所以是"配置意图"而不是"实际会怎样"。
 * 名称上区分开，免得 UI 拿它当实时状态显示。
 */
export function describeRouteIntent(
  config: AiRoutingConfig,
  feature: AiFeature,
): { destination: EgressDestination; labels: readonly string[] } {
  const resolution = resolveRoute(config, feature, { now: 0 });
  const labels = resolution.candidates.map((c) => `${c.endpointConfig.label}（${c.model}）`);
  const first = resolution.candidates[0];
  return {
    destination: first?.destination ?? 'none',
    labels,
  };
}

/** 目的地的人类可读说明 —— 转发 `supply.ts` 的实现，避免两处措辞漂移。 */
export { describeDestination };
