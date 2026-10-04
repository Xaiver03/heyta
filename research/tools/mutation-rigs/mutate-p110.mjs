/**
 * P1-10 变异装置：证明「计数取代全表物化」那三处判据真的有牙。
 *
 * 四臂（各自改一个源文件，跑**同包**的测试 —— 跨包判据读的是 dist，
 * 改了 src 不改 dist 会让变异静静存活，所以这里刻意不跨包）：
 *  A 删掉 worker 桥里 `countPendingUpload` 那一行转发
 *    ⇒ `op-log-bridge-forwarding.spec.ts` 报「桥少了 1 个转发：countPendingUpload」；
 *  B `countAllOps` 只数热区（丢掉 ARCHIVE）
 *    ⇒ storage 契约用例的归档腿报「总数没算 ARCHIVE」；
 *  C 引擎的队列闸门退回 `findPendingUpload().length`
 *    ⇒ op-log 的计数读侧用例报「队列判定又把整条队列读回来」；
 *  D 未变异对照 ⇒ 全绿。
 *
 * 🔴 共享工作树纪律：源文件只在拿到测试窗口的那几秒处于变异态；
 * 被闸门顶掉就先还原、再等，绝不带着变异体等人。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ROOT 从**本文件自己的位置**推导，不写死某台机器的检出路径 ——
// 这些装置现在住在仓库里（`research/tools/mutation-rigs/`），
// 台账引用的证据必须对下一台机器也成立。（路径里有空格，所以要 decodeURIComponent。）
const ROOT = fileURLToPath(new URL('../../..', import.meta.url)).replace(/\/$/, '');
const LOCK = '/tmp/tfa-test.lock';
const BRIDGE = `${ROOT}/packages/storage/src/sqlite/oplog-worker-bridge.ts`;
const STORE = `${ROOT}/packages/storage/src/db-op-log-store.ts`;
const ENGINE = `${ROOT}/packages/op-log/src/engine.ts`;

const originals = new Map([
  [BRIDGE, readFileSync(BRIDGE, 'utf8')],
  [STORE, readFileSync(STORE, 'utf8')],
  [ENGINE, readFileSync(ENGINE, 'utf8')],
]);

function restore() {
  for (const [file, text] of originals) writeFileSync(file, text);
}

function patch(file, from, to, label) {
  const text = readFileSync(file, 'utf8');
  const hits = text.split(from).length - 1;
  if (hits !== 1) throw new Error(`${label}: 锚点命中 ${String(hits)} 次（期望 1），装置失效`);
  writeFileSync(file, text.replace(from, to));
}

function runOne(cwd, spec) {
  let out = '';
  try {
    out = execFileSync('npx', ['vitest', 'run', spec], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
  }
  return { out, refused: out.includes('拒绝启动') || out.includes('tfa-test.lock') };
}

function mutateAndRun(cwd, spec, apply) {
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    if (existsSync(LOCK)) {
      console.log(`     [闸门被占，第 ${String(attempt)} 次，等 20 秒（源文件保持原样）]`);
      restore();
      execFileSync('sleep', ['20']);
      continue;
    }
    if (apply !== undefined) apply();
    const { out, refused } = runOne(cwd, spec);
    restore();
    if (refused) {
      console.log(`     [起跑瞬间被闸门顶掉，第 ${String(attempt)} 次：已还原再等]`);
      execFileSync('sleep', ['20']);
      continue;
    }
    const line = out.match(/^\s+Tests\s+(.*)$/m)?.[1];
    if (line === undefined) throw new Error(`读不到 summary:\n${out.slice(-1800)}`);
    const result = {
      out,
      ran: Number(line.match(/\((\d+)\)/)?.[1] ?? -1),
      failed: Number(line.match(/(\d+) failed/)?.[1] ?? 0),
      reds: [...out.matchAll(/^\s+×\s+(.+)$/gm)].map((m) => m[1].trim()),
    };
    // 🔴 集合期失败（变异体语法错/导入炸）时 `Tests` 行里没有 "N failed"，
    // failed 会被读成 0 —— 看起来正好是"这条判据没牙"的样子。
    // 一条用例都没跑起来的臂直接报错，不进红/绿判定。（P0-7 那一组就踩过这个。）
    if (result.ran <= 0) {
      throw new Error(`这一臂没跑到任何用例（ran=${String(result.ran)}），summary="${line}"：\n${out.slice(-1500)}`);
    }
    return result;
  }
  restore();
  throw new Error('等满 20 次仍未拿到干净的测试窗口');
}

let bad = 0;
function check(name, cond, detail) {
  if (cond) console.log(`OK  ${name} —— ${detail}`);
  else {
    console.log(`BAD ${name} —— ${detail}`);
    bad += 1;
  }
}

try {
  console.log('> A 删掉桥上 countPendingUpload 的转发');
  let r = mutateAndRun(
    `${ROOT}/packages/storage`,
    'tests/op-log-bridge-forwarding.spec.ts',
    () => patch(BRIDGE, "    countPendingUpload: () => call('countPendingUpload', []) as Promise<number>,\n", '', 'A'),
  );
  check('A 有红', r.failed >= 1, `failed=${String(r.failed)} ran=${String(r.ran)} 红集=${r.reds.join(' | ')}`);
  check('A 红在桥转发对账（点名 countPendingUpload）',
    r.out.includes('桥少了 1 个转发：countPendingUpload'), `红集=${r.reds.join(' | ')}`);

  console.log('> B countAllOps 只数热区');
  r = mutateAndRun(`${ROOT}/packages/storage`, 'tests/contract.spec.ts', () => {
    patch(
      STORE,
      '      (await tx.count(STORES.OPS)) + (await tx.count(STORES.ARCHIVE)));',
      '      await tx.count(STORES.OPS));',
      'B',
    );
  });
  check('B 有红', r.failed >= 1, `failed=${String(r.failed)} ran=${String(r.ran)}`);
  check('B 红在归档腿（总数没算 ARCHIVE）',
    r.reds.some((t) => t.includes('计数与物化同数')),
    `failed=${String(r.failed)} 红集=${r.reds.join(' | ')}`);

  console.log('> C 引擎闸门退回物化队列长度');
  r = mutateAndRun(`${ROOT}/packages/op-log`, 'tests/op-log-count-reads.spec.ts', () => {
    patch(
      ENGINE,
      '      if ((await this.options.store.countPendingUpload()) > 0 ||\n          (await this.options.store.countPendingApply()) > 0) {',
      '      if ((await this.options.store.findPendingUpload()).length > 0 ||\n          (await this.options.store.findPendingApply()).length > 0) {',
      'C',
    );
  });
  check('C 有红', r.failed >= 1, `failed=${String(r.failed)} ran=${String(r.ran)} 红集=${r.reds.join(' | ')}`);
  check('C 红在队列闸门的计数腿',
    r.out.includes('队列判定又把整条队列读回来'), `红集=${r.reds.join(' | ')}`);

  console.log('> D 未变异对照（storage 桥对账 + op-log 计数读侧）');
  r = mutateAndRun(`${ROOT}/packages/storage`, 'tests/op-log-bridge-forwarding.spec.ts', undefined);
  check('D 对照全绿（storage）', r.failed === 0, `failed=${String(r.failed)} ran=${String(r.ran)}`);
  r = mutateAndRun(`${ROOT}/packages/op-log`, 'tests/op-log-count-reads.spec.ts', undefined);
  check('D 对照全绿（op-log）', r.failed === 0, `failed=${String(r.failed)} ran=${String(r.ran)}`);
} finally {
  restore();
  let allSame = true;
  for (const [file, text] of originals) {
    if (readFileSync(file, 'utf8') !== text) {
      console.log(`BAD 还原后与原文不同：${file}`);
      allSame = false;
    }
  }
  if (allSame) console.log('三个源文件均已还原（逐字节相同）');
  else bad += 1;
}
console.log(bad === 0 ? 'MUTATE-P110=PASS' : `MUTATE-P110=FAIL（${String(bad)} 项）`);
process.exitCode = bad === 0 ? 0 : 1;
