/**
 * 桌面端「按有效标签筛」的**合并别名**判据
 * ===========================================
 *
 * 读点只有一处：`apps/desktop/renderer/main.tsx` 的 `rows` useMemo 里那一发
 * `filterTasks(tasks, filter, { now, tags: … })`。
 *
 * 🔴 缺口长什么样：标签合并只写标签那一行（`{deletedAt, mergedInto}`），**不重写任务的
 * `tagIds`**（见 `packages/domain/src/tags.ts` 文件头）。所以"这条任务有哪些标签"
 * 只有 `resolveTagIds` 能回答 —— 不传 `tags` 时那一支退回"按 id 精确匹配"，
 * **按 B 筛不到只挂着 A 的任务**，不报错。
 *
 * 🔴 这一端还有**第二层**坑，这条 spec 的主要目的就是把它钉死：
 * 渲染进程能拿到的标签数据必须**含墓碑那一行**。`listTags()` 是 `aliveOf` 的存活投影
 * —— 合并把 A 写成墓碑，它已经不在里面。拿它当解析表 ⇒ `resolveTagId(A, 存活表)`
 * 返回 `undefined` ⇒ 任务的**有效标签变成空数组**：既筛不到 B，chip 也变空。
 * 于是 IPC 契约里**新增**了一条 `listTagAliasTable`（全量表），
 * `listTags` 的语义一个字没改（纯增量）。
 *
 * ## 为什么这里不渲染 React 组件
 *
 * `apps/desktop/vitest.config.ts` 明确跑在 node 环境（"不用 jsdom"），渲染进程的行为
 * 在这里测不了。所以这条 spec 测的是**渲染进程拿到的东西 + 它对它们做的那一件事**：
 *
 *   · 数据面：真实 SQLite 文件上开 `openDesktopHost`，经 `handleDesktopRequest`
 *     （= `main.ts` 用的同一条 IPC 白名单）读回任务与两张标签表；
 *   · 判据：与 `main.tsx` 逐字相同的那一发 `filterTasks(…, { now, tags })`。
 *
 * 接线本身（`main.tsx` 里到底递了哪张表）由第 3 段的源码断言钉住 —— 去掉那一行
 * 或者换成 `listTags` 都会红（读数见交付说明里的"注掉/换表前后"）。
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { filterTasks, indexTags, resolveTags, type Tag, type Task } from '@heyta/domain';
import type { NodeHost } from '@heyta/node-host';
import { afterEach, describe, expect, it } from 'vitest';

import { openDesktopHost } from '../src/host.js';
import { handleDesktopRequest } from '../src/ipc-contract.js';

type DispatchIntent = Parameters<NodeHost['dispatch']>[0];

const HERE = dirname(fileURLToPath(import.meta.url));
const RENDERER = resolve(HERE, '../renderer/main.tsx');

const tempDirs: string[] = [];
const opened: NodeHost[] = [];

afterEach(() => {
  for (const host of opened.splice(0)) host.close();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempUserDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'heyta-desktop-tags-'));
  tempDirs.push(dir);
  return dir;
}

/** 真实 SQLite 文件上的宿主（与 `main.ts` 同一个 `openDesktopHost`）。 */
async function openHost(): Promise<NodeHost> {
  const host = await openDesktopHost({ userDataDir: tempUserDataDir() });
  opened.push(host);
  return host;
}

/**
 * 夹具：把 A 合并进 B，任务只挂着 A。
 *
 * ⚠️ 载荷逐字来自 `@heyta/app-host` 的 `tag-actions.ts`（合并 = **一条** TAG op，
 * `{ deletedAt, mergedInto }`）。壳里没有第二个合并实现，所以这里必须手写这一发 ——
 * `NodeHost` 只透出 `dispatch`，没有 `mergeTags`（同 `reminder-delivery.spec.ts` 的处境）。
 * 夹具写错了不会假绿：合并没物化 ⇒ 下面的别名表里就没有 `mergedInto`，第一条断言就红。
 */
async function seedMergedTag(host: NodeHost): Promise<{ taskId: string }> {
  await host.dispatch({
    entityType: 'TAG',
    entityId: 'tag-a',
    opType: 'CRT' as DispatchIntent['opType'],
    payload: { name: '旧标签' },
  });
  await host.dispatch({
    entityType: 'TAG',
    entityId: 'tag-b',
    opType: 'CRT' as DispatchIntent['opType'],
    payload: { name: '新标签' },
  });
  const taskId = await host.addTask('只挂旧标签的任务');
  await host.dispatch({
    entityType: 'TASK',
    entityId: taskId,
    opType: 'UPD' as DispatchIntent['opType'],
    payload: { tagIds: ['tag-a'] },
  });
  // A → B：**只动标签这一行**，任务的 `tagIds` 保持 `['tag-a']`（设计，不是漏改）。
  await host.dispatch({
    entityType: 'TAG',
    entityId: 'tag-a',
    opType: 'UPD' as DispatchIntent['opType'],
    payload: { deletedAt: Date.now(), mergedInto: 'tag-b' },
  });
  return { taskId };
}

async function readTags(host: NodeHost): Promise<{
  tasks: Task[];
  aliasRows: Tag[];
  aliveRows: Tag[];
}> {
  const tasks = (await handleDesktopRequest(host, { method: 'listTasks' })) as Task[];
  const aliasRows = (await handleDesktopRequest(host, {
    method: 'listTagAliasTable',
  })) as Tag[];
  const aliveRows = (await handleDesktopRequest(host, { method: 'listTags' })) as Tag[];
  return { tasks, aliasRows, aliveRows };
}

describe('数据面：别名表含墓碑，存活表仍只回存活（纯增量）', () => {
  it('`listTagAliasTable` 里有被合并掉的那一行（带 `mergedInto`），`listTags` 里没有', async () => {
    const host = await openHost();
    const { taskId } = await seedMergedTag(host);
    const { tasks, aliasRows, aliveRows } = await readTags(host);

    // 原始数据不变：任务上的旧 id 还在（这是"一次合并 = 一条 op"的前提）。
    expect(tasks.map((task) => task.id)).toEqual([taskId]);
    expect(tasks[0]?.tagIds).toEqual(['tag-a']);

    // 别名表 = 全量：两条都在，A 指 B。
    expect(aliasRows.map((row) => row.id).sort()).toEqual(['tag-a', 'tag-b']);
    expect(aliasRows.find((row) => row.id === 'tag-a')?.mergedInto).toBe('tag-b');
    expect(aliasRows.find((row) => row.id === 'tag-a')?.deletedAt).toBeTypeOf('number');

    // 🔴 `listTags` 的语义一个字没改：仍然只回存活的那一条。
    expect(aliveRows.map((row) => row.id)).toEqual(['tag-b']);
  });
});

describe('按 B 筛：桌面端读数的三种情形（判据③）', () => {
  it('🔴 用别名表 ⇒ 命中 1 条；换回存活表 ⇒ 0 条；不传 ⇒ 0 条', async () => {
    const host = await openHost();
    await seedMergedTag(host);
    const { tasks, aliasRows, aliveRows } = await readTags(host);
    const now = Date.now();

    // ① 别名表（`main.tsx` 现在走的这条）：A-only 的任务回到 B 名下。
    const withAlias = filterTasks(tasks, { kind: 'tag', tagId: 'tag-b' }, {
      now,
      tags: indexTags(aliasRows),
    });
    expect(withAlias.map((task) => task.title)).toEqual(['只挂旧标签的任务']);
    expect(withAlias).toHaveLength(1);

    // ② 换回存活表：读数是 0 —— 这就是"接了线却空转"，也是本 spec 要挡的退路。
    const withAliveOnly = filterTasks(tasks, { kind: 'tag', tagId: 'tag-b' }, {
      now,
      tags: indexTags(aliveRows),
    });
    expect(withAliveOnly).toHaveLength(0);

    // ③ 不传 tags = 未接线时的旧语义，读数同样是 0（判据④的回归锚点）。
    expect(filterTasks(tasks, { kind: 'tag', tagId: 'tag-b' }, { now })).toHaveLength(0);
  });

  it('别的筛选档不受影响（`all` / `today` 的读数没变）', async () => {
    const host = await openHost();
    await seedMergedTag(host);
    const { tasks, aliasRows } = await readTags(host);
    const now = Date.now();

    expect(filterTasks(tasks, { kind: 'all' }, { now, tags: indexTags(aliasRows) })).toHaveLength(1);
    // 没有截止时间 ⇒ 不进"今天"，传不传 `tags` 都一样（改的只是标签那一支）。
    expect(filterTasks(tasks, { kind: 'today' }, { now, tags: indexTags(aliasRows) })).toHaveLength(0);
    expect(filterTasks(tasks, { kind: 'today' }, { now })).toHaveLength(0);
  });
});

describe('chip 显示的是 B 的名字，不是空、也不是 A 的旧名字', () => {
  it('`resolveTags([A], 别名表)` ⇒ 「新标签」；存活表 ⇒ 空', async () => {
    const host = await openHost();
    await seedMergedTag(host);
    const { tasks, aliasRows, aliveRows } = await readTags(host);
    const tagIds = tasks[0]?.tagIds ?? [];

    expect(resolveTags(tagIds, indexTags(aliasRows)).map((tag) => tag.name)).toEqual(['新标签']);
    // 对照：存活表解析成空 —— 界面上那枚 chip 会**整枚消失**（不是显示旧名字）。
    expect(resolveTags(tagIds, indexTags(aliveRows))).toEqual([]);
  });
});

describe('接线：渲染进程递进去的必须是全量表', () => {
  const source = readFileSync(RENDERER, 'utf8').replace(/\s+/g, ' ');

  it('`filterTasks` 带上了 `tags: tagTable`', () => {
    expect(
      source,
      'renderer/main.tsx 的标签筛选没把解析表递进去（`tags: …`）—— 合并后按 B 筛不到只挂 A 的任务。',
    ).toContain('filterTasks(tasks, filter, { now: Date.now(), tags: tagTable })');
  });

  it('取数走 `listTagAliasTable`（含墓碑），**不是** `listTags`（存活投影）', () => {
    expect(
      source,
      '渲染进程必须读全量标签表：存活投影里没有被合并掉的那一行，传了等于没传。',
    ).toContain("request({ method: 'listTagAliasTable' })");
    // 反面对照：解析表的来源不许是 `listTags`。
    expect(source).not.toContain('setTagTable(indexTags((await window.heytaDesktop.request({ method: \'listTags\' })) as Tag[]))');
  });
});
