/**
 * P0-7 变异装置：证明「listByTask 只摊一遍表」那五条判据真的有牙。
 *
 * 四臂（都改 `packages/app-host/src/reminder-actions.ts`）：
 *  A 归组退回 O(任务 × 提醒)（对任务表每个 id 各扫一遍提醒表）⇒ 第①面「摊了 N 遍」转红；
 *  B 归组不滤墓碑 ⇒ 第④面「被删的提醒出现在归组结果里」转红；
 *  C 归组丢掉 id 字典序 ⇒ 第③面「与逐任务读不同」转红；
 *  D 未变异对照 ⇒ 全绿。
 *
 * 🔴 共享工作树纪律：源文件只在拿到测试窗口的那几秒处于变异态；
 * 被闸门顶掉就先还原、再等，绝不带着变异体等人（那会给别人的套件造假红）。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ROOT 从**本文件自己的位置**推导，不写死某台机器的检出路径 ——
// 这些装置现在住在仓库里（`research/tools/mutation-rigs/`），
// 台账引用的证据必须对下一台机器也成立。（路径里有空格，所以要 decodeURIComponent。）
const ROOT = fileURLToPath(new URL('../../..', import.meta.url)).replace(/\/$/, '');
const SRC = `${ROOT}/packages/app-host/src/reminder-actions.ts`;
const SPEC = 'tests/reminder-actions.spec.ts';
const LOCK = '/tmp/tfa-test.lock';

const orig = readFileSync(SRC, 'utf8');

function restore() {
  writeFileSync(SRC, orig);
}

function patch(from, to, label) {
  const text = readFileSync(SRC, 'utf8');
  const hits = text.split(from).length - 1;
  if (hits !== 1) throw new Error(`${label}: 锚点命中 ${String(hits)} 次（期望 1），装置失效`);
  writeFileSync(SRC, text.replace(from, to));
}

function runOne() {
  let out = '';
  try {
    out = execFileSync('npx', ['vitest', 'run', SPEC], {
      cwd: `${ROOT}/packages/app-host`,
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
  }
  return { out, refused: out.includes('拒绝启动') || out.includes('tfa-test.lock') };
}

function mutateAndRun(apply) {
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    if (existsSync(LOCK)) {
      console.log(`     [闸门被占，第 ${String(attempt)} 次，等 20 秒（源文件保持原样）]`);
      restore();
      execFileSync('sleep', ['20']);
      continue;
    }
    if (apply !== undefined) apply();
    const { out, refused } = runOne();
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
    // 于是 failed=0 看起来像"这条判据没牙"。所以一条用例都没跑起来的臂**直接报错**，
    // 不进入红/绿判定。
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

const LOOP_HEAD = [
  '  const aliveByTask = (): Map<string, Reminder[]> => {',
  '    const grouped = new Map<string, Reminder[]>();',
  '    for (const reminder of aliveReminders(Object.values(ctx.getState().reminders))) {',
].join('\n');

try {
  console.log('> A 归组退回 O(任务 x 提醒)');
  let r = mutateAndRun(() => {
    patch(
      LOOP_HEAD,
      [
        '  const aliveByTask = (): Map<string, Reminder[]> => {',
        '    const grouped = new Map<string, Reminder[]>();',
        '    const flat = Object.keys(ctx.getState().tasks).flatMap((tid) =>',
        '      aliveReminders(Object.values(ctx.getState().reminders)).filter((x) => x.taskId === tid));',
        '    for (const reminder of flat) {',
      ].join('\n'),
      'A',
    );
  });
  check('A 有红', r.failed >= 1, `failed=${String(r.failed)} ran=${String(r.ran)} 红集=${r.reds.join(' | ')}`);
  check('A 红在第①面（摊了 N 遍）', r.out.includes('把提醒表摊了'), `红集=${r.reds.join(' | ')}`);

  console.log('> B 归组不滤墓碑');
  // ⚠️ 第一版这里写成 `LOOP_HEAD.replace('aliveReminders(Object.values(', 'Object.values(')`，
  // 剥掉一层函数调用却留下多出来的右括号 ⇒ **变异体是语法错误**，vitest 报的是
  // 集合期失败、`Tests` 行里根本没有 "N failed"，装置于是读到 failed=0，
  // 看起来像"这条判据没牙"。真实读数是 ran=37 那两条才有意义，所以每条 check
  // 现在都带 ran，且要求 ran ≥ 30（这套件有 37 条）。
  r = mutateAndRun(() => {
    patch(
      '    for (const reminder of aliveReminders(Object.values(ctx.getState().reminders))) {',
      '    for (const reminder of Object.values(ctx.getState().reminders)) {',
      'B',
    );
  });
  check('B 真的跑到了用例', r.ran >= 30, `ran=${String(r.ran)}`);
  check('B 有红', r.failed >= 1, `failed=${String(r.failed)} ran=${String(r.ran)} 红集=${r.reds.join(' | ')}`);
  check('B 红在第④面（墓碑进了归组）', r.out.includes('被删的提醒出现在归组结果里'), `红集=${r.reds.join(' | ')}`);

  console.log('> C 归组丢掉顺序');
  r = mutateAndRun(() => {
    patch('        byTask[taskId] = reminders;', '        byTask[taskId] = reminders.slice().reverse();', 'C');
  });
  check('C 有红', r.failed >= 1, `failed=${String(r.failed)} 红集=${r.reds.join(' | ')}`);
  check('C 红在第③面（与逐任务读不同）', r.out.includes('的归组结果与逐任务读不同'), `红集=${r.reds.join(' | ')}`);

  console.log('> D 未变异对照');
  r = mutateAndRun(undefined);
  check('D 全绿', r.failed === 0, `failed=${String(r.failed)} 红集=${r.reds.join(' | ')}`);
} finally {
  restore();
  const same = readFileSync(SRC, 'utf8') === orig;
  console.log(same ? 'reminder-actions.ts 已还原（逐字节相同）' : 'BAD 还原后与原文不同');
  if (!same) bad += 1;
}
console.log(bad === 0 ? 'MUTATE-P07=PASS' : `MUTATE-P07=FAIL（${String(bad)} 项）`);
process.exitCode = bad === 0 ? 0 : 1;
