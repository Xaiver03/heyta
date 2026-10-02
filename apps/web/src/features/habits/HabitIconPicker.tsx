import { ICON_SIZE } from '@heyta/design-system';
/**
 * 习惯图标选择器
 * ================
 *
 * 与 `../categories/ColorSlotPicker.tsx` **同一个形状**（展开式按钮，不是浮层），
 * 理由也同一份：浮层要处理定位、层级、点外部关闭、焦点陷阱，而它只是八个字形。
 *
 * 🔴 **这里存的是闭集 key，不是字形**。`onChange` 给的是 `'drop'` 这类字符串，
 * 落库前还要过一遍 `parseHabitIcon`（在 `@heyta/app-host` 的动作层）。
 * 界面上出现 Lucide 组件名（`Droplet`）就是第二套事实源 —— 换图标库会改数据。
 *
 * ## 「默认」那一格说的是真话
 *
 * `value === undefined` **不等于**"没有图标"：没选过时界面按习惯 id 派生一个稳定的
 * （`@heyta/domain#deriveHabitIcon`）。所以：
 *
 *   · 强调态给**实际显示的那个字形**（`effective`）—— 用户看到的是它；
 *   · 「默认」一格也在 `value === undefined` 时按下 —— 它表达的是"我没挑过"。
 *
 * 两格同时亮起不是 bug：一个说"现在长这样"，一个说"这是系统派的"。
 * 合并成一条的话，要么丢掉"能不能一键退回"，要么让用户以为退回默认会换成另一个图形。
 *
 * ⚠️ 八个槽位同等大小、同等样式、**没有任何一个被标成推荐**。图标会把这一格点名
 * （颜色不会），所以词表本身就是"App 永不判断活动健康／不健康"那条红线的边界 ——
 * 要加新字形先去看 `@heyta/domain#HABIT_ICONS` 的文件头。
 */

import { useState } from 'react';

import {
  HABIT_ICONS,
  habitIconOf,
  parseHabitIcon,
  type Habit,
  type HabitIcon,
} from '@heyta/domain';
import { useI18n } from '@heyta/i18n';

import { HABIT_GLYPHS, HABIT_ICON_LABEL_KEYS } from './habit-glyphs.js';

interface HabitIconPickerProps {
  habit: Habit;
  /** `undefined` = 回到派生图标（**不是**"去掉图标"）。 */
  onChange: (icon: HabitIcon | undefined) => void;
}

export function HabitIconPicker({ habit, onChange }: HabitIconPickerProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  // 🔴 磁盘上的值先过解析器再当类型用：`habit.icon` 是 `string`，
  //    直接 `as HabitIcon` 会让一个不认识的历史值（改名前的 key）穿透到
  //    `HABIT_GLYPHS[...]`，拿到 `undefined` 组件 —— 渲染时才炸。
  const value = parseHabitIcon(habit.icon);
  const effective = habitIconOf(habit);
  const EffectiveGlyph = HABIT_GLYPHS[effective];

  return (
    <span className="ht-habit__icon-picker">
      <button
        type="button"
        className="ht-habit__icon-toggle"
        aria-expanded={open}
        aria-label={t('web.habits.icon.a11y', { name: habit.name })}
        onClick={() => {
          setOpen((was) => !was);
        }}
      >
        <EffectiveGlyph size={ICON_SIZE.sm} aria-hidden="true" />
        <span className="ht-habit__icon-word">{t('web.habits.icon.toggle')}</span>
      </button>

      {open && (
        <span
          className="ht-habit__icon-options"
          role="group"
          aria-label={t('web.habits.icon.group')}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setOpen(false);
          }}
        >
          {HABIT_ICONS.map((icon) => {
            const Glyph = HABIT_GLYPHS[icon];
            return (
              <button
                type="button"
                key={icon}
                className="ht-habit__icon-option"
                aria-pressed={effective === icon}
                aria-label={t(HABIT_ICON_LABEL_KEYS[icon])}
                onClick={() => {
                  // 再点一次同一个字形 = 退回派生。与色槽选择器同一条补救动作。
                  onChange(effective === icon && value === icon ? undefined : icon);
                  setOpen(false);
                }}
              >
                <Glyph size={ICON_SIZE.sm} aria-hidden="true" />
              </button>
            );
          })}
          <button
            type="button"
            className="ht-habit__icon-option ht-habit__icon-option--default"
            aria-pressed={value === undefined}
            aria-label={t('web.habits.icon.a11yDefault', { name: habit.name })}
            onClick={() => {
              onChange(undefined);
              setOpen(false);
            }}
          >
            {t('web.habits.icon.default')}
          </button>
        </span>
      )}
    </span>
  );
}
