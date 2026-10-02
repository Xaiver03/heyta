/**
 * 习惯视图「列表 + 窗格」的**真实渲染**测试
 * ==========================================
 *
 * 产品负责人 2026-10-01 要的形态：左列一行一个习惯（图标 + 名字 + 最近 7 天
 * 打没打 + **三个具体数字**），右窗格只放选中那一条的打卡记录。
 *
 * 🔴 为什么单独一个文件：`habits-board.spec.tsx` 验的是**共享层**那块板子，
 * 它挂的是裸 `<HabitBoard>`，碰不到 `HabitsView` 的新布局；而 `habits-board`
 * 的 E 组是**源码级**判据 —— 读的是文本，不是 DOM。也就是说"列表真的画出了
 * 那三个数字""点第二行时右窗格真的换人"这两件事**没有任何一层在管**。
 *
 * 数据走**真 op-log**（`addHabit` / `checkIn`），不往 store 里塞假对象 ——
 * 否则"打卡之后左列那个点会变深"这条回路恰好是唯一没被验证的那条，
 * 而这正是这个视图存在的理由。
 *
 * ⚠️ `now` 固定在 2026-09-28 12:00（经 `sessionStorage['now']`，见 `HabitsView`
 * 的 `NOW_STATE_KEY`），打卡日期写死同一天。不固定日期的话，跨午夜跑会红。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 变异验证（2026-10-01，七处"看起来对但实际错"的实现逐个注入，红了才还原）
 *
 * | 注入 | 变红的判据 |
 * |---|---|
 * | 最长 chip 改成 `{growth.current}` | 「三个数字都渲染成文字」 |
 * | 点位色硬编码成 `heat-0` | 「打过的那天才 heat-4」+「颜色取自共享 token」 |
 * | 行首不做 `parseHabitIcon` | 「听不懂的历史值不炸」 |
 * | 窗格给**全部**习惯渲染 | 「点另一行后窗格换人」+「只给选中那条渲染打卡按钮」 |
 * | 去掉 `?? rows[0]` 兜底 | 7 条（默认选中 / 换人 / 删除后退回…） |
 * | 再点同一字形不退回派生 | 「再点同一个字形 = 退回派生」 |
 * | 去掉空列表时的窗格头部守卫 | 「列表零行说的是共享层那句空态」 |
 *
 * 图标的**词表 / 解析 / 派生**与 `setHabitIcon` 的**写路径**判据不在这里 ——
 * 它们各自住在 owning 层：`packages/domain/tests/habit-icons.spec.ts`（14 条）
 * 与 `packages/app-host/tests/habit-actions.spec.ts` 的「习惯图标」组（5 条），
 * 两边也各做过变异（派生退化成常量、解析回退成第一项、不 trim、
 * 拿掉写入侧闭集校验、清除写成 `undefined` 而非 `null`）。
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
(globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

const { HABIT_ICONS, habitIconOf } = await import('@heyta/domain');
const { I18nProvider } = await import('@heyta/i18n');
const { HabitsView } = await import('../src/features/habits/HabitsView.js');
const { __resetOpLogForTests, initOpLog } = await import('../src/lib/oplog.js');
const { useHabitStore } = await import('../src/features/habits/store.js');

/** 与界面上"今天"对齐的固定时刻；`NOW_DATE` 是它的本地日期串。 */
const NOW = new Date(2026, 8, 28, 12, 0, 0).getTime();
const NOW_DATE = '2026-09-28';
const YESTERDAY = '2026-09-27';

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function flush(): Promise<void> {
  return act(async () => {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
}

/**
 * 轮询等到条件成立（超时要带现场）。
 *
 * 🔴 界面上的图标选择器走的是 `void store.setHabitIcon(...)` —— **不等返回**，
 * 而那条链路要写 IndexedDB。一次 `flush()` 顶不住，症状是"点没生效"的假红，
 * 而且**只在部分运行里出现**（实测连跑三次三种不同的红）。
 * `motivation-view.spec.tsx` 用 `waitFor` 就是同一件事。
 *
 * ⚠️ 默认 8 秒而不是 3 秒：连跑 12 个 vitest 进程（变异验证那种负载）时，
 * D 组曾多红过一次「点没生效」；单独跑（含同一处变异）稳定绿。
 * 超时只影响**失败时**等多久，不影响判据强度。
 */
async function until(label: string, cond: () => boolean, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
  throw new Error(
    `等待「${label}」超时\n当前界面文本：\n${(container?.textContent ?? '').slice(0, 500)}`,
  );
}

/** 当前在右窗格里展开的那个习惯名（从 DOM 读，不猜 store 的顺序）。 */
function selectedName(): string {
  const row = qa<HTMLElement>('.ht-habit__row').find((r) => r.getAttribute('aria-current') === 'true');
  return row?.querySelector('.ht-habit__name')?.textContent?.trim() ?? '';
}

function qa<T extends Element>(selector: string, scope: ParentNode = container ?? document): T[] {
  return [...scope.querySelectorAll<T>(selector)];
}

/** 左列的一行（按习惯名找，避免依赖列表顺序）。 */
function rowOf(name: string): HTMLElement {
  const el = qa<HTMLElement>('.ht-habit__row').find((r) => r.textContent?.includes(name));
  if (el === undefined) throw new Error(`找不到习惯行「${name}」`);
  return el;
}

function habitIdOf(name: string): string {
  const h = useHabitStore.getState().habits.find((x) => x.name === name);
  if (h === undefined) throw new Error(`store 里没有习惯「${name}」`);
  return h.id;
}

function click(el: Element | null | undefined): void {
  act(() => {
    (el as HTMLElement | undefined)?.click();
  });
}

/**
 * 把右窗格切到指定习惯。
 *
 * 🔴 图标选择器长在**窗格头部**，它改的是"当前选中那一条"。不先选中就点字形，
 * 改到的是默认的第一条 —— 测试会安静地验错对象（实测第一版就是这样红的）。
 */
function selectRow(name: string): void {
  click(document.querySelector(`[data-testid="habit-row-${habitIdOf(name)}"]`));
}

const pane = (): HTMLElement | undefined =>
  container?.querySelector<HTMLElement>('.ht-habit__pane') ?? undefined;

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  class NoopResizeObserver implements ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (globalThis as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
    NoopResizeObserver as unknown as typeof ResizeObserver;
});

beforeEach(async () => {
  sessionStorage.setItem('now', String(NOW));
  __resetOpLogForTests();
  await initOpLog(`habits-pane-${Math.random().toString(36).slice(2)}`);

  // 两条习惯：「喝水」今天打过（1/1/1）。
  // 「阅读」= 最近连续 2 天（09-27、09-28）+ 一段 6 天的历史（09-13…09-18）
  // ⇒ 连续 2 / 最长 6 / 累计 8 —— **三个数互不相等**。
  // 🔴 数据必须让三个数各不相同：之前它们是 2/2/2，于是"三个 chip 渲染同一个数"
  //    这种实现**不会让任何断言变红**（变异验证时发现的）。
  await useHabitStore.getState().addHabit('喝水');
  await useHabitStore.getState().addHabit('阅读');
  await useHabitStore.getState().checkIn(habitIdOf('喝水'), NOW_DATE);
  for (const d of ['2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18']) {
    await useHabitStore.getState().checkIn(habitIdOf('阅读'), d);
  }
  await useHabitStore.getState().checkIn(habitIdOf('阅读'), YESTERDAY);
  await useHabitStore.getState().checkIn(habitIdOf('阅读'), NOW_DATE);

  container = document.createElement('div');
  document.body.append(container);
  act(() => {
    root = createRoot(container!);
    root.render(
      <I18nProvider locale="zh-CN">
        <HabitsView />
      </I18nProvider>,
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
  useHabitStore.setState({ habits: [], logs: [] });
});

describe('A. 左列：一行一个习惯，三个具体数字写在行上', () => {
  it('两条习惯 = 两行，行名在 DOM 里读得到', () => {
    expect(qa('.ht-habit__item')).toHaveLength(2);
    expect(container?.textContent).toContain('喝水');
    expect(container?.textContent).toContain('阅读');
  });

  it('🔴 每行三个数字**都渲染成文字**，不是一个总数（ADR-0022 三数同权）', () => {
    const nums = qa('.ht-habit__chip-num', rowOf('阅读')).map((el) => el.textContent?.trim());
    // 连续 2 / 最长 6 / 累计 8 —— 三个互不相等，所以"渲染错一个数"必红。
    expect(nums).toEqual(['2', '6', '8']);
  });

  it('整行的 `aria-label` 一次把三个数字念完（屏幕阅读器不必逐 chip 猜）', () => {
    expect(rowOf('阅读').getAttribute('aria-label')).toBe('「阅读」连续 2 天，最长 6 天，累计 8 次');
  });

  it('行首图标圆盘每行恰好一个，且带一个 svg 字形', () => {
    for (const row of qa<HTMLElement>('.ht-habit__row')) {
      expect(qa('svg', row.querySelector('.ht-habit__disc') ?? row)).toHaveLength(1);
    }
  });
});

describe('B. 行首 7 个点：打没打一眼看得出处', () => {
  it('每行 7 个点（列表窗口 = HABIT_ROW_WEEK_DAYS）', () => {
    expect(qa('.ht-habit__dot', rowOf('喝水'))).toHaveLength(7);
  });

  it('🔴 打过的那天是 `heat-4`，没打的是 `heat-0` —— 同一份共享分档表', () => {
    const dots = qa<HTMLElement>('.ht-habit__dot', rowOf('喝水'));
    const today = dots[6];
    // 最后一格就是"今天"：`habitHeatmap` 以 now 结尾，往前推 7 天。
    expect(today?.getAttribute('title')).toBe(`${NOW_DATE} 已打卡`);
    expect(today?.style.background).toContain('--ht-color-heat-4');
    const missed = dots[0];
    expect(missed?.getAttribute('title')).toBe('2026-09-22 没打卡');
    expect(missed?.style.background).toContain('--ht-color-heat-0');
  });

  it('两点验证：颜色取自共享 token 而不是 web 里另配的一套', () => {
    // 「阅读」昨天与今天都打过 ⇒ 最后两格都是 heat-4，倒数第三格没有。
    const dots = qa<HTMLElement>('.ht-habit__dot', rowOf('阅读'));
    expect(dots[5]?.style.background).toContain('--ht-color-heat-4');
    expect(dots[4]?.style.background).toContain('--ht-color-heat-0');
  });
});

describe('C. 右窗格：全页只有一块共享板，且只显示选中那一条', () => {
  it('`[data-testid="habit-board"]` 数量恰好 1（e2e 的白屏检测按同一条断言）', () => {
    expect(qa('[data-testid="habit-board"]')).toHaveLength(1);
  });

  it('默认就恰好一条被选中，窗格说的就是它的名字', () => {
    const marked = qa<HTMLElement>('.ht-habit__row').filter(
      (r) => r.getAttribute('aria-current') === 'true',
    );
    expect(marked).toHaveLength(1);
    expect(pane()?.getAttribute('aria-label')).toBe(`「${selectedName()}」的打卡记录`);
  });

  it('🔴 点另一行后窗格换人：新名字出现、旧名字不再出现', () => {
    const was = selectedName();
    const other = was === '喝水' ? '阅读' : '喝水';
    selectRow(other);
    const text = pane()?.textContent ?? '';
    expect(text).toContain(other);
    expect(text).not.toContain(was);
    expect(selectedName()).toBe(other);
  });

  it('窗格只给选中那一条渲染打卡按钮（两块板 / 两个按钮都会在这里现形）', () => {
    const name = selectedName();
    expect(qa(`[data-testid="habit-checkin-${habitIdOf(name)}"]`, pane() ?? document)).toHaveLength(1);
    expect(qa('[data-testid^="habit-checkin-"]', pane() ?? document)).toHaveLength(1);
  });

  it('选中项被删掉时退回剩下那条，不出现空窗格（派生 fallback，不是 useEffect）', async () => {
    const gone = selectedName();
    const keep = gone === '喝水' ? '阅读' : '喝水';
    await act(async () => {
      await useHabitStore.getState().deleteHabit(habitIdOf(gone));
    });
    await until(`「${keep}」成为选中项`, () => selectedName() === keep);
    expect(qa('.ht-habit__item')).toHaveLength(1);
    expect(pane()?.getAttribute('aria-label')).toBe(`「${keep}」的打卡记录`);
    expect(qa('[data-testid="habit-board"]')).toHaveLength(1);
  });
});

describe('D. 图标选择器：存闭集 key，不存字形名', () => {
  function openPicker(): void {
    const toggle = qa<HTMLElement>('.ht-habit__icon-toggle', pane() ?? document)[0];
    expect(toggle).toBeDefined();
    click(toggle);
  }

  /** 按**闭集 key** 取那一格 —— 位置来自 `HABIT_ICONS`，不是按字形名猜。 */
  function optionAt(icon: (typeof HABIT_ICONS)[number]): HTMLElement | undefined {
    return qa<HTMLElement>('.ht-habit__icon-option', pane() ?? document)[HABIT_ICONS.indexOf(icon)];
  }

  const storedIcon = (name: string): string | undefined =>
    useHabitStore.getState().habits.find((h) => h.name === name)?.icon;

  /** 这条习惯**当前实际画着**的图标 key（选过用选的，没选过用派生）。 */
  const effectiveIconOf = (name: string): (typeof HABIT_ICONS)[number] => {
    const h = useHabitStore.getState().habits.find((x) => x.name === name);
    if (h === undefined) throw new Error(`store 里没有习惯「${name}」`);
    return habitIconOf(h);
  };

  it('八个字形 + 一个「默认」，一个都不许多（词表是红线）', () => {
    openPicker();
    const options = qa('.ht-habit__icon-option', pane() ?? document);
    expect(options).toHaveLength(HABIT_ICONS.length + 1);
    expect(options[HABIT_ICONS.length]?.textContent).toBe('默认');
  });

  it('🔴 选一个字形 → **落库的是 key**，且行首圆盘跟着变', async () => {
    const name = selectedName();
    // 🔴 挑的字形必须**一定不同于**这条习惯当前画着的那个（BLOCKED.md B9）：
    // 派生字形由 id 哈希决定，而 id 每次运行都是新随机 UUID ⇒ 约 1/8 的运行
    // 恰好派生出 `book`。写死 'book' 时，在那 1/8 的运行里"圆盘跟着变"会假红 ——
    // 落库断言过了，而字形本来就长一样。动态挑一个不同的 key，
    // "换图标必须看得见"这条判据才在**每一次**运行里都真的被检验。
    const chosen = HABIT_ICONS.find((icon) => icon !== effectiveIconOf(name))!;
    const before = rowOf(name).querySelector('.ht-habit__disc svg')?.outerHTML;
    openPicker();
    click(optionAt(chosen));
    await until(`「${name}」的图标落库为 ${chosen}`, () => storedIcon(name) === chosen);
    const after = rowOf(name).querySelector('.ht-habit__disc svg')?.outerHTML;
    expect(after).not.toBe(before);
  });

  it('再点同一个字形 = 退回派生（存的是 `undefined`，不是"没有图标"）', async () => {
    const name = selectedName();
    openPicker();
    click(optionAt('book'));
    // 🔴 先确认"写进去了"再验"退得回来"：只断言最后的 `undefined`，
    // 一条从不落库的实现也能全绿（实测第一版就是这样假绿的）。
    await until(`「${name}」先写上 book`, () => storedIcon(name) === 'book');
    openPicker();
    click(optionAt('book'));
    await until(`「${name}」退回派生`, () => storedIcon(name) === undefined);
  });

  it('🔴 磁盘上是听不懂的历史值时**不炸**，画派生的那个字形', async () => {
    // 直接往 store 塞一个不在闭集里的 key（改名前的旧数据就是这个形状）。
    // 没有 `parseHabitIcon` 的话 `HABIT_GLYPHS['trophy']` 是 undefined 组件 —— 渲染时才炸。
    const derived = rowOf('喝水').querySelector('.ht-habit__disc svg')?.outerHTML;
    const habits = useHabitStore.getState().habits.map((h) =>
      h.name === '喝水' ? { ...h, icon: 'trophy' } : h,
    );
    act(() => {
      useHabitStore.setState({ habits });
    });
    await flush();
    const after = rowOf('喝水').querySelector('.ht-habit__disc svg')?.outerHTML;
    expect(after).toBe(derived);
    expect(rowOf('喝水').textContent).toContain('喝水');
  });
});

describe('E. 一条习惯都没有', () => {
  it('列表零行，窗格说的是共享层那一句空态（不在 web 里另写一句）', async () => {
    for (const h of useHabitStore.getState().habits) {
      await act(async () => {
        await useHabitStore.getState().deleteHabit(h.id);
      });
    }
    await flush();
    expect(qa('.ht-habit__item')).toHaveLength(0);
    expect(pane()?.textContent).toContain('还没有习惯。添加一个开始打卡。');
    expect(qa('[data-testid="habit-board"]')).toHaveLength(1);
  });
});

/**
 * F. 两张字形表必须是同一份映射（源码级判据）
 * ============================================
 *
 * 🔴 2026-10-01 之后，行首字形**有两份表**：web 这份（`features/habits/habit-glyphs.ts`，
 * DOM + `lucide-react` **组件**）与共享 RN 那份
 * （`packages/ui/src/habits/HabitProgressList.tsx`，`lucide` 的**图标数据**
 * 经 `HeytaIcon` 画）。移动端清单用的就是后者。
 *
 * **为什么是读文本而不是渲染**：两边画的不是同一种东西（一边 DOM `<svg>`、
 * 一边 RN 原生路径），像素不可比，DOM 结构也不可比 —— 但"8 个 key 各配哪个
 * 字形"是**同一个判断**。所以比的是表本身：键 → 字形标识符名。
 *
 * 不钉住会怎样：手机上"喝水"是水滴、web 上是月亮，同一个习惯两端长得不一样。
 * ⚠️ `Record<HabitIcon, …>` 的穷尽性**挡不住这个** —— 它只保证"八个 key 都在"，
 * 不保证两边配的是同一个。症状还是"看起来只是个配色问题"。
 *
 * 变异验证（2026-10-01，三处注入都**只走 `HEYTA_HABITS_SHARED_LIST` 这条缝**，
 * 改的是 `/tmp` 里的副本 —— 共享工作树里 `packages/ui` 一个字节都没动）：
 *
 * | 注入 | 结果 |
 * |---|---|
 * | 共享层 `drop: Droplet` → `drop: Moon` | **恰好 1 条红**（配对判据） |
 * | 删掉共享层 `music` 那一项 | **2 条红**（穷尽性 + 配对） |
 * | 把共享层的常量改名 | 2 条红，且报的是「判据锚点已失效」—— **不是静默通过** |
 *
 * 手法与 `apps/mobile/tests/habits-display.spec.ts` 里那张月份表副本一致
 * （移动端读共享层源码）：**读的方向永远是宿主 → 共享层**，反向不读。
 */
describe('F. 字形表：web 清单与共享 RN 清单不许各画各的', () => {
  /** 从一个源文件里抠出 `HABIT_GLYPHS` 那张表的 `key: Glyph` 对。 */
  function glyphTable(source: string, label: string): Record<string, string> {
    const start = source.indexOf('const HABIT_GLYPHS');
    expect(start, `${label} 里找不到 \`HABIT_GLYPHS\` —— 判据锚点已失效`).toBeGreaterThanOrEqual(0);
    const open = source.indexOf('{', start);
    const close = source.indexOf('\n};', open);
    expect(open, `${label} 的 \`HABIT_GLYPHS\` 后面找不到 \`{\` —— 锚点已失效`).toBeGreaterThan(start);
    expect(close, `${label} 的 \`HABIT_GLYPHS\` 后面找不到 \`};\` —— 锚点已失效`).toBeGreaterThan(open);
    const body = source.slice(open + 1, close);
    const table: Record<string, string> = {};
    for (const match of body.matchAll(/([A-Za-z]+)\s*:\s*([A-Za-z][A-Za-z0-9]*)\s*,/g)) {
      const key = match[1];
      const glyph = match[2];
      if (key !== undefined && glyph !== undefined) table[key] = glyph;
    }
    return table;
  }

  const here = dirname(fileURLToPath(import.meta.url));

  /**
   * ⚠️ `HEYTA_HABITS_SHARED_LIST` 是**只读接缝**，只给故障注入用
   * （把共享层源码复制到 `/tmp`、改一处、指过去）。不设时就是真实路径。
   * 共享工作树里直接改 `packages/ui/src` 会碰到别人的运行，所以走这条缝。
   */
  function readSharedListSource(): string {
    return readFileSync(
      process.env.HEYTA_HABITS_SHARED_LIST ??
        resolve(here, '../../../packages/ui/src/habits/HabitProgressList.tsx'),
      'utf8',
    );
  }

  it('八个 key 两边都齐（解析绕过了 `Record` 的穷尽性，所以要自己数）', () => {
    const shared = glyphTable(readSharedListSource(), '共享层');
    const web = glyphTable(readFileSync(resolve(here, '../src/features/habits/habit-glyphs.ts'), 'utf8'), 'web');
    expect(Object.keys(shared).sort()).toEqual([...HABIT_ICONS].sort());
    expect(Object.keys(web).sort()).toEqual([...HABIT_ICONS].sort());
  });

  it('🔴 每个 key 配的是**同一个字形标识符**（不是"两边各有八个图标"就算过）', () => {
    const shared = glyphTable(readSharedListSource(), '共享层');
    const web = glyphTable(readFileSync(resolve(here, '../src/features/habits/habit-glyphs.ts'), 'utf8'), 'web');
    expect(shared).toEqual(web);
  });
});
