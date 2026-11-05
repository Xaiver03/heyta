/**
 * 时刻步进与草稿提交（共享，**不 import react-native**）
 * ======================================================
 *
 * 单独一个文件只有一个理由：这两条规则必须能被 `packages/ui` 的 **node** 单测直接跑穿。
 * `DatePicker.tsx` 与 `CaptureDuePanel.tsx` 都 import RN 原语，node 环境解析不了它们，
 * 规则写在里面就等于**没有判据的规则**（AGENTS.md §6 第 2 条：不能失败的检查没有价值）。
 *
 * 🔴 为什么"什么时候算一个合法时刻"只许有一处：
 * `DatePicker` 原来自己写着"没到 `HH:MM` 的形状不提交，失焦回落到已提交的值"。
 * 捕获面板也要这一条，如果它再抄一遍，就会出现"同一串字在一个地方提交、在另一个地方不提交"
 * —— 而两端各自绿。所以现在两边都调这里这一个函数。
 */

import { parseLocalTime, type LocalTime } from '@heyta/domain';

/**
 * 一天里的步进时刻槽。
 *
 * 步数由调用方给（滴答那一档是 30 分钟）。`stepMinutes` 不整除一天时**不画最后那一格**
 * —— 07:00 那种"到 23:59 还差一个尾巴"的列表会让人以为最后一个时间就是夜里。
 */
export function timeStepSlots(stepMinutes: number): LocalTime[] {
  if (stepMinutes <= 0 || 1440 % stepMinutes !== 0) return [];
  const slots: LocalTime[] = [];
  for (let minutes = 0; minutes < 1440; minutes += stepMinutes) {
    const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
    const mm = String(minutes % 60).padStart(2, '0');
    slots.push(`${hh}:${mm}` as LocalTime);
  }
  return slots;
}

/**
 * 输入框里此刻的草稿能不能算一个已提交的时刻。
 *
 * · 空串 → `undefined`（= 清掉时刻，回到"全天"）；
 * · 不是 `HH:MM` 的形状 → 原样退回 `committed`（**界面不许撒谎说"16:"是个时刻**，
 *   也不许半截值写进 op —— 那是替用户猜时间）；
 * · 合法 → 返回**归一化后的 `HH:MM`**（`parseLocalTime` 负责归一化）。
 */
export function timeDraftToValue(text: string, committed: LocalTime | undefined): LocalTime | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  const parsed = parseLocalTime(trimmed);
  return parsed ?? committed;
}
