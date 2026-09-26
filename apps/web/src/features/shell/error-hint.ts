/**
 * 崩溃屏的建议：按**失败原因**取词条
 * ====================================
 *
 * 🔴 这一层存在的理由：崩溃屏渲染的是 `error.message` 的**原文**
 * （`main.tsx` 的 catch 分支 → `ErrorScreen`）。而 `packages/storage` 抛的中文里
 * **有一条是无条件抛的** ——
 *
 * ```
 * IndexedDB 升级被其它标签页阻塞 —— 请关闭该应用的其它窗口后重试
 * ```
 *
 * 触发条件是真实用户场景（同一个站点开了两个标签页，其中一个是旧版本）。
 * 于是**用英文界面的用户会在应用启动失败时读到一句中文**，
 * 而门禁永远扫不到它（它查字面量，这里渲染的是变量）。
 *
 * 来源侧已经给了结构化原因（`StorageError.failure.kind`，见
 * `packages/storage/src/errors.ts`），所以这里只做一件事：
 * **把 kind 映射成一个词条 key**。
 *
 * ⚠️ 为什么用 `Record<…, MessageKey>` 而不是内联三元：它是**穷尽**的 ——
 * `packages/storage` 以后加了新 kind，这里会**编译报错**，
 * 而不是悄悄退回一句笼统的建议。（三元里漏一个分支编译器不会说话。）
 *
 * ⚠️ 为什么 `undefined` 也要处理：`instanceof` 在"模块被加载了两份"时会**静默为假**
 * （这个仓库真的踩过一次双 React 的坑）。拿不到结构时退回通用那句，
 * 而不是崩在错误屏里 —— **错误屏自己不能再出错**。
 */

import type { MessageKey } from '@heyta/i18n';
import type { StorageFailure } from '@heyta/storage';

const HINT_KEY: Record<StorageFailure['kind'], MessageKey> = {
  /** 用户能自己解决：关掉别的窗口即可。 */
  'upgrade-blocked': 'web.error.storage.blockedHint',
  /** 用户无从下手的那一类：只能重启 + 把详情反馈给我们。 */
  'programming-error': 'web.error.storage.bugHint',
  /** 通用：多半是隐私模式 / 配额 / 浏览器禁用了本地数据库。 */
  'open-failed': 'web.error.storage.hint',
  'request-failed': 'web.error.storage.hint',
  'transaction-failed': 'web.error.storage.hint',
};

/**
 * 崩溃屏该给用户哪一句建议。
 *
 * @param failure 结构化原因；`undefined` 表示拿不到（不是 `StorageError`）。
 */
export function storageHintKey(failure: StorageFailure | undefined): MessageKey {
  return failure === undefined ? 'web.error.storage.hint' : HINT_KEY[failure.kind];
}