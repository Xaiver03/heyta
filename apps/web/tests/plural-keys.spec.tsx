/**
 * 英文单复数词条对 + 调用点分支
 * ==============================
 *
 * 🔴 词条表**刻意不支持复数/ICU**（理由见 `packages/i18n/src/types.ts`）。
 * 做法是**调用方按数量分支到单数兄弟词条**，落点见 `apps/mobile/tests/plural-keys.spec.ts`。
 *
 * 这个文件钉住两件事：
 *   1. **词条内容**：单数词条里不能再出现复数的名词（"1 changes" 看起来
 *      仍然通顺，所以只有显式断住坏形状才有用）；中文的单数版与复数版
 *      **刻意逐字相同**（中文不分单复数，不相同才是漏翻）。
 *   2. **真的有一个调用点在分支**：`SyncBar` 的冲突状态文案用真实渲染跑过
 *      1 与 N 两种输入 —— 光有单数词条、调用点不分支，等于没有修。
 *
 *   ⚠️ 其余调用点（`FocusTimer` / `HabitsView` / `ConflictDialog`）的分支
 *   在各自的组件里，这里不重复渲染它们；那些入口由 `tsc` +
 *   `check-ui-language` 兜着（与移动端同一分工）。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { I18nProvider, translate } from '@heyta/i18n';
import type { ConflictInfo } from '@heyta/sync-client';

import { SyncBar } from '../src/features/sync/SyncBar.js';
import { useSyncStore } from '../src/features/sync/store.js';
import { GanttChart } from '../src/features/timeline/GanttChart.js';
import { TimelineView } from '../src/features/timeline/TimelineView.js';
import type { TimelineEntry } from '../src/features/timeline/buildTimeline.js';

const zh = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>): string =>
  translate('zh-CN', key, vars);
const en = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>): string =>
  translate('en', key, vars);

describe('单数兄弟词条（词条内容）', () => {
  it('sync.status.conflict：1 处改动是 `1 change`', () => {
    expect(en('web.sync.status.conflictOne', { count: 1 })).toBe('1 change needs your review');
    expect(en('web.sync.status.conflict', { count: 3 })).toBe('3 changes need your review');
    expect(en('web.sync.status.conflictOne', { count: 1 })).not.toContain('1 changes');
    // 中文两条刻意相同。
    expect(zh('web.sync.status.conflictOne', { count: 1 })).toBe(
      zh('web.sync.status.conflict', { count: 1 }),
    );
  });

  it('focus.completedToday：1 个专注是 `1 focus session`', () => {
    expect(en('web.focus.completedTodayOne', { count: 1 })).toBe(
      'Completed 1 focus session today',
    );
    expect(en('web.focus.completedToday', { count: 3 })).toBe(
      'Completed 3 focus sessions today',
    );
    expect(en('web.focus.completedTodayOne', { count: 1 })).not.toContain('1 focus sessions');
    expect(zh('web.focus.completedTodayOne', { count: 1 })).toBe(
      zh('web.focus.completedToday', { count: 1 }),
    );
  });

  it('habits.streak：连续 1 天是 `1 day`，最长同理', () => {
    expect(en('web.habits.streak.currentOne', { count: 1 })).toBe('Streak 1 day');
    expect(en('web.habits.streak.current', { count: 5 })).toBe('Streak 5 days');
    expect(en('web.habits.streak.currentOne', { count: 1 })).not.toContain('1 days');

    expect(en('web.habits.streak.longestOne', { count: 1 })).toBe('Longest 1 day');
    expect(en('web.habits.streak.longest', { count: 12 })).toBe('Longest 12 days');
    expect(en('web.habits.streak.longestOne', { count: 1 })).not.toContain('1 days');

    expect(zh('web.habits.streak.currentOne', { count: 1 })).toBe(
      zh('web.habits.streak.current', { count: 1 }),
    );
    expect(zh('web.habits.streak.longestOne', { count: 1 })).toBe(
      zh('web.habits.streak.longest', { count: 1 }),
    );
  });

  it('conflict.title：只有 1 处冲突时不说 `these 1 places`', () => {
    // 单数版的英文**不用数字**（"this one place"），所以不能只写
    // `not.toContain('1 places')` —— 直接钉住整句。
    expect(en('web.conflict.titleOne')).toBe('Both sides changed this one place');
    expect(en('web.conflict.title', { count: 3 })).toBe('Both sides changed these 3 places');
    expect(en('web.conflict.titleOne')).not.toContain('places');
    expect(zh('web.conflict.titleOne', { count: 1 })).toBe(
      zh('web.conflict.title', { count: 1 }),
    );
  });
});

// ── 调用点真的在分支：渲染 SyncBar，跑 1 与 N ──────────────────

function makeConflict(id: string): ConflictInfo {
  return {
    id,
    entityType: 'TASK',
    entityId: 't1',
    reason: 'Concurrent modification detected for TASK:t1',
    local: {
      opId: `${id}-local`,
      clientId: 'device-a',
      timestamp: 1_700_000_000_000,
      opType: 'UPD',
      payload: { title: 'A' },
    },
    remote: undefined,
  };
}

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function renderEn(node: React.ReactNode = <SyncBar />): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<I18nProvider locale="en">{node}</I18nProvider>);
  });
  return container;
}

/** 卸载并清场，方便同一个测试里再渲染一次。 */

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
  useSyncStore.setState({ status: { kind: 'idle' }, conflictDialogOpen: false });
});

describe('SyncBar 的冲突文案把分支真的走了', () => {
  it('🔴 1 处冲突渲染单数，不说 `1 changes`', () => {
    useSyncStore.setState({ status: { kind: 'conflict', conflicts: [makeConflict('c1')] } });
    const el = renderEn();
    expect(el.textContent).toContain('1 change needs your review');
    expect(el.textContent).not.toContain('1 changes');
  });

  it('N 处冲突渲染复数', () => {
    useSyncStore.setState({
      status: { kind: 'conflict', conflicts: [makeConflict('c1'), makeConflict('c2')] },
    });
    const el = renderEn();
    expect(el.textContent).toContain('2 changes need your review');
  });
});

// ── 第三批新增的单数兄弟：时间线 / 甘特图 ────────────────────────
//
// 这几个 key 的数量**经常是 1**（"就一条任务""就一条未估时"是最常见的形态），
// 所以英文必须分支，否则界面上会出现 "1 items"。

/**
 * 构造一条最简的时间线条目（4 个字段就够，见 GanttChart 的 props）。
 *
 * ⚠️ 总时长是**时间轴的跨度**（最晚结束时刻），不是各条时长之和 ——
 * 默认都从 0 起排的话三条 60 分钟会重叠成 1 小时。要多条不重叠就传偏移。
 */
function entry(title: string, durationMinutes: number, startOffsetMinutes = 0): TimelineEntry {
  return { title, startOffsetMinutes, durationMinutes, durationSource: 'manual' };
}

describe('时间线 / 甘特图的单数兄弟词条', () => {
  it('gantt.span：1 条是 `1 item`，3 条是 `3 items`', () => {
    expect(en('web.gantt.spanOne', { count: 1, total: '1 h' })).toBe('1 item · total 1 h');
    expect(en('web.gantt.span', { count: 3, total: '6 h' })).toBe('3 items · total 6 h');
    expect(en('web.gantt.spanOne', { count: 1, total: '1 h' })).not.toContain('1 items');
    // 中文两条刻意逐字相同。
    expect(zh('web.gantt.spanOne', { count: 1, total: '1 小时' })).toBe(
      zh('web.gantt.span', { count: 1, total: '1 小时' }),
    );
  });

  it('gantt.aria.group 与三个汇总句也都是真兄弟', () => {
    expect(en('web.gantt.aria.groupOne', { count: 1, total: '1 h' })).toBe(
      'Timeline: 1 item, total 1 h',
    );
    expect(en('web.gantt.aria.group', { count: 2, total: '2 h' })).toBe(
      'Timeline: 2 items, total 2 h',
    );
    expect(en('web.gantt.unestimatedSummaryOne', { count: 1, duration: '1 h' })).toBe(
      '1 unestimated, using 1 h',
    );
    expect(en('web.gantt.unestimatedSummary', { count: 3, duration: '1 h' })).toBe(
      '3 unestimated, using 1 h',
    );
    expect(en('web.gantt.aiSummaryOne', { count: 1 })).toBe('1 scheduled with an AI estimate');
    expect(en('web.gantt.aiSummary', { count: 3 })).toBe('3 scheduled with AI estimates');
    // 单数版里不能再出现复数名词 —— "1 scheduled with AI estimates" 读起来也通顺，
    // 所以只有显式断住坏形状才有用。
    expect(en('web.gantt.aiSummaryOne', { count: 1 })).not.toContain('AI estimates');
    expect(zh('web.gantt.aiSummaryOne', { count: 1 })).toBe(
      zh('web.gantt.aiSummary', { count: 1 }),
    );
  });

  it('timeline.aria.group：1 条任务是 `1 task`', () => {
    expect(en('web.timeline.aria.groupOne', { count: 1 })).toBe('Timeline: 1 task');
    expect(en('web.timeline.aria.group', { count: 3 })).toBe('Timeline: 3 tasks');
    expect(en('web.timeline.aria.groupOne', { count: 1 })).not.toContain('1 tasks');
    expect(zh('web.timeline.aria.groupOne', { count: 1 })).toBe(
      zh('web.timeline.aria.group', { count: 1 }),
    );
  });
});

describe('🔴 调用点真的分支了（不只是"有单数词条"）', () => {
  it('甘特图：1 条走单数', () => {
    const one = renderEn(<GanttChart entries={[entry('A', 60)]} />);
    expect(one.querySelector('[data-testid="gantt-span"]')?.textContent).toBe(
      '1 item · total 1 h',
    );
    expect(one.querySelector('[data-testid="gantt-chart"]')?.getAttribute('aria-label')).toBe(
      'Timeline: 1 item, total 1 h',
    );
  });

  it('甘特图：3 条走复数', () => {
    const three = renderEn(
      <GanttChart
        entries={[entry('A', 60, 0), entry('B', 60, 60), entry('C', 60, 120)]}
      />,
    );
    expect(three.querySelector('[data-testid="gantt-span"]')?.textContent).toBe(
      '3 items · total 3 h',
    );
  });

  it('时间线：1 条任务的分组名是 `1 task`', () => {
    const el = renderEn(<TimelineView tasks={[{ id: 't1', title: 'A' }]} />);
    expect(el.querySelector('[data-testid="timeline-view"]')?.getAttribute('aria-label')).toBe(
      'Timeline: 1 task',
    );
  });
});
