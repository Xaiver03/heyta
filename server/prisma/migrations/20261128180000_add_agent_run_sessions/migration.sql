-- ADR-0093：服务端 Agent run/session 持久化（仅托管档）。
-- 新增四张表；不改既有表。普通 CREATE TABLE/INDEX（新表为空，无需 CONCURRENTLY）。

CREATE TABLE "agent_sessions" (
  "id" TEXT NOT NULL,
  "user_id" INTEGER NOT NULL,
  "title" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agent_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "agent_sessions_user_id_updated_at_idx" ON "agent_sessions" ("user_id", "updated_at");

CREATE TABLE "agent_messages" (
  "id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "seq" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agent_messages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agent_messages_session_id_seq_key" ON "agent_messages" ("session_id", "seq");

CREATE INDEX "agent_messages_session_id_idx" ON "agent_messages" ("session_id");

CREATE TABLE "agent_runs" (
  "id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "last_event_id" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" TIMESTAMP(3),
  CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "agent_runs_session_id_created_at_idx" ON "agent_runs" ("session_id", "created_at");

CREATE TABLE "agent_run_events" (
  "run_id" TEXT NOT NULL,
  "seq" INTEGER NOT NULL,
  "type" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agent_run_events_pkey" PRIMARY KEY ("run_id", "seq")
);

ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "agent_sessions" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "agent_sessions" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agent_run_events" ADD CONSTRAINT "agent_run_events_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
