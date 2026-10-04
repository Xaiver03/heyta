/**
 * P1-1 变异：把 `pause()` 里那句 `stopTicking()` 摘掉 ⇒ 暂停那条必须红，
 * 而且红在"暂停后 `tick` 还在涨"这一句；恢复那条（活体证据）必须仍然绿。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ROOT 从**本文件自己的位置**推导，不写死某台机器的检出路径 ——
// 这些装置现在住在仓库里（`research/tools/mutation-rigs/`），
// 台账引用的证据必须对下一台机器也成立。（路径里有空格，所以要 decodeURIComponent。）
const ROOT = fileURLToPath(new URL('../../..', import.meta.url)).replace(/\/$/, '');
const FILE = `${ROOT}/apps/web/src/features/focus/store.ts`;
const SPEC = 'focus-pause-stops-ticking.spec.ts';
const orig = readFileSync(FILE, 'utf8');

const ANCHOR = `    stopTicking();
    set({ state: pauseFn(get().state, Date.now()), tick: get().tick + 1 });`;

function parseRan(out) {
  // vitest 的 summary 行形如 `Tests  2 passed (2)` 或 `Tests  1 failed | 1 passed (2)`；
  // **集合期失败（变异体语法错）根本没有这行** ⇒ 回 -1，绝不回 0 ——
  // 回 0 会和"真的 0 条红"撞车，而那条臂（对照臂）的期望恰好就是 0。
  const m = out.match(/^\s*Tests\s+.*\((\d+)\)/m);
  return m ? Number(m[1]) : -1;
}

function run() {
  let out = '';
  try {
    out = execFileSync('npx', ['vitest', 'run', `tests/${SPEC}`], {
      cwd: `${ROOT}/apps/web`,
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
  }
  const failed = out.includes(' failed') ? Number(out.match(/Tests\s+(\d+) failed/)?.[1] ?? 0) : 0;
  return { out, failed, ran: parseRan(out) };
}

const results = [];
function check(label, expectFailed, needles, antiNeedles) {
  const { out, failed, ran } = run();
  if (ran <= 0) {
    writeFileSync(FILE, orig);
    throw new Error(
      `「${label}」这一臂没跑到任何用例（ran=${String(ran)}），已还原源文件。\n${out.slice(-1500)}`,
    );
  }
  const ok =
    failed === expectFailed &&
    needles.every((n) => out.includes(n)) &&
    (antiNeedles ?? []).every((n) => !out.includes(n));
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ⇒ failed=${failed} ran=${ran}`);
  if (!ok) console.log(out.split('\n').filter((l) => /✓|×|→|FAIL/.test(l)).slice(0, 20).join('\n'));
}

// `--selftest`：只验**读数解析这一层**，不跑 vitest、不改源码 ⇒ 内存闸门被占时也能跑。
// 三条夹具都是真实形状：全绿行（对照臂读的正是它）、一红一绿行、集合期失败（没有 Tests 行）。
if (process.argv.includes('--selftest')) {
  const fixtures = [
    ['全绿行（对照臂读的就是它）', ' Test Files  1 passed (1)\n      Tests  2 passed (2)\n', 2],
    ['一红一绿行', ' Test Files  1 passed (1)\n      Tests  1 failed | 1 passed (2)\n', 2],
    ['集合期失败（无 Tests 行）', ' FAIL  tests/x.spec.ts\n SyntaxError: Unexpected token )\n', -1],
  ];
  let selfBad = 0;
  for (const [label, text, want] of fixtures) {
    const got = parseRan(text);
    const ok = got === want;
    if (!ok) selfBad += 1;
    console.log(`${ok ? 'OK ' : 'BAD'} ${label} ⇒ ran=${String(got)}（期望 ${String(want)}）`);
  }
  console.log(selfBad === 0 ? 'SELFTEST=PASS（三臂）' : `SELFTEST=FAIL（${String(selfBad)} 臂）`);
  process.exit(selfBad === 0 ? 0 : 1);
}

try {
  check('臂 0 对照（未变异）2 条全绿', 0, [], []);
  const hits = orig.split(ANCHOR).length - 1;
  if (hits !== 1) throw new Error(`锚点命中 ${hits} 次，装置失效`);
  writeFileSync(FILE, orig.replace(ANCHOR, ANCHOR.replace('    stopTicking();\n', '')));
  check('臂 A 摘掉 pause 的 stopTicking ⇒ 恰好 1 条红，红在"暂停后还在涨"', 1, ['暂停后 `tick` 还在涨'], []);
  // 臂 B：改成"停表但停错对象"—— 把 pause 的停表换成 abort 的那句之外的空操作？
  // 用"恢复时补停"这种看起来像修的形状：在 resume 里加 stopTicking()（它其实无效，
  // 因为 ensureTicking 立刻又装上）⇒ 仍然必须红，证明判据不被这种假修绕过。
  writeFileSync(FILE, orig);
  const resumeAnchor = `    set({ state: resumeFn(get().state, now, get().config), tick: get().tick + 1 });
    ensureTicking(get, set);`;
  const h2 = readFileSync(FILE, 'utf8').split(resumeAnchor).length - 1;
  if (h2 !== 1) throw new Error(`臂 B 锚点命中 ${h2} 次，装置失效`);
  writeFileSync(
    FILE,
    readFileSync(FILE, 'utf8').replace(
      ANCHOR,
      ANCHOR.replace('    stopTicking();\n', ''),
    ).replace(resumeAnchor, `    stopTicking();\n${resumeAnchor}`),
  );
  check('臂 B "在 resume 里补停表"这种假修 ⇒ 仍然红（判据不被绕过）', 1, ['暂停后 `tick` 还在涨'], []);
} finally {
  writeFileSync(FILE, orig);
}

check('还原后 2 条全绿', 0, [], []);
const bad = results.filter((r) => !r).length;
console.log(bad === 0 ? '\n四臂全对 ✅' : `\n有臂不对 ❌ (${bad})`);
process.exit(bad === 0 ? 0 : 1);
