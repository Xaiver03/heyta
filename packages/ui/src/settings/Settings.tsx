/**
 * 设置分组 + 设置行（共享）
 * ============================
 *
 * M3 第五刀（settings）的主角：**"设置里的一行长什么样"只有这一个实现。**
 * 分组标题、说明句、小标题、值行、开关行、动作行、说明行，全部由这两个组件
 * 渲染；web 与 mobile 只决定把分组放在页面的哪里、注入文案与 testID，
 * 以及各行触发什么动作。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 为什么需要它（不是"少写点代码"）
 *
 * 迁之前两端各有一套设置行的骨架：
 *
 *   | 形态 | web（`features/settings/**`） | mobile（`ProfileScreen.tsx`） |
 *   |---|---|---|
 *   | 分组 | `<h2 class="ht-settings__title">` + `<ul class="ht-settings__list">` | `SectionHeader` + `Card` |
 *   | 值行 | `ht-settings__item` + `ht-settings__toggle-body/-label/-hint`（MemoryPanel / PasskeyPanel 各抄一遍） | 本地 `Row`（`justifyContent:'space-between'`） |
 *   | 动作行 | `<a class="ht-btn ht-btn--ghost"><Icon/>{label}</a>` + `ht-settings__hint` | `Button` + `<Text variant="caption">`（成对出现三次） |
 *   | 步骤 | `<ol class="ht-panel__steps">` | `{index+1}. {t(key)}` 拼进 `<Text>` |
 *
 * 这些副本之间的差异**不会让任何测试变红**：它们只会让"一行设置"在两个端上
 * 呈现成两种留白、两种层级。这正是 `dida-view-unification.md` §1.4
 * 「一个列表容器 + 一套类型化 cell」在设置这一项上的对应物。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 判断留在 `./model.ts`，本文件只把它们摆到 RN 原语上
 *
 * 可用性判定（`null` / `undefined` / `false` 三态）与"改不动的那一项整项不渲染"
 * 这条产品判据都在 `model.ts`，有单测。所以这里**没有分支需要靠快照测试兜**。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 文案一律由宿主注入，本文件不 import `@heyta/i18n`
 *
 * 与 `TaskList.tsx` / `FocusPanel.tsx` / `CategoryReport.tsx` /
 * `ConflictResolutionView.tsx` 同一个理由：i18n 包曾自己带一份 React，
 * 让 Android 产物出现两个 React 实例，仓库里因此有 `check:mobile-bundle`
 * 盯着。共享层是四端共用的，它一旦拖进 React，四个端会同时中招。
 * 所以 `SettingsRowModel` 里的每一个字符串都是**宿主已经翻好的**文案。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 只用 RN 原语，不 import 任何 DOM 标签
 *
 * `View` / `Text` / `Pressable` 在 `react-native-web` 上都有等价实现；
 * `<div>` 在 iOS 上不存在。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 动作行的链接：**搬过来了，走的是 `Text` 的 `href`**
 *
 * web 的「帮助与关于」是三个**真链接**（`<a href>`），不是按钮：它们要能中键
 * 新开、能被读屏报成"链接"、能带 `rel` 防 `window.opener` 反向操纵。
 * 迁成共享层时最省事的做法是把它降级成 `Pressable` 按钮 —— **那会真的丢掉
 * 三件事**，而且 `apps/web/tests/app-mount.spec.tsx` 里"设置页里有指向站点的
 * 链接"那条断言会当场变红（它不在本刀白名单，不该为迁就让步）。
 *
 * 实测（2026-09-28，读 `react-native-web@0.21.3` 的
 * `dist/exports/Text/index.js`）：
 *   · `href` **在** `forwardPropsList` 里；
 *   · `props.href != null` 时元素被改成 `createElement('a', …)`；
 *   · `hrefAttrs.rel` 会被写进真实 `rel` 属性。
 * 所以共享层给动作行一个 `href`，web 端渲染出来的就是**真实的 `<a>`**；
 * 原生端没有 `href` 那一支（RN 的 `Text` 忽略未知 prop），走 `onPress`。
 *
 * ⚠️ **为什么必须 cast**：`href` / `hrefAttrs` 是 **react-native-web 专有**的
 * prop，`react-native` 自己的 `TextProps` 里没有它们 —— 不 cast 过不了 TS，
 * 与 `CategoryReport.tsx` 的 `dataSet` 是同一个形状、同一个理由。
 *
 * ⚠️ **带 `href` 的行刻意不套 `Pressable`。** RNW 的 `accessibilityRole` 会
 * 换掉元素（`propsToAccessibilityComponent` 把 `button` 映射成真实
 * `<button>`；`link` 没有映射，仍是 `div`），所以"`div role=link` 里再套一个
 * `<a>`"会产出**嵌套的两层链接语义**。链接行只由那个 `<a>` 承担语义与键盘焦点。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ 诚实记账：**开关行的 `disabled` 在 web 上只产出 `aria-disabled`**
 *
 * RNW 的 `Pressable` 在白名单里**没有** `disabled`
 * （`react-native-web/dist/modules/forwardedProps`），所以 `disabled` 只表现成
 * `aria-disabled="true"` + `tabIndex=-1`，**不产出 DOM 的 `disabled` 属性**。
 * 原生端 `disabled` 是 RN 自己的属性，语义完整。
 *
 * 影响面：web 的「后台刷新小组件」开关在 `busy` 期间不接受点击（`onPress`
 * 被 RNW 拦住）、读屏也会报"已禁用"，但
 * `document.querySelector('[data-testid=…]').disabled` 读不到 —— 靠 DOM
 * `disabled` 做断言的测试在这个开关上会失效。目前 `WidgetPushPanel`
 * **没有** DOM 级测试（`push-subscribe.spec.ts` 只测纯逻辑），
 * 所以这不是一次损失，只是**已知边界**。
 * 最小可行的一步：将来给这个开关写 DOM 断言时用 `aria-disabled`，
 * 与 `ConflictResolutionView.tsx` 文件头记的同一个取舍。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 宿主必须把它包在 `<HeytaUiProvider>` 之内
 *
 * ⚠️ 本组件**尚未登记进** `scripts/check-ui-provider.mjs` 的
 * `PROVIDER_DEPENDENT` 清单（那个脚本不在本刀白名单里）——
 * 需要补的两个符号是 **`SettingsSection`** 与 **`SettingsRow`**。
 * 补登记之前门禁不覆盖它：宿主拆掉 Provider **也不会红**，而运行时会抛
 * 「useHeytaUiTheme 必须在 <HeytaUiProvider> 内使用。」
 * （第四刀补登记那一次的根因与后果写在那个脚本的注释里。）
 */

import React, { useMemo } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type TextProps,
} from 'react-native';
import { Check } from 'lucide';
import type { HeytaNativeTokens } from '@heyta/design-system';
import { HeytaIcon } from '../icon/Icon.js';
import { useHeytaText, useHeytaTokens } from '../theme.js';
import {
  settingsRowKey,
  shouldRenderSettingsRow,
  type SettingsActionRow,
  type SettingsHeadingRow,
  type SettingsNoteRow,
  type SettingsRowModel,
  type SettingsRowTone,
  type SettingsToggleRow,
  type SettingsValueRow,
} from './model.js';

/* ========================================================================
 * 样式
 * ====================================================================== */

/** 取一份 token 表建出这套样式。**一个裸值都没有**（`check:design` 会拦）。 */
function makeStyles(tokens: HeytaNativeTokens) {
  return StyleSheet.create({
    root: {
      gap: tokens['space.2'],
    },
    /** 卡片形态：靠边框与底色分段（mobile 的 `Card` 是这一档的参照）。 */
    card: {
      padding: tokens['space.4'],
      borderRadius: tokens['radius.lg'],
      backgroundColor: tokens['color.surface'],
    },
    /** 分组标题那一行：图标 + 标题，靠左。 */
    sectionHead: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: tokens['space.2'],
    },
    /** 一行：标签在左、值/控件在右。 */
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: tokens['space.3'],
    },
    /** 行首那一列（标签 + 提示）。它吃掉弹性宽度，值/控件才靠得住边。 */
    body: {
      flexShrink: 1,
      gap: tokens['space.1'],
    },
    /** 会被省略号截断的那一格（标题 / 值 / 长标签）。 */
    dynamic: {
      flexShrink: 1,
    },
    list: {
      gap: tokens['space.2'],
    },
    /** 宿主显式要求的分隔线（见 `SettingsRowCommon.divider`）。 */
    divider: {
      borderTopWidth: tokens['border-width.thin'],
      borderTopColor: tokens['color.border-subtle'],
      paddingTop: tokens['space.2'],
    },
    /** 开关的状态标记：一个小方框，选中时是主色 + 对钩。 */
    marker: {
      width: tokens['space.5'],
      height: tokens['space.5'],
      flexShrink: 0,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: tokens['radius.sm'],
      backgroundColor: tokens['color.surface-sunken'],
    },
    /** 动作行：标签（+ 可选的记号）与说明，两者左对齐。 */
    action: {
      gap: tokens['space.1'],
      minHeight: tokens['touch-target.min'],
      justifyContent: 'center',
    },
    /** 标签那一行：记号 + 文字，水平排列。 */
    actionHead: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: tokens['space.2'],
    },
    /** 说明句那一行：记号 + 文字。 */
    noteRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: tokens['space.1'],
    },
  });
}

type SettingsStyles = ReturnType<typeof makeStyles>;

/* ========================================================================
 * 一、分组
 * ====================================================================== */

export interface SettingsSectionProps {
  /** 分组标题。二级页面已经在顶栏显示分组名时可以省略，避免重复层级。 */
  readonly title?: string;
  /** 标题下面那一整句说明。省略则不渲染。 */
  readonly note?: string;
  /**
   * 标题前的那个记号（图标），由**宿主**渲染。
   *
   * 🔴 这里刻意是**插槽**而不是 `icon: HeytaIconData`：两端的字形来源**不同源** ——
   * 共享层用的是 `lucide` 的**数据**（`HeytaIcon` 再拿 `react-native-svg` 画），
   * 而 `apps/mobile/src/ui/icons.tsx` 用的是 `lucide-react-native` 的**组件**
   * （它自己有一张名字 → 组件的登记表）。让共享层只接受其中一种，
   * 另一端就只能**不画图标** —— 那是为了统一而降级，不是统一。
   * 记号长什么样本来就是外壳差异（L3），所以由宿主给组件。
   */
  readonly leading?: React.ReactNode;
  /** 类型化的行。与 `children` 可以同时给（顺序：rows → children）。 */
  readonly rows?: readonly SettingsRowModel[];
  /** 宿主特有的内容（mobile 的语言胶囊、web 的表单…）。 */
  readonly children?: React.ReactNode;
  /**
   * 容器形态。**这是外壳差异，不是外观偏好**：
   *   · `plain`（web 的 `ht-settings` 区块）靠上下间距分段；
   *   · `card`（mobile 的卡片）靠边框分段，因为手机一屏里还有别的卡片。
   */
  readonly variant?: 'plain' | 'card';
  readonly testID?: string;
  /**
   * 行列表容器的 testID。
   *
   * 🔴 它是给**既有断言**用的逃生口：web 的 `app-mount.spec.tsx` 用
   * `[data-testid="about-links"] a` 定位那三个站内链接。没有这个口子，
   * 那条断言只能靠改测试迁就 —— 而它不在本刀的白名单里。
   */
  readonly listTestID?: string;
}

export function SettingsSection({
  title,
  note,
  leading,
  rows,
  children,
  variant,
  testID,
  listTestID,
}: SettingsSectionProps): React.JSX.Element {
  const tokens = useHeytaTokens();
  const text = useHeytaText();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);

  // 🔴 不渲染的行在**这里**被剔掉，而不是留给每一行自己判 ——
  //    否则"坏值不渲染"会变成 N 个 JSX 分支，每一处都可能忘。
  const visibleRows = (rows ?? []).filter(shouldRenderSettingsRow);

  return (
    <View style={[styles.root, variant === 'card' ? styles.card : null]} testID={testID}>
      {title === undefined && leading === undefined ? null : (
        <View style={styles.sectionHead}>
          {leading === undefined ? null : leading}
          {title === undefined ? null : (
            <Text style={[text['section-title'], styles.dynamic, { color: tokens['color.foreground'] }]}>
              {title}
            </Text>
          )}
        </View>
      )}

      {note === undefined ? null : (
        <Text style={[text.caption, { color: tokens['color.foreground-muted'] }]}>{note}</Text>
      )}

      <View style={styles.list} testID={listTestID}>
        {visibleRows.map((row, index) => (
          <View key={settingsRowKey(row, index)} style={row.divider === true ? styles.divider : null}>
            <SettingsRow row={row} styles={styles} />
          </View>
        ))}
      </View>

      {children}
    </View>
  );
}

/* ========================================================================
 * 二、行
 * ====================================================================== */

export interface SettingsRowProps {
  readonly row: SettingsRowModel;
  /** 与分组共用同一份样式表 —— 单独用行时由宿主给（见 `SettingsRowView`）。 */
  readonly styles?: SettingsStyles | undefined;
  readonly testID?: string;
}

/**
 * 单独用一行（不套 `SettingsSection`）。
 *
 * mobile 的「待上传 / 上次同步」两行住在**同步表单那张卡片**里，那张卡的骨架是
 * 表单（三个 `TextField`），不是一组设置行 —— 所以它不套分组，只借这一行的形状。
 * 这种情况下组件自己建一份样式表（多一次 `useMemo`，换来宿主不必知道样式表类型）。
 */
export function SettingsRow({ row, styles, testID }: SettingsRowProps): React.JSX.Element {
  const tokens = useHeytaTokens();
  const own = useMemo(() => makeStyles(tokens), [tokens]);
  const active = styles ?? own;

  switch (row.kind) {
    case 'value':
      return <ValueLine row={row} styles={active} testID={testID} />;
    case 'toggle':
      return <ToggleLine row={row} styles={active} testID={testID} />;
    case 'action':
      return <ActionLine row={row} styles={active} testID={testID} />;
    case 'note':
      return <NoteLine row={row} styles={active} testID={testID} />;
    case 'heading':
      return <HeadingLine row={row} testID={testID} />;
    default: {
      // 穷尽自检：新增一种行而没在这里渲染 → 编译期报错，而不是静默少画一行。
      const never: never = row;
      return <Text>{String(never)}</Text>;
    }
  }
}

/**
 * 语义色调 → 颜色 token。
 *
 * 🔴 用 `*-strong` 而不是 `color.danger` / `color.warning` 那一档：
 * `design-system` 的对比度测试只登记了 `*-strong` 作为**正文文字色**
 * （与 `sync/model.ts` 的 `SyncColorToken` 同一个理由）。
 */
const TONE_COLOR = {
  default: 'color.foreground',
  muted: 'color.foreground-muted',
  subtle: 'color.foreground-subtle',
  danger: 'color.danger-strong',
  warning: 'color.warning-strong',
} as const satisfies Record<SettingsRowTone, keyof HeytaNativeTokens>;

function toneColor(tokens: HeytaNativeTokens, tone: SettingsRowTone): string {
  return tokens[TONE_COLOR[tone]];
}

/* ---- 值行 ------------------------------------------------------------- */

function ValueLine({
  row,
  styles,
  testID,
}: {
  readonly row: SettingsValueRow;
  readonly styles: SettingsStyles;
  readonly testID?: string | undefined;
}): React.JSX.Element {
  const tokens = useHeytaTokens();
  const text = useHeytaText();

  const body = (
    <View style={styles.row}>
      <Text style={[text['row-meta'], styles.dynamic, { color: tokens['color.foreground-muted'] }]}>
        {row.label}
      </Text>
      <Text
        testID={row.valueTestID}
        numberOfLines={1}
        style={[text['numeric-body'], styles.dynamic, { color: toneColor(tokens, row.tone ?? 'default') }]}
      >
        {row.value}
      </Text>
    </View>
  );

  if (row.onPress === undefined) {
    return <View testID={row.testID ?? testID}>{body}</View>;
  }

  return (
    <Pressable
      testID={row.testID ?? testID}
      onPress={row.onPress}
      // 🔴 整行可点，而且它是**一个开关**：读屏要能念出"开/关"。
      //    点的是行而不是行里那个小方框 —— 44pt 触控区那条理由见
      //    `model.ts` 的 `SettingsValueRow`。
      accessibilityRole="switch"
        // 🔴 用**平铺** `aria-*`，不要用对象形态 `accessibilityState` / `accessibilityValue`：
        // RNW 0.21 会把对象形态**整个丢掉**（实测 `aria-checked` / `aria-valuenow` 都不出现），
        // 而 RN 0.71+ 两端都认平铺形态。判据见 `pnpm check:rn-aria`。
      aria-checked={row.tone === 'default'}
      hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
    >
      {body}
    </Pressable>
  );
}

/* ---- 开关行 ----------------------------------------------------------- */

function ToggleLine({
  row,
  styles,
  testID,
}: {
  readonly row: SettingsToggleRow;
  readonly styles: SettingsStyles;
  readonly testID?: string | undefined;
}): React.JSX.Element {
  const tokens = useHeytaTokens();
  const text = useHeytaText();
  const disabled = row.disabled === true;

  return (
    <Pressable
      testID={row.testID ?? testID}
      onPress={row.onToggle}
      disabled={disabled}
      accessibilityRole="switch"
        // 🔴 用**平铺** `aria-*`，不要用对象形态 `accessibilityState` / `accessibilityValue`：
        // RNW 0.21 会把对象形态**整个丢掉**（实测 `aria-checked` / `aria-valuenow` 都不出现），
        // 而 RN 0.71+ 两端都认平铺形态。判据见 `pnpm check:rn-aria`。
      aria-checked={row.checked}
      aria-disabled={disabled}
      // `aria-busy` 与 `disabled` 不是同一件事：前者说"我在做事"（读屏要等），
      // 后者说"别点"。只留后者会让读屏用户不知道在等什么。
      aria-busy={row.busy === true ? true : undefined}
      style={{ opacity: disabled ? tokens['state.disabled-opacity'] : 1 }}
    >
      <View style={styles.row}>
        <View style={styles.body}>
          <View style={styles.actionHead}>
            {row.leading === undefined ? null : row.leading}
            <Text style={[text['row-title'], styles.dynamic, { color: tokens['color.foreground'] }]}>
              {row.label}
            </Text>
          </View>
          {row.hint === undefined ? null : (
            <Text style={[text.caption, { color: tokens['color.foreground-muted'] }]}>
              {row.hint}
            </Text>
          )}
        </View>
        {/*
          状态标记：一个方框 + 选中时的对钩。
          🔴 它**不只用颜色**区分开/关 —— 色觉障碍用户靠这个字形读状态
          （与移动端原来那个 `✓` 同一个意图，只是换成了共享的字形）。
        */}
        <View
          style={[
            styles.marker,
            {
              backgroundColor: row.checked ? tokens['color.primary'] : 'transparent',
            },
          ]}
        >
          {row.checked ? (
            <HeytaIcon data={Check} size={tokens['icon.xs']} color={tokens['color.on-primary']} />
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

/* ---- 动作行 ----------------------------------------------------------- */

/**
 * RN 的 `TextProps` 里没有 `href` / `hrefAttrs`（那是 RNW 的扩展）。
 * 见文件头「动作行的链接」—— 这是**必须 cast** 的那一处。
 */
interface LinkTextProps {
  readonly href?: string;
  readonly hrefAttrs?: { readonly rel?: string; readonly target?: string };
}

function linkProps(href: string | undefined): TextProps {
  if (href === undefined) return {};
  const link: LinkTextProps = { href, hrefAttrs: { rel: 'noopener noreferrer' } };
  return link as unknown as TextProps;
}

function ActionLine({
  row,
  styles,
  testID,
}: {
  readonly row: SettingsActionRow;
  readonly styles: SettingsStyles;
  readonly testID?: string | undefined;
}): React.JSX.Element {
  const tokens = useHeytaTokens();
  const text = useHeytaText();

  const body = (
    <View style={styles.action}>
      <View style={styles.actionHead}>
        {row.leading === undefined ? null : row.leading}
        <Text
          {...linkProps(row.href)}
          style={[text.headline, styles.dynamic, { color: tokens['color.primary'] }]}
        >
          {row.label}
        </Text>
      </View>
      {row.hint === undefined ? null : (
        <Text style={[text.caption, { color: tokens['color.foreground-muted'] }]}>
          {row.hint}
        </Text>
      )}
    </View>
  );

  // 🔴 带 `href` 的行**不套 `Pressable`**：那个 `<a>` 自己就是可聚焦、可点的，
  //    外面再包一层 `role="link"` 的 div 只会产出两层重复的链接语义。
  if (row.href !== undefined) {
    return <View testID={row.testID ?? testID}>{body}</View>;
  }

  return (
    <Pressable
      testID={row.testID ?? testID}
      onPress={row.onPress}
      accessibilityRole="button"
      // 行本身高度由内容决定，可能不足 44pt —— 触控区补出来。
      hitSlop={{ top: 8, bottom: 8 }}
    >
      {body}
    </Pressable>
  );
}

/* ---- 说明行 / 小标题行 ------------------------------------------------ */

function NoteLine({
  row,
  styles,
  testID,
}: {
  readonly row: SettingsNoteRow;
  readonly styles: SettingsStyles;
  readonly testID?: string | undefined;
}): React.JSX.Element {
  const tokens = useHeytaTokens();
  const text = useHeytaText();
  const role = row.role === 'alert' ? ('alert' as const) : undefined;

  // 没有记号、也没有序号时渲染成**单个文字节点**（不套一层 View）—— 这样调用点
  // 的 `textContent` 断言与读屏读到的都还是一句话，而不是"一个容器里的片段"。
  if (row.leading === undefined && row.index === undefined) {
    return (
      <Text
        testID={row.testID ?? testID}
        accessibilityRole={role}
        style={[text.caption, { color: toneColor(tokens, row.tone ?? 'muted') }]}
      >
        {row.text}
      </Text>
    );
  }

  return (
    <View testID={row.testID ?? testID} accessibilityRole={role} style={styles.noteRow}>
      {row.leading}
      {row.index === undefined ? null : (
        // 序号是**排版的一部分**，不是文案：数字用等宽样式，避免 9 → 10 时抖动。
        <Text
          accessibilityElementsHidden
          importantForAccessibility="no"
          style={[text['numeric-body'], { color: tokens['color.foreground-subtle'] }]}
        >
          {`${String(row.index)}.`}
        </Text>
      )}
      <Text
        style={[text.caption, styles.dynamic, { color: toneColor(tokens, row.tone ?? 'muted') }]}
      >
        {row.text}
      </Text>
    </View>
  );
}

function HeadingLine({
  row,
  testID,
}: {
  readonly row: SettingsHeadingRow;
  readonly testID?: string | undefined;
}): React.JSX.Element {
  const tokens = useHeytaTokens();
  const text = useHeytaText();

  return (
    <Text
      testID={row.testID ?? testID}
      style={[text['row-title'], { color: tokens['color.foreground'] }]}
    >
      {row.text}
    </Text>
  );
}
