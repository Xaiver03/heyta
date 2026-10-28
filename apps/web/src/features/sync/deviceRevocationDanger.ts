import { requiresModalCommitment, resolveDangerTier } from '@heyta/domain';

/**
 * 「撤销这台设备」的档位（2026-10-27，全局 UX 整改 P2 第二格）
 * =========================================================
 *
 * 与 `../trash/purgeDanger.ts` 同一族做法：**形状在共享层之外也要能单测**，界面只读结果。
 *
 * 为什么这一格是重档而不是"能撤销就别问"：
 * `docs/agents/overlay-feedback.md` §6 的 T6 那一行点名了六格 —— purge / 注销账号 /
 * **授权撤销** / 分享发布 / AI 出网 / 数据销毁 —— 它们的"可撤销"前提不成立，
 * **保留重档确认框是正确结论，不是欠账**。撤销一台设备会作废整把账号令牌版本，
 * 撤掉的授权拿不回来（只能在那台设备上重新登录），所以 `undoAvailable: false`。
 *
 * ⚠️ 影响面写的是"所有设备都要重新登录"这一件**真会发生**的事。
 *    不写条数：这条动作的对象是一台设备，而后果的承受者是"其余每一台"——
 *    把 `affectedCount` 填成设备数会把"撤销这一台"读成"撤销全部"。
 */
export function deviceRevocationUsesModalCommitment(): boolean {
  return requiresModalCommitment(
    resolveDangerTier({
      affectedCount: 1,
      undoAvailable: false,
      destroysIrrecoverableResource: true,
    }),
  );
}
