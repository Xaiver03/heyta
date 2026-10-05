/**
 * 任务行上的「重复」控件（B2-3 的 Web 入口 + 自定义 RRULE）
 * ==========================================================
 *
 * 🔴 **这个文件补的是 Web 端的一个真实空洞。**
 *
 * 在此之前，「重复」在仓库里的状态是**两端不一致**的：`Task.repeatRule` /
 * `repeatDtstart` 有字段、`TaskActions.setRepeat` 有动作、`repeatPresets` 有
 * 产品语义（"每周"到底是哪一天、"工作日"包含哪几天），移动端的任务详情里
 * 也早就能设 —— 而 **Web 端一个入口都没有**。也就是说：同一个用户在手机上
 * 设的重复，到 Web 上连"看得见"都做不到，更别说改。
 *
 * 这一刀补两件事：
 *   1. **Web 入口**：不重复 / 每天 / 每周 / 工作日 / 每月（与移动端同一套预设，
 *      规则串由 `@heyta/app-host` 的 `repeatPresetRule()` 构造）；
 *   2. **自定义 RRULE**：一个文本输入 + 校验。这是移动端也**还没有**的一半 ——
 *      "每两周""每月最后一个工作日"这类规则只能靠它。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 三个刻意的决定
 *
 * 1. **当前规则常驻可见（chip），编辑控件收进 `<details>`** —— 与 `TaskOrganizer`
 *    同一条理由：扫一眼列表要能看出哪些任务是重复的。
 * 2. **不是预设的规则必须显示出来**（例如另一台设备设的"每两周"）。否则面板看
 *    上去像"这条任务不重复"，而用户一点「每天」就把那条规则悄悄换掉了。
 * 3. **校验在调用前做，错误就地显示**。`setRepeat` 对非法规则会**抛**，
 *    但我们不该让用户靠一次失败来发现"这个串不合法"。
 *
 * 🔴 本文件里**没有一行业务逻辑**：预设有哪几个、锚点怎么钉、非法规则怎么判、
 * 缺截止日时要不要顺手补一个 —— 全在 `@heyta/app-host` / `@heyta/domain`。
 * 这里只做两件事：把用户想要的那条规则算出来，然后交给 store。
 */

import { useState } from 'react';

import { REPEAT_PRESET_IDS, repeatPresetRule, type RepeatPresetId } from '@heyta/app-host';
import { cssVar } from '@heyta/design-system';
import { isValidRecurrenceRule, toLocalDate, type Task } from '@heyta/domain';
import { useI18n, type MessageKey } from '@heyta/i18n';
import { Repeat } from 'lucide-react';

/** chip 与图标尺寸。**不许在 JSX 里散落字面量。** */
const CHIP_ICON_SIZE = 12;
const TRIGGER_ICON_SIZE = 14;

/** 预设 → 词条。**穷举**：加一个预设却忘了加词条会编译失败。 */
const PRESET_LABEL_KEYS: Record<RepeatPresetId, MessageKey> = {
  daily: 'web.repeat.daily',
  weekly: 'web.repeat.weekly',
  weekdays: 'web.repeat.weekdays',
  monthly: 'web.repeat.monthly',
  yearly: 'web.repeat.yearly',
};

/** 自定义输入的两种失败。用**结构化枚举**而不是文案，文案由词条表给。 */
type CustomError = 'empty' | 'invalid';

const CUSTOM_ERROR_KEYS: Record<CustomError, MessageKey> = {
  empty: 'web.repeat.error.empty',
  invalid: 'web.repeat.error.invalid',
};

/**
 * 锚点必须与 `TaskActions.setRepeat` 将要钉的**同一个日期**
 * （`dueDate ? toLocalDate(dueDate) : today`）—— 否则「每周」会选中锚点
 * 所在那一周的另一天，用户看到的日期和他点的那一项对不上。
 *
 * 🔴 徽标与编辑本体**共用这一份判定**：分成两份就是两套裁决标准 ——
 * 症状是"chip 显示「每天」而面板里单选停在「不重复」"，两边都没报错。
 */
function repeatView(task: Task, now: number): {
  anchor: string;
  current: string | undefined;
  activePreset: RepeatPresetId | undefined;
  customRule: string | undefined;
} {
  const anchor = toLocalDate(task.dueDate ?? now);
  const current = task.repeatRule;
  const activePreset =
    current === undefined
      ? undefined
      : REPEAT_PRESET_IDS.find((id) => repeatPresetRule(id, anchor) === current);
  /** 不属于任何预设的规则（另一台设备设的，或用户自定义的）。 */
  return { anchor, current, activePreset, customRule: current !== undefined && activePreset === undefined ? current : undefined };
}

const chipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: cssVar('space.1'),
  padding: `${cssVar('space.1')} ${cssVar('space.2')}`,
  borderRadius: cssVar('radius.full'),
  fontSize: cssVar('font-size.xs'),
  color: cssVar('color.foreground-muted'),
  whiteSpace: 'nowrap',
};

/**
 * 行尾那枚**只读**徽标（`record` 档：没设重复就整个不出现）。
 *
 * 🔴 工单 §8.141 起它也是"栏里那一格拿着编辑器时，列表侧剩下的唯一痕迹"——
 * 与 `NoteBadge` 同一条不变量：同一字段任何时刻只有一个编辑器所有者，
 * 但"扫一眼要能看出哪些任务是重复的"这一档不能因为搬进栏里就丢掉。
 * 不属于任何预设的规则显示原串（它本来就是用户或另一台设备输入的）。
 */
export function RepeatChip({ task, now }: { task: Task; now: number }): React.JSX.Element | null {
  const { t } = useI18n();
  const { current, activePreset } = repeatView(task, now);
  const chipText =
    current === undefined
      ? undefined
      : activePreset !== undefined
        ? t(PRESET_LABEL_KEYS[activePreset])
        : t('web.repeat.customChip', { rule: current });
  if (chipText === undefined) return null;
  return (
    <span style={chipStyle} data-testid="task-chip-repeat">
      <Repeat size={CHIP_ICON_SIZE} aria-hidden="true" />
      {chipText}
    </span>
  );
}

/**
 * 「重复」的**编辑本体**：预设单选 + 自定义 RRULE + 就地校验。
 *
 * 🔴 一份实现、两个落点：行尾那颗 chip 展开的浮层（`TaskRepeat`）与栏里那一格
 * （`TaskDetailCard`）。浮层的玻璃面板外壳**不在这里** —— 它是"在哪儿画"的细节，
 * 不是字段本体；把它留在调用方，栏里那一格才不会拿到一枚 `position: absolute` 的浮层。
 */
export function RepeatField({
  task,
  onSetRepeat,
  now,
}: {
  task: Task;
  /** 传 `undefined` 表示取消重复。 */
  onSetRepeat: (rule: string | undefined) => void;
  /** 用于算锚点（`dueDate` 缺省时按"今天"算）。 */
  now: number;
}): React.JSX.Element {
  const { t } = useI18n();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<CustomError | undefined>(undefined);

  const { anchor, current, activePreset, customRule } = repeatView(task, now);

  /** 应用自定义 RRULE。**先校验再调用** —— 不靠一次失败来告诉用户串不合法。 */
  const applyCustom = (): void => {
    const rule = draft.trim();
    if (rule === '') {
      setError('empty');
      return;
    }
    if (!isValidRecurrenceRule(rule)) {
      setError('invalid');
      return;
    }
    setError(undefined);
    onSetRepeat(rule);
    setDraft('');
  };

  return (
    <>
  <fieldset
        style={{
          margin: 0,
          padding: 0,
          border: 'none',
          display: 'flex',
          flexDirection: 'column',
          gap: cssVar('space.1'),
        }}
      >
        <legend
          style={{
            padding: 0,
            fontSize: cssVar('font-size.xs'),
            color: cssVar('color.foreground-muted'),
          }}
        >
          {t('web.repeat.legend')}
        </legend>

        {/*
          🔴 单选的 `name` **必须带上任务 id**：不带的话，同一页里所有
          任务行的单选会变成**同一组** —— 点第二条任务的「每天」会把
          第一条任务的选中态取消掉，而数据其实没变（纯视觉的假象）。
        */}
        {(() => {
          const groupName = `repeat-${task.id}`;
          const option = (
            value: string,
            label: string,
            checked: boolean,
            onPick: () => void,
          ): React.JSX.Element => (
            <label
              key={value}
              style={{ display: 'flex', alignItems: 'center', gap: cssVar('space.2') }}
            >
              <input
                type="radio"
                name={groupName}
                checked={checked}
                aria-label={t('web.repeat.optionAria', { label, title: task.title })}
                onChange={onPick}
              />
              {label}
            </label>
          );

          return (
            <>
              {option(t('web.repeat.none'), t('web.repeat.none'), current === undefined, () => {
                onSetRepeat(undefined);
              })}
              {REPEAT_PRESET_IDS.map((id) => {
                const label = t(PRESET_LABEL_KEYS[id]);
                return option(label, label, activePreset === id, () => {
                  const rule = repeatPresetRule(id, anchor);
                  // 锚点非法时 `repeatPresetRule` 返回 undefined。
                  // **什么都不做**而不是发一条垃圾规则：一条 `BYDAY=undefined`
                  // 能通过 `isValidRecurrenceRule`（FREQ 还在），但一次都不命中。
                  if (rule === undefined) return;
                  onSetRepeat(rule);
                });
              })}
              {/* 不是预设的规则必须显示出来，否则面板看上去像"不重复"。 */}
              {customRule !== undefined &&
                option(
                  t('web.repeat.customChip', { rule: customRule }),
                  t('web.repeat.customChip', { rule: customRule }),
                  true,
                  () => {
                    onSetRepeat(undefined);
                  },
                )}
            </>
          );
        })()}
      </fieldset>

      {/* ── 自定义 RRULE ─────────────────────────────────────────── */}
      <label style={{ display: 'flex', flexDirection: 'column', gap: cssVar('space.1') }}>
        <span
          style={{ fontSize: cssVar('font-size.xs'), color: cssVar('color.foreground-muted') }}
        >
          {t('web.repeat.customLabel')}
        </span>
        <input
          type="text"
          value={draft}
          placeholder={t('web.repeat.customPlaceholder')}
          aria-label={t('web.repeat.customAria', { title: task.title })}
          data-testid="task-repeat-custom-input"
          onChange={(event) => {
            setDraft(event.target.value);
            // 用户一开始改输入就把上一次的报错清掉 —— 让错误信息跟着输入走。
            setError(undefined);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              applyCustom();
            }
          }}
        />
      </label>
      <div style={{ display: 'flex', alignItems: 'center', gap: cssVar('space.2') }}>
        <button type="button" data-testid="task-repeat-custom-apply" onClick={applyCustom}>
          {t('web.repeat.apply')}
        </button>
        {error !== undefined && (
          <span
            role="alert"
            data-testid="task-repeat-error"
            style={{ fontSize: cssVar('font-size.xs'), color: cssVar('color.danger') }}
          >
            {t(CUSTOM_ERROR_KEYS[error])}
          </span>
        )}
      </div>
    </>
  );
}

/**
 * 行尾那一整块：只读徽标 + `<details>` 触发的玻璃浮层。
 *
 * 🔴 浮层外壳（`.ht-material` + `position: absolute`）**只活在这里** ——
 * 它是"这一格在哪儿画"的细节。栏里那一格直接挂 `RepeatField`，
 * 拿到的是同一片控件而不是一枚贴着行右侧的浮层。
 */
export function TaskRepeat({
  task,
  onSetRepeat,
  now,
}: {
  task: Task;
  onSetRepeat: (rule: string | undefined) => void;
  now: number;
}): React.JSX.Element {
  const { t } = useI18n();
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: cssVar('space.2'),
        position: 'relative',
      }}
    >
      <RepeatChip task={task} now={now} />

      <details>
        {/* 无障碍名带上任务标题：一长串列表里听到二十个「重复」无从分辨。 */}
        <summary
          aria-label={t('web.repeat.summary', { title: task.title })}
          data-testid="task-repeat-summary"
        >
          <Repeat size={TRIGGER_ICON_SIZE} aria-hidden="true" />
        </summary>

        <div
          className="ht-material"
          style={{
            position: 'absolute',
            zIndex: cssVar('z.popover'),
            insetInlineEnd: 0,
            marginBlockStart: cssVar('space.2'),
            padding: cssVar('space.3'),
            display: 'flex',
            flexDirection: 'column',
            gap: cssVar('space.3'),
            border: `${cssVar('border-width.thin')} solid ${cssVar('color.border')}`,
            borderRadius: cssVar('radius.lg'),
            boxShadow: cssVar('shadow.lg'),
          }}
        >
          <RepeatField task={task} onSetRepeat={onSetRepeat} now={now} />
        </div>
      </details>
    </span>
  );
}
