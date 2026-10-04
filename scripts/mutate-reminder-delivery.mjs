#!/usr/bin/env node
/** C invariants: require the named assertion to fail, never count setup failures.
 * Run exclusively with respect to workspace builds. Sources are restored by
 * byte comparison; concurrent edits are preserved rather than overwritten.
 */
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const workspace = new URL('..', import.meta.url);
const evidence = await mkdtemp(join(tmpdir(), 'heyta-reminder-mutations-'));
const cases = [
  {
    name: 'offline-write-wakeup', package: '@heyta/mobile',
    file: 'apps/mobile/src/lib/native-reminder-scheduler.ts',
    test: 'tests/native-reminder-authorization.spec.ts',
    assertion: 'schedules after an offline write without sync or foreground events',
    from: 'return onLocalWrite(() => { void reconcileNativeReminders().catch(onError); });',
    to: 'return () => {}; // mutation: offline writes never wake the delivery engine',
  },
  {
    name: 'permission-completion', package: '@heyta/mobile',
    file: 'apps/mobile/src/lib/native-reminder-scheduler.ts',
    test: 'tests/native-reminder-authorization.spec.ts',
    assertion: 'schedules an already saved reminder when permission resolves',
    from: 'await requestReminderAuthorization();\n  await reconcileNativeReminders();',
    to: 'await requestReminderAuthorization(); // mutation: no completion wakeup',
  },
  {
    name: 'receipt-persistence', package: '@heyta/app-host',
    file: 'packages/app-host/src/reminder-delivery.ts',
    test: 'tests/reminder-delivery.spec.ts',
    assertion: 'keeps a receipt unacknowledged when the op cannot be persisted',
    from: '// Keep the receipt for a later retry if the local op could not be written.',
    to: 'acknowledged.push(occurrenceId); // mutation: lose receipt after failed write',
  },
  {
    name: 'uncertain-occurrence', package: '@heyta/ui',
    file: 'packages/ui/src/reminders/model.ts',
    test: 'tests/reminders-model.spec.ts',
    assertion: 'is tied to an occurrence, remains actionable',
    from: 'uncertain.has(`${reminder.id}|${reminderEffectiveAt(reminder)}`)',
    to: '[...uncertain].some((id) => id.startsWith(`${reminder.id}|`))',
  },
];
// These arms exercise real encrypted HTTP/PG and two independent SQLite hosts.
// Run with --http and DATABASE_URL against the isolated validation checkout.
const httpTest = 'tests/integration/reminder-delivery-http.integration.spec.ts';
const httpCases = [
  {
    name: 'http-fired-reschedule', file: 'packages/app-host/src/reminder-scheduler.ts',
    assertion: 'downloads the fired occurrence, cancels B pending work, survives reopen',
    from: '&& !reminderIsFired(reminder)', to: '&& true /* mutation: replay fired reminders */',
  },
  {
    name: 'http-pending-cancel', file: 'packages/app-host/src/reminder-delivery.ts',
    assertion: 'downloads the fired occurrence, cancels B pending work, survives reopen',
    from: 'if (!await delivery.cancelStale(keepIds, pending.map((reminder) => reminder.occurrenceId)))',
    to: 'if (false /* mutation: never cancel native pending work */)',
  },
  {
    name: 'http-snooze-occurrence', file: 'packages/app-host/src/reminder-scheduler.ts',
    assertion: 'transports snooze and daily completion without applying a late receipt',
    from: 'occurrenceId: `${reminder.id}|${effectiveAt}`',
    to: 'occurrenceId: `${reminder.id}|${reminder.triggerAt}`',
  },
].map(spec => ({ ...spec, package: '@heyta/sync-server', test: httpTest, rebuild: true }));
function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', args, { cwd: workspace, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { output += data; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, output }));
  });
}
const selection = process.argv[2];
const httpMode = selection === '--http' || selection?.startsWith('http-');
const available = httpMode ? httpCases : cases;
if (httpMode && !process.env.DATABASE_URL) throw new Error('HTTP mutations require a real DATABASE_URL; skipped tests are not evidence');
if (selection !== undefined && selection !== '--http' && !available.some(spec => spec.name === selection)) throw new Error('Unknown mutation');
async function rebuild(spec) {
  if (!spec.rebuild) return;
  const result = await run(['--filter', '@heyta/app-host', 'build']);
  if (result.code !== 0) throw new Error(`Build failed: ${spec.name}\n${result.output}`);
}
for (const spec of available.filter(spec => selection === undefined || selection === '--http' || spec.name === selection)) {
  const args = ['--filter', spec.package, 'exec', 'vitest', 'run',
    ...(httpMode ? ['--config', 'vitest.integration.config.ts'] : []), spec.test];
  await rebuild(spec);
  const baseline = await run(args);
  if (baseline.code !== 0) throw new Error(`Baseline failed: ${spec.name}\n${baseline.output}`);
  const path = new URL(spec.file, workspace);
  const original = await readFile(path, 'utf8');
  if (original.split(spec.from).length !== 2) throw new Error(`Non-unique anchor: ${spec.name}`);
  const mutant = original.replace(spec.from, spec.to);
  const reportPath = join(evidence, `${spec.name}.json`);
  try {
    await writeFile(path, mutant);
    await rebuild(spec);
    const result = await run([...args, '--reporter=json', `--outputFile=${reportPath}`]);
    await writeFile(join(evidence, `${spec.name}.log`), result.output);
    const report = JSON.parse(await readFile(reportPath, 'utf8'));
    const caught = report.testResults.some(suite => suite.assertionResults.some(assertion =>
      assertion.fullName.includes(spec.assertion) && assertion.status === 'failed' &&
      assertion.failureMessages.some(message => /AssertionError/.test(message))));
    if (result.code === 0 || !caught) throw new Error(`Not caught by expected assertion: ${spec.name}`);
    console.log(`mutation caught: ${spec.name}`);
  } finally {
    if (await readFile(path, 'utf8') !== mutant) {
      await writeFile(join(evidence, `${spec.name}.original`), original);
      throw new Error(`Concurrent edit preserved; original saved in ${evidence}`);
    }
    await writeFile(path, original);
    await rebuild(spec);
  }
}
console.log(`Evidence: ${evidence}`);
