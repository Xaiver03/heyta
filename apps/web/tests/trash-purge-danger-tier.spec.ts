import { describe, expect, it } from 'vitest';

import { requiresModalCommitment, resolveDangerTier } from '@heyta/domain';

import {
  purgeDangerShape,
  purgeDangerTierOf,
  purgeUsesModalCommitment,
  type PurgeInput,
} from '../src/features/trash/purgeDanger';

/**
 * 回收站「彻底删除」的档位是**派生**出来的（2026-10-27，全局 UX 整改 P2）
 * ========================================================================
 *
 * 判据正文在 `docs/plans/global-ux-system-remediation.md` §P2：
 * 「不可逆动作只有一套危险确认语义，档位由 `resolveDangerTier` 派生，不在界面层比字符串」。
 *
 * 立项时的现量是：`resolveDangerTier` / `requiresModalCommitment` **零调用点**
 * （`grep -rn "resolveDangerTier(" 各包的 src 与 apps 的 src`
 * 只命中定义那一行 + `DangerDialog.tsx` 文件头两句注释）。档位写完、单测绿、界面一行没用
 * —— 本文件与 `purgeDanger.ts` 是它第一次有运行时消费者。
 *
 * 🔴 为什么不写成源码扫描（"界面不许比档位字符串"那条）：试过，假阳面量出来 5 处命中里
 * 3 处与档位无关（ARIA role `'alert'`、动作名 `'undo'`、以及 `DangerDialog` 内部判
 * "这一档要不要键入名称"）。逐条写在 `scripts/check-danger-confirm.mjs` 文件头。
 * 所以这一格用**单元测试钉形状**，用 `e2e/tests/danger-confirm-trash.spec.ts` 钉画面。
 *
 * ⚠️ 形状里**没有 `kind`**：四类回收站对象（`TASK/NOTE/PROJECT/HABIT`）走的是同一份口径，
 *    把种类拆进形状里就会长成"每类各写一次判断"，而两份分家不会红。
 */

const base: PurgeInput = { strandedChildren: 0 };

describe('彻底删除的档位派生', () => {
  it('没有子清单挂着时是重档，并落模态强制表态', () => {
    expect(purgeDangerTierOf(base)).toBe('alert');
    expect(purgeUsesModalCommitment(base)).toBe(true);
  });

  it('挂着子清单时仍在重档，条数不会把它降下去', () => {
    // `collateralImpact` 喂的是"跟着再也找不到的那些"（子清单），不是"里面还有几条任务"——
    // 后者确认框自己就写着"它们不会被删除"，喂进去等于为一个不发生的事抬摩擦。
    expect(purgeDangerTierOf({ strandedChildren: 3 })).toBe('alert');
    expect(purgeUsesModalCommitment({ strandedChildren: 3 })).toBe(true);
  });

  it('撤销在这一格不成立（`restore*` 在动作层直接抛错，不是界面少画一个按钮）', () => {
    expect(purgeDangerShape(base).undoAvailable).toBe(false);
  });

  it('形状把这一格登记成"销毁不可回收资源"', () => {
    expect(purgeDangerShape(base).destroysIrrecoverableResource).toBe(true);
  });
});

/**
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 对照臂：证明上面两条"是 alert / 要模态"**能红**
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 计划 §P2 原来的能红口径写的是"手填 `undo` 降档应导致契约测试红"。动手前先算了这笔账，
 * 结论是那句**指错了开关**：`resolveDangerTier` 先走 `isUndoIneffective`
 * （看 `externallyVisible / involvesPayment / destroysIrrecoverableResource`，
 * `packages/domain/src/danger-tier.ts:131`），**在 `undoAvailable` 之前就短路** ——
 * 翻 `undoAvailable` 什么都不会变。
 *
 * ⇒ 两枚对照臂：① 翻真正的开关必须掉下来（否则前面那两条是恒真的读数）；
 *   ② 只翻 `undoAvailable` 必须**仍**在重档（把短路顺序这件事钉在测试里，
 *   免得下一位又按计划那句去翻错的那一枚，还以为自己验过了）。
 */
describe('对照臂：降档的开关到底在哪一枚上', () => {
  function commitmentOf(override: Partial<ReturnType<typeof purgeDangerShape>>): boolean {
    return requiresModalCommitment(resolveDangerTier({ ...purgeDangerShape(base), ...override }));
  }

  it('① 摘掉 destroysIrrecoverableResource 并声称可撤销 ⇒ 必须离开模态承诺', () => {
    expect(commitmentOf({ destroysIrrecoverableResource: false, undoAvailable: true })).toBe(false);
  });

  it('② 只翻 undoAvailable ⇒ 仍在模态承诺（短路顺序被钉住）', () => {
    expect(commitmentOf({ undoAvailable: true })).toBe(true);
  });
});
