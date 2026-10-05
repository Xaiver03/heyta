/**
 * 改名 / 归档 / 删除（多端第三批）：一次意图恰好一条 op，删除是墓碑不是物理删
 * ============================================================================
 *
 * 🔴 **为什么这个文件必须存在**：审计里这三件事的形状是「动作层有函数、
 * 界面上零入口」—— `renameHabit` 与 `store.deleteHabit` 早就写好了，
 * 但两端都没传，于是类型检查、构建、既有测试**一个都不会红**，
 * 用户看到的是"建错了改不了、也删不掉"。所以这里既测落库形状，也逐点钉接线。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 三层判据，各挡一种"安静的坏法"：
 *
 * 1. **全局 op 数 +1**（不是"这个实体的 op +1"）：挡的是 fan-out。
 *    "改名顺手把 `updatedAt` 单独发一条""改标签名顺手重写所有引用它的任务"
 *    ——这两种坏法在**单实体**视角下都看不出来，只有数整条日志才藏不住。
 * 2. **重放后名字仍在**（`getAllOps()` → `replayOperations(emptyState(), ops)`）：
 *    这就是"刷新页面 / 重开 App"那一判据的等价物。只测内存态会漏掉
 *    "写进了状态但没写进日志"这一类 —— 症状是当场看着改好了，刷新就回到旧名。
 * 3. **删除 = 墓碑**：实体**仍在** `getState()` 里、`deletedAt` 有值、
 *    `listX()` 不再返回它。物理删会让另一台离线设备下次同步时把它**复活**。
 *    习惯那一条还钉住"打卡历史不级联删"：`removeHabit` 只发 HABIT 的 `DEL`，
 *    撤销删除后连续天数必须还在（否则"删错了再恢复"恢复的是空历史）。
 *
 * ⚠️ 本文件**不 import `@heyta/ui` 的任何值**（与 `note-edit.spec.ts` 同一条纪律）：
 * 移动端 vitest 跑在 node 里，而 `@heyta/ui` 的 `dist` 顶层 import `react-native`，
 * 值导入会让整个 spec 文件转译失败。接线那一层因此按本仓库既有约定读源码断言。
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Habit, HabitLog, Project, Tag } from '@heyta/domain';
import {
  createHabitActions,
  createProjectActions,
  type HabitActions,
  type ProjectActions,
} from '@heyta/app-host';
import { translate } from '@heyta/i18n';
import { OpLogEngine, emptyState, replayOperations, type MaterializedState } from '@heyta/op-log';
import { DbOpLogStore, INDEXEDDB_SCHEMA, SqliteAdapter } from '@heyta/storage';
import { NodeSqliteDriver } from '@heyta/storage/sqlite/node';
import { OpType } from '@heyta/sync-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string): string => readFileSync(resolve(here, '../src', rel), 'utf8');
const webSrc = (rel: string): string => readFileSync(resolve(here, '../../web/src', rel), 'utf8');
const uiSrc = (rel: string): string =>
  readFileSync(resolve(here, '../../../packages/ui/src', rel), 'utf8');

let adapter: SqliteAdapter;
let engine: OpLogEngine;
let projects: ProjectActions;
let habits: HabitActions;
let clock = 1_700_000_000_000;
const now = (): number => clock;

let seq = 0;
const nextId = (kind: string): string => {
  seq += 1;
  return `${kind}-rename-${String(seq).padStart(3, '0')}`;
};

const state = (): MaterializedState => engine.getState() as unknown as MaterializedState;

/** 整条日志的长度——fan-out 在这里藏不住。 */
const opCount = async (): Promise<number> => (await engine.getAllOps()).length;

const opsFor = async (entityType: string, id: string): Promise<{ opType: string; payload: Record<string, unknown> }[]> =>
  (await engine.getOpsForEntity(entityType, id)) as unknown as {
    opType: string;
    payload: Record<string, unknown>;
  }[];

/** 把当前日志整条重放一遍 = "刷新 / 重开 App"后应当看到的状态。 */
const rehydrated = async (): Promise<MaterializedState> =>
  replayOperations(emptyState(), await engine.getAllOps());

beforeEach(async () => {
  adapter = new SqliteAdapter({
    schema: INDEXEDDB_SCHEMA,
    driverFactory: () => new NodeSqliteDriver(':memory:'),
  });
  await adapter.init();
  engine = new OpLogEngine({ store: new DbOpLogStore(adapter), clientId: 'client-rename', now });
  clock = 1_700_000_000_000;
  seq = 0;
  projects = createProjectActions(engine, {
    newProjectId: () => nextId('project'),
    newTagId: () => nextId('tag'),
  });
  habits = createHabitActions(engine, {
    newHabitId: () => nextId('habit'),
    now,
  });
});

afterEach(async () => {
  await adapter.close();
});

describe('清单改名与归档的落库形状', () => {
  it('🔴 改清单名 = 全局恰好 +1 条 op，且那条 UPD **只带** name', async () => {
    const id = await projects.createProject('旧清单名');
    const before = await opCount();

    clock += 1_000;
    await projects.renameProject(id, '  新清单名  ');

    // 整条日志只多一条：任何"顺手多写一个字段/多碰一个实体"都会让这条红。
    expect(await opCount()).toBe(before + 1);
    const ops = await opsFor('PROJECT', id);
    expect(ops).toHaveLength(2);
    expect(ops[1]?.opType).toBe(OpType.Update);
    expect(Object.keys(ops[1]?.payload ?? {})).toEqual(['name']);
    expect(ops[1]?.payload.name).toBe('新清单名');
    expect((state().projects[id] as Project).name).toBe('新清单名');
  });

  it('空名抛错且不写 op；找不到实体也抛错（要清空就删掉这条清单）', async () => {
    const id = await projects.createProject('旧清单名');
    const before = await opCount();
    await expect(projects.renameProject(id, '   \n ')).rejects.toThrow(/不能为空/);
    await expect(projects.renameProject('project-不存在', '名字')).rejects.toThrow(/找不到清单/);
    expect(await opCount()).toBe(before);
    expect((state().projects[id] as Project).name).toBe('旧清单名');
  });

  it('🔴 归档与取消归档各一条 UPD、只带 archived；归档**不产生墓碑**', async () => {
    const id = await projects.createProject('要归档的清单');

    clock += 1_000;
    await projects.archiveProject(id);
    let ops = await opsFor('PROJECT', id);
    expect(ops).toHaveLength(2);
    expect(Object.keys(ops[1]?.payload ?? {})).toEqual(['archived']);
    expect(ops[1]?.payload.archived).toBe(true);
    // 归档不是删除：`deletedAt` 必须仍然没有，而 `archived` 为真。
    const archived = state().projects[id] as Project;
    expect(archived.archived).toBe(true);
    expect(archived.deletedAt).toBeUndefined();
    // 🔴 归档后**仍然列得出来**（`listProjects` 只滤删除）。把它滤掉的是
    // 共享层的 `includeArchived`，不是动作层——动作层一滤，移动端那个
    // 「显示已归档」开关就永远读不到数据了。
    expect(projects.listProjects().map((p) => p.id)).toContain(id);

    clock += 1_000;
    await projects.archiveProject(id, false);
    ops = await opsFor('PROJECT', id);
    expect(ops).toHaveLength(3);
    expect(ops[2]?.payload).toEqual({ archived: false });
    expect((state().projects[id] as Project).archived).toBe(false);
  });

  it('🔴 删清单 = 墓碑：op 多一条 DEL、实体仍在库里、list 里不再出现', async () => {
    const id = await projects.createProject('将被删除');
    const before = await opCount();

    clock += 1_000;
    await projects.removeProject(id);

    expect(await opCount()).toBe(before + 1);
    const ops = await opsFor('PROJECT', id);
    expect(ops[1]?.opType).toBe(OpType.Delete);
    expect(ops[1]?.payload).toEqual({});
    // 物理删是这批最贵的一种坏法：另一台离线设备下次同步会把这条**复活**。
    const raw = state().projects[id] as Project;
    expect(raw).toBeDefined();
    expect(typeof raw.deletedAt).toBe('number');
    expect(projects.listProjects().map((p) => p.id)).not.toContain(id);
  });

  it('改名后重放仍在（= 刷新页面 / 重开 App 那一判据）', async () => {
    const projectId = await projects.createProject('刷新前');
    clock += 1_000;
    await projects.renameProject(projectId, '刷新后');

    const fresh = await rehydrated();
    expect((fresh.projects[projectId] as Project).name).toBe('刷新后');
  });
});

describe('标签改名与删除', () => {
  it('🔴 改标签名 = 全局恰好 +1 条 op，载荷只有 name（引用它的任务一个都不碰）', async () => {
    const id = await projects.createTag('旧标签');
    const before = await opCount();

    clock += 1_000;
    await projects.renameTag(id, '  新标签  ');

    expect(await opCount()).toBe(before + 1);
    const ops = await opsFor('TAG', id);
    expect(ops).toHaveLength(2);
    expect(ops[1]?.opType).toBe(OpType.Update);
    expect(Object.keys(ops[1]?.payload ?? {})).toEqual(['name']);
    expect((state().tags[id] as Tag).name).toBe('新标签');
  });

  it('空名 / 不存在的标签都抛错且一条 op 都不写', async () => {
    const id = await projects.createTag('旧标签');
    const before = await opCount();
    await expect(projects.renameTag(id, '')).rejects.toThrow(/不能为空/);
    await expect(projects.renameTag('tag-不存在', '名字')).rejects.toThrow(/找不到标签/);
    expect(await opCount()).toBe(before);
  });

  it('🔴 删标签是墓碑，且改名后重放仍在', async () => {
    const id = await projects.createTag('待删标签');
    clock += 1_000;
    await projects.renameTag(id, '改过名');
    const fresh = await rehydrated();
    expect((fresh.tags[id] as Tag).name).toBe('改过名');

    clock += 1_000;
    await projects.removeTag(id);
    const raw = state().tags[id] as Tag;
    expect(typeof raw.deletedAt).toBe('number');
    expect(projects.listTags().map((t) => t.id)).not.toContain(id);
    // 墓碑也得跟着重放：否则刷新后"已删除的标签"会回来。
    expect((await rehydrated()).tags[id] as Tag).toMatchObject({ deletedAt: expect.any(Number) });
  });
});

describe('习惯改名与删除', () => {
  it('🔴 改习惯名 = 全局恰好 +1 条 op、载荷只有 name，且重放后仍在', async () => {
    const id = await habits.createHabit('早起');
    const before = await opCount();

    clock += 1_000;
    await habits.renameHabit(id, '  每天早起  ');

    expect(await opCount()).toBe(before + 1);
    const ops = await opsFor('HABIT', id);
    expect(ops).toHaveLength(2);
    expect(ops[1]?.opType).toBe(OpType.Update);
    expect(Object.keys(ops[1]?.payload ?? {})).toEqual(['name']);

    // 🔴 不许"删了重建"：那会换掉 id，而 HABIT_LOG 是按 (habitId, date) 寻址的。
    // 名字改完 id 必须还是同一个，重放后也在同一条上。
    const fresh = await rehydrated();
    expect((fresh.habits[id] as Habit).name).toBe('每天早起');
    expect(Object.keys(fresh.habits)).toEqual([id]);
  });

  it('空名 / 不存在的习惯都抛错且一条 op 都不写', async () => {
    const id = await habits.createHabit('早起');
    const before = await opCount();
    await expect(habits.renameHabit(id, '  ')).rejects.toThrow(/不能为空/);
    await expect(habits.renameHabit('habit-不存在', '名字')).rejects.toThrow(/找不到习惯/);
    expect(await opCount()).toBe(before);
  });

  it('🔴 删习惯是墓碑，而且**打卡历史一条都不动**', async () => {
    const id = await habits.createHabit('早起');
    await habits.checkIn(id, '2026-10-01');
    await habits.checkIn(id, '2026-10-02');
    const logsBefore = habits.listLogs().length;
    expect(logsBefore).toBe(2);

    clock += 1_000;
    const before = await opCount();
    await habits.removeHabit(id);

    expect(await opCount()).toBe(before + 1);
    const raw = state().habits[id] as Habit;
    expect(typeof raw.deletedAt).toBe('number');
    expect(habits.listHabits().map((h) => h.id)).not.toContain(id);
    // 撤销删除后连续天数还在 —— 靠的就是"日志没被顺手清掉"。
    const fresh = await rehydrated();
    expect(Object.values(fresh.habitLogs).filter((l) => (l as HabitLog).deletedAt === undefined)).toHaveLength(
      logsBefore,
    );
  });
});

describe('接线：入口在两端都真的连着', () => {
  it('`ListsSection` 传了 onRename / onArchive，并给归档留了回程（显示已归档开关）', () => {
    const file = src('screens/ListsSection.tsx');
    expect(file).toContain('onRename={(item, next) => {');
    expect(file).toContain('actions.renameProject(item.id, next)');
    expect(file).toContain('onArchive={(item, archived) => {');
    expect(file).toContain('actions.archiveProject(item.id, archived)');
    // 🔴 归档是**单向门**风险：给了 onArchive 却不给 `includeArchived` + 开关，
    // 用户按了归档就再也找不回来。三条必须同时在场。
    expect(file).toContain('includeArchived: showArchived');
    expect(file).toContain("t('common.organizer.showArchived')");
    // 动作层之外不许自己拼 op（AGENTS §3.5）。
    expect(file).not.toContain("entityType: 'PROJECT'");
    // 棘轮：移动端 screens 的内联样式恰在基线 90，新代码的净增必须是 0。
    expect(file.split('style={{').length - 1).toBe(0);
  });

  it('`TagsSection` 传了 onRename（标签没有归档：`Tag` 没有 `archived` 字段）', () => {
    const file = src('screens/TagsSection.tsx');
    expect(file).toContain('onRename={(item, next) => {');
    expect(file).toContain('actions.renameTag(item.id, next)');
    expect(file).not.toContain("entityType: 'TAG'");
    expect(file.split('style={{').length - 1).toBe(0);
  });

  it('`HabitsScreen` 走动作层改名与删除，且改名态按 id 记（不跟着下一条留在屏上）', () => {
    const file = src('screens/HabitsScreen.tsx');
    expect(file).toContain('actions.renameHabit(id, next)');
    expect(file).toContain('actions.removeHabit(id)');
    expect(file).toContain('const [renamingId, setRenamingId] = useState<string | null>(null);');
    expect(file).toContain('renamingId === selected.id');
    expect(file).not.toContain("entityType: 'HABIT'");
    expect(file.split('style={{').length - 1).toBe(0);
  });

  it('web 同批：store 里两个改名都有真调用点，面板/视图把入口传下去了', () => {
    expect(webSrc('features/projects/store.ts')).toContain('projectActions.renameTag(id, name)');
    expect(webSrc('features/projects/ProjectsPanel.tsx')).toContain('projects.renameTag(item.id, name)');
    expect(webSrc('features/habits/store.ts')).toContain('habitActions.renameHabit(habitId, name)');
    /* 🔴 这两条从 `HabitsView.tsx` 改指 `HabitDetailCard.tsx`（工单 §8.133 的**搬家**，不是新债务）：
       习惯面单从内容列的窗格搬进详情列之后，改名与删除的**调用点**跟着面单走，
       视图只剩清单。登记的道理与 `check:selection-single-source` 的 `ROW_ID_EXEMPT` 一样 ——
       **判据按"文件 + 那一句"索引的时候，搬家必须同时改指向**，否则下一轮会把"文件换名"
       读成"入口消失了"，而真正会漏的是相反的那一种：把旧文件里剩下的注释当成调用点。 */
    expect(webSrc('features/habits/HabitDetailCard.tsx')).toContain('store.renameHabit(id, next)');
    expect(webSrc('features/habits/HabitDetailCard.tsx')).toContain('store.deleteHabit(');
  });

  it('共享层只让位、不藏第二份行骨架：`OrganizerList` 的 rename/archive prop 默认不渲染', () => {
    const list = uiSrc('projects/OrganizerList.tsx');
    // 默认值等于原值 = 消费者零改动的正解；缺省必须是"没有这个入口"。
    expect(list).toContain('onRename');
    expect(list).toContain('onArchive');
    // 「已归档」的口径在共享层，两端不许各抄一份 filter。
    expect(uiSrc('projects/model.ts')).toContain('export function archivedProjects');
    expect(uiSrc('index.ts')).toContain('archivedProjects,');
    expect(src('screens/ListsSection.tsx')).toContain('archivedProjects(projects)');
    expect(webSrc('features/projects/ProjectsPanel.tsx')).toContain('archivedProjects(projects.projects)');
  });
});

describe('文案：中英两侧都取得到，且不互相冒充', () => {
  const KEYS = [
    'common.organizer.rename.save',
    'common.organizer.rename.cancel',
    'common.organizer.archive.button',
    'common.organizer.archive.unarchive',
    'common.organizer.showArchived',
    'common.organizer.hideArchived',
    'common.habits.rename.button',
    'common.habits.rename.label',
    'common.habits.delete.button',
  ];

  for (const key of KEYS) {
    it(`「${key}」中文含 CJK、英文零 CJK`, () => {
      const zh = translate('zh-CN', key);
      const en = translate('en', key);
      expect(zh.length).toBeGreaterThan(0);
      expect(en.length).toBeGreaterThan(0);
      expect(/[㐀-鿿]/.test(zh)).toBe(true);
      expect(/[㐀-鿿]/.test(en)).toBe(false);
      expect(zh).not.toBe(en);
    });
  }

  it('改名按钮的无障碍名带实体当前名（两端复用同一条带参数的词条）', () => {
    const zh = translate('zh-CN', 'common.organizer.rename.button', { name: '买牛奶' });
    const en = translate('en', 'common.organizer.rename.button', { name: 'buy milk' });
    expect(zh).toContain('买牛奶');
    expect(en).toContain('buy milk');
    expect(src('screens/ListsSection.tsx')).toContain("t('common.organizer.rename.button'");
    expect(webSrc('features/projects/ProjectsPanel.tsx')).toContain("t('common.organizer.rename.button'");
  });
});
