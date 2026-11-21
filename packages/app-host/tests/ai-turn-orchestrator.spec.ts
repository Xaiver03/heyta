import { describe, expect, it } from 'vitest';

import type { AiRoutingConfig, RoutedOutcome } from '@heyta/ai';
import { LOCAL_API_TOOLS, type LocalApiConfig } from '@heyta/local-api';

import type { CloudToolTransport } from '../src/ai-cloud-tools.js';
import { runAiTurnWithUndo, undoLastAiTurn } from '../src/ai-turn-orchestrator.js';

const routing = {} as unknown as AiRoutingConfig;
const allGrants = () => Object.fromEntries(LOCAL_API_TOOLS.map((t) => [t.name, true])) as LocalApiConfig['grants'];

function ok(toolCalls: { id: string; name: string; arguments: string }[] | undefined, text: string): RoutedOutcome {
  return {
    result: { ok: true, suggestion: { feature: 'tool-calling', text, destination: 'user-endpoint', ...(toolCalls ? { toolCalls } : {}) } },
    attempts: [],
    health: {},
    resolution: {},
  } as unknown as RoutedOutcome;
}

describe('runAiTurnWithUndo（壳编排：记录 seq → 跑一轮 → 可撤销）', () => {
  it('运行前取 seq、运行带 runId（作幂等键）、可撤销该段', async () => {
    const idem: (string | undefined)[] = [];
    const transport: CloudToolTransport = {
      invoke: async (_n, _a, _s, opts) => {
        idem.push(opts?.idempotencyKey);
        return { ok: true, data: [{ title: 'A' }] };
      },
    };
    const scripted: RoutedOutcome[] = [ok([{ id: 'c1', name: 'list_tasks', arguments: '{}' }], ''), ok(undefined, '你有1个任务：A')];
    let undone: number | undefined;
    const undo = {
      getSeq: async () => 42,
      undoSince: async (s: number) => {
        undone = s;
        return { status: 'applied', applied: ['op'] };
      },
    };

    const result = await runAiTurnWithUndo('我有啥任务', {
      routing,
      consents: [],
      transport,
      grants: allGrants(),
      invoke: async () => scripted.shift()!,
      undo,
      runId: 'run-x',
    });

    expect(result.seqBefore).toBe(42);
    expect(result.runId).toBe('run-x');
    expect(result.turn.text).toBe('你有1个任务：A');
    // 幂等键用 runId 前缀
    expect(idem[0]).toBe('run-x:s0:c1');

    await undoLastAiTurn({ undo }, result.seqBefore);
    expect(undone).toBe(42);
  });
});
