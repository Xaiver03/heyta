/**
 * Agent run/session 的服务端存储（ADR-0093，仅托管档）
 * =====================================================
 *
 * 只做「写/读这四张表」这一层，不掺模型调用与 HTTP：
 * - 走既有 `SqlRunner` 端口（与 metering/pricing 同形），便于用 PGlite 做真 SQL 测试；
 * - 事件带单调 `seq`，`agent_runs.last_event_id` 记已产出的最大 seq，是**断点续传**的依据；
 * - 不在此层做权限判断（`user_id` 由路由取自会话票据后传进来）。
 */
import type { SqlRunner } from '../billing/pricing-store';

export type AgentRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface AgentRunEventRow {
  run_id: string;
  seq: number;
  type: string;
  payload: unknown;
  created_at: Date | string;
}

export const createAgentSession = async (
  sql: SqlRunner,
  input: { id: string; userId: number; title?: string | null },
): Promise<void> => {
  await sql.execute(
    'INSERT INTO "agent_sessions" ("id","user_id","title") VALUES ($1,$2,$3)',
    [input.id, input.userId, input.title ?? null],
  );
};

export const appendAgentMessage = async (
  sql: SqlRunner,
  input: { id: string; sessionId: string; role: string; content: string; seq: number },
): Promise<void> => {
  await sql.execute(
    'INSERT INTO "agent_messages" ("id","session_id","role","content","seq") VALUES ($1,$2,$3,$4,$5)',
    [input.id, input.sessionId, input.role, input.content, input.seq],
  );
};

export const startAgentRun = async (
  sql: SqlRunner,
  input: { id: string; sessionId: string },
): Promise<void> => {
  await sql.execute(
    `INSERT INTO "agent_runs" ("id","session_id","status") VALUES ($1,$2,'running')`,
    [input.id, input.sessionId],
  );
};

/** 追加一条事件并推进 `last_event_id`。`seq` 由调用方保证单调（主键会挡重复）。 */
export const appendAgentRunEvent = async (
  sql: SqlRunner,
  input: { runId: string; seq: number; type: string; payload: unknown },
): Promise<void> => {
  await sql.execute(
    'INSERT INTO "agent_run_events" ("run_id","seq","type","payload") VALUES ($1,$2,$3,$4::jsonb)',
    [input.runId, input.seq, input.type, JSON.stringify(input.payload)],
  );
  await sql.execute(
    'UPDATE "agent_runs" SET "last_event_id" = GREATEST("last_event_id", $2) WHERE "id" = $1',
    [input.runId, input.seq],
  );
};

/** 断点续传：返回 `seq > afterSeq` 的事件，按 seq 升序。 */
export const readAgentRunEventsSince = (
  sql: SqlRunner,
  runId: string,
  afterSeq: number,
): Promise<AgentRunEventRow[]> =>
  sql.query<AgentRunEventRow>(
    'SELECT "run_id","seq","type","payload","created_at" FROM "agent_run_events" WHERE "run_id"=$1 AND "seq">$2 ORDER BY "seq" ASC',
    [runId, afterSeq],
  );

export const finishAgentRun = async (
  sql: SqlRunner,
  input: { runId: string; status: AgentRunStatus; error?: string | null },
): Promise<void> => {
  await sql.execute(
    'UPDATE "agent_runs" SET "status"=$2, "error"=$3, "finished_at"=CURRENT_TIMESTAMP WHERE "id"=$1',
    [input.runId, input.status, input.error ?? null],
  );
};
