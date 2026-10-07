/**
 * 身份标签（共享视图，L3）
 * ========================
 *
 * ## 为什么是"身份"而不是"等级"
 *
 * 这是整份设计里最需要克制的一处。SDT（自我决定论）说内在动机靠三样东西：
 * 自主、胜任、联结 —— 而"等级/段位"喂的是**比较**，不是胜任：它把"我做到了
 * 什么"换成"我排在第几"，一旦排名下滑，同一份成就立刻变成失败
 * （过度理由效应：外部奖励会把内在动机挤出去）。
 *
 * 所以这里给的是**描述性标签**："连续 30 天""完成 500 件"。它们描述的是
 * **发生过的事实**，没有名次、没有可被夺走的位置。
 *
 * ## 三条规则（两端迁移前都写过，合并后仍然成立）
 *
 * 1. 🔴 **不显示已过期/已失去的标签。** 标签一旦到手就永久保留 ——
 *    包括"连续 30 天"。断掉之后它仍然是真的："你曾经连续 30 天"。
 *    把历史最高记录收走等于告诉用户"你之前的努力不算数"，而全或无思维
 *    正是弃用的主要诱因（计划 §2 的 abstinence violation effect）。
 * 2. 🔴 **未达成的只显示最近的两个，按距离排序。** 见 `model.ts#NEAR_MISS_LIMIT`。
 * 3. 🔴 **一个都没有时，不画空位。** 空位列表是一个"你还什么都不是"的清单。
 *    这种情况只给一句事实性说明。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ 未知标签 id 的两种处理，这里选了 **跳过**（与 web 不一致，已登记）
 *
 * 标签 id 由**同步过来的数据**决定，一台更新的客户端可能带来这个版本还不认识
 * 的 id。两端迁移前处理**不同**：
 *
 *   · mobile：`TAG_KEY[id] === undefined` → `return null`（跳过，不渲染）；
 *   · web：表里没有的 id **原样显示 id**（文件头理由是"编一个中文名会让
 *     漏翻看起来像已经翻了"）。
 *
 * 共享层选了 mobile 的做法，因为把 `checkin-hundred` 这种内部 id 渲染给用户
 * 看是**更坏的**结果，而"漏翻"该由门禁（`check:ui-language` 要求 zh/en 两表
 * key 集合一致）发现，不该由用户发现。
 * · 影响：web 上一个未翻译的 id 从"显示裸 id"变成"不显示"。
 * · 最小一步：若确定要保留裸 id 兜底，把 `label.tagName` 的返回类型从
 *   `string | undefined` 改成 `string`，并在这里删掉跳过分支。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 文案一律由宿主注入（理由见 `TodayProgressCard`）；本文件不 import `@heyta/i18n`
 * 🔴 只用 RN 原语（`View` / `Text` / `StyleSheet`）
 */

import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { HeytaNativeTokens } from '@heyta/design-system';
import type { IdentityTagKind, IdentityTagProgress } from '@heyta/domain';
import { Award } from 'lucide';
import { HeytaIcon } from '../icon/Icon.js';
import { useHeytaText, useHeytaTokens } from '../theme.js';
import { NEAR_MISS_LIMIT, nearMissTags, reachedTagIds } from './model.js';

/** 面板全部文案，**每一项都由宿主注入**（见文件头）。 */
export interface IdentityTagListLabels {
  /**
   * 标签 id → 文案。**返回 `undefined` = 这个版本不认识这个 id，跳过它**
   * （见文件头；与 `HabitBoard` 的 `labels` 里依赖行内容的项同一种函数形状）。
   */
  readonly tagName: (id: string) => string | undefined;
  /** "还差多少"那一句。`unit` 已由 `nearUnit` 解析好（可能是空串）。 */
  readonly near: (info: {
    readonly name: string;
    readonly gap: number;
    readonly unit: string;
  }) => string;
  /**
   * 未达成标签的计量单位。
   *
   * ⚠️ `streakDays` 也是 `kind` 的一种，但它的单位（"天"）**不属于**里程碑那
   * 四个维度 —— web 迁移前为此单独走了一条词条（`web.growth.unit.streakDays`）。
   * 这个映射留在宿主侧正是为了保住那条例外。
   */
  readonly nearUnit: (kind: IdentityTagKind) => string;
  /** 一个标签都没有时那一句。 */
  readonly empty: string;
  /** 已经拿到的标签一个都没有、但有"最近的未达成"时，下面那句说明。 */
  readonly nearNote: string;
  /** 已达成标签的无障碍名（"已达成：坚持一周"）。 */
  readonly reachedA11y: (name: string) => string;
  /** 未达成标签的无障碍名（默认用 `near` 那一句）。省略 = 用 `near` 的输出。 */
  readonly nearA11y?: (info: {
    readonly name: string;
    readonly gap: number;
    readonly unit: string;
  }) => string;
}

export interface IdentityTagListProps {
  /** `@heyta/app-host#identityTagsFromState` 的输出。 */
  readonly tags: readonly IdentityTagProgress[];
  readonly labels: IdentityTagListLabels;
  /** 未达成最多显示几个。省略 = {@link NEAR_MISS_LIMIT}。 */
  readonly nearMissLimit?: number;
  readonly testID?: string;
}

/** 取一份 token 表，建出这套样式。**一个裸值都没有**（`check:design` 会拦）。 */
function makeStyles(tokens: HeytaNativeTokens) {
  return StyleSheet.create({
    card: {
      gap: tokens['space.2'],
      padding: tokens['space.3'],
      borderRadius: tokens['radius.lg'],
      backgroundColor: tokens['color.surface'],
    },
    reachedWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: tokens['space.1'],
    },
    reachedChip: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: tokens['space.1'],
      paddingHorizontal: tokens['space.3'],
      minHeight: tokens['size.chip-height'],
      borderRadius: tokens['radius.full'],
      backgroundColor: tokens['color.primary-subtle'],
    },
    nearWrap: {
      gap: tokens['space.1'],
    },
    numeric: {
      fontVariant: ['tabular-nums'],
    },
    empty: {
      gap: tokens['space.1'],
    },
  });
}

export function IdentityTagList({
  tags,
  labels,
  nearMissLimit = NEAR_MISS_LIMIT,
  testID,
}: IdentityTagListProps): React.JSX.Element {
  const tokens = useHeytaTokens();
  const text = useHeytaText();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);

  /**
   * 🔴 已达成的顺序**固定按定义表**（`reachedTagIds` 不重排），不按达成时间或
   * "稀有度"排序 —— 那会变成一种排位。
   */
  const reached = useMemo(() => {
    const out: Array<{ id: string; name: string }> = [];
    for (const id of reachedTagIds(tags)) {
      const name = labels.tagName(id);
      // 未知 id 在这里就丢掉，而不是让它一路走到渲染那里再判空（见文件头）。
      if (name === undefined) continue;
      out.push({ id, name });
    }
    return out;
  }, [tags, labels]);

  const near = useMemo(() => {
    const out: Array<{ id: string; kind: IdentityTagKind; gap: number; name: string }> = [];
    for (const miss of nearMissTags(tags, nearMissLimit)) {
      const name = labels.tagName(miss.id);
      if (name === undefined) continue;
      out.push({ id: miss.id, kind: miss.kind, gap: miss.gap, name });
    }
    return out;
  }, [tags, nearMissLimit, labels]);

  // 🔴 两个都空 → 一句事实性说明；**不画空位列表**（见文件头第 3 条）。
  if (reached.length === 0 && near.length === 0) {
    return (
      <View style={styles.empty} testID={testID}>
        <Text style={[text['row-meta'], { color: tokens['color.foreground-subtle'] }]}>
          {labels.empty}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.card} testID={testID}>
      {reached.length === 0 ? null : (
        <View style={styles.reachedWrap} accessibilityRole="list">
          {reached.map((tag) => (
            <View
              key={tag.id}
              style={styles.reachedChip}
              // 标签是**信息**不是按钮。读屏念"已达成：坚持一周"。
              accessible
              accessibilityLabel={labels.reachedA11y(tag.name)}
              testID={`identity-tag-${tag.id}`}
            >
              {/* 图标 + 文字两个线索，不只靠底色区分"已达成"。 */}
              <HeytaIcon data={Award} size={tokens['font-size.sm']} color={tokens['color.primary']} />
              <Text style={[text.caption, { color: tokens['color.primary'] }]}>{tag.name}</Text>
            </View>
          ))}
        </View>
      )}

      {near.length === 0 ? null : (
        <View style={styles.nearWrap}>
          {near.map((miss) => {
            const unit = labels.nearUnit(miss.kind);
            const info = { name: miss.name, gap: Math.max(0, miss.gap), unit };
            return (
              <Text
                key={miss.id}
                style={[text.caption, { color: tokens['color.foreground-muted'] }]}
                accessibilityLabel={
                  labels.nearA11y === undefined ? labels.near(info) : labels.nearA11y(info)
                }
              >
                {labels.near(info)}
              </Text>
            );
          })}
        </View>
      )}

      {/*
        🔴 还没拿到任何标签时补一句说明：不说的话，上面那两行"还差多少"
        看起来像一份欠债清单。web 迁移前有这一句，mobile 没有。
      */}
      {reached.length === 0 ? (
        <Text style={[text.caption, { color: tokens['color.foreground-subtle'] }]}>
          {labels.nearNote}
        </Text>
      ) : null}
    </View>
  );
}
