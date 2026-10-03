#!/usr/bin/env node
/**
 * Mutation gate for the B crypto contract.
 * Each mutation is written to the real source, the named focused test must
 * fail, and the original file is restored in finally. A green mutation is a
 * broken security test, so this script exits non-zero in that case.
 */
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const root = new URL('../packages/sync-core/src/key-lifecycle.ts', import.meta.url);
const original = await readFile(root, 'utf8');
const evidence = await mkdtemp(join(tmpdir(), 'heyta-key-mutation-'));
const mutations = [
  {
    name: 'recovery-checksum',
    testName: 'generates a checksummed recovery code',
    marker: 'generates a checksummed recovery code',
    from: "if (!bytes || normalized.at(-1) !== RECOVERY_ALPHABET[sha256(bytes)[0] & 31]) {",
    to: 'if (false) {',
  },
  {
    name: 'purpose-domain-separation',
    testName: 'derives independent feature keys',
    marker: 'derives independent feature keys',
    from: "getTextEncoder().encode(`heyta:feature-key:${purpose}:v${keyVersion}`)",
    to: "getTextEncoder().encode(`heyta:feature-key:sync:v${keyVersion}`)",
  },
  {
    name: 'record-aad-binding',
    testName: 'binds identity, purpose, and version',
    marker: 'binds identity, purpose, and version',
    replacements: [
      ["aadFor('record', purpose, keyVersion, id)", "aadFor('record', purpose, keyVersion)"],
      ["aadFor('record', record.purpose, record.keyVersion, record.id)", "aadFor('record', record.purpose, record.keyVersion)"],
    ],
  },
];

const run = (args) => new Promise((resolve) => {
  const child = spawn('pnpm', args, {
    cwd: new URL('..', import.meta.url),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  child.on('error', (error) => resolve({ code: 1, output: String(error) }));
  child.on('exit', (code) => resolve({ code: code ?? 1, output }));
});

let failed = false;
try {
  const baseline = await run(['--filter', '@heyta/sync-core', 'test']);
  if (baseline.code !== 0) {
    throw new Error(`Baseline sync-core test suite failed:\n${baseline.output}`);
  }
  for (const mutation of mutations) {
    let mutated = original;
    if (mutation.replacements) {
      for (const [from, to] of mutation.replacements) {
        if (!mutated.includes(from)) throw new Error(`Mutation anchor missing: ${mutation.name}`);
        mutated = mutated.replace(from, to);
      }
    } else {
      if (!mutated.includes(mutation.from)) throw new Error(`Mutation anchor missing: ${mutation.name}`);
      mutated = mutated.replace(mutation.from, mutation.to);
    }
    await writeFile(root, mutated);
    const resultFile = join(evidence, `${mutation.name}.json`);
    const result = await run([
      '--filter', '@heyta/sync-core', 'exec', 'vitest', 'run',
      'tests/key-lifecycle.spec.ts', '--testNamePattern', mutation.testName,
      '--reporter=json', `--outputFile=${resultFile}`,
    ]);
    let assertionFailed = false;
    try {
      const report = JSON.parse(await readFile(resultFile, 'utf8'));
      assertionFailed = report.testResults.some((suite) => suite.assertionResults.some((test) =>
        test.fullName.includes(mutation.marker) && test.status === 'failed' &&
        test.failureMessages.some((message) => /AssertionError|promise resolved[\s\S]*instead of rejecting/.test(message))));
    } catch { /* Missing/invalid report is an infrastructure failure, never caught. */ }
    if (result.code === 0) {
      failed = true;
      console.error(`MUTATION SURVIVED: ${mutation.name}`);
    } else if (!assertionFailed) {
      failed = true;
      console.error(`MUTATION FAILED FOR UNEXPECTED REASON: ${mutation.name}\n${result.output}`);
    } else {
      console.log(`mutation caught: ${mutation.name}`);
    }
  }
} finally {
  await writeFile(root, original);
  await rm(evidence, { recursive: true, force: true });
}

process.exitCode = failed ? 1 : 0;
