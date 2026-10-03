/**
 * 判据：**选中态在移动端也只有一个所有者**
 * =========================================
 *
 * ⚠️ 本仓库没有组件级渲染测试（`apps/mobile` 与 `apps/web` 都只测纯函数 + 源码断言，
 * 手法见 `reminders-notes-display.spec.ts` 文件头）。所以这里钉的不是"渲染对不对"，
 * 而是**写错不会报错、只会静默错**的那几处接线 —— 选中态恰好全是这一类：
 *
 *   1. 🔴 **回落的谓词必须是活跃全集**。写成"筛完/分组后的那一截"，症状是
 *      "用户切一下视图，正在详情面里看的那条自己关掉"，而界面不会报任何错。
 *      这一条在共享层有单测（`packages/app-host/tests/selection.spec.ts`），
 *      但共享层证不了**宿主喂进去的是什么** —— 那正是本文件的职责。
 *   2. 🔴 **旧的本地 `useState` 必须真的删了**。本仓库为"抽出了共享实现但旧那份没删"
 *      付过两次学费（AGENTS.md §3.5 末尾）。`check:selection-single-source` 是常驻门禁，
 *      这条是它在本包测试里的镜像 —— 门禁没跑到的地方（比如只跑单测的 CI 片段）也要能发现。
 *   3. **离开这一屏时收起详情层**。移动端的详情是浮层/二级屏，切标签会卸载本屏；
 *      选中态留着的话，切回来会"凭空弹出一个面板"。这条不报错，只是行为诡异。
 *   4. **两屏的回落都走同一个出口**（`pruneSelectionAgainst`），不是各自再写一遍循环。
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { pruneSelectionAgainst, selection } from '../src/lib/selection';

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string): string => readFileSync(resolve(here, '..', 'src', rel), 'utf8');

const TASKS = src('screens/TasksScreen.tsx');
const HABITS = src('screens/HabitsScreen.tsx');
const NOTES = src('screens/NotesSection.tsx');
const SEARCH = src('screens/SearchScreen.tsx');
const LIB = src('lib/selection.ts');

describe('1. 回落喂的是活跃全集，不是筛后的那一截', () => {
  it('任务屏：`pruneSelectionAgainst` 的实参来自 `listTasks()` 的结果', () => {
    expect(TASKS).toMatch(/const aliveTasks = actions\.listTasks\(\);/);
    expect(TASKS).toMatch(/pruneSelectionAgainst\(\{\s*task:\s*aliveTasks\.map\(/);
    // 🔴 反向：不许拿筛完/分完组的那一截当谓词来源。这两条正则不是装饰 ——
    //    变异臂就是把上面的实参改成下面这两种之一，改完必须红。
    expect(TASKS).not.toMatch(/pruneSelectionAgainst\(\{\s*task:\s*groups/);
    expect(TASKS).not.toMatch(/pruneSelectionAgainst\(\{\s*task:\s*visible/);
  });

  it('习惯屏：同一件事，同样来自全集', () => {
    expect(HABITS).toMatch(/const aliveHabits = actions\.listHabits\(\);/);
    expect(HABITS).toMatch(/pruneSelectionAgainst\(\{\s*habit:\s*aliveHabits\.map\(/);
  });

  /**
   * 🔴 便签这一类有**两个**持有实体全集的屏（「我的 → 便签」那一段、搜索浮层），
   * 少接一个的症状是具体的：从搜索点开一条便签后它在另一台设备上被删了，
   * 编辑屏不会自己关 —— 因为那一刻只有没挂载的那个屏在跑回落。
   */
  it('便签：两个持有全集的屏都跑了回落，且喂的是 `listNotes()` 的结果', () => {
    for (const [name, text] of [['NotesSection', NOTES], ['SearchScreen', SEARCH]] as const) {
      expect(text, `${name} 没接便签回落`).toMatch(/pruneSelectionAgainst\(\{\s*note:/);
      // 反向：不许拿筛完的 `results.notes` / 排过序的那一截当谓词来源。
      expect(text, `${name} 的回落谓词来自筛后的一截`).not.toMatch(
        /pruneSelectionAgainst\(\{\s*note:\s*(?:results|filtered|visible)/,
      );
    }
    expect(NOTES).toMatch(/const listed = actions\.listNotes\(\);/);
    expect(SEARCH).toMatch(/const listed = noteActions\.listNotes\(\);/);
  });
});

describe('2. 旧的本地选中态确实删掉了（不是"又加了一份新的"）', () => {
  it('四屏都不再 `useState` 一个选中 id', () => {
    for (const [name, text] of [
      ['TasksScreen', TASKS],
      ['HabitsScreen', HABITS],
      ['NotesSection', NOTES],
      ['SearchScreen', SEARCH],
    ] as const) {
      expect(text, `${name} 又长回本地选中态`).not.toMatch(
        // 🔴 `edit(ing)` 分支是 2026-10-03 补的：`editingNoteId`（TasksScreen）与
        // `editingId`（NotesSection）就是同一个问题被答了两遍，而旧的正则一个都不认。
        /const\s*\[\s*(?:detail|selected|open|active|edit(?:ing)?)(?:Task|Habit|Note|Project|Tag|Event)Id\s*(?:,\s*set[A-Za-z0-9_$]+\s*)?\]\s*=\s*useState/,
      );
    }
    // 任务屏与便签那一段都必须从共享那份读，而不是从 react 自己造。
    expect(TASKS).toContain("from '../lib/selection'");
    expect(HABITS).toContain("from '../lib/selection'");
    expect(NOTES).toContain("from '../lib/selection'");
  });

  it('选中态只在 `lib/selection.ts` 里实例化一次', () => {
    expect(LIB).toMatch(/export const selection: SelectionStore = createSelectionStore\(\);/);
    expect(TASKS).not.toContain('createSelectionStore');
    expect(HABITS).not.toContain('createSelectionStore');
  });
});

describe('3. 离开这一屏时收起详情层', () => {
  it('两屏各有一条卸载清理，且清的是自己那一类', () => {
    expect(TASKS).toMatch(/useEffect\(\s*\(\) => \(\) => \{\s*selection\.select\('task', null\);/);
    expect(HABITS).toMatch(/useEffect\(\s*\(\) => \(\) => \{\s*selection\.select\('habit', null\);/);
  });

  /**
   * 便签的编辑屏有**两个宿主**（任务屏的搜索入口、「我的 → 便签」那一段），
   * 所以清理也必须两处都有。只在一处清的后果是"从另一条路进来时，
   * 切个标签回来编辑屏还站在屏幕上"—— 与上面两条同一个坏行为。
   */
  it('便签：两个宿主都在卸载时清了自己那一类', () => {
    for (const [name, text] of [['TasksScreen', TASKS], ['NotesSection', NOTES]] as const) {
      expect(text, `${name} 的卸载清理没收便签编辑屏`).toMatch(
        /useEffect\(\s*\(\) => \(\) => \{[\s\S]{0,160}?selection\.select\('note', null\);/,
      );
    }
  });
});

describe('4. 回落循环只有一份实现（宿主不各写一遍）', () => {
  it('两屏都不自己调 `pruneMissingSelection`', () => {
    // 逐屏写循环 = 新增一类实体时必然漏一处（那是共享层的 `pruneSelection` 存在的理由）。
    expect(TASKS).not.toContain('pruneMissingSelection');
    expect(HABITS).not.toContain('pruneMissingSelection');
    expect(LIB).toContain('pruneSelection(');
  });
});

/**
 * 🔴 这一组是 Goal 那条"选中不能只应用到一个地方"在本壳的落点。
 * 数的是**接线点**，不是印象：三种投影（列表 / 四象限 / 时间线）加搜索浮层
 * 一共四个写入口，三种投影各一个高亮出口。少接一处的症状是"在列表里选中一条、
 * 切到四象限就不认识它了" —— 那正是三份本地选中态的老形状。
 */
describe('5. 同一批任务的几种投影接的是同一个选中（W1 跨视图）', () => {
  it('四个入口都写 `select(\'task\', id)`', () => {
    expect(TASKS.split("selection.select('task', id);").length - 1).toBe(4);
  });

  it('三种投影都把选中递回去当高亮光标', () => {
    expect(TASKS.split('activeTaskId={detailTaskId}').length - 1).toBe(3);
    // 阳性对照：这个值就是本屏读的共享选中，不是又造了一个本地状态。
    expect(TASKS).toContain("const detailTaskId = useSelected('task');");
  });
});

describe('6. 接线本身的行为（在真 store 上走一遍）', () => {
  it('选中的实体不在了 ⇒ 清空；还在（哪怕不在筛选里）⇒ 保持', () => {
    selection.clear();
    selection.select('task', 't2');

    pruneSelectionAgainst({ task: ['t1', 't3'] });
    expect(selection.get('task')).toBeNull();

    selection.select('task', 't2');
    pruneSelectionAgainst({ task: ['t1', 't2', 't3'] });
    expect(selection.get('task')).toBe('t2');
  });

  it('某类没给谓词时**不动它**（缺数据源不等于该清）', () => {
    selection.select('note', 'n1');
    pruneSelectionAgainst({ task: [] });
    expect(selection.get('note')).toBe('n1');
    selection.clear();
  });

  it('没给谓词时不发通知（否则每次刷数据都白重渲染一次详情层）', () => {
    selection.clear();
    selection.select('task', 't1');
    let calls = 0;
    const off = selection.subscribe(() => {
      calls += 1;
    });
    pruneSelectionAgainst({ task: ['t1'] });
    expect(calls).toBe(0);
    pruneSelectionAgainst({ task: [] });
    expect(calls).toBe(1);
    off();
    selection.clear();
  });
});
