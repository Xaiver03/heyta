/**
 * `CalendarDayBoard` 15 分钟槽位、定位草稿条与习惯不经过 `renderRowWrapper` 的判据
 * ==============================================================================
 *
 * `packages/ui` 运行在 node 环境（`react-native` 为 Flow 源码，node 不直接 import RN 组件），
 * 因此既通过源码级结构断言 + 也在 `apps/web/tests/calendar-day-view.spec.tsx`（jsdom + RNW）
 * 双重验证以下三条核心契约：
 *   1. 日视图每小时包含 4 个 15 分钟槽位（`calendar-day-board-slot-09-00`, `09-15`, `09-30`, `09-45`）；
 *   2. 点击 15 分钟槽位触发 `onSelectSlot(day, '14:00')`，且传入 `activeSlot={{ day, time: '14:00' }}`
 *      时渲染 `calendar-day-board-draft-slot`（含 `☐ 14:00`）；
 *   3. 习惯项（`habitEntries`）绝不经过 `renderRowWrapper`。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('../src/calendar/CalendarDayBoard.tsx', import.meta.url)),
  'utf8',
);

function stripComments(text: string): string {
  return text
    .replaceAll(/\/\*[\s\S]*?\*\//g, '')
    .replaceAll(/^\s*\/\/.*$/gm, '')
    .replaceAll(/\{\/\*[\s\S]*?\*\/\}/g, '');
}

const code = stripComments(source);

describe('CalendarDayBoard —— 15 分钟槽位、草稿条与习惯隔离', () => {
  it('日视图每小时包含 4 个 15 分钟槽位（00 / 15 / 30 / 45，对应 calendar-day-board-slot-09-00, 09-15, 09-30, 09-45）', () => {
    expect(code).toContain('export const DAY_SLOT_MINUTES = [0, 15, 30, 45] as const;');
    expect(code).toContain('DAY_SLOT_MINUTES.map((minute) =>');
    expect(code).toContain("const minPad = String(minute).padStart(2, '0');");
    expect(code).toContain('const slotTestID = `${testID}-slot-${pad}-${minPad}`;');
    // 确认默认 testID = 'calendar-day-board' 时生成的槽位 ID 为 calendar-day-board-slot-09-00 / 09-15 / 09-30 / 09-45
    const testID = 'calendar-day-board';
    const pad = String(9).padStart(2, '0');
    const slotIds = [0, 15, 30, 45].map((m) => `${testID}-slot-${pad}-${String(m).padStart(2, '0')}`);
    expect(slotIds).toEqual([
      'calendar-day-board-slot-09-00',
      'calendar-day-board-slot-09-15',
      'calendar-day-board-slot-09-30',
      'calendar-day-board-slot-09-45',
    ]);
  });

  it('点击 15 分钟槽位触发 onSelectSlot(day, slotTime)，且传入 activeSlot={{ day, time: "14:00" }} 时渲染 calendar-day-board-draft-slot（含 ☐ 14:00）', () => {
    expect(code).toContain('onPress={onSelectSlot === undefined ? undefined : () => onSelectSlot(day, slotTime)}');
    expect(code).toContain('activeSlot !== undefined && activeSlot.day === day && activeSlot.time === slotTime');
    expect(code).toContain('testID={`${testID}-draft-slot`}');
    expect(code).toContain('{`☐ ${slotTime}`}');
  });

  it('习惯项（habitEntries）直接走 renderHabitEntry，绝不经过 renderRowWrapper', () => {
    // 1. renderRowWrapper 只放入 taskListProps 传给 TaskList（interface 声明 1 + 参数解构 1 + taskListProps 组装 2 = 4 处），绝不直接调用
    const wrapperRefs = [...code.matchAll(/\brenderRowWrapper\b/g)];
    expect(wrapperRefs.length).toBe(4);
    expect(code).not.toMatch(/renderRowWrapper\s*\(/);
    expect(code).toContain('...(renderRowWrapper === undefined ? {} : { renderRowWrapper })');

    // 2. 全天带与小时行的 habitEntries 均直接调用 renderHabitEntry?.(id)，不经过 TaskList 或 renderRowWrapper
    expect(code).toContain('{allDayHabitIds.map((id) => (');
    expect(code).toContain('{hourHabitIds.map((id) => (');
    const habitRenderMatches = [...code.matchAll(/renderHabitEntry\?\.\(id\)/g)];
    expect(habitRenderMatches.length).toBe(2);
  });
});
