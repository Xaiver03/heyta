/**
 * 习惯图标：闭集 key → 字形 / 词条
 * ==================================
 *
 * 🔴 **这里是 web 这半张表**（key → `lucide-react` **组件** + key → 词条）。
 * 2026-10-01 起，共享层也有一张：`packages/ui/src/habits/HabitProgressList.tsx`
 * 里的 `HABIT_GLYPHS` 把同样的 key 配给 `lucide` 的**图标数据**，由 `HeytaIcon`
 * 在 RN 上画 —— 移动端清单用的就是它。两张表**必须配得一样**，
 * 判据是 `tests/habits-list-pane.spec.tsx` 的 F 组（读两边源码逐对比）。
 * 症状如果不钉住：同一个习惯，手机上水滴、web 上月亮，而两边都不报错。
 *
 * ## 为什么这里只有两张表，而不是一份带图标的组件
 *
 * 持久化的是**闭集 key**（`'drop'`），不是字形名，也不是字形本身
 * （判据在 `@heyta/domain#habit-icons.ts`）。所以"key → Lucide 组件"和
 * "key → 中文词条"是**映射**，两处都做成 `Record<HabitIcon, …>`：
 *
 * ⚠️ 用 `Record` 而不是 `Map`/部分对象，是为了让**加图标变成编译错误** ——
 * 往 `HABIT_ICONS` 里加第 9 个 key 而没在这里补上，`typecheck` 会直接指出缺哪一项。
 * 一份 `Record<string, …>` 会让它悄悄落成 `undefined`，症状是"新习惯没有图标"。
 *
 * ⚠️ 字形与词条**必须同序同源**：一个只加字形不加词条的改动会让界面显示
 * `web.habits.icon.xxx` 这种 key 字符串（`t()` 查不到时的返回形状）。
 */

import {
  Activity,
  BookOpen,
  Droplet,
  Leaf,
  Moon,
  Music,
  Pencil,
  Sun,
  type LucideIcon,
} from 'lucide-react';

import type { HabitIcon } from '@heyta/domain';
import type { MessageKey } from '@heyta/i18n';

/** key → Lucide 字形组件。 */
export const HABIT_GLYPHS: Record<HabitIcon, LucideIcon> = {
  drop: Droplet,
  activity: Activity,
  book: BookOpen,
  moon: Moon,
  leaf: Leaf,
  pencil: Pencil,
  sun: Sun,
  music: Music,
};

/**
 * key → **名称词条**。给 `title` 与 `aria-label` 用。
 *
 * 🔴 这些名字描述的是"这个字形看起来像什么"（水滴 / 书本），**不是**
 * "这个习惯应该是什么活动"。用户把水滴用成"喝水"还是"洗澡"是他的事 ——
 * 一旦这里写成「健康」「自律」，App 就等于在给活动贴标签（AGENTS 的分级红线）。
 */
export const HABIT_ICON_LABEL_KEYS: Record<HabitIcon, MessageKey> = {
  drop: 'web.habits.icon.drop',
  activity: 'web.habits.icon.activity',
  book: 'web.habits.icon.book',
  moon: 'web.habits.icon.moon',
  leaf: 'web.habits.icon.leaf',
  pencil: 'web.habits.icon.pencil',
  sun: 'web.habits.icon.sun',
  music: 'web.habits.icon.music',
};
