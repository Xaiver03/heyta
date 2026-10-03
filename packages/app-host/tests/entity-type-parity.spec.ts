/**
 * `LocalApiWrittenEntityType` 与 `ENTITY_TYPES` 的两条对账
 * =======================================================
 *
 * 为什么要单独一份：`packages/local-api` 是**零运行时依赖**包，它看不见
 * `packages/shared-schema` 的 `ENTITY_TYPES`，所以 `LocalApiWrittenEntityType` 是一份
 * 手抄的封闭集合（写结果里"刚落地的是哪种实体"）。手抄一定会漂（AGENTS §3.5 那条教训），
 * 而漂的两个方向代价不一样，所以这里两条腿都钉：
 *
 *   1. **多抄**（类型里有一个 `ENTITY_TYPES` 没有的取值）
 *      ⇒ op-log 的 `applyOperation` 对未建模的 entityType **静默忽略**，
 *        于是"写入成功"可以是一条四个端都读不回来的 op。这条由**编译期**挡。
 *   2. **跑在实现前面**（类型里有成员，但目录里没有一个 pack 能产出它）
 *      ⇒ 类型读起来像"发生过的事"，其实是一句计划。这条由**运行期**挡。
 *   3. 顺带把 pack 自己声明的 `entityType` 也对一遍 `ENTITY_TYPES`
 *      —— 覆盖面门禁（`scripts/check-ai-coverage.mjs`）按归属解析工具名，
 *         这里按 pack 声明直接对账，两条不同的路走同一份真源。
 *
 * ⚠️ 第 1 条是**类型级**判据 ⇒ 它的消费者是 `pnpm -r typecheck`，不是 `pnpm -r test`。
 *    下面的 `it` 只是让这条声明在测试输出里可见，并跑第 2、3 条的运行时对账。
 */

import { ENTITY_TYPES } from '@heyta/shared-schema';
import { LOCAL_API_TOOL_PACKS, type LocalApiWrittenEntityType } from '@heyta/local-api';
import { describe, expect, it } from 'vitest';

/**
 * 🔴 这个对象必须**逐字**覆盖联合的每一员：少写一个键（新增成员没登记）或多写一个键
 * （成员已从联合里删掉）都会**编译不过**。它同时给运行期一份可遍历的清单。
 */
const WRITABLE: Record<LocalApiWrittenEntityType, true> = {
  TASK: true,
  PROJECT: true,
  HABIT: true,
  TAG: true,
  NOTE: true,
  HABIT_LOG: true,
  FOCUS_SESSION: true,
  REMINDER: true,
};

type KnownEntity = (typeof ENTITY_TYPES)[number];
type Outside = Exclude<LocalApiWrittenEntityType, KnownEntity>;

// 只有 `Outside` 是 `never` 时，`true` 才 assignable 到这个类型。
// 往联合里多抄一个 `ENTITY_TYPES` 没有的取值 ⇒ 这一行编译报错，并把那个取值印在类型里。
const subsetPin: [Outside] extends [never] ? true : ['不是 ENTITY_TYPES 的成员', Outside] = true;

describe('🔴 手抄的写入实体集合与真源对账', () => {
  it('编译期：联合是 `ENTITY_TYPES` 的子集（多抄一个未建模实体就编译不过）', () => {
    expect(subsetPin).toBe(true);
  });

  it('运行期：联合的每个成员都有一个 pack 真能产出它（类型不许跑在实现前面）', () => {
    const claimed = new Set(
      LOCAL_API_TOOL_PACKS.filter((pack) => pack.tools.some((tool) => tool.kind === 'write')).map(
        (pack) => pack.entityType,
      ),
    );
    const unbacked = Object.keys(WRITABLE).filter((entityType) => !claimed.has(entityType));
    expect(unbacked).toEqual([]);
  });

  it('🔴 每个 pack 声明的 `entityType` 都在 `ENTITY_TYPES` 里（真源遍历，不是手抄）', () => {
    const known = new Set<string>(ENTITY_TYPES);
    const offenders = LOCAL_API_TOOL_PACKS.filter((pack) => !known.has(pack.entityType)).map(
      (pack) => `${pack.entityType}（${pack.tools.map((tool) => tool.name).join('、')}）`,
    );
    expect(offenders).toEqual([]);
    // 前提：这份遍历本身有东西可查。pack 列表为空时上面两句都会空对空地绿。
    expect(LOCAL_API_TOOL_PACKS.length).toBeGreaterThan(0);
  });

  it('每个 pack 恰好认领一个实体（一个 pack 认领两个 = 归属在两个地方各说一遍）', () => {
    const seen = new Map<string, string[]>();
    for (const pack of LOCAL_API_TOOL_PACKS) {
      seen.set(pack.entityType, [...(seen.get(pack.entityType) ?? []), ...pack.tools.map((t) => t.name)]);
    }
    const duplicated = [...seen.entries()].filter(([, tools]) => new Set(tools).size !== tools.length);
    expect(duplicated.map(([entityType]) => entityType)).toEqual([]);
    // `ENTITY_TYPES` 里的成员**可以**没有 pack（`GLOBAL_CONFIG` 这类系统实体），
    // 所以这里不判"每个实体都有 pack" —— 那是覆盖面门禁按"用户可操作实体"分母判的事。
    expect(ENTITY_TYPES.length).toBeGreaterThan(0);
  });
});
