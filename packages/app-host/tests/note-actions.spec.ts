/**
 * 便签动作层的测试（幻觉 #12「笔记模块」的写路径）
 * ==================================================
 *
 * 与 `habit-actions.spec.ts` / `reminder-actions.spec.ts` 同样的取舍：
 * **真实引擎 + 真实 SQLite（`:memory:`）**。
 *
 * 重点盯四类**静默失效**（都是"op 写得出来、界面却看不见"的形状）：
 *   1. 便签挂到已删除的清单 → 落进一个**没有任何清单能匹配**的分组，
 *      用户在界面上找不到自己刚建的便签，而所有 op 都是对的。
 *   2. 撤销删除后墓碑没清 → 便签**永远回不来**（`CRT`/`UPD` 是合并语义，
 *      不会替调用方清 `deletedAt`）。
 *   3. 空内容被接受 → 列表里多出一行**看不见的字**。
 *   4. 排序不在领域层 → 两端同刻更新的便签顺序不同，看起来像"同步乱了"。
 */

import type { Note, Project } from '@heyta/domain';
import { NOTE_MAX_CONTENT_LENGTH, noteProjectId, sortNotesForDisplay } from '@heyta/domain';
import { OpLogEngine } from '@heyta/op-log';
import { DbOpLogStore, INDEXEDDB_SCHEMA, SqliteAdapter } from '@heyta/storage';
import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';
import { OpType } from '@heyta/sync-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createNoteActions, type NoteActions } from '../src/note-actions.js';
import { createProjectActions, type ProjectActions } from '../src/project-actions.js';

let adapter: SqliteAdapter;
let engine: OpLogEngine;
let actions: NoteActions;
let projects: ProjectActions;
let clock = 1_700_000_000_000;
const now = (): number => clock;

/** 可控 id：结构性断言不能靠随机 id。 */
let seq = 0;
const makeNoteId = (): string => {
  seq += 1;
  return `note-t-${String(seq).padStart(3, '0')}`;
};
let pseq = 0;
const makeProjectId = (): string => {
  pseq += 1;
  return `proj-t-${String(pseq).padStart(3, '0')}`;
};

const state = (): { notes: Record<string, Note>; projects: Record<string, Project> } =>
  engine.getState() as unknown as {
    notes: Record<string, Note>;
    projects: Record<string, Project>;
  };

const opCount = async (entityId: string): Promise<number> =>
  (await engine.getOpsForEntity('NOTE', entityId)).length;

const lastPayload = async (entityId: string): Promise<Record<string, unknown>> => {
  const ops = await engine.getOpsForEntity('NOTE', entityId);
  const last = ops.at(-1);
  if (last === undefined) throw new Error(`没找到 ${entityId} 的 op`);
  return last.payload as Record<string, unknown>;
};

beforeEach(async () => {
  adapter = new SqliteAdapter({
    schema: INDEXEDDB_SCHEMA,
    driverFactory: () => new NodeSqliteDriver(':memory:'),
  });
  await adapter.init();
  engine = new OpLogEngine({
    store: new DbOpLogStore(adapter),
    clientId: 'client-note',
    now,
  });
  clock = 1_700_000_000_000;
  seq = 0;
  pseq = 0;
  actions = createNoteActions(engine, { newNoteId: makeNoteId });
  projects = createProjectActions(engine, { newProjectId: makeProjectId });
});

afterEach(() => {
  adapter.close();
});

describe('新建便签', () => {
  it('产出一条 NOTE Create op，把 content / projectId / isPinnedToToday 落进物化状态', async () => {
    const id = await actions.createNote('买菜');

    const ops = await engine.getOpsForEntity('NOTE', id);
    expect(ops).toHaveLength(1);
    expect(ops[0]?.entityType).toBe('NOTE');
    expect(ops[0]?.opType).toBe(OpType.Create);
    expect(await lastPayload(id)).toMatchObject({
      content: '买菜',
      projectId: null,
      isPinnedToToday: false,
    });
    expect(state().notes[id]?.content).toBe('买菜');
  });

  it('首尾空白被 trim（粘贴常带尾随换行）', async () => {
    const id = await actions.createNote('  买菜\n\n');
    expect(state().notes[id]?.content).toBe('买菜');
  });

  it.each(['', '   ', '\n\t '])('空白内容 %j 被拒绝', async (content) => {
    await expect(actions.createNote(content)).rejects.toThrow(/不能为空/);
    expect(Object.keys(state().notes)).toHaveLength(0);
  });

  it('超长内容被拒绝（闸门不是玩法）', async () => {
    const tooLong = 'x'.repeat(NOTE_MAX_CONTENT_LENGTH + 1);
    await expect(actions.createNote(tooLong)).rejects.toThrow(/不合法/);
  });

  it('可以挂到清单下，也可以钉到「今天」', async () => {
    const projectId = await projects.createProject('工作');
    const id = await actions.createNote('周会纪要', { projectId, isPinnedToToday: true });
    expect(state().notes[id]?.projectId).toBe(projectId);
    expect(state().notes[id]?.isPinnedToToday).toBe(true);
  });

  it('🔴 挂到已删除的清单会抛错（否则便签落进一个看不见的分组）', async () => {
    const projectId = await projects.createProject('工作');
    await projects.removeProject(projectId);

    await expect(actions.createNote('孤儿便签', { projectId })).rejects.toThrow(/找不到清单/);
  });

  it('未归属（projectId: null）永远合法 —— 它是正常状态，不是"没填"', async () => {
    const id = await actions.createNote('随手记', { projectId: null });
    // 🔴 断言的是**领域访问器**而不是裸字段：reducer 把 `null` 翻成"删掉这个键"，
    // 所以裸字段读回来是 `undefined` —— 见 `Note.projectId` 的注释第 3 条。
    const note = state().notes[id];
    expect(note).toBeDefined();
    expect(note?.projectId).toBeUndefined();
    expect(noteProjectId(note as Note)).toBeNull();
  });

  it('两次 create 得到两条**不同的**便签（内容相同也不合并）', async () => {
    const a = await actions.createNote('买牛奶');
    const b = await actions.createNote('买牛奶');
    expect(a).not.toBe(b);
    expect(actions.listNotes()).toHaveLength(2);
  });
});

describe('改正文', () => {
  it('写一条 Update op，并把 trim 后的正文落库', async () => {
    const id = await actions.createNote('旧');
    clock += 1_000;
    await actions.updateNoteContent(id, '  新内容  ');

    expect(await opCount(id)).toBe(2);
    expect(await lastPayload(id)).toMatchObject({ content: '新内容' });
  });

  it('空内容抛错，且**不写 op**（要清空就删掉这条便签）', async () => {
    const id = await actions.createNote('旧');
    await expect(actions.updateNoteContent(id, '   ')).rejects.toThrow(/不能为空/);
    expect(await opCount(id)).toBe(1);
  });

  it('找不到便签时抛错', async () => {
    await expect(actions.updateNoteContent('note-missing', 'x')).rejects.toThrow(/找不到便签/);
  });
});

describe('归属与钉选', () => {
  it('改归属写 projectId；移出清单写 null（变成"字段不存在"，领域访问器归一成 null）', async () => {
    const projectId = await projects.createProject('工作');
    const id = await actions.createNote('a', { projectId });

    clock += 1_000;
    await actions.setNoteProject(id, null);
    expect(await lastPayload(id)).toEqual({ projectId: null });
    expect(state().notes[id]?.projectId).toBeUndefined();
    expect(noteProjectId(state().notes[id] as Note)).toBeNull();
  });

  it('改归属时同样校验清单存在', async () => {
    const id = await actions.createNote('a');
    await expect(actions.setNoteProject(id, 'proj-missing')).rejects.toThrow(/找不到清单/);
  });

  it('钉选 / 取消钉选各写一条 Update', async () => {
    const id = await actions.createNote('a');
    clock += 1_000;
    await actions.setNotePinnedToToday(id, true);
    expect(state().notes[id]?.isPinnedToToday).toBe(true);

    clock += 1_000;
    await actions.setNotePinnedToToday(id, false);
    expect(state().notes[id]?.isPinnedToToday).toBe(false);
  });
});

describe('删除与撤销删除', () => {
  it('删除是软删除（DEL op），实体仍在桶里带墓碑', async () => {
    const id = await actions.createNote('a');
    await actions.removeNote(id);

    const ops = await engine.getOpsForEntity('NOTE', id);
    expect(ops.at(-1)?.opType).toBe(OpType.Delete);
    expect(state().notes[id]?.deletedAt).toBeDefined();
    expect(actions.listNotes()).toHaveLength(0);
  });

  it('🔴 撤销删除必须清墓碑 —— 不清的话便签永远回不来', async () => {
    const id = await actions.createNote('a');
    await actions.removeNote(id);
    const restored = await actions.restoreNote(id);

    expect(restored).toBe(true);
    expect(state().notes[id]?.deletedAt).toBeUndefined();
    expect(actions.listNotes()).toHaveLength(1);
  });

  it('未删除时 restore 返回 false，且不写多余 op', async () => {
    const id = await actions.createNote('a');
    expect(await actions.restoreNote(id)).toBe(false);
    expect(await opCount(id)).toBe(1);
  });

  it('删一条不存在的便签抛错', async () => {
    await expect(actions.removeNote('note-missing')).rejects.toThrow(/找不到便签/);
  });
});

describe('读取与顺序', () => {
  it('顺序与领域层 sortNotesForDisplay 完全一致（不是第二份实现）', async () => {
    const ordinary = await actions.createNote('普通');
    clock += 1_000;
    const pinned = await actions.createNote('钉选', { isPinnedToToday: true });

    const listed = actions.listNotes().map((note) => note.id);
    // 钉选的在前，尽管它更晚创建。
    expect(listed).toEqual([pinned, ordinary]);

    // 🔴 与领域函数**逐项相等** —— 若哪一端自己写了排序，这条会红。
    const expected = sortNotesForDisplay(Object.values(state().notes)).map((note) => note.id);
    expect(listed).toEqual(expected);
  });

  it('notesOf(null) 只给未归属的；notesOf(projectId) 只给该清单下的', async () => {
    const projectId = await projects.createProject('工作');
    const loose = await actions.createNote('无归属');
    const attached = await actions.createNote('有归属', { projectId });

    expect(actions.notesOf(null).map((n) => n.id)).toEqual([loose]);
    expect(actions.notesOf(projectId).map((n) => n.id)).toEqual([attached]);
  });

  it('highlightedNotes() 只给钉到「今天」的', async () => {
    await actions.createNote('普通');
    const pinned = await actions.createNote('钉选', { isPinnedToToday: true });
    expect(actions.highlightedNotes().map((n) => n.id)).toEqual([pinned]);
  });
});
