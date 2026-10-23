/**
 * `resolveDangerTier` 的语义钉子
 * ==============================
 *
 * 判据正文在全局 Skill `overlay-feedback-patterns`
 * （`references/destructive-actions.md` §1 / §4 / §6）。这一组用例钉的是**那张表落到本仓**，
 * 重点在三条会真出事的边界：
 *
 *   1. **不许推翻已拍板的现状**：删一条空清单 = 一键直删
 *      （设备级判据 `scripts/verify-mobile-trash.sh` 第 6b 步，fixture 的数字就是 0）。
 *      把"它是个集合"当成抬档理由会把它变成模态框 —— 这一组里有专门的用例挡它。
 *   2. **撤销撤不回的三格不许降档**：对外可见 / 涉资金 / 销毁不可回收资源，
 *      即使 `undoAvailable: true` 也必须保留确认。
 *   3. **举不出条数就用低一档**：`0` / 负数 / `NaN` 不许被当成"很多"而乱抬。
 *
 * 另外钉一张表：`isUndoableDeletion` 的 `tag` 那一格。它不许跟着别的种类一起变绿 ——
 * 标签不进回收站（`§7.1 P-1`），判据正文在 `packages/ui/src/projects/OrganizerList.tsx:643-652`，
 * 那里明写这两个条件**不许合成一条**。
 */

import { describe, expect, it } from 'vitest';

import {
  isUndoableDeletion,
  requiresModalCommitment,
  resolveDangerTier,
} from '../src/danger-tier.js';

describe('isUndoableDeletion：抄的是 ADR-0048 的四态，不是新发明', () => {
  it('任务 / 便签 / 清单 / 习惯的删除进回收站 ⇒ 撤销成立', () => {
    expect(isUndoableDeletion('task')).toBe(true);
    expect(isUndoableDeletion('note')).toBe(true);
    expect(isUndoableDeletion('list')).toBe(true);
    expect(isUndoableDeletion('habit')).toBe(true);
  });

  it('🔴 标签不进回收站 ⇒ 撤销不成立（它永远要问，哪怕连带数字是 0）', () => {
    expect(isUndoableDeletion('tag')).toBe(false);
    // 派生出来的档位：删一条空标签必须问，而删一条空清单不许问。
    const emptyTag = resolveDangerTier({
      affectedCount: 1,
      undoAvailable: isUndoableDeletion('tag'),
    });
    const emptyList = resolveDangerTier({
      affectedCount: 1,
      undoAvailable: isUndoableDeletion('list'),
    });
    expect(emptyTag).toBe('popconfirm');
    expect(emptyList).toBe('undo');
  });
});

describe('resolveDangerTier：不许推翻已拍板的现状', () => {
  it('删一条**空的**清单（无活任务、无子清单）→ undo，一键直删', () => {
    expect(
      resolveDangerTier({
        affectedCount: 1,
        undoAvailable: isUndoableDeletion('list'),
        collateralImpact: 0,
      }),
    ).toBe('undo');
  });

  it('🔴 删一条**有连带后果**的清单 → popconfirm（就地问），而不是模态', () => {
    for (const collateralImpact of [1, 3, 9]) {
      expect(
        resolveDangerTier({
          affectedCount: 1,
          undoAvailable: isUndoableDeletion('list'),
          collateralImpact,
        }),
        `collateralImpact=${String(collateralImpact)}`,
      ).toBe('popconfirm');
    }
  });

  it('⚠️ 连带数字为小数/NaN/负数时按"没有后果"处理，不许因此抬档', () => {
    for (const collateralImpact of [0, -2, Number.NaN]) {
      expect(
        resolveDangerTier({ affectedCount: 1, undoAvailable: true, collateralImpact }),
        `collateralImpact=${String(collateralImpact)}`,
      ).toBe('undo');
    }
  });
});

describe('resolveDangerTier：可撤销的单条动作走轻档', () => {
  it('删除一条任务、软删除可撤销、无外部副作用 → undo（不弹确认）', () => {
    expect(resolveDangerTier({ affectedCount: 1, undoAvailable: true })).toBe('undo');
  });
});

describe('resolveDangerTier：不可撤销按影响面抬档', () => {
  it('单条不可撤销 → popconfirm（就地一句后果）', () => {
    expect(resolveDangerTier({ affectedCount: 1, undoAvailable: false })).toBe('popconfirm');
  });

  it('2–9 条 → popconfirm（阈值表里这一格是中档，不是重档）', () => {
    expect(resolveDangerTier({ affectedCount: 2, undoAvailable: true })).toBe('popconfirm');
    expect(resolveDangerTier({ affectedCount: 9, undoAvailable: true })).toBe('popconfirm');
  });

  it('🔴 ≥10 条 → alert，即使每条都能撤销', () => {
    expect(resolveDangerTier({ affectedCount: 10, undoAvailable: true })).toBe('alert');
  });

  it('删除一个主体（账号）→ typed-alert，必须逐字键入名称', () => {
    expect(
      resolveDangerTier({ affectedCount: 1, undoAvailable: true, target: 'subject' }),
    ).toBe('typed-alert');
  });

  it('主体那一格不看条数，也不看撤销是否成立', () => {
    expect(
      resolveDangerTier({
        affectedCount: 12,
        undoAvailable: false,
        target: 'subject',
        externallyVisible: true,
      }),
    ).toBe('typed-alert');
  });
});

describe('resolveDangerTier：撤销撤不回的那三格', () => {
  const reversible = { affectedCount: 1, undoAvailable: true } as const;

  it('对外可见（分享发布 / 发给第三方 / 已提交的申报）→ alert', () => {
    expect(resolveDangerTier({ ...reversible, externallyVisible: true })).toBe('alert');
  });

  it('涉资金（扣款 / 退款 / 开票）→ alert', () => {
    expect(resolveDangerTier({ ...reversible, involvesPayment: true })).toBe('alert');
  });

  it('销毁不可回收的资源（彻底删除 / 密钥 / 本地数据销毁）→ alert', () => {
    expect(
      resolveDangerTier({ ...reversible, destroysIrrecoverableResource: true }),
    ).toBe('alert');
  });

  it('🔴 这三格批量时抬到 typed-alert，不许停在 alert', () => {
    expect(
      resolveDangerTier({ affectedCount: 12, undoAvailable: true, externallyVisible: true }),
    ).toBe('typed-alert');
    expect(
      resolveDangerTier({ affectedCount: 12, undoAvailable: true, destroysIrrecoverableResource: true }),
    ).toBe('typed-alert');
  });

  it('不可撤销 + 对外可见：档位不因 undoAvailable 而下降', () => {
    expect(
      resolveDangerTier({ affectedCount: 1, undoAvailable: false, externallyVisible: true }),
    ).toBe('alert');
  });

  it('这三格的连带后果**不许把档位降回** popconfirm', () => {
    expect(
      resolveDangerTier({
        affectedCount: 1,
        undoAvailable: true,
        externallyVisible: true,
        collateralImpact: 5,
      }),
    ).toBe('alert');
  });
});

describe('resolveDangerTier：举不出条数就用低一档', () => {
  it('0 / 负数 / NaN / Infinity 都按「一条」处理，不许被当成"很多"抬档', () => {
    const shape = (affectedCount: number) => ({ affectedCount, undoAvailable: true }) as const;
    expect(resolveDangerTier(shape(0))).toBe('undo');
    expect(resolveDangerTier(shape(-5))).toBe('undo');
    expect(resolveDangerTier(shape(Number.NaN))).toBe('undo');
    expect(resolveDangerTier(shape(Number.POSITIVE_INFINITY))).toBe('undo');
  });

  it('小数条数向下取整，不四舍五入抬档（9.6 条仍是中档）', () => {
    expect(resolveDangerTier({ affectedCount: 9.6, undoAvailable: true })).toBe('popconfirm');
  });
});

describe('requiresModalCommitment：重档的判定不许由各页自写', () => {
  it('🔴 alert 与 typed-alert 都算"必须模态表态"，漏掉后者就是注销账号可点背景关闭', () => {
    expect(requiresModalCommitment('undo')).toBe(false);
    expect(requiresModalCommitment('popconfirm')).toBe(false);
    expect(requiresModalCommitment('alert')).toBe(true);
    expect(requiresModalCommitment('typed-alert')).toBe(true);
  });
});
