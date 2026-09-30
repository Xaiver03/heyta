/**
 * 子任务的**界面语义**：拒绝原因 → 词条 key（唯一一份）
 * ========================================================
 *
 * ## 为什么需要它
 *
 * `Task.parentId` 的写路径是 `packages/app-host` 的 `setParent`，它在**写之前**
 * 调领域层的 `validateParentChange`，失败就 `throw`（原因在 `ParentChangeRejection`，
 * 一个 6 值的封闭集合：`task_not_found` / `parent_not_found` / `self` / `cycle` /
 * `depth_exceeded` / `children_exceeded`）。
 *
 * ⇒ **界面必须把这 6 条翻成人话**，否则用户只会看到一个 throw。
 * 而"翻成人话"这件事如果各端各写一份，就会出现：
 * **同一个 `cycle`，web 说"不能移到自己的子任务下"，移动端说"操作无效"** ——
 * 与认证的 `common.auth.error.*` 是同一个形状的问题
 * （那边已经收编过，见 `packages/ui/src/auth/model.ts` 的文件头）。
 *
 * ## 🔴 为什么不 import `@heyta/domain` 的 `ParentChangeRejection`
 *
 * `packages/ui` **已经**依赖 `@heyta/domain`（`task-order.ts` 就是这么用的），
 * 所以技术上可以 import。**但这里按字符串收**：本模块的契约是
 * "给我一个原因字符串、我给你一个 key"，而"哪些字符串合法"由领域层的封闭集合
 * 在**调用方**保证（`tsc` 会在 `setParent` 的 catch 里把 `reason` 传进来时校验）。
 *
 * 这么做的好处是：**这一层可以在 node 环境里被单独测**，不牵连领域层的任何运行时。
 * 与 `sync/model.ts` 的 `SyncFailureMessageKey` 同一个取向。
 */

/** 改父被拒 → 共用词条 key。 */
export type SubtaskRejectionMessageKey =
  | 'common.subtask.reject.taskNotFound'
  | 'common.subtask.reject.parentNotFound'
  | 'common.subtask.reject.self'
  | 'common.subtask.reject.cycle'
  | 'common.subtask.reject.depthExceeded'
  | 'common.subtask.reject.childrenExceeded'
  | 'common.subtask.reject.unknown';

/**
 * 拒绝原因 → 词条 key。
 *
 * ⚠️ **认不出来落到 `unknown`，不编一句**（与 `authFailureMessageKey` 同）。
 * 新增一个拒绝原因时这里不会自动跟上 —— 那是**故意的**：
 * 逼人来看一眼"这个新原因该对用户说什么"。
 */
export function subtaskRejectionMessageKey(reason: string | undefined): SubtaskRejectionMessageKey {
  switch (reason) {
    case 'task_not_found':
      return 'common.subtask.reject.taskNotFound';
    case 'parent_not_found':
      return 'common.subtask.reject.parentNotFound';
    case 'self':
      return 'common.subtask.reject.self';
    case 'cycle':
      return 'common.subtask.reject.cycle';
    case 'depth_exceeded':
      return 'common.subtask.reject.depthExceeded';
    case 'children_exceeded':
      return 'common.subtask.reject.childrenExceeded';
    default:
      return 'common.subtask.reject.unknown';
  }
}

/**
 * 从 `setParent` 抛出的错误里取出**机器可读的原因**。
 *
 * `packages/app-host` 抛的是 `Error('改父被拒绝（cycle）：a → b')` ——
 * 原因在括号里，可机器定位；后面那半句是给人看的上下文。
 *
 * 🔴 **不让界面去 `includes('cycle')`**：那会把"原因"与"任何提到这个词的文案"
 * 混在一起（错误消息里带任务标题时就可能误判）。所以解析只在这里做一次，
 * 且**只认 `（…）` 里那一整个词**。
 *
 * @returns 原因字符串；认不出来返回 `undefined`（调用方落到 `unknown`）。
 */
export function rejectionReasonOf(error: unknown): string | undefined {
  const message = error instanceof Error ? error.message : String(error);
  const match = /（([a-z_]+)）/.exec(message);
  return match?.[1];
}