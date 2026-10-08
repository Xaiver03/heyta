CREATE TABLE "automation_recipient_keys" (
    "user_id" INTEGER NOT NULL,
    "key_epoch" INTEGER NOT NULL,
    "public_key" TEXT NOT NULL,
    "package_version" INTEGER NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "automation_recipient_keys_pkey" PRIMARY KEY ("user_id")
);
ALTER TABLE "automation_recipient_keys" ADD CONSTRAINT "automation_recipient_keys_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
