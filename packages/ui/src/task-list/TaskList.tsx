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
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { TASK_ROW_SHAPE } from '@heyta/design-system';
import type { Task, TaskSortKey } from '@heyta/domain';
import { useHeytaText, useHeytaTokens } from '../theme.js';
import type { TaskRowDensity } from './density.js';
import { TaskRow, type TaskRowLabels } from './TaskRow.js';
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
  /** 长按行的入口，供移动端进入批量选择态。 */
  readonly onLongPressTask?: (taskId: string) => void;
  readonly labels?: TaskListLabels;
  /** 标题下方的元信息行（截止 / 优先级 / 重复…）。 */
  readonly renderMeta?: (row: TaskRowModel) => React.ReactNode;
  /** 行尾的动作（比如删除按钮）。 */
  readonly renderTrailing?: (row: TaskRowModel) => React.ReactNode;
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
  labels,
  renderMeta,
  renderTrailing,
  busyTaskId,
  activeTaskId,
  selectedTaskIds,
  selectionMode = false,
  fallbackTitle,
  emptyMessage,
  testID,
  density,
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
        list: { gap: tokens[TASK_ROW_SHAPE.listGap] },
        empty: { paddingVertical: tokens['space.8'], alignItems: 'center' },
      }),
    [tokens],
  );

  const renderItem = useCallback(
    ({ item }: { item: Item }) => {
      if (item.kind === 'header') {
        // 🔴 分节头由宿主给。共享层**不解释** `section.meta` ——
        // 图标名各端不同（mobile 是 `lucide-react-native` 的名字集合），
        // 定死就等于让共享层去认识某个平台专属的包。
        return <>{renderSectionHeader?.(item.section) ?? null}</>;
      }

      /**
       * 🔴 行本身**只在这一处渲染**（`TaskRow.tsx`）。
       *
       * 抽取前那段行的 JSX 就长在这个分支里；现在它的几何与结构与
       * 默认档（`comfortable`）字面相同，只是搬了家。本文件**不再认识**
       * 勾选框尺寸 / 行高 / 间距 —— 那些属于行，不属于列表。
       */
      const row = item.row;
      return (
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
          {...(labels === undefined ? {} : { labels })}
          {...(renderMeta === undefined ? {} : { renderMeta })}
          {...(renderTrailing === undefined ? {} : { renderTrailing })}
        />
      );
    },
    [busyTaskId, activeTaskId, labels, onOpenTask, onLongPressTask, onToggleTask, renderMeta, renderSectionHeader, renderTrailing, density, selectedTaskIds, selectionMode],
  );

  const keyExtractor = useCallback((item: Item) => item.key, []);

  const empty = useMemo(
    () =>
      emptyMessage === undefined ? null : (
        <View style={styles.empty}>
          <Text style={[text.caption, { color: tokens['color.foreground-muted'] }]}>
            {emptyMessage}
          </Text>
        </View>
      ),
    [emptyMessage, styles.empty, text.caption, tokens],
  );

  return (
    <FlatList
      data={items}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      ListEmptyComponent={empty}
      contentContainerStyle={styles.list}
      testID={testID}
    />
  );
}
