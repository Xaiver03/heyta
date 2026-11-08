/**
 * ⌘Z 的失败说明（R19）
 * ====================
 *
 * ## 为什么单独一枚纯函数
 *
 * 撤销的结果是 `UndoOutcome` 的四态封闭词表（`packages/op-log/src/history.ts`），
 * 每个状态要读的话都不一样。把这层映射塞进 `App.tsx`（3900 行、每次改动都在那里汇合）
 * 的话，它只能靠人读，而"漏掉一个分支"的表现是**静默无反应** ——
 * 用户按了 ⌘Z，什么都没发生，也不会有人报 bug。
 *
 * 拿出来以后：① 可以穷举测试；② `HistorySkipReason` 加一档时
 * TypeScript 会在这里报缺分支（映射是 `Record`，不是 `switch` + default）。
 *
 * ## 三条产品决定（写在这里，别在界面里再想一遍）
 *
 * 1. **成功什么都不说。** 撤销成功的证据是界面变回去了 ——
 *    再弹一句"已撤销"是在用户已经看见结果之后又确认一次（J1：界面不放说明）。
 * 2. **"没有可撤销的"也什么都不说。** 空栈时按 ⌘Z 是常见误按；
 *    弹提示等于把一次误按变成一次打扰。
 * 3. **没做成必须逐类具名。** "撤销失败"说不出下一步该干什么；
 *    "已被其他设备改过，先看一眼再撤"说得出来。
 *
 * ⚠️ 文案本身住在 `@heyta/i18n`（`web.feedback.history.*`），这里只给 key。
 * 共享层不 import i18n，界面层不硬编码中文 —— 这条分工与 `undo-receipt.ts` 一致。
 */

import type { HistorySkipReason, UndoOutcome } from '@heyta/op-log';
import type { MessageKey } from '@heyta/i18n';

/**
 * 引擎的五个跳过原因 → 界面那句。
 *
 * 🔴 用 `Record<HistorySkipReason, MessageKey>` 而不是 `switch`：
 * 引擎将来加第六档时，**这里会编译不过**。`switch` 会静默落进 default。
 */
const SKIP_MESSAGE: Record<HistorySkipReason, MessageKey> = {
  batch: 'web.feedback.history.skipBatch',
  snapshot: 'web.feedback.history.skipSnapshot',
  'multi-entity': 'web.feedback.history.skipMultiEntity',
  unmodeled: 'web.feedback.history.skipUnmodeled',
  'non-object-payload': 'web.feedback.history.skipPayload',
  'unsupported-op': 'web.feedback.history.skipOp',
};

/** 撤销前提不成立的两句。同样是 `Record`，理由同上。 */
const STALE_MESSAGE: Record<'entity-missing' | 'entity-changed', MessageKey> = {
  'entity-missing': 'web.feedback.history.staleMissing',
  'entity-changed': 'web.feedback.history.staleChanged',
};

/**
 * 这次撤销/重做该说哪一句。`undefined` = **什么都不说**（见文件头三条决定）。
 */
export function historyNoticeFor(outcome: UndoOutcome): MessageKey | undefined {
  switch (outcome.status) {
    case 'applied':
      return undefined;
    case 'empty':
      return undefined;
    case 'stale':
      return STALE_MESSAGE[outcome.reason];
    case 'unsupported':
      return SKIP_MESSAGE[outcome.reason];
  }
}
