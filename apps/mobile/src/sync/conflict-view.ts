/**
 * 冲突解决界面的视图模型（纯函数）
 * ==================================
 *
 * `SyncStatus.conflict` 里的 `ConflictInfo[]` 是给程序看的；这个文件把它变成
 * **手机上能读、能据此做选择**的东西。和 `status-text.ts` 同样的理由抽出来：
 * 规则要能被单测钉住，而不是散在组件的 JSX 里。
 *
 * ═════════════════════════════════════════════════════════════════════════
 * 🔴 这一版要解决的具体缺陷
 *
 * 「我的」屏原来在冲突时显示的是：
 *
 *     需要你选择保留哪一边。解决界面尚未实现 —— 数据没有丢失，
 *     但它会一直停在待上传队列里。
 *
 * 这句话诚实，但**是一条死路**：用户被告知需要做选择，却无处可选。
 * 数据两边都没丢，但谁也没法往下走。
 * ═════════════════════════════════════════════════════════════════════════
 *
 * 🔴 **为什么必须并排显示两边的「内容」**，而不是只显示时间戳：
 * 谁新谁旧用户判断不了"哪个才是我要的" —— 他改的是标题、备注还是完成状态，
 * 只有内容本身能告诉他。冲突界面的价值全在这一点上（与 Web 端 `ConflictDialog` 同一结论）。
 */

import {
  compareConflictFreshness,
  describeConflictPayload,
  type ConflictInfo,
} from '@heyta/sync-client';

import { formatStamp } from '../lib/date';

/** 用户能做的两个选择。与 `SyncClient.resolveConflict` 的第二个参数同形。 */
export type ConflictChoice = 'keep-local' | 'keep-remote';

export interface ConflictSideView {
  /** 界面上的标题：「本机」/「其他设备」。 */
  label: string;
  /**
   * 内容的可读摘要。
   *
   * 🔴 **`undefined` 表示"取不到"，界面必须明说。**
   * 显示成空白会让人以为"对端什么都没写"，从而做出相反的判断 ——
   * 这正是 Web 端 `ConflictDialog` 注释里记的那个坑，两端必须一致。
   */
  summary: string | undefined;
  /** 可读时刻。取不到时为 `undefined`。 */
  time: string | undefined;
  /**
   * 是否较新。
   *
   * ⚠️ **只用于视觉强调，不是裁决依据。**
   * 真正的裁决在 `sync-core` 的 LWW；这里标"较新"只是帮用户建立直觉。
   * 拿它自动选边 = 静默丢掉另一边，那是这一版明确不做的事。
   */
  isNewer: boolean;
  /** 这一侧是否真的存在。 */
  available: boolean;
}

export interface ConflictView {
  id: string;
  /** 中文实体名，如「任务」。 */
  entityLabel: string;
  /** 为什么这件事需要人来定（中文）。 */
  reasonLabel: string;
  local: ConflictSideView;
  remote: ConflictSideView;
  /** 能否选"保留本机"。 */
  canKeepLocal: boolean;
  /** 能否选"保留其他设备"。拿不到对端版本时为 `false`。 */
  canKeepRemote: boolean;
}

/**
 * 实体类型 → 中文。
 *
 * 取值来自 `@heyta/shared-schema` 的 `ENTITY_TYPES`（那份清单是唯一的）。
 * 这里**不 import 它**是因为映射表必须显式列出每个成员的文案；
 * 有测试要求本表的键与 `ENTITY_TYPES` 完全一致，漏一个就会红。
 */
export const ENTITY_LABELS: Record<string, string> = {
  TASK: '任务',
  PROJECT: '清单',
  TAG: '标签',
  NOTE: '笔记',
  TASK_REPEAT_CFG: '重复规则',
  REMINDER: '提醒',
  HABIT: '习惯',
  HABIT_LOG: '打卡记录',
  FOCUS_SESSION: '专注记录',
  GLOBAL_CONFIG: '全局设置',
  MIGRATION: '数据迁移',
  RECOVERY: '灾难恢复',
  ALL: '全量数据',
};

/**
 * 服务端/内核给的原因 → 中文。
 *
 * 🔴 **认不出来就原样显示，不编一个。**
 * `reason` 的来源有两处：服务端的 `error` 文本（`CONFLICT_*`），
 * 以及 `sync-core` 的 LWW 判定原因。枚举不完，而**编一句听起来合理的话**
 * 会让用户在错误的依据上做选择。
 */
const REASON_LABELS: Record<string, string> = {
  CONFLICT_CONCURRENT: '两台设备在对方不知情的时候都改了它',
  CONFLICT_SUPERSEDED: '这条改动基于的版本已经不是最新的了',
  'remote-timestamp-or-tie': '两边的改动时间很接近，分不出先后',
  'local-timestamp': '本机的改动更新一些',
  'remote-delete-wins': '另一台设备删除了它',
  'local-delete-wins': '本机删除了它',
  'remote-archive': '另一台设备把它归档了',
  'local-archive': '本机把它归档了',
  'local-archive-sibling': '本机把它归档了',
};

export function entityLabelOf(entityType: string): string {
  return ENTITY_LABELS[entityType] ?? entityType;
}

/**
 * 冲突原因 → 中文文案。
 *
 * 🔴 **传 `errorCode`，不要传 `reason`。** 这两个字段是两回事：
 *   - `errorCode`：机器可读（`CONFLICT_CONCURRENT`），查表命中；
 *   - `reason`：服务端那句**英文**诊断，形如
 *     `Concurrent modification detected for TASK:task-...`。
 *
 * 移动端真机验收实测：只传 `reason` 时，这张表**一次都没命中过** ——
 * 中文文案一直躺在表里，而界面上显示的是一整句英文，
 * 直接违反"整个应用都必须中文"。表在、数据通路断了，是这类缺陷的典型形状。
 *
 * `reason` 仍然接受，因为 LWW 自动判定那条路径没有错误码，
 * 它的 `reason` 本身就是编码（`remote-archive` 等）。
 */
export function reasonLabelOf(codeOrReason: string): string {
  return REASON_LABELS[codeOrReason] ?? REASON_LABELS_FALLBACK;
}

/**
 * 表里查不到时的兜底。
 *
 * 🔴 **不能回落成原始字符串**（那是英文），但也不能什么都不说 ——
 * "两边到底发生了什么"是用户做选择的前提。所以给一句**通用但仍然准确**的中文：
 * 它确实描述了所有进入这张表的冲突的共同点（两边对同一处做了不同改动）。
 * 真正的诊断信息在 `ConflictInfo.reason` 里，留给日志。
 */
const REASON_LABELS_FALLBACK = '两边对同一处做了不同的改动';

/** 位置提示，如「第 2 处，共 3 处」。 */
export function positionLabel(index: number, total: number): string {
  return `第 ${String(index + 1)} 处，共 ${String(total)} 处`;
}

/**
 * 一处冲突 → 视图模型。
 *
 * 🔴 「较新」的判定**不在这里**，而是调 `@heyta/sync-client` 的
 * `compareConflictFreshness`。理由见那个函数的注释：这条规则原本在 Web 端
 * 独有一份，移动端再写一遍就是两份实现 —— 而漂移的后果是
 * **同一个冲突在两个平台上"较新"标在不同的一侧**。
 * 一处实现、两端消费，规则本身的可失败检查在 `sync-client` 的测试里。
 */
export function toConflictView(conflict: ConflictInfo): ConflictView {
  const remoteOp = conflict.remote;
  const fresh = compareConflictFreshness(conflict.local, remoteOp);

  const local: ConflictSideView = {
    label: '本机',
    summary: describeConflictPayload(conflict.local.payload),
    time: formatStamp(conflict.local.timestamp),
    isNewer: fresh.localNewer,
    available: true,
  };

  const remote: ConflictSideView =
    remoteOp === undefined
      ? {
          label: '其他设备',
          // 🔴 取不到就是取不到，绝不退化成空字符串冒充"对端是空的"
          summary: undefined,
          time: undefined,
          isNewer: false,
          available: false,
        }
      : {
          label: '其他设备',
          summary: describeConflictPayload(remoteOp.payload),
          time: formatStamp(remoteOp.timestamp),
          isNewer: fresh.remoteNewer,
          available: true,
        };

  return {
    id: conflict.id,
    entityLabel: entityLabelOf(conflict.entityType),
    // 🔴 `errorCode ?? reason` —— 服务端冲突有错误码；LWW 自动判定的冲突
    // 没有错误码，但它的 `reason` 本身就是编码。两者共用同一张表。
    reasonLabel: reasonLabelOf(conflict.errorCode ?? conflict.reason),
    local,
    remote,
    canKeepLocal: true,
    canKeepRemote: remoteOp !== undefined,
  };
}

/**
 * 某个选择为什么不能点。`undefined` 表示可以点。
 *
 * 🔴 存在这个函数是为了让"按钮为什么是灰的"**有话说**。
 * 只把按钮置灰不给理由，用户唯一能做的是反复点它 ——
 * 与 `SyncStatus` 那种"每种失败都要说清是哪一种"是同一条纪律。
 */
export function choiceBlockedReason(
  view: ConflictView,
  choice: ConflictChoice,
): string | undefined {
  if (choice === 'keep-remote' && !view.canKeepRemote) {
    // 措辞与 Web 端 `ConflictDialog` 的「取不到这一侧的版本」保持一致 ——
    // 同一个状态在两个平台用两种说法，用户会以为是两件事。
    return '取不到对方那一版，只能先保留本机的';
  }
  return undefined;
}

/** 选择结果 → 给用户看的确认文案（解决完成后的反馈）。 */
export function describeChoice(choice: ConflictChoice): string {
  return choice === 'keep-local' ? '已保留本机这一版' : '已保留其他设备那一版';
}
