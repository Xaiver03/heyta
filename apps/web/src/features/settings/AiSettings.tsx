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

import { useState } from 'react';
import {
  AI_ENDPOINT_PRESETS,
  classifyDestination,
  validateEndpointUrl,
  requiredCapabilities,
  describeEndpointHealth,
  fromHealthSnapshot,
  isAvailable,
  type AiRoutingConfig,
  type AiCapability,
  type AiEndpointConfig,
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

const CAPABILITY_LABEL: Readonly<Record<AiCapability, string>> = {
  structured_output: '结构化输出',
  long_context: '长上下文',
  vision: '图片理解',
  tool_calling: '工具调用',
};

/** 哪些功能需要这个能力 —— 让用户知道勾了有什么用。 */
function featuresNeeding(capability: AiCapability): string {
  const names: Partial<Record<AiFeature, string>> = {
    capture: '快速捕获',
    breakdown: '拆解任务',
    prioritize: '排序建议',
    'duration-estimate': '耗时估计',
  };
  const hit: string[] = [];
  for (const [feature, label] of Object.entries(names)) {
    if (requiredCapabilities(feature as AiFeature).includes(capability)) hit.push(label ?? feature);
  }
  return hit.join('、');
}
import { LOCAL_API_TOOLS, validateLocalApiConfig } from '@heyta/local-api';
import { AlertTriangle, Check, Lock, Plus, ShieldCheck, Trash2 } from 'lucide-react';

import {
  WEB_KEY_STORAGE_NOTICE,
  defaultAiSettings,
  saveAiSettings,
  type PersistedAiSettings,
  type SessionSecretStore,
} from './aiStore.js';

/** 功能的中文名。**不直接用 `AiFeature` 字面量**，那对用户没有意义。 */
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

const FEATURE_LABELS: Readonly<Record<AiFeature, string>> = {
  capture: '一句话捕获',
  breakdown: '拆解任务',
  prioritize: '优先级建议',
  'duration-estimate': '预估耗时',
};

const FEATURE_ORDER: readonly AiFeature[] = [
  'capture',
  'breakdown',
  'prioritize',
  'duration-estimate',
];

export interface AiSettingsProps {
  initial: PersistedAiSettings;
  secrets: SessionSecretStore;
  /** 配置变化时回调（外部持久化）。默认直接存 localStorage。 */
  onChange?: (next: PersistedAiSettings) => void;
}

export function AiSettings({ initial, secrets, onChange }: AiSettingsProps) {
  const [settings, setSettings] = useState<PersistedAiSettings>(initial);
  const [keyDraft, setKeyDraft] = useState<Record<string, string>>({});
  /** 被拒绝的端点地址及其原因 —— 必须显示，不能静默丢弃。 */
  const [rejected, setRejected] = useState<readonly { endpoint: string; message: string }[]>([]);

  function update(next: PersistedAiSettings): void {
    setSettings(next);
    if (onChange !== undefined) onChange(next);
    else saveAiSettings(next);
  }

  const { routing, localApi } = settings;
  const localApiVerdict = validateLocalApiConfig(localApi);

  // ── 端点 ────────────────────────────────────────────────────────────
  function addEndpoint(config: AiEndpointConfig): void {
    const verdict = validateEndpointUrl(config.endpoint);
    if (!verdict.ok) {
      setRejected((r) => [...r, { endpoint: config.endpoint, message: verdict.message }]);
      return;
    }
    setRejected((r) => r.filter((x) => x.endpoint !== config.endpoint));
    if (routing.endpoints.some((e) => e.id === config.id)) return;
    update({ ...settings, routing: { ...routing, endpoints: [...routing.endpoints, config] } });
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
    update({
      ...settings,
      routing: {
        ...routing,
        endpoints: routing.endpoints.map((e) => (e.id === id ? { ...e, ...patch } : e)),
      },
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
    update({
      ...settings,
      routing: {
        ...routing,
        endpoints: [
          ...routing.endpoints,
          { id: `custom-${String(n)}`, label: `自定义端点 ${String(n)}`, endpoint: '', model: '' },
        ],
      },
    });
  }

  function removeEndpoint(id: string): void {
    const routes: typeof routing.routes = {};
    for (const [feature, targets] of Object.entries(routing.routes)) {
      const kept = (targets ?? []).filter((t) => t.endpointId !== id);
      if (kept.length > 0) routes[feature as AiFeature] = kept;
    }
    update({
      ...settings,
      routing: {
        ...routing,
        endpoints: routing.endpoints.filter((e) => e.id !== id),
        routes,
      },
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
    update({ ...settings, routing: { ...routing, routes } });
  }

  // ── 授权 ────────────────────────────────────────────────────────────
  function grant(feature: AiFeature): void {
    const consent: EgressConsent = {
      feature,
      destination: 'user-endpoint',
      grantedAt: Date.now(),
    };
    const kept = settings.consents.filter(
      (c) => !(c.feature === feature && c.destination === 'user-endpoint'),
    );
    update({ ...settings, consents: [...kept, consent] });
  }

  function revoke(feature: AiFeature): void {
    update({
      ...settings,
      consents: settings.consents.filter(
        (c) => !(c.feature === feature && c.destination === 'user-endpoint'),
      ),
    });
  }

  /** 这个功能当前是否会走到远端（决定要不要问授权）。 */
  function routeTouchesRemote(feature: AiFeature): boolean {
    const targets = routing.routes[feature] ?? [];
    return targets.some((t) => {
      const endpoint = routing.endpoints.find((e) => e.id === t.endpointId);
      if (endpoint === undefined) return false;
      return classifyDestination({ mode: 'own', endpoint: endpoint.endpoint }) !== 'none';
    });
  }

  function hasConsent(feature: AiFeature): boolean {
    return settings.consents.some(
      (c) => c.feature === feature && c.destination === 'user-endpoint',
    );
  }

  // 每次渲染算一次（不是每个端点一次）。`now` 也取一次，
  // 免得同一次渲染里不同端点用了不同的"现在"。
  const now = Date.now();
  const healthMap = fromHealthSnapshot(settings.health, now);

  return (
    <div className="ht-settings" data-testid="ai-settings">
      <h2 className="ht-settings__title">AI</h2>

      {/* ── 闸 1：总开关 ─────────────────────────────────────────── */}
      <Toggle
        id="ai-enabled"
        label="启用 AI 功能"
        note="关着的时候 heyta 不会向任何地方发送数据。"
        checked={routing.enabled}
        onChange={(v) => update({ ...settings, routing: { ...routing, enabled: v } })}
      />

      {routing.enabled && (
        <>
          {/* ── 闸 2：允许远程 ───────────────────────────────────── */}
          <Toggle
            id="ai-allow-remote"
            label="允许远程端点"
            note="关着时只会使用本机端点（数据不离开这台设备）。"
            checked={routing.allowRemote}
            onChange={(v) => update({ ...settings, routing: { ...routing, allowRemote: v } })}
          />

          {routing.allowRemote && (
            <p className="ht-settings__danger" role="note" data-testid="remote-warning">
              <AlertTriangle size={14} aria-hidden="true" />
              <span>
                远端端点能看到你的任务内容明文。这条路径<strong>不受端到端加密保护</strong>，
                与任务同步是不同的通道。每个功能需要单独授权。
              </span>
            </p>
          )}

          {/* ── 端点列表 ─────────────────────────────────────────── */}
          <section className="ht-settings__section">
            <h3 className="ht-settings__h3">端点</h3>

            {/* 🔴🔴 **为什么这里要明说"没有托管 AI"。**
                产品上只有两种供给方式：用户自备端点（own），或 heyta 托管（managed）。
                我们**只提供了前者**，而界面上**完全不提**后者 ——
                用户会以为"heyta 就是不自带 AI"，而不知道这是一个**有意的决定**，
                更不知道**在什么条件下它会变**。

                `managed` 在代码里是完整实现的（分类、保留策略、闸门都在），
                只是被 `assertEnableable` 挡着不许启用 —— 因为
                **还没有那个服务，保留策略也就无从定案**。
                没定案就不装作能开，这是 ADR-0006 §5 的结论。

                一个"不说自己缺了什么"的界面，和一个"说了但做不到"的界面一样不诚实。 */}
            <p className="ht-settings__hint" data-testid="managed-ai-note">
              heyta <strong>不自带</strong> AI 服务 —— 需要你自己接一个端点（本机或远端）。
              我们<strong>没有</strong>提供「heyta 托管的 AI」。这不是还没做，
              而是<strong>在没有真正跑起来的服务之前，托管模式的数据保留策略无从定案</strong>；
              没有定案就不开放。等有了服务，这条会在同一位置说明。
            </p>

            {routing.endpoints.length === 0 && (
              <p className="ht-settings__hint">
                还没有端点。可以加一个本机端点 —— 它不需要授权，数据也不出设备。
              </p>
            )}

            {/* 🔴🔴 端点健康必须显示出来 —— 否则用户看到的和实际发生的事不一致。
                熔断的端点在界面上与正常端点**长得一模一样**，
                用户只会看到"AI 暂时不可用"，不知道是哪个端点、也不知道多久恢复。
                （`describeEndpointHealth` 早就写好了，一直没人调。） */}
            <ul className="ht-settings__list">
              {routing.endpoints.map((endpoint) => {
                const health = healthMap[endpoint.id];
                const healthy = isAvailable(health, now);
                const urlVerdict = validateEndpointUrl(endpoint.endpoint);
                const destination = urlVerdict.ok
                  ? urlVerdict.destination
                  : classifyDestination({ mode: 'own', endpoint: endpoint.endpoint });
                const isLocal = destination === 'none';
                return (
                  <li key={endpoint.id} className="ht-settings__item" data-testid={`endpoint-${endpoint.id}`}>
                    {health !== undefined && !healthy && (
                      <p className="ht-settings__warn" data-testid={`endpoint-unhealthy-${endpoint.id}`}>
                        <AlertTriangle size={12} aria-hidden="true" />
                        {describeEndpointHealth(health, now)}
                      </p>
                    )}
                    <div className="ht-settings__item-main">
                      {/* 🔴 可编辑：预设一键加进来只是起点，用户必须能改。
                          没有编辑能力的话"添加自定义端点"会加进一个 `https://`
                          然后**用户没有任何办法把它改对** —— 那是死路。 */}
                      <label className="ht-settings__inline">
                        <span className="ht-settings__inline-label">名称</span>
                        <input
                          type="text"
                          aria-label={`${endpoint.label} 的名称`}
                          value={endpoint.label}
                          onChange={(e) => editEndpoint(endpoint.id, { label: e.target.value })}
                        />
                      </label>
                      <label className="ht-settings__inline">
                        <span className="ht-settings__inline-label">地址</span>
                        <input
                          type="text"
                          aria-label={`${endpoint.label} 的地址`}
                          value={endpoint.endpoint}
                          onChange={(e) => editEndpoint(endpoint.id, { endpoint: e.target.value })}
                        />
                      </label>
                      <label className="ht-settings__inline">
                        <span className="ht-settings__inline-label">模型</span>
                        <input
                          type="text"
                          aria-label={`${endpoint.label} 的模型`}
                          value={endpoint.model}
                          onChange={(e) => editEndpoint(endpoint.id, { model: e.target.value })}
                        />
                      </label>

                      {/* 🔴 能力声明 —— 不勾就没有。见文件上方 CAPABILITY_ORDER 的说明。 */}
                      <fieldset className="ht-settings__caps">
                        <legend className="ht-settings__inline-label">能力</legend>
                        {CAPABILITY_ORDER.map((capability) => {
                          const declared = endpoint.capabilities?.includes(capability) ?? false;
                          const neededBy = featuresNeeding(capability);
                          return (
                            <label key={capability} className="ht-settings__cap">
                              <input
                                type="checkbox"
                                aria-label={`${endpoint.label} 的能力 ${capability}`}
                                checked={declared}
                                onChange={(e) => {
                                  const current = endpoint.capabilities ?? [];
                                  const next = e.target.checked
                                    ? [...current, capability]
                                    : current.filter((c) => c !== capability);
                                  editEndpoint(endpoint.id, { capabilities: next });
                                }}
                              />
                              <span>{CAPABILITY_LABEL[capability]}</span>
                              {neededBy !== '' && (
                                <span className="ht-settings__cap-hint">（{neededBy}）</span>
                              )}
                            </label>
                          );
                        })}
                      </fieldset>
                      {urlVerdict !== undefined && !urlVerdict.ok && (
                        <span className="ht-settings__tag--remote" data-testid={`endpoint-invalid-${endpoint.id}`}>
                          <AlertTriangle size={12} aria-hidden="true" />
                          {urlVerdict.message}
                        </span>
                      )}
                      <span
                        className={isLocal ? 'ht-settings__tag' : 'ht-settings__tag ht-settings__tag--remote'}
                      >
                        {isLocal ? (
                          <>
                            <ShieldCheck size={12} aria-hidden="true" /> 本机，数据不出设备
                          </>
                        ) : (
                          <>
                            <AlertTriangle size={12} aria-hidden="true" /> 远端，数据会离开设备
                          </>
                        )}
                      </span>

                      {endpoint.keyRef !== undefined && (
                        <span className="ht-settings__key">
                          <Lock size={12} aria-hidden="true" />
                          <input
                            type="password"
                            aria-label={`${endpoint.label} 的密钥`}
                            placeholder={secrets.knownRefs().includes(endpoint.keyRef) ? '已在本次会话中' : '输入密钥'}
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
                            记住（本次会话）
                          </button>
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      className="ht-btn ht-btn--ghost"
                      aria-label={`删除端点 ${endpoint.label}`}
                      onClick={() => removeEndpoint(endpoint.id)}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>

            <div className="ht-settings__actions">
              {AI_ENDPOINT_PRESETS.map((preset) => {
                const added = routing.endpoints.some((e) => e.id === preset.id);
                return (
                  <button
                    key={preset.id}
                    type="button"
                    className="ht-btn ht-btn--ghost"
                    disabled={added}
                    data-testid={`add-preset-${preset.id}`}
                    title={preset.prerequisite}
                    onClick={() => addEndpoint(preset.config)}
                  >
                    <Plus size={14} aria-hidden="true" />
                    {added ? `已添加 ${preset.label}` : `添加 ${preset.label}`}
                  </button>
                );
              })}
              <button
                type="button"
                className="ht-btn ht-btn--ghost"
                data-testid="add-custom-endpoint"
                onClick={addCustomEndpoint}
              >
                <Plus size={14} aria-hidden="true" />
                添加自定义端点
              </button>
            </div>

            {rejected.length > 0 && (
              <ul className="ht-settings__errors" data-testid="rejected-endpoints">
                {rejected.map((r) => (
                  <li key={r.endpoint}>
                    <AlertTriangle size={12} aria-hidden="true" />
                    {r.message}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ── 功能路由 + 逐功能授权 ────────────────────────────── */}
          <section className="ht-settings__section">
            <h3 className="ht-settings__h3">功能</h3>
            <p className="ht-settings__hint">
              勾选哪个端点给哪个功能用。<strong>列表顺序就是尝试顺序</strong>（靠前的先试）。
            </p>

            {FEATURE_ORDER.map((feature) => {
              const enabled = (routing.routes[feature] ?? []).length > 0;
              const needsConsent = enabled && routeTouchesRemote(feature) && !hasConsent(feature);
              return (
                <div key={feature} className="ht-settings__feature" data-testid={`feature-${feature}`}>
                  <span className="ht-settings__feature-name">{FEATURE_LABELS[feature]}</span>
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
                          {on && <Check size={12} aria-hidden="true" />}
                          {endpoint.label}
                        </button>
                      );
                    })}
                    {routing.endpoints.length === 0 && (
                      <span className="ht-settings__hint">先添加端点</span>
                    )}
                  </div>

                  {needsConsent && (
                    <div className="ht-settings__consent" data-testid={`consent-${feature}`}>
                      <span>「{FEATURE_LABELS[feature]}」有远端端点，需要你授权数据出境。</span>
                      <button type="button" className="ht-btn ht-btn--primary" onClick={() => grant(feature)}>
                        授权
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
                          ⚠️ 「{FEATURE_LABELS[feature]}」需要
                          {first.missing.map((c) => CAPABILITY_LABEL[c]).join('、')}
                          ，但<strong>{endpoint.label}</strong>没有声明它 —— 这个功能会一直不工作。
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
                          给「{endpoint.label}」补上
                        </button>
                      </div>
                    );
                  })()}

                  {enabled && hasConsent(feature) && (
                    <div className="ht-settings__consent" data-testid={`granted-${feature}`}>
                      <span>
                        <ShieldCheck size={12} aria-hidden="true" /> 已授权数据出境
                      </span>
                      <button type="button" className="ht-btn ht-btn--ghost" onClick={() => revoke(feature)}>
                        撤销
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        </>
      )}

      {/* ── 闸 3（入站）：本机 API ───────────────────────────────── */}
      <section className="ht-settings__section">
        <h3 className="ht-settings__h3">本机 API</h3>
        <p className="ht-settings__hint">
          让本机的其他程序（编辑器、脚本、AI 助手）读写你的任务。
          <strong>默认关闭，且每个工具要单独打开。</strong>
        </p>

        {/* 🔴🔴 **这一段是诚实的必要部分，不是说明文字。**
            这里配的东西存在**浏览器**里，而真正跑起来的 MCP 服务读的是
            `~/.heyta/local-api.json`。两边**不会自动同步**。
            不写清楚的话，用户会以为"我在这里打开了，它就生效了" ——
            而实际上什么都不会发生，也不会有任何报错。 */}
        <p className="ht-settings__warn" data-testid="local-api-source-note">
          <AlertTriangle size={12} aria-hidden="true" />
          下面这些只存在**浏览器**里。真正让 MCP 服务生效的是配置文件
          <code>文件 ~/.heyta/local-api.json</code>，要用命令行生成：
          <code>命令 heyta-ai local-api init</code>
          （它会生成 token 并打印客户端配置片段）。两边目前**不会自动同步**。
        </p>

        <Toggle
          id="local-api-enabled"
          label="启用本机 API"
          note={`只监听 ${localApi.bindAddress}，不会暴露到局域网。`}
          checked={localApi.enabled}
          onChange={(v) => update({ ...settings, localApi: { ...localApi, enabled: v } })}
        />

        {localApi.enabled && (
          <>
            <label className="ht-settings__field">
              <span>访问 token</span>
              <input
                type="text"
                aria-label="本机 API 访问 token"
                value={localApi.token ?? ''}
                onChange={(e) => update({ ...settings, localApi: { ...localApi, token: e.target.value } })}
              />
            </label>
            <p className="ht-settings__hint">
              token 防的是这台机器上的其他程序，不是网络攻击 —— 没有它，
              任何程序都能读走你的全部任务。
            </p>

            {!localApiVerdict.ok && (
              <p className="ht-settings__danger" role="alert" data-testid="local-api-error">
                <AlertTriangle size={14} aria-hidden="true" />
                <span>{localApiVerdict.message}</span>
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
                        {tool.kind === 'write' ? '会改数据' : '只读'}
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
        <Lock size={12} aria-hidden="true" />
        {WEB_KEY_STORAGE_NOTICE}
      </p>

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
        恢复默认（全部关闭）
      </button>
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
