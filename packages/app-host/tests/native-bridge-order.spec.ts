/**
 * G5：桌面窄门面的列表顺序**必须与共享的那一份一致**
 * ====================================================
 *
 * ## 它防的是什么
 *
 * `packages/app-host/src/native-bridge.ts` 的 `listTasks()` 原先自己写了一份
 * `(createdAt, id)` 排序，理由是"`TaskActions` 的文档写明列表按它排序"。
 * 那句话没错 —— 但它描述的是**引擎的落盘顺序**，不是**用户该看到的顺序**。
 * 用户该看到的顺序（完成态 → 截止日升序 → 原序）当时只存在于 `packages/ui`，
 * 而 app-host **够不到那个包**（ui 的 peer 是 react/react-native，
 * 让 app-host 依赖它会把 React 拖进一个今天零框架依赖的包）。
 *
 * ⇒ **同一个账号，桌面壳与 web/mobile 的任务顺序不同**，且两边都不报错。
 *
 * ## 为什么用「已完成排最后」当判别点
 *
 * 两套规则在**有任务被完成**时必然分歧：
 *
 * | 场景 | `(createdAt, id)`（旧） | 展示序（共享） |
 * |---|---|---|
 * | 先建 A、再建 B，然后把 **A 完成** | A, B | **B, A** |
 *
 * 于是这一条**能失败** —— 把 `listTasks` 改回自己排序，它立刻变红。
 *
 * ## 驱动为什么要包一层
 *
 * 门面的 `NativeSqliteDriver` 契约是 **JSON 字符串参数**
 * （`all(sql, paramsJson)`）—— 那是给 C# / JSC 那些跨语言宿主用的形状。
 * `NodeSqliteDriver` 收的是**位置参数数组**。所以这里必须做那层翻译，
 * 否则会得到 `column index out of range`（本用例第一版就是这么翻车的）。
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { addTask, close, listTaskEntities, listTasks, open, setTaskDone } from '../src/native-bridge.js';

let dir: string;

/** 把 `NodeSqliteDriver` 包成门面要的「JSON 字符串参数 + JSON 字符串结果」形状。 */
function jsonDriverFactory(path: string): () => {
  exec(sql: string): unknown;
  run(sql: string, paramsJson: string): unknown;
  all(sql: string, paramsJson: string): unknown;
  close(): void;
} {
  return () => {
    const inner = new NodeSqliteDriver(path);
    const params = (paramsJson: string): Parameters<NodeSqliteDriver['all']>[1] =>
      JSON.parse(paramsJson) as Parameters<NodeSqliteDriver['all']>[1];
    return {
      exec: (sql) => inner.exec(sql),
      run: (sql, paramsJson) => inner.run(sql, params(paramsJson)),
      // 🔴 结果也要**序列化成 JSON 字符串**再交回：门面那头是
      // `JSON.parse(payload as string)`（见 `native-bridge.ts` 的 `all`）。
      // 这是给跨语言宿主定的形状 —— C#/Swift/C 只能递字符串。
      // 直接返回数组会得到 `Unexpected end of JSON input`。
      all: (sql, paramsJson) => JSON.stringify(inner.all(sql, params(paramsJson))),
      close: () => inner.close(),
    };
  };
}

/**
 * 门面是**模块级单例**（`host` 变量），且 `open()` 幂等
 * （已打开时直接返回现有宿主）。所以每条用例结束后必须 `close()`，
 * 否则下一条会拿到上一条的库。
 */
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'heyta-bridge-order-'));
  const dbPath = join(dir, 'heyta.db');
  (globalThis as { __heytaDriverFactory?: unknown }).__heytaDriverFactory =
    jsonDriverFactory(dbPath);
});

afterEach(() => {
  close();
  delete (globalThis as { __heytaDriverFactory?: unknown }).__heytaDriverFactory;
  rmSync(dir, { recursive: true, force: true });
});

describe('G5：门面的列表顺序 = 共享展示序（不是引擎序）', () => {
  it('🔴 已完成的任务排在最后 —— 这一条把"自己写一份排序"钉死', async () => {
    await open({ dbPath: join(dir, 'heyta.db') });

    const { id: first } = await addTask({ title: 'A 先建' });
    await addTask({ title: 'B 后建' });

    // 把**先建的那条**完成。旧排序按 createdAt 仍会把它排在最前；
    // 共享展示序要求已完成的沉到最后。
    await setTaskDone({ id: first, done: true });

    const { tasks } = await listTasks();

    expect(tasks.map((t) => t.title)).toEqual(['B 后建', 'A 先建']);
    expect(tasks[tasks.length - 1]!.done).toBe(true);
  });

  it('未完成时保持稳定顺序（"列表会自己换位置"是用户最直接的不信任来源）', async () => {
    await open({ dbPath: join(dir, 'heyta.db') });
    await addTask({ title: '一' });
    await addTask({ title: '二' });
    await addTask({ title: '三' });

    const { tasks } = await listTasks();
    expect(tasks.map((t) => t.title)).toEqual(['一', '二', '三']);
  });
});
/**
 * M2-B：门面必须给共享 UI 一个**实体级**出口
 * ==============================================
 *
 * ## 它防的是什么
 *
 * `listTasks()` 返回的是**为"手写 3 列 ListView"裁出来的窄视图** `TaskView`
 * （只有 id/title/done/completedAt/note/projectId/dueDate）。
 * 而共享 UI（`packages/ui` 的 `TaskList`）要的是**完整 `Task`** ——
 * 它要画优先级、标签、重复等等。
 *
 * ⇒ **窄视图驱动不了共享 UI**，而这一点**不会在任何地方报错**：
 * 传进去照样能渲染，只是少画东西。这就是方案 §4.4 的 **G4**。
 *
 * ## 为什么这两条能失败
 *
 * ① 断言 `listTaskEntities` 返回的对象里**有窄视图没有的字段**（`priority` / `tagIds` /
 *    `createdAt`）—— 把它改成返回 `TaskView` 立刻变红。
 * ② 断言它**与 `listTasks` 同序** —— 那条顺序是 G5 统一过的展示序，
 *    两个出口给出不同顺序的话，同一账号在"手写壳"与"共享 UI"里又会不一致。
 */
describe('M2-B：实体级出口（共享 UI 用的那一份）', () => {
  it('🔴 实体是**原样**的：带上窄视图没有的实体字段，且不把未设置的字段补成 null', async () => {
    await open({ dbPath: join(dir, 'heyta.db') });
    await addTask({ title: '带优先级的任务' });

    const { tasks } = await listTaskEntities();
    const { tasks: narrow } = await listTasks();
    expect(tasks).toHaveLength(1);
    const task = tasks[0] as Record<string, unknown>;
    const view = narrow[0]!;

    // ① 实体**必然**有的：`EntityBase` 上的时间戳（窄视图两个都没有）。
    for (const field of ['createdAt', 'updatedAt']) {
      expect(Object.keys(task), `缺 ${field} ⇒ 给的是窄视图，不是实体`).toContain(field);
    }

    // ② 🔴 **两者真正的差别：窄视图会"规范化"，实体是原样的。**
    //    窄视图把未设置的字段补成 `null`（`completedAt: task.completedAt ?? null`），
    //    实体则**省略** `undefined` 的可选字段。
    //    ⇒ 这一条把"两个出口是不同形状"钉死；把它改成同一个形状会立刻变红。
    //
    //    ⚠️ 前两版断言都错在这里：先假设"实体是窄视图的超集"（错在派生字段 `done`），
    //    再假设"窄视图有的键实体都有"（错在被省略的 `completedAt`）。
    //    **形状要照着实测写，不能照着想象写** —— 这条测试自己就是三次例证。
    expect(view.completedAt, '窄视图应把未完成规范化成 null').toBeNull();
    expect(Object.keys(task), '实体应原样省略未设置的字段').not.toContain('completedAt');

    // ③ 窄视图的派生字段要与实体一致地推出来（`done` 由 `completedAt` 推）。
    expect(view.done).toBe(view.completedAt !== null);
    expect(task.completedAt).toBeUndefined();

    expect(task.title).toBe('带优先级的任务');
  });

  it('两个出口**同序**（否则同一账号在手写壳与共享 UI 里不一致）', async () => {
    await open({ dbPath: join(dir, 'heyta.db') });
    const { id: first } = await addTask({ title: 'A 先建' });
    await addTask({ title: 'B 后建' });
    await setTaskDone({ id: first, done: true });   // 先建的已完成 ⇒ 应沉到最后

    const narrow = (await listTasks()).tasks.map((t) => t.id);
    const entities = (await listTaskEntities()).tasks.map((t) => (t as { id: string }).id);

    expect(entities).toEqual(narrow);
    // 顺带钉一下"确实发生了重排"，否则 `toEqual` 在两条都乱序时也会过
    expect(entities[entities.length - 1]).toBe(first);
  });
});
