/**
 * 移动端的 AI 设置面
 * ==================
 *
 * 与 web 的 `features/settings/AiSettings.tsx` **同一套闸**，逐条对齐：
 *
 *   1. **每一道闸单独可见**（总开关 / 允许远程 / 逐功能出境授权 / 逐工具授权），
 *      不合并成一个"启用 AI"。合并的代价是用户为了用一个功能而顺手打开了另外三个。
 *   2. 远端端点旁边**永远**显示"数据会离开这台设备"那句（ADR-0006）。
 *   3. 授权**按功能**给，且**可以逐个撤销**。
 *   4. 密钥输入框旁边**明说**它只活在这次会话里（本端与 web 同一条诚实降级，
 *      见 `settings-store.ts` 文件头纪律 ②）。
 *   5. 危险状态用**文字**说，不只用颜色。
 *
 * 🔴 本组件**不发任何请求**，也不构造任何 op：它只写本机配置。
 * 出境的判定住在 `@heyta/ai` 的闸门里，写入的判定住在 `@heyta/app-host` 的动作层里。
 *
 * 🔴 档位的**字面量、出厂默认、渲染顺序**都不在这里 —— 它们来自
 * `@heyta/app-host` 的 `assistant-tier-settings.ts`；
 * 这里出现 `'read-only'` 这样的引号字面量会让 `check:layering` 直接红。
 */

import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import {
  AI_ENDPOINT_PRESETS,
  classifyDestination,
  endpointHealthDisclosure,
  fromHealthSnapshot,
  isAvailable,
  requiresEgressConsent,
  validateEndpointUrl,
  CAPABILITY_ORDER,
  type AiCapability,
  type AiEndpointConfig,
  type AiFeature,
} from '@heyta/ai';
import {
  ASSISTANT_TIER_ORDER,
  ASSISTANT_TIER_EXECUTE,
  ASSISTANT_TIER_READ_ONLY,
  DEFAULT_ASSISTANT_TIER,
  createAssistantTierStore,
  destinationForFeature,
  fetchManagedAiUsage,
  recomputeConsents,
  type AssistantTier,
  type ManagedAiUsageReading,
} from '@heyta/app-host';
import { LOCAL_API_TOOLS } from '@heyta/local-api';
import { useI18n, type MessageKey } from '@heyta/i18n';

import { Button, Card, Checkbox, Chip, SectionHeader, Stack, Text, TextField } from '../ui/kit';
import { readSyncConfig } from '../sync/config';
import { useMobileSync } from '../sync/store';
import { useTokens } from '../theme';
import { AI_FEATURE_LABEL_KEY, healthCopy, managedUsageCopy } from './copy';
import { aiSecrets, saveAiSettings, useAiSettings } from './settings-store';
import { INBOUND_CYCLE_COPY_KEY } from '../inbound/copy';
import { useInboundCycle } from '../inbound/status';
import { readDevicePref, writeDevicePref } from '../prefs/device-prefs';

/** 五个功能在设置里的渲染顺序 —— 与助手面的顺序同一份，不重排。 */
const FEATURE_ORDER = [
  'capture',
  'breakdown',
  'prioritize',
  'duration-estimate',
  'tool-calling',
  // Inbound automation is configured here, not exposed as a Chatbot mode.
  'inbound-automation',
] as const satisfies readonly AiFeature[];

/**
 * 助手档位仓库：判断（默认值 / fail-closed 归一 / 顺序）全在 app-host，
 * 本壳只给通道 —— 与 `createAssistantTierStore` 文件头说的那个用法一致
 * （原生端寄存在设备偏好库，与整块 AI 设置同一个通道，**不新表**）。
 */
const tierStore = createAssistantTierStore({
  read: () => readDevicePref('heyta.ai.tier'),
  write: (tier) => {
    writeDevicePref('heyta.ai.tier', tier);
  },
});

export function AiSettingsSection(): React.JSX.Element {
  const { t } = useI18n();
  const tokens = useTokens();
  const settings = useAiSettings();
  const [draftUrl, setDraftUrl] = useState('');
  const [draftLabel, setDraftLabel] = useState('');
  const [draftModel, setDraftModel] = useState('');
  const [draftKey, setDraftKey] = useState('');
  /**
   * 建端点时**要能声明能力**（ADR-0010 §3.4：显式声明、不做推断）。
   *
   * 🔴 2026-10-16 恢复：这一格在 main 侧那次重写（`d49f77e3`）里随整块表单被换掉，
   *   后果不是"少一个勾选项"，是**移动端建出来的端点永远只拿基线 `structured_output`**
   *   ⇒ `tool-calling`（要 `tool_calling`）与 `breakdown`（要 `long_context`）在手机上
   *   **结构上不可用**，而界面只表现为"发送按钮一直灰着"（排除码 `capability-missing`
   *   从不递给人）。`check:mobile-ai-anchors` 判据 ⑨ 就是为这件事存在的：
   *   "模型要求用户声明的字段，界面上必须有处可填"。
   */
  const [draftCaps, setDraftCaps] = useState<readonly AiCapability[]>([]);
  const [urlError, setUrlError] = useState<MessageKey | undefined>(undefined);
  const [savedWithoutKey, setSavedWithoutKey] = useState(false);

  const routing = settings.routing;

  /**
   * 同步状态 —— 只为了让"有没有服务器"与用量读数在**登录之后**重算。
   *
   * 🔴 服务器地址是用户**应用起来之后**才填的，而 AI 设置那一刻不会变。
   * 不挂这个订阅，刚登录完回到设置页仍按"没配服务器"算。
   */
  const sync = useMobileSync();
  const serverUrl = useMemo(() => readSyncConfig()?.serverUrl, [sync.dataRevision]);
  const managedReady = (serverUrl ?? '').trim() !== '';

  /**
   * 托管档的用量读数 —— **法务 §5.3 承诺的那句话**（与 web 同一条传输）。
   *
   * 🔴 `undefined`（还没拉）与 `unavailable`（拉了没读到）**不是一回事**：
   * 前者不渲染，后者要如实说"读不到"。两者都**不能**渲染成 `0 / 300` ——
   * 那会把"没有这一期/读不到"说成"这一期还没用过"，而修复动作完全不同。
   *
   * ⚠️ 只在选择托管档**且**有服务器时才拉：自备档不该因为打开设置页
   * 就向我们的服务器发一次请求（本地优先）。
   */
  const [usage, setUsage] = useState<ManagedAiUsageReading | undefined>(undefined);
  useEffect(() => {
    if (routing.mode !== 'managed' || !managedReady) {
      setUsage(undefined);
      return;
    }
    let alive = true;
    void fetchManagedAiUsage({
      baseUrl: serverUrl ?? '',
      getToken: async () => readSyncConfig()?.token,
    }).then((reading) => {
      if (alive) setUsage(reading);
    });
    return () => {
      alive = false;
    };
  }, [routing.mode, managedReady, serverUrl, sync.dataRevision]);

  /** 三分支的**判断**住在 `copy.ts`（那里有判据；移动端没有 RN 渲染测试设施）。 */
  const usageCopy = managedUsageCopy(usage);
  /**
   * 正在添加的这枚端点的**默认名**：草稿里填了就用它，否则用「自定义端点 N」。
   *
   * 🔴 它是**一处**计算、两处消费（落库的 `label` 与密钥框的无障碍名）——
   * 与 web 的 `addCustomEndpoint` 同一个口径（`endpoints.length + 1`）。
   * 两份各算一次的话，用户在草稿里改了名字而密钥框还念旧名。
   */
  const draftEndpointName =
    draftLabel.trim() === ''
      ? t('web.ai.settings.customLabel', { n: routing.endpoints.length + 1 })
      : draftLabel.trim();

  function commit(nextRouting: typeof routing): void {
    const consents = recomputeConsents(settings.consents, nextRouting);
    const wrote = saveAiSettings({ ...settings, routing: nextRouting, consents });
    setSavedWithoutKey(!wrote);
  }

  function addEndpoint(): void {
    const verdict = validateEndpointUrl(draftUrl.trim());
    if (!verdict.ok) {
      setUrlError(VERDICT_KEY[verdict.reason]);
      return;
    }
    setUrlError(undefined);
    const id = `custom-${String(Date.now())}`;
    const endpoint: AiEndpointConfig = {
      id,
      label: draftEndpointName,
      endpoint: draftUrl.trim(),
      model: draftModel.trim(),
      // 一条都没勾 = **不写这个字段**，让 `endpointCapabilities()` 落到基线；
      // 勾了就按共享顺序表定序写入（同一枚端点两份 JSON 只有顺序不同的话，回读判据会假红）。
      ...(draftCaps.length === 0
        ? {}
        : { capabilities: CAPABILITY_ORDER.filter((capability) => draftCaps.includes(capability)) }),
    };
    // 🔴 `undefined` 的语义是"只有基线 `structured_output`"（= 保守），不是"支持一切"：
    // 能力按 ADR-0010 §3.4 必须由用户**显式声明**，所以这里不给任何"看起来合理"的默认表。
    // 少这一句，下一个人会在这里补一个默认能力集。
    if (draftKey.trim() !== '') aiSecrets.set(`${id}-key`, draftKey.trim());
    commit({
      ...routing,
      endpoints: [...routing.endpoints, endpoint],
      // 不自动把任何功能路由到新端点 —— "加了端点"不等于"六个功能都开始跑"。
    });
    setDraftUrl('');
    setDraftLabel('');
    setDraftModel('');
    setDraftKey('');
    setDraftCaps([]);
  }

  function addPreset(presetId: string): void {
    const preset = AI_ENDPOINT_PRESETS.find((item) => item.id === presetId);
    if (preset === undefined) return;
    const endpoint: AiEndpointConfig = preset.config;
    commit({
      ...routing,
      endpoints: [...routing.endpoints.filter((item) => item.id !== preset.id), endpoint],
    });
  }

  function removeEndpoint(id: string): void {
    const routes = { ...routing.routes };
    for (const feature of FEATURE_ORDER) {
      const kept = (routes[feature] ?? []).filter((target) => target.endpointId !== id);
      if (kept.length === 0) delete routes[feature];
      else routes[feature] = kept;
    }
    commit({ ...routing, endpoints: routing.endpoints.filter((item) => item.id !== id), routes });
  }

  function toggleRoute(feature: AiFeature, id: string): void {
    const routes = { ...routing.routes };
    const current = routes[feature] ?? [];
    const kept = current.some((target) => target.endpointId === id)
      ? current.filter((target) => target.endpointId !== id)
      : [{ endpointId: id }];
    if (kept.length === 0) delete routes[feature];
    else routes[feature] = kept;
    // 🔴 换端点 = 换目的地 = **旧授权作废**（`retainValidConsents` 在 `commit` 里做）。
    // 少了这一步，"上次同意发给本机 Ollama"会被读成"这次也同意发给云端"。
    commit({ ...routing, routes });
  }

  function grant(feature: AiFeature): void {
    // 目的地**推导**出来，不硬编码（同 web）：硬编码 'user-endpoint' 会让授权记录
    // 看起来永远合理，于是"同意的是 A、实际放行的是 B"没人能发现。
    const destination = destinationForFeature(feature, routing);
    if (!requiresEgressConsent(destination)) return;
    const kept = recomputeConsents(settings.consents, routing).filter(
      (consent) => consent.feature !== feature || consent.destination !== destination,
    );
    const wrote = saveAiSettings({
      ...settings,
      consents: [...kept, { feature, destination, grantedAt: Date.now() }],
    });
    setSavedWithoutKey(!wrote);
  }

  function revoke(feature: AiFeature): void {
    const destination = destinationForFeature(feature, routing);
    const wrote = saveAiSettings({
      ...settings,
      consents: settings.consents.filter(
        (consent) => consent.feature !== feature || consent.destination !== destination,
      ),
    });
    setSavedWithoutKey(!wrote);
  }

  // 这一台设备最近一趟自动收集的终态。没跑过就一行都不渲（不是"当前没有待处理事件"——
  // 那句是 worker 真的走了一趟之后 `empty` 的意思，两者对用户是不同的事）。
  const inboundCycle = useInboundCycle();

  return (
    <Stack gap="loose" testID="ai-settings-section">
      <SectionHeader icon="action.more" title={t('web.ai.settings.title')} />

      {savedWithoutKey ? (
        <Text variant="row-meta" tone="warning">
          {t('mobile.ai.saveFailed')}
        </Text>
      ) : null}

      {/* 自动收集这一趟做完了什么 —— 手机上此前没有任何一面说得出这句话，
          队列空与"根本没在跑"在界面上长得一样。 */}
      {inboundCycle === undefined ? null : (
        <Text variant="row-meta" testID="inbound-cycle-state">
          {t(INBOUND_CYCLE_COPY_KEY[inboundCycle.state])}
        </Text>
      )}

      {/* ── 闸 1：总开关 ─────────────────────────────────────────────── */}
      <Card gap="loose">
        <GateRow
          label={t('web.ai.settings.enabled.label')}
          note={t('web.ai.settings.enabled.note')}
          on={routing.enabled}
          testID="ai-gate-enabled"
          onToggle={() => {
            commit({ ...routing, enabled: !routing.enabled });
          }}
        />
        {/* ── 闸 2：允许远程 ───────────────────────────────────────── */}
        <GateRow
          label={t('web.ai.settings.allowRemote.label')}
          note={t('web.ai.settings.allowRemote.note')}
          on={routing.allowRemote}
          testID="ai-gate-remote"
          onToggle={() => {
            commit({ ...routing, allowRemote: !routing.allowRemote });
          }}
        />
        {routing.allowRemote ? (
          <Text variant="caption" tone="warning">
            {t('web.ai.settings.remote.lead')}
            <Text variant="caption" tone="warning">
              {t('web.ai.settings.remote.strong')}
            </Text>
            {t('web.ai.settings.remote.tail')}
          </Text>
        ) : null}
        {/* ── 闸 4：记忆层（ADR-0014：必填且默认关，fail-closed） ─── */}
        <GateRow
          label={t('web.ai.settings.memory.label')}
          note={t('web.ai.settings.memory.note')}
          on={settings.memoryEnabled}
          testID="ai-gate-memory"
          onToggle={() => {
            const wrote = saveAiSettings({ ...settings, memoryEnabled: !settings.memoryEnabled });
            setSavedWithoutKey(!wrote);
          }}
        />
      </Card>

      {/* ── 供给模式：我自己的端点 / heyta 托管 ─────────────────────────
          🔴 它**必须在端点列表之前**：这是"请求发给谁"的第一层选择。
          托管档的地址**不在这里配** —— 它来自「同步」里那台服务器
          （`withManagedEndpoint` 在构造路由配置那一刻合成），所以换服务器
          这一档跟着换，用户不需要、也不应该在这里再填一次地址。
          ⚠️ 与 web 的差别只在**控件形态**（这里是开关、那边是二选一单选），
          **判断与后果必须一致**（同一个 `routing.mode`、同一批词条）。 */}
      <Card gap="loose">
        <GateRow
          label={t('web.ai.settings.supply.managed')}
          note={t('web.ai.settings.supply.note')}
          on={routing.mode === 'managed'}
          testID="ai-gate-managed"
          onToggle={() => {
            commit({ ...routing, mode: routing.mode === 'managed' ? 'own' : 'managed' });
          }}
        />
        {routing.mode === 'managed' && !managedReady ? (
          <Text variant="caption" tone="warning">
            {t('web.ai.settings.supply.managedPending')}
          </Text>
        ) : null}
        {/*
          「本周期已用 X / 300」—— 三分支**分开说**（见上面 `usage` 的注释）：
          有权益报数 / 没权益说"没有这一期"（**不是 0/300**）/ 读不到说"读不到"。
          ⚠️ `Text` 刻意不带 `testID`（那个原语不接它，也不该为此改 kit）——
          判据改断言**用户读到的那句话本身**，那比一个 testID 更硬。
        */}
        {usageCopy !== undefined ? (
          <Text variant="row-meta" tone="subtle">
            {t(usageCopy.key, usageCopy.vars)}
          </Text>
        ) : null}
      </Card>

      {/* ── 端点 ─────────────────────────────────────────────────────── */}
      <Card gap="loose">
        <Text variant="row-title">{t('web.ai.settings.endpoints.title')}</Text>
        {routing.endpoints.length === 0 ? (
          <Text variant="row-meta" tone="subtle">
            {t('web.ai.settings.endpoints.empty')}
          </Text>
        ) : (
          routing.endpoints.map((endpoint) => {
            const now = Date.now();
            const health = fromHealthSnapshot(settings.health, now)[endpoint.id];
            // 还没有任何一次调用记录时没有可说的话。
            const healthLine =
              health === undefined
                ? undefined
                : healthCopy(endpointHealthDisclosure(health, now));
            const remote = classifyDestination({ mode: 'own', endpoint: endpoint.endpoint }) !== 'none';
            const usable = isAvailable(health, now);
            return (
              <View key={endpoint.id} testID={`ai-endpoint-${endpoint.id}`}>
                <Text variant="row-title" numberOfLines={1}>
                  {endpoint.label}
                </Text>
                <Text variant="caption" tone="subtle" numberOfLines={1} selectable>
                  {endpoint.endpoint}
                </Text>
                <Text variant="caption" tone={remote || !usable ? 'warning' : 'subtle'}>
                  {t(remote ? 'web.ai.settings.tag.remote' : 'web.ai.settings.tag.local')}
                  {healthLine === undefined ? '' : t(healthLine.key, healthLine.params)}
                </Text>
                <HStackish>
                  {FEATURE_ORDER.filter((feature) =>
                    (routing.routes[feature] ?? []).some((target) => target.endpointId === endpoint.id),
                  ).map((feature) => (
                    <Chip
                      key={feature}
                      label={t(AI_FEATURE_LABEL_KEY[feature])}
                      selected
                      onPress={() => {
                        toggleRoute(feature, endpoint.id);
                      }}
                    />
                  ))}
                </HStackish>
                <Button
                  label={t('web.ai.settings.deleteAria', { name: endpoint.label })}
                  tone="danger"
                  onPress={() => {
                    removeEndpoint(endpoint.id);
                  }}
                />
              </View>
            );
          })
        )}

        <HStackish>
          {AI_ENDPOINT_PRESETS.map((preset) => {
            const copy = PRESET_COPY_KEYS[preset.id as keyof typeof PRESET_COPY_KEYS];
            const label = copy === undefined ? preset.label : t(copy.label);
            return (
              <Chip
                key={preset.id}
                label={t('web.ai.settings.presetAdd', { name: label })}
                onPress={() => {
                  addPreset(preset.id);
                }}
              />
            );
          })}
        </HStackish>
        {AI_ENDPOINT_PRESETS.map((preset) => (
          <Text key={preset.id} variant="caption" tone="subtle">
            {(() => {
              const copy = PRESET_COPY_KEYS[preset.id as keyof typeof PRESET_COPY_KEYS];
              const label = copy === undefined ? preset.label : t(copy.label);
              const prerequisite =
                copy?.prerequisite === undefined
                  ? preset.prerequisite ?? ''
                  : t(copy.prerequisite);
              return `${label}：${prerequisite}`;
            })()}
          </Text>
        ))}

        <TextField
          label={t('web.ai.settings.field.name')}
          value={draftLabel}
          onChangeText={setDraftLabel}
          testID="ai-endpoint-label"
        />
        <TextField
          label={t('web.ai.settings.field.url')}
          value={draftUrl}
          onChangeText={setDraftUrl}
          keyboard="url"
          autoCapitalize="none"
          placeholder={t('web.ai.settings.preset.ollama.label')}
          hint={urlError === undefined ? undefined : t(urlError)}
          hintTone="danger"
          testID="ai-endpoint-url"
        />
        <TextField
          label={t('web.ai.settings.field.model')}
          value={draftModel}
          onChangeText={setDraftModel}
          autoCapitalize="none"
          testID="ai-endpoint-model"
        />
        <TextField
          label={t('web.ai.settings.keyAria', { name: draftEndpointName })}
          value={draftKey}
          onChangeText={setDraftKey}
          secure
          hint={t('mobile.ai.keyNotice')}
          testID="ai-endpoint-key"
        />
        {/*
          🔴 能力声明这一格：`ai-endpoint-cap-<capability>`（`CAP_TESTID`）由
          `check:mobile-ai-anchors` 判据 ⑨ 钉住 —— 锚点挂在 **Chip**（= Pressable）上，
          不挂在包装 `View` 上：iOS 只为带 trait 的宿主视图发 `AXUniqueId`，
          `<View testID>` 在那一端等于没写（traps #348）。
        */}
        <Stack gap="tight">
          <Text variant="caption" tone="subtle">
            {t('web.ai.settings.field.capability')}
          </Text>
          <HStackish>
            {CAPABILITY_ORDER.map((capability) => (
              <Chip
                key={capability}
                label={t(CAPABILITY_LABEL_KEY[capability])}
                selected={draftCaps.includes(capability)}
                testID={`ai-endpoint-cap-${capability}`}
                onPress={() => {
                  setDraftCaps((previous) =>
                    previous.includes(capability)
                      ? previous.filter((item) => item !== capability)
                      : [...previous, capability],
                  );
                }}
              />
            ))}
          </HStackish>
        </Stack>
        <Button
          label={t('web.ai.settings.addCustom')}
          tone="primary"
          testID="ai-endpoint-add"
          disabled={draftUrl.trim() === ''}
          onPress={addEndpoint}
        />
      </Card>

      {/* ── 逐功能：路由 + 出境授权 ─────────────────────────────────── */}
      <Card gap="loose">
        <Text variant="row-title">{t('web.ai.settings.features.title')}</Text>
        <Text variant="caption" tone="subtle">
          {t('web.ai.settings.features.hintLead')}
          <Text variant="caption" tone="warning">
            {t('web.ai.settings.features.hintStrong')}
          </Text>
          {t('web.ai.settings.features.hintTail')}
        </Text>
        {FEATURE_ORDER.map((feature) => {
          const destination = destinationForFeature(feature, routing);
          const needs = requiresEgressConsent(destination);
          const granted = settings.consents.some(
            (consent) => consent.feature === feature && consent.destination === destination,
          );
          return (
            <View key={feature} testID={`ai-feature-${feature}`}>
              <HStackish>
                {routing.endpoints.map((endpoint, index) => (
                  <Chip
                    key={endpoint.id}
                    /* 🔴 `ai-route-<功能>-<下标>`：iOS 载体按它逐枚点某一档的端点
                       （`verify-mobile-ios-ai.sh:739/990/1107`），下标 = 这一排从左到右
                       的可见次序（端点的随机 id 载体拿不到，所以不用它）。
                       ⚠️ 它随 `Chip` 透到 Pressable 那一层，见 `ui/kit.tsx` 的 `testID`
                       注释 —— 挂在非可点的包装层上会"在树里但按不动"。 */
                    testID={`ai-route-${feature}-${index}`}
                    label={endpoint.label}
                    selected={(routing.routes[feature] ?? []).some(
                      (target) => target.endpointId === endpoint.id,
                    )}
                    onPress={() => {
                      toggleRoute(feature, endpoint.id);
                    }}
                  />
                ))}
              </HStackish>
              <Text variant="caption" tone="subtle">
                {t(AI_FEATURE_LABEL_KEY[feature])}
              </Text>
              {needs ? (
                <Button
                  label={granted ? t('web.ai.settings.revoke') : t('web.ai.settings.grant')}
                  tone={granted ? 'danger' : 'secondary'}
                  testID={`ai-consent-${feature}`}
                  onPress={() => {
                    if (granted) revoke(feature);
                    else grant(feature);
                  }}
                />
              ) : null}
            </View>
          );
        })}
      </Card>

      {/* ── 助手档位（第二个授权前端，ADR-0045 §2.2） ───────────────── */}
      <Card gap="loose">
        <Text variant="row-title">{t('web.ai.assistant.egressTitle')}</Text>
        <HStackish>
          {ASSISTANT_TIER_ORDER.map((tier) => (
            <Chip
              key={tier}
              label={t(TIER_LABEL_KEY[tier])}
              selected={settings.assistantTier === tier}
              onPress={() => {
                const committed = tierStore.set(tier);
                const wrote = saveAiSettings({ ...settings, assistantTier: committed });
                setSavedWithoutKey(!wrote);
              }}
            />
          ))}
        </HStackish>
        <Text variant="caption" tone="subtle">
          {t(TIER_NOTE_KEY[settings.assistantTier])}
        </Text>
        <Text variant="caption" tone="subtle">
          {t('mobile.ai.tier.defaultNote', {
            tier: t(TIER_LABEL_KEY[DEFAULT_ASSISTANT_TIER]),
          })}
        </Text>
      </Card>

      {/* ── 逐工具授权（本机 API / 内置 AI 共用同一份表，ADR-0035） ── */}
      <Card gap="loose">
        <Text variant="row-title">{t('web.ai.settings.localApi.title')}</Text>
        <Text variant="caption" tone="subtle">
          {t('web.ai.settings.localApi.hintLead')}
          <Text variant="caption" tone="warning">
            {t('web.ai.settings.localApi.hintStrong')}
          </Text>
        </Text>
        <GateRow
          label={t('web.ai.settings.localApi.enabled.label')}
          note={t('web.ai.settings.localApi.enabled.note', { address: settings.localApi.bindAddress })}
          on={settings.localApi.enabled}
          testID="ai-gate-local-api"
          onToggle={() => {
            const wrote = saveAiSettings({
              ...settings,
              localApi: { ...settings.localApi, enabled: !settings.localApi.enabled },
            });
            setSavedWithoutKey(!wrote);
          }}
        />
        {/*
          🔴 逐工具**默认全关**（ADR-0011 §3.1）。这里出现"全部打开"的按钮就是违规 ——
          一次点击放开 26 个工具，等于把逐工具授权这件事作废。
        */}
        {LOCAL_API_TOOLS.map((tool) => {
          const on = settings.localApi.grants?.[tool.name] === true;
          return (
            <View
              key={tool.name}
              style={{ flexDirection: 'row', alignItems: 'center', gap: tokens['space.2'] }}
            >
              <Checkbox
                checked={on}
                label={tool.name}
                testID={`ai-tool-grant-${tool.name}`}
                onToggle={() => {
                  const wrote = saveAiSettings({
                    ...settings,
                    localApi: {
                      ...settings.localApi,
                      grants: { ...settings.localApi.grants, [tool.name]: !on },
                    },
                  });
                  setSavedWithoutKey(!wrote);
                }}
              />
              <Text variant="row-meta" grow numberOfLines={2}>
                {tool.name}
                {'  '}
                {t(tool.kind === 'read' ? 'web.ai.settings.localApi.kind.read' : 'web.ai.settings.localApi.kind.write')}
              </Text>
            </View>
          );
        })}
      </Card>
    </Stack>
  );
}

/** 一行闸门：文字 + 说明 + 勾选框。**危险状态用文字说，不只用颜色。** */
function GateRow({
  label,
  note,
  on,
  onToggle,
  testID,
}: {
  label: string;
  note: string;
  on: boolean;
  onToggle: () => void;
  testID: string;
}): React.JSX.Element {
  const tokens = useTokens();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: tokens['space.2'] }} testID={testID}>
      <Checkbox checked={on} label={label} onToggle={onToggle} />
      <Stack gap="tight" style={{ flex: 1 }}>
        <Text variant="row-title">{label}</Text>
        <Text variant="caption" tone="subtle">
          {note}
        </Text>
      </Stack>
    </View>
  );
}

function HStackish({ children }: { children: React.ReactNode }): React.JSX.Element {
  const tokens = useTokens();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: tokens['space.2'] }}>{children}</View>
  );
}

/**
 * 能力的中文名走词条（界面零硬编码）。顺序与内容都来自 `@heyta/ai` 的
 * `CAPABILITY_ORDER` —— 这里只做"枚举 → 词条键"的映射，`Record<AiCapability, …>`
 * 让"新增一档能力而没登记词条"变成**编译错**，而不是界面上一个裸键名。
 */
const CAPABILITY_LABEL_KEY: Record<AiCapability, MessageKey> = {
  structured_output: 'web.ai.capability.structuredOutput',
  long_context: 'web.ai.capability.longContext',
  vision: 'web.ai.capability.vision',
  tool_calling: 'web.ai.capability.toolCalling',
};

/** `validateEndpointUrl` 的拒绝码 → 词条（穷尽：新增一档而这里没登记就编译红）。 */
const VERDICT_KEY = {
  'bad-scheme': 'web.ai.settings.endpointError.badScheme',
  'credentials-in-url': 'web.ai.settings.endpointError.credentialsInUrl',
  'plaintext-remote': 'web.ai.settings.endpointError.plaintextRemote',
  unparseable: 'web.ai.settings.endpointError.unparseable',
} as const satisfies Record<string, MessageKey>;

/** 预设的跨包展示文案必须经过 i18n，避免移动端英文界面露出中文源数据。 */
const PRESET_COPY_KEYS = {
  ollama: {
    label: 'web.ai.settings.preset.ollama.label',
    prerequisite: 'web.ai.settings.preset.ollama.prerequisite',
  },
  'lm-studio': {
    label: 'web.ai.settings.preset.lmStudio.label',
    prerequisite: 'web.ai.settings.preset.lmStudio.prerequisite',
  },
} as const satisfies Record<string, { readonly label: MessageKey; readonly prerequisite: MessageKey }>;

// 🔴 档位这两张表用 **app-host 的常量**当键，不写字面量（AGENTS §3.5 / check:layering）。
// 档位决定"模型这一次能不能改用户的数据"，它的词表是产品语义；壳只负责"存在哪"。
// web 那边（`AiSettings.tsx`）已经是这个写法了，这里照同一形状，不另立一套。
const TIER_LABEL_KEY = {
  [ASSISTANT_TIER_READ_ONLY]: 'web.ai.assistant.tier.readOnly.label',
  [ASSISTANT_TIER_EXECUTE]: 'web.ai.assistant.tier.readAndPropose.label',
} as const satisfies Record<AssistantTier, MessageKey>;

const TIER_NOTE_KEY = {
  [ASSISTANT_TIER_READ_ONLY]: 'web.ai.assistant.tier.readOnly.note',
  [ASSISTANT_TIER_EXECUTE]: 'web.ai.assistant.tier.readAndPropose.note',
} as const satisfies Record<AssistantTier, MessageKey>;
