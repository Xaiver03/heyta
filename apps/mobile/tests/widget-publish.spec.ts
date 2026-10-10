import { describe, expect, it, vi } from 'vitest';

import { parseLocalDate, type Task } from '@heyta/domain';

import {
  __resetWidgetPublishForTests,
  beginWidgetCleanup,
  planWidgetPublish,
  publishWidgetSnapshot,
  runWidgetPublish,
  type WidgetPublishDeps,
  type WidgetPublishOutcome,
  type WidgetPublishSource,
  type WidgetPublishStateSlice,
} from '../src/widgets/publish';
import { clearWidgetState } from '../src/widgets/widget-bridge';
import { isWidgetPublishBlocked } from '../src/widgets/publish-coordinator';

/**
 * 发布管线的测试。
 *
 * ⚠️ 本文件**刻意不 import `react-native`**（在 node 里加载它直接失败），
 * 所以 [planWidgetPublish] / [runWidgetPublish] / [publishWidgetSnapshot]
 * 都设计成不碰原生的形状 —— 副作用（封包、写盘）是**注入**的。
 * 这也是为什么 `publish.ts` 里没有任何一行 import RN。
 *
 * ⚠️ `../src/widgets/publish` **不带扩展名**：移动端本地模块一律如此
 * （写成 `.js` 时 vitest 会映射回 `.ts`、单测照样绿，而 Metro 不会，Release 打包直接失败）。
 */


function task(over: Partial<Task> = {}): Task {
  return {
    id: 't1',
    title: '写周报',
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

function slice(tasks: Task[] = []): WidgetPublishStateSlice {
  return {
    tasks: Object.fromEntries(tasks.map((t) => [t.id, t])),
    projects: {},
    habits: {},
    habitLogs: {},
  };
}

// ─────────────────────────────────────────────────────────────
// planWidgetPublish —— 纯函数那半
// ─────────────────────────────────────────────────────────────

describe('planWidgetPublish', () => {
  it('dayStr 是应用算出的本地日期，不是别的东西', () => {
    const now = parseLocalDate('2026-09-27').getTime() + 9 * 60 * 60 * 1000; // 09:00
    expect(planWidgetPublish({ state: slice(), now }).dayStr).toBe('2026-09-27');
  });

  it('🔴 validUntil 恰好是下一个本地零点', () => {
    const now = parseLocalDate('2026-09-27').getTime() + 9 * 60 * 60 * 1000;
    const plan = planWidgetPublish({ state: slice(), now });

    // 与组件侧的过期判据是**同一个时刻**：过了零点组件自己就会显示"数据已过期"，
    // 不需要应用在那时还活着。
    expect(plan.validUntil).toBe(parseLocalDate('2026-09-28').getTime());
  });

  it('🔴 跨零点前一刻发布，validUntil 仍然是**明天**的零点（不是加 24 小时）', () => {
    // 23:59:59.500 —— 若实现写成 `now + 24h`，这里会算出"明天 23:59:59.5"，
    // 于是今天的快照在明天一整天都被认为"还没过期"，组件会显示**昨天的任务**。
    const now = parseLocalDate('2026-09-28').getTime() - 500;
    const plan = planWidgetPublish({ state: slice(), now });

    expect(plan.dayStr).toBe('2026-09-27');
    expect(plan.validUntil).toBe(parseLocalDate('2026-09-28').getTime());
    expect(plan.validUntil - now).toBeLessThan(1000);
  });

  it('载荷里含今天该做的任务', () => {
    const now = parseLocalDate('2026-09-27').getTime() + 9 * 60 * 60 * 1000;
    const plan = planWidgetPublish({
      state: slice([task({ id: 't_today', title: '交房租', dueDate: now })]),
      now,
    });

    expect(plan.payload.today.map((t) => t.id)).toContain('t_today');
    expect(plan.payloadJson).toContain('交房租');
  });

  it('没有今天该做的任务时载荷是"合法的空"，不是 null', () => {
    const now = parseLocalDate('2026-09-27').getTime() + 9 * 60 * 60 * 1000;
    const plan = planWidgetPublish({ state: slice(), now });

    // 这与"读不到密钥"必须是两种状态 —— 这里代表"确实没有任务"。
    expect(plan.payload.today).toEqual([]);
    expect(plan.payloadJson).toContain('"today"');
  });

  it('payloadJson 是载荷的 JSON（不是别的对象的）', () => {
    const now = parseLocalDate('2026-09-27').getTime();
    const plan = planWidgetPublish({ state: slice(), now });
    expect(JSON.parse(plan.payloadJson)).toEqual(plan.payload);
  });
});

// ─────────────────────────────────────────────────────────────
// runWidgetPublish —— 顺序与失败
// ─────────────────────────────────────────────────────────────

describe('runWidgetPublish', () => {
  const now = parseLocalDate('2026-09-27').getTime() + 9 * 60 * 60 * 1000;
  const plan = planWidgetPublish({ state: slice(), now });

  it('先封包、后写盘，并且写的是封包的结果', async () => {
    const calls: string[] = [];
    const deps: WidgetPublishDeps = {
      seal: async (payloadJson, dayStr, validUntil) => {
        calls.push(`seal:${dayStr}:${validUntil}`);
        expect(payloadJson).toBe(plan.payloadJson);
        return '{"v":1}';
      },
      write: async (envelopeJson) => {
        calls.push(`write:${envelopeJson}`);
        return true;
      },
    };

    expect(await runWidgetPublish(plan, deps)).toBe<WidgetPublishOutcome>('published');
    expect(calls).toEqual([`seal:${plan.dayStr}:${plan.validUntil}`, 'write:{"v":1}']);
  });

  it('🔴 封包失败时**根本不写盘**（否则容器里会留下一份"合法的空快照"）', async () => {
    const write = vi.fn(async () => true);
    const outcome = await runWidgetPublish(plan, {
      seal: async () => null,
      write,
    });

    expect(outcome).toBe<WidgetPublishOutcome>('seal-failed');
    // 这一条是关键：写下一份空信封会让组件显示 **"今天没有任务"**，
    // 而真相是"还没发布成功" —— 那是在骗用户。
    expect(write).not.toHaveBeenCalled();
  });

  it('写盘被拒时返回 write-rejected（与封包失败区分开）', async () => {
    expect(
      await runWidgetPublish(plan, { seal: async () => '{"v":1}', write: async () => false }),
    ).toBe<WidgetPublishOutcome>('write-rejected');
  });

  it('封包抛异常时**不吞**（吞异常是 publishWidgetSnapshot 的职责）', async () => {
    await expect(
      runWidgetPublish(plan, {
        seal: async () => {
          throw new Error('Keystore 不可用');
        },
        write: async () => true,
      }),
    ).rejects.toThrow('Keystore 不可用');
  });
});

// ─────────────────────────────────────────────────────────────
// publishWidgetSnapshot —— 合并与"永不抛"
// ─────────────────────────────────────────────────────────────

/** 可以手动控制"什么时候完成"的封包，用来把并发窗口撑开。 */
function deferredSeal() {
  let release: (() => void) | null = null;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const sealed: string[] = [];
  const seal = async (payloadJson: string): Promise<string> => {
    await gate;
    sealed.push(payloadJson);
    return '{"v":1}';
  };
  return { seal, sealed, release: () => release?.() };
}

describe('publishWidgetSnapshot 的合并', () => {
  const now = parseLocalDate('2026-09-27').getTime() + 9 * 60 * 60 * 1000;

  it('🔴 并发调用只跑一轮，且**补跑一次**（不丢最后一次写入）', async () => {
    __resetWidgetPublishForTests();

    const { seal, sealed, release } = deferredSeal();
    const write = vi.fn(async () => true);
    const source: WidgetPublishSource = { read: () => ({ state: slice([task()]) }) };

    // 三次调用挤在一起（模拟连续勾选）。
    const first = publishWidgetSnapshot(source, { seal, write });
    const second = publishWidgetSnapshot(source, { seal, write });
    const third = publishWidgetSnapshot(source, { seal, write });

    release();
    await Promise.all([first, second, third]);

    // 合并成 1 轮 + 1 次补跑 = 2 次；**不是** 3 次。
    expect(sealed).toHaveLength(2);
    expect(write).toHaveBeenCalledTimes(2);
    // 补跑那一轮必须**重读**状态（见下一条）。
    expect(sealed[0]).toBe(sealed[1]);
  });

  it('🔴 补跑时重读状态，而不是用首次捕获的那份', async () => {
    __resetWidgetPublishForTests();

    const { seal, sealed, release } = deferredSeal();
    const write = vi.fn(async () => true);

    // 第一次读给 t_old，之后的读给 t_new —— 模拟"发布期间用户又改了一次"。
    let reads = 0;
    const source: WidgetPublishSource = {
      read: () => {
        reads += 1;
        return { state: slice([task({ id: reads === 1 ? 't_old' : 't_new' })]) };
      },
    };

    const first = publishWidgetSnapshot(source, { seal, write });
    const second = publishWidgetSnapshot(source, { seal, write });

    release();
    await Promise.all([first, second]);

    expect(sealed).toHaveLength(2);
    expect(sealed[0]).toContain('t_old');
    // 若补跑用了捕获的旧值，这里会是 t_old —— 而用户刚改的那次就**丢了**，
    // 症状是"刚勾的那条在组件上没变，下次别的写入一来又好了"。
    expect(sealed[1]).toContain('t_new');
  });

  it('跑完之后状态复位（下一次调用会真的重新跑）', async () => {
    __resetWidgetPublishForTests();

    const seal = vi.fn(async () => '{"v":1}');
    const write = vi.fn(async () => true);
    const source: WidgetPublishSource = { read: () => ({ state: slice() }) };

    await publishWidgetSnapshot(source, { seal, write });
    await publishWidgetSnapshot(source, { seal, write });

    expect(seal).toHaveBeenCalledTimes(2);
  });

  it('🔴 封包抛异常时**不向外抛**（写入已经成功，小组件的问题不该影响用户）', async () => {
    __resetWidgetPublishForTests();

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await expect(
        publishWidgetSnapshot(
          { read: () => ({ state: slice() }) },
          {
            seal: async () => {
              throw new Error('boom');
            },
            write: async () => true,
          },
        ),
      ).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('原生模块不可用时只记日志，不抛', async () => {
    __resetWidgetPublishForTests();

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await expect(
        publishWidgetSnapshot(
          { read: () => ({ state: slice() }) },
          { seal: async () => null, write: async () => false },
        ),
      ).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('seal-failed'));
    } finally {
      warn.mockRestore();
    }
  });

  it('一次发布失败之后状态仍会复位（不会永久卡住）', async () => {
    __resetWidgetPublishForTests();

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const source: WidgetPublishSource = { read: () => ({ state: slice() }) };
      await publishWidgetSnapshot(source, {
        seal: async () => {
          throw new Error('第一次失败');
        },
        write: async () => true,
      });

      // 第二次用一个正常的封包器 —— 若 `inFlight` 没在 finally 里复位，这里会**直接返回**，
      // 于是这条断言守住的是"失败不会让管线永久卡死"。
      const seal = vi.fn(async () => '{"v":1}');
      await publishWidgetSnapshot(source, { seal, write: async () => true });
      expect(seal).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('清理开始后，seal 完成也不能把旧快照写回', async () => {
    __resetWidgetPublishForTests();

    const { seal, release } = deferredSeal();
    const write = vi.fn(async () => true);
    const publishing = publishWidgetSnapshot(
      { read: () => ({ state: slice([task()]) }) },
      { seal, write },
    );

    const cleanup = beginWidgetCleanup();
    release();
    const lease = await cleanup;
    await publishing;

    expect(write).not.toHaveBeenCalled();
    lease.release(true);
  });

  it('清理等待在途 write 完成后才调用原生删除', async () => {
    __resetWidgetPublishForTests();

    let releaseWrite: (() => void) | undefined;
    const writeStarted = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const write = vi.fn(async () => {
      await writeStarted;
      return true;
    });
    const publishing = publishWidgetSnapshot(
      { read: () => ({ state: slice([task()]) }) },
      { seal: async () => '{"v":1}', write },
    );

    // 等到 publish 已经进入 native write，再开始清理。
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    let nativeClearCalls = 0;
    const clearing = clearWidgetState({
      clearWidgetState: async () => {
        nativeClearCalls += 1;
        return true;
      },
    });
    await Promise.resolve();
    expect(nativeClearCalls).toBe(0);

    releaseWrite?.();
    await Promise.all([publishing, clearing]);
    expect(nativeClearCalls).toBe(1);
  });

  it('原生清理失败后保持发布屏障，不能自动恢复旧快照', async () => {
    __resetWidgetPublishForTests();

    await expect(
      clearWidgetState({ clearWidgetState: async () => false }),
    ).rejects.toThrow('could not be cleared');

    const seal = vi.fn(async () => '{"v":1}');
    await publishWidgetSnapshot(
      { read: () => ({ state: slice([task()]) }) },
      { seal, write: async () => true },
    );
    expect(seal).not.toHaveBeenCalled();
  });

  it('重叠清理中先完成的成功不能提前解除仍在途的清理屏障', async () => {
    __resetWidgetPublishForTests();

    const first = await beginWidgetCleanup();
    const second = await beginWidgetCleanup();
    first.release(true);

    // 第二个清理仍未完成，发布必须继续被挡住；旧快照不能趁空档写回。
    expect(isWidgetPublishBlocked()).toBe(true);
    const seal = vi.fn(async () => '{"v":1}');
    await publishWidgetSnapshot(
      { read: () => ({ state: slice([task()]) }) },
      { seal, write: async () => true },
    );
    expect(seal).not.toHaveBeenCalled();

    second.release(true);
    expect(isWidgetPublishBlocked()).toBe(false);
    await publishWidgetSnapshot(
      { read: () => ({ state: slice([task()]) }) },
      { seal, write: async () => true },
    );
    expect(seal).toHaveBeenCalledTimes(1);
  });

  it('重叠清理中后完成的失败会保持屏障，直到下一次显式成功清理', async () => {
    __resetWidgetPublishForTests();

    const first = await beginWidgetCleanup();
    const second = await beginWidgetCleanup();
    first.release(true);
    second.release(false);

    expect(isWidgetPublishBlocked()).toBe(true);
    const seal = vi.fn(async () => '{"v":1}');
    const source: WidgetPublishSource = {
      read: () => ({ state: slice([task()]) }),
    };
    await publishWidgetSnapshot(source, { seal, write: async () => true });
    expect(seal).not.toHaveBeenCalled();

    // 只有失败发生之后开始的显式成功清理，才有资格解除失败闸门。
    const recovery = await beginWidgetCleanup();
    recovery.release(true);
    expect(isWidgetPublishBlocked()).toBe(false);
    await publishWidgetSnapshot(source, { seal, write: async () => true });
    expect(seal).toHaveBeenCalledTimes(1);
  });
  it('失败之前已开始的后编号清理不能解除失败屏障', async () => {
    __resetWidgetPublishForTests();
    const first = await beginWidgetCleanup();
    const second = await beginWidgetCleanup();
    first.release(false);
    second.release(true);
    expect(isWidgetPublishBlocked()).toBe(true);
    const recovery = await beginWidgetCleanup();
    recovery.release(true);
    expect(isWidgetPublishBlocked()).toBe(false);
  });

});
