/**
 * 移动端排序档位的接线测试
 * ============================
 *
 * 🔴 这里防的**不是"某一档排错了"**（那在 `packages/domain/tests/task-order.spec.ts`
 * 与 `packages/ui/tests/task-list-model.spec.ts` 里，各有自己的用例）。
 * 这四件事都**不会报错，只会画错**，而且只会在手机端画错：
 *
 *   1. **词表漂移**：移动端自己列一遍选项或自己起一套名字 ⇒ 两端对同一档
 *      说两种话，各自的测试还都是绿的。
 *   2. **行为漂移**：这一刀把屏幕里手写的 `groups.x.reverse()` 删掉了。
 *      如果默认档不等价于原来的语义，新建的任务会重新掉到屏幕外 ——
 *      那是移动端**实测过**的代价（旧注释原话：用户唯一的反馈是角标从 9 变成 10）。
 *   3. **接线断掉**：`TasksScreen` 忘了把档位传给共享 `TaskList`。
 *      Web 端就是这么中招的（漏加在真正渲染的那个调用点上），所以这一条
 *      钉成**源码判据**，不是一句注释。
 *   4. **偏好落错了地方**：写进 op-log 会让另一台设备被同步改掉自己的选择；
 *      写进 `META_KEYS` 会让"哪些键是同步协议的一部分"失去边界。
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TASK_SORT_KEYS, sortTasks, type Task, type TaskSortKey } from '@heyta/domain';
import { translate } from '@heyta/i18n';

/**
 * 假的设备本地偏好库。
 *
 * 为什么必须换掉：`prefs/device-prefs` 的**真**实现要 op-sqlite，node 里没有，
 * 于是它永远走"库不可用 ⇒ 读不到 / 写不进"那条分支（那条分支自己由
 * `auth-flow.spec.ts` 钉着）。本层要测的是**档位的读写与校验**，
 * 换一张 Map 才能测到"写进去的值下次读得出来"。
 *
 * `vi.hoisted` 不是仪式感：`vi.mock` 会被提到 import 之前执行，
 * 直接引用顶层变量会得到 "Cannot access before initialization"。
 */
const prefsStore = vi.hoisted(() => ({
  values: new Map<string, string>(),
  writable: true,
}));

vi.mock('../src/prefs/device-prefs', () => ({
  readDevicePref: (key: string) => prefsStore.values.get(key),
  writeDevicePref: (key: string, value: string) => {
    if (!prefsStore.writable) return false;
    prefsStore.values.set(key, value);
    return true;
  },
}));

import {
  DEFAULT_TASK_SORT,
  PREF_KEY_TASK_SORT,
  SORT_LABEL_KEYS,
  TASK_SORT_OPTIONS,
  readTaskSort,
  taskSortChipLabel,
  taskSortName,
  writeTaskSort,
} from '../src/lib/task-sort';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../src');

/** 走真的词条表：缺 key 会**抛**，不会静给空串。 */
const zh = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>): string =>
  translate('zh-CN', key, vars);
const en = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>): string =>
  translate('en', key, vars);

/** 造任务。默认无截止、未完成 —— 每条用例只覆盖它关心的字段。 */
function mkTask(id: string, overrides: Partial<Task> = {}): Task {
  return { id, title: id, createdAt: 0, updatedAt: 0, ...overrides };
}

const ids = (tasks: readonly Task[]): string[] => tasks.map((t) => t.id);

/**
 * ⚠️ 源码判据必须**剥掉注释按行匹配**。
 * `realtime-wiring.spec.ts` 记着同族教训：第一版用 `[\s\S]*?` 跨行匹配，
 * 把注释掉的那行也算成了调用 —— 注释掉之后判据照样绿。
 * 一条能被注释骗过去的判据等于没有判据。
 */
function codeLines(file: string): string[] {
  return readFileSync(resolve(SRC, file), 'utf8')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .filter((line) => !/^\s*\*/.test(line) && !/^\s*\/\*/.test(line));
}

beforeEach(() => {
  prefsStore.values.clear();
  prefsStore.writable = true;
});

afterEach(() => {
  prefsStore.values.clear();
  prefsStore.writable = true;
});

describe('档位词表：只有一份，且两端同义', () => {
  it('🔴 选项清单就是领域的 `TASK_SORT_KEYS`，没有第二份', () => {
    // 断言的是**同一个数组引用**，不是"内容相等"。内容相等允许这里悄悄抄一份，
    // 而抄的那一份正是漂移的起点（加一档只加在一处时，界面上少一个选项、不报错）。
    expect(TASK_SORT_OPTIONS).toBe(TASK_SORT_KEYS);
  });

  it('每一档在中英两表里都真有词条', () => {
    // 穷尽性本来由 `Record<TaskSortKey, MessageKey>` 在编译期保证；
    // 这里跑的是**真词条表**，所以"键存在但没填值"也会被抓到（translate 缺键直接抛）。
    for (const key of TASK_SORT_KEYS) {
      expect(taskSortName(zh, key).length).toBeGreaterThan(0);
      expect(taskSortName(en, key).length).toBeGreaterThan(0);
    }
  });

  it('三档的说法两两不同 —— 同一语言里不许有两个选项长一样', () => {
    // 写成同一个词不会有任何报错，而面板看起来会像"只有一个选项"。
    const zhNames = TASK_SORT_KEYS.map((k) => taskSortName(zh, k));
    const enNames = TASK_SORT_KEYS.map((k) => taskSortName(en, k));
    expect(new Set(zhNames).size).toBe(TASK_SORT_KEYS.length);
    expect(new Set(enNames).size).toBe(TASK_SORT_KEYS.length);
  });

  it('chip 上是「排序：<当前档>」—— 不是光一个"排序"', () => {
    // 2026-09-30 那条「日期|倒计时」裸 chip 被退回的理由：用户看不出那是什么。
    // 所以这颗 chip 必须把**当前选中的档位**写在脸上。
    expect(taskSortChipLabel(zh, 'priority')).toBe('排序：按优先级');
    expect(taskSortChipLabel(en, 'priority')).toBe('Sort: Priority');
    expect(taskSortChipLabel(zh, DEFAULT_TASK_SORT)).toContain(taskSortName(zh, DEFAULT_TASK_SORT));
  });
});

describe('默认档的等价性：换实现不许顺带改行为', () => {
  /** 领域给的规范顺序：`createdAt` 升序（跨端一致，不能动）。 */
  const canonical = [
    mkTask('first', { createdAt: 1 }),
    mkTask('second', { createdAt: 2 }),
    mkTask('third', { createdAt: 3 }),
  ];

  it('🔴 默认档排出来的顺序 == 旧 `reverse()` 的结果', () => {
    expect(ids(sortTasks(canonical, DEFAULT_TASK_SORT))).toEqual(ids([...canonical].reverse()));
  });

  it('🔴 记下来为什么默认档不是 `display`：无截止的一整组会全部并列', () => {
    // 收集箱里每条都没有截止时间，`display` 的比较结果全是 0 ⇒ 稳定排序原样保留
    // ⇒ 新任务落在**最底部**。这正是移动端当年加 `reverse()` 的理由。
    // 这条断言不是给实现看的，是给"以后想统一两端默认档"的人看的。
    expect(ids(sortTasks(canonical, 'display'))).toEqual(['first', 'second', 'third']);
  });

  it('已完成在任何档位下都沉底（包括移动端的默认档）', () => {
    const input = [
      mkTask('done', { createdAt: 9, completedAt: 1 }),
      mkTask('open', { createdAt: 1 }),
    ];
    for (const key of TASK_SORT_KEYS) {
      expect(ids(sortTasks(input, key)), `${key} 档`).toEqual(['open', 'done']);
    }
  });
});

describe('设备本地档位：读写、校验、降级', () => {
  it('没存过就是默认档', () => {
    expect(prefsStore.values.size).toBe(0);
    expect(readTaskSort()).toBe(DEFAULT_TASK_SORT);
  });

  it('写进去的值下次读得出来，而且存的就是档名本身', () => {
    expect(writeTaskSort('priority')).toBe(true);
    expect(readTaskSort()).toBe('priority');
    // ⚠️ 钉的是**线上格式**：存成 `JSON.stringify` 的 `"priority"` 也照样能跑，
    // 但另一个设备本地键（`welcome.hasSeen` 存的 `'1'`）就没法一起人工核对。
    expect(prefsStore.values.get(PREF_KEY_TASK_SORT)).toBe('priority');
  });

  it('🔴 偏好键名是持久化的契约，不许顺手改', () => {
    // 改名不会报错，只会让每台已选过档位的设备安静地回到默认档。
    expect(PREF_KEY_TASK_SORT).toBe('task.sort');
  });

  it('🔴 非法档名不写库并返回 false —— 写进去会让选择静默失效', () => {
    // 若这里照写不误，库里留下一个读回来认不出的值，下次冷启动回默认档，
    // 而用户看到的是"我明明选了按优先级" —— 最难复现的一类坏法。
    expect(writeTaskSort('按标题' as TaskSortKey)).toBe(false);
    expect(prefsStore.values.has(PREF_KEY_TASK_SORT)).toBe(false);
    expect(readTaskSort()).toBe(DEFAULT_TASK_SORT);
  });

  it('库里是坏值时读回默认档，不抛', () => {
    prefsStore.values.set(PREF_KEY_TASK_SORT, 'title');
    expect(readTaskSort()).toBe(DEFAULT_TASK_SORT);
  });

  it('🔴 库写不进（原生模块不在）时不抛，界面仍拿到一个可用档位', () => {
    // `device-prefs` 的契约是**永不抛**：它的调用点在启动路径上。
    // 这一条钉的是排序层没有偷偷加回"写失败就报错"的第二种行为。
    prefsStore.writable = false;
    expect(writeTaskSort('display')).toBe(false);
    expect(readTaskSort()).toBe(DEFAULT_TASK_SORT);
  });
});

describe('宿主接线（源码判据）', () => {
  const lines = codeLines('screens/TasksScreen.tsx');

  it('🔴 屏幕里不许再有自己排顺序的 `reverse()`', () => {
    // 那会是第四份比较规则。留着它 = "共享层排一遍、屏幕再倒一遍"，
    // 后一次会静悄悄盖掉用户选的档位。
    const sites = lines.filter((line) => /\.reverse\(/.test(line));
    expect(sites, `发现自行倒序：${sites.join(' | ')}`).toEqual([]);
  });

  it('🔴 档位真的传给了共享列表（漏传时界面不变序、也不报错）', () => {
    expect(lines.some((line) => /^\s*sort=\{taskSort\}$/.test(line.trimEnd()))).toBe(true);
  });

  it('🔴 档位不写进 op-log：屏幕里不许拿它构造任何动作', () => {
    // 它是阅读偏好。进 op-log 就是让另一台设备被同步改掉自己的选择 ——
    // 那在这套同步模型里是最贵的一类错误（双向覆盖）。
    const leaked = lines.filter((line) => /dispatch\([^)]*taskSort/.test(line));
    expect(leaked).toEqual([]);
  });
});
