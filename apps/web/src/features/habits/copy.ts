/**
 * 习惯的措辞拼装（Web 壳）
 * ==========================
 *
 * 与 `../categories/copy.ts` 同一个位置：**句子在这里拼，不在 JSX 里拼**。
 * 两个理由：
 *
 *   1. `check:ui-language` 只认「字面量紧跟 `t(`」的形状，
 *      放进 JSX 的三元里就会变成它看不见的第三种写法；
 *   2. 同一句话现在被**两个地方**要：右窗格（共享 `HabitBoard` 的 `labels`）
 *      与左列的每一行（数字 chip 的 `title`）。留在 `HabitsView.tsx` 里
 *      就得 export 给 `HabitsList.tsx`，而后者又被前者 import —— 一个没必要的循环。
 *
 * 🔴 词条表没有 ICU。连续 1 天时英文必须走单数兄弟词条
 * （"Streak 1 days" 是一眼可见的坏句子），三个数字各自分支，
 * 因为它们完全可能一个是 1、另一个不是。
 */

import type { I18nValue } from '@heyta/i18n';

type TFn = I18nValue['t'];

export function currentStreakText(count: number, t: TFn): string {
  return count === 1
    ? t('web.habits.streak.currentOne', { count })
    : t('web.habits.streak.current', { count });
}

export function longestStreakText(count: number, t: TFn): string {
  return count === 1
    ? t('web.habits.streak.longestOne', { count })
    : t('web.habits.streak.longest', { count });
}

export function totalCheckInText(count: number, t: TFn): string {
  return count === 1
    ? t('web.habits.streak.totalOne', { count })
    : t('web.habits.streak.total', { count });
}

/** 打卡按钮的无障碍名："撤销今日打卡" / "为它打卡" 是两句话，各自成词条。 */
export function checkInLabel(name: string, doneToday: boolean, t: TFn): string {
  return doneToday
    ? t('web.habits.a11y.undo', { name })
    : t('web.habits.a11y.checkIn', { name });
}
