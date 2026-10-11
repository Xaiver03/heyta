/**
 * `ShareConsentModal` —— PIPL 23 单独同意的模态（方案 a，见
 * `share-consent-model.ts`；条款清单 `SHARE_CONSENT_SCOPE_KEYS`）。
 *
 * 🔴 文案由宿主 `t()` 解析后传入（`labels`）；本包不 import `@heyta/i18n`。
 * 「确认」把 `accepted/dontAskAgain` 交回宿主落盘（模型 `applyShareConsent`
 * 负责状态）；「取消」原样返回 `accepted: false`——取消不是同意。
 *
 * 无障碍：模态角色 + 标题关联（`accessibilityLabelledBy` 平铺写法）；
 * 复选框是真 `Pressable` + 平铺 `aria-checked`（`rn-aria` 纪律，同 `AuthForm`）。
 *
 * ## 视觉层级（2026-10-11 按最佳实践定稿，不是"补样式"）
 *
 * 这一层此前**一条样式都没有**：控件都是能用、能读的真 `Pressable`，但三行同意范围
 * 与两个按钮在视觉上等权 —— 同意面读起来像一段裸文本加两颗一样的按钮。PIPL 要的
 * "单独同意"最忌的就是这个形状（默认路径与拒绝路径看不出差别）。所以：
 *
 * - **范围清单是一块披露面**，不是三个 `·` 行：单独一格凹陷底色（`surface-sunken`），
 *   正文级字号。它是同意的**内容**，不该比说明文字小一档。
 * - **只有一颗按钮是强调的**：「确认共享」实心主蓝（`AuthForm` 的 `primary` 同一套
 *   token 与按压写法），「取消」走 `ghost` 文字按钮。等权的两个按钮会把"拒绝"
 *   画成"另一个主操作"。
 * - **勾选框必须看得见是个勾选框**（方框 + 选中态实色 + `Check` 图标），
 *   而且**不靠颜色单独表意**：`aria-checked` 与图标同时携带状态。默认不勾。
 * - **命中区吃 `touch-target.min`**，按钮与勾选行都不低于 44。
 *
 * `titleHidden`：宿主的对话框自己已经有同一句标题时（web 的 `share-dialog` 顶部
 * `<h2>共享清单</h2>` 与这里的 `common.share.consent.title` 是**同一句话**）由宿主
 * 置真，避免同屏出现两个同名标题。默认假 —— 没有外层标题的宿主（移动端弹层）
 * 仍然要这句。
 */

import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Check } from 'lucide';

import { HeytaIcon } from '../icon/Icon.js';
import { useHeytaText, useHeytaTokens } from '../theme.js';
import { SHARE_CONSENT_SCOPE_KEYS, applyShareConsent, type ShareConsentStore } from './share-consent-model';

export interface ShareConsentModalLabels {
  title: string;
  body: string;
  scopes: readonly string[];
  dontAskAgain: string;
  accept: string;
  cancel: string;
}

export interface ShareConsentModalProps {
  labels: ShareConsentModalLabels;
  store: ShareConsentStore;
  /** 宿主的偏好落盘（本地）——模型算出的下一状态交回宿主持久化。 */
  onConsent: (next: ShareConsentStore) => void;
  /** 用户确认共享：宿主继续走"创建共享"的后续动作。 */
  onProceed: () => void;
  onCancel: () => void;
  /** 外层已经写着同一句标题时置真（见文件头）。省略 = 渲染这句。 */
  titleHidden?: boolean;
}

export function ShareConsentModal(props: ShareConsentModalProps) {
  const tokens = useHeytaTokens();
  const text = useHeytaText();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);
  const [dontAskAgain, setDontAskAgain] = useState(false);
  const decide = (accepted: boolean) => {
    const result = applyShareConsent(props.store, {
      accepted,
      dontAskAgain,
      now: Date.now(),
    });
    props.onConsent(result.store);
    if (result.proceed) props.onProceed();
    else props.onCancel();
  };

  return (
    <View
      accessibilityRole="none"
      accessibilityLabel={props.titleHidden ? undefined : props.labels.title}
      testID="share-consent-modal"
      style={styles.root}
    >
      {props.titleHidden ? null : (
        <Text
          accessibilityRole="header"
          style={[text['headline'], { color: tokens['color.foreground'] }]}
        >
          {props.labels.title}
        </Text>
      )}

      <Text style={[text['row-title'], { color: tokens['color.foreground'] }]}>{props.labels.body}</Text>

      {/* 同意的**内容**：单独一块披露面，逐条一行，正文级字号。 */}
      <View style={styles.scopes} testID="share-consent-scopes">
        {SHARE_CONSENT_SCOPE_KEYS.map((scopeKey, index) => {
          const line = props.labels.scopes[index];
          if (line === undefined) return null;
          return (
            <View key={scopeKey} style={styles.scopeRow}>
              <View style={styles.scopeMarker} />
              <Text style={[text['row-title'], styles.scopeText]}>{line}</Text>
            </View>
          );
        })}
      </View>

      <Pressable
        onPress={() => setDontAskAgain((v) => !v)}
        aria-checked={dontAskAgain}
        accessibilityRole="checkbox"
        testID="share-consent-dont-ask"
        style={({ pressed }) => [styles.termsRow, pressed ? styles.pressed : null]}
      >
        <View style={[styles.checkbox, dontAskAgain ? styles.checkboxOn : null]}>
          {dontAskAgain ? (
            <HeytaIcon data={Check} size={tokens['icon.xs']} color={tokens['color.on-primary']} />
          ) : null}
        </View>
        <Text style={[text['caption'], styles.termsText]}>{props.labels.dontAskAgain}</Text>
      </Pressable>

      {/* 两个动作**不等权**：确认是实心主按钮，取消是文字按钮。 */}
      <View style={styles.actions}>
        <Pressable
          onPress={() => decide(false)}
          accessibilityRole="button"
          testID="share-consent-cancel"
          style={({ pressed }) => [styles.ghost, pressed ? styles.pressed : null]}
        >
          <Text style={[text['headline'], styles.ghostText]}>{props.labels.cancel}</Text>
        </Pressable>
        <Pressable
          onPress={() => decide(true)}
          accessibilityRole="button"
          testID="share-consent-accept"
          style={({ pressed }) => [styles.primary, pressed ? styles.primaryPressed : null]}
        >
          <Text style={[text['headline'], styles.primaryLabel]}>{props.labels.accept}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** 取一份 token 表建出这套样式。**一个裸值都没有**（`check:design` 会拦）。 */
function makeStyles(tokens: ReturnType<typeof useHeytaTokens>) {
  return StyleSheet.create({
    root: {
      gap: tokens['space.3'],
    },
    scopes: {
      gap: tokens['space.2'],
      padding: tokens['space.4'],
      borderRadius: tokens['radius.md'],
      // 🔴 刻意**不描边**：`surface-sunken` 与它自己的描边候选（`border-subtle` = 同一个
      // slate-100、`border` = slate-200）实测对比只有 1.0–1.13，画上去是一道看不见的线，
      // 比不画更容易被读成"渲染坏了"。这块面靠**底色凹陷**与外部分隔。
      backgroundColor: tokens['color.surface-sunken'],
    },
    scopeRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: tokens['space.2'],
    },
    /** 项目符号用图形色（3:1 就够），文字一律走 `foreground`。 */
    scopeMarker: {
      marginTop: tokens['space.2'],
      width: tokens['size.badge-dot'],
      height: tokens['size.badge-dot'],
      borderRadius: tokens['radius.full'],
      backgroundColor: tokens['color.foreground-subtle'],
    },
    scopeText: {
      flex: 1,
      color: tokens['color.foreground'],
    },
    termsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: tokens['space.2'],
      minHeight: tokens['touch-target.min'],
    },
    checkbox: {
      width: tokens['size.checkbox'],
      height: tokens['size.checkbox'],
      borderRadius: tokens['radius.sm'],
      borderWidth: tokens['border-width.thin'],
      borderColor: tokens['color.border'],
      backgroundColor: tokens['color.background'],
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkboxOn: {
      backgroundColor: tokens['color.primary'],
      borderColor: tokens['color.primary'],
    },
    termsText: {
      flex: 1,
      color: tokens['color.foreground-muted'],
    },
    actions: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: tokens['space.2'],
    },
    primary: {
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: tokens['touch-target.min'],
      paddingHorizontal: tokens['space.4'],
      borderRadius: tokens['radius.md'],
      backgroundColor: tokens['color.primary'],
    },
    primaryPressed: {
      // 与 `AuthForm.primaryPressed` 同一个理由：实心主按钮用透明度按下去像"变淡了"，
      // 而实心感正是它的可点性提示。
      backgroundColor: tokens['color.primary-active'],
    },
    primaryLabel: {
      color: tokens['color.on-primary'],
    },
    ghost: {
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: tokens['touch-target.min'],
      paddingHorizontal: tokens['space.3'],
      borderRadius: tokens['radius.md'],
    },
    ghostText: {
      color: tokens['color.foreground'],
    },
    pressed: {
      // 扁平风格用**底色**表达按压，不用阴影（AGENTS §5：阴影只给真正的浮层）。
      backgroundColor: tokens['color.surface-sunken'],
    },
  });
}
