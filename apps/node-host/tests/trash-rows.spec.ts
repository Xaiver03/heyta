/**
 * Node 宿主的回收站读通道（W6-b）
 * ================================
 *
 * 这里证明的是两件**别的层证明不了**的事：
 *
 *   1. `host.trashRows()` 在**真实 SQLite** 上真的把四路都吐出来。
 *      原来这个壳只有 `listTrashed()`（任务那一路），于是 W6 的判据 ④
 *      （"手机删了一条清单，另一台设备的回收站里也列出它"）在这台设备上
 *      **没有任何读通道** —— 而缺读通道的表现和"真的没同步过来"完全一样，
 *      这正是 §7 那一族"探针够不着"的形状。
 *   2. `host.listNotes()` 能读出"还原之后这条便签活着"（判据 ③ 的那一侧）。
 *
 * ⚠️ 测试里用 `createXxxActions(ctx)` 造数据，`ctx` 是 `NodeHost` 的
 * `dispatch` + `engine.getState()` 拼的 `ActionContext`。那**不是**产品代码里的
 * 胶水 —— 宿主侧的写通道刻意没扩（本机验收只读，写入都在手机上），
 * 造数据只需要满足 `ActionContext` 这个结构。
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createHabitActions,
  createNoteActions,
  createProjectActions,
  type ActionContext,
} from '@heyta/app-host';

import { openNodeHost, type NodeHost } from '../src/host.js';

const tempDirs: string[] = [];
const opened: NodeHost[] = [];

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'heyta-node-trash-'));
  tempDirs.push(dir);
  return join(dir, 'heyta.sqlite');
}

/** 本壳不暴露便签/清单/习惯的写命令（验收只需要读），测试自己拼 `ActionContext`。 */
function ctxOf(host: NodeHost): ActionContext {
  return { dispatch: host.dispatch, getState: () => host.engine.getState() };
}

afterEach(() => {
  for (const host of opened.splice(0)) host.close();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('trashRows：四路在真实库上都出得来', () => {
  it('任务 / 便签 / 清单 / 习惯各删一条 → 四行都在，标题各按自己的规则', async () => {
    const host = await openNodeHost({ dbPath: tempDbPath() });
    opened.push(host);
    const ctx = ctxOf(host);
    const notes = createNoteActions(ctx);
    const projects = createProjectActions(ctx);
    const habits = createHabitActions(ctx);

    const taskId = await host.addTask('删掉的任务');
    const noteId = await notes.createNote('删掉的便签\n第二行不该出现在标题里');
    const projectId = await projects.createProject('删掉的清单');
    const habitId = await habits.createHabit('删掉的习惯');

    await host.removeTask(taskId);
    await notes.removeNote(noteId);
    await projects.removeProject(projectId);
    await habits.removeHabit(habitId);

    const rows = host.trashRows();
    expect(new Set(rows.map((row) => row.kind))).toEqual(
      new Set(['TASK', 'NOTE', 'PROJECT', 'HABIT']),
    );
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(taskId)?.title).toBe('删掉的任务');
    // 🔴 便签那行的标题是**首段非空行**（共享的 `noteExcerpt`），不是整段正文
    expect(byId.get(noteId)?.title).toBe('删掉的便签');
    expect(byId.get(projectId)?.title).toBe('删掉的清单');
    expect(byId.get(habitId)?.title).toBe('删掉的习惯');
    for (const row of rows) expect(typeof row.deletedAt).toBe('number');
  });

  it('顺序：最近删除的在前（与两端界面同一条比较器）', async () => {
    const host = await openNodeHost({ dbPath: tempDbPath() });
    opened.push(host);
    const projects = createProjectActions(ctxOf(host));

    const early = await host.addTask('先删的');
    const late = await projects.createProject('后删的清单');
    await host.removeTask(early);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await projects.removeProject(late);

    expect(host.trashRows().map((row) => row.id)[0]).toBe(late);
  });

  it('彻底删除后从回收站消失，但**墓碑不因此不见**（I5 那一档）', async () => {
    const host = await openNodeHost({ dbPath: tempDbPath() });
    opened.push(host);
    const id = await host.addTask('purge 掉的任务');
    await host.removeTask(id);
    expect(host.trashRows().map((row) => row.id)).toContain(id);

    await host.purgeTask(id);
    expect(host.trashRows().map((row) => row.id)).not.toContain(id);
    // 已彻底删除 ≠ 列表里活着
    expect(host.listTasks().map((task) => task.id)).not.toContain(id);
  });
});

describe('listNotes：还原后的"活着"读得出来', () => {
  it('删掉 → 读不到；还原 → 又读得到，且回收站里那条同时消失', async () => {
    const host = await openNodeHost({ dbPath: tempDbPath() });
    opened.push(host);
    const notes = createNoteActions(ctxOf(host));
    const id = await notes.createNote('会被还原的便签');

    await notes.removeNote(id);
    expect(host.listNotes().map((note) => note.id)).not.toContain(id);
    expect(host.trashRows().map((row) => row.id)).toContain(id);

    expect(await notes.restoreNote(id)).toBe(true);
    expect(host.listNotes().map((note) => note.id)).toContain(id);
    expect(host.trashRows().map((row) => row.id)).not.toContain(id);
  });
});

/**
 * 🔴 帮助文本 ↔ `case` 分支的对账。
 *
 * `cli.ts` 里那段注释说的事故是真实的：`projects` 早就实现了，帮助文本却只列到
 * `pending` —— 于是验收脚本的作者以为"没有列清单的命令"，改用界面上有没有那个
 * 名字去推断跨设备同步。**少写一行帮助文本的代价，是让别人选错判据。**
 * 那句话以前只是注释，现在它有牙。
 */
describe('CLI 命令清单与 USAGE 同源', () => {
  const src = readFileSync(join(import.meta.dirname, '..', 'src', 'cli.ts'), 'utf8');

  const switchStart = src.indexOf('switch (command) {');
  const defaultAt = src.indexOf('default:', switchStart);
  const usageStart = src.indexOf('const USAGE = `');

  it('锚点都找得到（找不到就是判据自己坏了，不是命令坏了）', () => {
    expect(switchStart).toBeGreaterThan(-1);
    expect(defaultAt).toBeGreaterThan(switchStart);
    expect(usageStart).toBeGreaterThan(-1);
  });

  it('USAGE 里每一条命令都有对应的 case，反过来也是', () => {
    const body = src.slice(switchStart, defaultAt);
    const cases = [...body.matchAll(/case '([a-z][a-z-]*)':/g)].map((match) => match[1]!);
    // 非空前提：正则失效时会得到一个空数组，而空数组和"全部对账通过"长得一模一样
    expect(cases.length).toBeGreaterThan(8);

    const usageAll = src.slice(usageStart, src.indexOf('`;', usageStart));
    // 🔴 只取「命令：」那一段。整份 USAGE 里 `^  {小写词}` 还会命中
    // `  node dist/cli.js …` 这行用法示例 —— 把它当命令清单对账，
    // 得到的红是判据坏了，不是文本坏了。
    const usage = usageAll.slice(usageAll.indexOf('命令：'));
    const listed = new Set(
      [...usage.matchAll(/^ {2}([a-z][a-z-]*)/gm)].map((match) => match[1]!),
    );
    expect(listed.size).toBeGreaterThan(8);

    for (const command of cases) {
      expect(usage, `命令 ${command} 没有出现在帮助文本里`).toMatch(
        new RegExp(`^ {2}${command}\\b`, 'm'),
      );
    }
    for (const name of listed) {
      // `auth` 是唯一**不在主 switch 里**的命令：它自己解析参数、而且在 `--db`
      // 检查之前就分派（注册/登录根本不碰本地库）。豁免清单写成集合而不是 `if`，
      // 是为了让"又多一个例外"这件事必须在这里显式登记。
      if (name === 'auth') continue;
      expect(cases, `帮助文本列了 ${name}，却没有对应的 case`).toContain(name);
    }
    expect([...listed].filter((name) => name === 'auth')).toEqual(['auth']);
  });
});
