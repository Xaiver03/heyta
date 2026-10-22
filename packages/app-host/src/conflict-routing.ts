/**
 * 两条冲突来源的**分流**（ADR-0067 裁决三落到界面上的那一步）。
 * ============================================================
 *
 * 现在同一个"需要人来定"的清单里有两批东西：
 *   · 个人同步那侧服务端报回来的 `ConflictInfo`（解决 = 让 sync 客户端重发一条 op）；
 *   · 共享域自己从 share 日志推出来的 `ShareConflict`（解决 = 往那份 share 日志发一条 op）。
 *
 * 🔴 "这一条该交给谁"是**业务判断**，所以它住在这里，不住在 `apps/*`
 *    （AGENTS §3.5）。端壳只许调 `resolveAnyConflict` 并把两条通道作为端口递进来 ——
 *    如果壳里出现 `conflict.shareId !== undefined` 这种判断，就会出现
 *    "web 分得对、桌面分得不对"这类两边答案不同的事，而这条线已经为这个形状付过学费。
 *
 * 判据用 `shareId` 而不是用 id 前缀去猜：`ShareConflict` 带 `shareId`，
 * `ConflictInfo` 没这个字段。前缀只是给人看的。
 */

import type { ShareConflict } from './share-conflicts.js';

/** 两条来源合到一张清单之后，视图手里的那个最小形状。 */
export interface RoutableConflict {
  readonly id: string;
  readonly shareId?: string;
}

/** 这一枚是共享域的吗（是 ⇒ 它的 `resolve` 走 share 通道）。 */
export function isShareConflict(conflict: RoutableConflict): conflict is ShareConflict {
  return typeof conflict.shareId === 'string' && conflict.shareId !== '';
}

/** 两条各自的解决通道（由端壳注入；这里不判"有没有登录"那一类条件）。 */
export interface ConflictResolvers<TPersonal> {
  personal(conflict: TPersonal, choice: 'keep-local' | 'keep-remote'): Promise<unknown>;
  share(conflict: ShareConflict, choice: 'keep-local' | 'keep-remote'): Promise<unknown>;
}

/**
 * 把一枚冲突交给**它自己那一侧**的解决通道。
 *
 * ⚠️ 两形互斥（`isShareConflict` 是唯一判据）：一枚共享冲突绝不会被喂给个人 sync 客户端 ——
 *    那边要 `opId`，而 share op 的 id 不在个人日志里，喂过去是**必然失败**的解决
 *    （移动端 `ConflictSheet` 的注释记过同一族的事故：拿视图模型凑对象会让解决必然失败）。
 */
export async function resolveAnyConflict<TPersonal extends RoutableConflict>(
  resolvers: ConflictResolvers<TPersonal>,
  conflict: TPersonal | ShareConflict,
  choice: 'keep-local' | 'keep-remote',
): Promise<void> {
  if (isShareConflict(conflict)) {
    await resolvers.share(conflict, choice);
    return;
  }
  await resolvers.personal(conflict as TPersonal, choice);
}
