DROP INDEX IF EXISTS "automation_events_user_id_dedupe_digest_key";
CREATE INDEX "automation_events_user_id_dedupe_digest_idx" ON "automation_events"("user_id", "dedupe_digest");
