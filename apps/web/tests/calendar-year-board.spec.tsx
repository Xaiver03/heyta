/**
 * 年视图（R13）—— 板子真的把 12 个月摊开了吗
 * ==============================================
 *
 * 产品负责人要的形是滴答那张"12 个月缩略"（`ui-review-fill-zh-timeline.md` §9.4 批四另一半）。
 * 这里钉的是**渲染结果**，不是组件有没有挂载：
 *
 * 1. 🔴 **12 张月卡，枚数从 `MONTHS_PER_YEAR` 推**（抄一个 12 早晚与领域层漂开）；
 * 2. 每张卡顶上的月份名**来自词条表**（期望串用共享的 `monthMessageKey` 现取，
 *    不在测试里手抄「1月」—— 手抄的抄件一定会漂，而这条恰好是中英都会漂的地方）；
 * 3. 🔴 **没给 `onPickMonth` 时月卡没有按钮角色** —— 这条守的是 §9.3
 *    「不摆点了没反应的菜单项」。它是本档最容易"顺手写成永远可点"的地方：
 *    写成一个 `Pressable` 加一个空 `onPress` 在界面上完全一样；
 * 4. 有事的画一天才出现点，且点的有无**由数据决定**（不是由 CSS 类名决定）；
 * 5. 年档**不画**月历网格与当天清单（同屏两份当天的账那一类）；
 * 6. 工具栏那格在年档说的是**年**，不是某一个月。
 *
 * 🔴 **文案走宿主自己那份 `useCalendarLabels()`，测试里不重拼一套**：
 *   第一版在这里手写了一个 `CalendarBoardLabels` 字面量并 `as unknown as` 强转 ——
 *   那既是"同形状的第二次"（AGENTS §3.5），又把标签契约的类型的检查整个关掉了
 *   （强转能把任何错的 props 形状塞进去，判据就只是在对着自己的夹具打分）。
 *   现在 `render()` 挂的是 `LocaleHost` + 一个探针组件，标签来自与线上同一条路。
 *
 * ⚠️ 几何（一张卡多宽、几列）不在这里测：jsdom 不触发 `onLayout` ⇒ 列数恒为 1，
 *   在这里断言"分了 4 行"会得到一条恒假或恒真的判据（§7 元规则 2）。
 *   列数的规则本体由 `packages/ui/tests/calendar-year-model.spec.ts` 钉，
 *   "真浏览器里真的按约数分行"由 `e2e/tests/calendar-year.spec.ts` 钉。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MONTHS_PER_YEAR,
  daysInMonth,
  monthsOfYear,
  parseLocalDate,
  type LocalDate,
  type Task,
} from '@heyta/domain';
import {
  HeytaUiProvider,
  CalendarBoard,
  formatDayTitleText,
  monthMessageKey,
} from '@heyta/ui';
import { translate, type I18nValue } from '@heyta/i18n';

const { LocaleHost } = await import('../src/lib/locale-host.js');
/** 🔴 宿主那份文案接线（`web` 的月历板与页头工具栏也用它）—— 测试复用，不另建。 */
const { useCalendarLabels } = await import('../src/features/calendar/useCalendarLabels.js');

const t: I18nValue['t'] = (key, vars) => translate('zh-CN', key, vars);

/** 本地零点的 epoch ms —— 与 `dueDateToEpoch` 同一条口径（不自己拼 `Date` 再取 UTC）。 */
const atMidnight = (date: LocalDate): number => parseLocalDate(date).getTime();

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function task(id: string, title: string, dueDate: number): Task {
  return { id, title, dueDate } as Task;
}

function YearBoardProbe(props: {
  tasks: readonly Task[];
  today: LocalDate;
  cursor: LocalDate;
  onPickMonth: ((monthFirstDay: LocalDate) => void) | undefined;
}) {
  const labels = useCalendarLabels();
  return (
    <HeytaUiProvider>
      <CalendarBoard
        view="year"
        tasks={props.tasks}
        today={props.today}
        cursor={props.cursor}
        selected={props.today}
        onCursorChange={vi.fn()}
        onSelect={vi.fn()}
        onToggleTask={vi.fn()}
        onPickMonth={props.onPickMonth}
        labels={labels}
        testID="calendar-board"
      />
    </HeytaUiProvider>
  );
}

function render(props: {
  tasks?: readonly Task[];
  year?: LocalDate;
  today?: LocalDate;
  onPickMonth?: (monthFirstDay: LocalDate) => void;
} = {}): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  const today = props.today ?? '2026-10-03';
  act(() => {
    root = createRoot(container!);
    root.render(
      <LocaleHost>
        <YearBoardProbe
          tasks={props.tasks ?? []}
          today={today}
          cursor={props.year ?? today}
          onPickMonth={props.onPickMonth}
        />
      </LocaleHost>,
    );
  });
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  container = undefined;
  root = undefined;
});

const monthCards = (): HTMLElement[] =>
  Array.from(
    container!.querySelectorAll<HTMLElement>('[data-testid^="calendar-board-year-month-"]'),
  ).filter(
    /*
      只数"卡"本身：标题、列头、**周行**、里面那层 body 都带同一个前缀。
      ⚠️ 这一栏在加了 `-week-N` 之后当场红过一次（12 张卡数成 84）——
      前缀式选择器的作用域必须随子节点命名一起维护，不然它数到的不是它想数的东西。
    */
    (el) => !/(?:-title|-weekdays|-body|-week-\d+)$/.test(el.dataset.testid ?? ''),
  );

const cardAt = (yyyymm: string): HTMLElement | null =>
  container!.querySelector<HTMLElement>(`[data-testid="calendar-board-year-month-${yyyymm}"]`);

const dayAt = (yyyyMMDD: string): HTMLElement | null =>
  container!.querySelector<HTMLElement>(`[data-testid="calendar-board-year-day-${yyyyMMDD}"]`);

describe('年视图的 12 张月卡', () => {
  it('🔴 恰好 `MONTHS_PER_YEAR` 张卡，且每张卡的 id 是一个 `YYYY-MM`', () => {
    render();
    const cards = monthCards();
    expect(cards).toHaveLength(MONTHS_PER_YEAR);
    const suffixes = cards.map((card) => card.dataset.testid?.replace('calendar-board-year-month-', ''));
    // 首月是 1 月、末月是 12 月，且中间不重不漏。
    expect(suffixes[0]).toBe('2026-01');
    expect(suffixes[MONTHS_PER_YEAR - 1]).toBe('2026-12');
    expect(new Set(suffixes).size).toBe(MONTHS_PER_YEAR);
  });

  it('🔴 每张卡顶上的月份名是**词条表里那一条**（期望串现取，不手抄）', () => {
    render();
    for (let month = 1; month <= MONTHS_PER_YEAR; month += 1) {
      // 键从共享层那条 `monthMessageKey` 现取：它漂了这条就红，而不是测试跟着漂。
      const expected = t(monthMessageKey(month));
      const el = container!.querySelector<HTMLElement>(
        `[data-testid="calendar-board-year-month-2026-${String(month).padStart(2, '0')}-title"]`,
      );
      expect(el, `第 ${String(month)} 张卡没有月份名`).not.toBeNull();
      expect(el?.textContent, `第 ${String(month)} 张卡写的不是词条表里那句（应为「${expected}」）`).toBe(
        expected,
      );
    }
  });

  it('每张卡都有一行 7 个列头，顺序照 `labels.weekdays`（周一开头）', () => {
    render();
    const row = container!.querySelector<HTMLElement>(
      '[data-testid="calendar-board-year-month-2026-10-weekdays"]',
    );
    expect(row, '列头没了 —— 没人能核对第一列是周几').not.toBeNull();
    expect(row?.querySelectorAll('div, span, p').length ?? 0).toBeGreaterThanOrEqual(7);
    // 第一个列头是周一那条词条，最后一个周日（错位一格不会报错，只会整体偏移）。
    // ⚠️ 这里**用键名而不是 `WEEKDAY_MESSAGE_KEYS[0]`**：后者在
    //   `noUncheckedIndexedAccess` 下是 `| undefined`，而这条断言比的是"顺序"，
    //   键名写死就是它的期望值本体（顺序错了我自己写错键名，红得同样准）。
    const text = row?.textContent ?? '';
    expect(text.startsWith(t('common.weekday.mon')), `列头第一个不是「${t('common.weekday.mon')}」：${text}`).toBe(
      true,
    );
    expect(text.endsWith(t('common.weekday.sun')), `列头最后不是「${t('common.weekday.sun')}」：${text}`).toBe(
      true,
    );
  });

  it('每月天数照领域层铺：逐月数格子，2 月 28 格、10 月 31 格（少一天看不出来，只能数）', () => {
    render();
    for (const month of monthsOfYear('2026-01-01')) {
      const yyyymm = month.slice(0, 7);
      const cells = container!.querySelectorAll<HTMLElement>(
        `[data-testid^="calendar-board-year-day-${yyyymm}-"]`,
      );
      // 期望值从 `daysInMonth(year, month)` 推，不在测试里抄月份长度表（抄的那份过闰年一定漂）。
      expect(cells, `${yyyymm} 铺了 ${String(cells.length)} 格`).toHaveLength(
        daysInMonth(Number(month.slice(0, 4)), Number(month.slice(5, 7))),
      );
    }
    expect(dayAt('2026-02-28')).not.toBeNull();
    expect(dayAt('2026-02-29'), '平年铺出了 2 月 29 日').toBeNull();
    expect(dayAt('2026-10-31')).not.toBeNull();
  });

  /*
    🔴 这一条是**截图逼出来的**：第一版把 31 个格子当成一维数组塞进
    `flexDirection:'row' + flexWrap:'wrap'`，而每格 `flexBasis: 0` ⇒ 基宽 0 永远塞得下、
    `flexWrap` 从不生效 ⇒ 真浏览器里 31 天挤成一行互相压字（`year.png` 第一版）。
    上面那条"数得出 31 格"**照样绿** —— 它数的是节点数，不是位置。
    jsdom 没有布局引擎，量不了 x/y（那条在 `e2e/tests/calendar-year.spec.ts` 里量），
    但**结构**在这里能量：格子必须按周分组、每组 7 个槽位（补白格也算槽位，
    否则月末那一行的列会整体左移）。
  */
  it('🔴 格子是**按周分行**的：每张卡 6 行、每行 7 个槽位（不是 31 格一维铺开）', () => {
    render();
    for (let month = 1; month <= MONTHS_PER_YEAR; month += 1) {
      const yyyymm = `2026-${String(month).padStart(2, '0')}`;
      const rows = container!.querySelectorAll<HTMLElement>(
        `[data-testid^="calendar-board-year-month-${yyyymm}-week-"]`,
      );
      // 6 行是 `monthGrid` 的**固定**行数（翻月不跳网格），不是"这个月要几行"。
      expect(rows, `${yyyymm} 的周行数不是 6 —— 网格会随月份跳高度`).toHaveLength(6);
      for (const row of rows) {
        expect(row.childElementCount, `${yyyymm} 有一行不是 7 个槽位（列会错位）`).toBe(7);
      }
    }
  });

  it('🔴 有截止任务的那一天才有状态点，没任务的日子一个点都不画', () => {
    const due = atMidnight('2026-07-15');
    render({ tasks: [task('t1', '评审登录页', due)] });
    expect(
      container!.querySelector('[data-testid="calendar-board-year-day-2026-07-15-dot"]'),
      '有事那天没画点 —— 年档就白画了',
    ).not.toBeNull();
    expect(
      container!.querySelector('[data-testid="calendar-board-year-day-2026-07-16-dot"]'),
      '没事那天也画了点 —— 那点就不再是"有事"的意思',
    ).toBeNull();
    // 全年的点数恰好等于有任务的天数（不是任务数：同一天两条只画一个点）。
    expect(container!.querySelectorAll('[data-testid$="-dot"]')).toHaveLength(1);
  });

  it('同一天两条任务只有**一个**点，但读屏名里数得出两件', () => {
    const due = atMidnight('2026-07-15');
    render({ tasks: [task('t1', 'A', due), task('t2', 'B', due)] });
    // 期望串照 `CalendarYearBoard` 那条组合（dayWithTasks(当天标题, 件数)），
    // 当天标题再用**共享**的 `formatDayTitleText` —— 不在测试里抄一句中文。
    const dayTitle = formatDayTitleText('2026-07-15', t);
    expect(dayAt('2026-07-15')?.getAttribute('aria-label')).toBe(
      t('web.calendar.a11y.dayWithTasks', { date: dayTitle, count: 2 }),
    );
    expect(container!.querySelectorAll('[data-testid$="-dot"]')).toHaveLength(1);
  });

  it('🔴 一年里**只有一格**标成"今天"，且这个标记读屏念得到（`aria-current="date"`）', () => {
    // ⚠️ 这条以前比的是 `style` 属性 —— 实测 jsdom 里 RNW 把静态样式落到 **className**
    //   而不是内联 style，两格的 `getAttribute('style')` 都是空串，红得毫无信息量。
    //   今天这格的视觉是边框+主色（由 `check:design`/对比度管，e2e 截图人看），
    //   而"读屏用户能不能知道哪天是今天"是另一件事，它有平铺的 `aria-current`。
    render();
    const marked = Array.from(
      container!.querySelectorAll<HTMLElement>('[data-testid^="calendar-board-year-day-"][aria-current]'),
    );
    expect(marked, '一年里没有任何一格标了"今天" —— 找今天只能靠肉眼').toHaveLength(1);
    expect(marked[0]?.dataset.testid).toBe('calendar-board-year-day-2026-10-03');
    expect(marked[0]?.getAttribute('aria-current')).toBe('date');
    // 阳性对照的另一半：邻格**不许**也带上它（两个"今天"就是界面在说谎那一类）。
    expect(dayAt('2026-10-04')?.hasAttribute('aria-current')).toBe(false);
  });
});

describe('年档的点击边界（§9.3 那条立场）', () => {
  /*
    🔴 这三条量的都是**月卡自己**，不是整个容器。
    第一版写成"容器里 `[role=button]` 的数量"，结果抓到的是工具栏那三个
    （`‹` `›` 「今天」）—— 那是**该有**的按钮，与"月卡能不能点"是两件事。
    判据要是连自己的作用域都没圈对，它抓到的红就不是产品问题（§7 元规则 1）。
  */
  const cardButtons = (): HTMLElement[] =>
    Array.from(container!.querySelectorAll<HTMLElement>('[role="button"]')).filter((el) =>
      el.matches('[data-testid^="calendar-board-year-month-"]'),
    );

  it('🔴 宿主没接 `onPickMonth` ⇒ 月卡**没有按钮角色**（宁可不点，也不摆一扇假门）', () => {
    render();
    expect(cardButtons(), '没接回调却画出了可点的月卡').toHaveLength(0);
    // 阳性对照：工具栏那两个箭头**应该**在 —— 少了这一句，上面那条"0 个"
    // 会因为选择器写错而永远通过（能不能失败只靠变异回答，但对照先免费）。
    expect(
      container!.querySelectorAll(
        '[data-testid="calendar-toolbar-prev"], [data-testid="calendar-toolbar-next"]',
      ),
    ).toHaveLength(2);
  });

  it('接了回调 ⇒ 恰好 12 张可点卡（与卡数**逐一对齐**），点 3 月那张交出去的是 3 月的 1 号', () => {
    const onPickMonth = vi.fn();
    render({ onPickMonth });
    const cards = monthCards();
    const buttons = cardButtons();
    expect(cards).toHaveLength(MONTHS_PER_YEAR);
    // 🔴 断的是"卡片数 == 可点壳数"，不是"有 12 个按钮"：
    //    后者在"某张卡套了两层可点"时仍然绿，而那张卡会触发两次状态迁移。
    expect(buttons).toHaveLength(cards.length);

    const march = cardAt('2026-03');
    expect(march).not.toBeNull();
    act(() => {
      // RN-web 的 Pressable 在 DOM 上听 click。
      march?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onPickMonth, '点了 3 月那张卡，回调却没被调用（接线没挂到卡上）').toHaveBeenCalledWith(
      '2026-03-01',
    );
  });
});

describe('年档不重复画别的档的东西', () => {
  it('🔴 没有月历网格、没有日档那块板 —— 否则同一屏会有两份当天的账', () => {
    render();
    expect(
      container!.querySelectorAll<HTMLElement>('[data-testid^="calendar-cell-"]'),
      '年档里还在画月档那 42 格',
    ).toHaveLength(0);
    expect(
      container!.querySelector('[data-testid="calendar-board-day"]'),
      '年档里混进了日档那块板',
    ).toBeNull();
  });

  it('✅ 页脚那句**留着**（这一档同样只画"有截止的日子"）', () => {
    // ⚠️ 这里曾经写成"页脚不该出现"，而它**红了** —— 红得对：
    //   `labels.footnote` 挂在 `CalendarBoard` 的根上、在所有档位分支之外
    //   （`packages/ui/src/calendar/CalendarBoard.tsx:573`），月/周/日/年四档共用。
    //   "没设截止的任务不会出现在日历上"这句话在年档同样必要 ——
    //   撤掉它才会让"任务没设时间"被读成"任务丢了"。原句留在旁边是为了让人看清
    //   这条判据一开始比错了对象。
    render();
    const footnote = container!.querySelector<HTMLElement>('[data-testid="calendar-board-footnote"]');
    expect(footnote, '年档把那句"这一页看不到什么"弄丢了').not.toBeNull();
    expect(footnote?.textContent).toBe(t('web.calendar.footnote'));
  });

  it('工具栏那格在年档说的是**年**（漏接 `yearTitle` 会退回月份，看着像坏了）', () => {
    render({ year: '2026-10-03' });
    const title = container!.querySelector<HTMLElement>('[data-testid="calendar-toolbar-month"]');
    expect(title).not.toBeNull();
    expect(title?.textContent).toBe(t('common.date.yearTitle', { year: '2026' }));
    expect(
      title?.textContent,
      '年档标题里出现了「月」—— 那等于把整年指回一个月',
    ).not.toContain(t('common.date.monthTitle', { year: '2026', month: 10 }));
  });
});
