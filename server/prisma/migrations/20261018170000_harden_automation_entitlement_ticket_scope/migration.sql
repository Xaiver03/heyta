-- Ticket use rows become single-purpose evidence: one nonce may authorize exactly one
-- action, for one rule or event, on one installation. Defaults exist only to backfill
-- rows written before this shape and are dropped immediately afterwards, so the
-- database cannot silently accept a future insert that omits them.
ALTER TABLE "automation_entitlement_ticket_uses" ADD COLUMN "action" TEXT NOT NULL DEFAULT 'session';
ALTER TABLE "automation_entitlement_ticket_uses" ADD COLUMN "rule_id" TEXT;
ALTER TABLE "automation_entitlement_ticket_uses" ADD COLUMN "event_id" TEXT;
ALTER TABLE "automation_entitlement_ticket_uses" ADD COLUMN "installation_id" TEXT NOT NULL DEFAULT '';
ALTER TABLE "automation_entitlement_ticket_uses" ALTER COLUMN "action" DROP DEFAULT;
ALTER TABLE "automation_entitlement_ticket_uses" ALTER COLUMN "installation_id" DROP DEFAULT;
CREATE INDEX "automation_entitlement_ticket_uses_user_id_action_idx" ON "automation_entitlement_ticket_uses"("user_id", "action");

-- A clock rollback is a fact about this installation, not about one account: once the
-- database clock moves backwards, new authorizations stop for every account here.
CREATE TABLE "automation_entitlement_clocks" (
  "installation_id" TEXT NOT NULL,
  "max_seen_at_ms" BIGINT NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "automation_entitlement_clocks_pkey" PRIMARY KEY ("installation_id")
);
