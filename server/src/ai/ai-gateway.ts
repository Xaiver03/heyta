/**
 * AI 接入网关（服务端产品层抽象）。
 *
 * 把"单一 env 上游"升级成**可管理的上游集合**：一组 OpenAI 兼容 upstream（id/名称/
 * baseUrl/model/密钥/启用/权重/优先级）。托管代理（`/api/ai/managed/chat`）从网关
 * **选一个**可用上游去转发，客户端只认统一入口（`invokeRouted → 托管代理 → 网关`）。
 *
 * 配置来源（本文件不碰 DB，先做纯函数 + env）：
 *   · `MANAGED_AI_UPSTREAMS`：JSON 数组（首选，支持多上游/PP 网关）；
 *   · 回退：既有的 `MANAGED_AI_UPSTREAM_BASE_URL/API_KEY/MODEL_ID`（单上游，向后兼容）。
 *
 * 🔴 密钥永不进日志/响应；`redactUpstreams()` 只给管理后台看"配没配"，不回显明文。
 */
import type { ManagedAiConfig } from '../config';

/** 一条 OpenAI 兼容上游。 */
export interface GatewayUpstream {
  readonly id: string;
  readonly label: string;
  /** 必须以 https（托管路径只发境内明文，见 managed-upstream.ts）。 */
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly modelId: string;
  readonly enabled: boolean;
  /** 权重（默认 1）；同优先级内按权重做确定性轮询的替代（此处取最大权重优先，简单可测）。 */
  readonly weight: number;
  /** 优先级（数字越小越先，默认 0）。 */
  readonly priority: number;
}

export interface GatewayParseResult {
  readonly upstreams: readonly GatewayUpstream[];
  /** 解析中被跳过的项及原因（暴露给运维，不吞）。 */
  readonly skipped: readonly { readonly index: number; readonly reason: string }[];
}

function toNum(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/**
 * 从 env 解析网关上游集合。`MANAGED_AI_UPSTREAMS` 优先；否则回退单上游 env。
 * 无法解析的条目进 `skipped`（不静默丢弃），非法整体不抛（返回空，由调用方决定失败样式）。
 */
export function parseGatewayFromEnv(env: Record<string, string | undefined>): GatewayParseResult {
  const skipped: { index: number; reason: string }[] = [];
  const raw = env['MANAGED_AI_UPSTREAMS']?.trim();
  if (raw !== undefined && raw !== '') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { upstreams: [], skipped: [{ index: -1, reason: 'MANAGED_AI_UPSTREAMS 不是合法 JSON' }] };
    }
    if (!Array.isArray(parsed)) {
      return { upstreams: [], skipped: [{ index: -1, reason: 'MANAGED_AI_UPSTREAMS 必须是数组' }] };
    }
    const upstreams: GatewayUpstream[] = [];
    parsed.forEach((item: unknown, index: number) => {
      if (item === null || typeof item !== 'object') {
        skipped.push({ index, reason: '不是对象' });
        return;
      }
      const r = item as Record<string, unknown>;
      const baseUrl = typeof r['baseUrl'] === 'string' ? normalizeBaseUrl(r['baseUrl']) : '';
      const apiKey = typeof r['apiKey'] === 'string' ? r['apiKey'] : '';
      const modelId = typeof r['modelId'] === 'string' ? r['modelId'] : '';
      const id = typeof r['id'] === 'string' && r['id'] !== '' ? r['id'] : `upstream-${String(index)}`;
      if (baseUrl === '' || modelId === '') {
        skipped.push({ index, reason: '缺少 baseUrl/modelId' });
        return;
      }
      upstreams.push({
        id,
        label: typeof r['label'] === 'string' && r['label'] !== '' ? r['label'] : id,
        baseUrl,
        apiKey,
        modelId,
        enabled: r['enabled'] !== false,
        weight: toNum(r['weight'], 1),
        priority: toNum(r['priority'], 0),
      });
    });
    return { upstreams, skipped };
  }
  // 回退：单上游 env（向后兼容）。
  const baseUrl = env['MANAGED_AI_UPSTREAM_BASE_URL']?.trim();
  const apiKey = env['MANAGED_AI_UPSTREAM_API_KEY']?.trim();
  const modelId = env['MANAGED_AI_UPSTREAM_MODEL_ID']?.trim();
  if (baseUrl !== undefined && baseUrl !== '' && modelId !== undefined && modelId !== '') {
    return {
      upstreams: [
        {
          id: 'default',
          label: '默认上游',
          baseUrl: normalizeBaseUrl(baseUrl),
          apiKey: apiKey ?? '',
          modelId,
          enabled: true,
          weight: 1,
          priority: 0,
        },
      ],
      skipped: [],
    };
  }
  return { upstreams: [], skipped: [] };
}

/**
 * 选一条上游：**只在 enabled/有密钥 里选**；先取**最小 priority 档**，档内按 **weight 平滑加权轮询**
 * （SWRR，确定性、无随机）：权重越大的被选中频率越高。返回 `undefined` = 无可用（如实 not-configured）。
 */
const SWRR_STATE = new Map<string, { current: number; total: number }>();

/** 仅供测试/运维：清空加权轮询状态。 */
export function __resetUpstreamSelectionState(): void {
  SWRR_STATE.clear();
}

export function selectUpstream(
  upstreams: readonly GatewayUpstream[],
): GatewayUpstream | undefined {
  // 🔴 必须有密钥：空 key 会变成 `Bearer `（空）照发 → 扣额度 + 明文出网（旧 config 注释的警告）。
  const usable = upstreams.filter((u) => u.enabled && u.baseUrl !== '' && u.modelId !== '' && u.apiKey !== '');
  if (usable.length === 0) return undefined;
  const minPriority = Math.min(...usable.map((u) => u.priority));
  const tier = usable.filter((u) => u.priority === minPriority);
  if (tier.length === 1) return tier[0];
  // SWRR：每个权重 >0 的成员累加自身权重，选当前最大者并减去总权重。
  const ids = tier.map((u) => u.id).sort();
  const key = ids.join('|');
  const total = tier.reduce((sum, u) => sum + Math.max(1, u.weight), 0);
  let pick: GatewayUpstream | undefined;
  let pickWeight = -Infinity;
  for (const u of tier) {
    const w = Math.max(1, u.weight);
    const st = SWRR_STATE.get(`${key}::${u.id}`) ?? { current: 0, total };
    st.current += w;
    st.total = total;
    SWRR_STATE.set(`${key}::${u.id}`, st);
    if (st.current > pickWeight) { pickWeight = st.current; pick = u; }
  }
  if (pick !== undefined) {
    const st = SWRR_STATE.get(`${key}::${pick.id}`)!;
    st.current -= total;
  }
  return pick;
}

/** 取主上游并转成托管代理要的 `ManagedAiConfig`（无可用 → undefined）。 */
export function gatewayPrimaryConfig(
  env: Record<string, string | undefined>,
): ManagedAiConfig | undefined {
  const picked = selectUpstream(parseGatewayFromEnv(env).upstreams);
  return picked === undefined
    ? undefined
    : { baseUrl: picked.baseUrl, apiKey: picked.apiKey, modelId: picked.modelId };
}

/** 给管理后台看的脱敏视图：**不回显 apiKey**，只说配没配。 */
export function redactUpstreams(
  upstreams: readonly GatewayUpstream[],
): readonly (Omit<GatewayUpstream, 'apiKey'> & { readonly hasApiKey: boolean })[] {
  return upstreams.map(({ apiKey, ...rest }) => ({ ...rest, hasApiKey: apiKey !== '' }));
}
