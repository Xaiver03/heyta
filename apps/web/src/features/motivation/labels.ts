/**
 * 今日进度的文案**组装**（Web 壳）
 * ==================================
 *
 * 🔴 为什么单独一个文件：**同一批文案有两处消费者。**
 *
 * `TodayProgressCard` 是**跨视图常驻**的（任务 / 四象限 / 习惯 / 番茄钟，
 * 见 `App.tsx`），而 `GrowthBoard` 里也有一个 `today` 槽位。两端都要
 * "今日进度的整句"，如果各拼一份，同一句话迟早会漂移 —— 而这正是这一刀要
 * 消灭的形状（"两端说相反的话"）。
 *
 * 于是：**判据在共享层**（`growthHint` 与 `barA11y` 的分支都在
 * `packages/ui/src/motivation/model.ts`），**句子在这里**（共享层不能 import
 * `@heyta/i18n`）。
 *
 * ⚠️ **成长板其余几块的文案不在这里**，它们跟着 `GrowthView.tsx`（宿主视图）
 * 走 —— 与 `HabitsView.tsx` 的 `habitBoardLabels` 同一个位置。这不是随意的：
 * `check:empty-state` 按"文件"登记手写空态站点，把带 `*.empty` 词条的构造器
 * 放进一个新文件会**新增一个站点**（红），而放进已登记的视图文件是**同一笔债
 * 换个位置**。文件头这段就是为了让下一个人别再拆一次。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ 借用 `mobile.growth.*` 是有意的（不是笔误）
 *
 * 共享组件要求宿主给**整句**（facts 行），而 web 词条表里没有对应条目 ——
 * 迁移前 web 把"习惯 / 任务"拆成"标签 + 数字"两个 DOM 节点，没有整句词条。
 * 仓库已有先例：mobile 端直接复用 `web.export.*`
 * （`apps/mobile/src/screens/ExportScreen.tsx`）。
 * 该补的 `web.*` 孪生词条（`packages/i18n` 不在本刀白名单）：
 *   · `web.growth.today.habits` / `.tasks` / `.focus` / `.bonus`
 * 补上之后把这里的两处 `mobile.*` 换成对应的 `web.*` 即可，判据不动。
 */

import type { I18nValue } from '@heyta/i18n';
import type { TodayProgressLabels } from '@heyta/ui';

/**
 * 今日进度的整句（L1）。
 *
 * 🔴 **四种状态的判据不在这里**：`hint` 的分支来自共享层 `growthHint`，
 * 宿主只负责把它说成中文。所以 `total === 0 && done > 0` 时不可能出现
 * "还有 -1 件没做"（那正是两端各自实现时踩过的坑）。
 */
export function todayProgressLabels(t: I18nValue['t']): TodayProgressLabels {
  return {
    hint: ({ hint, done, remaining }) => {
      switch (hint) {
        case 'unplanned':
          return t('web.progress.hint.unplanned', { count: done });
        case 'idle':
          return t('web.progress.hint.idle');
        case 'allDone':
          return t('web.progress.hint.allDone');
        case 'remaining':
          // `remaining` 在这个分支里恒为正；负数是 `unplanned` 那一支的事。
          return t('web.progress.hint.remaining', { count: remaining });
      }
    },
    barA11y: ({ done, total, bonus }) => {
      if (total === 0) return t('web.progress.label.noPlan', { count: done });
      if (bonus > 0) return t('web.progress.label.bonus', { done, total, bonus });
      return t('web.progress.label.plain', { done, total });
    },
    habits: ({ done, planned }) => t('web.growth.today.habits', { done, planned }),
    tasks: ({ done, planned }) => t('web.growth.today.tasks', { done, planned }),
    focus: (minutes) => t('web.growth.today.focus', { minutes }),
    bonus: (count) => t('web.growth.today.bonus', { count }),
    closed: t('web.progress.closed'),
  };
}
