/**
 * `CommentThread` + `CommentComposer` —— 任务评论的**唯一一份**线程/编辑器。
 * =====================================================================
 *
 * 模型层：`comments-model.ts`（排序/过滤/校验/作者兜底）。
 * 文案由宿主 `t()` 解析后传入（labels）；本包不 import `@heyta/i18n`
 * （AuthForm / ShareConsentModal 同一条纪律）。
 *
 * 🔴 作者展示走 `commentAuthorFallbackVars` 的兜底（「成员 + id 前缀」）——
 * per-share 名片落地前**永不显示裸数字 id**。
 *
 * 🔴 编辑器**没有 `maxLength`**（NIST 禁止静默截断；同 `AuthForm` 的口令框）——
 * 超长由 `validateCommentDraft` 在提交前校验并给出错误句子，界面自己截掉是
 * 数据丢失。错误是文字（WCAG SC 3.3.1），`aria-live` 播报。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 文字层级（2026-10-16 补齐，同 `ShareConsentModal` 那一次的理由）
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 这里此前**一条文字样式都没有**：所有 `<Text>` 都走 RN 的默认色（**纯黑**，
 * 不是"继承容器色"）—— 暗色下就是近黑字压近黑底。所以按角色接语义样式：
 *
 * - 作者行 / 空线程提示 = `row-meta`；评论正文 = `row-title`；发送按钮 = `headline`
 * - 校验错误 = `caption` + **`color.danger`**：它是错误，不能只靠 `aria-live`
 *   表意（WCAG 1.4.1 不许只用颜色，反过来颜色也不该缺 —— 与 `EmptyState`
 *   的 `detailDanger` 同一条判据）。
 *
 * ⚠️ 错误那一条是本文件里唯一一处**显式覆盖**语义样式的默认色，
 * 覆盖用的仍是语义 token，不是裸值。
 */

import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { useHeytaText, useHeytaTokens } from '../theme.js';
import {
  commentAuthorFallbackVars,
  commentsForTask,
  validateCommentDraft,
  type CommentView,
} from './comments-model';

export interface CommentThreadLabels {
  emptyThread: string;
  fallbackAuthor: (id: string) => string;
  composerPlaceholder: string;
  sendButton: string;
  errorEmpty: string;
  errorTooLong: string;
}

export interface CommentThreadProps {
  taskId: string;
  comments: readonly CommentView[];
  labels: CommentThreadLabels;
  /** 宿主提交回调：模型校验通过后才会被调用（body 已 trim）。 */
  onSubmit: (body: string) => Promise<void> | void;
}

export function CommentThread(props: CommentThreadProps) {
  const text = useHeytaText();
  const tokens = useHeytaTokens();
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const thread = commentsForTask(props.comments, props.taskId);
  const draftError = validateCommentDraft(draft);

  const submit = async () => {
    if (draftError !== undefined || submitting) return;
    setSubmitting(true);
    try {
      await props.onSubmit(draft.trim());
      setDraft('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View testID="comment-thread">
      {thread.length === 0 && <Text style={text['row-meta']}>{props.labels.emptyThread}</Text>}
      {thread.map((c) => {
        const fallback = commentAuthorFallbackVars(c.authorUserId);
        return (
          <View key={c.id} testID={`comment-${c.id}`}>
            <Text style={text['row-meta']}>{props.labels.fallbackAuthor(fallback.vars.id)}</Text>
            <Text style={text['row-title']}>{c.body}</Text>
          </View>
        );
      })}
      <TextInput
        value={draft}
        onChangeText={setDraft}
        placeholder={props.labels.composerPlaceholder}
        accessibilityLabel={props.labels.composerPlaceholder}
        multiline
        testID="comment-composer-input"
      />
      {draftError !== undefined && (
        <Text
          accessibilityLiveRegion="polite"
          testID="comment-draft-error"
          style={[text['caption'], { color: tokens['color.danger'] }]}
        >
          {draftError === 'common.share.comment.empty' ? props.labels.errorEmpty : props.labels.errorTooLong}
        </Text>
      )}
      <Pressable
        onPress={() => { void submit(); }}
        accessibilityRole="button"
        testID="comment-send"
      >
        <Text style={text['headline']}>{props.labels.sendButton}</Text>
      </Pressable>
    </View>
  );
}
