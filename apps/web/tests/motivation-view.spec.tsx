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
// 🔴 必须用**线上同一个** `LocaleHost`（`main.tsx` 也用它）包住 `<App />`，
// 而不是直接挂 `<App />`：外壳里的语言切换器要求 `LocalePreferenceProvider` 在它之上，
// 缺了会**当场抛错**（`useLocalePreference 必须在 <LocalePreferenceProvider> 内使用`），
// 于是这个文件里每一条用例都会红 —— 而报错指向的是 provider，不是被测的东西。
// 这与 `app-mount.spec.tsx` 是同一份接线：两处各拼一遍就会漂移。
const { LocaleHost } = await import('../src/lib/locale-host.js');
const { __resetOpLogForTests, initOpLog } = await import('../src/lib/oplog.js');
const { useHabitStore, selectHabitProgress } = await import('../src/features/habits/store.js');
const { useTaskStore } = await import('../src/features/tasks/store.js');
const { addDays, toLocalDate } = await import('@heyta/domain');

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

describe('今日进度卡（L1）真的渲染出来了', () => {
  it('打卡 + 完成任务之后，进度条到 100% 且写出"今天的都做完了"', async () => {
    await waitFor('今日进度卡出现', () =>
      (container?.textContent ?? '').includes('今天'),
    );

    const bar = container?.querySelector('[role="progressbar"]');
    expect(bar, '界面上应该有一根进度条').not.toBeNull();
    /*
      🔴 这一条现在是**红**的，而且它守的是一个真实的回归（不是测试过期）：
      共享 `packages/ui/src/motivation/ProgressBar.tsx` 用 RN 的
      `accessibilityValue={{ min, max, now }}` 对象形态，而 **react-native-web
      0.21.3 不支持它** —— 实测（apps/web probe）：
        <View accessibilityValue={{min:0,max:100,now:42}} /> → 无 aria-valuenow
        <View aria-valuenow={42} aria-valuemin={0} aria-valuemax={100} /> → 三个属性都在
      于是 web 上读屏拿不到百分比（原生端不受影响）。
      修法在共享层（不在本刀白名单，已上报）：把对象形态换成平铺的
      `aria-valuemin/aria-valuemax/aria-valuenow`。
      **刻意不删也不放宽** —— 一条没有数值的进度条对读屏用户等于不存在。
    */
    expect(bar?.getAttribute('aria-valuenow')).toBe('100');

    await waitFor('闭环文案出现', () =>
      (container?.textContent ?? '').includes('今天的都做完了'),
    );

    // 🔴 这一条抓到过一个真 bug：`beforeEach` 造的场景里，习惯是**今天计划内**的、
    // 而任务没有截止日期（= 计划外），于是 `done(2) > total(1)`，
    // 卡片左边打出了「还有 -1 件没做」，右边同时写着「今天的都做完了」。
    const flat = (container?.textContent ?? '').replace(/\s+/gu, '');
    expect(flat, '进度卡的文案里绝不能出现负数').not.toMatch(/-\d/u);
    expect(flat).toContain('计划内都做完了');
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

    /*
      🔴 分类时长走 `renderCategoryBreakdown` 插槽。少了它这一块会**静默消失**
      —— 上面那四条标题断言照样全绿（那是"接线漏了、没有判据"的经典形状，
      也是故障注入 FI-2 会红的那个点）。`CategoryReportView` 自带
      `testID="category-report"`。
    */
    expect(
      container?.querySelector('[data-testid="category-report"]'),
      '成长页必须有分类时长块（renderCategoryBreakdown 插槽）',
    ).not.toBeNull();
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

  it('一年视图画出了 365 个格子（共享层自绘，不再是旧日历库的 svg rect）', async () => {
    click(byText('成长'));
    await flush();

    /*
      ⚠️ 旧实现用 `react-activity-calendar`，每个格子是一个 `svg rect`；
      共享 `ActivityHeatmap` 改成 RN 原语自绘，格子是带
      `activity-cell-<date>` testID 的 div（全页只剩 Copy 图标那 1 个 rect）。
      窗口固定 365 天、逐日补齐由 `dailyActivityCountsFromState` 负责 ——
      所以断言**恰好 365**，而不是 `> 0`（后者证明不了"每一天都在"）。
    */
    const cells = container?.querySelectorAll('[data-testid^="activity-cell-"]') ?? [];
    expect(cells).toHaveLength(365);
  });

  it('🔴 热力图文案必须是中文 —— 旧日历库的默认值是英文，会直接画到界面上', async () => {
    click(byText('成长'));
    await flush();

    const text = container?.textContent ?? '';
    // 这几个都是旧库的默认英文文案，实测真的出现过（`1 activities in 2025`、
    // `Less` / `More`、英文月份）。界面文案门禁只扫我们自己的源码，
    // 看不见库生成的字符串 —— 只能靠这一条守住。
    expect(text).not.toContain('activities in');
    expect(text).not.toContain('Less');
    expect(text).not.toContain('More');
    expect(text).not.toContain('Jan');

    /*
      整块的无障碍名（窗口 + 总数）走 `aria-label`，**不在 textContent 里**：
      旧库把它渲染成可见文本，自绘之后它只是读屏专用的一句。
      （`web.growth.year.heatmap` 那条词条用的是旧库的 `{{count}}` 占位符，
      由宿主自己展开 —— 见 `GrowthView` 的 `heatmapLabels`。）
    */
    const grid = container?.querySelector('[aria-label^="最近一年共"]');
    expect(grid, '年度热力图必须有整块的无障碍名').not.toBeNull();
    expect(grid?.getAttribute('aria-label')).toMatch(/^最近一年共 \d+ 次记录$/u);

    // 图例两端仍是可见文本（且是中文）。
    expect(text).toContain('少');
    expect(text).toContain('多');
  });

  it('🔴 热力格子的颜色必须已解析成具体颜色 —— 裸 token 名会让格子全透明', async () => {
    click(byText('成长'));
    await flush();

    /*
      ⚠️ 这条原来防的是 `react-activity-calendar`：它用
      `CSS.supports('color', c)` 校验 `theme`，而裸的 `--ht-…` 不是颜色值 ——
      实测真 Chromium 里为 false，库抛异常、整个应用被打白。

      自绘之后没有库再解析颜色，但**同一条风险换了形状**：`backgroundColor`
      里若出现裸 `--ht-…`，浏览器同样忽略它（格子全透明），而且不报错。
      所以判据改成"每一格的背景色都是可解析的 rgb()" —— 强度色阶仍然由
      `heatmapLevelToken(level)` 给出（共享层唯一一份映射）。
    */
    const cells = [...(container?.querySelectorAll('[data-testid^="activity-cell-"]') ?? [])];
    const backgrounds = cells.map((el) => el.getAttribute('style') ?? '');
    expect(backgrounds).toHaveLength(365);
    expect(
      backgrounds.every((s) => /background-color:\s*rgb\(/u.test(s)),
      `有格子的背景色不是可解析颜色：\n${backgrounds
        .filter((s) => !/rgb\(/u.test(s))
        .slice(0, 3)
        .join('\n')}`,
    ).toBe(true);
    // 0 档与"有记录"的那一格必须是**两种**颜色（空白格不是"没有颜色"）。
    const distinct = new Set(
      backgrounds.map((s) => /background-color:\s*([^;"]+)/u.exec(s)?.[1] ?? s),
    );
    expect(distinct.size).toBeGreaterThan(1);
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

  it('🔴 界面上不出现「冻结余额」—— 它是库存，不是事实', async () => {
    // 与 `HabitsView` 取"今天"用的是**同一个表达式**，否则我算的日期和界面算的
    // 差一天，前提断言就会莫名其妙地红。
    click(byText('习惯'));
    await flush();
    await waitFor('习惯卡片出现', () => (container?.textContent ?? '').includes('喝水'));

    const now = Number(sessionStorage.getItem('now') ?? Date.now());
    const today = toLocalDate(now);
    const store = useHabitStore.getState();
    const habitId = store.habits[0]?.id ?? '';

    // 往前补 7 个连续计划日：满 7 天会**真的**攒到一个冻结。
    for (let i = 1; i <= 7; i += 1) {
      await act(async () => {
        await store.checkIn(habitId, addDays(today, -i));
      });
    }
    await flush();

    const progress = selectHabitProgress(useHabitStore.getState(), now);
    // ⚠️ 这里要解**一层**：`HabitResilienceView` 是个包装
    // （`{ resilience: HabitResilience, repair?, freshStart? }`），
    // 三个数字在内层。界面里也是这么取的（`const r = p.resilience.resilience`）。
    const numbers = progress[0]?.resilience.resilience;

    // 🔴 前提断言，两条都不能省：
    //   1. 手里真的有 1 个冻结 —— 否则下面那条否定断言是**空转**的
    //      （旧代码在没有冻结时也不会渲染余额，测试会假装通过）。
    //   2. 界面确实按新日志重绘过 —— 用一个**肯定**的断言钉住。
    //      没有它的话，"界面里没有余额"也可能只是"界面还没刷新"。
    expect(numbers?.freezesHeld).toBe(1);
    const flat = (container?.textContent ?? '').replace(/\s+/gu, '');
    expect(flat).toContain(`累计${String(numbers?.total)}次`);

    // 才是要守的那条：余额不上界面。
    expect(flat).not.toContain('个冻结');
    expect(flat).not.toContain('还剩');
  });
});