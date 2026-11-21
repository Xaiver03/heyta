/**
 * 移动端云端 Agent 入口 —— 与 Web 同构，接入点独立于 `AssistantScreen`（不与其并发改动冲突）。
 *
 * 给定本机 `AppHost`（`host.engine`/`host.dispatch`/`host.getState`）与路由/授权配置，
 * 即可跑一轮「设备本地循环 + 云端模型 + 本地数据工具 + 撤销」，写操作只出确认提案。
 *
 * 用法（在已拿到 host 的屏幕里）：
 * ```ts
 * const { turn, seqBefore } = await runMobileCloudTurn(host, text, { routing, consents, grants });
 * // “撤销这次 AI 操作”：
 * await undoMobileCloudTurn(host, seqBefore);
 * ```
 */
import {
  createLocalApiHost,
  createLocalToolTransport,
  createTaskActions,
  runAiTurnWithUndo,
  undoLastAiTurn,
  type AppHost,
  type CloudAgentTurnResult,
  type TurnUndoBindings,
} from '@heyta/app-host';
import type { AiRoutingConfig, EgressConsent } from '@heyta/ai';
import type { LocalApiHost, LocalApiConfig } from '@heyta/local-api';

function toolHostOf(host: AppHost): LocalApiHost {
  return createLocalApiHost({ dispatch: host.dispatch, getState: host.getState }, createTaskActions(host), {
    isReadable: () => true,
  });
}

/** 移动端撤销绑定（引擎执行栈）。 */
export function mobileUndoBindings(host: AppHost): TurnUndoBindings {
  return {
    getSeq: () => host.engine.currentLocalSeq(),
    undoSince: (seq: number) => host.engine.undoSince(seq),
  };
}

export interface MobileCloudTurnDeps {
  readonly routing: AiRoutingConfig;
  readonly consents: readonly EgressConsent[];
  readonly grants: LocalApiConfig['grants'];
  readonly runId?: string;
}

export interface MobileCloudTurnResult {
  readonly turn: CloudAgentTurnResult;
  readonly seqBefore: number;
  readonly runId: string;
}

export async function runMobileCloudTurn(
  host: AppHost,
  userText: string,
  deps: MobileCloudTurnDeps,
): Promise<MobileCloudTurnResult> {
  const transport = createLocalToolTransport({ host: toolHostOf(host), grants: deps.grants, getGrants: () => deps.grants });
  const result = await runAiTurnWithUndo(userText, {
    routing: deps.routing,
    consents: deps.consents,
    transport,
    grants: deps.grants,
    undo: mobileUndoBindings(host),
    ...(deps.runId === undefined ? {} : { runId: deps.runId }),
  });
  return { turn: result.turn, seqBefore: result.seqBefore, runId: result.runId };
}

export async function undoMobileCloudTurn(host: AppHost, seqBefore: number): Promise<unknown> {
  return undoLastAiTurn({ undo: mobileUndoBindings(host) }, seqBefore);
}
