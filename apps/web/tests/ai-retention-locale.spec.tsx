/**
 * 「留多久」那一行必须是**当前语言**的词条
 * ============================================
 *
 * ## 这条测试钉的是什么
 *
 * `buildDisclosure()` 的返回值里有两个**同源**字段：
 *
 * | 字段 | 来源 | 会不会跟着语言变 |
 * |---|---|---|
 * | `retentionDisclosure.kind` | 结构化判别式（`packages/ai`） | 不涉及文字 |
 * | `retentionText` | `packages/ai` 的中文兼容句（`@deprecated`） | ❌ **永远中文** |
 *
 * 在它之前，四个 AI 面板渲染的是
 * `disclosure.retentionText ?? t('…retentionUndecided')` ——
 * 于是英文界面上「保留：」那一行只有**托管**这一支碰巧是英文的
 * （`undecided` 因为 `retentionText` 是 `undefined` 才走到词条），
 * 而本机端点（`not-applicable`）与自备远端（`third-party-decides`）
 * 两句都是中文散文。
 *
 * 门禁看不见它：渲染的是**变量**，不是字面量。所以必须有一条
 * 按语言渲染、按语言断言的测试 —— 否则把它改回 `retentionText` 也能全绿。
 *
 * ## 为什么会失败（故意让它脆弱）
 *
 * 期望值是**写死的两句词条**，不是从词条表里回读的：
 * 回读只能证明"渲染 == 词条"，证明不了"词条是对的"。
 * 任何一处分支被改回 `retentionText`，英文那两次断言立刻变红（拿到的是中文），
 * 并且 `not.toMatch(CJK)` 也会红。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { I18nProvider, type Locale } from '@heyta/i18n';
import type { AiRoutingConfig, SecretStore } from '@heyta/ai';
import type { Task } from '@heyta/domain';

const { AiBreakdown } = await import('../src/features/ai/AiBreakdown.js');

/** 与 `language-switcher.spec.tsx` 同一套判据：扩展 A + 基本区。 */
const CJK = /[\u3400-\u4DBF\u4E00-\u9FFF]/;

const EMPTY_SECRETS: SecretStore = { get: () => Promise.resolve(undefined) };

/** 回环地址 → `classifyDestination` 判 `none` → 保留策略是 `not-applicable`。 */
const LOCAL_ENDPOINT = {
  id: 'local',
  label: '本机 Ollama',
  endpoint: 'http://localhost:11434/v1',
  model: 'qwen3:8b',
  capabilities: ['structured_output', 'long_context'] as const,
};

/** 自备远端 → `third-party-decides`（保留策略由用户自己的端点决定）。 */
const REMOTE_ENDPOINT = {
  id: 'remote',
  label: '云端供应商',
  endpoint: 'https://api.example.com/v1',
  model: 'some-model',
  capabilities: ['structured_output', 'long_context'] as const,
};

function makeRouting(
  endpoint: typeof LOCAL_ENDPOINT | typeof REMOTE_ENDPOINT,
): AiRoutingConfig {
  return {
    enabled: true,
    allowRemote: true,
    endpoints: [endpoint],
    routes: { breakdown: [{ endpointId: endpoint.id }] },
  };
}

const TASK: Task = {
  id: 't1',
  title: '做发布',
  note: '我自己写的备注。',
  createdAt: 0,
  updatedAt: 0,
} as Task;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

/** 挂载 + 点进披露态（披露本身不发请求，所以是同步的）。 */
function renderDisclosure(
  locale: Locale,
  endpoint: typeof LOCAL_ENDPOINT | typeof REMOTE_ENDPOINT,
): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <I18nProvider locale={locale}>
        <AiBreakdown
          task={TASK}
          routing={makeRouting(endpoint)}
          consents={[]}
          secrets={EMPTY_SECRETS}
          onApplyNote={() => Promise.resolve()}
        />
      </I18nProvider>,
    );
  });
  act(() => {
    container?.querySelector<HTMLButtonElement>('[data-testid="ai-breakdown-t1"]')?.click();
  });
  return container;
}

function retentionText(el: HTMLDivElement): string {
  const node = el.querySelector('[data-testid="ai-retention-text"]');
  expect(node, '披露态必须渲染出「保留」那一行').toBeTruthy();
  return node?.textContent ?? '';
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
});

describe('🔴 「留多久」按语言取词条（不是跨包中文兼容句）', () => {
  it('本机端点 · 中文：等于 zh 词条（逐字）', () => {
    const el = renderDisclosure('zh-CN', LOCAL_ENDPOINT);
    expect(retentionText(el)).toBe('未离开设备，不涉及服务端保留。');
  });

  it('🔴 本机端点 · 英文：等于 en 词条，且一个汉字都没有', () => {
    const el = renderDisclosure('en', LOCAL_ENDPOINT);
    const text = retentionText(el);
    expect(text).toBe('Data does not leave this device, so there is no server-side retention.');
    expect(text).not.toMatch(CJK);
  });

  it('自备远端 · 中文：等于 zh 词条（逐字）', () => {
    const el = renderDisclosure('zh-CN', REMOTE_ENDPOINT);
    expect(retentionText(el)).toBe('保留策略由你自己的端点决定，heyta 无从知晓。');
  });

  it('🔴 自备远端 · 英文：等于 en 词条，且一个汉字都没有', () => {
    const el = renderDisclosure('en', REMOTE_ENDPOINT);
    const text = retentionText(el);
    expect(text).toBe('Retention is decided by your own endpoint; heyta has no way to know.');
    expect(text).not.toMatch(CJK);
  });
});
