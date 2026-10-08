CREATE TABLE "automation_rules" (
    "id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "key_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" BIGINT,
    CONSTRAINT "automation_rules_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "automation_rules_user_id_enabled_idx" ON "automation_rules"("user_id", "enabled");
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

CREATE TABLE "automation_events" (
    "event_id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "rule_id" TEXT NOT NULL,
    "rule_version" INTEGER NOT NULL,
    "dedupe_digest" TEXT NOT NULL,
    "payload_ciphertext" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'received',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "automation_events_pkey" PRIMARY KEY ("event_id")
);
CREATE UNIQUE INDEX "automation_events_user_id_dedupe_digest_key" ON "automation_events"("user_id", "dedupe_digest");
CREATE INDEX "automation_events_user_id_rule_id_status_idx" ON "automation_events"("user_id", "rule_id", "status");
CREATE INDEX "automation_events_expires_at_idx" ON "automation_events"("expires_at");
ALTER TABLE "automation_events" ADD CONSTRAINT "automation_events_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
