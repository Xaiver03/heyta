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
  actions = createNoteActions(engine, { newNoteId: makeNoteId, now });
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

describe('回收站：listTrashed 与三件套', () => {
  it('删除后出现在 listTrashed、从 listNotes 消失；还原后反过来', async () => {
    const id = await actions.createNote('买菜');
    expect(actions.listTrashed()).toEqual([]);

    await actions.removeNote(id);
    expect(actions.listTrashed().map((n) => n.id)).toEqual([id]);
    expect(actions.listNotes()).toHaveLength(0);

    expect(await actions.restoreNote(id)).toBe(true);
    expect(actions.listTrashed()).toEqual([]);
    expect(actions.listNotes().map((n) => n.id)).toEqual([id]);
  });

  it('🔴 listTrashed 不含已彻底删除的（只滤 deletedAt 的话，"彻底删除"在界面上就没有产出）', async () => {
    const id = await actions.createNote('买菜');
    await actions.removeNote(id);
    await actions.purgeNote(id);

    expect(actions.listTrashed()).toEqual([]);
    // 墓碑**必须留着**：清掉 deletedAt 会让离线端把它当"从未删除"又同步回来。
    expect(state().notes[id]?.deletedAt).toBeDefined();
    expect(state().notes[id]?.purgedAt).toBe(clock);
  });

  it('按删除时刻倒序（同刻按 id），不是枚举顺序', async () => {
    const first = await actions.createNote('第一条');
    clock += 1_000;
    await actions.removeNote(first);
    clock += 1_000;
    const second = await actions.createNote('第二条');
    clock += 1_000;
    await actions.removeNote(second);

    expect(actions.listTrashed().map((n) => n.id)).toEqual([second, first]);
  });

  it('对活着的便签 purge 会抛错（否则它会无墓碑地消失，而离线端什么都不知道）', async () => {
    const id = await actions.createNote('活着');
    await expect(actions.purgeNote(id)).rejects.toThrow(/不在回收站里/);
    expect(await opCount(id)).toBe(1);
  });

  it('purge 幂等：重复调用不再发 op', async () => {
    const id = await actions.createNote('买菜');
    await actions.removeNote(id);
    const before = await opCount(id);
    await actions.purgeNote(id);
    await actions.purgeNote(id);
    expect(await opCount(id)).toBe(before + 1);
  });

  it('🔴 已彻底删除的便签：restore 抛错而不是安静地返回 false', async () => {
    const id = await actions.createNote('买菜');
    await actions.removeNote(id);
    await actions.purgeNote(id);

    // "现在不用恢复"（返回 false）与"永远恢复不了"（抛错）是两句话，
    // 界面对第二句要说"不可恢复"。见文件头第 5 条与 P-5。
    await expect(actions.restoreNote(id)).rejects.toThrow(/已被彻底删除，无法恢复/);
  });

  it('找不到便签时 restore 抛错（不静默吞掉），未删除时返回 false', async () => {
    await expect(actions.restoreNote('note-不存在')).rejects.toThrow(/找不到便签/);
    const id = await actions.createNote('活着');
    expect(await actions.restoreNote(id)).toBe(false);
  });
});

/**
 * 🔴 两引擎对：手机删便签 → 还原 → **另一台读到**。
 *
 * 为什么这一对是 W1 的主判据：本地发 op 与"另一端回放同一串 op 之后看到的是
 * 同一个世界"是两件事。把 `restoreNote` 退化成"只改本地物化状态、不发 op"，
 * 上面那一整组**全绿**（它们读的都是 A 自己），只有这里会红 ——
 * 而那恰好就是本工单要防的形状（AGENTS §3.4：被回放/来自远端的 op 不得再次触发副作用，
 * 反过来也成立：没发出去的 op 永远不会在别人那里生效）。
 */
describe('🔴 回收站三件套跨设备（两个真引擎 + 两个真 SQLite，零 mock）', () => {
  async function engineB(): Promise<{
    close: () => void;
    onB: NoteActions;
    applyAllFromA: () => Promise<number>;
    state: () => Record<string, Note>;
    /** B 自己**写出去**的 op 数（远端 op 不得触发副作用，§3.4）。 */
    bPending: () => Promise<number>;
  }> {
    const adapter = new SqliteAdapter({
      schema: INDEXEDDB_SCHEMA,
      driverFactory: () => new NodeSqliteDriver(':memory:'),
    });
    await adapter.init();
    const other = new OpLogEngine({
      store: new DbOpLogStore(adapter),
      clientId: 'client-note-other',
      now,
    });
    return {
      close: () => adapter.close(),
      onB: createNoteActions(other, { newNoteId: makeNoteId, now }),
      applyAllFromA: async () => {
        const pending = await engine.getPendingUpload();
        const result = await other.applyRemote(pending);
        return result.applied.length;
      },
      state: () => (other.getState() as unknown as { notes: Record<string, Note> }).notes,
      bPending: async () => (await other.getPendingUpload()).length,
    };
  }

  it('A 删除 → B 回放：B 的回收站里也有它（"在回收站"这个事实本身跨设备）', async () => {
    const b = await engineB();
    try {
      const id = await actions.createNote('买菜');
      await actions.removeNote(id);
      expect(await b.applyAllFromA()).toBe(2);

      expect(b.onB.listNotes()).toHaveLength(0);
      expect(b.onB.listTrashed().map((n) => n.id)).toEqual([id]);
    } finally {
      b.close();
    }
  });

  it('🔴 A 删除 → 还原 → B 回放：便签活着回来，content 与 projectId 逐字段仍在', async () => {
    const b = await engineB();
    try {
      const projectId = await projects.createProject('工作');
      const id = await actions.createNote('周会纪要', { projectId, isPinnedToToday: true });
      await actions.removeNote(id);
      expect(await actions.restoreNote(id)).toBe(true);
      // 4 = 建清单 CRT + 建便签 CRT + 删 DEL + 还原 UPD（`getPendingUpload` 是**整台设备**的
      // 待上传队列，不是单实体的 —— 少算那条清单会把这条断言变成猜数字）。
      expect(await b.applyAllFromA()).toBe(4);

      const back = b.onB.listNotes().find((n) => n.id === id);
      if (back === undefined) throw new Error(`B 那边没读到这条便签（id=${id}）`);
      expect(back.content).toBe('周会纪要');
      expect(noteProjectId(back)).toBe(projectId);
      expect(back.isPinnedToToday).toBe(true);
      // 墓碑是真清掉了，不是只在 A 的列表里被滤掉。
      expect(b.state()[id]?.deletedAt).toBeUndefined();
      expect(b.onB.listTrashed()).toEqual([]);
    } finally {
      b.close();
    }
  });

  it('A 彻底删除 → B 回放：B 里它离开回收站、墓碑仍在、恢复被拒绝', async () => {
    const b = await engineB();
    try {
      const id = await actions.createNote('买菜');
      await actions.removeNote(id);
      await actions.purgeNote(id);
      expect(await b.applyAllFromA()).toBe(3);

      expect(b.onB.listTrashed()).toEqual([]);
      expect(b.state()[id]?.deletedAt).toBeDefined();
      expect(b.state()[id]?.purgedAt).toBeTypeOf('number');
      await expect(b.onB.restoreNote(id)).rejects.toThrow(/已被彻底删除/);
    } finally {
      b.close();
    }
  });

  it('回放是幂等的：同一串 op 再送一次，B 的状态不变、也不产生新的本地 op', async () => {
    const b = await engineB();
    try {
      const id = await actions.createNote('买菜');
      await actions.removeNote(id);
      await actions.restoreNote(id);
      const applied = await b.applyAllFromA();
      const after = b.onB.listNotes().map((n) => n.id);
      // 再送一次（等价于服务端重复投递）
      expect(await b.applyAllFromA()).toBe(0);
      expect(b.onB.listNotes().map((n) => n.id)).toEqual(after);
      expect(applied).toBe(3);
      // 🔴 B 因为收到远端 op 而**没有**再写任何本地 op（§3.4 的反面：
      // 回放不得触发副作用，否则两台设备会把同一条便签来回写下去）。
      expect(await b.bPending()).toBe(0);
    } finally {
      b.close();
    }
  });
});
