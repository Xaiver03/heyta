/**
 * 提醒档位的**文案接线**（web 壳）
 * ==================================
 *
 * 与 `apps/mobile/src/lib/reminders-display.ts` 是同一层的东西：领域层只给数字，
 * "这一档叫什么"由各宿主映射到自己的词条 —— 因为共享层（`@heyta/ui`）
 * **刻意不 import i18n**。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 为什么 web 要**多一个文件**而不是直接用 `REMINDER_OFFSET_PRESETS_MS`
 *
 * 短档位（`reminder.offset.*`）是共享组件 `ReminderList` 的**下标契约**，
 * 两端各有一份 key 数组。W9 ① 加的四个长档位（2 天 / 3 天 / 1 周 / 30 天）
 * 走的是**另一个数组** `REMINDER_LONG_OFFSET_PRESETS_MS`，而它是 web 先用的
 * （移动端没这个键的词条，硬并进短数组会让移动端一打开提醒面板就抛 ——
 * 那个 `default: throw` 是故意的）。
 *
 * 于是这里必须有一个**和 `offsetMessageKey` 同形状**的兜底：
 * `longOffsetMessageKey` 的 `default` 分支直接抛。
 * 它防的是"领域层加了一档、这里忘了补 key" —— 那种漂移的症状不是报错，
 * 而是 `labels.offsets[i]` 与 `presets[i]` **错位**：按钮写着"提前 3 天"、
 * 点下去建的是"提前 1 周"。跳过或返回空串都会让这个错位成为可能，
 * 所以抛错（判据：`apps/web/tests/reminder-tiers.spec.tsx`）。
 * ─────────────────────────────────────────────────────────────────────────
 */

import type { MessageKey } from '@heyta/i18n';
import { REMINDER_LONG_OFFSET_PRESETS_MS } from '@heyta/domain';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * 一个长档位 → 它的词条 key。
 *
 * ⚠️ 键名里的 `2d` / `3d` / `1w` / `30d` 是**契约的一部分**：文案写"提前 3 天"，
 * 宿主就必须建"截止前 3 个日历日"。与 `reminder.absolute.1h` 同一条纪律。
 */
export function longOffsetMessageKey(offsetMs: number): MessageKey {
  switch (offsetMs) {
    case 2 * DAY_MS:
      return 'web.reminder.offset.2d';
    case 3 * DAY_MS:
      return 'web.reminder.offset.3d';
    case 7 * DAY_MS:
      return 'web.reminder.offset.1w';
    case 30 * DAY_MS:
      return 'web.reminder.offset.30d';
    default:
      throw new Error(
        `长档位 ${String(offsetMs)} 没有对应的词条 key —— ` +
          'REMINDER_LONG_OFFSET_PRESETS_MS 与 web.reminder.offset.* 已经漂移，' +
          '请同时补上词条与本函数的映射。',
      );
  }
}

/** 长档位 → key，**顺序与 `REMINDER_LONG_OFFSET_PRESETS_MS` 逐项一致**（导出给判据对账）。 */
export function reminderLongOffsetKeys(): readonly MessageKey[] {
  return REMINDER_LONG_OFFSET_PRESETS_MS.map(longOffsetMessageKey);
}

/** 一档长提前量：数字 + 已经翻译好的标签，**成对产出**。 */
export interface ReminderLongTier {
  readonly offsetMs: number;
  readonly label: string;
}

/**
 * 渲染用的高级档位。
 *
 * 🔴 由**数字映射出文案**（而不是 `presets[i]` 配 `labels[i]`）：按下标配两个
 * 数组时，长度一旦不同就静默错位 —— 按钮写着"提前 3 天"、点下去建"提前 1 周"。
 * 这里没有下标可错，拿不到的那一档直接经 `longOffsetMessageKey` 抛。
 */
export function reminderLongTiers(
  t: (key: MessageKey) => string,
): readonly ReminderLongTier[] {
  return REMINDER_LONG_OFFSET_PRESETS_MS.map((offsetMs) => ({
    offsetMs,
    label: t(longOffsetMessageKey(offsetMs)),
  }));
}

/** 这一组档位的小标题（"更早"那一排上面那行字）。 */
export const REMINDER_LONG_TIER_LABEL_KEY: MessageKey = 'web.reminder.offset.groupLabel';
