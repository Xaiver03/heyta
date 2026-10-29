import { requiresModalCommitment, resolveDangerTier } from '@heyta/domain';

/**
 * 「重置这一组 AI 设置」的档位（2026-10-29，把 P2 登记的那格「未判定」判掉）
 * ======================================================================
 *
 * 与 `../sync/deviceRevocationDanger.ts`、`../trash/purgeDanger.ts` 同一族做法：
 * **只描述事实，档位由 `resolveDangerTier` 裁决**，界面读结果。
 *
 * ## 这一格欠的是什么
 *
 * 计划 §P2 边界把它登记成"未判定"而不是"已合规"：这一枚就地两档确认的门禁 R1/R2 都过
 * （无 ×、主按钮 danger），但它**没问过那张表**，而它该不该升成模态表态只取决于一个
 * 当时没写进任何文档的判断 —— **清掉用户填进来的 API 密钥算不算 `destroysIrrecoverableResource`**。
 *
 * ## 裁决：算
 *
 * 三条都在界面上写着，不是我推测的：
 *
 *   · 代价清单第 4 条逐字是「存在这台设备上的密钥与令牌」（`web.ai.settings.reset.clearsSecrets`）；
 *   · 这一格没有撤销出口，也没有任何"操作日志里还能拉回来"的路径 ——
 *     同一块上那句 `keepsCorrections` 恰恰说明**只有**纠正过的偏好跟着 op-log 走，
 *     密钥不在那一档里；
 *   · 密钥是**打码存的**：用户看不到自己填过什么，所以"再输一遍"不等于"恢复"，
 *     他得回服务商控制台重新取或重新签发。
 *
 * ⇒ `alert` 档 ⇒ `requiresModalCommitment` 为真 ⇒ **需要模态表态**，
 *   而"就地两档"那一层本来就欠一层（它不接管焦点、背景与 Esc 都不问表）。
 *   与撤设备同一结论：这类动作的"可撤销"前提不成立，重档确认框是正确结论，不是欠账。
 *
 * ⚠️ `affectedCount` 填 1：对象是"这一组设置"这一次操作，不是被清的条目数 ——
 *    清单有几行是**文案**的事，不该变成档位的分子（多写一行词条就把档位改了，
 *    那是把产品口径挂在 copy 上）。
 */
export function aiSettingsResetUsesModalCommitment(): boolean {
  return requiresModalCommitment(
    resolveDangerTier({
      affectedCount: 1,
      undoAvailable: false,
      destroysIrrecoverableResource: true,
    }),
  );
}
