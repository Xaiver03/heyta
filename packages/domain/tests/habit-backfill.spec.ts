/**
 * 补打卡窗口的判定（工单 H4）
 * ============================
 *
 * `Habit.backfillDays` 从 P1 起就有一条对外承诺（phase-1 计划 §D4"上限由它控制"），
 * 而它**零读取方** —— 承诺落空的形态不是报错，是界面自己拍了个窗口、字段坐在库里没人看。
 * 这一族钉的是"那个字段终于有人读，而读的地方只有一处"。
 *
 * 三格最容易搞错、也最值得钉：
 *   1. **默认值必须是推导出来的**（`REPAIR_WINDOW_DAYS`），不是这里再拍一个数 ——
 *      否则"没设过 backfillDays 的习惯"会从"只能补昨天"悄悄变成"能补一周"，
 *      而那是韧性层"补回来"那条提示的既有语义。
 *   2. **窗口只管"往回写"，不管"撤销已存在的记录"** —— 否则用户永远不能纠正一次误点。
 *   3. **非频次日不能被窗口覆盖**：每周一三五的习惯，周二"补"一次不是补，是造一个
 *      本来不存在的要求。
 *
 * ⚠️ 不测渲染（那是 `packages/ui/tests/habit-month-board.spec.tsx` 与 web/mobile 的接线判据），
 *    也不测写路径（`packages/app-host/tests/habit-actions.spec.ts`）。
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  BACKFILL_DEFAULT_WINDOW_DAYS,
  REPAIR_WINDOW_DAYS,
  addDays,
  backfillWindowDays,
  diffDays,
  habitDayState,
  isBackfillAllowed,
  isHabitDayTappable,
  type Habit,
  type HabitLog,
  type LocalDate,
} from '../src/index.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const habit = (over: Partial<Habit> = {}): Habit => ({
  id: 'h1',
  name: '读书',
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

const log = (date: LocalDate): HabitLog => ({
  id: `l-${date}`,
  habitId: 'h1',
  date,
  createdAt: 1,
  updatedAt: 1,
});

const TODAY: LocalDate = '2026-10-05'; // 周一
const YESTERDAY: LocalDate = '2026-10-04'; // 周日
const TWO_DAYS_AGO: LocalDate = '2026-10-03'; // 周六
const TOMORROW: LocalDate = '2026-10-06'; // 周二

describe('补打卡窗口（habit-backfill）', () => {
  it('B1 🔴 默认窗口是从韧性层推导的，不是这里拍的', () => {
    expect(BACKFILL_DEFAULT_WINDOW_DAYS).toBe(REPAIR_WINDOW_DAYS);
    expect(backfillWindowDays(habit())).toBe(REPAIR_WINDOW_DAYS);
  });

  it('B2 显式值生效；不是正整数的历史脏值一律退回默认（不能把窗口变成负数）', () => {
    for (const n of [1, 3, 7, 30]) {
      expect(backfillWindowDays(habit({ backfillDays: n }))).toBe(n);
    }
    for (const bad of [0, -3, 1.5, Number.NaN]) {
      expect(backfillWindowDays(habit({ backfillDays: bad })), `脏值 ${bad}`).toBe(
        REPAIR_WINDOW_DAYS,
      );
    }
  });

  it('B3 每日习惯的六档：今天 / 昨天可补 / 前天超窗 / 未来 / 已记录', () => {
    const h = habit(); // 没设频次 = 每天
    expect(habitDayState(h, [], TODAY, TODAY)).toBe('today');
    expect(habitDayState(h, [], YESTERDAY, TODAY)).toBe('backfillable');
    expect(habitDayState(h, [], TWO_DAYS_AGO, TODAY)).toBe('too-old');
    expect(habitDayState(h, [], TOMORROW, TODAY)).toBe('future');
    expect(habitDayState(h, [log(YESTERDAY)], YESTERDAY, TODAY)).toBe('logged');
  });

  it('B4 🔴 窗口只管"补"，不管"撤"：已记录的那天永远可点，哪怕早已超窗', () => {
    const longAgo: LocalDate = '2026-09-01';
    const state = habitDayState(habit(), [log(longAgo)], longAgo, TODAY);
    expect(state).toBe('logged');
    expect(isHabitDayTappable(state)).toBe(true);
    // 同一天没有记录时是 too-old —— 差别只在"这条已经存在"。
    expect(habitDayState(habit(), [], longAgo, TODAY)).toBe('too-old');
    expect(isHabitDayTappable('too-old')).toBe(false);
  });

  it('B5 🔴 非频次日不能被窗口覆盖（每周一三五的习惯，周二不存在"补"这件事）', () => {
    const weekly = habit({ frequency: { type: 'weekly', daysOfWeek: [1, 3, 5] } });
    // 2026-10-03 是周六：本来就不用打，谈不上漏。
    expect(habitDayState(weekly, [], TWO_DAYS_AGO, TODAY)).toBe('not-scheduled');
    // 2026-10-04 周日同样不在档上。
    expect(habitDayState(weekly, [], YESTERDAY, TODAY)).toBe('not-scheduled');
    // 上周五（10-02）在档上且在窗口内（窗口=1 时它已超窗，先看 7 天窗）。
    expect(habitDayState(habit({ ...weekly, backfillDays: 7 }), [], '2026-10-02', TODAY)).toBe(
      'backfillable',
    );
    expect(isBackfillAllowed(weekly, '2026-10-02', TODAY)).toBe(false);
  });

  it('B6 窗口宽度真的改变可补范围（3 天能、4 天不能），边界取值两边都测', () => {
    const h = habit({ backfillDays: 3 });
    const d3: LocalDate = '2026-10-02'; // 周五 = 3 天前
    const d4: LocalDate = '2026-10-01'; // 周四 = 4 天前
    expect(habitDayState(h, [], d3, TODAY)).toBe('backfillable');
    expect(habitDayState(h, [], d4, TODAY)).toBe('too-old');
    expect(isBackfillAllowed(h, d3, TODAY)).toBe(true);
    expect(isBackfillAllowed(h, d4, TODAY)).toBe(false);
  });

  it('B7 间隔型（每 N 天）按固定日历格判，不是"从建习惯那天起算"', () => {
    /* 🔴 判据**不写死哪一天**：`everyNDays: 3` 的相位由 1970-01-01 那个锚点决定，
       把某个具体日期写进断言就等于把锚点抄了第二份（而本条要钉的恰恰是"只有领域层知道锚点"）。
       所以钉**形状**：连续 15 天里落在格上的日子必须**恰好 5 个、两两相隔 3 天**。
       （第一版写的是"任意 4 个相邻日子恰好 1 个"—— 那是**错的**：周期 3 在 4 天窗口里
       可能是 1 个也可能是 2 个（第 0 天和第 3 天），一条会把正确代码判红的判据与永不通过一样有害。） */
    const every = 3;
    const h = habit({ frequency: { type: 'interval', everyNDays: every }, backfillDays: 30 });
    const start = '2026-09-10';
    const hits: LocalDate[] = [];
    for (let i = 0; i < 15; i += 1) {
      const date = addDays(start, i);
      const state = habitDayState(h, [], date, TODAY);
      if (state === 'backfillable') hits.push(date);
      else expect(state, `${date} 既不在格上也不该被算成可补`).toBe('not-scheduled');
    }
    expect(hits.length, `15 天里落在格上的应该是 ${15 / every} 个`).toBe(15 / every);
    for (let i = 1; i < hits.length; i += 1) {
      expect(
        diffDays(hits[i - 1]!, hits[i]!),
        `相邻两个可打日相差 ${String(diffDays(hits[i - 1]!, hits[i]!))} 天，不是每 ${every} 天`,
      ).toBe(every);
    }
  });

  it('B8 🔴 窗口判定只有一处所有者：产品代码里不许再写第二个 `backfillDays` 读取', () => {
    /* 这是本单最值钱的钉子。理由与 `HABIT_GLYPHS` 那张同一条：
       第二处读取 = 第二套裁决，而两处一开始可以完全一样，漂了也不会红。
       🔴 判的是**代码里的读取**，所以先 `stripComments`：本仓有五处文件在**注释里**
          讨论这个字段（本地 API 那两处"刻意不出现"、`local-api-host` 的剥字段说明、
          共享月历那两个文件与 `ui/index.ts` 的工单说明）。把它们算成"读取"会逼后人
          删掉解释性注释 —— 判据不该收这种税。
       剩下的三处逐个点名（不是"按目录放行"）：
         · 领域层本文件（唯一裁决者）
         · 实体声明（`entities.ts`）与新建入参声明（`habit-actions.ts`）—— 都是声明，不是读
       ⚠️ 测试文件不在扫描范围内：测试里写这个字段名是在**说出**这条判据，
          不是在实现第二条裁决 —— 把它们算进来只会逼人把判据删掉。 */
    const allowed = [
      'packages/domain/src/habit-backfill.ts',
      'packages/domain/src/entities.ts',
      'packages/app-host/src/habit-actions.ts',
    ].slice().sort();
    const hits = sourceFiles()
      .filter((rel) => /backfillDays/.test(stripComments(readFileSync(join(REPO, rel), 'utf8'))))
      .sort();
    expect(hits.join(' , ')).toBe(allowed.join(' , '));
  });

  it('B9 六档是封闭词表：宿主拿到的状态数恰好 6（多一档就是有人往判据里加了东西）', () => {
    const cases: readonly { h: Habit; logs: readonly HabitLog[]; date: LocalDate }[] = [
      { h: habit(), logs: [], date: TODAY },
      { h: habit(), logs: [], date: YESTERDAY },
      { h: habit(), logs: [], date: TWO_DAYS_AGO },
      { h: habit(), logs: [], date: TOMORROW },
      { h: habit(), logs: [log(YESTERDAY)], date: YESTERDAY },
      {
        h: habit({ frequency: { type: 'weekly', daysOfWeek: [1] } }),
        logs: [],
        date: TWO_DAYS_AGO,
      },
    ];
    const seen = new Set<string>();
    for (const { h, logs, date } of cases) {
      seen.add(habitDayState(h, logs, date, TODAY));
    }
    expect([...seen].sort()).toEqual([
      'backfillable',
      'future',
      'logged',
      'not-scheduled',
      'today',
      'too-old',
    ]);
  });
});

/**
 * 剥掉块注释与行注释：B8 读的是**代码**，不是注释里的一句说明。
 * 不剥的话，任何人在注释里提一次这个字段名都要来改这张白名单 ——
 * 那条税最后会让人删注释而不是改判据。
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * 产品源码清单（相对仓库根）。
 *
 * 走文件系统而不是 `git ls-files`：判据不该依赖索引状态（新文件还没 add 的时候，
 * 按 git 列的判据会**漏掉它**，而漏掉的那一处恰恰是唯一的裁决者）。
 */
function sourceFiles(): string[] {
  const acc: string[] = [];
  const skip = new Set(['node_modules', 'dist', 'generated', '__tests__', 'tests']);
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (skip.has(name)) continue;
        walk(full);
      } else if (/\.tsx?$/.test(name)) {
        acc.push(relative(REPO, full));
      }
    }
  };
  for (const root of ['packages', 'apps', 'server']) {
    walk(join(REPO, root));
  }
  return acc;
}
