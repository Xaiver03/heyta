import { ICON_SIZE } from '@heyta/design-system';
/**
 * 习惯左列：清单行（Web 壳）
 * ============================
 *
 * 产品负责人 2026-10-01 要的形态：「列表 + 窗格」—— 这一列负责**扫一眼**，
 * 右窗格（共享 `HabitBoard`）负责**看细节**。参考的是滴答清单的习惯面：
 * 一行一个习惯，行首图标 + 名字 + 最近几天打没打 + 几个具体数字。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 这一列**一个判断都不做**
 *
 * `rows` 里的每个数字都来自 `@heyta/ui#toHabitProgressRows`（经
 * `features/habits/store.ts` 的薄转发），7 天窗口来自 `@heyta/ui#habitHeatmap`。
 * 这里不许出现 `computeStreak`、也不许自己数 `logs` —— 那会变成第三份
 * "什么算打过 / 连续几天"的答案（web 一份、mobile 一份的老路，M3 第七刀刚清掉）。
 *
 * 🔴 **三个数字同等权重、常驻**
 * 与共享板 `metrics` 块同一条红线：「累计」是唯一只增不减的数字，断链那天
 * 用户最需要看见它，所以它不能被折进悬停、也不能在窄屏里第一个被砍。
 * 窄屏时整列换到窗格**上方**（见 app.css 的 768 像素断点），而不是砍数字。
 *
 * ⚠️ 走的是**韧性口径**（`progress.resilience.resilience`），与右窗格逐字相同。
 *    两个"连续"数字（日历口径的 `progress.streak` 与韧性口径）永远不能相减（ADR-0022），
 *    所以这里**只取一套**，不做混合。
 *
 * ## 数字为什么只显示数字，句子在哪
 *
 * 一行要同时放名字、7 个点、三个数字，横向空间是稀缺的。所以 chip 上只留
 * 字形 + 数字（滴答式），完整句子在两个地方：悬停 `title` 与整行的 `aria-label`
 * （后者一次说完三个数字）。这不算"只用图标表达信息"—— 数字本身就是文字，
 * 字形只是加速器，句子在 `title` 里读得到。
 */

import { cssVar } from '@heyta/design-system';
import { habitIconOf, parseCategorySlot } from '@heyta/domain';
import { useI18n } from '@heyta/i18n';
import {
  HABIT_LIST_WEEK_DAYS,
  heatmapLevelToken,
  type HabitProgressRow,
  type HeatmapDay,
} from '@heyta/ui';
import { Check, Flame, TrendingUp } from 'lucide-react';

import { categorySlotColor, unsetSlotColor } from '../../lib/category-colors.js';
import { currentStreakText, longestStreakText, totalCheckInText } from './copy.js';
import { HABIT_GLYPHS } from './habit-glyphs.js';

/**
 * 行首那排点的天数窗口。
 *
 * 🔴 数字**不在这里** —— 它是 `@heyta/ui#HABIT_LIST_WEEK_DAYS`，因为共享的
 * RN 清单（`HabitProgressList`，移动端那一端用的就是它）读的是同一个窗口。
 * 这里只保留 web 这边的旧名字做一个再导出：两处各写一个 `7`，就是"两个
 * 清单窗口可能不一样"的开始 —— 而界面上没人会看出来。
 *
 * ⚠️ 它是**列表**的窗口，不是热力图的（右窗格仍是 90 天）。两个数分开写、
 * 各自有名字，是为了让"为什么这里只有 7 个格"在 review 时一眼能答上来。
 */
export const HABIT_ROW_WEEK_DAYS = HABIT_LIST_WEEK_DAYS;

/**
 * 一行 = 进度 + 它的 7 天。
 *
 * 🔴 绑成一个对象而不是让调用方再传一张 `habitId → days` 表：
 * 分开的两份列表**可能错位**（顺序变了就静默对错人），绑在一起不可能。
 */
export interface HabitsListRow {
  readonly progress: HabitProgressRow;
  readonly week: readonly HeatmapDay[];
}

interface HabitsListProps {
  rows: readonly HabitsListRow[];
  /**
   * 当前在右窗格里展开的那个习惯；**`null` = 一个都没有**。
   *
   * 🔴 类型取 `string | null` 而不是 `string | undefined`：它接的是共享选中态
   * （`useSelected('habit')`）的原值，而那一侧的"没选中"就是 `null`。
   * 用 `undefined` 表示同一个意思会逼装配处写一次 `?? undefined` ——
   * 那种转换正是"两种空"能互相冒充的地方（本单撤掉 `?? rows[0]` 的同族）。
   */
  selectedId: string | null;
  onSelect: (habitId: string) => void;
}

export function HabitsList({ rows, selectedId, onSelect }: HabitsListProps) {
  const { t } = useI18n();

  return (
    <ul className="ht-habit__list" aria-label={t('web.habits.list.aria')}>
      {rows.map(({ progress, week }) => {
        const { habit } = progress;
        const growth = progress.resilience.resilience;
        const Glyph = HABIT_GLYPHS[habitIconOf(habit)];
        const slot = parseCategorySlot(habit.color);
        const selected = habit.id === selectedId;
        const current = currentStreakText(growth.current, t);
        const longest = longestStreakText(growth.longest, t);
        const total = totalCheckInText(growth.total, t);
        // 「没设过色」用哪个色由设计系统的 `UNSET_CATEGORY_TOKEN` 单点决定，
        // 这里只调 `unsetSlotColor()` —— 不在 web 里另挑一个"看起来中性"的 token。
        const discColor = slot === undefined ? unsetSlotColor() : categorySlotColor(slot);

        return (
          <li key={habit.id} className="ht-habit__item">
            <button
              type="button"
              // RNW 之外这里是真 `<button>`，但测试仍按 testID 寻址 ——
              // 与共享板同一套约定，改标签名不会让判据集体误红。
              data-testid={`habit-row-${habit.id}`}
              className="ht-habit__row"
              aria-current={selected ? 'true' : undefined}
              title={t('web.habits.row.selectA11y', { name: habit.name })}
              aria-label={t('web.habits.row.aria', {
                name: habit.name,
                current: growth.current,
                longest: growth.longest,
                total: growth.total,
              })}
              onClick={() => {
                onSelect(habit.id);
              }}
            >
              <span className="ht-habit__head">
                <span
                  className="ht-habit__disc"
                  style={{ color: discColor, borderColor: discColor }}
                >
                  <Glyph size={ICON_SIZE.sm} aria-hidden="true" />
                </span>
                <span className="ht-habit__name">{habit.name}</span>
              </span>

              <span className="ht-habit__week" role="group" aria-label={t('web.habits.week.aria')}>
                {week.map((day) => (
                  <span
                    key={day.date}
                    className="ht-habit__dot"
                    role="img"
                    title={
                      day.count === 0
                        ? t('web.habits.week.missed', { date: day.date })
                        : t('web.habits.week.done', { date: day.date })
                    }
                    aria-label={
                      day.count === 0
                        ? t('web.habits.week.missed', { date: day.date })
                        : t('web.habits.week.done', { date: day.date })
                    }
                    // 🔴 颜色取自**共享**的分档表（`heatmapLevelToken` 返回的就是完整
                    //    token 名，直接交给 `cssVar`），不是这里新配的一套。
                    //    自己挑一个"打过的绿"会让列表与右窗格的热力图对不上色，
                    //    而那是没有任何测试会红的不一致（同一件事两种颜色）。
                    style={{ background: cssVar(heatmapLevelToken(day.level)) }}
                  />
                ))}
              </span>

              <span className="ht-habit__chips">
                <span className="ht-habit__chip" title={current}>
                  <Flame size={ICON_SIZE.xs} aria-hidden="true" />
                  <span className="ht-habit__chip-num">{growth.current}</span>
                </span>
                <span className="ht-habit__chip" title={longest}>
                  <TrendingUp size={ICON_SIZE.xs} aria-hidden="true" />
                  <span className="ht-habit__chip-num">{growth.longest}</span>
                </span>
                <span className="ht-habit__chip" title={total}>
                  <Check size={ICON_SIZE.xs} aria-hidden="true" />
                  <span className="ht-habit__chip-num">{growth.total}</span>
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
