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
 * 这里只做**取值与画图**：拿会话（baseUrl / token / accountId / vault 载荷密钥）、
 * 建一个 `createWebShareComments`、把重放出来的评论喂给组件。
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
import { CURRENT_SCHEMA_VERSION } from '@heyta/shared-schema';
import type { SyncPayloadCipher } from '@heyta/sync-client';
import { CommentThread, type CommentThreadLabels, type CommentThreadProps } from '@heyta/ui';

import { hasEngine, requireEngine } from '../../lib/oplog.js';
import { subscribeShareRepaint } from '../../lib/share-signal-sink.js';
import { getWebVaultSession } from '../../lib/vault-session.js';
import { useSyncStore } from '../sync/store.js';
import { createWebShareComments } from './comment-actions.js';

export interface ShareCommentsSectionProps {
  readonly taskId: string;
}

export function ShareCommentsSection(props: ShareCommentsSectionProps): React.JSX.Element | null {
  const { t } = useI18n();
  const baseUrl = useSyncStore((s) => s.baseUrl);
  const token = useSyncStore((s) => s.token);
  const authTransport = useSyncStore((s) => s.authTransport);
  const accountId = useSyncStore((s) => s.accountId);

  const [vaultCipher, setVaultCipher] = useState<SyncPayloadCipher | undefined>(undefined);
  /**
   * 这一节的"代"：写过内容、或本机刚拉到新内容 ⇒ 涨一格。
   *
   * 🔴 它同时是 `host` 的依赖 —— 因为宿主把**重放结果按实例缓存**
   * （`share-comments.ts` 的 `entryFor`：命中缓存就不再看盘）。不换代就会停在
   * 打开那一刻的样子：别人写的评论已经在 `localStorage` 里了，而这枚宿主不知道。
   */
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    if (
      accountId === undefined ||
      accountId === '' ||
      baseUrl.trim() === '' ||
      token === undefined ||
      token.trim() === ''
    ) {
      return undefined;
    }
    void (async () => {
      try {
        const session = await getWebVaultSession(accountId, baseUrl, async () => token, authTransport);
        const cipher = await session.getPayloadCipher();
        if (alive) setVaultCipher(cipher);
      } catch {
        // vault 没解锁：这一节不画（见文件头边界 2）。
      }
    })();
    return () => {
      alive = false;
    };
  }, [accountId, authTransport, baseUrl, token]);

  const host = useMemo(() => {
    if (vaultCipher === undefined || !hasEngine()) return undefined;
    return createWebShareComments({
      baseUrl,
      token: token ?? '',
      authTransport,
      userId: accountId ?? '',
      clientId: requireEngine().getClientId(),
      schemaVersion: CURRENT_SCHEMA_VERSION,
      vaultCipher,
      storage: window.localStorage,
    });
  }, [accountId, authTransport, baseUrl, token, vaultCipher, tick]);

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
   * 🔴 M5：进入这一节拉一次（冷启动那趟），之后**由信号驱动换代**，不再有 5 秒轮询。
   *
   * 为什么进来还要拉：这一节可能是在还没收到任何信号的时候打开的（离线写过、或在别的
   * 设备上刚写完）。这一趟之后，新内容一律走 `new_share_ops`（根组件那个唯一的消费者）。
   *
   * 为什么换代而不是"再拉一次"：下行游标是**这份 share 全局一份**，而根消费者已经把这批
   * op 拉回来落盘并推进了游标 —— 这里再拉只会拿到 `fetched = 0`，界面就停在打开那一刻。
   * 所以 `subscribeShareRepaint` 那条路是**从盘上重放**（换一枚宿主 = 缓存作废）。
   *
   * 拉失败**不炸界面也不写 console**：这一节本来就是尽力而为（未登录 / 钥匙没解锁
   * 都到不了这里，剩下的只有网络与服务端，而下一条信号会再试）。
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
