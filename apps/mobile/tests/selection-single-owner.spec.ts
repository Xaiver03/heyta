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
});

describe('2. 旧的本地选中态确实删掉了（不是"又加了一份新的"）', () => {
  it('两屏都不再 `useState` 一个选中 id', () => {
    for (const [name, text] of [['TasksScreen', TASKS], ['HabitsScreen', HABITS]] as const) {
      expect(text, `${name} 又长回本地选中态`).not.toMatch(
        /const\s*\[\s*(?:detail|selected|open|active)(?:Task|Habit|Note|Project|Tag|Event)Id\s*(?:,\s*set[A-Za-z0-9_$]+\s*)?\]\s*=\s*useState/,
      );
      expect(text).toContain("from '../lib/selection'");
    }
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
});

describe('4. 回落循环只有一份实现（宿主不各写一遍）', () => {
  it('两屏都不自己调 `pruneMissingSelection`', () => {
    // 逐屏写循环 = 新增一类实体时必然漏一处（那是共享层的 `pruneSelection` 存在的理由）。
    expect(TASKS).not.toContain('pruneMissingSelection');
    expect(HABITS).not.toContain('pruneMissingSelection');
    expect(LIB).toContain('pruneSelection(');
  });
});

describe('5. 接线本身的行为（在真 store 上走一遍）', () => {
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
