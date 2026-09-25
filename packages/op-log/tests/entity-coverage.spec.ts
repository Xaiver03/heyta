/**
 * 实体覆盖门禁
 * ==============
 *
 * 🔴 这道门禁守的是一个**静默**故障：`ENTITY_TYPES` 里的合法实体，
 * reducer 不物化的话会被**悄无声息地丢掉** —— `dispatch` 不报错、op 照常入队、
 * 照常同步到所有设备，但没有任何设备显示它。
 *
 * 实测过：`NOTE` / `TASK_REPEAT_CFG` / `REMINDER` 三个实体就处在这个状态。
 * 用户建一条重复任务，它同步得到处都是，哪儿也不显示，也不报错。
 *
 * 所以规则是：**每一个合法实体，要么被物化，要么在 `UNMODELED_ENTITY_TYPES`
 * 里显式登记并写明原因。** 往 `ENTITY_TYPES` 加实体却忘了实现 —— 这里会红。
 */

import { describe, expect, it } from 'vitest';

import { MODELED_ENTITY_TYPES as DOMAIN_MODELED } from '@heyta/domain';
import { ENTITY_TYPES } from '@heyta/shared-schema';

import { MODELED_ENTITY_TYPES, UNMODELED_ENTITY_TYPES } from '../src/state.js';

describe('实体覆盖：合法实体不许被静默丢弃', () => {
  it('每个 ENTITY_TYPES 都被物化，或在未物化清单里显式登记', () => {
    const declared = new Set([...MODELED_ENTITY_TYPES, ...UNMODELED_ENTITY_TYPES.map((u) => u.entityType)]);

    const unaccounted = ENTITY_TYPES.filter((t) => !declared.has(t));

    expect(
      unaccounted,
      `这些实体既没有物化、也没有登记原因，会被静默丢弃：${unaccounted.join(', ')}。` +
        '要么实现它的物化，要么加进 UNMODELED_ENTITY_TYPES 并写明原因。',
    ).toEqual([]);
  });

  it('未物化清单里不许留已经不存在的实体（清单不能腐烂）', () => {
    const valid = new Set<string>(ENTITY_TYPES);
    const stale = UNMODELED_ENTITY_TYPES.map((u) => u.entityType).filter((t) => !valid.has(t));
    expect(stale, `这些实体已不在 ENTITY_TYPES 里，应从清单移除：${stale.join(', ')}`).toEqual([]);
  });

  it('未物化清单里不许出现已经物化了的实体（实现完要移除登记）', () => {
    const modeled = new Set(MODELED_ENTITY_TYPES);
    const done = UNMODELED_ENTITY_TYPES.filter((u) => modeled.has(u.entityType)).map((u) => u.entityType);
    expect(done, `这些实体已经物化，应从 UNMODELED_ENTITY_TYPES 移除：${done.join(', ')}`).toEqual([]);
  });

  it('每一条未物化登记都必须写明原因（不能只留一个名字）', () => {
    const vague = UNMODELED_ENTITY_TYPES.filter((u) => u.reason.trim().length < 6).map((u) => u.entityType);
    expect(vague, `这些登记没有写明原因：${vague.join(', ')}`).toEqual([]);
  });

  it('已物化的实体确实能被 dispatch 后看见（清单没有撒谎）', async () => {
    // 反向验证：清单说物化了，就真的物化。否则清单只是文档。
    const { MemoryDbAdapter, DbOpLogStore, INDEXEDDB_SCHEMA } = await import('@heyta/storage');
    const { OpLogEngine } = await import('../src/index.js');

    for (const entityType of MODELED_ENTITY_TYPES) {
      const db = new MemoryDbAdapter(INDEXEDDB_SCHEMA);
      await db.init();
      const engine = new OpLogEngine({ clientId: 'coverage', store: new DbOpLogStore(db) });
      await engine.dispatch({
        entityType: entityType as never,
        entityId: 'coverage-1',
        opType: 'CRT' as never,
        payload: { title: 'coverage' },
      });

      const state = engine.getState() as unknown as Record<string, Record<string, unknown>>;
      const total = Object.values(state).reduce((n, bucket) => n + Object.keys(bucket).length, 0);
      expect(total, `${entityType} 声称已物化，但 dispatch 之后状态里没有它`).toBeGreaterThan(0);
    }
  });
});

describe('🔴「已建模」只能有一份定义', () => {
  it('domain 与 op-log 的已建模清单必须完全一致', () => {
    // 这两份清单描述的是同一个事实：「哪些实体有领域模型、会被物化」。
    // 它们曾经是各自手写的（domain: EntityModelMap + hasModel，op-log: BUCKET_BY_ENTITY），
    // 加上 hasModel 里手抄的第三遍 —— 三份互不校验的定义。
    // 只加一处、忘了另一处，那个实体就会被静默丢弃（见 AGENTS.md #20）。
    expect(
      [...MODELED_ENTITY_TYPES].sort(),
      'domain 的 MODELED_ENTITY_TYPES 与 op-log 的 MODELED_ENTITY_TYPES 不一致。' +
        '同一个事实不能有两份定义：改一处必须同步改另一处。',
    ).toEqual([...DOMAIN_MODELED].sort());
  });
});
