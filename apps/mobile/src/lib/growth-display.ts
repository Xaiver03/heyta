/**
 * 成长屏的**文案接线**（移动壳）
 * =================================
 *
 * M3 第十一刀（motivation）的移动端换装之后，本文件只剩一件事：
 * 把共享 `GrowthBoard` 要的 `GrowthBoardLabels` 从本端词条表构造出来。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 迁移前这里有 178 行"第二份展示实现"，现在那七条纯函数**全部删掉**
 *
 * | 迁移前本文件的函数 | 现在在哪 |
 * |---|---|
 * | `growthHint` | `packages/ui/src/motivation/model.ts` |
 * | `ratioText` | 同上 |
 * | `progressPercent` | 同上 |
 * | `milestoneGroups` | 同上 |
 * | `reachedTagIds` | 同上 |
 * | `nearMissTags` | 同上（共享层多带一个 `kind`，见下） |
 * | `weekHeadlineCount` | 同上 |
 *
 * 它们逐条是**纯展示**（分支选择 / 顺序 / 夹紧 / 取前 N 条），没有一行移动端
 * 特有语义，所以收编进共享层是这一刀的目的；留在这里就是第二份真相。
 *
 * ⚠️ **断言没有跟着删。** `tests/growth-display.spec.ts` 仍然逐条断言那七个
 * 函数的行为，只是改成直接 import **共享源码**
 * （`../../../packages/ui/src/motivation/model.ts`）。
 * 为什么绕这一下：移动单测跑在 node，`@heyta/ui` 的 dist 顶层 import
 * `react-native`（Flow 源码），node 解析不了 —— 与 `lib/habits-display.ts`
 * 文件头记的是同一个坑。共享 `model.ts` 自己**不 import react-native**
 * （那个文件头把这条写成了硬约束），所以直接指源码是安全的。
 *
 * ⚠️ `nearMissTags` 的返回值形状**变了**（共享层加了 `kind`），那两条断言
 * 也跟着更新 —— 这是契约变化，不是删断言。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 已知命名残差：三处借用了别的命名空间的键
 *
 *   · `web.growth.milestone.allReached` / `web.growth.milestone.nextLabel`
 *     （里程碑的无障碍名）—— 移动端从来没有这两句，而它们与"里程碑"同义。
 *   · `web.growth.tags.nearNote`（还没拿到标签时那句说明）—— web 有、mobile 没有；
 *     共享层把它渲染出来了，所以必须给一条真话。
 *   · `mobile.growth.tags.reachedA11y`（单档位徽章）—— 本意是身份标签的键，
 *     这里借来给"已达成的档位"用（"已达成：50"）。它该有一条
 *     `mobile.growth.milestones.tierReached`，但 `packages/i18n` 不在本刀白名单。
 *
 * 修法都是**纯改名 + 各加一条词条**（文案不动），留待 i18n 可改的那一刀。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 本文件不做任何领域判断，也不 import `@heyta/ui` 的**值**
 *
 * 连续怎么数、里程碑阈值、身份判据全在 `@heyta/domain`；
 * 摊平 / 滤墓碑 / 注入 now 在 `@heyta/app-host#motivation`。
 * 这里只搬字。`import type { GrowthBoardLabels }` 是**类型**（编译期擦除），
 * 所以 node 下的单测不会把 react-native 拉进来。
 */

import type { IdentityTagKind, MilestoneKind, WeeklyReview } from '@heyta/domain';
import type { I18nValue, MessageKey } from '@heyta/i18n';
import type { GrowthBoardLabels, WeekStatId } from '@heyta/ui';

import { MOBILE_HEATMAP_MONTH_KEYS } from './habits-display';

/**
 * 里程碑维度 → 文案 key。
 *
 * 🔴 类型是 `Record<MilestoneKind, MessageKey>`：领域层将来多一个维度，
 * 这里**编译不过**；词条表里少一条，也在 `@heyta/i18n` 的类型上就红。
 * 两处都不需要靠人记得同步。
 */
const KIND_KEY: Record<MilestoneKind, MessageKey> = {
  checkIns: 'mobile.growth.kind.checkIns',
  focusHours: 'mobile.growth.kind.focusHours',
  tasks: 'mobile.growth.kind.tasks',
  activeDays: 'mobile.growth.kind.activeDays',
};

/** 本周主标题的维度（`WeeklyReview['headline']` 去掉 `none`）。 */
type HeadlineKind = Exclude<WeeklyReview['headline'], 'none'>;

/** 本周主标题 → 文案 key。`none` 没有主标题，走空态文案（由共享层判）。 */
const HEADLINE_KEY: Record<HeadlineKind, MessageKey> = {
  checkIns: 'mobile.growth.week.headline.checkIns',
  tasksCompleted: 'mobile.growth.week.headline.tasksCompleted',
  focusMinutes: 'mobile.growth.week.headline.focusMinutes',
};

/** 周复盘的三个维度 → 文案 key（顺序由共享层的 `WEEK_STAT_IDS` 决定）。 */
const WEEK_STAT_KEY: Record<WeekStatId, MessageKey> = {
  checkIns: 'mobile.growth.week.stat.checkIns',
  tasksCompleted: 'mobile.growth.week.stat.tasks',
  focusMinutes: 'mobile.growth.week.stat.focus',
};

/**
 * 身份标签 id → 文案 key。
 *
 * ⚠️ 用 `Partial` 而不是 `Record`：标签 id 由**同步过来的数据**决定，
 * 一台更新的客户端可能带来这个版本还不认识的 id。共享层拿到 `undefined`
 * 会**跳过**它，而不是把 `checkin-hundred` 这种内部 id 渲染给用户看。
 * 领域层的 `IDENTITY_TAG_DEFINITIONS` 是唯一事实源，这里只是一张翻译表。
 */
const TAG_KEY: Partial<Record<string, MessageKey>> = {
  started: 'mobile.growth.tag.started',
  routine: 'mobile.growth.tag.routine',
  steady: 'mobile.growth.tag.steady',
  'checkin-hundred': 'mobile.growth.tag.checkin-hundred',
  'deep-fifty': 'mobile.growth.tag.deep-fifty',
  'deep-two-hundred': 'mobile.growth.tag.deep-two-hundred',
  'finisher-five-hundred': 'mobile.growth.tag.finisher-five-hundred',
  'streak-thirty': 'mobile.growth.tag.streak-thirty',
};

/**
 * 未达成身份标签的计量单位 → 文案 key。
 *
 * ⚠️ `streakDays` 也是 `IdentityTagKind` 的一种，但它的单位（"天"）**不属于**
 * 里程碑那四个维度 —— 共享层的 `IdentityTagListLabels.nearUnit` 单独留了口子
 * 正是为了保住这条例外（web 迁移前为此走 `web.growth.unit.streakDays`）。
 *
 * 🔴 本轮移动端**用不到**它：`mobile.growth.tags.near` 的模板里没有 `{unit}`
 * 占位符（迁移前就不带单位）。仍然如实给全，是因为共享层一定会调用它，
 * 返回空串会在将来有人给模板补上单位时安静地拼出双空格。
 */
const NEAR_UNIT_KEY: Record<IdentityTagKind, MessageKey> = {
  checkIns: 'web.growth.kind.checkIns.unit',
  focusHours: 'web.growth.kind.focusHours.unit',
  tasks: 'web.growth.kind.tasks.unit',
  activeDays: 'web.growth.kind.activeDays.unit',
  streakDays: 'web.growth.unit.streakDays',
};

/**
 * 构造共享 `GrowthBoard` 需要的全部文案。
 *
 * 共享层**不 import i18n**（见它的文件头），所以模板留在这里；
 * 字段名必须与 `GrowthBoardLabels` 逐项对上 —— 漏了编译不过。
 */
export function growthBoardLabels(t: I18nValue['t']): GrowthBoardLabels {
  return {
    /**
     * 🔴 "只与自己比"那一句（`compareNote`）是**移动端有、web 没有**的。
     * 共享层把它放在最上面（见 `GrowthBoard` 文件头第 1 条），这里必须给，
     * 否则换装会把这句话丢掉 —— 而它是本屏反排行榜立场的唯一显式声明。
     */
    compareNote: t('mobile.growth.compare.note'),

    today: {
      /**
       * 四种分支（idle / unplanned / allDone / remaining）由**本端**选词条。
       * 共享层只给判据 + `remaining`（**可能是负数**，计划外完成时），
       * 所以 `remaining` 这一支只在 `hint === 'remaining'` 时用它的值 ——
       * 与迁移前的写法逐字一致。
       */
      hint: ({ hint, done, remaining }) => {
        switch (hint) {
          case 'idle':
            return t('mobile.growth.today.hint.idle');
          case 'unplanned':
            return t('mobile.growth.today.hint.unplanned', { count: done });
          case 'allDone':
            return t('mobile.growth.today.hint.allDone');
          case 'remaining':
            return t('mobile.growth.today.hint.remaining', { count: remaining });
        }
      },
      /**
       * ⚠️ 迁移前这条词条只有 `{done}` / `{total}`，**不含 bonus**。
       * 共享层的 `barA11y` 给了 `bonus`，这里**刻意不用**：
       * 本刀不改文案口径（加 bonus 要新增/改词条，`packages/i18n` 不在白名单）。
       * 后果：计划外完成时读屏听到的分母仍是计划数 —— 与迁移前逐字相同。
       */
      barA11y: ({ done, total }) => t('mobile.growth.today.a11y', { done, total }),
      habits: ({ done, planned }) => t('mobile.growth.today.habits', { done, planned }),
      tasks: ({ done, planned }) => t('mobile.growth.today.tasks', { done, planned }),
      focus: (minutes) => t('mobile.growth.today.focus', { minutes }),
      bonus: (count) => t('mobile.growth.today.bonus', { count }),
      closed: t('mobile.growth.today.closed'),
    },

    week: {
      range: ({ start, end }) => t('mobile.growth.week.range', { start, end }),
      empty: t('mobile.growth.week.empty'),
      headline: ({ headline, count }) => t(HEADLINE_KEY[headline], { count }),
      stat: (id) => t(WEEK_STAT_KEY[id]),
      /**
       * ⚠️ **刻意不给 `statUnit`**：共享层给了才渲染单位，移动端迁移前
       * 不渲染（单位由维度名承担 —— "专注" 而非 "专注 12 分钟"），
       * 而 web 给。共享层把这一项做成可选正是为了保住这个差异。
       */
      previous: (count) => t('mobile.growth.week.stat.previous', { count }),
      bestDay: ({ date, minutes }) => t('mobile.growth.week.bestDay', { date, minutes }),
    },

    streaks: {
      empty: t('mobile.growth.streak.empty'),
      current: t('mobile.growth.streak.current'),
      longest: (count) => t('mobile.growth.streak.longest', { days: count }),
      total: (count) => t('mobile.growth.streak.total', { count }),
      /**
       * ⚠️ **刻意不给 `freeze`**：这条连续的冻结说明只有在领域层给出
       * `frozenDays > 0` 时才渲染，而移动端迁移前没有这句（web 有）。
       * 不给我一条编的文案，让它退回"不存在"。
       */
      repair: ({ count }) => t('mobile.growth.streak.repair', { days: count }),
      /** Web 与移动端共用动作语义：补打卡与今天重新开始都只写一条默认量记录。 */
      repairAction: t('web.habits.repairAction'),
      repairA11y: ({ date, name }) => t('web.habits.a11y.repair', { date, name }),
      freshStart: ({ days, longest, total }) =>
        t('mobile.growth.streak.freshStart', { days, longest, total }),
      freshStartAction: t('web.habits.freshStartAction'),
      freshStartA11y: (name) => t('web.habits.a11y.freshStart', { name }),
      /**
       * 习惯名的无障碍名。
       *
       * ⚠️ 移动端只有一条 `mobile.growth.streak.a11y`，它的模板要
       * `{name} {current} {longest} {total}` 四个值，而共享层的 `a11yHabit`
       * **只给 name** —— 拿不到那三个数字。返回 name 与 RN 的默认行为等价
       * （那段文本内容就是 name），所以**与迁移前完全一致**。
       * 要念出完整那句，需要一条只吃 `{name}` 的词条（i18n 不在白名单）。
       */
      a11yHabit: (name) => name,
    },

    milestones: {
      kindName: (kind) => t(KIND_KEY[kind]),
      /** ⚠️ 同 `week.statUnit`：不给单位，移动端迁移前就不给。 */
      maxed: t('mobile.growth.milestones.maxed'),
      /**
       * ⚠️ 移动端的这条词条只有 `{next}`（"下一档 50"），没有 `{unit}`/`{gap}`。
       * 共享层给的 `gap` 因此被忽略 —— 与迁移前逐字相同。
       */
      next: ({ threshold }) => t('mobile.growth.milestones.next', { next: threshold }),
      /**
       * ⚠️ 借用 web 的两条里程碑无障碍词条，理由见文件头"命名残差"。
       * `nextA11y` 的模板里有两处 `{unit}`，而本端 `kindUnit` 缺席（传空串），
       * 于是读屏会听到 "下一个里程碑是 50 ，还差 38 "（逗号前多一个空格）。
       * 这是**已知且刻意接受**的残差：修它要一条不带单位的词条。
       */
      allReachedA11y: (name) => t('web.growth.milestone.allReached', { name }),
      nextA11y: ({ name, threshold, unit, gap }) =>
        t('web.growth.milestone.nextLabel', { name, threshold, unit, gap }),
      /**
       * ⚠️ 单档位徽章的无障碍名借了身份标签那条键（"已达成：50"）。
       * 已达成的档位共享层还画了一个对勾（`HeytaIcon`），所以这里必须把
       * "已达成"念出来 —— 只念数字对读屏用户等于没有那条线索。
       */
      tierA11y: ({ threshold, reached }) =>
        reached
          ? t('mobile.growth.tags.reachedA11y', { name: String(threshold) })
          : String(threshold),
      /**
       * ⚠️ **死字段**，但类型要求必须给。共享层的 `MilestoneMap` 只在
       * `milestones` 为空时渲染它，而 `deriveMilestones` 恒返回四个维度。
       * 返回空串而不是编一句假话；真出现空输入时宁可少一句话。
       * 最小一步：给 `mobile.growth.milestones.empty` 补一条词条。
       */
      empty: '',
    },

    tags: {
      tagName: (id) => {
        const key = TAG_KEY[id];
        // 未知 id → `undefined` → 共享层跳过（见 `TAG_KEY` 的注释）。
        return key === undefined ? undefined : t(key);
      },
      near: ({ name, gap }) => t('mobile.growth.tags.near', { name, gap }),
      nearUnit: (kind) => t(NEAR_UNIT_KEY[kind]),
      empty: t('mobile.growth.tags.empty'),
      /** web 有、mobile 没有的一句（还没拿到任何标签时的说明）。 */
      nearNote: t('web.growth.tags.nearNote'),
      reachedA11y: (name) => t('mobile.growth.tags.reachedA11y', { name }),
    },

    /**
     * 年度热力图的事实由 `GrowthScreen` 从 app-host 投影后传入；这里仅提供
     * 中英标签。月份表复用 `habits-display.ts` 的既有词条，不复制第二份。
     */
    heatmap: {
      month: (month) => t(MOBILE_HEATMAP_MONTH_KEYS[month - 1] ?? 'web.heatmap.month.1'),
      grid: ({ total }) => t('web.growth.year.heatmap', { count: total }),
    },

    /**
     * 分享块（「带走这一周」）的三条文案。
     *
     * ✅ 本端**从 2026-10-03 起真的渲染它**了（`GrowthScreen` 传 `share`，
     * 复制走 RN 核心的 `Clipboard.setString`）。这三条借的是 web 的真词条 ——
     * 与月份那批同一个理由：**同一句话不复制第二份**（抄件一定会漂）。
     * 标题与那句"不含任何标识"的说明走 `renderSectionHeader`，也是同一批 key。
     */
    share: {
      copy: t('web.growth.share.copy'),
      copied: t('web.growth.share.copied'),
      failed: t('web.growth.share.failed'),
    },
  };
}
