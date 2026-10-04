/**
 * 🔴🔴 跨面板披露一致性
 * =====================
 *
 * **同一条路由解析下，5 个 AI 入口必须渲染同一组披露维度。**
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 这条断言为什么存在（它不是"多测一遍"）
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 「发送前披露」原本在 web 里被**手抄了 5 份**。前四份只差注释，而第 5 份
 * （`AiToolRun`）漂移了：**缺「回退链」、缺「E2EE 警告」** ——
 * 而它拿到的 `target` 确实带 `fallbacks`（`resolveFeatureRoute(routing,
 * 'tool-calling', …)`），`packages/ai` 的 `invokeRouted()` 确实会多端点回退。
 *
 * ⇒ 那是一处**真实的隐私披露缺口**：工具调用可能把数据发给另一家公司，
 * 界面上没有说。而改造前**没有任何测试会红** —— 每个面板各测各的，
 * 谁也没规定"五个入口必须一样"。
 *
 * 这条断言就是那个缺失的规定：**把 5 个入口放在同一条路由解析下比较**。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 为什么用真实面板而不是直接渲染 `AiDisclosure`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 直接渲染共享组件只能证明"组件本身五维齐全"，证明不了
 * **"5 个面板都用上了它"**。判据必须落在**面板**上：只要有一个面板少接一维，
 * 这里就得红。
 *
 * ⚠️ 判据是 `data-testid`，与 `ai-*.spec.tsx` 用的是同一套接缝 ——
 * 所以 testid 既不能改名，也不能只在某一个面板上拼错。
 */

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { I18nProvider } from '@heyta/i18n';
import type { AiRoutingConfig, EgressConsent, SecretStore } from '@heyta/ai';
import type { Task } from '@heyta/domain';
import type {
  LocalApiFocusSession,
  LocalApiHabitLog,
  LocalApiHost,
  LocalApiItem,
  LocalApiNoteRow,
  LocalApiReminder,
  LocalApiTag,
} from '@heyta/local-api';

import { AiBreakdown } from '../src/features/ai/AiBreakdown.js';
import { AiPrioritize } from '../src/features/ai/AiPrioritize.js';
import { AiDuration } from '../src/features/ai/AiDuration.js';
import { AiCapture } from '../src/features/ai/AiCapture.js';
import { AiToolRun } from '../src/features/ai/AiToolRun.js';
import { PanelEphemeralProvider } from '../src/features/ai/panel-ephemeral.js';

const SECRETS: SecretStore = { get: () => Promise.resolve(undefined) };

/**
 * 两个**远端**端点 —— 首选 + 回退。
 *
 * 判据里"回退链必须披露"和"远端必须出现 E2EE 警告"要同时成立，
 * 所以首选不能是本机地址（本机地址两者都不会出现，那样这条断言
 * 会因为"没东西可比"而变得没有意义）。
 */
const PRIMARY = {
  id: 'primary',
  label: '云端首选',
  endpoint: 'https://primary.example.com/v1',
  model: 'model-primary',
  capabilities: ['structured_output', 'long_context', 'tool_calling'] as const,
};

const FALLBACK = {
  id: 'fallback',
  label: '别家云端',
  endpoint: 'https://fallback.example.com/v1',
  model: 'model-fallback',
  capabilities: ['structured_output', 'long_context', 'tool_calling'] as const,
};

const ROUTE = [{ endpointId: 'primary' }, { endpointId: 'fallback' }];

/** 🔴 **同一条路由解析**：5 个功能共用同一份配置。 */
const ROUTING: AiRoutingConfig = {
  enabled: true,
  allowRemote: true,
  endpoints: [PRIMARY, FALLBACK],
  routes: {
    breakdown: ROUTE,
    prioritize: ROUTE,
    'duration-estimate': ROUTE,
    capture: ROUTE,
    'tool-calling': ROUTE,
  },
};

const CONSENTS: readonly EgressConsent[] = [
  { feature: 'breakdown', destination: 'user-endpoint', grantedAt: 1 },
  { feature: 'prioritize', destination: 'user-endpoint', grantedAt: 1 },
  { feature: 'duration-estimate', destination: 'user-endpoint', grantedAt: 1 },
  { feature: 'capture', destination: 'user-endpoint', grantedAt: 1 },
  { feature: 'tool-calling', destination: 'user-endpoint', grantedAt: 1 },
];

const TASK: Task = {
  id: 't1',
  title: '做发布',
  note: '我自己写的备注。',
  createdAt: 0,
  updatedAt: 0,
} as Task;

const GRANTS = { list_tasks: true, create_task: true } as const;

/** 规则命中不了的一句话 —— 只有规则处理不了时才会走披露。 */
const TOOL_TEXT = '帮我看看下周三评审要准备什么';

function fakeHost(): LocalApiHost {
  const items: readonly LocalApiItem[] = [{ id: 't1', title: '买牛奶', readable: true }];
  return {
    listTasks: () => Promise.resolve(items),
    getTask: () => Promise.resolve(items[0]),
    listProjects: () => Promise.resolve([]),
    listHabits: () => Promise.resolve([]),
    listTags: () => Promise.resolve([] as readonly LocalApiTag[]),
    listNotes: () => Promise.resolve([] as readonly LocalApiNoteRow[]),
    getNote: () => Promise.resolve(undefined),
    listHabitLogs: () => Promise.resolve([] as readonly LocalApiHabitLog[]),
    listFocusSessions: () => Promise.resolve([] as readonly LocalApiFocusSession[]),
    listEvents: () => Promise.resolve([]),
    getEvent: () => Promise.resolve(undefined),
    listReminders: () => Promise.resolve([] as readonly LocalApiReminder[]),
    submit: () => Promise.resolve({ ok: true as const, taskId: 'created-1' }),
  };
}

/** 披露的五个维度 —— 顺序即 `AI_DISCLOSURE_DIMENSIONS`。 */
const DIMENSIONS = ['destination', 'fallbacks', 'retention', 'fields', 'e2ee-warning'] as const;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

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

function mount(node: ReactNode): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    // 🔴 五个入口里有两个（单步工具 / 对话助手）的未决状态住在 Provider 里，所以这一层的
    //    夹具必须**统一**包上 Provider —— 少包一个，那条入口就红在「AI 面板必须包在
    //    <PanelEphemeralProvider> 里」。Provider 缺位是抛错，不是静默降级（同一条立场）。
    root?.render(
      <I18nProvider locale="zh-CN">
        <PanelEphemeralProvider>{node}</PanelEphemeralProvider>
      </I18nProvider>,
    );
  });
  return container;
}

function click(el: Element | null | undefined, el2?: HTMLElement): void {
  act(() => {
    (el as HTMLElement | null)?.click();
    el2?.click();
  });
}

async function clickAsync(el: Element | null | undefined): Promise<void> {
  await act(async () => {
    (el as HTMLElement | null)?.click();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function typeInto(el: HTMLDivElement, testId: string, text: string): Promise<void> {
  const input = el.querySelector<HTMLInputElement>(`[data-testid="${testId}"]`);
  if (input === null) throw new Error(`找不到输入框 ${testId}`);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** 一个入口当前渲染出了哪些披露维度。 */
function renderedDimensions(el: HTMLDivElement, prefix: string): string[] {
  return DIMENSIONS.filter(
    (dimension) => el.querySelector(`[data-testid="${prefix}${dimension}"]`) !== null,
  );
}

/**
 * 把 5 个入口各自推进到「披露」态，返回 `{ 入口名: 渲染出的维度 }`。
 *
 * ⚠️ 每次只挂一个面板并**立即卸载** —— 五个面板在真实应用里也不共存于
 * 同一棵树，堆在一起会让定位钩子互相串。
 */
async function collectDisclosureDimensions(): Promise<Record<string, string[]>> {
  const evidence: Record<string, string[]> = {};

  // ① 拆解
  let el = mount(
    <AiBreakdown
      task={TASK}
      routing={ROUTING}
      consents={CONSENTS}
      secrets={SECRETS}
      onApplyNote={() => Promise.resolve()}
    />,
  );
  click(el.querySelector('[data-testid="ai-breakdown-t1"]'));
  evidence['AiBreakdown'] = renderedDimensions(el, 'ai-');
  act(() => root?.unmount());

  // ② 排序
  el = mount(
    <AiPrioritize
      tasks={[TASK]}
      routing={ROUTING}
      consents={CONSENTS}
      secrets={SECRETS}
      onApply={() => Promise.resolve()}
    />,
  );
  click(el.querySelector('[data-testid="prioritize-open"]'));
  evidence['AiPrioritize'] = renderedDimensions(el, 'prioritize-');
  act(() => root?.unmount());

  // ③ 估时
  el = mount(
    <AiDuration
      task={TASK}
      routing={ROUTING}
      consents={CONSENTS}
      secrets={SECRETS}
      onApply={() => Promise.resolve()}
    />,
  );
  click(el.querySelector('[data-testid="duration-run-t1"]'));
  evidence['AiDuration'] = renderedDimensions(el, 'duration-');
  act(() => root?.unmount());

  // ④ 捕获
  el = mount(
    <AiCapture
      text="明天下午三点和张总开周会"
      routing={ROUTING}
      consents={CONSENTS}
      secrets={SECRETS}
      onApply={() => Promise.resolve()}
    />,
  );
  click(el.querySelector('[data-testid="capture-ai"]'));
  evidence['AiCapture'] = renderedDimensions(el, 'capture-');
  act(() => root?.unmount());

  // ⑤ 工具调用 —— 🔴 修复前这一项缺 fallbacks 与 e2ee-warning。
  el = mount(
    <AiToolRun
      routing={ROUTING}
      consents={CONSENTS}
      grants={GRANTS}
      secrets={SECRETS}
      host={fakeHost()}
    />,
  );
  await typeInto(el, 'ai-tool-input', TOOL_TEXT);
  await clickAsync(el.querySelector('[data-testid="ai-tool-run-button"]'));
  evidence['AiToolRun'] = renderedDimensions(el, 'ai-tool-');
  act(() => root?.unmount());

  return evidence;
}

describe('🔴🔴 同一条路由解析下，5 个入口渲染同一组披露维度', () => {
  it('🔴 回退链与 E2EE 警告在**每一个**入口都必须出现', async () => {
    const evidence = await collectDisclosureDimensions();
    const expected = [...DIMENSIONS];

    // 逐入口断言，失败时直接指名道姓是哪个入口漏了哪一维。
    for (const [panel, rendered] of Object.entries(evidence)) {
      expect({ panel, missing: expected.filter((d) => !rendered.includes(d)) }).toEqual({
        panel,
        missing: [],
      });
    }

    // 再断言"五份完全相同" —— 防止某个入口**多**渲染一维而没人发现。
    expect(evidence).toEqual({
      AiBreakdown: expected,
      AiPrioritize: expected,
      AiDuration: expected,
      AiCapture: expected,
      AiToolRun: expected,
    });
  });
});
