/**
 * 共享 `GrowthBoard` 在 web 壳里的**组合契约**测试
 * =================================================
 *
 * 🔴 为什么需要这个文件：`motivation-view.spec.tsx` 挂的是真 `<App />`、
 * 走真 op-log —— 它证明"换了装之后成长页还能用"。但成长页**刻意**关掉了
 * `showToday` / `showStreaks` 两块（web 迁移前就没有，见 `GrowthView` 文件头），
 * 于是"开关到底有没有生效""插槽会不会出现"在真 App 里**恰好都看不到**。
 *
 * 所以这里直接挂共享 composer，用可控 props 把四条契约钉住：
 *   1. 真的渲染了内容（不是空 div）；
 *   2. `showToday` 开关生效（默认开 → 有关；显式 false → 无）；
 *   3. `renderCategoryBreakdown` 插槽在原位出现 / 省略时不出现；
 *   4. `activityDays` 传了才渲染年度热力图，且格子数 = 传入天数。
 *
 * ⚠️ 这里**不重复**共享层纯函数的断言（那些在
 * `packages/ui/tests/motivation-model.spec.ts`）；本文件只测**宿主组合**。
 *
 * ⚠️ `GrowthBoard` 会 `useHeytaTokens()`，所以必须包在 `<HeytaUiProvider>` 内。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { habitGrowth, identityTagsFromState, milestonesFromState, todayProgressFromState, weeklyReviewFromState } from '@heyta/app-host';
import { translate, type I18nValue } from '@heyta/i18n';
import { GrowthBoard, HeytaUiProvider, type GrowthBoardLabels } from '@heyta/ui';

import { growthBoardLabels } from '../src/features/motivation/GrowthView.js';

/** 稳定的"现在"：2026-09-24（周四）10:00 本地时间 —— 与 motivation.spec.ts 同一个。 */
const NOW = new Date(2026, 8, 24, 10, 0, 0).getTime();

/** 空库。共享 composer 不碰业务判断，空输入也该画出一屏"还没有记录"。 */
const EMPTY = {
  habits: {},
  habitLogs: {},
  tasks: {},
  projects: {},
  focusSessions: {},
} as const;

const t: I18nValue['t'] = (key, vars) => translate('zh-CN', key, vars);

let container: HTMLDivElement | undefined;
let root: Root | undefined;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
});

function renderBoard(over: {
  showToday?: boolean;
  activityDays?: readonly { date: string; count: number }[];
  withCategory?: boolean;
}): HTMLElement {
  const labels: GrowthBoardLabels = growthBoardLabels(t);
  act(() => {
    root = createRoot(container!);
    root.render(
      <HeytaUiProvider>
        <GrowthBoard
          now={NOW}
          todayProgress={todayProgressFromState(EMPTY, NOW)}
          weeklyReview={weeklyReviewFromState(EMPTY, NOW)}
          milestones={milestonesFromState(EMPTY)}
          identityTags={identityTagsFromState(EMPTY, NOW)}
          habits={[]}
          logs={[]}
          growth={habitGrowth}
          {...(over.activityDays === undefined ? {} : { activityDays: over.activityDays })}
          labels={labels}
          {...(over.showToday === undefined ? {} : { showToday: over.showToday })}
          {...(over.withCategory === true
            ? { renderCategoryBreakdown: () => <div data-testid="probe-category">分类块</div> }
            : {})}
          testID="growth-board"
        />
      </HeytaUiProvider>,
    );
  });
  return container!;
}

describe('GrowthBoard：共享 composer 的组合契约', () => {
  it('真的把区块渲染出来了（不是空 div）', () => {
    const view = renderBoard({});
    const board = view.querySelector('[data-testid="growth-board"]');
    expect(board, '必须能按 testID 找到成长板').not.toBeNull();
    // 空库下周复盘说的是"这一周还没有记录"（`web.growth.week.empty`）。
    expect(view.textContent ?? '').toContain(translate('zh-CN', 'web.growth.week.empty'));
    // 里程碑有四块（领域层恒非空），至少要有"打卡"这个维度名。
    expect(view.textContent ?? '').toContain(translate('zh-CN', 'web.growth.kind.checkIns'));
    expect((board?.textContent ?? '').trim().length).toBeGreaterThan(0);
  });

  it('showToday 开关生效：默认渲染今日进度，显式 false 时整块消失', () => {
    // 空库下今日进度的 hint 是 `web.progress.hint.idle`。
    const idle = translate('zh-CN', 'web.progress.hint.idle');

    const on = renderBoard({});
    expect(on.textContent ?? '', '默认（省略 showToday）应当渲染今日进度').toContain(idle);
    act(() => {
      root?.unmount();
    });
    root = undefined;

    const off = renderBoard({ showToday: false });
    expect(off.textContent ?? '', 'showToday=false 时今日进度必须消失').not.toContain(idle);
  });

  it('renderCategoryBreakdown 插槽：给了就出现在原位，省略就不出现', () => {
    const withSlot = renderBoard({ withCategory: true });
    expect(withSlot.querySelector('[data-testid="probe-category"]')).not.toBeNull();
    act(() => {
      root?.unmount();
    });
    root = undefined;

    const withoutSlot = renderBoard({});
    expect(withoutSlot.querySelector('[data-testid="probe-category"]')).toBeNull();
  });

  it('activityDays 传了才渲染热力图，格子数 = 传入天数', () => {
    const withoutDays = renderBoard({});
    expect(
      withoutDays.querySelectorAll('[data-testid^="activity-cell-"]').length,
      '省略 activityDays 时不许渲染年度热力图（mobile 迁移前就没有年度视图）',
    ).toBe(0);
    act(() => {
      root?.unmount();
    });
    root = undefined;

    const days = [
      { date: '2026-09-22', count: 0 },
      { date: '2026-09-23', count: 1 },
      { date: '2026-09-24', count: 3 },
    ];
    const withDays = renderBoard({ activityDays: days });
    expect(withDays.querySelectorAll('[data-testid^="activity-cell-"]')).toHaveLength(3);
    // 分档由共享层内部做：count=3 → level=3，格子必须真的上色（不是全透明）。
    const colored = withDays.querySelector('[data-testid="activity-cell-2026-09-24"]');
    expect(colored?.getAttribute('style') ?? '').toMatch(/background-color:\s*rgb\(/u);
  });
});
