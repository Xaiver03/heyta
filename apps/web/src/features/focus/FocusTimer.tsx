/**
 * 番茄钟（Web 壳 · 单轴沉浸布局）
 * ================================
 *
 * 计时核心来自 `@heyta/ui` 的共享 `FocusPanel`。
 * Web 侧与移动端保持同一套呼吸感与交互解剖：
 *   1. 环正上方居中唯一轻入口 `专注 ›`（已关联时显示 `{任务标题} ›`），点开浮层选择任务，
 *      不再在圆环底下堆「关联任务（可选）」表单标签与灰底下拉框；
 *   2. 去掉与右栏概览卡重复的「今日已完成 N 个专注」文字；
 *   3. 空闲倒计时态点击中央大数字 `25:00`（或下方轻收起项）即可展开时长设置。
 */

import { useEffect, useRef, useState } from 'react';
import { ICON_SIZE } from '@heyta/design-system';
import { Check, ChevronRight } from 'lucide-react';
import { useI18n, type MessageKey } from '@heyta/i18n';
import { FocusPanel, focusLogFailureMessageKey } from '@heyta/ui';

import { FormField } from '../../lib/form/FormField.js';
import { useTaskStore } from '../tasks/store.js';
import {
  FOCUS_CONFIG_BOUNDS,
  draftToFocusConfig,
  focusConfigToDraft,
  type FocusConfigDraft,
} from '../../lib/focus-config.js';
import { useSelected } from '../../lib/selection.js';
import { useFocusStore } from './store.js';
import { NoiseSettings } from './NoiseSettings.js';

function DurationSettings({
  open,
  onToggle,
}: {
  readonly open: boolean;
  readonly onToggle: (next: boolean) => void;
}) {
  const { t } = useI18n();
  const focus = useFocusStore();
  const locked = focus.state.phase !== 'idle';
  const [draft, setDraft] = useState<Partial<Record<keyof FocusConfigDraft, string>>>({});

  const current = focusConfigToDraft(focus.config);

  const fields = [
    { key: 'workMinutes', labelKey: 'web.focus.config.work', unit: 'minutes' },
    { key: 'shortBreakMinutes', labelKey: 'web.focus.config.shortBreak', unit: 'minutes' },
    { key: 'longBreakMinutes', labelKey: 'web.focus.config.longBreak', unit: 'minutes' },
    { key: 'longBreakEvery', labelKey: 'web.focus.config.longBreakEvery', unit: 'sessions' },
  ] as const satisfies readonly {
    key: keyof FocusConfigDraft;
    labelKey: MessageKey;
    unit: 'minutes' | 'sessions';
  }[];

  function commit(key: keyof FocusConfigDraft, raw: string): void {
    const parsed = Number.parseInt(raw, 10);
    const candidate = {
      ...current,
      [key]: Number.isNaN(parsed) ? current[key] : parsed,
    };
    focus.setConfig(draftToFocusConfig(candidate));
    setDraft((d) => {
      const { [key]: _dropped, ...rest } = d;
      return rest;
    });
  }

  return (
    <details
      className="ht-app__focus-settings"
      data-testid="focus-config"
      open={open}
      onToggle={(e) => {
        onToggle(e.currentTarget.open);
      }}
    >
      <summary className="ht-app__focus-settings-toggle" data-testid="focus-config-toggle">
        <span>{t('web.focus.config.title')}</span>
        <span className="ht-app__focus-settings-summary" aria-hidden="true">
          {t('web.focus.config.minutes', { minutes: current.workMinutes })}
        </span>
      </summary>
      <fieldset disabled={locked} className="ht-app__focus-settings-fields">
        <legend className="ht-app__focus-settings-legend">{t('web.focus.config.title')}</legend>

        {fields.map((f) => {
          const bounds = FOCUS_CONFIG_BOUNDS[f.key];
          const label = t(f.labelKey);
          return (
            <FormField key={f.key} id={`focus-config-${f.key}`} label={label} layout="inline">
              {(field) => (
                <input
                  {...field}
                  type="number"
                  inputMode="numeric"
                  min={bounds.min}
                  max={bounds.max}
                  step={1}
                  value={draft[f.key] ?? String(current[f.key])}
                  aria-label={
                    f.unit === 'minutes'
                      ? t('web.focus.config.a11y.minutes', { label })
                      : t('web.focus.config.a11y.sessions', { label })
                  }
                  onChange={(e) => {
                    setDraft((d) => ({ ...d, [f.key]: e.target.value }));
                  }}
                  onBlur={(e) => {
                    commit(f.key, e.target.value);
                  }}
                />
              )}
            </FormField>
          );
        })}

        {locked && (
          <p className="ht-app__focus-settings-locked">{t('web.focus.config.locked')}</p>
        )}
      </fieldset>
    </details>
  );
}

export function FocusTimer() {
  const { t } = useI18n();
  const focus = useFocusStore();
  const tasks = useTaskStore();
  const [now, setNow] = useState(() => Date.now());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const selectedTaskId = useSelected('task');

  useEffect(() => {
    if (focus.state.phase !== 'running') return;
    const h = setInterval(() => {
      setNow(Date.now());
    }, 250);
    return () => {
      clearInterval(h);
    };
  }, [focus.state.phase, focus.tick]);

  useEffect(() => {
    if (focus.state.phase !== 'idle') setPickerOpen(false);
  }, [focus.state.phase]);

  useEffect(() => {
    if (!pickerOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPickerOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [pickerOpen]);

  const allAliveTasks = Object.values(tasks.entities.tasks).filter(
    (task) => task.deletedAt === undefined,
  );
  const pendingTasks = allAliveTasks.filter((task) => task.completedAt === undefined);

  const activeTaskId =
    (focus.state.phase === 'idle' ? selectedTaskId : focus.state.taskId) ?? '';
  const linkedTask =
    activeTaskId === '' ? undefined : allAliveTasks.find((task) => task.id === activeTaskId);

  const idle = focus.state.phase === 'idle';
  const defaultPhaseTitle =
    focus.state.kind === 'work' ? t('web.focus.phase.work') : t('web.focus.phase.break');
  const targetTitle = linkedTask?.title ?? defaultPhaseTitle;

  const saveFailedKey =
    focusLogFailureMessageKey(focus.error?.code) ?? 'web.focus.error.saveFailed';

  const selectTask = (nextId: string): void => {
    if (!idle) return;
    const next = nextId === '' ? null : nextId;
    selection.select('task', next);
    if (next === null) focus.clearLinkedTask();
    setPickerOpen(false);
  };

  const targetHeader = (
    <div className="ht-app__focus-target-wrap" ref={pickerRef}>
      <button
        type="button"
        className="ht-app__focus-target ht-type-row-title"
        data-testid="focus-linked-task"
        disabled={!idle}
        aria-haspopup="listbox"
        aria-expanded={pickerOpen}
        onClick={() => {
          if (idle) setPickerOpen((prev) => !prev);
        }}
      >
        <span className="ht-app__focus-target-label">{targetTitle}</span>
        {idle ? <ChevronRight size={ICON_SIZE.sm} aria-hidden="true" /> : null}
      </button>

      {pickerOpen && idle ? (
        <div
          className="ht-app__focus-target-menu"
          role="listbox"
          aria-label={t('web.focus.task.label')}
          data-testid="focus-linked-task-menu"
        >
          <button
            type="button"
            role="option"
            aria-selected={activeTaskId === ''}
            className="ht-app__focus-target-option"
            data-testid="focus-linked-task-none"
            onClick={() => selectTask('')}
          >
            <span className="ht-app__focus-target-option-text">{t('web.focus.task.none')}</span>
            {activeTaskId === '' ? <Check size={ICON_SIZE.sm} aria-hidden="true" /> : null}
          </button>
          {pendingTasks.map((task) => {
            const isSelected = activeTaskId === task.id;
            return (
              <button
                key={task.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                className="ht-app__focus-target-option"
                data-value={task.id}
                onClick={() => selectTask(task.id)}
              >
                <span className="ht-app__focus-target-option-text">{task.title}</span>
                {isSelected ? <Check size={ICON_SIZE.sm} aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="ht-app__focus">
      <FocusPanel
        state={focus.state}
        now={now}
        fill
        header={targetHeader}
        onTimePress={() => {
          setConfigOpen((prev) => !prev);
        }}
        timePressA11y={t('web.focus.config.title')}
        modeLabels={{
          group: t('web.focus.mode.group'),
          countdown: t('web.focus.mode.countdown'),
          countup: t('web.focus.mode.countup'),
        }}
        onModeChange={(mode) => {
          focus.selectMode(mode);
        }}
        labels={{
          phase: (state) =>
            state.phase === 'paused'
              ? t('web.focus.pause')
              : state.phase === 'running' && state.kind !== 'work'
                ? t('web.focus.phase.break')
                : undefined,
          primary: (action) =>
            action === 'pause'
              ? t('web.focus.pause')
              : action === 'resume'
                ? t('web.focus.resume')
                : t('web.focus.start'),
          primaryA11y: (action) =>
            action === 'pause'
              ? t('web.focus.a11y.pause')
              : action === 'resume'
                ? t('web.focus.a11y.resume')
                : t('web.focus.a11y.start'),
          abort: t('web.focus.stop'),
          ring: (percent) => t('web.focus.a11y.progress', { percent }),
          ...(focus.error === undefined
            ? {}
            : { error: t(saveFailedKey, { reason: focus.error.reason }) }),
        }}
        onStart={() => {
          focus.start(selectedTaskId ?? undefined);
          setNow(Date.now());
        }}
        onPause={focus.pause}
        onResume={focus.resume}
        onAbort={() => {
          void focus.abort();
        }}
      >
        <DurationSettings open={configOpen} onToggle={setConfigOpen} />

        {/* 白噪音（覆盖图谱 #51）：与「时长设置」同族的次级入口，默认收起。 */}
        <NoiseSettings />
      </FocusPanel>
    </div>
  );
}
