/**
 * 本周小结（复制为纯文本）（共享视图，L3）
 * ==========================================
 *
 * 「把这一周说给别人听 / 记到别处」的出口。这是 web **独有**的能力：
 * `apps/web/src/features/motivation/GrowthView.tsx` 的 `ShareSection` 有它，
 * mobile 迁移前没有。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 复制的是**纯文本**，不是图片
 *
 * 出图要引 canvas / 字体 / 排版三套东西，换来的传播收益在这个阶段无法验证
 * （E2EE 下我们也拿不到任何回传数据）。纯文本能被粘进任意对话、笔记、待办 ——
 * 而且它**不携带任何标识符**，用户不会因为分享一次就泄露自己在用哪个应用、
 * 哪台设备。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 小结的内容**不在共享层拼**
 *
 * `web/src/features/motivation/copy.ts#buildShareSummary` 用 `t()` 拼多行文本
 * （句子里含量词与语序），它必须有 i18n —— 而共享层不能 import `@heyta/i18n`。
 * 所以这里只收**已经拼好的** `summary: string`，共享层负责的是另外两件事：
 *
 *   1. 状态机（`idle` / `copied` / `failed`）与 2 秒复位；
 *   2. 剪贴板失败**必须说出来** —— `navigator.clipboard` 在非安全上下文
 *      （http 访问局域网地址）里是 `undefined`，而"点了没反应"会被读成
 *      "按钮坏了"。这是 web 迁移前 `ShareSection` 的注释原文。
 *
 * 🔴 **剪贴板 API 由宿主注入**（`onCopy`）：`navigator.clipboard` 在 iOS 上
 * 不存在，RN 侧要用 `Clipboard` / `expo-clipboard` —— 那是宿主的平台差异，
 * 共享层不认识它。本组件只保证"无论成功失败都看得见结果"。
 *
 * 🔴 文案一律由宿主注入（理由见 `TodayProgressCard`）；本文件不 import `@heyta/i18n`
 * 🔴 只用 RN 原语（`View` / `Text` / `Pressable` / `StyleSheet`）
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { HeytaNativeTokens } from '@heyta/design-system';
import { Copy } from 'lucide';
import { HeytaIcon } from '../icon/Icon.js';
import { useHeytaText, useHeytaTokens } from '../theme.js';
import { SHARE_RESET_MS, type ShareState } from './model.js';

/** 面板全部文案，**每一项都由宿主注入**（见文件头）。 */
export interface ShareSummaryLabels {
  /** 按钮上的字（"复制本周小结"）。 */
  readonly copy: string;
  /** 复制成功后的结果句（读屏也会念）。 */
  readonly copied: string;
  /** 复制失败后的结果句。**必须存在** —— 见文件头。 */
  readonly failed: string;
}

export interface ShareSummarySectionProps {
  /** 已经由宿主拼好的纯文本（见文件头）。 */
  readonly summary: string;
  /**
   * 真正执行复制。**成功 = resolve，失败 = reject**（不要自己吞掉异常：
   * 这个组件靠它区分 `copied` / `failed`）。
   */
  readonly onCopy: () => Promise<void>;
  readonly labels: ShareSummaryLabels;
  /** 结果句停留多久后复位。省略 = {@link SHARE_RESET_MS}。 */
  readonly resetDelayMs?: number;
  readonly testID?: string;
}

/** 取一份 token 表，建出这套样式。**一个裸值都没有**（`check:design` 会拦）。 */
function makeStyles(tokens: HeytaNativeTokens) {
  return StyleSheet.create({
    section: {
      gap: tokens['space.2'],
    },
    copyButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: tokens['space.1'],
      minHeight: tokens['touch-target.min'],
      paddingHorizontal: tokens['space.3'],
      borderRadius: tokens['radius.md'],
      backgroundColor: tokens['color.primary'],
      alignSelf: 'flex-start',
    },
    copyText: {
      color: tokens['color.on-primary'],
    },
    preview: {
      paddingVertical: tokens['space.2'],
      paddingHorizontal: tokens['space.3'],
      borderRadius: tokens['radius.md'],
      backgroundColor: tokens['color.surface-sunken'],
      color: tokens['color.foreground-muted'],
    },
  });
}

export function ShareSummarySection({
  summary,
  onCopy,
  labels,
  resetDelayMs = SHARE_RESET_MS,
  testID,
}: ShareSummarySectionProps): React.JSX.Element {
  const tokens = useHeytaTokens();
  const text = useHeytaText();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);
  const [state, setState] = useState<ShareState>('idle');
  /**
   * 复位定时器。**必须在卸载时清掉** —— 否则用户复制完立刻离开这一屏，
   * 2 秒后定时器回调会对一个已卸载的组件 `setState`（React 会警告，
   * 而 RN 上这类泄漏只在特定导航路径下才复现，很难查）。
   */
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(
    () => () => {
      if (timer.current !== undefined) clearTimeout(timer.current);
    },
    [],
  );

  async function copy(): Promise<void> {
    try {
      await onCopy();
      setState('copied');
    } catch {
      setState('failed');
    }
    // 复位到常态，避免"已复制"永久停在那里看起来像状态卡住了。
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setState('idle');
    }, resetDelayMs);
  }

  return (
    <View style={styles.section} testID={testID}>
      <Text
        numberOfLines={3}
        ellipsizeMode="tail"
        style={[text.caption, styles.preview]}
        testID={testID === undefined ? undefined : `${testID}-preview`}
      >
        {summary}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={labels.copy}
        /*
          ⚠️ `summary` 只作为**无障碍提示**用，不做可见渲染。
          共享层不排版一段多行文本（换行、缩进是宿主排版的事），而 web 迁移前
          也没有预览 —— 加预览是产品改动，不是这次迁移该顺手做的事。
          · 最小一步：给它加一个 `numberOfLines={3}` 的预览块（mobile 上尤其
            有价值：剪贴板没有可见结果），两端各出一条截图验收。
        */
        accessibilityHint={summary}
        onPress={() => {
          void copy();
        }}
        style={styles.copyButton}
        testID={testID === undefined ? undefined : `${testID}-copy`}
      >
        <HeytaIcon data={Copy} size={tokens['font-size.sm']} color={tokens['color.on-primary']} />
        <Text style={[text.caption, styles.copyText]}>{labels.copy}</Text>
      </Pressable>

      {/*
        `accessibilityLiveRegion`：复制是"点下去之后什么都没发生"的典型操作，
        必须有一句能被读屏读到的结果（web 迁移前用的是 `aria-live="polite"`）。
      */}
      <Text
        style={[text.caption, { color: tokens['color.foreground-muted'] }]}
        accessibilityLiveRegion="polite"
        testID={testID === undefined ? undefined : `${testID}-state`}
      >
        {state === 'copied' ? labels.copied : null}
        {state === 'failed' ? labels.failed : null}
      </Text>
    </View>
  );
}
