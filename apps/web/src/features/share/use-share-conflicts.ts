/**
 * 界面上那一枚"需要手动选择"的**数据源**（ADR-0067 裁决三）。
 *
 * 这里只做三件事：读这台设备那一份共享实例推出来的冲突清单、在两个"可能有新东西"
 * 的信号上重读、把结果交给 React。
 *
 * 🔴 为什么不许在组件里直接 `webShareSession()?.conflicts()`：那两个信号
 *    （op-log 通知、share 重画）就是"别人刚改了同一条任务"到达本机的时刻。
 *    少了订阅，症状是"冲突确实存在，但要刷新页面才看得见"——
 *    那是把"必须可见"重新做成了静默，而这正是这一格要挡的东西。
 */

import { useEffect, useState } from 'react';

import type { ShareConflict } from '@heyta/app-host';

import { onEngineChange } from '../../lib/oplog.js';
import { subscribeShareRepaint } from '../../lib/share-signal-sink.js';
import { webShareSession } from './share-session.js';

/**
 * 把一枚共享冲突交给**这台设备那一份共享实例**去解决（发那一条 op）。
 *
 * ⚠️ 它不判"该不该由共享通道解决" —— 那一条在 `@heyta/app-host` 的
 *    `resolveAnyConflict` 里。这里只是"实例在哪儿就去哪儿发"。
 */
export async function resolveShareConflict(
  conflict: ShareConflict,
  choice: 'keep-local' | 'keep-remote',
): Promise<void> {
  const session = webShareSession();
  if (session === undefined) {
    throw new Error('共享会话此刻不在（退出登录或密钥被收回？）—— 这一处冲突等下一次装配再裁');
  }
  await session.resolveConflict(conflict, choice);
}

export function useShareConflicts(): ShareConflict[] {
  const [list, setList] = useState<ShareConflict[]>([]);

  useEffect(() => {
    const read = (): void => {
      const next = webShareSession()?.conflicts() ?? [];
      // 引用相同就不 setState：这条通知每一次同步都会敲，白重渲染一遍顶栏。
      setList((previous) =>
        previous.length === next.length && previous.every((one, i) => one === next[i]) ? previous : next,
      );
    };
    read();
    const offEngine = onEngineChange(read);
    const offRepaint = subscribeShareRepaint(read);
    return () => {
      offEngine();
      offRepaint();
    };
  }, []);

  return list;
}
