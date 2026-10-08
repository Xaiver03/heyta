-- Automatic capture is included in the existing hosted AI tier. It is a
-- separate entitlement capability so the automation gate cannot be bypassed
-- by changing the ordinary hosting/AI gate.
ALTER TABLE "subscriptions" DROP CONSTRAINT "subscriptions_grants_known";
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_grants_known"
  CHECK ("grants" <@ ARRAY['hosting','ai','automation']::TEXT[]);
