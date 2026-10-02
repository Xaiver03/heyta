/**
 * 空态（共享 · 唯一权威定义）
 * ==============================
 *
 * M3 的收编主角：**"没有内容时画什么"只有这一个实现。**
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 为什么需要它（不是"少写点代码"）
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 判据出处 `docs/research/dida-view-unification.md`：
 *   · §1.6「空态：居中一句「没有任务」—— **一个组件一句话**」
 *   · §3 判据 3「空态只有**一个**实现 + 一套词条」
 *   · §5 不变量「**空态只有一个**」
 *
 * 实测的形状**不是**"一个实现"：web 壳里有一份 `function EmptyState`
 * （`apps/web/src/App.tsx`，渲染 `ht-empty` 三件套），mobile kit 里有一份
 * `export function EmptyState`（`apps/mobile/src/ui/kit.tsx`），而共享层
 * `packages/ui` 只有 `TaskList.emptyMessage?: string` —— 一句话，装不下
 * icon + title + hint。两端各写一份的代价不是"多写几行"：它们对
 * "hint 缺失时该不该渲染一行""detail 该不该报错"这类问题**各自回答**，
 * 而两份答案之间的差异**不会让任何测试变红**（与 `FocusPanel.tsx` 文件头
 * 记的是同一类事故）。
 *
 * 这个文件就是那个缺失的权威实现。`scripts/check-empty-state.mjs` 的
 * 断言 C 把**它**登记为唯一权威定义处。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 文案由宿主注入，本文件**不 import `@heyta/i18n`**
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 和 `TaskList.tsx` / `FocusPanel.tsx` 同一个理由：i18n 包曾自己带一份 React，
 * 让 Android 产物出现两个 React 实例，报错位置离根因很远 —— 仓库里因此有
 * `check:mobile-bundle` 盯着。共享层是四端共用的，它一旦拖进 React，
 * 四个端会**同时**中招。所以四个槽位收的全是**已经翻译好的字符串**，
 * 模板留在有 i18n 的那一侧。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 只用 RN 原语；颜色 / 字号 / 间距全部走 token
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `View` / `Text` 在 `react-native-web` 上都有等价实现，`<div>` 在 iOS 上
 * 不存在。图标走 `../icon/Icon.tsx`（数据来自框架无关的 `lucide`，渲染用
 * `react-native-svg`），所以四个端画的是同一个字形。
 *
 * **没有任何裸值** —— `check:design` 会拦。间距取 `space.*`、图标边长取
 * `icon.xl`、颜色取语义色、排版取 `useHeytaText()` 的语义样式
 * （行高在 CSS 里是倍数、在 RN 里是点值，自己拼一定会有人漏掉那次乘法）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ 收编时两端各自要丢掉的东西（外观**故意**以本文件为准）
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   | 项 | web 壳 | mobile kit | 本文件 | 理由 |
 *   |---|---|---|---|---|
 *   | 图标边长 | `40`（裸值） | `icon.xl`(32) | `icon.xl` | 40 不是 token；32 是 |
 *   | 图标颜色 | `color.border-strong` | `color.foreground-subtle` | `foreground-subtle` | 前者是**边框**色被当成了前景色 |
 *   | 标题排版 | `font-size.base` + medium | `section-title` | `section-title` | 语义样式，不拼字号 |
 *   | 提示排版 | `font-size.sm`（继承 subtle） | `row-meta` + subtle | `row-meta` | 同上 |
 *   | 描边权重 | lucide 默认 2 | `1.5` | `1.5` | 大号字形配细描边，笔画才不糊 |
 *
 * 这张表是**给收编者看的**：两端收编成薄转发时，这几处差异会真的改变
 * 屏幕上的像素 —— 它们是"统一"的代价，不是 bug。
 */

import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { HeytaIcon } from '../icon/Icon.js';
import { useHeytaText, useHeytaTokens } from '../theme.js';
import { toEmptyStateViewModel, type EmptyStateSlots } from './model.js';

export type {
  EmptyStateDetailTone,
  EmptyStateSize,
  EmptyStateSlots,
} from './model.js';

export interface EmptyStateProps extends EmptyStateSlots {
  /**
   * 测试 / 真机验收用的定位钩子。
   *
   * ⚠️ 两端的既有站点把 `data-testid` 直接写在空态根节点上
   * （`timeline-view-empty` / `gantt-empty` / `passkeys-empty`…），
   * 而 `scripts/check-empty-state.mjs` 的断言 B 用 `*empty*` 的 testid
   * 识别手写站点。收编这些站点时**必须**把这个 testID 传进来，
   * 否则 e2e 的定位钩子和门禁的登记项会**同时**静默消失。
   */
  readonly testID?: string | undefined;
}

export function EmptyState(props: EmptyStateProps): React.JSX.Element {
  const { testID } = props;
  const tokens = useHeytaTokens();
  const text = useHeytaText();

  // 🔴 **整个 props 对象交给模型**，不是逐个挑字段。
  //    原来这里写的是 `toEmptyStateViewModel({ icon, title, hint, detail, detailTone })`
  //    —— 新加 `size` 档时忘了往里加一个，于是**模型完全正确、组件永远画页面档**：
  //    442 条用例全绿（它们测的是模型），而真机截图上那行"还没有通行密钥"被撑成
  //    居中的一大块。"props → 模型"这条缝只有实际渲染能判，所以这里从设计上
  //    把它消掉：加新槽位时不可能再漏传。
  const view = toEmptyStateViewModel(props);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        root: {
          alignItems: 'center',
          justifyContent: 'center',
          gap: tokens['space.3'],
          paddingVertical: tokens['space.16'],
          paddingHorizontal: tokens['space.6'],
        },
        // RN 的 Text **不继承**父级对齐，所以每一行都要自己写。
        centered: { textAlign: 'center' },
        title: { color: tokens['color.foreground-muted'] },
        hint: { color: tokens['color.foreground-subtle'] },
        detailSubtle: { color: tokens['color.foreground-subtle'] },
        detailDanger: { color: tokens['color.danger'] },
        // 🔴 `section` 档：**不居中、不占页面高度**。它画的是"卡片里的一行占位"，
        //    所以根节点除了行间距什么都没有 —— 沿用页面档的 `paddingVertical: space.16`
        //    会把设置页撑出一大块空白，那是视觉回归，不是统一。
        rootSection: { gap: tokens['space.2'] },
        // 区块档的标题用 `row-meta` + subtle（调用方原来就是这个形状），
        // 页面档用 `section-title` + muted。
        titleSection: { color: tokens['color.foreground-subtle'] },
      }),
    [tokens],
  );

  const section = view.size === 'section';

  return (
    <View style={section ? styles.rootSection : styles.root} accessibilityRole={view.a11yRole} testID={testID}>
      {/* 装饰性图标：**不给 label** —— 读屏不该把"这里有个图标"念一遍，
          它旁边的标题已经说清了一切（与两端既有的 aria-hidden 同义）。
          `section` 档拿不到图标：那条判断在 `model.ts` 里，不在这里。 */}
      {view.icon === undefined ? null : (
        <HeytaIcon
          data={view.icon}
          size={tokens['icon.xl']}
          color={tokens['color.foreground-subtle']}
          strokeWidth={1.5}
        />
      )}

      <Text
        style={
          section
            ? [text['row-meta'], styles.titleSection]
            : [text['section-title'], styles.centered, styles.title]
        }
      >
        {view.title}
      </Text>

      {/* `hint` 可以整个省略 —— §1.6 的实测形状就是"居中一句"。 */}
      {view.hint === undefined ? null : (
        <Text
          style={
            section
              ? [text['row-meta'], styles.hint]
              : [text['row-meta'], styles.centered, styles.hint]
          }
        >
          {view.hint}
        </Text>
      )}

      {view.detail === undefined ? null : (
        <Text
          accessibilityRole={view.detailRole}
          // 只有错误详情值得被选中复制（用户要拿去反馈）；说明性文字不给，
          // 免得长按选中一片空白。
          selectable={view.detailTone === 'danger'}
          style={[
            text.caption,
            section ? undefined : styles.centered,
            view.detailTone === 'danger' ? styles.detailDanger : styles.detailSubtle,
          ]}
        >
          {view.detail}
        </Text>
      )}
    </View>
  );
}
