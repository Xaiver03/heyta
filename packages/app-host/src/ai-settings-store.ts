/**
 * AI 设置的**持久化语义**（宿主无关）
 * ==================================
 *
 * 与 `./assistant-tier-settings.ts` 同一条分工：**这里管判断，壳只管通道。**
 *
 * ## 为什么这一层要在 `packages/app-host`
 *
 * 它原先整个住在 `apps/web/src/features/settings/aiStore.ts` 里：默认值、
 * 读回时的清洗、"哪些字段不许从磁盘读"。那些**不全是存储细节**，而是隐私判断：
 *
 *   · `enabled` / `allowRemote` / `memoryEnabled` 只认**逐字 `true`**
 *     —— `"true"`、`1`、`undefined` 一律算关（fail-closed，ADR-0010 §3.1 / ADR-0014）。
 *   · 🔴 `localApi.bindAddress` **永远不从存储里读**，只用默认的回环地址 ——
 *     读回来等于让一次配置篡改把本机服务静默暴露到局域网（ADR-0011 §3.1）。
 *   · 不合法的端点**直接丢掉**而不是留着（留着的表现是"AI 时好时坏"，
 *     用户会去排查一个根本不存在的毛病）。
 *   · 解析失败回到**全关的默认值**，而不是抛错、更不是"用一份猜出来的配置继续跑"。
 *
 * 移动壳接 AI 时**必然要再写一遍这四条**，而四条里任何一条写得宽松一点，
 * 症状都是"这台设备上那道闸其实没关上"，并且**没有任何一层会报错** ——
 * 这正是 AGENTS.md §3.5 记过两次的形状（`createTaskActions`、`SyncClientOptions`）。
 * 所以这里把它抽成一份，web 那份**删掉**（不是留着当"更好的新版本"）。
 *
 * ## 本文件**不碰**"存哪儿"
 *
 * 通道属于壳：Web 是 `localStorage` 那块 `heyta.ai.settings` 的 JSON，
 * 移动端是设备偏好库里的一行（`apps/mobile/src/prefs/device-prefs.ts`），
 * node-host 可以是文件。所以端口形状与 `assistant-tier-settings.ts` 一致：
 * **读文本 / 写文本**，别的都不问。
 *
 * ## 🔴 这里**没有**密钥
 *
 * `AiEndpointConfig.keyRef` 只是一个**引用名**；密钥本体走 `SecretStore` 端口，
 * 由壳决定它活在哪里（Web 只能活在内存，原生端可以有钥匙串）。
 * 本文件的 `save()` 写出去的那块 JSON 里出现密钥就是违规，
 * 而它压根没有放密钥的字段 —— 类型上装不进去。
 */

import {
  HEALTH_SNAPSHOT_VERSION,
  fromHealthSnapshot,
  toHealthSnapshot,
  DEFAULT_FEATURE_CAPABILITIES,
  type AiEndpointConfig,
  type AiFeature,
  type AiHealthSnapshot,
  type AiRoutingConfig,
  type EgressConsent,
} from '@heyta/ai';
import { DEFAULT_LOCAL_API_CONFIG, type LocalApiConfig } from '@heyta/local-api';

import type { AssistantTier } from './ai-assistant.js';
import { DEFAULT_ASSISTANT_TIER, normalizeAssistantTier } from './assistant-tier-settings.js';

/** 一份 AI 设置。⚠️ 这里**没有**任何密钥字段（见文件头）。 */
export interface AiSettingsState {
  routing: AiRoutingConfig;
  localApi: LocalApiConfig;
  consents: readonly EgressConsent[];
  /**
   * 熔断状态（端点的连续失败与跳闸）。
   *
   * 🔴 **本机状态，不是用户数据** —— 不进 op-log、不参与同步：
   * A 设备的端点连不上，不代表 B 设备的连不上。
   * 形状用 `AiHealthSnapshot` 而不是裸 `HealthMap`，落盘的东西要带版本号。
   */
  health: AiHealthSnapshot;
  /** 🔴 记忆总开关（ADR-0014）。默认关，且只认真正的 `true`。 */
  memoryEnabled: boolean;
  /** 🔴 助手能力档位（ADR-0045 §2.2）。默认值与归一都由 `assistant-tier-settings.ts` 给。 */
  assistantTier: AssistantTier;
}

/**
 * 壳要提供的**唯一**通道。
 *
 * `read()` 的契约与 `AssistantTierStorePort` 逐字同一条：
 * 取回原始文本，取不到返回 `undefined`，**不许抛** ——
 * 抛异常会把"存储坏了"变成"应用起不来"，而这一层最安全的结果一直是"全关"。
 *
 * `write()` 返回**是否真的落盘**。返回值不是装饰：
 * 移动端的 SQLite 写入可能失败（`writeDevicePref` 就返回 `false`），
 * 而"设置没存上"必须能让界面如实说"只在这次会话里生效"，不能静默假装成功。
 */
export interface AiSettingsStorePort {
  read(): string | undefined;
  write(value: string): boolean;
}

export interface AiSettingsStore {
  /** 读回并清洗（没有 / 坏 JSON / 值不认识 ⇒ 全关的默认值）。 */
  load(): AiSettingsState;
  /** 清洗后写盘，返回**是否真的落盘**。 */
  save(state: AiSettingsState): boolean;
  /** 回到出厂默认并落盘。 */
  reset(): boolean;
}

/**
 * 出厂默认：**四道闸全是关的**（总开关 / 允许远程 / 本机 API / 记忆），
 * 助手默认处于**执行**模式，但所有写入仍需用户确认；`routes` 为空 —— 不预置任何功能。
 *
 * 🔴 空路由是刻意的：预置会让"我打开了总开关"变成"好几个功能悄悄开始跑"。
 */
export function defaultAiSettingsState(): AiSettingsState {
  return {
    routing: {
      enabled: false,
      allowRemote: false,
      endpoints: [],
      routes: {},
    },
    localApi: { ...DEFAULT_LOCAL_API_CONFIG },
    consents: [],
    health: { version: HEALTH_SNAPSHOT_VERSION, entries: [] },
    memoryEnabled: false,
    assistantTier: DEFAULT_ASSISTANT_TIER,
  };
}

/** 清洗路由配置。**强制**两件事，不信任存储里的值（见文件头）。 */
function sanitizeRouting(input: unknown, fallback: AiRoutingConfig): AiRoutingConfig {
  if (typeof input !== 'object' || input === null) return fallback;
  const c = input as Partial<AiRoutingConfig>;

  const endpoints = Array.isArray(c.endpoints)
    ? c.endpoints.filter(
        (e): e is AiEndpointConfig =>
          typeof e === 'object' &&
          e !== null &&
          typeof (e as AiEndpointConfig).id === 'string' &&
          typeof (e as AiEndpointConfig).label === 'string' &&
          typeof (e as AiEndpointConfig).endpoint === 'string' &&
          typeof (e as AiEndpointConfig).model === 'string',
      )
    : [];

  const routes: AiRoutingConfig['routes'] = {};
  if (typeof c.routes === 'object' && c.routes !== null) {
    // 🔴 只认 `DEFAULT_FEATURE_CAPABILITIES` 的键 —— 词表外的那条路由
    // 留着也没有消费者，而它会让"设置里有五条无效记录"看起来像有效。
    for (const feature of Object.keys(DEFAULT_FEATURE_CAPABILITIES) as AiFeature[]) {
      const targets = (c.routes as Record<string, unknown>)[feature];
      if (Array.isArray(targets)) {
        const cleaned = targets.filter(
          (t): t is { endpointId: string } =>
            typeof t === 'object' &&
            t !== null &&
            typeof (t as { endpointId: string }).endpointId === 'string',
        );
        if (cleaned.length > 0) routes[feature] = cleaned;
      }
    }
  }

  return {
    enabled: c.enabled === true,
    allowRemote: c.allowRemote === true,
    endpoints,
    routes,
  };
}

/** 清洗本机 API 配置。🔴 `bindAddress` 不从存储里读，永远用默认的回环地址。 */
function sanitizeLocalApi(input: unknown, fallback: LocalApiConfig): LocalApiConfig {
  if (typeof input !== 'object' || input === null) return fallback;
  const c = input as Partial<LocalApiConfig>;
  return {
    enabled: c.enabled === true,
    bindAddress: fallback.bindAddress,
    port: typeof c.port === 'number' && Number.isInteger(c.port) ? c.port : fallback.port,
    ...(typeof c.token === 'string' && c.token !== '' ? { token: c.token } : {}),
    ...(typeof c.grants === 'object' && c.grants !== null
      ? { grants: c.grants as Record<string, boolean> }
      : {}),
  };
}

/**
 * 把磁盘上读回的原始文本清洗成一份可用设置。
 *
 * 参数是 `unknown` 而不是 `string`：JSON 解析失败、顶层不是对象、
 * 字段缺、字段是别家工具写的怪值 —— 全部落回**全关的默认值**，**永不抛**。
 */
export function parseAiSettingsState(raw: string | undefined): AiSettingsState {
  if (raw === undefined) return defaultAiSettingsState();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return defaultAiSettingsState();
  }
  if (typeof parsed !== 'object' || parsed === null) return defaultAiSettingsState();
  const candidate = parsed as Partial<AiSettingsState>;
  const fallback = defaultAiSettingsState();

  return {
    routing: sanitizeRouting(candidate.routing, fallback.routing),
    localApi: sanitizeLocalApi(candidate.localApi, fallback.localApi),
    consents: Array.isArray(candidate.consents) ? candidate.consents : [],
    memoryEnabled: candidate.memoryEnabled === true,
    assistantTier: normalizeAssistantTier(candidate.assistantTier),
    health: {
      version: HEALTH_SNAPSHOT_VERSION,
      entries: toHealthSnapshot(fromHealthSnapshot(candidate.health, Date.now()), Date.now()).entries,
    },
  };
}

/** 用壳给的通道装出一个设置仓库。 */
export function createAiSettingsStore(port: AiSettingsStorePort): AiSettingsStore {
  const fallback = defaultAiSettingsState();
  return {
    load: () => parseAiSettingsState(port.read()),
    save: (state: AiSettingsState) => {
      // 🔴 写出去之前**再清洗一遍**：调用方可能是界面 state（内存里那份），
      // 而"界面上看着对"不等于"落盘的东西读回来还是它"。清洗两次幂等，
      // 代价是一点 CPU，换来的是磁盘上不可能出现脏值 —— 下一次 `load()`
      // 的清洗因此变成空操作，两端不可能给出两种权限。
      const cleaned = parseAiSettingsState(JSON.stringify(state));
      try {
        return port.write(JSON.stringify(cleaned));
      } catch {
        return false;
      }
    },
    reset: () => {
      try {
        return port.write(JSON.stringify(fallback));
      } catch {
        return false;
      }
    },
  };
}
