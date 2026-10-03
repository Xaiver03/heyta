/**
 * 跨视图选中态（详情面的地基）
 * ============================
 *
 * 这一份状态此前有三个所有者（web 任务侧**没有**、web 习惯侧一个 `useState`、
 * 移动端任务侧另一个 `useState`），本文件钉的是"收拢成一份之后，那份的规则是什么"。
 * 四条规则各自对应一个**已经真实存在过的坏行为**，不是设想：
 *
 * 1. **每类至多一个选中项，换一条是替换。** 详情面只有一块地方，能同时选中两条
 *    的话它就得决定显示哪一条 —— 那是把状态机的漏洞推给界面。
 * 2. **快照引用稳定。** 宿主用 `useSyncExternalStore(subscribe, snapshot)` 接，
 *    每次新建对象会被 React 判成"永远在变"，症状是无限重渲染 + 一条运行时警告。
 *    `apps/web/src/App.tsx` 里关于 zustand 的那段注释记的是同一个坑的第一次。
 * 3. **回落只认"实体还在不在"，不认"当前筛不筛得到"。** 用筛选可见性做判据的后果
 *    是用户切一下视图，正在详情面里编辑的那条就被关掉 —— 而这条**单看每个视图都不算错**，
 *    所以必须在这里独立判红。
 * 4. **通知只在真的变了的时候发。** 重复选同一条也通知 ⇒ 每次点击都白重渲染一次详情面。
 *
 * 纯逻辑，不起 React、不发请求。宿主接线与界面的判据在各宿主自己的 tests 目录里。
 */

import { describe, expect, it, vi } from 'vitest';

import {
  SELECTABLE_KINDS,
  createSelectionStore,
  pruneMissingSelection,
  pruneSelection,
} from '../src/selection.js';

describe('选中态：每类至多一个选中项', () => {
  it('换一条是替换，不是叠加', () => {
    const store = createSelectionStore();
    store.select('task', 'a');
    store.select('task', 'b');
    expect(store.get('task')).toBe('b');
    // 🔴 快照里也必须只剩一条：只查 get() 会漏掉"两个都留着"这种实现。
    expect(Object.keys(store.snapshot())).toEqual(['task']);
  });

  it('两类同时选中互不影响（详情面按类分派的前提）', () => {
    const store = createSelectionStore();
    store.select('task', 't1');
    store.select('habit', 'h1');
    expect(store.get('task')).toBe('t1');
    expect(store.get('habit')).toBe('h1');
    expect(store.snapshot()).toEqual({ task: 't1', habit: 'h1' });
  });

  it('select(kind, null) 与 clear(kind) 等价', () => {
    const a = createSelectionStore({ task: 'x' });
    a.select('task', null);
    const b = createSelectionStore({ task: 'x' });
    b.clear('task');
    expect(a.snapshot()).toEqual(b.snapshot());
    expect(a.get('task')).toBeNull();
  });

  it('clear() 不带参数 = 全清（退出登录 / 切账号用）', () => {
    const store = createSelectionStore({ task: 't', note: 'n', habit: 'h' });
    expect(Object.keys(store.snapshot()).length).toBe(3);
    store.clear();
    expect(store.snapshot()).toEqual({});
    // 逐类都查：只查 snapshot 会漏掉"清空了快照但 get() 还读旧 Map"的实现。
    for (const kind of SELECTABLE_KINDS) expect(store.get(kind)).toBeNull();
  });

  it('词表是封闭的：新增一类必须显式改这里', () => {
    // 🔴 这一份是**类型层**的封闭；运行时还有第二道 ——
    // `scripts/check-selection-single-source.mjs` 的断言 D 会查新加的那一类
    // 在宿主里到底有没有人选中它。只改这里就能通过的"支持六类"是假完成。
    expect([...SELECTABLE_KINDS].sort()).toEqual(['habit', 'note', 'task'].sort());
  });
});

describe('选中态：通知的时机', () => {
  it('重复选中同一条不发通知', () => {
    const store = createSelectionStore();
    store.select('task', 'a');
    const listener = vi.fn();
    store.subscribe(listener);
    store.select('task', 'a');
    expect(listener).not.toHaveBeenCalled();
    // 阳性对照：换一条**必须**通知。少了这一句，上面那条会因为"根本没在通知"而恒过。
    store.select('task', 'b');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('清除一个没选中的类不发通知', () => {
    const store = createSelectionStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.clear('task');
    store.select('task', null);
    expect(listener).not.toHaveBeenCalled();
  });

  it('订阅者在通知进行中退订别人，不会跳过它后面的订阅者', () => {
    // 组件卸载就发生在这一轮里，所以"边通知边删"是常态而不是边角。
    // 直接 `for (const l of listeners)` 在删掉 B 之后会**跳过 C**（Set 迭代器的行为），
    // 症状是"某个面板这一次没刷新"，而且取决于订阅顺序 —— 最难复现的那一类。
    const store = createSelectionStore();
    const calls = { a: 0, b: 0, c: 0 };
    store.subscribe(() => {
      calls.a += 1;
      offB();
    });
    const offB = store.subscribe(() => {
      calls.b += 1;
    });
    store.subscribe(() => {
      calls.c += 1;
    });

    store.select('task', 'a');
    // B 是本轮被退订的：它在本轮收到（复制过列表），关键是 **C 也收到**。
    expect(calls).toEqual({ a: 1, b: 1, c: 1 });

    store.select('task', 'b');
    expect(calls).toEqual({ a: 2, b: 1, c: 2 });
  });
});

describe('选中态：快照引用稳定（useSyncExternalStore 的前提）', () => {
  it('没变化时 snapshot() 返回同一个引用', () => {
    const store = createSelectionStore({ task: 'a' });
    expect(store.snapshot()).toBe(store.snapshot());
    store.get('task');
    expect(store.snapshot()).toBe(store.snapshot());
  });

  it('真的变了才换引用', () => {
    const store = createSelectionStore({ task: 'a' });
    const before = store.snapshot();
    store.select('task', 'b');
    expect(store.snapshot()).not.toBe(before);
    expect(store.snapshot()).toEqual({ task: 'b' });
  });

  it('缓存的快照不能是活的：拿到之后改选中，旧快照不许跟着变', () => {
    const store = createSelectionStore({ task: 'a' });
    const frozen = store.snapshot();
    store.select('habit', 'h');
    expect(frozen).toEqual({ task: 'a' });
  });
});

describe('回落规则：只认实体存在性', () => {
  it('实体还在就原样返回（哪怕谓词说"当前视图筛不到它"之前先返回过 true）', () => {
    expect(pruneMissingSelection('a', () => true)).toBe('a');
  });

  it('实体没了就清空', () => {
    expect(pruneMissingSelection('a', () => false)).toBeNull();
  });

  it('本来没选中时什么都不做（不发通知、不调谓词）', () => {
    const exists = vi.fn(() => true);
    expect(pruneMissingSelection(null, exists)).toBeNull();
    expect(exists).not.toHaveBeenCalled();
  });

  it('pruneSelection 逐类应用同一条规则，且只清掉真的没了的那几类', () => {
    const store = createSelectionStore({ task: 't1', habit: 'h1', note: 'n1' });
    const listener = vi.fn();
    store.subscribe(listener);

    pruneSelection(store, {
      // 任务还在（即便它在当前筛选下不可见 —— 谓词**不该**被写成可见性判断）。
      task: (id) => id === 't1',
      // 习惯被删了 ⇒ 这一类要清空。
      habit: () => false,
      // 没给便签的谓词 ⇒ 不许动它。
    });

    expect(store.get('task')).toBe('t1');
    expect(store.get('habit')).toBeNull();
    expect(store.get('note')).toBe('n1');
    // 只在真的清空了一类时通知一次。
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('所有选中项都还在 ⇒ 一次通知都不发', () => {
    const store = createSelectionStore({ task: 't1', habit: 'h1' });
    const listener = vi.fn();
    store.subscribe(listener);
    pruneSelection(store, { task: () => true, habit: () => true });
    expect(listener).not.toHaveBeenCalled();
    expect(store.snapshot()).toEqual({ task: 't1', habit: 'h1' });
  });
});
