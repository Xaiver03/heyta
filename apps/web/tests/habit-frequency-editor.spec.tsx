/**
 * 习惯频次编辑器（工单 H5 的 web 半）
 * ====================================
 *
 * 🔴 本单要补的**不是判定**：`isScheduledOn` → `computeStreak` 早就按计划日数连续天数了
 * （`packages/domain/src/habit-streak.ts:36/101`）。缺的是**一条能写进去的路径** ——
 * 而在本文件测的那个组件存在之前，全仓库没有任何界面能设置 `frequency`。
 * "字段躺在实体里、判定读它、界面写不了它"就是 §7 第 195 条点名的形状：
 * typecheck 与既有门禁全绿，界面上也看不出缺了什么。
 *
 * 因此这一族钉的是四件事，缺一件这个功能就是假的：
 *
 *   1. **摘要常驻可见** —— 折叠着也要能看出这条习惯的计划口径；
 *   2. 🔴 **「每天一次」发的是清除（`undefined`）**，而且**已经是每天时一条 op 都不发**
 *      （`{type:'daily'}` 与"没有这个键"读出来是同一句话，存两种表示就是两份存量，§3.3）；
 *   3. 🔴 **`interval` 的 N 只在按了那一档时才提交** —— 跟着 keystroke 写会把输入 `10`
 *      变成"先写 `1`（被归一成每天）再写 `10`"两条 op，中间那条是用户没要的状态；
 *   4. **非法值与失败都必须看得见** —— 校验在动作层（`normalizeHabitFrequency` 会抛），
 *      界面不自己判，但**接不住 reject 就等于"点了没反应"**。
 *
 * ⚠️ 这里**不测**"payload 落到 op-log 之后判定读得到" —— 那是
 * `packages/app-host/tests/habit-actions.spec.ts` 的 F6/F7（真引擎 + 真 SQLite +
 * 直接拿 `computeStreak` 对账）。jsdom 这一层没有引擎，硬要在那儿测只会测到一个桩。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Habit, HabitFrequency, LocalDate } from '@heyta/domain';
import { I18nProvider } from '@heyta/i18n';

import { HabitFrequencyEditor } from '../src/features/habits/HabitFrequencyEditor.js';

let root: Root | undefined;
let container: HTMLDivElement | undefined;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
});

/** 2026-03-02 是**周一**（ISO 1）—— 切到"每周挑几天"时默认就该落在这一档。 */
const TODAY: LocalDate = '2026-03-02';

function habit(over: Partial<Habit> = {}): Habit {
  return { id: 'h1', name: '拉伸', createdAt: 1, updatedAt: 1, ...over } as Habit;
}

type OnSet = (frequency: HabitFrequency | undefined) => Promise<void>;

async function mount(h: Habit, onSet: OnSet): Promise<HTMLDivElement> {
  // 🔴 每次挂载都**换一棵新根**：`root.render()` 复用同一棵树时 React 会保留组件 state，
  //    于是"同一个用例里第二次 mount"的 `open` 还是上一次的 true —— 再点一次开关就把它
  //    **关掉**了，报出来是"点了开关而面板没出来"，看起来像组件坏了。
  //    （第一版 G4/G7 就是这么红的，而它们测的那两条本身没问题。）
  act(() => {
    root?.unmount();
  });
  container?.remove();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <I18nProvider locale="zh-CN">
        <HabitFrequencyEditor habit={h} today={TODAY} onSet={onSet} />
      </I18nProvider>,
    );
  });
  return container!;
}

const byTestId = (el: HTMLElement, id: string): HTMLElement | null =>
  el.querySelector(`[data-testid="${id}"]`);

async function click(el: HTMLElement | null | undefined): Promise<void> {
  expect(el, '要点的控件不在界面上').not.toBeNull();
  await act(async () => {
    el!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/** 摘要那颗常驻按钮（折叠/展开的开关）。 */
const toggleOf = (el: HTMLElement) => byTestId(el, 'habit-freq-toggle-h1');

/** 🔴 展开面板：必须**真的点一下**，只把按钮取出来不算（第一版就叫 `open` 而没点，
 *  于是 7 条红在"面板里的控件不在界面上"，看起来像组件没渲染，其实是用例没走到那一步）。 */
async function openPanel(el: HTMLElement): Promise<void> {
  await click(toggleOf(el));
  expect(byTestId(el, 'habit-freq-panel-h1'), '点了开关而面板没出来').not.toBeNull();
}

/**
 * 🔴 同 `habit-goal-editor.spec.tsx`：必须走**原生 setter**。
 * 直接 `input.value = '3'` 再派发 `input`，React 的 value 追踪器会认为"值没变"，
 * 症状是"测试里输入了而组件没收到"，看起来像组件坏了。
 */
function setInputValue(input: HTMLInputElement, next: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, next);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('HabitFrequencyEditor', () => {
  it('G1 摘要**常驻可见**：没设过频次就说「每天」', async () => {
    const el = await mount(habit(), async () => {});
    const summary = byTestId(el, 'habit-freq-summary-h1');
    expect(summary, '摘要不在（折叠着就该看出计划口径）').not.toBeNull();
    expect(summary!.textContent ?? '').toContain('每天');
  });

  it('G2 摘要与共享层同一口径：weekly[1,3] 念成「每周 一、三」', async () => {
    const el = await mount(
      habit({ frequency: { type: 'weekly', daysOfWeek: [1, 3] } }),
      async () => {},
    );
    const text = byTestId(el, 'habit-freq-summary-h1')!.textContent ?? '';
    expect(text).toContain('每周');
    expect(text).toContain('一');
    expect(text).toContain('三');
    // 🔴 顿号**不是词条**：`check-ui-language` 规则 2 要求 zh 词条含汉字，纯标点只能待在
    //    词条表外（单源在 `features/ai/locale-punctuation.ts`）。这一条钉的是"这里没有
    //    再开一份分隔符表"，取不到顿号就说明有人把 join 改回硬编码或改成了别的。
    expect(text).toContain('、');
  });

  it('G3 🔴「每天一次」发的是**清除**（undefined），不是 {type:\'daily\'}', async () => {
    const onSet = vi.fn<OnSet>(async () => {});
    const el = await mount(habit({ frequency: { type: 'interval', everyNDays: 3 } }), onSet);
    await openPanel(el);
    await click(byTestId(el, 'habit-freq-daily-h1'));

    expect(onSet).toHaveBeenCalledTimes(1);
    // `toHaveBeenCalledWith(undefined)` 会被 vitest 读成"没有参数"，所以逐字取出来比。
    expect(onSet.mock.calls[0]?.length).toBe(1);
    expect(onSet.mock.calls[0]![0]).toBeUndefined();
  });

  it('G4 🔴 已经是「每天」时再点那一格 ⇒ 一条都不发（把 null 写成 null 也是脏 op）', async () => {
    const onSet = vi.fn<OnSet>(async () => {});
    const el = await mount(habit(), onSet);
    await openPanel(el);
    await click(byTestId(el, 'habit-freq-daily-h1'));
    expect(onSet).not.toHaveBeenCalled();

    // 显式存着 {type:'daily'} 的那一种（远端/旧数据）同样不许再发一遍。
    const onSet2 = vi.fn<OnSet>(async () => {});
    const el2 = await mount(habit({ frequency: { type: 'daily' } }), onSet2);
    await openPanel(el2);
    await click(byTestId(el2, 'habit-freq-daily-h1'));
    expect(onSet2).not.toHaveBeenCalled();
  });

  it('G5 🔴 切到「每周挑几天」必须带一天（空集合会被动作层抛 ⇒ 点了没反应）', async () => {
    const onSet = vi.fn<OnSet>(async () => {});
    const el = await mount(habit(), onSet);
    await openPanel(el);
    await click(byTestId(el, 'habit-freq-weekly-h1'));

    expect(onSet).toHaveBeenCalledTimes(1);
    const sent = onSet.mock.calls[0]![0];
    expect(sent).toEqual({ type: 'weekly', daysOfWeek: [1] });
    // 那一档取的是**今天**（TODAY = 周一），不是写死的 1。
    expect(sent?.type === 'weekly' && sent.daysOfWeek).not.toHaveLength(0);
  });

  it('G6 🔴 改数字**不发** op，按了「每隔几天」那一档才发（防连写两条）', async () => {
    const onSet = vi.fn<OnSet>(async () => {});
    const el = await mount(habit({ frequency: { type: 'interval', everyNDays: 3 } }), onSet);
    await openPanel(el);

    const input = byTestId(el, 'habit-freq-n-h1') as HTMLInputElement | null;
    expect(input, 'N 那个输入框不在').not.toBeNull();
    await act(async () => {
      setInputValue(input!, '1');
    });
    await act(async () => {
      setInputValue(input!, '10');
    });
    expect(onSet, '跟着 keystroke 写就会先落一条 1（被归一成"每天"）').not.toHaveBeenCalled();

    await click(byTestId(el, 'habit-freq-interval-h1'));
    expect(onSet).toHaveBeenCalledTimes(1);
    expect(onSet.mock.calls[0]![0]).toEqual({ type: 'interval', everyNDays: 10 });
  });

  it('G7 非法 N（空 / 0 / 2.5）⇒ 错误可见且**不发**（校验在动作层，界面不自己判非法值）', async () => {
    for (const bad of ['', '0', '2.5', 'abc']) {
      const onSet = vi.fn<OnSet>(async () => {});
      // 🔴 前置必须是 interval 档：N 那一行现在**只在那一档才画**（G11），
      //    在"每天"下面它根本不存在，用例会红在"输入框不在"上而不是"没拦住非法值"。
      const el = await mount(habit({ frequency: { type: 'interval', everyNDays: 3 } }), onSet);
      await openPanel(el);
      const input = byTestId(el, 'habit-freq-n-h1') as HTMLInputElement;
      await act(async () => {
        setInputValue(input, bad);
      });
      await click(byTestId(el, 'habit-freq-interval-h1'));

      expect(onSet, `非法值「${bad}」被发出去了`).not.toHaveBeenCalled();
      const err = byTestId(el, 'habit-freq-error-h1');
      expect(err, `非法值「${bad}」没报错`).not.toBeNull();
      // 🔴 报错要说**为什么**：把字段标签再念一遍等于没报（"每隔几天做一次"既不是错误
      //    也不是原因，用户看完只知道这一栏叫这个名字）。
      expect(err!.textContent ?? '', `报错文案没说出原因：${err!.textContent}`).toContain('整数');
    }
  });

  it('G11 🔴 只画**当前那一档**的零件（存在性反向：不该来的别来）', async () => {
    // weekly 模式下不许出现"每隔几天做一次 + 一个数字输入框 + 一句隔 N 天的说明" ——
    // 那是把一个**不生效**的规则连数字一起摆给用户看（工单 H5 看图照出来的那一处，
    // 而当时 7 条 e2e 断言全绿：它们只验"该有的在不在"）。
    const w = await mount(habit({ frequency: { type: 'weekly', daysOfWeek: [1] } }), async () => {});
    await openPanel(w);
    expect(byTestId(w, 'habit-freq-n-h1'), 'weekly 模式下 N 那一行也画出来了').toBeNull();
    expect(w.querySelector('.ht-habit__freq-hint'), 'weekly 模式下还念着"隔 N 天"的说明').toBeNull();
    expect(byTestId(w, 'habit-freq-day-1-h1'), 'weekly 模式下星期那一排反倒不在').not.toBeNull();

    // 反向对照：interval 模式下星期那一排不许在（否则两档的零件同时摆着）。
    const i = await mount(
      habit({ frequency: { type: 'interval', everyNDays: 3 } }),
      async () => {},
    );
    await openPanel(i);
    expect(byTestId(i, 'habit-freq-n-h1'), 'interval 模式下 N 那一行不在').not.toBeNull();
    expect(byTestId(i, 'habit-freq-day-1-h1'), 'interval 模式下星期那一排也画出来了').toBeNull();

    // 每天那一档：两样都不该在。
    const d = await mount(habit(), async () => {});
    await openPanel(d);
    expect(byTestId(d, 'habit-freq-n-h1')).toBeNull();
    expect(byTestId(d, 'habit-freq-day-1-h1')).toBeNull();
  });

  it('G8 🔴 动作层 reject ⇒ 界面说得出错误（接不住就是"点了没反应"）', async () => {
    const onSet = vi.fn<OnSet>(async () => {
      throw new Error('找不到习惯');
    });
    const el = await mount(habit(), onSet);
    await openPanel(el);
    await click(byTestId(el, 'habit-freq-weekly-h1'));

    expect(onSet).toHaveBeenCalledTimes(1);
    expect(byTestId(el, 'habit-freq-error-h1'), '失败被吞掉了').not.toBeNull();
  });

  it('G9 🔴 取消唯一那一天 = 退回「每天」（发的是清除，空集合在界面上**不可达**）', async () => {
    const onSet = vi.fn<OnSet>(async () => {});
    const el = await mount(habit({ frequency: { type: 'weekly', daysOfWeek: [1] } }), onSet);
    await openPanel(el);
    await click(byTestId(el, 'habit-freq-day-1-h1'));

    expect(onSet).toHaveBeenCalledTimes(1);
    // 规则 2：清空那一格说的是"我其实每天都做"，不是"一周里哪天都不做"。
    // 🔴 动作层那条"`weekly` 空集合抛"（`habit-actions.spec.ts` 的 F4）因此是
    //    **最后一道闸**而不是日常路径 —— 界面这条路上它根本不该被撞到。
    expect(onSet.mock.calls[0]!.length).toBe(1);
    expect(onSet.mock.calls[0]![0]).toBeUndefined();
    expect(byTestId(el, 'habit-freq-error-h1'), '这是一次正常改写，不该报错').toBeNull();
  });

  it('G10 折叠/展开由 aria-expanded 说清楚（不靠"看得见摸得着"猜）', async () => {
    const el = await mount(habit(), async () => {});
    const toggle = toggleOf(el);
    expect(toggle, "摘要那颗开关不在").not.toBeNull();
    // `!` 只给 TS：上面那条 `not.toBeNull()` 才是判据，它不会替收窄类型
    // （`noUncheckedIndexedAccess` 那一族同理由：vitest 的断言不是类型守卫）。
    expect(toggle!.getAttribute('aria-expanded')).toBe('false');
    expect(byTestId(el, 'habit-freq-panel-h1')).toBeNull();

    await click(toggle);
    expect(toggle!.getAttribute('aria-expanded')).toBe('true');
    expect(byTestId(el, 'habit-freq-panel-h1')).not.toBeNull();
  });
});
