CREATE TABLE "vault_key_packages" (
    "user_id" INTEGER NOT NULL,
    "key_version" INTEGER NOT NULL,
    "package_data" JSONB NOT NULL,
    "created_at" BIGINT NOT NULL,
    "updated_at" BIGINT NOT NULL,

    CONSTRAINT "vault_key_packages_pkey" PRIMARY KEY ("user_id"),
    CONSTRAINT "vault_key_packages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
