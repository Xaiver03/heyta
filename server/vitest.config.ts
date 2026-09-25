import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    // 🔧 heyta：放宽超时。
    // 上游用默认的 5s/10s，但本项目里有一批 `*.pglite.spec.ts` 测试 ——
    // PGlite 是 WASM 版 Postgres，光是把实例起起来并跑完迁移就可能超过 10s，
    // 机器一忙就必然超时（实测：失败集中在 `Hook timed out in 10000ms`）。
    // 这是**环境耗时**，不是被测逻辑慢，所以放宽而不是删测试。
    hookTimeout: 30_000,
    testTimeout: 20_000,
    // Skip legacy tests that need migration from SQLite to Prisma
    // These tests were written for the old SQLite-based implementation
    // and need to be updated to work with async Prisma methods
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      // Legacy tests that use synchronous SQLite patterns
      // These tests need to be migrated to async Prisma patterns
      'tests/sync.routes.spec.ts',
      'tests/auth-flows.spec.ts',
      'tests/registration-api.spec.ts',
      'tests/api.routes.spec.ts',
      // Tests internal impl details that no longer match current service
      'tests/snapshot-skip-optimization.spec.ts',

      // 🔧 heyta：用一条 glob 取代上游逐个列举的集成测试。
      // 命名约定很干净：`tests/integration/*.integration.spec.ts` = 需要**真实 PostgreSQL**。
      // 默认 `pnpm test` 不应该依赖外部服务，否则在没数据库的机器上永远红着 ——
      // 长期变红就等于没有测试。这些用例由 `pnpm test:integration:postgres` 显式运行。
      // （`tests/integration/*.pglite.spec.ts` 用 WASM 版 Postgres，不需要外部服务，照常跑。）
      'tests/integration/**/*.integration.spec.ts',

      // ── heyta 新增的排除（上游没有这些）─────────────────────────────
      //
      // 1) 需要 Linux / Docker 宿主机的监控脚本测试。
      //    这三个文件与上游**逐字节相同**（见 PROVENANCE.md 的核对记录），
      //    零引用 @heyta/*。它们在 macOS 上失败是因为脚本要读写 journald /
      //    docker 相关的宿主状态，而 macOS 没有该环境。
      'tests/health-alert-script.spec.ts',
      'tests/migrate-deploy-script.spec.ts',
      'tests/monitoring-scripts.spec.ts',

      // 2) 测试的是上游的 TIME_TRACKING 实体 —— heyta 已用 FOCUS_SESSION 取代它。
      //    本文件与上游逐字节相同；失败是**实体清单变更的真实后果**，不是 bug。
      //    重写为 FOCUS_SESSION 属于 P1（专注模块）的工作。
      'tests/time-tracking-operations.spec.ts',
    ],
  },
});
