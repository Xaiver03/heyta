/**
 * 分类色槽：**走真 op-log 的闭环**
 * ================================
 *
 * `categories.spec.tsx` 用 `useTaskStore.setState({ entities })` 塞假状态 ——
 * 那能证明"选择器算得对、组件画得对"，但**证明不了**这三段接线：
 *
 *   1. 取色器点下去 → store → `app-host` 的动作 → **真的写了一条 op**
 *   2. 那条 op 物化回来 → 习惯/清单的 `color` 真的变成 `"3"`
 *   3. 重新渲染之后，界面上那一行的槽位号真的从「无」变成「3」
 *
 * 本仓库为这个形状栽过不止一次（"能力实现了、单测全绿、生产里零调用点"），
 * 而取色器正是那种**每一层都测过、但没人测过它们接在一起**的东西：
 * 动作层测的是"调用它会写什么 op"，组件层测的是"传进去的值怎么画"，
 * 中间那一次 `onChange → void store.setHabitColor(...)` 谁都没碰过。
 *
 * ⚠️ 与 `motivation-view.spec.tsx` 同一份接线（真 `<App />` + 真 `LocaleHost`
 * + 真 IndexedDB），**不是**往 store 里塞对象。区别只在于这里盯的是颜色。
 */

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { enableModules } from './enable-all-modules.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
(globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

const { App } = await import('../src/App.js');
const { LocaleHost } = await import('../src/lib/locale-host.js');
const { __resetOpLogForTests, initOpLog } = await import('../src/lib/oplog.js');
const { useHabitStore } = await import('../src/features/habits/store.js');

let root: Root | undefined;
let container: HTMLDivElement | undefined;

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
}

function byText(text: string): HTMLElement | undefined {
  return [...(container?.querySelectorAll('button') ?? [])].find((b) =>
    b.textContent?.includes(text),
  ) as HTMLElement | undefined;
}

/** 同步点一下 —— 只用于切视图这种纯本地状态变化，不涉及落库。 */
function click(el: Element | null | undefined): void {
  act(() => {
    (el as HTMLElement | null)?.click();
  });
}

/**
 * 点一下，并**等异步动作落定**。
 *
 * 🔴 取色器的 `onClick` 里是 `void store.setHabitColor(...)` —— 一个**不等待**的
 * Promise。用同步的 `act(() => el.click())` 会留下一个还在飞的 op，
 * 它会在**下一个用例的 beforeEach 重置引擎之后**才去 `currentState()`，
 * 于是报「op-log 引擎尚未初始化」—— 而那看起来像产品 bug，其实是测试没收尾。
 * （实测症状：单条用例断言失败 + 一条 Unhandled Rejection。）
 */
async function clickAndSettle(el: Element | null | undefined): Promise<void> {
  await act(async () => {
    (el as HTMLElement | null)?.click();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 20));
  });
}

/** 轮询等条件成立。超时要带现场，否则失败信息只有"等超时了"。 */
async function waitFor(label: string, cond: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
  throw new Error(`等待「${label}」超时；当前界面文本：\n${(container?.textContent ?? '').slice(0, 400)}`);
}

beforeEach(async () => {
  // 这些用例要走「成长/番茄钟/便签」——它们默认是关的（见 enable-all-modules.ts）。
  enableModules(['growth']);
  __resetOpLogForTests();
  await initOpLog(`category-colors-${Math.random().toString(36).slice(2)}`);

  container = document.createElement('div');
  document.body.append(container);

  // 一条**按分钟计**的习惯 + 一次打卡，全走真 op-log。
  // （按分钟计是刻意的：只有它能给分类时长贡献数字 —— 见 `MINUTE_UNITS`。）
  await useHabitStore.getState().addHabit('跑步', { unit: '分钟', target: 30 });
  const habitId = useHabitStore.getState().habits[0]?.id ?? '';
  await useHabitStore.getState().checkIn(habitId);

  act(() => {
    root = createRoot(container!);
    root.render(
      <LocaleHost>
        <App />
      </LocaleHost>,
    );
  });
  await flush();
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
});

describe('从界面选一个色槽，最后真的出现在成长视图里', () => {
  it('习惯卡片上的取色器 → op → 物化 → 成长视图那一行带上槽位号', async () => {
    // 先切到习惯视图（默认落在任务视图）。
    click(byText('习惯'));
    await flush();

    const toggle = container?.querySelector('.ht-slot-picker__toggle');
    expect(toggle, '习惯卡片上应该有取色器入口').not.toBeNull();

    await clickAndSettle(toggle);

    // 用 **aria-label** 找槽位，不用位置：位置会在加槽位时漂移。
    const slot3 = container?.querySelector('[aria-label="色槽 3"]');
    expect(slot3, '展开后应该有 8 个槽位').not.toBeNull();

    await clickAndSettle(slot3);

    // 1 + 2：op 真的落了、状态真的变了（**轮询**，因为落库是异步的 ——
    // 单次 flush 会在"大多数时候够快"里掩盖一个真实的竞态）。
    await waitFor('槽位写进实体', () => useHabitStore.getState().habits[0]?.color === '3');

    // 3：成长视图那一行真的带着这个号。
    click(byText('成长'));
    await flush();

    const text = container?.textContent ?? '';
    expect(text).toContain('分类时长');
    expect(text).toContain('跑步');
    expect(text).toContain('30 分钟');
    const lane = container?.querySelector('[data-testid="category-lane"]');
    expect(lane?.textContent, '行首要写出槽位号（颜色只是加速器）').toContain('3');
  });

  it('再点一次同一个槽位 = 清除，并且界面上真的回到「无」', async () => {
    click(byText('习惯'));
    await flush();

    await clickAndSettle(container?.querySelector('.ht-slot-picker__toggle'));
    await clickAndSettle(container?.querySelector('[aria-label="色槽 3"]'));
    await waitFor('槽位写进实体', () => useHabitStore.getState().habits[0]?.color === '3');

    await clickAndSettle(container?.querySelector('.ht-slot-picker__toggle'));
    await clickAndSettle(container?.querySelector('[aria-label="色槽 3"]'));

    // 🔴 清除走的是 `color: null`，物化之后字段**消失** ——
    // 于是它回到"无颜色"，而不是回到 1 号槽位。
    await waitFor('清除生效', () => useHabitStore.getState().habits[0]?.color === undefined);

    click(byText('成长'));
    await flush();
    const lane = container?.querySelector('[data-testid="category-lane"]');
    // 没设色的行**照样显示**（时长与名字都在），只是没有颜色。
    expect(lane?.textContent).toContain('跑步');
    expect(lane?.textContent).toContain('30 分钟');
  });

  it('🔴 分类那一块里没有任何排名或褒贬词（真渲染，不是只看源码）', async () => {
    click(byText('成长'));
    await flush();

    // ⚠️ 范围是**分类这一节**，不是整页。
    // 成长视图的周复盘里有「这周打卡最多：N 次」—— 那是**周复盘**在说
    // "本周哪一项做得多"（一个中性事实句，已随激励体系上线）；
    // 本特性禁的是**分类之间**的比较（"最差的分类""占比"），两者不是一回事。
    // 第一版把范围写成整页，于是它对着那句已有的文案报红 ——
    // **断言的范围写错，会让一条正确的断言看起来像产品缺陷。**
    const text = container?.querySelector('.ht-categories')?.textContent ?? '';
    expect(text, '分类那一节必须真的渲染出来了（否则这条断言是空转）').toContain('分类时长');
    for (const banned of ['最多', '最少', '最差', '排名', '占比', '超标', '失衡', '第一名']) {
      expect(text, `成长视图里不该出现「${banned}」`).not.toContain(banned);
    }
  });
});
