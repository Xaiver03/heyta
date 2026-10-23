/**
 * `useShareActivitySignal` —— 把实时信号（`new_share_ops`）变成"拉一次 + 该响才响"。
 *
 * 挂在根组件上（`App.tsx` 里那一行，与 `useReminderNotifications()` 同一处），
 * 因为信号是**账号级**的：它到达时用户可能正停在任何一屏，而不是共享面板里。
 *
 * 三段各归各位，这里只做装配（AGENTS §3.5：壳里不许有业务判断）：
 *   · 该不该拉、拉到什么活动 —— `@heyta/app-host` 的 `createShareOpsSignalHandler`
 *   · 这些活动里哪些该吵人 —— `@heyta/ui` 的 `selectNotifiedActivities`（本机偏好）
 *   · 怎么投递 —— `share-activity-notify.ts`（唯一不纯的那一下）
 *
 * 🔴 这一片是**唯一的**信号消费者（垫片里那个单槽 sink）。评论区不自己接 WS：
 *    拉到内容之后由这里发一次"重画"，正在显示那一节的人**从盘上重放** ——
 *    游标是全 share 一份的，它们再拉一次只会拿到 `fetched = 0`。
 */

import { useEffect, useMemo } from 'react';

import { createShareOpsSignalHandler, shareIdsOnDevice } from '@heyta/app-host';
import { selectNotifiedActivities } from '@heyta/ui';
import { useI18n } from '@heyta/i18n';

import { useSyncStore } from '../sync/store.js';
import { currentState, hasEngine, requireEngine } from '../../lib/oplog.js';
import { emitShareRepaint, setShareSignalSink } from '../../lib/share-signal-sink.js';
import { createStorageShareLog } from './comment-actions.js';
import { ensureWebShareSession } from './share-session.js';
import { loadShareNotificationPrefs } from './share-notif-prefs.js';
import { deliverShareActivityNotifications } from './share-activity-notify.js';

export function useShareActivitySignal(): void {
  const { t } = useI18n();
  const baseUrl = useSyncStore((s) => s.baseUrl);
  const token = useSyncStore((s) => s.token);
  const accountId = useSyncStore((s) => s.accountId);

  const labels = useMemo(
    () => ({
      title: t('common.brand'),
      body: (kind: 'added' | 'deleted' | 'completed'): string =>
        kind === 'added'
          ? t('common.share.activity.added')
          : kind === 'deleted'
            ? t('common.share.activity.deleted')
            : // "完成"这一档今天还不会有输入：M2 之后共享任务的 op 已经在 share log 里，
              // 缺的是**档位映射与措辞**（`ShareSignalActivity` 只到 added/deleted，见 app-host 那段）。
              // 留一条兜底文案而不是留白 —— 真接上那一档时它会被判据抓到并要求写清楚。
              t('common.share.notif.activityCompleted'),
    }),
    [t],
  );

  useEffect(() => {
    if (accountId === undefined || accountId === '' || baseUrl.trim() === '' || token === undefined || token.trim() === '') {
      return undefined;
    }
    // 信号是从同步连接上来的：没有本地引擎就没有那条连接。
    // 与其把 `myClientId` 退成空串（那样"自己不吵自己"这一条会静默失效），不如不注册。
    if (!hasEngine()) return undefined;
    const myClientId = requireEngine().getClientId();
    const sink = async (shareId: string, latestSeq: number): Promise<void> => {
      // 🔴 问 `share-session.ts` 要**那一份**实例，不再自己建：这一趟拉回来的内容
      // 要落进合并视图读的那份缓存，落进另一份等于"拉到了但没人看得见"。
      const comments = await ensureWebShareSession();
      if (comments === undefined) {
        // vault 没解锁 ⇒ 解不开信封也解不开密文。信号丢掉：不响是对的（游标还没推进），
        // 解锁之后**下一次**信号会补上。⚠️ 这句只覆盖"信号恰好再来一次"：
        // 对方写完就不再动的话，这一份内容要等下一次有人进评论区才拉得到 ——
        // 那是这条链今天已知的那一格，不是"迟早会自己好"。
        return;
      }
      const handler = createShareOpsSignalHandler({
        storage: createStorageShareLog(window.localStorage),
        // 🔴 本机认得的 share 名单：读的是**清单行绑定**，不是"这份日志落过盘"。
        // 刚入群那台设备一次都没拉过，索引是空的 —— 只认索引的话它会永远收不到第一份
        // 内容（不拉就不进索引，进了索引才允许拉）。判据与实测见 app-host 那侧纪律 ①。
        knownShareIds: () => shareIdsOnDevice(currentState()),
        pull: comments.pullShareOps,
        myClientId,
      });
      const reading = await handler.onShareOpsSignal(shareId);
      // 盘上的日志刚被这批新内容写过 —— 正在显示这份共享的那一节得重放一次。
      // 它**不能**自己去拉：游标已经推进，拉回来是 `fetched = 0`（见垫片那段）。
      if (reading.pulled && reading.added > 0) emitShareRepaint();
      const toSurface = selectNotifiedActivities(
        loadShareNotificationPrefs(window.localStorage),
        reading.activities,
      );
      deliverShareActivityNotifications(toSurface, shareId, latestSeq, labels);
    };
    setShareSignalSink((shareId, latestSeq) => {
      void sink(shareId, latestSeq);
    });
    return () => setShareSignalSink(undefined);
  }, [accountId, baseUrl, labels, token]);
}
