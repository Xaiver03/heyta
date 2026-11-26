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
  /**
   * 🔴 2×2 时画在十字边界上的两条轴标签。省略就不画轴（退化成无轴网格）。
   * `vertical` 画在左边界（纵轴），`horizontal` 画在上边界（横轴）。
   */
  readonly axis?: { readonly vertical?: string; readonly horizontal?: string };
}

export interface QuadrantBoardProps {
  /** 全部任务。**已完成与已删除的由领域层排除**，共享层不再判一次。 */
  /**
   * 板子的最小高度（px）。宿主量出来传进来。
   *
   * 🔴 移动端的四象限住在滚动内容列里，`flexGrow` 拿不到剩余空间 ⇒ 矩阵只有
   * 内容那么高、下方空一截（真机约 110dp）。宿主 `onLayout` 量一次可用高度，
   * 由这里落地成 `minHeight` —— 只长不缩，内容多时仍然由父层滚动。
   */
  readonly minHeight?: number;
  /** 全部任务。**已完成与已删除的由领域层排除**，共享层不再判一次。 */
  readonly tasks: readonly Task[];
  /** 当前时间（epoch ms）。显式传入，否则紧迫性判定不可测、也不可复现。 */
  readonly now: number;
  readonly labels: QuadrantBoardLabels;
  /** 勾选/取消勾选。**不要在组件内部改数据** —— 变更必须走宿主的 action 层。 */
  readonly onToggleTask: (taskId: string) => void;
  /** 点整行的行为。**给了就打开详情；不给时整行不可点**（理由见 `TaskList`）。 */
  readonly onOpenTask?: (taskId: string) => void;
  /** 移动端长按快捷入口；长按只是批量选择的快捷方式，不能成为唯一入口。 */
  readonly onLongPressTask?: (taskId: string) => void;
  /** 批量选择态沿用任务列表的同一套行语义。 */
  readonly selectedTaskIds?: ReadonlySet<string>;
  readonly selectionMode?: boolean;
  /**
   * 选中的那一行 —— 原样转给 `TaskList` 的 `activeTaskId`，四格共用一个值。
   *
   * 🔴 「列表」与「四象限」是同一批任务的两种投影，用户在哪儿选中都得在另一处
   * 看得见"还是它"。省略 = 不画高亮（默认值等于加这个 prop 之前的行为）。
   */
  readonly activeTaskId?: string | null;
  /** 行级无障碍文案，原样转给 `TaskList`。 */
  readonly taskLabels?: TaskListLabels;
  /** 标题下方的元信息行，原样转给 `TaskList`（内容归宿主，见文件头第 3 条）。 */
  readonly renderMeta?: (row: TaskRow) => React.ReactNode;
  /** 行尾的动作，原样转给 `TaskList`。 */
  readonly renderTrailing?: (row: TaskRow) => React.ReactNode;
  /**
   * 行外面那一层（宿主注入）—— 原样转给 `TaskList.renderRowWrapper`。
   *
   * 🔴 web 用它把**整行**变成 dnd-kit 的拖拽/排序节点（不要行尾手柄、不要"移动"
   * 下拉）。共享层只转交，不认识缩放手势。
   */
  readonly renderRowWrapper?: (row: TaskRow, node: React.ReactNode) => React.ReactNode;
  /**
   * 每格**任务区**外面那一层（宿主注入）。
   *
   * web 用它给每一格包一个 `SortableContext`（同格内上下拖拽排序要在它里面）；
   * 不传 ⇒ 逐字节与抽取前相同（移动端不传）。
   */
  readonly renderCellBodyWrapper?: (card: QuadrantCardModel, node: React.ReactNode) => React.ReactNode;
  /** 正在处理中的行 id —— 用于置灰该行，避免连点发出两条变更。 */
  readonly busyTaskId?: string | null;
  /** 标题为空时的替代文案（空标题是真实存在的）。 */
  readonly fallbackTitle?: string;
  /**
   * 每格内的**宿主覆盖层插槽**（绝对定位、铺满该格）。
   *
   * web 用它挂 dnd-kit 的 droppable 节点（只需要一个有尺寸的 DOM 节点，
   * dnd-kit 按 `getBoundingClientRect` 命中，**不需要**这个节点可点）。
   * 不传就完全不产出这一层 —— mobile 没有鼠标，也就不需要。
   */
  readonly renderCellOverlay?: (card: QuadrantCardModel) => React.ReactNode;
  /**
   * 标题行**行尾**的宿主插槽（W5：web 用它挂任务计数徽标）。
   *
   * 与 `renderMeta` / `renderTrailing` / `renderCellOverlay` 同一条纪律：
   * 内容（徽标长什么样、无障碍名怎么拼）归宿主，共享层只给**位置** ——
   * 标题行是本组件渲染的，宿主没有别的入口把东西放进那一行。
   * 不传就完全不产出 —— mobile 不传，DOM 逐字节不变。
   */
  readonly renderHeaderTrailing?: (card: QuadrantCardModel) => React.ReactNode;
  /**
   * 🔴 **摆两列还是单列 —— 由宿主决定，共享层不猜。**
   *
   * 桌面壳/web 传"窗口 ≥ 断点"（断点读 token `layout.two-column-min`）；
   * 移动端不传 → 单列（411dp 上两列的每格放不下一个可读的任务行）。
   *
   * ⚠️ 为什么不用 `useWindowDimensions`：RNW 0.21 的 `Dimensions` 取的是
   * **`window.screen.width`**（物理屏，实测 1728）而不是视口宽 ——
   * 桌面上它**永远** ≥ 断点，"响应式"就成了摆设（2026-09-29 实测踩过：
   * 660px 视口下仍然渲染两列）。视口是 web/壳才有的概念，所以判定归宿主。
   */
  readonly twoColumns?: boolean;
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
    /**
     * 🔴 **2×2 是确定的，不是"wrap 碰运气"。**
     *
     * 旧实现（`flexWrap` + `minWidth: '50%'` + `gap`）在 web 上**必然塌成 4 张
     * 通栏卡**：50% + 50% + gap > 100%，每一格都被挤到下一行（2026-09-29
     * 产品负责人截图指出，[`docs/plans/goal-layout-audit.md`](docs/plans/goal-layout-audit.md) 页 1）。
     * 现在按行摆：两行、每行恰好两格、每格 `flex: 1` —— 结构上不可能换行。
     *
     * 响应式：容器宽低于 `layout.two-column-min`（平板竖屏 768px）时降为
     * **单列** —— 手机（RN）一直就是单列，桌面窄窗也一样优雅降级。
     * "窗口变化不得破坏排版"是本轮 goal 的硬判据。
     *
     * 十字坐标系的观感由**间隙**给出：四格之间露出底色，横竖两条"轴线"
     * 就是那两条缝（与滴答的四象限同构）。
     */
    /**
     * 🔴 板子**自己声明增长**，但**不许被压**（`flexGrow:1 + flexShrink:0 + flexBasis:'auto'`）。
     *
     * 修前这里只有 `gap`/`padding` ⇒ 高度由内容决定 ⇒ 里面 `cell` 那行 `flex: 1`
     * **一个字都没生效**（弹性盒 §9.7：`flex-grow` 分配的是**剩余**自由空间，
     * 父高 `auto` 时没有剩余就没有分配 —— 类 C）。实测链条见计划 §3.1。
     *
     * 为什么是 `flexShrink: 0` 而不是 `flex: 1`（= `1 1 0%`）：
     * "铺满"的含义是**至少长到母层给的空间**，不是"被母层裁到那么高"。
     * 任务多的时候内容比视口高，收缩会让四格互相叠到 `minHeight` 以下 ——
     * 那是另一种"看不见"。不收缩 ⇒ 母层（宿主的内容列）自己变高、文档滚动，
     * 只有一个滚动所有者。⚠️ 母层必须**把确定高度传下来**，这一层才拿得到空间：
     * web 是 `.ht-content`（`app.css`，`display:flex` 列），RN 是 `Screen` 的
     * `contentContainerStyle`（`apps/mobile/src/ui/kit.tsx`）—— 两边各自缺过，
     * 只改共享层在两端都还是空转。
     */
    board: {
      /**
       * 🔴 2026-11-16（对照滴答实测后重做）：**四张独立卡片 + 间隙**，不是"十字 + 轴标签"。
       *
       * 滴答的四象限（真机 `com.ticktick.task` 8.0.9.1）：
       *   · 四张等宽等高的圆角白卡，卡与卡之间 16dp 间隙
       *   · **没有**"紧急 / 重要"这两条轴标签，也**没有**十字分割线
       *   · 每格标题一行（罗马数字 + 彩色象限名），没有副标题
       *
       * 产品负责人这一轮的原话：「四象限上莫名其妙有"紧急"两个字和一条横线，
       * 我觉得很脏」「格子分布上下不对称」。两件事都是旧形状的直接后果：
       * 轴标签要留位（`paddingLeft/Top` 又被后面的 `padding: 0` 覆盖）、
       * 十字靠四格描边拼成，于是上下留白不一致、还多出两条线。
       *
       * 页边距放在这里（`Screen` 的 board 档不给 gutter）。
       */
      padding: tokens['space.4'],
      flexGrow: 1,
      /* 只长不缩：内容多时不许把四格压到 `minHeight` 以下。 */
      flexShrink: 0,
      /*
       * 🔴 2026-11-15：`flexBasis: 'auto'` → `0`。
       *
       * `auto` 让高度先由内容决定，`flexGrow` 只在**还有剩余空间**时才分配；
       * 而 ScrollView 的内容列一旦被内容撑到视口高，就不再有"剩余"可分 ——
       * 真机结果：四象限铺满左右，但矩阵下方空出一整块（约 110dp）。
       * 改 0 之后矩阵从"内容高"起算、由 `flexGrow` 吃掉父层剩余高度；
       * `flexShrink: 0` 仍然保证它不会被压扁。
       */
      flexBasis: 0,
    },
    /** 两行等分板子的剩余高度；同样"只长不缩"（理由见 `board`）。 */
    /** 四格拼成的那个矩形：圆角与裁切都在这一层（轴标签在它外面，不受影响）。 */
    matrix: {
      /**
       * 🔴 2026-11-24「不要框，只要横平竖直的坐标轴」：四格**紧贴不留缝**，
       * 由 {@link cell} 上的 `dividerRight` / `dividerBottom` 画出中间那个十字。
       * 留缝就画不出连成一气的十字（缝 = 两条断开的白带）。
       */
      gap: 0,
      flexGrow: 1,
    },
    row: {
      flexDirection: 'row',
      /** 格间不再留缝；竖线由左列格的 `borderRight` 画。 */
      gap: 0,
      flexGrow: 1,
      flexShrink: 0,
      flexBasis: 'auto',
    },
    /**
     * 单列分支的容器。🔴 它**不能复用 `row`**：`rows = [cards]` 时四个格子
     * 会全部进同一个 `flexDirection: 'row'` 的行里，被压成一行四个 140px 的
     * 小方块（2026-09-29 实测踩过 —— "单列"渲染成了"最挤的四列"）。
     *
     * ⚠️ 单列下"铺满"这条契约**换了一个分支**：四格各有 `minHeight`，
     * 加起来通常已经超过一屏 ⇒ 没有剩余空间可分，`flexGrow` 在这里**什么都不做**，
     * 面板按内容高度排布、由宿主滚动。这不是例外，是同一条"只长不缩"的结果。
     */
    stack: {
      gap: 0,
      flexGrow: 1,
      flexShrink: 0,
      flexBasis: 'auto',
    },
    cell: {
      flex: 1,
      flexDirection: 'column',
      minHeight: tokens['layout.quadrant-min-height'],
      padding: tokens['space.3'],
      /**
       * 🔴 2026-11-24：**不再有卡片**（无描边 / 无圆角 / 无底色），四格直接
       * 落在页面底上；结构只由中间那个十字给出（见 {@link dividerRight} /
       * {@link dividerBottom}）。产品负责人这一轮的原话：「不需要有框，只需要
       * 一个横平竖直的坐标轴，就相当于在中间画个十字」。
       */
    },
    /** 左列格的右缘 —— 十字的**竖线**。只有左列画（右列再画就是双线）。 */
    dividerRight: {
      borderRightWidth: tokens['border-width.thin'],
      borderRightColor: tokens['color.border'],
    },
    /** 上排格的下缘（单列时是每格之间）—— 十字的**横线**。 */
    dividerBottom: {
      borderBottomWidth: tokens['border-width.thin'],
      borderBottomColor: tokens['color.border'],
    },
    /**
     * 🔴 **空格铺满是正确形态**（2026-10-06 产品负责人看过 W5 实装后拍板，
     * 附滴答桌面截图为证：2×2 等分占满视口、空象限居中一句"没有任务"）。
     *
     * 历史注记（防再摆回）：W5 曾按审计 §4-5 给两列形态的空格上过
     * `alignSelf:'flex-start'`（退回内容高度）—— 实装当天即被推翻：
     * 四象限的心智模型就是"一屏四格"的**固定框架**，空格塌缩反而让
     * 看板读起来像没加载完。W5 保留的是另外三样：占位去重（同屏 ≤1 处
     * 引导文案）、计数徽标、规则说明收进「帮助」——那三样与铺满不冲突。
     *
     * ⚠️ 行/格的拉伸由 `styles.row`（`flexGrow`）与 `styles.cell`（默认
     * `stretch`）自然完成，这里**不需要**任何按 count 的分支 ——
     * 任何"空格特殊布局"的提案先过产品负责人。
     */
    header: {
      marginBottom: tokens['space.2'],
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: tokens['space.2'],
    },
    /** 标题行的行尾插槽容器：`marginLeft: 'auto'` 把它推到行的另一头。 */
    headerTrailing: {
      marginLeft: 'auto',
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
  minHeight,
  tasks,
  now,
  labels,
  onToggleTask,
  onOpenTask,
  onLongPressTask,
  selectedTaskIds,
  selectionMode = false,
  activeTaskId,
  taskLabels,
  renderMeta,
  renderTrailing,
  renderRowWrapper,
  renderCellBodyWrapper,
  busyTaskId,
  fallbackTitle,
  renderCellOverlay,
  renderHeaderTrailing,
  twoColumns = false,
  testID,
}: QuadrantBoardProps): React.JSX.Element {
  const tokens = useHeytaTokens();
  const text = useHeytaText();

  // 分桶与排序全在 `@heyta/domain`（`bucketByQuadrant`）与 `./model.ts`，
  // 这里只把结果摆出来 —— 组件里因此没有分支。
  const cards = useMemo(() => toQuadrantCards(tasks, now), [tasks, now]);
  const styles = useMemo(() => makeStyles(tokens), [tokens]);

  /**
   * 🔴 2026-11-25：**灰色选中态在"那一条任务"上，不在"整格"上**。
   * （产品负责人：「不是整个象限变灰，是选中的那条任务变灰」。）
   * 整格不再有任何悬停底色；行级悬停与拖拽插入线都由 web 宿主在
   * `renderRowWrapper` 里画（共享层不认识 DOM 指针）。
   */

  /**
   * 🔴 响应式判定**来自宿主**（`twoColumns` prop，理由见 props 注释）。
   * 单列是默认值 —— 移动端（411dp）不传就是正确的。
   */
  const rows = twoColumns ? [cards.slice(0, 2), cards.slice(2, 4)] : [cards];

  /*
   * 🔴 2026-11-15：**坐标系要有轴。**
   *
   * 拼成十字之后，四块能看出"被切开了"，但**看不出是被哪两条轴切的** ——
   * 读者只能从每格的副标题「重要且紧急」倒推。轴标签把这件事写在边界上：
   * 横轴是「紧急」（左→右 = 紧急→不紧急），纵轴是「重要」（上→下 = 重要→不重要）。
   *
   * 只在 2×2 时画：单列下没有"轴"可言（四格是四段，不是四块）。
   */
  /*
   * 🔴 2026-11-16：`labels.axis`（「紧急」「重要」）**不再画**。
   * 滴答的四象限没有任何轴标签 —— 四张卡的标题已经写着「重要且紧急」，
   * 再加两条轴是把同一件事说两遍，还多出两条线。字段保留在契约里（宿主仍传），
   * 但不消费，免得两端各写一份"要不要画轴"的判断。
   */

  const footnote = labels.footnote;

  return (
    <View
      style={[styles.board, minHeight === undefined ? undefined : { minHeight }]}
      testID={testID}
    >
      <View style={styles.matrix}>
      {rows.map((row, rowIndex) => (
        <View key={`row-${rowIndex}`} style={twoColumns ? styles.row : styles.stack}>
          {row.map((card, cellIndex) => {
            const title = labels.title(card.quadrant);
            const hint = labels.hint(card.quadrant);
            /**
             * 🔴 十字：2×2 时左列画竖线（右缘）、上排画横线（下缘）；
             * 单列时每格之间画一条横线（最后一格不画）。除此之外没有任何边框。
             */
            const showVertical = twoColumns && cellIndex === 0;
            const showHorizontal = twoColumns ? rowIndex === 0 : cellIndex < row.length - 1;
            const taskList = (
              <TaskList
                tasks={card.tasks}
                onToggleTask={onToggleTask}
                onOpenTask={onOpenTask}
                onLongPressTask={onLongPressTask}
                selectedTaskIds={selectedTaskIds}
                selectionMode={selectionMode}
                activeTaskId={activeTaskId}
                labels={taskLabels}
                renderMeta={renderMeta}
                renderTrailing={renderTrailing}
                renderRowWrapper={renderRowWrapper}
                busyTaskId={busyTaskId}
                fallbackTitle={fallbackTitle}
                density="compact"
                /* 空格只写事实（`labels.empty` 现在恒为「没有任务」），不写操作引导。 */
                emptyMessage={labels.empty(card.quadrant) || undefined}
              />
            );
            return (
              <View
                key={card.quadrant}
                style={[
                  styles.cell,
                  showVertical ? styles.dividerRight : null,
                  showHorizontal ? styles.dividerBottom : null,
                ]}
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
                    {/*
                      🔴 2026-11-25：**去掉标题前那个色点图标**，改成给标题**文字**上象限色
                      （与滴答一致：象限名本身就是彩色的，不需要再放一个色块"图标"）。
                      产品负责人：「还在上面放些图标……」。颜色仍是唯一的语义载体，只是不再叠一个点。
                    */}
                    <Text style={[text['row-meta'], styles.cellTitle, { color: tokens[card.token] }]}>{title}</Text>
                    {renderHeaderTrailing === undefined ? null : (
                      <View style={styles.headerTrailing}>{renderHeaderTrailing(card)}</View>
                    )}
                  </View>
                  {/*
                    🔴 副标题 = 象限的语义说明（「重要且紧急 / 重要不紧急 / …」）。
                    大标题是动作词（「马上做 / 计划做 / …」），说明是重要/紧急的刻画 ——
                    两条缺一，四象限就退化成"分配类型"或"四个空动作词"。
                    说明在无障碍句里本来就有（`cellA11y`），视觉上也必须有。
                  */}
                  {hint === '' ? null : (
                    <Text style={[text['caption'], styles.cellHint]}>{hint}</Text>
                  )}
                </View>

                {/*
                  🔴 卡里的行**就是** `TaskList` 渲染的行 —— 见文件头的核心契约。
                  任务区外面那一层留给宿主（web 在这里包 `SortableContext`）。
                */}
                <View style={styles.list}>
                  {renderCellBodyWrapper === undefined ? taskList : renderCellBodyWrapper(card, taskList)}
                </View>

                {renderCellOverlay === undefined ? null : (
                  <View style={styles.overlayHost}>{renderCellOverlay(card)}</View>
                )}
              </View>
            );
          })}
        </View>
      ))}
      </View>

      {footnote === undefined ? null : (
        <Text style={[text.caption, styles.footnote]}>{footnote}</Text>
      )}
    </View>
  );
}
