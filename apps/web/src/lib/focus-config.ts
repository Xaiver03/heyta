/**
 * 番茄钟时长设置的持久化与校验
 * ==============================
 *
 * ## 为什么需要这个文件
 *
 * `useFocusStore.setConfig()` 一直存在，但**零调用点** —— 于是时长永远是
 * 25/5/15，用户改不了。补 UI 时冒出两个必须在这里回答的问题，
 * 而不是留在组件里：
 *
 * 1. **改完刷新还在吗？** 不在的话，"设置"就是个假控件。
 * 2. **用户可以填 0 吗？填 99999 呢？**
 *
 * ## 为什么存 localStorage 而不是进 op-log
 *
 * 它是**设备本地的显示偏好**，不是用户数据：
 *
 * - 它不描述任何"用户做过什么"，只描述"这台机器上我想默认用多久"；
 * - 真正需要跨设备一致的东西已经跨设备了 —— 每完成一轮会写一条
 *   `FOCUS_SESSION`，那条**真的**进 op-log（`plannedMs` 是它的一部分）。
 *   所以在另一台设备上你会看到"这一轮做了 40 分钟"，即使那台机器的默认值还是 25。
 *
 * 这与 `theme.ts` / `locale.ts` 是同一类决定（见 `lib/theme.ts` 文件头）。
 * **不要因为"顺手"把它塞进 op-log** —— 那会给每个用户多加一条只在改设置时
 * 才产生、却要永久同步的 op，而我们换来的是"两台机器的默认时长一致"，
 * 这个收益没人要过。
 *
 * ## 为什么要夹取（clamp）而不是只校验
 *
 * 输入框里打得出 `0`、`-5`、`1e9`、空串。三种处理方式里：
 *
 * | 做法 | 后果 |
 * |---|---|
 * | 拒绝并报错 | 用户每打一个字都要弹一次错（受控输入的过程中必然经过空串） |
 * | 原样接受 | `0` 会让计时器**一开始就结束**，疯狂落盘垃圾 `FOCUS_SESSION` |
 * | **夹取到合法区间** | 打 `0` 停在 1，打 `999` 停在 180，无需解释 |
 *
 * 选夹取。**但夹取不等于静默**：组件在失焦时才写回，所以用户看得见自己被夹到哪。
 */

import { DEFAULT_FOCUS_CONFIG, type FocusConfig } from '@heyta/domain';

const STORAGE_KEY = 'heyta.focus-config';

/**
 * 每个字段的合法区间（**分钟**，除 `longBreakEvery` 是"几个专注"）。
 *
 * 上界不是随便定的：它必须小于"用户会以为计时器坏了"的那个量级。
 * 180 分钟的专注 = 3 小时，超过它更像误输入而不是真实需求；
 * 长休息上界 120 同理。下界 1 分钟是"一次可观察的专注"的最小值。
 */
export const FOCUS_CONFIG_BOUNDS = {
  workMinutes: { min: 1, max: 180 },
  shortBreakMinutes: { min: 1, max: 60 },
  longBreakMinutes: { min: 1, max: 120 },
  longBreakEvery: { min: 2, max: 12 },
} as const;

const MINUTE_MS = 60_000;

/** 面向前端/词条表的形状：分钟，而不是毫秒。 */
export interface FocusConfigDraft {
  workMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  longBreakEvery: number;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  // `Number.isInteger` 而不是 `isFinite`：`2.5` 个专注没有意义，
  // 而 `NaN` / `Infinity` 都要落到 fallback。
  if (typeof value !== 'number' || !Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/** 把任意输入夹取成一份合法草稿。**这是唯一的合法性判据。** */
export function clampFocusDraft(input: Partial<FocusConfigDraft>): FocusConfigDraft {
  const d = focusConfigToDraft(DEFAULT_FOCUS_CONFIG);
  return {
    workMinutes: clampInt(
      input.workMinutes,
      FOCUS_CONFIG_BOUNDS.workMinutes.min,
      FOCUS_CONFIG_BOUNDS.workMinutes.max,
      d.workMinutes,
    ),
    shortBreakMinutes: clampInt(
      input.shortBreakMinutes,
      FOCUS_CONFIG_BOUNDS.shortBreakMinutes.min,
      FOCUS_CONFIG_BOUNDS.shortBreakMinutes.max,
      d.shortBreakMinutes,
    ),
    longBreakMinutes: clampInt(
      input.longBreakMinutes,
      FOCUS_CONFIG_BOUNDS.longBreakMinutes.min,
      FOCUS_CONFIG_BOUNDS.longBreakMinutes.max,
      d.longBreakMinutes,
    ),
    longBreakEvery: clampInt(
      input.longBreakEvery,
      FOCUS_CONFIG_BOUNDS.longBreakEvery.min,
      FOCUS_CONFIG_BOUNDS.longBreakEvery.max,
      d.longBreakEvery,
    ),
  };
}

/** 领域层的 ms 形状 → 界面用的分钟形状。 */
export function focusConfigToDraft(config: FocusConfig): FocusConfigDraft {
  return {
    workMinutes: Math.round(config.workMs / MINUTE_MS),
    shortBreakMinutes: Math.round(config.shortBreakMs / MINUTE_MS),
    longBreakMinutes: Math.round(config.longBreakMs / MINUTE_MS),
    longBreakEvery: config.longBreakEvery,
  };
}

/** 界面用的分钟形状 → 领域层的 ms 形状（**先夹取**）。 */
export function draftToFocusConfig(draft: Partial<FocusConfigDraft>): FocusConfig {
  const safe = clampFocusDraft(draft);
  return {
    workMs: safe.workMinutes * MINUTE_MS,
    shortBreakMs: safe.shortBreakMinutes * MINUTE_MS,
    longBreakMs: safe.longBreakMinutes * MINUTE_MS,
    longBreakEvery: safe.longBreakEvery,
  };
}

/**
 * 读持久化的设置。
 *
 * 任何一处不合法（没有值 / 不是对象 / 字段类型不对 / 越界）都**逐字段回落**到
 * 默认值，而不是整份丢弃 —— 丢掉整份会让用户改了"专注 40 分钟"之后，
 * 因为另一个字段被别的东西写坏而一起回到 25。
 *
 * 读失败不抛：隐私模式下 `localStorage` 会直接抛错（与 `theme.ts` 同一处理）。
 */
export function loadFocusConfig(): FocusConfig {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return DEFAULT_FOCUS_CONFIG;
  }
  if (raw === null) return DEFAULT_FOCUS_CONFIG;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_FOCUS_CONFIG;
  }
  if (typeof parsed !== 'object' || parsed === null) return DEFAULT_FOCUS_CONFIG;

  return draftToFocusConfig(parsed as Partial<FocusConfigDraft>);
}

/** 写持久化的设置（**先夹取**，所以永远不会把非法值写进去）。 */
export function saveFocusConfig(config: FocusConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(focusConfigToDraft(config)));
  } catch {
    // 存不上不影响本次生效 —— 与 `theme.ts` 同一处理。
  }
}

/** 仅供测试：清掉持久化的设置，让下一条用例从默认值开始。 */
export function __clearFocusConfigForTests(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 测试环境里 localStorage 一定在；这里只是与上面保持同一种防御姿态。
  }
}
