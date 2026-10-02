import { ICON_SIZE } from '@heyta/design-system';
/**
 * 分类色槽位选择器
 * ==================
 *
 * 这是分类着色**唯一的入口**（清单编辑界面、习惯卡片各用一次）。
 * 它刻意做得很小，因为它是产品主张的落地处：
 *
 * 🔴 **调色板由我们给，含义由用户赋。** 界面上只有 1–8 八个槽位和"不用颜色"，
 * 没有任何预设名称（没有"学习""运动""娱乐"）—— 一旦我们替某个槽位起名，
 * 就等于告诉用户"3 号应该用来放什么"，紧接着就会出现"我用错了吗"。
 * 用户自己知道 3 号是什么，而 App 永远不需要知道。
 *
 * 🔴 **没有褒贬。** 八个槽位同等大小、同等样式、都没有名字；
 * 没有"推荐配色"、没有"健康度"、没有把某个颜色标注成"警示色"。
 *
 * ## 为什么色块旁边还写编号
 *
 * 「不许只用颜色表达信息」是设计系统硬规则，而在**选颜色的控件**上最容易违反：
 * 8 个纯色块对色觉障碍用户就是 8 块深浅不同的灰，选哪个全凭猜。
 * 所以每个按钮是「色块 + 编号」两件东西：色块给他看，编号给他读，
 * `aria-label` 给屏幕阅读器。三者在同一次点击里说的是同一件事。
 *
 * ## 交互取舍
 *
 * 用**展开式**而不是浮层：浮层要处理定位、层级、点外部关闭、键盘焦点陷阱，
 * 而它出现在侧栏的每一行清单上 —— 那些复杂度换不来任何东西。
 * 展开的是一行按钮，`Esc` 收起，按钮自己的 `aria-expanded` 说明状态。
 */

import { useState } from 'react';
import { cssVar } from '@heyta/design-system';
import { useI18n } from '@heyta/i18n';
import type { CategorySlot } from '@heyta/domain';
import { CATEGORY_SLOTS } from '@heyta/domain';
import { Palette } from 'lucide-react';

import { categorySlotColor } from '../../lib/category-colors.js';

interface ColorSlotPickerProps {
  /** 当前槽位。`undefined` = 没用颜色。 */
  value?: CategorySlot;
  /** 选中（或清除）时调用。`undefined` 表示清除。 */
  onChange: (slot: CategorySlot | undefined) => void;
  /** 这个控件是给谁用的 —— 进 `aria-label`，因为同一屏可能出现多个。 */
  targetName: string;
}

export function ColorSlotPicker({ value, onChange, targetName }: ColorSlotPickerProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <span className="ht-slot-picker">
      <button
        type="button"
        className="ht-slot-picker__toggle"
        aria-expanded={open}
        aria-label={t('web.categories.picker.toggle', { name: targetName })}
        onClick={() => {
          setOpen((was) => !was);
        }}
      >
        <Palette size={ICON_SIZE.xs} aria-hidden="true" />
        <span
          className="ht-slot-picker__current"
          style={{ background: value === undefined ? cssVar('color.border') : categorySlotColor(value) }}
          aria-hidden="true"
        />
      </button>

      {open && (
        <span
          className="ht-slot-picker__options"
          role="group"
          aria-label={t('web.categories.picker.group', { name: targetName })}
          onKeyDown={(event) => {
            // `Esc` 收起。不拦截其他键 —— 这是几个按钮，不是一个对话框。
            if (event.key === 'Escape') setOpen(false);
          }}
        >
          {CATEGORY_SLOTS.map((slot) => (
            <button
              type="button"
              key={slot}
              className="ht-slot-picker__option"
              // 🔴 `aria-pressed` 而不是把选中态只画成边框：
              // 一个只靠样式表达的选中态对屏幕阅读器等于不存在。
              aria-pressed={value === slot}
              aria-label={t('web.categories.picker.slot', { slot })}
              onClick={() => {
                // 再点一次同一个槽位 = 取消。省掉一个"清除"按钮，
                // 也让"我点错了"有一个显而易见的补救动作。
                onChange(value === slot ? undefined : slot);
                setOpen(false);
              }}
            >
              <span
                className="ht-slot-picker__swatch"
                style={{ background: categorySlotColor(slot) }}
                aria-hidden="true"
              />
              <span className="ht-slot-picker__number">{slot}</span>
            </button>
          ))}
          <button
            type="button"
            className="ht-slot-picker__option"
            aria-pressed={value === undefined}
            onClick={() => {
              onChange(undefined);
              setOpen(false);
            }}
          >
            <span className="ht-slot-picker__swatch ht-slot-picker__swatch--none" aria-hidden="true" />
            <span className="ht-slot-picker__number">{t('web.categories.slot.none')}</span>
          </button>
        </span>
      )}
    </span>
  );
}
