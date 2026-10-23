/**
 * `useShareRosterSignal` —— 把成员面信号（`share_roster_changed`，ADR-0070）变成
 * "该重取的那几节界面各重取一次，一次人类操作只吵一次"。
 *
 * 挂在根组件上（与 `useShareActivitySignal()` 同一处）：信号是账号级的，
 * 它到达时用户可能停在任何一屏，而面板可能根本没开。
 *
 * 三段各归各位，这里只做装配（AGENTS §3.5：壳里不许有业务判断）：
 *   · 该不该重取、一条变化吵几次 —— `@heyta/app-host` 的 `createShareRosterSignalHandler`
 *   · 谁显示着这一份清单 —— 面板与入群对话框各自 `registerShareRosterTarget`
 *
 * 🔴 闸门用的是「清单行绑定 ∪ 界面登记着的 target」，不是只用前者：
 * 刚点完接受邀请那台设备的清单行还没写（那是 `finalize` 成功之后的事），
 * 只用前者的话 owner 补发信封那条信号会被判成"本机不认得"丢掉，
 * 而那台设备正好是这条信号唯一等着的收件人 —— M2 收尾抓到的自锁同一形状。
 *
 * 这一条不发通知：成员面变化没有"响一下"的产品语义（响的是内容与提醒，走另一条），
 * 所以这里没有偏好闸门，也没有投递件。
 */

import { useEffect } from 'react';

import { createShareRosterSignalHandler, shareIdsOnDevice } from '@heyta/app-host';

import { currentState, hasEngine } from '../../lib/oplog.js';
import {
  runShareRosterTargets,
  setShareRosterSink,
  shareRosterTargetShareIds,
} from '../../lib/share-signal-sink.js';
import { useSyncStore } from '../sync/store.js';

export function useShareRosterSignal(): void {
  const accountId = useSyncStore((s) => s.accountId);
  const baseUrl = useSyncStore((s) => s.baseUrl);
  const token = useSyncStore((s) => s.token);

  useEffect(() => {
    if (accountId === undefined || accountId === '' || baseUrl.trim() === '' || token === undefined || token.trim() === '') {
      return undefined;
    }
    // 与活动信号同一条：没有本地引擎就没有那条 WS 连接，宁可不注册。
    if (!hasEngine()) return undefined;

    const handler = createShareRosterSignalHandler({
      knownShareIds: () => [...shareIdsOnDevice(currentState()), ...shareRosterTargetShareIds()],
      refresh: runShareRosterTargets,
    });

    setShareRosterSink((shareId) => {
      void handler.onRosterSignal(shareId);
    });
    return () => setShareRosterSink(undefined);
  }, [accountId, baseUrl, token]);
}
