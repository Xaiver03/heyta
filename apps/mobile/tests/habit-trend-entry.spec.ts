/**
 * 习惯「月 ⇄ 年」容器的移动端接线（工单 H7，源码层）
 * =================================================
 *
 * 本壳没有 RN 组件测试栈（理由见 [`habit-create-entry.spec.ts`](./habit-create-entry.spec.ts)
 * 文件头），所以"接线在不在、有没有长出第二份算式"只能读源码文本。
 * 行为侧（点年卡换档、游标只有一枚）在 `apps/web/tests/habit-trend-board.spec.tsx`
 * 的 Z 组与 `e2e/tests/habit-year.spec.ts` 的 S 组里钉 —— 两端挂的是同一枚容器。
 *
 * ⚠️ 所有反向判据都先 `stripComments`：注释里出现被禁的字符串会让判据**假绿**。
 */

import { describe, expect, it } from 'vitest';

import { mobileSources, read, stripComments } from './source-reading';

const SCREEN = 'apps/mobile/src/screens/HabitsScreen.tsx';
const DISPLAY = 'apps/mobile/src/lib/habits-display.ts';
const SHARED_BOARD = 'packages/ui/src/habits/HabitTrendBoard.tsx';

describe('移动端接习惯年视图（源码层）', () => {
  const screen = stripComments(read(SCREEN));
  const display = stripComments(read(DISPLAY));

  it('N1 详情区挂的是**容器**，而且没做成可选插槽', () => {
    expect(screen, '没挂 HabitTrendBoard').toMatch(/<HabitTrendBoard\b/);
    expect(screen, '把两档做成了可选插槽').not.toMatch(/renderTrend|renderMonthBoard|renderYearBoard/);
    // 阳性对照：共享层那枚容器确实在（否则上面会因为"根本没这东西"而假绿）。
    const shared = stripComments(read(SHARED_BOARD));
    expect(shared, '共享层的容器不见了').toMatch(/export function HabitTrendBoard/);
  });

  it('N2 🔴 年的数不在宿主算：移动端一处都不许直接调那两份算式', () => {
    /* 点名三个坏形状（不是"看着不像在算"）：
       · 直接调 `computeHabitPeriodStats` / `habitYearRows` 自己拼卡；
       · 自己按 `date.slice(0, 7)` 给 logs 分组。
       年那一档的唯一取数出口是共享容器 → `HabitYearBoard` → `@heyta/domain`。 */
    for (const [where, src] of [
      ['详情层', screen],
      ['文案层', display],
    ] as const) {
      expect(src, `${where} 自己算了月度数`).not.toMatch(/computeHabitPeriodStats\(/);
      expect(src, `${where} 自己算了年度行`).not.toMatch(/habitYearRows\(/);
      expect(src, `${where} 自己按月份分组日志`).not.toMatch(/slice\(0,\s*7\)/);
    }
  });

  it('N3 年那一档的文案全走词条，中英同时', () => {
    const keys = [
      'web.habits.year.grid',
      'web.habits.year.achieved',
      'web.habits.year.rate',
      'web.habits.year.none',
      'web.habits.year.future',
      'web.habits.year.card',
      'web.habits.year.summary',
    ];
    for (const key of keys) {
      expect(display, `移动端没消费 ${key}`).toContain(`'${key}'`);
      expect(read('packages/i18n/src/locales/zh-CN.ts'), `zh 少了 ${key}`).toContain(`'${key}'`);
      expect(read('packages/i18n/src/locales/en.ts'), `en 少了 ${key}`).toContain(`'${key}'`);
    }
    expect(screen, 'JSX 里有硬编码中文').not.toMatch(/>\s*[\u4e00-\u9fa5]{2,}\s*</);
  });

  it('N4 🔴 档位名取共享层那一张表，移动端没再抄一份「月/年」', () => {
    expect(display, '没引用共享层的档位表').toMatch(/CALENDAR_VIEW_LABEL_KEYS/);
    // 反向：不许出现第二张"档位叫什么"的字面量表。
    expect(display, '自己抄了一张档位名表').not.toMatch(/\[\s*'月'\s*,\s*'年'\s*\]/);
    expect(screen, '详情层自己抄了一张档位名表').not.toMatch(/\[\s*'月'\s*,\s*'年'\s*\]/);
    // 阳性对照：那张表在共享层真的存在，而且它把四档都盖住（`Record<CalendarViewKind, …>`）。
    const model = stripComments(read('packages/ui/src/calendar/model.ts'));
    expect(model, '共享层的档位表不见了').toMatch(/export const CALENDAR_VIEW_LABEL_KEYS/);
  });

  it('N5 全壳容器挂载点恰好一枚（多了就是各持一枚游标）', () => {
    const hits = mobileSources()
      .filter((rel) => stripComments(read(rel)).includes('<HabitTrendBoard'))
      .sort();
    expect(hits, `挂载点不是恰好一处：${hits.join(' , ')}`).toEqual([SCREEN]);
  });
});
