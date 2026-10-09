CREATE TABLE "automation_sender_credentials" (
  "id" TEXT NOT NULL,
  "user_id" INTEGER NOT NULL,
  "rule_id" TEXT NOT NULL,
  "key_id" TEXT NOT NULL,
  "secret_ciphertext" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at" BIGINT,
  "rotated_at" BIGINT,
  CONSTRAINT "automation_sender_credentials_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "automation_sender_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "automation_sender_credentials_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "automation_rules"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
);
CREATE UNIQUE INDEX "automation_sender_credentials_active_key" ON "automation_sender_credentials"("user_id", "rule_id", "key_id") WHERE "revoked_at" IS NULL;
CREATE INDEX "automation_sender_credentials_user_id_rule_id_revoked_at_idx" ON "automation_sender_credentials"("user_id", "rule_id", "revoked_at");
