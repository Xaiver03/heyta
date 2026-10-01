/**
 * `TaskGroupHead` —— 任务列表**日期分组头**，四端同一份
 * =====================================================
 *
 * ## 它是什么
 *
 * 滴答同款的分组头：组名 + 组内计数 + 一条细横线，右侧可挂一个动作
 * （web 的逾期组挂「顺延」）。2026-09-30 排版审计（goal-layout-audit.md 页 7）
 * 由 web 手写 CSS 升为共享组件 —— 升级的原因不是"想复用"，而是 web 侧的
 * `check:row-single-source` 门禁**挡住了它**：`.ht-task-group` 是一个净增的
 * CSS 前缀族，而这条门禁的判据就是"任务列表的实现只长在 packages/ui"。
 * 门禁是对的：组头是**列表的机制**（归属规则在领域 `groupTasksByDate`），
 * 不是某个壳的皮肤 —— 留在 web 里，mobile 想要滴答同款分组时就得抄第二遍。
 *
 * ## 分工
 *
 * - **归属规则**在 `@heyta/domain` 的 `groupTasksByDate`（哪条任务进哪组）；
 * - **措辞**在宿主（共享层不 `import '@heyta/i18n'`，见 `calendar/model.ts` 文件头）；
 * - **折叠状态**在宿主（`collapse`）：哪些组收起是这一屏的事，本层只画
 *   "收着长什么样、点哪儿展开"，收起后**列表由宿主不渲染**，本层不认识列表；
 * - **本组件**只管这一层皮：横排、计数靠右、细横线、动作槽。
 *   `action` 是宿主渲染的节点（与 `TaskList.renderTrailing` 同一分工）——
 *   动作是按钮还是菜单由宿主决定，本层不造第二种按钮。
 */

import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ChevronDown, ChevronRight } from 'lucide';

import type { HeytaNativeTokens } from '@heyta/design-system';

import { HeytaIcon } from '../icon/Icon.js';
import { useHeytaText, useHeytaTokens } from '../theme.js';

/**
 * 折叠接线。**状态在宿主**（哪个宿主、哪一屏收起过哪些组，共享层不知道），
 * 共享层只负责"收起来长什么样、点哪儿展开"。
 *
 * 🔴 又是一个**对象而不是两个可选字段**（与 `CaptureComposerProps.destination`
 * 同一条理由）：`collapsed` 与 `onToggle` 必须同时成立或同时不成立 ——
 * 拆开了就能只传一半，而"显示成收起、点不开"和"能点开、看不出来收着"
 * 都是界面在说谎，且没有任何类型会拦。
 */
export interface TaskGroupCollapse {
  readonly collapsed: boolean;
  readonly onToggle: () => void;
}

export interface TaskGroupHeadProps {
  /** 组名（宿主已措辞，如「今天, 周三」）。 */
  readonly title: string;
  /** 组内任务数 —— **渲染什么数字由调用方给**，本层不数。 */
  readonly count: number;
  /** 组头右侧的动作槽（宿主渲染的节点；不传就没有）。 */
  readonly action?: React.ReactNode;
  /**
   * 传了就整条组头变成按钮（左侧多一个 ▸/▾）。
   *
   * ⚠️ 收起时**计数照旧显示**：那正是"要不要展开来看"的决策依据。
   * 组里剩几条任务如果被折叠藏掉了，折叠就成了掩耳盗铃。
   */
  readonly collapse?: TaskGroupCollapse | undefined;
  readonly testID?: string | undefined;
}

export function TaskGroupHead({
  title,
  count,
  action,
  collapse,
  testID = 'task-group-head',
}: TaskGroupHeadProps): React.JSX.Element {
  const tokens = useHeytaTokens();
  const text = useHeytaText();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);

  /**
   * 组头的**内容**：〔▸/▾〕+ 组名 + 计数。动作槽**不在这里面** ——
   *
   * 🔴 有折叠时动作必须落在按钮**外面**。嵌进去的话，点逾期组的「顺延」
   * 会同时命中外层组头，一次点击既推了日期又收起了组 —— 而"点一个按钮
   * 做了两件没约定过的事"正是这一族界面 bug 的原形。
   */
  const row = (
    <>
      {collapse === undefined ? null : (
        <HeytaIcon
          data={collapse.collapsed ? ChevronRight : ChevronDown}
          size={tokens['icon.xs']}
          color={tokens['color.foreground-subtle']}
        />
      )}
      {/* 读屏时组头是一个标题：先念组名再进组内行，而不是把计数混在正文里。 */}
      {/*
        🔴 语义样式**整条**在前，`styles.title` 只补布局（flex）与颜色 ——
        2026-09-30 排版审计把字号字重收进 `section-title` 时，这条 `flex: 1`
        随着旧的 `styles.title` 一起被换掉了，于是"计数靠右"（见文件头分工）
        静默退化成了"计数紧跟组名"。那种退化截图上看不出来，只能对着文档读实现。
      */}
      <Text accessibilityRole="header" style={[text['section-title'], styles.title]}>
        {title}
      </Text>
      {/* 计数必须 tabular：数字宽度不稳会让整排组头的"计数列"看着在抖。 */}
      <Text style={styles.count}>{count}</Text>
    </>
  );

  return (
    <View style={styles.head} testID={testID}>
      {collapse === undefined ? (
        row
      ) : (
        /**
         * 🔴 无障碍名**不另写一句**：这个按钮的内容就是「▾ 今天 3」，
         * 读屏把组名和计数一起念出来，再补一句「展开/收起」反而是噪音。
         *
         * ⚠️ 状态用**平铺** `aria-expanded`，不要用 `accessibilityState`：
         * RNW 0.21 会把对象形态整个丢掉（属性根本不出现），而 `check:rn-aria`
         * 扫的就是这一族 —— 原生认对象形态、web 不认，写错只会在 web 上静默失效。
         */
        <Pressable
          style={styles.toggle}
          accessibilityRole="button"
          aria-expanded={!collapse.collapsed}
          onPress={collapse.onToggle}
          testID={`${testID}-toggle`}
        >
          {row}
        </Pressable>
      )}
      {/* 动作槽永远是组头的**同级**，不是组头按钮的后代（理由见 `row` 的注释）。 */}
      {action !== undefined ? action : null}
    </View>
  );
}

function makeStyles(tokens: HeytaNativeTokens) {
  return StyleSheet.create({
    head: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: tokens['space.2'],
      paddingTop: tokens['space.2'],
      paddingBottom: tokens['space.2'],
      borderBottomWidth: tokens['border-width.thin'],
      borderBottomColor: tokens['color.border'],
    },
    /**
     * 可点的那一层：**占满整条组头**，这样"点组头"不要求点中那几个字。
     *
     * 🔴 **自己不加内边距**：组头的高度由 `head` 的 padding 决定，是**同一个组件
     * 可点与不可点两种形态**共用的那条尺寸 —— 这里再加一层就等于
     * "有没有折叠"会改变列表的行高，而折叠是交互，不是排版。
     */
    toggle: {
      flexDirection: 'row',
      alignItems: 'center',
      // 🔴 `flex: 1` 而不是 `alignSelf: 'stretch'`：row 是横排，`alignSelf` 拉的是
      //    **交叉轴（纵向）**，横向上的"占满"要靠主轴的 flex —— 写错的表现是
      //    "只有那几个字能点"，而它在截图上完全看不出来。
      //    有了它，动作槽才被推到组头最右端（文件头说的「右侧可挂一个动作」）。
      flex: 1,
      gap: tokens['space.2'],
    },
    title: {
      // 🔴 只留颜色与布局，**不覆盖字号字重** —— 那是 `section-title`
      //    语义样式的职责（web 端曾在此覆盖成 sm，与移动端分组头漂移；
      //    2026-09-30 排版审计修正：语义样式必须整条消费，不许拆开挑）。
      flex: 1,
      color: tokens['color.foreground-muted'],
    },
    count: {
      fontSize: tokens['font-size.xs'],
      color: tokens['color.foreground-subtle'],
      fontVariant: ['tabular-nums'],
    },
  });
}
