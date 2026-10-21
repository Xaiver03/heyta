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
 * 1. **远端的评论靠拉，不靠推**（M1）：进入这一节拉一次、之后每 5s 补一次。
 *    真推（WS `new_share_ops`）在 M5 那一格，接上之后这个定时器就该撤。
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
  /** 提交后重读一次（本片没有实时订阅，见文件头边界 1）。 */
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
  }, [accountId, authTransport, baseUrl, token, vaultCipher]);

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
   * 🔴 M1 下行：进入这一节先拉一次，之后每 5s 补一次。
   *
   * 为什么要有这个定时器：别人写的评论**不会自己飘过来** —— 拉取（`pullForTask`）
   * 之前这一节只能显示本机写过的那几条，症状正是这条线断掉的那一格。
   * ⚠️ 它是"还没有信号时的兜底"，不是设计目标：WS `new_share_ops` 接上之后（M5）
   *    这个定时器就该撤掉，改成"收到信号 ⇒ 拉一次"。
   *
   * 只有真的拉到新 op 才触发重渲染（`added > 0`）—— 每 5 秒无谓重画一次评论线程，
   * 会让正在输入的那个人看到光标跳。
   * 拉失败**不炸界面也不写 console**：这一节本来就是尽力而为（未登录 / 钥匙没解锁
   * 都到不了这里，剩下的只有网络与服务端，而它们会下一轮再试）。
   */
  useEffect(() => {
    if (host === undefined) return undefined;
    let alive = true;
    const pull = (): void => {
      void host
        .pullForTask(props.taskId)
        .then((result) => {
          if (alive && (result?.added ?? 0) > 0) setTick((n) => n + 1);
        })
        .catch(() => undefined);
    };
    pull();
    const timer = window.setInterval(pull, 5_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [host, props.taskId]);

  if (host === undefined) return null;
  void tick; // 依赖它触发重渲染，值本身不参与渲染
  const comments = host.commentsForTask(props.taskId) as unknown as CommentThreadProps['comments'];

  return <CommentThread taskId={props.taskId} comments={comments} labels={labels} onSubmit={onSubmit} />;
}
