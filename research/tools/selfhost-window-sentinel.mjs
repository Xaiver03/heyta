#!/usr/bin/env node
/* 落地前置哨兵 v5（从 `selfhost-window-sentinel.sh` v4 移植；v4 已删，理由与读数在审计台账 §8.143/§8.144）。
 *
 * 它只做一件事：**判"窗口开没开"**，并把开窗之后的那一条命令**真的执行**（默认不执行）。
 * 裁判仍然不是它 —— `selfhost-land-main.mjs --confirm` 自己那七道闸门才是。
 *
 * v4 是 sh 的原因只有一个："反正只是等"。这一轮换成 node 的三条实测理由：
 *   ① v4 数阻塞集用的是 `grep -o '阻塞集 [0-9]* 枚' | tr -cd '0-9'` —— 中文汇总行是**第二本账**，
 *      而工具自己同时打的是 ASCII 的 `BLOCK ` 行（§8.133 起就写了"要数 BLOCK 行，别解析中文汇总"）；
 *      更要紧的是：**0 既可能是"没有阻塞"也可能是"探针没接上"** ⇒ v5 用两条独立读数互相咬合
 *      （`BLOCK ` 行数必须等于汇总行里那个数），咬不上就 PROBE_BAD，绝不按"安静"处理。
 *   ② v4 的负载解析靠 `tr -d '{}' | awk '{print $1}'`，这一族在本仓错过两次（§7 第 168 条、§8.40）；
 *      v5 把它写成一条**纯函数 + 合成样本自检**（三位互不相同的样本必须读到第一位），错了响亮失败。
 *   ③ v4 里那段 `node -e '…'` 把判据字符串塞进 shell 单引号 —— 引号一漂就是静默空读数。
 *      v5 直接在进程内 import `selfhost-kill-ports.mjs`。
 *
 * 六件事**同时且持续**成立才算开窗（缺一就继续等，不调阈值、不硬跑）：
 *   1) 阻塞集归零（别人未提交的工作树压在我也改过的文件上）
 *   2) 1 分钟负载 ≤ LOAD_MAX（默认 12）
 *   3) 链里那几枚会被 SIGKILL 的端口现在没人监听
 *   4) 载体那棵树此刻不是别人的现场
 *   5) main 这一样和上一样同一个值
 *   6) 上面五件同时成立要连续保持 QUIET_MIN 分钟
 *      ⚠️ 仍然只是**代理指标**：过去 15 分钟没动 ≠ 链那几十分钟里不动。它挡得住"每 85 秒一笔"，
 *      挡不住"链跑到第 29 分钟来一笔" —— 后者由 `--confirm` 的闸门判，判到了就是退 1，
 *      那一趟的全链读数仍留在日志里（不是白跑，它顺手就是逐段归属要的那份读数）。
 *
 * 用法：
 *   node research/tools/selfhost-window-sentinel.mjs                     # 只等只报（打印那条命令）
 *   node research/tools/selfhost-window-sentinel.mjs --run-on-open       # 开窗即真的跑 --confirm（授权范围内：ff-only，不 push）
 *   FORCE_OPEN=1 node … --run-on-open --run-cmd 'echo 演练：这里没有真的落地'   # 演练开窗那一支
 *   node research/tools/selfhost-window-sentinel.mjs --selftest          # 12 条臂：每一臂都写明它凭什么会红
 *   node research/tools/selfhost-window-sentinel.mjs --alive             # 只读心跳：哨兵还活着吗（不用 kill -0）
 * 旋钮（默认值都能跑）：LOG PIDF CAP STEP QUIET_MIN LOAD_MAX HEYTA_CARRIER_WT FORCE_OPEN
 *
 * 🔴 心跳不是装饰：v4 那一趟 23:19 起跑、23:21 之后静死（日志里没有退出行，是父 shell 被收走的）。
 *    "有个东西在等窗口"这件事必须能**被读出来**，否则下一轮会把"没人跑"读成"还没到窗口"。
 *    ⇒ 每一样落一行心跳到 PIDF（`pid=… epoch=…`），`--alive` 用 `ps -o pid= -p` 比回显再算年龄。
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveKillPorts, listenersOn } from './selfhost-kill-ports.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LOG = process.env.LOG || '/tmp/selfhost-window-sentinel.log';
const PIDF = process.env.PIDF || '/tmp/selfhost-window-sentinel.pid';
const CAP = Number(process.env.CAP || 14400);
const STEP = Number(process.env.STEP || 150);
const QUIET_MIN = Number(process.env.QUIET_MIN || 15);
const LOAD_MAX = Number(process.env.LOAD_MAX || 12);
const CARRIER_DIR = process.env.HEYTA_CARRIER_WT || '/tmp/heyta-merge-carrier';
const LANDER = join(ROOT, 'research/tools/selfhost-land-main.mjs');
const BLOCKERS = join(ROOT, 'research/tools/selfhost-landing-blockers.mjs');
const CARRIER_BUSY = join(ROOT, 'research/tools/selfhost-carrier-busy.mjs');

const now = () => new Date().toTimeString().slice(0, 8);
const beat = (line) => { appendFileSync(LOG, `${now()} ${line}\n`); };

/** `sysctl -n vm.loadavg` 的 `{ a b c }` ⇒ 1 分钟位；形状不对返回 null（**不当"负载低"**）。 */
export function parseLoad(sample) {
  const m = String(sample).trim().replace(/^[{[]/, '').replace(/[}\]]$/, '').trim().split(/\s+/);
  if (m.length !== 3) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

/**
 * 数阻塞集。两条独立读数必须咬合：ASCII 的 `BLOCK ` 行数 == 中文汇总里那个数。
 * 咬不上 ⇒ `probeBad` ⇒ 调用侧**不许**按"零阻塞"处理（§8.133 那族"0 是探针没接上"）。
 */
export function parseBlockers(stdout) {
  const blockLines = stdout.split('\n').filter((l) => l.trimStart().startsWith('BLOCK ')).length;
  const m = stdout.match(/阻塞集\s*(\d+)\s*枚/);
  if (!m) return { count: null, probeBad: '汇总行里没有"阻塞集 N 枚"这一项（探针没接上，不是零阻塞）' };
  const claimed = Number(m[1]);
  if (claimed !== blockLines) {
    return { count: claimed, probeBad: `BLOCK 行 ${blockLines} 条与汇总声称的 ${claimed} 枚对不上（两本账漂了）` };
  }
  return { count: claimed, probeBad: null };
}

/**
 * 五件的**同刻**判定（纯函数，`--selftest` 直接喂它）。
 * @returns {{ok:boolean, reasons:string[], mainChanged:boolean, firstSample:boolean}}
 */
export function sampleVerdict(s, prevMain, loadMax = LOAD_MAX) {
  const reasons = [];
  const firstSample = !prevMain;
  if (s.blockerProbeBad) reasons.push(`阻塞集探针判不了：${s.blockerProbeBad}`);
  else if (s.blockers !== 0) reasons.push(`阻塞集=${s.blockers}`);
  if (s.load === null) reasons.push('负载读不出形状');
  else if (s.load > loadMax) reasons.push(`负载=${s.load}>${loadMax}`);
  if (!s.portsFree) reasons.push(s.portsReason);
  if (!s.carrierFree) reasons.push('载体那棵树正被别人用');
  if (!s.main) reasons.push('main 读不到');
  const mainChanged = !firstSample && !!s.main && !!prevMain && s.main !== prevMain;
  if (firstSample) reasons.push('首样：没有"上一样的 main"可比');
  else if (mainChanged) reasons.push(`main 变了（${prevMain}→${s.main}）`);
  return { ok: reasons.length === 0, reasons, mainChanged, firstSample };
}

/** 连续成立需要几样：向上取整，别用整除把 15 分钟截成 14.5。 */
export function needStreak(quietMin, step) {
  return Math.ceil((quietMin * 60) / step);
}

/* ── 探针：全部只读，任何一条读不出形状都按"不成立"处理 ─────────────────── */
function takeSample() {
  let blockers = null;
  let blockerProbeBad = null;
  try {
    const out = execFileSync('node', [BLOCKERS], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
    const b = parseBlockers(out);
    blockers = b.count;
    blockerProbeBad = b.probeBad;
  } catch (err) {
    blockerProbeBad = `blockers 退 ${err.status ?? '?'}：${String(err.stdout ?? err.message).trim().slice(0, 80)}`;
  }

  let load = null;
  try {
    load = parseLoad(execFileSync('sysctl', ['-n', 'vm.loadavg'], { encoding: 'utf8' }));
  } catch { load = null; }

  let portsFree = false;
  let portsReason = '';
  try {
    const d = deriveKillPorts(CARRIER_DIR);
    if (d.error) {
      portsReason = `端口集判不了：${d.error.slice(0, 60)}`;
    } else {
      const st = listenersOn(d.ports);
      if (st.noLsof || st.brokenProbe) {
        portsReason = `端口探针坏了（${st.noLsof ? 'no-lsof' : st.brokenProbe}）`;
      } else {
        portsFree = st.rows.length === 0;
        portsReason = portsFree
          ? `端口空（射程 ${d.ports.join('/')}）`
          : `端口被占：${st.rows.map((r) => `${r.port}/${r.pid}`).join(',')}`;
      }
    }
  } catch (err) {
    portsReason = `端口探针抛错：${String(err.message).slice(0, 60)}`;
  }

  let main = '';
  try {
    main = execFileSync('git', ['rev-parse', '--short', 'main'], { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch { main = ''; }

  const carrierRun = spawnSync('node', [CARRIER_BUSY, '--check'], { cwd: ROOT, encoding: 'utf8' });
  const carrierFree = carrierRun.status === 0;
  const carrierReading = String(carrierRun.stdout || '').split('\n')[0]?.slice(0, 72) || '（载体探针没输出）';

  return { blockers, blockerProbeBad, load, portsFree, portsReason, main, carrierFree, carrierReading };
}

/* ── 自检：每一臂都写明"它凭什么必须红"（不能失败的判据没有价值） ─────────── */
export function sentinelArms() {
  const arms = [];
  const push = (name, expect, got) => arms.push({ name, expect, got });
  const v6 = sampleVerdict({ blockers: 0, blockerProbeBad: null, load: 3.2, portsFree: true, portsReason: '端口空', carrierFree: true, main: 'bbbbbbb' }, 'aaaaaaa');
  const okSample = { blockers: 0, blockerProbeBad: null, load: 3.2, portsFree: true, portsReason: '端口空', carrierFree: true, main: 'aaaaaaa' };

  push('control 五件同刻成立 ⇒ ok', true, sampleVerdict(okSample, 'aaaaaaa').ok);
  push('A1 阻塞集 1 枚 ⇒ 不开窗', false, sampleVerdict({ ...okSample, blockers: 1 }, 'aaaaaaa').ok);
  push('A2 负载 13.5 ⇒ 不开窗', false, sampleVerdict({ ...okSample, load: 13.5 }, 'aaaaaaa').ok);
  push('A3 端口被占 ⇒ 不开窗', false, sampleVerdict({ ...okSample, portsFree: false, portsReason: '端口被占：4318/123' }, 'aaaaaaa').ok);
  push('A4 载体被别人用 ⇒ 不开窗', false, sampleVerdict({ ...okSample, carrierFree: false }, 'aaaaaaa').ok);
  push('A5 首样没有上一样的 main ⇒ 不开窗（也不许算"变了"）', false, sampleVerdict(okSample, '').ok);
  push('A6 main 变了 ⇒ 既不开窗、又要把这次变化计入 mainChanged', '[false,true]',
    JSON.stringify([v6.ok, v6.mainChanged]));
  push('A7 BLOCK 行数与汇总对不上 ⇒ 探针判不了，按不开窗', false,
    sampleVerdict({ ...okSample, blockers: null, blockerProbeBad: 'BLOCK 行 0 条与汇总声称的 1 枚对不上' }, 'aaaaaaa').ok);
  push('A8 汇总行整条缺失 ⇒ 同样判不了', '探针',
    /探针没接上/.test(parseBlockers('什么都没有').probeBad || '') ? '探针' : '');
  push('A9 负载解析取的是 1 分钟位（三位互不相同的合成样本）', 11.11, parseLoad('{ 11.11 22.22 33.33 }'));
  push('A10 换一位就得换读数（证明它没在"取任意一位"）', 22.22, parseLoad('{ 22.22 11.11 33.33 }'));
  push('A11 形状不对 ⇒ null，绝不当"负载低"', true, parseLoad('{  }') === null);
  push('A12 连静样数从 QUIET_MIN/STEP 推导（15/150 ⇒ 6）', 6, needStreak(15, 150));

  // parseBlockers 的正向对照：真输出形状（BLOCK 行缩进两格 + 中文汇总）要数得出 1
  push('A13 BLOCK 行**缩进两格**也数得到（锚定行首会恒得 0）', 1,
    parseBlockers('夹具：写集 64 枚 · **阻塞集 1 枚**\n  BLOCK package.json\n').count);
  return arms;
}

function runSelftest() {
  const arms = sentinelArms();
  let bad = 0;
  for (const a of arms) {
    const hit = a.got === a.expect;
    if (!hit) bad += 1;
    console.log(`${hit ? '  ok' : 'RED '} ${a.name}（期望 ${JSON.stringify(a.expect)}，实得 ${JSON.stringify(a.got)}）`);
  }
  console.log(`哨兵自检：臂数 ${arms.length} · 红 ${bad} · 拒绝臂 ${arms.filter((a) => /^A\d+ /.test(a.name)).length} 条`);
  if (arms.length < 12 || bad > 0) { console.log('❌ 自检没过 ⇒ 不许拿这条哨兵去等窗口'); process.exit(1); }
  console.log('✅ 五件判据各被单独打红过一次，负载解析证明取的是 1 分钟位，BLOCK 行按 trimStart 认。');
  process.exit(0);
}

/** `--alive`：读心跳文件，用 pid 回显判活（`kill -0` 会把活进程读成已死，见 §7 那一族）。 */
function runAlive() {
  let rec;
  try {
    rec = readFileSync(PIDF, 'utf8').trim();
  } catch {
    console.log(`ALIVE=unknown 心跳文件不在（${PIDF}）⇒ 没跑过，或者被清过。别把它读成"窗口没到"。`);
    process.exit(2);
  }
  const pid = Number((rec.match(/pid=(\d+)/) || [])[1]);
  const epoch = Number((rec.match(/epoch=(\d+)/) || [])[1]);
  let echo = '';
  try { echo = execFileSync('ps', ['-o', 'pid=', '-p', String(pid)], { encoding: 'utf8' }).trim(); } catch { echo = ''; }
  const alive = echo === String(pid);
  const age = Math.round((Date.now() / 1000 - epoch) / 60);
  console.log(`ALIVE=${alive ? 'yes' : 'no'} pid=${pid}（ps 回显="${echo}"）心跳=${age} 分钟前 · ${rec}`);
  if (!alive) console.log('🔴 心跳里的 pid 不是哨兵自己 ⇒ 要么已经死了，要么 pid 被别人占了。两种都要重新起跑，别按"还在等"行动。');
  process.exit(alive ? 0 : 1);
}

const argv = process.argv.slice(2);
if (argv.includes('--selftest')) runSelftest();
if (argv.includes('--alive')) runAlive();

let runOnOpen = 0;
let runCmd = '';
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--run-on-open') runOnOpen = 1;
  else if (argv[i] === '--run-cmd') { runCmd = argv[i + 1] || ''; i += 1; }
  else { beat(`未知参数：${argv[i]} ⇒ exit 2`); console.error(`未知参数：${argv[i]}`); process.exit(2); }
}

let mainTree = '';
try {
  const por = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: ROOT, encoding: 'utf8' });
  let pending = '';
  for (const line of por.split('\n')) {
    if (line.startsWith('worktree ')) pending = line.slice('worktree '.length);
    else if (line === 'branch refs/heads/main') { mainTree = pending; break; }
  }
} catch { mainTree = ''; }
if (!mainTree) {
  beat('PROBE_BAD 从 git worktree list 里找不到签出 main 的工作树 ⇒ 开窗也没地方跑 --confirm');
  console.error('PROBE_BAD：找不到签出 main 的工作树（不是"这台机器没有主检出"，是探针没读出来）');
  process.exit(2);
}

const NEED = needStreak(QUIET_MIN, STEP);
writeFileSync(PIDF, `pid=${process.pid} epoch=${Math.round(Date.now() / 1000)} step=${STEP} cap=${CAP} quiet_min=${QUIET_MIN} run_on_open=${runOnOpen}\n`);
beat(`起步(v5) SELF_PID=${process.pid} CAP=${CAP}s STEP=${STEP}s QUIET_MIN=${QUIET_MIN} LOAD_MAX=${LOAD_MAX} run_on_open=${runOnOpen} 主检出=${mainTree} 需连静=${NEED} 样`);

let elapsed = 0;
let prevMain = '';
let streak = 0;
let mainChanges = 0;
while (elapsed < CAP) {
  const s = takeSample();
  const v = sampleVerdict(s, prevMain);
  if (v.mainChanged) mainChanges += 1;
  streak = v.ok ? streak + 1 : 0;
  writeFileSync(PIDF, `pid=${process.pid} epoch=${Math.round(Date.now() / 1000)} step=${STEP} cap=${CAP} quiet_min=${QUIET_MIN} run_on_open=${runOnOpen} last=${JSON.stringify(v.reasons)}\n`);
  beat(`阻塞集=${s.blockerProbeBad ? `判不了(${s.blockerProbeBad})` : s.blockers} 负载=${s.load ?? '读不到'} ${s.portsReason} 载体(rc${s.carrierFree ? 0 : 1})=${s.carrierReading} main=${s.main || '读不到'}(上一=${prevMain || '首样'}) 连静=${streak}/${NEED} 不成立=${v.reasons.join('；') || '无'}`);
  if (process.env.FORCE_OPEN === '1') streak = NEED;
  if (streak >= NEED) {
    // 🔴 演练出来的 WINDOW_OPEN 必须带着"这是演练"的标记，否则日志里"负载=88 也算开窗"这一行
    //    会被下一轮读成真读数（v4 就是这么留了一条会骗人的行的）。
    beat(`WINDOW_OPEN${process.env.FORCE_OPEN === '1' ? '【FORCE_OPEN=1 演练，不是真窗口】' : ''} 五件同时成立已连续 ${streak * STEP}s ≥ ${QUIET_MIN} 分钟（负载=${s.load} main=${s.main} 观察期内 main 变过 ${mainChanges} 次）`);
    beat(`    手工等价命令：cd "${mainTree}" && node "${LANDER}" --confirm`);
    if (runOnOpen) {
      const body = runCmd || `node "${LANDER}" --confirm`;
      beat(`    开窗即执行：cd "${mainTree}" && ${body}`);
      const r = spawnSync('sh', ['-c', body], { cwd: mainTree, stdio: 'inherit' });
      const rc = r.status ?? 1;
      beat(`    LAND_RC=${rc}（0=已落地或按 dry-run 语义；1/2/3/4 见 selfhost-land-main.mjs 文件头）`);
      process.exit(rc);
    }
    beat('    ⚠️ 本哨兵没加 --run-on-open ⇒ 只报不开工。');
    process.exit(0);
  }
  prevMain = s.main || prevMain;
  const t0 = Date.now();
  execFileSync('sleep', [String(STEP)]);
  elapsed += Math.max(STEP, Math.round((Date.now() - t0) / 1000));
}
beat(`CAP_REACHED 等满 ${CAP}s：窗口仍未到（观察期内 main 变过 ${mainChanges} 次，负载/端口/载体/阻塞集未同时凑齐）——环境/协作未到位，不是产品失败`);
process.exit(3);
