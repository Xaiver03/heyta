CREATE TABLE "central_handoffs" (
    "id" TEXT NOT NULL,
    "pending_id" TEXT NOT NULL,
    "device_challenge" TEXT NOT NULL,
    "launch_hash" TEXT NOT NULL,
    "pairing_hash" TEXT NOT NULL,
    "launch_cipher" TEXT,
    "token_cipher" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "grant_id" TEXT,
    "session_hash" TEXT,
    "user_id" INTEGER,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "launched_at" TIMESTAMP(3),
    "ready_at" TIMESTAMP(3),
    "claimed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "central_handoffs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "central_handoffs_pending_id_key" ON "central_handoffs"("pending_id");
CREATE UNIQUE INDEX "central_handoffs_launch_hash_key" ON "central_handoffs"("launch_hash");
CREATE INDEX "central_handoffs_status_expires_at_idx" ON "central_handoffs"("status", "expires_at");
CREATE INDEX "central_handoffs_grant_id_idx" ON "central_handoffs"("grant_id");
