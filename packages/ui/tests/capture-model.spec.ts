/**
 * 快速捕捉（共享模型）单测
 * ==========================
 *
 * M3 第八刀（capture）。测的是 `packages/ui/src/capture/model.ts` 里**所有有判断的地方** ——
 * 组件里因此没有分支，不需要靠快照测试兜（与 `quadrant-model.spec.ts` / `habits-model.spec.ts`
 * 同一约定）。
 *
 * 🔴 这里**不 import `@heyta/i18n`，也不 import `react-native`**（node 环境解析不了后者）——
 * 这顺带证明"共享 model 必须宿主无关"这条边界真的成立。
 *
 * ⚠️ 断言尽量跑**真实的 `@heyta/domain#parseCapture`**，而不是手捏 `CaptureParse`：
 * 本模型的价值就是"把领域层的输出投影正确"，手捏数据会把投影与解析的接缝测丢。
 */

import { Priority, localDateTimeToEpoch, parseCapture } from '@heyta/domain';
import { describe, expect, it } from 'vitest';

import {
  captureCanSubmit,
  captureChipAction,
  captureChipKey,
  captureChipRemainingDays,
  capturePriorityLabelKey,
  parseCaptureDraft,
  shouldResetCaptureIgnore,
  toAiCaptureSubmitPlan,
  toCaptureChips,
  toCaptureSubmitPlan,
  toggleCaptureIgnore,
  type CaptureChip,
} from '../src/capture/model.js';

/** 确定的"现在"：2026-09-28 12:00（本地）。**不读墙上时钟。** */
const NOW = new Date(2026, 8, 28, 12, 0, 0).getTime();

function parsed(input: string, exclude: { field: 'dueDate' | 'priority'; raw: string }[] = []) {
  return parseCapture(input, { now: NOW, exclude });
}

function chipOf(input: string, index: number): CaptureChip {
  return toCaptureChips(parsed(input))[index]!;
}

describe('A. 识别结果 → 芯片：顺序与三态', () => {
  it('芯片顺序 = 领域层 `matches` 的顺序（用户在输入里就是从从左到右读的）', () => {
    const p = parsed('明天交周报 !1');
    const chips = toCaptureChips(p);
    expect(chips.map((c) => c.raw)).toEqual(p.matches.map((m) => m.raw));
    expect(chips.map((c) => c.field)).toEqual(['dueDate', 'priority']);
  });

  it('生效中的两条都是 `ignore`（可以逐条取消）', () => {
    const chips = toCaptureChips(parsed('明天交周报 !1'));
    expect(chips.map((c) => c.action)).toEqual(['ignore', 'ignore']);
  });

  it('🔴 同一字段出现两次：第二条是 `unused`（它**还在标题里**，且没有按钮）', () => {
    const chips = toCaptureChips(parsed('今天 明天 交周报'));
    expect(chips).toHaveLength(2);
    expect(chips[0]!.action).toBe('ignore');
    expect(chips[1]!.action).toBe('unused');
    // 第二条仍然带着领域层给的 display —— 界面要能说清"它是哪一天"
    expect(chips[1]!.display).toBe('2026-09-29');
  });

  it('🔴 用户显式忽略过的那条是 `restore`（点它 = 重新纳入解析）', () => {
    const chips = toCaptureChips(parsed('明天交周报', [{ field: 'dueDate', raw: '明天' }]));
    expect(chips[0]!.action).toBe('restore');
  });

  it('`captureChipAction` 对两个布尔穷尽：rejected 优先于 applied', () => {
    // rejected 与 applied 理论上互斥，但判定顺序必须是"先看 rejected"——
    // 否则一条既被忽略又被标成 applied 的记录会渲染成"可以取消"（语义反了）。
    expect(
      captureChipAction({
        field: 'dueDate',
        raw: '明天',
        start: 0,
        end: 2,
        display: '2026-09-29',
        applied: false,
        rejected: true,
      }),
    ).toBe('restore');
    expect(
      captureChipAction({
        field: 'dueDate',
        raw: '明天',
        start: 0,
        end: 2,
        display: '2026-09-29',
        applied: true,
        rejected: false,
      }),
    ).toBe('ignore');
    expect(
      captureChipAction({
        field: 'dueDate',
        raw: '明天',
        start: 0,
        end: 2,
        display: '2026-09-29',
        applied: false,
        rejected: false,
      }),
    ).toBe('unused');
  });

  it('芯片 key 稳定且互不相同：同一个 raw 出现在两个下标也算两条', () => {
    const chips = toCaptureChips(parsed('明天 明天 交周报'));
    expect(new Set(chips.map((c) => c.key)).size).toBe(chips.length);
  });

  it('`captureChipKey` 用的是 field + start + raw（不按下标，也不只用 raw）', () => {
    const p = parsed('明天 明天 交周报');
    const a = captureChipKey(p.matches[0]!);
    const b = captureChipKey(p.matches[1]!);
    expect(a).not.toBe(b);
    expect(a).toContain('dueDate');
    expect(a).toContain('明天');
  });
});

describe('B. 草稿：空标题不许提交', () => {
  it('只输入"明天"→ 标题为空 → 不许提交', () => {
    expect(captureCanSubmit(parsed('明天'))).toBe(false);
  });

  it('去掉识别片段之后还有字 → 可以提交', () => {
    expect(captureCanSubmit(parsed('明天交周报'))).toBe(true);
  });

  it('🔴 只有空白也不算：`trim` 之后为空就是空', () => {
    // 造一个"识别之后只剩空格"的输入：用 hint 匹配不到的纯空格。
    expect(captureCanSubmit(parseCaptureDraft('   ', []))).toBe(false);
  });

  it('`parseCaptureDraft` 把"现在"显式传下去（不读墙上时钟）', () => {
    // 同一天在 NOW 下是"今天"，在 NOW+2 天时是"已逾期"——标题与 dueDate 都不变，
    // 但 matches 里的 display 会跟着"今天"变。这里只钉"传下去"这件事。
    const a = parseCaptureDraft('明天交周报', [], NOW);
    expect(a.dueDate).toBe('2026-09-29');
  });
});

describe('C. 忽略清单：按 field + raw 增删，绝不按下标、绝不动草稿', () => {
  it('`ignore` 态 → 追加一条', () => {
    const chip = chipOf('明天交周报', 0);
    expect(toggleCaptureIgnore([], chip)).toEqual([{ field: 'dueDate', raw: '明天' }]);
  });

  it('`restore` 态 → 删掉那一条', () => {
    const p = parsed('明天交周报', [{ field: 'dueDate', raw: '明天' }]);
    const chip = toCaptureChips(p)[0]!;
    expect(chip.action).toBe('restore');
    expect(
      toggleCaptureIgnore([{ field: 'dueDate', raw: '明天' }], chip),
    ).toEqual([]);
  });

  it('🔴 同一次输入里两处相同的 raw 会被一起忽略（领域层定的口径，这里是它的可见后果）', () => {
    const list = toggleCaptureIgnore([], chipOf('明天 明天 交周报', 0));
    // 第二条（`unused`）没有按钮，所以不会走这条；但把同 raw 的一条恢复会同时清掉两条：
    const restoreChip: CaptureChip = { ...chipOf('明天 明天 交周报', 1), action: 'restore' };
    expect(toggleCaptureIgnore(list, restoreChip)).toEqual([]);
  });

  it('不同 field 的同名 raw 互不影响', () => {
    const list = [{ field: 'dueDate' as const, raw: '明天' }];
    const priorityChip: CaptureChip = {
      key: 'priority-0-明天',
      raw: '明天',
      field: 'priority',
      display: '高',
      action: 'restore',
    };
    expect(toggleCaptureIgnore(list, priorityChip)).toEqual(list);
  });

  it('`shouldResetCaptureIgnore`：清单非空才需要清（空清单清一次是空动作）', () => {
    expect(shouldResetCaptureIgnore([])).toBe(false);
    expect(shouldResetCaptureIgnore([{ field: 'dueDate', raw: '明天' }])).toBe(true);
  });
});

describe('D. 剩余天数：由共享层算（措辞归宿主）', () => {
  it('明天 = 1、今天 = 0、昨天 = -1', () => {
    expect(captureChipRemainingDays(chipOf('明天交周报', 0), NOW)).toBe(1);
    expect(captureChipRemainingDays(chipOf('今天交周报', 0), NOW)).toBe(0);
    expect(captureChipRemainingDays(chipOf('昨天交周报', 0), NOW)).toBe(-1);
  });

  it('优先级芯片没有剩余天数', () => {
    expect(captureChipRemainingDays(chipOf('交周报 !1', 0), NOW)).toBeUndefined();
  });

  it('🔴 `unused` 的日期芯片**也带** `dueDate`（实测：领域层给每个解析成功的匹配都填值）', () => {
    const unused = toCaptureChips(parsed('今天 明天 交周报'))[1]!;
    // ⚠️ `CaptureMatch.dueDate` 的注释写的是"且被采纳时存在"，实测**不是**：
    //    `packages/domain/src/capture.ts` 的 `matches.map` 对每个 `c` 都填了
    //    `...(c.dueDate !== undefined ? { dueDate: c.dueDate } : {})`。
    //    所以"未采用"的日期芯片**能**显示确切日期（这对用户更重要 ——
    //    他要确认的是"系统把'明天'理解成了哪一天"）。
    expect(unused.action).toBe('unused');
    expect(unused.dueDate).toBe('2026-09-29');
    expect(captureChipRemainingDays(unused, NOW)).toBe(1);
  });
});

describe('E. 提交计划：本地日期 → Task 约定（epoch ms，本地零点）', () => {
  it('规则解析：标题 + 优先级 + 本地零点', () => {
    const plan = toCaptureSubmitPlan(parsed('明天交周报 !1'));
    expect(plan?.title).toBe('交周报');
    expect(plan?.priority).toBe(Priority.High);
    const due = new Date(plan!.dueDate!);
    expect(due.getFullYear()).toBe(2026);
    expect(due.getMonth()).toBe(8);
    expect(due.getDate()).toBe(29);
    expect(due.getHours()).toBe(0);
    expect(due.getMinutes()).toBe(0);
  });

  it('没解析出截止时间就**不带这个字段**（不是带一个 undefined）', () => {
    const plan = toCaptureSubmitPlan(parsed('交周报 !1'));
    expect(plan).not.toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(plan, 'dueDate')).toBe(false);
  });

  it('标题为空 → `undefined`（调用方据此不提交）', () => {
    expect(toCaptureSubmitPlan(parsed('明天'))).toBeUndefined();
  });

  it('AI 字段走**同一张计划**：合法本地日期时间串换算成 epoch', () => {
    const plan = toAiCaptureSubmitPlan({
      title: '交周报',
      dueDate: '2026-09-29T08:30:00',
      priority: Priority.High,
    });
    expect(plan.title).toBe('交周报');
    expect(plan.priority).toBe(Priority.High);
    expect(plan.dueDate).toBe(localDateTimeToEpoch('2026-09-29T08:30:00'));
  });

  it('🔴 模型给了不存在的日期 → **当作没给**（宁可少一个截止时间，也不要静默错位）', () => {
    const plan = toAiCaptureSubmitPlan({ title: '交周报', dueDate: '不是日期' });
    expect(Object.prototype.hasOwnProperty.call(plan, 'dueDate')).toBe(false);
  });

  it('AI 字段没有日期 → 不带 dueDate', () => {
    const plan = toAiCaptureSubmitPlan({ title: '交周报', priority: Priority.Low });
    expect(Object.prototype.hasOwnProperty.call(plan, 'dueDate')).toBe(false);
    expect(plan.priority).toBe(Priority.Low);
  });
});

describe('F. 优先级 → 词条 key（只导出 key，不导出文案）', () => {
  it('四个优先级各有 key，且两两不同', () => {
    const keys = [
      capturePriorityLabelKey(Priority.High),
      capturePriorityLabelKey(Priority.Medium),
      capturePriorityLabelKey(Priority.Low),
      capturePriorityLabelKey(Priority.None),
    ];
    expect(new Set(keys).size).toBe(4);
    for (const key of keys) expect(key.startsWith('web.capture.priority.')).toBe(true);
  });

  it('`undefined` 按 `None` 处理（与迁移前 `priorityLabel[m.priority ?? None]` 同口径）', () => {
    expect(capturePriorityLabelKey(undefined)).toBe(capturePriorityLabelKey(Priority.None));
  });
});
