/**
 * 助手会话消息的**判定**（纯函数，零依赖）
 * ==========================================
 *
 * `packages/domain/src/entities.ts` 里的 `AssistantTurn` 只是形状；"这条消息该怎么显示、
 * 本机能不能确认它"全在本文件。理由与 `events.ts` / `reminders.ts` 完全相同：
 * **判定只有一份**，壳里再判一次就会漂（AGENTS §3.5 记着两次同形状的代价）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 本文件独占的两条产品裁决（ADR-0045 D-4 (ii)，产品负责人 2026-10-05 拍"做"）
 *
 * 1. **改动提案的可确认性只在产生它的那台设备上。**
 *    从别的设备同步回来的、**未确认**的提案，一律按"已过期"呈现，不给确认按钮。
 *    这不是保守，是那条卡片根本没有可确认的资格：它要改的是**那台设备当时看见的**
 *    一个实体，而本机既没有那次读、也没有那次出境同意。
 *    （D-4 (i) 已经定了"未确认的提案不跨过一次页面重载"，见
 *    `apps/web/src/features/ai/assistant-history.ts` 文件头第 4 节 —— 本条是它在
 *    **跨设备**这个维度上的同一件事。）
 *
 * 2. **目的地性质是这条消息的一部分，不是会话的一部分。**
 *    换端点的两台设备合并历史时，"这句是谁答的"必须逐条可辨：本机 Ollama 答的、
 *    用户自己的远端答的、我们托管的答的，是**三件不同的事**（ADR-0006）。
 *    🔴 缺席一律按 `'unknown'`，**不猜** `'local'` —— 把"不知道"读成"没出境"，
 *    正好是 ADR-0006 §2 花力气拦住的那类谎。
 * ─────────────────────────────────────────────────────────────────────────
 */

import type {
  AssistantTurn,
  AssistantTurnDestinationKind,
  AssistantTurnDisposition,
  AssistantTurnRole,
} from './entities.js';

/** 角色封闭词表。与 `ChatItem` 的四个判别分支逐字同名（对账判据见文件头那条注释）。 */
export const ASSISTANT_TURN_ROLES = [
  'user',
  'assistant',
  'proposal',
  'error',
] as const satisfies readonly AssistantTurnRole[];

/**
 * 目的地封闭词表 = `@heyta/ai` 的 `DestinationDisclosure['kind']` 三档 + `'unknown'`。
 *
 * 🔴 **没有"局域网"这一档**：`supply.ts` 的 `isLoopbackEndpoint()` 只认字面回环，
 * 局域网主机名按既有裁决判成远端（Joplin 先例：`.local` 证明不了"这是你这台机器"）。
 * 在这里加一档会把那个裁决悄悄推翻 —— 词表要加档，先改 `supply.ts` 并改它的判据。
 */
export const ASSISTANT_TURN_DESTINATION_KINDS = [
  'local',
  'third-party-endpoint',
  'heyta-cloud',
  'unknown',
] as const satisfies readonly AssistantTurnDestinationKind[];

/** 提案处置封闭词表。🔴 刻意没有 `'expired'` —— 过期是派生结论，不是数据（见文件头）。 */
export const ASSISTANT_TURN_DISPOSITIONS = [
  'pending',
  'confirmed',
  'rejected',
] as const satisfies readonly AssistantTurnDisposition[];

/** 文本上限：一条消息不是文档。超限在**写入侧**拒绝，而不是让同步带上它。 */
export const MAX_ASSISTANT_TURN_TEXT_CHARS = 8_000;

const includes = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (list as readonly string[]).includes(value);

/** 读取时的运行时默认值（AGENTS §3.3：每一格都可能是某个旧宿主没写的）。 */
export function assistantTurnRoleOf(turn: AssistantTurn): AssistantTurnRole {
  // ⚠️ 默认 `'assistant'` 而不是报错：落库的一条**没有角色**的消息，
  // 最可能的解释是"旧版本没写这一格"，而把它整个丢掉会让历史出现空洞 ——
  // 用户看到的历史少了几句，且没有任何一层会说不止（§7 那条"断言只验写了什么、
  // 不验少了什么"的形状）。按最无害的档位显示，文本仍然完整可读。
  return includes(ASSISTANT_TURN_ROLES, turn.role) ? turn.role : 'assistant';
}

export function assistantTurnDestinationOf(turn: AssistantTurn): AssistantTurnDestinationKind {
  return includes(ASSISTANT_TURN_DESTINATION_KINDS, turn.destinationKind)
    ? turn.destinationKind
    : // 🔴 不猜 `'local'`，理由见文件头裁决 2。
      'unknown';
}

export function assistantTurnDispositionOf(turn: AssistantTurn): AssistantTurnDisposition {
  return includes(ASSISTANT_TURN_DISPOSITIONS, turn.disposition) ? turn.disposition : 'pending';
}

/** 排序键：本机写入的会话内时刻，缺席退回 op 派生的 `createdAt`（它一定在）。 */
export function assistantTurnOrderAt(turn: AssistantTurn): number {
  return typeof turn.at === 'number' && Number.isFinite(turn.at) ? turn.at : turn.createdAt;
}

/** 是不是"改动提案"那一档（唯一需要判可确认性的角色）。 */
export function assistantTurnIsProposal(turn: AssistantTurn): boolean {
  return assistantTurnRoleOf(turn) === 'proposal';
}

/**
 * 🔴 这条提案**在这台设备上**能不能确认 —— D-4 (ii) 的那一条硬规则。
 *
 * 三个条件缺一不可：
 *   1. 它是提案；
 *   2. 它还没有处置（`'pending'`）—— 已确认/已拒绝的卡片本来就没有可点的按钮；
 *   3. **写它的那台设备就是本机**。
 *
 * ⚠️ 第 3 条用的是载荷里显式的 `originClientId`，不是归约器的 `_lastClientId`
 * （理由逐条写在 `AssistantTurn.originClientId` 上）。
 * ⚠️ `originClientId` 缺席（老数据/旧宿主没写）时**判不可确认**，而不是"当成自己的"：
 * 猜错的方向是"少一个能点的按钮"，而另一个方向是"在没参与生成的设备上写进 op-log"。
 */
export function assistantTurnIsConfirmableHere(
  turn: AssistantTurn,
  localClientId: string,
): boolean {
  if (!assistantTurnIsProposal(turn)) return false;
  if (assistantTurnDispositionOf(turn) !== 'pending') return false;
  if (typeof turn.originClientId !== 'string' || turn.originClientId === '') return false;
  return turn.originClientId === localClientId;
}

/**
 * 这条消息在这台设备上要不要按**过期**呈现（卡片留着、确认按钮去掉）。
 *
 * 🔴 只有"别处写的、未确认的提案"才是过期。**自己写的未确认提案不是过期** ——
 * 那正是用户正准备点确认的那一张；在这里把它一起标掉，就把本机唯一的正常路径打断了。
 * 界面用这两个函数而不是自己判断：把它们写成一条"未确认就禁用"的粗规则，
 * 症状是"在自己设备上也确认不了"，而测试照样能绿（因为它只断言了禁用态）。
 */
export function assistantTurnIsExpiredHere(
  turn: AssistantTurn,
  localClientId: string,
): boolean {
  if (!assistantTurnIsProposal(turn)) return false;
  if (assistantTurnDispositionOf(turn) !== 'pending') return false;
  return !assistantTurnIsConfirmableHere(turn, localClientId);
}

/** 未删除的消息（墓碑保留字段，与 `aliveEvents` 同一条理由：回收站/导出要能读到它）。 */
export function aliveAssistantTurns(turns: readonly AssistantTurn[]): AssistantTurn[] {
  return turns.filter((turn) => turn.deletedAt === undefined);
}

/**
 * 这一段会话的消息，按**展示顺序**。
 *
 * ⚠️ 没有 `sessionId` 的消息**不属于任何一段会话**，所以被排除，
 * 而不是被塞进"当前会话" —— 后者会让新会话凭空多出几条老消息，
 * 而"新会话是空的"是 D-4 (i) 已经对用户承诺过的事。
 */
export function assistantTurnsOfSession(
  turns: readonly AssistantTurn[],
  sessionId: string,
): AssistantTurn[] {
  return sortAssistantTurns(
    aliveAssistantTurns(turns).filter((turn) => turn.sessionId === sessionId),
  );
}

/**
 * 三段排序：会话内时刻 → 文本无关的稳定值 → **id 字典序兜底**。
 *
 * 🔴 第三段不是可选的整洁癖：`at` 是毫秒，同一毫秒写两条（用户连点、
 * 或一条消息与其紧随的提案）在对端并发回来时**必然**出现。
 * 少了 id 这一段，同一段会话在两台设备上会给出两种顺序（§2.4 的先例，
 * `sortEventsForDisplay` / `sortNotesForDisplay` 都是三段）。
 */
export function sortAssistantTurns(turns: readonly AssistantTurn[]): AssistantTurn[] {
  return [...turns].sort((a, b) => {
    const atA = assistantTurnOrderAt(a);
    const atB = assistantTurnOrderAt(b);
    if (atA !== atB) return atA - atB;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** 写入侧拒绝原因。**封闭**：新原因必须是新成员，不许退回 `string`。 */
export type AssistantTurnRejection =
  | 'empty-text'
  | 'too-long-text'
  | 'invalid-role'
  | 'invalid-destination'
  | 'invalid-disposition'
  | 'invalid-session-id'
  | 'proposal-needs-tool-name';

/**
 * 一条要落库的消息合不合法。
 *
 * 🔴 为什么在**写入侧**判而不是读侧兜：载荷一旦进了 op-log 就同步到所有设备，
 * 而"某台设备上根本渲染不出来的一条消息"是唯一一种**四个端都读不回来、
 * 又没有一条日志说它被拒绝过**的失效（AGENTS #20 的形状）。
 * 抛错的代价是"这次没写进去，用户再说一遍"，静默的代价是永远查不到。
 */
export function assistantTurnRejection(turn: {
  sessionId?: string;
  role?: string;
  text?: string;
  destinationKind?: string;
  disposition?: string;
  toolName?: string;
}): AssistantTurnRejection | undefined {
  if (typeof turn.text !== 'string' || turn.text === '') return 'empty-text';
  if (turn.text.length > MAX_ASSISTANT_TURN_TEXT_CHARS) return 'too-long-text';
  if (turn.role !== undefined && !includes(ASSISTANT_TURN_ROLES, turn.role)) {
    return 'invalid-role';
  }
  if (
    turn.destinationKind !== undefined &&
    !includes(ASSISTANT_TURN_DESTINATION_KINDS, turn.destinationKind)
  ) {
    return 'invalid-destination';
  }
  if (
    turn.disposition !== undefined &&
    !includes(ASSISTANT_TURN_DISPOSITIONS, turn.disposition)
  ) {
    return 'invalid-disposition';
  }
  if (turn.sessionId !== undefined && turn.sessionId === '') return 'invalid-session-id';
  // 提案卡片上必须写着"这是要改什么"，否则用户面对的是一张无法理解的确认框。
  if (turn.role === 'proposal' && (turn.toolName === undefined || turn.toolName === '')) {
    return 'proposal-needs-tool-name';
  }
  return undefined;
}
