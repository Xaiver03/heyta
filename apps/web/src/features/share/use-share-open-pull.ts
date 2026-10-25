/**
 * **停在一份共享清单上 ⇒ 拉一次那条下行的既有内容。**
 *
 * 判据本体在 `@heyta/app-host` 的 `pullSharedListOnOpen`（为什么每次打开都拉、为什么
 * 拉不成不许抛穿，写在那份文件头）。这一枚只做壳里那一件事：把**那一份**会话的下行
 * 出口交给它。
 *
 * ## 为什么必须有这一枚（2026-10-25 iOS 设备腿 L2 实测抓出来的，两壳同形）
 *
 * `new_share_ops` 只在**有人新写**时响。成员刚加入一份已经写了东西的清单时，那些内容
 * 早就在 share log 里躺着了 —— 没有任何一条路径会带来它们：
 * 名册下来了、清单行绑好了，界面上却是一条空清单。此前 web 只有两枚触发点
 * （实时信号、评论区挂载时按任务拉），都不覆盖"打开一份共享"这件事。
 *
 * ## 🔴 为什么这里不再敲重画（与移动端那枚包装件的唯一差异）
 *
 * web 的 `pullShareOps`（`comment-actions.ts` 里那个唯一出口）**自己就敲**：
 * `added > 0` 敲引擎通知、有验签拒敲重画。移动端没有那一层，所以那边的包装件补敲。
 * 这里再敲一遍等于同一次拉取让界面重渲染两轮。
 *
 * ## 触发点唯一
 *
 * 只由"当前停在哪个清单行"驱动（`App.tsx` 里 `currentProject?.shareId` 那一枚），
 * 全壳只此一处调用点，判据钉在 `tests/share-open-pull.spec.tsx`。
 * ⚠️ 不许并进 `ShareFeature.tsx` 那个含 `reload` 的 effect：`reload` 的身份随
 * token/baseUrl 变，那会把"换一次凭据"变成"多拉一次"。
 */

import { useEffect } from 'react';
import { pullSharedListOnOpen } from '@heyta/app-host';

import { ensureWebShareSession } from './share-session.js';

export function useShareOpenPull(shareId: string | undefined): void {
  useEffect(() => {
    if (shareId === undefined) return;
    void (async () => {
      // 这一刻建不出会话（未登录 / 保险库锁着）⇒ 什么都不发：停在原地等下一次打开，
      // 不在这里空打，也不把它折成"出错了"。
      const session = await ensureWebShareSession();
      if (session === undefined) return;
      await pullSharedListOnOpen({ pull: session.pullShareOps }, shareId);
    })();
  }, [shareId]);
}
