/**
 * 移动端习惯的文案接线测试
 * ==========================
 *
 * 🔴 这里防的**不是"连续算错了"**（那在 `@heyta/domain` 与
 * `@heyta/app-host#habitGrowth` 里，各有自己的测试），而是**两端漂移与假话**：
 *
 *   1. `habitBoardLabels` 是移动端与共享 `HabitBoard` 的**唯一接缝** ——
 *      少给一项、或给错了命名空间，共享层不会报错，只是界面上少一句话
 *      （TS 会拦"少给字段"，但拦不住"给错 key"）。
 *   2. 🔴 **单数分支**：词条表没有 ICU，`count === 1` 时必须走兄弟词条 ——
 *      "Streak 1 days" 是一眼可见的坏句子，而它**不会让任何别的测试变红**。
 *   3. 🔴 **不许传 `cellTooltip`**：它是悬停提示，手机没有鼠标。
 *      传了就是承诺一个不存在的交互（共享层会据此产出 `data-cell-title`）。
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { translate, type MessageKey } from '@heyta/i18n';
import { describe, expect, it } from 'vitest';

import { MOBILE_HEATMAP_MONTH_KEYS, habitBoardLabels } from '../src/lib/habits-display';

/** 与界面同一条路：走真的词条表（缺 key 会**抛**，不是返回空串）。 */
const zh = (key: MessageKey, vars?: Record<string, string | number>): string =>
  translate('zh-CN', key, vars);
const en = (key: MessageKey, vars?: Record<string, string | number>): string =>
  translate('en', key, vars);

describe('habitBoardLabels：映射到共享层契约', () => {
  it('打卡按钮的两个状态与两个无障碍名（不同词条，不是前缀拼接）', () => {
    const labels = habitBoardLabels(zh);
    expect(labels.checkIn).toBe('打卡');
    expect(labels.checkedIn).toBe('已打卡');
    expect(labels.checkInA11y({ name: '喝水', doneToday: false })).toBe('为「喝水」打卡');
    expect(labels.checkInA11y({ name: '喝水', doneToday: true })).toBe('撤销「喝水」今日打卡');
  });

  it('🔴 三个数字各自分支：`count === 1` 时英文走**单数**词条', () => {
    const zhLabels = habitBoardLabels(zh);
    const enLabels = habitBoardLabels(en);
    // 中文无单复数，两句逐字相同（en 侧才会不同）。
    expect(zhLabels.streakCurrent(1)).toBe('连续 1 天');
    expect(zhLabels.streakCurrent(3)).toBe('连续 3 天');
    // 英文：1 天必须是 "day"，不是 "days"。
    expect(enLabels.streakCurrent(1)).toBe('Streak 1 day');
    expect(enLabels.streakCurrent(3)).toBe('Streak 3 days');
    expect(enLabels.streakLongest(1)).toBe('Longest 1 day');
    expect(enLabels.streakLongest(4)).toBe('Longest 4 days');
    expect(enLabels.streakTotal(1)).toBe('1 check-in');
    expect(enLabels.streakTotal(9)).toBe('9 check-ins');
  });

  it('冻结说明**说的是"保住了几天"，不是余额**（ADR-0022：余额不上界面）', () => {
    const labels = habitBoardLabels(zh);
    const text = labels.freeze(2);
    expect(text).toContain('2');
    expect(text).toContain('冻结');
    // 🔴 库存措辞不许出现：它会把"给意外的宽容"变成"计划内的额度"。
    expect(text).not.toContain('还剩');
    expect(text).not.toContain('可用');
  });

  it('补打卡 / 重新开始：日期与数字都进句子', () => {
    const labels = habitBoardLabels(zh);
    expect(labels.repair({ date: '2026-09-27', count: 5 })).toContain('2026-09-27');
    expect(labels.repair({ date: '2026-09-27', count: 5 })).toContain('5');
    expect(labels.repairAction).toBe('补上');
    expect(labels.repairA11y({ date: '2026-09-27', name: '喝水' })).toContain('喝水');

    const fresh = labels.freshStart({ days: 9, longest: 21, total: 40 });
    expect(fresh).toContain('9');
    expect(fresh).toContain('21');
    expect(fresh).toContain('40');
    // 🔴 "重新开始不会清掉它们"是那句文案的**全部意义**，不许被改掉。
    expect(fresh).toContain('都还在');
    expect(labels.freshStartA11y('喝水')).toContain('喝水');
  });

  it('空态与热力图总述都带上该有的变量', () => {
    const labels = habitBoardLabels(zh);
    expect(labels.empty).not.toBe('');
    const grid = labels.heatmap.grid({ name: '喝水', total: 42, days: 90 });
    expect(grid).toContain('喝水');
    expect(grid).toContain('42');
    expect(grid).toContain('90');
  });

  it('月份是 1–12 且与 web 共用同一批 key（不新增同义键）', () => {
    const labels = habitBoardLabels(zh);
    const enLabels = habitBoardLabels(en);
    expect(labels.heatmap.month(1)).toBe('1月');
    expect(labels.heatmap.month(12)).toBe('12月');
    expect(enLabels.heatmap.month(1)).toBe('Jan');
    expect(enLabels.heatmap.month(12)).toBe('Dec');
    // 越界（理论上不会发生）必须兜到 1 月，而不是渲染 `undefined`。
    expect(labels.heatmap.month(0)).toBe('1月');
  });

  it('🔴 不传 `cellTooltip`：手机没有鼠标，不许承诺悬停', () => {
    expect(habitBoardLabels(zh).heatmap.cellTooltip).toBeUndefined();
  });

  it('图例共用「少 / 多」那一对既有词条', () => {
    const labels = habitBoardLabels(zh);
    expect(labels.heatmap.less).toBe('少');
    expect(labels.heatmap.more).toBe('多');
  });
});

describe('月份 key 的副本与共享层一致（本文件是那条漂移的守卫）', () => {
  it('移动端那份副本 = `packages/ui/src/habits/model.ts` 的 `HEATMAP_MONTH_KEYS`', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    // ⚠️ `HEYTA_HABITS_SHARED_MODEL` 是**只读接缝**，只给故障注入用
    // （把共享层源码复制到 `/tmp`、改一处、指过去）。不设时就是真实路径。
    const source = readFileSync(
      process.env.HEYTA_HABITS_SHARED_MODEL ??
        resolve(here, '../../../packages/ui/src/habits/model.ts'),
      'utf8',
    );
    const start = source.indexOf('export const HEATMAP_MONTH_KEYS');
    expect(start, '共享层找不到 `HEATMAP_MONTH_KEYS` —— 判据锚点已失效').toBeGreaterThanOrEqual(0);
    const end = source.indexOf('];', start);
    expect(end, '`HEATMAP_MONTH_KEYS` 之后找不到 `];` —— 判据锚点已失效').toBeGreaterThan(start);
    const shared = [...source.slice(start, end).matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(shared).toEqual([...MOBILE_HEATMAP_MONTH_KEYS]);
  });
});
