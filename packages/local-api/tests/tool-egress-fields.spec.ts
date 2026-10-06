/**
 * 工具"出境字段声明"与真实投影的对账
 * ======================================
 *
 * `LocalApiTool.egressFields` 是**给用户看的承诺**（ADR-0010 §3 的字段级披露）。
 * 承诺写在声明里，真实载荷却由另一处代码决定（`projectForTool` 的白名单、
 * `projectListForTool` 的再窄一层、`LocalApiProject` 的形状、`get_task` 的 `{error}` 信封），
 * 两者就一定会漂 —— 漂了还没有人报错：界面照常显示"我会送出这些字段"，实际多送了一个。
 *
 * 🔴🔴 所以这里断言的不是"字段名对不对"，而是**每一个真实会出去的键都必须被声明过**。
 * 判据是"实际跑一遍 `runReadTool`、收集载荷里出现的键"，不是"读代码列表" ——
 * 后者会跟着代码一起漂。
 *
 * 本文件不是纯新增的洁癖：`list_tasks` 那条（"正文不出现在列表里"）**就是它抓出来的**。
 * 宿主侧 `listTasks` 与 `getTask` 共用一个 `taskToItem`，所以只要任务有备注，
 * 正文就会跟着列表一起出去，而目录描述与声明都说不会 ——
 * 单步路径不看载荷形状、MCP 客户端也不会抱怨"多给了"，只有字段级复查会响。
 */

import { describe, expect, it } from 'vitest';

import {
  LOCAL_API_TOOLS,
  TOOL_ENVELOPE_EGRESS_FIELDS,
  findTool,
  runReadTool,
  type LocalApiEventItem,
  type LocalApiFocusSession,
  type LocalApiHabit,
  type LocalApiHabitLog,
  type LocalApiHost,
  type LocalApiItem,
  type LocalApiNote,
  type LocalApiNoteRow,
  type LocalApiProject,
  type LocalApiReminder,
  type LocalApiTag,
} from '../src/index.js';

import { TOOL_MINIMAL_ARGS } from './tool-minimal-args.js';

/** 每个字段都填满的样本：漏声明最容易发生在"这个字段平时是 undefined"的时候。 */
const ITEM: LocalApiItem = {
  id: 't1',
  title: '买牛奶',
  dueDate: '2026-10-03',
  priority: 'high',
  completed: false,
  body: '两盒',
  readable: true,
};
const PROTECTED_ITEM: LocalApiItem = { ...ITEM, id: 't2', title: '受保护的', body: '机密', readable: false };
const PROJECT: LocalApiProject = { id: 'p1', name: '工作', taskCount: 2 };
/** 每个字段都填满的习惯样本 —— 漏声明最容易发生在"平时是 undefined"的字段上。 */
const HABIT: LocalApiHabit = { id: 'h1', name: '喝水', target: 8, unit: '杯', goalType: 'atLeast' };
const TAG: LocalApiTag = { id: 'g1', name: '家里' };
const NOTE_ROW: LocalApiNoteRow = {
  id: 'n1',
  projectId: 'p1',
  isPinnedToToday: true,
  updatedAt: 1_700_000_000_000,
};
const NOTE: LocalApiNote = { ...NOTE_ROW, content: '买咖啡豆' };
const CHECKIN: LocalApiHabitLog = { habitId: 'h1', date: '2026-10-03', value: 8 };
const FOCUS: LocalApiFocusSession = {
  kind: 'work',
  taskId: 't1',
  plannedMs: 1_500_000,
  actualMs: 1_440_000,
  completed: true,
  startedAt: 1_700_000_000_000,
};
const REMINDER: LocalApiReminder = {
  id: 't1:1700000600000',
  taskId: 't1',
  triggerAt: 1_700_000_600_000,
  phase: 'scheduled',
};

/**
 * 假宿主：每条读路径都给**字段填满**的样本。
 *
 * 🔴 下面那条"遍历整份目录"的判据靠的就是这里 —— 样本里少一个键，
 * 那个键就"没人送出去过"，于是漏声明也不会响。所以新增实体的读工具时，
 * 这里的样本必须**每个可选字段都填上**。
 */
function host(
  items: readonly LocalApiItem[] = [ITEM, PROTECTED_ITEM],
  projects: readonly LocalApiProject[] = [PROJECT],
  habits: readonly LocalApiHabit[] = [HABIT],
): LocalApiHost {
  return {
    listTasks: async () => items,
    getTask: async (taskId: string) => items.find((x) => x.id === taskId),
    listProjects: async () => projects,
    listHabits: async () => habits,
    listTags: async () => [TAG],
    listNotes: async () => [NOTE_ROW],
    getNote: async (noteId: string) => (noteId === 'n1' ? NOTE : undefined),
    listHabitLogs: async () => [CHECKIN],
    listFocusSessions: async () => [FOCUS],
    listReminders: async () => [REMINDER],
    listEvents: () => Promise.resolve([] as readonly LocalApiEventItem[]),
    getEvent: () => Promise.resolve(undefined),
    submit: async () => ({ ok: true, taskId: 'created-1' }),
  };
}

/** 收集载荷里出现过的**所有**键（含数组元素与嵌套一层）。 */
function keysIn(value: unknown, depth = 0): Set<string> {
  const out = new Set<string>();
  if (depth > 3 || value === null || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    for (const x of value) {
      for (const k of keysIn(x, depth + 1)) out.add(k);
    }
    return out;
  }
  for (const [k, v] of Object.entries(value)) {
    out.add(k);
    for (const nested of keysIn(v, depth + 1)) out.add(nested);
  }
  return out;
}

/**
 * 某个工具声明的**键名**（去掉 `task.` / `project.` 这类分组前缀）。
 *
 * ⚠️ 前缀是有意的：披露给用户看的是"哪一类数据的哪个字段"，
 * 而载荷是扁平对象，所以比对时取最后一段。这里刻意写成 `.at(-1)` 而不是
 * 逐工具硬编码 —— 声明与键名之间只允许有一条换算规则。
 */
function declaredKeys(toolName: string): Set<string> {
  const tool = findTool(toolName);
  expect(tool, `目录里没有工具「${toolName}」`).toBeDefined();
  const fields = tool?.egressFields ?? [];
  expect(fields.length, `工具「${toolName}」没有声明 egressFields`).toBeGreaterThan(0);
  return new Set(fields.map((f) => f.split('.').at(-1) ?? f));
}

/** 信封字段（`tool.error` → `error`）任何工具都可能带出来，单独一份。 */
const envelopeKeys = new Set<string>(
  TOOL_ENVELOPE_EGRESS_FIELDS.map((f) => f.split('.').at(-1) ?? f),
);

describe('egressFields 声明 == 真实投影', () => {
  it('list_tasks：可读与受保护两种条目，实际出去的键都在声明里', async () => {
    const readable = await runReadTool(host([ITEM]), 'list_tasks', {});
    const protectedRun = await runReadTool(host([PROTECTED_ITEM]), 'list_tasks', {});
    expect(readable.ok).toBe(true);
    expect(protectedRun.ok).toBe(true);
    if (!readable.ok || !protectedRun.ok) return;

    const declared = declaredKeys('list_tasks');
    const actual = new Set([...keysIn(readable.payload), ...keysIn(protectedRun.payload)]);
    const outside = [...actual].filter((k) => !declared.has(k) && !envelopeKeys.has(k));
    expect(outside, `实际送出但没声明：${outside.join('、')}`).toEqual([]);
  });

  it('🔴 list_tasks 不返回正文 —— 目录描述与声明都这么承诺', async () => {
    // 宿主给列表带上了 `body`（真实宿主就是这么做的：与 `getTask` 共用投影函数），
    // 列表层必须把它剥掉。去掉 `projectListForTool` ⇒ 这条红。
    const run = await runReadTool(host([ITEM]), 'list_tasks', {});
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(JSON.stringify(run.payload)).not.toContain('两盒');
    expect(keysIn(run.payload).has('body')).toBe(false);
    // 但正文**没有丢失**：同一个条目用 `get_task` 取得到。
    const detail = await runReadTool(host([ITEM]), 'get_task', { taskId: 't1' });
    expect(detail.ok).toBe(true);
    if (!detail.ok) return;
    expect(JSON.stringify(detail.payload)).toContain('两盒');
  });

  it('get_task：命中的条目 + 没命中的 `{error}` 信封都在声明里', async () => {
    const found = await runReadTool(host([ITEM]), 'get_task', { taskId: 't1' });
    const missing = await runReadTool(host([ITEM]), 'get_task', { taskId: 'nope' });
    expect(found.ok).toBe(true);
    expect(missing.ok).toBe(true);
    if (!found.ok || !missing.ok) return;

    const declared = declaredKeys('get_task');
    const actual = new Set([...keysIn(found.payload), ...keysIn(missing.payload)]);
    const outside = [...actual].filter((k) => !declared.has(k) && !envelopeKeys.has(k));
    expect(outside, `实际送出但没声明：${outside.join('、')}`).toEqual([]);
    // 🔴 信封是**单独声明的一份**，不是塞进某个工具的字段表 —— 每个工具都可能带它，
    // 逐工具声明会变成六份抄件。
    expect(TOOL_ENVELOPE_EGRESS_FIELDS).toContain('tool.error');
  });

  it('list_projects：`LocalApiProject` 的每个键都被声明', async () => {
    const run = await runReadTool(host(), 'list_projects', {});
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    const declared = declaredKeys('list_projects');
    const outside = [...keysIn(run.payload)].filter((k) => !declared.has(k));
    expect(outside, `实际送出但没声明：${outside.join('、')}`).toEqual([]);
  });

  it('list_habits：`LocalApiHabit` 的每个键都被声明（新增实体的读同样过这道闸）', async () => {
    // 字段填满的那条样本是关键：`target` / `unit` / `goalType` 平时可能是 undefined，
    // 而"平时不出现"正是漏声明最容易溜过去的时刻（本文件开头那条理由）。
    const run = await runReadTool(host(), 'list_habits', {});
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    const declared = declaredKeys('list_habits');
    const outside = [...keysIn(run.payload)].filter((k) => !declared.has(k));
    expect(outside, `实际送出但没声明：${outside.join('、')}`).toEqual([]);
    // 反过来说：宿主多给一个没声明的键，这条判据真的会点出来（同一个探针，另一条腿）。
    const leaky: LocalApiHabit = { ...HABIT, streakDays: 12 } as unknown as LocalApiHabit;
    const leakyRun = await runReadTool(host([ITEM], [PROJECT], [leaky]), 'list_habits', {});
    expect(leakyRun.ok).toBe(true);
    if (!leakyRun.ok) return;
    expect([...keysIn(leakyRun.payload)].filter((k) => !declared.has(k))).toEqual(['streakDays']);
  });

  it('🔴 判据有牙齿：多一个没声明的键就会被点出来', async () => {
    // 模拟"以后有人往宿主返回的条目上挂了 `ownerPhone`"。
    // `get_task` 对可读条目是**原样返回**（`projectForTool`），所以这个键会真的出去 ——
    // 而声明里没有它 ⇒ 下游的字段级复查必须能点出来。这条断言就是这个"点出来"。
    const leaky = { ...ITEM, ownerPhone: '13900000000' } as unknown as LocalApiItem;
    const run = await runReadTool(host([leaky]), 'get_task', { taskId: 't1' });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    const declared = declaredKeys('get_task');
    expect([...keysIn(run.payload)].filter((k) => !declared.has(k))).toEqual(['ownerPhone']);

    // 列表那一侧走白名单重建，所以同一个键**根本出不去** ——
    // 两处的差别要在账上写清楚，否则下一个人会以为两边同一形状。
    const listRun = await runReadTool(host([leaky]), 'list_tasks', {});
    expect(listRun.ok).toBe(true);
    if (!listRun.ok) return;
    expect([...keysIn(listRun.payload)].filter((k) => !declaredKeys('list_tasks').has(k))).toEqual([]);
  });

  it('🔴 写工具不出境任何数据字段：`egressFields` 必须是空表（遍历整份目录）', () => {
    const writes = LOCAL_API_TOOLS.filter((t) => t.kind === 'write');
    expect(writes.length).toBeGreaterThanOrEqual(5);
    for (const tool of writes) {
      // 写工具只产出提案、结果不回送模型 ⇒ 它不贡献出境字段。
      // 这里刻意**不点名工具**：点名就是那份会漏抄的清单（本文件开头那条理由）。
      expect(tool.egressFields, `${tool.name} 的出境字段必须是空表`).toEqual([]);
    }
  });

  it('🔴 遍历整份目录：每一个读工具实际送出的键，都在它自己的声明里', async () => {
    // 这条取代了"逐个工具手写一条"的做法：手写的那批只能覆盖**写它的人想到的**那几个工具，
    // 新加一个读工具不会有任何一层提醒"这条判据还没铺到它"。
    // 现在目录本身就是取样清单 —— 加一个读工具，它立刻被这条扫到。
    const reads = LOCAL_API_TOOLS.filter((t) => t.kind === 'read');
    expect(reads.length).toBeGreaterThanOrEqual(6);

    const noSample: string[] = [];
    const undeclared: string[] = [];
    for (const tool of reads) {
      const args = TOOL_MINIMAL_ARGS[tool.name];
      if (args === undefined) {
        noSample.push(tool.name);
        continue;
      }
      const run = await runReadTool(host(), tool.name, args);
      if (!run.ok) {
        // 跑不通也算这条判据的失败：最小合法参数不该撞上工具自己的校验。
        noSample.push(`${tool.name}（跑不通：${run.message}）`);
        continue;
      }
      const declared = new Set(tool.egressFields.map((f) => f.split('.').at(-1) ?? f));
      for (const key of keysIn(run.payload)) {
        if (!declared.has(key) && !envelopeKeys.has(key)) undeclared.push(`${tool.name}.${key}`);
      }
    }
    expect(noSample.join('、'), '这些读工具没有参数样本或跑不通').toBe('');
    expect(undeclared.join('、'), '这些键实际会出去但没有声明').toBe('');
  });

  it('那条遍历判据自己有牙齿：宿主多给一个没声明的键，它真的点出来', async () => {
    // 阳性对照（同 `list_habits` 那条的两腿形状）：没有这一条，"遍历整份目录"
    // 完全可能因为样本恰好不含可选字段而变成一条永真的判据。
    const leakyTag = { ...TAG, ownerPhone: '13900000000' } as unknown as LocalApiTag;
    const leakyHost = { ...host(), listTags: async () => [leakyTag] };
    const run = await runReadTool(leakyHost, 'list_tags', {});
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    const declared = new Set((findTool('list_tags')?.egressFields ?? []).map((f) => f.split('.').at(-1) ?? f));
    expect([...keysIn(run.payload)].filter((k) => !declared.has(k))).toEqual(['ownerPhone']);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// W10：倒数日（`EVENT`）的同一笔账
//
// 🔴 这一段**必须手写**。`tool-egress-fields` 不是目录驱动的（它不知道目录里有谁），
// 所以"新加一个读工具"不会自动长出"它的声明 == 它的真实投影"这条判据 ——
// 工单 W10 把这件事点名成⚠️静默项，就是因为漏了它没有任何东西会红。
// ─────────────────────────────────────────────────────────────────────────

/** 每个字段都填满的倒数日样本：漏声明最容易发生在"这个字段平时是 undefined"的时候。 */
const EVENT_ITEM: LocalApiEventItem = {
  id: 'e1',
  title: '妈妈生日',
  date: '1968-04-12',
  kind: 'birthday',
  nextOccurrence: '2027-04-12',
  daysFromToday: 190,
  repeating: true,
  isLunar: false,
  pinned: true,
  notes: '记得订蛋糕',
  readable: true,
};
const PROTECTED_EVENT: LocalApiEventItem = {
  ...EVENT_ITEM,
  id: 'e2',
  title: '体检报告',
  notes: '身份证号 110101...',
  readable: false,
};

function eventHost(events: readonly LocalApiEventItem[]): LocalApiHost {
  // 🔴 其余成员给最小实现：本 describe 只驱动 EVENT 工具，但 `LocalApiHost`
  // 的成员是必填的 —— 假宿主少一个成员，"这个宿主没接"就退回编译期可见。
  return {
    listTasks: async () => [],
    getTask: async () => undefined,
    listProjects: async () => [],
    listHabits: async () => [],
    listTags: async () => [],
    listNotes: async () => [],
    getNote: async () => undefined,
    listHabitLogs: async () => [],
    listFocusSessions: async () => [],
    listReminders: async () => [],
    listEvents: async () => events,
    getEvent: async (eventId: string) => events.find((e) => e.id === eventId),
    submit: async () => ({ ok: true, taskId: 'created-1' }),
  };
}

describe('倒数日工具的 egressFields 声明 == 真实投影', () => {
  it('list_events：可读与受保护两种条目，实际出去的键都在声明里', async () => {
    const readable = await runReadTool(eventHost([EVENT_ITEM]), 'list_events', {});
    const protectedRun = await runReadTool(eventHost([PROTECTED_EVENT]), 'list_events', {});
    expect(readable.ok).toBe(true);
    expect(protectedRun.ok).toBe(true);
    if (!readable.ok || !protectedRun.ok) return;

    const declared = declaredKeys('list_events');
    const actual = new Set([...keysIn(readable.payload), ...keysIn(protectedRun.payload)]);
    const outside = [...actual].filter((k) => !declared.has(k) && !envelopeKeys.has(k));
    expect(outside, `实际送出但没声明：${outside.join('、')}`).toEqual([]);
  });

  it('🔴 list_events 不返回备注正文 —— 目录描述与声明都这么承诺', async () => {
    // 宿主给列表带上了 `notes`（真实宿主就是这么做的：与 `getEvent` 共用 `eventToItem`），
    // 列表层必须把它剥掉。**去掉 `projectEventListForTool` 里那一刀 ⇒ 这条红。**
    const run = await runReadTool(eventHost([EVENT_ITEM]), 'list_events', {});
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(JSON.stringify(run.payload)).not.toContain('记得订蛋糕');
    expect(keysIn(run.payload).has('notes')).toBe(false);
    // 但正文**没有丢失**：同一条用 get_event 取得到。
    const detail = await runReadTool(eventHost([EVENT_ITEM]), 'get_event', { eventId: 'e1' });
    expect(detail.ok).toBe(true);
    if (!detail.ok) return;
    expect(JSON.stringify(detail.payload)).toContain('记得订蛋糕');
  });

  it('get_event：命中的条目 + 没命中的 `{error}` 信封都在声明里', async () => {
    const found = await runReadTool(eventHost([EVENT_ITEM]), 'get_event', { eventId: 'e1' });
    const missing = await runReadTool(eventHost([EVENT_ITEM]), 'get_event', { eventId: 'nope' });
    expect(found.ok).toBe(true);
    expect(missing.ok).toBe(true);
    if (!found.ok || !missing.ok) return;
    const declared = declaredKeys('get_event');
    const actual = new Set([...keysIn(found.payload), ...keysIn(missing.payload)]);
    const outside = [...actual].filter((k) => !declared.has(k) && !envelopeKeys.has(k));
    expect(outside, `实际送出但没声明：${outside.join('、')}`).toEqual([]);
  });

  it('🔴 判据有牙齿：宿主多挂一个没声明的键，get_event 会点出来、list_events 剥得掉', async () => {
    const leaky = { ...EVENT_ITEM, ownerPhone: '13900000000' } as unknown as LocalApiEventItem;

    const detail = await runReadTool(eventHost([leaky]), 'get_event', { eventId: 'e1' });
    expect(detail.ok).toBe(true);
    if (detail.ok) {
      // `get_event` 对可读条目是**原样返回**，所以这个键真的会出去 ——
      // 而声明里没有它 ⇒ 助手那道"披露集合外就停"的复查必须能点出来。
      expect([...keysIn(detail.payload)].filter((k) => !declaredKeys('get_event').has(k))).toEqual([
        'ownerPhone',
      ]);
    }

    // 列表那一侧走白名单重建，所以同一个键**根本出不去**。
    const listRun = await runReadTool(eventHost([leaky]), 'list_events', {});
    expect(listRun.ok).toBe(true);
    if (listRun.ok) {
      const declared = declaredKeys('list_events');
      expect([...keysIn(listRun.payload)].filter((k) => !declared.has(k))).toEqual([]);
    }
  });

  it('受保护条目在两个视图里都是"存在但不给看"：readable=false 且没有 notes', async () => {
    const list = await runReadTool(eventHost([PROTECTED_EVENT]), 'list_events', {});
    expect(list.ok).toBe(true);
    if (list.ok) expect(JSON.stringify(list.payload)).not.toContain('110101');
    // 单条读**直接拒绝**，不返回一个"看起来没有备注"的结果
    const one = await runReadTool(eventHost([PROTECTED_EVENT]), 'get_event', { eventId: 'e2' });
    expect(one.ok).toBe(false);
  });
});
