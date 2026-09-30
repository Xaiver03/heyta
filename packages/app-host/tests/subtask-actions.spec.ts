/**
 * 子任务的**写路径**（B1-3 / 方案 §5.5 第 2 项）
 * ================================================
 *
 * ## 它修的是什么
 *
 * 领域层 `packages/domain/src/subtasks.ts`（616 行）**早就写好了**：
 * 建树、环防护、深度/子数上限、改父校验，一应俱全。
 * 但 `packages/app-host` 里**没有任何动作能设置 `Task.parentId`** ——
 * 实测 `grep -rn parentId packages/app-host/src/` 只命中**清单**（project）的
 * `parentId`（TickTick 导入与 project-actions），**任务的一条都没有**。
 *
 * ⇒ 结果是本仓最忌讳的那种形状：**模型支持、树能建、但用户没有任何办法
 * 把一个任务变成子任务**。它不报错，只是这个功能不存在。
 * 而 `docs/plans/site-and-parity-alignment.md` 把它标成 P0-3「对象模型地基」，
 * 理由是"三端都要改模型 ⇒ 越晚越贵"。
 *
 * ## 为什么这一组测试必须存在
 *
 * `setParent` 是**唯一**能造出环的入口（用户可以把任意任务挂到任意任务下）。
 * 环的后果不是"显示不对"，而是**无限递归 / 栈溢出 / 整屏打不开**，
 * 而且历史数据里的环还会在**读**的时候炸（`buildTaskTree` 有读时兜底，
 * 但那是第二道网）。所以这里逐条钉住 `ParentChangeRejection` 的每一种拒绝。
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTaskActions } from '../src/actions.js';
import { openAppHost, type AppHost } from '../src/host.js';

let dir: string;
let dbPath: string;
let host: AppHost | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'heyta-subtask-'));
  dbPath = join(dir, 'heyta.db');
});

afterEach(() => {
  host?.close();
  host = undefined;
  rmSync(dir, { recursive: true, force: true });
});

async function freshHost(): Promise<ReturnType<typeof createTaskActions>> {
  host = await openAppHost({ dbPath, driverFactory: () => new NodeSqliteDriver(dbPath) });
  return createTaskActions(host);
}

/** 父是谁。`undefined` = 顶级。 */
function parentOf(actions: ReturnType<typeof createTaskActions>, id: string): string | undefined {
  return actions.listTasks().find((t) => t.id === id)?.parentId;
}

describe('setParent —— 子任务的写路径', () => {
  it('能把一个任务挂到另一个下面，且**重开仍在**（真的落盘）', async () => {
    const actions = await freshHost();
    const parent = await actions.create('父任务');
    const child = await actions.create('子任务');

    await actions.setParent(child, parent);

    expect(parentOf(actions, child)).toBe(parent);

    // 重开：证明它不是只在内存里对
    host?.close();
    const reopened = await freshHost();
    expect(parentOf(reopened, child)).toBe(parent);
  });

  it('传 `undefined` 提为顶级（写成 `null` 表达"清除"，不是留一个悬空引用）', async () => {
    const actions = await freshHost();
    const parent = await actions.create('父任务');
    const child = await actions.create('子任务');
    await actions.setParent(child, parent);
    expect(parentOf(actions, child)).toBe(parent);

    await actions.setParent(child, undefined);

    expect(parentOf(actions, child)).toBeUndefined();
  });

  it('🔴 拒绝**自己当自己的父**（`self`）', async () => {
    const actions = await freshHost();
    const a = await actions.create('A');

    await expect(actions.setParent(a, a)).rejects.toThrow(/self/);
    // 拒绝之后**不能留下半截状态**
    expect(parentOf(actions, a)).toBeUndefined();
  });

  it('🔴 拒绝**造环**（`cycle`）—— 这一条漏了会让树无限递归、整屏打不开', async () => {
    const actions = await freshHost();
    const a = await actions.create('A');
    const b = await actions.create('B');
    const c = await actions.create('C');
    await actions.setParent(b, a); // B 是 A 的子
    await actions.setParent(c, b); // C 是 B 的子

    // 把 A 挂到它自己的后代 C 下面 ⇒ 环
    await expect(actions.setParent(a, c)).rejects.toThrow(/cycle/);

    // 三条的父子关系必须**原样不动**（拒绝是硬拒绝，不是"改了再回滚"）
    expect(parentOf(actions, a)).toBeUndefined();
    expect(parentOf(actions, b)).toBe(a);
    expect(parentOf(actions, c)).toBe(b);
  });

  it('拒绝不存在的任务 / 不存在的父（`task_not_found` / `parent_not_found`）', async () => {
    const actions = await freshHost();
    const a = await actions.create('A');

    await expect(actions.setParent('no-such-task', a)).rejects.toThrow(/task_not_found/);
    await expect(actions.setParent(a, 'no-such-parent')).rejects.toThrow(/parent_not_found/);
  });

  it('**已删除**的任务不能当父（用墓碑拦住，不是"找不到就算了"）', async () => {
    const actions = await freshHost();
    const parent = await actions.create('将被删的父');
    const child = await actions.create('子');
    await actions.remove(parent);

    await expect(actions.setParent(child, parent)).rejects.toThrow(/parent_not_found/);
  });

  it('拒绝超过深度上限（`depth_exceeded`）—— 判的是**整棵子树**的高度，不是只看被移动的节点', async () => {
    const actions = await freshHost();
    // MAX_SUBTASK_DEPTH = 3 ⇒ 允许 4 层（顶级 + 3 层子）
    const l0 = await actions.create('L0');
    const l1 = await actions.create('L1');
    const l2 = await actions.create('L2');
    const l3 = await actions.create('L3');
    await actions.setParent(l1, l0);
    await actions.setParent(l2, l1);
    await actions.setParent(l3, l2); // 现在 l3 在第 3 层

    // 再往下挂一层就该被拒
    const l4 = await actions.create('L4');
    await expect(actions.setParent(l4, l3)).rejects.toThrow(/depth_exceeded/);
    expect(parentOf(actions, l4)).toBeUndefined();
  });

  it('拒绝超过子任务数上限（`children_exceeded`）', async () => {
    const actions = await freshHost();
    const parent = await actions.create('父');
    // MAX_SUBTASK_CHILDREN = 100 —— 挂满再挂一个必须被拒。
    // ⚠️ 逐条 await：并发 create 会各自计算时钟，这里要的是确定的 100 条。
    for (let i = 0; i < 100; i += 1) {
      const child = await actions.create(`子 ${i}`);
      await actions.setParent(child, parent);
    }
    const extra = await actions.create('第 101 个');
    await expect(actions.setParent(extra, parent)).rejects.toThrow(/children_exceeded/);
  });

  it('**已经是同一个父**时不算重增（幂等，不会把自己挤掉）', async () => {
    const actions = await freshHost();
    const parent = await actions.create('父');
    const child = await actions.create('子');
    await actions.setParent(child, parent);

    // 再设一次同一个父 —— 必须成功，且不该被 children_exceeded 拦（它本来就在里面）
    await expect(actions.setParent(child, parent)).resolves.toBeUndefined();
    expect(parentOf(actions, child)).toBe(parent);
  });
});