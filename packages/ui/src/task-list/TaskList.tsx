/**
 * TaskList —— 四端共用的任务列表
 * ==============================
 *
 * M1 的**验证切片**：如果这一个组件能在 Web / iOS / Android / 鸿蒙上
 * 用同一份源码渲染出来，那么"一套代码多端"这条路就成立；
 * 如果不成立，越早发现越好 —— 所以这块刻意选了**有真实复杂度**的组件
 * （列表、排序、命中区、无障碍、主题、插槽），而不是一个 Hello World。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 分工：**共享组件管机制，宿主管内容**
 *
 * 这是读完 `apps/mobile/src/screens/TasksScreen.tsx` 之后定下来的，
 * 不是一开始就设计好的。第一版 `TaskList` 只有"勾选框 + 标题"，而 mobile
 * 既有的行还有：截止徽章、优先级徽章、重复规则标记、删除按钮，
 * 以及**点行 = 打开详情**（不是切换完成）。
 *
 * 所以直接替换就是**产品退化**。仔细看那些差异会发现，里面只有
 * **文案与配色**是真差异，其余全都是可以共享的机制：
 *
 * | 共享组件负责（有判断、有测试） | 宿主负责（本地化、平台化） |
 * |---|---|
 * | 排序（按 `sort` 口径调领域的 `sortTasks`，判据不在本包） | 截止文案（`t()`） |
 * | `TaskRow` 派生（含 `completedAt` 存在性判断） | 优先级徽章文字与颜色 |
 * | 行骨架、勾选框尺寸与 44 触控区补偿 | 重复规则的句子 |
 * | 无障碍 role / state / busy | 无障碍**文案**（必须整句，见下） |
 * | 空态与列表稳定性 | 尾部动作（删除按钮等） |
 *
 * 于是宿主注入 `renderMeta` / `renderTrailing` / `labels` 三个插槽，
 * 而**"一行长什么样"这件事本身**只写一次。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 `TaskList` 只负责"列表"，**行本身在 `TaskRow.tsx`**（2026-09-28 抽出）
 *
 * 抽取前，行的 JSX **内联在本文件的 `renderItem` 里** —— 于是
 * `docs/research/dida-view-unification.md` §4.2 的契约
 *（列表 = `<TaskRow density="comfortable" />` / 象限卡 = `compact` /
 * 日历格 = `minimal`）**只满足了一半**：象限确实复用了共享 `TaskList`，
 * 但不存在一个能传档位的行组件，"同一行、多档密度"无从谈起。
 *
 * 现在：行 = `<TaskRow density>`（`TaskRow.tsx`），
 * 档位差异 = `DENSITY_SPEC`（`density.ts`）。本文件只把 `density`
 * 透传下去（默认 `comfortable`），**不解释**任何档位细节。
 * 判据见 `tests/task-row-density.spec.ts`。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 本文件刻意**不 import `@heyta/i18n`**
 *
 * i18n 包曾自己带了一份 React，导致 Android 产物里出现**两个 React 实例**
 * （钩子报 Invalid hook call，而报错位置离根因很远）。这件事已经踩过一次，
 * 仓库里因此有 `check:mobile-bundle` 门禁盯着。
 *
 * 共享组件是**被所有人依赖**的那一层，它一旦引入一个会拖进 React 的包，
 * 四个端会同时中招。所以文案一律靠宿主注入 —— 这也是 `labels` 里每一项
 * 都是 `(row) => string` 而不是 `string` 的原因：文案依赖行内容
 * （"完成：买牛奶"），而模板必须留在有 i18n 的那一侧。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 只用 RN 原语，不 import 任何 DOM 标签
 *
 * `View` / `Text` / `Pressable` / `FlatList` 在 `react-native-web` 上都有等价实现；
 * 而 `<div>` 在 iOS 上不存在。**写错一次的代价是三个端各改一遍**，
 * 所以这条必须从第一个组件就守住。
 */

import React, { useCallback, useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { parseCssShadow, TASK_ROW_SHAPE } from '@heyta/design-system';
import { EmptyState } from '../empty-state/EmptyState.js';
import type { CategoryColorToken } from '../categories/model.js';
import type { Task, TaskSortKey } from '@heyta/domain';
import { useHeytaText, useHeytaTokens } from '../theme.js';
import type { TaskRowDensity } from './density.js';
import { shouldShowListCard } from './card-policy.js';
import { TaskRow, type TaskRowLabels } from './TaskRow.js';
import type { TaskRowSwipeSpec } from './row-actions.js';
import {
  flattenSections,
  toTaskRows,
  type SectionRow,
  type TaskRow as TaskRowModel,
  type TaskSection,
} from './model.js';

/**
 * 行级无障碍文案。**每一项都是一整句**，不要用前缀拼标题。
 *
 * ⚠️ 定义已搬到 `TaskRow.tsx`（`TaskRowLabels`）—— 行是本文件渲染的，
 * 所以 `TaskList` import `TaskRow`（值）；若 `TaskRow` 反过来 import
 * `TaskList`（类型），就成了互相 import。这里只做**名字转发**，
 * 公开名 `TaskListLabels` 与 `index.ts` 的导出行都不变。
 * 理由与"为什么同名函数/接口可以合并"见 `TaskRow.tsx` 文件头。
 */
export type { TaskRowLabels };
export type TaskListLabels = TaskRowLabels;

interface TaskListSharedProps {
  /** 勾选/取消勾选。**不要在组件内部改数据** —— 变更必须走宿主的 action 层。 */
  readonly onToggleTask: (taskId: string) => void;
  /**
   * 点整行的行为。**给了就打开详情；不给时整行不可点。**
   *
   * ⚠️ mobile 的既有实现是"点行 = 打开详情"，理由是
   * 「行上的主操作应该是打开它」—— 切换完成有专门的勾选框，
   * 那样读屏用户不必先打开详情再去找按钮。
   *
   * 注意这里**刻意不把"没给 onOpenTask"降级成"点行=切换完成"**：
   * 那个默认值会让"忘了传 onOpenTask"表现成**点一下就误完成一条任务**，
   * 而这是不可撤销语义上的破坏。宁可不可点。
   */
  readonly onOpenTask?: (taskId: string) => void;
  /** 长按行的入口（移动端 = 上下文菜单；批量态 = 勾选）。归派由宿主决定，见 `TaskRow.tsx`。 */
  readonly onLongPressTask?: (taskId: string) => void;
  /**
   * **左滑露出的动作**（移动端第二入口，`row-actions-redesign.md` §3.4）。
   * 透传给 `TaskRow`；不传 = 行不响应横向手势（Web 与日历档都不传）。
   */
  readonly swipeActions?: (row: TaskRowModel) => TaskRowSwipeSpec | null;
  readonly labels?: TaskListLabels;
  /** 标题槽覆盖（如桌面端原位重命名输入框）。 */
  readonly renderTitle?: (row: TaskRowModel) => React.ReactNode | undefined;
  /** 行首行右侧的元信息（归属 / 截止 / 优先级…）。 */
  readonly renderMeta?: (row: TaskRowModel) => React.ReactNode;
  /** 行尾的动作或标记。 */
  readonly renderTrailing?: (row: TaskRowModel) => React.ReactNode;
  /** 标题正下方的离散副行（备注单行摘要 / 彩色标签胶囊）。 */
  readonly renderSubline?: (row: TaskRowModel) => React.ReactNode;
  /**
   * 行首那枚「清单图标」的颜色（产品拍板：**只有清单图标着色**）。
   *
   * 🔴 **不传 = 关**，而"关"是**不渲染那枚节点**（判据在 `TaskRow` 那一侧）。
   * 传的是**函数**而不是颜色表：共享层不查实体表，宿主按三态
   * （按清单 / 按标签 / 关）自己解析好 —— 与 `renderMeta` 同一条边界。
   */
  readonly iconColorOf?: (row: TaskRowModel) => CategoryColorToken | undefined;
  /** 正在处理中的行 id —— 用于置灰该行，避免连点发出两条变更。 */
  readonly busyTaskId?: string | null;
  /**
   * 键盘光标所在的行 id（"回车会打开哪一条"）。省略或 `null` = 不高亮。
   *
   * 🔴 这是**视图态**，不是数据 —— 它不进 op-log、不进 store，
   * 由宿主的面板本地 state 持有。放在列表这一层而不是让宿主自己找行，
   * 是因为"哪一行"只有列表知道自己展平成了什么顺序。
   */
  readonly activeTaskId?: string | null;
  /** 批量选择态中的任务 id。 */
  readonly selectedTaskIds?: ReadonlySet<string>;
  /** 选择态把行首勾选框用于批量选择，而不是完成任务。 */
  readonly selectionMode?: boolean;
  /** 标题为空时的替代文案（空标题是真实存在的，见 `model.ts`）。 */
  readonly fallbackTitle?: string;
  /** 没有任务时显示什么。省略则不渲染空态。 */
  readonly emptyMessage?: string;
  /** 列表根节点的测试标识。 */
  readonly testID?: string;
  /**
   * 列表头内容。移动端用它承载当前列表的筛选与视图控制，保证控制区与
   * 任务行共享同一个纵向滚动宿主；其它宿主可省略。
   */
  readonly listHeaderComponent?: React.ReactElement | React.ComponentType;
  /**
   * Reminders 风格：**列表底部常驻一行「＋ 新提醒事项」内联新建入口**（仅列表非空时显示）。
   * 只回吐意图，打开哪个面板由宿主决定——共享层不认识表单。
   */
  readonly onInlineAdd?: () => void;
  /** `onInlineAdd` 行的文案（宿主用 `t()` 解析后传入，与行的其它文案同一套规矩）。 */
  readonly inlineAddLabel?: string;
  /** 空列表时的完整空态；给出后优先于 `emptyMessage`。 */
  readonly emptyComponent?: React.ReactElement | React.ComponentType;
  /**
   * **本列表里的行有多紧凑。** 默认 `'comfortable'` —— 就是抽取 `TaskRow`
   * 之前那段内联行的行为，所以不传时逐字节等价。
   *
   * 这一个 prop 是"容器决定密度"的落点：列表不传、象限卡传 `compact`、
   * 日历格传 `minimal`（`dida-view-unification.md` §4.3 的"视图 = 查询 +
   * 容器 + 密度"）。差异本身全在 `density.ts` 的 `DENSITY_SPEC`，
   * 这里只做透传，**不认识任何档位**。
   */
  readonly density?: TaskRowDensity;
  /**
   * 空分组是否保留（只在分节形态下有意义）。
   *
   * 默认 `false` —— "已完成 0"这种标题是噪音。但**固定槽位**的布局是例外：
   * 四象限矩阵里空格本身就是信息，藏掉会让人以为那个象限不存在。
   *
   * ⚠️ 它放在**共有**属性上而不是分节分支上，是因为解构联合类型时
   * 只有"所有成员都有"的属性才可见 —— 放在分支上会让解构直接编译不过。
   */
  readonly keepEmptySections?: boolean;
  /**
   * 排序口径。**平铺形态**：整表按这一档排（默认 `display`）；
   * **分节形态**：每一组**各自**按这一档排，分组之间的顺序仍是宿主的（不重排）。
   * 分节形态下不传 = 保持宿主给的顺序，老宿主的行为逐字节不变。
   *
   * 和上面 `keepEmptySections` 同样挂在共有属性上，理由就是那条解构规则。
   *
   * ⚠️ 判据不在这里，在 `@heyta/domain` 的 `sortTasks`。本包只透传。
   * mobile 任务屏以前自己写 `reverse()`，那是第三份比较规则（见 `model.ts`
   * 的 `flattenSections`），现在它传档名。
   */
  readonly sort?: TaskSortKey;
  /**
   * **行外面再包一层**（宿主注入的节点，共享层不解释它）。
   *
   * 存在的唯一理由：**拖放库是 DOM 库**（`@dnd-kit/core` 要一个真实 DOM 节点），
   * 而共享层只许用 RN 原语 —— 于是"整行可拖"需要宿主拿到"行外面那个节点"。
   * 不给这个插槽，宿主只能把拖拽手柄塞进 `renderTrailing`（行的**兄弟**插槽），
   * 结果就是"行拖不动、只有一个小手柄能拖"（四象限那一次的历史，见
   * `quadrant/QuadrantBoard.tsx` 文件头第 2 条）。
   *
   * 🔴 共享层**不认识**这个节点里是什么：它只把 `node` 放进去。
   * 省略 ⇒ 逐字节与抽取前相同（移动端与四象限都不传）。
   */
  readonly renderRowWrapper?: (row: TaskRowModel, node: React.ReactNode) => React.ReactNode;
  /**
   * 移动端任务页的白卡列表。2026-11-19 起按**提醒事项**：分节时**每组一张卡、组头在卡外**（见 `useSectionCards`）。
   *
   * 🔴 2026-11-15：滴答的任务是"白卡 + 卡内行"，我们是"灰底平铺 + 8dp 空隙"。
   * 真机对比时最刺眼的差别不是行高（那个已压到 compact），而是**没有卡**：
   * 行直接落在页面底色上，看起来像一张表格而不是清单。
   *
   * 只在显式传 true 时生效 —— web 的列表已经住在自己的容器里，再加一层卡
   * 就是卡套卡（与"列表不自带水平内边距"同一个道理）。
   */
  readonly listCard?: boolean;
  /**
   * 行与行之间画一条**细横线**（对标滴答桌面列表的结构感）。
   *
   * 只在显式传 true 时生效 —— 移动端白卡（`listCard`）与四象限/日历都不传，
   * 逐字节不变。开启后列表 `gap` 归零，行间分隔交给这条线（否则线+缝会双重留白）。
   * 纯视觉，不改变任何排序/交互。
   */
  readonly rowDividers?: boolean;
  /**
   * 滚动位置回调（可选）。宿主用它驱动"顶栏随滚动收起"。
   *
   * 🔴 为什么要这一个口：任务列表的滚动宿主是 `FlatList` **自己**
   *（`TasksScreen` 在列表档传 `scroll={false}`，`Screen` 的 ScrollView 根本没参与），
   * 所以 `Screen` 那套"监听自己的滚动"在这里永远收不到事件 ——
   * 顶栏在任务列表上永远不会收起（真机反复验证过）。
   *
   * 只回吐 offset，不在这里判断方向/阈值：那是宿主的外壳策略。
   */
  readonly onScrollOffset?: (offsetY: number) => void;
}

/** 平铺形态：一批任务，**共享层负责排序**。 */
export interface FlatTaskListProps {
  readonly tasks: readonly Task[];
  readonly sections?: never;
  readonly renderSectionHeader?: never;
}

/** 分节形态：宿主已经分好组，共享层负责展平、跳空组、给稳定 key。 */
export interface SectionedTaskListProps<TMeta> {
  readonly tasks?: never;
  readonly sections: readonly TaskSection<TMeta>[];
  /**
   * 分节头节点。**必须提供** —— 共享层不解释 `section.meta`
   *（图标名各端不同，见 `model.ts` 的 `TaskSection`），所以它没法自己画一个头。
   */
  readonly renderSectionHeader: (section: TaskSection<TMeta>) => React.ReactNode;
}

/**
 * 两种形态**互斥**，所以用联合类型，而不是把 `tasks` / `sections` 都设成可选。
 *
 * 🔴 都设成可选的话，"两个都传"与"一个都没传"在**类型上都合法** ——
 * 而它们都是 bug，且只会在运行时表现成一张空列表（不报错）。
 * 这正是本仓库反复吃亏的那类失效：**能编译，但结果不对**。
 */
export type TaskListProps<TMeta = undefined> =
  | (TaskListSharedProps & FlatTaskListProps)
  | (TaskListSharedProps & SectionedTaskListProps<TMeta>);

export function TaskList<TMeta = undefined>({
  tasks,
  sort,
  sections,
  renderSectionHeader,
  keepEmptySections,
  onToggleTask,
  onOpenTask,
  onLongPressTask,
  swipeActions,
  labels,
  renderTitle,
  renderMeta,
  renderTrailing,
  renderSubline,
  busyTaskId,
  activeTaskId,
  selectedTaskIds,
  selectionMode = false,
  fallbackTitle,
  emptyMessage,
  listHeaderComponent,
  onInlineAdd,
  inlineAddLabel,
  emptyComponent,
  testID,
  density,
  renderRowWrapper,
  iconColorOf,
  listCard = false,
  rowDividers = false,
  onScrollOffset,
}: TaskListProps<TMeta>): React.JSX.Element {
  const tokens = useHeytaTokens();
  const text = useHeytaText();

  /** 展平后喂给 `FlatList` 的一行：要么是分节头，要么是任务。 */
  type Item =
    | SectionRow<TMeta>
    | { readonly kind: 'task'; readonly key: string; readonly row: TaskRowModel };

  // `fallbackTitle` 参与 items 的派生，但它是个 string（原始值），
  // 放进 deps 是安全的 —— 不要在这里传对象/数组，否则 useMemo 每轮都会重算。
  //
  // 两种形态在这里合流：`sections` 走 `flattenSections`（跳空组 + 展平），
  // 平铺形态走 `toTaskRows`（排序），再统一包成带 `kind` 的同一形状。
  // 这样下面的 `renderItem` 与 `keyExtractor` 各只有一份。
  const items = useMemo<readonly Item[]>(() => {
    if (sections !== undefined) {
      return flattenSections(sections, {
        fallbackTitle,
        keepEmpty: keepEmptySections === true,
        sort,
      });
    }
    return toTaskRows(tasks ?? [], { fallbackTitle, sort }).map((row) => ({
      kind: 'task' as const,
      key: row.id,
      row,
    }));
  }, [tasks, sort, sections, fallbackTitle, keepEmptySections]);

  /**
   * 🔴 「空列表不画白卡」的唯一判断（纯函数，见 `card-policy.ts`，有 node 单测）。
   *
   * 背景：`listCard` 会把整张列表画成一张白卡（移动端任务页）。列表为空时，
   * 空态会被这张白卡**整个包住** —— 一张孤零零的框里放一句"还没有安排"，
   * 既不像 iOS 空态，也和"卡承载列表"的原意相反：没有列表就不该有卡。
   * 所以空列表时落到页面本身，且让内容容器铺满高度、空态在剩余空间里垂直居中。
   *
   * 影响面**严格限定在 `listCard` 路径**（只有移动端任务页传它）：
   * `showCard` / `isEmptyCard` 为 false 时，下面的样式与渲染逐字节等于改动前。
   */
  const showCard = shouldShowListCard(listCard, items.length);
  const isEmptyCard = listCard && items.length === 0;

  /**
   * 🔴 提醒事项形态（R4）：`listCard` + **分节** 时，改为**每组一张卡、组头在卡外**。
   * 只走这一条路径；非分节 / 非卡片（web、四象限）逐字节不变。
   */
  const useSectionCards = showCard && sections !== undefined;
  const sectionBlocks = useMemo(() => {
    if (!useSectionCards || sections === undefined) {
      return [] as { readonly section: TaskSection<TMeta>; readonly rows: readonly TaskRowModel[] }[];
    }
    return sections
      .map((section) => ({
        section,
        rows: toTaskRows(section.tasks, {
          ...(fallbackTitle === undefined ? {} : { fallbackTitle }),
          ...(sort === undefined ? {} : { sort }),
        }),
      }))
      .filter((block) => keepEmptySections === true || block.rows.length > 0);
  }, [useSectionCards, sections, fallbackTitle, sort, keepEmptySections]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        /**
         * 🔴 列表**不自带水平内边距**。
         *
         * 第一版写了 `paddingHorizontal: screen.gutter`，在 web 切片上看没问题 ——
         * 但 mobile 的 `<Screen>` **已经**加了同样的 gutter，套上去就是**双倍缩进**，
         * 而症状只是"这一页比别的页窄一点"，不会报错。
         *
         * 页面边距属于**宿主**：它才知道自己有没有被别的容器包着。
         * 列表只管行与行之间的节奏。
         */
        list: {
          /**
           * 🔴 卡片模式下 `gap` 必须是 0：行间那 8dp 会让**页面底色从缝里漏出来**，
           * 一张白卡被切成七段（真机截图：每行之间一道灰色断口）。
           * 分隔的职责交给行自己的上下内边距，卡是一整块。
           */
          gap: showCard || rowDividers ? 0 : tokens[TASK_ROW_SHAPE.listGap],
          ...(showCard && !useSectionCards
            ? {
                backgroundColor: tokens['color.surface'],
                /*
                  2026-11-16：卡片补一条细线。屏幕底改白之后，白卡在白底上
                  没有边界（真机：整块卡与页面糊成一片，只剩组头一行字）。
                */
                borderWidth: tokens['border-width.thin'],
                borderColor: tokens['color.border'],
                borderRadius: tokens['radius.lg'],
                overflow: 'hidden' as const,
                paddingHorizontal: tokens['space.2'],
              }
            : {}),
          // 空列表且要求卡片时：不给空态画卡（`card-policy` 的结论），但仍让内容容器
          // 铺满高度，好让下面的空态在"日期副标题之外的剩余空间"里垂直居中。
          ...(isEmptyCard ? { flexGrow: 1 } : {}),
        },
        // 空态外层：吃掉 header 之外的剩余高度并居中（flex/flexGrow 是布局关键字，不是设计尺度）。
        emptyCenter: { flex: 1, justifyContent: 'center' },
        // 列表底部「＋ 新提醒事项」内联行：与卡片内行同一左缘（space.2），高度=触控下限。
        inlineAdd: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: tokens['space.2'],
          paddingVertical: tokens[TASK_ROW_SHAPE.touchTarget],
          paddingHorizontal: tokens['space.2'],
        },
        // 每组一张卡：用留白与轻微投影分层；卡内不再画横线，行距本身承担分隔。
        sectionBlock: { marginBottom: tokens['space.4'] },
        sectionCard: {
          backgroundColor: tokens['color.surface'],
          borderRadius: tokens['radius.lg'],
          paddingHorizontal: tokens['space.2'],
          ...(parseCssShadow(tokens['shadow.sm']) ?? {}),
        },
        /** `rowDividers` 的那条细横线：一条真实的尺寸声明（不是 0 高的装饰）。 */
        divider: {
          height: tokens['border-width.thin'],
          backgroundColor: tokens['color.border'],
        },
      }),
    [showCard, isEmptyCard, useSectionCards, rowDividers, tokens],
  );

  const buildTaskRow = useCallback(
    (row: TaskRowModel) => {
      const node = (
        <TaskRow
          row={row}
          {...(density === undefined ? {} : { density: density })}
          busy={busyTaskId === row.id}
          {...(activeTaskId === undefined ? {} : { active: activeTaskId === row.id })}
          {...(selectedTaskIds === undefined ? {} : { selected: selectedTaskIds.has(row.id) })}
          selectionMode={selectionMode}
          onToggleTask={onToggleTask}
          {...(onOpenTask === undefined ? {} : { onOpenTask })}
          {...(onLongPressTask === undefined ? {} : { onLongPressTask })}
          {...(swipeActions === undefined ? {} : { swipeActions })}
          {...(labels === undefined ? {} : { labels })}
          {...(renderTitle === undefined ? {} : { renderTitle })}
          {...(renderMeta === undefined ? {} : { renderMeta })}
          {...(renderTrailing === undefined ? {} : { renderTrailing })}
          {...(renderSubline === undefined ? {} : { renderSubline })}
          {...(iconColorOf === undefined ? {} : { iconColorToken: iconColorOf(row) })}
          {...(listCard ? { rowSurfaceColor: tokens['color.surface'] } : {})}
        />
      );
      // 省略插槽 ⇒ 原样返回那一枚行（移动端/四象限的行为逐字节不变）。
      return renderRowWrapper === undefined ? node : <>{renderRowWrapper(row, node)}</>;
    },
    [busyTaskId, activeTaskId, labels, onOpenTask, onLongPressTask, swipeActions, onToggleTask, renderTitle, renderMeta, renderTrailing, renderSubline, density, selectedTaskIds, selectionMode, renderRowWrapper, iconColorOf, listCard, tokens],
  );

  const renderItem = useCallback(
    ({ item }: { item: Item }) => {
      if (item.kind === 'header') {
        // 🔴 分节头由宿主给。共享层**不解释** `section.meta`。
        return <>{renderSectionHeader?.(item.section) ?? null}</>;
      }
      return buildTaskRow(item.row);
    },
    [buildTaskRow, renderSectionHeader],
  );

  const renderSectionItem = useCallback(
    ({
      item,
    }: {
      item: { readonly section: TaskSection<TMeta>; readonly rows: readonly TaskRowModel[] };
    }) => (
      <View style={styles.sectionBlock}>
        {renderSectionHeader?.(item.section) ?? null}
        <View style={styles.sectionCard}>
          {item.rows.map((row) => (
            <View key={row.id}>
              {buildTaskRow(row)}
            </View>
          ))}
        </View>
      </View>
    ),
    [buildTaskRow, renderSectionHeader, styles],
  );

  const keyExtractor = useCallback((item: Item) => item.key, []);

  const empty = useMemo(
    () =>
      /*
       * 🔴 2026-11-15：**手写的那行灰字换成共享 `EmptyState`。**
       *
       * 这里原来自己画 `<Text caption muted>`，是 `check:empty-state` 的
       * 已知未覆盖形状（文案经自定义 prop 传入 ⇒ 四个 marker 全不匹配，见 §二十）。
       * 也就是说它一直是笔**没登记上**的债，而不是被允许的写法。
       *
       * `emptyMessage` 这个简写保留（调用方多），但它内部改成走共享实现 ——
       * 从此空态的样式只在 `EmptyState` 一处定义。
       */
      emptyMessage === undefined ? null : <EmptyState size="line" title={emptyMessage} />,
    [emptyMessage],
  );

  /**
   * 空态内容（宿主 `emptyComponent` 优先，其次 `emptyMessage` 兜底）。
   *
   * 空列表且 `listCard` 时，把它包进一层「占满剩余高度并居中」的容器：
   * 这时 `contentContainerStyle` 已设 `flexGrow: 1`，包层 `flex: 1` 正好吃掉
   * header（日期副标题）之外的所有剩余高度，空态在其中垂直居中 ——
   * 与 Apple「空态居中落在页面上、不套卡片」一致。
   *
   * ⚠️ `emptyComponent` 的类型允许是**元素**或**组件类型**；只有元素能被这样包，
   * 组件类型（如某端传 `<Comp/>` 的类型）原样交回 `FlatList` 自己渲染。
   */
  const emptyContent = emptyComponent ?? empty;
  const emptyNode =
    emptyContent === null || emptyContent === undefined
      ? null
      : isEmptyCard
        ? (
            <View style={styles.emptyCenter}>
              {/* 元素直接渲染；组件类型（若某端传的是类型而非元素）先 createElement 再居中 —— 两者都要包进居中层。 */}
              {React.isValidElement(emptyContent)
                ? emptyContent
                : React.createElement(emptyContent as React.ComponentType)}
            </View>
          )
        : emptyContent;

  const inlineAddNode = useMemo(() => {
    if (onInlineAdd === undefined || inlineAddLabel === undefined || items.length === 0) {
      return null;
    }
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={inlineAddLabel}
        onPress={onInlineAdd}
        testID="task-list-inline-add"
        style={styles.inlineAdd}
      >
        <Text style={[text['row-title'], { color: tokens['color.primary'] }]}>＋</Text>
        <Text style={[text['row-title'], { color: tokens['color.primary'] }]}>{inlineAddLabel}</Text>
      </Pressable>
    );
  }, [onInlineAdd, inlineAddLabel, items.length, styles, text, tokens]);

  const flatListCommon = {
    ListHeaderComponent: listHeaderComponent,
    ListFooterComponent: inlineAddNode,
    ListEmptyComponent: emptyNode,
    // 行间细横线（仅 `rowDividers`）：与 `gap: 0` 配套，用一条线承担分隔。
    ItemSeparatorComponent: rowDividers
      ? () => <View style={styles.divider} />
      : undefined,
    contentContainerStyle: styles.list,
    ...(onScrollOffset === undefined
      ? {}
      : {
          onScroll: (e: { nativeEvent: { contentOffset: { y: number } } }) => {
            onScrollOffset(e.nativeEvent.contentOffset.y);
          },
          scrollEventThrottle: 16,
        }),
    testID,
  };

  if (useSectionCards) {
    return (
      <FlatList
        {...flatListCommon}
        data={sectionBlocks}
        renderItem={renderSectionItem}
        keyExtractor={(block) => block.section.key}
      />
    );
  }

  return (
    <FlatList
      {...flatListCommon}
      data={items}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
    />
  );
}
