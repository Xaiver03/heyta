/** Creates a short-lived test CA; never disables TLS verification or reads .env. */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const server = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entry = process.argv[2];
if (process.argv.length !== 3 || (entry !== '--central' && !/^tests\/integration\/[a-z0-9-]+\.integration\.spec\.ts$/.test(entry || ''))) {
  throw new Error('Use the registered test:integration:central-oidc command with an explicit test file');
}
const dir = mkdtempSync(join(tmpdir(), 'heyta-oidc-tls-'));
function openssl(args) {
  const result = spawnSync('openssl', args, { cwd: dir, stdio: 'pipe' });
  if (result.status !== 0) throw new Error('Test CA generation failed');
}
try {
  openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.pem', '-days', '1', '-subj', '/CN=heyta-test-ca']);
  openssl(['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'server.key', '-out', 'server.csr', '-subj', '/CN=localhost']);
  writeFileSync(join(dir, 'extensions'), 'subjectAltName=IP:127.0.0.1,DNS:localhost\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\n');
  openssl(['x509', '-req', '-in', 'server.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'server.pem', '-days', '1', '-extfile', 'extensions']);
  const env = { ...process.env, NODE_EXTRA_CA_CERTS: join(dir, 'ca.pem'), HEYTA_OIDC_TEST_CERT: join(dir, 'server.pem'), HEYTA_OIDC_TEST_KEY: join(dir, 'server.key') };
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Error('TLS verification must remain enabled');
  const args = entry === '--central'
    ? ['scripts/verify-central-oidc-http.mjs']
    : ['node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.integration.config.ts', '--maxWorkers=1', entry];
  const result = spawnSync(process.execPath, args, { cwd: server, env, stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
} finally {
  // This directory contains only newly generated synthetic test keys.
  rmSync(dir, { recursive: true, force: true });
}
