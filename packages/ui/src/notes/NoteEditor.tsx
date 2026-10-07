/**
 * 便签编辑器（共享视图）
 * =======================
 *
 * **"改一张便签的正文"这件事只有这一个实现**，web 与移动端各自决定把它放在
 * 屏幕的哪里（web 是便签视图里的一段面板，移动端是「我的 → 便签」的二级全屏）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 为什么要有它（不是"少写点代码"）
 *
 * 便签是两端都要的功能，而"多行输入 + 保存 + 取消"是最容易各写一份的东西。
 * 各写一份之后最可能出现的行为差异是**一端点了保存会落一条什么都没改的 `UPD`**
 * —— `UPD` 推进 `updatedAt`，而 `updatedAt` 是列表排序的第二段，用户看到的
 * 就是"我只是点开看了一眼，这条便签跳到最前了"。那条闸门本身在
 * `@heyta/app-host#updateNoteContent`（写不写 op 是产品语义，AGENTS §3.5）；
 * 这一层保证的是**两端用的是同一个入口**，所以闸门只需要有一处、也只会被踩到一处。
 *
 * 🔴 组件里**没有业务规则**
 *
 * 什么算空正文、正文上限多少、op 该写哪些字段 —— 权威在
 * `@heyta/app-host#createNoteActions`（`noteRejection`）。这里只保留交互挡板：
 * 看起来是空的就不提交（{@link isNoteDraftBlank}，与 `NotesBoard` 的 composer
 * 同一个出处）。`onSave` 交回的仍是**原样草稿**，规范化（`trim()`）只在动作层做一次。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ 文案一律由宿主注入，本文件不 import `@heyta/i18n`
 *
 * 与 `NotesBoard` / `TaskList` 同一个理由：i18n 包自己带过一份 React，
 * 四端会同时中招（`check:mobile-bundle` 盯着）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 只用 RN 原语，不 import 任何 DOM 标签
 *
 * `multiline` 在 `react-native-web` 上就是 `<textarea>`，在 iOS/Android 上是原生
 * 多行输入；`<textarea>` 本身在 RN 上不存在。
 */

import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { HeytaNativeTokens } from '@heyta/design-system';
import { Check, X } from 'lucide';
import { HeytaIcon } from '../icon/Icon.js';
import { useHeytaText, useHeytaTokens } from '../theme.js';
import { isNoteDraftBlank } from './model.js';

/** 编辑器全部文案，**每一项都由宿主注入**。 */
export interface NoteEditorLabels {
  readonly placeholder: string;
  readonly save: string;
  readonly cancel: string;
}

export interface NoteEditorProps {
  /** 打开编辑器时这条便签的正文 —— 草稿初值。 */
  readonly initialContent: string;
  readonly labels: NoteEditorLabels;
  /**
   * 提交正文。**只在草稿非空时被调用**，参数是**原样草稿**（见文件头：不替宿主规范化）。
   * 写完要不要关由宿主决定 —— 组件不知道"关"在这个端意味着什么（一级面板 / 二级全屏）。
   */
  readonly onSave: (content: string) => void;
  /** 取消。 */
  readonly onCancel: () => void;
  /** 宿主写失败的原因。**必须由宿主传进来**：组件自己碰不到动作层。 */
  readonly error?: string | null;
  /**
   * 写入在途。**默认 `false` = 不挡**（消费者零改动）。
   *
   * 🔴 这一档不是装饰：`note-actions.ts` 文件头明写着"防连点两下保存是**界面**的事"，
   * 数据层的便签 id 是随机的、`UPD` 也不幂等 —— 连点两次会落两条 `UPD`。
   * 共享层挡一次，两端都不用各写一遍。
   */
  readonly busy?: boolean;
  readonly testID?: string;
}

/** 全部尺度都从 token 表推导：`check:design` 拦的就是这里的裸值。 */
function makeStyles(tokens: HeytaNativeTokens) {
  return StyleSheet.create({
    editor: {
      gap: tokens['space.2'],
    },
    field: {
      minHeight: tokens['touch-target.min'] * 4,
      paddingTop: tokens['space.2'],
      paddingHorizontal: tokens['size.field-padding-x'],
      borderRadius: tokens['radius.md'],
      backgroundColor: tokens['color.surface'],
      color: tokens['color.foreground'],
      textAlignVertical: 'top',
    },
    /**
     * 操作行：「取消」贴左、「保存」贴右 —— 与 `SearchScreen` 那个出口同一侧，
     * 也是移动端用户拇指最容易够到的两个角。
     */
    actions: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: tokens['space.2'],
    },
    button: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: tokens['space.1'],
      minHeight: tokens['touch-target.min'],
      paddingHorizontal: tokens['size.field-padding-x'],
      borderRadius: tokens['radius.md'],
    },
    cancelButton: {
      backgroundColor: 'transparent',
    },
    cancelText: {
      color: tokens['color.foreground'],
    },
    saveButton: {
      backgroundColor: tokens['color.primary'],
    },
    saveText: {
      color: tokens['color.on-primary'],
    },
    /** 空草稿时**仍然可见但置灰**（与 `NotesBoard` 的添加按钮同一条理由）。 */
    saveDisabled: {
      opacity: tokens['state.disabled-opacity'],
    },
    error: {
      color: tokens['color.danger'],
    },
  });
}

export function NoteEditor({
  initialContent,
  labels,
  onSave,
  onCancel,
  error = null,
  busy = false,
  testID,
}: NoteEditorProps): React.JSX.Element {
  const tokens = useHeytaTokens();
  const text = useHeytaText();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);
  const [draft, setDraft] = useState(initialContent);

  const blank = isNoteDraftBlank(draft);
  const canSubmit = !blank && !busy;

  function submit(): void {
    // 与按钮的 `disabled` 同一个判据：回车那条路不走 `disabled`，
    // 只灰按钮的话，空正文仍然会被"提交"一次。
    if (!canSubmit) return;
    onSave(draft);
  }

  return (
    <View style={styles.editor} testID={testID}>
      <TextInput
        style={[text['row-meta'], styles.field]}
        value={draft}
        placeholder={labels.placeholder}
        placeholderTextColor={tokens['color.foreground-subtle']}
        accessibilityLabel={labels.placeholder}
        onChangeText={setDraft}
        multiline
        textAlignVertical="top"
        testID={testID === undefined ? 'note-editor-input' : `${testID}-input`}
      />
      {error !== null && error !== '' ? (
        <Text style={[text.caption, styles.error]} selectable>
          {error}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={labels.cancel}
          aria-disabled={busy}
          disabled={busy}
          onPress={onCancel}
          style={[styles.button, styles.cancelButton]}
          testID={testID === undefined ? 'note-editor-cancel' : `${testID}-cancel`}
        >
          <HeytaIcon data={X} size={tokens['icon.xs']} color={tokens['color.foreground']} />
          <Text style={[text.caption, styles.cancelText]}>{labels.cancel}</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          // 「没改动」时念「关闭」而不是「保存」（见 `NoteEditorLabels.close`）。
          accessibilityLabel={labels.save}
          // 🔴 平铺 `aria-*`，不要用对象形态 `accessibilityState`：RNW 0.21 会把
          //    对象形态整个丢掉（判据见 `pnpm check:rn-aria`）。
          aria-disabled={!canSubmit}
          disabled={!canSubmit}
          onPress={submit}
          style={[styles.button, styles.saveButton, canSubmit ? null : styles.saveDisabled]}
          testID={testID === undefined ? 'note-editor-save' : `${testID}-save`}
        >
          <HeytaIcon
            data={Check}
            size={tokens['icon.xs']}
            color={tokens['color.on-primary']}
          />
          <Text style={[text.caption, styles.saveText]}>{labels.save}</Text>
        </Pressable>
      </View>
    </View>
  );
}
