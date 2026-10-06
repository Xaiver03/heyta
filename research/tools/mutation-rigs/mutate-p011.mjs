/**
 * P0-11 变异装置：证明「派生数 = 1 / 并发度 = 1 / 密文互不相同」这三条判据真的有牙。
 *
 * 三臂：
 *  A 把串行 for 换回并发（原病灶）⇒ 应当**恰好**「派生数 = 1」那条红，阳性对照不受影响；
 *  B 假修：只加密第一条、N 条复用同一份密文 ⇒ 派生数仍是 1，
 *    所以只有「N 条都真出去 / 密文各不相同」那条有牙 ⇒ 应当**恰好**它红；
 *  C 未变异对照 ⇒ 必须 3 passed / 0 failed（否则装置本身在骗人）。
 *
 * 🔴 **共享工作树纪律**：源文件只在"真的拿到测试窗口"的那几秒里处于变异态。
 * 本机有个宿主级测试闸门（`/tmp/tfa-test.lock` + `~/.tfa-shield` shim）：别的套件在跑时
 * vitest 会直接拒绝启动。若先变异再等窗口，`client.ts` 会在**别人正在跑的套件**眼里
 * 坏上好几分钟 —— 那会给人家制造一个指不到原因的假红。
 * ⇒ 顺序改成：等锁空 ⇒ 变异 ⇒ 跑 ⇒ **立刻还原**；被拒了就还原、等、再变异重跑。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ROOT 从**本文件自己的位置**推导，不写死某台机器的检出路径 ——
// 这些装置现在住在仓库里（`research/tools/mutation-rigs/`），
// 台账引用的证据必须对下一台机器也成立。（路径里有空格，所以要 decodeURIComponent。）
const ROOT = fileURLToPath(new URL('../../..', import.meta.url)).replace(/\/$/, '');
const SRC = `${ROOT}/packages/sync-client/src/client.ts`;
const SPEC = 'tests/upload-key-derivation-once.spec.ts';
const LOCK = '/tmp/tfa-test.lock';

const orig = readFileSync(SRC, 'utf8');

const SERIAL = [
  '      const ops: Awaited<ReturnType<typeof toWireOp>>[] = [];',
  '      for (const op of batch) ops.push(await toWireOp(op));',
].join('\n');

function restore() {
  writeFileSync(SRC, orig);
}

function applyMutation(toLines, label) {
  const text = readFileSync(SRC, 'utf8');
  const hits = text.split(SERIAL).length - 1;
  if (hits !== 1) throw new Error(`${label}：锚点命中 ${hits} 次（期望 1），装置失效`);
  writeFileSync(SRC, text.replace(SERIAL, toLines.join('\n')));
}

function runOne() {
  let out = '';
  let refused = false;
  try {
    out = execFileSync('npx', ['vitest', 'run', SPEC], {
      cwd: `${ROOT}/packages/sync-client`,
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
  }
  if (out.includes('拒绝启动') || out.includes('tfa-test.lock')) refused = true;
  return { out, refused };
}

/** 等到闸门空 ⇒ 变异 ⇒ 跑 ⇒ 还原。 */
function mutateAndRun(apply) {
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    if (existsSync(LOCK)) {
      console.log(`     [闸门被占，第 ${attempt} 次，等 20 秒（源文件保持原样）]`);
      restore();
      execFileSync('sleep', ['20']);
      continue;
    }
    if (apply !== undefined) applyMutation(apply, 'arm');
    const { out, refused } = runOne();
    restore();
    if (refused) {
      console.log(`     [起跑瞬间被闸门顶掉，第 ${attempt} 次：已还原再等]`);
      execFileSync('sleep', ['20']);
      continue;
    }
    const line = out.match(/^\s+Tests\s+(.*)$/m)?.[1];
    if (line === undefined) throw new Error(`读不到 summary：\n${out.slice(-1500)}`);
    return {
      ran: Number(line.match(/\((\d+)\)/)?.[1] ?? -1),
      failed: Number(line.match(/(\d+) failed/)?.[1] ?? 0),
      reds: [...out.matchAll(/^\s+×\s+(.+)$/gm)].map((m) => m[1].trim()),
    };
  }
  restore();
  throw new Error('等满 20 次仍未拿到干净的测试窗口');
}

let bad = 0;
function expectArm(name, cond, detail) {
  if (cond) console.log(`✅ ${name} —— ${detail}`);
  else {
    console.log(`❌ ${name} —— ${detail}`);
    bad += 1;
  }
}

try {
  console.log('▸ A 并发回去（Promise.all）—— 原病灶');
  let r = mutateAndRun([
    '      const ops: Awaited<ReturnType<typeof toWireOp>>[] = [];',
    '      for (const q of await Promise.all(batch.map(toWireOp))) ops.push(q);',
  ]);
  expectArm('A 恰好一条红', r.failed === 1, `failed=${String(r.failed)} ran=${String(r.ran)} 红集=${r.reds.join(' | ')}`);
  expectArm('A 红在「派生数 = 1」', r.reds.some((t) => t.includes('Argon2id 派生数 = 1')), `红集=${r.reds.join(' | ')}`);
  expectArm('A 的阳性对照没跟着红', !r.reds.some((t) => t.includes('阳性对照')), `红集=${r.reds.join(' | ')}`);

  console.log('▸ B 假修：只加密一条、N 条复用同一份密文');
  r = mutateAndRun([
    '      const ops: Awaited<ReturnType<typeof toWireOp>>[] = [];',
    '      const one = batch.length === 0 ? undefined : await toWireOp(batch[0]!);',
    '      for (const op of batch) ops.push({ ...one, id: op.id });',
  ]);
  expectArm('B 恰好一条红', r.failed === 1, `failed=${String(r.failed)} ran=${String(r.ran)} 红集=${r.reds.join(' | ')}`);
  expectArm('B 红在「密文各不相同」', r.reds.some((t) => t.includes('各不相同')), `红集=${r.reds.join(' | ')}`);

  console.log('▸ C 未变异对照');
  r = mutateAndRun(undefined);
  expectArm('C 全绿', r.failed === 0, `failed=${String(r.failed)} 红集=${r.reds.join(' | ')}`);
  expectArm('C 跑到 3 条', r.ran === 3, `ran=${String(r.ran)}`);
} finally {
  restore();
  const same = readFileSync(SRC, 'utf8') === orig;
  console.log(same ? 'client.ts 已还原（逐字节相同）' : '🔴 client.ts 还原后与原文不同');
  if (!same) bad += 1;
}
console.log(bad === 0 ? 'MUTATE-P011=PASS' : `MUTATE-P011=FAIL（${String(bad)} 项）`);
process.exitCode = bad === 0 ? 0 : 1;
