/**
 * 成长视图的六次投影必须记忆化（P0-6 的 web 半）
 * ==============================================
 *
 * ## 贵在哪
 *
 * `GrowthView` 里那六次投影（今日 / 周复盘 / 总量 / 里程碑 / 身份标签 / 365 天热力）
 * 每一次都要把 op-log 物化状态**整片摊成数组**再喂给领域层。
 * 它们原先直接写在组件体里 ⇒ **任何一次重渲染**都重跑一遍，
 * 而这一屏所在的那棵树有非常多的重渲染源（同步状态、语言、store 任意字段、
 * 60 秒一次的 `now`）。移动端 `GrowthScreen.tsx:173/194/198/211` 一直是
 * `useMemo` 写法 —— 这次是向它对齐，不是发明。
 *
 * ## 三条腿
 *
 * 计数桩按"每个投影被调了几次"读，所以它必须同时证明：
 *
 *   1. **首挂载每个都调过** —— 桩接上了、视图真的在算（否则下面那个 0 是假的）；
 *   2. **输入没变的重渲染 = 一次都不再调** —— 正题；
 *   3. **`now` 变了要重算** —— 正向对照：记忆化没有把界面冻在旧数字上。
 *
 * 🔴 第 3 条同时也是这一刀的**边界声明**：那个每 60 秒的 `now` 是**输入**，
 * 记忆化按定义必须重算。也就是说这一条判据在替我把话说清楚 ——
 * "每分钟那一轮"没有被这里修掉，它要靠 `§8` 第 14 步（`habit-streak` 改成按记录数走）
 * 或"这些投影吃不吃一天以内的精度"的审计，那是行为变更、不是缓存。
 */

import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const counter = vi.hoisted(() => ({ calls: {} as Record<string, number> }));

/** 计数并委托真实现：返回值必须是**真的**，否则"没重算"可能只是"没算过"。 */
function count<A extends unknown[], R>(name: string, fn: (...args: A) => R) {
  return (...args: A): R => {
    counter.calls[name] = (counter.calls[name] ?? 0) + 1;
    return fn(...args);
  };
}

vi.mock('../src/features/motivation/selectors.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/features/motivation/selectors.js')>();
  return {
    ...real,
    selectTodayProgress: count('selectTodayProgress', real.selectTodayProgress),
    selectWeeklyReview: count('selectWeeklyReview', real.selectWeeklyReview),
    selectTotals: count('selectTotals', real.selectTotals),
    selectMilestones: count('selectMilestones', real.selectMilestones),
    selectIdentityTags: count('selectIdentityTags', real.selectIdentityTags),
  };
});

vi.mock('@heyta/app-host', async (importOriginal) => {
  const real = await importOriginal<typeof import('@heyta/app-host')>();
  return {
    ...real,
    dailyActivityCountsFromState: count(
      'dailyActivityCountsFromState',
      real.dailyActivityCountsFromState,
    ),
  };
});

const { GrowthView } = await import('../src/features/motivation/GrowthView.js');
const { useTaskStore } = await import('../src/features/tasks/store.js');
const { I18nProvider } = await import('@heyta/i18n');
const { HeytaUiProvider } = await import('@heyta/ui');

const PROJECTED = [
  'selectTodayProgress',
  'selectWeeklyReview',
  'selectTotals',
  'selectMilestones',
  'selectIdentityTags',
  'dailyActivityCountsFromState',
] as const;

/** 输入里带 `now` 的三个：`now` 变了必须重算。 */
const NOW_DEPENDENT = [
  'selectTodayProgress',
  'selectWeeklyReview',
  'selectIdentityTags',
  'dailyActivityCountsFromState',
] as const;

/** 输入里**没有** `now` 的两个：60 秒那一跳不该把它们一起拖着重算。 */
const NOT_NOW_DEPENDENT = ['selectTotals', 'selectMilestones'] as const;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function tree(): ReactElement {
  return (
    <I18nProvider locale="zh-CN">
      <HeytaUiProvider>
        <GrowthView />
      </HeytaUiProvider>
    </I18nProvider>
  );
}

function render(): void {
  act(() => {
    root!.render(tree());
  });
}

const totalCalls = (): number =>
  PROJECTED.reduce((sum, name) => sum + (counter.calls[name] ?? 0), 0);

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
  counter.calls = {};
});

describe('🔴 GrowthView 的六次投影按 `entities`/`now` 记忆化', () => {
  it('首挂载每个都算过 → 输入没变的重渲染一次都不再算', () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);

    render();

    // ① 活体证据：六个投影逐个都得有读数。少一个就说明桩没接上那一个，
    //    而"下面那个 0"就会变成"有一条根本没被观察到"。
    for (const name of PROJECTED) {
      expect(counter.calls[name] ?? 0, `${name} 首挂载没被调用 ⇒ 计数桩没接上`).toBeGreaterThanOrEqual(
        1,
      );
    }

    // ② 正题：连打三次相同输入，投影不许再跑
    counter.calls = {};
    render();
    render();
    render();
    expect(
      totalCalls(),
      `输入没变却重跑了 ${totalCalls()} 次投影 —— 每一轮重渲染都把五张表重摊一遍`,
    ).toBe(0);
  });

  it('`now` 变了必须重算（记忆化不许把界面冻在旧数字上）', () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);

    render();
    counter.calls = {};

    const before = useTaskStore.getState().now;
    act(() => {
      useTaskStore.setState({ now: before + 60_000 });
    });

    // 🔴 **逐个断，不数总数**：吃 `now` 的投影有三个，只断"总数 ≥ 1"的话，
    //    任何一个重算都会把它喂绿 —— 另外两个被冻在旧数字上照样看不见。
    for (const name of NOW_DEPENDENT) {
      expect(
        counter.calls[name] ?? 0,
        `\`${name}\` 的输入里有 \`now\`，推进 60 秒却没重算 ⇒ 记忆过头，界面停在旧数字`,
      ).toBeGreaterThanOrEqual(1);
    }

    // 🔴 反过来也要有牙：不吃 `now` 的两个不该被那一跳拖着重算。
    //    这一条是这次改动**真正省下来的那部分**，只断上面那段就照不出它。
    for (const name of NOT_NOW_DEPENDENT) {
      expect(
        counter.calls[name] ?? 0,
        `\`${name}\` 的输入里没有 \`now\`，却跟着 60 秒那一跳重算了`,
      ).toBe(0);
    }
  });
});
