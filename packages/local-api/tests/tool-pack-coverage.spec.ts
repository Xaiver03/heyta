/**
 * 目录 ↔ pack 的注册完整性
 * ==========================
 *
 * 加一个工具现在只改一个文件（`src/tools/<entity>.ts`）。省下来的那四处落点
 * 以前各自都会"漏了也不报错"，本文件就是补上的那只牙：
 *
 * 🔴 **遍历整份目录，逐个用最小合法参数驱动一遍，断言没有任何一个工具
 *    得到 `tool-not-implemented`。**
 *
 * 为什么这条判据不是摆设：目录**就是从 pack 生成的**，所以"条目登记了、
 * 分支没写"这件事在编译期没有任何一层会发现（`runRead` 的返回类型允许
 * `undefined`，而那正是"不是我的"的编码）。唯一的观测点就是这里。
 *
 * ⚠️ 断言写成**"每个工具都必须有参数样本"**而不是"我们认识的那六个"：
 * 往目录里加一个新工具而没给它准备最小合法参数 ⇒ 本文件立刻红，
 * 而不是安静地少覆盖一个工具（覆盖面悄悄缩水比红更糟）。
 */

import { describe, expect, it } from 'vitest';

import {
  LOCAL_API_TOOLS,
  LOCAL_API_TOOL_PACKS,
  buildToolPackRegistry,
  runReadTool,
  toWriteIntent,
  type LocalApiHost,
  type LocalApiItem,
  type LocalApiProject,
  type LocalApiWriteIntent,
  type LocalApiWriteResult,
} from '../src/index.js';

const ITEM: LocalApiItem = {
  id: 't1',
  title: '买牛奶',
  dueDate: '2026-10-03',
  priority: 'high',
  completed: false,
  body: '两盒',
  readable: true,
};
const PROJECT: LocalApiProject = { id: 'p1', name: '工作', taskCount: 1 };

/** 真的实现了 `LocalApiHost` 四个成员的假宿主（少了成员就编译不过 —— 那是故意的）。 */
function host(): LocalApiHost {
  const items: readonly LocalApiItem[] = [ITEM];
  const projects: readonly LocalApiProject[] = [PROJECT];
  return {
    listTasks: () => Promise.resolve(items),
    getTask: (taskId: string) => Promise.resolve(items.find((x) => x.id === taskId)),
    listProjects: () => Promise.resolve(projects),
    submit: (): Promise<LocalApiWriteResult> => Promise.resolve({ ok: true, taskId: 'created-1' }),
  };
}

/**
 * 每个工具的**最小合法参数**：参数齐全到能走完 pack 的分支，
 * 但又小到"多一个键就是在测别的用例"。
 */
const MINIMAL_ARGS: Readonly<Record<string, Record<string, unknown>>> = {
  list_tasks: {},
  get_task: { taskId: 't1' },
  list_projects: {},
  create_task: { title: '买咖啡豆' },
  update_task: { taskId: 't1', fields: { title: '新标题' } },
  complete_task: { taskId: 't1' },
};

/** 注册不齐的两种编码：读侧是 `kind`，写侧只有消息文本（`ToolWriteIntentOutcome` 没有 kind）。 */
function notImplemented(outcome: { ok: false; message: string; kind?: string }): boolean {
  return outcome.kind === 'tool-not-implemented' || outcome.message.includes('注册不齐');
}

describe('目录里每个工具都必须真的能被处理', () => {
  it('每个工具都备好了最小合法参数（新加工具没加参数样本 ⇒ 这条先红）', () => {
    const missing = LOCAL_API_TOOLS.filter((t) => MINIMAL_ARGS[t.name] === undefined).map((t) => t.name);
    expect(missing, `这些工具没有参数样本，本文件的判据覆盖不到它们：${missing.join('、')}`).toEqual([]);
  });

  it('🔴 读工具逐个真跑一遍：没有一个得到 tool-not-implemented，而且都读到了东西', async () => {
    const reads = LOCAL_API_TOOLS.filter((t) => t.kind === 'read');
    expect(reads.length).toBeGreaterThan(0);

    for (const tool of reads) {
      const outcome = await runReadTool(host(), tool.name, MINIMAL_ARGS[tool.name] ?? {});
      if (!outcome.ok) {
        expect(
          notImplemented(outcome),
          `读工具「${tool.name}」注册不齐（目录里有它但没有 pack 处理它）`,
        ).toBe(false);
      }
      // 走到这里还 `ok: false` 的只可能是参数不成立 —— 那同样是注册不齐的征兆：
      // 参数样本是给**这个工具**的，不该撞上它自己的校验。
      expect(outcome.ok, `读工具「${tool.name}」应当跑通：${JSON.stringify(outcome)}`).toBe(true);
    }
  });

  it('🔴 写工具逐个真跑一遍：没有一个得到 tool-not-implemented，而且都产出了意图', () => {
    const writes = LOCAL_API_TOOLS.filter((t) => t.kind === 'write');
    expect(writes.length).toBeGreaterThan(0);

    for (const tool of writes) {
      const outcome = toWriteIntent(tool.name, MINIMAL_ARGS[tool.name] ?? {});
      if (!outcome.ok) {
        expect(
          outcome.message.includes('注册不齐'),
          `写工具「${tool.name}」注册不齐（目录里有它但没有 pack 产出意图）`,
        ).toBe(false);
      }
      expect(outcome.ok, `写工具「${tool.name}」应当产出意图：${JSON.stringify(outcome)}`).toBe(true);
      if (outcome.ok) {
        expect((outcome.intent as LocalApiWriteIntent).action).toBeTruthy();
      }
    }
  });

  it('未知工具名仍然报"不是只读工具"，不是 tool-not-implemented（两件事不许混）', async () => {
    const outcome = await runReadTool(host(), 'delete_everything', {});
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.kind).toBe('not-a-read-tool');
    expect(notImplemented(outcome)).toBe(false);

    // 目录里存在的**写**工具被当成读工具调用，同样是"不是只读工具"：
    // 未授权与不存在、读与写，给出的错误必须不可区分（否则能枚举目录）。
    const asRead = await runReadTool(host(), 'create_task', { title: 'x' });
    expect(!asRead.ok && asRead.kind === 'not-a-read-tool').toBe(true);
  });
});

describe('目录顺序是**不变量**（不是聚合的巧合）', () => {
  const ORDER = ['list_tasks', 'get_task', 'list_projects', 'create_task', 'update_task', 'complete_task'];

  it('既有的六个工具保持既有的相对顺序（新工具只能追加，不能插到它们中间）', () => {
    const names = LOCAL_API_TOOLS.map((t) => t.name);
    let cursor = 0;
    for (const name of ORDER) {
      const at = names.indexOf(name, cursor);
      expect(at, `目录顺序变了：${names.join('、')} —— 期望 ${ORDER.join('、')} 按序出现`).toBeGreaterThan(-1);
      cursor = at + 1;
    }
  });

  it('🔴 所有读工具排在所有写工具之前（`tools/list` 与 AI 的 tools 数组顺序就靠这条）', () => {
    const kinds = LOCAL_API_TOOLS.map((t) => t.kind);
    const firstWrite = kinds.indexOf('write');
    const lastRead = kinds.lastIndexOf('read');
    expect(lastRead).toBeLessThan(firstWrite === -1 ? kinds.length : firstWrite);
  });
});

describe('pack 接缝自己的契约', () => {
  it('每个 pack 对**不是自己的**工具名都返回 undefined（不是"失败"）', async () => {
    for (const pack of LOCAL_API_TOOL_PACKS) {
      const read = await pack.runRead(host(), 'not_a_real_tool', {});
      expect(read, `${pack.entityType} 的 runRead 应当对陌生名字交回 undefined`).toBeUndefined();
      expect(
        pack.toIntent('not_a_real_tool', {}),
        `${pack.entityType} 的 toIntent 应当对陌生名字交回 undefined`,
      ).toBeUndefined();
    }
  });

  it('每个 pack 的 schema 键都必须是它自己声明的工具（registry 会拒绝孤儿）', () => {
    for (const pack of LOCAL_API_TOOL_PACKS) {
      const owned = new Set(pack.tools.map((t) => t.name));
      const orphans = Object.keys(pack.schemas).filter((k) => !owned.has(k));
      expect(orphans, `${pack.entityType} 登记了不属于它的 schema：${orphans.join('、')}`).toEqual([]);
    }
  });

  it('🔴 registry 会**拒绝**两个 pack 认领同一个工具名（否则又开始第二份声明）', () => {
    const base = LOCAL_API_TOOL_PACKS[0];
    expect(base).toBeDefined();
    const stolen = { ...base!, entityType: 'NOTE' };
    expect(() => buildToolPackRegistry([base!, stolen])).toThrow(/两个 pack 认领/);
  });

  it('🔴 registry 会**拒绝**给不属于自己、甚至不在目录里的工具登记 schema', () => {
    const base = LOCAL_API_TOOL_PACKS[0];
    const stranger = { ...base!, schemas: { ...base!.schemas, made_up: { type: 'object' as const, properties: {}, additionalProperties: false as const } } };
    expect(() => buildToolPackRegistry([stranger])).toThrow(/登记了参数 schema/);
  });
});
