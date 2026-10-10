-- One-time email login challenges (2026-10-10). Same family as the registration
-- challenge table: the code is never stored, only an HMAC digest scoped by
-- challenge id and purpose.
CREATE TABLE "email_login_challenges" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "code_digest" TEXT NOT NULL,
    "expires_at" BIGINT NOT NULL,
    "last_sent_at" BIGINT NOT NULL,
    "resend_available_at" BIGINT NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "resend_count" INTEGER NOT NULL DEFAULT 0,
    "consumed_at" BIGINT,
    "locale" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_login_challenges_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "email_login_challenges_email_idx"
    ON "email_login_challenges"("email");
CREATE INDEX "email_login_challenges_user_id_idx"
    ON "email_login_challenges"("user_id");
CREATE INDEX "email_login_challenges_expires_at_idx"
    ON "email_login_challenges"("expires_at");

-- At most one live login challenge per user. The partial predicate lets consumed
-- history remain for audit while making concurrent replacement fail closed.
CREATE UNIQUE INDEX "email_login_challenges_one_live_per_user_idx"
    ON "email_login_challenges"("user_id")
    WHERE "consumed_at" IS NULL;

ALTER TABLE "email_login_challenges"
    ADD CONSTRAINT "email_login_challenges_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
