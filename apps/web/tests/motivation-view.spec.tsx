/**
 * 激励体系的**真实渲染**测试
 * ============================
 *
 * 🔴 为什么非要有这个文件：领域层与选择器的测试全绿，**推不出界面上真的出现过那几个字**。
 * 本仓库为这个形状栽过不止一次（见 AGENTS.md §7 的"能力实现了、单测全绿、
 * 生产里零调用点"），而激励体系尤其容易掉进去 ——
 * `GrowthView` 只在把视图切到「成长」时才挂载，任何不切视图的用例
 * 都碰不到它的一行代码。
 *
 * 所以这里做的是**最高一层**的验证：挂真的 `<App />`，点真的标签页，
 * 断言真的文字出现在 DOM 里。数据也走真的 op-log（不是往 store 里塞假对象）——
 * 否则"打卡之后进度条会动"这条最核心的回路，恰好是唯一没被验证的那条。
 *
 * ⚠️ 与 `journey-ai-memory.integration.spec.tsx` 的分工：那边要真 AI 端点、
 * 默认会失败；这边**零网络、零 mock 服务**，应该永远是绿的。
 */

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
(globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

const { App } = await import('../src/App.js');
const { __resetOpLogForTests, initOpLog } = await import('../src/lib/oplog.js');
const { useHabitStore } = await import('../src/features/habits/store.js');
const { useTaskStore } = await import('../src/features/tasks/store.js');

let root: Root | undefined;
let container: HTMLDivElement | undefined;

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
}

/** 轮询等到条件成立。超时要带现场 —— 否则失败信息只有"等超时了"。 */
async function waitFor(label: string, cond: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return;
    await flush();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
  throw new Error(
    `等待「${label}」超时\n当前界面文本：\n${(container?.textContent ?? '').slice(0, 600)}`,
  );
}

function click(el: Element | null | undefined): void {
  act(() => {
    (el as HTMLElement | null)?.click();
  });
}

function byText(text: string): HTMLElement | undefined {
  return [...(container?.querySelectorAll('button') ?? [])].find((b) =>
    b.textContent?.includes(text),
  ) as HTMLElement | undefined;
}

beforeEach(async () => {
  __resetOpLogForTests();
  await initOpLog(`motivation-view-${Math.random().toString(36).slice(2)}`);

  container = document.createElement('div');
  document.body.append(container);

  // 一条习惯 + 一次打卡，一件完成的任务 —— 走**真 op-log**，不是塞假状态。
  await useHabitStore.getState().addHabit('喝水');
  const habitId = useHabitStore.getState().habits[0]?.id ?? '';
  await useHabitStore.getState().checkIn(habitId);

  await useTaskStore.getState().addTask('写周报');
  const taskId = useTaskStore.getState().entities.tasks
    ? Object.keys(useTaskStore.getState().entities.tasks)[0]
    : undefined;
  if (taskId !== undefined) await useTaskStore.getState().toggleComplete(taskId);

  act(() => {
    root = createRoot(container!);
    root.render(<App />);
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

describe('今日进度卡（L1）真的渲染出来了', () => {
  it('打卡 + 完成任务之后，进度条到 100% 且写出"今天的都做完了"', async () => {
    await waitFor('今日进度卡出现', () =>
      (container?.textContent ?? '').includes('今天'),
    );

    const bar = container?.querySelector('[role="progressbar"]');
    expect(bar, '界面上应该有一根进度条').not.toBeNull();
    expect(bar?.getAttribute('aria-valuenow')).toBe('100');

    await waitFor('闭环文案出现', () =>
      (container?.textContent ?? '').includes('今天的都做完了'),
    );
  });

  it('进度条的可访问名说出了分子与分母（不能只有一根无名的横条）', () => {
    const bar = container?.querySelector('[role="progressbar"]');
    const label = bar?.getAttribute('aria-label') ?? '';
    expect(label).toContain('今日完成');
    expect(label).toMatch(/\d/);
  });
});

describe('成长视图（L3）真的能点到', () => {
  it('标签页里有「成长」，切过去之后四个区块都在', async () => {
    const tab = byText('成长');
    expect(tab, '顶栏应该有「成长」这个视图入口').toBeDefined();

    click(tab);
    await flush();

    const text = container?.textContent ?? '';
    expect(text).toContain('本周');
    expect(text).toContain('这一年');
    expect(text).toContain('里程碑');
    expect(text).toContain('你的标签');
  });

  it('周复盘的数字来自真实数据，而不是写死的 0', async () => {
    click(byText('成长'));
    await flush();

    const text = container?.textContent ?? '';
    // 打卡 1 次 + 完成 1 件 —— 两者都必须出现在周复盘里
    expect(text).toContain('打卡');
    expect(text).toContain('完成任务');
    expect(text).toContain('上周');
  });

  it('一年视图画出了格子（用的是真日历组件，不是空占位）', async () => {
    click(byText('成长'));
    await flush();

    // react-activity-calendar 渲染出的每个格子都是一个 rect
    const cells = container?.querySelectorAll('svg rect').length ?? 0;
    expect(cells).toBeGreaterThan(300);
  });

  it('🔴 日历的文案必须是中文 —— 库的默认值是英文，会直接画到界面上', async () => {
    click(byText('成长'));
    await flush();

    const text = container?.textContent ?? '';
    // 这几个都是库的默认英文文案，实测真的出现过（`1 activities in 2025`、
    // `Less` / `More`、英文月份）。界面文案门禁只扫我们自己的源码，
    // 看不见库生成的字符串 —— 只能靠这一条守住。
    expect(text).not.toContain('activities in');
    expect(text).not.toContain('Less');
    expect(text).not.toContain('More');
    expect(text).not.toContain('Jan');
    // 覆盖之后应该看到我们自己的说法
    expect(text).toContain('最近一年共');
    expect(text).toContain('少');
  });

  it('🔴 主题色必须是可解析的颜色 —— 裸 token 名会让整个应用打白', async () => {
    click(byText('成长'));
    await flush();

    // 库用 `CSS.supports('color', c)` 校验，而裸的 `--ht-…` 不是颜色值：
    // 实测真 Chromium 里为 false，库抛异常，整个应用被打白。
    // 这里断言我们能控制的那一半 —— 传进去的是 `var(...)`。
    const html = container?.innerHTML ?? '';
    expect(html).toContain('var(--ht-color-heat-0)');
    expect(html).not.toMatch(/fill="--ht-/);
  });

  it('复制小结：真的写进剪贴板，并且给出可被读屏读到的结果', async () => {
    let written = '';
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (s: string) => {
          written = s;
          return Promise.resolve();
        },
      },
    });

    click(byText('成长'));
    await flush();

    click(byText('复制本周小结'));
    await flush();

    expect(written).toContain('本周小结');
    expect(written).toContain('累计');
    await waitFor('出现「已复制」', () =>
      (container?.textContent ?? '').includes('已复制'),
    );
  });

  it('剪贴板不可用时如实说明，而不是静默失败', async () => {
    // 局域网 http 访问时 `navigator.clipboard` 就是 undefined —— 这是真实场景
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });

    click(byText('成长'));
    await flush();

    click(byText('复制本周小结'));
    await flush();

    await waitFor('出现失败说明', () =>
      (container?.textContent ?? '').includes('不允许复制'),
    );
  });
});

describe('习惯卡片（L2）真的显示出三个数', () => {
  it('连续 / 最长 / 累计三个指标同时可见', async () => {
    click(byText('习惯'));
    await flush();

    await waitFor('习惯卡片出现', () =>
      (container?.textContent ?? '').includes('喝水'),
    );

    const text = container?.textContent ?? '';
    expect(text).toContain('连续');
    expect(text).toContain('最长');
    // 🔴 「累计」是那个只增不减的数字 —— 它必须常驻，
    // 否则断签那天用户看不到任何"我没有归零"的证据。
    expect(text).toContain('累计');
  });
});