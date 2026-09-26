import { describe, expect, it } from 'vitest';
import {
  computeFocusGaps,
  computeTaskMemory,
  describeFocusGaps,
  type MemoryInput,
  type MemoryOp,
  type MemoryTask,
} from '../src/memory.js';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 26); // 2026-09-26

function task(over: Partial<MemoryTask> & { id: string }): MemoryTask {
  return {
    title: `任务 ${over.id}`,
    createdAt: NOW - 30 * DAY,
    updatedAt: NOW - 5 * DAY,
    ...over,
  };
}

/** 造一条 TASK 的 UPD。 */
function upd(taskId: string, ts: number, dueDate: number | null): MemoryOp {
  return {
    opType: 'UPD',
    entityType: 'TASK',
    entityId: taskId,
    payload: { dueDate },
    timestamp: ts,
  };
}

/** 造一条 TASK 的 CRT。 */
function crt(taskId: string, ts: number, dueDate?: number): MemoryOp {
  return {
    opType: 'CRT',
    entityType: 'TASK',
    entityId: taskId,
    payload: dueDate === undefined ? { title: 'x' } : { title: 'x', dueDate },
    timestamp: ts,
  };
}

function input(over: Partial<MemoryInput>): MemoryInput {
  return { tasks: [], focusSessions: [], operations: [], now: NOW, ...over };
}

describe('记忆层：推迟次数只能从事件流算出来', () => {
  /**
   * 🔴 这是本模块**存在的理由**，也是最该被钉住的一条。
   *
   * 同一个任务，物化状态里只有"当前截止 = 10 天后"。
   * 「被推过 2 次」这个事实**在状态里根本不存在** —— 它只在历史里。
   */
  it('🔴 状态里有 dueDate，但「推过几次」只在事件流里', () => {
    const t = task({ id: 'a', dueDate: NOW + 10 * DAY });

    // 只有状态、没有历史 → 算不出推迟
    const withoutHistory = computeTaskMemory(input({ tasks: [t] }));
    expect(withoutHistory[0]?.postponements).toBe(0);

    // 补上历史 → 推迟 2 次
    const withHistory = computeTaskMemory(
      input({
        tasks: [t],
        operations: [
          crt('a', NOW - 20 * DAY, NOW + 2 * DAY),
          upd('a', NOW - 15 * DAY, NOW + 5 * DAY), // 推后 → 1
          upd('a', NOW - 10 * DAY, NOW + 10 * DAY), // 推后 → 2
        ],
      }),
    );
    expect(withHistory[0]?.postponements).toBe(2);
    expect(withHistory[0]?.lastPostponedAt).toBe(NOW - 10 * DAY);
  });

  /**
   * 🔴 「第一次排期」不是「推迟」。
   *
   * 从"没有截止"到"设了个截止"是**排期**。若把它记成推迟，
   * 每条新任务只要带个截止日期就会被冤枉成"拖延过一次"。
   */
  it('🔴 从「无截止」到「有截止」是排期，不是推迟', () => {
    const t = task({ id: 'a', dueDate: NOW + 3 * DAY });
    const m = computeTaskMemory(
      input({
        tasks: [t],
        operations: [crt('a', NOW - 5 * DAY), upd('a', NOW - 4 * DAY, NOW + 3 * DAY)],
      }),
    );
    expect(m[0]?.postponements).toBe(0);
  });

  it('把截止日期改早不算推迟', () => {
    const t = task({ id: 'a', dueDate: NOW + 1 * DAY });
    const m = computeTaskMemory(
      input({
        tasks: [t],
        operations: [
          crt('a', NOW - 5 * DAY, NOW + 5 * DAY),
          upd('a', NOW - 4 * DAY, NOW + 1 * DAY), // 提前
        ],
      }),
    );
    expect(m[0]?.postponements).toBe(0);
  });

  it('把截止日期清掉（null）不算推迟，且之后重新设日期也不算', () => {
    const t = task({ id: 'a', dueDate: NOW + 2 * DAY });
    const m = computeTaskMemory(
      input({
        tasks: [t],
        operations: [
          crt('a', NOW - 9 * DAY, NOW + 9 * DAY),
          upd('a', NOW - 8 * DAY, null), // 清除
          upd('a', NOW - 7 * DAY, NOW + 2 * DAY), // 重新排期，不是推迟
        ],
      }),
    );
    expect(m[0]?.postponements).toBe(0);
  });

  it('累计推后时长 = 每次增量的和', () => {
    const t = task({ id: 'a', dueDate: NOW + 10 * DAY });
    const m = computeTaskMemory(
      input({
        tasks: [t],
        operations: [
          crt('a', NOW - 20 * DAY, NOW + 2 * DAY),
          upd('a', NOW - 15 * DAY, NOW + 5 * DAY), // +3d
          upd('a', NOW - 10 * DAY, NOW + 10 * DAY), // +5d
        ],
      }),
    );
    expect(m[0]?.postponedTotalMs).toBe(8 * DAY);
  });

  it('只统计 TASK 实体（其他实体的 dueDate 变动不算）', () => {
    const t = task({ id: 'a', dueDate: NOW + 5 * DAY });
    const m = computeTaskMemory(
      input({
        tasks: [t],
        operations: [
          crt('a', NOW - 9 * DAY, NOW + 1 * DAY),
          {
            opType: 'UPD',
            entityType: 'PROJECT',
            entityId: 'a',
            payload: { dueDate: NOW + 90 * DAY },
            timestamp: NOW - 8 * DAY,
          },
          upd('a', NOW - 7 * DAY, NOW + 5 * DAY), // 唯一一次真推迟
        ],
      }),
    );
    expect(m[0]?.postponements).toBe(1);
  });

  it('乱序到达的事件流也能算对（按 timestamp 重放，不依赖数组顺序）', () => {
    const t = task({ id: 'a', dueDate: NOW + 10 * DAY });
    const ops = [
      upd('a', NOW - 10 * DAY, NOW + 10 * DAY),
      crt('a', NOW - 20 * DAY, NOW + 2 * DAY),
      upd('a', NOW - 15 * DAY, NOW + 5 * DAY),
    ];
    expect(computeTaskMemory(input({ tasks: [t], operations: ops }))[0]?.postponements).toBe(2);
  });
});

describe('记忆层：其他派生事实', () => {
  it('逾期天数：未完成 + 有截止 + 已过', () => {
    const m = computeTaskMemory(
      input({ tasks: [task({ id: 'a', dueDate: NOW - 3 * DAY })] }),
    );
    expect(m[0]?.overdueDays).toBe(3);
  });

  it('已完成的任务不算逾期', () => {
    const m = computeTaskMemory(
      input({
        tasks: [task({ id: 'a', dueDate: NOW - 3 * DAY, completedAt: NOW - 2 * DAY })],
      }),
    );
    expect(m[0]?.overdueDays).toBeNull();
  });

  it('未到期的任务不是负逾期，是 null', () => {
    const m = computeTaskMemory(input({ tasks: [task({ id: 'a', dueDate: NOW + 3 * DAY })] }));
    expect(m[0]?.overdueDays).toBeNull();
  });

  it('专注分钟优先用 actualMs，缺失时退到 plannedMs', () => {
    const m = computeTaskMemory(
      input({
        tasks: [task({ id: 'a' })],
        focusSessions: [
          { taskId: 'a', plannedMs: 50 * 60_000, actualMs: 25 * 60_000 },
          { taskId: 'a', plannedMs: 25 * 60_000 }, // 未完成 → 用 planned
          { taskId: undefined, plannedMs: 99 * 60_000 }, // 无任务 → 不计
        ],
      }),
    );
    expect(m[0]?.focusMinutes).toBe(50);
  });

  it('neverStarted：有截止、没完成、从没专注过', () => {
    const base = task({ id: 'a', dueDate: NOW + DAY });
    expect(computeTaskMemory(input({ tasks: [base] }))[0]?.neverStarted).toBe(true);

    const withFocus = computeTaskMemory(
      input({
        tasks: [base],
        focusSessions: [{ taskId: 'a', plannedMs: 10 * 60_000 }],
      }),
    );
    expect(withFocus[0]?.neverStarted).toBe(false);
  });

  it('已删除的任务不出现', () => {
    const m = computeTaskMemory(
      input({ tasks: [task({ id: 'a' }), task({ id: 'b', deletedAt: NOW })] }),
    );
    expect(m.map((x) => x.taskId)).toEqual(['a']);
  });

  it('输出按 taskId 升序（确定性，跨端一致）', () => {
    const m = computeTaskMemory(input({ tasks: [task({ id: 'c' }), task({ id: 'a' }), task({ id: 'b' })] }));
    expect(m.map((x) => x.taskId)).toEqual(['a', 'b', 'c']);
  });
});

describe('专注落差：说的 vs 做的', () => {
  const important = task({
    id: 'big',
    title: '准备季度汇报',
    priority: 3,
    dueDate: NOW + 2 * DAY,
  });
  const trivialDone = task({ id: 'small', title: '回邮件', priority: 0 });

  it('高优先级 + 零专注 → 出现在落差里', () => {
    const gaps = computeFocusGaps(input({ tasks: [important] }));
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.taskId).toBe('big');
    expect(gaps[0]?.focusMinutes).toBe(0);
  });

  it('投入够多的任务不算落差', () => {
    const gaps = computeFocusGaps(
      input({
        tasks: [important],
        focusSessions: [{ taskId: 'big', plannedMs: 60 * 60_000, actualMs: 60 * 60_000 }],
      }),
    );
    expect(gaps).toHaveLength(0);
  });

  it('低优先级的琐事不进落差（否则满屏都是噪音）', () => {
    expect(computeFocusGaps(input({ tasks: [trivialDone] }))).toHaveLength(0);
  });

  it('已完成的不进落差', () => {
    const done = task({ id: 'big', priority: 3, dueDate: NOW + DAY, completedAt: NOW });
    expect(computeFocusGaps(input({ tasks: [done] }))).toHaveLength(0);
  });

  it('把推迟次数与逾期带进落差（这是"事实"的原料）', () => {
    const t = task({ id: 'big', priority: 3, dueDate: NOW - 2 * DAY });
    const gaps = computeFocusGaps(
      input({
        tasks: [t],
        // 两次都必须是**往后**推 —— 我第一次写这条测试时把第二次写成了
        // 改早，于是得到 1 次；那是**测试错、代码对**（改早本来就不算推迟）。
        operations: [
          crt('big', NOW - 20 * DAY, NOW - 10 * DAY),
          upd('big', NOW - 15 * DAY, NOW - 5 * DAY), // 推后 +5d → 1
          upd('big', NOW - 5 * DAY, NOW - 2 * DAY), // 推后 +3d → 2
        ],
      }),
    );
    expect(gaps[0]?.postponements).toBe(2);
    expect(gaps[0]?.overdueDays).toBe(2);
  });

  it('按落差降序，平局用 taskId（确定性）', () => {
    const gaps = computeFocusGaps(
      input({
        tasks: [
          task({ id: 'z', priority: 1, dueDate: NOW + DAY }),
          task({ id: 'a', priority: 3, dueDate: NOW + DAY }),
        ],
      }),
    );
    expect(gaps.map((g) => g.taskId)).toEqual(['a', 'z']);
  });
});

describe('把事实写成话：不调用模型也能有输出', () => {
  it('🔴 零配置（无任何 AI 端点）时，仍然产出一句可读的话', () => {
    const gaps = computeFocusGaps(
      input({ tasks: [task({ id: 'big', title: '准备季度汇报', priority: 3, dueDate: NOW - 2 * DAY })] }),
    );
    const sentence = describeFocusGaps(gaps);
    expect(sentence).toContain('准备季度汇报');
    expect(sentence).toContain('已逾期');
  });

  it('没有落差时给出正反馈，而不是空字符串', () => {
    expect(describeFocusGaps([])).toContain('没有发现明显的落差');
  });

  it('推迟次数会出现在句子里', () => {
    const gaps = computeFocusGaps(
      input({
        tasks: [task({ id: 'big', title: '准备季度汇报', priority: 3, dueDate: NOW + 5 * DAY })],
        operations: [
          crt('big', NOW - 20 * DAY, NOW + 1 * DAY),
          upd('big', NOW - 15 * DAY, NOW + 3 * DAY),
          upd('big', NOW - 10 * DAY, NOW + 5 * DAY),
        ],
      }),
    );
    expect(describeFocusGaps(gaps)).toContain('推迟过 2 次');
  });
});
