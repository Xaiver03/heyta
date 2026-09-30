/**
 * 真实界面复现：时间线（排期）
 * ==============================
 *
 * 复现对象：`apps/web/src/features/timeline/TimelinePanel.tsx` →
 * 共享 `@heyta/ui` 的 `TimelineView` + `GanttChart`。
 *
 * 🔴 这里**不引入共享组件**（理由见 `TaskList.tsx` 文件头：静态 import RN 会把
 * `main-*.js` 从 199 kB 涨到 261 kB gzip），而是用纯 CSS 画一份静态复现。
 * 代价是：**真视图的交互（拖动、悬停读数、AI 估时的展开）这里都没有** ——
 * 展厅要的是"这件事长什么样"，不是"能用它排期"。
 *
 * 🔴 要复现的**语义**只有一条，而它是这个视图的全部价值：
 * **条的宽度 = 估时的长短**。90 分钟那条一定明显长于 30 分钟那条。
 * 宽度档在 `timeline-shape.ts` 的登记处里，判据在
 * `tests/mockup-timeline-shape.spec.tsx`。
 */

import { useMemo } from 'react';

import { useI18n } from '@heyta/i18n/provider';

import {
  MOCK_TIMELINE_AXIS_KEYS,
  MOCK_TIMELINE_ROWS,
  mockTimelineBarClass,
} from './timeline-shape.js';

export function TimelineBoard(): React.JSX.Element {
  const { t } = useI18n();

  // 文案在组件内取（模块级拿不到 `t`）—— 取舍见 `Landing.tsx` 文件头。
  const days = useMemo(() => MOCK_TIMELINE_AXIS_KEYS.map((key) => t(key)), [t]);
  const rows = useMemo(
    () => MOCK_TIMELINE_ROWS.map((row) => ({ ...row, title: t(row.titleKey) })),
    [t],
  );

  return (
    <div className="mk-timeline">
      <div className="mk-timeline__axis">
        <span />
        <div className="mk-timeline__axis-days">
          {days.map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
      </div>
      {rows.map((row) => (
        <div key={row.title} className="mk-timeline__row">
          <span className="mk-timeline__label">{row.title}</span>
          <div className="mk-timeline__track">
            {/*
              日界线是**装饰**：真实信息在条的宽度与左侧标题上，
              读屏不该念出四条没有名字的线。
            */}
            <div className="mk-timeline__grid" aria-hidden />
            <div className={mockTimelineBarClass(row.width, row.ai)} />
          </div>
        </div>
      ))}
      <p className="mk-timeline__legend">{t('landing.mock.timeline.legend')}</p>
    </div>
  );
}
