/**
 * 重复预设的测试
 * =================
 *
 * 这一组测试刻意**主要断言行为**（`occursOn` / `nextOccurrence`），而不是规则串的
 * 字面值。理由很直接：
 *
 *   - 断言 `'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO'` 只能证明"我写了这个串"。
 *     它和实现同义重复，改一个字就要跟着改测试，而**没有回答"每周是不是真的每周一"**。
 *   - 断言 `occursOn(rule, anchor, '2026-09-21') === true` 证明的是**语义**：
 *     两周后的周一命中、中间的周二不命中。`BYDAY=MO` 写成 `BYDAY=MO `（多个空格）
 *     或 `BYDAY=1MO` 这类错误会在这里被抓住，而在字符串断言里也可能是"绿"的。
 *
 * 字面串只留一处便宜的回退断言，用于"格式突变"时快速定位。
 */

import { Recurrence, occursOn, nextOccurrence, today } from '@heyta/domain';
import { describe, expect, it } from 'vitest';

import { REPEAT_PRESET_IDS, repeatPresetRule } from '../src/repeat-presets.js';

/** 2026-09-14 是周一。 */
const MONDAY = '2026-09-14';
const NEXT_MONDAY = '2026-09-21';
/** 同周的周二。 */
const TUESDAY = '2026-09-15';
/** 同月的另一个周一（2026-09-28）。 */
const LATER_MONDAY = '2026-09-28';

describe('repeatPresetRule：预设的语义', () => {
  it('每天 —— 从锚点起每一天都命中', () => {
    const rule = repeatPresetRule('daily', MONDAY)!;
    expect(occursOn(rule, MONDAY, MONDAY)).toBe(true);
    expect(occursOn(rule, MONDAY, TUESDAY)).toBe(true);
    expect(occursOn(rule, MONDAY, '2026-10-15')).toBe(true);
    // 锚点之前不算命中 —— 规则从 dtstart 开始
    expect(occursOn(rule, MONDAY, '2026-09-13')).toBe(false);
    expect(rule).toBe(Recurrence.daily());
  });

  it('每周 —— 落在**锚点那天是星期几**，而不是随便哪一天', () => {
    const rule = repeatPresetRule('weekly', MONDAY)!;
    // 这是这条测试真正的价值：证明"每周"= 每周一。
    expect(occursOn(rule, MONDAY, MONDAY)).toBe(true);
    expect(occursOn(rule, MONDAY, NEXT_MONDAY)).toBe(true);
    expect(occursOn(rule, MONDAY, LATER_MONDAY)).toBe(true);
    expect(occursOn(rule, MONDAY, TUESDAY), '周二不该命中').toBe(false);
    expect(rule).toBe(Recurrence.weekly(['MO']));
  });

  it('每周的锚点换成另一天，命中的星期也跟着换（不是写死周一）', () => {
    // 用周日当锚点：规则必须落在周日。
    const SUNDAY = '2026-09-20';
    const rule = repeatPresetRule('weekly', SUNDAY)!;
    expect(occursOn(rule, SUNDAY, SUNDAY)).toBe(true);
    expect(occursOn(rule, SUNDAY, '2026-09-27')).toBe(true);
    expect(occursOn(rule, SUNDAY, MONDAY), '周一不该命中').toBe(false);
    expect(rule).toBe(Recurrence.weekly(['SU']));
  });

  it('工作日 —— 周一到周五命中，周六周日不命中', () => {
    const rule = repeatPresetRule('weekdays', MONDAY)!;
    expect(occursOn(rule, MONDAY, MONDAY)).toBe(true);
    expect(occursOn(rule, MONDAY, TUESDAY)).toBe(true);
    expect(occursOn(rule, MONDAY, '2026-09-18'), '周五该命中').toBe(true);
    expect(occursOn(rule, MONDAY, '2026-09-19'), '周六不该命中').toBe(false);
    expect(occursOn(rule, MONDAY, '2026-09-20'), '周日不该命中').toBe(false);
    expect(rule).toBe(Recurrence.weekly(['MO', 'TU', 'WE', 'TH', 'FR']));
  });

  it('每月 —— 锚点的**日号**，且在短月里跳过不存在的日子', () => {
    const rule = repeatPresetRule('monthly', MONDAY)!;
    // 9/14 设的「每月」→ 每月 14 号
    expect(occursOn(rule, MONDAY, '2026-10-14')).toBe(true);
    expect(occursOn(rule, MONDAY, '2026-11-14')).toBe(true);
    expect(occursOn(rule, MONDAY, '2026-10-15'), '15 号不该命中').toBe(false);
    expect(rule).toBe(Recurrence.monthlyOnDay(14));
  });

  it('每月 31 号在 2 月**没有**下一次，而不是滚到 3 月 3 日', () => {
    // 这是"每月"最容易出错的地方：把日号交给 Date 会静默滚月。
    const rule = repeatPresetRule('monthly', '2026-01-31')!;
    expect(occursOn(rule, '2026-01-31', '2026-03-31')).toBe(true);
    expect(occursOn(rule, '2026-01-31', '2026-02-28'), '2 月没有 31 号').toBe(false);
  });

  it('返回的规则一律能通过 isValidRecurrenceRule（不产出垃圾规则）', () => {
    for (const id of REPEAT_PRESET_IDS) {
      const rule = repeatPresetRule(id, MONDAY);
      expect(rule, `${id} 应当能构造出规则`).toBeDefined();
      // 能算出下一次就说明它是一条可用的规则
      expect(nextOccurrence(rule!, MONDAY, MONDAY), `${id} 应当有下一次`).toBeDefined();
    }
  });

  it('锚点串非法时返回 undefined，而不是抛错或写一条坏规则', () => {
    // `parseLocalDate` 对越界日期会抛错（回读校验），这里必须被吞掉并转成 undefined：
    // 让一个坏输入把整个详情面板炸掉，比"这次操作无效"糟得多。
    expect(() => repeatPresetRule('monthly', '2026-13-40' as never)).not.toThrow();
    expect(repeatPresetRule('monthly', '2026-13-40' as never)).toBeUndefined();
  });

  it('锚点是"今天"也能构造（未设截止日的任务走这条）', () => {
    // 未设截止日的任务，`setRepeat` 会拿今天当锚点 —— 这条路必须也能出规则。
    const anchorToday = today(Date.parse('2026-09-14T12:00:00'));
    expect(anchorToday).toBe(MONDAY);
    for (const id of REPEAT_PRESET_IDS) {
      expect(repeatPresetRule(id, anchorToday), id).toBeDefined();
    }
  });
});