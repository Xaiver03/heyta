import { describe, expect, it } from 'vitest';

import { emptyState } from '@heyta/op-log';

import {
  replayShareOps,
  replayShareOpsFromScratch,
  type DecryptedShareOp,
} from '../src/share-replay.js';

/**
 * W3-T1 第二片的判据：**收敛**（计划 §3-W3："固定 seed 双引擎乱序/重复/先于 CREATE 收敛对账"）。
 *
 * 这四枚都钉在"物化结果"上，不是"函数返回了数组"——因为 reducer 的 LWW 决策
 * 由 `(时钟可比性 → timestamp → clientId)` 决定，**到达顺序一旦参与，两台设备就会分叉**。
 */
const op = (
  id: string,
  clientId: string,
  timestamp: number,
  clock: Record<string, number>,
  opType: string,
  payload: unknown,
): DecryptedShareOp => ({
  id,
  clientId,
  timestamp,
  vectorClock: clock,
  actionType: opType === 'CRT' ? 'add comment' : 'edit comment',
  opType,
  entityType: 'COMMENT',
  entityId: 'c-1',
  schemaVersion: 1,
  payload,
});

const CREATE = op('op-1', 'device-A', 1_000, { 'device-A': 1 }, 'CRT', { taskId: 't-1', authorUserId: 'u-A', body: 'hi' });
const EARLY = op('op-2', 'device-A', 1_500, { 'device-A': 2 }, 'UPD', { body: 'early edit' });
const LATE = op('op-3', 'device-B', 2_000, { 'device-B': 1 }, 'UPD', { body: 'late edit' });

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]),
  );
}

/** 物化出来的那一条评论正文（探针，不参与断言形状）。 */
function bodyOf(state: ReturnType<typeof replayShareOpsFromScratch>['state']): unknown {
  const bucket = (state as unknown as { comments?: Record<string, { body?: unknown }> }).comments;
  const row = bucket === undefined ? undefined : bucket['c-1'];
  return row?.body;
}

describe('share-replay（W3-T1 第二片）', () => {
  it('乱序到达 ⇒ 同一份物化结果与同一个时钟（LWW 由 timestamp 决定，不由到达顺序）', () => {
    const whole = replayShareOpsFromScratch([[CREATE, EARLY, LATE]]);
    expect(bodyOf(whole.state), '最后写的是 timestamp 最大的那条').toBe('late edit');
    for (const p of permutations([CREATE, EARLY, LATE])) {
      const r = replayShareOpsFromScratch([p]);
      expect(r.state).toEqual(whole.state);
      expect(r.log.clock).toEqual(whole.log.clock);
    }
    // 分批（含重叠）也一样：
    const batched = replayShareOpsFromScratch([[LATE], [EARLY, CREATE, LATE]]);
    expect(batched.state).toEqual(whole.state);
    expect(batched.log.clock).toEqual(whole.log.clock);
    expect(batched.log.duplicates).toBeGreaterThan(0);
  });

  it('幂等：同一批再喂一次，状态与时钟都不动', () => {
    const once = replayShareOpsFromScratch([[CREATE, EARLY, LATE]]);
    const twice = replayShareOps(once.state, [[CREATE, EARLY, LATE]], once.log);
    expect(twice.state).toEqual(once.state);
    expect(twice.log.clock).toEqual(once.log.clock);
    expect(twice.applied, '重复的 op 一条都不该再过 reducer').toBe(once.applied);
  });

  it('先于 CREATE 到达照样收敛；并钉住一个实测事实：reducer 会从 UPDATE 单独物化出实体', () => {
    const orphanFirst = replayShareOpsFromScratch([[EARLY, CREATE]]);
    expect(orphanFirst.state, '全序把 CREATE 排在前面 ⇒ 结果与正常顺序一致').toEqual(
      replayShareOpsFromScratch([[CREATE, EARLY]]).state,
    );
    /*
     * 🔴 实测事实（2026-10-17；本判据第一版断错了）：既有 reducer
     * （`op-log/src/state.ts:622` 的 `applyOperation`）**对只有 UPDATE、没有 CREATE 的流
     * 也会把实体物化出来**（现量：只喂 `EARLY` ⇒ 读到 `body === 'early edit'`）。
     * 那不是缺陷：LWW 记录本来就带 payload，CREATE 只是"首写"；而计划要求的判据是
     * "先于 CREATE **收敛**"，不是"必须不物化"。⇒ 断言改成收敛形状，并把事实钉住，
     * 因为它有真实后果：**共享域里"还没拉到 CREATE"的实体可能已经存在**，
     * 读路径不许假设 `taskId` / 作者名等 CREATE 才带的字段一定有值
     * （这也是 `aliveCommentsForTask` 要做归属与墓碑过滤的原因之一）。
     */
    const onlyUpdate = replayShareOps(emptyState(), [[EARLY]]);
    expect(bodyOf(onlyUpdate.state), '把实测行为钉住：只有 UPDATE 时实体已存在').toBe('early edit');
    const afterCreate = replayShareOps(onlyUpdate.state, [[CREATE]], onlyUpdate.log);
    expect(bodyOf(afterCreate.state), '后来补到 CREATE 也不改 LWW 结果（收敛，不"回滚"）').toBe('early edit');
  });

  it('全序**真的**在承重：同 clientId 同 timestamp 的两条 op，胜负由 id 定，与到达顺序无关', () => {
    /*
     * 这一枚是补的，因为**变异臂教了我一次**：先前那 4 枚在"拿掉全序、按到达顺序重放"
     * 之下**全都还是绿的**（实测：4 passed）—— 说明它们钉的是"LWW 实体的收敛"，
     * 而 LWW 的胜负由 `(时钟 → timestamp → clientId)` 决定，**根本用不到全序**。
     * 真正依赖全序的是**完全平局**：同 clientId、同 timestamp、同一实体上的两条 op —
     * 此时 reducer 的判据给不出先后（`state.ts:229-232` 没有第三段），
     * 于是"谁最后被喂进去"就决定了物化结果。少了 id 那一段全序，两台设备会分叉。
     */
    // ⚠️ 必须是**真平局**：钟、时间戳、clientId 三段全同，只有 id 不同。
    //    第一版我给了不同的钟（{A:1} vs {A:2}）⇒ reducer 的钟比较就定了胜负，
    //    于是变异臂照样全绿（那说明那版判据根本没钉住全序）。
    const y = op('op-y', 'device-A', 5_000, { 'device-A': 1 }, 'UPD', { body: 'from-y' });
    const z = op('op-z', 'device-A', 5_000, { 'device-A': 1 }, 'UPD', { body: 'from-z' });
    const forward = replayShareOpsFromScratch([[CREATE, y, z]]);
    const backward = replayShareOpsFromScratch([[CREATE, z, y]]);
    expect(forward.state, '到达顺序反过来也必须一样').toEqual(backward.state);
    // 全序把 op-y 排在 op-z 前 ⇒ 最终生效的是 op-z 的载荷。
    expect(bodyOf(forward.state)).toBe('from-z');
  });

  it('清空后重放同一条日志 ⇒ 与增量喂得到的状态一致（换设备/换顺序都不分叉）', () => {
    const incremental = replayShareOpsFromScratch([[CREATE], [EARLY], [LATE]]);
    const oneShot = replayShareOpsFromScratch([[LATE, EARLY, CREATE]]);
    expect(oneShot.state).toEqual(incremental.state);
    expect(oneShot.log.ops.map((o) => o.id)).toEqual(['op-1', 'op-2', 'op-3']);
  });
});
