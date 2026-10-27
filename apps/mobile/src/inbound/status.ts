import { useSyncExternalStore } from 'react';
import type { InboundAutomationCycleResult, InboundAutomationCycleState } from '@heyta/app-host';

/**
 * 这一台设备**最近一趟**自动收集的结果，供设置面读。
 *
 * 为什么要有一枚独立的 store：移动壳那枚前台 worker 此前把
 * `processInboundAutomation(...)` 的返回值整个丢掉，于是"队列里有没有东西、这一趟到底做了什么"
 * 在手机上任何一面都看不见 —— 界面上只会安静地什么都不发生。
 *
 * 🔴 只存**终态**这一件事，不存事件正文，也不存 `eventId`：那一枚 id 是用户内容的标识，
 * 设置页不需要它，把它带上界面就等于给一条外部数据开了第二条出口。
 */
export interface InboundCycleSnapshot {
  readonly state: InboundAutomationCycleState;
  readonly itemCount?: number;
}

let current: InboundCycleSnapshot | undefined;
const listeners = new Set<() => void>();

export function publishInboundCycle(result: InboundAutomationCycleResult): void {
  const next: InboundCycleSnapshot = result.itemCount === undefined
    ? { state: result.state }
    : { state: result.state, itemCount: result.itemCount };
  // 稳态是 `empty`：不去重的话，前台每 20 秒一趟会把设置面白白重渲染一次。
  if (current !== undefined && current.state === next.state && current.itemCount === next.itemCount) return;
  current = next;
  for (const listener of listeners) listener();
}

export function getInboundCycle(): InboundCycleSnapshot | undefined {
  return current;
}

export function subscribeInboundCycle(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useInboundCycle(): InboundCycleSnapshot | undefined {
  return useSyncExternalStore(subscribeInboundCycle, getInboundCycle);
}
