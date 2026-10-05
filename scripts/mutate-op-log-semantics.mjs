#!/usr/bin/env node
/** Deliberate semantic regressions must fail assertions, not just exit nonzero. */
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * 🔴 为什么靠 journal 而不是靠信号处理器：`finally` 挡不住信号，而 `process.on('SIGTERM')`
 * 在这种**全程同步**的脚本里也挡不住 —— 它从不回到事件循环，回调在一次跑完之前根本不会执行，
 * 而注册本身把默认的"可被杀"行为取消了。实测（2026-10-05，载体 tmp/arm2-kill-semantics.sh）：
 * 变异窗口里发 SIGTERM ⇒ 进程没停、9 条场景全跑完、RC=0。所以这里**不设信号处理器**，
 * 让 Ctrl-C / SIGTERM 照默认行为杀掉，剩下的交给 journal：
 *
 * 2026-10-05 的另一条实测起因是整链 `pnpm check` 被 SIGTERM 掉，`state.ts` 里
 * `if (aClientId !== bClientId)` 被留在了 `if (false)` 上 —— LWW 的 clientId 决胜被摘掉，
 * 而工作树看起来只是"有点脏"。更糟的是下一次跑这道门时红会报成 `baseline is not green`：
 * 它响的是**上一轮的自己**，不是被测语义。
 *
 * 于是：① 锚点检查排在基线之前（残留态直接拒绝开跑并给出还原命令）；
 * ② 变异前把 `{file, original, mutated}` 逐字节落到 `tmp/op-log-semantics-journal.json`；
 * ③ 启动时先收上一轮的尸 —— 还在变异态 ⇒ 用 journal 里的原文还原；已还原 ⇒ 删 journal；
 *    两边都不像 ⇒ **拒绝动手**（那不是残留，是别人在改这棵树，覆盖它等于毁掉别人的工作）。
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = mkdtempSync(join(tmpdir(), 'heyta-semantic-mutations-'));
const journalDir = join(root, 'tmp');
const journalPath = join(journalDir, 'op-log-semantics-journal.json');
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

function readJournal() {
  if (!existsSync(journalPath)) return null;
  try {
    return JSON.parse(readFileSync(journalPath, 'utf8'));
  } catch {
    return { unreadable: true };
  }
}

/** 还原只认 journal 里那串字节，不重算 —— 重算就等于拿"我以为的原文"覆盖别人的编辑。 */
function restoreFromJournal(journal) {
  const file = join(root, journal.file);
  if (!existsSync(file)) return 'file-missing';
  const current = readFileSync(file, 'utf8');
  if (current === journal.original) {
    rmSync(journalPath, { force: true });
    return 'already-restored';
  }
  if (current !== journal.mutated) return 'concurrent-edit';
  writeFileSync(file, journal.original);
  rmSync(journalPath, { force: true });
  return 'restored';
}

// 崩溃/被信号杀掉之后，下一次启动先把上一轮的变异洗掉，再开始自己的基线。
const stale = readJournal();
if (stale) {
  if (stale.unreadable) {
    throw new Error(`${journalPath} 存在但读不出 JSON —— 不敢猜原文。人工处置：核对 git diff 后删掉它`);
  }
  const outcome = restoreFromJournal(stale);
  if (outcome === 'concurrent-edit' || outcome === 'file-missing') {
    throw new Error(
      `${stale.file} 现在处于"${outcome}"态 —— 既不是变异态也不是 journal 里的原文，本轮拒绝动手。\n` +
        `  journal 留在 ${journalPath}，先把它对上的那次改动处理完（git status / git diff），再删 journal。`,
    );
  }
  if (outcome === 'restored') {
    console.log(`⚠️  上一轮 ${stale.name} 没有走完（进程被杀或崩溃），${stale.file} 停在变异态 —— 按 journal 还原`);
  }
}

function run(scenario, label) {
  const report = join(temporary, 'result.json');
  rmSync(report, { force: true });
  const result = spawnSync('pnpm', ['--filter', scenario.package, 'exec', 'vitest', 'run',
    ...scenario.tests, '--reporter=json', `--outputFile=${report}`],
  { cwd: root, encoding: 'utf8', timeout: 120000 });
  if (result.error || result.signal) throw result.error ?? new Error(`${label}: ${result.signal}`);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(report, 'utf8'));
  } catch {
    const out = `${String(result.stdout ?? '')}${String(result.stderr ?? '')}`;
    // 🔴 三出口：没跑到 / 跑到且红 / 跑到且绿。上一轮的 SIGKILL 会把 spawnSync 的孩子
    // 留成孤儿，它握着并发闸门，于是这一轮"一个用例都没跑"—— 那种红不能读成判据红。
    if (out.includes('内存闸门拒绝启动')) {
      throw new Error(
        `${label}: ENV_UNAVAILABLE —— 并发闸门拒绝启动（一个用例都没跑）。` +
          `等它跑完再重跑这道门；这条不是"变异没被抓到"。\n${out.slice(0, 600)}`,
      );
    }
    throw new Error(`${label}: missing assertion report\n${out.slice(0, 2000)}`);
  }
  return { status: result.status, failed: parsed.numFailedTests, passed: parsed.numPassedTests };
}
try {
  if (!existsSync(journalDir)) mkdirSync(journalDir, { recursive: true });
  for (const scenario of scenarios) {
    const file = join(root, scenario.file);
    const original = readFileSync(file, 'utf8');
    // 锚点检查排在基线**之前**：排在后面的话，上一轮的残留会让这里先炸成
    // "baseline is not green"，响的是自己的尸，不是被测语义。
    if (original.split(scenario.from).length !== 2) {
      throw new Error(
        `${scenario.name}: 锚点在 ${scenario.file} 里不是"恰好一处"。\n` +
          `  两种可能：① 上一轮变异被中断留下的残留（现量：git diff -- ${scenario.file}），` +
          `还原 = git checkout -- ${scenario.file}；② 被验代码真的改了，锚点要跟着更新。\n` +
          `  分不清就先别跑这道门 —— 带着残留跑出来的每一条读数都不是当前源码的读数。`,
      );
    }
    const baseline = run(scenario, `${scenario.name} baseline`);
    if (baseline.status !== 0 || baseline.failed !== 0 || baseline.passed < 1) {
      throw new Error(`${scenario.name}: baseline is not green: ${JSON.stringify(baseline)}`);
    }
    const mutated = original.replace(scenario.from, scenario.to);
    // journal 先落盘再改文件：反过来的话，两者之间被杀掉就有一个没有主人的变异态。
    writeFileSync(journalPath, JSON.stringify({ name: scenario.name, file: scenario.file, original, mutated }));
    writeFileSync(file, mutated);
    let result;
    try { result = run(scenario, scenario.name); }
    finally {
      if (readFileSync(file, 'utf8') !== mutated) {
        throw new Error(`${file} changed concurrently; refusing to overwrite it（journal 保留：${journalPath}）`);
      }
      writeFileSync(file, original);
      rmSync(journalPath, { force: true });
    }
    if (result.status === 0 || result.failed < 1) throw new Error(`${scenario.name}: mutation did not fail assertions`);
    console.log(`✅ ${scenario.name}: ${result.failed} assertion test(s) caught the mutation`);
  }
} finally { rmSync(temporary, { recursive: true, force: true }); }
