/**
 * `AiDisclosure` 的 **web 适配器**
 * ================================
 *
 * 共享层的 `AiDisclosure` 只认两样东西：**结构**（`target` / `fields` /
 * `retentionText`）与**已经翻译好的文案**（`labels`）。它刻意不 import
 * `@heyta/i18n`（那会拖进第二份 React，`check:mobile-bundle` 盯着）。
 *
 * 这个文件就是"web 的 i18n + 路由 target"到那个契约之间的**唯一接缝**：
 *
 *   · 词条 → `labels`（全句插值在这里做完，"模型：{model}" 这类模板不能进共享层）；
 *   · `ResolvedRouteTarget` → 共享层的 `AiDisclosureTarget`；
 *   · `locale` → 列表分隔符（中英标点不同）；
 *   · `<HeytaUiProvider>` —— 共享组件从 context 取 token / 文字样式，
 *     缺了会**运行时抛错**而类型与单测都不会红。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 为什么 Provider 挂在这里，而不是 `App.tsx` 的根
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 实测：`apps/web/src/App.tsx` 目前只有**两处** `<HeytaUiProvider>`，
 * 分别包着 `tasks` 与 `focus` 两棵子树；5 个 AI 面板**都不在其中**
 * （`AiCapture` 还被 `CaptureComposer` 再包一层）。所以把 Provider 提到
 * 根上才是更彻底的做法 —— 但 `App.tsx` / `CaptureComposer.tsx` 不在本刀
 * 的文件白名单里。这一层自带 Provider 是**保守选择**：它保证今天不会崩，
 * 代价是 5 个面板各挂一层。
 *
 * ⚠️ 最小下一步（记在 `AiDisclosure.tsx` 文件头第 1 条之外）：
 * 把 Provider 提到 `App.tsx` 根，删掉这里的 Provider，并把 `AiDisclosure`
 * 登记进 `scripts/check-ui-provider.mjs` 的 `PROVIDER_DEPENDENT` ——
 * 否则宿主拆掉 Provider 时门禁不会红（第四刀 sync 踩过的形状）。
 */

import React from 'react';

import { AiDisclosure, HeytaUiProvider, type AiDisclosureLabels } from '@heyta/ui';
import type { RetentionDisclosure } from '@heyta/ai';
import { useI18n } from '@heyta/i18n';

import { retentionMessage } from './disclosure-copy.js';
import { LIST_SEPARATOR } from './locale-punctuation.js';
import type { ResolvedRouteTarget } from './route-explanation.js';

export interface AiDisclosureHostProps {
  /**
   * testid 前缀。实测各面板值：
   * `ai-`（拆解）/ `prioritize-` / `duration-` / `capture-` / `ai-tool-`（工具调用）。
   */
  readonly testIdPrefix: string;
  readonly target: ResolvedRouteTarget;
  /** 会出境的字段，**逐项**。 */
  readonly fields: readonly string[];
  /** 结构化保留策略。`undefined` = 没算出来 → 不渲染「留多久」那一行。 */
  readonly retentionDisclosure: RetentionDisclosure | undefined;
  /**
   * `fields` 与 E2EE 警告之间的一行面板专有内容
   * （`AiPrioritize` 的 count、`AiDuration` 的估时依据）。
   */
  readonly children?: React.ReactNode;
}

export function AiDisclosureHost({
  testIdPrefix,
  target,
  fields,
  retentionDisclosure,
  children,
}: AiDisclosureHostProps): React.JSX.Element {
  const { t, locale } = useI18n();

  const retention =
    retentionDisclosure === undefined ? undefined : retentionMessage(retentionDisclosure);

  const labels: AiDisclosureLabels = {
    destinationLead: t('web.ai.disclosure.destinationLead'),
    local: t('web.ai.disclosure.local'),
    remote: t('web.ai.disclosure.remote'),
    model: t('web.ai.disclosure.model', { model: target.model }),
    fallbackLead: t('web.ai.disclosure.fallbackLead'),
    retentionLead: t('web.ai.disclosure.retentionLead'),
    fieldsLead: t('web.ai.disclosure.fieldsLead'),
    e2eeLead: t('web.ai.disclosure.e2eeLead'),
    e2eeStrong: t('web.ai.disclosure.e2eeStrong'),
  };

  return (
    <HeytaUiProvider>
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
        separator={LIST_SEPARATOR[locale]}
      >
        {children}
      </AiDisclosure>
    </HeytaUiProvider>
  );
}
