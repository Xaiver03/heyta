/**
 * E1: executable synchronization semantics.
 *
 * These are deterministic state-machine tests rather than a fixed example
 * list. A small PRNG builds valid causal graphs, then the same operations are
 * delivered in many different orders. The reducer is required to converge,
 * and the engine must not mistake an unseen causal predecessor for a
 * duplicate merely because a descendant was received first.
 */

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';

import { OpType } from '@heyta/sync-core';
import type { Operation, VectorClock } from '@heyta/sync-core';
import { reminderIsFired } from '@heyta/domain';
import {
  DbOpLogStore,
  INDEXEDDB_SCHEMA,
  IndexedDbAdapter,
  IndexedDbOpLogStore,
  MemoryDbAdapter,
} from '@heyta/storage';

import { OpLogEngine } from '../src/engine.js';
import { applyOperation, emptyState, replayOperations } from '../src/state.js';

class DeterministicRandom {
  private value: number;

  constructor(seed: number) {
    this.value = seed >>> 0;
  }

  next(): number {
    // xorshift32: deterministic across Node, browsers, and Hermes.
    let x = this.value;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.value = x >>> 0;
    return this.value / 0x1_0000_0000;
  }

  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }
}

function mergeClock(a: VectorClock, b: VectorClock): VectorClock {
  const merged = { ...a };
  for (const [clientId, counter] of Object.entries(b)) {
    merged[clientId] = Math.max(merged[clientId] ?? 0, counter);
  }
  return merged;
}

function buildCausalScenario(seed: number): Operation<string>[] {
  const random = new DeterministicRandom(seed);
  const clients = ['client-a', 'client-b', 'client-c'];
  const localClocks: Record<string, VectorClock> = Object.fromEntries(
    clients.map((clientId) => [clientId, {}]),
  );
  const operations: Operation<string>[] = [];

  for (let index = 0; index < 18; index += 1) {
    const clientId = clients[random.int(clients.length)]!;
    let clock = { ...localClocks[clientId] };

    // Occasionally observe one earlier operation. This creates both causal
    // chains and genuinely concurrent branches without using invalid clocks.
    if (operations.length > 0 && random.next() < 0.62) {
      const observed = operations[random.int(operations.length)]!;
      clock = mergeClock(clock, observed.vectorClock);
    }

    clock[clientId] = (clock[clientId] ?? 0) + 1;
    localClocks[clientId] = clock;

    const entityId = `task-${random.int(4) + 1}`;
    const isDelete = index % 7 === 3;
    const op: Operation<string> = {
      id: `scenario-${seed}-${String(index).padStart(2, '0')}`,
      actionType: `${isDelete ? OpType.Delete : OpType.Update}_TASK`,
      opType: isDelete ? OpType.Delete : OpType.Update,
      entityType: 'TASK',
      entityId,
      payload: isDelete
        ? {}
        : {
            title: `title-${seed}-${index}`,
            priority: index % 3,
          },
      clientId,
      vectorClock: clock,
      // Deliberately include ties and skew; vector clocks own causal order,
      // timestamp + clientId (then op id for same-client legacy ties) only
      // resolve true concurrency.
      timestamp: 10_000 + ((index * 7 + seed) % 5) * 100,
      schemaVersion: 1,
    };
    operations.push(op);
  }

  return operations;
}

function shuffled<T>(input: readonly T[], seed: number): T[] {
  const random = new DeterministicRandom(seed);
  const output = [...input];
  for (let index = output.length - 1; index > 0; index -= 1) {
    const swap = random.int(index + 1);
    [output[index], output[swap]] = [output[swap]!, output[index]!];
  }
  return output;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }
  return value;
}

function visibleState(state: ReturnType<typeof emptyState>): string {
  // Entity insertion order is delivery-order noise. Symbols contain reducer
  // metadata and are intentionally excluded from the wire/domain projection.
  return JSON.stringify(canonical(state));
}

function maxClock(operations: readonly Operation<string>[]): VectorClock {
  return operations.reduce((clock, op) => mergeClock(clock, op.vectorClock), {});
}

async function memoryEngine(clientId: string): Promise<OpLogEngine> {
  const db = new MemoryDbAdapter(INDEXEDDB_SCHEMA);
  await db.init();
  const store = new DbOpLogStore<Operation<string>>(db);
  return new OpLogEngine({ store, clientId });
}

describe('E1 reducer state-machine invariants', () => {
  it('提醒的 create/fired/snooze 任意到达顺序都收敛，旧 occurrence 不会遮蔽新 occurrence', () => {
    const id = 'task-reminder';
    const triggerAt = 10_000;
    const snoozedUntil = 20_000;
    const operations: Operation<string>[] = [
      {
        id: 'reminder-create', actionType: 'CRT_REMINDER', opType: OpType.Create,
        entityType: 'REMINDER', entityId: id,
        payload: { taskId: 'task', triggerAt }, clientId: 'client', vectorClock: { client: 1 },
        timestamp: 1, schemaVersion: 1,
      },
      {
        id: 'reminder-fired', actionType: 'UPD_REMINDER', opType: OpType.Update,
        entityType: 'REMINDER', entityId: id,
        payload: { firedAt: 11_000, firedForTriggerAt: triggerAt }, clientId: 'client', vectorClock: { client: 2 },
        timestamp: 2, schemaVersion: 1,
      },
      {
        id: 'reminder-snooze', actionType: 'UPD_REMINDER', opType: OpType.Update,
        entityType: 'REMINDER', entityId: id,
        payload: { snoozedUntil }, clientId: 'client', vectorClock: { client: 3 },
        timestamp: 3, schemaVersion: 1,
      },
    ];
    const expected = replayOperations(emptyState(), operations);
    const permutations = [
      operations,
      [operations[2]!, operations[1]!, operations[0]!],
      [operations[1]!, operations[0]!, operations[2]!],
      [operations[2]!, operations[0]!, operations[1]!],
      [operations[0]!, operations[2]!, operations[1]!],
      [operations[1]!, operations[2]!, operations[0]!],
    ];
    for (const order of permutations) {
      const state = replayOperations(emptyState(), order);
      expect(state).toEqual(expected);
      const reminder = state.reminders[id]!;
      expect(reminder.firedForTriggerAt).toBe(triggerAt);
      expect(reminder.snoozedUntil).toBe(snoozedUntil);
      expect(reminderIsFired(reminder)).toBe(false);
    }
  });

  it('converges for valid causal graphs under many delivery orders', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const operations = buildCausalScenario(seed);
      const expected = replayOperations(emptyState(), operations);
      const deliveryOrders = [
        [...operations].reverse(),
        ...Array.from({ length: 20 }, (_, orderSeed) => shuffled(operations, seed * 100 + orderSeed)),
      ];

      for (const delivered of deliveryOrders) {
        expect(replayOperations(emptyState(), delivered), `seed=${seed}`).toEqual(expected);
      }
    }
  });

  it('two independent engines converge under random batching, duplicates and out-of-order delivery', async () => {
    for (let scenarioSeed = 1; scenarioSeed <= 8; scenarioSeed += 1) {
      const operations = buildCausalScenario(10_000 + scenarioSeed);
      const expected = replayOperations(emptyState(), operations);
      const left = await memoryEngine(`left-${scenarioSeed}`);
      const right = await memoryEngine(`right-${scenarioSeed}`);

      // Deliver the same history through two distinct state machines. The
      // left side sees singleton and duplicate batches; the right side sees
      // larger batches in a different order. This models retry/reconnect
      // behaviour instead of only calling the pure reducer once.
      const leftOrder = shuffled(operations, scenarioSeed * 17);
      const rightOrder = shuffled(operations, scenarioSeed * 31);
      for (let offset = 0; offset < operations.length; offset += 3) {
        const leftBatch = leftOrder.slice(offset, offset + 3);
        const rightBatch = rightOrder.slice(offset, offset + 5);
        await left.applyRemote(leftBatch);
        if (leftBatch.length > 0) await left.applyRemote([leftBatch[0]!]);
        await right.applyRemote(rightBatch);
        if (rightBatch.length > 1) await right.applyRemote(rightBatch.slice(0, 2));
      }

      expect(visibleState(left.getState()), `left seed=${scenarioSeed}`).toBe(visibleState(expected));
      expect(visibleState(right.getState()), `right seed=${scenarioSeed}`).toBe(visibleState(expected));
      expect(left.getClock(), `left clock seed=${scenarioSeed}`).toEqual(maxClock(operations));
      expect(right.getClock(), `right clock seed=${scenarioSeed}`).toEqual(maxClock(operations));
      expect(visibleState(left.getState())).toBe(visibleState(right.getState()));

      // Idempotence is checked at the engine boundary too: retrying the full
      // history must not create a second material change or a new clock edge.
      const beforeClock = left.getClock();
      const retry = await left.applyRemote(operations);
      expect(retry.applied, `retry applied seed=${scenarioSeed}`).toEqual([]);
      expect(visibleState(left.getState())).toBe(visibleState(expected));
      expect(left.getClock()).toEqual(beforeClock);
    }
  });

  it('keeps a tombstone when DELETE arrives before its causally older CREATE', () => {
    const create: Operation<string> = {
      id: 'create-1',
      actionType: 'CRT_TASK',
      opType: OpType.Create,
      entityType: 'TASK',
      entityId: 'task-1',
      payload: { title: 'should stay deleted' },
      clientId: 'client-a',
      vectorClock: { 'client-a': 1 },
      timestamp: 100,
      schemaVersion: 1,
    };
    const remove: Operation<string> = {
      ...create,
      id: 'delete-2',
      actionType: 'DEL_TASK',
      opType: OpType.Delete,
      payload: {},
      vectorClock: { 'client-a': 2 },
      timestamp: 200,
    };

    const state = replayOperations(emptyState(), [remove, create]);
    expect(state.tasks['task-1']).toMatchObject({
      id: 'task-1',
      deletedAt: 200,
    });
    expect(state.tasks['task-1']!.title).toBe('should stay deleted');
    expect(state).toEqual(replayOperations(emptyState(), [create, remove]));
  });

  it('does not skip an unseen causal predecessor when a descendant arrived first', async () => {
    const globals = globalThis as unknown as {
      indexedDB: IDBFactory;
      IDBKeyRange: typeof IDBKeyRange;
    };
    globals.indexedDB = new IDBFactory();
    globals.IDBKeyRange = IDBKeyRange;

    const db = new IndexedDbAdapter(`semantic-${Math.random().toString(36).slice(2)}`);
    await db.init();
    const store = new IndexedDbOpLogStore<Operation<string>>(db);
    const engine = new OpLogEngine({ store, clientId: 'local-client' });

    const first: Operation<string> = {
      id: 'remote-1',
      actionType: 'CRT_TASK',
      opType: OpType.Create,
      entityType: 'TASK',
      entityId: 'task-1',
      payload: { title: 'first' },
      clientId: 'remote-client',
      vectorClock: { 'remote-client': 1 },
      timestamp: 100,
      schemaVersion: 1,
    };
    const second: Operation<string> = {
      ...first,
      id: 'remote-2',
      entityId: 'task-2',
      payload: { title: 'second' },
      vectorClock: { 'remote-client': 2 },
      timestamp: 200,
    };

    await engine.applyRemote([second]);
    await engine.applyRemote([first]);

    expect(engine.getState().tasks['task-1']!.title).toBe('first');
    expect(engine.getState().tasks['task-2']!.title).toBe('second');
  });
});
