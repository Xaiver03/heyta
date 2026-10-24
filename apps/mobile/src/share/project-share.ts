/**
 * `setProjectShareId` 的移动端**唯一**调用点。
 * =========================================================================
 *
 * 判据本体在 `@heyta/app-host` 的 `project-actions.ts`（"shareId 空串要抛、
 * 本地只做字段挂接"都在那里）；这里只回答"移动端的这条写从哪个入口进来"。
 * 🔴 share 面板（M6-3 交付）只许走这一处 —— 出现第二处 `setProjectShareId`
 * 调用，就是"共享绑定有两个所有者"那类漂移的开始（web 也只在
 * `features/projects/store.ts` 调了一次，同一条纪律）。
 */
import { createProjectActions } from '@heyta/app-host';

import { openTaskHost } from '../db/open-host';

/**
 * 把服务端已认可的 shareId 绑到本地清单行（共享成功之后调）。
 *
 * ⚠️ 走的是**包装后的宿主**：那条 PROJECT 写同样经过 `share/wiring.ts` 的路由
 * （此刻清单还没挂 shareId ⇒ 判成个人 ⇒ 落个人 log，与 web 逐字同一条路径）。
 */
export async function bindProjectShare(projectId: string, shareId: string): Promise<void> {
  const host = await openTaskHost();
  await createProjectActions(host).setProjectShareId(projectId, shareId);
}
