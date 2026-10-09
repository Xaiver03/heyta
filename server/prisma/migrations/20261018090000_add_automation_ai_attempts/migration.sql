CREATE TABLE "automation_ai_attempts" (
  "user_id" INTEGER NOT NULL,
  "rule_id" TEXT NOT NULL,
  "event_id" TEXT NOT NULL,
  "parse_version" INTEGER NOT NULL,
  "attempt" INTEGER NOT NULL,
  "period_anchor" BIGINT NOT NULL,
  "state" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "automation_ai_attempts_pkey" PRIMARY KEY ("user_id", "rule_id", "event_id", "parse_version", "attempt"),
  CONSTRAINT "automation_ai_attempts_state_known" CHECK ("state" IN ('reserved','sent','consumed','released','unknown')),
  CONSTRAINT "automation_ai_attempts_attempt_positive" CHECK ("attempt" >= 1),
  CONSTRAINT "automation_ai_attempts_parse_version_positive" CHECK ("parse_version" >= 1)
);
CREATE INDEX "automation_ai_attempts_user_id_period_anchor_idx" ON "automation_ai_attempts" ("user_id", "period_anchor");
ALTER TABLE "automation_ai_attempts" ADD CONSTRAINT "automation_ai_attempts_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
