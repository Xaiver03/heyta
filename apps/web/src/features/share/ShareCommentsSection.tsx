/**
 * 任务详情栏里的**评论区**（ADR-0062 W4 的第一块）。
 * =========================================================================
 *
 * 这一节存在的理由只有一个：`check:reachability` 的断言 C 回答的是
 * 「宿主调用得到」（端壳里有没有真的构造评论动作），而**用户点得到**要另一步 ——
 * 把 `@heyta/ui` 的 `CommentThread` 真渲染出去。全仓在此之前 0 处渲染它。
 *
 * 三件事**不在这里**（都在 `@heyta/app-host`）：路由（这条清单是不是共享的）、
 * 什么条件下才发（未登录 / 密钥未解锁 ⇒ 零请求）、发完怎么落本地。
 * 这里只做**取值与画图**：问 `share-session.ts` 要那一份共享实例（这台会话里只有一份），
 * 把重放出来的评论喂给组件。
 *
 * ⚠️ 两处如实登记的边界：
 * 1. **远端的评论靠推不靠轮询**（M5）：WS 的 `new_share_ops` 由根组件那一个消费者拉回
 *    并落盘，这一节收到"重画"信号后**从盘上重放**（见下面换代那段 —— 它不能再拉一次，
 *    游标已经被推进）。进入这一节时仍拉一次，那是冷启动补第一屏。
 * 2. **vault 未解锁就整节不画**（不是错误屏）：没解锁时连 keyEpoch 都解不出来，
 *    画一个"发不出去"的输入框只会让人以为坏了。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { COMMENT_MAX_LENGTH } from '@heyta/domain';
import { useI18n } from '@heyta/i18n';
import { CommentThread, type CommentThreadLabels, type CommentThreadProps } from '@heyta/ui';

import { subscribeShareRepaint } from '../../lib/share-signal-sink.js';
import { type WebShareComments } from './comment-actions.js';
import { ensureWebShareSession, webShareSession } from './share-session.js';

export interface ShareCommentsSectionProps {
  readonly taskId: string;
}

export function ShareCommentsSection(props: ShareCommentsSectionProps): React.JSX.Element | null {
  const { t } = useI18n();

  /*
   * 这一节的"代"：写过内容、或本机刚拉到新内容 ⇒ 涨一格。
   *
   * 🔴 它**不再**决定宿主是谁：M2 起这一台会话里只有一份共享实例（`share-session.ts`），
   * 评论区与 M5 信号消费者读同一份缓存。这里要做的只是"重画一次"——
   * 从那份缓存里重读，而不是重建宿主（重建会把上一次的缓存丢掉、再从盘上整条重放）。
   */
  const [tick, setTick] = useState(0);
  const [host, setHost] = useState<WebShareComments | undefined>(() => webShareSession());

  useEffect(() => {
    let alive = true;
    void ensureWebShareSession()
      .then((session) => {
        if (alive) setHost(session);
      })
      .catch(() => {
        // 接不上（没登录 / vault 没解锁）⇒ 整节不画，与下面 `host === undefined` 同一形状。
        if (alive) setHost(undefined);
      });
    return () => {
      alive = false;
    };
    // `tick` 也进依赖：解锁发生在用户点开这一节之后，重进一次才有机会拿到密钥。
  }, [tick]);

  const labels = useMemo<CommentThreadLabels>(
    () => ({
      emptyThread: t('common.share.comment.emptyThread'),
      fallbackAuthor: (id: string) => t('common.share.comment.fallbackAuthor', { id }),
      composerPlaceholder: t('common.share.comment.composerPlaceholder'),
      sendButton: t('common.share.comment.send'),
      errorEmpty: t('common.share.comment.empty'),
      errorTooLong: t('common.share.comment.tooLong', { max: COMMENT_MAX_LENGTH }),
    }),
    [t],
  );

  const onSubmit = useCallback(
    async (body: string): Promise<void> => {
      if (host === undefined) return;
      await host.actions.addComment(props.taskId, body);
      setTick((n) => n + 1);
    },
    [host, props.taskId],
  );

  /*
   * 🔴 M5：进入这一节拉一次（冷启动那趟），之后**由信号驱动重画**，不再有 5 秒轮询。
   *
   * 为什么进来还要拉：这一节可能是在还没收到任何信号的时候打开的（离线写过、或在别的
   * 设备上刚写完）。这一趟之后，新内容一律走 `new_share_ops`（根组件那个唯一的消费者）。
   *
   * 为什么重画而不是"再拉一次"：下行游标是**这份 share 全局一份**，而根消费者已经把这批
   * op 拉回来落盘并推进了游标 —— 这里再拉只会拿到 `fetched = 0`。
   *
   * ⚠️ 拉回来的内容落进的是**那一份共享实例**，所以拉到新内容时 `comment-actions.ts`
   * 会敲一次 `emitEngineChange()`；这一节自己的 `setTick` 只是让它也重读一遍。
   */
  useEffect(() => {
    if (host === undefined) return undefined;
    let alive = true;
    void host
      .pullForTask(props.taskId)
      .then((result) => {
        if (alive && (result?.added ?? 0) > 0) setTick((n) => n + 1);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [host, props.taskId]);

  useEffect(() => subscribeShareRepaint(() => setTick((n) => n + 1)), []);

  if (host === undefined) return null;
  const comments = host.commentsForTask(props.taskId) as unknown as CommentThreadProps['comments'];

  return <CommentThread taskId={props.taskId} comments={comments} labels={labels} onSubmit={onSubmit} />;
}
