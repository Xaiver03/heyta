/**
 * 记录 AI 反馈 —— 写入路径与校验
 * =================================
 *
 * ## 为什么要校验，而不是"相信调用方"
 *
 * 一条 `appliedCount > proposedCount` 的记录**不会让任何东西崩**。
 * 它会让 P7「保留率」算出一个 > 1 的比例，而那个数字会被当成
 * "你留下了 120% 的建议"展示给用户 —— 看起来还挺合理。
 *
 * 所以这里的原则是：**宁可抛错，也不要往偏好层喂脏数据。**
 * 偏好层的"安静地算错"比它直接失败危险得多。
 */

import { describe, expect, it } from 'vitest';

import {
  createAiFeedbackActions,
  createPreferenceCorrectionActions,
} from '../src/ai-feedback-actions.js';
import type { ActionContext } from '../src/actions.js';

/** 假上下文：记录 dispatch 出去的 intent，不接真引擎。 */
function fakeCtx(
  existing: Record<string, unknown> = {},
): { ctx: ActionContext; intents: unknown[] } {
  const intents: unknown[] = [];
  return {
    intents,
    ctx: {
      dispatch: (intent) => {
        intents.push(intent);
        return Promise.resolve(undefined);
      },
      getState: () => ({ preferenceCorrections: existing }) as never,
    },
  };
}

const VALID = {
  feature: 'breakdown',
  outcome: 'accepted',
  proposedCount: 6,
  appliedCount: 6,
} as const;

describe('记录 AI 反馈：正常路径', () => {
  it('写出一条 AI_FEEDBACK 的创建 op，字段如实', async () => {
    const { ctx, intents } = fakeCtx();
    const actions = createAiFeedbackActions(ctx, { newId: () => 'f1' });

    const id = await actions.record(VALID);

    expect(id).toBe('f1');
    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({
      entityType: 'AI_FEEDBACK',
      entityId: 'f1',
      payload: { feature: 'breakdown', outcome: 'accepted', proposedCount: 6, appliedCount: 6 },
    });
  });

  it('三态都能写入', async () => {
    const { ctx, intents } = fakeCtx();
    const actions = createAiFeedbackActions(ctx, { newId: () => 'x' });
    await actions.record({ feature: 'breakdown', outcome: 'accepted', proposedCount: 4, appliedCount: 4 });
    await actions.record({ feature: 'breakdown', outcome: 'modified', proposedCount: 4, appliedCount: 2 });
    await actions.record({ feature: 'breakdown', outcome: 'rejected', proposedCount: 4, appliedCount: 0 });
    expect(intents).toHaveLength(3);
  });

  it('零项建议的拒绝也能记（AI 什么都没给出来）', async () => {
    const { ctx, intents } = fakeCtx();
    const actions = createAiFeedbackActions(ctx, { newId: () => 'x' });
    await actions.record({ feature: 'breakdown', outcome: 'rejected', proposedCount: 0, appliedCount: 0 });
    expect(intents).toHaveLength(1);
  });
});

describe('🔴 记录 AI 反馈：脏数据必须被挡住', () => {
  const actions = (): ReturnType<typeof createAiFeedbackActions> =>
    createAiFeedbackActions(fakeCtx().ctx, { newId: () => 'x' });

  it('采用数 > 提议数 → 抛错（否则 P7 会算出 > 100%）', async () => {
    await expect(
      actions().record({ feature: 'breakdown', outcome: 'modified', proposedCount: 3, appliedCount: 5 }),
    ).rejects.toThrow(/不能多于/);
  });

  it('未知功能 → 抛错', async () => {
    await expect(
      actions().record({ feature: 'gantt', outcome: 'accepted', proposedCount: 1, appliedCount: 1 }),
    ).rejects.toThrow(/未知的 AI 功能/);
  });

  it('负数项数 → 抛错', async () => {
    await expect(
      actions().record({ feature: 'breakdown', outcome: 'rejected', proposedCount: -1, appliedCount: 0 }),
    ).rejects.toThrow(/非负整数/);
  });

  it('小数项数 → 抛错', async () => {
    await expect(
      actions().record({ feature: 'breakdown', outcome: 'accepted', proposedCount: 2.5, appliedCount: 2.5 }),
    ).rejects.toThrow(/非负整数/);
  });

  it('🔴 声称「全部采用」但条数对不上 → 抛错', async () => {
    await expect(
      actions().record({ feature: 'breakdown', outcome: 'accepted', proposedCount: 6, appliedCount: 4 }),
    ).rejects.toThrow(/全部采用/);
  });

  it('🔴 声称「拒绝」却留着条目 → 抛错', async () => {
    await expect(
      actions().record({ feature: 'breakdown', outcome: 'rejected', proposedCount: 6, appliedCount: 3 }),
    ).rejects.toThrow(/必须是 0/);
  });

  it('🔴 声称「改后采用」但其实是全留或全丢 → 抛错（三态必须自洽）', async () => {
    await expect(
      actions().record({ feature: 'breakdown', outcome: 'modified', proposedCount: 6, appliedCount: 6 }),
    ).rejects.toThrow(/严格介于/);
    await expect(
      actions().record({ feature: 'breakdown', outcome: 'modified', proposedCount: 6, appliedCount: 0 }),
    ).rejects.toThrow(/严格介于/);
  });

  it('项数超过上限 → 抛错（上游一定出了问题）', async () => {
    await expect(
      actions().record({ feature: 'breakdown', outcome: 'accepted', proposedCount: 999, appliedCount: 999 }),
    ).rejects.toThrow(/上限/);
  });

  it('🔴 校验失败时**一个 op 都没发出去**', async () => {
    const { ctx, intents } = fakeCtx();
    const a = createAiFeedbackActions(ctx, { newId: () => 'x' });
    await expect(
      a.record({ feature: 'breakdown', outcome: 'accepted', proposedCount: 6, appliedCount: 4 }),
    ).rejects.toThrow();
    expect(intents).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────
// 偏好纠正（「忘掉这条」）
// ─────────────────────────────────────────────────────────────

describe('偏好纠正：忘掉一条偏好', () => {
  it('写出一条 PREFERENCE_CORRECTION，kind 是 suppress', async () => {
    const { ctx, intents } = fakeCtx();
    const a = createPreferenceCorrectionActions(ctx, { newId: () => 'c1' });
    const id = await a.suppress('lead-time');
    expect(id).toBe('c1');
    expect(intents[0]).toMatchObject({
      entityType: 'PREFERENCE_CORRECTION',
      entityId: 'c1',
      payload: { preferenceId: 'lead-time', kind: 'suppress' },
    });
  });

  it('所有已知偏好 id 都能被忘掉', async () => {
    const ids = [
      'estimate-bias',
      'deep-work-window',
      'lead-time',
      'granularity',
      'title-style',
      'feedback-granularity',
      'feedback-keep-ratio',
    ];
    for (const id of ids) {
      const { ctx, intents } = fakeCtx();
      const a = createPreferenceCorrectionActions(ctx, { newId: () => 'c' });
      await a.suppress(id);
      expect(intents, `${id} 应该能被忘掉`).toHaveLength(1);
    }
  });

  it('🔴 未知偏好 id → 抛错（记下来也没人认得，只会变成清不掉的垃圾）', async () => {
    const { ctx, intents } = fakeCtx();
    const a = createPreferenceCorrectionActions(ctx, { newId: () => 'c' });
    await expect(a.suppress('quantum-mood')).rejects.toThrow(/未知的偏好/);
    expect(intents).toHaveLength(0);
  });
});

describe('偏好纠正：恢复', () => {
  it('删除纠正记录（墓碑），于是那条偏好会回来', async () => {
    const { ctx, intents } = fakeCtx({ c1: { id: 'c1' } });
    const a = createPreferenceCorrectionActions(ctx);
    await a.restore('c1');
    expect(intents[0]).toMatchObject({
      entityType: 'PREFERENCE_CORRECTION',
      entityId: 'c1',
      opType: 'DEL',
    });
  });

  it('🔴 恢复一条不存在的纠正 → 抛错（不静默成功）', async () => {
    const { ctx, intents } = fakeCtx({});
    const a = createPreferenceCorrectionActions(ctx);
    await expect(a.restore('nope')).rejects.toThrow(/找不到/);
    expect(intents).toHaveLength(0);
  });
});
