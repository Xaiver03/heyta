/**
 * 长会话历史压缩（确定性，零额外出境）
 * ======================================
 *
 * 对照参照系统（创业OS `agent-context-assembly/compactor`、WeKnora `agent/compaction`）：
 * 黑塔原先只有三个硬上界，`MAX_ASSISTANT_MESSAGES` 一撞就**整轮硬停**（"这段会话太长，新开一段"）。
 * 本模块把"硬停"换成"先压缩再发"：
 *
 * - **确定性、不调模型**：不新增任何出境目的、不新增一次模型调用、不新增计费；
 * - 保留**最近 N 条原文**，更早的折叠成**一条摘要**（条数统计 + 较早最后一句用户输入的截断）；
 * - 只在历史超过阈值时才动；没超过则原样返回（`compacted:false`）。
 *
 * 🔴 为什么不做"模型摘要"：那会多一次出境（且要并进一次性披露与字节预算），
 * 对一个本地优先、出境按"用户批准集合"裁决的产品，是拿隐私换体验且要重开一层闸。
 * 确定性折叠先把"硬停"这个明确的坏体验去掉，且完全在既有出境集合内。
 *
 * ⚠️ 摘要行是 `assistant` 角色（历史里只有 user/assistant 两种角色）：它描述"更早聊过什么"，
 * 不是用户说的话，所以不能伪装成 `user`。信息损失是刻意的，用户仍可"新会话"从头来。
 */

/** 触发压缩的历史条数阈值（超过才压缩）。 */
export const ASSISTANT_COMPACT_TRIGGER = 24;
/** 压缩后保留的最近原文条数。 */
export const ASSISTANT_COMPACT_KEEP_RECENT = 10;
/** 摘要里引用"较早最后一句用户输入"时的截断长度。 */
export const ASSISTANT_COMPACT_SNIPPET_MAX = 160;

export interface CompactableMessage {
  readonly role: 'user' | 'assistant';
  readonly text: string;
}

export interface CompactionResult<T extends CompactableMessage> {
  /** 压缩后的历史（未触发压缩时与入参**同一引用**）。 */
  readonly history: readonly T[];
  readonly compacted: boolean;
  /** 被折叠进摘要的原始消息条数（0 = 没压缩）。 */
  readonly droppedCount: number;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

/**
 * 把超阈值的历史折叠成「一条摘要 + 最近 N 条原文」。
 * 纯函数：不读时钟、不碰网络、不依赖宿主 —— 因此可单独单测。
 */
export function compactAssistantHistory<T extends CompactableMessage>(
  history: readonly T[],
): CompactionResult<T> {
  if (history.length <= ASSISTANT_COMPACT_TRIGGER) {
    return { history, compacted: false, droppedCount: 0 };
  }
  const keep = Math.min(ASSISTANT_COMPACT_KEEP_RECENT, history.length);
  const dropped = history.slice(0, history.length - keep);
  const recent = history.slice(history.length - keep);
  const userCount = dropped.filter((m) => m.role === 'user').length;
  const assistantCount = dropped.length - userCount;
  const lastOldUser = [...dropped].reverse().find((m) => m.role === 'user');
  const snippet =
    lastOldUser === undefined
      ? ''
      : `；较早最后一句用户输入：${truncate(lastOldUser.text, ASSISTANT_COMPACT_SNIPPET_MAX)}`;
  const summary = {
    role: 'assistant',
    text: `（更早的对话已压缩：共 ${String(dropped.length)} 条（用户 ${String(userCount)} / 助手 ${String(assistantCount)}）${snippet}）`,
  } as T;
  return { history: [summary, ...recent], compacted: true, droppedCount: dropped.length };
}
