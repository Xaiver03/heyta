/**
 * 同步状态 → 人话
 * =================
 *
 * `SyncStatus` 是给程序看的判别联合；这个文件把它变成用户能读、能行动的句子。
 *
 * 🔴 **为什么要单独一个文件、而不是在界面里写 `switch`：**
 * 状态文案会被多个地方用到（「我的」、将来的同步条、通知）。
 * 各写一份 `switch` 就是本项目已经吃过两次亏的那种漂移
 * （见 AGENTS.md §3.5）—— 而这里的漂移后果是"同一个状态在两处说法不同"，
 * 用户会以为它们是两件事。
 *
 * 🔴 **每种失败都必须说清是哪一种。** "同步失败"这四个字没有任何行动价值：
 * 未配置要去填设置、口令错误要去核对口令、服务端连不上要去检查网络或地址。
 * 三者混成一句话，用户唯一能做的是反复点同步。
 */

import type { SyncStatus } from '@heyta/sync-client';

import type { MessageKey } from '@heyta/i18n';
import type { SyncFailureReason } from '@heyta/sync-client';

import type { Translate } from '../i18n/translate';

/**
 * 同步失败原因 → 词条。
 *
 * ⚠️ 和 `apps/web/src/features/sync/sync-failure-copy.ts` 是同一份路由，
 * **刻意各写一份**：`packages/i18n` 是领域无关的，不能让它 import
 * `@heyta/sync-client`。key 是共享的（`common.sync.error.*`），句子不会漂移。
 * 漏一个成员会**编译报错**（`Record` 穷尽）。
 */
const SYNC_FAILURE_KEY: Record<Exclude<SyncFailureReason, 'unexpected'>, MessageKey> = {
  'not-configured': 'common.sync.error.notConfigured',
  'not-signed-in': 'common.sync.error.notSignedIn',
  'no-encryption-password': 'common.sync.error.noPassword',
  'local-op-missing': 'common.sync.error.localOpMissing',
  'remote-version-unavailable': 'common.sync.error.remoteVersionUnavailable',
  'undecryptable-ops': 'common.sync.error.undecryptableOps',
  'undecryptable-page': 'common.sync.error.undecryptablePage',
  'upload-rejected': 'common.sync.error.uploadRejected',
};

export function describeSyncStatus(status: SyncStatus, t: Translate): string {
  switch (status.kind) {
    case 'idle':
      return t('mobile.sync.idle');
    case 'syncing':
      return status.phase === 'download'
        ? t('mobile.sync.downloading')
        : t('mobile.sync.uploading');
    case 'synced':
      return t('mobile.sync.synced');
    case 'offline':
      return t('mobile.sync.offline');
    case 'conflict': {
      /**
       * 🔴 英文单复数：词条表没有 ICU，只能调用方分支到单数兄弟词条。
       * 一处冲突是最常见的情形，少了这条英文会写 "1 conflicts"。
       */
      const count = status.conflicts.length;
      return t(count === 1 ? 'mobile.sync.conflictOne' : 'mobile.sync.conflict', { count });
    }
    case 'error':
      // 🔴 已知原因整句走词条（和 web 共用 `common.sync.error.*` 那五条）。
      // 意外异常这里只给一句笼统的：这是一行状态文字，塞不下诊断细节 ——
      // 细节仍在 `status.message` 里，需要时可以在别处显示（**刻意取舍**，不是丢信息）。
      return status.reason === 'unexpected'
        ? t('mobile.sync.error')
        : t(SYNC_FAILURE_KEY[status.reason]);
    default: {
      // 穷尽性检查：`SyncStatus` 新增成员时这里会**编译报错**，
      // 而不是安静地显示一句空话。
      const never: never = status;
      return String(never);
    }
  }
}

/**
 * 状态对应的文字语气。
 *
 * 只有 `error` / `conflict` 用 danger —— `offline` **不算错误**：
 * 本地优先的应用离线是正常工作状态，标红会让用户以为出了问题。
 */
export function statusTone(status: SyncStatus): 'default' | 'muted' | 'danger' | 'success' {
  switch (status.kind) {
    case 'synced':
      return 'success';
    case 'error':
    case 'conflict':
      return 'danger';
    case 'idle':
    case 'offline':
      return 'muted';
    case 'syncing':
      return 'default';
    default: {
      const never: never = status;
      return String(never) as 'default';
    }
  }
}