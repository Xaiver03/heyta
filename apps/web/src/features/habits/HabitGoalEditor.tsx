import { ICON_SIZE } from '@heyta/design-system';
/**
 * 习惯目标编辑器（数值 / 单位 / 达成口径）
 * ==========================================
 *
 * 🔴 **这个控件补的是一处真实的空洞**：
 * `Habit` 有 `target` / `unit` / `goalType`，`packages/domain` 的 `isAchieved`
 * 把三种口径（`atLeast` / `atMost` / `exactly`）**全实现了**，
 * `checkIn` 也收 `value` —— 但界面上**一直没有任何地方能改它们**。
 *
 * ⇒ 结果是只能建"每天做一次"的习惯：默认 `target: 1` + `atLeast` 长得**完全正常**，
 * 所以看不出缺了什么。而"每天 8 杯水""每天 30 分钟""一天最多 2 杯咖啡"
 * 这三类**计数型 / 时长型**习惯到不了用户手里 ——
 * 这正是本仓反复记过的"模型有、界面不可达，且不报错"。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 三个刻意的决定
 *
 * 1. **展开式，不是浮层。** 与 `ColorSlotPicker` 同一条取舍：浮层要处理定位、
 *    层级、点外部关闭、键盘焦点陷阱，而它出现在每一个习惯卡片上 ——
 *    那些复杂度换不来任何东西。展开的是一行控件，`Esc` 收起。
 *
 * 2. **三个字段一次提交（一条 UPD）。** 数值 / 单位 / 口径是同一个语义
 *    （"这个习惯的目标是什么"），分三次写会产出三条 op，
 *    而同步到别的设备上会出现"每天 8 杯"但口径还是旧的这种中间态。
 *
 * 3. **非法数值在本地就拦下并明说。** app-host 会抛（负数/非有限数会让
 *    `isAchieved` 恒真或恒假），但把 `0` 当成非法值是错的 ——
 *    `atMost` + `0` 是"一次都不碰"，完全合法。所以本地只拦**空 / 非数字 / 负数**。
 */

import { useState } from 'react';
import { FormField } from '../../lib/form/FormField.js';
import { cssVar } from '@heyta/design-system';
import { useI18n } from '@heyta/i18n';
import type { Habit, HabitGoalType } from '@heyta/domain';
import { habitGoalSummaryKey } from '@heyta/ui';
import { Target } from 'lucide-react';

interface HabitGoalEditorProps {
  habit: Habit;
  /** 一次提交三个字段（见文件头第 2 条）。失败会 reject —— 由这里接住并显示。 */
  onSetGoal: (goal: { target?: number; unit?: string; goalType?: HabitGoalType }) => Promise<void>;
}

/**
 * 目标的一句话摘要（未设单位时补一个通用的「次」，不然会渲染成「至少 8」）。
 *
 * 🔴 **三条各自的词条，不是「一条 `{type} {target}{unit}` 再拼 type」**。
 * 第一版就是拼的，被 `check:ui-language` 当场拦下：那条模板**一个汉字都没有**
 * ——纯占位符的 zh 词条与"忘了翻译"在门禁眼里是同一件事，
 * 而把 type 拼进去还会让两种语言的语序无法各自调整。
 */
function summaryOf(
  t: (key: never, vars?: Record<string, unknown>) => string,
  goalType: HabitGoalType,
  target: number,
  unit: string,
): string {
  // 🔴 **口径 → key 的映射在共享层**（`@heyta/ui` 的 `habitGoalSummaryKey`）——
  // web 与 mobile 各有一个目标编辑器，而"哪种口径说哪句话"是同一个判断。
  // 各写一份的症状是"同一个 atMost，web 说『最多』、移动端说『不超过』"。
  return t(habitGoalSummaryKey(goalType) as never, {
    target,
    unit: unit === '' ? t('web.habits.goal.defaultUnit' as never) : unit,
  });
}

export function HabitGoalEditor({ habit, onSetGoal }: HabitGoalEditorProps): React.JSX.Element {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);

  const goalType: HabitGoalType = habit.goalType ?? 'atLeast';
  const target = habit.target ?? 1;
  const unit = habit.unit ?? '';

  /** 草稿：只在展开时用。`''` 表示这一格还没填。 */
  const [draftTarget, setDraftTarget] = useState(String(target));
  const [draftUnit, setDraftUnit] = useState(unit);

  const submit = (nextType: HabitGoalType): void => {
    // 🔴 本地只拦**空 / 非数字 / 负数**：
    //    `0` 是合法的（`atMost` + 0 = "一次都不碰"），不能当成非法值。
    const parsed = Number(draftTarget);
    if (draftTarget.trim() === '' || !Number.isFinite(parsed) || parsed < 0) {
      setFailed(true);
      return;
    }
    setFailed(false);
    void onSetGoal({ target: parsed, unit: draftUnit, goalType: nextType }).catch(() => {
      setFailed(true);
    });
  };

  const typeButton = (key: HabitGoalType, labelKey: string): React.JSX.Element => (
    <button
      type="button"
      aria-pressed={goalType === key}
      data-testid={`habit-goal-type-${key}-${habit.id}`}
      onClick={() => {
        submit(key);
      }}
      style={{
        minHeight: cssVar('touch-target.min'),
        padding: `0 ${cssVar('space.2')}`,
        borderRadius: cssVar('radius.md'),
        border: `${cssVar('border-width.thin')} solid ${
          goalType === key ? cssVar('color.primary') : cssVar('color.border')
        }`,
        background: goalType === key ? cssVar('color.primary') : cssVar('color.background'),
        color: goalType === key ? cssVar('color.on-primary') : cssVar('color.foreground'),
        cursor: 'pointer',
        fontSize: cssVar('font-size.sm'),
      }}
    >
      {t(labelKey as never)}
    </button>
  );

  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: cssVar('space.1') }}>
      <button
        type="button"
        aria-expanded={open}
        aria-label={t('web.habits.goal.aria' as never, { name: habit.name })}
        data-testid={`habit-goal-toggle-${habit.id}`}
        onClick={() => {
          // 每次展开都把草稿同步回**当前真值** —— 否则上次没提交的输入会留着，
          // 用户再展开时看到的是一个"看起来已经生效"的值。
          setDraftTarget(String(target));
          setDraftUnit(unit);
          setFailed(false);
          setOpen((was) => !was);
        }}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: cssVar('space.1'),
          minHeight: cssVar('touch-target.min'),
          padding: `0 ${cssVar('space.2')}`,
          borderRadius: cssVar('radius.md'),
          border: `${cssVar('border-width.thin')} solid ${cssVar('color.border')}`,
          background: cssVar('color.background'),
          color: cssVar('color.foreground-muted'),
          cursor: 'pointer',
          fontSize: cssVar('font-size.xs'),
        }}
      >
        <Target size={ICON_SIZE.xs} aria-hidden="true" />
        {/* 摘要**常驻可见**：只放进展开面板的话，扫一眼列表看不出每个习惯的目标，
            而"看清现状"正是改它的前提。 */}
        <span data-testid={`habit-goal-summary-${habit.id}`}>
          {summaryOf(t as never, goalType, target, unit)}
        </span>
      </button>

      {open && (
        <div
          data-testid={`habit-goal-panel-${habit.id}`}
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'flex-end',
            gap: cssVar('space.2'),
            padding: cssVar('space.2'),
            borderRadius: cssVar('radius.md'),
            border: `${cssVar('border-width.thin')} solid ${cssVar('color.border')}`,
            background: cssVar('color.surface'),
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
          }}
        >
          {/* 两格**各占一行**（`stacked`），不是并排。
              🔴 这是看图改回来的：并排（原语的 `pair`）在这个
              ~180px 宽的浮动面板里会把「杯 / 页 / 分钟」的占位符裁掉 ——
              而给这一行加宽度下限（`--ht-layout-input-min`）会让它**溢出面板右边框**，
              因为面板的宽是"最宽的孩子"决定的（两者互相依赖）。
              并排只在"面板本来就有足够宽度"时成立（见 `habit-create-dialog` 那一对）。
              宁可多 44px 高度，也不让用户看不见自己单位怎么填。 */}
          <FormField
            id={`habit-goal-target-${habit.id}`}
            label={t('web.habits.goal.target' as never)}
          >
            {(field) => (
              <input
                {...field}
                type="number"
                min={0}
                value={draftTarget}
                data-testid={`habit-goal-target-${habit.id}`}
                onChange={(e) => setDraftTarget(e.target.value)}
              />
            )}
          </FormField>

          <FormField
            id={`habit-goal-unit-${habit.id}`}
            label={t('web.habits.goal.unit' as never)}
          >
            {(field) => (
              <input
                {...field}
                value={draftUnit}
                placeholder={t('web.habits.goal.unitPlaceholder' as never)}
                data-testid={`habit-goal-unit-${habit.id}`}
                onChange={(e) => setDraftUnit(e.target.value)}
              />
            )}
          </FormField>

          <div style={{ display: 'flex', gap: cssVar('space.1') }}>
            {typeButton('atLeast', 'web.habits.goal.atLeast')}
            {typeButton('atMost', 'web.habits.goal.atMost')}
            {typeButton('exactly', 'web.habits.goal.exactly')}
          </div>

          {failed && (
            <span
              role="alert"
              data-testid={`habit-goal-error-${habit.id}`}
              style={{ color: cssVar('color.danger'), fontSize: cssVar('font-size.xs') }}
            >
              {t('web.habits.goal.invalid' as never)}
            </span>
          )}
        </div>
      )}
    </span>
  );
}