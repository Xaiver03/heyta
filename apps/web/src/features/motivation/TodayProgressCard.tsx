/**
 * 今日进度 —— 回路里"奖励"那一段的可视部分（L1）
 * ================================================
 *
 * ## 为什么要有它
 *
 * 诊断见 `docs/plans/motivation-and-progression.md` §0：heyta 缺的不是功能，
 * 是**回路**。打卡 → 界面只把按钮从"打卡"变成"已打卡"，然后什么都没有。
 * Hook 模型里"奖励"那一段（可变奖励 / 即时反馈）整段缺失，
 * 于是每次打卡都收不到任何"我做了一件有用的事"的信号。
 *
 * 这个卡片就是补上那一段：**完成之后有东西立刻变了，而且变化的方向是可见的。**
 *
 * ## 三条设计约束（都是踩过才知道的）
 *
 * 1. 🔴 **只显示"今天"的真实口径，不显示伪造的进度。**
 *    计划量 = 今天该做的习惯（按 `frequency` 判计划日，不是全部习惯）
 *    + 今天到期或已逾期的未完成任务。**逾期不倒扣**：
 *    昨天没做完的事今天做完了，今天的进度照样前进。
 *
 * 2. 🔴 **首次渲染不播动画。**
 *    Apple 的物理动效是**对用户刚才那次操作的回应**。页面刚打开时用户什么都
 *    没做，此刻横条从 0 长到 60% 是在演一个不存在的操作，而且会让
 *    "我刚点了什么"变模糊。这条规则由 `ProgressBar` 统一保证（见那边的文件头）——
 *    本组件不自己再实现一遍。
 *
 * 3. 🔴 **可以被打断。** 用的是 CSS transition（不是一次性 keyframes）：
 *    连点两次打卡时，第二次从**当前值**接着走，而不是先弹回再重放。
 *
 * ⚠️ `prefers-reduced-motion` 由 tokens.css 统一处理（把 `--ht-duration-*`
 * 压到 1ms），这里不需要再写一遍 media query —— 写第二遍就等于制造
 * 第二个降级策略，而设计系统里那一条已经被测试钉住了。
 */

import { cssVar } from '@heyta/design-system';
import { type TodayProgress } from '@heyta/domain';
import { useI18n, type I18nValue } from '@heyta/i18n';
import { Check, Sparkles, Timer } from 'lucide-react';

import { text } from '../../lib/text.js';
import { useTaskStore } from '../tasks/store.js';
import { ProgressBar } from './ProgressBar.js';
import { selectTodayProgress } from './selectors.js';

/**
 * 卡片左边那句"还剩多少"。
 *
 * 🔴 **`done` 可以大于 `total`，这里必须先处理那种情况。**
 * `total` 只数**计划内**的（今天该做的习惯 + 今天到期或逾期的任务），
 * 而 `done` 还包含**计划外**完成的任务 —— 也就是"今天没有截止日期，
 * 但我顺手把它做了"。那是最常见的操作之一。
 *
 * 原写法直接算 `total − done`，于是界面上出现过：
 *
 *     今天 2/1　还有 -1 件没做　今天的都做完了      ← 实测原文，同一张卡上自相矛盾
 *
 * 改成显式分支之后，负数在**结构上**不可能出现 —— 不依赖调用方记得 clamp，
 * 也不用一个 `Math.max` 把"其实计划外也做完了"糊成"还有 0 件"。
 */
function hintText(progress: TodayProgress, t: I18nValue['t']): string {
  if (progress.total === 0) {
    return progress.done > 0
      ? t('web.progress.hint.unplanned', { count: progress.done })
      : t('web.progress.hint.idle');
  }
  if (progress.done >= progress.total) return t('web.progress.hint.allDone');
  return t('web.progress.hint.remaining', { count: progress.total - progress.done });
}

/**
 * 进度条的可访问名。
 *
 * 有计划外完成时**必须说清分母是什么** —— `done > total` 时只念
 * "完成 2 件，共 1 件" 会让读屏用户以为进度坏了。
 */
function progressLabel(progress: TodayProgress, t: I18nValue['t']): string {
  if (progress.total === 0) {
    return t('web.progress.label.noPlan', { count: progress.done });
  }
  if (progress.bonus > 0) {
    return t('web.progress.label.bonus', {
      done: progress.done,
      total: progress.total,
      bonus: progress.bonus,
    });
  }
  return t('web.progress.label.plain', { done: progress.done, total: progress.total });
}

export function TodayProgressCard() {
  const { t } = useI18n();
  const entities = useTaskStore((s) => s.entities);
  const now = useTaskStore((s) => s.now);

  const progress = selectTodayProgress(entities, now);

  /**
   * 没有计划、却有完成 —— 这是最容易做错的一种状态。
   * 按 `done / total` 算会得到 0/0，界面上只能显示"0%"或"空"，
   * 而用户刚刚明明做完了一件事。领域层把它算成 100%（见 `today-progress.ts`），
   * 这里只负责把它**说清楚**，而不是让用户猜那个百分比哪来的。
   */
  const unplannedOnly = progress.total === 0 && progress.done > 0;

  return (
    <section className="ht-today" aria-label={t('web.progress.aria')}>
      <div className="ht-today__head">
        <div>
          <div className="ht-today__label" style={text('caption')}>
            {t('web.progress.today')}
          </div>
          <div className="ht-today__count" style={text('numeric-display')}>
            <span>{progress.done}</span>
            <span className="ht-today__count-total">/ {progress.total}</span>
          </div>
          <div className="ht-today__hint" style={text('row-meta')}>
            {hintText(progress, t)}
          </div>
        </div>

        {/* `aria-live="polite"`：完成的时候要让读屏也收到"闭环了"这件事，
            而不是只有一个视觉徽章。用 polite 而不是 assertive ——
            它不该打断用户正在听的别的内容。 */}
        <div className="ht-today__facts" aria-live="polite">
          {progress.focusMinutes > 0 && (
            <span className="ht-today__fact" style={text('caption')}>
              <Timer size={14} aria-hidden="true" />
              {t('web.progress.focus')}
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                {progress.focusMinutes}
              </span>
              {t('web.progress.focusUnit')}
            </span>
          )}

          {progress.closed && (
            <span className="ht-today__fact ht-today__fact--done" style={text('caption')}>
              {unplannedOnly ? (
                <Sparkles size={14} aria-hidden="true" />
              ) : (
                <Check size={14} aria-hidden="true" />
              )}
              {t('web.progress.closed')}
            </span>
          )}
        </div>
      </div>

      <ProgressBar
        ratio={progress.ratio}
        tone={progress.closed ? 'success' : 'primary'}
        label={progressLabel(progress, t)}
      />

      {/* 四项明细只在"有计划"时展开。没有计划的时候铺一行 0 / 0 / 0 / 0
          除了让人以为自己漏了什么，没有任何信息量。 */}
      {progress.total > 0 && (
        <ul className="ht-today__breakdown" style={text('caption')}>
          <li>
            {t('web.progress.breakdown.habits')}
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>
              {progress.habitsDone}/{progress.habitsPlanned}
            </span>
          </li>
          <li>
            {t('web.progress.breakdown.tasks')}
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>
              {progress.tasksDone}/{progress.tasksPlanned}
            </span>
          </li>
          {progress.bonus > 0 && (
            <li className="ht-today__bonus">
              {t('web.progress.breakdown.bonus')}
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{progress.bonus}</span>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}