-- CreateTable
CREATE TABLE "central_identities" (
    "id" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "central_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "central_pending" (
    "id" TEXT NOT NULL,
    "state_hash" TEXT NOT NULL,
    "browser_hash" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "redirect_uri" TEXT NOT NULL,
    "secrets_cipher" TEXT,
    "link_user_id" INTEGER,
    "link_session_hash" TEXT,
    "link_token_version" INTEGER,
    "link_proof_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "central_pending_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "central_attempts" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "pending_id" TEXT,
    "grant_id" TEXT,
    "expected_version" INTEGER,
    "issuer" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DISPATCHED',
    "dispatch_hash" TEXT NOT NULL,
    "request_cipher" TEXT,
    "result_cipher" TEXT,
    "result_hash" TEXT,
    "deadline" TIMESTAMP(3) NOT NULL,
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "central_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "central_grants" (
    "id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "session_hash" TEXT,
    "token_version" INTEGER NOT NULL,
    "issuer" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "root_sid" TEXT,
    "authorization_attempt_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "active_attempt_id" TEXT,
    "tokens_cipher" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "central_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "central_revocations" (
    "id" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "grant_id" TEXT,
    "tokens_cipher" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "lease_hash" TEXT,
    "lease_until" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "central_revocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "central_identities_issuer_subject_key" ON "central_identities"("issuer", "subject");

-- CreateIndex
CREATE UNIQUE INDEX "central_identities_issuer_user_id_key" ON "central_identities"("issuer", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "central_pending_state_hash_key" ON "central_pending"("state_hash");

-- CreateIndex
CREATE INDEX "central_pending_expires_at_idx" ON "central_pending"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "central_attempts_pending_id_key" ON "central_attempts"("pending_id");

-- CreateIndex
CREATE INDEX "central_attempts_grant_id_idx" ON "central_attempts"("grant_id");

-- CreateIndex
CREATE INDEX "central_attempts_status_deadline_idx" ON "central_attempts"("status", "deadline");

-- CreateIndex
CREATE UNIQUE INDEX "central_grants_session_hash_key" ON "central_grants"("session_hash");

-- CreateIndex
CREATE UNIQUE INDEX "central_grants_authorization_attempt_id_key" ON "central_grants"("authorization_attempt_id");

-- CreateIndex
CREATE UNIQUE INDEX "central_grants_active_attempt_id_key" ON "central_grants"("active_attempt_id");

-- CreateIndex
CREATE INDEX "central_grants_user_id_idx" ON "central_grants"("user_id");

-- CreateIndex
CREATE INDEX "central_grants_expires_at_idx" ON "central_grants"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "central_revocations_dedupe_key_key" ON "central_revocations"("dedupe_key");

-- CreateIndex
CREATE INDEX "central_revocations_status_next_attempt_at_idx" ON "central_revocations"("status", "next_attempt_at");

-- AddForeignKey
ALTER TABLE "central_identities" ADD CONSTRAINT "central_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "central_grants" ADD CONSTRAINT "central_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "central_grants" ADD CONSTRAINT "central_grants_session_hash_fkey" FOREIGN KEY ("session_hash") REFERENCES "access_sessions"("jti_hash") ON DELETE RESTRICT ON UPDATE CASCADE;

