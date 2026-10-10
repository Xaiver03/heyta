/**
 * `calendarDayMarkerView` —— 公共事实"休 / 班"标记的唯一判断（W4b，ADR-0052 §2.6）
 * =====================================================================
 *
 * ## 为什么判据在 model 而不是在组件
 *
 * `packages/ui/vitest.config.ts` 文件头写着这个包**刻意不 render 组件**（不引 jsdom、
 * 不引 testing-library）："把有判断的逻辑放进 model.ts，用 node 环境一次测穿它，
 * 组件里只留没有分支的摆放层"。所以 `dayMarker` 的三档语义全在这个纯函数里，
 * `CalendarBoard` 只把返回的东西摆到 RN 原语上。
 *
 * ## 这四条各自挡什么
 *
 * 1. **默认腿**：`kind === undefined ⇒ undefined`。宿主没接 `dayMarker` 时组件拿到
 *    `undefined` 就一个节点都不画。这一条挡住"默认值悄悄带了视觉变化"。
 * 2. **两种说法必须长得不一样**：休息日与补班日如果映射到同一个 token，那这枚标记
 *    等于没有 —— 而"两个分支都存在、颜色却一样"是渲染层看不出来的。
 * 3. 🔴 **词表没给 ⇒ 只降级成一颗点，而且不许进读屏**。这一条同时钉两个方向：
 *    点要画出来（不能静默什么都不画，那样"宿主忘了给词表"与"这天没有说法"长得一模一样），
 *    但**读屏名里不许出现那颗点**（念成"圆点"是噪声）。
 * 4. **部分词表**（只给了 `off` 却问 `work`）也走降级，而不是抛出 `undefined` 字符
 *    或留下一个空 Text —— 空 Text 在界面上的表现与"没有标记"无法区分。
 */
import { describe, expect, it } from 'vitest';

import { calendarDayMarkerView, type CalendarDayMarker } from '../src/calendar/model.js';

const LABELS = { off: '休', work: '班' } as const;

describe('calendarDayMarkerView', () => {
  it('默认腿：这一天没有说法时返回 undefined（组件因此一个节点都不画）', () => {
    expect(calendarDayMarkerView(undefined, LABELS)).toBeUndefined();
    // 词表给了也一样不画 —— 决定画不画的是 `kind`，不是词表在不在。
    expect(calendarDayMarkerView(undefined, undefined)).toBeUndefined();
  });

  it('休与班各走自己的语义色，且字取宿主的词表', () => {
    const off = calendarDayMarkerView('off', LABELS);
    const work = calendarDayMarkerView('work', LABELS);

    expect(off).toBeDefined();
    expect(work).toBeDefined();
    expect(off?.text).toBe('休');
    expect(work?.text).toBe('班');
    expect(off?.spoken).toBe('休');
    expect(work?.spoken).toBe('班');

    // 🔴 两条必须**不相等**：同一个 token 时这枚标记对色觉正常的人也是废的。
    expect(off?.colorToken).not.toBe(work?.colorToken);
    // 而且只能是语义名（出现裸色/外观名就是违反 AGENTS §5 第 1 条）。
    const allowed: readonly string[] = ['color.calendar-day-off', 'color.calendar-day-work'];
    expect(allowed).toContain(off?.colorToken);
    expect(allowed).toContain(work?.colorToken);
  });

  it('词表没给：点还是要画，但绝不进读屏名', () => {
    const view = calendarDayMarkerView('work', undefined);
    expect(view, '没词表就整个不画 —— 那会让"宿主忘了接"与"这天没有说法"长得一模一样').toBeDefined();
    expect(view?.text).toBe('●');
    expect(view?.spoken, '那颗点被念出来就是噪声').toBeUndefined();
  });

  it('词表只给了一半：缺的那一档同样走降级，不抛也不给空字', () => {
    const kinds: readonly CalendarDayMarker[] = ['off', 'work'];
    const half = { off: '休' } as unknown as Readonly<{ off: string; work: string }>;

    for (const kind of kinds) {
      const view = calendarDayMarkerView(kind, half);
      expect(view).toBeDefined();
      expect(view?.text ?? '', `${kind} 那一档画出了空字`).not.toBe('');
    }
    expect(calendarDayMarkerView('off', half)?.text).toBe('休');
    expect(calendarDayMarkerView('work', half)?.text).toBe('●');
  });
});
