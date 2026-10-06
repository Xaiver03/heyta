import { ICON_SIZE } from '@heyta/design-system';
/**
 * AI 设置面板
 * =============
 *
 * 把 `@heyta/ai`（出站）与 `@heyta/local-api`（入站）两道配置面接起来。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 这个面板的**首要职责不是"让用户能开"，而是"让用户知道自己在开什么"**
 *
 * AI 设置最常见的失败模式不是"配置错了"，是**用户不知道自己同意了数据出境**。
 * 所以这里有几条硬规矩：
 *
 * 1. **每一道闸单独可见**（总开关 / 允许远程 / 逐功能），不合并成一个"启用 AI"
 * 2. 远端端点旁边**永远**显示"数据会离开这台设备"
 * 3. 授权**按功能**给，且**可以逐个撤销**
 * 4. 密钥输入框旁边**明说**"关掉页面就没了"（Web 没有钥匙串）
 * 5. 危险的状态用**文字**说，不只用颜色（色觉障碍）
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ⚠️ 本组件**不发任何请求**。它只写配置。
 * 真正调用模型的地方必须走 `invokeRouted()`（ADR-0010），
 * 那样才经过出境闸门。`check-layering` 的 `no-model-endpoint-in-apps`
 * 会拦下任何试图在这里直接 fetch 模型的代码。
 */

import { useEffect, useRef, useState } from 'react';
import {
  AI_ENDPOINT_PRESETS,
  classifyDestination,
  validateEndpointUrl,
  requiredCapabilities,
  endpointHealthDisclosure,
  fromHealthSnapshot,
  isAvailable,
  requiresEgressConsent,
  type AiRoutingConfig,
  type AiCapability,
  type AiEndpointConfig,
  type AiEndpointPreset,
  type AiFeature,
  type EgressConsent,
} from '@heyta/ai';

/**
 * 能力词表与中文名。
 *
 * 🔴 **为什么这里必须有这一块。**
 *
 * ADR-0010 §3.4 规定"能力必须显式声明，不做任何推断"，未声明的端点只有基线
 * `structured_output`。而 `breakdown` 需要 `long_context`。
 *
 * 本面板**原本没有任何声明能力的地方** —— 于是通过界面加进来的每个端点
 * 都只有基线能力，**拆解功能永远没有路可走**，而且失败信息只说"没有可用端点"。
 * 这个 bug 是在给 `invokeRouted` 接第一个真实调用点时暴露的：
 * 单测里手写的端点都带了能力声明，所以一直绿着。
 *
 * 教训：**一个"必须由用户声明"的字段，如果界面上无处可填，等于这个功能不存在。**
 */
const CAPABILITY_ORDER: readonly AiCapability[] = [
  'structured_output',
  'long_context',
  'vision',
  'tool_calling',
];

/** 能力的中文名。**不直接用 `AiCapability` 字面量**，那对用户没有意义。 */
function capabilityLabels(t: I18nValue['t']): Readonly<Record<AiCapability, string>> {
  return {
    structured_output: t('web.ai.capability.structuredOutput'),
    long_context: t('web.ai.capability.longContext'),
    vision: t('web.ai.capability.vision'),
    tool_calling: t('web.ai.capability.toolCalling'),
  };
}

/** 哪些功能需要这个能力 —— 让用户知道勾了有什么用。 */
function featuresNeeding(capability: AiCapability, t: I18nValue['t'], locale: Locale): string {
  const names: Partial<Record<AiFeature, string>> = {
    capture: t('web.ai.needs.capture'),
    breakdown: t('web.ai.needs.breakdown'),
    prioritize: t('web.ai.needs.prioritize'),
    'duration-estimate': t('web.ai.needs.duration'),
    'tool-calling': t('web.ai.needs.toolCalling'),
  };
  const hit: string[] = [];
  for (const [feature, label] of Object.entries(names)) {
    if (requiredCapabilities(feature as AiFeature).includes(capability)) hit.push(label ?? feature);
  }
  return hit.join(LIST_SEPARATOR[locale]);
}
import { LOCAL_API_TOOLS, validateLocalApiConfig } from '@heyta/local-api';
import {
  ASSISTANT_TIER_ORDER,
  ASSISTANT_TIER_READ_AND_PROPOSE,
  ASSISTANT_TIER_READ_ONLY,
  destinationForFeature,
  planAssistantEgress,
  recomputeConsents,
  type AssistantTier,
} from '@heyta/app-host';
import { AlertTriangle, Check, Lock, Plus, ShieldCheck, Trash2 } from 'lucide-react';

import { useI18n, type I18nValue, type Locale } from '@heyta/i18n';

import { LIST_SEPARATOR, PAIRED_PARENS } from '../ai/locale-punctuation.js';
import type { SettingsTarget } from '../ai/route-explanation.js';
import { endpointHealthCopy } from './health-copy.js';
import {
  defaultAiSettings,
  saveAiSettings,
  type PersistedAiSettings,
  type SessionSecretStore,
} from './aiStore.js';

/**
 * 某个功能在**当前路由里**缺哪些能力。
 *
 * 🔴 这是 ADR-0010 §3.4「不做推断」的**配套义务**。
 *
 * 那条决策要求能力必须由用户显式声明（不猜）。代价是：
 * 用户加了端点但忘了勾「长上下文」，「AI 拆解」就**永远不工作**，
 * 而界面不会说为什么 —— 用户只会觉得"AI 坏了"。
 *
 * 「不做推断」不等于「不告诉用户该怎么办」。本函数把差额算出来，
 * 界面据此给出**具体缺什么**和**一键补上**。
 *
 * 返回 `undefined` 表示这个功能没有配任何端点（那是另一回事，
 * 界面已经有"先添加端点"的提示）。
 * 返回空数组表示没问题。
 */
export function capabilityGaps(
  feature: AiFeature,
  routing: AiRoutingConfig,
): { readonly missing: readonly AiCapability[]; readonly endpointId: string }[] | undefined {
  const chain = routing.routes[feature];
  if (chain === undefined || chain.length === 0) return undefined;

  const required = requiredCapabilities(feature);
  return chain
    .map((target) => {
      const endpoint = routing.endpoints.find((e) => e.id === target.endpointId);
      if (endpoint === undefined) return undefined;
      const declared = endpoint.capabilities ?? ['structured_output'];
      const missing = required.filter((cap) => !declared.includes(cap));
      return { endpointId: endpoint.id, missing };
    })
    .filter((x): x is { endpointId: string; missing: AiCapability[] } => x !== undefined);
}

/** 功能的中文名。**不直接用 `AiFeature` 字面量**，那对用户没有意义。 */
function featureLabels(t: I18nValue['t']): Readonly<Record<AiFeature, string>> {
  return {
    capture: t('web.ai.feature.capture'),
    breakdown: t('web.ai.feature.breakdown'),
    prioritize: t('web.ai.feature.prioritize'),
    'duration-estimate': t('web.ai.feature.duration'),
    'tool-calling': t('web.ai.feature.toolCalling'),
  };
}

const FEATURE_ORDER: readonly AiFeature[] = [
  'capture',
  'breakdown',
  'prioritize',
  'duration-estimate',
  'tool-calling',
];

/**
 * 助手能力档位，**按权限从低到高**排（`ASSISTANT_TIER_ORDER`，来自 `@heyta/app-host`）。
 *
 * ⚠️ 顺序是承重的：界面用 `.map()` 渲染，默认档必须排在第一格，
 * 否则"出厂状态"在界面上看起来像第二格那个更高的权限。
 * 这份顺序**不在这里声明** —— 声明了就有两份，而两份的顺序可以不一样。
 */

/** 档位的中文名与说明（`Record` 是穷尽的：加一档忘词条 = 编译错误）。 */
function tierLabels(t: I18nValue['t']): Readonly<Record<AssistantTier, string>> {
  return {
    [ASSISTANT_TIER_READ_ONLY]: t('web.ai.assistant.tier.readOnly.label'),
    [ASSISTANT_TIER_READ_AND_PROPOSE]: t('web.ai.assistant.tier.readAndPropose.label'),
  };
}

function tierNotes(t: I18nValue['t']): Readonly<Record<AssistantTier, string>> {
  return {
    [ASSISTANT_TIER_READ_ONLY]: t('web.ai.assistant.tier.readOnly.note'),
    [ASSISTANT_TIER_READ_AND_PROPOSE]: t('web.ai.assistant.tier.readAndPropose.note'),
  };
}

/**
 * `validateEndpointUrl()` 拒绝时的 `reason` 码。
 *
 * ⚠️ 镜像 `@heyta/ai` 里的那个联合类型，**不是**新造一套判断：
 * 我们只是把跨包的中文 `message` 换成按 `reason` 取词条。
 * 跨包的 `message` 仍然存在（CLI / 测试在用），只是界面不再渲染它 ——
 * 门禁看不见 `{r.message}`，但用户看得见，所以这条已经出境到用户眼前的
 * 中文只能在这里收口。
 */
type EndpointRejectionReason =
  | 'unparseable'
  | 'bad-scheme'
  | 'credentials-in-url'
  | 'plaintext-remote';

/** 取 URL 的协议部分。只在 `bad-scheme` 这条路上用（那时 URL 已经解析成功）。 */
function protocolOf(raw: string): string {
  try {
    return new URL(raw).protocol;
  } catch {
    return '';
  }
}

/** 端点被拒 → 用户能读懂的句子。**按 `reason` 取词条，绝不渲染跨包的中文。** */
function endpointRejectionText(
  reason: EndpointRejectionReason,
  endpoint: string,
  t: I18nValue['t'],
): string {
  switch (reason) {
    case 'unparseable':
      return t('web.ai.settings.endpointError.unparseable', { url: endpoint });
    case 'bad-scheme':
      return t('web.ai.settings.endpointError.badScheme', { protocol: protocolOf(endpoint) });
    case 'credentials-in-url':
      return t('web.ai.settings.endpointError.credentialsInUrl');
    case 'plaintext-remote':
      return t('web.ai.settings.endpointError.plaintextRemote');
  }
}

/** 本机 API 配置被拒 → 用户能读懂的句子。同上，按 `reason` 取词条。 */function localApiErrorText(
  reason: 'not-loopback' | 'token-required' | 'bad-port',
  config: { readonly port: number; readonly bindAddress: string },
  t: I18nValue['t'],
): string {
  switch (reason) {
    case 'bad-port':
      return t('web.ai.settings.localApi.error.badPort', { port: config.port });
    case 'token-required':
      return t('web.ai.settings.localApi.error.tokenRequired');
    case 'not-loopback':
      return t('web.ai.settings.localApi.error.notLoopback', { address: config.bindAddress });
  }
}

/**
 * 预设的展示文案（名字 + 前置条件）。
 *
 * 🔴 原值在 `@heyta/ai` 的 `AI_ENDPOINT_PRESETS` 里 —— 跨包、且是中文。
 * 门禁看不见它们（渲染的是变量 `preset.label` / `preset.prerequisite`），
 * 但英文界面上用户看得见，所以在界面侧按 `id` 收口。
 *
 * ⚠️ 未知 `id` 回退到 **id 本身**（不是跨包中文）。理由见函数末尾那条注释。
 */
function presetText(
  preset: AiEndpointPreset,
  t: I18nValue['t'],
): { readonly label: string; readonly prerequisite: string | undefined } {
  switch (preset.id) {
    case 'ollama':
      return {
        label: t('web.ai.settings.preset.ollama.label'),
        prerequisite: t('web.ai.settings.preset.ollama.prerequisite'),
      };
    case 'lm-studio':
      return {
        label: t('web.ai.settings.preset.lmStudio.label'),
        prerequisite: t('web.ai.settings.preset.lmStudio.prerequisite'),
      };
    default:
      // 🔴 宁可显示 **id**，也不整句渲染跨包中文。
      //
      // 这条分支现在是**潜伏**的（出厂只有 ollama / lm-studio 两个预设，都走上面），
      // 但它是真的会漏：`packages/ai` 新增一个预设而这里忘了加词条，
      // 界面就会在英文模式下露出中文，而门禁**看不见** ——
      // 它渲染的是变量 `preset.label`，不是字面量。
      //
      // 与 `preferenceLabelText` 同一约定：未知 id 原样返回。
      // 理由也一样：**空白或误导性文案比"难看的 id"更糟** ——
      // 前者用户以为是 bug 而放弃，后者至少能拿去搜索/报错。
      //
      // 这条约定由 `ai-settings.spec.tsx` 里"枚举全部出厂预设"的测试兜住：
      // 新增预设而没加词条 → 那条测试当场变红。
      return { label: preset.id, prerequisite: undefined };
  }
}

export interface AiSettingsProps {
  initial: PersistedAiSettings;
  secrets: SessionSecretStore;
  /** 配置变化时回调（外部持久化）。默认直接存 localStorage。 */
  onChange?: (next: PersistedAiSettings) => void;
  /**
   * 记忆面板（偏好可见 / 可忘掉 / 可恢复）。
   *
   * 用 **ReactNode 插槽**而不是把偏好数据一路传进来：
   * 本组件只负责"AI 配置"，不该知道偏好推断长什么样。
   * 谁持有 `preferenceSet` 谁负责组装，这里只留位置。
   */
  memorySlot?: React.ReactNode;
  /**
   * 从 AI 面板的"去设置"跳进来时，**该落在哪一块**。
   *
   * 🔴 这是"让界面说出下一步"的最后一米：面板算出"去开闸 2 / 去补能力 /
   * 去授权"，用户点过来必须**真的看到那一个控件**，而不是又要在设置页里
   * 自己找一遍。找不到的话，前面那句"去设置"就只是把问题换了个地方。
   *
   * ⚠️ 它只影响**呈现**（滚动 + 高亮），不改变任何配置 ——
   * 授权仍然只能由用户在这里按"我同意"完成。
   */
  focusTarget?: SettingsTarget | undefined;
}

export function AiSettings({ initial, secrets, onChange, memorySlot, focusTarget }: AiSettingsProps) {
  const [settings, setSettings] = useState<PersistedAiSettings>(initial);
  const [keyDraft, setKeyDraft] = useState<Record<string, string>>({});
  /** 被拒绝的端点地址及其原因 —— 必须显示，不能静默丢弃。 */
  const [rejected, setRejected] = useState<
    readonly { endpoint: string; reason: EndpointRejectionReason }[]
  >([]);
  /**
   * 当前被"去设置"高亮的那一块。
   *
   * 用 state 而不是直接改 DOM：高亮是**呈现状态**，必须随下次渲染自然消失，
   * 而且测试要能在 DOM 上断言它（`data-focused`），不能靠读 class。
   */
  const [focused, setFocused] = useState<SettingsTarget | undefined>(undefined);

  const endpointsSectionRef = useRef<HTMLElement | null>(null);
  const remoteGateRef = useRef<HTMLDivElement | null>(null);
  const featuresSectionRef = useRef<HTMLElement | null>(null);

  const { t, locale } = useI18n();
  const capabilityLabel = capabilityLabels(t);
  const featureLabel = featureLabels(t);
  const tierLabel = tierLabels(t);
  const tierNote = tierNotes(t);

  function update(next: PersistedAiSettings): void {
    setSettings(next);
    if (onChange !== undefined) onChange(next);
    else saveAiSettings(next);
  }

  /**
   * 唯一的路由写入路径 —— 改路由时顺手把授权重算并写回。
   *
   * 任何绕过它的路由改动都会把陈旧授权留在存储里，所以所有端点/路由修改
   * 都必须走这里（`update()` 只留给与路由无关的字段）。
   *
   * 🔴 「哪个功能会走到哪个目的地」（`destinationForFeature`）与
   * 「路由变了授权怎么重算」（`recomputeConsents`）**不住在这个壳里** ——
   * 它们在 `packages/app-host/src/ai-settings-shared.ts`（AGENTS §3.5）。
   * 理由不是整洁：移动端接 AI 时必然要同一份判定，而两份规则只要归一方向差一点，
   * 同一个用户在两台设备上就有两种权限 —— 症状是"同意的是 A、实际放行的是 B"，
   * **没有任何一层会报错**。原来这里的注释就写着"两套规则一定会漂移，而这是隐私闸门"；
   * 现在不再靠注释，只留一个地方能算出它。
   */
  function updateRouting(next: AiRoutingConfig): void {
    update({
      ...settings,
      routing: next,
      consents: recomputeConsents(settings.consents, next),
    });
  }

  const { routing, localApi } = settings;
  const localApiVerdict = validateLocalApiConfig(localApi);

  /**
   * 🔴 「去设置」的落点。
   *
   * 面板切过来时本组件是**新挂载**的（`view === 'settings'` 才渲染它），
   * 所以每次跳转这个 effect 都会跑一次。依赖刻意只有 `focusTarget`：
   * 用户在设置页里改配置不该让页面自己滚动。
   *
   * ⚠️ `scrollIntoView` 用可选调用：jsdom 没有实现它，而"落点对不对"
   * 必须能在组件测试里断言（断言的是 `data-focused`，不是滚动本身）。
   */
  useEffect(() => {
    if (focusTarget === undefined) return;
    const target =
      focusTarget === 'endpoints'
        ? endpointsSectionRef.current
        : focusTarget === 'remote'
          ? remoteGateRef.current
          : featuresSectionRef.current;
    if (target === null) return;
    target.scrollIntoView?.({ block: 'start' });
    setFocused(focusTarget);
    // 高亮是**瞬时的**：留着它，用户会以为那是一块需要一直盯着的状态。
    const timer = setTimeout(() => setFocused(undefined), 2500);
    return () => clearTimeout(timer);
  }, [focusTarget]);

  // ── 端点 ────────────────────────────────────────────────────────────
  function addEndpoint(config: AiEndpointConfig): void {
    const verdict = validateEndpointUrl(config.endpoint);
    if (!verdict.ok) {
      setRejected((r) => [...r, { endpoint: config.endpoint, reason: verdict.reason }]);
      return;
    }
    setRejected((r) => r.filter((x) => x.endpoint !== config.endpoint));
    if (routing.endpoints.some((e) => e.id === config.id)) return;
    updateRouting({ ...routing, endpoints: [...routing.endpoints, config] });
  }

  /**
   * 改一个端点的字段。
   *
   * ⚠️ **这里不做 URL 校验**：用户正在输入的过程中地址必然是半成品
   * （`https://` 还没有 host）。在校验失败时就拒绝写入的话，
   * 输入框会"打字打不进去"。
   *
   * 校验发生在**使用**的时候（`invokeRouted` 与 `resolveRoute` 都会查），
   * 且非法地址的端点在解析候选时会被排除并给出原因（ADR-0010 §3.5）。
   * 所以"存下来"和"能用"是两件事，前者宽松、后者严格。
   */
  function editEndpoint(id: string, patch: Partial<AiEndpointConfig>): void {
    updateRouting({
      ...routing,
      endpoints: routing.endpoints.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    });
  }

  /**
   * 加一个空白自定义端点。
   *
   * 🔴 **刻意不校验 URL。**
   *
   * 第一版让"添加自定义端点"也走 `addEndpoint`（会校验），结果是：
   * 它塞进一个 `https://`，校验失败，于是**什么都不发生** ——
   * 用户点了按钮，看到一个错误，然后没有任何输入框可以填地址。
   * **加进来就是死路。**
   *
   * 正确的顺序是：先给一个空的输入框让用户填，
   * 校验发生在**使用**时（且那一层会给原因）。
   */
  function addCustomEndpoint(): void {
    const n = routing.endpoints.length + 1;
    updateRouting({
      ...routing,
      endpoints: [
        ...routing.endpoints,
        {
          id: `custom-${String(n)}`,
          label: t('web.ai.settings.customLabel', { n }),
          endpoint: '',
          model: '',
          /**
           * 🔴 **必须给 `keyRef`，否则这个端点根本无法鉴权。**
           *
           * 密钥输入框的渲染条件是 `endpoint.keyRef !== undefined`，
           * 而路由层取值也是 `keyRef === undefined ? undefined : await store.get(keyRef)`
           * —— 两处都由它开关。不设的后果是：
           *
           *   1. 界面上**永远不出现**密钥输入框（用户没地方输）
           *   2. 请求**永远不带** `authorization` 头
           *
           * 也就是「自己接入 AI」这条路对有鉴权的服务商**完全走不通**，
           * 只有两个本机预设能用。
           *
           * 这个洞藏了很久，因为密钥 UI 的单测**自己造了带 `keyRef` 的配置**
           * （见 `ai-settings.spec.tsx`），于是它一直是绿的 ——
           * 典型的"能力实现了、有单测、但零生产调用点"。
           * 直到真实用户旅程测试去点真界面才暴露。
           *
           * ⚠️ 空密钥是安全的：`routing.ts` 里 `apiKey !== ''` 才加头。
           * 所以不需要"要不要密钥"的开关，无条件给上即可。
           */
          keyRef: `custom-${String(n)}`,
        },
      ],
    });
  }

  function removeEndpoint(id: string): void {
    const routes: typeof routing.routes = {};
    for (const [feature, targets] of Object.entries(routing.routes)) {
      const kept = (targets ?? []).filter((t) => t.endpointId !== id);
      if (kept.length > 0) routes[feature as AiFeature] = kept;
    }
    updateRouting({
      ...routing,
      endpoints: routing.endpoints.filter((e) => e.id !== id),
      routes,
    });
  }

  function toggleRoute(feature: AiFeature, endpointId: string): void {
    const current = routing.routes[feature] ?? [];
    const has = current.some((t) => t.endpointId === endpointId);
    const next = has
      ? current.filter((t) => t.endpointId !== endpointId)
      : [...current, { endpointId }];
    const routes = { ...routing.routes };
    if (next.length === 0) delete routes[feature];
    else routes[feature] = next;
    updateRouting({ ...routing, routes });
  }

  // ── 授权 ────────────────────────────────────────────────────────────
  function grant(feature: AiFeature): void {
    // 🔴 目的地**推导**，不硬编码 —— 见 `destinationForFeature`。
    const destination = destinationForFeature(feature, routing);
    // 本地端点根本没出境，不该产生授权记录（留着就是将来误放行的种子）。
    if (!requiresEgressConsent(destination)) return;

    const consent: EgressConsent = { feature, destination, grantedAt: Date.now() };
    // 先按唯一事实源重算（丢掉陈旧记录），再去重后写入本次同意。
    const kept = recomputeConsents(settings.consents, routing).filter(
      (c) => !(c.feature === feature && c.destination === destination),
    );
    update({ ...settings, consents: [...kept, consent] });
  }

  function revoke(feature: AiFeature): void {
    // 撤销就该把这个功能的授权清干净：留一条"当前目的地不匹配但存在"的
    // 记录没有意义，反而是将来某次变动后的误放行种子。
    update({
      ...settings,
      consents: settings.consents.filter((c) => c.feature !== feature),
    });
  }

  /** 这个功能当前是否会走到远端（决定要不要问授权）。 */
  function routeTouchesRemote(feature: AiFeature): boolean {
    return requiresEgressConsent(destinationForFeature(feature, routing));
  }

  function hasConsent(feature: AiFeature): boolean {
    const destination = destinationForFeature(feature, routing);
    return settings.consents.some(
      (c) => c.feature === feature && c.destination === destination,
    );
  }

  // 每次渲染算一次（不是每个端点一次）。`now` 也取一次，
  // 免得同一次渲染里不同端点用了不同的"现在"。
  const now = Date.now();
  const healthMap = fromHealthSnapshot(settings.health, now);

  /**
   * 助手这一档**最多会送出什么** —— 纯函数，一次请求都不发。
   *
   * 🔴 界面必须在这里显示它，而不是等第一次对话时才说：多步循环中途不再逐步
   * 征求同意（逐步同意 = 用户无脑点下去的疲劳闸门），所以开聊之前必须把**并集**说完。
   * 字段名来自目录的 `egressFields`，这里不另列一份名单。
   */
  const assistantPlan = planAssistantEgress(settings.assistantTier);

  return (
    <div className="ht-settings" data-testid="ai-settings">
      <h2 className="ht-settings__title ht-type-section-title">{t('web.ai.settings.title')}</h2>

      {/* ── 闸 1：总开关 ─────────────────────────────────────────── */}
      <Toggle
        id="ai-enabled"
        label={t('web.ai.settings.enabled.label')}
        note={t('web.ai.settings.enabled.note')}
        checked={routing.enabled}
        onChange={(v) => updateRouting({ ...routing, enabled: v })}
      />

      {/* ── 闸：记忆（ADR-0014）─────────────────────────────────
          ⚠️ 刻意**始终可见**，不受 `routing.enabled` 管辖：
          用户在"AI 到底记不记得我"这件事上应该能直接找到开关，
          而不是先打开 AI 才看见它。
          但它与总开关是**两件事** —— 总开关是"要不要用 AI"，
          这个是"用 AI 但要不要让它认识你"。 */}
      <Toggle
        id="ai-memory-enabled"
        label={t('web.ai.settings.memory.label')}
        note={t('web.ai.settings.memory.note')}
        checked={settings.memoryEnabled}
        onChange={(v) => update({ ...settings, memoryEnabled: v })}
      />

      {/* 记忆面板紧跟在开关下面 —— 开关说"要不要"，面板说"记住了什么"。 */}
      {memorySlot}

      {routing.enabled && (
        <>
          {/* ── 闸 2：允许远程 ───────────────────────────────────── */}
          <div
            ref={remoteGateRef}
            data-testid="ai-remote-gate"
            data-focused={focused === 'remote' ? 'true' : undefined}
          >
            <Toggle
              id="ai-allow-remote"
              label={t('web.ai.settings.allowRemote.label')}
              note={t('web.ai.settings.allowRemote.note')}
              checked={routing.allowRemote}
              onChange={(v) => updateRouting({ ...routing, allowRemote: v })}
            />
          </div>

          {routing.allowRemote && (
            <p className="ht-settings__danger" role="note" data-testid="remote-warning">
              <AlertTriangle size={ICON_SIZE.xs} aria-hidden="true" />
              <span>
                {t('web.ai.settings.remote.lead')}<strong>{t('web.ai.settings.remote.strong')}</strong>{t('web.ai.settings.remote.tail')}
              </span>
            </p>
          )}

          {/* ── 端点列表 ─────────────────────────────────────────── */}
          <section
            className="ht-settings__section"
            ref={endpointsSectionRef}
            data-testid="ai-endpoints-section"
            data-focused={focused === 'endpoints' ? 'true' : undefined}
          >
            <h3 className="ht-settings__h3 ht-type-headline">{t('web.ai.settings.endpoints.title')}</h3>

            {/* 🔴🔴 **这一段的话术改过两次，两次都是因为"把做没做完说反了"。**
                ① 曾经写"我们没有提供托管 AI" —— 那是错的：产品负责人已明确
                   heyta **会**提供统一云端 AI 并按此收费（ADR-0013），
                   把"我暂时无法决定"写成"我们不做"会变成一个对用户的承诺。
                ② 2026-10-05（ADR-0054）之后"即将提供 / 仍在开发中"也变成假话了 ——
                   服务端那一半已经落地（额度计量、境内白名单、保留策略、解除禁售），
                   缺的是**这个版本的界面还没有那个开关**。
                   两个方向都错在同一条上：把状态写反，而界面是用户唯一的状态来源。

                不变的那半句：用托管 AI 时内容会明文到 heyta 服务器，
                所以它**不是**端到端加密（ADR-0005 / ADR-0006）。 */}
            <p className="ht-settings__hint" data-testid="managed-ai-note">
              {t('common.brand')} <strong>{t('web.ai.settings.managed.offer')}</strong>{t('web.ai.settings.managed.rest')}
              <strong>{t('web.ai.settings.managed.strongPlain')}</strong>{t('web.ai.settings.managed.mid')}
              <strong>{t('web.ai.settings.managed.strongNot')}</strong>{t('web.ai.settings.managed.tail')}
            </p>

            {routing.endpoints.length === 0 && (
              <p className="ht-settings__hint">
                {t('web.ai.settings.endpoints.empty')}
              </p>
            )}

            {/* 🔴🔴 端点健康必须显示出来 —— 否则用户看到的和实际发生的事不一致。
                熔断的端点在界面上与正常端点**长得一模一样**，
                用户只会看到"AI 暂时不可用"，不知道是哪个端点、也不知道多久恢复。
                ⚠️ 文案走词条表（`health-copy.ts`），**不要**再调包里的
                `describeEndpointHealth()` —— 那返回的是中文硬编码，
                英文界面会直接露出来。 */}
            <ul className="ht-settings__list">
              {routing.endpoints.map((endpoint) => {
                const health = healthMap[endpoint.id];
                const healthy = isAvailable(health, now);
                // 结构化状态 → 词条 key + 插值参数（`health === undefined` 时没有可说的）
                const healthCopy =
                  health === undefined
                    ? undefined
                    : endpointHealthCopy(endpointHealthDisclosure(health, now));
                const urlVerdict = validateEndpointUrl(endpoint.endpoint);
                const destination = urlVerdict.ok
                  ? urlVerdict.destination
                  : classifyDestination({ mode: 'own', endpoint: endpoint.endpoint });
                const isLocal = destination === 'none';
                return (
                  <li key={endpoint.id} className="ht-settings__item" data-testid={`endpoint-${endpoint.id}`}>
                    {healthCopy !== undefined && !healthy && (
                      <p className="ht-settings__warn" data-testid={`endpoint-unhealthy-${endpoint.id}`}>
                        <AlertTriangle size={ICON_SIZE.xs} aria-hidden="true" />
                        {t(healthCopy.key, healthCopy.params)}
                      </p>
                    )}
                    <div className="ht-settings__item-main">
                      {/* 🔴 可编辑：预设一键加进来只是起点，用户必须能改。
                          没有编辑能力的话"添加自定义端点"会加进一个 `https://`
                          然后**用户没有任何办法把它改对** —— 那是死路。 */}
                      <label className="ht-settings__inline">
                        <span className="ht-settings__inline-label">{t('web.ai.settings.field.name')}</span>
                        <input
                          type="text"
                          aria-label={t('web.ai.settings.nameAria', { name: endpoint.label })}
                          value={endpoint.label}
                          onChange={(e) => editEndpoint(endpoint.id, { label: e.target.value })}
                        />
                      </label>
                      <label className="ht-settings__inline">
                        <span className="ht-settings__inline-label">{t('web.ai.settings.field.url')}</span>
                        <input
                          type="text"
                          aria-label={t('web.ai.settings.urlAria', { name: endpoint.label })}
                          value={endpoint.endpoint}
                          onChange={(e) => editEndpoint(endpoint.id, { endpoint: e.target.value })}
                        />
                      </label>
                      <label className="ht-settings__inline">
                        <span className="ht-settings__inline-label">{t('web.ai.settings.field.model')}</span>
                        <input
                          type="text"
                          aria-label={t('web.ai.settings.modelAria', { name: endpoint.label })}
                          value={endpoint.model}
                          onChange={(e) => editEndpoint(endpoint.id, { model: e.target.value })}
                        />
                      </label>

                      {/* 🔴 停用开关 —— `AiEndpointConfig.disabled` 的**唯一生产者**。
                          这个字段一直只有"读"：`resolveRoute` 真的会跳过停用端点，
                          而全仓没有任何地方写它。用户想"暂时别用这个端点"只能删掉，
                          删除会连带清掉路由与授权 —— 代价完全不成比例。
                          ⚠️ 写入走 `editEndpoint` → `updateRouting`（唯一路由写入口），
                          所以授权会被重算一遍；停用**不改变目的地**，授权不会被清掉。 */}
                      <label className="ht-settings__inline">
                        <input
                          type="checkbox"
                          data-testid={`endpoint-${endpoint.id}-disabled`}
                          aria-label={t('web.ai.settings.endpointDisabled.aria', {
                            name: endpoint.label,
                          })}
                          checked={endpoint.disabled === true}
                          onChange={(e) =>
                            editEndpoint(endpoint.id, { disabled: e.target.checked })
                          }
                        />
                        <span className="ht-settings__inline-label">
                          {t('web.ai.settings.endpointDisabled.label')}
                        </span>
                      </label>
                      {endpoint.disabled === true && (
                        <p
                          className="ht-settings__hint"
                          data-testid={`endpoint-${endpoint.id}-disabled-note`}
                        >
                          <strong>{t('web.ai.settings.endpointDisabled.tag')}</strong>
                          {t('web.ai.settings.endpointDisabled.note')}
                        </p>
                      )}
                      {/* 🔴 能力声明 —— 不勾就没有。见文件上方 CAPABILITY_ORDER 的说明。 */}
                      <fieldset className="ht-settings__caps">
                        <legend className="ht-settings__inline-label">{t('web.ai.settings.field.capability')}</legend>
                        {CAPABILITY_ORDER.map((capability) => {
                          const declared = endpoint.capabilities?.includes(capability) ?? false;
                          const neededBy = featuresNeeding(capability, t, locale);
                          return (
                            <label key={capability} className="ht-settings__cap">
                              <input
                                type="checkbox"
                                aria-label={t('web.ai.settings.capabilityAria', {
                                  capability,
                                  name: endpoint.label,
                                })}
                                checked={declared}
                                onChange={(e) => {
                                  const current = endpoint.capabilities ?? [];
                                  const next = e.target.checked
                                    ? [...current, capability]
                                    : current.filter((c) => c !== capability);
                                  editEndpoint(endpoint.id, { capabilities: next });
                                }}
                              />
                              <span>{capabilityLabel[capability]}</span>
                              {neededBy !== '' && (
                                <span className="ht-settings__cap-hint">{`${PAIRED_PARENS[locale][0]}${neededBy}${PAIRED_PARENS[locale][1]}`}</span>
                              )}
                            </label>
                          );
                        })}
                      </fieldset>
                      {urlVerdict !== undefined && !urlVerdict.ok && (
                        <span className="ht-settings__tag--remote" data-testid={`endpoint-invalid-${endpoint.id}`}>
                          <AlertTriangle size={ICON_SIZE.xs} aria-hidden="true" />
                          {endpointRejectionText(urlVerdict.reason, endpoint.endpoint, t)}
                        </span>
                      )}
                      <span
                        className={isLocal ? 'ht-settings__tag' : 'ht-settings__tag ht-settings__tag--remote'}
                      >
                        {isLocal ? (
                          <>
                            <ShieldCheck size={ICON_SIZE.xs} aria-hidden="true" /> {t('web.ai.settings.tag.local')}
                          </>
                        ) : (
                          <>
                            <AlertTriangle size={ICON_SIZE.xs} aria-hidden="true" /> {t('web.ai.settings.tag.remote')}
                          </>
                        )}
                      </span>

                      {endpoint.keyRef !== undefined && (
                        <span className="ht-settings__key">
                          <Lock size={ICON_SIZE.xs} aria-hidden="true" />
                          <input
                            type="password"
                            aria-label={t('web.ai.settings.keyAria', { name: endpoint.label })}
                            placeholder={secrets.knownRefs().includes(endpoint.keyRef) ? t('web.ai.settings.keyKnown') : t('web.ai.settings.keyPlaceholder')}
                            value={keyDraft[endpoint.keyRef] ?? ''}
                            onChange={(e) => {
                              setKeyDraft((d) => ({ ...d, [endpoint.keyRef as string]: e.target.value }));
                            }}
                          />
                          <button
                            type="button"
                            className="ht-btn ht-btn--ghost"
                            onClick={() => {
                              const ref = endpoint.keyRef as string;
                              secrets.set(ref, keyDraft[ref] ?? '');
                              setKeyDraft((d) => ({ ...d, [ref]: '' }));
                              // 触发一次重渲染，让"已在本次会话中"更新
                              update({ ...settings });
                            }}
                          >
                            {t('web.ai.settings.keyRemember')}
                          </button>
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      className="ht-btn ht-btn--ghost"
                      aria-label={t('web.ai.settings.deleteAria', { name: endpoint.label })}
                      onClick={() => removeEndpoint(endpoint.id)}
                    >
                      <Trash2 size={ICON_SIZE.xs} aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>

            <div className="ht-settings__actions">
              {AI_ENDPOINT_PRESETS.map((preset) => {
                const added = routing.endpoints.some((e) => e.id === preset.id);
                const copy = presetText(preset, t);
                return (
                  <button
                    key={preset.id}
                    type="button"
                    className="ht-btn ht-btn--ghost"
                    disabled={added}
                    data-testid={`add-preset-${preset.id}`}
                    title={copy.prerequisite}
                    onClick={() => addEndpoint({ ...preset.config, label: copy.label })}
                  >
                    <Plus size={ICON_SIZE.xs} aria-hidden="true" />
                    {added
                      ? t('web.ai.settings.presetAdded', { name: copy.label })
                      : t('web.ai.settings.presetAdd', { name: copy.label })}
                  </button>
                );
              })}
              <button
                type="button"
                className="ht-btn ht-btn--ghost"
                data-testid="add-custom-endpoint"
                onClick={addCustomEndpoint}
              >
                <Plus size={ICON_SIZE.xs} aria-hidden="true" />
                {t('web.ai.settings.addCustom')}
              </button>
            </div>

            {rejected.length > 0 && (
              <ul className="ht-settings__errors" data-testid="rejected-endpoints">
                {rejected.map((r) => (
                  <li key={r.endpoint}>
                    <AlertTriangle size={ICON_SIZE.xs} aria-hidden="true" />
                    {endpointRejectionText(r.reason, r.endpoint, t)}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ── 功能路由 + 逐功能授权 ────────────────────────────── */}
          <section
            className="ht-settings__section"
            ref={featuresSectionRef}
            data-testid="ai-features-section"
            data-focused={
              focused === 'capability' || focused === 'consent' ? 'true' : undefined
            }
          >
            <h3 className="ht-settings__h3 ht-type-headline">{t('web.ai.settings.features.title')}</h3>
            <p className="ht-settings__hint">
              {t('web.ai.settings.features.hintLead')}<strong>{t('web.ai.settings.features.hintStrong')}</strong>{t('web.ai.settings.features.hintTail')}
            </p>

            {FEATURE_ORDER.map((feature) => {
              const enabled = (routing.routes[feature] ?? []).length > 0;
              const needsConsent = enabled && routeTouchesRemote(feature) && !hasConsent(feature);
              return (
                <div key={feature} className="ht-settings__feature" data-testid={`feature-${feature}`}>
                  <span className="ht-settings__feature-name">{featureLabel[feature]}</span>
                  <div className="ht-settings__chips">
                    {routing.endpoints.map((endpoint) => {
                      const on = (routing.routes[feature] ?? []).some(
                        (t) => t.endpointId === endpoint.id,
                      );
                      return (
                        <button
                          key={endpoint.id}
                          type="button"
                          className={on ? 'ht-chip ht-chip--on' : 'ht-chip'}
                          aria-pressed={on}
                          onClick={() => toggleRoute(feature, endpoint.id)}
                        >
                          {on && <Check size={ICON_SIZE.xs} aria-hidden="true" />}
                          {endpoint.label}
                        </button>
                      );
                    })}
                    {routing.endpoints.length === 0 && (
                      <span className="ht-settings__hint">{t('web.ai.settings.features.empty')}</span>
                    )}
                  </div>

                  {needsConsent && (
                    <div className="ht-settings__consent" data-testid={`consent-${feature}`}>
                      <span>{t('web.ai.settings.consentLead', { feature: featureLabel[feature] })}</span>
                      <button type="button" className="ht-btn ht-btn--primary" onClick={() => grant(feature)}>
                        {t('web.ai.settings.grant')}
                      </button>
                    </div>
                  )}
                  {/* 🔴 能力缺口：能配、但配了也跑不起来 —— 必须说出来 */}
                  {(() => {
                    const gaps = capabilityGaps(feature, routing);
                    if (gaps === undefined || gaps.length === 0) return null;
                    // 只要**有一个**端点能满足，这个功能就能工作 —— 不用提示。
                    if (gaps.some((g) => g.missing.length === 0)) return null;
                    const first = gaps[0]!;
                    const endpoint = routing.endpoints.find((e) => e.id === first.endpointId);
                    if (endpoint === undefined) return null;
                    return (
                      <div className="ht-settings__warn" data-testid={`cap-gap-${feature}`}>
                        <span>
                          {t('web.ai.settings.gapLead', { feature: featureLabel[feature] })}
                          {first.missing.map((c) => capabilityLabel[c]).join(LIST_SEPARATOR[locale])}
                          {t('web.ai.settings.gapMid')}<strong>{endpoint.label}</strong>{t('web.ai.settings.gapTail')}
                        </span>
                        <button
                          type="button"
                          className="ht-btn ht-btn--primary"
                          data-testid={`cap-fix-${feature}`}
                          onClick={() => {
                            const merged = [
                              ...new Set([...(endpoint.capabilities ?? []), ...first.missing]),
                            ] as AiCapability[];
                            editEndpoint(endpoint.id, { capabilities: merged });
                          }}
                        >
                          {t('web.ai.settings.gapFix', { name: endpoint.label })}
                        </button>
                      </div>
                    );
                  })()}

                  {enabled && hasConsent(feature) && (
                    <div className="ht-settings__consent" data-testid={`granted-${feature}`}>
                      <span>
                        <ShieldCheck size={ICON_SIZE.xs} aria-hidden="true" /> {t('web.ai.settings.granted')}
                      </span>
                      <button type="button" className="ht-btn ht-btn--ghost" onClick={() => revoke(feature)}>
                        {t('web.ai.settings.revoke')}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </section>

          {/* ── 助手能力档位（ADR-0045 §2.2）：第二个授权前端 ──────────
              🔴 为什么"又一个开关"不是重复：下面「本机 API」那张逐工具表管的是
              **外部程序**（MCP / 本机 HTTP）能不能调某个工具（ADR-0011：默认全关）。
              内置助手如果共用那张表，用户为了"让 AI 帮我看看今天有什么"就得去开
              一个他并不想开给别的进程的口子。两档最后都汇到同一个判据
              `isToolGranted()` —— **授权只有一份**（ADR-0035 没变），变的只是谁来勾。

              ⚠️ 这一块必须出现在**任何一次对话之前**，因为它同时是那条
              "一次性并集披露"：多步循环中途不再逐步征求同意（那会变成用户
              无脑点下去的疲劳闸门），所以这里说的必须是**这一次最多会送出的全部**。 */}
          <section className="ht-settings__section" data-testid="ai-assistant-section">
            <h3 className="ht-settings__h3 ht-type-headline">{t('web.ai.assistant.title')}</h3>
            <p className="ht-settings__hint">{t('web.ai.assistant.hint')}</p>

            <div
              className="ht-settings__options"
              role="radiogroup"
              aria-label={t('web.ai.assistant.title')}
              data-testid="assistant-tier-group"
            >
              {ASSISTANT_TIER_ORDER.map((tier) => (
                <label key={tier} className="ht-settings__option" data-testid={`assistant-tier-${tier}`}>
                  <input
                    type="radio"
                    name="assistant-tier"
                    checked={settings.assistantTier === tier}
                    onChange={() => update({ ...settings, assistantTier: tier })}
                  />
                  <span>
                    {tierLabel[tier]}
                    <span className="ht-settings__hint"> {tierNote[tier]}</span>
                  </span>
                </label>
              ))}
            </div>

            {/* 🔴 披露的字段名**来自目录的 `egressFields`**，不是这里手写一份名单 ——
                手写的就是抄件，而抄件一定漂（本仓库为这件事付过几次学费）。
                档位换了，这份集合跟着变：`read-only` 档里写工具根本不进来。 */}
            <p className="ht-settings__hint" data-testid="assistant-egress-title">
              {t('web.ai.assistant.egressTitle')}
            </p>
            <p className="ht-settings__hint" data-testid="assistant-egress-fields">
              {assistantPlan.fields.join(LIST_SEPARATOR[locale])}
            </p>
            {/* 档位之间**真正**的差别在这一行：写工具只在高一级进模型上下文。
                （出境字段两档相同 —— 写工具只产出提案、结果不回送模型，
                所以它们不贡献字段。这句话不写出来，用户会以为"换了档就没送正文"。） */}
            <p className="ht-settings__hint" data-testid="assistant-tools-title">
              {t('web.ai.assistant.toolsTitle')}
            </p>
            <p className="ht-settings__hint" data-testid="assistant-tools">
              {assistantPlan.tools.join(LIST_SEPARATOR[locale])}
            </p>
            <p className="ht-settings__hint" data-testid="assistant-limits">
              {t('web.ai.assistant.maxRequests', { n: assistantPlan.maxRequests })}
              {LIST_SEPARATOR[locale]}
              {t('web.ai.assistant.maxMessages', { n: assistantPlan.maxMessages })}
              {LIST_SEPARATOR[locale]}
              {t('web.ai.assistant.maxBytes', { n: assistantPlan.maxBytesPerRequest })}
            </p>
            <p className="ht-settings__hint" data-testid="assistant-mcp-split">
              {t('web.ai.assistant.mcpSplit')}
            </p>
          </section>
        </>
      )}

      {/* ── 闸 3（入站）：本机 API ───────────────────────────────── */}
      <section className="ht-settings__section">
        <h3 className="ht-settings__h3 ht-type-headline">{t('web.ai.settings.localApi.title')}</h3>
        <p className="ht-settings__hint">
          {t('web.ai.settings.localApi.hintLead')}<strong>{t('web.ai.settings.localApi.hintStrong')}</strong>
        </p>

        {/* 🔴🔴 **这一段是诚实的必要部分，不是说明文字。**
            这里配的东西存在**浏览器**里，而真正跑起来的 MCP 服务读的是
            `~/.heyta/local-api.json`。两边**不会自动同步**。
            不写清楚的话，用户会以为"我在这里打开了，它就生效了" ——
            而实际上什么都不会发生，也不会有任何报错。 */}
        <p className="ht-settings__warn" data-testid="local-api-source-note">
          <AlertTriangle size={ICON_SIZE.xs} aria-hidden="true" />
          {t('web.ai.settings.localApi.source.part1')}
          <code>{t('web.ai.settings.localApi.source.file')}</code>{t('web.ai.settings.localApi.source.part2')}
          <code>{t('web.ai.settings.localApi.source.command')}</code>
          {t('web.ai.settings.localApi.source.part3')}
        </p>

        <Toggle
          id="local-api-enabled"
          label={t('web.ai.settings.localApi.enabled.label')}
          note={t('web.ai.settings.localApi.enabled.note', { address: localApi.bindAddress })}
          checked={localApi.enabled}
          onChange={(v) => update({ ...settings, localApi: { ...localApi, enabled: v } })}
        />

        {localApi.enabled && (
          <>
            <label className="ht-settings__field">
              <span>{t('web.ai.settings.localApi.token.label')}</span>
              <input
                type="text"
                aria-label={t('web.ai.settings.localApi.token.aria')}
                value={localApi.token ?? ''}
                onChange={(e) => update({ ...settings, localApi: { ...localApi, token: e.target.value } })}
              />
            </label>
            <p className="ht-settings__hint">
              {t('web.ai.settings.localApi.token.hint')}
            </p>

            {!localApiVerdict.ok && (
              <p className="ht-settings__danger" role="alert" data-testid="local-api-error">
                <AlertTriangle size={ICON_SIZE.xs} aria-hidden="true" />
                <span>{localApiErrorText(localApiVerdict.reason, localApi, t)}</span>
              </p>
            )}

            <div className="ht-settings__tools">
              {LOCAL_API_TOOLS.map((tool) => {
                const on = localApi.grants?.[tool.name] === true;
                return (
                  <label key={tool.name} className="ht-settings__tool">
                    <input
                      type="checkbox"
                      checked={on}
                      aria-label={tool.name}
                      onChange={(e) =>
                        update({
                          ...settings,
                          localApi: {
                            ...localApi,
                            grants: { ...localApi.grants, [tool.name]: e.target.checked },
                          },
                        })
                      }
                    />
                    <span>
                      {tool.name}
                      <em className="ht-settings__tool-kind">
                        {tool.kind === 'write'
                          ? t('web.ai.settings.localApi.kind.write')
                          : t('web.ai.settings.localApi.kind.read')}
                      </em>
                    </span>
                  </label>
                );
              })}
            </div>
          </>
        )}
      </section>

      <p className="ht-settings__notice" data-testid="key-notice">
        <Lock size={ICON_SIZE.xs} aria-hidden="true" />
        {t('web.ai.settings.keyNotice')}
      </p>

      <div className="ht-settings__actions">
      <button
        type="button"
        className="ht-btn ht-btn--ghost"
        data-testid="reset-ai-settings"
        onClick={() => {
          secrets.clear();
          setRejected([]);
          update(defaultAiSettings());
        }}
      >
        {t('web.ai.settings.reset')}
      </button>
      </div>
    </div>
  );
}

/** 一个开关。**用 checkbox 而不是自定义 div**，键盘与读屏器直接可用。 */
function Toggle({
  id,
  label,
  note,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  note: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="ht-settings__toggle" htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="ht-settings__toggle-body">
        <span className="ht-settings__toggle-label">{label}</span>
        <span className="ht-settings__hint">{note}</span>
      </span>
    </label>
  );
}
