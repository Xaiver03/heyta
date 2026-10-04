#!/usr/bin/env node
/**
 * 把 `feat/self-host-distribution` 落进 `main` —— **一条命令，但默认什么都不动**。
 *
 * 为什么要有它：落地那一步的四条禁令（不动主检出 / 不 `git branch -f main` / 不 push /
 * 不代改别人的文档）和三条前置（阻塞集归零 / 载体是**当前** main × 当前分支 / 双亲对得上）
 * 全靠人记，而 main 在 20 分钟里能前进两次（§8.111 ① 实测）。
 * 这里把它们变成**一次跑完的体检**：每条闸门都出读数，最后按最严重那一档退出。
 *
 * 用法：
 *   node research/tools/selfhost-land-main.mjs                 # 只体检，打印要跑的命令
 *   node research/tools/selfhost-land-main.mjs --confirm       # 真的落地（必须在主检出目录里跑）
 *   node research/tools/selfhost-land-main.mjs --carrier <ref> # 用现成的载体，不重算（测双亲闸门用）
 *   node research/tools/selfhost-land-main.mjs --attribute     # check 红时接着跑逐段归属
 *   node research/tools/selfhost-land-main.mjs --selftest      # 只验"端口射程判据"有没有牙（不碰任何工作树）
 *
 * 🔴 `--confirm` 会先自动跑一遍 `--selftest` 的内容：判据自己坏了的时候，它那句
 *   "这些端口没人用"**不能**当放行（§8.120 那条同一个形状）。
 *
 * 退出码（严重度 2 > 1 > 3，"等窗口"不该盖过"这一步本来就不该做"）：
 *   0 = 体检通过（dry-run）/ 已落地（--confirm）
 *   2 = 探针或用法问题（找不到工作树、--confirm 却不在主检出里跑、脚本没报出可读的数）
 *   1 = 前置不成立（双亲不对 / 阻塞集非空 / main 在算完之后又动了 / --confirm 但 check 没跑）
 *   3 = 环境无效（负载超阈值）—— 环境无效不等于产品失败
 *   4 = 载体上完整 `pnpm check` 红 ⇒ **不落地**，先逐段归属
 */
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import {
  appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAIN_REF = 'main';
const BRANCH_REF = process.env.HEYTA_LAND_BRANCH ?? 'feat/self-host-distribution';
const MERGE_REF = 'feat/self-host-merge-main';
// 🔴 一只旋钮、一个默认值，而且**必须与 selfhost-merge-carrier.mjs 的默认值逐字相同**
// （自检臂 6 就是判这个的）。两件事都是实测出来的坑：
// ① 用 `join(tmpdir(), …)` 会得到 `$TMPDIR/heyta-merge-carrier` —— 那是个**不存在的目录**
//    （macOS 的 TMPDIR 不是 /tmp），闸门于是判的是另一棵树；
// ② 另起一个 `HEYTA_LAND_CARRIER_DIR` 的话，只设 `HEYTA_CARRIER_WT` 的人会读到旧树的端口清单。
const CARRIER_DIR_DEFAULT = '/tmp/heyta-merge-carrier';
const CARRIER_DIR = process.env.HEYTA_CARRIER_WT ?? CARRIER_DIR_DEFAULT;
const MAX_LOAD = Number(process.env.HEYTA_LAND_MAX_LOAD ?? 12);

const ARGS = process.argv.slice(2);
const FLAG = (n) => ARGS.includes(`--${n}`);
const OPT = (n) => {
  const i = ARGS.indexOf(`--${n}`);
  return i >= 0 ? ARGS[i + 1] : null;
};
const CONFIRM = FLAG('confirm');

const LOG = join(tmpdir(), 'heyta-land-main.log');
const say = (line) => {
  process.stdout.write(`${line}\n`);
  appendFileSync(LOG, `${new Date().toISOString().slice(11, 19)} ${line}\n`);
};
const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 64 << 20 });

/**
 * 闸门收集器：一次跑完把所有不成立的都打出来，再按严重度退。
 * 第一件事就 exit 的写法，会让人每修一条才看见下一条 —— 而落地这一步的窗口是分钟级的。
 */
const fails = [];
const gate = (severity, name, fn) => {
  try {
    const note = fn();
    say(`✅ ${name}${note ? ` —— ${note}` : ''}`);
  } catch (e) {
    if (e?.probe) {
      say(`🔴 ${name} —— ${e.message}`);
      process.exit(2);
    }
    if (e?.skipped) {
      say(`⏭️ ${name} —— ${e.message}`);
      return;
    }
    const sev = e?.sev ?? severity;
    fails.push({ sev, name, msg: e?.message ?? String(e) });
    say(`🔴 ${name} —— ${e?.message ?? String(e)}`);
  }
};
const refuse = (msg, sev = 1) => {
  const e = new Error(msg);
  e.sev = sev;
  throw e;
};
/** 跳过**必须响亮**，而且不能记成通过 —— 沉默跳过等于给后面的落地放行。 */
const skip = (msg) => {
  const e = new Error(msg);
  e.skipped = true;
  throw e;
};
/** 探针自己没接到东西（≠"接上了、读出来是空的"）⇒ 就地 exit 2，不混进"前置不成立"。 */
const blind = (msg) => {
  const e = new Error(msg);
  e.probe = true;
  throw e;
};

/* ── 射程推导与监听探测（gate 3b 和 --selftest 共用这一份，不抄第二份）──
 * 为什么要在这台机器上判：`pnpm check` 里的 e2e 前置会把它那些端口上的监听者
 * **逐个 SIGKILL**（`scripts/check-ai-e2e-preflight.mjs` 里的 `process.kill(pid, 'SIGKILL')`）。
 * 那是**别人在这台机器上的工作现场**，而它杀完只打印 pid —— 受害者通常到下一次
 * ECONNREFUSED 才知道。
 *
 * 🔴 射程**不抄第二份、也不只抄一段**：端口从"链里每一段调用那枚 preflight 时实际传了什么"
 *   现读（显式参数优先，没传才回落到 `DEFAULT_PORTS`）。只读默认值会漏掉只有显式参数的那些段。
 * 🔴 读不到就拒绝：空集在这里不是"安全"，是探针没接上。 */
const PREFLIGHT = 'scripts/check-ai-e2e-preflight.mjs';

/** dir 树上链会清的端口。返回 `{ error }` 表示**判不了**（调用方必须拒绝，不能放行）。 */
function deriveKillPorts(dir) {
  const pfPath = join(dir, PREFLIGHT);
  if (!existsSync(pfPath)) {
    return { error: `${dir} 里没有 ${PREFLIGHT} ⇒ 不知道链会清哪些端口；不知道不等于不清` };
  }
  const dm = readFileSync(pfPath, 'utf8').match(/const DEFAULT_PORTS = \[([\d,\s]+)\]/);
  if (!dm) return { error: `读不到 ${PREFLIGHT} 的 DEFAULT_PORTS（它改了形状）⇒ 不猜` };
  const defaults = dm[1]
    .split(',')
    .map((x) => Number(x.trim()))
    .filter((x) => Number.isInteger(x) && x > 0);
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  } catch {
    return { error: `${dir}/package.json 读不到或不是合法 JSON ⇒ 链的形状不可知` };
  }
  const chain = String(pkg.scripts?.check ?? '');
  if (!chain.trim()) return { error: 'package.json 里没有 check 链 ⇒ 这不是"链没有破坏性前置"，是没读到' };
  const chainSegs = chain.split(' && ').map((s) => s.replace(/^pnpm /, '').trim());
  /** port → 是谁把它放进射程的（拒绝时要能归因，别只报一个数字） */
  const owners = new Map();
  for (const seg of chainSegs) {
    const cmd = String(pkg.scripts?.[seg] ?? '');
    if (!cmd.includes(PREFLIGHT.split('/').pop())) continue;
    for (const m of cmd.matchAll(/check-ai-e2e-preflight\.mjs((?:\s+\d+)*)/g)) {
      // `Number('')` 是 0，不是 NaN —— 不带 `> 0` 的话"这段没传参数"会被读成"传了端口 0"，
      // 于是回落不发生、真正会被 SIGKILL 的默认端口整个掉出射程（控制臂实测抓到）。
      const explicit = m[1].trim().split(/\s+/).map(Number).filter((x) => Number.isInteger(x) && x > 0);
      for (const p of explicit.length ? explicit : defaults) {
        if (!owners.has(p)) {
          owners.set(p, `${seg}${explicit.length ? `（显式传 ${explicit.join('/')}）` : '（用 DEFAULT_PORTS）'}`);
        }
      }
    }
  }
  if (!owners.size) {
    return { error: '链里一段都不清端口？要么 preflight 改名了、要么我的匹配没接上 ⇒ 按"判不了"处理，不放行' };
  }
  return { ports: [...owners.keys()].sort((a, b) => a - b), owners };
}

/** 某端口上的监听 pid。`{ noLsof }` = 这台机器上判不了（调用方不许当成"没人用"）。 */
function listenersOn(port) {
  let raw;
  try {
    raw = execFileSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
  } catch (e) {
    if (e?.code === 'ENOENT') return { noLsof: true };
    raw = String(e?.stdout ?? ''); // 非 0 且无输出 = 没人监听（preflight 自己就是这么判的）
  }
  return { pids: raw.trim().split('\n').filter(Boolean) };
}

/** 会被链清掉的**现有监听者**，每条带上是谁把它放进射程的。 */
function busyEntries(ports, owners) {
  const busy = [];
  for (const p of ports) {
    const seen = listenersOn(p);
    if (seen.noLsof) return { noLsof: true };
    for (const pid of seen.pids) {
      let cmd = '(读不到)';
      try { cmd = execFileSync('ps', ['-p', pid, '-o', 'command='], { encoding: 'utf8' }).trim(); } catch { /* 进程可能刚退 */ }
      busy.push(`:${p}（来自 ${owners.get(p)}）pid=${pid} ${cmd.slice(0, 80)}`);
    }
  }
  return { busy };
}

/** 建一棵只含这两份文件的假树，用来喂 deriveKillPorts（不碰任何真工作树）。 */
function fixtureTree(pkgScripts) {
  const dir = mkdtempSync(join(tmpdir(), 'ht-ports-fixture-'));
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  writeFileSync(join(dir, PREFLIGHT), 'const DEFAULT_PORTS = [4318, 4319];\nconst PORTS = ARGS.length > 0 ? ARGS : DEFAULT_PORTS;\n');
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ scripts: pkgScripts }, null, 2)}\n`);
  return dir;
}

/**
 * 射程判据的自检：夹具正向 + 四个变异臂 + 探测有牙（含**只监听 IPv6** 那一种）+ 收尾复绿。
 * 返回 `{ problems, reading }` —— problems 非空 ⇒ 判据没牙或坏了，调用方必须拒绝。
 */
function portsSelftest() {
  return (async () => {
    const problems = [];
    const eq = (got, want, name) => {
      const a = JSON.stringify(got);
      const b = JSON.stringify(want);
      if (a !== b) problems.push(`${name}：实际 ${a}，应当 ${b}`);
    };
    const errs = [];

    /* 控制臂：三段调用（默认 / 显式 4322 / 显式 4320）+ 一段根本不清端口 */
    const base = {
      check: 'pnpm a && pnpm b && pnpm c && pnpm d',
      a: `node ${PREFLIGHT} && playwright test`,
      b: `node ${PREFLIGHT} 4322 && playwright test`,
      c: `node ${PREFLIGHT} 4320 && playwright test`,
      d: 'node scripts/other-check.mjs',
    };
    const r0 = deriveKillPorts(fixtureTree(base));
    if (r0.error) problems.push(`控制臂应当出数却报错：${r0.error}`);
    else eq(r0.ports, [4318, 4319, 4320, 4322], '控制臂射程');

    /* 臂 1：preflight 不在树上 ⇒ 必须是"判不了"，不能是空集 */
    const noPf = fixtureTree(base);
    rmSync(join(noPf, PREFLIGHT));
    const r1 = deriveKillPorts(noPf);
    errs.push(r1.error ?? '(没报错)');
    if (!r1.error) problems.push('臂1 摘掉 preflight 文件后判据静默 ⇒ 会被读成"链不清端口"');

    /* 臂 2：DEFAULT_PORTS 换了形状 ⇒ 必须报错，不能回落到脑里的数 */
    const shape = fixtureTree(base);
    writeFileSync(join(shape, PREFLIGHT), 'const DEFAULT_PORTS = PORTS_DEFAULT;\n');
    const r2 = deriveKillPorts(shape);
    errs.push(r2.error ?? '(没报错)');
    if (!r2.error) problems.push('臂2 把改形的 DEFAULT_PORTS 当成读到了');

    /* 臂 3：链里一段都不提 preflight ⇒ 必须报错（不是"安全"） */
    const r3 = deriveKillPorts(fixtureTree({ ...base, a: 'node x.mjs', b: 'node y.mjs', c: 'node z.mjs' }));
    errs.push(r3.error ?? '(没报错)');
    if (!r3.error) problems.push('臂3 匹配没接上却返回了端口集');

    /* 臂 4：只有一段、且它传了显式参数 ⇒ 射程必须恰好是那一个，**不许把默认值也拖进来**。
     * 这条挡的是"过度拒绝"：拖进没人清的端口会让闸门在别人没用时也拒绝跑链。 */
    const r4 = deriveKillPorts(fixtureTree({ check: 'pnpm only', only: `node ${PREFLIGHT} 4399 && playwright test` }));
    if (r4.error) problems.push(`臂4 应当出数却报错：${r4.error}`);
    else eq(r4.ports, [4399], '臂4 显式参数不该带出 DEFAULT_PORTS');

    /* 臂 5：同一端口被两段认领时，归因只留第一条（拒绝信息里不能出现两个来源） */
    const r5 = deriveKillPorts(fixtureTree({
      check: 'pnpm a && pnpm b',
      a: `node ${PREFLIGHT} 4320`,
      b: `node ${PREFLIGHT} 4320 && node c`,
    }));
    if (r5.error) problems.push(`臂5 应当出数却报错：${r5.error}`);
    else eq(r5.ports, [4320], '臂5 端口去重');

    /* 探测腿：真造监听者，两种栈各一条，关掉之后再测一次（阴性对照）。
     * IPv6 单栈那条是重点 —— vite 就绑 `[::1]`；探测若只认 IPv4，会把**正在被人用**的端口
     * 读成"空闲"，SIGKILL 照旧发生，而闸门报绿。
     * 关闭后仍被读成有人用 = 过度拒绝，闸门会把自己的路也堵死。 */
    const probe = [];
    for (const host of ['::1', '127.0.0.1']) {
      const srv = createServer();
      await new Promise((res, rej) => { srv.once('error', rej); srv.listen(0, host, res); });
      const port = srv.address().port;
      const seen = listenersOn(port);
      if (seen.noLsof) {
        problems.push(`这台机器上没有 lsof ⇒ 探测腿（${host}）判不了（夹具腿仍然成立）`);
      } else if (!seen.pids.includes(String(process.pid))) {
        problems.push(`探测腿看不见本进程监听 ${host}:${port} 的 socket ⇒ 有人用的端口会被读成空闲`);
      } else if (seen.pids.length !== 1) {
        problems.push(`:${port} 上报出 ${seen.pids.length} 个 pid，应当恰好 1（本进程）⇒ 拒绝信息会指错人`);
      } else {
        probe.push(`${host}:${port}→pid ${seen.pids[0]}`);
      }
      /** 开着的时候 busyEntries 必须数出恰好 1 条 —— 否则闸门里那条拒绝分支永远走不进去。 */
      if (!seen.noLsof) {
        const on = busyEntries([port], new Map([[port, `fixture（${host}）`]]));
        if (on.noLsof) problems.push(`busyEntries(${host}:${port}) 报判不了`);
        else if (on.busy.length !== 1) {
          problems.push(`${host}:${port} 开着时 busyEntries 数出 ${on.busy.length} 条，应当恰好 1 ⇒ 拒绝分支走不进去`);
        } else if (!on.busy[0].includes(`fixture（${host}）`)) {
          problems.push(`${host}:${port} 的归因串里没有来源（实际 ${on.busy[0].slice(0, 60)}）⇒ 拒绝信息指不出是谁放进射程的`);
        }
      }
      await new Promise((res) => srv.close(res));
      if (!seen.noLsof) {
        const after = listenersOn(port);
        if (after.pids.length) {
          problems.push(`已关闭的 ${host}:${port} 仍被读成有人监听（pid ${after.pids.join('/')}）⇒ 闸门会过度拒绝`);
        }
        // 拒绝分支的条件本身：同一个端口喂给 busyEntries，开着时必须数出 1 条、关掉后 0 条。
        const on = busyEntries([port], new Map([[port, `fixture（${host}）`]]));
        if (on.noLsof) problems.push(`busyEntries(${host}) 报判不了`);
        else if (on.busy.length !== 0) {
          problems.push(`已关闭的 ${host}:${port} 在 busyEntries 里数出 ${on.busy.length} 条 ⇒ 闸门会过度拒绝`);
        }
      }
    }
    const probeReading = probe.join('、') || '未跑（没 lsof）';

    /* 收尾复绿：临时把 PATH 换掉，探测必须报"判不了"而不是"没人用"，换回来必须又能判。
     * 无条件跑 —— 前面任何一臂红了都不该把这一臂一起省掉。 */
    {
      const saved = process.env.PATH;
      let noLsof;
      try {
        process.env.PATH = '/nonexistent-heyta-ports-selftest';
        noLsof = listenersOn(4318);
      } finally {
        process.env.PATH = saved;
      }
      if (!noLsof?.noLsof) {
        problems.push('PATH 里没有 lsof 时探测腿没报"判不了" ⇒ "判不了"会被当成"没人用"');
      } else if (listenersOn(4318).noLsof) {
        problems.push('恢复 PATH 之后 lsof 仍然判不了 ⇒ 收尾没复绿');
      }
    }

    /* 臂 6：载体目录的默认值必须和**建它的那个脚本**逐字相同。
     * 这条是抄件防漂：本文件原来写的是 `join(tmpdir(), 'heyta-merge-carrier')`，而 macOS 的
     * TMPDIR 不是 /tmp ⇒ 闸门判的是一棵**不存在的树**（实测：那条路径 No such file or directory）。 */
    const carrierScript = join(dirname(fileURLToPath(import.meta.url)), 'selfhost-merge-carrier.mjs');
    if (!existsSync(carrierScript)) {
      problems.push(`读不到 ${carrierScript} ⇒ 无法对账载体目录默认值（不是"对上了"）`);
    } else {
      const cm = readFileSync(carrierScript, 'utf8')
        .match(/const WT = process\.env\.HEYTA_CARRIER_WT \|\| '([^']+)'/);
      if (!cm) {
        problems.push('读不到 selfhost-merge-carrier.mjs 里载体目录的默认值（它改了形状）⇒ 不敢假设还是本文件这个');
      } else if (cm[1] !== CARRIER_DIR_DEFAULT) {
        problems.push(`载体目录默认值漂移：本文件 ${CARRIER_DIR_DEFAULT} vs 载体脚本 ${cm[1]} ⇒ 闸门判的是另一棵树`);
      }
    }

    const carrier = deriveKillPorts(CARRIER_DIR);
    const reading = carrier.error
      ? `载体树 ${CARRIER_DIR} 判不了：${carrier.error}`
      : `载体射程 ${carrier.ports.length} 个端口（${carrier.ports.map((p) => `${p}←${carrier.owners.get(p)}`).join('、')}）`;
    return { problems, reading, errs, probeReading };
  })();
}

if (FLAG('selftest')) {
  const s = await portsSelftest();
  process.stdout.write(`${s.reading}\n`);
  process.stdout.write(`探测腿：${s.probeReading}\n`);
  s.errs.forEach((e) => process.stdout.write(`  臂读数：${e}\n`));
  if (s.problems.length) {
    process.stdout.write(`🔴 自检 ${s.problems.length} 条问题：\n - ${s.problems.join('\n - ')}\n`);
    process.exit(2);
  }
  process.stdout.write('✅ 射程判据自检：控制臂出数 + 五臂各按预期 + IPv6/IPv4 单栈监听都可见且关闭后读成空闲 + 无 lsof 时报"判不了" + 收尾复绿\n');
  process.exit(0);
}

/** 自检只在**真要跑链之前**做（dry-run 不跑链 ⇒ 不做，也不谎报）。 */
const portsCheck = CONFIRM ? await portsSelftest() : null;

/* ── 0. 现场 ──────────────────────────────────────────────────────── */
const trees = (() => {
  const out = [];
  let cur = {};
  const porcelain = execFileSync('git', ['worktree', 'list', '--porcelain'], { encoding: 'utf8' });
  for (const line of `${porcelain}\n`.split('\n')) {
    if (line.startsWith('worktree ')) cur = { path: line.slice(9).trim() };
    else if (line.startsWith('branch ')) cur.branch = line.slice(7).replace('refs/heads/', '').trim();
    else if (line.trim() === '') {
      if (cur.path) out.push(cur);
      cur = {};
    }
  }
  return out;
})();
const mainTree = trees.find((t) => t.branch === MAIN_REF);
const branchTree = trees.find((t) => t.branch === BRANCH_REF);
if (!mainTree || !branchTree) {
  say(`🔴 现场 —— 没找到签出 ${mainTree ? BRANCH_REF : MAIN_REF} 的工作树` +
    `（\`git worktree list\` 里的分支：${trees.map((t) => t.branch ?? '?').join(', ')}）`);
  process.exit(2);
}
const here = process.cwd();
say(`主检出=${mainTree.path} · 分支检出=${branchTree.path} · 当前目录=${here}`);

if (CONFIRM && here !== mainTree.path) {
  say('🔴 落地动作 —— --confirm 只能在主检出里跑');
  say(`   本脚本**故意不跨工作树**去 merge（那是"动主检出"，而主检出的工作树属于别人）。`);
  say(`   要真的落地：cd ${mainTree.path} && node research/tools/selfhost-land-main.mjs --confirm`);
  process.exit(2);
}

/* ── 1. 双亲与新鲜度：载体必须正好是 main × 分支 ──────────────────── */
const mainSha = git(['rev-parse', MAIN_REF], branchTree.path);
const branchSha = git(['rev-parse', BRANCH_REF], branchTree.path);
let carrierSha = OPT('carrier');
gate(1, '载体双亲对上', () => {
  if (!carrierSha) {
    const out = run('node', ['research/tools/selfhost-merge-carrier.mjs'], branchTree.path);
    const m = out.match(/✅ 载体 ([0-9a-f]{7,40}) = /);
    if (!m) {
      const e = new Error(`载体脚本没报出"✅ 载体 <sha>"：\n${out.slice(-600)}`);
      e.probe = true;
      throw e;
    }
    carrierSha = m[1];
    say(out.trim().split('\n').filter((l) => l.startsWith('✅') || l.trim().startsWith('并集') || l.includes('门禁')).join('\n'));
  } else {
    say(`⚠️ 用现成载体 ${carrierSha}（--carrier，没重算）`);
  }
  /* ⚠️ 双亲**不存在**和双亲**不对**是两件事：前者说明给的根本不是合并提交
     （`--carrier` 打错、或载体脚本没真造出 merge），把它报成 git 的原始错误会被读成探针坏了。 */
  const parent = (n) => {
    try {
      return git(['rev-parse', `${carrierSha}^${n}`], branchTree.path);
    } catch {
      return null;
    }
  };
  const p1 = parent(1);
  const p2 = parent(2);
  if (p1 === null || p2 === null) {
    refuse(`${carrierSha.slice(0, 8)} 不是双亲齐全的合并提交（^1=${p1?.slice(0, 8) ?? '无'} ^2=${p2?.slice(0, 8) ?? '无'}）` +
      ` ⇒ 它不是载体脚本的产物，别拿它落地`);
  }
  if (p1 !== mainSha) {
    refuse(`第一父 ${p1.slice(0, 8)} ≠ ${MAIN_REF} ${mainSha.slice(0, 8)} ⇒ 载体过期，落地会装一笔旧合并`);
  }
  if (p2 !== branchSha) {
    refuse(`第二父 ${p2.slice(0, 8)} ≠ ${BRANCH_REF} ${branchSha.slice(0, 8)} ⇒ 分支在算完载体后又动了`);
  }
  return `载体 ${carrierSha.slice(0, 8)} = ${mainSha.slice(0, 8)} × ${branchSha.slice(0, 8)}`;
});

/* ── 2. 阻塞集必须为空 ────────────────────────────────────────────── */
gate(1, '阻塞集为空', () => {
  const out = run('node', ['research/tools/selfhost-landing-blockers.mjs'], branchTree.path);
  const m = out.match(/阻塞集 (\d+) 枚/);
  if (!m) {
    const e = new Error(`阻塞集脚本没报出"阻塞集 N 枚"，读数不可信：\n${out.slice(-400)}`);
    e.probe = true;
    throw e;
  }
  const n = Number(m[1]);
  if (n !== 0) {
    const list = out.split('\n').filter((l) => l.trim().startsWith('BLOCK ')).map((l) => l.trim().slice(6));
    refuse(`${n} 枚未清空：${list.join(' · ')}\n` +
      '   这些是**别人未提交的工作树**，不是合并冲突（§8.111 ② 量过：提交态零冲突）⇒ 等他们提交。');
  }
  return '夹具绿 ⇒ 这个"空"是可信读数';
});

/* ── 3. 环境 ──────────────────────────────────────────────────────── */
gate(3, '负载可用', () => {
  const load1 = Number(
    execFileSync('sysctl', ['-n', 'vm.loadavg'], { encoding: 'utf8' })
      .replace(/[{}]/g, '').trim().split(/\s+/)[0],
  );
  if (load1 > MAX_LOAD) {
    refuse(`负载 ${load1} > ${MAX_LOAD} ⇒ 环境无效（不调阈值、不硬跑）。等窗口，或显式 HEYTA_LAND_MAX_LOAD=<n>`, 3);
  }
  return `1 分钟负载 ${load1} ≤ ${MAX_LOAD}`;
});

/* ── 3b. 跑链之前：那几个端口上有没有别人的 dev server ─────────────── */
gate(3, '完整 check 不会 SIGKILL 别人的 dev server', () => {
  if (!CONFIRM) skip('dry-run 不跑链 ⇒ 这条今天不适用（不适用 ≠ 通过）');
  if (portsCheck.problems.length) {
    blind(`射程判据的自检 ${portsCheck.problems.length} 条问题（判据自己坏了，不能拿它的"没端口在用"当放行）：\n     - ${portsCheck.problems.join('\n     - ')}`);
  }
  const d = deriveKillPorts(CARRIER_DIR);
  if (d.error) blind(`判不了射程：${d.error}`);
  const b = busyEntries(d.ports, d.owners);
  if (b.noLsof) blind('这台机器上没有 lsof ⇒ 判不了这些端口有没有人用，不拿"判不了"当"没人用"');
  if (b.busy.length) {
    refuse(`链里的 e2e 前置会 SIGKILL 这些：\n     ${b.busy.join('\n     ')}\n` +
      '   先与它们的所有者协调或让他让位。本工具**不提供绕过开关** —— 要硬跑就自己去载体目录跑 pnpm check，' +
      '那时清场是你做的、日志也在你手上。', 3);
  }
  return `${d.ports.length} 个端口（${d.ports.map((p) => `${p}←${d.owners.get(p)}`).join('、')}）全部无监听；自检：${portsCheck.probeReading}`;
});

/* ── 4. 载体上跑完整 pnpm check ───────────────────────────────────── */
let checkRan = false;
let checkOk = false;
gate(4, '载体上完整 pnpm check', () => {
  if (fails.length) {
    skip(`没跑（前面已有 ${fails.length} 条不成立 ⇒ 这一趟本来就不该落地）。跳过不等于通过。`);
  }
  if (!existsSync(CARRIER_DIR)) {
    refuse(`载体目录 ${CARRIER_DIR} 不存在 ⇒ 完整 check 没跑（跳过不等于通过）`);
  }
  const checkLog = join(tmpdir(), 'heyta-land-check.log');
  checkRan = true;
  say(`   日志 → ${checkLog}`);
  try {
    const out = run('pnpm', ['check'], CARRIER_DIR);
    writeFileSync(checkLog, out);
  } catch (e) {
    writeFileSync(checkLog, `${e.stdout ?? ''}\n---STDERR---\n${e.stderr ?? ''}\n---\n${e.message}`);
    refuse(`rc=${e.status ?? 1} ⇒ **不落地**。关闭判据是"每一枚红仍可归属到非本批"，不是"全绿"。\n` +
      `   逐段归属：node research/tools/selfhost-check-segments.mjs --tree ${CARRIER_DIR} --as carrier --ref ${MERGE_REF} --out /tmp/attrib.tsv` +
      (FLAG('attribute') ? '' : '（或给本脚本加 --attribute）'), 4);
  }
  checkOk = true;
  return '全绿';
});

/* ── 5. 落地 ──────────────────────────────────────────────────────── */
gate(1, 'main 未被别人抢先', () => {
  const now = git(['rev-parse', MAIN_REF], branchTree.path);
  if (now !== mainSha) refuse(`main 在体检期间从 ${mainSha.slice(0, 8)} 动到 ${now.slice(0, 8)} ⇒ 重跑本脚本`);
  return `${mainSha.slice(0, 8)} 仍是当前值`;
});

/** 探针问题（sev 2）在 `gate` 里就地退出，所以这里只排"能出可信读数"的三档。 */
const RANK = { 4: 0, 1: 1, 3: 2 };
if (fails.length) {
  const top = fails.slice().sort((a, b) => RANK[a.sev] - RANK[b.sev])[0];
  say(`\n🔴 体检未过：${fails.length} 条不成立，按最严重那一档退（${top.name} ⇒ exit ${top.sev}）`);
  process.exit(top.sev);
}

if (!checkRan || !checkOk) {
  say('🔴 完整 check 没有真的跑过（跳过不等于通过）');
  process.exit(1);
}

const cmd = `git merge --ff-only ${MERGE_REF}`;
if (!CONFIRM) {
  say(`\n✅ 体检全过。要落地，在**主检出**里跑：\n   cd ${mainTree.path} && node research/tools/selfhost-land-main.mjs --confirm`);
  say(`   （等价的裸命令，仅供核对：${cmd}。本脚本不 push。）`);
  process.exit(0);
}
git(['merge', '--ff-only', MERGE_REF], mainTree.path);
const landed = git(['rev-parse', MAIN_REF], mainTree.path);
if (landed !== carrierSha) {
  say(`🔴 merge 之后 main=${landed.slice(0, 8)} ≠ 载体 ${carrierSha.slice(0, 8)} —— 立刻查`);
  process.exit(1);
}
say(`✅ main 已前进到 ${landed.slice(0, 8)}（ff-only，未 push）`);
