/**
 * 助手会话的跨设备实体（宿主无关）
 * =================================
 *
 * ADR-0045 的 **D-4 (ii)**：会话历史此前只落这台设备
 * （`apps/web/src/features/ai/assistant-history.ts`，文件头第 2 节明写"不进 op-log"，
 * 并把 (ii) 列为"没有拍"）。产品负责人 2026-10-05 拍了：**做**。
 * 本文件就是那条"做"的**唯一 op 构造入口**。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 为什么这个文件必须存在（而不是让 web 面板直接 `dispatch`）
 *
 * AGENTS §3.5 划的线：**"这条 op 该写哪些字段"是产品语义，不许出现在 `apps/*`。**
 * 本仓库已经为这件事付过两次学费（`apps/web` 与 `apps/node-host` 各一份任务 op 构造、
 * 两边 entityId 生成方式还漂了）。助手历史如果要接三个端，
 * 而"哪一格该不该写"各端自己决定，就会得到"手机上存的目的地档位电脑读不出来"
 * 这种**没有任何一层会报错**的分歧。所以这里是一份，宿主只注入驱动与本设备 id。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 四条由这里独占的语义决定
 *
 * 1. 🔴 **一个用户意图 = 一个 op**（AGENTS §3.4）。
 *    用户发一句 = 1 条 CRT；助手那句回来 = 另 1 条 CRT。
 *    **绝不在一次手势里 fan-out 整段历史** —— 那会把"我说过什么"变成
 *    "这台设备什么时候同步过"，并且同一句话会因为两次全量上行被写成两条不同 id 的实体
 *    （会话级实体 + 整块载荷才会有的病；一条消息一个实体从结构上不会）。
 *
 * 2. 🔴 **只追加，不重写**。没有 `setSession(turns[])` 这种 API，故意不给 ——
 *    一旦存在，某端就会用它"顺手整块保存"，而 LWW 在数组上是覆盖语义，
 *    两台设备并发追加会互相吞消息（这就是 D-4 选实体粒度的同一条理由）。
 *
 * 3. 🔴 **提案的可确认性只在产生它的那台设备上**（判定本体在
 *    `@heyta/domain` 的 `assistantTurnIsConfirmableHere`，这里只是接线）。
 *    写每条消息时把**本设备 clientId** 显式写进 `originClientId` —— 这是那条规则
 *    唯一的运行时依据。摘掉这一次写入，跨设备的过期判定就恒为真
 *    （别的设备会把每一条提案都标成过期：界面看起来"更安全"，实际是把
 *    本机的正常路径也一起打断了）。
 *
 * 4. **清除一段会话 = 一条 DEL（用 `entityIds` 批量域），不是 N 条 op**。
 *    墓碑是**要同步**的：不写墓碑的话，另一台设备离线时把那几条清掉了，
 *    对端一同步就把它们**复活**（回收站那条 `purgedAt` 的教训是同一件事的反面）。
 * ─────────────────────────────────────────────────────────────────────────
 */

import {
  assistantTurnIsConfirmableHere,
  assistantTurnIsExpiredHere,
  assistantTurnRejection,
  assistantTurnsOfSession,
  sortAssistantTurns,
  aliveAssistantTurns,
  type AssistantTurn,
  type AssistantTurnDestinationKind,
  type AssistantTurnDisposition,
  type AssistantTurnRole,
} from '@heyta/domain';
import type { EntityType } from '@heyta/shared-schema';
import { OpType } from '@heyta/sync-core';

import type { ActionContext } from './actions.js';
import { randomId } from './ids.js';

/** `appendTurn` 的入参。🔴 与领域模型的差别：这里 `role` / `text` 是**必填**的。 */
export interface NewAssistantTurn {
  /** 本段会话 id（由**这台设备**生成，见 `newSessionId()`）。 */
  sessionId?: string;
  /** 写这一格的角色。校验在写入侧（见文件头第 1 节判定 4 的同一理由）。 */
  role: AssistantTurnRole;
  /** 消息文本。空文本**抛错**：落一条空消息等于落一条四个端都显示不出来的数据。 */
  text: string;
  /** 会话内时刻。省略 = 用注入的 `now()`（**不是** `Date.now()`，见 `now` 选项）。 */
  at?: number;
  /**
   * 这一条**经手**的目的地。
   *
   * 🔴 `user` 那一档记的是"这句被发去了哪里"，`assistant` / `proposal` / `error`
   * 记的是"这句是谁答的"。合成一个字段而不是两个，是因为它们**是同一个披露事实**：
   * 这一次往哪个端点出境（ADR-0006）。省略 = `'unknown'`，由领域层按保守方向读
   * （**不**当成本机，见 `assistantTurnDestinationOf`）。
   */
  destinationKind?: AssistantTurnDestinationKind;
  /** 提案卡片对应哪个工具（`role === 'proposal'` 时必填，校验在领域层）。 */
  toolName?: string;
  /** 提案的初始处置。省略 = `'pending'`（未确认 ⇒ 对端按过期呈现）。 */
  disposition?: AssistantTurnDisposition;
}

export interface AssistantSessionActionsOptions {
  /**
   * 🔴 **本设备的 clientId** —— 提案可确认性判定的唯一依据，所以它不是可选项。
   *
   * 为什么不从 `ActionContext` 里自己拿：那个接口只有 `dispatch` / `getState`，
   * 归约器内部的 `_lastClientId` 是**元数据**而不是承诺过的形状（理由逐条写在
   * `AssistantTurn.originClientId` 上）。宿主本来就有它（`AppHost.clientId`），
   * 传一次的代价换来的是那条规则有一个读得到的落点。
   */
  clientId: string;
  /** 消息 id 生成器。可注入的理由与 `EventActionsOptions.newEventId` 相同。 */
  newTurnId?: () => string;
  /**
   * 时间源，只用于**载荷里**的 `at`（展示时刻）。
   * 🔴 op 自身的时间戳由 dispatch 负责，reducer 从不读它（§3.4 幂等重放的前提）。
   */
  now?: () => number;
}

export interface AssistantSessionActions {
  /** 生成一段新会话的 id（这台设备上，纯本地，**不写 op**）。 */
  newSessionId(): string;
  /** 追加一条消息。🔴 一次调用 = 一条 CRT op。返回新实体 id。 */
  appendTurn(input: NewAssistantTurn): Promise<string>;
  /**
   * 记录一条提案的处置（一次点击 = 一条 UPD）。
   *
   * 🔴 **写之前先判可确认性**：本机不能确认一条别的设备生成的提案。
   * 摘掉这道判定 ⇒ 跨设备的"过期"就只是界面装饰，而它必须是**写入边界**。
   */
  setDisposition(entityId: string, disposition: AssistantTurnDisposition): Promise<void>;
  /**
   * 清掉一段会话：**一条** DEL op 带着 `entityIds` 批量域（文件头判定 4）。
   *
   * @returns 被标记的条数（0 = 这段会话本机本来就没有内容，**不写空 op**）。
   */
  clearSession(sessionId: string): Promise<number>;
  /** 这一段会话的消息（未删除、展示顺序）。 */
  turnsOf(sessionId: string): AssistantTurn[];
  /** 全部会话的消息（未删除、展示顺序）。跨会话视图与导出用。 */
  allTurns(): AssistantTurn[];
  /** 本机**能不能**确认这条提案（判定在领域层，这里只接本设备 id）。 */
  isConfirmableHere(turn: AssistantTurn): boolean;
  /** 本机要不要按**过期**显示这条提案（判定在领域层）。 */
  isExpiredHere(turn: AssistantTurn): boolean;
}

/** 领域层的拒绝码 → 人话。措辞只在这里拼，界面不再各拼一遍。 */
function rejectionDetail(rejection: NonNullable<ReturnType<typeof assistantTurnRejection>>): string {
  switch (rejection) {
    case 'empty-text':
      return '文本为空（空白也算空）';
    case 'too-long-text':
      return '文本超出单条消息的上限';
    case 'invalid-role':
      return '角色不在词表里';
    case 'invalid-destination':
      return '目的地档位不在词表里';
    case 'invalid-disposition':
      return '处置档位不在词表里';
    case 'invalid-session-id':
      return '会话 id 是空串';
    case 'proposal-needs-tool-name':
      return '提案必须写明是哪个工具（否则用户面对的是一张读不懂的确认框）';
  }
}

export function createAssistantSessionActions(
  ctx: ActionContext,
  options: AssistantSessionActionsOptions,
): AssistantSessionActions {
  const localClientId = options.clientId;
  // 🔴 空 clientId 直接拒绝构造。这条判据的全部依据就是这一个字符串；
  // 它是空的，"跨设备不许确认"就会退化成"任何设备都不许确认"或"任何设备都能确认"，
  // 而两种退化都不会报错。宁可在这里炸。
  if (typeof localClientId !== 'string' || localClientId === '') {
    throw new Error('助手会话动作需要本设备的 clientId（空值会让提案可确认性判定失效）');
  }
  const makeTurnId = options.newTurnId ?? ((): string => `aturn-${randomId()}`);
  const now = options.now ?? ((): number => Date.now());
  const makeSessionId = (): string => `asess-${randomId()}`;

  const turnOf = (entityId: string): AssistantTurn | undefined => {
    const raw = ctx.getState().assistantTurns[entityId];
    if (raw === undefined || raw.deletedAt !== undefined) return undefined;
    return raw;
  };

  return {
    newSessionId: makeSessionId,

    async appendTurn(input) {
      const at = input.at ?? now();
      // 提案一出生就是未确认；`confirmed` / `rejected` 只能由 `setDisposition` 写。
      const initialDisposition: AssistantTurnDisposition | undefined =
        input.role === 'proposal' ? (input.disposition ?? 'pending') : undefined;
      const destinationKind: AssistantTurnDestinationKind = input.destinationKind ?? 'unknown';
      const payload: Record<string, unknown> = {
        role: input.role,
        text: input.text,
        at,
        // 🔴 目的地与本设备 id **总是显式写**，不给"省略 = 不动它"留口子：
        // 省略 destinationKind 的下一条消息，在别的设备上会永远显示成"不知道谁答的"，
        // 而那正是 D-4 (ii) 要解决的问题本身。
        destinationKind,
        originClientId: localClientId,
      };
      if (input.sessionId !== undefined) payload.sessionId = input.sessionId;
      if (input.toolName !== undefined) payload.toolName = input.toolName;
      if (initialDisposition !== undefined) payload.disposition = initialDisposition;

      const rejection = assistantTurnRejection({
        ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
        role: input.role,
        text: input.text,
        destinationKind,
        ...(initialDisposition === undefined ? {} : { disposition: initialDisposition }),
        ...(input.toolName === undefined ? {} : { toolName: input.toolName }),
      });
      if (rejection !== undefined) {
        throw new Error(`助手消息不合法：${rejectionDetail(rejection)}`);
      }

      const entityId = makeTurnId();
      await ctx.dispatch({
        entityType: 'ASSISTANT_TURN' as EntityType,
        entityId,
        opType: OpType.Create,
        payload,
      });
      return entityId;
    },

    async setDisposition(entityId, disposition) {
      const current = turnOf(entityId);
      if (current === undefined) throw new Error(`找不到这条助手消息「${entityId}」`);
      // 🔴 这条判定**不许挪到界面**。挪进界面就是"另一台设备也能确认"的实现路径：
      // 界面可以漏接、可以有第二个入口、可以被人改掉，而这条 op 一旦落库
      // 就同步到所有设备，且**没有任何一层会说它曾被谁确认过**。
      if (!assistantTurnIsConfirmableHere(current, localClientId)) {
        throw new Error(
          `这条提案不能在这台设备上确认（它由「${current.originClientId ?? '未知设备'}」产生，` +
            '未确认的提案在其他设备上一律按过期处理）',
        );
      }
      await ctx.dispatch({
        entityType: 'ASSISTANT_TURN' as EntityType,
        entityId,
        opType: OpType.Update,
        payload: { disposition },
      });
    },

    async clearSession(sessionId) {
      const ids = assistantTurnsOfSession(Object.values(ctx.getState().assistantTurns), sessionId).map(
        (turn) => turn.id,
      );
      // 空会话**不写 op**：一条空的 DEL 会让"清空"这个意图在对端留下一条谁都不认识的墓碑。
      if (ids.length === 0) return 0;
      // 🔴 **一条** op 带批量域，不是 N 条 DEL（AGENTS §3.4：多实体变更一次完成）。
      await ctx.dispatch({
        entityType: 'ASSISTANT_TURN' as EntityType,
        entityId: ids[0]!,
        opType: OpType.Delete,
        entityIds: ids,
        payload: {},
      });
      return ids.length;
    },

    turnsOf(sessionId) {
      return assistantTurnsOfSession(Object.values(ctx.getState().assistantTurns), sessionId);
    },

    allTurns() {
      return sortAssistantTurns(aliveAssistantTurns(Object.values(ctx.getState().assistantTurns)));
    },

    isConfirmableHere: (turn) => assistantTurnIsConfirmableHere(turn, localClientId),
    isExpiredHere: (turn) => assistantTurnIsExpiredHere(turn, localClientId),
  };
}
