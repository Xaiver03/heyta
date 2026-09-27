/**
 * 成长视图（L3 叙事层）
 * ======================
 *
 * 这是"为了一个目标持续做下去"这件事的**出口**：把散落的完成记录收成
 * 一段看得见的历史。计划 §5 的分工是 ——
 *
 *   - 本周复盘：**最近**发生了什么（短周期叙事，回答"我这周在干什么"）
 *   - 这一年：**长期**的节奏（中周期，回答"我一直是个在做事的人吗"）
 *   - 里程碑 / 身份：**累计**到了哪（长周期，回答"我建成了什么"）
 *
 * 三个时间尺度放在同一屏，是刻意的：只给短周期会显得琐碎，
 * 只给长周期会让今天做的事显得无关紧要。
 *
 * ## 值得单独记住的两条
 *
 * 1. 🔴 **不做排行榜。** 这是本设计最强的反需求之一（计划 §6）。
 *    排行榜在 E2EE 下结构性不可做（服务端看不到明文，无法聚合可信的跨用户数字），
 *    而即便能做，它喂的是比较而非胜任感。这里给的全是"和你自己的过去比"。
 *
 * 2. 🔴 **不显示"比上周少"。** 周复盘里带差值，但**差值只用中性表述**，
 *    不给下降配红色、不给上升配庆祝 —— 一个正常的一周不需要被判分。
 *    这是损失厌恶的反用：我们不用"你在退步"来驱动用户回来。
 *
 * ## 文案
 *
 * 全部走 `@heyta/i18n`（`apps/web/src` 已整体迁移，门禁要求字面量一律 `t()`）。
 * 句子里带数字的（主标题、最专注的一天、复制出去的小结）整句成条 ——
 * 英文的语序与量词都在句子里，拼不出来。
 */

import { useState } from 'react';
import { ActivityCalendar } from 'react-activity-calendar';
import { Copy } from 'lucide-react';

import { useI18n, type MessageKey } from '@heyta/i18n';

import { text } from '../../lib/text.js';
import { activityLabels, heatmapTheme } from '../../lib/heatmap-theme.js';
import { useTaskStore } from '../tasks/store.js';
import { CategoryBreakdown } from '../categories/CategoryBreakdown.js';
import { buildShareSummary, HEADLINE_COPY, headlineCount } from './copy.js';
import { IdentityTagList } from './IdentityTagList.js';
import { MilestoneMap } from './MilestoneMap.js';
import {
  selectIdentityTags,
  selectMilestones,
  selectTotals,
  selectWeeklyReview,
  selectYearActivity,
} from './selectors.js';

export function GrowthView() {
  const { t } = useI18n();
  const entities = useTaskStore((s) => s.entities);
  const now = useTaskStore((s) => s.now);

  const review = selectWeeklyReview(entities, now);
  const totals = selectTotals(entities);
  const milestones = selectMilestones(entities);
  const tags = selectIdentityTags(entities, now);
  const year = selectYearActivity(entities, now, 365);

  return (
    <div className="ht-growth">
      <section className="ht-growth__section">
        {/* ⚠️ 这里用 section-title 而不是 screen-title：页面的大标题在
            顶栏（导航项标题）上，一屏两个大标题等于没有大标题。 */}
        <h2 style={text('section-title')}>{t('web.growth.week.title')}</h2>

        <div className="ht-growth__week" style={text('row-meta')}>
          <span className="ht-growth__range">
            {t('web.growth.week.range', { start: review.weekStart, end: review.weekEnd })}
          </span>
        </div>

        {review.headline === 'none' ? (
          <p className="ht-growth__empty" style={text('row-meta')}>
            {t('web.growth.week.empty')}
          </p>
        ) : (
          <p className="ht-growth__headline" style={text('section-title')}>
            {t(HEADLINE_COPY[review.headline], { count: headlineCount(review) })}
          </p>
        )}

        <dl className="ht-growth__stats">
          <Stat
            labelKey="web.growth.stat.checkIns"
            unitKey="web.growth.stat.checkIns.unit"
            value={review.checkIns}
            previous={review.previous.checkIns}
          />
          <Stat
            labelKey="web.growth.stat.tasks"
            unitKey="web.growth.stat.tasks.unit"
            value={review.tasksCompleted}
            previous={review.previous.tasksCompleted}
          />
          <Stat
            labelKey="web.growth.stat.focus"
            unitKey="web.growth.stat.focus.unit"
            value={review.focusMinutes}
            previous={review.previous.focusMinutes}
          />
        </dl>

        {review.bestFocusDay !== undefined && (
          <p className="ht-growth__note" style={text('caption')}>
            {t('web.growth.week.bestDay', {
              date: review.bestFocusDay.date,
              minutes: review.bestFocusDay.minutes,
            })}
          </p>
        )}
      </section>

      <section className="ht-growth__section">
        <h2 style={text('section-title')}>{t('web.growth.year.title')}</h2>
        <p className="ht-growth__note" style={text('caption')}>
          {t('web.growth.year.note')}
        </p>
        <ActivityCalendar
          data={year}
          blockSize={10}
          blockMargin={3}
          blockRadius={2}
          showMonthLabels
          showWeekdayLabels={false}
          // 主题色走共享实现（习惯页的热力图用同一份）——
          // 那里记着为什么**必须**是 `var(--ht-…)` 而不能是裸 token 名。
          theme={heatmapTheme()}
          // ⚠️ 这里**不能**用 `{{year}}`：这是滚动 365 天（2025-09 → 2026-09），
          // 而库填进去的是首个格子的年份 —— 会写成「2025 年」而其实跨到了 2026。
          // `{{count}}` 是**库自己的**占位符，`t()` 的 `{name}` 形状不会动它。
          labels={activityLabels(t('web.growth.year.heatmap'), t)}
        />
      </section>

      {/*
        分类时长放在**周复盘与一年之间**：它比"这一年"细（按来源拆开），
        又比"这一周"粗（十二周的趋势）—— 三个时间尺度的顺序因此是连续的。
      */}
      <CategoryBreakdown />

      <section className="ht-growth__section">
        <h2 style={text('section-title')}>{t('web.growth.milestones.title')}</h2>
        <p className="ht-growth__note" style={text('caption')}>
          {t('web.growth.milestones.note')}
        </p>
        <MilestoneMap milestones={milestones} />
      </section>

      <section className="ht-growth__section">
        <h2 style={text('section-title')}>{t('web.growth.tags.title')}</h2>
        <IdentityTagList tags={tags} />
      </section>

      <ShareSection summary={buildShareSummary(review, totals, t)} />
    </div>
  );
}

/** 一块统计数字。`previous` 是上周同类数字，**中性呈现**（见文件头第 2 条）。 */
function Stat({
  labelKey,
  unitKey,
  value,
  previous,
}: {
  labelKey: MessageKey;
  unitKey: MessageKey;
  value: number;
  previous: number;
}) {
  const { t } = useI18n();
  return (
    <div className="ht-growth__stat">
      <dt style={text('caption')}>{t(labelKey)}</dt>
      <dd className="ht-growth__stat-value" style={text('numeric-display')}>
        <span>{value}</span>
        <span className="ht-growth__unit" style={text('caption')}>
          {t(unitKey)}
        </span>
      </dd>
      <dd className="ht-growth__stat-prev" style={text('caption')}>
        {t('web.growth.stat.previous', { count: previous })}
      </dd>
    </div>
  );
}

/**
 * 小结的复制按钮。
 *
 * 🔴 复制的是**纯文本**，不是图片 —— 理由见 `copy.ts` 的 `buildShareSummary`。
 * 🔴 复制失败必须说出来。`navigator.clipboard` 在非安全上下文（http 访问
 * 局域网地址）里是 `undefined`，而"点了没反应"会被读成"按钮坏了"。
 */
function ShareSection({ summary }: { summary: string }) {
  const { t } = useI18n();
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  async function copy(): Promise<void> {
    try {
      if (navigator.clipboard === undefined) throw new Error('no-clipboard');
      await navigator.clipboard.writeText(summary);
      setState('copied');
    } catch {
      setState('failed');
    }
    // 2 秒后回到常态，避免"已复制"永久停在那里看起来像状态卡住了。
    window.setTimeout(() => {
      setState('idle');
    }, 2000);
  }

  return (
    <section className="ht-growth__section ht-growth__section--share">
      <h2 style={text('section-title')}>{t('web.growth.share.title')}</h2>
      <p className="ht-growth__note" style={text('caption')}>
        {t('web.growth.share.note')}
      </p>
      <button
        type="button"
        className="ht-btn ht-btn--primary ht-growth__copy"
        onClick={() => void copy()}
        aria-label={t('web.growth.share.copy')}
      >
        <Copy size={16} aria-hidden="true" />
        {t('web.growth.share.copy')}
      </button>

      {/* `aria-live`：复制是"点下去之后什么都没发生"的典型操作，
          必须有一句能被读屏读到的结果。 */}
      <p className="ht-growth__copy-state" aria-live="polite" style={text('caption')}>
        {state === 'copied' && t('web.growth.share.copied')}
        {state === 'failed' && t('web.growth.share.failed')}
      </p>
    </section>
  );
}
