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
 */

import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

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
      {thread.length === 0 && <Text>{props.labels.emptyThread}</Text>}
      {thread.map((c) => {
        const fallback = commentAuthorFallbackVars(c.authorUserId);
        return (
          <View key={c.id} testID={`comment-${c.id}`}>
            <Text>{props.labels.fallbackAuthor(fallback.vars.id)}</Text>
            <Text>{c.body}</Text>
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
        <Text accessibilityLiveRegion="polite" testID="comment-draft-error">
          {draftError === 'common.share.comment.empty' ? props.labels.errorEmpty : props.labels.errorTooLong}
        </Text>
      )}
      <Pressable
        onPress={() => { void submit(); }}
        accessibilityRole="button"
        testID="comment-send"
      >
        <Text>{props.labels.sendButton}</Text>
      </Pressable>
    </View>
  );
}
