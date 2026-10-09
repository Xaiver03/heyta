-- 吊销下限现在只写在部署者手配的环境变量里，等于"要吊销就得改 env 再重启"，
-- 而一台自托管实例永远不会主动去问"我的钥还有效吗"。这张表两边共用：
-- 官方实例存运营者抬上去的全局下限，自托管实例存**上一次验过签的**清单值与它的期限。
-- 单调性由代码保证（只许升不许降），存的是从已签名清单里解出来的数，不是可信请求体。
CREATE TABLE "automation_entitlement_revocations" (
  "scope" TEXT NOT NULL,
  "revocation_version" INTEGER NOT NULL,
  "manifest_key_id" TEXT,
  "manifest_expires_at" TIMESTAMP(3),
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "automation_entitlement_revocations_pkey" PRIMARY KEY ("scope")
);
