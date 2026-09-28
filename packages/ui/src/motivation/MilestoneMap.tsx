/**
 * 里程碑地图（共享视图，L3 长周期）
 * ====================================
 *
 * 「我建成了什么」的出口：把累计量摊成四个维度（打卡 / 专注小时 / 任务 /
 * 活跃天）× 各自四到五档阈值。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 三条刻意的设计取舍（迁移前两端各自写过一遍，这里合并后仍然成立）
 *
 * 1. **只增不减，没有惩罚项。** 滴答清单的成就会因为没完成而**扣分**。
 *    我们不做 —— 扣分制造的是"别掉下去"的焦虑，而不是"我在往上走"的动力，
 *    而且它和"中断不等于归零"这条核心立场直接冲突。
 *    领域层的 `deriveMilestones` 里因此**根本没有**惩罚项这个概念。
 * 2. **每一档都显示，不隐藏未达成的。** 隐藏未达成 = 用户不知道有这条路，
 *    也就无从规划。但**未达成不用红色**：那会把"还没到"表达成"你做错了"。
 * 3. **已达成之后进度条指向"下一档"，而不是停在 100%。** 一个永远停在 100%
 *    的横条会变成死掉的装饰；更重要的原因是目标梯度效应 ——
 *    已达成之后不给出下一个可见目标，动力就断在这里了。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 维度顺序**不按达成数重排**
 *
 * 顺序 = `MILESTONE_DEFINITIONS` 的顺序（由 `model.ts#milestoneGroups`
 * 保留首次出现顺序）。按达成数排就是排行榜的形状，而本设计的红线是"只与自己比"。
 * 连"最容易够到的排前面"这种善意重排也不做 —— 那是领域层的决定，不是 UI 的。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ 单位由宿主给，且是**可选**的 —— 两端在这里本来就不一致
 *
 * web 的 `MilestoneMap.tsx` 给每个维度配了单位（"次""小时""件""天"），
 * 数字旁写着 `12小时`；mobile 的 `GrowthScreen.tsx` **不写单位**，
 * 只在维度名里表达（"专注小时 12"），注释理由是"这样英文侧不会出现 `1 hours`"。
 *
 * 两种都说得通，所以这里把单位做成**可选** `kindUnit`：
 * 给就渲染，不给就只剩维度名承担单位。共享层不替两端选。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 文案一律由宿主注入（理由见 `TodayProgressCard`）；本文件不 import `@heyta/i18n`
 * 🔴 只用 RN 原语（`View` / `Text` / `StyleSheet`）—— 档位的对勾用 `lucide` 图标
 */

import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { HeytaNativeTokens } from '@heyta/design-system';
import type { MilestoneKind, MilestoneProgress } from '@heyta/domain';
import { Check } from 'lucide';
import { HeytaIcon } from '../icon/Icon.js';
import { useHeytaText, useHeytaTokens } from '../theme.js';
import { MotivationProgressBar } from './ProgressBar.js';
import { milestoneGroups } from './model.js';

/** 面板全部文案，**每一项都由宿主注入**（见文件头）。 */
export interface MilestoneMapLabels {
  /** 维度名（"打卡""专注小时"…）。 */
  readonly kindName: (kind: MilestoneKind) => string;
  /** 计量单位（"次""小时"…）。省略 = 不渲染单位（mobile 迁移前就不渲染）。 */
  readonly kindUnit?: (kind: MilestoneKind) => string;
  /** 一个维度全部达成时那一句。 */
  readonly maxed: string;
  /** 距离下一档还差多少。 */
  readonly next: (info: {
    readonly threshold: number;
    readonly unit: string;
    readonly gap: number;
  }) => string;
  /** 全部达成时进度条的无障碍名。 */
  readonly allReachedA11y: (name: string) => string;
  /**
   * 有下一档时进度条的无障碍名。
   *
   * ⚠️ 可访问名里必须同时有**目标**和**差距** —— 只说"距离下一档"
   * 读屏用户不知道下一档是多少。
   */
  readonly nextA11y: (info: {
    readonly name: string;
    readonly threshold: number;
    readonly unit: string;
    readonly gap: number;
  }) => string;
  /** 单档位徽章的无障碍名（已达成的带对勾，未达成的只有数字）。 */
  readonly tierA11y: (info: {
    readonly threshold: number;
    readonly reached: boolean;
  }) => string;
  /** 一个里程碑都没有时显示什么（领域层理论上不会返回空，但空输入别抛错）。 */
  readonly empty: string;
}

export interface MilestoneMapProps {
  /** `@heyta/app-host#milestonesFromState` 的输出。 */
  readonly milestones: readonly MilestoneProgress[];
  readonly labels: MilestoneMapLabels;
  readonly testID?: string;
}

/** 取一份 token 表，建出这套样式。**一个裸值都没有**（`check:design` 会拦）。 */
function makeStyles(tokens: HeytaNativeTokens) {
  return StyleSheet.create({
    map: {
      gap: tokens['space.3'],
    },
    group: {
      gap: tokens['space.2'],
      padding: tokens['space.3'],
      borderRadius: tokens['radius.lg'],
      backgroundColor: tokens['color.surface'],
      borderWidth: tokens['border-width.thin'],
      borderColor: tokens['color.border'],
    },
    head: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      gap: tokens['space.2'],
    },
    headValue: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: tokens['space.1'],
    },
    numeric: {
      fontVariant: ['tabular-nums'],
    },
    tiers: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: tokens['space.1'],
    },
    tier: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: tokens['space.1'],
      paddingHorizontal: tokens['space.2'],
      minHeight: tokens['size.chip-height'],
      borderRadius: tokens['radius.full'],
    },
    tierReached: {
      backgroundColor: tokens['color.primary-subtle'],
    },
    tierPending: {
      backgroundColor: tokens['color.surface-sunken'],
    },
    empty: {
      gap: tokens['space.1'],
    },
  });
}

export function MilestoneMap({
  milestones,
  labels,
  testID,
}: MilestoneMapProps): React.JSX.Element {
  const tokens = useHeytaTokens();
  const text = useHeytaText();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);

  // 分组全由 `./model.ts` 的纯函数算出来（顺序不重排），这里只负责摆。
  const groups = useMemo(() => milestoneGroups(milestones), [milestones]);

  if (groups.length === 0) {
    return (
      <View style={styles.empty} testID={testID}>
        <Text style={[text['row-meta'], { color: tokens['color.foreground-subtle'] }]}>
          {labels.empty}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.map} testID={testID}>
      {groups.map((group) => {
        const name = labels.kindName(group.kind);
        // 单位缺席时传空串：宿主模板仍能拼出句子，只是没有单位后缀。
        const unit = labels.kindUnit === undefined ? '' : labels.kindUnit(group.kind);
        const gap = group.next === undefined ? 0 : group.next - group.current;

        return (
          <View key={group.kind} style={styles.group} testID={`milestone-group-${group.kind}`}>
            <View style={styles.head}>
              <Text style={[text['row-title'], { color: tokens['color.foreground'] }]}>{name}</Text>
              {/*
                数字只有值 + 可选单位。⚠️ mobile 迁移前**不渲染单位**，
                由维度名承担（"专注小时 12"）—— 见文件头。
              */}
              <View style={styles.headValue}>
                <Text
                  style={[text['numeric-body'], styles.numeric, { color: tokens['color.foreground-muted'] }]}
                >
                  {String(group.current)}
                </Text>
                {unit === '' ? null : (
                  <Text style={[text.caption, { color: tokens['color.foreground-muted'] }]}>
                    {unit}
                  </Text>
                )}
              </View>
            </View>

            {/*
              全部达成时进度条指向满格（success），而不是消失 —— "已经到顶"也是信息。
            */}
            <MotivationProgressBar
              ratio={group.ratio}
              tone={group.maxed ? 'success' : 'primary'}
              label={
                group.maxed
                  ? labels.allReachedA11y(name)
                  : labels.nextA11y({
                      name,
                      threshold: group.next ?? 0,
                      unit,
                      gap,
                    })
              }
              valueText={`${String(group.reached)}/${String(group.total)}`}
            />

            {/*
              档位徽章。🔴 **顺序 + 数字 + 底色三者一起说同一件事**，
              颜色不是唯一线索：已达成的档带一个对勾（web 迁移前就是这样），
              未达成的也有数字。只靠颜色对色觉障碍用户等于没画。
            */}
            <View style={styles.tiers}>
              {group.tiers.map((tier) => (
                <View
                  key={tier.threshold}
                  accessible
                  accessibilityLabel={labels.tierA11y({
                    threshold: tier.threshold,
                    reached: tier.reached,
                  })}
                  style={[
                    styles.tier,
                    tier.reached ? styles.tierReached : styles.tierPending,
                  ]}
                  testID={`milestone-tier-${group.kind}-${String(tier.threshold)}`}
                >
                  {tier.reached ? (
                    <HeytaIcon
                      data={Check}
                      size={tokens['font-size.xs']}
                      color={tokens['color.primary']}
                    />
                  ) : null}
                  <Text
                    style={[
                      text.caption,
                      styles.numeric,
                      { color: tier.reached ? tokens['color.primary'] : tokens['color.foreground-subtle'] },
                    ]}
                  >
                    {String(tier.threshold)}
                  </Text>
                </View>
              ))}
            </View>

            <Text style={[text.caption, { color: tokens['color.foreground-subtle'] }]}>
              {group.maxed
                ? labels.maxed
                : labels.next({ threshold: group.next ?? 0, unit, gap })}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
