-- 官方签发端要能回答"这张票据该不该签"，而判定不能靠客户端自报。
-- 三张表把一个付费主体、一台安装实例、一个本地账号绑成一条**服务端记录的事实**：
-- subjects 给账号一个跨实例稳定的公开主体（不是本地数字 userId），
-- activations 是一次性激活码（换绑那一步的唯一凭据），
-- links 是绑定结果本身，也就是此后签发 `session` 票据的唯一依据。

CREATE TABLE "automation_entitlement_subjects" (
  "user_id" INTEGER NOT NULL,
  "subject" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "automation_entitlement_subjects_pkey" PRIMARY KEY ("user_id"),
  CONSTRAINT "automation_entitlement_subjects_subject_key" UNIQUE ("subject"),
  CONSTRAINT "automation_entitlement_subjects_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

-- 一台安装实例同时**最多一张活码**：主键直接取 (user_id, installation_id)，
-- 与 email_change_requests 用 user_id 做主键同一理由 —— 免掉"同一台实例挂着两张活码"
-- 这种根本不该存在的状态。兑换成功就把码删掉，换绑历史留在 links 里，不留在这里。
CREATE TABLE "automation_entitlement_activations" (
  "user_id" INTEGER NOT NULL,
  "installation_id" TEXT NOT NULL,
  "code_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resend_count" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "automation_entitlement_activations_pkey" PRIMARY KEY ("user_id", "installation_id"),
  CONSTRAINT "automation_entitlement_activations_code_hash_key" UNIQUE ("code_hash"),
  CONSTRAINT "automation_entitlement_activations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE INDEX "automation_entitlement_activations_expires_at_idx" ON "automation_entitlement_activations"("expires_at");

-- 绑定 = 一台实例归哪个公开主体、在本地账号上是哪一个。主键是 installation_id ⇒
-- 一台实例只能有一个当前绑定；换主体必须先撤销，不能靠"再来一次兑换"顶掉别人。
CREATE TABLE "automation_entitlement_links" (
  "installation_id" TEXT NOT NULL,
  "user_id" INTEGER NOT NULL,
  "subject" TEXT NOT NULL,
  "local_account_uuid" TEXT NOT NULL,
  "bound_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at" TIMESTAMP(3),
  CONSTRAINT "automation_entitlement_links_pkey" PRIMARY KEY ("installation_id"),
  CONSTRAINT "automation_entitlement_links_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE INDEX "automation_entitlement_links_subject_idx" ON "automation_entitlement_links"("subject");
CREATE INDEX "automation_entitlement_links_revoked_at_idx" ON "automation_entitlement_links"("revoked_at");
