/**
 * 专注动作层的测试
 * ==================
 *
 * 与 `actions.spec.ts` 同样的取舍：**真实引擎 + 真实 SQLite（`:memory:`）**。
 * 要证明的是"动作确实产出了一种可同步的 op"，而假探针只能证明"我调了 dispatch"。
 *
 * 重点盯四类**静默失效**：
 *   1. 可清除字段写成 `undefined` → 被 JSON 丢掉 → 对端既不清除也不设置
 *   2. `completed` 缺失 → 统计把"中途放弃"算成"完成"
 *   3. `FOCUS_SESSION` 没被物化 → 数据同步得到处都是、哪儿也不显示（AGENTS.md §7 #20）
 *   4. 列表顺序依赖存储返回顺序 → 同一份数据在两台设备上顺序不同
 */

import type { FocusSession } from '@heyta/domain';
import { OpLogEngine } from '@heyta/op-log';
import { DbOpLogStore, INDEXEDDB_SCHEMA, SqliteAdapter } from '@heyta/storage';
import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';
import { OpType, type Operation } from '@heyta/sync-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createFocusActions,
  FOCUS_LOG_FAILURE_CODES,
  focusLogFailureCode,
  type FocusActions,
} from '../src/focus-actions.js';

let adapter: SqliteAdapter;
let engine: OpLogEngine;
let actions: FocusActions;
let clock = 1_700_000_000_000;
const now = (): number => clock;

/** 可控 id：顺序断言不能靠随机 id。 */
let idSeq = 0;
const makeId = (): string => {
  idSeq += 1;
  return `focus-t-${String(idSeq).padStart(3, '0')}`;
};

function session(over: Partial<FocusSession> = {}): FocusSession {
  return {
    id: '',
    kind: 'work',
    plannedMs: 25 * 60 * 1000,
    actualMs: 25 * 60 * 1000,
    completed: true,
    createdAt: clock,
    updatedAt: clock,
    startedAt: clock - 25 * 60 * 1000,
    endedAt: clock,
    ...over,
  };
}

/** 从存储里取那条 op —— 断言 op 的**形状**，不是内存状态。 */
async function opOf(entityId: string): Promise<Operation<string>> {
  const ops = await engine.getOpsForEntity('FOCUS_SESSION', entityId);
  const last = ops.at(-1);
  if (last === undefined) throw new Error(`没找到 ${entityId} 的 op`);
  return last;
}

/**
 * op 的载荷。
 *
 * `Operation` 上的 `payload` 类型是 `unknown`（线协议层不假设载荷形状）——
 * 断言前必须显式收窄，**不能**用 `as any` 让后面所有断言都失去类型保护。
 */
function payloadOf(op: Operation<string>): Record<string, unknown> {
  return op.payload as Record<string, unknown>;
}

beforeEach(async () => {
  adapter = new SqliteAdapter({
    schema: INDEXEDDB_SCHEMA,
    driverFactory: () => new NodeSqliteDriver(':memory:'),
  });
  await adapter.init();
  engine = new OpLogEngine({
    store: new DbOpLogStore<Operation<string>>(adapter),
    clientId: 'client-focus',
    now,
  });
  clock = 1_700_000_000_000;
  idSeq = 0;
  actions = createFocusActions(engine, { newFocusId: makeId });
});

afterEach(() => {
  adapter.close();
});

describe('记录一次专注', () => {
  it('产出的是一条可同步的 FOCUS_SESSION Create op', async () => {
    const id = await actions.log(session());
    expect(id).toBe('focus-t-001');

    const op = await opOf(id);
    expect(op.entityType).toBe('FOCUS_SESSION');
    expect(op.entityId).toBe(id);
    expect(op.opType).toBe(OpType.Create);
    expect(payloadOf(op).kind).toBe('work');
    expect(payloadOf(op).plannedMs).toBe(25 * 60 * 1000);
    expect(payloadOf(op).completed).toBe(true);
  });

  it('🔴 载荷里**不含 undefined**（否则会被 JSON 丢掉，对端静默不生效）', async () => {
    // 不关联任务、不给 actualMs —— 最容易写成 undefined 的两个字段
    const id = await actions.log(
      session({ taskId: undefined, actualMs: undefined, startedAt: undefined, endedAt: undefined }),
    );
    const op = await opOf(id);

    // ① 直接查：任何键的值都不能是 undefined
    for (const [key, value] of Object.entries(payloadOf(op))) {
      expect(value, `载荷字段 ${key} 是 undefined`).not.toBeUndefined();
    }

    // ② 过一遍 JSON —— 这才是对端真正收到的东西
    const wire = JSON.parse(JSON.stringify(op)) as Operation<string>;
    for (const key of ['taskId', 'actualMs', 'startedAt', 'endedAt']) {
      expect(Object.keys(payloadOf(wire)), `过 JSON 后丢了 ${key}`).toContain(key);
      expect(payloadOf(wire)[key]).toBeNull();
    }
  });

  it('🔴 completed 缺省时是 false，绝不缺失', async () => {
    const id = await actions.log(session({ completed: undefined }));
    const op = await opOf(id);
    expect(payloadOf(op).completed).toBe(false);
  });

  it('负数 actualMs 被夹到 0（别的写入方不一定照状态机做）', async () => {
    const id = await actions.log(session({ actualMs: -5000 }));
    const op = await opOf(id);
    expect(payloadOf(op).actualMs).toBe(0);
  });

  it('休息轮也能记，且 kind 原样保留', async () => {
    const id = await actions.log(session({ kind: 'shortBreak', plannedMs: 5 * 60 * 1000 }));
    const op = await opOf(id);
    expect(payloadOf(op).kind).toBe('shortBreak');
  });

  it('关联任务时 taskId 原样写入', async () => {
    const id = await actions.log(session({ taskId: 'task-abc' }));
    const op = await opOf(id);
    expect(payloadOf(op).taskId).toBe('task-abc');
  });
});

/**
 * 取被拒绝的那个异常**本身**。
 *
 * 🔴 这里不用 `rejects.toThrow(/中文句子/)`：那种断言把**message 的措辞**钉成了契约，
 * 于是"包里拼一句中文给人看"反而被测试保护住了。现在契约是**原因码**，
 * message 只是日志用的诊断串（`code: 收到的值`），它不许进界面，所以也不许被当作文案钉住。
 */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('预期这条写入被拒绝，但它成功了');
    },
    (error: unknown) => error,
  );
}

describe('非法输入必须显式报错，不能静默入库', () => {
  it('未知 kind → 原因码 unknown-kind', async () => {
    const error = await rejectionOf(actions.log(session({ kind: 'nap' as never })));
    expect(focusLogFailureCode(error)).toBe('unknown-kind');
  });

  it('时长非正数 → 原因码 non-positive-planned-ms', async () => {
    for (const plannedMs of [0, -1, Number.NaN]) {
      const error = await rejectionOf(actions.log(session({ plannedMs })));
      expect(focusLogFailureCode(error), `plannedMs=${String(plannedMs)}`).toBe(
        'non-positive-planned-ms',
      );
    }
  });

  it('缺 createdAt → 原因码 missing-created-at', async () => {
    const error = await rejectionOf(actions.log(session({ createdAt: 0 })));
    expect(focusLogFailureCode(error)).toBe('missing-created-at');
  });

  it('🔴 message 里一个汉字都不许有 —— 它是诊断串，不是文案', async () => {
    const failures = [
      session({ kind: 'nap' as never }),
      session({ plannedMs: 0 }),
      session({ createdAt: 0 }),
    ];
    for (const input of failures) {
      const error = await rejectionOf(actions.log(input));
      const message = String((error as Error).message);
      expect(message, `这句会渗进界面：${message}`).not.toMatch(/[\u3400-\u9fff]/u);
    }
  });

  it('原因码是封闭集合 —— 加一个码就得同时改 ui 的映射与两份词条', () => {
    expect([...FOCUS_LOG_FAILURE_CODES].sort()).toEqual([
      'missing-created-at',
      'non-positive-planned-ms',
      'unknown-kind',
    ]);
  });

  it('不是校验失败的异常 → undefined，界面走兜底句', () => {
    // 旧契约的中文整句：必须**认不出来**，否则"永远绿的判据"就回来了
    expect(focusLogFailureCode(new Error('未知的专注类型: nap'))).toBeUndefined();
    // name 对但码不在封闭集合里
    expect(
      focusLogFailureCode({ name: 'FocusLogValidationError', code: 'made-up' }),
    ).toBeUndefined();
    expect(focusLogFailureCode(undefined)).toBeUndefined();
  });

  it('报错的那几次**一条 op 都不该留下**', async () => {
    await actions.log(session()).catch(() => undefined);
    const before = (await engine.getPendingUpload()).length;
    await expect(actions.log(session({ kind: 'nap' as never }))).rejects.toThrow();
    expect((await engine.getPendingUpload()).length).toBe(before);
  });
});

describe('列表', () => {
  it('按 (createdAt, id) 排序 —— 顺序必须跨端一致', async () => {
    // 刻意让"插入顺序"与"排序结果"不同：三条同一毫秒、id 逆序插入
    clock = 1_700_000_000_000;
    const c = await actions.log(session({ createdAt: clock }));
    const a = await actions.log(session({ createdAt: clock }));
    const b = await actions.log(session({ createdAt: clock }));
    expect([c, a, b]).toEqual(['focus-t-001', 'focus-t-002', 'focus-t-003']);

    // id 是 001/002/003，所以按 id 排 = 插入顺序；
    // 换一组"id 与插入顺序相反"的，才能证明排序真的用了 id 而不是存储顺序。
    const list = actions.listSessions().map((s) => s.id);
    expect(list).toEqual([...list].sort());
  });

  it('软删除的不出现', async () => {
    const id = await actions.log(session());
    expect(actions.listSessions().map((s) => s.id)).toContain(id);

    await engine.dispatch({
      entityType: 'FOCUS_SESSION',
      entityId: id,
      opType: OpType.Delete,
      payload: {},
    });
    expect(actions.listSessions().map((s) => s.id)).not.toContain(id);
  });
});

describe('🔴 反静默丢弃：另一台设备真的能物化它', () => {
  it('A 写入 → B 应用远端 → B 的状态里查得到这条专注', async () => {
    // 两个独立存储的引擎 = 两台设备
    const adapterB = new SqliteAdapter({
      schema: INDEXEDDB_SCHEMA,
      driverFactory: () => new NodeSqliteDriver(':memory:'),
    });
    await adapterB.init();
    const engineB = new OpLogEngine({
      store: new DbOpLogStore<Operation<string>>(adapterB),
      clientId: 'client-other',
      now,
    });

    const id = await actions.log(session({ taskId: 'task-xyz' }));
    const pending = await engine.getPendingUpload();
    expect(pending).toHaveLength(1);

    const result = await engineB.applyRemote(pending);
    // 被接受了 —— 而不是"不知道这个实体于是优雅跳过"（那正是 §7 #20 的静默丢数据）
    expect(result.applied.map((op) => op.id)).toEqual([pending[0]!.id]);

    const onB = createFocusActions(engineB);
    const seen = onB.listSessions();
    expect(seen).toHaveLength(1);
    expect(seen[0]!.id).toBe(id);
    expect(seen[0]!.taskId).toBe('task-xyz');
    expect(seen[0]!.completed).toBe(true);

    adapterB.close();
  });
});
