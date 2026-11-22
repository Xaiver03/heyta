/**
 * 移动端「AI 工具」面板 —— 把拆解 / 排序 / 估时三枚结构化功能收在一个入口里。
 *
 * 🔴 为什么要有这一层而不是三枚按钮各占一行：
 * 三个功能都是"坐下来处理一条 / 一组任务"的动作，共用同一套出境披露与熔断状态。
 * 收成一个面板，用户在任务详情里点一次就能在三者之间切换，不必在屏幕上找三个按钮。
 * 这也是门禁 `check-ai-coverage` 认的挂载点（`UI_ENTRY_COMPONENT_BY_END` → `AiToolboxScreen`）。
 */

import React, { useState } from 'react';

import type { AiHealthSnapshot, AiRoutingConfig, EgressConsent, HealthMap, SecretStore } from '@heyta/ai';
import type { PrioritizeDecision } from '@heyta/app-host';
import type { Task } from '@heyta/domain';
import { useI18n } from '@heyta/i18n';

import { Chip, HStack, Stack, Text } from '../ui/kit';
import { AI_FEATURE_LABEL_KEY } from './copy';
import { AiBreakdown } from './AiBreakdown';
import { AiDuration } from './AiDuration';
import { AiPrioritize } from './AiPrioritize';

type ToolboxMode = 'breakdown' | 'prioritize' | 'duration-estimate';

export interface AiToolboxScreenProps {
  /** 当前任务（拆解 / 估时需要）。`undefined` = 没有选中任务，那两枚不出现。 */
  task?: Task;
  /** 参与排序的任务集合（排序需要）。 */
  tasks: readonly Task[];
  routing: AiRoutingConfig;
  consents: readonly EgressConsent[];
  secrets: SecretStore;
  fetchImpl?: typeof fetch;
  healthSnapshot?: AiHealthSnapshot;
  onApplyNote: (note: string) => void;
  onApplyPriorities: (decisions: readonly PrioritizeDecision[]) => void;
  onHealth?: (health: HealthMap) => void;
}

export function AiToolboxScreen({
  task,
  tasks,
  routing,
  consents,
  secrets,
  fetchImpl,
  healthSnapshot,
  onApplyNote,
  onApplyPriorities,
  onHealth,
}: AiToolboxScreenProps): React.JSX.Element {
  const { t } = useI18n();
  const [mode, setMode] = useState<ToolboxMode>(task === undefined ? 'prioritize' : 'breakdown');

  // 拆解 / 估时需要一个当前任务；排序只要有一组任务即可（多选后触发的入口也走这里）。
  const modes: ToolboxMode[] = [
    ...(task === undefined ? [] : (['breakdown', 'duration-estimate'] as ToolboxMode[])),
    ...(tasks.length === 0 ? [] : (['prioritize'] as ToolboxMode[])),
  ];

  const shared = {
    routing,
    consents,
    secrets,
    ...(fetchImpl === undefined ? {} : { fetchImpl }),
    ...(healthSnapshot === undefined ? {} : { healthSnapshot }),
    ...(onHealth === undefined ? {} : { onHealth }),
  } as const;

  return (
    <Stack gap="default">
      {modes.length > 1 ? (
        <HStack gap="tight" align="center">
          {modes.map((m) => (
            <Chip
              key={m}
              label={t(AI_FEATURE_LABEL_KEY[m])}
              selected={mode === m}
              onPress={() => setMode(m)}
              testID={`ai-toolbox-${m}`}
            />
          ))}
        </HStack>
      ) : null}

      {mode === 'breakdown' && task !== undefined ? (
        <AiBreakdown task={task} {...shared} onApplyNote={onApplyNote} />
      ) : null}
      {mode === 'duration-estimate' && task !== undefined ? (
        <AiDuration task={task} {...shared} onApplyNote={onApplyNote} />
      ) : null}
      {mode === 'prioritize' ? (
        tasks.length === 0 ? (
          <Text variant="row-meta" tone="muted">{t('web.ai.failure.prioritize.emptyTasks')}</Text>
        ) : (
          <AiPrioritize tasks={tasks} {...shared} onApplyPriorities={onApplyPriorities} />
        )
      ) : null}
    </Stack>
  );
}
