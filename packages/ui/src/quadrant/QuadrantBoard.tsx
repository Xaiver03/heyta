/**
 * 四象限矩阵（共享视图）
 * ========================
 *
 * M3 第六刀的主角：**"2×2 矩阵 + 每格一列任务"这件事只有这一个实现。**
 * 象限的展示顺序、象限 → 语义色 token、每格的标题/说明/空格占位/无障碍名，
 * 以及**格里的行**全部由这里渲染；web 与 mobile 只决定"把它放在页面的哪里"、
 * 注入文案，以及挂哪些各端特有的交互（web 是拖放）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 本刀的核心契约：**卡里的行 = 列表里的行**（不是另写一份行）
 *
 * `docs/research/dida-view-unification.md` §4.2 把这条写成判据：
 * 「四象限卡里的行 = `<TaskRow density="compact" />`，日历格里的行 =
 * `<TaskRow density="minimal" />`。**不是三份 JSX。**」
 *
 * 落地方式：**每一格直接渲染共享的 `TaskList`**（`TaskList` 就是当前
 * "一行长什么样"的唯一实现 —— `check:row-single-source` 的断言 A 钉住
 * 「任务行 JSX 全仓只出现在 `packages/ui`」）。
 * 于是勾选框的尺寸/触控区补偿、标题的语义文字样式、元信息行、
 * 行级无障碍 role/state 全部**自动**与列表一致 —— 因为走的是同一条代码路径，
 * 而不是"照着列表又写了一遍"。
 *
 * 判据在 `apps/web/tests/quadrant-row-parity.spec.tsx`：用**同一组 props**、
 * **同一档位**（`compact`）分别渲染 `TaskList` 与 `QuadrantBoard`，断言两边的行
 * DOM **逐字节相同**；同时断言象限的行（`compact`）与**默认档**的行**必须不同**
 * —— 后者防的是"`density` 只是个装饰参数"。把卡里的行换成手写的一份、或把档位
 * 退回默认档，两条断言各自立刻红（已实测，见计划文档的进度行）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 没装进共享层的（逐条写清：证据 + 影响 + 最小一步）
 *
 * 1. ~~**`density`（`compact` / `minimal`）没有实现。**~~ → **已接上（2026-09-28 晚）。**
 *    原缺口：`TaskList` 把行的 JSX **内联在 `renderItem` 里**，不存在一个可传
 *    `density` 的 `<TaskRow>` 组件，所以象限格里的行与列表里的行几何完全相同。
 *    现在 `task-list/TaskRow.tsx`（`<TaskRow density>`）+ `task-list/density.ts`
 *    （`DENSITY_SPEC` 单点定义）已由另一 lane 落地，**本组件给每格显式传
 *    `density="compact"`** —— 象限卡用的是**紧凑档**（行高/内间距更小，
 *    元信息与尾部插槽仍然渲染）。日历格那一档（`minimal`）归日历视图，不在本文件。
 *    · 老缺口的影响（矩阵一屏四格、行高偏大）由此消除。
 *    · 判据：`quadrant-row-parity.spec.tsx` 的 A/A2 —— 同档位逐字节相同，
 *      不同档位必须不同（否则 `density` 只是装饰）。
 *    · 仍缺的：真机/真浏览器的观感验收（§6.2 规定一），这一步必须**截图看**。
 *
 * 2. **拖放（dnd-kit）没有进共享层，而且交互从"整行可拖"变成"行尾手柄可拖"。**
 *    `@dnd-kit/core` 是 **DOM 库**（`useDraggable` 要一个真实 DOM 节点），
 *    装进共享层就等于让 iOS/鸿蒙去解析 DOM —— 与"只用 RN 原语"直接冲突。
 *    所以拖放留在 web（`features/quadrant/`）。
 *    · 它的后果是**真的**：`TaskList` 的行是共享的，web 拿不到"整行"这个节点
 *      （`renderTrailing` 是行的**兄弟插槽**），所以**整行拖不动了**。
 *      替代物是行尾的一个握把（`renderTrailing` 注入，见 web 侧文件头），
 *      拖拽能力没有丢，但**肌肉记忆变了** —— 这一条必须让产品负责人知道。
 *    · 代价换来的东西是：象限卡里的行第一次有了勾选框与统一几何
 *      （迁移前 `DraggableTask` 只有一行标题文字，连完成都勾不了）。
 *    · 最小一步：给 `TaskList` 加一个 `renderRowWrapper?: (row, node) => ReactNode`
 *      插槽（在 `task-list/**`，同样不在本刀白名单），web 把手柄换成整行包装。
 *
 * 3. **行尾/元信息的内容插槽由宿主给。** 共享层只转发 `renderMeta` /
 *    `renderTrailing`，不替宿主决定"横线上要不要显示截止徽章" ——
 *    那两段内容 web 在 `App.tsx` 里，而 `App.tsx` 不在本刀白名单。
 *    所以 web 的四象限行目前**只显示勾选框 + 标题**（与迁移前一致），
 *    列表里有的截止/优先级徽章在象限格里看不到。这是**已知缺口**，
 *    最小一步：把 `App.tsx` 的 `renderTaskMeta` 提到
 *    `features/tasks/row-slots.tsx`，两处共用（要改 `App.tsx` 一行）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 文案一律由宿主注入，本文件不 import `@heyta/i18n`
 *
 * 与 `TaskList.tsx` / `CategoryReport.tsx` 同一个理由：i18n 包自己带过一份
 * React，四端会同时中招（`check:mobile-bundle` 盯着这件事）。
 * 所以 `labels` 里依赖象限的那几项是函数，模板留在有 i18n 的那一侧。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 只用 RN 原语，不 import 任何 DOM 标签
 *
 * `View` / `Text` 在 `react-native-web` 上都有等价实现；`<div>` 在 iOS 上不存在。
 * 拖放要的 DOM 节点由宿主经 {@link QuadrantBoardProps.renderCellOverlay}
 * 注入 —— 共享层只留一个**绝对定位的宿主插槽**，自己不认识 DOM。
 */

import React, { useMemo } from 'react';
import { StyleSheet, Text, View, type TextStyle } from 'react-native';
import type { HeytaNativeTokens } from '@heyta/design-system';
import type { Quadrant, Task } from '@heyta/domain';
import { TaskList, type TaskListLabels } from '../task-list/TaskList.js';
import type { TaskRow } from '../task-list/model.js';
import { useHeytaText, useHeytaTokens } from '../theme.js';
import { toQuadrantCards, type QuadrantCardModel } from './model.js';

/**
 * 面板全部文案，**每一项都由宿主注入**（见文件头）。
 *
 * 函数而不是字符串的那几项：文案依赖象限（标题 / 说明 / 空态 / 无障碍名），
 * 模板必须留在有 i18n 的那一侧。
 */
export interface QuadrantBoardLabels {
  /** 象限的**大标题**（「马上做」「计划做」…）。 */
  readonly title: (quadrant: Quadrant) => string;
  /** 象限的**一句说明**（「重要且紧急」…）。 */
  readonly hint: (quadrant: Quadrant) => string;
  /**
   * 整格给屏幕阅读器的那一句（含标题、说明，可含计数）。
   * **每一项都是一整句**，不要用前缀拼标题。
   */
  readonly cellA11y: (info: {
    readonly quadrant: Quadrant;
    readonly title: string;
    readonly hint: string;
    readonly count: number;
  }) => string;
  /** 格子里没有任务时显示什么（矩阵的空格是有信息的，不能什么都不画）。 */
  readonly empty: (quadrant: Quadrant) => string;
  /** 矩阵底部那一句说明（拖放会改截止时间这件事必须说出来）。省略就不渲染。 */
  readonly footnote?: string;
}

export interface QuadrantBoardProps {
  /** 全部任务。**已完成与已删除的由领域层排除**，共享层不再判一次。 */
  readonly tasks: readonly Task[];
  /** 当前时间（epoch ms）。显式传入，否则紧迫性判定不可测、也不可复现。 */
  readonly now: number;
  readonly labels: QuadrantBoardLabels;
  /** 勾选/取消勾选。**不要在组件内部改数据** —— 变更必须走宿主的 action 层。 */
  readonly onToggleTask: (taskId: string) => void;
  /** 点整行的行为。**给了就打开详情；不给时整行不可点**（理由见 `TaskList`）。 */
  readonly onOpenTask?: (taskId: string) => void;
  /** 行级无障碍文案，原样转给 `TaskList`。 */
  readonly taskLabels?: TaskListLabels;
  /** 标题下方的元信息行，原样转给 `TaskList`（内容归宿主，见文件头第 3 条）。 */
  readonly renderMeta?: (row: TaskRow) => React.ReactNode;
  /** 行尾的动作，原样转给 `TaskList`（web 拿它注入拖拽握把）。 */
  readonly renderTrailing?: (row: TaskRow) => React.ReactNode;
  /** 正在处理中的行 id —— 用于置灰该行，避免连点发出两条变更。 */
  readonly busyTaskId?: string | null;
  /** 标题为空时的替代文案（空标题是真实存在的）。 */
  readonly fallbackTitle?: string;
  /**
   * 哪一格正处于拖拽悬停 —— 只影响**边框**（用 `color.primary`）。
   *
   * 拖拽状态由宿主算（共享层不认识 dnd-kit）；`null` / 省略 = 没有悬停。
   * ⚠️ 它**不是**无障碍信息：读屏拿到的是每格的 `cellA11y`。
   */
  readonly highlightedQuadrant?: Quadrant | null;
  /**
   * 每格内的**宿主覆盖层插槽**（绝对定位、铺满该格）。
   *
   * web 用它挂 dnd-kit 的 droppable 节点（只需要一个有尺寸的 DOM 节点，
   * dnd-kit 按 `getBoundingClientRect` 命中，**不需要**这个节点可点）。
   * 不传就完全不产出这一层 —— mobile 没有鼠标，也就不需要。
   */
  readonly renderCellOverlay?: (card: QuadrantCardModel) => React.ReactNode;
  readonly testID?: string;
}

/** 取一份 token 表，建出这套样式。**一个裸值都没有**（`check:design` 会拦）。 */
function makeStyles(tokens: HeytaNativeTokens) {
  /**
   * 🔴 token 里的字重是**数字**（`600`），而 RN 的 `fontWeight` 只接受
   * 字符串联合 —— 直接写 `tokens['font-weight.semibold']` 编译不过。
   * 与 `ai/AiDisclosure.tsx` 同一处取舍：转成字符串再窄化，不新造字重。
   */
  const strongWeight = String(tokens['font-weight.semibold']) as TextStyle['fontWeight'];
  return StyleSheet.create({
    board: {
      // 2×2。用 `flexWrap` + 两列的比例，而不是 CSS grid ——
      // grid 是 web 专有概念，RN 上没有。
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: tokens['space.3'],
      padding: tokens['space.4'],
    },
    cell: {
      // 🔴 `minWidth: '50%'` + `flexGrow`：两列等宽，格子内容不会被挤没。
      minWidth: '50%',
      flexGrow: 1,
      flexBasis: 0,
      flexDirection: 'column',
      minHeight: tokens['layout.quadrant-min-height'],
      padding: tokens['space.3'],
      borderRadius: tokens['radius.lg'],
      backgroundColor: tokens['color.surface'],
      // 用**边框**表达层次与拖拽悬停，不用位移或阴影 ——
      // 阴影只给真正的浮层（这里是平面内容）。
      borderWidth: tokens['border-width.thick'],
      borderColor: tokens['color.border'],
    },
    /** 拖拽悬停：只换边框色，不动几何（动几何会让整格抖一下）。 */
    cellHighlighted: {
      borderColor: tokens['color.primary'],
    },
    header: {
      marginBottom: tokens['space.2'],
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: tokens['space.2'],
    },
    /**
     * 色块：象限色只在这里出现，用**语义 token**（`color.quadrant-N`）
     * 而不是原始色阶 —— 原始色阶留给设计系统内部（设计系统硬规则 2）。
     * 颜色**不是**唯一的信息载体：标题与说明都在旁边（硬规则：不许只用颜色）。
     */
    swatch: {
      width: tokens['icon.sm'],
      height: tokens['icon.sm'],
      borderRadius: tokens['radius.full'],
    },
    cellTitle: {
      color: tokens['color.foreground'],
      fontWeight: strongWeight,
    },
    cellHint: {
      marginTop: tokens['space.1'],
      color: tokens['color.foreground-muted'],
    },
    /** 格里的列表。`flex: 1` 让行填满空格，空态才不会浮在中间。 */
    list: {
      flex: 1,
    },
    /**
     * 宿主覆盖层的容器。
     *
     * 🔴 `pointerEvents: 'none'` 是**必须的**：覆盖层铺满整格，
     * 否则它会把勾选框、行、拖拽握把的点击全吃掉（症状是"什么都点不动"，
     * 而不报任何错）。dnd-kit 命中靠 **rect**，不靠事件冒泡，所以这里
     * 关掉指针事件不影响拖放。
     */
    overlayHost: {
      ...StyleSheet.absoluteFillObject,
      pointerEvents: 'none',
    },
    footnote: {
      color: tokens['color.foreground-muted'],
      width: '100%',
    },
  });
}

export function QuadrantBoard({
  tasks,
  now,
  labels,
  onToggleTask,
  onOpenTask,
  taskLabels,
  renderMeta,
  renderTrailing,
  busyTaskId,
  fallbackTitle,
  highlightedQuadrant,
  renderCellOverlay,
  testID,
}: QuadrantBoardProps): React.JSX.Element {
  const tokens = useHeytaTokens();
  const text = useHeytaText();

  // 分桶与排序全在 `@heyta/domain`（`bucketByQuadrant`）与 `./model.ts`，
  // 这里只把结果摆出来 —— 组件里因此没有分支。
  const cards = useMemo(() => toQuadrantCards(tasks, now), [tasks, now]);
  const styles = useMemo(() => makeStyles(tokens), [tokens]);

  const footnote = labels.footnote;

  return (
    <View style={styles.board} testID={testID}>
      {cards.map((card) => {
        const title = labels.title(card.quadrant);
        const hint = labels.hint(card.quadrant);
        const highlighted = highlightedQuadrant === card.quadrant;
        return (
          <View
            key={card.quadrant}
            style={[styles.cell, highlighted ? styles.cellHighlighted : null]}
            testID={card.testID}
            accessibilityRole="summary"
            accessibilityLabel={labels.cellA11y({
              quadrant: card.quadrant,
              title,
              hint,
              count: card.count,
            })}
          >
            <View style={styles.header}>
              <View style={styles.headerRow}>
                <View style={[styles.swatch, { backgroundColor: tokens[card.token] }]} />
                <Text style={[text['row-meta'], styles.cellTitle]}>{title}</Text>
              </View>
              <Text style={[text.caption, styles.cellHint]}>{hint}</Text>
            </View>

            {/*
              🔴 卡里的行**就是** `TaskList` 渲染的行 —— 见文件头的核心契约。
              这里刻意不写 `<View><Text>{task.title}</Text></View>` 那种"更短的行"：
              短一行代码换来的是"象限里的行与列表里的行各长一样"，
              而那件事**没有测试会红**。
            */}
            <View style={styles.list}>
              <TaskList
                tasks={card.tasks}
                onToggleTask={onToggleTask}
                onOpenTask={onOpenTask}
                labels={taskLabels}
                renderMeta={renderMeta}
                renderTrailing={renderTrailing}
                busyTaskId={busyTaskId}
                fallbackTitle={fallbackTitle}
                /**
                 * 🔴 象限卡用**紧凑档**（`docs/research/dida-view-unification.md` §4.2：
                 * 四象限卡里的行 = `<TaskRow density="compact" />`）。
                 *
                 * 这一行是"容器决定密度"的落点，也是本组件与日历视图的唯一区别 ——
                 * 行本身**没有**第二份实现（`TaskList` → `TaskRow` 是唯一路径）。
                 * 差异全在 `task-list/density.ts` 的 `DENSITY_SPEC`，本文件不认识细节。
                 *
                 * 判据：`apps/web/tests/quadrant-row-parity.spec.tsx` 的 A/A2 ——
                 * 同档位（compact）与列表逐字节相同、与默认档必须不同；
                 * 把本行删掉（退回默认档）会让 A 与 A2 同时红。
                 */
                density="compact"
                emptyMessage={labels.empty(card.quadrant)}
              />
            </View>

            {renderCellOverlay === undefined ? null : (
              <View style={styles.overlayHost}>{renderCellOverlay(card)}</View>
            )}
          </View>
        );
      })}

      {footnote === undefined ? null : (
        <Text style={[text.caption, styles.footnote]}>{footnote}</Text>
      )}
    </View>
  );
}
