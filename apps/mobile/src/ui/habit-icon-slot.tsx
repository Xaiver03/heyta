/**
 * 习惯图标选择器（移动端）—— 工单 H3
 * ====================================
 *
 * 与 `ui/slot-picker.tsx`（色槽）同一个形状：摘要常驻 + 展开一排 + 再点一次同一个
 * = 取消。差别只有一件：色槽那排每个选项是「色块 + 编号」两件东西（8 个纯色块对色觉
 * 障碍用户就是 8 块深浅不同的灰），而这里本来就是**字形**，不需要编号来复读形状。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 「key → 字形」与「key → 词条」都来自 `@heyta/ui`，本文件里不许出现第三份
 *
 * 共享层那张 `HABIT_GLYPHS` 配的是 `lucide` 的**图标数据**，由 `HeytaIcon` 在 RN 上画 ——
 * 移动端的**清单**（`HabitProgressList`）已经用的是它。如果这里另抄一张，两份会漂移，
 * 而漂移的症状是"同一个习惯在清单上是水滴、在选择器里是月亮"，两边都不报错。
 * web 那张 `key → lucide-react 组件` 结构上必须分开（画的不是同一种东西），
 * 由 `apps/web/tests/habits-list-pane.spec.tsx` F 组逐对比钉住；**这一份不需要**。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 存的是**闭集 key**（`'drop'`），不是字形名，也不是字形本身
 *
 * 落库前还要过一遍 `parseHabitIcon`（在 `@heyta/app-host` 的动作层，那里会**抛**）。
 * 界面出现 Lucide 组件名就是第二套事实源 —— 换图标库会改数据。
 *
 * ## 「默认」那一格说的是真话
 *
 * `value === undefined` **不等于**"没有图标"：没挑过时界面按习惯 id 派生一个稳定的
 * （`@heyta/domain#deriveHabitIcon`）。所以：
 *   · 强调态给**实际显示的那个字形**（`effective`）—— 用户看到的是它；
 *   · 「默认」一格在 `value === undefined` 时按下 —— 它表达的是"我没挑过"。
 * 两格同时亮起不是 bug：一个说"现在长这样"，一个说"这是系统派的"。
 *
 * ⚠️ 八个字形同等大小、同等样式、**没有任何一个被标成推荐**，而词条名只描述
 * "看起来像什么"（水滴 / 书本），不描述"该是什么活动" —— 与 `@heyta/domain#HABIT_ICONS`
 * 文件头那条红线同一条：App 永不判断某个活动健康／不健康。
 */

import React, { useState } from 'react';
import { Pressable, View } from 'react-native';

import { HABIT_ICONS, habitIconOf, parseHabitIcon, type Habit, type HabitIcon } from '@heyta/domain';
import { useI18n } from '@heyta/i18n';
import { HABIT_GLYPHS, HABIT_ICON_LABEL_KEYS, HeytaIcon } from '@heyta/ui';

import { useTokens } from '../theme';
import { Text } from './kit';

export interface HabitIconSlotProps {
  habit: Habit;
  /** `undefined` = 回到按 id 派生的那个（**不是**"去掉图标"）。 */
  onChoose: (icon: HabitIcon | undefined) => void;
}

export function HabitIconSlot({ habit, onChoose }: HabitIconSlotProps): React.JSX.Element {
  const tokens = useTokens();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  // 🔴 磁盘上的值先过解析器再当类型用：`habit.icon` 是 `string`，直接 `as HabitIcon`
  //    会让一个不认识的历史值（改名前的 key）穿透到 `HABIT_GLYPHS[...]`，
  //    拿到 `undefined` 的数据 —— 到 `HeytaIcon` 里才炸，而且炸在读一个既有习惯的时候。
  const value = parseHabitIcon(habit.icon);
  const effective = habitIconOf(habit);

  return (
    <View style={{ alignItems: 'flex-start', gap: tokens['space.1'] }}>
      <Pressable
        onPress={() => {
          setOpen((was) => !was);
        }}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={t('web.habits.icon.a11y', { name: habit.name })}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: tokens['space.2'],
          minHeight: tokens['touch-target.min'],
          justifyContent: 'center',
        }}
      >
        {/* 当前字形**常驻可见**：只放进展开面板的话，扫一眼详情看不出这条习惯现在是哪个图标，
            而"我挑过没有"正是这一格要回答的事。 */}
        <HeytaIcon data={HABIT_GLYPHS[effective]} color={tokens['color.foreground']} />
        <Text variant="row-meta" tone="muted">
          {t('web.habits.icon.toggle')}
        </Text>
      </Pressable>

      {open ? (
        <View
          role="radiogroup"
          aria-label={t('web.habits.icon.group')}
          style={{ flexDirection: 'row', flexWrap: 'wrap', gap: tokens['space.1'] }}
        >
          {HABIT_ICONS.map((icon) => (
            <Pressable
              key={icon}
              onPress={() => {
                // 再点一次同一个字形 = 退回派生（与色槽选择器同一条补救动作，
                // 所以不需要第 9 格去表达"取消"）。
                onChoose(effective === icon && value === icon ? undefined : icon);
                setOpen(false);
              }}
              role="radio"
              aria-checked={effective === icon}
              accessibilityLabel={t(HABIT_ICON_LABEL_KEYS[icon])}
              style={({ pressed }) => ({
                minWidth: tokens['touch-target.min'],
                minHeight: tokens['touch-target.min'],
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: tokens['radius.md'],
                borderWidth:
                  effective === icon ? tokens['border-width.thick'] : tokens['border-width.thin'],
                borderColor:
                  effective === icon ? tokens['color.primary'] : tokens['color.border'],
                backgroundColor: pressed ? tokens['color.surface-sunken'] : tokens['color.surface'],
              })}
            >
              <HeytaIcon data={HABIT_GLYPHS[icon]} color={tokens['color.foreground']} />
            </Pressable>
          ))}

          {/* 「默认」也是**一个选项**，放在最后：它表达"回到系统派的那个"，
              不该看起来像错误状态，也不该被省略 —— 省略之后用户挑过就退不回去。 */}
          <Pressable
            onPress={() => {
              onChoose(undefined);
              setOpen(false);
            }}
            role="radio"
            aria-checked={value === undefined}
            accessibilityLabel={t('web.habits.icon.a11yDefault', { name: habit.name })}
            style={({ pressed }) => ({
              minWidth: tokens['touch-target.min'],
              minHeight: tokens['touch-target.min'],
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: tokens['space.2'],
              borderRadius: tokens['radius.md'],
              borderWidth:
                value === undefined ? tokens['border-width.thick'] : tokens['border-width.thin'],
              borderColor:
                value === undefined ? tokens['color.primary'] : tokens['color.border'],
              backgroundColor: pressed ? tokens['color.surface-sunken'] : tokens['color.surface'],
            })}
          >
            <Text variant="row-meta">{t('web.habits.icon.default')}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
