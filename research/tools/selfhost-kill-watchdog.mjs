#!/usr/bin/env node
/**
 * 跑链期间的"别杀别人的服务端"看守。
 *
 * 为什么需要它：`selfhost-land-main.mjs` 第 3b 道闸门在**起跑之前**采样一次那几枚端口，
 * 而链要跑几十分钟。这期间任何一次外来监听者出现，都会被链里的 e2e 前置 **SIGKILL** ——
 * 起跑时那一眼管不到它。现量证据（`/tmp/g173-window3.log` 2026-10-04 21:0x–21:1x）：
 * `4318/4319` 在 21:04 有人（pid 66242/66259）、21:07 空、21:13 又有人（15387/15400），
 * 也就是**一趟链的时长里至少会出现两波**。那道闸门因此只挡住了"开局就撞车"，
 * 没挡住"跑到第 29 分钟时把别人刚起的 dev server 打死"。
 *
 * 分工（判据本体不抄第二份）：端口集合来自 `selfhost-kill-ports.mjs`（唯一所有者），
 * "谁的进程"靠**该 pid 的工作目录**判（`lsof -d cwd`），与 `selfhost-carrier-busy.mjs` 同一思路。
 *
 * 🔴 保守方向是**误中止**，不是误放行：读不到 cwd、lsof 坏、射程判不了 —— 一律算触发。
 *    这条装置存在的唯一理由就是"别伤到别人的现场"，把它自己的坏读数当成安全，
 *    等于把整条链的守护换成 §8.122 那一族"stdout 空 = 没人用"的假 0。
 *    代价说清楚：会有一次几十分钟的链被白中止（记 exit 3 = 环境无效，不是产品红）。
 */
import { spawn, spawnSync } from 'node:child_process';
import { listenersOn } from './selfhost-kill-ports.mjs';

/** 某个 pid 的工作目录（macOS 的 lsof 会解 `/tmp` ⇒ `/private/tmp`，交调用方比之前先归一）。
 * 🔴 `-a` 是承重的：lsof 把 `-p` 与 `-d` **默认按 OR 组合**，不带 `-a` 时它回的是
 *    "所有进程的 cwd ∪ 这些进程的任意 fd"，于是第一个 `n` 是系统守护进程的 cwd=`/`，
 *    而不是我问的那个 pid（13:1x 真腿实测：自己起的进程读出 `/`）。
 *    那种读法不只是读错 —— 它会把**链自己的** vite 判成外来，于是每次跑都自我中止。 */
export function cwdOf(pid) {
  let r;
  try {
    r = spawnSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-F', 'n'], { encoding: 'utf8' });
  } catch (e) {
    return { error: `lsof 调用失败：${e?.message ?? e}` };
  }
  if (r.error?.code === 'ENOENT') return { error: '这台机器没有 lsof' };
  // -F n 输出里：先一行 `p<pid>`，随后几行 `n<名字>`；第一枚 n 是进程名，第二枚才是 cwd。
  const names = String(r.stdout ?? '')
    .split('\n')
    .filter((l) => l.startsWith('n'))
    .map((l) => l.slice(1))
    .filter(Boolean);
  const dir = names.find((x) => x.startsWith('/'));
  if (!dir) return { error: `lsof 没回 cwd（rc=${r.status}，${(r.stderr ?? '').trim().slice(0, 50) || 'stderr 空'}）` };
  return { path: dir };
}

/**
 * 归属探针的**阳性对照**：问自己这个 pid 的 cwd，必须读回 `process.cwd()`。
 * 上面那条 `-a` 就是被它抓住的 —— 任何"归属"类探针都要配一条问已知答案的腿，
 * 否则它坏了的时候读起来照样像"没人监听"。
 */
export function cwdSelfcheck(pid = process.pid) {
  const got = cwdOf(pid);
  if (got.error) return { ok: false, reading: `pid=${pid} ⇒ ${got.error}` };
  const want = normTmp(process.cwd());
  const have = normTmp(got.path);
  if (have !== want) {
    return { ok: false, reading: `pid=${pid} 读回 ${have}，而本进程真实 cwd 是 ${want} ⇒ 归属探针坏（别再往下判）` };
  }
  return { ok: true, reading: `pid=${pid} ⇒ ${have}（与本进程 cwd 逐字相同）` };
}

export const normTmp = (p) => (p.startsWith('/private/') ? p.slice('/private'.length) : p);

/**
 * 一次判定：这些端口现在的监听者里，有没有**不是这条链自己的**。
 * @param {{ports: string[], carrierDir: string, probe?: Function, cwdFor?: Function}} cfg
 * @returns {{error?: string, ours: object[], foreign: object[], blind: object[], ticks: number}}
 */
export function foreignListeners({
  ports,
  carrierDir,
  probe = listenersOn,
  cwdFor = cwdOf,
}) {
  const out = { ours: [], foreign: [], blind: [] };
  if (!Array.isArray(ports) || ports.length === 0) {
    return { error: '射程端口是空的 ⇒ 看守无事可读。这不是"没人监听"，是判不了' };
  }
  if (!carrierDir) return { error: '没给载体目录 ⇒ 分不出"我们的"和"别人的"' };
  const seen = probe(ports);
  if (seen.noLsof) return { error: `这台机上没有 lsof（${seen.noLsof}）⇒ 判不了，按触发处理而不是按"空着"` };
  if (seen.brokenProbe) return { error: `lsof 探针报坏（${seen.brokenProbe}）⇒ "stdout 空"不是"没人监听"` };
  const rows = seen.rows ?? [];
  const carrier = normTmp(carrierDir);
  for (const row of rows) {
    const c = cwdFor(row.pid);
    if (c.error) {
      out.blind.push({ ...row, why: c.error });
      continue;
    }
    const p = normTmp(c.path);
    if (p === carrier || p.startsWith(carrier + '/')) out.ours.push({ ...row, cwd: p });
    else out.foreign.push({ ...row, cwd: p });
  }
  return out;
}

/** 人类可读的一行触发原因（也是读数本体：中止哪一趟、为什么，要能在日志里复原）。 */
export function tripReason(r, carrierDir) {
  if (r.error) return `射程判不了：${r.error}`;
  const bits = [];
  if (r.foreign.length) {
    bits.push(`外来监听者 ${r.foreign.length} 枚：${r.foreign.map((x) => `:${x.port} pid=${x.pid} cwd=${x.cwd}`).join(' · ')}`);
  }
  if (r.blind.length) {
    bits.push(`读不到归属 ${r.blind.length} 枚：${r.blind.map((x) => `:${x.port} pid=${x.pid}（${x.why}）`).join(' · ')}`);
  }
  if (!bits.length) return null;
  return `${bits.join('；')} ⇒ 链里的 e2e 前置会把这些 SIGKILL 掉（载体=${carrierDir} 之内才算自己的）`;
}

/**
 * 起看守。`onTrip(reason)` 只会被调**至多一次**，调用前定时器已撤。
 * @returns {{stop: Function, reads: number}} 句柄；`reads` 是真跑过几轮（给日志用的分母）
 */
export function startWatch({ ports, carrierDir, intervalMs = 5000, onTrip, probe, cwdFor, selfcheck = cwdSelfcheck }) {
  let stopped = false;
  let fired = false;
  const handle = { reads: 0, stop: () => { stopped = true; clearInterval(handle.timer); } };
  const fire = (why, r) => {
    if (fired || stopped) return;
    fired = true;
    clearInterval(handle.timer);
    onTrip(why, r);
  };
  /* 🔴 先验探针本身：归属读不出来的看守比没有看守更坏（它会把自己的链判成外来，
   *    于是每次跑都在第 5 秒自我中止 —— 13:1x 那条 `-a` 缺失的 bug 就是这个形状）。 */
  const sc = selfcheck();
  if (!sc.ok) {
    handle.reads = 1;
    fire(`归属探针自检没过：${sc.reading} ⇒ 看守无法分辨"我们的"与"别人的"，不开跑`);
    return handle;
  }
  handle.probeReading = sc.reading;
  const tick = () => {
    if (stopped || fired) return;
    handle.reads += 1;
    const r = foreignListeners({ ports, carrierDir, probe, cwdFor });
    const why = tripReason(r, carrierDir);
    if (why) fire(why, r);
  };
  handle.timer = setInterval(tick, intervalMs);
  // 立刻先判一次：起跑前那一眼之后到第一次定时之间也有窗口。
  tick();
  return handle;
}

/**
 * 🔴 **这就是 `selfhost-land-main.mjs` 第 4 道跑链的那段代码本体**（spawn 子进程 + 边跑边守 +
 *    中止时 SIGTERM→5s 后 SIGKILL + 退出码归一 + 回"判了几轮/用了多久/子进程输出"）。
 *    抽到这里来的唯一理由是：那段逻辑留在调用方手里时，**只有真窗口能取到它的读数**
 *    （§8.127 末段那条"写成待取"就是这么来的），而一次中止读数本来不需要几十分钟的链。
 *    调用方（真链与 `--watch-leg` 合成腿）共用这一个函数 ⇒ 合成腿取到的就是生产路径的读数，
 *    不是"另写了一份像它的代码"。
 * @returns {Promise<{code:number, sig:string|null, trip:string|null, reads:number, probeReading:string|undefined, elapsedMs:number, output:string}>}
 */
export async function runChildUnderWatch({
  command,
  args = [],
  cwd,
  env = process.env,
  ports,
  carrierDir,
  intervalMs = 5000,
  hardKillMs = 5000,
}) {
  const t0 = Date.now();
  const chunks = [];
  const child = spawn(command, args, { cwd, env });
  child.stdout.on('data', (c) => chunks.push(c));
  child.stderr.on('data', (c) => chunks.push(c));
  let trip = null;
  const watch = startWatch({
    ports,
    carrierDir,
    intervalMs,
    onTrip: (why) => {
      trip = why;
      child.kill('SIGTERM');
      const hard = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* 已退 */ } }, hardKillMs);
      hard.unref();
    },
  });
  const code = await new Promise((res) => {
    child.on('exit', (c, sig) => res(typeof c === 'number' ? c : (sig ? 143 : 1)));
    child.on('error', (e) => { chunks.push(Buffer.from(`\nspawn 失败：${e.message}`)); res(127); });
  });
  watch.stop();
  return {
    code,
    sig: child.signalCode ?? null,
    trip,
    reads: watch.reads,
    probeReading: watch.probeReading,
    elapsedMs: Date.now() - t0,
    output: Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8'),
  };
}

/* ── 自检（夹具驱动，不碰真端口；`--selftest` 退出码非 0 就是装置坏了）── */
export function watchSelftest({ carrierDir = '/tmp/heyta-merge-carrier' } = {}) {
  const errs = [];
  const notes = [];
  const mk = (rows) => () => ({ rows });
  const cwdMap = {
    100: { path: `${carrierDir}/apps/web` },        // 我们链自己起的 vite
    200: { path: '/Users/rocalight/Desktop/x/heyta' }, // 别人的检出
    300: { error: 'lsof 没回 cwd（进程可能已退）' },     // 判不了
  };
  const ports = ['4318', '4319'];
  const cwdFor = (pid) => cwdMap[pid] ?? { error: `夹具没有 pid ${pid}` };

  // 对照：没监听者 ⇒ 不触发
  const c = foreignListeners({ ports, carrierDir, probe: mk([]), cwdFor });
  if (c.error || c.foreign.length || c.blind.length) errs.push(`对照臂不该触发：${JSON.stringify(c)}`);
  notes.push(`对照（空集）⇒ 触发原因=${tripReason(c, carrierDir) ?? 'null（放行）'}`);

  // 臂 1：自己的（cwd 在载体里）⇒ 放行
  const a1 = foreignListeners({ ports, carrierDir, probe: mk([{ port: '4318', pid: '100' }]), cwdFor });
  if (a1.foreign.length || a1.blind.length) errs.push(`臂1 把自己的进程当成了外来 ⇒ ${JSON.stringify(a1)}`);
  if (a1.ours.length !== 1) errs.push(`臂1 应当认出 1 枚自己的，读到 ${a1.ours.length}`);
  notes.push(`臂1 自己（cwd=${a1.ours[0]?.cwd}）⇒ ours=${a1.ours.length} foreign=${a1.foreign.length}`);

  // 臂 2：别人的 ⇒ 触发，且原因里要点名端口与 cwd
  const a2 = foreignListeners({ ports, carrierDir, probe: mk([{ port: '4319', pid: '200' }]), cwdFor });
  const w2 = tripReason(a2, carrierDir);
  if (a2.foreign.length !== 1) errs.push(`臂2 没认出外来监听者 ⇒ ${JSON.stringify(a2)}`);
  if (!w2 || !w2.includes(':4319') || !w2.includes('/heyta')) errs.push(`臂2 触发原因没点名端口/cwd：${w2}`);
  notes.push(`臂2 外来 ⇒ 触发="${w2}"`);

  // 臂 3：读不到归属 ⇒ 保守触发（不能把"判不了"当安全）
  const a3 = foreignListeners({ ports, carrierDir, probe: mk([{ port: '4318', pid: '300' }]), cwdFor });
  const w3 = tripReason(a3, carrierDir);
  if (!w3 || !w3.includes('读不到归属')) errs.push(`臂3 没把"判不了"算触发：${w3 ?? 'null'}`);
  notes.push(`臂3 判不了 ⇒ 触发="${w3?.slice(0, 60)}…"`);

  // 臂 4：探针坏 ⇒ 触发
  for (const bad of [{ noLsof: true }, { brokenProbe: 'lsof died' }]) {
    const a4 = foreignListeners({ ports, carrierDir, probe: () => bad, cwdFor });
    const w4 = tripReason(a4, carrierDir);
    if (!a4.error || !w4) errs.push(`臂4(${JSON.stringify(bad)}) 没报错：${JSON.stringify(a4)}`);
  }
  notes.push('臂4 no-lsof / broken-probe 两形 ⇒ 都按触发');

  // 臂 5：射程为空 ⇒ 是"判不了"，不是"看守已通过"
  const a5 = foreignListeners({ ports: [], carrierDir, probe: mk([]), cwdFor });
  if (!a5.error) errs.push('臂5 空射程被当成可看守 ⇒ 空集合必须报错');
  notes.push(`臂5 空射程 ⇒ error="${a5.error ?? '没有（坏）'}"`);

  // 臂 6：startWatch 真的会调 onTrip、且只调一次、stop() 之后不再读
  const okSelf = () => ({ ok: true, reading: '夹具放行' });
  let calls = 0;
  let reason = '';
  const h = startWatch({
    ports,
    carrierDir,
    intervalMs: 5,
    selfcheck: okSelf,
    onTrip: (why) => { calls += 1; reason = why; },
    probe: mk([{ port: '4319', pid: '200' }]),
    cwdFor,
  });
  const readsAfterTrip = h.reads;
  h.stop();
  if (calls !== 1) errs.push(`臂6 onTrip 被调了 ${calls} 次（应当恰好 1 次）`);
  if (!reason.includes(':4319')) errs.push(`臂6 没把原因交出去：${reason}`);
  if (readsAfterTrip !== 1) errs.push(`臂6 触发那一轮之后还留着定时器（reads=${readsAfterTrip}）⇒ 撤守不干净`);
  notes.push(`臂6 startWatch ⇒ onTrip=${calls} 次 · reads=${readsAfterTrip}`);

  // 臂 7：放行路径下 startWatch 不许回调，且 stop() 之后 reads 停止增长
  let calls7 = 0;
  const h7 = startWatch({ ports, carrierDir, intervalMs: 5, selfcheck: okSelf, onTrip: () => { calls7 += 1; }, probe: mk([]), cwdFor });
  h7.stop();
  if (calls7 !== 0) errs.push(`臂7 空集下居然触发了 ${calls7} 次`);

  // 臂 8：🔴 归属探针的**阳性对照**（真腿，不是夹具）。问自己的 pid 要 cwd，必须读回 process.cwd()。
  //        缺 `-a` 的那版 lsof 会把系统守护进程的 cwd=`/` 当成答案 —— 夹具臂 1..7 全都照样绿，
  //        只有这一条会红（13:1x 实测它红过一次）。
  const sc = cwdSelfcheck();
  if (!sc.ok) errs.push(`臂8 归属探针坏：${sc.reading}`);
  notes.push(`臂8 阳性对照 ⇒ ${sc.reading}`);

  // 臂 9：探针坏 ⇒ 看守**不开**，直接以"判不了"触发（保守方向：宁可不跑，不可误杀）
  let calls9 = 0;
  let why9 = '';
  const h9 = startWatch({
    ports,
    carrierDir,
    intervalMs: 5,
    selfcheck: () => ({ ok: false, reading: '模拟：归属探针坏' }),
    onTrip: (w) => { calls9 += 1; why9 = w; },
    probe: mk([]),
    cwdFor,
  });
  const reads9 = h9.reads;
  h9.stop();
  if (calls9 !== 1) errs.push(`臂9 探针坏却没中止（onTrip=${calls9}）`);
  if (!why9.includes('探针')) errs.push(`臂9 中止原因没写明是探针坏：${why9}`);
  if (h9.timer) errs.push('臂9 探针坏之后还留着定时器 ⇒ 还会继续判');
  notes.push(`臂9 探针坏 ⇒ onTrip=${calls9} 次 · reads=${reads9} · 原因="${why9.slice(0, 40)}…"`);

  return { errs, notes };
}

/* 只有**被直接执行**时才自检（被 import 时不产生副作用）。
 * 判据用 realpath 后的全等比，不比 basename —— basename 会在同名副本上误触发。 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const invokedDirectly =
  process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
if (invokedDirectly) {
  if (process.argv.includes('--selftest')) {
    const { errs, notes } = watchSelftest();
    notes.forEach((n) => process.stdout.write(`  ${n}\n`));
    if (errs.length) {
      process.stdout.write(`🔴 看守装置 ${errs.length} 条问题：\n - ${errs.join('\n - ')}\n`);
      process.exit(2);
    }
    process.stdout.write('✅ 看守装置自检（对照 1 + 臂 1..9，含臂 8 这条真腿阳性对照）\n');
    process.exit(0);
  }
  process.stdout.write('用法：node research/tools/selfhost-kill-watchdog.mjs --selftest（本文件正常由 selfhost-land-main.mjs 消费）\n');
}
