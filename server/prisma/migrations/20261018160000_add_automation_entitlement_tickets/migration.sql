CREATE TABLE "automation_entitlement_bindings" (
  "user_id" INTEGER NOT NULL,
  "official_subject" TEXT NOT NULL,
  "installation_id" TEXT NOT NULL,
  "local_account_uuid" TEXT NOT NULL,
  "issuer" TEXT NOT NULL,
  "key_id" TEXT NOT NULL,
  "revocation_version" INTEGER NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "checked_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "automation_entitlement_bindings_pkey" PRIMARY KEY ("user_id"),
  CONSTRAINT "automation_entitlement_bindings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE INDEX "automation_entitlement_bindings_expires_at_idx" ON "automation_entitlement_bindings"("expires_at");

CREATE TABLE "automation_entitlement_ticket_uses" (
  "nonce" TEXT NOT NULL,
  "user_id" INTEGER NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "automation_entitlement_ticket_uses_pkey" PRIMARY KEY ("nonce"),
  CONSTRAINT "automation_entitlement_ticket_uses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE INDEX "automation_entitlement_ticket_uses_expires_at_idx" ON "automation_entitlement_ticket_uses"("expires_at");
