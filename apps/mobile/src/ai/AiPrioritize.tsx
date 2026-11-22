/**
 * 移动端「AI 排优先级」面板。
 *
 * 把一组任务交给 `requestPrioritize()` 排优先级，确认后把新优先级写回。
 * 与另外两个面板同一套最小闭环；业务规则全在 `packages/app-host`。
 */

import React, { useMemo, useState } from 'react';

import { buildDisclosure, fromHealthSnapshot } from '@heyta/ai';
import type { AiHealthSnapshot, AiRoutingConfig, EgressConsent, HealthMap, SecretStore } from '@heyta/ai';
import {
  buildPrioritizeInvocation,
  MAX_PRIORITIZE_TASKS,
  requestPrioritize,
  resolveAiRoute,
  type PrioritizeDecision,
  type PrioritizeProposal,
  type PrioritizeTaskInput,
} from '@heyta/app-host';
import { Priority, type Task } from '@heyta/domain';
import { useI18n } from '@heyta/i18n';
import type { MessageKey } from '@heyta/i18n';

import { Button, Card, HStack, Stack, Text } from '../ui/kit';
import { AiDisclosureBlock } from './disclosure';
import { AI_CAUSE_KEY, AI_NO_TARGET_KEY, PRIORITIZE_FAILURE_KEY } from './copy';
import { toolboxManagedTransport } from './toolbox-shared';

type Phase = 'idle' | 'disclosing' | 'loading' | 'proposal' | 'failed';

const PRIORITY_COPY_KEY: Record<number, MessageKey> = {
  [Priority.High]: 'web.ai.prioritize.priority.high',
  [Priority.Medium]: 'web.ai.prioritize.priority.medium',
  [Priority.Low]: 'web.ai.prioritize.priority.low',
  [Priority.None]: 'web.ai.prioritize.priority.none',
};

export interface AiPrioritizeProps {
  /** 参与排序的任务集合（面板会按 `MAX_PRIORITIZE_TASKS` 截断，与请求同一规则）。 */
  tasks: readonly Task[];
  routing: AiRoutingConfig;
  consents: readonly EgressConsent[];
  secrets: SecretStore;
  fetchImpl?: typeof fetch;
  healthSnapshot?: AiHealthSnapshot;
  onApplyPriorities: (decisions: readonly PrioritizeDecision[]) => void;
  onHealth?: (health: HealthMap) => void;
}

export function AiPrioritize({
  tasks,
  routing,
  consents,
  secrets,
  fetchImpl,
  healthSnapshot,
  onApplyPriorities,
  onHealth,
}: AiPrioritizeProps): React.JSX.Element {
  const { t, locale } = useI18n();
  const [phase, setPhase] = useState<Phase>('idle');
  const [proposal, setProposal] = useState<PrioritizeProposal | undefined>(undefined);
  const [failure, setFailure] = useState<string>('');
  const [applied, setApplied] = useState(false);
  const [retryTick, setRetryTick] = useState(0);

  const health = fromHealthSnapshot(healthSnapshot ?? {}, Date.now());
  const { target } = resolveAiRoute(routing, 'prioritize', { health });

  const inputs = useMemo<PrioritizeTaskInput[]>(
    () =>
      tasks.slice(0, MAX_PRIORITIZE_TASKS).map((task) => ({
        id: task.id,
        title: task.title,
        ...(task.dueDate === undefined ? {} : { dueDate: task.dueDate }),
        ...(task.priority === undefined ? {} : { priority: task.priority }),
      })),
    [tasks],
  );
  const titleById = useMemo(() => new Map(inputs.map((task) => [task.id, task.title])), [inputs]);

  const source = useMemo(
    () => ({ tasks: inputs, locale, now: Date.now() }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inputs, locale, retryTick],
  );
  const invocation = buildPrioritizeInvocation(source, []);
  const disclosure =
    target === undefined
      ? undefined
      : buildDisclosure({ feature: 'prioritize', destination: target.destination, fields: invocation.fields });

  const reset = (): void => {
    setPhase('idle');
    setProposal(undefined);
    setFailure('');
  };

  async function send(): Promise<void> {
    setPhase('loading');
    const outcome = await requestPrioritize(source, {
      routing,
      consents,
      preferences: [],
      routed: {
        secretStore: secrets,
        managedTransport: toolboxManagedTransport,
        healthSeed: fromHealthSnapshot(healthSnapshot ?? {}, Date.now()),
        ...(fetchImpl === undefined ? {} : { fetchImpl }),
      },
    });
    onHealth?.(outcome.health);
    if (outcome.ok) {
      setProposal(outcome.proposal);
      setPhase('proposal');
      return;
    }
    const base = t(PRIORITIZE_FAILURE_KEY[outcome.reason]);
    setFailure(outcome.cause === undefined ? base : `${base} ${t(AI_CAUSE_KEY[outcome.cause])}`);
    setPhase('failed');
  }

  function apply(): void {
    if (proposal === undefined) return;
    onApplyPriorities(proposal.suggestions.map((s) => ({ id: s.id, priority: s.priority })));
    setApplied(true);
    reset();
  }

  if (phase === 'idle') {
    return (
      <Stack gap="tight">
        <Button label={t('web.ai.prioritize.button')} onPress={() => { setApplied(false); setPhase('disclosing'); }} />
        {applied ? <Text variant="row-meta" tone="muted">{t('web.ai.prioritize.applied')}</Text> : null}
      </Stack>
    );
  }

  if (phase === 'disclosing') {
    return (
      <Card>
        <Text variant="section-title">{t('web.ai.disclosure.heading')}</Text>
        {target === undefined ? (
          <Text variant="row-meta" tone="muted">{t(AI_NO_TARGET_KEY.prioritize)}</Text>
        ) : (
          <>
            <Text variant="row-meta" tone="muted">
              {`${t('web.ai.prioritize.countLead')} ${inputs.length} ${t('web.ai.prioritize.countTail')}`}
            </Text>
            <AiDisclosureBlock
              testIdPrefix="ai-prioritize-"
              target={target}
              fields={invocation.fields}
              retentionDisclosure={disclosure?.retentionDisclosure}
            />
          </>
        )}
        <HStack gap="tight">
          {target === undefined ? null : <Button label={t('web.ai.action.send')} onPress={() => void send()} />}
          <Button label={t('web.ai.action.cancel')} tone="secondary" onPress={reset} />
          {target === undefined ? (
            <Button label={t('web.ai.action.retry')} tone="secondary" onPress={() => setRetryTick((n) => n + 1)} />
          ) : null}
        </HStack>
      </Card>
    );
  }

  if (phase === 'loading') {
    return (
      <Card>
        <Text variant="row-meta" tone="muted">{t('web.ai.loading.waiting')}</Text>
      </Card>
    );
  }

  if (phase === 'proposal' && proposal !== undefined) {
    return (
      <Card>
        <Text variant="section-title">{t('web.ai.prioritize.proposalHead', { count: proposal.suggestions.length })}</Text>
        <Text variant="row-meta" tone="muted">
          {proposal.destination === 'none' ? t('web.ai.source.local') : t('web.ai.source.remote')}
        </Text>
        {proposal.truncated ? (
          <Text variant="row-meta" tone="danger">{t('web.ai.prioritize.truncated', { max: MAX_PRIORITIZE_TASKS })}</Text>
        ) : null}
        <Stack gap="tight">
          {proposal.suggestions.map((s) => (
            <Stack key={s.id} gap="tight">
              <HStack gap="tight" align="center">
                <Text variant="row-title" grow>{titleById.get(s.id) ?? s.id}</Text>
                <Text variant="row-meta" tone="muted">{t(PRIORITY_COPY_KEY[s.priority] ?? 'web.ai.prioritize.priority.none')}</Text>
              </HStack>
              {s.reason === '' ? null : <Text variant="row-meta" tone="muted">{s.reason}</Text>}
            </Stack>
          ))}
        </Stack>
        <HStack gap="tight">
          <Button label={t('web.ai.prioritize.apply')} onPress={apply} />
          <Button label={t('web.ai.action.cancel')} tone="secondary" onPress={reset} />
        </HStack>
      </Card>
    );
  }

  return (
    <Card>
      <Text variant="section-title">{t('web.ai.prioritize.failedHead')}</Text>
      <Text variant="row-meta" tone="danger">{failure}</Text>
      <HStack gap="tight">
        <Button label={t('web.ai.action.retry')} onPress={() => void send()} />
        <Button label={t('web.ai.action.cancel')} tone="secondary" onPress={reset} />
      </HStack>
    </Card>
  );
}
