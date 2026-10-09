import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(currentDir, '../prisma/migrations');

const readMigration = (name: string): string =>
  readFileSync(join(migrationsDir, name, 'migration.sql'), 'utf8');

const allMigrationSql = (): string =>
  readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readMigration(entry.name))
    .join('\n');

describe('performance migrations', () => {
  it('adds the durable state-replacement boundary without a blocking backfill', () => {
    const migrationSql = readMigration('20260727000000_add_state_replacement_seq');

    expect(migrationSql).toMatch(
      /ALTER TABLE "user_sync_state"\s+ADD COLUMN "latest_state_replacement_seq" INTEGER/i,
    );
    expect(migrationSql).not.toMatch(/\bUPDATE\b/i);
    expect(migrationSql).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(migrationSql).not.toMatch(/\bBEGIN\b|\bCOMMIT\b/i);
  });

  it('adds the entity sequence index without a blocking or destructive migration', () => {
    const migrationSql = readFileSync(
      join(
        currentDir,
        '../prisma/migrations/20260511000000_add_entity_sequence_index/migration.sql',
      ),
      'utf8',
    );

    expect(migrationSql).toContain('CREATE INDEX CONCURRENTLY');
    expect(migrationSql).not.toMatch(/\bIF\s+NOT\s+EXISTS\b/i);
    expect(migrationSql).toContain(
      '"operations_user_id_entity_type_entity_id_server_seq_idx"',
    );
    expect(migrationSql).toContain(
      'ON "operations"("user_id", "entity_type", "entity_id", "server_seq")',
    );
    expect(migrationSql).not.toMatch(/\bDROP\s+INDEX\b/i);
    expect(migrationSql).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(migrationSql).not.toMatch(/\bBEGIN\b|\bCOMMIT\b/i);
  });

  it('adds partial full-state sequence index and drops redundant indexes', () => {
    const migrationSql = readFileSync(
      join(
        currentDir,
        '../prisma/migrations/20260512000000_add_full_state_sequence_index_drop_redundant_indexes/migration.sql',
      ),
      'utf8',
    );

    expect(migrationSql).toContain('CREATE INDEX CONCURRENTLY');
    expect(migrationSql).toContain('"operations_user_id_full_state_server_seq_idx"');
    expect(migrationSql).toContain('ON "operations"("user_id", "server_seq")');
    expect(migrationSql).toContain(
      `WHERE "op_type" IN ('SYNC_IMPORT', 'BACKUP_IMPORT', 'REPAIR')`,
    );
    expect(migrationSql).toContain(
      'DROP INDEX CONCURRENTLY IF EXISTS "operations_user_id_op_type_idx"',
    );
    expect(migrationSql).toContain(
      'DROP INDEX CONCURRENTLY IF EXISTS "operations_user_id_entity_type_entity_id_idx"',
    );
    expect(migrationSql).toContain(
      'DROP INDEX CONCURRENTLY IF EXISTS "operations_user_id_server_seq_idx"',
    );
    expect(migrationSql).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(migrationSql).not.toMatch(/\bALTER\s+TABLE\b/i);
    expect(migrationSql).not.toMatch(/\bBEGIN\b|\bCOMMIT\b/i);
  });

  it('drops the unused (user_id, client_id) index as a single native-apply statement', () => {
    const migrationSql = readMigration(
      '20260828000000_drop_unused_operations_user_id_client_id_index',
    );

    expect(migrationSql).toContain(
      'DROP INDEX CONCURRENTLY IF EXISTS "operations_user_id_client_id_idx"',
    );
    // The received_at index is load-bearing for the old-ops fresh-prefix probe
    // plan and must never be dropped here.
    expect(migrationSql).not.toContain('"operations_user_id_received_at_idx"');
    // Single statement so `prisma migrate deploy` applies it natively without
    // the out-of-band CONCURRENTLY recovery.
    const sqlWithoutComments = migrationSql
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');
    expect(sqlWithoutComments.match(/;/g)).toHaveLength(1);
    expect(migrationSql).not.toMatch(/\bCREATE\b/i);
    expect(migrationSql).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(migrationSql).not.toMatch(/\bALTER\s+TABLE\b/i);
    expect(migrationSql).not.toMatch(/\bBEGIN\b|\bCOMMIT\b/i);
  });

  it('tunes operations autovacuum as a single unlocked native-apply statement', () => {
    const migrationSql = readMigration('20260828000003_tune_operations_autovacuum');
    // Compared as ONE exact normalized statement rather than as a set of
    // substring matches. Two reasons this file needs the stricter form:
    // its rationale names all three reloptions in prose, so matching the raw
    // text stays green with the ALTER commented out; and a loose
    // `SET \(.*autovacuum_vacuum_scale_factor` lets `.*` swallow a `toast.`
    // prefix — which is the exact footgun the comment warns about, since one
    // toast.autovacuum_* option breaks the parent-value fallback for every
    // field. An exact match also pins the single-statement shape that lets
    // `prisma migrate deploy` apply it natively.
    const normalizedSql = migrationSql
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n')
      .replace(/\s+/g, ' ')
      .trim();

    expect(normalizedSql).toBe(
      'ALTER TABLE "operations" SET (autovacuum_vacuum_insert_scale_factor = 0.02);',
    );
    // Both omissions are decisions, not oversights, and the exact match above
    // already fails if someone adds either back — these say WHY, so the failure
    // reads as a question rather than a stale fixture.
    //
    // analyze: ANALYZE samples a fixed 30,000 random blocks that no
    // page-skipping reduces, so tightening it multiplies the worst-shaped I/O
    // on an IOPS-capped host.
    expect(normalizedSql).not.toMatch(/autovacuum_analyze_scale_factor/i);
    // dead-tuple: measured with VACUUM (VERBOSE), an insert-triggered pass
    // reports `index scans: 0` while a post-DELETE pass walks all 8 indexes
    // (~3 GB). On a growing append-only table the insert trigger always fires
    // first, so lowering this factor buys nothing until the table stops
    // growing — and then buys 10x more full index passes.
    expect(normalizedSql).not.toMatch(/autovacuum_vacuum_scale_factor/i);
  });

  it('adds partial encrypted-op sequence index concurrently', () => {
    const migrationSql = readFileSync(
      join(
        currentDir,
        '../prisma/migrations/20260514000000_add_encrypted_ops_partial_index/migration.sql',
      ),
      'utf8',
    );

    expect(migrationSql).toContain('CREATE INDEX CONCURRENTLY');
    expect(migrationSql).toContain(
      'DROP INDEX CONCURRENTLY IF EXISTS "operations_user_id_server_seq_encrypted_idx"',
    );
    expect(migrationSql).toContain('"operations_user_id_server_seq_encrypted_idx"');
    expect(migrationSql).toContain('ON "operations"("user_id", "server_seq")');
    expect(migrationSql).toContain('WHERE "is_payload_encrypted" = true');
    expect(migrationSql).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(migrationSql).not.toMatch(/\bBEGIN\b|\bCOMMIT\b/i);
  });

  it('adds operation payload_bytes as a metadata-only column (no table rewrite)', () => {
    const migrationSql = readFileSync(
      join(
        currentDir,
        '../prisma/migrations/20260514000001_add_operation_payload_bytes/migration.sql',
      ),
      'utf8',
    );

    // ADD COLUMN ... NOT NULL DEFAULT <constant> is a metadata-only operation on
    // PostgreSQL 11+ (the default is stored in pg_attribute, no table rewrite).
    // These guards lock in the fast path: a future edit to a volatile/expression
    // default or a separate UPDATE backfill would rewrite/lock a 100M-row table.
    expect(migrationSql).toMatch(
      /ALTER TABLE "operations"\s+ADD COLUMN "payload_bytes" BIGINT NOT NULL DEFAULT 0/i,
    );
    expect(migrationSql).not.toMatch(/\bUPDATE\b/i);
    expect(migrationSql).not.toMatch(/\bUSING\b/i);
    expect(migrationSql).not.toMatch(/DEFAULT\s+(?!0\b)/i);
    expect(migrationSql).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(migrationSql).not.toMatch(/\bBEGIN\b|\bCOMMIT\b/i);
  });

  it('adds sync_devices.app_version as a nullable catalog-only column (#9962)', () => {
    const migrationSql = readFileSync(
      join(
        currentDir,
        '../prisma/migrations/20260911000000_add_sync_device_app_version/migration.sql',
      ),
      'utf8',
    );

    // Nullable with no default: pure catalog change, no rewrite, no backfill.
    // A default would silently mark every pre-reporting device as versioned.
    // The header comment explains exactly that, so match statements only.
    const statements = migrationSql
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');
    expect(statements).toMatch(
      /ALTER TABLE "sync_devices"\s+ADD COLUMN "app_version" TEXT\s*;/i,
    );
    expect(statements).not.toMatch(/\bDEFAULT\b/i);
    expect(statements).not.toMatch(/\bNOT NULL\b/i);
    expect(statements).not.toMatch(/\bUPDATE\b/i);
    expect(statements).not.toMatch(/\bCONCURRENTLY\b/i);
    expect(statements).not.toMatch(/\bBEGIN\b|\bCOMMIT\b/i);
  });

  it('adds the payload_bytes unbackfilled partial index concurrently', () => {
    const migrationSql = readFileSync(
      join(
        currentDir,
        '../prisma/migrations/20260514000002_add_payload_bytes_unbackfilled_index/migration.sql',
      ),
      'utf8',
    );

    expect(migrationSql).toContain('CREATE INDEX CONCURRENTLY');
    expect(migrationSql).toContain(
      'DROP INDEX CONCURRENTLY IF EXISTS "operations_payload_bytes_unbackfilled_idx"',
    );
    expect(migrationSql).toContain('"operations_payload_bytes_unbackfilled_idx"');
    expect(migrationSql).toContain('ON "operations"("user_id", "id")');
    // Partial predicate must match the boot self-check / quota probe
    // (payload_bytes = 0) so the index drains to empty post-backfill.
    expect(migrationSql).toContain('WHERE "payload_bytes" = 0');
    expect(migrationSql).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(migrationSql).not.toMatch(/\bALTER\s+TABLE\b/i);
    expect(migrationSql).not.toMatch(/\bBEGIN\b|\bCOMMIT\b/i);
  });

  it('adds the operation entity_ids column as a metadata-only column (no table rewrite)', () => {
    const migrationSql = readMigration('20260613000000_add_operation_entity_ids');

    // Same fast-path guards as payload_bytes: ADD COLUMN with a constant default is
    // metadata-only on PG 11+. A future edit to an expression default or a separate
    // UPDATE backfill would rewrite/lock a 100M-row table — #8334 is forward-only by
    // design (pre-migration rows fall back to the scalar entity_id), so no backfill.
    expect(migrationSql).toMatch(
      /ALTER TABLE "operations"\s+ADD COLUMN "entity_ids" TEXT\[\] NOT NULL DEFAULT '\{\}'/i,
    );
    expect(migrationSql).not.toMatch(/\bUPDATE\b/i);
    expect(migrationSql).not.toMatch(/\bUSING\b/i);
    expect(migrationSql).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(migrationSql).not.toMatch(/\bBEGIN\b|\bCOMMIT\b/i);
  });

  it('adds the entity_ids GIN index concurrently as a single native-apply statement', () => {
    const migrationSql = readMigration(
      '20260613000001_add_operation_entity_ids_gin_index',
    );

    expect(migrationSql).toContain('CREATE INDEX CONCURRENTLY');
    expect(migrationSql).toContain('"operations_entity_ids_gin"');
    expect(migrationSql).toContain('USING GIN ("entity_ids")');
    // Bare CREATE (no IF NOT EXISTS / no drop-then-create): an interrupted concurrent
    // build must fail loudly, matching the 20260511000000 precedent.
    expect(migrationSql).not.toMatch(/\bIF\s+NOT\s+EXISTS\b/i);
    expect(migrationSql).not.toMatch(/\bALTER\s+TABLE\b/i);
    expect(migrationSql).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(migrationSql).not.toMatch(/\bBEGIN\b|\bCOMMIT\b/i);
    // This migration is already applied in production. Changing it to set the
    // reloption or clean the pending list would break its Prisma checksum.
    expect(migrationSql).not.toMatch(/\bALTER\s+INDEX\b|\bfastupdate\b/i);
    expect(migrationSql).not.toMatch(/\bgin_clean_pending_list\b/i);
  });

  it('disables entity_ids GIN fastupdate in a lock-bounded forward migration', () => {
    const migrationSql = readMigration(
      '20260720000000_disable_operation_entity_ids_gin_fastupdate',
    );
    const lockTimeout = migrationSql.match(
      /\bSET\s+LOCAL\s+lock_timeout\s*=\s*'(\d+)(ms|s)'\s*;/i,
    );
    const alterIndex = migrationSql.match(
      /\bALTER\s+INDEX\s+"operations_entity_ids_gin"\s+SET\s*\(\s*fastupdate\s*=\s*off\s*\)\s*;/i,
    );
    const lockTimeoutMs =
      Number(lockTimeout?.[1]) * (lockTimeout?.[2].toLowerCase() === 's' ? 1000 : 1);

    expect(lockTimeout).not.toBeNull();
    expect(lockTimeoutMs).toBeGreaterThan(0);
    expect(lockTimeoutMs).toBeLessThanOrEqual(5000);
    expect(alterIndex).not.toBeNull();
    expect(alterIndex?.index ?? -1).toBeGreaterThan(lockTimeout?.index ?? -1);
    expect(migrationSql).not.toMatch(/\bgin_clean_pending_list\b|\bVACUUM\b/i);
    expect(migrationSql).not.toMatch(/\bBEGIN\b|\bCOMMIT\b/i);
  });

  it('cleans the entity_ids GIN pending list only after the ALTER migration commits', () => {
    const alterMigrationName =
      '20260720000000_disable_operation_entity_ids_gin_fastupdate';
    const cleanupMigrationName =
      '20260720000001_clean_operation_entity_ids_gin_pending_list';
    const cleanupSql = readMigration(cleanupMigrationName);
    const statementTimeout = cleanupSql.match(
      /\bSET\s+LOCAL\s+statement_timeout\s*=\s*'(\d+)(ms|s)'\s*;/i,
    );
    const statementTimeoutMs =
      Number(statementTimeout?.[1]) *
      (statementTimeout?.[2].toLowerCase() === 's' ? 1000 : 1);

    // Prisma wraps each migration independently, so the consecutive directory
    // is a separate transaction and cannot extend the ALTER's exclusive lock.
    // Ordered against the real migration directory — comparing the two literals
    // above to each other would be a tautology that nothing could ever fail.
    const migrationNames = readdirSync(migrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(migrationNames).toContain(alterMigrationName);
    expect(migrationNames.indexOf(cleanupMigrationName)).toBeGreaterThan(
      migrationNames.indexOf(alterMigrationName),
    );
    const cleanup = cleanupSql.match(
      /\bSELECT\s+(?:pg_catalog\.)?gin_clean_pending_list\s*\([^)]*operations_entity_ids_gin[^)]*\)\s*;/i,
    );
    expect(statementTimeout).not.toBeNull();
    expect(statementTimeoutMs).toBeGreaterThan(0);
    expect(statementTimeoutMs).toBeLessThanOrEqual(300_000);
    expect(cleanup).not.toBeNull();
    expect(cleanup?.index ?? -1).toBeGreaterThan(statementTimeout?.index ?? -1);
    expect(cleanupSql).not.toMatch(/\bALTER\s+INDEX\b|\bfastupdate\b|\bVACUUM\b/i);
    expect(cleanupSql).not.toMatch(/\bBEGIN\b|\bCOMMIT\b/i);
  });

  // 🔧 heyta：跳过（it.skip）。
  // 本测试断言的是 **Super Productivity 仓库自身的布局与 CI 配置**：
  //   - 从 `../../../.github/workflows/supersync-docker.yml` 读文件
  //     （上游服务端在 `packages/super-sync-server/`，深三层；heyta 在 `server/`，深两层）
  //   - 断言内容含 `packages/super-sync-server/**` 等上游专属路径
  //   - 断言上游 docker-compose / helm 的部署细节
  // 这些都不适用于 heyta —— heyta 的 CI 与部署编排是**另一件独立的工作**。
  // 留着它只会让 `pnpm test` 长期变红，掩盖真正的问题。
  it.skip('runs migrations before replacing the app during compose deploys', () => {
    const deployScript = readFileSync(join(currentDir, '../scripts/deploy.sh'), 'utf8');
    const runtimeMigrateScript = readFileSync(
      join(currentDir, '../scripts/migrate-deploy.sh'),
      'utf8',
    );
    const buildAndPushScript = readFileSync(
      join(currentDir, '../scripts/build-and-push.sh'),
      'utf8',
    );
    const dockerfile = readFileSync(join(currentDir, '../Dockerfile'), 'utf8');
    const composeFile = readFileSync(join(currentDir, '../docker-compose.yml'), 'utf8');
    const composeBuildFile = readFileSync(
      join(currentDir, '../docker-compose.build.yml'),
      'utf8',
    );
    const helmDeployment = readFileSync(
      join(currentDir, '../helm/supersync/templates/deployment.yaml'),
      'utf8',
    );
    const helmValues = readFileSync(
      join(currentDir, '../helm/supersync/values.yaml'),
      'utf8',
    );
    const helmHelpers = readFileSync(
      join(currentDir, '../helm/supersync/templates/_helpers.tpl'),
      'utf8',
    );
    const helmDatabaseUrlCheck = readFileSync(
      join(currentDir, '../helm/supersync/templates/database-url-check.yaml'),
      'utf8',
    );
    const dockerWorkflow = readFileSync(
      join(currentDir, '../../../.github/workflows/supersync-docker.yml'),
      'utf8',
    );
    const migrationCommand = 'sh scripts/migrate-deploy.sh';
    const startCommand = 'up -d --wait --wait-timeout "$WAIT_TIMEOUT"';
    const externalDbStartCommand =
      'up -d --wait --wait-timeout "$WAIT_TIMEOUT" --no-deps supersync caddy';

    expect(deployScript).toContain('POSTGRES_WAIT_TIMEOUT');
    expect(deployScript).toContain('load_env_value()');
    expect(deployScript).toContain('POSTGRES_SERVICE="${POSTGRES_SERVICE-postgres}"');
    expect(deployScript).toContain('@db:5432');
    expect(deployScript).toContain('@postgres:5432');
    expect(deployScript).toContain('SUPER_SYNC_DEPLOY_REEXECED');
    expect(deployScript).toMatch(/git hash-object/);
    expect(deployScript).toMatch(/exec\s+"\$DEPLOY_SCRIPT_FILE"/);
    expect(deployScript).toContain('verify_supersync_image_revision()');
    expect(deployScript).toContain('supersync_image_source_revision()');
    expect(deployScript).toContain('assert_clean_supersync_image_inputs()');
    expect(deployScript).toContain('git log -1 --format=%H');
    expect(deployScript).toContain('../../.dockerignore');
    expect(deployScript).toContain('git ls-files --others --exclude-standard');
    expect(deployScript).toContain('packages/shared-schema');
    expect(deployScript).toContain('Refusing to build a labeled supersync image');
    expect(deployScript).toContain('SUPERSYNC_SKIP_IMAGE_REVISION_CHECK');
    expect(deployScript).toContain('org.opencontainers.image.revision');
    expect(deployScript).toContain('config --format json');
    expect(deployScript).toContain('.services.supersync.image // empty');
    expect(deployScript).toContain('jq is required');
    expect(deployScript).toContain('docker compose config --format json failed');
    expect(deployScript).toContain('docker image inspect');
    expect(deployScript).toContain('run --rm --no-deps --interactive=false -T');
    expect(deployScript).toContain('-e "MIGRATE_STEP_TIMEOUT=$MIGRATE_STEP_TIMEOUT"');
    // One-off migrator containers are named per-deploy and force-removed (inline
    // + an EXIT trap) so a timed-out `docker compose run` cannot orphan the
    // container and leak Prisma's advisory lock into the next deploy (P1002).
    expect(deployScript).toContain('run_migrator()');
    expect(deployScript).toContain('--name "$name"');
    // Container name and EXIT-sweep filter must derive from ONE prefix, else a
    // rename in one spot silently breaks the sweep backstop this PR relies on.
    expect(deployScript).toContain('MIGRATOR_NAME_PREFIX="supersync-migrator-$$"');
    expect(deployScript).toContain('local name="${MIGRATOR_NAME_PREFIX}-$RANDOM"');
    expect(deployScript).toContain('--filter "name=${MIGRATOR_NAME_PREFIX}-"');
    expect(deployScript).toContain('docker rm -f "$name"');
    expect(deployScript).toContain('trap cleanup_migrator_containers EXIT');
    // The host forwards its migration budget into the image so the in-image
    // per-step timeout can't silently cap a large MIGRATION_TIMEOUT at the
    // image default (1800s) and kill a slow CREATE INDEX CONCURRENTLY early.
    expect(deployScript).toContain(
      'MIGRATE_STEP_TIMEOUT="${MIGRATE_STEP_TIMEOUT:-$((MIGRATION_TIMEOUT',
    );
    expect(deployScript).toContain('prisma db execute');
    expect(deployScript).toContain(migrationCommand);
    expect(deployScript).toContain('Migrator container started');
    expect(deployScript).toContain('prisma db execute --schema prisma/schema.prisma');
    // Recovery now lives in the in-image scripts/migrate-deploy.sh. The host
    // must NOT re-hardcode migration names or index DDL: that lockstep
    // host/image coupling is exactly what caused the production skew bug.
    expect(deployScript).not.toMatch(/_INDEX_MIGRATION=/);
    expect(deployScript).not.toContain('run_concurrent_index_sql');
    expect(deployScript).not.toContain('CREATE INDEX CONCURRENTLY "operations');
    // Host still owns the timeout + exit-code policy around the migrator: it
    // passes MIGRATION_TIMEOUT into run_migrator, which wraps the container run
    // in `timeout` and force-removes the container afterward.
    expect(deployScript).toContain('run_migrator "$MIGRATION_TIMEOUT"');
    expect(deployScript).toContain('timeout -k 30 "$run_timeout"');
    expect(deployScript).toContain('prisma migrate deploy timed out');
    expect(deployScript).toContain('database migrations failed (exit $MIGRATE_STATUS)');
    expect(deployScript).toContain(externalDbStartCommand);
    expect(deployScript).toContain('awk -v script="$script_path"');
    expect(deployScript).toContain('$command_index == script');
    expect(deployScript).toContain('RUN_MIGRATIONS_ON_STARTUP');
    expect(deployScript.indexOf(migrationCommand)).toBeLessThan(
      deployScript.indexOf(startCommand),
    );
    expect(dockerfile).toContain('ARG VCS_REF=unknown');
    expect(dockerfile).toContain('LABEL org.opencontainers.image.revision=$VCS_REF');
    expect(dockerfile).toContain('RUN_MIGRATIONS_ON_STARTUP');
    expect(dockerfile).toContain('sh scripts/migrate-deploy.sh');
    expect(dockerfile).toContain('NODE_OPTIONS=--max-old-space-size=576');
    expect(composeBuildFile).toContain('VCS_REF: ${SUPERSYNC_BUILD_SHA:-local}');
    expect(composeBuildFile).toContain('MIGRATE_RECOVERY_BUILD_LOCAL=true');
    expect(buildAndPushScript).toContain('supersync_image_source_revision()');
    expect(buildAndPushScript).toContain('assert_clean_supersync_image_inputs');
    expect(buildAndPushScript).toContain('git -C "$REPO_ROOT" log -1 --format=%H');
    expect(buildAndPushScript).toContain('.dockerignore');
    expect(buildAndPushScript).toContain('git -C "$REPO_ROOT" ls-files --others');
    expect(buildAndPushScript).toContain('--build-arg "VCS_REF=$VCS_REF"');
    expect(dockerWorkflow).toContain('push:');
    expect(dockerWorkflow).toContain('branches:');
    expect(dockerWorkflow).toContain('- master');
    expect(dockerWorkflow).toContain('fetch-depth: 0');
    expect(dockerWorkflow).toContain('.dockerignore');
    expect(dockerWorkflow).toContain('packages/super-sync-server/**');
    expect(dockerWorkflow).toContain('Resolve image source revision');
    expect(dockerWorkflow).toContain('Could not resolve SuperSync image source revision');
    expect(dockerWorkflow).toContain('revision=$revision');
    expect(dockerWorkflow).toContain('VCS_REF=${{ steps.source-ref.outputs.revision }}');
    expect(dockerWorkflow).not.toContain('labels: ${{ steps.meta.outputs.labels }}');
    expect(helmDeployment).toContain('sh scripts/migrate-deploy.sh');
    expect(
      helmDeployment.match(/include "supersync\.postgresqlConnectionLimit" \./g),
    ).toHaveLength(2);
    expect(helmHelpers).toContain(
      'postgresql.connectionLimit must be a positive integer',
    );
    expect(helmValues).toContain('connectionLimit: 20');
    expect(helmDeployment).not.toContain('regexMatch');
    expect(helmDeployment.match(/REQUIRE_DATABASE_POOL_LIMITS/g)).toHaveLength(1);
    expect(helmDeployment.indexOf('REQUIRE_DATABASE_POOL_LIMITS')).toBeLessThan(
      helmDeployment.indexOf('{{- if .Values.postgresql.enabled }}'),
    );
    expect(helmDatabaseUrlCheck).toContain('"helm.sh/hook": pre-upgrade');
    expect(helmDatabaseUrlCheck).toContain("command: ['node', '-e']");
    expect(helmDatabaseUrlCheck).toContain('Number.isSafeInteger');
    expect(helmDatabaseUrlCheck).not.toContain('migrate-deploy.sh');
    expect(helmDatabaseUrlCheck).not.toContain('activeDeadlineSeconds');
    expect(helmDatabaseUrlCheck).toContain('.Values.externalDatabase.existingSecret');
    expect(helmDatabaseUrlCheck).toContain(
      'include "supersync.fullname" . | trunc 44 | trimSuffix "-"',
    );
    expect(helmDatabaseUrlCheck).toContain(
      'app.kubernetes.io/component: database-url-check',
    );
    expect(helmDatabaseUrlCheck).not.toContain('supersync.selectorLabels');
    expect(runtimeMigrateScript).toContain(
      'DATABASE_URL must include exactly one positive connection_limit and pool_timeout value each',
    );
    expect(runtimeMigrateScript).toContain(
      '-f docker-compose.yml -f docker-compose.build.yml',
    );
    expect(
      runtimeMigrateScript.match(/MIGRATE_STEP_TIMEOUT=\$STEP_TIMEOUT/g),
    ).toHaveLength(3);
    // Architectural invariant (the actual bug class): the generic runtime
    // script must NOT hardcode any migration name or index DDL — that lockstep
    // coupling is what went stale and broke the production deploy. Behavioral
    // coverage of the recovery logic lives in migrate-deploy-script.spec.ts.
    expect(runtimeMigrateScript).toContain('npx prisma migrate deploy');
    expect(runtimeMigrateScript).not.toMatch(/_INDEX_MIGRATION=/);
    // Derived from the migrations themselves rather than a hand-kept denylist —
    // the old three-name list passed vacuously when a NEW name was hardcoded.
    const migrationSql = allMigrationSql();
    const indexNames = [
      ...migrationSql.matchAll(
        /\b(?:CREATE|ALTER|DROP)\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+(?:NOT\s+)?EXISTS\s+)?"([^"]+)"/gi,
      ),
    ].map((match) => match[1]);
    // Sentinel: the name this script must never mention again. Guards against
    // the extraction silently degrading to a handful of matches and passing.
    expect(indexNames).toContain('operations_entity_ids_gin');
    expect(indexNames.length).toBeGreaterThan(15);
    expect(indexNames.filter((name) => runtimeMigrateScript.includes(name))).toEqual([]);
    // Reloption keywords are not index names, so the derived list cannot see a
    // hardcode like `fastupdate` — check the ones the migrations actually set.
    // EVERY option in the list, not just the first: the earlier form stopped at
    // `SET\s*\(\s*([a-z_]+)`, so in `SET (a = 1, b = 2)` it never saw `b` and
    // the script was free to hardcode it. That blind spot was live.
    const reloptions = [
      ...migrationSql.matchAll(
        /\bALTER\s+(?:INDEX|TABLE)\s+(?:IF\s+EXISTS\s+)?"[^"]+"\s+SET\s*\(([^)]*)\)/gi,
      ),
    ].flatMap((match) => [...match[1].matchAll(/([a-z_]+)\s*=/gi)].map((o) => o[1]));
    // Same sentinel role as above: a regex that quietly stopped matching would
    // otherwise leave `[].filter(...)` green.
    expect(reloptions).toContain('fastupdate');
    expect(reloptions).toContain('autovacuum_vacuum_insert_scale_factor');
    expect(reloptions.filter((name) => runtimeMigrateScript.includes(name))).toEqual([]);
    // No migration directory name either.
    expect(runtimeMigrateScript).not.toMatch(/\b20\d{12}_[a-z]/);
    expect(composeFile).toContain(
      'RUN_MIGRATIONS_ON_STARTUP=${RUN_MIGRATIONS_ON_STARTUP:-false}',
    );
    expect(composeFile).toContain('REQUIRE_DATABASE_POOL_LIMITS=true');
    expect(composeFile).toContain('MIGRATE_RECOVERY_RUNTIME=compose');
    expect(composeFile).toContain('connection_limit=60&pool_timeout=10');
    expect(composeFile).toContain(
      'psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB" -c "SELECT 1"',
    );
    expect(composeFile).toContain('aliases:');
    expect(composeFile).toContain('- db');
  });

  it('mounts a writable /tmp into the migrate-db initContainer so migrate-deploy.sh runs under readOnlyRootFilesystem', () => {
    const helmDeployment = readFileSync(
      join(currentDir, '../helm/supersync/templates/deployment.yaml'),
      'utf8',
    );
    const helmValues = readFileSync(
      join(currentDir, '../helm/supersync/values.yaml'),
      'utf8',
    );

    const migrateDbStart = helmDeployment.indexOf('- name: migrate-db');
    expect(migrateDbStart).toBeGreaterThan(-1);
    // The migrate-db initContainer block ends at the next list item at the
    // same indent (the following initContainer).
    const nextContainer = helmDeployment.indexOf(
      '\n        - name: ',
      migrateDbStart + 1,
    );
    expect(nextContainer).toBeGreaterThan(migrateDbStart);
    const migrateDbBlock = helmDeployment.slice(migrateDbStart, nextContainer);

    // migrate-deploy.sh writes a temp log via `mktemp` under /tmp and runs
    // with `set -eu`, so a read-only /tmp aborts the install before any
    // migration runs. /tmp must therefore be backed by a writable volume
    // mounted into THIS initContainer.
    expect(migrateDbBlock).toContain('sh scripts/migrate-deploy.sh');
    expect(migrateDbBlock).toContain('volumeMounts:');
    expect(migrateDbBlock).toMatch(/- name: tmp\s+mountPath: \/tmp/);
    // ...and the mounted volume must actually be declared as a writable
    // emptyDir at the pod level.
    expect(helmDeployment).toMatch(/- name: tmp\s+emptyDir:/);
    // The mount is required precisely because the shared securityContext
    // applied to this initContainer sets a read-only root filesystem.
    expect(helmValues).toContain('readOnlyRootFilesystem: true');
  });

  it('backfills operation payload bytes with per-user batched updates', () => {
    const script = readFileSync(
      join(currentDir, '../scripts/migrate-payload-bytes.ts'),
      'utf8',
    );
    const packageJson = readFileSync(join(currentDir, '../package.json'), 'utf8');

    expect(script).toContain('SELECT DISTINCT user_id');
    // Batch size sized for throughput: a tiny batch made a 100M-row backfill take
    // tens of hours, prolonging the slow octet_length() quota fallback window.
    expect(script).toContain('const DEFAULT_BATCH_SIZE = 500');
    expect(script).toContain('const MAX_BATCH_SIZE = 1000');
    // The override is still clamped so a fat-fingered value cannot OOM the
    // Node process building the VALUES string.
    expect(script).toContain('Math.min(parsed, MAX_BATCH_SIZE)');
    expect(script).toContain('userId,');
    expect(script).toContain('FROM (VALUES ${values}) AS v(id, bytes)');
    expect(script).toContain('SET payload_bytes = v.bytes');
    expect(script).toContain('storage_used_bytes = usage.total_bytes');
    expect(packageJson).toContain(
      '"migrate-payload-bytes": "node dist/scripts/migrate-payload-bytes.js"',
    );
    expect(packageJson).toContain(
      '"migrate-payload-bytes:dev": "ts-node scripts/migrate-payload-bytes.ts"',
    );
    expect(script).not.toContain('prisma.operation.update({');
  });
});

// Regression coverage for issue #8187: the migration chain must be able to
// create a fresh database on its own, and must stay in sync with schema.prisma.
describe('schema bootstrap and drift (#8187)', () => {
  const migrationNames = (): string[] =>
    readdirSync(migrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

  it('starts with a baseline that creates the base tables (no ALTER on a missing table)', () => {
    const sql = readMigration('0_init');

    // migrate deploy applies migrations in lexicographic order; the baseline
    // must sort before the first incremental (ALTER-only) migration so the
    // tables those migrations ALTER actually exist on a fresh database.
    expect(migrationNames()[0]).toBe('0_init');

    for (const table of ['users', 'operations', 'user_sync_state', 'sync_devices']) {
      expect(sql).toContain(`CREATE TABLE "${table}"`);
    }
  });

  it('adds the magic-link login_token columns and index that schema.prisma requires', () => {
    const sql = readMigration('20260601000000_add_login_token');

    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS "login_token" TEXT/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS "login_token_expires_at" BIGINT/i);
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS "users_login_token_idx" ON "users"\("login_token"\)/i,
    );
  });

  it('keeps every @map column in schema.prisma backed by a migration', () => {
    const schema = readFileSync(join(currentDir, '../prisma/schema.prisma'), 'utf8');
    const migrations = allMigrationSql();

    // The #8187 root cause was a column declared in schema.prisma (login_token)
    // with no migration creating it, so a migrate-only database crashed at
    // runtime with `column users.login_token does not exist`. Guard the whole
    // bug class: every `@map("col")` (single @, so model `@@map` table names are
    // excluded by the lookbehind) must appear as a quoted identifier in some
    // migration. Quoting avoids substring matches (e.g. "login_token" must not
    // be satisfied by "login_token_expires_at").
    const mappedColumns = [...schema.matchAll(/(?<!@)@map\("([^"]+)"\)/g)].map(
      (match) => match[1],
    );
    expect(mappedColumns.length).toBeGreaterThan(0);

    const missing = mappedColumns.filter((column) => !migrations.includes(`"${column}"`));
    expect(missing).toEqual([]);
  });
});

/**
 * 令牌哈希化（W2）那一切的**清理迁移**判据。
 *
 * 这一刀是两条腿：代码改成按 SHA-256 查（由 `scripts/check-token-hashing.mjs` 钉住写法，
 * `tests/magic-link-registration.spec.ts` / `tests/passkey.spec.ts` 钉住"两个出口对照"），
 * 库里现存的明文凭证由这条迁移作废（由下面这几条钉住**一条都不能漏**）。
 *
 * 🔴 为什么这条测试从 `schema.prisma` **推导**要清的列，而不是把列名抄在这里：
 * 抄一遍就意味着"以后加第五个令牌列、忘了在这里登记"仍然全绿 —— 而那正是这次改动
 * 要防的那类事（一个能直接使用的登录凭证悄悄躺在备份里）。从 schema 推出来，
 * 新增列不配清理就红。
 */
describe('auth token hashing cleanup migration', () => {
  const MIGRATION = '20261005000000_invalidate_stored_auth_tokens';
  const schema = readFileSync(join(currentDir, '../prisma/schema.prisma'), 'utf8');
  const sql = readMigration(MIGRATION);

  /**
   * 从 schema 里找出所有 `*_token` 列（不含 `*_token_expires_at`）及其所在表。
   *
   * 🔴 分母**限定在这条迁移动过的表上**（2026-10-08，因为 `email_change_requests` 那两张
   * 新表带的 `old_token` / `new_token` 撞上了这个正则）。原句"新增一个令牌列、不配清理就红"
   * 对**这条迁移之后才建起来的表**在逻辑上不成立：那一年的 SQL 里没有那一行，
   * 而新表建出来时零行 —— 没有存量可作废。把它硬塞进 `updateFor()` 只会得到一句假话
   * （"清理过了"），而那条迁移并没有、也不可能清理它。
   *
   * 少了一条真判据吗？没有。这一族列真正要防的是"一枚能直接使用的凭证以**可用**的形状躺在库里与备份里"，
   * 所以下面那条 `new token columns are only ever written hashed` 接手了这一半：
   * 落在本次迁移范围之外的新令牌列，必须**只**经 `hashToken()` 写进去。
   * 范围收窄的是"谁该被这条 UPDATE 清"，不是"谁该被证明是哈希"。
   */
  const migratedTables = (): Set<string> => {
    const tables = new Set<string>();
    for (const match of sql.matchAll(/UPDATE\s+"([^"]+)"|DELETE FROM\s+"([^"]+)"/gi)) {
      const name = match[1] ?? match[2];
      if (name) tables.add(name);
    }
    return tables;
  };

  const tokenColumns = (
    { scope = true } = {},
  ): Array<{ table: string; column: string; nullable: boolean }> => {
    const tables = migratedTables();
    const found: Array<{ table: string; column: string; nullable: boolean }> = [];
    for (const block of schema.split(/^model\s+/m).slice(1)) {
      const tableName = block.match(/@@map\("([^"]+)"\)/)?.[1] ?? block.split('{')[0].trim();
      // `scope === true` 只留这条迁能动得到的表；`false` 只留**它动不到**的那些（下面那条判据用）。
      if (scope === !tables.has(tableName)) continue;
      for (const line of block.split('\n')) {
        const mapped = line.match(/@map\("([^"]+_token)"\)/);
        if (!mapped) continue;
        // 字段形状固定为 `<字段名> <类型>[?]<空白>@map(...)`；`?` 就是可空。
        const declaration = line.match(/^\s*\w+\s+([A-Za-z]+)(\?)?\s/);
        expect(declaration, `解析不出字段声明：${line}`).not.toBeNull();
        found.push({
          table: tableName,
          column: mapped[1],
          nullable: declaration?.[2] === '?',
        });
      }
    }
    return found;
  };

  it('finds the token columns it claims to cover (the guard itself must not be vacuous)', () => {
    const columns = tokenColumns();
    // 前提断言：这一族列确实存在。若解析坏掉，下面两条会"零违规"地通过 ——
    // 那正是 AGENTS §7 里"一条永远通过的判据比没有判据更糟"的形状。
    expect(columns.map((c) => c.column).sort()).toEqual(
      ['login_token', 'passkey_recovery_token', 'reset_password_token', 'verification_token', 'verification_token'].sort(),
    );
  });

  /**
   * 取出针对某张表的那条 UPDATE（到第一个 `;` 为止）。
   *
   * 为什么不直接对整个文件做正则：`UPDATE "users" … ; DELETE FROM …` 之后，
   * `UPDATE "users"[\s\S]*?"某列" = NULL` 会**越过那条 UPDATE 的边界**去匹配后面的内容，
   * 于是"漏清一列"也可能被判成已清。按语句切是这条判据成立的前提。
   */
  const updateFor = (table: string): string => {
    const match = sql.match(new RegExp(`UPDATE\\s+"${table}"[^;]*;`, 'i'));
    expect(match, `迁移里没有针对 "${table}" 的 UPDATE`).not.toBeNull();
    return match[0];
  };

  it('nulls every nullable token column and its expiry, on the same table', () => {
    for (const { table, column, nullable } of tokenColumns()) {
      if (!nullable) continue;
      const statement = updateFor(table);
      expect(statement).toMatch(new RegExp(`"${column}"\\s*=\\s*NULL`, 'i'));
      // 过期时间一起清：留着它会让"有令牌"的判读（`loginToken && expires > now`）
      // 变成对着一个 NULL 令牌做时间比较。
      expect(statement).toMatch(new RegExp(`"${column}_expires_at"\\s*=\\s*NULL`, 'i'));
    }
  });

  /**
   * 🔴 上面那条把分母收窄到"这条迁移能动的表"，这一条把**没收进来**的那一半接住。
   *
   * 这一族列真正要防的是"一枚能直接使用的凭证以可用的形状躺在库里，而库每晚进备份"。
   * 那条 UPDATE 治的是**存量明文**；对新表来说没有存量，但**"只能写哈希"这条纪律一样成立**。
   * 所以范围外的每一列都必须只经 `hashToken()` 落库 —— 少了这一条，收窄分母就是在放宽判据。
   *
   * 形状检查分不出明文和哈希（两者都是 64 个 `[0-9a-f]`），所以这里钉的是**写入表达式**，
   * 与 `password-recovery.spec.ts` 那两个出口对照是同一条立场的两半。
   */
  it('every token column created after that migration is only ever written through hashToken()', () => {
    const scope = migratedTables();
    const outside = tokenColumns({ scope: false });
    // 前提断言：这一族确实存在，否则这条会"零违规"地通过（AGENTS §7 那条元规则）。
    expect(outside.length, 'schema 里应该有本迁移范围之外的令牌列').toBeGreaterThan(0);

    for (const { table, column } of outside) {
      // 列名 → schema 里的字段名（`old_token` → `oldToken`）。
      const field = column.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
      const source = readFileSync(join(currentDir, '../src/account/email-change.ts'), 'utf8');
      // 抓到 `oldToken: <表达式>` 里那个表达式名。
      const assigned = source.match(new RegExp(`${field}:\\s*([A-Za-z_$][\\w$]*)\\s*,`));
      expect(assigned, `${table}.${column} 没有写入口`).not.toBeNull();
      // 🔴 那个表达式必须是**当场由 `hashToken()` 算出来的那一个**。
      // 只查"文件里出现过 hashToken"是不够的：明文写进去、旁边另算一份哈希，照样绿。
      expect(
        source,
        `${table}.${column} 被明文写进了库（${assigned![1]} 不是 hashToken() 的结果）`,
      ).toMatch(new RegExp(`const ${assigned![1]} = hashToken\\(`));
    }
  });

  it('empties the table whose token column is NOT NULL, because nulling it is impossible', () => {
    const notNull = tokenColumns().filter((entry) => !entry.nullable);
    expect(notNull.length).toBeGreaterThan(0);
    for (const { table } of notNull) {
      expect(sql).toMatch(new RegExp(`DELETE\\s+FROM\\s+"${table}"`, 'i'));
    }
  });

  it('stays a plain two-statement DML migration with no lock or index hazard', () => {
    // 🔴 判的是**剥掉整行注释之后**的 SQL。迁移文件里的说明会提到
    // "没有 CONCURRENTLY""不是 ALTER TABLE"这类词，直接对着原文断言会把自己写的
    // 理由当成违规 —— `scripts/check-migrations.mjs` 就是因为这个才先 strip 的。
    const statements = sql
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');

    // 见 server/prisma/migrations/README.md 优先级 1：表与用户数同阶 ⇒ 普通 DML。
    expect(statements).not.toMatch(/CONCURRENTLY/i);
    expect(statements).not.toMatch(/\bBEGIN\b|\bCOMMIT\b/i);
    expect(statements).not.toMatch(/DROP\s+(TABLE|INDEX)/i);
    expect(statements).not.toMatch(/ALTER\s+TABLE/i);
    // 令牌清干净是靠一条 UPDATE 覆盖**所有**四个可空列；写成四条也可以，
    // 但必须是一条，否则中途失败会留下"清了三个、第四个还是明文"的状态。
    expect(statements.match(/UPDATE\s+"users"/gi) ?? []).toHaveLength(1);
  });

  it('does not touch the password hash while it is at it', () => {
    // 清理令牌的迁移顺手清 `password_hash` = 把全部账号的口令抹掉。
    // 这不是假设：同一条 UPDATE 写在同一张表上，最容易犯的错就是多带一列。
    const statements = sql
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    expect(statements).not.toMatch(/password_hash/i);
    expect(statements).not.toMatch(/is_verified/i);
    expect(statements).not.toMatch(/token_version/i);
  });
});

describe('一次性迁移 override（D-3：compose 自己就够，但不改默认服务图）', () => {
  const composeFile = readFileSync(join(currentDir, '../docker-compose.yml'), 'utf8');
  const override = readFileSync(
    join(currentDir, '../docker-compose.migrate-once.yml'),
    'utf8',
  );

  // 从 `services:` 段里取两空格缩进的服务名。解析层坏掉的形状是"返回空数组"，
  // 于是下面每条 toEqual 都变成"空 = 空"的假绿 —— 所以每个用例都先喂一条必然命中的名字。
  const servicesIn = (text: string): string[] => {
    const lines = text.split('\n');
    const start = lines.findIndex((line) => line === 'services:');
    expect(start, '这个文件里没有一个顶格的 services: 行 —— 解析层没有输入可读。').toBeGreaterThanOrEqual(0);
    const out: string[] = [];
    for (const line of lines.slice(start + 1)) {
      // 顶格 = 已经出了 services 段（volumes / networks）。
      if (/^[^\s#]/.test(line)) break;
      const m = line.match(/^  ([a-z][a-z0-9_-]*):\s*$/);
      if (m) out.push(m[1]);
    }
    return out.sort();
  };

  it('默认服务图恰好三个 —— 迁移服务不许进默认档', () => {
    const services = servicesIn(composeFile);
    expect(services).toContain('supersync');
    expect(services).toEqual(['caddy', 'postgres', 'supersync']);
    // 🔴 这条是本轮的红线：一次性服务一旦落进默认图，就会和 `deploy.sh` 自己的
    // migrator 在同一次 `up` 里抢 Prisma 的迁移锁 —— `RUN_MIGRATIONS_ON_STARTUP`
    // 默认 false 防的正是这件事。所以这里既查"三个"，也查"这个名字没出现在默认文件里"。
    expect(composeFile).not.toContain('supersync-migrate');
    expect(composeFile).toContain('RUN_MIGRATIONS_ON_STARTUP=${RUN_MIGRATIONS_ON_STARTUP:-false}');
  });

  it('override 只加那一个服务，其余两张图逐字不变', () => {
    const services = servicesIn(override);
    expect(services).toEqual(['supersync', 'supersync-migrate']);
    expect(override).not.toMatch(/^  postgres:$/m);
    expect(override).not.toMatch(/^  caddy:$/m);
  });

  it('一次性服务跑的是**镜像里那一份**迁移脚本，并带上让校验真的生效的开关', () => {
    // 🔴 每条都锚在**行形状**上，不用 `includes(字面量)`。实测原因：这个文件的注释里
    // 就写着 `REQUIRE_DATABASE_POOL_LIMITS=true`（第 17 行，讲 helm 那段），
    // 于是"把环境行删掉"这一发变异**一个测试都没打死** —— 注释把判据喂饱了。
    // 与 `check-server-env-forwarding.mjs` 同批修掉的那个放水是同一个形状。
    const envLine = (key: string, value: string) =>
      new RegExp(`^[ \\t]*-[ \\t]*${key}=${value}[ \\t]*$`, 'm');
    expect(override).toMatch(/entrypoint:\s*\[.*migrate-deploy\.sh/s);
    // 与主容器同一枚镜像（写在 `image:` 那一行，不是某句注释里提了一下）。
    expect(override).toMatch(/^ *image: \$\{SUPERSYNC_IMAGE:-supersync:local\}$/m);
    expect(override).toContain("restart: 'no'");
    expect(override).toMatch(/condition:\s*service_completed_successfully/);
    expect(override).toMatch(envLine('REQUIRE_DATABASE_POOL_LIMITS', 'true'));
    // 行锚定但不以 `$` 收尾 —— 这一行的值是一个 `${VAR:-…}` 插值，行尾是它的 `}`。
    expect(override).toMatch(/^ *-{1} *DATABASE_URL=.*connection_limit=60&pool_timeout=10/m);
  });

  it('受支持入口写在对外第一屏，且说清"一次性服务只在第一次开机迁移"', () => {
    const readme = readFileSync(join(currentDir, '../README.md'), 'utf8');
    const firstScreen = readme.split('\n').slice(0, 120).join('\n');
    expect(firstScreen).toContain('./scripts/deploy.sh');
    expect(firstScreen).toContain('docker-compose.migrate-once.yml');
    expect(firstScreen).toContain('unmigrated');
    // "只在第一次管用"这条必须披露。少了它，这个入口会被读成"以后每次都不用管"——
    // 那比没有更糟：它让运维相信自己已经迁过了。
    expect(firstScreen).toContain('--force-recreate supersync-migrate');
  });
});
