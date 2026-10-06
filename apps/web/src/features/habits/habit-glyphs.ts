/**
 * 习惯图标：闭集 key → 字形 / 词条
 * ==================================
 *
 * 🔴 **这里是 web 那半张字形表**（key → `lucide-react` **组件**）。
 * 2026-10-01 起，共享层也有一张：`packages/ui/src/habits/HabitProgressList.tsx`
 * 里的 `HABIT_GLYPHS` 把同样的 key 配给 `lucide` 的**图标数据**，由 `HeytaIcon`
 * 在 RN 上画 —— 移动端清单与移动端的图标选择器（工单 H3）用的都是它。两张表**必须配得一样**，
 * 判据是 `tests/habits-list-pane.spec.tsx` 的 F 组（读两边源码逐对比）。
 * 症状如果不钉住：同一个习惯，手机上水滴、web 上月亮，而两边都不报错。
 *
 * ⚠️ 词条那张表（`HABIT_ICON_LABEL_KEYS`）**不再住在这里** —— 见文件末尾那一行。
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
 * 🔴 **工单 H3 起这张表住在共享层**（`packages/ui/src/habits/HabitProgressList.tsx`），
 *    这里只是**再导出**。原来这里是本地手抄的一份，而移动端做图标选择器时需要同一份 ——
 *    各端抄一份的坏形状是"某个端上那个字形没有名字念出来"，而 `Record` 的穷尽性
 *    挡不住"少的那一端"。抽取的收尾动作是**删掉旧那份**（就是下面这一行代替的 10 行），
 *    不是再写一份更好的。
 *
 * 上面的 `HABIT_GLYPHS` **仍然留在本文件**，那是刻意的：本文件配的是 `lucide-react`
 * 的**组件**，共享层配的是 `lucide` 的**图标数据**，两种东西不能合成一张表；
 * 一致性由 `tests/habits-list-pane.spec.tsx` F 组逐对比钉住。
 *
 * 🔴 这些名字描述的是"这个字形看起来像什么"（水滴 / 书本），**不是**
 * "这个习惯应该是什么活动"。用户把水滴用成"喝水"还是"洗澡"是他的事 ——
 * 一旦这里写成「健康」「自律」，App 就等于在给活动贴标签（AGENTS 的分级红线）。
 *
 * ⚠️ 词条**存在性**现在在**调用点**检查：`t()` 的入参是 `MessageKey`，
 *    而共享层那张表给的是字面量联合（`packages/ui` 不依赖词条包）。
 *    改词条名会在 `HabitIconPicker.tsx:90` 那一处编译报错，不会静默显示 key 字符串。
 */
export { HABIT_ICON_LABEL_KEYS } from '@heyta/ui';
