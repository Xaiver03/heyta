/**
 * 移动端「AI 估时」面板。
 *
 * 把一条任务交给 `requestDuration()` 估一个工期，确认后把分钟数写进任务备注。
 * 与 `AiBreakdown` 同一套最小闭环：披露 → 发送 → 候选 → 应用。
 */

import React, { useMemo, useState } from 'react';

import { buildDisclosure, fromHealthSnapshot } from '@heyta/ai';
import type { AiHealthSnapshot, AiRoutingConfig, EgressConsent, HealthMap, SecretStore } from '@heyta/ai';
import {
  buildDurationInvocation,
  MAX_DURATION_MINUTES,
  MIN_DURATION_MINUTES,
  requestDuration,
  resolveAiRoute,
  type DurationProposal,
} from '@heyta/app-host';
import { useI18n } from '@heyta/i18n';
import type { Task } from '@heyta/domain';

import { Button, Card, HStack, Stack, Text } from '../ui/kit';
import { AiDisclosureBlock } from './disclosure';
import { AI_CAUSE_KEY, AI_NO_TARGET_KEY, DURATION_FAILURE_KEY } from './copy';
import { toolboxManagedTransport } from './toolbox-shared';

type Phase = 'idle' | 'disclosing' | 'loading' | 'proposal' | 'failed';

export interface AiDurationProps {
  task: Task;
  routing: AiRoutingConfig;
  consents: readonly EgressConsent[];
  secrets: SecretStore;
  fetchImpl?: typeof fetch;
  healthSnapshot?: AiHealthSnapshot;
  onApplyNote: (note: string) => void;
  onHealth?: (health: HealthMap) => void;
}

export function AiDuration({
  task,
  routing,
  consents,
  secrets,
  fetchImpl,
  healthSnapshot,
  onApplyNote,
  onHealth,
}: AiDurationProps): React.JSX.Element {
  const { t, locale } = useI18n();
  const [phase, setPhase] = useState<Phase>('idle');
  const [proposal, setProposal] = useState<DurationProposal | undefined>(undefined);
  const [failure, setFailure] = useState<string>('');
  const [applied, setApplied] = useState(false);
  const [retryTick, setRetryTick] = useState(0);

  const health = fromHealthSnapshot(healthSnapshot ?? {}, Date.now());
  const { target } = resolveAiRoute(routing, 'duration-estimate', { health });

  const source = useMemo(
    () => ({
      title: task.title,
      locale,
      now: Date.now(),
      ...(task.note === undefined ? {} : { note: task.note }),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [task.title, task.note, locale, retryTick],
  );
  const invocation = buildDurationInvocation(source, []);
  const disclosure =
    target === undefined
      ? undefined
      : buildDisclosure({ feature: 'duration-estimate', destination: target.destination, fields: invocation.fields });

  const reset = (): void => {
    setPhase('idle');
    setProposal(undefined);
    setFailure('');
  };

  async function send(): Promise<void> {
    setPhase('loading');
    const outcome = await requestDuration(source, {
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
    const base = t(DURATION_FAILURE_KEY[outcome.reason]);
    setFailure(outcome.cause === undefined ? base : `${base} ${t(AI_CAUSE_KEY[outcome.cause])}`);
    setPhase('failed');
  }

  function apply(): void {
    if (proposal === undefined) return;
    const minutesText = t('web.ai.duration.minutes', { minutes: proposal.minutes });
    onApplyNote(task.note === undefined || task.note === '' ? minutesText : `${task.note}\n\n${minutesText}`);
    setApplied(true);
    reset();
  }

  if (phase === 'idle') {
    return (
      <Stack gap="tight">
        <Button label={t('web.ai.duration.button')} onPress={() => { setApplied(false); setPhase('disclosing'); }} />
        {applied ? <Text variant="row-meta" tone="muted">{t('web.ai.duration.applied')}</Text> : null}
      </Stack>
    );
  }

  if (phase === 'disclosing') {
    return (
      <Card>
        <Text variant="section-title">{t('web.ai.disclosure.heading')}</Text>
        {target === undefined ? (
          <Text variant="row-meta" tone="muted">{t(AI_NO_TARGET_KEY['duration-estimate'])}</Text>
        ) : (
          <AiDisclosureBlock
            testIdPrefix="ai-duration-"
            target={target}
            fields={invocation.fields}
            retentionDisclosure={disclosure?.retentionDisclosure}
          />
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
        <Text variant="section-title">{t('web.ai.duration.proposalAria')}</Text>
        <Text variant="row-title">
          {`${t('web.ai.duration.proposalLead')} ${t('web.ai.duration.minutes', { minutes: proposal.minutes })}`}
        </Text>
        {proposal.clamped ? (
          <Text variant="row-meta" tone="danger">
            {t('web.ai.duration.clamped', {
              min: MIN_DURATION_MINUTES,
              max: MAX_DURATION_MINUTES,
              minutes: proposal.minutes,
            })}
          </Text>
        ) : null}
        <Text variant="row-meta" tone="muted">
          {proposal.historyRows === 0
            ? t('web.ai.duration.basis.none')
            : `${t('web.ai.duration.basis.historyLead')} ${proposal.historyRows} ${t('web.ai.duration.basis.historyMid')}`}
        </Text>
        <Text variant="row-meta" tone="muted">{t('web.ai.duration.note')}</Text>
        <HStack gap="tight">
          <Button label={t('web.ai.duration.apply')} onPress={apply} />
          <Button label={t('web.ai.action.cancel')} tone="secondary" onPress={reset} />
        </HStack>
      </Card>
    );
  }

  return (
    <Card>
      <Text variant="section-title">{t('web.ai.duration.failedHead')}</Text>
      <Text variant="row-meta" tone="danger">{failure}</Text>
      <HStack gap="tight">
        <Button label={t('web.ai.action.retry')} onPress={() => void send()} />
        <Button label={t('web.ai.action.cancel')} tone="secondary" onPress={reset} />
      </HStack>
    </Card>
  );
}
