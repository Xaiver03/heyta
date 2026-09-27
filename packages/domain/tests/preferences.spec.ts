import { describe, expect, it } from 'vitest';
import {
  countChecklistItems,
  emptyPreferenceSet,
  inferDeepWorkWindow,
  inferEstimateBias,
  inferGranularity,
  inferLeadTime,
  inferPreferences,
  inferTitleStyle,
  medianOf,
  MIN_SAMPLE_SIZE,
  type PreferenceFocusSession,
  type PreferenceTask,
} from '../src/preferences.js';

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 26);
const TZ = 480;
const LOCAL_MIDNIGHT = NOW - TZ * MINUTE;

function task(over: Partial<PreferenceTask> & { id: string }): PreferenceTask {
  return { title: '任务', createdAt: NOW - DAY, ...over };
}

function session(over: Partial<PreferenceFocusSession> = {}): PreferenceFocusSession {
  return { kind: 'work', plannedMs: 30 * MINUTE, actualMs: 30 * MINUTE, startedAt: NOW, ...over };
}

/** 造 `n` 条稳定样本。 */
const repeat = <T>(n: number, f: (i: number) => T): T[] =>
  Array.from({ length: n }, (_, i) => f(i));

describe('偏好层：冷启动必须诚实（不许编）', () => {
  it('完全没有数据 → 五条全部 withheld，理由都是 no-data', () => {
    const set = inferPreferences({
      memoryEnabled: true,
      tasks: [],
      focusSessions: [],
      now: NOW,
      utcOffsetMinutes: TZ,
    });
    expect(set.estimateBias).toBeNull();
    expect(set.deepWorkWindow).toBeNull();
    expect(set.leadTime).toBeNull();
    expect(set.granularity).toBeNull();
    expect(set.titleStyle).toBeNull();
    expect(set.withheld).toHaveLength(5);
    expect(set.withheld.every((w) => w.reason === 'no-data')).toBe(true);
  });

  it('样本差一条 → not-enough-samples，且**如实告诉用户还差几条**', () => {
    const sessions = repeat(MIN_SAMPLE_SIZE - 1, (i) =>
      session({ plannedMs: 30 * MINUTE, actualMs: 54 * MINUTE, startedAt: LOCAL_MIDNIGHT + 9 * HOUR - i * DAY }),
    );
    const { preference, withheld } = inferEstimateBias(sessions);
    expect(preference).toBeNull();
    expect(withheld?.reason).toBe('not-enough-samples');
    // 精确断言：结构化之后的直接好处（`toContain('1')` 连"11"都会放过去）。
    expect(withheld).toMatchObject({ reason: 'not-enough-samples', remaining: 1 });
  });

  it('🔴 不许用「平均用户」填充：样本不足时**绝不**返回一个猜测值', () => {
    const set = inferPreferences({
      memoryEnabled: true,
      tasks: [task({ id: 'a', dueDate: NOW, completedAt: NOW })],
      focusSessions: [session()],
      now: NOW,
      utcOffsetMinutes: TZ,
    });
    // 每个字段都必须是 null，不能是任何默认值
    expect(set.estimateBias).toBeNull();
    expect(set.leadTime).toBeNull();
    expect(Object.values(set).filter((v) => v !== null && typeof v === 'object' && 'value' in v)).toHaveLength(0);
  });

  it('数据太散 → not-stable-enough（而不是硬给一个中位数）', () => {
    // 比值在 0.5–2.5 之间乱走，没有固定倾向
    const sessions = repeat(40, (i) =>
      session({ plannedMs: 30 * MINUTE, actualMs: (0.5 + (i % 20) / 10) * 30 * MINUTE }),
    );
    const { preference, withheld } = inferEstimateBias(sessions);
    expect(preference).toBeNull();
    expect(withheld?.reason).toBe('not-stable-enough');
  });
});

describe('偏好层：P1 估算偏差', () => {
  it('稳定低估 1.8 倍 → 推断出 ~1.8 并说「低估」', () => {
    const sessions = repeat(30, (i) =>
      session({ plannedMs: 30 * MINUTE, actualMs: Math.round(54 * MINUTE), startedAt: NOW - i * DAY }),
    );
    const { preference } = inferEstimateBias(sessions);
    expect(preference?.value).toBeCloseTo(1.8, 1);
    expect(preference?.evidence).toContain('低估');
    expect(preference?.evidence).toContain('30 次');
  });

  it('估得很准时措辞是正面的，不是「低估 1.00 倍」', () => {
    const sessions = repeat(30, () => session({ plannedMs: 30 * MINUTE, actualMs: 30 * MINUTE }));
    const { preference } = inferEstimateBias(sessions);
    expect(preference?.evidence).toContain('很准');
    expect(preference?.evidence).not.toContain('低估');
  });

  it('没有 actualMs 的记录不参与（未完成的专注不算数）', () => {
    const sessions = repeat(30, (i) =>
      session({ plannedMs: 30 * MINUTE, actualMs: undefined, startedAt: NOW - i * DAY }),
    );
    const { withheld } = inferEstimateBias(sessions);
    expect(withheld?.reason).toBe('no-data');
  });

  it('plannedMs 为 0 不参与（避免除零）', () => {
    const sessions = repeat(30, () => session({ plannedMs: 0, actualMs: 30 * MINUTE }));
    expect(inferEstimateBias(sessions).withheld?.reason).toBe('no-data');
  });
});

describe('偏好层：P2 深度工作时段', () => {
  it('集中在本地 09:00 → 窗口覆盖 9 点', () => {
    const sessions = repeat(40, (i) =>
      session({ startedAt: LOCAL_MIDNIGHT + 9 * HOUR - i * DAY }),
    );
    const { preference } = inferDeepWorkWindow(sessions, TZ);
    const w = preference?.value;
    expect(w).toBeDefined();
    expect(w?.startHour).toBeLessThanOrEqual(9);
    expect(w && (9 >= w.startHour && 9 < w.endHour || w.endHour < w.startHour)).toBe(true);
  });

  it('🔴 跨午夜的窗口也能算（凌晨 1 点档不能算丢）', () => {
    const sessions = repeat(40, (i) =>
      session({ startedAt: LOCAL_MIDNIGHT + 1 * HOUR - i * DAY }),
    );
    const { preference } = inferDeepWorkWindow(sessions, TZ);
    expect(preference).not.toBeNull();
    // 1 点必须落在窗口内（窗口可能绕回，如 23:00–02:00）
    const w = preference?.value;
    const covered =
      w !== undefined && (w.endHour > w.startHour ? 1 >= w.startHour && 1 < w.endHour : 1 >= w.startHour || 1 < w.endHour);
    expect(covered).toBe(true);
  });

  it('休息时段不参与「深度工作」', () => {
    const breaks = repeat(40, (i) => session({ kind: 'shortBreak', startedAt: NOW - i * DAY }));
    expect(inferDeepWorkWindow(breaks, TZ).withheld?.reason).toBe('no-data');
  });

  it('时间很散 → not-stable-enough', () => {
    const sessions = repeat(40, (i) => session({ startedAt: LOCAL_MIDNIGHT + (i % 24) * HOUR }));
    expect(inferDeepWorkWindow(sessions, TZ).withheld?.reason).toBe('not-stable-enough');
  });
});

describe('偏好层：P3 提前量', () => {
  it('稳定提前 3 天 → 推断出 3 天', () => {
    const tasks = repeat(30, (i) =>
      task({ id: `t${i}`, dueDate: NOW + 10 * DAY, completedAt: NOW + 7 * DAY }),
    );
    const { preference } = inferLeadTime(tasks);
    expect(preference?.value).toBeCloseTo(3, 1);
    expect(preference?.evidence).toContain('提前 3 天');
  });

  it('逾期时措辞是「逾期」而不是负数', () => {
    const tasks = repeat(30, (i) =>
      task({ id: `t${i}`, dueDate: NOW, completedAt: NOW + 2 * DAY }),
    );
    const { preference } = inferLeadTime(tasks);
    expect(preference?.value).toBeLessThan(0);
    expect(preference?.evidence).toContain('逾期');
    expect(preference?.evidence).not.toContain('-2');
  });

  it('踩点完成（0 天）措辞单独处理', () => {
    const tasks = repeat(30, (i) => task({ id: `t${i}`, dueDate: NOW, completedAt: NOW }));
    expect(inferLeadTime(tasks).preference?.evidence).toContain('当天');
  });

  it('没有截止日期或未完成的任务不参与', () => {
    const tasks = repeat(30, (i) => task({ id: `t${i}`, dueDate: NOW }));
    expect(inferLeadTime(tasks).withheld?.reason).toBe('no-data');
  });

  it('已删除的任务不参与', () => {
    const tasks = repeat(30, (i) =>
      task({ id: `t${i}`, dueDate: NOW + 10 * DAY, completedAt: NOW + 7 * DAY, deletedAt: NOW }),
    );
    expect(inferLeadTime(tasks).withheld?.reason).toBe('no-data');
  });
});

describe('偏好层：P4 粒度', () => {
  it('清单项数解析：只认 `- [ ]` / `- [x]`，不认普通列表', () => {
    expect(countChecklistItems('- [ ] a\n- [x] b\n- [ ] c')).toBe(3);
    expect(countChecklistItems('- a\n- b')).toBe(0);
    expect(countChecklistItems('随便写点什么')).toBe(0);
    expect(countChecklistItems(undefined)).toBe(0);
    expect(countChecklistItems('* [ ] 星号也行')).toBe(1);
  });

  it('稳定 6 项 → 推断出 6', () => {
    const tasks = repeat(30, (i) =>
      task({ id: `t${i}`, note: repeat(6, (k) => `- [ ] ${k}`).join('\n') }),
    );
    const { preference } = inferGranularity(tasks);
    expect(preference?.value).toBe(6);
    expect(preference?.evidence).toContain('6 项');
  });

  it('🔴 没有清单的任务不进分母（否则中位数被拉到无意义的低位）', () => {
    // 10 条有 6 项 + 30 条没有清单 → 中位数应该是 6，不是被 0 拉低
    const withList = repeat(10, (i) =>
      task({ id: `a${i}`, note: repeat(6, (k) => `- [ ] ${k}`).join('\n') }),
    );
    const without = repeat(30, (i) => task({ id: `b${i}`, note: '就一句话' }));
    expect(inferGranularity([...withList, ...without]).preference?.value).toBe(6);
  });
});

describe('偏好层：P5 表达习惯', () => {
  it('全中文 + 固定长度 → 推断出「以中文为主」', () => {
    const tasks = repeat(30, (i) => task({ id: `t${i}`, title: '一二三四五六七八九十' }));
    const { preference } = inferTitleStyle(tasks);
    expect(preference?.value.cjkShare).toBe(1);
    expect(preference?.value.medianTitleLength).toBe(10);
    expect(preference?.evidence).toContain('以中文为主');
  });

  it('🔴 长度按**码点**算，emoji 不算两个字', () => {
    const tasks = repeat(30, (i) => task({ id: `t${i}`, title: '🎉🎉' }));
    const { preference } = inferTitleStyle(tasks);
    expect(preference?.value.medianTitleLength).toBe(2);
    expect(preference?.value.emojiShare).toBe(1);
    expect(preference?.evidence).toContain('emoji');
  });

  it('空标题不参与', () => {
    const tasks = repeat(30, (i) => task({ id: `t${i}`, title: '   ' }));
    expect(inferTitleStyle(tasks).withheld?.reason).toBe('no-data');
  });
});

describe('偏好层：统计工具', () => {
  it('medianOf 偶数个取中间两数的平均，奇数取中位', () => {
    expect(medianOf([1, 2, 3])).toBe(2);
    expect(medianOf([1, 2, 3, 4])).toBe(2.5);
    expect(medianOf([])).toBeNaN();
    expect(medianOf([5])).toBe(5);
  });

  it('medianOf 不修改入参数组', () => {
    const input = [3, 1, 2];
    medianOf(input);
    expect(input).toEqual([3, 1, 2]);
  });
});

describe('偏好层：总开关', () => {
  it('emptyPreferenceSet 默认是关闭状态', () => {
    expect(emptyPreferenceSet().memoryEnabled).toBe(false);
  });

  it('关闭时不产出任何偏好，也不产出 withheld（它不该解释自己）', () => {
    const set = inferPreferences({
      memoryEnabled: false,
      tasks: [task({ id: 'a' })],
      focusSessions: [session()],
      now: NOW,
      utcOffsetMinutes: TZ,
    });
    expect(set).toEqual(emptyPreferenceSet(false));
  });
});
