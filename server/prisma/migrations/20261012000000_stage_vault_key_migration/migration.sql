ALTER TABLE "vault_key_migrations"
  ADD COLUMN "state" TEXT NOT NULL DEFAULT 'STAGING',
  ADD COLUMN "expected_operation_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "expected_payload_bytes" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "uploaded_operation_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "uploaded_payload_bytes" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "reserved_storage_bytes" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "expires_at" BIGINT,
  ADD COLUMN "cancelled_at" BIGINT,
  ADD COLUMN "package_data" JSONB;

UPDATE "vault_key_migrations" AS m
SET "expires_at" = m."created_at" + 86400000,
    "package_data" = COALESCE(p."package_data", '{}'::jsonb)
FROM "vault_key_packages" AS p
WHERE p."user_id" = m."user_id"
  AND (m."expires_at" IS NULL OR m."package_data" IS NULL);

UPDATE "vault_key_migrations"
SET "expires_at" = COALESCE("expires_at", "created_at" + 86400000),
    "package_data" = COALESCE("package_data", '{}'::jsonb);

ALTER TABLE "vault_key_migrations"
  ALTER COLUMN "expires_at" SET NOT NULL,
  ALTER COLUMN "package_data" SET NOT NULL;

CREATE INDEX "vault_key_migrations_user_id_state_expires_at_idx"
  ON "vault_key_migrations"("user_id", "state", "expires_at");

CREATE TABLE "vault_key_migration_chunks" (
    "id" TEXT NOT NULL,
    "migration_id" TEXT NOT NULL,
    "chunk_id" TEXT NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "request_fingerprint" TEXT NOT NULL,
    "operation_count" INTEGER NOT NULL,
    "payload_bytes" BIGINT NOT NULL,
    "created_at" BIGINT NOT NULL,

    CONSTRAINT "vault_key_migration_chunks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "vault_key_migration_chunks_migration_id_fkey"
      FOREIGN KEY ("migration_id") REFERENCES "vault_key_migrations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "vault_key_migration_chunks_migration_id_chunk_id_key"
  ON "vault_key_migration_chunks"("migration_id", "chunk_id");
CREATE UNIQUE INDEX "vault_key_migration_chunks_migration_id_chunk_index_key"
  ON "vault_key_migration_chunks"("migration_id", "chunk_index");
CREATE INDEX "vault_key_migration_chunks_migration_id_created_at_idx"
  ON "vault_key_migration_chunks"("migration_id", "created_at");

CREATE TABLE "vault_key_migration_operations" (
    "id" TEXT NOT NULL,
    "migration_id" TEXT NOT NULL,
    "chunk_id" TEXT NOT NULL,
    "operation_id" TEXT NOT NULL,
    "server_seq" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "payload_bytes" BIGINT NOT NULL,
    "storage_bytes" BIGINT NOT NULL,
    "created_at" BIGINT NOT NULL,

    CONSTRAINT "vault_key_migration_operations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "vault_key_migration_operations_migration_id_fkey"
      FOREIGN KEY ("migration_id") REFERENCES "vault_key_migrations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "vault_key_migration_operations_chunk_id_fkey"
      FOREIGN KEY ("chunk_id") REFERENCES "vault_key_migration_chunks"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "vault_key_migration_operations_migration_id_operation_id_key"
  ON "vault_key_migration_operations"("migration_id", "operation_id");
CREATE UNIQUE INDEX "vault_key_migration_operations_migration_id_server_seq_key"
  ON "vault_key_migration_operations"("migration_id", "server_seq");
CREATE INDEX "vault_key_migration_operations_migration_id_server_seq_idx"
  ON "vault_key_migration_operations"("migration_id", "server_seq");
