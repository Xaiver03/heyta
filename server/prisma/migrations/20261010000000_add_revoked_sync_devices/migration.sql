CREATE TABLE "revoked_sync_devices" (
    "user_id" INTEGER NOT NULL,
    "client_id" TEXT NOT NULL,
    "revoked_at" BIGINT NOT NULL,

    CONSTRAINT "revoked_sync_devices_pkey" PRIMARY KEY ("user_id", "client_id"),
    CONSTRAINT "revoked_sync_devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
