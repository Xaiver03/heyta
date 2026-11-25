/**
 * 日历「习惯」条目（移动端）——形状判据
 * ======================================
 *
 * 对照滴答清单：习惯不是独立"习惯卡"，而是日历里的一条**横带**（无时刻落全天带、
 * 有时刻落时间轴）。本判据锁三件事，防止这条"带子"被改回普通行或退回独立卡：
 *
 * · 条目是**整宽浅色圆角横带**（`color.primary-subtle` 底 + `radius` 圆角），不是白底裸行；
 * · 有定时点（`habit.time`）时前面带一枚时间图标；
 * · 打卡是**整条可点**（`Pressable` + `onToggle`），不是右侧独立勾选框。
 *
 * 走源码形状判据（理由同 `calendar-view-entry.spec.ts`：本端没有 React 渲染器）。
 * 真机外观取证见 `.local/calendar-verify/`。
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRY = resolve(HERE, '../src/screens/CalendarHabitEntry.tsx');
const SCREEN = resolve(HERE, '../src/screens/CalendarScreen.tsx');
const BOARD = resolve(HERE, '../../../packages/ui/src/calendar/CalendarDayBoard.tsx');

function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/[^\n]*/g, '$1')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .join('\n');
}

const entry = codeOf(ENTRY);
const screen = codeOf(SCREEN);
const board = codeOf(BOARD);

describe('日历习惯条目 = 横带', () => {
  it('🔴 整宽浅色圆角横带（primary-subtle 底 + radius），不是白底裸行', () => {
    expect(entry).toMatch(/backgroundColor:\s*t\['color\.primary-subtle'\]/);
    expect(entry).toMatch(/borderRadius:\s*t\['radius\./);
    expect(entry).toMatch(/flexDirection:\s*'row'/);
  });

  it('🔴 有定时点才画时间图标（`habit.time !== undefined`）', () => {
    expect(entry).toMatch(/habit\.time\s*!==\s*undefined/);
    expect(entry).toMatch(/name="task\.reminder"/);
  });

  it('🔴 打卡是整条可点（Pressable + onToggle），不是右侧独立勾选框', () => {
    expect(entry).toMatch(/<Pressable[\s\S]*?onPress=\{\(\)\s*=>\s*\{[\s\S]*?onToggle\(habit\.id\)/);
    // 不允许再出现旧的"右侧独立 check 圆"那套（`styles.check`）。
    expect(entry).not.toMatch(/styles\.check\b/);
  });
});

describe('习惯作为日历条目接线', () => {
  it('🔴 宿主把习惯投影成条目（有定时点落小时，否则落全天）并交给共享板', () => {
    // 归一化到 hour=null 的分支 + 传给 CalendarBoard。
    expect(screen).toMatch(/hour:\s*Number\.isFinite\(h\)[\s\S]*?\?\s*h\s*:\s*null/);
    expect(screen).toMatch(/habitEntries=\{habitEntries\}/);
    expect(screen).toMatch(/renderHabitEntry=\{renderHabitEntry\}/);
  });

  it('🔴 不再渲染旧的独立「习惯卡」', () => {
    expect(screen).not.toMatch(/CalendarHabitsCard/);
  });

  it('🔴 共享板把 hour=null 的习惯放进全天带、有 hour 的放进对应小时行', () => {
    expect(board).toMatch(/h\.hour\s*===\s*null/);
    expect(board).toMatch(/h\.hour\s*===\s*hour/);
    expect(board).toMatch(/renderHabitEntry/);
  });
});
