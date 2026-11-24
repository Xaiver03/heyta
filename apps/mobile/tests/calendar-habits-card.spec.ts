import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

/** 日历「习惯」卡：对照滴答，习惯单独成卡；当天没有习惯就整卡不出现。 */
describe('日历习惯卡', () => {
  it('习惯为空时整张卡不渲染（不能让空卡占位）', () => {
    const code = source('../src/screens/CalendarHabitsCard.tsx');
    expect(code).toContain('if (habits.length === 0) return null;');
  });

  it('只画、不判断"哪天该做"——日期口径在领域层', () => {
    const card = source('../src/screens/CalendarHabitsCard.tsx');
    // 卡片本身不做 isScheduledOn（由宿主过滤后端进来）
    expect(card).not.toMatch(/import[^;]*\bisScheduledOn\b/);
  });

  it('CalendarScreen 按 isScheduledOn 过滤当天该做的习惯', () => {
    const screen = source('../src/screens/CalendarScreen.tsx');
    expect(screen).toContain('isScheduledOn(');
    expect(screen).toContain('isScheduledOn(habit.frequency, selected)');
  });

  it('CalendarScreen 用 HabitActions 打卡 / 取消打卡', () => {
    const screen = source('../src/screens/CalendarScreen.tsx');
    expect(screen).toContain('createHabitActions');
    expect(screen).toContain('habitActions.checkIn(');
    expect(screen).toContain('habitActions.undoCheckIn(');
  });

  it('习惯卡接在日档日历里，标题走词条而不是硬编码中文', () => {
    const screen = source('../src/screens/CalendarScreen.tsx');
    expect(screen).toContain('<CalendarHabitsCard');
    expect(screen).toContain("title={t('widget.habits.title')}");
  });
});
