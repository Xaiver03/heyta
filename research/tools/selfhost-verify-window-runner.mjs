/**
 * `pnpm verify:selfhost-stack` 的**开窗起跑器**（只负责"什么时候允许起跑"和"起跑时把门拿到手里"）。
 *
 * 为什么要有它：第 2 项要的是一条现量，而这台机器上这件事已经三次在**起跑资格**上失败 ——
 * 每次都靠人临场判断"负载好像下来了"，于是要么撞在负载上（环境无效，白跑一段），
 * 要么撞在别人的测试上（宿主那道内存闸门 fail-fast，直接 exit 1）。
 * 这两件事本仓各有一把尺，而**两把尺会给出相反读数**（台账 §8.190：锁空 ≠ 负载可用），
 * 所以起跑资格必须是**两者的合取**，且阈值一个字不许改。
 *
 * 用法：
 *   node research/tools/selfhost-verify-window-runner.mjs --selftest   # 判资格那部分有没有牙
 *   node research/tools/selfhost-verify-window-runner.mjs --dry-run    # 只读现量，报"现在能不能起跑"
 *   node research/tools/selfhost-verify-window-runner.mjs              # 等窗口，到点**脱管**起跑（nohup）
 *
 * 旋钮（默认值都能跑）：`LOAD_MAX`(12) `STEP`(30) `CAP`(500) `CMD` `PIDF` `LOG`
 * 🔴 `LOAD_MAX` 来自任务书那句"负载 >12 属环境无效" —— 它是**判据不是旋钮**，
 *    调低它就是把环境红读成产品绿的通道，所以这里宁可留旋钮也不替你按：默认值就是 12。
 *
 * 三条边界（都写在跑的那份代码里，不在注释里许诺）：
 * 1. **让路**：起跑那一刻若阻塞集已经归零（⇒ 落地那条窗可能随时开），本起跑器**不起跑**并退 5 ——
 *    落地那一趟要的是"main 连续静默 + 负载低"，比这条现量更贵，不能被我把机器占住。
 * 2. **拿门而不是挤门**：宿主闸门是 fail-fast（`/tmp/tfa-test.lock` 里活 pid = 有人在做测试类的事），
 *    起跑前把**自己的 pid 写进锁**并在写后复读确认，跑完按"锁里仍是我"才释放。
 *    holder 若在自己的祖链里 ⇒ 只借不写（覆写会抢走外层的门）。
 *    逃生门 `TFA_ALLOW_CONCURRENT_TEST=1` 本脚本**不使用**。
 * 3. **取数走单一所有者**：1 分钟负载只经 `selfhost-loadavg.mjs` 的 `readLoad1()`（它带合成样自检，
 *    钉着"取的是第一位不是第五分钟位"）；本脚本不自己 `sysctl | awk`（§7 第 168 条那个坏过两回的配方）。
 */
import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLoad1, load1Selfcheck } from './selfhost-loadavg.mjs';

const LOAD_MAX = Number(process.env.LOAD_MAX || 12);
const STEP = Number(process.env.STEP || 30);
const CAP = Number(process.env.CAP || 500);
const LOCK = '/tmp/tfa-test.lock';
const SELF = fileURLToPath(import.meta.url);
const WT = dirname(dirname(dirname(SELF)));
const PIDF = process.env.PIDF || '/tmp/heyta-verify-runner.pid';
const LOG = process.env.LOG || '/tmp/heyta-verify-stack.log';
const CMD = process.env.CMD || 'pnpm verify:selfhost-stack';

const say = (m) => console.log(m);

/**
 * 起跑资格判定（纯函数 —— 臂打在这一枚上）。
 * @returns {{go:boolean, why:string, tier:'go'|'yield'|'wait'}}
 */
export function decideStart({ load, holderAlive, blockers, loadMax = LOAD_MAX, selfPidAlive = false }) {
  if (!Number.isFinite(load)) return { go: false, why: `负载读不出数（${JSON.stringify(load)}）⇒ 判不了，不猜`, tier: 'wait' };
  if (holderAlive) return { go: false, why: `宿主内存闸门锁里有活持有者 ⇒ 别人在做测试类的事，等`, tier: 'wait' };
  if (load > loadMax) return { go: false, why: `负载 ${load} > ${loadMax} ⇒ 环境无效（阈值不改）`, tier: 'wait' };
  // 🔴 让路那条排在负载之后：负载高时落地那条窗本来也开不了，不存在抢的问题。
  if (blockers === 0) {
    return { go: false, why: `阻塞集已归零 ⇒ 落地那条窗随时会开，这条现量给落地让路（退 5）`, tier: 'yield' };
  }
  return { go: true, why: `负载 ${load} ≤ ${loadMax} · 锁空 · 阻塞集 ${blockers} 枚（落地还等别人提交，这段机器归本条）`, tier: 'go' };
}

/** 读锁里那个 pid 是不是活的持有者（macOS 没有 flock，只认 `head -1` + `kill -0`）。 */
export function holderState() {
  if (!existsSync(LOCK)) return { alive: false, pid: '' };
  const pid = String(readFileSync(LOCK, 'utf8').split('\n')[0] || '').trim();
  if (!/^\d+$/.test(pid)) return { alive: false, pid: '' };
  try {
    process.kill(Number(pid), 0);
    return { alive: true, pid };
  } catch {
    return { alive: false, pid: '' }; // 死 pid 视为空闲（原样保留文件，不清 —— 那不是我的对象）
  }
}

function blockersNow() {
  const out = execFileSync('node', [join(WT, 'research/tools/selfhost-landing-blockers.mjs')],
    { encoding: 'utf8', cwd: WT });
  const m = out.match(/阻塞集 (\d+) 枚/);
  if (!m) throw new Error(`阻塞集脚本没报出"阻塞集 N 枚"（读数不可信）：\n${out.slice(-200)}`);
  return Number(m[1]);
}

function currentReading() {
  const { value: load } = readLoad1();
  const h = holderState();
  return { load, holderAlive: h.alive, holderPid: h.pid, blockers: blockersNow() };
}

/** 起跑前把门拿到自己手里（照 shim 的协议），写后复读确认。 */
function takeLockOrYield() {
  const h = holderState();
  if (h.alive) return { held: false, why: `起跑瞬间锁被他人写入（pid=${h.pid}）⇒ 让路，不双人占位` };
  writeFileSync(LOCK, `${process.pid}\n`);
  const back = String(readFileSync(LOCK, 'utf8').split('\n')[0] || '').trim();
  if (back !== String(process.pid)) return { held: false, why: `写完复读锁里是 ${back}（有人抢先写）⇒ 让路` };
  return { held: true };
}

function selftest() {
  const arms = [];
  const push = (name, expect, got) => arms.push({ name, expect: JSON.stringify(expect), got: JSON.stringify(got) });
  const okCase = { load: 5, holderAlive: false, blockers: 1 };
  push('control 负载低+锁空+阻塞集非零 ⇒ go', 'go', decideStart(okCase).tier);
  push(`A1 负载 >${LOAD_MAX} ⇒ 等（不是跑）`, 'wait', decideStart({ ...okCase, load: 13 }).tier);
  push('A2 锁里有活持有者 ⇒ 等', 'wait', decideStart({ ...okCase, holderAlive: true }).tier);
  push('A3 阻塞集归零 ⇒ 让路（不起跑）', 'yield', decideStart({ ...okCase, blockers: 0 }).tier);
  push('A4 负载读不出数 ⇒ 判不了，等且不猜', 'wait', decideStart({ ...okCase, load: Number.NaN }).tier);
  // A5/A6 钉**顺序**：阈值那格必须排在让路之前（负载高时落地窗本来也开不了），
  // 而"锁活"那格必须排在**一切**之前（撞别人的测试类运行比什么都贵）。
  push('A5 负载高 **且** 阻塞集归零 ⇒ 仍是 wait 不是 yield', 'wait',
    decideStart({ load: 99, holderAlive: false, blockers: 0 }).tier);
  push('A6 锁活 **且** 负载低 **且** 阻塞集归零 ⇒ 仍是 wait（先让测试的人）', 'wait',
    decideStart({ load: 5, holderAlive: true, blockers: 0 }).tier);
  // A7 阈值只能从 loadMax 推导，不是写死的字符串：给个自定义阈值，越界判定要跟着走
  push('A7 自定义 loadMax=3 时 load=4 判 wait（阈值确实是被约束的那个常量推出来的）', 'wait',
    decideStart({ ...okCase, load: 4, loadMax: 3 }).tier);
  // A8 阳性对照：把判定换成"恒 wait"的退化版，control 那臂必须读出不一样 ——
  //    这一臂不许写成恒真（恒真的对照臂就是本仓那条"永远通过的判据比没有判据更糟"）。
  push('A8[阳性对照] 真判定在 control 上不等于"恒 wait"的退化判定', true,
    decideStart(okCase).tier !== 'wait');

  let bad = 0;
  for (const a of arms) {
    const ok = a.expect === a.got;
    if (!ok) bad += 1;
    say(`${ok ? '  ok' : 'RED '} ${a.name}（期望 ${a.expect}，实得 ${a.got}）`);
  }
  const refused = arms.filter((a) => a.name.startsWith('A')).length;
  say(`\n臂数 ${arms.length}（拒绝类 ${refused}，按 tier 认领）· 红 ${bad}`);
  // 单一所有者那把尺也要复验一次：取错位（第五分钟）会让这台架整天报"可以跑"
  const sc = load1Selfcheck();
  if (sc) {
    say(`❌ 负载解析自检不过：${sc}`);
    process.exit(1);
  }
  say('✅ 负载解析自检（1 分钟位）与资格判定臂都在；恒 wait 的实现会打红 A8 那臂');
  process.exit(bad ? 1 : 0);
}

if (process.argv[2] === '--selftest') selftest();

const mode = process.argv[2] || '';
if (mode === '--dry-run') {
  const r = currentReading();
  const d = decideStart(r);
  say(`现量：负载=${r.load} 锁=${r.holderAlive ? `活持有者 ${r.holderPid}` : '空'} 阻塞集=${r.blockers} 枚`);
  say(`${d.tier === 'go' ? '✅ 可以起跑' : d.tier === 'yield' ? '⏸ 让路' : '⏳ 继续等'} —— ${d.why}`);
  process.exit(d.tier === 'go' ? 0 : d.tier === 'yield' ? 5 : 3);
}

const t0 = Date.now();
let lastWhy = '';
let startLoad = Number.NaN;
for (;;) {
  let r;
  try {
    r = currentReading();
  } catch (e) {
    say(`取数失败（探针坏 ⇒ 停，不改判据凑绿）：${e?.message ?? e}`);
    process.exit(2);
  }
  const d = decideStart(r);
  if (d.why !== lastWhy) {
    lastWhy = d.why;
    say(`${Math.round((Date.now() - t0) / 1000)}s 负载=${r.load} 锁=${r.holderAlive ? r.holderPid : '空'} 阻塞集=${r.blockers} ⇒ ${d.tier}: ${d.why}`);
  }
  if (d.tier === 'yield') process.exit(5);
  if (d.tier === 'go') {
    startLoad = r.load;
    break;
  }
  if ((Date.now() - t0) / 1000 > CAP) {
    say(`等满 CAP=${CAP}s 仍未开窗 ⇒ 环境无效 ≠ 产品失败（退 3，不跑、不调阈值）`);
    process.exit(3);
  }
  execFileSync('sleep', [String(STEP)]);
}

const taken = takeLockOrYield();
if (!taken.held) {
  say(`让路：${taken.why}`);
  process.exit(5);
}
/* 🔴 起跑器**自己不退出**，直到那一趟跑完：锁里写的是本进程 pid，它活着期间宿主那道门
 *    对本进程的后代走自树豁免（这正是"长命令内部每个测试类调用点不再被中途抢"的修法），
 *    而外部会话会被拒 —— 这是这把门的语义（一次只跑一个测试类负载），不是挤门。
 *    所以这里必须用**前台子进程**等它跑完再释放；nohup 脱管的是这个起跑器本身。 */
writeFileSync(PIDF, `pid=${process.pid} lock_held=1 load_at_start=${startLoad} cmd=${CMD}\n`);
appendFileSync(LOG, `\n===== 起跑 ${new Date().toISOString()} runner=${process.pid} 起跑时负载=${startLoad} =====\n`);
say(`开窗（起跑时负载=${startLoad} ≤ ${LOAD_MAX}、锁=我 ${process.pid}）⇒ 起跑：${CMD}（日志 ${LOG}）`);

const child = spawn('bash', ['-lc', `cd ${JSON.stringify(WT)} && ${CMD}`], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env },
});
child.stdout.on('data', (b) => appendFileSync(LOG, b));
child.stderr.on('data', (b) => appendFileSync(LOG, b));
child.on('exit', (code, signal) => {
  // 只在锁里仍是我时删 —— 删掉别人正占着的锁等于替他把门摘掉
  const mine = String(readFileSync(LOCK, 'utf8').split('\n')[0] || '').trim() === String(process.pid);
  if (mine) rmSync(LOCK, { force: true });
  rmSync(PIDF, { force: true });
  appendFileSync(LOG, `===== 收工 ${new Date().toISOString()} rc=${code} signal=${signal ?? '-'} 锁${mine ? '已释放' : '不是我的，没动'} =====\n`);
  say(`${CMD} 结束：rc=${code}${signal ? ` signal=${signal}` : ''}（环境无效≠产品失败：rc=3 属前者）· 日志 ${LOG}`);
  process.exit(code ?? 1);
});
