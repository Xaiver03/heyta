/**
 * 移动端「AI 拆解任务」面板。
 *
 * 把一条任务交给 `requestBreakdown()` 拆成子项清单，确认后合并进任务备注。
 * 只做「生成结果展示 + 应用」的最小闭环：披露 → 发送 → 候选 → 勾选写入。
 * 业务规则（拆解、清单合并、熔断形状）都在 `packages/app-host`，这里只做接线。
 */

import React, { useMemo, useState } from 'react';

import { buildDisclosure, fromHealthSnapshot } from '@heyta/ai';
import type { AiHealthSnapshot, AiRoutingConfig, EgressConsent, HealthMap, SecretStore } from '@heyta/ai';
import {
  buildBreakdownInvocation,
  mergeChecklistIntoNote,
  requestBreakdown,
  resolveAiRoute,
  type BreakdownProposal,
} from '@heyta/app-host';
import { useI18n } from '@heyta/i18n';
import type { Task } from '@heyta/domain';

import { Button, Card, Checkbox, HStack, Stack, Text } from '../ui/kit';
import { AiDisclosureBlock } from './disclosure';
import { AI_CAUSE_KEY, AI_NO_TARGET_KEY, BREAKDOWN_FAILURE_KEY } from './copy';
import { toolboxManagedTransport } from './toolbox-shared';

type Phase = 'idle' | 'disclosing' | 'loading' | 'proposal' | 'failed';

export interface AiBreakdownProps {
  task: Task;
  routing: AiRoutingConfig;
  consents: readonly EgressConsent[];
  secrets: SecretStore;
  fetchImpl?: typeof fetch;
  /** 落盘的熔断快照 —— 不传它，"跳闸状态活不过一次刷新"。 */
  healthSnapshot?: AiHealthSnapshot;
  onApplyNote: (note: string) => void;
  onHealth?: (health: HealthMap) => void;
}

export function AiBreakdown({
  task,
  routing,
  consents,
  secrets,
  fetchImpl,
  healthSnapshot,
  onApplyNote,
  onHealth,
}: AiBreakdownProps): React.JSX.Element {
  const { t, locale } = useI18n();
  const [phase, setPhase] = useState<Phase>('idle');
  const [proposal, setProposal] = useState<BreakdownProposal | undefined>(undefined);
  const [selected, setSelected] = useState<readonly boolean[]>([]);
  const [failure, setFailure] = useState<string>('');
  const [applied, setApplied] = useState(false);
  const [retryTick, setRetryTick] = useState(0);

  const health = fromHealthSnapshot(healthSnapshot ?? {}, Date.now());
  const { target } = resolveAiRoute(routing, 'breakdown', { health });

  // 披露与真正发送共用同一个 source —— 界面语言决定提示词末尾的「输出语言」段。
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
  const invocation = buildBreakdownInvocation(source, []);
  const disclosure =
    target === undefined
      ? undefined
      : buildDisclosure({ feature: 'breakdown', destination: target.destination, fields: invocation.fields });

  const reset = (): void => {
    setPhase('idle');
    setProposal(undefined);
    setSelected([]);
    setFailure('');
  };

  async function send(): Promise<void> {
    setPhase('loading');
    const outcome = await requestBreakdown(source, {
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
      setSelected(outcome.proposal.items.map(() => true));
      setPhase('proposal');
      return;
    }
    const base = t(BREAKDOWN_FAILURE_KEY[outcome.reason]);
    const cause = outcome.cause === undefined ? '' : `${base} ${t(AI_CAUSE_KEY[outcome.cause])}`;
    setFailure(cause === '' ? base : cause);
    setPhase('failed');
  }

  function apply(): void {
    if (proposal === undefined) return;
    const kept = proposal.items.filter((_, i) => selected[i] === true);
    if (kept.length === 0) return;
    onApplyNote(mergeChecklistIntoNote(task.note, kept));
    setApplied(true);
    reset();
  }

  if (phase === 'idle') {
    return (
      <Stack gap="tight">
        <Button label={t('web.ai.breakdown.button')} onPress={() => { setApplied(false); setPhase('disclosing'); }} />
        {applied ? <Text variant="row-meta" tone="muted">{t('web.ai.breakdown.applied')}</Text> : null}
      </Stack>
    );
  }

  if (phase === 'disclosing') {
    return (
      <Card>
        <Text variant="section-title">{t('web.ai.disclosure.heading')}</Text>
        {target === undefined ? (
          <Text variant="row-meta" tone="muted">{t(AI_NO_TARGET_KEY.breakdown)}</Text>
        ) : (
          <AiDisclosureBlock
            testIdPrefix="ai-breakdown-"
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
        <Text variant="section-title">{t('web.ai.breakdown.proposalHead', { count: proposal.items.length })}</Text>
        <Text variant="row-meta" tone="muted">
          {proposal.destination === 'none' ? t('web.ai.source.local') : t('web.ai.source.remote')}
        </Text>
        {proposal.truncated ? (
          <Text variant="row-meta" tone="danger">{t('web.ai.breakdown.truncated', { count: proposal.items.length })}</Text>
        ) : null}
        <Stack gap="tight">
          {proposal.items.map((item, i) => (
            <Checkbox
              key={`${i}-${item}`}
              checked={selected[i] === true}
              onToggle={() => setSelected((prev) => prev.map((v, idx) => (idx === i ? !v : v)))}
              label={item}
              caption={item}
              testID={`ai-breakdown-item-${i}`}
            />
          ))}
        </Stack>
        <HStack gap="tight">
          <Button label={t('web.ai.breakdown.apply')} onPress={apply} disabled={selected.every((v) => v !== true)} />
          <Button label={t('web.ai.action.cancel')} tone="secondary" onPress={reset} />
        </HStack>
      </Card>
    );
  }

  return (
    <Card>
      <Text variant="section-title">{t('web.ai.breakdown.failedHead')}</Text>
      <Text variant="row-meta" tone="danger">{failure}</Text>
      <HStack gap="tight">
        <Button label={t('web.ai.action.retry')} onPress={() => void send()} />
        <Button label={t('web.ai.action.cancel')} tone="secondary" onPress={reset} />
      </HStack>
    </Card>
  );
}
