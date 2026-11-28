/**
 * 服务端 run/session 的**客户端 journal 核心**（ADR-0093）
 * ==========================================================
 *
 * 任务数据在本地、工具在客户端执行；服务端只承载 session/run/事件。本模块负责把一次
 * 客户端 turn 包装成「服务端可见的 run」：建 session（可选复用）→ 建 run → 逐条上报事件
 * （seq 单调递增）→ 结束写终态。**传输完全注入**（web/mobile 各自实现 fetch 适配器），
 * 所以这里能纯函数单测、不碰网络。
 *
 * 失败策略：journal 失败**不得阻断 AI 本身**是否成功；本模块原样抛错，由壳用 best-effort
 * 包装（上传丢了，用户照常拿到回答，只是这次 run 未在服务端留档）。
 */

export type JournalFinishStatus = 'completed' | 'failed' | 'cancelled';

export interface JournalTransport {
  createSession(input: { title?: string }): Promise<string>;
  createRun(sessionId: string): Promise<string>;
  postEvent(input: { runId: string; seq: number; type: string; payload: unknown }): Promise<void>;
  finishRun(input: { runId: string; status: JournalFinishStatus; error?: string }): Promise<void>;
}

export interface AssistantJournal {
  readonly sessionId: string;
  readonly runId: string;
  /** 上报一条事件；seq 由本模块自增（1 起），保证断点续传的 `after` 语义。 */
  record(type: string, payload?: unknown): Promise<void>;
  finish(status: JournalFinishStatus, error?: string): Promise<void>;
}

export interface StartAssistantJournalOptions {
  /** 复用已有会话；省略则新建。 */
  readonly sessionId?: string;
  /** 新建会话时的标题（可选）。 */
  readonly title?: string;
}

export async function startAssistantJournal(
  transport: JournalTransport,
  options: StartAssistantJournalOptions = {},
): Promise<AssistantJournal> {
  const sessionId =
    options.sessionId ?? (await transport.createSession(options.title === undefined ? {} : { title: options.title }));
  const runId = await transport.createRun(sessionId);
  let seq = 0;
  return {
    sessionId,
    runId,
    record: async (type: string, payload?: unknown): Promise<void> => {
      seq += 1;
      await transport.postEvent({ runId, seq, type, payload: payload ?? null });
    },
    finish: async (status: JournalFinishStatus, error?: string): Promise<void> => {
      await transport.finishRun(error === undefined ? { runId, status } : { runId, status, error });
    },
  };
}
