/**
 * 番茄钟（Web 壳）
 * ==================
 *
 * 🔴 M3 第二刀之后，这个文件**只剩接线**。
 *
 * 计时核心（进度环、倒计时、阶段、主按钮 / 中止按钮、无障碍）已经从两端
 * 收进 `@heyta/ui` 的 `FocusPanel` —— 与 mobile 是**同一份实现**。
 * 这里只回答 web 自己的两个问题：
 *
 *   1. 计时状态从哪来 → `./store.js`（状态机与落盘都在 `packages/`）
 *   2. 页面周边挂什么 → 关联任务下拉 + 时长设置（这两个是 web 特有的入口）
 *
 * 计时状态与剩余量**全部来自 @heyta/domain**（`remainingMs` 每次重算）。
 * 组件只负责画。
 */

import { useEffect, useState } from 'react';
import { cssVar } from '@heyta/design-system';
import { useI18n, type MessageKey } from '@heyta/i18n';
import { FocusPanel } from '@heyta/ui';

import { useTaskStore } from '../tasks/store.js';
import {
  FOCUS_CONFIG_BOUNDS,
  focusConfigToDraft,
  draftToFocusConfig,
  type FocusConfigDraft,
} from '../../lib/focus-config.js';
import { useFocusStore } from './store.js';

/**
 * 时长设置
 * ==========
 *
 * 🔴 **它修的是一个"控件存在、入口不存在"的洞**：`useFocusStore.setConfig`
 * 一直有实现，但**零调用点** —— 于是时长永远 25/5/15，用户改不了。
 *
 * ## 为什么只在 idle 时可改
 *
 * 本轮的计划时长在 `start()` 那一刻就冻结进了 `state.plannedMs`（进度环与
 * 落盘的 `FocusSession.plannedMs` 都用它）。进行中改只有两种结果：本轮不变
 * （用户以为改了）或本轮跟着变（进度环跳一下、落盘的计划时长与实际不符）。
 * 两种都比"暂时不让改"更坏。store 侧也拦了一道（`setConfig` 返回 `false`），
 * **不靠这个 `disabled` 属性当唯一防线**。
 *
 * ## 为什么失焦才写回
 *
 * 受控输入在打字过程中**必然**经过空串与中间态（想把 25 改成 180，中途会有
 * `1`、`18`）。每次 `onChange` 就夹取并写 store 的话，用户会看到光标乱跳、
 * 数字被改成他没打的东西。所以这里持一份字符串草稿，**失焦时**才夹取落库 ——
 * 夹取结果因此是**看得见**的（用户能看到自己被打到哪个值）。
 *
 * 上限/下限的取值与理由在 `lib/focus-config.ts`。
 *
 * ⚠️ 它**没有**搬进共享层：时长是设备本地的偏好（`localStorage`），
 * mobile 现在没有这个入口，配置用的是领域默认值。等手机端也做时长设置时，
 * 应当把"字段 + 夹取 + 无障碍名"这部分提进 `packages/ui`，
 * 而不是把这一整段抄过去。
 */
function DurationSettings() {
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
    // 空串 / 打不出数字时**保留原值**，不要回落成默认值 ——
    // 那会让"清空输入框"顺手把这一项重置成 25。
    const candidate = {
      ...current,
      [key]: Number.isNaN(parsed) ? current[key] : parsed,
    };
    // store 侧在非 idle 时会拒绝；这里不重复判断，避免两处判据漂移。
    focus.setConfig(draftToFocusConfig(candidate));
    setDraft((d) => {
      const { [key]: _dropped, ...rest } = d;
      return rest;
    });
  }

  return (
    <fieldset
      disabled={locked}
      style={{
        border: `${cssVar('border-width.thin')} solid ${cssVar('color.border')}`,
        borderRadius: cssVar('radius.md'),
        padding: cssVar('space.3'),
        margin: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: cssVar('space.2'),
        minWidth: cssVar('layout.sidebar-width'),
      }}
    >
      <legend
        style={{
          fontSize: cssVar('font-size.2xs'),
          color: cssVar('color.foreground-muted'),
          padding: `0 ${cssVar('space.1')}`,
        }}
      >
        {t('web.focus.config.title')}
      </legend>

      {fields.map((f) => {
        const bounds = FOCUS_CONFIG_BOUNDS[f.key];
        const label = t(f.labelKey);
        return (
          <label
            key={f.key}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: cssVar('space.2'),
              fontSize: cssVar('font-size.sm'),
              color: cssVar('color.foreground'),
            }}
          >
            {label}
            <input
              type="number"
              // `inputMode` 让移动端弹数字键盘；`min`/`max` 是**给浏览器与
              // 读屏软件的提示**，不是防线 —— 真正的防线是 store 前的夹取。
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
              style={{
                width: '5rem',
                minHeight: cssVar('touch-target.min'),
                padding: `0 ${cssVar('space.2')}`,
                borderRadius: cssVar('radius.md'),
                border: `${cssVar('border-width.thin')} solid ${cssVar('color.border')}`,
                background: cssVar('color.surface'),
                color: cssVar('color.foreground'),
                fontSize: cssVar('font-size.base'),
                fontFamily: cssVar('font.sans'),
                // 数字列对齐，且改变时不抖
                fontVariantNumeric: 'tabular-nums',
              }}
            />
          </label>
        );
      })}

      {/* 🔴 锁住时必须说明原因。灰掉一个控件却不解释，用户只会以为界面坏了。 */}
      {locked && (
        <p
          style={{
            margin: 0,
            fontSize: cssVar('font-size.2xs'),
            color: cssVar('color.foreground-muted'),
          }}
        >
          {t('web.focus.config.locked')}
        </p>
      )}
    </fieldset>
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

  // 关联任务：只列未完成的，避免选到一个已经做完的任务。
  const aliveTasks = Object.values(tasks.entities.tasks).filter(
    (task) => task.deletedAt === undefined && task.completedAt === undefined,
  );

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
      <FocusPanel
        state={focus.state}
        now={now}
        labels={{
          // web 的阶段行只区分工作段 / 休息段（手机端更细，见那边的 labels）——
          // 文案归属词条表，所以由这一侧注入。
          phase: (state) => (state.kind === 'work' ? t('web.focus.phase.work') : t('web.focus.phase.break')),
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
          completed: completedText,
          ...(focus.error === undefined
            ? {}
            : { error: t('web.focus.error.saveFailed', { reason: focus.error.reason }) }),
        }}
        onStart={() => {
          focus.start(focus.state.taskId);
          setNow(Date.now());
        }}
        onPause={focus.pause}
        onResume={focus.resume}
        onAbort={() => {
          void focus.abort();
        }}
      >
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

        <DurationSettings />
      </FocusPanel>
    </div>
  );
}
