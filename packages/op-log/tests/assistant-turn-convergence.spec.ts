/**
 * `ASSISTANT_TURN` 的**可复现状态机**验证（AGENTS §8 第 13 条）
 * ============================================================
 *
 * 只测 `replayOperations()` 的一个顺序，证明不了存储、`appliedOpIds` 幂等闸门
 * 和远端批次编排是对的 —— 而"一条消息 = 一个实体"这个粒度选择的**全部**赌注
 * 都压在这件事上：如果并发追加会互相吞，D-4 (ii) 就比会话级实体更糟，
 * 而不是更好。所以这里不是顺手加的测试，是那个决定的证据本身。
 *
 * 判据（每条都必须能红，变异读数见 `mutate-assistant-turn-sync.mjs`）：
 *
 *   1. 两台**独立引擎**经过不同批次、乱序、重复投递后，与纯 reducer 的规范投影逐格相同。
 *   2. 重试不产生新状态、不推进时钟。
 *   3. 接收后的时钟 = 已见操作的**逐维最大值**。
 *   4. 🔴 **两台设备各追加一条消息，两条都在**（这就是"不做会话级实体"的理由；
 *      它是一条**行为**判据，不是注释里的论证）。
 *   5. 墓碑不被更旧的写入清掉；DEL 先于 CRT 到达时不会复活。
 *
 * 固定 seed（xorshift32，Node/浏览器/Hermes 一致）。失败打印 seed。
 */

import { OpType, type Operation, type VectorClock } from '@heyta/sync-core';
import { MemoryDbAdapter, DbOpLogStore, INDEXEDDB_SCHEMA } from '@heyta/storage';
import { describe, expect, it } from 'vitest';

import { OpLogEngine } from '../src/engine.js';
import { emptyState, replayOperations } from '../src/state.js';

class DeterministicRandom {
  private value: number;

  constructor(seed: number) {
    this.value = seed >>> 0;
  }

  next(): number {
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

function maxClock(operations: readonly Operation<string>[]): VectorClock {
  return operations.reduce((clock, op) => mergeClock(clock, op.vectorClock), {});
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
  return JSON.stringify(canonical(state));
}

/**
 * 合法的因果图：两台设备在同一个账号下往**同一段会话**里写消息。
 *
 * `originClientId` 由"写它的那台设备"决定 —— 🔴 这正是被测的那一格：
 * 乱序/重复投递之后，每条消息仍然必须记着**自己**的写入设备，
 * 否则"跨设备不许确认提案"会随到达顺序变化。
 */
function buildTurnScenario(seed: number): Operation<string>[] {
  const random = new DeterministicRandom(seed);
  const clients = ['dev-a', 'dev-b'];
  const localClocks: Record<string, VectorClock> = Object.fromEntries(
    clients.map((clientId) => [clientId, {}]),
  );
  const operations: Operation<string>[] = [];

  for (let index = 0; index < 16; index += 1) {
    const clientId = clients[random.int(clients.length)]!;
    let clock = { ...localClocks[clientId] };
    if (operations.length > 0 && random.next() < 0.6) {
      const observed = operations[random.int(operations.length)]!;
      clock = mergeClock(clock, observed.vectorClock);
    }
    clock[clientId] = (clock[clientId] ?? 0) + 1;
    localClocks[clientId] = clock;

    const entityId = `aturn-${String(random.int(4) + 1)}`;
    const roll = index % 6;
    const opType =
      roll === 4 ? OpType.Delete : roll === 3 ? OpType.Update : OpType.Create;
    const payload =
      opType === OpType.Delete
        ? {}
        : opType === OpType.Update
          ? { disposition: index % 12 === 3 ? 'confirmed' : 'rejected' }
          : {
              sessionId: 'sess-1',
              role: roll === 5 ? 'proposal' : index % 2 === 0 ? 'user' : 'assistant',
              text: `第 ${String(index)} 条 · seed ${String(seed)}`,
              at: 10_000 + index * 1_000,
              destinationKind: clientId === 'dev-a' ? 'local' : 'heyta-cloud',
              originClientId: clientId,
              ...(roll === 5 ? { toolName: 'create_task', disposition: 'pending' } : {}),
            };

    operations.push({
      id: `turn-${String(seed)}-${String(index).padStart(2, '0')}`,
      actionType: `${opType}_ASSISTANT_TURN`,
      opType,
      entityType: 'ASSISTANT_TURN',
      entityId,
      payload,
      clientId,
      vectorClock: clock,
      timestamp: 10_000 + ((index * 7 + seed) % 5) * 100,
      schemaVersion: 1,
    } as Operation<string>);
  }
  return operations;
}

async function memoryEngine(clientId: string): Promise<OpLogEngine> {
  const db = new MemoryDbAdapter(INDEXEDDB_SCHEMA);
  await db.init();
  return new OpLogEngine({ store: new DbOpLogStore<Operation<string>>(db), clientId });
}

describe('ASSISTANT_TURN：两台独立引擎必须收敛', () => {
  it('纯 reducer：任意投递顺序都等于规范投影', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const operations = buildTurnScenario(seed);
      const expected = replayOperations(emptyState(), operations);
      const orders = [
        [...operations].reverse(),
        ...Array.from({ length: 20 }, (_, k) => shuffled(operations, seed * 100 + k)),
      ];
      for (const delivered of orders) {
        expect(replayOperations(emptyState(), delivered), `seed=${String(seed)}`).toEqual(expected);
      }
    }
  });

  it('两台引擎经不同批次、乱序、重复投递后与规范投影逐格相同', async () => {
    for (let scenarioSeed = 1; scenarioSeed <= 8; scenarioSeed += 1) {
      const seedLabel = `seed=${String(scenarioSeed)}`;
      const operations = buildTurnScenario(20_000 + scenarioSeed);
      const expected = replayOperations(emptyState(), operations);
      const left = await memoryEngine('dev-a');
      const right = await memoryEngine('dev-b');

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

      expect(visibleState(left.getState()), `left ${seedLabel}`).toBe(visibleState(expected));
      expect(visibleState(right.getState()), `right ${seedLabel}`).toBe(visibleState(expected));
      expect(left.getClock(), `left clock ${seedLabel}`).toEqual(maxClock(operations));
      expect(right.getClock(), `right clock ${seedLabel}`).toEqual(maxClock(operations));

      // 重试整段历史：不产生新状态、不推进时钟、applied 必须是空。
      const beforeClock = left.getClock();
      const retry = await left.applyRemote(operations);
      expect(retry.applied, `retry applied ${seedLabel}`).toEqual([]);
      expect(visibleState(left.getState()), `retry state ${seedLabel}`).toBe(
        visibleState(expected),
      );
      expect(left.getClock()).toEqual(beforeClock);
    }
  });

  it('🔴 两台设备各追加一条消息，两条都在（不做会话级实体的理由，行为版）', async () => {
    const left = await memoryEngine('dev-a');
    const right = await memoryEngine('dev-b');

    await left.dispatch({
      entityType: 'ASSISTANT_TURN',
      entityId: 'turn-from-a',
      opType: OpType.Create,
      payload: {
        sessionId: 'sess-1',
        role: 'user',
        text: 'A 说的',
        destinationKind: 'local',
        originClientId: 'dev-a',
      },
    });
    await right.dispatch({
      entityType: 'ASSISTANT_TURN',
      entityId: 'turn-from-b',
      opType: OpType.Create,
      payload: {
        sessionId: 'sess-1',
        role: 'user',
        text: 'B 说的',
        destinationKind: 'heyta-cloud',
        originClientId: 'dev-b',
      },
    });

    // 双向交换：两台设备的时钟互不可比（真并发），但**消息是两条不同实体**，
    // 所以不存在"LWW 覆盖掉一条"的余地 —— 这就是实体粒度的全部意义。
    await right.applyRemote(await left.getAllOps());
    await left.applyRemote(await right.getAllOps());

    for (const engine of [left, right]) {
      const ids = Object.keys(engine.getState().assistantTurns).sort();
      expect(ids, `${engine.getClientId()} 的会话里应该有两条消息`).toEqual([
        'turn-from-a',
        'turn-from-b',
      ]);
    }
    expect(visibleState(left.getState())).toBe(visibleState(right.getState()));
  });

  it('墓碑不被更旧的写入清掉；DEL 先于 CRT 到达也不会复活成"没删"', () => {
    const del: Operation<string> = {
      id: 'del-first',
      actionType: 'DEL_ASSISTANT_TURN',
      opType: OpType.Delete,
      entityType: 'ASSISTANT_TURN',
      entityId: 'turn-x',
      payload: {},
      clientId: 'dev-b',
      vectorClock: { 'dev-b': 2 },
      timestamp: 20_000,
      schemaVersion: 1,
    };
    const olderCreate: Operation<string> = {
      id: 'create-later',
      actionType: 'CRT_ASSISTANT_TURN',
      opType: OpType.Create,
      entityType: 'ASSISTANT_TURN',
      entityId: 'turn-x',
      payload: { role: 'user', text: '旧的那条', originClientId: 'dev-a', destinationKind: 'local' },
      clientId: 'dev-a',
      vectorClock: { 'dev-a': 1 },
      timestamp: 10_000,
      schemaVersion: 1,
    };

    for (const order of [[del, olderCreate], [olderCreate, del]] as const) {
      const state = replayOperations(emptyState(), order);
      const turn = state.assistantTurns['turn-x'];
      // 🔴 墓碑还在（`deletedAt` 有值），而**内容也还在**（回收站/导出要能读到）。
      expect(turn?.deletedAt, `顺序 ${order.map((o) => o.id).join('→')}`).toBe(20_000);
      expect(turn?.text).toBe('旧的那条');
    }
  });

  it('🔴 originClientId 跟着**写它的那台设备**走，不随到达顺序变', () => {
    const operations = buildTurnScenario(31);
    let checked = 0;
    for (const delivered of [operations, [...operations].reverse(), shuffled(operations, 7)]) {
      const replayed = replayOperations(emptyState(), delivered);
      // 🔴 **前提断言**：这个循环必须真的有东西可查。
      // 变异验证实测过：把 `ASSISTANT_TURN` 从 `BUCKET_BY_ENTITY` 摘掉后，
      // 这一条**照样绿** —— 因为桶是空的，循环一次都没进。
      // 遍历式的判据在"上游没接"时会退化成空对空（同 `entity-type-parity` 里
      // 那句 `expect(LOCAL_API_TOOL_PACKS.length).toBeGreaterThan(0)` 的理由）。
      const entries = Object.values(replayed.assistantTurns).filter((t) => t.originClientId !== undefined);
      expect(entries.length, `seed=31 的 scenario 一条带 originClientId 的消息都没有 ⇒ 这条判据没跑`).toBeGreaterThan(0);
      checked += entries.length;
      for (const turn of entries) {
        // 每条消息的目的地档位与设备身份必须仍然自洽（A 写的是 local、B 写的是 heyta-cloud）。
        expect(
          { local: 'dev-a', 'heyta-cloud': 'dev-b' }[turn.destinationKind as string],
          `seed=31 的消息 ${turn.id} 的目的地 ${String(turn.destinationKind)} 与写入设备 ${String(turn.originClientId)} 不再对应`,
        ).toBe(turn.originClientId);
      }
    }
    expect(checked, '三种投递顺序都要真的查过').toBeGreaterThanOrEqual(3);
  });
});
