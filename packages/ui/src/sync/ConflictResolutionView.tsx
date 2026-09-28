/**
 * 冲突解决视图（共享）
 * ======================
 *
 * M3 第四刀（sync）的主角之二：**"一处冲突该长什么样"只有这一个实现。**
 * 逐条列出（位置 · 实体 · 原因）、并排摆出两边的**内容**与时间、
 * 标出哪一侧较新、给每一侧一个「保留这一版」、把"为什么点不了"说出来。
 * web 与 mobile 只决定把它包在什么外壳里（对话框 / 底部弹层）、
 * 注入文案，以及传哪两个来自 `@heyta/sync-client` 的函数。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 为什么需要它（不是"少写点代码"）
 *
 * 迁之前两端各有一份：web `features/sync/ConflictDialog.tsx` 的 `Side`
 * 与 mobile `screens/ConflictSheet.tsx` 的 `Side`。它们读的是**同一份**
 * `ConflictInfo`，却各自回答"取不到对端时怎么显示""按钮为什么是灰的"
 * "哪一侧该是主色"。两份答案之间的差异**不会让任何测试变红**，
 * 只会让同一个冲突在两个平台上"较新"标在不同的一侧
 * （`compareConflictFreshness` 的注释记的就是这条）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 **判断来自哪里**（这是本文件最重要的边界）
 *
 * 本组件**不自己算任何领域规则**，它只消费三个来源：
 *
 *   | 事实 | 谁算 | 为什么不能在这里算 |
 *   |---|---|---|
 *   | 谁较新 / 平手 | `@heyta/sync-client#compareConflictFreshness`（宿主传 `freshnessOf`） | 共享层不能 import sync-client（会多一条依赖）；重写一遍 = 两份实现 |
 *   | 载荷里哪个字段能当标题 | `@heyta/sync-client#summarizeConflictPayload`（宿主传 `summarize`） | 那是唯一知道载荷形状的地方 |
 *   | 默认强调哪边 / 为什么点不了 / 摘要说哪一句 | **本目录的 `./model.ts`**（有单测） | 这三条是**展示语义**，两端必须一样，且不依赖任何领域包 |
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 文案一律由宿主注入，本文件不 import `@heyta/i18n`
 *
 * 与 `TaskList.tsx` / `FocusPanel.tsx` / `CategoryReport.tsx` 同一个理由：
 * i18n 包曾自己带一份 React，让 Android 产物出现两个 React 实例，
 * 仓库里因此有 `check:mobile-bundle` 盯着。共享层是四端共用的，
 * 它一旦拖进 React，四个端会同时中招。所以 `labels` 里每一项都是函数
 * （文案依赖行内容），模板留在有 i18n 的那一侧。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ **按钮留在宿主（`renderSideAction` 插槽），这是一处真实的损失**
 *
 * 共享层原本该把「保留这一版」按钮也画掉。**实测做不到**：
 * RNW 的 `Pressable`（`role="button"`）确实会渲染成真实 `<button>` 元素，
 * 但它的 `disabled` **只产出 `aria-disabled` + `tabIndex=-1`，
 * 不产出 DOM 的 `disabled` 属性** —— 属性白名单
 * （`react-native-web/dist/modules/forwardedProps`）里没有 `disabled`。
 * 而 `apps/web/tests/conflict-dialog.spec.tsx` 明确断言
 * `buttons.filter(b => b.hasAttribute('disabled'))` 恰好 1 个
 * （取不到对端那一侧的按钮必须真的禁用）。那份测试**不在本刀白名单**，
 * 也不该为了迁就让步。
 *
 * 所以：共享层负责**决定**（`model.ts` 的 `conflictBlockedReason` /
 * `preferredConflictSide`，以及下面的 `renderSideAction` 入参），
 * 按钮本体由宿主渲染 —— web 用 `ht-btn` / mobile 用 kit 的 `Button`。
 * 不传 `renderSideAction` 时退回下面那个共享 `Pressable` 版本，
 * 它没有 DOM `disabled` 语义，**只适合原生宿主**（那里 `disabled` 是 RN 属性）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 允许端差异的地方（逐条列出，别默默加）
 *
 *   · `renderSideAction` —— 见上，原生/DOM 对 `disabled` 的语义差。
 *   · `summaryLines` —— mobile 限制行数（411dp 宽，一处长备注会把整个界面
 *     撑成一条竖线）；web 不限制（宽屏，多写几行比截断好）。
 *   · `labels.position` —— 只有 mobile 有（位置提示词条 `mobile.conflict.position`）
 *     且目前**只有 mobile 传**；省略即不渲染。`labels.reason` 两端都传了
 *     （web 现在也从共享的 `common.conflict.reason.*` 取，见
 *     `ConflictDialog.tsx` 的文件头）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 宿主必须把它包在 `<HeytaUiProvider>` 之内（见 `SyncStatusBar.tsx` 文件头）
 *
 * ✅ 本组件**已登记进** `scripts/check-ui-provider.mjs` 的 `PROVIDER_DEPENDENT`
 * 清单（第四刀补丁补的）。宿主拆掉 `<HeytaUiProvider>` 会让那道门禁变红并
 * 指名道姓，不再依赖本地手工保证。
 */

import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Check, Monitor, Smartphone } from 'lucide';
import { HeytaIcon } from '../icon/Icon.js';
import { useHeytaText, useHeytaTokens } from '../theme.js';
import {
  conflictBlockedReason,
  conflictChoiceForSide,
  conflictSummaryStyle,
  preferredConflictSide,
  type ConflictBlockedReason,
  type ConflictChoice,
  type ConflictFreshness,
  type ConflictLike,
  type ConflictPayloadSummaryLike,
  type ConflictSideKind,
} from './model.js';

/**
 * 面板全部文案，**每一项都由宿主注入**。
 *
 * 函数而不是字符串的那几项：文案依赖行内容（实体名、字段数、时间），
 * 模板必须留在有 i18n 的那一侧。
 */
export interface ConflictResolutionLabels {
  /** 位置提示（「第 2 处，共 3 处」）。省略则不渲染。 */
  readonly position?: ((index: number, total: number) => string) | undefined;
  /** 实体名（「任务」「清单」…）。**必须给** —— 直接显示 `TASK` 是内部标识符泄漏。 */
  readonly entity: (entityType: string) => string;
  /**
   * 为什么这件事需要人来定。省略则不渲染。
   *
   * 入参是**已经归一过的冲突**；查表用什么码由 `model.conflictLookupCode`
   * 决定（`errorCode ?? reason`），宿主只需把结果喂给词条表。
   */
  readonly reason?: ((conflict: ConflictLike) => string) | undefined;
  /** 一侧的名字（「本机」/「其他设备」）。 */
  readonly side: (side: ConflictSideKind) => string;
  /** 「较新」的徽标文字。 */
  readonly newer: string;
  /** 取不到对端时的整句（「取不到这一侧的版本」）。**绝不留白**。 */
  readonly remoteUnavailable: string;
  /** 「保留这一版」。 */
  readonly keepThis: string;
  /** 载荷是空的时那句占位（「（空）」）。 */
  readonly emptyPayload: string;
  /** 载荷是结构化的、没有可读标题时：**只报数量**，不列字段名。 */
  readonly payloadFields: (count: number) => string;
  /** 某个选择为什么点不了。 */
  readonly blocked: (reason: ConflictBlockedReason) => string;
  /** 时间戳 → 可读时刻。格式属于宿主（语言、时区都不同）。 */
  readonly time: (ms: number) => string;
}

/** 交给 `renderSideAction` 的全部事实。宿主据此渲染一个按钮，**不再自己判断**。 */
export interface ConflictSideRenderInfo<T extends ConflictLike = ConflictLike> {
  /**
   * 这一侧的按钮属于**哪一处冲突**（清单里那个真对象）。
   *
   * 🔴 必须带上它：宿主点完要把原对象交回 `resolveConflict`，
   * 而那个对象里的 `opId` 决定"哪条本地改动被重新派发/丢弃"。
   * 拿视图模型去凑一个字段齐全但值是编的对象，会让解决**必然失败**
   * （移动端真机验收实测过：`getOpById('')` 取不到，报"本地那条改动已经不在队列里了"）。
   */
  readonly conflict: T;
  readonly side: ConflictSideKind;
  readonly choice: ConflictChoice;
  /** 这一侧真的存在吗。`false` → 按钮必须禁用（点了必然失败）。 */
  readonly available: boolean;
  readonly isNewer: boolean;
  /** 是否默认强调的一侧（= 较新的一侧；平手时两侧都 `false`）。 */
  readonly preferred: boolean;
  /** 为什么点不了。`undefined` = 可以点。 */
  readonly blockedReason: ConflictBlockedReason | undefined;
  /** 正在忙（同步中 / 上一处正在解决）—— 一切按钮在此期间都该禁用。 */
  readonly busy: boolean;
}

export interface ConflictResolutionViewProps<T extends ConflictLike> {
  /** 冲突清单。**传真实的 `ConflictInfo[]`** —— `onResolve` 会把它原样交回。 */
  readonly conflicts: readonly T[];
  readonly labels: ConflictResolutionLabels;
  /** 「谁较新」。传 `compareConflictFreshness` 的结果（唯一来源）。 */
  readonly freshnessOf: (conflict: T) => ConflictFreshness;
  /** 载荷摘要。传 `summarizeConflictPayload` 的结果（唯一来源）。 */
  readonly summarize: (payload: unknown) => ConflictPayloadSummaryLike;
  readonly busy?: boolean;
  /** 用户点了某一侧。回调收到的是**清单里那个真对象**（带着 `opId`）。 */
  readonly onResolve: (conflict: T, choice: ConflictChoice) => void;
  /**
   * 覆盖每一侧的按钮。给了就用它（web 需要真实 `<button disabled>`，
   * 见文件头）；不传则用下面那个共享 `Pressable` 版本。
   */
  readonly renderSideAction?: ((info: ConflictSideRenderInfo<T>) => React.ReactNode) | undefined;
  /** 摘要最多几行。省略 = 不限制（web）。mobile 传 3（见文件头）。 */
  readonly summaryLines?: number | undefined;
  readonly testID?: string;
}

/** 取一份 token 表建出这套样式。**一个裸值都没有**（`check:design` 会拦）。 */
function makeStyles(tokens: ReturnType<typeof useHeytaTokens>) {
  return StyleSheet.create({
    root: {
      gap: tokens['space.5'],
    },
    entry: {
      gap: tokens['space.2'],
    },
    /** 逐条之间的分隔线。第一条不要（它紧跟在外壳的说明文字后面）。 */
    entryHead: {
      borderTopWidth: tokens['border-width.thin'],
      borderTopColor: tokens['color.border-subtle'],
      paddingTop: tokens['space.3'],
    },
    /** 两侧并排。窄屏上也并排 —— 上下堆叠会让"对比"这件事消失。 */
    sides: {
      flexDirection: 'row',
      alignItems: 'stretch',
      gap: tokens['space.3'],
    },
    side: {
      flex: 1,
      // `minWidth: 0` 让长内容可以省略，而不是把另一侧挤没。
      minWidth: 0,
      gap: tokens['space.3'],
      padding: tokens['space.3'],
      borderWidth: tokens['border-width.thin'],
      borderRadius: tokens['radius.md'],
      backgroundColor: tokens['color.surface'],
    },
    sideHead: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: tokens['space.1'],
    },
    /** 「较新」徽标推到右端。 */
    newer: {
      marginLeft: 'auto',
    },
    /** 精选摘要是**用户自己的字**（或一句我们写的占位），要能换行。 */
    summary: {
      flexShrink: 1,
    },
    /** 取不到对端时那句 —— 斜体，与"对端什么都没写"在视觉上也要分开。 */
    unavailable: {
      fontStyle: 'italic',
    },
    /** 共享版按钮：主色 / 次色两态。 */
    action: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: tokens['space.2'],
      minHeight: tokens['touch-target.min'],
      paddingHorizontal: tokens['space.4'],
      borderRadius: tokens['radius.md'],
      borderWidth: tokens['border-width.thin'],
      /** 撑到底部，两侧的按钮对齐（内容长短不一时尤其明显）。 */
      marginTop: 'auto',
    },
  });
}

type ConflictStyles = ReturnType<typeof makeStyles>;

/** 摘要 → 该显示哪一句。三种 kind 各说各的，**空载荷与"取不到"绝不混**。 */
function summaryText(summary: ConflictPayloadSummaryLike, labels: ConflictResolutionLabels): string {
  const style = conflictSummaryStyle(summary);
  switch (style.kind) {
    case 'text':
      // 用户自己的字（标题、清单名…）—— 直接显示，不翻译。
      return style.text;
    case 'empty':
      return labels.emptyPayload;
    case 'fieldCount':
      return labels.payloadFields(style.count);
    default: {
      const never: never = style;
      return String(never);
    }
  }
}

export function ConflictResolutionView<T extends ConflictLike>({
  conflicts,
  labels,
  freshnessOf,
  summarize,
  busy,
  onResolve,
  renderSideAction,
  summaryLines,
  testID,
}: ConflictResolutionViewProps<T>): React.JSX.Element {
  const tokens = useHeytaTokens();
  const text = useHeytaText();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);
  const muted = tokens['color.foreground-muted'];

  return (
    <View style={styles.root} testID={testID}>
      {conflicts.map((conflict, index) => {
        const freshness = freshnessOf(conflict);

        // 头部三项都是可选的：哪一项没给就不渲染那一段，不塞空串进去
        // （否则会出现 `· · 任务` 这种一眼可见的坏排版）。
        const headParts = [
          labels.position?.(index, conflicts.length),
          labels.entity(conflict.entityType),
          labels.reason?.(conflict),
        ].filter((part): part is string => part !== undefined && part !== '');

        return (
          <View key={conflict.id} style={styles.entry}>
            {headParts.length === 0 ? null : (
              <Text
                style={[
                  text.caption,
                  { color: muted },
                  index === 0 ? null : styles.entryHead,
                ]}
              >
                {headParts.join(' · ')}
              </Text>
            )}

            <View style={styles.sides}>
              {(['local', 'remote'] as const).map((side) => (
                <ConflictSidePanel
                  key={side}
                  side={side}
                  conflict={conflict}
                  freshness={freshness}
                  labels={labels}
                  styles={styles}
                  summarize={summarize}
                  busy={busy === true}
                  summaryLines={summaryLines}
                  renderAction={renderSideAction}
                  onPress={(choice) => {
                    onResolve(conflict, choice);
                  }}
                />
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** 一侧的面板：名字 + 「较新」 + 内容 + 时间 + 按钮 + 为什么点不了。 */
function ConflictSidePanel<T extends ConflictLike>({
  side,
  conflict,
  freshness,
  labels,
  styles,
  summarize,
  busy,
  summaryLines,
  renderAction,
  onPress,
}: {
  readonly side: ConflictSideKind;
  readonly conflict: T;
  readonly freshness: ConflictFreshness;
  readonly labels: ConflictResolutionLabels;
  readonly styles: ConflictStyles;
  readonly summarize: (payload: unknown) => ConflictPayloadSummaryLike;
  readonly busy: boolean;
  readonly summaryLines: number | undefined;
  readonly renderAction: ((info: ConflictSideRenderInfo<T>) => React.ReactNode) | undefined;
  readonly onPress: (choice: ConflictChoice) => void;
}): React.JSX.Element {
  const tokens = useHeytaTokens();
  const text = useHeytaText();

  const raw = side === 'local' ? conflict.local : conflict.remote;
  const available = raw !== undefined;
  const choice = conflictChoiceForSide(side);
  const isNewer = side === 'local' ? freshness.localNewer : freshness.remoteNewer;
  // 默认强调哪边由 `model` 决定（平手/拿不到对端时两边都不强调）。
  const preferred = preferredConflictSide(freshness) === side;
  const blockedReason = conflictBlockedReason(available, choice);
  const info: ConflictSideRenderInfo<T> = {
    conflict,
    side,
    choice,
    available,
    isNewer,
    preferred,
    blockedReason,
    busy,
  };

  return (
    <View
      testID={`conflict-side-${side}`}
      style={[
        styles.side,
        // 较新的一侧用主色描边做视觉强调 —— 这只是帮用户建立直觉，
        // **不是裁决依据**（判定见 sync-client 的 compareConflictFreshness）。
        { borderColor: preferred ? tokens['color.primary'] : tokens['color.border'] },
      ]}
    >
      <View style={styles.sideHead}>
        <HeytaIcon
          data={side === 'local' ? Monitor : Smartphone}
          size={tokens['icon.xs']}
          color={tokens['color.foreground-muted']}
        />
        <Text style={[text.caption, { color: tokens['color.foreground-muted'] }]}>
          {labels.side(side)}
        </Text>
        {isNewer ? (
          <Text style={[text.caption, styles.newer, { color: tokens['color.primary'] }]}>
            {labels.newer}
          </Text>
        ) : null}
      </View>

      {raw === undefined ? (
        // 🔴 取不到对端版本时必须**明说**。
        // 显示成空白会让人以为"对端什么都没写"，从而做出相反的判断。
        <Text style={[text.caption, styles.unavailable, { color: tokens['color.foreground-muted'] }]}>
          {labels.remoteUnavailable}
        </Text>
      ) : (
        <>
          <Text
            testID={`conflict-summary-${side}`}
            numberOfLines={summaryLines}
            style={[text['row-title'], styles.summary, { color: tokens['color.foreground'] }]}
          >
            {summaryText(summarize(raw.payload), labels)}
          </Text>
          <Text
            testID={`conflict-time-${side}`}
            style={[text['numeric-body'], { color: tokens['color.foreground-subtle'] }]}
          >
            {labels.time(raw.timestamp)}
          </Text>
        </>
      )}

      {renderAction === undefined ? (
        <DefaultKeepButton
          info={info}
          label={labels.keepThis}
          styles={styles}
          onPress={() => {
            onPress(choice);
          }}
        />
      ) : (
        renderAction(info)
      )}

      {/* 只把按钮置灰不给理由，用户唯一能做的是反复点它。 */}
      {blockedReason === undefined ? null : (
        <Text style={[text.caption, { color: tokens['color.warning-strong'] }]}>
          {labels.blocked(blockedReason)}
        </Text>
      )}
    </View>
  );
}

/**
 * 共享版「保留这一版」。
 *
 * ⚠️ **只适合原生宿主**：RNW 下它的 `disabled` 只表现成 `aria-disabled`
 * （见文件头），而 web 的既有测试要求真实的 `disabled` 属性。
 * web 传 `renderSideAction` 自己渲染。
 */
function DefaultKeepButton({
  info,
  label,
  styles,
  onPress,
}: {
  readonly info: ConflictSideRenderInfo;
  readonly label: string;
  readonly styles: ConflictStyles;
  readonly onPress: () => void;
}): React.JSX.Element {
  const tokens = useHeytaTokens();
  const text = useHeytaText();
  const disabled = info.blockedReason !== undefined || info.busy;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID="conflict-keep"
      style={({ pressed }) => [
        styles.action,
        info.preferred
          ? {
              backgroundColor: tokens['color.primary'],
              borderColor: tokens['color.primary'],
            }
          : {
              backgroundColor: 'transparent',
              borderColor: tokens['color.border'],
            },
        pressed && !disabled ? { opacity: tokens['state.pressed-opacity'] } : null,
        disabled ? { opacity: tokens['state.disabled-opacity'] } : null,
      ]}
    >
      <HeytaIcon
        data={Check}
        size={tokens['icon.xs']}
        color={info.preferred ? tokens['color.on-primary'] : tokens['color.foreground']}
      />
      <Text
        style={[
          text.headline,
          { color: info.preferred ? tokens['color.on-primary'] : tokens['color.foreground'] },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}
