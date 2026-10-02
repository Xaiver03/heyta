/**
 * 清单 / 标签的行列表（共享视图）
 * ==================================
 *
 * M3 第九刀（projects）的主角：**"一个清单/标签在侧栏里长什么样"只有这一个实现。**
 * web 的侧栏（`ProjectsPanel`）与移动端「我的」页里的清单/标签两段
 * 都渲染这一份 —— 差别只剩"放在页面的哪里"和宿主注入的文案/插槽。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 为什么需要它（不是"少写点代码"）
 *
 * 迁移前两端各自的清单/标签行**长得不一样、判断也不同**，而且差异不会让
 * 任何测试变红：
 *
 * | 事 | web（迁移前） | mobile（迁移前） |
 * |---|---|---|
 * | 层级 | 顶层 + 一层子清单（`selectChildProjects`）| **平表**（直接渲染 `listProjects()`）|
 * | 计数 | 每行一个未完成计数（`countIn`，**每个清单遍历一次全部任务**）| **没有** |
 * | 取色 | 行内 `ColorSlotPicker` | 没有 |
 * | 名字 | `<span>` / `<button class="ht-nav__item">` | kit `Text` |
 *
 * 也就是说"清单有且只有一层嵌套"这条**领域规则**在两端有两种界面表现。
 * 本组件 + `./model.ts` 把这条规则收成一处：层级、计数口径、稳定 key
 * 全在模型里，组件只负责摆。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 计数位只在 `> 0` 时渲染
 *
 * 迁移前 web 的 `countIn` **总是**渲染那个 `<span>`（空清单显示 `0`）。
 * 共享层改成"只画非零" —— 与 `App.tsx` 的 `NavButton`（`count > 0`）同一条
 * 规则，也让移动端第一次拿到计数时不会每行顶一个 `0`。
 * ⚠️ 这是一处**可见的行为变化**（web 侧栏空清单上的 `0` 消失），
 * 不是渲染细节 —— 已登记在汇报里。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 文案与插槽一律由宿主注入，本文件不 import `@heyta/i18n`
 *
 * 与 `TaskList` / `HabitBoard` / `CategoryReport` 同一个理由：i18n 包自己带过
 * 一份 React，四端会同时中招（`check:mobile-bundle` 盯着）。所以依赖行内容的
 * 文案（`removeLabel`）是函数，模板留在有 i18n 的那一侧。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 没装进共享层的（见 `./model.ts` 文件头，那里逐条写了证据 / 影响 / 最小一步）
 *
 * 摘要：composer（新建输入框）· 取色控件 · 删除确认 / 改名 / 归档 ·
 * "显示已归档"的开关 —— 都留在各端或本刀未做。本组件管的是**行**。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 只用 RN 原语，不 import 任何 DOM 标签
 *
 * `View` / `Text` / `Pressable` 在 `react-native-web` 上都有等价实现；
 * `<li>` 在 iOS 上不存在。
 */

import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { HeytaNativeTokens } from '@heyta/design-system';
import { Trash2 } from 'lucide';
import { HeytaIcon } from '../icon/Icon.js';
import { useHeytaText, useHeytaTokens } from '../theme.js';
import { organizerRowKey, type OrganizerItem, type OrganizerNode } from './model.js';

/** 面板全部文案，**每一项都由宿主注入**（见文件头）。 */
export interface OrganizerListLabels {
  /**
   * 一行的删除按钮无障碍名，**必须带上具体是哪一条**。
   * 读屏用户听到一串「删除清单」而无从分辨要删哪个。
   */
  readonly removeLabel: (name: string) => string;
  /** 列表为空时那一句。省略就**不渲染任何空态**（web 侧栏迁移前就是这样）。 */
  readonly empty?: string;
  /**
   * 空态下面那句补充说明。
   *
   * 🔴 它是**产品必需**而非装饰（移动端原来就有）：不写清楚，用户会以为
   * "删清单 = 删任务"或"删标签 = 动那些任务"，于是**不敢删** ——
   * 一个不敢用的功能等于没有。
   */
  readonly emptyHint?: string;
}

/** 每一行渲染时给插槽的上下文。 */
export interface OrganizerRowContext {
  /** 这一行是不是某个顶层清单的子清单（宿主据此决定要不要画前导图标）。 */
  readonly isChild: boolean;
}

export interface OrganizerListProps {
  /**
   * 这一列装的是哪个实体。
   *
   * 🔴 它同时决定 React key 的前缀：清单与标签的 id 由同一个 `randomId()`
   * 生成、理论上可能撞，而两块在宿主里是**相邻的两个列表**。
   * 用裸 id 时 React 不会跨列表复用，但把实体写出来能让"这段代码在渲染什么"
   * 在调用处就看得见 —— 迁移前 mobile 那两份 section 就是靠文件名表达的。
   */
  readonly kind: 'project' | 'tag';
  /** 顶层行（含一层子级）。由 `toOrganizerTree` / `toOrganizerNodes` 产出。 */
  readonly items: readonly OrganizerNode[];
  /**
   * 每行的未完成任务数（清单 = `openTaskCounts`，标签 = `openTagCounts`）。
   *
   * 省略 = **不渲染计数位**。🔴 这个"可选"不是给标签留的出口（那是当初的理由，
   * 已被推翻：参照图侧栏**每一行**都有数字，而 per-tag 计数在领域里成立）——
   * 它留的是"宿主这一屏确实不关心计数"的可能。**口径两节必须一致**，
   * 否则同一个数字在侧栏上下两节长成两种含义，用户只会看到"这两个数对不上"。
   */
  readonly counts?: Readonly<Record<string, number>>;
  readonly labels: OrganizerListLabels;
  /** 点了某一行（**不是**删除）。不传 = 这些行不可点。 */
  readonly onSelect?: (item: OrganizerItem, context: OrganizerRowContext) => void;
  /** 删除某一行。**写库由宿主的 action 层做**（AGENTS.md §3.5）。 */
  readonly onRemove: (item: OrganizerItem) => void;
  /** 行首插槽（web 是文件夹 / 标签图标）。不传就不渲染。 */
  readonly renderLeading?: (
    item: OrganizerItem,
    context: OrganizerRowContext,
  ) => React.ReactNode;
  /** 行尾（删除按钮之前）插槽：web 的取色入口。不传就不渲染。 */
  readonly renderItemExtra?: (item: OrganizerItem) => React.ReactNode;
  /** 正在落盘 —— 置灰删除按钮，防连点发出两条 op。 */
  readonly busy?: boolean;
  readonly testID?: string;
}

/** 取一份 token 表，建出这套样式。**一个裸尺度值都没有**（`check:design` 会拦）。 */
function makeStyles(tokens: HeytaNativeTokens) {
  return StyleSheet.create({
    list: {
      flexDirection: 'column',
    },
    /** 子级缩进：一层，与迁移前 web 的 `paddingLeft: space.4` 同值。 */
    children: {
      paddingLeft: tokens['space.4'],
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: tokens['space.2'],
      // 「这一行是一个可点目标」的最小高度。删除按钮是行内唯一的紧凑元素，
      // 触控目标下限靠它保证。
      minHeight: tokens['touch-target.min'],
    },
    /** 可点的那部分（图标 + 名字）吃掉剩余宽度。 */
    main: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: tokens['space.2'],
      minHeight: tokens['touch-target.min'],
    },
    name: {
      flexShrink: 1,
    },
    /** 计数：等宽数字，否则同一个清单在两次渲染里宽度会跳。 */
    count: {
      fontVariant: ['tabular-nums'],
      color: tokens['color.foreground-muted'],
    },
    /**
     * 分隔线。
     *
     * 🔴 用它而不是阴影 / 位移来表达层次（AGENTS.md §5：扁平风格用边框）。
     */
    divider: {
      height: tokens['border-width.thin'],
      backgroundColor: tokens['color.border-subtle'],
    },
    empty: {
      gap: tokens['space.1'],
    },
    remove: {
      alignItems: 'center',
      justifyContent: 'center',
      width: tokens['touch-target.min'],
      height: tokens['touch-target.min'],
      borderRadius: tokens['radius.md'],
    },
    busy: {
      opacity: tokens['state.disabled-opacity'],
    },
  });
}

/**
 * 一行。
 *
 * 抽出来是为了让"缩进"这件事只由**调用处**回答（顶层不缩、子级缩一层），
 * 而行的骨架只写一次。
 */
function OrganizerRow({
  kind,
  item,
  context,
  count,
  labels,
  onSelect,
  onRemove,
  renderLeading,
  renderItemExtra,
  busy,
  styles,
  tokens,
  text,
}: {
  readonly kind: 'project' | 'tag';
  readonly item: OrganizerItem;
  readonly context: OrganizerRowContext;
  readonly count: number | undefined;
  readonly labels: OrganizerListLabels;
  readonly onSelect: OrganizerListProps['onSelect'];
  readonly onRemove: OrganizerListProps['onRemove'];
  readonly renderLeading: OrganizerListProps['renderLeading'];
  readonly renderItemExtra: OrganizerListProps['renderItemExtra'];
  readonly busy: boolean;
  readonly styles: ReturnType<typeof makeStyles>;
  readonly tokens: HeytaNativeTokens;
  readonly text: ReturnType<typeof useHeytaText>;
}): React.JSX.Element {
  const key = organizerRowKey(kind, item.id);
  /**
   * 行的主体：可点（`onSelect`）时是 `Pressable`，否则是普通 `View`。
   *
   * 🔴 两种形态的**子节点逐字相同** —— 这样"可点"只是多了一个 `onPress`，
   * 不会长出第二份行骨架。迁移前 web 用 `<button class="ht-nav__item">`、
   * 移动端用不可点的 `Text`，两边的结构其实不一样。
   */
  const body = (
    <>
      {renderLeading === undefined ? null : renderLeading(item, context)}
      <Text style={[text['row-title'], styles.name]} numberOfLines={1}>
        {item.name}
      </Text>
      {/* 计数位只在非零时出现（见文件头）。 */}
      {count === undefined || count <= 0 ? null : (
        <Text style={[text.caption, styles.count]} testID={`${key}-count`}>
          {count}
        </Text>
      )}
    </>
  );

  return (
    <View style={styles.row} testID={`${key}-row`}>
      {onSelect === undefined ? (
        <View style={styles.main}>{body}</View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={item.name}
          onPress={() => {
            onSelect(item, context);
          }}
          style={styles.main}
          testID={`${key}-select`}
        >
          {body}
        </Pressable>
      )}

      {renderItemExtra === undefined ? null : renderItemExtra(item)}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={labels.removeLabel(item.name)}
        // 🔴 用**平铺** `aria-*`，不要用对象形态 `accessibilityState` / `accessibilityValue`：
        // RNW 0.21 会把对象形态**整个丢掉**（实测 `aria-checked` / `aria-valuenow` 都不出现），
        // 而 RN 0.71+ 两端都认平铺形态。判据见 `pnpm check:rn-aria`。
        aria-disabled={busy}
        disabled={busy}
        onPress={() => {
          onRemove(item);
        }}
        style={[styles.remove, busy ? styles.busy : null]}
        testID={`${key}-remove`}
      >
        <HeytaIcon data={Trash2} size={tokens['icon.xs']} color={tokens['color.danger']} />
      </Pressable>
    </View>
  );
}

export function OrganizerList({
  kind,
  items,
  counts,
  labels,
  onSelect,
  onRemove,
  renderLeading,
  renderItemExtra,
  busy = false,
  testID,
}: OrganizerListProps): React.JSX.Element {
  const tokens = useHeytaTokens();
  const text = useHeytaText();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);

  if (items.length === 0) {
    // 宿主不传 `empty` 就什么都不渲染（web 侧栏迁移前的行为，见文件头）。
    if (labels.empty === undefined) {
      return <View testID={testID} />;
    }
    return (
      <View style={styles.empty} testID={testID ?? 'organizer-empty'}>
        {/*
          🔴 这两句是**组标题的下属**，不是列表项 —— 它们以前接的是 `row-title`
          （16px，全应用最高频的正文档），于是 web 侧栏里出现过一次实测的倒挂：
          分组头「清单」11px，而它下面的「还没有清单」16px，说明比标题大 1.45 倍。
          产品负责人原话：「那为什么这个标题那么小，反而是下面说明的文本那么大呢？」

          现在整条往下挪一档：主句 `row-meta`（14 regular）、补充 `caption`（12 medium），
          与新的 `group-label`（14 semibold）之间**字号与字重两条轴都单调下降**。
          那条层级关系钉在 `packages/design-system/tests/typography.spec.ts`
          （"组标题档压得住它管辖的每一档说明"），所以这里换回 row-title 会红 ——
          而那才是它该有的样子：一次改版的顺手，不该靠人记得。

          ⚠️ 为什么用 `row-meta` 而不是新增一个"空态标题"档：档位表刻意只有
          十来个（"每多一个样式就多一处该用哪个的模糊"），而 14+regular 这一条
          已经存在。它的名字是从最高频用途（任务行次要信息）留下的，
          **值是"组内次要文字"** —— 复用它，不是挪用。
        */}
        <Text style={[text['row-meta'], { color: tokens['color.foreground-muted'] }]}>
          {labels.empty}
        </Text>
        {labels.emptyHint === undefined ? null : (
          <Text style={[text.caption, { color: tokens['color.foreground-subtle'] }]}>
            {labels.emptyHint}
          </Text>
        )}
      </View>
    );
  }

  return (
    <View style={styles.list} testID={testID}>
      {items.map((node, index) => (
        <React.Fragment key={organizerRowKey(kind, node.id)}>
          {index > 0 ? <View style={styles.divider} /> : null}
          <OrganizerRow
            kind={kind}
            item={node}
            context={{ isChild: false }}
            count={counts?.[node.id]}
            labels={labels}
            onSelect={onSelect}
            onRemove={onRemove}
            renderLeading={renderLeading}
            renderItemExtra={renderItemExtra}
            busy={busy}
            styles={styles}
            tokens={tokens}
            text={text}
          />
          {node.children.length === 0 ? null : (
            <View style={styles.children}>
              {node.children.map((child) => (
                <OrganizerRow
                  key={organizerRowKey(kind, child.id)}
                  kind={kind}
                  item={child}
                  context={{ isChild: true }}
                  count={counts?.[child.id]}
                  labels={labels}
                  onSelect={onSelect}
                  onRemove={onRemove}
                  renderLeading={renderLeading}
                  renderItemExtra={renderItemExtra}
                  busy={busy}
                  styles={styles}
                  tokens={tokens}
                  text={text}
                />
              ))}
            </View>
          )}
        </React.Fragment>
      ))}
    </View>
  );
}
