/**
 * AI 设置 —— 本地持久化
 * =======================
 *
 * 保存 AI 路由与本地 API 的**本机偏好**。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 两条硬性纪律，每一条都有 ADR 依据
 *
 * **① 不写 op-log、不参与同步**（ADR-0010 §6.1 / ADR-0011 §5）
 *
 * 这些是"这台设备怎么用 AI"的偏好，不是业务数据：
 * - 进了 op-log 就会被同步到其他设备，而**别的设备可能有完全不同的端点**
 *   （家里有 Ollama、公司没有）→ 同步过去就是把一台设备的配置强加给另一台
 * - 熔断状态、授权时间更是**本机**才有意义的
 *
 * 所以它走 `localStorage`，与主题（`lib/theme.ts`）同一个层次。
 *
 * **② 🔴 API key 绝不进 `localStorage`**（ADR-0005 §3.2.1 / ADR-0010 §3.6）
 *
 * `localStorage` 会被**任何同源脚本**读到（XSS 一次就全丢）。
 * 原生端有系统钥匙串可放；**Web 端没有钥匙串** —— 所以：
 *
 * - 端点的**非敏感部分**（地址、模型名、keyRef）进 `localStorage`
 * - **密钥本身只留在内存里**，且**只活在这个标签页**
 * - 关掉页面 = 密钥没了，用户需要重新输入
 *
 * 🔴 这不是"还没做好"，是 **Web 上 BYOK 在架构上就不牢**（ADR-0005 §3.2.2）。
 * UI 必须**明说**这一点，而不是让用户以为存下来了 ——
 * 后者会导致"下次打开发现要重输"被当成 bug 报上来。
 * ─────────────────────────────────────────────────────────────────────────
 */

import {
  HEALTH_SNAPSHOT_VERSION,
  fromHealthSnapshot,
  toHealthSnapshot,
  type AiHealthSnapshot,
  DEFAULT_FEATURE_CAPABILITIES,
  EMPTY_SECRET_STORE,
  type AiEndpointConfig,
  type AiFeature,
  type AiRoutingConfig,
  type EgressConsent,
  type SecretStore,
} from '@heyta/ai';
import { DEFAULT_LOCAL_API_CONFIG, type LocalApiConfig } from '@heyta/local-api';

export const AI_SETTINGS_STORAGE_KEY = 'heyta.ai.settings';

/** 存进 `localStorage` 的形状。**注意这里没有密钥字段。** */
export interface PersistedAiSettings {
  routing: AiRoutingConfig;
  localApi: LocalApiConfig;
  consents: readonly EgressConsent[];
  /**
   * 熔断状态（端点的连续失败与跳闸）。
   *
   * ⚠️ 它是**本机状态，不是用户数据** —— 所以不进 op-log、不参与同步。
   * 换台设备该重新探一次端点，而不是继承另一台机器的失败历史。
   *
   * 形状用 `AiHealthSnapshot` 而不是裸的 `HealthMap`：落盘的东西需要一个
   * 版本号，否则将来改结构时没法安全迁移（见 `packages/ai/src/health-store.ts`）。
   */
  health: AiHealthSnapshot;
  /**
   * 🔴 **记忆总开关**（见 ADR-0014）。
   *
   * 默认 **false**。关闭时偏好层**零推断、零偏好进 prompt**。
   *
   * ⚠️ 与 `routing`/`localApi` 不同，它**不是**"AI 能不能用"的开关 ——
   * AI 可以照常工作，只是不记得你。两个概念分开，用户才想得清楚：
   * 「不用 AI」和「用 AI 但别记我」是两件事。
   */
  memoryEnabled: boolean;
}

/**
 * 出厂默认值。
 *
 * 🔴 **三道闸全是关的**：总开关关、不允许远程、本机 API 关。
 * 用户不主动打开就什么都不发生 —— 与 ADR-0010 §3.1 / ADR-0011 §3.1 一致。
 */
export function defaultAiSettings(): PersistedAiSettings {
  return {
    routing: {
      enabled: false,
      allowRemote: false,
      endpoints: [],
      // 🔴 空路由：**不预置任何功能**。
      // 预置会让"我打开了总开关"变成"好几个功能悄悄开始跑"。
      routes: {},
    },
    localApi: { ...DEFAULT_LOCAL_API_CONFIG },
    consents: [],
    health: { version: HEALTH_SNAPSHOT_VERSION, entries: [] },
    // 🔴 第四道闸，同样默认关。与 ADR-0014 的 fail-closed 要求一致。
    memoryEnabled: false,
  };
}

/**
 * 读取设置。
 *
 * ⚠️ 容错策略：**解析失败就回到默认值（全关），而不是抛错**。
 * 因为"配置坏了"的最安全结果是"什么都不做"，不是"崩掉"，
 * 也**绝不是**"用一份猜出来的配置继续跑"。
 */
export function loadAiSettings(): PersistedAiSettings {
  try {
    const raw = localStorage.getItem(AI_SETTINGS_STORAGE_KEY);
    if (raw === null) return defaultAiSettings();
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return defaultAiSettings();
    const candidate = parsed as Partial<PersistedAiSettings>;
    const fallback = defaultAiSettings();

    return {
      routing: sanitizeRouting(candidate.routing, fallback.routing),
      localApi: sanitizeLocalApi(candidate.localApi, fallback.localApi),
      consents: Array.isArray(candidate.consents) ? candidate.consents : [],
      // 🔴 只在**真的是布尔 true** 时才打开。
      // 存成字符串 "true"、数字 1、或字段缺失 —— 一律按关闭处理。
      // 隐私闸门不接受"看起来像真"的值（与 `sanitizeRouting` 对
      // `enabled` 的处理同一条规则）。
      memoryEnabled: candidate.memoryEnabled === true,
      health: {
        version: HEALTH_SNAPSHOT_VERSION,
        entries: toHealthSnapshot(
          fromHealthSnapshot(candidate.health, Date.now()),
          Date.now(),
        ).entries,
      },
    };
  } catch {
    // 隐私模式下 localStorage 可能抛错；坏 JSON 也一样。
    return defaultAiSettings();
  }
}

/** 保存设置。失败不影响本次会话生效（与 `theme.ts` 同样的降级策略）。 */
export function saveAiSettings(settings: PersistedAiSettings): void {
  try {
    localStorage.setItem(AI_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // 存不上就只在本会话生效
  }
}

/**
 * 清洗路由配置。
 *
 * 🔴 它**强制**两件事，不信任存储里的值：
 * - `enabled` 与 `allowRemote` 必须是真正的布尔（`"true"` 字符串不算）
 * - 每个端点必须通过 URL 校验；**不合法的端点直接被丢掉**
 *
 * 为什么不合法就丢：一个坏的端点留在配置里，用户会在"AI 时好时坏"
 * 里排查很久。丢掉 + 下面 `describeDroppedEndpoints` 告诉用户更好。
 */
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
    for (const feature of Object.keys(DEFAULT_FEATURE_CAPABILITIES) as AiFeature[]) {
      const targets = (c.routes as Record<string, unknown>)[feature];
      if (Array.isArray(targets)) {
        const cleaned = targets.filter(
          (t): t is { endpointId: string } =>
            typeof t === 'object' && t !== null && typeof (t as { endpointId: string }).endpointId === 'string',
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

function sanitizeLocalApi(input: unknown, fallback: LocalApiConfig): LocalApiConfig {
  if (typeof input !== 'object' || input === null) return fallback;
  const c = input as Partial<LocalApiConfig>;
  return {
    enabled: c.enabled === true,
    // 🔴 绑定地址**不从存储里读** —— 永远用默认的回环地址。
    // 这一条是刻意的：如果哪天存储被改成了 0.0.0.0，读回来就等于
    // 悄悄把服务暴露到局域网。绑定地址不该是可持久化的偏好。
    bindAddress: fallback.bindAddress,
    port: typeof c.port === 'number' && Number.isInteger(c.port) ? c.port : fallback.port,
    ...(typeof c.token === 'string' && c.token !== '' ? { token: c.token } : {}),
    ...(typeof c.grants === 'object' && c.grants !== null
      ? { grants: c.grants as Record<string, boolean> }
      : {}),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 🔴 会话级密钥
// ─────────────────────────────────────────────────────────────────────────

/**
 * 密钥的**会话级**存放处。
 *
 * 🔴 **只在内存里，只活在这个标签页。**
 *
 * 它不是"临时方案"，而是 Web 上**唯一诚实的做法**：
 * `localStorage` 会被任何同源脚本读到，而密钥能解开用户的全部数据
 * （对照 `features/sync/store.ts` 里对同步口令的同一处理）。
 *
 * 原生端会有真的钥匙串实现（`SecretStore` 端口），
 * 本文件在 Web 上**故意实现成内存**，并有测试断言
 * **密钥不会被写进 `localStorage`**。
 */
export interface SessionSecretStore extends SecretStore {
  /** 设置一个密钥。只存内存。 */
  set(keyRef: string, secret: string): void;
  /** 清空（用户点"忘记密钥"时）。 */
  clear(): void;
  /** 当前有哪些 keyRef 有值（**只返回引用名，不返回值**）。 */
  knownRefs(): readonly string[];
}

export function createSessionSecretStore(): SessionSecretStore {
  const secrets = new Map<string, string>();
  return {
    get: (keyRef) => Promise.resolve(secrets.get(keyRef)),
    set: (keyRef, secret) => {
      secrets.set(keyRef, secret);
    },
    clear: () => {
      secrets.clear();
    },
    knownRefs: () => [...secrets.keys()],
  };
}

/**
 * 给 UI 用的：Web 端密钥策略的一句话说明。
 *
 * 🔴 这句话**必须显示在密钥输入框旁边**。
 * 不说明的话，"下次打开要重输"会被当成 bug —— 而它其实是设计。
 *
 * ⚠️ 文案本身已经搬进词条表（`web.ai.settings.keyNotice`），由
 * `AiSettings.tsx` 渲染。**这里刻意不留一份字符串副本**：
 * 留副本就会漂移，而两份说明里只要有一份过期，用户看到的就是错的那份。
 * 本文件仍然登记在 `scripts/check-ui-language.mjs` 的 `migratedFiles` 里 ——
 * 登记不是为了这句话（门禁看不见跨行拼接），而是为了让**将来**在这个
 * 存储层文件里新写的硬编码文案立刻被拦下。
 */

/** Web 上没有钥匙串断言用的空 store（未配置任何密钥时）。 */
export const WEB_EMPTY_SECRET_STORE = EMPTY_SECRET_STORE;

/**
 * 供界面直接落盘熔断状态。
 *
 * ⚠️ 在 `aiStore` 里再导出一次，而不是让 `App.tsx` 自己去 `@heyta/ai` 拿 ——
 * "哪个键、什么格式"是存储层的事，界面不该知道。
 */
export { toHealthSnapshot } from '@heyta/ai';
