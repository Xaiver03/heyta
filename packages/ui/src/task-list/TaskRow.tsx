/**
 * `TaskRow` —— **一行的唯一实现**，带一个有界的 `density` 维度
 * =============================================================
 *
 * 出处：`docs/research/dida-view-unification.md` §4.2（本文最重要的一条）：
 *
 * > **判据**：四象限卡里的行 = `<TaskRow density="compact" />`，
 * > 日历格里的行 = `<TaskRow density="minimal" />`。**不是三份 JSX。**
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 这个文件是从 `TaskList.tsx` 的 `renderItem` 里**抽出来的**，不是重写的
 *
 * 2026-09-28 实测：`TaskList` 把行的 JSX **内联在 `renderItem` 里**，
 * 于是"四象限复用共享 `TaskList`"只做到了"不再有第二份行"，
 * **没做到"同一行、多档密度"** —— 而后者才是"让「一行」只有一个实现、
 * 其余全部推导出来"里**"推导"**那一半（缺口的完整记录见
 * `docs/plans/multi-platform-adaptation.md` 的「M3 §4.2 的 `density` 契约」一节）。
 *
 * 抽取的**唯一判据**是"默认档逐字节不动"：默认档（`comfortable`）的样式对象
 * 与 JSX 与原 `renderItem` 里的那段**字面相同**，所以 `TaskList` 的行为
 * 与抽取前一致（现有 web / ui 测试**一行未改**即为此的判据）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 分工（与 `TaskBadges.tsx` / `TaskList.tsx` 同一套边界）
 *
 * | 共享组件负责 | 宿主负责 |
 * |---|---|
 * | 行骨架（勾选框 + 标题 + 插槽位置、44 触控区补偿、无障碍 role/state） | 插槽**内容**（截止文案、优先级色、删除按钮…） |
 * | `density` 的三档差异（见 `density.ts` 的 `DENSITY_SPEC`） | **在哪一档用哪个容器**（列表=默认 / 象限=compact / 日历=minimal） |
 *
 * 🔴 **密度差异只在 `DENSITY_SPEC` 里定义**，本文件里**没有**
 * `if (density === …)` 这种散落分支 —— 这也是
 * `tests/task-row-density.spec.ts` 用源码级断言钉住的一条。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 只用 RN 原语，不 import 任何 DOM 标签、不 import `@heyta/i18n`
 *
 * 与 `TaskList.tsx` 的文件头同一条理由：`<div>` 在 iOS 上不存在，
 * 而 i18n 包一旦拖进第二份 React，四个端会同时中招。文案一律由宿主经
 * `labels` / `renderMeta` / `renderTrailing` 注入。
 */

import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View, type DimensionValue } from 'react-native';
import { TASK_ROW_SHAPE, TASK_ROW_TEXT } from '@heyta/design-system';
import { useHeytaText, useHeytaTokens } from '../theme.js';
import { resolveTaskRowDensity, type TaskRowDensity } from './density.js';
import type { TaskRow as TaskRowModel } from './model.js';

/**
 * 行级无障碍文案。**每一项都是一整句**，不要用前缀拼标题。
 *
 * ⚠️ 这个名字是 `TaskListLabels` 的**新家**：`TaskList.tsx` 从本文件
 * 把它转发出去（`export type { TaskRowLabels as TaskListLabels }`），
 * 于是 `@heyta/ui` 的公开名与 `index.ts` 的导出行都不用动。
 * 之所以搬到这里：`TaskList` import `TaskRow`（值），若 `TaskRow` 再
 * import `TaskList`（类型），就成了**互相 import** —— 抽出来的第一版就是这样，
 * 类型在 ESM 循环里是能过、但方向已经反了。
 */
export interface TaskRowLabels {
  /** 未完成时勾选框的念法，如「完成：买牛奶」。 */
  readonly toggleOn?: (row: TaskRowModel) => string;
  /** 已完成时勾选框的念法，如「取消完成：买牛奶」。 */
  readonly toggleOff?: (row: TaskRowModel) => string;
  /** 整行可点时它的念法，如「打开：买牛奶」。 */
  readonly open?: (row: TaskRowModel) => string;
}

/**
 * 行模型类型，**与组件同名**。
 *
 * 🔴 这不是巧合，是被 TypeScript 逼出来的：`@heyta/ui` 的桶文件
 * （`index.ts`）**不能**把"模型类型 `TaskRow`"与"组件值 `TaskRow`"
 * 从两个模块各转出一次 —— 实测 `tsc` 报 `TS2300: Duplicate identifier 'TaskRow'`。
 * 函数声明与接口声明**可以合并**，所以这里让同一个名字同时承担两种含义：
 *   - 值空间：`TaskRow` 是这个函数组件（`import { TaskRow } from '@heyta/ui'`）；
 *   - 类型空间：`TaskRow` 是 `model.ts` 的行模型（`type TaskRow` 用法一字不改）。
 * 结构上它与 `TaskRowModel` 完全一致，现有消费者（`apps/web` 的
 * `type TaskRow as SharedTaskRow` 等）拿到的东西没有任何变化。
 */
export interface TaskRow extends TaskRowModel {}

export interface TaskRowProps {
  /** 渲染用的行模型（`model.ts` 的 `toTaskRow` 产出）。 */
  readonly row: TaskRowModel;
  /**
   * 紧凑度。默认 `'comfortable'`（= 抽取之前列表里的那一档）。
   * 差异只在 `density.ts` 的 `DENSITY_SPEC` 里定义。
   */
  readonly density?: TaskRowDensity;
  /** 勾选/取消勾选。**不要在组件内部改数据** —— 变更必须走宿主的 action 层。 */
  readonly onToggleTask: (taskId: string) => void;
  /**
   * 点整行的行为。**给了就打开详情；不给时整行不可点。**
   *
   * 🔴 刻意**不**把"没给 `onOpenTask`"降级成"点行 = 切换完成"：
   * 那个默认值会让"忘了传"表现成**点一下就误完成一条任务**。
   */
  readonly onOpenTask?: (taskId: string) => void;
  readonly labels?: TaskRowLabels;
  /** 标题下方的元信息行（截止 / 优先级 / 重复…）。`minimal` 档不渲染它。 */
  readonly renderMeta?: (row: TaskRowModel) => React.ReactNode;
  /** 行尾的动作（删除按钮 / 拖动手柄…）。`minimal` 档不渲染它。 */
  readonly renderTrailing?: (row: TaskRowModel) => React.ReactNode;
  /** 正在处理中的这一行 —— 用于置灰、避免连点发出两条变更。 */
  readonly busy?: boolean;
  /**
   * 键盘选中（"高亮光标"）在这一行上。默认 `false`，不传时逐字节等价。
   *
   * 🔴 它表达的是**"回车会打开哪一条"**，不是"这条被勾选了"，所以两件事
   * 必须用不同的视觉通道：勾选框已经被"完成 / 未完成"占了，高亮只能另找。
   *
   * 底色用 `color.primary-subtle` 而**不是**实心主色：宿主经 `renderMeta`
   * 注入的截止徽章 / 优先级徽章是宿主自己上色的（红、蓝都有），
   * 换成深蓝底会让那些徽章**读不出来**。浅底 + 原字色对所有宿主安全。
   */
  readonly active?: boolean;
}

export function TaskRow({
  row,
  density,
  onToggleTask,
  onOpenTask,
  labels,
  renderMeta,
  renderTrailing,
  busy = false,
  active = false,
}: TaskRowProps): React.JSX.Element {
  const tokens = useHeytaTokens();
  const text = useHeytaText();

  /**
   * 🔴 **档位解析只有这一处。** `density` 只是个选择器，规格来自
   * `DENSITY_SPEC`；下面的 JSX 与样式**只读 `spec`，不读 `density`**。
   */
  const spec = resolveTaskRowDensity(density);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        row: {
          flexDirection: 'row',
          alignItems: 'center',
          // `minHeight` 为 `null` 的档位（`minimal`）不设下限。
          // 用 `undefined`（而不是 0）让 RN 完全不下发这条声明 ——
          // 0 会是一条真实的 CSS 声明，改变的是"最小高"的语义。
          // 🔴 `tokens[...]` 的静态类型是 `string | number`，而 RN 要 `DimensionValue` ——
          // 断言**只在类型层**，运行时一个字节都不变（由父 agent 于第 51 轮补，
          // 修的是 `pnpm -r typecheck` 连续三轮的唯一红）。
          minHeight:
            spec.minHeight === null
              ? undefined
              : (tokens[spec.minHeight] as DimensionValue),
          gap: tokens[spec.gap],
        },
        /**
         * 🔴 命中区**必须是一条真实的尺寸声明**，不能靠 `marginLeft` 借位。
         *
         * 改之前这里只有 `marginLeft: -(44-22)/2 = -11px`，**没有任何 width/height**，
         * 于是注释里承诺的"44 触控下限"在盒模型上根本不存在 —— 实测命中区就是那个
         * 22px 的圈（类 A：用一个不存在的属性表达契约）。按无障碍标准量的是
         * **输入区域**而不是那个视觉标记，所以"圈是 22"不是问题，"命中区也是 22"才是。
         *
         * 而那 11px 的负边距同时是**被裁的一半**（类 B）：裁剪祖先是 RNW 的
         * `ScrollView`（⇒ `overflow-x: hidden`），它的可视左边恰好等于行的左边，
         * 负边距推出去的部分落在裁剪区里 ⇒ 圈**正好少一半**。
         *
         * ⚠️ 这里**刻意没有** `flexShrink: 0`：RN/RNW 的 `View` 默认已经是 0
         * （实测计算样式 `flex-shrink: 0`，见计划 §2.1 结论 1）。加上去是一行
         * **不起作用的修法** —— 它不解决任何问题，还会让人以为解决了。
         */
        checkboxHit: {
          width: tokens[TASK_ROW_SHAPE.touchTarget],
          height: tokens[TASK_ROW_SHAPE.touchTarget],
          alignItems: 'center',
          justifyContent: 'center',
        },
        box: {
          width: tokens[TASK_ROW_SHAPE.checkboxSize],
          height: tokens[TASK_ROW_SHAPE.checkboxSize],
          borderRadius: tokens[TASK_ROW_SHAPE.checkboxRadius],
          borderWidth: tokens[TASK_ROW_SHAPE.checkboxBorderWidth],
          borderColor: tokens['color.border-strong'],
          alignItems: 'center',
          justifyContent: 'center',
        },
        boxDone: {
          backgroundColor: tokens['color.primary'],
          borderColor: tokens['color.primary'],
        },
        // 勾的形状用文字画，避免为它引入一个图标依赖
        //（图标库正是各端不一样的那一类依赖）。
        tick: { color: tokens['color.on-primary'] },
        body: {
          flex: 1,
          // 曾在这里加过 `minWidth: 0`，理由是"弹性盒 §4.5 的自动最小尺寸 = 内容宽，
          // 长标题不肯换行会把行撑宽"。**这条假设被实测证伪了**：删掉这一行后
          // body 仍计算为 `min-width: 0px`（RNW 的 `flex: 1` 已经把 min-width 归零），
          // `scrollWidth == clientWidth`，长标题与不可断行的长 URL 都照常换行。
          // 留着它 = 一条永远通过的判据 + 一段说错原因的注释，比不写更糟。
          /**
           * 🔴 但"**归零**"和"**没有下限**"是两件事：`flex: 1` 在 RNW 上算出
           * `flex-basis: 0%`，于是 body 只拿"行尾控件要完之后剩下的"。桌面载荷实测
           * （视口 900）：行尾常驻控件要 496px，body 剩 **0px ⇒ 标题整条消失**，
           * 用户看得见"这里有一条任务"，看不见它是什么。
           * 这条**百分比下限**防的就是那个 0：窄窗口下行尾换行让位，
           * 宽窗口（≥1120）它不生效；移动端行尾只有一个删除键（≈44/390），
           * body 恒在 70% 以上，所以下限在手机上惰性。
           * 三档 A/B 与截图见 `docs/plans/ui-review-fill-zh-timeline.md` 的 G9 条目。
           */
          minWidth: '30%',
          paddingVertical: tokens[spec.bodyPaddingBlock] as DimensionValue,
          gap: tokens[spec.gap],
        } as const,
        titleDone: {
          color: tokens['color.foreground-subtle'],
          // 已完成加删除线。**不能只靠颜色变淡** —— 那会漏掉色觉障碍用户，
          // 而"这条到底做完了没有"是列表里最要紧的一个判断。
          // `textDecorationLine` 是 RN 的样式枚举，不是设计尺度，无需 token。
          textDecorationLine: 'line-through',
        } as const,
        metaRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: tokens[TASK_ROW_SHAPE.metaGap],
        },
        /**
         * 键盘选中的高亮（见 `TaskRowProps.active`）。
         * 只加底色与圆角，**不动任何几何** —— 光标上下移动时行宽、
         * 勾选框位置、文字基线都不能跳。
         */
        rowActive: {
          backgroundColor: tokens['color.primary-subtle'],
          borderRadius: tokens['radius.md'],
        },
      }),
    [spec, tokens],
  );

  const toggleLabel = row.done
    ? (labels?.toggleOff?.(row) ?? row.title)
    : (labels?.toggleOn?.(row) ?? row.title);
  const openLabel = labels?.open?.(row);

  /**
   * 🔴 锚点叫 `task-title-*`，**不能**叫 `task-row-title`：`[data-testid^="task-row-"]`
   * 在别处被当成**行数**来数（`e2e/tests/desktop-window.spec.ts`、
   * `scripts/verify-universal-slice.browser.mjs`），多一个同前缀的元素会把每一行数两遍。
   *
   * 标题必须单独可寻址：行体（`task-row-*`）的 `textContent` 里现在**一定**有元信息
   *（归属常驻），按行体取"这条叫什么"会把「收集箱」之类的徽章一起吞进去。
   */
  const title = (
    <Text
      style={[text[TASK_ROW_TEXT.title], row.done ? styles.titleDone : null]}
      testID={`task-title-${row.id}`}
      numberOfLines={2}
    >
      {row.title}
    </Text>
  );

  return (
    /**
     * 🔴 外层行也要有一个稳定的 handle。
     *
     * 行体（`task-row-*`）只包含标题与元信息；**尾部动作**
     *（`renderTrailing`）是它的**兄弟节点**，不在行体里。于是按行体定位
     * "这一行"时，那些控件一个都找不到 —— 实测代价：
     * `e2e/tests/task-organize.spec.ts` 的
     * `rowFor(...).getByTestId('task-organize-summary')` 会全部落空。
     *
     * 这不是样式或行为，而是**"一行"这个容器缺少可寻址的名字**。
     */
    <View
      style={active ? [styles.row, styles.rowActive] : styles.row}
      testID={`task-item-${row.id}`}
    >
      <Pressable
        accessibilityRole="checkbox"
        // 无障碍状态必须显式给：读屏用户靠它知道"这条是待办还是已完成"，
        // 而勾选框的**颜色**对他们完全不可见。
        // 🔴 用**平铺** `aria-*`，不要用对象形态 `accessibilityState` / `accessibilityValue`：
        // RNW 0.21 会把对象形态**整个丢掉**（实测 `aria-checked` / `aria-valuenow` 都不出现），
        // 而 RN 0.71+ 两端都认平铺形态。判据见 `pnpm check:rn-aria`。
        aria-checked={row.done}
        aria-busy={busy}
        accessibilityLabel={toggleLabel}
        disabled={busy}
        onPress={() => onToggleTask(row.id)}
        style={styles.checkboxHit}
        testID={`task-toggle-${row.id}`}
      >
        <View style={[styles.box, row.done ? styles.boxDone : null]}>
          {row.done ? <Text style={[text[TASK_ROW_TEXT.check], styles.tick]}>✓</Text> : null}
        </View>
      </Pressable>

      {/*
        🔴 没有 `onOpenTask` 时，行体**不是**可点的。
        在勾选框外面再套一层可点区域会让读屏念两遍，
        而两个语义重叠的命中区在触屏上也很难区分。
      */}
      {onOpenTask === undefined ? (
        <View style={styles.body} testID={`task-row-${row.id}`}>
          {title}
          {renderMeta === undefined || !spec.showMeta ? null : (
            <View style={styles.metaRow}>{renderMeta(row)}</View>
          )}
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          {...(openLabel === undefined ? {} : { accessibilityLabel: openLabel })}
          onPress={() => onOpenTask(row.id)}
          style={styles.body}
          testID={`task-row-${row.id}`}
        >
          {title}
          {renderMeta === undefined || !spec.showMeta ? null : (
            <View style={styles.metaRow}>{renderMeta(row)}</View>
          )}
        </Pressable>
      )}

      {renderTrailing === undefined || !spec.showTrailing ? null : renderTrailing(row)}
    </View>
  );
}
