/**
 * 意图队列测试
 * =============
 *
 * 队列的三种失效方式都很安静，所以每条测试都对着其中一种：
 *
 *   1. **last-wins 失效** → 用户点"完成"再点"取消完成"，数据变成完成
 *      （因为两条都执行了，顺序还对）。用户会觉得"点了没反应"。
 *   2. **跳过已达成失效** → 产生一个无意义的 op，把 `completedAt` **改到现在**
 *      → "今天完成了 3 件"这类基于完成时间的口径全部偏移。数据没坏，数字全错。
 *   3. **坏数据不降级** → 应用在启动路径上崩，且用户完全不知道发生了什么。
 */

import { describe, expect, it } from 'vitest';

import {
  WIDGET_INTENT_MAX,
  WIDGET_INTENT_VERSION,
  classifyIntents,
  drainableIntents,
  emptyIntentQueue,
  mergeIntent,
  mergeIntents,
  parseIntentQueue,
  parseIntentQueueJson,
  type WidgetIntent,
} from '../src/intents.js';

function intent(taskId: string, targetIsDone: boolean, at = 1000): WidgetIntent {
  return { taskId, targetIsDone, at };
}

/** 用一张表当 lookup。缺席 = 任务不存在。 */
function lookupOf(map: Record<string, boolean>) {
  return (taskId: string): boolean | undefined => map[taskId];
}

describe('mergeIntent —— last-wins', () => {
  it('同一任务点两次 → 只留最新那条', () => {
    const queue = mergeIntents(emptyIntentQueue(), [
      intent('t1', true, 100),
      intent('t1', false, 200),
    ]);
    expect(queue.intents).toEqual([intent('t1', false, 200)]);
  });

  it('🔴 同一毫秒连点两次也有确定结果（不靠 `at` 排序）', () => {
    // 这是"位置即新旧"的设计要挡的：靠 `at` 排序时两条的 at 相等，
    // 结果取决于排序算法是否稳定 —— 那是不确定行为。
    const queue = mergeIntents(emptyIntentQueue(), [
      intent('t1', true, 500),
      intent('t1', false, 500),
    ]);
    expect(queue.intents).toEqual([intent('t1', false, 500)]);
  });

  it('不同任务各自保留，且按点击顺序排列', () => {
    const queue = mergeIntents(emptyIntentQueue(), [
      intent('t1', true),
      intent('t2', true),
      intent('t1', false),
    ]);
    // t1 被折叠并**移到末尾**（它是最新的点击）
    expect(queue.intents.map((i) => [i.taskId, i.targetIsDone])).toEqual([
      ['t2', true],
      ['t1', false],
    ]);
  });

  it('不修改入参队列', () => {
    const original = mergeIntents(emptyIntentQueue(), [intent('t1', true)]);
    const snapshot = JSON.parse(JSON.stringify(original));
    mergeIntent(original, intent('t1', false));
    mergeIntent(original, intent('t2', true));
    expect(original).toEqual(snapshot);
  });

  it('返回的队列版本号始终是当前版本', () => {
    expect(mergeIntent(emptyIntentQueue(), intent('t1', true)).v).toBe(WIDGET_INTENT_VERSION);
  });
});

describe('mergeIntent —— 上限', () => {
  it('超过上限时丢**最旧**的', () => {
    let queue = emptyIntentQueue();
    for (let i = 0; i < WIDGET_INTENT_MAX + 3; i += 1) {
      queue = mergeIntent(queue, intent(`t${i}`, true, i));
    }
    expect(queue.intents).toHaveLength(WIDGET_INTENT_MAX);
    // 最旧的三条（t0/t1/t2）被丢掉了
    expect(queue.intents[0]!.taskId).toBe('t3');
    expect(queue.intents.at(-1)!.taskId).toBe(`t${WIDGET_INTENT_MAX + 2}`);
  });

  it('🔴 队列满时，对**已有**任务的反复点击不会被丢掉', () => {
    // 折叠发生在截断**之前**，所以同一个任务的点击永远不会因为队列满而消失。
    // 反过来的实现（先截断再折叠）会让用户"点了没反应"，而且只在队列满时出现。
    let queue = emptyIntentQueue();
    for (let i = 0; i < WIDGET_INTENT_MAX; i += 1) {
      queue = mergeIntent(queue, intent(`t${i}`, true, i));
    }
    queue = mergeIntent(queue, intent('t0', false, 9999));
    expect(queue.intents).toHaveLength(WIDGET_INTENT_MAX);
    expect(queue.intents).toContainEqual(intent('t0', false, 9999));
  });
});

describe('parseIntentQueue —— fail closed', () => {
  it('接受自己写出的队列', () => {
    const queue = mergeIntents(emptyIntentQueue(), [intent('t1', true)]);
    expect(parseIntentQueue(JSON.parse(JSON.stringify(queue)))).toEqual(queue);
  });

  it('空队列合法', () => {
    expect(parseIntentQueue({ v: WIDGET_INTENT_VERSION, intents: [] })).toEqual(
      emptyIntentQueue(),
    );
  });

  it.each([
    ['非对象', 'not an object'],
    ['null', null],
    ['数组', []],
    ['版本未知', { v: 99, intents: [] }],
    ['版本缺失', { intents: [] }],
    ['intents 不是数组', { v: WIDGET_INTENT_VERSION, intents: {} }],
    ['条目不是对象', { v: WIDGET_INTENT_VERSION, intents: ['x'] }],
    ['taskId 空串', { v: WIDGET_INTENT_VERSION, intents: [{ taskId: '', targetIsDone: true, at: 1 }] }],
    ['taskId 非字符串', { v: WIDGET_INTENT_VERSION, intents: [{ taskId: 1, targetIsDone: true, at: 1 }] }],
    ['targetIsDone 非布尔', { v: WIDGET_INTENT_VERSION, intents: [{ taskId: 't', targetIsDone: 'yes', at: 1 }] }],
    ['at 缺失', { v: WIDGET_INTENT_VERSION, intents: [{ taskId: 't', targetIsDone: true }] }],
    ['at 非整数', { v: WIDGET_INTENT_VERSION, intents: [{ taskId: 't', targetIsDone: true, at: 1.5 }] }],
    ['at 为负', { v: WIDGET_INTENT_VERSION, intents: [{ taskId: 't', targetIsDone: true, at: -1 }] }],
  ])('🔴 坏数据（%s）→ 空队列，不抛', (_name, raw) => {
    expect(() => parseIntentQueue(raw)).not.toThrow();
    expect(parseIntentQueue(raw)).toEqual(emptyIntentQueue());
  });

  it('🔴 超限的队列整体拒绝（不是"截断后接受"）', () => {
    // 本模块自己不会写出超限的队列，所以超限 = 外部坏数据。
    // 截断后接受会让一个被反复追加坏数据的队列看起来正常。
    const tooMany = Array.from({ length: WIDGET_INTENT_MAX + 1 }, (_, i) => ({
      taskId: `t${i}`,
      targetIsDone: true,
      at: i,
    }));
    expect(parseIntentQueue({ v: WIDGET_INTENT_VERSION, intents: tooMany })).toEqual(
      emptyIntentQueue(),
    );
  });

  it('恰好等于上限时接受（边界，防止写成 >=）', () => {
    const exact = Array.from({ length: WIDGET_INTENT_MAX }, (_, i) => ({
      taskId: `t${i}`,
      targetIsDone: true,
      at: i,
    }));
    expect(parseIntentQueue({ v: WIDGET_INTENT_VERSION, intents: exact }).intents).toHaveLength(
      WIDGET_INTENT_MAX,
    );
  });

  it('🔴 一条坏条目就让整个队列被拒（不做"跳过坏的、留下好的"）', () => {
    // 部分接受会让"用户点了 3 下只生效 2 下"，而没有任何信号说明为什么。
    // 整体拒绝至少是**一致**的：要么这一批都在，要么都在。不可判定比部分正确好。
    const raw = {
      v: WIDGET_INTENT_VERSION,
      intents: [
        { taskId: 'good1', targetIsDone: true, at: 1 },
        { taskId: 'bad', targetIsDone: 'yes', at: 2 },
        { taskId: 'good2', targetIsDone: true, at: 3 },
      ],
    };
    expect(parseIntentQueue(raw)).toEqual(emptyIntentQueue());
  });
});

describe('drainableIntents —— 跳过"已在目标状态"', () => {
  it('目标态与当前态不同 → 保留（这才是要执行的）', () => {
    const queue = mergeIntents(emptyIntentQueue(), [intent('t1', true)]);
    expect(drainableIntents(queue, lookupOf({ t1: false }))).toEqual([intent('t1', true)]);
  });

  it('🔴 已在目标状态 → 丢弃（否则会篡改 completedAt）', () => {
    // 用户在另一台设备上完成了这个任务，然后又点了组件上的"完成"。
    // 若不丢，会写出一个 `completedAt = 现在` 的 op，
    // 于是"今天完成了 3 件"这类口径整体偏移 —— **数据没坏，数字全错**。
    const queue = mergeIntents(emptyIntentQueue(), [intent('t1', true)]);
    expect(drainableIntents(queue, lookupOf({ t1: true }))).toEqual([]);
  });

  it('取消完成也同理：已经是未完成，就别再写一次', () => {
    const queue = mergeIntents(emptyIntentQueue(), [intent('t1', false)]);
    expect(drainableIntents(queue, lookupOf({ t1: false }))).toEqual([]);
  });

  it('任务不存在（已删/已清）→ 丢弃，且不崩', () => {
    const queue = mergeIntents(emptyIntentQueue(), [intent('gone', true), intent('t1', true)]);
    expect(drainableIntents(queue, lookupOf({ t1: false }))).toEqual([intent('t1', true)]);
  });

  it('空队列 → 空结果', () => {
    expect(drainableIntents(emptyIntentQueue(), lookupOf({}))).toEqual([]);
  });

  it('🔴 混合场景：三种情况同时出现，只有该执行的那条留下', () => {
    const queue = mergeIntents(emptyIntentQueue(), [
      intent('already', true), // 已达成 → 丢
      intent('missing', true), // 不存在 → 丢
      intent('do_it', true), // 需要执行 → 留
      intent('undo_it', false), // 需要执行（取消完成）→ 留
    ]);
    const result = drainableIntents(
      queue,
      lookupOf({ already: true, do_it: false, undo_it: true }),
    );
    expect(result.map((i) => i.taskId)).toEqual(['do_it', 'undo_it']);
  });

  it('保留结果按队列顺序（即点击顺序）', () => {
    const queue = mergeIntents(emptyIntentQueue(), [
      intent('a', true, 1),
      intent('b', true, 2),
      intent('c', true, 3),
    ]);
    const result = drainableIntents(queue, lookupOf({ a: false, b: false, c: false }));
    expect(result.map((i) => i.taskId)).toEqual(['a', 'b', 'c']);
  });
});

describe('classifyIntents —— 区分两种"丢弃"的原因', () => {
  it('🔴 "已达成"与"任务不存在"必须分开报（含义完全不同）', () => {
    // `alreadyInTarget` 是正常且高频的；`missing` 高得不正常说明
    // 快照与物化状态脱节了 —— 合并成一个计数就再也分不出来。
    const queue = mergeIntents(emptyIntentQueue(), [
      intent('done', true),
      intent('gone', true),
      intent('todo', true),
    ]);
    const result = classifyIntents(queue, lookupOf({ done: true, todo: false }));

    expect(result.alreadyInTarget.map((i) => i.taskId)).toEqual(['done']);
    expect(result.missing.map((i) => i.taskId)).toEqual(['gone']);
    expect(result.apply.map((i) => i.taskId)).toEqual(['todo']);
  });

  it('三类加起来等于原队列（不丢也不多）', () => {
    const queue = mergeIntents(emptyIntentQueue(), [
      intent('a', true),
      intent('b', false),
      intent('c', true),
      intent('d', false),
    ]);
    const result = classifyIntents(queue, lookupOf({ a: true, b: true, c: false }));
    const total =
      result.apply.length + result.alreadyInTarget.length + result.missing.length;
    expect(total).toBe(queue.intents.length);
  });

  it('空队列 → 三个空数组（不返回 undefined）', () => {
    expect(classifyIntents(emptyIntentQueue(), lookupOf({}))).toEqual({
      apply: [],
      alreadyInTarget: [],
      missing: [],
    });
  });

  it('drainableIntents 就是 classifyIntents(...).apply（两者不会分叉）', () => {
    const queue = mergeIntents(emptyIntentQueue(), [intent('a', true), intent('b', false)]);
    const lookup = lookupOf({ a: false, b: true });
    expect(drainableIntents(queue, lookup)).toEqual(classifyIntents(queue, lookup).apply);
  });
});

/**
 * `parseIntentQueueJson` —— 从**共享容器里那个字符串**解析。
 *
 * 🔴 这一组的价值不在于"多测了一个函数"，而在于它锁住了一个**跨端不对称**：
 * Kotlin 的 `WidgetIntentQueues.parse` 收字符串、TS 的 `parseIntentQueue` 收对象，
 * 而两者名字几乎一样。真实发生过的写法是 `parseIntentQueue(rawString)` ——
 * 它**不报错**，只是静默返回空队列（`isPlainObject` 把字符串挡掉），
 * 症状是"组件里点了没反应，且任何日志里都没有痕迹"。
 *
 * 所以这里每一条都在问同一个问题：**给一个非对象的输入，它是降级还是抛？**
 */
describe('parseIntentQueueJson —— 字符串入口，永不抛', () => {
  const valid = {
    v: WIDGET_INTENT_VERSION,
    intents: [{ taskId: 't1', targetIsDone: true, at: 1000 }],
  };

  it('合法 JSON 字符串解析出队列', () => {
    expect(parseIntentQueueJson(JSON.stringify(valid))).toEqual(valid);
  });

  it('与 parseIntentQueue(JSON.parse(...)) **完全一致**', () => {
    // 两者必须同源。分叉的表现是"某一条路径比另一条更宽松"，
    // 而宽松的那条会放进本该系统拒绝的数据。
    expect(parseIntentQueueJson(JSON.stringify(valid))).toEqual(
      parseIntentQueue(JSON.parse(JSON.stringify(valid))),
    );
  });

  it('null / undefined（容器里没有）→ 空队列', () => {
    expect(parseIntentQueueJson(null)).toEqual(emptyIntentQueue());
    expect(parseIntentQueueJson(undefined)).toEqual(emptyIntentQueue());
  });

  it('空串 → 空队列（不是抛）', () => {
    expect(parseIntentQueueJson('')).toEqual(emptyIntentQueue());
  });

  it('坏 JSON → 空队列（不是抛）', () => {
    expect(() => parseIntentQueueJson('{ 不是 JSON')).not.toThrow();
    expect(parseIntentQueueJson('{ 不是 JSON')).toEqual(emptyIntentQueue());
  });

  it('🔴 字面量 null → 空队列（`JSON.parse("null")` 会**成功**返回 null）', () => {
    // 这一条单独列出来，是因为它走的是与"坏 JSON"**不同**的分支：
    // JSON.parse 不抛，返回 null，然后被 isPlainObject 挡掉。
    // 少任何一道，这里都会抛 TypeError 或返回一个非队列对象。
    expect(parseIntentQueueJson('null')).toEqual(emptyIntentQueue());
  });

  it('JSON 是字符串/数字/数组（合法 JSON 但不是对象）→ 空队列', () => {
    expect(parseIntentQueueJson('"一个字符串"')).toEqual(emptyIntentQueue());
    expect(parseIntentQueueJson('42')).toEqual(emptyIntentQueue());
    expect(parseIntentQueueJson('[1,2,3]')).toEqual(emptyIntentQueue());
  });

  it('对象合法但版本不对 → 空队列（与 parseIntentQueue 同一判据）', () => {
    expect(
      parseIntentQueueJson(JSON.stringify({ v: 99, intents: [] })),
    ).toEqual(emptyIntentQueue());
  });
});
