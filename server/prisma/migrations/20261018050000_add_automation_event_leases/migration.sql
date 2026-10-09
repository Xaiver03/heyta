ALTER TABLE "automation_events"
  ADD COLUMN "lease_generation" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lease_worker_id" TEXT,
  ADD COLUMN "lease_expires_at" TIMESTAMP(3),
  ADD COLUMN "attempt" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "parse_version" INTEGER,
  ADD COLUMN "result_ciphertext" TEXT,
  ADD COLUMN "reason_code" TEXT;
CREATE INDEX "automation_events_status_lease_idx"
  ON "automation_events"("status", "lease_expires_at");
