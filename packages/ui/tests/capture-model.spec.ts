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

import { Priority, dueDateToEpoch, localDateTimeToEpoch, parseCapture, type CaptureExclusion, type CaptureField } from '@heyta/domain';
import { describe, expect, it } from 'vitest';

import {
  captureCanSubmit,
  captureCapsuleShowsWord,
  captureDue,
  captureFragmentSignature,
  captureOverrideValid,
  captureSelectedProject,
  clearCaptureDue,
  makeCaptureOverride,
  withCaptureProject,
  captureChipAction,
  captureChipKey,
  captureChipRemainingDays,
  captureChipTimeLabel,
  capturePriorityLabelKey,
  captureDuePanelTitle,
  captureRowChips,
  parseCaptureDraft,
  shouldResetCaptureIgnore,
  toAiCaptureSubmitPlan,
  toCaptureChips,
  toCaptureSubmitPlan,
  toggleCaptureIgnore,
  type CaptureChip,
  type CaptureSubmitPlan,
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

describe('R14 时刻芯片：`captureChipTimeLabel` 是宿主唯一的那道口子', () => {
  it('🔴 时刻芯片念 `HH:MM` 本身，**不掉进优先级兜底念成「不设置」**', () => {
    const chips = toCaptureChips(parsed('明天16:00 交周报'));
    expect(chips.map((c) => c.field)).toEqual(['dueDate', 'dueTime']);
    expect(captureChipTimeLabel(chips[1]!)).toBe('16:00');
    expect(chips[1]!.dueTime).toBe('16:00');
    // 另外两类芯片必须返回 `undefined`，否则宿主那条 `if` 会把日期/优先级也吃掉。
    expect(captureChipTimeLabel(chips[0]!)).toBeUndefined();
    const priority = toCaptureChips(parsed('交周报 !1'))[0]!;
    expect(priority.field).toBe('priority');
    expect(captureChipTimeLabel(priority)).toBeUndefined();
  });

  it('归一化后的值进标签，原文进 `raw`：`明天9:05` 念成 `09:05`', () => {
    const chip = toCaptureChips(parsed('明天9:05 打卡'))[1]!;
    expect(chip.raw).toBe('9:05');
    expect(captureChipTimeLabel(chip)).toBe('09:05');
  });

  it('未采纳的第二条时刻也是芯片（它**还在标题里**，标签照样念得出值）', () => {
    const chips = toCaptureChips(parsed('明天 09:30-10:30 对齐'));
    expect(chips.filter((c) => c.field === 'dueTime').map((c) => c.action)).toEqual([
      'ignore',
      'unused',
    ]);
    expect(captureChipTimeLabel(chips[2]!)).toBe('10:30');
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

  it('🔴 R14：`明天16:00` 的 epoch 落在**本地 16:00**，不是零点', () => {
    const plan = toCaptureSubmitPlan(parsed('明天16:00 交周报'));
    const due = new Date(plan!.dueDate!);
    expect([due.getFullYear(), due.getMonth() + 1, due.getDate()]).toEqual([2026, 9, 29]);
    expect([due.getHours(), due.getMinutes()]).toEqual([16, 0]);
    // 反向对照：同一天不带时刻**确实**是零点。少了这一条，上面那条可能只是
    // "epoch 恰好不等于零点"在打分。
    expect(new Date(dueDateToEpoch('2026-09-29')).getHours()).toBe(0);
  });

  it('🔴 R14：裸时刻不许借锚点成立（锚点补的是日期，不是"日期 + 时刻"的许可）', () => {
    const plan = toCaptureSubmitPlan(parsed('16:00 交周报'), '2026-10-08');
    const due = new Date(plan!.dueDate!);
    expect([due.getFullYear(), due.getMonth() + 1, due.getDate()]).toEqual([2026, 10, 8]);
    expect(due.getHours(), '时刻没被采纳，锚点那天必须还是零点').toBe(0);
    expect(plan!.title).toBe('16:00 交周报');
  });

  it('标题为空 → `undefined`（调用方据此不提交）', () => {
    expect(toCaptureSubmitPlan(parsed('明天'))).toBeUndefined();
  });

  // ── R11 批五：锚点日（"说一句话落进选中那一格"）───────────────────
  it('🔴 有锚点、输入里没写日期 ⇒ 落在**锚点那一天**', () => {
    const plan = toCaptureSubmitPlan(parsed('交周报'), '2026-10-08');
    const due = new Date(plan!.dueDate!);
    expect([due.getFullYear(), due.getMonth() + 1, due.getDate()]).toEqual([2026, 10, 8]);
    expect(due.getHours()).toBe(0);
  });

  it('🔴 输入里写了日期 ⇒ **输入的赢**，锚点只是兜底', () => {
    // 反过来（锚点赢）会得到"在日历上选了 8 号，于是'明天'永远说不进去"——
    // 那一格就变成了一个吞掉日期语义的开关。
    const plan = toCaptureSubmitPlan(parsed('明天交周报'), '2026-10-08');
    const due = new Date(plan!.dueDate!);
    expect([due.getFullYear(), due.getMonth() + 1, due.getDate()]).toEqual([2026, 9, 29]);
  });

  it('没给锚点时行为与批五之前**逐字相同**（不带 `dueDate` 这个键）', () => {
    const plan = toCaptureSubmitPlan(parsed('交周报'), undefined);
    expect(Object.prototype.hasOwnProperty.call(plan, 'dueDate')).toBe(false);
  });

  it('🔴 锚点不许把**空标题**救成可提交（"选了格子输入一个明天"仍然不该建任务）', () => {
    expect(toCaptureSubmitPlan(parsed('明天'), '2026-10-08')).toBeUndefined();
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

describe('G. 落点：把选中的清单并进计划（`withCaptureProject`）', () => {
  /** 一条不带任何可选键的计划，作为这组的起点。 */
  const base: CaptureSubmitPlan = { title: '写周报' };

  it('选了哪一份就带哪一份，且不动已有的键', () => {
    expect(withCaptureProject({ ...base, priority: Priority.Low }, 'p-1')).toEqual({
      title: '写周报',
      priority: Priority.Low,
      projectId: 'p-1',
    });
  });

  it('`null` / `undefined` / 空串都写成**不带这个键**，而不是带一个 `undefined`', () => {
    // 与 `toCaptureSubmitPlan` 对 `dueDate` 同一条约定：省略与显式空在动作层
    // 是两种语义（`NewTaskFields.projectId` 省略 = 收集箱）。
    for (const empty of [null, undefined, '']) {
      const plan = withCaptureProject({ ...base }, empty);
      expect(Object.prototype.hasOwnProperty.call(plan, 'projectId')).toBe(false);
    }
  });

  it('不复制入参以外的一切：返回的是新对象，原计划不被改写', () => {
    const frozen = { ...base };
    const next = withCaptureProject(frozen, 'p-2');
    expect(next).not.toBe(frozen);
    expect(frozen.projectId).toBeUndefined();
  });
});

describe('H. 落点：那一行此刻该念谁的名字（`captureSelectedProject`）', () => {
  const options = [
    { id: 'p-1', name: '本机清单' },
    { id: 'p-2', name: '共享清单' },
  ] as const;
  const picker = (destinationId: string | null) => ({
    options,
    destinationId,
    onSelect: () => {},
    labels: {
      title: '',
      inbox: '',
      current: (name: string) => name,
      currentInbox: '',
      optionAria: (name: string) => name,
      inboxAria: '',
    },
  });

  it('没选 ⇒ `undefined`（= 收集箱）；选了 ⇒ 在册那一枚', () => {
    expect(captureSelectedProject(picker(null))).toBeUndefined();
    expect(captureSelectedProject(picker('p-2'))?.name).toBe('共享清单');
  });

  it('选中的那一枚已经不在册 ⇒ 也回退成收集箱', () => {
    // 面板开着的时候另一台设备把那份清单删了。提交与那一行的标题共用这一枚
    // 查询，所以不会出现"界面念着落进 X、东西却建进收集箱"。
    expect(captureSelectedProject(picker('p-gone'))).toBeUndefined();
  });

  it('宿主没给选择器（web 的内联捕获器）⇒ `undefined`，不炸', () => {
    expect(captureSelectedProject(undefined)).toBeUndefined();
  });
});

/* ========================================================================
 * G. 手工覆盖（日期胶囊）—— 计划 §3.4 五条契约逐条钉
 *   1 打字产出的解析值 = 胶囊默认值
 *   2 点面板 = 覆盖，但**不删字**
 *   3 清除 = 覆盖清空 **且原文回到标题**
 *   4 覆盖绑在"被消费的片段"上，片段变了就作废
 *   5 优先级不参与覆盖
 * ====================================================================== */

describe('G. 手工覆盖：胶囊的值从哪来（覆盖 → 解析 → 锚点 → 没有）', () => {
  /** 与 `parsed()` 同一个 `NOW`，但忽略清单允许 `dueTime`。 */
  function g(input: string, exclude: readonly CaptureExclusion[] = []) {
    return parseCapture(input, { now: NOW, exclude });
  }
  function ymd(plan: CaptureSubmitPlan | undefined): [number, number, number, number] {
    const d = new Date(plan!.dueDate!);
    return [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours()];
  }

  it('契约 1｜没覆盖时，胶囊读到的就是打字解析出来的值', () => {
    const q = g('今天下午八点交周报');
    expect(captureDue(q, undefined)).toEqual({
      date: q.dueDate,
      time: q.dueTime,
      source: 'parsed',
    });
  });

  it('🔴 签名只数**被消费的日期/时刻**：不含优先级，也不含未采纳的那条', () => {
    const sig = captureFragmentSignature(g('今天下午八点交周报 !1')).split('|');
    expect(sig).toHaveLength(2);
    expect(sig.some((s) => s.startsWith('dueDate@'))).toBe(true);
    expect(sig.some((s) => s.startsWith('dueTime@'))).toBe(true);
    expect(sig.join(' ')).not.toContain('priority');
    // 「今天 明天」里第二条未采纳 —— 它还在标题里，没有东西被拿走，不许进签名
    expect(captureFragmentSignature(g('今天 明天 交周报')).split('|')).toHaveLength(1);
  });

  it('契约 2｜点面板 = 覆盖解析值，但那段字**仍然被消费**（标题里没有它）', () => {
    const q = g('明天交周报');
    const ov = makeCaptureOverride('2026-10-08', undefined, captureFragmentSignature(q));
    expect(captureDue(q, ov)).toEqual({ date: '2026-10-08', time: undefined, source: 'override' });
    const plan = toCaptureSubmitPlan(q, undefined, ov);
    expect(plan!.title, '覆盖不许把字送回标题 —— 那是清除的语义').toBe('交周报');
    expect(ymd(plan)).toEqual([2026, 10, 8, 0]);
  });

  it('🔴 契约 3｜清除 = 覆盖清空 **且被消费的那段字回到标题**', () => {
    const q = g('明天交周报');
    const cleared = clearCaptureDue(q, []);
    expect(cleared.override).toBeUndefined();
    const after = g('明天交周报', cleared.exclusions);
    expect(after.title).toBe('明天交周报');
    expect(after.dueDate).toBeUndefined();
    const plan = toCaptureSubmitPlan(after, undefined, cleared.override);
    expect(plan!.title).toBe('明天交周报');
    expect(Object.prototype.hasOwnProperty.call(plan, 'dueDate')).toBe(false);
  });

  it('🔴 清除把日期与时刻**一起**放开（漏一个就留下"字没了、值也没了"）', () => {
    const q = g('今天下午八点交周报');
    const { exclusions } = clearCaptureDue(q, []);
    expect(exclusions.map((e) => e.field).sort()).toEqual(['dueDate', 'dueTime']);
    expect(g('今天下午八点交周报', exclusions).title).toBe('今天下午八点交周报');
  });

  it('清除**不重复追加**已登记的忽略（否则恢复要两击）', () => {
    const q = g('明天交周报');
    const once = clearCaptureDue(q, []);
    // 🔴 先证"它真的登记了东西"：少了这一行，一次"什么都不追加"的退化实现
    // 也能让下面那条相等断言绿（变异取证实测过：那次红的是别的两臂）。
    expect(once.exclusions).toEqual([{ field: 'dueDate', raw: '明天' }]);
    expect(clearCaptureDue(q, once.exclusions).exclusions).toEqual(once.exclusions);
  });

  it('契约 4｜重打了日期短语 ⇒ 签名变 ⇒ 覆盖作废 ⇒ 打字产出的值接管', () => {
    const ov = makeCaptureOverride(
      '2026-10-08',
      undefined,
      captureFragmentSignature(g('明天交周报')),
    );
    const due = captureDue(g('下周一交周报'), ov);
    expect(due.source).toBe('parsed');
    expect(due.date).toBe(g('下周一交周报').dueDate);
  });

  it('⚠️ 契约 4 的对称代价（登记成决策，不是事故）：删掉那段日期文字 ⇒ 手工选的日期一起作废', () => {
    const ov = makeCaptureOverride(
      '2026-10-08',
      undefined,
      captureFragmentSignature(g('明天交周报')),
    );
    // 此刻没有任何被消费的文字要交代，而留一条"来源看不见"的日期更难解释。
    expect(captureDue(g('交周报'), ov)).toEqual({
      date: undefined,
      time: undefined,
      source: 'none',
    });
  });

  it('锚点那一档：没打字、没覆盖 ⇒ 来源是 anchor，且**不带时刻**', () => {
    expect(captureDue(g('交周报'), undefined, '2026-10-08')).toEqual({
      date: '2026-10-08',
      time: undefined,
      source: 'anchor',
    });
  });

  it('覆盖赢锚点（用户在面板里点了那一天，锚点只是兜底）', () => {
    const q = g('交周报');
    const ov = makeCaptureOverride('2026-10-12', undefined, captureFragmentSignature(q));
    expect(captureDue(q, ov, '2026-10-08').date).toBe('2026-10-12');
  });

  it('🔴 输入里只有裸时刻（没被采纳）⇒ 手工选日期**不把它捎上**', () => {
    const q = g('16:00 交周报');
    const ov = makeCaptureOverride(
      '2026-10-08',
      captureDue(q, undefined).time,
      captureFragmentSignature(q),
    );
    const plan = toCaptureSubmitPlan(q, undefined, ov);
    expect(ymd(plan)).toEqual([2026, 10, 8, 0]);
    expect(plan!.title, '裸时刻没被采纳，必须还留在标题里').toBe('16:00 交周报');
  });

  it('契约 5｜覆盖只管截止，优先级仍走解析', () => {
    const q = g('明天交周报 !1');
    const ov = makeCaptureOverride('2026-10-08', undefined, captureFragmentSignature(q));
    expect(toCaptureSubmitPlan(q, undefined, ov)?.priority).toBe(Priority.High);
  });

  it('不传 override ⇒ 换算仍走 parsed 那一对（既有调用方零行为变化）', () => {
    const q = g('今天下午八点交周报');
    expect(toCaptureSubmitPlan(q)?.dueDate).toBe(dueDateToEpoch(q.dueDate!, q.dueTime));
  });

  it('captureOverrideValid 只认签名相等（覆盖态没有第三种"半有效"）', () => {
    const ov = makeCaptureOverride('2026-10-08', undefined, 'a');
    expect(captureOverrideValid(ov, 'a')).toBe(true);
    expect(captureOverrideValid(ov, 'b')).toBe(false);
    expect(captureOverrideValid(undefined, 'a')).toBe(false);
  });
});

/* ========================================================================
 * H. 胶囊的分档：什么时候说相对词、什么时候必须说日期
 *   （2026-11-04 由 e2e 抓到：日历落点里点「下周一」，胶囊念的是「还剩 5 天」)
 * ====================================================================== */

describe('H. captureCapsuleShowsWord：哪一天不能省', () => {
  it('今天 / 明天 / 后天 ⇒ 说相对词（这三个词比日期亲切，也没有歧义）', () => {
    expect(captureCapsuleShowsWord(0)).toBe(true);
    expect(captureCapsuleShowsWord(1)).toBe(true);
    expect(captureCapsuleShowsWord(2)).toBe(true);
  });

  it('🔴 逾期仍然说相对词（「已逾期 3 天」比一个过去的日期更有用）', () => {
    expect(captureCapsuleShowsWord(-1)).toBe(true);
    expect(captureCapsuleShowsWord(-30)).toBe(true);
  });

  it('🔴 第 3 天起必须说日期 —— 「还剩 5 天」省掉的正是唯一致命的信息', () => {
    expect(captureCapsuleShowsWord(3)).toBe(false);
    expect(captureCapsuleShowsWord(5)).toBe(false);
    expect(captureCapsuleShowsWord(365)).toBe(false);
  });
});

/**
 * 🔴 I. 五条契约的**组合格**：句子被"忽略过"或"未采纳过"之后，覆盖还按不按契约走。
 *
 * 上面 G 组把五条契约各自钉了一遍，但每一例的输入都是**干净的句子** ——
 * 而真实操作顺序里最常见的是"先把那段字点掉，再手工选一天"。
 * 这一族补的就是这个交叉：`exclude` 与 `override` **同时在场**（现量：补之前
 * `grep -c "exclude.*override\|override.*exclude"` 在 G 组里 0 命中）。
 *
 * 为什么值得单独一族：签名 `captureFragmentSignature` 只数**被消费**的那几条，
 * 所以"忽略过"的句子签名会是**空串**。空串是不是一个合法的绑定对象，
 * 决定的是"用户点掉那段字之后还能不能手工选日子"——
 * 那是一件能悄悄坏掉而五条契约各自都不会红的事。
 */
describe('I. 覆盖 × 忽略 / 未采纳：五条契约的交叉格', () => {
  function x(input: string, exclude: readonly CaptureExclusion[] = []) {
    return parseCapture(input, { now: NOW, exclude });
  }
  /**
   * ⚠️ 必须用**本地**读法（与 G 组那个 `ymd` 同一口径）。
   * 走 `toISOString()` 会把本地零点换算成 UTC 时刻，东八区那档直接差一天 ——
   * 一条"跨过一次时区就红"的断言是测试自己埋的定时炸弹，不是产品缺陷。
   */
  function day(epoch: number): [number, number] {
    const d = new Date(epoch);
    return [d.getMonth() + 1, d.getDate()];
  }

  it('🔴 先点掉「明天」再手工选 10-08 ⇒ 覆盖仍生效（空签名也绑得住），那段字原样留在标题里', () => {
    const q = x('明天交周报', [{ field: 'dueDate', raw: '明天' }]);
    // 前置：这段句子里**没有**被消费的日期了 —— 签名是空串，不是"没签名"
    expect(captureFragmentSignature(q)).toBe('');
    expect(q.dueDate, '忽略过的那条不该还产出日期').toBeUndefined();

    const ov = makeCaptureOverride('2026-10-08', undefined, captureFragmentSignature(q));
    expect(captureOverrideValid(ov, captureFragmentSignature(q)), '空签名不该让手工选择作废').toBe(true);
    expect(captureDue(q, ov)).toEqual({ date: '2026-10-08', time: undefined, source: 'override' });

    const plan = toCaptureSubmitPlan(q, undefined, ov);
    expect(plan!.title, '字是用户自己点掉的，手工选日子不许把它塞回去，也不许把它吞掉').toBe('明天交周报');
    expect(day(plan!.dueDate!)).toEqual([10, 8]);
  });

  it('🔴 点掉之后又打出新的日期短语 ⇒ 签名从空串变成有值 ⇒ 那次手工作废（契约 4 在忽略过的句子上同样成立）', () => {
    const ov = makeCaptureOverride('2026-10-08', undefined, '');
    const q = x('下周一交周报', [{ field: 'dueDate', raw: '明天' }]);
    expect(captureFragmentSignature(q), '这句里「下周一」是被消费的，签名不该还是空串').not.toBe('');
    expect(captureDue(q, ov).source).toBe('parsed');
    expect(captureDue(q, ov).date).toBe(q.dueDate);
  });

  it('🔴 同字段第二条未采纳 + 手工覆盖 ⇒ 覆盖赢，第二条仍在标题里（不变量 3 与契约 2 同时成立）', () => {
    const q = x('今天 明天 交周报');
    const ov = makeCaptureOverride('2026-10-08', '21:00', captureFragmentSignature(q));
    expect(captureDue(q, ov)).toEqual({ date: '2026-10-08', time: '21:00', source: 'override' });
    const plan = toCaptureSubmitPlan(q, undefined, ov);
    expect(plan!.title, '未采纳的那条不许因为用户手工选过日子就被吞掉').toContain('明天');
    // 第一条（「今天」）是**被消费**的那条：它该从标题里拿走，值由覆盖说（不变量 3 的另一半）。
    expect(plan!.title).not.toContain('今天');
    expect(day(plan!.dueDate!)).toEqual([10, 8]);
  });

  it('🔴 点掉「!1」再手工选日子 ⇒ 优先级仍不许从覆盖里冒出来（契约 5 在忽略过的句子上同样成立）', () => {
    const q = x('明天交周报 !1', [{ field: 'priority', raw: '!1' }]);
    const ov = makeCaptureOverride('2026-10-08', undefined, captureFragmentSignature(q));
    const plan = toCaptureSubmitPlan(q, undefined, ov);
    expect(plan!.priority, '覆盖只管截止；用户已经点掉的优先级不许回来').toBeUndefined();
    expect(plan!.title).toContain('!1');
    expect(day(plan!.dueDate!)).toEqual([10, 8]);
  });
});

/**
 * 🔴 J. S2 那半句"删掉框下芯片行"的**前提**，钉成测试而不是留在计划里当一个数。
 *
 * 计划 §9.10 / §9.13 拍的是"那一行改成条件挂载"，理由是"那一行的独占内容只有优先级"。
 * 那句话一旦漂了，决策的依据就漂了。
 *
 * ⚠️ 但我第一版把这一族写成了**六个句子各测一遍差集**，那是一把永远红不了的尺：
 * 面板那一组和那一行都是按 `chip.field` 过滤**同一个** `toCaptureChips()` 返回值，
 * 而 `CaptureField` 只有 `dueDate | dueTime | priority` 三个成员 ⇒
 * 差集**按构造**只可能是 priority，跟句子里写了什么无关。 §9.10 那四行读数
 * 看着像"逐句实测"，其实是这一条类型的推论 —— 实测没有增加任何信息。
 *
 * 所以这一族只留**三枚会红的钉子**，各自封住推论的一个前提：
 *   ① 类型钉子 `COVERED_BY_PANEL`：`CaptureField` 多一个成员（比如以后加 `tag`），
 *      `Record<CaptureField, …>` 当场编译不过，逼回来重答"面板收不收它"；
 *   ② 优先级确实还在**那一行**被说出来（它没有别的家）—— 见「反向半边」那条；
 *   ③ 未采用 / 已忽略确实**在面板里也有**（所以那一行对它俩是重复，不是承重墙）；
 *   面板那半边的谓词本身由 `scripts/check-capture-shape.mjs` 的 `checkPanelDueGroup`
 *   钉住 —— 这一族的 ① 只保证"字段清单没变"，保证不了"面板没改口径"。
 */
describe('J. S2 决策的前提：框下那一行的独占内容只有优先级', () => {
  /**
   * 每个识别字段"面板那一组收不收"。**这一张表就是 §9.10 那个差集的全部前提**：
   * 它写成 `Record<CaptureField, boolean>`，于是解析器多认一类字段时这里必须表态，
   * 不表态就编译不过（`pnpm typecheck` 红），而不是让那条散文结论继续吃旧读数。
   */
  const COVERED_BY_PANEL: Record<CaptureField, boolean> = {
    dueDate: true,
    dueTime: true,
    priority: false,
  };

  /** 面板里"文字里读到的日期"那一组：口径就是上面那张表（生产侧同一判断见 `CaptureComposer.tsx` 的 `dueChips`）。 */
  const panelDueKeys = (input: string, exclude: readonly CaptureExclusion[] = []) =>
    new Set(
      toCaptureChips(parseCapture(input, { now: NOW, exclude }))
        .filter((chip) => COVERED_BY_PANEL[chip.field])
        .map((chip) => chip.key),
    );

  it('🔴 反向半边：优先级确实是那一行**唯一**还独占的东西（不是"恰好这批句子里没有"）', () => {
    const parsed2 = parseCapture('明天交周报 !1', { now: NOW });
    const unique = captureRowChips(parsed2).filter((chip) => !panelDueKeys('明天交周报 !1').has(chip.key));
    expect(unique.map((chip) => `${chip.field}:${chip.action}`), '优先级必须仍在那一行里被说出来').toEqual(['priority:ignore']);
    expect(Object.keys(COVERED_BY_PANEL).filter((f) => !COVERED_BY_PANEL[f as CaptureField]), '独占的就是这一类，别扩').toEqual(['priority']);
  });

  it('🔴 截止类的"未采用 / 已忽略"两档**不再**是那一行的独占内容（它们的面板那一组里有）', () => {
    const unused = parseCapture('今天 明天 交周报', { now: NOW });
    expect(captureRowChips(unused).some((chip) => chip.action === 'unused'), '未采用的那条仍要在界面上可见').toBe(true);
    const ignored = parseCapture('明天交周报', { now: NOW, exclude: [{ field: 'dueDate', raw: '明天' }] });
    const ignoredChip = toCaptureChips(ignored).find((chip) => chip.action === 'restore');
    expect(ignoredChip, '已忽略的那条要还在芯片集合里').toBeDefined();
    // 它落在面板那一组里 ⇒ 于是**不**是那一行的独占内容（§9.10 差集的这一半）
    expect(panelDueKeys('明天交周报', [{ field: 'dueDate', raw: '明天' }]).has(ignoredChip!.key)).toBe(true);
  });
});

describe('外壳标题该说什么（`captureDuePanelTitle`）—— 判断在共享层，措辞由宿主给', () => {
  const LABELS = {
    staticTitle: '选择截止日期',
    withDraft: (draft: string) => `给「${draft}」选截止日期`,
  };
  // 分母是这条判断的全部形状：空、纯空白、有内容（前后带空白）、内容本身像空白词。
  const cases: readonly (readonly [string, string, string])[] = [
    ['', '选择截止日期', '没打字不许塞一对空引号进标题'],
    ['   ', '选择截止日期', '纯空白算没打字'],
    ['\n\t ', '选择截止日期', '换行与制表同样是空白'],
    ['明天交周报', '给「明天交周报」选截止日期', '整句原文进标题，不截不猜'],
    ['  review notes ', '给「review notes」选截止日期', '两端空白去掉，中间保留'],
    ['明天', '给「明天」选截止日期', '只打了一个日期词也是"正在改的那句话"'],
  ];
  it.each(cases)('%s ⇒ %s（%s）', (subject, want, why) => {
    expect(captureDuePanelTitle(LABELS, subject), why).toBe(want);
  });
  it('反向钉子：标题里不许出现「未设置」这类审计腔，也不许出现空引号「」', () => {
    for (const subject of ['', '  ', '\n', 'x']) {
      const title = captureDuePanelTitle(LABELS, subject);
      expect(title).not.toContain('未设置');
      expect(title).not.toContain('「」');
    }
  });
});
