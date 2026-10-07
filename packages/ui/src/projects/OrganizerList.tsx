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
 * 摘要：composer（新建输入框）· 取色控件 —— 留在各端。
 * ✅ **改名、归档与「显示已归档」已在共享层**（2026-10-03，多端第三批：
 * `onRename` / `onArchive` + `labels.rename` / `labels.archive`，两端都传了；
 * 判据在 `apps/mobile/tests/organizer-rename.spec.ts`）。
 * ✅ **删除确认也在共享层**（同日 W4b，`labels.confirmRemove` + `removeImpact`）——
 * 它原先写在这里是"留在各端"那一条，而那条**从未落地**：`OrganizerList` 的注释说
 * 确认是宿主的事，两个宿主**一个都没做**，于是"删标签要不要确认"在产品上的答案是
 * "不要、一次点击立即写 op"。本组件管的是**行**，行上的每一步确认都只有一份。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 只用 RN 原语，不 import 任何 DOM 标签
 *
 * `View` / `Text` / `Pressable` 在 `react-native-web` 上都有等价实现；
 * `<li>` 在 iOS 上不存在。
 */

import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { HeytaNativeTokens } from '@heyta/design-system';
import { Archive, ArchiveRestore, Check, Pencil, Trash2, X } from 'lucide';
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
  /**
   * 改名的三句文案（按钮无障碍名 / 保存 / 取消）。
   *
   * 🔴 与 `onRename` **成对传**：组件不许自己编文案（本包不 import `@heyta/i18n`，
   * 见文件头）。只传 `onRename` 不传这里，行上会出现一个**读屏念不出名字**的按钮 ——
   * 那比没有按钮更糟，因为它看起来是好的。
   */
  readonly rename?: {
    readonly button: (name: string) => string;
    readonly save: string;
    readonly cancel: string;
  };
  /** 归档/取消归档的无障碍名（同样与 `onArchive` 成对传）。 */
  readonly archive?: {
    readonly button: (name: string) => string;
    readonly unarchive: (name: string) => string;
  };
  /**
   * 删除确认那一行的四句文案（问句 / 影响面 / 确认 / 取消）。
   *
   * 🔴 **传了这份文案就等于打开了确认这一步**（与 `rename` / `archive` 的
   * "文案与回调成对"同一条规矩，只是这里要用的回调本来就是 `onRemove`）：
   * 省略 ⇒ 按下删除**直接** `onRemove`，渲染与从前逐字相同。
   *
   * 🔴 `impact` 的措辞必须说清**里面的东西不会被删除**（标签：那些任务只是不再带
   * 这个标签；清单：里面的任务不会被删除）—— 这是这一档存在的全部理由，
   * 两个方向的误判各堵一次：
   *
   * · 用户看到"这个标签在 8 个任务上用着"时读到的是"删它会动那 8 个任务"，于是**不敢删**；
   * · 反过来"随时可以重新建一个"也不能让人以为重建之后一切照旧 ——
   *   新建的同名标签拿到的是**新 id**，那 8 条任务的归属**不会**自己回来。
   */
  readonly confirmRemove?: {
    readonly ask: (name: string) => string;
    /** 影响面那句；`removeImpact` 给不出 `> 0` 时**不渲染**（没有数字就不编一句话）。 */
    readonly impact: (count: number) => string;
    readonly confirm: string;
    readonly cancel: string;
  };
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
  /**
   * 每一行**删除之后的影响面**（这条标签挂在几条存活任务上 / 这条清单里有几条任务）。
   *
   * 🔴 它**不是** `counts` 的另一种画法，两者口径不同（`counts` = 未删除**且未完成**，
   * 影响面 = 未删除、**含已完成**）—— 拿 `counts` 顶替会让确认框在一条挂满已完成任务的
   * 标签上说"没有任务受影响"。取数只有 `@heyta/ui#liveTaskCountsByTag` 一处。
   *
   * 只在 `labels.confirmRemove` 存在时被消费；`> 0` 才渲染那句影响面。
   */
  readonly removeImpact?: Readonly<Record<string, number>>;
  readonly labels: OrganizerListLabels;
  /** 点了某一行（**不是**删除）。不传 = 这些行不可点。 */
  readonly onFilterWith?: (item: OrganizerItem, context: OrganizerRowContext) => void;
  /** 删除某一行。**写库由宿主的 action 层做**（AGENTS.md §3.5）。 */
  readonly onRemove: (item: OrganizerItem) => void;
  /**
   * 改名（第二个参数是**用户已经在行内输入完的新名字**）。
   *
   * 🔴 不传 = 行上没有改名入口，渲染与从前逐字相同。共享层因此只管"怎么改"
   * （输入、保存、取消、空名不发），而**改什么由宿主的 action 层落**（§3.5）。
   * 两端各写一套行内编辑器的话，"改名要不要发第二条 op"就会出现两个答案。
   */
  readonly onRename?: (item: OrganizerItem, name: string) => void;
  /**
   * 归档 / 取消归档。第二个参数是**目标状态**（`true` = 归档）。
   *
   * 🔴 与 `onRename` 一样是"不传就什么都不渲染"。但**只给这一半是不完整的**：
   * 归档位靠 `item.archived` 决定画哪个图标、传哪个目标值，所以宿主传这个 prop 时
   * 必须把已归档的行也交给列表（`toOrganizerTree(..., { includeArchived: true })`）——
   * 否则归档是一扇**单向门**：点得进去，出不来。
   */
  readonly onArchive?: (item: OrganizerItem, archived: boolean) => void;
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
      // At the narrowest web sidebar width the action buttons cannot share a
      // line with the name. Let the action group move as one unit instead of
      // shrinking the name down to a zero-width flex item.
      flexWrap: 'wrap',
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
      // Keep a real first-line target for the leading icon and name. The
      // enclosing row wraps the action group below it when the sidebar is
      // narrow, so this is a layout floor rather than a truncation hack.
      minWidth: tokens['touch-target.min'],
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
    actions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: tokens['space.2'],
      flexShrink: 0,
      // A 192px sidebar leaves less room than the complete set of 44px
      // targets. Cap this wrapped line so the last target wraps inside the
      // sidebar instead of overflowing it.
      maxWidth: '100%',
      minWidth: 0,
    },
    /**
     * 行内改名的输入框。取值与 `NotesBoard` 的 `input` 逐条相同
     * （字段高 / 内边距 / 边框 / 底色都来自同一批 token）——
     * 同一种控件在两处用两套尺度，就是"看着像、点起来不像"的起点。
     */
    input: {
      flex: 1,
      minHeight: tokens['touch-target.min'],
      paddingHorizontal: tokens['size.field-padding-x'],
      borderRadius: tokens['radius.md'],
      backgroundColor: tokens['color.surface'],
      color: tokens['color.foreground'],
    },
    busy: {
      opacity: tokens['state.disabled-opacity'],
    },
    /**
     * 删除确认那一行。
     *
     * 🔴 `width: '100%'` 是**结构**而不是审美：外层 `styles.row` 是 `flexWrap: 'wrap'`，
     * 不给满宽的话这段会挤在删除按钮右边那一格子里，在 192px 侧栏里被切成两半 ——
     * 一句"删了会怎样"被截断，比没有这句话更糟。
     */
    confirm: {
      width: '100%',
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: tokens['space.2'],
      rowGap: tokens['space.1'],
    },
    confirmActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: tokens['space.2'],
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
  onFilterWith,
  onRemove,
  onRename,
  onArchive,
  editing,
  setEditing,
  pendingRemove,
  setPendingRemove,
  impact,
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
  readonly onFilterWith: OrganizerListProps['onFilterWith'];
  readonly onRemove: OrganizerListProps['onRemove'];
  readonly onRename: OrganizerListProps['onRename'];
  readonly onArchive: OrganizerListProps['onArchive'];
  readonly editing: boolean;
  readonly setEditing: (id: string | null) => void;
  /** 这一行是不是处在"等一下，先确认"的状态。 */
  readonly pendingRemove: boolean;
  readonly setPendingRemove: (id: string | null) => void;
  /** 这一行删除后的影响面（条数）。`undefined` 或 `<= 0` ⇒ **不渲染那句影响面**。 */
  readonly impact: number | undefined;
  readonly renderLeading: OrganizerListProps['renderLeading'];
  readonly renderItemExtra: OrganizerListProps['renderItemExtra'];
  readonly busy: boolean;
  readonly styles: ReturnType<typeof makeStyles>;
  readonly tokens: HeytaNativeTokens;
  readonly text: ReturnType<typeof useHeytaText>;
}): React.JSX.Element {
  const key = organizerRowKey(kind, item.id);
  const rename = labels.rename;
  const confirmLabels = labels.confirmRemove;
  // 草稿**留在行里**而不是提到列表里：行按 id 加了 key，所以"改到一半的这条是谁"
  // 天然跟着行走；提到父层就要自己维护 (id → 草稿) 的表，那张表迟早和列表脱节。
  const [draft, setDraft] = useState<string | null>(null);

  const stopEditing = (): void => {
    setDraft(null);
    setEditing(null);
  };

  const submitRename = (): void => {
    const next = (draft ?? item.name).trim();
    stopEditing();
    // 🔴 空名与"一个字都没改"都不发 op。
    //
    // 空名那条不是形式问题：`renameProject` / `renameTag` / `renameHabit` 对空名是
    // **抛错**的，而抛错发生在用户点完保存之后 —— 界面上的表现就是"点了没反应"。
    // 没改也不发：那是"一条意图一条 op"的反面（一次什么都没做的 UPD 会同步到所有设备，
    // 并把这条实体的向量时钟推一格）。
    if (next === '' || next === item.name || onRename === undefined) return;
    onRename(item, next);
  };

  // 改名态：**整行换成输入框**，且**不再挂 `onFilterWith`**。
  //
  // 🔴 这一点是结构问题不是审美问题：如果把 `TextInput` 塞进那块可点的
  // `styles.main`（`Pressable`）里，点输入框会同时触发"选中这一行"，
  // 于是"改个名字"会把用户带进清单筛选视图 —— 而输入框里的字还没提交。
  if (editing && rename !== undefined) {
    return (
      <View style={styles.row} testID={`${key}-row`}>
        <TextInput
          style={[text['row-title'], styles.input]}
          value={draft ?? item.name}
          onChangeText={setDraft}
          onSubmitEditing={submitRename}
          selectTextOnFocus
          autoFocus
          accessibilityLabel={rename.button(item.name)}
          testID={`${key}-rename-input`}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={rename.save}
          onPress={submitRename}
          style={styles.remove}
          testID={`${key}-rename-save`}
        >
          <HeytaIcon data={Check} size={tokens['icon.xs']} color={tokens['color.primary']} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={rename.cancel}
          onPress={stopEditing}
          style={styles.remove}
          testID={`${key}-rename-cancel`}
        >
          <HeytaIcon data={X} size={tokens['icon.xs']} color={tokens['color.foreground-muted']} />
        </Pressable>
      </View>
    );
  }

  /**
   * 行的主体：可点（`onFilterWith`）时是 `Pressable`，否则是普通 `View`。
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
      {onFilterWith === undefined ? (
        <View style={styles.main}>{body}</View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={item.name}
          onPress={() => {
            onFilterWith(item, context);
          }}
          style={styles.main}
          testID={`${key}-select`}
        >
          {body}
        </Pressable>
      )}

      <View style={styles.actions}>
        {renderItemExtra === undefined ? null : renderItemExtra(item)}

        {onRename === undefined || rename === undefined ? null : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={rename.button(item.name)}
            aria-disabled={busy}
            disabled={busy}
            onPress={() => {
              // 改名与"先确认"互斥：两个状态同时挂在这一行上时，
              // 渲染的是改名分支，那把 armed 的删除确认就变成**看不见但还在**的状态 ——
              // 用户点下一个删除时会以为自己是第一次点。
              setPendingRemove(null);
              setEditing(item.id);
            }}
            style={[styles.remove, busy ? styles.busy : null]}
            testID={`${key}-rename`}
          >
            <HeytaIcon
              data={Pencil}
              size={tokens['icon.xs']}
              color={tokens['color.foreground-muted']}
            />
          </Pressable>
        )}

        {onArchive === undefined || labels.archive === undefined ? null : (
          <Pressable
            accessibilityRole="button"
            // 名字跟着**目标动作**走（已归档的行说"取消归档"），图标也一样 ——
            // 一个说「归档」的按钮把一条已归档的清单又归档一次，是纯噪音。
            accessibilityLabel={
              item.archived === true
                ? labels.archive.unarchive(item.name)
                : labels.archive.button(item.name)
            }
            aria-disabled={busy}
            disabled={busy}
            onPress={() => {
              onArchive(item, item.archived !== true);
            }}
            style={[styles.remove, busy ? styles.busy : null]}
            testID={`${key}-archive`}
          >
            <HeytaIcon
              data={item.archived === true ? ArchiveRestore : Archive}
              size={tokens['icon.xs']}
              color={tokens['color.foreground-muted']}
            />
          </Pressable>
        )}

        {confirmLabels === undefined || !pendingRemove ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={labels.removeLabel(item.name)}
            // 🔴 用**平铺** `aria-*`，不要用对象形态 `accessibilityState` / `accessibilityValue`：
            // RNW 0.21 会把对象形态**整个丢掉**（实测 `aria-checked` / `aria-valuenow` 都不出现），
            // 而 RN 0.71+ 两端都认平铺形态。判据见 `pnpm check:rn-aria`。
            aria-disabled={busy}
            disabled={busy}
            onPress={() => {
              // 🔴 要确认的形态**不在这里写 op** —— 只是把这一行置成"等一下"。
              //
              // 为什么这一档必须有界面对话框而不是宿主各写一个：两端各写 =
              // "删标签到底要不要确认"会有两个答案，而差异不会让任何测试变红
              // （AGENTS §3.5）。为什么不是 `window.confirm`：移动端没有它，
              // 而且它的文案不受 i18n 管（`check:ui-language` 那条"界面零硬编码"从这儿开始）。
              if (confirmLabels === undefined) {
                onRemove(item);
                return;
              }
              setEditing(null);
              setPendingRemove(item.id);
            }}
            style={[styles.remove, busy ? styles.busy : null]}
            testID={`${key}-remove`}
          >
            <HeytaIcon data={Trash2} size={tokens['icon.xs']} color={tokens['color.danger']} />
          </Pressable>
        ) : null}
      </View>

      {confirmLabels === undefined || !pendingRemove ? null : (
        // 确认那一行。**只有把这一行删掉这一步走到一半时**才出现在 DOM 里 ——
        // 没点删除时它一个节点都不渲染，所以"默认形态与从前逐字相同"是可证的
        // （判据：不传 `labels.confirmRemove` 时 DOM 里没有 `…-confirm`）。
        <View style={styles.confirm} accessibilityLiveRegion="polite" testID={`${key}-confirm`}>
          <Text style={[text['row-meta'], { color: tokens['color.foreground'] }]}>
            {confirmLabels.ask(item.name)}
          </Text>
          {impact === undefined || impact <= 0 ? null : (
            <Text style={[text.caption, { color: tokens['color.foreground-muted'] }]}>
              {confirmLabels.impact(impact)}
            </Text>
          )}
          <View style={styles.confirmActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={confirmLabels.confirm}
              aria-disabled={busy}
              disabled={busy}
              onPress={() => {
                // 先收状态再回调：宿主的 `onRemove` 会让这一行整条消失，
                // 之后再 setState 就是对着已卸载的行写状态。
                setPendingRemove(null);
                onRemove(item);
              }}
              style={[styles.remove, busy ? styles.busy : null]}
              testID={`${key}-confirm-yes`}
            >
              <HeytaIcon data={Trash2} size={tokens['icon.xs']} color={tokens['color.danger']} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={confirmLabels.cancel}
              onPress={() => {
                setPendingRemove(null);
              }}
              style={styles.remove}
              testID={`${key}-confirm-no`}
            >
              <HeytaIcon data={X} size={tokens['icon.xs']} color={tokens['color.foreground-muted']} />
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

export function OrganizerList({
  kind,
  items,
  counts,
  removeImpact,
  labels,
  onFilterWith,
  onRemove,
  onRename,
  onArchive,
  renderLeading,
  renderItemExtra,
  busy = false,
  testID,
}: OrganizerListProps): React.JSX.Element {
  const tokens = useHeytaTokens();
  const text = useHeytaText();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);
  // 同时只有一行在改名。这不是优化：两行同时开着时"保存"落在哪一行
  // 只能靠点击顺序猜，而移动端屏幕小、行又窄。
  const [editingId, setEditingId] = useState<string | null>(null);
  // 同上，另一侧：**同时只有一行在"等一下，先确认"**。两行都 armed 时
  // 「确认删除」落在哪一条只能靠点的顺序猜，而删错了没有回收站可捞（标签不进回收站）。
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null);

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
            onFilterWith={onFilterWith}
            onRemove={onRemove}
            onRename={onRename}
            onArchive={onArchive}
            editing={editingId === node.id}
            setEditing={setEditingId}
            pendingRemove={pendingRemoveId === node.id}
            setPendingRemove={setPendingRemoveId}
            impact={removeImpact?.[node.id]}
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
                  onFilterWith={onFilterWith}
                  onRemove={onRemove}
                  onRename={onRename}
                  onArchive={onArchive}
                  editing={editingId === child.id}
                  setEditing={setEditingId}
                  pendingRemove={pendingRemoveId === child.id}
                  setPendingRemove={setPendingRemoveId}
                  impact={removeImpact?.[child.id]}
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
