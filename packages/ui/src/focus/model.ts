/**
 * 专注（番茄钟）的共享视图模型
 * ==============================
 *
 * M3 第二刀：web 与 mobile 的番茄钟**界面各写了一份** —— 同一份状态机
 *（`@heyta/domain` 的 `focus.ts`）之上，两端各自算"还剩多久 / 进度多少 /
 * 该显示什么"，而两份算法之间的差异**不会让任何测试变红**，只会让
 * "网页的环走完了、手机的还差一点"（`focus.ts` 里已经为此写过一条注释）。
 *
 * 所以这一层的职责只有一条：**把领域层的输出拼成界面要的形状，且只拼一次。**
 *
 * 🔴 本文件**不 import `react-native`**，也不 import 任何 React ——
 * `packages/ui` 的单测跑在 node 环境里（`vitest.config.ts` 文件头说明了理由），
 * 而 node 解析不了 RN 的 Flow 源码。把"有判断"的部分留在这里，
 * 组件那一侧就只剩下"把值摆到原语上"。
 *
 * 🔴 也不在这里做格式化以外的计算：剩余时间、进度、显示时长**全部**
 * 来自 `@heyta/domain`。这里若自己写 `phase === 'idle' ? 0 : remaining`，
 * 就是把 `focusDisplayMs` 的判据抄了第二遍 —— 那正是本层要消灭的东西。
 */

import {
  focusDisplayMs,
  focusDurationMs,
  focusProgress,
  formatDuration,
  remainingMs,
  type FocusConfig,
  type FocusSessionKind,
  type FocusState,
} from '@heyta/domain';

/**
 * 类型选择的顺序。专注在前 —— 它是默认，也是绝大多数时候要点的那个。
 *
 * 放在共享层而不是各端各自的数组：顺序是**产品语义**（"哪个是默认"），
 * 两端各写一份的话，某天只改了一端就会出现"手机上短暂休息在第一个"。
 */
export const FOCUS_KIND_ORDER = [
  'work',
  'shortBreak',
  'longBreak',
] as const satisfies readonly FocusSessionKind[];

/**
 * 计时色语义：工作段 / 休息段。
 *
 * ⚠️ 是**语义名**，不是外观名（AGENTS.md §5）。具体颜色由 token 决定
 * （`color.focus-work` / `color.focus-break`），组件不写色值。
 */
export type FocusTone = 'work' | 'break';

/** 主按钮此刻要执行的动作。由状态机当前处于哪个 phase 决定，不由各端各判一次。 */
export type FocusPrimaryAction = 'start' | 'pause' | 'resume';

export interface FocusViewModel {
  /** 界面要显示的毫秒数（空闲时是**本轮计划时长**，不是 0 —— 见 `focusDisplayMs`）。 */
  readonly displayMs: number;
  /** 距本轮到时的剩余毫秒。 */
  readonly remainingMs: number;
  /** 进度 0–1，供进度环使用。 */
  readonly progress: number;
  /** 进度的百分数（已四舍五入），供无障碍名使用。 */
  readonly percent: number;
  readonly tone: FocusTone;
  readonly running: boolean;
  readonly paused: boolean;
  readonly idle: boolean;
}

/** 当前轮属于工作段还是休息段。 */
export function focusTone(state: FocusState): FocusTone {
  return state.kind === 'work' ? 'work' : 'break';
}

/**
 * 主按钮此刻该做什么。
 *
 * 🔴 这一条**必须在共享层**：原 web 端写的是"没在跑就调 `start()`"，
 * 而 `start()` 会把 `remainingMsOnPause` 清掉、按完整时长重排 ——
 * 于是"暂停 → 开始"实际是**重新开始**。store 里的 `resume()` 因此
 * 一直没有调用点（和 `setConfig` 曾经的情况一模一样）。
 * 两端口径不同时，这种差异不会报错，只会让一端悄悄丢掉已走过的进度。
 */
export function focusPrimaryAction(state: FocusState): FocusPrimaryAction {
  if (state.phase === 'running') return 'pause';
  if (state.phase === 'paused') return 'resume';
  return 'start';
}

/** 把领域状态拼成界面形状。`now` 由宿主提供（重绘节拍只负责换这个值）。 */
export function toFocusViewModel(state: FocusState, now: number): FocusViewModel {
  const progress = focusProgress(state, now);
  return {
    displayMs: focusDisplayMs(state, now),
    remainingMs: remainingMs(state, now),
    progress,
    percent: Math.round(progress * 100),
    tone: focusTone(state),
    running: state.phase === 'running',
    paused: state.phase === 'paused',
    idle: state.phase === 'idle',
  };
}

/** `MM:SS`。格式化同样只有这一处 —— `ceil` 的理由见 `focus.ts` 的 `formatDuration`。 */
export function focusDisplayText(state: FocusState, now: number): string {
  return formatDuration(focusDisplayMs(state, now));
}

/** 某一轮的**计划**时长（ms）。"哪种类型多少分钟"的映射在领域层，不在这。 */
export function focusRoundLengthMs(kind: FocusSessionKind, config: FocusConfig): number {
  return focusDurationMs(kind, config);
}

/* ========================================================================
 * 专注记录**写入校验失败**：码 → 共用词条 key
 * ====================================================================== */

/**
 * 校验失败码 → 词条 key（**唯一一份**）。
 *
 * 形状照 `packages/ui/src/auth/model.ts`：这里**不 import `@heyta/i18n`**
 * （会拖进第二份 React，见该文件头），也不 import `@heyta/app-host`
 * （会给 `packages/ui` 加一个它现在没有的依赖）。码按**字符串**收，
 * key 的正确性由宿主侧 `t()` 的 `MessageKey` 类型在编译期校验。
 *
 * 生产者在那一侧：`packages/app-host/src/focus-actions.ts` 的
 * `FocusLogValidationError` / `focusLogFailureCode()`。
 * 🔴 两边一起改 —— 那里加一条码，这里必须加一项，否则界面落到兜底句，
 * 而兜底句不带那条码的具体原因（用户只知道"没保存上"）。
 */
export type FocusLogFailureMessageKey =
  | 'common.focus.error.unknownKind'
  | 'common.focus.error.nonPositivePlanned'
  | 'common.focus.error.missingCreatedAt';

/**
 * 码 → key。
 *
 * ⚠️ **查不到回 `undefined` 而不是兜到某一条**：调用方的 `catch` 收到的
 * 大多数异常**不是**校验失败（派发失败、存储写不进去、计时器给了脏值），
 * 那些情况该说的是那句通用的「保存失败：{reason}」，而不是硬编成
 * "类型不认识"。这与 `syncFailureMessageKey` 同形，与
 * `authFailureMessageKey`（封闭集合、必须有落点）**不同形**，区别就在这里：
 * 认证那边拿的是一个**已知的**失败原因，这边拿的是一个**未知的**异常。
 */
const FOCUS_LOG_FAILURE_MESSAGE_KEY: Record<string, FocusLogFailureMessageKey> = {
  'unknown-kind': 'common.focus.error.unknownKind',
  'non-positive-planned-ms': 'common.focus.error.nonPositivePlanned',
  'missing-created-at': 'common.focus.error.missingCreatedAt',
};

/** 校验失败码 → 共用词条 key；不是校验失败就回 `undefined`。 */
export function focusLogFailureMessageKey(
  code: string | undefined,
): FocusLogFailureMessageKey | undefined {
  return code === undefined ? undefined : FOCUS_LOG_FAILURE_MESSAGE_KEY[code];
}
