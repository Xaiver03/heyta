-- Event IDs are account-scoped protocol identities. Keep the historical
-- rule-scoped primary key for foreign-key shape, and add the account fence.
CREATE UNIQUE INDEX "automation_events_user_id_event_id_key"
  ON "automation_events" ("user_id", "event_id");

-- A commit permit is scoped exactly like its frozen event. The op id is unique
-- within an account, so two rules cannot silently authorize the same upload.
ALTER TABLE "automation_commit_permits" DROP CONSTRAINT "automation_commit_permits_pkey";
ALTER TABLE "automation_commit_permits" DROP CONSTRAINT "automation_commit_permits_op_id_key";
ALTER TABLE "automation_commit_permits"
  ADD CONSTRAINT "automation_commit_permits_pkey" PRIMARY KEY ("user_id", "rule_id", "event_id");
CREATE UNIQUE INDEX "automation_commit_permits_user_id_op_id_key"
  ON "automation_commit_permits" ("user_id", "op_id");

-- Seven-day retention removes ciphertext, not the event ledger. Keeping the
-- identity/state row preserves long-term dedupe and dispute accounting.
ALTER TABLE "automation_events" ALTER COLUMN "payload_ciphertext" DROP NOT NULL;
ALTER TABLE "automation_events" ADD COLUMN "result_item_count" INTEGER;
