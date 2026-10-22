/**
 * 移动端 AI 工具箱 —— capture / breakdown / prioritize / duration-estimate 四枚入口。
 *
 * 每一枚走**同一条链路**：填表 → 现算披露 → 用户点确认 → `requestX` 走 `invokeRouted`
 * → 候选原样显示 → 用户再点一次「写入」→ `taskActions` 经 op-log 落库
 * （AGENTS §3.4 唯一写入口；ADR-0045 §2 授权分层）。
 *
 * 🔴 **为什么四枚挤在一屏而不是四套独立页面**：
 * 移动端产品裁决不是"能力少一份"，是"入口 IA 不许复制四套隐形页面"。
 * Assistant 走对话式（tool-calling）；工具箱走**结构化四件事**，
 * 用户知道按了会出什么。两把尺子分别钉得住。
 *
 * ⚠️ 候选写库这一步刻意由用户**看到候选之后**再点一次，不合并成"点发送=直接写"。
 * 理由与 web 那四份 `AiCapture/Breakdown/Prioritize/Duration` 逐字同源。
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import {
  buildBreakdownInvocation,
  buildCaptureInvocation,
  buildDurationInvocation,
  buildPrioritizeInvocation,
  createManagedTransport,
  createTaskActions,
  requestBreakdown,
  requestCapture,
  requestDuration,
  requestPrioritize,
  resolveAiRoute,
  type AppHost,
  type BreakdownOutcome,
  type CaptureOutcome,
  type DurationOutcome,
  type PrioritizeOutcome,
} from '@heyta/app-host';

type AiOutputLocale = 'zh-CN' | 'en';
import {
  buildDisclosure,
  fromHealthSnapshot,
  toHealthSnapshot,
  withManagedEndpoint,
} from '@heyta/ai';
import type { AiRouteTarget } from '@heyta/app-host';
import type { Task } from '@heyta/domain';
import { useI18n, type MessageKey } from '@heyta/i18n';

import { Button, Card, HStack, Screen, Stack, Text, TextField } from '../ui/kit';
import { useTokens } from '../theme';
import { openTaskHost } from '../db/open-host';
import { readSyncConfig } from '../sync/config';
import { AiDisclosureBlock } from './disclosure';
import { getAiSettings, saveAiSettings, useAiSettings, aiSecrets } from './settings-store';

type TabKey = 'capture' | 'breakdown' | 'prioritize' | 'duration';

const resolveRouting = () =>
  withManagedEndpoint(getAiSettings().routing, readSyncConfig()?.serverUrl);

const managedTransport = createManagedTransport({
  getServerUrl: () => readSyncConfig()?.serverUrl,
  getToken: async () => readSyncConfig()?.token,
});

export function AiToolboxScreen({
  onBack,
  onOpenSettings,
  visible = true,
}: {
  onBack: () => void;
  visible?: boolean;
  onOpenSettings?: () => void;
}): React.JSX.Element {
  const { t, locale } = useI18n();
  const tokens = useTokens();
  const [tab, setTab] = useState<TabKey>('capture');
  const [host, setHost] = useState<AppHost | null>(null);
  const [hostError, setHostError] = useState<string | undefined>();

  useEffect(() => {
    let alive = true;
    openTaskHost()
      .then((next) => { if (alive) setHost(next); })
      .catch((error: unknown) => { if (alive) setHostError(error instanceof Error ? error.message : String(error)); });
    return () => { alive = false; };
  }, []);

  const tabs: Array<{ key: TabKey; labelKey: MessageKey }> = [
    { key: 'capture', labelKey: 'mobile.ai.toolbox.tab.capture' },
    { key: 'breakdown', labelKey: 'mobile.ai.toolbox.tab.breakdown' },
    { key: 'prioritize', labelKey: 'mobile.ai.toolbox.tab.prioritize' },
    { key: 'duration', labelKey: 'mobile.ai.toolbox.tab.duration' },
  ];
  const outputLocale: AiOutputLocale = locale.startsWith('en') ? 'en' : 'zh-CN';

  return (
    <Screen
      title={t('mobile.ai.toolbox.title')}
      actions={[{ icon: 'action.back', label: t('mobile.ai.back'), onPress: onBack }]}
    >
      <Stack gap="default">
        {hostError !== undefined ? (
          <Card><Text variant="row-title" tone="danger">{hostError}</Text></Card>
        ) : null}
        <HStack gap="tight">
          {tabs.map((entry) => (
            <Button
              key={entry.key}
              label={t(entry.labelKey)}
              tone={tab === entry.key ? 'primary' : 'ghost'}
              onPress={() => setTab(entry.key)}
            />
          ))}
        </HStack>
        {host === null ? null : tab === 'capture' ? (
          <CapturePanel host={host} locale={outputLocale} onOpenSettings={onOpenSettings} />
        ) : tab === 'breakdown' ? (
          <BreakdownPanel host={host} locale={outputLocale} onOpenSettings={onOpenSettings} />
        ) : tab === 'prioritize' ? (
          <PrioritizePanel host={host} locale={outputLocale} onOpenSettings={onOpenSettings} />
        ) : (
          <DurationPanel host={host} locale={outputLocale} onOpenSettings={onOpenSettings} />
        )}
        <View style={{ height: tokens['space.6'] }} />
      </Stack>
    </Screen>
  );
}

// ── 每个 panel 的**共享切片**：一次 route + 一次 disclosure ────────────────
//
// 🔴 与 AssistantScreen 同一把尺：每次 render 现算 routing，落盘那份缺托管端点。
// `resolveAiRoute` 返回 `{target?, noCandidate?}` 二者恰好一个非空 —— 我们只在有 target 时披露。
interface PanelView {
  readonly target: AiRouteTarget | undefined;
  readonly fields: readonly string[];
  readonly retentionDisclosure: Parameters<typeof AiDisclosureBlock>[0]['retentionDisclosure'];
}

function usePanel(feature: Parameters<typeof resolveAiRoute>[1], invocation: { fields: readonly string[] } | undefined): PanelView {
  const settings = useAiSettings();
  const routing = resolveRouting();
  const health = fromHealthSnapshot(settings.health, Date.now());
  const route = resolveAiRoute(routing, feature, { health });
  const target = route.target;
  const disclosure = target !== undefined && invocation !== undefined
    ? buildDisclosure({ feature, destination: target.destination, fields: invocation.fields })
    : undefined;
  return {
    target,
    fields: disclosure?.fields ?? [],
    retentionDisclosure: disclosure?.retentionDisclosure,
  };
}

function routedDeps() {
  return {
    secretStore: aiSecrets,
    managedTransport,
    healthSeed: fromHealthSnapshot(getAiSettings().health, Date.now()),
  };
}

function persistHealth(health: Parameters<typeof toHealthSnapshot>[0]) {
  saveAiSettings({ ...getAiSettings(), health: toHealthSnapshot(health, Date.now()) });
}

// ── Capture ────────────────────────────────────────────────────────────────
function CapturePanel({ host, locale, onOpenSettings }: { host: AppHost; locale: AiOutputLocale; onOpenSettings?: () => void }): React.JSX.Element {
  const { t } = useI18n();
  const settings = useAiSettings();
  const routing = resolveRouting();
  const [text, setText] = useState('');
  const [phase, setPhase] = useState<'idle' | 'loading' | 'proposal' | 'failed'>('idle');
  const [outcome, setOutcome] = useState<CaptureOutcome | null>(null);
  const actions = useMemo(() => createTaskActions(host), [host]);

  const source = { text, locale, now: Date.now() };
  const invocation = text.trim() === '' ? undefined : buildCaptureInvocation(source, []);
  const view = usePanel('capture', invocation);

  const ask = async (): Promise<void> => {
    setPhase('loading');
    const result = await requestCapture(source, { routing, consents: settings.consents, routed: routedDeps() });
    setOutcome(result);
    persistHealth(result.health);
    setPhase(result.ok ? 'proposal' : 'failed');
  };

  const apply = async (): Promise<void> => {
    if (outcome === null || !outcome.ok) return;
    const { proposal } = outcome;
    const dueDateMs = proposal.dueDate === undefined ? undefined : Date.parse(proposal.dueDate);
    await actions.create(proposal.title, {
      ...(proposal.priority === undefined ? {} : { priority: proposal.priority }),
      ...(dueDateMs === undefined || Number.isNaN(dueDateMs) ? {} : { dueDate: dueDateMs, dueDateLocal: proposal.dueDate }),
    });
    setPhase('idle'); setText(''); setOutcome(null);
  };

  return (
    <Card>
      <Stack gap="default">
        <Text variant="section-title">{t('mobile.ai.toolbox.capture.title')}</Text>
        <Text variant="caption" tone="subtle">{t('mobile.ai.toolbox.capture.hint')}</Text>
        <TextField label={t('mobile.ai.toolbox.capture.field')} value={text} onChangeText={setText} placeholder={t('mobile.ai.toolbox.capture.placeholder')} multiline />
        {view.target !== undefined ? (
          <AiDisclosureBlock testIdPrefix="mobile-ai-capture" target={view.target} fields={view.fields} retentionDisclosure={view.retentionDisclosure} />
        ) : null}
        {phase === 'idle' || phase === 'failed' ? (
          <Button label={t('mobile.ai.toolbox.send')} tone="primary" disabled={text.trim() === '' || view.target === undefined} onPress={() => { void ask(); }} />
        ) : null}
        {phase === 'loading' ? <Text variant="caption" tone="subtle">{t('mobile.ai.toolbox.loading')}</Text> : null}
        {phase === 'failed' && outcome !== null && !outcome.ok ? <Text variant="row-title" tone="danger">{outcome.message}</Text> : null}
        {phase === 'proposal' && outcome !== null && outcome.ok ? (
          <Stack gap="tight">
            <Text variant="caption" tone="subtle">{t('mobile.ai.toolbox.proposalHint')}</Text>
            <Text variant="row-title">{outcome.proposal.title}</Text>
            {outcome.proposal.dueDate !== undefined ? <Text variant="row-meta">{t('mobile.ai.toolbox.due')}: {outcome.proposal.dueDate}</Text> : null}
            {outcome.proposal.priority !== undefined ? <Text variant="row-meta">{t('mobile.ai.toolbox.priority')}: {outcome.proposal.priority}</Text> : null}
            <HStack gap="tight">
              <Button label={t('mobile.ai.toolbox.apply')} tone="primary" onPress={() => { void apply(); }} />
              <Button label={t('mobile.ai.toolbox.cancel')} tone="ghost" onPress={() => { setPhase('idle'); setOutcome(null); }} />
            </HStack>
          </Stack>
        ) : null}
        {onOpenSettings !== undefined ? <Button label={t('mobile.ai.toolbox.openSettings')} tone="ghost" onPress={onOpenSettings} /> : null}
      </Stack>
    </Card>
  );
}

// ── Breakdown ─────────────────────────────────────────────────────────────
function BreakdownPanel({ host, locale, onOpenSettings }: { host: AppHost; locale: AiOutputLocale; onOpenSettings?: () => void }): React.JSX.Element {
  const { t } = useI18n();
  const settings = useAiSettings();
  const routing = resolveRouting();
  const [title, setTitle] = useState('');
  const [phase, setPhase] = useState<'idle' | 'loading' | 'proposal' | 'failed'>('idle');
  const [outcome, setOutcome] = useState<BreakdownOutcome | null>(null);
  const actions = useMemo(() => createTaskActions(host), [host]);
  const source = { title, locale, now: Date.now() };
  const invocation = title.trim() === '' ? undefined : buildBreakdownInvocation(source, []);
  const view = usePanel('breakdown', invocation);

  const ask = async (): Promise<void> => {
    setPhase('loading');
    const result = await requestBreakdown(source, { routing, consents: settings.consents, routed: routedDeps() });
    setOutcome(result); persistHealth(result.health);
    setPhase(result.ok ? 'proposal' : 'failed');
  };

  const apply = async (): Promise<void> => {
    if (outcome === null || !outcome.ok) return;
    for (const item of outcome.proposal.items) await actions.create(item);
    setPhase('idle'); setTitle(''); setOutcome(null);
  };

  return (
    <Card>
      <Stack gap="default">
        <Text variant="section-title">{t('mobile.ai.toolbox.breakdown.title')}</Text>
        <Text variant="caption" tone="subtle">{t('mobile.ai.toolbox.breakdown.hint')}</Text>
        <TextField label={t('mobile.ai.toolbox.breakdown.field')} value={title} onChangeText={setTitle} placeholder={t('mobile.ai.toolbox.breakdown.placeholder')} />
        {view.target !== undefined ? <AiDisclosureBlock testIdPrefix="mobile-ai-breakdown" target={view.target} fields={view.fields} retentionDisclosure={view.retentionDisclosure} /> : null}
        {phase === 'idle' || phase === 'failed' ? <Button label={t('mobile.ai.toolbox.send')} tone="primary" disabled={title.trim() === '' || view.target === undefined} onPress={() => { void ask(); }} /> : null}
        {phase === 'loading' ? <Text variant="caption" tone="subtle">{t('mobile.ai.toolbox.loading')}</Text> : null}
        {phase === 'failed' && outcome !== null && !outcome.ok ? <Text variant="row-title" tone="danger">{outcome.message}</Text> : null}
        {phase === 'proposal' && outcome !== null && outcome.ok ? (
          <Stack gap="tight">
            <Text variant="caption" tone="subtle">{t('mobile.ai.toolbox.proposalHint')}</Text>
            {outcome.proposal.items.map((item, idx) => <Text key={`subtask-${String(idx)}`} variant="row-title">· {item}</Text>)}
            {outcome.proposal.truncated ? <Text variant="caption" tone="warning">{t('mobile.ai.toolbox.truncated')}</Text> : null}
            <HStack gap="tight">
              <Button label={t('mobile.ai.toolbox.apply')} tone="primary" onPress={() => { void apply(); }} />
              <Button label={t('mobile.ai.toolbox.cancel')} tone="ghost" onPress={() => { setPhase('idle'); setOutcome(null); }} />
            </HStack>
          </Stack>
        ) : null}
        {onOpenSettings !== undefined ? <Button label={t('mobile.ai.toolbox.openSettings')} tone="ghost" onPress={onOpenSettings} /> : null}
      </Stack>
    </Card>
  );
}

// ── Prioritize ────────────────────────────────────────────────────────────
function PrioritizePanel({ host, locale, onOpenSettings }: { host: AppHost; locale: AiOutputLocale; onOpenSettings?: () => void }): React.JSX.Element {
  const { t } = useI18n();
  const settings = useAiSettings();
  const routing = resolveRouting();
  const [phase, setPhase] = useState<'idle' | 'loading' | 'proposal' | 'failed'>('idle');
  const [outcome, setOutcome] = useState<PrioritizeOutcome | null>(null);
  const actions = useMemo(() => createTaskActions(host), [host]);
  const pending = useMemo<Task[]>(() => {
    const state = host.getState();
    return Object.values(state.tasks).filter((task) => task.deletedAt === undefined && task.completedAt === undefined);
  }, [host]);
  const source = { tasks: pending.map((task) => ({ id: task.id, title: task.title, ...(task.priority === undefined ? {} : { priority: task.priority }) })), locale, now: Date.now() };
  const invocation = pending.length === 0 ? undefined : buildPrioritizeInvocation(source, []);
  const view = usePanel('prioritize', invocation);

  const ask = async (): Promise<void> => {
    setPhase('loading');
    const result = await requestPrioritize(source, { routing, consents: settings.consents, routed: routedDeps() });
    setOutcome(result); persistHealth(result.health);
    setPhase(result.ok ? 'proposal' : 'failed');
  };

  const apply = async (): Promise<void> => {
    if (outcome === null || !outcome.ok) return;
    for (const s of outcome.proposal.suggestions) await actions.setPriority(s.id, s.priority);
    setPhase('idle'); setOutcome(null);
  };

  return (
    <Card>
      <Stack gap="default">
        <Text variant="section-title">{t('mobile.ai.toolbox.prioritize.title')}</Text>
        <Text variant="caption" tone="subtle">{t('mobile.ai.toolbox.prioritize.hint')}</Text>
        <Text variant="row-meta" tone="subtle">{t('mobile.ai.toolbox.prioritize.count', { count: pending.length })}</Text>
        {view.target !== undefined ? <AiDisclosureBlock testIdPrefix="mobile-ai-prioritize" target={view.target} fields={view.fields} retentionDisclosure={view.retentionDisclosure} /> : null}
        {phase === 'idle' || phase === 'failed' ? <Button label={t('mobile.ai.toolbox.send')} tone="primary" disabled={pending.length === 0 || view.target === undefined} onPress={() => { void ask(); }} /> : null}
        {phase === 'loading' ? <Text variant="caption" tone="subtle">{t('mobile.ai.toolbox.loading')}</Text> : null}
        {phase === 'failed' && outcome !== null && !outcome.ok ? <Text variant="row-title" tone="danger">{outcome.message}</Text> : null}
        {phase === 'proposal' && outcome !== null && outcome.ok ? (
          <Stack gap="tight">
            <Text variant="caption" tone="subtle">{t('mobile.ai.toolbox.proposalHint')}</Text>
            {outcome.proposal.suggestions.map((s, idx) => {
              const title = pending.find((task) => task.id === s.id)?.title ?? s.id;
              return <Text key={`prio-${String(idx)}`} variant="row-title">{String(idx + 1)}. {title} → {s.priority}</Text>;
            })}
            <HStack gap="tight">
              <Button label={t('mobile.ai.toolbox.apply')} tone="primary" onPress={() => { void apply(); }} />
              <Button label={t('mobile.ai.toolbox.cancel')} tone="ghost" onPress={() => { setPhase('idle'); setOutcome(null); }} />
            </HStack>
          </Stack>
        ) : null}
        {onOpenSettings !== undefined ? <Button label={t('mobile.ai.toolbox.openSettings')} tone="ghost" onPress={onOpenSettings} /> : null}
      </Stack>
    </Card>
  );
}

// ── Duration ──────────────────────────────────────────────────────────────
function DurationPanel({ host, locale, onOpenSettings }: { host: AppHost; locale: AiOutputLocale; onOpenSettings?: () => void }): React.JSX.Element {
  const { t } = useI18n();
  const settings = useAiSettings();
  const routing = resolveRouting();
  const [title, setTitle] = useState('');
  const [phase, setPhase] = useState<'idle' | 'loading' | 'proposal' | 'failed'>('idle');
  const [outcome, setOutcome] = useState<DurationOutcome | null>(null);
  const actions = useMemo(() => createTaskActions(host), [host]);
  const source = { title, locale, now: Date.now() };
  const invocation = title.trim() === '' ? undefined : buildDurationInvocation(source, []);
  const view = usePanel('duration-estimate', invocation);

  const ask = async (): Promise<void> => {
    setPhase('loading');
    const result = await requestDuration(source, { routing, consents: settings.consents, routed: routedDeps() });
    setOutcome(result); persistHealth(result.health);
    setPhase(result.ok ? 'proposal' : 'failed');
  };

  const apply = async (): Promise<void> => {
    if (outcome === null || !outcome.ok) return;
    const minutes = outcome.proposal.minutes;
    const id = await actions.create(outcome.proposal.title);
    await actions.setNote(id, `耗时估计：${String(minutes)} 分钟`);
    setPhase('idle'); setTitle(''); setOutcome(null);
  };

  return (
    <Card>
      <Stack gap="default">
        <Text variant="section-title">{t('mobile.ai.toolbox.duration.title')}</Text>
        <Text variant="caption" tone="subtle">{t('mobile.ai.toolbox.duration.hint')}</Text>
        <TextField label={t('mobile.ai.toolbox.duration.field')} value={title} onChangeText={setTitle} placeholder={t('mobile.ai.toolbox.duration.placeholder')} />
        {view.target !== undefined ? <AiDisclosureBlock testIdPrefix="mobile-ai-duration" target={view.target} fields={view.fields} retentionDisclosure={view.retentionDisclosure} /> : null}
        {phase === 'idle' || phase === 'failed' ? <Button label={t('mobile.ai.toolbox.send')} tone="primary" disabled={title.trim() === '' || view.target === undefined} onPress={() => { void ask(); }} /> : null}
        {phase === 'loading' ? <Text variant="caption" tone="subtle">{t('mobile.ai.toolbox.loading')}</Text> : null}
        {phase === 'failed' && outcome !== null && !outcome.ok ? <Text variant="row-title" tone="danger">{outcome.message}</Text> : null}
        {phase === 'proposal' && outcome !== null && outcome.ok ? (
          <Stack gap="tight">
            <Text variant="caption" tone="subtle">{t('mobile.ai.toolbox.proposalHint')}</Text>
            <Text variant="row-title">{outcome.proposal.title}: {String(outcome.proposal.minutes)} 分钟</Text>
            {outcome.proposal.clamped ? <Text variant="caption" tone="warning">{t('mobile.ai.toolbox.clamped')}</Text> : null}
            <HStack gap="tight">
              <Button label={t('mobile.ai.toolbox.apply')} tone="primary" onPress={() => { void apply(); }} />
              <Button label={t('mobile.ai.toolbox.cancel')} tone="ghost" onPress={() => { setPhase('idle'); setOutcome(null); }} />
            </HStack>
          </Stack>
        ) : null}
        {onOpenSettings !== undefined ? <Button label={t('mobile.ai.toolbox.openSettings')} tone="ghost" onPress={onOpenSettings} /> : null}
      </Stack>
    </Card>
  );
}
