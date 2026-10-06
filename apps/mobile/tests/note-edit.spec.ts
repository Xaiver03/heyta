/**
 * 便签编辑链（多端第二批）：改正文 → 恰好一条 `UPD`、只带 `content`
 * =================================================================
 *
 * 🔴 **为什么这个文件必须存在**（而不是"共享组件有 prop、动作层有函数"就够了）：
 * 审计里那条「便签编辑：零件都在、没人接线」的形状是 —— prop 在
 * （`packages/ui/src/notes/NotesBoard.tsx` 的 `onEdit`）、函数在
 * （`packages/app-host/src/note-actions.ts` 的 `updateNoteContent`）、
 * **两端都不传**。少任何一个接线点，界面就只是"没有这个功能"，
 * 而类型检查、构建、既有测试**一个都不会红**。所以这里既测落库行为，
 * 也逐点钉住接线。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 三层判据，各挡一种"安静的坏法"：
 *
 * 1. **op 的形状**（真实引擎 + 真实 SQLite `:memory:`）：一次编辑 = 恰好一条
 *    `UPD`，载荷**只有** `content`。多带一个键就是"一个意图 fan-out 成多个字段"，
 *    少一条就是没保存。
 * 2. **没改动就不写**（`updatedAt` 现量，不是只看 op 条数）：`UPD` 推进 `updatedAt`，
 *    而它是 `sortNotesForDisplay` 的第二段 —— 闸门没了的话，症状是
 *    "点开看了一眼，这条便签跳到列表最前"，而**全程没有任何一处报错**。
 *    ⚠️ 只看 `opCount` 挡不住"写了 op 但没改 updatedAt"那种半坏，所以两条都测。
 * 3. **接线**（逐点读源码）：两端的 `onEdit` / `onOpenNote` 与共享编辑器。
 *
 * ⚠️ 本文件**不 import `@heyta/ui` 的任何值**（与 `lib/notes-display.ts` 同一条纪律）：
 * 移动端 vitest 跑在 node 里，而 `@heyta/ui` 的 `dist` 顶层 import `react-native`，
 * 值导入会让整个 spec 文件转译失败。接线那一层因此按本仓库既有约定读源码断言。
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Note } from '@heyta/domain';
import { createNoteActions, type NoteActions } from '@heyta/app-host';
import { translate } from '@heyta/i18n';
import { OpLogEngine } from '@heyta/op-log';
import { DbOpLogStore, INDEXEDDB_SCHEMA, SqliteAdapter } from '@heyta/storage';
import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';
import { OpType } from '@heyta/sync-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string): string => readFileSync(resolve(here, '../src', rel), 'utf8');
const webSrc = (rel: string): string =>
  readFileSync(resolve(here, '../../web/src/features/notes', rel), 'utf8');

let adapter: SqliteAdapter;
let engine: OpLogEngine;
let actions: NoteActions;
let clock = 1_700_000_000_000;
const now = (): number => clock;

let seq = 0;
const makeNoteId = (): string => {
  seq += 1;
  return `note-edit-${String(seq).padStart(3, '0')}`;
};

const stateNote = (id: string): Note =>
  (engine.getState() as unknown as { notes: Record<string, Note> }).notes[id];

const opsFor = async (id: string): Promise<{ opType: string; payload: Record<string, unknown> }[]> =>
  (await engine.getOpsForEntity('NOTE', id)) as unknown as {
    opType: string;
    payload: Record<string, unknown>;
  }[];

beforeEach(async () => {
  adapter = new SqliteAdapter({
    schema: INDEXEDDB_SCHEMA,
    driverFactory: () => new NodeSqliteDriver(':memory:'),
  });
  await adapter.init();
  engine = new OpLogEngine({ store: new DbOpLogStore(adapter), clientId: 'client-note-edit', now });
  clock = 1_700_000_000_000;
  seq = 0;
  actions = createNoteActions(engine, { newNoteId: makeNoteId });
});

afterEach(async () => {
  await adapter.close();
});

describe('改正文落库的形状', () => {
  it('🔴 一次编辑 = 恰好一条 UPD，且载荷**只有** content 一个键', async () => {
    const id = await actions.createNote('旧正文');
    expect(await opsFor(id)).toHaveLength(1);

    clock += 1_000;
    await actions.updateNoteContent(id, '  新正文  ');

    const ops = await opsFor(id);
    // 1 条 CRT + **恰好** 1 条 UPD —— 多一条就是"一个意图 fan-out 成多个 op"。
    expect(ops).toHaveLength(2);
    expect(ops[1]?.opType).toBe(OpType.Update);
    expect(Object.keys(ops[1]?.payload ?? {})).toEqual(['content']);
    // trim 后的值才落库（首尾空白是粘贴带进来的，不是用户写的内容）。
    expect(ops[1]?.payload.content).toBe('新正文');
    expect(stateNote(id).content).toBe('新正文');
  });

  it('空正文抛错且不写 op（要清空就删掉这条便签）', async () => {
    const id = await actions.createNote('旧正文');
    await expect(actions.updateNoteContent(id, '   \n  ')).rejects.toThrow(/不能为空/);
    expect(await opsFor(id)).toHaveLength(1);
    expect(stateNote(id).content).toBe('旧正文');
  });

  it('🔴 正文没改动 → 一条 op 都不写，且 updatedAt 不前进', async () => {
    const id = await actions.createNote('买牛奶');
    const stampBefore = stateNote(id).updatedAt;

    // 只动了首尾空白：`updateNoteContent` 存的是 trim 后的值，所以这就是"没改动"。
    clock += 60_000;
    await actions.updateNoteContent(id, '  买牛奶  ');

    expect(await opsFor(id)).toHaveLength(1);
    expect(stateNote(id).content).toBe('买牛奶');
    /**
     * 这条是本用例最有牙的部分：`updatedAt` 一旦前进，这条便签就会
     * **跳到列表最前面**（排序第二段），而界面上一切"正常"。
     */
    expect(stateNote(id).updatedAt).toBe(stampBefore);
  });

  it('连点两次"保存"不会把这条便签挤到列表最前（钉选那条仍然在最前）', async () => {
    const plain = await actions.createNote('普通便签');
    const pinned = await actions.createNote('钉住的便签');
    await actions.setNotePinnedToToday(pinned, true);

    const before = actions.listNotes().map((note) => note.id);
    expect(before).toEqual([pinned, plain]);

    // 用户在编辑屏里连着按了两次保存，内容一个字没改。
    clock += 60_000;
    await actions.updateNoteContent(plain, '普通便签');
    await actions.updateNoteContent(plain, '普通便签');

    expect(actions.listNotes().map((note) => note.id)).toEqual(before);
  });

  it('改完正文后顺序按 updatedAt 重排（真改了就要真的动）', async () => {
    const a = await actions.createNote('A');
    // 🔴 必须错开时刻：`sortNotesForDisplay` 第二段是 `updatedAt` **降序**、
    // 第三段才是 id。同一毫秒建的两条会按 id 字典序排，那这条用例就是在测 id。
    clock += 1_000;
    const b = await actions.createNote('B');
    expect(actions.listNotes()[0]?.id).toBe(b);

    clock += 60_000;
    await actions.updateNoteContent(a, 'A 改过了');
    expect(actions.listNotes()[0]?.id).toBe(a);
  });
});

describe('接线：编辑入口在两端都真的连着', () => {
  it('`NotesSection` 传了 onEdit，并把编辑屏挂上（共享组件按传没传决定渲不渲染）', () => {
    const section = src('screens/NotesSection.tsx');
    expect(section).toContain('<NotesBoard');
    expect(section).toContain('onEdit={(entityId) => {');
    expect(section).toContain('<NoteEditScreen');
    expect(section).toContain("import { NoteEditScreen } from './NoteEditScreen';");
  });

  it('`NoteEditScreen` 走的是动作层，**不自己拼 op**（AGENTS §3.5）', () => {
    const screen = src('screens/NoteEditScreen.tsx');
    expect(screen).toContain('<NoteEditor');
    expect(screen).toContain('.updateNoteContent(noteId, content)');
    expect(screen).not.toContain("entityType: 'NOTE'");
    // 棘轮：移动端 screens 的内联样式**恰在基线 90**，新增一行的净增必须是 0。
    expect(screen.split('style={{').length - 1).toBe(0);
  });

  it('搜索里的便签行可点：SearchScreen 收 onOpenNote 并透传给共享面板', () => {
    const search = src('screens/SearchScreen.tsx');
    expect(search).toContain('onOpenNote: (noteId: string) => void;');
    expect(search).toContain('onOpenNote={onOpenNote}');
  });

  it('`TasksScreen` 把搜索结果那条接到编辑屏，且先关浮层再开屏', () => {
    const tasks = src('screens/TasksScreen.tsx');
    expect(tasks).toContain('onOpenNote={(id) => {');
    expect(tasks).toContain('setSearchOpen(false);');
    expect(tasks).toContain('<NoteEditScreen');
  });

  it('web 同批补传：NotesView 传 onEdit 并渲染**同一个**共享编辑器', () => {
    const view = webSrc('NotesView.tsx');
    expect(view).toContain('onEdit={(entityId) => {');
    expect(view).toContain('<NoteEditor');
    const store = webSrc('store.ts');
    expect(store).toContain('noteActions.updateNoteContent(entityId, content)');
  });
});

describe('文案：中英两侧都取得到，且不互相冒充', () => {
  const KEYS = ['notes.edit.title', 'notes.save', 'notes.cancel', 'notes.edit.notFound'];

  for (const key of KEYS) {
    it(`「${key}」中文含 CJK、英文零 CJK`, () => {
      const zh = translate('zh-CN', key);
      const en = translate('en', key);
      // 两个字段非空 —— 漏译在这一层是**编译失败**，这里挡的是"值串了语言"。
      expect(zh.length).toBeGreaterThan(0);
      expect(en.length).toBeGreaterThan(0);
      expect(/[㐀-鿿]/.test(zh)).toBe(true);
      expect(/[㐀-鿿]/.test(en)).toBe(false);
      expect(zh).not.toBe(en);
    });
  }

  it('编辑屏复用 composer 那句占位符，而不是另起一条会漂的词条', () => {
    expect(src('screens/NoteEditScreen.tsx')).toContain("t('notes.composer.placeholder')");
    expect(webSrc('NotesView.tsx')).toContain("t('notes.composer.placeholder')");
  });
});
