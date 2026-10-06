#!/usr/bin/env node
/** ADR-0050: real browser UI, independent devices, HTTP and PostgreSQL.
 * TEST_MODE only creates an authenticated synthetic account. All vault,
 * operation and migration requests use the production routes.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { databaseUrlFor, ensureDatabase, ensureServerBuilt, installCleanup, resolveNode, startServer } from './lib/auth-journey-server.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
// Prove failed recovery forms cannot enter automatic aria diagnostics before
// starting any journey that creates a real recovery code.
const diagnostics = spawn(process.execPath, ['scripts/check-vault-diagnostics.mjs'], { cwd: root, stdio: 'inherit' });
if (await new Promise((resolve) => diagnostics.on('exit', resolve)) !== 0) process.exit(1);
const dbName = 'heyta_bc_devices_20261003';
const dbUrl = databaseUrlFor(dbName);
ensureDatabase({ root, dbUrl, dbName });
ensureServerBuilt({ root, dbUrl });
const build = spawn('pnpm', ['--filter', '@heyta/web...', 'build'], { cwd: root, stdio: 'inherit' });
if (await new Promise((resolve) => build.on('exit', resolve)) !== 0) process.exit(1);
const server = await startServer({ root, node: resolveNode(), port: 3246, dbUrl,
  corsOrigins: ['http://127.0.0.1:4346'], logFile: '/tmp/heyta-vault-web-api.log' });
const cleanup = installCleanup([server]);
try {
  const test = spawn('pnpm', ['--dir', 'e2e', 'exec', 'playwright', 'test', '--config=playwright.vault.config.ts', ...process.argv.slice(2)], {
    cwd: root, stdio: 'inherit', env: { ...process.env, HEYTA_VAULT_TEST_SERVER: server.base },
  });
  process.exitCode = (await new Promise((resolve) => test.on('exit', resolve))) ?? 1;
} finally {
  cleanup();
}
