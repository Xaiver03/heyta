/**
 * 滴答清单（TickTick / dida365）导入 —— 逻辑层判据
 * ===================================================
 *
 * 这个文件钉住四件事，每一条都做过**故障注入**（改一处实现 → 看到红 → 改回）：
 *
 *   1. **枚举映射只有一份**（`ticktick-format.ts`）。改那里的优先级表，
 *      这里的用例就会红 —— 证明"单点定义"不是一句注释。
 *   2. **数据守恒**：`dataRows === tasks + skipped.length`。
 *      任何"不认识的形状就 continue"都会打破它。
 *   3. **不静默丢数据**：滴答有、heyta 没有归宿的字段（提醒 / 开始时间 /
 *      子任务父子关系 / 看板分组 / 归档状态）必须**带原值**出现在报告里。
 *   4. **幂等**：同一份文件解析两次得到逐字节相同的计划，合并第二次 `added` 全 0；
 *      且**行序变化不影响带 `taskId` 的任务身份**。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ 夹具里"表头之前的元数据行"的内容是**编的**（真实备份前几行长什么样本轮
 * 没有拿到样本）。这里钉的判据是 **"表头不在第一行也能被找到"**，不是元数据的
 * 具体格式 —— 后者的核实程度见 `ticktick-format.ts` 文件头的表。
 * 表头列名与枚举取值则是三份独立实现交叉核实过的（同见该表）。
 * ─────────────────────────────────────────────────────────────────────────
 */

import { describe, expect, it } from 'vitest';

import { Priority } from '../src/entities.js';
import {
  TICKTICK_COLUMNS,
  TICKTICK_CHECKLIST_MARKERS,
  TICKTICK_PRIORITY_MAP,
  mapTickTickPriority,
  parseTickTickContent,
} from '../src/ticktick-format.js';
import {
  TICKTICK_IMPORT_ID_NAMESPACE,
  emptyTickTickPlan,
  mergeTickTickPlans,
  parseTickTickCsv,
  parseTickTickTags,
  stableTickTickId,
  type TickTickImportPlan,
} from '../src/ticktick-import.js';

/** 固定导入时刻：domain 不许读时钟，所有「现在」都由调用方注入。 */
const NOW = new Date(2026, 0, 1, 12, 0, 0).getTime();

/**
 * 表头列名 = 滴答备份的 24 列（三份独立实现交叉核实，见 `ticktick-format.ts`）。
 * 顺序按核实到的列名全集排列。
 */
const HEADER: readonly string[] = [
  'Folder Name',
  'List Name',
  'Title',
  'Kind',
  'Tags',
  'Content',
  'Is Check list',
  'Start Date',
  'Due Date',
  'Reminder',
  'Repeat',
  'Priority',
  'Status',
  'Created Time',
  'Completed Time',
  'Order',
  'Timezone',
  'Is All Day',
  'Is Floating',
  'Column Name',
  'Column Order',
  'View Mode',
  'taskId',
  'parentId',
];

/** 一行的内容，按列名给值（缺的列填空）。 */
type RowSpec = Partial<Record<string, string>>;

/** 最小 CSV 序列化：含 `,` / `"` / 换行的字段加引号，`"` 翻倍。 */
function cell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function toCsv(rows: readonly RowSpec[]): string {
  const lines = [HEADER.map(cell).join(',')];
  for (const row of rows) {
    lines.push(HEADER.map((column) => cell(row[column] ?? '')).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

/**
 * 夹具行。
 *
 * 逐行说明它负责哪条判据：
 *   - row1 收集箱任务：优先级 5、两个标签、日期型截止、有 taskId。
 *   - row2 文件夹 + 清单下的 checklist 任务：备注、重复规则、提醒、
 *     开始时间、看板分组全都有值 —— 后四者 heyta 没有归宿，必须进报告。
 *   - row3 与 row2 **同 taskId 同清单** → 整行跳过（`duplicate-source-id`）。
 *   - row4 空标题 → 整行跳过（`empty-title`）。
 *   - row5 没有 taskId、`parentId` 指向 row2、浮动时间、不认识的优先级/状态/重复。
 *   - row6 日期型 + 时区 + `Status=2`。
 */
const ROWS: readonly RowSpec[] = [
  {
    Title: 'Inbox quick task',
    Tags: 'Work, urgent',
    'Due Date': '2026-03-02',
    'Is All Day': 'Y',
    Priority: '5',
    Status: '0',
    'Created Time': '2026-01-02T03:04:05+0000',
    taskId: 't-inbox',
  },
  {
    'Folder Name': 'Work',
    'List Name': 'Projects',
    Title: 'Ship CSV importer',
    Kind: 'CHECKLIST',
    Tags: 'Work',
    Content: `${TICKTICK_CHECKLIST_MARKERS.unchecked} write parser${TICKTICK_CHECKLIST_MARKERS.checked} ship it`,
    'Is Check list': 'Y',
    'Start Date': '2026-03-01T08:00:00+0800',
    'Due Date': '2026-03-02T09:30:00+0800',
    Reminder: 'TRIGGER:-PT30M',
    Repeat: 'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE',
    Priority: '3',
    Status: '1',
    'Created Time': '2026-01-05T00:00:00+0000',
    'Completed Time': '2026-01-06T00:00:00+0000',
    Order: '0',
    Timezone: 'Asia/Shanghai',
    'Is All Day': 'N',
    'Column Name': 'In progress',
    'Column Order': '1',
    'View Mode': 'kanban',
    taskId: 't-ship',
  },
  {
    'Folder Name': 'Work',
    'List Name': 'Projects',
    Title: 'Ship CSV importer (duplicate row)',
    Status: '0',
    taskId: 't-ship',
  },
  {
    'Folder Name': 'Work',
    'List Name': 'Projects',
    Title: '   ',
    taskId: 't-empty-title',
  },
  {
    'List Name': 'Personal',
    Title: 'Legacy oddity',
    Tags: 'Reading',
    Repeat: 'Every other day after completion',
    Priority: '2',
    Status: '9',
    'Is Floating': 'Y',
    parentId: 't-ship',
  },
  {
    'List Name': 'Personal',
    Title: 'Archived thing',
    'Due Date': '2026-04-05',
    'Is All Day': 'Y',
    Timezone: 'Europe/Berlin',
    Priority: '0',
    Status: '2',
    taskId: 't-arch',
  },
  {
    // 🔴 专钉 `Status` 映射本身：这一行**没有** Completed Time，
    // 完成的唯一信号就是 `Status=1`。不加这行，`Status` 表被改坏也测不出来
    // （row2 有 Completed Time，两条路径谁都能把任务标成完成）。
    'List Name': 'Personal',
    Title: 'Status-only completion',
    Priority: '0',
    Status: '1',
    taskId: 't-status1',
  },
];

/** 表头之前放两行元数据 —— 钉「表头不在第一行也能找到」。 */
const METADATA_PREFIX = ['heyta fixture metadata row 1,,', 'fixture row 2,,'] as const;

const FIXTURE = `${METADATA_PREFIX.join('\r\n')}\r\n${toCsv(ROWS)}`;

function parseFixture(): Extract<ReturnType<typeof parseTickTickCsv>, { ok: true }> {
  const result = parseTickTickCsv(FIXTURE, { now: NOW });
  if (!result.ok) throw new Error(`夹具应当解析成功，实际失败：${result.reason}`);
  return result;
}

function findByTitle(plan: TickTickImportPlan, title: string) {
  const draft = plan.tasks.find((task) => task.title === title);
  if (draft === undefined) throw new Error(`计划里没有标题为「${title}」的任务`);
  return draft;
}

// ═════════════════════════════════════════════════════════════
// 1. 解析与映射
// ═════════════════════════════════════════════════════════════

describe('parseTickTickCsv：基本映射', () => {
  it('表头在元数据行之后仍能被找到', () => {
    expect(parseFixture().report.dataRows).toBe(ROWS.length);
  });

  it('文件夹 → 顶层清单，清单 → 它的子清单（heyta 只支持一层）', () => {
    const { plan } = parseFixture();
    const folder = plan.projects.find((project) => project.name === 'Work');
    const list = plan.projects.find((project) => project.name === 'Projects');
    const personal = plan.projects.find((project) => project.name === 'Personal');

    expect(folder).toBeDefined();
    expect(folder?.parentId).toBeUndefined();
    expect(list?.parentId).toBe(folder?.id);
    expect(personal?.parentId).toBeUndefined();
  });

  it('🔴 优先级离散表：5→High / 3→Medium / 1→Low / 0→无', () => {
    expect(mapTickTickPriority('5')).toMatchObject({ priority: Priority.High, exact: true });
    expect(mapTickTickPriority('3')).toMatchObject({ priority: Priority.Medium, exact: true });
    expect(mapTickTickPriority('1')).toMatchObject({ priority: Priority.Low, exact: true });
    expect(mapTickTickPriority('0')).toMatchObject({ priority: undefined, exact: true });

    // 判据落在**实际导入的计划**上，而不只是映射函数上。
    const { plan } = parseFixture();
    expect(findByTitle(plan, 'Inbox quick task').priority).toBe(Priority.High);
    expect(findByTitle(plan, 'Ship CSV importer').priority).toBe(Priority.Medium);
    expect(findByTitle(plan, 'Archived thing').priority).toBeUndefined();
  });

  it('标签按逗号/分号/顿号切分，剥前导 #，去重保序', () => {
    expect(parseTickTickTags('Work, urgent')).toEqual(['Work', 'urgent']);
    expect(parseTickTickTags('  #deep  ，deep;work ')).toEqual(['deep', 'work']);

    const { plan } = parseFixture();
    const inbox = findByTitle(plan, 'Inbox quick task');
    expect(inbox.tagIds).toHaveLength(2);
    const names = plan.tags.map((tag) => tag.name).sort();
    expect(names).toEqual(['Reading', 'Work', 'urgent']);
  });

  it('🔴 checklist 标记 ▫/▪ 转成 markdown 复选框，一项都不丢', () => {
    const parsed = parseTickTickContent('前言▫ write parser▪ ship it');
    expect(parsed.hadMarkers).toBe(true);
    expect(parsed.items).toEqual([
      { title: 'write parser', completed: false },
      { title: 'ship it', completed: true },
    ]);
    expect(parsed.note).toBe('前言\n- [ ] write parser\n- [x] ship it');

    const { plan } = parseFixture();
    expect(findByTitle(plan, 'Ship CSV importer').note).toBe('- [ ] write parser\n- [x] ship it');
  });

  it('重复规则剥掉 RRULE: 前缀，变成 heyta 的 repeatRule；并记下锚点', () => {
    const { plan } = parseFixture();
    const recurring = findByTitle(plan, 'Ship CSV importer');
    expect(recurring.repeatRule).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE');
    // 截止是时刻型（+0800），锚点取它的**本地日历日**。
    expect(recurring.repeatDtstart).toBe('2026-03-02');

    // 非重复任务没有这个字段（不是空串）。
    expect(findByTitle(plan, 'Inbox quick task').repeatRule).toBeUndefined();
  });

  it('日期型截止放在本地零点（不是 UTC 零点）', () => {
    const { plan } = parseFixture();
    expect(findByTitle(plan, 'Inbox quick task').dueDate).toBe(new Date(2026, 2, 2, 0, 0, 0).getTime());
  });

  it('时刻型截止保留精确时刻（与宿主时区无关）', () => {
    const { plan } = parseFixture();
    expect(findByTitle(plan, 'Ship CSV importer').dueDate).toBe(
      Date.parse('2026-03-02T09:30:00+08:00'),
    );
  });

  it('Status=1 与 Status=2 都算已完成，Completed Time 直接采用', () => {
    const { plan } = parseFixture();
    expect(findByTitle(plan, 'Ship CSV importer').completedAt).toBe(
      Date.parse('2026-01-06T00:00:00Z'),
    );
    const archived = findByTitle(plan, 'Archived thing');
    expect(archived.completedAt).toBe(archived.updatedAt);

    // 完成的唯一信号就是 Status=1（没有 Completed Time）—— 这一条钉的是
    // 状态表本身，而不是"Completed Time 优先"那条路径。
    const statusOnly = findByTitle(plan, 'Status-only completion');
    expect(statusOnly.completedAt).toBe(statusOnly.updatedAt);

    expect(findByTitle(plan, 'Inbox quick task').completedAt).toBeUndefined();
  });

  it('缺少 Created Time 时用调用方注入的 now（domain 不读时钟）', () => {
    const { plan } = parseFixture();
    expect(findByTitle(plan, 'Legacy oddity').createdAt).toBe(NOW);
  });
});

// ═════════════════════════════════════════════════════════════
// 2. 🔴 不静默丢数据 —— 守恒律
// ═════════════════════════════════════════════════════════════

describe('不静默丢数据', () => {
  it('🔴 守恒律：每个数据行要么产出任务，要么出现在 skipped 里', () => {
    const { plan, report } = parseFixture();
    expect(report.dataRows).toBe(ROWS.length);
    expect(report.tasks).toBe(plan.tasks.length);
    expect(report.tasks + report.skipped.length).toBe(report.dataRows);
  });

  it('空标题与重复 taskId 这两类整行跳过，各带原因', () => {
    const { report } = parseFixture();
    expect(report.skipped.map((entry) => entry.reason).sort()).toEqual([
      'duplicate-source-id',
      'empty-title',
    ]);
    expect(report.skippedCounts['empty-title']).toBe(1);
    expect(report.skippedCounts['duplicate-source-id']).toBe(1);
    // 跳过的那两行仍能按行号找回，不是"消失了"。
    const emptyTitle = report.skipped.find((entry) => entry.reason === 'empty-title');
    expect(emptyTitle?.rowIndex).toBe(4);
    const duplicate = report.skipped.find((entry) => entry.reason === 'duplicate-source-id');
    expect(duplicate?.rowIndex).toBe(3);
    expect(duplicate?.detail).toBe('t-ship');
  });

  it('🔴 没有归宿的字段全部带原值进报告', () => {
    const { report } = parseFixture();
    const byField = new Map(report.unmapped.map((entry) => [entry.field, entry]));

    // row2：提醒 / 开始时间 / 看板分组
    expect(byField.get('reminder')?.value).toBe('TRIGGER:-PT30M');
    expect(byField.get('reminder')?.rowIndex).toBe(2);
    expect(byField.get('startDate')?.value).toBe('2026-03-01T08:00:00+0800');
    expect(byField.get('columnName')?.value).toBe('In progress');
    expect(byField.get('columnOrder')?.value).toBe('1');
    expect(byField.get('viewMode')?.value).toBe('kanban');

    // row5：子任务父子关系 / 浮动时间 / 不认识的枚举
    expect(byField.get('parentId')?.value).toBe('t-ship');
    expect(byField.get('isFloating')?.value).toBe('Y');
    expect(byField.get('priority')?.value).toBe('2');
    expect(byField.get('status')?.value).toBe('9');
    expect(byField.get('repeat')?.value).toBe('Every other day after completion');
    expect(byField.get('missingSourceId')?.rowIndex).toBe(5);

    // row6：归档状态与日期型任务的时区
    expect(byField.get('archiveStatus')?.value).toBe('2');
    expect(byField.get('timezone')?.value).toBe('Europe/Berlin');

    // 计数与逐条记录一致 —— 不许"记了一条、计数为零"。
    for (const [field, count] of Object.entries(report.unmappedCounts)) {
      expect(report.unmapped.filter((entry) => entry.field === field)).toHaveLength(count as number);
    }
  });

  it('🔴 子任务被拍平但**不丢**：它成为一条独立任务，父子关系进报告', () => {
    const { plan, report } = parseFixture();
    const child = findByTitle(plan, 'Legacy oddity');
    expect(child.projectId).toBeDefined();
    expect(report.unmapped.some((entry) => entry.field === 'parentId' && entry.title === 'Legacy oddity')).toBe(
      true,
    );
    // heyta 的 Task 还没有 parentId —— 计划里不许偷偷塞一个不存在的字段。
    expect(child).not.toHaveProperty('parentId');
  });

  it('不认识的优先级/状态保守回落，且一定被报告', () => {
    const { plan, report } = parseFixture();
    const odd = findByTitle(plan, 'Legacy oddity');
    // 状态 9 不 pretend completed。
    expect(odd.completedAt).toBeUndefined();
    // 优先级 2 用了阈值近似 → 记 Low 并报告。
    expect(odd.priority).toBe(Priority.Low);
    expect(report.unmappedCounts['priority']).toBe(1);
    expect(report.unmappedCounts['status']).toBe(1);
  });
});

// ═════════════════════════════════════════════════════════════
// 3. 🔴 幂等
// ═════════════════════════════════════════════════════════════

describe('幂等：稳定 id', () => {
  it('同一份文件解析两次得到逐字节相同的计划', () => {
    const first = parseTickTickCsv(FIXTURE, { now: NOW });
    const second = parseTickTickCsv(FIXTURE, { now: NOW });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(JSON.stringify(second.plan)).toBe(JSON.stringify(first.plan));
  });

  it('不同 now 不会改变 id（id 只由文件内容派生）', () => {
    const a = parseTickTickCsv(FIXTURE, { now: NOW });
    const b = parseTickTickCsv(FIXTURE, { now: NOW + 999_999 });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(b.plan.tasks.map((task) => task.id)).toEqual(a.plan.tasks.map((task) => task.id));
  });

  it('🔴 导两次不重复：合并同一份计划，第二次 added 全 0', () => {
    const { plan } = parseFixture();
    const first = mergeTickTickPlans(emptyTickTickPlan(), plan);
    expect(first.added.tasks).toBe(plan.tasks.length);
    expect(first.skipped.tasks).toBe(0);

    const second = mergeTickTickPlans(first.plan, plan);
    expect(second.added).toEqual({ projects: 0, tags: 0, tasks: 0 });
    expect(second.skipped.tasks).toBe(plan.tasks.length);
    expect(second.plan.tasks).toHaveLength(first.plan.tasks.length);
    expect(second.plan.projects).toHaveLength(first.plan.projects.length);
    expect(second.plan.tags).toHaveLength(first.plan.tags.length);
  });

  it('🔴 带 taskId 的任务身份与行序无关（行序变了仍是同一批 id）', () => {
    const reversed = parseTickTickCsv(
      `${METADATA_PREFIX.join('\r\n')}\r\n${toCsv([...ROWS].reverse())}`,
      { now: NOW },
    );
    expect(reversed.ok).toBe(true);
    if (!reversed.ok) return;
    const original = parseFixture().plan;
    // 只对**有 taskId** 的任务成立：它们的 sourceKey 不含行号。
    const withId = (plan: TickTickImportPlan): string[] =>
      plan.tasks
        .filter((task) => !task.sourceKey.includes('row-'))
        .map((task) => task.id)
        .sort();
    expect(withId(reversed.plan)).toEqual(withId(original));
    expect(withId(original)).toHaveLength(4);
  });

  it('⚠️ 没有 taskId 的行身份依赖行序 —— 这是已知弱点，所以必须被报告', () => {
    const reversed = parseTickTickCsv(
      `${METADATA_PREFIX.join('\r\n')}\r\n${toCsv([...ROWS].reverse())}`,
      { now: NOW },
    );
    expect(reversed.ok).toBe(true);
    if (!reversed.ok) return;
    const original = parseFixture();
    const fallbackId = (plan: TickTickImportPlan): string | undefined =>
      plan.tasks.find((task) => task.sourceKey.includes('row-'))?.id;

    // 行序变了 → 回落 id 变了。这不是 bug，是"源文件没给稳定 id"的代价；
    // 代价被 `missingSourceId` 报告出去，用户能在导入前看到。
    expect(fallbackId(reversed.plan)).not.toBe(fallbackId(original.plan));
    expect(original.report.unmappedCounts['missingSourceId']).toBe(1);
  });

  it('id 由 (namespace, kind, sourceKey) 三者共同决定', () => {
    const base = stableTickTickId(TICKTICK_IMPORT_ID_NAMESPACE, 'task', 'k');
    expect(stableTickTickId(TICKTICK_IMPORT_ID_NAMESPACE, 'task', 'k')).toBe(base);
    // kind 由 id 前缀区分，namespace 与 sourceKey 由哈希区分。三条都必须成立，
    // 否则不同实体（或两次不同来源）会撞成一个 id。
    expect(stableTickTickId(TICKTICK_IMPORT_ID_NAMESPACE, 'project', 'k')).not.toBe(base);
    expect(stableTickTickId(TICKTICK_IMPORT_ID_NAMESPACE, 'task', 'k2')).not.toBe(base);
    expect(stableTickTickId('other:namespace', 'task', 'k')).not.toBe(base);
    expect(stableTickTickId('other:namespace', 'task', 'k')).toMatch(/^tt1-task-[0-9a-f]{16}$/);
    // id 是合法且稳定的字符串，不含随机/时间成分。
    expect(base).toMatch(/^tt1-task-[0-9a-f]{16}$/);
    expect(stableTickTickId(TICKTICK_IMPORT_ID_NAMESPACE, 'task', 'k')).toBe(base);
  });

  it('🔴 两份不同文件不会撞 id（哈希不是常量）', () => {
    const other = parseTickTickCsv(
      `${METADATA_PREFIX.join('\r\n')}\r\n${toCsv([{ Title: 'Another task', taskId: 'other-1' }])}`,
      { now: NOW },
    );
    expect(other.ok).toBe(true);
    if (!other.ok) return;
    const ids = new Set(parseFixture().plan.tasks.map((task) => task.id));
    for (const task of other.plan.tasks) expect(ids.has(task.id)).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════
// 4. 失败形态
// ═════════════════════════════════════════════════════════════

describe('失败形态是结构化的', () => {
  it('没有表头 → no-header（不许把元数据行当列名，产出假的 0 条成功）', () => {
    const result = parseTickTickCsv('not,a,backup\r\n1,2,3\r\n', { now: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('no-header');
    expect(result.report.tasks).toBe(0);
    expect(result.report.skipped).toHaveLength(0);
  });

  it('有表头但一条任务都没有 → no-tasks，且那行仍在 skipped 里', () => {
    const text = toCsv([{ 'Folder Name': 'Work', 'List Name': 'Projects', Title: '' }]);
    const result = parseTickTickCsv(text, { now: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('no-tasks');
    expect(result.report.dataRows).toBe(1);
    expect(result.report.skipped).toEqual([
      { reason: 'empty-title', rowIndex: 1, title: '', detail: 'Projects' },
    ]);
  });

  it('未闭合引号不抛错，按已读到的内容降级解析', () => {
    const text = `Title,List Name\r\n"Broken,Projects`;
    const result = parseTickTickCsv(text, { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 降级语义：未闭合引号之后的全部内容当**同一个字段**（引号里的逗号是数据）。
    // 这是 best-effort，不是"猜出用户本意"——所以下面那条报告判据更重要。
    expect(result.plan.tasks[0]?.title).toBe('Broken,Projects');
    // 没有 taskId → 身份回落，必须被报告。
    expect(result.report.unmappedCounts['missingSourceId']).toBe(1);
  });

  it('列名大小写与空白不敏感（真实备份里 taskId 是驼峰、Is Check list 有空格）', () => {
    const text = 'title, list name ,TASKID\r\nCase test,Personal,T-1';
    const result = parseTickTickCsv(text, { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.tasks[0]?.title).toBe('Case test');
    expect(result.plan.tasks[0]?.sourceKey).toBe('folder:/list:personal:T-1');
  });
});

// ═════════════════════════════════════════════════════════════
// 5. 映射表的单点性（改 ticktick-format.ts 就会红）
// ═════════════════════════════════════════════════════════════

describe('枚举映射是单点定义', () => {
  it('优先级表恰好是核实到的 0/1/3/5 四个取值', () => {
    expect(Object.keys(TICKTICK_PRIORITY_MAP).sort()).toEqual(['0', '1', '3', '5']);
  });

  it('列名词表覆盖所有会被读取的列，且与夹具表头逐字一致', () => {
    for (const column of Object.values(TICKTICK_COLUMNS)) {
      expect(HEADER).toContain(column);
    }
  });
});
