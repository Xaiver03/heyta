SET LOCAL lock_timeout = '1s';
ALTER TABLE "automation_ai_attempts"
  DROP CONSTRAINT "automation_ai_attempts_billing_source_known",
  ADD CONSTRAINT "automation_ai_attempts_billing_source_known"
  CHECK (("billing_source" = 'local' AND "period_anchor" IS NULL)
    OR ("billing_source" = 'direct' AND "period_anchor" IS NULL)
    OR ("billing_source" = 'managed' AND "period_anchor" IS NOT NULL));
