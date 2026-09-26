/**
 * 真实界面复现：番茄钟
 * ======================
 *
 * 复现对象：`apps/web/src/features/focus/FocusTimer.tsx`。
 *
 * 🔴 三条必须一起复现的细节：
 *   1. 环形进度用 **SVG stroke-dasharray**，不引入图表库 —— 一个圆的成本
 *      远低于一个库（真实组件就是这么做的，注释里写着理由）。
 *   2. 计时数字必须 `.tabular-nums`（这里是 `font-variant-numeric`），
 *      否则秒数跳动时整个计时器会左右晃。
 *   3. 工作段与休息段用**不同 token**（`color.focus-work` / `color.focus-break`）——
 *      颜色承载语义，不是装饰。
 *
 * 数值取的是"一段进行到 9 分 28 秒的 25 分钟专注"，
 * 所以剩 15:32、进度 37.9% —— 不是随手写一个 50%。
 */

import { Coffee, Pause, Play, Square, Zap } from 'lucide-react';

import { useI18n } from '@heyta/i18n';

/** SVG 用户单位，**不是 px** —— 实际尺寸由 width/height 的 rem 值决定。 */
const VIEWBOX = 180;
const STROKE = 10;

const TOTAL_SECONDS = 25 * 60;
const ELAPSED_SECONDS = 9 * 60 + 28;
const REMAINING_SECONDS = TOTAL_SECONDS - ELAPSED_SECONDS;

function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function Ring({ progress }: { progress: number }): React.JSX.Element {
  const radius = (VIEWBOX - STROKE) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - progress);

  return (
    <svg
      width="11.25rem"
      height="11.25rem"
      viewBox={`0 0 ${String(VIEWBOX)} ${String(VIEWBOX)}`}
      style={{ transform: 'rotate(-90deg)' }}
    >
      <circle
        cx={VIEWBOX / 2}
        cy={VIEWBOX / 2}
        r={radius}
        fill="none"
        stroke="var(--ht-color-border)"
        strokeWidth={STROKE}
      />
      <circle
        cx={VIEWBOX / 2}
        cy={VIEWBOX / 2}
        r={radius}
        fill="none"
        stroke="var(--ht-color-focus-work)"
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
      />
    </svg>
  );
}

export function FocusRing(): React.JSX.Element {
  const progress = ELAPSED_SECONDS / TOTAL_SECONDS;
  const { t } = useI18n();

  return (
    <div className="mk-focus">
      <div className="mk-focus__ring">
        <Ring progress={progress} />
        <div className="mk-focus__readout">
          <div className="mk-focus__time">{formatClock(REMAINING_SECONDS)}</div>
          <div className="mk-focus__phase">
            <Zap size={12} />
            {t('landing.mock.focus.phase')}
          </div>
        </div>
      </div>

      <div className="mk-focus__actions">
        <div className="mk-btn-primary">
          <Pause size={18} />
          {t('landing.mock.focus.pause')}
        </div>
        <div className="mk-viewtab">
          <Square size={18} />
          {t('landing.mock.focus.stop')}
        </div>
      </div>

      {/* 关联任务：只列未完成的，避免选到一个已经做完的任务 */}
      <div className="mk-input" style={{ inlineSize: 'var(--ht-layout-sidebar-width)' }}>
        {t('landing.mock.focus.linkedTask', { task: t('landing.mock.task.weeklyReport') })}
      </div>

      <div className="mk-focus__stat">
        {t('landing.mock.focus.completedToday')}
        <span style={{ marginInlineStart: 'var(--ht-space-2)' }}>
          <Coffee size={12} style={{ display: 'inline' }} /> {t('landing.mock.focus.break5')}
        </span>
      </div>

      <div className="mk-viewtab">
        <Play size={14} />
        {t('landing.mock.focus.startNext')}
      </div>
    </div>
  );
}
