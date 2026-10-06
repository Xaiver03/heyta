import type { I18nValue } from '@heyta/i18n';
import { syncFailureMessageKey, type SyncStatusLike } from '@heyta/ui';

/**
 * 同步状态 → 用户能读、能行动的句子。
 *
 * 🔴 这段话原先由 `features/sync/store.ts` 的 `describeStatus` 在**非 UI 层**
 * 拼成中文返回，组件直接渲染 —— 英文界面因此永远显示中文。
 * 现在按"state 只带数据、句子在壳里拼"的纪律全部搬到这里：
 * `SyncStatus` 本身是结构化的判别联合，措辞属于壳。
 *
 * ⚠️ **哪些状态、哪些动作**不在这里判断：那是 `@heyta/ui` 的
 * `syncStatusAffordances`（有单测）。这里只把状态说成人话。
 *
 * ⚠️ `error.message` 其余情况仍是**数据**（来自网络或服务端的技术串），
 * 原样带进句子里，不编也不映射。
 *
 * 🔴 2026-10-06（H9 第 3 刀）从 `SyncBar.tsx` 抽出来放在这里，是因为现在有两个
 * 消费者：rail 底部那枚（`aria-label` + hover 标签）和 设置 → 同步 那一节里的
 * 状态条。**措辞只有一份** —— 两处各写一遍的话，"未配置"和"还没配置"会在
 * 同一个屏幕上同时出现，而那正是这一仓反复记过的形状（AGENTS §3.5）。
 */
export function describeSyncStatus(status: SyncStatusLike, t: I18nValue['t']): string {
  switch (status.kind) {
    case 'idle':
      return t('web.sync.status.idle');
    case 'syncing':
      // 下载与上传是两件事，措辞必须分开。
      return status.phase === 'download'
        ? t('web.sync.status.downloading')
        : t('web.sync.status.uploading');
    case 'synced':
      return t('web.sync.status.synced');
    case 'offline':
      return t('web.sync.status.offline');
    case 'conflict': {
      // 🔴 词条表没有 ICU：1 处冲突是最常见的情形，必须分支到单数兄弟词条。
      // 不写 `t(count === 1 ? 'a' : 'b')` —— 那样两种形状都认不出（见门禁文件头）。
      const count = status.conflicts?.length ?? 0;
      if (count === 1) return t('web.sync.status.conflictOne', { count });
      return t('web.sync.status.conflict', { count });
    }
    case 'error': {
      // 🔴 已知原因：**整句**走词条，映射只有一处（`@heyta/ui` 的
      // `syncFailureMessageKey`，与移动端共用）。不要退回成
      // `t('web.sync.status.errorRetryable', { message: status.message })` ——
      // 那会把包里的中文插进英文句子里（中英混排），而门禁扫不到这种变量渲染。
      const known = syncFailureMessageKey(status.reason);
      if (known !== undefined) return t(known);
      // 意外异常：`message` 是诊断数据（不是文案），当参数带进来。
      return t('web.sync.status.errorRetryable', { message: status.message ?? '' });
    }
  }
}
