/**
 * 色槽位选择器（移动端）
 * ========================
 *
 * 8 个槽位 + "不用颜色"。每个选项是「色块 + 编号」两件东西：色块给看得见的人，
 * 编号给看不清的人 —— 8 个纯色块对色觉障碍用户就是 8 块深浅不同的灰。
 *
 * 🔴 用法与 Web 的 `ColorSlotPicker` **逐字一致**的地方：再点一次同一个槽位
 * = 取消（不需要第 10 个按钮去表达"取消"，那会让色板变成 9+1 个选项）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 为什么从 `CategoriesScreen.tsx` 搬到这里（M3 第七刀 habits）
 *
 * 它原来是 `CategoriesScreen.tsx` 里的一个**局部函数**（`row: CategorySeries`），
 * 而 M3 第七刀给移动端新增了习惯屏 —— 习惯也需要给色槽（它决定这个习惯在
 * 「成长 → 分类时长」里那一行的颜色）。照抄一份会得到两个"8 个槽位"的实现，
 * 而它们之间的差异**不会让任何测试变红**。
 *
 * 所以搬进 `ui/`（L1/L2 原语层，本就在 `check:l4` 的豁免名单里），
 * 组件只认 `{ name, value, onChange }` —— 不再认识 `CategorySeries`，
 * 于是分类屏与习惯屏用的是**同一份**。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 「槽位 → 颜色 token」的映射只有一处
 *
 * 取值来自共享层的 `categorySlotToken`（`@heyta/ui`），本文件里**不许**出现
 * 第二份手抄的色板。
 */

import React from 'react';
import { Pressable, View } from 'react-native';
import { CATEGORY_SLOTS, parseCategorySlot, type CategorySlot, type Habit } from '@heyta/domain';
import { useI18n } from '@heyta/i18n';
import { categorySlotToken } from '@heyta/ui';

import { useTokens } from '../theme';
import { Text } from './kit';

export interface SlotPickerProps {
  /** 这个色板是给谁的 —— 进无障碍名（同一屏可能出现多个）。 */
  name: string;
  /** 当前槽位。`undefined` = 没用颜色。 */
  value: CategorySlot | undefined;
  /** 选中（或清除）时调用。`undefined` 表示清除。 */
  onChange: (slot: CategorySlot | undefined) => void;
}

export function SlotPicker({ name, value, onChange }: SlotPickerProps): React.JSX.Element {
  const tokens = useTokens();
  const { t } = useI18n();

  return (
    <View
      role="radiogroup"
      aria-label={t('mobile.categories.picker.group', { name })}
      style={{ flexDirection: 'row', flexWrap: 'wrap', gap: tokens['space.1'] }}
    >
      {CATEGORY_SLOTS.map((slot) => (
        <Pressable
          key={slot}
          onPress={() => {
            onChange(value === slot ? undefined : slot);
          }}
          role="radio"
          aria-checked={value === slot}
          aria-label={t('mobile.categories.picker.slot', { slot })}
          style={({ pressed }) => ({
            minWidth: tokens['touch-target.min'],
            minHeight: tokens['touch-target.min'],
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: tokens['space.1'],
            borderRadius: tokens['radius.md'],
            borderWidth: value === slot ? tokens['border-width.thick'] : tokens['border-width.thin'],
            borderColor: value === slot ? tokens['color.primary'] : tokens['color.border'],
            backgroundColor: pressed ? tokens['color.surface-sunken'] : tokens['color.surface'],
          })}
        >
          <View
            style={{
              width: tokens['space.3'],
              height: tokens['space.3'],
              borderRadius: tokens['radius.sm'],
              // 🔴 取值来自共享层唯一的「槽位 → 颜色 token」映射，
              // 这个文件里**不许**再出现第二份手抄。
              backgroundColor: tokens[categorySlotToken(slot)],
            }}
          />
          <Text variant="row-meta">{String(slot)}</Text>
        </Pressable>
      ))}

      {/* 「不用颜色」也是**一个选项**，放在最后：它不该看起来像「错误状态」。 */}
      <Pressable
        onPress={() => {
          onChange(undefined);
        }}
        role="radio"
        aria-checked={value === undefined}
        aria-label={t('mobile.categories.slot.none')}
        style={({ pressed }) => ({
          minWidth: tokens['touch-target.min'],
          minHeight: tokens['touch-target.min'],
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: tokens['space.2'],
          borderRadius: tokens['radius.md'],
          borderWidth:
            value === undefined ? tokens['border-width.thick'] : tokens['border-width.thin'],
          borderColor: value === undefined ? tokens['color.primary'] : tokens['color.border'],
          backgroundColor: pressed ? tokens['color.surface-sunken'] : tokens['color.surface'],
        })}
      >
        <Text variant="row-meta">{t('mobile.categories.slot.none')}</Text>
      </Pressable>
    </View>
  );
}

/**
 * 取色入口（「一个色块触发器 + 展开的色板」）。
 *
 * 🔴 默认收起：8 个槽位 × N 个习惯一屏铺开会盖住真正的读数（连续天数）。
 *
 * ⚠️ 它是**容器**，不是第二份色板 —— 展开之后渲染的仍然是上面的
 * `SlotPicker`。放在 `ui/` 是因为它属于 L1/L2 原语层
 * （`check:l4` 的豁免名单），于是使用它的屏幕不必为几个内联样式
 * 去动那个"只减不增"的棘轮。
 *
 * 色块颜色取自共享层唯一的「槽位 → 颜色 token」映射（`categorySlotToken`）；
 * 没设过色时它给的是"未设色"的中性色，而不是某个分类色 ——
 * 否则"没设过"看起来像用户选过。
 */
export function HabitColorSlot({
  habit,
  onChoose,
}: {
  habit: Habit;
  onChoose: (slot: CategorySlot | undefined) => void;
}): React.JSX.Element {
  const tokens = useTokens();
  const { t } = useI18n();
  const [open, setOpen] = React.useState(false);
  const slot = parseCategorySlot(habit.color);

  return (
    <View style={{ alignItems: 'flex-start' }}>
      <Pressable
        onPress={() => {
          setOpen((current) => !current);
        }}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={t('mobile.categories.picker.toggle', { name: habit.name })}
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          minWidth: tokens['icon.sm'],
          minHeight: tokens['icon.sm'],
        }}
      >
        <View
          style={{
            width: tokens['space.3'],
            height: tokens['space.3'],
            borderRadius: tokens['radius.sm'],
            backgroundColor: tokens[categorySlotToken(slot)],
          }}
        />
      </Pressable>
      {open ? (
        <SlotPicker
          name={habit.name}
          value={slot}
          onChange={(next) => {
            setOpen(false);
            onChoose(next);
          }}
        />
      ) : null}
    </View>
  );
}
