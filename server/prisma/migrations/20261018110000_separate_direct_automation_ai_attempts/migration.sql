ALTER TABLE "automation_ai_attempts"
  ADD COLUMN "billing_source" TEXT NOT NULL DEFAULT 'managed',
  ALTER COLUMN "period_anchor" DROP NOT NULL;
ALTER TABLE "automation_ai_attempts"
  ADD CONSTRAINT "automation_ai_attempts_billing_source_known"
  CHECK (("billing_source" = 'direct' AND "period_anchor" IS NULL)
    OR ("billing_source" = 'managed' AND "period_anchor" IS NOT NULL));
