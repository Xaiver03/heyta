#!/usr/bin/env node
/** Deliberate semantic regressions must fail assertions, not just exit nonzero. */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = mkdtempSync(join(tmpdir(), 'heyta-semantic-mutations-'));
const scenarios = [
  {
    name: 'E: clientId tie-break', package: '@heyta/op-log', tests: ['tests/engine.spec.ts'],
    file: 'packages/op-log/src/state.ts',
    from: 'if (aClientId !== bClientId) return aClientId > bClientId ? 1 : -1;',
    to: 'if (false) return aClientId > bClientId ? 1 : -1;',
  },
  {
    name: 'E: delete tombstone', package: '@heyta/op-log', tests: ['tests/semantic-invariants.spec.ts'],
    file: 'packages/op-log/src/state.ts',
    from: "addFieldVersion('deletedAt', op.timestamp, false);", to: '/* mutation: omit tombstone */',
  },
  {
    name: 'E: unseen causal predecessor', package: '@heyta/op-log', tests: ['tests/semantic-invariants.spec.ts'],
    file: 'packages/op-log/src/engine.ts',
    from: 'if (this.appliedOpIds.has(op.id)) {',
    to: "if (this.appliedOpIds.has(op.id) || compareVectorClocks(op.vectorClock ?? {}, this.clock) === VectorClockComparison.LESS_THAN) {",
  },
  {
    name: 'A: frontier dominance', package: '@heyta/sync-core', tests: ['tests/causal-clock.spec.ts'],
    file: 'packages/sync-core/src/causal-clock.ts',
    from: "if (relation !== 'EQUAL' && relation !== 'GREATER_THAN') {", to: 'if (false) {',
  },
  {
    name: 'D: unapplied checkpoint hole', package: '@heyta/op-log', tests: ['tests/checkpoint-recovery.spec.ts'],
    file: 'packages/op-log/src/engine.ts',
    from: 'if (pending.some((row) => row.seq <= coveredSeq && !this.appliedOpIds.has(row.op.id))) return;',
    to: '/* mutation: incorrectly advance past unapplied operations */',
  },
  {
    name: 'D: retained full-state hydration', package: '@heyta/op-log', tests: ['tests/full-state-recovery.spec.ts'],
    file: 'packages/op-log/src/state.ts',
    from: 'const incoming = deserializeMaterializedState(payload.state);',
    to: 'const incoming = emptyState();',
  },
  {
    name: 'A: durable snapshot-only frontier', package: '@heyta/op-log', tests: ['tests/checkpoint-recovery.spec.ts'],
    file: 'packages/op-log/src/engine.ts',
    from: 'const observedClock = await this.options.store.readObservedClock?.() ?? {};',
    to: 'const observedClock = {};',
  },
  {
    name: 'D: incomplete history cannot authorize drain', package: '@heyta/op-log', tests: ['tests/full-state-recovery.spec.ts'],
    file: 'packages/op-log/src/engine.ts',
    from: 'await this.options.store.hasIncompleteHistory()) {',
    to: 'false) {',
  },
  {
    name: 'D: maintenance cannot publish local-only history', package: '@heyta/op-log', tests: ['tests/full-state-recovery.spec.ts'],
    file: 'packages/op-log/src/engine.ts',
    from: "if (source === 'import' || (uploadStatus === 'rejected' && !isFullStateOperation(op))) {",
    to: 'if (false) {',
  },
];
/**
 * 载体被宿主内存护栏挡在外面时，它只打印拒绝、不产出任何报告文件。
 * 沿用 `scripts/mutate-calendar-event-source.mjs` 里同一枚 `BAILED` 与同一个理由：
 * **那是环境，不是判据**。退 2 与退 1 对 `pnpm check` 都是红，所以这条不放松任何东西，
 * 它只是不再把"没跑成"印成 `missing assertion report` —— 后者读起来像夹具坏了。
 */
const BAILED = /内存闸门拒绝启动/;

function run(scenario, label) {
  const report = join(temporary, 'result.json');
  rmSync(report, { force: true });
  const result = spawnSync('pnpm', ['--filter', scenario.package, 'exec', 'vitest', 'run',
    ...scenario.tests, '--reporter=json', `--outputFile=${report}`],
  { cwd: root, encoding: 'utf8', timeout: 120000 });
  if (result.error || result.signal) throw result.error ?? new Error(`${label}: ${result.signal}`);
  let parsed;
  try { parsed = JSON.parse(readFileSync(report, 'utf8')); }
  catch {
    const out = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    if (BAILED.test(out)) {
      console.error(`⏸ ${label}: 载体被内存护栏挡在外面 —— 这一轮**没跑成**，不是判据没牙。`);
      console.error(out.split('\n').filter((l) => l.includes('内存闸门拒绝启动')).join('\n'));
      process.exit(2);
    }
    throw new Error(`${label}: missing assertion report\n${result.stdout}\n${result.stderr}`);
  }
  return { status: result.status, failed: parsed.numFailedTests, passed: parsed.numPassedTests };
}
try {
  for (const scenario of scenarios) {
    const baseline = run(scenario, `${scenario.name} baseline`);
    if (baseline.status !== 0 || baseline.failed !== 0 || baseline.passed < 1) {
      throw new Error(`${scenario.name}: baseline is not green: ${JSON.stringify(baseline)}`);
    }
    const file = join(root, scenario.file);
    const original = readFileSync(file, 'utf8');
    if (original.split(scenario.from).length !== 2) throw new Error(`${scenario.name}: expected exactly one anchor`);
    const mutated = original.replace(scenario.from, scenario.to);
    writeFileSync(file, mutated);
    let result;
    try { result = run(scenario, scenario.name); }
    finally {
      if (readFileSync(file, 'utf8') !== mutated) throw new Error(`${file} changed concurrently; refusing to overwrite it`);
      writeFileSync(file, original);
    }
    if (result.status === 0 || result.failed < 1) throw new Error(`${scenario.name}: mutation did not fail assertions`);
    console.log(`✅ ${scenario.name}: ${result.failed} assertion test(s) caught the mutation`);
  }
} finally { rmSync(temporary, { recursive: true, force: true }); }
