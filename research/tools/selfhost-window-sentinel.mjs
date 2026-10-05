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
 *   node research/tools/selfhost-window-sentinel.mjs --selftest          # 每一臂都写明它凭什么会红（臂数由输出现量，不抄进注释）
 *   node research/tools/selfhost-window-sentinel.mjs --alive             # 只读心跳：哨兵还活着吗（不用 kill -0）
 * 旋钮（默认值都能跑）：LOG PIDF CAP STEP QUIET_MIN LOAD_MAX MAX_ATTEMPTS HEYTA_CARRIER_WT FORCE_OPEN
 *
 * 🔴 心跳不是装饰：v4 那一趟 23:19 起跑、23:21 之后静死（日志里没有退出行，是父 shell 被收走的）。
 *    "有个东西在等窗口"这件事必须能**被读出来**，否则下一轮会把"没人跑"读成"还没到窗口"。
 *    ⇒ 每一样落一行心跳到 PIDF（`pid=… epoch=…`），`--alive` 用 `ps -o pid= -p` 比回显再算年龄。
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, writeFileSync, readFileSync, openSync, closeSync, fstatSync, readSync } from 'node:fs';
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
const MAX_ATTEMPTS = Number(process.env.MAX_ATTEMPTS || 3);
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

/**
 * 一次 `--confirm` 之后怎么办。
 * 退 1（main 在算完载体之后又动了）与退 3（负载/端口/载体没守住）说的是**这一趟的时机不对**，
 * 不是产品红 —— 而窗口是按分钟计的稀缺资源，直接退出等于把已经拿到的窗口还给随机性。
 * 🔴 但不许无限重试：每一趟完整链要几十分钟高负载，重试会把一次干扰变成 N 次。两道闸：
 *    ① 只对 {1,3} 重试，外加 {2 且输出点名了未预置族}；退 4（载体上完整 `pnpm check` 红）也要人，
 *       再跑一遍只会拿同一个坏东西再跑；
 *    ② 重试前必须**重新凑满**连静要求 —— 由“回到循环后照样 sleep STEP 才计一样”保证，
 *       不许不等够就立刻重样（那样 15 分钟这个代理指标会在几十秒内被凑满 = 自己把判据摘掉）。
 *
 * ⚠️ 退 2 里混着**两种完全不同的东西**，v5 早期把它们都当成"探针坏 ⇒ 停"：
 *  - 真的探针坏（读不出形状、脚本自己崩）⇒ 停，等修；
 *  - `fam.other` ⇒ 载体撞到**预置族之外**的冲突路径。这不是坏，是"这件事还没人写解法"，
 *    而写解法的人可能正在别的会话里 —— 停下来 = 把已经等到的窗口扔了，还要人重新起一实例。
 *    所以这一支按"时机不对"处理：**回等待循环继续等**，并把它点名的路径打进日志，
 *    让下一位从日志里就能看到该补哪一族。判定靠输出里的针，不靠猜（针就是 `FAM_OTHER_MARK`，
 *    它是载体 `selfhost-merge-carrier.mjs` 那句 die() 的字面措辞 ⇒ 判针和抽路径共用同一个字面量，
 *    不抄第二份；抄两遍就是从"同一个判断写两次"开始漂的）。
 */
export const FAM_OTHER_MARK = '预置十一族之外';

/**
 * 把 `spawnSync` 的结果折成一个退出码。
 *
 * 🔴 `r.error` 必须**先于** `r.status` 判：`spawnSync` 起不来时 `status` 是 `null`，
 *    老写法 `r.status ?? 1` 会把它折成 **1**，而 1 在这条链上的语义是"main 在算完载体后又动了 ⇒ 可重试"。
 *    于是"载体脚本压根没被执行"（node 找不到、权限、fork 失败…）会被记成一次正常的抢先，
 *    三枚尝试全部用满后哨兵安静收工 —— 症状是"窗口明明到了却没落地，日志里每一行都说是别人抢先"。
 *    归到 2（探针坏 ⇒ 拿同一个坏探针再跑一遍还是坏的）才会**停手并把原因留在日志里**。
 */
export const landRcOf = (r) => (r.error ? 2 : (r.status ?? 1));

export function decideAfterLand(rc, attempts, maxAttempts, landOut = '') {
  if (rc === 0) return { action: 'landed', retry: false, exitCode: 0 };
  if (rc === 2) {
    const famOther = String(landOut).includes(FAM_OTHER_MARK);
    const canRetry = famOther && attempts < maxAttempts;
    return {
      action: canRetry ? 'retry' : 'stop',
      retry: canRetry,
      exitCode: rc,
      why: famOther
        ? (canRetry ? '冲突面有未预置族 ⇒ 等解法被写进来，不算探针坏'
                    : `冲突面有未预置族，但尝试次数已用满（第 ${attempts}/${maxAttempts} 次）⇒ 停，这一族要人来补`)
        : '探针坏 ⇒ 拿同一个坏探针再跑一遍还是坏的',
    };
  }
  const retry = (rc === 1 || rc === 3) && attempts < maxAttempts;
  return { action: retry ? 'retry' : 'stop', retry, exitCode: rc };
}

/**
 * 载体在 `fam.other` 那一支点名后紧跟的行是 `  - <路径>`。
 * 把它们抽出来进日志，"该补哪一族"就不用下一位再去翻几十 MB 的输出文件。
 * 只认针句**之后连续**的那一段：notes 行用的是 `     · ` 前缀，不会被误收。
 */
export function famOtherPaths(text) {
  const at = String(text).indexOf(FAM_OTHER_MARK);
  if (at < 0) return [];
  const paths = [];
  for (const line of String(text).slice(at).split('\n').slice(1)) {
    const m = line.match(/^ {2}- (\S+)/);
    if (!m) break;
    paths.push(m[1]);
  }
  return paths;
}

/** 只读文件末尾 bytes 字节（完整链的输出可能有几十 MB，判针不需要全文进内存）。 */
function tailFile(path, bytes = 300_000) {
  let fd;
  try {
    fd = openSync(path, 'r');
    const size = fstatSync(fd).size;
    const len = Math.min(size, bytes);
    if (!len) return { text: '', size };
    const buf = Buffer.allocUnsafe(len);
    readSync(fd, buf, 0, len, size - len);
    return { text: buf.toString('utf8'), size };
  } catch {
    return { text: '', size: -1 };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
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
  // decideAfterLand：这六条臂各钉住一条"不许"
  push('B1 rc=0 ⇒ landed、不重试、退 0', 'landed|false|0', (()=>{const d=decideAfterLand(0,1,3);return [d.action,d.retry,d.exitCode].join("|");})());
  push('B2 rc=1 且还没用满尝试 ⇒ 回等待循环（窗口不许还给随机性）', true, decideAfterLand(1,1,3).retry);
  push('B3 rc=3 且已用满尝试 ⇒ 停，退出码原样透出去', false, decideAfterLand(3,3,3).retry);
  push('B4 rc=4（载体上完整 check 红）⇒ **不重试**，那是要人逐段归属的', false, decideAfterLand(4,1,3).retry);
  push('B5 rc=2 且输出里**没有**未预置族的针 ⇒ 不重试（拿同一个坏探针再跑一遍还是坏的）', false,
    decideAfterLand(2, 1, 3, '🔴 载体 —— 载体脚本判不了（退 2）：🔴 载体目录 /tmp/heyta-merge-carrier 不存在').retry);
  push('B6 停止时退出码必须是 LAND 的原码，不许被改写成 0', 4, decideAfterLand(4,1,3).exitCode);
  // B7–B10：退 2 的另一支。夹具用的是载体 die() 的字面形状（❌ + 两格 - 路径 + 已量到的读数用 · 前缀）
  const FAM_OUT = '   已量到的读数：\n     · 分族：pkg=1 gi=0 png=0\n' +
    '❌ 出现**预置十一族之外**的冲突路径，不许自动决定：\n  - docs/README.md\n  - package.json\n' +
    '   现场：已擦干净';
  push('B7 rc=2 且输出点名了未预置族 ⇒ 重试（"还没人写解法"≠"探针坏"，窗口不该还给随机性）', true,
    decideAfterLand(2, 1, 3, FAM_OUT).retry);
  push('B8 未预置族那一支照样受 MAX_ATTEMPTS 挡（第 3 次仍这样 ⇒ 停）', false,
    decideAfterLand(2, 3, 3, FAM_OUT).retry);
  push('B9 针命中要带出点名的路径（下一位不必去翻那几十 MB 输出）', 'docs/README.md,package.json',
    famOtherPaths(FAM_OUT).join(','));
  push('B10 非 fam.other 的输出 ⇒ 空集（notes 那种 `     · ` 行不许被收成路径）', 0,
    famOtherPaths('❌ 载体脚本判不了（退 2）：\n     · pkg=1\n   现场：已擦干净').length);
  // B11：判针的**出处**。哨兵是按载体的字面措辞判的，那边改了词而这里没跟着改 ⇒ 哨兵悄悄退化成
  //      "退 2 永远算探针坏 ⇒ 永远停"，症状是"窗口明明到了却没落地"，日志里看不出是针失效。
  const carrierReading = (() => {
    try {
      const src = readFileSync(join(ROOT, 'research/tools/selfhost-merge-carrier.mjs'), 'utf8');
      if (!src.includes(`出现**${FAM_OTHER_MARK}**的冲突路径`)) return '针无出处';
      if (!src.includes("fam.other.join('\\n  - ')")) return '路径行形状变了';
      return 'ok';
    } catch { return '读不到载体'; }
  })();
  push('B11 判针有出处（载体 die() 带着同一个字面量，路径行仍是两格 `- `）⇒ 那边改措辞这里就红', 'ok', carrierReading);
  // B12/B13：`spawnSync` 起不来的那一档**不许**折成"main 抢先"（那是可重试的，会把三枚尝试全用满）。
  const brokenSpawn = { error: new Error('ENOENT: node 起不来'), status: null };
  push('B12 r.error 存在 ⇒ 折成 2（探针坏，停手）而不是 1（抢先，可重试）', 2, landRcOf(brokenSpawn));
  push('B12b 阳性对照：老写法 `status ?? 1` 对同一枚对象读成 1 ⇒ 这条臂是承重的', 1, brokenSpawn.status ?? 1);
  push('B13 正常退 4 ⇒ 原样是 4（逐段归属那一档，不重试）', 4, landRcOf({ status: 4 }));
  push('B13b status=null 且无 error ⇒ 仍按 1 走（保留旧行为，只是不再吞掉 r.error）', 1, landRcOf({ status: null }));
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
  console.log(`哨兵自检：臂数 ${arms.length} · 红 ${bad} · 判定臂 ${arms.filter((a) => /^[AB]\d+ /.test(a.name)).length} 条`);
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
let attempts = 0;
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
      attempts += 1;
      const body = runCmd || `node "${LANDER}" --confirm`;
      // 🔴 输出先落文件再读，不许 `stdio: 'inherit'` 一走了之：退 2 那两支（探针坏 / fam.other）
      //    靠输出里的针才分得开，而后台实例的 inherit 输出落不进任何下一位能复核的地方。
      //    重定向不带管道 ⇒ 退出码还是被测命令的（环境陷阱 #179/#164 那一族）。
      const landOutPath = `${LOG}.land-${attempts}.log`;
      beat(`    开窗即执行（第 ${attempts}/${MAX_ATTEMPTS} 次尝试）：cd "${mainTree}" && ${body} > '${landOutPath}' 2>&1`);
      const t0 = Date.now();
      const r = spawnSync('sh', ['-c', `${body} > '${landOutPath}' 2>&1`], { cwd: mainTree });
      // 🔴 `r.error` 先于 `r.status`（见 `landRcOf` 的注释：起不来 ≠ "main 抢先"）。
      const rc = landRcOf(r);
      if (r.error) beat(`    🔴 落地脚本**没被启动**（不是产品红，也不是抢先）：${r.error.message}`);
      const elapsedMin = ((Date.now() - t0) / 60000).toFixed(1);
      const { text, size } = tailFile(landOutPath);
      const d = decideAfterLand(rc, attempts, MAX_ATTEMPTS, text);
      // 这一行是任务 #35 缺的那一格："落地要求 main 连续静默多久"= 连静读数 + 这一段实测。
      beat(`    LANDER 时长=${elapsedMin}min（第 ${attempts} 次；这就是窗口开之后 main 必须继续不动那么久，` +
        `落地关闭判据里"完整 check 在载体上跑过"的那一段就花在这里）`);
      beat(`    LAND_RC=${rc}（0=已落地；1=main 在算完载体后又动了；2=探针坏**或**落地脚本没被启动**或**冲突面有未预置族；3=负载/端口/载体没守住；` +
        `4=载体上完整 pnpm check 红 ⇒ 要人逐段归属。见 selfhost-land-main.mjs 文件头）⇒ ${d.action}` +
        (d.why ? `（${d.why}）` : ''));
      const paths = famOtherPaths(text);
      if (paths.length) beat(`    未预置族点名的路径（该补的这一族，下一位从这里看）：\n      - ${paths.join('\n      - ')}`);
      // 判针与抽路径共用一个字面量，但行形状是两件事：命中了针却抽不出路径 = 载体那句 die() 改了行。
      if (rc === 2 && !paths.length && text.includes(FAM_OTHER_MARK)) {
        beat(`    🔴 针命中但抽不出路径 ⇒ 载体 die() 的行形状变了（判定仍按 fam.other 走，"该补哪一族"要去 ${landOutPath} 里读）`);
      }
      // 空读数要自证：判针没语料时"没命中"不等于"不是 fam.other"，这里明写出来。
      if (rc === 2 && size <= 0) {
        beat(`    🔴 退 2 但输出读不到（${landOutPath} size=${size}）⇒ 针没有语料可比，按"停"处理是保守，不是判据`);
      }
      beat(`    完整输出：${landOutPath}（${size < 0 ? '读不到' : `${size} 字节`}）`);
      const tailLines = text.trim().split('\n').slice(-3);
      for (const l of tailLines) beat(`      │ ${l.slice(0, 160)}`);
      if (!d.retry) process.exit(d.exitCode);
      // 🔴 回到等待循环，且**必须重新凑满**连静要求：靠下面这一次 STEP 睡眠计时，
      //    不许"不等够就立刻重样"（那样 15 分钟这个代理指标会在几十秒内被凑满 = 自己把判据摘了）。
      beat('    ↩ 时机不对不等于产品红 ⇒ 回等待循环，重新凑满连静要求后再试');
      prevMain = s.main || prevMain;
      streak = 0;
      const tRetry = Date.now();
      execFileSync('sleep', [String(STEP)]);
      elapsed += Math.max(STEP, Math.round((Date.now() - tRetry) / 1000));
      continue;
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
