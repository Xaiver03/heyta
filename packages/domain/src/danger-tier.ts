/**
 * 危险操作的档位判定（纯函数，零文案）
 * ====================================
 *
 * 通用判据住在全局 Skill `overlay-feedback-patterns`
 * （`references/destructive-actions.md` §1 三档判定 + §4「什么时候必须保留确认框」
 * + §6 阈值表）；本文件是它在**本仓唯一一份可被调用的实现**。
 *
 * 🔴 为什么必须在共享层而不是各页自判：本仓此前"要不要弹、弹多重"就是各页自判
 * （`App.tsx:483` 批量删除直接做 + 撤销、`TrashView.tsx:251` 自绘重档、
 * `VaultSettingsPanel.tsx:188` 用原生框＝零档），而差异不会让任何测试变红。
 *
 * ## 与既有权威的关系（这一枚**不取代**它们，只从它们派生）
 *
 * · 「哪些对象的删除能撤销」**不在这里发明** —— 抄的是 ADR-0048 的四态
 *   （`entities.ts:31-51`：`deletedAt` = 回收站可恢复，再加 `purgedAt` = 不可恢复）
 *   与 `actions.ts:630-638` 的运行时硬拦（"不可逆是 purge 的核心语义，必须在动作层
 *   真的拦住，而不是只靠界面不画那个按钮"）。标签那一格另有一条已拍板的例外：
 *   **标签不进回收站**（`§7.1 P-1`），判据正文在 `OrganizerList.tsx:643-652`。
 * · 「连带影响」的取数口径也**不在这里发明** —— 用的是 `OrganizerList.tsx:449`
 *   已有的 `hasConsequence = (impact ?? 0) > 0 || (childImpact ?? 0) > 0`，
 *   两个数字各自的真源是 `@heyta/domain` 的 `liveTaskCountsByProject` 与
 *   本包的 `directChildCountsByProject`。
 *
 * ⚠️ 因此这里**故意不做**一件事：不把"删一个清单"自动抬到重档。
 * 现状是删空的清单 = 一键直删（设备级验收 `scripts/verify-mobile-trash.sh` 第 6b 步
 * 钉着它，fixture 的数字就是 0），把集合级动作一律抬成模态会推翻那条已拍板的决定。
 *
 * 🔴 判据的锚不是「文案里有没有『删除』二字」，而是**做错了要花多少代价恢复**。
 */

/**
 * 四档，从轻到重。
 *
 * · `undo` —— 直接执行 + 撤销出口，**不弹确认**。
 * · `popconfirm` —— 就地二次确认，一句后果（`OrganizerList` 那一行展开的确认行就是它）。
 * · `alert` —— 模态确认：标题写后果、正文写范围、destructive 主按钮、禁点背景。
 * · `typed-alert` —— 模态确认 + 逐字键入对象名（注销账号、销毁整个主体）。
 */
export type DangerTier = 'undo' | 'popconfirm' | 'alert' | 'typed-alert';

/**
 * 会被删除的对象种类。
 *
 * ⚠️ 只有 `tag` **不进回收站**（`§7.1 P-1`）：删掉的那一条在界面上没有任何地方能捞回来，
 * 所以它**永远**要问，哪怕连带数字是 0。这一条与"清单只在有后果时才问"**不许合并成一条**
 * ——判据原文在 `packages/ui/src/projects/OrganizerList.tsx:643-652`。
 */
export type DeletableSubject = 'task' | 'note' | 'list' | 'habit' | 'tag';

/** 删除之后**进回收站**（因此撤销真的可执行）的那几类。 */
const TRASH_BOUND_DELETIONS: readonly DeletableSubject[] = ['task', 'note', 'list', 'habit'];

/**
 * 删除这一类对象的撤销是否成立。
 *
 * 🔴 抽出来是因为 `undoAvailable` 曾经要宿主**手填一个布尔** —— 手填的布尔
 * 迟早会和 `actions.ts` 的运行时拦截分家（两份画法 = 两套裁决标准，
 * 漂移表现为"界面给了撤销，动作层抛错"）。调用这一枚就不必记得。
 */
export function isUndoableDeletion(subject: DeletableSubject): boolean {
  return TRASH_BOUND_DELETIONS.includes(subject);
}

/** 一个动作的可判形状。档位只由这里的信息决定，不由调用方的措辞决定。 */
export interface DangerActionShape {
  /**
   * 这次动作会影响多少条对象。`0` / 负数 / `NaN` 按 `1` 处理 ——
   * 举不出条数就用低一档，别用高摩擦兜底。
   */
  readonly affectedCount: number;
  /**
   * 撤销**真的可执行**（软删除 + 幂等 + 留痕 + 同一条删除权限）。
   * 🔴 删除类动作别手填：用 `isUndoableDeletion(subject)` 派生。
   *    界面上有一个撤销按钮 ≠ 这里该填 true。
   */
  readonly undoAvailable: boolean;
  /**
   * 影响的是普通对象，还是一个**主体**（账号）。
   * ⚠️ 没有 `collection` 这一档：集合级动作的摩擦由 `collateralImpact` 决定，
   *    不是由"它是个集合"决定（理由见文件头那条 ⚠️）。默认 `record`。
   */
  readonly target?: 'record' | 'subject';
  /**
   * 连带受影响的条目数（活任务数 + 子清单数），口径同 `OrganizerList.tsx:449`。
   * `> 0` 时"删掉它还有别的东西跟着不见"，必须就地问一句。默认 `0`。
   */
  readonly collateralImpact?: number;
  /** 对外可见：分享发布、发给第三方、已提交的申报、发送给他人。 */
  readonly externallyVisible?: boolean;
  /** 涉及资金：扣款、退款、转账、开票。 */
  readonly involvesPayment?: boolean;
  /** 触发不可回收的资源：彻底删除、销毁密钥、本地数据销毁、删除备份。 */
  readonly destroysIrrecoverableResource?: boolean;
}

/** 批量动作升到重档的条数阈值（≥10 条）。 */
const BULK_TO_ALERT = 10;

/**
 * 「撤销撤不回」的三格：对外可见、涉资金、销毁不可回收资源。
 * 这三格**即使能撤销也必须保留确认**（Skill `destructive-actions.md` §4），
 * 撤销在这里只能作为补充，不能是唯一保护。
 */
function isUndoIneffective(shape: DangerActionShape): boolean {
  return (
    shape.externallyVisible === true
    || shape.involvesPayment === true
    || shape.destroysIrrecoverableResource === true
  );
}

/**
 * 求一个动作该用哪一档。
 *
 * 顺序是**先抬后降**：先把「撤销也撤不回」的三格钉在重档以上，再按条数抬档，
 * 最后才轮到轻档。反过写会让 `undoAvailable: true` 把对外发布降成一个撤销按钮。
 */
export function resolveDangerTier(shape: DangerActionShape): DangerTier {
  if ((shape.target ?? 'record') === 'subject') {
    return 'typed-alert';
  }

  const count = Number.isFinite(shape.affectedCount) && shape.affectedCount > 1
    ? Math.floor(shape.affectedCount)
    : 1;
  const impact = Number.isFinite(shape.collateralImpact ?? 0) && (shape.collateralImpact ?? 0) > 0
    ? Math.floor(shape.collateralImpact ?? 0)
    : 0;

  if (isUndoIneffective(shape)) {
    // 这三格本身已是"对外/对钱/对不可回收资源"，批量时再抬一级到键入名称。
    return count >= BULK_TO_ALERT ? 'typed-alert' : 'alert';
  }

  if (count >= BULK_TO_ALERT) {
    return 'alert';
  }

  if (count > 1 || impact > 0) {
    return 'popconfirm';
  }

  return shape.undoAvailable ? 'undo' : 'popconfirm';
}

/**
 * 这一档需要模态（第 5 级）的强制表态吗。
 *
 * 抽出来的理由：宿主只比 `tier === 'alert'` 会漏掉 `typed-alert`，
 * 症状是**注销账号可以点背景关掉**。
 */
export function requiresModalCommitment(tier: DangerTier): boolean {
  return tier === 'alert' || tier === 'typed-alert';
}
