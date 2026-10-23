/**
 * 危险确认对话框（重档）
 * =====================
 *
 * 通用判据住在全局 Skill `overlay-feedback-patterns` →
 * `references/destructive-actions.md` §3「不可逆动作的界面义务」那八条。
 * 本组件负责其中**与内容有关的六条**，关闭相关的两条（禁 scrim / 禁 × / Esc=取消）
 * 由 `OverlayModal` + 策略表负责 —— 所以页面里没法把危险确认重新写成一个"点背景就关"的框。
 *
 * ## 档位从哪来
 *
 * 只接 `'alert' | 'typed-alert'`。类型层就挡住轻档：`resolveDangerTier()` 判成
 * `undo` 的动作**不该出现确认框**（那是把成本转嫁给每一次正常操作），
 * 判成 `popconfirm` 的该就地确认，也不该用这一层。
 * 宿主拿到 `DangerTier` 后要用 `requiresModalCommitment()` 收窄，别自己比字符串。
 *
 * ## 🔴 焦点落点：安全侧，不是"取消"这一格
 *
 * react-native-web 的 `ModalFocusTrap` 会把焦点交给**第一个可聚焦后代**
 * （`ModalFocusTrap.js:113`），而这一层里的可聚焦件顺序是：
 * 输入框（仅 `typed-alert`）→ 取消 → 危险主按钮。
 *
 * · `alert`：焦点落「取消」—— 满足"初始焦点在取消"。
 * · `typed-alert`：焦点落**名称输入框**。这不是违规：那一档的主按钮在逐字匹配前
 *   一直是禁用态，键盘用户按回车什么都不会发生；把焦点强按到"取消"反而要
 *   额外抢一次焦点（RN 上没有稳定的 autofocus 通道）。
 *   这一条在 e2e 里核（本包是 node 环境，不渲染组件）。
 *
 * ## 执行中不给假反馈
 *
 * `busy` 时主按钮进 loading 且禁用；完成后的回执由宿主发（撤销窗口从那之后才开始计时）。
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useHeytaText, useHeytaTokens, useHeytaUiTheme } from '../theme.js';
import { OverlayModal } from './OverlayModal.js';

/** 只有这两档用这一层（判据由 `@heyta/domain` 的 `resolveDangerTier` 给出）。 */
export type DangerConfirmTier = 'alert' | 'typed-alert';

/** 文案全部由宿主注入 —— 共享层不 import i18n。 */
export interface DangerDialogLabels {
  /** 取消（安全侧）。 */
  readonly cancel: string;
  /** 🔴 主按钮必须**复述动词与范围**：`永久删除 12 条`。禁「确定」「OK」「是」。 */
  readonly confirm: string;
  /** `impact` 清单的标题（「这 12 条会被删除」）。给了清单就必须给。 */
  readonly impactHeading?: string;
  /** `typed-alert` 必填：告诉用户要逐字键入什么。 */
  readonly confirmPhrasePrompt?: string;
  /** 名称输入框的无障碍名（`typed-alert` 必填）。 */
  readonly confirmPhraseField?: string;
}

interface DangerDialogBaseProps {
  readonly visible: boolean;
  /** 标题写**后果**（「永久删除这 12 条凭证？」），不写动作名（「删除确认」）。 */
  readonly title: string;
  /** 正文写范围与不可逆性：条数、影响的工作区、能不能恢复、恢复要找谁。 */
  readonly body?: string;
  /** 「哪些会被影响」的清单，直接摊开显示，不让用户自己去列表里数。 */
  readonly impact?: readonly string[];
  readonly labels: DangerDialogLabels;
  readonly busy?: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly testID?: string;
}

/**
 * 两档的差别做成可判别联合：`typed-alert` **必须**给 `confirmPhrase`。
 * 少了它，"删掉整个账号"就会退化成普通确认框 —— 那是这一档存在的唯一理由。
 */
export type DangerDialogProps =
  | (DangerDialogBaseProps & { readonly tier: 'alert'; readonly confirmPhrase?: undefined })
  | (DangerDialogBaseProps & { readonly tier: 'typed-alert'; readonly confirmPhrase: string });

export function DangerDialog({
  visible,
  tier,
  title,
  body,
  impact,
  labels,
  busy = false,
  onCancel,
  onConfirm,
  confirmPhrase,
  testID = 'heyta-danger-dialog',
}: DangerDialogProps): React.JSX.Element {
  const theme = useHeytaUiTheme();
  const tokens = useHeytaTokens();
  const text = useHeytaText();
  const [typed, setTyped] = useState('');

  // 🔴 关掉之后清空已键入的名称：否则第二次打开这个框时，
  // 主按钮直接就是可点的"上一次那个名字"，输入名称这道闸门等于没装。
  useEffect(() => {
    if (!visible) setTyped('');
  }, [visible]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        content: { gap: tokens['space.3'] },
        body: { ...text['row-title'], color: tokens['color.foreground-muted'] },
        impact: { gap: tokens['space.2'] },
        impactHeading: { ...text['group-label'], color: tokens['color.foreground-subtle'] },
        impactRow: { flexDirection: 'row', gap: tokens['space.2'] },
        impactMarker: { ...text['row-title'], color: tokens['color.foreground-subtle'] },
        impactItem: { ...text['row-title'], color: tokens['color.foreground'], flex: 1 },
        prompt: { ...text['caption'], color: tokens['color.foreground-muted'] },
        phraseField: {
          ...text['row-title'],
          color: tokens['color.foreground'],
          borderWidth: tokens['border-width.thin'],
          borderColor: tokens['color.border-strong'],
          borderRadius: tokens['radius.md'],
          padding: tokens['space.3'],
          minHeight: tokens['touch-target.min'],
          backgroundColor: tokens['color.surface'],
        },
        actions: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: tokens['space.3'],
        },
        action: {
          flex: 1,
          minHeight: tokens['touch-target.min'],
          paddingHorizontal: tokens['space.4'],
          borderRadius: tokens['radius.md'],
          alignItems: 'center',
          justifyContent: 'center',
          gap: tokens['space.2'],
          flexDirection: 'row',
        },
        cancel: {
          borderWidth: tokens['border-width.thin'],
          borderColor: tokens['color.border-strong'],
          backgroundColor: tokens['color.surface'],
        },
        cancelText: { ...text['row-title'], color: tokens['color.foreground'] },
        // 🔴 tone 的配色口径**抄 `apps/mobile/src/ui/kit.tsx:750` 的 danger 那一格**：
        // `color.danger` 底 + `color.foreground-inverse` 字。那两枚名字是踩过的坑
        // （`color.danger-foreground` 表里没有，编出来就是看不见字的按钮）。
        // 禁用态同理用 `state.disabled-opacity`（`kit.tsx:753`），不另配一套灰底灰字。
        danger: { backgroundColor: tokens['color.danger'] },
        dangerText: { ...text['row-title'], color: tokens['color.foreground-inverse'] },
        disabled: { opacity: tokens['state.disabled-opacity'] },
        pressed: { opacity: 0.72 },
      }),
    [text, theme, tokens],
  );

  // `typed-alert` 且没给名称 → 闸门必须**关着**。
  const phraseRequired = tier === 'typed-alert' ? confirmPhrase : undefined;
  const phraseMatched = phraseRequired === undefined || typed.trim() === phraseRequired;
  const confirmDisabled = busy || !phraseMatched;

  return (
    <OverlayModal
      visible={visible}
      overlay="danger-confirm"
      title={title}
      labels={{ close: labels.cancel }}
      onDismiss={onCancel}
      testID={testID}
      footer={(
        <View style={styles.actions}>
          {/* 取消在前：可聚焦顺序 = 焦点落点，危险动作永远是最后一个。 */}
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={onCancel}
            style={({ pressed }) => [styles.action, styles.cancel, pressed ? styles.pressed : null]}
            testID={`${testID}-cancel`}
          >
            <Text style={styles.cancelText}>{labels.cancel}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            aria-disabled={confirmDisabled}
            disabled={confirmDisabled}
            onPress={onConfirm}
            style={({ pressed }) => [
              styles.action,
              styles.danger,
              confirmDisabled ? styles.disabled : null,
              pressed && !confirmDisabled && !theme.reducedMotion ? styles.pressed : null,
            ]}
            testID={`${testID}-confirm`}
          >
            {busy ? <ActivityIndicator size="small" color={tokens['color.foreground-inverse']} /> : null}
            <Text style={styles.dangerText}>
              {labels.confirm}
            </Text>
          </Pressable>
        </View>
      )}
    >
      <View style={styles.content}>
        {body !== undefined ? <Text style={styles.body}>{body}</Text> : null}
        {impact !== undefined && impact.length > 0 ? (
          <View style={styles.impact}>
            {labels.impactHeading !== undefined ? (
              <Text style={styles.impactHeading}>{labels.impactHeading}</Text>
            ) : null}
            {impact.map((item, index) => (
              <View key={`${testID}-impact-${String(index)}`} style={styles.impactRow}>
                <Text accessibilityElementsHidden style={styles.impactMarker}>
                  •
                </Text>
                <Text style={styles.impactItem}>{item}</Text>
              </View>
            ))}
          </View>
        ) : null}
        {phraseRequired !== undefined ? (
          <View style={styles.impact}>
            <Text style={styles.prompt}>{labels.confirmPhrasePrompt ?? phraseRequired}</Text>
            <TextInput
              // 🔴 不挂 `onSubmitEditing`：这一档的键盘"完成"键如果能把主按钮按下，
              // 就又是"回车即删"的形状（Skill 不变量一：任何通道都不得触发确认）。
              accessibilityLabel={labels.confirmPhraseField ?? phraseRequired}
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setTyped}
              placeholder={phraseRequired}
              spellCheck={false}
              style={styles.phraseField}
              testID={`${testID}-phrase`}
              value={typed}
            />
          </View>
        ) : null}
      </View>
    </OverlayModal>
  );
}
