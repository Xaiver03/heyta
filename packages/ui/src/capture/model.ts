/**
 * 快速捕捉（共享模型）
 * ======================
 *
 * M3 第八刀（capture）的**判断层**：识别结果 → 一行行"芯片"该长什么样、
 * 哪一条能取消 / 哪一条只能标"未采用"、用户点了一下之后忽略清单怎么变、
 * 以及**提交时给 Task 的字段怎么换算**。组件里因此没有分支，
 * 不需要靠快照测试兜（与 `quadrant/model.ts` / `habits/model.ts` 同一约定）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 解析本身一条都不在这里重写
 *
 * 「什么算日期」「什么算优先级」「同一字段出现两次谁生效」全部来自
 * `@heyta/domain` 的 `parseCapture`（含它文件头那条不变量：**每一个被移除的
 * 片段都对应一条 `applied: true` 的记录**）。这里只做四件**展示 / 交互**的事：
 *
 *   1. 把 `CaptureParse.matches` 投影成一组稳定的"芯片"（判定
 *      `ignore` / `restore` / `unused` 三态之一）；
 *   2. 决定"标题去掉识别片段后为空就不许提交"（交互决策，不是数据决策）；
 *   3. 忽略清单的**增删语义**（按 `field + raw`，**不按下标** —— 下标会随
 *      用户继续打字而失效）；
 *   4. 提交前把本地日期换算成 `Task.dueDate` 约定的 epoch ms。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 本文件**不 import `react-native`，也不 import `@heyta/i18n`**
 *
 * 前者：`packages/ui/vitest.config.ts` 跑在 **node** 环境，`react-native`
 * 是 Flow 源码，node 解析不了它。后者：i18n 包自己带过一份 React，
 * 四端会同时中招（见 `TaskList.tsx` 文件头）。文案一律由宿主注入 ——
 * 需要词条的地方只导出**key**（见 {@link CapturePriorityLabelKey}），
 * 与 `sync/model.ts` 的 `SyncFailureMessageKey` 同一个先例。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 没装进共享层的（逐条写清：证据 + 影响 + 最小一步）
 *
 * 1. **"还剩几天"的措辞**（`web.capture.*` 之外的 `remainingText` /
 *    `dateWithRemaining`）留在各端。天数由本文件算（`captureChipRemainingDays`
 *    → `@heyta/domain#diffDays`），但**说法**与括号正字法属于各端 i18n
 *    （`packages/i18n` 依赖不了，而 `apps/mobile` 的措辞本来就是同构而不是同一份）。
 *    · 影响：同一天数在两端可以写成两句不同的话 —— 这正是
 *      `apps/web/src/lib/due-display.ts` 文件头承认的既有取舍，本轮不动。
 *    · 最小一步：把 `web.due.*` 的措辞搬进共享层？不行 —— 那要先解决
 *      "共享层不能 import i18n"。正确的一步是在 i18n 包加一个**纯函数**
 *      入口（不带 React），四端共取。这要动 `packages/i18n`（别人的地盘）。
 *
 * 2. **提交到 op-log 的那一步**（`addTask`）留在宿主。判据是 AGENTS.md §3.5：
 *    "这段代码里有没有任何一行在决定业务上该怎么做？" 本文件只产出
 *    `{ title, dueDate?, priority? }` 这个**纯数据**，写库由宿主的 action 层做。
 *
 * 3. **AI 一句话捕获面板**（`AiCapture`）留在 web。它是 `apps/web/src/features/ai/**`
 *    的 DOM 实现，且 `apps/mobile` 没有 AI（P8 的移动端阻塞在宿主 SecretStore，
 *    不在 UI）。共享层给的是 `renderAssistant` **插槽**，不是那份面板本身。
 *    · 影响：mobile 本轮（以及可预见的几轮）只有确定性捕获。
 *    · 最小一步：M3 `ai` 的"流程型面板族"落地后，把披露块 + 候选行接进这个插槽。
 *
 * 4. **输入框的交互降级**：web 迁移前用 `.ht-input` 的 CSS（`:hover` /
 *    `:focus-visible` 换边框色），共享层是 RN `TextInput`，RN 没有 hover。
 *    · 影响：web 捕获输入框不再有悬停变色（焦点态仍在，靠平台默认）。
 *      这是"RN 原语换 DOM"的必然落差，与计划 §「已知会卡住的地方」最后一行同一类。
 *    · 最小一步：在组件里用 `onFocus`/`onBlur` 状态表达焦点，需要产品先定"焦点环怎么画"。
 */

import {
  Priority,
  diffDays,
  dueDateToEpoch,
  localDateTimeToEpoch,
  parseCapture,
  today,
  type CaptureExclusion,
  type CaptureField,
  type CaptureMatch,
  type CaptureParse,
  type LocalDate,
} from '@heyta/domain';

/* ========================================================================
 * 一、识别结果 → 芯片
 * ====================================================================== */

/**
 * 一条芯片上那个按钮的语义。三态**互斥且穷尽**（对应 `CaptureMatch` 的两个布尔）。
 *
 *   · `ignore`  —— 这条**生效中**（已从标题移除），点它 = 改成不生效
 *   · `restore` —— 用户之前忽略了它，点它 = 重新纳入解析
 *   · `unused`  —— 同字段已有更早的一条被采纳，**它还在标题里**，没有按钮
 */
export type CaptureChipAction = 'ignore' | 'restore' | 'unused';

/** 一条渲染就绪的芯片。**判断全在上面那个类型里**，组件只负责摆。 */
export interface CaptureChip {
  /**
   * 稳定的 React key。
   *
   * 用 `field + start + raw` 而不是数组下标：输入一变就会重排，
   * 下标会让 React 复用错的那一个（表现为输入时芯片内容闪错）。
   */
  readonly key: string;
  /** 匹配到的原文片段，**原样**（用户打的是什么就显示什么）。 */
  readonly raw: string;
  readonly field: CaptureField;
  /** 领域层给的人类可读解析结果（例如 `2026-09-26`）。 */
  readonly display: string;
  /** 领域层解析出的截止日期。**`applied: false` 的匹配也可能带值**（实测
   *  `@heyta/domain#parseCapture` 对每个解析成功的匹配都填 `dueDate`，
   *  与 `CaptureMatch.dueDate` 的注释"且被采纳时存在"不符 —— 那是注释漂移，
   *  已如实登记在本刀汇报里）。 */
  readonly dueDate?: LocalDate;
  /** 领域层解析出的优先级。同 {@link CaptureChip.dueDate}：未被采纳也可能带值。 */
  readonly priority?: Priority;
  /** 这一条该显示哪种操作。 */
  readonly action: CaptureChipAction;
}

/** `CaptureMatch` 的两个布尔 → 穷尽的三态。**唯一的一处判定。** */
export function captureChipAction(match: CaptureMatch): CaptureChipAction {
  if (match.rejected) return 'restore';
  if (match.applied) return 'ignore';
  return 'unused';
}

/** 芯片 key。抽成函数是为了让"key 怎么来的"与测试里的期望同源。 */
export function captureChipKey(match: CaptureMatch): string {
  return `${match.field}-${String(match.start)}-${match.raw}`;
}

/**
 * 解析结果 → 芯片列表。**顺序就是领域层给的 `matches` 顺序**（按 `start` 升序）,
 * 这里不重排：芯片的左右顺序必须与用户在输入里看到的从左到右一致。
 */
export function toCaptureChips(parsed: CaptureParse): CaptureChip[] {
  return parsed.matches.map((match) => ({
    key: captureChipKey(match),
    raw: match.raw,
    field: match.field,
    display: match.display,
    ...(match.dueDate !== undefined ? { dueDate: match.dueDate } : {}),
    ...(match.priority !== undefined ? { priority: match.priority } : {}),
    action: captureChipAction(match),
  }));
}

/* ========================================================================
 * 二、草稿 / 忽略清单
 * ====================================================================== */

/** 调 `@heyta/domain` 的 `parseCapture`，把"时间源"显式化（不读墙上时钟）。 */
export function parseCaptureDraft(
  input: string,
  exclude: readonly CaptureExclusion[],
  now?: number,
): CaptureParse {
  return parseCapture(input, now === undefined ? { exclude } : { exclude, now });
}

/**
 * 去掉识别片段之后的标题**非空**才算一个任务。只输入"明天"不算。
 *
 * 🔴 这是**交互**决策（见 `CaptureParse.title` 的注释），所以它在这里，
 * 而不是在领域层：领域层对空标题不抛错（它的调用方是程序而不是人）。
 */
export function captureCanSubmit(parsed: CaptureParse): boolean {
  return parsed.title.trim() !== '';
}

/**
 * 输入框变了 → 旧的忽略清单可能已经指向不存在的文字，必须清掉。
 *
 * 为什么是"整个清掉"而不是"过滤掉失效项"：`exclude` 按 `field + raw` 匹配，
 * 而"某段 raw 还在不在输入里"要再跑一次正则才能知道 —— 那等于把解析
 * 跑第二遍，且与领域层的规则永远可能差一点。清掉是**保守且可解释**的：
 * 用户改字之后重新识别一次，最坏是多看见一条已经不会误报的识别。
 */
export function shouldResetCaptureIgnore(exclusions: readonly CaptureExclusion[]): boolean {
  return exclusions.length > 0;
}

/**
 * 点一条芯片上的按钮 → 新的忽略清单。
 *
 * 🔴 **按 `field + raw` 比对，不按下标**（`@heyta/domain#CaptureOptions.exclude`
 * 的文件头写了理由）。所以同一个输入里两处相同的"明天"会被一起忽略 ——
 * 这个代价可接受，而且它是**可见的**（两处都会变成"已忽略"）。
 */
export function toggleCaptureIgnore(
  exclusions: readonly CaptureExclusion[],
  chip: CaptureChip,
): CaptureExclusion[] {
  if (chip.action === 'restore') {
    return exclusions.filter((e) => !(e.field === chip.field && e.raw === chip.raw));
  }
  return [...exclusions, { field: chip.field, raw: chip.raw }];
}

/* ========================================================================
 * 三、提交计划（本地日期 → Task 约定）
 * ====================================================================== */

/**
 * 交给宿主 action 层的**纯数据**。⚠️ 不是 op，也不是 `Task`。
 *
 * `dueDate` 是 epoch ms（本地零点），与 `Task.dueDate` 同一个约定；
 * 换算在共享层做完，宿主不再各写一次（两处换算 = 两套时区语义）。
 */
export interface CaptureSubmitPlan {
  readonly title: string;
  readonly dueDate?: number;
  readonly priority?: Priority;
}

/**
 * 规则解析的提交计划。标题为空 → `undefined`（调用方据此禁用按钮 / 不提交）。
 *
 * `dueDate` 走 `@heyta/domain#dueDateToEpoch`（本地日历日 → 本地零点）；
 * 没解析出截止时间就**不带这个字段**，而不是带一个 `undefined`。
 *
 * 🔴 `anchor`（R11 批五："在选中的那一格上直接说一句话"）的优先级是刻意的：
 *   **输入里写出来的日期赢，锚点只是兜底**。反过来（锚点赢）会得到
 *   "在日历上选了 8 号，于是'明天'永远说不进去" —— 那等于把这一格
 *   变成了一个吞掉日期语义的开关。所以顺序是
 *   `解析出的 → 锚点 → 不带这个字段`。
 */
export function toCaptureSubmitPlan(
  parsed: CaptureParse,
  anchor?: LocalDate,
): CaptureSubmitPlan | undefined {
  if (!captureCanSubmit(parsed)) return undefined;
  const dueDate = parsed.dueDate ?? anchor;
  return {
    title: parsed.title,
    ...(dueDate !== undefined ? { dueDate: dueDateToEpoch(dueDate) } : {}),
    ...(parsed.priority !== undefined ? { priority: parsed.priority } : {}),
  };
}

/** AI 面板确认后交给宿主的字段（与 `AiCapture` 的 `onApply` 同形）。 */
export interface CaptureAiFields {
  readonly title: string;
  /** 本地日期时间串（`YYYY-MM-DD` 或 `YYYY-MM-DDTHH:mm:ss`）。**未做时区转换。** */
  readonly dueDate?: string | undefined;
  readonly priority?: Priority | undefined;
}

/**
 * AI 字段 → 提交计划。
 *
 * 🔴 与规则那条走**同一张 `CaptureSubmitPlan`**，所以"AI 建的任务"和
 * "回车建的任务"在数据上没有任何区别（AI 没有旁路）。
 *
 * ⚠️ 换算失败（模型给了不存在的日期）**当作没给** —— 宁可少一个截止时间，
 * 也不要一个静默错位的日期。`localDateTimeToEpoch` 对非法输入返回 `undefined`。
 *
 * ⚠️ 这里**不**判空标题：迁移前的 `applyCapture` 也没有判（`AiCapture`
 * 自己先 `if (title === '') return`）。加一条新判断属于产品改动，不在这两刀范围。
 */
export function toAiCaptureSubmitPlan(fields: CaptureAiFields): CaptureSubmitPlan {
  const due = fields.dueDate === undefined ? undefined : localDateTimeToEpoch(fields.dueDate);
  return {
    title: fields.title,
    ...(due !== undefined ? { dueDate: due } : {}),
    ...(fields.priority !== undefined ? { priority: fields.priority } : {}),
  };
}

/* ========================================================================
 * 四、交给宿主的"读法"
 * ====================================================================== */

/**
 * 日期芯片的剩余天数（`今天` 为 0，明天为 1，逾期为负）。
 *
 * 🔴 天数由**这里**算（`@heyta/domain#diffDays` + `today`），宿主只负责
 * 把它说成当前语言。迁移前这一步写在 web 组件里 —— 那就是"同一个日期
 * 在两端可以差一天"的种子（移动端真的踩过，见
 * `apps/web/src/lib/due-display.ts` 文件头）。没有 `dueDate` 的芯片返回 `undefined`。
 */
export function captureChipRemainingDays(
  chip: CaptureChip,
  now: number,
): number | undefined {
  if (chip.dueDate === undefined) return undefined;
  return diffDays(today(now), chip.dueDate);
}

/**
 * 优先级 → 词条 key。
 *
 * ⚠️ 这几条是 **`web.capture.*`** 前缀，而移动端也要用它 —— 与第七刀
 * （habits）"复用 `web.habits.*`，零新增同义键"同一个处置：加键要动
 * `packages/i18n`，那是另一条 lane 的地盘。
 */
export type CapturePriorityLabelKey =
  | 'web.capture.priority.high'
  | 'web.capture.priority.medium'
  | 'web.capture.priority.low'
  | 'web.capture.priority.none';

const CAPTURE_PRIORITY_LABEL_KEY: Record<Priority, CapturePriorityLabelKey> = {
  [Priority.High]: 'web.capture.priority.high',
  [Priority.Medium]: 'web.capture.priority.medium',
  [Priority.Low]: 'web.capture.priority.low',
  [Priority.None]: 'web.capture.priority.none',
};

/** 优先级 → 该优先级的词条 key。`undefined` 按 `None` 处理（迁移前的口径）。 */
export function capturePriorityLabelKey(priority: Priority | undefined): CapturePriorityLabelKey {
  return CAPTURE_PRIORITY_LABEL_KEY[priority ?? Priority.None];
}
