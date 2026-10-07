-- Worker identities and permanent commit ownership. No endpoint grants permits yet.
CREATE TABLE "automation_workers" (
  "id" TEXT PRIMARY KEY,
  "user_id" INTEGER NOT NULL,
  "credential_hash" TEXT NOT NULL UNIQUE CHECK (credential_hash ~ '^[0-9a-f]{64}$'),
  "sync_client_id" TEXT NOT NULL,
  "database_epoch" TEXT NOT NULL,
  "revoked_at" BIGINT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "automation_workers_id_user_id_key" UNIQUE (id, user_id),
  CONSTRAINT "automation_workers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);
CREATE INDEX "automation_workers_user_id_sync_client_id_idx" ON "automation_workers" (user_id, sync_client_id);
CREATE TABLE "automation_commit_permits" (
  "event_id" TEXT PRIMARY KEY CHECK (event_id ~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,63}$'),
  "user_id" INTEGER NOT NULL,
  "worker_id" TEXT NOT NULL,
  "op_id" TEXT NOT NULL UNIQUE CHECK (op_id = 'inbound:' || event_id),
  "rule_id" TEXT NOT NULL,
  "rule_version" INTEGER NOT NULL CHECK (rule_version > 0),
  "parse_version" INTEGER NOT NULL CHECK (parse_version > 0),
  "result_digest" TEXT NOT NULL CHECK (result_digest ~ '^[0-9a-f]{64}$'),
  "item_count" INTEGER NOT NULL CHECK (item_count BETWEEN 1 AND 50),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "automation_commit_permits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "automation_commit_permits_worker_id_user_id_fkey" FOREIGN KEY (worker_id, user_id) REFERENCES automation_workers(id, user_id) ON DELETE NO ACTION
);
CREATE INDEX "automation_commit_permits_user_id_rule_id_idx" ON "automation_commit_permits" (user_id, rule_id);
CREATE INDEX "automation_commit_permits_worker_id_user_id_idx" ON "automation_commit_permits" (worker_id, user_id);
