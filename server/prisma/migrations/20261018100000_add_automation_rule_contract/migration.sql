ALTER TABLE "automation_rules"
  ADD COLUMN "allowed_fields" JSONB,
  ADD COLUMN "target_project_id" TEXT,
  ADD COLUMN "timezone" TEXT,
  ADD COLUMN "parse_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "authorization_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "max_items" INTEGER NOT NULL DEFAULT 50;

ALTER TABLE "automation_rules"
  ADD CONSTRAINT "automation_rules_parse_version_positive" CHECK ("parse_version" >= 1),
  ADD CONSTRAINT "automation_rules_authorization_version_positive" CHECK ("authorization_version" >= 1),
  ADD CONSTRAINT "automation_rules_max_items_bound" CHECK ("max_items" BETWEEN 1 AND 50);
