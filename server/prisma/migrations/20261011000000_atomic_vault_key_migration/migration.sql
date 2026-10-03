ALTER TABLE "vault_key_packages"
ADD COLUMN "active_payload_key_version" INTEGER;

CREATE TABLE "vault_key_migrations" (
    "id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "request_id" TEXT NOT NULL,
    "request_fingerprint" TEXT NOT NULL,
    "expected_key_version" INTEGER NOT NULL,
    "expected_latest_seq" INTEGER NOT NULL,
    "target_payload_key_version" INTEGER NOT NULL,
    "key_version" INTEGER NOT NULL,
    "latest_seq" INTEGER NOT NULL,
    "migrated_operation_count" INTEGER NOT NULL,
    "created_at" BIGINT NOT NULL,

    CONSTRAINT "vault_key_migrations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "vault_key_migrations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "vault_key_migrations_user_id_request_id_key"
ON "vault_key_migrations"("user_id", "request_id");

CREATE INDEX "vault_key_migrations_user_id_created_at_idx"
ON "vault_key_migrations"("user_id", "created_at");
