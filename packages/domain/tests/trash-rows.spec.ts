/**
 * 回收站合并层的测试（跑在 node）
 * =================================
 *
 * W1 让回收站从一路数据源（任务）变成两路（任务 + 便签）。这一层测的不是
 * "渲染得对不对"，而是那几条**写错不会报错、只会静默不一致**的判断。
 *
 * 每条都对应一个具体的错法：
 *
 *   1. **合并顺序**：两路并起来不排序 = 谁先传谁在前。两端传参顺序不一样，
 *      于是"手机上任务在前、网页上便签在前"，而没有任何一层会报错。
 *   2. **同刻按 id 决胜**：`deletedAt` 来自毫秒时钟，一次连删两条经常同毫秒。
 *      少了这一段，同刻那两条的顺序就退化成枚举顺序（各端不同）。
 *      🔴 这条只在**两路都有数据**时才照得出来 —— 单路测试永远发现不了。
 *   3. **`deletedAt` 这条边界**：原来两端各自写 `deletedAt ?? updatedAt`，
 *      而"两端必须一致"只是 `TrashBoardLabels` 上的一句注释。现在它由
 *      `inTrash` 的类型谓词在门口保证 —— 没有删除时刻的记录不算回收站条目，
 *      于是界面拿不到 `undefined`（`formatStamp(undefined)` 会渲染出 `NaN-NaN`）。
 *   4. **整张原始表递进来也不许出现**（ADR-0048 的 I5）：活条目与
 *      已彻底删除的条目都不能出现在回收站里。
 *   5. **便签标题走 `noteExcerpt`**：宿主自己 `slice` 会在行中间切断，
 *      而且两端的长度可以各写一个数字。
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  NOTE_EXCERPT_LENGTH,
  liveTaskCountOfProject,
  noteExcerpt,
  toTrashItems,
  type Habit,
  type Note,
  type Project,
  type Task,
} from '../src/index.js';

const T0 = 1_700_000_000_000;

function task(id: string, over: Partial<Task> = {}): Task {
  return { id, title: `任务 ${id}`, createdAt: T0, updatedAt: T0, ...over };
}

function note(id: string, content: string, over: Partial<Note> = {}): Note {
  return {
    id,
    content,
    createdAt: T0,
    updatedAt: T0,
    isPinnedToToday: false,
    ...over,
  };
}

/** 一条"在回收站里"的任务。 */
const trashedTask = (id: string, deletedAt: number): Task =>
  task(id, { deletedAt, updatedAt: deletedAt });
/** 一条"在回收站里"的便签。 */
const trashedNote = (id: string, deletedAt: number, content = '便签正文'): Note =>
  note(id, content, { deletedAt, updatedAt: deletedAt });

describe('合并顺序：最近删除的在前', () => {
  it('🔴 两路混在一起仍然按 deletedAt 降序，而不是按传参顺序', () => {
    const items = toTrashItems({
      tasks: [trashedTask('task-old', T0 - 3000), trashedTask('task-new', T0 - 1000)],
      notes: [trashedNote('note-mid', T0 - 2000)],
    });
    expect(items.map((i) => i.id)).toEqual(['task-new', 'note-mid', 'task-old']);
  });

  it('🔴 交换传参顺序，结果逐字节相同（顺序不来自宿主怎么传）', () => {
    const a = toTrashItems({
      tasks: [trashedTask('task-a', T0 - 1000)],
      notes: [trashedNote('note-b', T0 - 2000)],
    });
    const b = toTrashItems({
      notes: [trashedNote('note-b', T0 - 2000)],
      tasks: [trashedTask('task-a', T0 - 1000)],
    });
    expect(a.map((i) => i.id)).toEqual(b.map((i) => i.id));
  });

  it('🔴 同刻删除的一条任务与一条便签按 id 字典序决胜（缺了它两端会换位置）', () => {
    const same = T0 - 500;
    const forward = toTrashItems({
      tasks: [trashedTask('zz-task', same)],
      notes: [trashedNote('aa-note', same)],
    });
    const backward = toTrashItems({
      notes: [trashedNote('aa-note', same)],
      tasks: [trashedTask('zz-task', same)],
    });
    expect(forward.map((i) => i.id)).toEqual(['aa-note', 'zz-task']);
    expect(backward.map((i) => i.id)).toEqual(['aa-note', 'zz-task']);
  });
});

describe('行的内容', () => {
  it('kind 标的是实体，不是猜的', () => {
    const items = toTrashItems({
      tasks: [trashedTask('t1', T0)],
      notes: [trashedNote('n1', T0)],
    });
    expect(items.map((i) => i.kind).sort()).toEqual(['NOTE', 'TASK']);
  });

  it('任务标题原样（用户自己的字不翻译、不截断）', () => {
    const long = '这是一条很长很长长得会超出任何固定截断长度的任务标题';
    const [row] = toTrashItems({ tasks: [task('t1', { title: long, deletedAt: T0 })] });
    expect(row?.title).toBe(long);
  });

  it('🔴 便签标题与领域层的 noteExcerpt 逐项相等（取首段非空行 + 超长带 …）', () => {
    const multi = note('n1', '\n\n第一段\n第二段', { deletedAt: T0 });
    const long = note(
      'n2',
      'x'.repeat(NOTE_EXCERPT_LENGTH + 20),
      { deletedAt: T0 },
    );
    const items = toTrashItems({ notes: [multi, long] });
    const byId = new Map(items.map((i) => [i.id, i]));
    expect(byId.get('n1')?.title).toBe(noteExcerpt(multi, NOTE_EXCERPT_LENGTH));
    expect(byId.get('n1')?.title).toBe('第一段');
    expect(byId.get('n2')?.title).toBe(noteExcerpt(long, NOTE_EXCERPT_LENGTH));
    expect(byId.get('n2')?.title.endsWith('…')).toBe(true);
  });

  it('🔴 没有 `deletedAt` 的记录进不了这一层（谓词挡在门口，不靠下游兜底）', () => {
    // 原来这里写的是 `deletedAt ?? updatedAt`，而"两端必须一致"只靠注释维持。
    // 现在 `inTrash` 是**类型谓词**：一条没有删除时刻的记录根本不算回收站条目，
    // 于是 `deletedAt: number` 在编译期成立，界面拿不到 `undefined`
    //（`formatStamp(undefined)` 会渲染出 `NaN-NaN` —— 那种"看着像日期"的字符串
    //  比缺一小段信息更坏，所以这条边界要钉住而不是留个兜底假装安全）。
    expect(toTrashItems({ tasks: [task('t-no-stamp')], notes: [note('n-alive', '活着')] })).toEqual(
      [],
    );

    const [row] = toTrashItems({ tasks: [trashedTask('t-ok', T0 - 7)] });
    expect(row?.deletedAt).toBe(T0 - 7);
  });
});

describe('🔴 I5：把原始物化表整张递进来也不许出现', () => {
  /** 一份"原始表"：活的、回收站里的、已彻底删除的混在一起（宿主没滤）。 */
  const rawTasks = [
    task('task-alive'),
    trashedTask('task-trashed', T0 - 100),
    task('task-purged', { deletedAt: T0 - 200, purgedAt: T0 - 50 }),
  ];
  const rawNotes = [
    note('note-alive', '活着'),
    trashedNote('note-trashed', T0 - 100),
    note('note-purged', '彻底删了', { deletedAt: T0 - 200, purgedAt: T0 - 50 }),
  ];

  it('活着的与已彻底删除的一条都不出现（两类实体各一条）', () => {
    const ids = toTrashItems({ tasks: rawTasks, notes: rawNotes }).map((i) => i.id);
    expect(ids).toEqual(['note-trashed', 'task-trashed']);
  });

  it('正向对照：同一次调用里"该出现的那两条"确实出现了（0 命中不等于滤干净了）', () => {
    const ids = toTrashItems({ tasks: rawTasks, notes: rawNotes }).map((i) => i.id);
    expect(ids).toContain('task-trashed');
    expect(ids).toContain('note-trashed');
  });

  it('只递 tasks 或只递 notes 都能用（一路为缺省不是错误）', () => {
    expect(toTrashItems({ tasks: rawTasks }).map((i) => i.id)).toEqual(['task-trashed']);
    expect(toTrashItems({ notes: rawNotes }).map((i) => i.id)).toEqual(['note-trashed']);
    expect(toTrashItems()).toEqual([]);
  });

  it('不改动传进来的任何一份（返回的是新数组）', () => {
    const tasks = [trashedTask('t1', T0 - 1), trashedTask('t2', T0 - 2)];
    const before = tasks.map((t) => t.id).join();
    const out = toTrashItems({ tasks });
    expect(out.map((i) => i.id)).toEqual(['t1', 't2']);
    expect(tasks.map((t) => t.id).join()).toBe(before);
    expect(out).not.toBe(tasks);
  });
});

// ── W4：清单与习惯进回收站之后，这一层多了两路与一个新函数 ─────────────
function project(id: string, name: string, over: Partial<Project> = {}): Project {
  return { id, name, createdAt: T0, updatedAt: T0, ...over };
}

function habit(id: string, name: string, over: Partial<Habit> = {}): Habit {
  return { id, name, createdAt: T0, updatedAt: T0, ...over };
}

describe('W4 四路合并：清单与习惯也是回收站里的一行', () => {
  it('🔴 四路混排仍按 deletedAt 降序，且种类标对', () => {
    const items = toTrashItems({
      tasks: [trashedTask('task-1', T0 - 4000)],
      notes: [trashedNote('note-1', T0 - 2000)],
      projects: [project('p-1', '深度工作', { deletedAt: T0 - 1000 })],
      habits: [habit('h-1', '喝水', { deletedAt: T0 - 3000 })],
    });

    expect(items.map((i) => [i.id, i.kind])).toEqual([
      ['p-1', 'PROJECT'],
      ['note-1', 'NOTE'],
      ['h-1', 'HABIT'],
      ['task-1', 'TASK'],
    ]);
  });

  it('🔴 清单/习惯这一行的标题是它们的**名字**，不是正文摘要、也不是 id', () => {
    // 表现成 id 的症状是回收站里一排 `project-1f9c…`，用户认不出哪条是哪条；
    // 而"两端各挑一个字段"正是这类漂移的来源。
    const items = toTrashItems({
      projects: [project('p-1', '搬家清单', { deletedAt: T0 - 1 })],
      habits: [habit('h-1', '早睡', { deletedAt: T0 - 2 })],
    });
    expect(items.map((i) => i.title)).toEqual(['搬家清单', '早睡']);
  });

  it('I5：活着的与已彻底删除的清单/习惯都不许出现（整张原始表递进来也一样）', () => {
    const items = toTrashItems({
      projects: [
        project('p-alive', '还在用'),
        project('p-trashed', '在回收站', { deletedAt: T0 - 10 }),
        project('p-purged', '已彻底删除', { deletedAt: T0 - 20, purgedAt: T0 - 5 }),
      ],
      habits: [
        habit('h-alive', '还在练'),
        habit('h-trashed', '在回收站', { deletedAt: T0 - 1 }),
        habit('h-purged', '已彻底删除', { deletedAt: T0 - 30, purgedAt: T0 - 6 }),
      ],
    });
    // 新删除的在前：`h-trashed` 的 deletedAt 是 T0-1，比 `p-trashed` 的 T0-10 晚。
    expect(items.map((i) => i.id)).toEqual(['h-trashed', 'p-trashed']);
  });

  it('没有 deletedAt 的记录进不了这一层（类型上就被挡，不留兜底分支）', () => {
    expect(toTrashItems({ projects: [project('p-1', '没删过')] })).toEqual([]);
    expect(toTrashItems({ habits: [habit('h-1', '没删过')] })).toEqual([]);
  });
});

describe('liveTaskCountOfProject（确认框那句「里面还有 N 条任务」）', () => {
  it('🔴 数的是**活着的**任务：已删除与已彻底删除的都不算', () => {
    // 用 `!inTrash()` 数会把已彻底删除的那两条算进来 —— 于是确认框在对
    // 两条已经不存在（在用户眼里）的任务做承诺。`isLive` 与 `!inTrash` 的
    // 差别正好落在这一条上。
    const tasks: Task[] = [
      task('t-1', { projectId: 'p-1' }),
      task('t-2', { projectId: 'p-1', deletedAt: T0 - 1 }),
      task('t-3', { projectId: 'p-1', deletedAt: T0 - 2, purgedAt: T0 - 3 }),
    ];
    expect(liveTaskCountOfProject(tasks, 'p-1')).toBe(1);
  });

  it('已完成的任务**要**算（这句说的是"不会被删掉的东西有几条"）', () => {
    const tasks: Task[] = [
      task('t-done', { projectId: 'p-1', completedAt: T0 }),
      task('t-open', { projectId: 'p-1' }),
    ];
    expect(liveTaskCountOfProject(tasks, 'p-1')).toBe(2);
  });

  it('别的清单与无清单的任务不算进来；不存在的清单是 0（不是 undefined）', () => {
    const tasks: Task[] = [task('t-1', { projectId: 'p-1' }), task('t-2', { projectId: 'p-2' }), task('t-3')];
    expect(liveTaskCountOfProject(tasks, 'p-1')).toBe(1);
    expect(liveTaskCountOfProject(tasks, 'p-9')).toBe(0);
  });
});

/**
 * 🔴 W6-a 的那道**常驻**判据：三个宿主用同一份合并。
 *
 * 为什么要有这一段（而不是相信注释里那句"两端不要自己写"）：
 * `apps/node-host` 的 CLI 就是那个"再抄一遍"的实例 —— 它抄的是**只有任务**的一路，
 * 于是"另一台设备的回收站里有没有这条清单"在那台设备上**根本读不出来**，
 * 而没有任何一层会红（§7 第 50 条那一族：状态对、显示形态也对，缺的是覆盖面）。
 *
 * 两个方向都钉：
 *   · **存在性**：三个宿主的回收站入口都真的调 `toTrashItems(`；
 *   · **不该存在的形状**：谁都不许再自己写删除时间回退、回收站排序、便签截断长度。
 * 形状判据按**调用**匹配（带接收者的 `xxx.sort(` / 比较式），不匹配同名注释。
 */
describe('三宿主同源（源码级）', () => {
  const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../..');

  /** 回收站那一屏/那一命令在三宿主里的落点。 */
  const HOSTS = [
    'apps/web/src/features/trash/TrashView.tsx',
    'apps/mobile/src/screens/TrashScreen.tsx',
    'apps/node-host/src/host.ts',
  ] as const;

  /**
   * 只剥**整行注释**（空行开头是 `//`、`*`、`/*` 的那些）。
   *
   * 为什么必须剥：这三条形状在**注释里是被讨论过的**（"原来两端各写一句
   * `deletedAt ?? updatedAt`"就是其中一句）。不剥的话这条判据会因为有人
   * **解释**了那个错法而变红 —— 那会把"写注释"变成一件有惩罚的事。
   * 只剥整行而不是所有 `//`：URL、字符串里的双斜杠会跟着被吃掉，那会造出
   * 假阴性（真违规看不见），比假阳性更贵。
   */
  const codeOnly = (src: string): string =>
    src
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join('\n');

  for (const file of HOSTS) {
    it(`${file} 的回收站行来自共享的那一份合并`, () => {
      const src = readFileSync(join(REPO, file), 'utf8');
      expect(src, `${file} 没有调 toTrashItems(`).toContain('toTrashItems(');
    });

    it(`${file} 不再自己写回收站的三条判断`, () => {
      const src = codeOnly(readFileSync(join(REPO, file), 'utf8'));
      // (1) 删除时间回退 —— 曾经两端各写一句，注释说"必须一致"却从没一致过
      expect(src, `${file} 还有 deletedAt ?? updatedAt 回退`).not.toMatch(/deletedAt\s*\?\?\s*updatedAt/);
      // (2) 回收站排序 —— `byDeletedOrder` 是唯一比较器
      expect(src, `${file} 自己按 deletedAt 排序`).not.toMatch(/b\.deletedAt\s*-\s*a\.deletedAt/);
      // (3) 便签截断长度 —— 数字只许是 domain 的那个常量
      expect(src, `${file} 自己给 noteExcerpt 传了长度数字`).not.toMatch(/noteExcerpt\([^)]*,\s*\d+\s*\)/);
    });
  }
});
