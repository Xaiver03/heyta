import { describe, expect, it, vi } from 'vitest';

import type { AppHost } from '@heyta/app-host';
import { WIDGET_INTENT_VERSION, type WidgetIntentQueue } from '@heyta/widget-core';

import {
  drainWidgetIntentsNow,
  runWidgetDrain,
  type WidgetDrainPorts,
} from '../src/widgets/drain';

/**
 * drain 闭环的测试。
 *
 * ⚠️ 本文件**刻意不 import `react-native`**（在 node 里加载它直接失败），
 * 所以 [runWidgetDrain] 的外部动作（读队列、写回）是**注入**的。
 * 只有最后一条测的是薄壳 [drainWidgetIntentsNow]。
 */

function queueJson(intents: Array<{ taskId: string; targetIsDone: boolean; at?: number }>): string {
  return JSON.stringify({
    v: WIDGET_INTENT_VERSION,
    intents: intents.map((i) => ({ at: 1, ...i })),
  });
}

const EMPTY: WidgetIntentQueue = { v: WIDGET_INTENT_VERSION, intents: [] };

function ports(over: Partial<WidgetDrainPorts> = {}): WidgetDrainPorts {
  return {
    drain: async () => null,
    merge: async () => 0,
    ...over,
  };
}

interface ApplyResult {
  applied: number;
  skippedAlreadyInTarget: number;
  skippedMissing: number;
  remaining: WidgetIntentQueue;
}

function applied(remaining: WidgetIntentQueue = EMPTY): ApplyResult {
  return { applied: 1, skippedAlreadyInTarget: 0, skippedMissing: 0, remaining };
}

describe('runWidgetDrain', () => {
  it('容器里没有队列时返回 null，并且不去动物化状态', async () => {
    const apply = vi.fn(async () => applied());
    expect(await runWidgetDrain(ports(), apply)).toBeNull();
    expect(apply).not.toHaveBeenCalled();
  });

  it('队列是空数组时同样返回 null（不产生一次无谓的读状态）', async () => {
    const apply = vi.fn(async () => applied());
    const result = await runWidgetDrain(
      ports({ drain: async () => queueJson([]) }),
      apply,
    );
    expect(result).toBeNull();
    expect(apply).not.toHaveBeenCalled();
  });

  it('把解析后的队列交给 apply（不是原始字符串）', async () => {
    const seen: WidgetIntentQueue[] = [];
    await runWidgetDrain(
      ports({ drain: async () => queueJson([{ taskId: 't1', targetIsDone: true }]) }),
      async (queue) => {
        seen.push(queue);
        return applied();
      },
    );

    expect(seen).toHaveLength(1);
    expect(seen[0].intents).toEqual([{ taskId: 't1', targetIsDone: true, at: 1 }]);
  });

  it('坏 JSON 降级成空队列（不抛，也不把垃圾交给 apply）', async () => {
    const apply = vi.fn(async () => applied());
    expect(await runWidgetDrain(ports({ drain: async () => '{ 不是 JSON' }), apply)).toBeNull();
    expect(apply).not.toHaveBeenCalled();
  });

  it('全部成功时不写回（不做多余的原生调用）', async () => {
    const merge = vi.fn(async () => 0);
    const summary = await runWidgetDrain(
      ports({ drain: async () => queueJson([{ taskId: 't1', targetIsDone: true }]), merge }),
      async () => applied(),
    );

    expect(summary).toEqual({
      applied: 1,
      skippedAlreadyInTarget: 0,
      skippedMissing: 0,
      requeued: 0,
      lost: 0,
    });
    expect(merge).not.toHaveBeenCalled();
  });

  it('🔴 有失败时把 remaining 写回，内容是 remaining 的 JSON', async () => {
    const failedQueue: WidgetIntentQueue = {
      v: WIDGET_INTENT_VERSION,
      intents: [{ taskId: 't_bad', targetIsDone: true, at: 7 }],
    };
    const merge = vi.fn(async () => 1);

    const summary = await runWidgetDrain(
      ports({ drain: async () => queueJson([{ taskId: 't_bad', targetIsDone: true }]), merge }),
      async () => ({ ...applied(), applied: 0, remaining: failedQueue }),
    );

    expect(merge).toHaveBeenCalledTimes(1);
    // 🔴 写回的必须是 `remaining`，**不是**刚 drain 出来的那个队列 ——
    //    后者会把已经成功执行的那些又放回去，于是每次 drain 都重做一遍。
    expect(JSON.parse(merge.mock.calls[0][0])).toEqual(failedQueue);
    expect(summary?.requeued).toBe(1);
    expect(summary?.lost).toBe(0);
  });

  it('🔴 写回失败时如实报告 lost，而不是假装成功', async () => {
    const merge = vi.fn(async () => null);

    const summary = await runWidgetDrain(
      ports({ drain: async () => queueJson([{ taskId: 't_bad', targetIsDone: true }]), merge }),
      async () => ({
        ...applied(),
        applied: 0,
        remaining: {
          v: WIDGET_INTENT_VERSION,
          intents: [{ taskId: 't_bad', targetIsDone: true, at: 1 }],
        },
      }),
    );

    // 这几条意图已经随 drain 从容器里清掉了，写不回去就真的没有下次。
    // 把 lost 报成 0 会让"用户的点击丢了"这件事在日志里看不见。
    expect(summary?.lost).toBe(1);
    expect(summary?.requeued).toBe(0);
  });

  it('跳过的也要计数（诊断"为什么点了没反应"靠它）', async () => {
    const summary = await runWidgetDrain(
      ports({ drain: async () => queueJson([{ taskId: 't1', targetIsDone: true }]) }),
      async () => ({
        applied: 0,
        skippedAlreadyInTarget: 1,
        skippedMissing: 2,
        remaining: EMPTY,
      }),
    );

    expect(summary).toEqual({
      applied: 0,
      skippedAlreadyInTarget: 1,
      skippedMissing: 2,
      requeued: 0,
      lost: 0,
    });
  });

  it('apply 抛异常时**不吞**（吞异常是 drainWidgetIntentsNow 的职责）', async () => {
    await expect(
      runWidgetDrain(
        ports({ drain: async () => queueJson([{ taskId: 't1', targetIsDone: true }]) }),
        async () => {
          throw new Error('库锁着');
        },
      ),
    ).rejects.toThrow('库锁着');
  });
});

describe('drainWidgetIntentsNow', () => {
  it('🔴 宿主坏掉时也不向外抛（它挂在应用启动路径上）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      // 一个取状态就炸的宿主 —— 模拟"数据库打不开"。
      const brokenHost = {
        engine: {
          getState: () => {
            throw new Error('数据库打不开');
          },
        },
      } as unknown as AppHost;

      await expect(drainWidgetIntentsNow(brokenHost)).resolves.toBeNull();
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
