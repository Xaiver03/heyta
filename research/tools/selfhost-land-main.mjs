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
 * 🔴 **落地那一趟必须用本文件的绝对路径**：这批 `selfhost-*.mjs` 只活在分支上，主检出里
 *   一枚都没有（2026-10-04 现量：主检出 `research/tools/` 下 `selfhost-*` = 0 枚），而
 *   `--confirm` 又必须在主检出目录里跑 ⇒ 照抄相对路径得到的是 MODULE_NOT_FOUND，
 *   它的症状和"脚本坏了"长得一模一样。本脚本自己打印的那两条命令已经是绝对路径。
 *
 * 🔴 `--confirm` 会先自动跑一遍 `--selftest` 的内容：判据自己坏了的时候，它那句
 *   "这些端口没人用"**不能**当放行（§8.120 那条同一个形状）。
 *
 * 退出码（严重度 2 > 1 > 3，"等窗口"不该盖过"这一步本来就不该做"）：
 *   0 = 体检通过（dry-run）/ 已落地（--confirm）
 *   2 = 探针或用法问题（找不到工作树、--confirm 却不在主检出里跑、脚本没报出可读的数）
 *   1 = 前置不成立（双亲不对 / 阻塞集非空 / main 在算完之后又动了 / --confirm 但 check 没跑）
 *   3 = 环境无效（负载超阈值 / 载体的 node_modules 不是当前那把锁装出来的 /
 *       载体那棵树此刻是别人的现场 —— 载体脚本第 0a 步退 6，这里记成同一档；
 *       跑链期间出现**外来的射程端口监听者**（或守不住）⇒ 链被本工具中止）
 *       —— 环境无效不等于产品失败
 *   4 = 载体上完整 `pnpm check` 红 ⇒ **不落地**，先逐段归属
 */
import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { depsFresh, freshReading } from './selfhost-deps-fresh.mjs';
import { startWatch } from './selfhost-kill-watchdog.mjs';

const MAIN_REF = 'main';
const BRANCH_REF = process.env.HEYTA_LAND_BRANCH ?? 'feat/self-host-distribution';
const MERGE_REF = 'feat/self-host-merge-main';
const MAX_LOAD = Number(process.env.HEYTA_LAND_MAX_LOAD ?? 12);
const LOAD_STEP = Number(process.env.HEYTA_LAND_LOAD_STEP ?? 60);
/** 跑链期间"守别人的服务端"的轮询间隔（默认 5s；判不了=中止，保守方向见装置文件头）。 */
const WATCH_MS = Number(process.env.HEYTA_LAND_WATCH_MS ?? 5000);

/**
 * 🔴 打印给**人复制粘贴**的路径一律带引号：仓库路径里有空格（`All in one Data`），
 *    裸路径粘进 shell 会拆成两个参数 —— 症状是"命令不存在"，而它跟真故障分不开。
 */
const q = (p) => `"${p}"`;
/** 本文件的绝对路径（分支上才有，主检出一枚 `selfhost-*` 都没有 ⇒ 相对路径必失败）。 */
const SELF = fileURLToPath(import.meta.url);
const TOOL = (name) => q(join(dirname(SELF), name));
/**
 * 🔴 只认"数字形状"：`Number('')` 是 **0**，而 0 恰好是"负载很低"——
 *    这就是 §8.122 那族假 0 的第三个面目（读空 ⇒ 判成安静）。
 *    读不出形状一律交 NaN，让调用方按"判不了"处理。
 */
const parseLoadRaw = (raw) => {
  const t = String(raw ?? '').replace(/[{}]/g, '').trim().split(/\s+/)[0];
  return /^\d+(?:\.\d+)?$/u.test(t) ? Number(t) : Number.NaN;
};

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
const gate = async (severity, name, fn) => {
  try {
    const note = await fn();
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

/* ── 射程判据：唯一事实源在 selfhost-kill-ports.mjs，本文件只消费 ─────
 * 为什么不能再在这份里写一遍：同一个判断原先在两个工具里各有一份 ——
 * segments 那份抄的是**端口表**（链里新增一段传别的端口不会自己长出来），
 * 本文件那份抄的是**"stdout 空 = 没人监听"**，而它把 `da3345c3` 修过的假 0 抄丢了：
 * lsof 探针坏时同样是 stderr 有字 + stdout 空，于是"判不了"被读成"没人用"，SIGKILL 照旧发生。
 * 现在两边都调这一个模块，判据本体只有一处。 */
const { CARRIER_DIR_DEFAULT, deriveKillPorts, busyEntries, portsSelftest } =
  await import('./selfhost-kill-ports.mjs');
const CARRIER_DIR = process.env.HEYTA_CARRIER_WT ?? CARRIER_DIR_DEFAULT;

if (FLAG('selftest')) {
  const s = await portsSelftest({ carrierDir: CARRIER_DIR });
  process.stdout.write(`${s.reading}\n探测腿：${s.probeReading}\n`);
  s.errs.forEach((e) => process.stdout.write(`  臂读数：${e}\n`));
  if (s.problems.length) {
    process.stdout.write(`🔴 自检 ${s.problems.length} 条问题：\n - ${s.problems.join('\n - ')}\n`);
    process.exit(2);
  }
  process.stdout.write('✅ 射程判据自检（判据本体在 selfhost-kill-ports.mjs）\n');
  process.exit(0);
}

/** 自检只在**真要跑链之前**做（dry-run 不跑链 ⇒ 不做，也不谎报）。 */
const portsCheck = CONFIRM ? await portsSelftest({ carrierDir: CARRIER_DIR }) : null;

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
  say(`   要真的落地：cd ${q(mainTree.path)} && node ${q(SELF)} --confirm`);
  process.exit(2);
}

/* ── 1. 双亲与新鲜度：载体必须正好是 main × 分支 ──────────────────── */
const mainSha = git(['rev-parse', MAIN_REF], branchTree.path);
const branchSha = git(['rev-parse', BRANCH_REF], branchTree.path);
let carrierSha = OPT('carrier');
await gate(1, '载体双亲对上', () => {
  if (!carrierSha) {
    /* 🔴 载体脚本现在在**第一个写动作之前**就会退场（第 0a 步：那棵树是不是别人的现场）。
     *    退 6 不是产品红，是"协作没到位" ⇒ 按 sev 3 记，与负载/端口同一档；
     *    退 2 是探针没接上 ⇒ blind，不许被下面那句"没报出 ✅ 载体"洗成读数问题。 */
    let out;
    try {
      out = run('node', ['research/tools/selfhost-merge-carrier.mjs'], branchTree.path);
    } catch (e) {
      const text = `${e.stdout ?? ''}${e.stderr ?? ''}`.trim();
      if (e.status === 6) refuse(`载体是别人的现场，脚本一个字节都没写（退 6）：\n${text}\n` +
        '   ⇒ 等那一趟跑完再重跑本体检。**不提供绕过开关，也不替他挪。**', 3);
      if (e.status === 2) {
        const pe = new Error(`载体脚本判不了（退 2）：\n${text}`);
        pe.probe = true;
        throw pe;
      }
      const fe = new Error(`载体脚本 rc=${e.status ?? '?'}：\n${text.slice(-900)}`);
      fe.sev = 1;
      throw fe;
    }
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
await gate(1, '阻塞集为空', () => {
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
      '   这些是**别人未提交的工作树**，不是合并冲突 —— 冲突面是另一件事，每次落地前用 `merge-tree` 重取' +
      '（§8.124 已就地更正 §8.111 ② 那句"提交态零冲突"：它是瞬时读数）⇒ 等他们提交。');
  }
  return '夹具绿 ⇒ 这个"空"是可信读数';
});

/* ── 3. 环境 ────────────────────────────────────────────────────────
 * 🔴 `--confirm` 要**连续三样**都 ≤ 阈值，dry-run 只取一样。
 *   理由不是"更严格更安全"，是负载在这台机器上是**剧烈摆**的（20:09=9.7 → 20:10=99.4 →
 *   20:13=70.4 → 20:20=39.2，现量见哨兵日志）：单样读到 ≤12 之后，几十分钟的完整链
 *   几乎必然撞进一次尖峰，而尖峰造成的是**假红**（超时、抢不到端口）—— 那一趟红
 *   还要逐段归属去证明它不是本批的。多花两分钟把"这一刻真的安静"判准，
 *   比事后拆几十分钟的假红便宜。阈值本身一个字没动。
 *   三样之间要真等（不是"连续调用三次"）—— 紧挨着的三样是同一个读数抄三遍。 */
const loadParseSelfcheck = () => {
  const one = parseLoadRaw('{ 11.11 22.22 33.33 }');
  if (one !== 11.11) return `负载解析取的不是 1 分钟位（合成样读到 ${one}）`;
  if (Number.isFinite(parseLoadRaw(''))) return '空读数被解析成了数（应当是 NaN ⇒ 按判不了处理）';
  return null;
};
await gate(3, '负载可用', () => {
  const bad = loadParseSelfcheck();
  if (bad) {
    const e = new Error(`${bad} ⇒ 这一档判不了，不拿"判不了"当"负载低"`);
    e.probe = true;
    throw e;
  }
  const need = CONFIRM ? 3 : 1;
  const seen = [];
  for (let i = 0; i < need; i++) {
    if (i > 0) execFileSync('sleep', [String(LOAD_STEP)], { stdio: 'ignore' });
    const raw = execFileSync('sysctl', ['-n', 'vm.loadavg'], { encoding: 'utf8' });
    const v = parseLoadRaw(raw);
    if (!Number.isFinite(v)) {
      const e = new Error(`第 ${i + 1} 样读不出数（原始 ${JSON.stringify(raw.trim())}）⇒ 判不了`);
      e.probe = true;
      throw e;
    }
    seen.push(v);
    if (v > MAX_LOAD) {
      refuse(`第 ${seen.length}/${need} 样负载 ${v} > ${MAX_LOAD} ⇒ 环境无效（不调阈值、不硬跑）。` +
        `已取到的各样：${seen.join(' → ')}。等窗口，或显式 HEYTA_LAND_MAX_LOAD=<n>`, 3);
    }
  }
  return `${need} 样都在 ${seen.join('/')}，全部 ≤ ${MAX_LOAD}` +
    (CONFIRM ? '' : '（dry-run 只取一样；--confirm 要连续三样，每样间隔 ' + LOAD_STEP + 's）');
});

/* ── 3b. 跑链之前：那几个端口上有没有别人的 dev server ─────────────── */
await gate(3, '完整 check 不会 SIGKILL 别人的 dev server', () => {
  if (!CONFIRM) skip('dry-run 不跑链 ⇒ 这条今天不适用（不适用 ≠ 通过）');
  if (portsCheck.problems.length) {
    blind(`射程判据的自检 ${portsCheck.problems.length} 条问题（判据自己坏了，不能拿它的"没端口在用"当放行）：\n     - ${portsCheck.problems.join('\n     - ')}`);
  }
  const d = deriveKillPorts(CARRIER_DIR);
  if (d.error) blind(`判不了射程：${d.error}`);
  const b = busyEntries(d.ports, d.owners);
  if (b.noLsof) blind('这台机器上没有 lsof ⇒ 判不了这些端口有没有人用，不拿"判不了"当"没人用"');
  if (b.brokenProbe) blind(`lsof 探针报坏（${b.brokenProbe}）⇒ "stdout 空"在这里不是"没人监听"，是判不了`);
  if (b.busy.length) {
    refuse(`链里的 e2e 前置会 SIGKILL 这些：\n     ${b.busy.join('\n     ')}\n` +
      '   先与它们的所有者协调或让他让位。本工具**不提供绕过开关** —— 要硬跑就自己去载体目录跑 pnpm check，' +
      '那时清场是你做的、日志也在你手上。', 3);
  }
  return `${d.ports.length} 个端口（${d.ports.map((p) => `${p}←${d.owners.get(p)}`).join('、')}）全部无监听；自检：${portsCheck.probeReading}`;
});

/* ── 3c. 载体的依赖是不是当前那把锁装出来的 ─────────────────────────
 * 第 1 族那条重算只做 `reset --hard`：**同步提交，不重装依赖**，而 `node_modules` 被 git 忽略、
 * 原地留着。main 只要动过 `pnpm-lock.yaml` 或 `e2e/pnpm-lock.yaml`，下一趟完整链就跑在
 * 上一把锁的依赖上 —— 响亮的那种（模块找不到）便宜，安静的那种（旧版本照跑照绿）贵。
 * 判据本体在 `selfhost-deps-fresh.mjs`（含"0 字节两边相等"与"只判了一棵树"两臂的反证）。 */
await gate(3, '载体的 node_modules 与当前那把锁同源', () => {
  const d = depsFresh(CARRIER_DIR);
  if (d.error) blind(`依赖新鲜判不了：${d.error}\n   拿"判不了"当"依赖是新的"就跑完整链，等于让链跑在没装过的树上`);
  if (d.stale.length) {
    refuse(`载体重算只同步提交、不重装依赖 ⇒ 完整链会跑在旧锁的依赖上（${d.stale.join('、')} 不同源）：\n` +
      `     ${freshReading(d)}\n` +
      `   先在载体里装：cd ${CARRIER_DIR} && pnpm install --frozen-lockfile，再 cd e2e && pnpm install --frozen-lockfile，\n` +
      '   然后重跑本体检。本工具**不代跑 install** —— 那棵树的 node_modules 与并行那条线的打包共用，' +
      '重装是有一次性现场后果的动作，得由要看清在场的人做。', 3);
  }
  return freshReading(d);
});

/* ── 4. 载体上跑完整 pnpm check ───────────────────────────────────── */
let checkRan = false;
let checkOk = false;
await gate(4, '载体上完整 pnpm check', async () => {
  /* 🔴 **dry-run 绝不跑链**，这一条原先是假的：3b 那句"dry-run 不跑链 ⇒ 这条今天不适用"
   *    写在纸上，而这里没有对应的守卫，于是"只体检"的一次运行真的起了几十分钟的
   *    `pnpm check`，其中 e2e 前置会按端口 SIGKILL —— 而 3b 那道守卫在 dry-run 里根本没执行。
   *    13:0x 实测：负载刚好落到 11.29（≤12）⇒ 前置全过 ⇒ 链真的开跑了，
   *    我是在它跑起来之后才发现并杀掉的（那几枚端口当时无人监听，没有造成实际伤害）。
   *    "体检"这个词的含义是**不产生副作用**，所以它现在必须响亮地跳过。 */
  if (!CONFIRM) {
    skip('dry-run 不跑链（链里 e2e 前置会按端口 SIGKILL，体检不许有这种副作用）⇒ 不适用 ≠ 通过');
  }
  if (fails.length) {
    skip(`没跑（前面已有 ${fails.length} 条不成立 ⇒ 这一趟本来就不该落地）。跳过不等于通过。`);
  }
  if (!existsSync(CARRIER_DIR)) {
    refuse(`载体目录 ${CARRIER_DIR} 不存在 ⇒ 完整 check 没跑（跳过不等于通过）`);
  }
  const checkLog = join(tmpdir(), 'heyta-land-check.log');
  /* 🔴 3b 那一眼只在**起跑之前**判；它管不到跑起来之后的几十分钟。链里的 e2e 前置是按端口
   *    SIGKILL 的，而并行那条线的 vite 在一趟链的时长里会出现不止一波（§8.126 ④ 现量：
   *    21:04 有人 → 21:07 空 → 21:13 又有人）。所以边跑边守：一旦出现**不在这棵载体树里**的
   *    监听者就中止整趟链 —— 宁可白跑几十分钟，不拿别人的现场换我的读数。
   *    守不住（射程派不出来 / lsof 坏 / 归属读不出）一律按"中止"处理，保守方向写死在装置文件头。 */
  const d = deriveKillPorts(CARRIER_DIR);
  if (d.error) {
    blind(`跑链期间无法知道要守哪几枚端口：${d.error} ⇒ 守不住就不能开跑`);
  }
  checkRan = true;
  say(`   日志 → ${checkLog} · 看守 ${d.ports.length} 枚端口（每 ${WATCH_MS}ms 一轮）`);
  const chunks = [];
  const child = spawn('pnpm', ['check'], { cwd: CARRIER_DIR, env: process.env });
  child.stdout.on('data', (c) => chunks.push(c));
  child.stderr.on('data', (c) => chunks.push(c));
  let trip = null;
  const watch = startWatch({
    ports: d.ports,
    carrierDir: CARRIER_DIR,
    intervalMs: WATCH_MS,
    onTrip: (why) => {
      trip = why;
      child.kill('SIGTERM');
      const hard = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* 已退 */ } }, 5000);
      hard.unref();
    },
  });
  const code = await new Promise((res) => {
    child.on('exit', (c, sig) => res(typeof c === 'number' ? c : (sig ? 143 : 1)));
    child.on('error', (e) => { chunks.push(Buffer.from(`\nspawn 失败：${e.message}`)); res(127); });
  });
  watch.stop();
  writeFileSync(checkLog, Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8'));
  const wd = `看守判了 ${watch.reads} 轮`;
  if (trip) {
    refuse(`链被本工具**中止**（环境/协作无效，不是产品红）：${trip}\n` +
      `   中止前的输出留在 ${checkLog}。${wd} ⇒ 等那一趟别人的活告一段落再重跑本体检。`, 3);
  }
  if (code !== 0) {
    refuse(`rc=${code} ⇒ **不落地**。关闭判据是"每一枚红仍可归属到非本批"，不是"全绿"。\n` +
      `   逐段归属：node ${TOOL('selfhost-check-segments.mjs')} --tree ${CARRIER_DIR} --as carrier --ref ${MERGE_REF} --out /tmp/attrib.tsv` +
      (FLAG('attribute') ? '' : '（或给本脚本加 --attribute）') + `\n   ${wd}`, 4);
  }
  checkOk = true;
  return `全绿 · ${wd}`;
});

/* ── 5. 落地 ──────────────────────────────────────────────────────── */
await gate(1, 'main 未被别人抢先', () => {
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

/* 只有**真要落地**时才要求链真的跑过：dry-run 按上面的守卫永不跑链，
 * 把这条留在 dry-run 上会得到一个"永远不通过的判据"（§7 元规则 2 的反面）。 */
if (CONFIRM && (!checkRan || !checkOk)) {
  say('🔴 完整 check 没有真的跑过（跳过不等于通过）');
  process.exit(1);
}

const cmd = `git merge --ff-only ${MERGE_REF}`;
if (!CONFIRM) {
  say(`\n✅ 体检全过。要落地，在**主检出**里跑（脚本用绝对路径 —— 这批工具不在 main 上）：`);
  say(`   cd ${q(mainTree.path)} && node ${q(SELF)} --confirm`);
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
