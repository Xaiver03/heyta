/**
 * 同步失败原因 → 词条
 * =====================
 *
 * 🔴 这条通道的形态和 `features/shell/error-hint.ts`、`features/settings/health-copy.ts`
 * **一模一样**：壳里渲染的是 `status.message` —— 一个**变量**，
 * 而它曾经是 `packages/sync-client` 里的中文。
 *
 * 原来的代码是：
 *
 * ```tsx
 * return t('web.sync.status.errorRetryable', { message: status.message });
 * ```
 *
 * 中文界面下看不出问题（读起来正是"同步出错：未设置端到端加密口令……"），
 * 但英文界面会变成中英混排：`Sync error: 未设置端到端加密口令，已停止同步…`。
 * 而门禁扫不到它 —— 门禁查的是字面量，这里渲染的是变量。
 *
 * 现在：**已知原因整句走词条**，`message` 只留给 `'unexpected'`
 * （那里它是真正的诊断数据，不是我们写的文案）。
 *
 * ⚠️ 为什么这个映射在两个壳里各写一份，而不是放进 `packages/i18n`：
 * `packages/i18n` 是**领域无关**的，让它 import `@heyta/sync-client` 的
 * `SyncFailureReason` 会把词条表和一个业务包焊死。词条 key 是共享的
 * （`common.sync.error.*`），所以句子不会漂移；这里只有 5 行路由。
 * 漏一个成员会**编译报错**（`Record` 是穷尽的）。
 */

import type { MessageKey } from '@heyta/i18n';
import type { SyncFailureReason } from '@heyta/sync-client';

/** 已知原因 → 词条。`'unexpected'` 不在这里，它有专门的诊断通道。 */
export const SYNC_FAILURE_KEY: Record<Exclude<SyncFailureReason, 'unexpected'>, MessageKey> = {
  'not-configured': 'common.sync.error.notConfigured',
  'not-signed-in': 'common.sync.error.notSignedIn',
  'no-encryption-password': 'common.sync.error.noPassword',
  'local-op-missing': 'common.sync.error.localOpMissing',
  'remote-version-unavailable': 'common.sync.error.remoteVersionUnavailable',
  'undecryptable-ops': 'common.sync.error.undecryptableOps',
};