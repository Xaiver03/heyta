#!/usr/bin/env node
/**
 * 逐段归属对拍器：把 `pnpm check` 拆成单段，在**两棵树**上各跑一遍，输出三个集合。
 *
 * ## 为什么需要它（不是顺手加的）
 *
 * `scripts.check` 是一长串 `&&`，**第一段红就整体退出** ⇒ "完整 check 的读数"只给得到一个失败点，
 * 看不出后面几十段的状态。而合并落地要的恰恰是逐段归属："这枚红是本批造成的，还是它本来就红"。
 *
 * 原先这件事靠 `/tmp/check-segments.mjs` + `/tmp/attrib-two-trees.sh` 两份临时脚本，有三个实测过的坑：
 * 1. `/tmp` 会被别的会话写同名文件（main 上 `65567666` 那笔就记了这条事故），读到的可能是别人的东西；
 * 2. 配对树会**悄悄过期** —— 本次写这个工具时现量：`/tmp/heyta-main-check` 的 HEAD 是 `dcbb94ab`，
 *    而 main 已经是 `09767ab1`。拿它当"main 也红"的对照，就是在拿一笔旧运行给新结论背书；
 * 3. 空选择器（`--only` 打错字）会挑出 0 段并"全绿"。
 *
 * ⇒ 这三条都变成判据：树必须干净、必须等于指定的 ref、挑选结果必须非空，否则**退环境码 3 / 用法码 2**，
 *   而不是把"探针没接上"打印成"两边都对上"。
 *
 * ## 用法
 *
 * ```sh
 * node research/tools/selfhost-check-segments.mjs \
 *   --tree /tmp/heyta-merge-carrier --as carrier --ref feat/self-host-merge-main \
 *   --tree /tmp/heyta-main-check    --as main    --ref main \
 *   [--only check:design] [--only docs] [--skip ai-e2e] [--max-load 12] [--out <tsv>]
 * ```
 *
 * 退出码：`0` = 差集为空（没有"只在这棵红"的段）· `1` = 差集非空，或有段两边都红且无人判定
 * · `2` = 用法/探针问题（选择器空、ref 不匹配、树脏、树跑不了 pnpm）
 * · `3` = 环境无效（负载超阈值）—— **环境无效不等于产品失败**，别拿它改判据。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { loadavg, cpus } from 'node:os';

const argv = process.argv.slice(2);
const only = [];
const skip = [];
const trees = [];
let maxLoad = 12;
let out = null;

for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  if (a === '--only') only.push(String(argv[++i] ?? ''));
  else if (a === '--skip') skip.push(String(argv[++i] ?? ''));
  else if (a === '--tree') trees.push({ path: resolve(String(argv[++i] ?? '')), as: null, ref: null });
  else if (a === '--as') {
    if (!trees.length) { console.error('--as 必须跟在一个 --tree 之后'); process.exit(2); }
    trees.at(-1).as = String(argv[++i] ?? '');
  } else if (a === '--ref') {
    if (!trees.length) { console.error('--ref 必须跟在一个 --tree 之后'); process.exit(2); }
    trees.at(-1).ref = String(argv[++i] ?? '');
  } else if (a === '--max-load') maxLoad = Number(argv[++i]);
  else if (a === '--out') out = String(argv[++i] ?? '');
  else { console.error(`不认识开关：${a}`); process.exit(2); }
}

if (trees.length < 1) { console.error('至少要一个 --tree'); process.exit(2); }
for (const t of trees) {
  if (!t.as) t.as = t.path.split('/').pop();
  if (!existsSync(join(t.path, 'package.json'))) { console.error(`${t.as}: ${t.path} 不是检出根（读不到 package.json）`); process.exit(2); }
}

const git = (t, argsList) => {
  const r = spawnSync('git', ['-C', t.path, ...argsList], { encoding: 'utf8' });
  if (r.status !== 0) { console.error(`${t.as}: git ${argsList.join(' ')} 失败：${(r.stderr || '').trim()}`); process.exit(2); }
  return (r.stdout || '').trim();
};

// ── 探针自检：脏树 / 落后 ref / 没装依赖，任何一种都会把"跑不了"读成"跑过了" ──
const readiness = [];
for (const t of trees) {
  const head = git(t, ['rev-parse', 'HEAD']);
  const dirty = git(t, ['status', '--porcelain']).split('\n').filter(Boolean).length;
  const hasNodeModules = existsSync(join(t.path, 'node_modules'));
  let expect = null;
  if (t.ref) {
    expect = git(t, ['rev-parse', t.ref]);
    if (expect !== head) {
      console.error(
        `🔴 ${t.as}: 这棵树是 ${head.slice(0, 8)}，而 ref \`${t.ref}\` 是 ${expect.slice(0, 8)} —— ` +
          '拿落后的树做配对，就是在拿一笔旧运行给新结论背书（"两边都对上"里最贵的一种假绿）。' +
          '\n      先把那棵树 reset 到当前 ref 再来，或者去掉 --ref 并接受它只是一棵别的树。',
      );
      process.exit(2);
    }
  }
  if (dirty > 0) {
    console.error(`🔴 ${t.as}: 工作树有 ${dirty} 条未提交 —— 配对读数量的就不再是提交物了。`);
    process.exit(2);
  }
  if (!hasNodeModules) {
    console.error(`🔴 ${t.as}: 没有 node_modules —— 这里的红会是 MODULE_NOT_FOUND，不是判据红（探针没接上）。`);
    process.exit(2);
  }
  readiness.push(`${t.as}=${head.slice(0, 8)} 脏=0 node_modules=在${t.ref ? ` ref=${t.ref}✓` : ''}`);
}

// 链的**分段单位**必须与 `check-gate-wiring` 逐字相同（&& 切分 + trim + 去空），
// 否则两张表对不上行，而"对不上"会被读成"这棵树少了这一段"。
const segOf = (t) => {
  const raw = JSON.parse(readFileSync(join(t.path, 'package.json'), 'utf8')).scripts?.check;
  if (typeof raw !== 'string' || raw.length === 0) { console.error(`${t.as}: package.json 没有 scripts.check`); process.exit(2); }
  return raw.split('&&').map((s) => s.trim()).filter((s) => s.length > 0);
};

// 段集合取**并集**，但每棵树只跑**自己那份链里**有的段：
// 载体新增的一段在 main 上不存在，那不是"main 红"，是"main 没有这一段" —— 分开登记，
// 否则下一读的人会把"缺失"当成"失败"，或者反过来把"失败"当成"缺失"。
const byTree = trees.map((t) => ({ t, segs: segOf(t) }));
const universe = [...new Set(byTree.flatMap((b) => b.segs))];
const picked = universe.filter(
  (cmd) => (only.length === 0 || only.some((o) => cmd.includes(o))) && !skip.some((s) => cmd.includes(s)),
);
console.log(`链并集 ${universe.length} 段（${byTree.map((b) => `${b.t.as}=${b.segs.length}`).join(' / ')}）· 本次判定 ${picked.length} 段`);
if (picked.length === 0) { console.error('🔴 挑出 0 段 —— 选择器写错了，拒跑（空集会让"全绿"变成假读数）。'); process.exit(2); }

// ── 负载门：超阈值退**环境码**，不改判据、不降低阈值 ──
// 🔴 顺序是刻意的：选择器的"空集拒跑"排在负载门**之前**。
// 2026-10-04 写这一版时第一跑实测：负载 13.77 那一趟里"空选择器退 2"这条臂**根本走不到**
// —— 探针自己的用法错被环境读数盖住，我就差点把"这条臂没红"读成"选择器检查是多余的"。
// 用法错（码 2）比环境（码 3）便宜且确定，先判它，才留得下"这台机器现在不能跑"这个读数本身。
const L = loadavg()[0];
const N = cpus().length;
console.log(`负载 1min=${L.toFixed(2)}（阈值 ${maxLoad}，机器 ${N} 核）· ${readiness.join(' · ')}`);
if (!(L <= maxLoad)) {
  console.error(`🔴 负载 ${L.toFixed(2)} 超阈值 —— 这是**环境无效**，不是产品失败。等窗口，别调阈值。`);
  process.exit(3);
}


const results = new Map(); // as -> Map(cmd -> {rc, secs, tail, present})
// 🔴 端口安全：**有些段会把自己那套 preflight 跑成"把默认端口上的进程 SIGKILL 掉"**
// （`scripts/check-ai-e2e-preflight.mjs` 只 kill 它拿到参数的那几枚端口：ai-e2e 默认 4318/4319，
//  privacy 传 4322，landing 传 4320，从不碰 3000）。逐段扫链时如果别人正听着这些端口，
// 跑下去就是**杀掉别人的 dev server** —— 那是硬约束，不是效率问题。
// ⇒ 这一档**不参与差集**，而是响亮地登记成 SKIP_SAFETY：静默跳过等于把"没跑"读成"跑了且绿"。
const SEG_PORTS = [
  [/check:ai-e2e/, ['4318', '4319']],
  [/privacy-consent/, ['4322']],
  [/test:landing|check:landing-e2e/, ['4320']],
];
const portsOf = (cmd) => {
  for (const [re, ps] of SEG_PORTS) if (re.test(cmd)) return ps;
  return [];
};
const listenersOn = (ports) => {
  if (ports.length === 0) return [];
  const args = ['-nP'];
  for (const p of ports) args.push('-iTCP:' + p);
  // 🔴 `-sTCP:LISTEN` **只能出现一次**。2026-10-04 实测：每个端口各带一个 ⇒
  // `lsof: duplicate TCP inclusion: LISTEN`、stdout 空、**rc=1** ——
  // 而"端口空闲"同样 rc=1 且 stdout 空，两者在退出码上完全同形。
  // 那一版的守卫会把"别人正听着 4318"读成"没人占"，然后放行 `pnpm check:ai-e2e`，
  // 它的 preflight 就把别人的 dev server SIGKILL 掉。这是"假 0 会咬人"的实弹版本。
  args.push('-sTCP:LISTEN');
  const r = spawnSync('lsof', args, { encoding: 'utf8' });
  const err = (r.stderr || '').trim();
  // ⚠️ **rc 不是判据**（实测：有监听时也退 1）。探针坏的信号是 stderr 有字。
  if (err.length > 0) {
    console.error(`🔴 lsof 探针坏了（stderr: ${err.split('\n')[0].slice(0, 120)}）—— 拒跑。\n` +
      '      不拿"读不到"当"没人占"：那一档的后果是杀掉别人的 dev server。');
    process.exit(2);
  }
  return (r.stdout || '').split('\n').slice(1).map((l) => l.split(/\s+/).filter(Boolean).join('/')).filter(Boolean);
};
// ── 阳性对照：同一趟里必须抓到一次"必然存在的监听" ─────────────────────
// 拿系统里**已经在监听**的一枚端口喂给同一个解析器。抓不到 ⇒ 解析层坏 ⇒ 退 2，
// 因为下面所有"端口空闲"的读数都建立在这个解析器上（AGENTS §7 元规则 2）。
// 系统当前零监听时这条对照不适用（那种机器上本来也没有端口会被 SIGKILL），打印出来而不是假装验过。
function portProbeSelfCheck() {
  if (!picked.some((c) => portsOf(c).length > 0)) {
    console.log('   端口探针阳性对照：本次没有会腾端口的段 ⇒ 不做（不假装验过）');
    return;
  }
  const all = spawnSync('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN'], { encoding: 'utf8' });
  const allErr = (all.stderr || '').trim();
  if (allErr.length > 0) {
    console.error(`🔴 阳性对照这一步的 lsof 就坏了（${allErr.split('\n')[0].slice(0, 100)}）—— 拒跑。`);
    process.exit(2);
  }
  const rows = (all.stdout || '').split('\n').slice(1).filter((l) => l.trim().length > 0);
  const portHit = rows.map((l) => l.match(/:(\d+)\s*\(LISTEN\)/u)).filter(Boolean)[0];
  if (!portHit) {
    console.log('   端口探针阳性对照：系统当前 0 枚监听 ⇒ 不适用（守卫也不会跳过任何段）');
    return;
  }
  const known = portHit[1];
  const found = listenersOn([known]);
  if (found.length === 0) {
    console.error(`🔴 端口探针的阳性对照没抓到（系统正在监听 :${known} 却读不到）⇒ 解析层坏，拒跑。`);
    process.exit(2);
  }
  console.log(`   端口探针阳性对照：已监听端口 :${known} 抓到 ${found.length} 行（同一条命令形状）`);
}
portProbeSelfCheck();
const skipped = new Map();
for (const cmd of picked) {
  const ps = portsOf(cmd);
  if (ps.length === 0) continue;
  const busy = listenersOn(ps);
  if (busy.length > 0) skipped.set(cmd, `${ps.join('/')} ← ${busy.slice(0, 3).join(', ')}`);
}
for (const [cmd, why] of skipped) console.log(`   SKIP_SAFETY ${cmd}：端口被占（${why}）—— 这一段不跑，也不进差集`);

for (const b of byTree) {
  const m = new Map();
  for (const cmd of picked) {
    const present = b.segs.includes(cmd);
    if (!present) { m.set(cmd, { present: false }); continue; }
    if (skipped.has(cmd)) { m.set(cmd, { present: true, skipped: true, rc: null, secs: 0, tail: skipped.get(cmd) }); continue; }
    const started = Date.now();
    const r = spawnSync(cmd, {
      cwd: b.t.path,
      shell: true,
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1', CI: 'true' },
      maxBuffer: 64 * 1024 * 1024,
    });
    const secs = Math.round((Date.now() - started) / 1000);
    const tail = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split('\n').filter(Boolean).slice(-3).join(' ⏎ ');
    const rc = r.status ?? -1;
    m.set(cmd, { present: true, rc, secs, tail: tail.slice(0, 300) });
    console.log(`  [${b.t.as}] ${rc === 0 ? '✅' : '❌'} rc=${rc} ${secs}s ${cmd}`);
    if (rc !== 0) console.log(`        ↳ ${m.get(cmd).tail}`);
  }
  results.set(b.t.as, m);
}

const redOf = (as) =>
  picked.filter((cmd) => {
    const r = results.get(as).get(cmd);
    return r && r.present && !r.skipped && r.rc !== 0;
  });
const missingOf = (as) => picked.filter((cmd) => !results.get(as).get(cmd).present);

const [first, second] = trees.map((t) => t.as);
const lines = [];
for (const as of trees.map((t) => t.as)) {
  const sk = picked.filter((c) => results.get(as).get(c).skipped).length;
  console.log(`\n[${as}] 红 ${redOf(as).length} 段 · 链里没有的段 ${missingOf(as).length} 段 · 端口安全跳过 ${sk} 段（不参与差集）`);
  for (const cmd of redOf(as)) console.log(`   RED ${as}  ${cmd}`);
}

let verdict;
if (trees.length >= 2) {
  const a = redOf(first);
  const b = redOf(second);
  const onlyA = a.filter((c) => !b.includes(c));
  const onlyB = b.filter((c) => !a.includes(c));
  const both = a.filter((c) => b.includes(c));
  console.log(`\n三个集合（A=${first} · B=${second}）：`);
  console.log(`  只在 ${first} 红 (${onlyA.length})：${onlyA.join(' | ') || '∅'}`);
  console.log(`  只在 ${second} 红 (${onlyB.length})：${onlyB.join(' | ') || '∅'}`);
  console.log(`  两边都红 (${both.length})：${both.join(' | ') || '∅'}`);
  lines.push(`只在${first}红=${onlyA.length} 只在${second}红=${onlyB.length} 两边都红=${both.length}`);
  verdict = onlyA.length > 0;
  if (verdict) {
    console.error(`\n🔴 "只在 ${first} 红"非空 —— 每一段都要能落到本批写集里并且说得通，否则不许落地。`);
  }
} else {
  verdict = redOf(first).length > 0;
}

const outPath = out ?? `/tmp/selfhost-check-segments-${Date.now()}.tsv`;
const rows = [];
for (const as of trees.map((t) => t.as)) {
  for (const cmd of picked) {
    const r = results.get(as).get(cmd);
    rows.push(`${as}\t${!r.present ? 'ABSENT' : r.skipped ? 'SKIPPED' : String(r.rc)}\t${r.present && !r.skipped ? r.secs : ''}\t${cmd}\t${(r.present ? r.tail : '').replace(/\t/gu, ' ')}`);
  }
}
writeFileSync(outPath, rows.join('\n') + '\n', 'utf8');
console.log(`\n明细 TSV：${outPath}（${rows.length} 行 = ${picked.length} 段 × ${trees.length} 棵）`);
console.log(lines.join('\n'));
process.exit(verdict ? 1 : 0);
