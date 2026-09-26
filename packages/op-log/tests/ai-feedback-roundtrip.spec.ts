/**
 * AI 反馈：真实读写往返
 * =========================
 *
 * `entity-coverage.spec.ts` 已经证明 `AI_FEEDBACK` 会被物化（总额 > 0）。
 * 但那一条只检查"桶里有没有东西"，不检查**字段有没有活下来**。
 *
 * 这个文件补的是后者，而且是本仓库最高发的失效形状：
 *
 *   能力"存在"（类型有了、桶有了、单测全绿）但**接起来不对**。
 *   具体到这里：`AiFeedback` 的 `feature` / `outcome` / `proposedCount` /
 *   `appliedCount` 中任何一个在 apply 阶段丢掉，偏好推断（P6/P7）就读到
 *   `undefined` —— 而 `undefined` 参与比较不会抛错，只会安静地算错。
 *
 * 所以这里**走真实的 OpLogEngine + 存储适配器**，逐字段核对。
 */

import { describe, expect, it } from 'vitest';

import { MemoryDbAdapter, DbOpLogStore, INDEXEDDB_SCHEMA } from '@heyta/storage';
import { inferFeedbackPreferences } from '@heyta/domain';

import { OpLogEngine } from '../src/index.js';

/** 造一个真引擎（内存存储，但走完整的 dispatch → apply → 物化路径）。 */
async function engine(clientId = 'a'): Promise<InstanceType<typeof OpLogEngine>> {
  const db = new MemoryDbAdapter(INDEXEDDB_SCHEMA);
  await db.init();
  return new OpLogEngine({ clientId, store: new DbOpLogStore(db) });
}

type FeedbackShape = {
  feature?: string;
  outcome?: string;
  proposedCount?: number;
  appliedCount?: number;
};

async function state(e: InstanceType<typeof OpLogEngine>): Promise<Record<string, FeedbackShape>> {
  return e.getState().aiFeedback as unknown as Record<string, FeedbackShape>;
}

describe('AI 反馈：dispatch 之后字段真的活下来', () => {
  it('🔴 四个业务字段逐一对得上（不是"桶里非空"就算过）', async () => {
    const e = await engine();
    await e.dispatch({
      entityType: 'AI_FEEDBACK' as never,
      entityId: 'f1',
      opType: 'CRT' as never,
      payload: {
        feature: 'breakdown',
        outcome: 'modified',
        proposedCount: 8,
        appliedCount: 3,
      },
    });

    const row = (await state(e)).f1;
    expect(row).toBeDefined();
    expect(row?.feature).toBe('breakdown');
    expect(row?.outcome).toBe('modified');
    expect(row?.proposedCount).toBe(8);
    expect(row?.appliedCount).toBe(3);
  });

  it('多条反馈各自独立存下来', async () => {
    const e = await engine();
    for (let i = 0; i < 3; i += 1) {
      await e.dispatch({
        entityType: 'AI_FEEDBACK' as never,
        entityId: `f${i}`,
        opType: 'CRT' as never,
        payload: { feature: 'breakdown', outcome: 'accepted', proposedCount: 4, appliedCount: 4 },
      });
    }
    expect(Object.keys(await state(e))).toHaveLength(3);
  });

  it('删除是墓碑，不是消失（可同步、可恢复）', async () => {
    const e = await engine();
    await e.dispatch({
      entityType: 'AI_FEEDBACK' as never,
      entityId: 'f1',
      opType: 'CRT' as never,
      payload: { feature: 'breakdown', outcome: 'accepted', proposedCount: 4, appliedCount: 4 },
    });
    await e.dispatch({
      entityType: 'AI_FEEDBACK' as never,
      entityId: 'f1',
      opType: 'DEL' as never,
      payload: {},
    });

    const row = (await state(e)).f1;
    expect(row).toBeDefined();
    expect((row as { deletedAt?: number }).deletedAt).toBeGreaterThan(0);
  });
});

describe('🔴 端到端：反馈真的能喂给偏好推断', () => {
  it('从引擎里读出的反馈能算出 P6，而不是一堆 undefined', async () => {
    const e = await engine();
    // 12 次"AI 给 9 项、我留 3 项"
    for (let i = 0; i < 12; i += 1) {
      await e.dispatch({
        entityType: 'AI_FEEDBACK' as never,
        entityId: `f${i}`,
        opType: 'CRT' as never,
        payload: {
          feature: 'breakdown',
          outcome: 'modified',
          proposedCount: 9,
          appliedCount: 3,
        },
      });
    }

    const rows = Object.values(await state(e)) as never as Parameters<
      typeof inferFeedbackPreferences
    >[0]['feedback'];

    const set = inferFeedbackPreferences({ memoryEnabled: true, feedback: rows });

    // 🔴 关键：如果任何字段在 apply 阶段丢了，这里会是 null（而不是 3）。
    // 那正是"看起来跑通了、其实没接上"的形状。
    expect(set.feedbackGranularity?.value).toBe(3);
    expect(set.keepRatio?.value).toBeCloseTo(1 / 3, 3);
    expect(set.feedbackGranularity?.sampleSize).toBe(12);
  });

  it('🔴 主开关关闭时，同一批真实数据一条都推不出来', async () => {
    const e = await engine();
    for (let i = 0; i < 12; i += 1) {
      await e.dispatch({
        entityType: 'AI_FEEDBACK' as never,
        entityId: `f${i}`,
        opType: 'CRT' as never,
        payload: { feature: 'breakdown', outcome: 'modified', proposedCount: 9, appliedCount: 3 },
      });
    }
    const rows = Object.values(await state(e)) as never as Parameters<
      typeof inferFeedbackPreferences
    >[0]['feedback'];

    const set = inferFeedbackPreferences({ memoryEnabled: false, feedback: rows });
    expect(set.feedbackGranularity).toBeNull();
    expect(set.keepRatio).toBeNull();
  });
});
