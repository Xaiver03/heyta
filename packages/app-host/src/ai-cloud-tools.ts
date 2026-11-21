/**
 * 云端工具客户端 —— "tool calling 只针对云端" 的**客户端半边**。
 *
 * ## 它解决什么
 *
 * 产品裁决 D5：Agent 的工具调用只打**云端**，不碰设备本地文件/进程。
 * 本模块把已授权的工具目录（`@heyta/local-api` 的 30 个工具）翻译成
 * **可被任意 Agent 引擎执行的工具定义**：每次 `execute` 都经 `CloudToolTransport`
 * 发一个 HTTP 请求到 heyta 云端 `/api/agent/tools/<name>`，服务端做鉴权/校验/落库。
 *
 * ## 为什么是"引擎无关"的
 *
 * `CloudAgentTool` 的形状就是 `@earendil-works/pi-agent-core` 的 `AgentTool`
 * （`{name,label,description,parameters,execute}`）最小子集 ——
 * 所以同一份数组既能：
 *   · 作为 **PI 内核**的 `customTools` 直接注入（桌面端走 SDK）；
 *   · 作为 **heyta 原生循环**（`requestAssistantTurn` 的工具源）的候选。
 * 这就是设计里的"两引擎、一契约"：契约在这里，引擎按端选择。
 *
 * ## 边界
 *
 * - **未授权即不可见**：`toCloudAgentTools/toCloudToolDescriptors` 只输出 `grants` 里为 true 的工具。
 * - **不可逆动作默认不暴露**：`risk === 'destructive-irreversible'`（purge）默认过滤掉（D7）。
 * - 本模块**不做鉴权判定**（服务端做）；它只保证"发出去的是已授权工具名"。
 * - 传输可注入（`fetchImpl`/`getToken`），测试不需要真网络、也不需要真 token。
 */
import { LOCAL_API_TOOLS, listAuthorizedTools, type LocalApiConfig } from '@heyta/local-api';

/** 一次云端工具调用的结果。失败信息来自服务端，不在客户端重新概括。 */
export type CloudToolInvokeResult =
  | { readonly ok: true; readonly data: unknown }
  | { readonly ok: false; readonly reason: string; readonly message: string };

/** 传输层：把 (工具名, 参数) 发到云端并拿回结果。可注入实现。 */
export interface CloudToolInvokeOptions {
  /**
   * 幂等键：服务端据此去重（重放返回同一结果），避免"跨进程/跨端重试重复落库"。
   * 写请求应带；读请求可不带。
   */
  readonly idempotencyKey?: string;
}

export interface CloudToolTransport {
  invoke(
    name: string,
    args: Readonly<Record<string, unknown>>,
    signal?: AbortSignal,
    options?: CloudToolInvokeOptions,
  ): Promise<CloudToolInvokeResult>;
}

export interface HttpCloudToolTransportOptions {
  /** heyta 云端根地址（末尾斜杠可有可无）。 */
  readonly baseUrl: string;
  /** 取当前用户的短期访问 token（每次调用时求值，支持用户后填地址/登录）。 */
  readonly getToken?: () => string | undefined;
  /** 注入 fetch（测试用）；默认 `globalThis.fetch`。 */
  readonly fetchImpl?: typeof fetch;
  /** 工具 API 前缀，默认 `/api/agent/tools`。 */
  readonly pathPrefix?: string;
}

/** 去掉末尾斜杠，避免 `//`。 */
function trimBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

/** 客户端要识别的服务端结果信封（与 `docs/reference/agent-tools-api.md` 对齐）。 */
function parseInvokeResult(payload: unknown): CloudToolInvokeResult {
  if (payload !== null && typeof payload === 'object') {
    const rec = payload as Record<string, unknown>;
    if (rec['ok'] === true) return { ok: true, data: rec['data'] };
    if (rec['ok'] === false) {
      return {
        ok: false,
        reason: typeof rec['reason'] === 'string' ? rec['reason'] : 'failed',
        message: typeof rec['message'] === 'string' ? rec['message'] : '工具执行失败。',
      };
    }
  }
  return { ok: false, reason: 'bad-envelope', message: '服务端返回了无法识别的结果。' };
}

/**
 * 默认传输：真实 HTTP。**每次都过 token 取值器**（用户可能后登录/换账号）。
 *
 * 🔴 token 绝不出现在 URL（只放 Authorization 头）；工具参数只放 body。
 */
export function createHttpCloudToolTransport(
  options: HttpCloudToolTransportOptions,
): CloudToolTransport {
  const fetchImpl = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const prefix = options.pathPrefix ?? '/api/agent/tools';
  return {
    async invoke(name, args, signal, callOptions) {
      const token = options.getToken?.();
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (token !== undefined && token !== '') headers['authorization'] = `Bearer ${token}`;
      if (callOptions?.idempotencyKey !== undefined && callOptions.idempotencyKey !== '') {
        headers['idempotency-key'] = callOptions.idempotencyKey;
      }
      let response: Response;
      try {
        response = await fetchImpl(`${trimBase(options.baseUrl)}${prefix}/${encodeURIComponent(name)}`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ args }),
          ...(signal === undefined ? {} : { signal }),
        });
      } catch (error: unknown) {
        return {
          ok: false,
          reason: 'network',
          message: error instanceof Error ? error.message : '网络请求失败。',
        };
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        return { ok: false, reason: `http-${String(response.status)}`, message: '服务端没有返回 JSON。' };
      }
      const parsed = parseInvokeResult(payload);
      // 非 2xx 但信封说 ok:false 的，用信封；否则按 HTTP 失败。
      if (!response.ok && parsed.ok) {
        return { ok: false, reason: `http-${String(response.status)}`, message: '请求失败。' };
      }
      return parsed;
    },
  };
}

/** 生成给模型看的工具描述（原生循环用；与 `AiToolDescriptor` 同形）。 */
export interface CloudToolDescriptor {
  readonly name: string;
  readonly description: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  /**
   * 该工具的**观测结果里可能回送模型的字段**（`实体.字段`），用于出境披露。
   * 云端模型路径会把工具结果回灌给模型 —— 那是出境，字段必须进披露集（审计 P0-1）。
   */
  readonly egressFields?: readonly string[];
}

/**
 * PI 内核兼容的工具定义（`AgentTool` 最小子集）。
 *
 * `execute` 的失败用**抛错**表达（pi-agent-core 的约定：throw → 以 `isError` 回给模型）。
 */
export interface CloudAgentTool {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  /** 观测结果里可能出境的字段（披露用；PI 内核接入方应按它并集披露）。 */
  readonly egressFields?: readonly string[];
  execute(
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: (update: unknown) => void,
  ): Promise<{ content: { type: 'text'; text: string }[]; details: Record<string, unknown> }>;
}

export interface CloudToolSelectOptions {
  /** 是否暴露不可逆动作（默认 false，D7：purge 不给 AI）。 */
  readonly includeIrreversible?: boolean;
}

/** 工具名 → 风险档（来自唯一目录）。 */
function riskByName(): Map<string, string> {
  const map = new Map<string, string>();
  for (const tool of LOCAL_API_TOOLS) map.set(tool.name, tool.risk);
  return map;
}

/** 工具名 → 该工具观测结果里可能出境的字段（来自唯一目录）。 */
function egressByName(): Map<string, readonly string[]> {
  const map = new Map<string, readonly string[]>();
  for (const tool of LOCAL_API_TOOLS) map.set(tool.name, tool.egressFields);
  return map;
}

/** 过滤后的已授权工具名（未授权即不可见 + 默认不暴露不可逆）。 */
function selectToolNames(
  grants: LocalApiConfig['grants'],
  options: CloudToolSelectOptions,
): string[] {
  const risk = riskByName();
  return listAuthorizedTools(grants)
    .map((t) => t.name)
    .filter((name) => (options.includeIrreversible === true ? true : risk.get(name) !== 'destructive-irreversible'));
}

/** 原生循环用：工具描述数组（只含已授权、默认排除不可逆）。 */
export function toCloudToolDescriptors(
  grants: LocalApiConfig['grants'],
  options: CloudToolSelectOptions = {},
): readonly CloudToolDescriptor[] {
  const keep = new Set(selectToolNames(grants, options));
  const egress = egressByName();
  return listAuthorizedTools(grants)
    .filter((t) => keep.has(t.name))
    .map((t) => ({ name: t.name, description: t.description, parameters: t.inputSchema, egressFields: egress.get(t.name) ?? [] }));
}

/**
 * PI 内核用：`customTools` 数组。每个 `execute` 经 `transport` 打云端。
 *
 * `assistantGrants()` 那种"全开"也可传；但**永远只发已授权工具名**。
 */
export function toCloudAgentTools(
  transport: CloudToolTransport,
  grants: LocalApiConfig['grants'],
  options: CloudToolSelectOptions = {},
): readonly CloudAgentTool[] {
  const keep = new Set(selectToolNames(grants, options));
  const egress = egressByName();
  return listAuthorizedTools(grants)
    .filter((t) => keep.has(t.name))
    .map((t) => ({
      name: t.name,
      label: t.name,
      description: t.description,
      parameters: t.inputSchema,
      egressFields: egress.get(t.name) ?? [],
      async execute(toolCallId, params, signal, onUpdate) {
        void onUpdate;
        const result = await transport.invoke(t.name, params ?? {}, signal, { idempotencyKey: toolCallId });
        if (!result.ok) throw new Error(result.message);
        return {
          content: [{ type: 'text', text: JSON.stringify(result.data) }],
          details: { tool: t.name },
        };
      },
    }));
}
