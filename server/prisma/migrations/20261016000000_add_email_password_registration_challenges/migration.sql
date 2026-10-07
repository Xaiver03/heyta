-- One-time email password registration challenges.
-- The code is never stored; code_digest is an HMAC scoped by challenge id and purpose.
CREATE TABLE "email_password_registration_challenges" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "user_id" INTEGER,
    "pending_password_hash" TEXT NOT NULL,
    "code_digest" TEXT NOT NULL,
    "expires_at" BIGINT NOT NULL,
    "last_sent_at" BIGINT NOT NULL,
    "resend_available_at" BIGINT NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "resend_count" INTEGER NOT NULL DEFAULT 0,
    "consumed_at" BIGINT,
    "terms_accepted_at" BIGINT,
    "terms_document_version" TEXT,
    "invite_code" TEXT,
    "locale" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_password_registration_challenges_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "email_password_registration_challenges_email_idx"
    ON "email_password_registration_challenges"("email");
CREATE INDEX "email_password_registration_challenges_user_id_idx"
    ON "email_password_registration_challenges"("user_id");
CREATE INDEX "email_password_registration_challenges_expires_at_idx"
    ON "email_password_registration_challenges"("expires_at");

-- There is at most one live challenge per user. The partial predicate lets
-- consumed history remain for audit while making concurrent replacement fail
-- closed instead of leaving two valid pending passwords/codes.
CREATE UNIQUE INDEX "email_password_registration_challenges_one_live_per_user_idx"
    ON "email_password_registration_challenges"("user_id")
    WHERE "user_id" IS NOT NULL AND "consumed_at" IS NULL;

ALTER TABLE "email_password_registration_challenges"
    ADD CONSTRAINT "email_password_registration_challenges_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
