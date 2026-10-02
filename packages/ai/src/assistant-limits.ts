/**
 * 对话式助手的**硬上界**
 * =======================
 *
 * 🔴 这三个数字是本 ADR-0045 §2.3 的直接对策，不是性能调优：
 * 没有上界的多步循环，**出境量由模型决定**，而 ADR-0010 的立场是
 * 出境量由**用户批准的集合**决定。所以上界必须存在、必须可测、
 * 并且触顶时**明说"我停在这里"** —— 静默截断等于悄悄改变发出去的东西。
 *
 * 三个上界各自拦的是不同的失控形状：
 *
 * | 常量 | 拦的是 | 触顶时用户的处境 |
 * |---|---|---|
 * | `MAX_ASSISTANT_TOOL_STEPS` | 模型反复"再查一个"不收尾 | 看到"我查了 N 步还没定下来"，可以改问法 |
 * | `MAX_ASSISTANT_MESSAGES` | 长会话把历史整个反复送出（每步都带全量历史） | 知道是会话太长，新开会话就能继续 |
 * | `MAX_ASSISTANT_EGRESS_BYTES` | **单次请求的出境量**（一步读出 500 条任务再回送） | 明确知道哪一步被停，而不是数据已经发了 |
 *
 * ⚠️ 三个都放在 `packages/ai`（出境层）而不是 `packages/app-host`（循环层）：
 * 它们约束的是"离开设备的东西"，与谁在驱动循环无关。循环层只是**消费**它们。
 * 放在调用方就等于每个调用方各定一套上界 —— 那正是本仓库反复付学费的形状。
 */

/** 一次用户轮次内允许的最大工具步数（读步）。写提案不计入 —— 写**至多一个**且由循环单独管。 */
export const MAX_ASSISTANT_TOOL_STEPS = 6;

/** 一次请求允许携带的最大消息条数（含系统提示与历史）。 */
export const MAX_ASSISTANT_MESSAGES = 40;

/**
 * 单次请求体的**UTF-8 字节**上限。
 *
 * ⚠️ 单位必须写死成字节而不是字符数：中文一条 3 字节，按字符算等于把出境量
 * 低估三倍（本仓库对"阈值要钉死计数单位"有账）。
 *
 * 这个量级的选择理由：`list_tasks` 默认 `limit` 50 条、每条只出 6 个字段，
 * 再加系统提示与工具说明，正常一轮远到不了；能到的是"把全量任务回送第二遍"。
 */
export const MAX_ASSISTANT_EGRESS_BYTES = 200_000;

/** 触顶的三种原因。**每个都是一个独立的、可展示的结论**，不共用 `network`。 */
export type AssistantLimit = 'tool-steps' | 'messages' | 'egress-bytes';

/** 字符串的 UTF-8 字节数（不是 `.length` —— 那是 UTF-16 码元数）。 */
export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/**
 * 这段请求体有没有超出出境上界。
 *
 * 🔴 判据吃的是**将要发出去的那段 JSON**，不是它的某个"估计值"。
 * 估算是另一份事实源，会漂。
 */
export function exceedsEgressBudget(serializedBody: string): boolean {
  return utf8ByteLength(serializedBody) > MAX_ASSISTANT_EGRESS_BYTES;
}

/** 给用户看的那句"我为什么停下来了"的**原因码**对应的说明键。 */
export function assistantLimitLabel(limit: AssistantLimit): string {
  switch (limit) {
    case 'tool-steps':
      return `tool-steps:${String(MAX_ASSISTANT_TOOL_STEPS)}`;
    case 'messages':
      return `messages:${String(MAX_ASSISTANT_MESSAGES)}`;
    case 'egress-bytes':
      return `egress-bytes:${String(MAX_ASSISTANT_EGRESS_BYTES)}`;
  }
}
