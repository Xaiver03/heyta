/**
 * 清单的「移入文件夹」入口（行内展开的选择器）
 * ==============================================
 *
 * 为什么它是**共享组件**而不是两端各写一份（AGENTS.md §3.5）：
 * 移动端的清单行与 web 侧栏的清单行已经共用 `OrganizerList` 的行骨架，
 * 而"移进哪个文件夹"这件事在两端是同一个意图。再写第二份，
 * "哪些目标可以选"就会出现两个答案 —— 本仓为这件事付过三次学费。
 *
 * 🔴 **候选集由宿主传进来，组件自己不算**（`candidates`）。
 *    "能不能移进去"是领域层的规则（`validateProjectParentChange`：一层、不自指、
 *    不成环、文件夹不进文件夹）。组件如果自己筛一遍，就是第二套裁决标准；
 *    它只做一件事：**把宿主给的合法目标画出来**。
 *
 * ✅ 它是通过 `OrganizerList` 已有的 `renderItemExtra` 插槽接进去的
 *    ⇒ `OrganizerList` 本体**一行没改**，两端不传这个插槽时渲染逐字不变
 *    （与 W4b「给共享组件加一个默认值等于原值的可选 prop」同一条配方）。
 *
 * ⚠️ 为什么是**行内展开**而不是浮层：绝对定位要写 `z-index`（§5 禁止裸值），
 *    而浮层在两端各自的裁剪行为不同 —— 本仓那次"头像菜单被 rail 裁掉右边 16px"
 *    就是浮层假设了可用空间。行内展开把这一行**撑高**，两端都只会多占垂直空间，
 *    不会把内容裁掉。代价是行高会变，这是明说的取舍，不是没想到的后果。
 */

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { HeytaNativeTokens } from '@heyta/design-system';
import { Check, FolderInput } from 'lucide';
import { HeytaIcon } from '../icon/Icon.js';
import { rejectionReasonOf } from '../subtasks/model.js';
import { useHeytaText, useHeytaTokens } from '../theme.js';
import type { OrganizerItem } from './model.js';

/**
 * `setParent` 被拒时该对用户说什么 —— 拒绝原因 → 词条 key。
 *
 * 🔴 两端共用这一份映射。界面**不许**去 `error.message.includes('cycle')`：
 *    错误串里带着原始 id 与清单标题，包含关系会把"原因"和"任何提到这个词的文案"
 *    混在一起。解析只在 `rejectionReasonOf`（与任务侧同一个）做一次，
 *    认不出来落到 `unknown`，**不编一句** —— 新增原因时这里不会自动跟上，
 *    那是故意的：逼人来看一眼"这个新原因该对用户说什么"。
 */
export type FolderRejectionMessageKey =
  | 'common.organizer.folder.reject.projectNotFound'
  | 'common.organizer.folder.reject.parentNotFound'
  | 'common.organizer.folder.reject.self'
  | 'common.organizer.folder.reject.cycle'
  | 'common.organizer.folder.reject.parentNotTopLevel'
  | 'common.organizer.folder.reject.hasChildren'
  | 'common.organizer.folder.reject.unknown';

export function folderRejectionMessageKey(error: unknown): FolderRejectionMessageKey {
  switch (rejectionReasonOf(error)) {
    case 'project_not_found':
      return 'common.organizer.folder.reject.projectNotFound';
    case 'parent_not_found':
      return 'common.organizer.folder.reject.parentNotFound';
    case 'self':
      return 'common.organizer.folder.reject.self';
    case 'cycle':
      return 'common.organizer.folder.reject.cycle';
    case 'parent_not_top_level':
      return 'common.organizer.folder.reject.parentNotTopLevel';
    case 'has_children':
      return 'common.organizer.folder.reject.hasChildren';
    default:
      return 'common.organizer.folder.reject.unknown';
  }
}

/** 全部文案由宿主注入（本包不 import `@heyta/i18n`，与 `OrganizerList` 同一条规矩）。 */
export interface FolderPickerLabels {
  /** 触发按钮的无障碍名，**必须带上是哪一条清单**（读屏会连着念好几行）。 */
  readonly button: (name: string) => string;
  /** 展开后那一句标题。 */
  readonly title: string;
  /** 「不放进文件夹」那一项（= 提为顶级）。 */
  readonly none: string;
  /** 当前所在文件夹那一项的后缀（"（当前位置）"），让用户看得出已经在哪里。 */
  readonly current: string;
}

export interface FolderPickerProps {
  readonly item: OrganizerItem;
  /**
   * 合法的移动目标，**由宿主按领域层守卫筛过**。
   * 空数组不是错误 —— 它意味着"这一行现在没有地方可去"（比如整棵树只有一条清单），
   * 此时按钮仍然出现，展开后只有「不放进文件夹」一项。
   */
  readonly candidates: readonly OrganizerItem[];
  /** 当前父清单 id（`undefined` = 已经在顶级）。 */
  readonly currentParentId?: string;
  /** 选定目标（`undefined` = 提到顶级）。**写库由宿主的 action 层做**（§3.5）。 */
  readonly onSelect: (targetId: string | undefined) => void;
  readonly labels: FolderPickerLabels;
  /** 正在落盘：置灰，防连点发出两条 op。 */
  readonly disabled?: boolean;
  readonly testID?: string;
}

function makeStyles(tokens: HeytaNativeTokens) {
  return StyleSheet.create({
    wrap: { flexDirection: 'column', gap: tokens['space.1'] },
    trigger: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: tokens['space.1'],
      minHeight: tokens['touch-target.min'],
      minWidth: tokens['touch-target.min'],
      borderRadius: tokens['radius.md'],
    },
    menu: {
      flexDirection: 'column',
      gap: tokens['space.1'],
      padding: tokens['space.2'],
      borderWidth: tokens['border-width.thin'],
      borderRadius: tokens['radius.md'],
      borderColor: tokens['color.border-subtle'],
      backgroundColor: tokens['color.surface-raised'],
    },
    option: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: tokens['space.2'],
      minHeight: tokens['touch-target.min'],
    },
    /** 等宽数字与名字共用同一套排版，这里只借用它保证不出现裸值。 */
    optionName: { flexShrink: 1 },
    marker: { width: tokens['icon.xs'] },
    /** 展开后那一句标题。 */
    menuTitle: {
      color: tokens['color.foreground-muted'],
    },
    /**
     * 置灰。**与 `OrganizerList` 的 `busy` 同一个 token**（`state.disabled-opacity`），
     * 不在这里写 0.5 —— 两端"不能点"的视觉强度只能有一个答案。
     */
    disabled: {
      opacity: tokens['state.disabled-opacity'],
    },
  });
}

export function FolderPicker({
  item,
  candidates,
  currentParentId,
  onSelect,
  labels,
  disabled = false,
  testID,
}: FolderPickerProps): React.JSX.Element {
  const tokens = useHeytaTokens();
  const text = useHeytaText();
  const styles = makeStyles(tokens);
  const [open, setOpen] = useState(false);

  const pick = (targetId: string | undefined): void => {
    setOpen(false);
    onSelect(targetId);
  };

  return (
    <View style={styles.wrap} testID={testID}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={labels.button(item.name)}
        aria-expanded={open}
        aria-disabled={disabled}
        disabled={disabled}
        onPress={() => {
          setOpen((prev) => !prev);
        }}
        style={[styles.trigger, disabled ? styles.disabled : null]}
        testID={testID === undefined ? undefined : `${testID}-trigger`}
      >
        <HeytaIcon
          data={FolderInput}
          size={tokens['icon.xs']}
          color={tokens['color.foreground-muted']}
        />
      </Pressable>

      {/*
        🔴 展开内容**只在 open 时进 DOM**（不是"隐藏"）：
        一个常驻但看不见的候选菜单，会让读屏用户念到一排没有上下文的清单名，
        也让两端各自的可见性断言给出不同答案。
      */}
      {!open ? null : (
        <View style={styles.menu} testID={testID ? `${testID}-menu` : undefined}>
          <Text style={[text['group-label'], styles.menuTitle]}>{labels.title}</Text>

          {/*
            🔴 「不放进文件夹」在**已经是顶级**时不许点，当前所在文件夹那一行同理。
            候选集来自 `folderTargetsFor`，它按领域规则会把"当前父"也算成一个合法目标
            （重挂到同一个父不产生任何层级风险）。所以如果这里照点不误，用户点一下
            "看起来没变化"的项，op-log 里就**多一条内容不变的 UPD** —— 而 §3.4 的口径是
            "一个用户意图 = 一个 op"。这一条不是防御性代码：它就是那次"点了没反应但
            数据多了一条"的形态，只是发生在写入侧、界面上看不见。
          */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={labels.none}
            aria-disabled={currentParentId === undefined}
            disabled={currentParentId === undefined}
            onPress={() => {
              pick(undefined);
            }}
            style={[styles.option, currentParentId === undefined ? styles.disabled : null]}
            testID={testID ? `${testID}-none` : undefined}
          >
            <View style={styles.marker}>
              {currentParentId === undefined ? (
                <HeytaIcon data={Check} size={tokens['icon.xs']} color={tokens['color.primary']} />
              ) : null}
            </View>
            <Text style={[text['row-meta'], styles.optionName]}>
              {labels.none}
              {currentParentId === undefined ? ` ${labels.current}` : ''}
            </Text>
          </Pressable>

          {candidates.map((candidate) => {
            const isCurrent = candidate.id === currentParentId;
            return (
              <Pressable
                key={candidate.id}
                accessibilityRole="button"
                accessibilityLabel={labels.button(candidate.name)}
                aria-disabled={isCurrent}
                disabled={isCurrent}
                onPress={() => {
                  pick(candidate.id);
                }}
                style={[styles.option, isCurrent ? styles.disabled : null]}
                testID={testID ? `${testID}-to-${candidate.id}` : undefined}
              >
                <View style={styles.marker}>
                  {isCurrent ? (
                    <HeytaIcon
                      data={Check}
                      size={tokens['icon.xs']}
                      color={tokens['color.primary']}
                    />
                  ) : null}
                </View>
                <Text style={[text['row-meta'], styles.optionName]}>
                  {candidate.name}
                  {isCurrent ? ` ${labels.current}` : ''}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}
