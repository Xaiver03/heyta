/**
 * 记忆层的总开关必须在**取数之前**落下
 * =====================================
 *
 * ## 这两条用例钉的是什么
 *
 * `App.tsx` 里那段 `memory` useMemo 调的 `inferPreferences()` / `inferFeedbackPreferences()`
 * **内部本来就有闸门**（`memoryEnabled:false` ⇒ 直接返回空集）。听起来已经很安全了，
 * 但实参在**调用点先求值**：
 *
 * ```
 * inferPreferences({ tasks: Object.values(store.entities.tasks), … })
 * ```
 *
 * `Object.values(...)` 会在被调方看见任何东西**之前**把整张表物化成数组。
 * 于是关着的时候：付全额的 O(任务 + 专注 + 反馈 + 纠正)，然后把结果扔掉。
 *
 * 🔴 这不只是浪费 —— ADR-0014 的承诺是「关着就不推断」，而"推断完不显示"
 * 是另一件事。界面上两者长得一模一样，所以必须有能数出属性读取次数的判据。
 *
 * ## 为什么判据长成"数读取次数"，以及为什么它不是自证的
 *
 * 探针是往 `store.entities` 上套一层 `Proxy`，只统计**记忆层专用**的那几个键。
 * 单有"关着 ⇒ 0 次"是不成立的：探针坏了、或者代理在渲染之前就被换掉了，
 * 读数同样是 0（本仓库记过无数次"空测量看着最干净"）。所以三腿一起走：
 *
 * 1. **同一次渲染里 `tasks` 的读数 ≥ 1** —— 证明这枚代理在这一趟真的活着、
 *    真的被这次渲染读到了。没有这一条，"0"什么都不能说明。
 * 2. 关着 ⇒ `aiFeedback` / `preferenceCorrections` 恰好 **0**。
 * 3. 开着 ⇒ 同两个键 **≥ 1**（正向对照：闸门没有把该走的这条路一起掐掉）。
 *
 * 🔴 为什么选这两个键：它们在 `apps/web` 里**只有这一段 useMemo 读**
 * （`grep -rn "\.aiFeedback\|\.preferenceCorrections" apps/web/src` 只命中 `App.tsx`）。
 * 选 `tasks` 做负向断言是**不成立**的 —— 任务列表自己每天都在读它，
 * 0 次根本不可能出现，而"永远不可能红"的判据比没有判据更糟。
 */

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { __resetOpLogForTests, initOpLog } from '../src/lib/oplog.js';
import { LocaleHost } from '../src/lib/locale-host.js';
import { useTaskStore } from '../src/features/tasks/store.js';
import { AI_SETTINGS_STORAGE_KEY } from '../src/features/settings/aiStore.js';

(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
(globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

const { App } = await import('../src/App.js');

/** 记忆层专用（除这段 useMemo 之外没有第二个读者）—— 负向断言圈在这两个键上。 */
const MEMORY_ONLY = ['aiFeedback', 'preferenceCorrections'] as const;
/** 界面各处都会读的键 —— 只用它证明探针活着，不用它做负向断言。 */
const ALWAYS_READ = 'tasks';

type EntityKey = (typeof MEMORY_ONLY)[number] | typeof ALWAYS_READ;

interface Probe {
  readonly reads: Record<string, number>;
}

/**
 * 把 `entities` 换成一层计数代理。
 *
 * ⚠️ 只计数、不改值：`Reflect.get(target, prop)` 原样返回，
 * 所以界面渲染的还是同一批实体 —— 这条用例观察的是**读取行为**，不是结果。
 */
function instrument<T extends object>(entities: T): [T, Probe] {
  const reads: Record<string, number> = {};
  const watched: readonly string[] = [...MEMORY_ONLY, ALWAYS_READ];
  const proxy = new Proxy(entities, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && watched.includes(prop)) {
        reads[prop] = (reads[prop] ?? 0) + 1;
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as T;
  return [proxy, { reads }];
}

let root: Root | undefined;
let container: HTMLDivElement | undefined;

beforeEach(async () => {
  localStorage.clear();
  __resetOpLogForTests();
  // 每条用例自己的库名（同 `app-mount.spec.tsx`：共享库会让用例互相污染）。
  await initOpLog(`mem-gate-${Math.random().toString(36).slice(2)}`);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
});

/**
 * 挂起整个 App，然后把 `entities` 换成计数代理，再冲一次渲染。
 *
 * 🔴 为什么是"挂好之后再换"而不是"换好再挂"：挂载过程中 op-log 水合会**整体替换**
 * `entities`，先装的那层代理会被冲掉 —— 冲掉之后读数恒为 0，而 0 正是这条用例
 * 要断言的东西。那是最危险的假绿形状：**探针被顶掉与代码是对的，输出完全相同**。
 * 装在水合之后，并且用同一趟的 `tasks ≥ 1` 证明它还活着。
 */
async function mountThenInstrument(
  memoryEnabled: boolean,
): Promise<Probe> {
  localStorage.setItem(
    AI_SETTINGS_STORAGE_KEY,
    JSON.stringify({ memoryEnabled }),
  );

  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <LocaleHost>
        <App />
      </LocaleHost>,
    );
  });

  const [proxy, probe] = instrument(useTaskStore.getState().entities);
  await act(async () => {
    useTaskStore.setState({ entities: proxy });
  });
  return probe;
}

describe('🔴 记忆层总开关关着 ⇒ 记忆专用集合一次都不读', () => {
  it('探针活着（同一趟 `tasks` 被读到），而 `aiFeedback`/`preferenceCorrections` 读数为 0', async () => {
    const probe = await mountThenInstrument(false);

    // ① 先证探针：没有这一条，下面的 0 就是"没测到"而不是"没读"。
    expect(
      probe.reads[ALWAYS_READ] ?? 0,
      '计数器没读到 `tasks` ⇒ 代理在这次渲染里不在场，整条用例是空测量',
    ).toBeGreaterThanOrEqual(1);

    // ② 再断行为：闸门落下 ⇒ 这两个集合连属性读取都不该发生。
    for (const key of MEMORY_ONLY) {
      expect(probe.reads[key] ?? 0, `关着的时候读了 ${key} —— 白付 O(表) 的物化`).toBe(0);
    }
  });

  it('开着时同一条路必须真的读到它们（正向对照：闸门没把这条路一起掐掉）', async () => {
    const probe = await mountThenInstrument(true);

    expect(probe.reads[ALWAYS_READ] ?? 0).toBeGreaterThanOrEqual(1);
    for (const key of MEMORY_ONLY) {
      expect(
        probe.reads[key] ?? 0,
        `开着却没读 ${key} ⇒ 探针或调用点变了，上面那条 0 也就同时失去意义`,
      ).toBeGreaterThanOrEqual(1);
    }
  });
});
