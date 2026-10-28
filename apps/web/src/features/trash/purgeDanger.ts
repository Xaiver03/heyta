import {
  requiresModalCommitment,
  resolveDangerTier,
  type DangerActionShape,
  type DangerTier,
} from '@heyta/domain';

/**
 * 「彻底删除」的档位（2026-10-27，全局 UX 整改 P2）
 * ==============================================
 *
 * 这一枚是 `resolveDangerTier` 在**整个仓库里的第一个运行时消费者** —— 在此之前它只有定义
 * 与自己的单测（现量：`grep -rn 'resolveDangerTier(' 各包与 apps 的 src 目录` 只命中定义那一行
 * 加 `DangerDialog.tsx` 文件头的两句注释）。档位写完、测绿、界面一行没用，正是本轮审计的病灶，
 * 所以 P2 的第一件产出物是**把派生接上**，不是再补单测。
 *
 * ## 为什么单独成模块，而不是写在 `TrashView` 里
 *
 * 形状（`affectedCount` / `undoAvailable` / …）是业务事实，放界面层就等于"每个宿主各抄一份"
 * —— 而这两份一旦分家，**没有任何东西会红**（`packages/domain/src/danger-tier.ts` 文件头
 * 为 `undoAvailable` 手填布尔写过同一条警告）。放这里之后：
 *
 * · 单测能直接喂形状（`apps/web/tests/trash-purge-danger-tier.spec.ts`），
 *   包括"哪一枚布尔才是降档开关"那两条对照臂；
 * · 档位对**四类回收站对象**是同一份口径（`TASK/NOTE/PROJECT/HABIT` 走同一个形状），
 *   拆在界面里就会长成四份各写一次的判断。
 */
export interface PurgeInput {
  /**
   * 这条对象底下**跟着再也找不到**的条目数（清单的子清单数）。
   *
   * 🔴 不喂"里面还有几条活任务"：彻底删除**不级联删任务**（确认框自己就写着这一句，
   * `web.trash.confirm.projectTasks`）。把不会被删的东西计进影响面，等于为一个不发生的事
   * 抬摩擦，而且那句数字还会和列表里的读数打架。
   */
  readonly strandedChildren: number;
}

/** 派生用的可判形状。**档位不在这里写死** —— 只描述事实，由 `resolveDangerTier` 裁决。 */
export function purgeDangerShape(input: PurgeInput): DangerActionShape {
  return {
    affectedCount: 1,
    /**
     * 撤销在这一格不成立：purge 打的是 `purgedAt` 标记，之后 `restoreTask` / `restoreProject`
     * 在动作层直接抛错（`TrashView.tsx` 里那句"父清单一旦被彻底删除，`restoreProject` 从此抛错"
     * 说的就是它）。
     *
     * ⚠️ 这里**不**用 `isUndoableDeletion(subject)` 派生，不是忘了：那一枚判的是"删除会不会进回收站"，
     * 而彻底删除的对象**已经在回收站里**，两问不同。用它会把这一格错判成可撤销。
     */
    undoAvailable: false,
    /**
     * 字段文档给的第一个例子就是"彻底删除"（`danger-tier.ts:93`）。
     * 🔴 这一枚才是把这一格钉在重档的**开关**：`resolveDangerTier` 先走
     * `isUndoIneffective`（看 `externallyVisible / involvesPayment / destroysIrrecoverableResource`），
     * 在 `undoAvailable` 之前就短路。翻掉它这一格会掉到轻档，翻 `undoAvailable` 不会。
     *
     * ⚠️ 别把它读成"物理擦除"：op-log 里的历史载荷没被抹掉，界面上只是不再提供恢复 ——
     * 这句话确认框里也写着（`web.trash.confirm.notErasure`），两处不许互相打脸。
     */
    destroysIrrecoverableResource: true,
    collateralImpact: input.strandedChildren,
  };
}

/** 这一格该用哪一档 —— 由形状派生，界面不许自己比字符串。 */
export function purgeDangerTierOf(input: PurgeInput): DangerTier {
  return resolveDangerTier(purgeDangerShape(input));
}

/**
 * 这一格是否该落"模态强制表态"（第 5 级）。
 *
 * 用 `requiresModalCommitment` 而不是 `tier === 'alert'`：后者会漏掉 `typed-alert`，
 * 症状是**注销账号可以点背景关掉**（那条理由写在本函数自己的注释里，`danger-tier.ts:147-152`）。
 */
export function purgeUsesModalCommitment(input: PurgeInput): boolean {
  return requiresModalCommitment(purgeDangerTierOf(input));
}
