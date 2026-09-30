/**
 * 习惯目标在**移动端**的最后一段：真的接上了吗
 * ================================================
 *
 * ## 为什么是**源码级**断言
 *
 * `apps/mobile` 没有组件测试栈（本仓刻意没引 `@testing-library/*`，理由见
 * `packages/ui/vitest.config.ts` 的文件头）。而这一条要防的失效**恰好是"接线断了"**：
 *
 *   - `packages/domain` 的 `isAchieved` 三种口径 ✅ 有
 *   - `packages/app-host` 的 `setHabitGoal` ✅ 有（含数值校验）
 *   - `packages/ui` 的 `HabitBoard` 的 `renderGoalSlot` 槽位 ✅ 有
 *   - `apps/mobile` 的调用点 —— 🔴 **在补上之前是 0**
 *
 * ⇒ 症状是"模型有、槽位在、**用户改不了习惯的目标**"，而且**不报错**。
 * 这种"缺一根线"的失效没有行为可测，只能查源码（与 `subtask-entry.spec.ts` 同一取向）。
 *
 * ⚠️ 文件里**不 import `react-native`**（在 node 里加载它直接失败）——
 * 所以这里只读文件、不做渲染。
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// `apps/mobile/tests` 上**三级**才是仓库根。
const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const SCREEN = 'apps/mobile/src/screens/HabitsScreen.tsx';
const SLOT = 'apps/mobile/src/ui/habit-goal-slot.tsx';

const read = (rel: string): string => readFileSync(join(REPO, rel), 'utf8');

describe('移动端的习惯目标入口（源码级；这里没有组件测试栈）', () => {
  it('🔴 `HabitsScreen` **真的把 `renderGoalSlot` 传给了** `HabitBoard`', () => {
    const src = read(SCREEN);
    expect(src, '没 import 编辑器').toContain('HabitGoalSlot');
    expect(src, '没把槽位传给共享的 HabitBoard ⇒ 用户改不了目标').toMatch(
      /<HabitBoard[\s\S]*?renderGoalSlot=\{renderGoalSlot\}/,
    );
  });

  it('🔴 调用 app-host 的 `setHabitGoal`（不是本地改字段）', () => {
    expect(read(SCREEN)).toMatch(/actions\.setHabitGoal\(/);
  });

  it('🔴 口径 → 摘要 key 用**共享层**那一份，不在移动端再写一遍', () => {
    const src = read(SLOT);
    expect(src, '没 import 共享的 habitGoalSummaryKey').toContain('habitGoalSummaryKey');
    // 反面：本地三选一（会与 web 漂移）
    expect(src, '在移动端自己判了口径').not.toMatch(/goalType === 'atMost'/);
  });

  it('🔴 `0` **不被当成非法值**（`atMost` + 0 = 「一次都不碰」）', () => {
    const src = read(SLOT);
    expect(src, '下界写成了 <= 0，会把「一次都不碰」判死').toContain('parsed < 0');
    expect(src).not.toContain('parsed <= 0');
  });

  it('🔴 拒绝被接住（`runFor` 只 `.finally()`，没有 `.catch`）', () => {
    // 交给 runFor 会变成 unhandled rejection，用户看到的是"点了没反应"。
    expect(read(SLOT)).toMatch(/\.catch\(/);
  });
});