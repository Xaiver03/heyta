/**
 * AI 工具调用面板测试
 * ======================
 *
 * 钉住两条**产品承诺**（其余是它们的展开）：
 *
 *   1. 🔴 **规则命中时一个字节都不发** —— 直接出结果，且**不显示披露**。
 *      显示披露会是在撒谎（没有数据出去）。
 *   2. 🔴 **模型路径先披露、再发送**，且披露里必须出现 `tools`
 *      （工具目录也是出境数据）。
 *
 * ⚠️ 全程走真实链路：真 `requestToolCall` + 真 `runSelectedTool`，
 * 只注入两个边界 —— 工具宿主（进程内端口）与 `fetch`（HTTP 边界）。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { I18nProvider, en, zhCN } from '@heyta/i18n';
import type { AiRoutingConfig } from '@heyta/ai';
import type { LocalApiConfig, LocalApiHost, LocalApiItem } from '@heyta/local-api';

import { AiToolRun } from '../src/features/ai/AiToolRun.js';

const ROUTING: AiRoutingConfig = {
  enabled: true,
  allowRemote: false,
  endpoints: [
    {
      id: 'local-tools',
      label: '本机（支持工具调用）',
      endpoint: 'http://localhost:11434/v1',
      model: 'qwen3:8b',
      capabilities: ['structured_output', 'tool_calling'],
    },
  ],
  routes: { 'tool-calling': [{ endpointId: 'local-tools' }] },
};

const READ_GRANTS = { list_tasks: true, create_task: true } as const;

const secrets = { get: () => Promise.resolve(undefined) };

function fakeHost(): LocalApiHost & { submits: number } {
  const items: readonly LocalApiItem[] = [{ id: 't1', title: '买牛奶', readable: true }];
  const host = {
    submits: 0,
    listTasks: () => Promise.resolve(items),
    getTask: () => Promise.resolve(items[0]),
    listProjects: () => Promise.resolve([]),
    submit: () => {
      host.submits += 1;
      return Promise.resolve({ ok: true as const, taskId: 'created-1' });
    },
  };
  return host;
}

let container: HTMLDivElement | undefined;
let root: Root | undefined;

async function render(overrides: {
  host: LocalApiHost;
  fetchImpl?: typeof fetch;
  /** 默认 zh-CN；英文那一组用例专门传 `'en'`（见"不许露中文"那条）。 */
  locale?: 'zh-CN' | 'en';
  /** 已授权工具范围。默认 `READ_GRANTS`；传 `{}` 用来走 `no-granted-tools`。 */
  grants?: LocalApiConfig['grants'];
}): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <I18nProvider locale={overrides.locale ?? 'zh-CN'}>
        <AiToolRun
          routing={ROUTING}
          consents={[]}
          grants={overrides.grants ?? READ_GRANTS}
          secrets={secrets}
          host={overrides.host}
          {...(overrides.fetchImpl === undefined ? {} : { fetchImpl: overrides.fetchImpl })}
        />
      </I18nProvider>,
    );
  });
  return container;
}

/** React 受控输入：必须走原生 setter，否则 onChange 收不到。 */
async function type(el: HTMLDivElement, text: string): Promise<void> {
  const input = el.querySelector<HTMLInputElement>('[data-testid="ai-tool-input"]');
  if (input === null) throw new Error('找不到输入框');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function click(el: HTMLDivElement, testId: string): Promise<void> {
  const button = el.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  if (button === null) throw new Error(`找不到 ${testId}`);
  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  container = undefined;
  root = undefined;
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
});

describe('规则路径：不出境', () => {
  it('🔴 规则命中 → 直接出结果，**没有披露面板**，且 fetch 一次都没调', async () => {
    let fetched = 0;
    const fetchImpl = (() => {
      fetched += 1;
      return Promise.reject(new Error('规则路径不该发请求'));
    }) as unknown as typeof fetch;

    const host = fakeHost();
    const el = await render({ host, fetchImpl });
    await type(el, '列出所有任务');
    await click(el, 'ai-tool-run-button');

    expect(el.querySelector('[data-testid="ai-tool-disclosure"]')).toBeNull();
    expect(el.querySelector('[data-testid="ai-tool-observation"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="ai-tool-via"]')?.textContent).toContain('没有联网');
    expect(fetched).toBe(0);
    expect(host.submits).toBe(0);
  });
});

describe('模型路径：先披露再发送', () => {
  it('🔴 需要模型时先显示披露，且字段里有 tools', async () => {
    const el = await render({ host: fakeHost() });
    await type(el, '帮我看看下周三评审要准备什么');
    await click(el, 'ai-tool-run-button');

    const disclosure = el.querySelector('[data-testid="ai-tool-disclosure"]');
    expect(disclosure).not.toBeNull();
    expect(disclosure?.textContent).toContain('tools');
  });

  it('发送后模型选中只读工具 → 渲染结果，请求体带 tools', async () => {
    let body: Record<string, unknown> | undefined;
    const fetchImpl = ((_url: unknown, init?: { body?: unknown }) => {
      body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: [
                    { id: 'c1', function: { name: 'list_tasks', arguments: '{}' } },
                  ],
                },
              },
            ],
          }),
      });
    }) as unknown as typeof fetch;

    const el = await render({ host: fakeHost(), fetchImpl });
    await type(el, '帮我看看下周三评审要准备什么');
    await click(el, 'ai-tool-run-button');
    await click(el, 'ai-tool-send');

    expect(body?.['tools']).toBeDefined();
    expect(el.querySelector('[data-testid="ai-tool-observation"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="ai-tool-via"]')?.textContent).toContain('模型');
  });

  it('🔴 模型选中写工具 → 出提案，确认前 submit 为 0', async () => {
    const fetchImpl = (() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: [
                    { id: 'c1', function: { name: 'create_task', arguments: '{"title":"写周报"}' } },
                  ],
                },
              },
            ],
          }),
      })) as unknown as typeof fetch;

    const host = fakeHost();
    const el = await render({ host, fetchImpl });
    await type(el, '帮我记一下写周报这件事');
    await click(el, 'ai-tool-run-button');
    await click(el, 'ai-tool-send');

    expect(el.querySelector('[data-testid="ai-tool-proposal"]')?.textContent).toContain('写周报');
    expect(host.submits).toBe(0);

    await click(el, 'ai-tool-confirm');
    expect(host.submits).toBe(1);
    expect(el.querySelector('[data-testid="ai-tool-confirmed"]')).not.toBeNull();
  });
});

describe('🔴 第 5 个入口的失败文案（与其他四个面板同一处置）', () => {
  it('英文界面失败时**一个汉字都不许有**：主句取词条，原文只进折叠的技术详情', async () => {
    /*
      这一条钉的是一个**真实存在过的缺陷**：`AiToolRun` 一直把
      `outcome.message`（`packages/app-host` 拼好的中文）整句渲染成主文案 ——
      另外四个面板早改成"按 reason 取词条"了，唯独这第 5 个入口漏了。
      于是**英文界面上工具调用一失败，那一屏整句是中文**。

      `no-granted-tools` 是最好的用例：它**不需要端点、不需要 fetch**，
      在规则选择那一步就返回（一个工具都没授权）—— 完全确定性。
    */
    const el = await render({ host: fakeHost(), locale: 'en', grants: {} });
    await type(el, '把这段话翻译一下');
    // 规则没命中 → 先出披露；`no-granted-tools` 是在**真的走一遍**之后才回来的
    // （`run()` 只负责"要不要出境"，失败判定在 `requestToolCall()` 里）。
    await click(el, 'ai-tool-run-button');
    await click(el, 'ai-tool-send');

    const message = el.querySelector('[data-testid="ai-tool-failure-message"]')?.textContent ?? '';
    // ① 主句必须**逐字**是词条表里那句（不是"能读懂就行"）。
    expect(message).toBe(en['web.ai.tools.failure.noGrantedTools']);
    // ② 全屏不许出现汉字 —— 这条比 ① 更宽，抓的是"换了一条中文进来"。
    const panel = el.querySelector('[data-testid="ai-tool-failure"]')?.textContent ?? '';
    expect(panel).not.toMatch(/[\u4e00-\u9fff]/u);
  });

  it('中文界面仍然用中文那条（词条表是唯一事实源）', async () => {
    const el = await render({ host: fakeHost(), grants: {} });
    await type(el, '把这段话翻译一下');
    // 规则没命中 → 先出披露；`no-granted-tools` 是在**真的走一遍**之后才回来的
    // （`run()` 只负责"要不要出境"，失败判定在 `requestToolCall()` 里）。
    await click(el, 'ai-tool-run-button');
    await click(el, 'ai-tool-send');
    expect(el.querySelector('[data-testid="ai-tool-failure-message"]')?.textContent).toBe(
      zhCN['web.ai.tools.failure.noGrantedTools'],
    );
  });
});
