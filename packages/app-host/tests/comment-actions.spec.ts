/**
 * 评论动作层的测试（ADR-0062 W3/W4 的**最后一米**）
 * ==================================================
 *
 * 与 `note-actions.spec.ts` 同一个取舍：**真实引擎 + 真实 SQLite（`:memory:`）**，
 * 状态与 reducer 语义都不 mock（评论的 `createdAt` 由 op 时间戳派生、
 * `DEL` 落墓碑、`{ deletedAt: null }` 清墓碑 —— 这些都要真的跑一遍才算数）。
 *
 * 两个**刻意**与便签那份不同的地方，都是这个实体的语义决定的：
 *
 * 1. 🔴 **share 端口是假的，但"个人 op-log 一次都不许被写到"是真的**：
 *    `ctx.dispatch` 被换成一个**记账 + 抛错**的桩。任何一条评论 op 误走个人通道，
 *    这里立刻红 —— 而不是等到线上被服务端永久拒绝
 *    （理由：`op-log/src/state.ts` 的 `comments` 桶注释「个人 op-log 里不会有
 *    COMMENT op（白名单 + role 门都在服务端）」）。
 *    本段只定义端口、不实现传输，所以端口用假的完全够用：
 *    "载荷只有该带的那些格""路由送对了 shareId"这两条判据在端口边界上就能钉死。
 *
 * 2. **评论是用另一个引擎"回放"进来的**（`seed` → `engine.applyRemote`）：
 *    这就是生产里 share 通道的形状（`op-log/src/state.ts` 的桶注释：
 *    「只来自 share op-log 的重放」）。测试直接造 op 是**合法**的 ——
 *    `check-layering` 的规则说明里写着「测试**可以**直接造 op，那是在模拟另一台设备，
 *    不是在重新定义产品语义」。用真 reducer 物化，读侧才不是自证。
 */

import { aliveCommentsForTask, type Comment } from '@heyta/domain';
import { OpLogEngine, type OpIntent } from '@heyta/op-log';
import type { EntityType } from '@heyta/shared-schema';
import { DbOpLogStore, INDEXEDDB_SCHEMA, SqliteAdapter } from '@heyta/storage';
import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';
import { OpType } from '@heyta/sync-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTaskActions, type ActionContext, type TaskActions } from '../src/actions.js';
import {
  ListNotSharedError,
  createCommentActions,
  type CommentActions,
  type ShareOpIntent,
} from '../src/comment-actions.js';
import { createProjectActions, type ProjectActions } from '../src/project-actions.js';

/** 评论作者（本机账号）。真实宿主从会话里取，这里注入一个常量。 */
const AUTHOR = 'user-7';

let adapter: SqliteAdapter;
let seedAdapter: SqliteAdapter;
/** 被测的动作层读它的物化状态（= 生产里"个人 + share 两个 op 流物化进同一份状态"）。 */
let engine: OpLogEngine;
/** 模拟 share 通道的另一台设备：它 dispatch 出来的 COMMENT op 由 `replayShareLog` 送进来。 */
let seed: OpLogEngine;
/** 个人 op-log 的写入账本 —— 全篇都必须为空。 */
let dispatched: OpIntent[];
/** 假 share 端口收到的每一条意图。 */
let port: { shareId: string; intent: ShareOpIntent }[];
let actions: CommentActions;
let tasks: TaskActions;
let projects: ProjectActions;

let clock = 1_700_000_000_000;
const now = (): number => clock;

let commentSeq = 0;
const makeCommentId = (): string => {
  commentSeq += 1;
  return `comment-t-${String(commentSeq).padStart(3, '0')}`;
};

let projectSeq = 0;
const makeProjectId = (): string => {
  projectSeq += 1;
  return `proj-c-${String(projectSeq).padStart(3, '0')}`;
};

const state = (): {
  comments: Record<string, Comment>;
} => engine.getState() as unknown as { comments: Record<string, Comment> };

/** 共享清单 + 一条挂进去的任务。 */
const sharedTask = async (): Promise<{ projectId: string; shareId: string; taskId: string }> => {
  const projectId = await projects.createProject('协作清单');
  const shareId = `share-${projectId}`;
  await projects.setProjectShareId(projectId, shareId);
  const taskId = await tasks.create('评审意见');
  await tasks.moveToProject(taskId, projectId);
  return { projectId, shareId, taskId };
};

/** 个人清单（有清单、**没有** shareId）+ 一条任务。 */
const personalTask = async (): Promise<{ projectId: string; taskId: string }> => {
  const projectId = await projects.createProject('私人清单');
  const taskId = await tasks.create('私人任务');
  await tasks.moveToProject(taskId, projectId);
  return { projectId, taskId };
};

/** 造一条"来自 share 通道"的 COMMENT op（时间戳可控 ⇒ `createdAt` 可控）。 */
const seedCommentOp = async (
  entityId: string,
  payload: Record<string, unknown>,
  at: number,
  opType: OpType = OpType.Create,
): Promise<void> => {
  clock = at;
  await seed.dispatch({ entityType: 'COMMENT' as EntityType, entityId, opType, payload });
};

/** 把 share 通道里的 op 物化进被测引擎（重复投递幂等）。 */
const replayShareLog = async (): Promise<number> => {
  const pending = await seed.getPendingUpload();
  const result = await engine.applyRemote(pending);
  return result.applied.length;
};

/** 取一条 `ListNotSharedError`（并断言类型 —— 只断言 `toThrow` 会让"抛了别的错"也算过）。 */
const routeError = async (run: Promise<unknown>): Promise<ListNotSharedError> => {
  const error = await run.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(error instanceof ListNotSharedError)) {
    throw new Error(`期望 ListNotSharedError，收到 ${String(error)}`);
  }
  return error;
};

beforeEach(async () => {
  adapter = new SqliteAdapter({
    schema: INDEXEDDB_SCHEMA,
    driverFactory: () => new NodeSqliteDriver(':memory:'),
  });
  await adapter.init();
  seedAdapter = new SqliteAdapter({
    schema: INDEXEDDB_SCHEMA,
    driverFactory: () => new NodeSqliteDriver(':memory:'),
  });
  await seedAdapter.init();
  engine = new OpLogEngine({
    store: new DbOpLogStore(adapter),
    clientId: 'client-comment',
    now,
  });
  seed = new OpLogEngine({
    store: new DbOpLogStore(seedAdapter),
    clientId: 'client-share-seed',
    now,
  });
  clock = 1_700_000_000_000;
  commentSeq = 0;
  projectSeq = 0;
  dispatched = [];
  port = [];

  tasks = createTaskActions(engine, {
    now,
    newTaskId: (() => {
      let n = 0;
      return (): string => {
        n += 1;
        return `task-c-${String(n).padStart(3, '0')}`;
      };
    })(),
  });
  projects = createProjectActions(engine, { newProjectId: makeProjectId });
  /**
   * 🔴 评论用的 ctx：`dispatch` **记账后抛错**。
   * 生产里评论 op 绝不能进个人 op-log（服务端硬拒 + 白名单），
   * 所以这里不做"记录并转发给引擎"——那会让一条误写的 op 悄悄物化成功，
   * 测试反而是绿的。
   */
  const commentCtx: ActionContext = {
    dispatch: (intent) => {
      dispatched.push(intent);
      return Promise.reject(new Error('评论 op 不许走个人 op-log（ADR-0062 决策 4）'));
    },
    getState: () => engine.getState(),
  };
  actions = createCommentActions(commentCtx, {
    dispatchShareOp: (shareId, intent) => {
      port.push({ shareId, intent });
      return Promise.resolve();
    },
    currentUserId: () => AUTHOR,
    newCommentId: makeCommentId,
  });
});

afterEach(() => {
  adapter.close();
  seedAdapter.close();
});

describe('构造期：作者 id 必须是活的字符串', () => {
  it('空作者 id 直接拒绝构造（否则线程里会出现署名不出来的评论）', () => {
    const ctx: ActionContext = {
      dispatch: () => Promise.resolve(),
      getState: () => engine.getState(),
    };
    expect(() =>
      createCommentActions(ctx, { dispatchShareOp: () => Promise.resolve(), currentUserId: () => '  ' }),
    ).toThrow(/当前账号 id/);
  });
});

describe('建评论：路由（ADR-0062 决策 4）', () => {
  it('🔴 共享清单 ⇒ 端口收到该清单的 shareId 与一条 CRT，载荷**逐字**只有三格', async () => {
    const { shareId, taskId } = await sharedTask();
    const id = await actions.addComment(taskId, '第一版看起来不错');

    expect(port).toHaveLength(1);
    const call = port[0]!;
    expect(call.shareId).toBe(shareId);
    expect(call.intent.entityType).toBe('COMMENT');
    expect(call.intent.entityId).toBe(id);
    expect(call.intent.opType).toBe(OpType.Create);
    // 🔴 `toEqual` 而不是 `toMatchObject`：多带一格（例如客户端自己算的 `createdAt`）
    //    必须红 —— `createdAt` 由 reducer 从 op 时间戳派生，是**唯一**的时间真相。
    expect(call.intent.payload).toEqual({
      taskId,
      authorUserId: AUTHOR,
      body: '第一版看起来不错',
    });
    expect(Object.keys(call.intent.payload as object).sort()).toEqual([
      'authorUserId',
      'body',
      'taskId',
    ]);
    // 个人 op-log 一格都没写。
    expect(dispatched).toEqual([]);
    const pending = await engine.getPendingUpload();
    expect(pending.filter((op) => op.entityType === 'COMMENT')).toEqual([]);
  });

  it('正文首尾空白被 trim（粘贴常带尾随换行）', async () => {
    const { taskId } = await sharedTask();
    await actions.addComment(taskId, '  收到  \n');
    expect(port[0]?.intent.payload).toMatchObject({ body: '收到' });
  });

  it('两次建评论得到两个**不同**的 id（内容相同也不合并）', async () => {
    const { taskId } = await sharedTask();
    const a = await actions.addComment(taskId, '同一句话');
    const b = await actions.addComment(taskId, '同一句话');
    expect(a).not.toBe(b);
    expect(port).toHaveLength(2);
  });

  it('🔴 个人清单 ⇒ 抛 ListNotSharedError，端口零调用、个人 op-log 零写入', async () => {
    const { taskId } = await personalTask();
    const error = await routeError(actions.addComment(taskId, '这条不该存在'));

    expect(error.code).toBe('list-not-shared');
    expect(error.reason).toBe('project-not-shared');
    expect(error.taskId).toBe(taskId);
    // 两本账都必须是空的：**零 op** 是这条路由判据的全部意义。
    expect(port).toEqual([]);
    expect(dispatched).toEqual([]);
  });

  it('没有归属清单的任务同样拒绝（`projectId` 缺省 = 未归属）', async () => {
    const taskId = await tasks.create('散任务');
    const error = await routeError(actions.addComment(taskId, '随便写'));
    expect(error.reason).toBe('task-has-no-project');
    expect(port).toEqual([]);
  });

  it('清单已被软删 ⇒ 拒绝（墓碑上的 shareId 不算"在册共享"）', async () => {
    const { projectId, taskId } = await sharedTask();
    await projects.removeProject(projectId);
    // 前提：墓碑上 shareId 还在 —— 拒绝的理由不是"字段没了"，而是"清单不在册了"。
    await expect(actions.addComment(taskId, 'x')).rejects.toBeInstanceOf(ListNotSharedError);
    expect(port).toEqual([]);
  });

  it('任务不存在 / 已软删 ⇒ 抛错且零 op', async () => {
    await expect(actions.addComment('task-不存在', 'x')).rejects.toThrow(/找不到任务/);
    const { taskId } = await sharedTask();
    await tasks.remove(taskId);
    await expect(actions.addComment(taskId, 'x')).rejects.toThrow(/找不到任务/);
    expect(port).toEqual([]);
  });

  it('🔴 路由先于正文校验：个人清单 + 空正文 ⇒ 报"不共享"，不是"正文不能为空"', async () => {
    const { taskId } = await personalTask();
    const error = await routeError(actions.addComment(taskId, '   '));
    expect(error.code).toBe('list-not-shared');
  });

  it.each(['', '   ', '\n\t '])('共享清单上空白正文 %j 被拒绝（闸门在领域层）', async (body) => {
    const { taskId } = await sharedTask();
    await expect(actions.addComment(taskId, body)).rejects.toThrow(/正文不能为空/);
    expect(port).toEqual([]);
  });

  it('超长正文被拒绝（上限 2000，定义在 domain）', async () => {
    const { taskId } = await sharedTask();
    await expect(actions.addComment(taskId, '好'.repeat(2001))).rejects.toThrow(/正文不合法/);
    expect(port).toEqual([]);
  });
});

describe('改正文：LWW 覆盖，载荷只有 body', () => {
  it('写一条 UPD，载荷**逐字**只有 `{ body }`', async () => {
    const { shareId, taskId } = await sharedTask();
    await seedCommentOp('c-1', { taskId, authorUserId: AUTHOR, body: '旧正文' }, 2_000);
    await replayShareLog();
    port = [];

    await actions.editComment('c-1', '  新正文  ');

    expect(port).toHaveLength(1);
    expect(port[0]?.shareId).toBe(shareId);
    expect(port[0]?.intent.opType).toBe(OpType.Update);
    // 🔴 只有 `body`：`taskId` / `authorUserId` 是不可变字段，重写它们就是给
    //    "作者被改掉"留一条没人审查的路。
    expect(port[0]?.intent.payload).toEqual({ body: '新正文' });
    expect(dispatched).toEqual([]);
  });

  it('空正文抛错且零 op（要清空就删掉这条评论）', async () => {
    const { taskId } = await sharedTask();
    await seedCommentOp('c-1', { taskId, authorUserId: AUTHOR, body: '旧' }, 2_000);
    await replayShareLog();
    port = [];

    await expect(actions.editComment('c-1', '  ')).rejects.toThrow(/正文不能为空/);
    expect(port).toEqual([]);
  });

  it('评论不存在 / 已软删 ⇒ 抛错且零 op', async () => {
    await expect(actions.editComment('c-不存在', 'x')).rejects.toThrow(/找不到评论/);
    const { taskId } = await sharedTask();
    await seedCommentOp('c-dead', { taskId, authorUserId: AUTHOR, body: '旧' }, 2_000);
    await replayShareLog();
    await seedCommentOp('c-dead', {}, 3_000, OpType.Delete);
    await replayShareLog();
    port = [];

    await expect(actions.editComment('c-dead', 'x')).rejects.toThrow(/找不到评论/);
    expect(port).toEqual([]);
  });

  it('🔴 路由跟着**评论自己的任务**走，而不是调用方传的（两条共享清单各一条评论）', async () => {
    const a = await sharedTask();
    const b = await sharedTask();
    await seedCommentOp('c-in-b', { taskId: b.taskId, authorUserId: AUTHOR, body: '旧' }, 2_000);
    await replayShareLog();
    port = [];

    await actions.editComment('c-in-b', '新');
    expect(port[0]?.shareId).toBe(b.shareId);
    expect(port[0]?.shareId).not.toBe(a.shareId);
  });

  it('🔴 共享清单被摘掉之后，改一条已有评论同样被拒（写边界不认"以前能写"）', async () => {
    const { projectId, taskId } = await sharedTask();
    await seedCommentOp('c-1', { taskId, authorUserId: AUTHOR, body: '旧' }, 2_000);
    await replayShareLog();
    await projects.removeProject(projectId);
    port = [];

    await expect(actions.editComment('c-1', '新')).rejects.toBeInstanceOf(ListNotSharedError);
    expect(port).toEqual([]);
  });
});

describe('删除：墓碑语义，不是物理删', () => {
  it('写一条 DEL 且载荷为空（墓碑由 reducer 落）', async () => {
    const { shareId, taskId } = await sharedTask();
    await seedCommentOp('c-1', { taskId, authorUserId: AUTHOR, body: '要删的' }, 2_000);
    await replayShareLog();
    port = [];

    await actions.removeComment('c-1');

    expect(port).toHaveLength(1);
    expect(port[0]?.shareId).toBe(shareId);
    // 🔴 `DEL` + 空载荷 —— 变异臂 ②（把它改成清字段/物理删）必须让这条红。
    expect(port[0]?.intent.opType).toBe(OpType.Delete);
    expect(port[0]?.intent.payload).toEqual({});
    expect(dispatched).toEqual([]);
  });

  it('删不存在 / 已软删的评论 ⇒ 抛错且零 op', async () => {
    await expect(actions.removeComment('c-不存在')).rejects.toThrow(/找不到评论/);
    const { taskId } = await sharedTask();
    await seedCommentOp('c-1', { taskId, authorUserId: AUTHOR, body: 'x' }, 2_000);
    await replayShareLog();
    await seedCommentOp('c-1', {}, 3_000, OpType.Delete);
    await replayShareLog();
    port = [];

    await expect(actions.removeComment('c-1')).rejects.toThrow(/找不到评论/);
    expect(port).toEqual([]);
  });
});

describe('还原：清墓碑', () => {
  it('删后还原 ⇒ 一条 UPD，载荷**逐字** `{ deletedAt: null }`，返回 true', async () => {
    const { taskId } = await sharedTask();
    await seedCommentOp('c-1', { taskId, authorUserId: AUTHOR, body: 'x' }, 2_000);
    await replayShareLog();
    await seedCommentOp('c-1', {}, 3_000, OpType.Delete);
    await replayShareLog();
    port = [];

    expect(await actions.restoreComment('c-1')).toBe(true);
    expect(port).toHaveLength(1);
    expect(port[0]?.intent.opType).toBe(OpType.Update);
    // 🔴 `null` 而不是 `undefined`：`undefined` 会被 JSON 丢掉，对端既不清也不设，
    //    "还原"在另一台设备上静默失效（变异臂 ③）。
    expect(port[0]?.intent.payload).toEqual({ deletedAt: null });
    expect(dispatched).toEqual([]);
  });

  it('本来就没删除 ⇒ 返回 false 且**端口零调用**（不写空 op）', async () => {
    const { taskId } = await sharedTask();
    await seedCommentOp('c-1', { taskId, authorUserId: AUTHOR, body: 'x' }, 2_000);
    await replayShareLog();
    port = [];

    expect(await actions.restoreComment('c-1')).toBe(false);
    expect(port).toEqual([]);
  });

  it('🔴 已彻底删除（purgedAt）⇒ 抛错，不是安静地返回 false', async () => {
    const { taskId } = await sharedTask();
    await seedCommentOp('c-1', { taskId, authorUserId: AUTHOR, body: 'x' }, 2_000);
    await replayShareLog();
    await seedCommentOp('c-1', {}, 3_000, OpType.Delete);
    await replayShareLog();
    await seedCommentOp('c-1', { purgedAt: 4_000 }, 4_000, OpType.Update);
    await replayShareLog();
    port = [];

    // "现在不用恢复"（false）与"永远恢复不了"（抛错）是两句话（同 `restoreNote`）。
    await expect(actions.restoreComment('c-1')).rejects.toThrow(/已被彻底删除，无法恢复/);
    expect(port).toEqual([]);
  });

  it('找不到 ⇒ 抛错（不静默吞掉）', async () => {
    await expect(actions.restoreComment('c-不存在')).rejects.toThrow(/找不到评论/);
  });
});

describe('读取：过滤与排序都在领域层', () => {
  it('🔴 与领域层 `aliveCommentsForTask` 逐项相等（不是第二份实现）', async () => {
    const { taskId } = await sharedTask();
    await seedCommentOp('c-late', { taskId, authorUserId: AUTHOR, body: '晚' }, 5_000);
    await seedCommentOp('c-b', { taskId, authorUserId: AUTHOR, body: '同刻 b' }, 2_000);
    await seedCommentOp('c-a', { taskId, authorUserId: AUTHOR, body: '同刻 a' }, 2_000);
    await seedCommentOp('c-early', { taskId, authorUserId: AUTHOR, body: '早' }, 1_000);
    await replayShareLog();

    const listed = actions.commentsForTask(taskId).map((c) => c.id);
    expect(listed).toEqual(['c-early', 'c-a', 'c-b', 'c-late']);
    const expected = aliveCommentsForTask(Object.values(state().comments), taskId).map((c) => c.id);
    expect(listed).toEqual(expected);
  });

  it('软删与彻底删除的都不进线程（真 reducer 落的墓碑）', async () => {
    const { taskId } = await sharedTask();
    await seedCommentOp('c-live', { taskId, authorUserId: AUTHOR, body: '在' }, 1_000);
    await seedCommentOp('c-gone', { taskId, authorUserId: AUTHOR, body: '软删' }, 2_000);
    await seedCommentOp('c-purged', { taskId, authorUserId: AUTHOR, body: '彻底删' }, 3_000);
    await replayShareLog();
    await seedCommentOp('c-gone', {}, 4_000, OpType.Delete);
    await replayShareLog();
    await seedCommentOp('c-purged', {}, 5_000, OpType.Delete);
    await seedCommentOp('c-purged', { purgedAt: 6_000 }, 6_000, OpType.Update);
    await replayShareLog();

    // 前提：墓碑真的落到了物化状态（否则这条测试是自证）。
    expect(state().comments['c-gone']?.deletedAt).toBeTypeOf('number');
    expect(state().comments['c-purged']?.purgedAt).toBeTypeOf('number');
    expect(actions.commentsForTask(taskId).map((c) => c.id)).toEqual(['c-live']);
  });

  it('只给该任务的评论（另一条任务的线程不串）', async () => {
    const a = await sharedTask();
    const b = await sharedTask();
    await seedCommentOp('c-a', { taskId: a.taskId, authorUserId: AUTHOR, body: 'a' }, 1_000);
    await seedCommentOp('c-b', { taskId: b.taskId, authorUserId: AUTHOR, body: 'b' }, 2_000);
    await replayShareLog();

    expect(actions.commentsForTask(a.taskId).map((c) => c.id)).toEqual(['c-a']);
    expect(actions.commentsForTask(b.taskId).map((c) => c.id)).toEqual(['c-b']);
  });

  it('🔴 读不做路由判断：个人清单 / 无清单的任务返回空线程，不抛错', async () => {
    const { taskId } = await personalTask();
    const loose = await tasks.create('散任务');
    expect(actions.commentsForTask(taskId)).toEqual([]);
    expect(actions.commentsForTask(loose)).toEqual([]);
    expect(actions.commentsForTask('task-不存在')).toEqual([]);
  });

  it('还原之后同一条评论回到线程（真 reducer 清墓碑，不是本地筛掉）', async () => {
    const { taskId } = await sharedTask();
    await seedCommentOp('c-1', { taskId, authorUserId: AUTHOR, body: 'x' }, 2_000);
    await replayShareLog();
    await seedCommentOp('c-1', {}, 3_000, OpType.Delete);
    await replayShareLog();
    expect(actions.commentsForTask(taskId)).toEqual([]);

    // 把动作层刚发出去的那条 UPD 也回放进来（生产里它会经 share 通道回来）。
    await actions.restoreComment('c-1');
    const restoreOp = port.at(-1)!.intent;
    await seed.dispatch({
      entityType: 'COMMENT' as EntityType,
      entityId: restoreOp.entityId,
      opType: restoreOp.opType,
      payload: restoreOp.payload,
    });
    await replayShareLog();

    expect(actions.commentsForTask(taskId).map((c) => c.id)).toEqual(['c-1']);
    expect(state().comments['c-1']?.deletedAt).toBeUndefined();
  });
});
