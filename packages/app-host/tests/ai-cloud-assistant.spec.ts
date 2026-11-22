import { describe, expect, it } from 'vitest';

import type { AiRoutingConfig, RoutedOutcome } from '@heyta/ai';
import { LOCAL_API_TOOLS, type LocalApiConfig } from '@heyta/local-api';

import type { CloudToolTransport } from '../src/ai-cloud-tools.js';
import { requestCloudAssistantTurn } from '../src/ai-cloud-assistant.js';

const routing = {} as unknown as AiRoutingConfig;
const allGrants = () =>
  Object.fromEntries(LOCAL_API_TOOLS.map((t) => [t.name, true])) as LocalApiConfig['grants'];

function ok(toolCalls?: { id: string; name: string; arguments: string }[], text = ''): RoutedOutcome {
  return {
    result: { ok: true, suggestion: { feature: 'tool-calling', text, destination: 'user-endpoint', ...(toolCalls ? { toolCalls } : {}) } },
    attempts: [],
    health: {},
    resolution: {},
  } as unknown as RoutedOutcome;
}

describe('requestCloudAssistantTurn（整机生产函数）', () => {
  it('循环 + 路由模型 + 云端工具 一次跑通', async () => {
    const scripted: RoutedOutcome[] = [
      ok([{ id: 'c1', name: 'list_tasks', arguments: '{}' }]),
      ok(undefined, '你有 2 个任务：写周报、开会。'),
    ];
    const transport: CloudToolTransport = {
      invoke: async () => ({ ok: true, data: [{ title: '写周报' }, { title: '开会' }] }),
    };
    const result = await requestCloudAssistantTurn('我有啥任务', {
      routing,
      consents: [],
      transport,
      grants: allGrants(),
      invoke: async () => scripted.shift()!,
    });
    expect(result.text).toBe('你有 2 个任务：写周报、开会。');
    expect(result.steps).toEqual([{ tool: 'list_tasks', ok: true }]);
  });
});

describe('周报工具（Harness 层，零入口）', () => {
  it('给了 getReportState → 工具列表含 weekly_report；模型调用后聚合命中', async () => {
    let sawTools: string[] = [];
    let toolData: unknown;
    const scripted: RoutedOutcome[] = [
      ok([{ id: 'c1', name: 'weekly_report', arguments: '{}' }]),
      ok(undefined, '本周你完成了 1 个任务。'),
    ];
    // 用局部 import 避免顶层重复
    const { runCloudAgentTurn } = await import('../src/agent-harness.js');
    const { createRoutedModelCall } = await import('../src/ai-routed-model.js');
    void runCloudAgentTurn; void createRoutedModelCall;
    const result = await requestCloudAssistantTurn('写周报', {
      routing,
      consents: [],
      transport: {
        invoke: async (n) => {
          if (n === 'weekly_report') { toolData = { kind: 'weekly', completedCount: 1 }; return { ok: true, data: toolData }; }
          return { ok: true, data: [] };
        },
      },
      grants: { list_tasks: true } as never,
      invoke: async (_c, inv) => { sawTools = (inv.tools ?? []).map((t) => t.name); return scripted.shift()!; },
      getReportState: () => ({ tasks: { a: { title: 'A', completedAt: Date.now() } } }),
    });
    expect(sawTools).toContain('weekly_report');
    expect(result.steps[0]).toEqual({ tool: 'weekly_report', ok: true });
    expect(result.text).toContain('完成了');
  });
});
