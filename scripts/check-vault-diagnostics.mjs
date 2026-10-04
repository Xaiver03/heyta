#!/usr/bin/env node
/** A real failing browser must not persist the recovery form's aria tree.
 * The negative arm removes the guard in the temporary config only. It must
 * expose the synthetic canary, proving that the test can detect this leak.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const temporary = await mkdtemp(join(root, 'e2e', '.vault-diagnostics-'));
const canary = randomBytes(32).toString('hex');
await writeFile(join(temporary, 'probe.spec.ts'), `import { expect, test } from '@playwright/test';
test('sensitive form failure', async ({ page }) => {
  await page.setContent('<div data-testid="recovery">' + process.env.HEYTA_DIAGNOSTIC_CANARY + '</div>');
  expect(false, 'intentional diagnostic failure').toBe(true);
});
test('secret input failure', async ({ page }) => {
  const { fillVaultSecret } = await import('../vault/privacy');
  page.setDefaultTimeout(100);
  if (process.env.HEYTA_DIAGNOSTIC_MUTANT === '1') {
    await page.locator('#missing-secret-input').fill(process.env.HEYTA_DIAGNOSTIC_CANARY!);
  } else {
    await fillVaultSecret(page.locator('#missing-secret-input'), process.env.HEYTA_DIAGNOSTIC_CANARY!);
  }
});
`);
await writeFile(join(temporary, 'config.ts'), `import { defineConfig } from '@playwright/test';
import base from '../playwright.vault.config';
if (process.env.HEYTA_DIAGNOSTIC_MUTANT === '1') delete process.env.PLAYWRIGHT_NO_COPY_PROMPT;
export default defineConfig({ ...base, testDir: '.', webServer: undefined,
  outputDir: './results', reporter: [['json']],
  use: { ...base.use, baseURL: undefined } });
`);
async function filesBelow(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await filesBelow(path));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}
async function run(mutant) {
  const reportPath = join(temporary, mutant ? 'mutant.json' : 'guarded.json');
  const result = await new Promise((resolve, reject) => {
    const child = spawn('pnpm', ['--dir', 'e2e', 'exec', 'playwright', 'test',
      `--config=${join(temporary, 'config.ts')}`], {
      cwd: root, env: { ...process.env, HEYTA_DIAGNOSTIC_CANARY: canary,
        HEYTA_DIAGNOSTIC_MUTANT: mutant ? '1' : '0', PLAYWRIGHT_JSON_OUTPUT_NAME: reportPath },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    child.stdout.on('data', value => { log += value; });
    child.stderr.on('data', value => { log += value; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, log }));
  });
  // A test lock, missing browser or build failure is not a successful negative arm.
  let report;
  try { report = JSON.parse(await readFile(reportPath, 'utf8')); }
  catch { throw new Error('Diagnostic probe did not produce a test report; check the test lock/browser availability'); }
  if (result.code !== 1 || report.stats?.unexpected !== 2 || report.stats?.skipped !== 0 ||
      !JSON.stringify(report).includes('intentional diagnostic failure') ||
      (!mutant && !JSON.stringify(report).includes('Vault secret entry failed'))) {
    throw new Error('Diagnostic probe did not reach the intentional assertion');
  }
  const contextFiles = (await filesBelow(join(temporary, 'results'))).filter(path => path.endsWith('error-context.md'));
  if (contextFiles.length !== 2) throw new Error('Diagnostic probe did not produce the expected error contexts');
  const context = (await Promise.all(contextFiles.map(path => readFile(path, 'utf8')))).join('\n');
  const leaked = context.includes(canary) || JSON.stringify(report).includes(canary) || result.log.includes(canary);
  if (leaked !== mutant) throw new Error(mutant ? 'Diagnostic mutation survived' : 'Guarded diagnostics leaked the synthetic secret');
  console.log(mutant ? 'PASS: removing the aria guard exposes the canary (negative control)' :
    'PASS: failure diagnostics preserve assertions without the sensitive page tree');
}
try {
  await run(false);
  await run(true);
} finally {
  // This exact directory was created above; never remove a caller-supplied path.
  if (dirname(temporary) === join(root, 'e2e')) await rm(temporary, { recursive: true, force: true });
}
