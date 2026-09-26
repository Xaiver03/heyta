/**
 * 番茄钟
 * ========
 *
 * 计时状态与剩余量**全部来自 @heyta/domain**（`remainingMs` 每次重算）。
 * 组件只负责画。
 *
 * 环形进度用 SVG stroke-dasharray，不用第三方图表库 ——
 * 一个圆的成本远低于引入图表库。
 */

import { useEffect, useState } from 'react';
import { cssVar } from '@heyta/design-system';
import { useI18n } from '@heyta/i18n';
import { formatDuration } from '@heyta/domain';
import { Coffee, Pause, Play, Square, Zap } from 'lucide-react';

import { useTaskStore } from '../tasks/store.js';
import { isWorkPhase, selectProgress, selectRemaining, useFocusStore } from './store.js';

const RING_SIZE = 180;
const RING_STROKE = 10;

function Ring({ progress, work }: { progress: number; work: boolean }) {
  const { t } = useI18n();
  const radius = (RING_SIZE - RING_STROKE) / 2;
  const circumference = 2 * Math.PI * radius;
  // 进度从 0 开始逐渐填满；负的 dashoffset 表示已走过部分
  const offset = circumference * (1 - progress);

  return (
    <svg
      width={RING_SIZE}
      height={RING_SIZE}
      viewBox={`0 0 ${String(RING_SIZE)} ${String(RING_SIZE)}`}
      role="img"
      aria-label={t('web.focus.a11y.progress', { percent: Math.round(progress * 100) })}
      style={{ transform: 'rotate(-90deg)' }}
    >
      <circle
        cx={RING_SIZE / 2}
        cy={RING_SIZE / 2}
        r={radius}
        fill="none"
        stroke={cssVar('color.border')}
        strokeWidth={RING_STROKE}
      />
      <circle
        cx={RING_SIZE / 2}
        cy={RING_SIZE / 2}
        r={radius}
        fill="none"
        // 工作段与休息段用不同 token —— 颜色承载语义，不是装饰
        stroke={cssVar(work ? 'color.focus-work' : 'color.focus-break')}
        strokeWidth={RING_STROKE}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        style={{
          transition: `stroke-dashoffset ${cssVar('duration.fast')} linear`,
        }}
      />
    </svg>
  );
}

export function FocusTimer() {
  const { t } = useI18n();
  const focus = useFocusStore();
  const tasks = useTaskStore();
  const [now, setNow] = useState(() => Date.now());

  // 本地重绘节拍。**不参与计时计算** —— 剩余量永远由领域层重算。
  useEffect(() => {
    if (focus.state.phase !== 'running') return;
    const h = setInterval(() => {
      setNow(Date.now());
    }, 250);
    return () => {
      clearInterval(h);
    };
  }, [focus.state.phase, focus.tick]);

  const remaining = selectRemaining(focus, now);
  const progress = selectProgress(focus, now);
  const work = isWorkPhase(focus);
  const running = focus.state.phase === 'running';

  const aliveTasks = Object.values(tasks.entities.tasks).filter(
    (task) => task.deletedAt === undefined && task.completedAt === undefined,
  );

  const phaseText = work ? t('web.focus.phase.work') : t('web.focus.phase.break');
  // 🔴 词条表没有 ICU：1 个专注时英文必须走单数兄弟词条（"1 focus sessions" 是坏句子）。
  const completedText =
    focus.completedToday === 1
      ? t('web.focus.completedTodayOne', { count: focus.completedToday })
      : t('web.focus.completedToday', { count: focus.completedToday });

  return (
    <div
      style={{
        padding: cssVar('space.6'),
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: cssVar('space.4'),
      }}
    >
      <div style={{ position: 'relative', display: 'grid', placeItems: 'center' }}>
        <Ring progress={progress} work={work} />
        <div
          style={{
            position: 'absolute',
            textAlign: 'center',
            color: cssVar('color.foreground'),
          }}
        >
          <div
            style={{
              fontSize: cssVar('font-size.3xl'),
              fontWeight: cssVar('font-weight.bold'),
              // tabular-nums：否则秒数跳动时整个计时器左右晃
              fontVariantNumeric: 'tabular-nums',
              lineHeight: cssVar('line-height.tight'),
            }}
          >
            {formatDuration(remaining)}
          </div>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: cssVar('space.1'),
              fontSize: cssVar('font-size.2xs'),
              color: cssVar('color.foreground-muted'),
            }}
          >
            {work ? <Zap size={12} aria-hidden="true" /> : <Coffee size={12} aria-hidden="true" />}
            {phaseText}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: cssVar('space.2') }}>
        {!running ? (
          <button
            type="button"
            onClick={() => {
              focus.start(focus.state.taskId);
              setNow(Date.now());
            }}
            aria-label={t('web.focus.a11y.start')}
            style={buttonStyle('primary')}
          >
            <Play size={18} aria-hidden="true" />
            {t('web.focus.start')}
          </button>
        ) : (
          <button
            type="button"
            onClick={focus.pause}
            aria-label={t('web.focus.a11y.pause')}
            style={buttonStyle('ghost')}
          >
            <Pause size={18} aria-hidden="true" />
            {t('web.focus.pause')}
          </button>
        )}

        {focus.state.phase !== 'idle' && (
          <button
            type="button"
            onClick={() => {
              void focus.abort();
            }}
            aria-label={t('web.focus.a11y.stop')}
            style={buttonStyle('ghost')}
          >
            <Square size={18} aria-hidden="true" />
            {t('web.focus.stop')}
          </button>
        )}
      </div>

      {/* 关联任务：只列未完成的，避免选到一个已经做完的任务 */}
      <label
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: cssVar('space.1'),
          fontSize: cssVar('font-size.2xs'),
          color: cssVar('color.foreground-muted'),
          minWidth: cssVar('layout.sidebar-width'),
        }}
      >
        {t('web.focus.task.label')}
        <select
          value={focus.state.taskId ?? ''}
          onChange={(e) => {
            focus.start(e.target.value === '' ? undefined : e.target.value);
            setNow(Date.now());
          }}
          style={{
            minHeight: cssVar('touch-target.min'),
            padding: `0 ${cssVar('space.2')}`,
            borderRadius: cssVar('radius.md'),
            border: `${cssVar('border-width.thin')} solid ${cssVar('color.border')}`,
            background: cssVar('color.surface'),
            color: cssVar('color.foreground'),
            fontSize: cssVar('font-size.base'),
            fontFamily: cssVar('font.sans'),
          }}
        >
          <option value="">{t('web.focus.task.none')}</option>
          {aliveTasks.map((task) => (
            <option key={task.id} value={task.id}>
              {task.title}
            </option>
          ))}
        </select>
      </label>

      <div
        style={{
          fontSize: cssVar('font-size.2xs'),
          color: cssVar('color.foreground-muted'),
          // 数字跳动时宽度不跳；顺带覆盖到整句，无副作用。
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {completedText}
      </div>

      {focus.error !== undefined && (
        <p role="alert" style={{ color: cssVar('color.danger'), fontSize: cssVar('font-size.sm') }}>
          {t('web.focus.error.saveFailed', { reason: focus.error.reason })}
        </p>
      )}
    </div>
  );
}

function buttonStyle(variant: 'primary' | 'ghost'): React.CSSProperties {
  const primary = variant === 'primary';
  return {
    minHeight: cssVar('touch-target.min'),
    minWidth: cssVar('touch-target.min'),
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: cssVar('space.2'),
    padding: `0 ${cssVar('space.4')}`,
    cursor: 'pointer',
    borderRadius: cssVar('radius.md'),
    border: `${cssVar('border-width.thin')} solid ${
      primary ? 'transparent' : cssVar('color.border')
    }`,
    background: primary ? cssVar('color.primary') : 'transparent',
    color: primary ? cssVar('color.on-primary') : cssVar('color.foreground'),
    fontSize: cssVar('font-size.sm'),
    fontFamily: cssVar('font.sans'),
    transition: `background ${cssVar('duration.fast')} ${cssVar('ease.standard')}`,
  };
}
