/**
 * Web 壳的云端 Agent 入口 —— 把「设备本地循环 + 云端模型 + 本地数据工具 + 撤销」接到 Web。
 *
 * 这是一个**接入点**：给定路由/授权配置，即可跑一轮，并可在其后"撤销这次 AI 操作"。
 * 与移动端/桌面共用同一 `packages/app-host` 实现（`runAiTurnWithUndo`），Web 只补三样：
 *   1. 本地工具传输：`createAiToolHost()`（Web store 的真实 dispatch）+ `createLocalToolTransport`；
 *   2. 撤销绑定：`requireEngine()` 的 `currentLocalSeq` / `undoSince`；
 *   3. 传 `routing` / `consents`（面板已有）。
 *
 * ⚠️ 写操作经本地传输只出 `write-needs-confirm`（走既有的"提案→确认"），不在本入口落库。
 */
import type { AiRoutingConfig, EgressConsent } from '@heyta/ai';
import type { LocalApiConfig } from '@heyta/local-api';
import {
  createLocalToolTransport,
  runAiTurnWithUndo,
  undoLastAiTurn,
  type CloudAgentTurnResult,
  type TurnUndoBindings,
} from '@heyta/app-host';

import { requireEngine } from '../../lib/oplog.js';
import { createAiToolHost } from '../tasks/store.js';

/**
 * Web 壳的撤销绑定。
 *
 * 🔴 **绑定到取 seq 时的那个引擎实例**：`requireEngine()` 是模块级可变单例，
 * 注销/清数据会把它置空后重开一个新引擎（新 op-log）。若撤销时再 `requireEngine()`
 * 拿到的是**另一个**引擎，`undoSince(旧seq)` 会打到新日志（撤错库/静默失效）。
 * 所以这里捕获引擎引用，撤销时若已换引擎就如实返回 `stale-engine`，绝不跨库操作。
 */
export function webUndoBindings(): TurnUndoBindings {
  const engine = requireEngine();
  return {
    getSeq: () => engine.currentLocalSeq(),
    undoSince: async (seq: number) => {
      if (requireEngine() !== engine) return { status: 'stale-engine' };
      return engine.undoSince(seq);
    },
  };
}

export interface WebCloudTurnDeps {
  readonly routing: AiRoutingConfig;
  readonly consents: readonly EgressConsent[];
  readonly grants: LocalApiConfig['grants'];
  readonly runId?: string;
}

export interface WebCloudTurnResult {
  readonly turn: CloudAgentTurnResult;
  readonly seqBefore: number;
  readonly runId: string;
  /** 中途抛错时的错误信息（此时 turn 为空、seqBefore 仍可用于撤销已写部分）。 */
  readonly error?: string;
}

/** 跑一轮 Web 云端 Agent（本地数据工具 + 云端模型 + 记录 seq 供撤销）。 */
export async function runWebCloudTurn(
  userText: string,
  deps: WebCloudTurnDeps,
): Promise<WebCloudTurnResult> {
  const host = createAiToolHost();
  const transport = createLocalToolTransport({ host, grants: deps.grants, getGrants: () => deps.grants });
  const bindings = webUndoBindings();
  const result = await runAiTurnWithUndo(userText, {
    routing: deps.routing,
    consents: deps.consents,
    transport,
    grants: deps.grants,
    undo: bindings,
    ...(deps.runId === undefined ? {} : { runId: deps.runId }),
  });
  return {
    turn: result.turn,
    seqBefore: result.seqBefore,
    runId: result.runId,
    ...(result.error === undefined ? {} : { error: result.error }),
  };
}

/** 撤销最近一次 Web 云端 Agent 的本地写入（AI 读不写；写发生在确认流程后单独撤销）。 */
export async function undoWebCloudTurn(seqBefore: number): Promise<unknown> {
  return undoLastAiTurn({ undo: webUndoBindings() }, seqBefore);
}
