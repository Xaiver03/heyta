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

import React, { useState } from 'react';
import { View } from 'react-native';

import {
  AI_ENDPOINT_PRESETS,
  classifyDestination,
  endpointHealthDisclosure,
  fromHealthSnapshot,
  isAvailable,
  requiresEgressConsent,
  validateEndpointUrl,
  type AiEndpointConfig,
  type AiFeature,
} from '@heyta/ai';
import {
  ASSISTANT_TIER_ORDER,
  ASSISTANT_TIER_READ_AND_PROPOSE,
  ASSISTANT_TIER_READ_ONLY,
  DEFAULT_ASSISTANT_TIER,
  createAssistantTierStore,
  destinationForFeature,
  recomputeConsents,
  type AssistantTier,
} from '@heyta/app-host';
import { LOCAL_API_TOOLS } from '@heyta/local-api';
import { useI18n, type MessageKey } from '@heyta/i18n';

import { Button, Card, Checkbox, Chip, SectionHeader, Stack, Text, TextField } from '../ui/kit';
import { useTokens } from '../theme';
import { AI_FEATURE_LABEL_KEY, healthCopy } from './copy';
import { aiSecrets, saveAiSettings, useAiSettings } from './settings-store';
import { readDevicePref, writeDevicePref } from '../prefs/device-prefs';

/** 五个功能在设置里的渲染顺序 —— 与助手面的顺序同一份，不重排。 */
const FEATURE_ORDER = [
  'capture',
  'breakdown',
  'prioritize',
  'duration-estimate',
  'tool-calling',
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
  const [urlError, setUrlError] = useState<MessageKey | undefined>(undefined);
  const [savedWithoutKey, setSavedWithoutKey] = useState(false);

  const routing = settings.routing;

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
      label: draftLabel.trim() === '' ? t('web.ai.settings.customLabel') : draftLabel.trim(),
      endpoint: draftUrl.trim(),
      model: draftModel.trim(),
    };
    // 🔴 新端点**不带任何能力声明**：ADR-0010 §3.4 要求能力显式声明、不做推断，
    // 而 `undefined` 的语义是"只有基线 `structured_output`"（= 保守），不是"支持一切"。
    // 少这一句，下一个人会在这里补一个"看起来合理"的默认能力表。
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

  return (
    <Stack gap="loose" testID="ai-settings-section">
      <SectionHeader icon="action.more" title={t('web.ai.settings.title')} />

      {savedWithoutKey ? (
        <Text variant="row-meta" tone="warning">
          {t('mobile.ai.saveFailed')}
        </Text>
      ) : null}

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
                  label={t('web.ai.settings.deleteAria')}
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
          {AI_ENDPOINT_PRESETS.map((preset) => (
            <Chip
              key={preset.id}
              label={t('web.ai.settings.presetAdd')}
              onPress={() => {
                addPreset(preset.id);
              }}
            />
          ))}
        </HStackish>
        {AI_ENDPOINT_PRESETS.map((preset) => (
          <Text key={preset.id} variant="caption" tone="subtle">
            {preset.label}：{preset.prerequisite === undefined ? '' : String(preset.prerequisite)}
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
          label={t('web.ai.settings.keyAria')}
          value={draftKey}
          onChangeText={setDraftKey}
          secure
          hint={t('mobile.ai.keyNotice')}
          testID="ai-endpoint-key"
        />
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
                {routing.endpoints.map((endpoint) => (
                  <Chip
                    key={endpoint.id}
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
          note={t('web.ai.settings.localApi.enabled.note')}
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

/** `validateEndpointUrl` 的拒绝码 → 词条（穷尽：新增一档而这里没登记就编译红）。 */
const VERDICT_KEY = {
  'bad-scheme': 'web.ai.settings.endpointError.badScheme',
  'credentials-in-url': 'web.ai.settings.endpointError.credentialsInUrl',
  'plaintext-remote': 'web.ai.settings.endpointError.plaintextRemote',
  unparseable: 'web.ai.settings.endpointError.unparseable',
} as const satisfies Record<string, MessageKey>;

// 🔴 档位这两张表用 **app-host 的常量**当键，不写字面量（AGENTS §3.5 / check:layering）。
// 档位决定"模型这一次能不能改用户的数据"，它的词表是产品语义；壳只负责"存在哪"。
// web 那边（`AiSettings.tsx`）已经是这个写法了，这里照同一形状，不另立一套。
const TIER_LABEL_KEY = {
  [ASSISTANT_TIER_READ_ONLY]: 'web.ai.assistant.tier.readOnly.label',
  [ASSISTANT_TIER_READ_AND_PROPOSE]: 'web.ai.assistant.tier.readAndPropose.label',
} as const satisfies Record<AssistantTier, MessageKey>;

const TIER_NOTE_KEY = {
  [ASSISTANT_TIER_READ_ONLY]: 'web.ai.assistant.tier.readOnly.note',
  [ASSISTANT_TIER_READ_AND_PROPOSE]: 'web.ai.assistant.tier.readAndPropose.note',
} as const satisfies Record<AssistantTier, MessageKey>;
