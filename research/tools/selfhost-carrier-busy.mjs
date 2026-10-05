#!/usr/bin/env node
/**
 * `selfhost-carrier-busy.mjs` —— "此刻有没有**别人的**进程正在用载体那棵树"这条判据的单一所有者。
 *
 * ## 为什么需要它
 * 载体目录（默认 `/tmp/heyta-merge-carrier`，常量归 `selfhost-kill-ports.mjs`）**不是本批私有的**：
 * 并行那条线的启动器（main `f7e193e9` 升到 v11 的那个）在同一棵树上做公证 + 远端打包，一趟 15–25 分钟。
 * 而 `selfhost-merge-carrier.mjs` 的第 0 步是**无条件**的 `worktree add` / `merge --abort` /
 * 硬重置到 main tip —— 撞进正在跑的树里，毁掉的是别人这段工作的全部现场。
 * 他们那侧已经为此加了守卫，提交信息原话：「中途被人 checkout 则 `INNER_EXIT=0`/`FRESH=5/5`
 * 句句真话但图属于两棵树」。这条是我这侧的对称动作，而且必须落在**执行者**身上：
 * 写在文档里就等于没有（G-48 收口时立下的口径 —— "手动跑过一次"不算消费方）。
 *
 * ## 三条形状，每条都对应一个会让闸门失真的错
 *
 * | 形状 | 不这么做会怎样 |
 * |---|---|
 * | 只认**整 token**命中，不认前缀子串 | 备份目录、日志路径都算"有人在用" ⇒ 闸门永远拒绝，下一次就被人整个拆掉 |
 * | 探针读不到按**判不了**退出，不按空集 | `ps`/`lsof` 被拦时输出的形状与"没人用"**完全一样** —— 这是 §8.122 端口探针那个假 0 的同一个错 |
 * | `/private/tmp` 与 `/tmp` 归一 | macOS 上同一棵树两种写法（`lsof` 实测打印的是 `/private/tmp/…`）⇒ 不归一会把"有人正在用"读成空集 |
 * | argv 腿**之外**还要一条 cwd 腿 | 别人在载体里 `cd` 之后起的子进程，命令行里根本没有那个路径 —— 只看 argv 就会放行 |
 *
 * 自己的进程树按 **pid 链**豁免（不按"命令行里有没有我的脚本名"：那会把别人起的
 * `node …carrier.mjs` 误判成我的，也会把我自己起的打包误判成别人的）。
 *
 * 用法：`node research/tools/selfhost-carrier-busy.mjs --selftest`（夹具 + 真实腿 + 防漂）
 *       `node research/tools/selfhost-carrier-busy.mjs --check`（只读现量，不改任何东西）
 * 退出码：0 = 空闲 · 3 = 有人在用 · 2 = 判不了（判不了不等于空闲）。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { CARRIER_DIR_DEFAULT } from './selfhost-kill-ports.mjs';

/** macOS：`/tmp` 是 `/private/tmp` 的软链，两条腿看到的写法不同。 */
export function normPath(p) {
  return p.startsWith('/private/tmp/') ? p.slice('/private'.length) : p;
}

/**
 * 命令行里的一个 token 是否**就是**载体目录（或它下面的路径）。
 * `sep` 存在是为了让自检能拿"摘掉边界"的同一份逻辑跑一遍（臂 5）—— 生产路径永远是默认值。
 */
export function tokenHitsDir(token, dir, sep = '/') {
  const t = normPath(String(token).replace(/^["']+|["']+$/gu, ''));
  if (!sep) return t.startsWith(normPath(dir));
  return t === normPath(dir) || t.startsWith(normPath(dir) + sep);
}

const tokensOf = (cmd) => String(cmd).split(/\s+/u).filter(Boolean);

/** `ps -axo pid=,ppid=,command=` 的形状；解析不出来就返回空数组，由调用方按"探针坏"处理。 */
function parsePs(psText) {
  const rows = [];
  for (const line of String(psText ?? '').split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\S.*)$/u);
    if (m) rows.push({ pid: Number(m[1]), ppid: Number(m[2]), cmd: m[3].trim() });
  }
  return rows;
}

/** `lsof -d cwd` 的形状：表头 + 每进程一行，最后一列是 cwd 的绝对路径。 */
function parseCwd(lsofText) {
  const lines = String(lsofText ?? '').split('\n').filter((l) => l.trim());
  if (!lines.length || !/^COMMAND\s+PID\s+USER\s+FD/u.test(lines[0])) return { error: 'lsof cwd 腿没有表头或表头改形' };
  const rows = [];
  for (const line of lines.slice(1)) {
    const cols = line.trim().split(/\s+/u);
    if (!/^\d+$/u.test(cols[1] ?? '')) continue;
    rows.push({ pid: Number(cols[1]), cwd: normPath(cols.slice(8).join(' ')) });
  }
  return { rows, header: lines[0].split(/\s+/u) };
}

/**
 * @param {{psText: string, cwdText: string, dir: string, selfPid: number, mergeHead?: boolean}} o
 * @returns {{error: string} | {users: Array<{pid: number, via: string, what: string}>, psRows: number, cwdRows: number, exempt: number[]}}
 */
export function carrierUsers({ psText, cwdText, dir, selfPid, mergeHead = false }) {
  const psRows = parsePs(psText);
  const cwd = parseCwd(cwdText);
  /* 🔴 正向对照，不是仪式：任何一次真 `ps` 快照里**必有** pid 1（macOS 是 launchd），
   *    也**必有**发起这次探测的那个进程自己的 cwd 行。缺任何一个 = 探针没接上，
   *    而"探针没接上"与"载体没人用"在两腿上的读数形状完全相同。 */
  if (!psRows.length) return { error: 'ps 腿一行都没解析出来（空输出与"没人用"同形）⇒ 判不了' };
  if (!psRows.some((r) => r.pid === 1)) return { error: `ps 腿有 ${psRows.length} 行却没有 pid 1 ⇒ 探针坏，不能拿它当"没人用"` };
  if (cwd.error) return { error: cwd.error };
  if (!cwd.rows.some((r) => r.pid === Number(selfPid))) {
    return { error: `lsof cwd 腿里没有本进程（pid ${selfPid}）自己那一行 ⇒ 探针坏（每个进程都有 cwd）` };
  }

  // 自己的 pid 链（自身 + 全部祖先）豁免；子孙不豁免 —— 它们正是我可能撞坏的东西的持有者。
  const exempt = [];
  const seen = new Set();
  let cur = psRows.find((r) => r.pid === Number(selfPid));
  while (cur && !seen.has(cur.pid)) {
    seen.add(cur.pid);
    exempt.push(cur.pid);
    cur = psRows.find((r) => r.pid === cur.ppid);
  }
  const mine = new Set(exempt);

  const byPid = new Map();
  for (const r of psRows) {
    if (mine.has(r.pid)) continue;
    if (tokensOf(r.cmd).some((t) => tokenHitsDir(t, dir))) {
      byPid.set(r.pid, { pid: r.pid, via: 'argv', what: `${r.cmd.slice(0, 90)}（父 ${r.ppid}）` });
    }
  }
  for (const r of cwd.rows) {
    if (mine.has(r.pid) || byPid.has(r.pid)) continue;
    const rr = normPath(r.cwd);
    if (rr === normPath(dir) || rr.startsWith(`${normPath(dir)}/`)) {
      const psRow = psRows.find((p) => p.pid === r.pid);
      byPid.set(r.pid, { pid: r.pid, via: 'cwd', what: `cwd=${rr}${psRow ? ` · ${psRow.cmd.slice(0, 70)}` : ''}` });
    }
  }

  const users = [...byPid.values()];
  if (mergeHead) {
    users.push({ pid: -1, via: 'MERGE_HEAD', what: '载体里有一场**没收拾干净的在飞合并**（`git rev-parse --verify MERGE_HEAD` 命中）' });
  }
  return { users, psRows: psRows.length, cwdRows: cwd.rows.length, exempt };
}

/** 真跑两条腿（只读）。任何一条读不到 ⇒ `{error}`，调用方按"判不了"处理。 */
export function liveCarrierUsers({ dir = CARRIER_DIR_DEFAULT, selfPid = process.pid, mergeHead = false } = {}) {
  let psText = '';
  try {
    psText = execFileSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8', maxBuffer: 32 << 20 });
  } catch (e) {
    if (e?.code === 'ENOENT') return { error: '这台机器上没有 ps ⇒ 判不了，不拿"读不到"当"没人用"' };
    return { error: `ps 调用失败（rc=${e?.status ?? '?'}）：${String(e?.stderr ?? e?.message).split('\n')[0].slice(0, 120)}` };
  }
  let cwdText = '';
  let cwdErr = '';
  try {
    cwdText = execFileSync('lsof', ['-d', 'cwd'], { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    if (e?.code === 'ENOENT') return { error: '这台机器上没有 lsof ⇒ cwd 腿判不了' };
    cwdText = String(e?.stdout ?? '');
    cwdErr = String(e?.stderr ?? '').trim();
    // lsof 对**别人的**进程没有权限时也会非 0 退；那不算探针坏，除非连表头都没有。
    if (!/^COMMAND\s+PID/u.test(cwdText)) return { error: `lsof cwd 腿 rc=${e?.status ?? '?'} 且 stdout 无表头：${cwdErr.split('\n')[0].slice(0, 120) || '(stderr 也空)'}` };
  }
  const r = carrierUsers({ psText, cwdText, dir, selfPid, mergeHead });
  return r.error ? { ...r, psFirstLine: psText.split('\n').find(Boolean)?.slice(0, 80) } : r;
}

/* ── 自检 ────────────────────────────────────────────────────────────
 * 每一臂都写清"它挡的是哪一层"，并且**至少一臂专门证明边界是承重的**（臂 5）：
 * 不这么做的话，下一次有人把 `t.startsWith(dir + sep)` 简写成 `startsWith(dir)`，
 * 这一整套仍然全绿 —— 而它从此只会过度拒绝，最后被人拆掉。 */
const PS_HEAD = `     1     0 /sbin/launchd
  5000     1 -zsh
  6000  5000 /bin/zsh -c { source shell-snapshots/x.sh } && eval 'node gate.mjs'
  7777     1 /usr/sbin/syslogd`;
const CWD_HEAD = 'COMMAND   PID      USER   FD   TYPE DEVICE SIZE/OFF      NODE NAME';
const PS_NO_PID1 = `  6000  5000 /bin/zsh -c node gate.mjs
  5000     1 -zsh`;
const DIR = CARRIER_DIR_DEFAULT;

export function carrierBusySelftest({ dir = DIR } = {}) {
  const problems = [];
  const errs = [];
  const eq = (name, got, want) => {
    if (got !== want) problems.push(`${name}：实际 ${got}，应当 ${want}`);
  };
  const own = process.pid;
  // 夹具里的"自己"用 6000，所以把 6000 塞进链里跑（selfPid 参数化正是为了这条腿可验）。
  const ps = (extra = '') => `${PS_HEAD}\n${extra}`;
  const cwd = (extra = '') => `${CWD_HEAD}\nnode     6000 rocalight  cwd    DIR   1,13      928 248052731 /tmp/heyta-proj\n${extra}`;
  const run = (psText, cwdText, opts = {}) =>
    carrierUsers({ psText, cwdText, dir, selfPid: 6000, ...opts });

  let r = run(ps(), cwd());
  if (r.error) problems.push(`control 应当出数却报错：${r.error}`);
  else eq('control 用户数', r.users.length, 0);
  errs.push(`臂 control 问题 ${r.error ? 9 : r.users.length} 条（应当 0）`);

  /* 臂 1：别人的命令行里点了载体目录 */
  r = run(ps(`  4242  4000 /bin/zsh -c cd ${dir} && node scripts/package-app.sh`), cwd());
  if (r.error) problems.push(`臂1 应当出数却报错：${r.error}`);
  else {
    eq('臂1 用户数', r.users.length, 1);
    if (r.users[0]?.via !== 'argv') problems.push(`臂1 归因腿是 ${r.users[0]?.via}，应当 argv`);
    if (!r.users[0]?.what.includes('package-app.sh')) problems.push('臂1 的读数里没有对方在跑什么 ⇒ 拒绝信息没法给人看');
  }
  errs.push(`臂1 问题 ${r.error ? 9 : r.users.length === 1 && r.users[0]?.via === 'argv' ? 0 : 1} 条（应当 0）`);

  /* 臂 2：只在 cwd 腿现形（子进程命令行里没有那个路径）⇒ 证明 argv 腿不够 */
  r = run(ps('  4243  4000 node scripts/package-app.sh'),
    cwd('node     4243 rocalight  cwd    DIR   1,13      928 248052731 /private/tmp/heyta-merge-carrier'));
  if (r.error) problems.push(`臂2 应当出数却报错：${r.error}`);
  else {
    eq('臂2 用户数', r.users.length, 1);
    if (r.users[0]?.via !== 'cwd') problems.push(`臂2 归因腿是 ${r.users[0]?.via}，应当 cwd`);
  }
  errs.push(`臂2 问题 ${r.error ? 9 : r.users.length === 1 && r.users[0]?.via === 'cwd' ? 0 : 1} 条（应当 0）`);

  /* 臂 3：自己那一支必须豁免，否则 --confirm 自己挡自己 */
  r = run(ps(`  6000  5000 /bin/zsh -c cd ${dir} && git status`), cwd(`node     6000 rocalight  cwd    DIR   1,13      928 248052731 ${dir}`));
  if (r.error) problems.push(`臂3 应当出数却报错：${r.error}`);
  else eq('臂3 自锁用户数', r.users.length, 0);
  errs.push(`臂3 问题 ${r.error ? 9 : r.users.length} 条（应当 0）`);

  /* 臂 4：前缀陷阱 —— 备份目录/日志路径不算有人在用 */
  r = run(ps(`  4244  4000 /bin/zsh -c cd ${dir}-backup && ls`),
    cwd('node     4244 rocalight  cwd    DIR   1,13      928 248052731 /private/tmp/heyta-merge-carrier-backup/web-dist'));
  if (r.error) problems.push(`臂4 应当出数却报错：${r.error}`);
  else eq('臂4 误报用户数', r.users.length, 0);
  errs.push(`臂4 问题 ${r.error ? 9 : r.users.length} 条（应当 0）`);

  /* 臂 5：边界承重 —— 同一份 token 摘掉分隔符就必须命中（证明臂 4 那个 0 不是恒 0） */
  const loose = tokenHitsDir(`${dir}-backup/web-dist`, dir, '');
  const strict = tokenHitsDir(`${dir}-backup/web-dist`, dir);
  if (!loose) problems.push('臂5：摘掉边界后仍然不命中 ⇒ needle 形状变了，这一臂挡不了任何事');
  if (strict) problems.push('臂5：带边界时命中了备份目录 ⇒ 闸门会过度拒绝（下一次被人整个拆掉）');
  errs.push(`臂5 问题 ${(loose ? 0 : 1) + (strict ? 1 : 0)} 条（应当 0）`);

  /* 臂 6：假 0 —— 三条"探针坏"的形状都必须按判不了处理，不许返回空集 */
  const bad = [
    ['ps 空输出', run('', cwd())],
    ['ps 没有 pid 1', run(PS_NO_PID1, cwd())],
    ['lsof 没有表头', run(ps(), 'node 6000 rocalight cwd DIR 1,13 1 1 /tmp/x')],
    ['lsof 里没有本进程', run(ps(), CWD_HEAD)],
  ];
  for (const [name, rr] of bad) {
    if (!rr.error) problems.push(`${name}：没报"判不了"而是给了读数 ⇒ "判不了"会被当成"没人用"，硬重置照旧发生`);
    else if (rr.users) problems.push(`${name}：报错的同时还给了用户集（形状不唯一）`);
  }
  errs.push(`臂6 问题 ${bad.filter(([, rr]) => !rr.error).length} 条（应当 0）`);

  /* 臂 7：载体里留着一场没收拾干净的合并 ⇒ 也算有人在飞 */
  r = run(ps(), cwd(), { mergeHead: true });
  if (r.error) problems.push(`臂7 应当出数却报错：${r.error}`);
  else {
    eq('臂7 用户数', r.users.length, 1);
    if (r.users[0]?.via !== 'MERGE_HEAD') problems.push('臂7 那条没归因到 MERGE_HEAD');
  }
  errs.push(`臂7 问题 ${r.error ? 9 : r.users.length === 1 && r.users[0]?.via === 'MERGE_HEAD' ? 0 : 1} 条（应当 0）`);

  /* 臂 8：真实腿 —— 在这台机器上现跑一次。读不到就是一条问题，因为消费方（载体脚本）
   *        拿的就是这条腿；夹具全绿而真腿坏掉，正是 §8.121 那条"控制臂先跑"要挡的东西。 */
  const live = liveCarrierUsers({ dir, selfPid: own });
  let liveReading = '';
  if (live.error) {
    problems.push(`真实腿判不了：${live.error}`);
    liveReading = `真实腿：判不了（${live.error}）`;
  } else {
    liveReading = `真实腿：ps ${live.psRows} 行 · cwd ${live.cwdRows} 行 · 豁免自己链 ${live.exempt.join('←')} · 此刻载体在用者 ${live.users.length} 个` +
      (live.users.length ? `（${live.users.map((u) => `${u.pid}/${u.via}`).join(' ')}）` : '');
  }
  errs.push(`臂8 问题 ${live.error ? 1 : 0} 条（应当 0）`);

  /* 臂 9：目录默认值的抄件防漂（与 selfhost-kill-ports.mjs 臂 6 同一族，判的是另一对抄件）
   * 🔴 路径必须走 `fileURLToPath`：`new URL(…).pathname` 会把仓库路径里的空格百分号编码成
   *    `All%20in%20one`，于是 `readFileSync` 读不到 ⇒ 这一臂第一次跑就"红"了，而红的不是判据。 */
  const carrierScript = fileURLToPath(new URL('./selfhost-merge-carrier.mjs', import.meta.url));
  let cm = null;
  try {
    cm = readFileSync(carrierScript, 'utf8').match(/const WT = process\.env\.HEYTA_CARRIER_WT \|\| '([^']+)'/u)?.[1] ?? null;
  } catch { problems.push(`读不到 ${carrierScript} ⇒ 无法对账载体目录（不是"对上了"）`); }
  if (cm && cm !== dir) problems.push(`载体目录漂移：本自检 ${dir} vs 载体脚本 ${cm} ⇒ 闸门判的是另一棵树`);
  errs.push(`臂9 问题 ${cm && cm !== dir ? 1 : 0} 条（应当 0）`);

  /* 收尾复绿：所有臂跑完再回一次 control，证明变异没留在对象里（这里全是纯函数，
   * 留这一条是因为下一次有人往模块里加"临时放宽"时，这条会先叫。 */
  r = run(ps(), cwd());
  const restoreProblems = r.error ? 1 : r.users.length;
  errs.push(`收尾复绿 问题 ${restoreProblems} 条（应当 0）`);
  if (restoreProblems) problems.push('收尾复绿失败 ⇒ control 之后对象状态被改了');

  return { problems, errs, liveReading, dir };
}

if (process.argv[1]?.endsWith('selfhost-carrier-busy.mjs')) {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('用法：node research/tools/selfhost-carrier-busy.mjs --selftest | --check [--dir=…]');
    console.log('退出码：0=空闲 · 3=有人在用 · 2=判不了（判不了 ≠ 空闲）');
    process.exit(0);
  }
  const dir = (args.find((a) => a.startsWith('--dir=')) ?? `--dir=${CARRIER_DIR_DEFAULT}`).slice(6);
  if (args.includes('--selftest')) {
    const s = carrierBusySelftest({ dir });
    s.errs.forEach((e) => console.log(`  ${e}`));
    console.log(`  ${s.liveReading}`);
    if (s.problems.length) {
      console.log(`🔴 自检 ${s.problems.length} 条问题：\n - ${s.problems.join('\n - ')}`);
      process.exit(2);
    }
    console.log('✅ 在用者判据自检：control 0 + 九臂各按预期 + 假 0 与"没人用"分开 + 边界承重 + 真实腿可读 + 目录未漂移 + 收尾复绿');
    process.exit(0);
  }
  const live = liveCarrierUsers({ dir });
  if (live.error) {
    console.log(`🔴 载体在用者判不了：${live.error}\n   （不拿"读不到"当"没人用"）`);
    process.exit(2);
  }
  if (live.users.length) {
    console.log(`🔴 载体 ${dir} 此刻有 ${live.users.length} 个别人的进程在用：`);
    live.users.forEach((u) => console.log(`   pid=${u.pid} [${u.via}] ${u.what}`));
    console.log('   等他们结束，或让**他们**先挪开 —— 本工具不提供绕过开关。');
    process.exit(3);
  }
  console.log(`✅ 载体 ${dir} 空闲（ps ${live.psRows} 行 · cwd ${live.cwdRows} 行 · 豁免自己链 ${live.exempt.join('←')}）`);
  process.exit(0);
}
