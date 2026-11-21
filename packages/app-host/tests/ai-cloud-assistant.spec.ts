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
