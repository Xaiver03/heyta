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
 *
 * ═════════════════════════════════════════════════════════════════════════
 * 🔴 M3 第四刀（sync）收尾：本文件从"第二份定义"变成"共享判断的投影"
 *
 * 迁之前这里有两套**本地判断**，与共享 `@heyta/ui` 的 `sync/model.ts` 重复：
 *
 *   | 判断 | 迁之前（本文件） | 共享层 | 实测差异 |
 *   |---|---|---|---|
 *   | `statusTone` | 本地 `switch`：`syncing→default` / `conflict→danger` / `idle→muted` | `syncStatusSeverity`：`progress` / `attention` / `neutral` | 三行语义对不上，而**没有任何测试会红** |
 *   | 失败原因 → key | 本地 `SYNC_FAILURE_KEY` 表 | `syncFailureMessageKey` | key 相同，但"哪些原因有名字"是两份，加一个只改一端就静默漏 |
 *
 * 现在两者都改成**从共享层派生**：
 *   · `statusTone` = `syncStatusSeverity` 的纯投影（下面那张 `SEVERITY_TONE`）；
 *   · `describeSyncStatus` 的已知失败原因走 `syncFailureMessageKey`。
 * 于是「我的」屏的状态态度与 web 同步条出自**同一个判断**。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ 装不进共享层的部分（诚实记账，别假装没损失）
 *
 * 1. **测试侧要 mock `@heyta/ui`。** 本文件是宿主代码，正常 `import … from '@heyta/ui'`
 *    （Metro 解析 `dist/`，没问题）；但移动端单测跑在 **node** 里，
 *    `@heyta/ui` 的入口会拖进 `react-native` 的 Flow 源码、直接解析失败。
 *    所以 `apps/mobile/tests/sync-status-text.spec.ts` 用
 *    `vi.mock('@heyta/ui', () => import('../../../packages/ui/src/sync/model'))`
 *    把裸导入**指到共享层那个纯模块的源码**上（实测可跑，且用的是同一份实现，
 *    不是重写一份 mock）。影响：路径与文件名成了测试的隐式契约，
 *    重命名 `model.ts` 会让它红（这算好事），但读起来略绕。最小的一步是将来
 *    给 `@heyta/ui` 加一个**纯逻辑子入口**（如 `./model`），测试就不用相对路径。
 *
 * 2. **色调词汇表不等价。** 共享层给的是 `color.*-strong`（设计系统登记的
 *    **正文文字色**）；移动端 kit 的 `TextTone` 只有 `danger` / `success`
 *    映射到**非 strong** 的图形色，且没有 info 一档。所以投影后：
 *    `attention → warning`（= `color.warning-strong`，与 web **逐 token 相同**）、
 *    `neutral → muted`（相同），但 `failure` / `success` / `progress` 只能落到
 *    `danger` / `success` / `default`，与 web 的 `*-strong` / `info-strong`
 *    仍是**同一个语义、不同的色阶**。影响：「我的」屏那三类的文字对比度
 *    与 web 不完全一致。最小的一步：给 kit 的 `TextTone` 补
 *    `danger-strong` / `success-strong` / `info` 三档（或让 `danger`/`success`
 *    直接指向 `*-strong`）—— 那要动 `apps/mobile/src/ui/kit.tsx`，
 *    不在本轮文件白名单里，故只记账。
 *
 * 3. **失败原因的编译期穷尽性从"映射表"降级成"见证常量"。**
 *    迁之前 `Record<Exclude<SyncFailureReason,'unexpected'>, MessageKey>`
 *    会在 sync-client 新增原因时**编译报错**。共享层的表是 `Record<string,…>`，
 *    不再有这个保证（`model.ts` 文件头解释了为什么它刻意不复制那份联合）。
 *    这里用 `KNOWN_FAILURE_REASON_COVERAGE` 把"每个已知原因都被意识到"这条
 *    重新钉成编译期检查 —— 它**不映射任何词条**，只保证新增成员时会红，
 *    提醒去看共享表要不要补一条。最小的一步：让 sync-client 导出运行时原因清单，
 *    或在 `packages/ui/tests` 里按类型枚举（那需要一条新依赖，过不了本轮白名单）。
 * ═════════════════════════════════════════════════════════════════════════
 */

import type { SyncStatus } from '@heyta/sync-client';
import type { SyncFailureReason } from '@heyta/sync-client';
import { syncFailureMessageKey, syncStatusSeverity, type SyncSeverity } from '@heyta/ui';

import type { Translate } from '../i18n/translate';

/**
 * 已知失败原因的**编译期穷尽性见证**（见文件头第 3 条）。
 *
 * ⚠️ 它**不是**第二份"原因 → 词条"映射 —— 映射只有共享层的
 * `syncFailureMessageKey` 一份。这里只列出成员本身，漏一个就让 `tsc` 报错。
 */
const KNOWN_FAILURE_REASON_COVERAGE = {
  'not-configured': true,
  'not-signed-in': true,
  'no-encryption-password': true,
  'local-op-missing': true,
  'remote-version-unavailable': true,
  'undecryptable-ops': true,
  'undecryptable-page': true,
  'upload-rejected': true,
  'unauthorized': true,
  // 🔴 G-12：被本机同意闸门拦下、一个请求都没发。漏这一条 `satisfies` 就会编译报错 ——
  // 这正是这个常量存在的理由（新增原因必须被"意识到一次"）。
  'consent-required': true,
  // 🔴 G-27：条款更新了、账号还没补签。漏这一条 `satisfies` 就编译报错。
  'legal-reconfirm-required': true,
} satisfies Record<Exclude<SyncFailureReason, 'unexpected'>, true>;
void KNOWN_FAILURE_REASON_COVERAGE;

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
    case 'error': {
      // 🔴 已知原因整句走**共享**的 `common.sync.error.*`（`syncFailureMessageKey`
      // 是那条路由唯一的实现，与 web 同一份）。意外异常这里只给一句笼统的：
      // 这是一行状态文字，塞不下诊断细节 —— 细节仍在 `status.message` 里，
      // 需要时可以在别处显示（**刻意取舍**，不是丢信息）。
      if (status.reason === 'unexpected') return t('mobile.sync.error');
      // 共享表认不出来（将来的新原因）也走那句笼统的 —— 以前本地表查不到会
      // 直接把 `undefined` 喂给 `t`，那是更糟的失败方式。
      const key = syncFailureMessageKey(status.reason);
      return key === undefined ? t('mobile.sync.error') : t(key);
    }
    default: {
      // 穷尽性检查：`SyncStatus` 新增成员时这里会**编译报错**，
      // 而不是安静地显示一句空话。
      const never: never = status;
      return String(never);
    }
  }
}

/**
 * 文字语气 —— **它是 `syncStatusSeverity` 的纯投影，不是第二份判断。**
 *
 * 🔴 离线和"还没同步"都是 `neutral`（不是错误）：本地优先的应用离线是
 * 正常工作状态，标红会让用户以为出了问题。
 * 🔴 冲突是 `attention` → `warning`，**不是** `danger`：两边数据都在，
 * 只是需要用户选一下。这与 web 同步条是同一个态度。
 *
 * ⚠️ 词汇表不等价的那部分（`failure`/`success`/`progress` 的色阶）见文件头第 2 条。
 */
export type SyncStatusTone = 'default' | 'muted' | 'danger' | 'success' | 'warning';

/** 严重度 → 移动端 kit 的语气。**唯一的一处映射。** */
const SEVERITY_TONE: Record<SyncSeverity, SyncStatusTone> = {
  neutral: 'muted',
  progress: 'default',
  success: 'success',
  // 需要用户做一件事，但不是故障 —— 与 web 的 `color.warning-strong` 同 token。
  attention: 'warning',
  failure: 'danger',
};

export function statusTone(status: SyncStatus): SyncStatusTone {
  return SEVERITY_TONE[syncStatusSeverity(status)];
}
