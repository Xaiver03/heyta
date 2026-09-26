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
 */

import { useState } from 'react';
import { ActivityCalendar } from 'react-activity-calendar';
import { cssVar, cssVarName } from '@heyta/design-system';
import { Copy } from 'lucide-react';

import { text } from '../../lib/text.js';
import { useTaskStore } from '../tasks/store.js';
import { buildShareSummary, HEADLINE_COPY, headlineValue } from './copy.js';
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
        <h2 style={text('section-title')}>本周</h2>

        <div className="ht-growth__week" style={text('row-meta')}>
          <span className="ht-growth__range">
            {review.weekStart} 至 {review.weekEnd}
          </span>
        </div>

        {review.headline === 'none' ? (
          <p className="ht-growth__empty" style={text('row-meta')}>
            这一周还没有记录。从今天的一件小事开始就好。
          </p>
        ) : (
          <p className="ht-growth__headline" style={text('section-title')}>
            {HEADLINE_COPY[review.headline]}：
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>
              {headlineValue(review).value}
            </span>
            {headlineValue(review).unit}
          </p>
        )}

        <dl className="ht-growth__stats">
          <Stat label="打卡" value={review.checkIns} unit="次" previous={review.previous.checkIns} />
          <Stat
            label="完成任务"
            value={review.tasksCompleted}
            unit="件"
            previous={review.previous.tasksCompleted}
          />
          <Stat
            label="专注"
            value={review.focusMinutes}
            unit="分钟"
            previous={review.previous.focusMinutes}
          />
        </dl>

        {review.bestFocusDay !== undefined && (
          <p className="ht-growth__note" style={text('caption')}>
            最专注的一天是 {review.bestFocusDay.date}，专注了
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>
              {review.bestFocusDay.minutes}
            </span>
            分钟。
          </p>
        )}
      </section>

      <section className="ht-growth__section">
        <h2 style={text('section-title')}>这一年</h2>
        <p className="ht-growth__note" style={text('caption')}>
          一格是一天。有记录的日子才会亮起来 —— 打卡、完成任务、跑完一轮专注都算。
        </p>
        <ActivityCalendar
          data={year}
          blockSize={10}
          blockMargin={3}
          blockRadius={2}
          showMonthLabels
          showWeekdayLabels={false}
          // ⚠️ 库通过 props 收值，不吃 CSS 变量 —— 所以从 token 取名传进去，
          // 保证取值仍然只有 tokens.css 一个来源。
          theme={{
            light: [
              cssVarName('color.surface-sunken'),
              cssVarName('color.heat-1'),
              cssVarName('color.heat-2'),
              cssVarName('color.heat-3'),
              cssVarName('color.heat-4'),
            ],
            dark: [
              cssVarName('color.surface'),
              cssVarName('color.heat-1'),
              cssVarName('color.heat-2'),
              cssVarName('color.heat-3'),
              cssVarName('color.heat-4'),
            ],
          }}
        />
      </section>

      <section className="ht-growth__section">
        <h2 style={text('section-title')}>里程碑</h2>
        <p className="ht-growth__note" style={text('caption')}>
          只增不减。中断不会让这些数字变小。
        </p>
        <MilestoneMap milestones={milestones} />
      </section>

      <section className="ht-growth__section">
        <h2 style={text('section-title')}>你的标签</h2>
        <IdentityTagList tags={tags} />
      </section>

      <ShareSection summary={buildShareSummary(review, totals)} />
    </div>
  );
}

/** 一块统计数字。`previous` 是上周同类数字，**中性呈现**（见文件头第 2 条）。 */
function Stat({
  label,
  value,
  unit,
  previous,
}: {
  label: string;
  value: number;
  unit: string;
  previous: number;
}) {
  return (
    <div className="ht-growth__stat">
      <dt style={text('caption')}>{label}</dt>
      <dd className="ht-growth__stat-value" style={text('numeric-display')}>
        <span>{value}</span>
        <span className="ht-growth__unit" style={text('caption')}>
          {unit}
        </span>
      </dd>
      <dd className="ht-growth__stat-prev" style={text('caption')}>
        上周 {previous}
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
      <h2 style={text('section-title')}>带走这一周</h2>
      <p className="ht-growth__note" style={text('caption')}>
        复制成一段纯文字，粘到哪都行。它不含你的账号、设备或任何标识。
      </p>
      <button
        type="button"
        className="ht-btn ht-btn--primary ht-growth__copy"
        onClick={() => void copy()}
        aria-label="复制本周小结"
      >
        <Copy size={16} aria-hidden="true" />
        复制本周小结
      </button>

      {/* `aria-live`：复制是"点下去之后什么都没发生"的典型操作，
          必须有一句能被读屏读到的结果。 */}
      <p className="ht-growth__copy-state" aria-live="polite" style={text('caption')}>
        {state === 'copied' && '已复制'}
        {state === 'failed' && '当前环境不允许复制，可以手动选中上面的数字。'}
      </p>
    </section>
  );
}