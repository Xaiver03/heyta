-- ADR-0080 S2：关闭端到端加密 = 一次整库解密重传。
--
-- 这一次性迁移复用既有的 staging 机制（manifest → chunk → commit），
-- 所以 `vault_key_migrations` 要能表达"目标是明文，没有密钥世代"这一档。
--
-- 做法是**可空 + CHECK 配对**，不是塞 0 当哨兵：哨兵会让每个读这几列的老代码
-- 以为自己在看一个真实的密钥版本，而它其实不存在。
--
-- `expected_key_version` 在两种模式下都保留 NOT NULL：它是对当前 wrapper 的 CAS，
-- 证明这次切换看到的是同一个密钥包（并发轮换必须让迁移失败，而不是静默覆盖）。
ALTER TABLE "vault_key_migrations" ADD COLUMN "target_mode" TEXT NOT NULL DEFAULT 'e2ee';

ALTER TABLE "vault_key_migrations" ALTER COLUMN "target_payload_key_version" DROP NOT NULL;
ALTER TABLE "vault_key_migrations" ALTER COLUMN "key_version" DROP NOT NULL;
ALTER TABLE "vault_key_migrations" ALTER COLUMN "package_data" DROP NOT NULL;

ALTER TABLE "vault_key_migrations"
  ADD CONSTRAINT "vault_key_migrations_target_mode_check"
  CHECK (
    (
      "target_mode" = 'e2ee'
      AND "key_version" IS NOT NULL
      AND "target_payload_key_version" IS NOT NULL
      AND "package_data" IS NOT NULL
    )
    OR (
      "target_mode" = 'readable'
      AND "key_version" IS NULL
      AND "target_payload_key_version" IS NULL
      AND "package_data" IS NULL
    )
  );
