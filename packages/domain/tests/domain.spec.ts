import { MODELED_ENTITY_TYPES, hasModel } from '../src/index.js';
/**
 * 领域层测试
 * ===========
 *
 * 重点测**边界条件**，不是测"正常情况能跑"。
 * 下面每个 describe 都对应我在实现里明确写出的一个坑。
 */

import { describe, expect, it } from 'vitest';

import {
  addDays,
  diffDays,
  isoWeekday,
  parseLocalDate,
  toLocalDate,
} from '../src/date.js';
import {
  DEFAULT_URGENT_WINDOW_DAYS,
  DROP_URGENT_LEAD_MS,
  bucketByQuadrant,
  classifyQuadrant,
  isUrgent,
  planQuadrantDrop,
  type QuadrantDropPlan,
} from '../src/quadrant.js';
// Quadrant 定义在 entities，quadrant.ts 只 import 不 re-export。
// 从 quadrant.js 导入它会得到 undefined（打包器对不存在的命名导入不报错），
// 表现为 "Cannot read properties of undefined (reading 'UrgentImportant')"。
import { Priority, Quadrant, type Habit, type HabitLog, type Task } from '../src/entities.js';
import { computeStreak, isScheduledOn } from '../src/habit-streak.js';
import {
  DEFAULT_FOCUS_CONFIG,
  abort,
  advance,
  formatDuration,
  initialFocusState,
  isFinished,
  pause,
  remainingMs,
  resume,
  start,
} from '../src/focus.js';

// ─────────────────────────────────────────────────────────────
// 本地日期
// ─────────────────────────────────────────────────────────────

describe('本地日期（时区正确性）', () => {
  it('toLocalDate 用本地时区，不是 UTC', () => {
    // 构造一个本地时间 2026-09-25 01:00。
    // 在 UTC+8 下，它的 UTC 日期是 2026-09-24 —— 用 toISOString 会得到前一天。
    const localOneAm = new Date(2026, 8, 25, 1, 0, 0).getTime();
    expect(toLocalDate(localOneAm)).toBe('2026-09-25');
  });

  it('跨月边界', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('闰年 2 月', () => {
    // 2028 是闰年
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2028-02-29', 1)).toBe('2028-03-01');
    // 2026 不是
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('跨年', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
  });

  it('diffDays 方向与符号正确', () => {
    expect(diffDays('2026-09-25', '2026-09-26')).toBe(1);
    expect(diffDays('2026-09-26', '2026-09-25')).toBe(-1);
    expect(diffDays('2026-09-25', '2026-09-25')).toBe(0);
  });

  it('diffDays 跨闰年也精确（不是简单除以 86400000）', () => {
    expect(diffDays('2028-02-28', '2028-03-01')).toBe(2); // 含 2/29
  });

  it('isoWeekday：1=周一 … 7=周日', () => {
    // 2026-09-25 是周五
    expect(isoWeekday('2026-09-25')).toBe(5);
    // 2026-09-27 是周日 —— 这里最容易错，JS 的 getDay() 周日返回 0
    expect(isoWeekday('2026-09-27')).toBe(7);
    expect(isoWeekday('2026-09-28')).toBe(1);
  });

  it('parseLocalDate 对非法输入抛错，而不是静默返回 Invalid Date', () => {
    expect(() => parseLocalDate('not-a-date')).toThrow(/非法日期格式/);
  });
});

// ─────────────────────────────────────────────────────────────
// 四象限
// ─────────────────────────────────────────────────────────────

const NOW = new Date(2026, 8, 25, 12, 0, 0).getTime();
const DAY = 24 * 60 * 60 * 1000;

function makeTask(over: Partial<Task> = {}): Task {
  return {
    id: 't1',
    title: '任务',
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

describe('四象限归类', () => {
  it('重要 + 紧急 → Q1', () => {
    const t = makeTask({ important: true, dueDate: NOW + DAY });
    expect(classifyQuadrant(t, { now: NOW })).toBe(Quadrant.UrgentImportant);
  });

  it('重要 + 不紧急 → Q2', () => {
    const t = makeTask({ important: true, dueDate: NOW + 30 * DAY });
    expect(classifyQuadrant(t, { now: NOW })).toBe(Quadrant.ImportantNotUrgent);
  });

  it('不重要 + 紧急 → Q3', () => {
    const t = makeTask({ important: false, dueDate: NOW + DAY });
    expect(classifyQuadrant(t, { now: NOW })).toBe(Quadrant.UrgentNotImportant);
  });

  it('不重要 + 不紧急 → Q4', () => {
    const t = makeTask({ important: false });
    expect(classifyQuadrant(t, { now: NOW })).toBe(Quadrant.Neither);
  });

  it('已过期算紧急（不是"过了就不管了"）', () => {
    const t = makeTask({ important: true, dueDate: NOW - 5 * DAY });
    expect(isUrgent(t, { now: NOW })).toBe(true);
  });

  it('已完成的任务永不紧急', () => {
    const t = makeTask({ important: true, dueDate: NOW + DAY, completedAt: NOW });
    expect(isUrgent(t, { now: NOW })).toBe(false);
  });

  it('无截止时间不紧急', () => {
    expect(isUrgent(makeTask({ important: true }), { now: NOW })).toBe(false);
  });

  it('紧急窗口边界：正好等于窗口算紧急，多 1ms 不算', () => {
    const windowMs = DEFAULT_URGENT_WINDOW_DAYS * DAY;
    expect(isUrgent(makeTask({ dueDate: NOW + windowMs }), { now: NOW })).toBe(true);
    expect(isUrgent(makeTask({ dueDate: NOW + windowMs + 1 }), { now: NOW })).toBe(false);
  });

  it('important 缺失时回退到优先级推导（前向兼容老数据）', () => {
    // 这是关键回归测试：老数据没有 important 字段。
    // 若不回退，所有历史任务会挤进 Q4，象限视图看起来像坏了。
    const highNoFlag = makeTask({ priority: Priority.High, dueDate: NOW + DAY });
    expect(classifyQuadrant(highNoFlag, { now: NOW })).toBe(Quadrant.UrgentImportant);
  });

  it('MEDIUM 优先级不被当作重要（否则象限失去区分度）', () => {
    const medium = makeTask({ priority: Priority.Medium });
    expect(classifyQuadrant(medium, { now: NOW })).toBe(Quadrant.Neither);
  });

  it('分桶排除已完成与已删除', () => {
    const buckets = bucketByQuadrant(
      [
        makeTask({ id: 'a', important: true, dueDate: NOW + DAY }),
        makeTask({ id: 'b', important: true, dueDate: NOW + DAY, completedAt: NOW }),
        makeTask({
          id: 'c',
          important: true,
          dueDate: NOW + DAY,
          deletedAt: NOW,
        }),
      ],
      { now: NOW },
    );
    expect(buckets[Quadrant.UrgentImportant].map((t) => t.id)).toEqual(['a']);
  });

  it('桶内排序：先按截止时间升序，无截止时间排最后', () => {
    // ⚠️ 三个任务必须都落在**同一个**桶里，否则测的不是排序。
    // 我第一版给的 dueDate 在紧急窗口内，于是前两个进了 Q1、noDue 留在 Q2，
    // 断言看到的是只有 noDue 的 Q2 —— 测的是分桶不是排序。
    const buckets = bucketByQuadrant(
      [
        makeTask({ id: 'noDue', important: true }),
        makeTask({ id: 'later', important: true, dueDate: NOW + 60 * DAY }),
        makeTask({ id: 'sooner', important: true, dueDate: NOW + 30 * DAY }),
      ],
      { now: NOW },
    );
    expect(buckets[Quadrant.ImportantNotUrgent].map((t) => t.id)).toEqual([
      'sooner',
      'later',
      'noDue',
    ]);
  });
});

// ─────────────────────────────────────────────────────────────
// 拖放投放计划
// ─────────────────────────────────────────────────────────────

/** 把 plan 应用到任务上。测试里用它来实现"投放后落在哪一格"的真正判据。 */
function applyDropPlan(task: Task, plan: QuadrantDropPlan): Task {
  const next: Task = { ...task, important: plan.important };
  if (plan.dueDate === null) {
    delete next.dueDate;
  } else if (plan.dueDate !== undefined) {
    next.dueDate = plan.dueDate;
  }
  return next;
}

describe('拖放投放计划（planQuadrantDrop）', () => {
  // 🔴 这一组的价值在于**它能失败**。
  //    把实现换回 `apps/web` 原来的那段逻辑（只在 `dueDate === undefined` 时才补），
  //    第二条会立刻变红 —— 那是它的第一个真缺陷。

  const ALL = [
    Quadrant.UrgentImportant,
    Quadrant.ImportantNotUrgent,
    Quadrant.UrgentNotImportant,
    Quadrant.Neither,
  ] as const;

  /** 三种截止时间状态：没有 / 落在窗口内 / 落在窗口外。 */
  const STATES = [
    { name: '无截止时间', dueDate: undefined },
    { name: '窗口内', dueDate: NOW + DAY },
    { name: '窗口外', dueDate: NOW + 10 * DAY },
  ] as const;

  it('缺陷回归：窗口**外**的截止时间也必须被推进，否则任务弹回原格', () => {
    // apps/web/QuadrantBoard.tsx 原来的写法是
    //   `if (urgent && task.dueDate === undefined)`
    // —— 只处理"完全没有截止时间"。于是一个 10 天后到期的任务被拖进 Q1 时，
    // 只会被设成"重要"，而它**仍然不紧急**，任务**弹回 Q2**。
    // 用户拖了等于没拖，界面上没有任何解释。
    const t = makeTask({ important: false, dueDate: NOW + 10 * DAY });
    const plan = planQuadrantDrop(t, Quadrant.UrgentImportant, { now: NOW });

    expect(plan.important).toBe(true);
    expect(plan.dueDate).toBe(NOW + DROP_URGENT_LEAD_MS);
    expect(plan.dueDateChange).toBe('pushed');

    // 真正的判据不是"字段变了"，而是**投放后确实落在目标象限**。
    expect(classifyQuadrant(applyDropPlan(t, plan), { now: NOW })).toBe(
      Quadrant.UrgentImportant,
    );
  });

  it('已经紧急 → 不碰用户的截止时间（拖拽只改它必须改的）', () => {
    const t = makeTask({ important: false, dueDate: NOW + DAY });
    const plan = planQuadrantDrop(t, Quadrant.UrgentImportant, { now: NOW });

    expect(plan.important).toBe(true);
    expect(plan.dueDate).toBeUndefined();
    expect(plan.dueDateChange).toBeUndefined();
    expect(classifyQuadrant(applyDropPlan(t, plan), { now: NOW })).toBe(
      Quadrant.UrgentImportant,
    );
  });

  it('拖进非紧急侧会清除截止时间，并**如实报告**（不能无声）', () => {
    // 清除是可接受的语义（这一格就是"没有迫近的期限"），
    // 但它**是用户数据的删除**。必须通过 dueDateChange 让 UI 说出来。
    const t = makeTask({ important: true, dueDate: NOW + DAY });
    const plan = planQuadrantDrop(t, Quadrant.ImportantNotUrgent, { now: NOW });

    expect(plan.important).toBe(true);
    expect(plan.dueDate).toBeNull();
    expect(plan.dueDateChange).toBe('cleared');
    expect(classifyQuadrant(applyDropPlan(t, plan), { now: NOW })).toBe(
      Quadrant.ImportantNotUrgent,
    );
  });

  it('本来就没有截止时间 → 没什么可清，不上报变化', () => {
    const t = makeTask({ important: true });
    const plan = planQuadrantDrop(t, Quadrant.Neither, { now: NOW });

    expect(plan.important).toBe(false);
    expect(plan.dueDate).toBeUndefined();
    expect(plan.dueDateChange).toBeUndefined();
  });

  it('穷举 4 象限 × 3 种截止时间状态：投放后**必须**落在目标格', () => {
    // 这是这一个函数存在的理由。逐格手写断言会漏组合，
    // 而"落不到你拖的那一格"正是原实现的缺陷。
    for (const target of ALL) {
      for (const state of STATES) {
        const t = makeTask({ important: true, dueDate: state.dueDate });
        const plan = planQuadrantDrop(t, target, { now: NOW });
        const after = applyDropPlan(t, plan);

        expect(
          classifyQuadrant(after, { now: NOW }),
          `目标=${target} / 起点=${state.name} 时没有落在目标象限`,
        ).toBe(target);
      }
    }
  });

  it('已完成的紧急任务不会被推期限（几何判断不复用显示语义）', () => {
    // `isUrgent` 对已完成任务恒返回 false（显示语义："它已经不需要做了"）。
    // 若这里复用它，一个已完成的、明天到期的任务会被**推一个新期限** ——
    // 而它本来就已经在窗口内。
    const t = makeTask({ important: false, dueDate: NOW + DAY, completedAt: NOW });
    const plan = planQuadrantDrop(t, Quadrant.UrgentImportant, { now: NOW });

    expect(plan.dueDate).toBeUndefined();
    expect(plan.dueDateChange).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────
// 习惯连续天数
// ─────────────────────────────────────────────────────────────

function makeHabit(over: Partial<Habit> = {}): Habit {
  return { id: 'h1', name: '喝水', createdAt: NOW, updatedAt: NOW, ...over };
}

function log(habitId: string, date: string, value?: number): HabitLog {
  return { id: `l-${date}`, habitId, date, value, createdAt: NOW, updatedAt: NOW };
}

describe('习惯连续天数', () => {
  it('没有记录 → 0', () => {
    const r = computeStreak(makeHabit(), [], '2026-09-25');
    expect(r).toEqual({ current: 0, longest: 0 });
  });

  it('连续三天打卡 → current=3', () => {
    const h = makeHabit();
    const logs = [log('h1', '2026-09-23'), log('h1', '2026-09-24'), log('h1', '2026-09-25')];
    expect(computeStreak(h, logs, '2026-09-25').current).toBe(3);
  });

  it('🔴 今天还没打卡**不**断掉连续（最重要的回归测试）', () => {
    // 用户上午打开应用，昨天打了、今天还没打。
    // 若从"今天"往回数，会得到 0 —— 用户会以为记录丢了。
    const h = makeHabit();
    const logs = [log('h1', '2026-09-23'), log('h1', '2026-09-24')];
    const r = computeStreak(h, logs, '2026-09-25');
    expect(r.current).toBe(2);
    expect(r.lastDate).toBe('2026-09-24');
  });

  it('中间断了一天 → 只算最近一段', () => {
    const h = makeHabit();
    const logs = [
      log('h1', '2026-09-20'),
      log('h1', '2026-09-21'),
      // 9-22 缺失
      log('h1', '2026-09-23'),
      log('h1', '2026-09-24'),
      log('h1', '2026-09-25'),
    ];
    const r = computeStreak(h, logs, '2026-09-25');
    expect(r.current).toBe(3);
    expect(r.longest).toBe(3);
  });

  it('历史最长可以大于当前（断过之后）', () => {
    const h = makeHabit();
    const logs = [
      log('h1', '2026-09-01'),
      log('h1', '2026-09-02'),
      log('h1', '2026-09-03'),
      log('h1', '2026-09-04'),
      // 断
      log('h1', '2026-09-24'),
      log('h1', '2026-09-25'),
    ];
    const r = computeStreak(h, logs, '2026-09-25');
    expect(r.current).toBe(2);
    expect(r.longest).toBe(4);
  });

  it('长期未打卡 → current 归零，但 longest 保留', () => {
    const h = makeHabit();
    const logs = [log('h1', '2026-06-01'), log('h1', '2026-06-02')];
    const r = computeStreak(h, logs, '2026-09-25');
    expect(r.current).toBe(0);
    expect(r.longest).toBe(2);
  });

  it('每周一三五的习惯：周二没打卡**不算**断', () => {
    const h = makeHabit({ frequency: { type: 'weekly', daysOfWeek: [1, 3, 5] } });
    // 2026-09-25 是周五。往前：23(三)、21(一)
    const logs = [
      log('h1', '2026-09-21'),
      log('h1', '2026-09-23'),
      log('h1', '2026-09-25'),
    ];
    expect(computeStreak(h, logs, '2026-09-25').current).toBe(3);
  });

  it('每周一三五：cessation 判定也要按频率（不是按自然日）', () => {
    const h = makeHabit({ frequency: { type: 'weekly', daysOfWeek: [1] } });
    // 只在每个周一。9-14、9-21 打了，9-28 还没到
    const logs = [log('h1', '2026-09-14'), log('h1', '2026-09-21')];
    // 今天是 9-25（周五），下一个周一是 9-28 —— 不该断
    expect(computeStreak(h, logs, '2026-09-25').current).toBe(2);
  });

  /**
   * 🔴 「宽限期」是一个**时间**概念，不是一个**次数**概念。
   *
   * 旧实现里 `isStillAlive` 拿同一个 `grace` 当两种单位用：
   * 先用它比**日历日**（`gap <= grace`），再用它比**漏掉的计划日个数**
   * （`missed >= grace`）。每日习惯两者相等（grace=1），所以这个混用
   * 在每日习惯上完全看不出来；一旦频率是「每 7 天一次」，第二个比较
   * 就变成了「可以漏 **7 次**」—— 而注释写的意图是「允许**一个**完整周期」。
   *
   * 实测（每 7 天一次，计划日 9-10 / 9-17 / 9-24 / 10-01）：
   * 漏 1 个 → current 仍是 1；漏 2 个 → 仍是 1；**漏到第 7 个才归零**。
   * 对照每日习惯漏 1 天立刻归零。
   *
   * 这个数不是只躺在领域层：`selectors.ts` 的 `bestCurrentStreak` 直接喂
   * `streakDays` 身份标签（阈值 30），所以"六周没打卡还算连上"会变成
   * 一枚**不该发的身份标签**。
   */
  it('🔴 每 7 天一次：漏掉 1 个计划日就该断，宽限期不是"可以漏 7 次"', () => {
    const h = makeHabit({ frequency: { type: 'interval', everyNDays: 7 } });

    // 前提断言：下面那两个日子**确实**是计划日。否则这条用例测的
    // 就不是"漏了一个计划日"，而会静默变成另一个场景。
    expect(isScheduledOn(h.frequency, '2026-09-10')).toBe(true);
    expect(isScheduledOn(h.frequency, '2026-09-17')).toBe(true);
    expect(isScheduledOn(h.frequency, '2026-09-19')).toBe(false);

    const logs = [log('h1', '2026-09-10')];

    // 9-17 这个计划日漏了，今天 9-18（下一个计划日 9-24 还没到）
    expect(computeStreak(h, logs, '2026-09-18').current).toBe(0);
    // 再漏一个也一样
    expect(computeStreak(h, logs, '2026-09-25').current).toBe(0);
  });

  it('对照组：每 7 天一次，下一个计划日还没到 → 不能归零', () => {
    const h = makeHabit({ frequency: { type: 'interval', everyNDays: 7 } });
    expect(isScheduledOn(h.frequency, '2026-09-10')).toBe(true);
    const logs = [log('h1', '2026-09-10')];
    // 今天 9-11，计划日 9-17 还没到 —— 上午打开界面不该看到 0
    expect(computeStreak(h, logs, '2026-09-11').current).toBe(1);
    // 恰好压在计划日当天、还没打卡 —— 今天没过完，同样不算漏
    expect(computeStreak(h, logs, '2026-09-17').current).toBe(1);
  });

  it('isScheduledOn 对 daily / weekly / interval 都正确', () => {
    expect(isScheduledOn({ type: 'daily' }, '2026-09-25')).toBe(true);
    expect(isScheduledOn({ type: 'weekly', daysOfWeek: [5] }, '2026-09-25')).toBe(true);
    expect(isScheduledOn({ type: 'weekly', daysOfWeek: [1] }, '2026-09-25')).toBe(false);
    expect(isScheduledOn({ type: 'interval', everyNDays: 3 }, '1970-01-01')).toBe(true);
    expect(isScheduledOn({ type: 'interval', everyNDays: 3 }, '1970-01-02')).toBe(false);
    expect(isScheduledOn({ type: 'interval', everyNDays: 3 }, '1970-01-04')).toBe(true);
  });

  it('goalType=atLeast：未达目标不算达成', () => {
    const h = makeHabit({ target: 8, goalType: 'atLeast' });
    const logs = [
      log('h1', '2026-09-23', 3), // 没达标
      log('h1', '2026-09-24', 8),
      log('h1', '2026-09-25', 10),
    ];
    // 9-23 未达标 → 从 9-25 往回：25 ✓ 24 ✓ 23 ✗ → current=2
    expect(computeStreak(h, logs, '2026-09-25').current).toBe(2);
  });

  it('goalType=atMost：超过目标反而**不算**达成', () => {
    const h = makeHabit({ target: 2, goalType: 'atMost' });
    const logs = [log('h1', '2026-09-25', 3)];
    expect(computeStreak(h, logs, '2026-09-25').current).toBe(0);
  });

  it('已删除的打卡记录不计入', () => {
    const h = makeHabit();
    const l = log('h1', '2026-09-25');
    l.deletedAt = NOW;
    expect(computeStreak(h, [l], '2026-09-25').current).toBe(0);
  });

  it('其它习惯的记录不会被混入', () => {
    const h = makeHabit({ id: 'h1' });
    const logs = [log('h2', '2026-09-25')];
    expect(computeStreak(h, logs, '2026-09-25').current).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
// 番茄钟
// ─────────────────────────────────────────────────────────────

describe('番茄钟状态机', () => {
  it('初始为 idle', () => {
    const s = initialFocusState();
    expect(s.phase).toBe('idle');
    expect(s.kind).toBe('work');
    expect(remainingMs(s, NOW)).toBe(0);
  });

  it('开始后剩余时间 = 计划时长', () => {
    const s = start(initialFocusState(), NOW);
    expect(s.phase).toBe('running');
    expect(remainingMs(s, NOW)).toBe(DEFAULT_FOCUS_CONFIG.workMs);
  });

  it('🔴 剩余时间基于时间戳，**不**依赖 tick 次数（后台节流场景）', () => {
    // 这是整个模块存在的理由：浏览器可能把后台定时器降到 1 次/分钟。
    // 模拟"只 tick 了一次，但真实过了 20 分钟"。
    const s = start(initialFocusState(), NOW);
    const twentyMinLater = NOW + 20 * 60 * 1000;
    // 即使期间一次 tick 都没有，剩余时间也正确
    expect(remainingMs(s, twentyMinLater)).toBe(
      DEFAULT_FOCUS_CONFIG.workMs - 20 * 60 * 1000,
    );
  });

  it('超过计划时长后剩余为 0，不会变负', () => {
    const s = start(initialFocusState(), NOW);
    expect(remainingMs(s, NOW + 999 * 60 * 1000)).toBe(0);
  });

  it('暂停保留已过去的进度，恢复后不重置', () => {
    const s0 = start(initialFocusState(), NOW);
    const at10min = NOW + 10 * 60 * 1000;
    const paused = pause(s0, at10min);
    expect(paused.phase).toBe('paused');
    // 已过 10 分钟 → 剩余 15 分钟
    expect(remainingMs(paused, at10min)).toBe(15 * 60 * 1000);

    // 暂停两小时后恢复 —— 剩余量不应变化
    const twoHoursLater = at10min + 2 * 60 * 60 * 1000;
    const resumed = resume(paused, twoHoursLater);
    expect(remainingMs(resumed, twoHoursLater)).toBe(15 * 60 * 1000);
  });

  it('暂停期间剩余时间不变（哪怕过很久）', () => {
    const paused = pause(start(initialFocusState(), NOW), NOW + 5 * 60 * 1000);
    expect(remainingMs(paused, NOW + 5 * 60 * 1000 + 3 * 60 * 60 * 1000)).toBe(
      20 * 60 * 1000,
    );
  });

  it('isFinished 只在 running 且归零时为真', () => {
    const s = start(initialFocusState(), NOW);
    expect(isFinished(s, NOW)).toBe(false);
    expect(isFinished(s, NOW + DEFAULT_FOCUS_CONFIG.workMs)).toBe(true);
    // idle 状态不算完成
    expect(isFinished(initialFocusState(), NOW)).toBe(false);
  });

  it('专注结束 → 短休息，并产出已完成的 session', () => {
    const s = start(initialFocusState(), NOW);
    const atEnd = NOW + DEFAULT_FOCUS_CONFIG.workMs;
    const { next, finished } = advance(s, atEnd);
    expect(finished).not.toBeNull();
    expect(finished!.kind).toBe('work');
    expect(finished!.completed).toBe(true);
    expect(next.kind).toBe('shortBreak');
    expect(next.completedWorkCount).toBe(1);
  });

  it('每 4 个专注后进入长休息', () => {
    let s = start(initialFocusState(), NOW);
    let t = NOW;
    const kinds: string[] = [];
    for (let i = 0; i < 4; i++) {
      // 专注结束 → 记录下一轮类型
      t += s.plannedMs;
      s = start(advance(s, t).next, t);
      kinds.push(s.kind);
      // 必须把这一轮休息也走完，否则下一次循环推进的是休息而不是专注
      t += s.plannedMs;
      s = start(advance(s, t).next, t);
    }
    expect(kinds).toEqual(['shortBreak', 'shortBreak', 'shortBreak', 'longBreak']);
  });

  it('🔴 advance 后是 idle，不自动开始下一轮（状态机不管策略）', () => {
    // 这是刻意的设计：状态机只回答"下一轮该是什么"，
    // "要不要自动开始"是产品策略，由调用方决定。
    // 若自动开始，用户会突然发现休息已经在计时，无法选择跳过。
    const afterWork = advance(start(initialFocusState(), NOW), NOW + DEFAULT_FOCUS_CONFIG.workMs).next;
    expect(afterWork.phase).toBe('idle');
    expect(afterWork.kind).toBe('shortBreak');
    expect(remainingMs(afterWork, NOW)).toBe(0);
  });

  it('休息结束后回到专注', () => {
    const s = start(initialFocusState(), NOW);
    const afterWork = advance(s, NOW + s.plannedMs).next;
    const breakRunning = start(afterWork, NOW + s.plannedMs);
    const afterBreak = advance(
      breakRunning,
      NOW + s.plannedMs + breakRunning.plannedMs,
    ).next;
    expect(afterBreak.kind).toBe('work');
    expect(afterBreak.completedWorkCount).toBe(1);
  });

  it('未到时间时 advance 是空操作', () => {
    const s = start(initialFocusState(), NOW);
    const { next, finished } = advance(s, NOW + 1000);
    expect(next).toBe(s);
    expect(finished).toBeNull();
  });

  it('手动中止 → completed=false，且实际时长是已过时间', () => {
    const s = start(initialFocusState(), NOW);
    const { next, finished } = abort(s, NOW + 7 * 60 * 1000);
    expect(finished!.completed).toBe(false);
    expect(finished!.actualMs).toBe(7 * 60 * 1000);
    expect(next.phase).toBe('idle');
  });

  it('中止 idle 状态是空操作', () => {
    const { next, finished } = abort(initialFocusState(), NOW);
    expect(finished).toBeNull();
    expect(next.phase).toBe('idle');
  });

  it('可以关联任务', () => {
    const s = start(initialFocusState(), NOW, DEFAULT_FOCUS_CONFIG, 'task-42');
    expect(s.taskId).toBe('task-42');
    const { finished } = advance(s, NOW + s.plannedMs);
    expect(finished!.taskId).toBe('task-42');
  });

  it('formatDuration 用 ceil，避免计时器停在 00:00 两倍时长', () => {
    expect(formatDuration(60000)).toBe('01:00');
    expect(formatDuration(59400)).toBe('01:00'); // 59.4s 向上取整
    expect(formatDuration(1000)).toBe('00:01');
    expect(formatDuration(0)).toBe('00:00');
    expect(formatDuration(-5000)).toBe('00:00'); // 不变负
  });
});

// ─────────────────────────────────────────────────────────────
// 实体模型清单：只能有一份
// ─────────────────────────────────────────────────────────────

describe('🔴「已建模实体」清单只有一份定义', () => {
  it('hasModel 对清单里的每个类型都返回 true', () => {
    for (const t of MODELED_ENTITY_TYPES) {
      expect(hasModel(t), `${t} 在清单里，hasModel 却说它没有模型`).toBe(true);
    }
  });

  it('hasModel 对系统实体返回 false（它们有意不物化）', () => {
    for (const t of ['GLOBAL_CONFIG', 'MIGRATION', 'RECOVERY', 'ALL'] as const) {
      expect(hasModel(t), `${t} 是系统实体，不应有领域模型`).toBe(false);
    }
  });

  it('清单与 hasModel 不会各说各话（曾经的形状：两处手写、互不校验）', () => {
    // hasModel 曾经是一串手写的 `type === 'TASK' || ...`，与 EntityModelMap 的键
    // 各写一遍。加了一个键而忘了另一处，hasModel 就会对着一个真的有模型的实体
    // 返回 false —— 于是它被静默跳过。
    // 现在 hasModel 由 MODELED_ENTITY_TYPES 派生，这条断言钉住这个事实。
    const byList = MODELED_ENTITY_TYPES.filter((t) => hasModel(t));
    expect(byList.length).toBe(MODELED_ENTITY_TYPES.length);
    expect(new Set(MODELED_ENTITY_TYPES).size, '清单里有重复项').toBe(MODELED_ENTITY_TYPES.length);
  });
});
