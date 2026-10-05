/**
 * 日历的**第二个日期数据源**（批次二 W6，跑在 node，不 render 组件）
 * =================================================================
 *
 * 这块板子原本只有一个源：`groupTasksByDueDate` 里那句
 * `if (task.dueDate === undefined) continue;`。倒数日**没有 `dueDate` 这个字段**
 * （它有 `date` 锚点 + 重复规则），所以在那个源上它永远不会出现。
 *
 * 🔴 本单的可观测证据只有一条：**一条没有截止日的倒数日能上日历**。
 *   所以这里所有夹具都不带任何"截止时间"样的字段 —— 一旦有人把投影写成
 *   "必须像任务那样有个 dueDate 才算"，第 1、2 条立刻红（变异臂见本文件末注）。
 *
 * 其余几条钉的是同样会静默坏掉的东西：
 * · **默认值必须等于原值**（§9.1）：不给 events 时格子逐字节与改动前一样；
 * · **区间取可见的那一段**，含补白格 —— 少画的是看得见的格子；
 * · 归档项不进日历（面板不显示的东西日历也不许显示）；
 * · 倒数日排在任务**之后**：插到未完成任务前面 = 日历替用户判定哪个更急；
 * · 词表没给时只剩标题 —— "共享层支持了"与"宿主真的接上了"是两件事。
 *
 * ⚠️ 日期数学一律不在这里重算：哪些天发生是 `@heyta/domain/events.ts` 的事，
 *   本文件只是**验证日历有没有去问它**（在这里再写一遍闰月就是第二份数学）。
 */

import { describe, expect, it } from 'vitest';
import { Recurrence, type CountdownEvent, type Task } from '@heyta/domain';

import {
  calendarCellBars,
  calendarEventBarTitle,
  groupEventsByOccurrence,
  MAX_CALENDAR_BARS,
  yearRangeOf,
  type CalendarEventBarLabels,
} from '../src/calendar/model.js';

const TODAY = '2026-10-03';
/** 一整屏月历的区间（6 行 42 格那一屏，含上月/下月补白）。 */
const FROM = '2026-09-28';
const TO = '2026-11-08';

const LABELS: CalendarEventBarLabels = {
  today: '就是今天',
  until: (days) => `还有 ${String(days)} 天`,
  since: (days) => `已经 ${String(days)} 天`,
};

function event(over: Partial<CountdownEvent> & { id: string }): CountdownEvent {
  return {
    title: over.id,
    // 🔴 注意这里**没有** dueDate：EVENT 这个实体根本没有这个字段，
    //    而"没有截止日的日子也能上日历"正是本单的立论。
    date: '2026-10-10',
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

function task(over: Partial<Task> & { id: string }): Task {
  return { title: over.id, createdAt: 0, updatedAt: 0, ...over };
}

describe('W6 判据本体：没有截止日的倒数日能上日历', () => {
  it('一条一次性倒数日落在它自己的那一天，且相对今天的天数按**格子那天**算', () => {
    const map = groupEventsByOccurrence([event({ id: 'e1', date: '2026-10-10' })], TODAY, FROM, TO);
    const marks = map.get('2026-10-10');
    expect(marks, '这条倒数日必须出现在它那一天那一格里').toEqual([
      { id: 'e1', title: 'e1', days: 7 },
    ]);
  });

  it('格子里一条任务都没有时，倒数日那条仍然画出来（这就是日历的第二个源）', () => {
    const marks = groupEventsByOccurrence([event({ id: 'e1' })], TODAY, FROM, TO).get('2026-10-10');
    const { bars, hidden } = calendarCellBars([], TODAY, '2026-10-10', MAX_CALENDAR_BARS, marks);
    expect(hidden, '只有一条的时候不该出现「+0」').toBe(0);
    expect(
      bars.filter((bar) => bar.event === true).map((bar) => bar.id),
      '格子里必须有这条倒数日',
    ).toEqual(['e1']);
  });

  it('区间外的倒数日不出现（补白那两端的格子在区间**内**，所以也要画）', () => {
    const map = groupEventsByOccurrence(
      [
        event({ id: '在补白格里', date: '2026-09-30' }),
        event({ id: '在区间外', date: '2026-12-24' }),
      ],
      TODAY,
      FROM,
      TO,
    );
    expect(map.has('2026-09-30'), '上月补白那一格是看得见的，少画就是缺陷').toBe(true);
    expect(map.has('2026-12-24'), '看不见的月份不该被摊进来').toBe(false);
  });

  it('每年重复的纪念日在跨两个月的区间里出现两次（数学问 domain，这里只验问没问）', () => {
    const yearly = event({
      id: '每年',
      date: '2024-11-05',
      recurrence: Recurrence.yearly(11, 5),
    });
    const dates = [...groupEventsByOccurrence([yearly], TODAY, FROM, TO).keys()];
    expect(dates, '区间 [09-28, 11-08] 里 11-05 出现一次；两次都由 domain 的规则算').toEqual([
      '2026-11-05',
    ]);
  });

  it('已删除与已归档的不进日历（面板不显示的东西，日历也不许显示）', () => {
    const map = groupEventsByOccurrence(
      [
        event({ id: '活的', date: '2026-10-10' }),
        event({ id: '归档', date: '2026-10-11', archivedAt: 1 }),
        event({ id: '删掉', date: '2026-10-12', deletedAt: 1 }),
      ],
      TODAY,
      FROM,
      TO,
    );
    expect([...map.keys()].sort()).toEqual(['2026-10-10']);
  });
});

describe('W6 的默认值必须等于原值（§9.1：否则两端同时红）', () => {
  it('不给 events / eventLabels 时，格子输出与只有任务时**逐字节**相同', () => {
    const tasks = [task({ id: 't1' }), task({ id: 't2', completedAt: 1 })];
    const before = calendarCellBars(tasks, TODAY, '2026-10-08');
    const after = calendarCellBars(tasks, TODAY, '2026-10-08', MAX_CALENDAR_BARS, undefined, undefined);
    expect(after).toEqual(before);
    expect(
      after.bars.every((bar) => bar.event === undefined),
      '任务条不许被贴上任何"倒数日"标记',
    ).toBe(true);
  });

  it('倒数日排在任务**之后**（插到未完成任务前面 = 日历替用户判定哪个更急）', () => {
    const marks = groupEventsByOccurrence([event({ id: 'e1' })], TODAY, FROM, TO).get('2026-10-10');
    const { bars } = calendarCellBars(
      [task({ id: 't-未做' }), task({ id: 't-已做', completedAt: 1 })],
      TODAY,
      '2026-10-10',
      MAX_CALENDAR_BARS,
      marks,
    );
    expect(bars.map((bar) => bar.id)).toEqual(['t-未做', 't-已做', 'e1']);
  });

  it('格子容量满时倒数日一起折进 +N，而不是另开一个计数器', () => {
    const marks = groupEventsByOccurrence([event({ id: 'e1' })], TODAY, FROM, TO).get('2026-10-10');
    const full = Array.from({ length: MAX_CALENDAR_BARS }, (_, i) => task({ id: `t${String(i)}` }));
    const { bars, hidden } = calendarCellBars(full, TODAY, '2026-10-10', MAX_CALENDAR_BARS, marks);
    expect(bars.filter((bar) => bar.event === true)).toHaveLength(0);
    expect(hidden, '被折掉的那条就是倒数日，它进的是同一个 +N').toBe(1);
  });

  it('同格两条倒数日按 id 升序（两台设备必须画出同一个顺序）', () => {
    const marks = groupEventsByOccurrence(
      [event({ id: 'b', date: '2026-10-10' }), event({ id: 'a', date: '2026-10-10' })],
      TODAY,
      FROM,
      TO,
    ).get('2026-10-10');
    expect(marks?.map((mark) => mark.id)).toEqual(['a', 'b']);
  });
});

describe('倒数日那一行的字（宿主注入，不给就只剩标题）', () => {
  it('给了词表：三种说法各自成句，且数字来自格子那天', () => {
    expect(calendarEventBarTitle({ id: 'x', title: '结婚纪念日', days: 12 }, LABELS)).toBe(
      '结婚纪念日 · 还有 12 天',
    );
    expect(calendarEventBarTitle({ id: 'x', title: '结婚纪念日', days: 0 }, LABELS)).toBe(
      '结婚纪念日 · 就是今天',
    );
    expect(calendarEventBarTitle({ id: 'x', title: '结婚纪念日', days: -3 }, LABELS)).toBe(
      '结婚纪念日 · 已经 3 天',
    );
  });

  it('不给词表：只剩标题，不发明任何一个字', () => {
    expect(calendarEventBarTitle({ id: 'x', title: '结婚纪念日', days: 12 }, undefined)).toBe(
      '结婚纪念日',
    );
  });
});

/*
  🔴 日档与年档吃的是**同一次投影的两个取法**（组件那两条 DOM 判据在
  `apps/web/tests/calendar-event-source.spec.tsx`，node 这边不 render）。
  这里钉的是那两个取法**各自的区间**，因为区间写错的症状两边不一样：

  · 日档取了整月 ⇒ "切到日视图，上面那一带挂着别人的日子"（同屏两个日子）；
  · 年档只取游标那个月 ⇒ "12 张卡里除了本月，整年一个纪念日都没有"
    —— 而这条**只有**在每年重复的那个案例上才会暴露，一次性日期本月就命中了。
*/
describe('日档与年档的区间（同一个投影函数，两种取法）', () => {
  it('年区间就是游标所在年的 01-01 到 12-31（两端都钉）', () => {
    expect(yearRangeOf('2026-10-03')).toEqual({ from: '2026-01-01', to: '2026-12-31' });
  });

  it('每年重复的纪念日在**别的月份**也被年区间看见', () => {
    const yearly = event({
      id: 'yearly',
      date: '2025-02-03',
      recurrence: Recurrence.yearly(2, 3),
    });
    const range = yearRangeOf(TODAY);
    const dates = groupEventsByOccurrence([yearly], TODAY, range.from, range.to);
    expect(
      [...dates.keys()],
      '年档那 12 张卡里二月那一格必须有点',
    ).toEqual(['2026-02-03']);
  });

  it('日档只取游标那一天：同一条倒数日不会漏到隔壁那天', () => {
    const oneOff = event({ id: 'one', date: '2026-10-10' });
    expect(
      [...groupEventsByOccurrence([oneOff], TODAY, '2026-10-10', '2026-10-10').keys()],
      '那天必须有自己的那一行',
    ).toEqual(['2026-10-10']);
    expect(
      groupEventsByOccurrence([oneOff], TODAY, '2026-10-11', '2026-10-11').size,
      '翻到第二天还挂着它 = 同屏两个日子',
    ).toBe(0);
  });
});
