/**
 * `AiDisclosure` 的**移动端适配器**
 * ================================
 *
 * 共享层的 `AiDisclosure`（`@heyta/ui`）是**唯一那份披露实现**，而且它只用 RN 原语
 * （没有 `<div>` / `<p>` / `<strong>`），所以本端与 web 渲染的是**同一个组件** ——
 * 不是"同一套样式的两份实现"。web 侧的对应文件是
 * `apps/web/src/features/ai/AiDisclosureHost.tsx`，两个适配器都只是
 * "词条 + 路由目标 → 那份契约"的接缝。
 *
 * 🔴 为什么必须有这个组件而不让每个面板各写一遍披露：
 * `packages/ui/src/ai/AiDisclosure.tsx` 文件头记着实测 —— web 原本有 5 份手抄的披露 JSX，
 * **第 5 份漂了**（`AiToolRun` 缺「回退链」与「E2EE 警告」），
 * 也就是一次真实的隐私披露缺口，而**没有任何测试会红**。
 * 本端如果在新壳里再手抄五份，就是把那个缺口重新制造一遍。
 */

import React from 'react';
import { AiDisclosure, type AiDisclosureLabels } from '@heyta/ui';
import type { RetentionDisclosure } from '@heyta/ai';
import type { AiRouteTarget } from '@heyta/app-host';
import { useI18n } from '@heyta/i18n';

import { AI_DISCLOSURE_KEYS, retentionMessage } from './copy';

/**
 * 中英列表分隔符不同（`、` vs `, `）。
 * ⚠️ 与 web 的 `locale-punctuation.ts` 同一条判断；那张表在这里只覆盖本壳的两种语言。
 */
const LIST_SEPARATOR: Record<'zh-CN' | 'en', string> = {
  'zh-CN': '、',
  en: ', ',
};

export interface AiDisclosureBlockProps {
  /** 自动化取证的 testid 前缀（与 web 各面板同一批名字，便于跨端对账）。 */
  readonly testIdPrefix: string;
  readonly target: AiRouteTarget;
  /** 会出境的字段，**逐项**。 */
  readonly fields: readonly string[];
  /** 结构化保留策略。`undefined` = 没算出来 → 不渲染「留多久」那一行。 */
  readonly retentionDisclosure: RetentionDisclosure | undefined;
  /** 字段清单与 E2EE 警告之间那一行（面板专有内容，比如"这次带了 N 条任务"）。 */
  readonly children?: React.ReactNode;
}

export function AiDisclosureBlock({
  testIdPrefix,
  target,
  fields,
  retentionDisclosure,
  children,
}: AiDisclosureBlockProps): React.JSX.Element {
  const { t, locale } = useI18n();

  const retention =
    retentionDisclosure === undefined ? undefined : retentionMessage(retentionDisclosure);

  const labels: AiDisclosureLabels = {
    destinationLead: t(AI_DISCLOSURE_KEYS.destinationLead),
    local: t(AI_DISCLOSURE_KEYS.local),
    remote: t(AI_DISCLOSURE_KEYS.remote),
    model: t(AI_DISCLOSURE_KEYS.model, { model: target.model }),
    fallbackLead: t(AI_DISCLOSURE_KEYS.fallbackLead),
    retentionLead: t(AI_DISCLOSURE_KEYS.retentionLead),
    fieldsLead: t(AI_DISCLOSURE_KEYS.fieldsLead),
    e2eeLead: t(AI_DISCLOSURE_KEYS.e2eeLead),
    e2eeStrong: t(AI_DISCLOSURE_KEYS.e2eeStrong),
  };

  return (
    <AiDisclosure
      testIdPrefix={testIdPrefix}
      labels={labels}
      target={{
        label: target.label,
        endpoint: target.endpoint,
        model: target.model,
        isLocal: target.isLocal,
        fallbacks: target.fallbacks,
      }}
      fields={fields}
      retentionText={retention === undefined ? undefined : t(retention.key, retention.vars)}
      separator={LIST_SEPARATOR[locale] ?? LIST_SEPARATOR['zh-CN']}
    >
      {children}
    </AiDisclosure>
  );
}
